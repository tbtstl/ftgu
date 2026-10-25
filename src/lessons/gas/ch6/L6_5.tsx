import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  signed,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { curveAt, monthAverage } from '../../../engines/gas/futures';
import {
  daysIn,
  defaultCosts,
  estimatedGrowth,
  HEATING_MONTHS,
  LOT_MMBTU,
  metroBasisTrades,
  pastMetroBasis,
  pnlByYear,
  ridgebackTakeaway,
  ridgebackTrades,
  runBook,
  spreadSignals,
  spreadTrades,
  weatherSignals,
  weatherTrades,
  type BookResult,
  type SpreadSignal,
  type Trade,
  type TradingCosts,
} from '../../../engines/gas/strategies';
import { LATE_EXPANSION_WORLD, worldMarket } from '../../../engines/gas/worlds';
import { conditionsOf, gasHistory, HISTORY_YEARS } from '../../../model/gas/history';
import { GAS_MONTH_NAMES, GAS_YEAR_DAYS, hdd, WINTER_START } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { money } from '../shared/format';

// ---------------------------------------------------------------------------
// The four strategies of Lessons 6.1–6.3, as those lessons left them.
// (Lesson 6.1's weather desk trades the heating months, October to April.)

/** Futures and index trades are this many lots, basis swaps this many MMBtu a day, at size ×1. */
export const LAB_LOTS = 10;
export const LAB_VOLUME = 10_000;
/** The weather desk: forecast skill and how far from normal (°F) the two-week forecast must be. */
export const LAB_WEATHER = { skill: 0.8, thresholdF: 1 };
/** The March/April spread, bought on November 1 and held until March settles. */
export const LAB_SPREAD = { entryCal: 7, longCal: 11, shortCal: 0 };
/** The Ridgeback desk: months ahead and threshold, $/MMBtu. */
export const LAB_RIDGEBACK = { lead: 6, threshold: 0.25 };
/** The Metro desk: sells each winter month's basis on its first day unless the forecast is colder than normal. */
export const LAB_METRO = { skill: 0.8, skipColderF: 0, months: [8, 9, 10] };
/** The walk-forward Metro rule trades when the forward is this far from its fair value, $/MMBtu. */
export const LAB_FAIR_THRESHOLD = 0.1;

export type StrategyLabPick = 'weather' | 'spread' | 'ridgeback' | 'metro' | 'all';
export const STRATEGY_LAB_DEFAULTS = { strategy: 'weather' as StrategyLabPick, size: 1, costs: 1, capital: 1_000_000 };
export type StrategyLabState = typeof STRATEGY_LAB_DEFAULTS;
export const LAB_SIZE_MAX = 5;
export const LAB_COSTS_MAX = 10;
export const LAB_CAPITAL = { min: 250_000, max: 3_000_000, step: 250_000 };
/** The challenge: all four together, costs as they are, $1 million set aside. */
export const LAB_CHALLENGE = { strategy: 'all' as StrategyLabPick, costs: 1, capital: 1_000_000 };

const PICK_NAME: Record<StrategyLabPick, string> = {
  weather: 'The weather trades',
  spread: 'The March/April rule',
  ridgeback: 'The Ridgeback desk',
  metro: 'The Metro desk',
  all: 'All four',
};

// ---------------------------------------------------------------------------
// The March/April rule, tuned on winters: with hindsight or walked forward.

/** Thresholds the spread rule may choose from, Bcf behind plan. */
export const LAB_SPREAD_THRESHOLDS = Array.from({ length: 21 }, (_, i) => i);

interface SpreadWinter {
  signal: SpreadSignal;
  /** What ten lots made that winter, after fees, $. */
  pnl: number;
}

let spreadWinterMemo: SpreadWinter[] | null = null;

/** Each winter's March/April spread and what ten lots of it made, bought every November. */
export function labSpreadWinters(): SpreadWinter[] {
  if (spreadWinterMemo) return spreadWinterMemo;
  const signals = spreadSignals({ ...LAB_SPREAD, lots: LAB_LOTS, rule: 'always', thresholdBcf: 0 });
  spreadWinterMemo = signals.map((signal) => ({
    signal,
    pnl: runBook([
      {
        entry: signal.entry,
        exit: signal.exit,
        legs: [
          { kind: 'futures', delivery: signal.longDelivery, lots: LAB_LOTS },
          { kind: 'futures', delivery: signal.shortDelivery, lots: -LAB_LOTS },
        ],
      },
    ]).total,
  }));
  return spreadWinterMemo;
}

/** What the rule "buy when storage is at least `t` Bcf behind plan" made over the first `winters` winters. */
function spreadRuleTotal(t: number, winters: number): number {
  return labSpreadWinters()
    .slice(0, winters)
    .reduce((a, w) => a + (w.signal.vsPlan <= -t ? w.pnl : 0), 0);
}

/** The threshold that made the most over the first `winters` winters (the lowest if several tie), or null with no winters to learn from. */
export function labSpreadBest(winters: number): number | null {
  if (winters < 1) return null;
  let best = LAB_SPREAD_THRESHOLDS[0];
  for (const t of LAB_SPREAD_THRESHOLDS) if (spreadRuleTotal(t, winters) > spreadRuleTotal(best, winters) + 1e-6) best = t;
  return best;
}

/** The threshold tuned on all the winters: the rule as Lesson 6.2 left it. */
export function labSpreadHindsight(): number {
  return labSpreadBest(labSpreadWinters().length) ?? 0;
}

function spreadRuleTrades(thresholds: Array<number | null>, lots: number): Trade[] {
  return labSpreadWinters()
    .filter((w, i) => thresholds[i] !== null && w.signal.vsPlan <= -(thresholds[i] as number))
    .map((w) => ({
      entry: w.signal.entry,
      exit: w.signal.exit,
      legs: [
        { kind: 'futures', delivery: w.signal.longDelivery, lots },
        { kind: 'futures', delivery: w.signal.shortDelivery, lots: -lots },
      ],
    }));
}

// ---------------------------------------------------------------------------
// The lab: a strategy's trades, costs, book and survival.

