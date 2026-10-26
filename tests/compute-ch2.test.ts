// Chapter 2 of the compute course: the numbers its prose quotes and its challenges' checks,
// for what the first fix pass changed (the rest lives in tests/compute.test.ts).

import { describe, expect, it } from 'vitest';
import { fmt, pct } from '../src/framework';
import { CPU, GPU, amdahl, peakTflops, runTask } from '../src/engines/compute/parallel';
import { occupancy, waves } from '../src/engines/compute/gpuExec';
import { ACCELERATORS, GPU_SERIAL_GOPS, HOST_CPU, SM_LIMITS, ridgePoint } from '../src/model/compute/hardware';
import {
  AMDAHL_DEFAULTS,
  BYTES_PER_ITEM,
  CHALLENGE_FLOPS,
  GPU_LANES,
  PREDICTED_SHARE,
  SHARE_LOG,
  amdahlSolved,
  gpuSpeedupHidden,
} from '../src/lessons/compute/ch2/L2_1';
import { LESSON_NUMBERS, SCHED_DEFAULTS, busySolved, kernelOf, noIdleSolved } from '../src/lessons/compute/ch2/L2_2';
import { ALLOWANCE, BATCH_DEFAULTS, ONE_VECTOR_S, batchRun, cheapBatchSolved, firstComputeBound, largestCheapBatch, matmulRun, ns, us } from '../src/lessons/compute/ch2/L2_3';
import {
  BW,
  BW_BATCH,
  CACHE_PASSES,
  MEM_DEFAULTS,
  WS,
  bandwidthSolved,
  batchIntensity,
  cacheLimitMB,
  cacheSolved,
  compareTflops,
  largestCachedWorkingSet,
  lowestComputeBandwidth,
  runMem,
  type MemState,
} from '../src/lessons/compute/ch2/L2_4';
import {
  CHALLENGE_SERVERS,
  CLUSTER_DEFAULTS,
  DATA_LOG,
  GRAD_8B,
  PREDICTED_BYTES,
  allReduce,
  bytesText,
  clusterSolved,
  dur,
  largestUnderTarget,
  networkShare,
} from '../src/lessons/compute/ch2/L2_5';

