// How accelerators come into existence, quarter by quarter. Silicon wafers become dies (and defects
// scrap some of them), dies meet stacks of high-bandwidth memory in an advanced package, and the
// finished GPUs wait for a data center with the power to run them. Each stage has its own capacity,
// growing at its own pace, and the scarcest one sets how many GPUs reach service. A new generation
// competes with the old for the same wafers, memory and packaging. All quantities are simulated.

import { ACCELERATORS } from '../../model/compute/hardware';

/** Wafer diameter, mm. */
export const WAFER_MM = 300;

/** Gross dies on a wafer for a die of `areaMm2` (the standard estimate, losing partial dies at the edge). */
export function diesPerWafer(areaMm2: number): number {
  const r = WAFER_MM / 2;
  return Math.max(0, Math.floor((Math.PI * r * r) / areaMm2 - (Math.PI * WAFER_MM) / Math.sqrt(2 * areaMm2)));
}

/** Share of dies with no killer defect (Poisson model), for defect density per cm² and die area in mm². */
export function dieYield(defectsPerCm2: number, areaMm2: number): number {
  return Math.exp(-defectsPerCm2 * (areaMm2 / 100));
}

export type Gen = 'A' | 'B';

/** What each generation needs to build one GPU. */
export const BUILD: Record<Gen, { dieMm2: number; dies: number; hbmStacks: number; gridKW: number }> = {
  // 80 GB in five 16 GB stacks; grid power per GPU = IT kW × a typical 1.25 PUE (air-cooled).
  A: { dieMm2: 814, dies: 1, hbmStacks: 5, gridKW: 1.16 * 1.25 },
  // Two large dies in one package; 192 GB in eight 24 GB stacks; liquid-cooled at ~1.15 PUE.
  B: { dieMm2: 800, dies: 2, hbmStacks: 8, gridKW: 1.41 * 1.15 },
};

/** Work one GPU does relative to an A-class: the ratio of their BF16 throughput. */
export const A_EQUIVALENT: Record<Gen, number> = { A: 1, B: ACCELERATORS.B.bf16Tflops / ACCELERATORS.A.bf16Tflops };

export interface SupplyParams {
  quarters: number;
  /** Wafers per quarter allotted to accelerators, thousands, and their growth per quarter. */
  wafers: number;
  waferGrowth: number;
  defectsPerCm2: number;
  /** HBM stacks per quarter, millions, and growth. */
  hbm: number;
  hbmGrowth: number;
  /** Advanced packages per quarter, thousands, and growth. */
  packaging: number;
  packagingGrowth: number;
  /** Data-center power coming online per quarter, MW, and growth. */
  powerMW: number;
  powerGrowth: number;
  /** Quarter (0-based) in which B-class production starts; it takes 3 quarters to ramp. */
  bStart: number;
  /** Most of the shared capacity the B-class takes once ramped. */
  bShareMax: number;
  /** A-class-equivalent GPUs the market wants installed at quarter 0, thousands, and growth. */
  demand: number;
  demandGrowth: number;
}

export const SUPPLY_DEFAULTS: SupplyParams = {
  quarters: 12,
  wafers: 30,
  waferGrowth: 0.04,
  defectsPerCm2: 0.1,
  hbm: 3.5,
  hbmGrowth: 0.08,
  packaging: 600,
  packagingGrowth: 0.1,
  powerMW: 900,
  powerGrowth: 0.04,
  bStart: 4,
  bShareMax: 0.85,
  demand: 1800,
  demandGrowth: 0.2,
};

export type Stage = 'wafers' | 'memory' | 'packaging' | 'power';

export interface Quarter {
  q: number;
  bShare: number;
  /** GPUs each stage could support this quarter, thousands, by generation. */
  capacity: Record<Stage, Record<Gen, number>>;
  /** GPUs built, thousands. */
  built: Record<Gen, number>;
  /** GPUs switched on in data centers, thousands. */
  deployed: Record<Gen, number>;
  /** Built GPUs still waiting for power at quarter end, thousands. */
  waiting: number;
  /** Cumulative GPUs in service, thousands. */
  installed: Record<Gen, number>;
  /** Installed work in A-class equivalents, thousands. */
  installedAEq: number;
  demandAEq: number;
  /** The stage that limited output this quarter. */
  binding: Stage;
}

