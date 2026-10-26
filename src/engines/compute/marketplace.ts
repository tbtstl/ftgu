// A market for GPU-hours across sites and accelerators. Buyers want work done (measured in
// A-class-equivalent GPU-hours) and will pay up to some value for it; each accelerator does a
// different amount of each buyer's work (Lesson 3.5), and each site is a different distance from
// users (latency) and pays a different price for power. Clearing the market — giving every GPU to
// whoever values it most — is a linear program, and the price of each kind of GPU in each place is
// what one more of it would be worth: its shadow price, the way a nodal electricity price is the
// value of one more megawatt-hour at a node. All quantities and values are simulated.

import { solveLP } from '../market/lp';
import { GPU_IDS, serverPowerW, type GpuId } from '../../model/compute/hardware';
import { SITES, SITE_IDS, type SiteId } from '../../model/compute/sites';
import type { WorkloadId } from '../../model/compute/workloads';
import { workloadFit } from './compatibility';

export interface Buyer {
  id: WorkloadId;
  /** Work wanted, in A-class-equivalent GPUs (GPUs that would be needed if all were A-class). */
  quantity: number;
  /** Most the buyer pays for an A-class-equivalent GPU-hour of its work, $. */
  value: number;
  /** Longest round trip to users the buyer accepts, ms. */
  maxRttMs: number;
}

export type Supply = Record<SiteId, Record<GpuId, number>>;

/** Work one GPU of type g does for a workload, in A-class equivalents (0 if it can't run it). */
export function productivity(id: WorkloadId, g: GpuId): number {
  const a = workloadFit(id, 'A');
  const f = workloadFit(id, g);
  if (!f.feasible || !a.feasible) return 0;
  return a.gpus / f.gpus;
}

/** Running cost of a GPU-hour at a site: its power at full load, through the site's PUE, at the site's price, $. */
export function variableCost(site: SiteId, g: GpuId, pue = 1.25): number {
  const kw = serverPowerW(g, g === 'B' ? 'liquid' : 'air') / 1000 / 8;
  return (kw * pue * SITES[site].powerPrice) / 1000;
}

export interface Clearing {
  /** GPUs of each kind at each site given to each buyer. */
  allocation: Array<{ buyer: WorkloadId; site: SiteId; gpu: GpuId; gpus: number; work: number }>;
  /** Work served per buyer, A-equivalent GPUs. */
  served: Record<string, number>;
  /** Price of a GPU-hour of each kind at each site, $ (shadow price plus running cost). */
  prices: Record<SiteId, Record<GpuId, number>>;
  /** GPUs of each kind at each site left idle. */
  idle: Record<SiteId, Record<GpuId, number>>;
  /** Total value created per hour, net of running costs, $. */
  welfare: number;
}

interface Var {
  buyer: WorkloadId;
  site: SiteId;
  gpu: GpuId;
  net: number;
  prod: number;
}

function variables(buyers: Buyer[], supply: Supply): Var[] {
  const vars: Var[] = [];
  for (const b of buyers)
    for (const s of SITE_IDS) {
      if (SITES[s].rttMs > b.maxRttMs) continue;
      for (const g of GPU_IDS) {
        if (supply[s][g] <= 0) continue;
        const prod = productivity(b.id, g);
        if (prod <= 0) continue;
        const net = b.value * prod - variableCost(s, g);
        if (net <= 0) continue;
        vars.push({ buyer: b.id, site: s, gpu: g, net, prod });
      }
    }
  return vars;
}

/** Best total net value for a supply, and the allocation that achieves it. */
function solve(buyers: Buyer[], supply: Supply) {
  const vars = variables(buyers, supply);
  if (!vars.length) return { welfare: 0, x: [] as number[], vars };
  const A: number[][] = [];
  const b: number[] = [];
  for (const s of SITE_IDS)
    for (const g of GPU_IDS) {
      const row = vars.map((v) => (v.site === s && v.gpu === g ? 1 : 0));
      if (row.some((x) => x)) {
        A.push(row);
        b.push(supply[s][g]);
      }
    }
  for (const by of buyers) {
    const row = vars.map((v) => (v.buyer === by.id ? v.prod : 0));
    if (row.some((x) => x)) {
      A.push(row);
      b.push(by.quantity);
    }
  }
  const sol = solveLP({ c: vars.map((v) => -v.net), A, b, sense: A.map(() => '<=' as const) });
  return { welfare: -sol.objective, x: sol.x, vars };
}

/**
 * Clear the market. Prices are found by adding a small block of GPUs of each kind at each site and
 * measuring how much more value the market creates — the shadow price — then adding the running cost.
 */
export function clearMarket(buyers: Buyer[], supply: Supply, step = 10): Clearing {
  const base = solve(buyers, supply);
  const allocation = base.vars.map((v, i) => ({ buyer: v.buyer, site: v.site, gpu: v.gpu, gpus: base.x[i] ?? 0, work: (base.x[i] ?? 0) * v.prod })).filter((a) => a.gpus > 1e-6);
  const served: Record<string, number> = {};
  for (const by of buyers) served[by.id] = 0;
  for (const a of allocation) served[a.buyer] += a.work;
  const prices = {} as Clearing['prices'];
  const idle = {} as Clearing['idle'];
  for (const s of SITE_IDS) {
    prices[s] = {} as Record<GpuId, number>;
    idle[s] = {} as Record<GpuId, number>;
    for (const g of GPU_IDS) {
      const used = allocation.filter((a) => a.site === s && a.gpu === g).reduce((t, a) => t + a.gpus, 0);
      idle[s][g] = Math.max(0, supply[s][g] - used);
      const more = { ...supply, [s]: { ...supply[s], [g]: supply[s][g] + step } } as Supply;
      const shadow = Math.max(0, (solve(buyers, more).welfare - base.welfare) / step);
      prices[s][g] = shadow + variableCost(s, g);
    }
  }
  return { allocation, served, prices, idle, welfare: base.welfare };
}

/**
 * The prices of only some kinds of GPU at some sites: the same shadow price plus running cost that clearMarket
 * reports for them, without solving for the rest (one linear program per price, plus one, instead of ten).
 */
export function pricesAt(buyers: Buyer[], supply: Supply, which: Array<{ site: SiteId; gpu: GpuId }>, step = 10): number[] {
  const base = solve(buyers, supply).welfare;
  return which.map(({ site, gpu }) => {
    const more = { ...supply, [site]: { ...supply[site], [gpu]: supply[site][gpu] + step } } as Supply;
    return Math.max(0, (solve(buyers, more).welfare - base) / step) + variableCost(site, gpu);
  });
}

/** The course's reference regional market (simulated). */
export const MARKET_SUPPLY: Supply = {
  marston: { L: 1500, A: 3000, B: 1000 },
  techpark: { L: 2000, A: 8000, B: 3000 },
  fernhill: { L: 0, A: 6000, B: 6000 },
};

export const MARKET_BUYERS: Buyer[] = [
  { id: 'code8', quantity: 3000, value: 5.0, maxRttMs: 20 },
  { id: 'chat70', quantity: 14000, value: 3.5, maxRttMs: 30 },
  { id: 'frontier400', quantity: 6000, value: 4.5, maxRttMs: 30 },
  { id: 'train70', quantity: 10000, value: 2.6, maxRttMs: Infinity },
  { id: 'tune8', quantity: 2000, value: 2.4, maxRttMs: Infinity },
  { id: 'batch8', quantity: 20000, value: 1.4, maxRttMs: Infinity },
];
