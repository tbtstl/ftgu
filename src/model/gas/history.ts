// The region's simulated history: eight gas years of daily weather, flows, storage and prices,
// run on the course's market model. The years differ in their weather and in how the region
// changes underneath the market: Ridgeback's production grows every year as drilling continues,
// Sandhill's declines, Bayport adds liquefaction trains, and Ridgeback Express is expanded in
// year 6, after production has outgrown it. All of it is simulated for teaching; no real market's
// prices are shown.
//
// The storage operators draw up a seasonal plan on April 1 and redraw it on the first of every
// month from the gas they actually hold, assuming normal weather from then on and the region as it
// stands. Each day they value their gas by the latest plan (Lesson 4.4's water value).

import { monthlyRates, seasonalPlan, simulateYear, type SeasonalPlan, type StorageState, type YearDay } from '../../engines/gas/market';
import { STORAGE_SPECS, type GasNodeId } from './world';
import { GAS_MONTH_DAYS, GAS_MONTH_START, weatherYear, type WeatherYear } from './weather';

export interface YearConditions {
  /** Production at the two basins, Bcf/d. */
  ridgeback: number;
  sandhill: number;
  /** Ridgeback Express's capacity, Bcf/d. */
  ridgebackExpress: number;
  /** LNG feed gas Bayport can take, Bcf/d. */
  lngBcfd: number;
  /** Growth in the region's own demand (multiplies every block but LNG). */
  demandScale: number;
}

export interface HistoryYear {
  /** 0-based index; the year is shown as "Year index + 1". */
  index: number;
  label: string;
  seed: number;
  conditions: YearConditions;
  weather: WeatherYear;
  /** The storage operators' plan for the year, drawn up on April 1 from the gas then in storage. */
  plan: SeasonalPlan;
  /** The plan as redrawn on the first of each month (month 0 is `plan`); each starts in its own month. */
  plans: SeasonalPlan[];
  days: YearDay[];
  /** Working gas on April 1, Bcf. */
  start: StorageState;
}

/** Weather seeds for the eight years: a mix of ordinary, mild and cold winters. */
export const HISTORY_SEEDS = [308, 315, 302, 324, 321, 306, 316, 311];
export const HISTORY_YEARS = HISTORY_SEEDS.length;
/** Year (0-based) in which Ridgeback Express's expansion comes online, and by how much, Bcf/d. */
export const EXPRESS_EXPANSION = { year: 5, addBcfd: 0.5 };

/** What the region looks like in each year of the history. */
export function conditionsOf(y: number): YearConditions {
  return {
    ridgeback: 2.6 + 0.12 * y,
    sandhill: 0.8 - 0.02 * y,
    ridgebackExpress: 2.1 + (y >= EXPRESS_EXPANSION.year ? EXPRESS_EXPANSION.addBcfd : 0),
    lngBcfd: y < 4 ? 1.2 : y < 6 ? 1.5 : 1.8,
    demandScale: 1 + 0.01 * y,
  };
}

/** Working gas each field is planned to hold at the end of March, Bcf. */
export const END_OF_WINTER: StorageState = { saltflat: STORAGE_SPECS.saltflat.workingBcf * 0.25, hollowcreek: STORAGE_SPECS.hollowcreek.workingBcf * 0.25 };
/** What the storage operators would accept, $/MMBtu, to give up the gas they plan to hold on March 31. */
export const SPRING_RESERVE_VALUE = 6;

/**
 * The plan drawn on the first day of gas-year month `month`, from the gas then in storage: twelve
 * months ahead, keeping the spring reserve, and ending where the year's April plan has storage
 * twelve months on (or at the end-of-winter level, from April).
 */
