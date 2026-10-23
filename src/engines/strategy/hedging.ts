// Strategy engine: a retailer's portfolio — customers on a fixed price, supplied from the spot
// market and hedged with forward blocks and a contract for differences.
//
// The retailer buys its customers' forecast load day-ahead and settles the forecast error in real
// time (the two-settlement system). Forwards and the CfD are financial: they settle against the
// day-ahead hub price, so a bought block pays the retailer (DA − forward price) per MWh.

import type { MarketDay } from '../../model/history';
import { cfdPayoff, forwardPnL } from '../market/settlement';

/** Hours of the 7×16 on-peak block (07:00–23:00) and the 7×8 off-peak block (23:00–07:00). */
export const ON_PEAK_HOURS = Array.from({ length: 16 }, (_, i) => i + 7);
export const OFF_PEAK_HOURS = [23, 0, 1, 2, 3, 4, 5, 6];
/** Hours of the evening CfD (17:00–22:00). */
export const EVENING_HOURS = [17, 18, 19, 20, 21];

export interface RetailBook {
  /** Share of the region's demand the retailer serves, 0–1. */
  share: number;
  /** Fixed price the customers pay, $/MWh. */
  retailPrice: number;
  /** Forward blocks bought, MW in every hour of the block. */
  onPeakMW: number;
  offPeakMW: number;
  /** Forward prices of the blocks, $/MWh. */
  onPeakPrice: number;
  offPeakPrice: number;
  /** CfD bought over the evening hours, MW, and its strike, $/MWh. */
  cfdMW: number;
  cfdStrike: number;
}

export interface DailyMargin {
  /** Customers' payments, $. */
  revenue: number;
  /** Day-ahead purchase of forecast load plus real-time settlement of the error, $. */
  spotCost: number;
  /** Settlement of forwards and CfD, $ (positive when prices came in above the contract prices). */
  hedge: number;
  margin: number;
}

const ON = new Set(ON_PEAK_HOURS);
const EVE = new Set(EVENING_HOURS);

/** MW the hedges cover in each hour: the block for that hour plus the CfD in the evening. */
export function hedgedMW(b: RetailBook): number[] {
  return Array.from({ length: 24 }, (_, h) => (ON.has(h) ? b.onPeakMW : b.offPeakMW) + (EVE.has(h) ? b.cfdMW : 0));
}

/** The day's margin hour by hour. */
export function hourlyMargin(day: MarketDay, b: RetailBook): DailyMargin[] {
  return Array.from({ length: 24 }, (_, h) => {
    const fc = b.share * day.demandForecast[h];
    const act = b.share * day.demand[h];
    const revenue = b.retailPrice * act;
    const spotCost = fc * day.da[h] + (act - fc) * day.rt[h];
    let hedge = ON.has(h) ? forwardPnL('buy', b.onPeakMW, b.onPeakPrice, day.da[h]) : forwardPnL('buy', b.offPeakMW, b.offPeakPrice, day.da[h]);
    if (EVE.has(h)) hedge -= cfdPayoff(b.cfdMW, b.cfdStrike, day.da[h]);
    return { revenue, spotCost, hedge, margin: revenue - spotCost + hedge };
  });
}

export function dailyMargin(day: MarketDay, b: RetailBook): DailyMargin {
  return hourlyMargin(day, b).reduce(
    (t, x) => ({ revenue: t.revenue + x.revenue, spotCost: t.spotCost + x.spotCost, hedge: t.hedge + x.hedge, margin: t.margin + x.margin }),
    { revenue: 0, spotCost: 0, hedge: 0, margin: 0 },
  );
}

/** Daily margins over a history. */
export function portfolioHistory(days: MarketDay[], b: RetailBook): DailyMargin[] {
  return days.map((d) => dailyMargin(d, b));
}

/** Average day-ahead hub price over a set of hours on every day, $/MWh. */
export function averagePrice(days: MarketDay[], hours: number[]): number {
  if (!days.length || !hours.length) return 0;
  let s = 0;
  for (const d of days) for (const h of hours) s += d.da[h];
  return s / (days.length * hours.length);
}

/** Average forecast load the retailer serves in a block's hours, MW. */
export function averageLoad(days: MarketDay[], hours: number[], share: number): number {
  if (!days.length || !hours.length) return 0;
  let s = 0;
  for (const d of days) for (const h of hours) s += share * d.demandForecast[h];
  return s / (days.length * hours.length);
}
