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
  niceTicks,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { OPTIC_PRICE, SWITCH_PORTS, SWITCH_PRICE, fabric, jobNetworkShare, maxTwoTierGpus, type Fabric } from '../../../engines/compute/dcNetwork';
import { DP_OVERLAP, trainingRun, type TrainResult } from '../../../engines/compute/training';
import { ringAllReduce, scaleOutLink } from '../../../engines/compute/collectives';
import { workloadFit } from '../../../engines/compute/compatibility';
import { ACCELERATORS, SERVERS } from '../../../model/compute/hardware';
import { MODELS, matmulParams } from '../../../model/compute/models';
import { useProgress } from '../../../course/progress';

// ---------------------------------------------------------------------------
// The fabric of the first demonstration.

export const FABRIC_DEFAULTS = { gpus: 1024, down: 32 };
export const GPUS_MIN = 256;
export const GPUS_MAX = 2048;
export const DOWN_MIN = 32;
export const DOWN_MAX = 60;

/** Network card speed of the A-class, Gb/s. */
export const NIC_GBPS = ACCELERATORS.A.nicGbps;
/** What each A-class GPU's share of its server costs (simulated), $. */
export const SERVER_PER_GPU = SERVERS.A.capex / SERVERS.A.gpus;

// ---------------------------------------------------------------------------
// The training run of the second demonstration: Lesson 3.3's 70B run, 8 GPUs per layer, one stage.

export const RUN = { model: '70B', gpu: 'A', gpus: 1024, tp: 8, pp: 1, batchTokens: 4 * 1024 * 1024, seqLen: 4096, tokens: 2e12 } as const;
/** The cluster the run shares with other customers' jobs. */
export const CLUSTER_GPUS = 2048;
/** The challenge's tolerance: no more than 5% longer than on a non-blocking network. */
export const WITHIN = 1.05;
export const RUN_DOWN_MAX = 56;

export type Placement = 'packed' | 'scattered';
export const RUN_DEFAULTS = { down: 32, placement: 'packed' as Placement, others: 50 };
type RunState = typeof RUN_DEFAULTS;

const runCache = new Map<number, TrainResult>();
/** The run with a given share of each GPU's network bandwidth (memoized). */
export function runAt(share: number): TrainResult {
  const key = Math.round(share * 1e6) / 1e6;
  let r = runCache.get(key);
  if (!r) {
    r = trainingRun({ ...RUN, networkShare: key });
    runCache.set(key, r);
  }
  return r;
}

export const BASE = runAt(1);
export const DP = RUN.gpus / (RUN.tp * RUN.pp);
/** Each GPU's share of the BF16 gradients, bytes. */
export const GRAD_BYTES = (2 * matmulParams(MODELS['70B'])) / (RUN.tp * RUN.pp);
/** Seconds of the backward pass the gradient exchange can hide behind (the engine's overlap window). */
export const HIDE_WINDOW = DP_OVERLAP * BASE.computeS * (2 / 3);

/** The gradient exchange across the network at a given bandwidth share, s. */
export function exchangeS(share: number): number {
  const net = scaleOutLink('A');
  return ringAllReduce(GRAD_BYTES, DP, { ...net, gbs: net.gbs * share }).seconds;
}

/** Smallest share at which the exchange still hides completely. */
export const HIDE_SHARE = exchangeS(1) / HIDE_WINDOW;

export function clusterFabric(down: number): Fabric {
  return fabric({ gpus: CLUSTER_GPUS, downPorts: down });
}

/** The share of its network bandwidth the 1,024-GPU run gets. */
export function runShare(s: RunState): number {
  return jobNetworkShare(clusterFabric(s.down), RUN.gpus, s.placement, s.others / 100);
}

/** The cheapest fabric (packed placement) that keeps the run within 5% of its non-blocking time. */
export function cheapestWithin(): { down: number; cost: number; days: number; share: number } {
  let best = { down: 0, cost: Infinity, days: Infinity, share: 0 };
  for (let d = DOWN_MIN; d <= RUN_DOWN_MAX; d++) {
    const f = clusterFabric(d);
    const share = jobNetworkShare(f, RUN.gpus, 'packed', 0);
    const r = runAt(share);
    if (r.days <= BASE.days * WITHIN + 1e-9 && f.costPerGpu < best.cost - 1e-9) best = { down: d, cost: f.costPerGpu, days: r.days, share };
  }
  return best;
}

