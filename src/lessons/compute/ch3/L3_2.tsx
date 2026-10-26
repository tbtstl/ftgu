import { useMemo } from 'react';
import {
  Caption,
  Challenge,
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
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { BANDWIDTH_EFFICIENCY, decodeStep, maxBatch, memoryPlan, prefillS, servingPoint, tensorParallelS, type ServeConfig, type ServingPoint } from '../../../engines/compute/inference';
import type { Precision } from '../../../engines/compute/roofline';
import { ACCELERATORS, type GpuId } from '../../../model/compute/hardware';
import { MODELS, kvBytesPerToken, type ModelId } from '../../../model/compute/models';
import { WORKLOADS, type ServingWorkload } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The model: one copy of a language model on `tp` GPUs of one server, serving a batch of requests.

export interface ServeState {
  model: ModelId;
  gpu: GpuId;
  tp: number;
  precision: Precision;
  /** Batch slider position: the batch is 2^batchExp, rounded. */
  batchExp: number;
  /** Prompt length, tokens. */
  input: number;
  /** Reply length, tokens. */
  output: number;
}

export const SERVE_DEFAULTS: ServeState = { model: '70B', gpu: 'A', tp: 4, precision: 'bf16', batchExp: 0, input: 1000, output: 300 };
export const BATCH_EXP_MAX = 10;
export const BATCH_EXP_STEP = 0.25;
/** The challenge's limit on the time between a user's tokens, s: the chat assistant's promise, kept through Lessons 3.4 and 3.5. */
export const TPOT_LIMIT = (WORKLOADS.chat70 as ServingWorkload).tpotMax;
export const LIMIT_DEFAULTS = { limitMs: 20 };

/** The batch the slider asks for. */
export function requestedBatch(batchExp: number): number {
  return Math.max(1, Math.round(2 ** batchExp));
}

export function configOf(s: Pick<ServeState, 'model' | 'gpu' | 'tp' | 'precision'>): ServeConfig {
  return { model: s.model, gpu: s.gpu, tp: s.tp, precision: s.precision };
}

export interface ServeRun {
  config: ServeConfig;
  /** The weights fit, with room for at least one request's cache. */
  fits: boolean;
  /** The weights alone fit. */
  weightsFit: boolean;
  requested: number;
  /** The batch actually run: the request, capped by the memory left for the cache. */
  batch: number;
  maxBatch: number;
  capped: boolean;
  point: ServingPoint;
  /** Per-GPU memory, GB. */
  weightsGB: number;
  cacheGB: number;
  reserveGB: number;
  capacityGB: number;
  /** Split of the step's memory time between weights and cache, s. */
  weightReadS: number;
  cacheReadS: number;
  prefill: number;
}

/** Everything the first demonstration shows, for a state. */
export function runServe(s: ServeState): ServeRun {
  const config = configOf(s);
  const g = ACCELERATORS[s.gpu];
  const plan = memoryPlan(config);
  const mb = maxBatch(config, s.input + s.output);
  const requested = requestedBatch(s.batchExp);
  const batch = Math.max(0, Math.min(requested, mb));
  const point = servingPoint(config, Math.max(1, requested), s.input, s.output);
  const kv = kvBytesPerToken(MODELS[s.model]);
  const step = point.fits ? point.step : decodeStep(config, 1, s.input + s.output / 2);
  const cacheReadBytes = Math.max(0, step.bytes - plan.weightBytes);
  return {
    config,
    fits: plan.fits && mb >= 1,
    weightsFit: plan.fits,
    requested,
    batch,
    maxBatch: mb,
    capped: requested > mb && mb >= 1,
    point,
    weightsGB: plan.weightBytes / s.tp / 1e9,
    cacheGB: (batch * (s.input + s.output) * kv) / s.tp / 1e9,
    reserveGB: g.memoryGB * 0.1,
    capacityGB: g.memoryGB,
    weightReadS: step.memoryS * (plan.weightBytes / step.bytes),
    cacheReadS: step.memoryS * (cacheReadBytes / step.bytes),
    prefill: prefillS(config, s.input),
  };
}

/** Challenge a: the 400B model running with its weights in BF16. */
export function bf16FrontierSolved(s: ServeState): boolean {
  return s.model === '400B' && s.precision === 'bf16' && runServe(s).fits;
}

/** Batches the slider can reach, capped by memory. */
function sliderBatches(mb: number): number[] {
  const out = new Set<number>();
  for (let e = 0; e <= BATCH_EXP_MAX + 1e-9; e += BATCH_EXP_STEP) out.add(Math.min(mb, requestedBatch(e)));
  return [...out].filter((b) => b >= 1);
}

export interface Cheapest {
  tp: number;
  batch: number;
  gpuHoursPerM: number;
  tpot: number;
}

/**
 * Challenge b: the fewest GPU-hours per million output tokens for the 70B model on A-class GPUs in
 * BF16, with the chat assistant's prompts and replies, while every user gets a token at least every
 * TPOT_LIMIT (40 ms) — over every split and every batch the slider can reach.
 */
export function cheapestA40(input = 1000, output = 300): Cheapest {
  let best: Cheapest = { tp: 0, batch: 0, gpuHoursPerM: Infinity, tpot: 0 };
  for (const tp of [1, 2, 4, 8]) {
    const c: ServeConfig = { model: '70B', gpu: 'A', tp, precision: 'bf16' };
    const mb = maxBatch(c, input + output);
    for (const b of sliderBatches(mb)) {
      const p = servingPoint(c, b, input, output);
      if (p.fits && p.tpot <= TPOT_LIMIT && p.gpuHoursPerMTokens < best.gpuHoursPerM) best = { tp, batch: b, gpuHoursPerM: p.gpuHoursPerMTokens, tpot: p.tpot };
    }
  }
  return best;
}

const CHEAPEST = cheapestA40();

/** The reply length at which the prose shows eight GPUs per copy overtaking four. */
export const LONG_REPLY = 1500;

/** The cheapest point within the chat promise for each split, at a given reply length (every batch the slider reaches). */
export function cheapestBySplit(input = 1000, output = 300): Record<number, Cheapest> {
  const out: Record<number, Cheapest> = {};
  for (const tp of [2, 4, 8]) {
    const c: ServeConfig = { model: '70B', gpu: 'A', tp, precision: 'bf16' };
    let best: Cheapest = { tp, batch: 0, gpuHoursPerM: Infinity, tpot: 0 };
    for (const b of sliderBatches(maxBatch(c, input + output))) {
      const p = servingPoint(c, b, input, output);
      if (p.fits && p.tpot <= TPOT_LIMIT && p.gpuHoursPerMTokens < best.gpuHoursPerM) best = { tp, batch: b, gpuHoursPerM: p.gpuHoursPerMTokens, tpot: p.tpot };
    }
    out[tp] = best;
  }
  return out;
}

export function cheapestSolved(s: ServeState): boolean {
  if (s.model !== '70B' || s.gpu !== 'A' || s.precision !== 'bf16' || s.input !== 1000 || s.output !== 300) return false;
  const r = runServe(s);
  return r.fits && r.point.tpot <= TPOT_LIMIT && r.point.gpuHoursPerMTokens <= CHEAPEST.gpuHoursPerM * 1.0001;
}

/** The smallest batch at which a decoding step is limited by arithmetic rather than memory (Infinity: none up to `max`). */
export function computeBoundFrom(c: ServeConfig, context: number, max = 4096): number {
  for (let b = 1; b <= max; b++) if (decodeStep(c, b, context).bound === 'compute') return b;
  return Infinity;
}

/** Largest batch whose time per token stays within `limitS` (time per token grows with the batch). */
export function largestWithin(c: ServeConfig, limitS: number, input: number, output: number, cap = 1024): number {
  const mb = Math.min(cap, maxBatch(c, input + output));
  const ok = (b: number) => servingPoint(c, b, input, output).tpot <= limitS;
  if (mb < 1 || !ok(1)) return 0;
  if (ok(mb)) return mb;
  let lo = 1;
  let hi = mb;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Formatting.

export function msText(seconds: number): string {
  const v = seconds * 1e3;
  if (!Number.isFinite(v)) return '—';
  return `${fmt(v, v >= 100 ? 0 : v >= 1 ? 1 : 2)} ms`;
}

export function gbText(gb: number): string {
  return `${fmt(gb, gb >= 100 ? 0 : 1)} GB`;
}

export function ghText(gh: number): string {
  if (!Number.isFinite(gh)) return '—';
  return fmt(gh, gh >= 10 ? 1 : gh >= 1 ? 2 : 3);
}

const MEMORY = GRAPHIC.violet;
const CACHE = tint(GRAPHIC.violet, 0.45);
const COMPUTE = GRAPHIC.orange;
const LINKS = GRAPHIC.blue;
const TIME = GRAPHIC.teal;

const MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  { value: '8B', label: '8B model' },
  { value: '70B', label: '70B model' },
  { value: '400B', label: '400B model' },
];
const GPU_OPTIONS: Array<{ value: GpuId; label: string }> = [
  { value: 'L', label: 'L-class 48 GB' },
  { value: 'A', label: 'A-class 80 GB' },
  { value: 'B', label: 'B-class 192 GB' },
];
const TP_OPTIONS: Array<{ value: string; label: string }> = [1, 2, 4, 8].map((n) => ({ value: String(n), label: n === 1 ? '1 GPU' : `${n} GPUs` }));
const PRECISION_OPTIONS: Array<{ value: Precision; label: string }> = [
  { value: 'bf16', label: 'BF16 weights' },
  { value: 'fp8', label: 'FP8 weights' },
];

// ---------------------------------------------------------------------------
// Figure 1: memory of each GPU, and one step of decoding.

const MX0 = 96;
const MX1 = 620;

function ServeFigure({ r, s }: { r: ServeRun; s: ServeState }) {
  const g = ACCELERATORS[s.gpu];
  const mem = scale(0, r.capacityGB, MX0, MX1);
  const overflow = !r.weightsFit;
  const wEnd = Math.min(MX1, mem(r.weightsGB));
  const cEnd = Math.min(MX1, mem(r.weightsGB + r.cacheGB));
  const step = r.point.fits ? r.point.step : null;
  const [, tMax] = niceDomain(0, Math.max(step ? step.seconds * 1e3 : 10, 10), 4);
  const tx = scale(0, tMax, MX0, MX1);
  const ticks = niceTicks(0, tMax, 4);
  const busyEnd = step ? Math.max(step.computeS, step.memoryS) : 0;
  const label = !r.fits
    ? `${MODELS[s.model].name} on ${s.tp} ${g.short} GPU${s.tp > 1 ? 's' : ''}: the weights need ${gbText(r.weightsGB)} on each GPU, ${overflow ? `more than the ${gbText(r.capacityGB * 0.9)} available` : `leaving no room in the ${gbText(r.capacityGB * 0.9)} available for a conversation’s cache`}, so it can’t serve.`
    : `${MODELS[s.model].name} on ${s.tp} ${g.short} GPU${s.tp > 1 ? 's' : ''}, batch of ${fmt(r.batch)}. Each GPU holds ${gbText(r.weightsGB)} of weights and ${gbText(r.cacheGB)} of cache. One step takes ${msText(step!.seconds)}: ${msText(step!.memoryS)} reading memory, ${msText(step!.computeS)} of arithmetic, ${msText(step!.commS)} exchanging results.`;
  return (
    <svg className="diagram" viewBox="0 0 640 232" role="img" aria-label={label}>
      <text className="ax" x={MX0} y={14}>
        Memory of each GPU: {g.memoryGB} GB
      </text>
      <rect x={MX0} y={22} width={MX1 - MX0} height={26} fill="#fff" stroke="#d9d9d5" />
      <rect x={mem(r.capacityGB * 0.9)} y={22} width={MX1 - mem(r.capacityGB * 0.9)} height={26} fill="#eeeeea" />
      <rect x={MX0} y={22} width={wEnd - MX0} height={26} fill={overflow ? GRAPHIC.red : MEMORY} opacity={overflow ? 0.75 : 1} />
      {!overflow && cEnd > wEnd && <rect x={wEnd} y={22} width={cEnd - wEnd} height={26} fill={CACHE} />}
      <text className="ax ax-e" x={MX0 - 8} y={39}>
        {s.tp} × {g.short}
      </text>
      {overflow && (
        <text x={MX1} y={64} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
          The weights alone need {gbText(r.weightsGB)} per GPU: they don’t fit.
        </text>
      )}
      {!overflow && !r.fits && (
        <text x={MX1} y={64} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
          The weights fit, but there is no room left for even one conversation’s cache.
        </text>
      )}
      {r.fits && (
        <text className="ax" x={MX0} y={64}>
          {r.capped ? `Memory is full: the batch can’t grow past ${fmt(r.maxBatch)} requests.` : `Room for ${fmt(r.maxBatch)} requests of ${fmt(s.input + s.output)} tokens.`}
        </text>
      )}

      <text className="ax" x={MX0} y={96}>
        One step of decoding: every request in the batch gains one token
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gl" x1={tx(t)} x2={tx(t)} y1={104} y2={192} />
          <text className="ax ax-m" x={tx(t)} y={208}>
            {fmt(t, t % 1 ? 1 : 0)}
          </text>
        </g>
      ))}
      <text className="ax ax-e" x={MX1} y={224}>
        milliseconds
      </text>
      {[
        ['read memory', 116],
        ['arithmetic', 146],
        ['exchange', 176],
      ].map(([t, y]) => (
        <text key={t} className="ax ax-e" x={MX0 - 8} y={Number(y) + 4}>
          {t}
        </text>
      ))}
      {step ? (
        <g>
          <rect x={tx(0)} y={106} width={tx(r.weightReadS * 1e3) - tx(0)} height={20} fill={MEMORY} />
          <rect x={tx(r.weightReadS * 1e3)} y={106} width={tx((r.weightReadS + r.cacheReadS) * 1e3) - tx(r.weightReadS * 1e3)} height={20} fill={CACHE} />
          <rect x={tx(0)} y={136} width={Math.max(1, tx(step.computeS * 1e3) - tx(0))} height={20} fill={COMPUTE} />
          {step.commS > 0 && <rect x={tx(busyEnd * 1e3)} y={166} width={Math.max(1, tx((busyEnd + step.commS) * 1e3) - tx(busyEnd * 1e3))} height={20} fill={LINKS} />}
          <line x1={tx(step.seconds * 1e3)} x2={tx(step.seconds * 1e3)} y1={100} y2={192} stroke="#111" strokeDasharray="3 3" />
          <text
            x={tx(step.seconds * 1e3) + (tx(step.seconds * 1e3) > MX1 - 90 ? -6 : 6)}
            y={190}
            textAnchor={tx(step.seconds * 1e3) > MX1 - 90 ? 'end' : 'start'}
            style={{ fontSize: 12, fontWeight: 500, fill: TEXT.teal }}
          >
            step {msText(step.seconds)}
          </text>
        </g>
      ) : (
        <text className="ax" x={MX0} y={150}>
          Nothing runs: the model doesn’t fit.
        </text>
      )}
    </svg>
  );
}

