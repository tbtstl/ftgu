// A miniature weather model: temperature anomalies carried east by the westerlies around the
// 41st parallel, stepped forward in discrete time steps. The "truth" moves at the wind speed and
// keeps evolving — weather systems grow and decay in ways nobody observed. The model starts from
// observations (dense over land, sparse over the ocean upstream), interpolates between them, and
// steps the advection equation ∂T/∂t + U ∂T/∂x = 0 with an upwind scheme. Its Courant number
// C = U·Δt/Δx must stay at or below 1, or the scheme blows up.

import { gaussian, rng } from '../../model/random';

/** Grid points around the latitude circle; one per degree of longitude (about 84 km at 41°). */
export const NX = 360;
export const DX_KM = (2 * Math.PI * 6371 * Math.cos((41 * Math.PI) / 180)) / NX;
/** Calder Bay's grid point. */
export const CALDER_I = 300;

/** The ocean upstream of the continent: grid points from `from` to `to`, going east. */
export const OCEAN = { from: 140, to: 245 };

export interface Wave {
  k: number;
  amp: number;
  phase: number;
  /** Growth or decay per day. */
  growth: number;
  /** Drift of phase per day relative to the mean flow (radians). */
  drift: number;
}

/** The true atmosphere: a sum of waves, each moving with the wind and slowly evolving. */
export function truthWaves(seed = 7): Wave[] {
  const r = rng(seed);
  return [3, 4, 5, 6, 7, 8, 9, 11].map((k) => ({
    k,
    amp: (6 / Math.sqrt(k)) * (0.6 + 0.8 * r()),
    phase: 2 * Math.PI * r(),
    growth: 0.12 * gaussian(r),
    drift: 0.12 * gaussian(r),
  }));
}

/** The true field at time `tDays`, carried east at `windMs`, with each wave's evolution applied. */
export function truthField(waves: Wave[], tDays: number, windMs: number, evolution = 1): Float64Array {
  const out = new Float64Array(NX);
  const shiftCells = (windMs * 86400 * tDays) / 1000 / DX_KM;
  for (const w of waves) {
    const amp = w.amp * Math.exp(evolution * w.growth * tDays);
    const ph = w.phase + evolution * w.drift * tDays;
    for (let i = 0; i < NX; i++) out[i] += amp * Math.sin((2 * Math.PI * w.k * (i - shiftCells)) / NX + ph);
  }
  return out;
}

/** One upwind step of the advection equation with Courant number C (wind blowing east). */
export function upwindStep(field: Float64Array, courant: number): Float64Array {
  const out = new Float64Array(NX);
  for (let i = 0; i < NX; i++) {
    const west = field[(i - 1 + NX) % NX];
    out[i] = field[i] - courant * (field[i] - west);
  }
  return out;
}

export interface ModelRun {
  /** Fields at each saved step. */
  frames: Float64Array[];
  /** Model hours at each saved frame. */
  hours: number[];
  courant: number;
  /** Whether the run blew up (any value beyond ±1000). */
  unstable: boolean;
}

/**
 * Step a field forward `hours` with time step `dtHours`, saving every frame. `roundoff` adds that
 * much grid-scale noise to the start (°F), as rounding errors do in a real computer: a stable
 * scheme damps it, an unstable one amplifies it fastest of all.
 */
export function runModel(init: Float64Array, windMs: number, dtHours: number, hours: number, roundoff = 0.01): ModelRun {
  const courant = (windMs * dtHours * 3600) / 1000 / DX_KM;
  const steps = Math.max(1, Math.round(hours / dtHours));
  const start: Float64Array = init.map((v, i) => v + roundoff * (i % 2 === 0 ? 1 : -1) * (0.5 + 0.5 * Math.sin(i * 12.9898)));
  const frames: Float64Array[] = [start];
  const times = [0];
  let f: Float64Array = start;
  let unstable = false;
  for (let s = 1; s <= steps; s++) {
    f = upwindStep(f, courant);
    if (!unstable && f.some((v) => !Number.isFinite(v) || Math.abs(v) > 1000)) unstable = true;
    if (unstable) f = f.map((v) => (Number.isFinite(v) ? Math.max(-1000, Math.min(1000, v)) : 1000));
    frames.push(f);
    times.push(s * dtHours);
  }
  return { frames, hours: times, courant, unstable };
}

/** Observation sites: every `landSpacing` grid points over land, every `oceanSpacing` over the ocean (0 = none). */
export function observationSites(landSpacing: number, oceanSpacing: number): number[] {
  const sites: number[] = [];
  for (let i = 0; i < NX; i++) {
    const ocean = i >= OCEAN.from && i <= OCEAN.to;
    const sp = ocean ? oceanSpacing : landSpacing;
    if (sp > 0 && i % sp === 0) sites.push(i);
  }
  return sites;
}

/**
 * The model's starting analysis: the true field at the observation sites (with measurement
 * error), joined by straight lines around the circle. Where there are no observations for a long
 * stretch, the analysis knows nothing better than a straight line across the gap.
 */
export function analysis(truth: Float64Array, sites: number[], obsErrorF = 0.5, seed = 11): Float64Array {
  const r = rng(seed);
  const out = new Float64Array(NX);
  if (sites.length === 0) return out;
  const vals = sites.map((i) => truth[i] + obsErrorF * gaussian(r));
  for (let s = 0; s < sites.length; s++) {
    const i0 = sites[s];
    const i1 = sites[(s + 1) % sites.length];
    const v0 = vals[s];
    const v1 = vals[(s + 1) % sites.length];
    const span = ((i1 - i0 + NX) % NX) || NX;
    for (let k = 0; k < span; k++) out[(i0 + k) % NX] = v0 + ((v1 - v0) * k) / span;
  }
  return out;
}

/**
 * A forecast for Calder Bay: start from the analysis at day 0 and carry it east exactly with the
 * wind (no numerical error), against the evolving truth. Returns the error at Calder Bay by lead.
 */
export function calderForecastErrors(opts: { landSpacing: number; oceanSpacing: number; windMs: number; evolution: number; days: number; seed?: number }): Array<{ lead: number; forecast: number; truth: number; error: number }> {
  const waves = truthWaves(opts.seed ?? 7);
  const t0 = truthField(waves, 0, opts.windMs, opts.evolution);
  const an = analysis(t0, observationSites(opts.landSpacing, opts.oceanSpacing));
  const out: Array<{ lead: number; forecast: number; truth: number; error: number }> = [];
  const cellsPerDay = (opts.windMs * 86400) / 1000 / DX_KM;
  for (let lead = 0; lead <= opts.days; lead += 0.5) {
    const src = CALDER_I - cellsPerDay * lead;
    const j = ((src % NX) + NX) % NX;
    const j0 = Math.floor(j);
    const fr = j - j0;
    const forecast = an[j0] * (1 - fr) + an[(j0 + 1) % NX] * fr;
    const truth = truthField(waves, lead, opts.windMs, opts.evolution)[CALDER_I];
    out.push({ lead, forecast, truth, error: forecast - truth });
  }
  return out;
}

/** Root-mean-square difference between two fields. */
export function rmsDiff(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}
