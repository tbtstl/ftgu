// Trading strategies on the region's simulated history (Chapter 6).
//
// A strategy is a list of trades, each entered on the first day of a month at that day's prices
// (`curveAt`). Three instruments trade:
//   - futures: Calder gas for a delivery month, 10,000 MMBtu a lot, marked to each month's curve
//     and settled on the first day of the delivery month;
//   - index gas: a lot of the prompt month's gas bought at its futures price on the first day and
//     sold back day by day at the daily price (a swap of the futures price for the month's average);
//   - basis swaps: a volume per day for a delivery month at Metro or Ridgeback, marked to the basis
//     forwards and settled against the month's average daily basis.
// `runBook` marks every position at each month's start, books fees on entry and early exit, and
// tracks the initial margin the positions tie up.
//
// The physical assets of Lesson 6.4 — leased storage, firm transportation and a gas-fired plant —
// are valued two ways each year: what the curve on April 1 offered (intrinsic), and what operating
// them month by month (storage) or day by day (pipes and plants) actually earned.

import { conditionsOf, EXPRESS_EXPANSION, gasHistory, type YearConditions } from '../../model/gas/history';
import { GAS_MONTH_DAYS, GAS_MONTH_START, GAS_YEAR_DAYS } from '../../model/gas/weather';
import { PIPELINE, STORAGE_SPECS } from '../../model/gas/world';
import { maxDrawdown } from '../strategy/risk';
import { FUTURES_CONTRACT_MMBTU } from './contracts';
import { forecastTemps } from './forecast';
import { curveAt, historyMonths, monthAverage, settlement } from './futures';
import { seasonalPlan } from './market';
import { powerDay } from './power';
import { injectCapacity, withdrawCapacity, type StorageSpec } from './storage';

export const LOT_MMBTU = FUTURES_CONTRACT_MMBTU;
const MMBTU_PER_BCF = 1.037e6;

/** Days in absolute month `month` of the history. */
export function daysIn(month: number): number {
  return GAS_MONTH_DAYS[month % 12];
}

// ---------------------------------------------------------------------------
// Trades and the book.

export type BasisPlace = 'metro' | 'ridgeback';

export type Leg =
  | { kind: 'futures'; delivery: number; lots: number }
  | { kind: 'index'; delivery: number; lots: number }
  | { kind: 'basis'; place: BasisPlace; delivery: number; mmbtuPerDay: number };

export interface Trade {
  /** Month whose first day the trade is made on. */
  entry: number;
  /** Month whose first day it is closed on (default: each leg held to settlement). */
  exit?: number;
  legs: Leg[];
  tag?: string;
}

export interface TradingCosts {
  /** Cost of trading futures or index gas, each way, $/MMBtu (half the bid–ask spread plus fees). */
  futuresFee: number;
  /** The same for basis swaps, $/MMBtu. */
  basisFee: number;
  /** Initial margin, $ per futures or index lot. */
  futuresMargin: number;
  /** Initial margin for basis swaps, $ per MMBtu of the month's volume. */
  basisMargin: number;
}

let marginCache: { futures: number; basis: number } | null = null;

/**
 * Margins set the way an exchange sets them, to cover a large one-month move: three standard
 * deviations of the month-to-month change in the history's futures prices (per lot), and in its
 * Metro basis marks including their final settlement (per MMBtu), rounded.
 */
export function marginRates(): { futures: number; basis: number } {
  if (marginCache) return marginCache;
  const N = historyMonths();
  const fut: number[] = [];
  const bas: number[] = [];
  for (let D = 1; D < N; D++) {
    for (let t = Math.max(1, D - 10); t <= D; t++) fut.push(curveAt(t).calder[D] - curveAt(t - 1).calder[D]);
    for (let t = Math.max(1, D - 10); t <= D + 1; t++) {
      const now = t <= D ? curveAt(t).metroBasis[D] : monthAverage(D, 'metro', 'calder');
      bas.push(now - curveAt(t - 1).metroBasis[D]);
    }
  }
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };
  marginCache = {
    futures: Math.round((3 * sd(fut) * LOT_MMBTU) / 500) * 500,
    basis: Math.round(3 * sd(bas) * 100) / 100,
  };
  return marginCache;
}

