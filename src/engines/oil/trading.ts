// Trading strategies on the simulated history (Chapter 6 and the capstone).
//
// Every strategy here trades a spread whose behavior the course has derived from physics:
//   • the WTI calendar spread (month 1 − month 2), set by stocks at Kessler (Lessons 4.3, 5.4);
//   • the Brent–WTI spread, set by pipeline capacity out of the basin (Lessons 4.1, 4.4, 5.2);
//   • the 3:2:1 crack spread, set by product stocks and refinery outages (Lessons 3.5, 5.3, 5.5).
// Each decides its position from information available at the end of a week and earns the next
// week's change in the spread. Positions are counted in units of one spread: 1,000 barrels a leg
// (one futures contract per leg), so a $1 move in the spread is $1,000 per unit. A 3:2:1 crack
// unit is three crude contracts against two gasoline and one diesel contract (3,000 barrels of
// crude), so $1 of crack is $3,000.
//
// Costs, margins and limits are illustrative, not exchange figures: each contract traded pays a
// cost per barrel (commission and the bid–ask spread), and each open unit ties up initial margin.

import type { HistoryWeek } from '../../model/oil/history';
import { fullCarry } from './market';
import { maxDrawdown, summarize, type PnlSummary } from '../strategy/risk';

export type SpreadId = 'calendar' | 'basis' | 'crack' | 'quality';

export const SPREADS: Record<SpreadId, { name: string; legs: number; barrels: number; margin: number; value: (w: HistoryWeek) => number }> = {
  /** Long one month-1 WTI contract, short one month-2: earns when the front strengthens. */
  calendar: { name: 'WTI calendar spread (month 1 − month 2)', legs: 2, barrels: 1000, margin: 1500, value: (w) => w.wtiCurve[0] - w.wtiCurve[1] },
  /** Long Brent, short WTI: earns when inland crude cheapens relative to the coast. */
  basis: { name: 'Brent − WTI', legs: 2, barrels: 1000, margin: 3000, value: (w) => w.brent - w.wti },
  /** Long two gasoline and one diesel contract, short three crude: earns when cracks widen. */
  crack: { name: '3:2:1 crack', legs: 6, barrels: 3000, margin: 9000, value: (w) => w.crack321 },
  /** Long Coldwater Heavy, short light crude, both at Port Calder: earns when the heavy discount narrows. */
  quality: { name: 'Coldwater Heavy − light crude at Port Calder', legs: 2, barrels: 1000, margin: 3000, value: (w) => w.coldwater - w.calderCrude },
};

/** Cost of trading one contract, $ per barrel (commission plus half the bid–ask spread; illustrative). */
export const COST_PER_BBL = 0.02;

export interface BacktestResult {
  /** Position (units, long > 0) held through each week. */
  positions: number[];
  /** P&L earned in each week, $ (after costs). */
  pnl: number[];
  costs: number;
  /** Units traded in total (each unit has `legs` contracts). */
  turnover: number;
  /** Most margin tied up at once, $. */
  peakMargin: number;
  stats: PnlSummary;
}

/**
 * Runs a decision rule over the history: decide(t) sees weeks 0…t and returns the position held
 * from t to t+1; the P&L is that position times the spread's change, less trading costs.
 */
export function backtest(h: HistoryWeek[], spread: SpreadId, decide: (t: number) => number, opts: { units?: number; costPerBbl?: number; start?: number } = {}): BacktestResult {
  const s = SPREADS[spread];
  const units = opts.units ?? 1;
  const cost = opts.costPerBbl ?? COST_PER_BBL;
  const start = opts.start ?? 0;
  const positions: number[] = [];
  const pnl: number[] = [];
  let prev = 0;
  let costs = 0;
  let turnover = 0;
  let peakMargin = 0;
  for (let t = start; t < h.length - 1; t++) {
    const pos = Math.max(-1, Math.min(1, decide(t))) * units;
    const traded = Math.abs(pos - prev);
    const c = traded * s.legs * 1000 * cost;
    costs += c;
    turnover += traded;
    const move = s.value(h[t + 1]) - s.value(h[t]);
    pnl.push(pos * move * s.barrels - c);
    positions.push(pos);
    peakMargin = Math.max(peakMargin, Math.abs(pos) * s.margin);
    prev = pos;
  }
  return { positions, pnl, costs, turnover, peakMargin, stats: summarize(pnl, 52) };
}

// ---------------------------------------------------------------------------
// The three rules.