/** The trades of a strategy at a size (×1 = ten lots or 10,000 MMBtu a day). */
export function labTrades(pick: StrategyLabPick, size: number): Trade[] {
  const lots = LAB_LOTS * size;
  const volume = LAB_VOLUME * size;
  switch (pick) {
    case 'weather':
      return weatherTrades({ skill: LAB_WEATHER.skill, thresholdF: LAB_WEATHER.thresholdF, lots, months: HEATING_MONTHS });
    case 'spread':
      return spreadTrades({ ...LAB_SPREAD, lots, rule: 'behind', thresholdBcf: labSpreadHindsight() });
    case 'ridgeback':
      return ridgebackTrades({ growth: 'trend', expansion: true }, { lead: LAB_RIDGEBACK.lead, threshold: LAB_RIDGEBACK.threshold, mmbtuPerDay: volume });
    case 'metro':
      return metroBasisTrades({ lead: 0, months: LAB_METRO.months, mmbtuPerDay: -volume, forecast: { skill: LAB_METRO.skill, skipColderF: LAB_METRO.skipColderF } });
    case 'all':
      return [...labTrades('weather', size), ...labTrades('spread', size), ...labTrades('ridgeback', size), ...labTrades('metro', size)];
  }
}

/** The default trading costs times `mult` (margins unchanged). */
export function labCosts(mult: number): TradingCosts {
  const c = defaultCosts();
  return { ...c, futuresFee: c.futuresFee * mult, basisFee: c.basisFee * mult };
}

const bookCache = new Map<string, BookResult>();

/** A strategy's book over the eight years (cached). */
export function labBook(pick: StrategyLabPick, size: number, costs: number): BookResult {
  const key = `${pick}|${size}|${costs}`;
  let b = bookCache.get(key);
  if (!b) {
    b = runBook(labTrades(pick, size), labCosts(costs));
    bookCache.set(key, b);
  }
  return b;
}

export interface LabOutcome {
  book: BookResult;
  /** Month in which the strategy needs more capital than was set aside, or null if it never does. */
  bust: number | null;
  /** Profit after fees at the end — or when it was closed out for lack of capital, $. */
  final: number;
  /** Profit in each gas year up to the end or the close-out, $ (null for years after a close-out). */
  byYear: Array<number | null>;
  /** Fees paid and the largest fall from a high, up to the end or the close-out, $. */
  fees: number;
  maxDrawdown: number;
}

/** A strategy run with a given capital: it survives if it never needs more than was set aside. */
export function labOutcome(s: StrategyLabState): LabOutcome {
  const book = labBook(s.strategy, s.size, s.costs);
  const i = book.capital.findIndex((c) => c > s.capital + 1e-6);
  const bust = i < 0 ? null : i;
  const last = bust ?? book.pnl.length - 1;
  const byYear: Array<number | null> = Array.from({ length: HISTORY_YEARS }, (_, y) => (y * 12 <= last ? 0 : null));
  book.pnl.forEach((p, m) => {
    const y = Math.min(HISTORY_YEARS - 1, Math.floor(m / 12));
    if (m <= last) byYear[y] = (byYear[y] ?? 0) + p;
  });
  const fees = book.fees.slice(0, last + 1).reduce((a, b) => a + b, 0);
  let peak = 0;
  let dd = 0;
  for (let m = 0; m <= last; m++) {
    peak = Math.max(peak, book.equity[m]);
    dd = Math.max(dd, peak - book.equity[m]);
  }
  return { book, bust, final: bust === null ? book.total : book.equity[bust], byYear, fees, maxDrawdown: dd };
}

/** The largest size, on the slider's steps, at which a strategy never runs out of the capital set aside (0 if none). */
export function labLargestSize(pick: StrategyLabPick, costs: number, capital: number): number {
  for (let k = LAB_SIZE_MAX; k >= 1; k--) if (labOutcome({ strategy: pick, size: k, costs, capital }).bust === null) return k;
  return 0;
}

/** The challenge: all four at the largest size that survives with $1 million at ordinary costs. */
export function strategyLabSolved(s: StrategyLabState): boolean {
  if (s.strategy !== LAB_CHALLENGE.strategy || s.costs !== LAB_CHALLENGE.costs || s.capital !== LAB_CHALLENGE.capital) return false;
  return s.size === labLargestSize(s.strategy, s.costs, s.capital) && labOutcome(s).bust === null;
}

// ---------------------------------------------------------------------------
// Hindsight against walking forward.

export type WalkPick = 'spread' | 'metro' | 'skip' | 'ridgeback';

// ---------------------------------------------------------------------------
// The lab's Metro desk with its one setting chosen from the winters already seen.

/** The skip thresholds the Metro desk may choose from, °F colder than normal (null: never skip, sell every month). */
export const LAB_SKIP_OPTIONS: Array<number | null> = [null, 0, 1, 2, 3, 4];

function skipTrades(th: number | null, years?: (y: number) => boolean): Trade[] {
  return metroBasisTrades({
    lead: 0,
    months: LAB_METRO.months,
    mmbtuPerDay: -LAB_VOLUME,
    forecast: th === null ? undefined : { skill: LAB_METRO.skill, skipColderF: th },
  }).filter((t) => !years || years(Math.floor(t.entry / 12)));
}

let skipWinterMemo: number[][] | null = null;

/** What each skip threshold (rows, as `LAB_SKIP_OPTIONS`) made in each winter (columns), after fees, $. */
export function labSkipWinters(): number[][] {
  if (!skipWinterMemo) skipWinterMemo = LAB_SKIP_OPTIONS.map((th) => Array.from({ length: HISTORY_YEARS }, (_, y) => runBook(skipTrades(th, (x) => x === y)).total));
  return skipWinterMemo;
}

/** The threshold that made the most over the first `winters` winters (the first listed if several tie); with no winters to learn from, sell every month. */
export function labSkipBest(winters: number): number | null {
  const tab = labSkipWinters();
  let best = 0;
  let bv = -Infinity;
  tab.forEach((row, i) => {
    const v = row.slice(0, winters).reduce((a, b) => a + b, 0);
    if (v > bv + 1e-6) {
      bv = v;
      best = i;
    }
  });
  return winters < 1 ? null : LAB_SKIP_OPTIONS[best];
}

const skipText = (th: number | null) => (th === null ? 'sell all' : `${th} °F`);
export const WALK_DEFAULTS = { pick: 'spread' as WalkPick };

export interface LabWalk {
  hindsight: BookResult;
  walk: BookResult;
  /** What the walk-forward trader used in each year, and what then happened, as short labels. */
  used: string[];
  happened: string[];
  /** The hindsight setting, in words. */
  hindsightSetting: string;
}

