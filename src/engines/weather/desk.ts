// The capstone's trading desk for one winter: a blotter of the seasonal HDD strip and the
// monthly futures, each priced by our forecast against the simulated market, and the whole book
// — the business, its hedge and the desk's trades — as a distribution of outcomes once its last
// position is on. Every decision uses only what was known on its date; the distribution is
// sampled by simulating the pieces of weather information still to be revealed, as pricing.ts
// does, but day by day across the whole season so the strip and the months share each path.

import { gaussian, rng } from '../../model/random';
import {
  LEAD_MAX,
  SAME_DAY_CORRELATION,
  YEARS,
  archive,
  climateFor,
  dayInfo,
  expectedTemp,
  monthDays,
  ninoAt,
  ninoForecast,
  revealedShare,
  tempF,
  type WorldKnobs,
} from '../../model/weather/archive';
import { ENSO_MONTH_WEIGHT, anomalySd } from '../../model/weather/region';
import { ENSO_DEFAULTS } from './enso';
import { CITY_WIND_SHARE, UTILITY, hdd } from './degreeDays';
import { farmYears, utilityWinter, utilityWinters, windYears } from './exposure';
import { expectedIndex, marketQuote, type MarketModel } from './market';
import { CME_TICK, contractSpan, monthContract, quantile, type ContractSpec } from './pricing';
import { SEASON_STRIP } from './portfolio';

/** The desk's contracts: the November–March strip and the three winter months' futures. */
export type DeskContractId = 'strip' | 'dec' | 'jan' | 'feb';
export const DESK_CONTRACTS: DeskContractId[] = ['strip', 'dec', 'jan', 'feb'];
export const DESK_MONTH: Record<Exclude<DeskContractId, 'strip'>, number> = { dec: 11, jan: 0, feb: 1 };
export const DESK_LABEL: Record<DeskContractId, string> = {
  strip: 'Nov–Mar strip',
  dec: 'December',
  jan: 'January',
  feb: 'February',
};

/** The contract and its contract year for winter w (November of year w). */
export function deskContract(id: DeskContractId, winter: number): { spec: ContractSpec; year: number } {
  if (id === 'strip') return { spec: SEASON_STRIP, year: winter };
  const m = DESK_MONTH[id];
  return { spec: monthContract('HDD', m), year: m >= 10 ? winter : winter + 1 };
}

/** The contract id of a month (0, 1, 11), if the desk lists it. */
export function contractOfMonth(m: number): Exclude<DeskContractId, 'strip'> | null {
  return m === 11 ? 'dec' : m === 0 ? 'jan' : m === 1 ? 'feb' : null;
}

/** November 1 of winter w, as an archive day. */
export function novemberFirst(winter: number): number {
  return monthDays(winter, 10).start;
}

export interface BlotterRow {
  id: DeskContractId;
  /** 'open' before the period, 'running' during it, 'settled' after. */
  status: 'open' | 'running' | 'settled';
  bid: number;
  ask: number;
  mid: number;
  /** Our expected index. */
  fair: number;
  /** The index if settled (or, while running, settled so far). */
  settled: number;
  /** Our expected index minus the market's mid, index points. */
  gap: number;
  /** Of the gap: what pricing ENSO would close, and what fresh forecasts would close. */
  ensoPart: number;
  lagPart: number;
  /** Gap beyond the half-spread, index points (negative = not worth crossing the spread). */
  edge: number;
  /** +1 buy, −1 sell, 0 no trade, at the desk's threshold. */
  side: 1 | -1 | 0;
}

