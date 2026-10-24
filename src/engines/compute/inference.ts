// Serving a language model: the weights split over `tp` GPUs of one server (tensor parallelism),
// a prompt processed in one compute-heavy pass (prefill), then the reply produced one token per
// step for every request in the batch at once (decode). Memory decides how many requests fit;
// bandwidth decides how fast each step goes; the batch decides how many tokens each step yields.

import { ACCELERATORS, type Accelerator, type GpuId } from '../../model/compute/hardware';
import { MODELS, kvBytesPerToken, matmulParams, paramCount, type ModelConfig, type ModelId } from '../../model/compute/models';
import { ringAllReduce, scaleUpLink } from './collectives';
import { peakFlops, type Precision } from './roofline';

/** Share of peak arithmetic a well-tuned serving engine reaches on large matrix multiplies. */
export const COMPUTE_EFFICIENCY = 0.7;
/** Share of peak memory bandwidth it reaches when streaming weights and cache. */
export const BANDWIDTH_EFFICIENCY = 0.8;
/** Share of GPU memory left for weights and the key/value cache (the rest: activations, runtime). */
export const USABLE_MEMORY = 0.9;

export interface ServeConfig {
  model: ModelId;
  gpu: GpuId;
  /** GPUs the model is split across, within one server (1, 2, 4 or 8). */
  tp: number;
  /** Precision of the weights. The key/value cache stays BF16. */
  precision: Precision;
}

export interface MemoryPlan {
  /** Usable memory across the GPUs, bytes. */
  usableBytes: number;
  weightBytes: number;
  /** Room left for the key/value cache, bytes (negative if the weights don't fit). */
  kvBytes: number;
  /** Tokens of context the cache can hold across all requests. */
  kvTokens: number;
  fits: boolean;
}

function modelOf(id: ModelId): ModelConfig {
  return MODELS[id];
}

export function weightBytes(model: ModelId, precision: Precision): number {
  return paramCount(modelOf(model)) * (precision === 'fp8' ? 1 : 2);
}

/** How the memory of `tp` GPUs is shared between weights and cache. */
export function memoryPlan(c: ServeConfig): MemoryPlan {
  const g = ACCELERATORS[c.gpu];
  const usableBytes = c.tp * g.memoryGB * 1e9 * USABLE_MEMORY;
  const w = weightBytes(c.model, c.precision);
  const kv = usableBytes - w;
  const per = kvBytesPerToken(modelOf(c.model));
  return { usableBytes, weightBytes: w, kvBytes: kv, kvTokens: kv > 0 ? Math.floor(kv / per) : 0, fits: kv > 0 };
}

/** Most requests that fit at once if each holds `tokensPerRequest` tokens of context at its longest. */
export function maxBatch(c: ServeConfig, tokensPerRequest: number): number {
  const p = memoryPlan(c);
  return p.fits ? Math.floor(p.kvTokens / Math.max(1, tokensPerRequest)) : 0;
}

/** Time for the GPUs to exchange partial results within each layer: two all-reduces of the batch's activations. */
export function tensorParallelS(c: ServeConfig, tokens: number): number {
  if (c.tp <= 1) return 0;
  const m = modelOf(c.model);
  const msg = tokens * m.d * 2;
  return 2 * m.layers * ringAllReduce(msg, c.tp, scaleUpLink(c.gpu)).seconds;
}

export interface StepTime {
  computeS: number;
  memoryS: number;
  commS: number;
  seconds: number;
  bound: 'compute' | 'memory';
  flops: number;
  bytes: number;
}

/**
 * One decode step for `batch` requests whose contexts average `context` tokens: every weight is
 * read once (shared by the batch), every request's cached keys and values are read, and each
 * request gains one token.
 */
export function decodeStep(c: ServeConfig, batch: number, context: number): StepTime {
  const m = modelOf(c.model);
  const g = ACCELERATORS[c.gpu];
  const flops = batch * (2 * matmulParams(m) + 4 * m.layers * context * m.d);
  const bytes = weightBytes(c.model, c.precision) + batch * context * kvBytesPerToken(m);
  const computeS = flops / (c.tp * peakFlops(g, c.precision) * COMPUTE_EFFICIENCY);
  const memoryS = bytes / (c.tp * g.bandwidthTBs * 1e12 * BANDWIDTH_EFFICIENCY);
  const commS = tensorParallelS(c, batch);
  return { computeS, memoryS, commS, seconds: Math.max(computeS, memoryS) + commS, bound: computeS >= memoryS ? 'compute' : 'memory', flops, bytes };
}

/** Time to process a prompt of `tokens` tokens in one pass (attention grows with the square of its length). */
export function prefillS(c: ServeConfig, tokens: number): number {
  const m = modelOf(c.model);
  const g = ACCELERATORS[c.gpu];
  const flops = tokens * 2 * matmulParams(m) + 2 * m.layers * tokens * tokens * m.d;
  const computeS = flops / (c.tp * peakFlops(g, c.precision) * COMPUTE_EFFICIENCY);
  const memoryS = weightBytes(c.model, c.precision) / (c.tp * g.bandwidthTBs * 1e12 * BANDWIDTH_EFFICIENCY);
  return Math.max(computeS, memoryS) + tensorParallelS(c, tokens);
}

export interface ServingPoint {
  fits: boolean;
  /** Batch actually run (capped by memory). */
  batch: number;
  maxBatch: number;
  step: StepTime;
  /** Time per output token seen by each user, s. */
  tpot: number;
  /** Time to first token for a request arriving at an idle server, s. */
  ttft: number;
  /** Output tokens per second across the whole batch. */
  tokensPerS: number;
  tokensPerGpuS: number;
  /** GPU-hours to produce a million output tokens. */
  gpuHoursPerMTokens: number;
  /** Achieved share of the GPUs' peak arithmetic during decoding. */
  utilization: number;
}

/**
 * Steady decoding with `batch` requests, each with an `input`-token prompt and an `output`-token
 * reply. The average context during a reply is the prompt plus half the reply. Prefill time is
 * amortized into the cost per token.
 */
export function servingPoint(c: ServeConfig, batch: number, input: number, output: number): ServingPoint {
  const mb = maxBatch(c, input + output);
  const b = Math.max(0, Math.min(batch, mb));
  const g = ACCELERATORS[c.gpu];
  if (b < 1) {
    const step = decodeStep(c, 1, input + output / 2);
    return { fits: false, batch: 0, maxBatch: mb, step, tpot: Infinity, ttft: Infinity, tokensPerS: 0, tokensPerGpuS: 0, gpuHoursPerMTokens: Infinity, utilization: 0 };
  }
  const step = decodeStep(c, b, input + output / 2);
  const pre = prefillS(c, input);
  // Each request's prompt is processed once; spread over its reply, that adds pre / output per token for one request,
  // and the batch shares GPU time, so per output token of throughput the prefill costs pre / output.
  const perTokenS = step.seconds / b + pre / output;
  const tokensPerS = 1 / perTokenS;
  return {
    fits: true,
    batch: b,
    maxBatch: mb,
    step,
    tpot: step.seconds,
    ttft: pre + step.seconds,
    tokensPerS,
    tokensPerGpuS: tokensPerS / c.tp,
    gpuHoursPerMTokens: (c.tp * 1e6) / (tokensPerS * 3600),
    utilization: (step.flops / step.seconds) / (c.tp * peakFlops(g, c.precision)),
  };
}

/** Accelerator by id, for lessons. */
export function gpuOf(id: GpuId): Accelerator {
  return ACCELERATORS[id];
}
