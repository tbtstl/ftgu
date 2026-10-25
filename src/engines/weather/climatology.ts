// Climatology: a station's climate read as the distribution of its weather. Builds a station's
// whole simulated record quickly (for figures that rebuild it on every slider move), the spread
// of its days through the year, and the distribution of its days within a month.

import { DAYS, TREND_F_PER_YEAR, YEARS, dayInfo, ninoAt, stationZ } from '../../model/weather/archive';
import { ENSO_MONTH_WEIGHT, MONTH_DAYS, MONTH_START, anomalySd, normalTemp, type Climate, type StationId } from '../../model/weather/region';

interface Base {
  z: Record<StationId, Float64Array>;
  /** ENSO month weight × Niño-3.4 on each day. */
  enso: Float64Array;
  /** Years from the archive's middle, for the trend. */
  years: Float64Array;
  doy: Int16Array;
}

let base: Base | null = null;

/** The parts of every day's weather that don't depend on the station's climate, computed once. */
function getBase(): Base {
  if (base) return base;
  const z = { fenwick: new Float64Array(DAYS), marlow: new Float64Array(DAYS), ridge: new Float64Array(DAYS) };
  const enso = new Float64Array(DAYS);
  const years = new Float64Array(DAYS);
  const doy = new Int16Array(DAYS);
  for (let d = 0; d < DAYS; d++) {
    const info = dayInfo(d);
    z.fenwick[d] = stationZ('fenwick', d);
    z.marlow[d] = stationZ('marlow', d);
    z.ridge[d] = stationZ('ridge', d);
    enso[d] = ENSO_MONTH_WEIGHT[info.month] * ninoAt(d);
    years[d] = info.year - (YEARS + 1) / 2;
    doy[d] = info.doy;
  }
  base = { z, enso, years, doy };
  return base;
}

/**
 * Every day of the archive at a station with climate `cl`, driven by the weather sequence of one
 * of the region's stations, °F. The same numbers as `tempForClimate`, computed in bulk.
 */
export function climateSeries(cl: Climate, like: StationId = 'fenwick'): Float64Array {
  const b = getBase();
  const normal = new Float64Array(365);
  const sd = new Float64Array(365);
  for (let i = 0; i < 365; i++) {
    normal[i] = normalTemp(cl, i);
    sd[i] = anomalySd(cl, i);
  }
  const z = b.z[like];
  const out = new Float64Array(DAYS);
  for (let d = 0; d < DAYS; d++) {
    const i = b.doy[d];
    out[d] = normal[i] + TREND_F_PER_YEAR * b.years[d] + sd[i] * z[d] + cl.ensoF * b.enso[d];
  }
  return out;
}

/** The value below which a share `q` of sorted values fall (linear interpolation). */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = Math.max(0, Math.min(n - 1, q * (n - 1)));
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface YearBands {
  /** Days of the year at which the bands are given. */
  doy: number[];
  low: number[];
  high: number[];
}

/**
 * The spread of a station's days through the year: at every `step`-th day of the year, the `lo`
 * and `hi` quantiles of all days within `window` days of it, across all the archive's years.
 */
export function yearBands(series: Float64Array, opts: { step?: number; window?: number; lo?: number; hi?: number } = {}): YearBands {
  const step = opts.step ?? 3;
  const win = opts.window ?? 5;
  const lo = opts.lo ?? 0.1;
  const hi = opts.hi ?? 0.9;
  const doy: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  const buf = new Float64Array(YEARS * (2 * win + 1));
  for (let i = 0; i <= 365; i += step) {
    let n = 0;
    for (let y = 0; y < YEARS; y++) {
      for (let k = -win; k <= win; k++) {
        const d = y * 365 + i + k;
        if (d >= 0 && d < DAYS) buf[n++] = series[d];
      }
    }
    const s = buf.subarray(0, n).sort();
    doy.push(i);
    low.push(quantile(s, lo));
    high.push(quantile(s, hi));
  }
  return { doy, low, high };
}

/** Every day of one calendar month across the archive's years, sorted, °F. */
export function monthSample(series: Float64Array, month: number): Float64Array {
  const out = new Float64Array(YEARS * MONTH_DAYS[month]);
  let n = 0;
  for (let y = 0; y < YEARS; y++) for (let k = 0; k < MONTH_DAYS[month]; k++) out[n++] = series[y * 365 + MONTH_START[month] + k];
  return out.sort();
}

export interface MonthStats {
  mean: number;
  sd: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}

export function monthStats(sorted: Float64Array): MonthStats {
  const n = sorted.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += sorted[i];
  const mean = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (sorted[i] - mean) ** 2;
  return { mean, sd: Math.sqrt(v / n), p10: quantile(sorted, 0.1), p90: quantile(sorted, 0.9), min: sorted[0], max: sorted[n - 1] };
}

/** Counts of values in bins of width `width` from `from` (values outside go in the end bins). */
export function histogram(values: ArrayLike<number>, from: number, width: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    const b = Math.max(0, Math.min(bins - 1, Math.floor((values[i] - from) / width)));
    out[b]++;
  }
  return out;
}

/** The normal temperature averaged over a calendar month, °F. */
export function monthNormal(cl: Climate, month: number): number {
  let s = 0;
  for (let k = 0; k < MONTH_DAYS[month]; k++) s += normalTemp(cl, MONTH_START[month] + k);
  return s / MONTH_DAYS[month];
}

/** Calendar date of a day of the year, e.g. "January 21". */
export function dateOfYear(doy: number, names: readonly string[]): string {
  const d = ((Math.round(doy) % 365) + 365) % 365;
  let m = 11;
  while (m > 0 && d < MONTH_START[m]) m--;
  return `${names[m]} ${d - MONTH_START[m] + 1}`;
}
