// The capstone (Chapter 7): the reader's own gas system, run, forecast and traded.
//
// The region has grown past the eight years of Chapter 6: it is now Year 9, with Ridgeback at
// 3.56 Bcf/d, Sandhill at 0.64, Bayport's LNG terminal taking 1.8 Bcf/d and the region's own demand
// 8% above Year 1's. Its network is the one Chapter 6 ended with — the six pipelines, Ridgeback
// Express with the third compressor station that expanded it to 2.6 Bcf/d in Year 6 — and the two
// storage fields. The reader re-sizes it with the pipeline designs of Lesson 3.1 (any corridor, any
// pipe size and station count), then runs its market through simulated years exactly as the
// history was run: the operators plan on April 1 and redraw the plan monthly, the daily market
// clears on their water values, and the market quotes futures and basis forwards from those plans
// with the premiums it learned in Chapter 6. Nothing here is new; it is the course's engines put to
// work on a network the reader chose.

import { conditionsOf, END_OF_WINTER, SPRING_RESERVE_VALUE, aprilFirst, type YearConditions } from '../../model/gas/history';
import { GAS_MONTH_DAYS, GAS_MONTH_START, GAS_YEAR_DAYS, cdd, hdd, monthOfDay, weatherYear, type WeatherYear } from '../../model/gas/weather';
import { CORRIDORS, PIPELINE, STORAGE_SPECS, type GasNodeId } from '../../model/gas/world';
import { FUTURES_CONTRACT_MMBTU } from './contracts';
import { forecastTemps } from './forecast';
import { premiums } from './futures';
import { marketDay, monthlyRates, seasonalPlan, simulateYear, type ExtraPipe, type MarketDay, type SeasonalPlan, type StorageState, type YearDay } from './market';
import { COMPRESSION_COST_PER_HP, corridorDesign, type CorridorDesign } from './network';
import { HEATING_MONTHS, lakesideMargin, leasedStorage, marginRates, monthlyStorageOptimum } from './strategies';

/** The capstone's year of the region's growth (0-based index 8: "Year 9"). */
export const CAPSTONE_YEAR = 8;
export const CAPSTONE_CONDITIONS: YearConditions = conditionsOf(CAPSTONE_YEAR);
const MMBTU_PER_BCF = 1.037e6;

// ---------------------------------------------------------------------------
// The reader's system.

export interface GasSystem {
  /** Nominal pipe size by corridor, inches (0 = nothing built). */
  sizes: Record<string, number>;
  /** Compressor stations by corridor, 1–5. */
  stations: Record<string, number>;
}

/** The network at the start of Year 9: the region's six pipelines, Ridgeback Express with three stations. */
export const AS_BUILT: GasSystem = {
  sizes: Object.fromEntries(CORRIDORS.map((c) => [c.id, PIPELINE[c.id]?.sizeIn ?? 0])),
  stations: Object.fromEntries(CORRIDORS.map((c) => [c.id, c.id === 'ridgeback-calder' ? 3 : (PIPELINE[c.id]?.stations ?? 1)])),
};

/** Tariff for the trip on a line in a corridor the region never built, $/MMBtu (as in Lesson 3.1). */
export const NEW_LINE_TARIFF = 0.15;
/** Share of a line's capital it must earn back each year: a 10% return over 30 years (Lesson 3.1). */
export const CAPITAL_CHARGE = 0.1 / (1 - Math.pow(1.1, -30));

const designCache = new Map<string, CorridorDesign>();
/** A corridor's capacity, compression and cost for a pipe size and station count (cached `corridorDesign`). */
export function lineDesign(id: string, size: number, stations: number): CorridorDesign {
  const k = `${id}|${size}|${stations}`;
  let d = designCache.get(k);
  if (!d) {
    d = corridorDesign(id, size, stations);
    designCache.set(k, d);
  }
  return d;
}

/** A stable key for a system (for caches). */
export function systemKey(s: GasSystem): string {
  return CORRIDORS.map((c) => `${s.sizes[c.id] ?? 0}x${s.sizes[c.id] ? (s.stations[c.id] ?? 1) : 0}`).join('|');
}

