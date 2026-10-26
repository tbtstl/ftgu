// Positioning: which open ship should sail empty to which cargo. A ship's ballast voyage costs fuel
// and days; it is useless if she arrives after the cargo's loading window closes. With a handful of
// ships and cargoes, trying every assignment finds the cheapest.

import type { VesselClass } from '../../model/shipping/vessels';
import { seaDistance } from './network';
import { ballastDraft, fuelPerDay } from './voyage';

export interface OpenShip {
  id: string;
  name: string;
  /** Port or waypoint where she becomes free. */
  at: string;
  /** Day she becomes free. */
  openDay: number;
}

export interface CargoNeed {
  id: string;
  /** Loading port. */
  port: string;
  /** Loading window (laycan): first and last day the ship may arrive. */
  from: number;
  to: number;
  label: string;
}

export interface Positioning {
  nm: number;
  days: number;
  arrive: number;
  /** Arrives in time for the window. */
  ok: boolean;
  /** Days spent waiting at the port for the window to open. */
  early: number;
  fuel: number;
  /** Fuel plus the ship's time (ballast days plus waiting) at `dayValue`, $. */
  cost: number;
}

export interface PositionOptions {
  speed: number;
  bunker: number;
  /** What a day of the ship's time is worth, $ (her operating cost, or what she could earn elsewhere). */
  dayValue: number;
}

export function position(v: VesselClass, ship: OpenShip, cargo: CargoNeed, o: PositionOptions): Positioning {
  const nm = seaDistance(ship.at, cargo.port, { draft: ballastDraft(v) });
  const days = nm / (24 * o.speed);
  const arrive = ship.openDay + days;
  const early = Math.max(0, cargo.from - arrive);
  const fuel = fuelPerDay(v, o.speed, ballastDraft(v)) * days;
  return { nm, days, arrive, ok: arrive <= cargo.to + 1e-9, early, fuel, cost: fuel * o.bunker + (days + early) * o.dayValue };
}

export interface Assignment {
  /** cargo id → ship id (or null if unfilled). */
  pairs: Record<string, string | null>;
  cost: number;
  filled: number;
}

/** Cost of an assignment; cargoes left unfilled (or filled late) cost `missPenalty` each. */
export function assignmentCost(v: VesselClass, ships: OpenShip[], cargoes: CargoNeed[], pairs: Record<string, string | null>, o: PositionOptions, missPenalty: number): { cost: number; filled: number } {
  let cost = 0;
  let filled = 0;
  for (const c of cargoes) {
    const sid = pairs[c.id];
    const s = ships.find((x) => x.id === sid);
    if (!s) {
      cost += missPenalty;
      continue;
    }
    const p = position(v, s, c, o);
    if (!p.ok) cost += missPenalty;
    else {
      cost += p.cost;
      filled += 1;
    }
  }
  return { cost, filled };
}

/** The cheapest assignment, filling as many cargoes as possible first (brute force; ≤ 8 ships). */
export function bestAssignment(v: VesselClass, ships: OpenShip[], cargoes: CargoNeed[], o: PositionOptions, missPenalty = 1e9): Assignment {
  let best: Assignment = { pairs: Object.fromEntries(cargoes.map((c) => [c.id, null])), cost: Infinity, filled: 0 };
  const used = new Set<string>();
  const pairs: Record<string, string | null> = {};
  const go = (i: number) => {
    if (i === cargoes.length) {
      const r = assignmentCost(v, ships, cargoes, pairs, o, missPenalty);
      if (r.cost < best.cost) best = { pairs: { ...pairs }, cost: r.cost, filled: r.filled };
      return;
    }
    const c = cargoes[i];
    pairs[c.id] = null;
    go(i + 1);
    for (const s of ships) {
      if (used.has(s.id)) continue;
      used.add(s.id);
      pairs[c.id] = s.id;
      go(i + 1);
      used.delete(s.id);
    }
    pairs[c.id] = null;
  };
  go(0);
  return best;
}