export const CHEAPEST = cheapestWithin();

/** The challenge: the run within 5% of its non-blocking time, on the cheapest such fabric. */
export function cheapestSolved(s: RunState): boolean {
  const r = runAt(runShare(s));
  return r.days <= BASE.days * WITHIN + 1e-9 && clusterFabric(s.down).costPerGpu <= CHEAPEST.cost + 0.5;
}

// Numbers the prose quotes.
const F32 = fabric({ gpus: 1024, downPorts: 32 });
const F48 = fabric({ gpus: 1024, downPorts: 48 });
const C32 = clusterFabric(32);
const C48 = clusterFabric(48);
const RUN48 = runAt(jobNetworkShare(C48, RUN.gpus, 'packed', 0));
const SCAT32 = runAt(jobNetworkShare(C32, RUN.gpus, 'scattered', 0.5));
const C40 = clusterFabric(40);
const PACK40 = runAt(jobNetworkShare(C40, RUN.gpus, 'packed', 0));
const SCAT40 = runAt(jobNetworkShare(C40, RUN.gpus, 'scattered', 0.5));
const TUNE_GPUS = (() => {
  const f = workloadFit('tune8', 'A');
  return f.feasible ? f.gpus : 0;
})();

export const LESSON_NUMBERS = {
  f32: F32,
  f48: F48,
  serverShare: F32.costPerGpu / SERVER_PER_GPU,
  cheaper48: 1 - F48.costPerGpu / F32.costPerGpu,
  base: BASE,
  run48: RUN48,
  exchange1: exchangeS(1),
  exchange48: exchangeS(C48.crossShare),
  scat32: SCAT32,
  pack40: PACK40,
  scat40: SCAT40,
  saving48: C32.costPerGpu - C48.costPerGpu,
  /** The same 3 : 1 saving on the first demonstration's 1,024 GPUs. */
  saving48Small: F32.costPerGpu - F48.costPerGpu,
  /** The largest two-tier fabric: the 2,048-GPU cluster, non-blocking. */
  f2048: fabric({ gpus: maxTwoTierGpus(32), downPorts: 32 }),
  /** GPU-hours the 3 : 1 fabric adds to the run. */
  extraGpuHours: (RUN48.days - BASE.days) * 24 * RUN.gpus,
  tuneGpus: TUNE_GPUS,
  tuneShare: jobNetworkShare(F48, TUNE_GPUS, 'packed', 0.5),
};

// ---------------------------------------------------------------------------
// Formatting and colors.

const NET = GRAPHIC.blue;
const NET_LIGHT = tint(GRAPHIC.blue, 0.4);
const GPU_GRAY = '#b9b9b4';
const ARITH = GRAPHIC.orange;
const WAIT = '#2f5f8f';

function ratio(f: Fabric): string {
  return `${fmt(f.oversubscription, f.oversubscription % 1 < 0.005 ? 0 : 2)} : 1`;
}

function pct(x: number, digits = 0): string {
  return `${fmt(x * 100, digits)}%`;
}

function secs(s: number): string {
  return `${fmt(s, 2)} s`;
}

function days(d: number): string {
  return `${fmt(d, 1)} days`;
}

function millions(x: number): string {
  return `$${fmt(x / 1e6, 2)} million`;
}

// ---------------------------------------------------------------------------
// The first figure: spines above, leaves below, the GPUs under each leaf.

