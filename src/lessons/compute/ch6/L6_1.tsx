import {
  Caption,
  Challenge,
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
  TEXT,
  fmt,
  hour,
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
import { bestHour, hourShadowPrices, weekDemand, yieldRunBest } from '../../../engines/compute/yieldOptimal';
import { gpuHourCost } from '../../../engines/compute/facilityCost';
import { annualPue } from '../../../engines/compute/cooling';
import { memoryPlan } from '../../../engines/compute/inference';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { type WorkloadId } from '../../../model/compute/workloads';
import { Prediction } from './Prediction';

// ---------------------------------------------------------------------------
// The state the reader controls: the allocation policy, protected B-class GPUs, and the physical
// drivers behind each GPU's productivity (the frontier model's precision, the chat assistant's time
// per token) and running cost (the price of electricity).

/** First come, first served and highest bid first (yieldManager.ts), or the best allocation, a linear program each hour (yieldOptimal.ts). */
export type AllocPolicy = Policy | 'best';

/** Challenge b's prediction: what letting the L-class into chat does to first come, first served's margin. */
export type MarginGuess = 'raise' | 'lower' | 'same';

export interface YieldState {
  policy: AllocPolicy;
  /** B-class GPUs only interactive work may use. */
  protect: number;
  precision: 'fp8' | 'bf16';
  /** The chat assistant's limit on time per output token, ms. */
  chatMs: number;
  /** Electricity, $/MWh. */
  power: number;
  /** Challenge a's prediction: the workload that gets less done under the best allocation. */
  guessA: WorkloadId | '';
  /** Challenge b's prediction. */
  guessB: MarginGuess | '';
}

export const YIELD_DEFAULTS: YieldState = { policy: 'first-come', protect: 0, precision: 'fp8', chatMs: 40, power: 55, guessA: '', guessB: '' };
export const PROTECT_STEP = 25;
export const CHAT_MIN = 20;
export const CHAT_MAX = 60;
const HOURS = 168;

export function physicsOf(s: Pick<YieldState, 'precision' | 'chatMs'>): Physics {
  return { frontierPrecision: s.precision, chatTpotMax: s.chatMs / 1000 };
}

const cache = new Map<string, YieldResult>();
/** A simulated week of the Tech Park fleet under a state (memoized). */
export function runYield(s: Pick<YieldState, 'policy' | 'protect' | 'precision' | 'chatMs' | 'power'>): YieldResult {
  const key = `${s.policy}|${s.protect}|${s.precision}|${s.chatMs}|${s.power}`;
  let r = cache.get(key);
  if (!r) {
    const p = { fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, protectB: s.protect, physics: physicsOf(s), powerPrice: s.power, hours: HOURS };
    r = s.policy === 'best' ? yieldRunBest(p) : yieldRun({ ...p, policy: s.policy });
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

/**
 * The workloads that get less of their work done under the best allocation than under first come,
 * first served, with the state's physics and protection. Batch summarization alone, at every setting.
 */
export function losersOf(s: YieldState): WorkloadId[] {
  const fc = runYield({ ...s, policy: 'first-come' }).served;
  const best = runYield({ ...s, policy: 'best' }).served;
  return YIELD_WORKLOADS.filter((w) => best[w.id] < fc[w.id] - 1e-6).map((w) => w.id);
}

/** Challenge a: the reader predicted a workload that loses work, and has switched to the best allocation to check. */
export function loserSolved(s: YieldState): boolean {
  return s.policy === 'best' && s.guessA !== '' && losersOf(s).includes(s.guessA);
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

/** Challenge b's setting: first come, first served, the reference physics and power, nothing held back. */
export function chatCheckReady(s: YieldState): boolean {
  return s.policy === 'first-come' && s.protect === 0 && s.precision === YIELD_DEFAULTS.precision && s.power === YIELD_DEFAULTS.power;
}

/** What letting the L-class into chat (the threshold, against one millisecond tighter) does to first come, first served's margin. */
export function chatMarginEffect(): MarginGuess {
  const t = chatThresholdMs();
  const d = runYield({ ...YIELD_DEFAULTS, chatMs: t }).margin - runYield({ ...YIELD_DEFAULTS, chatMs: t - 1 }).margin;
  return Math.abs(d) < 1 ? 'same' : d > 0 ? 'raise' : 'lower';
}

/** Challenge b: the right prediction, checked at the threshold under first come, first served. */
export function chatMarginSolved(s: YieldState): boolean {
  return chatCheckReady(s) && s.chatMs === chatThresholdMs() && s.guessB === chatMarginEffect();
}

/** What each workload would earn from one hour of a GPU, net of the GPU's running cost, $ (null if it can't run there). */
export function bidOf(id: WorkloadId, g: GpuId, physics: Physics, power: number): number | null {
  const prod = productivityUnder(physics)[id][g];
  if (prod <= 0) return null;
  const w = YIELD_WORKLOADS.find((x) => x.id === id)!;
  return w.value * prod - busyCost(g, power);
}

const DEMAND = weekDemand(YIELD_WORKLOADS, HOURS);
const shadowCache = new Map<string, Record<GpuId, number>>();
/**
 * Each GPU type's shadow price at an hour of the day, averaged over the week's seven days: what one
 * more GPU of that type would add to the best allocation's margin that hour, $ per GPU-hour.
 */
export function shadowAt(s: Pick<YieldState, 'precision' | 'chatMs' | 'power'>, hourOfDay: number): Record<GpuId, number> {
  const key = `${s.precision}|${s.chatMs}|${s.power}|${hourOfDay}`;
  let out = shadowCache.get(key);
  if (!out) {
    out = { L: 0, A: 0, B: 0 };
    const days = HOURS / 24;
    for (let d = 0; d < days; d++) {
      const sp = hourShadowPrices({ fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, need: DEMAND[d * 24 + hourOfDay], physics: physicsOf(s), powerPrice: s.power });
      for (const g of GPU_IDS) out[g] += sp[g] / days;
    }
    if (shadowCache.size > 600) shadowCache.clear();
    shadowCache.set(key, out);
  }
  return out;
}

/** Batch summarization's work under the best allocation at each hour of the day, averaged over the week, A-class equivalents. */
export function batchByHourOfDay(s: YieldState = YIELD_DEFAULTS): number[] {
  const prod = productivityUnder(physicsOf(s));
  const out = Array<number>(24).fill(0);
  DEMAND.forEach((need, h) => {
    const plan = bestHour({ fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, need, physics: physicsOf(s), powerPrice: s.power, protectB: s.protect });
    out[h % 24] += GPU_IDS.reduce((t, g) => t + plan.gpus.batch8[g] * prod.batch8[g], 0) / (HOURS / 24);
  });
  return out;
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
const BID = runYield({ ...YIELD_DEFAULTS, policy: 'best-value' });
const BEST = runYield({ ...YIELD_DEFAULTS, policy: 'best' });
const FC300 = runYield({ ...YIELD_DEFAULTS, protect: YIELD_FLEET.B });
const BF16_BEST = runYield({ ...YIELD_DEFAULTS, policy: 'best', precision: 'bf16' });
const BF16_BID = runYield({ ...YIELD_DEFAULTS, policy: 'best-value', precision: 'bf16' });
const BF16_FC = runYield({ ...YIELD_DEFAULTS, precision: 'bf16' });
const CHAT20_BEST = runYield({ ...YIELD_DEFAULTS, policy: 'best', chatMs: 20 });
const POWER400_BEST = runYield({ ...YIELD_DEFAULTS, policy: 'best', power: 400 });
const THRESHOLD = chatThresholdMs();
const FC_AT = runYield({ ...YIELD_DEFAULTS, chatMs: THRESHOLD });
const FC_BEFORE = runYield({ ...YIELD_DEFAULTS, chatMs: THRESHOLD - 1 });
const BEST_AT = runYield({ ...YIELD_DEFAULTS, policy: 'best', chatMs: THRESHOLD });
const BEST_BEFORE = runYield({ ...YIELD_DEFAULTS, policy: 'best', chatMs: THRESHOLD - 1 });
const PROD = productivityUnder(PHYSICS_DEFAULTS);
const PROD_BF16 = productivityUnder(physicsOf({ precision: 'bf16', chatMs: 40 }));
const PROD_AT = productivityUnder(physicsOf({ precision: 'fp8', chatMs: THRESHOLD }));
const MEM_400_A = memoryPlan({ model: '400B', gpu: 'A', tp: 8, precision: 'bf16' });
const bid = (id: WorkloadId, g: GpuId) => bidOf(id, g, PHYSICS_DEFAULTS, YIELD_DEFAULTS.power) ?? 0;
/** The afternoon peak and a night hour, for the shadow prices the prose quotes. */
export const PEAK_HOUR = 15;
export const NIGHT_HOUR = 3;
const SHADOW_PEAK = shadowAt(YIELD_DEFAULTS, PEAK_HOUR);
const SHADOW_NIGHT = shadowAt(YIELD_DEFAULTS, NIGHT_HOUR);
const BATCH_HOURLY = batchByHourOfDay();
const FIXED_PER_WEEK = fleetFixedPerWeek();

export const LESSON_NUMBERS = {
  fleet: YIELD_FLEET,
  fixedPerWeek: FIXED_PER_WEEK,
  fcMargin: FC.margin,
  fcRevenue: FC.revenue,
  fcPower: FC.powerCost,
  fcUtil: FC.utilization,
  fcServed: FC.served,
  fcBatchOnB: FC.gpuHours.batch8.B,
  bestMargin: BEST.margin,
  bestGain: BEST.margin - FC.margin,
  bestGainShare: (BEST.margin - FC.margin) / FC.margin,
  bestUtil: BEST.utilization,
  bestServed: BEST.served,
  bestCodeOnA: BEST.gpuHours.code8.A / (BEST.gpuHours.code8.A + BEST.gpuHours.code8.B + BEST.gpuHours.code8.L),
  bestFrontierOnB: BEST.gpuHours.frontier400.B / (BEST.gpuHours.frontier400.A + BEST.gpuHours.frontier400.B + BEST.gpuHours.frontier400.L),
  bestTrainOnB: BEST.gpuHours.train70.B,
  bestBatchOnB: BEST.gpuHours.batch8.B,
  bestBatchOnL: BEST.gpuHours.batch8.L,
  bestPower: BEST.powerCost,
  bidMargin: BID.margin,
  bidShort: BEST.margin - BID.margin,
  bidCodeOnB: BID.gpuHours.code8.B,
  bidTrainOnB: BID.gpuHours.train70.B,
  /** Batch work done in an average night hour (00:00–06:00) and at the afternoon peak, A-class equivalents. */
  batchNight: BATCH_HOURLY.slice(0, 7).reduce((a, b) => a + b, 0) / 7,
  batchPeak: BATCH_HOURLY[PEAK_HOUR],
  fc300Margin: FC300.margin,
  fc300Recovered: FC300.margin - FC.margin,
  fc300RecoveredShare: (FC300.margin - FC.margin) / (BEST.margin - FC.margin),
  fc300BatchOnA: FC300.gpuHours.batch8.A,
  fc300Served: FC300.served,
  prodFrontierB: PROD.frontier400.B,
  prodChatB: PROD.chat70.B,
  prodBatchB: PROD.batch8.B,
  prodCodeB: PROD.code8.B,
  prodTrainB: PROD.train70.B,
  prodTuneB: PROD.tune8.B,
  prodTuneL: PROD.tune8.L,
  prodTrainL: PROD.train70.L,
  bidsB: { frontier: bid('frontier400', 'B'), code: bid('code8', 'B'), chat: bid('chat70', 'B'), train: bid('train70', 'B'), tune: bid('tune8', 'B'), batch: bid('batch8', 'B') },
  bidsA: { code: bid('code8', 'A'), frontier: bid('frontier400', 'A'), chat: bid('chat70', 'A'), train: bid('train70', 'A'), tune: bid('tune8', 'A'), batch: bid('batch8', 'A') },
  bidsL: { tune: bid('tune8', 'L'), code: bid('code8', 'L'), train: bid('train70', 'L'), batch: bid('batch8', 'L'), chat: bid('chat70', 'L') },
  busyB: busyCost('B', YIELD_DEFAULTS.power),
  shadowPeak: SHADOW_PEAK,
  shadowNight: SHADOW_NIGHT,
  batchValue: YIELD_WORKLOADS.find((w) => w.id === 'batch8')!.value,
  bf16WeightsGB: MEM_400_A.weightBytes / 1e9,
  bf16UsableAGB: MEM_400_A.usableBytes / 1e9,
  prodFrontierBBf16: PROD_BF16.frontier400.B,
  bf16BestMargin: BF16_BEST.margin,
  bf16Loss: BEST.margin - BF16_BEST.margin,
  bf16FrontierServed: BF16_BEST.served.frontier400,
  bf16Gain: BF16_BEST.margin - BF16_FC.margin,
  bf16BidMargin: BF16_BID.margin,
  chat20BestMargin: CHAT20_BEST.margin,
  threshold: THRESHOLD,
  prodChatLAt: PROD_AT.chat70.L,
  /** What an L-class hour earns from chat at the threshold, and from fine-tuning, after electricity. */
  bidChatLAt: bidOf('chat70', 'L', physicsOf({ precision: 'fp8', chatMs: THRESHOLD }), YIELD_DEFAULTS.power) ?? 0,
  fcAtThreshold: FC_AT.margin,
  fcBeforeThreshold: FC_BEFORE.margin,
  bestAtThreshold: BEST_AT.margin,
  bestBeforeThreshold: BEST_BEFORE.margin,
  bestChatOnLAt: BEST_AT.gpuHours.chat70.L,
  fcChatOnLAt: FC_AT.gpuHours.chat70.L,
  fcTuneAt: FC_AT.served.tune8,
  fcTuneBefore: FC_BEFORE.served.tune8,
  power400Margin: POWER400_BEST.margin,
  power400Cost: POWER400_BEST.powerCost,
  powerShareOfFixed: BEST.powerCost / FIXED_PER_WEEK,
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

/** How much of the work each workload wanted the fleet did this week. */
function WorkDone({ r }: { r: YieldResult }) {
  const col = 640 / YIELD_WORKLOADS.length;
  const label = YIELD_WORKLOADS.map((w) => `${NAME[w.id]} ${pct(r.served[w.id])}`).join(', ');
  return (
    <svg className="chart" viewBox="0 0 640 66" role="img" aria-label={`Share of the work each workload wanted that the fleet did this week: ${label}.`}>
      <text className="ax" x={0} y={12}>
        Share of the work each workload wanted that the fleet did
      </text>
      {YIELD_WORKLOADS.map((w, i) => {
        const x = i * col;
        const share = r.served[w.id];
        return (
          <g key={w.id}>
            <text x={x} y={32} style={{ fontSize: 12, fill: '#333' }}>
              {NAME[w.id]}
            </text>
            <rect x={x} y={38} width={col - 14} height={7} fill={IDLE} />
            <rect x={x} y={38} width={(col - 14) * share} height={7} fill={WCOLOR[w.id]} />
            <text x={x} y={62} style={{ fontSize: 13, fontWeight: 600, fill: '#222' }}>
              {pct(share)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Every workload's bid for one hour of a GPU type, sorted, under the current physics, against the GPU's shadow price at an hour. */
function BidChart({ g, physics, power, shadow, at }: { g: GpuId; physics: Physics; power: number; shadow: number; at: number }) {
  const prod = productivityUnder(physics);
  const rows = YIELD_WORKLOADS.map((w) => ({ id: w.id, bid: bidOf(w.id, g, physics, power), prod: prod[w.id][g] })).sort((a, b) => (b.bid ?? -1) - (a.bid ?? -1));
  const top = g === 'B' ? 16 : g === 'A' ? 6 : 1.2;
  const x = scale(0, top, 214, 600);
  const ticks = g === 'B' ? [0, 4, 8, 12, 16] : g === 'A' ? [0, 2, 4, 6] : [0, 0.4, 0.8, 1.2];
  const label = rows.map((r) => `${NAME[r.id]} ${r.bid === null ? 'can’t run it' : m2(r.bid)}`).join(', ');
  const sx = x(Math.min(top, shadow));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 280"
      role="img"
      aria-label={`What an hour of a ${GPU_SHORT[g]} GPU earns from each workload, after its running cost: ${label}. Its shadow price at ${hour(at)}: ${m2(shadow)}.`}
    >
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
      <line x1={sx} x2={sx} y1={22} y2={240} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text x={sx + (sx > 470 ? -5 : 5)} y={276} textAnchor={sx > 470 ? 'end' : 'start'} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green }}>
        shadow price at {hour(at)}: {m2(shadow)}
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('fleet', YIELD_DEFAULTS);
  const st = s1.state;
  const r = runYield(st);
  const physics = physicsOf(st);

  const s2 = useScenario('bids', { gpu: 'B' as GpuId, hour: PEAK_HOUR });
  const g2 = s2.state.gpu;
  const h2 = s2.state.hour;
  const batchBid = bidOf('batch8', g2, physics, st.power);
  const shadow = shadowAt(st, h2)[g2];

  // Challenge a: predict the workload that loses work, then switch.
  const solvedA = loserSolved(st);
  const fcNow = runYield({ ...st, policy: 'first-come' });
  const bestNow = runYield({ ...st, policy: 'best' });
  const othersFull = YIELD_WORKLOADS.every((w) => w.id === 'batch8' || bestNow.served[w.id] > 0.9995);
  const aStatus =
    st.guessA === ''
      ? st.policy === 'best'
        ? 'Make your prediction before you look: return to first come, first served, choose a workload in the first demonstration, then switch.'
        : 'Choose your prediction in the first demonstration, then switch to the best allocation.'
      : st.policy !== 'best'
        ? `Your prediction: ${NAME[st.guessA].toLowerCase()}. Now switch to the best allocation and compare the work done.`
        : `${NAME[st.guessA]} gets ${pct(bestNow.served[st.guessA])} of its work done under the best allocation, against ${pct(fcNow.served[st.guessA])} first come, first served: it doesn’t lose work. Look again at the shares.`;
  const aSuccess = `Solved: batch summarization. First come, first served got ${pct(fcNow.served.batch8)} of its work done; the best allocation gets ${pct(bestNow.served.batch8)}, while every other workload ${othersFull ? 'is now served in full' : 'gets at least as much done'}. The fleet has no more GPUs than before, so the work the higher payers gain has to come from somewhere, and the best allocation takes it from the lowest payer, whose work nobody is waiting on.`;

  // Challenge b: predict what letting the L-class into chat does to first come, first served's margin.
  const T = N.threshold;
  const solvedB = chatMarginSolved(st);
  const bStatus =
    st.guessB === ''
      ? `Make your prediction in the first demonstration, then check it under first come, first served at ${T - 1} ms and ${T} ms.`
      : !chatCheckReady(st)
        ? `Choose first come, first served, with no B-class GPUs held back, the frontier model in FP8 and electricity at $${YIELD_DEFAULTS.power} per MWh.`
        : st.chatMs === T - 1
          ? `At ${T - 1} ms the L-class is out of the chat market. Note the margin, then set ${T} ms.`
          : st.chatMs === T
            ? `At ${T} ms the L-class is in the chat market. Compare the margin with the one at ${T - 1} ms, and with your prediction.`
            : `Set chat’s limit to ${T - 1} ms and note the margin, then to ${T} ms.`;

  return (
    <LessonPage id="compute/6.1">
      <P>
        The previous lesson found that one kind of GPU can sell for very different prices depending on who can reach it and what work it does. This chapter turns
        those differences into strategies, beginning with the provider’s. Every hour, a GPU cloud decides who gets which of its
        GPUs. An hour nobody uses is gone for good, like an empty seat on a flight that has left, and the hardware costs almost as much idle as busy (
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). Airlines and hotels, which also sell capacity that perishes, call the craft of deciding who gets it{' '}
        <b>yield management</b>, or revenue management.
      </P>
      <P>
        Take one provider’s fleet at Tech Park, smaller than the whole site of Lesson 5.5: {fmt(N.fleet.L)} L-class 48 GB, {fmt(N.fleet.A)} A-class 80 GB and{' '}
        {fmt(N.fleet.B)} B-class 192 GB GPUs. Its customers are the six workloads of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>, each paying a different{' '}
        <K c="price">value</K> for an A-class-equivalent hour of its work — the work one A-class GPU does for it: code completion {m2(5)}, the frontier assistant {m2(4.5)},
        the chat assistant {m2(3.5)}, the pretraining run {m2(2.6)}, fine-tuning {m2(2.4)} and batch summarization {m2(1.4)}, all simulated. Interactive demand rises and
        falls with the day, peaking in the afternoon (<a href={lessonHref('compute/5.3')}>Lesson 5.3</a>); training and batch work are steady. And each kind of GPU does a
        different amount of each workload’s work, from the throughputs of Chapter 3: a B-class GPU does {fmt(N.prodFrontierB, 2)} A-class hours of the frontier assistant’s
        work but {fmt(N.prodTuneB, 2)} of fine-tuning, and an L-class card {fmt(N.prodTrainL, 2)} of an hour of training and none at all of the frontier model’s.
      </P>
      <P>
        What the provider maximizes is the <K c="price">contribution margin</K>: revenue minus the electricity its busy GPUs draw. The capital is already spent — this
        fleet’s servers, network and building cost about {k(N.fixedPerWeek)} a week whether they are busy or not — and the margin is what pays for them. In the next
        demonstration, each bar is one kind of GPU over a simulated week, divided by the workloads that used its hours; gray is idle. Under the bars is the share of
        the work each workload wanted that the fleet did. Three policies decide who gets what. First come, first served lets the workloads ask in a random order each
        hour, each taking the most productive GPUs still free. Highest bid first hands out each hour’s GPUs in order of what they earn: the pair of workload and GPU that
        earns most per GPU-hour goes first. The best allocation solves each hour as a linear program, as Lesson 5.5’s market did: of all the ways to split that hour’s GPUs
        among the work wanted, it finds the one that earns the most. The other controls come up later in the lesson:
      </P>

      <Figure name="Compute Yield Manager" scenario={s1}>
        <Segmented
          label="Allocation policy"
          value={st.policy}
          onChange={(policy) => s1.set({ policy })}
          options={[
            { value: 'first-come', label: 'First come, first served' },
            { value: 'best-value', label: 'Highest bid first' },
            { value: 'best', label: 'Best allocation' },
          ]}
        />
        <FleetBars r={r} />
        <WorkDone r={r} />
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
        <Prediction
          label="Challenge a — predict: under the best allocation, which workload gets less of its work done than first come, first served gives it?"
          aria="Your prediction for challenge a"
          value={st.guessA}
          onChange={(guessA) => s1.set({ guessA })}
          options={YIELD_WORKLOADS.map((w) => ({ value: w.id, label: NAME[w.id] }))}
        />
        <Prediction
          label={`Challenge b — predict: under first come, first served, letting the L-class into chat (${T - 1} ms → ${T} ms) does what to the margin?`}
          aria="Your prediction for challenge b"
          value={st.guessB}
          onChange={(guessB) => s1.set({ guessB })}
          options={[
            { value: 'raise', label: 'Raises it' },
            { value: 'lower', label: 'Lowers it' },
            { value: 'same', label: 'No change' },
          ]}
        />
      </Figure>

      <P>
        First come, first served earns a margin of {usd(N.fcMargin)} for the week. The B-class GPUs are all busy, but not with the right work: batch summarization, the
        lowest payer, holds {fmt(N.fcBatchOnB)} B-class GPU-hours while the frontier assistant, which only the A- and B-class can run, goes without{' '}
        {pct(1 - N.fcServed.frontier400)} of what it wants. The best allocation will do better. But it has no more GPUs to hand out, so if some workloads get more of
        their work done, another must get less.
      </P>

      <Challenge
        id="a"
        question="Predict first: when you switch the first demonstration from first come, first served to the best allocation, which workload will get less of its work done? Choose your prediction in the demonstration, then switch and compare the shares."
        solved={solvedA}
        status={aStatus}
        success={aSuccess}
      />

      <P>
        The best allocation earns {usd(N.bestMargin)}: {usd(N.bestGain)} more than first come, first served, or {pct(N.bestGainShare, 1)}, every week. Its batch work
        crowds into the hours when interactive demand falls away: about {fmt(Math.round(N.batchNight / 10) * 10)} A-class-equivalent hours of it in each hour of the
        night, against {fmt(Math.round(N.batchPeak / 10) * 10)} at {hour(PEAK_HOUR)}. Look at the utilizations: they barely move ({pct(N.fcUtil.A)} of the A-class busy
        before, {pct(N.bestUtil.A)} after). The gain comes from who uses the GPUs, not from how many are busy. Highest bid first earns {usd(N.bidMargin)},{' '}
        {usd(N.bidShort)} less; the third section shows why.
      </P>

      <H2>Protecting the scarce GPUs</H2>
      <P>
        A real scheduler can’t always solve a whole hour’s allocation before requests arrive. A common substitute is a <b>protection level</b>: capacity set aside for the
        customers who pay most, the way an airline keeps seats back for travelers who book late at high fares. Return the first demonstration to first come, first served
        and hold B-class GPUs back for interactive work. Protecting all {fmt(N.fleet.B)} of them lifts the margin to {usd(N.fc300Margin)}, which recovers only{' '}
        {usd(N.fc300Recovered)} of the {usd(N.bestGain)} gap, {pct(N.fc300RecoveredShare)}.
      </P>
      <P>
        The rest of the loss isn’t on the B-class at all. When batch work happens to ask first in an afternoon hour, it takes A-class GPUs that chat and the frontier
        assistant need at their peak: even with every B-class GPU protected, batch summarization runs {fmt(N.fc300BatchOnA)} A-class GPU-hours over the week while the
        frontier assistant still misses {pct(1 - N.fc300Served.frontier400)} of its work. The best allocation makes batch wait, and batch can: that is what made it the
        flexible demand of Lesson 5.3 and the natural buyer of interruptible capacity in <a href={lessonHref('compute/5.4')}>Lesson 5.4</a>.
      </P>

      <H2>What a GPU-hour is worth</H2>
      <P>
        Every pair of workload and GPU has a <b>bid</b>: what the workload would pay for an hour of that GPU — its value times the work the GPU does for it — minus the
        GPU’s running cost. A B-class hour fetches {m2(N.bidsB.frontier)} from the frontier assistant, {m2(N.bidsB.code)} from code completion and {m2(N.bidsB.chat)}{' '}
        from chat, but only {m2(N.bidsB.batch)} from batch summarization. It is tempting to call the difference, {m2(N.bidsB.frontier - N.bidsB.batch)}, what giving the
        hour to batch costs. It isn’t: the work batch displaces doesn’t vanish, because other GPUs can do it. What the fleet gives up by using an hour, its{' '}
        <b>opportunity cost</b>, is the hour’s <K c="price">shadow price</K>, as in <a href={lessonHref('compute/5.5')}>Lesson 5.5</a>: how much more the best
        allocation would earn with one more GPU of that kind, that hour. In the next demonstration, choose a kind of GPU and an hour of the day to see each workload’s
        bid against the GPU’s shadow price, averaged over the week’s seven days, under the physics set in{' '}
        <FigRef to="Compute Yield Manager">the first demonstration</FigRef>:
      </P>

      <Figure name="Compute Yield Manager · value per GPU-hour" scenario={s2}>
        <Segmented label="Accelerator" value={g2} onChange={(gpu) => s2.set({ gpu })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <Slider label="Hour of the day" tone="green" value={h2} min={0} max={23} onChange={(v) => s2.set({ hour: v })} display={hour(h2)} />
        <BidChart g={g2} physics={physics} power={st.power} shadow={shadow} at={h2} />
        <Readouts
          items={[
            {
              label: `given to batch at ${hour(h2)}, the fleet gives up`,
              value: batchBid === null ? 'batch can’t run here' : m2(Math.max(0, shadow - batchBid)),
              tone: 'green',
            },
          ]}
        />
        <Caption>{`With the first demonstration’s physics: the frontier model in ${st.precision === 'fp8' ? 'FP8' : 'BF16'}, chat at most ${st.chatMs} ms a token, electricity at $${st.power} per MWh.`}</Caption>
      </Figure>

      <P>
        At {hour(PEAK_HOUR)} a B-class hour’s shadow price is {m2(N.shadowPeak.B)}. One more B-class GPU would take over chat work from {fmt(N.prodChatB, 2)} A-class GPUs,
        and they would summarize documents — the lowest-paying work still waiting — at {m2(N.batchValue)} an A-class hour: {fmt(N.prodChatB, 2)} × {m2(N.batchValue)}, less
        the B-class GPU’s own {usd(N.busyB, 2)} of electricity. Batch’s bid falls short of that by {m2(N.shadowPeak.B - N.bidsB.batch)}, not{' '}
        {m2(N.bidsB.frontier - N.bidsB.batch)}. At {hour(NIGHT_HOUR)}, with GPUs idle, the shadow price drops to {m2(N.shadowNight.B)} — the electricity a B-class GPU saves
        over the A-class GPUs that would otherwise do its work — and batch is welcome. The A-class’s afternoon shadow price is {m2(N.shadowPeak.A)}, exactly batch’s bid:
        batch is the last buyer of A-class hours.
      </P>
      <P>
        Shadow prices also explain where highest bid first goes wrong. It gives B-class hours to code completion, the best payer, and to training, which bids{' '}
        {m2(N.bidsB.train)} for one; the best allocation does neither. What decides it is each GPU’s edge over the others: a B-class GPU does {fmt(N.prodFrontierB, 2)} A-class hours of the frontier
        model’s work, {fmt(N.prodChatB, 2)} of chat’s and {fmt(N.prodBatchB, 2)} of batch’s, but only {fmt(N.prodCodeB, 2)} of code completion’s and{' '}
        {fmt(N.prodTrainB, 2)} of training’s. The L-class, a poor substitute for everything, goes where it is least poor: fine-tuning, where it does{' '}
        {fmt(N.prodTuneL, 2)} of an A-class GPU’s work. That is <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>’s comparative advantage, now priced.
      </P>

      <H2>When the physics changes</H2>
      <P>
        The strategy’s margin rests on physical facts, and the first demonstration lets you change three of them. Serve the frontier model in BF16 instead of FP8, for
        quality. Its weights become {fmt(N.bf16WeightsGB)} GB, more than the {fmt(N.bf16UsableAGB)} GB eight A-class GPUs can hold (
        <a href={lessonHref('compute/3.2')}>Lesson 3.2</a>), so the A-class drops out of the frontier market, and the B-class, now needing eight GPUs per copy, does
        only {fmt(N.prodFrontierBBf16, 2)} A-class hours of the work. The best allocation earns {usd(N.bf16BestMargin)}, {usd(N.bf16Loss)} less a week, keeping the
        B-class for the one model nothing else can run; highest bid first, which hands the B-class to code completion and chat first, earns only{' '}
        {usd(N.bf16BidMargin)}. When only one kind of GPU can do the most valuable work, allocating it well matters more.
      </P>
      <P>
        Raise the price of electricity to $400 per megawatt-hour, several times what Tech Park usually pays, and the week’s power bill grows from {usd(N.bestPower)} to{' '}
        {usd(N.power400Cost)}, taking the margin to {usd(N.power400Margin)}. At the usual price, though, the week’s electricity is about {pct(N.powerShareOfFixed)} of
        what the capital costs, which is why <a href={lessonHref('compute/6.4')}>Lesson 6.4</a> finds less to gain from chasing cheap power than one might expect.
      </P>
      <P>
        Tighten the chat assistant’s time per token and each GPU must run smaller batches to keep the promise (Lesson 3.2): at 20 ms the best allocation’s margin falls
        to {usd(N.chat20BestMargin)}. Tighten it enough and the L-class leaves the chat market. Eight L-class cards, reading the 70B model’s weights through their
        graphics memory and exchanging results over PCIe, take a little over {T - 1} ms per token for a single request, so they can serve chat only at a limit of {T} ms
        or more — and even at {T} ms a card does {fmt(N.prodChatLAt, 3)} A-class hours of chat work, so the hour fetches {m2(N.bidChatLAt)} from chat after its
        electricity, against {m2(N.bidsL.tune)} from fine-tuning.
      </P>

      <Challenge
        id="b"
        figure="Compute Yield Manager"
        question={`Predict first: under first come, first served, does letting the L-class into the chat market — moving chat’s limit from ${T - 1} ms to ${T} ms a token — raise the week’s contribution margin, lower it, or leave it unchanged? Choose your prediction in the first demonstration, then check it at both limits.`}
        solved={solvedB}
        status={bStatus}
        success={`Solved: it lowers it, from ${usd(N.fcBeforeThreshold)} to ${usd(N.fcAtThreshold)}, or ${usd(N.fcBeforeThreshold - N.fcAtThreshold)} a week. Under first come, first served, chat takes whatever GPUs are still free when it asks, and now that includes L-class cards: ${fmt(N.fcChatOnLAt)} hours of them over the week, doing little chat work, while fine-tuning, which used some of those cards, gets ${pct(N.fcTuneAt)} of its work done instead of ${pct(N.fcTuneBefore)}. A customer willing to pay isn’t always a good use of a GPU.`}
      />

      <P>
        Switch to the best allocation and try the same two limits: the margin stays at {usd(N.bestAtThreshold)}. The best allocation never gives chat an L-class hour;
        when chat needs more, it takes an A-class GPU from batch, which gives up {m2(N.bidsA.batch)}, rather than the {fmt(1 / N.prodChatLAt)} L-class cards that would
        do the same work.
      </P>
      <P>
        The provider decides who gets its GPUs hour by hour, and each of its choices has a physical cause: the model that fits, the work nobody is waiting on, the pace a
        card’s memory and links can keep. Its customers face the mirror image of that decision on a longer clock: how much capacity to commit to in advance, and how much
        to leave to on-demand and interruptible hours whose availability and price they don’t control. That is the subject of the next lesson.
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

