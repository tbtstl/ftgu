// Cedar Bend's marketing program, tested over the simulated market history: sell some of the
// expected crop in December futures, or buy December puts, early in the year; sell the actual crop
// at Fairview at harvest; close the hedge the same day. Every cost a real hedger pays is counted —
// commissions and slippage, interest on margin, the option premium and its bid–ask spread — and a
// walk-forward test chooses the hedge using only the years before each one.

import { PLAINS_IRRIGATION, fieldSeason, type FieldSpec } from './farm';
import { EXPIRY, INTEREST, MARKET_YEARS, black76, cashBid, decFutures, decVolatility } from './market';
import { CEDAR_BEND, dayOf } from '../../model/agriculture/region';

export type Instrument = 'none' | 'futures' | 'puts';
/** Cedar Bend as it is, or with center pivots watering its corn like the High Plains' irrigated fields. */
export type Farm = 'dryland' | 'irrigated';

function spec(farm: Farm): FieldSpec {
  return { district: CEDAR_BEND.district, crop: 'corn', irrigation: farm === 'irrigated' ? PLAINS_IRRIGATION : null };
}

/** When the hedge is placed, and when the crop is sold and the hedge closed. */
export const HEDGE_DAY = dayOf(3, 1);
export const SELL_DAY = dayOf(10, 15);

/** Costs, $ a bushel unless noted (simulated, close to what a farm pays through a broker). */
export const COSTS = {
  /** Commission, exchange fees and slippage on a futures round trip: about $50 a contract. */
  futuresRoundTrip: 0.01,
  /** Initial margin, as a share of the contract's value, financed at the interest rate. */
  initialMargin: 0.06,
  /** Half the bid–ask spread on an option, paid when buying and again when selling, plus commission. */
  optionHalfSpread: 0.01,
  optionCommission: 0.005,
};

const expected = new Map<Farm, number>();
/** Cedar Bend's average corn yield over 400 simulated seasons, bushels an acre: what it hedges against. */
export function expectedYield(farm: Farm = 'dryland'): number {
  let e = expected.get(farm);
  if (e === undefined) {
    let t = 0;
    for (let y = 1; y <= 400; y++) t += fieldSeason(y, spec(farm)).yield;
    e = t / 400;
    expected.set(farm, e);
  }
  return e;
}

export interface Season {
  year: number;
  farm: Farm;
  /** Cedar Bend's corn yield, bushels an acre, and Fairview's bid at harvest. */
  yield: number;
  cash: number;
  /** December futures when the hedge is placed and when it is closed. */
  f0: number;
  f1: number;
  /** An at-the-money December put: its price when bought and when sold, and the volatility it was bought at. */
  put0: number;
  put1: number;
  vol: number;
  /** Interest paid on margin over the hedge, per bushel hedged. */
  marginInterest: number;
}

const seasonCache = new Map<string, Season>();
export function season(year: number, farm: Farm = 'dryland'): Season {
  const key = `${year}|${farm}`;
  let s = seasonCache.get(key);
  if (!s) {
    const f0 = decFutures(year, HEDGE_DAY);
    const f1 = decFutures(year, SELL_DAY);
    const vol = decVolatility(year, HEDGE_DAY);
    const put0 = black76('put', f0, f0, vol, (EXPIRY.Dec - HEDGE_DAY) / 365);
    const put1 = black76('put', f1, f0, decVolatility(year, SELL_DAY), (EXPIRY.Dec - SELL_DAY) / 365);
    let interest = COSTS.initialMargin * f0 * INTEREST * ((SELL_DAY - HEDGE_DAY) / 365);
    for (let t = HEDGE_DAY; t < SELL_DAY; t += 3) interest += Math.max(0, decFutures(year, t) - f0) * INTEREST * (3 / 365);
    s = {
      year,
      farm,
      yield: fieldSeason(year, spec(farm)).yield,
      cash: cashBid(year, 'fairview', SELL_DAY),
      f0,
      f1,
      put0,
      put1,
      vol,
      marginInterest: interest,
    };
    seasonCache.set(key, s);
  }
  return s;
}

/** The hedge's gain per bushel hedged, after costs if `costs` is set. */
export function hedgeGain(s: Season, kind: Instrument, costs = true): number {
  if (kind === 'futures') return s.f0 - s.f1 - (costs ? COSTS.futuresRoundTrip + s.marginInterest : 0);
  if (kind === 'puts') {
    const fees = costs ? 2 * COSTS.optionHalfSpread + 2 * COSTS.optionCommission + s.put0 * INTEREST * ((SELL_DAY - HEDGE_DAY) / 365) : 0;
    return s.put1 - s.put0 - fees;
  }
  return 0;
}

/** Revenue per acre: the crop sold at harvest plus the hedge on `ratio` of the expected crop. */
export function revenue(s: Season, kind: Instrument, ratio: number, costs = true): number {
  return s.yield * s.cash + (kind === 'none' ? 0 : ratio * expectedYield(s.farm) * hedgeGain(s, kind, costs));
}

export interface Summary {
  mean: number;
  sd: number;
  worst: number;
  /** The tenth-worst-percent year. */
  p10: number;
}

export function summarize(xs: number[]): Summary {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const s = [...xs].sort((a, b) => a - b);
  return { mean, sd, worst: s[0], p10: s[Math.floor(0.1 * s.length)] };
}

export const RATIOS = Array.from({ length: 16 }, (_, i) => i / 10);

/** The ratio, in tenths from 0 to 1.5, that made revenue least variable over a set of seasons. */
export function bestRatio(seasons: Season[], kind: Instrument, costs = true): number {
  let best = 0;
  let bestSd = Infinity;
  for (const r of RATIOS) {
    const sd = summarize(seasons.map((s) => revenue(s, kind, r, costs))).sd;
    if (sd < bestSd - 1e-9) {
      bestSd = sd;
      best = r;
    }
  }
  return best;
}

export function allSeasons(farm: Farm = 'dryland'): Season[] {
  return Array.from({ length: MARKET_YEARS }, (_, i) => season(i + 1, farm));
}

/** The first year a walk-forward test trades: it needs ten years of history to choose from. */
export const FIRST_TEST_YEAR = 11;

export interface WalkForward {
  years: number[];
  ratios: number[];
  revenues: number[];
}

/** Each year from FIRST_TEST_YEAR on, hedge at the ratio that was best over the previous `lookback` years. */
export function walkForward(kind: Instrument, lookback: number, costs = true, farm: Farm = 'dryland'): WalkForward {
  const all = allSeasons(farm);
  const years: number[] = [];
  const ratios: number[] = [];
  const revenues: number[] = [];
  for (let i = FIRST_TEST_YEAR - 1; i < all.length; i++) {
    const r = bestRatio(all.slice(Math.max(0, i - lookback), i), kind, costs);
    years.push(i + 1);
    ratios.push(r);
    revenues.push(revenue(all[i], kind, r, costs));
  }
  return { years, ratios, revenues };
}
