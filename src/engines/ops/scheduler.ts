// Scheduling dispatchable plants around wind and solar (Lesson 3.3).
//
// `weatherDays` picks a few contrasting days from the region's history; `netLoad` is what the
// dispatchable plants must follow; `scheduleDay` runs the ramp-limited economic dispatch
// (dispatchDay) for the standard fleet with resized wind and solar; and `scheduleCommitted` adds the
// constraint that a combined-cycle plant is either online — and then no lower than its minimum
// stable output — or offline and producing nothing, following an hour-by-hour commitment plan.

import type { Generator } from '../../model/types';
import { STANDARD_FLEET } from '../../model/fleet';
import { standardHistory } from '../../model/history';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import { dispatchDay, dispatchHour, unitsFromFleet, type DispatchUnit, type HourDispatch } from './dispatch';

export type DayId = 'clear' | 'cloudy' | 'calm' | 'windy';

export interface WeatherDay {
  id: DayId;
  label: string;
  /** Index in standardHistory(), or null for the reference day. */
  historyDay: number | null;
  demand: number[];
  /** Capacity factors, 0–1. */
  windCF: number[];
  solarCF: number[];
}

const WIND_MW = STANDARD_FLEET.find((g) => g.id === 'wind')!.capacity;
const SOLAR_MW = STANDARD_FLEET.find((g) => g.id === 'solar')!.capacity;

let daysCache: WeatherDay[] | null = null;

/**
 * The reference day plus three days from the region's history with the same (mild-weekday) demand
 * forecast: the cloudiest, the calmest and the windiest. Each uses that day's actual demand, wind
 * and solar.
 */
export function weatherDays(): WeatherDay[] {
  if (daysCache) return daysCache;
  const h = standardHistory();
  const mild = h.filter((d) => d.weekday < 5 && d.demandForecast.every((v, i) => v === SYSTEM_DEMAND[i]) && d.outages.length === 0);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const pick = (score: (d: (typeof h)[number]) => number) => mild.reduce((b, d) => (score(d) < score(b) ? d : b), mild[0]);
  const fromHistory = (id: DayId, label: string, d: (typeof h)[number]): WeatherDay => ({
    id,
    label,
    historyDay: d.day,
    demand: [...d.demand],
    windCF: d.wind.map((v) => Math.min(1, v / WIND_MW)),
    solarCF: d.solar.map((v) => Math.min(1, v / SOLAR_MW)),
  });
  daysCache = [
    { id: 'clear', label: 'Clear spring day', historyDay: null, demand: [...SYSTEM_DEMAND], windCF: [...WIND_CF], solarCF: [...SOLAR_CF] },
    fromHistory('cloudy', 'Cloudy day', pick((d) => sum(d.solar))),
    fromHistory('calm', 'Calm, sunny day', pick((d) => sum(d.wind) - 0.2 * sum(d.solar))),
    fromHistory('windy', 'Windy day', pick((d) => -sum(d.wind))),
  ];
  return daysCache;
}

export function weatherDay(id: DayId): WeatherDay {
  return weatherDays().find((d) => d.id === id)!;
}

/** Demand minus wind minus solar, MW, for the given installed capacities. */
export function netLoad(day: WeatherDay, solarMW: number, windMW: number): number[] {
  return day.demand.map((d, h) => d - windMW * day.windCF[h] - solarMW * day.solarCF[h]);
}

/** The standard fleet with Ridge wind and Valley solar resized. */
export function resizedFleet(solarMW: number, windMW: number): Generator[] {
  return STANDARD_FLEET.map((g) => (g.id === 'solar' ? { ...g, capacity: solarMW } : g.id === 'wind' ? { ...g, capacity: windMW } : g));
}

export interface Schedule {
  hours: HourDispatch[];
  /** Hourly output by plant id, MW. */
  output: Record<string, number[]>;
  /** Wind and solar that was available, MW (before curtailment). */
  windAvail: number[];
  solarAvail: number[];
  net: number[];
  curtailedMWh: number;
  shortfallMWh: number;
  overGenMWh: number;
  /** Fuel and running cost, $. */
  cost: number;
}

