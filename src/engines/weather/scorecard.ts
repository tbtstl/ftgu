// The capstone's scorecard: the whole book, winter by winter, measured the way Lesson 5.5
// measured the utility's hedge — against the plan made in October. For the gas utility the plan
// is its margin at the market's expected index for the coming winter (its sensitivity times the
// strip's mid on October 31); for the wind farm and the corn farm, which don't follow winter
// degree days, the plan is simply their average year. What the book risks is the miss against
// that plan; the hedge and the trading desk add their own results to it. Every decision uses
// only what was known on its date, and every price comes from the simulated market.

import type { WorldKnobs } from '../../model/weather/archive';
import { hedgeAgainstBudget } from './backtest';
import { regress, utilityWinters } from './exposure';
import { MARKET, marketQuote, type MarketModel } from './market';
import { PORTFOLIO_WINTERS, SEASON_STRIP, replayBook, type BookSettings } from './portfolio';

export interface ScoreWinter {
  winter: number;
  /** The business's result against its October plan, $. */
  miss: number;
  /** What the seasonal strips paid, $. */
  hedge: number;
  /** What the trading desk made, $, and how many trades it made. */
  trading: number;
  trades: number;
  total: number;
}

export interface Scorecard {
  winters: ScoreWinter[];
  /** Spread of the misses without the hedge, with it, and with the trading added, $. */
  missSd: number;
  hedgedSd: number;
  totalSd: number;
  /** Share of the misses' variance the hedge removes. */
  effectiveness: number;
  trades: number;
  tradingTotal: number;
  tradingMean: number;
  /** Worst winter for the business alone and for the whole book, $. */
  worstMiss: number;
  worstTotal: number;
  /** Average winter for the whole book, $. */
  meanTotal: number;
}

function sd(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
}

/** Replay the book in a world (knobs) against a market, and score it against the October plan. */
export function scorecard(b: BookSettings, knobs: WorldKnobs = {}, m: MarketModel = MARKET): Scorecard {
  const book = replayBook(b, knobs, m);
  const winters = PORTFOLIO_WINTERS;
  let rows: ScoreWinter[];
  if (b.business === 'utility') {
    const all = utilityWinters(knobs);
    const hdd = winters.map((w) => all[w - 1].hdd);
    const margins = winters.map((w) => all[w - 1].margin * b.scale);
    const fit = regress(hdd, margins);
    const plan = hedgeAgainstBudget(SEASON_STRIP, winters, margins, fit, b.hedgeStrips, 1, (y, t) => marketQuote(SEASON_STRIP, y, t, m, knobs), knobs);
    rows = winters.map((w, i) => {
      const y = plan.years[i];
      const trading = book.winters[i].trading;
      return { winter: w, miss: y.miss, hedge: y.hedgedMiss - y.miss, trading, trades: book.winters[i].trades.length, total: y.hedgedMiss + trading };
    });
  } else {
    rows = book.winters.map((r) => ({ winter: r.winter, miss: r.business, hedge: r.hedge, trading: r.trading, trades: r.trades.length, total: r.total }));
  }
  const missSd = sd(rows.map((r) => r.miss));
  const hedgedSd = sd(rows.map((r) => r.miss + r.hedge));
  return {
    winters: rows,
    missSd,
    hedgedSd,
    totalSd: sd(rows.map((r) => r.total)),
    effectiveness: missSd > 0 ? 1 - (hedgedSd * hedgedSd) / (missSd * missSd) : 0,
    trades: book.trades,
    tradingTotal: book.tradingTotal,
    tradingMean: book.tradingMean,
    worstMiss: Math.min(...rows.map((r) => r.miss)),
    worstTotal: Math.min(...rows.map((r) => r.total)),
    meanTotal: rows.reduce((s, r) => s + r.total, 0) / rows.length,
  };
}