/** One contract's line on the blotter at the end of `day`. */
export function blotterRow(id: DeskContractId, winter: number, day: number, m: MarketModel, knobs: WorldKnobs, threshold: number): BlotterRow {
  const { spec, year } = deskContract(id, winter);
  const { start, end } = contractSpan(spec, year);
  let settled = 0;
  for (let d = start; d <= Math.min(end, day); d++) settled += hdd(tempF('fenwick', d, knobs));
  const status = day < start ? 'open' : day >= end ? 'settled' : 'running';
  const q = marketQuote(spec, year, day, m, knobs);
  const fair = expectedIndex(spec, year, day, { knobs });
  const gap = fair - q.mid - m.premium;
  // Split the gap: the part our view of the Pacific adds (if the market ignores it), and the rest,
  // which comes from the market's older information.
  const ensoPart = m.usesEnso ? 0 : fair - expectedIndex(spec, year, day, { knobs, ignoreEnso: true });
  const edge = Math.abs(fair - q.mid) - m.halfSpread;
  const side = status === 'settled' ? 0 : fair - q.ask > threshold ? 1 : q.bid - fair > threshold ? -1 : 0;
  return {
    id,
    status,
    bid: q.bid,
    ask: q.ask,
    mid: q.mid,
    fair,
    settled,
    gap: fair - q.mid,
    ensoPart,
    lagPart: gap - ensoPart,
    edge,
    side,
  };
}

// ---------------------------------------------------------------------------
// The winter as simulated paths.

const ROOT = Array.from({ length: LEAD_MAX + 1 }, (_, k) => Math.sqrt(revealedShare(k)));

