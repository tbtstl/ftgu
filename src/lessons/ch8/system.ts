// From the reader's design to a working grid: the network, hourly demand by node, the plants'
// offers and weather, and a memoized 24-hour market run. Pure functions; the lessons call them
// inside useMemo, and runMarket keeps a small cache keyed on its inputs.

import { clearNodalHour, summarizeNodalDay, type DayUnit, type NodalDaySummary, type NodalHour } from '../../engines/market/nodalday';
import { disconnectedNodes, n1Security, nodalInjections, reserveMargin } from '../../engines/ops/adequacy';
import { optimizeArbitrage } from '../../engines/strategy/arbitrage';
import { runBattery } from '../../engines/ops/storage';
import { findIslands } from '../../engines/physics/powerflow';
import { makeGenerator } from '../../model/fleet';
import { LOAD_SHAPE, SOLAR_CF, WIND_CF } from '../../model/profiles';
import type { Generator, LoadKind, Network } from '../../model/types';
import { BATTERY_CAPEX, CORRIDOR, LOAD_KINDS, SITE, SUBSTATION_COST, TECH, lineCostPerKm, type CapstoneDesign, type WeatherId } from './capstone';

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

// ---------------------------------------------------------------------------
// Weather: how each scenario shapes demand, wind and sun.

/** Afternoon heat profile: 0 overnight, 1 from 15:00 to 19:00. */
const HEAT = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95, 1, 1, 1, 1, 1, 0.85, 0.6, 0.35, 0.15];

export interface Weather {
  id: WeatherId;
  label: string;
  /** Multiplier on wind's capacity factor and on solar's. */
  wind: number;
  solar: number;
  /** Extra demand at the height of the heat, by customer type (0.3 = +30%). */
  heat: Record<LoadKind, number>;
}

export const WEATHER: Record<WeatherId, Weather> = {
  typical: { id: 'typical', label: 'Typical day', wind: 1, solar: 1, heat: { residential: 0, commercial: 0, industrial: 0, dataCenter: 0 } },
  hot: { id: 'hot', label: 'Hot day', wind: 0.6, solar: 1, heat: { residential: 0.3, commercial: 0.15, industrial: 0.03, dataCenter: 0.06 } },
  calm: { id: 'calm', label: 'Calm, cloudy day', wind: 0.25, solar: 0.3, heat: { residential: 0, commercial: 0, industrial: 0, dataCenter: 0 } },
};

export const WEATHER_IDS: WeatherId[] = ['typical', 'hot', 'calm'];

export function windCF(w: WeatherId): number[] {
  return WIND_CF.map((v) => Math.min(1, v * WEATHER[w].wind));
}

export function solarCF(w: WeatherId): number[] {
  return SOLAR_CF.map((v) => Math.min(1, v * WEATHER[w].solar));
}

// ---------------------------------------------------------------------------
// Demand.

/** Hourly MW of one customer type at a node. */
export function kindDemand(d: CapstoneDesign, node: string, kind: LoadKind, weather: WeatherId = d.weather): number[] {
  const peak = d.loads[node]?.[kind] ?? 0;
  const heat = WEATHER[weather].heat[kind];
  return LOAD_SHAPE[kind].map((v, h) => peak * v * (1 + heat * HEAT[h]) * (1 + d.growth));
}

const demandCache = new WeakMap<CapstoneDesign, Partial<Record<WeatherId, Record<string, number[]>>>>();

/** Hourly MW at every built node. */
export function nodeDemand(d: CapstoneDesign, weather: WeatherId = d.weather): Record<string, number[]> {
  let byW = demandCache.get(d);
  if (!byW) demandCache.set(d, (byW = {}));
  const hit = byW[weather];
  if (hit) return hit;
  const out: Record<string, number[]> = {};
  for (const n of d.nodes) {
    const series = LOAD_KINDS.map((k) => kindDemand(d, n, k, weather));
    out[n] = HOURS.map((h) => series.reduce((s, x) => s + x[h], 0));
  }
  byW[weather] = out;
  return out;
}

