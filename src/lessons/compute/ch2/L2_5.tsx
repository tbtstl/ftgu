import { useMemo } from 'react';
import {
  Button,
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
  useScenario,
} from '../../../framework';
import {
  busBandwidth,
  flatRingAllReduce,
  hierarchicalAllReduce,
  scaleOutLink,
  scaleUpLink,
  type LinkSpec,
} from '../../../engines/compute/collectives';
import { ACCELERATORS, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { MODELS, paramCount, type ModelId } from '../../../model/compute/models';

// ---------------------------------------------------------------------------
// The data being summed, and the two ways of summing it.

/** Bytes of gradients for a model: one BF16 number (2 bytes) per parameter. */
export function gradBytes(id: ModelId): number {
  return paramCount(MODELS[id]) * 2;
}

export const GRAD_8B = gradBytes('8B');
export const GRAD_70B = gradBytes('70B');

export type Algo = 'flat' | 'two-level';

/** GPUs per server. */
export const PER_SERVER = 8;

export interface AllReduce {
  gpus: number;
  seconds: number;
  /** Flat ring: time moving data at the slowest hop's pace, and time in fixed per-step delays. */
  dataS: number;
  delayS: number;
  /** Two-level: summing inside each server, across servers, and sharing the result inside again. */
  insideS: number;
  betweenS: number;
  /** The link that sets the pace. */
  limitedBy: 'inside' | 'network';
  /** Bus bandwidth, GB/s. */
  busGBs: number;
  intra: LinkSpec;
  inter: LinkSpec;
}

/** One all-reduce of `bytes` across `servers` servers of eight GPUs, by either algorithm. */
export function allReduce(gpu: GpuId, servers: number, bytes: number, algo: Algo): AllReduce {
  const intra = scaleUpLink(gpu);
  const inter = scaleOutLink(gpu);
  const gpus = servers * PER_SERVER;
  if (algo === 'flat' || servers <= 1) {
    const r = flatRingAllReduce(bytes, servers, PER_SERVER, intra, inter);
    const limitedBy = servers > 1 && inter.gbs < intra.gbs ? 'network' : 'inside';
    return {
      gpus,
      seconds: r.seconds,
      dataS: r.bandwidthS,
      delayS: r.latencyS,
      insideS: servers > 1 ? 0 : r.seconds,
      betweenS: servers > 1 ? r.seconds : 0,
      limitedBy,
      busGBs: busBandwidth(bytes, gpus, r.seconds),
      intra,
      inter,
    };
  }
  const h = hierarchicalAllReduce(bytes, servers, PER_SERVER, intra, inter);
  return {
    gpus,
    seconds: h.seconds,
    dataS: 0,
    delayS: 0,
    insideS: h.intraScatterS + h.intraGatherS,
    betweenS: h.interS,
    limitedBy: h.interS > h.intraScatterS + h.intraGatherS ? 'network' : 'inside',
    busGBs: busBandwidth(bytes, gpus, h.seconds),
    intra,
    inter,
  };
}

/**
 * Data each server sends over the network in one all-reduce, as a multiple of the data summed. A flat
 * ring crosses between servers through one card per server, carrying 2(p − 1)/p of the data; a
 * two-level all-reduce sends 2(n − 1)/n of an eighth through each of the server's eight cards, so
 * 2(n − 1)/n in all for n servers.
 */
export function networkShare(servers: number, algo: Algo): number {
  if (servers <= 1) return 0;
  const p = servers * PER_SERVER;
  return algo === 'flat' ? (2 * (p - 1)) / p : (2 * (servers - 1)) / servers;
}

export const CLUSTER_DEFAULTS = { gpu: 'A' as GpuId, servers: 1, logBytes: Math.log10(GRAD_8B), algo: 'flat' as Algo };
export const TARGET_S = 0.2;
export const CHALLENGE_SERVERS = 8;
/** The data slider: log10 of the bytes summed. */
export const DATA_LOG = { min: 6, max: 11.3, step: 0.05 };

/** The data positions on the slider, log10 bytes. */
function dataSteps(): number[] {
  const n = Math.round((DATA_LOG.max - DATA_LOG.min) / DATA_LOG.step);
  return Array.from({ length: n + 1 }, (_, k) => Math.round((DATA_LOG.min + k * DATA_LOG.step) * 100) / 100);
}

/** The most data on the slider (log10 bytes) that 64 A-class GPUs sum in under 0.2 s with the given algorithm. */
export function largestUnderTarget(algo: Algo = 'two-level'): number {
  let best = -Infinity;
  for (const lb of dataSteps()) if (allReduce('A', CHALLENGE_SERVERS, 10 ** lb, algo).seconds < TARGET_S) best = lb;
  return best;
}

const LARGEST_LOG = largestUnderTarget('two-level');

/** The reader's prediction: the time grows in proportion to the data, so 0.2 s holds 0.2 ÷ (the 8B model's time) of its gradients. */
export const PREDICTED_BYTES = (GRAD_8B * TARGET_S) / allReduce('A', CHALLENGE_SERVERS, GRAD_8B, 'two-level').seconds;

/** The challenge: the most data on the slider that 64 A-class GPUs can sum in under 0.2 s — which takes two levels. */
export function clusterSolved(s: typeof CLUSTER_DEFAULTS): boolean {
  const bytes = 10 ** s.logBytes;
  return s.gpu === 'A' && s.servers === CHALLENGE_SERVERS && bytes >= 10 ** LARGEST_LOG * (1 - 1e-9) && allReduce(s.gpu, s.servers, bytes, s.algo).seconds < TARGET_S;
}

// ---------------------------------------------------------------------------
// Formatting.

/** A duration: "2.53 s", "602 ms", "62.5 ms", "2.07 ms", "28 µs". */
export function dur(seconds: number): string {
  if (seconds >= 1) return `${fmt(seconds, 2)} s`;
  const ms = seconds * 1000;
  if (ms >= 100) return `${fmt(ms)} ms`;
  if (ms >= 10) return `${fmt(ms, 1)} ms`;
  if (ms >= 1) return `${fmt(ms, 2)} ms`;
  return `${fmt(seconds * 1e6, seconds * 1e6 < 10 ? 1 : 0)} µs`;
}

/** Bytes as "16.1 GB", "141 GB", "350 MB", "4.0 KB". */
export function bytesText(b: number): string {
  const [v, u] = b >= 1e9 ? [b / 1e9, 'GB'] : b >= 1e6 ? [b / 1e6, 'MB'] : [b / 1e3, 'KB'];
  return `${fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u}`;
}

const linkName = (gpu: GpuId) => (ACCELERATORS[gpu].scaleUpKind === 'PCIe' ? 'PCIe through the host' : 'GPU links');

// ---------------------------------------------------------------------------
// The cluster diagram: servers of eight GPUs joined by a ring inside each, and a network switch
// between them. Dots move at a pace set by the link they cross — in a flat ring, every link
// waits for the slowest one.

const BOX_H = 70;
const ROW_Y = 30;
const BAR_Y = 122;
const BAR_H = 14;
const INSIDE_STROKE = '#cfe0f0';
const INSIDE_FILL = '#9cc3e6';
const NET_STROKE = '#d9d9d5';

/** Dot speed for a link, px/s: grows with the square root of its bandwidth so the slow links read as slow. */
function dotStyle(gbs: number, spacing = 18) {
  const speed = 6 * Math.sqrt(gbs) * (spacing / 18);
  return { animationDuration: `${(spacing / speed).toFixed(3)}s`, strokeDasharray: `0 ${spacing}` };
}

/** One row of servers, as wide as fits: up to 64 px each, narrower when there are more than eight. */
function layout(n: number) {
  const gap = n > 8 ? 4 : 10;
  const w = Math.min(64, (604 - (n - 1) * gap) / n);
  const x0 = (640 - (n * w + (n - 1) * gap)) / 2;
  const inset = w > 44 ? 9 : 6;
  return { gap, w, x0, inset, width: n * w + (n - 1) * gap, square: Math.min(12, (w - 2 * inset) / 3 - 1.5) };
}

function ClusterDiagram({ gpu, servers, algo, r, other, ariaLabel }: { gpu: GpuId; servers: number; algo: Algo; r: AllReduce; other: AllReduce; ariaLabel: string }) {
  const flat = algo === 'flat';
  const multi = servers > 1;
  const L = layout(servers);
  const xOf = (i: number) => L.x0 + i * (L.w + L.gap);
  // In a flat ring, every hop moves at the slowest hop's pace.
  const pace = flat && multi ? Math.min(r.intra.gbs, r.inter.gbs) : r.intra.gbs;
  const insideDots = dotStyle(pace);
  const netDots = dotStyle(r.inter.gbs, flat ? 18 : 36);
  const barX0 = L.x0 - 8;
  const barX1 = L.x0 + L.width + 8;
  const top = ROW_Y + 16;
  const bottom = ROW_Y + BOX_H - 16;
  const hops = multi
    ? Array.from({ length: servers }, (_, i) => {
        const ax = xOf(i) + L.w / 2 + 3;
        const bx = xOf((i + 1) % servers) + L.w / 2 - 3;
        return `M${ax} ${ROW_Y + BOX_H} L${ax} ${BAR_Y + BAR_H / 2} L${bx} ${BAR_Y + BAR_H / 2} L${bx} ${ROW_Y + BOX_H}`;
      })
    : [];

  // Time bars: both algorithms, the chosen one in full.
  const flatR = flat ? r : other;
  const twoR = flat ? other : r;
  const tMax = Math.max(flatR.seconds, twoR.seconds, 1e-9);
  const TX = scale(0, tMax, 112, 548);
  const seg = (x0: number, s: number) => ({ x: TX(x0), w: Math.max(0, TX(x0 + s) - TX(x0)) });
  const flatData = seg(0, flatR.dataS);
  const flatDelay = seg(flatR.dataS, flatR.delayS);
  const twoIn1 = seg(0, twoR.insideS / 2);
  const twoBetween = seg(twoR.insideS / 2, twoR.betweenS);
  const twoIn2 = seg(twoR.insideS / 2 + twoR.betweenS, twoR.insideS / 2);
  const flatDataFill = multi ? GRAPHIC.blue : INSIDE_FILL;
  const netGbs = fmt(r.inter.gbs, r.inter.gbs < 20 ? 1 : 0);

  return (
    <svg className="diagram" viewBox="0 0 640 222" role="img" aria-label={ariaLabel}>
      <text className="ax" x={16} y={16}>
        {servers} {servers === 1 ? 'server' : 'servers'} × 8 {ACCELERATORS[gpu].short} = {servers * 8} GPUs
      </text>
      <text className="ax ax-e" x={624} y={16}>
        inside: {linkName(gpu)}, {fmt(r.intra.gbs)} GB/s · between: {netGbs} GB/s per GPU
      </text>

      {/* The network switch and the hops between servers. */}
      <rect x={barX0} y={BAR_Y} width={barX1 - barX0} height={BAR_H} rx={3} fill={multi ? '#eef3f8' : '#f4f4f1'} stroke={multi ? '#c9d6e3' : '#e3e3df'} />
      {hops.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke={NET_STROKE} strokeWidth={2} />
          <path d={d} className="flow-dots" stroke={TEXT.blue} strokeWidth={5} style={netDots} />
        </g>
      ))}
      <text className="ax ax-m" x={(barX0 + barX1) / 2} y={BAR_Y + BAR_H + 15} style={{ fontSize: 11 }}>
        {multi ? 'network switch' : 'network switch (unused with one server)'}
      </text>

      {/* The servers: eight GPUs on a ring of fast links. */}
      {Array.from({ length: servers }, (_, i) => {
        const x = xOf(i);
        const l = x + L.inset;
        const rr = x + L.w - L.inset;
        const loop = `M${l} ${top} L${rr} ${top} L${rr} ${bottom} L${l} ${bottom} Z`;
        const xs = [0, 1, 2, 3].map((k) => l + ((rr - l) * k) / 3);
        const s = L.square;
        return (
          <g key={i}>
            <rect x={x} y={ROW_Y} width={L.w} height={BOX_H} rx={5} fill="#fcfcfb" stroke="#bdbdb8" />
            <path d={loop} fill="none" stroke={INSIDE_STROKE} strokeWidth={4} strokeLinejoin="round" />
            <path d={loop} className="flow-dots" stroke={GRAPHIC.blue} strokeWidth={4.5} style={insideDots} />
            {xs.flatMap((cx, k) => [
              <rect key={`t${k}`} x={cx - s / 2} y={top - s / 2} width={s} height={s} rx={1.5} fill="#5f5f5f" />,
              <rect key={`b${k}`} x={cx - s / 2} y={bottom - s / 2} width={s} height={s} rx={1.5} fill="#5f5f5f" />,
            ])}
          </g>
        );
      })}

      {/* Time for each algorithm. */}
      <text className="ax" x={16} y={170}>
        Time to sum the data
      </text>
      {multi && (
        <text x={624} y={170} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: flat ? TEXT.red : TEXT.blue }}>
          {flat ? `slowest hop: the network, ${netGbs} GB/s — every link waits for it` : 'eight network rings at once, an eighth of the data each'}
        </text>
      )}
      <g opacity={flat ? 1 : 0.4}>
        <text x={104} y={190} textAnchor="end" style={{ fontSize: 12, fontWeight: flat ? 500 : 400, fill: '#333' }}>
          flat ring
        </text>
        <rect x={flatData.x} y={179} width={flatData.w} height={14} fill={flatDataFill} />
        <rect x={flatDelay.x} y={179} width={flatDelay.w} height={14} fill={GRAPHIC.teal} />
        <text x={TX(flatR.seconds) + 6} y={190} style={{ fontSize: 12, fontWeight: flat ? 500 : 400, fill: TEXT.teal }}>
          {dur(flatR.seconds)}
        </text>
      </g>
      <g opacity={flat ? 0.4 : 1}>
        <text x={104} y={214} textAnchor="end" style={{ fontSize: 12, fontWeight: flat ? 400 : 500, fill: '#333' }}>
          two-level
        </text>
        <rect x={twoIn1.x} y={203} width={twoIn1.w} height={14} fill={INSIDE_FILL} />
        <rect x={twoBetween.x} y={203} width={twoBetween.w} height={14} fill={GRAPHIC.blue} />
        <rect x={twoIn2.x} y={203} width={twoIn2.w} height={14} fill={INSIDE_FILL} />
        <text x={TX(twoR.seconds) + 6} y={214} style={{ fontSize: 12, fontWeight: flat ? 400 : 500, fill: TEXT.teal }}>
          {dur(twoR.seconds)}
        </text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The latency chart: time against GPU count for one message size, A-class servers.

