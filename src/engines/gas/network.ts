// Moving gas across a network of pipelines.
//
// With compressors at every station, operators can push gas along whichever pipelines have room,
// so a gas network behaves like a transportation problem: supplies at some nodes, demands at
// others, pipelines with capacities and a cost per unit moved. `solveFlow` finds the flows that
// serve the most valuable demand at the least cost (a min-cost flow, by successive shortest
// paths), and the shortest-path distances it leaves behind are the network's locational prices:
// what one more unit of demand at each node would cost to serve.
//
// Quantities can be in any unit (the course uses Bcf/d) and costs in $/MMBtu; prices come out in
// $/MMBtu. Pipes are directional; a pipe that can flow both ways is two arcs.

import { CORRIDORS, PIPELINE, PIPE_ROUGHNESS_IN } from '../../model/gas/world';
import { lineCapacity, stationLine, type StationLine } from './compression';
import { pipeFlow, type Pipe } from './hydraulics';
import { psia } from './properties';

export interface FlowArc {
  id: string;
  from: string;
  to: string;
  /** Capacity, quantity per day. */
  cap: number;
  /** Variable cost per unit moved, $/MMBtu. */
  cost: number;
}

/** A block of supply at a node: up to `cap` at `cost` $/MMBtu. */
export interface SupplyStep {
  id?: string;
  node: string;
  cap: number;
  cost: number;
}

/** A block of demand at a node: up to `cap`, worth `value` $/MMBtu to whoever burns it. */
export interface DemandStep {
  id?: string;
  node: string;
  cap: number;
  value: number;
}

export interface FlowProblem {
  nodes: string[];
  arcs: FlowArc[];
  supplies: SupplyStep[];
  demands: DemandStep[];
}

export interface FlowSolution {
  /** Flow on each arc. */
  flow: Record<string, number>;
  /** Amount taken from each supply step and served to each demand step, in input order. */
  supplied: number[];
  served: number[];
  /** Locational price at each node, $/MMBtu: the cost of serving one more unit there. */
  prices: Record<string, number>;
  /** Demand left unserved at each node. */
  unserved: Record<string, number>;
  /** Total value of demand served minus supply and transport cost, $/MMBtu × quantity. */
  welfare: number;
}

interface Edge {
  to: number;
  cap: number;
  cost: number;
  rev: number;
  /** Which input this edge is: 'a' arc, 's' supply, 'd' demand; and its index. */
  kind: 'a' | 's' | 'd' | 'r';
  index: number;
}

const EPS = 1e-9;