/** Each corridor's capacity in the reader's system, Bcf/d (0 where nothing is built). */
export function systemCapacity(s: GasSystem): Record<string, number> {
  return Object.fromEntries(CORRIDORS.map((c) => [c.id, s.sizes[c.id] ? lineDesign(c.id, s.sizes[c.id], s.stations[c.id] ?? 1).capacityBcfd : 0]));
}

/** What the market model needs: capacities for the region's own lines, and the new corridors' lines. */
export function systemLines(s: GasSystem): { capacity: Record<string, number>; extra: ExtraPipe[] } {
  const cap = systemCapacity(s);
  const capacity: Record<string, number> = {};
  const extra: ExtraPipe[] = [];
  for (const c of CORRIDORS) {
    if (PIPELINE[c.id]) capacity[c.id] = cap[c.id];
    else if (cap[c.id] > 0) extra.push({ id: c.id, from: c.from as GasNodeId, to: c.to as GasNodeId, capacityBcfd: cap[c.id], variableCost: NEW_LINE_TARIFF });
  }
  return { capacity, extra };
}

/** The tariff for the trip on a corridor's line, $/MMBtu. */
export function lineTariff(id: string): number {
  return PIPELINE[id]?.variableCost ?? NEW_LINE_TARIFF;
}

export interface SystemCost {
  /** Capital spent on top of the network as built, $: added stations on a line kept at its size cost only their horsepower; a new size or corridor is a new pipe. */
  added: number;
  /** That capital's yearly charge, $. */
  annual: number;
  /** Corridors changed. */
  changed: string[];
}

/** What the reader's changes cost (Lesson 3.1's rule). */
export function systemCost(s: GasSystem): SystemCost {
  let added = 0;
  const changed: string[] = [];
  for (const c of CORRIDORS) {
    const size = s.sizes[c.id] ?? 0;
    const n = s.stations[c.id] ?? 1;
    const o = AS_BUILT.sizes[c.id];
    const on = AS_BUILT.stations[c.id];
    if (size === o && (size === 0 || n === on)) continue;
    changed.push(c.id);
    if (!size) continue;
    if (size === o) added += Math.max(0, lineDesign(c.id, size, n).hp - lineDesign(c.id, o, on).hp) * COMPRESSION_COST_PER_HP;
    else added += lineDesign(c.id, size, n).cost;
  }
  return { added, annual: added * CAPITAL_CHARGE, changed };
}

/** Ridgeback's takeaway in the reader's system: what its pipes carry out, plus what its field burns, Bcf/d. */
export function systemTakeaway(s: GasSystem): number {
  const cap = systemCapacity(s);
  return cap['ridgeback-calder'] + cap['ridgeback-bayport'] + cap['ridgeback-sandhill'] + 0.1;
}

// ---------------------------------------------------------------------------
// A year on the reader's system.

function planOptions(s: GasSystem, c: YearConditions) {
  const { capacity, extra } = systemLines(s);
  return {
    production: { ridgeback: c.ridgeback, sandhill: c.sandhill },
    capacity,
    extraPipelines: extra,
    demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
  };
}

/** The operators' plan drawn on the first of gas-year month `month` on the reader's system (as `planFrom` in the history). */
export function systemPlanFrom(s: GasSystem, month: number, storage: StorageState, aprilPlan?: SeasonalPlan, c: YearConditions = CAPSTONE_CONDITIONS): SeasonalPlan {
  const end = month === 0 || !aprilPlan ? END_OF_WINTER : { saltflat: aprilPlan.inventory.saltflat[month], hollowcreek: aprilPlan.inventory.hollowcreek[month] };
  const opts = { ...planOptions(s, c), startMonth: month, start: storage, end, springFloor: { level: END_OF_WINTER, value: SPRING_RESERVE_VALUE }, fast: true };
  const ref = aprilPlan ?? seasonalPlan(opts);
  const rates = { saltflat: monthlyRates(STORAGE_SPECS.saltflat, ref.inventory.saltflat), hollowcreek: monthlyRates(STORAGE_SPECS.hollowcreek, ref.inventory.hollowcreek) };
  return seasonalPlan({ ...opts, rates });
}

