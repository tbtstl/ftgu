// The p–n junction's geometry: the built-in voltage that forms where p-type silicon meets n-type,
// and the width of the depletion region — the strip emptied of free carriers — under a bias.
// Uses the depletion approximation for an abrupt junction; current comes from diodeCurrent.

import { Q, intrinsicConcentration, thermalVoltage } from './semiconductor';

/** Permittivity of silicon, F/cm (11.7 times that of free space). */
export const EPS_SI = 11.7 * 8.854e-14;

/** Built-in voltage of a junction between acceptor doping na and donor doping nd (per cm³), V. */
export function builtInPotential(na: number, nd: number, tempK = 300): number {
  const ni = intrinsicConcentration(tempK);
  return thermalVoltage(tempK) * Math.log((na * nd) / (ni * ni));
}

/**
 * Width of the depletion region, µm, at a bias (positive = forward: p side higher). Forward bias
 * works against the built-in voltage and narrows the region; reverse bias adds to it and widens it.
 * The approximation fails as the bias nears the built-in voltage, so the barrier is floored at 20 mV.
 */
export function depletionWidthUm(na: number, nd: number, bias: number, tempK = 300): number {
  const barrier = Math.max(builtInPotential(na, nd, tempK) - bias, 0.02);
  const cm = Math.sqrt(((2 * EPS_SI * barrier) / Q) * (1 / na + 1 / nd));
  return cm * 1e4;
}
