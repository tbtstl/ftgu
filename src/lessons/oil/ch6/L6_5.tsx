import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Controls,
  DataTable,
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
  Swatch,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams, type HistoryWeek } from '../../../model/oil/history';
import {
  COST_PER_BBL,
  RULE_DEFAULTS,
  SPREADS,
  backtest,
  basisRule,
  calendarRule,
  correlation,
  crackRule,
  expansionWeek,
  maxDrawdown,
  qualityRule,
  summarize,
  walkForwardRule,
  type SpreadId,
} from '../../../engines/oil/trading';
import type { PnlSummary } from '../../../engines/strategy/risk';
import { XYChart, type XYMarker } from '../shared/charts';

// ---------------------------------------------------------------------------
// The laboratory: the chapter's four rules, run together on one history.

export const STRATEGIES: SpreadId[] = ['calendar', 'basis', 'crack', 'quality'];

export const STRATEGY_LABEL: Record<SpreadId, string> = {
  calendar: 'Calendar spread',
  basis: 'Brent–WTI basis',
  crack: '3:2:1 crack',
  quality: 'Heavy–light quality',
};
const SHORT_LABEL: Record<SpreadId, string> = { calendar: 'Cal.', basis: 'Basis', crack: 'Crack', quality: 'Qual.' };
const TONE: Record<SpreadId, 'orange' | 'blue' | 'teal' | 'gold'> = { calendar: 'orange', basis: 'blue', crack: 'teal', quality: 'gold' };
const color = (id: SpreadId) => GRAPHIC[TONE[id]];
const INK = '#333333';

export type ExpansionChoice = 'built' | 'none';

export interface LabState {
  /** Units of each strategy. */
  calendar: number;
  basis: number;
  crack: number;
  quality: number;
  /** Kessler's working storage, million barrels. */
  kessler: number;
  /** Ridgeback Basin growth, kb/d a year. */
  growth: number;
  /** Whether the Kessler–Calder expansion opens after three years. */
  expansion: ExpansionChoice;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
  /** Scale on the seasonal swings in demand. */
  seasonality: number;
  /** $/bbl added to fuel oil's discount to crude after two years. */
  fuelOil: number;
  /** 0 = the course's history; 1–8 = the other simulated histories. */
  history: number;
}

export const LAB_DEFAULTS: LabState = {
  calendar: 10,
  basis: 10,
  crack: 10,
  quality: 10,
  kessler: HISTORY_DEFAULTS.kesslerCapacity,
  growth: HISTORY_DEFAULTS.basinGrowth,
  expansion: 'built',
  rail: HISTORY_DEFAULTS.rail,
  seasonality: HISTORY_DEFAULTS.seasonality,
  fuelOil: 0,
  history: 0,
};

/** The other simulated histories: the same physics with different random draws. */
export const OTHER_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** The fuel-oil shift begins after this many years. */
export const FUEL_OIL_YEAR = 2;

/** The history a lab state trades on. */
export function labParams(st: LabState): HistoryParams {
  return {
    seed: st.history === 0 ? HISTORY_DEFAULTS.seed : OTHER_SEEDS[st.history - 1],
    kesslerCapacity: st.kessler,
    basinGrowth: st.growth,
    expansion: st.expansion === 'none' ? null : HISTORY_DEFAULTS.expansion,
    rail: st.rail,
    seasonality: st.seasonality,
    fuelOilShock: st.fuelOil > 0 ? { year: FUEL_OIL_YEAR, size: st.fuelOil } : null,
  };
}

/** Each strategy's rule at the settings its own lesson used. */
export function defaultRule(h: HistoryWeek[], id: SpreadId): (t: number) => number {
  switch (id) {
    case 'calendar':
      return calendarRule(h, RULE_DEFAULTS.calendar);
    case 'basis':
      return basisRule(h, RULE_DEFAULTS.basis, expansionWeek(h));
    case 'crack':
      return crackRule(h, RULE_DEFAULTS.crack);
    case 'quality':
      return qualityRule(h, RULE_DEFAULTS.quality);
  }
}

