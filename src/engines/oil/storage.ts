// Storage (Lesson 4.3, and the futures curve of Lesson 5.4).
//
// Cash and carry: a terminal can buy oil now and sell it later at prices agreed today (forward
// prices). Holding a barrel for a month costs the storage fee plus the interest on the money tied
// up in it. A linear program chooses how much to buy, store and sell each month to maximize profit,
// within the tanks' capacity and how fast they can be filled and emptied.
//
// Buffer stocks: a refinery fed by irregular tanker arrivals keeps a stock to avoid cutting runs.
// A day-by-day simulation shows how the shortfalls fall as the buffer grows.

import { solveLP, type Sense } from '../market/lp';
import { FINANCING_RATE, KESSLER_STORAGE } from '../../model/oil/logistics';
import { rng } from '../../model/random';

export interface StorageParams {
  /** Working capacity, barrels. */
  capacity: number;
  /** Storage fee, $ per barrel per month. */
  fee: number;
  /** Annual financing rate. */
  rate: number;
  /** Handling, $ per barrel in and per barrel out. */
  handling: number;
  /** Most that can go in or out in a month, barrels. */
  throughput: number;
}

export const DEFAULT_STORAGE: StorageParams = {
  capacity: KESSLER_STORAGE.workingCapacity,
  fee: KESSLER_STORAGE.feePerMonth,
  rate: FINANCING_RATE,
  handling: KESSLER_STORAGE.handling,
  throughput: KESSLER_STORAGE.monthlyThroughput,
};

/** Cost of carrying one barrel from month t to month t+1 at price p, $. */
export function monthlyCarry(price: number, s: StorageParams = DEFAULT_STORAGE): number {
  return s.fee + (s.rate / 12) * price;
}

export interface StoragePlan {
  /** Barrels bought, sold and held at the end of each month. */
  buy: number[];
  sell: number[];
  inventory: number[];
  /** Profit over the year, $. */
  profit: number;
  /** Costs: storage fees, financing and handling, $. */
  fees: number;
  financing: number;
  handlingCost: number;
}

/**
 * Optimal buying, storing and selling against a strip of monthly prices. Starts and ends empty.
 * Variables per month: buy, sell, end inventory.
 */
export function planStorage(prices: number[], s: StorageParams = DEFAULT_STORAGE): StoragePlan {
  const T = prices.length;
  const n = 3 * T;
  const B = (t: number) => t;
  const S = (t: number) => T + t;
  const I = (t: number) => 2 * T + t;
  const A: number[][] = [];
  const b: number[] = [];
  const sense: Sense[] = [];
  const scale = 1e6; // work in millions of barrels
  for (let t = 0; t < T; t++) {
    const r = Array<number>(n).fill(0);
    r[I(t)] = 1;
    if (t > 0) r[I(t - 1)] = -1;
    r[B(t)] = -1;
    r[S(t)] = 1;
    A.push(r);
    b.push(0);
    sense.push('=');
    // Can't sell more than was in the tank at the start of the month plus what arrived.
  }
  const last = Array<number>(n).fill(0);
  last[I(T - 1)] = 1;
  A.push(last);
  b.push(0);
  sense.push('=');
  const ub = Array<number>(n).fill(Infinity);
  for (let t = 0; t < T; t++) {
    ub[B(t)] = s.throughput / scale;
    ub[S(t)] = s.throughput / scale;
    ub[I(t)] = s.capacity / scale;
  }
  // Minimize cost − revenue, in $ millions.
  const c = Array<number>(n).fill(0);
  for (let t = 0; t < T; t++) {
    c[B(t)] = prices[t] + s.handling;
    c[S(t)] = -prices[t] + s.handling;
    c[I(t)] = monthlyCarry(prices[t], s);
  }
  const sol = solveLP({ c, A, b, sense, ub });
  const x = sol.x.map((v) => v * scale);
  const buy = Array.from({ length: T }, (_, t) => x[B(t)]);
  const sell = Array.from({ length: T }, (_, t) => x[S(t)]);
  const inventory = Array.from({ length: T }, (_, t) => x[I(t)]);
  const fees = inventory.reduce((a, v) => a + v * s.fee, 0);
  const financing = inventory.reduce((a, v, t) => a + v * (s.rate / 12) * prices[t], 0);
  const handlingCost = buy.reduce((a, v) => a + v, 0) * s.handling + sell.reduce((a, v) => a + v, 0) * s.handling;
  const profit = sell.reduce((a, v, t) => a + v * prices[t], 0) - buy.reduce((a, v, t) => a + v * prices[t], 0) - fees - financing - handlingCost;
  return { buy, sell, inventory, profit, fees, financing, handlingCost };
}

