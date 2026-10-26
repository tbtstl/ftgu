// El Niño–Southern Oscillation as a recharge oscillator (after Jin, 1997): the sea-surface
// temperature anomaly of the eastern equatorial Pacific, T (the Niño-3.4 index, °C), and the
// depth of the warm water stored along the equator, h (in °C-equivalent units), stepped monthly:
//   dT/dt = R·T + γ·h − ε·T³ + noise     (R: the Bjerknes feedback, minus damping)
//   dh/dt = −r·h − α·T                    (a warm east drains the stored heat, a cold east recharges it)
// The coupling of the two gives an irregular oscillation with a period of a few years.

import { gaussian, rng } from '../../model/random';

export interface EnsoParams {
  /** Net growth rate of an SST anomaly from ocean–atmosphere feedback, per month (negative = damped). */
  coupling: number;
  /** How strongly stored heat warms the east, per month. */
  gamma: number;
  /** How fast the thermocline anomaly damps, per month. */
  r: number;
  /** How strongly a warm east drains the stored heat, per month. */
  alpha: number;
  /** Cubic damping that keeps a self-sustained oscillation bounded, per °C² per month. */
  cubic: number;
  /** Random weather kicks to the SST each month, °C. */
  noise: number;
}

export const ENSO_DEFAULTS: EnsoParams = { coupling: -0.03, gamma: 0.12, r: 0.04, alpha: 0.16, cubic: 0.01, noise: 0.28 };

export interface EnsoState {
  /** Niño-3.4 SST anomaly, °C. */
  t: number;
  /** Thermocline (heat content) anomaly. */
  h: number;
}

/** One month of the oscillator, with a given standard-normal kick. */
export function stepEnso(s: EnsoState, p: EnsoParams, kick = 0): EnsoState {
  const dt = s.t + p.coupling * s.t + p.gamma * s.h - p.cubic * s.t ** 3 + p.noise * kick;
  const dh = s.h - p.r * s.h - p.alpha * s.t;
  return { t: dt, h: dh };
}

/** The oscillator's deterministic path from a state: what it would do with no further kicks. */
export function projectEnso(s: EnsoState, p: EnsoParams, months: number): EnsoState[] {
  const out: EnsoState[] = [s];
  let x = s;
  for (let i = 0; i < months; i++) out.push((x = stepEnso(x, p, 0)));
  return out;
}

/**
 * A monthly history of `months` months from a fixed seed, after a ten-year spin-up. The kicks are
 * drawn once from the seed, so changing the parameters replays the same weather through
 * different physics.
 */
export function ensoHistory(months: number, p: EnsoParams = ENSO_DEFAULTS, seed = 1997): EnsoState[] {
  const r = rng(seed);
  const spin = 120;
  const kicks = Array.from({ length: months + spin }, () => gaussian(r));
  let s: EnsoState = { t: 0, h: 0 };
  const out: EnsoState[] = [];
  for (let i = 0; i < months + spin; i++) {
    s = stepEnso(s, p, kicks[i]);
    if (!Number.isFinite(s.t) || Math.abs(s.t) > 10) s = { t: Math.sign(s.t) * 10, h: s.h };
    if (i >= spin) out.push(s);
  }
  return out;
}

/**
 * Natural period and e-folding decay time of the linearized monthly map, months: the eigenvalues
 * of [[1 + R, γ], [−α, 1 − r]]. Period is null if the map doesn't oscillate; decay is null if it grows.
 */
export function ensoPeriod(p: EnsoParams): { periodMonths: number | null; decayMonths: number | null; growing: boolean } {
  const a = 1 + p.coupling;
  const d = 1 - p.r;
  const tr = a + d;
  const det = a * d + p.gamma * p.alpha;
  const disc = (tr * tr) / 4 - det;
  if (disc >= 0) {
    const mu = Math.max(Math.abs(tr / 2 + Math.sqrt(disc)), Math.abs(tr / 2 - Math.sqrt(disc)));
    return { periodMonths: null, decayMonths: mu < 1 ? -1 / Math.log(mu) : null, growing: mu > 1 };
  }
  const mod = Math.sqrt(det);
  const arg = Math.atan2(Math.sqrt(-disc), tr / 2);
  return { periodMonths: (2 * Math.PI) / arg, decayMonths: mod < 1 ? -1 / Math.log(mod) : null, growing: mod > 1 };
}

export type EnsoPhase = 'El Niño' | 'La Niña' | 'neutral';

/** NOAA's threshold: ±0.5 °C. (Its operational definition also requires the anomaly to persist for several overlapping seasons.) */
export function ensoPhase(t: number): EnsoPhase {
  return t >= 0.5 ? 'El Niño' : t <= -0.5 ? 'La Niña' : 'neutral';
}
