// Chapter 3 of the compute course: assertions for the numbers and challenges added in the fix passes.

import { describe, expect, it } from 'vitest';
import { GPU_IDS, ACCELERATORS } from '../src/model/compute/hardware';
import { MODELS, matmulParams, paramCount } from '../src/model/compute/models';
import { WORKLOADS, WORKLOAD_IDS, type ServingWorkload } from '../src/model/compute/workloads';
import { BANDWIDTH_EFFICIENCY, decodeStep, maxBatch, memoryPlan, prefillS, servingPoint, tensorParallelS, type ServeConfig } from '../src/engines/compute/inference';
import { checkAssignment, type ServeFit } from '../src/engines/compute/compatibility';
import { simulateServing } from '../src/engines/compute/scheduling';
import { STATE_BYTES, trainFlopsPerToken } from '../src/engines/compute/training';
import { forwardPass } from '../src/engines/compute/transformer';
import {
  ATTENTION_FLOPS_PER_CONTEXT,
  BALANCE_CONTEXT,
  CHALLENGE_LENGTH,
  CHUNK_K,
  EARLIER_MAX_K,
  EXPLORER_DEFAULTS,
  FEED_FORWARD_FLOPS,
  MEMORY_DEFAULTS,
  TOKEN_MAX_K,
  TOKEN_STEPS,
  attentionSolved,
  attentionVsFeedForward,
  chunkSolved,
  earlierAt,
  explore,
  lengthAt,
  memorySolved,
  memoryUse,
  mostConversations,
  tokensAt,
} from '../src/lessons/compute/ch3/L3_1';
import {
  BATCH_EXP_MAX,
  LONG_REPLY,
  SERVE_DEFAULTS,
  TPOT_LIMIT as L32_TPOT,
  cheapestBySplit,
  cheapestSolved,
  computeBoundFrom,
  configOf,
  largestWithin,
} from '../src/lessons/compute/ch3/L3_2';
import { BUDGET_GPU_HOURS, NUMBERS, SCALE_DEFAULTS, SPLITS, TRAIN_USABLE, WEEK_DAYS, runOf, usableGB, weekSolved } from '../src/lessons/compute/ch3/L3_3';
import {
  BEST_CAPS,
  BEST_RATE,
  BEST_SHOWN_CAP,
  CAP_AVERAGE,
  CAP_MAX,
  INPUT,
  OUTPUT,
  PREFILL_EXCHANGE_S,
  PREFILL_S,
  RATE_STEP,
  SERVE,
  TPOT_LIMIT as L34_TPOT,
  TTFT_LIMIT,
  LAB_DEFAULTS as L34_DEFAULTS,
  RATE_MAX,
  flatOut,
  flatOutRequests,
  meetsLimits,
  rateSolved,
  runLab,
} from '../src/lessons/compute/ch3/L3_4';
import {
  ALL_ON_A,
  CODE_MS_DEFAULT,
  CODE_MS_MAX,
  CODE_MS_MIN,
  FLEET,
  TABLE,
  codeSweep,
  fleetCheck,
  fleetSolved,
  gpusFor,
  ratio,
  solutionsAt,
  splitRows,
  tableAt,
  type Assignment,
} from '../src/lessons/compute/ch3/L3_5';

const CHAT = WORKLOADS.chat70 as ServingWorkload;
const r1 = (x: number) => Math.round(x * 10) / 10;

