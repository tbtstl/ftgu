// Strategy engine: a battery trading against hourly prices — the optimal schedule, a simple rule,
// and what happens when a schedule planned on one set of prices is paid another.

import type { MarketDay } from '../../model/history';
import { optimizeArbitrage, scheduleValue, type ArbitrageBattery } from './arbitrage';

export interface Schedule {
  /** MW per hour: + discharging (selling), − charging (buying). */
  schedule: number[];
  /** Stored energy at each hour boundary, MWh (length n + 1). */
  soc: number[];
  /** Market revenue minus charging cost, minus degradation, $. */
  profit: number;
  /** Energy delivered to the grid, MWh. */
  dischargedMWh: number;
}

/**
 * A simple rule: charge at full power in the `n` cheapest hours and discharge at full power in
 * the `n` dearest, in time order, within the battery's energy limits. Efficiency losses are
 * split evenly between charging and discharging, as in optimizeArbitrage.
 */
export function ruleSchedule(prices: number[], b: ArbitrageBattery, n: number, degradationPerMWh = 0): Schedule {
  const k = Math.max(0, Math.min(Math.floor(prices.length / 2), Math.round(n)));
  const order = prices.map((p, h) => ({ p, h })).sort((a, c) => a.p - c.p || a.h - c.h);
  const cheap = new Set(order.slice(0, k).map((o) => o.h));
  const dear = new Set(order.slice(order.length - k).map((o) => o.h));
  const eta = Math.sqrt(Math.max(1e-6, b.efficiency));
  let stored = b.soc0 * b.energyMWh;
  const soc = [stored];
  const schedule: number[] = [];
  let discharged = 0;
  for (let t = 0; t < prices.length; t++) {
    let mw = 0;
    if (cheap.has(t) && !dear.has(t)) {
      const grid = Math.min(b.powerMW, Math.max(0, b.energyMWh - stored) / eta);
      stored += grid * eta;
      mw = -grid;
    } else if (dear.has(t) && !cheap.has(t)) {
      const grid = Math.min(b.powerMW, stored * eta);
      stored -= grid / eta;
      mw = grid;
      discharged += grid;
    }
    schedule.push(mw);
    soc.push(stored);
  }
  return { schedule, soc, profit: scheduleValue(prices, schedule, 1, degradationPerMWh), dischargedMWh: discharged };
}

/**
 * Levels for optimizeArbitrage's state-of-charge grid: `perHour` steps for each hour of storage
 * duration. The grid quantizes how much energy can move in an hour, so a coarse grid behaves like
 * a slightly smaller battery; 30 steps per hour keeps that loss to about 2%, 6 to under 10%.
 */
export function levelsFor(b: ArbitrageBattery, perHour: number): number {
  const hours = b.powerMW > 0 ? b.energyMWh / b.powerMW : 1;
  return Math.max(6, Math.min(241, Math.round(perHour * hours) + 1));
}

export interface BatteryDay {
  /** Perfect foresight of the day's day-ahead prices, settled day-ahead. */
  daOptimal: number;
  /** The simple rule on day-ahead prices, settled day-ahead. */
  rule: number;
  /** The day-ahead-optimal plan, run in real time and paid real-time prices. */
  daPlanAtRt: number;
  /** Perfect foresight of the day's real-time prices: an upper bound nobody can reach. */
  rtOptimal: number;
  /** Equivalent full cycles of the day-ahead-optimal plan. */
  cycles: number;
}

/** The four strategies on one historical day. `levels` trades accuracy for speed in the optimizer. */
export function batteryDay(day: MarketDay, b: ArbitrageBattery, degradationPerMWh: number, levels = 41): BatteryDay {
  const opts = { degradationPerMWh, levels };
  const da = optimizeArbitrage(day.da, b, opts);
  const rt = optimizeArbitrage(day.rt, b, opts);
  const hours = b.powerMW > 0 ? b.energyMWh / b.powerMW : 0;
  return {
    daOptimal: da.profit,
    rule: ruleSchedule(day.da, b, hours, degradationPerMWh).profit,
    daPlanAtRt: scheduleValue(day.rt, da.schedule, 1, degradationPerMWh),
    rtOptimal: rt.profit,
    cycles: da.cycles,
  };
}

/** Every day of a history, for the four strategies. */
export function batteryHistory(days: MarketDay[], b: ArbitrageBattery, degradationPerMWh: number, levels = 41): BatteryDay[] {
  return days.map((d) => batteryDay(d, b, degradationPerMWh, levels));
}

/**
 * A forecast-driven battery for backtests: plan on today's day-ahead prices plus the average
 * real-time premium (RT − DA) by hour over the past days, then settle the plan at real-time
 * prices. Each MWh bought or sold also pays `costPerMWh`.
 */
export function forecastBatteryPnL(past: MarketDay[], today: MarketDay, b: ArbitrageBattery, degradationPerMWh: number, costPerMWh: number, levels = 41): number {
  const premium = Array<number>(24).fill(0);
  if (past.length) for (const d of past) d.rt.forEach((p, h) => (premium[h] += (p - d.da[h]) / past.length));
  const forecast = today.da.map((p, h) => p + premium[h]);
  // The plan counts trading costs as extra wear: each MWh sold needs about 1/efficiency MWh bought.
  const wear = degradationPerMWh + costPerMWh * (1 + 1 / Math.max(0.01, b.efficiency));
  const plan = optimizeArbitrage(forecast, b, { degradationPerMWh: wear, levels });
  const traded = plan.schedule.reduce((s, x) => s + Math.abs(x), 0);
  return scheduleValue(today.rt, plan.schedule, 1, degradationPerMWh) - costPerMWh * traded;
}
