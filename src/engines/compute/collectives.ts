// Many GPUs working on one job must share results: after each training step, every GPU's gradients
// are summed across all of them (an all-reduce). How long that takes depends on the links between
// the GPUs — their bandwidth and their latency — and on the pattern of messages.

import { ACCELERATORS, type GpuId } from '../../model/compute/hardware';

export interface LinkSpec {
  /** Bandwidth per GPU in each direction, GB/s. */
  gbs: number;
  /** Time per message step, µs (software, switches, wires). */
  latencyUs: number;
}

/** Links inside one 8-GPU server, by accelerator: PCIe through the host for the L-class, dedicated GPU links for A and B. */
export function scaleUpLink(gpu: GpuId): LinkSpec {
  const g = ACCELERATORS[gpu];
  return { gbs: g.scaleUpGBs, latencyUs: g.scaleUpKind === 'PCIe' ? 5 : 2 };
}

/** The network between servers, per GPU. */
export function scaleOutLink(gpu: GpuId): LinkSpec {
  return { gbs: ACCELERATORS[gpu].nicGbps / 8, latencyUs: 8 };
}

/**
 * Ring all-reduce: the GPUs pass chunks around a ring, first summing (reduce-scatter) then
 * sharing the sums (all-gather). Each GPU sends and receives 2(p − 1)/p of the data, in 2(p − 1)
 * steps, so the time barely grows with p for large messages — but the latency term does.
 */
export function ringAllReduce(bytes: number, gpus: number, link: LinkSpec): { seconds: number; bandwidthS: number; latencyS: number } {
  if (gpus <= 1) return { seconds: 0, bandwidthS: 0, latencyS: 0 };
  const bandwidthS = ((2 * (gpus - 1)) / gpus) * (bytes / (link.gbs * 1e9));
  const latencyS = 2 * (gpus - 1) * link.latencyUs * 1e-6;
  return { seconds: bandwidthS + latencyS, bandwidthS, latencyS };
}

export interface HierarchicalResult {
  seconds: number;
  /** Reduce-scatter inside each server. */
  intraScatterS: number;
  /** All-reduce of each GPU's share across servers. */
  interS: number;
  /** All-gather inside each server. */
  intraGatherS: number;
}

/**
 * Two-level all-reduce for servers of `perNode` GPUs: sum within each server over its fast links,
 * so each GPU holds 1/perNode of the total; all-reduce those shares across servers, every GPU's
 * network card working at once; then share the result within each server again.
 */
export function hierarchicalAllReduce(bytes: number, nodes: number, perNode: number, intra: LinkSpec, inter: LinkSpec): HierarchicalResult {
  const half = (p: number, b: number, l: LinkSpec) => (p <= 1 ? 0 : ((p - 1) / p) * (b / (l.gbs * 1e9)) + (p - 1) * l.latencyUs * 1e-6);
  const intraScatterS = half(perNode, bytes, intra);
  const interS = ringAllReduce(bytes / perNode, nodes, inter).seconds;
  const intraGatherS = intraScatterS;
  return { seconds: intraScatterS + interS + intraGatherS, intraScatterS, interS, intraGatherS };
}

/** A flat ring over every GPU in `nodes` servers: its slowest hop is the network between servers. */
export function flatRingAllReduce(bytes: number, nodes: number, perNode: number, intra: LinkSpec, inter: LinkSpec) {
  const p = nodes * perNode;
  const link = nodes > 1 ? { gbs: Math.min(intra.gbs, inter.gbs), latencyUs: Math.max(intra.latencyUs, inter.latencyUs) } : intra;
  return ringAllReduce(bytes, p, link);
}

/** "Bus bandwidth": the rate the data effectively moved, so different GPU counts compare fairly, GB/s. */
export function busBandwidth(bytes: number, gpus: number, seconds: number): number {
  if (seconds <= 0 || gpus <= 1) return 0;
  return (((2 * (gpus - 1)) / gpus) * bytes) / seconds / 1e9;
}
