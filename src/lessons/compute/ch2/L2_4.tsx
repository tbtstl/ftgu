import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  pct,
  useScenario,
} from '../../../framework';
import { batchedMatmul } from '../../../engines/compute/matmul';
import { attainableTflops, cachedKernel, type CachedResult, type MachineSpec } from '../../../engines/compute/roofline';
import { GPU } from '../../../engines/compute/parallel';
import { ACCELERATORS, GPU_COLOR, GPU_LIST, SM_LIMITS, ridgePoint, type GpuId } from '../../../model/compute/hardware';
import { MODELS } from '../../../model/compute/models';

// ---------------------------------------------------------------------------
// The kernels. Intensities are FLOPs per byte the kernel reads or writes once, at BF16.

const A = ACCELERATORS.A;
/** The 70B model's width: its layers are 8,192 × 8,192 matrices, as in Lesson 2.3. */
export const D = MODELS['70B'].d;
/** One such weight matrix in BF16, bytes (134 MB). */
export const LAYER_BYTES = 2 * D * D;

export type KernelId = 'add' | 'norm' | 'gemv' | 'gemm';

export const KERNEL_NAME: Record<KernelId, string> = {
  add: 'Elementwise add',
  norm: 'Normalization',
  gemv: 'Matrix × vectors',
  gemm: 'Large matrix multiply',
};

/** FLOPs per byte for a batch of `batch` vectors through an 8,192 × 8,192 layer (Lesson 2.3's batchedMatmul). */
export function batchIntensity(batch: number): number {
  const r = batchedMatmul(D, D, batch, A);
  return r.flops / r.bytes;
}

/** A kernel's FLOPs per byte it touches. */
export function kernelIntensity(kernel: KernelId, batch: number): number {
  switch (kernel) {
    case 'add':
      return 1 / 6;
    case 'norm':
      return 1;
    case 'gemv':
      return batchIntensity(batch);
    case 'gemm':
      // An 8,192-square multiply that reads each matrix once and writes the result once: 2n³ / (3 × 2n²).
      return D / 3;
  }
}

export interface MemState {
  kernel: KernelId;
  batch: number;
  /** log10 of the working set in MB. */
  wsLog: number;
  passes: number;
  /** HBM bandwidth, TB/s. */
  bw: number;
}

export const MEM_DEFAULTS: MemState = { kernel: 'gemv', batch: 1, wsLog: Math.log10(LAYER_BYTES / 1e6), passes: 1, bw: A.bandwidthTBs };
export const WS_MAX_LOG = Math.log10(A.memoryGB * 1000);

/** The A-class with a chosen HBM bandwidth. */
export function machine(bw: number): MachineSpec {
  return { peakTflops: A.bf16Tflops, bandwidthTBs: bw, cacheMB: A.l2MB, cacheTBs: A.l2TBs };
}

/** Run the demonstration's kernel: FLOPs = intensity × working set × passes. */
export function runMem(s: MemState): CachedResult & { codeIntensity: number; flops: number; ws: number } {
  const codeIntensity = kernelIntensity(s.kernel, s.batch);
  const ws = 10 ** s.wsLog * 1e6;
  const flops = codeIntensity * ws * s.passes;
  return { ...cachedKernel({ flops, workingSetBytes: ws, passes: s.passes }, machine(s.bw)), codeIntensity, flops, ws };
}

let smallestCache: number | null = null;
/** The smallest batch at which matrix × vectors, read once at the A-class's own bandwidth, stops waiting on memory. */
export function smallestComputeBatch(): number {
  if (smallestCache !== null) return smallestCache;
  for (let b = 1; b <= 1024; b++) {
    if (runMem({ ...MEM_DEFAULTS, kernel: 'gemv', batch: b }).bound === 'compute') return (smallestCache = b);
  }
  return (smallestCache = Infinity);
}

const atOwnBandwidth = (bw: number) => Math.abs(bw - A.bandwidthTBs) < 1e-9;

/** Challenge a: that smallest batch, in one pass, at 3.35 TB/s. */
export function batchSolved(s: MemState): boolean {
  return s.kernel === 'gemv' && s.passes === 1 && atOwnBandwidth(s.bw) && s.batch === smallestComputeBatch();
}

/** Challenge b's target, TFLOPS: about twice what normalization's 1 FLOP per byte allows from HBM. */
export const NORM_TARGET = 6;

/** Challenge b: the normalization kernel at 6 TFLOPS or more, without changing the bandwidth. */
export function cacheSolved(s: MemState): boolean {
  return s.kernel === 'norm' && atOwnBandwidth(s.bw) && runMem(s).tflops >= NORM_TARGET - 1e-9;
}

// ---------------------------------------------------------------------------
// The memory hierarchy, for the strip at the top of the first figure.

const REG_KB = (SM_LIMITS.registers * 4) / 1024;

