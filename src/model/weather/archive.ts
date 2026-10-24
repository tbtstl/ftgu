// The Calder region's simulated weather history: 41 years of daily temperatures at its three
// stations, daily rain at Calder Bay and Marlow, daily wind on Hollin Ridge, the Pacific's
// Niño-3.4 index month by month — and every forecast the course's model issued along the way.
//
// Nothing here is real data. It's a simulated archive, built so that forecasts are honest: the
// weather on any day is the sum of pieces of information that are revealed one by one, the
// first about fifteen days ahead and the last on the day itself. A forecast issued on day t
// is built only from the pieces revealed on or before day t. The pieces still to come are drawn
// later from the random-number stream, so no forecast ever sees the outcome it predicts.
// (In forecasting research this structure is called a martingale model of forecast evolution.)

import { gaussian, rng } from '../random';
import { ENSO_DEFAULTS, ensoHistory, projectEnso, type EnsoState } from '../../engines/weather/enso';
import { ENSO_MONTH_WEIGHT, MONTH_DAYS, MONTH_START, anomalySd, monthOf, normalTemp, stationClimate, type Climate, type StationId } from './region';

/** Calendar years in the archive (365-day years, numbered 1–41). */
export const YEARS = 41;
export const DAYS = YEARS * 365;
/** The longest lead at which a forecast knows anything about the day-to-day weather, days. */
export const LEAD_MAX = 15;
/** Share of a day's weather that no forecast can know until the day itself. */
export const UNPREDICTABLE = 0.12;
/** The predictability time scale: the predictable share decays as exp(−(lead/κ)²), days. */
export const PREDICTABILITY_DAYS = 7;
/** Correlation between the pieces revealed on the same day about consecutive target days. */
export const SAME_DAY_CORRELATION = 0.72;
/** Long-run warming of every station, °F per year (the normals are centered on year 21). */
export const TREND_F_PER_YEAR = 0.03;
/** Correlation of Marlow's and Hollin Ridge's daily anomalies with Calder Bay's. */
export const STATION_CORRELATION: Record<StationId, number> = { calder: 1, marlow: 0.8, ridge: 0.92 };
/** Day-to-day persistence of each station's own part of its anomaly. */
const LOCAL_PERSISTENCE = 0.65;

/**
 * Share of the day-to-day weather's variance known `lead` days ahead: 1 on the day, then
 * (1 − ν)·exp(−(lead/κ)²), and nothing beyond LEAD_MAX.
 */
export function knownShare(lead: number, kappa = PREDICTABILITY_DAYS): number {
  if (lead <= 0) return 1;
  if (lead > LEAD_MAX) return 0;
  return (1 - UNPREDICTABLE) * Math.exp(-((lead / kappa) ** 2));
}

/** Variance revealed exactly `lead` days ahead (sums to 1 over leads 0…LEAD_MAX). */
export function revealedShare(lead: number): number {
  return knownShare(lead) - knownShare(lead + 1);
}

export interface DayInfo {
  /** 0-based day index into the archive. */
  d: number;
  /** Year, 1–41. */
  year: number;
  /** Day of the year, 0 = January 1. */
  doy: number;
  /** Month, 0–11. */
  month: number;
  /** Day of the month, 1-based. */
  dom: number;
}

export function dayInfo(d: number): DayInfo {
  const year = Math.floor(d / 365) + 1;
  const doy = ((d % 365) + 365) % 365;
  const month = monthOf(doy);
  return { d, year, doy, month, dom: doy - MONTH_START[month] + 1 };
}

/** Archive index of a day: year 1–41, month 0–11, day of month 1-based. */
export function dayIndex(year: number, month: number, dom = 1): number {
  return (year - 1) * 365 + MONTH_START[month] + dom - 1;
}

/** First day and length of a month in the archive. */
export function monthDays(year: number, month: number): { start: number; days: number } {
  return { start: dayIndex(year, month, 1), days: MONTH_DAYS[month] };
}

