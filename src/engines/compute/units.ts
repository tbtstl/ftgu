// What is a unit of compute? A GPU-hour is what clouds sell, but buyers want FLOPs done, tokens
// written or a model trained, and the same hour yields very different amounts of each on different
// hardware. Converting prices into each unit shows why a GPU-hour alone is a poor yardstick.

import { ACCELERATORS, GPU_IDS, type GpuId } from '../../model/compute/hardware';
import { PRICES } from '../../model/compute/prices';
import type { WorkloadId } from '../../model/compute/workloads';
import { workloadFit } from './compatibility';

export type Unit = 'gpuHour' | 'peakPflop' | 'usefulPflop' | 'mTokens' | 'run';

export interface UnitCost {
  gpu: GpuId;
  /** Price of one GPU-hour, $. */
  gpuHour: number;
  /** $ per PFLOP-hour of peak BF16 arithmetic (one quadrillion operations a second for an hour). */
  peakPflop: number;
  /** $ per PFLOP-hour the workload actually uses (peak × the share it reaches). */
  usefulPflop: number;
  /** $ per million output tokens (serving workloads). */
  mTokens: number;
  /** $ for the whole job (training workloads): GPU-hours × price. */
  run: number;
  /** Share of peak arithmetic the workload reaches on this accelerator. */
  utilization: number;
  feasible: boolean;
}

/** Cost of a workload in every unit on one accelerator, at a $/GPU-hour price (defaults to on-demand). */
export function unitCost(id: WorkloadId, gpu: GpuId, pricePerHour = PRICES[gpu].onDemand): UnitCost {
  const g = ACCELERATORS[gpu];
  const peakPflops = g.bf16Tflops / 1000;
  const f = workloadFit(id, gpu);
  const base = { gpu, gpuHour: pricePerHour, peakPflop: pricePerHour / peakPflops };
  if (!f.feasible) return { ...base, usefulPflop: Infinity, mTokens: Infinity, run: Infinity, utilization: 0, feasible: false };
  if (f.kind === 'serve') {
    const tokPerGpuHour = f.tokensPerGpuS * 3600;
    const util = f.point?.utilization ?? 0;
    return {
      ...base,
      usefulPflop: util > 0 ? pricePerHour / (peakPflops * util) : Infinity,
      mTokens: (pricePerHour * 1e6) / tokPerGpuHour,
      run: Infinity,
      utilization: util,
      feasible: true,
    };
  }
  // Training uses the deadline-sized cluster of Lesson 3.5; the run's GPU-hours are fixed by it.
  const r = f.run!;
  return { ...base, usefulPflop: pricePerHour / (peakPflops * r.mfu), mTokens: Infinity, run: r.gpuHours * pricePerHour, utilization: r.mfu, feasible: true };
}

/** The cheapest accelerator for a workload in a given unit, and every accelerator's figure. */
export function cheapestBy(id: WorkloadId, unit: Unit, prices: Record<GpuId, number> = { L: PRICES.L.onDemand, A: PRICES.A.onDemand, B: PRICES.B.onDemand }) {
  const rows = GPU_IDS.map((g) => unitCost(id, g, prices[g]));
  const best = rows.filter((r) => r.feasible || unit === 'gpuHour' || unit === 'peakPflop').reduce((a, b) => (b[unit] < a[unit] ? b : a));
  return { rows, best: best.gpu };
}
