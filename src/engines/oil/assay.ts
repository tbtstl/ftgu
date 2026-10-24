// Crude assays: turning a crude's composition into the numbers refiners and traders quote —
// density and API gravity, sulfur by cut, viscosity — and blending crudes together.
//
// Densities: each cut's specific gravity is the volume-weighted average of its molecule classes'
// gravities, and the crude's is the volume-weighted average of its cuts'. API gravity is the
// industry's inverted density scale, API = 141.5 / SG − 131.5 (SG at 60 °F).
// Sulfur and metals: whole-crude concentrations are spread across the cuts in proportion to each
// cut's weight (heavier cuts carry more), normalized so the mass balance closes.
// Viscosity: the ASTM D341 (Walther) relation log log(ν + 0.7) = A − B log T, with the two
// constants fitted to API gravity across the course's four crudes. Blends use the Refutas
// viscosity blending number, averaged by mass.

import { CLASSES, CRUDE_SPECS, CUTS, type CrudeId, type CrudeSpec, type MoleculeClass } from '../../model/oil/crudes';

export interface Crude {
  id: string;
  name: string;
  /** Volume fraction in each cut (CUTS order). */
  yields: number[];
  /** Specific gravity of each cut. */
  cutSG: number[];
  /** Sulfur in each cut, % by weight. */
  cutSulfur: number[];
  /** Nickel + vanadium in each cut, ppm by weight. */
  cutMetals: number[];
  /** Class shares by volume within each cut. */
  cutClasses: Array<Record<MoleculeClass, number>>;
  sg: number;
  api: number;
  /** Whole-crude sulfur, wt%. */
  sulfur: number;
  /** Whole-crude nickel + vanadium, ppm. */
  metals: number;
}

export const LITERS_PER_BARREL = 158.987;

export function apiFromSG(sg: number): number {
  return 141.5 / sg - 131.5;
}

export function sgFromAPI(api: number): number {
  return 141.5 / (api + 131.5);
}

/** Molecule-class shares in cut i for aromaticity a (0–1). */
export function classShares(i: number, a: number): Record<MoleculeClass, number> {
  const t = Math.max(0, Math.min(1, a));
  const c0 = CUTS[i].classesAt0;
  const c1 = CUTS[i].classesAt1;
  const out = {} as Record<MoleculeClass, number>;
  for (const k of CLASSES) out[k] = c0[k] + (c1[k] - c0[k]) * t;
  return out;
}

/** Specific gravity of cut i for aromaticity a. */
export function cutGravity(i: number, a: number): number {
  const sh = classShares(i, a);
  return CLASSES.reduce((s, k) => s + sh[k] * CUTS[i].classSG[k], 0);
}

/** Spreads a whole-crude concentration across cuts by weight, closing the mass balance. */
function spread(total: number, weights: number[], mass: number[]): number[] {
  const norm = weights.reduce((s, w, i) => s + w * mass[i], 0);
  return weights.map((w) => (norm > 0 ? (total * w) / norm : 0));
}

/** Normalizes a yield vector to sum to 1. */
export function normalize(ys: number[]): number[] {
  const s = ys.reduce((a, b) => a + b, 0);
  return ys.map((y) => (s > 0 ? y / s : 0));
}

/**
 * Shifts a crude's boiling distribution lighter (tilt < 0) or heavier (tilt > 0): each cut's
 * yield is scaled by e^(tilt × (i − 3)) and the result renormalized.
 */
export function tiltYields(yields: number[], tilt: number): number[] {
  return normalize(yields.map((y, i) => y * Math.exp(tilt * (i - 3))));
}

export interface CrudeParams {
  id?: string;
  name?: string;
  yields: number[];
  aromaticity: number;
  sulfur: number;
  metals: number;
}