function summarize(hours: HourDispatch[], units: DispatchUnit[], day: WeatherDay, solarMW: number, windMW: number): Schedule {
  const output: Record<string, number[]> = {};
  for (const u of units) output[u.id] = hours.map((h) => h.output[u.id] ?? 0);
  const cost = hours.reduce((s, h) => s + units.reduce((c, u) => c + (h.output[u.id] ?? 0) * u.cost, 0), 0);
  return {
    hours,
    output,
    windAvail: day.windCF.map((cf) => cf * windMW),
    solarAvail: day.solarCF.map((cf) => cf * solarMW),
    net: netLoad(day, solarMW, windMW),
    curtailedMWh: hours.reduce((s, h) => s + h.curtailed, 0),
    shortfallMWh: hours.reduce((s, h) => s + h.shortfall, 0),
    overGenMWh: hours.reduce((s, h) => s + h.overGeneration, 0),
    cost,
  };
}

/** Ramp-limited economic dispatch of the whole standard fleet for a day (every thermal plant may glide to zero). */
export function scheduleDay(day: WeatherDay, solarMW: number, windMW: number): Schedule {
  const units = unitsFromFleet(resizedFleet(solarMW, windMW), { wind: day.windCF, solar: day.solarCF });
  return summarize(dispatchDay(units, day.demand, { ramp: true }), units, day, solarMW, windMW);
}

/** The plants whose commitment the reader plans, and their minimum stable output when online (illustrative: 40% of capacity). */
export const COMMITTABLE = ['cc1', 'cc2'] as const;
export type CommitId = (typeof COMMITTABLE)[number];
export const MIN_STABLE_SHARE = 0.4;

/** Ironwood coal stays online all day at no less than its minimum output (coal plants take many hours to restart). */
const ALWAYS_ON_FLOOR: Record<string, number> = { coal: STANDARD_FLEET.find((g) => g.id === 'coal')!.minOutput };

/** A commitment plan: for each combined-cycle plant, whether it's online in each hour. */
export type Commitment = Record<CommitId, boolean[]>;

/** Online for the hours [from, to), offline otherwise. */
export function hoursOn(from: number, to: number): boolean[] {
  return Array.from({ length: 24 }, (_, h) => h >= from && h < to);
}

/**
 * Dispatch with a commitment plan. An online combined-cycle plant runs between its minimum stable
 * output and capacity, moving at most its ramp rate per hour (a plant coming online starts at its
 * minimum and can add up to one hour's ramp); an offline one produces nothing. Ironwood coal never
 * goes below its minimum. Everything else is as in scheduleDay.
 */
export function scheduleCommitted(day: WeatherDay, solarMW: number, windMW: number, plan: Commitment): Schedule {
  const base = unitsFromFleet(resizedFleet(solarMW, windMW), { wind: day.windCF, solar: day.solarCF });
  const hours: HourDispatch[] = [];
  let prev: Record<string, number> | undefined;
  for (let h = 0; h < 24; h++) {
    const units: DispatchUnit[] = base.map((u) => {
      if (u.id in ALWAYS_ON_FLOOR) return { ...u, minOutput: ALWAYS_ON_FLOOR[u.id] };
      if ((COMMITTABLE as readonly string[]).includes(u.id)) {
        const on = plan[u.id as CommitId][h];
        const avail = Array<number>(24).fill(0);
        avail[h] = on ? u.capacity : 0;
        return { ...u, minOutput: on ? MIN_STABLE_SHARE * u.capacity : 0, available: avail };
      }
      return u;
    });
    const r = dispatchHour(units, day.demand[h], h, prev);
    hours.push(r);
    prev = r.output;
  }
  return summarize(hours, base, day, solarMW, windMW);
}

/** Largest hour-to-hour rise in net load between noon and midnight, MW per hour, and the hour it ends. */
export function eveningRamp(net: number[]): { mw: number; hour: number } {
  let best = { mw: 0, hour: 12 };
  for (let h = 13; h < 24; h++) if (net[h] - net[h - 1] > best.mw) best = { mw: net[h] - net[h - 1], hour: h };
  return best;
}

/** Rise in net load over the three hours ending at the evening's steepest climb (a common way to quote the "evening ramp"). */
export function threeHourRamp(net: number[]): number {
  let best = 0;
  for (let h = 15; h < 24; h++) best = Math.max(best, net[h] - net[h - 3]);
  return best;
}