/** A monthly price strip: a starting price, a steady monthly change (contango > 0) and a seasonal swing. */
export function priceStrip(start: number, slope: number, seasonal = 0, months = 12): number[] {
  return Array.from({ length: months }, (_, t) => start + slope * t + seasonal * Math.sin((2 * Math.PI * (t - 2)) / 12));
}

// ---------------------------------------------------------------------------
// A refinery's buffer stock.

export interface BufferResult {
  /** End-of-day stock, barrels. */
  stock: number[];
  /** Barrels of crude runs lost to empty tanks over the year. */
  shortfall: number;
  /** Days the refinery had to cut runs. */
  shortDays: number;
  /** Average stock held, barrels. */
  averageStock: number;
}

export interface BufferParams {
  /** Crude run, barrels a day. */
  runs: number;
  /** Cargo size, barrels, and the scheduled interval between cargoes, days. */
  cargo: number;
  interval: number;
  /** Largest delay a cargo can suffer, days (each cargo's delay is random between 0 and this). */
  maxDelay: number;
  /** Stock the refinery starts with and orders to keep, barrels. */
  buffer: number;
  /** Storms a year that close the port; each lasts 2–5 days, and cargoes due meanwhile wait. */
  storms?: number;
  days?: number;
  seed?: number;
}

/**
 * A year of a refinery's crude tank: steady runs out, cargoes in on a schedule but late by a random
 * number of days. The refinery holds `buffer` barrels of safety stock on top of its cycle stock.
 */
export function simulateBuffer(p: BufferParams): BufferResult {
  const days = p.days ?? 365;
  const r = rng(p.seed ?? 11);
  const closed = new Set<number>();
  for (let k = 0; k < (p.storms ?? 0); k++) {
    const start = Math.floor(r() * days);
    const length = 2 + Math.floor(r() * 4);
    for (let d = start; d < start + length; d++) closed.add(d);
  }
  const arrivals = new Map<number, number>();
  for (let k = 1; k * p.interval < days + p.interval; k++) {
    let due = k * p.interval + Math.floor(r() * (p.maxDelay + 1));
    while (closed.has(due)) due++;
    arrivals.set(due, (arrivals.get(due) ?? 0) + p.cargo);
  }
  let stock = p.buffer + p.cargo;
  const out: number[] = [];
  let shortfall = 0;
  let shortDays = 0;
  for (let d = 0; d < days; d++) {
    stock += arrivals.get(d) ?? 0;
    const run = Math.min(p.runs, stock);
    if (run < p.runs - 1e-6) {
      shortfall += p.runs - run;
      shortDays++;
    }
    stock -= run;
    out.push(stock);
  }
  return { stock: out, shortfall, shortDays, averageStock: out.reduce((a, b) => a + b, 0) / days };
}

/** Average yearly shortfall and stock over many simulated years (seeds 1…years). */
export function expectedBuffer(p: Omit<BufferParams, 'seed'>, years = 40): { shortfall: number; averageStock: number } {
  let s = 0;
  let a = 0;
  for (let y = 1; y <= years; y++) {
    const r = simulateBuffer({ ...p, seed: y * 7919 });
    s += r.shortfall;
    a += r.averageStock;
  }
  return { shortfall: s / years, averageStock: a / years };
}
