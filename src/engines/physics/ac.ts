// Alternating current: waveforms, RMS, three-phase sums and AC power.

const TAU = 2 * Math.PI;

/** Instantaneous value of a sine wave: peak · sin(2πft + φ). */
export function sine(peak: number, freqHz: number, phaseRad: number, tSec: number): number {
  return peak * Math.sin(TAU * freqHz * tSec + phaseRad);
}

export function rmsFromPeak(peak: number): number {
  return peak / Math.SQRT2;
}

export function peakFromRms(rms: number): number {
  return rms * Math.SQRT2;
}

/** The three phase voltages at time t, spaced by `spacingDeg` (120° in a balanced system). */
export function threePhase(peak: number, freqHz: number, tSec: number, spacingDeg = 120): [number, number, number] {
  const s = (spacingDeg * Math.PI) / 180;
  return [sine(peak, freqHz, 0, tSec), sine(peak, freqHz, -s, tSec), sine(peak, freqHz, -2 * s, tSec)];
}

/** Peak of the sum of equal-amplitude sines with the given phase offsets, as a multiple of one peak. */
export function phasorSumMagnitude(offsetsRad: number[]): number {
  const re = offsetsRad.reduce((s, o) => s + Math.cos(o), 0);
  const im = offsetsRad.reduce((s, o) => s + Math.sin(o), 0);
  return Math.hypot(re, im);
}

export interface AcPower {
  /** Real power, W: does work. */
  real: number;
  /** Reactive power, var: sloshes back and forth. */
  reactive: number;
  /** Apparent power, VA: what the wires must carry. */
  apparent: number;
  powerFactor: number;
}

/** Single-phase AC power for RMS voltage and current with current lagging voltage by φ. */
export function acPower(vRms: number, iRms: number, phiRad: number): AcPower {
  const apparent = vRms * iRms;
  return { real: apparent * Math.cos(phiRad), reactive: apparent * Math.sin(phiRad), apparent, powerFactor: Math.cos(phiRad) };
}

/** Balanced three-phase power from line-to-line RMS voltage and line current. */
export function threePhasePower(vLineRms: number, iLineRms: number, powerFactor = 1): number {
  return Math.sqrt(3) * vLineRms * iLineRms * powerFactor;
}
