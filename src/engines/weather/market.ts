// A simulated market for Calder Bay degree-day contracts, and the tools to trade against it
// honestly. The market's price is its own estimate of the index: the days already settled,
// plus a forecast that may be a few days stale, plus — for the days beyond any forecast — the
// average of the same calendar days over the past few years ("burn"), which ignores ENSO and
// lags the warming trend. A risk premium and a bid–ask spread sit on top. Every price here is
// simulated.
//
// Expected indices are computed in closed form, day by day: the expected degree days of a
// normally distributed temperature. (The mean of a sum is the sum of the means, so correlation
// between days doesn't change it.) That makes it fast enough to replay every decision in the
// archive. A forecast issued on day t uses only what was revealed by day t; `lookAheadDays`
// exists only to show what goes wrong when a backtest breaks that rule.

import {
  LEAD_MAX,
  archive,
  dayInfo,
  expectedTemp,
  knownShare,
  ninoAt,
  ninoForecast,
  normCdf,
  tempF,
  type WorldKnobs,
  climateFor,
} from '../../model/weather/archive';
import { ENSO_MONTH_WEIGHT, anomalySd } from '../../model/weather/region';
import { BASE_F, degreeDays, type DegreeKind } from './degreeDays';
import { contractSpan, payoff, type ContractSpec } from './pricing';

/** Expected degree days of a temperature ~ Normal(mean, sd), °F. */
export function expectedDegreeDays(kind: DegreeKind, mean: number, sd: number, base = BASE_F): number {
  const gap = kind === 'HDD' ? base - mean : mean - base;
  if (sd <= 1e-9) return Math.max(0, gap);
  const z = gap / sd;
  return gap * normCdf(z) + (sd * Math.exp(-(z * z) / 2)) / Math.sqrt(2 * Math.PI);
}

export interface ForecasterView {
  /** Forecast staleness, days (0 = the forecast issued on the valuation day). */
  infoDelay?: number;
  /** Use forecasts issued this many days AFTER the valuation day — a look-ahead bug, for demonstration. */
  lookAheadDays?: number;
  /** Ignore ENSO for days not yet reached. */
  ignoreEnso?: boolean;
  /**
   * Price days beyond the forecast's reach from the average of the same calendar days over this
   * many past years, instead of from the climate model (normal + trend + ENSO).
   */
  burnYears?: number;
  knobs?: WorldKnobs;
}

/**
 * The expected index of a contract as seen at the end of `valuationDay` by a forecaster with the
 * given view: days settled so far, plus each later day's expected degree days.
 */
export function expectedIndex(spec: ContractSpec, year: number, valuationDay: number, view: ForecasterView = {}): number {
  const a = archive();
  const knobs = view.knobs ?? {};
  const cl = climateFor('calder', knobs);
  const H = LEAD_MAX;
  const { start, end } = contractSpan(spec, year);
  const t = valuationDay;
  const issue = t - (view.infoDelay ?? 0) + (view.lookAheadDays ?? 0);
  const issueInfo = dayInfo(Math.max(0, Math.min(a.z.length - 1, issue)));
  const ensoF = knobs.ensoF ?? cl.ensoF;
  let sum = 0;
  for (let d = start; d <= end; d++) {
    if (d <= t) {
      sum += degreeDays(spec.kind, tempF('calder', d, knobs), spec.base);
      continue;
    }
    const lead = d - issue;
    const info = dayInfo(d);
    const sdDay = anomalySd(cl, info.doy) * (knobs.variability ?? 1);
    if (lead > H && view.burnYears) {
      sum += burnDay(spec.kind, d, view.burnYears, knobs, spec.base);
      continue;
    }
    let knownZ = 0;
    let share = 0;
    if (lead <= 0) {
      knownZ = a.z[d];
      share = 1;
    } else if (lead <= H) {
      knownZ = a.known[d * (H + 2) + lead];
      share = knownShare(lead);
    }
    const monthsAhead = (info.year - issueInfo.year) * 12 + (info.month - issueInfo.month);
    const nino = view.ignoreEnso ? 0 : monthsAhead <= 0 ? ninoAt(Math.max(0, Math.min(a.z.length - 1, issue))) : ninoForecast(issueInfo.year, issueInfo.month, monthsAhead);
    const mean = expectedTemp('calder', d, knobs) + sdDay * knownZ + ensoF * ENSO_MONTH_WEIGHT[info.month] * nino;
    sum += expectedDegreeDays(spec.kind, mean, sdDay * Math.sqrt(Math.max(0, 1 - share)), spec.base);
  }
  return sum;
}

