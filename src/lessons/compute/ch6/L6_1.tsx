import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Legend,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import {
  PHYSICS_DEFAULTS,
  YIELD_FLEET,
  YIELD_WORKLOADS,
  busyCost,
  productivityUnder,
  yieldRun,
  type Physics,
  type Policy,
  type YieldResult,
} from '../../../engines/compute/yieldManager';
import { gpuHourCost } from '../../../engines/compute/facilityCost';
import { annualPue } from '../../../engines/compute/cooling';
import { memoryPlan } from '../../../engines/compute/inference';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { WORKLOADS, type WorkloadId } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The state the reader controls: the allocation policy, protected B-class GPUs, and the physical
// drivers behind each GPU's productivity (the frontier model's precision, the chat assistant's time
// per token) and running cost (the price of electricity).

export interface YieldState {
  policy: Policy;
  /** B-class GPUs only interactive work may use. */
  protect: number;
  precision: 'fp8' | 'bf16';
  /** The chat assistant's limit on time per output token, ms. */
  chatMs: number;
  /** Electricity, $/MWh. */
  power: number;
}

export const YIELD_DEFAULTS: YieldState = { policy: 'first-come', protect: 0, precision: 'fp8', chatMs: 40, power: 55 };
export const PROTECT_STEP = 25;
export const CHAT_MIN = 20;
export const CHAT_MAX = 60;
const HOURS = 168;

export function physicsOf(s: Pick<YieldState, 'precision' | 'chatMs'>): Physics {
  return { frontierPrecision: s.precision, chatTpotMax: s.chatMs / 1000 };
}

