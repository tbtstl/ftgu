// A processor built for one fast thread against one built for thousands of slow ones. A task is N
// identical, independent work items plus a share that must run one step after another; each
// processor has some number of arithmetic lanes, a clock, a speed for serial code, and a fixed
// cost to start the work (and, for a GPU, to copy the data across to its own memory).

import { ACCELERATORS, GPU_SERIAL_GOPS, HOST_CPU } from '../../model/compute/hardware';

export interface Processor {
  id: 'cpu' | 'gpu';
  name: string;
  /** Arithmetic lanes that can each work on a different item at once. */
  lanes: number;
  clockGHz: number;
  /** Floating-point operations per lane per cycle (a fused multiply-add counts as two). */
  flopsPerLaneCycle: number;
  /** Speed of one thread running serial, dependent code, billion operations per second. */
  serialGops: number;
  /** Fixed cost to start parallel work and wait for it to finish, µs. */
  launchUs: number;
  /** Bandwidth for moving the task's data to where the processor can use it, GB/s (Infinity: already there). */
  copyGBs: number;
}

/** The host CPU: 64 cores, each with 32 FP32 lanes (two 16-wide fused multiply-add units), at 3.0 GHz. */
export const CPU: Processor = {
  id: 'cpu',
  name: HOST_CPU.name,
  lanes: HOST_CPU.cores * (HOST_CPU.fp32FlopsPerCycle / 2),
  clockGHz: HOST_CPU.clockGHz,
  flopsPerLaneCycle: 2,
  serialGops: HOST_CPU.serialGops,
  launchUs: 5,
  copyGBs: Infinity,
};

/** The A-class GPU's ordinary FP32 lanes: 132 SMs × 128 lanes at 1.98 GHz, across a PCIe link from the host. */
export const GPU: Processor = {
  id: 'gpu',
  name: ACCELERATORS.A.name,
  lanes: ACCELERATORS.A.sms * 128,
  clockGHz: ACCELERATORS.A.clockGHz,
  flopsPerLaneCycle: 2,
  serialGops: GPU_SERIAL_GOPS,
  launchUs: 10,
  copyGBs: 50,
};

/** Peak throughput, TFLOPS. */
export function peakTflops(p: Processor): number {
  return (p.lanes * p.clockGHz * p.flopsPerLaneCycle) / 1000;
}

export interface Task {
  /** Independent work items. */
  items: number;
  /** Floating-point operations per item. */
  flopsPerItem: number;
  /** Share of the total work that can't be split up and must run on one thread (0–1). */
  serialShare: number;
  /** Bytes per item that must be copied to the processor and back (0 if none). */
  bytesPerItem: number;
  /** Threads the program launches (≤ 0 means one per item). */
  threads?: number;
}

export interface RunResult {
  overheadS: number;
  copyS: number;
  serialS: number;
  parallelS: number;
  totalS: number;
  /** Lanes kept busy during the parallel part, 0–1. */
  utilization: number;
  /** Rounds of items the lanes work through. */
  waves: number;
  /** Achieved rate over the whole run, GFLOPS. */
  gflops: number;
}

/**
 * Time for a processor to run a task. The parallel part goes in waves: each round, every busy lane
 * finishes one item. Fewer items (or threads) than lanes leaves lanes idle; the last wave may be
 * partly empty.
 */
export function runTask(p: Processor, t: Task): RunResult {
  const items = Math.max(0, Math.round(t.items));
  const totalFlops = items * t.flopsPerItem;
  const serialFlops = totalFlops * t.serialShare;
  const parallelItems = items * (1 - t.serialShare);
  const threads = t.threads && t.threads > 0 ? t.threads : Infinity;
  const active = Math.max(1, Math.min(p.lanes, threads, Math.ceil(parallelItems) || 1));
  const waves = parallelItems > 0 ? Math.ceil(parallelItems / active - 1e-9) : 0;
  const itemS = t.flopsPerItem / (p.flopsPerLaneCycle * p.clockGHz * 1e9);
  const parallelS = waves * itemS;
  const serialS = serialFlops / (p.serialGops * 1e9);
  const overheadS = items > 0 ? p.launchUs * 1e-6 : 0;
  const copyS = Number.isFinite(p.copyGBs) ? (items * t.bytesPerItem) / (p.copyGBs * 1e9) : 0;
  const totalS = overheadS + copyS + serialS + parallelS;
  const utilization = waves > 0 ? parallelItems / (waves * p.lanes) : 0;
  return { overheadS, copyS, serialS, parallelS, totalS, utilization, waves, gflops: totalS > 0 ? totalFlops / totalS / 1e9 : 0 };
}

/** Amdahl's law: speedup from p workers when a share s of the work is serial. */
export function amdahl(serialShare: number, workers: number): number {
  return 1 / (serialShare + (1 - serialShare) / workers);
}

/** Smallest number of items (searched over powers of 2 and in between) at which the GPU beats the CPU, or Infinity. */
export function crossoverItems(t: Omit<Task, 'items'>, max = 2 ** 34): number {
  const faster = (n: number) => runTask(GPU, { ...t, items: n }).totalS < runTask(CPU, { ...t, items: n }).totalS;
  let lo = 1;
  if (faster(lo)) return 1;
  let hi = 2;
  while (hi <= max && !faster(hi)) {
    lo = hi;
    hi *= 2;
  }
  if (hi > max) return Infinity;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (faster(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