describe('compute 2.1: CPUs versus GPUs', () => {
  const base = { flopsPerItem: 2000, serialShare: 0, bytesPerItem: BYTES_PER_ITEM, items: 1e6 };
  const g = runTask(GPU, base);
  const c = runTask(CPU, base);

  it('quotes one FP32 peak for the A-class across the chapter', () => {
    expect(fmt(peakTflops(GPU))).toBe('67');
    expect(ACCELERATORS.A.fp32Tflops).toBe(67);
    expect(fmt(peakTflops(GPU) / peakTflops(CPU), 1)).toBe('5.4');
    expect(HOST_CPU.serialGops).toBe(10);
    expect(GPU_SERIAL_GOPS).toBe(0.5);
  });

  it('explains the copy: 250 FLOPs per byte clears the 246 break-even, and the GPU’s own time tips it', () => {
    expect(CHALLENGE_FLOPS / BYTES_PER_ITEM).toBe(250);
    expect(Math.round((peakTflops(CPU) * 1e12) / (GPU.copyGBs * 1e9))).toBe(246);
    // The copy alone is a little shorter than the CPU's whole job...
    expect(g.copyS * 1e6).toBeCloseTo(160, 6);
    expect(c.totalS * 1e6).toBeCloseTo(168, 6);
    expect(g.copyS).toBeLessThan(c.totalS);
    // ...and the GPU's 30.3 µs of arithmetic and 10 µs launch on top make it lose.
    expect(fmt(g.parallelS * 1e6, 1)).toBe('30.3');
    expect(GPU.launchUs).toBe(10);
    expect(g.copyS + g.parallelS + g.overheadS).toBeCloseTo(g.totalS, 12);
    expect(g.totalS).toBeGreaterThan(c.totalS);
    expect(20000 / BYTES_PER_ITEM).toBe(2500);
  });

  it('challenge b: the prediction 1/1,000 − 1/16,896 ≈ 0.094% lands between two slider settings, and the lower one solves', () => {
    expect(GPU_LANES).toBe(16896);
    expect(fmt(PREDICTED_SHARE * 100, 3)).toBe('0.094');
    // Without the approximation 1 − s ≈ 1, the bound is the same to three places.
    expect(fmt(((1 / 1000 - 1 / 16896) / (1 - 1 / 16896)) * 100, 3)).toBe('0.094');
    expect(10 ** -3.05).toBeLessThan(PREDICTED_SHARE);
    expect(10 ** -3.0).toBeGreaterThan(PREDICTED_SHARE);
    expect(fmt(10 ** -3.05 * 100, 3)).toBe('0.089');
    expect(fmt(amdahl(10 ** -3.05, GPU_LANES))).toBe('1,052');
    expect(fmt(amdahl(0.001, GPU_LANES))).toBe('944');
    // Default unsolved; the intended answer solves; its neighbors don't.
    expect(amdahlSolved(AMDAHL_DEFAULTS.logShare)).toBe(false);
    expect(amdahlSolved(-3.05)).toBe(true);
    expect(amdahlSolved(-3.0)).toBe(false);
    expect(amdahlSolved(-3.1)).toBe(false);
    expect(SHARE_LOG.step).toBe(0.05);
  });

  it('challenge b: hides the GPU’s speedup near the answer until solved, and never shows a speedup near 1,000 before then', () => {
    expect(gpuSpeedupHidden(AMDAHL_DEFAULTS.logShare, false)).toBe(false);
    for (const l of [-3.1, -3.05, -3.0, -2.95, -2.7]) {
      expect(gpuSpeedupHidden(l, false)).toBe(true);
      expect(gpuSpeedupHidden(l, true)).toBe(false);
    }
    expect(gpuSpeedupHidden(-2.65, false)).toBe(false);
    // The largest speedup visible before solving is well short of the target.
    expect(amdahl(10 ** -2.65, GPU_LANES)).toBeLessThan(500);
  });
});

describe('compute 2.2: GPU execution model', () => {
  it('uses a grid many waves long, and the (n − 1)/n floor holds', () => {
    expect(LESSON_NUMBERS.w1000Waves).toBe(8);
    expect(LESSON_NUMBERS.w1000LastWave).toBe(76);
    expect(pct(LESSON_NUMBERS.w1000, 1)).toBe('94.7%');
    expect(pct(7 / 8, 1)).toBe('87.5%');
    for (const perSM of [1, 2, 4, 8]) {
      for (let b = 1; b <= 1000; b++) {
        const w = waves(b, perSM);
        expect(w.utilization).toBeGreaterThanOrEqual((w.waves - 1) / w.waves);
      }
    }
  });

  it('challenge a: predicts 12 warps (0.9 × 520 ÷ 40 = 11.7) and still solves only through the registers', () => {
    expect(LESSON_NUMBERS.warpsForTarget).toBe(12);
    expect(fmt((0.9 * 520) / 40, 1)).toBe('11.7');
    expect(busySolved(SCHED_DEFAULTS)).toBe(false);
    expect(busySolved({ ...SCHED_DEFAULTS, regs: 42 })).toBe(true);
    expect(busySolved({ ...SCHED_DEFAULTS, regs: 43 })).toBe(false);
    // The block size and shared memory can't get there at 64 registers.
    for (const threads of [128, 256, 384, 512, 640, 768, 896, 1024]) expect(busySolved({ ...SCHED_DEFAULTS, threads })).toBe(false);
    expect(busySolved({ ...SCHED_DEFAULTS, shared: 64 })).toBe(false);
  });

  it('gives the shared-memory and block-size sliders their tasks', () => {
    // 64 KB of shared memory per block at 32 registers: three blocks, 24 warps.
    expect(LESSON_NUMBERS.tileSharedKB).toBe(64);
    expect(LESSON_NUMBERS.sharedRegsAllow).toBe(8);
    expect(LESSON_NUMBERS.sharedBlocks).toBe(3);
    expect(LESSON_NUMBERS.sharedLimit).toBe('shared memory');
    expect(LESSON_NUMBERS.sharedWarps).toBe(24);
    expect(pct(LESSON_NUMBERS.sharedBusy, 1)).toBe('46.2%');
    // Blocks of 384 threads at 64 registers: two fit, 16,384 registers (a quarter) are left idle.
    expect(LESSON_NUMBERS.oddBlocks).toBe(2);
    expect(fmt(2 * 384 * 64)).toBe('49,152');
    expect(LESSON_NUMBERS.oddLeftover).toBe(16384);
    expect(LESSON_NUMBERS.oddLeftover / SM_LIMITS.registers).toBe(0.25);
    expect(LESSON_NUMBERS.oddLeftover).toBeLessThan(384 * 64);
    expect(LESSON_NUMBERS.oddWarps).toBe(24);
    expect(LESSON_NUMBERS.defaultWarps).toBe(32);
    for (const threads of [128, 256, 512, 1024]) expect(occupancy(kernelOf({ ...SCHED_DEFAULTS, threads })).warpsPerSM).toBe(32);
    expect(SCHED_DEFAULTS.threads).toBe(256);
  });

  it('challenge b: 264 slots a wave, so 528 and 792 solve and their neighbors don’t', () => {
    expect(2 * 132).toBe(264);
    expect(noIdleSolved({ blocks: 133, perSM: 1 })).toBe(false);
    for (const b of [528, 792]) {
      expect(noIdleSolved({ blocks: b, perSM: 2 })).toBe(true);
      expect(noIdleSolved({ blocks: b - 1, perSM: 2 })).toBe(false);
      expect(noIdleSolved({ blocks: b + 1, perSM: 2 })).toBe(false);
    }
  });
});