describe('compute 3.1: the memory challenge and the cut training section', () => {
  const M8 = MODELS['8B'];

  it('fits 52 conversations of 8,192 tokens beside the 8B model, half the 104 of 4,096', () => {
    expect(CHALLENGE_LENGTH).toBe(8192);
    expect(lengthAt(52)).toBe(8192);
    expect(mostConversations('8B', 8192)).toBe(52);
    expect(mostConversations('8B', 4096)).toBe(104);
    expect(memoryUse('8B', 52, 8192).fits).toBe(true);
    expect(memoryUse('8B', 53, 8192).fits).toBe(false);
    expect(memoryUse('8B', 0, 8192).kvTokens).toBe(426788);
  });

  it('solves the memory challenge only at 52 conversations of 8,192 tokens on the 8B model', () => {
    expect(memorySolved(MEMORY_DEFAULTS)).toBe(false);
    expect(memorySolved({ model: '8B', convs: 52, lk: 52 })).toBe(true);
    expect(memorySolved({ model: '8B', convs: 51, lk: 52 })).toBe(false);
    expect(memorySolved({ model: '8B', convs: 53, lk: 52 })).toBe(false);
    expect(memorySolved({ model: '8B', convs: 104, lk: 48 })).toBe(false);
    expect(memorySolved({ model: '70B', convs: 52, lk: 52 })).toBe(false);
    // The slider reaches 52.
    expect(52).toBeLessThanOrEqual(128);
  });

  it('explains the gap between 16.1 GB of weights and 15.0 GB read per token: the lookup table', () => {
    expect(r1((paramCount(M8) * 2) / 1e9)).toBe(16.1);
    expect(r1((matmulParams(M8) * 2) / 1e9)).toBe(15.0);
    expect(paramCount(M8) - matmulParams(M8)).toBe(M8.vocab * M8.d);
  });

  it('reads a 1,024-token prompt well past the few hundred tokens where the multiplies turn compute-bound', () => {
    let exact = 1;
    const ffBound = (n: number) => forwardPass(M8, n, n, ACCELERATORS.A).ops.filter((o) => o.id === 'up' || o.id === 'down').every((o) => o.bound === 'compute');
    while (!ffBound(exact)) exact++;
    expect(exact).toBeGreaterThan(200);
    expect(exact).toBeLessThan(500);
    expect(Math.round(explore(0, 80).pass.matmulShare * 100)).toBe(97);
    expect(Math.round(explore(320, 0).pass.matmulShare * 100)).toBe(97);
  });

  it('needs a long earlier text to make attention outweigh the feed-forward block (chunk by chunk, not one pass)', () => {
    for (let tk = 0; tk <= TOKEN_MAX_K; tk += 4) expect(attentionSolved(tk, 0)).toBe(false);
    let minEarlier = Infinity;
    for (let tk = 0; tk <= TOKEN_MAX_K; tk += 4) for (let ek = 0; ek <= EARLIER_MAX_K; ek++) if (attentionSolved(tk, ek)) minEarlier = Math.min(minEarlier, earlierAt(ek));
    expect(minEarlier).toBeGreaterThan(16384);
  });

  it('says training costs about three times the arithmetic and eight times the memory per weight', () => {
    const fwdCausal = 2 * matmulParams(M8) + 2 * M8.layers * 4096 * M8.d;
    expect(trainFlopsPerToken('8B', 4096) / fwdCausal).toBeCloseTo(3, 9);
    const fwdExplorer = 2 * matmulParams(M8) + 4 * M8.layers * 4096 * M8.d;
    const ratio31 = trainFlopsPerToken('8B', 4096) / fwdExplorer;
    expect(ratio31).toBeGreaterThan(2.7);
    expect(ratio31).toBeLessThan(3.05);
    expect((STATE_BYTES.replicated + STATE_BYTES.shardable) / 2).toBe(8);
  });
});

describe('compute 3.2: what bounds a full batch, FP8, and the chat promise', () => {
  const c4 = configOf(SERVE_DEFAULTS);
  const c8 = configOf({ ...SERVE_DEFAULTS, tp: 8 });

  it('would turn compute-bound at about 816 requests, but four GPUs fill at 344 and eight hold 1,020', () => {
    expect(computeBoundFrom(c4, 1150)).toBe(816);
    expect(computeBoundFrom(c8, 1150)).toBe(816);
    expect(maxBatch(c4, 1300)).toBe(344);
    expect(maxBatch(c8, 1300)).toBe(1020);
    expect(servingPoint(c4, 344, 1000, 300).step.bound).toBe('memory');
    expect(servingPoint(c8, 1020, 1000, 300).step.bound).toBe('compute');
    expect(decodeStep(c4, 815, 1150).bound).toBe('memory');
  });

  it('halves the bytes of weights in FP8, not the bytes each step reads', () => {
    const fp8: ServeConfig = { ...c4, precision: 'fp8' };
    expect(memoryPlan(fp8).weightBytes).toBe(memoryPlan(c4).weightBytes / 2);
    const bf = servingPoint(c4, 344, 1000, 300).step.bytes;
    const f8 = servingPoint(fp8, 510, 1000, 300).step.bytes;
    expect(f8).toBeGreaterThan(0.9 * bf);
    expect(maxBatch(fp8, 1300)).toBe(510);
  });

  it('uses the chat assistant’s 40 ms as its challenge’s limit', () => {
    expect(L32_TPOT).toBe(CHAT.tpotMax);
    expect(L32_TPOT).toBe(0.04);
  });
});

