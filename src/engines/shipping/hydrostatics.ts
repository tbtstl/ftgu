// Hydrostatics: how deep a ship floats, and what its draft says about the weight aboard.
//
// Archimedes: a floating ship displaces its own weight of water. Our hull keeps the same block
// coefficient at every draft, so its underwater volume is Cb × L × B × T and grows in proportion
// to draft. Real hulls are a little finer near the keel; the simplification keeps every relation
// linear and is close enough near the working drafts.

import { RHO_SEA, type Hull } from '../../model/shipping/vessels';

/** Underwater volume at a draft, m³. */
export function volumeAt(h: Hull, draft: number): number {
  return h.cb * h.lbp * h.beam * draft;
}

/** Displacement — the ship's total weight — at a draft in water of density rho (t/m³), tonnes. */
export function displacementAt(h: Hull, draft: number, rho = RHO_SEA): number {
  return rho * volumeAt(h, draft);
}

/** The draft at which a ship of this weight floats in water of density rho, m. */
export function draftFor(h: Hull, displacement: number, rho = RHO_SEA): number {
  return displacement / (rho * h.cb * h.lbp * h.beam);
}

/** Waterplane area, m² (equal to Cb × L × B in our prismatic hull). */
export function waterplaneArea(h: Hull): number {
  return h.cb * h.lbp * h.beam;
}

/** Tonnes per centimeter immersion: the weight that sinks the ship one more centimeter. */
export function tpc(h: Hull, rho = RHO_SEA): number {
  return (rho * waterplaneArea(h)) / 100;
}

/** Displacement at the summer load line in sea water, tonnes. */
export function summerDisplacement(h: Hull): number {
  return displacementAt(h, h.designDraft, RHO_SEA);
}

/** Summer deadweight: everything the ship can carry (cargo, fuel, water, stores), tonnes. */
export function deadweight(h: Hull): number {
  return summerDisplacement(h) - h.lightship;
}

/**
 * Fresh water allowance, mm: how much deeper the ship floats in fresh water than in sea water at
 * its summer displacement. The rule of thumb Δ ÷ (4 × TPC) is exact for a wall-sided hull.
 */
export function freshWaterAllowanceMm(h: Hull, displacement = summerDisplacement(h)): number {
  return displacement / (4 * tpc(h, RHO_SEA));
}

export type LoadLine = 'TF' | 'F' | 'T' | 'S' | 'W';

/**
 * The load-line marks as drafts, m. Tropical and winter sit 1/48 of the summer draft above and
 * below summer; the fresh-water marks sit one fresh water allowance above their sea-water marks.
 */
export function loadLines(h: Hull): Record<LoadLine, number> {
  const s = h.designDraft;
  const step = s / 48;
  const fwa = freshWaterAllowanceMm(h) / 1000;
  return { TF: s + step + fwa, F: s + fwa, T: s + step, S: s, W: s - step };
}

export interface FloatState {
  /** Total weight: lightship + consumables + ballast + cargo, tonnes. */
  displacement: number;
  draft: number;
  freeboard: number;
  /** Draft this weight would have in sea water. */
  seaDraft: number;
  /** The weight the ship could still take before its summer mark reaches the sea surface. */
  marginToSummer: number;
}

/** Where a ship floats with a given load. */
export function floatState(h: Hull, load: { cargo: number; consumables?: number; ballast?: number }, rho = RHO_SEA): FloatState {
  const displacement = h.lightship + (load.consumables ?? 0) + (load.ballast ?? 0) + load.cargo;
  const draft = draftFor(h, displacement, rho);
  return {
    displacement,
    draft,
    freeboard: h.depth - draft,
    seaDraft: draftFor(h, displacement, RHO_SEA),
    marginToSummer: summerDisplacement(h) - displacement,
  };
}

/** The most cargo a ship can load without its sea-water draft passing the summer mark, tonnes. */
export function maxCargo(h: Hull, consumables: number, ballast = 0): number {
  return summerDisplacement(h) - h.lightship - consumables - ballast;
}

/**
 * Draft survey: cargo loaded, from the drafts read before and after loading and the dock water's
 * density, net of any change in ballast and consumables aboard.
 */
export function draftSurvey(
  h: Hull,
  before: { draft: number; ballast: number; consumables: number },
  after: { draft: number; ballast: number; consumables: number },
  rho: number,
): { dispBefore: number; dispAfter: number; cargo: number } {
  const dispBefore = displacementAt(h, before.draft, rho);
  const dispAfter = displacementAt(h, after.draft, rho);
  const cargo = dispAfter - dispBefore - (after.ballast - before.ballast) - (after.consumables - before.consumables);
  return { dispBefore, dispAfter, cargo };
}
