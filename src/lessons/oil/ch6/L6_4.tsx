import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, clamp, fmt, lessonHref, niceDomain, pct, usd, useScenario } from '../../../framework';
import { CORRAN_DAY, CRACK_RATIOS, corranMargin, correlation, hedgeRefinery, seasonalForwards, type HedgeCrack, type HedgeForward, type HedgeResult } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { XYChart } from '../shared/charts';
import { YEAR_TICKS, seasonDisplay, yearTick } from './style';

// ---------------------------------------------------------------------------
// The hedge, its settings and the physical drivers behind it.

export type MixId = keyof typeof CRACK_RATIOS;

export interface HedgeState {
  /** The crack sold: its share of gasoline against diesel. */
  mix: MixId;
  /** The crude leg: Brent (the coast) or WTI (Kessler, inland). */
  bench: HedgeCrack;
  /** Crack barrels sold per barrel of crude run. */
  ratio: number;
  /** Scale on demand's seasonal swings (1 = the history's normal seasons). */
  seasonality: number;
  /** Pinyon Basin growth, kb/d per year: what fills the Kessler–Corran line. */
  growth: number;
}

export const RATIO_MAX = 1.2;
export const RATIO_STEP = 0.05;
export const SEASON_MAX = 2;
export const SEASON_STEP = 0.1;
export const GROWTH_MAX = 140;
export const GROWTH_STEP = 10;
/** Challenge a: the share of variance the standard 3:2:1 must still remove with the seasons doubled. */
export const STANDARD_TARGET = 0.5;
/** Challenge b: the share of variance the WTI hedge must still remove. */
export const WTI_TARGET = 0.5;
/** Corran's crude runs, barrels a day. */
export const RUNS = (CORRAN_DAY.pinyon + CORRAN_DAY.coldwater) * 1000;
/** Weeks a quarter's hedge runs (the engine's quarter). */
const QUARTER = 13;
/**
 * How Corran prices each quarter's hedge: every week at its own seasonal forward, as a futures curve
 * that carries the seasons would (the crack and the plan both follow the calendar of Lesson 6.3).
 */
export const FORWARD: HedgeForward = 'seasonal';

/** Corran's hedge on a history: a crack sold on `ratio` of its runs, priced at the seasonal forward. */
export function hedgeOn(h: HistoryWeek[], ratio: number, bench: HedgeCrack, mix: MixId): HedgeResult {
  return hedgeRefinery(h, ratio, bench, CRACK_RATIOS[mix], CORRAN_DAY, FORWARD);
}

export const HEDGE_DEFAULTS: HedgeState = {
  mix: '3:2:1',
  bench: 'brent',
  ratio: 0.8,
  seasonality: HISTORY_DEFAULTS.seasonality,
  growth: HISTORY_DEFAULTS.basinGrowth,
};

export const MIX_LABEL: Record<MixId, string> = { '3:2:1': '3:2:1', '2:1:1': '2:1:1', corran: 'Corran’s mix' };
const BENCH_LABEL: Record<HedgeCrack, string> = { brent: 'Brent', wti: 'WTI' };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The simulated history for a setting of the physical drivers. */
export function historyOf(st: { seasonality: number; growth: number }): HistoryWeek[] {
  return oilHistory({ seasonality: st.seasonality, basinGrowth: st.growth });
}

/** Corran's hedge at a setting. */
export function hedgeFor(st: HedgeState): HedgeResult {
  return hedgeOn(historyOf(st), st.ratio, st.bench, st.mix);
}

/** The minimum-variance ratio for a setting's crack and history, and the share of variance it removes. */
export function bestHedge(st: HedgeState): { ratio: number; effectiveness: number } {
  const h = historyOf(st);
  const ratio = hedgeOn(h, 0, st.bench, st.mix).bestRatio;
  return { ratio, effectiveness: hedgeOn(h, ratio, st.bench, st.mix).effectiveness };
}

/** The typical (root-mean-square) hedged surprise at every ratio on the slider's grid, $/day. */
export function ratioSweep(st: HedgeState): Array<[number, number]> {
  const h = historyOf(st);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= Math.round(RATIO_MAX / RATIO_STEP); i++) {
    const r = i * RATIO_STEP;
    out.push([r, hedgeOn(h, r, st.bench, st.mix).sdHedged]);
  }
  return out;
}

/**
 * How far the gasoline and diesel cracks move together over a hedge's quarter: the correlation of
 * their 13-week changes.
 */
export function crackComovement(h: HistoryWeek[]): number {
  const dg: number[] = [];
  const dd: number[] = [];
  for (let t = QUARTER; t < h.length; t++) {
    dg.push(h[t].gasolineCrack - h[t - QUARTER].gasolineCrack);
    dd.push(h[t].dieselCrack - h[t - QUARTER].dieselCrack);
  }
  return correlation(dg, dd);
}

/**
 * The cracks' surprises against their seasonal forwards over each hedge's quarter: the typical
 * (root-mean-square) size of gasoline's and diesel's, $/bbl, and their correlation.
 */
