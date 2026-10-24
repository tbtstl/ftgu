// Futures and basis prices in the region's simulated history.
//
// On the first day of every month the market draws a forward curve for the next twelve months.
// It starts from what is known that day — the gas in storage and the region's production,
// pipelines and LNG capacity as they stand — and solves the seasonal plan from there (the flow
// through space and time of Chapter 4), assuming normal weather and nothing changing. Then it
// adds a premium for what that plan leaves out: Lesson 4.5 showed that a cold spell raises prices
// more than a mild one lowers them, and the operators' plans run a little ahead of what their
// fields manage every autumn. The premium for each calendar month and each lead is set so that,
// over the eight years, the price was right on average: a contract bought at any lead and held to
// settlement neither made nor lost money overall, and every edge has to come from knowing which
// years it was wrong in.
//
// Contracts are named by an absolute month (0 = April of year 1). A Calder futures contract's
// final settlement is its price on the first day of its delivery month. A basis swap for a month
// settles against that month's average daily basis (the place's price less Calder's).

import { gasHistory, type HistoryYear } from '../../model/gas/history';
import { GAS_MONTH_START, GAS_YEAR_DAYS } from '../../model/gas/weather';
import type { GasNodeId } from '../../model/gas/world';
import type { StorageState } from './market';

/** Number of months in the history. */
export function historyMonths(): number {
  return gasHistory().length * 12;
}

/** Storage at the start of absolute month `month` of the history. */
function storageAt(h: HistoryYear[], month: number): StorageState {
  const y = Math.floor(month / 12);
  const m = month % 12;
  if (m === 0) return h[y].start;
  return h[y].days[GAS_MONTH_START[m] - 1].storage;
}

interface RawCurve {
  /** Normal-weather plan prices for the 12 months from `month`, by node. */
  price: Record<GasNodeId, number[]>;
  start: StorageState;
}

/** The seasonal plan the market drew on the first day of absolute month `month`, before any premium. */
function rawCurve(month: number): RawCurve {
  const h = gasHistory();
  const y = Math.floor(month / 12);
  const m = month % 12;
  return { price: h[y].plans[m].price, start: storageAt(h, month) };
}

const avgCache = new Map<string, number>();

/** The realized average daily price in absolute month `month` at a place (or a basis if `minus` is given). */
export function monthAverage(month: number, place: GasNodeId, minus?: GasNodeId): number {
  const key = `${month}|${place}|${minus ?? ''}`;
  const hit = avgCache.get(key);
  if (hit !== undefined) return hit;
  const h = gasHistory();
  const y = Math.floor(month / 12);
  const m = month % 12;
  const days = h[y].days.slice(GAS_MONTH_START[m], m < 11 ? GAS_MONTH_START[m + 1] : GAS_YEAR_DAYS);
  const v = days.reduce((s, d) => s + d.price[place] - (minus ? d.price[minus] : 0), 0) / days.length;
  avgCache.set(key, v);
  return v;
}

export interface Premiums {
  /** ratio[lead][calendar month]: what multiplies the plan's Calder price (lead 0 = the prompt month on its first day). */
  ratio: number[][];
  /** metroBasis[lead][calendar month]: what is added to the plan's Metro basis, $/MMBtu. */
  metroBasis: number[][];
}

let premiumCache: Premiums | null = null;

/**
 * The market's premiums, one for each lead and calendar month, fitted to the history so that
 * prices were right on average. The prompt month's Calder price is right on average against the
 * month's realized average price; at longer leads a contract's price is right on average against
 * its final settlement. Metro's basis forwards are right on average against realized basis.
 * Ridgeback's basis gets no premium: the market prices it from the region as it stands.
 */