/** Average degree days on the same calendar day over the `years` years before day d's year. */
export function burnDay(kind: DegreeKind, d: number, years: number, knobs: WorldKnobs = {}, base = BASE_F): number {
  let s = 0;
  let n = 0;
  for (let k = 1; k <= years; k++) {
    const dd = d - 365 * k;
    if (dd < 0) break;
    // Average a week around the date, as burn analyses smooth single days.
    for (let j = -3; j <= 3; j++) {
      const x = dd + j;
      if (x < 0) continue;
      s += degreeDays(kind, tempF('calder', x, knobs), base);
      n++;
    }
  }
  return n ? s / n : 0;
}

// ---------------------------------------------------------------------------
// The market.

export interface MarketModel {
  /** How stale the market's forecast information is, days. */
  infoDelay: number;
  /**
   * How the market prices days beyond its forecasts: from the climate (the normal and its trend),
   * or from a burn average of the same calendar days over the past `burnYears` years.
   */
  climate: 'model' | 'burn';
  burnYears: number;
  /** Whether the market prices ENSO. */
  usesEnso: boolean;
  /** Added to the market's expected index, index points (positive: buyers pay up for protection). */
  premium: number;
  /** Half the bid–ask spread, index points. */
  halfSpread: number;
}

/**
 * The course's simulated market: it knows the climate and its trend, but its forecasts are two
 * days stale and it doesn't price ENSO; a 5-point half-spread. Each of those is a possible
 * source of edge — and each can be switched off.
 */
export const MARKET: MarketModel = { infoDelay: 2, climate: 'model', burnYears: 10, usesEnso: false, premium: 0, halfSpread: 5 };

export interface Quote {
  /** The market's expected index, index points. */
  index: number;
  /** Mid, bid and ask, in index points. */
  mid: number;
  bid: number;
  ask: number;
}

export function marketQuote(spec: ContractSpec, year: number, valuationDay: number, m: MarketModel = MARKET, knobs: WorldKnobs = {}): Quote {
  const index = expectedIndex(spec, year, valuationDay, {
    infoDelay: m.infoDelay,
    burnYears: m.climate === 'burn' ? m.burnYears : undefined,
    ignoreEnso: !m.usesEnso,
    knobs,
  });
  const mid = index + m.premium;
  return { index, mid, bid: mid - m.halfSpread, ask: mid + m.halfSpread };
}

// ---------------------------------------------------------------------------
// Trading against it, point in time.

export interface TradeRule {
  /** Trade when the gap between our expected index and the market's price exceeds this, index points. */
  threshold: number;
  /** Contracts per trade. */
  size: number;
  /** Our view. */
  view: ForecasterView;
}

export interface Trade {
  year: number;
  month: number;
  day: number;
  side: 1 | -1;
  price: number;
  fair: number;
  settled: number;
  /** P&L, $, after paying the spread. */
  pnl: number;
}

/**
 * Replay one decision per contract: on `daysBefore` days before the contract starts (negative
 * for days into it), compare our expected index with the market's bid and ask, buy or sell
 * `size` contracts if the gap beats the threshold, and hold to settlement.
 */
