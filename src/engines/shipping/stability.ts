// Transverse stability: whether a loaded ship comes back upright when it rolls.
//
// Heights are measured up from the keel (K). B, the center of buoyancy, is the centroid of the
// underwater volume; M, the metacenter, is where the buoyant force's line of action crosses the
// centerline as the ship heels a little; G is the center of gravity of everything aboard.
//   KB ≈ 0.52 T                     (a full bulk-carrier section)
//   BM = I_T ÷ ∇ = 0.075 B² ÷ (Cb T) (the waterplane's transverse moment of inertia over volume)
//   GM = KB + BM − KG               (the metacentric height: positive means stable)
// For small angles a heeling moment M tips the ship to tan θ = M ÷ (Δ · GM). For larger angles we
// use the wall-sided formula GZ = sin θ (GM + ½ BM tan² θ), valid until the deck edge goes under.

import type { VesselClass } from '../../model/shipping/vessels';
import { RHO_SEA } from '../../model/shipping/vessels';
import { draftFor } from './hydrostatics';

/** Height of the tank top above the keel, m: the floor of the cargo holds. */
export const DOUBLE_BOTTOM = 1.8;
const KB_FACTOR = 0.52;
const BM_FACTOR = 0.075;
/** Lightship's center of gravity as a fraction of depth. */
const LIGHTSHIP_KG_FRAC = 0.53;
/** Fuel, water and stores sit low, in double-bottom and engine-room tanks. */
const CONSUMABLES_KG = 4;
/** Radius of gyration in roll as a fraction of beam. */
const ROLL_GYRATION = 0.4;

export interface Cargo {
  id: string;
  name: string;
  /** Stowage factor: cubic meters of hold one tonne fills, m³/t. */
  stowage: number;
}

export const CARGOES: Record<string, Cargo> = {
  ore: { id: 'ore', name: 'Iron ore', stowage: 0.4 },
  coal: { id: 'coal', name: 'Coal', stowage: 1.2 },
  grain: { id: 'grain', name: 'Wheat', stowage: 1.3 },
};

/**
 * Logs: round trunks leave gaps, so they stow at about 2 m³ to the tonne and fill a bulk carrier's
 * holds long before her marks. Log carriers stack the rest on deck (see `deckStack`).
 */
export const LOGS: Cargo = { id: 'logs', name: 'Logs', stowage: 2.0 };

/** Fraction of the length between perpendiculars taken up by the cargo holds, and so by a deck stack. */
const CARGO_LENGTH_FRAC = 0.77;

/** Deck area a deck cargo is stacked on, m²: the length of the cargo holds times the full beam. */
export function deckStowArea(v: VesselClass): number {
  return CARGO_LENGTH_FRAC * v.lbp * v.beam;
}

/** A deck cargo stacked evenly from the main deck: its height, and the heights of its top and center of gravity above the keel, m. */
export function deckStack(v: VesselClass, weight: number, stowage: number): { height: number; top: number; kg: number } {
  const height = Math.max(0, weight) * stowage / deckStowArea(v);
  return { height, top: v.depth + height, kg: v.depth + height / 2 };
}

/** The ballast tanks of a bulk carrier, as fractions of its normal ballast. */
export function ballastTanks(v: VesselClass) {
  return {
    /** Double-bottom and hopper tanks, low in the hull. */
    lower: { capacity: Math.round(v.ballast * 0.55), kg: 2.2, lever: 0.3 * v.beam },
    /** Topside wing tanks, high under the deck at the ship's sides. */
    topside: { capacity: Math.round(v.ballast * 0.45), kg: v.depth - 2.6, lever: 0.39 * v.beam },
  };
}

export interface Loading {
  cargo: number;
  cargoType: Cargo;
  consumables: number;
  /** Ballast in the lower tanks, tonnes. */
  lowerBallast: number;
  /** Ballast in the topside tanks, tonnes. */
  topsideBallast: number;
  /** Optional cargo stacked on deck above the holds (see `deckStack`). */
  deck?: { weight: number; stowage: number };
}

export interface WeightItem {
  name: string;
  weight: number;
  kg: number;
}

export interface Stability {
  displacement: number;
  draft: number;
  kb: number;
  bm: number;
  km: number;
  kg: number;
  gm: number;
  /** Natural roll period, seconds. */
  rollPeriod: number;
  /** Height of the cargo surface in the holds above the keel, m. */
  cargoTop: number;
  cargoVolume: number;
  /** True when the cargo would need more space than the holds have. */
  overVolume: boolean;
  items: WeightItem[];
}

