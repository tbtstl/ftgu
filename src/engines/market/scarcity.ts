// Scarcity pricing: energy and reserves co-optimized, with a priced reserve shortfall and, when
// even that isn't enough, involuntary load shedding at the value of lost load.

import type { Generator } from '../../model/types';
import { coOptimize, type ServiceUnit } from './ancillary';

const SHED = '__shed';

export interface ScarcityResult {
  feasible: boolean;
  /** Energy price, $/MWh: the cost of serving one more MW of demand. */
  energyPrice: number;
  /** Reserve price, $/MW-h. */
  reservePrice: number;
  /** Energy from each unit, MW (load shedding excluded). */
  energy: Record<string, number>;
  /** Reserve held, MW. */
  reserveHeld: number;
  /** Reserve requirement not met, MW. */
  reserveShort: number;
  /** Demand cut off, MW. */
  shed: number;
}

/**
 * Units for a scarcity model from a fleet: weather-limited wind and solar, and spare capacity at
 * any dispatchable plant counting as reserve. Inflexible and weather-driven plants hold none.
 */
export function reserveUnitsFromFleet(fleet: Generator[], opts: { windCF?: number; solarCF?: number; out?: string[] } = {}): ServiceUnit[] {
  const out = new Set(opts.out ?? []);
  return fleet
    .filter((g) => !out.has(g.id))
    .map((g) => {
      const cf = g.fuel === 'wind' ? (opts.windCF ?? 1) : g.fuel === 'solar' ? (opts.solarCF ?? 1) : 1;
      const capacity = g.capacity * cf;
      return { id: g.id, capacity, energyCost: g.marginalCost, reserveMax: g.dispatchable ? capacity : 0, reserveCost: 0 };
    })
    .filter((u) => u.capacity > 0);
}

/**
 * Clear energy and reserves for one interval. A reserve shortfall costs `shortagePrice` per MW;
 * demand that can't be served at all is shed at `voll`. Prices are marginal costs, so as reserves
 * run out the energy price climbs to the marginal plant's cost plus the shortage price, and to
 * the value of lost load once customers are being cut off.
 */
export function scarcityClear(units: ServiceUnit[], demand: number, reserveReq: number, shortagePrice: number, voll: number): ScarcityResult {
  const shed: ServiceUnit = { id: SHED, capacity: Math.max(1, demand * 2), energyCost: voll, reserveMax: 0, reserveCost: 0 };
  const r = coOptimize([...units, shed], demand, reserveReq, 0, shortagePrice);
  if (!r.feasible) {
    return { feasible: false, energyPrice: NaN, reservePrice: NaN, energy: {}, reserveHeld: 0, reserveShort: reserveReq, shed: 0 };
  }
  const energy = Object.fromEntries(units.map((u) => [u.id, r.energy[u.id] ?? 0]));
  const reserveHeld = units.reduce((s, u) => s + (r.reserve[u.id] ?? 0), 0);
  return {
    feasible: true,
    energyPrice: r.energyPrice,
    reservePrice: r.reservePrice,
    energy,
    reserveHeld,
    reserveShort: r.reserveShort,
    shed: r.energy[SHED] ?? 0,
  };
}

export interface PriceSegment {
  /** Demand range, MW. */
  from: number;
  to: number;
  /** Energy price over the range, $/MWh. */
  price: number;
  regime: 'normal' | 'shortage' | 'shed';
}

/**
 * The energy price as a step function of demand between dMin and dMax. Prices only change where
 * a plant fills up, where reserves start to run short, or where capacity runs out, so the solver
 * is run once in the middle of each interval between those points.
 */
export function scarcityCurve(units: ServiceUnit[], reserveReq: number, shortagePrice: number, voll: number, dMin: number, dMax: number): PriceSegment[] {
  const sorted = [...units].sort((a, b) => a.energyCost - b.energyCost);
  const cuts = new Set<number>([dMin, dMax]);
  let cum = 0;
  for (const u of sorted) {
    cum += u.capacity;
    cuts.add(cum);
  }
  const total = cum;
  cuts.add(total - reserveReq);
  const pts = [...cuts].filter((x) => x >= dMin && x <= dMax).sort((a, b) => a - b);
  const segs: PriceSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b - a < 1e-6) continue;
    const r = scarcityClear(units, (a + b) / 2, reserveReq, shortagePrice, voll);
    const regime: PriceSegment['regime'] = r.shed > 1e-6 ? 'shed' : r.reserveShort > 1e-6 ? 'shortage' : 'normal';
    const last = segs[segs.length - 1];
    if (last && Math.abs(last.price - r.energyPrice) < 1e-6 && last.regime === regime) last.to = b;
    else segs.push({ from: a, to: b, price: r.energyPrice, regime });
  }
  return segs;
}