describe('compute 3.3: the usable-memory line', () => {
  it('draws the line exactly where the engine stops fitting', () => {
    expect(TRAIN_USABLE).toBe(0.95);
    expect(usableGB('A')).toBe(76);
    for (const model of ['8B', '70B'] as const)
      for (const gpu of GPU_IDS)
        for (let lg = 6; lg <= 12; lg++)
          for (const tp of SPLITS)
            for (const pp of SPLITS) {
              const r = runOf(model, gpu, 2 ** lg, tp, pp);
              if (r.valid) expect(r.fits).toBe(r.memoryGB <= usableGB(gpu));
            }
  });

  it('marks a split as not fitting below the card’s capacity, which the line now explains', () => {
    const r = runOf('70B', 'L', 1024, 8, 1);
    expect(r1(r.memoryGB)).toBe(47.0);
    expect(r.fits).toBe(false);
    expect(r1(usableGB('L'))).toBe(45.6);
  });
});

describe('compute 3.4: one chat promise, and the two-minute sample', () => {
  it('keeps the chat assistant’s promise: 1.5 s to the first token, 40 ms per token', () => {
    expect(TTFT_LIMIT).toBe(CHAT.ttftMax);
    expect(L34_TPOT).toBe(CHAT.tpotMax);
    expect([TTFT_LIMIT, L34_TPOT]).toEqual([1.5, 0.04]);
  });

  it('caps the batch at 309 because replies can run to 450 tokens', () => {
    expect(Math.ceil(OUTPUT * 1.5)).toBe(450);
    expect(CAP_MAX).toBe(maxBatch(SERVE, INPUT + 450));
    expect([CAP_MAX, CAP_AVERAGE]).toEqual([309, 344]);
  });

  it('splits the prompt’s 61.3 ms into 50.7 ms of arithmetic and 10.7 ms of exchanges', () => {
    expect(r1(PREFILL_S * 1e3)).toBe(61.3);
    expect(r1((PREFILL_S - PREFILL_EXCHANGE_S) * 1e3)).toBe(50.7);
    expect(r1(PREFILL_EXCHANGE_S * 1e3)).toBe(10.7);
  });

  it('drains the queue at 8 a second with 256, with tokens just over the promise', () => {
    const open = runLab(8, 256);
    expect(open.overloaded).toBe(false);
    expect(open.tpot).toBeGreaterThan(L34_TPOT);
    expect(r1(open.tpot * 1e3)).toBe(40.5);
  });

  it('breaks one promise or the other at every max batch half a request above the best rate', () => {
    const rate = BEST_RATE + RATE_STEP;
    for (let cap = 1; cap <= CAP_MAX; cap++) {
      const r = runLab(rate, cap);
      if (r.tpot <= L34_TPOT) expect(r.overloaded || r.ttftP95 > TTFT_LIMIT).toBe(true);
      if (!r.overloaded && r.ttftP95 <= TTFT_LIMIT) expect(r.tpot).toBeGreaterThan(L34_TPOT);
    }
  }, 30000);

  it('quotes the best rate’s run, and the knee past the promise', () => {
    const best = runLab(BEST_RATE, BEST_SHOWN_CAP);
    expect(meetsLimits(best)).toBe(true);
    expect(Math.round(best.throughput)).toBe(2235);
    expect(Math.round(best.utilization * 100)).toBe(36);
    // Below the knee every max batch streams within the promise; near the big batch's knee its tokens slow past it.
    for (const cap of [16, 64, 256]) expect(runLab(6, cap).tpot).toBeLessThan(L34_TPOT);
    expect(runLab(10, 256).overloaded).toBe(false);
    expect(runLab(10, 256).tpot).toBeGreaterThan(L34_TPOT);
  });

  it('is one sample: other two-minute samples put the edge a little higher, never lower', () => {
    const meets = (r: ReturnType<typeof simulateServing>) => !r.overloaded && r.ttftP95 <= TTFT_LIMIT && r.tpot <= L34_TPOT;
    for (const seed of [1, 2, 3, 4, 5]) {
      let bestRate = 0;
      for (const rate of [7, 7.5, 8, 8.5, 9])
        for (let cap = 1; cap <= CAP_MAX; cap += 2)
          if (meets(simulateServing({ serve: SERVE, arrivalsPerS: rate, maxBatch: cap, input: INPUT, outputMean: OUTPUT, seconds: 120, seed }))) {
            bestRate = Math.max(bestRate, rate);
            break;
          }
      expect(bestRate).toBeGreaterThanOrEqual(BEST_RATE);
      expect(bestRate).toBeLessThanOrEqual(BEST_RATE + 2 * RATE_STEP);
    }
  }, 60000);
});

