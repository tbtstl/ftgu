import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, TEXT, fmt, lessonHref, niceDomain, niceTicks, pct, usd, useScenario } from '../../../framework';
import { RULE_DEFAULTS, backtest, basisRule, expansionWeek, qualityRule, type BacktestResult } from '../../../engines/oil/trading';
import { CRUDE_COLOR } from '../../../model/oil/crudes';
import { NETWORK_DEFAULTS } from '../../../engines/oil/network';
import { FUEL_OIL_REVERSION, HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { XYChart } from '../shared/charts';
import { LONG_SWATCH, RISK_TONE, SHORT_SWATCH, YEAR_TICKS, money, pnlTone, positionBands, yearTick } from './style';

// ---------------------------------------------------------------------------
// The basis trade: Brent − WTI, driven by the Kessler–Corran line.

/** Positions are traded in units of one spread, 1,000 barrels a leg; the lesson holds up to 10. */
export const UNITS = 10;

export type ExpansionYear = '1' | '2' | '3' | '4' | '5' | 'never';

export interface BasisState {
  /** Pinyon Basin growth, kb/d per year. */
  growth: number;
  /** Year the Kessler–Corran expansion opens, or never; and the capacity it adds, kb/d. */
  year: ExpansionYear;
  add: number;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
  /** The rule: pipeline use that triggers a long, weeks before the opening to go short, and how far above its 12-week low the spread may sit. */
  use: number;
  lead: number;
  stretch: number;
}

export const BASIS_DEFAULTS: BasisState = {
  growth: HISTORY_DEFAULTS.basinGrowth,
  year: String(HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.year : 3) as ExpansionYear,
  add: HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.add : 300,
  rail: HISTORY_DEFAULTS.rail,
  use: RULE_DEFAULTS.basis.useThreshold,
  lead: RULE_DEFAULTS.basis.leadWeeks,
  stretch: RULE_DEFAULTS.basis.stretch,
};

/** The simulated history for the basis trade's physical drivers. */
export function basisHistory(st: BasisState): HistoryWeek[] {
  return oilHistory({ basinGrowth: st.growth, rail: st.rail, expansion: st.year === 'never' ? null : { year: Number(st.year), add: st.add } });
}

export interface Run {
  h: HistoryWeek[];
  result: BacktestResult;
}

export interface BasisRun extends Run {
  /** The week the expansion opens, or null. */
  opening: number | null;
}

const basisCache = new Map<string, BasisRun>();

/** The basis rule run over the history its drivers produce, at 10 units. */
export function runBasis(st: BasisState): BasisRun {
  const key = JSON.stringify([st.growth, st.year, st.add, st.rail, st.use, st.lead, st.stretch]);
  let r = basisCache.get(key);
  if (!r) {
    const h = basisHistory(st);
    const opening = expansionWeek(h);
    const result = backtest(h, 'basis', basisRule(h, { useThreshold: st.use, leadWeeks: st.lead, stretch: st.stretch }, opening), { units: UNITS });
    r = { h, opening, result };
    if (basisCache.size > 200) basisCache.clear();
    basisCache.set(key, r);
  }
  return r;
}

export const GROWTH_STEP = 5;
export const GROWTH_MAX = 150;

/** Everything but the basin's growth at its starting value. */
function basisAtDefaultsExceptGrowth(st: BasisState): boolean {
  const d = BASIS_DEFAULTS;
  return st.year === d.year && st.add === d.add && st.rail === d.rail && st.use === d.use && st.lead === d.lead && st.stretch === d.stretch;
}

/**
 * Challenge a: with everything else at its starting value, the fastest basin growth on the 5 kb/d
 * grid at which the basis trader never trades.
 */
export function idleGrowthSolved(st: BasisState): boolean {
  if (!basisAtDefaultsExceptGrowth(st)) return false;
  if (runBasis(st).result.turnover > 0) return false;
  return st.growth + GROWTH_STEP > GROWTH_MAX || runBasis({ ...st, growth: st.growth + GROWTH_STEP }).result.turnover > 0;
}

/** The answer to challenge a. */
export function idleGrowth(): number {
  let best = NaN;
  for (let g = 0; g <= GROWTH_MAX; g += GROWTH_STEP) {
    if (runBasis({ ...BASIS_DEFAULTS, growth: g }).result.turnover > 0) break;
    best = g;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The quality trade: Coldwater Heavy − light crude at Port Corran, driven by fuel oil.

export type ShiftYear = '1' | '2' | '3' | '4';

export interface QualityState {
  /** A lasting widening of fuel oil's discount to Brent: the year it starts and its size, $/bbl. */
  year: ShiftYear;
  shift: number;
  /** How fast fuel oil's discount returns to its usual level: the share of the gap that closes each week, % (users and cokers answering price). */
  pull: number;
  /** The rule: weeks behind the discount's average, and how far from it the discount must sit, $/bbl. */
  lookback: number;
  band: number;
}

export const PULL_DEFAULT = FUEL_OIL_REVERSION * 100;
export const PULL_MAX = 20;

export const QUALITY_DEFAULTS: QualityState = { year: '2', shift: 0, pull: PULL_DEFAULT, lookback: RULE_DEFAULTS.quality.lookback, band: RULE_DEFAULTS.quality.band };

export function qualityHistory(st: QualityState): HistoryWeek[] {
  return oilHistory({
    fuelOilShock: st.shift > 0 ? { year: Number(st.year), size: st.shift } : null,
    ...(st.pull === PULL_DEFAULT ? {} : { fuelOilReversion: st.pull / 100 }),
  });
}

/** Weeks for half of a gap in fuel oil's discount to close, at a weekly pull in %. */
export function halfLife(pull: number): number {
  return pull > 0 ? Math.log(0.5) / Math.log(1 - pull / 100) : Infinity;
}

const qualityCache = new Map<string, Run>();

/** The quality rule run over the history, at 10 units. */
export function runQuality(st: QualityState): Run {
  const key = JSON.stringify([st.shift > 0 ? st.year : '-', st.shift, st.pull, st.lookback, st.band]);
  let r = qualityCache.get(key);
  if (!r) {
    const h = qualityHistory(st);
    r = { h, result: backtest(h, 'quality', qualityRule(h, { lookback: st.lookback, band: st.band }), { units: UNITS }) };
    if (qualityCache.size > 200) qualityCache.clear();
    qualityCache.set(key, r);
  }
  return r;
}

export const SHIFT_MAX = 20;

function qualityRuleAtDefaults(st: QualityState): boolean {
  return st.lookback === QUALITY_DEFAULTS.lookback && st.band === QUALITY_DEFAULTS.band && st.pull === QUALITY_DEFAULTS.pull;
}

/**
 * Challenge b: with the rule and fuel oil's pull at their starting settings and the shift starting
 * two years in, the smallest whole-dollar lasting widening of fuel oil's discount that leaves the
 * quality trader with a five-year loss.
 */
export function losingShiftSolved(st: QualityState): boolean {
  if (st.year !== '2' || !qualityRuleAtDefaults(st)) return false;
  if (runQuality(st).result.stats.total >= 0) return false;
  return st.shift === 0 || runQuality({ ...st, shift: st.shift - 1 }).result.stats.total >= 0;
}

/** The answer to challenge b. */
export function smallestLosingShift(): number {
  for (let s = 0; s <= SHIFT_MAX; s++) if (runQuality({ ...QUALITY_DEFAULTS, year: '2', shift: s }).result.stats.total < 0) return s;
  return NaN;
}

/** Fuel oil's discount to Brent, $/bbl. */
export function fuelOilDiscount(w: HistoryWeek): number {
  return w.brent - w.hsfo;
}

/** The trailing average the quality rule compares the discount with (null before there's enough history). */
export function discountAverage(h: HistoryWeek[], lookback: number): Array<number | null> {
  const d = h.map(fuelOilDiscount);
  let sum = 0;
  return d.map((_, t) => {
    if (t > 0) sum += d[t - 1];
    if (t > lookback) sum -= d[t - lookback - 1];
    return t >= lookback ? sum / lookback : null;
  });
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose, computed once from the model.

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

let facts: ReturnType<typeof computeFacts> | null = null;
function computeFacts() {
  const base = runBasis(BASIS_DEFAULTS);
  const h = base.h;
  const opening = base.opening ?? h.length;
  const lead = BASIS_DEFAULTS.lead;
  const pnl = base.result.pnl;
  const spread = h.map((w) => w.brent - w.wti);
  const before = h.slice(0, opening);
  const floor = avg(before.map((w, i) => (w.pipelineUse < 0.96 ? spread[i] : NaN)).filter(Number.isFinite));
  const ceiling = avg(before.map((w, i) => (w.pipelineUse >= 1 ? spread[i] : NaN)).filter(Number.isFinite));
  const jumps = pnl.map((p, i) => ({ i, p })).filter((x) => x.i < opening - lead && x.p > 50000);
  const lastJump = jumps.length ? jumps[jumps.length - 1].i : 0;
  const steady = pnl.slice(lastJump + 1, opening - lead);
  // The smallest rail capacity (on a 25 kb/d grid) from which more rail changes nothing.
  let railFrom = 300;
  for (let r = 275; r >= 0; r -= 25) {
    if (Math.abs(runBasis({ ...BASIS_DEFAULTS, rail: r }).result.stats.total - base.result.stats.total) > 1) break;
    railFrom = r;
  }
  const ns = runBasis({ ...BASIS_DEFAULTS, lead: 0 }).result;
  const q = runQuality(QUALITY_DEFAULTS);
  const q10 = runQuality({ ...QUALITY_DEFAULTS, shift: 10 });
  const noPull = runQuality({ ...QUALITY_DEFAULTS, pull: 0 });
  // Without the expansion: the week the basin first outgrows pipeline and rail together.
  const nv = runBasis({ ...BASIS_DEFAULTS, year: 'never' });
  const N = NETWORK_DEFAULTS;
  const railFull = nv.h.findIndex((w) => w.basinSupply + Math.min(N.coldwaterSupply, N.coldwaterLine) - N.inlandDemand > w.pipelineCapacity + BASIS_DEFAULTS.rail);
  const shiftWeek = 2 * 52;
  return {
    basis: base.result.stats,
    basisCosts: base.result.costs,
    floor,
    ceiling,
    jumps: jumps.length,
    jumpMin: Math.min(...jumps.map((x) => x.p)),
    jumpMax: Math.max(...jumps.map((x) => x.p)),
    jumpFrom: jumps.length ? jumps[0].i / 52 : NaN,
    jumpTo: jumps.length ? (lastJump + 1) / 52 : NaN,
    steadyWeeks: steady.length,
    steadyPnl: sum(steady),
    openingYears: opening / 52,
    openingFrom: spread[opening - 1],
    openingTo: spread[opening],
    openingPnl: pnl[opening - 1],
    never: nv.result.stats.total,
    noShort: ns.stats.total,
    noShortOpening: ns.pnl[opening - 1],
    neverRailYear: railFull >= 0 ? Math.floor(railFull / 52) + 1 : NaN,
    noRail: runBasis({ ...BASIS_DEFAULTS, rail: 0 }).result.stats.total,
    railFrom,
    quality: q.result.stats,
    qualityCosts: q.result.costs,
    qualityTurnover: q.result.turnover,
    q10: q10.result.stats,
    q10YearAfter: sum(q10.result.pnl.slice(shiftWeek, shiftWeek + 52)),
    noPull: noPull.result.stats,
    noPullCosts: noPull.result.costs,
  };
}
function getFacts() {
  if (!facts) facts = computeFacts();
  return facts;
}

// ---------------------------------------------------------------------------
// Display helpers.

const SPREAD = GRAPHIC.green;
const PIPE = GRAPHIC.orange;
const FUEL_OIL = GRAPHIC.gold;

/** Prices and spreads, $/bbl. */
function dollars(x: number, digits = 2): string {
  return usd(x, digits);
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
function yearsWord(t: number): string {
  const n = Math.round(t);
  return Math.abs(t - n) < 1e-9 && n >= 0 && n < WORDS.length ? WORDS[n] : fmt(t, 1);
}

function kFormat(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  const s = a >= 1000 ? `$${fmt(a / 1000, a % 1000 === 0 ? 0 : 1)}M` : `$${fmt(a)}k`;
  return (v < 0 ? '−' : '') + s;
}

/** The running total of a weekly P&L, in thousands of dollars. */
function PnlChart({ pnl, ariaLabel, height = 120 }: { pnl: number[]; ariaLabel: string; height?: number }) {
  const pts: Array<[number, number]> = [[0, 0]];
  let run = 0;
  pnl.forEach((p, i) => {
    run += p;
    pts.push([(i + 1) / 52, run / 1000]);
  });
  const vals = pts.map((p) => p[1]);
  const [lo, hi] = niceDomain(Math.min(0, ...vals), Math.max(10, ...vals), 3);
  return (
    <XYChart
      ariaLabel={ariaLabel}
      height={height}
      x={[0, 5]}
      y={[lo, hi]}
      xTicks={YEAR_TICKS}
      xFormat={yearTick}
      yTicks={niceTicks(lo, hi, 3)}
      yFormat={kFormat}
      yLabel="Cumulative P&L at 10 units"
      series={[{ points: pts, color: '#333', width: 2, fillTo: 0, fillOpacity: 0.08 }]}
    />
  );
}


export default function Lesson() {
  const f = getFacts();

  // ---- Figure 1: the basis trader.
  const s1 = useScenario<BasisState>('basis', BASIS_DEFAULTS);
  const st = s1.state;
  const b = useMemo(() => runBasis(st), [st]);
  const h = b.h;
  const r1 = b.result;
  const solvedA = useMemo(() => idleGrowthSolved(st), [st]);
  const nextGrowth = useMemo(() => (st.growth + GROWTH_STEP <= GROWTH_MAX ? runBasis({ ...st, growth: st.growth + GROWTH_STEP }) : null), [st]);
  const spreadPts = useMemo(() => h.map((w) => [w.t, w.brent - w.wti] as [number, number]), [h]);
  const usePts = useMemo(() => h.map((w) => [w.t, w.pipelineUse * 100] as [number, number]), [h]);
  const maxSpread = Math.max(...spreadPts.map((p) => p[1]));
  const yTop = Math.max(15, Math.ceil(maxSpread / 5) * 5);
  const maxUse = Math.max(...h.map((w) => w.pipelineUse));
  const useLo = Math.min(50, Math.floor(Math.min(...h.map((w) => w.pipelineUse)) * 10) * 10);
  const longWeeks = r1.positions.filter((p) => p > 0).length;
  const shortWeeks = r1.positions.filter((p) => p < 0).length;
  const firstTrigger = h.findIndex((w) => w.pipelineUse >= st.use);
  const never = st.year === 'never';
  const openRef = b.opening !== null ? [{ axis: 'x' as const, at: b.opening / 52, color: '#555', dash: '4 4', label: 'expansion opens' }] : [];

  // ---- Figure 2: the quality trader.
  const s2 = useScenario<QualityState>('quality', QUALITY_DEFAULTS);
  const qs = s2.state;
  const q = useMemo(() => runQuality(qs), [qs]);
  const qh = q.h;
  const r2 = q.result;
  const solvedB = useMemo(() => losingShiftSolved(qs), [qs]);
  const prevShift = useMemo(() => (qs.shift > 0 ? runQuality({ ...qs, shift: qs.shift - 1 }).result.stats.total : NaN), [qs]);
  const discPts = useMemo(() => qh.map((w) => [w.t, fuelOilDiscount(w)] as [number, number]), [qh]);
  const avgs = useMemo(() => discountAverage(qh, qs.lookback), [qh, qs.lookback]);
  const envelope = useMemo(() => {
    const mid: Array<[number, number]> = [];
    const up: Array<[number, number]> = [];
    const dn: Array<[number, number]> = [];
    avgs.forEach((a, i) => {
      if (a === null) return;
      mid.push([i / 52, a]);
      up.push([i / 52, a + qs.band]);
      dn.push([i / 52, a - qs.band]);
    });
    return { mid, up, dn };
  }, [avgs, qs.band]);
  const qualityPts = useMemo(() => qh.map((w) => [w.t, w.coldwater - w.corranCrude] as [number, number]), [qh]);
  const discVals = discPts.map((p) => p[1]);
  const [dLo, dHi] = niceDomain(Math.min(5, ...discVals), Math.max(25, ...discVals), 4);
  const qVals = qualityPts.map((p) => p[1]);
  const [qLo, qHi] = niceDomain(Math.min(...qVals), Math.max(...qVals), 3);
  const shiftAt = Number(qs.year);
  const shiftWeek = shiftAt * 52;
  const discBefore = avg(discVals.slice(0, shiftWeek));
  const discAfter = avg(discVals.slice(shiftWeek));
  const qLong = r2.positions.filter((p) => p > 0).length;
  const qShort = r2.positions.filter((p) => p < 0).length;
  const yearAfter = sum(r2.pnl.slice(shiftWeek, shiftWeek + 52));

  return (
    <LessonPage id="oil/6.2">
      <P>
        <a href={lessonHref('oil/6.1')}>Lesson 6.1</a> traded a spread in time: a barrel at Kessler this month against the same barrel next month, priced by how
        full the tanks were. This lesson trades spreads in <b>space</b> and in <b>quality</b>. The first is Brent against WTI, the coast against the inland hub.
        The difference between a local price and a benchmark price is called a <K c="price">basis</K>: Brent − WTI is the basis between the coast and the inland
        hub, and a trader who holds it is a basis trader. The second is a heavy, sour crude against a light, sweet one at the same port. Both are the
        differentials of <a href={lessonHref('oil/5.2')}>Lesson 5.2</a>,
        and both have physical causes we’ve already derived: the pipeline out of the Pinyon Basin, and the residue in a heavy barrel.
      </P>
      <P>
        WTI and Brent are real benchmarks, but every price here comes from the course’s simulated five years of weeks, not from any market. Being{' '}
        <K c="price">long the spread</K> means buying Brent and selling WTI in equal amounts, which earns when the gap between them widens and loses when it
        narrows. The trader here holds up to 10 units, 1,000 barrels a leg each, so a $1 move in the spread is worth $10,000.
      </P>
      <P>
        Physics gives this spread a floor and a ceiling. While the Kessler–Corran line has room, nobody ships inland crude to the coast for less than it costs to
        ship, so the spread sits near the line’s $2 tariff plus the coast’s small discount to Northport — {dollars(f.floor)} on average in this history
        (<a href={lessonHref('oil/4.4')}>Lesson 4.4</a>). Once the <K tone="orange">line is full</K>, the next barrel leaves by rail and the spread jumps to the rail
        freight: {dollars(f.ceiling)} on average in the weeks the line is full. The rule tries to sit on the floor just before the jump: it goes long when the line is at least 96% full and the spread is
        still within $3 of its lowest level of the past 12 weeks. And because the expansion’s opening date is public, it goes short in the 4 weeks before the
        opening while the spread is still wide.
      </P>
      <P>
        In the next demonstration, the shaded weeks are the trader’s positions. Set the physical drivers — how fast the basin grows, when the expansion opens and how
        big it is, how much the railroad can take — and watch what happens to the profit. The last slider sets how many weeks before the opening the rule goes
        short:
      </P>

      <Figure name="Crude Basis Trader" scenario={s1}>
        <Legend
          items={[
            { label: 'Brent − WTI (simulated)', color: SPREAD, kind: 'line' },
            { label: 'Kessler–Corran line use', color: PIPE, kind: 'line' },
            { label: 'Long the spread', color: LONG_SWATCH },
            { label: 'Short the spread', color: SHORT_SWATCH },
          ]}
        />
        <XYChart
          ariaLabel={`Brent minus WTI over five simulated years, from ${dollars(Math.min(...spreadPts.map((p) => p[1])))} to ${dollars(maxSpread)}. The trader is long the spread for ${longWeeks} weeks and short for ${shortWeeks}.`}
          height={150}
          x={[0, 5]}
          y={[0, yTop]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Brent minus WTI, $ per barrel"
          bands={positionBands(r1.positions)}
          series={[{ points: spreadPts, color: SPREAD, width: 2 }]}
          refs={openRef}
        />
        <XYChart
          ariaLabel={`Use of the Kessler–Corran line: at most ${pct(maxUse)}; the rule’s trigger is ${pct(st.use)}.`}
          height={100}
          x={[0, 5]}
          y={[useLo, 100]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={niceTicks(useLo, 100, 3)}
          yFormat={(v) => `${v}%`}
          yLabel="Line use, % of capacity"
          series={[{ points: usePts, color: PIPE, width: 2 }]}
          refs={[{ axis: 'y', at: st.use * 100, color: TEXT.orange, dash: '4 4', label: `trigger ${pct(st.use)}` }, ...openRef.map((r) => ({ ...r, label: undefined }))]}
        />
        <PnlChart pnl={r1.pnl} ariaLabel={`Cumulative profit of the basis trader: ${money(r1.stats.total)} after five years, maximum drawdown ${money(r1.stats.maxDrawdown)}.`} />
        <Readouts
          items={[
            { label: <K c="price">total P&amp;L</K>, value: money(r1.stats.total), tone: pnlTone(r1.stats.total) },
            { label: <K tone="violet">Sharpe ratio</K>, value: fmt(r1.stats.sharpe, 2), tone: RISK_TONE },
            { label: <K tone="violet">maximum drawdown</K>, value: money(r1.stats.maxDrawdown), tone: RISK_TONE },
            { label: 'trading costs', value: money(r1.costs) },
          ]}
        />
        <Slider label="Basin growth" tone="orange" value={st.growth} min={0} max={GROWTH_MAX} step={GROWTH_STEP} onChange={(v) => s1.set({ growth: v })} display={`${fmt(st.growth)} kb/d a year`} />
        <Segmented
          label="Expansion opens"
          value={st.year}
          onChange={(v) => s1.set({ year: v })}
          options={[
            { value: '1', label: 'Year 1' },
            { value: '2', label: 'Year 2' },
            { value: '3', label: 'Year 3' },
            { value: '4', label: 'Year 4' },
            { value: '5', label: 'Year 5' },
            { value: 'never', label: 'Never' },
          ]}
        />
        <Slider
          label="Expansion size"
          tone="orange"
          value={st.add}
          min={0}
          max={500}
          step={25}
          disabled={never}
          onChange={(v) => s1.set({ add: v })}
          display={never ? '—' : `${fmt(st.add)} kb/d`}
        />
        <Slider label="Rail capacity" tone="orange" value={st.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={`${fmt(st.rail)} kb/d`} />
        <Slider
          label="Rule: short before opening"
          tone="violet"
          value={st.lead}
          min={0}
          max={12}
          disabled={never}
          onChange={(v) => s1.set({ lead: v })}
          display={never ? '—' : st.lead === 0 ? 'no short' : `${st.lead} week${st.lead === 1 ? '' : 's'}`}
        />
        <Caption>
          {firstTrigger < 0
            ? `The line never gets ${pct(st.use)} full, so the rule never goes long.`
            : `The line first reaches ${pct(st.use)} full ${fmt(firstTrigger / 52, 1)} years in; the trader is long for ${longWeeks} weeks and short for ${shortWeeks}.`}
        </Caption>
      </Figure>

      <P>
        With the starting settings, the trader makes {money(f.basis.total)} over the five years, with a Sharpe ratio of {fmt(f.basis.sharpe, 2)} and a maximum
        drawdown of {money(f.basis.maxDrawdown)} (both as in <a href={lessonHref('oil/6.1')}>Lesson 6.1</a>), after {money(f.basisCosts)} of trading
        costs. Almost all of it comes from two
        episodes. Between {fmt(f.jumpFrom, 1)} and {fmt(f.jumpTo, 1)} years in, the line hovers around full, and as the basin’s output moves from week to week the
        spread flips between floor and ceiling. {f.jumps === 4 ? 'Four' : fmt(f.jumps)} times the rule was holding the spread at the floor when it jumped, earning
        between {money(f.jumpMin)} and {money(f.jumpMax)} each time; once the spread had jumped, the rule stepped aside, so it wasn’t holding when the line
        drained and the spread fell back. Then, in the weeks before the expansion opens, {yearsWord(f.openingYears)} years in, it goes short, and in the opening week
        the spread falls from {dollars(f.openingFrom)} to {dollars(f.openingTo)}: another {money(f.openingPnl)}. Through the {f.steadyWeeks} weeks of steady
        congestion in between, with the spread pinned at the rail freight, it makes {money(f.steadyPnl)}.
      </P>
      <P>
        The edge is an asymmetry made by physics. Near the floor, the spread can hardly fall, and it can jump by the whole difference between pipeline and rail.
        Change the drivers and the asymmetry changes with them.
      </P>

      <Challenge
        id="a"
        question={`With everything else at its starting value, find the fastest basin growth, to the nearest ${GROWTH_STEP} kb/d a year, at which the basis trader never trades.`}
        solved={solvedA}
        status={
          !basisAtDefaultsExceptGrowth(st)
            ? 'Set everything except the basin’s growth back to its starting value.'
            : r1.turnover > 0
              ? `At ${fmt(st.growth)} kb/d a year the line reaches ${pct(maxUse)} full and the trader trades.`
              : `At ${fmt(st.growth)} kb/d a year the trader never trades. Could the basin grow faster and still leave it idle?`
        }
        success={`Solved: ${fmt(st.growth)} kb/d a year. The basin then fills at most ${pct(maxUse)} of the line, so the spread never leaves its floor. At ${fmt(st.growth + GROWTH_STEP)} kb/d the line reaches ${nextGrowth ? pct(Math.max(...nextGrowth.h.map((w) => w.pipelineUse))) : '—'} full and the trader goes to work. No congestion, no trade: the opportunity is the pipeline running out of room.`}
      />

      <P>
        The other drivers change the size of the prize rather than its existence. With {fmt(f.railFrom)} kb/d of rail or more, the railroad never fills before the
        expansion opens, and the result is the same {money(f.basis.total)}. With less, the railroad fills too, and WTI falls toward what a stranded barrel is
        worth: with no rail at all the trader makes {money(f.noRail)}. Without the expansion, the congestion never ends; in its{' '}
        {ORDINALS[f.neverRailYear - 1] ?? fmt(f.neverRailYear)} year the basin outgrows the railroad as well, and the trader makes {money(f.never)}. More rail
        caps the jump; only more pipeline, or slower growth, removes it. This is the mechanism of <a href={lessonHref('oil/4.1')}>Lesson 4.1</a>’s pipeline limits
        and <a href={lessonHref('oil/4.4')}>Lesson 4.4</a>’s network, seen through a trading account.
      </P>

      <H2>What a backtest can’t see</H2>
      <P>
        Now some honesty about the number. In our history the spread is set each week by that week’s flows, and nobody in it looks ahead. A real market sees the same
        pipeline statistics we do. When the line is 97% full, the spread for the coming months already trades somewhere between floor and ceiling, at roughly the
        odds of the line filling, and a well-publicized opening date is priced into the forward months after it. So the short before the opening, a profit made from
        a date everyone knew, is the part of this backtest that most overstates what a trader could have earned. Set the rule’s short before the opening to zero to take
        that bet out: the trader is then still long when the line opens, {f.noShortOpening < 0 ? `loses ${money(-f.noShortOpening)}` : `makes ${money(f.noShortOpening)}`}{' '}
        that week, and makes {money(f.noShort)} in all. Who reliably earns the spread? A shipper with firm
        space on the line, who buys at Kessler, sells at the coast and pays only the tariff. Owning pipeline capacity is, economically, a long position in this
        spread.
      </P>

      <H2>Quality spreads</H2>
      <P>
        The second half of every differential is quality. A third of Coldwater Heavy is residue, and whatever the coker can’t take leaves the refinery as{' '}
        <K tone="orange">high-sulfur fuel oil</K> (<a href={lessonHref('oil/3.2')}>Lesson 3.2</a>). So Coldwater’s discount to light crude at Port Corran moves
        with fuel oil’s discount to Brent, by a little over a third of every dollar — the relation Corran’s refinery model gave in{' '}
        <a href={lessonHref('oil/4.5')}>Lesson 4.5</a>. And fuel oil’s discount tends to drift back toward its usual level: cheap fuel oil invites more of it to be
        burned and upgraded, and dear fuel oil less. In our model, {fmt(PULL_DEFAULT)}% of any gap closes each week, so half of it closes in about{' '}
        {fmt(halfLife(PULL_DEFAULT), 1)} weeks — some three months.
      </P>
      <P>
        That suggests a <K tone="violet">mean-reversion</K> rule. Compare fuel oil’s discount with its average over the previous 26 weeks. When it is more than $2
        wider, buy Coldwater and sell light crude, 1,000 barrels a leg per unit, betting that the discount narrows and Coldwater recovers; when it is more than $2
        narrower, do the reverse. In the next demonstration, the physical drivers are that pull back toward the usual discount, and a lasting widening of fuel
        oil’s discount, starting in a year you choose — the kind of change a new rule on what ships may burn can make. Start with no shift:
      </P>

      <Figure name="Crude Basis Trader · quality spread" scenario={s2}>
        <Legend
          items={[
            { label: 'Fuel oil’s discount to Brent', color: FUEL_OIL, kind: 'line' },
            { label: `Its ${qs.lookback}-week average ± ${dollars(qs.band, qs.band % 1 ? 2 : 0)}`, color: FUEL_OIL, kind: 'line', dashed: true },
            { label: 'Coldwater − light crude', color: CRUDE_COLOR.coldwater, kind: 'line' },
            { label: 'Long Coldwater', color: LONG_SWATCH },
            { label: 'Short Coldwater', color: SHORT_SWATCH },
          ]}
        />
        <XYChart
          ariaLabel={`Fuel oil’s discount to Brent over five simulated years: average ${dollars(discBefore)} before the shift point and ${dollars(discAfter)} after. The trader is long Coldwater for ${qLong} weeks and short for ${qShort}.`}
          height={150}
          x={[0, 5]}
          y={[dLo, dHi]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Fuel oil’s discount to Brent, $ per barrel"
          bands={positionBands(r2.positions)}
          series={[
            { points: envelope.up, color: FUEL_OIL, width: 1, dash: '2 3' },
            { points: envelope.dn, color: FUEL_OIL, width: 1, dash: '2 3' },
            { points: envelope.mid, color: FUEL_OIL, width: 1.5, dash: '6 4' },
            { points: discPts, color: FUEL_OIL, width: 2 },
          ]}
          refs={qs.shift > 0 ? [{ axis: 'x', at: shiftAt, color: '#555', dash: '4 4', label: 'shift begins' }] : []}
        />
        <XYChart
          ariaLabel={`Coldwater Heavy minus light crude at Port Corran, between ${dollars(Math.min(...qVals))} and ${dollars(Math.max(...qVals))}.`}
          height={100}
          x={[0, 5]}
          y={[qLo, qHi]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={niceTicks(qLo, qHi, 3)}
          yFormat={(v) => (v < 0 ? `−$${fmt(-v)}` : `$${fmt(v)}`)}
          yLabel="Coldwater Heavy − light crude at Port Corran, $ per barrel"
          series={[{ points: qualityPts, color: CRUDE_COLOR.coldwater, width: 2 }]}
        />
        <PnlChart pnl={r2.pnl} ariaLabel={`Cumulative profit of the quality trader: ${money(r2.stats.total)} after five years, maximum drawdown ${money(r2.stats.maxDrawdown)}.`} />
        <Readouts
          items={[
            { label: <K c="price">total P&amp;L</K>, value: money(r2.stats.total), tone: pnlTone(r2.stats.total) },
            { label: <K tone="violet">Sharpe ratio</K>, value: fmt(r2.stats.sharpe, 2), tone: RISK_TONE },
            { label: <K tone="violet">maximum drawdown</K>, value: money(r2.stats.maxDrawdown), tone: RISK_TONE },
            { label: 'trading costs', value: money(r2.costs) },
          ]}
        />
        <Slider
          label="Fuel oil’s pull back to normal"
          tone="gold"
          value={qs.pull}
          min={0}
          max={PULL_MAX}
          onChange={(v) => s2.set({ pull: v })}
          display={qs.pull === 0 ? 'none' : `${fmt(qs.pull)}% of the gap a week`}
        />
        <Segmented
          label="Fuel-oil shift begins"
          value={qs.year}
          onChange={(v) => s2.set({ year: v })}
          options={[
            { value: '1', label: 'After year 1' },
            { value: '2', label: 'After year 2' },
            { value: '3', label: 'After year 3' },
            { value: '4', label: 'After year 4' },
          ]}
        />
        <Slider
          label="Lasting shift in fuel oil’s discount"
          tone="gold"
          value={qs.shift}
          min={0}
          max={SHIFT_MAX}
          onChange={(v) => s2.set({ shift: v })}
          display={qs.shift === 0 ? 'none' : `${dollars(qs.shift, 0)} wider`}
        />
        <Caption>
          {qs.pull === 0 ? 'Nothing pulls fuel oil’s discount back: it wanders wherever its weekly shocks take it.' : `Half of any gap in fuel oil’s discount closes in ${fmt(halfLife(qs.pull), 1)} weeks.`}{' '}
          {qs.shift === 0
            ? `The discount averages ${dollars(avg(discVals))} over the five years.`
            : `The discount averages ${dollars(discBefore)} before the shift and ${dollars(discAfter)} after; in the year after it begins the trader ${yearAfter >= 0 ? 'makes' : 'loses'} ${money(Math.abs(yearAfter))}.`}
        </Caption>
      </Figure>

      <P>
        With no shift, the quality trader makes {money(f.quality.total)} over the five years, with a Sharpe ratio of {fmt(f.quality.sharpe, 2)} and a maximum
        drawdown of {money(f.quality.maxDrawdown)}. It trades often, buying or selling {fmt(f.qualityTurnover)} units over the five years, so costs take{' '}
        {money(f.qualityCosts)} of the {money(f.quality.total + f.qualityCosts)} it made before them. Like the basis trade, it rests on a physical
        mechanism: refiners and fuel-oil users responding to price, which keeps pulling the discount back. Switch the mechanism off by setting the pull to zero. A
        wide discount is now no more likely to narrow than to widen further, the rule’s bets on its return are coin flips, and the trader makes only{' '}
        {money(f.noPull.total)}, with a Sharpe ratio of {fmt(f.noPull.sharpe, 2)}, after {money(f.noPullCosts)} of costs.
      </P>
      <P>
        Physical facts can change for good. <a href={lessonHref('oil/4.5')}>Lesson 4.5</a> recalled one: on January 1, 2020, the International Maritime
        Organization’s global limit on <K tone="orange">sulfur</K> in ships’ fuel fell from 3.5% to 0.5%, and in the months around that date high-sulfur fuel oil
        fell sharply against crude. Set a $10
        shift after year 2, with the pull back at {fmt(PULL_DEFAULT)}%. The rule sees fuel oil cheapening beyond its average, buys Coldwater, and stays long while
        the discount walks to its new level; in the
        year after the shift begins it loses {money(-f.q10YearAfter)}, and its five-year total falls to {money(f.q10.total)}. A mean-reversion rule can’t
        tell a lasting change from noise until its own average catches up, and by then it has paid for the lesson.
      </P>

      <Challenge
        id="b"
        question={`With fuel oil’s pull at its starting ${fmt(PULL_DEFAULT)}% a week and the shift beginning after year 2, find the smallest lasting widening of fuel oil’s discount, to the nearest dollar, that leaves the quality trader with a loss over the five years.`}
        solved={solvedB}
        status={
          qs.year !== '2' || !qualityRuleAtDefaults(qs)
            ? `Start the shift after year 2 and set fuel oil’s pull back to ${fmt(PULL_DEFAULT)}% a week.`
            : `With a ${dollars(qs.shift, 0)} shift the quality trader ${r2.stats.total >= 0 ? 'makes' : 'loses'} ${money(Math.abs(r2.stats.total))} over the five years.`
        }
        success={`Solved: ${dollars(qs.shift, 0)}. The trader loses ${money(-r2.stats.total)}; with ${dollars(qs.shift - 1, 0)} it would have made ${money(prevShift)}. In the year after the shift begins it loses ${money(-yearAfter)}, buying Coldwater as fuel oil cheapened and waiting for a return to normal that never came.`}
      />

      <P>
        Both spreads are prices of physical facts. The basis is the price of pipeline room, and the quality spread is the price of what a refinery can do with a
        heavy barrel’s residue. A strategy built on either works while those facts behave as they have, and stops when one changes: a pipeline opens, a regulation
        takes effect. Return to <FigRef to="Crude Basis Trader">the first demonstration</FigRef> and choose <b>Never</b> for the expansion, or cut the rail, and you
        can watch the basis trade’s profit follow the plumbing.
      </P>
      <P>
        These are spreads between crudes. A refinery lives on a different spread: between the crude it buys and the gasoline and diesel it sells. The{' '}
        <a href={lessonHref('oil/6.3')}>next lesson</a> trades that one, the crack spread, and asks what physical facts move it.
      </P>
    </LessonPage>
  );
}
