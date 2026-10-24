import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, clamp, fmt, lessonHref, niceDomain, pct, usd, useScenario } from '../../../framework';
import { CALDER_DAY, CRACK_RATIOS, calderMargin, correlation, hedgeRefinery, type HedgeCrack, type HedgeResult } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { XYChart } from '../shared/charts';

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
  /** Ridgeback Basin growth, kb/d per year: what fills the Kessler–Calder line. */
  growth: number;
}

export const RATIO_MAX = 1.2;
export const RATIO_STEP = 0.05;
export const SEASON_MAX = 2;
export const SEASON_STEP = 0.1;
export const GROWTH_MAX = 140;
export const GROWTH_STEP = 10;
/** Challenge a: the share of variance the standard 3:2:1 must remove. */
export const STANDARD_TARGET = 0.5;
/** Challenge b: the share of variance the WTI hedge must still remove. */
export const WTI_TARGET = 0.6;
/** Calder's crude runs, barrels a day. */
export const RUNS = (CALDER_DAY.ridgeback + CALDER_DAY.coldwater) * 1000;
/** Weeks a quarter's hedge runs (the engine's quarter). */
const QUARTER = 13;

export const HEDGE_DEFAULTS: HedgeState = {
  mix: '3:2:1',
  bench: 'brent',
  ratio: 0.8,
  seasonality: HISTORY_DEFAULTS.seasonality,
  growth: HISTORY_DEFAULTS.basinGrowth,
};

export const MIX_LABEL: Record<MixId, string> = { '3:2:1': '3:2:1', '2:1:1': '2:1:1', calder: 'Calder’s mix' };
const BENCH_LABEL: Record<HedgeCrack, string> = { brent: 'Brent', wti: 'WTI' };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The simulated history for a setting of the physical drivers. */
export function historyOf(st: { seasonality: number; growth: number }): HistoryWeek[] {
  return oilHistory({ seasonality: st.seasonality, basinGrowth: st.growth });
}

/** Calder's hedge at a setting. */
export function hedgeFor(st: HedgeState): HedgeResult {
  return hedgeRefinery(historyOf(st), st.ratio, st.bench, CRACK_RATIOS[st.mix]);
}

/** The minimum-variance ratio for a setting's crack and history, and the share of variance it removes. */
export function bestHedge(st: HedgeState): { ratio: number; effectiveness: number } {
  const h = historyOf(st);
  const ratio = hedgeRefinery(h, 0, st.bench, CRACK_RATIOS[st.mix]).bestRatio;
  return { ratio, effectiveness: hedgeRefinery(h, ratio, st.bench, CRACK_RATIOS[st.mix]).effectiveness };
}