/** Builds a full crude from its composition. */
export function makeCrude(p: CrudeParams): Crude {
  const yields = normalize(p.yields);
  const cutSG = CUTS.map((_, i) => cutGravity(i, p.aromaticity));
  const sg = yields.reduce((s, y, i) => s + y * cutSG[i], 0);
  const mass = yields.map((y, i) => (y * cutSG[i]) / sg);
  return {
    id: p.id ?? 'custom',
    name: p.name ?? 'Custom crude',
    yields,
    cutSG,
    cutSulfur: spread(p.sulfur, CUTS.map((ct) => ct.sulfurWeight), mass),
    cutMetals: spread(p.metals, CUTS.map((ct) => ct.metalsWeight), mass),
    cutClasses: CUTS.map((_, i) => classShares(i, p.aromaticity)),
    sg,
    api: apiFromSG(sg),
    sulfur: p.sulfur,
    metals: p.metals,
  };
}

const BUILT = new Map<CrudeId, Crude>(CRUDE_SPECS.map((s: CrudeSpec) => [s.id, makeCrude(s)]));

/** One of the course's four crudes. */
export function crude(id: CrudeId): Crude {
  return BUILT.get(id)!;
}

/** Mass fraction of each cut. */
export function massFractions(cr: Crude): number[] {
  return cr.yields.map((y, i) => (y * cr.cutSG[i]) / cr.sg);
}

/** Density in kg/m³ (SG × 999 kg/m³, water at 60 °F). */
export function densityKgM3(sg: number): number {
  return sg * 999.0;
}

/** Kilograms of sulfur in one barrel of the crude. */
export function sulfurKgPerBarrel(cr: Crude): number {
  return (densityKgM3(cr.sg) * (LITERS_PER_BARREL / 1000) * cr.sulfur) / 100;
}

/** Volume fraction boiling below `t` °C, interpolating linearly within each cut. */
export function cumulativeYield(cr: Crude, t: number): number {
  let acc = 0;
  for (let i = 0; i < CUTS.length; i++) {
    const { lo, hi } = CUTS[i];
    if (t >= hi) acc += cr.yields[i];
    else {
      if (t > lo) acc += (cr.yields[i] * (t - lo)) / (hi - lo);
      break;
    }
  }
  return Math.min(1, acc);
}

/** Volume fraction boiling between two temperatures. */
export function yieldBetween(cr: Crude, lo: number, hi: number): number {
  return Math.max(0, cumulativeYield(cr, hi) - cumulativeYield(cr, lo));
}

/** Temperature at which a cumulative volume fraction has boiled off (inverse of cumulativeYield). */
export function tbpTemperature(cr: Crude, frac: number): number {
  let acc = 0;
  for (let i = 0; i < CUTS.length; i++) {
    const y = cr.yields[i];
    if (acc + y >= frac || i === CUTS.length - 1) {
      const k = y > 0 ? Math.max(0, Math.min(1, (frac - acc) / y)) : 0;
      return CUTS[i].lo + k * (CUTS[i].hi - CUTS[i].lo);
    }
    acc += y;
  }
  return CUTS[CUTS.length - 1].hi;
}

// ---------------------------------------------------------------------------
// Viscosity.

/** Walther constants (log10 log10(ν + 0.7) = A − B log10 T[K]) for a crude of this API gravity. */
export function waltherConstants(api: number): { A: number; B: number } {
  // Kinematic viscosity anchors fitted across the four crudes: log10 log10(ν + 0.7) is close to
  // linear in API at 20 °C and at 50 °C.
  const z20 = -0.2053 - 0.03158 * (api - 42.1);
  const z50 = -0.3651 - 0.03258 * (api - 42.1);
  const l20 = Math.log10(293.15);
  const l50 = Math.log10(323.15);
  const B = (z20 - z50) / (l50 - l20);
  const A = z20 + B * l20;
  return { A, B };
}

/** Kinematic viscosity, centistokes (mm²/s), from Walther constants at `tC` °C. */
export function waltherViscosity({ A, B }: { A: number; B: number }, tC: number): number {
  const z = A - B * Math.log10(tC + 273.15);
  return 10 ** (10 ** z) - 0.7;
}