export function systemDemand(loads: Record<string, number[]>): number[] {
  return HOURS.map((h) => Object.values(loads).reduce((s, x) => s + (x[h] ?? 0), 0));
}

export function argmax(xs: number[]): number {
  let k = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[k] + 1e-9) k = i;
  return k;
}

// ---------------------------------------------------------------------------
// The physical system at each stage of the chapter.

export type Stage = 'base' | 'transition' | 'vpp' | 'portfolio';

export interface GridBattery {
  id: string;
  node: string;
  powerMW: number;
  energyMWh: number;
  efficiency: number;
  soc0: number;
  /** Where it came from: a grid-scale project or the VPP's home batteries. */
  kind: 'grid' | 'vpp';
}

export interface DrProgram {
  id: string;
  node: string;
  /** Load the program can turn down, MW. */
  mw: number;
  /** Hours per day it can be called. */
  hours: number;
  /** Paid to customers per MWh not used, $. */
  incentive: number;
}

export interface GridSystem {
  net: Network;
  gens: Generator[];
  batteries: GridBattery[];
  dr: DrProgram[];
  /** Hourly demand at each node before storage and demand response, MW. */
  loads: Record<string, number[]>;
  weather: WeatherId;
}

export function networkOf(d: CapstoneDesign): Network {
  return {
    nodes: d.nodes.map((id) => ({ id, name: SITE[id].name, x: SITE[id].x, y: SITE[id].y })),
    lines: d.lines.map((l) => {
      const c = CORRIDOR[l.id];
      return { id: l.id, from: c.from, to: c.to, reactance: c.reactance, limit: l.limit, lengthKm: c.lengthKm };
    }),
  };
}

/** A project the reader can add on top of the design (used by 8.4–8.6). */
export interface Addition {
  gens?: Generator[];
  batteries?: GridBattery[];
  dr?: DrProgram[];
  /** Extra MW of rating on existing lines. */
  upgrades?: Record<string, number>;
}

/** The transition plan of 8.4 as plants and a battery. */
export function transitionAdditions(d: CapstoneDesign): Addition {
  const t = d.transition;
  const gens: Generator[] = [];
  const built = new Set(d.nodes);
  if (t.windMW > 0 && built.has(t.windNode)) gens.push(makeGenerator({ id: 'tr-wind', name: `${SITE[t.windNode].name} wind (new)`, fuel: 'wind', node: t.windNode, capacity: t.windMW, marginalCost: 0 }));
  if (t.solarMW > 0 && built.has(t.solarNode)) gens.push(makeGenerator({ id: 'tr-solar', name: `${SITE[t.solarNode].name} solar (new)`, fuel: 'solar', node: t.solarNode, capacity: t.solarMW, marginalCost: 0 }));
  const batteries: GridBattery[] = [];
  if (t.storageMW > 0 && built.has(t.storageNode))
    batteries.push({ id: 'tr-battery', node: t.storageNode, powerMW: t.storageMW, energyMWh: t.storageMW * t.storageHours, efficiency: 0.85, soc0: 0.5, kind: 'grid' });
  return { gens, batteries };
}

/** The 8.5 virtual power plant's energy share as one battery per node. */
export function vppBatteries(d: CapstoneDesign, share = 1 - d.vpp.services): GridBattery[] {
  const out: GridBattery[] = [];
  for (const n of d.nodes) {
    const mw = d.vpp.mw[n] ?? 0;
    if (mw <= 0 || share <= 0) continue;
    out.push({ id: `vpp-${n}`, node: n, powerMW: mw * share, energyMWh: mw * d.vpp.hours * share, efficiency: 0.88, soc0: 0.5, kind: 'vpp' });
  }
  return out;
}

export function applyAddition(sys: GridSystem, a: Addition): GridSystem {
  const net = a.upgrades ? { ...sys.net, lines: sys.net.lines.map((l) => (a.upgrades![l.id] ? { ...l, limit: l.limit + a.upgrades![l.id] } : l)) } : sys.net;
  return { ...sys, net, gens: [...sys.gens, ...(a.gens ?? [])], batteries: [...sys.batteries, ...(a.batteries ?? [])], dr: [...sys.dr, ...(a.dr ?? [])] };
}