function bytesLabel(b: number): string {
  if (b >= 1e9) return `${fmt(b / 1e9, b >= 1e10 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${fmt(b / 1e6, b >= 1e7 ? 0 : 1)} MB`;
  return `${fmt(b / 1e3)} KB`;
}

function Hierarchy({ r, s }: { r: ReturnType<typeof runMem>; s: MemState }) {
  const boxes = [
    { name: 'Registers', size: `${fmt(REG_KB)} KB per SM`, speed: 'fastest' },
    { name: 'Shared memory', size: `${SM_LIMITS.sharedKB} KB per SM`, speed: 'on chip' },
    { name: 'L2 cache', size: `${A.l2MB} MB`, speed: `~${A.l2TBs} TB/s` },
    { name: 'HBM', size: `${A.memoryGB} GB`, speed: `${fmt(s.bw, 2)} TB/s` },
    { name: 'Host memory', size: 'over PCIe', speed: `~${GPU.copyGBs} GB/s` },
  ];
  const w = 112;
  const gap = 10;
  const x0 = 12;
  const fits = r.ws <= A.l2MB * 1e6;
  const repeats = s.passes > 1;
  const l2Fill = repeats ? 0.1 + 0.25 * r.hitRate : 0;
  const label = `The A-class's memory hierarchy, from registers to host memory. The kernel's working set, ${bytesLabel(r.ws)}, ${
    fits ? 'fits in the 50 MB L2 cache' : 'is larger than the 50 MB L2 cache'
  }; it lives in HBM${repeats ? `, and ${pct(r.hitRate)} of its repeat reads hit in the L2` : ''}.`;
  return (
    <svg className="diagram" viewBox="0 0 640 110" role="img" aria-label={label}>
      {boxes.map((b, i) => {
        const x = x0 + i * (w + gap);
        const isL2 = i === 2;
        const isHbm = i === 3;
        const fill = isHbm ? 'rgba(171, 112, 182, .28)' : isL2 && repeats ? `rgba(171, 112, 182, ${l2Fill})` : '#f4f4f1';
        return (
          <g key={b.name}>
            <rect x={x} y={8} width={w} height={60} rx={5} fill={fill} stroke={isHbm || (isL2 && repeats) ? GRAPHIC.violet : '#e3e3df'} />
            <text className="lab" x={x + w / 2} y={28} textAnchor="middle">
              {b.name}
            </text>
            <text className="ax ax-m" x={x + w / 2} y={44}>
              {b.size}
            </text>
            <text className="ax ax-m" x={x + w / 2} y={59} style={isHbm ? { fill: TEXT.violet } : undefined}>
              {b.speed}
            </text>
            {i < boxes.length - 1 && <line x1={x + w} x2={x + w + gap} y1={38} y2={38} stroke="#cfcfcb" strokeWidth={1.5} />}
          </g>
        );
      })}
      <text className="ax" x={x0} y={86}>
        ← smaller, faster
      </text>
      <text className="ax ax-e" x={x0 + 5 * w + 4 * gap} y={86}>
        larger, slower →
      </text>
      <text className="ax ax-m" x={320} y={104} style={{ fill: TEXT.violet }}>
        working set {bytesLabel(r.ws)}: {fits ? 'fits in L2' : 'too big for L2'}
        {repeats ? ` · ${pct(r.hitRate)} of repeat reads hit` : ''}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The roofline chart: log–log, intensity across, TFLOPS up.

const X0 = 70;
const X1 = 620;
const XD: [number, number] = [-1, 4];
const Y0 = 300;
const Y1 = 26;
const YD: [number, number] = [-1.3, 3.7];
const lx = (v: number) => X0 + ((Math.log10(Math.max(v, 1e-6)) - XD[0]) / (XD[1] - XD[0])) * (X1 - X0);
const ly = (v: number) => Y0 + ((Math.log10(Math.max(v, 1e-6)) - YD[0]) / (YD[1] - YD[0])) * (Y1 - Y0);
const clampX = (v: number) => Math.min(10 ** XD[1], Math.max(10 ** XD[0], v));
const clampY = (v: number) => Math.min(10 ** YD[1], Math.max(10 ** YD[0], v));
const X_TICKS = [0.1, 1, 10, 100, 1000, 10000];
/** On these axes a bandwidth roof (TFLOPS ∝ intensity) rises one decade per decade: this many degrees. */
const ROOF_ANGLE = (Math.atan((Y0 - Y1) / (YD[1] - YD[0]) / ((X1 - X0) / (XD[1] - XD[0]))) * 180) / Math.PI;
const GPU_TEXT: Record<GpuId, string> = { L: TEXT.gold, A: TEXT.blue, B: TEXT.teal };
const Y_TICKS = [0.1, 1, 10, 100, 1000];

function tickLabel(v: number): string {
  return v < 1 ? String(v) : fmt(v);
}

/** Points along min(peak, bw × x) across the chart. */
function roofPath(peak: number, bw: number, xEnd = 10 ** XD[1]): string {
  const ridge = peak / bw;
  const xs: number[] = [];
  const ys: number[] = [];
  const start = Math.max(10 ** XD[0], (10 ** YD[0]) / bw);
  xs.push(lx(start));
  ys.push(ly(bw * start));
  if (ridge < xEnd) {
    xs.push(lx(ridge), lx(xEnd));
    ys.push(ly(peak), ly(peak));
  } else {
    xs.push(lx(xEnd));
    ys.push(ly(bw * xEnd));
  }
  return linePath(xs, ys);
}

function Axes({ title }: { title: string }) {
  return (
    <g>
      <text className="ax" x={X0} y={14}>
        {title}
      </text>
      {Y_TICKS.map((t) => (
        <g key={t}>
          <line className="gl" x1={X0} x2={X1} y1={ly(t)} y2={ly(t)} />
          <text className="ax ax-e" x={X0 - 6} y={ly(t) + 4}>
            {tickLabel(t)}
          </text>
        </g>
      ))}
      {X_TICKS.map((t) => (
        <g key={t}>
          <line className="gl" x1={lx(t)} x2={lx(t)} y1={Y1} y2={Y0} />
          <text className="ax ax-m" x={lx(t)} y={Y0 + 16}>
            {tickLabel(t)}
          </text>
        </g>
      ))}
      <line className="base" x1={X0} x2={X1} y1={Y0} y2={Y0} />
      <line className="base" x1={X0} x2={X0} y1={Y1} y2={Y0} />
      <text className="ax ax-e" x={X1} y={Y0 + 32}>
        arithmetic intensity, FLOPs per byte (log scale)
      </text>
    </g>
  );
}

const BOUND_LABEL: Record<CachedResult['bound'], string> = { compute: 'arithmetic', memory: 'HBM bandwidth', cache: 'L2 bandwidth' };

function MemRoofline({ r, s }: { r: ReturnType<typeof runMem>; s: MemState }) {
  const peak = A.bf16Tflops;
  const ridge = peak / s.bw;
  const l2Ridge = peak / A.l2TBs;
  const hbmX = clampX(r.intensity);
  const yv = clampY(r.tflops);
  const l2X = r.cacheBytes > 0 ? clampX(r.flops / r.cacheBytes) : null;
  const dotColor = r.bound === 'compute' ? GRAPHIC.orange : GRAPHIC.violet;
  const label = `Roofline of the A-class at ${fmt(s.bw, 2)} TB/s: memory limits any kernel below ${fmt(ridge)} FLOPs per byte, the ridge point; above it the ${fmt(peak)} TFLOPS of arithmetic does. ${
    KERNEL_NAME[s.kernel]
  } does ${fmt(r.intensity, r.intensity < 10 ? 2 : 0)} FLOPs per byte from HBM and reaches ${fmt(r.tflops, r.tflops < 10 ? 2 : 0)} TFLOPS, limited by ${BOUND_LABEL[r.bound]}.`;
  return (
    <svg className="chart" viewBox="0 0 640 340" role="img" aria-label={label}>
      <Axes title="TFLOPS achieved (log scale)" />
      {/* The L2 roof, dashed, and the HBM roof. */}
      <path d={roofPath(peak, A.l2TBs, l2Ridge)} fill="none" stroke={GRAPHIC.violet} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.75} />
      <text className="ax" x={lx(1.5)} y={ly(A.l2TBs * 1.5) - 7} style={{ fill: TEXT.violet }} transform={`rotate(${-ROOF_ANGLE} ${lx(1.5)} ${ly(A.l2TBs * 1.5) - 7})`}>
        L2 roof · {A.l2TBs} TB/s
      </text>
      <path d={roofPath(peak, s.bw, ridge)} fill="none" stroke={GRAPHIC.violet} strokeWidth={2.5} />
      <line x1={lx(Math.min(ridge, 10 ** XD[1]))} x2={X1} y1={ly(peak)} y2={ly(peak)} stroke={GRAPHIC.orange} strokeWidth={2.5} />
      <line x1={X0} x2={lx(Math.min(ridge, 10 ** XD[1]))} y1={ly(peak)} y2={ly(peak)} stroke={GRAPHIC.orange} strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
      <text className="ax ax-e" x={X1} y={ly(peak) - 8} style={{ fill: TEXT.orange }}>
        arithmetic roof · {fmt(peak)} TFLOPS
      </text>
      <text className="ax" x={lx(0.15)} y={ly(s.bw * 0.15) + 16} style={{ fill: TEXT.violet }} transform={`rotate(${-ROOF_ANGLE} ${lx(0.15)} ${ly(s.bw * 0.15) + 16})`}>
        HBM roof · {fmt(s.bw, 2)} TB/s
      </text>
      {ridge <= 10 ** XD[1] && (
        <g>
          <line x1={lx(ridge)} x2={lx(ridge)} y1={ly(peak)} y2={Y0} stroke="#9a9a9a" strokeDasharray="2 3" />
          <text className="ax" x={lx(ridge) + 5} y={Y0 - 8}>
            ridge {fmt(ridge)}
          </text>
        </g>
      )}
      {/* The kernel: through the L2 (ring) and from HBM (dot). */}
      {l2X !== null && (
        <g>
          <line x1={lx(Math.min(hbmX, l2X))} x2={lx(Math.max(hbmX, l2X))} y1={ly(yv)} y2={ly(yv)} stroke={GRAPHIC.violet} strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={lx(l2X)} cy={ly(yv)} r={6} fill="#fcfcfb" stroke={GRAPHIC.violet} strokeWidth={2} />
        </g>
      )}
      <circle cx={lx(hbmX)} cy={ly(yv)} r={7} fill={dotColor} stroke="#fcfcfb" strokeWidth={2} />
      <text
        className="lab"
        x={lx(hbmX) + (hbmX > 1000 ? -12 : 12)}
        y={ly(yv) + (yv > 400 ? 20 : -10)}
        textAnchor={hbmX > 1000 ? 'end' : 'start'}
      >
        {fmt(r.tflops, r.tflops < 10 ? 2 : 0)} TFLOPS
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Three accelerators on one chart.

export type CompareKernel = 'add' | 'norm' | 'gemv' | 'gemm';
export const COMPARE_DEFAULTS = { kernel: 'gemv' as CompareKernel, batch: 1 };

export function compareTflops(gpu: GpuId, intensity: number): number {
  const g = ACCELERATORS[gpu];
  return attainableTflops(intensity, g.bf16Tflops, g.bandwidthTBs);
}

/** Smallest batch at which matrix × vectors is compute-bound on a given accelerator. */
export function crossoverBatch(gpu: GpuId): number {
  const ridge = ridgePoint(ACCELERATORS[gpu]);
  for (let b = 1; b <= 4096; b++) if (batchIntensity(b) >= ridge) return b;
  return Infinity;
}

function CompareChart({ kernel, intensity }: { kernel: CompareKernel; intensity: number }) {
  const markers: Array<{ id: CompareKernel; x: number; name: string }> = [
    { id: 'add', x: 1 / 6, name: 'add' },
    { id: 'norm', x: 1, name: 'norm' },
    { id: 'gemm', x: D / 3, name: 'large multiply' },
  ];
  const label = `Rooflines of the three accelerators. ${KERNEL_NAME[kernel]} at ${fmt(intensity, intensity < 10 ? 2 : 0)} FLOPs per byte reaches ${GPU_LIST.map(
    (g) => `${fmt(compareTflops(g.id, intensity), 1)} TFLOPS on the ${g.short}`,
  ).join(', ')}.`;
  return (
    <svg className="chart" viewBox="0 0 640 340" role="img" aria-label={label}>
      <Axes title="TFLOPS attainable (log scale)" />
      {markers.map((m) => (
        <g key={m.id} opacity={m.id === kernel ? 1 : 0.6}>
          <line x1={lx(m.x)} x2={lx(m.x)} y1={Y1 + 8} y2={Y0} stroke="#9a9a9a" strokeDasharray="2 3" />
          <text className={m.id === 'gemm' ? 'ax ax-e' : 'ax'} x={lx(m.x) + (m.id === 'gemm' ? -4 : 4)} y={Y0 - 8}>
            {m.name}
          </text>
        </g>
      ))}
      {kernel === 'gemv' && (
        <g>
          <line x1={lx(intensity)} x2={lx(intensity)} y1={Y1 + 8} y2={Y0} stroke="#333" strokeDasharray="2 3" />
          <text className={intensity > 600 ? 'ax ax-e' : 'ax'} x={lx(intensity) + (intensity > 600 ? -4 : 4)} y={Y0 - 24} style={{ fill: '#333' }}>
            matrix × vectors
          </text>
        </g>
      )}
      {GPU_LIST.map((g) => {
        const ridge = ridgePoint(g);
        return (
          <g key={g.id}>
            <path d={roofPath(g.bf16Tflops, g.bandwidthTBs)} fill="none" stroke={GPU_COLOR[g.id]} strokeWidth={2.5} />
            <text className="ax ax-e" x={X1} y={ly(g.bf16Tflops) - 6} style={{ fill: GPU_TEXT[g.id] }}>
              {g.short} · {fmt(g.bf16Tflops)} TFLOPS · ridge {fmt(ridge)}
            </text>
            <circle cx={lx(intensity)} cy={ly(clampY(compareTflops(g.id, intensity)))} r={6} fill={GPU_COLOR[g.id]} stroke="#fcfcfb" strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario<MemState>('memory', MEM_DEFAULTS);
  const st = s1.state;
  const r = runMem(st);
  const smallest = useMemo(() => smallestComputeBatch(), []);
  const solvedA = batchSolved(st);
  const solvedB = cacheSolved(st);
  const ridge = A.bf16Tflops / st.bw;

  const s2 = useScenario('three', COMPARE_DEFAULTS);
  const ck = s2.state.kernel;
  const cIntensity = kernelIntensity(ck, s2.state.batch);

  // Numbers the prose quotes, all from the engines.
  const layer1 = batchedMatmul(D, D, 1, A);
  const layer256 = batchedMatmul(D, D, 256, A);
  const run = (patch: Partial<MemState>) => runMem({ ...MEM_DEFAULTS, ...patch });
  const addRun = run({ kernel: 'add' });
  const normRun = run({ kernel: 'norm' });
  const gemv1 = run({ kernel: 'gemv', batch: 1 });
  const gemv64 = run({ kernel: 'gemv', batch: 64 });
  const gemmRun = run({ kernel: 'gemm' });
  const doubled = run({ kernel: 'gemv', batch: 1, bw: 2 * A.bandwidthTBs });
  const ws40 = Math.log10(40);
  const norm2 = run({ kernel: 'norm', wsLog: ws40, passes: 2 });
  const norm3 = run({ kernel: 'norm', wsLog: ws40, passes: 3 });
  const norm8 = run({ kernel: 'norm', wsLog: ws40, passes: 8 });
  const norm2big = run({ kernel: 'norm', wsLog: Math.log10(500), passes: 2 });
  const ridges = { L: ridgePoint(ACCELERATORS.L), A: ridgePoint(A), B: ridgePoint(ACCELERATORS.B) };
  const memRatioB = ACCELERATORS.B.bandwidthTBs / A.bandwidthTBs;
  const memRatioL = ACCELERATORS.L.bandwidthTBs / A.bandwidthTBs;
  const cmpRatioB = ACCELERATORS.B.bf16Tflops / A.bf16Tflops;
  const cmpRatioL = ACCELERATORS.L.bf16Tflops / A.bf16Tflops;
  const cross = { L: crossoverBatch('L'), A: crossoverBatch('A'), B: crossoverBatch('B') };

  const tf = (v: number) => fmt(v, v < 10 ? 2 : 0);

  let caption: string;
  if (r.bound === 'compute') caption = `${KERNEL_NAME[st.kernel]} does enough arithmetic per byte to keep all ${fmt(A.bf16Tflops)} TFLOPS busy: memory waits on the arithmetic.`;
  else if (r.bound === 'memory')
    caption = `${KERNEL_NAME[st.kernel]} gets ${fmt(r.intensity, r.intensity < 10 ? 2 : 1)} FLOPs from each byte of HBM traffic, below the ridge at ${fmt(ridge)}: the arithmetic waits on HBM and reaches ${pct(r.tflops / A.bf16Tflops, r.tflops / A.bf16Tflops < 0.01 ? 2 : 0)} of its peak.`;
  else caption = `The L2 cache serves ${pct(r.hitRate)} of the repeat reads, so HBM is no longer the bottleneck — but the cache has a speed limit of its own, ${A.l2TBs} TB/s.`;

  let statusA: string;
  if (st.kernel !== 'gemv') statusA = 'Choose matrix × vectors.';
  else if (st.passes !== 1) statusA = 'Read the matrix once: set passes to 1.';
  else if (!atOwnBandwidth(st.bw)) statusA = `Put the bandwidth back to the A-class’s own ${A.bandwidthTBs} TB/s.`;
  else if (r.bound !== 'compute') statusA = `At a batch of ${st.batch}, the kernel does ${fmt(r.intensity, 1)} FLOPs per byte, below the ridge at ${fmt(ridge)}: still waiting on memory.`;
  else statusA = `A batch of ${st.batch} keeps the arithmetic busy. Is it the smallest that does?`;

  let statusB: string;
  if (st.kernel !== 'norm') statusB = 'Choose the normalization kernel.';
  else if (!atOwnBandwidth(st.bw)) statusB = `Leave the bandwidth at the A-class’s own ${A.bandwidthTBs} TB/s.`;
  else statusB = `Right now normalization reaches ${tf(r.tflops)} TFLOPS${st.passes === 1 ? ', reading its data once' : ` over ${st.passes} passes, with ${pct(r.hitRate)} of repeat reads hitting the L2`}.`;

  const compareRows = (['add', 'norm', 'gemv', 'gemm'] as CompareKernel[]).map((k) => ({ k, i: kernelIntensity(k, k === 'gemv' ? s2.state.batch : 1) }));

  return (
    <LessonPage id="compute/2.4">
      <P>
        At the end of <a href={lessonHref('compute/2.3')}>the previous lesson</a>, one 8,192 × 8,192 layer of the 70B model took {fmt(layer1.totalS * 1e6, 1)} µs
        to apply to a single vector and {fmt(layer256.totalS * 1e6, 1)} µs to apply to 256 of them. The extra arithmetic was almost free, because the arithmetic was
        never what took the time. Every one of the matrix’s {fmt(LAYER_BYTES / 1e6)} MB of weights had to come in from memory, and at {A.bandwidthTBs} TB/s that
        takes {fmt(layer1.totalS * 1e6, 1)} µs, however little is done with them.
      </P>
      <P>
        So a GPU’s speed depends on two rates, not one: how fast it can do arithmetic, and how fast it can be fed. This lesson is about the second. We’ll look at the
        layers of memory a GPU keeps its data in, and at a simple model — the roofline — that says, for any piece of work, which of the two rates sets its pace.
      </P>
      <P>
        Lesson 1.4 found the basic trade: SRAM is fast but takes six transistors a bit, while DRAM packs a bit into one transistor and a capacitor but is slower to
        reach. A GPU uses both, in a hierarchy. Closest to the arithmetic are each SM’s <K tone="violet">registers</K>, {fmt(REG_KB)} KB of them, and its{' '}
        <K tone="violet">shared memory</K>, {SM_LIMITS.sharedKB} KB, where Lesson 2.3’s tiles lived. All 132 SMs share the <K tone="violet">L2 cache</K>:{' '}
        {A.l2MB} MB of SRAM that delivers roughly {A.l2TBs} TB/s. Then comes the <K tone="violet">HBM</K>, the {A.memoryGB} GB of stacked DRAM beside the chip,
        at {A.bandwidthTBs} TB/s. Beyond that is the host computer’s own memory, reached over the PCIe link at about {GPU.copyGBs} GB/s. Each level is larger
        than the one before and slower to reach.
      </P>
      <P>
        Whatever is computed, the data must eventually come up from HBM. If a piece of work — a <b>kernel</b>, in the language of Lesson 2.2 — needs F floating-point
        operations and moves B bytes to and from HBM, then it can finish no sooner than F divided by the peak arithmetic rate, and no sooner than B divided by the
        bandwidth. Which of these is longer depends on the ratio F/B, the kernel’s <K tone="orange">arithmetic intensity</K>: how many FLOPs it gets from each byte
        it moves. The best a kernel can do is whichever limit is lower:
      </P>
      <Eq label="Attainable throughput is the lesser of peak arithmetic and bandwidth times intensity">
        <K tone="orange">attainable</K>
        <Op>=</Op>
        <span>min(</span>
        <K tone="orange">
          {fmt(A.bf16Tflops)} TFLOPS<Sub>peak</Sub>
        </K>
        <Op>,</Op>
        <K tone="violet">{fmt(st.bw, 2)} TB/s</K>
        <Op>×</Op>
        <span>intensity)</span>
      </Eq>
      <P>
        Plotted on logarithmic axes, the two limits form a roofline: a slope where memory limits the work, and a flat roof where the arithmetic does. They meet at
        the <b>ridge point</b>, peak divided by bandwidth: {fmt(A.bf16Tflops)} TFLOPS ÷ {A.bandwidthTBs} TB/s ≈ {fmt(ridgePoint(A))} FLOPs per byte for the
        A-class. Below it, a kernel waits on memory; above it, memory waits on the arithmetic.
      </P>
      <P>
        In the next demonstration, choose a kernel and watch where it lands on the A-class’s roofline. The strip shows the memory hierarchy, with HBM’s bandwidth
        live. The working set is how much data the kernel works on, and passes are how many times it reads all of it; leave those two alone for now. Try changing the
        batch of vectors for the matrix kernel, and the HBM bandwidth:
      </P>

      <Figure name="GPU Memory Simulator" scenario={s1}>
        <Hierarchy r={r} s={st} />
        <Segmented
          label="Kernel"
          value={st.kernel}
          onChange={(kernel) => s1.set({ kernel })}
          options={(['add', 'norm', 'gemv', 'gemm'] as KernelId[]).map((k) => ({ value: k, label: KERNEL_NAME[k] }))}
        />
        <MemRoofline r={r} s={st} />
        <Legend
          items={[
            { label: 'HBM roof', color: GRAPHIC.violet, kind: 'line' },
            { label: 'L2 roof', color: GRAPHIC.violet, kind: 'line', dashed: true },
            { label: 'arithmetic roof', color: GRAPHIC.orange, kind: 'line' },
            { label: 'kernel, by its HBM traffic (ring: by its L2 traffic)', color: r.bound === 'compute' ? GRAPHIC.orange : GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: 'achieved', value: `${tf(r.tflops)} TFLOPS`, tone: 'orange' },
            { label: 'share of peak', value: pct(r.tflops / A.bf16Tflops, r.tflops / A.bf16Tflops < 0.01 ? 2 : 0) },
            { label: 'limited by', value: BOUND_LABEL[r.bound], tone: r.bound === 'compute' ? 'orange' : 'violet' },
            { label: 'FLOPs per byte from HBM', value: fmt(r.intensity, r.intensity < 10 ? 2 : 0), tone: 'violet' },
          ]}
        />
        <Slider
          label="Batch of vectors"
          tone="orange"
          value={st.batch}
          min={1}
          max={1024}
          disabled={st.kernel !== 'gemv'}
          onChange={(v) => s1.set({ batch: v })}
          display={st.kernel === 'gemv' ? fmt(st.batch) : '—'}
        />
        <Slider
          label="Working set"
          tone="violet"
          value={st.wsLog}
          min={0}
          max={WS_MAX_LOG}
          step={0.01}
          onChange={(v) => s1.set({ wsLog: v })}
          display={bytesLabel(r.ws)}
        />
        <Slider label="Passes over it" value={st.passes} min={1} max={32} onChange={(v) => s1.set({ passes: v })} display={st.passes === 1 ? 'read once' : `${st.passes} passes`} />
        <Slider label="HBM bandwidth" tone="violet" value={st.bw} min={0.5} max={10} step={0.05} onChange={(v) => s1.set({ bw: v })} display={`${fmt(st.bw, 2)} TB/s`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The simplest kernels sit far down the slope. An <b>elementwise add</b> reads two numbers and writes one — six bytes in BF16 — for a single addition, so it
        gets {fmt(1 / 6, 2)} FLOPs per byte and reaches {tf(addRun.tflops)} TFLOPS: {pct(addRun.tflops / A.bf16Tflops, 2)} of what the arithmetic could do.{' '}
        <b>Normalization</b>, which rescales each vector of activations, does about one FLOP per byte and reaches {tf(normRun.tflops)} TFLOPS. Applying a layer to a
        single vector is no better: each 2-byte weight is used for one multiply and one add, so it too reaches {tf(gemv1.tflops)} TFLOPS. That is the position of a
        language model producing text for one user, as Chapter 3 will show, and it uses about a third of one percent of the chip.
      </P>
      <P>
        Raise the batch and the dot climbs the slope. At 64 vectors the layer gets {fmt(gemv64.intensity)} FLOPs per byte and reaches {tf(gemv64.tflops)} TFLOPS. A
        large matrix multiply, with each matrix read once, gets {fmt(D / 3)} FLOPs per byte, far past the ridge, and runs at the full {tf(gemmRun.tflops)} TFLOPS.
        Now move the bandwidth. Every kernel on the slope speeds up in proportion — at twice the A-class’s bandwidth, the single-vector layer reaches{' '}
        {tf(doubled.tflops)} TFLOPS — while the large multiply, already on the flat roof, doesn’t move. The ridge slides left as bandwidth rises: with more bytes per
        second, less arithmetic per byte is needed to keep the chip busy.
      </P>

      <Challenge
        id="a"
        question="Find the smallest batch at which the matrix kernel, reading its weights once at the A-class’s own 3.35 TB/s, stops waiting on memory."
        solved={solvedA}
        status={statusA}
        success={`Solved: ${smallest} vectors. That is a little past the ridge point of ${fmt(ridgePoint(A))}, because the vectors themselves must be read in and written out too, which costs some bytes per vector. Below ${smallest}, the GPU is partly idle whatever the batch; from ${smallest} up, every extra vector costs real arithmetic time.`}
      />

      <H2>Reading data twice</H2>
      <P>
        So far every kernel has read its data once, so every byte came from HBM. Many kernels read the same data again: a straightforward normalization passes over its vectors once to
        measure them and again to rescale them, and the tiles of Lesson 2.3 shared their reads through the L2. When data is read a second time it may still be in the
        cache. If the whole working set fits in the L2’s {A.l2MB} MB, every repeat read hits there, and only the first pass costs HBM bandwidth. If it doesn’t fit,
        we’ll assume only the share the cache can hold is found there — a simplification, since real access patterns can do better or much worse.
      </P>
      <P>
        In <FigRef to="GPU Memory Simulator">the first demonstration</FigRef>, choose normalization and shrink the working set below {A.l2MB} MB, then add passes.
        The ring marks the kernel’s intensity measured against its L2 traffic, under the L2’s own dashed roof. With a 40 MB working set read twice, half the traffic
        stays in the cache and normalization reaches {tf(norm2.tflops)} TFLOPS. Read three times, it reaches {tf(norm3.tflops)} TFLOPS: now the first pass from HBM and the two
        repeats from the L2 take about equally long. Beyond that the cache becomes the limit, and at eight passes the kernel slips back to {tf(norm8.tflops)} TFLOPS.
        The same two passes over a 500 MB working set find only {pct(norm2big.hitRate)} of their repeat reads in the cache and reach {tf(norm2big.tflops)} TFLOPS.
      </P>

      <Challenge
        id="b"
        figure="GPU Memory Simulator"
        question={`Without changing the HBM bandwidth, get the normalization kernel to at least ${NORM_TARGET} TFLOPS — nearly twice what its one FLOP per byte allows from HBM alone.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${tf(r.tflops)} TFLOPS. Reading the same data again is only cheap if it is still close by; with a working set that fits in the ${A.l2MB} MB L2, the repeat passes never touch HBM.`}
      />

      <P>
        Much of the craft of GPU programming is arranging work this way, so that data is reused while it is close to the arithmetic: tiling, as in Lesson 2.3, and
        <b> fusing</b> several small steps — a normalization, an addition, the matrix multiply that follows — into one kernel that reads its data from HBM once instead
        of once per step. A GPU’s peak TFLOPS is a ceiling that only arithmetic-heavy, well-arranged work reaches. For everything else, what the work is really
        buying is bytes per second.
      </P>

      <H2>Three accelerators</H2>
      <P>
        That changes how the three accelerators of this course compare. The next demonstration draws their rooflines on one chart. Choose a kernel, and for the matrix
        kernel set the batch:
      </P>

      <Figure name="GPU Memory Simulator · three accelerators" scenario={s2}>
        <Segmented
          label="Kernel"
          value={ck}
          onChange={(kernel) => s2.set({ kernel })}
          options={(['add', 'norm', 'gemv', 'gemm'] as CompareKernel[]).map((k) => ({ value: k, label: KERNEL_NAME[k] }))}
        />
        <CompareChart kernel={ck} intensity={cIntensity} />
        <Slider
          label="Batch of vectors"
          tone="orange"
          value={s2.state.batch}
          min={1}
          max={1024}
          disabled={ck !== 'gemv'}
          onChange={(v) => s2.set({ batch: v })}
          display={ck === 'gemv' ? fmt(s2.state.batch) : '—'}
        />
        <DataTable
          caption="TFLOPS each accelerator can attain on each kernel, BF16"
          rows={compareRows}
          rowKey={(row) => row.k}
          rowClass={(row) => (row.k === ck ? 'hl' : '')}
          columns={[
            { label: 'Kernel', cell: (row) => (row.k === 'gemv' ? `Matrix × ${fmt(s2.state.batch)} ${s2.state.batch === 1 ? 'vector' : 'vectors'}` : KERNEL_NAME[row.k]) },
            { label: 'FLOPs/byte', cell: (row) => fmt(row.i, row.i < 10 ? 2 : 0), align: 'right' },
            ...GPU_LIST.map((g) => ({ label: g.short, cell: (row: { k: CompareKernel; i: number }) => tf(compareTflops(g.id, row.i)), align: 'right' as const })),
            { label: 'B ÷ A', cell: (row) => `${fmt(compareTflops('B', row.i) / compareTflops('A', row.i), 2)}×`, align: 'right' },
          ]}
        />
      </Figure>

      <P>
        On memory-bound work the accelerators line up by bandwidth alone. The B-class 192 GB’s {ACCELERATORS.B.bandwidthTBs} TB/s of HBM makes it{' '}
        {fmt(memRatioB, 1)} times as fast as the A-class on a single-vector layer, and the L-class 48 GB, whose {ACCELERATORS.L.bandwidthTBs} TB/s comes from cheaper
        graphics memory (GDDR) rather than stacked HBM, manages only {pct(memRatioL)} of the A-class’s rate. On compute-bound work they line up by arithmetic: the
        B-class does {fmt(cmpRatioB, 2)} times the A-class’s work, and the L-class {pct(cmpRatioL)} of it — a noticeably better showing. The L-class is a
        respectable card for arithmetic-heavy work and a poor one for work that streams through memory.
      </P>
      <P>
        Their ridge points differ too: {fmt(ridges.L)} FLOPs per byte for the L-class, {fmt(ridges.A)} for the A-class and {fmt(ridges.B)} for the B-class. Slide the
        batch and watch each dot leave its slope at a different place. The layer needs {fmt(cross.L)} vectors at a time to keep the L-class’s arithmetic busy,{' '}
        {fmt(cross.A)} on the A-class and {fmt(cross.B)} on the B-class. Which accelerator is the better buy, then, isn’t a property of the accelerator alone: it
        depends on where the work sits on the roofline. A GPU-hour spent on memory-bound work is really an hour of bandwidth, and one spent on compute-bound work an
        hour of arithmetic.
      </P>
      <P>
        Bandwidth is half of the memory problem. The other half is capacity. The 70B model’s weights take 141 GB in BF16, and no single A-class holds more than{' '}
        {A.memoryGB} GB. To run it at all, the model has to be split across several GPUs, and those GPUs then have to exchange data constantly. How fast they can do
        that is the subject of the <a href={lessonHref('compute/2.5')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}
