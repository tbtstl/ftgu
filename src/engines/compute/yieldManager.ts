// Yield management for a GPU fleet: every hour, demand arrives from several workloads, each
// willing to pay a different amount for its work, and each kind of GPU does a different amount of
// each workload's work (Lesson 3.5). Which GPU goes to which workload decides how much the fleet
// earns. Work is measured in A-class equivalents: the work one A-class GPU does for that workload in
// its reference configuration (Lesson 3.5's). Changing the physics — a model's precision, a latency
// limit — changes how much work each GPU does, and so what the fleet can earn. All values simulated.

import { rng, gaussian } from '../../model/random';
import { GPU_IDS, serverPowerW, type GpuId } from '../../model/compute/hardware';
import { WORKLOADS, WORKLOAD_IDS, type Workload, type WorkloadId } from '../../model/compute/workloads';
import { fitOf, workloadFit, type Fit } from './compatibility';

/** Work per second one GPU does: output tokens for serving, training tokens for training. */
function rateOf(f: Fit, w: Workload): number {
  if (!f.feasible) return 0;
  if (f.kind === 'serve') return f.tokensPerGpuS;
  const r = f.run!;
  return w.kind === 'train' ? w.tokens / (r.gpuHours * 3600) : 0;
}

/** Workload settings a lesson may change: the physical drivers. */
export interface Physics {
  /** Weight precision for the frontier assistant's 400B model. */
  frontierPrecision: 'fp8' | 'bf16';
  /** The chat assistant's limit on time per output token, s. */
  chatTpotMax: number;
}

export const PHYSICS_DEFAULTS: Physics = { frontierPrecision: 'fp8', chatTpotMax: 0.04 };

function workloadUnder(id: WorkloadId, p: Physics): Workload {
  const w = WORKLOADS[id];
  if (id === 'frontier400' && w.kind === 'serve') return { ...w, precision: p.frontierPrecision };
  if (id === 'chat70' && w.kind === 'serve') return { ...w, tpotMax: p.chatTpotMax };
  return w;
}

const prodCache = new Map<string, Record<WorkloadId, Record<GpuId, number>>>();

/**
 * Productivity of each GPU for each workload, in A-class equivalents, under the given physics:
 * the GPU's rate divided by the A-class's rate in the reference configuration.
 */
export function productivityUnder(p: Physics): Record<WorkloadId, Record<GpuId, number>> {
  const key = `${p.frontierPrecision}|${p.chatTpotMax}`;
  const hit = prodCache.get(key);
  if (hit) return hit;
  const out = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const id of WORKLOAD_IDS) {
    const ref = rateOf(workloadFit(id, 'A'), WORKLOADS[id]);
    const w = workloadUnder(id, p);
    out[id] = {} as Record<GpuId, number>;
    for (const g of GPU_IDS) out[id][g] = ref > 0 ? rateOf(fitOf(w, g), w) / ref : 0;
  }
  prodCache.set(key, out);
  return out;
}

export interface YieldWorkload {
  id: WorkloadId;
  /** Average demand, A-class equivalents. */
  mean: number;
  /** Daily swing as a share of the mean (peaks mid-afternoon). */
  swing: number;
  /** $ per A-class-equivalent hour of work. */
  value: number;
}

/** A Tech Park fleet's customers (simulated). Interactive work swings with the day; training is steady. */
export const YIELD_WORKLOADS: YieldWorkload[] = [
  { id: 'code8', mean: 150, swing: 0.6, value: 5.0 },
  { id: 'frontier400', mean: 260, swing: 0.5, value: 4.5 },
  { id: 'chat70', mean: 600, swing: 0.5, value: 3.5 },
  { id: 'train70', mean: 300, swing: 0, value: 2.6 },
  { id: 'tune8', mean: 80, swing: 0, value: 2.4 },
  { id: 'batch8', mean: 600, swing: 0, value: 1.4 },
];

export const YIELD_FLEET: Record<GpuId, number> = { L: 300, A: 1200, B: 300 };

export type Policy = 'first-come' | 'best-value';

export interface YieldParams {
  fleet: Record<GpuId, number>;
  workloads: YieldWorkload[];
  policy: Policy;
  /** B-class GPUs only interactive work (code, frontier, chat) may use. */
  protectB: number;
  physics: Physics;
  /** Electricity, $/MWh (running cost of a busy GPU at PUE 1.25). */
  powerPrice: number;
  hours: number;
  seed?: number;
}

