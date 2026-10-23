// Demand response and load shifting (Lesson 3.5).
//
// A few flexible loads are modeled as blocks: a fixed power for a fixed number of hours (so a
// fixed energy), which can start anywhere inside an allowed window. Moving a block changes when the
// energy is used, never how much. The reference day's demand already contains every block at its
// usual time, so the rest of the load (the base) is SYSTEM_DEMAND minus the blocks.
//
// A second model builds the charging load of a fleet of electric cars under three policies, to show
// how a price signal that everyone answers at once creates a new peak.

import { standardHistory } from '../../model/history';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

export interface FlexBlock {
  id: string;
  name: string;
  /** Who it belongs to, for the label. */
  sector: 'Residential' | 'Industrial' | 'Commercial';
  mw: number;
  hours: number;
  /** Allowed window: may start at `earliest` (hour of day) and must finish by `latest` (hours; may exceed 24 to cross midnight). */
  earliest: number;
  latest: number;
  /** Where it runs if nobody shifts it. */
  usual: number;
}

/** Illustrative flexible loads in the course region. Energy = mw × hours. */
export const FLEX_BLOCKS: FlexBlock[] = [
  { id: 'ev', name: 'EV charging', sector: 'Residential', mw: 90, hours: 3, earliest: 17, latest: 31, usual: 18 },
  { id: 'water', name: 'Water heating', sector: 'Residential', mw: 40, hours: 3, earliest: 9, latest: 21, usual: 17 },
  { id: 'batch', name: 'Batch process', sector: 'Industrial', mw: 100, hours: 4, earliest: 6, latest: 22, usual: 13 },
  { id: 'cool', name: 'Pre-cooling', sector: 'Commercial', mw: 60, hours: 3, earliest: 11, latest: 19, usual: 16 },
];

/** Starts each block can take, in its window (hours of day, possibly ≥ 24 for blocks that cross midnight). */
export function allowedStarts(b: FlexBlock): number[] {
  const out: number[] = [];
  for (let s = b.earliest; s + b.hours <= b.latest; s++) out.push(s);
  return out;
}

/** Clamp a requested start into the block's window. */
export function clampStart(b: FlexBlock, start: number): number {
  return Math.max(b.earliest, Math.min(b.latest - b.hours, Math.round(start)));
}

/** Hourly MW of one block starting at `start` (wraps past midnight). */
export function blockProfile(b: FlexBlock, start: number): number[] {
  const out = Array<number>(24).fill(0);
  for (let k = 0; k < b.hours; k++) out[(start + k) % 24] += b.mw;
  return out;
}

/** The inflexible rest of demand: the reference day minus every block at its usual time. */
export function baseLoad(blocks: FlexBlock[] = FLEX_BLOCKS, demand: number[] = SYSTEM_DEMAND): number[] {
  const out = [...demand];
  for (const b of blocks) blockProfile(b, b.usual).forEach((v, h) => (out[h] -= v));
  return out;
}

export type Starts = Record<string, number>;

export function usualStarts(blocks: FlexBlock[] = FLEX_BLOCKS): Starts {
  return Object.fromEntries(blocks.map((b) => [b.id, b.usual]));
}

/** System load with the blocks at the given starts. */
export function systemLoad(base: number[], blocks: FlexBlock[], starts: Starts): number[] {
  const out = [...base];
  for (const b of blocks) blockProfile(b, clampStart(b, starts[b.id] ?? b.usual)).forEach((v, h) => (out[h] += v));
  return out;
}

/** Cost of each block's energy at hourly prices, $. */
export function blockCost(b: FlexBlock, start: number, prices: number[]): number {
  return blockProfile(b, start).reduce((s, v, h) => s + v * prices[h], 0);
}

/**
 * Placement that minimizes the system peak, breaking ties by the blocks' energy cost and then by
 * staying close to the usual times. Exhaustive over every allowed start (a few thousand combinations).
 */