/** The fair value of Metro's basis in a calendar month from every winter of the history. */
function metroFairAll(cal: number): number {
  let s = 0;
  for (let y = 0; y < HISTORY_YEARS; y++) s += monthAverage(y * 12 + cal, 'metro', 'calder');
  return s / HISTORY_YEARS;
}

/** The Metro fair-value rule with hindsight: the fair value is every winter's average. */
function metroHindsightTrades(): Trade[] {
  const out: Trade[] = [];
  for (let y = 0; y < HISTORY_YEARS; y++) {
    for (const cal of LAB_METRO.months) {
      const D = y * 12 + cal;
      const gap = curveAt(D).metroBasis[D] - metroFairAll(cal);
      if (Math.abs(gap) <= LAB_FAIR_THRESHOLD) continue;
      out.push({ entry: D, legs: [{ kind: 'basis', place: 'metro', delivery: D, mmbtuPerDay: -Math.sign(gap) * LAB_VOLUME }] });
    }
  }
  return out;
}

const walkCache = new Map<WalkPick, LabWalk>();

/** A strategy tuned with hindsight and walked forward (cached). */
export function labWalk(pick: WalkPick): LabWalk {
  let w = walkCache.get(pick);
  if (w) return w;
  const years = Array.from({ length: HISTORY_YEARS }, (_, y) => y);
  if (pick === 'spread') {
    const winters = labSpreadWinters();
    const hind = labSpreadHindsight();
    const walked = winters.map((_, i) => labSpreadBest(i));
    w = {
      hindsight: runBook(spreadRuleTrades(winters.map(() => hind), LAB_LOTS)),
      walk: runBook(spreadRuleTrades(walked, LAB_LOTS)),
      used: years.map((y) => (y < winters.length ? (walked[y] === null ? 'no past' : `${walked[y]} Bcf`) : '—')),
      happened: years.map((y) => (y < winters.length ? `${fmt(winters[y].signal.vsPlan, 1)} Bcf` : '—')),
      hindsightSetting: `${hind} Bcf`,
    };
  } else if (pick === 'skip') {
    const sig = weatherSignals(LAB_METRO.skill);
    const hind = labSkipBest(HISTORY_YEARS);
    const walked = years.map((y) => labSkipBest(y));
    w = {
      hindsight: runBook(skipTrades(hind)),
      walk: runBook(years.flatMap((y) => skipTrades(walked[y], (x) => x === y))),
      used: walked.map(skipText),
      happened: years.map((y) => `${signedF(Math.max(...LAB_METRO.months.map((c) => sig[y * 12 + c].forecastColder)))} °F`),
      hindsightSetting: `a ${skipText(hind)} threshold`,
    };
  } else if (pick === 'metro') {
    w = {
      hindsight: runBook(metroHindsightTrades()),
      walk: runBook(metroBasisTrades({ lead: 0, months: LAB_METRO.months, mmbtuPerDay: LAB_VOLUME, fromPast: { threshold: LAB_FAIR_THRESHOLD } })),
      used: years.map((y) => {
        const f = pastMetroBasis(9, y);
        return f === null ? 'no past' : `Jan ${signedUsd(f)}`;
      }),
      happened: years.map((y) => `Jan ${signedUsd(monthAverage(y * 12 + 9, 'metro', 'calder'))}`),
      hindsightSetting: 'every winter’s average',
    };
  } else {
    const actual = (conditionsOf(HISTORY_YEARS - 1).ridgeback - conditionsOf(0).ridgeback) / (HISTORY_YEARS - 1);
    w = {
      hindsight: runBook(ridgebackTrades({ growth: actual, expansion: true }, { lead: LAB_RIDGEBACK.lead, threshold: LAB_RIDGEBACK.threshold, mmbtuPerDay: LAB_VOLUME })),
      walk: runBook(ridgebackTrades({ growth: 'trend', expansion: true }, { lead: LAB_RIDGEBACK.lead, threshold: LAB_RIDGEBACK.threshold, mmbtuPerDay: LAB_VOLUME })),
      used: years.map((y) => `+${fmt(estimatedGrowth(y), 2)}/yr`),
      happened: years.map((y) => `${fmt(conditionsOf(y).ridgeback, 2)} of ${fmt(ridgebackTakeaway(conditionsOf(y)), 2)}`),
      hindsightSetting: `+${fmt(actual, 2)} Bcf/d a year`,
    };
  }
  walkCache.set(pick, w);
  return w;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

/** Heating degree days colder (+) or warmer (−) than normal over each year's winter, November to March. */
export function labWinterHdd(): number[] {
  return gasHistory().map((y) => {
    let s = 0;
    for (let d = WINTER_START; d < GAS_YEAR_DAYS; d++) s += hdd(y.weather.temp[d]) - hdd(y.weather.normal[d]);
    return s;
  });
}

/** Every number the prose quotes (call lazily: it needs the whole history). */
export function strategyLabNumbers() {
  const costs = defaultCosts();
  const at = (pick: StrategyLabPick) => labBook(pick, 1, 1);
  const all = at('all');
  const largest = labLargestSize(LAB_CHALLENGE.strategy, LAB_CHALLENGE.costs, LAB_CHALLENGE.capital);
  const over = labOutcome({ ...LAB_CHALLENGE, size: largest + 1 });
  const spreadWalk = labWalk('spread');
  const winters = labSpreadWinters();
  const walked = winters.map((_, i) => labSpreadBest(i));
  return {
    futuresFee: costs.futuresFee,
    basisFee: costs.basisFee,
    futuresMargin: costs.futuresMargin,
    basisMargin: costs.basisMargin,
    weather: at('weather'),
    spread: at('spread'),
    ridgeback: at('ridgeback'),
    metro: at('metro'),
    all,
    metroCostly: labBook('metro', 1, LAB_COSTS_MAX).total,
    allPeakMonth: all.capital.indexOf(all.peakCapital),
    largest,
    largestPeak: labBook(LAB_CHALLENGE.strategy, Math.max(1, largest), 1).peakCapital,
    over,
    spreadHindsight: labSpreadHindsight(),
    spreadWalk,
    walked,
    winters,
    metroWalk: labWalk('metro'),
    fairY3: pastMetroBasis(9, 2) ?? 0,
    fairY4: pastMetroBasis(9, 3) ?? 0,
    janFwd: curveAt(2 * 12 + 9).metroBasis[2 * 12 + 9],
    janY3: monthAverage(2 * 12 + 9, 'metro', 'calder'),
    ridgeWalk: labWalk('ridgeback'),
    growth: estimatedGrowth(1),
    takeaway: ridgebackTakeaway(conditionsOf(0)),
    ...ridgebackSides(),
    metroEdge: metroGrossEdge(),
    spreadWorstYear: worstYear(at('spread')),
    skipWalk: labWalk('skip'),
    skipHindsight: labSkipBest(HISTORY_YEARS),
    skipWalked: Array.from({ length: HISTORY_YEARS }, (_, y) => labSkipBest(y)),
    skipColdest: skipColdest(),
  };
}

/** The coldest two-week forecast (°F colder than normal) on the first of a winter month, each winter, at the Metro desk's skill. */
function skipColdest(): number[] {
  const sig = weatherSignals(LAB_METRO.skill);
  return Array.from({ length: HISTORY_YEARS }, (_, y) => Math.max(...LAB_METRO.months.map((c) => sig[y * 12 + c].forecastColder)));
}

/** The year (0-based) a book lost the most in. */
function worstYear(b: BookResult): number {
  const ys = pnlByYear(b);
  return ys.indexOf(Math.min(...ys));
}

/** The Ridgeback desk's sold and bought basis, and its purchases of the expansion year in the world where the pipe opens a year late. */
function ridgebackSides() {
  const b = labBook('ridgeback', 1, 1);
  const sum = (xs: BookResult['trades']) => xs.reduce((a, o) => a + o.pnl, 0);
  const sold = b.trades.filter((o) => o.trade.legs.some((l) => l.kind === 'basis' && l.mmbtuPerDay < 0));
  const bought = b.trades.filter((o) => o.trade.legs.some((l) => l.kind === 'basis' && l.mmbtuPerDay > 0));
  const late = runBook(
    ridgebackTrades({ growth: 'trend', expansion: true }, { lead: LAB_RIDGEBACK.lead, threshold: LAB_RIDGEBACK.threshold, mmbtuPerDay: LAB_VOLUME }, LATE_EXPANSION_WORLD),
    defaultCosts(),
    worldMarket(LATE_EXPANSION_WORLD),
  );
  const boughtDeliveries = new Set(bought.map((o) => o.trade.legs[0].delivery));
  const lateSame = late.trades.filter((o) => boughtDeliveries.has(o.trade.legs[0].delivery) && o.trade.legs.some((l) => l.kind === 'basis' && l.mmbtuPerDay > 0));
  return {
    ridgeSold: sum(sold),
    ridgeSoldCount: sold.length,
    ridgeSoldYear: sold.length ? Math.floor(sold[0].trade.legs[0].delivery / 12) : 0,
    ridgeBought: sum(bought),
    ridgeBoughtCount: bought.length,
    ridgeBoughtYear: bought.length ? Math.floor(bought[0].trade.legs[0].delivery / 12) : 0,
    lateSame: sum(lateSame),
    lateSameLosers: lateSame.filter((o) => o.pnl <= 0).length,
    lateSameCount: lateSame.length,
  };
}

/** The Metro desk's profit before fees per MMBtu it sold, $. */
function metroGrossEdge(): number {
  const b = labBook('metro', 1, 1);
  const volume = b.trades.reduce((a, o) => a + o.trade.legs.reduce((v, l) => v + (l.kind === 'basis' ? Math.abs(l.mmbtuPerDay) * daysIn(l.delivery) : 0), 0), 0);
  return volume > 0 ? (b.total + b.totalFees) / volume : 0;
}

// ---------------------------------------------------------------------------
// Chart pieces.

const N_MONTHS = 96;
const YEAR_TICKS = Array.from({ length: HISTORY_YEARS }, (_, y) => y * 12 + 6);
const YEAR_LINES = Array.from({ length: HISTORY_YEARS - 1 }, (_, y) => ({ at: (y + 1) * 12, color: '#d9d9d5', dash: '2 3', width: 1 }));
const EQUITY = GRAPHIC.green;
const DRAWDOWN = tint(GRAPHIC.red, 0.3);
const CAPITAL = '#555555';
const HINDSIGHT = '#8a8a8a';

/** "$1.2M", "$350k", "−$40k": money on an axis. */
function axisMoney(v: number): string {
  if (Math.abs(v) < 1) return '$0';
  const s = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return a >= 1e6 ? `${s}$${fmt(a / 1e6, a >= 1e7 ? 0 : 1)}M` : `${s}$${fmt(a / 1e3)}k`;
}

/** "+4.6", "−0.3". */
function signedF(x: number): string {
  return `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), 1)}`;
}

/** "+$0.74", "−$0.12". */
function signedUsd(x: number): string {
  return `${x >= 0 ? '+' : '−'}$${fmt(Math.abs(x), 2)}`;
}

/** Money rounded for prose: "$312,000", "$4.60 million". */
function cash(x: number): string {
  return Math.abs(x) >= 1e6 ? money(x) : money(Math.round(x / 1000) * 1000);
}

/** "January of Year 1". */
function monthName(abs: number): string {
  return `${GAS_MONTH_NAMES[abs % 12]} of Year ${Math.floor(abs / 12) + 1}`;
}

/** A y domain and ticks that hold every value with a little room. */
function moneyDomain(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const span = hi - lo;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  // Small losses get a little room below zero rather than a whole step.
  const a = lo < 0 ? (-lo < step / 2 ? lo - span * 0.04 : Math.floor(lo / step) * step) : 0;
  const b = Math.ceil((hi + span * 0.04) / step) * step;
  const ticks: number[] = [];
  for (let k = Math.ceil(a / step - 1e-9); k * step <= b + step / 2; k++) ticks.push(k * step);
  return { domain: [a, b], ticks };
}

interface RowCell {
  text: string;
  color?: string;
}

/** A small table under a chart: one column per year, lined up with the chart's x axis. */
function YearRows({ rows, ariaLabel }: { rows: Array<{ label: string; cells: RowCell[] }>; ariaLabel: string }) {
  const left = 56;
  const right = 624;
  const col = (right - left) / HISTORY_YEARS;
  const h = rows.length * 17 + 6;
  return (
    <svg className="chart" viewBox={`0 0 640 ${h}`} role="img" aria-label={ariaLabel} style={{ display: 'block', marginTop: -4 }}>
      {rows.map((r, i) => (
        <g key={r.label}>
          <text className="ax ax-e" x={left - 6} y={14 + i * 17} style={{ fontSize: 11 }}>
            {r.label}
          </text>
          {r.cells.map((c, y) => (
            <text key={y} className="ax ax-m" x={left + col * (y + 0.5)} y={14 + i * 17} style={{ fontSize: 11, fill: c.color }}>
              {c.text}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function word(k: number): string {
  return WORDS[k] ?? fmt(k);
}

/** The profit series of a book as chart points, starting from zero. */
function equityPoints(b: BookResult, until?: number): { xs: number[]; ys: number[] } {
  const last = until ?? b.equity.length - 1;
  return { xs: [0, ...b.equity.slice(0, last + 1).map((_, i) => i + 1)], ys: [0, ...b.equity.slice(0, last + 1)] };
}

export default function Lesson() {
  const n = useMemo(strategyLabNumbers, []);
  const winterHdd = useMemo(labWinterHdd, []);

  // ---- Figure 1: the lab.
  const s = useScenario('strategy-lab', STRATEGY_LAB_DEFAULTS);
  const st = useDeferredValue(s.state);
  const out = useMemo(() => labOutcome(st), [st]);
  const book = out.book;
  const eq = equityPoints(book);
  const peaks = useMemo(() => {
    let p = 0;
    return eq.ys.map((v) => (p = Math.max(p, v)));
  }, [eq.ys]);
  const bustX = out.bust === null ? null : out.bust + 1;
  const live = bustX === null ? eq : { xs: eq.xs.slice(0, bustX + 1), ys: eq.ys.slice(0, bustX + 1) };
  const ghost = bustX === null ? null : { xs: eq.xs.slice(bustX), ys: eq.ys.slice(bustX) };
  const capEnd = out.bust === null ? book.capital.length : out.bust + 1;
  const capXs = [...book.capital.slice(0, capEnd).map((_, i) => i), capEnd];
  const capYs = [...book.capital.slice(0, capEnd), book.capital[capEnd - 1]];
  const y1 = moneyDomain([...eq.ys, ...book.capital, st.capital]);
  const trades = book.trades.length;
  const wins = book.trades.filter((o) => o.pnl > 0).length;
  const worstIdx = book.pnl.indexOf(book.worstMonth);
  const capIdx = book.capital.indexOf(book.peakCapital);
  const roc = book.peakCapital > 0 ? book.total / book.peakCapital : 0;
  const solved = strategyLabSolved(s.state);
  const largest = useMemo(() => labLargestSize(LAB_CHALLENGE.strategy, LAB_CHALLENGE.costs, LAB_CHALLENGE.capital), []);
  const challengeAt = s.state.strategy === LAB_CHALLENGE.strategy && s.state.costs === LAB_CHALLENGE.costs && s.state.capital === LAB_CHALLENGE.capital;
  const live1 = labOutcome(s.state);
  const status = !challengeAt
    ? 'Choose “All four”, costs ×1 and $1 million of capital.'
    : live1.bust !== null
      ? `At ×${s.state.size} the book needs ${cash(live1.book.capital[live1.bust])} in ${monthName(live1.bust)} and runs out of capital.`
      : `At ×${s.state.size} the book survives, needing at most ${cash(live1.book.peakCapital)}. Could it be bigger?`;
  const overPeak = labOutcome({ ...LAB_CHALLENGE, size: Math.min(LAB_SIZE_MAX, largest + 1) });

  // ---- Figure 2: hindsight against walking forward.
  const w = useScenario('strategy-lab-walk', WALK_DEFAULTS);
  const wk = useMemo(() => labWalk(w.state.pick), [w.state.pick]);
  const hEq = equityPoints(wk.hindsight);
  const wEq = equityPoints(wk.walk);
  const y2 = moneyDomain([...hEq.ys, ...wEq.ys]);
  const walkYears = pnlByYear(wk.walk);
  const WALK_TEXT: Record<WalkPick, { name: string; used: string; happened: string; color: string }> = {
    spread: { name: 'March/April rule', used: 'threshold', happened: 'Nov 1 gap', color: TEXT.gold },
    metro: { name: 'Metro fair-value rule', used: 'fair value', happened: 'realized', color: TEXT.green },
    skip: { name: 'Metro desk', used: 'skip if colder', happened: 'coldest fcst', color: TEXT.teal },
    ridgeback: { name: 'Ridgeback desk', used: 'growth', happened: 'Bcf/d', color: TEXT.orange },
  };
  const walkName = WALK_TEXT[w.state.pick].name;
  const usedLabel = WALK_TEXT[w.state.pick].used;
  const happenedLabel = WALK_TEXT[w.state.pick].happened;

  return (
    <LessonPage id="gas/6.5">
      <P>
        <a href={lessonHref('gas/6.4')}>The previous lesson</a> weighed the region’s physical assets against what they cost. Before it, the chapter built four
        trading strategies on what the course had taught: a weather forecast (<a href={lessonHref('gas/6.1')}>Lesson 6.1</a>), the storage behind a calendar spread
        (<a href={lessonHref('gas/6.2')}>Lesson 6.2</a>), and the production and pipes behind two kinds of basis (<a href={lessonHref('gas/6.3')}>Lesson 6.3</a>).
        Each looked good somewhere, but Lesson 6.2 warned that a rule tuned on the same history it is tested on almost always finds a setting that looks good.
      </P>
      <P>
        A <K c="price">backtest</K> — running a strategy through the past as if it had been traded — is worth only as much as its honesty about three things:
        what trading costs, how much cash the strategy ties up along the way, and what the trader could have known at the time. This lesson holds the four
        strategies to all three, and then answers the chapter’s question: can an understanding of these physical systems produce a profitable market strategy?
      </P>
      <P>
        The four run as the earlier lessons left them, at {word(LAB_LOTS)} lots or {fmt(LAB_VOLUME)} MMBtu a day: the weather desk of Lesson 6.1, with skill{' '}
        {fmt(LAB_WEATHER.skill, 1)} and a {LAB_WEATHER.thresholdF} °F threshold; the spread, bought on November 1 when storage is at least {n.spreadHindsight} Bcf
        behind plan, the threshold that did best in Lesson 6.2; the Ridgeback desk, extrapolating the production trend seen so far, counting on the announced
        expansion and trading {word(LAB_RIDGEBACK.lead)} months ahead; and the Metro desk, selling each winter month’s basis unless the forecast is colder than
        normal.
      </P>
      <P>
        As in Lesson 6.2, every position is marked to each month’s curve. Trading costs{' '}
        {usd(n.futuresFee, 3)} per MMBtu each way for futures and index gas — {usd(n.futuresFee * LOT_MMBTU)} a lot — and {usd(n.basisFee, 2)} for basis swaps.
        And every open position ties up <K c="price">margin</K>, cash posted with the exchange so that a loser can always pay. Exchanges set it from how far
        prices can move; ours covers three standard deviations of a month’s move in the history: {usd(n.futuresMargin)} per futures lot and{' '}
        {usd(n.basisMargin, 2)} per MMBtu of a basis swap, {usd(n.basisMargin * LAB_VOLUME * 31)} for a 31-day month at {fmt(LAB_VOLUME)} MMBtu a day. The{' '}
        <K c="price">capital</K> a strategy needs at any moment is its margin plus any losses so far, less any profits. Run out of it, and the positions are
        closed at that month’s prices, whatever they would have done next.
      </P>
      <P>
        In the next demonstration, choose a strategy, its size, the trading costs and the capital set aside. The chart is the running profit after fees, month by
        month, with each fall from a high point shaded and the capital the strategy needs as a dashed step. Under it are two physical drivers for each year — its
        winter, in <Tn tone="teal">heating degree days</Tn> above or below normal from November through March, and Ridgeback’s <K tone="orange">production</K> against what its pipes
        can take — and the strategy’s profit that year:
      </P>

      <Figure name="Gas Strategy Lab" scenario={s}>
        <Segmented
          label="Strategy"
          value={s.state.strategy}
          onChange={(v) => s.set({ strategy: v })}
          options={[
            { value: 'weather', label: 'Weather' },
            { value: 'spread', label: 'March/April' },
            { value: 'ridgeback', label: 'Ridgeback' },
            { value: 'metro', label: 'Metro' },
            { value: 'all', label: 'All four' },
          ]}
        />
        <XYChart
          xDomain={[0, N_MONTHS + 1]}
          yDomain={y1.domain}
          yTicks={y1.ticks}
          xTicks={YEAR_TICKS}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={axisMoney}
          yLabel="Profit after fees, and capital needed"
          height={250}
          vLines={[...YEAR_LINES, ...(bustX === null ? [] : [{ at: bustX, color: GRAPHIC.red, width: 1.5, label: 'out of capital', labelAt: 'start' as const }])]}
          hLines={[{ at: st.capital, color: '#333', dash: '1 0', width: 1, label: 'capital set aside', labelAt: bustX !== null && bustX < 24 ? 'end' : 'start' }]}
          series={[
            { xs: live.xs, ys: peaks.slice(0, live.xs.length), lows: live.ys, color: DRAWDOWN, kind: 'band' },
            { xs: capXs, ys: capYs, color: CAPITAL, kind: 'step', width: 1.5, dash: '4 3' },
            ...(ghost ? [{ xs: ghost.xs, ys: ghost.ys, color: EQUITY, width: 1.5, dash: '2 3', opacity: 0.45 }] : []),
            { xs: live.xs, ys: live.ys, color: EQUITY, width: 2.5 },
          ]}
          ariaLabel={`${PICK_NAME[st.strategy]} at ×${st.size}, costs ×${st.costs}: ${out.bust === null ? `${money(book.total)} after fees over eight years` : `closed out in ${monthName(out.bust)} at ${money(out.final)}`}; largest fall ${money(out.maxDrawdown)}; capital needed ${out.bust === null ? `at most ${money(book.peakCapital)}` : `${money(book.capital[out.bust])} at the close-out`} against ${money(st.capital)} set aside.`}
        />
        <YearRows
          ariaLabel={`Each year’s winter against normal: ${winterHdd.map((v, y) => `Year ${y + 1} ${signed(v)} heating degree days`).join(', ')}. Ridgeback production against takeaway, and the strategy’s profit each year.`}
          rows={[
            { label: 'winter HDD', cells: winterHdd.map((v) => ({ text: signed(v), color: TEXT.teal })) },
            {
              label: 'Ridgeback',
              cells: Array.from({ length: HISTORY_YEARS }, (_, y) => {
                const c = conditionsOf(y);
                const t = ridgebackTakeaway(c);
                return { text: `${fmt(c.ridgeback, 2)} ${c.ridgeback > t ? '>' : '<'} ${fmt(t, 2)}`, color: c.ridgeback > t ? TEXT.red : TEXT.orange };
              }),
            },
            { label: 'profit', cells: out.byYear.map((v) => (v === null ? { text: '—' } : { text: axisMoney(v), color: v < 0 ? TEXT.red : TEXT.green })) },
          ]}
        />
        <Legend
          items={[
            { label: 'profit after fees', color: EQUITY, kind: 'line' },
            { label: 'fall from a high', color: DRAWDOWN },
            { label: 'capital needed', color: CAPITAL, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: out.bust === null ? 'profit after fees' : 'closed out at', value: money(out.final), tone: out.final < 0 ? 'red' : 'green' },
            { label: 'fees', value: money(out.fees) },
            { label: 'largest fall', value: money(out.maxDrawdown), tone: 'red' },
            { label: out.bust === null ? 'capital needed' : 'capital it needed', value: money(out.bust === null ? book.peakCapital : book.capital[out.bust]) },
            { label: 'profit ÷ capital', value: out.bust === null ? `${fmt(roc, 1)}×` : '—' },
          ]}
        />
        <Slider label="Size" value={s.state.size} min={1} max={LAB_SIZE_MAX} step={1} onChange={(v) => s.set({ size: Math.round(v) })} display={`×${s.state.size}`} />
        <Slider
          label="Trading costs"
          tone="green"
          value={s.state.costs}
          min={0}
          max={LAB_COSTS_MAX}
          step={1}
          onChange={(v) => s.set({ costs: Math.round(v) })}
          display={`×${s.state.costs}`}
        />
        <Slider
          label="Capital set aside"
          tone="green"
          value={s.state.capital}
          min={LAB_CAPITAL.min}
          max={LAB_CAPITAL.max}
          step={LAB_CAPITAL.step}
          onChange={(v) => s.set({ capital: Math.round(v / LAB_CAPITAL.step) * LAB_CAPITAL.step })}
          display={money(s.state.capital)}
        />
        <Caption>
          {out.bust !== null
            ? `${PICK_NAME[st.strategy]} at ×${st.size}: in ${monthName(out.bust)} the book needs ${money(book.capital[out.bust])} against the ${money(st.capital)} set aside, and is closed out at ${money(out.final)}. The faint line is what it would have gone on to make.`
            : trades === 0
              ? `${PICK_NAME[st.strategy]} make no trades.`
              : `${PICK_NAME[st.strategy]}: ${trades} trades, ${wins} of them profitable after fees; the worst month, ${monthName(Math.max(0, worstIdx))}, ${book.worstMonth < 0 ? `lost ${money(-book.worstMonth)}` : 'lost nothing'}. The capital needed peaks at ${money(book.peakCapital)} in ${monthName(Math.max(0, capIdx))}.`}
        </Caption>
      </Figure>

      <P>
        The weather trades make {cash(n.weather.total)} from {fmt(n.weather.trades.length)} months, {pct(n.weather.winRate)} of them winners. Its misses are small, and it never
        needs more than {cash(n.weather.peakCapital)} of capital. The March/April rule makes {cash(n.spread.total)} but needs{' '}
        {cash(n.spread.peakCapital)} of capital, {cash(Math.max(...n.spread.margin))} of it margin, because our bookkeeping charges each leg of the spread a full
        lot’s margin (real exchanges charge a spread less); on the way it falls{' '}
        {cash(n.spread.maxDrawdown)} from its high, when Year {n.spreadWorstYear + 1}’s winter goes against it. The Ridgeback desk makes {cash(n.ridgeback.total)}{' '}
        from {word(n.ridgeback.trades.length)} trades, every one a winner, and {pct(n.ridgeback.total / n.all.total)} of what the four make together:{' '}
        {cash(n.ridgeSold)} selling Year {n.ridgeSoldYear + 1}’s basis before the glut and {cash(n.ridgeBought)} buying Year {n.ridgeBoughtYear + 1}’s before the
        expansion. The Metro desk makes {cash(n.metro.total)}, but its fees are {cash(n.metro.totalFees)}; at ten times the costs it keeps {cash(n.metroCostly)}.
        Its edge before fees is about {usd(n.metroEdge, 2)} per MMBtu sold, and a thin edge is the first thing costs take.
      </P>
      <P>
        Together the four make {cash(n.all.total)} and need at most {cash(n.all.peakCapital)}, less than the Ridgeback desk alone, because by the time its swaps
        open, the others’ profits are posting part of its margin. The peak comes early, in {monthName(n.allPeakMonth)}, when the book holds its first spread and a
        month of weather trades and has made little yet. That is the moment the size of a book is decided:
      </P>

      <Challenge
        id="a"
        figure="Gas Strategy Lab"
        question="Set aside $1 million and keep trading costs at ×1. What’s the largest size at which all four strategies together survive the eight years?"
        solved={solved}
        status={status}
        success={`Solved: ×${s.state.size}. All four need at most ${cash(live1.book.peakCapital)} at this size. At ×${Math.min(LAB_SIZE_MAX, largest + 1)} they would need ${cash(overPeak.bust === null ? overPeak.book.peakCapital : overPeak.book.capital[overPeak.bust])} in ${monthName(overPeak.bust ?? 0)}, and the book would be closed out at ${cash(overPeak.final)} — before the Ridgeback trades that made most of the money. Size multiplies the profit and the capital needed alike, so it never improves the return on capital; it decides only whether the strategy is still standing when its best trade arrives.`}
      />

      <H2>Hindsight</H2>
      <P>
        Every setting in <FigRef to="Gas Strategy Lab">the first demonstration</FigRef> was chosen by someone who had seen all eight years — the spread’s
        threshold most obviously. A fairer test is a <K c="price">walk-forward</K> test. Each year, the trader may use only the years before it: it tunes its rule
        on the past, trades the next year with it, and moves on, so whatever it makes is what the rule could have made in real time. In the next demonstration,
        four rules run twice, tuned with hindsight on all eight years (dashed) and walked forward (solid). The March/April rule re-chooses its threshold each
        November. The Metro desk re-chooses how cold a forecast must be before it stands aside, starting from selling every month. A second, different Metro rule
        ignores the forecast and sells (or buys) winter basis whenever the forward is more than {usd(LAB_FAIR_THRESHOLD, 2)} above (or below) the average of the
        same month in the winters seen so far. The Ridgeback desk estimates growth from the production seen so far. Under the chart is what the walk-forward
        trader used each year, what happened, and what it made:
      </P>

      <Figure name="Gas Strategy Lab · walk-forward" scenario={w}>
        <Segmented
          label="Rule"
          value={w.state.pick}
          onChange={(v) => w.set({ pick: v })}
          options={[
            { value: 'spread', label: 'March/April threshold' },
            { value: 'skip', label: 'Metro skip' },
            { value: 'metro', label: 'Metro fair value' },
            { value: 'ridgeback', label: 'Ridgeback trend' },
          ]}
        />
        <XYChart
          xDomain={[0, N_MONTHS + 1]}
          yDomain={y2.domain}
          yTicks={y2.ticks}
          xTicks={YEAR_TICKS}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={axisMoney}
          yLabel="Profit after fees"
          height={230}
          vLines={YEAR_LINES}
          hLines={[{ at: 0, color: '#bbb', width: 1 }]}
          series={[
            { xs: hEq.xs, ys: hEq.ys, color: HINDSIGHT, width: 2, dash: '6 4', label: 'hindsight', labelColor: TEXT.gray },
            { xs: wEq.xs, ys: wEq.ys, color: EQUITY, width: 2.5, label: 'walk-forward', labelColor: TEXT.green },
          ]}
          ariaLabel={`The ${walkName}: tuned with hindsight it makes ${money(wk.hindsight.total)}; walked forward, ${money(wk.walk.total)}.`}
        />
        <YearRows
          ariaLabel={`What the walk-forward ${walkName} used each year: ${wk.used.join(', ')}; what happened: ${wk.happened.join(', ')}.`}
          rows={[
            { label: usedLabel, cells: wk.used.map((t) => ({ text: t, color: TEXT.ink })) },
            { label: happenedLabel, cells: wk.happened.map((t) => ({ text: t, color: WALK_TEXT[w.state.pick].color })) },
            { label: 'profit', cells: walkYears.map((v) => ({ text: Math.abs(v) < 1 ? '—' : axisMoney(v), color: v < 0 ? TEXT.red : TEXT.green })) },
          ]}
        />
        <Readouts
          items={[
            { label: 'with hindsight', value: money(wk.hindsight.total), tone: wk.hindsight.total < 0 ? 'red' : 'green' },
            { label: 'walked forward', value: money(wk.walk.total), tone: wk.walk.total < 0 ? 'red' : 'green' },
            { label: 'trades walked forward', value: fmt(wk.walk.trades.length) },
            { label: 'largest fall', value: money(wk.walk.maxDrawdown), tone: 'red' },
          ]}
        />
        <Caption>
          {`With hindsight the ${walkName} uses ${wk.hindsightSetting} and ${wk.hindsight.trades.length === 0 ? 'never trades' : `${wk.hindsight.total < 0 ? 'loses' : 'makes'} ${money(Math.abs(wk.hindsight.total))} from ${word(wk.hindsight.trades.length)} trades`}; walked forward it ${wk.walk.total < 0 ? 'loses' : 'makes'} ${money(Math.abs(wk.walk.total))} from ${word(wk.walk.trades.length)}.`}
        </Caption>
      </Figure>

      <P>
        The March/April rule falls apart. Tuned on all seven winters it chose {n.spreadHindsight} Bcf and made {cash(n.spreadWalk.hindsight.total)}; walked
        forward it loses {cash(-n.spreadWalk.walk.total)}. After Year 1 every threshold that had traded had won, so in Year 2 it used the lowest, bought, and lost.
        After Year 2 it raised the bar to {n.walked[2]} Bcf and so stood aside in Year 3, the winter that paid most; after Year 3 it went back to buying everything
        and walked into Year 4, a winter {fmt(-winterHdd[3])} heating degree days below normal, which cost {cash(-n.winters[3].pnl)}. Each winter’s best
        threshold was a fact about the winters already past, not about the one to come.
      </P>
      <P>
        The Metro rule keeps learning the wrong lesson. After two calm winters January’s basis had averaged {signedUsd(n.fairY3)}, the forward of{' '}
        {signedUsd(n.janFwd)} looked far too dear, and the rule sold — into Year 3’s January, which averaged {signedUsd(n.janY3)}. Afterwards the average stood at{' '}
        {signedUsd(n.fairY4)}, the same forward looked cheap, and it bought into a calm Year 4. Walked forward it loses {cash(-n.metroWalk.walk.total)}; with
        hindsight it never trades at all, because the market priced its forwards to the eight-winter average. A breakaway that comes once in eight winters can’t
        be priced from two or three of them.
      </P>
      <P>
        The Metro desk’s skip rule does no better once its setting has to be learned. Standing aside had never helped before Year 3, so the walk-forward desk sold
        all of that winter, January included, whose forecast ran {signedF(n.skipColdest[2])} °F colder than normal; afterwards it stood aside only on forecasts more
        than {n.skipWalked[3] ?? 0} °F colder,{' '}
        {n.skipColdest.slice(3).every((c) => c <= (n.skipWalked[3] ?? 0)) ? 'which no later forecast reached' : 'and traded the later winters with that'}. Walked
        forward it {n.skipWalk.walk.total < 0 ? 'loses' : 'makes'} {cash(Math.abs(n.skipWalk.walk.total))}, against {cash(n.skipWalk.hindsight.total)} for the best
        threshold in hindsight. The lab’s setting, standing aside on any cold forecast, makes {cash(n.metro.total)}; the case for it is the physics — don’t sell
        insurance against a cold week you can see coming — not the backtest.
      </P>
      <P>
        Walked forward, the Ridgeback desk makes the same {cash(n.ridgeWalk.walk.total)}. Its sell side needed nothing hindsight supplies: from Year 2 on, the
        production seen so far showed growth of {fmt(n.growth, 2)} Bcf/d a year, and the {fmt(n.takeaway, 2)} Bcf/d of takeaway it would outrun was public. Its buy side is another matter. The {cash(n.ridgeBought)} it made buying Year {n.ridgeBoughtYear + 1}’s basis
        rested on the expansion opening on time, and walking forward can’t test that: the history holds one expansion, and it opened on time. In the world of{' '}
        <a href={lessonHref('gas/6.3')}>Lesson 6.3</a> where it opens a year late, the same {word(n.lateSameCount)} purchases{' '}
        {n.lateSame < 0 ? 'lose' : 'make'} {cash(Math.abs(n.lateSame))} between them, {word(n.lateSameLosers)} of them at a loss.
      </P>

      <H2>The chapter’s answer</H2>
      <P>
        Can an understanding of these physical systems produce a profitable market strategy? In our history, yes, in a particular way. Understanding paid where it
        held information the price didn’t: a production trend carried forward, a weather forecast better than the market’s and — so long as the pipe opened on time
        — an expansion announced before it opened.
        It didn’t pay where the market already knew what we knew: storage on November 1 was already in the spread, and Metro’s breakaways in its premium. And, as
        Lesson 6.3 found, understanding set the shape of each bet: a ceiling on Ridgeback’s basis, none on Metro’s, and nothing but the weather in a spread held
        through a winter.
      </P>
      <P>
        Two cautions keep the answer honest. Most of the money came from one event — Year 5’s glut and the pipe that ended it — and eight years hold only one. A
        backtest can’t tell skill from luck on a single event, so the confidence has to come from the mechanism, production measured against takeaway a year
        ahead, rather than from the profit. And our market is naive on purpose: it prices next year as if nothing will change, and it draws its curves as if the
        weather from today on will be normal. Real markets are full of people who understand pipes and weather; there, the edge is not in understanding the system
        but in understanding it better, sooner or more cheaply than whoever is on the other side of the trade.
      </P>
      <P>
        This chapter took the region as given: its pipes, its storage fields, its weather. The capstone hands it over. In{' '}
        <a href={lessonHref('gas/7.1')}>Chapter 7</a> you’ll build a gas network of your own, run its market, forecast where it binds, trade a portfolio on it, and
        test the result on winters no one has seen — the whole course, from the pipe to the trade, in one
        system.
      </P>
    </LessonPage>
  );
}
