// Underground gas storage: a field's inventory, its pressure, and how fast gas can go in or out.
//
// A storage field holds base (cushion) gas that never leaves, plus working gas that's cycled in
// and out. Its pressure rises with the total gas in it (P/Z grows in proportion to the gas, as in
// the material balance of Lesson 2.2; we fold Z into the straight line). Withdrawal works like a
// well: q = C·(P² − Pwf²), so it slows as the field empties, and injection works against the
// field's own pressure, q = C·(Pinj² − P²), so it slows as the field fills. Each is also capped
// by the field's wells and compressors. These inventory-dependent limits are what storage
// contracts call ratchets.

import type { StorageField } from '../../model/gas/world';

export interface StorageSpec extends StorageField {
  /** Field pressure when full of working gas, psia. */
  pMaxPsia: number;
  /** Pressure at the bottom of the wells when withdrawing into the pipeline system, psia. */
  pwfPsia: number;
  /** Highest pressure the injection compressors can push to, psia. */
  pInjPsia: number;
  /** How much more than the facility cap the rock could deliver when full (1 = the rock is the limit). */
  wdHeadroom: number;
  /** The same for injection when empty. */
  injHeadroom: number;
}

/** Field pressure (psia) with `inventory` Bcf of working gas in it. */
export function storagePressure(s: StorageSpec, inventory: number): number {
  const total = s.baseBcf + Math.max(0, Math.min(s.workingBcf, inventory));
  return (s.pMaxPsia * total) / (s.baseBcf + s.workingBcf);
}

/** Most the field can withdraw in a day (Bcf/d) holding `inventory` Bcf of working gas. */
export function withdrawCapacity(s: StorageSpec, inventory: number): number {
  if (inventory <= 1e-9) return 0;
  const p = storagePressure(s, inventory);
  const c = (s.maxWithdrawBcfd * s.wdHeadroom) / (s.pMaxPsia ** 2 - s.pwfPsia ** 2);
  return Math.max(0, Math.min(s.maxWithdrawBcfd, c * (p * p - s.pwfPsia ** 2), inventory));
}

/** Most the field can inject in a day (Bcf/d) holding `inventory` Bcf of working gas. */
export function injectCapacity(s: StorageSpec, inventory: number): number {
  const room = s.workingBcf - inventory;
  if (room <= 1e-9) return 0;
  const p = storagePressure(s, inventory);
  const pEmpty = storagePressure(s, 0);
  const c = (s.maxInjectBcfd * s.injHeadroom) / (s.pInjPsia ** 2 - pEmpty ** 2);
  return Math.max(0, Math.min(s.maxInjectBcfd, c * (s.pInjPsia ** 2 - p * p), room));
}

export interface StorageDay {
  day: number;
  /** What was asked for: positive to inject, negative to withdraw (Bcf/d). */
  nominated: number;
  /** What actually flowed. */
  flow: number;
  /** Working gas at the end of the day, Bcf. */
  inventory: number;
  pressure: number;
  /** True when a ratchet cut the nomination. */
  limited: boolean;
}

/** Day by day: each day's nomination (Bcf/d, + inject / − withdraw) is cut to what the field can do. */
export function runStorage(s: StorageSpec, startInventory: number, nominations: number[]): StorageDay[] {
  const out: StorageDay[] = [];
  let inv = Math.max(0, Math.min(s.workingBcf, startInventory));
  nominations.forEach((nom, day) => {
    let flow = nom;
    if (nom > 0) flow = Math.min(nom, injectCapacity(s, inv));
    else if (nom < 0) flow = -Math.min(-nom, withdrawCapacity(s, inv));
    inv = Math.max(0, Math.min(s.workingBcf, inv + flow));
    out.push({ day, nominated: nom, flow, inventory: inv, pressure: storagePressure(s, inv), limited: Math.abs(flow - nom) > 1e-9 });
  });
  return out;
}

/** The most gas (Bcf) the field can deliver over `days` days of withdrawing flat out, starting with `inventory`. */
export function deliverableOver(s: StorageSpec, inventory: number, days: number): number {
  const r = runStorage(s, inventory, Array<number>(days).fill(-1e9));
  return inventory - (r[r.length - 1]?.inventory ?? inventory);
}

// ---------------------------------------------------------------------------
// Operating storage for profit.

/** MMBtu in a Bcf of the region's gas (1,037 Btu per standard cubic foot). */
const MMBTU_PER_BCF = 1.037e6;

export interface StorageCosts {
  /** Fees and fuel for putting gas in and taking it out, $/MMBtu each way. */
  injectCost: number;
  withdrawCost: number;
}

export interface StorageOptimum {
  /** Profit over the days, $: gas sold minus gas bought minus costs. */
  value: number;
  /** Working gas at the end of each day, Bcf. */
  inventory: number[];
  /** Each day's injection (+) or withdrawal (−), Bcf/d. */
  flow: number[];
}

/**
 * The most a storage field could earn trading against a known series of daily prices ($/MMBtu),
 * buying to inject and selling what it withdraws, within its daily ratchets — by dynamic
 * programming. The value of holding each inventory level is kept on a grid and interpolated in
 * between, and each day's move can be any amount within the day's limits, so slow and ratcheted
 * fields are valued as accurately as fast ones. Run on a flat-by-month forward curve it gives the
 * field's intrinsic value (what can be locked in today); run on a realized spot path it gives the
 * most that path could have paid with perfect foresight.
 */