/** A month's curve on the reader's system: Calder futures and basis forwards for the months left in the year (index = gas-year month). */
export interface SystemCurve {
  month: number;
  calder: number[];
  metroBasis: number[];
  ridgebackBasis: number[];
  storage: number;
}

export interface SystemYear {
  seed: number;
  weather: WeatherYear;
  plans: SeasonalPlan[];
  days: YearDay[];
  curves: SystemCurve[];
  /** Each gas-year month's average price at each place, $/MMBtu. */
  monthly: Record<GasNodeId, number[]>;
  start: StorageState;
}

const yearCache = new Map<string, SystemYear>();

/** Working gas each April 1 in the capstone: the end-of-winter level the plans aim for. */
export const CAPSTONE_START: StorageState = { ...END_OF_WINTER };

/** The reader's system through one simulated year of weather (cached by system and seed; ~60 ms the first time). */
export function systemYear(s: GasSystem, seed: number): SystemYear {
  const key = `${systemKey(s)}#${seed}`;
  const hit = yearCache.get(key);
  if (hit) return hit;
  const weather = weatherYear(seed);
  const o = planOptions(s, CAPSTONE_CONDITIONS);
  const plan = systemPlanFrom(s, 0, CAPSTONE_START);
  const plans: SeasonalPlan[] = [];
  const days: YearDay[] = [];
  let storage = { ...CAPSTONE_START };
  for (let m = 0; m < 12; m++) {
    const p = m === 0 ? plan : systemPlanFrom(s, m, storage, plan);
    plans.push(p);
    const chunk = simulateYear({
      weather,
      plan: aprilFirst(p, m),
      startDay: GAS_MONTH_START[m],
      days: GAS_MONTH_DAYS[m],
      startStorage: storage,
      production: () => o.production,
      capacity: () => o.capacity,
      extraPipelines: o.extraPipelines,
      demand: o.demand,
      fast: true,
    });
    days.push(...chunk);
    storage = { ...chunk[chunk.length - 1].storage };
  }
  const prem = premiums();
  const curves: SystemCurve[] = plans.map((p, m) => {
    const calder = Array<number>(12).fill(NaN);
    const metroBasis = Array<number>(12).fill(NaN);
    const ridgebackBasis = Array<number>(12).fill(NaN);
    for (let k = 0; m + k < 12; k++) {
      const cal = m + k;
      calder[cal] = p.price.calder[k] * prem.ratio[k][cal];
      metroBasis[cal] = p.price.metro[k] - p.price.calder[k] + prem.metroBasis[k][cal];
      ridgebackBasis[cal] = p.price.ridgeback[k] - p.price.calder[k];
    }
    const st = m === 0 ? CAPSTONE_START : days[GAS_MONTH_START[m] - 1].storage;
    return { month: m, calder, metroBasis, ridgebackBasis, storage: st.saltflat + st.hollowcreek };
  });
  const nodes: GasNodeId[] = ['sandhill', 'ridgeback', 'calder', 'metro', 'bayport'];
  const monthly = Object.fromEntries(
    nodes.map((n) => [
      n,
      Array.from({ length: 12 }, (_, m) => {
        const ds = days.slice(GAS_MONTH_START[m], m < 11 ? GAS_MONTH_START[m + 1] : GAS_YEAR_DAYS);
        return ds.reduce((a, d) => a + d.price[n], 0) / ds.length;
      }),
    ]),
  ) as Record<GasNodeId, number[]>;
  const r: SystemYear = { seed, weather, plans, days, curves, monthly, start: CAPSTONE_START };
  if (yearCache.size > 200) yearCache.clear();
  yearCache.set(key, r);
  return r;
}

export interface YearSummary {
  /** Average price at each place over the year, and over the winter (Nov–Mar), $/MMBtu. */
  avg: Record<GasNodeId, number>;
  winterAvg: Record<GasNodeId, number>;
  /** Highest daily price at each place, $/MMBtu. */
  max: Record<GasNodeId, number>;
  /** Days each corridor's line ran full (within 1%). */
  fullDays: Record<string, number>;
  /** What each line's full days were worth to whoever held its capacity: flow × (price gap − tariff), $ over the year. */
  rent: Record<string, number>;
  /** Protected demand rationed over the year, Bcf, and the days it happened. */
  rationedBcf: number;
  rationedDays: number;
  /** What the region's gas users paid over the year, $ (price × gas served at each place). */
  userCost: number;
  /** Working gas on March 31, Bcf. */
  endStorage: number;
}