const P_LOG = [3, 4, 5, 6, 7, 8, 9, 10];
const LX = scale(3, 10, 78, 600);
const LY = scale(-6, 1, 212, 26);
const T_TICKS = [-6, -5, -4, -3, -2, -1, 0, 1];
const T_LABEL: Record<number, string> = { [-6]: '1 µs', [-5]: '10 µs', [-4]: '100 µs', [-3]: '1 ms', [-2]: '10 ms', [-1]: '100 ms', 0: '1 s', 1: '10 s' };
const ly = (s: number) => LY(Math.max(-6, Math.min(1, Math.log10(Math.max(s, 1e-9)))));

export const LATENCY_DEFAULTS = { logBytes: 6, logGpus: 10 };

function LatencyChart({ bytes, logGpus }: { bytes: number; logGpus: number }) {
  const rows = useMemo(
    () =>
      P_LOG.map((lg) => {
        const servers = 2 ** lg / PER_SERVER;
        const f = allReduce('A', servers, bytes, 'flat');
        const h = allReduce('A', servers, bytes, 'two-level');
        return { lg, flat: f.seconds, data: f.dataS, two: h.seconds };
      }),
    [bytes],
  );
  const cur = rows.find((r) => r.lg === logGpus) ?? rows[rows.length - 1];
  const xs = rows.map((r) => LX(r.lg));
  const gpus = 2 ** logGpus;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 244"
      role="img"
      aria-label={`Time to all-reduce ${bytesText(bytes)} across 8 to 1,024 A-class GPUs. At ${fmt(gpus)} GPUs a flat ring takes ${dur(cur.flat)}, of which ${dur(cur.flat - cur.data)} is fixed per-step delay; the two-level all-reduce takes ${dur(cur.two)}.`}
    >
      <text className="ax" x={78} y={14}>
        Time to sum {bytesText(bytes)} (log scale)
      </text>
      <GridY y={LY} ticks={T_TICKS} x0={78} x1={600} format={(v) => T_LABEL[v]} />
      <line className="cur" x1={LX(logGpus)} x2={LX(logGpus)} y1={24} y2={212} />
      <path d={linePath(xs, rows.map((r) => ly(r.data)))} fill="none" stroke={GRAPHIC.blue} strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={linePath(xs, rows.map((r) => ly(r.flat)))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} />
      <path d={linePath(xs, rows.map((r) => ly(r.two)))} fill="none" stroke="#333" strokeWidth={2.5} />
      {rows.map((r) => (
        <g key={r.lg}>
          <circle cx={LX(r.lg)} cy={ly(r.flat)} r={r.lg === logGpus ? 5.5 : 3} fill={GRAPHIC.blue} />
          <circle cx={LX(r.lg)} cy={ly(r.two)} r={r.lg === logGpus ? 5.5 : 3} fill="#333" />
          <text className="ax ax-m" x={LX(r.lg)} y={230} style={r.lg === logGpus ? { fill: '#111', fontWeight: 500 } : undefined}>
            {fmt(2 ** r.lg)}
          </text>
        </g>
      ))}
      <text className="ax ax-e" x={600} y={243}>
        GPUs
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const c = useScenario('cluster', CLUSTER_DEFAULTS);
  const { gpu, servers, logBytes, algo } = c.state;
  const bytes = 10 ** logBytes;
  const r = allReduce(gpu, servers, bytes, algo);
  const other = allReduce(gpu, servers, bytes, algo === 'flat' ? 'two-level' : 'flat');
  const solved = clusterSolved(c.state);
  const p = r.gpus;
  const flatR = algo === 'flat' ? r : other;
  const flatLink = servers > 1 ? Math.min(r.intra.gbs, r.inter.gbs) : r.intra.gbs;

  const l = useScenario('latency', LATENCY_DEFAULTS);
  const lBytes = 10 ** l.state.logBytes;
  const lGpus = 2 ** l.state.logGpus;
  const lFlat = allReduce('A', lGpus / PER_SERVER, lBytes, 'flat');
  const lTwo = allReduce('A', lGpus / PER_SERVER, lBytes, 'two-level');

  // Numbers the prose quotes, all from the engine.
  const oneA = allReduce('A', 1, GRAD_8B, 'flat');
  const twoFlat = allReduce('A', 2, GRAD_8B, 'flat');
  const twoTwo = allReduce('A', 2, GRAD_8B, 'two-level');
  const eightFlat = allReduce('A', 8, GRAD_8B, 'flat');
  const eightTwo = allReduce('A', 8, GRAD_8B, 'two-level');
  const sixteenTwo = allReduce('A', 16, GRAD_8B, 'two-level');
  const oneL = allReduce('L', 1, GRAD_8B, 'flat');
  const oneB = allReduce('B', 1, GRAD_8B, 'flat');
  const big1 = allReduce('A', 1, GRAD_70B, 'flat');
  const big8 = allReduce('A', 8, GRAD_70B, 'two-level');
  const tiny = allReduce('A', 128, 1e6, 'flat');
  const tinyTwo = allReduce('A', 128, 1e6, 'two-level');
  const hugeFlat = allReduce('A', 128, 1e11, 'flat');
  const hugeTwo = allReduce('A', 128, 1e11, 'two-level');
  const perServerFlat = networkShare(CHALLENGE_SERVERS, 'flat');
  const perServerTwo = networkShare(CHALLENGE_SERVERS, 'two-level');
  const A = ACCELERATORS.A;

  const flatMaxLog = largestUnderTarget('flat');
  const status =
    gpu !== 'A'
      ? `The servers hold ${ACCELERATORS[gpu].name} GPUs. Choose the A-class.`
      : servers !== CHALLENGE_SERVERS
        ? `There ${servers === 1 ? 'is 1 server' : `are ${servers} servers`}, ${p} GPUs. The challenge needs eight: 64 GPUs.`
        : r.seconds >= TARGET_S
          ? `Summing ${bytesText(bytes)} takes ${dur(r.seconds)}: over the 0.2-second target.`
          : algo === 'flat' && logBytes >= flatMaxLog - 1e-9
            ? `A flat ring sums ${bytesText(bytes)} in ${dur(r.seconds)}, and no more than that in under 0.2 seconds. Is a flat ring the fastest way to sum?`
            : `Summing ${bytesText(bytes)} takes ${dur(r.seconds)}, under 0.2 seconds. Could the 64 GPUs sum more?`;
  const largest = allReduce('A', CHALLENGE_SERVERS, 10 ** LARGEST_LOG, 'two-level');
  const nextUp = allReduce('A', CHALLENGE_SERVERS, 10 ** (LARGEST_LOG + DATA_LOG.step), 'two-level');

  let caption: string;
  if (servers === 1)
    caption = `One server: the ring runs entirely over ${linkName(gpu)} at ${fmt(r.intra.gbs)} GB/s, and summing ${bytesText(bytes)} takes ${dur(r.seconds)}.`;
  else if (algo === 'flat')
    caption = `A flat ring through all ${p} GPUs: every step waits for the hops between servers, at ${fmt(r.inter.gbs, r.inter.gbs < 20 ? 1 : 0)} GB/s per GPU, so the sum takes ${dur(r.seconds)}.`;
  else
    caption = `Two levels: ${dur(r.insideS / 2)} to sum inside each server, ${dur(r.betweenS)} across the network with each card carrying an eighth of the data, and ${dur(r.insideS / 2)} to share the result inside again — ${dur(r.seconds)} in all.`;

  const ariaLabel = `${servers} ${servers === 1 ? 'server' : 'servers'} of eight ${ACCELERATORS[gpu].name} GPUs, ${p} in all, summing ${bytesText(bytes)} with a ${
    algo === 'flat' ? 'flat ring' : 'two-level all-reduce'
  }. It takes ${dur(r.seconds)}; the other algorithm would take ${dur(other.seconds)}.`;

  return (
    <LessonPage id="compute/2.5">
      <P>
        The previous lesson ended at the edge of a single GPU. The 70B model’s weights alone take {bytesText(GRAD_70B)} in BF16 — 70.55 billion parameters at two bytes
        each, as <a href={lessonHref('compute/1.4')}>Lesson 1.4</a> worked out — which is more than an A-class 80 GB can hold, and training it needs several times
        that memory and far more arithmetic than one GPU could finish in any useful time. So large models are trained, and the largest are served, on many GPUs at once.
        That works only if the GPUs can share what they compute, and how fast they can share it decides how much of their arithmetic is put to use.
      </P>
      <P>
        The simplest way to divide training is to give every GPU its own copy of the model and its own share of the training examples. Each GPU works out, for every
        parameter, which way and how far to nudge it: the <b>gradients</b>, one number per parameter, or {bytesText(GRAD_8B)} of them for the 8B model in BF16. The copies
        stay identical only if every GPU applies the same nudge, so before each step can finish, every GPU needs the sum of everyone’s gradients. Combining a block of
        numbers from every GPU and handing every GPU the total is called an <b>all-reduce</b>, and it is the central exchange of training. (Chapter 3 meets other
        ways to divide a model; they need the same operation, and others like it.)
      </P>
      <P>
        The usual way to do it is a ring. Line the GPUs up in a loop and cut the data into as many chunks as there are GPUs. At each step, every GPU sends one chunk to its
        neighbor and adds the chunk it receives into its own. After p − 1 steps, each GPU holds one chunk completely summed; p − 1 more steps pass the finished chunks
        around the loop. Every link is busy the whole time, and each GPU sends just under twice the data, 2(p − 1)/p of it, however many GPUs share the work. With{' '}
        <K tone="blue">bandwidth</K> B on each link and a fixed <K tone="teal">delay</K> α for every step, the time is:
      </P>
      <Eq label="Ring all-reduce time equals two (p minus one) over p times the data over the bandwidth, plus two (p minus one) times the per-step delay">
        <span>T</span>
        <Op>=</Op>
        <Frac top="2(p − 1)" bottom="p" />
        <Op>×</Op>
        <Frac top="S" bottom={<K tone="blue">B</K>} />
        <Op>+</Op>
        <span>2(p − 1) ×</span>
        <K tone="teal">α</K>
      </Eq>
      <P>
        In the next demonstration, GPUs come in servers of eight, as they usually do. Inside a server, the A-class GPUs are joined by dedicated GPU links that carry{' '}
        {fmt(A.scaleUpGBs)} GB/s per GPU in each direction; the L-class, a PCIe card, talks to its neighbors through the host at {fmt(ACCELERATORS.L.scaleUpGBs)} GB/s.
        Between servers, each GPU has its own network card: {fmt(A.nicGbps)} gigabits per second, or {fmt(A.nicGbps / 8)} GB/s, for the A- and B-class. The dots show
        data moving, at a pace set by the link it crosses. Start with one server summing the 8B model’s gradients, then add servers, change the accelerator and switch
        the algorithm:
      </P>

      <Figure name="GPU Cluster Topology" scenario={c}>
        <ClusterDiagram gpu={gpu} servers={servers} algo={algo} r={r} other={other} ariaLabel={ariaLabel} />
        <Legend
          items={[
            { label: 'inside servers', color: INSIDE_FILL },
            { label: 'between servers', color: GRAPHIC.blue },
            { label: 'fixed per-step delays (flat ring)', color: GRAPHIC.teal },
          ]}
        />
        <Segmented
          label="Accelerator"
          value={gpu}
          onChange={(v) => c.set({ gpu: v })}
          options={GPU_IDS.map((id) => ({ value: id, label: ACCELERATORS[id].name }))}
        />
        <Segmented
          label="Algorithm"
          value={algo}
          onChange={(v) => c.set({ algo: v })}
          options={[
            { value: 'flat', label: 'Flat ring' },
            { value: 'two-level', label: 'Two-level' },
          ]}
        />
        <Slider label="Servers" tone="blue" value={servers} min={1} max={16} onChange={(v) => c.set({ servers: v })} display={`${servers} × 8 = ${servers * 8} GPUs`} />
        <Slider
          label="Data to sum"
          tone="violet"
          value={logBytes}
          min={DATA_LOG.min}
          max={DATA_LOG.max}
          step={DATA_LOG.step}
          onChange={(v) => c.set({ logBytes: Math.round(v * 100) / 100 })}
          display={bytesText(bytes)}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 20px', alignItems: 'center', fontSize: 14, color: '#6f6f6f' }}>
          <span>Gradients of the</span>
          <Button onClick={() => c.set({ logBytes: Math.log10(GRAD_8B) })}>8B model, {bytesText(GRAD_8B)}</Button>
          <Button onClick={() => c.set({ logBytes: Math.log10(GRAD_70B) })}>70B model, {bytesText(GRAD_70B)}</Button>
        </div>
        <Readouts items={[{ label: 'bus bandwidth', value: `${fmt(r.busGBs)} GB/s`, tone: 'blue' }]} />
        {algo === 'flat' || servers === 1 ? (
          <Eq label="The ring's time for the current settings">
            <span>T</span>
            <Op>=</Op>
            <Frac top={`2 × ${fmt(p - 1)}`} bottom={fmt(p)} />
            <Op>×</Op>
            <Frac top={<span>{bytesText(bytes)}</span>} bottom={<K tone="blue">{fmt(flatLink, flatLink < 20 ? 1 : 0)} GB/s</K>} />
            <Op>+</Op>
            <span>{fmt(2 * (p - 1))} ×</span>
            <K tone="teal">{fmt(servers > 1 ? Math.max(r.intra.latencyUs, r.inter.latencyUs) : r.intra.latencyUs)} µs</K>
            <Op>=</Op>
            <K tone="teal">{dur(flatR.seconds)}</K>
          </Eq>
        ) : (
          <Eq label="The two-level all-reduce's time for the current settings">
            <span>T</span>
            <Op>=</Op>
            <span>{dur(r.insideS / 2)}</span>
            <Op>+</Op>
            <K tone="blue">{dur(r.betweenS)}</K>
            <Op>+</Op>
            <span>{dur(r.insideS / 2)}</span>
            <Op>=</Op>
            <K tone="teal">{dur(r.seconds)}</K>
          </Eq>
        )}
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        With one server of A-class GPUs, the ring runs entirely over the GPU links and sums {bytesText(GRAD_8B)} in {dur(oneA.seconds)}. The{' '}
        <b>bus bandwidth</b> in the readout is a yardstick for comparing all-reduces of any size: the data each GPU would send in one ring through all p GPUs,
        2(p − 1)/p × S, divided by the time the sum actually took — the link speed such a ring would need to finish as fast. Here it is {fmt(oneA.busGBs)} GB/s, the GPU links’ own speed. Add a second server and,
        with a flat ring threading through all 16 GPUs, the same sum takes {dur(twoFlat.seconds)}: nearly ten times as long, for only twice the GPUs, and the bus
        bandwidth falls to {fmt(twoFlat.busGBs)} GB/s. Every step of a ring waits for its slowest hop, and the hops between servers run at{' '}
        {fmt(A.nicGbps / 8)} GB/s against {fmt(A.scaleUpGBs)} inside. Watch the dots inside the servers slow to the network’s pace. Adding more servers changes
        little after that: at eight servers the flat ring takes {dur(eightFlat.seconds)}, since each hop between servers still carries just under twice the data at{' '}
        {fmt(A.nicGbps / 8)} GB/s, and a ring’s time hardly depends on how many hops it has.
      </P>
      <P>
        The accelerator matters as much as the arrangement. On one server, the L-class needs {dur(oneL.seconds)} to sum the same gradients through PCIe, and the
        B-class, with {fmt(ACCELERATORS.B.scaleUpGBs)} GB/s links, {dur(oneB.seconds)}: a factor of {fmt(oneL.seconds / oneB.seconds)} between two servers that each
        hold eight GPUs. Summing {bytesText(GRAD_70B)}, the size of the 70B model’s gradients, takes {dur(big1.seconds)} even inside one server of A-class GPUs.
      </P>

      <H2>Two levels</H2>
      <P>
        The flat ring’s trouble is less how much it sends across the network than how. Each server joins the ring through a single network card, which carries
        just under twice the data while the server’s other seven cards sit idle. A <b>two-level</b> all-reduce puts all eight to work, in three phases. First,
        inside each server, the eight GPUs sum their data over their fast links so that each ends up holding one eighth of the server’s total. Next, across servers,
        the GPUs holding the same eighth all-reduce it with their counterparts in the other servers: eight separate rings, one per GPU and its network card, all
        running at once, each carrying an eighth of the data. Last, inside each server again, the GPUs share their finished eighths. Each server still sends about as
        much over the network as before — at eight servers, {fmt(perServerTwo, 2)} times the data against the flat ring’s {fmt(perServerFlat, 2)} — but through
        eight cards instead of one. (Real communication libraries win back much of this even with flat rings, by running several at once, each crossing between
        servers through a different card.)
      </P>
      <P>
        Choose the two-level algorithm in <FigRef to="GPU Cluster Topology">the first demonstration</FigRef>. With two servers the sum now takes{' '}
        {dur(twoTwo.seconds)} instead of {dur(twoFlat.seconds)}, and at eight servers — 64 GPUs — {dur(eightTwo.seconds)}. Doubling to 16 servers adds only a little,
        to {dur(sixteenTwo.seconds)}: a ring’s time hardly grows with its length when the messages are large.
      </P>

      <Challenge
        id="a"
        figure="GPU Cluster Topology"
        question={`Predict first: 64 A-class GPUs sum the 8B model’s ${bytesText(GRAD_8B)} in two levels in ${dur(eightTwo.seconds)}, and at this size the per-step delays hardly count, so the time grows in proportion to the data. How much could they sum in 0.2 seconds? Then find the most data on the slider that 64 A-class GPUs — eight servers — can sum in under 0.2 seconds.`}
        solved={solved}
        status={status}
        success={`Solved: ${bytesText(10 ** LARGEST_LOG)} in ${dur(largest.seconds)}, summed in two levels; the next setting, ${bytesText(10 ** (LARGEST_LOG + DATA_LOG.step))}, takes ${dur(nextUp.seconds)}. The prediction, ${bytesText(GRAD_8B)} × 0.2 ÷ ${fmt(eightTwo.seconds, 3)} ≈ ${bytesText(PREDICTED_BYTES)}, falls between the two. A flat ring could sum only about ${fmt((GRAD_8B * TARGET_S) / eightFlat.seconds / 1e9)} GB in the same time, because its traffic between servers squeezes through one network card per server while the two-level all-reduce spreads it over all eight.`}
      />

      <H2>The cost of every step</H2>
      <P>
        The formula has a second term. Every step of a ring also costs a fixed delay — for the software to notice the data has arrived, and for switches and wires to
        pass it on — which we put at {fmt(scaleUpLink('A').latencyUs)} µs inside a server and {fmt(scaleOutLink('A').latencyUs)} µs across the
        network. A ring of p GPUs takes 2(p − 1) steps, so for small messages the delays, not the bandwidth, set the time. In the next demonstration, choose how much
        data to sum and compare the two algorithms on A-class servers from 8 GPUs to 1,024. The dashed line is what the flat ring would take if its steps cost nothing
        but the data they carry:
      </P>

      <Figure name="GPU Cluster Topology · latency" scenario={l}>
        <LatencyChart bytes={lBytes} logGpus={l.state.logGpus} />
        <Legend
          items={[
            { label: 'flat ring', color: GRAPHIC.blue, kind: 'line' },
            { label: 'flat ring, data alone', color: GRAPHIC.blue, kind: 'line', dashed: true },
            { label: 'two-level', color: '#333', kind: 'line' },
          ]}
        />
        <Slider label="Data to sum" tone="violet" value={l.state.logBytes} min={3} max={11} step={0.1} onChange={(v) => l.set({ logBytes: v })} display={bytesText(lBytes)} />
        <Slider label="GPUs" tone="blue" value={l.state.logGpus} min={3} max={10} onChange={(v) => l.set({ logGpus: v })} display={fmt(lGpus)} />
        <Readouts
          items={[
            { label: 'flat ring', value: dur(lFlat.seconds), tone: 'teal' },
            { label: 'of which fixed delays', value: `${fmt((100 * lFlat.delayS) / lFlat.seconds, 1)}%`, tone: 'teal' },
            { label: 'two-level', value: dur(lTwo.seconds), tone: 'teal' },
          ]}
        />
      </Figure>

      <P>
        At the starting settings, a single megabyte summed across 1,024 GPUs, the flat ring takes {dur(tiny.seconds)}, and {fmt((100 * tiny.delayS) / tiny.seconds, 1)}%
        of that is delay: its 2,046 steps cost {fmt(scaleOutLink('A').latencyUs)} µs apiece while the data itself would cross in {dur(tiny.dataS)}. The two-level
        version has far fewer steps on the slow network — each of its rings links only the 128 servers — and takes {dur(tinyTwo.seconds)}. Raise the data toward{' '}
        {bytesText(1e11)} and the flat ring’s curve settles onto its dashed line — at {fmt(128 * PER_SERVER)} GPUs, {dur(hugeFlat.seconds)} against{' '}
        {dur(hugeFlat.dataS)} — as bandwidth takes over from the delays. The two-level curve flattens too, but stays far below, at {dur(hugeTwo.seconds)},
        because its network phase spreads the data over every card. Real communication libraries choose among several patterns, rings and trees among them, by
        message size for exactly this reason.
      </P>
      <P>
        Small messages matter most when a single model is split across GPUs within each layer, as the largest often are. Those GPUs exchange partial results after
        every layer, many times per training step, so they are kept inside one server, on the fast links with the shortest delays — a constraint that comes back in{' '}
        <a href={lessonHref('compute/3.3')}>Lesson 3.3</a>.
      </P>

      <H2>Why GPUs come in eights</H2>
      <P>
        All of this explains the shape of the hardware. Accelerators for training are typically sold in servers of eight joined by dedicated links, with a network
        card for every GPU — the newest systems stretch those dedicated links across a whole rack of several dozen GPUs — and the network that joins the servers is designed as carefully as the GPUs themselves (<a href={lessonHref('compute/4.4')}>Lesson 4.4</a>). It also
        explains why a GPU-hour isn’t a single product. Even two GPUs with identical arithmetic would not be worth the same hour if one reached its neighbors only
        over PCIe and a slower network card: while gradients are being summed the arithmetic waits, and summing {bytesText(GRAD_8B)} takes{' '}
        {fmt(oneL.seconds / oneA.seconds)} times as long on a server of L-class cards as on a server of A-class GPUs. And even 64 A-class GPUs, summing the 70B
        model’s gradients in two levels, take {dur(big8.seconds)} for each exchange. How much that costs depends on how long each step computes between exchanges,
        which Chapter 3 measures.
      </P>
      <P>
        That completes this chapter’s answer to what decides how much useful work a GPU can do: enough parallel work to fill thousands of lanes and hide their waits
        (Lessons 2.1–2.2), arithmetic arranged so the matrix units can reuse every byte (2.3), the bandwidth to feed them (2.4), and links fast enough to keep many GPUs
        working as one (2.5). The next chapter turns to the work itself, starting with what a neural network computes, layer by layer, in{' '}
        <a href={lessonHref('compute/3.1')}>Lesson 3.1</a>.
      </P>
    </LessonPage>
  );
}