export interface UnitRuns {
  /** Weekly P&L of one unit of each strategy, $, and its position (−1, 0 or 1). */
  pnl: Record<SpreadId, number[]>;
  positions: Record<SpreadId, number[]>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

// P&L is proportional to size (costs too), so each history is backtested once at one unit and
// scaled. Results are cached: revisiting a setting is instant.
const unitCache = new Map<string, UnitRuns>();
export function unitRuns(p: HistoryParams): UnitRuns {
  const key = JSON.stringify(p);
  let v = unitCache.get(key);
  if (!v) {
    const h = oilHistory(p);
    const pnl = {} as Record<SpreadId, number[]>;
    const positions = {} as Record<SpreadId, number[]>;
    for (const id of STRATEGIES) {
      const r = backtest(h, id, defaultRule(h, id), { units: 1 });
      pnl[id] = r.pnl;
      positions[id] = r.positions;
    }
    v = { pnl, positions };
    if (unitCache.size > 80) unitCache.clear();
    unitCache.set(key, v);
  }
  return v;
}

export interface LabResult {
  /** The book's weekly P&L, $, and each strategy's part of it. */
  pnl: number[];
  parts: Record<SpreadId, number[]>;
  stats: PnlSummary;
  totals: Record<SpreadId, number>;
  /** Each strategy's Sharpe ratio on its own (size doesn't change it). */
  sharpes: Record<SpreadId, number>;
  /** Each strategy's weekly value at risk at its chosen size, $. */
  vars: Record<SpreadId, number>;
  /** Correlations of the strategies' weekly P&L, in STRATEGIES order. */
  corr: number[][];
  /** The most initial margin tied up at once, $. */
  peakMargin: number;
  drawdown: { drawdown: number; peak: number; trough: number };
}

export function runLab(st: LabState): LabResult {
  const u = unitRuns(labParams(st));
  const n = u.pnl.calendar.length;
  const parts = {} as Record<SpreadId, number[]>;
  const totals = {} as Record<SpreadId, number>;
  const sharpes = {} as Record<SpreadId, number>;
  const vars = {} as Record<SpreadId, number>;
  for (const id of STRATEGIES) {
    parts[id] = u.pnl[id].map((v) => v * st[id]);
    totals[id] = sum(parts[id]);
    const one = summarize(u.pnl[id], 52);
    sharpes[id] = one.sharpe;
    vars[id] = one.var95 * st[id];
  }
  const pnl = Array.from({ length: n }, (_, i) => STRATEGIES.reduce((s, id) => s + parts[id][i], 0));
  let peakMargin = 0;
  for (let i = 0; i < n; i++) peakMargin = Math.max(peakMargin, STRATEGIES.reduce((s, id) => s + Math.abs(u.positions[id][i]) * st[id] * SPREADS[id].margin, 0));
  const corr = STRATEGIES.map((a) => STRATEGIES.map((b) => (a === b ? 1 : correlation(u.pnl[a], u.pnl[b]))));
  return { pnl, parts, stats: summarize(pnl, 52), totals, sharpes, vars, corr, peakMargin, drawdown: maxDrawdown(pnl) };
}

/** Sharpe ratios are shown, and judged, to two decimals. */
export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Are the physical drivers and the history at their starting values? */
export function physicalAtDefaults(st: LabState): boolean {
  return (
    st.kessler === LAB_DEFAULTS.kessler &&
    st.growth === LAB_DEFAULTS.growth &&
    st.expansion === LAB_DEFAULTS.expansion &&
    st.rail === LAB_DEFAULTS.rail &&
    st.seasonality === LAB_DEFAULTS.seasonality &&
    st.fuelOil === LAB_DEFAULTS.fuelOil &&
    st.history === LAB_DEFAULTS.history
  );
}

/** Challenge a: a Sharpe ratio of at least 1.4 on at least $400,000, on the course's history with the starting drivers. */
export const SIZING_TARGET = { sharpe: 1.4, total: 400000 };

export function sizingSolved(st: LabState): boolean {
  if (!physicalAtDefaults(st)) return false;
  const r = runLab(st);
  return round2(r.stats.sharpe) >= SIZING_TARGET.sharpe && r.stats.total >= SIZING_TARGET.total;
}

/** The same book and drivers on the eight other histories: the average Sharpe ratio. */
export function elsewhereSharpe(st: LabState): number {
  return mean(OTHER_SEEDS.map((_, k) => runLab({ ...st, history: k + 1 }).stats.sharpe));
}

/** One strategy's Sharpe ratio, at the starting drivers, averaged over the eight other histories. */
export function strategySharpeElsewhere(id: SpreadId): number {
  return mean(OTHER_SEEDS.map((_, k) => summarize(unitRuns(labParams({ ...LAB_DEFAULTS, history: k + 1 })).pnl[id], 52).sharpe));
}

/**
 * The calendar rule at its starting settings and 10 units, before and after costs: the smallest
 * five-year P&L before costs over all nine histories, and the averages on the eight others, $.
 */
export function calendarBeforeCosts(): { minGrossAll: number; othersGross: number; othersNet: number } {
  const run = (seed: number, costPerBbl: number) => {
    const h = oilHistory({ seed });
    return backtest(h, 'calendar', calendarRule(h, RULE_DEFAULTS.calendar), { units: STUDY_UNITS, costPerBbl }).stats.total;
  };
  const seeds = [HISTORY_DEFAULTS.seed, ...OTHER_SEEDS];
  return {
    minGrossAll: Math.min(...seeds.map((s) => run(s, 0))),
    othersGross: mean(OTHER_SEEDS.map((s) => run(s, 0))),
    othersNet: mean(OTHER_SEEDS.map((s) => run(s, COST_PER_BBL))),
  };
}

/** Challenge b: change the crack strategy's P&L by more than this share without touching seasonality. */
export const CRACK_SHIFT = 0.25;

/** The crack strategy's five-year P&L per unit, and its change from the starting drivers on the same history. */
export function crackShift(st: LabState): { here: number; base: number; shift: number } {
  const here = sum(unitRuns(labParams(st)).pnl.crack);
  const base = sum(unitRuns(labParams({ ...LAB_DEFAULTS, history: st.history })).pnl.crack);
  return { here, base, shift: base !== 0 ? here / base - 1 : 0 };
}

export function crackSolved(st: LabState): boolean {
  return st.seasonality === LAB_DEFAULTS.seasonality && Math.abs(crackShift(st).shift) > CRACK_SHIFT;
}

/** The book's worst week and what the crack and the Brent–WTI spread did in it. */
export function worstWeek(st: LabState) {
  const r = runLab(st);
  const h = oilHistory(labParams(st));
  let i = 0;
  r.pnl.forEach((v, k) => {
    if (v < r.pnl[i]) i = k;
  });
  return {
    index: i,
    loss: r.pnl[i],
    crackPart: r.parts.crack[i],
    crackFrom: h[i].crack321,
    crackTo: h[i + 1].crack321,
    basisFrom: h[i].brent - h[i].wti,
    basisTo: h[i + 1].brent - h[i + 1].wti,
    useTo: h[i + 1].pipelineUse,
    /** Year of the history (1–5) the week falls in. */
    year: Math.floor((i + 1) / 52) + 1,
  };
}

/** Week-to-week correlation between changes in the WTI crack and in the Brent–WTI spread. */
export function crackBasisCorrelation(p: HistoryParams = {}): number {
  const h = oilHistory(p);
  const dc = h.slice(1).map((w, i) => w.crack321 - h[i].crack321);
  const db = h.slice(1).map((w, i) => w.brent - w.wti - (h[i].brent - h[i].wti));
  return correlation(dc, db);
}

/** What trading costs do to a strategy at 10 units: net, costs, before costs, and with costs doubled. */
export function costStudy(id: SpreadId, units = 10) {
  const h = oilHistory();
  const run = (costPerBbl: number) => backtest(h, id, defaultRule(h, id), { units, costPerBbl });
  const net = run(COST_PER_BBL);
  return { net: net.stats.total, costs: net.costs, gross: run(0).stats.total, doubled: run(2 * COST_PER_BBL).stats.total, turnover: net.turnover, maxDrawdown: net.stats.maxDrawdown, margin: units * SPREADS[id].margin };
}

/** The basis trade's bet on the expansion: its P&L in the lead weeks and the spread's fall when the line opened. */
export function expansionBet(units = 10) {
  const h = oilHistory();
  const ew = expansionWeek(h);
  const b = backtest(h, 'basis', defaultRule(h, 'basis'), { units });
  if (ew === null) return { total: b.stats.total, lead: 0, from: 0, to: 0 };
  return {
    total: b.stats.total,
    lead: sum(b.pnl.slice(ew - RULE_DEFAULTS.basis.leadWeeks, ew)),
    from: h[ew - 1].brent - h[ew - 1].wti,
    to: h[ew].brent - h[ew].wti,
  };
}

// ---------------------------------------------------------------------------
// Overfitting: every setting of each rule, on our history and on eight others.

interface Axis {
  label: string;
  values: number[];
  format: (v: number) => string;
}

interface GridDef {
  a: Axis;
  b: Axis;
  rule: (h: HistoryWeek[], a: number, b: number) => (t: number) => number;
}

const weeks = (v: number) => `${v} week${v === 1 ? '' : 's'}`;

export const GRIDS: Record<SpreadId, GridDef> = {
  calendar: {
    a: { label: 'Fill change over', values: [1, 2, 3, 4, 6, 8], format: weeks },
    b: { label: 'Act on a fill change of', values: [0.005, 0.01, 0.02], format: (v) => `${fmt(v * 100, 1)} points` },
    rule: (h, a, b) => calendarRule(h, { lookback: a, threshold: b }),
  },
  basis: {
    a: { label: 'Act at pipeline use', values: [0.9, 0.93, 0.96, 0.99], format: (v) => pct(v) },
    b: { label: 'Spread above its low', values: [0.5, 1, 3], format: (v) => `up to $${fmt(v, v < 1 ? 2 : 0)}` },
    rule: (h, a, b) => basisRule(h, { useThreshold: a, stretch: b, leadWeeks: RULE_DEFAULTS.basis.leadWeeks }, expansionWeek(h)),
  },
  crack: {
    a: { label: 'Stock change over', values: [1, 2, 3, 4, 6], format: weeks },
    b: { label: 'Act on a change of', values: [5, 10, 15, 20], format: (v) => `${v} million bbl` },
    rule: (h, a, b) => crackRule(h, { lookback: a, threshold: b, outageWeeks: RULE_DEFAULTS.crack.outageWeeks }),
  },
  quality: {
    a: { label: 'Average over', values: [13, 26, 52], format: weeks },
    b: { label: 'Act outside a band of', values: [1, 2, 3, 4], format: (v) => `$${v}` },
    rule: (h, a, b) => qualityRule(h, { lookback: a, band: b }),
  },
};

/** The grid indices of each strategy's starting setting. */
export function defaultIndices(id: SpreadId): { a: number; b: number } {
  const d = RULE_DEFAULTS;
  const [a, b] =
    id === 'calendar'
      ? [d.calendar.lookback, d.calendar.threshold]
      : id === 'basis'
        ? [d.basis.useThreshold, d.basis.stretch]
        : id === 'crack'
          ? [d.crack.lookback, d.crack.threshold]
          : [d.quality.lookback, d.quality.band];
  return { a: Math.max(0, GRIDS[id].a.values.indexOf(a)), b: Math.max(0, GRIDS[id].b.values.indexOf(b)) };
}

export const STUDY_UNITS = 10;
/** Walk-forward: re-choose every quarter from the previous year. */
export const WALK = { window: 52, step: 13 };

export interface StudyPoint {
  a: number;
  b: number;
  /** Five-year P&L on our history, and the average over the eight others, $. */
  ours: number;
  others: number;
}

export interface Study {
  points: StudyPoint[];
  /** The best setting on our history, and the best on average over the others. */
  best: StudyPoint;
  bestElsewhere: StudyPoint;
  /** Walk-forward P&L on our history from week 53, and the hindsight-best setting's over the same weeks, $. */
  walkForward: number;
  hindsightSameWeeks: number;
}

const studyCache = new Map<SpreadId, Study>();
export function overfitStudy(id: SpreadId): Study {
  const hit = studyCache.get(id);
  if (hit) return hit;
  const g = GRIDS[id];
  const ours = oilHistory();
  const others = OTHER_SEEDS.map((seed) => oilHistory({ seed }));
  const cands: Array<[number, number]> = g.a.values.flatMap((a) => g.b.values.map((b) => [a, b] as [number, number]));
  const total = (h: HistoryWeek[], a: number, b: number) => backtest(h, id, g.rule(h, a, b), { units: STUDY_UNITS }).stats.total;
  const points = cands.map(([a, b]) => ({ a, b, ours: total(ours, a, b), others: mean(others.map((h) => total(h, a, b))) }));
  const best = points.reduce((x, p) => (p.ours > x.ours ? p : x));
  const bestElsewhere = points.reduce((x, p) => (p.others > x.others ? p : x));
  const wf = walkForwardRule(ours, id, cands, ([a, b]) => g.rule(ours, a, b), { window: WALK.window, step: WALK.step, units: STUDY_UNITS });
  const hindsight = backtest(ours, id, g.rule(ours, best.a, best.b), { units: STUDY_UNITS }).pnl.slice(WALK.window);
  const s: Study = { points, best, bestElsewhere, walkForward: sum(wf.pnl), hindsightSameWeeks: sum(hindsight) };
  studyCache.set(id, s);
  return s;
}

// ---------------------------------------------------------------------------
// Formatting and module-level reference runs for the prose.

/** Money to the nearest $100, or in millions with two decimals. */
function money(v: number): string {
  if (Math.abs(v) >= 1e6) return `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)} million`;
  return usd(Math.round(v / 100) * 100);
}

function axisMoney(v: number): string {
  const s = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${s}$${fmt(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${s}$${fmt(a / 1e3)}k`;
  return `${s}$${fmt(a)}`;
}

const sharpeText = (x: number) => fmt(round2(x), 2);
const dollars = (v: number) => usd(v, 2);

const BASE = runLab(LAB_DEFAULTS);
const BASE_SD = Object.fromEntries(STRATEGIES.map((id) => [id, summarize(unitRuns(labParams(LAB_DEFAULTS)).pnl[id], 52).stdev])) as Record<SpreadId, number>;
const SMALL_TANKS = runLab({ ...LAB_DEFAULTS, kessler: 4 });
const FUEL_SHIFT = 15;
const SHIFTED = runLab({ ...LAB_DEFAULTS, fuelOil: FUEL_SHIFT });
const NO_SEASONS = runLab({ ...LAB_DEFAULTS, seasonality: 0 });
const WORST = worstWeek(LAB_DEFAULTS);
const SEPARATE_VAR = sum(STRATEGIES.map((id) => BASE.vars[id]));
const CRACK_BASIS = crackBasisCorrelation();
/** An example of a book sized on our history, for the overfitting section. */
export const TUNED_BOOK: LabState = { ...LAB_DEFAULTS, calendar: 20, basis: 4, crack: 1, quality: 20 };

function corrText(x: number): string {
  return fmt(x, 2);
}

// ---------------------------------------------------------------------------

function LabChart({ r }: { r: LabResult }) {
  const series = STRATEGIES.map((id) => {
    let s = 0;
    return { id, points: [[0, 0] as [number, number], ...r.parts[id].map((v, i) => [(i + 1) / 52, (s += v)] as [number, number])] };
  });
  let run = 0;
  const book: Array<[number, number]> = [[0, 0], ...r.pnl.map((v, i) => [(i + 1) / 52, (run += v)] as [number, number])];
  const ys = [0, ...book.map((p) => p[1]), ...series.flatMap((s) => s.points.map((p) => p[1]))];
  const [y0, y1] = niceDomain(Math.min(...ys), Math.max(...ys), 4);
  const dd = r.drawdown;
  const peakEq = dd.peak >= 0 ? book[dd.peak + 1][1] : 0;
  const troughEq = dd.trough >= 0 ? book[dd.trough + 1][1] : 0;
  const px = (dd.peak + 1) / 52;
  const tx = (dd.trough + 1) / 52;
  return (
    <XYChart
      ariaLabel={`Cumulative P&L over five simulated years. The book ends at ${money(r.stats.total)}: calendar spread ${money(r.totals.calendar)}, basis ${money(r.totals.basis)}, crack ${money(r.totals.crack)}, quality ${money(r.totals.quality)}. Largest drawdown ${money(dd.drawdown)}.`}
      height={240}
      x={[0, 5]}
      y={[y0, y1]}
      xTicks={[0, 1, 2, 3, 4, 5]}
      yTicks={niceTicks(y0, y1, 4)}
      xFormat={(v) => (v === 0 ? 'start' : `year ${v}`)}
      yFormat={axisMoney}
      yLabel="Cumulative P&L"
      series={[...series.map((s) => ({ points: s.points, color: color(s.id), width: 1.75 })), { points: book, color: INK, width: 3 }]}
      bands={dd.drawdown > 0 && tx - px > 0.03 ? [{ from: px, to: tx, color: 'rgba(231, 91, 85, .12)' }] : []}
    >
      {(sx, sy) =>
        dd.drawdown > 0 ? (
          <g>
            <line x1={sx(tx)} x2={sx(tx)} y1={sy(peakEq)} y2={sy(troughEq)} stroke={GRAPHIC.red} strokeWidth={3} />
            <circle cx={sx(px)} cy={sy(peakEq)} r={3.5} fill={GRAPHIC.red} />
            <circle cx={sx(tx)} cy={sy(troughEq)} r={3.5} fill={GRAPHIC.red} />
            <text
              x={sx(tx) + (tx > 3.6 ? -8 : 8)}
              y={sy(troughEq) + 16}
              textAnchor={tx > 3.6 ? 'end' : 'start'}
              style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}
            >
              largest drawdown
            </text>
          </g>
        ) : null
      }
    </XYChart>
  );
}

function CorrCell({ x, self }: { x: number; self: boolean }) {
  if (self) return <span style={{ color: TEXT.gray }}>1</span>;
  const strong = Math.abs(x) >= 0.3;
  return <span style={strong ? { color: TEXT.violet, fontWeight: 600 } : undefined}>{corrText(x)}</span>;
}

function ScatterChart({ id, study, sel }: { id: SpreadId; study: Study; sel: StudyPoint }) {
  const g = GRIDS[id];
  const vals = [0, ...study.points.flatMap((p) => [p.ours, p.others])];
  const [lo, hi] = niceDomain(Math.min(...vals), Math.max(...vals), 4);
  const ticks = niceTicks(lo, hi, 4);
  // Labels turn inward near the right edge and upward near the bottom, so they stay on the plot.
  const right = sel.ours > lo + 0.7 * (hi - lo);
  const low = sel.others < lo + 0.15 * (hi - lo);
  const markers: XYMarker[] = [
    { x: study.best.ours, y: study.best.others, color: INK, r: 10, hollow: true, label: 'best here', labelDx: -14, labelDy: -10, labelAnchor: 'end' },
    ...study.points.map((p) => ({ x: p.ours, y: p.others, color: color(id), r: 4.5 })),
    { x: sel.ours, y: sel.others, color: color(id), r: 7.5, label: 'this setting', labelDx: right ? -11 : 11, labelDy: low ? -12 : 18, labelAnchor: right ? 'end' : 'start' },
  ];
  return (
    <XYChart
      ariaLabel={`${STRATEGY_LABEL[id]}: ${study.points.length} settings, each placed by its five-year P&L on our history and its average on eight other histories. The best setting on our history, ${g.a.format(study.best.a)} and ${g.b.format(study.best.b)}, makes ${money(study.best.ours)} here and ${money(study.best.others)} elsewhere. The selected setting makes ${money(sel.ours)} here and ${money(sel.others)} elsewhere.`}
      height={260}
      x={[lo, hi]}
      y={[lo, hi]}
      xTicks={ticks}
      yTicks={ticks}
      xFormat={axisMoney}
      yFormat={axisMoney}
      xLabel="five-year P&L on our history"
      yLabel="Average on eight other histories"
      series={[{ points: [[lo, lo], [hi, hi]], color: '#999', width: 1.5, dash: '6 4', label: 'as good elsewhere as here', labelAt: [hi, hi], labelColor: TEXT.gray }]}
      refs={[
        { axis: 'y', at: 0, color: '#bbb', dash: '1 0' },
        { axis: 'x', at: 0, color: '#bbb', dash: '1 0' },
      ]}
      markers={markers}
    />
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario<LabState>('oil-strategy-lab', LAB_DEFAULTS);
  const st = s1.state;
  const r = useMemo(() => runLab(st), [st]);
  const atDefaults = physicalAtDefaults(st);
  const sizedOk = sizingSolved(st);
  const elsewhere = useMemo(() => (sizedOk ? elsewhereSharpe(st) : 0), [sizedOk, st]);
  const cs = crackShift(st);
  const crackOk = crackSolved(st);
  const tone = (v: number) => (v < 0 ? ('red' as const) : ('green' as const));

  const s2 = useScenario('oil-strategy-lab-walk', { strategy: 'calendar' as SpreadId, ...defaultIndices('calendar') });
  const { strategy } = s2.state;
  const g = GRIDS[strategy];
  const ai = Math.min(s2.state.a, g.a.values.length - 1);
  const bi = Math.min(s2.state.b, g.b.values.length - 1);
  const studies = useMemo(() => Object.fromEntries(STRATEGIES.map((id) => [id, overfitStudy(id)])) as Record<SpreadId, Study>, []);
  const study = studies[strategy];
  const sel = study.points.find((p) => p.a === g.a.values[ai] && p.b === g.b.values[bi]) ?? study.best;

  // Reference numbers for the prose.
  const ref = useMemo(() => {
    const cal = studies.calendar;
    const q = studies.quality;
    const rank = (st: Study, p: StudyPoint) => [...st.points].sort((x, y) => y.ours - x.ours).indexOf(p) + 1;
    return {
      calOursMin: Math.min(...cal.points.map((p) => p.ours)),
      calOursMax: Math.max(...cal.points.map((p) => p.ours)),
      calOthersMin: Math.min(...cal.points.map((p) => p.others)),
      calOthersMax: Math.max(...cal.points.map((p) => p.others)),
      calSharpeElsewhere: strategySharpeElsewhere('calendar'),
      calGross: calendarBeforeCosts(),
      qualityRank: rank(q, q.bestElsewhere),
      tuned: runLab(TUNED_BOOK).stats.sharpe,
      tunedElsewhere: elsewhereSharpe(TUNED_BOOK),
      equalElsewhere: elsewhereSharpe(LAB_DEFAULTS),
      costs: costStudy('calendar'),
      crackCosts: costStudy('crack'),
      bet: expansionBet(),
    };
  }, [studies]);

  const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

  return (
    <LessonPage id="oil/6.5">
      <P>
        In <a href={lessonHref('oil/6.4')}>Lesson 6.4</a>, the Calder refinery sold crack spreads to steady its margin: a hedge, which removes risk a business
        already carries. The rest of this chapter went the other way, toward trades that take on risk because something physical pays for it. The calendar spread of{' '}
        <a href={lessonHref('oil/6.1')}>Lesson 6.1</a> bets on Kessler’s tanks; the basis trade of <a href={lessonHref('oil/6.2')}>Lesson 6.2</a> on the
        Kessler–Calder pipeline, and its quality trade on the price of high-sulfur fuel oil; the crack strategy of <a href={lessonHref('oil/6.3')}>Lesson 6.3</a> on
        product stocks and refinery outages. A trading desk would run several at once, and ask two questions of the result: how much risk is the whole book carrying,
        and how far should anyone believe a backtest?
      </P>
      <P>
        The laboratory runs the four rules at their lessons’ settings on the same weekly history. A unit of each is one spread: 1,000 barrels a leg, or for the
        crack, 3,000 barrels of crude against 2,000 of gasoline and 1,000 of diesel. The <K c="price">P&amp;L</K>, <K tone="violet">Sharpe ratio</K> and{' '}
        <K tone="violet">maximum drawdown</K> are as before. The weekly <K tone="violet">value at risk</K> is the loss exceeded in only one week in twenty, and the
        peak margin is the most cash an exchange would have held against the positions at once, at our illustrative rates. Next to the results sit the physical
        drivers behind each strategy and a choice of history: the course’s, or one of eight others drawn from the same physics with different luck. Every price is
        simulated for teaching. In the next demonstration, size each strategy and change the world it trades in:
      </P>

      <Figure name="Oil Strategy Laboratory" scenario={s1}>
        <Legend
          items={[
            { label: 'Book', color: INK, kind: 'line' },
            ...STRATEGIES.map((id) => ({ label: STRATEGY_LABEL[id], color: color(id), kind: 'line' as const })),
            { label: 'Largest drawdown', color: GRAPHIC.red, kind: 'line' as const },
          ]}
        />
        <LabChart r={r} />
        <Readouts
          items={[
            { label: <K c="price">five-year P&amp;L</K>, value: money(r.stats.total), tone: tone(r.stats.total) },
            { label: <K tone="violet">Sharpe ratio</K>, value: sharpeText(r.stats.sharpe), tone: 'violet' },
            { label: <K tone="violet">maximum drawdown</K>, value: money(r.stats.maxDrawdown), tone: 'red' },
            { label: <K tone="violet">weekly value at risk</K>, value: money(r.stats.var95), tone: 'red' },
            { label: 'peak margin', value: money(r.peakMargin) },
          ]}
        />
        <DataTable
          caption="Each strategy’s five-year P&L at its chosen size, its Sharpe ratio, and the correlations of the strategies’ weekly P&L"
          rowKey={(row) => row}
          rows={STRATEGIES}
          columns={[
            {
              label: 'Strategy',
              cell: (id) => (
                <span>
                  <Swatch color={color(id)} />
                  {STRATEGY_LABEL[id]}
                </span>
              ),
            },
            { label: 'P&L', cell: (id) => <span style={{ color: TEXT[tone(r.totals[id])] }}>{money(r.totals[id])}</span> },
            { label: 'Sharpe', cell: (id) => sharpeText(r.sharpes[id]) },
            ...STRATEGIES.map((other, j) => ({ label: SHORT_LABEL[other], cell: (id: SpreadId) => <CorrCell x={r.corr[STRATEGIES.indexOf(id)][j]} self={id === other} /> })),
          ]}
          footer={['Book', money(r.stats.total), sharpeText(r.stats.sharpe), '', '', '', '']}
        />
        <Controls columns={2}>
          {STRATEGIES.map((id) => (
            <Slider key={id} label={STRATEGY_LABEL[id]} tone={TONE[id]} value={st[id]} min={0} max={20} onChange={(v) => s1.set({ [id]: v } as Partial<LabState>)} display={units(st[id])} />
          ))}
        </Controls>
        <Controls columns={2}>
          <Slider label="Kessler storage" tone="orange" value={st.kessler} min={4} max={60} step={4} onChange={(v) => s1.set({ kessler: v })} display={`${st.kessler} million bbl`} />
          <Slider label="Basin growth" tone="orange" value={st.growth} min={0} max={140} step={10} onChange={(v) => s1.set({ growth: v })} display={`${st.growth} kb/d a year`} />
          <Slider label="Rail to the coast" tone="orange" value={st.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={`${st.rail} kb/d`} />
          <Slider
            label="Seasonal swings"
            value={st.seasonality}
            min={0}
            max={2}
            step={0.25}
            onChange={(v) => s1.set({ seasonality: v })}
            display={st.seasonality === 0 ? 'none' : st.seasonality === 1 ? 'normal' : `×${fmt(st.seasonality, 2)}`}
          />
          <Slider
            label="Fuel-oil discount"
            tone="gold"
            value={st.fuelOil}
            min={0}
            max={20}
            onChange={(v) => s1.set({ fuelOil: v })}
            display={st.fuelOil === 0 ? 'no shift' : `+$${st.fuelOil} after year 2`}
          />
          <Slider label="Simulated history" value={st.history} min={0} max={OTHER_SEEDS.length} onChange={(v) => s1.set({ history: v })} display={st.history === 0 ? 'the course’s' : `no. ${st.history} of ${OTHER_SEEDS.length} others`} />
        </Controls>
        <Segmented
          label="Kessler–Calder expansion"
          value={st.expansion}
          onChange={(v) => s1.set({ expansion: v })}
          options={[
            { value: 'built', label: 'Expansion opens after year 3' },
            { value: 'none', label: 'No expansion' },
          ]}
        />
      </Figure>

      <P>
        Start with 10 units of each. The book earns {money(BASE.stats.total)} with a Sharpe ratio of {sharpeText(BASE.stats.sharpe)}, worse than the calendar
        spread’s {sharpeText(BASE.sharpes.calendar)}, the basis trade’s {sharpeText(BASE.sharpes.basis)} or the quality trade’s {sharpeText(BASE.sharpes.quality)}{' '}
        alone; only the crack, at {sharpeText(BASE.sharpes.crack)}, is lower — and the crack is most of the book. Units aren’t risk. In a typical week a unit of the
        calendar spread gains or loses about {usd(BASE_SD.calendar)}, and a unit of the crack about {usd(BASE_SD.crack)}, {fmt(BASE_SD.crack / BASE_SD.calendar)}{' '}
        times as much: three times the barrels, on a spread that moves far more. The book’s maximum drawdown, {money(BASE.stats.maxDrawdown)}, came in a single week of
        year {WORST.year}, and oddly for a refining trade, nothing happened at any refinery that week. We’ll come back to it.
      </P>
      <P>
        The table’s correlations are the other half of the story. A <K tone="violet">correlation</K> near zero means two strategies’ good and bad weeks have nothing
        to do with each other, and most of these are near zero. When bad weeks rarely coincide, risk grows more slowly than size: at 10 units each, the four
        strategies’ weekly values at risk add up to {money(SEPARATE_VAR)}, but the book’s is {money(BASE.stats.var95)}. So a desk can shrink its riskiest strategy,
        lean on the others, and earn more for each unit of risk it carries.
      </P>

      <Challenge
        id="a"
        question="With the physical drivers and the history at their starting values, size the four strategies so the book’s Sharpe ratio is at least 1.40 while it still earns at least $400,000 over the five years."
        solved={sizedOk}
        status={
          !atDefaults
            ? 'Set the physical drivers, the expansion and the history back to their starting values.'
            : `A Sharpe ratio of ${sharpeText(r.stats.sharpe)} on ${money(r.stats.total)}.`
        }
        success={`Solved: a Sharpe ratio of ${sharpeText(r.stats.sharpe)} on ${money(r.stats.total)}, with a maximum drawdown of ${money(r.stats.maxDrawdown)} against ${money(BASE.stats.maxDrawdown)} for equal sizes. The book got there by shrinking the crack and leaning on the calendar and quality trades, whose units carry little risk. On the eight other simulated histories, this same book’s Sharpe ratio averages ${sharpeText(elsewhere)} — a number to keep in mind for the second half of this lesson.`}
      />

      <H2>One driver each</H2>
      <P>
        Why are most correlations so low? Because each strategy bets on a different physical fact. In <FigRef to="Oil Strategy Laboratory">the laboratory</FigRef>,
        shrink Kessler’s storage to 4 million barrels: the calendar spread goes from making {money(BASE.totals.calendar)} to losing{' '}
        {money(-SMALL_TANKS.totals.calendar)}, for the reasons <a href={lessonHref('oil/6.1')}>Lesson 6.1</a> traced, and none of the other three changes by a
        dollar. Add ${FUEL_SHIFT} to fuel oil’s discount after year 2 — a lasting shift like the one the 2020 limit on sulfur in ships’ fuel threatened — and the
        quality trade’s {money(BASE.totals.quality)} falls to {money(SHIFTED.totals.quality)}, again alone. Take the seasons out of demand and the crack’s{' '}
        {money(BASE.totals.crack)} becomes {money(NO_SEASONS.totals.crack)}. Removing one physical cause removes one strategy, not the book.
      </P>
      <P>
        The exception is the basis and the crack, with a correlation of {corrText(BASE.corr[1][2])}. Go back to the book’s worst week. The Kessler–Calder line dipped
        just short of full, to {pct(WORST.useTo, 1)}, so Kessler’s crude no longer had to be priced to pay for rail (<a href={lessonHref('oil/5.2')}>Lesson 5.2</a>),
        and the Brent–WTI spread fell from {dollars(WORST.basisFrom)} to {dollars(WORST.basisTo)}. The crack fell with it, from {dollars(WORST.crackFrom)} to{' '}
        {dollars(WORST.crackTo)}. Our 3:2:1 crack, like the one usually quoted on US futures, prices crude at WTI, while gasoline and diesel sell at the coast at
        prices tied to Brent. So the crack contains the Brent–WTI spread: its weekly changes have a correlation of {corrText(CRACK_BASIS)} with the spread’s. A bet on
        refining at inland crude prices is partly a bet on the pipeline, as many refiners in the middle of the United States found around 2011–2013, when bottlenecks
        out of Cushing held WTI far under Brent while their gasoline and diesel sold at prices set nearer the coasts.
      </P>

      <Challenge
        id="b"
        question="Without touching the seasonal swings, find a physical change outside refining that moves the crack strategy’s five-year P&L by more than a quarter."
        solved={crackOk}
        status={
          st.seasonality !== LAB_DEFAULTS.seasonality
            ? 'Set the seasonal swings back to normal: demand for gasoline and diesel is the refining side of the crack.'
            : `The crack strategy’s P&L is ${cs.shift >= 0 ? '+' : '−'}${pct(Math.abs(cs.shift))} from its value with the starting physical settings.`
        }
        success={`Solved: at 10 units the crack strategy now makes ${money(10 * cs.here)}, ${pct(Math.abs(cs.shift))} ${cs.shift >= 0 ? 'more' : 'less'} than its ${money(10 * cs.base)} with the starting settings. Nothing about refining changed — only the pipeline, reaching the crack through its WTI leg. A trader who wants a cleaner bet on refining, or a coastal refiner hedging its margin, prices the crack against Brent instead, as Lesson 6.4 found for Calder.`}
      />

      <H2>Overfitting</H2>
      <P>
        Every rule in this chapter came with settings — how many weeks to look back, how big a move to act on — chosen, as most backtest settings are, with this
        history in view. Try enough variations of a rule on one history and the best will look good partly because it fits that history’s accidents, which won’t come
        again. This is <K tone="violet">overfitting</K>, and the remedy is to judge a rule on data it wasn’t chosen on. We have plenty: the same physics can generate
        any number of histories. In the next demonstration, each dot is one setting of a rule at 10 units, placed by what it makes on our history (across) and on
        average over the eight others (up):
      </P>

      <Figure name="Oil Strategy Laboratory · out of sample" scenario={s2}>
        <Segmented
          label="Strategy"
          value={strategy}
          onChange={(v) => s2.set({ strategy: v, ...defaultIndices(v) })}
          options={STRATEGIES.map((id) => ({ value: id, label: STRATEGY_LABEL[id] }))}
        />
        <ScatterChart id={strategy} study={study} sel={sel} />
        <Readouts
          items={[
            { label: 'this setting, our history', value: money(sel.ours), tone: tone(sel.ours) },
            { label: 'this setting, other histories', value: money(sel.others), tone: tone(sel.others) },
            { label: <K tone="violet">walk-forward, year 2 on</K>, value: money(study.walkForward), tone: tone(study.walkForward) },
            { label: 'best in hindsight, same weeks', value: money(study.hindsightSameWeeks), tone: tone(study.hindsightSameWeeks) },
          ]}
        />
        <Slider label={g.a.label} value={ai} min={0} max={g.a.values.length - 1} onChange={(v) => s2.set({ a: v })} display={g.a.format(g.a.values[ai])} />
        <Slider label={g.b.label} value={bi} min={0} max={g.b.values.length - 1} onChange={(v) => s2.set({ b: v })} display={g.b.format(g.b.values[bi])} />
        <Caption>
          Best on our history: {g.a.format(study.best.a)}, {g.b.format(study.best.b)} — {money(study.best.ours)} here, {money(study.best.others)} elsewhere. Best
          elsewhere: {g.a.format(study.bestElsewhere.a)}, {g.b.format(study.bestElsewhere.b)} — {money(study.bestElsewhere.others)}.
        </Caption>
      </Figure>

      <P>
        Start with the calendar spread. On our history every setting makes money, from {money(ref.calOursMin)} to {money(ref.calOursMax)}. On the others the same
        settings average between {money(ref.calOthersMin)} and {money(ref.calOthersMax)}, and the dots don’t line up: settings that did better here did no better
        there. The Sharpe ratio of {sharpeText(BASE.sharpes.calendar)} it showed in Lesson 6.1 averages {sharpeText(ref.calSharpeElsewhere)} elsewhere. The tanks’
        momentum hasn’t vanished:{' '}
        {ref.calGross.minGrossAll > 0
          ? `before costs, the starting rule makes money on all nine histories, ${money(ref.calGross.othersGross)} on average on the eight others.`
          : `before costs, the starting rule makes ${money(ref.calGross.othersGross)} on average on the eight others.`}{' '}
        But it moves the spread by only a few cents a week, and on those histories costs leave {money(ref.calGross.othersNet)} of it. Our five years were
        ones in which the edge happened to outrun its costs.
      </P>
      <P>
        Switch to the basis or the crack and the dots line up, because what those rules trade happens in every history: the basin outgrows the pipeline, and product
        stocks rise and fall with the seasons. The quality trade sits between. Its edge is real — fuel oil’s discount does drift back toward its usual level — but
        the best setting on our history makes {money(studies.quality.best.ours)} here and {money(studies.quality.best.others)} elsewhere, while the setting that does best
        elsewhere, a {studies.quality.bestElsewhere.a}-week average with a ${studies.quality.bestElsewhere.b} band, made{' '}
        {money(studies.quality.bestElsewhere.ours)} here{ref.qualityRank > 1 ? ', so nobody choosing on this history would have picked it' : ''}.
      </P>
      <P>
        A <K tone="violet">walk-forward</K> test needs no other histories. It replays ours as a trader would have lived it: every 13 weeks, it picks the setting that
        made the most over the previous 52 and trades it for the next 13. For the calendar spread it makes {money(studies.calendar.walkForward)} from the second year
        on, against {money(studies.calendar.hindsightSameWeeks)} for the setting that was best over those weeks in hindsight; for the crack,{' '}
        {money(studies.crack.walkForward)} against {money(studies.crack.hindsightSameWeeks)}. The gap is the price of not knowing the future. Sizing is a setting
        too. One book that meets the first challenge — {units(TUNED_BOOK.calendar)} of calendar, {TUNED_BOOK.basis} of basis, {TUNED_BOOK.crack} of crack and{' '}
        {TUNED_BOOK.quality} of quality — has a Sharpe ratio of {sharpeText(ref.tuned)} here but averages {sharpeText(ref.tunedElsewhere)} on the other histories,
        where plain 10 units of each averages {sharpeText(ref.equalElsewhere)}.
      </P>

      <H2>What the backtests leave out</H2>
      <P>
        Even tests on fresh histories flatter these rules in three ways. First, our backtests trade each spread as it stands each week, as if a futures contract
        tracked it exactly, but real futures for later months already price what everyone can foresee. Of the basis trade’s {money(ref.bet.total)},{' '}
        {money(ref.bet.lead)} came from its short position in the four weeks before the expansion opened, nearly all in the week the spread fell from{' '}
        {dollars(ref.bet.from)} to {dollars(ref.bet.to)}; a real expansion’s opening date is usually public, and the spread for delivery after it would already be
        narrow. Likewise, gasoline futures for summer delivery trade higher than those for winter, so the seasons that earn the crack most of its profit would be
        partly priced in.
      </P>
      <P>
        Second, costs. At an illustrative {dollars(COST_PER_BBL)} a barrel per contract, costs take {money(ref.costs.costs)} of the calendar spread’s{' '}
        {money(ref.costs.gross)} before costs, because it changes position more often than any other rule; double them and it nets {money(ref.costs.doubled)}. Third,
        cash. Futures gains and losses are settled daily, so losses are paid as they happen, on top of the margin the exchange holds. At 10 units the crack’s maximum
        drawdown, {money(ref.crackCosts.maxDrawdown)}, is {fmt(ref.crackCosts.maxDrawdown / ref.crackCosts.margin, 1)} times its {money(ref.crackCosts.margin)} of
        margin; a desk that couldn’t find that cash would have had to close the position at the bottom.
      </P>
      <P>
        Every strategy in this chapter traded a spread that a physical business lives on: a tank farm, a pipeline, a refinery, a fuel-oil market. The laboratory’s
        book held paper against other people’s assets. In <a href={lessonHref('oil/7.1')}>Chapter 7</a>, the capstone, we own the assets: we develop oil fields,
        design a refinery, build the logistics between them, forecast their market, and finally run and hedge the whole business, with the physical drivers in our
        own hands.
      </P>
    </LessonPage>
  );
}
