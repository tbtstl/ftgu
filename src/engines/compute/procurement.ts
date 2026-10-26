// Buying capacity for a year when next year's need is uncertain. A buyer commits now to some reserved
// GPUs (paid every hour), buys on demand above that, and runs its interruptible work on spot at a
// price that depends on how well that work survives interruption (Lesson 5.4). Demand follows the
// daily shape of Lesson 5.3 and grows month by month at an uncertain rate; many simulated years show
// the average cost and how bad an unlucky year can be. All prices simulated.

import { rng, gaussian } from '../../model/random';
import { PRICES } from '../../model/compute/prices';
import { DEMAND_DEFAULTS, weeklyDemand } from './demand';

/** The shape of a week of need, sorted from busiest hour to quietest, as shares of the busiest. */
export const WEEK_SHAPE: number[] = (() => {
  const d = weeklyDemand({ ...DEMAND_DEFAULTS, weeks: 1, growthPerWeek: 0 });
  const peak = Math.max(...d.inference);
  return d.inference.map((x) => x / peak).sort((a, b) => b - a);
})();

const HOURS_PER_MONTH = 730;

export interface ProcurementParams {
  /** Need at the busiest hour in month 0, GPUs (firm, uninterruptible work). */
  peakNow: number;
  /** Average growth per month, and its uncertainty (standard deviation per month). */
  growth: number;
  sigma: number;
  /** GPUs reserved for the year. */
  reserved: number;
  /** Average interruptible GPUs each hour (batch work that can run on spot). */
  interruptible: number;
  /** Effective spot price per useful GPU-hour, after interruptions ($; Lesson 5.4). */
  spotEffective: number;
  reservedPrice: number;
  onDemandPrice: number;
  months: number;
  scenarios: number;
  seed?: number;
}

export const PROCUREMENT_DEFAULTS: ProcurementParams = {
  peakNow: 400,
  growth: 0.04,
  sigma: 0.05,
  reserved: 300,
  interruptible: 100,
  spotEffective: 1.03,
  reservedPrice: PRICES.A.reserved,
  onDemandPrice: PRICES.A.onDemand,
  months: 12,
  scenarios: 400,
  seed: 9,
};

/** On-demand GPU-hours in a month whose busiest hour needs `peak`, with `reserved` GPUs committed. */
export function monthOverflow(peak: number, reserved: number): number {
  let over = 0;
  for (const s of WEEK_SHAPE) {
    const need = peak * s;
    if (need <= reserved) break;
    over += need - reserved;
  }
  return (over * HOURS_PER_MONTH) / WEEK_SHAPE.length;
}

/** Firm GPU-hours needed in a month. */
export function monthNeed(peak: number): number {
  return (peak * WEEK_SHAPE.reduce((s, x) => s + x, 0) * HOURS_PER_MONTH) / WEEK_SHAPE.length;
}

export interface ProcurementResult {
  /** Annual cost in each scenario, sorted ascending. */
  costs: number[];
  mean: number;
  p95: number;
  /** Mean cost per useful GPU-hour (firm and interruptible). */
  perUsefulHour: number;
  /** Mean share of reserved hours left idle. */
  idleShare: number;
  /** Mean busiest-hour need in the last month. */
  finalPeak: number;
}

/** Simulate many years. Each scenario draws a monthly growth path; spot work costs the same in all. */
export function procure(p: ProcurementParams): ProcurementResult {
  const r = rng(p.seed ?? 9);
  const costs: number[] = [];
  let useful = 0;
  let idle = 0;
  let reservedHours = 0;
  let finalPeak = 0;
  const spotHours = p.interruptible * HOURS_PER_MONTH * p.months;
  for (let s = 0; s < p.scenarios; s++) {
    let peak = p.peakNow;
    let cost = 0;
    for (let m = 0; m < p.months; m++) {
      if (m > 0) peak *= Math.exp(Math.log(1 + p.growth) - (p.sigma * p.sigma) / 2 + p.sigma * gaussian(r));
      const need = monthNeed(peak);
      const over = monthOverflow(peak, p.reserved);
      const resHours = p.reserved * HOURS_PER_MONTH;
      cost += resHours * p.reservedPrice + over * p.onDemandPrice;
      useful += need;
      idle += Math.max(0, resHours - (need - over));
      reservedHours += resHours;
    }
    cost += spotHours * p.spotEffective;
    useful += spotHours;
    costs.push(cost);
    finalPeak += peak;
  }
  costs.sort((a, b) => a - b);
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  return {
    costs,
    mean,
    p95: costs[Math.min(costs.length - 1, Math.floor(0.95 * costs.length))],
    perUsefulHour: (mean * p.scenarios) / useful,
    idleShare: reservedHours > 0 ? idle / reservedHours : 0,
    finalPeak: finalPeak / p.scenarios,
  };
}

/** The reservation (in steps of `step` GPUs) with the lowest mean annual cost. */
export function bestReserved(p: ProcurementParams, max = 1500, step = 10): { reserved: number; mean: number } {
  let best = { reserved: 0, mean: Infinity };
  for (let res = 0; res <= max; res += step) {
    const m = procure({ ...p, reserved: res, scenarios: Math.min(p.scenarios, 200) }).mean;
    if (m < best.mean) best = { reserved: res, mean: m };
  }
  return best;
}