export function replay(spec: ContractSpec, years: number[], daysBefore: number, rule: TradeRule, m: MarketModel = MARKET, knobs: WorldKnobs = {}): Trade[] {
  const out: Trade[] = [];
  for (const y of years) {
    const { start } = contractSpan(spec, y);
    const t = start - daysBefore;
    const q = marketQuote(spec, y, t, m, knobs);
    const fair = expectedIndex(spec, y, t, { ...rule.view, knobs });
    let side: 1 | -1 | 0 = 0;
    let price = 0;
    if (fair - q.ask > rule.threshold) {
      side = 1;
      price = q.ask;
    } else if (q.bid - fair > rule.threshold) {
      side = -1;
      price = q.bid;
    }
    if (!side) continue;
    const { end } = contractSpan(spec, y);
    let settled = 0;
    for (let d = start; d <= end; d++) settled += degreeDays(spec.kind, tempF('calder', d, knobs), spec.base);
    const pnl = side * rule.size * payoff({ ...spec, type: 'future', strike: price }, settled);
    const info = dayInfo(t);
    out.push({ year: y, month: info.month, day: info.dom, side, price, fair, settled, pnl });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hedging the utility.

export interface HedgeYear {
  winter: number;
  hdd: number;
  /** The seasonal strip's price when the hedge was placed, index points. */
  price: number;
  unhedged: number;
  hedged: number;
}

export interface HedgeResult {
  years: HedgeYear[];
  unhedgedSd: number;
  hedgedSd: number;
  /** Share of the variance removed: 1 − var(hedged) / var(unhedged). */
  effectiveness: number;
  /** Average cost of the hedge per winter (spread paid, and any premium), $. */
  costPerWinter: number;
  meanUnhedged: number;
  meanHedged: number;
}

/**
 * The utility sells `contracts` seasonal HDD strips (November–March, $20 a point) `daysBefore`
 * days before November 1 at the market's bid, and holds them to settlement: it gains when the
 * winter is warm, exactly when its margin falls. `margins` are the utility's winter margins in
 * the same order as `winters`.
 */
export function hedgeWinters(
  spec: ContractSpec,
  winters: number[],
  margins: number[],
  contracts: number,
  daysBefore: number,
  m: MarketModel = MARKET,
  knobs: WorldKnobs = {},
): HedgeResult {
  const years: HedgeYear[] = winters.map((y, i) => {
    const { start, end } = contractSpan(spec, y);
    const q = marketQuote(spec, y, start - daysBefore, m, knobs);
    let hdd = 0;
    for (let d = start; d <= end; d++) hdd += degreeDays(spec.kind, tempF('calder', d, knobs), spec.base);
    const hedgePnl = contracts * spec.tick * (q.bid - hdd);
    return { winter: y, hdd, price: q.bid, unhedged: margins[i], hedged: margins[i] + hedgePnl };
  });
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  const sd = (xs: number[]) => {
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, xs.length));
  };
  const u = years.map((y) => y.unhedged);
  const h = years.map((y) => y.hedged);
  const us = sd(u);
  const hs = sd(h);
  return {
    years,
    unhedgedSd: us,
    hedgedSd: hs,
    effectiveness: us > 0 ? 1 - (hs * hs) / (us * us) : 0,
    costPerWinter: mean(u) - mean(h),
    meanUnhedged: mean(u),
    meanHedged: mean(h),
  };
}

export interface TradeStats {
  trades: number;
  total: number;
  mean: number;
  sd: number;
  hitRate: number;
  worst: number;
  /** Mean over standard deviation, per trade. */
  ratio: number;
}

export function tradeStats(trades: Trade[]): TradeStats {
  const n = trades.length;
  if (!n) return { trades: 0, total: 0, mean: 0, sd: 0, hitRate: 0, worst: 0, ratio: 0 };
  const total = trades.reduce((s, t) => s + t.pnl, 0);
  const mean = total / n;
  const sd = Math.sqrt(trades.reduce((s, t) => s + (t.pnl - mean) ** 2, 0) / n);
  return { trades: n, total, mean, sd, hitRate: trades.filter((t) => t.pnl > 0).length / n, worst: Math.min(...trades.map((t) => t.pnl)), ratio: sd > 0 ? mean / sd : 0 };
}
