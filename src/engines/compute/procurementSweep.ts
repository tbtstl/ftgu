// A fast companion to procurement.ts for drawing whole curves: the annual cost of every reservation
// level at once, for the same simulated years procure() draws. The growth paths don't depend on the
// reservation, so they are drawn once (in exactly procure()'s order, from the same seed); each
// month's on-demand overflow then comes from prefix sums over the week's sorted shape instead of a
// loop. The results agree with procure() to rounding.

import { gaussian, rng } from '../../model/random';
import { WEEK_SHAPE, monthNeed, type ProcurementParams } from './procurement';

/** Hours in a month, as procurement.ts counts them. */
export const SWEEP_HOURS_PER_MONTH = 730;

/** PREFIX[k] = sum of the k largest shares of the busiest hour. */
const PREFIX: number[] = WEEK_SHAPE.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + s], [0]);

/** On-demand GPU-hours in a month: the same quantity as monthOverflow(), by binary search. */
export function fastOverflow(peak: number, reserved: number): number {
  if (peak <= 0) return 0;
  // Count the shares strictly above the level (WEEK_SHAPE is sorted from largest to smallest).
  let lo = 0;
  let hi = WEEK_SHAPE.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (WEEK_SHAPE[mid] * peak > reserved) lo = mid + 1;
    else hi = mid;
  }
  const k = lo;
  return ((peak * PREFIX[k] - k * reserved) * SWEEP_HOURS_PER_MONTH) / WEEK_SHAPE.length;
}

/** The busiest-hour need in every month of every simulated year, drawn exactly as procure() draws them. */
export function growthPaths(p: Pick<ProcurementParams, 'peakNow' | 'growth' | 'sigma' | 'months' | 'scenarios' | 'seed'>): number[][] {
  const r = rng(p.seed ?? 9);
  const paths: number[][] = [];
  for (let s = 0; s < p.scenarios; s++) {
    let peak = p.peakNow;
    const path: number[] = [];
    for (let m = 0; m < p.months; m++) {
      if (m > 0) peak *= Math.exp(Math.log(1 + p.growth) - (p.sigma * p.sigma) / 2 + p.sigma * gaussian(r));
      path.push(peak);
    }
    paths.push(path);
  }
  return paths;
}

export interface SweepPoint {
  reserved: number;
  /** Mean annual cost, $. */
  mean: number;
  /** The cost a year reaches or exceeds one time in twenty (procure()'s p95), $. */
  p95: number;
}

/** Mean and 95th-percentile annual cost for each reservation level in `levels`. */
export function procurementSweep(p: ProcurementParams, levels: number[]): SweepPoint[] {
  const paths = growthPaths(p);
  const spot = p.interruptible * SWEEP_HOURS_PER_MONTH * p.months * p.spotEffective;
  return levels.map((reserved) => {
    const costs = paths.map((path) => {
      let cost = spot;
      for (const peak of path) cost += reserved * SWEEP_HOURS_PER_MONTH * p.reservedPrice + fastOverflow(peak, reserved) * p.onDemandPrice;
      return cost;
    });
    costs.sort((a, b) => a - b);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    return { reserved, mean, p95: costs[Math.min(costs.length - 1, Math.floor(0.95 * costs.length))] };
  });
}

/** Firm GPU-hours the buyer needs over the year, averaged across the simulated years. */
export function meanFirmHours(p: ProcurementParams): number {
  const paths = growthPaths(p);
  return paths.reduce((s, path) => s + path.reduce((t, peak) => t + monthNeed(peak), 0), 0) / paths.length;
}
