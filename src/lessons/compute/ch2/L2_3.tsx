import { useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { K_SLICE, batchedMatmul, compulsoryBytes, matmulFlops, tileFit, tiledMatmul, type TileFit } from '../../../engines/compute/matmul';
import { ACCELERATORS, SM_LIMITS, ridgePoint } from '../../../model/compute/hardware';

// ---------------------------------------------------------------------------
// The model: two 8,192 × 8,192 BF16 matrices multiplied on the A-class, and one 8,192-wide layer
// applied to a batch of vectors.

const GPU = ACCELERATORS.A;
/** Side of the square matrices: the width of a layer of the 70B model. */
export const N = 8192;
const SHAPE = { m: N, n: N, k: N };
/** Largest group: 11 × 11 = 121 tiles, as many as the 132 SMs can run at once. */
export const MAX_GROUP = 11;
/** The A-class's ridge point, FLOPs per byte (≈ 295). */
export const RIDGE = ridgePoint(GPU);
export const FLOPS = matmulFlops(SHAPE);
export const MIN_BYTES = compulsoryBytes(SHAPE);
/** Bytes in one 8,192 × 8,192 BF16 matrix. */
export const MATRIX_BYTES = 2 * N * N;

export const MATMUL_DEFAULTS = { tileExp: 0, group: 1 };
export const BATCH_DEFAULTS = { batch: 1 };

export interface MatmulRun {
  tile: number;
  group: number;
  fit: TileFit;
  /** Times each strip of A (and of B) is read from memory. */
  reads: number;
  flops: number;
  bytes: number;
  intensity: number;
  computeS: number;
  memoryS: number;
  totalS: number;
  bound: 'compute' | 'memory';
  tflops: number;
}

/** The 8,192 multiply with tiles of side 2^tileExp shared in groups of group × group. */
export function matmulRun(tileExp: number, group: number): MatmulRun {
  const tile = 2 ** tileExp;
  return { tile, group, fit: tileFit(tile), reads: Math.ceil(N / (tile * group)), ...tiledMatmul(SHAPE, GPU, tile, group) };
}

/** Challenge a: the A-class's full arithmetic rate, with a tile that fits on an SM. */
export function fullSpeedSolved(tileExp: number, group: number): boolean {
  const r = matmulRun(tileExp, group);
  return r.fit.fits && r.bound === 'compute';
}

/** Smallest group at which tiles of side 2^tileExp make the multiply compute-bound (null if none up to MAX_GROUP). */
export function smallestGroup(tileExp: number): number | null {
  for (let g = 1; g <= MAX_GROUP; g++) if (matmulRun(tileExp, g).bound === 'compute') return g;
  return null;
}

/** One 8,192 × 8,192 BF16 weight matrix applied to a batch of vectors. */
export function batchRun(batch: number) {
  return batchedMatmul(N, N, batch, GPU);
}

export const MAX_BATCH = 1024;
/** Time for the layer with a single vector, s. */
export const ONE_VECTOR_S = batchRun(1).totalS;
/** The challenge's allowance: no more than 10% longer than a single vector. */
export const ALLOWANCE = 1.1;

/** Challenge b: the largest batch whose time stays within 10% of a single vector's. */
export function cheapBatchSolved(batch: number): boolean {
  const within = (b: number) => batchRun(b).totalS <= ALLOWANCE * ONE_VECTOR_S;
  return within(batch) && (batch >= MAX_BATCH || !within(batch + 1));
}

/** The answer to challenge b. */
export function largestCheapBatch(): number {
  let best = 1;
  for (let b = 1; b <= MAX_BATCH; b++) if (batchRun(b).totalS <= ALLOWANCE * ONE_VECTOR_S) best = b;
  return best;
}

/** The smallest batch at which the layer is limited by arithmetic rather than memory. */
export function firstComputeBound(): number {
  for (let b = 1; b <= MAX_BATCH; b++) if (batchRun(b).bound === 'compute') return b;
  return Infinity;
}

// ---------------------------------------------------------------------------
// Formatting.

export function gb(bytes: number): string {
  const v = bytes / 1e9;
  return `${fmt(v, v >= 100 ? 0 : v >= 1 ? 1 : 2)} GB`;
}

export function ms(seconds: number): string {
  const v = seconds * 1e3;
  return `${fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} ms`;
}

export function us(seconds: number): string {
  const v = seconds * 1e6;
  return `${fmt(v, v >= 100 ? 0 : v >= 1 ? 1 : 2)} µs`;
}

export function ns(seconds: number): string {
  return `${fmt(seconds * 1e9)} ns`;
}

/** FLOPs per byte: one decimal below 100. */
export function inten(i: number): string {
  return fmt(i, i >= 100 ? 0 : 1);
}

export function tf(t: number): string {
  return fmt(t, t >= 10 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Figure 1: the three matrices, the strips a group of tiles reads, and what that costs.

const COMPUTE = GRAPHIC.orange;
const MEMORY = GRAPHIC.violet;
const S = 124;
const AX = 14;
const BX = 156;
const BY = 20;
const CY = 158;
const PX = S / N;

const LX0 = 336;
const LX1 = 624;
const logX = (lo: number, hi: number) => {
  const f = scale(Math.log10(lo), Math.log10(hi), LX0, LX1);
  return (v: number) => f(Math.log10(Math.max(lo, Math.min(hi, v))));
};
const BX_LOG = logX(0.1, 10000);
const IX_LOG = logX(0.1, 10000);
const DECADES = [0.1, 1, 10, 100, 1000, 10000];
const KB_X = scale(0, 256, 434, 520);

function MemBar({ y, label, used, budget }: { y: number; label: string; used: number; budget: number }) {
  const over = used > budget + 1e-9;
  const color = over ? GRAPHIC.red : MEMORY;
  return (
    <g>
      <text x={LX0} y={y + 10} className="ax">
        {label}
      </text>
      <rect x={KB_X(0)} y={y} width={KB_X(256) - KB_X(0)} height={12} fill="#f1f1ee" />
      <rect x={KB_X(0)} y={y} width={Math.max(1, KB_X(Math.min(256, used)) - KB_X(0))} height={12} fill={color} opacity={0.75} />
      <line x1={KB_X(budget)} x2={KB_X(budget)} y1={y - 3} y2={y + 15} stroke="#333" strokeWidth={1.5} />
      <text x={528} y={y + 10} className="ax" style={over ? { fill: TEXT.red } : undefined}>
        {used < 1 ? `${fmt(used * 1024)} bytes` : `${fmt(used)} KB`} of {fmt(budget)} KB
      </text>
    </g>
  );
}

function TilingFigure({ r, playing }: { r: MatmulRun; playing: boolean }) {
  const [p, setP] = useState(0);
  useAnimationFrame((dt) => setP((x) => (x + dt / 4) % 1), playing);

  const span = Math.min(N, r.tile * r.group);
  const spanPx = Math.max(3, span * PX);
  const r0 = Math.floor((0.3 * N) / span) * span;
  const c0 = Math.floor((0.55 * N) / span) * span;
  const gy = CY + Math.min(r0 * PX, S - spanPx);
  const gx = BX + Math.min(c0 * PX, S - spanPx);
  const tilePx = r.tile * PX;
  const slice = Math.max(2, K_SLICE * PX);
  const kx = AX + p * (S - slice);
  const ky = BY + p * (S - slice);
  const fits = r.fit.fits;
  const lines: number[] = [];
  if (tilePx >= 4) for (let i = 1; i < r.group && i * tilePx < spanPx; i++) lines.push(i * tilePx);

  return (
    <svg
      className="diagram"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Multiplying two ${fmt(N)} × ${fmt(N)} matrices with ${r.tile} × ${r.tile} tiles in groups of ${r.group} × ${r.group}${fits ? '' : ' (a tile too big to fit on an SM)'}: each strip of A and B is read from memory ${fmt(r.reads)} times, ${gb(r.bytes)} in all, an intensity of ${inten(r.intensity)} FLOPs per byte. The multiply takes ${ms(r.totalS)}, limited by ${r.bound === 'memory' ? 'memory' : 'arithmetic'}.`}
    >
      {/* The matrices: B above C, A to its left, so A's rows line up with C's rows and B's columns with C's columns. */}
      <rect x={AX} y={CY} width={S} height={S} fill="#f6f6f3" stroke="#bbb" />
      <rect x={BX} y={BY} width={S} height={S} fill="#f6f6f3" stroke="#bbb" />
      <rect x={BX} y={CY} width={S} height={S} fill="#f6f6f3" stroke="#bbb" />
      <rect x={AX} y={gy} width={S} height={spanPx} fill={tint(MEMORY, 0.35)} />
      <rect x={gx} y={BY} width={spanPx} height={S} fill={tint(MEMORY, 0.35)} />
      <rect x={kx} y={gy} width={slice} height={spanPx} fill={MEMORY} />
      <rect x={gx} y={ky} width={spanPx} height={slice} fill={MEMORY} />
      <rect x={gx} y={gy} width={spanPx} height={spanPx} fill={tint(COMPUTE, 0.55)} />
      {lines.map((d) => (
        <g key={d}>
          <line x1={gx + d} x2={gx + d} y1={gy} y2={gy + spanPx} stroke="#fcfcfb" strokeWidth={1} />
          <line x1={gx} x2={gx + spanPx} y1={gy + d} y2={gy + d} stroke="#fcfcfb" strokeWidth={1} />
        </g>
      ))}
      <rect x={gx} y={gy} width={Math.max(2, tilePx)} height={Math.max(2, tilePx)} fill={COMPUTE} />
      <text x={AX} y={CY - 8} className="lab">
        A
      </text>
      <text x={BX + S + 8} y={BY + 12} className="lab">
        B
      </text>
      <text x={BX + S + 8} y={CY + 12} className="lab">
        C
      </text>
      <text x={AX} y={BY + 12} className="ax">
        each {fmt(N)} × {fmt(N)}
      </text>
      <text x={AX} y={BY + 28} className="ax">
        dark: one SM’s tile
      </text>
      <text x={AX} y={BY + 44} className="ax">
        and the slice it
      </text>
      <text x={AX} y={BY + 60} className="ax">
        is working on
      </text>
      <text x={AX + S / 2} y={CY + S + 14} className="ax ax-m">
        k →
      </text>

      {/* What the multiply costs. */}
      <text x={LX0} y={16} className="lab">
        Each strip of A and B is read {fmt(r.reads)}× from memory
      </text>

      <text x={LX0} y={40} className="ax">
        Bytes moved from memory, GB
      </text>
      <line x1={BX_LOG(MIN_BYTES / 1e9)} x2={BX_LOG(MIN_BYTES / 1e9)} y1={50} y2={76} stroke="#777" strokeDasharray="3 3" />
      <text x={BX_LOG(MIN_BYTES / 1e9)} y={58} className="ax ax-e" style={{ fontSize: 11 }} dx={-3}>
        least
      </text>
      <rect x={LX0} y={62} width={Math.max(1, BX_LOG(r.bytes / 1e9) - LX0)} height={12} fill={MEMORY} opacity={0.75} />
      <line className="base" x1={LX0} x2={LX1} y1={74} y2={74} />
      {DECADES.map((d) => (
        <text key={d} x={BX_LOG(d)} y={90} className={d === 10000 ? 'ax ax-e' : d === 0.1 ? 'ax' : 'ax ax-m'}>
          {fmt(d, d < 1 ? 1 : 0)}
        </text>
      ))}

      <text x={LX0} y={116} className="ax">
        Arithmetic intensity, FLOPs per byte
      </text>
      <rect x={LX0} y={122} width={IX_LOG(RIDGE) - LX0} height={32} fill={tint(MEMORY, 0.25)} />
      <rect x={IX_LOG(RIDGE)} y={122} width={LX1 - IX_LOG(RIDGE)} height={32} fill={tint(COMPUTE, 0.25)} />
      <text x={LX0 + 4} y={135} className="ax" style={{ fill: TEXT.violet }}>
        limited by memory
      </text>
      <text x={LX1 - 4} y={135} className="ax ax-e" style={{ fill: TEXT.orange }}>
        by arithmetic
      </text>
      <line x1={IX_LOG(RIDGE)} x2={IX_LOG(RIDGE)} y1={118} y2={158} stroke="#333" strokeWidth={1.5} />
      <circle cx={IX_LOG(r.intensity)} cy={146} r={5} fill={COMPUTE} stroke="#fcfcfb" strokeWidth={2} />
      {fits && (
        <text
          x={IX_LOG(r.intensity) + (IX_LOG(r.intensity) > 560 ? -9 : 9)}
          y={150}
          className={IX_LOG(r.intensity) > 560 ? 'ax ax-e' : 'ax'}
          style={{ fill: TEXT.ink, fontWeight: 500, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
        >
          {inten(r.intensity)}
        </text>
      )}
      {DECADES.map((d) => (
        <text key={d} x={IX_LOG(d)} y={170} className={d === 10000 ? 'ax ax-e' : d === 0.1 ? 'ax' : 'ax ax-m'}>
          {fmt(d, d < 1 ? 1 : 0)}
        </text>
      ))}
      <text x={IX_LOG(RIDGE)} y={184} className="ax ax-m">
        ridge {fmt(RIDGE)}
      </text>

      <text x={LX0} y={206} className="ax">
        On-chip memory one tile needs
      </text>
      <MemBar y={216} label="Registers" used={r.fit.accumulatorKB} budget={r.fit.registerBudgetKB} />
      <MemBar y={240} label="Shared memory" used={r.fit.sharedKB} budget={r.fit.sharedBudgetKB} />
      <text x={LX0} y={278} className="ax" style={fits ? undefined : { fill: TEXT.red }}>
        {fits ? `Fits: an SM has ${fmt((SM_LIMITS.registers * 4) / 1024)} KB of registers and ${SM_LIMITS.sharedKB} KB of shared memory.` : 'Too big: the tile’s running totals don’t fit in registers.'}
      </text>
    </svg>
  );
}

function tilingCaption(r: MatmulRun): string {
  if (!r.fit.fits)
    return `A ${r.tile} × ${r.tile} tile needs ${fmt(r.fit.accumulatorKB)} KB of running totals, more than the ${fmt(r.fit.registerBudgetKB)} KB of registers they may use, so no SM can hold one. If it could, the multiply would move ${gb(r.bytes)}.`;
  const share = r.tflops / GPU.bf16Tflops;
  if (r.tile === 1 && r.group === 1)
    return `With no tiling, both numbers are fetched for every multiply-add: ${gb(r.bytes)} of traffic, and the arithmetic reaches only ${fmt(share * 100, 1)}% of the matrix units’ peak.`;
  if (r.bound === 'memory')
    return `The multiply moves ${gb(r.bytes)} and waits on memory, reaching ${fmt(share * 100)}% of the A-class’s ${fmt(GPU.bf16Tflops)} TFLOPS.`;
  return `The multiply moves ${gb(r.bytes)}, little enough that the matrix units, not memory, set the pace, at their full rate.`;
}

// ---------------------------------------------------------------------------
// Figure 2: one layer, a batch of vectors.

const TX = scale(0, MAX_BATCH, 64, 620);
const TY = scale(0, 150, 196, 30);
const CURVE = Array.from({ length: MAX_BATCH }, (_, i) => batchRun(i + 1));
const CURVE_PATH = linePath(
  CURVE.map((_, i) => TX(i + 1)),
  CURVE.map((c) => TY(c.totalS * 1e6)),
);
const CROSS = firstComputeBound();

function BatchFigure({ batch }: { batch: number }) {
  const r = CURVE[batch - 1];
  const limit = ALLOWANCE * ONE_VECTOR_S * 1e6;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 232"
      role="img"
      aria-label={`Time for one ${fmt(N)} × ${fmt(N)} layer against the number of vectors in the batch: flat at about ${us(ONE_VECTOR_S)} while memory limits it, rising after ${CROSS} vectors. A batch of ${batch} takes ${us(r.totalS)}.`}
    >
      <text className="ax" x={64} y={14}>
        Time for the layer
      </text>
      <rect x={TX(0)} y={TY(150)} width={TX(CROSS - 0.5) - TX(0)} height={TY(0) - TY(150)} fill={tint(MEMORY, 0.12)} />
      <rect x={TX(CROSS - 0.5)} y={TY(150)} width={TX(MAX_BATCH) - TX(CROSS - 0.5)} height={TY(0) - TY(150)} fill={tint(COMPUTE, 0.12)} />
      <GridY y={TY} ticks={[0, 50, 100, 150]} x0={64} x1={620} format={(v) => `${v} µs`} baseline={0} />
      <text className="ax" x={TX(CROSS / 2)} y={TY(140)} textAnchor="middle" style={{ fill: TEXT.violet }}>
        limited by memory
      </text>
      <text className="ax" x={TX((CROSS + MAX_BATCH) / 2)} y={TY(140)} textAnchor="middle" style={{ fill: TEXT.orange }}>
        limited by arithmetic
      </text>
      <line x1={TX(0)} x2={TX(MAX_BATCH)} y1={TY(limit)} y2={TY(limit)} stroke="#777" strokeDasharray="4 4" />
      <text className="ax" x={TX(8)} y={TY(limit) - 5}>
        10% more than one vector
      </text>
      <path d={CURVE_PATH} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={TX(batch)} x2={TX(batch)} y1={TY(150)} y2={TY(0)} />
      <circle cx={TX(batch)} cy={TY(r.totalS * 1e6)} r={6} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={2} />
      {[1, 256, 512, 768, 1024].map((b) => (
        <text key={b} className={b === 1024 ? 'ax ax-e' : 'ax ax-m'} x={b === 1024 ? TX(b) + 2 : TX(b)} y={214}>
          {fmt(b)}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={230}>
        vectors in the batch
      </text>
    </svg>
  );
}

function batchCaption(batch: number): string {
  const r = batchRun(batch);
  const extra = r.totalS / ONE_VECTOR_S - 1;
  if (batch === 1) return `One vector: reading the ${fmt(MATRIX_BYTES / 1e6)} MB of weights takes ${us(r.memoryS)}; the arithmetic would take ${us(r.computeS)}.`;
  if (r.bound === 'memory')
    return `${fmt(batch)} vectors take ${fmt(extra * 100, extra < 0.1 ? 1 : 0)}% longer than one: the weights still take ${us(r.memoryS)} to read, and the extra arithmetic, ${us(r.computeS)}, fits inside that time.`;
  return `Past ${CROSS - 1} vectors the arithmetic takes longer than reading the weights, so each extra vector adds its own ${ns(r.computeS / batch)}.`;
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const m = useScenario('tiling', MATMUL_DEFAULTS);
  const { tileExp, group } = m.state;
  const run = matmulRun(tileExp, group);
  const play = usePlay(true);
  const solvedA = fullSpeedSolved(tileExp, group);

  const b = useScenario('batch', BATCH_DEFAULTS);
  const batch = b.state.batch;
  const br = batchRun(batch);
  const solvedB = cheapBatchSolved(batch);

  // Numbers for the prose.
  const naive = matmulRun(0, 1);
  const t128 = matmulRun(7, 1);
  const g8 = matmulRun(7, 8);
  const t256 = matmulRun(8, 1);
  const g128 = smallestGroup(7) ?? MAX_GROUP;
  const g64 = smallestGroup(6) ?? MAX_GROUP;
  const atG128 = matmulRun(7, g128);
  const minIntensity = FLOPS / MIN_BYTES;
  const b256 = batchRun(256);
  const perVector = batchRun(MAX_BATCH).totalS / MAX_BATCH;
  const cheapest = largestCheapBatch();
  const fp32 = GPU.fp32Tflops;

  const statusA = !run.fit.fits
    ? `A ${run.tile} × ${run.tile} tile doesn’t fit on an SM.`
    : run.bound === 'memory'
      ? `Right now the multiply reaches ${tf(run.tflops)} TFLOPS at an intensity of ${inten(run.intensity)} FLOPs per byte, short of the ${fmt(RIDGE)} it needs.`
      : 'Compute-bound.';
  const statusB =
    br.totalS > ALLOWANCE * ONE_VECTOR_S
      ? `A batch of ${fmt(batch)} takes ${us(br.totalS)}, more than 10% longer than one vector’s ${us(ONE_VECTOR_S)}.`
      : `A batch of ${fmt(batch)} takes ${us(br.totalS)}, within 10% of one vector’s ${us(ONE_VECTOR_S)}. Can it be larger? The arrow keys move the slider one vector at a time.`;

  return (
    <LessonPage id="compute/2.3">
      <P>
        <a href={lessonHref('compute/2.2')}>The previous lesson</a> kept an SM’s schedulers busy by giving them enough warps to fill the long wait for memory. That
        works only if each warp has plenty of arithmetic to do with the numbers it loads. This lesson is about the one operation that has more than enough:
        multiplying matrices. As Chapter 3 will show, a language model spends nearly all of its arithmetic on it, and GPUs have been reshaped around it.
      </P>
      <P>
        To multiply a matrix A, with m rows and k columns, by a matrix B, with k rows and n columns, each entry of the result C is the dot product of one row of A
        with one column of B: k multiplications and k additions. C has m × n entries, so the whole product takes{' '}
        <K tone="orange">2 × m × n × k floating-point operations</K>. For two {fmt(N)} × {fmt(N)} matrices — the width of a layer of the 70B model — that is{' '}
        1.1 × 10<Sup>12</Sup> FLOPs.
      </P>
      <P>
        Besides its 16,896 ordinary lanes, the A-class 80 GB has matrix units, often called tensor cores, each of which multiplies a small block of one matrix by a
        small block of another in a single instruction. Together they deliver {fmt(GPU.bf16Tflops)} TFLOPS of BF16 arithmetic, against {fmt(fp32)} TFLOPS from the
        ordinary lanes, so the A-class could finish the whole multiply in {ms(FLOPS / (GPU.bf16Tflops * 1e12))} — if the numbers reached the arithmetic fast enough.
        A and B hold {fmt(N * N)} numbers each, {fmt(MATRIX_BYTES / 1e6)} MB apiece in BF16, and they sit in the GPU’s memory, which delivers{' '}
        <K tone="violet">{GPU.bandwidthTBs} TB per second</K>.
      </P>
      <P>
        The simplest program fetches both numbers for every multiply-add: four bytes of memory for two FLOPs. Its <b>arithmetic intensity</b> — FLOPs per byte moved
        — is {inten(naive.intensity)}. It would move {gb(naive.bytes)} and take {ms(naive.totalS)}, about {fmt(Math.round(naive.totalS / g8.totalS / 10) * 10)} times longer than the
        arithmetic needs. Nothing about the multiplication forces that. Every number in A is used {fmt(N)} times, once for each column of C; the simple loop just
        fetches it again each time.
      </P>
      <P>
        The cure is to compute C in square tiles. One SM takes a tile of C, T entries on a side, and works through the strip of A’s rows and the strip of B’s
        columns that the tile needs, a slice at a time: it loads {K_SLICE} columns of the A strip and {K_SLICE} rows of the B strip into its shared memory,
        multiplies them into the tile’s running totals, kept in registers, and moves on to the next slice. Each number it loads is now used T times instead of once.
        In the next demonstration, the orange square in C is a group of tiles and the darkest one is a single SM’s tile; the strips of A and B they read are shaded,
        and the dark bands sweeping across them are the slices being worked on. Start by making the tiles bigger — the second control comes later:
      </P>

      <Figure name="Matrix Multiplication Lab" scenario={m} play={play}>
        <TilingFigure r={run} playing={play.playing} />
        <Readouts
          items={[
            { label: !run.fit.fits ? 'TFLOPS' : run.bound === 'memory' ? 'TFLOPS, memory-bound' : 'TFLOPS, compute-bound', value: run.fit.fits ? tf(run.tflops) : '—', tone: 'orange' },
          ]}
        />
        <Slider
          label="Tile size"
          tone="orange"
          value={tileExp}
          min={0}
          max={8}
          onChange={(v) => m.set({ tileExp: v })}
          display={`${run.tile} × ${run.tile}${run.fit.fits ? '' : ', too big'}`}
        />
        <Slider
          label="Tiles sharing reads"
          tone="violet"
          value={group}
          min={1}
          max={MAX_GROUP}
          onChange={(v) => m.set({ group: v })}
          display={`${group} × ${group} tiles`}
        />
        <Eq label="Time is the longer of the arithmetic time and the memory time">
          <span>time</span>
          <Op>=</Op>
          <span>max(</span>
          <K tone="orange">{run.fit.fits ? ms(run.computeS) : '—'}</K>
          <span>arithmetic,</span>
          <K tone="violet">{run.fit.fits ? ms(run.memoryS) : '—'}</K>
          <span>memory)</span>
          <Op>=</Op>
          <K tone="teal">{run.fit.fits ? ms(run.totalS) : '—'}</K>
        </Eq>
        <Caption>{tilingCaption(run)}</Caption>
      </Figure>

      <P>
        Each doubling of the tile halves the traffic and doubles the intensity, which for two-byte BF16 numbers is T ÷ 2 FLOPs per byte. What stops the doubling
        is room on the SM. The tile’s running totals are kept in FP32 for accuracy, four bytes each, and only about half of an SM’s{' '}
        {fmt((SM_LIMITS.registers * 4) / 1024)} KB of registers can go to them; the rest hold the addresses and counters every thread needs. A 128 × 128 tile needs{' '}
        {fmt(t128.fit.accumulatorKB)} KB of running totals and {fmt(t128.fit.sharedKB)} KB of shared memory for its slices (two of each, so the next can load while
        the current one is used). A 256 × 256 tile would need {fmt(t256.fit.accumulatorKB)} KB of running totals: it doesn’t fit. The largest tile cuts the traffic
        to {gb(t128.bytes)} and lifts the intensity to {inten(t128.intensity)}, and the multiply takes {ms(t128.totalS)}:{' '}
        {fmt(naive.totalS / t128.totalS)} times faster than the simple loop, yet still only {tf(t128.tflops)} TFLOPS, {fmt((t128.tflops / GPU.bf16Tflops) * 100)}% of
        what the matrix units can do.
      </P>
      <P>
        Why does {inten(t128.intensity)} fall short? At {GPU.bandwidthTBs} TB/s, memory delivers enough bytes for {inten(t128.intensity)} ×{' '}
        {GPU.bandwidthTBs} = {tf(t128.tflops)} TFLOPS of arithmetic. To keep all {fmt(GPU.bf16Tflops)} TFLOPS busy, every byte must feed {fmt(GPU.bf16Tflops)} ÷{' '}
        {GPU.bandwidthTBs} = {fmt(RIDGE)} FLOPs. That figure is the A-class’s <b>ridge point</b>, and it belongs to the hardware, not the program: below it a
        calculation waits on memory, above it on arithmetic. The intensity strip in the demonstration marks it.
      </P>

      <H2>Sharing through the cache</H2>
      <P>
        The SMs don’t work alone. All 132 of them compute tiles at once, and neighboring tiles need the same strips: tiles in one row of C read the same strip of A,
        tiles in one column the same strip of B. Between the SMs and memory sits the A-class’s {GPU.l2MB} MB L2 cache, so when neighboring tiles run at the same
        time, the first to ask for a slice brings it in from memory and the others find it waiting in the cache. A group of g × g tiles then reads each strip from
        memory once instead of g times. Now raise the second control in <FigRef to="Matrix Multiplication Lab">the demonstration</FigRef>, the size of the group, up to
        11 × 11 = 121 tiles — about as many as the 132 SMs can run at once.
      </P>
      <P>
        With 128 × 128 tiles in groups of 8 × 8, each strip is read from memory {fmt(g8.reads)} times instead of {fmt(t128.reads)}. The multiply moves {gb(g8.bytes)},
        its intensity is {inten(g8.intensity)}, past the ridge, and the time falls to {ms(g8.totalS)} — the time the arithmetic alone needs. The matrix units, not
        memory, now set the pace. The least any program could move, reading A and B once and writing C once, is {gb(MIN_BYTES)}, an intensity of{' '}
        {fmt(minIntensity)}. Large matrix multiplications offer far more reuse than the hardware needs, and that is why they run so well on GPUs. Our model is an
        idealization, with every unit at its peak and every load perfectly overlapped with arithmetic; real matrix libraries come close, but not all the way.
      </P>

      <Challenge
        id="a"
        question={`Make the ${fmt(N)} × ${fmt(N)} multiply run at the A-class’s full ${fmt(GPU.bf16Tflops)} TFLOPS, using a tile that fits on an SM.`}
        solved={solvedA}
        status={statusA}
        success={`Solved. Any fitting tile works once the intensity passes the ridge of ${fmt(RIDGE)} FLOPs per byte. With 128 × 128 tiles the smallest group that does it is ${g128} × ${g128}: each strip is read ${fmt(atG128.reads)} times, the intensity is ${inten(atG128.intensity)}, and the multiply takes ${ms(atG128.totalS)}, as long as its arithmetic. With 64 × 64 tiles it takes a group of ${g64} × ${g64}; smaller tiles can’t get there at all.`}
      />

      <H2>Batches of vectors</H2>
      <P>
        Not every multiplication is so generous. Each layer of a language model multiplies a weight matrix by vectors that stand for the text passing through it, one vector per word or piece of a word,
        and when a model writes its reply one piece at a time, each step multiplies the weights by a single vector. A matrix times one vector uses each weight exactly
        once — two FLOPs for every two-byte weight read, an intensity of about 1 — and no tiling can help, because there is no reuse to find. Serve several
        requests at once, though, and all their vectors can share one pass over the weights. In the next demonstration, one {fmt(N)} × {fmt(N)} BF16 weight matrix,{' '}
        {fmt(MATRIX_BYTES / 1e6)} MB of it, is applied to a batch of vectors on the A-class. Change the size of the batch:
      </P>

      <Figure name="Matrix Multiplication Lab · batch" scenario={b}>
        <BatchFigure batch={batch} />
        <Readouts
          items={[
            { label: 'FLOPs per byte', value: inten(br.intensity) },
            { label: 'time per vector', value: br.totalS / batch >= 1e-6 ? us(br.totalS / batch) : ns(br.totalS / batch), tone: 'teal' },
            { label: 'TFLOPS achieved', value: tf(br.tflops), tone: 'orange' },
          ]}
        />
        <Slider label="Vectors in the batch" tone="orange" value={batch} min={1} max={MAX_BATCH} onChange={(v) => b.set({ batch: v })} display={fmt(batch)} />
        <Eq label="Time is the longer of the arithmetic time and the memory time">
          <span>time</span>
          <Op>=</Op>
          <span>max(</span>
          <K tone="orange">{us(br.computeS)}</K>
          <span>arithmetic,</span>
          <K tone="violet">{us(br.memoryS)}</K>
          <span>memory)</span>
          <Op>=</Op>
          <K tone="teal">{us(br.totalS)}</K>
        </Eq>
        <Caption>{batchCaption(batch)}</Caption>
      </Figure>

      <P>
        For a single vector the layer takes {us(ONE_VECTOR_S)}, nearly all of it spent reading the weights, and the matrix units achieve{' '}
        {tf(batchRun(1).tflops)} TFLOPS — about a third of one percent of their peak. A batch of 256 vectors takes {us(b256.totalS)}: 256 times the work for{' '}
        {fmt((b256.totalS / ONE_VECTOR_S - 1) * 100)}% more time. The weights cost the same to read whatever the batch, and until the batch reaches {CROSS} vectors,
        where the intensity crosses the ridge, the extra arithmetic hides inside the time memory takes anyway. Past that point the layer is compute-bound, and each
        vector adds its own share of arithmetic, {ns(perVector)}. A vector served alone costs about {fmt(ONE_VECTOR_S / perVector)} times as much.
      </P>

      <Challenge
        id="b"
        question={`Predict first: one vector takes ${us(ONE_VECTOR_S)}, and past the ridge the layer’s time is its arithmetic, ${ns(perVector)} for every vector. How many vectors fit in ${us(ALLOWANCE * ONE_VECTOR_S)}, 10% more than one vector’s time? Then make the batch as large as possible while the layer takes no more than 10% longer than it does for a single vector.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${fmt(cheapest)} vectors take ${us(batchRun(cheapest).totalS)}, and one more would pass the 10% mark — as predicted, ${us(ALLOWANCE * ONE_VECTOR_S)} ÷ ${ns(perVector)} ≈ ${fmt(Math.floor((ALLOWANCE * ONE_VECTOR_S) / perVector))}. Up to ${CROSS - 1} vectors the time hardly moves, because memory sets it; beyond, the arithmetic sets it, so only a few more vectors fit under the line.`}
      />

      <H2>What an hour of GPU time is worth</H2>
      <P>
        The two demonstrations make the same point from opposite ends. The A-class’s {fmt(GPU.bf16Tflops)} TFLOPS is a ceiling, not a promise. The same chip, for the
        same hour, delivers {tf(naive.tflops)} TFLOPS on a naive multiply, {tf(t128.tflops)} on a well-tiled one, {fmt(GPU.bf16Tflops)} when its tiles share through
        the cache — and {tf(batchRun(1).tflops)} when it applies a layer to one vector at a time. How much useful work an hour of GPU time produces depends on the
        shape of the work as much as on the chip. That is why, in Chapter 3, serving many users at once turns out to be the central fact of the economics of running
        a model (<a href={lessonHref('compute/3.2')}>Lesson 3.2</a>), and why the size of a batch trades against how long each user waits (
        <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>).
      </P>
      <P>
        Both demonstrations ran into the same wall: bytes per second from memory. A cache softened it in the first and batching in the second. The{' '}
        <a href={lessonHref('compute/2.4')}>next lesson</a> looks at that wall directly — the GPU’s memory hierarchy, from registers to HBM, and the roofline that
        ties a calculation’s intensity to the speed it can reach.
      </P>
    </LessonPage>
  );
}
