// The network between servers: a two-tier leaf–spine fabric. Every GPU's network card plugs into a
// leaf switch; each leaf connects upward to every spine switch. A leaf with more GPUs below it
// than links above it is oversubscribed: cheaper, but when every GPU talks across the fabric at
// once, each gets only a share of its card's bandwidth. All prices are simulated.

import { ACCELERATORS, type GpuId } from '../../model/compute/hardware';

/** Ports on each switch (64 ports of 400 Gb/s, a 51.2 Tb/s switch). */
export const SWITCH_PORTS = 64;
export const SWITCH_PRICE = 40_000;
/** One optical transceiver; each switch-to-switch link needs two. */
export const OPTIC_PRICE = 700;
/** Cable from a server's network card to its leaf (short copper or optics), per GPU. */
export const NIC_CABLE_PRICE = 900;
/** Delay per switch a message crosses, µs. */
export const HOP_US = 1;

export interface FabricConfig {
  gpus: number;
  /** Leaf ports facing GPUs; the rest face the spines. */
  downPorts: number;
}

export interface Fabric {
  gpus: number;
  leaves: number;
  spines: number;
  downPorts: number;
  upPorts: number;
  /** GPUs per uplink: 1 is non-blocking. */
  oversubscription: number;
  /** Share of a GPU's card bandwidth available when every GPU sends across the fabric at once. */
  crossShare: number;
  /** Bandwidth across the middle of the fabric, Tb/s. */
  bisectionTbps: number;
  switches: number;
  optics: number;
  costTotal: number;
  costPerGpu: number;
  /** Two tiers of this radix can't reach this many GPUs. */
  tooBig: boolean;
}

/** Most GPUs two tiers can connect with this split of leaf ports. */
export function maxTwoTierGpus(downPorts: number): number {
  return SWITCH_PORTS * downPorts;
}

export function fabric(c: FabricConfig, gpu: GpuId = 'A'): Fabric {
  const down = Math.max(1, Math.min(SWITCH_PORTS - 1, Math.round(c.downPorts)));
  const up = SWITCH_PORTS - down;
  const leaves = Math.ceil(c.gpus / down);
  const uplinks = leaves * up;
  const spines = leaves > 1 ? Math.ceil(uplinks / SWITCH_PORTS) : 0;
  const oversubscription = down / up;
  const crossShare = Math.min(1, up / down);
  const nicTbps = ACCELERATORS[gpu].nicGbps / 1000;
  const bisectionTbps = leaves > 1 ? (Math.min(c.gpus * nicTbps, uplinks * 0.4)) / 2 : 0;
  const switches = leaves + spines;
  const optics = leaves > 1 ? 2 * uplinks : 0;
  const costTotal = switches * SWITCH_PRICE + optics * OPTIC_PRICE + c.gpus * NIC_CABLE_PRICE;
  return {
    gpus: c.gpus,
    leaves,
    spines,
    downPorts: down,
    upPorts: up,
    oversubscription,
    crossShare,
    bisectionTbps,
    switches,
    optics,
    costTotal,
    costPerGpu: c.gpus > 0 ? costTotal / c.gpus : 0,
    tooBig: c.gpus > maxTwoTierGpus(down),
  };
}

/**
 * Share of a GPU's network bandwidth a job actually gets. Packed onto as few leaves as possible,
 * a job that fits under one leaf never crosses the spines; otherwise its traffic shares the
 * uplinks — with other tenants' traffic too, if it is scattered across busy leaves.
 */
export function jobNetworkShare(f: Fabric, jobGpus: number, placement: 'packed' | 'scattered', backgroundLoad: number): number {
  if (placement === 'packed' && jobGpus <= f.downPorts) return 1;
  const free = placement === 'scattered' ? Math.max(0.05, 1 - backgroundLoad) : 1;
  return Math.min(1, f.crossShare * free);
}
