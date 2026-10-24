// Reservoirs and flow (Lessons 2.1–2.2), in the industry's field units.
//
// Oil in place: the volumetric equation, N = 7,758 · A · h · φ · (1 − Sw) / Bo stock-tank barrels,
// where 7,758 is the number of barrels in an acre-foot. For Northfield's dome-shaped trap the
// rock volume above the oil–water contact is integrated exactly (the top of the reservoir deepens
// as k·r² from the crest).
// Flow: Darcy's law for steady radial flow into a vertical well,
//   q = 0.00708 · k · h · Δp / (μ · Bo · (ln(re/rw) + S))      [STB/day; md, ft, psi, cP]
// and the radius of investigation, how far a pressure disturbance has spread after t hours,
//   r = √(k t / (948 φ μ ct))                                   [ft].

import { BRINE_GRADIENT, FIELDS, NORTHFIELD_TRAP, gradient, type Field } from '../../model/oil/fields';

export const BBL_PER_ACRE_FT = 7758;
export const FT2_PER_ACRE = 43560;
export const FT3_PER_BBL = 5.6146;

/** Stock-tank barrels of oil in a given net rock volume (acre-feet). */
export function oilInPlace(netAcreFt: number, porosity: number, sw: number, bo: number): number {
  return (BBL_PER_ACRE_FT * netAcreFt * porosity * (1 - sw)) / bo;
}

/** The dome's curvature: depth of the reservoir top = crest + k·r². */
export function domeK(crestDepth: number, spillDepth: number, spillRadius: number): number {
  return (spillDepth - crestDepth) / spillRadius ** 2;
}

export interface TrapVolume {
  /** Height of the oil column, crest to contact, ft. */
  column: number;
  /** Area enclosed by the contact on the top of the reservoir, acres. */
  areaAcres: number;
  /** Gross rock volume holding oil, acre-feet. */
  grossAcreFt: number;
  netAcreFt: number;
  /** Stock-tank barrels in place. */
  oil: number;
}

/**
 * Oil in a dome-shaped trap filled down to `owc` ft. A reservoir layer of thickness H follows the
 * dome; at radius r it holds oil over min(H, column − k r²). Integrating 2πr dr over r gives
 * π/k · column²/2 when the column is thinner than the layer, π/k · (H·column − H²/2) otherwise.
 */
export function trapVolume(f: Field, owc: number, opts: { porosity?: number; sw?: number; spillDepth?: number; spillRadius?: number } = {}): TrapVolume {
  const spill = opts.spillDepth ?? NORTHFIELD_TRAP.spillDepth;
  const k = domeK(f.crestDepth, spill, opts.spillRadius ?? NORTHFIELD_TRAP.spillRadius);
  const column = Math.max(0, Math.min(owc, spill) - f.crestDepth);
  const H = f.grossThickness;
  const grossFt3 = column <= H ? (Math.PI / k) * (column * column) / 2 : (Math.PI / k) * (H * column - (H * H) / 2);
  const grossAcreFt = grossFt3 / FT2_PER_ACRE;
  const netAcreFt = grossAcreFt * f.netToGross;
  const areaAcres = ((Math.PI * column) / k) / FT2_PER_ACRE;
  return { column, areaAcres, grossAcreFt, netAcreFt, oil: oilInPlace(netAcreFt, opts.porosity ?? f.porosity, opts.sw ?? f.waterSaturation, f.bo) };
}

// ---------------------------------------------------------------------------
// Pressure with depth.

/** Pore pressure in the water below a field at `depth` ft, assuming a normal brine gradient from the surface. */
export function hydrostatic(depth: number, grad = BRINE_GRADIENT): number {
  return grad * depth;
}

/** Pressure in a continuous oil column above a contact at `owcDepth`, at `depth` ft. */
export function oilColumnPressure(depth: number, owcDepth: number, oilSG: number, grad = BRINE_GRADIENT): number {
  return hydrostatic(owcDepth, grad) - gradient(oilSG) * (owcDepth - depth);
}

