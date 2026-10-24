// Point-in-time checks for a degree-day backtest. At each decision, the forecaster states not just
// an expected index but how uncertain it is. If the backtest is honest, outcomes land everywhere
// in those stated distributions equally often (a flat histogram of their ranks). If it quietly
// uses forecasts issued after the trade date, its forecasts are better than anyone could have
// been at the time: outcomes crowd into the middle of the uncertainty the forecaster claimed.
//
// The index's uncertainty is computed in closed form for winter months, where nearly every day
// is below 65 °F and the index is a straight line in the temperatures: the variance of the sum of
// the days' forecast errors, which are correlated because pieces of information revealed on the
// same day concern neighboring days alike (as the archive is built), plus the oscillator's
// still-unknown ENSO kicks.

import { LEAD_MAX, SAME_DAY_CORRELATION, dayInfo, normCdf, revealedShare, tempF, type WorldKnobs } from '../../model/weather/archive';
import { ENSO_MONTH_WEIGHT, anomalySd, stationClimate } from '../../model/weather/region';
import { ENSO_DEFAULTS } from './enso';
import { degreeDays } from './degreeDays';
import { contractSpan, type ContractSpec } from './pricing';
import { expectedIndex, type ForecasterView } from './market';

const V = Array.from({ length: LEAD_MAX + 1 }, (_, k) => revealedShare(k));

/**
 * Standard deviation of a winter degree-day index as known at the end of `valuationDay` with
 * forecasts issued `infoDelay` days earlier, index points. Assumes every remaining day is below
 * the 65 °F base (true of December–February at Calder Bay).
 */
export function indexSd(spec: ContractSpec, year: number, valuationDay: number, view: { infoDelay?: number; knobs?: WorldKnobs } = {}): number {
  const knobs = view.knobs ?? {};
  const cl = stationClimate('calder');
  const H = LEAD_MAX;
  const rho = SAME_DAY_CORRELATION;
  const { start, end } = contractSpan(spec, year);
  const issue = valuationDay - (view.infoDelay ?? 0);
  const first = Math.max(start, valuationDay + 1);
  if (first > end) return 0;
  const days: number[] = [];
  for (let d = first; d <= end; d++) days.push(d);
  const s = days.map((d) => anomalySd(cl, dayInfo(d).doy) * (knobs.variability ?? 1));
  let variance = 0;
  for (let i = 0; i < days.length; i++) {
    for (let j = i; j < days.length; j++) {
      const d = days[i];
      const e = days[j];
      // Pieces revealed on day tp after the issue day, about both d and e (e ≥ d).
      let c = 0;
      for (let tp = Math.max(issue + 1, e - H); tp <= d; tp++) c += Math.sqrt(V[d - tp] * V[e - tp]);
      c *= rho ** (e - d);
      variance += (i === j ? 1 : 2) * s[i] * s[j] * c;
    }
  }
  // ENSO: the oscillator's kicks after the issue month move whole months together.
  const ensoF = knobs.ensoF ?? cl.ensoF;
  const issueInfo = dayInfo(Math.max(0, issue));
  const monthWeight = new Map<number, number>();
  for (const d of days) {
    const info = dayInfo(d);
    const ahead = (info.year - issueInfo.year) * 12 + (info.month - issueInfo.month);
    if (ahead <= 0) continue;
    monthWeight.set(ahead, (monthWeight.get(ahead) ?? 0) + ensoF * ENSO_MONTH_WEIGHT[info.month]);
  }
  const a = 1 + ENSO_DEFAULTS.coupling;
  const n2 = ENSO_DEFAULTS.noise ** 2;
  for (const [m1, w1] of monthWeight) {
    for (const [m2, w2] of monthWeight) {
      let cov = 0;
      for (let k = 1; k <= Math.min(m1, m2); k++) cov += a ** (m1 - k) * a ** (m2 - k) * n2;
      variance += w1 * w2 * cov;
    }
  }
  return Math.sqrt(Math.max(0, variance));
}

export interface Decision {
  year: number;
  /** Expected index the backtest used, index points. */
  forecast: number;
  /** Uncertainty the forecaster could honestly have claimed at the time, index points. */
  claimedSd: number;
  settled: number;
  /** Where the outcome fell in the claimed distribution, 0–1. */
  pit: number;
}

/**
 * One decision per contract year, `daysBefore` days before the contract starts: the forecast a
 * backtest would use (honest, or with `lookAheadDays` of forecasts from after the trade date),
 * judged against the uncertainty honestly available on the trade date.
 */
