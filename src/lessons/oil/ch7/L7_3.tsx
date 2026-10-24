import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, TEXT, fmt, lessonHref, niceDomain, niceTicks, pct, usd, useScenario, type Scenario } from '../../../framework';
import { BUSINESS_DEFAULTS, COMMITTED_TARIFF, PLAN_LIMITS, exposures, firmSpaceWeek, refineryDay, runBusiness, type OilBusiness, type ProductionPlan } from '../../../engines/oil/business';
import { TERMS } from '../../../engines/oil/economics';
import { NETWORK_DEFAULTS } from '../../../engines/oil/network';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams, type HistoryWeek } from '../../../model/oil/history';
import { BusinessCard } from '../shared/BusinessCard';
import { resetBusinessPart, updateBusiness, useBusiness } from '../shared/business';
import { XYChart, type XYBand } from '../shared/charts';

// ---------------------------------------------------------------------------
// The supply chain's drivers and the numbers each figure needs.

export type ExpansionYear = '1' | '2' | '3' | '4' | '5' | 'never';

export interface ChainState {
  /** Ridgeback Basin growth, kb/d per year. */
  growth: number;
  /** Year the Kessler–Calder expansion opens (or never), and the capacity it adds, kb/d. */
  year: ExpansionYear;
  add: number;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
  /** The week the diagram shows (0-based). */
  week: number;
}

export const GROWTH_STEP = 10;
export const GROWTH_MAX = 150;

export const CHAIN_DEFAULTS: ChainState = {
  growth: HISTORY_DEFAULTS.basinGrowth,
  year: String(HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.year : 3) as ExpansionYear,
  add: HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.add : 300,
  rail: HISTORY_DEFAULTS.rail,
  week: 80,
};

/** The walk-up tariff on the Kessler–Calder line, $/bbl (Lesson 4.1). */
export const WALKUP_TARIFF = NETWORK_DEFAULTS.pipelineTariff;
/** The producer's share of each dollar of price, after royalty and production tax (Lesson 2.5). */
export const NET_SHARE = (1 - TERMS.royalty) * (1 - TERMS.productionTax);
/** Weeks in the middle of year one and year four, where exposures are read. */
export const YEAR1_WEEK = 26;
export const YEAR4_WEEK = 182;

export function chainParams(st: Pick<ChainState, 'growth' | 'year' | 'add' | 'rail'>): HistoryParams {
  return { basinGrowth: st.growth, rail: st.rail, expansion: st.year === 'never' ? null : { year: Number(st.year), add: st.add } };
}

/** Port Calder's light-crude price less Kessler's, $/bbl. */
export function spreadOf(w: HistoryWeek): number {
  return w.calderCrude - w.wti;
}

export function lineFull(w: HistoryWeek): boolean {
  return w.pipelineUse >= 0.999;
}

/** Five-year result of one kb/d of firm space, $. */
export function firmPerKbd(h: HistoryWeek[]): number {
  return h.reduce((s, w) => s + firmSpaceWeek(w, 1), 0);
}

/** What the upstream loses to Kessler's discount beyond the walk-up tariff over the history, after royalty and tax, $ (positive = lost). */
export function upstreamDiscount(h: HistoryWeek[], production: number[]): number {
  return h.reduce((s, w, i) => s + production[i] * 7 * NET_SHARE * (spreadOf(w) - WALKUP_TARIFF), 0);
}

/** How the basin's surplus leaves Kessler in a week: the line, rail, and what's held back, kb/d. */
export function lineFlows(w: HistoryWeek, rail: number): { pipe: number; rail: number; held: number } {
  // In the network (Lesson 4.4), Coldwater's crude meets inland demand, so the basin's output is
  // what must leave Kessler for the coast.
  const surplus = w.basinSupply + Math.min(NETWORK_DEFAULTS.coldwaterSupply, NETWORK_DEFAULTS.coldwaterLine) - NETWORK_DEFAULTS.inlandDemand;
  const pipe = Math.min(surplus, w.pipelineCapacity);
  const r = Math.max(0, Math.min(rail, surplus - w.pipelineCapacity));
  return { pipe, rail: r, held: Math.max(0, surplus - w.pipelineCapacity - rail) };
}

function businessWith(plan: ProductionPlan, firmSpace: number): OilBusiness {
  return { ...BUSINESS_DEFAULTS, production: plan, logistics: { firmSpace } };
}

/** Challenge a: does firm space pay over the five years at this basin growth (other drivers as given)? Independent of how much is held. */
export function firmPaysAt(growth: number, st: Pick<ChainState, 'year' | 'add' | 'rail'> = CHAIN_DEFAULTS): boolean {
  return firmPerKbd(oilHistory(chainParams({ ...st, growth }))) > 0;
}

/**
 * Challenge a: with the expansion and the railroad at their starting values and some firm space
 * held, the slowest basin growth (10 kb/d steps) at which firm space pays for itself.
 */
