// One market day seen by each kind of participant: a generator, a retailer, a trader, the
// independent system operator (ISO) and the regulated wires utility. Prices come from the
// standard history (src/model/history.ts); quantities are rebuilt from the same fleet and
// forecasts the history's day-ahead market cleared on.

import { STANDARD_FLEET } from '../../model/fleet';
import { REGION_LOAD_SHARE } from '../../model/networks';
import { SYSTEM_DEMAND } from '../../model/profiles';
import type { MarketDay } from '../../model/history';
import { clearMeritOrder, type Offer } from './clearing';
import { virtualPnL } from './settlement';

/** Interface limits behind the history's North and Metro prices, MW (as in src/model/history.ts). */
export const NORTH_EXPORT_LIMIT = 380;
export const METRO_IMPORT_LIMIT = 560;

/** A plant's running cost on a history day: gas plants' costs move with that day's gas price. */
export function dayCost(id: string, d: MarketDay): number {
  const g = STANDARD_FLEET.find((x) => x.id === id);
  if (!g) return 0;
  return g.fuel === 'gasCC' || g.fuel === 'gasCT' ? g.marginalCost * d.gas : g.marginalCost;
}

/** The day-ahead offers the history cleared for one hour (wind and solar at their forecasts). */
export function dayAheadOffers(d: MarketDay, h: number): Offer[] {
  return STANDARD_FLEET.map((g) => {
    if (g.fuel === 'wind') return { id: g.id, mw: d.windForecast[h], price: -5 };
    if (g.fuel === 'solar') return { id: g.id, mw: d.solarForecast[h], price: -2 };
    if (g.fuel === 'hydro') return { id: g.id, mw: g.capacity * 0.8, price: dayCost(g.id, d) };
    return { id: g.id, mw: g.capacity, price: dayCost(g.id, d) };
  });
}

/** Day-ahead schedule: each plant's MW in each hour, from the merit order against forecast demand. */
export function dayAheadSchedule(d: MarketDay): Array<Record<string, number>> {
  return d.demandForecast.map((D, h) => clearMeritOrder(dayAheadOffers(d, h), D).dispatch);
}

export interface GeneratorDay {
  /** MW scheduled each hour. */
  output: number[];
  /** Running cost, $/MWh. */
  cost: number;
  revenue: number;
  runningCost: number;
  /** Revenue minus running cost: what's left for fixed costs and profit, $. */
  margin: number;
  hoursRun: number;
}

/** A generator that offers its running cost and is paid the day-ahead price on its schedule. */
export function generatorDay(d: MarketDay, id: string, schedule = dayAheadSchedule(d)): GeneratorDay {
  const output = schedule.map((s) => s[id] ?? 0);
  const cost = dayCost(id, d);
  const revenue = output.reduce((s, q, h) => s + q * d.da[h], 0);
  const runningCost = output.reduce((s, q) => s + q * cost, 0);
  return { output, cost, revenue, runningCost, margin: revenue - runningCost, hoursRun: output.filter((q) => q > 1e-6).length };
}

/** Share of the region's customers served by the course's retailer. */
export const RETAILER_SHARE = 0.2;

export interface RetailerDay {
  /** Customers' use each hour, MW (a share of forecast demand). */
  load: number[];
  energy: number;
  /** Paid for energy at the hourly day-ahead price, $. */
  wholesale: number;
  /** Collected from customers at the fixed rate, $. */
  revenue: number;
  margin: number;
  /** Margin each hour, $. */
  hourly: number[];
  /** Load-weighted average wholesale price, $/MWh: the break-even fixed rate. */
  breakEven: number;
}

/**
 * A retailer that buys its customers' use hour by hour at the day-ahead price and sells it to
 * them at a fixed rate. (Lesson 4.2 assumes customers use exactly what was forecast.)
 */
export function retailerDay(d: MarketDay, rate: number, share = RETAILER_SHARE): RetailerDay {
  const load = d.demandForecast.map((v) => v * share);
  const hourly = load.map((q, h) => q * (rate - d.da[h]));
  const energy = load.reduce((s, v) => s + v, 0);
  const wholesale = load.reduce((s, q, h) => s + q * d.da[h], 0);
  const revenue = energy * rate;
  return { load, energy, wholesale, revenue, margin: revenue - wholesale, hourly, breakEven: energy > 0 ? wholesale / energy : 0 };
}