export function crackSurprises(h: HistoryWeek[]): { gasoline: number; diesel: number; correlation: number } {
  const g = h.map((w) => w.gasolineCrack);
  const d = h.map((w) => w.dieselCrack);
  const fg = seasonalForwards(g);
  const fd = seasonalForwards(d);
  const sg: number[] = [];
  const sd: number[] = [];
  for (let t = 1; t < h.length; t++) {
    const t0 = Math.floor((t - 1) / QUARTER) * QUARTER;
    sg.push(g[t] - fg(t0, t));
    sd.push(d[t] - fd(t0, t));
  }
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / Math.max(1, xs.length));
  return { gasoline: rms(sg), diesel: rms(sd), correlation: correlation(sg, sd) };
}

export interface LineStats {
  /** Weeks the Kessler–Corran line runs full. */
  fullWeeks: number;
  /** The highest share of the line in use. */
  busiest: number;
  /** The Brent − WTI spread's range, $/bbl. */
  low: number;
  high: number;
}

/** How hard the Kessler–Corran line runs in a history, and how far WTI strays from Brent. */
export function lineStats(h: HistoryWeek[]): LineStats {
  const spread = h.map((w) => w.brent - w.wti);
  return {
    fullWeeks: h.filter((w) => w.pipelineUse >= 1).length,
    busiest: Math.max(...h.map((w) => w.pipelineUse)),
    low: Math.min(...spread),
    high: Math.max(...spread),
  };
}

/**
 * The share of the matched hedge's leftover variance that moves with the price of crude itself:
 * the squared correlation between the hedged surprise and Brent's surprise against its own
 * seasonal forward from the week the hedge was placed.
 */
export function crudeLevelShare(h: HistoryWeek[], ratio: number): number {
  const r = hedgeOn(h, ratio, 'brent', 'corran');
  const brentFwd = seasonalForwards(h.map((w) => w.brent));
  const x: number[] = [];
  for (let t = 1; t < h.length; t++) {
    const t0 = Math.floor((t - 1) / QUARTER) * QUARTER;
    x.push(h[t].brent - brentFwd(t0, t));
  }
  const c = correlation(x, r.hedgedSurprise);
  return c * c;
}

/**
 * Challenge a: with the seasonal swing at twice normal, the standard 3:2:1 crack against Brent still
 * removes more than half the variance of Corran's surprises.
 */
export function standardCrackSolved(st: HedgeState): boolean {
  return st.mix === '3:2:1' && st.bench === 'brent' && near(st.seasonality, SEASON_MAX) && hedgeFor(st).effectiveness > STANDARD_TARGET;
}

/**
 * Challenge b: with a WTI crack in Corran's mix and normal seasons, the fastest basin growth (on the
 * slider's 10 kb/d grid) at which the hedge still removes at least 60% of the variance — at the
 * reader's ratio, and with no ratio able to reach 60% at the next step up.
 */
export function wtiGrowthSolved(st: HedgeState): boolean {
  if (st.bench !== 'wti' || st.mix !== 'corran' || !near(st.seasonality, HISTORY_DEFAULTS.seasonality)) return false;
  if (hedgeFor(st).effectiveness < WTI_TARGET) return false;
  return st.growth + GROWTH_STEP > GROWTH_MAX || bestHedge({ ...st, growth: st.growth + GROWTH_STEP }).effectiveness < WTI_TARGET;
}

/** The answer to challenge b: the fastest growth on the grid at which some ratio removes 60%. */
export function fastestWtiGrowth(): number {
  let answer = NaN;
  for (let g = 0; g <= GROWTH_MAX; g += GROWTH_STEP) {
    if (bestHedge({ ...HEDGE_DEFAULTS, mix: 'corran', bench: 'wti', growth: g }).effectiveness >= WTI_TARGET) answer = g;
    else if (!Number.isNaN(answer)) break;
  }
  return answer;
}

// ---------------------------------------------------------------------------
// Quarter by quarter.

export interface QuarterState {
  ratio: number;
  seasonality: number;
  /** The quarter being read, 1–20. */
  quarter: number;
}

export interface QuarterRow {
  quarter: number;
  firstWeek: number;
  lastWeek: number;
  /** The margin Corran expected when it placed the quarter's hedge, $ for the quarter. */
  plan: number;
  unhedged: number;
  hedged: number;
  /** What the hedge paid (negative: cost), $. */
  payoff: number;
  /** The crack sold (averaged over the quarter's weeks, each sold at its own forward), and the crack realized on average, $/bbl. */
  locked: number;
  realized: number;
}

/** Adds a hedge's weeks up into quarters (each quarter's hedge runs the 13 weeks after it is placed). */
export function quarterly(r: HedgeResult, ratio: number): QuarterRow[] {
  const rows: QuarterRow[] = [];
  r.margin.forEach((m, i) => {
    const q = Math.floor(i / QUARTER);
    if (!rows[q]) rows[q] = { quarter: q + 1, firstWeek: i + 1, lastWeek: i + 1, plan: 0, unhedged: 0, hedged: 0, payoff: 0, locked: 0, realized: 0 };
    const row = rows[q];
    const pay = ratio * RUNS * (r.locked[i] - r.realized[i]) * 7;
    row.lastWeek = i + 1;
    row.plan += r.expected[i] * 7;
    row.unhedged += m * 7;
    row.payoff += pay;
    row.hedged += m * 7 + pay;
    row.locked += r.locked[i];
    row.realized += r.realized[i];
  });
  for (const row of rows) {
    row.locked /= row.lastWeek - row.firstWeek + 1;
    row.realized /= row.lastWeek - row.firstWeek + 1;
  }
  return rows;
}