export interface ArchiveData {
  /** Calder Bay's standardized weather anomaly, one per day. */
  z: Float64Array;
  /**
   * Pieces of information: piece[d·(LEAD_MAX+1) + k] is what was revealed about day d, k days
   * ahead of it. Their sum over k is z[d].
   */
  piece: Float64Array;
  /** Suffix sums: known[d·(LEAD_MAX+2) + k] is everything revealed about day d at least k days ahead. */
  known: Float64Array;
  /** Marlow's and Hollin Ridge's own (local) parts of their anomalies, standardized. */
  local: Record<'marlow' | 'ridge', Float64Array>;
  /** The Niño-3.4 index and thermocline state, month by month (12 more than the archive's months). */
  enso: EnsoState[];
  /** Daily precipitation, inches. */
  rain: Record<'calder' | 'marlow', Float64Array>;
  /** Daily mean wind speed at hub height on Hollin Ridge, m/s. */
  wind: Float64Array;
}

let cache: ArchiveData | null = null;

/** The archive, built on first use (about 20 ms) and kept for the session. */
export function archive(): ArchiveData {
  if (cache) return cache;
  const H = LEAD_MAX;
  const r = rng(20261024);
  const piece = new Float64Array(DAYS * (H + 1));
  const rho = SAME_DAY_CORRELATION;
  const root = Array.from({ length: H + 1 }, (_, k) => Math.sqrt(revealedShare(k)));
  const e = new Float64Array(H + 1);
  // Day by day, in order: on day t, reveal a piece about each of days t … t+H.
  for (let t = -H; t < DAYS; t++) {
    e[0] = gaussian(r);
    for (let k = 1; k <= H; k++) e[k] = rho * e[k - 1] + Math.sqrt(1 - rho * rho) * gaussian(r);
    for (let k = 0; k <= H; k++) {
      const d = t + k;
      if (d >= 0 && d < DAYS) piece[d * (H + 1) + k] = root[k] * e[k];
    }
  }
  const z = new Float64Array(DAYS);
  const known = new Float64Array(DAYS * (H + 2));
  for (let d = 0; d < DAYS; d++) {
    let s = 0;
    for (let k = H; k >= 0; k--) {
      s += piece[d * (H + 1) + k];
      known[d * (H + 2) + k] = s;
    }
    z[d] = s;
  }

  const local = { marlow: ar1Series(r, DAYS, LOCAL_PERSISTENCE), ridge: ar1Series(r, DAYS, LOCAL_PERSISTENCE) };
  const enso = ensoHistory(YEARS * 12 + 12, ENSO_DEFAULTS, 1997);

  // Rain: wet days follow a two-state Markov chain; amounts are gamma-distributed. At Marlow a
  // hot spell makes a wet day less likely in the growing season (hot summers tend to be dry).
  const rain = { calder: new Float64Array(DAYS), marlow: new Float64Array(DAYS) };
  for (const id of ['calder', 'marlow'] as const) {
    const cfg = RAIN[id];
    let wet = false;
    for (let d = 0; d < DAYS; d++) {
      const { month } = dayInfo(d);
      const pi = cfg.wetShare[month];
      const pww = 0.5;
      let pwd = (pi * (1 - pww)) / (1 - pi);
      if (id === 'marlow' && month >= 4 && month <= 8) pwd *= Math.exp(-0.3 * marlowZ(d));
      const p: number = wet ? pww : pwd;
      wet = r() < p;
      if (wet) {
        const meanWet = cfg.monthly[month] / (MONTH_DAYS[month] * pi);
        rain[id][d] = Math.round(gamma(r, 0.8) * (meanWet / 0.8) * 100) / 100;
      }
    }
  }

  // Wind: a persistent Gaussian series mapped onto a Weibull distribution whose scale is
  // larger in winter than in summer.
  const g = ar1Series(r, DAYS, 0.55);
  const wind = new Float64Array(DAYS);
  for (let d = 0; d < DAYS; d++) {
    const { doy } = dayInfo(d);
    const c = WIND_SCALE_MEAN + WIND_SCALE_SWING * Math.cos((2 * Math.PI * (doy - 15)) / 365);
    const u = Math.min(1 - 1e-9, normCdf(g[d]));
    wind[d] = c * Math.pow(-Math.log(1 - u), 1 / WIND_SHAPE);
  }

  cache = { z, piece, known, local, enso, rain, wind };
  return cache;

  function marlowZ(d: number): number {
    const c = STATION_CORRELATION.marlow;
    return c * z[d] + Math.sqrt(1 - c * c) * local.marlow[d];
  }
}

