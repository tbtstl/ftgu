// Other worlds for Chapter 6: the region's eight years re-run with one physical fact changed.
//
// A backtest replays one history, so it can test a belief (how fast Ridgeback grows, how skilled a
// forecast is) but never the world the belief is about. Here the same eight years of weather run
// on a region that differs in one physical fact — Ridgeback Express's expansion opening a year
// late, or Northline built with more or less capacity — through the same storage plans, daily
// market and forward curves as the history itself (`gasHistory`, `curveAt`). The market of each
// world quotes its curves as the history's market does: from the region as it stands, with
// premiums fitted so that its own eight years were priced right on average.

import { conditionsOf, END_OF_WINTER, EXPRESS_EXPANSION, gasHistory, HISTORY_SEEDS, SPRING_RESERVE_VALUE, aprilFirst, type HistoryYear, type YearConditions } from '../../model/gas/history';
import { GAS_MONTH_DAYS, GAS_MONTH_START, GAS_YEAR_DAYS, weatherYear } from '../../model/gas/weather';
import { PIPELINE, STORAGE_SPECS, type GasNodeId } from '../../model/gas/world';
import { curveAt as historyCurveAt, monthAverage as historyMonthAverage, type CurveObservation, type Premiums } from './futures';
import { monthlyRates, seasonalPlan, simulateYear, type SeasonalPlan, type StorageState, type YearDay } from './market';

export interface World {
  /** Year (0-based) in which Ridgeback Express's expansion opens. */
  expansionYear: number;
  /** Northline's capacity, Bcf/d. */
  northlineBcfd: number;
}

/** The world the history ran on. */
export const HISTORY_WORLD: World = { expansionYear: EXPRESS_EXPANSION.year, northlineBcfd: PIPELINE['calder-metro'].capacityBcfd };

/** The history's world with the expansion opening a year late. */
export const LATE_EXPANSION_WORLD: World = { ...HISTORY_WORLD, expansionYear: EXPRESS_EXPANSION.year + 1 };

const keyOf = (w: World) => `${w.expansionYear}|${w.northlineBcfd.toFixed(3)}`;

export function isHistoryWorld(w: World): boolean {
  return keyOf(w) === keyOf(HISTORY_WORLD);
}

/** What the region looks like in year `y` of a world. */
export function worldConditions(w: World, y: number): YearConditions {
  const c = conditionsOf(y);
  return { ...c, ridgebackExpress: PIPELINE['ridgeback-calder'].capacityBcfd + (y >= w.expansionYear ? EXPRESS_EXPANSION.addBcfd : 0) };
}

/**
 * The year the expansion is expected to open, as known in year `known`: the announced year until
 * that year arrives, and then the year it actually opens (a delay is public once the pipe isn't
 * there on April 1).
 */
export function announcedExpansionYear(w: World, known: number): number {
  return known < EXPRESS_EXPANSION.year ? EXPRESS_EXPANSION.year : w.expansionYear;
}

function capacityOf(w: World, c: YearConditions): Record<string, number> {
  return { 'ridgeback-calder': c.ridgebackExpress, 'calder-metro': w.northlineBcfd };
}

/** The operators' plan drawn on the first of `month` (as the history's `planFrom`, with the world's pipelines). */
function planIn(w: World, month: number, storage: StorageState, c: YearConditions, aprilPlan?: SeasonalPlan): SeasonalPlan {
  const end = month === 0 || !aprilPlan ? END_OF_WINTER : { saltflat: aprilPlan.inventory.saltflat[month], hollowcreek: aprilPlan.inventory.hollowcreek[month] };
  const opts = {
    startMonth: month,
    start: storage,
    end,
    production: { ridgeback: c.ridgeback, sandhill: c.sandhill },
    capacity: capacityOf(w, c),
    demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
    springFloor: { level: END_OF_WINTER, value: SPRING_RESERVE_VALUE },
    fast: true,
  };
  const ref = aprilPlan ?? seasonalPlan(opts);
  const rates = { saltflat: monthlyRates(STORAGE_SPECS.saltflat, ref.inventory.saltflat), hollowcreek: monthlyRates(STORAGE_SPECS.hollowcreek, ref.inventory.hollowcreek) };
  return seasonalPlan({ ...opts, rates });
}

const historyCache = new Map<string, HistoryYear[]>();

/**
 * A world's eight years, run as the history was (cached). Years before the first one the change
 * touches are the history's own.
 */
export function worldHistory(w: World): HistoryYear[] {
  if (isHistoryWorld(w)) return gasHistory();
  const key = keyOf(w);
  const hit = historyCache.get(key);
  if (hit) return hit;
  const real = gasHistory();
  const first = w.northlineBcfd !== HISTORY_WORLD.northlineBcfd ? 0 : Math.min(w.expansionYear, HISTORY_WORLD.expansionYear);
  const out: HistoryYear[] = real.slice(0, first);
  let start: StorageState = first === 0 ? { ...END_OF_WINTER } : { ...real[first - 1].days[GAS_YEAR_DAYS - 1].storage };
  for (let y = first; y < HISTORY_SEEDS.length; y++) {
    const seed = HISTORY_SEEDS[y];
    const c = worldConditions(w, y);
    const weather = weatherYear(seed);
    const plan = planIn(w, 0, start, c);
    const plans: SeasonalPlan[] = [];
    const days: YearDay[] = [];
    let storage = { ...start };
    for (let m = 0; m < 12; m++) {
      const p = m === 0 ? plan : planIn(w, m, storage, c, plan);
      plans.push(p);
      const chunk = simulateYear({
        weather,
        plan: aprilFirst(p, m),
        startDay: GAS_MONTH_START[m],
        days: GAS_MONTH_DAYS[m],
        startStorage: storage,
        production: () => ({ ridgeback: c.ridgeback, sandhill: c.sandhill }),
        capacity: () => capacityOf(w, c),
        demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
        fast: true,
      });
      days.push(...chunk);
      storage = { ...chunk[chunk.length - 1].storage };
    }
    out.push({ index: y, label: `Year ${y + 1}`, seed, conditions: c, weather, plan, plans, days, start });
    start = storage;
  }
  historyCache.set(key, out);
  return out;
}