/** Default trading costs: a tenth of a cent each way on futures, a cent on basis, and the history's margins. */
export function defaultCosts(): TradingCosts {
  const m = marginRates();
  return { futuresFee: 0.001, basisFee: 0.01, futuresMargin: m.futures, basisMargin: m.basis };
}

export interface TradeOutcome {
  trade: Trade;
  /** Profit after fees, $. */
  pnl: number;
  fees: number;
  /** Month it was closed on (the last leg's last mark). */
  closed: number;
}

export interface BookResult {
  /** Profit in each month of the history, after fees, $ (index N holds settlements after the last month). */
  pnl: number[];
  /** Running total at the end of each month, $. */
  equity: number[];
  /** Fees paid in each month, $. */
  fees: number[];
  /** Initial margin tied up during each month, $. */
  margin: number[];
  /** Cash needed in each month: margin less any profits so far, plus any losses, $. */
  capital: number[];
  trades: TradeOutcome[];
  total: number;
  totalFees: number;
  /** Largest fall in the running total, $. */
  maxDrawdown: number;
  /** Most cash the strategy ever needed, $. */
  peakCapital: number;
  worstMonth: number;
  bestMonth: number;
  /** Share of trades that made money after fees. */
  winRate: number;
}

/** Each leg's marks at the month boundaries it lives through: [boundary, value per unit], plus its size in MMBtu. */
function legMarks(leg: Leg, entry: number, exit?: number): { marks: Array<[number, number]>; size: number; early: boolean } {
  const marks: Array<[number, number]> = [];
  if (leg.kind === 'futures') {
    const close = Math.min(exit ?? leg.delivery, leg.delivery);
    for (let b = entry; b <= close; b++) marks.push([b, curveAt(b).calder[leg.delivery]]);
    return { marks, size: leg.lots * LOT_MMBTU, early: close < leg.delivery };
  }
  if (leg.kind === 'index') {
    marks.push([leg.delivery, settlement(leg.delivery)], [leg.delivery + 1, monthAverage(leg.delivery, 'calder')]);
    return { marks, size: leg.lots * LOT_MMBTU, early: false };
  }
  const key = leg.place === 'metro' ? 'metroBasis' : 'ridgebackBasis';
  const close = Math.min(exit ?? leg.delivery + 1, leg.delivery + 1);
  for (let b = entry; b <= close; b++) {
    marks.push([b, b <= leg.delivery ? curveAt(b)[key][leg.delivery] : monthAverage(leg.delivery, leg.place, 'calder')]);
  }
  return { marks, size: leg.mmbtuPerDay * daysIn(leg.delivery), early: close <= leg.delivery };
}

/** Whether a trade can be made: every leg is quoted on its entry day and settles within the history. */
export function tradeable(t: Trade): boolean {
  const N = historyMonths();
  if (t.entry < 0 || t.entry >= N) return false;
  return t.legs.every((l) => {
    if (l.kind === 'index') return l.delivery === t.entry;
    return l.delivery >= t.entry && l.delivery - t.entry <= 11 && l.delivery < N;
  });
}

