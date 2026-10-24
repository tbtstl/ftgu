// The LNG chain: liquefy gas at an export terminal, ship it, and turn it back into gas at the
// other end. Every step costs money and burns some of the gas.
//
// Energy flows (MMBtu): feed gas F enters the liquefaction plant, which burns a share of it to
// run its refrigeration compressors, so F·(1 − liquefactionLoss) is loaded as LNG. On the laden
// voyage a little of the cargo boils off each day (the ship burns it as fuel), and the import
// terminal burns a little more to warm the LNG back into gas. The rest is sent out into the
// destination's pipelines.
//
// Money: the cargo's buyer pays the export terminal, for every MMBtu loaded, a multiple of the hub
// price (the extra covers the gas the plant burns) plus a fixed liquefaction fee; then pays for
// the ship's time and any canal tolls, and the import terminal's fee per MMBtu sent out.

import { gaussian, rng } from '../../model/random';

/** Gas burned to liquefy, as a share of the feed gas. */
export const LIQUEFACTION_LOSS = 0.1;
/** Share of the cargo that boils off each day at sea. */
export const BOIL_OFF_PER_DAY = 0.001;
/** Share of the LNG burned to regasify it. */
export const REGAS_LOSS = 0.015;
/** MMBtu in a cubic meter of LNG (about 600 m³ of gas at standard conditions). */
export const MMBTU_PER_M3_LNG = 22.5;
/** Cubic meters of gas at standard conditions per cubic meter of LNG. */
export const GAS_M3_PER_LNG_M3 = 600;
/** A standard large carrier: 174,000 m³, of which about 170,000 is loaded (some stays behind to keep the tanks cold). */
export const SHIP_LOADED_M3 = 170_000;
/** Days in port at each end, loading and unloading. */
export const PORT_DAYS = 2;

export interface LngVoyage {
  /** Hub price where the feed gas is bought, $/MMBtu. */
  hubPrice: number;
  /** Each MMBtu loaded is priced at this multiple of the hub price (the extra covers liquefaction fuel). */
  feedMultiplier: number;
  /** Fixed liquefaction fee per MMBtu loaded, $. */
  liquefactionFee: number;
  /** One-way laden voyage, days. */
  ladenDays: number;
  /** Ship charter rate, $/day. */
  charterPerDay: number;
  /** Canal toll or other per-voyage fees, $. */
  voyageFees: number;
  /** Regasification fee per MMBtu sent out, $. */
  regasFee: number;
}

export interface LngCargo {
  /** MMBtu at each stage. */
  feed: number;
  loaded: number;
  delivered: number;
  sentOut: number;
  /** Losses at each stage, MMBtu. */
  liquefactionFuel: number;
  boilOff: number;
  regasFuel: number;
  /** Days the ship is tied up for the round trip, including port time. */
  roundTripDays: number;
  /** Costs of the cargo, $. */
  costs: { feed: number; liquefaction: number; shipping: number; regas: number };
  /** Cost per MMBtu sent out at each stage, $/MMBtu, cumulative. */
  perMMBtu: { feed: number; liquefaction: number; shipping: number; regas: number };
  /** Total delivered cost per MMBtu sent out. */
  delivered$: number;
}

/** One cargo through the chain: a full ship loaded at the export terminal. */
export function lngCargo(v: LngVoyage, loadedM3 = SHIP_LOADED_M3): LngCargo {
  const loaded = loadedM3 * MMBTU_PER_M3_LNG;
  const feed = loaded / (1 - LIQUEFACTION_LOSS);
  const delivered = loaded * Math.pow(1 - BOIL_OFF_PER_DAY, v.ladenDays);
  const sentOut = delivered * (1 - REGAS_LOSS);
  const roundTripDays = 2 * v.ladenDays + 2 * PORT_DAYS;
  const costs = {
    feed: loaded * v.hubPrice * v.feedMultiplier,
    liquefaction: loaded * v.liquefactionFee,
    shipping: roundTripDays * v.charterPerDay + v.voyageFees,
    regas: sentOut * v.regasFee,
  };
  const per = (x: number) => x / sentOut;
  const perMMBtu = {
    feed: per(costs.feed),
    liquefaction: per(costs.liquefaction),
    shipping: per(costs.shipping),
    regas: per(costs.regas),
  };
  return {
    feed,
    loaded,
    delivered,
    sentOut,
    liquefactionFuel: feed - loaded,
    boilOff: loaded - delivered,
    regasFuel: delivered - sentOut,
    roundTripDays,
    costs,
    perMMBtu,
    delivered$: perMMBtu.feed + perMMBtu.liquefaction + perMMBtu.shipping + perMMBtu.regas,
  };
}