describe('compute 3.5: code completion’s limit can change the answer', () => {
  const answer: Assignment = { chat70: 'B', code8: 'A', batch8: 'L', frontier400: 'B', train70: 'A', tune8: 'A' };

  it('checks assignments exactly as the engine does at the default limit', () => {
    expect(tableAt(CODE_MS_DEFAULT)).toBe(TABLE);
    const all: Assignment[] = [];
    const rec = (i: number, cur: Partial<Assignment>) => {
      if (i === WORKLOAD_IDS.length) return void all.push(cur as Assignment);
      for (const g of GPU_IDS) rec(i + 1, { ...cur, [WORKLOAD_IDS[i]]: g });
    };
    rec(0, {});
    for (const a of all) {
      const mine = fleetCheck(a);
      const engine = checkAssignment(a, FLEET);
      expect(mine.feasible).toBe(engine.feasible);
      if (engine.infeasible.length === 0) expect(mine.used).toEqual(engine.used);
    }
  });

  it('has one answer from 6 to 35 ms, none at 5 ms, and a second from 36 ms', () => {
    expect([CODE_MS_DEFAULT, CODE_MS_MIN, CODE_MS_MAX]).toEqual([15, 5, 60]);
    expect(solutionsAt(CODE_MS_DEFAULT)).toEqual([answer]);
    for (let ms = 6; ms <= 35; ms++) expect(solutionsAt(ms).length).toBe(1);
    expect(solutionsAt(5)).toEqual([]);
    const sweep = codeSweep();
    expect(sweep.noAnswerAt).toBe(5);
    expect(sweep.tightestWithAnswer).toBe(6);
    expect(sweep.secondFrom).toBe(36);
    expect(sweep.second).toEqual({ ...answer, code8: 'L', batch8: 'A' });
    expect(tableAt(36).code8.L.gpus).toBe(64);
    expect(tableAt(36).code8.L.gpus).toBe(FLEET.L);
    expect([tableAt(5).code8.A.gpus, tableAt(5).code8.B.gpus]).toEqual([24, 9]);
    expect(tableAt(5).code8.L.feasible).toBe(false);
  });

  it('solves the challenge only with the workloads as given', () => {
    expect(fleetSolved(ALL_ON_A)).toBe(false);
    expect(fleetSolved(answer)).toBe(true);
    expect(fleetSolved(answer, 36)).toBe(false);
    expect(fleetSolved(sweep2(), CODE_MS_DEFAULT)).toBe(false);
  });

  it('quotes code completion on the L-class: six times the A-class, its steps mostly reading weights', () => {
    expect(gpusFor('code8', 'L')).toBe(114);
    expect(gpusFor('code8', 'A')).toBe(19);
    expect(ratio('code8', 'L', 'A')).toBe(6);
    const f = TABLE.code8.L as ServeFit;
    const L = ACCELERATORS.L;
    const weightRead = memoryPlan({ model: '8B', gpu: 'L', tp: f.tp, precision: 'bf16' }).weightBytes / (f.tp * L.bandwidthTBs * 1e12 * BANDWIDTH_EFFICIENCY);
    expect(weightRead / f.point!.step.seconds).toBeGreaterThan(0.5);
  });

  it('gives the chat assistant the promise of Lessons 3.2 and 3.4', () => {
    expect([CHAT.tpotMax, CHAT.ttftMax]).toEqual([0.04, 1.5]);
  });
});

