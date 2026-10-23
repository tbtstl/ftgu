// Co-optimized energy and reserves, and a sloped-demand capacity auction.

import { solveLP } from './lp';

export interface ServiceUnit {
  id: string;
  /** Maximum output, MW. */
  capacity: number;
  /** Energy offer, $/MWh. */
  energyCost: number;
  /** Most reserve the unit can provide (limited by how fast it ramps), MW. */
  reserveMax: number;
  /** Reserve offer, $/MW-h. */
  reserveCost: number;
  /** Most regulation (second-by-second up/down) the unit can provide, MW. */
  regulationMax?: number;
  regulationCost?: number;
}

export interface CoOptResult {
  feasible: boolean;
  energy: Record<string, number>;
  reserve: Record<string, number>;
  regulation: Record<string, number>;
  energyPrice: number;
  reservePrice: number;
  regulationPrice: number;
  /** Reserve requirement not met, MW. */
  reserveShort: number;
  regulationShort: number;
  cost: number;
}

/**
 * Minimize the cost of energy, reserve and regulation together. A unit's capacity is shared:
 * MW held back as reserve can't also produce energy. Prices are marginal costs, so a cheap unit
 * held back for reserve earns the energy margin it gave up (its opportunity cost).
 * Missing reserve is allowed at `shortagePrice` per MW, which is what drives scarcity pricing.
 */
export function coOptimize(units: ServiceUnit[], demand: number, reserveReq: number, regulationReq = 0, shortagePrice = 1000): CoOptResult {
  const n = units.length;
  const solve = (D: number, R: number, G: number) => {
    // Vars: e_j, r_j, g_j for each unit, then reserve shortage, regulation shortage.
    const nv = 3 * n + 2;
    const c = [...units.map((u) => u.energyCost), ...units.map((u) => u.reserveCost), ...units.map((u) => u.regulationCost ?? 0), shortagePrice, shortagePrice];
    const ub = [...units.map((u) => u.capacity), ...units.map((u) => u.reserveMax), ...units.map((u) => u.regulationMax ?? 0), Infinity, Infinity];
    const A: number[][] = [];
    const b: number[] = [];
    const sense: Array<'<=' | '>=' | '='> = [];
    const row = () => Array<number>(nv).fill(0);
    // Energy balance.
    const e = row();
    for (let j = 0; j < n; j++) e[j] = 1;
    A.push(e);
    b.push(D);
    sense.push('=');
    // Reserve requirement (with shortage slack).
    const r = row();
    for (let j = 0; j < n; j++) r[n + j] = 1;
    r[3 * n] = 1;
    A.push(r);
    b.push(R);
    sense.push('>=');
    // Regulation requirement.
    const g = row();
    for (let j = 0; j < n; j++) g[2 * n + j] = 1;
    g[3 * n + 1] = 1;
    A.push(g);
    b.push(G);
    sense.push('>=');
    // Shared capacity: energy + reserve + regulation ≤ capacity; and energy ≥ regulation (room to move down).
    units.forEach((u, j) => {
      const cap = row();
      cap[j] = 1;
      cap[n + j] = 1;
      cap[2 * n + j] = 1;
      A.push(cap);
      b.push(u.capacity);
      sense.push('<=');
      if ((u.regulationMax ?? 0) > 0) {
        const down = row();
        down[j] = 1;
        down[2 * n + j] = -1;
        A.push(down);
        b.push(0);
        sense.push('>=');
      }
    });
    return solveLP({ c, A, b, sense, ub });
  };

  const base = solve(demand, reserveReq, regulationReq);
  if (base.status !== 'optimal') {
    return { feasible: false, energy: {}, reserve: {}, regulation: {}, energyPrice: NaN, reservePrice: NaN, regulationPrice: NaN, reserveShort: 0, regulationShort: 0, cost: NaN };
  }
  const eps = 0.1;
  const dE = solve(demand + eps, reserveReq, regulationReq);
  const dR = solve(demand, reserveReq + eps, regulationReq);
  const dG = solve(demand, reserveReq, regulationReq + eps);
  const p = (s: typeof base) => (s.status === 'optimal' ? Math.round(((s.objective - base.objective) / eps) * 100) / 100 : shortagePrice);
  const x = base.x;
  return {
    feasible: true,
    energy: Object.fromEntries(units.map((u, j) => [u.id, x[j]])),
    reserve: Object.fromEntries(units.map((u, j) => [u.id, x[n + j]])),
    regulation: Object.fromEntries(units.map((u, j) => [u.id, x[2 * n + j]])),
    energyPrice: p(dE),
    reservePrice: p(dR),
    regulationPrice: p(dG),
    reserveShort: x[3 * n],
    regulationShort: x[3 * n + 1],
    cost: base.objective,
  };
}

export interface CapacityOffer {
  id: string;
  mw: number;
  /** $/MW-day. */
  price: number;
}

export interface CapacityDemandCurve {
  /** Reliability requirement, MW. */
  target: number;
  /** Price paid when supply is short of (target × lowPoint), $/MW-day. */
  priceCap: number;
  /** Price at exactly the target, $/MW-day. */
  priceAtTarget: number;
  /** Supply (as a multiple of target) below which the cap applies, e.g. 0.97. */
  lowPoint?: number;
  /** Supply (as a multiple of target) above which the price is zero, e.g. 1.1. */
  highPoint?: number;
}

/** Price the sloped demand curve pays for a given amount of cleared capacity. */
export function capacityDemandPrice(curve: CapacityDemandCurve, mw: number): number {
  const lo = (curve.lowPoint ?? 0.97) * curve.target;
  const hi = (curve.highPoint ?? 1.1) * curve.target;
  if (mw <= lo) return curve.priceCap;
  if (mw >= hi) return 0;
  if (mw <= curve.target) return curve.priceCap + ((curve.priceAtTarget - curve.priceCap) * (mw - lo)) / (curve.target - lo);
  return curve.priceAtTarget * (1 - (mw - curve.target) / (hi - curve.target));
}

/** Clear capacity offers against a downward-sloping demand curve. */
export function capacityAuction(offers: CapacityOffer[], curve: CapacityDemandCurve) {
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  let cleared = 0;
  let lastAccepted = 0;
  let price = capacityDemandPrice(curve, 0);
  const awarded: Record<string, number> = Object.fromEntries(offers.map((o) => [o.id, 0]));
  for (const o of sorted) {
    // Accept this offer up to where the demand curve's price falls to its offer.
    const step = 1;
    let take = 0;
    while (take < o.mw && capacityDemandPrice(curve, cleared + take + step) >= o.price) take += step;
    take = Math.min(take, o.mw);
    if (take <= 0) {
      // The curve crosses between the last accepted offer and this one.
      price = Math.max(lastAccepted, Math.min(o.price, capacityDemandPrice(curve, cleared)));
      break;
    }
    awarded[o.id] = take;
    cleared += take;
    lastAccepted = o.price;
    price = take < o.mw ? o.price : capacityDemandPrice(curve, cleared);
    if (take < o.mw) break;
  }
  return { price, cleared, awarded };
}
