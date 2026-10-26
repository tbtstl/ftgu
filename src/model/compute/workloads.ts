// The compute course's workloads: six jobs a GPU cloud is asked to run, from serving chat replies
// to training a model. They differ in model size, latency limits and how they spread over GPUs,
// which is why they can't all run equally well on every accelerator. Demand figures are simulated.

import type { ModelId } from './models';
import type { Precision } from '../../engines/compute/roofline';

export type WorkloadId = 'chat70' | 'code8' | 'batch8' | 'frontier400' | 'train70' | 'tune8';

interface Common {
  id: WorkloadId;
  name: string;
  /** A short description for tables. */
  blurb: string;
  model: ModelId;
  /** Longest network round trip to users the workload tolerates, ms (Infinity: none). */
  maxRttMs: number;
}

export interface ServingWorkload extends Common {
  kind: 'serve';
  precision: Precision;
  /** Prompt length, tokens. */
  input: number;
  /** Reply length, tokens. */
  output: number;
  /** Longest acceptable time to the first token, s (Infinity: no limit). */
  ttftMax: number;
  /** Longest acceptable time between tokens, s (Infinity: no limit). */
  tpotMax: number;
  /** Output tokens per second the workload needs at its peak. */
  demandTokensPerS: number;
}

export interface TrainingWorkload extends Common {
  kind: 'train';
  /** Tokens to train on. */
  tokens: number;
  /** Days allowed. */
  deadlineDays: number;
  seqLen: number;
  batchTokens: number;
}

export type Workload = ServingWorkload | TrainingWorkload;

export const WORKLOADS: Record<WorkloadId, Workload> = {
  chat70: {
    kind: 'serve',
    id: 'chat70',
    name: 'Chat assistant',
    blurb: '70B model, replies streamed to people',
    model: '70B',
    precision: 'bf16',
    input: 1000,
    output: 300,
    ttftMax: 1.5,
    tpotMax: 0.04,
    demandTokensPerS: 30_000,
    maxRttMs: 100,
  },
  code8: {
    kind: 'serve',
    id: 'code8',
    name: 'Code completion',
    blurb: '8B model, suggestions as a programmer types',
    model: '8B',
    precision: 'bf16',
    input: 2000,
    output: 60,
    ttftMax: 0.2,
    tpotMax: 0.015,
    demandTokensPerS: 20_000,
    maxRttMs: 20,
  },
  batch8: {
    kind: 'serve',
    id: 'batch8',
    name: 'Batch summarization',
    blurb: '8B model, documents summarized overnight',
    model: '8B',
    precision: 'bf16',
    input: 3000,
    output: 300,
    ttftMax: Infinity,
    tpotMax: Infinity,
    demandTokensPerS: 40_000,
    maxRttMs: Infinity,
  },
  frontier400: {
    kind: 'serve',
    id: 'frontier400',
    name: 'Frontier assistant',
    blurb: '400B model in FP8, the hardest questions',
    model: '400B',
    precision: 'fp8',
    input: 1000,
    output: 400,
    ttftMax: 2,
    tpotMax: 0.06,
    demandTokensPerS: 6_000,
    maxRttMs: 100,
  },
  train70: {
    kind: 'train',
    id: 'train70',
    name: 'Pretraining run',
    blurb: '70B model, 1 trillion tokens in 30 days',
    model: '70B',
    tokens: 1e12,
    deadlineDays: 30,
    seqLen: 4096,
    batchTokens: 4 * 1024 * 1024,
    maxRttMs: Infinity,
  },
  tune8: {
    kind: 'train',
    id: 'tune8',
    name: 'Fine-tuning job',
    blurb: '8B model, 50 billion tokens in 5 days',
    model: '8B',
    tokens: 50e9,
    deadlineDays: 5,
    seqLen: 4096,
    batchTokens: 1024 * 1024,
    maxRttMs: Infinity,
  },
};

export const WORKLOAD_IDS: WorkloadId[] = ['chat70', 'code8', 'batch8', 'frontier400', 'train70', 'tune8'];

/** Chart colors for the four kinds of demand (always labeled). */
export const SEGMENT_COLOR = { training: '#8d7b6a', inference: '#eb9b66', batch: '#6cc0b8', interactive: '#b88dc2' } as const;
