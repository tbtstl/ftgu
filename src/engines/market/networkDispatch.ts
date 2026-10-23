// Checking and visualizing dispatch on a network: flows and overloads for a hand-made dispatch,
// post-contingency (N-1) flows, and two-dimensional slices of the dispatch problem, where the
// feasible region is a polygon and the cheapest point sits at one of its corners.

import type { Generator, Network } from '../../model/types';
import { computePtdf, dcPowerFlow, findIslands } from '../physics/powerflow';
import type { OpfGenerator } from './opf';

// ---------------------------------------------------------------------------
// Building a dispatch problem from the shared model.

export interface FleetOptions {
  /** Wind capacity factor, 0–1 (share of nameplate available). */
  windCF?: number;
  /** Solar capacity factor, 0–1. */
  solarCF?: number;
  /** Keep must-run floors (minOutput). Default true. */
  mustRun?: boolean;
  /** Override offers, $/MWh, by generator id. */
  offers?: Record<string, number>;
  /** Generators on forced outage (left out). */
  out?: string[];
}

/** OPF generators for a fleet at one hour's weather. Offers default to marginal cost. */
export function fleetOffers(fleet: Generator[], opts: FleetOptions = {}): OpfGenerator[] {
  const out = new Set(opts.out ?? []);
  return fleet
    .filter((g) => g.node && !out.has(g.id))
    .map((g) => {
      const cf = g.fuel === 'wind' ? (opts.windCF ?? 1) : g.fuel === 'solar' ? (opts.solarCF ?? 1) : 1;
      const capacity = g.capacity * cf;
      return {
        id: g.id,
        node: g.node!,
        capacity,
        minOutput: opts.mustRun === false ? 0 : Math.min(g.minOutput, capacity),
        offer: opts.offers?.[g.id] ?? g.marginalCost,
      };
    });
}

/** Demand at each node: a system total split by each node's share. */
export function nodalLoads(total: number, share: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(share).map(([n, s]) => [n, s * total]));
}

/** Net injection (generation − demand) at each node, MW. */
export function injections(net: Network, gens: OpfGenerator[], dispatch: Record<string, number>, loads: Record<string, number>): Record<string, number> {
  const inj: Record<string, number> = {};
  for (const n of net.nodes) inj[n.id] = -(loads[n.id] ?? 0);
  for (const g of gens) inj[g.node] = (inj[g.node] ?? 0) + (dispatch[g.id] ?? 0);
  return inj;
}

/** Total offer cost of a dispatch, $/h. */
export function dispatchCost(gens: OpfGenerator[], dispatch: Record<string, number>): number {
  return gens.reduce((s, g) => s + g.offer * (dispatch[g.id] ?? 0), 0);
}

