// One loading area's spot market for a fortnight: open ships that could reach it, cargoes that
// need lifting, and the freight rate at which the two sides match.
//
// A ship's reservation freight is the least she would accept: enough to pay for sailing empty to
// the loading port, the laden voyage, port calls and commissions, and to earn at least what she
// could earn elsewhere for every day the business takes. Ships close to the cargo need less. A
// charterer's bid is the most it will pay before the cargo isn't worth moving (or is bought
// elsewhere). Sorting ships from cheapest and cargoes from keenest, the market clears where the
// two lists cross, and every fixture is done at that one rate — whoever is cheaper keeps the gap.

import type { VesselClass } from '../../model/shipping/vessels';
import { seaDistance } from './network';
import { AUX_PORT_TPD } from './propulsion';
import { COMMISSION, ballastDraft, fuelPerDay, ladenDraft } from './voyage';

export interface MarketShip {
  id: string;
  name: string;
  /** Where she becomes free. */
  at: string;
  /** Days until she is free there. */
  openIn: number;
}

export interface MarketCargo {
  id: string;
  /** The most the charterer will pay, $/t. */
  bid: number;
}

export interface LaneSpec {
  vessel: VesselClass;
  load: string;
  discharge: string;
  cargo: number;
  portDays: number;
  portCosts: number;
  ladenSpeed: number;
  ballastSpeed: number;
  bunker: number;
}

export interface Offer {
  ship: MarketShip;
  ballastNm: number;
  ballastDays: number;
  /** Days from now until the cargo is discharged. */
  days: number;
  /** Least acceptable freight, $/t. */
  reservation: number;
  /** Arrives within the loading window. */
  inWindow: boolean;
}

/**
 * A ship's reservation freight for the lane, given what a day of her time is worth elsewhere
 * (`alternative`, $/day): (fuel + port costs + days × alternative) ÷ (cargo × (1 − commission)).
 */
export function reservation(ship: MarketShip, lane: LaneSpec, alternative: number, windowDays = Infinity): Offer {
  const v = lane.vessel;
  const ballastNm = ship.at === lane.load ? 0 : seaDistance(ship.at, lane.load, { draft: ballastDraft(v) });
  const ladenNm = seaDistance(lane.load, lane.discharge, { draft: ladenDraft(v, lane.cargo) });
  const ballastDays = ballastNm / (24 * lane.ballastSpeed);
  const ladenDays = ladenNm / (24 * lane.ladenSpeed);
  const fuel =
    ballastDays * fuelPerDay(v, lane.ballastSpeed, ballastDraft(v)) + ladenDays * fuelPerDay(v, lane.ladenSpeed, ladenDraft(v, lane.cargo)) + lane.portDays * AUX_PORT_TPD;
  const days = ship.openIn + ballastDays + ladenDays + lane.portDays;
  // Waiting to become free costs her nothing here: she's busy until then.
  const cost = fuel * lane.bunker + lane.portCosts + (days - ship.openIn) * alternative;
  return {
    ship,
    ballastNm,
    ballastDays,
    days,
    reservation: cost / (lane.cargo * (1 - COMMISSION)),
    inWindow: ship.openIn + ballastDays <= windowDays + 1e-9,
  };
}

export interface Fixture {
  ship: Offer;
  cargo: MarketCargo;
}

export interface Clearing {
  /** Ship offers sorted from cheapest; only those that can make the window. */
  offers: Offer[];
  /** Cargo bids sorted from keenest. */
  bids: MarketCargo[];
  fixtures: Fixture[];
  /** The market rate, $/t (NaN if nothing trades). */
  rate: number;
  /** Bounds of the competitive range: no ship or cargo left out would want to deal inside it. */
  low: number;
  high: number;
}

/**
 * Uniform-price clearing: match the cheapest ships with the keenest cargoes while the ship's
 * reservation is at or below the cargo's bid. The rate is the bottom of the competitive range —
 * the dearer of the last ship fixed and the best cargo left unfixed (and in a slack market, the
 * cheapest ship left over sets it).
 */
export function clearMarket(offers: Offer[], cargoes: MarketCargo[]): Clearing {
  const o = offers.filter((x) => x.inWindow).sort((a, b) => a.reservation - b.reservation);
  const b = [...cargoes].sort((x, y) => y.bid - x.bid);
  let k = 0;
  while (k < o.length && k < b.length && o[k].reservation <= b[k].bid) k++;
  const fixtures = Array.from({ length: k }, (_, i) => ({ ship: o[i], cargo: b[i] }));
  if (k === 0) return { offers: o, bids: b, fixtures, rate: NaN, low: NaN, high: NaN };
  const low = Math.max(o[k - 1].reservation, b[k]?.bid ?? -Infinity);
  const high = Math.min(b[k - 1].bid, o[k]?.reservation ?? Infinity);
  return { offers: o, bids: b, fixtures, rate: low, low, high };
}

/** The TCE a ship earns on the lane at a freight rate, $/day (over the days from when she's free). */
export function tceAt(offer: Offer, lane: LaneSpec, freight: number, alternative: number): number {
  const atRes = offer.reservation;
  // Earnings above the reservation, spread over her working days, on top of the alternative.
  return alternative + ((freight - atRes) * lane.cargo * (1 - COMMISSION)) / (offer.days - offer.ship.openIn);
}
