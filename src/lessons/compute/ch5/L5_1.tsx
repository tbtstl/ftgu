import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
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
  niceDomain,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { unitCost, type UnitCost } from '../../../engines/compute/units';
import { workloadFit } from '../../../engines/compute/compatibility';
import { productivity } from '../../../engines/compute/marketplace';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { PRICES } from '../../../model/compute/prices';
import { WORKLOADS, WORKLOAD_IDS, type WorkloadId } from '../../../model/compute/workloads';
import { PLANNER_DEFAULTS, costOf } from '../ch4/L4_5';

// ---------------------------------------------------------------------------
// The first demonstration: one workload's cost in four units, at three hourly prices.

export type UnitChoice = 'gpuHour' | 'peakPflop' | 'usefulPflop' | 'work';

export interface ExplorerState {
  work: WorkloadId;
  unit: UnitChoice;
  /** Hourly prices, $ per GPU-hour (simulated). */
  pL: number;
  pA: number;
  pB: number;
}

export const EXPLORER_DEFAULTS: ExplorerState = { work: 'chat70', unit: 'gpuHour', pL: PRICES.L.onDemand, pA: PRICES.A.onDemand, pB: PRICES.B.onDemand };

const SHORT: Record<WorkloadId, string> = { chat70: 'Chat', code8: 'Code', batch8: 'Batch', frontier400: 'Frontier', train70: 'Training', tune8: 'Fine-tuning' };

export function pricesOf(s: Pick<ExplorerState, 'pL' | 'pA' | 'pB'>): Record<GpuId, number> {
  return { L: s.pL, A: s.pA, B: s.pB };
}

/** Each accelerator's costs for a workload at the given hourly prices. */
export function costsAt(work: WorkloadId, prices: Record<GpuId, number>): Record<GpuId, UnitCost> {
  return { L: unitCost(work, 'L', prices.L), A: unitCost(work, 'A', prices.A), B: unitCost(work, 'B', prices.B) };
}

/** The value shown for a unit: "work" is $ per million tokens for serving and $ per run for training. */
export function valueIn(c: UnitCost, unit: UnitChoice, work: WorkloadId): number {
  // An accelerator that can't run the work has no price for it in any unit.
  if (!c.feasible) return Infinity;
  if (unit === 'work') return WORKLOADS[work].kind === 'serve' ? c.mTokens : c.run;
  return c[unit];
}

/** The cheapest accelerator in a unit (Infinity values never win). */
export function cheapestIn(work: WorkloadId, unit: UnitChoice, prices: Record<GpuId, number>): GpuId {
  const cs = costsAt(work, prices);
  return GPU_IDS.reduce((a, b) => (valueIn(cs[b], unit, work) < valueIn(cs[a], unit, work) ? b : a));
}

export function unitLabel(unit: UnitChoice, work: WorkloadId): string {
  if (unit === 'gpuHour') return 'per GPU-hour';
  if (unit === 'peakPflop') return 'per peak PFLOP-hour';
  if (unit === 'usefulPflop') return 'per useful PFLOP-hour';
  return WORKLOADS[work].kind === 'serve' ? 'per million tokens' : 'per training run';
}

/** Money with sensible precision for each size of number: tenths of a cent below $1, cents below $100, whole thousands above $100,000. */
export function money(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e6) return `$${fmt(x / 1e6, 2)} million`;
  if (x >= 1e5) return usd(Math.round(x / 1000) * 1000);
  if (x >= 100) return usd(x);
  if (x >= 1) return usd(x, 2);
  return usd(x, 3);
}

/** A value in a unit: hourly prices always in cents; work costs with `money`. */
export function inUnit(x: number, unit: UnitChoice): string {
  if (!Number.isFinite(x)) return '—';
  return unit === 'work' ? money(x) : x >= 100 ? usd(x) : usd(x, 2);
}

/** 2 → "2", 2.571 → "2.57". */
const trim = (x: number) => String(Number(x.toFixed(2)));

/** The challenge's workload and the prices of the other two accelerators. */
export const CHALLENGE_WORK: WorkloadId = 'batch8';

