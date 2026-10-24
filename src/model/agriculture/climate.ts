// The Crane Valley's weather: climate normals for each district as smooth curves over the year,
// and a seeded generator for the daily weather of any simulated year. Years are correlated across
// the valley — a hot, dry July is usually hot and dry everywhere — and within a summer, heat and
// drought tend to come together, as they do in real grain belts.

import { gaussian, rng, type Rng } from '../random';
import { DISTRICT, DISTRICT_IDS, type District, type DistrictId } from './region';

export interface DayWeather {
  /** Daily high and low, °C. */
  tmax: number;
  tmin: number;
  /** Precipitation, inches. */
  rain: number;
  /** Solar radiation reaching the ground, MJ per m² per day. */
  srad: number;
}

const TAU = 2 * Math.PI;
/** Warmest day of a normal year (July 17). */
const PEAK_DAY = 197;
/** Wettest stretch of a normal year (early June). */
const WET_DAY = 158;
/** The latitude band of the valley sets how much sunlight reaches the top of the atmosphere. */
const RA_MEAN = 26;
const RA_SWING = 15.5;

/** Normal daily mean temperature, °C, for day of year d (0 = January 1). */
export function normalTemp(district: District, d: number): number {
  return district.tAvg + district.tAmp * Math.cos((TAU * (d - PEAK_DAY)) / 365);
}

/** Normal daily range between high and low, °C: a little wider in summer. */
export function normalRange(district: District, d: number): number {
  return district.diurnal + 1.5 * Math.cos((TAU * (d - PEAK_DAY)) / 365);
}

/** Sunlight at the top of the atmosphere, MJ per m² per day (about 41° N). */
export function extraterrestrial(d: number): number {
  return RA_MEAN + RA_SWING * Math.cos((TAU * (d - 172)) / 365);
}

/** Normal rain per day, inches: the annual total shaped toward late spring and early summer. */
export function normalRain(district: District, d: number): number {
  return (district.rainIn / 365) * (1 + district.rainSeason * Math.cos((TAU * (d - WET_DAY)) / 365));
}

/** Chance that a day is wet (at least a trace worth counting). */
export function wetChance(district: District, d: number): number {
  const base = 0.12 + 0.006 * district.rainIn;
  return Math.min(0.6, base * (1 + 0.35 * Math.cos((TAU * (d - WET_DAY)) / 365)));
}

/** Solar radiation on a clear-ish dry day and on a wet day, MJ per m² per day. */
export function sunlight(district: District, d: number, wet: boolean): number {
  const ra = extraterrestrial(d);
  return ra * (wet ? 0.36 : 0.62 + district.sun);
}

/** The normal weather for a whole year, smooth, with no day-to-day noise. */
export function normalYear(districtId: DistrictId): DayWeather[] {
  const dist = DISTRICT[districtId];
  return Array.from({ length: 365 }, (_, d) => {
    const t = normalTemp(dist, d);
    const r = normalRange(dist, d);
    const p = wetChance(dist, d);
    return {
      tmax: t + r / 2,
      tmin: t - r / 2,
      rain: normalRain(dist, d),
      srad: p * sunlight(dist, d, true) + (1 - p) * sunlight(dist, d, false),
    };
  });
}

// ---------------------------------------------------------------------------
// Simulated years.

/** A year's departures from normal, by month: temperature in °C, rain as a multiplier. */
export interface YearAnomaly {
  temp: number[];
  rain: number[];
}