function serveCaption(r: ServeRun, s: ServeState): string {
  if (!r.fits) {
    const need = (r.weightsGB * s.tp) / 1e3;
    return `The weights of the ${MODELS[s.model].name} take ${need >= 1 ? `${fmt(need, 2)} TB` : gbText(r.weightsGB * s.tp)} in ${s.precision.toUpperCase()}, and ${s.tp} ${ACCELERATORS[s.gpu].short} GPU${s.tp > 1 ? 's' : ''} have ${gbText(r.capacityGB * 0.9 * s.tp)} to give them${r.weightsGB < r.capacityGB * 0.9 ? ', leaving no room for even one request’s cache' : ''}. Use more GPUs, bigger ones, or fewer bytes per weight.`;
  }
  const st = r.point.step;
  if (st.bound === 'memory') {
    const what = r.cacheReadS > r.weightReadS ? 'mostly the cached keys and values' : 'mostly the weights';
    return `Memory sets the pace: each step reads ${what}, and the arithmetic, ${msText(st.computeS)}, fits inside the ${msText(st.memoryS)} that takes.${r.capped ? ` The cache has filled memory at ${fmt(r.maxBatch)} requests.` : ` The batch could grow to ${fmt(r.maxBatch)} before the cache fills memory.`}`;
  }
  return `The arithmetic, ${msText(st.computeS)}, now takes longer than reading memory, ${msText(st.memoryS)}: each extra request adds its own work.`;
}

