// Simulated market history for the course region: day-ahead prices cleared on forecasts,
// real-time prices cleared on what actually happened. Trading and storage lessons backtest on it.
// Every series comes from the standard fleet and profiles, so prices are explainable.

import { STANDARD_FLEET } from './fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from './profiles';
import { ar1, gaussian, rng } from './random';
import type { Hourly } from './types';

export interface MarketDay {
  day: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Daily mean temperature, °C. */
  temp: number;
  /** Gas price multiplier on gas plants' costs. */
  gas: number;
  demandForecast: Hourly;
  demand: Hourly;
  windForecast: Hourly;
  wind: Hourly;
  solarForecast: Hourly;
  solar: Hourly;
  /** Units on forced outage in real time. */
  outages: string[];
  /** Hub (system) prices, $/MWh. */
  da: Hourly;
  rt: Hourly;
  /** Nodal prices: North (wind and hydro, export-constrained) and Metro (import-constrained). */
  daNorth: Hourly;
  rtNorth: Hourly;
  daMetro: Hourly;
  rtMetro: Hourly;
}

const NORTH_EXPORT_LIMIT = 380;
const METRO_IMPORT_LIMIT = 560;

interface Clear {
  price: number;
  margin: number;
}

/** Merit-order price with a scarcity adder that rises as spare capacity runs out. */
function clearHour(demand: number, wind: number, solar: number, gas: number, out: Set<string>): Clear {
  const offers: Array<{ mw: number; price: number }> = [];
  for (const g of STANDARD_FLEET) {
    if (out.has(g.id)) continue;
    if (g.fuel === 'wind') offers.push({ mw: wind, price: -5 });
    else if (g.fuel === 'solar') offers.push({ mw: solar, price: -2 });
    else if (g.fuel === 'nuclear') offers.push({ mw: g.capacity, price: g.marginalCost });
    else {
      const cost = g.fuel === 'gasCC' || g.fuel === 'gasCT' ? g.marginalCost * gas : g.marginalCost;
      offers.push({ mw: g.capacity * (g.fuel === 'hydro' ? 0.8 : 1), price: cost });
    }
  }
  offers.sort((a, b) => a.price - b.price);
  const supply = offers.reduce((s, o) => s + o.mw, 0);
  // Nuclear is inflexible: if demand is below its floor plus zero-cost renewables, prices go negative.
  const mustRun = STANDARD_FLEET.find((g) => g.id === 'nuc')!;
  let cum = 0;
  let price = offers[offers.length - 1]?.price ?? 0;
  for (const o of offers) {
    cum += o.mw;
    if (cum >= demand) {
      price = o.price;
      break;
    }
  }
  if (!out.has('nuc') && demand < mustRun.minOutput + wind + solar && price <= 0) price = -15;
  const margin = supply - demand;
  const scarcity = margin <= 0 ? 2000 : Math.min(2000, 1800 * Math.exp(-margin / 55));
  return { price: Math.round((price + scarcity) * 100) / 100, margin };
}

/**
 * North exports wind and hydro over a limited interface: when it's full, North's price falls to
 * the offer of the wind being turned away. Metro imports over another: beyond the limit, Metro's
 * own plants (Mill Creek, then Old Quay oil) must run and set Metro's price.
 */
function nodal(hub: number, wind: number, demand: number, gas: number, out: Set<string>) {
  const northLocal = 0.05 * demand;
  const exportNeed = wind + (out.has('hydro') ? 0 : 120) - northLocal;
  const north = exportNeed > NORTH_EXPORT_LIMIT ? Math.min(hub, -5) : hub;
  const localNeed = 0.55 * demand - METRO_IMPORT_LIMIT;
  const cc2 = out.has('cc2') ? 0 : 250;
  let metro = hub;
  if (localNeed > 0) metro = Math.max(hub, localNeed <= cc2 ? 42 * gas : 165);
  return { north: Math.round(north * 100) / 100, metro: Math.round(metro * 100) / 100 };
}

/** Generate `days` days of history. The same seed always produces the same history. */
export function marketHistory(days = 120, seed = 11): MarketDay[] {
  const r = rng(seed);
  const out: MarketDay[] = [];
  const tempNoise = ar1(r, days, 0.8, 4);
  const gasNoise = ar1(r, days, 0.95, 0.12);
  const windDay = ar1(r, days, 0.6, 0.18);
  for (let d = 0; d < days; d++) {
    const weekday = d % 7;
    const season = 18 + 9 * Math.sin((2 * Math.PI * (d - 20)) / 365);
    const temp = season + tempNoise[d];
    const weather = 1 + 0.018 * Math.max(0, temp - 22) + 0.01 * Math.max(0, 12 - temp);
    const weekend = weekday >= 5 ? 0.9 : 1;
    const gas = Math.max(0.6, 1 + gasNoise[d]);
    const windLevel = Math.max(0.15, 1 + windDay[d] * 2);
    const cloud = r() < 0.25 ? 0.45 + 0.3 * r() : 0.9 + 0.1 * r();

    const demandForecast = SYSTEM_DEMAND.map((v) => Math.round(v * weather * weekend));
    const windForecast = WIND_CF.map((cf) => Math.min(350, cf * 350 * windLevel));
    const solarForecast = SOLAR_CF.map((cf) => cf * 400 * cloud);

    const dErr = ar1(r, 24, 0.85, 0.025);
    const wErr = ar1(r, 24, 0.85, 0.25);
    const sErr = ar1(r, 24, 0.7, 0.15);
    const demand = demandForecast.map((v, h) => Math.round(v * (1 + dErr[h])));
    const wind = windForecast.map((v, h) => Math.max(0, Math.min(350, v * (1 + wErr[h]))));
    const solar = solarForecast.map((v, h) => Math.max(0, Math.min(400, v * (1 + sErr[h]))));

    const outages: string[] = [];
    const candidates = ['coal', 'cc1', 'cc2', 'ct', 'hydro'];
    if (r() < 0.12) outages.push(candidates[Math.floor(r() * candidates.length)]);
    const tripHour = Math.floor(r() * 24);

    const da: number[] = [];
    const rt: number[] = [];
    const daNorth: number[] = [];
    const rtNorth: number[] = [];
    const daMetro: number[] = [];
    const rtMetro: number[] = [];
    for (let h = 0; h < 24; h++) {
      const daC = clearHour(demandForecast[h], windForecast[h], solarForecast[h], gas, new Set());
      const outNow = new Set(h >= tripHour ? outages : []);
      const rtC = clearHour(demand[h], wind[h], solar[h], gas, outNow);
      const rtPrice = Math.round((rtC.price + gaussian(r) * 2) * 100) / 100;
      da.push(daC.price);
      rt.push(rtPrice);
      const nDa = nodal(daC.price, windForecast[h], demandForecast[h], gas, new Set());
      const nRt = nodal(rtPrice, wind[h], demand[h], gas, outNow);
      daNorth.push(nDa.north);
      rtNorth.push(nRt.north);
      daMetro.push(nDa.metro);
      rtMetro.push(nRt.metro);
    }
    out.push({ day: d, weekday, temp: Math.round(temp * 10) / 10, gas: Math.round(gas * 100) / 100, demandForecast, demand, windForecast, wind, solarForecast, solar, outages, da, rt, daNorth, rtNorth, daMetro, rtMetro });
  }
  return out;
}

let cached: MarketDay[] | null = null;

/** The course's standard 120-day history (computed once). */
export function standardHistory(): MarketDay[] {
  if (!cached) cached = marketHistory(120, 11);
  return cached;
}
