// DC power flow: the linearized model grid operators use for markets. Each line carries
// (θ_from − θ_to) / x, and power divides across parallel paths in inverse proportion to reactance.

import type { Network } from '../../model/types';

/** Connected groups of nodes once the given lines are out of service. */
export function findIslands(net: Network, outages: string[] = []): string[][] {
  const out = new Set(outages);
  const adj = new Map<string, string[]>(net.nodes.map((n) => [n.id, []]));
  for (const l of net.lines) {
    if (out.has(l.id)) continue;
    adj.get(l.from)?.push(l.to);
    adj.get(l.to)?.push(l.from);
  }
  const seen = new Set<string>();
  const islands: string[][] = [];
  for (const n of net.nodes) {
    if (seen.has(n.id)) continue;
    const group: string[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const m of adj.get(id) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    // Keep network order inside each island so the slack (first node) is predictable.
    islands.push(net.nodes.map((x) => x.id).filter((id) => group.includes(id)));
  }
  return islands;
}

/** Inverse of a small dense matrix (Gauss–Jordan with partial pivoting). */
export function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('Singular matrix');
    [a[c], a[p]] = [a[p], a[c]];
    const piv = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export interface Ptdf {
  /** ptdf[line][node]: MW on the line per MW injected at the node and withdrawn at its island's slack. */
  ptdf: Record<string, Record<string, number>>;
  islands: string[][];
  /** Island index of each node. */
  islandOf: Record<string, number>;
}

/** Power transfer distribution factors for the network with some lines out. */
export function computePtdf(net: Network, outages: string[] = []): Ptdf {
  const out = new Set(outages);
  const islands = findIslands(net, outages);
  const islandOf: Record<string, number> = {};
  islands.forEach((g, i) => g.forEach((id) => (islandOf[id] = i)));
  const ptdf: Record<string, Record<string, number>> = {};
  for (const l of net.lines) ptdf[l.id] = Object.fromEntries(net.nodes.map((n) => [n.id, 0]));

  for (const group of islands) {
    if (group.length < 2) continue;
    const others = group.slice(1); // group[0] is the slack
    const idx = new Map(others.map((id, i) => [id, i]));
    const k = others.length;
    const B = Array.from({ length: k }, () => Array<number>(k).fill(0));
    for (const l of net.lines) {
      if (out.has(l.id) || !group.includes(l.from)) continue;
      const b = 1 / l.reactance;
      const i = idx.get(l.from);
      const j = idx.get(l.to);
      if (i !== undefined) B[i][i] += b;
      if (j !== undefined) B[j][j] += b;
      if (i !== undefined && j !== undefined) {
        B[i][j] -= b;
        B[j][i] -= b;
      }
    }
    const X = invert(B);
    for (const l of net.lines) {
      if (out.has(l.id) || !group.includes(l.from)) continue;
      const i = idx.get(l.from);
      const j = idx.get(l.to);
      for (const n of others) {
        const c = idx.get(n)!;
        const ti = i === undefined ? 0 : X[i][c];
        const tj = j === undefined ? 0 : X[j][c];
        ptdf[l.id][n] = (ti - tj) / l.reactance;
      }
    }
  }
  return { ptdf, islands, islandOf };
}

export interface FlowResult {
  /** MW on each line, positive from → to; 0 for lines out of service. */
  flows: Record<string, number>;
  islands: string[][];
  /** Per island: MW the slack node had to absorb to balance it (positive = shortfall of supply). */
  imbalance: number[];
}

/**
 * Flows for given net injections (generation − demand) at each node. Any imbalance within an
 * island is taken by that island's first node, as a real system's frequency response would.
 */
export function dcPowerFlow(net: Network, injections: Record<string, number>, outages: string[] = []): FlowResult {
  const { ptdf, islands } = computePtdf(net, outages);
  const flows: Record<string, number> = {};
  for (const l of net.lines) {
    let f = 0;
    for (const n of net.nodes) f += ptdf[l.id][n.id] * (injections[n.id] ?? 0);
    flows[l.id] = Math.abs(f) < 1e-9 ? 0 : f;
  }
  const imbalance = islands.map((g) => -g.reduce((s, id) => s + (injections[id] ?? 0), 0));
  return { flows, islands, imbalance };
}