function FabricDiagram({ f, ariaLabel }: { f: Fabric; ariaLabel: string }) {
  const x0 = 70;
  const x1 = 620;
  const yS = 34;
  const yL = 150;
  const leafH = 44;
  const gpuH = 46;
  const lStep = (x1 - x0) / f.leaves;
  const lw = Math.max(3, Math.min(30, lStep * 0.72));
  const lx = (i: number) => x0 + (i + 0.5) * lStep;
  const sStep = f.spines > 0 ? (x1 - x0) / f.spines : 0;
  const sw = Math.max(4, Math.min(44, sStep * 0.72));
  const sx = (j: number) => x0 + (j + 0.5) * sStep;
  const upH = (leafH * f.upPorts) / SWITCH_PORTS;
  let links = '';
  for (let i = 0; i < f.leaves; i++) for (let j = 0; j < f.spines; j++) links += `M${lx(i).toFixed(1)} ${yL} L${sx(j).toFixed(1)} ${yS + 18}`;
  const linkOpacity = Math.max(0.08, Math.min(0.4, 40 / Math.max(1, f.leaves * f.spines) + 0.06));
  return (
    <svg className="diagram" viewBox="0 0 640 274" role="img" aria-label={ariaLabel}>
      <text className="ax" x={8} y={yS + 13}>
        spines
      </text>
      <text className="ax" x={8} y={yL + 26}>
        leaves
      </text>
      <text className="ax" x={8} y={yL + leafH + 30}>
        GPUs
      </text>
      {f.spines > 0 && <path d={links} stroke={NET} strokeWidth={1} opacity={linkOpacity} fill="none" />}
      {Array.from({ length: f.spines }, (_, j) => (
        <rect key={j} x={sx(j) - sw / 2} y={yS} width={sw} height={18} rx={2} fill={NET} />
      ))}
      {Array.from({ length: f.leaves }, (_, i) => {
        const attached = Math.min(f.downPorts, f.gpus - i * f.downPorts);
        const h = (gpuH * attached) / SWITCH_PORTS;
        return (
          <g key={i}>
            <rect x={lx(i) - lw / 2} y={yL} width={lw} height={upH} fill={NET} />
            <rect x={lx(i) - lw / 2} y={yL + upH} width={lw} height={leafH - upH} fill="#8f8f8a" />
            <line x1={lx(i)} x2={lx(i)} y1={yL + leafH} y2={yL + leafH + 6} stroke={GPU_GRAY} strokeWidth={1} />
            <rect x={lx(i) - lw / 2} y={yL + leafH + 6} width={lw} height={h} fill={GPU_GRAY} />
          </g>
        );
      })}
      <text className="ax ax-e" x={x1} y={yS - 8}>
        {f.spines > 0 ? `${fmt(f.spines)} spine switch${f.spines === 1 ? '' : 'es'}` : 'one leaf: no spines needed'}
      </text>
      <text className="ax ax-e" x={x1} y={yL + leafH + gpuH + 24}>
        {`${fmt(f.leaves)} leaf switch${f.leaves === 1 ? '' : 'es'}, each with ${f.downPorts} ports to GPUs and ${f.upPorts} up · ${fmt(f.gpus)} GPUs at ${NIC_GBPS} Gb/s`}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second figure: one training step, and the fabric's cost against the run's length.

const T_MAX = 8;

function StepTimeline({ r, exchange, ariaLabel }: { r: TrainResult; exchange: number; ariaLabel: string }) {
  const x = scale(0, T_MAX, 120, 620);
  const clip = (t: number) => Math.min(T_MAX, t);
  const fwd = r.computeS / 3;
  const start = r.computeS - HIDE_WINDOW;
  const end = start + exchange;
  const wait = r.dpCommS;
  const y1 = 30;
  const y2 = 86;
  const h = 22;
  return (
    <svg className="chart" viewBox="0 0 640 150" role="img" aria-label={ariaLabel}>
      <text className="ax" x={0} y={y1 + 15}>
        one step
      </text>
      <text className="ax" x={0} y={y2 + 9}>
        gradient
      </text>
      <text className="ax" x={0} y={y2 + 23}>
        exchange
      </text>
      {/* The step: arithmetic, then any wait for gradients, then the in-server exchanges (drawn last for clarity). */}
      <rect x={x(0)} y={y1} width={x(fwd) - x(0)} height={h} fill={tint(ARITH, 0.65)} />
      <rect x={x(fwd)} y={y1} width={x(r.computeS) - x(fwd)} height={h} fill={ARITH} />
      <text className="lab" x={(x(0) + x(fwd)) / 2} y={y1 + 15} textAnchor="middle">
        forward
      </text>
      <text className="lab" x={(x(fwd) + x(r.computeS)) / 2} y={y1 + 15} textAnchor="middle" style={{ fill: '#fff' }}>
        backward
      </text>
      {wait > 0.005 && <rect x={x(r.computeS)} y={y1} width={x(clip(r.computeS + wait)) - x(r.computeS)} height={h} fill={WAIT} />}
      <rect x={x(clip(r.computeS + wait))} y={y1} width={x(clip(r.computeS + wait + r.tpCommS)) - x(clip(r.computeS + wait))} height={h} fill={NET_LIGHT} />
      {/* The exchange runs alongside the backward pass; only what sticks out past it delays the step. */}
      <line x1={x(start)} x2={x(r.computeS)} y1={y2 - 8} y2={y2 - 8} stroke="#777" strokeWidth={1} />
      <line x1={x(start)} x2={x(start)} y1={y2 - 12} y2={y2 - 4} stroke="#777" strokeWidth={1} />
      <line x1={x(r.computeS)} x2={x(r.computeS)} y1={y2 - 12} y2={y2 - 4} stroke="#777" strokeWidth={1} />
      <rect x={x(start)} y={y2} width={x(clip(Math.min(end, r.computeS))) - x(start)} height={h} fill={NET_LIGHT} />
      {end > r.computeS && <rect x={x(r.computeS)} y={y2} width={x(clip(end)) - x(r.computeS)} height={h} fill={WAIT} />}
      {end > T_MAX && (
        <text className="lab" x={x(T_MAX) - 4} y={y2 + 15} textAnchor="end" style={{ fill: '#fff' }}>
          {`→ ${secs(end - start)}`}
        </text>
      )}
      <line className="cur" x1={x(r.computeS)} x2={x(r.computeS)} y1={y1 - 6} y2={y2 + h + 4} />
      {[0, 2, 4, 6, 8].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={y2 + h + 20}>
          {t === 8 ? '8 s' : t}
        </text>
      ))}
      <text className="ax" x={x(start)} y={y2 + h + 34}>
        {`the backward pass can hide ${secs(HIDE_WINDOW)} of it`}
      </text>
    </svg>
  );
}

