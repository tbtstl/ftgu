// A central planner vs. a market. The planner dispatches the fleet on its own estimates of each
// plant's cost; the market dispatches on offers from the owners, who know their true costs.
// Both use the same merit-order rule, so any difference in cost comes from information alone.

import { gaussian, rng } from '../../model/random';
import { clearMeritOrder, type Clearing } from './clearing';

export interface PlannerPlant {
  id: string;
  /** MW available this hour. */
  mw: number;
  /** True running cost, known to the owner, $/MWh. */
  cost: number;
}

/**
 * Standard-normal draws, one per plant, for a given seed. Estimates scale these by the error, so
 * dragging the error slider spreads the same mistakes further rather than drawing new ones.
 */
export function estimateNoise(ids: string[], seed: number): Record<string, number> {
  const r = rng(seed * 7919 + 17);
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = Math.max(-2.5, Math.min(2.5, gaussian(r)));
  return out;
}

/** The planner's estimate of each plant's cost: true cost × (1 + error × noise), never below zero. */
export function plannerEstimates(plants: PlannerPlant[], error: number, noise: Record<string, number>): Record<string, number> {
  return Object.fromEntries(plants.map((p) => [p.id, Math.max(0, p.cost * (1 + error * (noise[p.id] ?? 0)))]));
}

export interface PlannerComparison {
  planner: Clearing;
  market: Clearing;
  /** True cost of each dispatch, $/h. */
  plannerCost: number;
  marketCost: number;
  /** plannerCost − marketCost, $/h (never negative). */
  extra: number;
  /** Plants whose output differs between the two dispatches. */
  changed: string[];
  /** Pairs the planner ranks in the opposite order to their true costs. */
  misranked: Array<[string, string]>;
}

/** Dispatch the same plants twice — on the planner's estimates and on true-cost offers — and compare. */
export function comparePlannerMarket(plants: PlannerPlant[], estimates: Record<string, number>, demand: number): PlannerComparison {
  const usable = plants.filter((p) => p.mw > 1e-9);
  const planner = clearMeritOrder(
    usable.map((p) => ({ id: p.id, mw: p.mw, price: estimates[p.id] ?? p.cost })),
    demand,
  );
  const market = clearMeritOrder(
    usable.map((p) => ({ id: p.id, mw: p.mw, price: p.cost })),
    demand,
  );
  const cost = (c: Clearing) => usable.reduce((s, p) => s + p.cost * (c.dispatch[p.id] ?? 0), 0);
  const plannerCost = cost(planner);
  const marketCost = cost(market);
  const changed = usable.filter((p) => Math.abs((planner.dispatch[p.id] ?? 0) - (market.dispatch[p.id] ?? 0)) > 1e-6).map((p) => p.id);
  const misranked: Array<[string, string]> = [];
  for (let i = 0; i < usable.length; i++)
    for (let j = 0; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      if (a.cost < b.cost && (estimates[a.id] ?? a.cost) > (estimates[b.id] ?? b.cost)) misranked.push([a.id, b.id]);
    }
  return { planner, market, plannerCost, marketCost, extra: Math.max(0, plannerCost - marketCost), changed, misranked };
}

export interface DayComparison {
  plannerCost: number;
  marketCost: number;
  extra: number;
  /** Hours in which the planner's dispatch costs more. */
  costlyHours: number;
}

/** Compare the planner and the market over a day of hours, each with its own plants and demand. */
export function comparePlannerDay(hours: Array<{ plants: PlannerPlant[]; demand: number }>, error: number, noise: Record<string, number>): DayComparison {
  let plannerCost = 0;
  let marketCost = 0;
  let costlyHours = 0;
  for (const h of hours) {
    const c = comparePlannerMarket(h.plants, plannerEstimates(h.plants, error, noise), h.demand);
    plannerCost += c.plannerCost;
    marketCost += c.marketCost;
    if (c.extra > 0.5) costlyHours++;
  }
  return { plannerCost, marketCost, extra: Math.max(0, plannerCost - marketCost), costlyHours };
}

export interface ErrorSweepPoint {
  error: number;
  /** Mean extra cost over the draws, as a share of the market's cost. */
  mean: number;
  /** 10th and 90th percentiles of the extra-cost share. */
  p10: number;
  p90: number;
  /** Share of draws in which the planner's day costs no more than the market's. */
  perfect: number;
}

/** Average the day's extra cost over many sets of estimates, for each error level. */
export function plannerErrorSweep(hours: Array<{ plants: PlannerPlant[]; demand: number }>, errors: number[], draws: number, firstSeed = 1): ErrorSweepPoint[] {
  const ids = hours[0]?.plants.map((p) => p.id) ?? [];
  const noises = Array.from({ length: draws }, (_, k) => estimateNoise(ids, firstSeed + k));
  // Lean version of comparePlannerDay: same merit-order rule (ties keep input order), no bookkeeping.
  const prepared = hours.map((h) => {
    const plants = h.plants.filter((p) => p.mw > 1e-9);
    const order = plants.map((_, i) => i).sort((a, b) => plants[a].cost - plants[b].cost || a - b);
    return { plants, demand: h.demand, market: fill(plants, order, h.demand) };
  });
  const marketDay = prepared.reduce((s, h) => s + h.market, 0);
  return errors.map((error) => {
    const shares = noises.map((n) => {
      let planner = 0;
      for (const h of prepared) {
        const est = h.plants.map((p) => Math.max(0, p.cost * (1 + error * (n[p.id] ?? 0))));
        const order = h.plants.map((_, i) => i).sort((a, b) => est[a] - est[b] || a - b);
        planner += fill(h.plants, order, h.demand);
      }
      return marketDay > 0 ? Math.max(0, planner - marketDay) / marketDay : 0;
    });
    shares.sort((a, b) => a - b);
    const q = (f: number) => shares[Math.min(shares.length - 1, Math.max(0, Math.round(f * (shares.length - 1))))];
    return {
      error,
      mean: shares.reduce((s, v) => s + v, 0) / Math.max(1, shares.length),
      p10: q(0.1),
      p90: q(0.9),
      perfect: shares.filter((v) => v < 1e-7).length / Math.max(1, shares.length),
    };
  });
}

/** True cost of filling `demand` from plants taken in the given order, $/h. */
function fill(plants: PlannerPlant[], order: number[], demand: number): number {
  let left = demand;
  let cost = 0;
  for (const i of order) {
    if (left <= 1e-9) break;
    const q = Math.min(plants[i].mw, left);
    cost += q * plants[i].cost;
    left -= q;
  }
  return cost;
}