export interface CalendarRule {
  /** Weeks over which the change in Kessler's fill is measured. */
  lookback: number;
  /** Change in fill (share of capacity) that triggers a position. */
  threshold: number;
}

/** Calendar spread: long when Kessler's tanks are draining (the front will strengthen), short when they are filling. */
export function calendarRule(h: HistoryWeek[], r: CalendarRule): (t: number) => number {
  return (t) => {
    if (t < r.lookback) return 0;
    const d = h[t].kesslerFill - h[t - r.lookback].kesslerFill;
    return d < -r.threshold ? 1 : d > r.threshold ? -1 : 0;
  };
}

export interface BasisRule {
  /** Pipeline use at which to expect the spread to blow out. */
  useThreshold: number;
  /** Weeks before a known expansion opens to bet on the spread narrowing. */
  leadWeeks: number;
  /** How far the spread can sit above its 12-week low and still count as not yet blown out, $/bbl. */
  stretch: number;
}

/**
 * Basis: long Brent − WTI when the Kessler–Calder line is nearly full but the spread hasn't yet
 * blown out; short it in the weeks before a known expansion opens while it is still wide. Flat
 * otherwise.
 */
export function basisRule(h: HistoryWeek[], r: BasisRule, expansionWeek: number | null): (t: number) => number {
  return (t) => {
    const w = h[t];
    const spread = w.brent - w.wti;
    const recent = h.slice(Math.max(0, t - 12), t + 1).map((x) => x.brent - x.wti);
    const low = Math.min(...recent);
    if (expansionWeek !== null && t >= expansionWeek - r.leadWeeks && t < expansionWeek) return spread > low + r.stretch || w.pipelineUse >= 0.999 ? -1 : 0;
    if (w.pipelineUse >= r.useThreshold && spread < low + r.stretch) return 1;
    return 0;
  };
}

export interface CrackRule {
  /** Weeks over which the change in product stocks is measured. */
  lookback: number;
  /** Change in total product stocks (million bbl) that triggers a position. */
  threshold: number;
  /** Also go long for this many weeks after a refinery outage begins. */
  outageWeeks: number;
}

/** Crack: long when product stocks are falling or a refinery outage has just begun; short when stocks are building. */
export function crackRule(h: HistoryWeek[], r: CrackRule): (t: number) => number {
  return (t) => {
    for (let k = 0; k < r.outageWeeks; k++) {
      const i = t - k;
      if (i >= 1 && h[i].refineryOutage > 0 && h[i - 1].refineryOutage === 0) return 1;
    }
    if (t < r.lookback) return 0;
    const now = h[t].gasolineStock + h[t].distillateStock;
    const then = h[t - r.lookback].gasolineStock + h[t - r.lookback].distillateStock;
    const d = now - then;
    return d < -r.threshold ? 1 : d > r.threshold ? -1 : 0;
  };
}

export interface QualityRule {
  /** Weeks of history behind the fuel-oil discount's average. */
  lookback: number;
  /** How far the discount must sit from its average before acting, $/bbl. */
  band: number;
}

/**
 * Quality: fuel oil's discount to crude drifts back toward its usual level, and the heavy
 * crude's discount follows it (Lesson 4.5). When fuel oil is unusually cheap (its discount wide),
 * go long the heavy crude against light, expecting the discount to narrow; when unusually dear, short.
 */
export function qualityRule(h: HistoryWeek[], r: QualityRule): (t: number) => number {
  return (t) => {
    if (t < r.lookback) return 0;
    const disc = (w: HistoryWeek) => w.brent - w.hsfo;
    const avg = h.slice(t - r.lookback, t).reduce((s, w) => s + disc(w), 0) / r.lookback;
    const d = disc(h[t]) - avg;
    return d > r.band ? 1 : d < -r.band ? -1 : 0;
  };
}

export const RULE_DEFAULTS = {
  calendar: { lookback: 2, threshold: 0.01 } as CalendarRule,
  basis: { useThreshold: 0.96, leadWeeks: 4, stretch: 3 } as BasisRule,
  crack: { lookback: 3, threshold: 15, outageWeeks: 3 } as CrackRule,
  quality: { lookback: 26, band: 2 } as QualityRule,
};

/** The week a history's pipeline expansion opens (null if none within the history). */
export function expansionWeek(h: HistoryWeek[]): number | null {
  for (let t = 1; t < h.length; t++) if (h[t].pipelineCapacity > h[t - 1].pipelineCapacity) return t;
  return null;
}

// ---------------------------------------------------------------------------
// Cash and carry at Kessler (Lesson 6.1's second demonstration).

