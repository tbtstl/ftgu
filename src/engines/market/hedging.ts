// A load-serving retailer in the two-settlement market: it buys energy day-ahead on a forecast,
// then its customers' actual use is settled against that purchase at the real-time price.

import type { MarketDay } from '../../model/history';
import { RETAILER_SHARE } from './roles';
import { twoSettlement } from './settlement';

export type PurchaseShape = 'follow' | 'flat';

/**
 * The day-ahead purchase, MW per hour: `ratio` × the forecast of the retailer's load, either hour by
 * hour ("follow") or as one flat block at the forecast's daily average ("flat").
 */
export function dayAheadPurchase(d: MarketDay, ratio: number, shape: PurchaseShape = 'follow', share = RETAILER_SHARE): number[] {
  const fc = d.demandForecast.map((v) => v * share);
  const avg = fc.reduce((s, v) => s + v, 0) / Math.max(1, fc.length);
  return fc.map((v) => Math.max(0, ratio) * (shape === 'follow' ? v : avg));
}

export interface HourSettlement {
  bought: number;
  used: number;
  /** Paid for the day-ahead purchase, $ (positive = paid). */
  dayAhead: number;
  /** Paid (positive) or received (negative) for the deviation at the real-time price, $. */
  realTime: number;
  total: number;
}

export interface RetailerSettlement {
  hours: HourSettlement[];
  /** Customers' actual use, MW. */
  load: number[];
  energy: number;
  dayAhead: number;
  realTime: number;
  /** What the day's energy cost, $. */
  total: number;
  /** What it would have cost to buy everything in real time, $. */
  allRealTime: number;
  /** total / energy, $/MWh. */
  perMWh: number;
}

/** Settle a retailer's day: day-ahead purchase at the DA price, deviation at the RT price. */
export function settleRetailer(d: MarketDay, bought: number[], share = RETAILER_SHARE): RetailerSettlement {
  const load = d.demand.map((v) => v * share);
  const hours = load.map((used, h) => {
    // twoSettlement counts selling as positive; a buyer's position is negative.
    const s = twoSettlement({ daMW: -(bought[h] ?? 0), rtMW: -used, daPrice: d.da[h], rtPrice: d.rt[h] });
    return { bought: bought[h] ?? 0, used, dayAhead: -s.dayAhead, realTime: -s.realTime, total: -s.total };
  });
  const sum = (f: (x: HourSettlement) => number) => hours.reduce((s, x) => s + f(x), 0);
  const energy = load.reduce((s, v) => s + v, 0);
  const total = sum((x) => x.total);
  return {
    hours,
    load,
    energy,
    dayAhead: sum((x) => x.dayAhead),
    realTime: sum((x) => x.realTime),
    total,
    allRealTime: load.reduce((s, q, h) => s + q * d.rt[h], 0),
    perMWh: energy > 0 ? total / energy : 0,
  };
}

export interface HedgeBacktest {
  /** Cost of each day under the strategy, and buying everything in real time, $. */
  cost: number[];
  allRealTime: number[];
  /** Average cost per MWh on each day, $/MWh. */
  perMWh: number[];
  total: number;
  totalAllRealTime: number;
  /** Day with the highest average cost per MWh, and that cost. */
  worstDay: number;
  worstPerMWh: number;
  /** Days on which the strategy cost less than buying in real time. */
  cheaperDays: number;
}

/** Apply one day-ahead strategy to every day and compare it with buying everything in real time. */
export function hedgeBacktest(days: MarketDay[], ratio: number, shape: PurchaseShape = 'follow', share = RETAILER_SHARE): HedgeBacktest {
  const res = days.map((d) => settleRetailer(d, dayAheadPurchase(d, ratio, shape, share), share));
  const cost = res.map((r) => r.total);
  const allRealTime = res.map((r) => r.allRealTime);
  const perMWh = res.map((r) => r.perMWh);
  let worst = 0;
  perMWh.forEach((v, i) => {
    if (v > perMWh[worst]) worst = i;
  });
  return {
    cost,
    allRealTime,
    perMWh,
    total: cost.reduce((s, v) => s + v, 0),
    totalAllRealTime: allRealTime.reduce((s, v) => s + v, 0),
    worstDay: days[worst]?.day ?? 0,
    worstPerMWh: perMWh[worst] ?? 0,
    cheaperDays: res.filter((r) => r.total < r.allRealTime - 1e-6).length,
  };
}

/** Average day-ahead and real-time price of each day, $/MWh. */
export function dailyAverages(days: MarketDay[]) {
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  return days.map((d) => ({ day: d.day, da: avg(d.da), rt: avg(d.rt), spread: avg(d.rt) - avg(d.da) }));
}