export function planFrom(month: number, storage: StorageState, c: YearConditions, aprilPlan?: SeasonalPlan): SeasonalPlan {
  const end = month === 0 || !aprilPlan ? END_OF_WINTER : { saltflat: aprilPlan.inventory.saltflat[month], hollowcreek: aprilPlan.inventory.hollowcreek[month] };
  const opts = {
    startMonth: month,
    start: storage,
    end,
    production: { ridgeback: c.ridgeback, sandhill: c.sandhill },
    capacity: { 'ridgeback-calder': c.ridgebackExpress },
    demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
    springFloor: { level: END_OF_WINTER, value: SPRING_RESERVE_VALUE },
    fast: true,
  };
  // The operators know a filling field injects more slowly: their rates follow the inventory path of
  // the year's April plan (which itself is drawn twice, the second time along its own first path).
  const ref = aprilPlan ?? seasonalPlan(opts);
  const rates = { saltflat: monthlyRates(STORAGE_SPECS.saltflat, ref.inventory.saltflat), hollowcreek: monthlyRates(STORAGE_SPECS.hollowcreek, ref.inventory.hollowcreek) };
  return seasonalPlan({ ...opts, rates });
}

/**
 * A plan drawn in month `month`, laid out April-first as the daily market reads it. Only the
 * current month and the next matter within the month; the month before is held at the current
 * month's price so that the first half of the month isn't pulled toward next year's values.
 */
export function aprilFirst(p: SeasonalPlan, month: number): SeasonalPlan {
  if (month === 0) return p;
  const rot = (arr: number[]) => {
    const out = Array<number>(12);
    for (let k = 0; k < 12; k++) out[(month + k) % 12] = arr[k];
    out[month - 1] = arr[0];
    return out;
  };
  const rotInv = (arr: number[]) => {
    const out = Array<number>(13).fill(arr[0]);
    for (let k = 0; k < 12; k++) out[(month + k) % 12] = arr[k];
    out[month + 1] = arr[1];
    return out;
  };
  const price = Object.fromEntries(Object.entries(p.price).map(([n, a]) => [n, rot(a)])) as Record<GasNodeId, number[]>;
  const inventory = { saltflat: rotInv(p.inventory.saltflat), hollowcreek: rotInv(p.inventory.hollowcreek) };
  return { ...p, startMonth: 0, price, inventory, totalInventory: inventory.saltflat.map((x, i) => x + inventory.hollowcreek[i]) };
}

let cache: HistoryYear[] | null = null;

/** The eight years, run in order with storage carried from each March into the next April (cached). */
export function gasHistory(): HistoryYear[] {
  if (cache) return cache;
  const out: HistoryYear[] = [];
  let start: StorageState = { ...END_OF_WINTER };
  HISTORY_SEEDS.forEach((seed, y) => {
    const c = conditionsOf(y);
    const weather = weatherYear(seed);
    const plan = planFrom(0, start, c);
    const plans: SeasonalPlan[] = [];
    const days: YearDay[] = [];
    let storage = { ...start };
    for (let m = 0; m < 12; m++) {
      const p = m === 0 ? plan : planFrom(m, storage, c, plan);
      plans.push(p);
      const chunk = simulateYear({
        weather,
        plan: aprilFirst(p, m),
        startDay: GAS_MONTH_START[m],
        days: GAS_MONTH_DAYS[m],
        startStorage: storage,
        production: () => ({ ridgeback: c.ridgeback, sandhill: c.sandhill }),
        capacity: () => ({ 'ridgeback-calder': c.ridgebackExpress }),
        demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
        fast: true,
      });
      days.push(...chunk);
      storage = { ...chunk[chunk.length - 1].storage };
    }
    out.push({ index: y, label: `Year ${y + 1}`, seed, conditions: c, weather, plan, plans, days, start });
    start = storage;
  });
  cache = out;
  return out;
}

/** Every day of the history in order, with its year and day of the gas year. */
export function historyDays(): Array<YearDay & { year: number; t: number }> {
  return gasHistory().flatMap((h) => h.days.map((d, i) => ({ ...d, year: h.index, t: h.index * 365 + i })));
}
