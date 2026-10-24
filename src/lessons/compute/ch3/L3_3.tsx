import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { STATE_BYTES, TRAIN_COMPUTE_EFFICIENCY, trainFlopsPerToken, trainingRun, type TrainConfig, type TrainResult } from '../../../engines/compute/training';
import { ACCELERATORS, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { MODELS, matmulParams, type ModelId } from '../../../model/compute/models';

// ---------------------------------------------------------------------------
// The run being planned: a fixed batch and sequence length, two trillion tokens.

/** Tokens in each optimizer step: 1,024 sequences of 4,096 tokens. */
export const BATCH_TOKENS = 4 * 1024 * 1024;
export const SEQ_LEN = 4096;
/** Tokens to train on, for either model. */
export const TRAIN_TOKENS = 2e12;

export const SPLITS = [1, 2, 4, 8, 16] as const;
type SplitText = '1' | '2' | '4' | '8' | '16';

export function runOf(model: ModelId, gpu: GpuId, gpus: number, tp: number, pp: number): TrainResult {
  const c: TrainConfig = { model, gpu, gpus, tp, pp, batchTokens: BATCH_TOKENS, seqLen: SEQ_LEN, tokens: TRAIN_TOKENS };
  return trainingRun(c);
}

export const TRAIN_DEFAULTS = { model: '70B' as ModelId, gpu: 'A' as GpuId, lg: 10, tp: '8' as SplitText, pp: '4' as SplitText };
type TrainState = typeof TRAIN_DEFAULTS;

/** The fitting split that trains the 70B model fastest on 1,024 A-class GPUs. */
export function fastestSplit(): { tp: number; pp: number; days: number } {
  let best = { tp: 0, pp: 0, days: Infinity };
  for (const tp of SPLITS)
    for (const pp of SPLITS) {
      const r = runOf('70B', 'A', 1024, tp, pp);
      if (r.valid && r.fits && r.days < best.days) best = { tp, pp, days: r.days };
    }
  return best;
}

const FASTEST = fastestSplit();

/** Challenge a: the 70B model on 1,024 A-class GPUs, split so it fits and finishes soonest. */
export function fastestSolved(s: TrainState): boolean {
  if (s.model !== '70B' || s.gpu !== 'A' || 2 ** s.lg !== 1024) return false;
  const r = runOf('70B', 'A', 1024, Number(s.tp), Number(s.pp));
  return r.valid && r.fits && r.days <= FASTEST.days + 1e-9;
}

// The scaling demonstration: three splits of the 70B model on A-class GPUs.

export type ScaleSplit = '8x4' | '8x1' | '4x2';
export const SCALE_SPLITS: Array<{ id: ScaleSplit; tp: number; pp: number; label: string }> = [
  { id: '8x4', tp: 8, pp: 4, label: '8 per layer, 4 stages' },
  { id: '8x1', tp: 8, pp: 1, label: '8 per layer, 1 stage' },
  { id: '4x2', tp: 4, pp: 2, label: '4 per layer, 2 stages' },
];
export const SCALE_DEFAULTS = { split: '8x4' as ScaleSplit, lg: 10 };
/** Challenge b: finish within a week while spending no more than this many GPU-hours. */
export const WEEK_DAYS = 7;
export const BUDGET_GPU_HOURS = 600_000;
const LG_MIN = 5;
const LG_MAX = 15;

export function scaleRun(split: ScaleSplit, lg: number): TrainResult {
  const s = SCALE_SPLITS.find((x) => x.id === split)!;
  return runOf('70B', 'A', 2 ** lg, s.tp, s.pp);
}

export function weekSolved(s: typeof SCALE_DEFAULTS): boolean {
  const r = scaleRun(s.split, s.lg);
  return r.valid && r.fits && r.days < WEEK_DAYS && r.gpuHours <= BUDGET_GPU_HOURS;
}

// ---------------------------------------------------------------------------
// Formatting.

/** "19.5 days", "577.8 days" → "578 days", "6.0 days". */
export function daysText(d: number): string {
  if (!Number.isFinite(d)) return '—';
  return `${fmt(d, d >= 100 ? 0 : 1)} days`;
}

/** "479,000" or "2.24 million". */
export function gpuHoursText(h: number): string {
  if (!Number.isFinite(h)) return '—';
  return h >= 1e6 ? `${fmt(h / 1e6, 2)} million` : fmt(Math.round(h / 1000) * 1000);
}

export function pct1(x: number): string {
  return `${fmt(x * 100, 1)}%`;
}

function secs(s: number): string {
  return s >= 1 ? `${fmt(s, 2)} s` : `${fmt(s * 1000)} ms`;
}

const ARITH = GRAPHIC.orange;
const BUBBLE = '#c9c9c4';
const TPC = GRAPHIC.blue;
const DPC = tint(GRAPHIC.blue, 0.45);
const STATE = GRAPHIC.violet;
const ACTS = tint(GRAPHIC.violet, 0.45);

// ---------------------------------------------------------------------------
// The first figure: one copy of the model laid out on its GPUs, the memory each GPU needs, and one step.

function TrainDiagram({ model, gpu, gpus, tp, pp, r, ariaLabel }: { model: ModelId; gpu: GpuId; gpus: number; tp: number; pp: number; r: TrainResult; ariaLabel: string }) {
  const m = MODELS[model];
  const g = ACCELERATORS[gpu];
  const copy = tp * pp;
  const cw = Math.min(24, 240 / tp);
  const ch = Math.min(22, 136 / pp);
  const x0 = 78;
  const y0 = 34;
  const gw = cw * tp;
  const gh = ch * pp;

  // Server outlines: GPUs fill servers of eight in order, stage by stage.
  const servers: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (tp >= 8) {
    for (let row = 0; row < pp; row++) for (let c = 0; c < tp / 8; c++) servers.push({ x: x0 + c * 8 * cw, y: y0 + row * ch, w: 8 * cw, h: ch });
  } else {
    const rows = 8 / tp;
    for (let b = 0; b * rows < pp; b++) servers.push({ x: x0, y: y0 + b * rows * ch, w: tp * cw, h: Math.min(rows, pp - b * rows) * ch });
  }
  const layersPer = m.layers / pp;
  const stageLabel = (i: number) => `layers ${fmt(i * layersPer + 1)}–${fmt((i + 1) * layersPer)}`;
  const labelRows = pp <= 8 ? Array.from({ length: pp }, (_, i) => i) : [0, pp - 1];

  // Memory bar.
  const mx0 = 440;
  const mx1 = 620;
  const memMax = Math.max(g.memoryGB, r.valid ? r.memoryGB : 0) * 1.05;
  const MX = scale(0, memMax, mx0, mx1);
  const over = r.valid && !r.fits;

  // Step bar.
  const sx0 = 20;
  const sx1 = 620;
  const parts = r.valid
    ? [
        { v: r.computeS, color: ARITH, label: 'arithmetic' },
        { v: r.bubbleS, color: BUBBLE, label: 'bubble' },
        { v: r.tpCommS, color: TPC, label: 'tensor-parallel exchanges' },
        { v: r.dpCommS, color: DPC, label: 'gradient all-reduce' },
      ]
    : [];
  const SX = scale(0, r.valid ? r.stepS : 1, sx0, sx1);
  let acc = 0;
  const sy = 236;

  return (
    <svg className="diagram" viewBox="0 0 640 290" role="img" aria-label={ariaLabel}>
      <text className="ax" x={20} y={14}>
        One copy: {tp} GPU{tp > 1 ? 's' : ''} per layer × {pp} stage{pp > 1 ? 's' : ''} = {fmt(copy)} GPU{copy > 1 ? 's' : ''}
      </text>
      {Array.from({ length: pp }, (_, row) =>
        Array.from({ length: tp }, (_, col) => (
          <rect key={`${row}-${col}`} x={x0 + col * cw + 1} y={y0 + row * ch + 1} width={Math.max(1, cw - 2)} height={Math.max(1, ch - 2)} rx={1.5} fill={tint(ARITH, 0.55)} />
        )),
      )}
      {servers.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="#555" strokeWidth={1.2} rx={3} />
      ))}
      {tp > 8 &&
        Array.from({ length: pp }, (_, row) => (
          <line key={row} x1={x0 + 8 * cw} x2={x0 + 8 * cw} y1={y0 + row * ch + 2} y2={y0 + (row + 1) * ch - 2} stroke={TEXT.red} strokeWidth={2.5} />
        ))}
      {labelRows.map((i) => (
        <text key={i} className="ax ax-e" x={x0 - 6} y={y0 + i * ch + ch / 2 + 4} style={{ fontSize: Math.min(12, ch * 0.75 + 3) }}>
          {stageLabel(i)}
        </text>
      ))}
      <text className="ax" x={x0} y={y0 + gh + 16}>
        {tp > 8 ? 'each layer spans two servers: its exchanges cross the network' : servers.length && tp < 8 && pp * tp < 8 ? `a server holds ${8 / copy} copies` : 'outlines: servers of 8 GPUs'}
      </text>
      <text className="lab" x={x0 + gw + 12} y={y0 + gh / 2 + 4}>
        {r.dp >= 1 && Number.isInteger(gpus / copy) ? `× ${fmt(gpus / copy)} cop${gpus / copy === 1 ? 'y' : 'ies'}` : ''}
      </text>

      <text className="ax" x={mx0} y={14}>
        Memory each GPU needs
      </text>
      {r.valid ? (
        <g>
          <rect x={mx0} y={34} width={MX(r.stateGB) - mx0} height={26} fill={STATE} />
          <rect x={MX(r.stateGB)} y={34} width={MX(r.memoryGB) - MX(r.stateGB)} height={26} fill={ACTS} />
          {over && <rect x={mx0} y={34} width={MX(r.memoryGB) - mx0} height={26} fill="none" stroke={TEXT.red} strokeWidth={2} />}
          <line x1={MX(g.memoryGB)} x2={MX(g.memoryGB)} y1={26} y2={68} stroke="#111" strokeWidth={1.5} strokeDasharray="4 3" />
          <text className="ax ax-m" x={Math.max(mx0 + 52, Math.min(MX(g.memoryGB), mx1 - 56))} y={82}>
            {g.memoryGB} GB on the card
          </text>
          <text className="lab" x={mx0} y={102} style={over ? { fill: TEXT.red } : undefined}>
            {fmt(r.memoryGB, 1)} GB{over ? ': doesn’t fit' : ''}
          </text>
          <text className="ax" x={mx0} y={120}>
            {fmt(r.stateGB, 1)} GB weights and state
          </text>
          <text className="ax" x={mx0} y={136}>
            {fmt(r.activationGB, 1)} GB activations
          </text>
        </g>
      ) : (
        <text className="ax" x={mx0} y={50}>
          —
        </text>
      )}

      <text className="ax" x={sx0} y={sy - 22}>
        {r.valid ? `One training step: ${secs(r.stepS)} (${fmt(r.steps)} steps in all)` : (r.reason ?? '')}
      </text>
      {parts.map((p) => {
        const x = SX(acc);
        acc += p.v;
        const w = Math.max(0, SX(acc) - x);
        return w > 0 ? <rect key={p.label} x={x} y={sy - 12} width={w} height={24} fill={p.color} /> : null;
      })}
      {r.valid && (
        <g>
          <text className="ax" x={sx0} y={sy + 30}>
            0
          </text>
          <text className="ax ax-e" x={sx1} y={sy + 30}>
            {secs(r.stepS)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second figure: days and efficiency against the number of GPUs, for three splits.

const SX = scale(LG_MIN, LG_MAX, 72, 612);
const DAY_TICKS = [0.1, 1, 10, 100, 1000];
const DY = (d: number) => scale(-1, 3, 128, 26)(Math.log10(Math.max(0.1, Math.min(1000, d))));
const MY = scale(0, 0.6, 238, 160);

function ScalingChart({ split, lg, ariaLabel }: { split: ScaleSplit; lg: number; ariaLabel: string }) {
  const curves = useMemo(
    () =>
      SCALE_SPLITS.map((s) => {
        const pts: Array<{ lg: number; r: TrainResult }> = [];
        for (let k = LG_MIN; k <= LG_MAX; k++) {
          const r = scaleRun(s.id, k);
          if (r.valid) pts.push({ lg: k, r });
        }
        return { ...s, pts };
      }),
    [],
  );
  const sel = curves.find((c) => c.id === split)!;
  const first = sel.pts[0];
  const ideal = first ? sel.pts.map((p) => ({ lg: p.lg, d: (first.r.days * 2 ** first.lg) / 2 ** p.lg })) : [];
  const order = [...curves.filter((c) => c.id !== split), sel];
  return (
    <svg className="chart" viewBox="0 0 640 286" role="img" aria-label={ariaLabel}>
      <text className="ax" x={72} y={14}>
        Days to train (log scale)
      </text>
      {DAY_TICKS.map((t) => (
        <g key={t}>
          <line className="gl" x1={72} x2={612} y1={DY(t)} y2={DY(t)} />
          <text className="ax ax-e" x={66} y={DY(t) + 4}>
            {t < 1 ? fmt(t, 1) : fmt(t)}
          </text>
        </g>
      ))}
      {ideal.length > 1 && (
        <path d={linePath(ideal.map((p) => SX(p.lg)), ideal.map((p) => DY(p.d)))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />
      )}
      {order.map((c) => {
        const on = c.id === split;
        return (
          <g key={c.id}>
            <path d={linePath(c.pts.map((p) => SX(p.lg)), c.pts.map((p) => DY(p.r.days)))} fill="none" stroke={on ? TEXT.teal : '#b5b5b0'} strokeWidth={on ? 2.5 : 1.5} />
            {c.pts.map((p) => (
              <circle key={p.lg} cx={SX(p.lg)} cy={DY(p.r.days)} r={on ? 3.5 : 2.5} fill={p.r.fits ? (on ? TEXT.teal : '#b5b5b0') : '#fcfcfb'} stroke={on ? TEXT.teal : '#b5b5b0'} strokeWidth={1.2} />
            ))}
          </g>
        );
      })}
      <text className="ax" x={72} y={150}>
        Model FLOPs utilization
      </text>
      <GridY y={MY} ticks={[0, 0.2, 0.4, 0.6]} x0={72} x1={612} format={(v) => `${fmt(v * 100)}%`} baseline={0} />
      {order.map((c) => {
        const on = c.id === split;
        return (
          <g key={c.id}>
            <path d={linePath(c.pts.map((p) => SX(p.lg)), c.pts.map((p) => MY(p.r.mfu)))} fill="none" stroke={on ? '#333' : '#b5b5b0'} strokeWidth={on ? 2.5 : 1.5} />
            {c.pts.map((p) => (
              <circle key={p.lg} cx={SX(p.lg)} cy={MY(p.r.mfu)} r={on ? 3.5 : 2.5} fill={p.r.fits ? (on ? '#333' : '#b5b5b0') : '#fcfcfb'} stroke={on ? '#333' : '#b5b5b0'} strokeWidth={1.2} />
            ))}
          </g>
        );
      })}
      <line className="cur" x1={SX(lg)} x2={SX(lg)} y1={22} y2={240} />
      {Array.from({ length: LG_MAX - LG_MIN + 1 }, (_, i) => LG_MIN + i)
        .filter((k) => k % 2 === 1 || k === lg)
        .map((k) => (
          <text key={k} className="ax ax-m" x={SX(k)} y={258} style={k === lg ? { fill: '#111', fontWeight: 500 } : undefined}>
            {fmt(2 ** k)}
          </text>
        ))}
      <text className="ax ax-e" x={612} y={278}>
        GPUs
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the engine.

const P70 = matmulParams(MODELS['70B']);
export const NUMBERS = (() => {
  const base = runOf('70B', 'A', 1024, 8, 4);
  const fpt = trainFlopsPerToken('70B', SEQ_LEN);
  const total = fpt * TRAIN_TOKENS;
  return {
    flopsPerToken: fpt,
    totalFlops: total,
    oneGpuYears: total / (ACCELERATORS.A.bf16Tflops * 1e12) / (365.25 * 86400),
    stateTB: (P70 * (STATE_BYTES.replicated + STATE_BYTES.shardable)) / 1e12,
    base,
    tp16: runOf('70B', 'A', 1024, 16, 4),
    flat: runOf('70B', 'A', 1024, 1, 1),
    bClass: runOf('70B', 'B', 1024, 8, 4),
    lClass: runOf('70B', 'L', 1024, 8, 4),
    tp4pp1: runOf('70B', 'A', 1024, 4, 1),
    fastest: runOf('70B', 'A', 1024, FASTEST.tp, FASTEST.pp),
    s2048: scaleRun('8x4', 11),
    s4096: scaleRun('8x4', 12),
    s8192: scaleRun('8x4', 13),
    s32768: scaleRun('8x4', 15),
    p4096: scaleRun('8x1', 12),
    s32: scaleRun('8x4', 5),
  };
})();

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s = useScenario('training', TRAIN_DEFAULTS);
  const { model, gpu, lg } = s.state;
  const tp = Number(s.state.tp);
  const pp = Number(s.state.pp);
  const gpus = 2 ** lg;
  const r = runOf(model, gpu, gpus, tp, pp);
  const g = ACCELERATORS[gpu];
  const solved = fastestSolved(s.state);
  const fpt = trainFlopsPerToken(model, SEQ_LEN);

  const sc = useScenario('scaling', SCALE_DEFAULTS);
  const sr = scaleRun(sc.state.split, sc.state.lg);
  const sSplit = SCALE_SPLITS.find((x) => x.id === sc.state.split)!;
  const weekOk = weekSolved(sc.state);

  const N = NUMBERS;
  const b = N.base;

  // Live sentence for the first figure.
  let caption: string;
  if (!r.valid) caption = r.reason ?? '';
  else if (!r.fits) caption = `Each GPU would need ${fmt(r.memoryGB, 1)} GB but has ${g.memoryGB} GB. Split the model further: more GPUs per layer or more stages.`;
  else {
    const losses = [
      { v: r.bubbleS, t: `the pipeline bubble costs ${secs(r.bubbleS)} of every step` },
      { v: r.tpCommS, t: `exchanges inside each layer cost ${secs(r.tpCommS)} of every step${tp > 8 ? ', because they cross the network' : ''}` },
      { v: r.dpCommS, t: `summing gradients across copies costs ${secs(r.dpCommS)} of every step` },
    ].sort((x, y) => y.v - x.v);
    caption =
      losses[0].v > 0.005
        ? `${fmt(r.dp)} copies of the model, each across ${fmt(tp * pp)} GPUs. Arithmetic takes ${secs(r.computeS)}; ${losses[0].t}.`
        : `${fmt(r.dp)} copies of the model, each across ${fmt(tp * pp)} GPUs. Almost all of each step is arithmetic.`;
  }

  const ariaLabel = r.valid
    ? `The ${model} model on ${fmt(gpus)} ${g.name} GPUs: ${tp} per layer, ${pp} pipeline stages, ${fmt(r.dp)} copies. Each GPU needs ${fmt(r.memoryGB, 1)} GB of ${g.memoryGB} GB${r.fits ? '' : ', so it doesn’t fit'}. A step takes ${secs(r.stepS)}: ${secs(r.computeS)} of arithmetic, ${secs(r.bubbleS)} of bubble, ${secs(r.tpCommS)} of tensor-parallel exchanges and ${secs(r.dpCommS)} of gradient all-reduce.`
    : `The ${model} model on ${fmt(gpus)} ${g.name} GPUs with ${tp} per layer and ${pp} stages: ${r.reason}`;

  let status: string;
  if (model !== '70B') status = 'Choose the 70B model.';
  else if (gpu !== 'A') status = `The run is on ${g.name} GPUs. Choose the A-class.`;
  else if (gpus !== 1024) status = `The run uses ${fmt(gpus)} GPUs. Set it to 1,024.`;
  else if (!r.valid) status = r.reason ?? '';
  else if (!r.fits) status = `This split needs ${fmt(r.memoryGB, 1)} GB per GPU: more than the A-class’s 80 GB.`;
  else status = `This split takes ${daysText(r.days)}. Can another that fits finish sooner?`;

  const sCaption = !sr.valid
    ? sr.reason ?? ''
    : `${fmt(2 ** sc.state.lg)} GPUs, ${fmt(sr.dp)} copies, ${fmt(sr.microbatches)} sequence${sr.microbatches === 1 ? '' : 's'} per copy per step: ${daysText(sr.days)} at ${pct1(sr.mfu)} utilization, ${gpuHoursText(sr.gpuHours)} GPU-hours.${
        sr.bubbleS > Math.max(sr.tpCommS, sr.dpCommS) && sr.bubbleS / sr.stepS > 0.1
          ? ' The pipeline bubble is now a large share of every step.'
          : sr.dpCommS / sr.stepS > 0.1
            ? ' Summing gradients no longer hides behind the arithmetic.'
            : ''
      }`;

  const sAria = sr.valid
    ? `Days to train and model FLOPs utilization against GPU count for three ways of splitting the 70B model on A-class GPUs. Highlighted: ${sSplit.label}. At ${fmt(2 ** sc.state.lg)} GPUs it takes ${daysText(sr.days)} at ${pct1(sr.mfu)} utilization.`
    : `Days to train and utilization against GPU count. At ${fmt(2 ** sc.state.lg)} GPUs, ${sSplit.label} isn’t possible: ${sr.reason}`;

  const weekStatus = !sr.valid
    ? `${sr.reason}`
    : sr.days >= WEEK_DAYS
      ? `This takes ${daysText(sr.days)}: over a week.`
      : `This finishes in ${daysText(sr.days)} but spends ${gpuHoursText(sr.gpuHours)} GPU-hours, over the 600,000 budget.`;

  return (
    <LessonPage id="compute/3.3">
      <P>
        The previous lesson served a model whose weights were already known. Before a model can answer anything, those weights have to be learned, and that is a much
        bigger job. Training feeds the model enormous amounts of text. For every token, the model runs its forward pass, compares what it predicted with the token
        that actually came next, and then works backward through every layer to find the <b>gradients</b> of <a href={lessonHref('compute/2.5')}>Lesson 2.5</a>:
        how each weight should change to make the prediction better. Then every weight takes a small step in that direction, and the next batch of text begins.
      </P>
      <P>
        The backward pass costs about twice the forward one, since for each layer it must work out both how the error depends on the layer’s input and how it depends
        on the layer’s weights. With the forward pass at two FLOPs per parameter (<a href={lessonHref('compute/3.1')}>Lesson 3.1</a>), training costs about six
        FLOPs per parameter for every token, plus a little for attention. For the 70B model, reading sequences of {fmt(SEQ_LEN)} tokens, that is{' '}
        {fmt(N.flopsPerToken / 1e9)} billion FLOPs a token. Train it on two trillion tokens and the total is {fmt(N.totalFlops / 1e23, 2)} × 10²³{' '}
        <K tone="orange">FLOPs</K>. A single A-class 80 GB, running flat out at 989 TFLOPS, would need {fmt(N.oneGpuYears, 1)} years.
      </P>
      <P>
        Memory rules out one GPU even before time does. Training keeps far more per weight than serving: the BF16 weights and gradients, two bytes each, and for the
        optimizer that takes the steps, a full-precision copy of every weight and two running averages of its gradients, four bytes each — sixteen bytes per parameter,
        or about {fmt(N.stateTB, 1)} TB of <K tone="violet">training state</K> for the 70B model. On top of that sit the{' '}
        <K tone="violet">activations</K>: every layer’s intermediate results, kept from the forward pass because the backward pass needs them. An A-class holds 80 GB.
      </P>
      <P>
        So the model is split across many GPUs, in three ways at once. <b>Data parallelism</b>, from Lesson 2.5, runs whole copies of the model on different sequences
        and sums their gradients after every step; the twelve bytes of optimizer state per parameter can be shared out among the copies, but every copy still holds its
        own weights and gradients. <b>Tensor parallelism</b> splits each layer’s matrices across several GPUs, which must then exchange partial results four times per
        layer for every sequence — two forward, two backward — so they need the fastest links there are. <b>Pipeline parallelism</b> gives each group of GPUs a
        consecutive stage of the layers, and passes sequences from stage to stage like work along an assembly line. In the next demonstration, choose the model, the
        accelerator, the number of GPUs, how many GPUs share each layer and how many pipeline stages there are. The grid is one copy of the model, the bar beside it is
        what each GPU must hold, and the bar beneath is one training step of {fmt(BATCH_TOKENS)} tokens:
      </P>

      <Figure name="Training Workload Simulator" scenario={s}>
        <TrainDiagram model={model} gpu={gpu} gpus={gpus} tp={tp} pp={pp} r={r} ariaLabel={ariaLabel} />
        <Legend
          items={[
            { label: 'arithmetic', color: ARITH },
            { label: 'pipeline bubble', color: BUBBLE },
            { label: 'exchanges within layers', color: TPC },
            { label: 'gradient all-reduce', color: DPC },
            { label: 'training state', color: STATE },
            { label: 'activations', color: ACTS },
          ]}
        />
        <Segmented
          label="Model"
          value={model}
          onChange={(v) => s.set({ model: v })}
          options={(['8B', '70B'] as ModelId[]).map((id) => ({ value: id, label: MODELS[id].name }))}
        />
        <Segmented label="Accelerator" value={gpu} onChange={(v) => s.set({ gpu: v })} options={GPU_IDS.map((id) => ({ value: id, label: ACCELERATORS[id].name }))} />
        <Slider label="GPUs" value={lg} min={6} max={12} onChange={(v) => s.set({ lg: v })} display={fmt(gpus)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 32px' }}>
          <div>
            <div style={{ fontSize: 13, color: '#6f6f6f', marginTop: 4 }}>GPUs sharing each layer</div>
            <Segmented label="GPUs sharing each layer" value={s.state.tp} onChange={(v) => s.set({ tp: v })} options={SPLITS.map((n) => ({ value: String(n) as SplitText, label: String(n) }))} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#6f6f6f', marginTop: 4 }}>Pipeline stages</div>
            <Segmented label="Pipeline stages" value={s.state.pp} onChange={(v) => s.set({ pp: v })} options={SPLITS.map((n) => ({ value: String(n) as SplitText, label: String(n) }))} />
          </div>
        </div>
        <Readouts
          items={[
            { label: 'days to train on 2 trillion tokens', value: r.valid ? daysText(r.days) : '—', tone: 'teal' },
            { label: 'model FLOPs utilization', value: r.valid ? pct1(r.mfu) : '—' },
            { label: 'GPU-hours', value: r.valid ? gpuHoursText(r.gpuHours) : '—' },
            { label: 'memory per GPU', value: r.valid ? `${fmt(r.memoryGB, 1)} of ${g.memoryGB} GB` : '—', tone: r.valid && !r.fits ? 'red' : 'violet' },
          ]}
        />
        <Eq label="Days to train equals tokens times FLOPs per token, divided by the GPUs' combined peak times the utilization">
          <span>days</span>
          <Op>=</Op>
          <Frac
            top={
              <span>
                2 × 10¹² tokens × <K tone="orange">{fmt(fpt / 1e9)} GFLOP</K>
              </span>
            }
            bottom={
              <span>
                {fmt(gpus)} × <K tone="orange">{fmt(g.bf16Tflops)} TFLOPS</K> × {r.valid ? pct1(r.mfu) : '—'}
              </span>
            }
          />
          <Op>=</Op>
          <K tone="teal">{r.valid ? daysText(r.days) : '—'}</K>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The starting split is the kind of arrangement teams actually use. Each layer is shared by the eight GPUs of one server, so the exchanges inside a layer run over
        the fast GPU links. Four servers in a row form a pipeline, {fmt(MODELS['70B'].layers / 4)} layers to a stage, and 32 such copies of the model, each reading its own
        share of every batch, make 1,024 GPUs. Each GPU holds {fmt(b.memoryGB, 1)} GB. A step takes {secs(b.stepS)}: {secs(b.computeS)} of arithmetic,{' '}
        {secs(b.bubbleS)} in the pipeline bubble and {secs(b.tpCommS)} of exchanges within layers, while summing the gradients hides almost entirely behind the backward
        pass. The share of the GPUs’ peak that goes into the model’s own arithmetic is called the <K>model FLOPs utilization</K>, or MFU: here {pct1(b.mfu)}. At
        that rate the run takes {daysText(b.days)} and {gpuHoursText(b.gpuHours)} GPU-hours. Even the arithmetic itself reaches only {fmt(TRAIN_COMPUTE_EFFICIENCY * 100)}% of peak in our model,
        for the reasons of Chapter 2: not every operation is a large matrix multiply, and not every byte arrives in time.
      </P>
      <P>
        The pipeline bubble needs a word. A sequence enters stage one, then moves to stage two while stage one starts the next, and so on; until the pipeline fills, the
        later stages have nothing to do, and as it drains at the end of the step, the earlier ones wait. With 4 stages and 32 sequences per copy per step, the idle
        share is 3 sequences’ worth out of 35. More stages, or fewer sequences per copy, and the bubble grows.
      </P>
      <P>
        Now push the split around. Let 16 GPUs share each layer and every layer spans two servers, so its exchanges cross the network at 50 GB/s instead of the GPU links’
        450: the MFU falls to {pct1(N.tp16.mfu)} and the run stretches to {daysText(N.tp16.days)}. Go the other way, one GPU per layer and a single stage, and each GPU
        would need {fmt(N.flat.memoryGB)} GB. Swap the accelerator, too. The B-class 192 GB finishes in {daysText(N.bClass.days)}. The L-class 48 GB takes{' '}
        {daysText(N.lClass.days)}: its arithmetic is slower, and its exchanges within layers, through PCIe, take {secs(N.lClass.tpCommS)} of every step.
      </P>

      <Challenge
        id="a"
        question="Train the 70B model on 1,024 A-class GPUs as fast as possible, with a split that fits in each GPU’s memory."
        solved={solved}
        status={status}
        success={`Solved: eight GPUs per layer and a single stage, ${daysText(N.fastest.days)}. Keeping each layer inside one server keeps its exchanges on the GPU links, and with no pipeline there is no bubble. Four GPUs per layer would be faster still, ${daysText(N.tp4pp1.days)}, but each would need ${fmt(N.tp4pp1.memoryGB, 1)} GB — memory, not arithmetic, sets the limit.`}
      />

      <H2>Adding GPUs</H2>
      <P>
        Faster still means more GPUs. But one thing doesn’t grow with the cluster: the batch. Each step averages the gradients of {fmt(BATCH_TOKENS)} tokens, 1,024
        sequences, and past a certain size a bigger batch stops helping the model learn more from each token, so the batch can’t simply be raised to keep up. More
        copies of the model then means fewer sequences per copy per step. In the next demonstration, three splits of the 70B model on A-class GPUs are drawn together,
        days on top and MFU beneath; open circles mark runs that don’t fit, and the dashed line is what perfect scaling from the smallest run would give. Choose a split
        and change the number of GPUs:
      </P>

      <Figure name="Training Workload Simulator · scaling" scenario={sc}>
        <ScalingChart split={sc.state.split} lg={sc.state.lg} ariaLabel={sAria} />
        <Legend
          items={[
            { label: `days, ${sSplit.label}`, color: TEXT.teal, kind: 'line' },
            { label: `utilization, ${sSplit.label}`, color: '#333', kind: 'line' },
            { label: 'the other two splits', color: '#b5b5b0', kind: 'line' },
            { label: 'perfect scaling', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Segmented label="Split" value={sc.state.split} onChange={(v) => sc.set({ split: v })} options={SCALE_SPLITS.map((x) => ({ value: x.id, label: x.label }))} />
        <Slider label="GPUs" value={sc.state.lg} min={LG_MIN} max={LG_MAX} onChange={(v) => sc.set({ lg: v })} display={fmt(2 ** sc.state.lg)} />
        <Readouts
          items={[
            { label: 'days to train', value: sr.valid ? daysText(sr.days) : '—', tone: 'teal' },
            { label: 'model FLOPs utilization', value: sr.valid ? pct1(sr.mfu) : '—' },
            { label: 'GPU-hours', value: sr.valid ? gpuHoursText(sr.gpuHours) : '—' },
          ]}
        />
        <Caption>{sCaption}</Caption>
      </Figure>

      <P>
        With 4 stages, 32 GPUs take {daysText(N.s32.days)} at {pct1(N.s32.mfu)}. At 1,024 the run takes {daysText(b.days)}; double to 2,048 and it takes{' '}
        {daysText(N.s2048.days)}, not {fmt(b.days / 2, 1)}, as MFU slips to {pct1(N.s2048.mfu)}. At 8,192 GPUs each copy gets only {fmt(N.s8192.microbatches)} sequences per step, the bubble is a large share of
        every step, and MFU is {pct1(N.s8192.mfu)}. At 32,768, one sequence per copy, it is {pct1(N.s32768.mfu)}: {daysText(N.s32768.days)} for{' '}
        {gpuHoursText(N.s32768.gpuHours)} GPU-hours, against {gpuHoursText(b.gpuHours)} at 1,024. Every GPU-hour is paid for, used or not, so finishing sooner costs
        more.
      </P>
      <P>
        The best split also changes with scale. With a single stage there is no bubble, which made it the fastest at 1,024 GPUs in the{' '}
        <FigRef to="Training Workload Simulator">first demonstration</FigRef>. But each copy is then only eight GPUs, so at 4,096 GPUs there are 512 copies, each GPU
        holds an eighth of every gradient, and summing them over the network no longer hides behind the arithmetic: the single-stage run takes{' '}
        {daysText(N.p4096.days)} at {pct1(N.p4096.mfu)}, while 4 stages take {daysText(N.s4096.days)} at {pct1(N.s4096.mfu)}.
      </P>

      <Challenge
        id="b"
        question="Train the 70B model in under a week while spending no more than 600,000 GPU-hours."
        solved={weekOk}
        status={weekStatus}
        success={`Solved: 4,096 GPUs split 8 per layer in 4 stages, ${daysText(N.s4096.days)} and ${gpuHoursText(N.s4096.gpuHours)} GPU-hours. Fewer GPUs can’t finish in a week, and 8,192 waste too much of every hour: ${gpuHoursText(N.s8192.gpuHours)} GPU-hours.`}
      />

      <H2>What training asks of a data center</H2>
      <P>
        Put together, these results describe a very particular kind of customer. A training run wants a large block of identical GPUs — mixing accelerators would leave
        the fast ones waiting for the slow — bought in whole servers with fast links inside them and a good network between them, and it wants all of them at once, for
        weeks. Every GPU in the run takes part in every step, so if one fails, the run typically stops and restarts from its last saved checkpoint, losing the work done
        since. Its demands on latency to users are nil. Serving, as the next lesson shows, is nearly the opposite: many small, independent copies of a model, each
        answering requests that arrive at random, where how long a person waits matters as much as how many tokens come out.
      </P>
      <P>
        That difference is why the same GPU-hour can be worth such different amounts. An hour of an A-class GPU inside a 1,024-GPU block on a fast network is one
        thing; an hour of a lone card in a server with slow links is another, even if the chips are identical. Chapter 4 looks at what it takes to build the block, and
        Chapter 5 at how its hours are priced. First, in <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>, we return to serving, and to what happens when requests
        arrive faster than one at a time.
      </P>
    </LessonPage>
  );
}
