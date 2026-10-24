// Moving the valley's corn: a network from the districts' fields through country elevators and the
// river terminal to the ethanol plants, the feedyards, and two export ports — Westhaven by rail and
// Port Sable by barge. A linear program routes a year's crop for the most value at its outlets,
// within each route's capacity. What a bushel is worth at each origin — its location value — is how
// much the network's value rises with one more bushel there; what a route's capacity is worth is how
// much it rises with one more bushel of room.

import { solveLP } from '../market/lp';
import type { DistrictId } from '../../model/agriculture/region';

export type Hub = 'halsted' | 'dunmore' | 'fairview' | 'ashby' | 'landing';
export type NodeId = DistrictId | Hub | 'bluestem' | 'feedyards' | 'westhaven' | 'sable' | 'stored';
export type Mode = 'truck' | 'rail' | 'barge' | 'hold';

export interface Arc {
  id: string;
  from: NodeId;
  to: NodeId;
  mode: Mode;
  /** Freight, $ per bushel. */
  cost: number;
  /** Arcs sharing a capacity. */
  group?: 'rail' | 'river';
}

export interface NetworkSettings {
  /** Corn production by district, million bushels. */
  supply: Record<DistrictId, number>;
  /** Free-on-board export prices at the two ports, $ per bushel. */
  westhaven: number;
  sable: number;
  /** Barge freight from Crane Landing to Port Sable, $ per bushel. */
  barge: number;
  /** What the rail line west and the river can carry in a year, million bushels. */
  railCapacity: number;
  riverCapacity: number;
  /** The valley's own use in a year, million bushels: the ethanol plants around Bluestem and the High Plains feedyards. */
  ethanol: number;
  feed: number;
  /** What a bushel that can't move this year is worth at an elevator, $: next year's price less a year of holding it. */
  holdValue: number;
}

export const DEFAULT_NETWORK: Omit<NetworkSettings, 'supply'> = {
  westhaven: 5.95,
  sable: 5.6,
  barge: 0.45,
  railCapacity: 170,
  riverCapacity: 180,
  ethanol: 96,
  feed: 120,
  holdValue: 4.0,
};

export const HUBS: Hub[] = ['halsted', 'dunmore', 'fairview', 'ashby', 'landing'];
export const ORIGINS: DistrictId[] = ['north', 'plains', 'prairie', 'ridge', 'bottoms'];

/** Rail freight from each station to Westhaven, $ per bushel. */
export const RAIL_RATE: Partial<Record<Hub, number>> = { dunmore: 1.05, fairview: 1.2, halsted: 1.25, ashby: 1.32 };

/** The network's arcs at a barge rate. */
export function arcs(barge: number): Arc[] {
  return [
    // Trucks from farms to the elevators and the river terminal.
    { id: 'north-halsted', from: 'north', to: 'halsted', mode: 'truck', cost: 0.1 },
    { id: 'plains-dunmore', from: 'plains', to: 'dunmore', mode: 'truck', cost: 0.1 },
    { id: 'prairie-fairview', from: 'prairie', to: 'fairview', mode: 'truck', cost: 0.1 },
    { id: 'prairie-landing', from: 'prairie', to: 'landing', mode: 'truck', cost: 0.24 },
    { id: 'ridge-ashby', from: 'ridge', to: 'ashby', mode: 'truck', cost: 0.1 },
    { id: 'ridge-landing', from: 'ridge', to: 'landing', mode: 'truck', cost: 0.2 },
    { id: 'bottoms-landing', from: 'bottoms', to: 'landing', mode: 'truck', cost: 0.08 },
    // Trucks to the valley's users.
    { id: 'fairview-bluestem', from: 'fairview', to: 'bluestem', mode: 'truck', cost: 0.06 },
    { id: 'landing-bluestem', from: 'landing', to: 'bluestem', mode: 'truck', cost: 0.16 },
    { id: 'dunmore-feedyards', from: 'dunmore', to: 'feedyards', mode: 'truck', cost: 0.08 },
    { id: 'fairview-feedyards', from: 'fairview', to: 'feedyards', mode: 'truck', cost: 0.26 },
    { id: 'halsted-feedyards', from: 'halsted', to: 'feedyards', mode: 'truck', cost: 0.34 },
    // Shuttle trains west.
    ...(Object.entries(RAIL_RATE) as Array<[Hub, number]>).map(([h, cost]) => ({ id: `${h}-westhaven`, from: h, to: 'westhaven' as NodeId, mode: 'rail' as Mode, cost, group: 'rail' as const })),
    // Barges down the Crane.
    { id: 'landing-sable', from: 'landing', to: 'sable', mode: 'barge', cost: barge, group: 'river' },
    // Corn that can't move this year stays in the bins.
    ...HUBS.map((h) => ({ id: `${h}-stored`, from: h, to: 'stored' as NodeId, mode: 'hold' as Mode, cost: 0 })),
  ];
}

type Injection = Partial<Record<NodeId, number>>;

