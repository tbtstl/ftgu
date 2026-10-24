// How a GPU runs a program: threads in warps of 32, warps in blocks, blocks spread over the
// streaming multiprocessors (SMs). Two things decide how busy the arithmetic stays: whether each
// SM holds enough warps to hide the long wait for memory (occupancy), and whether the blocks divide
// evenly over the SMs (waves). Numbers are the A-class SM's (SM_LIMITS).

import { ACCELERATORS, SM_LIMITS } from '../../model/compute/hardware';

export interface KernelShape {
  threadsPerBlock: number;
  /** 32-bit registers each thread needs. */
  regsPerThread: number;
  /** Shared memory each block needs, KB. */
  sharedKBPerBlock: number;
}

export type OccupancyLimit = 'threads' | 'registers' | 'shared memory' | 'blocks';

export interface Occupancy {
  blocksPerSM: number;
  warpsPerSM: number;
  /** Warps per scheduler (each SM has four schedulers). */
  warpsPerScheduler: number;
  /** Resident warps as a share of the most an SM can hold (64). */
  occupancy: number;
  /** The resource that ran out first. */
  limit: OccupancyLimit;
  /** Blocks each resource alone would allow. */
  byLimit: Record<OccupancyLimit, number>;
}

export const MAX_WARPS_PER_SM = SM_LIMITS.maxThreads / SM_LIMITS.warpSize;

/** How many blocks of a kernel fit on one SM at once, and why no more. */
export function occupancy(k: KernelShape): Occupancy {
  const warpsPerBlock = Math.ceil(k.threadsPerBlock / SM_LIMITS.warpSize);
  const byLimit: Record<OccupancyLimit, number> = {
    threads: Math.floor(SM_LIMITS.maxThreads / (warpsPerBlock * SM_LIMITS.warpSize)),
    registers: Math.floor(SM_LIMITS.registers / (k.regsPerThread * warpsPerBlock * SM_LIMITS.warpSize)),
    'shared memory': k.sharedKBPerBlock > 0 ? Math.floor(SM_LIMITS.sharedKB / k.sharedKBPerBlock) : Infinity,
    blocks: SM_LIMITS.maxBlocks,
  };
  const order: OccupancyLimit[] = ['registers', 'shared memory', 'threads', 'blocks'];
  let limit: OccupancyLimit = 'blocks';
  let blocksPerSM = Infinity;
  for (const l of order) {
    if (byLimit[l] < blocksPerSM) {
      blocksPerSM = byLimit[l];
      limit = l;
    }
  }
  blocksPerSM = Math.max(0, blocksPerSM);
  const warpsPerSM = blocksPerSM * warpsPerBlock;
  return { blocksPerSM, warpsPerSM, warpsPerScheduler: warpsPerSM / SM_LIMITS.schedulers, occupancy: warpsPerSM / MAX_WARPS_PER_SM, limit, byLimit };
}

/**
 * Share of cycles a scheduler issues an instruction, in steady state, when each warp alternates
 * `computeCycles` of arithmetic with a memory load that takes `latency` cycles to return. With w
 * warps to choose from it can cover the wait as long as w × compute ≥ compute + latency.
 */
export function issueUtilization(warps: number, computeCycles: number, latency: number = SM_LIMITS.memLatencyCycles): number {
  if (warps <= 0) return 0;
  return Math.min(1, (warps * computeCycles) / (computeCycles + latency));
}

/** Warps per scheduler needed to hide the memory latency completely. */
export function warpsToHide(computeCycles: number, latency: number = SM_LIMITS.memLatencyCycles): number {
  return Math.ceil((computeCycles + latency) / computeCycles);
}

export interface Segment {
  warp: number;
  start: number;
  end: number;
  kind: 'compute' | 'wait';
}

/**
 * A cycle-level picture of one scheduler: each warp computes for `computeCycles` (only one warp can
 * issue at a time), then waits `latency` cycles for memory, and repeats. The scheduler always
 * picks the warp that has been ready longest. Returns the segments up to `horizon` cycles and the
 * share of cycles spent issuing.
 */
export function warpTimeline(warps: number, computeCycles: number, latency: number, horizon: number): { segments: Segment[]; busy: number } {
  const ready = Array.from({ length: warps }, () => 0);
  const segments: Segment[] = [];
  let t = 0;
  let busyCycles = 0;
  while (t < horizon && warps > 0) {
    // The warp that became ready earliest (ties: lowest index).
    let w = 0;
    for (let i = 1; i < warps; i++) if (ready[i] < ready[w]) w = i;
    const start = Math.max(t, ready[w]);
    if (start >= horizon) break;
    const end = start + computeCycles;
    segments.push({ warp: w, start, end: Math.min(end, horizon), kind: 'compute' });
    busyCycles += Math.min(end, horizon) - start;
    if (end < horizon) segments.push({ warp: w, start: end, end: Math.min(end + latency, horizon), kind: 'wait' });
    ready[w] = end + latency;
    t = end;
  }
  return { segments, busy: horizon > 0 ? busyCycles / horizon : 0 };
}

export interface WaveResult {
  /** Blocks the whole GPU holds at once. */
  slots: number;
  waves: number;
  /** Blocks in the last wave. */
  lastWave: number;
  /** Share of block slots doing work, averaged over the run. */
  utilization: number;
  /** Run time in units of one block's time. */
  time: number;
}

/** Blocks spread over every SM in waves: the last wave may leave most of the GPU idle. */
export function waves(blocks: number, blocksPerSM: number, sms: number = ACCELERATORS.A.sms): WaveResult {
  const slots = Math.max(1, blocksPerSM * sms);
  const n = Math.max(0, Math.round(blocks));
  const w = Math.ceil(n / slots);
  const lastWave = n === 0 ? 0 : n - (w - 1) * slots;
  return { slots, waves: w, lastWave, utilization: w > 0 ? n / (w * slots) : 0, time: w };
}