/** Monthly rainfall normals (inches) and the share of days that are wet, by month. */
export const RAIN: Record<'calder' | 'marlow', { monthly: number[]; wetShare: number[] }> = {
  calder: { monthly: [3.6, 3.1, 4.2, 4.1, 4.0, 4.2, 4.4, 4.2, 4.0, 3.9, 3.6, 4.0], wetShare: [0.33, 0.32, 0.35, 0.36, 0.36, 0.33, 0.32, 0.3, 0.29, 0.29, 0.32, 0.34] },
  marlow: { monthly: [1.6, 1.7, 2.4, 3.5, 4.4, 4.6, 4.0, 4.1, 3.2, 2.8, 2.4, 2.0], wetShare: [0.28, 0.27, 0.3, 0.34, 0.36, 0.35, 0.31, 0.29, 0.28, 0.27, 0.28, 0.29] },
};

/** Hollin Ridge's wind: Weibull shape, and a scale of 8.6 ± 1.4 m/s through the year (largest in mid-January). */
export const WIND_SHAPE = 2.2;
export const WIND_SCALE_MEAN = 8.6;
export const WIND_SCALE_SWING = 1.4;

function ar1Series(r: () => number, n: number, phi: number): Float64Array {
  const out = new Float64Array(n);
  let x = gaussian(r);
  const s = Math.sqrt(1 - phi * phi);
  for (let i = 0; i < n; i++) {
    x = phi * x + s * gaussian(r);
    out[i] = x;
  }
  return out;
}