/** Challenge a: with the A- and B-class at their simulated prices, the L-class is the cheapest per million batch tokens. */
export function cheapLSolved(s: Pick<ExplorerState, 'pL' | 'pA' | 'pB'>): boolean {
  const atList = Math.abs(s.pA - PRICES.A.onDemand) < 1e-6 && Math.abs(s.pB - PRICES.B.onDemand) < 1e-6;
  return atList && cheapestIn(CHALLENGE_WORK, 'work', pricesOf(s)) === 'L';
}

/** The L-class price at which it exactly matches the B-class per million batch tokens. */
export function lParityForBatch(): number {
  const l = workloadFit(CHALLENGE_WORK, 'L');
  const b = unitCost(CHALLENGE_WORK, 'B');
  return l.kind === 'serve' ? (b.mTokens * l.tokensPerGpuS * 3600) / 1e6 : Infinity;
}

// ---------------------------------------------------------------------------
// The second demonstration: what an hour is worth to each job, against the A-class.

/** The hourly price at which an accelerator does a whole job for the same cost as A-class GPUs at `pA`. */
export function parityPrice(work: WorkloadId, g: GpuId, pA: number): number {
  return productivity(work, g) * pA;
}

/** Challenge b: the lowest A-class price (5-cent steps) at which a $0.90 L-class hour does some job more cheaply than A-class hours. */
export function lWorthAt(pA: number): boolean {
  return WORKLOAD_IDS.some((w) => parityPrice(w, 'L', pA) >= PRICES.L.onDemand - 1e-9);
}

export const WORTH_STEP = 0.05;

export function lWorthSolved(pA: number): boolean {
  const p = Math.round(pA * 100) / 100;
  return lWorthAt(p) && !lWorthAt(p - WORTH_STEP);
}

// ---------------------------------------------------------------------------
// Numbers for the prose.

const COST45 = costOf(PLANNER_DEFAULTS);
const LIST = { L: PRICES.L.onDemand, A: PRICES.A.onDemand, B: PRICES.B.onDemand };
const CHAT = costsAt('chat70', LIST);
const BATCH = costsAt('batch8', LIST);
const TRAIN = costsAt('train70', LIST);
const runHours = (g: GpuId) => {
  const f = workloadFit('train70', g);
  return f.kind === 'train' && f.run ? f.run.gpuHours : Infinity;
};
const L_PARITY = lParityForBatch();
function tokPerHour(w: WorkloadId, g: GpuId): number {
  const f = workloadFit(w, g);
  return f.kind === 'serve' && f.feasible ? f.tokensPerGpuS * 3600 : 0;
}
const VALUE = (w: WorkloadId, g: GpuId) => parityPrice(w, g, PRICES.A.onDemand);
const B_RATIOS = WORKLOAD_IDS.map((w) => productivity(w, 'B'));
const B_LOW = Math.min(...B_RATIOS);
const B_HIGH = Math.max(...B_RATIOS);
/** The answer to challenge b. */
export const WORTH_ANSWER = (() => {
  for (let p = 1; p <= 4 + 1e-9; p = Math.round((p + WORTH_STEP) * 100) / 100) if (lWorthAt(p)) return p;
  return Infinity;
})();

export const LESSON_NUMBERS = {
  cost45PerHour: COST45.perHour,
  cost45PerUsed: COST45.perUsedHour,
  peak: { L: CHAT.L.peakPflop, A: CHAT.A.peakPflop, B: CHAT.B.peakPflop },
  chatTokens: { L: CHAT.L.mTokens, A: CHAT.A.mTokens, B: CHAT.B.mTokens },
  chatUseful: { L: CHAT.L.usefulPflop, A: CHAT.A.usefulPflop, B: CHAT.B.usefulPflop },
  chatUtil: { L: CHAT.L.utilization, A: CHAT.A.utilization, B: CHAT.B.utilization },
  batchTokens: { L: BATCH.L.mTokens, A: BATCH.A.mTokens, B: BATCH.B.mTokens },
  trainRun: { L: TRAIN.L.run, A: TRAIN.A.run, B: TRAIN.B.run },
  trainHours: { L: runHours('L'), A: runHours('A'), B: runHours('B') },
  trainGpus: { L: workloadFit('train70', 'L').gpus, A: workloadFit('train70', 'A').gpus, B: workloadFit('train70', 'B').gpus },
  chatGpus: { L: workloadFit('chat70', 'L').gpus, A: workloadFit('chat70', 'A').gpus, B: workloadFit('chat70', 'B').gpus },
  chatBatchL: (() => {
    const f = workloadFit('chat70', 'L');
    return f.kind === 'serve' ? f.batch : 0;
  })(),
  batchTokPerHour: { L: tokPerHour('batch8', 'L'), A: tokPerHour('batch8', 'A'), B: tokPerHour('batch8', 'B') },
  lParity: L_PARITY,
  value: {
    chatB: VALUE('chat70', 'B'),
    frontierB: VALUE('frontier400', 'B'),
    tuneB: VALUE('tune8', 'B'),
    chatL: VALUE('chat70', 'L'),
    batchL: VALUE('batch8', 'L'),
    tuneL: VALUE('tune8', 'L'),
  },
  bLow: B_LOW,
  bHigh: B_HIGH,
  worthAnswer: WORTH_ANSWER,
};

