// The roofline model: a kernel needs some arithmetic and some memory traffic, and runs no faster
// than the slower of the two allows. Its arithmetic intensity — FLOPs per byte moved — decides
// which wall it hits. A cache in between can serve repeated reads, so less traffic reaches the
// main memory when the kernel's working set fits.

import type { Accelerator } from '../../model/compute/hardware';

export type Precision = 'bf16' | 'fp8';

/** Peak tensor throughput of an accelerator at a precision, FLOP/s. */
export function peakFlops(g: Accelerator, precision: Precision = 'bf16'): number {
  return (precision === 'fp8' ? g.fp8Tflops : g.bf16Tflops) * 1e12;
}

/** Attainable throughput at an arithmetic intensity (FLOP/byte): min(peak, bandwidth × intensity), TFLOPS. */
export function attainableTflops(intensity: number, peakTflops: number, bandwidthTBs: number): number {
  return Math.min(peakTflops, bandwidthTBs * intensity);
}

export interface KernelTime {
  computeS: number;
  memoryS: number;
  totalS: number;
  bound: 'compute' | 'memory';
  /** Achieved throughput, TFLOPS. */
  tflops: number;
  /** FLOPs per byte of main-memory traffic. */
  intensity: number;
}

/** Time for a kernel with the given FLOPs and main-memory bytes on an accelerator (no overlap penalty). */
export function kernelTime(flops: number, bytes: number, g: Accelerator, precision: Precision = 'bf16'): KernelTime {
  const computeS = flops / peakFlops(g, precision);
  const memoryS = bytes / (g.bandwidthTBs * 1e12);
  const totalS = Math.max(computeS, memoryS);
  return { computeS, memoryS, totalS, bound: computeS >= memoryS ? 'compute' : 'memory', tflops: totalS > 0 ? flops / totalS / 1e12 : 0, intensity: bytes > 0 ? flops / bytes : Infinity };
}

export interface CachedKernel {
  /** Floating-point operations. */
  flops: number;
  /** Distinct bytes the kernel touches (its working set). */
  workingSetBytes: number;
  /** How many times the kernel reads its working set in all. */
  passes: number;
}

export interface MachineSpec {
  peakTflops: number;
  /** Main (HBM or DRAM) bandwidth, TB/s. */
  bandwidthTBs: number;
  /** Cache size, MB (0 = none). */
  cacheMB: number;
  /** Cache bandwidth, TB/s. */
  cacheTBs: number;
}

export interface CachedResult {
  /** Bytes that came from main memory. */
  memoryBytes: number;
  /** Bytes served by the cache. */
  cacheBytes: number;
  /** Share of reads after the first pass that hit in cache. */
  hitRate: number;
  computeS: number;
  memoryS: number;
  cacheS: number;
  totalS: number;
  bound: 'compute' | 'memory' | 'cache';
  tflops: number;
  /** FLOPs per byte of main-memory traffic, after the cache. */
  intensity: number;
}

/**
 * A kernel that reads its working set `passes` times. The first pass must come from main memory;
 * later passes hit in the cache if the working set fits, and otherwise only the share of it the
 * cache can hold (a simplification: real access patterns can do better or much worse).
 */
export function cachedKernel(k: CachedKernel, m: MachineSpec): CachedResult {
  const ws = k.workingSetBytes;
  const cache = m.cacheMB * 1e6;
  const hitRate = ws <= 0 ? 0 : ws <= cache ? 1 : cache / ws;
  const repeat = ws * Math.max(0, k.passes - 1);
  const memoryBytes = ws + repeat * (1 - hitRate);
  const cacheBytes = repeat * hitRate;
  const computeS = k.flops / (m.peakTflops * 1e12);
  const memoryS = memoryBytes / (m.bandwidthTBs * 1e12);
  const cacheS = m.cacheTBs > 0 ? cacheBytes / (m.cacheTBs * 1e12) : 0;
  const totalS = Math.max(computeS, memoryS, cacheS);
  const bound = totalS === computeS ? 'compute' : totalS === memoryS ? 'memory' : 'cache';
  return { memoryBytes, cacheBytes, hitRate, computeS, memoryS, cacheS, totalS, bound, tflops: totalS > 0 ? k.flops / totalS / 1e12 : 0, intensity: memoryBytes > 0 ? k.flops / memoryBytes : Infinity };
}

/** The machine spec of an accelerator at a precision. */
export function machineOf(g: Accelerator, precision: Precision = 'bf16'): MachineSpec {
  return { peakTflops: precision === 'fp8' ? g.fp8Tflops : g.bf16Tflops, bandwidthTBs: g.bandwidthTBs, cacheMB: g.l2MB, cacheTBs: g.l2TBs };
}

export interface NamedKernel {
  id: string;
  name: string;
  /** FLOPs per byte of data it reads or writes once (its intensity with no reuse). */
  intensity: number;
  note: string;
}

/**
 * Typical kernels in a language model, by arithmetic intensity at BF16 (2 bytes per number),
 * for placing on the roofline. Matrix multiplies are given at the intensities the next lessons derive.
 */
export const KERNELS: NamedKernel[] = [
  { id: 'add', name: 'Elementwise add', intensity: 1 / 6, note: 'one addition per two numbers read and one written' },
  { id: 'norm', name: 'Normalization', intensity: 1, note: 'a handful of operations per number' },
  { id: 'gemv', name: 'Matrix × vector (batch 1)', intensity: 1, note: 'each 2-byte weight used for one multiply-add' },
  { id: 'gemm64', name: 'Matrix × 64 vectors', intensity: 64, note: 'each weight used 64 times' },
  { id: 'gemm', name: 'Large matrix multiply (8,192 square)', intensity: 8192 / 3, note: 'at best, each matrix read or written once' },
];
