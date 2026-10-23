// Battery siting on a network: a day of hourly DC-OPF with batteries placed at nodes.
// Each battery follows a fixed, price-blind schedule — it charges in the lowest-demand hours and
// discharges in the highest-demand hours — modeled as extra load while charging and as negative
// load while discharging. That isolates the effect of *where* the storage sits.

import type { Network } from '../../model/types';
import { dcopf, type OpfGenerator, type OpfOptions } from './opf';

export interface SitedBattery {
  node: string;
  /** Charge and discharge rating, MW. */
  powerMW: number;
  /** Hours of storage at full power (energy = power × duration). */
  durationH: number;
  /** Round-trip efficiency, 0–1. */
  efficiency: number;
}

export interface SitingDayInput {
  net: Network;
  /** Generators available in each hour (weather-limited capacities already applied). */
  gens: (hour: number) => OpfGenerator[];
  /** System demand per hour, MW. */
  demand: number[];
  /** Share of demand at each node. */
  share: Record<string, number>;
  batteries: SitedBattery[];
  /** Hours over which each battery spreads its recharge (default 6). */
  chargeHours?: number;
  opf?: OpfOptions;
  /**
   * Compute LMPs only at these nodes (one extra solve per node per hour) instead of everywhere.
   * Ignored when `opf.lmp` is false.
   */
  lmpNodes?: string[];
}

export interface SitingHour {
  lmp: Record<string, number>;
  flows: Record<string, number>;
  binding: string[];
  cost: number;
  shed: number;
}

export interface SitingDay {
  hours: SitingHour[];
  /** Net battery output per node per hour, MW (+ discharge, − charge). */
  battery: Record<string, number[]>;
  /** Total generation cost over the day, $ (includes any shed load at VOLL). */
  cost: number;
  /** Hours with at least one line at its limit. */
  congestedHours: number;
  /** Each battery's arbitrage revenue at its own node's LMP, $ (index matches input). */
  revenue: number[];
}

/**
 * The hours a battery charges and discharges, by demand rank. It discharges at full power in the
 * `round(duration)` highest-demand hours, and recharges the energy (plus losses) spread evenly
 * over the `chargeHours` lowest-demand hours (never above its power rating).
 */
export function peakShiftSchedule(demand: number[], b: Pick<SitedBattery, 'powerMW' | 'durationH' | 'efficiency'>, chargeHours = 6): number[] {
  const n = demand.length;
  const s = Array<number>(n).fill(0);
  if (!(b.powerMW > 0) || !(b.durationH > 0)) return s;
  const order = demand.map((d, h) => [d, h] as const).sort((a, c) => a[0] - c[0] || a[1] - c[1]).map((x) => x[1]);
  const kd = Math.max(1, Math.min(Math.floor(n / 2), Math.round(b.durationH)));
  const top = order.slice(n - kd);
  const delivered = b.powerMW * kd;
  for (const h of top) s[h] = b.powerMW;
  const need = delivered / Math.max(0.05, b.efficiency);
  const kc = Math.min(n - kd, Math.max(chargeHours, Math.ceil(need / b.powerMW - 1e-9)));
  for (const h of order.slice(0, kc)) s[h] = -need / kc;
  return s;
}

/** Run the day with the given batteries. Set `opf.lmp = false` for cost-only runs (much faster). */
export function runSitingDay(input: SitingDayInput): SitingDay {
  const { net, gens, demand, share, batteries } = input;
  const battery: Record<string, number[]> = {};
  const schedules = batteries.map((b) => peakShiftSchedule(demand, b, input.chargeHours));
  batteries.forEach((b, i) => {
    const prev = battery[b.node] ?? Array<number>(demand.length).fill(0);
    battery[b.node] = prev.map((v, h) => v + schedules[i][h]);
  });
  const hours: SitingHour[] = [];
  let cost = 0;
  let congestedHours = 0;
  for (let h = 0; h < demand.length; h++) {
    const loads: Record<string, number> = {};
    for (const n of net.nodes) loads[n.id] = (share[n.id] ?? 0) * demand[h];
    for (const [node, s] of Object.entries(battery)) loads[node] = (loads[node] ?? 0) - s[h];
    // A node whose discharge exceeds its load becomes a net injection; dcopf takes that as
    // negative load, which it handles like a fixed injection.
    const g = gens(h);
    const partial = input.lmpNodes && input.opf?.lmp !== false;
    const r = dcopf(net, g, loads, partial ? { ...input.opf, lmp: false } : input.opf);
    let lmp = r.lmp;
    if (partial && r.feasible) {
      lmp = {};
      const eps = 0.1;
      for (const node of input.lmpNodes!) {
        const bumped = dcopf(net, g, { ...loads, [node]: (loads[node] ?? 0) + eps }, { ...input.opf, lmp: false });
        lmp[node] = bumped.feasible ? Math.round(((bumped.cost - r.cost) / eps) * 100) / 100 : (input.opf?.voll ?? 1000);
      }
    }
    const shed = Object.values(r.shed).reduce((a, v) => a + v, 0);
    hours.push({ lmp, flows: r.flows, binding: r.binding, cost: r.cost, shed });
    cost += r.cost;
    if (r.binding.length) congestedHours++;
  }
  const revenue = batteries.map((b, i) => schedules[i].reduce((s, mw, h) => s + mw * (hours[h].lmp[b.node] ?? 0), 0));
  return { hours, battery, cost, congestedHours, revenue };
}
