// Where congestion rent comes from, and the financial transmission rights it pays for.
//
// With locational prices, loads pay more than generators receive whenever a line is full. Each
// line's share of that surplus is its flow times the price difference across it. A financial
// transmission right (FTR; also called a CRR or TCC) from a source node to a sink node pays its
// holder MW × (LMP_sink − LMP_source), and the rent is what funds those payments.

import type { Network } from '../../model/types';
import { computePtdf } from '../physics/powerflow';
import type { HalfPlane } from './networkDispatch';
import { ftrPayoff } from './settlement';

export interface LineRent {
  id: string;
  /** MW, positive from → to. */
  flow: number;
  /** LMP at the receiving end minus LMP at the sending end (in the direction of flow), $/MWh. */
  spread: number;
  /** flow × spread, $/h. */
  rent: number;
}

/** Each line's share of the congestion rent: |flow| × (price where it arrives − price where it leaves). */
export function rentByLine(net: Network, flows: Record<string, number>, lmp: Record<string, number>): LineRent[] {
  return net.lines.map((l) => {
    const f = flows[l.id] ?? 0;
    const spread = f >= 0 ? (lmp[l.to] ?? 0) - (lmp[l.from] ?? 0) : (lmp[l.from] ?? 0) - (lmp[l.to] ?? 0);
    return { id: l.id, flow: f, spread, rent: Math.abs(f) * spread };
  });
}

export interface Ftr {
  id?: string;
  source: string;
  sink: string;
  /** MW; negative for a counterflow position. */
  mw: number;
}

export interface FtrSettlement {
  /** Payout of each FTR, $/h (negative if it pays the operator). */
  payouts: number[];
  totalPayout: number;
  /** Congestion rent available to fund them, $/h. */
  rent: number;
  /** rent − payouts: positive is a surplus, negative a shortfall. */
  surplus: number;
  /** Payouts covered by the rent. */
  adequate: boolean;
}

/** Settle a set of FTRs against one hour's prices and the rent the operator collected. */
export function settleFtrs(ftrs: Ftr[], lmp: Record<string, number>, rent: number): FtrSettlement {
  const payouts = ftrs.map((f) => ftrPayoff(f.mw, lmp[f.source] ?? 0, lmp[f.sink] ?? 0));
  const totalPayout = payouts.reduce((s, v) => s + v, 0);
  return { payouts, totalPayout, rent, surplus: rent - totalPayout, adequate: totalPayout <= rent + 1e-6 };
}

/**
 * Flows the FTRs would cause if each were a real injection of its MW at the source and
 * withdrawal at the sink. The set is "simultaneously feasible" if these flows fit within every
 * line's limit; then, in a DC model, the rent always covers the payouts.
 */
export function ftrFlows(net: Network, ftrs: Ftr[], outages: string[] = []): Record<string, number> {
  const { ptdf } = computePtdf(net, outages);
  const flows: Record<string, number> = {};
  for (const l of net.lines) {
    if (outages.includes(l.id)) {
      flows[l.id] = 0;
      continue;
    }
    flows[l.id] = ftrs.reduce((s, f) => s + f.mw * (ptdf[l.id][f.source] - ptdf[l.id][f.sink]), 0);
  }
  return flows;
}

/** Whether a set of FTRs fits the network: every implied flow within its limit. */
export function ftrFeasible(net: Network, ftrs: Ftr[], limits: Record<string, number> = {}, outages: string[] = []): boolean {
  const f = ftrFlows(net, ftrs, outages);
  return net.lines.every((l) => outages.includes(l.id) || Math.abs(f[l.id]) <= (limits[l.id] ?? l.limit) + 1e-6);
}

/**
 * The simultaneous-feasibility region for two FTRs of variable size x and y (MW) as half-planes
 * in (x, y): every line's implied flow within its limit in both directions.
 */
export function ftrPlane(net: Network, x: { source: string; sink: string }, y: { source: string; sink: string }, limits: Record<string, number> = {}): HalfPlane[] {
  const { ptdf } = computePtdf(net);
  const out: HalfPlane[] = [];
  for (const l of net.lines) {
    const a = ptdf[l.id][x.source] - ptdf[l.id][x.sink];
    const b = ptdf[l.id][y.source] - ptdf[l.id][y.sink];
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) continue;
    const lim = limits[l.id] ?? l.limit;
    out.push({ a, b, c: lim, id: `${l.id}:max` });
    out.push({ a: -a, b: -b, c: lim, id: `${l.id}:min` });
  }
  return out;
}

/**
 * A buyer at `sink` with a fixed-price contract for `contractMW` from a generator at `source`
 * pays the contract price but buys its power at the sink's price, so it is exposed to the price
 * difference. `ftrMW` of FTRs from source to sink offsets that exposure. Returns $/MWh of the contract.
 */
export function hedgedCostPerMWh(contractPrice: number, contractMW: number, ftrMW: number, lmpSource: number, lmpSink: number): number {
  if (contractMW <= 0) return contractPrice;
  const exposure = contractMW * (lmpSink - lmpSource);
  const ftr = ftrPayoff(ftrMW, lmpSource, lmpSink);
  return contractPrice + (exposure - ftr) / contractMW;
}
