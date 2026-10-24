// Backtesting freight strategies on simulated histories: FFA rules traded one month ahead, an
// owner's hedge, and a bunker hedge — with commissions, and with the same rules run on other
// histories the model could have produced.

import { summarize, type PnlSummary } from '../strategy/risk';
import type { ClassId } from '../../model/shipping/trades';
import type { CycleMonth } from './cycle';
import { forecastPath, DEFAULT_ASSUMPTIONS } from './forecast';
import { DAYS_PER_MONTH, monthAverage } from './indices';
import { ffaSettlement, forwardPrice, longRun, type Side } from './ffa';

export type StrategyId = 'momentum' | 'reversion' | 'seasonal' | 'fundamental' | 'hedge';

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  momentum: 'Momentum',
  reversion: 'Mean reversion',
  seasonal: 'Harvest season',
  fundamental: 'Fundamentals',
  hedge: 'Owner’s hedge',
};

export interface BacktestOptions {
  strategy: StrategyId;
  cls: ClassId;
  /** Days of FFA traded each month. */
  days: number;
  /** Commission and clearing fees, as a share of the contract's value, charged when a trade is made. */
  cost: number;
  /** How far from the long-run level (reversion) or the forward (fundamentals) before trading. */
  threshold: number;
  /** Months to test, [from, to). */
  from: number;
  to: number;
}

export interface Trade {
  month: number;
  side: Side | null;
  price: number;
  settlement: number;
  pnl: number;
}

export interface BacktestResult {
  trades: Trade[];
  /** P&L per month, $ (zero for months without a trade). */
  pnl: number[];
  summary: PnlSummary;
  /** Share of trades that made money. */
  hitRate: number;
}

/** The side a strategy takes at the end of month t for contract month t + 1 (null = no trade). */
export function decide(o: BacktestOptions, index: number[], hist: CycleMonth[], t: number): Side | null {
  const day = (t + 1) * DAYS_PER_MONTH - 1;
  const fwd = forwardPrice(o.cls, index, day, t + 1);
  switch (o.strategy) {
    case 'momentum': {
      if (t < 1) return null;
      return monthAverage(index, t) > monthAverage(index, t - 1) ? 'buy' : 'sell';
    }
    case 'reversion': {
      const lr = longRun(o.cls, t % 12);
      const spot = index[day];
      if (spot > lr * (1 + o.threshold)) return 'sell';
      if (spot < lr * (1 - o.threshold)) return 'buy';
      return null;
    }
    case 'seasonal': {
      // Brazil's soybeans ship March to July: buy those months, sell the slack autumn.
      const next = (t + 1) % 12;
      if (next >= 2 && next <= 5) return 'buy';
      if (next >= 8 && next <= 10) return 'sell';
      return null;
    }
    case 'fundamental': {
      const f = forecastPath(o.cls, hist, t, 1, DEFAULT_ASSUMPTIONS)[0].tce;
      // The forecast is of the market rate; the index carries the routes' premiums too.
      const scale = monthAverage(index, t) / Math.max(1, hist[t].tce);
      const expected = f * scale;
      if (expected > fwd * (1 + o.threshold)) return 'buy';
      if (expected < fwd * (1 - o.threshold)) return 'sell';
      return null;
    }
    case 'hedge':
      return 'sell';
  }
}

export function backtest(o: BacktestOptions, index: number[], hist: CycleMonth[]): BacktestResult {
  const trades: Trade[] = [];
  const pnl: number[] = [];
  const last = Math.min(o.to, hist.length - 1, Math.floor(index.length / DAYS_PER_MONTH) - 1);
  for (let t = o.from; t < last; t++) {
    const side = decide(o, index, hist, t);
    const day = (t + 1) * DAYS_PER_MONTH - 1;
    const price = forwardPrice(o.cls, index, day, t + 1);
    const settlement = monthAverage(index, t + 1);
    const gross = side ? ffaSettlement(side, price, o.days, settlement) : 0;
    const fee = side ? o.cost * price * o.days : 0;
    trades.push({ month: t + 1, side, price, settlement, pnl: gross - fee });
    pnl.push(gross - fee);
  }
  const made = trades.filter((x) => x.side);
  return { trades, pnl, summary: summarize(pnl, 12), hitRate: made.length ? made.filter((x) => x.pnl > 0).length / made.length : 0 };
}

/**
 * A bunker hedge: each month, fix the price of the next month's fuel at today's price (our bunker
 * prices wander with no drift, so today's price is the fair forward). Returns the hedge's P&L by month.
 */
export function bunkerHedge(bunker: number[], tonnesPerMonth: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from; t < Math.min(to, bunker.length - 1); t++) out.push((bunker[t + 1] - bunker[t]) * tonnesPerMonth);
  return out;
}
