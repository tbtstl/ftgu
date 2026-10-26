// Demand for a GPU cloud's capacity, hour by hour, from four kinds of customer: inference that
// follows people's days, developers who work office hours, training runs that arrive as big blocks
// and stay for days, and batch work that can run whenever there is room. All measured in A-class-
// equivalent GPUs and simulated with a seeded random stream.

import { rng, gaussian } from '../../model/random';

export interface DemandParams {
  weeks: number;
  /** Inference GPUs at the busiest hour of a weekday in week 0. */
  inferencePeak: number;
  /** How far the night trough falls below the peak, as a share of the peak (0–1). */
  inferenceSwing: number;
  /** How much lower weekend inference is (0–1). */
  weekendDip: number;
  /** Inference growth per week. */
  growthPerWeek: number;
  /** GPUs used by developers during working hours (09:00–18:00 weekdays). */
  devGpus: number;
  /** Training runs starting per week, on average. */
  trainingPerWeek: number;
  /** GPUs each training run takes. */
  trainingSize: number;
  /** Days each training run lasts. */
  trainingDays: number;
  /** Batch work submitted per day, GPU-hours. */
  batchPerDay: number;
  /** Batch work may run whenever there is spare capacity (else it runs as submitted, 09:00–17:00 every day). */
  batchFlexible: boolean;
  /** GPUs in the fleet. */
  capacity: number;
  seed?: number;
}

export const DEMAND_DEFAULTS: DemandParams = {
  weeks: 4,
  inferencePeak: 2400,
  inferenceSwing: 0.55,
  weekendDip: 0.2,
  growthPerWeek: 0.02,
  devGpus: 300,
  trainingPerWeek: 0.75,
  trainingSize: 1024,
  trainingDays: 9,
  batchPerDay: 12000,
  batchFlexible: true,
  capacity: 5000,
  seed: 3,
};

export interface DemandSeries {
  hours: number;
  inference: number[];
  dev: number[];
  training: number[];
  /** Batch work actually scheduled each hour. */
  batch: number[];
  total: number[];
  /** Demand the fleet couldn't serve, GPUs. */
  unmet: number[];
  capacity: number;
  /** Training runs: start hour and GPUs. */
  runs: Array<{ start: number; end: number; gpus: number }>;
  /** Share of fleet GPU-hours in use. */
  utilization: number;
  /** Share of demanded GPU-hours that went unserved (batch that never found room included). */
  unmetShare: number;
  peak: number;
  /** Batch GPU-hours that never found room. */
  batchUnplaced: number;
}

const WORK_START = 9;
const WORK_END = 18;

