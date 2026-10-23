// Network-constrained economic dispatch (DC optimal power flow) and locational marginal prices.
// Optionally security-constrained: dispatch must also keep every line within limits after any
// single listed line outage (N-1).

import type { Network } from '../../model/types';
import { computePtdf, dcPowerFlow } from '../physics/powerflow';
import { solveLP } from './lp';

export interface OpfGenerator {
  id: string;
  node: string;
  /** Maximum output, MW. */
  capacity: number;
  /** Must-run floor, MW. */
  minOutput?: number;
  /** Offer price, $/MWh (may be negative). */
  offer: number;
}

export interface OpfOptions {
  /** Lines out of service in the base case. */
  outages?: string[];
  /** Lines whose loss the dispatch must survive (N-1). */
  contingencies?: string[];
  /** Post-contingency limit as a multiple of the normal limit (short-term emergency rating). */
  emergencyRating?: number;
  /** Override line limits, MW. */
  limits?: Record<string, number>;
  /** Value of lost load: the price of involuntarily cutting customers, $/MWh. */
  voll?: number;
  /** Compute LMPs (costs one extra solve per node). Default true. */
  lmp?: boolean;
}

export interface OpfResult {
  feasible: boolean;
  dispatch: Record<string, number>;
  /** Load shed at each node, MW. */
  shed: Record<string, number>;
  /** Base-case line flows, MW (positive from → to). */
  flows: Record<string, number>;
  /** Locational marginal price at each node, $/MWh. */
  lmp: Record<string, number>;
  /** Total offer cost, including shed load at VOLL. */
  cost: number;
  /** What loads pay minus what generators receive, $/h. */
  congestionRent: number;
  /** Lines at their limit in the base case. */
  binding: string[];
  /** (outage, line) pairs at their emergency limit. */
  bindingContingencies: Array<{ outage: string; line: string }>;
  /** Contingencies skipped because the outage would split the grid into islands. */
  islanding: string[];
}

interface Core {
  feasible: boolean;
  x: number[];
  cost: number;
}