/** Marks a list of trades through the history. */
export function runBook(trades: Trade[], costs: TradingCosts = defaultCosts()): BookResult {
  const N = historyMonths();
  const pnl = Array<number>(N + 1).fill(0);
  const fees = Array<number>(N + 1).fill(0);
  const margin = Array<number>(N + 1).fill(0);
  const outcomes: TradeOutcome[] = [];
  for (const trade of trades) {
    if (!tradeable(trade)) continue;
    let tPnl = 0;
    let tFees = 0;
    let closed = trade.entry;
    for (const leg of trade.legs) {
      const { marks, size, early } = legMarks(leg, trade.entry, trade.exit);
      for (let i = 1; i < marks.length; i++) {
        const v = size * (marks[i][1] - marks[i - 1][1]);
        pnl[marks[i][0] - 1] += v;
        tPnl += v;
      }
      const isBasis = leg.kind === 'basis';
      const fee = Math.abs(size) * (isBasis ? costs.basisFee : costs.futuresFee);
      const perMonthMargin = isBasis ? Math.abs(size) * costs.basisMargin : Math.abs(leg.lots) * costs.futuresMargin;
      const first = marks[0][0];
      const last = marks[marks.length - 1][0];
      fees[first] += fee;
      tFees += fee;
      if (early) {
        fees[Math.max(first, last - 1)] += fee;
        tFees += fee;
      }
      for (let b = first; b < Math.max(last, first + 1); b++) margin[b] += perMonthMargin;
      closed = Math.max(closed, last);
    }
    outcomes.push({ trade, pnl: tPnl - tFees, fees: tFees, closed });
  }
  const net = pnl.map((p, i) => p - fees[i]);
  const equity: number[] = [];
  let run = 0;
  for (const p of net) equity.push((run += p));
  // Cash needed: the margin, less profits already made (or plus losses), at the month's worst point.
  const capital = margin.map((m, i) => {
    const low = Math.min(i > 0 ? equity[i - 1] : 0, equity[i]);
    return Math.max(0, m - low, -low);
  });
  return {
    pnl: net,
    equity,
    fees,
    margin,
    capital,
    trades: outcomes,
    total: run,
    totalFees: fees.reduce((a, b) => a + b, 0),
    maxDrawdown: maxDrawdown(net).drawdown,
    peakCapital: Math.max(0, ...capital),
    worstMonth: Math.min(0, ...net),
    bestMonth: Math.max(0, ...net),
    winRate: outcomes.length ? outcomes.filter((o) => o.pnl > 0).length / outcomes.length : 0,
  };
}

/** A book's profit in each gas year, $ (settlements after the last month count in the last year). */
export function pnlByYear(r: BookResult): number[] {
  const N = historyMonths();
  const out = Array<number>(N / 12).fill(0);
  r.pnl.forEach((p, i) => (out[Math.min(N / 12 - 1, Math.floor(i / 12))] += p));
  return out;
}

// ---------------------------------------------------------------------------
// Weather: the prompt month's gas, bought or sold on a forecast.

export interface WeatherSignal {
  /** The delivery month (traded on its first day). */
  month: number;
  /** Forecast and actual departure from normal over the forecast's days, °F (positive = colder). */
  forecastColder: number;
  actualColder: number;
  /** The whole month's departure from normal, °F (positive = colder). */
  monthColder: number;
  /** What a lot bought at the futures price and sold at the daily prices made, $/MMBtu. */
  edge: number;
}

/** The forecast on the first day of every month of the history, and what that month's gas did. */
export function weatherSignals(skill: number, horizon = 14): WeatherSignal[] {
  const h = gasHistory();
  const out: WeatherSignal[] = [];
  for (let d = 0; d < historyMonths(); d++) {
    const y = h[Math.floor(d / 12)];
    const m = d % 12;
    const from = GAS_MONTH_START[m];
    const w = y.weather;
    const fc = forecastTemps(w, from, horizon, skill, y.seed);
    const colder = (temps: number[]) => temps.reduce((s, t, i) => s + w.normal[from + i] - t, 0) / Math.max(1, temps.length);
    out.push({
      month: d,
      forecastColder: colder(fc),
      actualColder: colder(w.temp.slice(from, from + fc.length)),
      monthColder: colder(w.temp.slice(from, from + daysIn(d))),
      edge: monthAverage(d, 'calder') - settlement(d),
    });
  }
  return out;
}

/**
 * Buy the prompt month's gas (index) on its first day when the forecast is colder than normal by
 * more than `thresholdF`, and sell it when warmer, `lots` lots at a time.
 */
