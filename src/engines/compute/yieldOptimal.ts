// The best allocation of a GPU fleet, hour by hour. yieldManager.ts hands out GPUs by rules — first
// come, first served, or the highest bid first. Here the fleet's GPUs are given out the way Lesson
// 5.5's market cleared: as a linear program that maximizes the hour's contribution margin, with
// each GPU type's supply and each workload's demand as constraints. Its by-product is the shadow
// price of each kind of GPU in each hour — what one more of them would add to the margin — which is
// the true opportunity cost of using one: the work it displaces can move to other GPUs, so the loss
// is what the whole fleet gives up, not the gap between two bids. Same workloads, same demand draws
// as yieldManager.ts's 'best-value' policy, so the policies can be compared hour by hour.

import { solveLP } from '../market/lp';
import { rng, gaussian } from '../../model/random';
import { GPU_IDS, type GpuId } from '../../model/compute/hardware';
import type { WorkloadId } from '../../model/compute/workloads';
import { busyCost, productivityUnder, type Physics, type YieldParams, type YieldResult, type YieldWorkload } from './yieldManager';

const INTERACTIVE: WorkloadId[] = ['code8', 'frontier400', 'chat70'];

/**
 * Each hour's demand, in A-class equivalents, drawn exactly as yieldRun draws it for the
 * 'best-value' policy (same seed, same order), so the two see the same week.
 */
export function weekDemand(workloads: YieldWorkload[], hours: number, seed = 21): Array<Record<WorkloadId, number>> {
  const r = rng(seed);
  const out: Array<Record<WorkloadId, number>> = [];
  for (let h = 0; h < hours; h++) {
    const need = {} as Record<WorkloadId, number>;
    for (const w of workloads) {
      const wave = 1 + w.swing * Math.cos((2 * Math.PI * ((h % 24) - 15)) / 24);
      need[w.id] = Math.max(0, w.mean * wave * (1 + 0.08 * gaussian(r)));
    }
    out.push(need);
  }
  return out;
}

export interface HourInput {
  fleet: Record<GpuId, number>;
  workloads: YieldWorkload[];
  /** Work wanted this hour, A-class equivalents. */
  need: Record<WorkloadId, number>;
  physics: Physics;
  powerPrice: number;
  /** B-class GPUs only interactive work may use. */
  protectB?: number;
}

export interface HourPlan {
  /** Revenue minus electricity this hour, $. */
  margin: number;
  /** GPUs of each type given to each workload. */
  gpus: Record<WorkloadId, Record<GpuId, number>>;
}

/** The hour's allocation that earns the most contribution margin (a linear program). */
export function bestHour(p: HourInput): HourPlan {
  const prod = productivityUnder(p.physics);
  const vars: Array<{ w: WorkloadId; g: GpuId; per: number; prod: number }> = [];
  for (const w of p.workloads)
    for (const g of GPU_IDS) {
      const pr = prod[w.id][g];
      if (pr <= 0 || p.fleet[g] <= 0) continue;
      const per = w.value * pr - busyCost(g, p.powerPrice);
      if (per <= 0) continue;
      vars.push({ w: w.id, g, per, prod: pr });
    }
  const gpus = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const w of p.workloads) gpus[w.id] = { L: 0, A: 0, B: 0 };
  if (!vars.length) return { margin: 0, gpus };
  const A: number[][] = [];
  const b: number[] = [];
  for (const g of GPU_IDS) {
    const row = vars.map((v) => (v.g === g ? 1 : 0));
    if (row.some((x) => x)) {
      A.push(row);
      b.push(p.fleet[g]);
    }
  }
  for (const w of p.workloads) {
    const row = vars.map((v) => (v.w === w.id ? v.prod : 0));
    if (row.some((x) => x)) {
      A.push(row);
      b.push(Math.max(0, p.need[w.id] ?? 0));
    }
  }
  const protect = Math.min(p.protectB ?? 0, p.fleet.B);
  if (protect > 0) {
    const row = vars.map((v) => (v.g === 'B' && !INTERACTIVE.includes(v.w) ? 1 : 0));
    if (row.some((x) => x)) {
      A.push(row);
      b.push(p.fleet.B - protect);
    }
  }
  const sol = solveLP({ c: vars.map((v) => -v.per), A, b, sense: A.map(() => '<=' as const) });
  vars.forEach((v, i) => (gpus[v.w][v.g] += sol.x[i] ?? 0));
  return { margin: -sol.objective, gpus };
}

/**
 * Shadow price of each GPU type in an hour, $ per GPU-hour: how much the hour's margin rises with
 * `step` more GPUs of that type, per GPU. It is what one GPU-hour of that type is worth to the fleet
 * at the margin — the opportunity cost of giving one to any particular workload.
 */
export function hourShadowPrices(p: HourInput, step = 1): Record<GpuId, number> {
  const base = bestHour(p).margin;
  const out = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) {
    const more = bestHour({ ...p, fleet: { ...p.fleet, [g]: p.fleet[g] + step } }).margin;
    out[g] = Math.max(0, (more - base) / step);
  }
  return out;
}

/** A week (or any number of hours) under the best allocation, in yieldRun's format. */
export function yieldRunBest(p: Omit<YieldParams, 'policy'>): YieldResult {
  const prod = productivityUnder(p.physics);
  const demand = weekDemand(p.workloads, p.hours, p.seed ?? 21);
  const util: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const revByGpu: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const servedWork: Record<string, number> = {};
  const wanted: Record<string, number> = {};
  const gpuHours = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const w of p.workloads) {
    servedWork[w.id] = 0;
    wanted[w.id] = 0;
    gpuHours[w.id] = { L: 0, A: 0, B: 0 };
  }
  let revenue = 0;
  let powerCost = 0;
  for (const need of demand) {
    const plan = bestHour({ fleet: p.fleet, workloads: p.workloads, need, physics: p.physics, powerPrice: p.powerPrice, protectB: p.protectB });
    for (const w of p.workloads) {
      wanted[w.id] += need[w.id];
      for (const g of GPU_IDS) {
        const n = plan.gpus[w.id][g];
        if (n <= 0) continue;
        const work = n * prod[w.id][g];
        servedWork[w.id] += work;
        gpuHours[w.id][g] += n;
        util[g] += n;
        revenue += work * w.value;
        revByGpu[g] += work * w.value;
        powerCost += n * busyCost(g, p.powerPrice);
      }
    }
  }
  const H = Math.max(1, p.hours);
  const served = {} as Record<WorkloadId, number>;
  for (const w of p.workloads) served[w.id] = wanted[w.id] > 0 ? servedWork[w.id] / wanted[w.id] : 1;
  return {
    revenue,
    powerCost,
    margin: revenue - powerCost,
    utilization: { L: util.L / (H * Math.max(1, p.fleet.L)), A: util.A / (H * Math.max(1, p.fleet.A)), B: util.B / (H * Math.max(1, p.fleet.B)) },
    served,
    revenueByGpu: revByGpu,
    gpuHours,
  };
}
