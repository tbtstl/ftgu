// Weather contracts and their prices. A contract names a station, an index (heating or cooling
// degree days, base 65 °F), a period, a tick (dollars per index point — $20 for the CME's US
// degree-day futures) and a payoff (a future, a call or a put, optionally capped).
//
// Its value on any valuation day is the expected payoff over the distribution of the index as
// known on that day: the days already past are settled; the next fortnight comes from the
// forecast issued that day (only the information revealed by then); the rest from climate. The
// distribution is sampled by simulating the pieces of information still to be revealed — the
// same structure the archive was built with — so no price ever uses the outcome it pays on.

import { gaussian, rng } from '../../model/random';
import {
  DAYS,
  LEAD_MAX,
  SAME_DAY_CORRELATION,
  TREND_F_PER_YEAR,
  YEARS,
  archive,
  dayInfo,
  expectedTemp,
  monthDays,
  ninoAt,
  ninoForecast,
  revealedShare,
  tempF,
  type WorldKnobs,
  climateFor,
} from '../../model/weather/archive';
import { ENSO_DEFAULTS } from './enso';
import { ENSO_MONTH_WEIGHT, MONTH_DAYS, anomalySd, type StationId } from '../../model/weather/region';
import { BASE_F, degreeDays, type DegreeKind } from './degreeDays';

/** The CME's US degree-day futures pay $20 per index point. */
export const CME_TICK = 20;

export type PayoffType = 'future' | 'call' | 'put';

export interface ContractSpec {
  kind: DegreeKind;
  /** Months covered, as [year offset from the contract year, month 0–11]. */
  months: Array<[number, number]>;
  type: PayoffType;
  /** Strike, index points (for a future, the agreed price). */
  strike: number;
  /** Dollars per index point. */
  tick: number;
  /** Largest payout, $ (Infinity for none). */
  cap?: number;
  base?: number;
}

/** A single month's HDD or CDD future at the CME's $20 a point. */
export function monthContract(kind: DegreeKind, month: number, type: PayoffType = 'future', strike = 0): ContractSpec {
  return { kind, months: [[0, month]], type, strike, tick: CME_TICK };
}

/** The November–March heating season (the contract year is the November's). */
export const WINTER_SEASON: Array<[number, number]> = [
  [0, 10],
  [0, 11],
  [1, 0],
  [1, 1],
  [1, 2],
];

/** First and last archive day (inclusive) the contract covers in contract year y. */
export function contractSpan(spec: ContractSpec, year: number): { start: number; end: number; days: number } {
  const first = spec.months[0];
  const last = spec.months[spec.months.length - 1];
  const start = monthDays(year + first[0], first[1]).start;
  const lm = monthDays(year + last[0], last[1]);
  const end = lm.start + lm.days - 1;
  return { start, end, days: end - start + 1 };
}

/** Whether contract year y fits inside the archive. */
export function contractYearValid(spec: ContractSpec, year: number): boolean {
  if (year < 1) return false;
  const { end } = contractSpan(spec, year);
  return end < DAYS;
}

/** The index as it settled in contract year y. */
export function settledIndex(spec: ContractSpec, year: number, knobs: WorldKnobs = {}): number {
  const { start, end } = contractSpan(spec, year);
  let s = 0;
  for (let d = start; d <= end; d++) s += degreeDays(spec.kind, tempF('fenwick', d, knobs), spec.base);
  return s;
}

/** What the contract pays (to its holder) for an index value, $. */
export function payoff(spec: ContractSpec, index: number): number {
  let p: number;
  if (spec.type === 'future') p = spec.tick * (index - spec.strike);
  else if (spec.type === 'call') p = spec.tick * Math.max(0, index - spec.strike);
  else p = spec.tick * Math.max(0, spec.strike - index);
  const cap = spec.cap ?? Infinity;
  return Math.max(-cap, Math.min(cap, p));
}

// ---------------------------------------------------------------------------
// The index distribution on a valuation day.

export interface ValuationOptions {
  /** Number of simulated paths. */
  paths?: number;
  /** World knobs (variability, ENSO strength, trend). */
  knobs?: WorldKnobs;
  /**
   * How many days stale the forecaster's information is: 0 uses the forecast issued on the
   * valuation day; 3 uses the one issued three days earlier. Observations up to the valuation
   * day are always known.
   */
  infoDelay?: number;
  /** Ignore ENSO beyond what has already happened (a forecaster who doesn't watch the Pacific). */
  ignoreEnso?: boolean;
  /** Seed offset, to draw a different set of paths. */
  seed?: number;
}

export interface IndexDistribution {
  /** Simulated index values, sorted ascending. */
  samples: Float64Array;
  mean: number;
  sd: number;
  /** Index already accumulated by the valuation day. */
  realized: number;
  daysRealized: number;
  /** Days still to come within the forecast's reach, and beyond it. */
  daysForecast: number;
  daysClimate: number;
}

