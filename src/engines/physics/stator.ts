// The inside of a generator: a rotor turning past stator coils, one instant at a time.
// generatorEmf (machines.ts) gives the amplitude and frequency; these functions give the
// instantaneous flux and emf of each coil for a rotor at a known angle, so a figure can
// integrate the rotor's angle frame by frame without jumps when the speed changes.

import { generatorEmf, type GeneratorInput } from './machines';

const TAU = 2 * Math.PI;

/** Electrical angle of each phase's coil axis: A at 0, B a third of a cycle on, C two thirds. */
export const PHASE_OFFSETS_RAD = [0, TAU / 3, (2 * TAU) / 3] as const;

/** The rotor's mechanical angle after turning for `dtSec` at a steady `rpm`, wrapped to [0, 2π). */
export function advanceRotor(rotorRad: number, rpm: number, dtSec: number): number {
  const a = (rotorRad + (TAU * rpm * dtSec) / 60) % TAU;
  return a < 0 ? a + TAU : a;
}

export interface CoilState {
  /** Electrical angle between the rotor's field and the coil's axis, rad. */
  theta: number;
  /** Flux through one turn of the coil, webers (B·A·cos θ). */
  flux: number;
  /** Induced emf across the whole coil, volts (N·B·A·ω·sin θ). */
  emf: number;
}

/**
 * Flux and emf of one stator coil when the rotor's north pole points at mechanical angle
 * `rotorRad` (measured from the coil of phase A, counterclockwise). `coilRad` is the coil's
 * electrical angle (see PHASE_OFFSETS_RAD). With θ = polePairs·rotorRad − coilRad this agrees
 * with generatorAt: flux = B·A·cos θ and emf = −N·dΦ/dt = N·B·A·ω·sin θ.
 */
export function coilAt(input: GeneratorInput, rotorRad: number, coilRad = 0): CoilState {
  const { peakVolts } = generatorEmf(input);
  const theta = (input.polePairs ?? 1) * rotorRad - coilRad;
  return { theta, flux: input.fieldTesla * input.areaM2 * Math.cos(theta), emf: peakVolts * Math.sin(theta) };
}

/** The same coil `ageSec` seconds ago, assuming the rotor has been turning at its present speed. */
export function coilAgo(input: GeneratorInput, rotorRad: number, ageSec: number, coilRad = 0): CoilState {
  return coilAt(input, rotorRad - (TAU * input.rpm * ageSec) / 60, coilRad);
}

export interface StatorTooth {
  /** Mechanical angle of the tooth, rad, counterclockwise from phase A's first tooth. */
  angleRad: number;
  /** 0 = phase A, 1 = B, 2 = C. */
  phase: 0 | 1 | 2;
  /** True when the tooth faces the opposite pole to its phase's reference, so its coil is wound the other way. */
  reversed: boolean;
}

/**
 * The teeth of a simple three-phase stator for a rotor with `polePairs` pole pairs: 6 teeth per
 * pole pair, evenly spaced, cycling A, C′, B, A′, C, B′ (primes are reversed windings). Tooth k
 * sits at electrical angle k·60°, so phase B's coils lag A's by 120° and C's by 240°.
 */
export function statorTeeth(polePairs: number): StatorTooth[] {
  const n = 6 * Math.max(1, Math.round(polePairs));
  const out: StatorTooth[] = [];
  for (let k = 0; k < n; k++) {
    out.push({ angleRad: (k * TAU) / n, phase: ([0, 2, 1] as const)[k % 3], reversed: k % 2 === 1 });
  }
  return out;
}
