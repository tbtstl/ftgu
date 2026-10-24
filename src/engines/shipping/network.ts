// Routing on the world's sea lanes: the shortest open path between two ports, given which
// chokepoints are closed and how deep the ship floats.

import { CHOKEPOINTS, LANES, PLACE, PLACES, laneNm, lanePoints, type Chokepoint, type Lane } from '../../model/shipping/geo';
import { RHO_FRESH, RHO_SEA } from '../../model/shipping/vessels';

export interface RouteOptions {
  /** Chokepoints that are closed. */
  closed?: Iterable<Chokepoint>;
  /** The ship's draft in sea water, m; lanes shallower than this are skipped. */
  draft?: number;
}

export interface SeaRoute {
  from: string;
  to: string;
  nm: number;
  /** Extra days spent in canal transits. */
  canalDays: number;
  lanes: Lane[];
  /** Places along the way, in order. */
  places: string[];
  chokepoints: Chokepoint[];
  /** Polyline in [lat, lon], with lanes oriented along the route. */
  points: Array<[number, number]>;
}

const LANE_NM: Record<string, number> = Object.fromEntries(LANES.map((l) => [l.id, laneNm(l)]));

export function laneLength(id: string): number {
  return LANE_NM[id];
}

function usable(l: Lane, closed: Set<Chokepoint>, draft: number | undefined): boolean {
  if (l.choke && closed.has(l.choke)) return false;
  if (draft !== undefined && l.maxDraft !== undefined) {
    // Panama's locks are fresh water: a ship floats deeper there.
    const rho = l.choke === 'panama' ? RHO_FRESH : RHO_SEA;
    if ((draft * RHO_SEA) / rho > l.maxDraft + 1e-9) return false;
  }
  return true;
}

const ADJ: Record<string, Array<{ lane: Lane; other: string }>> = {};
for (const p of PLACES) ADJ[p.id] = [];
for (const l of LANES) {
  ADJ[l.from].push({ lane: l, other: l.to });
  ADJ[l.to].push({ lane: l, other: l.from });
}

/** Shortest sea route between two places (Dijkstra), or null if every way is closed. */
export function seaRoute(from: string, to: string, opts: RouteOptions = {}): SeaRoute | null {
  const closed = new Set(opts.closed ?? []);
  const dist: Record<string, number> = {};
  const prev: Record<string, { lane: Lane; from: string } | undefined> = {};
  const done = new Set<string>();
  for (const p of PLACES) dist[p.id] = Infinity;
  dist[from] = 0;
  for (;;) {
    let u: string | null = null;
    for (const p of PLACES) if (!done.has(p.id) && dist[p.id] < Infinity && (u === null || dist[p.id] < dist[u])) u = p.id;
    if (u === null || u === to) break;
    done.add(u);
    // Ports other than the endpoints aren't through-routes (ships don't sail through a berth).
    if (u !== from && PLACE[u].port && u !== 'SIN') continue;
    for (const { lane, other } of ADJ[u]) {
      if (!usable(lane, closed, opts.draft)) continue;
      const d = dist[u] + LANE_NM[lane.id];
      if (d < dist[other] - 1e-9) {
        dist[other] = d;
        prev[other] = { lane, from: u };
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const lanes: Lane[] = [];
  const places = [to];
  let at = to;
  while (at !== from) {
    const p = prev[at]!;
    lanes.unshift(p.lane);
    places.unshift(p.from);
    at = p.from;
  }
  const points: Array<[number, number]> = [];
  lanes.forEach((l, i) => {
    const pts = lanePoints(l);
    const forward = l.from === places[i];
    const seq = forward ? pts : [...pts].reverse();
    points.push(...(i === 0 ? seq : seq.slice(1)));
  });
  const chokepoints = [...new Set(lanes.map((l) => l.choke).filter((c): c is Chokepoint => !!c))];
  return { from, to, nm: dist[to], canalDays: lanes.reduce((s, l) => s + (l.canalDays ?? 0), 0), lanes, places, chokepoints, points };
}

/** Sea distance between two places, nautical miles (Infinity if unreachable). */
export function seaDistance(from: string, to: string, opts: RouteOptions = {}): number {
  if (from === to) return 0;
  return seaRoute(from, to, opts)?.nm ?? Infinity;
}

/** A distance matrix between ports, memoized by options. */
const MATRIX_CACHE = new Map<string, Record<string, Record<string, number>>>();

export function distanceMatrix(ports: string[], opts: RouteOptions = {}): Record<string, Record<string, number>> {
  const key = [ports.join(','), [...(opts.closed ?? [])].sort().join(','), opts.draft ?? ''].join('|');
  const hit = MATRIX_CACHE.get(key);
  if (hit) return hit;
  const m: Record<string, Record<string, number>> = {};
  for (const a of ports) {
    m[a] = {};
    for (const b of ports) m[a][b] = a === b ? 0 : seaDistance(a, b, opts);
  }
  MATRIX_CACHE.set(key, m);
  return m;
}

export function chokepointName(c: Chokepoint): string {
  return CHOKEPOINTS[c].name;
}