export function slowestPayingSolved(st: ChainState, firmSpace: number): boolean {
  if (firmSpace <= 0) return false;
  if (st.year !== CHAIN_DEFAULTS.year || st.add !== CHAIN_DEFAULTS.add || st.rail !== CHAIN_DEFAULTS.rail) return false;
  return firmPaysAt(st.growth, st) && (st.growth < GROWTH_STEP || !firmPaysAt(st.growth - GROWTH_STEP, st));
}

/** The answer to challenge a. */
export function slowestPayingGrowth(): number {
  for (let g = 0; g <= GROWTH_MAX; g += GROWTH_STEP) if (firmPaysAt(g)) return g;
  return NaN;
}

// ---- The second demonstration: the result across basin growth.

export interface SweepState {
  year: ExpansionYear;
  rail: number;
}

export const SWEEP_DEFAULTS: SweepState = { year: CHAIN_DEFAULTS.year, rail: CHAIN_DEFAULTS.rail };
export const SWEEP_GROWTHS = Array.from({ length: GROWTH_MAX / GROWTH_STEP + 1 }, (_, i) => i * GROWTH_STEP);

export interface SweepRow {
  growth: number;
  /** The upstream's five-year result from the discount beyond the tariff, $ (negative = lost). */
  upstream: number;
  /** Five-year result of one kb/d of firm space, $. */
  perKbd: number;
}

const sweepCache = new Map<string, SweepRow[]>();
/** For each basin growth: what the upstream loses to the discount, and what each kb/d of firm space earns. */
export function growthSweep(plan: ProductionPlan, st: SweepState): SweepRow[] {
  const key = JSON.stringify([plan, st.year, st.rail]);
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const rows = SWEEP_GROWTHS.map((growth) => {
    const hp = chainParams({ growth, year: st.year, add: CHAIN_DEFAULTS.add, rail: st.rail });
    const r = runBusiness(businessWith(plan, 0), hp);
    return { growth, upstream: -upstreamDiscount(r.h, r.production), perKbd: firmPerKbd(r.h) };
  });
  if (sweepCache.size > 60) sweepCache.clear();
  sweepCache.set(key, rows);
  return rows;
}

/** The company's five-year basis result at each growth with `firmSpace` kb/d held, $. */
export function combined(rows: SweepRow[], firmSpace: number): number[] {
  return rows.map((r) => r.upstream + firmSpace * r.perKbd);
}

export function rangeOf(xs: number[]): number {
  return Math.max(...xs) - Math.min(...xs);
}

/** The firm space (on the 10 kb/d grid) that leaves the narrowest range of results across basin growth. */
export function steadiestFirmSpace(plan: ProductionPlan, st: SweepState): number {
  const rows = growthSweep(plan, st);
  const [min, max, step] = PLAN_LIMITS.firmSpace;
  let best = min;
  let bestRange = Infinity;
  for (let f = min; f <= max; f += step) {
    const r = rangeOf(combined(rows, f));
    if (r < bestRange - 1e-6) {
      best = f;
      bestRange = r;
    }
  }
  return best;
}

