// A point-in-time backtest of Lesson 5.4's cross-market trade. In every week of December to
// February in the archive, six days before the week begins, a forecaster compares its expected
// heating degree days, gas price and power price for the week with a market whose forecasts were
// issued a few days earlier, and in each of the three markets trades one contract wherever the gap
// beats that market's half-spread, holding it to settlement. Both sides price ENSO, so the only
// edge is the age of the market's forecast.
//
// As in Lesson 5.4, gas and power prices are functions of a day's temperature (priceCurves), for a
// fixed pipeline capacity and a week of steady wind both sides know. Each side's expected value is
// the average of those curves over its own forecast distribution for each day; the week's
// settlement uses the temperatures the archive recorded. Every forecast is the one the course's
// model issued on its day (forecastTemp), built only from what had been revealed by then. All
// prices are simulated.

import { dayIndex, forecastTemp, tempF } from '../../model/weather/archive';
import { INSTRUMENTS, interp, priceCurves, type InstrumentId, type PhysicalDrivers } from './crossMarket';
import { hdd } from './degreeDays';
import { expectedDegreeDays } from './market';

/** Days before a week begins that its trade is decided: next week, as in Lesson 5.4 (leads 6–12). */
export const CROSS_LEAD = 6;
/** Weeks traded each winter: twelve, starting December 1. */
export const WEEKS_PER_WINTER = 12;
export const CROSS_IDS: InstrumentId[] = ['hdd', 'gas', 'power'];

export interface CrossTrade {
  /** Winter w runs from December of year w − 1 to February of year w. */
  winter: number;
  /** Week of the winter, 0–11. */
  week: number;
  /** +1 bought, −1 sold. */
  side: 1 | -1;
  /** Expected profit after the spread when the trade was made, by our forecast, $. */
  expected: number;
  /** What it made, after the spread, $. */
  pnl: number;
}

export interface CrossStats {
  trades: number;
  /** Average expected profit per trade when the trades were made, $. */
  expected: number;
  /** Average realized profit per trade, $. */
  mean: number;
  sd: number;
  /** Standard error of the average, $. */
  se: number;
  total: number;
}

export interface CrossReplay {
  /** Weeks replayed. */
  weeks: number;
  trades: Record<InstrumentId, CrossTrade[]>;
  stats: Record<InstrumentId, CrossStats>;
}

// Expectations over a normal distribution on a fixed grid of standard scores.
const ZS = Array.from({ length: 41 }, (_, i) => -4 + i * 0.2);
const WTS = (() => {
  const w = ZS.map((z) => Math.exp(-(z * z) / 2));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
})();

function expectedOnCurve(xs: number[], ys: number[], mean: number, sd: number): number {
  let t = 0;
  for (let i = 0; i < ZS.length; i++) t += WTS[i] * interp(xs, ys, mean + sd * ZS[i]);
  return t;
}

export function crossStats(trades: CrossTrade[]): CrossStats {
  const n = trades.length;
  if (!n) return { trades: 0, expected: 0, mean: 0, sd: 0, se: 0, total: 0 };
  const total = trades.reduce((s, t) => s + t.pnl, 0);
  const mean = total / n;
  const sd = Math.sqrt(trades.reduce((s, t) => s + (t.pnl - mean) ** 2, 0) / n);
  return { trades: n, expected: trades.reduce((s, t) => s + t.expected, 0) / n, mean, sd, se: sd / Math.sqrt(n), total };
}

/**
 * Replay the cross-market rule over `winters`: in each week, our forecast is issued `lead` days
 * before the week begins and the market's `lag` days before ours. One contract per market per
 * week, traded at the market's bid or ask when the gap beats its half-spread.
 */
export function crossMarketReplay(winters: number[], lag: number, dr: PhysicalDrivers, lead = CROSS_LEAD): CrossReplay {
  const c = priceCurves(dr);
  const trades: Record<InstrumentId, CrossTrade[]> = { hdd: [], gas: [], power: [] };
  let weeks = 0;
  for (const w of winters) {
    const dec1 = dayIndex(w - 1, 11, 1);
    for (let k = 0; k < WEEKS_PER_WINTER; k++) {
      weeks++;
      const first = dec1 + 7 * k;
      const issue = first - lead;
      const ours = { hdd: 0, gas: 0, power: 0 };
      const mkt = { hdd: 0, gas: 0, power: 0 };
      const settled = { hdd: 0, gas: 0, power: 0 };
      for (let i = 0; i < 7; i++) {
        const d = first + i;
        const o = forecastTemp('fenwick', d, d - issue);
        const m = forecastTemp('fenwick', d, d - issue + lag);
        ours.hdd += expectedDegreeDays('HDD', o.mean, o.sd);
        mkt.hdd += expectedDegreeDays('HDD', m.mean, m.sd);
        ours.gas += expectedOnCurve(c.temps, c.gas, o.mean, o.sd) / 7;
        mkt.gas += expectedOnCurve(c.temps, c.gas, m.mean, m.sd) / 7;
        ours.power += expectedOnCurve(c.temps, c.power, o.mean, o.sd) / 7;
        mkt.power += expectedOnCurve(c.temps, c.power, m.mean, m.sd) / 7;
        const t = tempF('fenwick', d);
        settled.hdd += hdd(t);
        settled.gas += interp(c.temps, c.gas, t) / 7;
        settled.power += interp(c.temps, c.power, t) / 7;
      }
      for (const id of CROSS_IDS) {
        const ins = INSTRUMENTS[id];
        const gap = ours[id] - mkt[id];
        if (Math.abs(gap) <= ins.halfSpread) continue;
        const side: 1 | -1 = gap > 0 ? 1 : -1;
        trades[id].push({
          winter: w,
          week: k,
          side,
          expected: ins.quantity * (Math.abs(gap) - ins.halfSpread),
          pnl: ins.quantity * (side * (settled[id] - mkt[id]) - ins.halfSpread),
        });
      }
    }
  }
  return { weeks, trades, stats: { hdd: crossStats(trades.hdd), gas: crossStats(trades.gas), power: crossStats(trades.power) } };
}
