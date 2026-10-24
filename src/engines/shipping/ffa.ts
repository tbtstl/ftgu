// Forward freight agreements: contracts on a freight index, settled in cash against the index's
// average over a future month. No ship changes hands; the buyer receives (settlement − agreed
// price) × quantity, the seller the reverse. Clearing houses mark open contracts to the forward
// curve every day and collect or pay variation margin.
//
// Our forward curve is what traders in the model expect: today's index pulled back toward its
// long-run seasonal level as the month gets further away.

import { standardHistory } from '../../model/shipping/history';
import type { ClassId } from '../../model/shipping/trades';
import { replacementEarnings, type CycleMonth } from './cycle';
import { DAYS_PER_MONTH, TC_ROUTES, dailyPath, monthAverage, routeTce, weightedIndex } from './indices';
import { equilibrium } from './market';

/** Monthly persistence of deviations from the long-run level, as traders see it. */
export const REVERSION = 0.88;

const SEASON = new Map<ClassId, number[]>();

/** Seasonal shape of earnings by calendar month (mean 1), from the baseline market. */
export function seasonalShape(id: ClassId): number[] {
  let s = SEASON.get(id);
  if (!s) {
    const v = Array.from({ length: 12 }, (_, m) => equilibrium(id, { month: m }).tce);
    const mean = v.reduce((a, b) => a + b, 0) / 12;
    s = v.map((x) => x / mean);
    SEASON.set(id, s);
  }
  return s;
}

/** The long-run level the forward curve reverts to in a given calendar month, $/day. */
export function longRun(id: ClassId, calendarMonth: number): number {
  return replacementEarnings(id) * seasonalShape(id)[calendarMonth % 12];
}

/** Equal-weighted timecharter average for a class (our stand-in for a published TC index). */
export function indexWeights(id: ClassId): number[] {
  return TC_ROUTES[id].map(() => 1);
}

/** Cached per history (by identity) and weights. */
const INDEX_CACHE = new WeakMap<CycleMonth[], Map<string, number[]>>();

/** The class's daily timecharter index over the history, $/day. */
export function dailyIndex(id: ClassId, weights = indexWeights(id), months: CycleMonth[] = standardHistory().cls[id]): number[] {
  const key = `${id}|${weights.join(',')}`;
  let byHistory = INDEX_CACHE.get(months);
  if (!byHistory) {
    byHistory = new Map();
    INDEX_CACHE.set(months, byHistory);
  }
  const hit = byHistory.get(key);
  if (hit) return hit;
  const p = dailyPath(id, 101, months);
  const routes = TC_ROUTES[id];
  const out = p.tce.map((t, d) => {
    const m = months[p.month[d]];
    // Each route's premium over the market rate this month, applied to today's rate.
    return weightedIndex(
      routes.map((r) => t + (routeTce(m, r) - m.tce) * p.noise[d]),
      weights,
    );
  });
  byHistory.set(key, out);
  return out;
}

/**
 * The forward price on index day `day` for contract month `month`: the long-run level for that
 * calendar month plus today's deviation from today's long-run level, decayed by the months between.
 */
export function forwardPrice(id: ClassId, index: number[], day: number, month: number): number {
  const nowMonth = Math.floor(day / DAYS_PER_MONTH);
  if (month < nowMonth) return monthAverage(index, month);
  const spot = index[day];
  const dev = spot - longRun(id, nowMonth);
  const ahead = Math.max(0, month + 0.5 - (day + 0.5) / DAYS_PER_MONTH);
  const expectedFuture = longRun(id, month) + dev * REVERSION ** ahead;
  if (month > nowMonth) return expectedFuture;
  // Inside the contract month, part of the average is already known.
  const start = month * DAYS_PER_MONTH;
  const known = index.slice(start, day + 1);
  const remaining = DAYS_PER_MONTH - known.length;
  return (known.reduce((a, b) => a + b, 0) + remaining * expectedFuture) / DAYS_PER_MONTH;
}

export type Side = 'buy' | 'sell';

/** Cash settlement of an FFA: (settlement − price) × days for the buyer, reversed for the seller, $. */
export function ffaSettlement(side: Side, price: number, days: number, settlement: number): number {
  return (side === 'buy' ? 1 : -1) * (settlement - price) * days;
}

/** Daily mark-to-market value of an open FFA from the day it's agreed to its settlement, $. */
export function markToMarket(id: ClassId, index: number[], entryDay: number, month: number, side: Side, price: number, days: number): Array<{ day: number; forward: number; value: number }> {
  const out: Array<{ day: number; forward: number; value: number }> = [];
  const last = (month + 1) * DAYS_PER_MONTH - 1;
  for (let d = entryDay; d <= Math.min(last, index.length - 1); d++) {
    const f = forwardPrice(id, index, d, month);
    out.push({ day: d, forward: f, value: ffaSettlement(side, price, days, f) });
  }
  return out;
}