/** Shifts applied on top of a simulated year (the lessons' "what if" controls). */
export interface WeatherShift {
  /** Added to every day's high and low, °C. */
  temp?: number;
  /** Multiplies every day's rain. */
  rain?: number;
  /** Optional per-month extra temperature, °C (12 values). */
  monthTemp?: number[];
  /** Optional per-month rain multipliers (12 values). */
  monthRain?: number[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Monthly anomalies for one year, with month-to-month persistence. */
function monthly(r: Rng, sdT: number, sdR: number): YearAnomaly {
  const temp: number[] = [];
  const rain: number[] = [];
  let t = 0;
  let w = 0;
  for (let m = 0; m < 12; m++) {
    t = 0.5 * t + Math.sqrt(1 - 0.25) * sdT * gaussian(r);
    w = 0.4 * w + Math.sqrt(1 - 0.16) * sdR * gaussian(r);
    temp.push(t);
    rain.push(w);
  }
  return { temp, rain };
}

/**
 * A district's anomalies in simulated year `year`: a valley-wide part shared by every district
 * plus a local part. In summer, hot months are drier and cool ones wetter.
 */
export function yearAnomaly(year: number, districtId: DistrictId): YearAnomaly {
  const common = monthly(rng(hash(`valley-${year}`)), 1.15, 0.3);
  const local = monthly(rng(hash(`${districtId}-${year}`)), 0.55, 0.22);
  const temp = common.temp.map((t, m) => 0.9 * t + local.temp[m]);
  const rain = common.rain.map((w, m) => {
    const summer = m >= 4 && m <= 8;
    return Math.exp(0.9 * w + local.rain[m] - (summer ? 0.16 * temp[m] : 0) - 0.16);
  });
  return { temp, rain };
}

/** Linear interpolation of a monthly series to day d, centered mid-month. */
function monthAt(series: number[], d: number): number {
  const x = (d + 0.5) / (365 / 12) - 0.5;
  const i = Math.floor(x);
  const k = x - i;
  const a = series[(i + 12) % 12];
  const b = series[(i + 1 + 12) % 12];
  return a + (b - a) * k;
}

const yearCache = new Map<string, DayWeather[]>();

/**
 * The daily weather of simulated year `year` in a district: normals, plus the year's monthly
 * anomalies, plus day-to-day noise (temperatures persist for a few days; wet days cluster).
 * The same year and district always give the same weather.
 */
export function simulatedYear(year: number, districtId: DistrictId, shift: WeatherShift = {}): DayWeather[] {
  const key = `${year}|${districtId}`;
  let base = yearCache.get(key);
  if (!base) {
    base = generate(year, districtId);
    if (yearCache.size > 3000) yearCache.clear();
    yearCache.set(key, base);
  }
  return applyShift(base, shift);
}

function generate(year: number, districtId: DistrictId): DayWeather[] {
  const dist = DISTRICT[districtId];
  const an = yearAnomaly(year, districtId);
  const r = rng(hash(`days-${districtId}-${year}`));
  const out: DayWeather[] = [];
  let noise = 0;
  let wetYesterday = false;
  for (let d = 0; d < 365; d++) {
    noise = 0.75 * noise + Math.sqrt(1 - 0.5625) * 2.4 * gaussian(r);
    const mult = monthAt(an.rain, d);
    const p0 = wetChance(dist, d);
    // Wet days cluster: rain is likelier the day after rain. Wetter months have more and bigger rains.
    const p = Math.min(0.85, (wetYesterday ? p0 + 0.22 * (1 - p0) : p0 * 0.86) * Math.sqrt(mult));
    const wet = r() < p;
    const meanAmount = normalRain(dist, d) / p0;
    const rain = wet ? -Math.log(1 - r() * 0.999) * meanAmount * Math.sqrt(mult) : 0;
    const t = normalTemp(dist, d) + monthAt(an.temp, d) + noise + (wet ? -1.4 * (1 - p0) : 1.4 * p0);
    const range = normalRange(dist, d) * (wet ? 0.7 : 1.08);
    out.push({ tmax: t + range / 2, tmin: t - range / 2, rain, srad: sunlight(dist, d, wet) * (0.92 + 0.16 * r()) });
    wetYesterday = wet;
  }
  return out;
}

/** Applies a "what if" shift to a year's weather. */
export function applyShift(days: DayWeather[], shift: WeatherShift): DayWeather[] {
  const { temp = 0, rain = 1, monthTemp, monthRain } = shift;
  if (!temp && rain === 1 && !monthTemp && !monthRain) return days;
  return days.map((w, d) => {
    const mt = monthTemp ? monthAt(monthTemp, d) : 0;
    const mr = monthRain ? Math.max(0, monthAt(monthRain, d)) : 1;
    return { tmax: w.tmax + temp + mt, tmin: w.tmin + temp + mt, rain: w.rain * rain * mr, srad: w.srad };
  });
}

/**
 * The reference season: simulated year 40, a typical year in the valley — rain and temperature
 * close to normal through the summer, no killing frost, and Black Prairie corn near its usual yield.
 * Chapter 1 grows Cedar Bend's crops in it.
 */
export const REFERENCE_YEAR = 40;

/**
 * A year whose weather is `known` before day `cutoff` and `future` from then on: what a forecaster
 * on day `cutoff` faces — the season so far is fixed, the rest could be any year's.
 */
export function spliceWeather(known: DayWeather[], future: DayWeather[], cutoff: number): DayWeather[] {
  if (cutoff <= 0) return future;
  if (cutoff >= known.length) return known;
  return known.slice(0, cutoff).concat(future.slice(cutoff));
}

/**
 * The day autumn's first cold spell is complete: the fourth day in a row with a daily mean below
 * 12 °C, after `from`. Corn still filling its kernels then stops (a premature black layer).
 */
export function firstColdSpell(days: DayWeather[], from = 213): number {
  let run = 0;
  for (let d = from; d < days.length; d++) {
    run = (days[d].tmax + days[d].tmin) / 2 < 12 ? run + 1 : 0;
    if (run >= 4) return d;
  }
  return days.length;
}

/** Total rain over days [from, to), inches. */
export function rainBetween(days: DayWeather[], from: number, to: number): number {
  let s = 0;
  for (let d = Math.max(0, from); d < Math.min(days.length, to); d++) s += days[d].rain;
  return s;
}

/** Mean daily mean temperature over days [from, to), °C. */
export function tempBetween(days: DayWeather[], from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (let d = Math.max(0, from); d < Math.min(days.length, to); d++) {
    s += (days[d].tmax + days[d].tmin) / 2;
    n++;
  }
  return n ? s / n : 0;
}

/** Last day in spring (before July) and first day in fall (after July) with a low at or below `limit` °C. */
export function frostDates(days: DayWeather[], limit = 0): { lastSpring: number; firstFall: number } {
  let lastSpring = -1;
  let firstFall = 365;
  for (let d = 0; d < 182; d++) if (days[d].tmin <= limit) lastSpring = d;
  for (let d = 182; d < 365; d++)
    if (days[d].tmin <= limit) {
      firstFall = d;
      break;
    }
  return { lastSpring, firstFall };
}

export { DISTRICT_IDS };
