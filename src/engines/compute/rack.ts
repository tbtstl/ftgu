// Packing GPUs into racks. A rack is a 42-unit cabinet with a power feed of fixed size; a rack's
// heat must be carried away by air blown through it or by liquid piped to cold plates on the chips.
// Whichever runs out first — space, power or cooling — sets how many GPUs a rack holds, and so how
// much floor and how many power feeds a cluster needs.

import { ACCELERATORS, SERVERS, serverPowerW, type Cooling, type GpuId } from '../../model/compute/hardware';

/** Usable rack units in a standard rack. */
export const RACK_UNITS = 42;
/** Rack units taken by the top-of-rack switch and cable management. */
export const RACK_OVERHEAD_U = 2;
/** Power for the rack's own switch and power distribution, kW. */
export const RACK_OVERHEAD_KW = 1;
/** Most heat each cooling method can remove from one rack, kW. */
export const COOLING_LIMIT_KW: Record<Cooling, number> = { air: 40, liquid: 140 };
/** Floor area per rack including its share of aisles, m². */
export const FLOOR_M2_PER_RACK = 3;

export interface RackConfig {
  gpu: GpuId;
  cooling: Cooling;
  /** Servers the builder tries to put in the rack. */
  servers: number;
  /** The power feed to this rack position, kW. */
  feedKW: number;
}

export type RackLimit = 'space' | 'power feed' | 'cooling';

export interface RackResult {
  servers: number;
  gpus: number;
  serverKW: number;
  rackKW: number;
  unitsUsed: number;
  /** Which limits the requested servers break. */
  violations: RackLimit[];
  /** Most servers that fit, and what stops one more. */
  maxServers: number;
  binding: RackLimit;
  /** GPU board power as a share of the rack's power: the rest is CPUs, memory, network, fans and conversion. */
  gpuShare: number;
}

export function serverUnits(gpu: GpuId, cooling: Cooling): number {
  return SERVERS[gpu].heightU[cooling];
}

/** Most servers a rack can hold by each limit. */
export function rackLimits(gpu: GpuId, cooling: Cooling, feedKW: number): Record<RackLimit, number> {
  const kw = serverPowerW(gpu, cooling) / 1000;
  return {
    space: Math.floor((RACK_UNITS - RACK_OVERHEAD_U) / serverUnits(gpu, cooling)),
    'power feed': Math.max(0, Math.floor((feedKW - RACK_OVERHEAD_KW) / kw)),
    cooling: Math.max(0, Math.floor((COOLING_LIMIT_KW[cooling] - RACK_OVERHEAD_KW) / kw)),
  };
}

export function rackConfig(c: RackConfig): RackResult {
  const kw = serverPowerW(c.gpu, c.cooling) / 1000;
  const lim = rackLimits(c.gpu, c.cooling, c.feedKW);
  const order: RackLimit[] = ['space', 'power feed', 'cooling'];
  let binding: RackLimit = 'space';
  let maxServers = Infinity;
  for (const l of order)
    if (lim[l] < maxServers) {
      maxServers = lim[l];
      binding = l;
    }
  const rackKW = c.servers * kw + (c.servers > 0 ? RACK_OVERHEAD_KW : 0);
  const violations = order.filter((l) => c.servers > lim[l]);
  const gpuKW = (c.servers * SERVERS[c.gpu].gpus * ACCELERATORS[c.gpu].tdpW) / 1000;
  return {
    servers: c.servers,
    gpus: c.servers * SERVERS[c.gpu].gpus,
    serverKW: kw,
    rackKW,
    unitsUsed: c.servers * serverUnits(c.gpu, c.cooling) + (c.servers > 0 ? RACK_OVERHEAD_U : 0),
    violations,
    maxServers,
    binding,
    gpuShare: rackKW > 0 ? gpuKW / rackKW : 0,
  };
}

export interface ClusterLayout {
  racks: number;
  gpusPerRack: number;
  /** IT power of the whole cluster, MW. */
  itMW: number;
  floorM2: number;
  /** kW per m² of floor. */
  densityKWm2: number;
}

/** Racks, power and floor for `gpus` GPUs at the most servers per rack the limits allow. */
export function clusterLayout(gpu: GpuId, cooling: Cooling, feedKW: number, gpus: number): ClusterLayout {
  const r = rackConfig({ gpu, cooling, servers: 0, feedKW });
  const perRack = r.maxServers * SERVERS[gpu].gpus;
  if (perRack <= 0) return { racks: Infinity, gpusPerRack: 0, itMW: Infinity, floorM2: Infinity, densityKWm2: 0 };
  const servers = Math.ceil(gpus / SERVERS[gpu].gpus);
  const racks = Math.ceil(servers / r.maxServers);
  const itKW = servers * r.serverKW + racks * RACK_OVERHEAD_KW;
  const floorM2 = racks * FLOOR_M2_PER_RACK;
  return { racks, gpusPerRack: perRack, itMW: itKW / 1000, floorM2, densityKWm2: itKW / floorM2 };
}
