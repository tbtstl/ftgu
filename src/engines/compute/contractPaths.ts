// The paths behind a capacity contract's distribution, quarter by quarter. contracts.ts reports only
// each path's net present value; this replays exactly the same random draws, in the same order, and
// keeps what happened along the way — the price, the share of hours resold, the cash — so a lesson
// can show what a losing path looks like. Same parameters, same seed, same numbers.

import { rng, gaussian } from '../../model/random';
import { HOURS_PER_QUARTER, type ContractParams } from './contracts';

export interface QuarterDetail {
  /** 0-based quarter. */
  q: number;
  /** Market price of an A-class hour this quarter, $. */
  price: number;
  /** Share of the unhedged hours resold. */
  resale: number;
  /** What each contracted GPU-hour earns (forward sales plus resales, after failures), $. */
  earnedPerHour: number;
  /** Cash for the whole block this quarter, $. */
  cash: number;
  /** That cash discounted to the start, $. */
  discounted: number;
}

export interface PathDetail {
  /** 0-based quarter in which the B-class reaches volume on this path. */
  arrival: number;
  quarters: QuarterDetail[];
  npv: number;
}

/** Every simulated path of a contract, in the order contracts.ts draws them. */
export function contractPaths(c: ContractParams): PathDetail[] {
  const r = rng(c.seed ?? 17);
  const qRate = (1 + c.rate) ** 0.25;
  const paths: PathDetail[] = [];
  for (let i = 0; i < c.paths; i++) {
    const arrival = c.bArrival + Math.round((r() * 2 - 1) * c.bArrivalSpread);
    let price = c.startPrice;
    let npv = 0;
    const quarters: QuarterDetail[] = [];
    for (let q = 0; q < c.termQuarters; q++) {
      if (q > 0) price *= Math.exp(-c.drift - (c.vol * c.vol) / 2 + c.vol * gaussian(r));
      if (q === arrival) price *= 1 - c.bDrop;
      const resale = Math.max(0, Math.min(1, c.resaleShare + c.resaleVol * gaussian(r)));
      const avail = 1 - c.failureShare;
      const earnedPerHour = c.hedgeShare * c.hedgePrice * avail + (1 - c.hedgeShare) * avail * resale * price;
      const cash = c.gpus * HOURS_PER_QUARTER * (earnedPerHour - c.contractPrice);
      const discounted = cash / qRate ** (q + 1);
      npv += discounted;
      quarters.push({ q, price, resale, earnedPerHour, cash, discounted });
    }
    paths.push({ arrival, quarters, npv });
  }
  return paths;
}

/** The paths sorted from the worst outcome to the best (rank 1 is the worst). */
export function rankedPaths(c: ContractParams): PathDetail[] {
  return contractPaths(c).sort((a, b) => a.npv - b.npv);
}

/** Market price at which resold hours just cover the contract: contract ÷ (resale share × hours not lost to failures). */
export function breakEvenMarketPrice(c: Pick<ContractParams, 'contractPrice' | 'resaleShare' | 'failureShare'>): number {
  return c.contractPrice / (c.resaleShare * (1 - c.failureShare));
}