/** Corran's matched hedge (its own mix, against Brent), quarter by quarter. */
export function quartersFor(st: QuarterState): QuarterRow[] {
  const h = historyOf({ seasonality: st.seasonality, growth: HISTORY_DEFAULTS.basinGrowth });
  return quarterly(hedgeOn(h, st.ratio, 'brent', 'corran'), st.ratio);
}

export interface QuarterSummary {
  /** Root-mean-square quarterly surprise against the plan, unhedged and hedged, $. */
  rmsUnhedged: number;
  rmsHedged: number;
  totalUnhedged: number;
  totalHedged: number;
  /** Quarters in which the hedge paid out. */
  paidQuarters: number;
  /** Index of the largest shortfall and of the largest windfall against the plan (unhedged), and of the weakest quarter. */
  shortfall: number;
  windfall: number;
  weakest: number;
  /** Index of the hedged margin's largest shortfall. */
  hedgedShortfall: number;
}

export function summarizeQuarters(rows: QuarterRow[]): QuarterSummary {
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / Math.max(1, xs.length));
  const argBy = (f: (r: QuarterRow) => number, better: (a: number, b: number) => boolean) =>
    rows.reduce((best, r, i) => (better(f(r), f(rows[best])) ? i : best), 0);
  return {
    rmsUnhedged: rms(rows.map((r) => r.unhedged - r.plan)),
    rmsHedged: rms(rows.map((r) => r.hedged - r.plan)),
    totalUnhedged: rows.reduce((a, r) => a + r.unhedged, 0),
    totalHedged: rows.reduce((a, r) => a + r.hedged, 0),
    paidQuarters: rows.filter((r) => r.payoff > 0).length,
    shortfall: argBy((r) => r.unhedged - r.plan, (a, b) => a < b),
    windfall: argBy((r) => r.unhedged - r.plan, (a, b) => a > b),
    weakest: argBy((r) => r.unhedged, (a, b) => a < b),
    hedgedShortfall: argBy((r) => r.hedged - r.plan, (a, b) => a < b),
  };
}

export const QUARTER_DEFAULTS: QuarterState = { ratio: 0.9, seasonality: HISTORY_DEFAULTS.seasonality, quarter: 6 };

// ---------------------------------------------------------------------------
// Numbers quoted in the prose, computed once from the model.

function computeFacts() {
  const h = historyOf(HEDGE_DEFAULTS);
  const margins = h.map((w) => corranMargin(w));
  const at = (mix: MixId, bench: HedgeCrack, ratio: number) => hedgeOn(h, ratio, bench, mix);
  const best = bestHedge({ ...HEDGE_DEFAULTS, mix: 'corran' });
  const rows = quartersFor(QUARTER_DEFAULTS);
  const sum = summarizeQuarters(rows);
  return {
    marginMin: Math.min(...margins),
    marginMax: Math.max(...margins),
    marginMean: margins.reduce((a, b) => a + b, 0) / margins.length,
    standard: at('3:2:1', 'brent', HEDGE_DEFAULTS.ratio),
    /** The same 3:2:1 hedge with every week of a quarter sold at the day's crack (no seasons in the price). */
    flatStandard: hedgeRefinery(h, HEDGE_DEFAULTS.ratio, 'brent', CRACK_RATIOS['3:2:1'], CORRAN_DAY, 'flat'),
    surprises: crackSurprises(h),
    matched: at('corran', 'brent', HEDGE_DEFAULTS.ratio),
    twoOne: at('2:1:1', 'brent', HEDGE_DEFAULTS.ratio),
    wti: at('corran', 'wti', HEDGE_DEFAULTS.ratio),
    best,
    wtiBest: bestHedge({ ...HEDGE_DEFAULTS, mix: 'corran', bench: 'wti' }),
    comove: crackComovement(h),
    line: lineStats(h),
    levelShare: crudeLevelShare(h, best.ratio),
    rows,
    sum,
    maxLocked: Math.max(...rows.map((r) => r.locked)),
  };
}

let factsCache: ReturnType<typeof computeFacts> | null = null;
export function lessonFacts() {
  if (!factsCache) factsCache = computeFacts();
  return factsCache;
}

// ---------------------------------------------------------------------------
// Formatting.

const kday = (v: number) => `${usd(v / 1000)}k`;
const mn = (v: number, d = 1) => `${usd(v / 1e6, d)} million`;
const mShort = (v: number, d = 1) => `${usd(v / 1e6, d)}M`;
const effPhrase = (e: number) => (e >= 0 ? `removes ${pct(e)} of the variance` : `adds ${pct(-e)} to the variance`);

// ---------------------------------------------------------------------------