/** Challenge b: firm space set to the steadiest value for the reader's production plan and the figure's drivers. */
export function steadiestSolved(firmSpace: number, plan: ProductionPlan, st: SweepState): boolean {
  return firmSpace === steadiestFirmSpace(plan, st);
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose, from the reader's production plan at the starting drivers.

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function chainFacts(plan: ProductionPlan) {
  const b0 = businessWith(plan, 0);
  const r = runBusiness(b0, chainParams(CHAIN_DEFAULTS));
  const h = r.h;
  const years = [0, 1, 2, 3, 4].map((y) => avg(r.production.slice(y * 52, y * 52 + 52)));
  const peakYear = years.indexOf(Math.max(...years));
  const full = h.filter(lineFull);
  const room = h.filter((w) => !lineFull(w));
  const fullAvg = avg(full.map(spreadOf));
  const roomAvg = avg(room.map(spreadOf));
  const perKbd = firmPerKbd(h);
  const slowGrowth = 20;
  const slow = firmPerKbd(oilHistory(chainParams({ ...CHAIN_DEFAULTS, growth: slowGrowth })));
  const e1 = exposures(b0, YEAR1_WEEK, chainParams(CHAIN_DEFAULTS)).basis;
  const e4 = exposures(b0, YEAR4_WEEK, chainParams(CHAIN_DEFAULTS)).basis;
  const [fMin, fMax, fStep] = PLAN_LIMITS.firmSpace;
  const matchF = Math.min(fMax, Math.max(fMin, Math.round(-e4 / 1000 / fStep) * fStep));
  const rows = growthSweep(plan, SWEEP_DEFAULTS);
  const steadiest = steadiestFirmSpace(plan, SWEEP_DEFAULTS);
  const none = combined(rows, 0);
  const best = combined(rows, steadiest);
  return {
    weeks: h.length,
    year1: years[0],
    peak: years[peakYear],
    peakYear: peakYear + 1,
    loss: upstreamDiscount(h, r.production),
    fullWeeks: full.length,
    fullAvg,
    roomAvg,
    breakeven: (COMMITTED_TARIFF - roomAvg) / (fullAvg - roomAvg),
    perKbd,
    slowGrowth,
    slow,
    e1,
    e4,
    matchF,
    e4Matched: e4 + matchF * 1000,
    slowest: slowestPayingGrowth(),
    steadiest,
    upStall: none[0],
    upFast: none[none.length - 1],
    rangeNone: rangeOf(none),
    bestMax: Math.max(...best),
    bestMin: Math.min(...best),
    costStalled: steadiest * rows[0].perKbd,
    gainFast: steadiest * rows[rows.length - 1].perKbd,
  };
}

// ---------------------------------------------------------------------------
// Display helpers.

const SPREAD = GRAPHIC.green;
const UPSTREAM = GRAPHIC.red;
const FIRM = GRAPHIC.green;
const FULL_FILL = 'rgba(208, 112, 42, .14)';
const PIPE = GRAPHIC.orange;
const RAIL = '#8a6a4a';

export function money(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${fmt(a / 1e9, 2)} billion`;
  if (a >= 1e6) return `${s}$${fmt(a / 1e6, a >= 1e8 ? 0 : 1)} million`;
  return `${s}${usd(Math.round(a / 1000) * 1000)}`;
}

function perDay(x: number): string {
  const v = Math.round(x / 100) * 100;
  return `${v < 0 ? '−' : ''}${usd(Math.abs(v))}`;
}

const bpd = (x: number) => `${fmt(Math.round(x / 100) * 100)} barrels a day`;
const kbd = (x: number) => `${fmt(x)} kb/d`;
const price2 = (x: number) => usd(x, 2);
const yearTick = (v: number) => (v === 0 ? 'start' : `year ${v}`);
const YEAR_WORDS = ['one', 'two', 'three', 'four', 'five'];
const weekName = (i: number) => `week ${i + 1} (year ${Math.floor(i / 52) + 1})`;

function mFormat(v: number): string {
  if (v === 0) return '$0';
  return `${v < 0 ? '−' : ''}$${fmt(Math.abs(v))}M`;
}

/** Runs of weeks with the line full, as shaded x bands. */
function fullBands(h: HistoryWeek[]): XYBand[] {
  const out: XYBand[] = [];
  let i = 0;
  while (i < h.length) {
    if (!lineFull(h[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < h.length && lineFull(h[j + 1])) j++;
    out.push({ from: i / 52, to: (j + 1) / 52, color: FULL_FILL });
    i = j + 1;
  }
  return out;
}

/** The chain for one week: our wells, Kessler, the line and rail, Port Calder, the refinery. */
function ChainDiagram({ w, production, firmSpace, rail, runs }: { w: HistoryWeek; production: number; firmSpace: number; rail: number; runs: number }) {
  const f = lineFlows(w, rail);
  const full = lineFull(w);
  const pipeW = 3 + f.pipe / 60;
  const railW = f.rail > 0.5 ? 2 + f.rail / 40 : 1.5;
  const sp = spreadOf(w);
  const label = { fontSize: 12, fontWeight: 500, fill: '#333' } as const;
  const small = { fontSize: 11, fill: TEXT.gray } as const;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 200"
      role="img"
      aria-label={`${weekName(w.week)}: our wells produce ${bpd(production)}. Kessler $${w.wti.toFixed(2)}, Port Calder $${w.calderCrude.toFixed(2)}, a spread of $${sp.toFixed(2)}. The Kessler–Calder line carries ${fmt(f.pipe)} of ${fmt(w.pipelineCapacity)} kb/d${full ? ', full' : ''}, ${firmSpace > 0 ? `${fmt(firmSpace)} kb/d of it in our firm space, ` : ''}rail ${fmt(f.rail)} of ${fmt(rail)} kb/d${f.held > 0.5 ? `, and ${fmt(f.held)} kb/d is held back` : ''}. The Calder refinery runs ${fmt(runs)} kb/d.`}
    >
      <text x={345} y={18} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}>
        Port Calder − Kessler: {price2(sp)} a barrel
      </text>
      {/* Wells. */}
      <rect x={8} y={72} width={120} height={56} rx={6} fill="#f3efe8" stroke="#8a7a66" />
      <text x={68} y={92} textAnchor="middle" style={label}>
        Our wells
      </text>
      <text x={68} y={106} textAnchor="middle" style={small}>
        Northfield · Ridgeback
      </text>
      <text x={68} y={121} textAnchor="middle" style={{ ...label, fill: TEXT.orange }}>
        {fmt(production / 1000, 1)} kb/d
      </text>
      <path d="M128 100 L178 100" stroke="#8a7a66" strokeWidth={3} markerEnd="url(#l73arrow)" />
      <defs>
        <marker id="l73arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" fill="#8a7a66" />
        </marker>
      </defs>
      {/* Kessler. */}
      <circle cx={212} cy={100} r={30} fill="#eef4e6" stroke="#333" />
      <text x={212} y={104} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: '#1f3d0c' }}>
        {usd(w.wti, 2)}
      </text>
      <text x={212} y={146} textAnchor="middle" style={label}>
        Kessler
      </text>
      {f.held > 0.5 && (
        <text x={212} y={162} textAnchor="middle" style={{ fontSize: 11, fontWeight: 500, fill: TEXT.red }}>
          {fmt(f.held)} kb/d held back
        </text>
      )}
      {/* The line and rail. */}
      <path d="M240 88 C300 46, 392 46, 452 88" fill="none" stroke={full ? GRAPHIC.red : PIPE} strokeWidth={pipeW} opacity={0.85} />
      <path d="M240 88 C300 46, 392 46, 452 88" className="flow-dots" stroke="#fff" strokeWidth={Math.min(5, 1.5 + pipeW / 3)} style={{ animationDuration: `${(18 / Math.max(2, f.pipe * 0.02)).toFixed(2)}s` }} />
      <text x={346} y={42} textAnchor="middle" style={{ ...label, fill: full ? TEXT.red : '#333' }}>
        line {fmt(f.pipe)} of {fmt(w.pipelineCapacity)} kb/d{full ? ' · full' : ''}
      </text>
      {firmSpace > 0 && (
        <text x={346} y={78} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: TEXT.green }}>
          ours: {fmt(firmSpace)} kb/d at {price2(COMMITTED_TARIFF)}
        </text>
      )}
      <path d="M240 112 C300 154, 392 154, 452 112" fill="none" stroke={RAIL} strokeWidth={railW} strokeDasharray="3 4" opacity={f.rail > 0.5 ? 0.9 : 0.4} />
      <text x={346} y={164} textAnchor="middle" style={label}>
        rail {fmt(f.rail)} of {fmt(rail)} kb/d
      </text>
      {/* Port Calder and the refinery. */}
      <circle cx={482} cy={100} r={30} fill="#eef4e6" stroke="#333" />
      <text x={482} y={104} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: '#1f3d0c' }}>
        {usd(w.calderCrude, 2)}
      </text>
      <text x={482} y={146} textAnchor="middle" style={label}>
        Port Calder
      </text>
      <path d="M512 100 L528 100" stroke="#8a7a66" strokeWidth={3} markerEnd="url(#l73arrow)" />
      <rect x={530} y={72} width={102} height={56} rx={6} fill="#f3efe8" stroke="#8a7a66" />
      <text x={581} y={92} textAnchor="middle" style={label}>
        Calder refinery
      </text>
      <text x={581} y={110} textAnchor="middle" style={{ ...label, fill: TEXT.orange }}>
        runs {fmt(runs)} kb/d
      </text>
    </svg>
  );
}

const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));

/** A figure's Reset puts back both its own drivers and the firm space it edits in the reader's business. */
function withLogisticsReset<T>(s: Scenario<T>): Scenario<T> {
  return {
    ...s,
    reset: () => {
      s.reset();
      resetBusinessPart('logistics');
    },
  };
}

export default function Lesson() {
  const business = useBusiness();
  const plan = business.production;
  const firmSpace = business.logistics.firmSpace;
  const setFirm = (v: number) => updateBusiness('logistics', { firmSpace: v });
  const f = useMemo(() => chainFacts(plan), [plan]);

  // ---- Figure 1: the chain through five years.
  const s1 = useScenario<ChainState>('chain', CHAIN_DEFAULTS);
  const st = s1.state;
  const hp = useMemo(() => chainParams({ growth: st.growth, year: st.year, add: st.add, rail: st.rail }), [st.growth, st.year, st.add, st.rail]);
  const r = useMemo(() => runBusiness({ ...business, logistics: { firmSpace } }, hp), [business, firmSpace, hp]);
  const h = r.h;
  const week = Math.min(st.week, h.length - 1);
  const w = h[week];
  const runs = useMemo(() => refineryDay(business.refinery).runs, [business.refinery]);
  const firmTotal = r.sums.logistics;
  const loss = useMemo(() => upstreamDiscount(h, r.production), [h, r]);
  const fullWeeks = useMemo(() => h.filter(lineFull).length, [h]);
  const e1 = useMemo(() => exposures({ ...business, logistics: { firmSpace } }, YEAR1_WEEK, hp).basis, [business, firmSpace, hp]);
  const e4 = useMemo(() => exposures({ ...business, logistics: { firmSpace } }, YEAR4_WEEK, hp).basis, [business, firmSpace, hp]);
  const spreadPts = useMemo(() => h.map((x) => [x.t, spreadOf(x)] as [number, number]), [h]);
  const spreadMax = useMemo(() => Math.max(...spreadPts.map((p) => p[1])), [spreadPts]);
  const [sLo, sHi] = niceDomain(0, Math.max(12, spreadMax), 4);
  const bands = useMemo(() => fullBands(h), [h]);
  const cum = useMemo(() => {
    let a = 0;
    let b = 0;
    const firm: Array<[number, number]> = [[0, 0]];
    const up: Array<[number, number]> = [[0, 0]];
    const both: Array<[number, number]> = [[0, 0]];
    h.forEach((x, i) => {
      a += r.logistics[i];
      b -= r.production[i] * 7 * NET_SHARE * (spreadOf(x) - WALKUP_TARIFF);
      const t = (i + 1) / 52;
      firm.push([t, a / 1e6]);
      up.push([t, b / 1e6]);
      both.push([t, (a + b) / 1e6]);
    });
    return { firm, up, both };
  }, [h, r]);
  const cumVals = [...cum.firm, ...cum.up, ...cum.both].map((p) => p[1]);
  const [cLo, cHi] = niceDomain(Math.min(0, ...cumVals), Math.max(10, ...cumVals), 4);
  const solvedA = useMemo(() => slowestPayingSolved(st, firmSpace), [st, firmSpace]);
  const perK = useMemo(() => firmPerKbd(h), [h]);
  const prevPerK = useMemo(() => (st.growth >= GROWTH_STEP ? firmPerKbd(oilHistory(chainParams({ ...st, growth: st.growth - GROWTH_STEP }))) : NaN), [st]);
  const prevFull = useMemo(() => (st.growth >= GROWTH_STEP ? oilHistory(chainParams({ ...st, growth: st.growth - GROWTH_STEP })).filter(lineFull).length : 0), [st]);
  const flows = lineFlows(w, st.rail);
  const thisWeek = firmSpaceWeek(w, firmSpace);

  // ---- Figure 2: committing before the basin's growth is known.
  const s2 = useScenario<SweepState>('commit', SWEEP_DEFAULTS);
  const sw = s2.state;
  const rows = useMemo(() => growthSweep(plan, sw), [plan, sw]);
  const mine = useMemo(() => combined(rows, firmSpace), [rows, firmSpace]);
  const none = useMemo(() => combined(rows, 0), [rows]);
  const steadiest = useMemo(() => steadiestFirmSpace(plan, sw), [plan, sw]);
  const solvedB = firmSpace === steadiest;
  const sweepVals = [...none, ...mine, ...rows.map((x) => firmSpace * x.perKbd)].map((v) => v / 1e6);
  const [gLo, gHi] = niceDomain(Math.min(0, ...sweepVals), Math.max(10, ...sweepVals), 4);
  const pt = (vals: number[]) => rows.map((x, i) => [x.growth, vals[i] / 1e6] as [number, number]);
  const firmVals = rows.map((x) => firmSpace * x.perKbd);

  const firmSlider = (
    <Slider
      label="Firm space"
      tone="orange"
      value={firmSpace}
      min={PLAN_LIMITS.firmSpace[0]}
      max={PLAN_LIMITS.firmSpace[1]}
      step={PLAN_LIMITS.firmSpace[2]}
      onChange={setFirm}
      display={firmSpace === 0 ? 'none' : `${kbd(firmSpace)} at ${price2(COMMITTED_TARIFF)}`}
    />
  );
  const expansionOptions = [
    { value: '1', label: 'Year 1' },
    { value: '2', label: 'Year 2' },
    { value: '3', label: 'Year 3' },
    { value: '4', label: 'Year 4' },
    { value: '5', label: 'Year 5' },
    { value: 'never', label: 'Never' },
  ] as Array<{ value: ExpansionYear; label: string }>;

  return (
    <LessonPage id="oil/7.3">
      <P>
        <a href={lessonHref('oil/7.2')}>Lesson 7.2</a> settled what the Calder refinery will be. It stands at Port Calder, on the coast, and buys its crude there. The
        company’s own oil comes out of the ground far inland, at Northfield and in the Ridgeback Basin, and the plan from{' '}
        <a href={lessonHref('oil/7.1')}>Lesson 7.1</a> has it producing about {bpd(f.year1)} in year one and {bpd(f.peak)} in year {YEAR_WORDS[f.peakYear - 1] ?? f.peakYear}. That oil is sold at
        the Kessler hub, at the WTI-like price. Between the company’s wells and its refinery runs the 500-mile Kessler–Calder line of{' '}
        <a href={lessonHref('oil/4.1')}>Lesson 4.1</a>, and with it the spread of <a href={lessonHref('oil/5.2')}>Lesson 5.2</a>.
      </P>
      <P>
        <a href={lessonHref('oil/4.4')}>Lesson 4.4</a> found how Kessler’s price is set: it is Port Calder’s price less the cost of whatever route the next barrel takes
        to the coast. While the line has room, that is the {price2(WALKUP_TARIFF)} tariff. When the basin outgrows the line, the next barrel goes by rail, and Kessler
        falls about {usd(NETWORK_DEFAULTS.railCost)} under the coast. For our company the gap is a cost. Each dollar of it beyond the tariff comes off every barrel the
        upstream sells, less the share that would have gone in royalty and production tax; over the five simulated years, with the starting drivers, it costs the
        upstream {money(f.loss)}.
        The refinery gains nothing from cheap crude at Kessler, because it buys at the coast. This lesson asks what the company can do about the gap, through one
        decision: how much space to hold on the line.
      </P>
      <P>
        <K tone="orange">Firm space</K> is a commitment to ship a fixed volume every day for years. We’ll let the company commit up to{' '}
        {kbd(PLAN_LIMITS.firmSpace[1])} for the five years on a <K c="price">take-or-pay</K> basis: it pays the tariff on all of it whether it ships or not. Space that is
        guaranteed when the line is full is worth more than walk-up space, so we charge {price2(COMMITTED_TARIFF)} a barrel, the {price2(WALKUP_TARIFF)} tariff plus an
        illustrative {price2(COMMITTED_TARIFF - WALKUP_TARIFF)} premium. Each week the company fills its space, buying crude at Kessler if its own wells don’t supply
        enough, and sells it at Port Calder. Per barrel it earns the spread less {price2(COMMITTED_TARIFF)}: a loss of about {price2(COMMITTED_TARIFF - f.roomAvg)} in a
        week the line has room, a gain of about {price2(f.fullAvg - COMMITTED_TARIFF)} in a week it doesn’t. As <a href={lessonHref('oil/6.2')}>Lesson 6.2</a> put it,
        owning space on a pipeline is a long position in the spread. All prices here are simulated.
      </P>
      <P>
        In the next demonstration, the diagram shows one week: what the company’s wells produce, the prices at both ends, and how the basin’s crude leaves Kessler. Drag
        across the first chart, or use the arrow keys on it, to pick the week; the shaded weeks are those with the line full. The second chart adds up, week by week,
        what the firm space earns, what the upstream loses to the discount beyond the tariff, and the two together. Your firm space is kept as part of your business; the
        sliders under it change the basin, the expansion that opens in year three, and the railroad:
      </P>

      <Figure name="Petroleum Supply Chain" scenario={withLogisticsReset(s1)}>
        <ChainDiagram w={w} production={r.production[week]} firmSpace={firmSpace} rail={st.rail} runs={runs} />
        <Legend
          items={[
            { label: 'Port Calder − Kessler', color: SPREAD, kind: 'line' },
            { label: 'line full', color: 'rgba(208, 112, 42, .35)' },
            { label: `${price2(WALKUP_TARIFF)} walk-up tariff`, color: '#777', kind: 'line', dashed: true },
            { label: `${price2(COMMITTED_TARIFF)} committed tariff`, color: FIRM, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Port Calder’s price less Kessler’s over five simulated years, from ${price2(Math.min(...spreadPts.map((p) => p[1])))} to ${price2(spreadMax)} a barrel; the line is full in ${fullWeeks} of ${h.length} weeks. Selected: ${weekName(week)}, ${price2(spreadOf(w))}.`}
          height={170}
          x={[0, 5]}
          y={[sLo, sHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(sLo, sHi, 4)}
          yFormat={(v) => `$${v}`}
          yLabel="Port Calder − Kessler, $ per barrel"
          bands={bands}
          series={[{ points: spreadPts, color: SPREAD, width: 1.8 }]}
          refs={[
            { axis: 'y', at: WALKUP_TARIFF, color: '#777', dash: '4 4' },
            { axis: 'y', at: COMMITTED_TARIFF, color: FIRM, dash: '6 4' },
            { axis: 'x', at: (week + 0.5) / 52, cursor: true },
          ]}
          onScrub={(x) => s1.set({ week: Math.max(0, Math.min(h.length - 1, Math.floor(x * 52))) })}
          scrubValue={(week + 0.5) / 52}
          scrubStep={1 / 52}
          scrubLabel="Week shown in the diagram"
        />
        <XYChart
          ariaLabel={`Running totals over five years: firm space ${money(firmTotal)}, the upstream’s result from the discount beyond the tariff ${money(-loss)}, together ${money(firmTotal - loss)}.`}
          height={170}
          x={[0, 5]}
          y={[cLo, cHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(cLo, cHi, 4)}
          yFormat={mFormat}
          yLabel="Running total, $ million"
          series={[
            { points: cum.up, color: UPSTREAM, width: 2, label: 'upstream', labelAnchor: 'end' },
            { points: cum.firm, color: FIRM, width: 2, label: firmSpace > 0 ? 'firm space' : undefined, labelAnchor: 'end' },
            { points: cum.both, color: '#333', width: 2.5, label: firmSpace > 0 ? 'together' : undefined, labelAnchor: 'end' },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="price">firm space, five years</K>, value: money(firmTotal), tone: tone(firmTotal) },
            { label: <K tone="red">upstream’s loss to the discount</K>, value: money(loss), tone: 'red' },
            { label: <K tone="orange">weeks the line is full</K>, value: `${fullWeeks} of ${h.length}`, tone: 'orange' },
            { label: <K tone="violet">basis exposure, mid year 1</K>, value: perDay(e1), tone: 'violet' },
            { label: <K tone="violet">basis exposure, mid year 4</K>, value: perDay(e4), tone: 'violet' },
          ]}
        />
        {firmSlider}
        <Slider label="Basin growth" tone="orange" value={st.growth} min={0} max={GROWTH_MAX} step={GROWTH_STEP} onChange={(v) => s1.set({ growth: v })} display={`${kbd(st.growth)} a year`} />
        <Segmented label="Expansion opens" value={st.year} onChange={(v) => s1.set({ year: v as ExpansionYear })} options={expansionOptions} />
        <Slider label="Expansion size" tone="orange" value={st.add} min={0} max={500} step={25} onChange={(v) => s1.set({ add: v })} display={st.year === 'never' ? 'not built' : kbd(st.add)} />
        <Slider label="Rail capacity" tone="orange" value={st.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={kbd(st.rail)} />
        <Caption>
          In {weekName(week)} the line carries {kbd(Math.round(flows.pipe))} of {kbd(w.pipelineCapacity)}
          {flows.rail > 0.5 ? ` and rail ${kbd(Math.round(flows.rail))}` : ''}
          {flows.held > 0.5 ? `, with ${kbd(Math.round(flows.held))} held back in the basin` : ''}. Port Calder is {price2(spreadOf(w))} over Kessler, so{' '}
          {firmSpace > 0 ? `the firm space ${thisWeek >= 0 ? 'earns' : 'loses'} ${money(Math.abs(thisWeek))} that week.` : 'firm space would earn the spread less the committed tariff on every barrel.'} Exposures are in dollars a day for each dollar
          Kessler falls against the coast.
        </Caption>
        <BusinessCard current="logistics" />
      </Figure>

      <P>
        With the starting drivers, the line is full in {f.fullWeeks} of the {f.weeks} weeks. In those weeks Port Calder trades {price2(f.fullAvg)} over Kessler on
        average, and in the rest {price2(f.roomAvg)}. At {price2(COMMITTED_TARIFF)} a barrel, firm space breaks even if the line is full in about {pct(f.breakeven)} of
        weeks; here it is full in {pct(f.fullWeeks / f.weeks)}, so each 1,000 barrels a day of space earns {money(f.perKbd)} over the five years, and{' '}
        {kbd(100)} earns {money(100 * f.perKbd)}. Now slow the basin’s growth to {kbd(f.slowGrowth)} a year. The line never fills, the spread sits on the tariff, and
        the same {kbd(100)} {f.slow < 0 ? 'loses' : 'earns'} {money(Math.abs(100 * f.slow))}: a take-or-pay contract charges for space whether or not it turns out to
        be needed.
      </P>

      <Challenge
        id="a"
        question="Keep the expansion and the railroad at their starting values and hold some firm space. What is the slowest basin growth, to the nearest 10 kb/d a year, at which the firm space pays for itself over the five years?"
        solved={solvedA}
        status={
          firmSpace <= 0
            ? 'Commit some firm space first.'
            : st.year !== CHAIN_DEFAULTS.year || st.add !== CHAIN_DEFAULTS.add || st.rail !== CHAIN_DEFAULTS.rail
              ? `Set the expansion back to year ${CHAIN_DEFAULTS.year} and ${kbd(CHAIN_DEFAULTS.add)}, and rail to ${kbd(CHAIN_DEFAULTS.rail)}.`
              : `At ${kbd(st.growth)} a year the line is full in ${fullWeeks} weeks, and each kb/d of firm space ${perK >= 0 ? 'earns' : 'loses'} ${money(Math.abs(perK))}.`
        }
        success={`Solved: ${kbd(st.growth)} a year. The line is full in ${fullWeeks} weeks and each kb/d of space earns ${money(perK)}; at ${kbd(st.growth - GROWTH_STEP)} a year it is full in only ${prevFull}, and each kb/d ${Number.isFinite(prevPerK) && prevPerK < 0 ? 'loses' : 'earns'} ${money(Math.abs(prevPerK))}. The answer doesn’t depend on how much space you hold: every barrel of it earns the same spread.`}
      />

      <H2>A physical hedge</H2>
      <P>
        Firm space earns when the spread widens, which is exactly when the upstream loses. The readouts measure both as <K tone="violet">basis exposure</K>: how the
        company’s cash changes, in dollars a day, for each dollar Kessler falls against the coast. Without firm space it is {perDay(f.e1)} in the middle of year one and{' '}
        {perDay(f.e4)} in the middle of year four: each is the company’s production at the time, after royalty and tax, since every one of its barrels loses the
        dollar. Each 1,000 barrels a day of firm space adds $1,000 a day. So about {kbd(f.matchF)} brings the year-four exposure close to zero ({perDay(f.e4Matched)}): from then on, a wider spread costs the upstream about what
        the space earns. For the barrels it matches, the company sells its crude in effect at the coast less {price2(COMMITTED_TARIFF)}, not at Kessler. This is a{' '}
        <K tone="violet">physical hedge</K>. Unlike the futures of Chapter 6, it moves the barrels themselves.
      </P>
      <P>
        A hedge sized for year four doesn’t fit every year, because the plan’s production doesn’t stay put. And the commitment has to be signed before anyone knows how
        fast the basin will grow. That is the usual order of things: new pipelines are generally built only after shippers have signed long-term commitments, often
        take-or-pay, for much of their capacity.
      </P>

      <H2>Committing before you know</H2>
      <P>
        In the next demonstration, each point along the bottom is a different five years, with the basin growing anywhere from nothing to {kbd(GROWTH_MAX)} a year;
        everything else is as you set it. The red line is what the upstream loses to the discount beyond the tariff, the green line what your firm space earns, and the
        black line their sum, the company’s basis result:
      </P>

      <Figure name="Petroleum Supply Chain · committing early" scenario={withLogisticsReset(s2)}>
        <Legend
          items={[
            { label: 'upstream: discount beyond the tariff', color: UPSTREAM, kind: 'line' },
            { label: 'firm space', color: FIRM, kind: 'line' },
            { label: 'together', color: '#333', kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Five-year results against basin growth from 0 to ${GROWTH_MAX} kb/d a year, with ${kbd(firmSpace)} of firm space: the upstream’s result from the discount runs from ${money(Math.max(...none))} to ${money(Math.min(...none))}, the firm space from ${money(Math.min(...firmVals))} to ${money(Math.max(...firmVals))}, and the sum from ${money(Math.min(...mine))} to ${money(Math.max(...mine))}.`}
          height={250}
          x={[0, GROWTH_MAX]}
          y={[gLo, gHi]}
          xTicks={[0, 25, 50, 75, 100, 125, 150]}
          yTicks={niceTicks(gLo, gHi, 5)}
          yFormat={mFormat}
          xLabel="basin growth, kb/d a year"
          yLabel="Five-year result, $ million"
          refs={[{ axis: 'y', at: 0, color: '#999', dash: '2 3' }]}
          series={[
            { points: pt(none), color: UPSTREAM, width: 2 },
            { points: pt(firmVals), color: FIRM, width: 2 },
            { points: pt(mine), color: '#333', width: 3 },
          ]}
          markers={rows.map((x, i) => ({ x: x.growth, y: mine[i] / 1e6, color: '#333', r: 3 }))}
        />
        <Readouts
          items={[
            { label: <K tone="violet">range with no firm space</K>, value: money(rangeOf(none)), tone: 'violet' },
            { label: <K tone="violet">range with yours</K>, value: money(rangeOf(mine)), tone: 'violet' },
            { label: <K c="price">space if the basin stalls</K>, value: money(firmVals[0]), tone: tone(firmVals[0]) },
            { label: <K c="price">space if it grows fastest</K>, value: money(firmVals[firmVals.length - 1]), tone: tone(firmVals[firmVals.length - 1]) },
          ]}
        />
        {firmSlider}
        <Segmented label="Expansion opens" value={sw.year} onChange={(v) => s2.set({ year: v as ExpansionYear })} options={expansionOptions} />
        <Slider label="Rail capacity" tone="orange" value={sw.rail} min={0} max={300} step={25} onChange={(v) => s2.set({ rail: v })} display={kbd(sw.rail)} />
        <Caption>
          The expansion, when built, adds {kbd(CHAIN_DEFAULTS.add)}. With {firmSpace === 0 ? 'no firm space' : kbd(firmSpace)}, the company’s five-year basis result runs
          from {money(Math.min(...mine))} to {money(Math.max(...mine))} across these basins.
        </Caption>
        <BusinessCard current="logistics" parts={['production', 'logistics']} />
      </Figure>

      <P>
        With the starting drivers and no firm space, the upstream’s result from the discount is{' '}
        {Math.abs(f.upStall) < 5e6 ? 'roughly nothing' : money(f.upStall)} if the basin stalls and {money(f.upFast)} if it grows by {kbd(GROWTH_MAX)} a year, a range
        of {money(f.rangeNone)}. With {kbd(f.steadiest)} of space, the sum stays between {money(f.bestMin)} and {money(f.bestMax)} in every one of these basins. The
        hedge isn’t free: if the basin stalls, the space {f.costStalled < 0 ? 'costs' : 'earns'} {money(Math.abs(f.costStalled))} and saves the upstream nothing,
        while if the basin grows fastest it earns {money(f.gainFast)}. What it buys is a result the company can plan on.
      </P>

      <Challenge
        id="b"
        question="Find the firm space, to the nearest 10 kb/d, that keeps the company’s five-year basis result within the narrowest range across every rate of basin growth."
        solved={solvedB}
        status={`With ${firmSpace === 0 ? 'no firm space' : kbd(firmSpace)}, the result spans ${money(rangeOf(mine))}.`}
        success={`Solved: ${kbd(firmSpace)} keeps the result within ${money(rangeOf(mine))}, against ${money(rangeOf(none))} with none. The more the basin outgrows the line, the more the upstream loses and the more the space earns; this much space makes the two nearly cancel.`}
      />

      <P>
        The answer lands close to the space that brought the year-four exposure near zero in <FigRef to="Petroleum Supply Chain">the first demonstration</FigRef>,
        because both ask the same question: how many of the company’s barrels does the spread reach? It also depends on choices made elsewhere. Plan more production
        in <a href={lessonHref('oil/7.1')}>Lesson 7.1</a> and the answer rises; plan less and it falls. An earlier expansion, or more rail, keeps the spread lower in
        the fast-growing basins, and with it both the upstream’s losses and what the space can earn.
      </P>
      <P>
        Every decision so far has rested on a view of the future: the prices the wells will fetch, the cracks the refinery’s units will earn, and now how fast the basin
        will outgrow its pipeline. Firm space showed what a commitment does when that view turns out wrong, and how to size one so it matters less.{' '}
        <a href={lessonHref('oil/7.4')}>Lesson 7.4</a> builds the company’s forecasting desk: what the course’s physical model says about the next five years, and how far
        each of its forecasts can be trusted.
      </P>
    </LessonPage>
  );
}