export function premiums(): Premiums {
  if (premiumCache) return premiumCache;
  const N = historyMonths();
  const ratio: number[][] = [];
  const metroBasis: number[][] = [];
  const settle = (d: number) => rawCurve(d).price.calder[0] * ratio[0][d % 12];
  for (let lead = 0; lead < 12; lead++) {
    const r = Array<number>(12).fill(1);
    const b = Array<number>(12).fill(0);
    for (let cal = 0; cal < 12; cal++) {
      let target = 0;
      let raw = 0;
      let basis = 0;
      let n = 0;
      for (let d = cal; d < N; d += 12) {
        if (d - lead < 0) continue;
        const rc = rawCurve(d - lead);
        raw += rc.price.calder[lead];
        target += lead === 0 ? monthAverage(d, 'calder') : settle(d);
        basis += monthAverage(d, 'metro', 'calder') - (rc.price.metro[lead] - rc.price.calder[lead]);
        n++;
      }
      if (n) {
        r[cal] = target / raw;
        b[cal] = basis / n;
      }
    }
    ratio.push(r);
    metroBasis.push(b);
  }
  premiumCache = { ratio, metroBasis };
  return premiumCache;
}

export interface CurveObservation {
  /** Absolute month the curve was drawn on (its first day), 0 = April of year 1. */
  month: number;
  year: number;
  /** Day index into the whole history. */
  t: number;
  /** Futures prices for the next 12 delivery months at Calder, indexed by absolute month. */
  calder: Record<number, number>;
  /** Basis forwards (place − Calder) at Metro and Ridgeback for the same months. */
  metroBasis: Record<number, number>;
  ridgebackBasis: Record<number, number>;
  /** Working gas that day, Bcf, and the year's plan for that day. */
  storage: number;
  planned: number;
}

const obsCache = new Map<number, CurveObservation>();

/** The forward curve drawn on the first day of absolute month `month` (cached). */
export function curveAt(month: number): CurveObservation {
  let o = obsCache.get(month);
  if (o) return o;
  const h = gasHistory();
  const y = Math.floor(month / 12);
  const m = month % 12;
  const year = h[y];
  const raw = rawCurve(month);
  const prem = premiums();
  const calder: Record<number, number> = {};
  const metroBasis: Record<number, number> = {};
  const ridgebackBasis: Record<number, number> = {};
  for (let k = 0; k < 12; k++) {
    const abs = month + k;
    const cal = (m + k) % 12;
    const at = (n: GasNodeId) => raw.price[n][k];
    calder[abs] = at('calder') * prem.ratio[k][cal];
    metroBasis[abs] = at('metro') - at('calder') + prem.metroBasis[k][cal];
    ridgebackBasis[abs] = at('ridgeback') - at('calder');
  }
  o = {
    month,
    year: y,
    t: y * GAS_YEAR_DAYS + GAS_MONTH_START[m],
    calder,
    metroBasis,
    ridgebackBasis,
    storage: raw.start.saltflat + raw.start.hollowcreek,
    planned: year.plan.inventory.saltflat[m] + year.plan.inventory.hollowcreek[m],
  };
  obsCache.set(month, o);
  return o;
}

/** A contract's final settlement price: its price on the first day of its delivery month. */
export function settlement(delivery: number): number {
  return curveAt(delivery).calder[delivery];
}

/**
 * A contract's price path: its futures price on the first day of each month from `from` until
 * its final settlement (the first day of its delivery month). Months before the curve reaches it
 * (more than 11 months ahead) are skipped.
 */
export function contractPath(delivery: number, from = 0): Array<{ month: number; price: number }> {
  const out: Array<{ month: number; price: number }> = [];
  for (let m = Math.max(from, delivery - 11, 0); m <= delivery; m++) out.push({ month: m, price: curveAt(m).calder[delivery] });
  return out;
}

const MONTH_ABBR = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** "Jan Y3": the label of an absolute month (January of year 3 belongs to gas year 3, which began the April before). */
export function monthLabel(month: number): string {
  return `${MONTH_ABBR[month % 12]} Y${Math.floor(month / 12) + 1}`;
}
