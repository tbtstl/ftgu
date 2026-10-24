// One weather view, three markets. A forecast that next week will be colder than the market
// expects can be expressed in Calder Bay HDD futures, in next week's city-gate gas, or in next
// week's power — and each responds to the same degrees differently. Degree days respond
// linearly (below 65 °F); gas responds hardly at all until the pipelines fill and then
// violently; power follows gas and demand. Each market also has its own costs and limits.
//
// Prices as a function of a day's temperature come from the Weather-Energy Model (energyDay),
// tabulated once per setting of the physical drivers; expected values average them over the
// forecast's uncertainty, with day-to-day forecast errors correlated across the week. All
// prices are simulated.

import { gaussian, rng } from '../../model/random';
import { GAS_SYSTEM, energyDay } from './energyMarket';
import { hdd } from './degreeDays';

export interface PhysicalDrivers {
  /** Pipeline capacity into the region, MMBtu per day. */
  pipeline: number;
  /** Mean wind on Hollin Ridge for the week, m/s. */
  windMs: number;
}

export const DRIVER_DEFAULTS: PhysicalDrivers = { pipeline: GAS_SYSTEM.pipeline, windMs: 7.5 };

export interface PriceCurves {
  temps: number[];
  /** City-gate gas price, $/MMBtu. */
  gas: number[];
  /** Day's demand-weighted average power price, $/MWh. */
  power: number[];
}

const curveCache = new Map<string, PriceCurves>();

/** Gas and power prices for a January day at each temperature from −20 to 70 °F, for a setting of the drivers. */
export function priceCurves(dr: PhysicalDrivers): PriceCurves {
  const key = `${dr.pipeline}|${dr.windMs}`;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const temps: number[] = [];
  const gas: number[] = [];
  const power: number[] = [];
  for (let t = -20; t <= 70; t += 2) {
    const e = energyDay({ doy: 20, meanF: t, windMs: dr.windMs, cloud: 0.4 }, { ...GAS_SYSTEM, pipeline: dr.pipeline });
    temps.push(t);
    gas.push(e.gas);
    power.push(e.avgPrice);
  }
  const c = { temps, gas, power };
  if (curveCache.size > 60) curveCache.clear();
  curveCache.set(key, c);
  return c;
}

/** Linear interpolation on a curve. */
export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = Math.min(xs.length - 2, Math.floor((x - xs[0]) / (xs[1] - xs[0])));
  const f = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * f;
}

export type InstrumentId = 'hdd' | 'gas' | 'power';

export interface Instrument {
  id: InstrumentId;
  name: string;
  /** What one unit is. */
  unit: string;
  /** Units of the underlying per contract over the week: index points, MMBtu or MWh. */
  quantity: number;
  /** Half the bid–ask spread, in the underlying's price units. */
  halfSpread: number;
  /** The most the market will absorb, contracts. */
  maxSize: number;
}

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  hdd: { id: 'hdd', name: 'Calder Bay HDD future', unit: '$20 per degree day', quantity: 20, halfSpread: 5, maxSize: 50 },
  gas: { id: 'gas', name: 'City-gate gas, next week', unit: '10,000 MMBtu a day for 7 days', quantity: 70_000, halfSpread: 0.15, maxSize: 40 },
  power: { id: 'power', name: 'Power, next week, all hours', unit: '25 MW for 168 hours', quantity: 4_200, halfSpread: 1.5, maxSize: 40 },
};

export interface DayForecast {
  /** Expected daily mean temperature, °F. */
  mean: number;
  /** Forecast error standard deviation, °F. */
  sd: number;
}

export interface WeekValue {
  /** Expected HDD over the week. */
  hdd: number;
  /** Expected average gas price over the week, $/MMBtu. */
  gas: number;
  /** Expected average power price over the week, $/MWh. */
  power: number;
  /** Standard deviations of the same, over the forecast's uncertainty. */
  hddSd: number;
  gasSd: number;
  powerSd: number;
}

/**
 * The week's expected HDD, gas and power under a forecast shifted by `shiftF` (°F), by simulation:
 * each path draws forecast errors for the seven days with a day-to-day correlation of 0.7.
 */
export function weekValue(days: DayForecast[], shiftF: number, dr: PhysicalDrivers, paths = 400, seed = 3): WeekValue {
  const c = priceCurves(dr);
  const r = rng(seed);
  const acc = { hdd: [] as number[], gas: [] as number[], power: [] as number[] };
  for (let p = 0; p < paths; p++) {
    let e = gaussian(r);
    let h = 0;
    let g = 0;
    let w = 0;
    days.forEach((d, i) => {
      if (i > 0) e = 0.7 * e + Math.sqrt(1 - 0.49) * gaussian(r);
      const t = d.mean + shiftF + d.sd * e;
      h += hdd(t);
      g += interp(c.temps, c.gas, t);
      w += interp(c.temps, c.power, t);
    });
    acc.hdd.push(h);
    acc.gas.push(g / days.length);
    acc.power.push(w / days.length);
  }
  const ms = (xs: number[]) => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return [m, Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length)];
  };
  const [hm, hs] = ms(acc.hdd);
  const [gm, gs] = ms(acc.gas);
  const [pm, ps] = ms(acc.power);
  return { hdd: hm, gas: gm, power: pm, hddSd: hs, gasSd: gs, powerSd: ps };
}

export interface TradeIdea {
  instrument: Instrument;
  /** Expected price change from the market's view to ours, in the underlying's units. */
  edge: number;
  /** Expected P&L per contract before costs, $. */
  grossPerContract: number;
  /** Spread paid per contract, $. */
  costPerContract: number;
  /** Expected P&L per contract after costs, $. */
  netPerContract: number;
  /** Standard deviation of P&L per contract if held to settlement, $. */
  riskPerContract: number;
  /** Net over risk. */
  ratio: number;
}

/**
 * The market prices next week from `days` as it stood; we know the forecast has shifted by
 * `revisionF`. For each instrument: the edge, its cost and its risk, per contract.
 */
export function crossMarketIdeas(days: DayForecast[], revisionF: number, dr: PhysicalDrivers): TradeIdea[] {
  const before = weekValue(days, 0, dr);
  const after = weekValue(days, revisionF, dr);
  const pick = (id: InstrumentId, b: number, a: number, risk: number): TradeIdea => {
    const ins = INSTRUMENTS[id];
    const edge = a - b;
    const gross = Math.abs(edge) * ins.quantity;
    const cost = ins.halfSpread * ins.quantity;
    const net = gross - cost;
    const riskPer = risk * ins.quantity;
    return { instrument: ins, edge, grossPerContract: gross, costPerContract: cost, netPerContract: net, riskPerContract: riskPer, ratio: riskPer > 0 ? net / riskPer : 0 };
  };
  return [pick('hdd', before.hdd, after.hdd, after.hddSd), pick('gas', before.gas, after.gas, after.gasSd), pick('power', before.power, after.power, after.powerSd)];
}
