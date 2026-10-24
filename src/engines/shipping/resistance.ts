// Calm-water hull resistance: what it takes to push a ship through still water at a speed.
//
// Resistance is split the standard way (ITTC 1978, simplified):
//   friction   ½ρSV² · C_F, with the ITTC-1957 friction line C_F = 0.075 / (log₁₀Re − 2)²
//   form       the extra viscous drag of a full hull, k · friction (Watanabe's estimate of k)
//   roughness  ½ρSV² · C_A: paint, welds and, as a hull fouls, slime and barnacles
//   waves      ½ρSV² · C_W, the energy left behind in the ship's wave pattern
//   air        ½ρ_air · C_x · A · V_rel², on the hull and superstructure above water
// The wave term is a smooth fit, C_W = 0.70 · Cb³ · Fn⁴, calibrated to full-bodied cargo ships at
// Froude numbers below about 0.3; it has no humps and hollows. S is Mumford's wetted surface.

import type { Hull } from '../../model/shipping/vessels';
import { volumeAt } from './hydrostatics';

export const KNOT = 1852 / 3600; // m/s
export const G = 9.81;
export const NU_SEA = 1.188e-6; // kinematic viscosity of sea water at 15 °C, m²/s
export const RHO_SEA_KG = 1025;
export const RHO_AIR = 1.225;
/** Roughness allowance of a clean, freshly painted hull. */
export const CA_CLEAN = 0.0002;
/** Extra roughness allowance of a heavily fouled hull. */
export const CA_FOULED = 0.0009;
const CW_FIT = 0.7;
/** Height of the superstructure and hatch coamings above the deck, for windage, m. */
const SUPERSTRUCTURE_M = 12;
const CX_AIR = 0.8;

/** Mumford's wetted-surface estimate, m²: 1.7 L T + ∇ / T. */
export function wettedSurface(h: Hull, draft: number): number {
  return 1.7 * h.lbp * draft + volumeAt(h, draft) / draft;
}

/** Reynolds number of the hull at a speed. */
export function reynolds(h: Hull, speedKn: number): number {
  return (speedKn * KNOT * h.lbp) / NU_SEA;
}

/** Froude number: speed relative to the speed of a wave as long as the ship. */
export function froude(h: Hull, speedKn: number): number {
  return (speedKn * KNOT) / Math.sqrt(G * h.lbp);
}

/** ITTC-1957 friction coefficient. */
export function ittc57(re: number): number {
  return 0.075 / (Math.log10(re) - 2) ** 2;
}

/** Form factor k (Watanabe): fuller, shorter, deeper hulls have more form drag. */
export function formFactor(h: Hull, draft: number): number {
  const lb = h.lbp / h.beam;
  return -0.095 + (25.6 * h.cb) / (lb * lb * Math.sqrt(h.beam / draft));
}

/** Frontal area above water, m². */
export function windageArea(h: Hull, draft: number): number {
  return h.beam * (h.depth - draft + SUPERSTRUCTURE_M);
}

/** Air resistance, kN, for a relative wind speed (knots) blowing from ahead. */
export function airResistance(h: Hull, draft: number, relWindKn: number): number {
  const v = relWindKn * KNOT;
  return (0.5 * RHO_AIR * CX_AIR * windageArea(h, draft) * v * Math.abs(v)) / 1000;
}

export interface Resistance {
  /** All in kN. */
  friction: number;
  form: number;
  roughness: number;
  wave: number;
  air: number;
  total: number;
  /** Effective (towing) power: total resistance × speed, kW. */
  effectivePower: number;
  froude: number;
  wetted: number;
}

/**
 * Calm-water resistance at a speed and draft. `fouling` runs from 0 (clean hull) to 1 (heavily
 * fouled); air resistance assumes still air, so the only wind is the ship's own motion.
 */
export function calmResistance(h: Hull, speedKn: number, draft: number, fouling = 0): Resistance {
  const v = speedKn * KNOT;
  const s = wettedSurface(h, draft);
  const q = (0.5 * RHO_SEA_KG * s * v * v) / 1000; // kN per unit coefficient
  const fn = froude(h, speedKn);
  const cf = speedKn > 0 ? ittc57(reynolds(h, speedKn)) : 0;
  const friction = q * cf;
  const form = q * cf * formFactor(h, draft);
  const roughness = q * (CA_CLEAN + CA_FOULED * fouling);
  const wave = q * CW_FIT * h.cb ** 3 * fn ** 4;
  const air = airResistance(h, draft, speedKn);
  const total = friction + form + roughness + wave + air;
  return { friction, form, roughness, wave, air, total, effectivePower: total * v, froude: fn, wetted: s };
}
