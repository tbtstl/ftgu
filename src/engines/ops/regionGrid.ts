// The course region at one hour of the reference day: demand spread over the REGION nodes, and
// the standard fleet dispatched in merit order with no regard for the network (as a market with
// a single price would). Plants can be taken out, or pinned at an output, and the rest follow
// the merit order. The result plugs straight into cascade.ts.

import { STANDARD_FLEET } from '../../model/fleet';
import { REGION_LOAD_SHARE } from '../../model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import type { Generator } from '../../model/types';
import type { GridUnit } from './cascade';
import { dispatchHour, unitsFromFleet } from './dispatch';

/** The reference day's evening peak: 1,440 MW at 19:00. */
export const EVENING_PEAK = 19;

export interface RegionCaseOptions {
  /** Hour of the reference day (default the evening peak). */
  hour?: number;
  /** Demand added at particular nodes, MW. */
  extraLoad?: Record<string, number>;
  /** Plants out of service. */
  plantOutages?: string[];
  /** Outputs pinned by hand, MW; every other plant follows the merit order. */
  fixed?: Record<string, number>;
}

export interface RegionCase {
  hour: number;
  /** Demand at each node, MW. */
  loads: Record<string, number>;
  demand: number;
  /** MW from each plant in service. */
  output: Record<string, number>;
  /** Plants in service, with the most they can produce this hour. */
  units: GridUnit[];
  /** Demand the plants in service can't cover, MW. */
  shortfall: number;
  /** Running cost of the dispatch, $/h. */
  cost: number;
  /** The plant that last moved to meet demand (sets the system price). */
  marginal: string | null;
}

/** MW a plant can produce at an hour of the reference day. */
export function availableMW(g: Generator, hour: number): number {
  if (g.fuel === 'wind') return WIND_CF[hour] * g.capacity;
  if (g.fuel === 'solar') return SOLAR_CF[hour] * g.capacity;
  return g.capacity;
}

/** Demand at each REGION node, MW, for a system total. */
export function regionLoads(total: number, extra: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(Object.entries(REGION_LOAD_SHARE).map(([n, s]) => [n, s * total + Math.max(0, extra[n] ?? 0)]));
}

/** The region at one hour, dispatched in merit order. */
export function regionCase(opts: RegionCaseOptions = {}): RegionCase {
  const hour = opts.hour ?? EVENING_PEAK;
  const out = new Set(opts.plantOutages ?? []);
  const fleet = STANDARD_FLEET.filter((g) => !out.has(g.id));
  const fixed: Record<string, number> = {};
  for (const g of fleet) {
    const v = opts.fixed?.[g.id];
    if (v !== undefined) fixed[g.id] = Math.max(0, Math.min(availableMW(g, hour), v));
  }
  const loads = regionLoads(SYSTEM_DEMAND[hour], opts.extraLoad);
  const demand = Object.values(loads).reduce((s, v) => s + v, 0);
  const free = fleet.filter((g) => fixed[g.id] === undefined);
  const pinned = Object.values(fixed).reduce((s, v) => s + v, 0);
  const d = dispatchHour(unitsFromFleet(free, { wind: WIND_CF, solar: SOLAR_CF }), Math.max(0, demand - pinned), hour);
  const output: Record<string, number> = { ...d.output, ...fixed };
  const units: GridUnit[] = fleet.map((g) => ({ id: g.id, node: g.node!, capacity: availableMW(g, hour), output: output[g.id] ?? 0 }));
  const cost = fleet.reduce((s, g) => s + (output[g.id] ?? 0) * g.marginalCost, 0);
  return { hour, loads, demand, output, units, shortfall: d.shortfall, cost, marginal: d.marginal };
}