/** Share of shared capacity going to the B-class in quarter q. */
export function bShareAt(p: SupplyParams, q: number): number {
  if (q < p.bStart) return 0;
  return Math.min(p.bShareMax, (p.bShareMax * (q - p.bStart + 1)) / 3);
}

/**
 * The supply chain over `quarters`. Shared capacity is split between generations in proportion to
 * the B-class's share. GPUs built in one quarter can be switched on from the next, as power allows;
 * the rest wait (quarter 0 deploys the previous quarter's output, taken to equal its own). Starts
 * with an installed base of 1 million A-class GPUs.
 */
export function supplyChain(p: SupplyParams): Quarter[] {
  const out: Quarter[] = [];
  const installed: Record<Gen, number> = { A: 1000, B: 0 };
  let waiting: Record<Gen, number> = { A: 0, B: 0 };
  for (let q = 0; q < p.quarters; q++) {
    const g = (base: number, growth: number) => base * (1 + growth) ** q;
    const share: Record<Gen, number> = { A: 1 - bShareAt(p, q), B: bShareAt(p, q) };
    const goodDies = (gen: Gen) => diesPerWafer(BUILD[gen].dieMm2) * dieYield(p.defectsPerCm2, BUILD[gen].dieMm2);
    const cap: Record<Stage, Record<Gen, number>> = { wafers: { A: 0, B: 0 }, memory: { A: 0, B: 0 }, packaging: { A: 0, B: 0 }, power: { A: 0, B: 0 } };
    const built: Record<Gen, number> = { A: 0, B: 0 };
    const stageScore: Record<Stage, number> = { wafers: 0, memory: 0, packaging: 0, power: 0 };
    for (const gen of ['A', 'B'] as Gen[]) {
      cap.wafers[gen] = (g(p.wafers, p.waferGrowth) * share[gen] * goodDies(gen)) / BUILD[gen].dies;
      cap.memory[gen] = (g(p.hbm, p.hbmGrowth) * 1000 * share[gen]) / BUILD[gen].hbmStacks;
      cap.packaging[gen] = g(p.packaging, p.packagingGrowth) * share[gen];
      built[gen] = Math.min(cap.wafers[gen], cap.memory[gen], cap.packaging[gen]);
    }
    // Power: MW coming online this quarter, shared in proportion to what is ready to deploy.
    const mw = g(p.powerMW, p.powerGrowth);
    const ready: Record<Gen, number> = { A: waiting.A + (q > 0 ? (out[q - 1]?.built.A ?? 0) : built.A), B: waiting.B + (q > 0 ? (out[q - 1]?.built.B ?? 0) : built.B) };
    const needMW = ready.A * BUILD.A.gridKW + ready.B * BUILD.B.gridKW; // thousands × kW = MW
    const scale = needMW > 0 ? Math.min(1, mw / needMW) : 1;
    const deployed: Record<Gen, number> = { A: ready.A * scale, B: ready.B * scale };
    for (const gen of ['A', 'B'] as Gen[]) cap.power[gen] = needMW > 0 ? (mw * (ready[gen] * BUILD[gen].gridKW)) / needMW / BUILD[gen].gridKW : 0;
    waiting = { A: ready.A - deployed.A, B: ready.B - deployed.B };
    installed.A += deployed.A;
    installed.B += deployed.B;
    // The binding stage: the one whose total (in A-equivalent work) is smallest among those that limited building, or power if GPUs are waiting.
    const total = (s: Stage) => cap[s].A * A_EQUIVALENT.A + cap[s].B * A_EQUIVALENT.B;
    for (const s of ['wafers', 'memory', 'packaging'] as Stage[]) stageScore[s] = total(s);
    let binding: Stage = 'wafers';
    for (const s of ['memory', 'packaging'] as Stage[]) if (stageScore[s] < stageScore[binding]) binding = s;
    if (scale < 1) binding = 'power';
    out.push({
      q,
      bShare: share.B,
      capacity: cap,
      built,
      deployed,
      waiting: waiting.A + waiting.B,
      installed: { ...installed },
      installedAEq: installed.A * A_EQUIVALENT.A + installed.B * A_EQUIVALENT.B,
      demandAEq: g(p.demand, p.demandGrowth),
      binding,
    });
  }
  return out;
}
