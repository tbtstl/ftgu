// Strategy building blocks on the simulated history: period charters against spot, spreads between
// classes and routes, and "what if" re-runs of a month's market with its physical drivers changed.

import type { Chokepoint } from '../../model/shipping/geo';
import { OFF_HIRE_DAYS, type ClassId } from '../../model/shipping/trades';
import type { CycleEvent, CycleMonth } from './cycle';
import { sharesAt } from './forecast';
import { DAYS_PER_MONTH, monthAverage, routeTce, TC_ROUTES } from './indices';
import { equilibrium } from './market';
import { forwardPrice } from './ffa';

const MONTH_DAYS = 365 / 12;
const EARN = (365 - OFF_HIRE_DAYS) / 365;

export interface Drivers {
  /** Multiplier on cargo volumes. */
  demand?: number;
  /** Multiplier on the fleet (e.g. 1.05 = an extra 5% of ships delivered). */
  fleet?: number;
  congestion?: Record<string, number>;
  closed?: Chokepoint[];
  /** Multipliers on particular routes. */
  routeScale?: Record<string, number>;
  /** Bunker price override, $/t. */
  bunker?: number;
}

/**
 * The market earnings a month of the history would have had with its physical drivers changed:
 * the month's own equilibrium re-solved, applied as a ratio to what actually happened (so the
 * day-to-day noise and anything the static model leaves out carry over).
 */
export function whatIf(id: ClassId, m: CycleMonth, d: Drivers, event?: CycleEvent): number {
  const base = {
    demand: m.demand,
    month: m.month,
    fleet: m.fleet,
    bunker: m.bunker,
    cohortShares: sharesAt(m),
    routeScale: event?.routeScale,
    closed: event?.closed,
    congestion: event?.congestion,
  };
  const plain = equilibrium(id, base).tce;
  const changed = equilibrium(id, {
    ...base,
    demand: m.demand * (d.demand ?? 1),
    fleet: m.fleet * (d.fleet ?? 1),
    bunker: d.bunker ?? m.bunker,
    // A dial acts on top of the month's own events: extra days add to its congestion, and a
    // route's scale multiplies its event scale (so Brazil's ore at 70% during a disruption that
    // already cut it to 60% leaves 42%, not 70%).
    congestion: combine(event?.congestion, d.congestion, (a, b) => a + b, 0),
    closed: [...(event?.closed ?? []), ...(d.closed ?? [])],
    routeScale: combine(event?.routeScale, d.routeScale, (a, b) => a * b, 1),
  }).tce;
  return plain > 0 ? m.tce * (changed / plain) : changed;
}

function combine(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
  op: (x: number, y: number) => number,
  unit: number,
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = op(out[k] ?? unit, v);
  return out;
}

export interface PeriodResult {
  /** Hire fixed for the period, $/day. */
  hire: number;
  /** Spot earnings month by month, $/day. */
  spot: number[];
  /** Profit to whoever chartered the ship in and traded her spot, month by month, $. */
  monthly: number[];
  total: number;
}

/**
 * Charter a ship in for `months` months from the start of month `t + 1`, at a hire set at day
 * `t × 21` from the forward curve (average of the period's forward prices) less `discount`; trade
 * her on the spot market at the index each month. Spot can be replaced by a what-if path.
 */
export function periodCharter(id: ClassId, index: number[], t: number, months: number, discount = 0, spotOverride?: number[]): PeriodResult {
  const day = t * DAYS_PER_MONTH + DAYS_PER_MONTH - 1;
  const fwd = Array.from({ length: months }, (_, k) => forwardPrice(id, index, day, t + 1 + k));
  const hire = (fwd.reduce((a, b) => a + b, 0) / months) * (1 - discount);
  const spot = Array.from({ length: months }, (_, k) => spotOverride?.[k] ?? monthAverage(index, t + 1 + k));
  const monthly = spot.map((s) => (s * EARN - hire * EARN) * MONTH_DAYS);
  return { hire, spot, monthly, total: monthly.reduce((a, b) => a + b, 0) };
}

/** A route's monthly earnings over the history, $/day. */
export function routeSeries(hist: CycleMonth[], routeId: string, cls: ClassId): number[] {
  const r = TC_ROUTES[cls].find((x) => x.id === routeId);
  if (!r) throw new Error(`Unknown route ${routeId}`);
  return hist.map((m) => routeTce(m, r));
}

export interface SpreadResult {
  /** Spread (long leg minus short leg) at entry and exit, $/day. */
  entry: number;
  exit: number;
  /** Profit on `days` days of each leg, $. */
  pnl: number;
  path: number[];
}

/** Long one monthly series and short another from month `from` to `to`, `days` days a leg. */
export function spreadTrade(longLeg: number[], shortLeg: number[], from: number, to: number, days: number): SpreadResult {
  const path = longLeg.map((v, i) => v - shortLeg[i]);
  const entry = path[from];
  const exit = path[to];
  return { entry, exit, pnl: (exit - entry) * days, path };
}