/** The merit order ignoring the network: floors first, then cheapest offers up to demand. */
export function meritOrderDispatch(gens: OpfGenerator[], demand: number): Record<string, number> {
  const out: Record<string, number> = {};
  let rem = demand;
  for (const g of gens) {
    out[g.id] = g.minOutput ?? 0;
    rem -= out[g.id];
  }
  for (const g of [...gens].sort((a, b) => a.offer - b.offer)) {
    const add = Math.max(0, Math.min(g.capacity - out[g.id], rem));
    out[g.id] += add;
    rem -= add;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flows and overloads.

export interface LineLoading {
  id: string;
  /** MW, positive from → to. */
  flow: number;
  /** The limit that applies in this case, MW. */
  limit: number;
  /** |flow| / limit. */
  loading: number;
  over: boolean;
}

export interface DispatchCheck {
  flows: Record<string, number>;
  lines: LineLoading[];
  overloads: LineLoading[];
  /** The most heavily loaded line in service. */
  worst: LineLoading | null;
  cost: number;
  /** Generation − demand, MW (0 for a balanced dispatch). */
  imbalance: number;
}

interface CheckOptions {
  /** Lines out of service. */
  outages?: string[];
  /** Override normal limits, MW. */
  limits?: Record<string, number>;
  /** Multiply every limit (e.g. an emergency rating of 1.1). */
  rating?: number;
}

function loadings(net: Network, flows: Record<string, number>, outages: string[], limitOf: (id: string) => number): LineLoading[] {
  return net.lines
    .filter((l) => !outages.includes(l.id))
    .map((l) => {
      const limit = limitOf(l.id);
      const loading = limit > 0 ? Math.abs(flows[l.id]) / limit : Math.abs(flows[l.id]) > 1e-6 ? Infinity : 0;
      return { id: l.id, flow: flows[l.id], limit, loading, over: Math.abs(flows[l.id]) > limit + 1e-6 };
    });
}

function worstOf(lines: LineLoading[]): LineLoading | null {
  return lines.reduce<LineLoading | null>((w, l) => (!w || l.loading > w.loading ? l : w), null);
}

/** Flows, loadings and cost of a given (possibly hand-made) dispatch. */
export function checkDispatch(
  net: Network,
  gens: OpfGenerator[],
  dispatch: Record<string, number>,
  loads: Record<string, number>,
  opts: CheckOptions = {},
): DispatchCheck {
  const outages = opts.outages ?? [];
  const inj = injections(net, gens, dispatch, loads);
  const { flows } = dcPowerFlow(net, inj, outages);
  const limitOf = (id: string) => (opts.limits?.[id] ?? net.lines.find((l) => l.id === id)!.limit) * (opts.rating ?? 1);
  const lines = loadings(net, flows, outages, limitOf);
  return {
    flows,
    lines,
    overloads: lines.filter((l) => l.over),
    worst: worstOf(lines),
    cost: dispatchCost(gens, dispatch),
    imbalance: Object.values(inj).reduce((s, v) => s + v, 0),
  };
}

export interface ContingencyCase {
  /** The line that trips. */
  outage: string;
  /** True if losing the line would split the grid (not assessed). */
  islanding: boolean;
  flows: Record<string, number>;
  lines: LineLoading[];
  overloads: LineLoading[];
  worst: LineLoading | null;
}

/**
 * Preventive N-1 check: flows right after each listed line trips, before anyone redispatches.
 * Post-contingency limits are the normal limits times `emergencyRating`.
 */
export function contingencyScan(
  net: Network,
  gens: OpfGenerator[],
  dispatch: Record<string, number>,
  loads: Record<string, number>,
  contingencies: string[],
  opts: { emergencyRating?: number; limits?: Record<string, number>; outages?: string[] } = {},
): ContingencyCase[] {
  const base = opts.outages ?? [];
  const inj = injections(net, gens, dispatch, loads);
  const nIslands = findIslands(net, base).length;
  const limitOf = (id: string) => (opts.limits?.[id] ?? net.lines.find((l) => l.id === id)!.limit) * (opts.emergencyRating ?? 1);
  return contingencies
    .filter((k) => !base.includes(k))
    .map((k) => {
      const outs = [...base, k];
      if (findIslands(net, outs).length > nIslands) {
        return { outage: k, islanding: true, flows: {}, lines: [], overloads: [], worst: null };
      }
      const { flows } = dcPowerFlow(net, inj, outs);
      const lines = loadings(net, flows, outs, limitOf);
      return { outage: k, islanding: false, flows, lines, overloads: lines.filter((l) => l.over), worst: worstOf(lines) };
    });
}

// ---------------------------------------------------------------------------
// Two-dimensional slices: the geometry behind linear programming.

/** The half-plane a·x + b·y ≤ c. */
export interface HalfPlane {
  a: number;
  b: number;
  c: number;
  /** Which constraint it is, e.g. "west-city:max" or "balance:min". */
  id: string;
}

export type Pt = [number, number];

/** [xMin, xMax, yMin, yMax] */
export type Box = [number, number, number, number];

/** Clip a convex polygon by one half-plane (Sutherland–Hodgman). */
function clip(poly: Pt[], h: HalfPlane): Pt[] {
  const out: Pt[] = [];
  const val = (p: Pt) => h.a * p[0] + h.b * p[1] - h.c;
  const tol = 1e-9 * (1 + Math.abs(h.c));
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const vp = val(p);
    const vq = val(q);
    if (vp <= tol) out.push(p);
    if ((vp <= tol && vq > tol) || (vp > tol && vq <= tol)) {
      const t = vp / (vp - vq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  // Drop near-duplicate vertices.
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return out.length < 2 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7;
  });
}

/** The part of a box that satisfies every half-plane, as a polygon (counterclockwise). Empty if none. */
export function feasiblePolygon(box: Box, constraints: HalfPlane[]): Pt[] {
  let poly: Pt[] = [
    [box[0], box[2]],
    [box[1], box[2]],
    [box[1], box[3]],
    [box[0], box[3]],
  ];
  for (const h of constraints) {
    poly = clip(poly, h);
    if (poly.length < 3) return [];
  }
  return poly;
}

/** The segment of a half-plane's boundary line that lies inside the box, for drawing. */
export function boundarySegment(h: HalfPlane, box: Box): [Pt, Pt] | null {
  const pts: Pt[] = [];
  const [x0, x1, y0, y1] = box;
  if (Math.abs(h.b) > 1e-12) {
    for (const x of [x0, x1]) {
      const y = (h.c - h.a * x) / h.b;
      if (y >= y0 - 1e-9 && y <= y1 + 1e-9) pts.push([x, y]);
    }
  }
  if (Math.abs(h.a) > 1e-12) {
    for (const y of [y0, y1]) {
      const x = (h.c - h.b * y) / h.a;
      if (x >= x0 - 1e-9 && x <= x1 + 1e-9) pts.push([x, y]);
    }
  }
  const uniq = pts.filter((p, i) => pts.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) === i);
  return uniq.length >= 2 ? [uniq[0], uniq[1]] : null;
}

/** True if the point satisfies every half-plane (with a small tolerance). */
export function satisfies(p: Pt, constraints: HalfPlane[], tol = 1e-6): boolean {
  return constraints.every((h) => h.a * p[0] + h.b * p[1] <= h.c + tol * (1 + Math.abs(h.c)));
}

/** Half-planes that a point violates. */
export function violated(p: Pt, constraints: HalfPlane[], tol = 1e-6): HalfPlane[] {
  return constraints.filter((h) => h.a * p[0] + h.b * p[1] > h.c + tol * (1 + Math.abs(h.c)));
}

/**
 * The simplex method's idea in two dimensions: start at a corner of the feasible polygon and
 * keep stepping to a neighboring corner that is cheaper, until neither neighbor is. For a linear
 * cost on a convex polygon, the corner where the walk stops is the cheapest point of the polygon.
 */
export function vertexWalk(poly: Pt[], cost: (p: Pt) => number, start: number): Pt[] {
  if (!poly.length) return [];
  let i = ((start % poly.length) + poly.length) % poly.length;
  const path: Pt[] = [poly[i]];
  for (let step = 0; step < poly.length; step++) {
    const prev = (i - 1 + poly.length) % poly.length;
    const next = (i + 1) % poly.length;
    const here = cost(poly[i]);
    const best = cost(poly[prev]) < cost(poly[next]) ? prev : next;
    if (cost(poly[best]) >= here - 1e-9) break;
    i = best;
    path.push(poly[i]);
  }
  return path;
}

/** Index of the polygon corner nearest a point. */
export function nearestVertex(poly: Pt[], p: Pt): number {
  let best = 0;
  poly.forEach((q, i) => {
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(poly[best][0] - p[0], poly[best][1] - p[1])) best = i;
  });
  return best;
}

