// One generator's offer in a single-zone, uniform-price auction: what it earns for each offer it
// could make, whether the rest of the fleet could meet demand without it (the pivotal-supplier
// test), and offer mitigation, in which a market monitor clears the market on the plant's
// reference level instead of its offer. Used by Lesson 4.4.

import { clearMeritOrder, settle, type Clearing, type Offer } from './clearing';
import { fleetOffers } from './offerCost';

/** The hour of the reference day Lesson 4.4 works in: the evening peak. */
export const REFERENCE_HOUR = 19;

/**
 * Allowance a reference level adds to a plant's estimated running cost. PJM's cost-based
 * offers, for example, may include a 10% adder.
 */
export const REFERENCE_ADDER = 0.1;

/** A plant's reference level: its running cost plus the allowance, $/MWh (rounded to cents). */
export function referenceLevel(cost: number, adder = REFERENCE_ADDER): number {
  return Math.round(cost * (1 + adder) * 100) / 100;
}

/** The region's cost-based offers at an hour of the reference day; plants with no output are left out. */
export function hourOffers(hour: number): Offer[] {
  return fleetOffers(hour)
    .filter((o) => o.mw > 1e-6)
    .map(({ id, mw, price }) => ({ id, mw, price }));
}

/**
 * Replace one plant's offer price. The list keeps its order, and the clearing engine breaks ties
 * by list order, so a plant that matches a later plant's offer still runs before it.
 */
export function withOffer(offers: Offer[], id: string, price: number): Offer[] {
  return offers.map((o) => (o.id === id ? { ...o, price } : o));
}

/** MW the rest of the fleet can offer without this plant. */
export function supplyWithout(offers: Offer[], id: string): number {
  return offers.reduce((s, o) => s + (o.id === id ? 0 : o.mw), 0);
}

/** Pivotal-supplier test: demand can't be met without this plant, so some of it runs whatever it offers. */
export function isPivotal(offers: Offer[], id: string, demand: number): boolean {
  return supplyWithout(offers, id) < demand - 1e-9;
}

export interface OfferResult {
  /** The offer the plant submitted, $/MWh. */
  offer: number;
  /** The offer the operator cleared the market on: the submitted offer, or the reference level if mitigated. */
  applied: number;
  mitigated: boolean;
  pivotal: boolean;
  clearing: Clearing;
  /** The plant's accepted MW. */
  dispatch: number;
  /** Clearing price, $/MWh: every plant that runs is paid it. */
  price: number;
  /** (clearing price − running cost) × dispatch, $ for the hour. */
  profit: number;
}

/**
 * Clear the market with one plant's offer changed. With `monitor` on, the offer is mitigated —
 * replaced by the plant's reference level — when it is above that level and either the plant is
 * pivotal or the offer raises the clearing price above what the reference level would give
 * (a conduct-and-impact test with no tolerance). Offers at or below the reference level stand.
 */
export function clearWithOffer(offers: Offer[], id: string, cost: number, offer: number, demand: number, monitor = false): OfferResult {
  const ref = referenceLevel(cost);
  const pivotal = isPivotal(offers, id, demand);
  let applied = offer;
  let mitigated = false;
  if (monitor && offer > ref) {
    const atRef = clearMeritOrder(withOffer(offers, id, ref), demand).price;
    const asOffered = clearMeritOrder(withOffer(offers, id, offer), demand).price;
    if (pivotal || asOffered > atRef + 1e-9) {
      applied = ref;
      mitigated = true;
    }
  }
  const clearing = clearMeritOrder(withOffer(offers, id, applied), demand);
  const dispatch = clearing.dispatch[id] ?? 0;
  return { offer, applied, mitigated, pivotal, clearing, dispatch, price: clearing.price, profit: (clearing.price - cost) * dispatch };
}

/** The plant's profit for the hour at each offer on a grid, at a fixed demand. */
export function profitCurve(offers: Offer[], id: string, cost: number, demand: number, grid: number[], monitor = false): OfferResult[] {
  return grid.map((o) => clearWithOffer(offers, id, cost, o, demand, monitor));
}

/** The highest offer on a grid at which the plant still runs at full output, or null if it never does. */
export function highestFullOffer(offers: Offer[], id: string, cost: number, demand: number, grid: number[], monitor = false): number | null {
  const cap = offers.find((o) => o.id === id)?.mw ?? 0;
  let best: number | null = null;
  for (const r of profitCurve(offers, id, cost, demand, grid, monitor)) if (r.dispatch >= cap - 1e-6) best = best === null ? r.offer : Math.max(best, r.offer);
  return best;
}

export type PaymentRule = 'uniform' | 'payAsBid' | 'payAsBidGuess';

export interface PaymentOutcome {
  /** The offers as submitted under this rule (block heights). */
  offers: Offer[];
  clearing: Clearing;
  /** What each plant is paid for the hour, $. */
  paid: Record<string, number>;
  /** What consumers pay for the hour, $. */
  bill: number;
  /** The running cost of the plants dispatched, $. */
  runningCost: number;
}

/**
 * One hour under three payment rules, all dispatching the same plants:
 * - uniform: every plant that runs is paid the clearing price;
 * - payAsBid: each plant is paid its own offer, with offers still at cost;
 * - payAsBidGuess: each plant is paid its own offer, and every plant that runs has raised its
 *   offer to the clearing price it expects (assumed here to be guessed exactly).
 */
export function payments(costOffers: Offer[], demand: number, rule: PaymentRule): PaymentOutcome {
  const clearing = clearMeritOrder(costOffers, demand);
  const offers =
    rule === 'payAsBidGuess'
      ? costOffers.map((o) => ((clearing.dispatch[o.id] ?? 0) > 1e-9 ? { ...o, price: Math.max(o.price, clearing.price) } : o))
      : costOffers;
  const paid = settle(offers, clearing, rule === 'uniform' ? 'uniform' : 'payAsBid');
  const bill = Object.values(paid).reduce((s, v) => s + v, 0);
  const runningCost = costOffers.reduce((s, o) => s + o.price * (clearing.dispatch[o.id] ?? 0), 0);
  return { offers, clearing, paid, bill, runningCost };
}