/** The typical (root-mean-square) hedged surprise at every ratio on the slider's grid, $/day. */
export function ratioSweep(st: HedgeState): Array<[number, number]> {
  const h = historyOf(st);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= Math.round(RATIO_MAX / RATIO_STEP); i++) {
    const r = i * RATIO_STEP;
    out.push([r, hedgeRefinery(h, r, st.bench, CRACK_RATIOS[st.mix]).sdHedged]);
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

export interface LineStats {
  /** Weeks the Kessler–Calder line runs full. */
  fullWeeks: number;
  /** The highest share of the line in use. */
  busiest: number;
  /** The Brent − WTI spread's range, $/bbl. */
  low: number;
  high: number;
}

/** How hard the Kessler–Calder line runs in a history, and how far WTI strays from Brent. */
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
 * the squared correlation between the hedged surprise and Brent's change since the hedge was placed.
 */
export function crudeLevelShare(h: HistoryWeek[], ratio: number): number {
  const r = hedgeRefinery(h, ratio, 'brent', CRACK_RATIOS.calder);
  const x: number[] = [];
  for (let t = 1; t < h.length; t++) {
    const t0 = Math.floor((t - 1) / QUARTER) * QUARTER;
    x.push(h[t].brent - h[t0].brent);
  }
  const c = correlation(x, r.hedgedSurprise);
  return c * c;
}

/** Challenge a: the standard 3:2:1 crack removes more than half the variance of Calder's surprises. */
export function standardCrackSolved(st: HedgeState): boolean {
  return st.mix === '3:2:1' && hedgeFor(st).effectiveness > STANDARD_TARGET;
}

/**
 * Challenge b: with a WTI crack in Calder's mix and normal seasons, the fastest basin growth (on the
 * slider's 10 kb/d grid) at which the hedge still removes at least 60% of the variance — at the
 * reader's ratio, and with no ratio able to reach 60% at the next step up.
 */
export function wtiGrowthSolved(st: HedgeState): boolean {
  if (st.bench !== 'wti' || st.mix !== 'calder' || !near(st.seasonality, HISTORY_DEFAULTS.seasonality)) return false;
  if (hedgeFor(st).effectiveness < WTI_TARGET) return false;
  return st.growth + GROWTH_STEP > GROWTH_MAX || bestHedge({ ...st, growth: st.growth + GROWTH_STEP }).effectiveness < WTI_TARGET;
}

/** The answer to challenge b: the fastest growth on the grid at which some ratio removes 60%. */
export function fastestWtiGrowth(): number {
  let answer = NaN;
  for (let g = 0; g <= GROWTH_MAX; g += GROWTH_STEP) {
    if (bestHedge({ ...HEDGE_DEFAULTS, mix: 'calder', bench: 'wti', growth: g }).effectiveness >= WTI_TARGET) answer = g;
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
  /** The margin Calder expected when it placed the quarter's hedge, $ for the quarter. */
  plan: number;
  unhedged: number;
  hedged: number;
  /** What the hedge paid (negative: cost), $. */
  payoff: number;
  /** The crack sold, and its average over the quarter, $/bbl. */
  locked: number;
  realized: number;
}

/** Adds a hedge's weeks up into quarters (each quarter's hedge runs the 13 weeks after it is placed). */
export function quarterly(r: HedgeResult, ratio: number): QuarterRow[] {
  const rows: QuarterRow[] = [];
  r.margin.forEach((m, i) => {
    const q = Math.floor(i / QUARTER);
    if (!rows[q]) rows[q] = { quarter: q + 1, firstWeek: i + 1, lastWeek: i + 1, plan: 0, unhedged: 0, hedged: 0, payoff: 0, locked: r.locked[i], realized: 0 };
    const row = rows[q];
    const pay = ratio * RUNS * (r.locked[i] - r.realized[i]) * 7;
    row.lastWeek = i + 1;
    row.plan += r.expected[i] * 7;
    row.unhedged += m * 7;
    row.payoff += pay;
    row.hedged += m * 7 + pay;
    row.realized += r.realized[i];
  });
  for (const row of rows) row.realized /= row.lastWeek - row.firstWeek + 1;
  return rows;
}

/** Calder's matched hedge (its own mix, against Brent), quarter by quarter. */
export function quartersFor(st: QuarterState): QuarterRow[] {
  const h = historyOf({ seasonality: st.seasonality, growth: HISTORY_DEFAULTS.basinGrowth });
  return quarterly(hedgeRefinery(h, st.ratio, 'brent', CRACK_RATIOS.calder), st.ratio);
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
  const margins = h.map((w) => calderMargin(w));
  const at = (mix: MixId, bench: HedgeCrack, ratio: number) => hedgeRefinery(h, ratio, bench, CRACK_RATIOS[mix]);
  const best = bestHedge({ ...HEDGE_DEFAULTS, mix: 'calder' });
  const rows = quartersFor(QUARTER_DEFAULTS);
  const sum = summarizeQuarters(rows);
  return {
    marginMin: Math.min(...margins),
    marginMax: Math.max(...margins),
    marginMean: margins.reduce((a, b) => a + b, 0) / margins.length,
    standard: at('3:2:1', 'brent', HEDGE_DEFAULTS.ratio),
    matched: at('calder', 'brent', HEDGE_DEFAULTS.ratio),
    twoOne: at('2:1:1', 'brent', HEDGE_DEFAULTS.ratio),
    wti: at('calder', 'wti', HEDGE_DEFAULTS.ratio),
    best,
    wtiBest: bestHedge({ ...HEDGE_DEFAULTS, mix: 'calder', bench: 'wti' }),
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
const seasonText = (s: number) => (s === 0 ? 'none' : `${fmt(s, 1)}× normal`);
const seasonPhrase = (s: number) => (s === 0 ? 'no seasonal swing' : `the seasonal swing at ${fmt(s, 1)}× normal`);
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
    const r = hedgeRefinery(h, st.ratio, st.bench, CRACK_RATIOS[st.mix]);
    const best = bestHedge(st);
    return { r, best, sweep: ratioSweep(st), line: lineStats(h), comove: crackComovement(h) };
  }, [st]);
  const { r, best, sweep, line, comove } = fig1;
  const solvedA = useMemo(() => standardCrackSolved(st), [st]);
  const solvedB = useMemo(() => wtiGrowthSolved(st), [st]);
  const nextUp = useMemo(() => {
    if (st.growth + GROWTH_STEP > GROWTH_MAX) return null;
    const up = { ...st, growth: st.growth + GROWTH_STEP };
    return { line: lineStats(historyOf(up)), best: bestHedge(up), brentBest: bestHedge({ ...st, bench: 'brent' }) };
  }, [st]);

  const weeks = r.surprise.length;
  const surprisePts = (xs: number[]) => xs.map((v, i) => [(i + 1) / 52, v / 1000] as [number, number]);
  const [sLo, sHi] = niceDomain(Math.min(...r.surprise, ...r.hedgedSurprise) / 1000, Math.max(...r.surprise, ...r.hedgedSurprise) / 1000, 4);
  const [, uHi] = niceDomain(0, Math.max(r.sdUnhedged, ...sweep.map((p) => p[1])) / 1000, 4);
  const bestShown = best.ratio >= 0 && best.ratio <= RATIO_MAX;
  const bestSd = bestShown ? hedgeRefinery(historyOf(st), best.ratio, st.bench, CRACK_RATIOS[st.mix]).sdHedged : 0;
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
  const products = CALDER_DAY.gasoline + CALDER_DAY.jet + CALDER_DAY.diesel;

  return (
    <LessonPage id="oil/6.4">
      <P>
        In <a href={lessonHref('oil/6.3')}>Lesson 6.3</a> the crack spread was a bet: a trader could take it or leave it, going long or short as product stocks and
        outages suggested. The Calder refinery has no such choice. Every barrel it runs it buys as crude and sells as products, so it is long the crack every day of
        the year, whether it likes it or not. Run every day as on its reference day in <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> —{' '}
        {fmt(CALDER_DAY.ridgeback * 1000)} barrels a day of Ridgeback Light and {fmt(CALDER_DAY.coldwater * 1000)} of Coldwater Heavy in; gasoline, jet fuel,
        diesel and the rest out — through the simulated history of Chapter 5, its <K c="price">margin</K> swings between {mn(F.marginMin)} and {mn(F.marginMax)} a
        day, around an average of {mn(F.marginMean)}. This lesson asks what Calder can do about that swing, and what it can’t.
      </P>
      <P>
        The tool is a <K tone="violet">hedge</K>: a position in the futures market that gains when the business loses. If Calder sells the crack forward — sells
        gasoline and diesel futures and buys crude futures — then a fall in the crack costs the refinery but pays the futures position, and a rise does the reverse.
        We’ll use a simple version. At the start of each quarter, Calder expects its margin to stay where it is and sells the crack for the coming 13 weeks at that
        week’s level, on some fraction of its {fmt(RUNS)} barrels a day of runs: the <K tone="violet">hedge ratio</K>. Each week the hedge pays the crack it sold
        minus the crack that week, on every barrel hedged. What it protects against is the margin’s <K c="price">surprise</K>, what Calder earned less what it
        expected. We’ll measure the typical surprise by its root-mean-square size, and a hedge’s <K tone="violet">effectiveness</K> by the share of the surprises’
        variance (the square of that typical size) it removes. A real refiner would sell each future month’s crack at its own futures price, which already includes
        the seasons the market expects; we leave that refinement aside. As everywhere in the course, the prices are simulated for teaching.
      </P>
      <P>
        In the next demonstration, Calder starts with the textbook instrument, the 3:2:1 crack — two barrels of gasoline and one of diesel against three of crude —
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
            { value: 'calder' as const, label: 'Calder’s mix' },
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
          ariaLabel={`Calder’s weekly margin surprise over five simulated years, hedged with ${crackText} at a ratio of ${fmt(st.ratio, 2)}: typical size ${kday(r.sdUnhedged)} a day unhedged and ${kday(r.sdHedged)} hedged.`}
          height={220}
          x={[0, 5]}
          y={[sLo, sHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={(v) => (v === 0 ? 'year 0' : String(v))}
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
            { label: <K tone="violet">least-risk ratio</K>, value: fmt(best.ratio, 2), tone: 'violet' },
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
          label="Seasonal swing in demand"
          tone="orange"
          value={st.seasonality}
          min={0}
          max={SEASON_MAX}
          step={SEASON_STEP}
          onChange={(v) => s1.set({ seasonality: v })}
          display={seasonText(st.seasonality)}
        />
        <Slider
          label="Ridgeback Basin growth"
          tone="orange"
          value={st.growth}
          min={0}
          max={GROWTH_MAX}
          step={GROWTH_STEP}
          onChange={(v) => s1.set({ growth: v })}
          display={`${st.growth} kb/d a year`}
        />
        <Caption>
          Calder sells {crackText} on {fmt((st.ratio * RUNS) / 1000)} thousand barrels a day; the hedge {effPhrase(r.effectiveness)} of its {weeks} weekly
          surprises. Over a quarter, the gasoline and diesel cracks’ moves correlate {fmt(comove, 2)}. The Kessler–Calder line runs full in {line.fullWeeks}{' '}
          of 260 weeks, and Brent − WTI ranges from {usd(line.low, 2)} to {usd(line.high, 2)}.
        </Caption>
      </Figure>

      <P>
        The textbook hedge makes things worse. With the 3:2:1 on 80% of its runs, Calder’s typical surprise grows from {kday(F.standard.sdUnhedged)} a day to{' '}
        {kday(F.standard.sdHedged)}: the hedge adds {pct(-F.standard.effectiveness)} to the variance it was meant to remove, and the lower chart shows that the least
        risky 3:2:1 position is almost no position at all, a ratio of {fmt(F.standard.bestRatio, 2)}. Now switch the crack to Calder’s own mix, {pct(CRACK_RATIOS.calder)}{' '}
        gasoline and {pct(1 - CRACK_RATIOS.calder)} diesel (jet fuel, which in our model tracks diesel, counted with it). At the same ratio the typical surprise falls
        to {kday(F.matched.sdHedged)} a day, and the hedge removes {pct(F.matched.effectiveness)} of the variance. The 2:1:1, half gasoline and half diesel, lands in
        between, at {pct(F.twoOne.effectiveness)}.
      </P>
      <P>
        The difference is in the products. Calder is a diesel refinery: of the {fmt(products * 1000)} barrels a day of gasoline, jet fuel and diesel it makes, only{' '}
        {fmt(CALDER_DAY.gasoline * 1000)} are gasoline. The 3:2:1 is two-thirds gasoline. And in the simulated history the two cracks move against each other with
        the seasons, as in <a href={lessonHref('oil/5.3')}>Lesson 5.3</a>: gasoline’s rises through spring and summer while diesel’s falls, and the reverse through
        autumn and winter. Over the 13 weeks a hedge runs, their changes have a correlation of {fmt(F.comove, 2)}. A gasoline-heavy crack climbs in spring just as
        Calder’s diesel-heavy margin softens, so the hedge loses money in the very quarters the refinery does. A hedge works only as far as the instrument moves
        with what it hedges. The part of the business it doesn’t share is <K tone="violet">basis risk</K>, and choosing an instrument is mostly choosing which basis
        risk to keep.
      </P>
      <P>
        With Calder’s mix, the curve in the lower chart bottoms out at a ratio of {fmt(F.best.ratio, 2)}, where the hedge removes {pct(F.best.effectiveness)}. That
        lowest point is the <K tone="violet">minimum-variance hedge ratio</K>. Hedge less and Calder keeps risk it could have shed; hedge more and the futures
        position becomes a bet of its own, in the opposite direction.
      </P>

      <Challenge
        id="a"
        question="Suppose Calder’s treasurer insists on the standard 3:2:1 crack. Find a physical world in which it removes more than half of the variance of Calder’s surprises."
        solved={solvedA}
        status={
          st.mix !== '3:2:1'
            ? 'Choose the 3:2:1 crack.'
            : `With ${seasonPhrase(st.seasonality)}, the 3:2:1 ${effPhrase(r.effectiveness)}; its least risky ratio here is ${fmt(best.ratio, 2)}. What makes it fail?`
        }
        success={`Solved: with ${seasonPhrase(st.seasonality)}, the 3:2:1 removes ${pct(r.effectiveness)}. Over a quarter the gasoline and diesel cracks’ moves now correlate ${fmt(comove, 2)}, against ${fmt(F.comove, 2)} with normal seasons. Once the seasons stop pulling the two products apart, any crack built from them tracks Calder’s margin, and the 3:2:1’s tilt toward gasoline hardly matters. It is the seasons that turn the standard hedge into a bet.`}
      />

      <H2>Basis risk that no crack contains</H2>
      <P>
        Even the matched hedge leaves {pct(1 - F.best.effectiveness)} of the variance behind. Of what remains, {pct(F.levelShare)} moves with the price of crude itself.
        Calder pays for {fmt(RUNS)} barrels of crude a day, but some of what it makes doesn’t follow crude up and down: coke sells by the tonne at a price of its own,
        and LPG for less than half the price of crude. So a dearer crude squeezes the margin even when the cracks hold steady. Most of the rest moves with fuel oil’s
        discount to crude, which sets what Coldwater Heavy costs (<a href={lessonHref('oil/4.5')}>Lesson 4.5</a>). Neither is in any crack spread.
      </P>
      <P>
        Location is a basis risk too. The standard crack quoted on the New York Mercantile Exchange is built from WTI crude, RBOB gasoline and ultra-low-sulfur diesel
        futures. Switch the crude leg to WTI, with Calder’s mix. The best this hedge can do is remove {pct(F.wtiBest.effectiveness)}, at a ratio of{' '}
        {fmt(F.wtiBest.ratio, 2)}; at 0.8 it removes only {pct(F.wti.effectiveness)}. Calder buys its crude at the coast, where it trades with Brent, but WTI is the
        price at Kessler, inland. Whenever the Kessler–Calder line is full, crude backs up at Kessler and WTI falls away from Brent, as in{' '}
        <a href={lessonHref('oil/4.4')}>Lesson 4.4</a> and <a href={lessonHref('oil/5.2')}>Lesson 5.2</a>: in this history the line runs full in {F.line.fullWeeks}{' '}
        weeks and the Brent–WTI spread ranges from {usd(F.line.low, 2)} to {usd(F.line.high, 2)}. When WTI cheapens, the crack measured against it widens, and a short
        WTI crack loses money — while Calder gains nothing, since it never buys at Kessler.
      </P>
      <P>What fills the line is the basin’s growth. Move the basin growth slider and watch the WTI hedge come and go.</P>

      <Challenge
        id="b"
        figure="Refinery Hedge Designer"
        question={`With a WTI crack in Calder’s mix and the seasons at normal, what is the fastest basin growth, to the nearest ${GROWTH_STEP} kb/d a year, at which the hedge can still remove at least ${pct(WTI_TARGET)} of the variance?`}
        solved={solvedB}
        status={
          st.bench !== 'wti' || st.mix !== 'calder'
            ? 'Set the crack to Calder’s mix and the crude leg to WTI.'
            : !near(st.seasonality, HISTORY_DEFAULTS.seasonality)
              ? 'Return the seasonal swing to normal (1.0×).'
              : r.effectiveness < WTI_TARGET
                ? `At ${st.growth} kb/d a year the line runs full in ${line.fullWeeks} weeks and this hedge ${effPhrase(r.effectiveness)}; the least-risk ratio here removes ${pct(best.effectiveness)}.`
                : `At ${st.growth} kb/d a year the hedge removes ${pct(r.effectiveness)}. Could the basin grow faster?`
        }
        success={
          nextUp
            ? `Solved: ${st.growth} kb/d a year. At that pace the line never quite fills (its busiest week uses ${pct(line.busiest, 1)} of it), Brent − WTI stays between ${usd(line.low, 2)} and ${usd(line.high, 2)}, and the WTI hedge removes ${pct(r.effectiveness)}, close to the ${pct(nextUp.brentBest.effectiveness)} of the best Brent hedge. At ${st.growth + GROWTH_STEP} kb/d a year the line runs full for ${nextUp.line.fullWeeks} weeks, the spread reaches ${usd(nextUp.line.high, 2)}, and the best WTI hedge removes only ${pct(nextUp.best.effectiveness)}. Basis risk isn’t a fixed property of a contract: pipes and tanks set it.`
            : `Solved: ${st.growth} kb/d a year.`
        }
      />

      <H2>What a hedge buys</H2>
      <P>
        A hedge doesn’t make the refinery more profitable. It changes when the money arrives. In the next demonstration Calder holds the matched hedge — its own mix,
        against Brent — at a ratio of 0.9, near the minimum-variance {fmt(F.best.ratio, 2)}, and we add up each quarter. The dashed line is the plan: the margin Calder
        expected when it placed that quarter’s hedge. Drag across the chart, or use the arrow keys, to read a quarter:
      </P>

      <Figure name="Refinery Hedge Designer · quarter by quarter" scenario={s2}>
        <XYChart
          ariaLabel={`Calder’s margin in each of ${rows.length} quarters at a hedge ratio of ${fmt(qs.ratio, 2)}: quarter ${row.quarter} planned ${mShort(row.plan)}, earned ${mShort(row.unhedged)} unhedged and ${mShort(row.hedged)} hedged. Typical quarterly surprise ${mShort(qsum.rmsUnhedged)} unhedged and ${mShort(qsum.rmsHedged)} hedged.`}
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
          Quarter {row.quarter} (weeks {row.firstWeek}–{row.lastWeek}): Calder planned on {mn(row.plan)} and earned {mn(row.unhedged)} unhedged. It had sold the
          crack at {usd(row.locked, 2)}, which averaged {usd(row.realized, 2)}, so the hedge {row.payoff >= 0 ? 'paid' : 'cost'} {mn(Math.abs(row.payoff))} and the
          hedged margin was {mn(row.hedged)}.
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
          label="Seasonal swing in demand"
          tone="orange"
          value={qs.seasonality}
          min={0}
          max={SEASON_MAX}
          step={SEASON_STEP}
          onChange={(v) => s2.set({ seasonality: v })}
          display={seasonText(qs.seasonality)}
        />
      </Figure>

      <P>
        Look at quarter {fShort.quarter}. Calder planned on {mn(fShort.plan)}; then the cracks fell — the crack it had sold at {usd(fShort.locked, 2)} averaged{' '}
        {usd(fShort.realized, 2)} — and it earned {mn(fShort.unhedged)}, {mn(fShort.plan - fShort.unhedged)} short. The hedge paid {mn(fShort.payoff)}, leaving it{' '}
        {mn(fShort.plan - fShort.hedged)} short. In quarter {fWind.quarter} the cracks rose instead and the margin beat its plan by {mn(fWind.unhedged - fWind.plan)};
        the hedge gave back {mn(-fWind.payoff)} of that, and Calder finished {mn(fWind.hedged - fWind.plan)} ahead. Across the five years, the typical quarterly
        surprise falls from {mn(F.sum.rmsUnhedged)} to {mn(F.sum.rmsHedged)}, and the worst hedged quarter, quarter {fHedgedShort.quarter}, fell{' '}
        {mn(fHedgedShort.plan - fHedgedShort.hedged)} short of its plan.
      </P>
      <P>
        The hedge paid out in {F.sum.paidQuarters} of the {F.rows.length} quarters and cost money in the rest. In total it cost{' '}
        {mn(F.sum.totalUnhedged - F.sum.totalHedged)} out of {usd(F.sum.totalUnhedged / 1e9, 1)} billion of margin, because the cracks happened to drift up over the
        period: Calder sold the crack at {usd(F.rows[0].locked, 2)} for the first quarter and at as much as {usd(F.maxLocked, 2)} later on. That is what a hedge
        costs in a rising market; in a falling one it would have paid, and either way the sum is small next to the margin itself. What the hedge buys is a narrower
        range of outcomes.
      </P>
      <P>
        Notice also what it can’t do. The weakest quarter of the five years, quarter {fWeak.quarter}, earned {mn(fWeak.unhedged)} unhedged — but Calder had planned on{' '}
        {mn(fWeak.plan)}, because the cracks had already fallen by the time it placed that quarter’s hedge. Hedged, it earned {mn(fWeak.hedged)}. A hedge locks in the
        market of the day it’s placed; it protects against surprises, not against a low price that is already known, and rolling it every quarter only delays a
        lasting fall in the crack. That is why the hedged line is no steadier from quarter to quarter than the unhedged one: it follows the plan, and the plan follows
        the market. Turn the seasons up in <FigRef to="Refinery Hedge Designer · quarter by quarter">this demonstration</FigRef> and the plan itself swings more.
      </P>
      <P>
        So a hedge is a trade like any other, with a P&amp;L of its own, and the right one depends on the physical business behind it: Calder’s units and yields, the
        crudes it buys and where it buys them. Each strategy in this chapter has been tested one at a time, on a single simulated history.{' '}
        <a href={lessonHref('oil/6.5')}>Lesson 6.5</a> brings them into one laboratory and asks how they behave together, and how much of what a backtest shows would
        survive a different five years.
      </P>
    </LessonPage>
  );
}
