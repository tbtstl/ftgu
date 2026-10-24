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

/** MMBtu per tonne of LNG at the course's conversion (density about 0.45 t/m³). */
export const LNG_TONNE_DENSITY = 0.45;
export function mmbtuPerTonne(): number {
  return MMBTU_PER_M3_LNG / LNG_TONNE_DENSITY;
}