/**
 * The netback: what a cargo sold at `destPrice` returns per MMBtu loaded once shipping and
 * regasification are paid — the most the buyer could pay at the export terminal and break even.
 */
export function netback(v: LngVoyage, destPrice: number, loadedM3 = SHIP_LOADED_M3): number {
  const c = lngCargo(v, loadedM3);
  return (destPrice * c.sentOut - c.costs.shipping - c.costs.regas) / c.loaded;
}

/** The hub price at which a cargo sold at `destPrice` exactly breaks even, every cost counted. */
export function breakevenHub(v: LngVoyage, destPrice: number, loadedM3 = SHIP_LOADED_M3): number {
  return (netback(v, destPrice, loadedM3) - v.liquefactionFee) / v.feedMultiplier;
}

/** Profit (or loss) on one cargo sold at `destPrice`, $, counting every cost. */
export function cargoMargin(v: LngVoyage, destPrice: number, loadedM3 = SHIP_LOADED_M3): number {
  const c = lngCargo(v, loadedM3);
  return destPrice * c.sentOut - c.costs.feed - c.costs.liquefaction - c.costs.shipping - c.costs.regas;
}

export interface CargoChoice {
  /** Netback per MMBtu loaded from each destination. */
  netback: { europe: number; asia: number };
  /** The better destination. */
  best: 'europe' | 'asia';
  /** What the buyer pays for each MMBtu loaded: the multiple of the hub price, plus the fee. */
  fob: number;
  /** Margin per MMBtu loaded at the better destination, counting the fee. */
  margin: number;
  /** Margin per MMBtu loaded counting only the costs still avoidable once the fee is owed regardless. */
  marginFeeSunk: number;
  /** True when even the better destination doesn't cover the avoidable costs: the cargo is cancelled. */
  cancel: boolean;
}

/**
 * Where a cargo should go, and whether it should go at all. Once a buyer has signed for the
 * liquefaction fee, the fee is owed whether the cargo sails or not, so the cargo sails as long as
 * the netback covers the feed gas (`feedMultiplier` × hub); it's cancelled only when it doesn't.
 */
export function cargoChoice(
  hub: number,
  prices: { europe: number; asia: number },
  terms: { feedMultiplier: number; liquefactionFee: number; regasFee: number; charterPerDay: number; destinations: Record<'europe' | 'asia', { ladenDays: number; voyageFees: number }> },
): CargoChoice {
  const voyage = (d: 'europe' | 'asia'): LngVoyage => ({
    hubPrice: hub,
    feedMultiplier: terms.feedMultiplier,
    liquefactionFee: terms.liquefactionFee,
    ladenDays: terms.destinations[d].ladenDays,
    charterPerDay: terms.charterPerDay,
    voyageFees: terms.destinations[d].voyageFees,
    regasFee: terms.regasFee,
  });
  const nb = { europe: netback(voyage('europe'), prices.europe), asia: netback(voyage('asia'), prices.asia) };
  const best = nb.asia > nb.europe ? 'asia' : 'europe';
  const feed = terms.feedMultiplier * hub;
  const fob = feed + terms.liquefactionFee;
  const marginFeeSunk = nb[best] - feed;
  return { netback: nb, best, fob, margin: nb[best] - fob, marginFeeSunk, cancel: marginFeeSunk < 0 };
}

/**
 * Simulated monthly gas prices at two overseas markets ($/MMBtu), month 0 a January: a level, a
 * winter peak, and persistent shocks (shared in part, since the two markets compete for the same
 * cargoes). Seeded, so a path is the same on every visit.
 */
export function overseasPrices(seed: number, months: number, opts: { europe?: number; asia?: number; volatility?: number } = {}): { europe: number[]; asia: number[] } {
  const r = rng(seed);
  const vol = opts.volatility ?? 0.12;
  const eu: number[] = [];
  const as: number[] = [];
  let common = 0;
  let euOwn = 0;
  let asOwn = 0;
  for (let m = 0; m < months; m++) {
    common = 0.8 * common + vol * gaussian(r);
    euOwn = 0.6 * euOwn + vol * 0.6 * gaussian(r);
    asOwn = 0.6 * asOwn + vol * 0.6 * gaussian(r);
    const season = Math.cos((2 * Math.PI * (m % 12)) / 12);
    eu.push((opts.europe ?? 9) * Math.exp(common + euOwn + 0.12 * season));
    as.push((opts.asia ?? 10.5) * Math.exp(common + asOwn + 0.15 * season));
  }
  return { europe: eu, asia: as };
}

/** MMBtu per tonne of LNG at the course's conversion (density about 0.45 t/m³). */
export const LNG_TONNE_DENSITY = 0.45;
export function mmbtuPerTonne(): number {
  return MMBTU_PER_M3_LNG / LNG_TONNE_DENSITY;
}