export function decisions(spec: ContractSpec, years: number[], daysBefore: number, lookAheadDays = 0, knobs: WorldKnobs = {}): Decision[] {
  return years.map((y) => {
    const { start, end } = contractSpan(spec, y);
    const t = start - daysBefore;
    const view: ForecasterView = { lookAheadDays, knobs };
    const forecast = expectedIndex(spec, y, t, view);
    const claimedSd = indexSd(spec, y, t, { knobs });
    let settled = 0;
    for (let d = start; d <= end; d++) settled += degreeDays(spec.kind, tempF('calder', d, knobs), spec.base);
    const pit = claimedSd > 0 ? normCdf((settled - forecast) / claimedSd) : settled >= forecast ? 1 : 0;
    return { year: y, forecast, claimedSd, settled, pit };
  });
}

// ---------------------------------------------------------------------------
// A hedge judged against the plan it was meant to protect.

export interface BudgetYear {
  winter: number;
  hdd: number;
  /** The strip's mid and the bid the utility sold at, index points. */
  mid: number;
  bid: number;
  /** The margin the utility planned on when it hedged, $: its sensitivity times the market's expected index. */
  budget: number;
  margin: number;
  /** Margin minus budget, without and with the hedge, $. */
  miss: number;
  hedgedMiss: number;
}

export interface BudgetHedge {
  years: BudgetYear[];
  missSd: number;
  hedgedMissSd: number;
  /** Share of the variance of the misses removed: 1 − var(hedged) / var(unhedged). */
  effectiveness: number;
  /** Average of what the hedge itself lost per winter, $ (the spread, and the market's errors). */
  costPerWinter: number;
  worstMiss: number;
  worstHedgedMiss: number;
}

/**
 * The utility plans each winter on the market's expected index (budget = intercept + slope × mid)
 * and sells `contracts` strips at the bid `daysBefore` days before the season starts. What it
 * risks is the miss against that plan; the hedge pays tick × (bid − index) per strip.
 */
export function hedgeAgainstBudget(
  spec: ContractSpec,
  winters: number[],
  margins: number[],
  fit: { slope: number; intercept: number },
  contracts: number,
  daysBefore: number,
  quote: (year: number, valuationDay: number) => { mid: number; bid: number },
  knobs: WorldKnobs = {},
): BudgetHedge {
  const years: BudgetYear[] = winters.map((y, i) => {
    const { start, end } = contractSpan(spec, y);
    const q = quote(y, start - daysBefore);
    let hdd = 0;
    for (let d = start; d <= end; d++) hdd += degreeDays(spec.kind, tempF('calder', d, knobs), spec.base);
    const budget = fit.intercept + fit.slope * q.mid;
    const miss = margins[i] - budget;
    const hedge = contracts * spec.tick * (q.bid - hdd);
    return { winter: y, hdd, mid: q.mid, bid: q.bid, budget, margin: margins[i], miss, hedgedMiss: miss + hedge };
  });
  const sd = (xs: number[]) => {
    const m = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
  };
  const u = years.map((y) => y.miss);
  const h = years.map((y) => y.hedgedMiss);
  const us = sd(u);
  const hs = sd(h);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  return {
    years,
    missSd: us,
    hedgedMissSd: hs,
    effectiveness: us > 0 ? 1 - (hs * hs) / (us * us) : 0,
    costPerWinter: mean(u) - mean(h),
    worstMiss: Math.min(...u),
    worstHedgedMiss: Math.min(...h),
  };
}

/** The same winters hedged with a different number of strips (the quotes don't depend on it). */
export function rehedge(base: BudgetHedge, contracts: number, tick: number): BudgetHedge {
  const years = base.years.map((y) => ({ ...y, hedgedMiss: y.miss + contracts * tick * (y.bid - y.hdd) }));
  const u = years.map((y) => y.miss);
  const h = years.map((y) => y.hedgedMiss);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  const sd = (xs: number[]) => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
  };
  const us = sd(u);
  const hs = sd(h);
  return {
    years,
    missSd: us,
    hedgedMissSd: hs,
    effectiveness: us > 0 ? 1 - (hs * hs) / (us * us) : 0,
    costPerWinter: mean(u) - mean(h),
    worstMiss: Math.min(...u),
    worstHedgedMiss: Math.min(...h),
  };
}

/** Counts of PIT values in `bins` equal bins from 0 to 1. */
export function pitHistogram(pits: number[], bins = 5): number[] {
  const out = new Array(bins).fill(0);
  for (const p of pits) out[Math.min(bins - 1, Math.floor(p * bins))]++;
  return out;
}

/** Root-mean-square forecast error as a share of the root-mean-square claimed sd: 1 when honest. */
export function errorToClaim(ds: Decision[]): number {
  const e = Math.sqrt(ds.reduce((s, d) => s + (d.settled - d.forecast) ** 2, 0) / Math.max(1, ds.length));
  const c = Math.sqrt(ds.reduce((s, d) => s + d.claimedSd ** 2, 0) / Math.max(1, ds.length));
  return c > 0 ? e / c : 0;
}