/** The grid as it stands at a stage of the chapter, on a given day. */
export function systemOf(d: CapstoneDesign, stage: Stage = 'base', weather: WeatherId = d.weather): GridSystem {
  let sys: GridSystem = { net: networkOf(d), gens: d.gens.filter((g) => g.capacity > 0), batteries: [], dr: [], loads: nodeDemand(d, weather), weather };
  if (stage === 'base') return sys;
  sys = applyAddition(sys, transitionAdditions(d));
  if (stage === 'transition') return sys;
  sys = applyAddition(sys, { batteries: vppBatteries(d) });
  return sys;
}

// ---------------------------------------------------------------------------
// Offers and availability.

/** Renewables with a production credit offer slightly below zero, as in the course's market history. */
export function offerOf(g: Generator): number {
  return g.fuel === 'wind' ? -5 : g.fuel === 'solar' ? -2 : g.marginalCost;
}

export function availability(g: Generator, weather: WeatherId): number[] | undefined {
  if (g.fuel === 'wind') return windCF(weather).map((cf) => cf * g.capacity);
  if (g.fuel === 'solar') return solarCF(weather).map((cf) => cf * g.capacity);
  return undefined;
}

export function dayUnits(sys: GridSystem): DayUnit[] {
  return sys.gens.map((g) => ({
    id: g.id,
    node: g.node ?? '',
    capacity: g.capacity,
    offer: offerOf(g),
    minOutput: g.dispatchable ? 0 : g.minOutput,
    available: availability(g, sys.weather),
  }));
}

/** MW each plant could produce in an hour. */
export function availableAt(g: Generator, weather: WeatherId, h: number): number {
  return availability(g, weather)?.[h] ?? g.capacity;
}

// ---------------------------------------------------------------------------
// The 24-hour market.

export interface StorageRun {
  id: string;
  node: string;
  kind: 'grid' | 'vpp';
  /** MW per hour, + discharging. */
  schedule: number[];
  soc: number[];
  /** Earned at the final nodal prices, $. */
  revenue: number;
}

export interface DrRun {
  id: string;
  node: string;
  /** MW of demand turned down each hour. */
  schedule: number[];
  /** Paid at nodal prices minus customer incentives, $. */
  margin: number;
}

export interface MarketRun {
  sys: GridSystem;
  units: DayUnit[];
  /** The day cleared before storage and demand response respond to prices. */
  first: NodalHour[];
  /** The final day, with demand response and storage scheduled against the prices. */
  hours: NodalHour[];
  summary: NodalDaySummary;
  storage: StorageRun[];
  dr: DrRun[];
  /** Demand left for the market at each node after storage and demand response, MW. */
  netLoads: Record<string, number[]>;
  /** Region demand before storage and demand response. */
  demand: number[];
  ms: number;
}

const MARKET_CACHE = new Map<string, MarketRun>();
const CACHE_SIZE = 40;
const HOUR_CACHE = new Map<string, NodalHour>();
const HOUR_CACHE_SIZE = 3000;

/** Forget every cached market run (for timing tests). */
export function clearMarketCache() {
  MARKET_CACHE.clear();
  HOUR_CACHE.clear();
}

/** Storage is scheduled in this many equal slices, each responding to the prices left by the ones before. */
export const STORAGE_SLICES = 4;

function keyOf(sys: GridSystem): string {
  return JSON.stringify([
    sys.net.nodes.map((n) => n.id),
    sys.net.lines.map((l) => [l.id, l.from, l.to, l.reactance, l.limit]),
    sys.gens.map((g) => [g.id, g.node, g.fuel, g.capacity, g.marginalCost, g.minOutput, g.dispatchable]),
    sys.batteries.map((b) => [b.id, b.node, b.powerMW, b.energyMWh, b.efficiency]),
    sys.dr.map((p) => [p.id, p.node, p.mw, p.hours, p.incentive]),
    sys.weather,
    Object.entries(sys.loads).map(([n, v]) => [n, v.map((x) => Math.round(x * 100) / 100)]),
  ]);
}