export interface CarryParams {
  /** Storage leased, barrels. */
  lease: number;
  /** Storage fee, $/bbl-month, and annual financing rate. */
  fee: number;
  rate: number;
  /** Handling in and out, $/bbl each way. */
  handling: number;
  /** Months to hold: buy spot, sell the future this many months out (1–5). */
  months: number;
}

export const CARRY_DEFAULTS: CarryParams = { lease: 1e6, fee: 0.4, rate: 0.06, handling: 0.1, months: 2 };

export interface CarryResult {
  /** Profit locked in each week a trade was entered, $. */
  locked: number[];
  trades: number;
  profit: number;
  /** Share of weeks the leased tank was full. */
  utilization: number;
}

/**
 * Each week, if the leased tank is free and the future `months` out exceeds spot by more than the
 * cost of carrying and handling, buy a tankful and sell it forward; the tank is busy until delivery.
 */
export function cashAndCarry(h: HistoryWeek[], p: CarryParams = CARRY_DEFAULTS): CarryResult {
  const holdWeeks = Math.round(p.months * 4.33);
  const locked: number[] = [];
  let busyUntil = -1;
  let busyWeeks = 0;
  let trades = 0;
  for (let t = 0; t < h.length; t++) {
    const w = h[t];
    let gain = 0;
    if (t >= busyUntil && p.months < w.wtiCurve.length) {
      const spot = w.wtiCurve[0];
      const fwd = w.wtiCurve[p.months];
      const carry = p.months * fullCarry(spot, p.fee, p.rate) + 2 * p.handling;
      const margin = fwd - spot - carry;
      if (margin > 0) {
        gain = margin * p.lease;
        busyUntil = t + holdWeeks;
        trades++;
      }
    }
    if (t < busyUntil) busyWeeks++;
    locked.push(gain);
  }
  return { locked, trades, profit: locked.reduce((a, b) => a + b, 0), utilization: busyWeeks / h.length };
}

// ---------------------------------------------------------------------------
// The Calder refinery's margin and its hedge (Lesson 6.4).

/** Calder's reference day (Lesson 3.5): kb/d of crude and products, coke in tonnes a day. */
export const CALDER_DAY = {
  ridgeback: 58.0,
  coldwater: 92.0,
  gasoline: 45.12,
  jet: 17.56,
  diesel: 46.72,
  lpg: 14.2,
  naphtha: 8.97,
  hsfo: 14.21,
  coke: 1250,
  /** Operating costs including hydrogen, $ per day. */
  opex: 460000,
};

/** Calder's gross margin in a week of the history, $ per day, at its reference yields and slate. */
export function calderMargin(w: HistoryWeek, d = CALDER_DAY): number {
  const ridgeback = w.calderCrude - 1.7; // Ridgeback Light delivered: the coast's light-crude price (Lesson 3.5's $76.50 against $78.20)
  const jet = w.diesel - 4;
  const lpg = 0.455 * w.brent;
  const naphtha = w.brent - 11;
  const revenue = (d.gasoline * w.gasoline + d.jet * jet + d.diesel * w.diesel + d.lpg * lpg + d.naphtha * naphtha + d.hsfo * w.hsfo) * 1000 + d.coke * 70;
  const crude = (d.ridgeback * ridgeback + d.coldwater * w.coldwater) * 1000;
  return revenue - crude - d.opex;
}

export interface HedgeResult {
  /** Each week's margin, $/day, and the margin expected when that quarter's hedge was placed. */
  margin: number[];
  expected: number[];
  /** Surprise (realized − expected), unhedged and hedged, $/day. */
  surprise: number[];
  hedgedSurprise: number[];
  /** The crack sold at the start of each week's quarter, and the crack realized that week. */
  locked: number[];
  realized: number[];
  /** Root-mean-square surprises, $/day, and the share of their variance the hedge removes. */
  sdUnhedged: number;
  sdHedged: number;
  effectiveness: number;
  /** Minimum-variance hedge ratio: crack barrels sold per barrel of crude run. */
  bestRatio: number;
}

export type HedgeCrack = 'wti' | 'brent';

/** Crack ratios: the share of the product leg that is gasoline (the rest is diesel). */
export const CRACK_RATIOS = {
  '3:2:1': 2 / 3,
  '2:1:1': 1 / 2,
  /** Calder's own mix: 45.12 kb/d of gasoline against 64.28 of diesel and jet (Lesson 3.5). */
  calder: CALDER_DAY.gasoline / (CALDER_DAY.gasoline + CALDER_DAY.diesel + CALDER_DAY.jet),
};