describe('compute 2.3: matrix operations', () => {
  it('quotes the untiled multiply’s rate', () => {
    expect(fmt(matmulRun(0, 1).tflops, 1)).toBe('1.7');
    expect(fmt((matmulRun(0, 1).tflops / 989) * 100, 1)).toBe('0.2');
  });

  it('challenge b: 44.1 µs ÷ 136 ns predicts the 324-vector answer', () => {
    const perVector = batchRun(1024).totalS / 1024;
    expect(us(ONE_VECTOR_S)).toBe('40.1 µs');
    expect(ns(perVector)).toBe('136 ns');
    expect(us(ALLOWANCE * ONE_VECTOR_S)).toBe('44.1 µs');
    expect(Math.floor((ALLOWANCE * ONE_VECTOR_S) / perVector)).toBe(324);
    expect(Math.floor(44.1 / 0.136)).toBe(324);
    expect(largestCheapBatch()).toBe(324);
    // Past the ridge the layer's time is exactly its arithmetic.
    expect(firstComputeBound()).toBe(319);
    expect(batchRun(324).totalS).toBeCloseTo(324 * perVector, 12);
    expect(cheapBatchSolved(BATCH_DEFAULTS.batch)).toBe(false);
    expect(cheapBatchSolved(324)).toBe(true);
    expect(cheapBatchSolved(323)).toBe(false);
    expect(cheapBatchSolved(325)).toBe(false);
  });
});

