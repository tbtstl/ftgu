// Forecasting the region's fundamentals from a day in its history: the weather ahead, and what it
// will do to demand, storage and prices.
//
// A weather forecast is built from what actually happened, blurred by the forecast's lack of skill:
// for a day h days ahead, its predicted departure from normal is ρ(h) times the true departure plus
// noise, where ρ(h) = skill · e^(−h / 12) shrinks with the lead time — forecasts are useful for a
// week or two and worth little beyond. Past the forecast's horizon each member of an ensemble
// draws its weather from the region's climate (another simulated year's departures). Running the
// market model forward through each member gives a spread of possible storage and price paths.

import { aprilFirst, gasHistory } from '../../model/gas/history';
import { gaussian, rng } from '../../model/random';
import { GAS_MONTH_START, GAS_YEAR_DAYS, anomalySd, cdd, hdd, monthOfDay, weatherYear, type WeatherYear } from '../../model/gas/weather';
import { simulateYear, type StorageState, type YearDay } from './market';

/** Forecast skill's decay with lead time, days. */
export const SKILL_DECAY_DAYS = 12;

/** Correlation between forecast and actual departures from normal at a lead of h days. */
export function forecastSkill(skill: number, leadDays: number): number {
  return Math.max(0, Math.min(1, skill)) * Math.exp(-leadDays / SKILL_DECAY_DAYS);
}

/**
 * A forecast, made on `fromDay`, of the next `horizon` days' temperatures in a weather year. It is
 * the best guess given a noisy signal of the truth: departure = ρ²·actual + ρ·√(1 − ρ²)·σ·ε, which
 * correlates with the actual departure by ρ, never overstates its spread, and falls back to the
 * normal temperature as ρ → 0. The noise is seeded by the day, so the same forecast is issued every visit.
 */
export function forecastTemps(w: WeatherYear, fromDay: number, horizon: number, skill: number, seed = 1): number[] {
  const r = rng(seed * 100003 + fromDay * 7919);
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const d = fromDay + h - 1;
    if (d >= GAS_YEAR_DAYS) break;
    const rho = forecastSkill(skill, h);
    const actual = w.temp[d] - w.normal[d];
    const noise = gaussian(r) * anomalySd(d);
    out.push(w.normal[d] + rho * rho * actual + rho * Math.sqrt(1 - rho * rho) * noise);
  }
  return out;
}

export interface FundamentalsForecast {
  /** Day of the gas year the forecast was made (the first forecast day). */
  fromDay: number;
  /** The forecast's weather path for each member (forecast days, then climate). */
  members: Array<{ temp: number[]; storage: number[]; calder: number[] }>;
  /** What actually happened from `fromDay` to the end of March. */
  actual: { temp: number[]; storage: number[]; calder: number[] };
  /** Mean of the members' storage and price paths. */
  meanStorage: number[];
  meanCalder: number[];
  /** Working gas on March 31: the members' mean and range, and what happened. */
  endMean: number;
  endLow: number;
  endHigh: number;
  endActual: number;
}

/**
 * Forecast the rest of a history year's gas year from `fromDay`: the forecast weather for
 * `horizon` days, then `members` climate scenarios, each run through the market model from the
 * storage actually in the ground that morning.
 */
export function forecastFundamentals(yearIndex: number, fromDay: number, opts: { skill: number; horizon?: number; members?: number; seed?: number }): FundamentalsForecast {
  const year = gasHistory()[yearIndex];
  const horizon = opts.horizon ?? 14;
  const members = opts.members ?? 8;
  const start: StorageState = fromDay === 0 ? year.start : year.days[fromDay - 1].storage;
  const days = GAS_YEAR_DAYS - fromDay;
  const fc = forecastTemps(year.weather, fromDay, horizon, opts.skill, opts.seed ?? year.seed);
  const c = year.conditions;
  // Each member runs the daily market month by month on the operators' plans for those months.
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
        production: () => ({ ridgeback: c.ridgeback, sandhill: c.sandhill }),
        capacity: () => ({ 'ridgeback-calder': c.ridgebackExpress }),
        demand: { lngBcfd: c.lngBcfd, scale: c.demandScale },
        fast: true,
      });
      out.push(...chunk);
      storage = { ...chunk[chunk.length - 1].storage };
    }
    return { temp: temps, storage: out.map((d) => d.storage.saltflat + d.storage.hollowcreek), calder: out.map((d) => d.price.calder) };
  };
  const out: FundamentalsForecast['members'] = [];
  for (let k = 0; k < members; k++) {
    const clim = weatherYear(5000 + k);
    const temps: number[] = [];
    for (let i = 0; i < days; i++) {
      const d = fromDay + i;
      temps.push(i < fc.length ? fc[i] : year.weather.normal[d] + (clim.temp[d] - clim.normal[d]));
    }
    out.push(run(temps));
  }
  const actual = {
    temp: year.weather.temp.slice(fromDay),
    storage: year.days.slice(fromDay).map((d) => d.storage.saltflat + d.storage.hollowcreek),
    calder: year.days.slice(fromDay).map((d) => d.price.calder),
  };
  const mean = (f: (m: (typeof out)[0]) => number[]) => Array.from({ length: days }, (_, i) => out.reduce((s, m) => s + f(m)[i], 0) / out.length);
  const ends = out.map((m) => m.storage[days - 1]);
  return {
    fromDay,
    members: out,
    actual,
    meanStorage: mean((m) => m.storage),
    meanCalder: mean((m) => m.calder),
    endMean: ends.reduce((a, b) => a + b, 0) / ends.length,
    endLow: Math.min(...ends),
    endHigh: Math.max(...ends),
    endActual: actual.storage[days - 1],
  };
}

/**
 * How far off a forecast of the heating degree days still to come in the gas year is, made on
 * `fromDay`: the root-mean-square error over `years` simulated years, degree days. Past the
 * forecast's horizon it predicts normal weather.
 */
export function remainingHddError(fromDay: number, skill: number, horizon = 14, years = 120): number {
  let s = 0;
  for (let k = 0; k < years; k++) {
    const w = weatherYear(7000 + k);
    const fc = forecastTemps(w, fromDay, horizon, skill, 7000 + k);
    let err = 0;
    for (let d = fromDay; d < GAS_YEAR_DAYS; d++) {
      const f = d - fromDay < fc.length ? fc[d - fromDay] : w.normal[d];
      err += hdd(w.temp[d]) - hdd(f);
    }
    s += err * err;
  }
  return Math.sqrt(s / years);
}