/** A crude's kinematic viscosity at `tC` °C, cSt. */
export function viscosity(cr: Crude, tC: number): number {
  return waltherViscosity(waltherConstants(cr.api), tC);
}

/** Refutas viscosity blending number for a viscosity in cSt. */
export function vbn(nu: number): number {
  return 14.534 * Math.log(Math.log(nu + 0.8)) + 10.975;
}

/** Viscosity (cSt) from a Refutas blending number. */
export function nuFromVbn(v: number): number {
  return Math.exp(Math.exp((v - 10.975) / 14.534)) - 0.8;
}

export interface BlendPart {
  crude: Crude;
  /** Share by volume. */
  share: number;
}

/**
 * Blends crudes by volume: cut yields and cut volumes add, cut gravities average by volume,
 * sulfur and metals by mass. The result's whole-crude numbers follow from its cuts.
 */
export function blend(parts: BlendPart[], name = 'Blend'): Crude {
  const total = parts.reduce((s, p) => s + p.share, 0) || 1;
  const w = parts.map((p) => p.share / total);
  const yields = CUTS.map((_, i) => parts.reduce((s, p, k) => s + w[k] * p.crude.yields[i], 0));
  const cutSG = CUTS.map((_, i) => {
    const v = yields[i];
    return v > 0 ? parts.reduce((s, p, k) => s + w[k] * p.crude.yields[i] * p.crude.cutSG[i], 0) / v : parts[0].crude.cutSG[i];
  });
  const cutMass = CUTS.map((_, i) => yields[i] * cutSG[i]);
  const byMass = (field: 'cutSulfur' | 'cutMetals') =>
    CUTS.map((_, i) =>
      cutMass[i] > 0 ? parts.reduce((s, p, k) => s + w[k] * p.crude.yields[i] * p.crude.cutSG[i] * p.crude[field][i], 0) / cutMass[i] : 0,
    );
  const cutSulfur = byMass('cutSulfur');
  const cutMetals = byMass('cutMetals');
  const cutClasses = CUTS.map((_, i) => {
    const out = {} as Record<MoleculeClass, number>;
    for (const k of CLASSES) out[k] = yields[i] > 0 ? parts.reduce((s, p, j) => s + w[j] * p.crude.yields[i] * p.crude.cutClasses[i][k], 0) / yields[i] : 0;
    return out;
  });
  const sg = cutMass.reduce((a, b) => a + b, 0);
  const sulfur = cutMass.reduce((s, m, i) => s + m * cutSulfur[i], 0) / sg;
  const metals = cutMass.reduce((s, m, i) => s + m * cutMetals[i], 0) / sg;
  return { id: 'blend', name, yields, cutSG, cutSulfur, cutMetals, cutClasses, sg, api: apiFromSG(sg), sulfur, metals };
}

/** Viscosity of a blend at `tC`, cSt, by the Refutas method (mass-weighted blending numbers). */
export function blendViscosity(parts: BlendPart[], tC: number): number {
  const mass = parts.map((p) => p.share * p.crude.sg);
  const m = mass.reduce((a, b) => a + b, 0) || 1;
  const v = parts.reduce((s, p, k) => s + (mass[k] / m) * vbn(viscosity(p.crude, tC)), 0);
  return nuFromVbn(v);
}

/** Classification used across the industry: light / medium / heavy by API, sweet / sour by sulfur. */
export function classify(api: number, sulfur: number): { gravity: 'light' | 'medium' | 'heavy' | 'extra heavy'; sweetness: 'sweet' | 'sour' } {
  const gravity = api > 31.1 ? 'light' : api >= 22.3 ? 'medium' : api >= 10 ? 'heavy' : 'extra heavy';
  return { gravity, sweetness: sulfur <= 0.5 ? 'sweet' : 'sour' };
}
