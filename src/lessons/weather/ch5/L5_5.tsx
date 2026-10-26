import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CME_TICK, WINTER_SEASON, monthContract, type ContractSpec } from '../../../engines/weather/pricing';
import { MARKET, marketQuote, replay, tradeStats, type Trade, type TradeStats } from '../../../engines/weather/market';
import { decisions, errorToClaim, hedgeAgainstBudget, pitHistogram, rehedge, type BudgetHedge } from '../../../engines/weather/backtest';
import { regress, utilityWinters } from '../../../engines/weather/exposure';
import { CROSS_IDS, WEEKS_PER_WINTER, crossMarketReplay, type CrossReplay } from '../../../engines/weather/crossBacktest';
import { DRIVER_DEFAULTS, type InstrumentId } from '../../../engines/weather/crossMarket';
import { MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The backtest: one decision per winter month, held to settlement.

export type MonthKey = 'dec' | 'jan' | 'feb';
const MONTH_OF: Record<MonthKey, number> = { dec: 11, jan: 0, feb: 1 };

/** Contract years replayed: 2–40, so every decision up to 60 days ahead falls inside the archive. */
export const YEARS = Array.from({ length: 39 }, (_, i) => i + 2);

export interface BacktestState {
  month: MonthKey;
  /** Days before the month starts that the decision is made. */
  lead: number;
  /** Index points by which our number must beat the market's price. */
  threshold: number;
  /** The market's half-spread, index points. */
  spread: number;
  /** Days after the trade date that the forecast used was issued — a bug, not a strategy. */
  lookAhead: number;
  /** Fenwick Bay's winter warming per °C of Niño-3.4, °F. */
  ensoF: number;
}

export const BACKTEST_DEFAULTS: BacktestState = { month: 'jan', lead: 60, threshold: 5, spread: 5, lookAhead: 0, ensoF: 1 };

export interface BacktestRun {
  trades: Trade[];
  stats: TradeStats;
  /** Standard error of the average trade, $. */
  se: number;
  firstHalf: TradeStats;
  secondHalf: TradeStats;
}

const runCache = new Map<string, BacktestRun>();

/** Replay the rule over the archive's winters, one contract per trade. */
export function runBacktest(st: BacktestState): BacktestRun {
  const key = `${st.month}|${st.lead}|${st.threshold}|${st.spread}|${st.lookAhead}|${st.ensoF}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const knobs = { ensoF: st.ensoF };
  const trades = replay(
    monthContract('HDD', MONTH_OF[st.month]),
    YEARS,
    st.lead,
    { threshold: st.threshold, size: 1, view: { lookAheadDays: st.lookAhead, knobs } },
    { ...MARKET, halfSpread: st.spread },
    knobs,
  );
  const stats = tradeStats(trades);
  const run: BacktestRun = {
    trades,
    stats,
    se: stats.trades ? stats.sd / Math.sqrt(stats.trades) : 0,
    firstHalf: tradeStats(trades.filter((t) => t.year <= 20)),
    secondHalf: tradeStats(trades.filter((t) => t.year > 20)),
  };
  if (runCache.size > 400) runCache.clear();
  runCache.set(key, run);
  return run;
}

const pitCache = new Map<string, { hist: number[]; ratio: number }>();

/** Where each year's settled index fell in the distribution honestly available on the trade date. */
export function calibration(st: BacktestState): { hist: number[]; ratio: number } {
  const key = `${st.month}|${st.lead}|${st.lookAhead}|${st.ensoF}`;
  const hit = pitCache.get(key);
  if (hit) return hit;
  const ds = decisions(monthContract('HDD', MONTH_OF[st.month]), YEARS, st.lead, st.lookAhead, { ensoF: st.ensoF });
  const out = { hist: pitHistogram(ds.map((d) => d.pit)), ratio: errorToClaim(ds) };
  if (pitCache.size > 200) pitCache.clear();
  pitCache.set(key, out);
  return out;
}

/** The ENSO slider's step, °F per °C. */
export const ENSO_STEP = 0.1;
/** A pull strong enough for the edge to clear its error bars, °F per °C. */
export const STRONG_PULL = 1.5;

/** How far ahead the forecasts reach, days (Lesson 5.2's "next 15 days"). */
export const FORECAST_REACH = 15;
/** The first challenge decides this many days before January. */
export const REACH_LEAD = 30;

/** Whether a look-ahead leaves every decision of the honest backtest exactly as it was. */
export function sameAsHonest(st: BacktestState): boolean {
  const a = runBacktest(st).trades;
  const b = runBacktest({ ...st, lookAhead: 0 }).trades;
  return a.length === b.length && a.every((t, i) => t.year === b[i].year && t.side === b[i].side && Math.abs(t.fair - b[i].fair) < 1e-9);
}

/** The shortest look-ahead, in days, that changes any decision of the backtest. */
export function shortestChangingLookAhead(st: BacktestState): number | null {
  for (let l = 1; l <= 30; l++) if (!sameAsHonest({ ...st, lookAhead: l })) return l;
  return null;
}

/**
 * The first challenge: deciding 30 days before January, with the rest of the rule and the physics
 * as they start, the shortest look-ahead that changes the backtest at all — predicted from the
 * forecasts' 15-day reach as 30 − 15.
 */
export function lookAheadSolved(st: BacktestState): boolean {
  const d = BACKTEST_DEFAULTS;
  if (st.month !== 'jan' || st.lead !== REACH_LEAD || st.threshold !== d.threshold || st.spread !== d.spread || st.ensoF !== d.ensoF) return false;
  return st.lookAhead > 0 && st.lookAhead === shortestChangingLookAhead(st);
}

// ---------------------------------------------------------------------------
// Lesson 5.4's trade on history: every winter week, one contract in each market where the gap
// between our fresh forecast and the market's older one beats that market's half-spread.

export interface CrossState {
  /** How many days before ours the market's forecasts were issued. */
  lag: number;
  /** Pipeline capacity into the region, million MMBtu per day. */
  pipeline: number;
  /** Wind on Hollin Ridge, m/s: steady through the week and known to both sides. */
  wind: number;
}

export const CROSS_DEFAULTS: CrossState = { lag: 2, pipeline: DRIVER_DEFAULTS.pipeline / 1e6, wind: DRIVER_DEFAULTS.windMs };
export const CROSS_PIPELINE_STEP = 0.05;

const crossCache = new Map<string, CrossReplay>();

/** The cross-market rule replayed over winters 2–40, twelve weeks each from December 1. */
export function crossRun(st: CrossState): CrossReplay {
  const key = `${st.lag}|${st.pipeline}|${st.wind}`;
  const hit = crossCache.get(key);
  if (hit) return hit;
  const out = crossMarketReplay(YEARS, st.lag, { pipeline: Math.round(st.pipeline * 1e6), windMs: st.wind });
  if (crossCache.size > 60) crossCache.clear();
  crossCache.set(key, out);
  return out;
}

/** Whether a market's average trade is more than two standard errors from zero: +1 above, −1 below, 0 neither. */
export function clearOfZero(s: { trades: number; mean: number; se: number }): 1 | -1 | 0 {
  if (s.trades < 2) return 0;
  return s.mean - 2 * s.se > 0 ? 1 : s.mean + 2 * s.se < 0 ? -1 : 0;
}

/** The pipeline capacity of the second challenge: the slider's tightest, where the gas edge shows. */
export const TIGHT_PIPELINE = 1.2;
export const WIND_STEP = 0.5;
export const WIND_MIN = 3;
export const WIND_MAX = 13;

let mostWind: number | null | undefined;
/** With forecasts two days stale and the tightest pipelines, the most wind (on the slider's steps) at which gas's average is still clear of zero. */
export function mostWindGasShows(): number | null {
  if (mostWind !== undefined) return mostWind;
  let best: number | null = null;
  for (let w = WIND_MIN; w <= WIND_MAX + 1e-9; w += WIND_STEP) {
    if (clearOfZero(crossRun({ lag: CROSS_DEFAULTS.lag, pipeline: TIGHT_PIPELINE, wind: w }).stats.gas) !== 1) break;
    best = w;
  }
  mostWind = best;
  return best;
}

export function atTightPipelines(st: CrossState): boolean {
  return st.lag === CROSS_DEFAULTS.lag && Math.abs(st.pipeline - TIGHT_PIPELINE) < 1e-9;
}

/** The second challenge: forecasts two days stale, the tightest pipelines, and the most wind at which the gas edge still shows. */
export function gasVisibleSolved(st: CrossState): boolean {
  return atTightPipelines(st) && st.wind === mostWindGasShows();
}

// ---------------------------------------------------------------------------
// The hedge: Fenwick Gas & Light sells seasonal strips the day before November 1.

const SEASON: ContractSpec = { kind: 'HDD', months: WINTER_SEASON, type: 'future', strike: 0, tick: CME_TICK };
export const HEDGE_STEP = 100;
export const HEDGE_MAX = 4000;
export const HEDGE_DAYS_BEFORE = 1;

export interface HedgeState {
  contracts: number;
  variability: number;
  ensoF: number;
}

export const HEDGE_DEFAULTS: HedgeState = { contracts: 0, variability: 1, ensoF: 1 };

export interface HedgeBase {
  base: BudgetHedge;
  /** The utility's margin per HDD, from its 40 winters, $. */
  slope: number;
  r2: number;
}

const hedgeCache = new Map<string, HedgeBase>();

/** The utility's winters, its budget fit and the quotes, for a setting of the physics (unhedged). */
export function hedgeBase(variability: number, ensoF: number): HedgeBase {
  const key = `${variability}|${ensoF}`;
  const hit = hedgeCache.get(key);
  if (hit) return hit;
  const knobs = { variability, ensoF };
  const w = utilityWinters(knobs);
  const margins = w.map((x) => x.margin);
  const fit = regress(
    w.map((x) => x.hdd),
    margins,
  );
  const base = hedgeAgainstBudget(SEASON, w.map((x) => x.winter), margins, fit, 0, HEDGE_DAYS_BEFORE, (y, t) => marketQuote(SEASON, y, t, MARKET, knobs), knobs);
  const out = { base, slope: fit.slope, r2: fit.r2 };
  if (hedgeCache.size > 100) hedgeCache.clear();
  hedgeCache.set(key, out);
  return out;
}

export function hedgeWith(st: HedgeState): BudgetHedge {
  return rehedge(hedgeBase(st.variability, st.ensoF).base, st.contracts, CME_TICK);
}

/** The number of strips, on the slider's steps, that leaves the misses with the smallest spread. */
export function bestStrips(variability: number, ensoF: number): number {
  const base = hedgeBase(variability, ensoF).base;
  let best = 0;
  let bestSd = Infinity;
  for (let n = 0; n <= HEDGE_MAX; n += HEDGE_STEP) {
    const sd = rehedge(base, n, CME_TICK).hedgedMissSd;
    if (sd < bestSd - 1e-6) {
      bestSd = sd;
      best = n;
    }
  }
  return best;
}

export function hedgeSolved(st: HedgeState): boolean {
  return st.contracts === bestStrips(st.variability, st.ensoF);
}

/** The first winter the out-of-sample hedge covers: it needs ten earlier winters to fit on. */
export const WALK_FROM = 11;

/**
 * The hedge with nothing fitted in-sample. From winter `from` on, each winter's plan (intercept +
 * slope × the strip's mid) and its strip count (slope ÷ $20, to the slider's hundreds) come from a
 * fit to the winters before it only. Returns the share of the misses' variance it removes, and the
 * share the in-sample hedge (one fit to all 40 winters, the best strip count) removes over the
 * same winters.
 */
export function walkForwardHedge(variability = 1, ensoF = 1, from = WALK_FROM): { outOfSample: number; inSample: number; winters: number } {
  const ys = hedgeBase(variability, ensoF).base.years;
  const best = bestStrips(variability, ensoF);
  const miss: number[] = [];
  const hedged: number[] = [];
  const missIn: number[] = [];
  const hedgedIn: number[] = [];
  for (let k = from - 1; k < ys.length; k++) {
    const past = ys.slice(0, k);
    const fit = regress(
      past.map((y) => y.hdd),
      past.map((y) => y.margin),
    );
    const m = ys[k].margin - (fit.intercept + fit.slope * ys[k].mid);
    const n = Math.round(fit.slope / CME_TICK / HEDGE_STEP) * HEDGE_STEP;
    miss.push(m);
    hedged.push(m + n * CME_TICK * (ys[k].bid - ys[k].hdd));
    missIn.push(ys[k].miss);
    hedgedIn.push(ys[k].miss + best * CME_TICK * (ys[k].bid - ys[k].hdd));
  }
  const variance = (xs: number[]) => {
    const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length;
  };
  return { outOfSample: 1 - variance(hedged) / variance(miss), inSample: 1 - variance(hedgedIn) / variance(missIn), winters: miss.length };
}

// ---------------------------------------------------------------------------
// Drawing.

function kusd(v: number): string {
  if (Math.abs(v) < 0.5) return '$0';
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${fmt(a / 1e6, a >= 1e7 ? 0 : 1)}M` : a >= 1000 ? `$${fmt(a / 1000, a >= 1e4 ? 0 : 1)}k` : `$${fmt(a)}`;
  return (v < 0 ? '−' : '') + s;
}

function cumulative(trades: Trade[]): number[] {
  const byYear = new Map(trades.map((t) => [t.year, t.pnl]));
  let run = 0;
  return YEARS.map((y) => (run += byYear.get(y) ?? 0));
}

function BacktestChart({ run, honest, cal, label }: { run: BacktestRun; honest: BacktestRun | null; cal: { hist: number[]; ratio: number }; label: string }) {
  const cum = cumulative(run.trades);
  const cumH = honest ? cumulative(honest.trades) : null;
  const vals = [0, ...cum, ...(cumH ?? [])];
  const [lo, hi] = niceDomain(Math.min(...vals), Math.max(1000, ...vals), 4);
  const x = scale(YEARS[0] - 0.5, YEARS[YEARS.length - 1] + 0.5, 70, 620);
  const y = scale(lo, hi, 196, 26);
  const xs = YEARS.map(x);
  const byYear = new Map(run.trades.map((t) => [t.year, t]));
  // Per-trade bars.
  const maxAbs = Math.max(1500, ...run.trades.map((t) => Math.abs(t.pnl)));
  const [blo, bhi] = niceDomain(-maxAbs, maxAbs, 2);
  const xb = scale(YEARS[0] - 0.5, YEARS[YEARS.length - 1] + 0.5, 70, 400);
  const yb = scale(blo, bhi, 352, 248);
  // Calibration histogram.
  const total = cal.hist.reduce((s, v) => s + v, 0);
  const hx = scale(0, 5, 452, 620);
  const hy = scale(0, Math.max(total, 10), 352, 248);
  const expected = total / 5;
  return (
    <svg className="chart" viewBox="0 0 640 380" role="img" aria-label={label}>
      <text className="ax" x={70} y={14}>
        Cumulative P&amp;L, one contract a trade
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={kusd} baseline={0} />
      {cumH && <path d={linePath(xs, cumH.map(y))} fill="none" stroke="#9a9a9a" strokeWidth={2} strokeDasharray="6 4" />}
      <path d={linePath(xs, cum.map(y))} fill="none" stroke={TEXT.green} strokeWidth={2.5} strokeLinejoin="round" />
      {YEARS.map((yr, i) => {
        const t = byYear.get(yr);
        if (!t) return null;
        return <circle key={yr} cx={xs[i]} cy={y(cum[i])} r={3} fill={t.pnl >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
      })}
      {[2, 10, 20, 30, 40].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr)} y={212}>
          {yr === 2 ? 'year 2' : yr}
        </text>
      ))}
      <text className="ax" x={70} y={238}>
        Each trade’s P&amp;L
      </text>
      <line className="base" x1={70} x2={400} y1={yb(0)} y2={yb(0)} />
      <text className="ax ax-e" x={64} y={yb(bhi) + 4}>
        {kusd(bhi)}
      </text>
      <text className="ax ax-e" x={64} y={yb(blo) + 4}>
        {kusd(blo)}
      </text>
      {run.trades.map((t) => {
        const cx = xb(t.year);
        const top = yb(Math.max(0, t.pnl));
        const h = Math.abs(yb(t.pnl) - yb(0));
        return <rect key={t.year} x={cx - 3} y={top} width={6} height={Math.max(1, h)} fill={t.pnl >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
      })}
      <text className="ax" x={452} y={238}>
        Where outcomes fell
      </text>
      {cal.hist.map((c, i) => (
        <rect key={i} x={hx(i) + 3} y={hy(c)} width={hx(1) - hx(0) - 6} height={hy(0) - hy(c)} fill={GRAPHIC.blue} opacity={0.7} />
      ))}
      <line x1={452} x2={620} y1={hy(expected)} y2={hy(expected)} stroke="#555" strokeDasharray="4 3" />
      <text className="ax ax-m" x={hx(0.5)} y={368}>
        low
      </text>
      <text className="ax ax-m" x={hx(2.5)} y={368}>
        middle
      </text>
      <text className="ax ax-m" x={hx(4.5)} y={368}>
        high
      </text>
    </svg>
  );
}

