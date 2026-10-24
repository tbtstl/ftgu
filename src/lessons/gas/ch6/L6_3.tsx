import { useDeferredValue, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  fmt,
  lessonHref,
  tint,
  useScenario,
} from '../../../framework';
import { curveAt, monthAverage } from '../../../engines/gas/futures';
import {
  basisUnder,
  defaultCosts,
  hypothesizedConditions,
  metroBasisTrades,
  ridgebackSignals,
  ridgebackTakeaway,
  runBook,
  transportAsset,
  weatherSignals,
  type BookResult,
  type RidgebackHypothesis,
  type Trade,
} from '../../../engines/gas/strategies';
import { conditionsOf, EXPRESS_EXPANSION, gasHistory } from '../../../model/gas/history';
import { GAS_MONTH_NAMES, GAS_MONTH_START } from '../../../model/gas/weather';
import { PIPELINE } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { basis, bcfd, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The Ridgeback desk: a hypothesis about production and pipes, against the market's basis.

const EXPRESS = PIPELINE['ridgeback-calder'];
const NORTHLINE = PIPELINE['calder-metro'];
/** The desk trades this much gas a day in every swap, MMBtu/d. */
export const DESK_VOLUME = 10_000;
export const GROWTH_STEP = 0.02;
export const GROWTH_MAX = 0.3;
export const BASIS_DESK_DEFAULTS = { growth: 0, expansion: false, lead: 6, threshold: 0.25 };
export type BasisDeskState = typeof BASIS_DESK_DEFAULTS;

export interface DeskSignal {
  /** Delivery month, and the month the desk decides on (its first day). */
  delivery: number;
  decided: number;
  /** The market's forward for the delivery month on the decision day, the desk's view, and the month's realized basis, $/MMBtu. */
  forward: number;
  view: number;
  realized: number;
  /** +1 bought basis, −1 sold, 0 stood aside. */
  side: number;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * The desk's view of every delivery month, `lead` months ahead: the market's forward, moved by
 * whatever the hypothesis changes in a normal year's plan — Ridgeback's basis in the region the
 * hypothesis expects for the delivery year, less its basis in the region as it stands on the
 * decision day — but never above the cost of the trip to Calder. With the market's own hypothesis
 * (no growth, no expansion) the view is the forward.
 */
export function basisDeskSignals(h: RidgebackHypothesis, lead: number, threshold: number): DeskSignal[] {
  return ridgebackSignals(h, lead, threshold);
}

export interface DeskRun {
  signals: DeskSignal[];
  book: BookResult;
  /** Profit after fees on each traded delivery month. */
  pnl: Map<number, number>;
}

const deskCache = new Map<string, DeskRun>();

/** The desk's trades and their results under a state (cached). */
export function basisDeskRun(s: BasisDeskState): DeskRun {
  const key = `${round2(s.growth)}|${s.expansion}|${s.lead}|${round2(s.threshold)}`;
  let r = deskCache.get(key);
  if (!r) {
    const signals = basisDeskSignals({ growth: round2(s.growth), expansion: s.expansion }, s.lead, round2(s.threshold));
    const trades: Trade[] = signals
      .filter((x) => x.side !== 0)
      .map((x) => ({ entry: x.decided, legs: [{ kind: 'basis', place: 'ridgeback', delivery: x.delivery, mmbtuPerDay: x.side * DESK_VOLUME }] }));
    const book = runBook(trades);
    const pnl = new Map<number, number>();
    for (const o of book.trades) pnl.set(o.trade.legs[0].delivery, o.pnl);
    r = { signals, book, pnl };
    deskCache.set(key, r);
  }
  return r;
}

/** Whether a growth hypothesis changes the desk's view of any Year 5 month as seen from Year 4. */
export function viewsYearFiveGlut(growth: number): boolean {
  const known = EXPRESS_EXPANSION.year - 2;
  const asIs = basisUnder(conditionsOf(known));
  const hyp = basisUnder(hypothesizedConditions({ growth: round2(growth), expansion: false }, known, known + 1));
  return hyp.some((b, m) => b < asIs[m] - 0.01);
}

/** The least growth per year, on the slider's steps, at which the desk expects Year 5's glut a year ahead. */
export function leastGlutGrowth(): number {
  for (let k = 0; k * GROWTH_STEP <= GROWTH_MAX + 1e-9; k++) if (viewsYearFiveGlut(k * GROWTH_STEP)) return round2(k * GROWTH_STEP);
  return NaN;
}

/** The first challenge: the growth slider at the least growth that foresees Year 5's glut. */
export function basisDeskSolved(s: BasisDeskState): boolean {
  return Math.abs(round2(s.growth) - leastGlutGrowth()) < 1e-9;
}

// ---------------------------------------------------------------------------
// The Metro desk: selling winter basis, with or without a look at the forecast.

export type MetroMode = 'every' | 'forecast';
export const METRO_DESK_DEFAULTS = { mode: 'every' as MetroMode, skill: 0.8, colder: 0 };
export type MetroDeskState = typeof METRO_DESK_DEFAULTS;
export const WINTER_MONTHS = [8, 9, 10];
export const SKILL_STEP = 0.1;

const metroCache = new Map<string, { book: BookResult; pnl: Map<number, number> }>();

/** Selling 10,000 MMBtu/d of Metro's basis for each winter month on its first day (cached). */
export function metroDeskRun(s: MetroDeskState): { book: BookResult; pnl: Map<number, number> } {
  const skill = Math.round(s.skill * 10) / 10;
  const key = s.mode === 'every' ? 'every' : `${skill}|${s.colder}`;
  let r = metroCache.get(key);
  if (!r) {
    const book = runBook(
      metroBasisTrades({ lead: 0, months: WINTER_MONTHS, mmbtuPerDay: -DESK_VOLUME, forecast: s.mode === 'forecast' ? { skill, skipColderF: s.colder } : undefined }),
    );
    const pnl = new Map<number, number>();
    for (const o of book.trades) pnl.set(o.trade.legs[0].delivery, o.pnl);
    r = { book, pnl };
    metroCache.set(key, r);
  }
  return r;
}

/** The second challenge: standing aside on any cold forecast, the least skill at which the eight winters make money. */
export function metroForecastSolved(s: MetroDeskState): boolean {
  if (s.mode !== 'forecast' || s.colder !== 0) return false;
  const skill = Math.round(s.skill * 10) / 10;
  if (metroDeskRun(s).book.total <= 0) return false;
  return skill < SKILL_STEP / 2 || metroDeskRun({ ...s, skill: skill - SKILL_STEP }).book.total <= 0;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose (computed once, when the lesson first renders).

/** "January of Year 5". */
function monthName(abs: number): string {
  return `${GAS_MONTH_NAMES[abs % 12]} of Year ${Math.floor(abs / 12) + 1}`;
}

/** Money rounded for prose: "$312,000", "$1.84 million". */
function cash(x: number): string {
  return Math.abs(x) >= 1e6 ? money(x) : money(Math.round(x / 1000) * 1000);
}

/** Every number the prose quotes, computed from the history (call lazily: it needs the whole history). */
export function basisDeskNumbers() {
  gasHistory();
  const y5 = EXPRESS_EXPANSION.year - 1;
  const janY5 = y5 * 12 + 9;
  const janY6 = janY5 + 12;
  const least = leastGlutGrowth();
  const atLeast = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: least });
  const withExp = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: least, expansion: true });
  const expOnly = withExp.signals.filter((s) => s.side > 0);
  const lead1 = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: least, expansion: true, lead: 1 });
  const lead11 = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: least, expansion: true, lead: 11 });
  const eager = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: GROWTH_MAX });
  const eagerEarly = eager.signals.filter((s) => s.side < 0 && Math.floor(s.delivery / 12) < y5);
  const eagerEarlyPnl = eagerEarly.reduce((a, s) => a + (eager.pnl.get(s.delivery) ?? 0), 0);
  const yearAvg = (y: number) => Array.from({ length: 12 }, (_, k) => monthAverage(y * 12 + k, 'ridgeback', 'calder')).reduce((a, b) => a + b, 0) / 12;
  const every = metroDeskRun(METRO_DESK_DEFAULTS);
  const everyGross = every.book.total + every.book.totalFees;
  const winterPnl = (r: { pnl: Map<number, number> }, y: number) => WINTER_MONTHS.reduce((a, c) => a + (r.pnl.get(y * 12 + c) ?? 0), 0);
  const filtered = metroDeskRun({ mode: 'forecast', skill: 0.8, colder: 0 });
  const signals = weatherSignals(0.8);
  const jan3 = 2 * 12 + 9;
  const feb8 = 7 * 12 + 10;
  const express = transportAsset('express', DESK_VOLUME);
  return {
    takeaway: ridgebackTakeaway(conditionsOf(0)),
    takeawayAfter: ridgebackTakeaway(conditionsOf(y5 + 1)),
    prod: (y: number) => conditionsOf(y).ridgeback,
    growth: conditionsOf(1).ridgeback - conditionsOf(0).ridgeback,
    y5,
    fwdJanY5: curveAt(janY5 - 10).ridgebackBasis[janY5],
    realJanY5: monthAverage(janY5, 'ridgeback', 'calder'),
    fwdJanY6: curveAt(janY6 - 10).ridgebackBasis[janY6],
    realJanY6: monthAverage(janY6, 'ridgeback', 'calder'),
    y5Avg: yearAvg(y5),
    least,
    atLeastTotal: atLeast.book.total,
    atLeastTrades: atLeast.book.trades.length,
    atLeastFirst: atLeast.signals.find((s) => s.side < 0),
    atLeastLast: [...atLeast.signals].reverse().find((s) => s.side < 0),
    withExpTotal: withExp.book.total,
    withExpTrades: withExp.book.trades.length,
    expOnlyPnl: expOnly.reduce((a, s) => a + (withExp.pnl.get(s.delivery) ?? 0), 0),
    expBuyLow: Math.min(...expOnly.map((s) => s.forward)),
    expBuyHigh: Math.max(...expOnly.map((s) => s.forward)),
    lead1Total: lead1.book.total,
    lead11Total: lead11.book.total,
    eagerEarlyCount: eagerEarly.length,
    eagerEarlyPnl,
    feePerMonth: defaultCosts().basisFee * DESK_VOLUME * 31,
    metroFwd: WINTER_MONTHS.map((c) => curveAt(c).metroBasis[c]),
    calmWinter: winterPnl(every, 0),
    jan3Pnl: every.pnl.get(jan3) ?? 0,
    jan3Real: monthAverage(jan3, 'metro', 'calder'),
    winter3: winterPnl(every, 2),
    everyTotal: every.book.total,
    everyGross,
    filteredTotal: filtered.book.total,
    filteredTrades: filtered.book.trades.length,
    jan3Forecast: signals[jan3].forecastColder,
    feb8Forecast: signals[feb8].forecastColder,
    feb8Real: monthAverage(feb8, 'metro', 'calder'),
    feb8Pnl: filtered.pnl.get(feb8) ?? 0,
    expressY5: express[y5].realized,
    expressY5Forward: express[y5].forward,
    expressOther: Math.max(...express.filter((_, y) => y !== y5).map((a) => a.realized)),
  };
}