/** Height available for cargo in the holds, m (tank top to the top of the hatch coamings). */
export function holdHeight(v: VesselClass): number {
  return v.depth + 1.5 - DOUBLE_BOTTOM;
}

/** Plan area of the holds, m², treating them as one prism. */
export function holdArea(v: VesselClass): number {
  return (v.holdVolume ?? 0) / holdHeight(v);
}

export function metacenter(v: VesselClass, draft: number): { kb: number; bm: number; km: number } {
  const kb = KB_FACTOR * draft;
  const bm = (BM_FACTOR * v.beam * v.beam) / (v.cb * draft);
  return { kb, bm, km: kb + bm };
}

export function rollPeriod(beam: number, gm: number): number {
  return gm > 0 ? (2 * Math.PI * ROLL_GYRATION * beam) / Math.sqrt(9.81 * gm) : Infinity;
}

/** Where G, B and M sit for a loading, and the resulting metacentric height. */
export function stabilityOf(v: VesselClass, l: Loading, rho = RHO_SEA): Stability {
  const area = holdArea(v);
  const cargoVolume = l.cargo * l.cargoType.stowage;
  const fill = area > 0 ? cargoVolume / area : 0;
  const cargoTop = DOUBLE_BOTTOM + Math.min(fill, holdHeight(v));
  const t = ballastTanks(v);
  const items: WeightItem[] = [
    { name: 'Lightship', weight: v.lightship, kg: LIGHTSHIP_KG_FRAC * v.depth },
    { name: 'Fuel and stores', weight: l.consumables, kg: CONSUMABLES_KG },
    { name: 'Cargo', weight: l.cargo, kg: DOUBLE_BOTTOM + Math.min(fill, holdHeight(v)) / 2 },
    { name: 'Lower ballast', weight: l.lowerBallast, kg: t.lower.kg },
    { name: 'Topside ballast', weight: l.topsideBallast, kg: t.topside.kg },
  ];
  if (l.deck && l.deck.weight > 0) items.push({ name: 'Deck cargo', weight: l.deck.weight, kg: deckStack(v, l.deck.weight, l.deck.stowage).kg });
  const displacement = items.reduce((s, i) => s + i.weight, 0);
  const kg = items.reduce((s, i) => s + i.weight * i.kg, 0) / displacement;
  const draft = draftFor(v, displacement, rho);
  const { kb, bm, km } = metacenter(v, draft);
  const gm = km - kg;
  return { displacement, draft, kb, bm, km, kg, gm, rollPeriod: rollPeriod(v.beam, gm), cargoTop, cargoVolume, overVolume: fill > holdHeight(v) + 1e-9, items };
}

/** Heel angle for a heeling moment (t·m) at small angles, degrees. */
export function smallAngleHeel(s: Stability, moment: number): number {
  return (Math.atan(moment / (s.displacement * s.gm)) * 180) / Math.PI;
}

/** Angle at which the deck edge reaches the water, degrees. */
export function deckEdgeAngle(v: VesselClass, draft: number): number {
  return (Math.atan((v.depth - draft) / (v.beam / 2)) * 180) / Math.PI;
}

/** Righting lever GZ at a heel angle (wall-sided formula), m. */
export function righting(s: Stability, deg: number): number {
  const th = (deg * Math.PI) / 180;
  return Math.sin(th) * (s.gm + 0.5 * s.bm * Math.tan(th) ** 2);
}

/** Heeling lever from a constant transverse moment (t·m), m. */
export function heelingLever(s: Stability, moment: number, deg: number): number {
  return (moment / s.displacement) * Math.cos((deg * Math.PI) / 180);
}

/** The angle at which righting balances a heeling moment, degrees (signed with the moment). */
export function equilibriumHeel(s: Stability, moment: number, maxDeg = 40): number {
  if (Math.abs(moment) < 1e-9) return 0;
  const m = Math.abs(moment);
  const f = (d: number) => righting(s, d) - heelingLever(s, m, d);
  if (f(maxDeg) < 0) return Math.sign(moment) * maxDeg;
  let lo = 0;
  let hi = maxDeg;
  // GZ may start negative (GM < 0): then the ship lolls to the angle where GZ turns positive.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return Math.sign(moment) * (lo + hi) / 2;
}
