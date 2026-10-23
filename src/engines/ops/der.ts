// Distributed energy resources at home scale: a household with rooftop solar and a battery,
// its electricity bill, and a seeded fleet of such homes whose spare battery capacity an
// aggregator can dispatch. Units are kW and kWh (one value per hour).

import { rng, type Rng } from '../../model/random';

export type HomeStrategy = 'self' | 'tou';

export interface HomeSystem {
  /** Rooftop solar size, kW (peak). */
  pvKW: number;
  /** Battery inverter rating, kW. */
  batteryKW: number;
  /** Usable battery capacity, kWh. */
  batteryKWh: number;
  /** Round-trip efficiency, 0–1 (split evenly between charging and discharging). */
  efficiency: number;
  /** Share of the battery kept full for outages, 0–1. */
  reserve: number;
  /**
   * 'self': store surplus solar and use it whenever the house needs power.
   * 'tou': store surplus solar but only use it during the peak window.
   */
  strategy: HomeStrategy;
  /** Peak window [start, end) for the 'tou' strategy, hours. */
  peak?: [number, number];
}

export interface HomeDay {
  load: number[];
  pv: number[];
  /** Energy into the battery each hour, kWh (from surplus solar). */
  charge: number[];
  /** Energy out of the battery to the house each hour, kWh. */
  discharge: number[];
  gridImport: number[];
  gridExport: number[];
  /** Stored energy at each hour boundary, kWh (length 25). */
  soc: number[];
  /** Share of solar output used in the home (directly or via the battery). */
  selfConsumption: number;
  /** Share of the home's use not drawn from the grid. */
  selfSufficiency: number;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

function inPeak(h: number, peak: [number, number]): boolean {
  return peak[0] <= peak[1] ? h >= peak[0] && h < peak[1] : h >= peak[0] || h < peak[1];
}

/**
 * One day of a home with solar and a battery. The day is repeated until the battery's state at
 * midnight settles (a steady daily cycle), so no energy is created by an arbitrary starting charge.
 * `load` is kWh per hour; `solarCF` is the solar capacity factor per hour.
 */
export function simulateHome(load: number[], solarCF: number[], sys: HomeSystem): HomeDay {
  const n = load.length;
  const E = Math.max(0, sys.batteryKWh);
  const P = Math.max(0, sys.batteryKW);
  const eta = Math.sqrt(Math.min(1, Math.max(0.05, sys.efficiency)));
  const floor = Math.min(1, Math.max(0, sys.reserve)) * E;
  const peak = sys.peak ?? [16, 21];
  const pv = solarCF.map((cf) => Math.max(0, cf) * Math.max(0, sys.pvKW));
  let socStart = floor;
  let out: HomeDay | null = null;
  for (let pass = 0; pass < 8; pass++) {
    let soc = socStart;
    const charge: number[] = [];
    const discharge: number[] = [];
    const gridImport: number[] = [];
    const gridExport: number[] = [];
    const socs = [soc];
    for (let h = 0; h < n; h++) {
      const net = load[h] - pv[h];
      let c = 0;
      let d = 0;
      if (net < 0) {
        c = Math.min(-net, P, Math.max(0, (E - soc) / eta));
      } else if (sys.strategy === 'self' || inPeak(h, peak)) {
        d = Math.min(net, P, Math.max(0, (soc - floor) * eta));
      }
      soc = Math.min(E, Math.max(0, soc + c * eta - d / eta));
      charge.push(c);
      discharge.push(d);
      gridImport.push(Math.max(0, net) - d);
      gridExport.push(Math.max(0, -net) - c);
      socs.push(soc);
    }
    out = { load: [...load], pv, charge, discharge, gridImport, gridExport, soc: socs, selfConsumption: 0, selfSufficiency: 0 };
    if (Math.abs(soc - socStart) < 1e-6) break;
    socStart = soc;
  }
  const day = out!;
  const pvTotal = sum(pv);
  const loadTotal = sum(load);
  day.selfConsumption = pvTotal > 0 ? (pvTotal - sum(day.gridExport)) / pvTotal : 0;
  day.selfSufficiency = loadTotal > 0 ? 1 - sum(day.gridImport) / loadTotal : 0;
  return day;
}

export interface Tariff {
  /** Price of each kWh imported, $ per hour of the day. */
  importPrice: number[];
  /** Credit for each kWh exported, $ per hour of the day. */
  exportCredit: number[];
}

export interface Bill {
  importCost: number;
  exportCredit: number;
  /** importCost − exportCredit, $. */
  net: number;
}

/** Energy charges for one day (fixed monthly charges are left out). */
export function homeBill(day: Pick<HomeDay, 'gridImport' | 'gridExport'>, tariff: Tariff): Bill {
  const importCost = day.gridImport.reduce((s, v, h) => s + v * tariff.importPrice[h], 0);
  const exportCredit = day.gridExport.reduce((s, v, h) => s + v * tariff.exportCredit[h], 0);
  return { importCost, exportCredit, net: importCost - exportCredit };
}

// ---------------------------------------------------------------------------
// A fleet of homes with batteries, as an aggregator sees it.

export interface DerHome {
  id: number;
  batteryKW: number;
  batteryKWh: number;
  /** Owner's backup reserve, 0–1. */
  reserve: number;
  pvKW: number;
  /** Multiplier on the typical home's hourly use. */
  loadScale: number;
  /** Long-run share of time the home's battery is reachable, 0–1. */
  onlineProb: number;
  /** Index of the substation (or feeder) the home is connected to. */
  substation: number;
}

/** Battery products in the fleet (illustrative sizes): [kW, kWh, share of homes]. */
export const FLEET_BATTERIES: Array<[number, number, number]> = [
  [5, 13.5, 0.4],
  [3.8, 10, 0.25],
  [7.6, 13.5, 0.15],
  [5, 20, 0.12],
  [10, 27, 0.08],
];

const RESERVES: Array<[number, number]> = [
  [0.1, 0.2],
  [0.2, 0.4],
  [0.3, 0.2],
  [0.5, 0.15],
  [1, 0.05],
];

function pick<T>(r: Rng, table: Array<[T, number]>): T {
  let u = r();
  for (const [v, w] of table) {
    if (u < w) return v;
    u -= w;
  }
  return table[table.length - 1][0];
}

/**
 * A seeded fleet of `n` homes with batteries. The first k homes of a larger fleet are the same as a
 * k-home fleet with the same seed, so growing the fleet only adds homes. Homes are dealt out in
 * turn across `substations` substations (home i is on substation i mod substations).
 */
export function generateFleet(n: number, seed = 7, substations = 4): DerHome[] {
  const r = rng(seed);
  const homes: DerHome[] = [];
  const S = Math.max(1, Math.round(substations));
  for (let i = 0; i < n; i++) {
    const [kW, kWh] = pick(
      r,
      FLEET_BATTERIES.map(([a, b, w]) => [[a, b] as [number, number], w]),
    );
    const reserve = pick(r, RESERVES);
    const hasPv = r() < 0.75;
    const pvKW = hasPv ? Math.round((4 + 6 * r()) * 10) / 10 : 0;
    const loadScale = 0.6 + 0.9 * r();
    const onlineProb = 0.8 + 0.19 * r();
    homes.push({ id: i, batteryKW: kW, batteryKWh: kWh, reserve, pvKW, loadScale, onlineProb, substation: i % S });
  }
  return homes;
}

export interface FleetDay {
  /** Battery energy above each owner's reserve at the start of each hour, kWh per home (length 24 × n, hour-major). */
  aboveReserve: Float64Array;
  /** Total inverter rating, kW. */
  nameplateKW: number;
}

/**
 * Each home's typical day under self-consumption (solar charges the battery, the house drains it),
 * from which an aggregator can tell how much stored energy sits above each owner's reserve.
 */
export function fleetDay(homes: DerHome[], load: number[], solarCF: number[], efficiency = 0.9): FleetDay {
  const n = homes.length;
  const hours = load.length;
  const aboveReserve = new Float64Array(hours * n);
  let nameplateKW = 0;
  homes.forEach((home, i) => {
    nameplateKW += home.batteryKW;
    const day = simulateHome(
      load.map((v) => v * home.loadScale),
      solarCF,
      { pvKW: home.pvKW, batteryKW: home.batteryKW, batteryKWh: home.batteryKWh, efficiency, reserve: home.reserve, strategy: 'self' },
    );
    for (let h = 0; h < hours; h++) aboveReserve[h * n + i] = Math.max(0, day.soc[h] - home.reserve * home.batteryKWh);
  });
  return { aboveReserve, nameplateKW };
}

/**
 * What one home could add if the aggregator called on it for a full hour starting at `hour`:
 * limited by its inverter and by the energy above its reserve (after discharge losses).
 */
export function homeAvailableKW(home: DerHome, aboveReserveKWh: number, efficiency = 0.9): number {
  return Math.min(home.batteryKW, aboveReserveKWh * Math.sqrt(efficiency));
}

export interface AvailabilityDraws {
  /** Fleet total available kW on each simulated day. */
  totals: number[];
  mean: number;
  /** Value exceeded on `confidence` of days (e.g. the 5th percentile for 95%). */
  dependable: number;
  nameplate: number;
}

/**
 * Simulate many days of the fleet's available discharge at one hour. Each day, each home is
 * reachable with its own probability, and its stored energy varies with that day's weather and
 * use: an independent factor per home, and optionally a shared factor (a cloudy day for everyone).
 */
export function availabilityDraws(
  homes: DerHome[],
  day: FleetDay,
  hour: number,
  opts: {
    days?: number;
    seed?: number;
    confidence?: number;
    sharedWeather?: boolean;
    efficiency?: number;
    /** Use only the first `count` homes. */
    count?: number;
    /** Use only these homes (indices into `homes`); overrides `count`. */
    indices?: number[];
    /** Most each home may count, kW (e.g. its own demand, when exports don't count). */
    capKW?: ArrayLike<number>;
  } = {},
): AvailabilityDraws {
  const D = opts.days ?? 400;
  const r = rng(opts.seed ?? 99);
  const N = homes.length;
  const idx = opts.indices ?? Array.from({ length: Math.min(N, opts.count ?? N) }, (_, i) => i);
  const eff = opts.efficiency ?? 0.9;
  const totals: number[] = [];
  let nameplate = 0;
  for (const i of idx) nameplate += homes[i].batteryKW;
  for (let d = 0; d < D; d++) {
    // Shared weather: one day in four is cloudy, and batteries hold about half the usual energy.
    const shared = opts.sharedWeather ? (r() < 0.25 ? 0.5 : 1.12) : 1;
    let total = 0;
    for (const i of idx) {
      const online = r() < homes[i].onlineProb;
      const u = 0.55 + 0.8 * r(); // own weather and use: 0.55–1.35, mean 0.95
      if (!online) continue;
      const kw = homeAvailableKW(homes[i], day.aboveReserve[hour * N + i] * u * shared, eff);
      total += opts.capKW ? Math.min(kw, opts.capKW[i]) : kw;
    }
    totals.push(total);
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const c = opts.confidence ?? 0.95;
  const q = Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - c) * sorted.length)));
  const mean = totals.reduce((s, v) => s + v, 0) / Math.max(1, totals.length);
  return { totals, mean, dependable: sorted[q] ?? 0, nameplate };
}