interface FabricPoint {
  down: number;
  cost: number;
  days: number;
}

function CostChart({ points, current, revealed, ariaLabel }: { points: FabricPoint[]; current: FabricPoint; revealed: boolean; ariaLabel: string }) {
  const x = scale(1800, 4400, 70, 610);
  const y = scale(16, 40, 196, 24);
  const yc = (d: number) => y(Math.min(40, d));
  const limit = BASE.days * WITHIN;
  return (
    <svg className="chart" viewBox="0 0 640 232" role="img" aria-label={ariaLabel}>
      <text className="ax" x={70} y={12}>
        Days to train the 70B model, packed onto leaves of its own
      </text>
      <GridY y={y} ticks={niceTicks(16, 40, 4)} x0={70} x1={610} format={(v) => `${v}`} />
      <line x1={70} x2={610} y1={y(limit)} y2={y(limit)} stroke={TEXT.teal} strokeWidth={1.2} strokeDasharray="5 4" />
      <text className="ax ax-e" x={610} y={y(limit) - 5} style={{ fill: TEXT.teal }}>
        {`5% longer than non-blocking: ${days(limit)}`}
      </text>
      {/* Every fabric's point is drawn only once the challenge is solved: until then, just the current one. */}
      {revealed && <path d={linePath(points.map((p) => x(p.cost)), points.map((p) => yc(p.days)))} fill="none" stroke={NET} strokeWidth={1.5} />}
      {revealed &&
        points.map((p) => <circle key={p.down} cx={x(p.cost)} cy={yc(p.days)} r={p.down === current.down ? 3.5 : 2.5} fill={NET} />)}
      {!revealed && <circle cx={x(current.cost)} cy={yc(current.days)} r={3.5} fill={NET} />}
      <circle cx={x(current.cost)} cy={yc(current.days)} r={7} fill="none" stroke="#111" strokeWidth={2} />
      {current.days > 40 && (
        <text className="lab" x={x(current.cost) + 10} y={y(40) + 4}>
          {`↑ ${days(current.days)}`}
        </text>
      )}
      {[2000, 2500, 3000, 3500, 4000].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={214}>
          {usd(v)}
        </text>
      ))}
      <text className="ax ax-e" x={610} y={230}>
        network cost per GPU · non-blocking at the right, cheapest at the left
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('fabric', FABRIC_DEFAULTS);
  const f = fabric({ gpus: s1.state.gpus, downPorts: s1.state.down });
  const perGpuGbps = NIC_GBPS * f.crossShare;
  const caption =
    f.leaves === 1
      ? `All ${fmt(f.gpus)} GPUs fit under one leaf: every GPU reaches every other through a single switch.`
      : f.oversubscription <= 1 + 1e-9
        ? `Non-blocking: each leaf has as many links up as GPUs below, so all ${fmt(f.gpus)} GPUs can send across the fabric at once at their full ${NIC_GBPS} Gb/s.`
        : `${f.downPorts} GPUs share each leaf’s ${f.upPorts} links up. When they all send across the fabric at once, each gets ${pct(f.crossShare)} of its card: ${fmt(perGpuGbps)} Gb/s.`;
  const aria1 = `A leaf–spine network for ${fmt(f.gpus)} GPUs: ${f.leaves} leaf switches with ${f.downPorts} ports to GPUs and ${f.upPorts} up each, and ${f.spines} spine switches. Oversubscription ${ratio(f)}; network cost ${usd(f.costPerGpu)} per GPU.`;

  const s2 = useScenario('training', RUN_DEFAULTS);
  const st = s2.state;
  const cf = clusterFabric(st.down);
  const share = runShare(st);
  const r = runAt(share);
  const ex = exchangeS(share);
  const longer = r.days / BASE.days - 1;
  const points = useMemo<FabricPoint[]>(() => {
    const out: FabricPoint[] = [];
    for (let d = DOWN_MIN; d <= RUN_DOWN_MAX; d++) {
      const c = clusterFabric(d);
      out.push({ down: d, cost: c.costPerGpu, days: runAt(jobNetworkShare(c, RUN.gpus, 'packed', 0)).days });
    }
    return out;
  }, []);
  const current: FabricPoint = { down: st.down, cost: cf.costPerGpu, days: r.days };
  const solved = cheapestSolved(st);
  // The cost chart draws every fabric only once the challenge is solved (now or on an earlier visit).
  const progress = useProgress();
  const revealed = solved || (progress['compute/4.4']?.includes('a') ?? false);
  const hidden = r.dpCommS < 0.005;
  const caption2 = hidden
    ? `The run gets ${pct(share)} of each card, ${fmt(NIC_GBPS * share)} Gb/s. Its gradient exchange takes ${secs(ex)}, inside the ${secs(HIDE_WINDOW)} the backward pass can hide.`
    : `The run gets ${pct(share)} of each card, ${fmt(NIC_GBPS * share)} Gb/s. Its gradient exchange takes ${secs(ex)}, and ${secs(r.dpCommS)} of it sticks out past the backward pass in every step.`;
  const aria2 = `One training step of the 70B run: ${secs(r.computeS)} of arithmetic, ${secs(r.dpCommS)} waiting for gradients and ${secs(r.tpCommS)} of exchanges inside servers. The gradient exchange takes ${secs(ex)} at ${pct(share)} of each network card.`;
  const aria3 = revealed
    ? `Network cost per GPU against days to train, for leaves with ${DOWN_MIN} to ${RUN_DOWN_MAX} ports facing GPUs. The current fabric costs ${usd(cf.costPerGpu)} per GPU and the run takes ${days(r.days)}.`
    : `Network cost per GPU against days to train, for the current fabric only: ${usd(cf.costPerGpu)} per GPU, and the run takes ${days(r.days)}.`;
  let status: string;
  if (r.days > BASE.days * WITHIN + 1e-9) status = `The run takes ${days(r.days)}, ${pct(longer, 1)} longer than on a non-blocking network: over the 5% allowed.`;
  else if (st.down === RUN_DEFAULTS.down) status = 'Make your prediction, then move the ports toward the GPUs.';
  else status = `The run takes ${days(r.days)}, within 5%, on a fabric costing ${usd(cf.costPerGpu)} per GPU. Can a cheaper one keep it there?`;
  const nextDays = runAt(jobNetworkShare(clusterFabric(CHEAPEST.down + 1), RUN.gpus, 'packed', 0)).days;

  const N = LESSON_NUMBERS;

  return (
    <LessonPage id="compute/4.4">
      <P>
        The previous three lessons fed and cooled racks of GPUs. But 32 racks of A-class 80 GB GPUs, the 1,024 of <a href={lessonHref('compute/4.1')}>Lesson 4.1</a>,
        aren’t yet one machine. Inside each server, eight GPUs share their fast GPU links. Between servers, as <a href={lessonHref('compute/2.5')}>Lesson 2.5</a>{' '}
        found, every GPU has a network card of its own, {NIC_GBPS} gigabits per second, and a training run sends its gradients across those cards on every step. Some
        piece of equipment has to connect 1,024 network cards so that any one can reach any other, quickly and all at once.
      </P>
      <P>
        No single switch has that many ports. The switches in our clusters have {SWITCH_PORTS} ports of 400 Gb/s each (at a simulated {usd(SWITCH_PRICE)} apiece), so
        the network is built in two tiers. Every GPU’s card plugs into a <K tone="blue">leaf switch</K>. Each leaf gives some of its {SWITCH_PORTS} ports to GPUs and
        the rest to links upward, one or more to every <K tone="blue">spine switch</K>, so any two GPUs are at most three switches apart: leaf, spine, leaf. If a leaf
        has as many links up as GPUs below, everything its GPUs send can leave at full speed, and the network is called non-blocking. Two tiers of 64-port switches
        built that way reach at most {fmt(maxTwoTierGpus(32))} GPUs; larger clusters add a third tier. Give a leaf more GPUs than links up and the ratio of the two, its{' '}
        <K tone="blue">oversubscription</K>, is how many GPUs share each link up when they all send across the fabric at once. And a network’s{' '}
        <K tone="blue">bisection bandwidth</K> is how fast one half of its GPUs can send to the other half. In the next demonstration, choose the number of GPUs and how
        many of each leaf’s ports face them:
      </P>

      <Figure name="Data Center Network Simulator" scenario={s1}>
        <FabricDiagram f={f} ariaLabel={aria1} />
        <Legend
          items={[
            { label: 'leaf ports to spines', color: NET },
            { label: 'leaf ports to GPUs', color: '#8f8f8a' },
            { label: 'GPUs attached', color: GPU_GRAY },
          ]}
        />
        <Readouts
          items={[
            { label: 'network cost per GPU', value: usd(f.costPerGpu), tone: 'green' },
            { label: 'bisection bandwidth', value: `${fmt(f.bisectionTbps, 1)} Tb/s`, tone: 'blue' },
          ]}
        />
        <Slider label="GPUs" value={s1.state.gpus} min={GPUS_MIN} max={GPUS_MAX} step={256} onChange={(v) => s1.set({ gpus: v })} display={fmt(s1.state.gpus)} />
        <Slider
          label="Leaf ports facing GPUs"
          tone="blue"
          value={s1.state.down}
          min={DOWN_MIN}
          max={DOWN_MAX}
          onChange={(v) => s1.set({ down: v })}
          display={`${s1.state.down} down · ${SWITCH_PORTS - s1.state.down} up`}
        />
        <Eq label="Oversubscription equals a leaf's ports to GPUs divided by its ports to spines">
          <K tone="blue">oversubscription</K>
          <Op>=</Op>
          <Frac top="ports to GPUs" bottom="ports to spines" />
          <Op>=</Op>
          <Frac top={String(f.downPorts)} bottom={String(f.upPorts)} />
          <Op>=</Op>
          <K tone="blue">{ratio(f)}</K>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with 1,024 GPUs and half of every leaf facing them. That takes {N.f32.leaves} leaves — one for each of Lesson 4.1’s racks of 32 GPUs — and{' '}
        {N.f32.spines} spines: {N.f32.switches} switches, {fmt(N.f32.optics)} optical transceivers (a simulated {usd(OPTIC_PRICE)} each) for the links between the tiers,
        which need one at each end, and a cable for every GPU. At our simulated prices that is {millions(N.f32.costTotal)}, or {usd(N.f32.costPerGpu)} per GPU: about {pct(N.serverShare)} of what each
        GPU’s share of its server costs. The fabric’s bisection bandwidth is {fmt(N.f32.bisectionTbps, 1)} terabits per second: half the GPUs sending to the other half, each
        at its full {NIC_GBPS} Gb/s. Push the GPUs to {fmt(N.f2048.gpus)} and the non-blocking fabric takes {N.f2048.leaves} leaves and {N.f2048.spines} spines, every port of every spine in
        use: as large as two tiers of these switches get.
      </P>
      <P>
        Now give the GPUs more of each leaf. With 48 ports down and 16 up, the same 1,024 GPUs need only {N.f48.leaves} leaves and {N.f48.spines} spines, and the
        network costs {usd(N.f48.costPerGpu)} per GPU, {pct(N.cheaper48)} less: fewer switches, and about a third as many of the costly links between the tiers. The catch
        is in the ratio. Forty-eight GPUs now share 16 links up, an oversubscription of 3 : 1, so when they all send across the fabric at once,
        each gets a third of its card: {fmt(NIC_GBPS / 3)} Gb/s. The bisection bandwidth falls to {fmt(N.f48.bisectionTbps, 1)} Tb/s.
      </P>

      <H2>When the ratio matters</H2>
      <P>
        The ratio in <FigRef to="Data Center Network Simulator">the first demonstration</FigRef> only costs anything when many GPUs send across the spines at the
        same moment. Traffic between two GPUs under one leaf never reaches a spine,
        and traffic inside a server never touches the network at all. The fine-tuning job of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a> needs{' '}
        {fmt(N.tuneGpus)} A-class GPUs; placed together under one leaf, it gets its full {NIC_GBPS} Gb/s even on the 3 : 1 fabric. The traffic that does cross is the
        all-reduce of a large training run, every GPU sending at once, every step.
      </P>
      <P>
        Take the 70B run of <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> split the faster way, eight GPUs per layer and a single stage, on 1,024 A-class GPUs:{' '}
        {days(N.base.days)} on a non-blocking network. It runs on a {fmt(CLUSTER_GPUS)}-GPU cluster shared with other customers’ jobs. After every step, each GPU must
        sum {fmt(GRAD_BYTES / 1e9, 1)} GB of gradients with its counterparts in the other {fmt(DP - 1)} copies of the model, across the network. But it needn’t wait
        for the step to end to start: gradients for the last layers are ready while the backward pass is still working on the first, so the exchange runs alongside
        it, and only what sticks out past the backward pass delays the step. In the next demonstration, set the fabric, and choose whether the run’s GPUs fill leaves
        of their own or are scattered among other tenants’ GPUs, sharing their leaves’ links up with traffic of their own:
      </P>

      <Figure name="Data Center Network Simulator · training" scenario={s2}>
        <StepTimeline r={r} exchange={ex} ariaLabel={aria2} />
        <Legend
          items={[
            { label: 'arithmetic', color: ARITH },
            { label: 'exchange hidden behind it', color: NET_LIGHT },
            { label: 'waiting on the network', color: WAIT },
          ]}
        />
        <CostChart points={points} current={current} revealed={revealed} ariaLabel={aria3} />
        <Readouts
          items={[
            { label: 'network cost per GPU', value: usd(cf.costPerGpu), tone: 'green' },
            { label: 'days to train', value: `${days(r.days)}${longer > 0.0005 ? ` (+${pct(longer, 1)})` : ''}`, tone: 'teal' },
          ]}
        />
        <Slider
          label="Leaf ports facing GPUs"
          tone="blue"
          value={st.down}
          min={DOWN_MIN}
          max={RUN_DOWN_MAX}
          onChange={(v) => s2.set({ down: v })}
          display={`${st.down} down · ${ratio(cf)}`}
        />
        <Segmented
          label="Placement"
          value={st.placement}
          onChange={(v) => s2.set({ placement: v })}
          options={[
            { value: 'packed', label: 'Packed onto leaves of its own' },
            { value: 'scattered', label: 'Scattered among other tenants' },
          ]}
        />
        <Slider
          label="Other tenants’ traffic"
          value={st.others}
          min={0}
          max={80}
          step={5}
          disabled={st.placement === 'packed'}
          onChange={(v) => s2.set({ others: v })}
          display={st.placement === 'packed' ? 'not shared' : `${st.others}% of the links up`}
        />
        <Caption>{caption2}</Caption>
      </Figure>

      <P>
        On the non-blocking fabric the exchange takes {secs(N.exchange1)}, and the backward pass can hide {secs(HIDE_WINDOW)} of exchange behind it, so the network
        costs the run nothing. That stays true as the ports shift toward the GPUs, right up to the point where the run’s share of each card falls below{' '}
        {pct(HIDE_SHARE)}. Past it, the extra seconds land directly on every step. At 3 : 1 the exchange takes {secs(N.exchange48)}, and the run stretches to{' '}
        {days(N.run48.days)}: {pct(N.run48.days / N.base.days - 1)} longer, on a network that cost {usd(N.saving48)} less per GPU across this {fmt(CLUSTER_GPUS)}-GPU
        cluster. (On the {fmt(N.f32.gpus)} GPUs of the first demonstration, the same 3 : 1 saved {usd(N.saving48Small)}; switches come in whole numbers, so the saving
        shifts a little with the cluster’s size.)
      </P>
      <P>
        Placement matters as much as the hardware. Scatter the run among other tenants whose traffic fills half of the links up, and even the non-blocking fabric
        leaves it only half of each card. That still hides, just, at {days(N.scat32.days)}. But on a fabric with 40 ports down, where the run packed onto its own
        leaves would still finish in {days(N.pack40.days)}, scattered it takes {days(N.scat40.days)}. Keeping large jobs together on leaves of their own is the job of
        the cluster’s scheduler, and a good one is worth a lot of hardware.
      </P>

      <Challenge
        id="a"
        question={`Find the cheapest fabric — the lowest network cost per GPU — that keeps the 70B run within 5% of its time on a non-blocking network. Predict first: packed onto leaves of its own, the run gets a leaf’s ports up divided by its ports down. At how many ports facing GPUs does that last stay above ${pct(HIDE_SHARE)}? Then check whether a cheaper fabric still keeps the run within 5%.`}
        solved={solved}
        status={status}
        success={`Solved. Up to ${CHEAPEST.down - 1} ports down, the run gets ${pct(runShare({ down: CHEAPEST.down - 1, placement: 'packed', others: 0 }))} of each card or more and its exchange hides completely. With ${CHEAPEST.down} (${ratio(clusterFabric(CHEAPEST.down))}), it gets ${pct(CHEAPEST.share)}; its exchange sticks out of each step only slightly, and it takes ${days(CHEAPEST.days)}, ${pct(CHEAPEST.days / BASE.days - 1, 1)} longer, on a network costing ${usd(CHEAPEST.cost)} per GPU — ${usd(C32.costPerGpu - CHEAPEST.cost)} less than non-blocking. One more port facing GPUs and the run takes ${days(nextDays)}, past the limit.`}
      />

      <H2>Two networks for two kinds of work</H2>
      <P>
        Is a cheaper network worth it? The 3 : 1 fabric saves {usd(N.saving48)} per GPU, about {pct(N.saving48 / SERVER_PER_GPU)} of what the GPU’s share of its server
        costs, and makes this run {pct(N.run48.days / N.base.days - 1)} longer: another {fmt(Math.round(N.extraGpuHours / 100) * 100)} GPU-hours of the cluster’s
        time for every run like it. For a cluster built to train, that is a poor trade: the GPUs are the expensive part,
        and the network decides how much of their time turns into progress. That is why GPU clouds build their training clusters on non-blocking fabrics, and some go
        further, wiring the network so that the same-numbered GPU in every server shares a leaf, since in the two-level all-reduce of Lesson 2.5 those are the GPUs
        that talk across servers.
      </P>
      <P>
        Inference is a different customer. Each copy of a model in <a href={lessonHref('compute/3.2')}>Lesson 3.2</a> lives inside one server, on its GPU links, and
        sends little across the network but requests and replies. An inference fleet can sit on an oversubscribed fabric, or an ordinary data-center network, and
        for the most part hardly notice. So the same A-class GPU is worth more to a training customer in a non-blocking cluster than in a cheaper one, and the two are, in effect,
        different products — one more reason that compute is sold in many varieties rather than one.
      </P>
      <P>
        We now have every physical piece: servers and racks, the power to run them, the cooling to keep them alive, and the network that joins them. Each costs money,
        mostly up front, and each GPU-hour has to pay its share. The next lesson adds it all up and asks what a GPU-hour costs to produce.
      </P>
    </LessonPage>
  );
}