export function weatherTrades(o: { skill: number; horizon?: number; thresholdF: number; lots: number; months?: number[] }): Trade[] {
  const allowed = new Set(o.months ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return weatherSignals(o.skill, o.horizon)
    .filter((s) => allowed.has(s.month % 12) && Math.abs(s.forecastColder) > o.thresholdF && o.skill > 0)
    .map((s) => ({ entry: s.month, legs: [{ kind: 'index' as const, delivery: s.month, lots: Math.sign(s.forecastColder) * o.lots }], tag: 'weather' }));
}

// ---------------------------------------------------------------------------
// Calendar spreads.

export type SpreadRule = 'always' | 'behind' | 'ahead';

export interface SpreadOptions {
  /** Calendar month (0 = April) the spread is bought on, and the months bought and sold. */
  entryCal: number;
  longCal: number;
  shortCal: number;
  lots: number;
  /** Trade every year, or only when storage is behind (or ahead of) the season's plan by `thresholdBcf`. */
  rule: SpreadRule;
  thresholdBcf: number;
}

/** The first absolute month at or after `from` that falls in calendar month `cal`. */
export function nextOf(from: number, cal: number): number {
  return from + ((cal - (from % 12) + 12) % 12);
}

export interface SpreadSignal {
  entry: number;
  longDelivery: number;
  shortDelivery: number;
  /** Working gas less the season's plan on the entry day, Bcf. */
  vsPlan: number;
  /** The spread (long less short) on entry and when the first leg settles, $/MMBtu. */
  atEntry: number;
  atExit: number;
  exit: number;
  traded: boolean;
}

/** One spread a year, entered on `entryCal`'s first day and closed when its first leg settles. */
export function spreadSignals(o: SpreadOptions): SpreadSignal[] {
  const N = historyMonths();
  const out: SpreadSignal[] = [];
  for (let y = 0; y * 12 < N; y++) {
    const entry = y * 12 + o.entryCal;
    const longD = nextOf(entry, o.longCal);
    const shortD = nextOf(entry, o.shortCal) === longD ? longD + 12 : nextOf(entry, o.shortCal);
    if (Math.max(longD, shortD) >= N || Math.max(longD, shortD) - entry > 11) continue;
    const exit = Math.min(longD, shortD);
    const c = curveAt(entry);
    const x = curveAt(exit);
    const vsPlan = c.storage - c.planned;
    const traded = o.rule === 'always' || (o.rule === 'behind' ? vsPlan <= -o.thresholdBcf : vsPlan >= o.thresholdBcf);
    out.push({ entry, longDelivery: longD, shortDelivery: shortD, vsPlan, atEntry: c.calder[longD] - c.calder[shortD], atExit: x.calder[longD] - x.calder[shortD], exit, traded });
  }
  return out;
}

export function spreadTrades(o: SpreadOptions): Trade[] {
  return spreadSignals(o)
    .filter((s) => s.traded)
    .map((s) => ({
      entry: s.entry,
      exit: s.exit,
      legs: [
        { kind: 'futures' as const, delivery: s.longDelivery, lots: o.lots },
        { kind: 'futures' as const, delivery: s.shortDelivery, lots: -o.lots },
      ],
      tag: 'spread',
    }));
}

// ---------------------------------------------------------------------------
// Basis: a view of Ridgeback's congestion, and Metro's winter insurance.

export interface RidgebackHypothesis {
  /** How much Ridgeback's production is expected to grow each year, Bcf/d — or 'trend', estimated each year from the growth seen so far. */
  growth: number | 'trend';
  /** Whether the announced expansion of Ridgeback Express is counted on from the year it opens. */
  expansion: boolean;
}

const viewCache = new Map<string, number[]>();

/** Ridgeback's basis in each calendar month (April first) in a normal year under conditions `c`. */
export function basisUnder(c: YearConditions): number[] {
  const key = [c.ridgeback, c.sandhill, c.ridgebackExpress, c.lngBcfd, c.demandScale].map((x) => x.toFixed(3)).join('|');
  let v = viewCache.get(key);
  if (!v) {
    const p = seasonalPlan({
      production: { ridgeback: c.ridgeback, sandhill: c.sandhill },
      capacity: { 'ridgeback-calder': c.ridgebackExpress },
      demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
      fast: true,
    });
    v = p.price.ridgeback.map((x, m) => x - p.price.calder[m]);
    viewCache.set(key, v);
  }
  return v;
}

/** Ridgeback's growth per year as a forecaster in year `knownYear` would estimate it from the production seen so far, Bcf/d. */
export function estimatedGrowth(knownYear: number): number {
  return knownYear >= 1 ? (conditionsOf(knownYear).ridgeback - conditionsOf(0).ridgeback) / knownYear : 0;
}

/** What the hypothesis expects the region to look like in year `deliveryYear`, from what is known in `knownYear`. */
export function hypothesizedConditions(h: RidgebackHypothesis, knownYear: number, deliveryYear: number): YearConditions {
  const now = conditionsOf(knownYear);
  const ahead = deliveryYear - knownYear;
  const growth = h.growth === 'trend' ? estimatedGrowth(knownYear) : h.growth;
  const opens = h.expansion && knownYear < EXPRESS_EXPANSION.year && deliveryYear >= EXPRESS_EXPANSION.year;
  return { ...now, ridgeback: now.ridgeback + growth * ahead, ridgebackExpress: now.ridgebackExpress + (opens ? EXPRESS_EXPANSION.addBcfd : 0) };
}

/** Ridgeback's basis takeaway, Bcf/d: what can leave the basin by pipe, plus what's burned there. */
export function ridgebackTakeaway(c: YearConditions): number {
  return c.ridgebackExpress + PIPELINE['ridgeback-bayport'].capacityBcfd + 0.1;
}

export interface BasisSignal {
  delivery: number;
  /** Month the decision is made on. */
  decided: number;
  view: number;
  forward: number;
  realized: number;
  /** +1 bought, −1 sold, 0 no trade. */
  side: number;
}

/** For each delivery month, the hypothesis's basis view `lead` months ahead against the forward, and the trade it implies. */
export function ridgebackSignals(h: RidgebackHypothesis, lead: number, threshold: number): BasisSignal[] {
  const N = historyMonths();
  const tariff = PIPELINE['ridgeback-calder'].variableCost;
  const out: BasisSignal[] = [];
  for (let D = lead; D < N; D++) {
    const t = D - lead;
    const known = Math.floor(t / 12);
    const cal = D % 12;
    // The view moves the market's forward by what the hypothesis changes in a normal-weather year,
    // so a hypothesis that agrees with the market (nothing changes) never trades. While gas has to
    // leave the basin, Ridgeback's price can't rise above Calder's less the trip: the view stops there.
    const shift = basisUnder(hypothesizedConditions(h, known, Math.floor(D / 12)))[cal] - basisUnder(conditionsOf(known))[cal];
    const forward = curveAt(t).ridgebackBasis[D];
    const view = Math.min(-tariff, forward + shift);
    const side = view < forward - threshold ? -1 : view > forward + threshold ? 1 : 0;
    out.push({ delivery: D, decided: t, view, forward, realized: monthAverage(D, 'ridgeback', 'calder'), side });
  }
  return out;
}

export function ridgebackTrades(h: RidgebackHypothesis, o: { lead: number; threshold: number; mmbtuPerDay: number }): Trade[] {
  return ridgebackSignals(h, o.lead, o.threshold)
    .filter((s) => s.side !== 0)
    .map((s) => ({ entry: s.decided, legs: [{ kind: 'basis' as const, place: 'ridgeback' as const, delivery: s.delivery, mmbtuPerDay: s.side * o.mmbtuPerDay }], tag: 'ridgeback' }));
}

export interface MetroBasisOptions {
  /** Calendar months traded (default December to February). */
  months?: number[];
  /** Months ahead the swap is sold. */
  lead: number;
  /** Volume, MMBtu/d: negative sells Metro's basis (collecting the premium), positive buys it. */
  mmbtuPerDay: number;
  /** At lead 0, stand aside when the forecast (with this skill) is colder than normal by more than `skipColderF`. */
  forecast?: { skill: number; skipColderF: number };
  /**
   * Trade only when the forward differs from the basis realized in the same calendar month of the
   * years already seen by more than `threshold` ($/MMBtu), in the direction of the difference
   * (selling when the forward is dearer). No trades in the first year, which has no past.
   */
  fromPast?: { threshold: number };
}

/** The average basis at Metro realized in calendar month `cal` in the years before `year`, or null if none. */
export function pastMetroBasis(cal: number, year: number): number | null {
  if (year < 1) return null;
  let s = 0;
  for (let y = 0; y < year; y++) s += monthAverage(y * 12 + cal, 'metro', 'calder');
  return s / year;
}

/** Metro's winter basis, sold (or bought) every winter month `lead` months ahead. */
export function metroBasisTrades(o: MetroBasisOptions): Trade[] {
  const N = historyMonths();
  const months = new Set(o.months ?? [8, 9, 10]);
  const signals = o.forecast && o.lead === 0 ? weatherSignals(o.forecast.skill) : null;
  const out: Trade[] = [];
  for (let D = o.lead; D < N; D++) {
    if (!months.has(D % 12)) continue;
    if (signals && signals[D].forecastColder > o.forecast!.skipColderF) continue;
    let size = o.mmbtuPerDay;
    if (o.fromPast) {
      const entry = D - o.lead;
      const past = pastMetroBasis(D % 12, Math.floor(entry / 12));
      if (past === null) continue;
      const gap = curveAt(entry).metroBasis[D] - past;
      if (Math.abs(gap) <= o.fromPast.threshold) continue;
      size = -Math.sign(gap) * Math.abs(o.mmbtuPerDay);
    }
    out.push({ entry: D - o.lead, legs: [{ kind: 'basis', place: 'metro', delivery: D, mmbtuPerDay: size }], tag: 'metro' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Physical assets: storage, transportation and a power plant, year by year.

/** A share of Salt Flat leased for a year: its working gas and rates scaled down. */
export function leasedStorage(share: number): StorageSpec {
  const s = STORAGE_SPECS.saltflat;
  return { ...s, workingBcf: s.workingBcf * share, baseBcf: s.baseBcf * share, maxInjectBcfd: s.maxInjectBcfd * share, maxWithdrawBcfd: s.maxWithdrawBcfd * share };
}

const STORAGE_GRID = 60;

/**
 * The best monthly schedule for a storage field against twelve monthly prices (starting in
 * calendar month `startCal`), from `start` to at least `end` Bcf, by dynamic programming on a grid
 * of inventory levels. A month's move is limited by the field's daily rates at its inventory times
 * the month's days. Returns the value ($) and each month's move (Bcf, + injection).
 */
export function monthlyStorageOptimum(
  prices: number[],
  spec: StorageSpec,
  o: { startCal: number; start: number; end: number; injectCost?: number; withdrawCost?: number },
): { value: number; moves: number[] } {
  const n = STORAGE_GRID;
  const W = spec.workingBcf;
  const lvl = (i: number) => (W * i) / n;
  const ic = o.injectCost ?? 0.05;
  const wc = o.withdrawCost ?? 0.05;
  const T = prices.length;
  const cash = (d: number, p: number) => (d > 0 ? -d * MMBTU_PER_BCF * (p + ic) : -d * MMBTU_PER_BCF * (p - wc));
  const V: Float64Array[] = Array.from({ length: T + 1 }, () => new Float64Array(n + 1));
  const choice: Int32Array[] = Array.from({ length: T }, () => new Int32Array(n + 1));
  for (let i = 0; i <= n; i++) V[T][i] = lvl(i) + 1e-9 >= o.end ? 0 : -1e15;
  for (let t = T - 1; t >= 0; t--) {
    const days = GAS_MONTH_DAYS[(o.startCal + t) % 12];
    for (let i = 0; i <= n; i++) {
      const x = lvl(i);
      const hi = Math.min(W, x + injectCapacity(spec, x) * days * 0.85);
      const lo = Math.max(0, x - withdrawCapacity(spec, x) * days * 0.8);
      let best = -Infinity;
      let bj = i;
      for (let j = Math.ceil((lo / W) * n - 1e-9); j <= Math.floor((hi / W) * n + 1e-9); j++) {
        const v = cash(lvl(j) - x, prices[t]) + V[t + 1][j];
        if (v > best) {
          best = v;
          bj = j;
        }
      }
      V[t][i] = best;
      choice[t][i] = bj;
    }
  }
  let i = Math.round((o.start / W) * n);
  const moves: number[] = [];
  let value = 0;
  for (let t = 0; t < T; t++) {
    const j = choice[t][i];
    const d = lvl(j) - lvl(i);
    moves.push(d);
    value += cash(d, prices[t]);
    i = j;
  }
  return { value, moves };
}

export interface AssetYear {
  year: number;
  /** What the April 1 curve offered (intrinsic value), $. */
  forward: number;
  /** What operating the asset through the year earned, $. */
  realized: number;
}

export interface StorageYear extends AssetYear {
  /** Earnings when every planned move is hedged with futures and the plan is redrawn monthly (rolling intrinsic), $. */
  hedged: number;
  /** Working gas at the start of each month, and the move made in it, Bcf. */
  inventory: number[];
  moves: number[];
}

/**
 * A storage lease for each year, starting and ending a quarter full. Its intrinsic value on April
 * 1's curve; what it earned when its schedule was redrawn on each month's curve and each month's
 * move was bought or sold at the month's average price (unhedged); and what the same operation
 * earned when every planned move was locked in with futures on the curve that planned it, and the
 * hedges adjusted each month (the "rolling intrinsic" of a storage desk).
 */
export function storageAsset(share: number): StorageYear[] {
  const spec = leasedStorage(share);
  const start = spec.workingBcf * 0.25;
  const h = gasHistory();
  const cashFor = (d: number, p: number) => (d > 0 ? -d * MMBTU_PER_BCF * (p + 0.05) : -d * MMBTU_PER_BCF * (p - 0.05));
  return h.map((_, y) => {
    const curve = (t: number) => Array.from({ length: 12 - t }, (_, k) => curveAt(y * 12 + t).calder[y * 12 + t + k]);
    const forward = monthlyStorageOptimum(curve(0), spec, { startCal: 0, start, end: start }).value;
    let x = start;
    let realized = 0;
    let futures = 0;
    const position = new Map<number, number>();
    const inventory: number[] = [];
    const moves: number[] = [];
    for (let t = 0; t < 12; t++) {
      const abs = y * 12 + t;
      if (t > 0) {
        for (const [D, pos] of position) futures += pos * (curveAt(abs).calder[D] - curveAt(abs - 1).calder[D]);
      }
      position.delete(abs);
      const plan = monthlyStorageOptimum(curve(t), spec, { startCal: t, start: x, end: start });
      for (let k = 1; k < plan.moves.length; k++) position.set(abs + k, plan.moves[k] * MMBTU_PER_BCF);
      const d = plan.moves[0];
      inventory.push(x);
      moves.push(d);
      realized += cashFor(d, monthAverage(abs, 'calder'));
      x += d;
    }
    return { year: y, forward, realized, hedged: realized + futures, inventory, moves };
  });
}

export type Route = 'northline' | 'express';

/** Firm capacity for a year on a route, `mmbtuPerDay`: used whenever the day's spread beats the variable charge. */
export function transportAsset(route: Route, mmbtuPerDay: number): AssetYear[] {
  const line = route === 'northline' ? PIPELINE['calder-metro'] : PIPELINE['ridgeback-calder'];
  const spreadOf = (p: Record<string, number>) => (route === 'northline' ? p.metro - p.calder : p.calder - p.ridgeback);
  return gasHistory().map((yr, y) => {
    const c = curveAt(y * 12);
    let forward = 0;
    for (let k = 0; k < 12; k++) {
      const D = y * 12 + k;
      const fwd = route === 'northline' ? c.metroBasis[D] : -c.ridgebackBasis[D];
      forward += Math.max(0, fwd - line.variableCost) * mmbtuPerDay * daysIn(D);
    }
    const realized = yr.days.reduce((s, d) => s + Math.max(0, spreadOf(d.price) - line.variableCost) * mmbtuPerDay, 0);
    return { year: y, forward, realized };
  });
}

const marginCacheByPrice = new Map<number, number>();

/** Lakeside's margin over fuel and upkeep for a day at a Metro gas price, $ (the electricity region's reference day). */
export function lakesideMargin(gasPrice: number): number {
  const k = Math.round(gasPrice * 100);
  let v = marginCacheByPrice.get(k);
  if (v === undefined) {
    v = powerDay(k / 100).margin.cc1;
    marginCacheByPrice.set(k, v);
  }
  return v;
}

/** A year's toll of Lakeside: its margin at the April 1 forward prices, and at each day's Metro price. */
export function powerAsset(): AssetYear[] {
  return gasHistory().map((yr, y) => {
    const c = curveAt(y * 12);
    let forward = 0;
    for (let k = 0; k < 12; k++) {
      const D = y * 12 + k;
      forward += lakesideMargin(c.calder[D] + c.metroBasis[D]) * daysIn(D);
    }
    const realized = yr.days.reduce((s, d) => s + lakesideMargin(d.price.metro), 0);
    return { year: y, forward, realized };
  });
}

/** Days in the history. */
export function historyDayCount(): number {
  return gasHistory().length * GAS_YEAR_DAYS;
}
