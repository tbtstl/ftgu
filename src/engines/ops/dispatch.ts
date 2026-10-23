// Grid operations engine: hour-by-hour economic dispatch that respects must-run floors,
// ramp limits and weather-limited availability.

import type { Generator } from '../../model/types';

export interface DispatchUnit {
  id: string;
  capacity: number;
  /** Floor while running (must-run plants), MW. */
  minOutput?: number;
  /** $/MWh. */
  cost: number;
  /** MW per hour. Omit for no ramp limit. */
  rampRate?: number;
  /** Hourly MW available (weather or outages); defaults to capacity every hour. */
  available?: number[];
}

export interface HourDispatch {
  output: Record<string, number>;
  /** Price set by the marginal unit, $/MWh. */
  price: number;
  marginal: string | null;
  /** Demand that couldn't be met, MW. */
  shortfall: number;
  /** Generation forced on by floors or ramp limits beyond what demand needs, MW. */
  overGeneration: number;
  /** Weather-driven output turned away, MW. */
  curtailed: number;
}

/**
 * Dispatch one hour. Each unit can move between [max(floor, prev − ramp), min(available, prev + ramp)];
 * demand is filled from those floors upward in cost order.
 */
export function dispatchHour(units: DispatchUnit[], demand: number, hour = 0, prev?: Record<string, number>, priceCap = 1000): HourDispatch {
  const bounds = units.map((u) => {
    const avail = Math.max(0, Math.min(u.capacity, u.available?.[hour] ?? u.capacity));
    let lo = Math.min(u.minOutput ?? 0, avail);
    let hi = avail;
    if (prev && u.rampRate !== undefined && prev[u.id] !== undefined) {
      lo = Math.max(lo, Math.min(avail, prev[u.id] - u.rampRate));
      hi = Math.min(hi, prev[u.id] + u.rampRate);
      hi = Math.max(hi, lo);
    }
    return { u, lo, hi, avail };
  });
  const output: Record<string, number> = {};
  for (const b of bounds) output[b.u.id] = b.lo;
  let remaining = demand - bounds.reduce((s, b) => s + b.lo, 0);
  const order = [...bounds].sort((a, b) => a.u.cost - b.u.cost);
  let marginal: string | null = null;
  let price = 0;
  for (const b of order) {
    if (remaining <= 1e-9) break;
    const add = Math.min(b.hi - b.lo, remaining);
    if (add > 1e-9) {
      output[b.u.id] += add;
      remaining -= add;
      marginal = b.u.id;
      price = b.u.cost;
    }
  }
  const shortfall = Math.max(0, remaining);
  const overGeneration = Math.max(0, -remaining);
  if (shortfall > 1e-9) {
    price = priceCap;
    marginal = null;
  } else if (marginal === null) {
    // Nothing above its floor: the cheapest unit with room to move down would set the price.
    const flexible = order.filter((b) => b.hi > b.lo + 1e-9);
    price = overGeneration > 1e-9 ? Math.min(0, ...order.map((b) => b.u.cost)) : (flexible[0]?.u.cost ?? 0);
  }
  const curtailed = units.reduce((s, u) => s + (u.available ? Math.max(0, Math.min(u.capacity, u.available[hour]) - output[u.id]) * (u.cost <= 0 ? 1 : 0) : 0), 0);
  return { output, price, marginal, shortfall, overGeneration, curtailed };
}

/** Dispatch each hour in turn, carrying ramp limits from one hour to the next. */
export function dispatchDay(units: DispatchUnit[], demand: number[], opts: { ramp?: boolean; priceCap?: number } = {}): HourDispatch[] {
  const out: HourDispatch[] = [];
  let prev: Record<string, number> | undefined;
  for (let h = 0; h < demand.length; h++) {
    const r = dispatchHour(units, demand[h], h, opts.ramp === false ? undefined : prev, opts.priceCap);
    out.push(r);
    prev = r.output;
  }
  return out;
}

/** Convert model generators into dispatch units, with weather availability for wind and solar. */
export function unitsFromFleet(fleet: Generator[], weather: { wind?: number[]; solar?: number[] } = {}, costOverride: Record<string, number> = {}): DispatchUnit[] {
  return fleet.map((g) => ({
    id: g.id,
    capacity: g.capacity,
    minOutput: g.dispatchable ? 0 : g.minOutput,
    cost: costOverride[g.id] ?? g.marginalCost,
    rampRate: g.rampRate,
    available:
      g.fuel === 'wind' && weather.wind
        ? weather.wind.map((cf) => cf * g.capacity)
        : g.fuel === 'solar' && weather.solar
          ? weather.solar.map((cf) => cf * g.capacity)
          : undefined,
  }));
}