function sweep2(): Assignment {
  return codeSweep().second;
}

// ---------------------------------------------------------------------------
// Fix pass 2: challenges that ask for a prediction first.

describe('compute 3.1 (pass 2): when attention overtakes the feed-forward block', () => {
  const M8 = MODELS['8B'];

  it('quotes 16,384 FLOPs per token of context against 352 million per token, which balance at 21,504', () => {
    expect(ATTENTION_FLOPS_PER_CONTEXT).toBe(16384);
    expect(FEED_FORWARD_FLOPS).toBe(352_321_536);
    expect(Math.round(FEED_FORWARD_FLOPS / 2e6)).toBe(176);
    expect(Math.round(FEED_FORWARD_FLOPS / 1e6)).toBe(352);
    expect(BALANCE_CONTEXT).toBe(21504);
    // The same counts the engine uses for one layer.
    const ops = explore(CHUNK_K, 0).pass.ops;
    const t = tokensAt(CHUNK_K);
    expect(ops.find((o) => o.id === 'attn')!.flops).toBe(ATTENTION_FLOPS_PER_CONTEXT * t * t);
    expect(ops.filter((o) => o.id === 'up' || o.id === 'down').reduce((s, o) => s + o.flops, 0)).toBe(FEED_FORWARD_FLOPS * t);
    expect(2 * 3 * M8.d * M8.ffn).toBe(FEED_FORWARD_FLOPS);
  });

  it('is solved only by a 1,024-token chunk with 23,170 tokens of earlier text', () => {
    expect(CHUNK_K).toBe(10 * TOKEN_STEPS);
    expect(tokensAt(CHUNK_K)).toBe(1024);
    expect(chunkSolved(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek)).toBe(false);
    expect(chunkSolved(CHUNK_K, 0)).toBe(false);
    const answers: number[] = [];
    for (let ek = 0; ek <= EARLIER_MAX_K; ek++) if (chunkSolved(CHUNK_K, ek)) answers.push(ek);
    expect(answers).toEqual([116]);
    expect(earlierAt(116)).toBe(23170);
    expect(explore(CHUNK_K, 116).context).toBe(24194);
    // Near misses: a step less is short of the feed-forward block; a step more is past the least.
    expect(chunkSolved(CHUNK_K, 115)).toBe(false);
    expect(attentionSolved(CHUNK_K, 115)).toBe(false);
    expect(chunkSolved(CHUNK_K, 117)).toBe(false);
    expect(attentionSolved(CHUNK_K, 117)).toBe(true);
    // Another chunk size has its own edge, but it isn't the challenge.
    for (let ek = 0; ek <= EARLIER_MAX_K; ek++) expect(chunkSolved(TOKEN_MAX_K, ek)).toBe(false);
    // Not the slider's end.
    expect(116).toBeLessThan(EARLIER_MAX_K);
  });

  it('lands a little past the arithmetic-only balance, because the activation step waits on memory', () => {
    const e = explore(CHUNK_K, 116);
    const prev = explore(CHUNK_K, 115);
    expect(prev.context).toBeGreaterThan(BALANCE_CONTEXT);
    expect(e.context).toBeGreaterThan(BALANCE_CONTEXT);
    const act = e.pass.ops.find((o) => o.id === 'act')!;
    expect(act.bound).toBe('memory');
    expect(Math.round(act.totalS * 1e6 * 10) / 10).toBe(26.3);
    const av = attentionVsFeedForward(e.pass);
    expect(av.attention / av.feedForward).toBeGreaterThan(1);
    expect(av.attention / av.feedForward).toBeLessThan(1.1);
    // Attention is then the biggest operation in the layer.
    const attn = e.pass.ops.find((o) => o.id === 'attn')!;
    for (const o of e.pass.ops) expect(attn.totalS).toBeGreaterThanOrEqual(o.totalS);
    // Both feed-forward multiplies are limited by arithmetic at 1,024 tokens.
    expect(e.pass.ops.filter((o) => o.id === 'up' || o.id === 'down').every((o) => o.bound === 'compute')).toBe(true);
  });
});