export interface DispatchPlane {
  /** Ranges of the two varied generators. */
  box: Box;
  /** Line limits (both directions) and the balancing generator's bounds, as half-planes in (x, y). */
  constraints: HalfPlane[];
  /** Cost = c0 + cx·x + cy·y, $/h. */
  cost: { c0: number; cx: number; cy: number };
  /** Flow on each line = f0 + fx·x + fy·y. */
  flow: Record<string, { f0: number; fx: number; fy: number }>;
  /** The balancing generator's output = b0 − x − y. */
  balance: { b0: number };
}

/**
 * A two-dimensional slice of network dispatch: generators `xGen` and `yGen` vary, `balanceGen`
 * makes up whatever is left so supply equals demand, and every other generator stays at `fixed`.
 * Because DC power flow is linear, every line limit becomes a straight edge in this plane.
 */
export function dispatchPlane(
  net: Network,
  gens: OpfGenerator[],
  loads: Record<string, number>,
  fixed: Record<string, number>,
  xGen: string,
  yGen: string,
  balanceGen: string,
  opts: { outages?: string[]; limits?: Record<string, number> } = {},
): DispatchPlane {
  const outages = opts.outages ?? [];
  const { ptdf } = computePtdf(net, outages);
  const g = (id: string) => gens.find((x) => x.id === id)!;
  const gx = g(xGen);
  const gy = g(yGen);
  const gb = g(balanceGen);
  const totalLoad = Object.values(loads).reduce((s, v) => s + v, 0);
  const others = gens.filter((x) => x.id !== xGen && x.id !== yGen && x.id !== balanceGen);
  const b0 = totalLoad - others.reduce((s, x) => s + (fixed[x.id] ?? 0), 0);

  // Base injections with x = y = 0 and the balancing generator at b0.
  const d0: Record<string, number> = { ...fixed, [xGen]: 0, [yGen]: 0, [balanceGen]: b0 };
  const inj0 = injections(net, gens, d0, loads);
  const flow: DispatchPlane['flow'] = {};
  const constraints: HalfPlane[] = [];
  for (const l of net.lines) {
    if (outages.includes(l.id)) continue;
    const p = ptdf[l.id];
    const f0 = net.nodes.reduce((s, n) => s + p[n.id] * inj0[n.id], 0);
    const fx = p[gx.node] - p[gb.node];
    const fy = p[gy.node] - p[gb.node];
    flow[l.id] = { f0, fx, fy };
    const lim = opts.limits?.[l.id] ?? l.limit;
    if (Math.abs(fx) < 1e-12 && Math.abs(fy) < 1e-12) continue;
    constraints.push({ a: fx, b: fy, c: lim - f0, id: `${l.id}:max` });
    constraints.push({ a: -fx, b: -fy, c: lim + f0, id: `${l.id}:min` });
  }
  // Balancing generator between its floor and its capacity: floor ≤ b0 − x − y ≤ capacity.
  constraints.push({ a: 1, b: 1, c: b0 - (gb.minOutput ?? 0), id: 'balance:min' });
  constraints.push({ a: -1, b: -1, c: gb.capacity - b0, id: 'balance:max' });

  const c0 = others.reduce((s, x) => s + x.offer * (fixed[x.id] ?? 0), 0) + gb.offer * b0;
  return {
    box: [gx.minOutput ?? 0, gx.capacity, gy.minOutput ?? 0, gy.capacity],
    constraints,
    cost: { c0, cx: gx.offer - gb.offer, cy: gy.offer - gb.offer },
    flow,
    balance: { b0 },
  };
}
