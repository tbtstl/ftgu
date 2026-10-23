// Scheduling a fleet of home batteries against day-ahead prices. Thousands of batteries are grouped
// into cohorts (similar size, similar starting charge, same feeder), each cohort is scheduled as one
// battery, and the fleet's constraints are layered on top: energy held back for customers' backup,
// homes that can't be reached, and a limit on how much each feeder can export at once.

export interface LimitedBattery {
  /** Most the battery can draw from the grid, MW. */
  maxChargeMW: number;
  /** Most it can deliver to the grid, MW. */
  maxDischargeMW: number;
  energyMWh: number;
  /** Round-trip efficiency, 0–1 (split evenly between charge and discharge). */
  efficiency: number;
  /** Starting state of charge, 0–1. */
  soc0: number;
}

export interface LimitedResult {
  /** MW per hour: + discharging, − charging. */
  schedule: number[];
  /** Stored energy at each hour boundary, MWh. */
  soc: number[];
  /** Market revenue minus charging cost, $. */
  revenue: number;
  dischargedMWh: number;
}

/**
 * Optimal schedule against known hourly prices for a battery whose charge and discharge limits may
 * differ (dynamic programming over a grid of `levels` charge states). The battery must end the day
 * at least as full as it started, so it can't simply sell the charge it began with.
 */
export function optimizeWithLimits(prices: number[], b: LimitedBattery, levels = 101): LimitedResult {
  const n = prices.length;
  const L = Math.max(2, levels);
  const E = Math.max(0, b.energyMWh);
  const eta = Math.sqrt(Math.min(1, Math.max(0.05, b.efficiency)));
  const flat = { schedule: Array<number>(n).fill(0), soc: Array<number>(n + 1).fill(E * b.soc0), revenue: 0, dischargedMWh: 0 };
  if (E <= 1e-9 || (b.maxChargeMW <= 1e-9 && b.maxDischargeMW <= 1e-9)) return flat;
  const unit = E / (L - 1);
  const start = Math.round(Math.min(1, Math.max(0, b.soc0)) * (L - 1));
  // Largest moves per hour, in grid steps.
  const up = Math.floor((Math.max(0, b.maxChargeMW) * eta) / unit + 1e-9);
  const down = Math.floor(Math.max(0, b.maxDischargeMW) / eta / unit + 1e-9);
  const value = Array.from({ length: n + 1 }, () => new Float64Array(L).fill(-Infinity));
  const choice = Array.from({ length: n }, () => new Int32Array(L));
  for (let i = start; i < L; i++) value[n][i] = 0;
  for (let t = n - 1; t >= 0; t--) {
    const p = prices[t];
    const vNext = value[t + 1];
    const vNow = value[t];
    const ch = choice[t];
    for (let i = 0; i < L; i++) {
      let best = -Infinity;
      let arg = i;
      const k0 = Math.max(0, i - down);
      const k1 = Math.min(L - 1, i + up);
      for (let k = k0; k <= k1; k++) {
        const vk = vNext[k];
        if (vk === -Infinity) continue;
        const dE = (k - i) * unit;
        const cash = dE > 0 ? (-p * dE) / eta : dE < 0 ? -p * dE * eta : 0;
        const v = cash + vk;
        if (v > best + 1e-9) {
          best = v;
          arg = k;
        }
      }
      vNow[i] = best;
      ch[i] = arg;
    }
  }
  const schedule: number[] = [];
  const soc = [start * unit];
  let i = start;
  let revenue = 0;
  let dischargedMWh = 0;
  for (let t = 0; t < n; t++) {
    const k = choice[t][i];
    const dE = (k - i) * unit;
    const mw = dE > 0 ? -dE / eta : dE < 0 ? -dE * eta : 0;
    schedule.push(mw);
    revenue += prices[t] * mw;
    if (mw > 0) dischargedMWh += mw;
    soc.push(k * unit);
    i = k;
  }
  return { schedule, soc, revenue, dischargedMWh };
}

export interface Cohort {
  id: string;
  feeder: string;
  homes: number;
  /** Combined inverter rating, MW. */
  powerMW: number;
  /** Combined battery capacity, MWh. */
  energyMWh: number;
  /** Average starting state of charge, 0–1. */
  soc0: number;
}

export interface FleetConstraints {
  /** Share of each battery held back for the customer's backup, 0–1. */
  reserve: number;
  /** Share of homes reachable on the day, 0–1. */
  availability: number;
  /** Most each feeder can export at once, MW (omit or Infinity for no limit). */
  feederLimitMW?: number;
  efficiency?: number;
}

export interface FleetSchedule {
  cohorts: Array<{ id: string; feeder: string; schedule: number[]; revenue: number; maxDischargeMW: number }>;
  /** Net MW per hour for each feeder. */
  byFeeder: Record<string, number[]>;
  /** Net MW per hour for the fleet. */
  total: number[];
  revenue: number;
}

/**
 * The battery a cohort can offer once constraints apply. Backup reserve shrinks usable energy (and
 * any charge below the reserve can't be used); availability scales the whole cohort.
 */
