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

/** Days to fill from `from` to `to` Bcf injecting flat out (Infinity if never). */
export function daysToFill(s: StorageSpec, from: number, to: number, maxDays = 730): number {
  let inv = from;
  for (let d = 1; d <= maxDays; d++) {
    inv += injectCapacity(s, inv);
    if (inv >= to - 1e-9) return d;
  }
  return Infinity;
}