describe('compute 2.4: memory bandwidth and hierarchy', () => {
  const A = ACCELERATORS.A;
  const at = (p: Partial<MemState>) => ({ ...MEM_DEFAULTS, kernel: 'gemv' as const, batch: BW_BATCH, passes: 1, ...p });

  it('needs 8.00 TB/s for a batch of 128 to be compute-bound', () => {
    expect(BW_BATCH).toBe(128);
    expect(fmt(batchIntensity(BW_BATCH))).toBe('124');
    expect(fmt(A.bf16Tflops / batchIntensity(BW_BATCH), 2)).toBe('7.97');
    expect(lowestComputeBandwidth()).toBe(8);
    expect(fmt(lowestComputeBandwidth() - BW.step, 2)).toBe('7.95');
    expect(runMem(at({ bw: 8 })).bound).toBe('compute');
    expect(runMem(at({ bw: 7.95 })).bound).toBe('memory');
    // The B-class has that bandwidth, but its ridge (281) is far past the batch's 124 FLOPs per byte.
    expect(ACCELERATORS.B.bandwidthTBs).toBe(8);
    expect(Math.round(ridgePoint(ACCELERATORS.B))).toBe(281);
    expect(compareTflops('B', batchIntensity(BW_BATCH))).toBeLessThan(ACCELERATORS.B.bf16Tflops);
  });

  it('solves challenge a only at 8.00 TB/s with a batch of 128 read once', () => {
    expect(bandwidthSolved(MEM_DEFAULTS)).toBe(false);
    expect(bandwidthSolved(at({ bw: 8 }))).toBe(true);
    expect(bandwidthSolved(at({ bw: 7.95 }))).toBe(false);
    expect(bandwidthSolved(at({ bw: 8.05 }))).toBe(false);
    expect(bandwidthSolved(at({ bw: 8, batch: 127 }))).toBe(false);
    expect(bandwidthSolved(at({ bw: 8, passes: 2 }))).toBe(false);
    expect(bandwidthSolved(at({ bw: 8, kernel: 'norm' }))).toBe(false);
    // The rest of the batch's roofline, as the prose quotes it: 319 vectors at the A-class's own bandwidth.
    expect(runMem(at({ bw: A.bandwidthTBs, batch: 319 })).bound).toBe('compute');
    expect(runMem(at({ bw: A.bandwidthTBs, batch: 318 })).bound).toBe('memory');
  });

  it('challenge b: the largest working set two passes keep at 6 TFLOPS is 56 MB, past the L2’s 50 MB', () => {
    const norm = (wsLog: number, p: Partial<MemState> = {}): MemState => ({ ...MEM_DEFAULTS, kernel: 'norm', passes: CACHE_PASSES, wsLog, ...p });
    expect(CACHE_PASSES).toBe(2);
    expect(WS.step).toBe(0.01);
    // The prediction's anchor: a working set that fits reaches 6.70 TFLOPS in two passes.
    expect(fmt(runMem(norm(Math.log10(40))).tflops, 2)).toBe('6.70');
    expect(fmt(runMem(norm(Math.log10(50))).tflops, 2)).toBe('6.70');
    // The L2 logic: 2W FLOPs for 2W − 50 MB of HBM traffic stays at 6 TFLOPS until W ≈ 56.6 MB.
    expect(fmt(cacheLimitMB(), 1)).toBe('56.6');
    expect(largestCachedWorkingSet()).toBe(1.75);
    expect(10 ** 1.75).toBeLessThan(cacheLimitMB());
    expect(10 ** 1.76).toBeGreaterThan(cacheLimitMB());
    const r = runMem(norm(1.75));
    expect(fmt(r.ws / 1e6)).toBe('56');
    expect(r.tflops).toBeGreaterThanOrEqual(6);
    expect(fmt(r.tflops, 2)).toBe('6.03');
    expect(runMem(norm(1.76)).tflops).toBeLessThan(6);
    expect(fmt(runMem(norm(1.76)).tflops, 2)).toBe('5.92');
    // What the success message claims: the cache still holds 50 MB of the second pass.
    expect(pct(r.hitRate)).toBe('89%');
    expect(r.hitRate * r.ws).toBeCloseTo(50e6, 0);
    expect(fmt(r.memoryBytes / 1e6)).toBe('62');
    expect(fmt((r.ws * 2) / 1e6)).toBe('112');
    // Default unsolved; the answer solves; near misses don't.
    expect(cacheSolved(MEM_DEFAULTS)).toBe(false);
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm' })).toBe(false);
    expect(cacheSolved(norm(1.75))).toBe(true);
    expect(cacheSolved(norm(1.74))).toBe(false);
    expect(cacheSolved(norm(1.76))).toBe(false);
    expect(cacheSolved(norm(Math.log10(40)))).toBe(false);
    expect(cacheSolved(norm(1.75, { passes: 3 }))).toBe(false);
    expect(cacheSolved(norm(1.75, { bw: 3.4 }))).toBe(false);
    expect(cacheSolved(norm(1.75, { kernel: 'gemv' }))).toBe(false);
  });
});

