// Strategy engine: nodal basis — the difference between a node's price and the hub's — and two
// ways of trading it, a financial transmission right and a day-ahead spread position.
//
// "Congestion" here is the basis measured in each node's usual direction: Metro − hub for the
// import-constrained Metro node, hub − North for the export-constrained North node. Both are
// usually zero or positive, and both positions below profit when congestion is larger than expected.

import type { MarketDay } from '../../model/history';
import { ftrPayoff } from '../market/settlement';

export type BasisNode = 'north' | 'metro';
export type Market = 'da' | 'rt';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Node − hub price for each hour, $/MWh (negative when the node is cheaper). */
export function basis(day: MarketDay, node: BasisNode, market: Market): number[] {
  const nodal = node === 'north' ? (market === 'da' ? day.daNorth : day.rtNorth) : market === 'da' ? day.daMetro : day.rtMetro;
  const hub = market === 'da' ? day.da : day.rt;
  return nodal.map((p, h) => p - hub[h]);
}

/** Congestion in the node's usual direction: what an FTR from the cheap end to the dear end pays, per MW. */
export function congestion(day: MarketDay, node: BasisNode, market: Market): number[] {
  const nodal = node === 'north' ? (market === 'da' ? day.daNorth : day.rtNorth) : market === 'da' ? day.daMetro : day.rtMetro;
  const hub = market === 'da' ? day.da : day.rt;
  return HOURS.map((h) => (node === 'north' ? ftrPayoff(1, nodal[h], hub[h]) : ftrPayoff(1, hub[h], nodal[h])));
}

export type ConditionKind = 'all' | 'windy' | 'demand' | 'outage';

export interface Condition {
  kind: ConditionKind;
  /** Windy: daily mean wind forecast ≥ level MW. Demand: peak demand forecast ≥ level MW. */
  level: number;
}

/** Mean of the day's hourly wind forecast, MW. */
export function meanWindForecast(day: MarketDay): number {
  return day.windForecast.reduce((s, x) => s + x, 0) / day.windForecast.length;
}

export function matches(day: MarketDay, c: Condition): boolean {
  if (c.kind === 'windy') return meanWindForecast(day) >= c.level;
  if (c.kind === 'demand') return Math.max(...day.demandForecast) >= c.level;
  if (c.kind === 'outage') return day.outages.length > 0;
  return true;
}

/** Is the condition known before the day-ahead market closes? Forced outages happen in real time. */
export function knownDayAhead(c: Condition): boolean {
  return c.kind !== 'outage';
}

/** Average of a per-hour series over a set of days; zeros when the set is empty. */
export function meanByHour(days: MarketDay[], f: (d: MarketDay) => number[]): number[] {
  if (!days.length) return Array<number>(24).fill(0);
  const sum = Array<number>(24).fill(0);
  for (const d of days) f(d).forEach((v, h) => (sum[h] += v));
  return sum.map((s) => s / days.length);
}

/**
 * Daily P&L of a financial transmission right in the congestion direction, held in `hours` on
 * every day, bought at `price` $/MWh (per MW per hour covered). It settles on day-ahead prices.
 */
export function ftrDaily(days: MarketDay[], node: BasisNode, hours: number[], mw: number, price: number): number[] {
  return days.map((d) => {
    const c = congestion(d, node, 'da');
    return hours.reduce((s, h) => s + mw * (c[h] - price), 0);
  });
}

/**
 * Daily P&L of a day-ahead spread position in the congestion direction — buy the dear end and
 * sell the cheap end day-ahead, reverse both in real time — on days matching the condition.
 * It earns real-time congestion minus day-ahead congestion. Each MWh pays `costPerMWh` on each
 * of its two legs. Days that don't match are zero.
 */
export function spreadPositionDaily(days: MarketDay[], node: BasisNode, hours: number[], mw: number, c: Condition, costPerMWh: number): number[] {
  return days.map((d) => {
    if (!matches(d, c)) return 0;
    const da = congestion(d, node, 'da');
    const rt = congestion(d, node, 'rt');
    return hours.reduce((s, h) => s + mw * (rt[h] - da[h]) - 2 * costPerMWh * mw, 0);
  });
}
