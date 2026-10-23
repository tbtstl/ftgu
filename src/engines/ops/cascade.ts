// What happens after lines or plants fail: islands that must balance on their own, a scan of
// every single-line contingency (N-1), and a simple cascading-failure model in which lines
// loaded beyond a trip threshold disconnect, flows redistribute, and the process repeats.
//
// Flows use the DC approximation (powerflow.ts). Inside each island, generators share any
// shortfall in proportion to their spare capacity, as their governors would; when they run out,
// load is shed in proportion to demand. A surplus is shared back out of their output.

import type { Network } from '../../model/types';
import { dcPowerFlow, findIslands } from '../physics/powerflow';

export interface GridUnit {
  id: string;
  node: string;
  /** Most the unit can produce right now, MW. */
  capacity: number;
  /** What it is producing before the event, MW. */
  output: number;
}

export interface GridState {
  islands: string[][];
  /** Output of each unit after balancing its island, MW. */
  output: Record<string, number>;
  /** Load still served at each node, MW. */
  served: Record<string, number>;
  /** Load shed at each node, MW. */
  shed: Record<string, number>;
  shedTotal: number;
  /** Net injection at each node, MW. */
  injections: Record<string, number>;
  /** Line flows, MW (positive from → to); 0 for lines out of service. */
  flows: Record<string, number>;
  /** |flow| ÷ limit for each line in service. */
  loading: Record<string, number>;
}

function limitMap(net: Network, limits?: Record<string, number>): Record<string, number> {
  return Object.fromEntries(net.lines.map((l) => [l.id, limits?.[l.id] ?? l.limit]));
}

/**
 * Balance every island on its own and compute the flows. `loads` is the demand at each node;
 * units keep their output unless their island is short or long.
 */
export function islandFlows(net: Network, units: GridUnit[], loads: Record<string, number>, outages: string[] = [], limits?: Record<string, number>): GridState {
  const islands = findIslands(net, outages);
  const output: Record<string, number> = Object.fromEntries(units.map((u) => [u.id, Math.max(0, Math.min(u.capacity, u.output))]));
  const served: Record<string, number> = Object.fromEntries(net.nodes.map((n) => [n.id, Math.max(0, loads[n.id] ?? 0)]));
  for (const group of islands) {
    const us = units.filter((u) => group.includes(u.node));
    const gen = us.reduce((s, u) => s + output[u.id], 0);
    const dem = group.reduce((s, id) => s + served[id], 0);
    const gap = dem - gen;
    if (gap > 1e-9) {
      const head = us.reduce((s, u) => s + Math.max(0, u.capacity - output[u.id]), 0);
      const k = head > 0 ? Math.min(1, gap / head) : 0;
      for (const u of us) output[u.id] += k * Math.max(0, u.capacity - output[u.id]);
      const left = gap - k * head;
      if (left > 1e-9 && dem > 0) for (const id of group) served[id] -= (left * served[id]) / dem;
    } else if (gap < -1e-9) {
      const k = gen > 0 ? Math.min(1, -gap / gen) : 0;
      for (const u of us) output[u.id] -= k * output[u.id];
    }
  }
  const injections: Record<string, number> = Object.fromEntries(net.nodes.map((n) => [n.id, -served[n.id]]));
  for (const u of units) if (injections[u.node] !== undefined) injections[u.node] += output[u.id];
  const { flows } = dcPowerFlow(net, injections, outages);
  const lim = limitMap(net, limits);
  const loading: Record<string, number> = {};
  for (const l of net.lines) if (!outages.includes(l.id)) loading[l.id] = lim[l.id] > 0 ? Math.abs(flows[l.id]) / lim[l.id] : 0;
  const shed: Record<string, number> = Object.fromEntries(net.nodes.map((n) => [n.id, Math.max(0, (loads[n.id] ?? 0) - served[n.id])]));
  const shedTotal = Object.values(shed).reduce((s, v) => s + v, 0);
  return { islands, output, served, shed, shedTotal: shedTotal < 1e-6 ? 0 : shedTotal, injections, flows, loading };
}

