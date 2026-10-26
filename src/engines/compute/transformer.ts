// What one layer of a language model computes, operation by operation: the matrix multiplies that
// hold nearly all of its arithmetic, the attention that reads every earlier token's keys and
// values, and the small elementwise steps between them. Each operation is timed with the roofline,
// so the breakdown shows which are limited by arithmetic and which by memory.

import { kvDim, type ModelConfig } from '../../model/compute/models';
import type { Accelerator } from '../../model/compute/hardware';
import { kernelTime, type KernelTime, type Precision } from './roofline';

export type OpKind = 'matmul' | 'attention' | 'elementwise';

export interface LayerOp {
  id: string;
  name: string;
  kind: OpKind;
  flops: number;
  /** Weight bytes read. */
  weightBytes: number;
  /** Activations read and written. */
  activationBytes: number;
  /** Key/value cache read and written. */
  kvBytes: number;
}

export interface OpTimed extends LayerOp, KernelTime {
  bytes: number;
}

/**
 * The operations of one transformer layer when `tokens` new tokens pass through it together,
 * each attending to `context` tokens (its own and earlier ones, whose keys and values are cached).
 * Prefill: tokens = the prompt, context ≈ tokens. Decoding a batch: tokens = batch size, context = text so far.
 */
export function layerOps(m: ModelConfig, tokens: number, context: number, precision: Precision = 'bf16'): LayerOp[] {
  const b = precision === 'fp8' ? 1 : 2;
  const d = m.d;
  const kv = kvDim(m);
  const act = (inW: number, outW: number) => b * tokens * (inW + outW);
  const mm = (id: string, name: string, dIn: number, dOut: number): LayerOp => ({
    id,
    name,
    kind: 'matmul',
    flops: 2 * tokens * dIn * dOut,
    weightBytes: b * dIn * dOut,
    activationBytes: act(dIn, dOut),
    kvBytes: 0,
  });
  return [
    { id: 'norm1', name: 'Normalize', kind: 'elementwise', flops: 4 * tokens * d, weightBytes: b * d, activationBytes: act(d, d), kvBytes: 0 },
    mm('qkv', 'Query, key, value projections', d, d + 2 * kv),
    {
      id: 'attn',
      name: 'Attention over the context',
      kind: 'attention',
      flops: 4 * tokens * context * d,
      weightBytes: 0,
      activationBytes: act(2 * d, 0),
      // Read every cached key and value once; write this pass's new ones (BF16 cache).
      kvBytes: 2 * kv * 2 * (context + tokens),
    },
    mm('out', 'Output projection', d, d),
    { id: 'norm2', name: 'Normalize and add', kind: 'elementwise', flops: 6 * tokens * d, weightBytes: b * d, activationBytes: act(2 * d, d), kvBytes: 0 },
    mm('up', 'Feed-forward up (gate and up)', d, 2 * m.ffn),
    { id: 'act', name: 'Activation function', kind: 'elementwise', flops: 5 * tokens * m.ffn, weightBytes: 0, activationBytes: act(2 * m.ffn, m.ffn), kvBytes: 0 },
    mm('down', 'Feed-forward down', m.ffn, d),
  ];
}

/** The output projection to the vocabulary, once per pass (after the last layer). */
export function headOp(m: ModelConfig, tokens: number, precision: Precision = 'bf16'): LayerOp {
  const b = precision === 'fp8' ? 1 : 2;
  return { id: 'head', name: 'Vocabulary projection', kind: 'matmul', flops: 2 * tokens * m.d * m.vocab, weightBytes: b * m.d * m.vocab, activationBytes: b * tokens * (m.d + m.vocab), kvBytes: 0 };
}

/** Time each operation of a layer on one accelerator (the whole layer on one GPU). */
export function timeOps(ops: LayerOp[], g: Accelerator, precision: Precision = 'bf16'): OpTimed[] {
  return ops.map((o) => {
    const bytes = o.weightBytes + o.activationBytes + o.kvBytes;
    return { ...o, bytes, ...kernelTime(o.flops, bytes, g, precision) };
  });
}

export interface PassSummary {
  ops: OpTimed[];
  /** One layer. */
  layerFlops: number;
  layerBytes: number;
  layerS: number;
  /** The whole model: every layer plus the vocabulary projection. */
  totalFlops: number;
  totalBytes: number;
  totalS: number;
  /** Share of the arithmetic in matrix multiplies (including the vocabulary projection). */
  matmulShare: number;
  /** Share of the layer's time limited by memory. */
  memoryBoundShare: number;
}

/** A full forward pass of `tokens` tokens through the model on one accelerator (idealized: every op at its roofline). */
export function forwardPass(m: ModelConfig, tokens: number, context: number, g: Accelerator, precision: Precision = 'bf16'): PassSummary {
  const ops = timeOps(layerOps(m, tokens, context, precision), g, precision);
  const head = timeOps([headOp(m, tokens, precision)], g, precision)[0];
  const layerFlops = ops.reduce((s, o) => s + o.flops, 0);
  const layerBytes = ops.reduce((s, o) => s + o.bytes, 0);
  const layerS = ops.reduce((s, o) => s + o.totalS, 0);
  const totalFlops = m.layers * layerFlops + head.flops;
  const matmulFlops = m.layers * ops.filter((o) => o.kind === 'matmul').reduce((s, o) => s + o.flops, 0) + head.flops;
  const memS = ops.filter((o) => o.bound === 'memory').reduce((s, o) => s + o.totalS, 0);
  return {
    ops,
    layerFlops,
    layerBytes,
    layerS,
    totalFlops,
    totalBytes: m.layers * layerBytes + head.bytes,
    totalS: m.layers * layerS + head.totalS,
    matmulShare: matmulFlops / totalFlops,
    memoryBoundShare: layerS > 0 ? memS / layerS : 0,
  };
}
