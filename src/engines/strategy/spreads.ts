// Strategy engine: trading the day-ahead / real-time spread with virtual bids.
//
// Sign convention: a position is MW of exposure to the spread RT − DA in one hour.
//   +MW is a decrement bid ("dec"): buy day-ahead, sell back in real time. Earns RT − DA.
//   −MW is an increment offer ("inc"): sell day-ahead, buy back in real time. Earns DA − RT.
// Every virtual megawatt-hour pays a transaction cost, whichever way it goes.

import type { MarketDay } from '../../model/history';
import { quantile } from './distribution';
import { walkForward } from './risk';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** RT − DA at the hub for each hour of a day, $/MWh. */
export function hourlySpreads(day: MarketDay): number[] {
  return day.da.map((p, h) => day.rt[h] - p);
}

/** Spreads arranged by hour: result[h] lists hour h's spread on every day, in order. */
export function spreadsByHour(days: MarketDay[]): number[][] {
  return HOURS.map((h) => days.map((d) => d.rt[h] - d.da[h]));
}

export type ForecastRule = 'mean' | 'median';

/**
 * Forecast tomorrow's spread in each hour from past days: the trailing mean or median of that
 * hour's spread. With no past days the forecast is zero (no view).
 */
export function forecastSpreads(past: MarketDay[], rule: ForecastRule): number[] {
  if (!past.length) return Array<number>(24).fill(0);
  return HOURS.map((h) => {
    const xs = past.map((d) => d.rt[h] - d.da[h]);
    return rule === 'median' ? quantile(xs, 0.5) : xs.reduce((s, x) => s + x, 0) / xs.length;
  });
}

/** Dec where the forecast exceeds +threshold, inc where it is below −threshold, flat otherwise. */
export function virtualPositions(forecast: number[], threshold: number, mw: number, hours: number[] = HOURS): number[] {
  const allowed = new Set(hours);
  return forecast.map((f, h) => (!allowed.has(h) ? 0 : f > threshold ? mw : f < -threshold ? -mw : 0));
}

/** P&L of a day's virtual positions after costs, $. */
export function settleVirtuals(positions: number[], day: MarketDay, costPerMWh: number): number {
  return positions.reduce((s, mw, h) => s + mw * (day.rt[h] - day.da[h]) - costPerMWh * Math.abs(mw), 0);
}

export interface VirtualStrategy {
  rule: ForecastRule;
  /** Days of history behind each forecast. */
  window: number;
  /** Trade only when the forecast spread is larger than this, $/MWh. */
  threshold: number;
  /** Size of each hourly position, MW. */
  mw: number;
  /** Cost per virtual MWh traded, $. */
  costPerMWh: number;
  /**
   * Trade only on days that pass this test. It must use only what is known before the day-ahead
   * market closes (forecasts, gas price, weekday). The forecast then also uses only past days that pass.
   */
  filter?: (day: MarketDay) => boolean;
  /** Hours that may be traded (default: all 24). */
  hours?: number[];
}

export interface VirtualBacktest {
  /** P&L of each backtested day after costs, $ (index 0 is day `firstIndex`). */
  pnl: number[];
  /** P&L before costs. */
  gross: number[];
  /** Hourly positions for each backtested day. */
  positions: number[][];
  firstIndex: number;
  /** Days with at least one position. */
  tradedDays: number;
  /** Virtual MWh traded in total. */
  mwh: number;
  /** Transaction costs paid in total, $. */
  costs: number;
}

/**
 * Walk-forward backtest of a virtual-bidding rule: each day's positions come from the trailing
 * `window` days only, and are then settled at that day's actual DA and RT prices.
 */
export function backtestVirtuals(days: MarketDay[], s: VirtualStrategy): VirtualBacktest {
  const window = Math.max(1, Math.min(days.length - 1, Math.round(s.window)));
  const wf = walkForward<MarketDay>({
    data: days,
    window,
    decide: (past, today) => {
      if (s.filter && !s.filter(today)) return Array<number>(24).fill(0);
      const relevant = s.filter ? past.filter(s.filter) : past;
      if (!relevant.length) return Array<number>(24).fill(0);
      return virtualPositions(forecastSpreads(relevant, s.rule), s.threshold, s.mw, s.hours);
    },
    settle: (pos, today) => settleVirtuals(pos, today, s.costPerMWh),
  });
  const gross = wf.positions.map((pos, i) => settleVirtuals(pos, days[i + wf.firstIndex], 0));
  const mwh = wf.positions.reduce((s2, pos) => s2 + pos.reduce((a, x) => a + Math.abs(x), 0), 0);
  return {
    pnl: wf.pnl,
    gross,
    positions: wf.positions,
    firstIndex: wf.firstIndex,
    tradedDays: wf.positions.filter((pos) => pos.some((x) => x !== 0)).length,
    mwh,
    costs: mwh * s.costPerMWh,
  };
}

/** Peak of the day's demand forecast, MW — known before the day-ahead market closes. */
export function peakForecast(day: MarketDay): number {
  return Math.max(...day.demandForecast);
}
