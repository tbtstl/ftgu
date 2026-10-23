// Batteries as peak shavers (Lesson 3.4). Given a day's net load and a battery, find the lowest
// peak the battery can hold the net load to, and a schedule that achieves it: discharge whatever
// sits above that cap, charged beforehand by filling the lowest hours ("valley filling").
// Positive MW = discharging to the grid, negative = charging, as in storage.ts.

import type { Battery } from '../../model/types';
import { runBattery } from './storage';

export type BatterySize = Pick<Battery, 'powerMW' | 'energyMWh' | 'efficiency'>;

/** Energy the battery must deliver to hold `net` at or below `cap`, MWh, and the power it needs. */
export function energyAbove(net: number[], cap: number): { mwh: number; mw: number } {
  let mwh = 0;
  let mw = 0;
  for (const v of net) {
    const x = Math.max(0, v - cap);
    mwh += x;
    mw = Math.max(mw, x);
  }
  return { mwh, mw };
}

/**
 * The lowest cap on net load a battery of this size can hold, assuming it starts the day empty and
 * charges in earlier hours. Power limits how deep the cut can go (cap ≥ peak − power); energy limits
 * how wide (the energy above the cap, plus discharge losses, must fit in the battery). Also checks the
 * charging hours before the first discharge hour can store that much without raising them past the cap.
 */
export function lowestPeak(net: number[], b: BatterySize): number {
  const peak = Math.max(...net);
  if (!(b.powerMW > 0) || !(b.energyMWh > 0)) return peak;
  const etaD = Math.sqrt(Math.max(1e-6, b.efficiency));
  const feasible = (cap: number) => {
    const { mwh, mw } = energyAbove(net, cap);
    if (mw > b.powerMW + 1e-9) return false;
    const soc = mwh / etaD;
    if (soc > b.energyMWh + 1e-9) return false;
    return chargeRoom(net, cap, b) >= soc - 1e-9;
  };
  let lo = peak - b.powerMW;
  let hi = peak;
  if (feasible(lo)) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (feasible(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Energy (MWh into storage) the battery can take on in the hours before net load first exceeds `cap`, without pushing those hours above `cap`. */
function chargeRoom(net: number[], cap: number, b: BatterySize): number {
  const etaC = Math.sqrt(Math.max(1e-6, b.efficiency));
  const first = net.findIndex((v) => v > cap);
  const end = first < 0 ? net.length : first;
  let room = 0;
  for (let h = 0; h < end; h++) room += Math.max(0, Math.min(b.powerMW, cap - net[h])) * etaC;
  return Math.min(room, b.energyMWh);
}

/**
 * A schedule that holds net load at `cap`: discharge the excess above it, and charge beforehand by
 * raising the lowest hours to a common level (water-filling), just enough to store what's needed.
 */
export function shaveSchedule(net: number[], b: BatterySize, cap: number): number[] {
  const n = net.length;
  const etaC = Math.sqrt(Math.max(1e-6, b.efficiency));
  const etaD = etaC;
  const schedule = net.map((v) => Math.min(b.powerMW, Math.max(0, v - cap)));
  const need = Math.min(b.energyMWh, schedule.reduce((s, v) => s + v, 0) / etaD);
  const first = net.findIndex((v) => v > cap);
  const end = first < 0 ? n : first;
  if (need <= 1e-9 || end === 0) return schedule;
  // Find the fill level L such that Σ min(P, max(0, L − net)) · ηc over the charging hours = need.
  const stored = (L: number) => {
    let s = 0;
    for (let h = 0; h < end; h++) s += Math.max(0, Math.min(b.powerMW, Math.min(L, cap) - net[h])) * etaC;
    return s;
  };
  let lo = Math.min(...net.slice(0, end));
  let hi = cap;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (stored(mid) >= need) hi = mid;
    else lo = mid;
  }
  for (let h = 0; h < end; h++) schedule[h] = -Math.max(0, Math.min(b.powerMW, Math.min(hi, cap) - net[h]));
  return schedule;
}

/** Net load after a battery runs `schedule` (requests are clipped by the battery's limits). */
export function withBattery(net: number[], battery: Battery, schedule: number[]) {
  const run = runBattery(battery, schedule);
  const after = net.map((v, h) => v - run.mw[h]);
  const charged = run.mw.reduce((s, v) => s + Math.max(0, -v), 0);
  const discharged = run.mw.reduce((s, v) => s + Math.max(0, v), 0);
  return { ...run, after, peakBefore: Math.max(...net), peakAfter: Math.max(...after), chargedMWh: charged, dischargedMWh: discharged };
}
