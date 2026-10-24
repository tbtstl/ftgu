// Degree days: how far a day's mean temperature falls below (heating) or rises above (cooling)
// a base of 65 °F, the convention US energy companies and the CME's weather futures use. The
// daily mean is (max + min) / 2. Also the region's gas utility and how its sendout follows them.

import { tempF, monthDays, YEARS } from '../../model/weather/archive';
import { MONTH_DAYS } from '../../model/weather/region';

export const BASE_F = 65;

/** Heating degree days for one day: max(0, 65 − mean). */
export function hdd(meanF: number, base = BASE_F): number {
  return Math.max(0, base - meanF);
}

/** Cooling degree days for one day: max(0, mean − 65). */
export function cdd(meanF: number, base = BASE_F): number {
  return Math.max(0, meanF - base);
}

export type DegreeKind = 'HDD' | 'CDD';

export function degreeDays(kind: DegreeKind, meanF: number, base = BASE_F): number {
  return kind === 'HDD' ? hdd(meanF, base) : cdd(meanF, base);
}

/** The index over a run of daily means: the sum of each day's degree days. */
export function indexOf(kind: DegreeKind, means: number[], base = BASE_F): number {
  return means.reduce((s, m) => s + degreeDays(kind, m, base), 0);
}

/** Calder Bay's monthly index for a year of the archive. */
export function monthIndex(kind: DegreeKind, year: number, month: number, base = BASE_F): number {
  const { start, days } = monthDays(year, month);
  let s = 0;
  for (let i = 0; i < days; i++) s += degreeDays(kind, tempF('calder', start + i), base);
  return s;
}

/** The monthly index in every year of the archive that has the month (years 1–41). */
export function monthIndexHistory(kind: DegreeKind, month: number, base = BASE_F): number[] {
  return Array.from({ length: YEARS }, (_, i) => monthIndex(kind, i + 1, month, base));
}

/** Degree days from a month's average temperature alone — the shortcut that undercounts. */
export function indexFromMonthlyMean(kind: DegreeKind, meanOfMonth: number, days: number, base = BASE_F): number {
  return days * degreeDays(kind, meanOfMonth, base);
}

export { MONTH_DAYS };

// ---------------------------------------------------------------------------
// Calder Gas & Light, the city's gas utility.

export const UTILITY = {
  name: 'Calder Gas & Light',
  /** Gas used whatever the weather — water heating, cooking, industry — MMBtu per day. */
  baseLoad: 150_000,
  /** Extra gas for each heating degree day, MMBtu. */
  perHdd: 18_000,
  /** What the utility earns for delivering gas, above what it pays for it, $ per MMBtu. */
  margin: 3,
  /** Wind makes buildings lose heat faster: 2% more heating load per m/s above the city's average wind. */
  perWindMs: 0.02,
  /** The city's average wind speed, m/s. */
  meanWind: 5.3,
};

/**
 * The utility's sendout on a day with `h` heating degree days, MMBtu; with the day's wind at the
 * city, if known (windier days need more heat for the same temperature).
 */
export function sendout(h: number, windMs?: number): number {
  const wind = windMs === undefined ? 1 : 1 + UTILITY.perWindMs * (windMs - UTILITY.meanWind);
  return UTILITY.baseLoad + UTILITY.perHdd * h * wind;
}

/** The city's wind on a day of the archive: Calder Bay sits lower and more sheltered than Hollin Ridge, about 0.7 times its hub-height wind. */
export const CITY_WIND_SHARE = 0.7;

// ---------------------------------------------------------------------------
// Electricity demand and temperature.

/**
 * How much the region's electricity demand is scaled from the electricity course's reference day
 * (a mild day with a 60 °F mean) by a day's temperature: 0.4% more per heating degree day beyond
 * that day's 5, and 1.3% more per cooling degree day, as air conditioners switch on.
 */
export function demandFactor(meanF: number): number {
  return 1 + 0.004 * (hdd(meanF) - 5) + 0.013 * cdd(meanF);
}