/** Min-cost flow by successive shortest paths; prices from shortest paths in the final residual graph. */
export function solveFlow(p: FlowProblem, opts: { fast?: boolean } = {}): FlowSolution {
  const idx = new Map(p.nodes.map((n, i) => [n, i]));
  const N = p.nodes.length;
  const S = N;
  const T = N + 1;
  const g: Edge[][] = Array.from({ length: N + 2 }, () => []);
  const add = (u: number, v: number, cap: number, cost: number, kind: Edge['kind'], index: number) => {
    g[u].push({ to: v, cap, cost, rev: g[v].length, kind, index });
    g[v].push({ to: u, cap: 0, cost: -cost, rev: g[u].length - 1, kind: 'r', index: -1 });
  };
  p.arcs.forEach((a, i) => {
    const u = idx.get(a.from);
    const v = idx.get(a.to);
    if (u === undefined || v === undefined || a.cap <= 0) return;
    add(u, v, a.cap, a.cost, 'a', i);
  });
  p.supplies.forEach((s, i) => {
    const u = idx.get(s.node);
    if (u !== undefined && s.cap > 0) add(S, u, s.cap, s.cost, 's', i);
  });
  p.demands.forEach((d, i) => {
    const v = idx.get(d.node);
    if (v !== undefined && d.cap > 0) add(v, T, d.cap, -d.value, 'd', i);
  });

  // Successive shortest paths. Each path is found with a queue-based Bellman–Ford (SPFA): only
  // nodes whose distance just improved are re-examined. The residual graph never has a negative
  // cycle, so this terminates; the visit cap is a guard against floating-point loops.
  const V = N + 2;
  const dist = new Float64Array(V);
  const prevNode = new Int32Array(V);
  const prevEdge = new Int32Array(V);
  const inQueue = new Uint8Array(V);
  const queue = new Int32Array(V + 1);
  for (let iter = 0; iter < 10_000; iter++) {
    dist.fill(Infinity);
    prevNode.fill(-1);
    prevEdge.fill(-1);
    inQueue.fill(0);
    dist[S] = 0;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail] = S;
    tail = (tail + 1) % queue.length;
    size++;
    inQueue[S] = 1;
    let visits = 0;
    if (!opts.fast) {
      // Plain Bellman–Ford passes. Slower, but its tie-breaking is what the course's earlier
      // lessons were checked against, so it stays the default.
      for (let k = 0; k < V; k++) {
        let changed = false;
        for (let u = 0; u < V; u++) {
          if (dist[u] === Infinity) continue;
          const edges = g[u];
          for (let j = 0; j < edges.length; j++) {
            const e = edges[j];
            if (e.cap > EPS && dist[u] + e.cost < dist[e.to] - 1e-12) {
              dist[e.to] = dist[u] + e.cost;
              prevNode[e.to] = u;
              prevEdge[e.to] = j;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      size = 0;
    }
    while (size > 0 && visits < 50 * V * V) {
      const u = queue[head];
      head = (head + 1) % queue.length;
      size--;
      inQueue[u] = 0;
      visits++;
      const du = dist[u];
      const edges = g[u];
      for (let j = 0; j < edges.length; j++) {
        const e = edges[j];
        if (e.cap > EPS && du + e.cost < dist[e.to] - 1e-12) {
          dist[e.to] = du + e.cost;
          prevNode[e.to] = u;
          prevEdge[e.to] = j;
          if (!inQueue[e.to]) {
            queue[tail] = e.to;
            tail = (tail + 1) % queue.length;
            size++;
            inQueue[e.to] = 1;
          }
        }
      }
    }
    if (dist[T] >= -1e-12 || dist[T] === Infinity) break;
    let push = Infinity;
    for (let v = T; v !== S; v = prevNode[v]) push = Math.min(push, g[prevNode[v]][prevEdge[v]].cap);
    for (let v = T; v !== S; v = prevNode[v]) {
      const e = g[prevNode[v]][prevEdge[v]];
      e.cap -= push;
      g[v][e.rev].cap += push;
    }
  }

  // Read the solution off the residual graph.
  const flow: Record<string, number> = Object.fromEntries(p.arcs.map((a) => [a.id, 0]));
  const supplied = p.supplies.map(() => 0);
  const served = p.demands.map(() => 0);
  for (let u = 0; u < V; u++)
    for (const e of g[u]) {
      if (e.kind === 'r') continue;
      const used = g[e.to][e.rev].cap;
      if (e.kind === 'a') flow[p.arcs[e.index].id] = used;
      else if (e.kind === 's') supplied[e.index] = used;
      else served[e.index] = used;
    }

  // Prices: merge source and sink into one outside node O and take shortest distances from it.
  // Arcs into the sink become arcs back to O; arcs out of the source start at O.
  const O = N;
  const h: Array<Array<{ to: number; cost: number }>> = Array.from({ length: N + 1 }, () => []);
  for (let u = 0; u < V; u++)
    for (const e of g[u]) {
      if (e.cap <= EPS) continue;
      const a = u === T || u === S ? O : u;
      const b = e.to === T || e.to === S ? O : e.to;
      if (a === b) continue;
      h[a].push({ to: b, cost: e.cost });
    }
  const pdist = Array<number>(N + 1).fill(Infinity);
  pdist[O] = 0;
  for (let k = 0; k <= N; k++) {
    let changed = false;
    for (let u = 0; u <= N; u++) {
      if (pdist[u] === Infinity) continue;
      for (const e of h[u])
        if (pdist[u] + e.cost < pdist[e.to] - 1e-12) {
          pdist[e.to] = pdist[u] + e.cost;
          changed = true;
        }
    }
    if (!changed) break;
  }
  const prices: Record<string, number> = Object.fromEntries(p.nodes.map((n, i) => [n, pdist[i]]));

  const unserved: Record<string, number> = Object.fromEntries(p.nodes.map((n) => [n, 0]));
  p.demands.forEach((d, i) => (unserved[d.node] += d.cap - served[i]));
  let welfare = 0;
  p.demands.forEach((d, i) => (welfare += d.value * served[i]));
  p.supplies.forEach((s, i) => (welfare -= s.cost * supplied[i]));
  p.arcs.forEach((a) => (welfare -= a.cost * flow[a.id]));
  return { flow, supplied, served, prices, unserved, welfare };
}

/** Total flow into a node minus flow out of it along the arcs. */
export function netInflow(p: FlowProblem, s: FlowSolution, node: string): number {
  let x = 0;
  for (const a of p.arcs) {
    if (a.to === node) x += s.flow[a.id] ?? 0;
    if (a.from === node) x -= s.flow[a.id] ?? 0;
  }
  return x;
}

// ---------------------------------------------------------------------------
// Building pipelines.

/** Illustrative capital costs: pipe laid per inch of diameter per mile, and installed compression per horsepower. */
export const PIPE_COST_PER_INCH_MILE = 150_000;
export const COMPRESSION_COST_PER_HP = 3_000;

/** Capital cost of a pipeline of a given nominal size and length, with stations totaling `hp` horsepower, $. */
export function pipelineCost(sizeIn: number, lengthMi: number, hp: number): number {
  return sizeIn * lengthMi * PIPE_COST_PER_INCH_MILE + hp * COMPRESSION_COST_PER_HP;
}

/**
 * K in P1² − P2² = K·Q² for a pipe (Q in MMcf/d), measured from the hydraulics engine at a
 * reference flow; used to combine pipes in parallel and in series.
 */
export function resistance(pipe: Pipe, p1 = 1454.7, p2 = 900): number {
  const q = pipeFlow(pipe, p1, p2).qMMcfd;
  return (p1 * p1 - p2 * p2) / (q * q);
}

/**
 * Flow (MMcf/d) through a pipe whose first `loopFraction` of length has a second pipe of
 * `loopDiameterIn` laid beside it ("looping"), between the same end pressures. Pipes in parallel
 * share the pressure drop: 1/√K adds up. Pipes in series add K.
 */
export function loopedFlow(pipe: Pipe, loopDiameterIn: number, loopFraction: number, p1: number, p2: number): { total: number; inLoop: number; inMain: number } {
  if (!(p1 > p2)) return { total: 0, inLoop: 0, inMain: 0 };
  const kMain = resistance(pipe, p1, p2);
  const kLoopPipe = loopDiameterIn > 0 ? resistance({ ...pipe, diameterIn: loopDiameterIn }, p1, p2) : Infinity;
  const kParallel = 1 / (1 / Math.sqrt(kMain) + (Number.isFinite(kLoopPipe) ? 1 / Math.sqrt(kLoopPipe) : 0)) ** 2;
  const k = kMain * (1 - loopFraction) + kParallel * loopFraction;
  const total = Math.sqrt((p1 * p1 - p2 * p2) / k);
  // In the looped stretch the flow splits in proportion to 1/√K.
  const shareLoop = Number.isFinite(kLoopPipe) ? 1 / Math.sqrt(kLoopPipe) / (1 / Math.sqrt(kMain) + 1 / Math.sqrt(kLoopPipe)) : 0;
  return { total, inLoop: loopFraction > 0 ? total * shareLoop : 0, inMain: loopFraction > 0 ? total * (1 - shareLoop) : total };
}

/**
 * The binding arcs: pipelines that are full and whose ends have separated in price by more than the
 * cost of moving gas between them. These are the constraints that limit delivery — a fuller pipe
 * with prices still one transport cost apart isn't holding anything back.
 */
export function bindingArcs(p: FlowProblem, s: FlowSolution): string[] {
  return p.arcs
    .filter((a) => (s.flow[a.id] ?? 0) >= a.cap - 1e-9 && (s.prices[a.to] ?? 0) - (s.prices[a.from] ?? 0) - a.cost > 1e-6)
    .map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Designing a corridor.

/** Inside diameter (inches) of each standard line-pipe size. */
export const INSIDE_DIAMETER: Record<number, number> = { 20: 19.25, 24: 23.25, 30: 29.25, 36: 35, 42: 41 };
export const PIPE_SIZES = [20, 24, 30, 36, 42];
/** Design basis for new corridors: MAOP and the delivery pressure promised, psig. */
export const NEW_LINE_MAOP_PSIG = 1440;
export const NEW_LINE_MIN_DELIVERY_PSIG = 800;

export interface CorridorDesign {
  /** Capacity the line can sell, Bcf/d: its hydraulic limit rounded down to 0.05 (or the built line's certificated figure). */
  capacityBcfd: number;
  /** Compression needed to run at that capacity, hp. */
  hp: number;
  /** Capital cost, $. */
  cost: number;
}

/**
 * A pipeline of `sizeIn` inches with `stations` compressor stations along a corridor. Corridors with
 * a built line keep that line's pressures; new corridors use the design basis above. The region's
 * own six lines, at their own size and station count, get exactly their certificated capacity.
 */
export function corridorDesign(corridorId: string, sizeIn: number, stations: number): CorridorDesign {
  const corridor = CORRIDORS.find((c) => c.id === corridorId);
  if (!corridor || !sizeIn || stations < 1) return { capacityBcfd: 0, hp: 0, cost: 0 };
  const built = PIPELINE[corridorId];
  const maop = built?.maopPsig ?? NEW_LINE_MAOP_PSIG;
  const minDel = built?.minDeliveryPsig ?? NEW_LINE_MIN_DELIVERY_PSIG;
  const line: StationLine = {
    pipe: { diameterIn: INSIDE_DIAMETER[sizeIn] ?? sizeIn - 1, lengthMi: corridor.lengthMi, roughnessIn: PIPE_ROUGHNESS_IN },
    stations,
    receiptPsia: psia(minDel),
    maopPsia: psia(maop),
  };
  const hydraulic = lineCapacity(line, psia(minDel)) / 1000;
  const same = !!built && built.sizeIn === sizeIn && built.stations === stations;
  const capacityBcfd = same ? built.capacityBcfd : Math.floor(hydraulic / 0.05 + 1e-9) * 0.05;
  const hp = capacityBcfd > 0 ? stationLine(line, capacityBcfd * 1000).totalHp : 0;
  return { capacityBcfd, hp, cost: pipelineCost(sizeIn, corridor.lengthMi, hp) };
}