const ROOT = Array.from({ length: LEAD_MAX + 1 }, (_, k) => Math.sqrt(revealedShare(k)));

function hashSeed(a: number, b: number): number {
  let h = (a * 0x9e3779b1) ^ (b * 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Sample the contract's index as known at the end of `valuationDay` (an archive day index; use a
 * day before the contract starts to price it in advance). Days on or before the valuation day
 * are settled from the archive. For each later day, the forecaster knows the pieces of its
 * weather revealed by the forecast issue day (valuation day − infoDelay) and simulates the rest.
 */
export function indexDistribution(spec: ContractSpec, year: number, valuationDay: number, opts: ValuationOptions = {}): IndexDistribution {
  const a = archive();
  const knobs = opts.knobs ?? {};
  const P = opts.paths ?? 500;
  const delay = Math.max(0, Math.round(opts.infoDelay ?? 0));
  const { start, end } = contractSpan(spec, year);
  const t = valuationDay;
  const issue = t - delay;
  const H = LEAD_MAX;
  const rho = SAME_DAY_CORRELATION;
  const cl = climateFor('fenwick', knobs);
  const variability = knobs.variability ?? 1;
  const ensoF = knobs.ensoF ?? cl.ensoF;
  const base = spec.base;

  // Settled days.
  let realized = 0;
  let daysRealized = 0;
  for (let d = start; d <= Math.min(end, t); d++) {
    realized += degreeDays(spec.kind, tempF('fenwick', d, knobs), base);
    daysRealized++;
  }
  const first = Math.max(start, t + 1);
  const n = end >= first ? end - first + 1 : 0;
  let daysForecast = 0;
  // Per future day: expected temperature without weather, the weather sd, the known part of z, ENSO weight.
  const mu = new Float64Array(n);
  const sd = new Float64Array(n);
  const knownZ = new Float64Array(n);
  const ensoW = new Float64Array(n);
  const monthKey = new Int32Array(n);
  const issueInfo = dayInfo(Math.max(0, issue));
  for (let i = 0; i < n; i++) {
    const d = first + i;
    const info = dayInfo(d);
    const lead = d - issue;
    const k = lead <= H ? lead : H + 1;
    if (lead <= H) daysForecast++;
    knownZ[i] = k <= H && k >= 0 ? a.known[d * (H + 2) + Math.max(0, k)] : 0;
    sd[i] = anomalySd(cl, info.doy) * variability;
    // ENSO: the oscillator's projection from the issue month (or nothing, if ignored).
    const monthsAhead = (info.year - issueInfo.year) * 12 + (info.month - issueInfo.month);
    let nino: number;
    if (opts.ignoreEnso) nino = 0;
    else nino = monthsAhead <= 0 ? ninoAt(Math.max(0, issue)) : ninoForecast(issueInfo.year, issueInfo.month, monthsAhead);
    ensoW[i] = ensoF * ENSO_MONTH_WEIGHT[info.month];
    mu[i] = expectedTemp('fenwick', d, knobs) + ensoW[i] * nino;
    monthKey[i] = Math.max(0, monthsAhead);
  }
  const daysClimate = n - daysForecast;
  const maxMonths = n ? monthKey[n - 1] + 1 : 0;
  const samples = new Float64Array(P);
  const zsim = new Float64Array(n);
  const e = new Float64Array(H + 1);
  for (let p = 0; p < P; p++) {
    zsim.fill(0);
    // Pieces revealed after the issue day, about days in the window still to come. (A piece
    // revealed more than LEAD_MAX days before the window can't reach it.)
    for (let tp = Math.max(issue + 1, first - H); tp <= end; tp++) {
      const r = rng(hashSeed(p + 7919 * (opts.seed ?? 0), tp + 1_000_000));
      e[0] = gaussian(r);
      for (let k = 1; k <= H; k++) e[k] = rho * e[k - 1] + Math.sqrt(1 - rho * rho) * gaussian(r);
      for (let k = 0; k <= H; k++) {
        const d = tp + k;
        if (d < first || d > end) continue;
        zsim[d - first] += ROOT[k] * e[k];
      }
    }
    // ENSO's own surprises beyond the issue month: a random walk of the oscillator's kicks.
    let ensoDev = 0;
    const devByMonth = new Float64Array(maxMonths + 1);
    if (!opts.ignoreEnso && maxMonths > 0) {
      const r = rng(hashSeed(p + 104729 * (opts.seed ?? 0), issue + 2_000_000));
      for (let m = 1; m <= maxMonths; m++) {
        ensoDev = (1 + ENSO_DEFAULTS.coupling) * ensoDev + ENSO_DEFAULTS.noise * gaussian(r);
        devByMonth[m] = ensoDev;
      }
    }
    let idx = realized;
    for (let i = 0; i < n; i++) {
      const temp = mu[i] + sd[i] * (knownZ[i] + zsim[i]) + ensoW[i] * devByMonth[monthKey[i]];
      idx += degreeDays(spec.kind, temp, base);
    }
    samples[p] = idx;
  }
  samples.sort();
  let m = 0;
  for (let p = 0; p < P; p++) m += samples[p];
  m /= P;
  let v = 0;
  for (let p = 0; p < P; p++) v += (samples[p] - m) ** 2;
  return { samples, mean: m, sd: Math.sqrt(v / P), realized, daysRealized, daysForecast, daysClimate };
}

/** Expected payoff over a distribution: the contract's fair value (ignoring interest). */
export function fairValue(spec: ContractSpec, dist: IndexDistribution): number {
  let s = 0;
  for (let i = 0; i < dist.samples.length; i++) s += payoff(spec, dist.samples[i]);
  return s / dist.samples.length;
}

/** Quantile of a sorted sample. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const i = Math.max(0, Math.min(n - 1, q * (n - 1)));
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(n - 1, lo + 1)] - sorted[lo]) * (i - lo);
}

/** Probability the index finishes above a level. */
export function probAbove(dist: IndexDistribution, level: number): number {
  let c = 0;
  for (let i = 0; i < dist.samples.length; i++) if (dist.samples[i] > level) c++;
  return c / dist.samples.length;
}

// ---------------------------------------------------------------------------
// Pricing from history ("burn analysis").

/**
 * The index the contract would have settled at in a past year y, with every day warmed by the
 * trend to `toYear` (so a 30-year-old winter is judged in today's climate) when `detrend` is set.
 */
export function burnIndex(spec: ContractSpec, y: number, toYear: number, detrend: boolean, knobs: WorldKnobs = {}): number {
  const { start, end } = contractSpan(spec, y);
  const shift = detrend ? (knobs.trend ?? TREND_F_PER_YEAR) * (toYear - y) : 0;
  let s = 0;
  for (let d = start; d <= end; d++) s += degreeDays(spec.kind, tempF('fenwick', d, knobs) + shift, spec.base);
  return s;
}

export interface Burn {
  years: number[];
  indices: number[];
  payoffs: number[];
  /** Average payoff over the years: the burn price. */
  value: number;
  meanIndex: number;
}

/** Burn analysis over the `window` contract years before `toYear`. */
export function burn(spec: ContractSpec, toYear: number, window: number, detrend: boolean, knobs: WorldKnobs = {}): Burn {
  const years: number[] = [];
  for (let y = toYear - window; y < toYear; y++) if (contractYearValid(spec, y)) years.push(y);
  const indices = years.map((y) => burnIndex(spec, y, toYear, detrend, knobs));
  const payoffs = indices.map((i) => payoff(spec, i));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
  return { years, indices, payoffs, value: mean(payoffs), meanIndex: mean(indices) };
}

/** Day index of the first day of the contract in year y, minus `daysBefore`. */
export function daysBeforeStart(spec: ContractSpec, year: number, daysBefore: number): number {
  return contractSpan(spec, year).start - daysBefore;
}

/** Number of days in a calendar month. */
export function daysIn(month: number): number {
  return MONTH_DAYS[month];
}

// ---------------------------------------------------------------------------
// Other indices, for contracts written over the counter.

export type AnyIndex = 'HDD' | 'CDD' | 'rain' | 'frost';

export const INDEX_LABEL: Record<AnyIndex, string> = {
  HDD: 'heating degree days',
  CDD: 'cooling degree days',
  rain: 'inches of rain',
  frost: 'days with a mean below 32 °F',
};

/**
 * Any of the course's indices at a station over the given months of year y: degree days (base
 * `base`), total rain in inches (Fenwick Bay and Marlow keep rain gauges; Hollin Ridge doesn't), or
 * the count of days whose mean is below freezing.
 */
export function indexValue(kind: AnyIndex, station: StationId, months: Array<[number, number]>, year: number, base = BASE_F, knobs: WorldKnobs = {}): number {
  const a = archive();
  let s = 0;
  for (const [dy, m] of months) {
    const { start, days } = monthDays(year + dy, m);
    for (let i = 0; i < days; i++) {
      const d = start + i;
      if (kind === 'rain') s += station === 'ridge' ? NaN : a.rain[station][d];
      else {
        const t = tempF(station, d, knobs);
        if (kind === 'frost') s += t < 32 ? 1 : 0;
        else s += degreeDays(kind, t, base);
      }
    }
  }
  return s;
}

/** Contract years available for a spec, in order. */
export function contractYears(spec: ContractSpec): number[] {
  const out: number[] = [];
  for (let y = 1; y <= YEARS; y++) if (contractYearValid(spec, y)) out.push(y);
  return out;
}