// ---------------------------------------------------------------------------
// Chart helpers.

const N_MONTHS = 96;
const MONTHS = Array.from({ length: N_MONTHS + 1 }, (_, i) => i);
const YEAR_TICKS = Array.from({ length: 8 }, (_, y) => y * 12 + 6);
const YEAR_LINES = Array.from({ length: 7 }, (_, y) => ({ at: (y + 1) * 12, color: '#d9d9d5', dash: '2 3', width: 1 }));
const REALIZED = '#333333';
const FORWARD = GRAPHIC.green;
const VIEW = GRAPHIC.violet;
const SOLD = tint(GRAPHIC.red, 0.22);
const BOUGHT = tint(GRAPHIC.green, 0.3);
const signedBasis = (v: number) => (v > 0 ? `+$${fmt(v)}` : v < 0 ? `−$${fmt(-v)}` : '$0');
const kTick = (v: number) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`);

export default function Lesson() {
  const n = useMemo(basisDeskNumbers, []);

  // ---- Figure 1: the Ridgeback desk.
  const s = useScenario('basis-desk', BASIS_DESK_DEFAULTS);
  const st = s.state;
  const deferred = useDeferredValue(st);
  const run = useMemo(() => basisDeskRun(deferred), [deferred]);
  const [cursor, setCursor] = useState(57);
  const cm = Math.max(0, Math.min(N_MONTHS - 1, Math.floor(cursor)));
  const sig = run.signals.find((x) => x.delivery === cm);
  const realized = useMemo(() => {
    const r = Array.from({ length: N_MONTHS }, (_, D) => monthAverage(D, 'ridgeback', 'calder'));
    return [...r, r[N_MONTHS - 1]];
  }, []);
  const quoted = run.signals.map((x) => x.delivery);
  const ends = <T,>(a: T[]) => (a.length ? [...a, a[a.length - 1]] : a);
  const prodActual = MONTHS.map((D) => conditionsOf(Math.min(7, Math.floor(D / 12))).ridgeback);
  const takeaway = MONTHS.map((D) => ridgebackTakeaway(conditionsOf(Math.min(7, Math.floor(D / 12)))));
  const g = round2(st.growth);
  const prodView = run.signals.map((x) => {
    const known = Math.floor(x.decided / 12);
    return conditionsOf(known).ridgeback + g * (Math.floor(x.delivery / 12) - known);
  });
  const traded = run.book.trades.length;
  const wins = run.book.trades.filter((o) => o.pnl > 0).length;
  const best = Math.max(0, ...run.book.trades.map((o) => o.pnl));
  const solvedA = basisDeskSolved(st);
  const glut = viewsYearFiveGlut(g);
  const statusA = glut
    ? `At ${bcfd(g)} a year your view already sees Year 5’s glut. Would less growth do?`
    : `At ${bcfd(g)} a year, Year 4’s ${bcfd(n.prod(n.y5 - 1))} grows to ${bcfd(n.prod(n.y5 - 1) + g)} in your Year 5 — still inside the ${bcfd(n.takeaway)} takeaway.`;

  // ---- Figure 2: the Metro desk.
  const m = useScenario('metro-desk', METRO_DESK_DEFAULTS);
  const md = useDeferredValue(m.state);
  const mrun = useMemo(() => metroDeskRun(md), [md]);
  const coldest = useMemo(
    () => gasHistory().map((y) => Math.min(...y.days.slice(GAS_MONTH_START[8], GAS_MONTH_START[11]).map((d) => d.tempF))),
    [],
  );
  const monthsTraded = mrun.book.trades.length;
  const monthsWon = mrun.book.trades.filter((o) => o.pnl > 0).length;
  const worst = Math.min(0, ...mrun.book.trades.map((o) => o.pnl));
  const worstTrade = mrun.book.trades.reduce<(typeof mrun.book.trades)[number] | null>((w, o) => (o.pnl < 0 && (!w || o.pnl < w.pnl) ? o : w), null);
  const solvedB = metroForecastSolved(m.state);
  const mSkill = Math.round(m.state.skill * 10) / 10;
  const statusB =
    m.state.mode !== 'forecast'
      ? 'Choose “Skip cold forecasts” first.'
      : m.state.colder !== 0
        ? 'Stand aside on any forecast colder than normal: set the threshold to 0 °F.'
        : mrun.book.total <= 0
          ? `With skill ${fmt(mSkill, 1)} the eight winters lose ${cash(-mrun.book.total)}.`
          : `With skill ${fmt(mSkill, 1)} the eight winters make ${cash(mrun.book.total)}. Would less skill do?`;

  const Y_LO = -800_000;
  const Y_HI = 300_000;

  return (
    <LessonPage id="gas/6.3">
      <P>
        <a href={lessonHref('gas/6.2')}>The previous lesson</a> traded the difference between two months. This one trades the difference between two places, the{' '}
        <K c="price">basis</K>. <a href={lessonHref('gas/5.1')}>Lesson 5.1</a> found that a basis wider than the cost of the trip is always a rent on a full pipe, and
        that a basis trade is therefore a bet on pipes and weather: on whether a constraint will bind, how often and how hard. The region has one of each kind. Gas can
        fail to get out of Ridgeback when the basin produces more than its pipes carry, and it can fail to get into Metro on the coldest days. We’ll trade both, and ask
        the chapter’s question of each: does knowing why the basis moves let us beat the market’s price for it?
      </P>
      <P>
        The instrument is a <K c="price">basis swap</K>. Two traders agree today on a basis for a future month — say −$0.12 for Ridgeback in July of some year — and
        when the month is over, the buyer receives the month’s average daily basis less the agreed number, times the volume, and the seller receives the opposite. At{' '}
        {fmt(DESK_VOLUME)} MMBtu a day, a 31-day month is {fmt(DESK_VOLUME * 31)} MMBtu, so every cent of difference is worth {money(DESK_VOLUME * 31 * 0.01)}. Buying
        basis pays when the place ends up dearer against Calder than agreed; selling pays when it ends up cheaper. Real basis swaps settle against published price
        indexes; ours settle against the simulated daily prices of the region’s history.
      </P>
      <P>
        The market quotes its basis forwards from the same monthly plans as the futures of Lesson 6.2: the plan drawn on the first of the month from the gas in storage
        and the region as it stands. For Metro it adds the premium it has learned from the eight winters; for Ridgeback it adds nothing. And the region doesn’t stand
        still. Ridgeback’s production grew by {bcfd(n.growth)} every year, from {bcfd(n.prod(0))} in Year 1 to {bcfd(n.prod(n.y5 - 1))} in Year 4 and{' '}
        {bcfd(n.prod(n.y5))} in Year 5 — past the {bcfd(n.takeaway)} that Ridgeback Express, the Coastal Line and the field’s own use can take. On March 1 of Year 4 (each year of the history is a gas year, April to March) the
        market quoted Ridgeback’s basis for January of Year 5 at {basis(n.fwdJanY5)}; that January averaged {basis(n.realJanY5)}, and the whole of Year 5{' '}
        {basis(n.y5Avg)}. A year later, with the glut in full view, it quoted January of Year 6 at {basis(n.fwdJanY6)} — but Ridgeback Express had been expanded by{' '}
        {bcfd(EXPRESS_EXPANSION.addBcfd, 1)}, a project announced years before, and January averaged {basis(n.realJanY6)}. Our market is naive on purpose: it prices
        next year as if nothing will change. Real markets look ahead, and an edge there lies in judging the drilling and the pipes better than others do; here we can
        see what a correct judgment is worth.
      </P>
      <P>
        In the next demonstration you run a basis desk with a hypothesis: how fast Ridgeback’s <K tone="orange">production</K> grows each year, and whether the
        announced expansion opens on time. For every month, a chosen number of months before delivery, the desk redraws a normal year’s plan
        (<a href={lessonHref('gas/4.4')}>Lesson 4.4</a>) with the region your hypothesis expects instead of the region as it stands, moves the market’s forward by the
        difference, and trades {fmt(DESK_VOLUME)} MMBtu a day if its view is
        further from the forward than the threshold. The upper chart shows each month’s realized basis, the forward the desk traded against, and its view, with sold
        months shaded red and bought ones green; the lower chart is the physical driver, production against the basin’s takeaway. Start from the market’s own
        hypothesis — no growth, no expansion — and change it:
      </P>

      <Figure name="Basis Trading Desk" scenario={s}>
        <XYChart
          xDomain={[0, N_MONTHS]}
          yDomain={[-5.5, 1]}
          yTicks={[-5, -4, -3, -2, -1, 0, 1]}
          xTicks={YEAR_TICKS}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={signedBasis}
          yLabel="Ridgeback − Calder, $/MMBtu, month by month"
          height={230}
          bands={run.signals.filter((x) => x.side !== 0).map((x) => ({ from: x.delivery, to: x.delivery + 1, color: x.side < 0 ? SOLD : BOUGHT }))}
          vLines={YEAR_LINES}
          series={[
            { xs: MONTHS, ys: realized, color: REALIZED, kind: 'step', width: 2 },
            { xs: ends(quoted), ys: ends(run.signals.map((x) => x.forward)), color: FORWARD, kind: 'step', width: 2, dash: '5 3' },
            { xs: ends(quoted), ys: ends(run.signals.map((x) => x.view)), color: VIEW, kind: 'step', width: 2 },
          ]}
          cursor={cm + 0.5}
          onScrub={(x) => setCursor(x)}
          scrubLabel="Delivery month"
          ariaLabel={`Ridgeback’s basis month by month over eight years: realized, the market’s forward ${st.lead} months ahead and your view with growth of ${fmt(g, 2)} Bcf/d a year${st.expansion ? ' and the expansion counted' : ''}. The desk makes ${traded} trades and ${money(run.book.total)} after fees.`}
        />
        <XYChart
          xDomain={[0, N_MONTHS]}
          yDomain={[2.5, 3.7]}
          yTicks={[2.6, 2.8, 3, 3.2, 3.4, 3.6]}
          xTicks={YEAR_TICKS}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Ridgeback, Bcf/d"
          height={150}
          vLines={YEAR_LINES}
          series={[
            { xs: MONTHS, ys: takeaway, color: '#333', kind: 'step', width: 2, dash: '6 4', label: 'takeaway', labelColor: TEXT.ink },
            { xs: ends(quoted), ys: ends(prodView), color: GRAPHIC.orange, kind: 'step', width: 1.6, dash: '3 3' },
            { xs: MONTHS, ys: prodActual, color: GRAPHIC.orange, kind: 'step', width: 2.5, label: 'production', labelColor: TEXT.orange },
          ]}
          cursor={cm + 0.5}
          ariaLabel={`Ridgeback’s production rising from ${bcfd(n.prod(0))} to ${bcfd(n.prod(7))} against takeaway of ${bcfd(n.takeaway)}, ${bcfd(n.takeawayAfter)} after the expansion; dashed, the production your hypothesis expected when the desk traded.`}
        />
        <Legend
          items={[
            { label: 'realized', color: REALIZED, kind: 'line' },
            { label: 'market’s forward', color: FORWARD, kind: 'line' },
            { label: 'your view', color: VIEW, kind: 'line' },
            { label: 'sold basis', color: SOLD },
            { label: 'bought basis', color: BOUGHT },
            { label: 'production you expected', color: GRAPHIC.orange, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'desk’s profit after fees', value: money(run.book.total), tone: 'green' },
            { label: 'months traded', value: fmt(traded) },
            { label: 'that made money', value: fmt(wins) },
            { label: 'best month', value: money(best), tone: 'green' },
          ]}
        />
        <Slider label="Production growth you expect" tone="orange" value={st.growth} min={0} max={GROWTH_MAX} step={GROWTH_STEP} onChange={(v) => s.set({ growth: round2(v) })} display={`${bcfd(g)} a year`} />
        <Slider label="Months ahead the desk trades" value={st.lead} min={1} max={11} step={1} onChange={(v) => s.set({ lead: Math.round(v) })} display={`${st.lead}`} />
        <Slider label="Threshold to trade" tone="green" value={st.threshold} min={0.05} max={1} step={0.05} onChange={(v) => s.set({ threshold: round2(v) })} display={`${basis(st.threshold).replace('+', '')}/MMBtu`} />
        <Checkbox label={`Count on Ridgeback Express’s ${bcfd(EXPRESS_EXPANSION.addBcfd, 1)} expansion opening in Year ${EXPRESS_EXPANSION.year + 1}`} checked={st.expansion} onChange={(v) => s.set({ expansion: v })} />
        <Caption>
          {sig ? (
            <>
              {monthName(cm)}, traded on the first of {monthName(sig.decided)}: forward {basis(sig.forward)}, your view {basis(sig.view)}, realized {basis(sig.realized)}.{' '}
              {sig.side === 0 ? 'The desk stood aside.' : `The desk ${sig.side < 0 ? 'sold' : 'bought'} and made ${money(run.pnl.get(cm) ?? 0)}.`}
            </>
          ) : (
            <>
              {monthName(cm)}: realized {basis(realized[cm])}; the desk trades only months at least {st.lead} months into the history.
            </>
          )}
        </Caption>
      </Figure>

      <P>
        With the market’s hypothesis, your view and the forward are the same line and the desk never trades. Raise the growth and, for a while, still nothing happens:
        Year 4’s {bcfd(n.prod(n.y5 - 1))} plus a little more still fits inside {bcfd(n.takeaway)}, and a basin whose gas fits out trades at the cost of the trip,{' '}
        {basis(-EXPRESS.variableCost)}, however fast it grows. At {bcfd(n.least)} a year your Year 5 no longer fits, the view drops below the forward, and the desk sells
        Year 5’s basis before Year 5 begins. Trading {word(BASIS_DESK_DEFAULTS.lead)} months ahead, as it starts, that is the {word(n.atLeastTrades)} months from{' '}
        {n.atLeastFirst ? monthName(n.atLeastFirst.delivery) : ''} to {n.atLeastLast ? monthName(n.atLeastLast.delivery) : ''}, for {money(n.atLeastTotal)}; the
        months after those it decides in Year 5 itself, when the market sees the glut as well as you do. Raise the growth further and nothing more changes. What the
        desk needs is not the rate but the answer to a yes-or-no question about a cut (<a href={lessonHref('gas/3.2')}>Lesson 3.2</a>): does production outrun the
        pipes?
      </P>

      <Challenge
        id="a"
        figure="Basis Trading Desk"
        question="What’s the least yearly growth, on the slider’s steps, at which your view sees Year 5’s glut from Year 4?"
        solved={solvedA}
        status={statusA}
        success={`Solved: ${bcfd(g)} a year. Year 4 produces ${bcfd(n.prod(n.y5 - 1))} against a takeaway of ${bcfd(n.takeaway)}, so anything less than ${bcfd(n.takeaway - n.prod(n.y5 - 1))} of growth leaves the basin inside its pipes and its basis at the cost of the trip. The physics turns a forecast of a rate into a forecast of a threshold.`}
      />

      <H2>A bet with a ceiling</H2>
      <P>
        Look at what the desk sold. Ridgeback produces far more gas than it burns, so its gas has to leave, and no one ships gas to Calder unless Calder pays at least
        Ridgeback’s price plus the {gp2(EXPRESS.variableCost)} trip. Ridgeback’s price can be Calder’s less the trip, or lower when the pipes are full, but never
        higher. The forward sat at that ceiling, {basis(-EXPRESS.variableCost)}, so a seller there could lose almost nothing: the basis could only stay put or fall.
        Set the growth to {bcfd(GROWTH_MAX)} and the desk also sells {word(n.eagerEarlyCount)} months of a year that never had a glut; it loses{' '}
        {money(-n.eagerEarlyPnl)} on them, the fees of about {money(n.feePerMonth)} a month. A wrong hypothesis cost pennies and a right one paid dollars, because
        the physics put a ceiling on one side of the bet.
      </P>
      <P>
        Now count on the expansion. The desk also buys Year 6’s basis, at forwards between {basis(n.expBuyLow)} and {basis(n.expBuyHigh)}, from a market that assumes
        the glut goes on, and makes {money(n.expOnlyPnl)} more, {money(n.withExpTotal)} in all from {word(n.withExpTrades)} months. That bet has no such protection. Had the
        new pipe opened late — pipelines are delayed by permits, lawsuits and construction often enough — Year 6 would have stranded more gas than Year 5 did, and the
        basis could have sunk toward the producers’ cost, as Year 5’s winter months did. The months-ahead slider measures how early the desk acts: one month ahead it
        makes {cash(n.lead1Total)}, eleven months ahead {money(n.lead11Total)}, because the market catches up all at once, on the April 1 when the new year’s region
        arrives.
      </P>

      <H2>Into a market</H2>
      <P>
        Metro is the other kind of basis. Most winter days Northline has room and Metro trades at Calder plus the {gp2(NORTHLINE.variableCost)} trip; on the coldest
        days Northline and Hollow Creek both run out and Metro breaks away (<a href={lessonHref('gas/4.2')}>Lesson 4.2</a>). The market knows this. On the first of
        each winter month it quotes Metro’s basis at {basis(n.metroFwd[0])} for December, {basis(n.metroFwd[1])} for January and {basis(n.metroFwd[2])} for February —
        the trip plus a premium for the chance of a breakaway, fitted so that over the eight winters buyers and sellers came out even. Selling that basis is selling
        insurance against a full Northline: the same risk that the holders of firm capacity are paid to carry in{' '}
        <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>. In the next demonstration the desk sells {fmt(DESK_VOLUME)} MMBtu a day of Metro’s basis for each December,
        January and February on the month’s first day; each bar is one month’s result after fees, and over each winter is its coldest day. Then let it look at the
        two-week forecast of <a href={lessonHref('gas/6.1')}>Lesson 6.1</a> and stand aside when the forecast is cold:
      </P>

      <Figure name="Basis Trading Desk · Metro" scenario={m}>
        <Segmented
          label="Desk’s rule"
          value={m.state.mode}
          onChange={(v) => m.set({ mode: v })}
          options={[
            { value: 'every', label: 'Sell every winter month' },
            { value: 'forecast', label: 'Skip cold forecasts' },
          ]}
        />
        <XYChart
          xDomain={[0, 8]}
          yDomain={[Y_LO, Y_HI]}
          yTicks={[-750_000, -500_000, -250_000, 0, 250_000]}
          xTicks={[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]}
          xFormat={(v) => `Year ${Math.floor(v) + 1}`}
          yFormat={kTick}
          yLabel="Profit on each month’s swap, after fees (Dec, Jan, Feb)"
          height={240}
          series={[]}
          ariaLabel={`Selling Metro’s winter basis ${m.state.mode === 'every' ? 'every winter month' : `except when a skill-${fmt(mSkill, 1)} forecast is more than ${m.state.colder} °F colder than normal`}: ${monthsTraded} months traded, ${monthsWon} made money, ${money(mrun.book.total)} in all after fees; the worst month lost ${money(-worst)}.`}
        >
          {(x, y) => (
            <g>
              {Array.from({ length: 8 }, (_, yr) => (
                <g key={yr}>
                  <text className="ax ax-m" x={x(yr + 0.5)} y={y(Y_HI) + 12}>
                    {`${fmt(coldest[yr])} °F`}
                  </text>
                  {WINTER_MONTHS.map((c, k) => {
                    const D = yr * 12 + c;
                    const p = mrun.pnl.get(D);
                    const x0 = x(yr + 0.16 + k * 0.24);
                    const w = x(yr + 0.36 + k * 0.24) - x0;
                    if (p === undefined) return <line key={c} x1={x0} x2={x0 + w} y1={y(0)} y2={y(0)} stroke="#9a9a9a" strokeWidth={3} />;
                    const top = y(Math.max(0, Math.max(Y_LO, p)));
                    const bottom = y(Math.min(0, Math.max(Y_LO, p)));
                    return <rect key={c} x={x0} y={top} width={w} height={Math.max(1, bottom - top)} fill={p >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
                  })}
                </g>
              ))}
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'made money', color: GRAPHIC.green },
            { label: 'lost money', color: GRAPHIC.red },
            { label: 'stood aside', color: '#9a9a9a', kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'eight winters, after fees', value: money(mrun.book.total), tone: 'green' },
            { label: 'months traded', value: fmt(monthsTraded) },
            { label: 'that made money', value: fmt(monthsWon) },
            { label: 'worst month', value: money(worst), tone: 'green' },
          ]}
        />
        <Slider
          label="Forecast skill"
          tone="teal"
          value={m.state.skill}
          min={0}
          max={1}
          step={SKILL_STEP}
          onChange={(v) => m.set({ skill: Math.round(v * 10) / 10 })}
          display={fmt(mSkill, 1)}
          disabled={m.state.mode !== 'forecast'}
        />
        <Slider
          label="Stand aside if forecast colder by more than"
          tone="teal"
          value={m.state.colder}
          min={0}
          max={4}
          step={1}
          onChange={(v) => m.set({ colder: Math.round(v) })}
          display={`${m.state.colder} °F`}
          disabled={m.state.mode !== 'forecast'}
        />
        <Caption>
          {worstTrade
            ? `The desk sells ${monthsTraded} of the 24 winter months; the worst, ${monthName(worstTrade.trade.legs[0].delivery)}, loses ${money(-worstTrade.pnl)}. `
            : `The desk sells ${monthsTraded} of the 24 winter months and none of them loses. `}
          Over each winter’s bars is its coldest day at Metro: the breakaways come in the winters with the coldest days.
        </Caption>
      </Figure>

      <P>
        Selling every month, the calm winters pay about {cash(n.calmWinter)} each. Then Year 3’s January averages {basis(n.jan3Real)} and costs {cash(-n.jan3Pnl)} on
        its own, and that winter loses {cash(-n.winter3)}. Over the eight winters the premiums pay for the breakaways exactly: {cash(n.everyGross)} before fees and{' '}
        {cash(n.everyTotal)} after. Knowing why Metro’s basis jumps doesn’t help when the market knows it too: the seller collects small sums for years and gives them
        back in a week.
      </P>
      <P>
        The forecast is different, because the simulated market ignores it: it draws its curve as if the weather from today on will be normal. Real markets watch the
        forecasts closely, so there the edge is a forecast better than everyone else’s — which is what the skill slider measures. With skill 0.8 and the desk standing
        aside whenever the forecast is any colder than normal, it trades {word(n.filteredTrades)} months and makes {cash(n.filteredTotal)}. It skips Year 3’s January, whose
        forecast ran {fmt(n.jan3Forecast, 1)} °F colder than normal. It can’t skip what the forecast doesn’t see: Year 8’s February began with a forecast{' '}
        {fmt(Math.abs(n.feb8Forecast), 1)} °F {n.feb8Forecast < 0 ? 'warmer' : 'colder'} than normal, averaged {basis(n.feb8Real)}, and cost {cash(-n.feb8Pnl)}. Two weeks
        of skill only covers half a month.
      </P>

      <Challenge
        id="b"
        figure="Basis Trading Desk · Metro"
        question="Standing aside whenever the forecast is any colder than normal, what’s the least forecast skill, on the slider’s steps, at which the eight winters make money after fees?"
        solved={solvedB}
        status={statusB}
        success={`Solved: skill ${fmt(mSkill, 1)}, for ${cash(mrun.book.total)}. A little skill pays here because one month decides everything: avoid January of Year 3 and the premium of the calm months is profit. With less skill the forecast misses that January or turns the desk away from calm months, and the fees and breakaways win.`}
      />

      <P>
        <FigRef to="Basis Trading Desk">The Ridgeback desk</FigRef> and the Metro desk give the same answer to the chapter’s question. Understanding the pipes didn’t
        beat the market where the market understood them as well — Metro’s
        premium was fair. It beat the market where the understanding contained information the price didn’t: a production trend carried one year forward, an
        expansion announced long before it opened, a forecast the curve ignored. And the physics did more than point the way; it shaped the bets. Ridgeback’s basis
        can’t rise above the cost of the trip, which made selling it nearly free to be wrong about. Metro’s sits at the cost of the trip on most days but can climb
        to the value of the last customer cut off, which is why selling it pays a little in most winters and costs a great deal in one.
      </P>

      <H2>Holding the pipe</H2>
      <P>
        A basis swap pays the same for every cent the basis moves, in either direction. Owning pipeline capacity is different. A shipper with firm capacity on Ridgeback
        Express (<a href={lessonHref('gas/4.3')}>Lesson 4.3</a>) uses it only when Calder pays more than Ridgeback by more than the trip, so each day it earns the basis
        beyond the cost of shipping or nothing: an option, not a swap. {fmt(DESK_VOLUME)} MMBtu a day of it earned {money(n.expressY5)} in Year 5 and{' '}
        {n.expressOther < 1000 ? 'nothing' : `no more than ${money(n.expressOther)}`} in any other year; on April 1 of Year 5 the curve already valued Year 5’s use of it at {money(n.expressY5Forward)}. The shipper doesn’t
        need a hypothesis to collect when the basis blows out, but pays a reservation charge every year, glut or not. Whether that, or storage space, or a power plant,
        is worth its cost is the question of <a href={lessonHref('gas/6.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}

/** "six": small whole numbers spelled out in prose. */
function word(k: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][k] ?? fmt(k);
}

/** "$0.12": a small dollar amount in prose. */
function gp2(x: number): string {
  return `$${fmt(x, 2)}`;
}