function solveValue(s: NetworkSettings, inject: Injection = {}): { value: number; flows: Record<string, number> } | null {
  const a = arcs(s.barge);
  const revenue = (x: Arc) => (x.to === 'westhaven' ? s.westhaven : x.to === 'sable' ? s.sable : x.to === 'stored' ? s.holdValue : 0);
  const c = a.map((x) => x.cost - revenue(x));
  const A: number[][] = [];
  const b: number[] = [];
  const sense: Array<'<=' | '>=' | '='> = [];
  const add = (row: number[], rhs: number, sn: '<=' | '>=' | '=') => {
    A.push(row);
    b.push(rhs);
    sense.push(sn);
  };
  for (const o of ORIGINS) add(a.map((x) => (x.from === o ? 1 : 0)), s.supply[o] + (inject[o] ?? 0), '=');
  for (const h of HUBS) add(a.map((x) => (x.from === h ? 1 : 0) - (x.to === h ? 1 : 0)), inject[h] ?? 0, '=');
  add(a.map((x) => (x.to === 'bluestem' ? 1 : 0)), s.ethanol, '=');
  add(a.map((x) => (x.to === 'feedyards' ? 1 : 0)), s.feed, '=');
  add(a.map((x) => (x.group === 'rail' ? 1 : 0)), s.railCapacity, '<=');
  add(a.map((x) => (x.group === 'river' ? 1 : 0)), s.riverCapacity, '<=');
  const sol = solveLP({ c, A, b, sense });
  if (sol.status !== 'optimal') return null;
  const flows: Record<string, number> = {};
  a.forEach((x, i) => (flows[x.id] = Math.max(0, sol.x[i] ?? 0)));
  return { value: -sol.objective, flows };
}

export interface Routing {
  /** Flow on each arc, million bushels. */
  flows: Record<string, number>;
  /** The year's routing, $ million: what the corn fetches at its outlets less freight. */
  value: number;
  /** What one more bushel is worth at each district's farms and at each elevator, $. */
  locationValue: Record<DistrictId | Hub, number>;
  /** What one more bushel of room on each route is worth, $ per bushel. */
  railValue: number;
  riverValue: number;
  exports: { westhaven: number; sable: number };
  stored: number;
}

const STEP = 1;

/** Routes a year's crop through the network and prices a bushel at every origin and elevator. */
export function routeCrop(s: NetworkSettings): Routing | null {
  const base = solveValue(s);
  if (!base) return null;
  const locationValue = {} as Record<DistrictId | Hub, number>;
  for (const n of [...ORIGINS, ...HUBS]) {
    const more = solveValue(s, { [n]: STEP });
    locationValue[n] = more ? (more.value - base.value) / STEP : NaN;
  }
  const room = (k: 'railCapacity' | 'riverCapacity') => {
    const more = solveValue({ ...s, [k]: s[k] + STEP });
    return more ? (more.value - base.value) / STEP : 0;
  };
  const f = base.flows;
  const total = (suffix: string) => Object.entries(f).reduce((t, [id, v]) => t + (id.endsWith(suffix) ? v : 0), 0);
  return {
    flows: f,
    value: base.value,
    locationValue,
    railValue: room('railCapacity'),
    riverValue: room('riverCapacity'),
    exports: { westhaven: total('-westhaven'), sable: f['landing-sable'] ?? 0 },
    stored: total('-stored'),
  };
}

/** Scales every district's supply. */
export function scaleSupply(supply: Record<DistrictId, number>, k: number): Record<DistrictId, number> {
  return Object.fromEntries(ORIGINS.map((o) => [o, supply[o] * k])) as Record<DistrictId, number>;
}

/** Valley production, million bushels. */
export function totalSupply(supply: Record<DistrictId, number>): number {
  return ORIGINS.reduce((t, o) => t + supply[o], 0);
}

/**
 * The most corn, million bushels, the valley can use and ship in a year: its own use plus the two
 * export routes. A bigger harvest leaves corn in the bins. (Every district reaches an export route,
 * directly or by displacing a neighbor's corn, so the routes' capacities add.)
 */
export function networkCapacity(s: Omit<NetworkSettings, 'supply'>): number {
  return s.ethanol + s.feed + s.railCapacity + s.riverCapacity;
}

/** A district's location value as the whole valley's harvest scales, with each district's share fixed. */
export function valueCurve(s: NetworkSettings, district: DistrictId, ks: number[]): Array<{ harvest: number; value: number }> {
  return ks.map((k) => {
    const sc = { ...s, supply: scaleSupply(s.supply, k) };
    const base = solveValue(sc);
    const more = base && solveValue(sc, { [district]: STEP });
    return { harvest: totalSupply(sc.supply), value: base && more ? (more.value - base.value) / STEP : NaN };
  });
}

/** A season's corn by district, million bushels. */
export function districtProduction(season: { districts: Record<DistrictId, { corn: number; cornIrrigated: number }> }, acres: Array<{ id: DistrictId; cornKAc: number; irrigatedKAc: number }>): Record<DistrictId, number> {
  return Object.fromEntries(acres.map((d) => [d.id, ((d.cornKAc - d.irrigatedKAc) * season.districts[d.id].corn + d.irrigatedKAc * season.districts[d.id].cornIrrigated) / 1000])) as Record<DistrictId, number>;
}