/**
 * Clear each hour with clearNodalHour, reusing hours whose inputs haven't changed (an hour in which
 * a battery is idle clears the same way on every pass).
 */
function clearDay(net: Network, units: DayUnit[], loads: Record<string, number[]>, injections: Record<string, number[]> = {}): NodalHour[] {
  const netKey = JSON.stringify(net.lines.map((l) => [l.id, l.from, l.to, l.reactance, l.limit])) + JSON.stringify(net.nodes.map((n) => n.id));
  const candidates = net.lines.filter((l) => findIslands(net, [l.id]).length === findIslands(net).length).map((l) => l.id);
  const out: NodalHour[] = [];
  for (let h = 0; h < 24; h++) {
    const ld: Record<string, number> = {};
    for (const n of net.nodes) {
      const v = (loads[n.id]?.[h] ?? 0) - (injections[n.id]?.[h] ?? 0);
      if (Math.abs(v) > 1e-9) ld[n.id] = Math.round(v * 1000) / 1000;
    }
    const uKey = units.map((u) => `${u.id}@${u.node}:${Math.round((u.available?.[h] ?? u.capacity) * 1000)}/${u.offer}/${u.minOutput ?? 0}`).join(',');
    const key = `${netKey}|${uKey}|${JSON.stringify(ld)}`;
    let r = HOUR_CACHE.get(key);
    if (!r) {
      r = clearNodalHour(net, units, ld, h, { candidates });
      HOUR_CACHE.set(key, r);
      if (HOUR_CACHE.size > HOUR_CACHE_SIZE) HOUR_CACHE.delete(HOUR_CACHE.keys().next().value!);
    } else if (r.hour !== h) r = { ...r, hour: h };
    out.push(r);
  }
  return out;
}

/** Demand response: turn the program's load down in the most expensive hours above its incentive. */
function drSchedule(p: DrProgram, prices: number[]): number[] {
  const order = HOURS.filter((h) => prices[h] > p.incentive).sort((a, b) => prices[b] - prices[a]);
  const on = new Set(order.slice(0, Math.round(p.hours)));
  return HOURS.map((h) => (on.has(h) ? p.mw : 0));
}

/**
 * Clear the day on the reader's grid. Demand response is called in the most expensive hours of a
 * first pass without storage. Storage is then added in a few equal slices: each slice optimizes
 * arbitrage (Lesson 6.4) at its node against the prices left by the slices before it, the day is
 * cleared again, and a battery keeps its new slice only if it then earns more than without it. A
 * battery big enough to move prices therefore stops before it erases its own spread — a rough
 * stand-in for the many small, competing decisions of a real market, not an equilibrium.
 */
