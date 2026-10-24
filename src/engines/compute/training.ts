// Training a language model on many GPUs. Every token costs about six FLOPs per parameter
// (forward pass two, backward pass four). The work is split three ways: tensor parallelism splits
// each layer across the GPUs of a server, pipeline parallelism gives each group of GPUs a slice of
// the layers, and data parallelism gives each copy of the model its own share of every batch.
// Each split costs something: communication, idle pipeline stages, memory.

import { ACCELERATORS, type GpuId } from '../../model/compute/hardware';
import { MODELS, matmulParams, type ModelId } from '../../model/compute/models';
import { ringAllReduce, scaleOutLink, scaleUpLink } from './collectives';
import { peakFlops } from './roofline';

/** Share of peak BF16 arithmetic the training kernels reach on their own (before communication and bubbles). */
export const TRAIN_COMPUTE_EFFICIENCY = 0.62;
/** Share of tensor-parallel communication hidden behind arithmetic. */
export const TP_OVERLAP = 0.5;
/** Share of the backward pass that gradient communication can hide behind. */
export const DP_OVERLAP = 0.8;
/** Bytes of model state per parameter with mixed-precision Adam: BF16 weights and gradients (2 + 2), and FP32 master weights and two moments (12), which can be sharded across data-parallel copies. */
export const STATE_BYTES = { replicated: 4, shardable: 12 };
/** Activation bytes kept per token per layer per unit of width, with selective recomputation. */
export const ACTIVATION_BYTES = 34;
/** GPUs per server. */
export const GPUS_PER_SERVER = 8;

export interface TrainConfig {
  model: ModelId;
  gpu: GpuId;
  gpus: number;
  /** Tensor-parallel degree: GPUs sharing each layer. */
  tp: number;
  /** Pipeline stages. */
  pp: number;
  /** Tokens in each optimizer step, across all GPUs. */
  batchTokens: number;
  /** Tokens per microbatch (one sequence). */
  seqLen: number;
  /** Tokens to train on in all. */
  tokens: number;
}

export interface TrainResult {
  valid: boolean;
  reason?: string;
  dp: number;
  /** Microbatches each pipeline handles per step. */
  microbatches: number;
  /** Memory needed per GPU, GB, and whether it fits. */
  memoryGB: number;
  stateGB: number;
  activationGB: number;
  fits: boolean;
  /** Per-step times, s. */
  computeS: number;
  bubbleS: number;
  tpCommS: number;
  dpCommS: number;
  stepS: number;
  steps: number;
  /** Model FLOPs utilization: useful arithmetic as a share of the GPUs' peak. */
  mfu: number;
  days: number;
  gpuHours: number;
  totalFlops: number;
}

/** Training FLOPs per token: six per parameter plus attention over the sequence. */
export function trainFlopsPerToken(model: ModelId, seqLen: number): number {
  const m = MODELS[model];
  return 6 * matmulParams(m) + 6 * m.layers * seqLen * m.d;
}

export function trainingRun(c: TrainConfig): TrainResult {
  const m = MODELS[c.model];
  const g = ACCELERATORS[c.gpu];
  const P = matmulParams(m);
  const dp = c.gpus / (c.tp * c.pp);
  const invalid = (reason: string): TrainResult => ({
    valid: false,
    reason,
    dp: Math.max(0, Math.floor(dp)),
    microbatches: 0,
    memoryGB: 0,
    stateGB: 0,
    activationGB: 0,
    fits: false,
    computeS: 0,
    bubbleS: 0,
    tpCommS: 0,
    dpCommS: 0,
    stepS: Infinity,
    steps: 0,
    mfu: 0,
    days: Infinity,
    gpuHours: Infinity,
    totalFlops: 0,
  });
  if (!Number.isInteger(dp) || dp < 1) return invalid('The GPUs don’t divide evenly into tensor × pipeline groups.');
  if (c.pp > m.layers) return invalid('More pipeline stages than layers.');
  const microbatches = c.batchTokens / (dp * c.seqLen);
  if (microbatches < 1) return invalid('The batch is too small to give every copy of the model a sequence.');

  // Memory per GPU: model state split by tp × pp (optimizer state also across dp), plus activations for the microbatches in flight.
  const share = P / (c.tp * c.pp);
  const stateBytes = share * (STATE_BYTES.replicated + STATE_BYTES.shardable / dp);
  const layersHere = m.layers / c.pp;
  const inFlight = Math.min(c.pp, Math.ceil(microbatches));
  const actBytes = (c.seqLen * layersHere * m.d * ACTIVATION_BYTES * inFlight) / c.tp;
  const memoryGB = (stateBytes + actBytes) / 1e9;
  const fits = memoryGB <= g.memoryGB * 0.95;

  // Arithmetic per step, per GPU.
  const flopsPerToken = trainFlopsPerToken(c.model, c.seqLen);
  const stepFlops = flopsPerToken * c.batchTokens;
  const computeS = stepFlops / c.gpus / (peakFlops(g) * TRAIN_COMPUTE_EFFICIENCY);

  // Pipeline bubble: stages wait while the pipeline fills and drains.
  const bubbleS = computeS * ((c.pp - 1) / microbatches);

  // Tensor parallelism: four all-reduces per layer per microbatch (two forward, two backward), over
  // GPU links inside a server or the network beyond it.
  const tpLink = c.tp <= GPUS_PER_SERVER ? scaleUpLink(c.gpu) : scaleOutLink(c.gpu);
  const perAllReduce = c.tp > 1 ? ringAllReduce(c.seqLen * m.d * 2, c.tp, tpLink).seconds : 0;
  const tpCommS = 4 * layersHere * microbatches * perAllReduce * (1 - TP_OVERLAP);

  // Data parallelism: all-reduce each GPU's share of the BF16 gradients across the copies, over the network.
  const gradBytes = (2 * P) / (c.tp * c.pp);
  const dpRaw = dp > 1 ? ringAllReduce(gradBytes, dp, scaleOutLink(c.gpu)).seconds : 0;
  const dpCommS = Math.max(0, dpRaw - DP_OVERLAP * computeS * (2 / 3));

  const stepS = computeS + bubbleS + tpCommS + dpCommS;
  const steps = Math.ceil(c.tokens / c.batchTokens);
  const totalFlops = flopsPerToken * c.tokens;
  const seconds = steps * stepS;
  const mfu = stepFlops / (c.gpus * peakFlops(g) * stepS);
  return {
    valid: true,
    reason: fits ? undefined : 'The model doesn’t fit in each GPU’s memory with this split.',
    dp,
    microbatches,
    memoryGB,
    stateGB: stateBytes / 1e9,
    activationGB: actBytes / 1e9,
    fits,
    computeS,
    bubbleS,
    tpCommS,
    dpCommS,
    stepS,
    steps,
    mfu,
    days: seconds / 86400,
    gpuHours: (c.gpus * seconds) / 3600,
    totalFlops,
  };
}
