// Lesson 7.5's strategy test: the capstone business (cloud.ts's simulateBusiness) with two more
// drivers exposed — the price of energy, and how many years the servers must pay for themselves in
// (Lesson 4.5's server-life bet). With both at their starting values it reproduces simulateBusiness
// exactly; it only rescales the design's power cost and recomputes its yearly fixed cost.

import { gaussian, rng } from '../../model/random';
import { GPU_IDS } from '../../model/compute/hardware';
import { SITES } from '../../model/compute/sites';
import { FINANCE, WORLD_DEFAULT, operateWith, prepare, type BusinessResult, type Customer, type FleetDesign, type OpsContext, type OpsPlan, type PriceBook, type WorldScenario } from './cloud';
import { gpuHourCost } from './facilityCost';

export interface Levers {
  /** Multiplier on the site's electricity price. */
  energyScale: number;
  /** Years the servers and network must pay for themselves in. */
  serverLifeYears: number;
}

export const LEVERS_DEFAULT: Levers = { energyScale: 1, serverLifeYears: FINANCE.serverLifeYears };

/** The fleet's fixed cost per year (capital recovery, network, upkeep) for a server life. */
export function fixedPerYearFor(ctx: OpsContext, serverLifeYears: number): number {
  const { f, ev } = ctx;
  const networkPerGpu = ev.fabric.costPerGpu * (ev.fabric.tooBig ? 1.5 : 1);
  let total = 0;
  for (const g of GPU_IDS) {
    if (f.gpus[g] <= 0) continue;
    const c = gpuHourCost({ gpu: g, cooling: f.cooling, site: SITES[f.site], pue: ev.pue, utilization: 1, serverLifeYears, facilityLifeYears: FINANCE.facilityLifeYears, rate: FINANCE.rate, networkPerGpu });
    total += f.gpus[g] * (c.totalYear - c.powerYear);
  }
  return total;
}

/** The design's operating context with the levers applied. */
export function contextUnder(customers: Customer[], book: PriceBook, f: FleetDesign, levers: Levers = LEVERS_DEFAULT): OpsContext {
  const ctx = prepare(customers, book, f);
  if (levers.energyScale === 1 && levers.serverLifeYears === FINANCE.serverLifeYears) return ctx;
  const powerPerBusyHour = { ...ctx.ev.powerPerBusyHour };
  for (const g of GPU_IDS) powerPerBusyHour[g] *= levers.energyScale;
  return { ...ctx, ev: { ...ctx.ev, powerPerBusyHour, fixedPerYear: fixedPerYearFor(ctx, levers.serverLifeYears) } };
}

/**
 * simulateBusiness with the levers: the same paths (same random draws), each quarter a representative
 * weekday and weekend day of Lesson 7.4's operations scaled to the quarter's 65 and 26, demand grown along the path, willingness to pay cut
 * once the next generation arrives, capacity reduced by failures, discounted at the world's rate.
 */
export function businessUnder(customers: Customer[], book: PriceBook, f: FleetDesign, ops: OpsPlan, w: WorldScenario = WORLD_DEFAULT, levers: Levers = LEVERS_DEFAULT): BusinessResult {
  const r = rng(w.seed ?? 41);
  const npvs: number[] = [];
  const byQuarter: number[][] = Array.from({ length: w.quarters }, () => []);
  const qRate = (1 + w.rate) ** 0.25;
  const ctx = contextUnder(customers, book, f, levers);
  for (let path = 0; path < w.paths; path++) {
    const scale = customers.map(() => 1);
    const arrival = w.nextGenQuarter + Math.round((r() * 2 - 1) * w.nextGenSpread);
    let npv = 0;
    for (let q = 0; q < w.quarters; q++) {
      if (q > 0) customers.forEach((c, i) => (scale[i] *= Math.exp(Math.log(1 + c.growth) - (w.growthSigma * w.growthSigma) / 2 + w.growthSigma * gaussian(r))));
      const valueScale = q >= arrival ? 1 - w.nextGenDrop : 1;
      const opts = { hours: 24, demandScale: scale, valueScale, capacityShare: 1 - w.failureShare, seed: 31 + q };
      // A quarter is 13 weeks: 65 weekdays like Monday and 26 weekend days like Saturday.
      const profit = 65 * operateWith(ctx, ops, opts).profit + 26 * operateWith(ctx, ops, { ...opts, startHour: 120 }).profit;
      byQuarter[q].push(profit);
      npv += profit / qRate ** (q + 1);
    }
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const stdev = Math.sqrt(npvs.reduce((s, x) => s + (x - mean) ** 2, 0) / npvs.length);
  return {
    npvs,
    mean,
    p5: npvs[Math.floor(0.05 * npvs.length)],
    stdev,
    probLoss: npvs.filter((x) => x < 0).length / npvs.length,
    riskAdjusted: mean - 0.5 * stdev,
    quarterMedian: byQuarter.map((xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]),
  };
}
