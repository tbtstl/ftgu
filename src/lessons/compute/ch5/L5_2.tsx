import { useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import {
  A_EQUIVALENT,
  BUILD,
  SUPPLY_DEFAULTS,
  WAFER_MM,
  dieYield,
  diesPerWafer,
  supplyChain,
  type Quarter,
  type Stage,
  type SupplyParams,
} from '../../../engines/compute/supplyChain';
import { GPU_COLOR } from '../../../model/compute/hardware';
import { rng } from '../../../model/random';

// ---------------------------------------------------------------------------
// The first demonstration: the supply chain over twelve quarters.

export interface ChainState {
  /** Quarter shown, 0-based. */
  quarter: number;
  /** Wafers a quarter for accelerators, thousands. */
  wafers: number;
  /** Killer defects per cm². */
  defects: number;
  /** HBM stacks a quarter, millions. */
  hbm: number;
  /** Advanced packages a quarter, thousands. */
  packaging: number;
  /** Data-center power coming online a quarter, MW. */
  power: number;
  /** Quarter (0-based) the B-class starts. */
  bStart: number;
}

export const CHAIN_DEFAULTS: ChainState = {
  quarter: 0,
  wafers: SUPPLY_DEFAULTS.wafers,
  defects: SUPPLY_DEFAULTS.defectsPerCm2,
  hbm: SUPPLY_DEFAULTS.hbm,
  packaging: SUPPLY_DEFAULTS.packaging,
  power: SUPPLY_DEFAULTS.powerMW,
  bStart: SUPPLY_DEFAULTS.bStart,
};

export const QUARTERS = SUPPLY_DEFAULTS.quarters;

export function paramsOf(s: Omit<ChainState, 'quarter'>): SupplyParams {
  return { ...SUPPLY_DEFAULTS, wafers: s.wafers, defectsPerCm2: s.defects, hbm: s.hbm, packaging: s.packaging, powerMW: s.power, bStart: s.bStart };
}

const chainCache = new Map<string, Quarter[]>();

/** The twelve quarters for a set of stage capacities (memoized). */
export function runChain(s: Omit<ChainState, 'quarter'>): Quarter[] {
  const p = paramsOf(s);
  const key = JSON.stringify(p);
  let qs = chainCache.get(key);
  if (!qs) {
    qs = supplyChain(p);
    if (chainCache.size > 300) chainCache.clear();
    chainCache.set(key, qs);
  }
  return qs;
}

/** Slack allowed when comparing GPUs in service with demand, thousands of A-class equivalents. */
export const SHORT_TOLERANCE = 1;

/** Quarters (0-based) in which fewer GPUs are in service than the market wants. */
export function shortQuarters(qs: Quarter[]): number[] {
  return qs.filter((q) => q.installedAEq < q.demandAEq - SHORT_TOLERANCE).map((q) => q.q);
}

/** The first challenge: GPUs in service keep up with demand in every quarter. */
export function aheadSolved(s: Omit<ChainState, 'quarter'>): boolean {
  return shortQuarters(runChain(s)).length === 0;
}

export const STAGES: Stage[] = ['wafers', 'memory', 'packaging', 'power'];

export const STAGE_LABEL: Record<Stage, string> = {
  wafers: 'Wafers → good dies',
  memory: 'HBM memory',
  packaging: 'Advanced packaging',
  power: 'Data-center power',
};

const STAGE_NAME: Record<Stage, string> = { wafers: 'the wafers', memory: 'memory', packaging: 'packaging', power: 'power for data centers' };
const STAGE_SHORT: Record<Stage, string> = { wafers: 'wafers', memory: 'HBM', packaging: 'pack', power: 'power' };

/** A stage's capacity this quarter in A-class equivalents, thousands. */
export function stageAEq(q: Quarter, s: Stage): number {
  return q.capacity[s].A * A_EQUIVALENT.A + q.capacity[s].B * A_EQUIVALENT.B;
}

/** Thousands of GPUs, as "837,000". */
function gpus(k: number): string {
  return fmt(Math.round(k) * 1000);
}

/** Thousands of A-class equivalents, as "1.60 million". */
function millions(k: number, digits = 2): string {
  return `${fmt(k / 1000, digits)} million`;
}

const A_COLOR = GPU_COLOR.A;
const B_COLOR = GPU_COLOR.B;

/** What each stage could support this quarter, the binding one marked. */
function StagePanel({ q, maxAEq }: { q: Quarter; maxAEq: number }) {
  const x0 = 168;
  const x1 = 470;
  const x = scale(0, maxAEq, x0, x1);
  const rows = STAGES.map((s, i) => {
    const a = q.capacity[s].A;
    const b = q.capacity[s].B;
    return { s, i, a, b, y: 20 + i * 32 };
  });
  const describe = (a: number, b: number) => (b > 0.5 ? (a > 0.5 ? `${fmt(a)}k A + ${fmt(b)}k B` : `${fmt(b)}k B`) : `${fmt(a)}k A-class`);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 158"
      role="img"
      aria-label={`Quarter ${q.q + 1}: GPUs each stage could support. ${rows.map((r) => `${STAGE_LABEL[r.s]}: ${describe(r.a, r.b)}`).join('; ')}. ${STAGE_LABEL[q.binding]} sets the pace.`}
    >
      {rows.map((r) => {
        const bind = r.s === q.binding;
        const wa = x(r.a * A_EQUIVALENT.A) - x0;
        const wb = x(r.b * A_EQUIVALENT.B) - x0;
        return (
          <g key={r.s}>
            <text x={0} y={r.y + 4} className={bind ? 'lab' : 'ax'} style={{ fontSize: 13 }}>
              {STAGE_LABEL[r.s]}
            </text>
            <rect x={x0} y={r.y - 9} width={x1 - x0} height={18} fill="#f4f4f1" />
            <rect x={x0} y={r.y - 9} width={Math.max(0, wa)} height={18} fill={bind ? A_COLOR : tint(A_COLOR, 0.55)} />
            <rect x={x0 + Math.max(0, wa)} y={r.y - 9} width={Math.max(0, wb)} height={18} fill={bind ? B_COLOR : tint(B_COLOR, 0.55)} />
            {bind && <rect x={x0 - 1} y={r.y - 10} width={Math.max(2, wa + wb) + 2} height={20} fill="none" stroke="#111" strokeWidth={1.5} />}
            <text x={x0 + Math.max(0, wa + wb) + 6} y={r.y + 4} className={bind ? 'lab' : 'ax'}>
              {describe(r.a, r.b)}
              {bind ? ' · the limit' : ''}
            </text>
          </g>
        );
      })}
      <text x={x0} y={146} className="ax">
        GPUs each stage could support this quarter (bar length in A-class equivalents)
      </text>
    </svg>
  );
}

