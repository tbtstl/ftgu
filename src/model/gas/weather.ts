// Weather and the calendar of the gas course's region. The gas industry's year runs from April 1
// to March 31: an injection season (April–October, 214 days) and a withdrawal season
// (November–March, 151 days). Day 0 of a gas year is April 1.
//
// Metro's normal daily temperature follows a smooth annual curve, warmest around July 21 (76 °F)
// and coldest around January 20 (28 °F). A simulated year adds weather: day-to-day departures
// from normal that persist for days (an AR(1) process), larger in winter than in summer.
// Heating degree days (HDD) are how far the day's mean temperature falls below 65 °F; cooling
// degree days (CDD), how far it rises above. Gas demand for heating follows HDD almost linearly.

import { gaussian, rng } from '../random';

export const GAS_YEAR_DAYS = 365;
/** Month names and lengths in gas-year order, April first. */
export const GAS_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'] as const;
export const GAS_MONTH_NAMES = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'] as const;
export const GAS_MONTH_DAYS = [30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28, 31];
/** Day of the gas year on which each month starts. */
export const GAS_MONTH_START = GAS_MONTH_DAYS.map((_, i) => GAS_MONTH_DAYS.slice(0, i).reduce((a, b) => a + b, 0));
/** Days in the injection season (April–October). */
export const INJECTION_DAYS = 214;
/** Day of the gas year on which the withdrawal season starts (November 1). */
export const WINTER_START = 214;

/** Month index (0 = April) of a day of the gas year. */
export function monthOfDay(day: number): number {
  const d = ((Math.floor(day) % GAS_YEAR_DAYS) + GAS_YEAR_DAYS) % GAS_YEAR_DAYS;
  let m = 11;
  while (GAS_MONTH_START[m] > d) m--;
  return m;
}

/** "Jan 20" for a day of the gas year. */
export function gasDayLabel(day: number): string {
  const d = ((Math.floor(day) % GAS_YEAR_DAYS) + GAS_YEAR_DAYS) % GAS_YEAR_DAYS;
  const m = monthOfDay(d);
  return `${GAS_MONTHS[m]} ${d - GAS_MONTH_START[m] + 1}`;
}

/** Metro's normal daily mean temperature (°F) on a day of the gas year. */
export function normalTemp(day: number): number {
  return 52 + 24 * Math.cos((2 * Math.PI * (day - 111.5)) / GAS_YEAR_DAYS);
}

export function hdd(tempF: number): number {
  return Math.max(0, 65 - tempF);
}

export function cdd(tempF: number): number {
  return Math.max(0, tempF - 65);
}

/** Standard deviation of the day-to-day departure from normal temperature, °F: 4 in midsummer, 8 in midwinter. */
export function anomalySd(day: number): number {
  return 6 - 2 * Math.cos((2 * Math.PI * (day - 111.5)) / GAS_YEAR_DAYS);
}

export interface WeatherYear {
  /** Daily mean temperature, °F, April 1 to March 31. */
  temp: number[];
  /** The normal temperature for each day. */
  normal: number[];
  hdd: number[];
  cdd: number[];
}

/**
 * A simulated gas year of Metro weather: the normal curve plus persistent departures (AR(1) with
 * the given day-to-day persistence). `shift` moves the whole year warmer or colder, °F, and
 * `severity` scales the departures. Seeded, so a year is the same on every visit.
 */
export function weatherYear(seed: number, opts: { persistence?: number; shift?: number; severity?: number } = {}): WeatherYear {
  const r = rng(seed);
  const phi = opts.persistence ?? 0.75;
  const shift = opts.shift ?? 0;
  const sev = opts.severity ?? 1;
  const temp: number[] = [];
  const normal: number[] = [];
  let z = 0;
  for (let d = 0; d < GAS_YEAR_DAYS; d++) {
    z = phi * z + Math.sqrt(1 - phi * phi) * gaussian(r);
    const n = normalTemp(d);
    normal.push(n);
    temp.push(n + shift + sev * anomalySd(d) * z);
  }
  return { temp, normal, hdd: temp.map(hdd), cdd: temp.map(cdd) };
}

/** The normal year: every day at its normal temperature. */
export function normalYear(): WeatherYear {
  const temp = Array.from({ length: GAS_YEAR_DAYS }, (_, d) => normalTemp(d));
  return { temp, normal: temp.slice(), hdd: temp.map(hdd), cdd: temp.map(cdd) };
}
