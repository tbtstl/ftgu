// A business's weather exposure set against the winter heating-degree-day index of the region:
// the business's cash flow and the index, winter by winter over the simulated archive; the
// least-squares slope (dollars per degree day); and the number of $20 seasonal strips that
// leaves the smallest spread. Used by the capstone, in whatever region the reader built.

import type { WorldKnobs } from '../../model/weather/archive';
import { farmYears, regress, utilityWinters, winterHdd, windYears } from './exposure';
import { CME_TICK } from './pricing';

export type BusinessKind = 'utility' | 'wind' | 'farm';

export interface ExposureSeries {
  /** Winter numbers: November of year w to March of year w + 1. */
  winters: number[];
  /** The region's winter HDD at the settlement station. */
  hdd: number[];
  /**
   * The business's cash in the same winters, $: the utility's winter margin; for the wind farm
   * and the corn farm, the result of the year that starts that January.
   */
  cash: number[];
}

const cache = new Map<string, ExposureSeries>();

/**
 * The series for a business at a scale. The farm keeps Marlow's own climate: of the region's
 * knobs only its variability and trend reach it (the region's climate belongs to its city).
 */
export function exposureSeries(kind: BusinessKind, scale: number, knobs: WorldKnobs, regionKey: string): ExposureSeries {
  const key = `${kind}|${regionKey}`;
  let base = cache.get(key);
  if (!base) {
    const winters = Array.from({ length: 40 }, (_, i) => i + 1);
    const hdd = winters.map((w) => winterHdd(w, knobs));
    let cash: number[];
    if (kind === 'utility') cash = utilityWinters(knobs).map((u) => u.margin);
    else if (kind === 'wind') {
      const all = windYears();
      cash = winters.map((w) => all[w].revenue);
    } else {
      const all = farmYears(0.02, { variability: knobs.variability, trend: knobs.trend });
      cash = winters.map((w) => all[w].profit);
    }
    base = { winters, hdd, cash };
    if (cache.size > 60) cache.clear();
    cache.set(key, base);
  }
  return { winters: base.winters, hdd: base.hdd, cash: base.cash.map((c) => c * scale) };
}

export interface HedgeFit {
  /** Dollars of cash per heating degree day. */
  slope: number;
  r2: number;
  /** Strips that minimize the hedged spread: slope ÷ $20. */
  strips: number;
  /** Standard deviation of the cash from winter to winter, $. */
  cashSd: number;
  /** What's left at the best hedge, $. */
  residualSd: number;
}

export function hedgeFit(s: ExposureSeries, tick = CME_TICK): HedgeFit {
  const r = regress(s.hdd, s.cash);
  const n = s.cash.length;
  const mc = s.cash.reduce((a, b) => a + b, 0) / n;
  const cashSd = Math.sqrt(s.cash.reduce((a, b) => a + (b - mc) ** 2, 0) / n);
  return { slope: r.slope, r2: r.r2, strips: r.slope / tick, cashSd, residualSd: cashSd * Math.sqrt(Math.max(0, 1 - r.r2)) };
}

/**
 * Spread of the cash after selling `strips` seasonal strips at a fixed level (the index's
 * average): each strip pays $20 for every degree day the winter falls short of it.
 */
export function hedgedSpread(s: ExposureSeries, strips: number, tick = CME_TICK): number {
  const n = s.cash.length;
  const mh = s.hdd.reduce((a, b) => a + b, 0) / n;
  const hedged = s.cash.map((c, i) => c + strips * tick * (mh - s.hdd[i]));
  const m = hedged.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(hedged.reduce((a, b) => a + (b - m) ** 2, 0) / n);
}