/** The year's outcome on the reader's system. */
export function summarizeYear(s: GasSystem, y: SystemYear): YearSummary {
  const nodes: GasNodeId[] = ['sandhill', 'ridgeback', 'calder', 'metro', 'bayport'];
  const cap = systemCapacity(s);
  const avg = {} as Record<GasNodeId, number>;
  const winterAvg = {} as Record<GasNodeId, number>;
  const max = {} as Record<GasNodeId, number>;
  for (const n of nodes) {
    avg[n] = y.days.reduce((a, d) => a + d.price[n], 0) / y.days.length;
    const w = y.days.slice(GAS_MONTH_START[7]);
    winterAvg[n] = w.reduce((a, d) => a + d.price[n], 0) / w.length;
    max[n] = Math.max(...y.days.map((d) => d.price[n]));
  }
  const fullDays: Record<string, number> = {};
  const rent: Record<string, number> = {};
  for (const c of CORRIDORS) {
    fullDays[c.id] = 0;
    rent[c.id] = 0;
    if (!cap[c.id]) continue;
    for (const d of y.days) {
      const f = d.flow[c.id] ?? 0;
      if (f >= cap[c.id] * 0.99 - 1e-9) fullDays[c.id]++;
      const gap = d.price[c.to as GasNodeId] - d.price[c.from as GasNodeId] - lineTariff(c.id);
      if (gap > 1e-6) rent[c.id] += f * gap * MMBTU_PER_BCF;
    }
  }
  let userCost = 0;
  for (const d of y.days) for (const n of nodes) userCost += d.price[n] * d.served[n] * MMBTU_PER_BCF;
  const last = y.days[y.days.length - 1].storage;
  return {
    avg,
    winterAvg,
    max,
    fullDays,
    rent,
    rationedBcf: y.days.reduce((a, d) => a + d.rationed, 0),
    rationedDays: y.days.filter((d) => d.rationed > 1e-6).length,
    userCost,
    endStorage: last.saltflat + last.hollowcreek,
  };
}

/** Weather seeds: the eight practice winters of Lessons 7.2 and 7.4, and the unseen winters of the tournament. */
export const PRACTICE_SEEDS = [501, 502, 503, 504, 505, 506, 507, 508];
export const TOURNAMENT_SEEDS = [701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712];
/** The hidden winters of the forecast challenge (Lesson 7.3). */
export const CHALLENGE_SEEDS = [601, 602, 603, 604, 605, 606];

export interface DesignMorning {
  seed: number;
  day: number;
  tempF: number;
  storage: StorageState;
  waterValue: StorageState;
}

let designMorning: DesignMorning | null = null;

/** The coldest day of the eight practice winters, as the network as built met it: its weather, storage and water values. */
export function designMorningOf(): DesignMorning {
  if (designMorning) return designMorning;
  let best: DesignMorning | null = null;
  for (const seed of PRACTICE_SEEDS) {
    const y = systemYear(AS_BUILT, seed);
    y.days.forEach((d, i) => {
      if (!best || d.tempF < best.tempF) best = { seed, day: i, tempF: d.tempF, storage: i === 0 ? y.start : y.days[i - 1].storage, waterValue: d.waterValue };
    });
  }
  designMorning = best!;
  return designMorning;
}

/** The reader's network on the practice winters' coldest day, with that morning's storage and water values. */
export function designDay(s: GasSystem): MarketDay {
  const m = designMorningOf();
  const o = planOptions(s, CAPSTONE_CONDITIONS);
  return marketDay({ tempF: m.tempF, production: o.production, capacity: o.capacity, extraPipelines: o.extraPipelines, storage: m.storage, waterValue: m.waterValue, demand: o.demand, fast: true });
}

/**
 * How much colder than normal a winter (Nov–Mar) was: its heating degree days less a normal
 * winter's, as Lesson 6.5 measures it (negative = milder).
 */