/**
 * Whether a well can flow to surface on its own: the reservoir pressure must exceed the weight of
 * the oil standing in the wellbore plus the pressure needed at the wellhead to push oil into the
 * flowline. Returns the surplus (positive: the well flows), psi.
 */
export function naturalFlowMargin(reservoirPressure: number, depth: number, wellboreSG: number, wellheadPsi = 100): number {
  return reservoirPressure - gradient(wellboreSG) * depth - wellheadPsi;
}

// ---------------------------------------------------------------------------
// Flow toward a well.

export interface RadialWell {
  /** Permeability, md. */
  k: number;
  /** Net thickness, ft. */
  h: number;
  /** Oil viscosity, cP. */
  mu: number;
  bo: number;
  /** Drainage radius, ft. */
  re: number;
  /** Wellbore radius, ft. */
  rw: number;
  /** Skin: extra pressure loss near the well (damage > 0, stimulation < 0). */
  skin: number;
}

export const DARCY_FIELD = 0.00708;

/** Steady radial inflow, STB/day, for a drawdown of `dp` psi. */
export function radialRate(w: RadialWell, dp: number): number {
  const denom = w.mu * w.bo * (Math.log(w.re / w.rw) + w.skin);
  return denom > 0 ? (DARCY_FIELD * w.k * w.h * Math.max(0, dp)) / denom : 0;
}

/** Productivity index, STB/day per psi of drawdown. */
export function productivityIndex(w: RadialWell): number {
  return radialRate(w, 1);
}

/**
 * Pressure at radius r (ft) between the well (pwf) and the drainage edge (pe). The skin's extra
 * drop sits in a thin zone at the wellbore, so just outside the well the pressure has already
 * risen by that share.
 */
export function radialPressure(w: RadialWell, r: number, pwf: number, pe: number): number {
  // With skin S, p(r) = pwf + (pe − pwf)·(ln(r/rw) + S)/(ln(re/rw) + S). Damage (S > 0) shows as a
  // jump at the wellbore; stimulation (S < 0) acts like a wider wellbore, rw·e^(−S).
  const total = Math.log(w.re / w.rw) + w.skin;
  if (r <= w.rw || total <= 0) return pwf;
  const share = (Math.log(Math.min(r, w.re) / w.rw) + w.skin) / total;
  return pwf + (pe - pwf) * Math.max(0, Math.min(1, share));
}

/** Radius the pressure disturbance from a well has reached after `hours`, ft. */
export function radiusOfInvestigation(k: number, hours: number, phi: number, mu: number, ct: number): number {
  return Math.sqrt((k * hours) / (948 * phi * mu * ct));
}

/** Hours for a disturbance to reach `r` ft. */
export function hoursToReach(r: number, k: number, phi: number, mu: number, ct: number): number {
  return (r * r * 948 * phi * mu * ct) / k;
}

/** A field's rock as a vertical well sees it, with typical spacing (re) and a 7-inch hole. */
export function fieldWell(id: keyof typeof FIELDS, overrides: Partial<RadialWell> = {}): RadialWell {
  const f = FIELDS[id];
  return { k: f.permeability, h: f.grossThickness * f.netToGross, mu: f.oilViscosity, bo: f.bo, re: 745, rw: 0.29, skin: 0, ...overrides };
}

/**
 * Joshi's (1988) steady-state inflow for a horizontal well of length L (ft) in a layer of
 * thickness h, draining an area of radius reh. Isotropic rock.
 */
export function horizontalRate(w: RadialWell, L: number, dp: number): number {
  const reh = w.re;
  const a = (L / 2) * Math.sqrt(0.5 + Math.sqrt(0.25 + (2 * reh / L) ** 4));
  const geom = Math.log((a + Math.sqrt(a * a - (L / 2) ** 2)) / (L / 2)) + (w.h / L) * Math.log(w.h / (2 * w.rw));
  return (DARCY_FIELD * w.k * w.h * Math.max(0, dp)) / (w.mu * w.bo * (geom + (w.h / L) * w.skin));
}
