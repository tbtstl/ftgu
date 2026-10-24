// The world corn market in round numbers: five producing and consuming regions, one world price,
// and the stocks the world carries from one harvest to the next. Quantities are million metric
// tonnes; the price is dollars a bushel for corn loaded at an export port (Port Sable, in this
// course). The price is whatever makes the year's supply — stocks carried in plus the harvest —
// equal to the year's use plus the stocks carried out.
//
// The regions are simplified from recent years of the real market. China's large state reserves
// rarely reach the world market, so the stocks here are the world's stocks outside China.

import { gaussian, rng } from '../../model/random';
import { valleySeason } from './valley';

export type RegionId = 'us' | 'southAmerica' | 'blackSea' | 'china' | 'importers';

export interface Region {
  id: RegionId;
  name: string;
  /** Production and use in a normal year at the base price, million tonnes. */
  production: number;
  use: number;
  /** How much use falls, in percent, for each 1% rise in the price. */
  elasticity: number;
  /** Year-to-year variability of the harvest (standard deviation of its percentage change). */
  cropSd: number;
}

export const REGIONS: Region[] = [
  { id: 'us', name: 'United States', production: 385, use: 320, elasticity: 0.12, cropSd: 0.066 },
  { id: 'southAmerica', name: 'Brazil and Argentina', production: 172, use: 97, elasticity: 0.15, cropSd: 0.09 },
  { id: 'blackSea', name: 'Ukraine and Russia', production: 49, use: 18, elasticity: 0.15, cropSd: 0.12 },
  { id: 'china', name: 'China', production: 290, use: 310, elasticity: 0.05, cropSd: 0.03 },
  { id: 'importers', name: 'Importing countries', production: 334, use: 485, elasticity: 0.2, cropSd: 0.04 },
];

export const REGION: Record<RegionId, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r])) as Record<RegionId, Region>;

/** The world price in a normal year, $ per bushel at an export port. */
export const BASE_PRICE = 5.6;
/** Bushels of corn in a metric tonne. */
export const BU_PER_TONNE = 39.368;
/** Stocks outside China carried into a normal year, and the least the world can run on (grain in transit and in mills' bins), million tonnes. */
export const BASE_STOCKS = 100;
export const PIPELINE = 40;
/** How strongly holders release stocks as the price rises: stocks held above the pipeline scale with (base price / price)^STOCK_RESPONSE. */
export const STOCK_RESPONSE = 1.5;

export interface WorldYear {
  /** Each region's harvest change, as a fraction (−0.2 = 20% short). */
  crop?: Partial<Record<RegionId, number>>;
  /** Each region's demand change at a given price, as a fraction. */
  demand?: Partial<Record<RegionId, number>>;
  /** Stocks outside China carried in, million tonnes. */
  carryIn?: number;
}

export interface Balance {
  price: number;
  regions: Array<{ id: RegionId; production: number; use: number; /** Production less use: exports if positive. */ net: number }>;
  production: number;
  use: number;
  carryIn: number;
  /** Stocks outside China carried out, million tonnes. */
  carryOut: number;
  /** Carry-out as a share of a year's use outside China. */
  stocksToUse: number;
  /** Total exports, million tonnes. */
  trade: number;
}

function useAt(r: Region, price: number, shift = 0): number {
  return r.use * (1 + shift) * Math.pow(price / BASE_PRICE, -r.elasticity);
}

/** Stocks the market chooses to carry out at a price, million tonnes. */
export function stocksAt(price: number): number {
  return PIPELINE + (BASE_STOCKS - PIPELINE) * Math.pow(BASE_PRICE / price, STOCK_RESPONSE);
}

/** Clears a year's world market. */
export function clearWorld(y: WorldYear = {}): Balance {
  const carryIn = y.carryIn ?? BASE_STOCKS;
  const prod = REGIONS.map((r) => r.production * (1 + (y.crop?.[r.id] ?? 0)));
  const supply = carryIn + prod.reduce((a, b) => a + b, 0);
  const excess = (p: number) => REGIONS.reduce((t, r) => t + useAt(r, p, y.demand?.[r.id]), 0) + stocksAt(p) - supply;
  let lo = 0.2;
  let hi = 200;
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi);
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  const price = Math.sqrt(lo * hi);
  const regions = REGIONS.map((r, i) => {
    const use = useAt(r, price, y.demand?.[r.id]);
    return { id: r.id, production: prod[i], use, net: prod[i] - use };
  });
  const use = regions.reduce((t, r) => t + r.use, 0);
  const carryOut = stocksAt(price);
  const useOutsideChina = regions.filter((r) => r.id !== 'china').reduce((t, r) => t + r.use, 0);
  // China's own reserves absorb its surplus or deficit only through trade, so its net is all trade.
  const trade = regions.reduce((t, r) => t + Math.max(0, r.net), 0);
  return { price, regions, production: supply - carryIn, use, carryIn, carryOut, stocksToUse: carryOut / useOutsideChina, trade };
}