describe('compute 3.2 (pass 2): which split serves the chat assistant most cheaply', () => {
  const c4 = configOf(SERVE_DEFAULTS);
  const c8 = configOf({ ...SERVE_DEFAULTS, tp: 8 });

  it('is four GPUs at 300-token replies: eight’s full batch breaks the promise and costs more within it', () => {
    const by = cheapestBySplit(1000, 300);
    expect(by[4].batch).toBe(344);
    expect(Math.round(by[4].gpuHoursPerM * 1000) / 1000).toBe(0.325);
    expect(Math.round(by[2].gpuHoursPerM * 100) / 100).toBe(2.74);
    expect(by[8].gpuHoursPerM).toBeGreaterThan(by[4].gpuHoursPerM);
    expect(by[2].gpuHoursPerM).toBeGreaterThan(by[4].gpuHoursPerM);
    expect(Math.round(maxBatch(c8, 1300) / maxBatch(c4, 1300))).toBe(3);
    const full8 = servingPoint(c8, maxBatch(c8, 1300), 1000, 300);
    expect(r1(full8.tpot * 1e3)).toBe(41.0);
    expect(full8.tpot).toBeGreaterThan(L32_TPOT);
    const b8 = largestWithin(c8, L32_TPOT, 1000, 300);
    expect(b8).toBe(991);
    expect(Math.round(servingPoint(c8, b8, 1000, 300).gpuHoursPerMTokens * 1000) / 1000).toBe(0.386);
  });

  it('spends more GPU time reading a prompt on eight GPUs: 40.0 ms, 14.7 of it exchanges, 320 against 245 GPU-ms', () => {
    expect(r1(prefillS(c8, 1000) * 1e3)).toBe(40.0);
    expect(r1(tensorParallelS(c8, 1000) * 1e3)).toBe(14.7);
    expect(Math.round(8 * prefillS(c8, 1000) * 1e3)).toBe(320);
    expect(Math.round(4 * prefillS(c4, 1000) * 1e3)).toBe(245);
  });

  it('solves the challenge only at the cheapest point, not by default or on eight GPUs', () => {
    expect(cheapestSolved(SERVE_DEFAULTS)).toBe(false);
    expect(cheapestSolved({ ...SERVE_DEFAULTS, batchExp: BATCH_EXP_MAX })).toBe(true);
    expect(cheapestSolved({ ...SERVE_DEFAULTS, tp: 8, batchExp: BATCH_EXP_MAX })).toBe(false);
    expect(cheapestSolved({ ...SERVE_DEFAULTS, tp: 8, batchExp: 9.75 })).toBe(false);
    expect(cheapestSolved({ ...SERVE_DEFAULTS, tp: 2, batchExp: BATCH_EXP_MAX })).toBe(false);
    expect(cheapestSolved({ ...SERVE_DEFAULTS, output: LONG_REPLY, tp: 8, batchExp: BATCH_EXP_MAX })).toBe(false);
  });

  it('flips to eight GPUs with 1,500-token replies: 530 against 179 requests, 0.188 against 0.208', () => {
    expect(LONG_REPLY / 300).toBe(5);
    expect(LONG_REPLY % 50).toBe(0);
    expect(LONG_REPLY).toBeLessThan(2000);
    expect(Math.round(((1000 + LONG_REPLY) * 327_680) / 1e6)).toBe(819);
    const by = cheapestBySplit(1000, LONG_REPLY);
    expect([by[4].batch, by[8].batch]).toEqual([179, 530]);
    expect([maxBatch(c4, 1000 + LONG_REPLY), maxBatch(c8, 1000 + LONG_REPLY)]).toEqual([179, 530]);
    expect(Math.round(by[8].gpuHoursPerM * 1000) / 1000).toBe(0.188);
    expect(Math.round(by[4].gpuHoursPerM * 1000) / 1000).toBe(0.208);
    expect(by[8].tpot).toBeLessThan(L32_TPOT);
    expect(Math.round(memoryPlan(c8).kvBytes / memoryPlan(c4).kvBytes)).toBe(3);
  });
});