/** A crack spread against WTI or Brent with a given gasoline share of the product leg, $/bbl. */
export function crackOf(w: HistoryWeek, which: HedgeCrack, gasolineShare = CRACK_RATIOS['3:2:1']): number {
  const products = gasolineShare * w.gasoline + (1 - gasolineShare) * w.diesel;
  return products - (which === 'wti' ? w.wti : w.brent);
}

/**
 * At the start of each quarter, Calder expects the coming weeks to look like the last one, and
 * sells a crack (against WTI or Brent, with a chosen gasoline share) at the level then prevailing on `ratio` of its crude
 * runs. Each week the hedge pays (locked − realized) per barrel hedged, offsetting the part of the
 * margin's surprise that moves with the crack. What it can't offset is basis risk: Calder's own
 * yields (if the crack's mix differs from them) and crude slate, its heavy crude's discount, and —
 * for a WTI crack — the Brent–WTI spread.
 */
export function hedgeRefinery(h: HistoryWeek[], ratio: number, which: HedgeCrack = 'brent', gasolineShare = CRACK_RATIOS['3:2:1'], d = CALDER_DAY): HedgeResult {
  const runs = (d.ridgeback + d.coldwater) * 1000;
  const margin = h.map((w) => calderMargin(w, d));
  const expected: number[] = [];
  const locked: number[] = [];
  const realized: number[] = [];
  const surprise: number[] = [];
  const hedgedSurprise: number[] = [];
  for (let t = 1; t < h.length; t++) {
    const t0 = Math.floor((t - 1) / 13) * 13; // the week before this quarter began
    const lockedCrack = crackOf(h[t0], which, gasolineShare);
    const e = margin[t0];
    const r = crackOf(h[t], which, gasolineShare);
    expected.push(e);
    locked.push(lockedCrack);
    realized.push(r);
    surprise.push(margin[t] - e);
    hedgedSurprise.push(margin[t] - e + ratio * runs * (lockedCrack - r));
  }
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / Math.max(1, xs.length));
  // Minimum variance: regress the surprise on the crack's move since the hedge was placed.
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < surprise.length; i++) {
    const x = runs * (realized[i] - locked[i]);
    cov += x * surprise[i];
    vx += x * x;
  }
  const su = rms(surprise);
  const sh = rms(hedgedSurprise);
  return {
    margin: margin.slice(1),
    expected,
    surprise,
    hedgedSurprise,
    locked,
    realized,
    sdUnhedged: su,
    sdHedged: sh,
    effectiveness: su > 0 ? 1 - (sh * sh) / (su * su) : 0,
    bestRatio: vx > 0 ? cov / vx : 0,
  };
}

// ---------------------------------------------------------------------------
// Portfolio and walk-forward (Lesson 6.5).

/** Correlation of two equal-length series. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : 0;
}

/** Sum of several weekly P&L series, each scaled. */
export function combine(series: number[][], weights: number[]): number[] {
  const n = Math.min(...series.map((s) => s.length));
  return Array.from({ length: n }, (_, i) => series.reduce((s, x, k) => s + weights[k] * x[i], 0));
}

/**
 * Walk forward: every `step` weeks, choose the parameter whose rule earned most over the previous
 * `window` weeks, and trade it for the next `step` weeks. Returns the P&L of the weeks traded and
 * the parameter chosen for each.
 */
export function walkForwardRule<P>(
  h: HistoryWeek[],
  spread: SpreadId,
  candidates: P[],
  rule: (p: P) => (t: number) => number,
  opts: { window: number; step: number; units?: number; costPerBbl?: number },
): { pnl: number[]; chosen: P[]; firstWeek: number } {
  const runs = candidates.map((c) => backtest(h, spread, rule(c), { units: opts.units, costPerBbl: opts.costPerBbl }).pnl);
  const pnl: number[] = [];
  const chosen: P[] = [];
  for (let t = opts.window; t < h.length - 1; t += opts.step) {
    let best = 0;
    let bestSum = -Infinity;
    runs.forEach((r, k) => {
      const s = r.slice(t - opts.window, t).reduce((a, b) => a + b, 0);
      if (s > bestSum) {
        bestSum = s;
        best = k;
      }
    });
    for (let i = t; i < Math.min(t + opts.step, h.length - 1); i++) {
      pnl.push(runs[best][i]);
      chosen.push(candidates[best]);
    }
  }
  return { pnl, chosen, firstWeek: opts.window };
}

export { maxDrawdown, summarize };