/** The retailer's margin over many days at one fixed rate, and the rate that breaks even. */
export function retailerPeriod(days: MarketDay[], rate: number, share = RETAILER_SHARE) {
  const daily = days.map((d) => retailerDay(d, rate, share));
  const margin = daily.reduce((s, r) => s + r.margin, 0);
  const energy = daily.reduce((s, r) => s + r.energy, 0);
  const wholesale = daily.reduce((s, r) => s + r.wholesale, 0);
  return {
    daily: daily.map((r) => r.margin),
    margin,
    breakEven: energy > 0 ? wholesale / energy : 0,
    losingDays: daily.filter((r) => r.margin < 0).length,
    worst: Math.min(...daily.map((r) => r.margin)),
  };
}

export interface TraderDay {
  /** Profit each hour, $. */
  hourly: number[];
  total: number;
}

/**
 * A trader holding the same virtual position every hour. Positive MW is an increment offer
 * (sell day-ahead, buy back in real time); negative MW is a decrement bid (the reverse).
 */
export function traderDay(d: MarketDay, mw: number): TraderDay {
  const hourly = d.da.map((p, h) => (mw >= 0 ? virtualPnL('inc', mw, p, d.rt[h]) : virtualPnL('dec', -mw, p, d.rt[h])));
  return { hourly, total: hourly.reduce((s, v) => s + v, 0) };
}

export interface IsoDay {
  /** MWh traded in the day-ahead market. */
  energy: number;
  /** Paid by buyers at their own location's price, $. */
  collected: number;
  /** Paid to sellers, $. */
  paid: number;
  /** collected − paid: congestion rent, $, and each hour's share of it. */
  rent: number;
  rentHourly: number[];
}

/**
 * The ISO's day-ahead books. Buyers pay their local price (Metro and North differ from the hub
 * when an interface is full); the difference between what buyers pay and sellers receive is the
 * congestion rent: the price gap across each full interface times the MW crossing it.
 */
export function isoDay(d: MarketDay): IsoDay {
  const metro = REGION_LOAD_SHARE.city ?? 0.55;
  const north = REGION_LOAD_SHARE.north ?? 0.05;
  let energy = 0;
  let collected = 0;
  const rentHourly: number[] = [];
  for (let h = 0; h < 24; h++) {
    const D = d.demandForecast[h];
    energy += D;
    collected += D * (metro * d.daMetro[h] + north * d.daNorth[h] + (1 - metro - north) * d.da[h]);
    rentHourly.push(Math.max(0, d.daMetro[h] - d.da[h]) * METRO_IMPORT_LIMIT + Math.max(0, d.da[h] - d.daNorth[h]) * NORTH_EXPORT_LIMIT);
  }
  const rent = rentHourly.reduce((s, v) => s + v, 0);
  return { energy, collected, paid: collected - rent, rent, rentHourly };
}

/** An illustrative regulated wires utility for the region (transmission and distribution). */
export const WIRES_UTILITY = {
  /** Undepreciated value of poles, wires and substations the regulator lets it earn on, $. */
  rateBase: 2.4e9,
  /** Depreciation recovered each year, $. */
  depreciation: 110e6,
  /** Operating and maintenance costs recovered each year, $. */
  operating: 160e6,
};

/** Energy the region uses in a year if every day were the reference day, MWh. */
export const ANNUAL_ENERGY = SYSTEM_DEMAND.reduce((s, v) => s + v, 0) * 365;

/**
 * Cost-of-service regulation: the utility may collect its operating costs, depreciation and an
 * allowed return on its rate base. Spread over the energy delivered, that's the delivery charge.
 */
export function wiresUtility(allowedReturn: number, u = WIRES_UTILITY) {
  const returnOnRateBase = allowedReturn * u.rateBase;
  const revenueRequirement = returnOnRateBase + u.depreciation + u.operating;
  return { returnOnRateBase, revenueRequirement, deliveryCharge: revenueRequirement / ANNUAL_ENERGY };
}