export interface YieldResult {
  revenue: number;
  powerCost: number;
  margin: number;
  /** Share of each GPU type busy. */
  utilization: Record<GpuId, number>;
  /** Share of each workload's demand served. */
  served: Record<WorkloadId, number>;
  /** Revenue earned per GPU type. */
  revenueByGpu: Record<GpuId, number>;
  /** GPU-hours each workload received by type. */
  gpuHours: Record<WorkloadId, Record<GpuId, number>>;
}

const INTERACTIVE: WorkloadId[] = ['code8', 'frontier400', 'chat70'];

/** Running cost of one busy GPU for an hour, $. */
export function busyCost(g: GpuId, powerPrice: number): number {
  return ((serverPowerW(g, g === 'B' ? 'liquid' : 'air') / 8000) * 1.25 * powerPrice) / 1000;
}

/**
 * A week (or any number of hours) of allocation. 'first-come': each hour the workloads ask in a
 * random order and each takes the most productive GPUs left. 'best-value': each hour GPUs go to the
 * pairs of workload and GPU that earn the most per GPU-hour first.
 */
export function yieldRun(p: YieldParams): YieldResult {
  const r = rng(p.seed ?? 21);
  const prod = productivityUnder(p.physics);
  const util: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const revByGpu: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const servedWork: Record<string, number> = {};
  const wanted: Record<string, number> = {};
  const gpuHours = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const w of p.workloads) {
    servedWork[w.id] = 0;
    wanted[w.id] = 0;
    gpuHours[w.id] = { L: 0, A: 0, B: 0 };
  }
  let revenue = 0;
  let powerCost = 0;
  for (let h = 0; h < p.hours; h++) {
    const free: Record<GpuId, number> = { ...p.fleet };
    const protectedB = Math.min(p.protectB, free.B);
    const need: Record<string, number> = {};
    for (const w of p.workloads) {
      const wave = 1 + w.swing * Math.cos((2 * Math.PI * ((h % 24) - 15)) / 24);
      need[w.id] = Math.max(0, w.mean * wave * (1 + 0.08 * gaussian(r)));
      wanted[w.id] += need[w.id];
    }
    const give = (w: YieldWorkload, g: GpuId, maxGpus: number) => {
      const pr = prod[w.id][g];
      if (pr <= 0 || maxGpus <= 0 || need[w.id] <= 1e-9) return;
      const gpus = Math.min(maxGpus, need[w.id] / pr);
      free[g] -= gpus;
      need[w.id] -= gpus * pr;
      servedWork[w.id] += gpus * pr;
      gpuHours[w.id][g] += gpus;
      util[g] += gpus;
      const rev = gpus * pr * w.value;
      revenue += rev;
      revByGpu[g] += rev;
      powerCost += gpus * busyCost(g, p.powerPrice);
    };
    const available = (w: YieldWorkload, g: GpuId) => (g === 'B' && !INTERACTIVE.includes(w.id) ? Math.max(0, free.B - Math.max(0, protectedB - usedProtected())) : free[g]);
    // B-class GPUs already used by interactive work count toward the protected block.
    let interactiveB = 0;
    const usedProtected = () => Math.min(protectedB, interactiveB);
    const giveTracked = (w: YieldWorkload, g: GpuId) => {
      const before = free[g];
      give(w, g, available(w, g));
      if (g === 'B' && INTERACTIVE.includes(w.id)) interactiveB += before - free[g];
    };
    if (p.policy === 'first-come') {
      const order = [...p.workloads];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const w of order) {
        const prefs = [...GPU_IDS].sort((a, b) => prod[w.id][b] - prod[w.id][a]);
        for (const g of prefs) giveTracked(w, g);
      }
    } else {
      const pairs: Array<{ w: YieldWorkload; g: GpuId; per: number }> = [];
      for (const w of p.workloads) for (const g of GPU_IDS) if (prod[w.id][g] > 0) pairs.push({ w, g, per: prod[w.id][g] * w.value - busyCost(g, p.powerPrice) });
      pairs.sort((a, b) => b.per - a.per);
      for (const { w, g, per } of pairs) if (per > 0) giveTracked(w, g);
    }
  }
  const H = Math.max(1, p.hours);
  const served = {} as Record<WorkloadId, number>;
  for (const w of p.workloads) served[w.id] = wanted[w.id] > 0 ? servedWork[w.id] / wanted[w.id] : 1;
  return {
    revenue,
    powerCost,
    margin: revenue - powerCost,
    utilization: { L: util.L / (H * Math.max(1, p.fleet.L)), A: util.A / (H * Math.max(1, p.fleet.A)), B: util.B / (H * Math.max(1, p.fleet.B)) },
    served,
    revenueByGpu: revByGpu,
    gpuHours,
  };
}