function hashSeed(a: number, b: number): number {
  let h = (a * 0x9e3779b1) ^ (b * 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface WinterPaths {
  /** Season HDD (November–March) on each path. */
  season: Float64Array;
  /** Each winter month's HDD on each path, by month (10, 11, 0, 1, 2). */
  byMonth: Map<number, Float64Array>;
  /** Heating degree days still to come on each path. */
  futureHdd: Float64Array;
  /** The utility's gas sent out so far, MMBtu, and the HDD settled so far. */
  realizedVolume: number;
  realizedHdd: number;
  futureDays: number;
}

/** The archive's average city wind over the heating season, m/s (a climate constant). */
let seasonWind: number | null = null;
export function seasonCityWind(): number {
  if (seasonWind !== null) return seasonWind;
  const a = archive();
  let s = 0;
  let n = 0;
  for (let w = 1; w < YEARS; w++) {
    const { start, end } = contractSpan(SEASON_STRIP, w);
    for (let d = start; d <= end; d++) {
      s += CITY_WIND_SHARE * a.wind[d];
      n++;
    }
  }
  seasonWind = s / n;
  return seasonWind;
}

/**
 * Simulate the rest of winter w as known at the end of `day`: settled days from the archive,
 * later days from the forecast issued that day (only what was revealed by then) and the climate,
 * with the pieces still to come drawn path by path.
 */
export function winterPaths(winter: number, day: number, knobs: WorldKnobs, paths = 400): WinterPaths {
  const key = `${winter}|${day}|${paths}|${JSON.stringify(knobs)}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  const v = simulateWinter(winter, day, knobs, paths);
  if (pathCache.size > 40) pathCache.clear();
  pathCache.set(key, v);
  return v;
}

const pathCache = new Map<string, WinterPaths>();

function simulateWinter(winter: number, day: number, knobs: WorldKnobs, paths: number): WinterPaths {
  const a = archive();
  const cl = climateFor('fenwick', knobs);
  const H = LEAD_MAX;
  const rho = SAME_DAY_CORRELATION;
  const { start, end } = contractSpan(SEASON_STRIP, winter);
  const ensoF = knobs.ensoF ?? cl.ensoF;
  const variability = knobs.variability ?? 1;
  const months = [10, 11, 0, 1, 2];
  const byMonth = new Map<number, Float64Array>(months.map((m) => [m, new Float64Array(paths)]));
  let realizedHdd = 0;
  let realizedVolume = 0;
  const realizedByMonth = new Map<number, number>(months.map((m) => [m, 0]));
  for (let d = start; d <= Math.min(end, day); d++) {
    const h = hdd(tempF('fenwick', d, knobs));
    realizedHdd += h;
    const wind = CITY_WIND_SHARE * a.wind[d];
    realizedVolume += UTILITY.baseLoad + UTILITY.perHdd * h * (1 + UTILITY.perWindMs * (wind - UTILITY.meanWind));
    const m = dayInfo(d).month;
    realizedByMonth.set(m, (realizedByMonth.get(m) ?? 0) + h);
  }
  const first = Math.max(start, day + 1);
  const n = end >= first ? end - first + 1 : 0;
  const mu = new Float64Array(n);
  const sd = new Float64Array(n);
  const known = new Float64Array(n);
  const ensoW = new Float64Array(n);
  const monthKey = new Int32Array(n);
  const monthOf = new Int32Array(n);
  const issueInfo = dayInfo(Math.max(0, day));
  for (let i = 0; i < n; i++) {
    const d = first + i;
    const info = dayInfo(d);
    const lead = d - day;
    known[i] = lead <= H ? a.known[d * (H + 2) + lead] : 0;
    sd[i] = anomalySd(cl, info.doy) * variability;
    const ahead = (info.year - issueInfo.year) * 12 + (info.month - issueInfo.month);
    const nino = ahead <= 0 ? ninoAt(Math.max(0, day)) : ninoForecast(issueInfo.year, issueInfo.month, ahead);
    ensoW[i] = ensoF * ENSO_MONTH_WEIGHT[info.month];
    mu[i] = expectedTemp('fenwick', d, knobs) + ensoW[i] * nino;
    monthKey[i] = Math.max(0, ahead);
    monthOf[i] = info.month;
  }
  const maxAhead = n ? monthKey[n - 1] + 1 : 0;
  const season = new Float64Array(paths);
  const futureHdd = new Float64Array(paths);
  const zsim = new Float64Array(n);
  const e = new Float64Array(H + 1);
  const dev = new Float64Array(maxAhead + 1);
  for (let p = 0; p < paths; p++) {
    zsim.fill(0);
    for (let tp = Math.max(day + 1, first - H); tp <= end; tp++) {
      const r = rng(hashSeed(p, tp + 1_000_000));
      e[0] = gaussian(r);
      for (let k = 1; k <= H; k++) e[k] = rho * e[k - 1] + Math.sqrt(1 - rho * rho) * gaussian(r);
      for (let k = 0; k <= H; k++) {
        const d = tp + k;
        if (d >= first && d <= end) zsim[d - first] += ROOT[k] * e[k];
      }
    }
    dev.fill(0);
    if (maxAhead > 0) {
      const r = rng(hashSeed(p, day + 2_000_000));
      let x = 0;
      for (let m = 1; m <= maxAhead; m++) {
        x = (1 + ENSO_DEFAULTS.coupling) * x + ENSO_DEFAULTS.noise * gaussian(r);
        dev[m] = x;
      }
    }
    for (const m of months) byMonth.get(m)![p] = realizedByMonth.get(m) ?? 0;
    let fut = 0;
    for (let i = 0; i < n; i++) {
      const h = hdd(mu[i] + sd[i] * (known[i] + zsim[i]) + ensoW[i] * dev[monthKey[i]]);
      fut += h;
      byMonth.get(monthOf[i])![p] += h;
    }
    futureHdd[p] = fut;
    season[p] = realizedHdd + fut;
  }
  return { season, byMonth, futureHdd, realizedVolume, realizedHdd, futureDays: n };
}

// ---------------------------------------------------------------------------
// The book for one winter.

export interface DeskBook {
  /** Seasonal strips sold on October 31 to hedge the business. */
  hedgeStrips: number;
  /** Months traded: 11 (December), 0 (January), 1 (February). */
  months: number[];
  /** Days before each month the trade is decided. */
  lead: number;
  threshold: number;
  size: number;
}

export interface DeskTrade {
  id: Exclude<DeskContractId, 'strip'>;
  day: number;
  side: 1 | -1 | 0;
  price: number;
  fair: number;
}

export type DeskBusiness = 'utility' | 'wind' | 'farm';

export interface BookOutcome {
  /** The day the last position went on: the book's point of view. */
  viewDay: number;
  hedgePrice: number;
  trades: DeskTrade[];
  /** Total P&L on each path, sorted, $. */
  totals: Float64Array;
  /** The business's result alone on each path, sorted, $. */
  business: Float64Array;
  mean: number;
  sd: number;
  /** 5th percentile: the 1-in-20 result, $. */
  p5: number;
  /** The business's part alone (unhedged): mean and 1-in-20. */
  businessMean: number;
  businessP5: number;
  /** What actually happened, $ (business + hedge + trades). */
  actual: number;
}

const budgetCache = new Map<string, number>();
function businessBudget(kind: DeskBusiness, knobs: WorldKnobs): number {
  const key = kind + JSON.stringify(knobs);
  let v = budgetCache.get(key);
  if (v === undefined) {
    if (kind === 'utility') {
      const ws = utilityWinters(knobs);
      v = ws.reduce((s, w) => s + w.margin, 0) / ws.length;
    } else if (kind === 'wind') {
      const ys = windYears();
      v = ys.reduce((s, y) => s + y.revenue, 0) / ys.length;
    } else {
      const ys = farmYears(0.02, knobs);
      v = ys.reduce((s, y) => s + y.profit, 0) / ys.length;
    }
    if (budgetCache.size > 50) budgetCache.clear();
    budgetCache.set(key, v);
  }
  return v;
}

/** The desk's decisions for winter w, each on its own date with what was known then. */
export function deskTrades(winter: number, book: DeskBook, m: MarketModel, knobs: WorldKnobs): DeskTrade[] {
  const out: DeskTrade[] = [];
  for (const month of book.months) {
    const id = contractOfMonth(month);
    if (!id) continue;
    const { spec, year } = deskContract(id, winter);
    const { start } = contractSpan(spec, year);
    const day = start - book.lead;
    const q = marketQuote(spec, year, day, m, knobs);
    const fair = expectedIndex(spec, year, day, { knobs });
    let side: 1 | -1 | 0 = 0;
    let price = q.mid;
    if (book.size > 0 && fair - q.ask > book.threshold) {
      side = 1;
      price = q.ask;
    } else if (book.size > 0 && q.bid - fair > book.threshold) {
      side = -1;
      price = q.bid;
    }
    out.push({ id, day, side, price, fair });
  }
  return out;
}

/** Everything about the winter's book except the hedge's size: computed once, hedged at any size. */
export interface BookBase {
  viewDay: number;
  hedgePrice: number;
  trades: DeskTrade[];
  /** On each path: the business's result against its average, and the trades' P&L, $. */
  business: Float64Array;
  trading: Float64Array;
  /** Season HDD on each path. */
  season: Float64Array;
  /** What happened: the business, the trades and the season's index. */
  actualBusiness: number;
  actualTrading: number;
  actualSeason: number;
}

/**
 * The winter's book before hedging, seen from the day its last position went on: the business's
 * result against its average year (scaled) and the desk's trades, each decided on its own date.
 * For the wind and corn farms — whose weather isn't winter degree days — the business's year is
 * drawn from the archive's spread of years instead.
 */
export function bookBase(winter: number, book: DeskBook, business: DeskBusiness, scale: number, m: MarketModel, knobs: WorldKnobs, paths = 400): BookBase {
  const hedgeDay = novemberFirst(winter) - 1;
  const hedgePrice = marketQuote(SEASON_STRIP, winter, hedgeDay, m, knobs).bid;
  const trades = deskTrades(winter, book, m, knobs);
  const viewDay = Math.max(hedgeDay, ...trades.map((t) => t.day));
  const wp = winterPaths(winter, viewDay, knobs, paths);
  const budget = businessBudget(business, knobs) * scale;
  // Other businesses' years, as departures from their average, drawn from the archive.
  let other: number[] = [];
  if (business === 'wind') other = windYears().map((y) => y.revenue * scale - budget);
  if (business === 'farm') other = farmYears(0.02, knobs).map((y) => y.profit * scale - budget);
  const windExp = 1 + UTILITY.perWindMs * (seasonCityWind() - UTILITY.meanWind);
  const biz = new Float64Array(paths);
  const trading = new Float64Array(paths);
  for (let p = 0; p < paths; p++) {
    if (business === 'utility') {
      const volume = wp.realizedVolume + UTILITY.baseLoad * wp.futureDays + UTILITY.perHdd * windExp * wp.futureHdd[p];
      biz[p] = UTILITY.margin * volume * scale - budget;
    } else biz[p] = other[p % other.length];
    let t = 0;
    for (const tr of trades) if (tr.side) t += tr.side * book.size * CME_TICK * (wp.byMonth.get(DESK_MONTH[tr.id])![p] - tr.price);
    trading[p] = t;
  }
  // What happened.
  const { start, end } = contractSpan(SEASON_STRIP, winter);
  let actualSeason = 0;
  const monthActual = new Map<number, number>();
  for (let d = start; d <= end; d++) {
    const h = hdd(tempF('fenwick', d, knobs));
    actualSeason += h;
    const mo = dayInfo(d).month;
    monthActual.set(mo, (monthActual.get(mo) ?? 0) + h);
  }
  const actualBusiness = business === 'utility' ? utilityWinter(winter, knobs).margin * scale - budget : other[Math.min(other.length - 1, winter)];
  let actualTrading = 0;
  for (const tr of trades) if (tr.side) actualTrading += tr.side * book.size * CME_TICK * ((monthActual.get(DESK_MONTH[tr.id]) ?? 0) - tr.price);
  return { viewDay, hedgePrice, trades, business: biz, trading, season: wp.season, actualBusiness, actualTrading, actualSeason };
}

/** The book hedged with `strips` seasonal strips sold on October 31 at the market's bid. */
export function hedgeBook(base: BookBase, strips: number): BookOutcome {
  const n = base.business.length;
  const totals = new Float64Array(n);
  for (let p = 0; p < n; p++) totals[p] = base.business[p] + strips * CME_TICK * (base.hedgePrice - base.season[p]) + base.trading[p];
  totals.sort();
  const biz = Float64Array.from(base.business).sort();
  const mean = totals.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(totals.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    viewDay: base.viewDay,
    hedgePrice: base.hedgePrice,
    trades: base.trades,
    totals,
    business: biz,
    mean,
    sd,
    p5: quantile(totals, 0.05),
    businessMean: biz.reduce((s, v) => s + v, 0) / n,
    businessP5: quantile(biz, 0.05),
    actual: base.actualBusiness + strips * CME_TICK * (base.hedgePrice - base.actualSeason) + base.actualTrading,
  };
}

/** The winter's book as a distribution: the business, its hedge and the desk's trades. */
export function bookOutcome(winter: number, book: DeskBook, business: DeskBusiness, scale: number, m: MarketModel, knobs: WorldKnobs, paths = 400): BookOutcome {
  return hedgeBook(bookBase(winter, book, business, scale, m, knobs, paths), book.hedgeStrips);
}

/** The strips, on a grid, that give the book its best 1-in-20 result, with the other settings held. */
export function bestHedgeForP5(
  winter: number,
  book: DeskBook,
  business: DeskBusiness,
  scale: number,
  m: MarketModel,
  knobs: WorldKnobs,
  grid: number[],
): { strips: number; p5: number } {
  const base = bookBase(winter, book, business, scale, m, knobs);
  let best = { strips: grid[0], p5: -Infinity };
  for (const n of grid) {
    const p5 = hedgeBook(base, n).p5;
    if (p5 > best.p5 + 1e-6) best = { strips: n, p5 };
  }
  return best;
}
