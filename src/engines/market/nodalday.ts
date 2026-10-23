// A day of nodal market clearing: one security-constrained DC-OPF per hour, with locational
// prices, flows, congestion and settlement. Each hour is cleared on its own (no unit commitment,
// ramp limits or start-up costs); storage and demand response enter as fixed nodal injections.

import type { Network } from '../../model/types';
import { dcPowerFlow, findIslands } from '../physics/powerflow';
import { dcopf, type OpfGenerator, type OpfResult } from './opf';

export interface DayUnit {
  id: string;
  node: string;
  /** Nameplate capacity, MW. */
  capacity: number;
  /** Offer, $/MWh (may be negative). */
  offer: number;
  /** Must-run floor, MW. Relaxed in any hour where the grid can't absorb it. */
  minOutput?: number;
  /** MW available in each hour (weather, outages); defaults to capacity. */
  available?: number[];
}

export interface NodalDayInput {
  net: Network;
  units: DayUnit[];
  /** Demand at each node, MW, one value per hour. */
  loads: Record<string, number[]>;
  /** Fixed injections at nodes, MW per hour, + into the grid (battery discharge, demand response). */
  injections?: Record<string, number[]>;
  /**
   * Keep every hour's dispatch secure against the loss of any single line (N-1), as real
   * security-constrained dispatch does. Default true.
   */
  security?: boolean;
  /** Value of lost load, $/MWh (default 1,000). */
  voll?: number;
  /** Hours to clear (default: the length of the load series, or 24). */
  hours?: number;
}

export interface NodalHour extends OpfResult {
  hour: number;
  /** Demand the market had to serve at each node: load minus fixed injections, MW. */
  netLoad: Record<string, number>;
  /** Line outages the dispatch was made secure against this hour. */
  contingencies: string[];
  /** False when N-1 security could only be kept by shedding load, so the hour ran on normal limits only. */
  secure: boolean;
  /** Must-run floors had to be relaxed to balance the hour. */
  floorsRelaxed: boolean;
}

const TOL = 1e-3;

/** Lines whose loss would not split the network into more islands. */
function nonIslandingLines(net: Network): string[] {
  const base = findIslands(net).length;
  return net.lines.filter((l) => findIslands(net, [l.id]).length === base).map((l) => l.id);
}

function totalShed(r: OpfResult): number {
  return Object.values(r.shed).reduce((s, v) => s + v, 0);
}

function injectionsOf(net: Network, gens: OpfGenerator[], loads: Record<string, number>, r: OpfResult): Record<string, number> {
  const inj: Record<string, number> = {};
  for (const n of net.nodes) inj[n.id] = -(loads[n.id] ?? 0) + (r.shed[n.id] ?? 0);
  for (const g of gens) inj[g.node] = (inj[g.node] ?? 0) + (r.dispatch[g.id] ?? 0);
  return inj;
}

/** Outages (from `candidates`) after which some line would exceed its limit, for a given dispatch. */
export function violatedContingencies(net: Network, injections: Record<string, number>, candidates: string[]): string[] {
  const out: string[] = [];
  for (const k of candidates) {
    const f = dcPowerFlow(net, injections, [k]).flows;
    if (net.lines.some((l) => l.id !== k && Math.abs(f[l.id]) > l.limit + TOL)) out.push(k);
  }
  return out;
}

/**
 * Clear one hour. Starts from the cheapest dispatch, then adds the contingencies it violates
 * until the dispatch survives every single-line outage (or until that would need load shedding,
 * in which case the hour runs insecure on normal limits, as an operator would rather do).
 */
export function clearNodalHour(
  net: Network,
  units: DayUnit[],
  loads: Record<string, number>,
  hour: number,
  opts: { security?: boolean; voll?: number; candidates?: string[] } = {},
): NodalHour {
  const voll = opts.voll ?? 1000;
  const gensFor = (floors: boolean): OpfGenerator[] =>
    units.map((u) => {
      const cap = Math.max(0, Math.min(u.capacity, u.available?.[hour] ?? u.capacity));
      return { id: u.id, node: u.node, capacity: cap, offer: u.offer, minOutput: floors ? Math.min(cap, u.minOutput ?? 0) : 0 };
    });

  let floorsRelaxed = false;
  let gens = gensFor(true);
  let r = dcopf(net, gens, loads, { voll, lmp: false });
  if (!r.feasible) {
    floorsRelaxed = true;
    gens = gensFor(false);
    r = dcopf(net, gens, loads, { voll, lmp: false });
  }

  let contingencies: string[] = [];
  let secure = true;
  if (opts.security !== false && r.feasible && net.lines.length > 1) {
    const candidates = opts.candidates ?? nonIslandingLines(net);
    const shed0 = totalShed(r);
    for (let iter = 0; iter < 5; iter++) {
      const viol = violatedContingencies(net, injectionsOf(net, gens, loads, r), candidates.filter((k) => !contingencies.includes(k)));
      if (!viol.length) break;
      const next = [...contingencies, ...viol];
      const r2 = dcopf(net, gens, loads, { voll, lmp: false, contingencies: next });
      if (!r2.feasible || totalShed(r2) > shed0 + 0.01) {
        contingencies = [];
        secure = false;
        break;
      }
      contingencies = next;
      r = r2;
    }
  }

  const full = dcopf(net, gens, loads, { voll, contingencies });
  const netLoad: Record<string, number> = {};
  for (const n of net.nodes) netLoad[n.id] = loads[n.id] ?? 0;
  return { ...full, hour, netLoad, contingencies, secure, floorsRelaxed };
}