export function runMarket(sys: GridSystem): MarketRun {
  const key = keyOf(sys);
  const hit = MARKET_CACHE.get(key);
  if (hit) {
    MARKET_CACHE.delete(key);
    MARKET_CACHE.set(key, hit);
    return hit;
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const units = dayUnits(sys);
  const net = sys.net;
  const built = new Set(net.nodes.map((n) => n.id));
  const first = clearDay(net, units, sys.loads);
  let hours = first;
  const injections: Record<string, number[]> = {};
  const add = (node: string, sched: number[]) => {
    const inj = (injections[node] ??= HOURS.map(() => 0));
    sched.forEach((mw, h) => (inj[h] += mw));
  };
  const pricesAt = (day: NodalHour[], n: string) => day.map((h) => h.lmp[n] ?? 0);

  const dr: DrRun[] = [];
  for (const p of sys.dr) {
    if (!built.has(p.node) || p.mw <= 0) continue;
    const sched = drSchedule(p, pricesAt(first, p.node)).map((mw, h) => Math.min(mw, sys.loads[p.node]?.[h] ?? 0));
    dr.push({ id: p.id, node: p.node, schedule: sched, margin: 0 });
    add(p.node, sched);
  }
  if (dr.length) hours = clearDay(net, units, sys.loads, injections);

  const bats = sys.batteries.filter((b) => built.has(b.node) && b.powerMW > 0 && b.energyMWh > 0);
  const storage: StorageRun[] = bats.map((b) => ({ id: b.id, node: b.node, kind: b.kind, schedule: HOURS.map(() => 0), soc: [], revenue: 0 }));
  const earnedBy = (day: NodalHour[], i: number, sched: number[]) => sched.reduce((a, mw, h) => a + mw * (day[h].lmp[bats[i].node] ?? 0), 0);
  if (bats.length) {
    const active = bats.map(() => true);
    let revs = bats.map(() => 0);
    const zero = () => HOURS.map(() => 0);
    const withSlices = (add: number[][]) => {
      const inj: Record<string, number[]> = Object.fromEntries(Object.entries(injections).map(([n, v]) => [n, [...v]]));
      add.forEach((x, i) => {
        const v = (inj[bats[i].node] ??= zero());
        x.forEach((mw, h) => (v[h] += mw));
      });
      return inj;
    };
    for (let k = 0; k < STORAGE_SLICES && active.some(Boolean); k++) {
      const add = bats.map((b, i) => {
        if (!active[i]) return zero();
        const slice = { powerMW: b.powerMW / STORAGE_SLICES, energyMWh: b.energyMWh / STORAGE_SLICES, efficiency: b.efficiency, soc0: b.soc0 };
        return optimizeArbitrage(pricesAt(hours, b.node), slice, { levels: 21 }).schedule;
      });
      add.forEach((x, i) => {
        if (x.every((mw) => Math.abs(mw) < 1e-6)) active[i] = false;
      });
      if (add.every((x) => x.every((mw) => Math.abs(mw) < 1e-6))) break;
      let inj = withSlices(add);
      let next = clearDay(net, units, sys.loads, inj);
      let trial = add.map((x, i) => earnedBy(next, i, storage[i].schedule.map((mw, h) => mw + x[h])));
      // Each battery keeps its new slice only if, once the slice's own effect on prices is felt, it earns more.
      const losers = add.map((_x, i) => active[i] && trial[i] < revs[i] + 1);
      if (losers.some(Boolean)) {
        losers.forEach((l, i) => {
          if (l) {
            add[i] = zero();
            active[i] = false;
          }
        });
        if (add.every((x) => x.every((mw) => Math.abs(mw) < 1e-6))) break;
        inj = withSlices(add);
        next = clearDay(net, units, sys.loads, inj);
        trial = add.map((x, i) => earnedBy(next, i, storage[i].schedule.map((mw, h) => mw + x[h])));
      }
      revs = trial;
      hours = next;
      Object.keys(inj).forEach((n) => (injections[n] = inj[n]));
      add.forEach((x, i) => (storage[i].schedule = storage[i].schedule.map((mw, h) => mw + x[h])));
    }
    bats.forEach((b, i) => {
      const s = storage[i];
      s.soc = runBattery(b, s.schedule).soc;
      s.revenue = s.schedule.reduce((acc, mw, h) => acc + mw * (hours[h].lmp[s.node] ?? 0), 0);
    });
  }
  for (const r of dr) {
    const p = sys.dr.find((x) => x.id === r.id)!;
    r.margin = r.schedule.reduce((acc, mw, h) => acc + mw * ((hours[h].lmp[r.node] ?? 0) - p.incentive), 0);
  }

  const netLoads: Record<string, number[]> = {};
  for (const n of net.nodes) netLoads[n.id] = HOURS.map((h) => (sys.loads[n.id]?.[h] ?? 0) - (injections[n.id]?.[h] ?? 0));
  const costs = Object.fromEntries(sys.gens.map((g) => [g.id, g.marginalCost]));
  const run: MarketRun = {
    sys,
    units,
    first,
    hours,
    summary: summarizeNodalDay(hours, units, costs),
    storage,
    dr,
    netLoads,
    demand: systemDemand(sys.loads),
    ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
  MARKET_CACHE.set(key, run);
  if (MARKET_CACHE.size > CACHE_SIZE) MARKET_CACHE.delete(MARKET_CACHE.keys().next().value!);
  return run;
}

/** Emissions of a market day, tonnes of CO2. */
export function emissions(run: MarketRun): number {
  return run.sys.gens.reduce((s, g) => s + g.emissions * (run.summary.units[g.id]?.mwh ?? 0), 0);
}

/** Generation by fuel, MW per hour, for stacked charts. */
export function outputByFuel(run: MarketRun): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const g of run.sys.gens) {
    const s = (out[g.fuel] ??= HOURS.map(() => 0));
    run.hours.forEach((h, i) => (s[i] += h.dispatch[g.id] ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning checks: connected, enough capacity at the peak, and N-1 secure at the peak.

export const RESERVE_TARGET = 0.15;

export interface DesignChecks {
  empty: boolean;
  peakHour: number;
  peakMW: number;
  connected: { ok: boolean; cutOff: string[] };
  capacity: { ok: boolean; firm: number; margin: number; required: number };
  n1: { ok: boolean; shedMW: number; radial: Array<{ line: string; nodes: string[] }>; binding: Array<{ outage: string; line: string }>; securityCost: number };
  ok: boolean;
  /** Net injections at the peak for the cheapest dispatch and for the N-1 secure one, MW. */
  cheapInjections: Record<string, number>;
  secureInjections: Record<string, number>;
  /** Peak-hour MW of each plant in the secure dispatch. */
  secureDispatch: Record<string, number>;
}

/** Firm capacity in an hour: plants at what the weather allows, batteries at what they can hold for four hours. */
export function firmCapacity(sys: GridSystem, h: number): number {
  const gens = sys.gens.reduce((s, g) => s + availableAt(g, sys.weather, h), 0);
  const bats = sys.batteries.reduce((s, b) => s + Math.min(b.powerMW, b.energyMWh / 4), 0);
  const dr = sys.dr.reduce((s, p) => s + p.mw, 0);
  return gens + bats + dr;
}

/**
 * Check a system at its peak hour. `injections` are fixed MW at nodes in that hour (storage,
 * demand response) to count against demand in the N-1 check.
 */
export function checkSystem(sys: GridSystem, injections: Record<string, number> = {}): DesignChecks {
  const demand = systemDemand(sys.loads);
  const peakHour = argmax(demand);
  const peakMW = demand[peakHour] ?? 0;
  const empty = sys.net.nodes.length === 0;
  const cutOff = disconnectedNodes(sys.net);
  const firm = firmCapacity(sys, peakHour);
  const required = peakMW * (1 + RESERVE_TARGET);
  const margin = reserveMargin(firm, peakMW);

  const gens = sys.gens.map((g) => {
    const cap = availableAt(g, sys.weather, peakHour);
    return { id: g.id, node: g.node ?? '', capacity: cap, offer: offerOf(g), minOutput: g.dispatchable ? 0 : Math.min(cap, g.minOutput) };
  });
  const loads: Record<string, number> = {};
  for (const n of sys.net.nodes) {
    const v = (sys.loads[n.id]?.[peakHour] ?? 0) - (injections[n.id] ?? 0);
    if (Math.abs(v) > 1e-9) loads[n.id] = v;
  }
  let n1: DesignChecks['n1'] = { ok: false, shedMW: 0, radial: [], binding: [], securityCost: 0 };
  let cheapInjections: Record<string, number> = {};
  let secureInjections: Record<string, number> = {};
  let secureDispatch: Record<string, number> = {};
  if (!empty) {
    let g2 = gens;
    let sec = n1Security(sys.net, g2, loads);
    if (!Number.isFinite(sec.cost) || !Number.isFinite(sec.baseCost)) {
      g2 = gens.map((g) => ({ ...g, minOutput: 0 }));
      sec = n1Security(sys.net, g2, loads);
    }
    cheapInjections = nodalInjections(sys.net, g2, sec.baseDispatch, loads, sec.baseShed);
    secureInjections = Number.isFinite(sec.cost) ? nodalInjections(sys.net, g2, sec.dispatch, loads, sec.shed) : cheapInjections;
    secureDispatch = Number.isFinite(sec.cost) ? sec.dispatch : sec.baseDispatch;
    // A radial line only matters if losing it cuts off customers or plants.
    const baseIslands = findIslands(sys.net).length;
    const radial: Array<{ line: string; nodes: string[] }> = [];
    for (const l of sys.net.lines) {
      const isl = findIslands(sys.net, [l.id]);
      if (isl.length <= baseIslands) continue;
      const main = isl.reduce((a, b) => (b.length > a.length ? b : a));
      const cut = isl.filter((g) => g !== main && !cutOff.some((c) => g.includes(c))).flat();
      if (cut.some((n) => (loads[n] ?? 0) > 0.5 || sys.gens.some((g) => g.node === n && g.capacity > 0))) radial.push({ line: l.id, nodes: cut });
    }
    n1 = {
      ok: Number.isFinite(sec.cost) && sec.shedMW < 0.5 && radial.length === 0,
      shedMW: sec.shedMW,
      radial,
      binding: sec.binding,
      securityCost: Number.isFinite(sec.cost) && Number.isFinite(sec.baseCost) ? sec.cost - sec.baseCost : 0,
    };
  }
  const connected = { ok: !empty && cutOff.length === 0, cutOff };
  const capacity = { ok: !empty && firm >= required - 1e-6, firm, margin, required };
  return { empty, peakHour, peakMW, connected, capacity, n1, ok: connected.ok && capacity.ok && n1.ok, cheapInjections, secureInjections, secureDispatch };
}

const checkCache = new WeakMap<CapstoneDesign, DesignChecks>();

/** The three planning checks for the reader's base design (8.1). */
export function checkDesign(d: CapstoneDesign): DesignChecks {
  const hit = checkCache.get(d);
  if (hit) return hit;
  const c = checkSystem(systemOf(d, 'base'));
  checkCache.set(d, c);
  return c;
}

// ---------------------------------------------------------------------------
// Capital cost.

export interface CapitalTally {
  substations: number;
  lines: number;
  generation: number;
  storage: number;
  total: number;
}

export function plantCapex(g: Generator): number {
  return g.capacity * 1000 * (TECH[g.fuel]?.capexPerKW ?? 1000);
}

export function batteryCapex(powerMW: number, energyMWh: number): number {
  return powerMW * 1000 * BATTERY_CAPEX.perKW + energyMWh * 1000 * BATTERY_CAPEX.perKWh;
}

export function lineCapex(lengthKm: number, limit: number): number {
  return lengthKm * lineCostPerKm(limit);
}

/** Capital cost of the 8.4 transition plan's plants and battery. */
export function transitionCapex(d: CapstoneDesign): number {
  const a = transitionAdditions(d);
  return (a.gens ?? []).reduce((s, g) => s + plantCapex(g), 0) + (a.batteries ?? []).reduce((s, b) => s + batteryCapex(b.powerMW, b.energyMWh), 0);
}

/** What the base design would cost to build today (illustrative overnight costs). */
export function capitalCost(d: CapstoneDesign): CapitalTally {
  const substations = d.nodes.length * SUBSTATION_COST;
  const lines = d.lines.reduce((s, l) => s + lineCapex(CORRIDOR[l.id].lengthKm, l.limit), 0);
  const generation = d.gens.reduce((s, g) => s + plantCapex(g), 0);
  return { substations, lines, generation, storage: 0, total: substations + lines + generation };
}

// ---------------------------------------------------------------------------
// Small display helpers.

export function siteName(id: string): string {
  return SITE[id]?.name ?? id;
}

export function lineName(id: string): string {
  const c = CORRIDOR[id];
  return c ? `${siteName(c.from)}–${siteName(c.to)}` : id;
}

export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
