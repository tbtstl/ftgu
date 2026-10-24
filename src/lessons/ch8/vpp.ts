// 8.5: a virtual power plant of home batteries spread across the reader's nodes. Part of its
// power trades energy against nodal prices; the rest is held back and sold as reserve and
// regulation in a co-optimized services market (Lesson 4.6), where it competes with the plants.

import { coOptimize, type ServiceUnit } from '../../engines/market/ancillary';
import { optimizeArbitrage } from '../../engines/strategy/arbitrage';
import type { Generator } from '../../model/types';
import type { CapstoneDesign } from './capstone';
import { HOURS, availableAt, offerOf, runMarket, systemDemand, systemOf, type GridSystem, type MarketRun } from './system';

/** What the VPP offers its held-back power at, $/MW-h. */
export const VPP_OFFER = { reserve: 1, regulation: 2 };
/** Regulation requirement as a share of demand (about 1% is common). */
export const REGULATION_SHARE = 0.01;
/** Price when a requirement can't be met, $/MW-h. */
export const SHORTAGE_PRICE = 300;
/** Round-trip efficiency of the home batteries. */
export const VPP_EFFICIENCY = 0.88;
/**
 * Installed cost of a home battery, $ per kWh of storage: an illustrative figure, roughly what US
 * homeowners pay before incentives (grid-scale storage costs far less per kWh).
 */
export const HOME_BATTERY_COST_PER_KWH = 1000;

/** Contingency reserve: enough to replace the largest plant on the grid. */
export function reserveRequirement(sys: GridSystem): number {
  return Math.max(0, ...sys.gens.filter((g) => !g.variable).map((g) => g.capacity));
}

const RESERVE_COST: Partial<Record<Generator['fuel'], number>> = { coal: 4, gasCC: 3, gasCT: 2, oil: 2, hydro: 1 };
const REG_COST: Partial<Record<Generator['fuel'], number>> = { coal: 12, gasCC: 9, gasCT: 10, oil: 12, hydro: 6 };

/** The plants' service offers in an hour: reserve within 30 minutes of ramping, regulation within 5. */
export function serviceUnits(sys: GridSystem, h: number): ServiceUnit[] {
  return sys.gens
    .filter((g) => g.capacity > 0)
    .map((g) => {
      const cap = availableAt(g, sys.weather, h);
      const flexible = g.dispatchable && !g.variable;
      return {
        id: g.id,
        capacity: cap,
        energyCost: offerOf(g),
        reserveMax: flexible ? Math.min(cap, g.rampRate * 0.5) : 0,
        reserveCost: RESERVE_COST[g.fuel] ?? 3,
        regulationMax: flexible ? Math.min(cap, g.rampRate / 12) : 0,
        regulationCost: REG_COST[g.fuel] ?? 10,
      };
    });
}

export interface ServiceHour {
  reserveReq: number;
  regulationReq: number;
  /** MW of each service the VPP sells. */
  vppRegulation: number;
  vppReserve: number;
  regulationPrice: number;
  reservePrice: number;
}

const svcCache = new Map<string, ServiceHour[]>();

/**
 * Clear reserve and regulation each hour with `heldMW` of VPP power offered first to regulation
 * (it pays more), the rest to reserve. When the VPP offers more than a requirement it sets that
 * price itself; otherwise the plants co-optimized for energy and services set it.
 */
export function serviceMarket(sys: GridSystem, heldMW: number): ServiceHour[] {
  const key = JSON.stringify([sys.gens.map((g) => [g.id, g.capacity, g.fuel]), sys.weather, systemDemand(sys.loads).map(Math.round), Math.round(heldMW * 100)]);
  const hit = svcCache.get(key);
  if (hit) return hit;
  const demand = systemDemand(sys.loads);
  const resReq = reserveRequirement(sys);
  const out = HOURS.map((h) => {
    const regReq = demand[h] * REGULATION_SHARE;
    const vppRegulation = Math.min(heldMW, regReq);
    const vppReserve = Math.min(heldMW - vppRegulation, resReq);
    const units = serviceUnits(sys, h);
    const co = coOptimize(units, demand[h], Math.max(0, resReq - vppReserve), Math.max(0, regReq - vppRegulation), SHORTAGE_PRICE);
    const regSat = heldMW >= regReq - 1e-9;
    const resSat = heldMW - vppRegulation >= resReq - 1e-9;
    const p = (x: number) => (Number.isFinite(x) ? Math.max(0, x) : SHORTAGE_PRICE);
    return {
      reserveReq: resReq,
      regulationReq: regReq,
      vppRegulation,
      vppReserve,
      regulationPrice: regSat ? VPP_OFFER.regulation : p(co.regulationPrice),
      reservePrice: resSat ? VPP_OFFER.reserve : p(co.reservePrice),
    };
  });
  svcCache.set(key, out);
  if (svcCache.size > 200) svcCache.delete(svcCache.keys().next().value!);
  return out;
}