export function winterColder(w: WeatherYear): number {
  let s = 0;
  for (let d = GAS_MONTH_START[7]; d < GAS_YEAR_DAYS; d++) s += hdd(w.temp[d]) - hdd(w.normal[d]);
  return s;
}

// ---------------------------------------------------------------------------
// Forecasts on the reader's system (Lesson 6.1's ensemble).

export interface SystemForecast {
  fromDay: number;
  members: Array<{ storage: number[]; calder: number[]; metroBasis: number[] }>;
  actual: { storage: number[]; calder: number[]; metroBasis: number[] };
}

const forecastCache = new Map<string, SystemForecast>();

/**
 * An ensemble forecast made on `fromDay` of a year on the reader's system: `horizon` days of
 * weather forecast with `skill`, then `members` climate winters (cached).
 */
export function systemForecast(s: GasSystem, seed: number, fromDay: number, skill: number, members = 12, horizon = 14): SystemForecast {
  const key = `${systemKey(s)}#${seed}#${fromDay}#${skill.toFixed(2)}#${members}#${horizon}`;
  const hit = forecastCache.get(key);
  if (hit) return hit;
  const year = systemYear(s, seed);
  const o = planOptions(s, CAPSTONE_CONDITIONS);
  const start = fromDay === 0 ? year.start : year.days[fromDay - 1].storage;
  const fc = forecastTemps(year.weather, fromDay, horizon, skill, seed);
  const days = GAS_YEAR_DAYS - fromDay;
  const run = (temps: number[]) => {
    const full = year.weather.temp.slice();
    temps.forEach((t, i) => (full[fromDay + i] = t));
    const w: WeatherYear = { temp: full, normal: year.weather.normal, hdd: full.map(hdd), cdd: full.map(cdd) };
    let storage = { ...start };
    const out: YearDay[] = [];
    for (let m = monthOfDay(fromDay); m < 12; m++) {
      const first = Math.max(fromDay, GAS_MONTH_START[m]);
      const last = m < 11 ? GAS_MONTH_START[m + 1] : GAS_YEAR_DAYS;
      const chunk = simulateYear({
        weather: w,
        plan: aprilFirst(year.plans[m], m),
        startDay: first,
        days: last - first,
        startStorage: storage,
        production: () => o.production,
        capacity: () => o.capacity,
        extraPipelines: o.extraPipelines,
        demand: o.demand,
        fast: true,
      });
      out.push(...chunk);
      storage = { ...chunk[chunk.length - 1].storage };
    }
    return { storage: out.map((d) => d.storage.saltflat + d.storage.hollowcreek), calder: out.map((d) => d.price.calder), metroBasis: out.map((d) => d.price.metro - d.price.calder) };
  };
  const list: SystemForecast['members'] = [];
  for (let k = 0; k < members; k++) {
    const clim = weatherYear(5000 + k);
    const temps: number[] = [];
    for (let i = 0; i < days; i++) {
      const d = fromDay + i;
      temps.push(i < fc.length ? fc[i] : year.weather.normal[d] + (clim.temp[d] - clim.normal[d]));
    }
    list.push(run(temps));
  }
  const ds = year.days.slice(fromDay);
  const r: SystemForecast = {
    fromDay,
    members: list,
    actual: { storage: ds.map((d) => d.storage.saltflat + d.storage.hollowcreek), calder: ds.map((d) => d.price.calder), metroBasis: ds.map((d) => d.price.metro - d.price.calder) },
  };
  if (forecastCache.size > 300) forecastCache.clear();
  forecastCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// The portfolio (Lesson 7.4) and the tournament (Lesson 7.5).

export type FirmLine = 'calder-metro' | 'ridgeback-calder';

export interface PortfolioSettings {
  /** Share of Salt Flat leased (0 = none), and whether its planned moves are hedged with futures (rolling intrinsic). */
  storageShare: number;
  storageHedged: boolean;
  /** Firm capacity held, MMBtu/d (0 = none), and on which line. */
  firmLine: FirmLine;
  firmMMBtuD: number;
  /** Lakeside toll held for the year. */
  toll: boolean;
  /** Weather trades: prompt-month index gas in the heating months (October–April, as in Lesson 6.1), lots per trade (0 = none), forecast skill and the threshold, °F. */
  weatherLots: number;
  skill: number;
  weatherThresholdF: number;
  /** Metro's December–February basis sold on each month's first day, MMBtu/d (0 = none); stand aside when the forecast is colder than normal by more than this, °F (null = never). */
  metroSellMMBtuD: number;
  metroSkipColderF: number | null;
}

export const PASSIVE: PortfolioSettings = {
  storageShare: 0,
  storageHedged: true,
  firmLine: 'calder-metro',
  firmMMBtuD: 0,
  toll: false,
  weatherLots: 0,
  skill: 0.8,
  weatherThresholdF: 1,
  metroSellMMBtuD: 0,
  metroSkipColderF: 0,
};

export const PORTFOLIO_DEFAULTS: PortfolioSettings = {
  ...PASSIVE,
  storageShare: 1 / 30,
  firmMMBtuD: 10_000,
  weatherLots: 10,
  metroSellMMBtuD: 10_000,
};

/** Trading costs: as in Chapter 6 (a tenth of a cent each way on futures, a cent on basis). */
export const CAPSTONE_FEES = { futures: 0.001, basis: 0.01 };

export interface PortfolioPart {
  /** What the April 1 curve valued the position at — the fee paid for a physical asset, $. */
  fee: number;
  /** Profit in each gas-year month after fees, $. */
  monthly: number[];
  total: number;
}

export interface PortfolioYear {
  seed: number;
  storage: PortfolioPart & { inventory: number[]; moves: number[] };
  firm: PortfolioPart;
  toll: PortfolioPart;
  weather: PortfolioPart & { trades: number };
  metro: PortfolioPart & { trades: number };
  /** All parts together, by month and in total, $. */
  monthly: number[];
  total: number;
  /** Most cash needed at any time: margin on open trades and fees paid ahead, less profits so far, $. */
  peakCapital: number;
  /** Net Calder price exposure at the start of each month, MMBtu (+ long): physical storage moves not hedged, plus futures. */
  exposure: number[];
}

const empty = () => Array<number>(12).fill(0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * A leased share of Salt Flat, starting and ending a quarter full. Its fee is its intrinsic value on
 * April 1's curve. Each month the holder redraws the schedule on the month's curve from the gas
 * held and makes the month's move at the month's average price; hedged, the holder also holds
 * futures for every later planned move and adjusts them each month (Lesson 6.4's rolling intrinsic),
 * paying the futures fee on each change.
 */
function storagePart(y: SystemYear, share: number, hedged: boolean) {
  const monthly = empty();
  if (share <= 0) return { fee: 0, monthly, total: 0, inventory: empty(), moves: empty(), planned: [] as number[][] };
  const spec = leasedStorage(share);
  const start = spec.workingBcf * 0.25;
  const curve = (t: number) => y.curves[t].calder.slice(t);
  const fee = monthlyStorageOptimum(curve(0), spec, { startCal: 0, start, end: start }).value;
  let x = start;
  const position = new Map<number, number>();
  const inventory: number[] = [];
  const moves: number[] = [];
  const planned: number[][] = [];
  for (let t = 0; t < 12; t++) {
    if (t > 0) for (const [D, pos] of position) monthly[t - 1] += pos * (y.curves[t].calder[D] - y.curves[t - 1].calder[D]);
    position.delete(t);
    const plan = monthlyStorageOptimum(curve(t), spec, { startCal: t, start: x, end: start });
    planned.push(plan.moves);
    if (hedged) {
      for (let k = 1; k < plan.moves.length; k++) {
        const want = plan.moves[k] * MMBTU_PER_BCF;
        monthly[t] -= Math.abs(want - (position.get(t + k) ?? 0)) * CAPSTONE_FEES.futures;
        position.set(t + k, want);
      }
    }
    const d = plan.moves[0];
    const p = y.monthly.calder[t];
    monthly[t] += d > 0 ? -d * MMBTU_PER_BCF * (p + 0.05) : -d * MMBTU_PER_BCF * (p - 0.05);
    inventory.push(x);
    moves.push(d);
    x += d;
  }
  monthly.forEach((_, t) => (monthly[t] -= fee / 12));
  return { fee, monthly, total: sum(monthly), inventory, moves, planned };
}

function firmPart(y: SystemYear, s: GasSystem, line: FirmLine, vol: number): PortfolioPart {
  const monthly = empty();
  if (vol <= 0) return { fee: 0, monthly, total: 0 };
  const tariff = lineTariff(line);
  const fwd = (k: number) => (line === 'calder-metro' ? y.curves[0].metroBasis[k] : -y.curves[0].ridgebackBasis[k]);
  let fee = 0;
  for (let k = 0; k < 12; k++) fee += Math.max(0, fwd(k) - tariff) * vol * GAS_MONTH_DAYS[k];
  const cap = systemCapacity(s)[line];
  y.days.forEach((d, i) => {
    if (!cap) return;
    const spread = line === 'calder-metro' ? d.price.metro - d.price.calder : d.price.calder - d.price.ridgeback;
    monthly[monthOfDay(i)] += Math.max(0, spread - tariff) * vol;
  });
  monthly.forEach((_, t) => (monthly[t] -= fee / 12));
  return { fee, monthly, total: sum(monthly) };
}

function tollPart(y: SystemYear, on: boolean): PortfolioPart {
  const monthly = empty();
  if (!on) return { fee: 0, monthly, total: 0 };
  let fee = 0;
  for (let k = 0; k < 12; k++) fee += lakesideMargin(y.curves[0].calder[k] + y.curves[0].metroBasis[k]) * GAS_MONTH_DAYS[k];
  y.days.forEach((d, i) => (monthly[monthOfDay(i)] += lakesideMargin(d.price.metro)));
  monthly.forEach((_, t) => (monthly[t] -= fee / 12));
  return { fee, monthly, total: sum(monthly) };
}

/** The first-day forecast of each month: how much colder than normal the next two weeks look, °F. */
export function monthForecasts(y: SystemYear, skill: number, horizon = 14): number[] {
  return Array.from({ length: 12 }, (_, m) => {
    const from = GAS_MONTH_START[m];
    const fc = forecastTemps(y.weather, from, horizon, skill, y.seed);
    return fc.reduce((a, t, i) => a + y.weather.normal[from + i] - t, 0) / Math.max(1, fc.length);
  });
}

/** One year of the reader's portfolio on the reader's system. */
export function portfolioYear(s: GasSystem, seed: number, p: PortfolioSettings): PortfolioYear {
  const y = systemYear(s, seed);
  const margin = marginRates();
  const storage = storagePart(y, p.storageShare, p.storageHedged);
  const firm = firmPart(y, s, p.firmLine, p.firmMMBtuD);
  const toll = tollPart(y, p.toll);
  const signals = p.weatherLots > 0 || (p.metroSellMMBtuD > 0 && p.metroSkipColderF !== null) ? monthForecasts(y, p.skill) : Array<number>(12).fill(0);
  // Weather: in the heating months (Lesson 6.1's October–April), buy (sell) the month's gas at its
  // first-day futures price when the forecast is colder (warmer), and sell (buy) it back day by day.
  const wMonthly = empty();
  const marginByMonth = empty();
  let wTrades = 0;
  if (p.weatherLots > 0 && p.skill > 0) {
    for (const m of HEATING_MONTHS) {
      if (Math.abs(signals[m]) <= p.weatherThresholdF) continue;
      const size = Math.sign(signals[m]) * p.weatherLots * FUTURES_CONTRACT_MMBTU;
      wMonthly[m] += size * (y.monthly.calder[m] - y.curves[m].calder[m]) - Math.abs(size) * CAPSTONE_FEES.futures;
      marginByMonth[m] += p.weatherLots * margin.futures;
      wTrades++;
    }
  }
  // Metro: sell each winter month's basis on its first day, unless the forecast is too cold.
  const mMonthly = empty();
  let mTrades = 0;
  if (p.metroSellMMBtuD > 0) {
    for (const m of [8, 9, 10]) {
      if (p.metroSkipColderF !== null && signals[m] > p.metroSkipColderF) continue;
      const vol = p.metroSellMMBtuD * GAS_MONTH_DAYS[m];
      mMonthly[m] += vol * (y.curves[m].metroBasis[m] - (y.monthly.metro[m] - y.monthly.calder[m])) - vol * CAPSTONE_FEES.basis;
      marginByMonth[m] += vol * margin.basis;
      mTrades++;
    }
  }
  if (p.storageHedged && p.storageShare > 0) {
    storage.moves.forEach((_, t) => {
      const open = storage.moves.slice(t + 1).reduce((a, d) => a + Math.abs(d), 0) * MMBTU_PER_BCF;
      marginByMonth[t] += (open / FUTURES_CONTRACT_MMBTU) * margin.futures;
    });
  }
  const monthly = empty().map((_, t) => storage.monthly[t] + firm.monthly[t] + toll.monthly[t] + wMonthly[t] + mMonthly[t]);
  // The physical assets' fees are paid on April 1 (the monthly profits spread them over the year).
  // Cash needed in a month: the margin on open trades, less the cash the book has made so far, or
  // plus what it is down.
  const fees = storage.fee + firm.fee + toll.fee;
  let cash = -fees;
  let peak = 0;
  for (let t = 0; t < 12; t++) {
    const before = cash;
    cash += monthly[t] + fees / 12;
    peak = Math.max(peak, marginByMonth[t] - Math.min(before, cash), -Math.min(before, cash));
  }
  // Price exposure: gas still to be bought or sold at prices not yet fixed. Unhedged, that is the
  // whole remaining schedule; hedged, only the part of this month's move the futures didn't cover.
  const exposure = storage.planned.map((plan, t) => {
    const unfixed = p.storageHedged ? Math.abs(plan[0] - (t > 0 ? (storage.planned[t - 1][1] ?? 0) : plan[0])) : plan.reduce((a, d) => a + Math.abs(d), 0);
    return unfixed * MMBTU_PER_BCF;
  });
  while (exposure.length < 12) exposure.push(0);
  return {
    seed,
    storage: { ...storage, total: sum(storage.monthly) },
    firm,
    toll,
    weather: { fee: 0, monthly: wMonthly, total: sum(wMonthly), trades: wTrades },
    metro: { fee: 0, monthly: mMonthly, total: sum(mMonthly), trades: mTrades },
    monthly,
    total: sum(monthly),
    peakCapital: peak,
    exposure,
  };
}

export interface TournamentResult {
  totals: number[];
  mean: number;
  worst: number;
  best: number;
  /** Share of winters that made money. */
  winRate: number;
  peakCapital: number;
}

/** The portfolio over a set of winters on the reader's system. */
export function tournament(s: GasSystem, p: PortfolioSettings, seeds: number[] = TOURNAMENT_SEEDS): TournamentResult {
  const ys = seeds.map((seed) => portfolioYear(s, seed, p));
  const totals = ys.map((y) => y.total);
  return {
    totals,
    mean: sum(totals) / totals.length,
    worst: Math.min(...totals),
    best: Math.max(...totals),
    winRate: totals.filter((t) => t > 0).length / totals.length,
    peakCapital: Math.max(...ys.map((y) => y.peakCapital)),
  };
}

/** The rival desks of the tournament: each plays one of Chapter 6's strategies alone. */
export const RIVALS: Array<{ id: string; name: string; settings: PortfolioSettings }> = [
  { id: 'storage', name: 'Storage desk (hedged lease)', settings: { ...PASSIVE, storageShare: 1 / 30, storageHedged: true } },
  { id: 'gambler', name: 'Unhedged storage', settings: { ...PASSIVE, storageShare: 1 / 30, storageHedged: false } },
  { id: 'insurer', name: 'Metro insurance seller', settings: { ...PASSIVE, metroSellMMBtuD: 10_000, metroSkipColderF: null } },
  { id: 'forecaster', name: 'Weather desk', settings: { ...PASSIVE, weatherLots: 10, skill: 0.8, weatherThresholdF: 1 } },
  { id: 'shipper', name: 'Firm Northline', settings: { ...PASSIVE, firmLine: 'calder-metro', firmMMBtuD: 10_000 } },
];