export interface FleetToday {
  /** Is each home reachable today? */
  online: boolean[];
  /** Available kW per home per hour (hour-major: index hour × n + i), 0 when offline. */
  availableKW: Float64Array;
  /** Fleet total available kW per hour. */
  totalKW: number[];
  /** Fleet total stored energy above reserves per hour, kWh (reachable homes only). */
  energyKWh: number[];
  nameplateKW: number;
}

/**
 * One simulated day for the first `count` homes: who is reachable, and what each could deliver at
 * each hour, using the same random model as `availabilityDraws` (own weather and use per home).
 */
export function fleetToday(homes: DerHome[], day: FleetDay, seed: number, count = homes.length, efficiency = 0.9): FleetToday {
  const r = rng(seed);
  const N = homes.length;
  const n = Math.min(N, count);
  const hours = day.aboveReserve.length / Math.max(1, N);
  const online: boolean[] = [];
  const u: number[] = [];
  let nameplateKW = 0;
  for (let i = 0; i < n; i++) {
    online.push(r() < homes[i].onlineProb);
    u.push(0.55 + 0.8 * r());
    nameplateKW += homes[i].batteryKW;
  }
  const availableKW = new Float64Array(hours * n);
  const totalKW: number[] = [];
  const energyKWh: number[] = [];
  for (let h = 0; h < hours; h++) {
    let t = 0;
    let e = 0;
    for (let i = 0; i < n; i++) {
      if (!online[i]) continue;
      const above = day.aboveReserve[h * N + i] * u[i];
      const kw = homeAvailableKW(homes[i], above, efficiency);
      availableKW[h * n + i] = kw;
      t += kw;
      e += above * Math.sqrt(efficiency);
    }
    totalKW.push(t);
    energyKWh.push(e);
  }
  return { online, availableKW, totalKW, energyKWh, nameplateKW };
}