export default function Lesson() {
  const F = useMemo(() => lessonFacts(), []);
  const s1 = useScenario('hedge', HEDGE_DEFAULTS);
  const st = s1.state;
  const s2 = useScenario('quarters', QUARTER_DEFAULTS);
  const qs = s2.state;

  const fig1 = useMemo(() => {
    const h = historyOf(st);
    const r = hedgeOn(h, st.ratio, st.bench, st.mix);
    const best = bestHedge(st);
    return { r, best, sweep: ratioSweep(st), line: lineStats(h), comove: crackComovement(h), nWeeks: h.length };
  }, [st]);
  const { r, best, sweep, line, comove, nWeeks } = fig1;
  const solvedA = useMemo(() => standardCrackSolved(st), [st]);
  const matchedHere = useMemo(() => (st.mix === 'corran' ? r.effectiveness : hedgeFor({ ...st, mix: 'corran' }).effectiveness), [st, r]);
  const solvedB = useMemo(() => wtiGrowthSolved(st), [st]);
  const nextUp = useMemo(() => {
    if (st.growth + GROWTH_STEP > GROWTH_MAX) return null;
    const up = { ...st, growth: st.growth + GROWTH_STEP };
    return { line: lineStats(historyOf(up)), best: bestHedge(up), brentBest: bestHedge({ ...st, bench: 'brent' }) };
  }, [st]);

  const surprisePts = (xs: number[]) => xs.map((v, i) => [(i + 1) / 52, v / 1000] as [number, number]);
  const [sLo, sHi] = niceDomain(Math.min(...r.surprise, ...r.hedgedSurprise) / 1000, Math.max(...r.surprise, ...r.hedgedSurprise) / 1000, 4);
  const [, uHi] = niceDomain(0, Math.max(r.sdUnhedged, ...sweep.map((p) => p[1])) / 1000, 4);
  const bestShown = best.ratio >= 0 && best.ratio <= RATIO_MAX;
  const bestSd = bestShown ? hedgeOn(historyOf(st), best.ratio, st.bench, st.mix).sdHedged : 0;
  const crackText = `the ${MIX_LABEL[st.mix]} crack against ${BENCH_LABEL[st.bench]}`;

  const rows = useMemo(() => quartersFor(qs), [qs]);
  const qsum = summarizeQuarters(rows);
  const qi = clamp(Math.round(qs.quarter), 1, rows.length) - 1;
  const row = rows[qi];
  const qVals = rows.flatMap((x) => [x.plan, x.unhedged, x.hedged]).map((v) => v / 1e6);
  const [qLo, qHi] = niceDomain(Math.min(...qVals), Math.max(...qVals), 4);

  const fShort = F.rows[F.sum.shortfall];
  const fWind = F.rows[F.sum.windfall];
  const fWeak = F.rows[F.sum.weakest];
  const fHedgedShort = F.rows[F.sum.hedgedShortfall];
  const products = CORRAN_DAY.gasoline + CORRAN_DAY.jet + CORRAN_DAY.diesel;

  return (
    <LessonPage id="oil/6.4">
      <P>
        In <a href={lessonHref('oil/6.3')}>Lesson 6.3</a> the crack spread was a bet: a trader could take it or leave it, going long or short as product stocks and
        outages suggested. The Corran refinery has no such choice. Every barrel it runs it buys as crude and sells as products, so it is long the crack every day of
        the year, whether it likes it or not. Run every day as on its reference day in <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> —{' '}
        {fmt(CORRAN_DAY.pinyon * 1000)} barrels a day of Pinyon Light and {fmt(CORRAN_DAY.coldwater * 1000)} of Coldwater Heavy in, products out —
        through the simulated history of Chapter 5, its <K c="price">margin</K> swings between {mn(F.marginMin)} and {mn(F.marginMax)} a
        day, around an average of {mn(F.marginMean)}. This lesson asks what Corran can do about that swing, and what it can’t.
      </P>
      <P>
        The tool is a <K tone="violet">hedge</K>: a position in the futures market that gains when the business loses. If Corran sells the crack forward — sells
        gasoline and diesel futures and buys crude futures — then a fall in the crack costs the refinery but pays the futures position, and a rise does the reverse.
        At the start of each quarter, Corran sells the crack for each of the coming 13 weeks, on some fraction of its {fmt(RUNS)}{' '}
        barrels a day of runs: the <K tone="violet">hedge ratio</K>. Each week’s crack is sold at its own <K c="price">seasonal forward</K> price, because futures prices
        carry the seasons (<a href={lessonHref('oil/6.3')}>Lesson 6.3</a>): summer gasoline trades over winter gasoline. Our history has
        no product futures, so the forward is today’s crack plus the change Lesson 6.3’s calendar, fitted to all five years, expects between now and that week.
        Corran plans its margin the same way. Each week the hedge pays the crack it sold minus the crack that week,
        on every barrel hedged. What it protects against is the margin’s <K c="price">surprise</K>, what Corran earned less what it planned. We’ll measure the
        typical surprise by its root-mean-square size — square each week’s surprise, average the squares and take the square root, much as for the standard
        deviation of <a href={lessonHref('oil/6.1')}>Lesson 6.1</a> — and a hedge’s <K tone="violet">effectiveness</K> by the share of the surprises’ variance
        (the square of that typical size) it removes. A hedge that halves the typical surprise removes three-quarters of the variance.
      </P>
      <P>
        In the next demonstration, Corran starts with the textbook instrument, the 3:2:1 crack — two barrels of gasoline and one of diesel against three of crude —
        priced against Brent and sold on 80% of its runs. The upper chart follows the weekly surprise for five years, unhedged and hedged; the lower one shows the
        typical hedged surprise at every hedge ratio. Choose the crack and the ratio, and change the physical world behind them:
      </P>

      <Figure name="Refinery Hedge Designer" scenario={s1}>
        <Segmented
          label="Crack sold"
          value={st.mix}
          onChange={(v) => s1.set({ mix: v })}
          options={[
            { value: '3:2:1' as const, label: '3:2:1' },
            { value: '2:1:1' as const, label: '2:1:1' },
            { value: 'corran' as const, label: 'Corran’s mix' },
          ]}
        />
        <Segmented
          label="Crude leg"
          value={st.bench}
          onChange={(v) => s1.set({ bench: v })}
          options={[
            { value: 'brent' as const, label: 'Brent (the coast)' },
            { value: 'wti' as const, label: 'WTI (Kessler)' },
          ]}
        />
        <XYChart
          ariaLabel={`Corran’s weekly margin surprise over five simulated years, hedged with ${crackText} at a ratio of ${fmt(st.ratio, 2)}: typical size ${kday(r.sdUnhedged)} a day unhedged and ${kday(r.sdHedged)} hedged.`}
          height={220}
          x={[0, 5]}
          y={[sLo, sHi]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yFormat={(v) => `${usd(v)}k`}
          yLabel="Surprise in the margin, $ a day"
          series={[
            { points: surprisePts(r.surprise), color: GRAPHIC.gray, width: 1.4, opacity: 0.85 },
            { points: surprisePts(r.hedgedSurprise), color: GRAPHIC.violet, width: 1.6 },
          ]}
        />
        <Legend
          items={[
            { label: 'Unhedged', color: GRAPHIC.gray, kind: 'line' },
            { label: 'Hedged', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Typical hedged surprise at hedge ratios from 0 to 1.2 for ${crackText}: ${kday(r.sdHedged)} a day at the chosen ${fmt(st.ratio, 2)}, against ${kday(r.sdUnhedged)} unhedged; the least risky ratio is ${fmt(best.ratio, 2)}.`}
          height={170}
          x={[0, RATIO_MAX]}
          y={[0, uHi]}
          xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1, 1.2]}
          xFormat={(v) => fmt(v, 1)}
          yFormat={(v) => `${usd(v)}k`}
          xLabel="hedge ratio"
          yLabel="Typical hedged surprise, $ a day"
          refs={[{ axis: 'y', at: r.sdUnhedged / 1000, color: GRAPHIC.gray, label: 'unhedged' }]}
          series={[{ points: sweep.map(([x, y]) => [x, y / 1000] as [number, number]), color: GRAPHIC.violet, width: 2.5 }]}
          markers={[
            ...(bestShown
              ? [
                  {
                    x: best.ratio,
                    y: bestSd / 1000,
                    color: '#333',
                    hollow: true,
                    r: 6,
                    label: 'least risk',
                    labelAnchor: best.ratio < 0.15 ? ('start' as const) : best.ratio > 1.05 ? ('end' as const) : ('middle' as const),
                    labelDx: best.ratio < 0.15 ? 4 : best.ratio > 1.05 ? -4 : 0,
                    labelDy: 20,
                  },
                ]
              : []),
            { x: st.ratio, y: r.sdHedged / 1000, color: GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: 'typical surprise, unhedged', value: kday(r.sdUnhedged), tone: 'green' },
            { label: 'typical surprise, hedged', value: kday(r.sdHedged), tone: 'green' },
            { label: <K tone="violet">variance removed</K>, value: pct(r.effectiveness), tone: r.effectiveness < 0 ? 'red' : 'violet' },
          ]}
        />
        <Slider
          label="Hedge ratio"
          tone="violet"
          value={st.ratio}
          min={0}
          max={RATIO_MAX}
          step={RATIO_STEP}
          onChange={(v) => s1.set({ ratio: v })}
          display={`${fmt(st.ratio, 2)} · ${fmt((st.ratio * RUNS) / 1000)} kb/d`}
        />
        <Slider
          label="Seasonal swing"
          tone="red"
          value={st.seasonality}
          min={0}
          max={SEASON_MAX}
          step={SEASON_STEP}
          onChange={(v) => s1.set({ seasonality: Math.round(v * 10) / 10 })}
          display={seasonDisplay(st.seasonality)}
        />
        <Slider
          label="Pinyon Basin growth"
          tone="orange"
          value={st.growth}
          min={0}
          max={GROWTH_MAX}
          step={GROWTH_STEP}
          onChange={(v) => s1.set({ growth: v })}
          display={`${st.growth} kb/d a year`}
        />
        <Caption>
          Over a quarter, the gasoline and diesel cracks’ moves correlate {fmt(comove, 2)}. The Kessler–Corran line runs full in {line.fullWeeks} of{' '}
          {nWeeks} weeks, and Brent − WTI ranges from {usd(line.low, 2)} to {usd(line.high, 2)}.
        </Caption>
      </Figure>

      <P>
        The textbook hedge works. With the 3:2:1 on 80% of its runs, Corran’s typical surprise falls from {kday(F.standard.sdUnhedged)} a day to{' '}
        {kday(F.standard.sdHedged)}, and the hedge removes {pct(F.standard.effectiveness, 1)} of the variance. Now switch the crack to Corran’s own mix,{' '}
        {pct(CRACK_RATIOS.corran)} gasoline and {pct(1 - CRACK_RATIOS.corran)} diesel (jet fuel, which in our model tracks diesel, counted with it). At the same
        ratio the hedge removes {pct(F.matched.effectiveness, 1)}; the 2:1:1, half gasoline and half diesel, {pct(F.twoOne.effectiveness, 1)}. Corran is a diesel
        refinery — of the {fmt(products * 1000)} barrels a day of gasoline, jet fuel and diesel it makes, only {fmt(CORRAN_DAY.gasoline * 1000)} are gasoline — and
        the 3:2:1 is two-thirds gasoline, yet the mismatch costs it next to nothing.
      </P>
      <P>
        The reason is in what the forward price already holds. In the simulated history the two cracks move against each other with the seasons (
        <a href={lessonHref('oil/5.3')}>Lesson 5.3</a>): over the 13 weeks a hedge runs, their changes have a correlation of {fmt(F.comove, 2)}. But Corran
        sold each week at a price that already included its
        season, so the seasons are no surprise and need no hedge. What is left in each crack is what nobody scheduled — stock draws, outages, noise —
        and gasoline’s surprises and diesel’s are about the same size, typically {usd(F.surprises.gasoline, 2)} and {usd(F.surprises.diesel, 2)} a barrel, and
        partly shared (a correlation of {fmt(F.surprises.correlation, 2)}). Any crack that holds both catches about as much of them as Corran’s own mix does. Had
        Corran instead sold every week of a quarter at that day’s crack — summer gasoline at a winter price — the seasons would have counted as surprises, and the
        same 3:2:1 would have{' '}
        {F.flatStandard.effectiveness < 0 ? `added ${pct(-F.flatStandard.effectiveness)} to the variance` : `removed only ${pct(F.flatStandard.effectiveness)}`}.
        A hedge works only as far as the instrument moves with what it hedges, beyond what the market already expects. The part of the business it doesn’t share is{' '}
        <K tone="violet">basis risk</K> — the risk in the gap between the price a hedge follows and the prices the business lives on, a basis in the sense of{' '}
        <a href={lessonHref('oil/6.2')}>Lesson 6.2</a> — and choosing an instrument is mostly choosing which basis risk to keep.
      </P>
      <P>
        With Corran’s mix, the curve in the lower chart bottoms out at a ratio of {fmt(F.best.ratio, 2)}, where the hedge removes {pct(F.best.effectiveness)}. That
        lowest point is the <K tone="violet">minimum-variance hedge ratio</K>. Hedge less and Corran keeps risk it could have shed; hedge more and the futures
        position becomes a bet of its own, in the opposite direction.
      </P>

      <Challenge
        id="a"
        question={`Suppose Corran’s treasurer insists on the standard 3:2:1 crack against Brent, but worries about the seasons, which pull gasoline’s crack and diesel’s apart. Predict first, then check: with the seasonal swing twice normal, does the 3:2:1 still remove more than ${pct(STANDARD_TARGET)} of the variance of Corran’s surprises?`}
        solved={solvedA}
        status={
          st.mix !== '3:2:1' || st.bench !== 'brent'
            ? 'Choose the 3:2:1 crack against Brent.'
            : st.seasonality < SEASON_MAX - 1e-9
              ? 'Make your prediction, then set the seasonal swing to twice normal.'
              : `With the seasons doubled, the 3:2:1 ${effPhrase(r.effectiveness)} at a ratio of ${fmt(st.ratio, 2)}; its least risky ratio here is ${fmt(best.ratio, 2)}.`
        }
        success={`Solved: with the seasonal swing at twice normal, the 3:2:1 still removes ${pct(r.effectiveness, 1)}, against ${pct(F.standard.effectiveness, 1)} with normal seasons; Corran’s own mix would remove ${pct(matchedHere, 1)}. The gasoline and diesel cracks’ moves over a quarter now correlate ${fmt(comove, 2)}, but every week was sold at a forward price that already included its season. The market expected the seasons, so the hedge need cover only what it didn’t.`}
      />

      <H2>Basis risk that no crack contains</H2>
      <P>
        Even the matched hedge leaves {pct(1 - F.best.effectiveness)} of the variance behind. Of what remains, {pct(F.levelShare)} moves with surprises in the
        price of crude itself.
        Corran pays for {fmt(RUNS)} barrels of crude a day, but not everything it makes follows crude dollar for dollar: coke sells by the tonne at a price of its
        own, and LPG gains only about 45 cents for each dollar crude rises. So a dearer crude squeezes the margin even when the cracks hold steady. Most of the
        rest moves with fuel oil’s
        discount to crude, which sets what Coldwater Heavy costs (<a href={lessonHref('oil/4.5')}>Lesson 4.5</a>). Neither is in any crack spread.
      </P>
      <P>
        Location is a basis risk too. The standard crack quoted on the New York Mercantile Exchange is built from WTI crude, RBOB gasoline and ultra-low-sulfur diesel
        futures. Switch the crude leg to WTI, with Corran’s mix. The best this hedge can do is remove {pct(F.wtiBest.effectiveness)}, at a ratio of{' '}
        {fmt(F.wtiBest.ratio, 2)}; at 0.8 it {F.wti.effectiveness < 0 ? `adds ${pct(-F.wti.effectiveness)} to the variance` : `removes only ${pct(F.wti.effectiveness)}`}.
        Corran buys its crude at the coast, where it trades with Brent, but WTI is the price at Kessler, inland. Whenever the Kessler–Corran line is full, crude
        backs up at Kessler and WTI falls away from Brent, as in{' '}
        <a href={lessonHref('oil/4.4')}>Lesson 4.4</a> and <a href={lessonHref('oil/5.2')}>Lesson 5.2</a>: in this history the line runs full in {F.line.fullWeeks}{' '}
        weeks and the Brent–WTI spread ranges from {usd(F.line.low, 2)} to {usd(F.line.high, 2)}. When WTI cheapens, the crack measured against it widens, and a short
        WTI crack loses money — while Corran gains nothing, since it never buys at Kessler.
      </P>
      <P>What fills the line is the basin’s growth. Move the basin growth slider and watch the WTI hedge come and go.</P>

      <Challenge
        id="b"
        figure="Refinery Hedge Designer"
        question={`With a WTI crack in Corran’s mix and the seasons at normal, what is the fastest basin growth, to the nearest ${GROWTH_STEP} kb/d a year, at which the hedge can still remove at least ${pct(WTI_TARGET)} of the variance?`}
        solved={solvedB}
        status={
          st.bench !== 'wti' || st.mix !== 'corran'
            ? 'Set the crack to Corran’s mix and the crude leg to WTI.'
            : !near(st.seasonality, HISTORY_DEFAULTS.seasonality)
              ? 'Return the seasonal swing to normal (1.0×).'
              : r.effectiveness < WTI_TARGET
                ? `At ${st.growth} kb/d a year the line runs full in ${line.fullWeeks} weeks and this hedge ${effPhrase(r.effectiveness)}; the least-risk ratio here removes ${pct(best.effectiveness)}.`
                : `At ${st.growth} kb/d a year the hedge removes ${pct(r.effectiveness)}. Could the basin grow faster?`
        }
        success={
          nextUp
            ? `Solved: ${st.growth} kb/d a year. At that pace the line never quite fills (its busiest week uses ${pct(line.busiest, 1)} of it), Brent − WTI stays between ${usd(line.low, 2)} and ${usd(line.high, 2)}, and the WTI hedge removes ${pct(r.effectiveness)}, not far short of the ${pct(nextUp.brentBest.effectiveness)} of the best Brent hedge. At ${st.growth + GROWTH_STEP} kb/d a year the line runs full for ${nextUp.line.fullWeeks} weeks, the spread reaches ${usd(nextUp.line.high, 2)}, and the best WTI hedge removes only ${pct(nextUp.best.effectiveness)}. Basis risk isn’t a fixed property of a contract: pipes and tanks set it.`
            : `Solved: ${st.growth} kb/d a year.`
        }
      />

      <H2>What a hedge buys</H2>
      <P>
        A hedge doesn’t make the refinery more profitable. It changes when the money arrives. In the next demonstration Corran holds the matched hedge — its own mix,
        against Brent — at a ratio of 0.9, near the minimum-variance {fmt(F.best.ratio, 2)}, and we add up each quarter. The dashed line is the plan: the margin Corran
        planned on, seasons included, when it placed that quarter’s hedge. Drag across the chart, or use the arrow keys, to read a quarter:
      </P>

      <Figure name="Refinery Hedge Designer · quarter by quarter" scenario={s2}>
        <XYChart
          ariaLabel={`Corran’s margin in each of ${rows.length} quarters at a hedge ratio of ${fmt(qs.ratio, 2)}: quarter ${row.quarter} planned ${mShort(row.plan)}, earned ${mShort(row.unhedged)} unhedged and ${mShort(row.hedged)} hedged. Typical quarterly surprise ${mShort(qsum.rmsUnhedged)} unhedged and ${mShort(qsum.rmsHedged)} hedged.`}
          height={250}
          x={[0.5, rows.length + 0.5]}
          y={[qLo, qHi]}
          xTicks={[1, 4, 8, 12, 16, 20]}
          xFormat={(v) => String(v)}
          xLabel="quarter"
          yFormat={(v) => `${usd(v)}M`}
          yLabel="Margin in the quarter"
          refs={[{ axis: 'x', at: row.quarter, cursor: true }]}
          series={[
            { points: rows.map((x) => [x.quarter, x.plan / 1e6] as [number, number]), color: '#333', width: 1.5, dash: '5 4' },
            { points: rows.map((x) => [x.quarter, x.unhedged / 1e6] as [number, number]), color: GRAPHIC.gray, width: 2 },
            { points: rows.map((x) => [x.quarter, x.hedged / 1e6] as [number, number]), color: GRAPHIC.violet, width: 2.5 },
          ]}
          markers={[
            { x: row.quarter, y: row.plan / 1e6, color: '#333', hollow: true, r: 4 },
            { x: row.quarter, y: row.unhedged / 1e6, color: GRAPHIC.gray },
            { x: row.quarter, y: row.hedged / 1e6, color: GRAPHIC.violet },
          ]}
          onScrub={(x) => s2.set({ quarter: clamp(Math.round(x), 1, rows.length) })}
          scrubValue={row.quarter}
          scrubStep={1}
          scrubLabel="Quarter"
        />
        <Legend
          items={[
            { label: 'Plan', color: '#333', kind: 'line', dashed: true },
            { label: 'Unhedged', color: GRAPHIC.gray, kind: 'line' },
            { label: 'Hedged', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <Caption>
          Quarter {row.quarter} (weeks {row.firstWeek}–{row.lastWeek}): Corran planned on {mn(row.plan)} and earned {mn(row.unhedged)} unhedged. It had sold the
          crack at {usd(row.locked, 2)} on average, and it averaged {usd(row.realized, 2)}, so the hedge {row.payoff >= 0 ? 'paid' : 'cost'}{' '}
          {mn(Math.abs(row.payoff))} and the hedged margin was {mn(row.hedged)}.
        </Caption>
        <Readouts
          items={[
            { label: 'typical quarterly surprise, unhedged', value: mShort(qsum.rmsUnhedged), tone: 'green' },
            { label: 'typical quarterly surprise, hedged', value: mShort(qsum.rmsHedged), tone: 'green' },
            { label: 'five-year margin, unhedged', value: mShort(qsum.totalUnhedged, 0), tone: 'green' },
            { label: 'five-year margin, hedged', value: mShort(qsum.totalHedged, 0), tone: 'green' },
          ]}
        />
        <Slider
          label="Hedge ratio"
          tone="violet"
          value={qs.ratio}
          min={0}
          max={RATIO_MAX}
          step={RATIO_STEP}
          onChange={(v) => s2.set({ ratio: v })}
          display={`${fmt(qs.ratio, 2)} · ${fmt((qs.ratio * RUNS) / 1000)} kb/d`}
        />
        <Slider
          label="Seasonal swing"
          tone="red"
          value={qs.seasonality}
          min={0}
          max={SEASON_MAX}
          step={SEASON_STEP}
          onChange={(v) => s2.set({ seasonality: Math.round(v * 10) / 10 })}
          display={seasonDisplay(qs.seasonality)}
        />
      </Figure>

      <P>
        Look at quarter {fShort.quarter}. Corran planned on {mn(fShort.plan)}; then the cracks fell — the crack it had sold at {usd(fShort.locked, 2)} on average
        came in at {usd(fShort.realized, 2)} — and it earned {mn(fShort.unhedged)}, {mn(fShort.plan - fShort.unhedged)} short. The hedge
        paid {mn(fShort.payoff)}, leaving it{' '}
        {mn(fShort.plan - fShort.hedged)} short. In quarter {fWind.quarter} the cracks rose instead and the margin beat its plan by {mn(fWind.unhedged - fWind.plan)};
        the hedge gave back {mn(-fWind.payoff)} of that, and Corran finished {mn(fWind.hedged - fWind.plan)} ahead. Across the five years, the typical quarterly
        surprise falls from {mn(F.sum.rmsUnhedged)} to {mn(F.sum.rmsHedged)}, and the worst hedged quarter, quarter {fHedgedShort.quarter}, fell{' '}
        {mn(fHedgedShort.plan - fHedgedShort.hedged)} short of its plan.
      </P>
      <P>
        The hedge paid out in {F.sum.paidQuarters} of the {F.rows.length} quarters and cost money in the rest. In total it cost{' '}
        {mn(F.sum.totalUnhedged - F.sum.totalHedged)} out of {usd(F.sum.totalUnhedged / 1e9, 1)} billion of margin, because the cracks happened to drift up over the
        period: Corran sold the crack at {usd(F.rows[0].locked, 2)} on average for the first quarter and at as much as {usd(F.maxLocked, 2)} later on. In a
        falling market it would have paid; either way the sum is small next to the margin itself. What the hedge buys is a narrower range of outcomes.
      </P>
      <P>
        Notice also what it can’t do. The weakest quarter of the five years, quarter {fWeak.quarter}, earned {mn(fWeak.unhedged)} unhedged — but Corran had planned on{' '}
        {mn(fWeak.plan)}, because the cracks had already fallen by the time it placed that quarter’s hedge. Hedged, it earned {mn(fWeak.hedged)}. A hedge locks in the
        market of the day it’s placed; it protects against surprises, not against a low price that is already known, and rolling it every quarter only delays a
        lasting fall in the crack. That is why the hedged line is no steadier from quarter to quarter than the unhedged one: it follows the plan, and the plan follows
        the market. Turn the seasons up in <FigRef to="Refinery Hedge Designer · quarter by quarter">this demonstration</FigRef> and the plan itself swings more.
      </P>
      <P>
        So a hedge is a trade like any other, with a P&amp;L of its own, and the right one depends on the business behind it: its units and yields, its crudes and where it
        buys them. Each strategy in this chapter has been tested one at a time, on a single simulated history.{' '}
        <a href={lessonHref('oil/6.5')}>Lesson 6.5</a> brings them into one laboratory and asks how they behave together, and how much of what a backtest shows would
        survive a different five years.
      </P>
    </LessonPage>
  );
}