const cache = new Map<string, YieldResult>();
/** A simulated week of the Tech Park fleet under a state (memoized). */
export function runYield(s: YieldState): YieldResult {
  const key = `${s.policy}|${s.protect}|${s.precision}|${s.chatMs}|${s.power}`;
  let r = cache.get(key);
  if (!r) {
    r = yieldRun({ fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, policy: s.policy, protectB: s.protect, physics: physicsOf(s), powerPrice: s.power, hours: HOURS });
    if (cache.size > 600) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/** Revenue each workload brought in over the week, $. */
export function revenueByWorkload(s: YieldState): Record<WorkloadId, number> {
  const r = runYield(s);
  const prod = productivityUnder(physicsOf(s));
  const out = {} as Record<WorkloadId, number>;
  for (const w of YIELD_WORKLOADS) out[w.id] = GPU_IDS.reduce((t, g) => t + r.gpuHours[w.id][g] * prod[w.id][g] * w.value, 0);
  return out;
}

/** True when the physics and the power price are the reference ones. */
export function referencePhysics(s: YieldState): boolean {
  return s.precision === YIELD_DEFAULTS.precision && s.chatMs === YIELD_DEFAULTS.chatMs && s.power === YIELD_DEFAULTS.power;
}

let best: { margin: number; policy: Policy; protect: number } | null = null;
/** The most margin any policy and protection level (on the slider's grid) earns under the reference physics. */
export function bestMargin() {
  if (!best) {
    best = { margin: -Infinity, policy: 'first-come', protect: 0 };
    for (const policy of ['first-come', 'best-value'] as Policy[])
      for (let protect = 0; protect <= YIELD_FLEET.B; protect += PROTECT_STEP) {
        const m = runYield({ ...YIELD_DEFAULTS, policy, protect }).margin;
        if (m > best.margin) best = { margin: m, policy, protect };
      }
  }
  return best;
}

/** Challenge a: the most margin under the reference physics (within $5 of the best on the grid). */
export function bestSolved(s: YieldState): boolean {
  return referencePhysics(s) && runYield(s).margin >= bestMargin().margin - 5;
}

/** Whether the L-class can serve the chat assistant at all under a time-per-token limit (ms). */
export function lServesChat(chatMs: number): boolean {
  return productivityUnder(physicsOf({ precision: 'fp8', chatMs })).chat70.L > 0;
}

/** The tightest whole-millisecond chat limit at which the L-class can still serve chat. */
export function chatThresholdMs(): number {
  for (let ms = CHAT_MIN; ms <= CHAT_MAX; ms++) if (lServesChat(ms)) return ms;
  return Infinity;
}

/** Challenge b: the chat limit set exactly to that threshold. */
export function thresholdSolved(s: Pick<YieldState, 'chatMs'>): boolean {
  return s.chatMs === chatThresholdMs();
}

/** What each workload would earn from one hour of a GPU, net of the GPU's running cost, $ (null if it can't run there). */
export function bidOf(id: WorkloadId, g: GpuId, physics: Physics, power: number): number | null {
  const prod = productivityUnder(physics)[id][g];
  if (prod <= 0) return null;
  const w = YIELD_WORKLOADS.find((x) => x.id === id)!;
  return w.value * prod - busyCost(g, power);
}

/** The fleet's fixed costs (capital and upkeep, not electricity) per week, $, from Lesson 4.5's costs at Tech Park. */
export function fleetFixedPerWeek(): number {
  const tp = SITES.techpark;
  let year = 0;
  for (const g of GPU_IDS) {
    const cooling = g === 'B' ? 'liquid' : 'air';
    const pue = annualPue(tp, { cooling, supplyC: cooling === 'air' ? 24 : 35 }).pue;
    const c = gpuHourCost({ gpu: g, cooling, site: tp, pue, utilization: 0.85, serverLifeYears: 5, facilityLifeYears: 15, rate: 0.1 });
    year += (c.serverYear + c.networkYear + c.facilityYear + c.upkeepYear) * YIELD_FLEET[g];
  }
  return (year * HOURS) / 8760;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the engines.

const FC = runYield(YIELD_DEFAULTS);
const BV = runYield({ ...YIELD_DEFAULTS, policy: 'best-value' });
const FC300 = runYield({ ...YIELD_DEFAULTS, protect: YIELD_FLEET.B });
const BF16_BV = runYield({ ...YIELD_DEFAULTS, policy: 'best-value', precision: 'bf16' });
const BF16_FC = runYield({ ...YIELD_DEFAULTS, precision: 'bf16' });
const CHAT20_BV = runYield({ ...YIELD_DEFAULTS, policy: 'best-value', chatMs: 20 });
const POWER400_BV = runYield({ ...YIELD_DEFAULTS, policy: 'best-value', power: 400 });
const THRESHOLD = chatThresholdMs();
const FC_AT = runYield({ ...YIELD_DEFAULTS, chatMs: THRESHOLD });
const FC_BEFORE = runYield({ ...YIELD_DEFAULTS, chatMs: THRESHOLD - 1 });
const PROD = productivityUnder(PHYSICS_DEFAULTS);
const PROD_BF16 = productivityUnder(physicsOf({ precision: 'bf16', chatMs: 40 }));
const PROD_AT = productivityUnder(physicsOf({ precision: 'fp8', chatMs: THRESHOLD }));
const MEM_400_A = memoryPlan({ model: '400B', gpu: 'A', tp: 8, precision: 'bf16' });
const bid = (id: WorkloadId, g: GpuId) => bidOf(id, g, PHYSICS_DEFAULTS, YIELD_DEFAULTS.power) ?? 0;

export const LESSON_NUMBERS = {
  fleet: YIELD_FLEET,
  fixedPerWeek: fleetFixedPerWeek(),
  fcMargin: FC.margin,
  fcRevenue: FC.revenue,
  fcPower: FC.powerCost,
  fcUtil: FC.utilization,
  fcServed: FC.served,
  fcBatchOnB: FC.gpuHours.batch8.B,
  bvMargin: BV.margin,
  bvGain: BV.margin - FC.margin,
  bvGainShare: (BV.margin - FC.margin) / FC.margin,
  bvUtil: BV.utilization,
  bvServed: BV.served,
  bvCodeOnB: BV.gpuHours.code8.B / (BV.gpuHours.code8.A + BV.gpuHours.code8.B + BV.gpuHours.code8.L),
  bvFrontierOnB: BV.gpuHours.frontier400.B / (BV.gpuHours.frontier400.A + BV.gpuHours.frontier400.B + BV.gpuHours.frontier400.L),
  bvBatchOnB: BV.gpuHours.batch8.B,
  fc300Margin: FC300.margin,
  fc300Recovered: FC300.margin - FC.margin,
  fc300RecoveredShare: (FC300.margin - FC.margin) / (BV.margin - FC.margin),
  fc300BatchOnA: FC300.gpuHours.batch8.A,
  fc300Served: FC300.served,
  prodFrontierB: PROD.frontier400.B,
  prodTuneB: PROD.tune8.B,
  prodTrainL: PROD.train70.L,
  prodChatB: PROD.chat70.B,
  bidsB: { frontier: bid('frontier400', 'B'), code: bid('code8', 'B'), chat: bid('chat70', 'B'), train: bid('train70', 'B'), tune: bid('tune8', 'B'), batch: bid('batch8', 'B') },
  bidsA: { code: bid('code8', 'A'), frontier: bid('frontier400', 'A'), chat: bid('chat70', 'A'), train: bid('train70', 'A'), tune: bid('tune8', 'A'), batch: bid('batch8', 'A') },
  bidsL: { tune: bid('tune8', 'L'), code: bid('code8', 'L'), train: bid('train70', 'L'), batch: bid('batch8', 'L'), chat: bid('chat70', 'L') },
  bf16WeightsGB: MEM_400_A.weightBytes / 1e9,
  bf16UsableAGB: MEM_400_A.usableBytes / 1e9,
  prodFrontierBBf16: PROD_BF16.frontier400.B,
  bf16BvMargin: BF16_BV.margin,
  bf16Loss: BV.margin - BF16_BV.margin,
  bf16FrontierServed: BF16_BV.served.frontier400,
  bf16Gain: BF16_BV.margin - BF16_FC.margin,
  chat20BvMargin: CHAT20_BV.margin,
  threshold: THRESHOLD,
  prodChatLAt: PROD_AT.chat70.L,
  fcAtThreshold: FC_AT.margin,
  fcBeforeThreshold: FC_BEFORE.margin,
  power400Margin: POWER400_BV.margin,
  power400Cost: POWER400_BV.powerCost,
  bvPower: BV.powerCost,
};
const N = LESSON_NUMBERS;

// ---------------------------------------------------------------------------
// Display.

const NAME: Record<WorkloadId, string> = { code8: 'Code completion', frontier400: 'Frontier', chat70: 'Chat', train70: 'Training', tune8: 'Fine-tuning', batch8: 'Batch' };
/** Workload colors for the fleet bars (always labeled). */
const WCOLOR: Record<WorkloadId, string> = { code8: '#b88dc2', frontier400: '#e8645e', chat70: '#eb9b66', train70: '#8d7b6a', tune8: '#c9b07a', batch8: '#6cc0b8' };
const IDLE = '#ececea';
const GPU_SHORT: Record<GpuId, string> = { L: 'L-class', A: 'A-class', B: 'B-class' };
const ORDER: GpuId[] = ['B', 'A', 'L'];
const m2 = (x: number) => usd(x, 2);
const k = (x: number) => usd(Math.round(x / 1000) * 1000);

/** One bar per GPU type: its week of GPU-hours, divided by the workloads that used them. */
function FleetBars({ r }: { r: YieldResult }) {
  const x0 = 132;
  const x1 = 560;
  const label = ORDER.map((g) => {
    const parts = YIELD_WORKLOADS.filter((w) => r.gpuHours[w.id][g] > 0.5).map((w) => `${NAME[w.id]} ${pct(r.gpuHours[w.id][g] / (YIELD_FLEET[g] * HOURS))}`);
    return `${GPU_SHORT[g]}, ${fmt(YIELD_FLEET[g])} GPUs, ${pct(r.utilization[g])} busy: ${parts.join(', ') || 'nothing'}`;
  }).join('. ');
  return (
    <svg className="chart" viewBox="0 0 640 196" role="img" aria-label={`Who used each kind of GPU over the week. ${label}.`}>
      <text className="ax" x={x0} y={14}>
        Each GPU type’s hours this week, by the workload that used them
      </text>
      {ORDER.map((g, i) => {
        const y = 34 + i * 54;
        const total = YIELD_FLEET[g] * HOURS;
        let at = x0;
        return (
          <g key={g}>
            <rect x={0} y={y + 4} width={6} height={26} rx={1.5} fill={GPU_COLOR[g]} />
            <text x={12} y={y + 15} style={{ fontSize: 13, fontWeight: 500, fill: '#222' }}>
              {GPU_SHORT[g]}
            </text>
            <text x={12} y={y + 31} className="ax">
              {fmt(YIELD_FLEET[g])} GPUs
            </text>
            <rect x={x0} y={y} width={x1 - x0} height={34} fill={IDLE} />
            {YIELD_WORKLOADS.map((w) => {
              const share = r.gpuHours[w.id][g] / total;
              const wpx = share * (x1 - x0);
              const seg = (
                <g key={w.id}>
                  <rect x={at} y={y} width={Math.max(0, wpx)} height={34} fill={WCOLOR[w.id]} stroke="#fcfcfb" strokeWidth={wpx > 2 ? 1 : 0} />
                  {wpx > 58 && (
                    <text x={at + wpx / 2} y={y + 21} textAnchor="middle" style={{ fontSize: 11, fill: '#222' }}>
                      {NAME[w.id]}
                    </text>
                  )}
                </g>
              );
              at += wpx;
              return seg;
            })}
            <text x={x1 + 8} y={y + 15} style={{ fontSize: 13, fontWeight: 500, fill: '#222' }}>
              {pct(r.utilization[g])}
            </text>
            <text x={x1 + 8} y={y + 31} className="ax">
              busy
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Every workload's bid for one hour of a GPU type, sorted, under the current physics. */
function BidChart({ g, physics, power }: { g: GpuId; physics: Physics; power: number }) {
  const prod = productivityUnder(physics);
  const rows = YIELD_WORKLOADS.map((w) => ({ id: w.id, bid: bidOf(w.id, g, physics, power), prod: prod[w.id][g] })).sort((a, b) => (b.bid ?? -1) - (a.bid ?? -1));
  const top = g === 'B' ? 16 : g === 'A' ? 6 : 1.2;
  const x = scale(0, top, 214, 600);
  const ticks = g === 'B' ? [0, 4, 8, 12, 16] : g === 'A' ? [0, 2, 4, 6] : [0, 0.4, 0.8, 1.2];
  const label = rows.map((r) => `${NAME[r.id]} ${r.bid === null ? 'can’t run it' : m2(r.bid)}`).join(', ');
  return (
    <svg className="chart" viewBox="0 0 640 262" role="img" aria-label={`What an hour of a ${GPU_SHORT[g]} GPU earns from each workload, after its running cost: ${label}.`}>
      <text className="ax" x={214} y={14}>
        What one {GPU_SHORT[g]} GPU-hour earns from each workload, after electricity
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={24} y2={238} />
          <text className="ax ax-m" x={x(t)} y={254}>
            {usd(t, g === 'L' && t > 0 ? 1 : 0)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 30 + i * 35;
        const w = r.bid === null ? 0 : Math.max(0, Math.min(top, r.bid));
        return (
          <g key={r.id}>
            <rect x={0} y={y + 3} width={6} height={22} rx={1.5} fill={WCOLOR[r.id]} />
            <text x={12} y={y + 13} style={{ fontSize: 13, fill: '#222' }}>
              {NAME[r.id]}
            </text>
            <text x={12} y={y + 28} className="ax">
              {r.bid === null ? 'can’t run here' : `${fmt(r.prod, r.prod < 0.1 ? 3 : 2)}× an A-class GPU`}
            </text>
            {w > 0 && <rect x={x(0)} y={y + 4} width={x(w) - x(0)} height={20} fill={i === 0 ? GRAPHIC.green : '#cfd9c3'} />}
            <text x={r.bid === null ? x(0) + 6 : Math.min(x(w) + 6, 596)} y={y + 18} textAnchor={r.bid !== null && x(w) + 6 > 560 ? 'end' : 'start'} style={{ fontSize: 12, fill: r.bid === null ? '#888' : '#333' }}>
              {r.bid === null ? '—' : m2(r.bid)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('fleet', YIELD_DEFAULTS);
  const st = s1.state;
  const r = runYield(st);
  const revW = revenueByWorkload(st);
  const physics = physicsOf(st);
  const wanted = (id: WorkloadId) => r.served[id];

  const s2 = useScenario('bids', { gpu: 'B' as GpuId });
  const g2 = s2.state.gpu;
  const bids2 = YIELD_WORKLOADS.map((w) => ({ id: w.id, bid: bidOf(w.id, g2, physics, st.power) })).filter((x) => x.bid !== null) as Array<{ id: WorkloadId; bid: number }>;
  const bestBid = bids2.reduce((a, b) => (b.bid > a.bid ? b : a), bids2[0]);
  const batchBid = bidOf('batch8', g2, physics, st.power);

  const bestM = bestMargin();
  const aStatus = !referencePhysics(st)
    ? `Put the physics back first: the frontier model in FP8, chat at ${YIELD_DEFAULTS.chatMs} ms a token, electricity at $${YIELD_DEFAULTS.power} per MWh.`
    : `This week’s contribution margin is ${usd(r.margin)}, ${usd(bestM.margin - r.margin)} short of the most this fleet can earn.`;
  const bStatus = lServesChat(st.chatMs)
    ? `At ${st.chatMs} ms a token, the L-class can still serve the chat assistant. Could the limit be tighter?`
    : `At ${st.chatMs} ms a token, the L-class can’t serve the chat assistant at all.`;

  const caption =
    st.policy === 'first-come'
      ? `First come, first served: the frontier assistant gets ${pct(wanted('frontier400'))} of the work it wants, batch summarization ${pct(wanted('batch8'))}, and batch holds ${fmt(r.gpuHours.batch8.B)} B-class GPU-hours.`
      : `Best value: the frontier assistant gets ${pct(wanted('frontier400'))} of the work it wants, chat ${pct(wanted('chat70'))}, batch summarization ${pct(wanted('batch8'))}.`;

  return (
    <LessonPage id="compute/6.1">
      <P>
        The previous lesson found that one kind of GPU can sell for very different prices depending on who can reach it and what work it does, and ended on the
        opportunity in those differences. This chapter turns them into strategies, beginning with the provider’s. Every hour, a GPU cloud decides who gets which of its
        GPUs. An hour nobody uses is gone for good, like an empty seat on a flight that has left, and the hardware costs almost as much idle as busy (
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). Airlines and hotels, which also sell capacity that perishes, call the craft of deciding who gets it{' '}
        <b>yield management</b>, or revenue management.
      </P>
      <P>
        Take a fleet at Tech Park: {fmt(N.fleet.L)} L-class 48 GB, {fmt(N.fleet.A)} A-class 80 GB and {fmt(N.fleet.B)} B-class 192 GB GPUs. Its customers are the six
        workloads of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>, each paying a different <K c="price">value</K> for an A-class-equivalent hour of its work — the
        work one A-class GPU does for it: code completion {m2(5)}, the frontier assistant {m2(4.5)}, the chat assistant {m2(3.5)}, the pretraining run {m2(2.6)},
        fine-tuning {m2(2.4)} and batch summarization {m2(1.4)}, all simulated. Interactive demand rises and falls with the day, peaking in the afternoon (
        <a href={lessonHref('compute/5.3')}>Lesson 5.3</a>); training and batch work are steady. And each kind of GPU does a different amount of each workload’s work,
        from the throughputs of Chapter 3: a B-class GPU does {fmt(N.prodFrontierB, 2)} A-class hours of the frontier assistant’s work but {fmt(N.prodTuneB, 2)} of
        fine-tuning, and an L-class card {fmt(N.prodTrainL, 2)} of an hour of training and none at all of the frontier model’s.
      </P>
      <P>
        What the provider maximizes is the <K c="price">contribution margin</K>: revenue minus the electricity its busy GPUs draw. The capital is already spent — this
        fleet’s servers, network and building cost about {k(N.fixedPerWeek)} a week whether they are busy or not — and the margin is what pays for them. In the next
        demonstration, each bar is one kind of GPU over a simulated week, divided by the workloads that used its hours; gray is idle. Two policies decide who gets what.
        First come, first served lets the workloads ask in a random order each hour, each taking the most productive GPUs still free. Best value hands out each hour’s GPUs
        in order of what they earn: the pair of workload and GPU that earns most per GPU-hour goes first. Choose a policy; the other controls come up later in the lesson:
      </P>

      <Figure name="Compute Yield Manager" scenario={s1}>
        <Segmented
          label="Allocation policy"
          value={st.policy}
          onChange={(policy) => s1.set({ policy })}
          options={[
            { value: 'first-come', label: 'First come, first served' },
            { value: 'best-value', label: 'Best value first' },
          ]}
        />
        <FleetBars r={r} />
        <Legend items={[...YIELD_WORKLOADS.map((w) => ({ label: NAME[w.id], color: WCOLOR[w.id] })), { label: 'Idle', color: IDLE }]} />
        <Slider label="B-class held for interactive work" value={st.protect} min={0} max={YIELD_FLEET.B} step={PROTECT_STEP} onChange={(protect) => s1.set({ protect })} display={`${fmt(st.protect)} GPUs`} />
        <Segmented
          label="Frontier model precision"
          value={st.precision}
          onChange={(precision) => s1.set({ precision })}
          options={[
            { value: 'fp8', label: '400B model in FP8' },
            { value: 'bf16', label: '400B model in BF16' },
          ]}
        />
        <Slider label="Chat: time per token" tone="teal" value={st.chatMs} min={CHAT_MIN} max={CHAT_MAX} onChange={(chatMs) => s1.set({ chatMs })} display={`at most ${st.chatMs} ms`} />
        <Slider label="Electricity price" tone="green" value={st.power} min={20} max={400} step={5} onChange={(power) => s1.set({ power })} display={`$${st.power} per MWh`} />
        <Readouts
          items={[
            { label: 'revenue this week', value: usd(r.revenue), tone: 'green' },
            { label: 'electricity', value: usd(r.powerCost), tone: 'red' },
            { label: 'contribution margin', value: usd(r.margin), tone: 'green' },
            { label: 'left after the fleet’s capital', value: usd(r.margin - N.fixedPerWeek), tone: 'green' },
          ]}
        />
        <DataTable
          caption="Each workload: what it pays per A-class-equivalent hour, how much of its work the fleet did, and the revenue it brought in this week"
          rows={YIELD_WORKLOADS}
          rowKey={(w) => w.id}
          columns={[
            { label: 'Workload', cell: (w) => WORKLOADS[w.id].name },
            { label: 'Pays', cell: (w) => m2(w.value), align: 'right' },
            { label: 'Work done', cell: (w) => pct(r.served[w.id]), align: 'right' },
            { label: 'Revenue', cell: (w) => usd(revW[w.id]), align: 'right' },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        First come, first served earns a margin of {usd(N.fcMargin)} for the week. The B-class GPUs are all busy, but not with the right work: batch summarization, the
        lowest payer, holds {fmt(N.fcBatchOnB)} B-class GPU-hours while the frontier assistant, which only the A- and B-class can run, goes without{' '}
        {pct(1 - N.fcServed.frontier400)} of what it wants. Switch to best value and the margin rises to {usd(N.bvMargin)}: {usd(N.bvGain)} more, or{' '}
        {pct(N.bvGainShare, 1)}, every week. Code completion and the frontier assistant now run entirely on the B-class, every interactive workload is served in full, and
        batch summarization gets {pct(N.bvServed.batch8)} of its work done on A- and L-class GPUs, most of it at night, when interactive demand falls away. Look at the
        utilizations: they barely move ({pct(N.fcUtil.A)} of the A-class busy before, {pct(N.bvUtil.A)} after). The gain comes from who uses the GPUs, not from how many are
        busy.
      </P>

      <Challenge
        id="a"
        question="With the frontier model in FP8, chat at 40 ms a token and electricity at $55 per MWh, earn the most contribution margin you can this week."
        solved={bestSolved(st)}
        status={aStatus}
        success={`Solved: ${usd(bestM.margin)} a week. Ranking each hour’s GPUs by what they earn puts the scarce B-class where it does the most — the frontier model and code completion — and lets batch work wait for the night. Holding back a few B-class GPUs makes no difference once the ranking does the job.`}
      />

      <H2>Protecting the scarce GPUs</H2>
      <P>
        A real scheduler can’t always rank every request against every other as it arrives. A common substitute is a <b>protection level</b>: capacity set aside for the
        customers who pay most, the way an airline keeps seats back for travelers who book late at high fares. Return the first demonstration to first come, first served
        and hold B-class GPUs back for interactive work. Protecting all {fmt(N.fleet.B)} of them lifts the margin to {usd(N.fc300Margin)}, which recovers only{' '}
        {usd(N.fc300Recovered)} of the {usd(N.bvGain)} gap, {pct(N.fc300RecoveredShare)}.
      </P>
      <P>
        The rest of the loss isn’t on the B-class at all. When batch work happens to ask first in an afternoon hour, it takes A-class GPUs that chat and the frontier
        assistant need at their peak: even with every B-class GPU protected, batch summarization runs {fmt(N.fc300BatchOnA)} A-class GPU-hours over the week while the
        frontier assistant still misses {pct(1 - N.fc300Served.frontier400)} of its work. What the best-value policy really does is make batch work wait. Batch can wait —
        that is what made it the flexible demand that fills a fleet’s valleys in Lesson 5.3, and the natural buyer of interruptible capacity in{' '}
        <a href={lessonHref('compute/5.4')}>Lesson 5.4</a>.
      </P>

      <H2>What each GPU-hour can earn</H2>
      <P>
        Best value works because every pair of workload and GPU has a price it would pay for an hour: the workload’s value times the work that GPU does for it, minus the
        GPU’s running cost. In the next demonstration, choose a kind of GPU to see what each workload would pay for one hour of it, under the physics set in{' '}
        <FigRef to="Compute Yield Manager">the first demonstration</FigRef>:
      </P>

      <Figure name="Compute Yield Manager · value per GPU-hour" scenario={s2}>
        <Segmented label="Accelerator" value={g2} onChange={(gpu) => s2.set({ gpu })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <BidChart g={g2} physics={physics} power={st.power} />
        <Readouts
          items={[
            { label: 'best use', value: bestBid ? `${NAME[bestBid.id]}, ${m2(bestBid.bid)}` : '—', tone: 'green' },
            { label: 'batch summarization', value: batchBid === null ? 'can’t run' : m2(batchBid), tone: 'green' },
            { label: 'given to batch, an hour forgoes', value: batchBid === null || !bestBid ? '—' : m2(bestBid.bid - batchBid), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        A B-class hour earns {m2(N.bidsB.frontier)} from the frontier assistant, {m2(N.bidsB.code)} from code completion and {m2(N.bidsB.chat)} from chat, but only{' '}
        {m2(N.bidsB.batch)} from batch summarization: giving it to batch forgoes {m2(N.bidsB.frontier - N.bidsB.batch)} an hour. That forgone earning is the hour’s{' '}
        <b>opportunity cost</b>, and it is what first come, first served ignores. An A-class hour ranges from {m2(N.bidsA.code)} for code completion down to{' '}
        {m2(N.bidsA.batch)} for batch, and an L-class hour earns most from fine-tuning, {m2(N.bidsL.tune)}, and almost nothing from chat, {m2(N.bidsL.chat)}.
      </P>
      <P>
        The pattern is Lesson 3.5’s comparative advantage, now priced. The B-class’s edge is largest on the frontier model, where it does {fmt(N.prodFrontierB, 2)} A-class
        hours of work: the 400B model fits on four B-class GPUs instead of a full server of eight A-class GPUs, and spends far less of each token exchanging results
        between them. Its edge is smallest on fine-tuning, {fmt(N.prodTuneB, 2)}. Each of those numbers comes from memory, bandwidth and links, so each can move.
      </P>

      <H2>When the physics changes</H2>
      <P>
        The strategy’s margin rests on physical facts, and the first demonstration lets you change three of them. Serve the frontier model in BF16 instead of FP8, for
        quality. Its weights become {fmt(N.bf16WeightsGB)} GB, more than the {fmt(N.bf16UsableAGB)} GB eight A-class GPUs can hold (
        <a href={lessonHref('compute/3.2')}>Lesson 3.2</a>), so the A-class drops out of the frontier market altogether, and the B-class, now needing eight GPUs per copy,
        does only {fmt(N.prodFrontierBBf16, 2)} A-class hours of the work. Even ranked by value, the fleet earns {usd(N.bf16BvMargin)}, {usd(N.bf16Loss)} less a week, and
        the frontier assistant gets {pct(N.bf16FrontierServed)} of what it wants. Best value still beats first come, first served, but by {usd(N.bf16Gain)} instead of{' '}
        {usd(N.bvGain)}: with only one kind of GPU able to do the most valuable work, there is less to allocate.
      </P>
      <P>
        Tighten the chat assistant’s time per token and each GPU must run smaller batches to keep the promise (Lesson 3.2), so it writes fewer tokens: at 20 ms the
        best-value margin falls to {usd(N.chat20BvMargin)}. Raise the price of electricity to $400 per megawatt-hour, several times what Tech Park usually pays, and the
        week’s power bill grows from {usd(N.bvPower)} to {usd(N.power400Cost)}, taking the margin to {usd(N.power400Margin)}: a real cost, but a small one beside the
        capital, which is why <a href={lessonHref('compute/6.4')}>Lesson 6.4</a> finds less to gain from chasing cheap power than one might expect.
      </P>

      <Challenge
        id="b"
        figure="Compute Yield Manager"
        question="Find the tightest limit on the chat assistant’s time per token, to the millisecond, at which the L-class can still serve chat at all."
        solved={thresholdSolved(st)}
        status={bStatus}
        success={`Solved: ${N.threshold} ms. On eight L-class cards, reading the 70B model’s weights through their graphics memory and exchanging results over PCIe takes a little over ${N.threshold - 1} ms per token for a single request, so any tighter promise shuts the L-class out of the chat market. At ${N.threshold} ms it does only ${fmt(N.prodChatLAt, 3)} A-class hours of chat work — and under first come, first served, letting it do so lowers the week’s margin from ${usd(N.fcBeforeThreshold)} to ${usd(N.fcAtThreshold)}, because L-class cards that could have been fine-tuning are spent on chat. A customer willing to pay isn’t always a good use of a GPU.`}
      />

      <P>
        So the provider’s strategy has a physical explanation at every step. The B-class earns most on the frontier model because the model fits there; batch work waits
        because nobody is waiting on it; and the L-class leaves the chat market the moment the promised pace outruns its memory and links. Change those facts and the best
        allocation, and what it earns, change with them.
      </P>
      <P>
        The provider decides who gets its GPUs hour by hour. Its customers face the mirror image of that decision on a longer clock: how much capacity to commit to in
        advance, and how much to leave to on-demand and interruptible hours whose availability and price they don’t control. That is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}

/** Used by the tests: the B-class bid for every workload under the reference physics. */
export function referenceBidsB(): Record<WorkloadId, number | null> {
  const out = {} as Record<WorkloadId, number | null>;
  for (const w of YIELD_WORKLOADS) out[w.id] = bidOf(w.id, 'B', PHYSICS_DEFAULTS, YIELD_DEFAULTS.power);
  return out;
}

