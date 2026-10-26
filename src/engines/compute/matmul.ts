// Matrix multiplication, the operation AI hardware is built around. C (m × n) = A (m × k) × B (k × n)
// takes 2·m·n·k FLOPs. How many bytes it must move depends on how much of A and B can be kept close
// to the arithmetic and reused: tiles in each SM's registers and shared memory, and neighboring
// tiles sharing what they read through the L2 cache.

import { SM_LIMITS, type Accelerator } from '../../model/compute/hardware';
import { kernelTime, type KernelTime, type Precision } from './roofline';

export interface MatmulShape {
  m: number;
  n: number;
  k: number;
}

export function matmulFlops(s: MatmulShape): number {
  return 2 * s.m * s.n * s.k;
}

/** The least any implementation can move: read A and B once, write C once. */
export function compulsoryBytes(s: MatmulShape, bytesPerValue = 2): number {
  return bytesPerValue * (s.m * s.k + s.k * s.n + s.m * s.n);
}

/**
 * Bytes read and written when C is computed in square tiles of side `tile`, with `group` × `group`
 * neighboring tiles sharing their reads (1 = no sharing). Each strip of A is read once for every
 * column of tile groups, each strip of B once for every row; C is written once. tile = 1 and
 * group = 1 is the naive loop that fetches both operands for every multiply-add.
 */
export function tiledBytes(s: MatmulShape, tile: number, group = 1, bytesPerValue = 2): number {
  const span = Math.max(1, tile * group);
  return bytesPerValue * (s.m * s.k * Math.ceil(s.n / span) + s.k * s.n * Math.ceil(s.m / span) + s.m * s.n);
}

/** Depth of the slice of A and B a tile loads at a time. */
export const K_SLICE = 64;
/** Share of the register file the accumulators may use; the rest holds addresses, loop counters and so on. */
export const ACCUMULATOR_SHARE = 0.5;

export interface TileFit {
  /** Accumulators for the tile's partial sums (FP32), KB. */
  accumulatorKB: number;
  /** Double-buffered slices of A and B in shared memory, KB. */
  sharedKB: number;
  registerBudgetKB: number;
  sharedBudgetKB: number;
  fits: boolean;
}

/** Whether a square tile fits on one SM: FP32 accumulators in registers, operand slices in shared memory. */
export function tileFit(tile: number, bytesPerValue = 2): TileFit {
  const accumulatorKB = (tile * tile * 4) / 1024;
  const sharedKB = (2 * 2 * tile * K_SLICE * bytesPerValue) / 1024;
  const registerBudgetKB = ((SM_LIMITS.registers * 4) / 1024) * ACCUMULATOR_SHARE;
  const sharedBudgetKB = SM_LIMITS.sharedKB;
  return { accumulatorKB, sharedKB, registerBudgetKB, sharedBudgetKB, fits: accumulatorKB <= registerBudgetKB && sharedKB <= sharedBudgetKB };
}

/** Largest power-of-two square tile that fits on an SM. */
export function largestTile(bytesPerValue = 2): number {
  let t = 1;
  while (tileFit(t * 2, bytesPerValue).fits) t *= 2;
  return t;
}

/** A tiled matrix multiply timed on an accelerator with the roofline. */
export function tiledMatmul(s: MatmulShape, g: Accelerator, tile: number, group = 1, precision: Precision = 'bf16'): KernelTime & { flops: number; bytes: number } {
  const bytesPerValue = precision === 'fp8' ? 1 : 2;
  const flops = matmulFlops(s);
  const bytes = tiledBytes(s, tile, group, bytesPerValue);
  return { flops, bytes, ...kernelTime(flops, bytes, g, precision) };
}

/**
 * A weight matrix (dOut × dIn) applied to a batch of input vectors: what every layer of a language
 * model does to the tokens passing through it. The weights must be read once whatever the batch;
 * the arithmetic grows with the batch, so the intensity is about the batch size (FLOP per byte, BF16).
 */
export function batchedMatmul(dIn: number, dOut: number, batch: number, g: Accelerator, precision: Precision = 'bf16') {
  const b = precision === 'fp8' ? 1 : 2;
  const flops = 2 * dIn * dOut * batch;
  const weightBytes = b * dIn * dOut;
  const activationBytes = b * batch * (dIn + dOut);
  const bytes = weightBytes + activationBytes;
  return { flops, weightBytes, activationBytes, bytes, ...kernelTime(flops, bytes, g, precision) };
}
