import { useMemo, type CSSProperties } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { checkAssignment, fitTable, serveFit, workloadFit, type Fit, type ServeFit, type TrainFit } from '../../../engines/compute/compatibility';
import { maxBatch, memoryPlan, servingPoint, type ServeConfig } from '../../../engines/compute/inference';
import { trainingRun } from '../../../engines/compute/training';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { WORKLOADS, WORKLOAD_IDS, type ServingWorkload, type TrainingWorkload, type WorkloadId } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The fleet and the table.

/** The fleet the six workloads must share. */
export const FLEET: Record<GpuId, number> = { L: 64, A: 336, B: 24 };

export type Assignment = Record<WorkloadId, GpuId>;

/** Everything on the workhorse: where the first demonstration starts. */
export const ALL_ON_A: Assignment = { chat70: 'A', code8: 'A', batch8: 'A', frontier400: 'A', train70: 'A', tune8: 'A' };

/** Every workload on every accelerator (computed once; about 5 ms). */
export const TABLE = fitTable(WORKLOAD_IDS);

// The first demonstration's one requirement the reader can change: code completion's limit on time per token.

const CODE = WORKLOADS.code8 as ServingWorkload;
/** Code completion's limit on time per token as the workload defines it, ms. */
export const CODE_MS_DEFAULT = Math.round(CODE.tpotMax * 1000);
export const CODE_MS_MIN = 5;
export const CODE_MS_MAX = 60;

export type FleetState = Assignment & { codeMs: number };
export const FLEET_DEFAULTS: FleetState = { ...ALL_ON_A, codeMs: CODE_MS_DEFAULT };

const tableCache = new Map<number, Record<WorkloadId, Record<GpuId, Fit>>>();

/** The table with code completion held to `codeMs` per token (the other rows don't change; memoized). */
export function tableAt(codeMs: number): Record<WorkloadId, Record<GpuId, Fit>> {
  if (codeMs === CODE_MS_DEFAULT) return TABLE;
  let t = tableCache.get(codeMs);
  if (!t) {
    const w: ServingWorkload = { ...CODE, tpotMax: codeMs / 1000 };
    const code = {} as Record<GpuId, Fit>;
    for (const g of GPU_IDS) code[g] = serveFit(w, g);
    t = { ...TABLE, code8: code };
    tableCache.set(codeMs, t);
  }
  return t;
}

export interface FleetCheck {
  used: Record<GpuId, number>;
  overBy: Record<GpuId, number>;
  /** Every workload has an accelerator that can run it, and no accelerator is over its count. */
  feasible: boolean;
}

/** An assignment checked against the fleet, with code completion held to `codeMs` per token. */
export function fleetCheck(a: Assignment, codeMs = CODE_MS_DEFAULT): FleetCheck {
  const t = tableAt(codeMs);
  const used: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  let runs = true;
  for (const id of WORKLOAD_IDS) {
    const f = t[id][a[id]];
    if (f.feasible) used[a[id]] += f.gpus;
    else runs = false;
  }
  const overBy: Record<GpuId, number> = { L: Math.max(0, used.L - FLEET.L), A: Math.max(0, used.A - FLEET.A), B: Math.max(0, used.B - FLEET.B) };
  return { used, overBy, feasible: runs && overBy.L + overBy.A + overBy.B === 0 };
}

/** Every assignment that fits the fleet with code completion held to `codeMs` per token. */
export function solutionsAt(codeMs: number): Assignment[] {
  const out: Assignment[] = [];
  const rec = (i: number, cur: Partial<Assignment>) => {
    if (i === WORKLOAD_IDS.length) {
      if (fleetCheck(cur as Assignment, codeMs).feasible) out.push({ ...cur } as Assignment);
      return;
    }
    for (const g of GPU_IDS) rec(i + 1, { ...cur, [WORKLOAD_IDS[i]]: g });
  };
  rec(0, {});
  return out;
}

/** The challenge: with the workloads as given, every workload placed on an accelerator that can run it, and no accelerator over its count. */
export function fleetSolved(a: Assignment, codeMs = CODE_MS_DEFAULT): boolean {
  return codeMs === CODE_MS_DEFAULT && fleetCheck(a, codeMs).feasible;
}

export interface CodeSweep {
  /** The tightest limit on the slider that still leaves some assignment, ms. */
  tightestWithAnswer: number;
  /** The loosest limit on the slider with no assignment at all, ms (below `tightestWithAnswer`). */
  noAnswerAt: number;
  /** The tightest limit at which a second assignment appears, ms. */
  secondFrom: number;
  /** The assignment that appears there. */
  second: Assignment;
}

let sweepCache: CodeSweep | null = null;

/** How the number of answers changes as code completion's limit moves across the slider. */
export function codeSweep(): CodeSweep {
  if (sweepCache) return sweepCache;
  const counts: Array<{ ms: number; sols: Assignment[] }> = [];
  for (let ms = CODE_MS_MIN; ms <= CODE_MS_MAX; ms++) counts.push({ ms, sols: solutionsAt(ms) });
  const firstWith = counts.find((c) => c.sols.length > 0)!;
  const none = [...counts].reverse().find((c) => c.ms < firstWith.ms && c.sols.length === 0);
  const two = counts.find((c) => c.ms > CODE_MS_DEFAULT && c.sols.length > 1)!;
  const base = solutionsAt(CODE_MS_DEFAULT)[0];
  const second = two.sols.find((x) => WORKLOAD_IDS.some((id) => x[id] !== base[id]))!;
  sweepCache = { tightestWithAnswer: firstWith.ms, noAnswerAt: none ? none.ms : NaN, secondFrom: two.ms, second };
  return sweepCache;
}

/** GPUs a workload needs on an accelerator (Infinity if it can't run there). */
export function gpusFor(id: WorkloadId, g: GpuId): number {
  return TABLE[id][g].gpus;
}