describe('compute 2.5: multi-GPU interconnects', () => {
  it('defines bus bandwidth with the quoted values', () => {
    expect(fmt(allReduce('A', 1, GRAD_8B, 'flat').busGBs)).toBe('450');
    expect(fmt(allReduce('A', 2, GRAD_8B, 'flat').busGBs)).toBe('50');
  });

  it('wins by using every network card, not by sending less', () => {
    expect(CHALLENGE_SERVERS).toBe(8);
    expect(fmt(networkShare(8, 'flat'), 2)).toBe('1.97');
    expect(fmt(networkShare(8, 'two-level'), 2)).toBe('1.75');
    expect(networkShare(1, 'flat')).toBe(0);
    // Per card, the two-level all-reduce sends an eighth of the server's share; the flat ring's one card sends it all.
    const flat = allReduce('A', 8, GRAD_8B, 'flat');
    const two = allReduce('A', 8, GRAD_8B, 'two-level');
    expect(flat.dataS).toBeCloseTo((networkShare(8, 'flat') * GRAD_8B) / 50e9, 9);
    expect(two.betweenS).toBeGreaterThan((networkShare(8, 'two-level') * GRAD_8B) / 8 / 50e9);
    expect(two.betweenS).toBeLessThan(flat.seconds / 8);
  });

  it('challenge: 133 ms for 16.1 GB predicts about 24 GB in 0.2 s; the slider’s 22.4 GB solves, in two levels only', () => {
    const eight = allReduce('A', 8, GRAD_8B, 'two-level');
    expect(fmt(eight.seconds, 3)).toBe('0.133');
    expect(bytesText(PREDICTED_BYTES)).toBe('24.2 GB');
    expect(DATA_LOG.step).toBe(0.05);
    expect(largestUnderTarget('two-level')).toBe(10.35);
    expect(10 ** 10.35).toBeLessThan(PREDICTED_BYTES);
    expect(10 ** 10.4).toBeGreaterThan(PREDICTED_BYTES);
    expect(bytesText(10 ** 10.35)).toBe('22.4 GB');
    expect(dur(allReduce('A', 8, 10 ** 10.35, 'two-level').seconds)).toBe('185 ms');
    expect(bytesText(10 ** 10.4)).toBe('25.1 GB');
    expect(dur(allReduce('A', 8, 10 ** 10.4, 'two-level').seconds)).toBe('208 ms');
    // A flat ring manages only about 5 GB in 0.2 s.
    expect(fmt((GRAD_8B * 0.2) / allReduce('A', 8, GRAD_8B, 'flat').seconds / 1e9)).toBe('5');
    expect(largestUnderTarget('flat')).toBe(9.7);
    const at = (p: Partial<typeof CLUSTER_DEFAULTS>) => ({ ...CLUSTER_DEFAULTS, servers: CHALLENGE_SERVERS, algo: 'two-level' as const, ...p });
    expect(clusterSolved(CLUSTER_DEFAULTS)).toBe(false);
    expect(clusterSolved(at({}))).toBe(false); // 16.1 GB in 133 ms: under the target, but not the most
    expect(clusterSolved(at({ logBytes: 10.35 }))).toBe(true);
    expect(clusterSolved(at({ logBytes: 10.3 }))).toBe(false);
    expect(clusterSolved(at({ logBytes: 10.4 }))).toBe(false);
    expect(clusterSolved(at({ logBytes: 10.35, algo: 'flat' }))).toBe(false);
    expect(clusterSolved(at({ logBytes: 9.7, algo: 'flat' }))).toBe(false);
    expect(clusterSolved(at({ logBytes: 10.35, servers: 16 }))).toBe(false);
  });

  it('only the flat ring meets its dashed line at 100 GB', () => {
    const f = allReduce('A', 128, 1e11, 'flat');
    const h = allReduce('A', 128, 1e11, 'two-level');
    expect(dur(f.seconds)).toBe('4.01 s');
    expect(dur(f.dataS)).toBe('4.00 s');
    expect(dur(h.seconds)).toBe('887 ms');
  });
});