// ---------------------------------------------------------------------------
// Figure 2: throughput and time per token against the batch.

const BX = scale(0, BATCH_EXP_MAX, 70, 610);
const bx = (b: number) => BX(Math.log2(b));
const TOP = { y0: 116, y1: 26 };
const BOT = { y0: 262, y1: 160 };

interface SweepPoint {
  batch: number;
  perGpu: number;
  tpotMs: number;
}

function sweep(c: ServeConfig, input: number, output: number): { points: SweepPoint[]; mb: number } {
  const mb = maxBatch(c, input + output);
  const points: SweepPoint[] = [];
  if (mb < 1) return { points, mb };
  const seen = new Set<number>();
  for (let e = 0; e <= BATCH_EXP_MAX + 1e-9; e += 0.125) {
    const b = Math.min(mb, Math.round(2 ** e));
    if (seen.has(b)) continue;
    seen.add(b);
    const p = servingPoint(c, b, input, output);
    points.push({ batch: b, perGpu: p.tokensPerGpuS, tpotMs: p.tpot * 1e3 });
  }
  return { points, mb };
}

function BatchFigure({ c, input, output, limitMs, within, current }: { c: ServeConfig; input: number; output: number; limitMs: number; within: number; current: number }) {
  const { points, mb } = sweep(c, input, output);
  if (!points.length)
    return (
      <svg className="chart" viewBox="0 0 640 80" role="img" aria-label="The model doesn’t fit on these GPUs, so there is nothing to plot.">
        <text className="ax" x={70} y={40}>
          The model doesn’t fit on these GPUs: choose more GPUs, bigger ones, or FP8 weights in the first demonstration.
        </text>
      </svg>
    );
  const [, perMax] = niceDomain(0, Math.max(...points.map((p) => p.perGpu)), 4);
  const yTop = scale(0, perMax, TOP.y0, TOP.y1);
  const [, tMax] = niceDomain(0, Math.max(limitMs * 1.15, ...points.map((p) => p.tpotMs)), 4);
  const yBot = scale(0, tMax, BOT.y0, BOT.y1);
  const xs = points.map((p) => bx(p.batch));
  const at = within > 0 ? servingPoint(c, within, input, output) : null;
  const memX = mb <= 1024 ? bx(mb) : null;
  const ticks = [1, 4, 16, 64, 256, 1024];
  const shadeEnd = within > 0 ? bx(within) : BX(0);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Output tokens per second per GPU and time per token against batch size, for the ${MODELS[c.model].name} on ${c.tp} ${ACCELERATORS[c.gpu].short} GPU${c.tp > 1 ? 's' : ''}. ${
        at ? `The largest batch that keeps each token within ${limitMs} ms is ${fmt(within)}, giving ${fmt(at.tokensPerGpuS)} tokens per second per GPU.` : `No batch keeps each token within ${limitMs} ms.`
      } Memory holds at most ${fmt(mb)} requests.`}
    >
      <text className="ax" x={70} y={14}>
        Output tokens per second, per GPU
      </text>
      <GridY y={yTop} ticks={niceTicks(0, perMax, 3)} x0={70} x1={610} format={(v) => fmt(v)} baseline={0} />
      <rect x={BX(0)} y={TOP.y1} width={Math.max(0, shadeEnd - BX(0))} height={TOP.y0 - TOP.y1} fill={tint(TIME, 0.1)} />
      <path d={linePath(xs, points.map((p) => yTop(p.perGpu)))} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      {at && <circle cx={bx(within)} cy={yTop(at.tokensPerGpuS)} r={6} fill="#333" stroke="#fcfcfb" strokeWidth={2} />}

      <text className="ax" x={70} y={148}>
        Time per output token
      </text>
      <GridY y={yBot} ticks={niceTicks(0, tMax, 3)} x0={70} x1={610} format={(v) => `${fmt(v)} ms`} baseline={0} />
      <rect x={BX(0)} y={BOT.y1} width={Math.max(0, shadeEnd - BX(0))} height={BOT.y0 - BOT.y1} fill={tint(TIME, 0.1)} />
      <line x1={70} x2={610} y1={yBot(limitMs)} y2={yBot(limitMs)} stroke={TEXT.teal} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={606} y={yBot(limitMs) - 5} textAnchor="end" style={{ fontSize: 12, fill: TEXT.teal }}>
        limit {limitMs} ms
      </text>
      <path d={linePath(xs, points.map((p) => yBot(p.tpotMs)))} fill="none" stroke={TIME} strokeWidth={2.5} strokeLinejoin="round" />
      {at && <circle cx={bx(within)} cy={yBot(at.tpot * 1e3)} r={6} fill={TIME} stroke="#fcfcfb" strokeWidth={2} />}

      {memX !== null && (
        <g>
          <line x1={memX} x2={memX} y1={TOP.y1} y2={BOT.y0} stroke={TEXT.violet} strokeDasharray="3 3" />
          <text x={memX > 520 ? memX - 4 : memX + 4} y={TOP.y1 + 10} textAnchor={memX > 520 ? 'end' : 'start'} style={{ fontSize: 12, fill: TEXT.violet }}>
            memory full
          </text>
        </g>
      )}
      {current >= 1 && current <= mb && <line className="cur" x1={bx(current)} x2={bx(current)} y1={TOP.y1} y2={BOT.y0} />}
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={bx(t)} y={280}>
          {fmt(t)}
        </text>
      ))}
      <text className="ax ax-e" x={610} y={296}>
        requests in the batch
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const sv = useScenario('serve', SERVE_DEFAULTS);
  const s = sv.state;
  const r = runServe(s);
  const g = ACCELERATORS[s.gpu];
  const p = r.point;
  const solvedA = bf16FrontierSolved(s);
  const solvedB = cheapestSolved(s);

  const lim = useScenario('limit', LIMIT_DEFAULTS);
  const limitMs = lim.state.limitMs;
  const within = largestWithin(r.config, limitMs / 1e3, s.input, s.output);
  const atLimit = within > 0 ? servingPoint(r.config, within, s.input, s.output) : null;

  // Numbers for the prose: the 70B model on four A-class GPUs, the chat assistant's 1,000-token prompts and 300-token replies.
  const ref = useMemo(() => {
    const base = { ...SERVE_DEFAULTS };
    const one = runServe(base);
    const c = configOf(base);
    const mb = maxBatch(c, 1300);
    const full = servingPoint(c, mb, 1000, 300);
    const b64 = servingPoint(c, 64, 1000, 300);
    const fullRun = runServe({ ...base, batchExp: Math.log2(mb) });
    const two = configOf({ ...base, tp: 2 });
    const eight = configOf({ ...base, tp: 8 });
    const fp8 = configOf({ ...base, precision: 'fp8' });
    const bTwo = configOf({ ...base, gpu: 'B', tp: 2 });
    const frontierBf16 = memoryPlan({ model: '400B', gpu: 'B', tp: 8, precision: 'bf16' });
    const frontierA8 = configOf({ model: '400B', gpu: 'A', tp: 8, precision: 'fp8' });
    const best8 = largestWithin(eight, TPOT_LIMIT, 1000, 300);
    return {
      one,
      mb,
      full,
      fullRun,
      b64,
      planA4: memoryPlan(c),
      perRequestMB: (1300 * kvBytesPerToken(MODELS['70B'])) / 1e6,
      twoRoom: memoryPlan(two),
      twoMax: maxBatch(two, 1300),
      eightBest: servingPoint(eight, best8, 1000, 300),
      eightBatch: best8,
      twoBest: servingPoint(two, maxBatch(two, 1300), 1000, 300),
      fp8Max: maxBatch(fp8, 1300),
      fp8Best: servingPoint(fp8, Math.min(maxBatch(fp8, 1300), 1024), 1000, 300),
      bTwoMax: maxBatch(bTwo, 1300),
      bTwoBest: servingPoint(bTwo, maxBatch(bTwo, 1300), 1000, 300),
      frontierBf16,
      frontierA8Max: maxBatch(frontierA8, 1300),
      crossover: computeBoundFrom(c, 1000 + 300 / 2),
      eightMax: maxBatch(eight, 1300),
      eightFull: servingPoint(eight, maxBatch(eight, 1300), 1000, 300),
      at20: largestWithin(c, 0.02, 1000, 300),
      at16: largestWithin(c, 0.016, 1000, 300),
      eightPrefill: prefillS(eight, 1000),
      eightPrefillEx: tensorParallelS(eight, 1000),
      longPerRequestMB: ((1000 + LONG_REPLY) * kvBytesPerToken(MODELS['70B'])) / 1e6,
      long: cheapestBySplit(1000, LONG_REPLY),
    };
  }, []);
  const at20 = servingPoint(configOf(SERVE_DEFAULTS), ref.at20, 1000, 300);
  const userRate = (t: number) => fmt(1 / t);
  const bwPct = fmt(BANDWIDTH_EFFICIENCY * 100);
  const limitText = `${fmt(TPOT_LIMIT * 1e3)} ms`;

  const statusA = s.model !== '400B'
    ? 'Choose the 400B model first.'
    : s.precision !== 'bf16'
      ? 'The 400B model fits more easily in FP8. Can it run in BF16?'
      : `In BF16 its weights need ${gbText(r.weightsGB)} on each of ${s.tp} ${g.short} GPU${s.tp > 1 ? 's' : ''}, ${r.fits ? 'and they fit' : `more than the ${gbText(g.memoryGB * 0.9)} available`}.`;
  const statusB =
    s.model !== '70B' || s.gpu !== 'A' || s.precision !== 'bf16'
      ? 'Set the 70B model on A-class GPUs with BF16 weights.'
      : s.input !== 1000 || s.output !== 300
        ? 'Set the prompt back to 1,000 tokens and the reply to 300.'
        : !r.fits
          ? 'The model doesn’t fit on that many A-class GPUs.'
          : p.tpot > TPOT_LIMIT
            ? `Each user now waits ${msText(p.tpot)} per token, more than ${limitText}.`
            : `${ghText(p.gpuHoursPerMTokens)} GPU-hours per million tokens, with a token every ${msText(p.tpot)}. Can it cost less?`;

  return (
    <LessonPage id="compute/3.2">
      <P>
        <a href={lessonHref('compute/3.1')}>The previous lesson</a> took a language model apart and found two facts that shape everything about running one. To write a
        single token, the model must pass it through every layer, which means reading every one of its weights from memory. And every conversation leaves behind a cache
        of keys and values, one set per token, that each later token must read again. This lesson puts those facts to work in a serving system: one copy of a model,
        spread over some of a server’s GPUs, answering requests from many people at once.
      </P>
      <P>
        Answering a request has two phases. First the model reads the prompt. All its tokens are known in advance, so they pass through the layers together, as one large
        batch of vectors — the compute-heavy matrix multiplies of <a href={lessonHref('compute/2.3')}>Lesson 2.3</a>. This is called <b>prefill</b>, and its length
        sets the <K tone="teal">time to first token</K>. Then the model writes the reply one token at a time, each token needing the one before. This is{' '}
        <b>decoding</b>, and the gap between tokens is the <K tone="teal">time per output token</K>. A person reading a reply as it streams in feels both: the pause
        before it starts, and the pace once it has.
      </P>
      <P>
        A server decodes many requests together. At every step, every request in the <b>batch</b> gains one token, and all of them share a single pass over the
        weights. In the next demonstration, choose a model, the accelerator, how many of a server’s GPUs share one copy of the model, and how many bytes each weight
        takes; then set the batch and the lengths of the prompt and the reply. The upper bar is the memory of each GPU; the lower chart is one decoding step, with the{' '}
        <K tone="violet">time spent reading memory</K>, the <K tone="orange">arithmetic</K>, which overlaps it, and the <K tone="blue">exchange of results</K> between
        the GPUs that follows every layer. It starts with the 70B model on four A-class 80 GB GPUs, serving one request:
      </P>

      <Figure name="Inference Serving Simulator" scenario={sv}>
        <Segmented label="Model" value={s.model} onChange={(v) => sv.set({ model: v })} options={MODEL_OPTIONS} />
        <Segmented label="Accelerator" value={s.gpu} onChange={(v) => sv.set({ gpu: v })} options={GPU_OPTIONS} />
        <Segmented label="GPUs sharing one copy of the model" value={String(s.tp)} onChange={(v) => sv.set({ tp: Number(v) })} options={TP_OPTIONS} />
        <Segmented label="Bytes per weight" value={s.precision} onChange={(v) => sv.set({ precision: v })} options={PRECISION_OPTIONS} />
        <ServeFigure r={r} s={s} />
        <Legend
          items={[
            { label: 'Weights', color: MEMORY },
            { label: 'Cache of keys and values', color: CACHE },
            { label: 'Kept free for the runtime', color: '#e3e3df' },
            { label: 'Arithmetic', color: COMPUTE },
            { label: 'Exchange between GPUs', color: LINKS },
          ]}
        />
        <Readouts
          items={[
            { label: 'time to first token', value: r.fits ? msText(p.ttft) : '—', tone: 'teal' },
            { label: 'time per output token', value: r.fits ? `${msText(p.tpot)}` : '—', tone: 'teal' },
            { label: 'tokens per second, all requests', value: r.fits ? fmt(p.tokensPerS) : '—' },
            { label: 'GPU-hours per million tokens', value: r.fits ? ghText(p.gpuHoursPerMTokens) : '—' },
          ]}
        />
        <Slider
          label="Requests in the batch"
          value={s.batchExp}
          min={0}
          max={BATCH_EXP_MAX}
          step={BATCH_EXP_STEP}
          onChange={(v) => sv.set({ batchExp: v })}
          display={r.capped ? `${fmt(r.batch)} (memory full)` : fmt(r.requested)}
        />
        <Slider label="Prompt length" tone="teal" value={s.input} min={100} max={8000} step={100} onChange={(v) => sv.set({ input: v })} display={`${fmt(s.input)} tokens`} />
        <Slider label="Reply length" tone="teal" value={s.output} min={50} max={2000} step={50} onChange={(v) => sv.set({ output: v })} display={`${fmt(s.output)} tokens`} />
        <Caption>{serveCaption(r, s)}</Caption>
      </Figure>

      <P>
        With one request, the step takes {msText(ref.one.point.tpot)}, and almost all of it is reading. The 70B model’s {gbText(ref.planA4.weightBytes / 1e9)} of BF16
        weights are split four ways, {gbText(ref.one.weightsGB)} on each GPU, and at the {bwPct}% of the A-class’s {ACCELERATORS.A.bandwidthTBs} TB/s that we assume a serving
        engine reaches, that takes {msText(ref.one.weightReadS)}. The arithmetic for one token takes {msText(ref.one.point.step.computeS)}. Each GPU holds a
        quarter of every layer’s matrices — a split called <b>tensor parallelism</b> — so each computes only part of every result, and the four must add their
        parts together with an all-reduce (<a href={lessonHref('compute/2.5')}>Lesson 2.5</a>) twice in each of the model’s 80 layers: that is the other{' '}
        {msText(ref.one.point.step.commS)}. The user sees a token every{' '}
        {msText(ref.one.point.tpot)}, about {userRate(ref.one.point.tpot)} a second — faster than anyone reads — and the first one after{' '}
        {msText(ref.one.point.ttft)}, of which {msText(ref.one.prefill)} is the prefill.
      </P>
      <P>
        Now raise the batch. At 64 requests the step has stretched only to {msText(ref.b64.tpot)}, but it produces 64 tokens instead of one: the four GPUs turn out{' '}
        {fmt(ref.b64.tokensPerS)} tokens a second, {fmt(ref.b64.tokensPerS / ref.one.point.tokensPerS)} times as many, while each user’s tokens slow by{' '}
        {fmt((ref.b64.tpot / ref.one.point.tpot - 1) * 100)}%. The weights are read once per step whatever the batch, exactly as in Lesson 2.3, so most of the extra
        requests ride along for nearly nothing.
      </P>

      <H2>Memory sets the batch</H2>
      <P>
        Keep raising it and the batch stops at {fmt(ref.mb)}. The weights are not the only thing in memory. Each request’s cache holds, for every token of its prompt
        and reply, a key and a value for each of the model’s 80 layers: {fmt(kvBytesPerToken(MODELS['70B']))} bytes a token, so a conversation of 1,300 tokens needs{' '}
        {fmt(ref.perRequestMB)} MB. After the weights, and the tenth of each GPU kept free for the software that runs them, the four GPUs have{' '}
        {gbText(ref.planA4.kvBytes / 1e9)} for caches: room for {fmt(ref.mb)} such conversations, and no more.
      </P>
      <P>
        The cache also changes what the step spends its time on. At {fmt(ref.mb)} requests, reading the caches takes {msText(ref.fullRun.cacheReadS)} on top of the{' '}
        {msText(ref.fullRun.weightReadS)} for the weights, and the arithmetic has grown to {msText(ref.full.step.computeS)}, still inside the reading time. A step now
        takes {msText(ref.full.tpot)} and yields {fmt(ref.full.tokensPerS)} tokens a second, {fmt(ref.full.tokensPerS / ref.one.point.tokensPerS)} times the single
        request’s rate, yet the matrix units reach only {fmt(ref.full.utilization * 100)}% of their peak. Unlike the shared weights of Lesson 2.3, every request
        brings its own cache to read, so the reading keeps growing with the batch. The arithmetic grows faster still, and would overtake the reading at
        about {fmt(ref.crossover)} requests — but memory fills at {fmt(ref.mb)}, long before that. Split the model over eight GPUs, which have room
        for {fmt(ref.eightMax)}, and a full batch does become limited by arithmetic.
      </P>
      <P>
        Memory can be scarce enough to make a setup useless. Split the 70B model over two A-class GPUs and the weights leave only {gbText(ref.twoRoom.kvBytes / 1e9)}{' '}
        for caches: room for {fmt(ref.twoMax)} conversations. And it decides whether a model runs at all. The 400B model’s weights alone are{' '}
        {gbText(ref.frontierBf16.weightBytes / 1e9)} in BF16.
      </P>

      <Challenge
        id="a"
        question="Find a setup that runs the 400B model with its weights in BF16."
        solved={solvedA}
        status={statusA}
        success={`Solved. Only a full server of B-class 192 GB GPUs holds it: eight of them have ${gbText(ref.frontierBf16.usableBytes / 1e9)} to give, enough for the ${gbText(ref.frontierBf16.weightBytes / 1e9)} of weights and caches besides. Eight A-class GPUs have only ${gbText(8 * 72)} — though in FP8, at half the bytes, the model fits on them with room for ${fmt(ref.frontierA8Max)} conversations.`}
      />

      <P>
        Fewer bytes per weight help twice over. In FP8, the format <a href={lessonHref('compute/1.4')}>Lesson 1.4</a> met, the 70B model’s weights halve, so the
        four A-class GPUs have room for {fmt(ref.fp8Max)} conversations instead of {fmt(ref.mb)}, and every step reads half the bytes of weights — though not of
        cache, which stays in BF16. Whether the model answers as well is a question for the people who
        trained it: eight bits per weight usually lose little, but not nothing.
      </P>

      <H2>What a token costs</H2>
      <P>
        An operator renting out a model counts its output in tokens and its expense in GPU-hours, so the number that matters is{' '}
        <b>GPU-hours per million tokens</b>. Serving one request at a time, the four GPUs need {ghText(ref.one.point.gpuHoursPerMTokens)} GPU-hours to write a million
        tokens. A bigger batch gets far more out of the same hours, and the split decides how big it can be: two GPUs have room for {fmt(ref.twoMax)} conversations,
        four for {fmt(ref.mb)}, eight for {fmt(ref.eightMax)}.
      </P>

      <Challenge
        id="b"
        figure="Inference Serving Simulator"
        question={`Predict first: for the chat assistant — the 70B model on A-class GPUs with BF16 weights, 1,000-token prompts and 300-token replies, and a token at least every ${limitText} for every user, the promise Lessons 3.4 and 3.5 keep too — which split costs least per token: two, four or eight GPUs per copy? Then find the setup with the fewest GPU-hours per million tokens.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${CHEAPEST.tp} GPUs and ${fmt(CHEAPEST.batch)} requests, memory full: ${ghText(CHEAPEST.gpuHoursPerM)} GPU-hours per million tokens, with a token every ${msText(CHEAPEST.tpot)}. Eight GPUs have room for three times the batch, but a full one takes ${msText(ref.eightFull.tpot)} a token there, past the promise, and exchanging results among eight GPUs costs more than the bigger batch saves.`}
      />

      <P>
        Filled to {fmt(ref.mb)} requests, the four GPUs need {ghText(ref.full.gpuHoursPerMTokens)} GPU-hours per million tokens: the same hardware, for the same hour,
        produces {fmt(ref.one.point.gpuHoursPerMTokens / ref.full.gpuHoursPerMTokens)} times as much as with one request. The cost of a token is a property of how the
        GPUs are used, far more than of the GPUs themselves — and the best use is a balance. Two GPUs are cheaper per copy but hold so few conversations that they need{' '}
        {ghText(ref.twoBest.gpuHoursPerMTokens)} GPU-hours per million tokens. Eight GPUs read their share of the weights faster, but every exchange of results now
        involves eight, in each step and above all while reading a prompt: a 1,000-token prompt takes them {msText(ref.eightPrefill)}, {msText(ref.eightPrefillEx)} of it
        in exchanges, or {fmt(8 * ref.eightPrefill * 1e3)} GPU-milliseconds against four GPUs’ {fmt(4 * ref.one.prefill * 1e3)}. And by {fmt(ref.eightBatch)} requests
        their step has run into the {limitText} limit, at {ghText(ref.eightBest.gpuHoursPerMTokens)} GPU-hours per million.
      </P>
      <P>
        The balance depends on the work, too. Lengthen the replies to {fmt(LONG_REPLY)} tokens in the first demonstration and each conversation’s cache grows to{' '}
        {fmt(ref.longPerRequestMB)} MB, so four GPUs have room for only {fmt(ref.long[4].batch)}, while eight, with three times the room, hold{' '}
        {fmt(ref.long[8].batch)}. With each prompt now spread over five times as many tokens of reply, sharing every step among more requests matters more than the
        exchanges, and eight GPUs come out cheaper: {ghText(ref.long[8].gpuHoursPerM)} GPU-hours per million against {ghText(ref.long[4].gpuHoursPerM)}. Back at
        300-token replies, change the accelerator and the numbers move further still. Two B-class GPUs hold the 70B model with room for {fmt(ref.bTwoMax)} conversations
        and serve it for {ghText(ref.bTwoBest.gpuHoursPerMTokens)} GPU-hours per million tokens — but a B-class hour is a different thing from an A-class hour, and
        comparing them needs prices, which come in Chapter 5.
      </P>

      <H2>Latency limits the batch</H2>
      <P>
        So far the batch has been free to grow until memory ran out. A service that promises its users a pace can’t let it. In the next demonstration, the upper curve
        is the throughput of each GPU and the lower curve the time per token, for every batch the configuration of{' '}
        <FigRef to="Inference Serving Simulator">the first demonstration</FigRef> can hold. The shaded batches keep each user’s tokens within the limit; the dot is the
        largest of them. Tighten the limit:
      </P>

      <Figure name="Inference Serving Simulator · batch" scenario={lim}>
        <BatchFigure c={r.config} input={s.input} output={s.output} limitMs={limitMs} within={within} current={r.batch} />
        <Readouts
          items={[
            { label: 'largest batch within the limit', value: within > 0 ? fmt(within) : 'none', tone: 'teal' },
            { label: 'tokens per second, per GPU', value: atLimit ? fmt(atLimit.tokensPerGpuS) : '—' },
            { label: 'GPU-hours per million tokens', value: atLimit ? ghText(atLimit.gpuHoursPerMTokens) : '—' },
          ]}
        />
        <Slider label="Limit on time per token" tone="teal" value={limitMs} min={5} max={60} onChange={(v) => lim.set({ limitMs: v })} display={`${limitMs} ms`} />
        <Caption>{`Plotted for the setup in the first demonstration: the ${MODELS[s.model].name} on ${s.tp} ${g.short} GPU${s.tp > 1 ? 's' : ''} with ${s.precision.toUpperCase()} weights, ${fmt(
          s.input,
        )}-token prompts and ${fmt(s.output)}-token replies.`}</Caption>
      </Figure>

      <P>
        For the 70B model on four A-class GPUs, a 20 ms limit allows a batch of {fmt(ref.at20)}, at {ghText(at20.gpuHoursPerMTokens)} GPU-hours per million tokens,{' '}
        {fmt((at20.gpuHoursPerMTokens / ref.full.gpuHoursPerMTokens - 1) * 100)}% more than with the batch full. At 16 ms only {fmt(ref.at16)} requests fit under the
        limit, and below {msText(ref.one.point.tpot)} — the time to read the weights and exchange results for a single request — no batch does. Every point on these
        curves is a different product made by the same GPUs: fast tokens for few people, or slower tokens for many. The workloads of this course ask for different
        points. A code-completion service, which must keep pace with a programmer’s typing, holds each token to 15 ms; an overnight job summarizing documents has no
        limit at all and can fill memory.
      </P>
      <P>
        The prompt matters too. Prefill processes a prompt’s tokens together, so they are cheap: {fmt(1000)} of them take the four GPUs{' '}
        {msText(ref.one.prefill)}, while writing tokens one by one for a single request takes {msText(ref.one.point.tpot)} each. Lengthen the prompt in the first
        demonstration and the time to first token grows, the cache per conversation grows, and the batch that fits shrinks. It is one reason many services charge less for
        the tokens people send than for the tokens the model writes back.
      </P>
      <P>
        Serving is one of the two great uses of GPUs. The other is making the model in the first place, and it asks for something quite different: not many small,
        latency-bound requests, but one enormous calculation spread over thousands of GPUs for weeks. That is the subject of{' '}
        <a href={lessonHref('compute/3.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