/** Economic dispatch across a network. `loads` is MW of demand at each node. */
export function dcopf(net: Network, gens: OpfGenerator[], loads: Record<string, number>, opts: OpfOptions = {}): OpfResult {
  const voll = opts.voll ?? 1000;
  const outages = opts.outages ?? [];
  const base = computePtdf(net, outages);
  const loadNodes = net.nodes.map((n) => n.id).filter((id) => (loads[id] ?? 0) > 0);
  const limitOf = (id: string) => opts.limits?.[id] ?? net.lines.find((l) => l.id === id)!.limit;

  // Contingency cases: PTDFs with one more line out. Skip any that would island a node.
  const islanding: string[] = [];
  const cases: Array<{ outage: string; ptdf: Record<string, Record<string, number>> }> = [];
  for (const k of opts.contingencies ?? []) {
    if (outages.includes(k)) continue;
    const p = computePtdf(net, [...outages, k]);
    if (p.islands.length > base.islands.length) islanding.push(k);
    else cases.push({ outage: k, ptdf: p.ptdf });
  }

  const solve = (ld: Record<string, number>): Core => {
    // Variables: y_j = output above min for each generator, then s_n = shed at each load node
    // (including a node whose load was just bumped to price it).
    const sheddable = net.nodes.map((n) => n.id).filter((id) => (ld[id] ?? 0) > 0);
    const nv = gens.length + sheddable.length;
    const c = [...gens.map((g) => g.offer), ...sheddable.map(() => voll)];
    const ub = [...gens.map((g) => Math.max(0, g.capacity - (g.minOutput ?? 0))), ...sheddable.map((n) => ld[n] ?? 0)];
    const A: number[][] = [];
    const b: number[] = [];
    const sense: Array<'<=' | '>=' | '='> = [];
    const fixedInj: Record<string, number> = {};
    for (const n of net.nodes) fixedInj[n.id] = -(ld[n.id] ?? 0);
    for (const g of gens) fixedInj[g.node] += g.minOutput ?? 0;

    // Energy balance in each island.
    base.islands.forEach((group) => {
      const row = Array<number>(nv).fill(0);
      gens.forEach((g, j) => {
        if (group.includes(g.node)) row[j] = 1;
      });
      sheddable.forEach((n, k) => {
        if (group.includes(n)) row[gens.length + k] = 1;
      });
      const rhs = -group.reduce((s, id) => s + fixedInj[id], 0);
      if (row.some((v) => v !== 0) || Math.abs(rhs) > 1e-9) {
        A.push(row);
        b.push(rhs);
        sense.push('=');
      }
    });

    const addFlowLimits = (ptdf: Record<string, Record<string, number>>, skip: string[], scale: number) => {
      for (const l of net.lines) {
        if (skip.includes(l.id)) continue;
        const row = Array<number>(nv).fill(0);
        gens.forEach((g, j) => (row[j] = ptdf[l.id][g.node]));
        sheddable.forEach((n, k) => (row[gens.length + k] = ptdf[l.id][n]));
        if (row.every((v) => Math.abs(v) < 1e-12)) continue;
        const k0 = net.nodes.reduce((s, n) => s + ptdf[l.id][n.id] * fixedInj[n.id], 0);
        const lim = limitOf(l.id) * scale;
        A.push(row);
        b.push(lim - k0);
        sense.push('<=');
        A.push(row);
        b.push(-lim - k0);
        sense.push('>=');
      }
    };
    addFlowLimits(base.ptdf, outages, 1);
    for (const cs of cases) addFlowLimits(cs.ptdf, [...outages, cs.outage], opts.emergencyRating ?? 1);

    const sol = solveLP({ c, A, b, sense, ub });
    if (sol.status !== 'optimal') return { feasible: false, x: Array(nv).fill(0), cost: NaN };
    const minCost = gens.reduce((s, g) => s + (g.minOutput ?? 0) * g.offer, 0);
    return { feasible: true, x: sol.x, cost: sol.objective + minCost };
  };

  const core = solve(loads);
  const dispatch: Record<string, number> = {};
  gens.forEach((g, j) => (dispatch[g.id] = (g.minOutput ?? 0) + (core.feasible ? core.x[j] : 0)));
  const shed: Record<string, number> = {};
  loadNodes.forEach((n, k) => (shed[n] = core.feasible ? core.x[gens.length + k] : 0));

  const inj: Record<string, number> = {};
  for (const n of net.nodes) inj[n.id] = -(loads[n.id] ?? 0) + (shed[n.id] ?? 0);
  for (const g of gens) inj[g.node] += dispatch[g.id];
  const { flows } = dcPowerFlow(net, inj, outages);

  const lmp: Record<string, number> = {};
  if (core.feasible && opts.lmp !== false) {
    const eps = 0.1;
    for (const n of net.nodes) {
      // The bumped node can always shed its extra load at VOLL, so the probe stays feasible.
      const bumped = solve({ ...loads, [n.id]: (loads[n.id] ?? 0) + eps });
      lmp[n.id] = bumped.feasible ? round2((bumped.cost - core.cost) / eps) : voll;
    }
  }

  const binding = net.lines.filter((l) => !outages.includes(l.id) && Math.abs(flows[l.id]) >= limitOf(l.id) - 1e-6).map((l) => l.id);
  const bindingContingencies: Array<{ outage: string; line: string }> = [];
  for (const cs of cases) {
    const post = dcPowerFlow(net, inj, [...outages, cs.outage]).flows;
    for (const l of net.lines) {
      if (l.id === cs.outage || outages.includes(l.id)) continue;
      if (Math.abs(post[l.id]) >= limitOf(l.id) * (opts.emergencyRating ?? 1) - 1e-6) bindingContingencies.push({ outage: cs.outage, line: l.id });
    }
  }

  let congestionRent = 0;
  if (Object.keys(lmp).length) {
    for (const n of net.nodes) congestionRent += (lmp[n.id] ?? 0) * ((loads[n.id] ?? 0) - (shed[n.id] ?? 0));
    for (const g of gens) congestionRent -= (lmp[g.node] ?? 0) * dispatch[g.id];
  }

  return { feasible: core.feasible, dispatch, shed, flows, lmp, cost: core.cost, congestionRent, binding, bindingContingencies, islanding };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
