// Which accelerator suits which workload, and how many of them it takes. For a serving workload:
// the best way to split the model over a server's GPUs and the biggest batch that still meets its
// latency limits. For a training workload: the fewest GPUs, split the best way, that finish in time.

import { ACCELERATORS, GPU_IDS, type GpuId } from '../../model/compute/hardware';
import { WORKLOADS, type ServingWorkload, type TrainingWorkload, type Workload, type WorkloadId } from '../../model/compute/workloads';
import { maxBatch, servingPoint, type ServeConfig, type ServingPoint } from './inference';
import { trainingRun, type TrainResult } from './training';

export interface ServeFit {
  kind: 'serve';
  feasible: boolean;
  /** Why not, if infeasible. */
  reason?: string;
  tp: number;
  batch: number;
  point?: ServingPoint;
  /** Output tokens per second per GPU at the chosen point. */
  tokensPerGpuS: number;
  /** GPUs to meet the workload's demand (whole servers' worth of replicas: tp GPUs each). */
  gpus: number;
}

export interface TrainFit {
  kind: 'train';
  feasible: boolean;
  reason?: string;
  tp: number;
  pp: number;
  gpus: number;
  run?: TrainResult;
}

export type Fit = ServeFit | TrainFit;

const TPS = [1, 2, 4, 8];