// ---------------------------------------------------------------------------
// Figure 1: three bars in the chosen unit.

function UnitBars({ work, unit, costs, cheapest }: { work: WorkloadId; unit: UnitChoice; costs: Record<GpuId, UnitCost>; cheapest: GpuId }) {
  const vals = GPU_IDS.map((g) => valueIn(costs[g], unit, work));
  const finite = vals.filter((v) => Number.isFinite(v));
  const [, max] = niceDomain(0, Math.max(...finite, 1e-9) * 1.05, 4);
  const x0 = 120;
  const x1 = 560;
  const sx = scale(0, max, x0, x1);
  const ticks = niceTicks(0, max, 4);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : max;
  const label = unitLabel(unit, work);
  const tick = (v: number) =>
    max >= 1e6 ? `$${fmt(v / 1e6, step < 1e6 ? 1 : 0)}M` : max >= 1000 ? `$${fmt(v / 1000, step < 1000 ? 1 : 0)}k` : usd(v, step < 1 ? 2 : 0);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 196"
      role="img"
      aria-label={`${WORKLOADS[work].name}, cost ${label}: ${GPU_IDS.map((g, i) => `${ACCELERATORS[g].short} ${Number.isFinite(vals[i]) ? inUnit(vals[i], unit) : 'can’t run it'}`).join(', ')}. Cheapest: ${ACCELERATORS[cheapest].short}.`}
    >
      <text className="ax" x={x0} y={14}>
        {WORKLOADS[work].name}: cost {label}
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={sx(t)} x2={sx(t)} y1={26} y2={164} />
          <text className="ax ax-m" x={sx(t)} y={182}>
            {tick(t)}
          </text>
        </g>
      ))}
      {GPU_IDS.map((g, i) => {
        const y = 34 + i * 44;
        const v = vals[i];
        const best = g === cheapest;
        return (
          <g key={g}>
            <text className="lab" x={x0 - 10} y={y + 15} textAnchor="end">
              {ACCELERATORS[g].short}
            </text>
            <text className="ax ax-e" x={x0 - 10} y={y + 29}>
              {usd(costs[g].gpuHour, 2)} an hour
            </text>
            {Number.isFinite(v) ? (
              <g>
                <rect x={x0} y={y} width={Math.max(1.5, sx(v) - x0)} height={28} fill={GPU_COLOR[g]} opacity={best ? 1 : 0.55} />
                <text x={Math.min(sx(v) + 6, x1 + 4)} y={y + 19} style={{ fontSize: 13, fontWeight: best ? 600 : 500, fill: best ? TEXT.green : '#333' }}>
                  {inUnit(v, unit)}
                  {best ? ' · cheapest' : ''}
                </text>
              </g>
            ) : (
              <text className="ax" x={x0 + 6} y={y + 19}>
                can’t run this work at all
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: what an hour of each accelerator is worth to each job.

function WorthChart({ pA }: { pA: number }) {
  const x0 = 104;
  const x1 = 600;
  const rows = WORKLOAD_IDS.map((w) => ({ w, L: parityPrice(w, 'L', pA), B: parityPrice(w, 'B', pA) }));
  const top = Math.max(8, ...rows.map((r) => r.B));
  const [, max] = niceDomain(0, top, 4);
  const sx = scale(0, max, x0, x1);
  const y0 = 46;
  const dy = 34;
  const yEnd = y0 + dy * (rows.length - 1) + 16;
  const dot = (g: 'L' | 'B', v: number, y: number) => {
    if (v <= 0) return null;
    const bargain = v >= PRICES[g].onDemand - 1e-9;
    return (
      <g>
        <circle cx={sx(v)} cy={y} r={6} fill={bargain ? GPU_COLOR[g] : '#fcfcfb'} stroke={GPU_COLOR[g]} strokeWidth={2} />
        <text
          className="ax"
          x={g === 'B' ? (sx(v) > x1 - 50 ? sx(v) - 10 : sx(v) + 10) : sx(v)}
          y={g === 'B' ? y + 4 : y - 10}
          textAnchor={g === 'B' ? (sx(v) > x1 - 50 ? 'end' : 'start') : 'middle'}
          style={{ fill: '#333' }}
        >
          {usd(v, 2)}
        </text>
      </g>
    );
  };
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${yEnd + 38}`}
      role="img"
      aria-label={`With the A-class at ${usd(pA, 2)} an hour, the price at which an hour of each accelerator does each job for the same cost: ${rows
        .map((r) => `${WORKLOADS[r.w].name}: L-class ${r.L > 0 ? usd(r.L, 2) : 'can’t run it'}, B-class ${usd(r.B, 2)}`)
        .join('; ')}. List prices: L-class ${usd(PRICES.L.onDemand, 2)}, B-class ${usd(PRICES.B.onDemand, 2)}.`}
    >
      <text className="ax" x={x0} y={12}>
        What one hour is worth, measured against A-class hours
      </text>
      {niceTicks(0, max, 4).map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={sx(t)} x2={sx(t)} y1={26} y2={yEnd} />
          <text className="ax ax-m" x={sx(t)} y={yEnd + 16}>
            {usd(t)}
          </text>
        </g>
      ))}
      <line x1={sx(PRICES.L.onDemand)} x2={sx(PRICES.L.onDemand)} y1={26} y2={yEnd} stroke={GPU_COLOR.L} strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1={sx(PRICES.B.onDemand)} x2={sx(PRICES.B.onDemand)} y1={26} y2={yEnd} stroke={GPU_COLOR.B} strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1={sx(pA)} x2={sx(pA)} y1={26} y2={yEnd} stroke={GPU_COLOR.A} strokeWidth={2} />
      <text className="ax" x={sx(pA)} y={24} textAnchor="middle" style={{ fill: TEXT.blue }}>
        A {usd(pA, 2)}
      </text>
      <text className="ax" x={sx(PRICES.B.onDemand)} y={yEnd + 30} textAnchor="middle" style={{ fill: TEXT.teal }}>
        B list
      </text>
      <text className="ax" x={sx(PRICES.L.onDemand)} y={yEnd + 30} textAnchor="middle" style={{ fill: TEXT.gold }}>
        L list
      </text>
      {rows.map((r, i) => {
        const y = y0 + i * dy;
        return (
          <g key={r.w}>
            <text className="lab" x={x0 - 10} y={y + 4} textAnchor="end">
              {WORKLOADS[r.w].name}
            </text>
            <line className="gl" x1={x0} x2={x1} y1={y} y2={y} />
            {r.L > 0 ? dot('L', r.L, y) : (
              <text className="ax" x={x0 + 4} y={y - 8}>
                L can’t run it
              </text>
            )}
            {dot('B', r.B, y)}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const N = LESSON_NUMBERS;
const m2 = (x: number) => usd(x, 2);
const m3 = (x: number) => usd(x, 3);

export default function Lesson() {
  const s1 = useScenario('explorer', EXPLORER_DEFAULTS);
  const st = s1.state;
  const prices = pricesOf(st);
  const costs = useMemo(() => costsAt(st.work, { L: st.pL, A: st.pA, B: st.pB }), [st.work, st.pL, st.pA, st.pB]);
  const cheapest = cheapestIn(st.work, st.unit, prices);
  const byHour = cheapestIn(st.work, 'gpuHour', prices);
  const byWork = cheapestIn(st.work, 'work', prices);
  const serve = WORKLOADS[st.work].kind === 'serve';
  const workLabel = unitLabel('work', st.work);
  const workVal = (g: GpuId) => valueIn(costs[g], 'work', st.work);
  const ratioOut = (() => {
    const worst = GPU_IDS.filter((g) => Number.isFinite(workVal(g))).reduce((a, b) => (workVal(b) > workVal(a) ? b : a));
    return workVal(worst) / workVal(byWork);
  })();
  const caption =
    byHour === byWork
      ? `For the ${WORKLOADS[st.work].name.toLowerCase()}, the ${ACCELERATORS[byHour].short} is cheapest both per GPU-hour and ${workLabel}.`
      : `For the ${WORKLOADS[st.work].name.toLowerCase()}, the ${ACCELERATORS[byHour].short} is the cheapest hour, ${m2(costs[byHour].gpuHour)}, but the ${ACCELERATORS[byWork].short} does the work for least, ${money(workVal(byWork))} ${workLabel}; the dearest costs ${fmt(ratioOut, 1)} times as much.`;

  const solvedA = cheapLSolved(st);
  const atList = Math.abs(st.pA - PRICES.A.onDemand) < 1e-6 && Math.abs(st.pB - PRICES.B.onDemand) < 1e-6;
  const batchNow = costsAt(CHALLENGE_WORK, prices);
  const statusA = !atList
    ? `Set the A-class back to ${m2(PRICES.A.onDemand)} and the B-class to ${m2(PRICES.B.onDemand)} first.`
    : `At ${m2(st.pL)} an hour, the L-class writes a million summary tokens for ${m3(batchNow.L.mTokens)}, against the B-class’s ${m3(batchNow.B.mTokens)} and the A-class’s ${m3(batchNow.A.mTokens)}.`;

  const s2 = useScenario('worth', { pA: PRICES.A.onDemand });
  const pA = s2.state.pA;
  const bVals = WORKLOAD_IDS.map((w) => parityPrice(w, 'B', pA));
  const lVals = WORKLOAD_IDS.map((w) => parityPrice(w, 'L', pA)).filter((v) => v > 0);
  const lBeats = WORKLOAD_IDS.filter((w) => parityPrice(w, 'L', pA) >= PRICES.L.onDemand - 1e-9);
  const solvedB = lWorthSolved(pA);
  const bestL = WORKLOAD_IDS.reduce((a, b) => (parityPrice(b, 'L', pA) > parityPrice(a, 'L', pA) ? b : a));
  const statusB = lBeats.length
    ? `At ${m2(pA)}, an L-class hour at ${m2(PRICES.L.onDemand)} beats A-class hours for the ${lBeats.map((w) => WORKLOADS[w].name.toLowerCase()).join(' and the ')}. Would a lower A-class price still do it?`
    : `At ${m2(pA)}, an L-class hour is worth at most ${m2(parityPrice(bestL, 'L', pA))} to any job (the ${WORKLOADS[bestL].name.toLowerCase()}), short of its ${m2(PRICES.L.onDemand)} price.`;

  const tableRows: Array<{ id: string; label: string; v: (g: GpuId) => number; fmt: (x: number) => string }> = [
    { id: 'gpuHour', label: 'Per GPU-hour', v: (g) => valueIn(costs[g], 'gpuHour', st.work), fmt: (x) => inUnit(x, 'gpuHour') },
    { id: 'peakPflop', label: 'Per peak PFLOP-hour', v: (g) => valueIn(costs[g], 'peakPflop', st.work), fmt: (x) => inUnit(x, 'peakPflop') },
    { id: 'usefulPflop', label: 'Per useful PFLOP-hour', v: (g) => valueIn(costs[g], 'usefulPflop', st.work), fmt: (x) => inUnit(x, 'usefulPflop') },
    { id: 'work', label: serve ? 'Per million tokens' : 'Per training run', v: workVal, fmt: money },
    { id: 'util', label: 'Share of peak used', v: (g) => (costs[g].feasible ? costs[g].utilization : NaN), fmt: (x) => (Number.isFinite(x) ? pct(x, 1) : '—') },
  ];
  const rowBest = (r: (typeof tableRows)[number]) => (r.id === 'util' ? null : GPU_IDS.reduce((a, b) => (r.v(b) < r.v(a) ? b : a)));

  return (
    <LessonPage id="compute/5.1">
      <P>
        Chapter 4 ended with a cost. An air-cooled A-class 80 GB at Tech Park costs {m2(N.cost45PerHour)} for every hour it exists, and, kept 70% busy,{' '}
        {m2(N.cost45PerUsed)} for every hour someone actually uses it (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). This chapter asks how capacity like that becomes an economic resource, with prices that buyers
        and sellers act on. The first question is the simplest-sounding one: what, exactly, is being sold?
      </P>
      <P>
        GPU clouds mostly sell the <K c="price">GPU-hour</K>: one accelerator, in a server, for an hour. In this course an hour on demand costs {m2(PRICES.L.onDemand)} for an
        L-class 48 GB, {m2(PRICES.A.onDemand)} for an A-class and {m2(PRICES.B.onDemand)} for a B-class 192 GB. Those prices are simulated, set a little above the costs of
        Lesson 4.5 and in the range clouds have charged for comparable parts. They also aren’t the price of anything traded in one place. Electricity, in the companion
        course, clears in an auction with a public price every hour; there is no such exchange for GPU-hours. Capacity is sold through providers’ price lists, reserved
        contracts and private deals, with a few marketplaces and price indexes starting to appear.
      </P>
      <P>
        And no buyer wants a GPU-hour for its own sake. The buyer wants replies written, documents summarized, a model trained. Chapter 3 showed that how much of that an hour
        yields depends on both the hardware and the work. So the same three prices can be restated in other units. One is arithmetic at the chip’s peak: a{' '}
        <K tone="orange">PFLOP-hour</K> is a thousand trillion operations a second, kept up for an hour. Another is the arithmetic the work actually uses, the peak times the
        share of it the work reaches. The last is the work itself: a million tokens written, or one whole training run. In the next demonstration, choose a workload and a
        unit, and set each accelerator’s hourly price; the table lists every unit at once:
      </P>

      <Figure name="Compute Economics Explorer" scenario={s1}>
        <Segmented label="Workload" value={st.work} onChange={(work) => s1.set({ work })} options={WORKLOAD_IDS.map((w) => ({ value: w, label: SHORT[w] }))} />
        <Segmented
          label="Unit"
          value={st.unit}
          onChange={(unit) => s1.set({ unit })}
          options={[
            { value: 'gpuHour', label: 'GPU-hour' },
            { value: 'peakPflop', label: 'Peak PFLOP-hour' },
            { value: 'usefulPflop', label: 'Useful PFLOP-hour' },
            { value: 'work', label: serve ? 'Million tokens' : 'Training run' },
          ]}
        />
        <UnitBars work={st.work} unit={st.unit} costs={costs} cheapest={cheapest} />
        <DataTable
          caption={`${WORKLOADS[st.work].name}: cost in every unit on each accelerator`}
          rows={tableRows}
          rowKey={(r) => r.id}
          columns={[
            { label: WORKLOADS[st.work].name, cell: (r) => r.label },
            ...GPU_IDS.map((g) => ({
              label: ACCELERATORS[g].short,
              align: 'right' as const,
              cell: (r: (typeof tableRows)[number]) => {
                const v = r.v(g);
                const text = r.fmt(v);
                return rowBest(r) === g && Number.isFinite(v) ? <b>{text}</b> : text;
              },
            })),
          ]}
        />
        <Slider label="L-class price" tone="green" value={st.pL} min={0.2} max={2} step={0.05} onChange={(v) => s1.set({ pL: v })} display={`${m2(st.pL)} an hour`} />
        <Slider label="A-class price" tone="green" value={st.pA} min={1} max={4} step={0.1} onChange={(v) => s1.set({ pA: v })} display={`${m2(st.pA)} an hour`} />
        <Slider label="B-class price" tone="green" value={st.pB} min={2} max={8} step={0.1} onChange={(v) => s1.set({ pB: v })} display={`${m2(st.pB)} an hour`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with the chat assistant, priced per GPU-hour. The L-class is the cheapest hour by far. Switch to peak PFLOP-hours and the three come out nearly level —{' '}
        {m2(N.peak.L)}, {m2(N.peak.A)} and {m2(N.peak.B)} — because list prices roughly track the arithmetic printed on each part’s specification sheet. Switch to useful
        PFLOP-hours and they fly apart. Serving chat with its batch full, the A-class puts {pct(N.chatUtil.A)} of its peak to work and the B-class {pct(N.chatUtil.B)} (
        <a href={lessonHref('compute/3.2')}>Lesson 3.2</a>), but the L-class only {pct(N.chatUtil.L, 1)}: its slow memory and PCIe links, against the chat assistant’s{' '}
        {fmt(WORKLOADS.chat70.kind === 'serve' ? WORKLOADS.chat70.tpotMax * 1000 : 0)} ms limit per token, hold each copy of the 70B model to a batch of {fmt(N.chatBatchL)} (
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>), so each useful PFLOP-hour costs {money(N.chatUseful.L)}.
      </P>
      <P>
        Now switch to what the chat customer actually pays for: tokens. A million of them cost {m2(N.chatTokens.L)} on the L-class, {m3(N.chatTokens.A)} on the A-class and{' '}
        {m3(N.chatTokens.B)} on the B-class. The cheapest hour writes the dearest tokens, at {fmt(N.chatTokens.L / N.chatTokens.B, 1)} times the B-class’s price, and the dearest hour
        writes the cheapest ones. Batch summarization, which has no latency limit and fills memory instead, narrows the gap without closing it: {m3(N.batchTokens.L)},{' '}
        {m3(N.batchTokens.A)} and {m3(N.batchTokens.B)}. For a training run the unit is the whole job: the 70B model on a trillion tokens, on enough GPUs to finish in 30 days,
        costs {money(N.trainRun.L)} on {fmt(N.trainGpus.L)} L-class GPUs, {money(N.trainRun.A)} on {fmt(N.trainGpus.A)} A-class and {money(N.trainRun.B)} on {fmt(N.trainGpus.B)}{' '}
        B-class at these prices.
      </P>

      <Challenge
        id="a"
        question="Keeping the A-class at $2.40 and the B-class at $4.80 an hour, lower the L-class’s price until it is the cheapest way to run batch summarization, per million tokens."
        solved={solvedA}
        status={statusA}
        success={`Solved. Below about ${m2(N.lParity)} an hour the L-class wins: it writes ${fmt(N.batchTokPerHour.L / 1e6, 2)} million summary tokens an hour against the B-class’s ${fmt(N.batchTokPerHour.B / 1e6, 1)} million, so its hour yields ${pct(N.batchTokPerHour.L / N.batchTokPerHour.B)} of a B-class hour’s tokens — worth ${m2(N.lParity)} at the B-class’s ${m2(PRICES.B.onDemand)}, little more than half the L-class’s own list price.`}
      />

      <H2>What an hour is worth</H2>
      <P>
        The challenge turned the question around: not what an hour costs, but what price would make it a fair trade. We can ask that for every job at once. Lesson 3.5 counted
        the GPUs each job needs on each accelerator: the chat assistant needs {fmt(N.chatGpus.A)} A-class GPUs or {fmt(N.chatGpus.B)} B-class, so a B-class hour does the work
        of {fmt(N.chatGpus.A / N.chatGpus.B, 2)} A-class hours there. Multiply by the A-class’s price and you have the most a buyer running that job should pay for an hour of the
        other accelerator: above it, A-class hours would do the job for less. In the next demonstration, each row is a job and each dot the hourly price at which the L- or
        B-class matches the A-class on it; a filled dot means the accelerator’s list price is at or below that value, so it does the job at least as cheaply. Set the A-class’s
        price:
      </P>

      <Figure name="Compute Economics Explorer · what an hour is worth" scenario={s2}>
        <WorthChart pA={pA} />
        <Legend
          items={[
            { label: 'L-class hour: filled if worth its list price', color: GPU_COLOR.L },
            { label: 'B-class hour: filled if worth its list price', color: GPU_COLOR.B },
            { label: 'A-class price (the yardstick)', color: GPU_COLOR.A, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'a B-class hour is worth', value: `${m2(Math.min(...bVals))}–${m2(Math.max(...bVals))}`, tone: 'green' },
            { label: 'an L-class hour is worth', value: lVals.length ? `${m2(Math.min(...lVals))}–${m2(Math.max(...lVals))}` : '—', tone: 'green' },
            { label: 'jobs where a $0.90 L-class hour beats A-class hours', value: fmt(lBeats.length) },
          ]}
        />
        <Slider label="A-class price" tone="green" value={pA} min={1} max={4} step={WORTH_STEP} onChange={(v) => s2.set({ pA: Math.round(v * 100) / 100 })} display={`${m2(pA)} an hour`} />
      </Figure>

      <P>
        At the A-class’s {m2(PRICES.A.onDemand)}, a B-class hour is worth {m2(N.value.chatB)} to the chat assistant, {m2(N.value.frontierB)} to the frontier assistant and{' '}
        {m2(N.value.tuneB)} to fine-tuning: its list price of {m2(PRICES.B.onDemand)} is a bargain for every job but the last, where it only breaks even. An L-class hour is worth{' '}
        {m2(N.value.chatL)} to the chat assistant, {m2(N.value.batchL)} to batch summarization and {m2(N.value.tuneL)} to fine-tuning, its best case — less, everywhere, than its{' '}
        {m2(PRICES.L.onDemand)} list price. These values differ a little from the per-token costs in{' '}
        <FigRef to="Compute Economics Explorer">the first demonstration</FigRef>, because a job needs whole copies of its model and whole servers, but the verdict is the same.
      </P>
      <P>
        So why would anyone rent an L-class GPU at these prices? Because the A- and B-class hours aren’t always there to be had. In Lesson 3.5’s fleet there weren’t enough of
        them, and batch summarization went to the L-class because nothing better was free. Scarcity raises what the newer hours cost, and the value of the older hours rises with
        it.
      </P>

      <Challenge
        id="b"
        question="Find the lowest A-class price, to the nearest 5 cents, at which an L-class hour at its $0.90 list price does at least one of these jobs more cheaply than A-class hours."
        solved={solvedB}
        status={statusB}
        success={`Solved. At ${m2(N.worthAnswer)} an A-class hour, fine-tuning on L-class cards — ${fmt(workloadFit('tune8', 'L').gpus)} of them in place of ${fmt(workloadFit('tune8', 'A').gpus)} A-class GPUs — becomes the cheaper way to do the job. Five cents lower and no job is worth $0.90 an hour of the L-class. The older card’s value is tied to the price of the newer one, not fixed by its own specifications.`}
      />

      <H2>A unit that won’t stand still</H2>
      <P>
        Every market needs a unit of trade that buyers can treat as interchangeable. A megawatt-hour delivered to a node in the same hour is the same megawatt-hour whoever
        made it, which is what lets the electricity course’s auctions clear on one price per place and hour (Lessons <a href={lessonHref('4.4')}>4.4</a> and{' '}
        <a href={lessonHref('5.3')}>5.3</a> of that course). A
        GPU-hour isn’t like that. Its value depends on the hardware and on the job: across the six jobs here a B-class hour is worth between {trim(N.bLow)} and {trim(N.bHigh)}{' '}
        A-class hours, and an L-class hour anything from nothing at all to about a third of one. It also depends on things this lesson held fixed — where
        the GPU sits, and so how far its users are (<a href={lessonHref('compute/4.3')}>Lesson 4.3</a>), and whether its cluster’s network can carry a training run (
        <a href={lessonHref('compute/4.4')}>Lesson 4.4</a>).
      </P>
      <P>
        That is the deepest reason compute is hard to commoditize. There is no fixed exchange rate between one generation of hardware and the next, so a contract for “GPU-hours”
        has to name the accelerator, the size of the cluster and its network, the place and the term. Some sellers sidestep the problem by selling the work instead: a
        company that serves a model through an interface priced per million tokens has taken on the job of turning hours into tokens, and with it the risk that its hardware
        turns out to be the wrong kind. The rest of this chapter follows that unit, unstable as it is, through the forces that set its price. It starts with supply: in the next
        lesson, where GPUs come from, and why there are never quite enough of them.
      </P>
    </LessonPage>
  );
}