/** Clear every hour of a day. */
export function clearNodalDay(input: NodalDayInput): NodalHour[] {
  const { net, units } = input;
  const n = input.hours ?? Object.values(input.loads)[0]?.length ?? 24;
  const candidates = nonIslandingLines(net);
  const out: NodalHour[] = [];
  for (let h = 0; h < n; h++) {
    const ld: Record<string, number> = {};
    for (const node of net.nodes) {
      const v = (input.loads[node.id]?.[h] ?? 0) - (input.injections?.[node.id]?.[h] ?? 0);
      if (Math.abs(v) > 1e-9) ld[node.id] = v;
    }
    out.push(clearNodalHour(net, units, ld, h, { security: input.security, voll: input.voll, candidates }));
  }
  return out;
}

export interface UnitSettlement {
  id: string;
  mwh: number;
  /** Paid at the unit's nodal price, $. */
  revenue: number;
  /** Production cost at `costs` (or the offer), $. */
  cost: number;
  margin: number;
}

export interface NodalDaySummary {
  /** Energy-weighted average price paid by load at each node, $/MWh. */
  nodePrice: Record<string, number>;
  /** Load-weighted price across the system, per hour, $/MWh. */
  systemPrice: number[];
  /** Load-weighted average for the day, $/MWh. */
  averagePrice: number;
  /** Highest nodal price of the day and where/when it happened. */
  peakPrice: { price: number; node: string; hour: number };
  /** Hours in which some node's price was below zero. */
  negativeHours: number;
  /** Hours with a binding line limit or contingency constraint. */
  congestedHours: number;
  congestionRent: number;
  unservedMWh: number;
  /** What load paid at nodal prices, $. */
  loadPayments: number;
  /** Total production cost at offers, $. */
  productionCost: number;
  units: Record<string, UnitSettlement>;
  /** Hours whose dispatch couldn't be made N-1 secure without shedding. */
  insecureHours: number;
}

/** Settle a cleared day: prices, congestion, unserved energy and each unit's earnings. */
export function summarizeNodalDay(day: NodalHour[], units: DayUnit[], costs: Record<string, number> = {}): NodalDaySummary {
  const nodes = day.length ? Object.keys(day[0].netLoad) : [];
  const pay: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
  const mwh: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
  const systemPrice: number[] = [];
  let peak = { price: -Infinity, node: nodes[0] ?? '', hour: 0 };
  let negativeHours = 0;
  let congestedHours = 0;
  let congestionRent = 0;
  let unserved = 0;
  let loadPayments = 0;
  let productionCost = 0;
  let insecureHours = 0;
  let totalPay = 0;
  let totalMwh = 0;
  const settle: Record<string, UnitSettlement> = Object.fromEntries(units.map((u) => [u.id, { id: u.id, mwh: 0, revenue: 0, cost: 0, margin: 0 }]));

  for (const h of day) {
    let hp = 0;
    let hq = 0;
    for (const n of nodes) {
      const served = (h.netLoad[n] ?? 0) - (h.shed[n] ?? 0);
      const p = h.lmp[n] ?? 0;
      pay[n] += p * Math.max(0, served);
      mwh[n] += Math.max(0, served);
      hp += p * Math.max(0, served);
      hq += Math.max(0, served);
      loadPayments += p * served;
      if (p > peak.price) peak = { price: p, node: n, hour: h.hour };
    }
    const prices = nodes.map((n) => h.lmp[n] ?? 0);
    systemPrice.push(hq > 1e-9 ? hp / hq : prices.length ? prices.reduce((s, v) => s + v, 0) / prices.length : 0);
    totalPay += hp;
    totalMwh += hq;
    if (prices.some((p) => p < -1e-6)) negativeHours++;
    if (h.binding.length || h.bindingContingencies.length) congestedHours++;
    if (!h.secure) insecureHours++;
    congestionRent += h.congestionRent;
    unserved += Object.values(h.shed).reduce((s, v) => s + v, 0);
    for (const u of units) {
      const q = h.dispatch[u.id] ?? 0;
      const s = settle[u.id];
      const c = costs[u.id] ?? u.offer;
      s.mwh += q;
      s.revenue += q * (h.lmp[u.node] ?? 0);
      s.cost += q * c;
      productionCost += q * u.offer;
    }
  }
  for (const s of Object.values(settle)) s.margin = s.revenue - s.cost;
  return {
    nodePrice: Object.fromEntries(nodes.map((n) => [n, mwh[n] > 1e-9 ? pay[n] / mwh[n] : 0])),
    systemPrice,
    averagePrice: totalMwh > 1e-9 ? totalPay / totalMwh : 0,
    peakPrice: Number.isFinite(peak.price) ? peak : { price: 0, node: nodes[0] ?? '', hour: 0 },
    negativeHours,
    congestedHours,
    congestionRent,
    unservedMWh: unserved,
    loadPayments,
    productionCost,
    units: settle,
    insecureHours,
  };
}

/**
 * Congestion rent collected on each line in each hour: flow × (price at the receiving end −
 * price at the sending end). Summed over lines it equals the hour's total congestion rent.
 */
export function lineRents(net: Network, day: NodalHour[]): Record<string, number[]> {
  const out: Record<string, number[]> = Object.fromEntries(net.lines.map((l) => [l.id, [] as number[]]));
  for (const h of day) {
    for (const l of net.lines) {
      const f = h.flows[l.id] ?? 0;
      out[l.id].push(f * ((h.lmp[l.to] ?? 0) - (h.lmp[l.from] ?? 0)));
    }
  }
  return out;
}