export function flatten(base: number[], blocks: FlexBlock[], prices: number[]): Starts {
  const options = blocks.map((b) => allowedStarts(b).map((s) => ({ s, prof: blockProfile(b, s), cost: blockCost(b, s, prices), dist: Math.abs(s - b.usual) })));
  let best: { peak: number; cost: number; dist: number; starts: number[] } | null = null;
  const load = [...base];
  const chosen: number[] = [];
  const rec = (i: number, cost: number, dist: number) => {
    if (i === blocks.length) {
      const peak = Math.max(...load);
      const better =
        !best || peak < best.peak - 1e-9 || (Math.abs(peak - best.peak) <= 1e-9 && (cost < best.cost - 1e-6 || (Math.abs(cost - best.cost) <= 1e-6 && dist < best.dist)));
      if (better) best = { peak, cost, dist, starts: [...chosen] };
      return;
    }
    for (const o of options[i]) {
      for (let h = 0; h < 24; h++) load[h] += o.prof[h];
      chosen.push(o.s);
      rec(i + 1, cost + o.cost, dist + o.dist);
      chosen.pop();
      for (let h = 0; h < 24; h++) load[h] -= o.prof[h];
    }
  };
  rec(0, 0, 0);
  const b = best as { starts: number[] } | null;
  return Object.fromEntries(blocks.map((blk, i) => [blk.id, b ? b.starts[i] : blk.usual]));
}

let priceCache: { day: number; prices: number[] } | null = null;

/**
 * Day-ahead prices of the history day that most resembles the reference day: a weekday with the
 * reference demand forecast, no outages, and wind, solar and gas prices closest to normal.
 */
export function referencePrices(): { day: number; prices: number[] } {
  if (priceCache) return priceCache;
  const h = standardHistory();
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const windRef = sum(WIND_CF) * 350;
  const solarRef = sum(SOLAR_CF) * 400;
  const cands = h.filter((d) => d.weekday < 5 && d.outages.length === 0 && d.demandForecast.every((v, i) => v === SYSTEM_DEMAND[i]));
  const score = (d: (typeof h)[number]) => Math.abs(d.gas - 1) + Math.abs(sum(d.windForecast) / windRef - 1) + Math.abs(sum(d.solarForecast) / solarRef - 1);
  const best = cands.reduce((b, d) => (score(d) < score(b) ? d : b), cands[0]);
  priceCache = { day: best.day, prices: [...best.da] };
  return priceCache;
}

// ---------------------------------------------------------------------------
// A fleet of electric cars charging overnight.

export type ChargePolicy = 'arrival' | 'timer' | 'smart';

export interface EvFleet {
  cars: number;
  /** Energy each car needs per day, kWh. */
  kWhEach: number;
  /** Charger power, kW. */
  chargerKW: number;
  /** Off-peak tariff start for timers, hour of day. */
  timerStart: number;
  /** Cars must be charged by this hour (next morning). */
  readyBy: number;
}

export const EV_FLEET: EvFleet = { cars: 40000, kWhEach: 12, chargerKW: 7.2, timerStart: 23, readyBy: 7 };

/** Share of cars arriving home in each hour from 15:00 to 22:00 (an illustrative evening commute). */
const ARRIVALS: Array<[number, number]> = [
  [15, 0.06],
  [16, 0.12],
  [17, 0.22],
  [18, 0.24],
  [19, 0.16],
  [20, 0.1],
  [21, 0.06],
  [22, 0.04],
];

/**
 * Hourly charging load of the fleet, MW. "arrival": each car charges at full power as soon as it
 * gets home. "timer": every car waits for the off-peak start and then charges at full power.
 * "smart": the charging is spread so the fleet's load fills the night as evenly as possible,
 * between the timer start and the ready-by hour.
 */
export function evLoad(f: EvFleet, policy: ChargePolicy): number[] {
  const out = Array<number>(24).fill(0);
  const fullMW = (f.cars * f.chargerKW) / 1000;
  const totalMWh = (f.cars * f.kWhEach) / 1000;
  const hoursNeeded = f.kWhEach / f.chargerKW;
  const addBlock = (start: number, share: number) => {
    // Charging from `start` (fractional hours allowed) for hoursNeeded at full power.
    let t = start;
    let left = hoursNeeded;
    while (left > 1e-9) {
      const h = Math.floor(t);
      const span = Math.min(left, h + 1 - t);
      out[((h % 24) + 24) % 24] += fullMW * share * span;
      t += span;
      left -= span;
    }
  };
  if (policy === 'arrival') {
    // Arrivals spread evenly within each hour: approximate with four quarter-hour cohorts.
    for (const [h, share] of ARRIVALS) for (let q = 0; q < 4; q++) addBlock(h + q / 4 + 0.125, share / 4);
  } else if (policy === 'timer') {
    addBlock(f.timerStart, 1);
  } else {
    const span = (f.readyBy - f.timerStart + 24) % 24 || 24;
    for (let k = 0; k < span; k++) out[(f.timerStart + k) % 24] += totalMWh / span;
  }
  return out;
}