/** How many times more GPUs one accelerator needs than another for a workload. */
export function ratio(id: WorkloadId, worse: GpuId, better: GpuId): number {
  return gpusFor(id, worse) / gpusFor(id, better);
}

// ---------------------------------------------------------------------------
// Why each number is what it is.

export interface SplitRow {
  tp: number;
  fits: boolean;
  /** Requests the cache has room for. */
  room: number;
  /** Time per token with a single request, s (Infinity if it doesn't fit). */
  oneTpot: number;
  /** Largest batch that meets the workload's limits (0: none does). */
  batch: number;
  /** GPUs needed with this split (Infinity if none works). */
  gpus: number;
}

function serveConfig(w: ServingWorkload, g: GpuId, tp: number): ServeConfig {
  return { model: w.model, gpu: g, tp, precision: w.precision };
}

function meetsLimits(c: ServeConfig, w: ServingWorkload, b: number): boolean {
  const p = servingPoint(c, b, w.input, w.output);
  return p.fits && p.tpot <= w.tpotMax && p.ttft <= w.ttftMax;
}

/** Largest batch a split can run within the workload's latency limits (time per token rises with the batch). */
export function largestBatch(w: ServingWorkload, g: GpuId, tp: number): number {
  const c = serveConfig(w, g, tp);
  const cap = maxBatch(c, w.input + w.output);
  if (cap < 1 || !meetsLimits(c, w, 1)) return 0;
  if (meetsLimits(c, w, cap)) return cap;
  let lo = 1;
  let hi = cap;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meetsLimits(c, w, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Every way of splitting a serving workload over one server's GPUs. */
export function splitRows(w: ServingWorkload, g: GpuId): SplitRow[] {
  return [1, 2, 4, 8].map((tp) => {
    const c = serveConfig(w, g, tp);
    const room = maxBatch(c, w.input + w.output);
    const fits = room >= 1;
    const oneTpot = fits ? servingPoint(c, 1, w.input, w.output).tpot : Infinity;
    const batch = fits ? largestBatch(w, g, tp) : 0;
    const gpus = batch > 0 ? Math.ceil(w.demandTokensPerS / servingPoint(c, batch, w.input, w.output).tokensPerS) * tp : Infinity;
    return { tp, fits, room, oneTpot, batch, gpus };
  });
}

export type Binding = 'too big' | 'too slow' | 'memory' | 'latency' | 'first token' | 'deadline';

/** The requirement that sets a workload's GPU count on an accelerator. */
export function binding(id: WorkloadId, g: GpuId): Binding {
  const w = WORKLOADS[id];
  const f = TABLE[id][g];
  if (w.kind === 'train') return 'deadline';
  const s = f as ServeFit;
  if (!s.feasible) return splitRows(w, g).some((r) => r.fits) ? 'too slow' : 'too big';
  if (s.batch >= (s.point?.maxBatch ?? 0)) return 'memory';
  const next = servingPoint(serveConfig(w, g, s.tp), s.batch + 1, w.input, w.output);
  return next.ttft > w.ttftMax ? 'first token' : 'latency';
}

/** Share of each token's time spent in all-reduces between the GPUs at the chosen split. */
export function linkShare(id: WorkloadId, g: GpuId): number {
  const f = TABLE[id][g];
  if (f.kind !== 'serve' || !f.point) return 0;
  return f.point.step.commS / f.point.step.seconds;
}

// ---------------------------------------------------------------------------
// Display helpers.

const SHORT: Record<WorkloadId, string> = {
  chat70: 'Chat',
  code8: 'Code',
  batch8: 'Batch',
  frontier400: 'Frontier',
  train70: 'Pretraining',
  tune8: 'Fine-tuning',
};

function ms(s: number): string {
  return `${fmt(s * 1000, s < 0.1 ? 1 : 0).replace(/\.0$/, '')} ms`;
}

function gb(bytes: number): string {
  return `${fmt(bytes / 1e9, bytes < 1e11 ? 1 : 0)} GB`;
}

function gpuCount(n: number): string {
  return Number.isFinite(n) ? fmt(n) : '—';
}

/** One line describing what a workload asks for (code completion's limit as the first demonstration sets it). */
function needs(id: WorkloadId, codeMs = CODE_MS_DEFAULT): string {
  const w = id === 'code8' ? { ...CODE, tpotMax: codeMs / 1000 } : WORKLOADS[id];
  if (w.kind === 'train') return `${w.model} · ${w.tokens >= 1e12 ? `${fmt(w.tokens / 1e12)} trillion` : `${fmt(w.tokens / 1e9)} billion`} tokens in ${w.deadlineDays} days`;
  const lim = Number.isFinite(w.tpotMax) ? `≤ ${fmt(w.tpotMax * 1000)} ms per token` : 'no latency limit';
  return `${w.model}${w.precision === 'fp8' ? ' FP8' : ''} · ${lim} · ${fmt(w.demandTokensPerS)} tokens/s`;
}

function reasonShort(f: Fit): string {
  return f.reason?.startsWith('Too big') ? 'doesn’t fit' : 'too slow';
}

// ---------------------------------------------------------------------------
// Figure 1: the assignment table and the fleet bars.

function AssignTable({
  assign,
  table,
  codeMs,
  onPick,
}: {
  assign: Assignment;
  table: Record<WorkloadId, Record<GpuId, Fit>>;
  codeMs: number;
  onPick: (id: WorkloadId, g: GpuId) => void;
}) {
  const cell: CSSProperties = { padding: '4px 6px', textAlign: 'right' };
  return (
    <div className="tbwrap">
      <table className="tb" style={{ tableLayout: 'fixed' }}>
        <caption className="sr-only">GPUs each workload needs on each accelerator. Press a cell to run that workload there.</caption>
        <colgroup>
          <col />
          <col style={{ width: '17%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '17%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Workload</th>
            {GPU_IDS.map((g) => (
              <th key={g} scope="col" style={{ textAlign: 'right' }}>
                <span className="sw" style={{ background: GPU_COLOR[g], marginRight: 6, verticalAlign: '-1px' }} />
                {ACCELERATORS[g].short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WORKLOAD_IDS.map((id) => (
            <tr key={id}>
              <td style={{ whiteSpace: 'normal', paddingRight: 8 }}>
                <div style={{ fontWeight: 500 }}>{WORKLOADS[id].name}</div>
                <div style={{ fontSize: 12, color: '#6f6f6f', lineHeight: 1.35 }}>{needs(id, codeMs)}</div>
              </td>
              {GPU_IDS.map((g) => {
                const f = table[id][g];
                const on = assign[id] === g;
                const ok = f.feasible;
                return (
                  <td key={g} style={cell}>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={!ok}
                      aria-label={ok ? `Run the ${WORKLOADS[id].name.toLowerCase()} on the ${ACCELERATORS[g].short}: ${fmt(f.gpus)} GPUs` : `The ${WORKLOADS[id].name.toLowerCase()} can’t run on the ${ACCELERATORS[g].short}: ${f.reason}`}
                      title={ok ? undefined : f.reason}
                      onClick={() => onPick(id, g)}
                      style={{
                        width: '100%',
                        minHeight: 44,
                        border: on ? `1.5px solid ${GPU_COLOR[g]}` : '1px solid var(--rule-strong)',
                        borderRadius: 6,
                        background: on ? tint(GPU_COLOR[g], 0.28) : 'transparent',
                        font: 'inherit',
                        fontSize: 14,
                        fontWeight: on ? 600 : 400,
                        fontVariantNumeric: 'tabular-nums',
                        color: ok ? 'var(--text)' : '#8a8a8a',
                        cursor: ok ? 'pointer' : 'not-allowed',
                        textAlign: 'right',
                        padding: '0 10px',
                      }}
                    >
                      {ok ? fmt(f.gpus) : <span style={{ fontSize: 12 }}>— {reasonShort(f)}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FleetBars({ used }: { used: Record<GpuId, number> }) {
  const x0 = 150;
  const x1 = 560;
  const rowH = 40;
  const label = GPU_IDS.map((g) => `${ACCELERATORS[g].short}: ${fmt(used[g])} of ${fmt(FLEET[g])} used`).join('; ');
  return (
    <svg className="chart" viewBox={`0 0 640 ${GPU_IDS.length * rowH + 22}`} role="img" aria-label={`GPUs the assignment uses against the fleet. ${label}.`}>
      <text className="ax" x={x0} y={12}>
        GPUs used, against the fleet (each row on its own scale)
      </text>
      {GPU_IDS.map((g, i) => {
        const y = 24 + i * rowH;
        const top = Math.max(used[g], FLEET[g]) * 1.04 || 1;
        const sx = (v: number) => x0 + ((x1 - x0) * v) / top;
        const over = used[g] > FLEET[g];
        return (
          <g key={g}>
            <text className="lab" x={x0 - 10} y={y + 15} textAnchor="end">
              {ACCELERATORS[g].short}
            </text>
            <rect x={x0} y={y + 3} width={sx(FLEET[g]) - x0} height={16} fill="none" stroke="#bdbdb8" strokeWidth={1} />
            <rect x={x0} y={y + 3} width={sx(Math.min(used[g], FLEET[g])) - x0} height={16} fill={GPU_COLOR[g]} opacity={0.85} />
            {over && <rect x={sx(FLEET[g])} y={y + 3} width={sx(used[g]) - sx(FLEET[g])} height={16} fill={GRAPHIC.red} opacity={0.75} />}
            <line x1={sx(FLEET[g])} x2={sx(FLEET[g])} y1={y - 1} y2={y + 23} stroke="#333" strokeWidth={1.5} />
            <text className="ax" x={sx(Math.max(used[g], FLEET[g])) + 6} y={y + 15} style={over ? { fill: TEXT.red } : undefined}>
              {fmt(used[g])} of {fmt(FLEET[g])}
              {over ? ` · ${fmt(used[g] - FLEET[g])} over` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: the requirements behind one cell.

interface Part {
  value: number;
  color: string;
  label: string;
}

function Gauge({ y, title, value, parts, max, limit, limitLabel, over }: { y: number; title: string; value: string; parts: Part[]; max: number; limit?: number; limitLabel?: string; over?: boolean }) {
  const x0 = 170;
  const x1 = 600;
  const sx = (v: number) => x0 + ((x1 - x0) * Math.max(0, v)) / max;
  let acc = 0;
  return (
    <g>
      <text className="lab" x={x0 - 12} y={y + 12} textAnchor="end">
        {title}
      </text>
      <text className="ax ax-e" x={x0 - 12} y={y + 27} style={over ? { fill: TEXT.red } : undefined}>
        {value}
      </text>
      <rect x={x0} y={y} width={x1 - x0} height={20} fill="#f4f4f1" />
      {parts.map((p, i) => {
        const a = sx(acc);
        acc += p.value;
        const w = Math.max(0, Math.min(x1, sx(acc)) - a);
        return (
          <g key={i}>
            <rect x={a} y={y} width={w} height={20} fill={p.color} opacity={0.85} />
            {w > 70 && (
              <text x={a + 6} y={y + 14} style={{ fontSize: 11, fill: '#fff', fontWeight: 500 }}>
                {p.label}
              </text>
            )}
          </g>
        );
      })}
      {limit !== undefined && Number.isFinite(limit) && limit <= max && (
        <g>
          <line x1={sx(limit)} x2={sx(limit)} y1={y - 5} y2={y + 25} stroke="#111" strokeWidth={1.5} strokeDasharray="4 3" />
          <text className="ax" x={Math.min(sx(limit), x1) - 4} y={y + 37} textAnchor="end">
            {limitLabel}
          </text>
        </g>
      )}
    </g>
  );
}

const MEM = GRAPHIC.violet;
const LINK = GRAPHIC.blue;
const ARITH = GRAPHIC.orange;
const FREE = '#d9d9d5';

function ServeGauges({ w, g, f }: { w: ServingWorkload; g: GpuId; f: ServeFit }) {
  const gpu = ACCELERATORS[g];
  if (!f.feasible || !f.point) {
    // Show the most GPUs one server offers against the weights.
    const plan = memoryPlan(serveConfig(w, g, 8));
    const usable = plan.usableBytes;
    const fits = plan.fits;
    const max = Math.max(usable, plan.weightBytes) * 1.05;
    const rows = splitRows(w, g);
    const best = rows.filter((r) => r.fits).sort((a, b) => a.oneTpot - b.oneTpot)[0];
    return (
      <svg className="chart" viewBox={`0 0 640 ${best ? 132 : 56}`} role="img" aria-label={fits ? `The ${w.name.toLowerCase()} fits on the ${gpu.short}, but even one request takes ${best ? ms(best.oneTpot) : '—'} per token, over its ${ms(w.tpotMax)} limit.` : `The ${w.name.toLowerCase()}’s weights, ${gb(plan.weightBytes)}, are more than the ${gb(usable)} that eight ${gpu.short} GPUs can hold.`}>
        <Gauge
          y={16}
          title="Memory of 8 GPUs"
          value={`${gb(plan.weightBytes)} of ${gb(usable)}`}
          over={!fits}
          parts={[{ value: Math.min(plan.weightBytes, usable), color: MEM, label: 'weights' }, ...(fits ? [] : [{ value: plan.weightBytes - usable, color: GRAPHIC.red, label: 'no room' }])]}
          max={max}
          limit={usable}
          limitLabel="usable memory"
        />
        {best && (
          <Gauge
            y={74}
            title="Time per token, 1 request"
            value={ms(best.oneTpot)}
            over
            parts={[{ value: best.oneTpot, color: GRAPHIC.red, label: 'too slow' }]}
            max={Math.max(best.oneTpot, w.tpotMax) * 1.1}
            limit={w.tpotMax}
            limitLabel={`limit ${ms(w.tpotMax)}`}
          />
        )}
      </svg>
    );
  }
  const p = f.point;
  const plan = memoryPlan(serveConfig(w, g, f.tp));
  const cacheUsed = plan.kvBytes * (p.batch / Math.max(1, p.maxBatch));
  const memMax = plan.usableBytes;
  const step = p.step;
  const base = Math.max(step.memoryS, step.computeS);
  const limit = w.tpotMax;
  const tMax = Math.max(step.seconds, Number.isFinite(limit) ? limit : 0) * 1.12;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 132"
      role="img"
      aria-label={`The ${w.name.toLowerCase()} on ${f.tp} ${gpu.short} GPUs per copy, batch ${p.batch}: weights ${gb(plan.weightBytes)} and cache for the batch ${gb(cacheUsed)} of ${gb(memMax)} usable; ${ms(step.seconds)} per token${Number.isFinite(limit) ? ` against a limit of ${ms(limit)}` : ''}, ${pct(step.commS / step.seconds)} of it in all-reduces.`}
    >
      <Gauge
        y={16}
        title={`Memory of ${f.tp} GPU${f.tp > 1 ? 's' : ''}`}
        value={`${gb(plan.weightBytes + cacheUsed)} of ${gb(memMax)}`}
        parts={[
          { value: plan.weightBytes, color: MEM, label: 'weights' },
          { value: cacheUsed, color: tint(MEM, 0.55), label: `cache, ${fmt(p.batch)} requests` },
          { value: Math.max(0, memMax - plan.weightBytes - cacheUsed), color: FREE, label: '' },
        ]}
        max={memMax}
      />
      <Gauge
        y={74}
        title="Time per token"
        value={ms(step.seconds)}
        parts={[
          { value: base, color: step.memoryS >= step.computeS ? MEM : ARITH, label: step.memoryS >= step.computeS ? 'reading memory' : 'arithmetic' },
          { value: step.commS, color: LINK, label: 'all-reduces' },
        ]}
        max={tMax}
        limit={Number.isFinite(limit) ? limit : undefined}
        limitLabel={`limit ${ms(limit)}`}
      />
    </svg>
  );
}

function TrainGauges({ w, g, f }: { w: TrainingWorkload; g: GpuId; f: TrainFit }) {
  const gpu = ACCELERATORS[g];
  const r = f.run!;
  const capacity = gpu.memoryGB;
  const stepMax = r.stepS * 1.05;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 190"
      role="img"
      aria-label={`The ${w.name.toLowerCase()} on ${fmt(f.gpus)} ${gpu.short} GPUs, split ${f.tp} × ${f.pp} × ${fmt(r.dp)}: ${fmt(r.memoryGB, 1)} GB per GPU of ${capacity}; ${fmt(r.days, 1)} days against a deadline of ${w.deadlineDays}.`}
    >
      <Gauge
        y={16}
        title="Memory per GPU"
        value={`${fmt(r.memoryGB, 1)} of ${capacity} GB`}
        parts={[
          { value: r.stateGB, color: MEM, label: 'model state' },
          { value: r.activationGB, color: tint(MEM, 0.55), label: 'activations' },
        ]}
        max={capacity}
      />
      <Gauge
        y={74}
        title="One training step"
        value={`${fmt(r.stepS, 1)} s`}
        parts={[
          { value: r.computeS, color: ARITH, label: 'arithmetic' },
          { value: r.bubbleS, color: FREE, label: 'pipeline idle' },
          { value: r.tpCommS + r.dpCommS, color: LINK, label: 'all-reduces' },
        ]}
        max={stepMax}
      />
      <Gauge
        y={132}
        title="Days to finish"
        value={`${fmt(r.days, 1)} days`}
        parts={[{ value: r.days, color: GRAPHIC.teal, label: `${fmt(f.gpus)} GPUs` }]}
        max={w.deadlineDays * 1.12}
        limit={w.deadlineDays}
        limitLabel={`deadline ${w.deadlineDays} days`}
      />
    </svg>
  );
}

/** The live sentence under the second figure. */
function verdict(id: WorkloadId, g: GpuId): string {
  const w = WORKLOADS[id];
  const f = TABLE[id][g];
  const gpu = ACCELERATORS[g].short;
  const b = binding(id, g);
  if (w.kind === 'train') {
    const t = f as TrainFit;
    const r = t.run!;
    const fewer = trainingRun({ model: w.model, gpu: g, gpus: t.gpus - t.tp * t.pp, tp: t.tp, pp: t.pp, batchTokens: w.batchTokens, seqLen: w.seqLen, tokens: w.tokens });
    return `The deadline sets the count. ${fmt(t.gpus)} GPUs — ${t.tp} sharing each layer, ${t.pp} pipeline stage${t.pp > 1 ? 's' : ''}, ${fmt(r.dp)} copies — finish in ${fmt(r.days, 1)} days at ${pct(r.mfu)} of their peak; one copy fewer would take ${fmt(fewer.days, 1)} days.`;
  }
  if (b === 'too big') return `It doesn’t fit: the weights alone, ${gb(memoryPlan(serveConfig(w, g, 8)).weightBytes)}, are more than eight ${gpu} GPUs can hold.`;
  if (b === 'too slow') return `It fits, but no split meets the ${ms(w.tpotMax)} limit on time per token, even for a single request.`;
  const s = f as ServeFit;
  const share = linkShare(id, g);
  const links = share >= 0.2 ? ` All-reduces between the GPUs take ${pct(share)} of every token’s time.` : '';
  if (b === 'memory')
    return `Memory sets the count: the cache has room for ${fmt(s.batch)} requests on ${s.tp} GPU${s.tp > 1 ? 's' : ''}, and ${Number.isFinite(w.tpotMax) ? 'all of them still meet the limits' : 'with no latency limit, it runs them all'}.${links}`;
  if (b === 'first token') return `The first-token limit sets the count: past ${fmt(s.batch)} requests, prompts take too long to start.${links}`;
  return `Latency sets the count: past ${fmt(s.batch)} requests, each token would take longer than ${ms(w.tpotMax)}, though the cache has room for ${fmt(s.point!.maxBatch)}.${links}`;
}

// ---------------------------------------------------------------------------

const A = ACCELERATORS.A;
const L = ACCELERATORS.L;
const B = ACCELERATORS.B;
const ALL_ON_A_USE = checkAssignment(ALL_ON_A, FLEET);
const CHAT = WORKLOADS.chat70 as ServingWorkload;
const CHAT_L = splitRows(CHAT, 'L');
const CHAT_L4 = CHAT_L.find((r) => r.tp === 4)!;
const CHAT_L8 = CHAT_L.find((r) => r.tp === 8)!;
const CHAT_L8_COMM = servingPoint(serveConfig(CHAT, 'L', 8), 1, CHAT.input, CHAT.output).step.commS;
const CODE_A = TABLE.code8.A as ServeFit;
const BATCH = TABLE.batch8 as Record<GpuId, ServeFit>;
const FRONT = WORKLOADS.frontier400 as ServingWorkload;
const FRONT_L = memoryPlan(serveConfig(FRONT, 'L', 8));
const TRAIN = TABLE.train70 as Record<GpuId, TrainFit>;
/** How many times fewer GPUs the B-class needs than the A-class, across the six workloads. */
const B_GAIN = WORKLOAD_IDS.map((id) => ratio(id, 'A', 'B'));
const L_LOSS = WORKLOAD_IDS.filter((id) => TABLE[id].L.feasible).map((id) => ratio(id, 'L', 'A'));
/** The A-class GPUs left for everything but training, and what the other five would need there. */
const A_AFTER_TRAIN = FLEET.A - TRAIN.A.gpus;
const OTHERS_ON_A = WORKLOAD_IDS.filter((id) => id !== 'train70').reduce((s, id) => s + gpusFor(id, 'A'), 0);
/** A-class GPUs freed for each B-class GPU a workload takes when it moves from the A-class to the B-class. */
const freedPerB = (id: WorkloadId) => ratio(id, 'A', 'B');

export const LESSON_NUMBERS = {
  allOnA: ALL_ON_A_USE.used.A,
  allOnAOver: ALL_ON_A_USE.overBy.A,
  bGainMin: Math.min(...B_GAIN),
  bGainMax: Math.max(...B_GAIN),
  lLossMin: Math.min(...L_LOSS),
  lLossMax: Math.max(...L_LOSS),
  chatL4OneTpot: CHAT_L4.oneTpot,
  chatL8OneTpot: CHAT_L8.oneTpot,
  chatL8Comm: CHAT_L8_COMM,
  chatL8Batch: CHAT_L8.batch,
  frontierWeights: FRONT_L.weightBytes,
  frontierUsableL: FRONT_L.usableBytes,
  aAfterTrain: A_AFTER_TRAIN,
  othersOnA: OTHERS_ON_A,
};

export default function Lesson() {
  const s1 = useScenario('assign', FLEET_DEFAULTS);
  const { codeMs, ...assign } = s1.state;
  const table = tableAt(codeMs);
  const check = fleetCheck(assign, codeMs);
  const solved = fleetSolved(assign, codeMs);
  const overList = GPU_IDS.filter((g) => check.overBy[g] > 0).map((g) => `the ${ACCELERATORS[g].short} by ${fmt(check.overBy[g])}`);
  const overText = overList.length ? `This assignment overruns ${overList.join(' and ')}.` : 'Every workload has an accelerator.';
  const codeChanged = codeMs !== CODE_MS_DEFAULT;
  const status = codeChanged ? `Code completion is held to ${codeMs} ms per token. Set it back to ${CODE_MS_DEFAULT} ms: the challenge is for the workloads as given.` : overText;
  const caption = check.feasible
    ? `All six workloads run, on ${fmt(check.used.L)} L-class, ${fmt(check.used.A)} A-class and ${fmt(check.used.B)} B-class GPUs${codeChanged ? `, with code completion held to ${codeMs} ms per token` : ''}.`
    : `${overText} Move a workload to another accelerator${codeChanged ? ', or change code completion’s limit' : ''}.`;
  const sweep = useMemo(() => codeSweep(), []);

  const s2 = useScenario('why', { workload: 'chat70' as WorkloadId, gpu: 'L' as GpuId });
  const wid = s2.state.workload;
  const g2 = s2.state.gpu;
  const w2 = WORKLOADS[wid];
  const f2 = workloadFit(wid, g2);
  const rows = w2.kind === 'serve' ? splitRows(w2, g2) : [];
  const chosenTp = f2.kind === 'serve' && f2.feasible ? f2.tp : 0;

  return (
    <LessonPage id="compute/3.5">
      <P>
        The previous lesson kept one copy of the 70B model busy without letting its queue run away. Every lesson of this chapter has taken one kind of work and asked
        what it needs from a GPU: the 8B model reading a prompt, the 70B model writing to hundreds of people at once, a training run spread over a
        thousand GPUs. A real GPU cloud is asked for all of them at the same time, on whatever hardware it happens to own. This lesson puts six workloads side by side
        on the course’s three accelerators and asks what it takes to run them together on one fleet.
      </P>
      <P>
        Four of the six serve a model. The <b>chat assistant</b> runs the 70B model, with 1,000-token prompts and 300-token replies, and keeps the promise of
        Lessons <a href={lessonHref('compute/3.2')}>3.2</a> and <a href={lessonHref('compute/3.4')}>3.4</a>: each token of a reply within {ms(CHAT.tpotMax)},
        and the first within {fmt(CHAT.ttftMax, 1)} s. At its busiest it needs {fmt(CHAT.demandTokensPerS)} tokens a second. <b>Code completion</b> runs the 8B model and is far
        stricter — {ms((WORKLOADS.code8 as ServingWorkload).tpotMax)} per token, and its first suggestion within{' '}
        {fmt((WORKLOADS.code8 as ServingWorkload).ttftMax, 1)} s, or the programmer has typed past it. <b>Batch summarization</b> runs the same 8B model overnight with
        no latency limit at all. The <b>frontier assistant</b> serves the 400B model, its weights stored in FP8 to save memory. The other two train: a{' '}
        <b>pretraining run</b> of the 70B model on a trillion tokens in 30 days, and a <b>fine-tuning job</b> on the 8B model, 50 billion tokens in 5 days. The demand
        figures are simulated, but the requirements behind them are the ones the last four lessons measured.
      </P>
      <P>
        For every pairing of workload and accelerator, the engines of those lessons find the best way to run it. For serving, that means the best way to split the
        model across one server’s GPUs and the largest batch that still meets the latency limits (<a href={lessonHref('compute/3.2')}>Lesson 3.2</a>); for training,
        the fewest GPUs, split the best way, that finish in time (<a href={lessonHref('compute/3.3')}>Lesson 3.3</a>). The result is a count of GPUs — a lower bound, since it assumes every copy of a model
        runs at its steady best, with none of the headroom that <a href={lessonHref('compute/3.4')}>Lesson 3.4</a> showed a real service needs. The fleet has{' '}
        {fmt(FLEET.L)} {L.name}, {fmt(FLEET.A)} {A.name} and {fmt(FLEET.B)} {B.name} GPUs. In the next demonstration, each row is a workload and each cell the GPUs
        it would need on that accelerator. Press a cell to run the workload there; the bars compare what the assignment uses with what the fleet has, and the
        slider sets code completion’s limit on time per token — leave it at {CODE_MS_DEFAULT} ms for now. Everything starts on the A-class, the workhorse:
      </P>

      <Figure name="GPU Compatibility Optimizer" scenario={s1}>
        <AssignTable assign={assign} table={table} codeMs={codeMs} onPick={(id, g) => s1.set({ [id]: g } as Partial<FleetState>)} />
        <FleetBars used={check.used} />
        <Slider
          label="Code completion’s limit per token"
          tone="teal"
          value={codeMs}
          min={CODE_MS_MIN}
          max={CODE_MS_MAX}
          onChange={(v) => s1.set({ codeMs: v })}
          display={`${codeMs} ms`}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        It doesn’t fit. On the A-class alone the six workloads need {fmt(LESSON_NUMBERS.allOnA)} GPUs, {fmt(LESSON_NUMBERS.allOnAOver)} more than the fleet has,
        while the other two accelerators sit idle. Read the table across a row and the three accelerators look very different. For every workload the {B.short} gets by with{' '}
        {fmt(100 / LESSON_NUMBERS.bGainMax)}–{fmt(100 / LESSON_NUMBERS.bGainMin)}% as many GPUs as the {A.short}, as its memory, bandwidth and links would suggest (<a href={lessonHref('compute/2.4')}>Lesson 2.4</a>). The {L.short}, where it can run the work at all, needs between{' '}
        {fmt(LESSON_NUMBERS.lLossMin, 1)} and {fmt(LESSON_NUMBERS.lLossMax)} times as many. And one cell is empty: the frontier assistant can’t run on the {L.short} at
        any count.
      </P>

      <Challenge
        id="a"
        question={`Assign every workload to an accelerator so that all six run within the fleet: ${fmt(FLEET.L)} L-class, ${fmt(FLEET.A)} A-class and ${fmt(FLEET.B)} B-class GPUs.`}
        solved={solved}
        status={status}
        success={`Solved — and at these steady, best-case counts, it’s the only assignment that works; with the headroom of Lesson 3.4, the fleet would be tighter still. The pretraining run takes ${fmt(TRAIN.A.gpus)} A-class GPUs, the chat and frontier assistants share ${fmt(gpusFor('chat70', 'B') + gpusFor('frontier400', 'B'))} of the 24 B-class GPUs, batch summarization fills all 64 L-class GPUs exactly, and code completion and fine-tuning take ${fmt(gpusFor('code8', 'A') + gpusFor('tune8', 'A'))} more A-class GPUs: ${fmt(check.used.A)} of 336.`}
      />

      <H2>What sets each number</H2>
      <P>
        Each count comes from whichever requirement runs out first, and it isn’t the same requirement everywhere. In the next demonstration, choose a workload and an
        accelerator to see which. For serving, the table lists every way of splitting the model over a server’s GPUs — how many requests the cache has room for, if
        the weights fit at all, the time per token for a request alone, the largest batch within the limits, and the GPUs needed — and the bars show the chosen
        split’s memory and its time per token against the limit. For training, the bars show memory per GPU, one training step, and the days to finish:
      </P>

      <Figure name="GPU Compatibility Optimizer · requirements" scenario={s2}>
        <Segmented label="Workload" value={wid} onChange={(v) => s2.set({ workload: v })} options={WORKLOAD_IDS.map((id) => ({ value: id, label: SHORT[id] }))} />
        <Segmented label="Accelerator" value={g2} onChange={(v) => s2.set({ gpu: v })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].short }))} />
        {w2.kind === 'serve' ? <ServeGauges w={w2} g={g2} f={f2 as ServeFit} /> : <TrainGauges w={w2} g={g2} f={f2 as TrainFit} />}
        {w2.kind === 'serve' && (
          <>
            <Legend
              items={[
                { label: 'Weights, and time reading memory', color: MEM },
                { label: 'Cache', color: tint(MEM, 0.55) },
                { label: 'Arithmetic', color: ARITH },
                { label: 'All-reduces', color: LINK },
              ]}
            />
            <DataTable
              caption={`Every way of splitting the ${w2.name.toLowerCase()} over one server of ${ACCELERATORS[g2].short} GPUs`}
              rows={rows}
              rowKey={(r) => r.tp}
              rowClass={(r) => (r.tp === chosenTp ? 'hl' : !r.fits || r.batch === 0 ? 'dim' : '')}
              columns={[
                { label: 'GPUs per copy', cell: (r) => (r.tp === chosenTp ? `${r.tp}, chosen` : String(r.tp)) },
                { label: 'Room', cell: (r) => (r.fits ? fmt(r.room) : 'doesn’t fit'), align: 'right' },
                { label: 'Token, alone', cell: (r) => (r.fits ? ms(r.oneTpot) : '—'), align: 'right' },
                { label: 'Batch', cell: (r) => (r.batch > 0 ? fmt(r.batch) : '—'), align: 'right' },
                { label: 'GPUs', cell: (r) => gpuCount(r.gpus), align: 'right' },
              ]}
            />
          </>
        )}
        {w2.kind === 'train' && (
          <Legend
            items={[
              { label: 'Model state', color: MEM },
              { label: 'Activations', color: tint(MEM, 0.55) },
              { label: 'Arithmetic', color: ARITH },
              { label: 'Pipeline idle', color: FREE },
              { label: 'All-reduces', color: LINK },
              { label: 'Days', color: GRAPHIC.teal },
            ]}
          />
        )}
        <Caption>{verdict(wid, g2)}</Caption>
      </Figure>

      <P>
        It starts on the chat assistant and the {L.short}, the starkest cell in the table. The 70B model’s {gb(memoryPlan(serveConfig(CHAT, 'L', 1)).weightBytes)} of
        weights don’t fit on one or two of its 48 GB cards. On four they fit, but each card reads its share of the weights from{' '}
        <K tone="violet">graphics memory</K> at {fmt(L.bandwidthTBs, 2)} TB/s, so even a single request takes {ms(LESSON_NUMBERS.chatL4OneTpot)} per token — over the{' '}
        {ms(CHAT.tpotMax)} limit before any batching. On eight, a lone request takes {ms(LESSON_NUMBERS.chatL8OneTpot)}, and{' '}
        {ms(LESSON_NUMBERS.chatL8Comm)} of that is spent in all-reduces between cards that can only reach one another through PCIe{' '}
        (<a href={lessonHref('compute/2.5')}>Lesson 2.5</a>). Only {fmt(LESSON_NUMBERS.chatL8Batch)} requests can share a step before each token takes longer than{' '}
        {ms(CHAT.tpotMax)}, so serving the assistant’s demand takes {fmt(gpusFor('chat70', 'L'))} cards, {fmt(ratio('chat70', 'L', 'A'))} times the{' '}
        {A.short}’s {fmt(gpusFor('chat70', 'A'))}. The latency limit sets the count, and what runs into it is <K tone="violet">bandwidth</K> and{' '}
        <K tone="blue">links</K> together.
      </P>
      <P>
        Elsewhere other things bind. Code completion is limited by <K tone="teal">latency</K> on every accelerator: on the {A.short}, the cache has room for{' '}
        {fmt(CODE_A.point!.maxBatch)} requests, but past {fmt(CODE_A.batch)} each token would take longer than{' '}
        {ms((WORKLOADS.code8 as ServingWorkload).tpotMax)}. Batch summarization has no latency limit, so it runs as many requests as the cache can hold —{' '}
        {fmt(BATCH.L.batch)} on the {L.short}, {fmt(BATCH.A.batch)} on the {A.short}, {fmt(BATCH.B.batch)} on the {B.short} — and <K tone="violet">memory</K> sets
        its count. The frontier assistant’s FP8 weights, {gb(FRONT_L.weightBytes)}, are more than the {gb(FRONT_L.usableBytes)} that a full server of {L.short}{' '}
        cards can use; on the {A.short} the model needs all eight GPUs of a server, and all-reduces take {pct(linkShare('frontier400', 'A'))} of every token’s time.
        The two training jobs are set by their deadlines: the pretraining run needs {fmt(TRAIN.A.gpus)} {A.short} GPUs, {fmt(TRAIN.B.gpus)} {B.short} GPUs, or{' '}
        {fmt(TRAIN.L.gpus)} {L.short} cards, whose slower arithmetic and slow links add up to {fmt(ratio('train70', 'L', 'A'), 1)} times the {A.short}’s count.
      </P>

      <H2>Comparative advantage</H2>
      <P>
        The puzzle in the <FigRef to="GPU Compatibility Optimizer">first demonstration</FigRef> has one answer, and it can be found by reasoning rather than search.
        Start with the pretraining run, the largest job. On the {B.short} it would need {fmt(TRAIN.B.gpus)} GPUs, more than five times the fleet’s 24, and on the{' '}
        {L.short} {fmt(TRAIN.L.gpus)}, so it must take {fmt(TRAIN.A.gpus)} of the {fmt(FLEET.A)} {A.short} GPUs. That leaves {fmt(LESSON_NUMBERS.aAfterTrain)} for
        the other five workloads, which would need {fmt(LESSON_NUMBERS.othersOnA)} there, so the two scarce accelerators have to take over work worth at least{' '}
        {fmt(LESSON_NUMBERS.othersOnA - LESSON_NUMBERS.aAfterTrain)} {A.short} GPUs.
      </P>
      <P>
        The {B.short} is better than the {A.short} at everything, so the question isn’t what it does well but where its advantage is largest. Moved to the{' '}
        {B.short}, the frontier assistant frees {fmt(freedPerB('frontier400'), 1)} {A.short} GPUs for every {B.short} GPU it takes; the chat assistant and batch
        summarization free {fmt(freedPerB('chat70'), 2)} each. The {L.short} is worse at everything, so the question there is where it is least worse. Economists
        call this comparative advantage: even a resource that is worse at everything is relatively least bad at something, and that is where it belongs. The{' '}
        {L.short} needs {fmt(ratio('chat70', 'L', 'A'))} times the {A.short}’s count for the chat assistant, but only {fmt(ratio('batch8', 'L', 'A'), 1)} times for
        batch summarization and {fmt(ratio('tune8', 'L', 'A'), 1)} times for fine-tuning — small-model work with no strict deadline on any one token.
      </P>
      <P>
        Fine-tuning is the {L.short}’s best ratio, but taking it would leave {fmt(FLEET.L - gpusFor('tune8', 'L'))} of the 64 cards with nothing else they could
        run, while batch summarization fills them exactly and frees {fmt(gpusFor('batch8', 'A'))} {A.short} GPUs instead of {fmt(gpusFor('tune8', 'A'))}. That
        leaves the {B.short} for the two big models: the frontier assistant, where its advantage is largest, and the chat assistant, which together take{' '}
        {fmt(gpusFor('chat70', 'B') + gpusFor('frontier400', 'B'))} of the 24. Ratios point the way, but the lumps decide it: each workload takes a whole block of GPUs, and
        the blocks have to fit. GPU clouds reason the same way, keeping their newest, best-connected accelerators for the work only they can do and moving tolerant work
        onto older or cheaper hardware.
      </P>
      <P>
        Is that one answer a fact about the hardware, or an accident of the numbers? Test it with code completion’s limit in the{' '}
        <FigRef to="GPU Compatibility Optimizer">first demonstration</FigRef>. At {CODE_MS_DEFAULT} ms a token, the {L.short} needs{' '}
        {fmt(gpusFor('code8', 'L'))} cards for code completion, {fmt(ratio('code8', 'L', 'A'))} times the {A.short}’s {fmt(gpusFor('code8', 'A'))}: reading the
        weights from its slow memory takes most of each step, so few requests can share one. Loosen the limit to {sweep.secondFrom} ms and it needs{' '}
        {fmt(tableAt(sweep.secondFrom).code8.L.gpus)}, exactly the fleet’s, and a second answer appears: code completion on the {L.short}, batch summarization on
        the {A.short}. Tighten it to {sweep.noAnswerAt} ms and there is none, since code completion then needs {fmt(tableAt(sweep.noAnswerAt).code8.A.gpus)}{' '}
        {A.short} GPUs or {fmt(tableAt(sweep.noAnswerAt).code8.B.gpus)} {B.short} GPUs, and no arrangement of the others frees that many. The answer comes from
        what each workload asks of memory, bandwidth and links, and what each accelerator has.
      </P>

      <H2>An hour isn’t one thing</H2>
      <P>
        The table shows why compute is hard to sell as a single commodity. An hour on the {L.short} is worth something to batch summarization and almost nothing to
        the chat assistant; an hour on the {B.short} can do work no {L.short} hour can do at any price. What an hour of one accelerator is worth depends on which
        work wants it and what that work’s next-best option would cost. Where the GPUs are matters too: code completion tolerates a round trip of only{' '}
        {fmt(WORKLOADS.code8.maxRttMs)} ms to its users, so a GPU far away can’t serve it however idle it is — a limit the table leaves out, and one{' '}
        <a href={lessonHref('compute/6.3')}>Lesson 6.3</a> takes up. A market for capacity, which{' '}
        <a href={lessonHref('compute/5.5')}>Chapter 5</a> builds, has to price each kind of accelerator, in each place, separately.
      </P>
      <P>
        So far we’ve taken the fleet as given. But every one of these GPUs has to be bought, installed, powered and cooled, and the counts a data center can hold are
        limited by much more than money. The next chapter turns to the buildings: starting in <a href={lessonHref('compute/4.1')}>Lesson 4.1</a> with how GPUs are
        packed into servers and racks.
      </P>
    </LessonPage>
  );
}
