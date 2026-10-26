// What the weather does to three businesses in the Fenwick region, season by season, over the
// archive: the gas utility's winter margin (more cold, more gas sold), the Marlow corn farm's
// profit (heat and drought cut the yield), and the Hollin Ridge wind farm's year (more wind, more
// power to sell). The archive is simulated; so are these businesses.

import { archive, monthDays, tempF, YEARS, type WorldKnobs } from '../../model/weather/archive';
import { CITY_WIND_SHARE, UTILITY, hdd, sendout } from './degreeDays';
import { farmSeason, yieldHistory, type YieldParams, YIELD_PARAMS } from './crops';
import { RIDGE_MW, airDensity, dailyWindCf, RHO_STANDARD } from './renewables';

/** The months of the heating season, November through March: [year offset, month]. */
export const WINTER_MONTHS: Array<[number, number]> = [
  [0, 10],
  [0, 11],
  [1, 0],
  [1, 1],
  [1, 2],
];

export interface UtilityWinter {
  /** Winter number: November of year y through March of year y + 1. */
  winter: number;
  hdd: number;
  /** Gas delivered, MMBtu. */
  volume: number;
  /** Margin earned on it, $. */
  margin: number;
}

/** Fenwick Bay's heating degree days over winter y (November y – March y + 1). */
export function winterHdd(y: number, knobs: WorldKnobs = {}): number {
  let s = 0;
  for (const [dy, m] of WINTER_MONTHS) {
    const { start, days } = monthDays(y + dy, m);
    for (let i = 0; i < days; i++) s += hdd(tempF('fenwick', start + i, knobs));
  }
  return s;
}

/** Days in the heating season. */
export const WINTER_DAYS = WINTER_MONTHS.reduce((s, [, m]) => s + monthDays(1, m).days, 0);

/**
 * The utility's winter: its sendout day by day (heating degree days at Fenwick Bay, scaled up on
 * windy days), and the margin it earns on it. The wind is why the margin doesn't follow the
 * degree days exactly.
 */
export function utilityWinter(y: number, knobs: WorldKnobs = {}, u = UTILITY): UtilityWinter {
  const a = archive();
  let h = 0;
  let volume = 0;
  for (const [dy, m] of WINTER_MONTHS) {
    const { start, days } = monthDays(y + dy, m);
    for (let i = 0; i < days; i++) {
      const dh = hdd(tempF('fenwick', start + i, knobs));
      h += dh;
      const wind = CITY_WIND_SHARE * a.wind[start + i];
      volume += u.baseLoad + u.perHdd * dh * (1 + u.perWindMs * (wind - u.meanWind));
    }
  }
  return { winter: y, hdd: h, volume, margin: u.margin * volume };
}

/** Every winter in the archive (1–40). */
export function utilityWinters(knobs: WorldKnobs = {}, u = UTILITY): UtilityWinter[] {
  return Array.from({ length: YEARS - 1 }, (_, i) => utilityWinter(i + 1, knobs, u));
}

/** The utility's sensitivity: dollars of margin per heating degree day. */
export function utilityDollarsPerHdd(u = UTILITY): number {
  return u.margin * u.perHdd;
}

/** A day's sendout in one call, for charts. */
export { sendout };

export interface WindYear {
  year: number;
  mwh: number;
  revenue: number;
  /** Capacity factor over the year. */
  cf: number;
}

/** Price the wind farm is paid under its long-term contract, $/MWh. */
export const WIND_PPA = 45;

/**
 * Hollin Ridge's output in a year of the archive. Each day's mean wind sets its output through
 * the power curve, adjusted for that day's air density (colder air carries more power).
 */
export function windYear(year: number, opts: { windScale?: number; ppa?: number } = {}): WindYear {
  const a = archive();
  const scale = opts.windScale ?? 1;
  let mwh = 0;
  const start = (year - 1) * 365;
  for (let i = 0; i < 365; i++) {
    const d = start + i;
    const tC = ((tempF('ridge', d) - 32) * 5) / 9;
    const rho = airDensity(tC, 930);
    mwh += dailyWindCf(a.wind[d] * scale, (rho / airDensity(10, 930)) * RHO_STANDARD) * RIDGE_MW * 24;
  }
  return { year, mwh, revenue: mwh * (opts.ppa ?? WIND_PPA), cf: mwh / (RIDGE_MW * 24 * 365) };
}

export function windYears(opts: { windScale?: number; ppa?: number } = {}): WindYear[] {
  return Array.from({ length: YEARS }, (_, i) => windYear(i + 1, opts));
}

export interface FarmYear {
  year: number;
  bushelsPerAcre: number;
  price: number;
  profit: number;
}

export function farmYears(nationalShare: number, knobs: WorldKnobs = {}, p: YieldParams = YIELD_PARAMS): FarmYear[] {
  return yieldHistory(knobs, p).map((y) => {
    const f = farmSeason(y.bushels, nationalShare);
    return { year: y.year, bushelsPerAcre: y.bushels, price: f.price, profit: f.profit };
  });
}

export interface Summary {
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** 5th and 95th percentiles. */
  p5: number;
  p95: number;
}

export function summarize(xs: number[]): Summary {
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = p * (n - 1);
    const lo = Math.floor(i);
    return sorted[lo] + (sorted[Math.min(n - 1, lo + 1)] - sorted[lo]) * (i - lo);
  };
  return { mean, sd, min: sorted[0], max: sorted[n - 1], p5: q(0.05), p95: q(0.95) };
}

/**
 * Least-squares slope and fit of y on x: how many dollars of a business's cash flow move with
 * each unit of a weather index, and how much of the variation the index explains (R²).
 */
export function regress(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}