export function optimizeStorage(
  prices: number[],
  spec: StorageSpec,
  opts: { start?: number; end?: number; grid?: number; costs?: StorageCosts } = {},
): StorageOptimum {
  const W = spec.workingBcf;
  const n = opts.grid ?? 400;
  const level = (i: number) => (W * i) / n;
  const costs = opts.costs ?? { injectCost: 0.05, withdrawCost: 0.05 };
  const start = Math.max(0, Math.min(W, opts.start ?? 0));
  const end = Math.max(0, Math.min(W, opts.end ?? 0));
  const T = prices.length;
  const injAt = Array.from({ length: n + 1 }, (_, i) => injectCapacity(spec, level(i)));
  const wdAt = Array.from({ length: n + 1 }, (_, i) => withdrawCapacity(spec, level(i)));
  const interp = (V: Float64Array, x: number) => {
    const f = Math.max(0, Math.min(n, (x / W) * n));
    const k = Math.min(n - 1, Math.floor(f));
    const a = f - k;
    return V[k] * (1 - a) + V[k + 1] * a;
  };
  /** Best move from inventory x on a day at price p, given tomorrow's values V. */
  const best = (V: Float64Array, p: number, x: number, inj: number, wd: number) => {
    const lo = Math.max(0, x - wd);
    const hi = Math.min(W, x + inj);
    let bestV = -Infinity;
    let bestY = x;
    const consider = (y: number) => {
      const d = y - x;
      const cash = d > 0 ? -d * MMBTU_PER_BCF * (p + costs.injectCost) : -d * MMBTU_PER_BCF * (p - costs.withdrawCost);
      const v = cash + interp(V, y);
      if (v > bestV + 1e-9) {
        bestV = v;
        bestY = y;
      }
    };
    consider(x);
    consider(lo);
    consider(hi);
    for (let k = Math.ceil((lo / W) * n - 1e-9); k <= Math.floor((hi / W) * n + 1e-9); k++) consider(level(k));
    return { v: bestV, y: bestY };
  };
  // Values at the end: gas left over earns nothing, and falling short of `end` is ruled out by a
  // steep penalty (kept finite so it interpolates).
  const V: Float64Array[] = Array.from({ length: T + 1 }, () => new Float64Array(n + 1));
  for (let i = 0; i <= n; i++) V[T][i] = -1e12 * Math.max(0, end - level(i));
  for (let t = T - 1; t >= 0; t--) {
    const p = prices[t];
    for (let i = 0; i <= n; i++) V[t][i] = best(V[t + 1], p, level(i), injAt[i], wdAt[i]).v;
  }
  const inventory: number[] = [];
  const flow: number[] = [];
  let x = start;
  let value = 0;
  for (let t = 0; t < T; t++) {
    const { y } = best(V[t + 1], prices[t], x, injectCapacity(spec, x), withdrawCapacity(spec, x));
    const d = y - x;
    value += d > 0 ? -d * MMBTU_PER_BCF * (prices[t] + costs.injectCost) : -d * MMBTU_PER_BCF * (prices[t] - costs.withdrawCost);
    flow.push(d);
    inventory.push(y);
    x = y;
  }
  return { value, inventory, flow };
}

/** Daily prices that are flat within each month: a forward curve laid out day by day. */
export function dailyFromMonthly(monthly: number[], monthDays: number[]): number[] {
  const out: number[] = [];
  monthly.forEach((p, m) => {
    for (let d = 0; d < monthDays[m]; d++) out.push(p);
  });
  return out;
}

/**
 * A simple trading rule on a spot path: inject whenever the day's price is at least `margin` below
 * `reference` (the forward curve for that day) and withdraw whenever it's at least `margin` above,
 * as fast as the ratchets allow. Near the end it withdraws at full rate whenever it must to finish
 * empty; anything still left is sold at the last price. Returns the profit, $, and the inventory
 * path.
 */
export function thresholdPolicy(
  prices: number[],
  reference: number[],
  spec: StorageSpec,
  margin: number,
  opts: { start?: number; costs?: StorageCosts } = {},
): StorageOptimum {
  const costs = opts.costs ?? { injectCost: 0.05, withdrawCost: 0.05 };
  let inv = opts.start ?? 0;
  let value = 0;
  const inventory: number[] = [];
  const flow: number[] = [];
  const T = prices.length;
  prices.forEach((p, t) => {
    let f = 0;
    const wd = withdrawCapacity(spec, inv);
    const mustSell = inv > 1e-9 && inv >= (T - t - 1) * wd;
    if (mustSell) f = -wd;
    else if (p <= reference[t] - margin) f = injectCapacity(spec, inv);
    else if (p >= reference[t] + margin) f = -wd;
    value += f > 0 ? -f * MMBTU_PER_BCF * (p + costs.injectCost) : -f * MMBTU_PER_BCF * (p - costs.withdrawCost);
    inv += f;
    flow.push(f);
    inventory.push(inv);
  });
  value += inv * MMBTU_PER_BCF * (prices[prices.length - 1] - costs.withdrawCost);
  return { value, inventory, flow };
}

/** Days to fill from `from` to `to` Bcf injecting flat out (Infinity if never). */
export function daysToFill(s: StorageSpec, from: number, to: number, maxDays = 730): number {
  let inv = from;
  for (let d = 1; d <= maxDays; d++) {
    inv += injectCapacity(s, inv);
    if (inv >= to - 1e-9) return d;
  }
  return Infinity;
}