const CROSS_COLOR: Record<InstrumentId, string> = { hdd: GRAPHIC.orange, gas: GRAPHIC.green, power: GRAPHIC.gold };
const CROSS_NAME: Record<InstrumentId, string> = { hdd: 'HDD future', gas: 'City-gate gas', power: 'Power' };

/** Each market's running profit over every winter week, one contract a trade, each on its own scale. */
function CrossChart({ run, label }: { run: CrossReplay; label: string }) {
  const n = run.weeks;
  const x = scale(0, n, 70, 620);
  const H = 62;
  const STEP = 96;
  const TOP = 22;
  return (
    <svg className="chart" viewBox={`0 0 640 ${TOP + 3 * STEP}`} role="img" aria-label={label}>
      {CROSS_IDS.map((id, i) => {
        const top = TOP + i * STEP;
        const byWeek = new Map(run.trades[id].map((t) => [(t.winter - YEARS[0]) * WEEKS_PER_WINTER + t.week, t.pnl]));
        let acc = 0;
        const cum = Array.from({ length: n }, (_, k) => (acc += byWeek.get(k) ?? 0));
        const [lo, hi] = niceDomain(Math.min(-1000, ...cum), Math.max(1000, ...cum), 2);
        const y = scale(lo, hi, top + H, top);
        const st = run.stats[id];
        return (
          <g key={id}>
            <text className="ax" x={70} y={top - 8}>
              {CROSS_NAME[id]}: {st.trades} {st.trades === 1 ? 'trade' : 'trades'}, running total
            </text>
            <GridY y={y} ticks={niceTicks(lo, hi, 2)} x0={70} x1={620} format={kusd} baseline={0} />
            <path d={linePath(cum.map((_, k) => x(k + 0.5)), cum.map(y))} fill="none" stroke={CROSS_COLOR[id]} strokeWidth={2} strokeLinejoin="round" />
          </g>
        );
      })}
      {[2, 10, 20, 30, 40].map((w) => (
        <text key={w} className="ax ax-m" x={x((w - YEARS[0]) * WEEKS_PER_WINTER + WEEKS_PER_WINTER / 2)} y={TOP + 3 * STEP - 10}>
          {w === 2 ? 'winter 2' : w}
        </text>
      ))}
    </svg>
  );
}

