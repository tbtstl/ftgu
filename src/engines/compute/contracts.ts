// A capacity contract and its risks. A trader (or a smaller cloud) commits to pay for a block of
// A-class GPUs every hour for three years and resells their hours. Profit depends on what A-class
// hours fetch over the term — which falls when the next generation arrives in volume (Lessons 5.1,
// 5.2) — on how many hours can be resold (Lesson 5.3), and on how many are lost to failures. Selling
// part of the capacity forward at a fixed price hedges the risk. Many simulated paths give the
// distribution of outcomes. All prices simulated.

import { rng, gaussian } from '../../model/random';

export interface ContractParams {
  gpus: number;
  termQuarters: number;
  /** Paid to the capacity's owner for every hour of the term, $ per GPU-hour. */
  contractPrice: number;
  /** Market price of an A-class hour at the start, $. */
  startPrice: number;
  /** Average decline in that price per quarter before the next generation arrives. */
  drift: number;
  /** Quarterly volatility of the price. */
  vol: number;
  /** Expected quarter in which the B-class reaches volume, and the uncertainty (± quarters, uniform). */
  bArrival: number;
  bArrivalSpread: number;
  /** Fall in the A-class price when it does. */
  bDrop: number;
  /** Share of hours that can be resold, on average, and its quarterly variation. */
  resaleShare: number;
  resaleVol: number;
  /** Share of GPU-hours lost to hardware failures and repairs. */
  failureShare: number;
  /** Share of the capacity sold forward for the whole term, and the price. */
  hedgeShare: number;
  hedgePrice: number;
  /** Annual discount rate. */
  rate: number;
  paths: number;
  seed?: number;
}

export const CONTRACT_DEFAULTS: ContractParams = {
  gpus: 512,
  termQuarters: 12,
  contractPrice: 1.3,
  startPrice: 2.4,
  drift: 0.02,
  vol: 0.08,
  bArrival: 5,
  bArrivalSpread: 2,
  bDrop: 0.25,
  resaleShare: 0.8,
  resaleVol: 0.08,
  failureShare: 0.03,
  hedgeShare: 0,
  hedgePrice: 1.45,
  rate: 0.1,
  paths: 1000,
  seed: 17,
};

export const HOURS_PER_QUARTER = 2190;

/**
 * The fall in an A-class hour's price once B-class hours are plentiful: buyers will pay no more for
 * an A-class hour than a B-class hour costs per A-class equivalent of work.
 */
export function dropFromRatio(bPrice: number, ratio: number, aPrice: number): number {
  return Math.max(0, 1 - bPrice / ratio / aPrice);
}

export interface ContractResult {
  /** Net present value of each path, $, sorted ascending. */
  npvs: number[];
  mean: number;
  /** Standard deviation of the paths' net present values: the square root of their mean squared distance from the mean, $. */
  sd: number;
  p5: number;
  p95: number;
  probLoss: number;
  /** Median and 5th–95th percentile A-class price in each quarter. */
  pricePath: Array<{ q: number; p5: number; p50: number; p95: number }>;
}

function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

export function runContract(c: ContractParams): ContractResult {
  const r = rng(c.seed ?? 17);
  const npvs: number[] = [];
  const prices: number[][] = Array.from({ length: c.termQuarters }, () => []);
  const qRate = (1 + c.rate) ** 0.25;
  for (let i = 0; i < c.paths; i++) {
    const arrival = c.bArrival + Math.round((r() * 2 - 1) * c.bArrivalSpread);
    let price = c.startPrice;
    let npv = 0;
    for (let q = 0; q < c.termQuarters; q++) {
      if (q > 0) price *= Math.exp(-c.drift - (c.vol * c.vol) / 2 + c.vol * gaussian(r));
      if (q === arrival) price *= 1 - c.bDrop;
      prices[q].push(price);
      const resale = Math.max(0, Math.min(1, c.resaleShare + c.resaleVol * gaussian(r)));
      const avail = 1 - c.failureShare;
      const perGpuHour = c.hedgeShare * c.hedgePrice * avail + (1 - c.hedgeShare) * avail * resale * price - c.contractPrice;
      npv += (c.gpus * HOURS_PER_QUARTER * perGpuHour) / qRate ** (q + 1);
    }
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const sd = Math.sqrt(npvs.reduce((a, b) => a + (b - mean) ** 2, 0) / npvs.length);
  return {
    npvs,
    mean,
    sd,
    p5: pct(npvs, 0.05),
    p95: pct(npvs, 0.95),
    probLoss: npvs.filter((x) => x < 0).length / npvs.length,
    pricePath: prices.map((ps, q) => {
      const s = [...ps].sort((a, b) => a - b);
      return { q, p5: pct(s, 0.05), p50: pct(s, 0.5), p95: pct(s, 0.95) };
    }),
  };
}