export function cohortBattery(c: Cohort, k: FleetConstraints): LimitedBattery {
  const r = Math.min(0.99, Math.max(0, k.reserve));
  const a = Math.min(1, Math.max(0, k.availability));
  return {
    maxChargeMW: c.powerMW * a,
    maxDischargeMW: c.powerMW * a,
    energyMWh: c.energyMWh * (1 - r) * a,
    efficiency: k.efficiency ?? 0.9,
    soc0: Math.max(0, c.soc0 - r) / (1 - r),
  };
}

/**
 * Schedule every cohort, then respect each feeder's export limit. The limit is shared out among the
 * feeder's cohorts in proportion to their power, and each cohort is re-optimized with that cap —
 * so it spreads its discharge over more hours instead of simply losing the clipped energy. The
 * feeder's total export can never exceed its limit.
 */
export function scheduleFleet(prices: number[], cohorts: Cohort[], k: FleetConstraints, levels = 101): FleetSchedule {
  const limit = k.feederLimitMW ?? Infinity;
  const feederPower: Record<string, number> = {};
  const bats = cohorts.map((c) => cohortBattery(c, k));
  cohorts.forEach((c, i) => (feederPower[c.feeder] = (feederPower[c.feeder] ?? 0) + bats[i].maxDischargeMW));
  const out: FleetSchedule['cohorts'] = cohorts.map((c, i) => {
    const b = bats[i];
    const fp = feederPower[c.feeder];
    const cap = Number.isFinite(limit) && fp > limit ? (Math.max(0, limit) * b.maxDischargeMW) / fp : b.maxDischargeMW;
    const r = optimizeWithLimits(prices, { ...b, maxDischargeMW: cap }, levels);
    return { id: c.id, feeder: c.feeder, schedule: r.schedule, revenue: r.revenue, maxDischargeMW: cap };
  });
  const n = prices.length;
  const byFeeder: Record<string, number[]> = {};
  for (const c of out) {
    const f = (byFeeder[c.feeder] ??= Array<number>(n).fill(0));
    c.schedule.forEach((mw, t) => (f[t] += mw));
  }
  const total = Array.from({ length: n }, (_, t) => out.reduce((s, c) => s + c.schedule[t], 0));
  return { cohorts: out, byFeeder, total, revenue: out.reduce((s, c) => s + c.revenue, 0) };
}

/**
 * The naive alternative: schedule each cohort ignoring the feeder, then scale down every cohort's
 * discharge in any hour where its feeder would exceed the limit (the clipped energy just stays in
 * the batteries). Feasible, but leaves money on the table.
 */
export function clipToFeederLimit(prices: number[], plan: FleetSchedule, limitMW: number): FleetSchedule {
  const n = prices.length;
  const scale: Record<string, number[]> = {};
  for (const f of Object.keys(plan.byFeeder)) {
    const dis = Array<number>(n).fill(0);
    for (const c of plan.cohorts) if (c.feeder === f) c.schedule.forEach((mw, t) => (dis[t] += Math.max(0, mw)));
    scale[f] = dis.map((d) => (d > limitMW && d > 0 ? Math.max(0, limitMW) / d : 1));
  }
  const cohorts = plan.cohorts.map((c) => {
    const schedule = c.schedule.map((mw, t) => (mw > 0 ? mw * scale[c.feeder][t] : mw));
    return { ...c, schedule, revenue: schedule.reduce((s, mw, t) => s + mw * prices[t], 0) };
  });
  const byFeeder: Record<string, number[]> = {};
  for (const c of cohorts) {
    const f = (byFeeder[c.feeder] ??= Array<number>(n).fill(0));
    c.schedule.forEach((mw, t) => (f[t] += mw));
  }
  const total = Array.from({ length: n }, (_, t) => cohorts.reduce((s, c) => s + c.schedule[t], 0));
  return { cohorts, byFeeder, total, revenue: cohorts.reduce((s, c) => s + c.revenue, 0) };
}

export interface CohortHome {
  feeder: string;
  kW: number;
  kWh: number;
  /** Starting state of charge, 0–1. */
  soc0: number;
}

/**
 * Group homes into cohorts by feeder, battery size (up to 13.5 kWh, or larger) and starting charge
 * (below or above half full). Each cohort is then scheduled as one big battery.
 */
export function buildCohorts(homes: CohortHome[]): Cohort[] {
  const map = new Map<string, Cohort & { socSum: number }>();
  for (const h of homes) {
    const size = h.kWh > 13.5 ? 'large' : 'standard';
    const charge = h.soc0 < 0.5 ? 'low' : 'high';
    const id = `${h.feeder}·${size}·${charge}`;
    let c = map.get(id);
    if (!c) {
      c = { id, feeder: h.feeder, homes: 0, powerMW: 0, energyMWh: 0, soc0: 0, socSum: 0 };
      map.set(id, c);
    }
    c.homes += 1;
    c.powerMW += h.kW / 1000;
    c.energyMWh += h.kWh / 1000;
    c.socSum += h.soc0 * h.kWh;
  }
  return [...map.values()]
    .map(({ socSum, ...c }) => ({ ...c, soc0: c.energyMWh > 0 ? socSum / 1000 / c.energyMWh : 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