describe('compute 3.3 (pass 2): under a week, within the budget', () => {
  const b = NUMBERS.base;

  it('estimates about 2,850 GPUs under perfect scaling, so 4,096 on the doubling slider', () => {
    expect(Math.round(NUMBERS.weekIdealGpus / 50) * 50).toBe(2850);
    expect(NUMBERS.weekIdealGpus).toBeGreaterThan(2048);
    expect(NUMBERS.weekIdealGpus).toBeLessThan(4096);
    expect(Math.round(b.gpuHours / 1000)).toBe(479);
    expect(b.gpuHours).toBeLessThan(BUDGET_GPU_HOURS);
  });

  it('spends 23% more GPU-hours at 4,096 as MFU slips from 50.8% to 41.3%', () => {
    expect(Math.round((NUMBERS.s4096.gpuHours / b.gpuHours - 1) * 100)).toBe(23);
    expect(Math.round(NUMBERS.s4096.mfu * 1000) / 10).toBe(41.3);
    expect(Math.round(NUMBERS.s8192.mfu * 1000) / 10).toBe(33.0);
    expect(Math.round(NUMBERS.p4096.gpuHours / 1000)).toBe(614);
    expect(NUMBERS.p4096.gpuHours).toBeGreaterThan(BUDGET_GPU_HOURS);
  });

  it('is solved at 4,096 GPUs with 4 stages, and not by default, the single stage or a neighboring count', () => {
    expect(weekSolved(SCALE_DEFAULTS)).toBe(false);
    expect(weekSolved({ split: '8x4', lg: 12 })).toBe(true);
    expect(weekSolved({ split: '8x1', lg: 12 })).toBe(false);
    expect(weekSolved({ split: '4x2', lg: 12 })).toBe(false);
    expect(weekSolved({ split: '8x4', lg: 11 })).toBe(false);
    expect(weekSolved({ split: '8x4', lg: 13 })).toBe(false);
    expect(NUMBERS.s4096.days).toBeLessThan(WEEK_DAYS);
  });

  it('fits the 8B model with one GPU per layer and one stage: 48.4 GB', () => {
    expect(NUMBERS.small.valid).toBe(true);
    expect(NUMBERS.small.fits).toBe(true);
    expect(r1(NUMBERS.small.memoryGB)).toBe(48.4);
  });
});

describe('compute 3.4 (pass 2): predicting the best rate from flat-out capacity', () => {
  it('runs flat out at 3,121 tokens a second, 10.4 requests a second', () => {
    expect(Math.round(flatOut().throughput)).toBe(3121);
    expect(flatOut().overloaded).toBe(true);
    expect(r1(flatOutRequests())).toBe(10.4);
    expect(RATE_MAX).toBe(20);
  });

  it('keeps both promises at 72% of that, and only the best rate solves', () => {
    expect(Math.round((BEST_RATE / flatOutRequests()) * 100)).toBe(72);
    expect(Math.round((runLab(BEST_RATE, BEST_SHOWN_CAP).throughput / flatOut().throughput) * 100)).toBe(72);
    expect(rateSolved(L34_DEFAULTS.rate, L34_DEFAULTS.cap)).toBe(false);
    expect(rateSolved(BEST_RATE, BEST_CAPS[0])).toBe(true);
    expect(rateSolved(BEST_RATE, 200)).toBe(true);
    expect(rateSolved(BEST_RATE - RATE_STEP, 200)).toBe(false);
    expect(meetsLimits(runLab(BEST_RATE - RATE_STEP, 200))).toBe(true);
    expect(rateSolved(BEST_RATE + RATE_STEP, 200)).toBe(false);
    expect(rateSolved(BEST_RATE, BEST_CAPS[0] - 1)).toBe(false);
  });
});

describe('compute 3.5 (pass 2): the split table', () => {
  it('shows room only where the weights fit, so a separate fits column would repeat it', () => {
    for (const id of WORKLOAD_IDS) {
      const w = WORKLOADS[id];
      if (w.kind !== 'serve') continue;
      for (const g of GPU_IDS) for (const row of splitRows(w, g)) expect(row.fits).toBe(row.room >= 1);
    }
  });
});
