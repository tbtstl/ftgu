// Strategy engine: a backtesting laboratory. Three strategies from the chapter, a common
// walk-forward harness, risk limits, and in-sample / out-of-sample comparisons.

import type { MarketDay } from '../../model/history';
import { congestion } from './basis';
import { forecastBatteryPnL } from './batteryTrading';
import { walkForward } from './risk';
import { forecastSpreads, settleVirtuals, virtualPositions } from './spreads';

export type LabStrategy = 'spread' | 'basis' | 'battery';

export interface LabParams {
  strategy: LabStrategy;
  /** Days of history behind each decision (fewer at the very start, while history accumulates). */
  window: number;
  /** Cost per MWh traded, $ (each leg of a spread position pays it). */
  costPerMWh: number;
  /** Position limit: MW per hour for virtuals and spread positions, MW of power for the battery. */
  mw: number;
  /** Trade only when the forecast edge exceeds this, $/MWh (virtual and basis strategies). */
  threshold: number;
}

/** First day every strategy trades, so that all lookback windows are judged on the same days. */
export const LAB_START = 10;
/** Days before this index are in-sample (the first half of the 120-day history). */
export const LAB_SPLIT = 60;
/** Wear cost assumed for the lab's battery, $/MWh discharged. */
export const LAB_BATTERY_WEAR = 5;

function decideAndSettle(past: MarketDay[], today: MarketDay, p: LabParams): number {
  if (p.strategy === 'spread') {
    const pos = virtualPositions(forecastSpreads(past, 'mean'), p.threshold, p.mw);
    return settleVirtuals(pos, today, p.costPerMWh);
  }
  if (p.strategy === 'basis') {
    // Forecast the Metro surprise (RT congestion − DA congestion) by hour; go long it or short it.
    const edge = Array<number>(24).fill(0);
    for (const d of past) {
      const da = congestion(d, 'metro', 'da');
      const rt = congestion(d, 'metro', 'rt');
      for (let h = 0; h < 24; h++) edge[h] += (rt[h] - da[h]) / past.length;
    }
    const da = congestion(today, 'metro', 'da');
    const rt = congestion(today, 'metro', 'rt');
    let pnl = 0;
    for (let h = 0; h < 24; h++) {
      const pos = edge[h] > p.threshold ? p.mw : edge[h] < -p.threshold ? -p.mw : 0;
      pnl += pos * (rt[h] - da[h]) - 2 * p.costPerMWh * Math.abs(pos);
    }
    return pnl;
  }
  const battery = { powerMW: p.mw, energyMWh: 4 * p.mw, efficiency: 0.85, soc0: 0 };
  return p.mw > 0 ? forecastBatteryPnL(past, today, battery, LAB_BATTERY_WEAR, p.costPerMWh, 21) : 0;
}

/**
 * Walk-forward daily P&L for every day of the history: zero before LAB_START, then each day
 * decided from the trailing `window` days only and settled at that day's prices.
 */
export function labDailyPnL(days: MarketDay[], p: LabParams): number[] {
  const window = Math.max(1, Math.round(p.window));
  // walkForward steps through day indices; each step looks back up to `window` days of history.
  const wf = walkForward<number>({
    data: days.map((_, i) => i),
    window: LAB_START,
    decide: () => [],
    settle: (_, i) => decideAndSettle(days.slice(Math.max(0, i - window), i), days[i], p),
  });
  return [...Array<number>(wf.firstIndex).fill(0), ...wf.pnl];
}

export interface StopLossResult {
  pnl: number[];
  /** Days on which the desk was not allowed to trade. */
  paused: boolean[];
  /** Times the stop was hit. */
  stops: number;
}

/**
 * A drawdown stop: when the running total falls more than `limit` below its high-water mark,
 * trading stops for `pauseDays` days, then resumes with the high-water mark reset. limit ≤ 0 is no stop.
 */
export function applyStopLoss(pnl: number[], limit: number, pauseDays = 10): StopLossResult {
  const out: number[] = [];
  const paused: boolean[] = [];
  let equity = 0;
  let peak = 0;
  let pauseLeft = 0;
  let stops = 0;
  for (const x of pnl) {
    if (pauseLeft > 0) {
      out.push(0);
      paused.push(true);
      pauseLeft--;
      if (pauseLeft === 0) peak = equity;
      continue;
    }
    out.push(x);
    paused.push(false);
    equity += x;
    peak = Math.max(peak, equity);
    if (limit > 0 && peak - equity > limit) {
      pauseLeft = pauseDays;
      stops++;
    }
  }
  return { pnl: out, paused, stops };
}

/** Running total minus its running maximum: zero at a new high, negative in a drawdown. */
export function drawdownSeries(pnl: number[]): number[] {
  let eq = 0;
  let peak = 0;
  return pnl.map((x) => {
    eq += x;
    peak = Math.max(peak, eq);
    return eq - peak;
  });
}

export interface SplitResult {
  /** Total P&L on in-sample days (LAB_START to LAB_SPLIT − 1). */
  inSample: number;
  /** Total P&L on out-of-sample days (LAB_SPLIT onward). */
  outOfSample: number;
}

export function splitTotals(pnl: number[]): SplitResult {
  let inSample = 0;
  let outOfSample = 0;
  pnl.forEach((x, i) => {
    if (i < LAB_SPLIT) inSample += x;
    else outOfSample += x;
  });
  return { inSample, outOfSample };
}
