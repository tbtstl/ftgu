// Gas and electricity: what a gas price does to power prices, and what power plants do to gas
// demand. This file runs the electricity course's region — its nine plants, their heat rates
// and its reference day of demand — through a merit-order auction at a given gas price
// (read-only use of that course's model and engines).
//
// A gas plant's fuel cost is its heat rate (MMBtu per MWh) times the gas price; its spark spread is
// the power price minus that fuel cost (and its other variable costs). The implied heat rate,
// power price ÷ gas price, is the heat rate of a plant that would just break even.

import { clearMeritOrder } from '../market/clearing';
import { COST_RECIPE, fleetOffers, type OfferInputs } from '../market/offerCost';
import { STANDARD_FLEET } from '../../model/fleet';
import { SYSTEM_DEMAND } from '../../model/profiles';
import { MMBTU_PER_MCF } from './properties';

/** Spark spread, $/MWh: power price minus the fuel (heat rate × gas price) and variable upkeep. */
export function sparkSpread(powerPrice: number, gasPrice: number, heatRate: number, vom = 0): number {
  return powerPrice - heatRate * gasPrice - vom;
}

/** Implied heat rate, MMBtu/MWh: the power price divided by the gas price. */
export function impliedHeatRate(powerPrice: number, gasPrice: number): number {
  return gasPrice > 0 ? powerPrice / gasPrice : Infinity;
}

/** The electricity region's gas-fired plants and their recipes. */
export const GAS_PLANTS = STANDARD_FLEET.filter((g) => COST_RECIPE[g.id]?.fuel === 'gas').map((g) => ({ ...g, heatRate: COST_RECIPE[g.id].heatRate, vom: COST_RECIPE[g.id].vom }));

export interface PowerHour {
  hour: number;
  demand: number;
  /** Clearing price, $/MWh. */
  price: number;
  /** Id of the plant setting the price. */
  marginal: string | null;
  /** MW from each plant. */
  dispatch: Record<string, number>;
  /** Gas burned this hour, MMBtu. */
  gasMMBtu: number;
}

export interface PowerDay {
  hours: PowerHour[];
  /** Gas burned over the day, MMBtu and Bcf. */
  gasMMBtu: number;
  gasBcf: number;
  /** Each gas plant's margin over its fuel and upkeep for the day, $. */
  margin: Record<string, number>;
  /** Each gas plant's output for the day, MWh. */
  energy: Record<string, number>;
  /** Demand-weighted average power price, $/MWh. */
  avgPrice: number;
}

/**
 * The electricity region's reference day at a given gas price: each hour cleared in merit order,
 * with the gas plants' fuel burn and margins. `demandScale` scales the day's demand (a hotter or
 * colder day); coal and carbon prices can be set too.
 */
export function powerDay(gasPrice: number, opts: { demandScale?: number; coal?: number; carbon?: number } = {}): PowerDay {
  const inputs: OfferInputs = { gas: gasPrice, coal: opts.coal, carbon: opts.carbon };
  const scale = opts.demandScale ?? 1;
  const hours: PowerHour[] = [];
  const margin: Record<string, number> = Object.fromEntries(GAS_PLANTS.map((g) => [g.id, 0]));
  const energy: Record<string, number> = Object.fromEntries(GAS_PLANTS.map((g) => [g.id, 0]));
  let gas = 0;
  let paid = 0;
  let load = 0;
  for (let h = 0; h < 24; h++) {
    const offers = fleetOffers(h, inputs);
    const demand = SYSTEM_DEMAND[h] * scale;
    const c = clearMeritOrder(offers, demand);
    let gasH = 0;
    for (const g of GAS_PLANTS) {
      const mw = c.dispatch[g.id] ?? 0;
      gasH += mw * g.heatRate;
      energy[g.id] += mw;
      const offer = offers.find((o) => o.id === g.id)!.price;
      margin[g.id] += mw * (c.price - offer);
    }
    gas += gasH;
    paid += c.price * demand;
    load += demand;
    hours.push({ hour: h, demand, price: c.price, marginal: c.marginal, dispatch: c.dispatch, gasMMBtu: gasH });
  }
  return { hours, gasMMBtu: gas, gasBcf: gas / MMBTU_PER_MCF / 1e6, margin, energy, avgPrice: paid / load };
}