/** A world's market: its forward curves and realized prices, as `curveAt` and `monthAverage` give them for the history. */
export interface WorldMarket {
  world: World;
  history: HistoryYear[];
  months: number;
  curveAt(month: number): CurveObservation;
  monthAverage(month: number, place: GasNodeId, minus?: GasNodeId): number;
  settlement(delivery: number): number;
}

function storageAt(h: HistoryYear[], month: number): StorageState {
  const y = Math.floor(month / 12);
  const m = month % 12;
  return m === 0 ? h[y].start : h[y].days[GAS_MONTH_START[m] - 1].storage;
}

/** The history's own market. */
export const HISTORY_MARKET: WorldMarket = {
  world: HISTORY_WORLD,
  get history() {
    return gasHistory();
  },
  get months() {
    return gasHistory().length * 12;
  },
  curveAt: historyCurveAt,
  monthAverage: historyMonthAverage,
  settlement: (d) => historyCurveAt(d).calder[d],
};

const marketCache = new Map<string, WorldMarket>();

/** A world's market (cached). The history's world gets the history's own market. */
export function worldMarket(w: World): WorldMarket {
  if (isHistoryWorld(w)) return HISTORY_MARKET;
  const key = keyOf(w);
  const hit = marketCache.get(key);
  if (hit) return hit;
  const h = worldHistory(w);
  const N = h.length * 12;
  const avgCache = new Map<string, number>();
  const monthAverage = (month: number, place: GasNodeId, minus?: GasNodeId) => {
    const k = `${month}|${place}|${minus ?? ''}`;
    const v0 = avgCache.get(k);
    if (v0 !== undefined) return v0;
    const y = Math.floor(month / 12);
    const m = month % 12;
    const days = h[y].days.slice(GAS_MONTH_START[m], m < 11 ? GAS_MONTH_START[m + 1] : GAS_YEAR_DAYS);
    const v = days.reduce((s, d) => s + d.price[place] - (minus ? d.price[minus] : 0), 0) / days.length;
    avgCache.set(k, v);
    return v;
  };
  const raw = (month: number) => h[Math.floor(month / 12)].plans[month % 12].price;
  // The premiums, fitted to this world's eight years exactly as `premiums` fits them to the history's.
  const ratio: number[][] = [];
  const metroBasis: number[][] = [];
  const settle = (d: number) => raw(d).calder[0] * ratio[0][d % 12];
  for (let lead = 0; lead < 12; lead++) {
    const r = Array<number>(12).fill(1);
    const b = Array<number>(12).fill(0);
    for (let cal = 0; cal < 12; cal++) {
      let target = 0;
      let rawSum = 0;
      let basis = 0;
      let n = 0;
      for (let d = cal; d < N; d += 12) {
        if (d - lead < 0) continue;
        const rc = raw(d - lead);
        rawSum += rc.calder[lead];
        target += lead === 0 ? monthAverage(d, 'calder') : settle(d);
        basis += monthAverage(d, 'metro', 'calder') - (rc.metro[lead] - rc.calder[lead]);
        n++;
      }
      if (n) {
        r[cal] = target / rawSum;
        b[cal] = basis / n;
      }
    }
    ratio.push(r);
    metroBasis.push(b);
  }
  const prem: Premiums = { ratio, metroBasis };
  const curves = new Map<number, CurveObservation>();
  const curveAt = (month: number): CurveObservation => {
    const hit2 = curves.get(month);
    if (hit2) return hit2;
    const y = Math.floor(month / 12);
    const m = month % 12;
    const p = raw(month);
    const calder: Record<number, number> = {};
    const mb: Record<number, number> = {};
    const rb: Record<number, number> = {};
    for (let k = 0; k < 12; k++) {
      const abs = month + k;
      const cal = (m + k) % 12;
      calder[abs] = p.calder[k] * prem.ratio[k][cal];
      mb[abs] = p.metro[k] - p.calder[k] + prem.metroBasis[k][cal];
      rb[abs] = p.ridgeback[k] - p.calder[k];
    }
    const st = storageAt(h, month);
    const o: CurveObservation = {
      month,
      year: y,
      t: y * GAS_YEAR_DAYS + GAS_MONTH_START[m],
      calder,
      metroBasis: mb,
      ridgebackBasis: rb,
      storage: st.saltflat + st.hollowcreek,
      planned: h[y].plan.inventory.saltflat[m] + h[y].plan.inventory.hollowcreek[m],
    };
    curves.set(month, o);
    return o;
  };
  const market: WorldMarket = { world: w, history: h, months: N, curveAt, monthAverage, settlement: (d) => curveAt(d).calder[d] };
  marketCache.set(key, market);
  return market;
}