/** Largest batch whose time per token stays within the limit (time per token grows with the batch). */
function largestBatchWithin(c: ServeConfig, w: ServingWorkload, cap: number): number {
  const ok = (b: number) => {
    const p = servingPoint(c, b, w.input, w.output);
    return p.fits && p.tpot <= w.tpotMax && p.ttft <= w.ttftMax;
  };
  if (cap < 1 || !ok(1)) return 0;
  let lo = 1;
  let hi = cap;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function serveFit(w: ServingWorkload, gpu: GpuId): ServeFit {
  let best: ServeFit | null = null;
  let anyFits = false;
  for (const tp of TPS) {
    const c: ServeConfig = { model: w.model, gpu, tp, precision: w.precision };
    const cap = maxBatch(c, w.input + w.output);
    if (cap < 1) continue;
    anyFits = true;
    const b = largestBatchWithin(c, w, cap);
    if (b < 1) continue;
    const point = servingPoint(c, b, w.input, w.output);
    const replicas = Math.ceil(w.demandTokensPerS / point.tokensPerS);
    const fit: ServeFit = { kind: 'serve', feasible: true, tp, batch: b, point, tokensPerGpuS: point.tokensPerGpuS, gpus: replicas * tp };
    if (!best || fit.gpus < best.gpus || (fit.gpus === best.gpus && fit.tokensPerGpuS > best.tokensPerGpuS)) best = fit;
  }
  if (best) return best;
  return {
    kind: 'serve',
    feasible: false,
    reason: anyFits ? 'Too slow: no split of one server meets its latency limits.' : 'Too big: the model doesn’t fit in one server’s memory.',
    tp: 0,
    batch: 0,
    tokensPerGpuS: 0,
    gpus: Infinity,
  };
}

const PPS = [1, 2, 4, 8];
const MAX_GPUS = 8192;

export function trainFit(w: TrainingWorkload, gpu: GpuId): TrainFit {
  let best: TrainFit | null = null;
  for (const tp of TPS)
    for (const pp of PPS) {
      const group = tp * pp;
      // Smallest data-parallel degree (scanned geometrically, then refined) that meets the deadline.
      const run = (dp: number) => trainingRun({ model: w.model, gpu, gpus: dp * group, tp, pp, batchTokens: w.batchTokens, seqLen: w.seqLen, tokens: w.tokens });
      const ok = (dp: number) => {
        const r = run(dp);
        return r.valid && r.fits && r.days <= w.deadlineDays;
      };
      let dp = 1;
      let prev = 0;
      while (dp * group <= MAX_GPUS && !ok(dp)) {
        prev = dp;
        dp = Math.max(dp + 1, Math.ceil(dp * 1.25));
      }
      if (dp * group > MAX_GPUS) continue;
      for (let d = prev + 1; d < dp; d++)
        if (ok(d)) {
          dp = d;
          break;
        }
      const r = run(dp);
      const fit: TrainFit = { kind: 'train', feasible: true, tp, pp, gpus: dp * group, run: r };
      if (!best || fit.gpus < best.gpus || (fit.gpus === best.gpus && (r.mfu ?? 0) > (best.run?.mfu ?? 0))) best = fit;
    }
  return best ?? { kind: 'train', feasible: false, reason: 'Can’t finish in time on up to 8,192 of these GPUs.', tp: 0, pp: 0, gpus: Infinity };
}

export function fitOf(w: Workload, gpu: GpuId): Fit {
  return w.kind === 'serve' ? serveFit(w, gpu) : trainFit(w, gpu);
}

const cache = new Map<string, Fit>();

/** GPUs a workload needs on an accelerator (memoized; the workloads are fixed). */
export function workloadFit(id: WorkloadId, gpu: GpuId): Fit {
  const key = `${id}|${gpu}`;
  let f = cache.get(key);
  if (!f) {
    f = fitOf(WORKLOADS[id], gpu);
    cache.set(key, f);
  }
  return f;
}

/** The whole table: every workload on every accelerator. */
export function fitTable(ids: WorkloadId[]): Record<WorkloadId, Record<GpuId, Fit>> {
  const out = {} as Record<WorkloadId, Record<GpuId, Fit>>;
  for (const id of ids) {
    out[id] = {} as Record<GpuId, Fit>;
    for (const g of GPU_IDS) out[id][g] = workloadFit(id, g);
  }
  return out;
}

export interface AssignmentResult {
  used: Record<GpuId, number>;
  /** Every workload has a feasible accelerator and every accelerator's count is within the fleet. */
  feasible: boolean;
  overBy: Record<GpuId, number>;
  infeasible: WorkloadId[];
  /** Board power of the GPUs used, kW (a simple tiebreak between feasible assignments). */
  powerKW: number;
}

/** Check an assignment of workloads to accelerators against a fleet. */
export function checkAssignment(assign: Partial<Record<WorkloadId, GpuId>>, fleet: Record<GpuId, number>): AssignmentResult {
  const used: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const infeasible: WorkloadId[] = [];
  let powerKW = 0;
  for (const [id, g] of Object.entries(assign) as Array<[WorkloadId, GpuId]>) {
    const f = workloadFit(id, g);
    if (!f.feasible) {
      infeasible.push(id);
      continue;
    }
    used[g] += f.gpus;
    powerKW += (f.gpus * ACCELERATORS[g].tdpW) / 1000;
  }
  const overBy: Record<GpuId, number> = { L: Math.max(0, used.L - fleet.L), A: Math.max(0, used.A - fleet.A), B: Math.max(0, used.B - fleet.B) };
  const feasible = infeasible.length === 0 && overBy.L + overBy.A + overBy.B === 0;
  return { used, feasible, overBy, infeasible, powerKW };
}

/** Every feasible assignment of the given workloads to a fleet (3^n combinations). */
export function feasibleAssignments(ids: WorkloadId[], fleet: Record<GpuId, number>): Array<Record<WorkloadId, GpuId>> {
  const out: Array<Record<WorkloadId, GpuId>> = [];
  const rec = (i: number, cur: Partial<Record<WorkloadId, GpuId>>) => {
    if (i === ids.length) {
      if (checkAssignment(cur, fleet).feasible) out.push({ ...cur } as Record<WorkloadId, GpuId>);
      return;
    }
    for (const g of GPU_IDS) rec(i + 1, { ...cur, [ids[i]]: g });
  };
  rec(0, {});
  return out;
}