/** Lines loaded above `threshold` × limit, most loaded first. */
export function overloadedLines(state: Pick<GridState, 'loading'>, threshold = 1): Array<{ line: string; loading: number }> {
  return Object.entries(state.loading)
    .filter(([, u]) => u > threshold + 1e-9)
    .map(([line, loading]) => ({ line, loading }))
    .sort((a, b) => b.loading - a.loading);
}

export interface ContingencyResult {
  /** The line that trips. */
  outage: string;
  /** Lines above their limit afterwards, most loaded first. */
  overloads: Array<{ line: string; loading: number }>;
  /** The most heavily loaded remaining line. */
  worst: { line: string; loading: number } | null;
  /** Nodes cut off from the rest of the grid by this outage. */
  separated: string[];
  /** Load that can't be served afterwards, MW. */
  shed: number;
  /** No overloads and no lost load. */
  ok: boolean;
}

/** N-1 scan: the state after losing each line still in service, one at a time, with the dispatch unchanged. */
export function scanContingencies(net: Network, units: GridUnit[], loads: Record<string, number>, outages: string[] = [], limits?: Record<string, number>): ContingencyResult[] {
  const before = findIslands(net, outages);
  return net.lines
    .filter((l) => !outages.includes(l.id))
    .map((l) => {
      const s = islandFlows(net, units, loads, [...outages, l.id], limits);
      const overloads = overloadedLines(s, 1);
      const entries = Object.entries(s.loading).sort((a, b) => b[1] - a[1]);
      const worst = entries.length ? { line: entries[0][0], loading: entries[0][1] } : null;
      // Nodes split off from the island they were in: every piece but the largest.
      const separated: string[] = [];
      for (const parent of before) {
        const pieces = s.islands.filter((g) => parent.includes(g[0]));
        if (pieces.length < 2) continue;
        const main = pieces.reduce((a, b) => (b.length > a.length ? b : a));
        for (const g of pieces) if (g !== main) separated.push(...g);
      }
      return { outage: l.id, overloads, worst, separated, shed: s.shedTotal, ok: overloads.length === 0 && s.shedTotal < 0.5 };
    });
}

export interface CascadeStep extends GridState {
  /** Lines out of service during this step. */
  outages: string[];
  /** Lines above the trip threshold, which disconnect before the next step. */
  tripping: string[];
}

export interface CascadeOptions {
  /** A line disconnects once its flow exceeds this multiple of its limit. Default 1.2. */
  tripAt?: number;
  limits?: Record<string, number>;
  maxSteps?: number;
}

/**
 * A cascade: apply the initial outages, rebalance islands, and disconnect every line above the
 * trip threshold; repeat until nothing more trips. Step 0 is the state right after the initial
 * outages. Load once shed stays shed.
 */
export function runCascade(net: Network, units: GridUnit[], loads: Record<string, number>, initialOutages: string[], opts: CascadeOptions = {}): CascadeStep[] {
  const tripAt = opts.tripAt ?? 1.2;
  const maxSteps = opts.maxSteps ?? net.lines.length + 1;
  const steps: CascadeStep[] = [];
  let outages = [...new Set(initialOutages)];
  let cur = units.map((u) => ({ ...u }));
  let served: Record<string, number> = { ...loads };
  for (let k = 0; k < maxSteps; k++) {
    const s = islandFlows(net, cur, served, outages, opts.limits);
    cur = cur.map((u) => ({ ...u, output: s.output[u.id] }));
    served = s.served;
    const shed: Record<string, number> = Object.fromEntries(net.nodes.map((n) => [n.id, Math.max(0, (loads[n.id] ?? 0) - s.served[n.id])]));
    const shedTotal = Object.values(shed).reduce((t, v) => t + v, 0);
    const tripping = overloadedLines(s, tripAt).map((o) => o.line);
    steps.push({ ...s, shed, shedTotal: shedTotal < 1e-6 ? 0 : shedTotal, outages: [...outages], tripping });
    if (!tripping.length) break;
    outages = [...outages, ...tripping];
  }
  return steps;
}