function HedgeChart({ h, label }: { h: BudgetHedge; label: string }) {
  const vals = h.years.flatMap((y) => [y.miss, y.hedgedMiss]);
  const m = Math.max(5e6, ...vals.map(Math.abs));
  const [lo, hi] = niceDomain(-m, m, 4);
  const x = scale(0.5, h.years.length + 0.5, 70, 620);
  const y = scale(lo, hi, 214, 24);
  return (
    <svg className="chart" viewBox="0 0 640 240" role="img" aria-label={label}>
      <text className="ax" x={70} y={14}>
        Margin against the October plan, by winter
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={kusd} baseline={0} />
      {h.years.map((w, i) => {
        const cx = x(i + 1);
        const top = y(Math.max(0, w.miss));
        const bh = Math.abs(y(w.miss) - y(0));
        const ht = y(Math.max(0, w.hedgedMiss));
        const hh = Math.abs(y(w.hedgedMiss) - y(0));
        return (
          <g key={w.winter}>
            <rect x={cx - 5} y={top} width={10} height={Math.max(1, bh)} fill="#cfcfcf" />
            <rect x={cx - 2.5} y={ht} width={5} height={Math.max(1, hh)} fill={w.hedgedMiss >= 0 ? GRAPHIC.green : GRAPHIC.red} />
          </g>
        );
      })}
      {[1, 10, 20, 30, 40].map((wn) => (
        <text key={wn} className="ax ax-m" x={x(wn)} y={232}>
          {wn === 1 ? 'winter 1' : wn}
        </text>
      ))}
    </svg>
  );
}

