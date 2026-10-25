// Physical arbitrage (Lesson 4.5, and the basis trades of Chapter 6).
//
// A cargo moves from where crude is cheap to where it's dear if what it sells for there covers
// everything it costs to get there: the purchase price, the pipeline to the coast, terminal fees,
// freight, insurance, and the barrels lost along the way. What's left is the arbitrage margin;
// the "arb" is open when it is positive.

import { CRUDE_IDS, type CrudeId } from '../../model/oil/crudes';
import { crudeBreakeven, planRefinery, type RefineryInputs } from './refinery';
import { CORRAN } from '../../model/oil/refinery';

export interface ArbInputs {
  /** Purchase price at the origin hub, $/bbl. */
  originPrice: number;
  /** Pipeline tariff from the hub to the export terminal, $/bbl. */
  pipelineTariff: number;
  /** Terminal fees at loading and discharge, $/bbl in total. */
  terminalFees: number;
  /** Freight, $/bbl. */
  freight: number;
  /** Cargo insurance, share of the cargo's value. */
  insurance: number;
  /** Barrels lost in transit (evaporation, tank bottoms), share of the cargo. */
  losses: number;
  /** Sales price at the destination, $/bbl. */
  destinationPrice: number;
  /** Quality adjustment the destination pays for this crude relative to its benchmark, $/bbl. */
  qualityAdjustment?: number;
  /** Days in transit and an annual financing rate, for the cost of the money tied up. */
  transitDays?: number;
  financingRate?: number;
}

export interface ArbResult {
  delivered: number;
  revenue: number;
  margin: number;
  open: boolean;
  /** The parts of the delivered cost, $/bbl. */
  parts: Array<{ label: string; value: number }>;
}

export function arbitrage(a: ArbInputs): ArbResult {
  const cargoValue = a.originPrice + a.pipelineTariff;
  const insurance = a.insurance * a.destinationPrice;
  const financing = ((a.financingRate ?? 0.06) * (a.transitDays ?? 0) * cargoValue) / 365;
  const parts = [
    { label: 'Crude at the hub', value: a.originPrice },
    { label: 'Pipeline to the coast', value: a.pipelineTariff },
    { label: 'Terminal fees', value: a.terminalFees },
    { label: 'Freight', value: a.freight },
    { label: 'Insurance', value: insurance },
    { label: 'Financing in transit', value: financing },
  ];
  const delivered = parts.reduce((s, p) => s + p.value, 0);
  // Lost barrels: only (1 − losses) of each barrel arrives to be sold.
  const revenue = (a.destinationPrice + (a.qualityAdjustment ?? 0)) * (1 - a.losses);
  const margin = revenue - delivered;
  return { delivered, revenue, margin, open: margin > 0, parts };
}

/** The freight ($/bbl) at which the arbitrage just closes. */
export function closingFreight(a: ArbInputs): number {
  return a.freight + arbitrage(a).margin;
}

/**
 * A crude's stand-alone value at a refinery: run the refinery on that crude alone, at full
 * crude-unit capacity, and divide what the products earn, less operating costs, by the barrels run.
 * It is the most a refinery running nothing else could pay for the crude and still cover its
 * operating costs: an average over a whole refinery's worth of the crude, not the marginal value
 * of one more barrel in a mixed slate (crudeBreakeven), nor a producer's netback (economics.ts).
 */
export function standaloneValue(k: CrudeId, inp: RefineryInputs = {}): number {
  const runs = (inp.config ?? CORRAN).capacity.cdu;
  const avail = Object.fromEntries(CRUDE_IDS.map((c) => [c, c === k ? runs : 0])) as Record<CrudeId, number>;
  // Price the crude at zero so the plan always runs it in full; its value doesn't depend on its price.
  const plan = planRefinery({ ...inp, crudeAvailable: avail, crudePrice: { ...inp.crudePrice, [k]: 0 } });
  const bbl = plan.crude[k] * 1000;
  return bbl > 0 ? (plan.revenue - plan.opex) / bbl : 0;
}

/** The older name for standaloneValue. */
export const crudeNetback = standaloneValue;

/** Each crude's stand-alone value less Pinyon Light's: the refinery's quality differentials, $/bbl. */
export function qualityDifferentials(inp: RefineryInputs = {}): Record<CrudeId, number> {
  const v = Object.fromEntries(CRUDE_IDS.map((k) => [k, standaloneValue(k, inp)])) as Record<CrudeId, number>;
  return Object.fromEntries(CRUDE_IDS.map((k) => [k, v[k] - v.pinyon])) as Record<CrudeId, number>;
}

/** The marginal value of a crude to a refinery already running its best slate (see crudeBreakeven). */
export { crudeBreakeven };
