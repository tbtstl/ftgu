// The standard fleet as providers of grid services, and the region's capacity auction.
// Reserve and regulation capabilities follow each plant's ramp rate; prices come from
// coOptimize and capacityAuction in ancillary.ts.

import { STANDARD_FLEET } from '../../model/fleet';
import { SOLAR_CF, WIND_CF } from '../../model/profiles';
import type { MarketDay } from '../../model/history';
import type { Generator } from '../../model/types';
import { capacityAuction, type CapacityDemandCurve, type CapacityOffer, type ServiceUnit } from './ancillary';

/** Operating reserve here means extra output a plant can deliver within 30 minutes of a call. */
export const RESERVE_WINDOW_H = 0.5;
/** Regulation: output a plant can move up or down, on the operator's signal, within 5 minutes. */
export const REGULATION_WINDOW_H = 5 / 60;
/** Offers for holding capacity back, $/MW-h: small, since holding back costs a plant little directly. */
export const RESERVE_OFFER = 1;
export const REGULATION_OFFER = 5;

/** The largest single loss the grid could suffer: the biggest plant tripping, MW. */
export const LARGEST_UNIT: Generator = STANDARD_FLEET.reduce((a, b) => (b.capacity > a.capacity ? b : a));

/** MW a plant can hold as 30-minute reserve: its ramp over the window, up to its capacity. */
export function reserveCapability(g: Generator): number {
  if (!g.dispatchable || g.variable) return 0;
  return Math.min(g.capacity, g.rampRate * RESERVE_WINDOW_H);
}

/** MW a plant can offer as regulation: its ramp over five minutes (peakers and oil don't regulate). */
export function regulationCapability(g: Generator): number {
  if (!g.dispatchable || g.variable || g.fuel === 'gasCT' || g.fuel === 'oil') return 0;
  return Math.min(g.capacity, g.rampRate * REGULATION_WINDOW_H);
}

/** The fleet as co-optimization units for an hour of the reference day (wind and solar at the weather's output). */
export function serviceUnits(hour: number, fleet: Generator[] = STANDARD_FLEET): ServiceUnit[] {
  return fleet.map((g) => ({
    id: g.id,
    capacity: g.fuel === 'wind' ? WIND_CF[hour] * g.capacity : g.fuel === 'solar' ? SOLAR_CF[hour] * g.capacity : g.capacity,
    energyCost: g.marginalCost,
    reserveMax: reserveCapability(g),
    reserveCost: RESERVE_OFFER,
    regulationMax: regulationCapability(g),
    regulationCost: REGULATION_OFFER,
  }));
}

/** Total MW the fleet could produce in an hour of the reference day. */
export function fleetCapacityAt(hour: number): number {
  return serviceUnits(hour).reduce((s, u) => s + u.capacity, 0);
}

// ---------------------------------------------------------------------------
// Missing money and the capacity auction.

export interface ScarcityEarnings {
  /** Margin over running cost per MW of capacity, $, producing whenever the price exceeds the cost. */
  dayAhead: number;
  realTime: number;
  /** Hours in which the price exceeded the cost. */
  dayAheadHours: number;
  realTimeHours: number;
  /** Real-time margin per MW on each day, $. */
  realTimeByDay: number[];
  /** The plant's fixed costs over the same days, $ per MW. */
  fixed: number;
}

/** What a plant would have earned above its running costs over a stretch of history, per MW. */
export function scarcityEarnings(g: Generator, days: MarketDay[]): ScarcityEarnings {
  const gas = g.fuel === 'gasCC' || g.fuel === 'gasCT';
  let dayAhead = 0;
  let realTime = 0;
  let dayAheadHours = 0;
  let realTimeHours = 0;
  const realTimeByDay: number[] = [];
  for (const d of days) {
    const c = gas ? g.marginalCost * d.gas : g.marginalCost;
    let rtDay = 0;
    for (let h = 0; h < 24; h++) {
      if (d.da[h] > c) {
        dayAhead += d.da[h] - c;
        dayAheadHours++;
      }
      if (d.rt[h] > c) {
        rtDay += d.rt[h] - c;
        realTimeHours++;
      }
    }
    realTime += rtDay;
    realTimeByDay.push(rtDay);
  }
  return { dayAhead, realTime, dayAheadHours, realTimeHours, realTimeByDay, fixed: (g.fixedCost * days.length) / 365 };
}

/**
 * Missing money of a new plant, $ per MW per day: the part of its fixed costs that the energy
 * market (real-time margins over the given days) doesn't cover. Never negative.
 */
export function missingMoneyPerDay(g: Generator, days: MarketDay[]): number {
  const e = scarcityEarnings(g, days);
  return days.length ? Math.max(0, e.fixed - e.realTime) / days.length : 0;
}

/** Capacity the region wants to have under contract: about 15% above the history's highest forecast peak (1,737 MW). */
export const CAPACITY_TARGET = 2000;

/** Hour of the reference day's peak, used to accredit wind and solar. */
export const PEAK_HOUR = 19;

/** MW a plant is credited with in the capacity auction: what it can be counted on for at the peak. */
export function accreditedCapacity(g: Generator): number {
  if (g.fuel === 'wind') return WIND_CF[PEAK_HOUR] * g.capacity;
  if (g.fuel === 'solar') return SOLAR_CF[PEAK_HOUR] * g.capacity;
  return g.capacity * g.availability;
}

/**
 * What each existing plant asks, $ per MW-day, to stay available for the delivery year beyond
 * what it expects from energy sales. Illustrative: their construction costs are already spent,
 * so these are small, and largest for plants that rarely run.
 */
export const EXISTING_CAPACITY_OFFER: Record<string, number> = {
  nuc: 0,
  hydro: 0,
  wind: 0,
  solar: 0,
  cc1: 0,
  cc2: 10,
  ct: 20,
  coal: 30,
  oil: 60,
};

/** The sloped demand curve: pays 1.5× the new plant's missing money when short, that at the target, zero 10% above it. */
export function capacityCurve(netCone: number, target = CAPACITY_TARGET): CapacityDemandCurve {
  return { target, priceAtTarget: netCone, priceCap: 1.5 * netCone, lowPoint: 0.97, highPoint: 1.1 };
}

export interface CapacityResult {
  price: number;
  cleared: number;
  awarded: Record<string, number>;
  offers: CapacityOffer[];
  curve: CapacityDemandCurve;
}

/** Run the region's capacity auction with the existing fleet plus a new plant offering `newMW` at `newOffer`. */
export function regionCapacityAuction(newMW: number, newOffer: number, netCone: number, fleet: Generator[] = STANDARD_FLEET): CapacityResult {
  const offers: CapacityOffer[] = fleet
    .map((g) => ({ id: g.id, mw: accreditedCapacity(g), price: EXISTING_CAPACITY_OFFER[g.id] ?? 0 }))
    .filter((o) => o.mw > 1e-9);
  if (newMW > 0) offers.push({ id: 'new', mw: newMW, price: newOffer });
  const curve = capacityCurve(netCone);
  const r = capacityAuction(offers, curve);
  return { ...r, offers, curve };
}