const MONTH_OPTIONS: Array<{ value: MonthKey; label: string }> = [
  { value: 'dec', label: 'December' },
  { value: 'jan', label: 'January' },
  { value: 'feb', label: 'February' },
];

export default function Lesson() {
  const s = useScenario('backtest', BACKTEST_DEFAULTS);
  // The rule's threshold and spread stay as Lesson 5.3 left them; this lesson has no controls for them.
  const fixed = useMemo(() => ({ ...s.state, threshold: BACKTEST_DEFAULTS.threshold, spread: BACKTEST_DEFAULTS.spread }), [s.state]);
  const st = useDeferredValue(fixed);
  const run = useMemo(() => runBacktest(st), [st]);
  const honest = useMemo(() => (st.lookAhead > 0 ? runBacktest({ ...st, lookAhead: 0 }) : null), [st]);
  const cal = useMemo(() => calibration(st), [st]);
  const solved = lookAheadSolved(fixed);
  const reachUnchanged = useMemo(() => fixed.lookAhead > 0 && sameAsHonest(fixed), [fixed]);
  const monthName = MONTH_NAMES[MONTH_OF[st.month]];
  const tone = (v: number) => (v > 0.5 ? WX.money : v < -0.5 ? 'red' : 'ink');

  const cx = useScenario('cross', CROSS_DEFAULTS);
  const cst = useDeferredValue(cx.state);
  const cross = useMemo(() => crossRun(cst), [cst]);
  const gas = cross.stats.gas;
  const solved2 = useMemo(() => gasVisibleSolved(cx.state), [cx.state]);

  const hs = useScenario('hedge', HEDGE_DEFAULTS);
  const hst = useDeferredValue(hs.state);
  const hb = useMemo(() => hedgeBase(hst.variability, hst.ensoF), [hst.variability, hst.ensoF]);
  const hedge = useMemo(() => hedgeWith(hst), [hst]);
  const solved3 = hedgeSolved(hs.state);

  // Numbers the prose quotes, from the same engines.
  const q = useMemo(() => {
    const at60 = runBacktest(BACKTEST_DEFAULTS);
    const at0 = { ...BACKTEST_DEFAULTS, lead: 0 };
    const look = (l: number) => runBacktest({ ...at0, lookAhead: l });
    // In-sample tuning: the best month and lead (5-day steps) over the first half of the winters.
    let tuned = { month: 'jan' as MonthKey, lead: 0, first: -Infinity, second: 0 };
    let combos = 0;
    for (const m of ['dec', 'jan', 'feb'] as MonthKey[]) {
      for (let lead = 0; lead <= 60; lead += 5) {
        combos++;
        const r = runBacktest({ ...BACKTEST_DEFAULTS, month: m, lead });
        if (r.firstHalf.mean > tuned.first) tuned = { month: m, lead, first: r.firstHalf.mean, second: r.secondHalf.mean };
      }
    }
    const base = hedgeBase(1, 1);
    const at = (n: number) => rehedge(base.base, n, CME_TICK);
    const hv = hedgeBase(1.5, 1);
    return {
      at60,
      at0: runBacktest(at0),
      l1: look(1),
      l2: look(2),
      l5: look(5),
      l30: look(30),
      reachHonest: runBacktest({ ...BACKTEST_DEFAULTS, lead: REACH_LEAD }),
      pull: runBacktest({ ...BACKTEST_DEFAULTS, ensoF: STRONG_PULL }),
      cal0: calibration(at0),
      cal5: calibration({ ...at0, lookAhead: 5 }),
      cal30: calibration({ ...at0, lookAhead: 30 }),
      tuned,
      combos,
      slope: base.slope,
      r2: base.r2,
      h0: at(0),
      h1000: at(1000),
      h2000: at(2000),
      hBest: at(bestStrips(1, 1)),
      bestN: bestStrips(1, 1),
      h4000: at(4000),
      hv0: rehedge(hv.base, 0, CME_TICK),
      hvBest: rehedge(hv.base, bestStrips(1.5, 1), CME_TICK),
      walk: walkForwardHedge(1, 1),
      cross: crossRun(CROSS_DEFAULTS),
      tight: crossRun({ ...CROSS_DEFAULTS, pipeline: TIGHT_PIPELINE }),
    };
  }, []);
  const c0 = q.cross.stats;
  // Each fifth of an honest calibration histogram catches a binomial share of the decisions.
  const perFifth = YEARS.length / 5;
  const perFifthSd = Math.sqrt(YEARS.length * 0.2 * 0.8);
  const spreadCost = MARKET.halfSpread * CME_TICK * q.bestN;

  const ratioDisplay = (r: TradeStats) => (r.trades ? usd(r.mean) : '—');

  return (
    <LessonPage id="weather/5.5">
      <P>
        This chapter has built the machinery of a weather market. <a href={lessonHref('weather/5.1')}>Lesson 5.1</a> wrote contracts on station indices,{' '}
        <a href={lessonHref('weather/5.2')}>5.2</a> priced them from forecast distributions, <a href={lessonHref('weather/5.3')}>5.3</a> found where the
        simulated market’s prices and ours part company, and <a href={lessonHref('weather/5.4')}>5.4</a> carried a weather view into gas and power. Every one
        of those ideas sounds like money. Before anyone risks any, they replay it over past winters and count what it would have earned: a <b>backtest</b>, the
        most useful tool a trader has and the easiest one to fool yourself with.
      </P>
      <P>
        Its first rule is <b>point-in-time</b> data: each past decision may use only what was known when it was made — the forecast as issued that day, not a
        later revision, and observations up to that day. Our simulated archive holds every forecast the course’s model issued in its 41 years, each stamped
        with its issue day and built only from what had been revealed by then (<a href={lessonHref('weather/3.5')}>Lesson 3.5</a>); we replay them in order
        with the simulated market’s quotes.
      </P>
      <P>
        The every-winter replay of <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> was already a backtest, and a point-in-time one. The next demonstration
        replays the same rule, threshold and spread against the same market, so it starts where 5.3 left off — {q.at60.stats.trades} trades
        in 39 Januaries, {usd(q.at60.stats.mean)} a trade — and adds the means to doubt that number. The top chart is the running{' '}
        <K tone={WX.money}>profit</K>; the lower left shows each trade, the lower right a calibration check we’ll come to; the last control is a deliberate
        bug:
      </P>

      <Figure name="Weather Strategy Backtester" scenario={s}>
        <Segmented label="Contract month" value={s.state.month} onChange={(v) => s.set({ month: v })} options={MONTH_OPTIONS} />
        <BacktestChart
          run={run}
          honest={honest}
          cal={cal}
          label={`Backtest of ${monthName} HDD futures decided ${st.lead} days before the month${st.lookAhead ? `, with forecasts from ${st.lookAhead} days after each trade (a look-ahead bug)` : ''}: ${run.stats.trades} trades, ${usd(run.stats.total)} in all, ${usd(run.stats.mean)} a trade on average, ${pct(run.stats.hitRate)} won. Outcomes fell in the low, lower-middle, middle, upper-middle and high fifths of the honest forecast distributions ${cal.hist.join(', ')} times.`}
        />
        <Legend
          items={[
            { label: st.lookAhead ? 'With the bug' : 'Cumulative P&L', color: TEXT.green, kind: 'line' },
            ...(st.lookAhead ? [{ label: 'Honest', color: '#9a9a9a', kind: 'line' as const, dashed: true }] : []),
            { label: 'Share of outcomes per fifth', color: GRAPHIC.blue },
            { label: 'Flat, if calibrated', color: '#555', kind: 'line' as const, dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'trades', value: fmt(run.stats.trades) },
            { label: 'average trade, ± 2 standard errors', value: run.stats.trades ? `${usd(run.stats.mean)} ± ${usd(2 * run.se)}` : '—', tone: tone(run.stats.mean) },
            { label: 'won', value: run.stats.trades ? pct(run.stats.hitRate) : '—' },
            { label: 'years 2–20 · 21–40, a trade', value: `${ratioDisplay(run.firstHalf)} · ${ratioDisplay(run.secondHalf)}`, tone: WX.money },
            { label: 'errors as a share of the uncertainty claimed', value: pct(cal.ratio), tone: WX.probability },
          ]}
        />
        <Slider label="Decide, days before the month" value={s.state.lead} min={0} max={60} onChange={(v) => s.set({ lead: v })} display={`${s.state.lead} days`} />
        <Slider
          label="ENSO’s pull on the winter"
          tone={WX.temperature}
          value={s.state.ensoF}
          min={0}
          max={3}
          step={ENSO_STEP}
          onChange={(v) => s.set({ ensoF: Math.round(v * 10) / 10 })}
          display={`${fmt(s.state.ensoF, 1)} °F per °C`}
        />
        <Slider
          label="Look-ahead bug"
          tone="red"
          value={s.state.lookAhead}
          min={0}
          max={30}
          onChange={(v) => s.set({ lookAhead: v })}
          display={s.state.lookAhead ? `forecasts from ${s.state.lookAhead} days later` : 'none'}
        />
        <Caption>
          {run.stats.trades
            ? `${run.stats.trades} ${monthName} trades over 39 winters made ${usd(run.stats.total)}; the worst lost ${usd(-Math.min(0, run.stats.worst))}.`
            : `The rule never found a gap wider than the threshold and the spread, so it never traded.`}
          {st.lookAhead ? ' Each decision used a forecast issued after it was made: these results could never have been earned.' : ''}
        </Caption>
      </Figure>

      <P>
        Start with the error bars. A trade’s result swings by {usd(q.at60.stats.sd)} from one winter to the next, so the average of {q.at60.stats.trades}{' '}
        trades is uncertain by about {usd(q.at60.se)}: its <K tone={WX.probability}>standard error</K>, the standard deviation over the square root of the
        number of trades. Two standard errors either side of {usd(q.at60.stats.mean)} reach{' '}
        {q.at60.stats.mean - 2 * q.at60.se < 0 ? 'just past' : 'almost to'} zero.
        Split the winters in half and the same rule averaged {usd(q.at60.firstHalf.mean)} a trade in years 2–20 and {usd(q.at60.secondHalf.mean)} in years 21–40.
        A monthly contract settles once a year, so 39 winters are only 39 draws. This edge is real — it was built into the world — and the backtest can barely
        tell. Raise ENSO’s pull to {fmt(STRONG_PULL, 1)} °F per °C and it stands clear: {q.pull.stats.trades} trades averaging {usd(q.pull.stats.mean)} ±{' '}
        {usd(2 * q.pull.se)}.
      </P>
      <P>
        That makes tuning dangerous. Try every month and decision day in five-day steps, {q.combos} versions of the rule, and keep the best over the first
        half of the winters: {MONTH_NAMES[MONTH_OF[q.tuned.month]]}, {q.tuned.lead} days ahead, at {usd(q.tuned.first)} a trade. In the second half it
        made {usd(q.tuned.second)}. The best of many backtests is partly the luckiest, so choose a rule’s settings for a reason — how far forecasts reach, when
        ENSO is known — not for the best number.
      </P>

      <H2>The look-ahead bug</H2>
      <P>
        The most dangerous error is quieter: a decision that uses information from after its own timestamp. Decide on January 1, 0 days ahead. Honestly
        replayed, the rule averages {usd(q.at0.stats.mean)} a trade and wins {pct(q.at0.stats.hitRate)}. Now raise the look-ahead bug, which feeds each decision the
        forecast issued that many days after the trade — the mistake made when a forecast database is keyed by the day forecast rather than the day issued,
        or a revision overwrites the original. With a day of look-ahead the average is {usd(q.l1.stats.mean)}; with five,{' '}
        {usd(q.l5.stats.mean)}, winning {pct(q.l5.stats.hitRate)}; with thirty, the forecasts have seen the whole month, {pct(q.l30.stats.hitRate)} of its{' '}
        {q.l30.stats.trades} trades win, and they average {usd(q.l30.stats.mean)}. None of it could have been earned.
      </P>

      <Challenge
        id="a"
        question={`Decide ${REACH_LEAD} days before January, with ENSO’s pull as it starts. Predict first, from how far a forecast reaches — the ${FORECAST_REACH} days of Lesson 5.2 — the shortest look-ahead that changes the backtest at all. Then check it against the honest ghost line.`}
        solved={solved}
        status={
          fixed.month !== 'jan' || fixed.lead !== REACH_LEAD || fixed.ensoF !== BACKTEST_DEFAULTS.ensoF
            ? `Set January, ${REACH_LEAD} days ahead, and ENSO’s pull at ${fmt(BACKTEST_DEFAULTS.ensoF, 1)} °F per °C.`
            : fixed.lookAhead === 0
              ? 'Make your prediction, then raise the look-ahead bug.'
              : reachUnchanged
                ? `With ${fixed.lookAhead} days of look-ahead, every decision is exactly the honest one.`
                : `With ${fixed.lookAhead} days of look-ahead the backtest has changed. Is that the shortest look-ahead that does it?`
        }
        success={`Solved. ${REACH_LEAD} days ahead, a forecast leaked from up to ${fixed.lookAhead - 1} days later still ends before January 1: it knows nothing about the month, so the bug changes nothing. At ${fixed.lookAhead} days its ${FORECAST_REACH}-day reach touches January, and the results move — ${run.stats.trades} trades averaging ${usd(run.stats.mean)}, against ${q.reachHonest.stats.trades} averaging ${usd(q.reachHonest.stats.mean)} honestly. A leak can sit unseen in a backtest until a change of settings lets the borrowed forecasts reach the contract.`}
      />

      <P>
        Can a bug like that be caught? The lower right of <FigRef to="Weather Strategy Backtester">the demonstration</FigRef> shows where each of the 39
        settled indices fell, in fifths, in the distribution honestly available on the trade date: the rank histogram of{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>, with fifths for members. Honest forecasts fill the fifths equally in the long run, but each fifth here
        expects only {fmt(perFifth, 1)} of the 39, give or take {fmt(perFifthSd, 1)}, so the honest histogram on January 1 ({q.cal0.hist.join(', ')}) is lumpy
        without being wrong. The size of the errors is a steadier check: honest ones are about as large as claimed, {pct(q.cal0.ratio)} here. With thirty days of
        look-ahead, {q.cal30.hist[2]} of the 39 land in the middle fifth and the errors shrink to {pct(q.cal30.ratio)} of the claimed uncertainty. With five days
        the histogram still looks plausible, and the errors are still {pct(q.cal5.ratio)} of what was claimed. Small leaks hide. The defenses are procedural: stamp every forecast with its issue time, never overwrite one, and
        compare live results with the backtest as soon as there are any.
      </P>

      <H2>Testing the cross-market trade</H2>
      <P>
        Now the test <a href={lessonHref('weather/5.4')}>Lesson 5.4</a> promised. Take every week from December to February in 39 winters,{' '}
        {q.cross.weeks} weeks. Six days before each, compare our expected degree days, gas price and power price for the week with those of a market whose
        forecasts were issued {CROSS_DEFAULTS.lag} days earlier — a market that watches the Pacific, so its only flaw is its forecast’s age. Wherever our number
        beats a market’s quote by more than its half-spread, trade one of 5.4’s contracts there and hold it to settlement; the pipelines and the wind are fixed and
        known to both sides. Each panel is a market’s running profit, on its own scale; the table compares what the trades expected to make with what they made:
      </P>

      <Figure name="Weather Strategy Backtester · cross-market" scenario={cx}>
        <CrossChart
          run={cross}
          label={`Lesson 5.4’s trade replayed over ${cross.weeks} winter weeks, with the market’s forecasts ${cst.lag === 0 ? 'as fresh as ours' : `${cst.lag} days older than ours`}, pipelines of ${fmt(cst.pipeline, 2)} million MMBtu a day and ${fmt(cst.wind, 1)} m/s of wind. ${CROSS_IDS.map((id) => `${CROSS_NAME[id]}: ${cross.stats[id].trades} trades, ${kusd(cross.stats[id].mean)} a trade on average, ${kusd(cross.stats[id].total)} in all`).join('; ')}.`}
        />
        <DataTable
          caption="Each market's trades: how many, what each was expected to make when made, what each made with two standard errors, and the total"
          rows={CROSS_IDS}
          rowKey={(id) => id}
          columns={[
            { label: 'Market', cell: (id) => CROSS_NAME[id] },
            { label: 'Trades', cell: (id) => fmt(cross.stats[id].trades), align: 'right' },
            { label: 'Expected a trade', cell: (id) => (cross.stats[id].trades ? kusd(cross.stats[id].expected) : '—'), align: 'right' },
            { label: 'Made a trade, ± 2 SE', cell: (id) => (cross.stats[id].trades ? `${kusd(cross.stats[id].mean)} ± ${kusd(2 * cross.stats[id].se)}` : '—'), align: 'right' },
            { label: 'Total', cell: (id) => kusd(cross.stats[id].total), align: 'right' },
          ]}
        />
        <Slider
          label="Market’s forecasts are"
          value={cx.state.lag}
          min={0}
          max={5}
          onChange={(v) => cx.set({ lag: v })}
          display={cx.state.lag === 0 ? 'fresh' : `${cx.state.lag} day${cx.state.lag > 1 ? 's' : ''} older than ours`}
        />
        <Slider
          label="Pipeline capacity"
          tone={WX.money}
          value={cx.state.pipeline}
          min={1.2}
          max={2.2}
          step={CROSS_PIPELINE_STEP}
          onChange={(v) => cx.set({ pipeline: Math.round(v * 100) / 100 })}
          display={`${fmt(cx.state.pipeline, 2)} million MMBtu/day`}
        />
        <Slider label="Wind on Hollin Ridge" tone={WX.wind} value={cx.state.wind} min={3} max={13} step={0.5} onChange={(v) => cx.set({ wind: v })} display={`${fmt(cx.state.wind, 1)} m/s`} />
        <Caption>
          {CROSS_IDS.every((id) => cross.stats[id].trades === 0)
            ? 'With forecasts as fresh as ours, the market knows what we know: no gap beats a spread, and nothing trades.'
            : `Clearly above zero, by more than two standard errors: ${CROSS_IDS.filter((id) => clearOfZero(cross.stats[id]) === 1).map((id) => CROSS_NAME[id]).join(', ') || 'none'}. Clearly below: ${CROSS_IDS.filter((id) => clearOfZero(cross.stats[id]) === -1).map((id) => CROSS_NAME[id]).join(', ') || 'none'}. The rest can’t be told from zero.`}
        </Caption>
      </Figure>

      <P>
        The degree-day future trades in {c0.hdd.trades} of the {q.cross.weeks} weeks. Its trades expected {usd(c0.hdd.expected)} each after the spread and made{' '}
        {usd(c0.hdd.mean)} ± {usd(2 * c0.hdd.se)}: less than promised but within the error bars, and with {c0.hdd.trades} draws clearly above zero.
        Gas trades in only {c0.gas.trades} weeks, those whose forecasts reach the steep part of its curve, and its average, {kusd(c0.gas.mean)} ±{' '}
        {kusd(2 * c0.gas.se)}, can’t be told from zero or from the {kusd(c0.gas.expected)} expected. Power: {c0.power.trades} trades, {kusd(c0.power.mean)} ± {kusd(2 * c0.power.se)} against{' '}
        {kusd(c0.power.expected)} expected. Lesson 5.4 found the three trades close per dollar of risk; history confirms only the one that comes up often, because
        a gas trade swings by {kusd(c0.gas.sd)} and {c0.gas.trades} draws can’t pin its average down. Make the market’s forecasts fresh and every trade
        disappears: the edge was the forecast’s age, and nothing else.
      </P>

      <Challenge
        id="b"
        question={`Keep the market’s forecasts ${CROSS_DEFAULTS.lag} days older than ours, and tighten the pipelines to ${fmt(TIGHT_PIPELINE, 2)} million MMBtu a day: there the gas trade’s average does clear zero. Predict first whether more wind on Hollin Ridge helps that trade or hurts it. Then find the most wind, on the slider’s half-steps, at which gas’s average is still more than two standard errors above zero.`}
        solved={solved2}
        status={
          !atTightPipelines(cx.state)
            ? `Set the market’s forecasts to ${CROSS_DEFAULTS.lag} days older than ours and the pipelines to ${fmt(TIGHT_PIPELINE, 2)} million MMBtu a day.`
            : `At ${fmt(cx.state.wind, 1)} m/s, gas trades in ${gas.trades} weeks and makes ${kusd(gas.mean)} ± ${kusd(2 * gas.se)} a trade. Is that the most wind at which it clears zero?`
        }
        success={`Solved: at ${fmt(cx.state.wind, 1)} m/s gas still makes ${kusd(gas.mean)} ± ${kusd(2 * gas.se)}, clear of zero; half a meter per second more and it sinks back into the noise. Wind works against the gas trade. Every megawatt-hour from Hollin Ridge keeps a gas plant off and leaves the pipelines room, so fewer cold weeks reach the steep part of the gas curve — ${gas.trades} trades here against ${q.tight.stats.gas.trades} at ${fmt(CROSS_DEFAULTS.wind, 1)} m/s — and each is expected to make less, ${kusd(gas.expected)} against ${kusd(q.tight.stats.gas.expected)}. The physics that creates an edge also decides whether history holds enough of it to see.`}
      />

      <H2>Hedging the utility</H2>
      <P>
        A backtest serves a hedger too. Fenwick Gas &amp; Light, from <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>, earns about {usd(q.slope)} of margin for
        each heating degree day of its winter, counted as in <a href={lessonHref('weather/4.1')}>Lesson 4.1</a>, so a mild winter costs it millions. On October
        31 it plans the winter at the market’s expected index, using its sensitivity as estimated from the archive’s winters — its <b>October plan</b> — and what
        it risks is the miss against it. To protect the plan it can sell the November–March seasonal strip, a contract on the season’s total at $20 a
        degree day, at the market’s bid that day and hold it to settlement. (In practice a position this large would mostly be an over-the-counter
        swap.) A mild winter then pays the utility on the strips exactly when its margin falls short. In the next demonstration, each gray bar is one winter’s
        miss without a hedge and the narrow bar inside it the miss with one. Choose how many strips to sell, and change the physics of the winters:
      </P>

      <Figure name="Weather Strategy Backtester · hedging the utility" scenario={hs}>
        <HedgeChart
          h={hedge}
          label={`Fenwick Gas & Light’s winter margin against its October plan over 40 simulated winters, hedged with ${fmt(hst.contracts)} seasonal strips: the misses’ standard deviation falls from ${usd(hedge.missSd)} to ${usd(hedge.hedgedMissSd)}, a ${pct(hedge.effectiveness)} reduction in variance; the worst winter misses by ${usd(-hedge.worstMiss)} unhedged and ${usd(-hedge.worstHedgedMiss)} hedged.`}
        />
        <Legend
          items={[
            { label: 'Unhedged', color: '#cfcfcf' },
            { label: 'Hedged', color: GRAPHIC.green },
          ]}
        />
        <Readouts
          items={[
            { label: 'spread of the misses', value: `${kusd(hedge.missSd)} → ${kusd(hedge.hedgedMissSd)}`, tone: WX.money },
            { label: 'variance removed', value: pct(hedge.effectiveness, 1), tone: WX.money },
            { label: 'worst winter', value: `${kusd(hedge.worstMiss)} → ${kusd(hedge.worstHedgedMiss)}`, tone: 'red' },
            { label: 'the hedge’s average result a winter', value: kusd(-hedge.costPerWinter), tone: tone(-hedge.costPerWinter) },
          ]}
        />
        <Slider label="Strips sold" tone={WX.index} value={hs.state.contracts} min={0} max={HEDGE_MAX} step={HEDGE_STEP} onChange={(v) => hs.set({ contracts: v })} display={fmt(hs.state.contracts)} />
        <Slider
          label="Day-to-day variability"
          tone={WX.temperature}
          value={hs.state.variability}
          min={0.6}
          max={1.6}
          step={0.05}
          onChange={(v) => hs.set({ variability: Math.round(v * 100) / 100 })}
          display={`× ${fmt(hs.state.variability, 2)}`}
        />
        <Slider
          label="ENSO’s pull on the winter"
          tone={WX.temperature}
          value={hs.state.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(v) => hs.set({ ensoF: Math.round(v * 10) / 10 })}
          display={`${fmt(hs.state.ensoF, 1)} °F per °C`}
        />
        <Caption>
          {`With this physics the utility earns ${usd(hb.slope)} of margin per degree day, and its degree days explain ${pct(hb.r2)} of its winters.`}
        </Caption>
      </Figure>

      <P>
        Unhedged, the winters miss the plan with a standard deviation of {usd(q.h0.missSd)}, and the worst falls {usd(-q.h0.worstMiss)} short. A
        thousand strips remove {pct(q.h1000.effectiveness)} of the variance; two thousand, {pct(q.h2000.effectiveness)}. The right number comes straight from{' '}
        <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>: the dollars the utility gains per degree day divided by the dollars a strip pays. Sell more and the
        utility is no longer hedged but betting on cold: at 4,000 strips only {pct(q.h4000.effectiveness)} of the variance is gone. Make the winters more variable
        and the hedge matters more, not less — at 1.5 times the variability the unhedged spread is {usd(q.hv0.missSd)} and the best hedged one{' '}
        {usd(q.hvBest.hedgedMissSd)}.
      </P>

      <Challenge
        id="c"
        question="Predict first, from the utility’s margin per degree day in the caption and the strip’s $20: how many strips, to the nearest hundred, leave its misses with the smallest spread? Then set that number, and check that a hundred more or a hundred fewer does worse."
        solved={solved3}
        status={
          hs.state.contracts === 0
            ? 'Make your prediction from the caption, then sell that many strips.'
            : `At ${fmt(hs.state.contracts)} strips the misses’ standard deviation is ${usd(hedge.hedgedMissSd)}. Does a hundred either way do better?`
        }
        success={`Solved: ${fmt(hs.state.contracts)} strips leave ${usd(hedge.hedgedMissSd)}, ${pct(hedge.effectiveness, 1)} of the variance removed. It is the minimum-variance hedge, ${usd(hb.slope)} ÷ $20 ≈ ${fmt(hb.slope / CME_TICK)} strips, to the slider’s hundred — and what remains is the part of the margin the index never measured.`}
      />

      <P>
        What remains is <b>basis risk</b>: the windy and calm winters of Lesson 4.5, which change the utility’s gas sales without moving a degree day.
        At the best hedge the misses still have a standard deviation of {usd(q.hBest.hedgedMissSd)}, close to what the index left unexplained there; no number of
        strips on this index can remove it. This backtest also flatters itself a little: the sensitivity, the plan and the strip count were all fitted to the
        same 40 winters the hedge is judged on. Fitted only on earlier winters, as a utility would have to, the hedge removes{' '}
        {pct(q.walk.outOfSample, 1)} of the variance over winters {WALK_FROM}–40, against {pct(q.walk.inSample, 1)} in-sample: a small gap here, but the honest
        number is the smaller one.
      </P>
      <P>
        Nor is the hedge free. Its expected cost is the spread, {MARKET.halfSpread} degree days a strip, about {usd(spreadCost)} a winter at {fmt(q.bestN)}{' '}
        strips. In these 40 winters it earned {usd(-q.hBest.costPerWinter)} a winter instead, because the market’s prices happened to run a little above what
        settled: luck, not a property of hedging. The hedger pays for certainty, and the spread goes to whoever makes the market, as does the spread the trader
        of <FigRef to="Weather Strategy Backtester">the first demonstration</FigRef> pays, who earns only when the physics hands it information the price leaves
        out. This market charges no premium for carrying risk; in a real one, as <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> showed, hedgers crowding one
        side can leave one for whoever takes the other.
      </P>
      <P>
        That answers the chapter’s question. Probabilistic weather outcomes are priced as expected payoffs over forecast distributions; transferred through
        contracts on indices at named stations, from businesses that lose in one kind of weather to those that gain from it or will carry it; and traded by
        anyone whose forecasts beat the market’s — which only a point-in-time test can show. Starting in <a href={lessonHref('weather/6.1')}>the next
        lesson</a>, Chapter 6 puts it all together: we’ll build a regional weather model of our own, forecast it, turn the forecasts into exposures, price and
        choose contracts, and test the whole system against the archive.
      </P>
    </LessonPage>
  );
}