export interface VppResult {
  totalMW: number;
  totalMWh: number;
  heldMW: number;
  /** Energy arbitrage at each node against the 8.4 grid's prices, price-taking. */
  energy: Array<{ node: string; mw: number; schedule: number[]; profit: number }>;
  services: ServiceHour[];
  revenue: { energy: number; reserve: number; regulation: number; total: number };
  /** The 8.4 grid the VPP joins, and its market day (whose prices it trades against). */
  sys: GridSystem;
  base: MarketRun;
}

/** Revenue by stream for a VPP plan, treating the VPP as too small to move energy prices. */
export function vppRevenue(d: CapstoneDesign, services = d.vpp.services): VppResult {
  const sys = systemOf(d, 'transition');
  const base = runMarket(sys);
  const nodes = d.nodes.filter((n) => (d.vpp.mw[n] ?? 0) > 0);
  const totalMW = nodes.reduce((s, n) => s + d.vpp.mw[n], 0);
  const share = 1 - services;
  const energy = nodes.map((n) => {
    const mw = d.vpp.mw[n];
    const prices = base.hours.map((h) => h.lmp[n] ?? 0);
    const a =
      share > 0
        ? optimizeArbitrage(prices, { powerMW: mw * share, energyMWh: mw * d.vpp.hours * share, efficiency: VPP_EFFICIENCY, soc0: 0.5 }, { levels: 21 })
        : { schedule: HOURS.map(() => 0), profit: 0 };
    return { node: n, mw, schedule: a.schedule, profit: a.profit };
  });
  const heldMW = totalMW * services;
  const svc = serviceMarket(sys, heldMW);
  const reserve = svc.reduce((s, h) => s + h.vppReserve * h.reservePrice, 0);
  const regulation = svc.reduce((s, h) => s + h.vppRegulation * h.regulationPrice, 0);
  const e = energy.reduce((s, x) => s + x.profit, 0);
  return { totalMW, totalMWh: totalMW * d.vpp.hours, heldMW, energy, services: svc, revenue: { energy: e, reserve, regulation, total: e + reserve + regulation }, sys, base };
}

export interface SplitPoint {
  /** Share of the fleet's power held back for services, 0–1. */
  services: number;
  energy: number;
  reserve: number;
  regulation: number;
  total: number;
}

/** Daily revenue, by stream, at each services share from 0 to 100% in 5% steps. */
export function splitSweep(d: CapstoneDesign): SplitPoint[] {
  return Array.from({ length: 21 }, (_, i) => {
    const s = i / 20;
    const r = vppRevenue(d, s).revenue;
    return { services: s, energy: r.energy, reserve: r.reserve, regulation: r.regulation, total: r.total };
  });
}

export type SplitReason = 'energy' | 'reserve' | 'regulation';

/**
 * Where the revenue curve peaks, and which stream falls most if the VPP holds back one step more
 * (null when the peak is at 100%). Energy arbitrage always shrinks as power is held back; a
 * service's revenue falls only when its price does, as the VPP's own offers push it down.
 */
export function splitAnswer(sweep: SplitPoint[]): { best: SplitPoint; next: SplitPoint | null; reason: SplitReason | null } {
  const best = sweep.reduce((a, b) => (b.total > a.total + 1e-9 ? b : a));
  const i = sweep.indexOf(best);
  const next = sweep[i + 1] ?? null;
  if (!next) return { best, next, reason: null };
  const drops: Array<[SplitReason, number]> = [
    ['energy', next.energy - best.energy],
    ['reserve', next.reserve - best.reserve],
    ['regulation', next.regulation - best.regulation],
  ];
  const reason = drops.reduce((a, b) => (b[1] < a[1] - 1e-9 ? b : a))[0];
  return { best, next, reason };
}