/** Hourly demand over `weeks` weeks, and how much of it a fleet of `capacity` GPUs serves. */
export function weeklyDemand(p: DemandParams): DemandSeries {
  const H = p.weeks * 168;
  const r = rng(p.seed ?? 3);
  const inference: number[] = [];
  const dev: number[] = [];
  const training = Array<number>(H).fill(0);
  const firm: number[] = [];
  // Training runs: Poisson arrivals over the period (one draw per day), each a fixed block.
  const runs: DemandSeries['runs'] = [];
  for (let day = -Math.ceil(p.trainingDays); day < p.weeks * 7; day++) {
    if (r() < p.trainingPerWeek / 7) {
      const start = day * 24 + Math.floor(r() * 24);
      const end = start + Math.round(p.trainingDays * 24);
      runs.push({ start, end, gpus: p.trainingSize });
      for (let h = Math.max(0, start); h < Math.min(H, end); h++) training[h] += p.trainingSize;
    }
  }
  for (let h = 0; h < H; h++) {
    const day = Math.floor(h / 24);
    const hod = h % 24;
    const weekend = day % 7 >= 5;
    const growth = (1 + p.growthPerWeek) ** (h / 168);
    // Peak mid-afternoon, trough before dawn, with a little noise.
    const shape = 1 - p.inferenceSwing * (0.5 - 0.5 * Math.cos((2 * Math.PI * (hod - 15)) / 24));
    const inf = p.inferencePeak * growth * shape * (weekend ? 1 - p.weekendDip : 1) * (1 + 0.03 * gaussian(r));
    inference.push(Math.max(0, inf));
    dev.push(!weekend && hod >= WORK_START && hod < WORK_END ? p.devGpus : 0);
    firm.push(inference[h] + dev[h] + training[h]);
  }
  // Batch: each day's work either fills that day's emptiest hours (water-filling up to capacity) or runs as submitted.
  const batch = Array<number>(H).fill(0);
  let batchUnplaced = 0;
  for (let day = 0; day < p.weeks * 7; day++) {
    const hs = Array.from({ length: 24 }, (_, i) => day * 24 + i);
    if (p.batchFlexible) {
      let left = p.batchPerDay;
      // Raise a level across the day's hours until the work is placed or the fleet is full.
      let lo = 0;
      let hi = p.capacity;
      const placedAt = (level: number) => hs.reduce((s, h) => s + Math.max(0, Math.min(p.capacity, level) - firm[h]), 0);
      if (placedAt(p.capacity) <= left) {
        for (const h of hs) batch[h] = Math.max(0, p.capacity - firm[h]);
        left -= placedAt(p.capacity);
        batchUnplaced += left;
      } else {
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2;
          if (placedAt(mid) > left) hi = mid;
          else lo = mid;
        }
        for (const h of hs) batch[h] = Math.max(0, Math.min(p.capacity, hi) - firm[h]);
      }
    } else {
      const work = hs.filter((h) => h % 24 >= WORK_START && h % 24 < 17);
      for (const h of work) batch[h] = p.batchPerDay / work.length;
    }
  }
  const total: number[] = [];
  const unmet: number[] = [];
  let used = 0;
  let demanded = 0;
  let unserved = batchUnplaced;
  let peak = 0;
  for (let h = 0; h < H; h++) {
    const t = firm[h] + batch[h];
    total.push(t);
    const u = Math.max(0, t - p.capacity);
    unmet.push(u);
    used += Math.min(t, p.capacity);
    demanded += t;
    unserved += u;
    peak = Math.max(peak, t);
  }
  demanded += batchUnplaced;
  return { hours: H, inference, dev, training, batch, total, unmet, capacity: p.capacity, runs, utilization: used / (H * p.capacity), unmetShare: demanded > 0 ? unserved / demanded : 0, peak, batchUnplaced };
}

/** Standard normal cumulative distribution. */
export function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse of normalCdf (bisection; fine for charts). */
export function normalQuantile(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface FanPoint {
  month: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  /** Chance demand exceeds `capacity` this month. */
  shortfall: number;
}

/**
 * A forecast fan: demand grows by `growth` a month on average, with each month's growth uncertain
 * by `sigma` (independent, compounding — lognormal). Percentiles of demand for each month ahead,
 * and the chance it outruns a fixed `capacity`.
 */
export function growthFan(start: number, months: number, growth: number, sigma: number, capacity: number): FanPoint[] {
  const out: FanPoint[] = [];
  const mu = Math.log(1 + growth) - (sigma * sigma) / 2;
  for (let m = 0; m <= months; m++) {
    const mean = Math.log(start) + mu * m;
    const sd = sigma * Math.sqrt(m);
    const q = (p: number) => Math.exp(mean + sd * normalQuantile(p));
    out.push({
      month: m,
      p5: m === 0 ? start : q(0.05),
      p25: m === 0 ? start : q(0.25),
      p50: m === 0 ? start : q(0.5),
      p75: m === 0 ? start : q(0.75),
      p95: m === 0 ? start : q(0.95),
      shortfall: m === 0 ? (start > capacity ? 1 : 0) : 1 - normalCdf((Math.log(capacity) - mean) / sd),
    });
  }
  return out;
}
