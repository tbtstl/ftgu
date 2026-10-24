// The ballast problem: ships come free where cargoes are discharged and are needed where cargoes
// are loaded. Matching the two at the least total distance sailed empty is a transportation
// problem; we solve it as a min-cost flow by successive shortest paths.
//
// Its dual gives every region a "positional value" in nautical miles: a ship ready to load at a
// region is worth the ballast miles it saves, relative to the region where ships are most plentiful.
// Wherever ships do ballast from i to j, value(j) − value(i) equals the distance between them.

export interface BallastFlow {
  from: string;
  to: string;
  /** Ships per period. */
  ships: number;
  nm: number;
}

export interface BallastPlan {
  flows: BallastFlow[];
  /** Total ballast miles per period. */
  miles: number;
  /** Positional value of a ship open after discharging at a region, nm. */
  open: Record<string, number>;
  /** Positional value of a ship ready to load at a region, nm. */
  ready: Record<string, number>;
}

interface Arc {
  to: number;
  cap: number;
  cost: number;
  rev: number;
}

const EPS = 1e-9;

/**
 * Min-cost transportation from `supply` (ships freed per region) to `demand` (ships needed per
 * region) over the distance matrix `dist[from][to]`. Supplies and demands must balance.
 */
export function ballastPlan(supply: Record<string, number>, demand: Record<string, number>, dist: Record<string, Record<string, number>>): BallastPlan {
  const S = Object.keys(supply).filter((k) => supply[k] > EPS);
  const D = Object.keys(demand).filter((k) => demand[k] > EPS);
  const n = S.length + D.length + 2;
  const src = n - 2;
  const snk = n - 1;
  const g: Arc[][] = Array.from({ length: n }, () => []);
  const add = (u: number, v: number, cap: number, cost: number) => {
    g[u].push({ to: v, cap, cost, rev: g[v].length });
    g[v].push({ to: u, cap: 0, cost: -cost, rev: g[u].length - 1 });
  };
  S.forEach((s, i) => add(src, i, supply[s], 0));
  D.forEach((d, j) => add(S.length + j, snk, demand[d], 0));
  S.forEach((s, i) =>
    D.forEach((d, j) => {
      const c = dist[s]?.[d];
      if (c !== undefined && Number.isFinite(c)) add(i, S.length + j, Infinity, c);
    }),
  );
  // Successive shortest paths with Bellman–Ford (costs are non-negative but reverse arcs aren't).
  for (let iter = 0; iter < 4 * n; iter++) {
    const dd = Array<number>(n).fill(Infinity);
    const pv = Array<number>(n).fill(-1);
    const pe = Array<number>(n).fill(-1);
    dd[src] = 0;
    for (let k = 0; k < n; k++) {
      let changed = false;
      for (let u = 0; u < n; u++) {
        if (dd[u] === Infinity) continue;
        g[u].forEach((a, ei) => {
          if (a.cap > EPS && dd[u] + a.cost < dd[a.to] - 1e-7) {
            dd[a.to] = dd[u] + a.cost;
            pv[a.to] = u;
            pe[a.to] = ei;
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (dd[snk] === Infinity) break;
    let push = Infinity;
    for (let v = snk; v !== src; v = pv[v]) push = Math.min(push, g[pv[v]][pe[v]].cap);
    for (let v = snk; v !== src; v = pv[v]) {
      const a = g[pv[v]][pe[v]];
      a.cap -= push;
      g[v][a.rev].cap += push;
    }
  }
  const flows: BallastFlow[] = [];
  let miles = 0;
  S.forEach((s, i) =>
    g[i].forEach((a) => {
      if (a.to < S.length || a.to >= S.length + D.length) return;
      const back = g[a.to][a.rev].cap; // flow on the arc
      if (back > EPS) {
        const d = D[a.to - S.length];
        const nm = dist[s][d];
        flows.push({ from: s, to: d, ships: back, nm });
        miles += back * nm;
      }
    }),
  );
  // Feasible potentials: shortest distances in the final residual graph from a virtual root joined
  // to every region node at zero cost (source and sink excluded).
  const nodes = S.length + D.length;
  const pot = Array<number>(nodes).fill(0);
  for (let k = 0; k < nodes + 1; k++) {
    let changed = false;
    for (let u = 0; u < nodes; u++)
      for (const a of g[u]) {
        if (a.to >= nodes || a.cap <= EPS) continue;
        if (pot[u] + a.cost < pot[a.to] - 1e-7) {
          pot[a.to] = pot[u] + a.cost;
          changed = true;
        }
      }
    if (!changed) break;
  }
  const min = Math.min(...pot);
  const open: Record<string, number> = {};
  const ready: Record<string, number> = {};
  S.forEach((s, i) => (open[s] = pot[i] - min));
  D.forEach((d, j) => (ready[d] = pot[S.length + j] - min));
  return { flows, miles, open, ready };
}
