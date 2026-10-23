// What goes into a generator's energy offer: fuel burned per MWh (the heat rate) times the fuel's
// price, plus variable operating and maintenance cost, plus the price of the plant's emissions.
// At the reference fuel prices and no carbon price, every plant's offer equals its
// marginalCost in the standard fleet, so this file only explains those numbers — it doesn't
// change them.

import { STANDARD_FLEET } from '../../model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import type { Generator } from '../../model/types';
import type { Offer } from './clearing';

export type FuelKind = 'gas' | 'coal' | 'oil' | 'uranium' | 'water' | 'none';

export interface CostRecipe {
  fuel: FuelKind;
  /** MMBtu of fuel burned per MWh produced. 0 for plants without a fuel bill. */
  heatRate: number;
  /** Variable operating and maintenance cost, $/MWh. */
  vom: number;
  /** For hydro: the value of the stored water if it's saved for later, $/MWh. */
  waterValue?: number;
}

/** Fuel prices, $/MMBtu, at which the recipes reproduce the standard fleet's marginal costs. */
export const REFERENCE_FUEL_PRICE: Record<'gas' | 'coal' | 'oil' | 'uranium', number> = {
  gas: 5.0,
  coal: 2.2,
  oil: 14.0,
  uranium: 0.6,
};

/** Cost build-up for each plant in STANDARD_FLEET (illustrative, in a realistic range). */
export const COST_RECIPE: Record<string, CostRecipe> = {
  nuc: { fuel: 'uranium', heatRate: 10.0, vom: 3 },
  coal: { fuel: 'coal', heatRate: 10.0, vom: 6 },
  cc1: { fuel: 'gas', heatRate: 6.4, vom: 4 },
  cc2: { fuel: 'gas', heatRate: 7.6, vom: 4 },
  ct: { fuel: 'gas', heatRate: 14.0, vom: 18 },
  oil: { fuel: 'oil', heatRate: 11.0, vom: 11 },
  hydro: { fuel: 'water', heatRate: 0, vom: 0, waterValue: 20 },
  wind: { fuel: 'none', heatRate: 0, vom: 0 },
  solar: { fuel: 'none', heatRate: 0, vom: 0 },
};

export interface OfferInputs {
  /** $/MMBtu; defaults to the reference price. */
  gas?: number;
  coal?: number;
  oil?: number;
  /** $ per tonne of CO2. */
  carbon?: number;
}

export interface OfferBreakdown {
  id: string;
  /** Heat rate × fuel price (or the water value for hydro), $/MWh. */
  fuel: number;
  vom: number;
  /** Emissions × carbon price, $/MWh. */
  carbon: number;
  /** The total: the lowest price at which the plant is willing to run, $/MWh. */
  offer: number;
}

function fuelPrice(kind: FuelKind, p: OfferInputs): number {
  switch (kind) {
    case 'gas':
      return p.gas ?? REFERENCE_FUEL_PRICE.gas;
    case 'coal':
      return p.coal ?? REFERENCE_FUEL_PRICE.coal;
    case 'oil':
      return p.oil ?? REFERENCE_FUEL_PRICE.oil;
    case 'uranium':
      return REFERENCE_FUEL_PRICE.uranium;
    default:
      return 0;
  }
}

/** A plant's cost-based offer at the given fuel and carbon prices. */
export function offerBreakdown(g: Generator, p: OfferInputs = {}): OfferBreakdown {
  const r = COST_RECIPE[g.id];
  if (!r) {
    const carbon = g.emissions * (p.carbon ?? 0);
    return { id: g.id, fuel: g.marginalCost, vom: 0, carbon, offer: g.marginalCost + carbon };
  }
  const fuel = r.fuel === 'water' ? (r.waterValue ?? 0) : r.heatRate * fuelPrice(r.fuel, p);
  const carbon = g.emissions * (p.carbon ?? 0);
  return { id: g.id, fuel, vom: r.vom, carbon, offer: fuel + r.vom + carbon };
}

/** The standard fleet's offers for one hour of the reference day: wind and solar offer what the weather allows. */
export function fleetOffers(hour: number, p: OfferInputs = {}, fleet: Generator[] = STANDARD_FLEET): Array<Offer & { breakdown: OfferBreakdown }> {
  return fleet.map((g) => {
    const b = offerBreakdown(g, p);
    const mw = g.fuel === 'wind' ? WIND_CF[hour] * g.capacity : g.fuel === 'solar' ? SOLAR_CF[hour] * g.capacity : g.capacity;
    return { id: g.id, mw, price: b.offer, breakdown: b };
  });
}

/** Demand on the reference day at an hour, MW. */
export function referenceDemand(hour: number): number {
  return SYSTEM_DEMAND[hour];
}

/**
 * The gas price at which a gas plant's offer equals another plant's offer, $/MMBtu.
 * Below it the gas plant is the cheaper of the two. Returns null if the gas plant's offer
 * doesn't depend on the gas price.
 */
export function switchingGasPrice(gasPlant: Generator, other: Generator, p: OfferInputs = {}): number | null {
  const r = COST_RECIPE[gasPlant.id];
  if (!r || r.fuel !== 'gas' || r.heatRate <= 0) return null;
  const otherOffer = offerBreakdown(other, p).offer;
  const fixed = r.vom + gasPlant.emissions * (p.carbon ?? 0);
  return (otherOffer - fixed) / r.heatRate;
}

/** Offer of a plant the reader designs: heat rate × gas price + variable O&M. */
export function customGasOffer(heatRate: number, vom: number, gas: number): number {
  return heatRate * gas + vom;
}