/** GPUs in service by generation against demand, quarter by quarter. */
function InstalledChart({ qs, cursor, ariaLabel }: { qs: Quarter[]; cursor: number; ariaLabel: string }) {
  const x0 = 64;
  const x1 = 620;
  const n = qs.length;
  const band = (x1 - x0) / n;
  const top = Math.max(...qs.map((q) => Math.max(q.installedAEq, q.demandAEq))) / 1000;
  const [d0, d1] = niceDomain(0, top, 4);
  const y = scale(d0, d1, 196, 26);
  const short = new Set(shortQuarters(qs));
  const demandPath = qs.map((q, i) => `${i ? 'L' : 'M'}${(x0 + i * band).toFixed(1)} ${y(q.demandAEq / 1000).toFixed(1)} L${(x0 + (i + 1) * band).toFixed(1)} ${y(q.demandAEq / 1000).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox="0 0 640 252" role="img" aria-label={ariaLabel}>
      <text className="ax" x={x0} y={12}>
        GPUs in service, millions of A-class equivalents
      </text>
      <rect x={x0 + cursor * band} y={20} width={band} height={176} fill="rgba(0,0,0,.05)" />
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={(v) => fmt(v)} baseline={0} />
      {qs.map((q, i) => {
        const a = q.installed.A / 1000;
        const b = (q.installed.B * A_EQUIVALENT.B) / 1000;
        const bx = x0 + i * band + band * 0.18;
        const bw = band * 0.64;
        return (
          <g key={q.q}>
            <rect x={bx} y={y(a)} width={bw} height={y(0) - y(a)} fill={A_COLOR} opacity={i === cursor ? 1 : 0.75} />
            <rect x={bx} y={y(a + b)} width={bw} height={y(a) - y(a + b)} fill={B_COLOR} opacity={i === cursor ? 1 : 0.75} />
            {short.has(q.q) && (
              <text x={x0 + (i + 0.5) * band} y={Math.min(y(a + b), y(q.demandAEq / 1000)) - 5} className="ax ax-m" style={{ fill: TEXT.red }}>
                short
              </text>
            )}
            <text x={x0 + (i + 0.5) * band} y={214} className={i === cursor ? 'lab' : 'ax'} textAnchor="middle">
              Q{q.q + 1}
            </text>
            <text x={x0 + (i + 0.5) * band} y={230} className="ax ax-m" style={{ fontSize: 10.5 }}>
              {STAGE_SHORT[q.binding]}
            </text>
          </g>
        );
      })}
      <path d={demandPath} fill="none" stroke="#333" strokeWidth={2} strokeDasharray="6 4" />
      <text className="ax" x={x0} y={248} style={{ fontSize: 10.5 }}>
        Bottom row: the stage that limits each quarter (pack = packaging)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: one wafer, its dies and its defects.

export interface WaferState {
  /** Die area, mm². */
  area: number;
  /** Killer defects per cm². */
  defects: number;
  seed: number;
}

export const WAFER_DEFAULTS: WaferState = { area: BUILD.A.dieMm2, defects: 0.1, seed: 1 };

export interface DieCell {
  x: number;
  y: number;
}

const layoutCache = new Map<number, { side: number; dies: DieCell[]; gridCount: number }>();

/**
 * Square dies of the given area on a wafer: the grid offset that fits the most whole dies, keeping
 * the diesPerWafer() closest to the center so the drawing agrees with the count. Coordinates in mm
 * from the wafer's center (top-left corners).
 */
export function waferLayout(areaMm2: number): { side: number; dies: DieCell[]; gridCount: number } {
  const hit = layoutCache.get(areaMm2);
  if (hit) return hit;
  const side = Math.sqrt(areaMm2);
  const r = WAFER_MM / 2;
  const k = Math.ceil(r / side) + 1;
  let best: DieCell[] = [];
  for (const ox of [0, 0.5])
    for (const oy of [0, 0.5]) {
      const cells: DieCell[] = [];
      for (let i = -k; i <= k; i++)
        for (let j = -k; j <= k; j++) {
          const xa = (i - ox) * side;
          const ya = (j - oy) * side;
          const inside = [xa, xa + side].every((cx) => [ya, ya + side].every((cy) => cx * cx + cy * cy <= r * r));
          if (inside) cells.push({ x: xa, y: ya });
        }
      if (cells.length > best.length) best = cells;
    }
  const dist = (c: DieCell) => (c.x + side / 2) ** 2 + (c.y + side / 2) ** 2;
  best.sort((a, b) => dist(a) - dist(b));
  const out = { side, dies: best.slice(0, diesPerWafer(areaMm2)), gridCount: best.length };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(areaMm2, out);
  return out;
}

/** Defect positions on one wafer (mm from center): the expected number for the density, scattered evenly. */
export function waferDefects(defectsPerCm2: number, seed: number): DieCell[] {
  const r = rng(seed * 7919 + 17);
  const count = Math.round(defectsPerCm2 * Math.PI * (WAFER_MM / 20) ** 2);
  const out: DieCell[] = [];
  for (let i = 0; i < count; i++) {
    const rad = (WAFER_MM / 2) * Math.sqrt(r());
    const th = 2 * Math.PI * r();
    out.push({ x: rad * Math.cos(th), y: rad * Math.sin(th) });
  }
  return out;
}

/** Which of a wafer's dies a set of defects spoils. */
export function goodDies(dies: DieCell[], side: number, defects: DieCell[]): boolean[] {
  return dies.map((d) => !defects.some((p) => p.x >= d.x && p.x < d.x + side && p.y >= d.y && p.y < d.y + side));
}

/** The second challenge's target share of good dies. */
export const YIELD_TARGET = 0.6;

/** The second challenge: the A-class's 814 mm² die, and the highest defect density on the slider that still yields 60%. */
export function cleanSolved(area: number, defects: number): boolean {
  const d = Math.round(defects * 100) / 100;
  return area === BUILD.A.dieMm2 && dieYield(d, area) >= YIELD_TARGET && dieYield(d + 0.01, area) < YIELD_TARGET;
}

const GOOD = tint(A_COLOR, 0.7);
const BAD = tint('#e75b55', 0.45);

function WaferView({ w }: { w: WaferState }) {
  const lay = waferLayout(w.area);
  const defects = useMemo(() => waferDefects(w.defects, w.seed), [w.defects, w.seed]);
  const good = goodDies(lay.dies, lay.side, defects);
  const nGood = good.filter(Boolean).length;
  const cx = 168;
  const cy = 166;
  return (
    <svg
      className="diagram"
      viewBox="0 0 600 334"
      role="img"
      aria-label={`A 300 mm wafer with ${lay.dies.length} dies of ${fmt(w.area)} mm² and ${defects.length} defects; ${nGood} of its dies are good.`}
    >
      <circle cx={cx} cy={cy} r={150} fill="#f1f1ee" stroke="#9a9a9a" strokeWidth={1.5} />
      <path d={`M${cx - 6} ${cy + 149.9} L${cx} ${cy + 143} L${cx + 6} ${cy + 149.9} Z`} fill="#fcfcfb" stroke="#9a9a9a" />
      {lay.dies.map((d, i) => (
        <rect key={i} x={cx + d.x + 0.4} y={cy + d.y + 0.4} width={lay.side - 0.8} height={lay.side - 0.8} fill={good[i] ? GOOD : BAD} stroke={good[i] ? A_COLOR : '#c4382f'} strokeWidth={0.6} />
      ))}
      {defects.map((p, i) => (
        <circle key={i} cx={cx + p.x} cy={cy + p.y} r={1.8} fill="#7a1f1a" />
      ))}
      <line x1={cx - 50} x2={cx + 50} y1={326} y2={326} stroke="#555" />
      <line x1={cx - 50} x2={cx - 50} y1={322} y2={330} stroke="#555" />
      <line x1={cx + 50} x2={cx + 50} y1={322} y2={330} stroke="#555" />
      <text x={cx} y={319} className="ax ax-m">
        100 mm
      </text>
      <g transform="translate(350, 70)">
        <rect x={0} y={-10} width={14} height={14} fill={GOOD} stroke={A_COLOR} />
        <text x={22} y={2} className="ax">
          good die
        </text>
        <rect x={0} y={16} width={14} height={14} fill={BAD} stroke="#c4382f" />
        <text x={22} y={28} className="ax">
          spoiled die
        </text>
        <circle cx={7} cy={49} r={2.5} fill="#7a1f1a" />
        <text x={22} y={54} className="ax">
          killer defect
        </text>
        <text x={0} y={96} className="lab" style={{ fontSize: 14 }}>
          This wafer: {nGood} of {lay.dies.length} good
        </text>
        <text x={0} y={118} className="ax">
          {defects.length} defects landed on it
        </text>
        <text x={0} y={140} className="ax">
          die {fmt(lay.side, 1)} × {fmt(lay.side, 1)} mm
        </text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes.

const DEFAULT_QS = runChain(CHAIN_DEFAULTS);
const Q1 = DEFAULT_QS[0];
const Q4 = DEFAULT_QS[3];
const Q6 = DEFAULT_QS[5];
const Q7 = DEFAULT_QS[6];
const Q12 = DEFAULT_QS[QUARTERS - 1];
const FIRST_WAFER_LIMIT = DEFAULT_QS.find((q) => q.binding === 'wafers')!;
const FIRST_POWER_LIMIT = DEFAULT_QS.find((q) => q.binding === 'power')!;
const A_DIES = diesPerWafer(BUILD.A.dieMm2);
const A_YIELD = dieYield(SUPPLY_DEFAULTS.defectsPerCm2, BUILD.A.dieMm2);
const A_PER_WAFER = A_DIES * A_YIELD;
const B_PER_WAFER = (diesPerWafer(BUILD.B.dieMm2) * dieYield(SUPPLY_DEFAULTS.defectsPerCm2, BUILD.B.dieMm2)) / BUILD.B.dies;
const HALF_AREA = 400;
const HALF_DIES = diesPerWafer(HALF_AREA);
const HALF_YIELD = dieYield(SUPPLY_DEFAULTS.defectsPerCm2, HALF_AREA);
const A_SILICON = A_PER_WAFER * BUILD.A.dieMm2;
const HALF_SILICON = HALF_DIES * HALF_YIELD * HALF_AREA;
/** The lithography field: about 26 × 33 mm. */
const RETICLE_MM2 = 26 * 33;
/** The settings that keep supply ahead of demand with the fewest changes: packaging, memory and power. */
export const AHEAD_EXAMPLE: Omit<ChainState, 'quarter'> = { ...CHAIN_DEFAULTS, hbm: 4.0, packaging: 800, power: 1200 };
const AHEAD_QS = runChain(AHEAD_EXAMPLE);
/** GPUs (thousands) the first quarter needs built and switched on to meet demand. */
const Q1_NEEDED = Q1.demandAEq - 1000;

export const LESSON_NUMBERS = {
  aDies: A_DIES,
  aYield: A_YIELD,
  aPerWafer: A_PER_WAFER,
  bPerWafer: B_PER_WAFER,
  bAEq: A_EQUIVALENT.B,
  q1Built: Q1.built.A,
  q1Wafers: Q1.capacity.wafers.A,
  q1Memory: Q1.capacity.memory.A,
  q1Installed: Q1.installedAEq,
  q1Demand: Q1.demandAEq,
  q4Built: Q4.built.A,
  q4Deployed: Q4.deployed.A,
  q4Waiting: Q4.waiting,
  q6Waiting: Q6.waiting,
  q7BuiltA: Q7.built.A,
  q12Installed: Q12.installedAEq,
  q12Demand: Q12.demandAEq,
  firstWaferLimit: FIRST_WAFER_LIMIT.q,
  firstPowerLimit: FIRST_POWER_LIMIT.q,
  halfDies: HALF_DIES,
  halfYield: HALF_YIELD,
  aSilicon: A_SILICON,
  halfSilicon: HALF_SILICON,
  aheadQ12Margin: AHEAD_QS[QUARTERS - 1].installedAEq - AHEAD_QS[QUARTERS - 1].demandAEq,
  q1Needed: Q1_NEEDED,
};

export default function Lesson() {
  const s1 = useScenario('chain', CHAIN_DEFAULTS);
  const st = s1.state;
  const qs = runChain(st);
  const q = qs[Math.min(QUARTERS - 1, Math.max(0, st.quarter))];
  const maxAEq = useMemo(() => Math.max(...qs.flatMap((x) => STAGES.map((s) => stageAEq(x, s)))), [qs]);
  const short = shortQuarters(qs);
  const solvedA = short.length === 0;
  const firstShort = short.length ? qs[short[0]] : null;
  const statusA = firstShort
    ? `Q${firstShort.q + 1} falls short: ${millions(firstShort.installedAEq)} A-class equivalents in service against ${millions(firstShort.demandAEq)} wanted, and ${STAGE_NAME[firstShort.binding]} ${firstShort.binding === 'wafers' ? 'set' : 'sets'} the pace there.`
    : '';
  const builtTotal = q.built.A + q.built.B;
  const deployedTotal = q.deployed.A + q.deployed.B;
  const describeBuilt = (a: number, b: number) => (b > 0.5 ? `${gpus(a)} A-class and ${gpus(b)} B-class` : `${gpus(a)} A-class`);
  const caption =
    q.binding === 'power'
      ? `Q${q.q + 1}: ${describeBuilt(q.built.A, q.built.B)} GPUs built, but new data centers can switch on only ${gpus(deployedTotal)} of the GPUs ready; ${gpus(q.waiting)} wait for power.`
      : `Q${q.q + 1}: ${STAGE_NAME[q.binding]} ${q.binding === 'wafers' ? 'set' : 'sets'} the pace, so ${describeBuilt(q.built.A, q.built.B)} GPUs are built. ${q.installedAEq < q.demandAEq - SHORT_TOLERANCE ? `In service: ${millions(q.installedAEq)} A-class equivalents, short of the ${millions(q.demandAEq)} wanted.` : `In service: ${millions(q.installedAEq)} A-class equivalents, against ${millions(q.demandAEq)} wanted.`}`;

  const s2 = useScenario('wafer', WAFER_DEFAULTS);
  const w = s2.state;
  const n = diesPerWafer(w.area);
  const y = dieYield(w.defects, w.area);
  const solvedB = cleanSolved(w.area, w.defects);
  const statusB =
    w.area !== BUILD.A.dieMm2
      ? `The die is ${fmt(w.area)} mm²; set it to the A-class’s ${fmt(BUILD.A.dieMm2)} mm² first.`
      : y < YIELD_TARGET
        ? `At ${w.defects.toFixed(2)} defects per cm², ${pct(y, 1)} of the dies are good: under 60%.`
        : `At ${w.defects.toFixed(2)} defects per cm², ${pct(y, 1)} are good. Could the factory get away with a few more defects?`;

  return (
    <LessonPage id="compute/5.2">
      <P>
        The previous lesson turned prices into the things buyers actually want — tokens written, training runs finished — and found that an hour of one accelerator can be
        worth a small fraction of an hour of another, or several times as much. What an hour fetches also depends on how many hours there are. At any moment, the supply of
        GPU-hours is just the GPUs installed and switched on, so the question of supply is how GPUs come to be installed. This lesson follows them from bare silicon to a
        powered rack, through a chain of quite different industries, each with a capacity of its own.
      </P>
      <P>
        The scale here is the whole market’s, not one cloud’s, and every quantity is simulated. We count GPUs in thousands a quarter, and capacity in{' '}
        <b>A-class equivalents</b>: an A-class 80 GB counts as one, and a B-class 192 GB, with {fmt(A_EQUIVALENT.B, 2)} times its arithmetic (
        <a href={lessonHref('compute/2.4')}>Lesson 2.4</a>), as {fmt(A_EQUIVALENT.B, 2)}.
      </P>
      <P>
        A GPU begins as a die cut from a silicon wafer {WAFER_MM} mm across. An A-class die is {fmt(BUILD.A.dieMm2)} mm², so {A_DIES} fit on a wafer, and not all of them work. A
        speck of dust or a flaw in any of a die’s billions of transistors (<a href={lessonHref('compute/1.2')}>Lesson 1.2</a>) can kill it, and the bigger the die, the likelier
        it is to catch one. With {fmt(SUPPLY_DEFAULTS.defectsPerCm2, 1)} killer defects per square centimeter, {pct(A_YIELD, 1)} of A-class dies are good:{' '}
        {fmt(A_PER_WAFER, 1)} a wafer. Each good die then needs its memory. The A-class’s 80 GB come in {BUILD.A.hbmStacks} stacks of <K tone="violet">high-bandwidth memory</K>,
        or HBM — DRAM chips (<a href={lessonHref('compute/1.4')}>Lesson 1.4</a>) piled one on another and wired straight through the pile — and a B-class needs{' '}
        {BUILD.B.hbmStacks}. Die and stacks are mounted side by side on a slab of silicon wiring in an <b>advanced package</b>, built on specialized production lines that
        are a capacity of their own. And a finished GPU only becomes supply once a data center switches it on. At about {fmt(BUILD.A.gridKW, 2)} kW of grid power for each
        A-class, once cooling and losses are counted (<a href={lessonHref('compute/4.2')}>Lessons 4.2</a>–<a href={lessonHref('compute/4.3')}>4.3</a>), every new GPU
        needs <K c="power">megawatts</K> that someone must first build and connect.
      </P>
      <P>
        In the next demonstration, the bars at the top are what each stage could support in the quarter you choose, measured in GPUs, and the outlined one is the stage that
        sets the pace. A GPU built in one quarter can be switched on in the next, if there is power for it. The chart follows three years: the GPUs in service, stacked by
        generation in A-class equivalents, against the dashed line of what the market wants. Every stage grows each quarter — wafers and power by 4%, memory by 8%, packaging
        by 10% — while demand grows by 20%. Step through the quarters, then change the stages:
      </P>

      <Figure name="Accelerator Supply Chain" scenario={s1}>
        <StagePanel q={q} maxAEq={maxAEq} />
        <InstalledChart
          qs={qs}
          cursor={q.q}
          ariaLabel={`GPUs in service over twelve quarters, in A-class equivalents, against demand. Quarter 1: ${millions(qs[0].installedAEq)} in service, ${millions(qs[0].demandAEq)} wanted; quarter 12: ${millions(qs[QUARTERS - 1].installedAEq)} in service, ${millions(qs[QUARTERS - 1].demandAEq)} wanted. ${short.length ? `Short in quarters ${short.map((i) => i + 1).join(', ')}.` : 'Never short.'}`}
        />
        <Legend
          items={[
            { label: 'A-class in service', color: A_COLOR },
            { label: `B-class in service (each counts ${fmt(A_EQUIVALENT.B, 2)})`, color: B_COLOR },
            { label: 'Demand', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `built in Q${q.q + 1}`, value: `${gpus(builtTotal)}` },
            { label: 'switched on', value: `${gpus(deployedTotal)}` },
            { label: 'waiting for power', value: `${gpus(q.waiting)}`, tone: q.waiting > 0.5 ? 'red' : undefined },
            { label: 'in service, A-class equivalents', value: millions(q.installedAEq), tone: q.installedAEq < q.demandAEq - SHORT_TOLERANCE ? 'red' : undefined },
          ]}
        />
        <Caption>{caption}</Caption>
        <Slider label="Quarter" value={st.quarter} min={0} max={QUARTERS - 1} onChange={(v) => s1.set({ quarter: v })} display={`Q${st.quarter + 1}, year ${Math.floor(st.quarter / 4) + 1}`} />
        <Slider label="Wafers a quarter" value={st.wafers} min={10} max={60} onChange={(v) => s1.set({ wafers: v })} display={`${fmt(st.wafers)},000`} />
        <Slider label="Killer defects" value={st.defects} min={0.05} max={0.3} step={0.01} onChange={(v) => s1.set({ defects: v })} display={`${st.defects.toFixed(2)} per cm²`} />
        <Slider label="HBM stacks a quarter" tone="violet" value={st.hbm} min={1} max={8} step={0.1} onChange={(v) => s1.set({ hbm: v })} display={`${st.hbm.toFixed(1)} million`} />
        <Slider label="Packages a quarter" value={st.packaging} min={200} max={1500} step={50} onChange={(v) => s1.set({ packaging: v })} display={`${fmt(st.packaging)},000`} />
        <Slider label="New data-center power" tone="red" value={st.power} min={300} max={2000} step={50} onChange={(v) => s1.set({ power: v })} display={`${fmt(st.power)} MW a quarter`} />
        <Slider label="B-class starts" value={st.bStart} min={1} max={QUARTERS - 1} onChange={(v) => s1.set({ bStart: v })} display={`Q${st.bStart + 1}`} />
      </Figure>

      <P>
        In the first quarter, packaging sets the pace. The wafers could supply {gpus(Q1.capacity.wafers.A)} good A-class dies and the memory makers enough stacks for{' '}
        {gpus(Q1.capacity.memory.A)} GPUs, but only {gpus(Q1.capacity.packaging.A)} can be packaged, so {gpus(Q1.built.A)} are built — and a market that wants{' '}
        {millions(Q1.demandAEq)} A-class equivalents has {millions(Q1.installedAEq)}. Packaging grows fastest, though, and by Q{FIRST_POWER_LIMIT.q + 1} the limit has moved to
        the end of the chain: {gpus(Q4.built.A)} GPUs are built, but the new data centers can switch on only {gpus(Q4.deployed.A)}, and {gpus(Q4.waiting)} sit waiting for
        power. By Q{Q6.q + 1}, {gpus(Q6.waiting)} are waiting. A GPU in a warehouse is not supply.
      </P>
      <P>
        Then the B-class arrives. From Q{SUPPLY_DEFAULTS.bStart + 1} it takes a growing share of the same wafers, memory and packaging — {pct(SUPPLY_DEFAULTS.bShareMax)} of them
        within three quarters — and A-class production falls from {gpus(Q4.built.A)} in Q{Q4.q + 1} to {gpus(Q7.built.A)} in Q{Q7.q + 1}. Each B-class needs two large
        dies, so from Q{FIRST_WAFER_LIMIT.q + 1} on, the wafers are the limit. Over the three years the GPUs in service grow from {millions(Q1.installedAEq, 1)} A-class
        equivalents to {millions(Q12.installedAEq, 1)}, but demand compounding at 20% a quarter catches up: in Q{QUARTERS} the market wants {millions(Q12.demandAEq, 1)}.
      </P>

      <Challenge
        id="a"
        question="Keep the GPUs in service at or above what the market wants in every one of the twelve quarters."
        solved={solvedA}
        status={statusA}
        success={`Solved: no quarter falls short, and in Q${QUARTERS} there are ${millions(qs[QUARTERS - 1].installedAEq, 1)} A-class equivalents in service for ${millions(qs[QUARTERS - 1].demandAEq, 1)} wanted. The first quarter is the hard one: it needs ${gpus(Q1_NEEDED)} new GPUs built and switched on at once, so packaging, memory (${BUILD.A.hbmStacks} stacks each, ${fmt((Q1_NEEDED * BUILD.A.hbmStacks) / 1000, 1)} million in all) and power (${fmt(Q1_NEEDED * BUILD.A.gridKW)} MW at ${fmt(BUILD.A.gridKW, 2)} kW each) all have to grow, and fixing any one of them only uncovers the next limit.`}
      />

      <H2>The limit moves</H2>
      <P>
        The challenge can’t be solved by expanding the one stage that is short. Raise packaging alone and the first quarter is still short: the {gpus(Q1.capacity.memory.A)}{' '}
        GPUs that memory now allows need more power than {fmt(SUPPLY_DEFAULTS.powerMW)} MW of new data centers can supply, so power becomes the limit. Add power, and memory
        is the limit. One way through is {fmt(AHEAD_EXAMPLE.hbm, 1)} million stacks, {gpus(AHEAD_EXAMPLE.packaging)} packages and {fmt(AHEAD_EXAMPLE.power)} MW, which
        keeps every quarter covered and leaves {millions(AHEAD_QS[QUARTERS - 1].installedAEq - AHEAD_QS[QUARTERS - 1].demandAEq)} A-class equivalents to spare by Q
        {QUARTERS}. Supply is set by the narrowest stage, and relieving it only reveals the next one.
      </P>
      <P>
        Each stage is a different industry with its own lead time. A new chip factory takes years to build and equip; memory and packaging lines can be added faster, but
        not overnight; and a data center needs its building, its cooling plant and, slowest of all, its grid connection (<a href={lessonHref('compute/4.2')}>Lesson 4.2</a>).
        In recent years packaging, memory and power have each, at one time or another, been widely reported as the stage holding AI accelerators back. Because supply can’t jump when demand
        does, the GPUs that exist must be shared out among everyone who wants them, and in a market, price is what does the sharing — the subject of{' '}
        <a href={lessonHref('compute/5.4')}>Lessons 5.4</a> and <a href={lessonHref('compute/5.5')}>5.5</a>.
      </P>

      <H2>Big dies, few good ones</H2>
      <P>
        Yield is where the physics of a chip meets its cost, and it deserves a closer look. Defects are scattered over a wafer more or less at random, and a die is spoiled if
        even one lands on it, so the share of good dies falls exponentially with the die’s area. In the next demonstration, set the size of a die and the density of
        defects. Each drawing is one wafer, with its own scatter of defects; the readouts are the averages over many:
      </P>

      <Figure name="Accelerator Supply Chain · yield" scenario={s2} actions={<Button onClick={() => s2.set((x) => ({ seed: x.seed + 1 }))}>New wafer</Button>}>
        <WaferView w={w} />
        <Readouts
          items={[
            { label: 'dies per wafer', value: fmt(n) },
            { label: 'good, on average', value: pct(y, 1) },
            { label: 'good dies per wafer', value: fmt(n * y, 1) },
            { label: 'working silicon per wafer', value: `${fmt((n * y * w.area) / 100)} cm²` },
          ]}
        />
        <Eq label="The share of good dies equals e to the minus defect density times die area">
          <span>good share</span>
          <Op>=</Op>
          <span>
            e<Sup>−{w.defects.toFixed(2)} per cm² × {fmt(w.area / 100, 2)} cm²</Sup>
          </span>
          <Op>=</Op>
          <span>{pct(y, 1)}</span>
        </Eq>
        <Slider label="Die area" value={w.area} min={100} max={850} step={2} onChange={(v) => s2.set({ area: v })} display={`${fmt(w.area)} mm²`} />
        <Slider label="Killer defects" value={w.defects} min={0.05} max={0.3} step={0.01} onChange={(v) => s2.set({ defects: v })} display={`${w.defects.toFixed(2)} per cm²`} />
      </Figure>

      <P>
        Shrink the die to {HALF_AREA} mm² and {HALF_DIES} fit, {pct(HALF_YIELD, 1)} of them good: {fmt(HALF_DIES * HALF_YIELD, 1)} good dies, or {fmt(HALF_SILICON)} mm² of
        working silicon per wafer against the A-class’s {fmt(A_SILICON)} — {pct(HALF_SILICON / A_SILICON - 1)} more from the same wafer. A large die pays twice: fewer fit,
        and each is more likely to catch a defect. There is a hard ceiling too. A lithography machine prints a chip one exposure at a time, and its field is about 26 × 33 mm,
        roughly {fmt(RETICLE_MM2)} mm², so no single die can be much bigger than the A-class’s.
      </P>
      <P>
        That is why the B-class joins two dies of {fmt(BUILD.B.dieMm2)} mm² in one package: it gets the arithmetic of a die nearly twice the limit, at the yield of the
        smaller ones. A wafer makes {fmt(B_PER_WAFER, 1)} B-class GPUs on average, against {fmt(A_PER_WAFER, 1)} A-class GPUs — but in arithmetic that is{' '}
        {fmt(B_PER_WAFER * A_EQUIVALENT.B, 1)} A-class equivalents, {pct((B_PER_WAFER * A_EQUIVALENT.B) / A_PER_WAFER - 1)} more from the same wafer.
      </P>

      <Challenge
        id="b"
        question={`Set the die to the A-class’s ${fmt(BUILD.A.dieMm2)} mm², and find the highest defect density at which at least 60% of its dies are good.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: at ${w.defects.toFixed(2)} defects per cm², ${pct(y, 1)} of A-class dies are good, ${fmt(n * y, 1)} a wafer instead of ${fmt(A_PER_WAFER, 1)} at ${fmt(SUPPLY_DEFAULTS.defectsPerCm2, 1)}. A new manufacturing process starts with many defects and improves as the factory learns it, which is one reason the first chips on a new process are scarce and dear.`}
      />

      <H2>Each generation crowds out the last</H2>
      <P>
        A new generation doesn’t add to the old one’s supply; it competes for it. The B-class is built from the same wafers, memory and packaging as the A-class, so in{' '}
        <FigRef to="Accelerator Supply Chain">the first demonstration</FigRef> A-class production all but stops once the B-class ramps. Move the B-class’s start earlier and
        the GPUs in service grow faster in A-class equivalents, because each wafer turned into B-class GPUs carries more arithmetic. Move it later and the A-class keeps the
        lines a while longer.
      </P>
      <P>
        For the owners of A-class GPUs, the arrival is bad news. Their GPUs still work, but the work they do can now be bought more cheaply on a B-class (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>), so what an A-class hour can fetch falls. This is the server-life bet of{' '}
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a> seen from the factory: the useful life of a GPU is set less by when it wears out than by when its successor
        reaches the market in volume, and <a href={lessonHref('compute/6.5')}>Lesson 6.5</a> prices that risk.
      </P>
      <P>
        Supply, then, arrives in lumps, quarters late, through whichever stage is narrowest, and each generation shortens the useful life of the last. The other half of the
        price is demand: who wants these GPU-hours, at what hours of the day and week, and how fast that is growing. That is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