/**
 * Just the clearing price, $ a bushel, by Newton's method on the log price — the same root as
 * clearWorld, faster, for computing many prices.
 */
export function worldPrice(crop: Partial<Record<RegionId, number>>, carryIn: number): number {
  let supply = carryIn;
  for (const r of REGIONS) supply += r.production * (1 + (crop[r.id] ?? 0));
  let x = 0; // log(price / BASE_PRICE)
  for (let i = 0; i < 40; i++) {
    let f = -supply;
    let df = 0;
    for (const r of REGIONS) {
      const u = r.use * Math.exp(-r.elasticity * x);
      f += u;
      df -= r.elasticity * u;
    }
    const k = (BASE_STOCKS - PIPELINE) * Math.exp(-STOCK_RESPONSE * x);
    f += PIPELINE + k;
    df -= STOCK_RESPONSE * k;
    const step = f / df;
    x -= Math.max(-0.5, Math.min(0.5, step));
    if (Math.abs(step) < 1e-12) break;
  }
  return BASE_PRICE * Math.exp(x);
}

/** The price at which the world would carry out a given stocks-to-use ratio, for drawing the curve. */
export function priceAtStocksToUse(su: number, y: WorldYear = {}): number {
  // Stocks-to-use pins stocks, which pins the price through stocksAt (use depends weakly on price; iterate).
  let p = BASE_PRICE;
  for (let i = 0; i < 30; i++) {
    const useOut = REGIONS.filter((r) => r.id !== 'china').reduce((t, r) => t + useAt(r, p, y.demand?.[r.id]), 0);
    const k = su * useOut;
    if (k <= PIPELINE) return Infinity;
    p = BASE_PRICE * Math.pow((k - PIPELINE) / (BASE_STOCKS - PIPELINE), -1 / STOCK_RESPONSE);
  }
  return p;
}

export interface HistoryYear extends Balance {
  year: number;
  crop: Record<RegionId, number>;
  /** The Crane Valley's corn that year, million bushels. */
  valleyCorn: number;
}

/** Mean valley corn over the 400 simulated seasons of Lesson 3.5, million bushels. */
let valleyMean: number | null = null;
export function meanValley(): number {
  if (valleyMean === null) {
    let t = 0;
    for (let y = 1; y <= 400; y++) t += valleySeason(y).corn / 1e6;
    valleyMean = t / 400;
  }
  return valleyMean;
}

/** How much of the valley's harvest surprise is shared by the whole U.S. crop. */
export const VALLEY_SHARE = 0.45;
/** The valley harvest's variability (its standard deviation as a share of the mean), rounded. */
export const VALLEY_SD = 0.125;
/** The variability of the rest of the U.S. crop, independent of the valley's. */
export const US_OWN_SD = Math.sqrt(Math.max(0, 0.066 ** 2 - (VALLEY_SHARE * VALLEY_SD) ** 2));

/**
 * A simulated history of the world market: each year's regional harvests vary at random — the
 * U.S. crop partly with the Crane Valley's own simulated season — and the stocks carried out of
 * one year are carried into the next.
 */
export function worldHistory(n: number, first = 1, seed = 2024): HistoryYear[] {
  const r = rng(seed);
  const mean = meanValley();
  const out: HistoryYear[] = [];
  let carryIn = BASE_STOCKS;
  for (let i = 0; i < n; i++) {
    const year = first + i;
    const valleyCorn = valleySeason(year).corn / 1e6;
    const crop = {} as Record<RegionId, number>;
    for (const reg of REGIONS) {
      const e = gaussian(r);
      if (reg.id === 'us') {
        const fromValley = VALLEY_SHARE * (valleyCorn / mean - 1);
        crop[reg.id] = fromValley + US_OWN_SD * e;
      } else crop[reg.id] = reg.cropSd * e;
    }
    const b = clearWorld({ crop, carryIn });
    out.push({ ...b, year, crop, valleyCorn });
    carryIn = b.carryOut;
  }
  return out;
}