/** Gamma(shape, 1) sample (Marsaglia–Tsang, boosted for shape < 1). */
function gamma(r: () => number, shape: number): number {
  if (shape < 1) return gamma(r, shape + 1) * Math.pow(Math.max(r(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gaussian(r);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = r();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** Standard normal cumulative distribution. */
export function normCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// ---------------------------------------------------------------------------
// Reading the archive.

/** Physical knobs a lesson can turn without changing the random weather underneath. */
export interface WorldKnobs {
  /** Winter warming per °C of Niño-3.4, °F (default: the station's own). */
  ensoF?: number;
  /** Multiplies the day-to-day variability (default 1). */
  variability?: number;
  /** Warming per year, °F (default TREND_F_PER_YEAR). */
  trend?: number;
}

/** The Niño-3.4 index on a day, interpolated between mid-month values, °C. */
export function ninoAt(d: number): number {
  const a = archive();
  const { year, month, dom } = dayInfo(d);
  const m = (year - 1) * 12 + month;
  const frac = (dom - 0.5) / MONTH_DAYS[month] - 0.5;
  const m2 = Math.max(0, Math.min(a.enso.length - 1, frac >= 0 ? m + 1 : m - 1));
  const w = Math.abs(frac);
  return a.enso[m].t * (1 - w) + a.enso[m2].t * w;
}

/** Niño-3.4 for a month of the archive (year 1–42, month 0–11), °C. */
export function ninoMonth(year: number, month: number): number {
  const a = archive();
  return a.enso[Math.max(0, Math.min(a.enso.length - 1, (year - 1) * 12 + month))].t;
}

/**
 * The oscillator's forecast, made at the end of month (year, month), of Niño-3.4 `ahead` months
 * later: the state then, projected forward with no further kicks.
 */
export function ninoForecast(year: number, month: number, ahead: number): number {
  const a = archive();
  const i = Math.max(0, Math.min(a.enso.length - 1, (year - 1) * 12 + month));
  return projectEnso(a.enso[i], ENSO_DEFAULTS, ahead)[ahead].t;
}

/** A station's standardized anomaly on a day. */
export function stationZ(id: StationId, d: number): number {
  const a = archive();
  if (id === 'calder') return a.z[d];
  const c = STATION_CORRELATION[id];
  return c * a.z[d] + Math.sqrt(1 - c * c) * a.local[id][d];
}

/** Year offset from the archive's middle (year 21), for the trend. */
function yearsFromMiddle(d: number) {
  return dayInfo(d).year - (YEARS + 1) / 2;
}

/** The normal temperature on a day, including the trend to that year, °F. */
export function expectedTemp(id: StationId, d: number, knobs: WorldKnobs = {}): number {
  const cl = stationClimate(id);
  return normalTemp(cl, dayInfo(d).doy) + (knobs.trend ?? TREND_F_PER_YEAR) * yearsFromMiddle(d);
}

/** What the station recorded: its daily mean temperature, °F. */
export function tempF(id: StationId, d: number, knobs: WorldKnobs = {}): number {
  const cl = stationClimate(id);
  const { doy, month } = dayInfo(d);
  const enso = (knobs.ensoF ?? cl.ensoF) * ENSO_MONTH_WEIGHT[month] * ninoAt(d);
  return expectedTemp(id, d, knobs) + anomalySd(cl, doy) * (knobs.variability ?? 1) * stationZ(id, d) + enso;
}

export interface Forecast {
  /** Expected daily mean temperature, °F. */
  mean: number;
  /** Standard deviation of the error, °F. */
  sd: number;
}

/**
 * The forecast of a station's temperature on day `d`, issued `lead` days earlier (on day d − lead),
 * from only what was known then. Lead 0 is the outcome itself.
 */
export function forecastTemp(id: StationId, d: number, lead: number, knobs: WorldKnobs = {}): Forecast {
  const a = archive();
  const cl = stationClimate(id);
  const { doy, month } = dayInfo(d);
  const sdDay = anomalySd(cl, doy) * (knobs.variability ?? 1);
  if (lead <= 0) return { mean: tempF(id, d, knobs), sd: 0 };
  const H = LEAD_MAX;
  const knownZ = lead > H ? 0 : a.known[d * (H + 2) + lead];
  const share = knownShare(lead);
  let mean: number;
  let varZ: number;
  if (id === 'calder') {
    mean = knownZ;
    varZ = 1 - share;
  } else {
    const c = STATION_CORRELATION[id];
    const issue = d - lead;
    const localNow = issue >= 0 ? a.local[id][issue] : 0;
    const decay = LOCAL_PERSISTENCE ** lead;
    mean = c * knownZ + Math.sqrt(1 - c * c) * decay * localNow;
    varZ = c * c * (1 - share) + (1 - c * c) * (1 - decay * decay);
  }
  // ENSO: the oscillator's projection from the month the forecast was issued in.
  const issue = dayInfo(Math.max(0, d - lead));
  const monthsAhead = (dayInfo(d).year - issue.year) * 12 + (month - issue.month);
  const nino = monthsAhead <= 0 ? ninoAt(Math.max(0, d - lead)) : ninoForecast(issue.year, issue.month, monthsAhead);
  const enso = (knobs.ensoF ?? cl.ensoF) * ENSO_MONTH_WEIGHT[month] * nino;
  return { mean: expectedTemp(id, d, knobs) + sdDay * mean + enso, sd: sdDay * Math.sqrt(varZ) };
}

/**
 * Temperature on day `d` at an imagined station with climate `cl`, driven by the weather sequence
 * of one of the region's stations (Calder Bay's by default), °F. Lets a lesson build a station
 * anywhere and give it the same days of weather, reshaped by its own climate.
 */
export function tempForClimate(cl: Climate, d: number, like: StationId = 'calder', knobs: WorldKnobs = {}): number {
  const { doy, month } = dayInfo(d);
  const trend = (knobs.trend ?? TREND_F_PER_YEAR) * yearsFromMiddle(d);
  const enso = (knobs.ensoF ?? cl.ensoF) * ENSO_MONTH_WEIGHT[month] * ninoAt(d);
  return normalTemp(cl, doy) + trend + anomalySd(cl, doy) * (knobs.variability ?? 1) * stationZ(like, d) + enso;
}

/** Daily temperatures of a station over a span of days, °F. */
export function tempSeries(id: StationId, start: number, days: number, knobs: WorldKnobs = {}): number[] {
  return Array.from({ length: days }, (_, i) => tempF(id, start + i, knobs));
}
