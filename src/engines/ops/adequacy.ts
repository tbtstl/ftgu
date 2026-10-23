// Planning checks for a grid design: is it one connected network, does it have enough capacity
// for the peak with a reserve margin, and can it serve the peak while surviving the loss of any
// single line (N-1)?

import type { Network } from '../../model/types';
import { dcopf, type OpfGenerator } from '../market/opf';
import { dcPowerFlow, findIslands } from '../physics/powerflow';

/** Nodes outside the largest connected group (empty when the network is connected). */
export function disconnectedNodes(net: Network): string[] {
  const islands = findIslands(net);
  if (islands.length <= 1) return [];
  const main = islands.reduce((a, b) => (b.length > a.length ? b : a));
  return islands.filter((g) => g !== main).flat();
}

/** Spare capacity as a share of demand: (capacity − demand) / demand. */
export function reserveMargin(capacityMW: number, demandMW: number): number {
  return demandMW > 1e-9 ? (capacityMW - demandMW) / demandMW : capacityMW > 0 ? Infinity : 0;
}

export interface SecurityCheck {
  /** Peak served with no shedding, and every single-line outage survivable. */
  secure: boolean;
  /** Load that would have to be turned away to keep every outage survivable, MW. */
  shedMW: number;
  /** Lines whose loss would cut part of the grid off entirely. */
  islanding: string[];
  /** (outage, line) pairs at their limit in the secure dispatch. */
  binding: Array<{ outage: string; line: string }>;
  /** Cost of the secure dispatch and of the cheapest (insecure) one, $/h. */
  cost: number;
  baseCost: number;
  /** Secure dispatch, MW per generator. */
  dispatch: Record<string, number>;
  /** Cheapest dispatch, ignoring contingencies. */
  baseDispatch: Record<string, number>;
  /** Load shed at each node in the secure and in the cheapest dispatch, MW. */
  shed: Record<string, number>;
  baseShed: Record<string, number>;
}

/** Preventive N-1 check: one dispatch that keeps every line within limits after any single line outage. */
export function n1Security(net: Network, gens: OpfGenerator[], loads: Record<string, number>, opts: { voll?: number; emergencyRating?: number } = {}): SecurityCheck {
  const voll = opts.voll ?? 1000;
  const base = dcopf(net, gens, loads, { voll, lmp: false });
  const sec = dcopf(net, gens, loads, { voll, lmp: false, contingencies: net.lines.map((l) => l.id), emergencyRating: opts.emergencyRating });
  const shed = sec.feasible ? Object.values(sec.shed).reduce((s, v) => s + v, 0) : Object.values(loads).reduce((s, v) => s + Math.max(0, v), 0);
  return {
    secure: sec.feasible && shed < 0.5 && sec.islanding.length === 0,
    shedMW: shed,
    islanding: sec.islanding,
    binding: sec.bindingContingencies,
    cost: sec.cost,
    baseCost: base.cost,
    dispatch: sec.dispatch,
    baseDispatch: base.dispatch,
    shed: sec.shed,
    baseShed: base.shed,
  };
}

export interface OutageImpact {
  /** Flows immediately after the outage, before any redispatch, MW. */
  flows: Record<string, number>;
  /** Lines pushed past their limit. */
  overloads: string[];
  /** Highest loading as a share of the limit. */
  maxLoading: number;
  /** Nodes cut off from the rest of the grid. */
  islanded: string[];
}

/** Net injection (generation − served demand) at each node for a dispatch. */
export function nodalInjections(net: Network, gens: OpfGenerator[], dispatch: Record<string, number>, loads: Record<string, number>, shed: Record<string, number> = {}): Record<string, number> {
  const inj: Record<string, number> = {};
  for (const n of net.nodes) inj[n.id] = -(loads[n.id] ?? 0) + (shed[n.id] ?? 0);
  for (const g of gens) inj[g.node] = (inj[g.node] ?? 0) + (dispatch[g.id] ?? 0);
  return inj;
}

/** What happens the instant a line trips, given the generation and demand at each node. */
export function outageImpact(net: Network, injections: Record<string, number>, outage: string | null): OutageImpact {
  const outs = outage ? [outage] : [];
  const { flows, islands } = dcPowerFlow(net, injections, outs);
  let maxLoading = 0;
  const overloads: string[] = [];
  for (const l of net.lines) {
    if (l.id === outage) continue;
    const u = l.limit > 0 ? Math.abs(flows[l.id]) / l.limit : 0;
    maxLoading = Math.max(maxLoading, u);
    if (u > 1 + 1e-6) overloads.push(l.id);
  }
  const baseIslands = findIslands(net).length;
  let islanded: string[] = [];
  if (islands.length > baseIslands) {
    const main = islands.reduce((a, b) => (b.length > a.length ? b : a));
    islanded = islands.filter((g) => g !== main).flat();
  }
  return { flows, overloads, maxLoading, islanded };
}
