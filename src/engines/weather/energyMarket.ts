// From weather to energy prices in the Fenwick region. Heating demand for gas (degree days),
// electricity demand (heating and air conditioning), wind and sunshine feed one day of the
// electricity course's power system — its nine plants and its reference-day demand shape — and
// a gas system with limited pipeline capacity into the region. The two markets are linked: gas
// plants burn gas, so a cold day raises the gas price, and the gas price sets the cost of the
// plants that set the power price. The day is solved by iterating between the two.

import { STANDARD_FLEET } from '../../model/fleet';
import { SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import { clearMeritOrder, type Offer } from '../market/clearing';
import { UTILITY, demandFactor, hdd, sendout } from './degreeDays';
import { RIDGE_MW, VALLEY_MW, dailyWindCf, solarShare } from './renewables';

/** Gas price at which the electricity course's plant costs hold, $/MMBtu. */
export const REFERENCE_GAS = 4;

/** Heat rate (MMBtu of gas per MWh) and other costs ($/MWh) of the gas plants; at $4 gas they give the fleet's costs. */
export const GAS_PLANTS: Record<string, { heatRate: number; other: number }> = {
  cc1: { heatRate: 7, other: 8 },
  cc2: { heatRate: 8, other: 10 },
  ct: { heatRate: 11, other: 44 },
};

export interface GasSystem {
  /** National benchmark price (Henry Hub), $/MMBtu. */
  henryHub: number;
  /** Pipeline capacity into the region, MMBtu per day. */
  pipeline: number;
  /** Industrial and other gas demand, MMBtu per day. */
  other: number;
  /** The most the city-gate price can reach, set by trucked LNG and storage peaking supplies, $/MMBtu. */
  cap: number;
}

export const GAS_SYSTEM: GasSystem = { henryHub: 4, pipeline: 1_400_000, other: 200_000, cap: 30 };

/**
 * The regional price premium over Henry Hub as the pipelines fill: about $1 when lightly used,
 * climbing steeply once they are more than 85% full, when gas must be bid away from other
 * buyers or brought in by the most expensive routes.
 */
export function citygateBasis(utilization: number): number {
  const u = Math.max(0, utilization);
  return 0.3 + 1.0 * Math.min(u, 1.2) + 400 * Math.max(0, u - 0.85) ** 2;
}

export function citygatePrice(demandMMBtu: number, sys: GasSystem = GAS_SYSTEM): number {
  return Math.min(sys.cap, sys.henryHub + citygateBasis(demandMMBtu / sys.pipeline));
}

/** A plant's cost to run at a gas price, $/MWh. Non-gas plants keep their fleet cost. */
export function plantCost(id: string, gas: number): number {
  const g = GAS_PLANTS[id];
  if (g) return g.other + g.heatRate * gas;
  return STANDARD_FLEET.find((p) => p.id === id)!.marginalCost;
}

export interface WeatherDay {
  /** Day of the year, for the sun. */
  doy: number;
  /** Daily mean temperature, °F. */
  meanF: number;
  /** Daily mean wind at hub height on Hollin Ridge, m/s. */
  windMs: number;
  /** Cloud cover, 0–1. */
  cloud: number;
}

export interface EnergyHour {
  hour: number;
  demand: number;
  wind: number;
  solar: number;
  price: number;
  marginal: string | null;
  shortfall: number;
  /** Gas burned by power plants this hour, MMBtu. */
  burn: number;
  dispatch: Record<string, number>;
  offers: Offer[];
}

export interface EnergyDay {
  hours: EnergyHour[];
  hdd: number;
  /** Utility sendout, MMBtu. */
  sendout: number;
  /** Gas burned for power, MMBtu. */
  powerBurn: number;
  gasDemand: number;
  utilization: number;
  /** City-gate gas price, $/MMBtu. */
  gas: number;
  peakDemand: number;
  peakPrice: number;
  /** Demand-weighted average power price, $/MWh. */
  avgPrice: number;
  windMWh: number;
  solarMWh: number;
}

/** Offers for one hour at a gas price. Hydro offers 80% of its capacity; wind and sun offer at zero. */
export function hourOffers(gas: number, windMW: number, solarMW: number): Offer[] {
  const offers: Offer[] = [];
  for (const p of STANDARD_FLEET) {
    if (p.fuel === 'wind') offers.push({ id: p.id, mw: windMW, price: 0 });
    else if (p.fuel === 'solar') offers.push({ id: p.id, mw: solarMW, price: 0 });
    else if (p.fuel === 'hydro') offers.push({ id: p.id, mw: p.capacity * 0.8, price: p.marginalCost });
    else offers.push({ id: p.id, mw: p.capacity, price: plantCost(p.id, gas) });
  }
  return offers;
}

const WIND_SHAPE_MEAN = WIND_CF.reduce((s, v) => s + v, 0) / 24;

export function energyDay(w: WeatherDay, sys: GasSystem = GAS_SYSTEM): EnergyDay {
  const h = hdd(w.meanF);
  const send = sendout(h);
  const factor = demandFactor(w.meanF);
  const airC = ((w.meanF - 32) * 5) / 9;
  const cf = dailyWindCf(w.windMs);
  const windH = WIND_CF.map((s) => Math.min(1, (s / WIND_SHAPE_MEAN) * cf) * RIDGE_MW);
  const solarH = Array.from({ length: 24 }, (_, hr) => solarShare(w.doy, hr + 0.5, w.cloud, airC) * VALLEY_MW);
  let gas = citygatePrice(send + sys.other + 100_000, sys);
  let hours: EnergyHour[] = [];
  let burn = 0;
  for (let iter = 0; iter < 6; iter++) {
    hours = SYSTEM_DEMAND.map((base, hr) => {
      const demand = base * factor;
      const offers = hourOffers(gas, windH[hr], solarH[hr]);
      const c = clearMeritOrder(offers, demand);
      let b = 0;
      for (const id of Object.keys(GAS_PLANTS)) b += (c.dispatch[id] ?? 0) * GAS_PLANTS[id].heatRate;
      return { hour: hr, demand, wind: windH[hr], solar: solarH[hr], price: c.price, marginal: c.marginal, shortfall: c.shortfall, burn: b, dispatch: c.dispatch, offers };
    });
    burn = hours.reduce((s, x) => s + x.burn, 0);
    const next = citygatePrice(send + burn + sys.other, sys);
    if (Math.abs(next - gas) < 0.005) {
      gas = next;
      break;
    }
    gas = 0.5 * gas + 0.5 * next;
  }
  const total = send + burn + sys.other;
  const energy = hours.reduce((s, x) => s + x.demand, 0);
  const peak = hours.reduce((a, b) => (b.demand > a.demand ? b : a), hours[0]);
  return {
    hours,
    hdd: h,
    sendout: send,
    powerBurn: burn,
    gasDemand: total,
    utilization: total / sys.pipeline,
    gas,
    peakDemand: peak.demand,
    peakPrice: peak.price,
    avgPrice: hours.reduce((s, x) => s + x.price * x.demand, 0) / energy,
    windMWh: windH.reduce((s, v) => s + v, 0),
    solarMWh: solarH.reduce((s, v) => s + v, 0),
  };
}

export { UTILITY };
