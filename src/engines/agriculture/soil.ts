// Soil chemistry: how much nitrogen, phosphorus and potassium a crop can actually get.
//
// Three ideas. (1) pH decides availability: in acid soil, phosphorus is locked up by iron and
// aluminum and microbes release less nitrogen; in alkaline soil, phosphorus binds to calcium.
// (2) Each nutrient's effect saturates: the first pounds or parts per million matter most
// (Mitscherlich). (3) The scarcest nutrient sets the pace (Liebig's law of the minimum): plenty of
// one can't make up for a shortage of another.
// The result is a nutrient sufficiency, 0–1, which the season model applies to the crop's growth.

import type { Crop } from '../../model/agriculture/region';
import type { DayWeather } from '../../model/agriculture/climate';
import type { SeasonResult } from './crop';
import { et0 } from './crop';

export type Nutrient = 'N' | 'P' | 'K';
export const NUTRIENTS: Nutrient[] = ['N', 'P', 'K'];
export const NUTRIENT_NAME: Record<Nutrient, string> = { N: 'Nitrogen', P: 'Phosphorus', K: 'Potassium' };

/** Piecewise-linear interpolation through (x, y) points. */
function interp(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

const AVAILABILITY: Record<Nutrient, Array<[number, number]>> = {
  N: [
    [4.5, 0.45],
    [5.5, 0.8],
    [6.0, 1],
    [8.0, 1],
    [9.0, 0.8],
  ],
  P: [
    [4.5, 0.3],
    [5.0, 0.45],
    [5.5, 0.65],
    [6.2, 1],
    [7.0, 1],
    [7.6, 0.75],
    [8.5, 0.45],
    [9.0, 0.35],
  ],
  K: [
    [4.5, 0.6],
    [5.5, 0.85],
    [6.0, 1],
    [9.0, 1],
  ],
};

/** Fraction of a nutrient in the soil that roots can take up at this pH (1 = fully available). */
export function availability(n: Nutrient, ph: number): number {
  return interp(AVAILABILITY[n], ph);
}

export interface SoilInputs {
  /** Fertilizer nitrogen applied, lb N per acre. */
  nRate: number;
  /** Soil test phosphorus, ppm. */
  soilP: number;
  /** Soil test potassium, ppm. */
  soilK: number;
  ph: number;
  /** Organic matter, percent. */
  om: number;
}

/** Nitrogen left over from the previous crop, lb per acre. */
export const RESIDUAL_N = 30;
/** Pounds of nitrogen soil microbes release per year from each percent of organic matter. */
export const N_PER_OM = 20;
/** Share of fertilizer nitrogen the crop recovers. */
export const N_EFFICIENCY = 0.65;
/** Nitrogen a crop needs to take up to reach its full potential, lb per acre. */
export const N_NEED: Record<Crop, number> = { corn: 220, wheat: 120 };

/** Nitrogen the crop can take up over the season, lb per acre. */
export function nitrogenSupply(s: SoilInputs): { residual: number; mineralized: number; fertilizer: number; total: number } {
  const avail = availability('N', s.ph);
  const residual = RESIDUAL_N;
  const mineralized = s.om * N_PER_OM * avail;
  const fertilizer = s.nRate * N_EFFICIENCY;
  return { residual, mineralized, fertilizer, total: residual + mineralized + fertilizer };
}

/** Growth sufficiency from a nitrogen supply/need ratio: quadratic up to a plateau at 1. */
export function nitrogenSufficiency(ratio: number): number {
  const x = Math.max(0, Math.min(1, ratio));
  return 1 - (1 - x) * (1 - x);
}

/** Growth sufficiency from soil-test phosphorus (ppm), after pH. */
export function phosphorusSufficiency(ppm: number, ph: number): number {
  return 1 - Math.exp(-0.25 * ppm * availability('P', ph));
}

/** Growth sufficiency from soil-test potassium (ppm), after pH. */
export function potassiumSufficiency(ppm: number, ph: number): number {
  return 1 - Math.exp(-0.035 * ppm * availability('K', ph));
}

export interface Sufficiency {
  N: number;
  P: number;
  K: number;
  /** The nutrient in shortest supply. */
  limiting: Nutrient;
  /** Overall nutrient sufficiency: the least of the three. */
  factor: number;
  nSupply: number;
  nNeed: number;
}

/** Each nutrient's sufficiency, and the overall factor by the law of the minimum. */
export function sufficiency(crop: Crop, s: SoilInputs): Sufficiency {
  const supply = nitrogenSupply(s).total;
  const need = N_NEED[crop];
  const N = nitrogenSufficiency(supply / need);
  const P = phosphorusSufficiency(s.soilP, s.ph);
  const K = potassiumSufficiency(s.soilK, s.ph);
  const all: Array<[Nutrient, number]> = [
    ['N', N],
    ['P', P],
    ['K', K],
  ];
  const [limiting, factor] = all.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { N, P, K, limiting, factor, nSupply: supply, nNeed: need };
}

// ---------------------------------------------------------------------------
// Nitrogen through a season: a pool of soil nitrate that microbes fill, fertilizer tops up,
// the crop draws down, and draining water carries below the roots.

export type NTiming = 'fall' | 'spring' | 'split';

export interface NitrogenSeasonOptions {
  /** Fertilizer nitrogen, lb N per acre. */
  rate: number;
  /** Fall: applied the autumn before (in the pool from January 1). Spring: at planting. Split: half at planting, half six weeks later. */
  timing: NTiming;
  om: number;
  ph: number;
  /** Root zone's available water when full, inches (for the bare-soil months before planting). */
  pawIn: number;
}

export interface NitrogenSeason {
  /** Day of year for each entry, January 1 through the season's end. */
  days: number[];
  /** Nitrate in the root zone, lb N per acre, each day. */
  pool: number[];
  /** Cumulative nitrogen leached below the root zone, lb N per acre. */
  leached: number[];
  /** Cumulative nitrogen taken up by the crop. */
  uptake: number[];
  /** Cumulative nitrogen the crop wanted. */
  demand: number[];
  totalLeached: number;
  totalUptake: number;
  totalDemand: number;
  /** Nitrogen sufficiency for the season (uptake ÷ demand, through the plateau curve). */
  sufficiency: number;
}

/** Pounds of nitrogen per acre in each g/m² of corn or wheat dry matter. */
const N_PER_GRAM: Record<Crop, number> = { corn: 0.0095 * 8.92, wheat: 0.012 * 8.92 };
/** Share of applied fertilizer that reaches the soil's nitrate pool (some is lost to the air or tied up by microbes). */
export const N_APPLIED_SHARE = 0.85;
/** Share of the root-zone nitrate carried away by each inch of drainage. */
const LEACH_PER_INCH = 0.04;

/**
 * Tracks the soil nitrate pool through a corn season. The months before planting run a bare-soil
 * water balance (starting full) so that a wet spring can leach fall-applied nitrogen.
 */
export function nitrogenSeason(weather: DayWeather[], season: SeasonResult, opts: NitrogenSeasonOptions): NitrogenSeason {
  const crop = season.crop;
  const annualMin = opts.om * N_PER_OM * availability('N', opts.ph);
  // Mineralization follows soil warmth: spread the year's release by degrees above 5 °C.
  const warmth = weather.map((w) => Math.max(0, (w.tmax + w.tmin) / 2 - 5));
  const warmSum = warmth.reduce((s, x) => s + x, 0) || 1;
  const plant = season.start;
  const split = plant + 42;
  let pool = RESIDUAL_N + (opts.timing === 'fall' ? opts.rate * N_APPLIED_SHARE : 0);
  let depletion = 0;
  let leached = 0;
  let uptake = 0;
  let demand = 0;
  const out: NitrogenSeason = { days: [], pool: [], leached: [], uptake: [], demand: [], totalLeached: 0, totalUptake: 0, totalDemand: 0, sufficiency: 1 };
  const byDay = new Map(season.days.map((d) => [d.day, d]));
  const end = season.end;
  for (let d = 0; d <= end; d++) {
    if (d === plant && opts.timing === 'spring') pool += opts.rate * N_APPLIED_SHARE;
    if (d === plant && opts.timing === 'split') pool += 0.5 * opts.rate * N_APPLIED_SHARE;
    if (d === split && opts.timing === 'split') pool += 0.5 * opts.rate * N_APPLIED_SHARE;
    pool += (annualMin * warmth[d]) / warmSum;
    let drain = 0;
    let want = 0;
    const sd = byDay.get(d);
    if (sd) {
      drain = sd.drainage;
      want = sd.growth * N_PER_GRAM[crop];
    } else if (d < plant) {
      // Bare soil before planting.
      const w = weather[d];
      depletion += 0.25 * et0(w, d) - (w.rain - 0.3 * Math.max(0, w.rain - 1.2));
      if (depletion < 0) {
        drain = -depletion;
        depletion = 0;
      }
      depletion = Math.min(depletion, opts.pawIn);
    }
    const lost = pool * Math.min(1, LEACH_PER_INCH * drain);
    pool -= lost;
    leached += lost;
    const took = Math.min(want, pool * 0.3);
    pool -= took;
    uptake += took;
    demand += want;
    out.days.push(d);
    out.pool.push(pool);
    out.leached.push(leached);
    out.uptake.push(uptake);
    out.demand.push(demand);
  }
  out.totalLeached = leached;
  out.totalUptake = uptake;
  out.totalDemand = demand;
  out.sufficiency = nitrogenSufficiency(demand > 0 ? uptake / demand : 1);
  return out;
}
