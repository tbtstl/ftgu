// Refinery process models (Lessons 3.1–3.4): distillation with movable cut points, the vacuum
// column, catalytic cracking and coking, reforming, hydrotreating, and gasoline blending.
// Each is a simplified, documented teaching model with yields and properties in realistic ranges.

import { CUTS } from '../../model/oil/crudes';
import { solveLP, type Sense } from '../market/lp';
import { LITERS_PER_BARREL, type Crude } from './assay';

// ---------------------------------------------------------------------------
// Distillation.

export interface RangeProps {
  /** Volume fraction of the crude boiling in the range. */
  volume: number;
  /** Specific gravity of the range. */
  sg: number;
  /** Sulfur, % by weight. */
  sulfur: number;
  /** Nickel + vanadium, ppm by weight. */
  metals: number;
}

/**
 * Properties of the material boiling between lo and hi °C. Within each assay cut, volume is spread
 * evenly over its temperature range, with the cut's gravity, sulfur and metals.
 */
export function rangeProps(cr: Crude, lo: number, hi: number): RangeProps {
  let vol = 0;
  let mass = 0;
  let sMass = 0;
  let mMass = 0;
  CUTS.forEach((c, i) => {
    const a = Math.max(lo, c.lo);
    const b = Math.min(hi, c.hi);
    if (b <= a) return;
    const v = (cr.yields[i] * (b - a)) / (c.hi - c.lo);
    const m = v * cr.cutSG[i];
    vol += v;
    mass += m;
    sMass += m * cr.cutSulfur[i];
    mMass += m * cr.cutMetals[i];
  });
  return { volume: vol, sg: vol > 0 ? mass / vol : 0, sulfur: mass > 0 ? sMass / mass : 0, metals: mass > 0 ? mMass / mass : 0 };
}

export interface CutPoints {
  /** Naphtha / kerosene boundary, °C. */
  naphthaKero: number;
  /** Kerosene / diesel boundary, °C. */
  keroDiesel: number;
  /** Diesel / gas oil boundary: the top of the atmospheric column's side draws, °C. */
  dieselGasoil: number;
  /** Gas oil / residue boundary in the vacuum column, °C (atmospheric-equivalent). */
  vacuumCut: number;
}

export const DEFAULT_CUTS: CutPoints = { naphthaKero: 160, keroDiesel: 250, dieselGasoil: 350, vacuumCut: 550 };

export type DistillateId = 'lpg' | 'lightNaphtha' | 'heavyNaphtha' | 'kerosene' | 'diesel' | 'vgo' | 'residue';

export const DISTILLATE_NAME: Record<DistillateId, string> = {
  lpg: 'Gases & LPG',
  lightNaphtha: 'Light naphtha',
  heavyNaphtha: 'Heavy naphtha',
  kerosene: 'Kerosene',
  diesel: 'Diesel',
  vgo: 'Vacuum gas oil',
  residue: 'Vacuum residue',
};

export const DISTILLATE_IDS: DistillateId[] = ['lpg', 'lightNaphtha', 'heavyNaphtha', 'kerosene', 'diesel', 'vgo', 'residue'];

/** The crude unit's streams for a set of cut points. */
export function distill(cr: Crude, cp: CutPoints = DEFAULT_CUTS): Record<DistillateId, RangeProps> {
  return {
    lpg: rangeProps(cr, -100, 30),
    lightNaphtha: rangeProps(cr, 30, 80),
    heavyNaphtha: rangeProps(cr, 80, cp.naphthaKero),
    kerosene: rangeProps(cr, cp.naphthaKero, cp.keroDiesel),
    diesel: rangeProps(cr, cp.keroDiesel, cp.dieselGasoil),
    vgo: rangeProps(cr, cp.dieselGasoil, cp.vacuumCut),
    residue: rangeProps(cr, cp.vacuumCut, 2000),
  };
}

/**
 * The heaviest material a column can vaporize, as an atmospheric-equivalent boiling point (°C),
 * given the furnace outlet temperature and the column's pressure. Clausius–Clapeyron with a
 * constant entropy of vaporization, ΔS/R = c ≈ 12.6: ln(P/P0) = −c·(T_atm/T − 1), so
 * T_atm = T·(1 − ln(P/P0)/c) (temperatures in kelvin).
 */
export function atmosphericEquivalent(furnaceC: number, mmHg: number): number {
  const T = furnaceC + 273.15;
  return T * (1 - Math.log(mmHg / 760) / 12.6) - 273.15;
}

/** The column pressure (mmHg) at which a furnace temperature reaches a given atmospheric-equivalent cut point. */
export function pressureForCut(furnaceC: number, cutC: number): number {
  return 760 * Math.exp(-12.6 * ((cutC + 273.15) / (furnaceC + 273.15) - 1));
}

/** Furnace temperature above which heavy oil begins to crack in the heater, °C (a typical limit). */
export const CRACKING_LIMIT = 400;

// ---------------------------------------------------------------------------
// Conversion: fluid catalytic cracking, coking, reforming.

export interface FccYields {
  /** Volume yields per barrel of feed. */
  lpg: number;
  gasoline: number;
  lco: number;
  slurry: number;
  /** Dry gas and coke, as a share of feed by weight (burned as fuel; coke heats the regenerator). */
  gas: number;
  coke: number;
}

/**
 * FCC yields at a conversion X (share of feed turned into gasoline and lighter, by volume).
 * Gasoline peaks near 75% conversion; beyond, it overcracks to LPG and gas. Light cycle oil and
 * slurry make up the unconverted 1 − X. Total liquids exceed the feed: cracking makes molecules
 * smaller and lighter, so they take more room (volume gain).
 */
export function fccYields(X: number): FccYields {
  const x = Math.max(0.5, Math.min(0.9, X));
  return {
    gasoline: 0.6 - 3 * (x - 0.75) ** 2,
    lpg: 0.1 + 0.5 * (x - 0.55) + 1.0 * (x - 0.55) ** 2,
    lco: 0.75 * (1 - x),
    slurry: 0.25 * (1 - x),
    gas: 0.02 + 0.05 * ((x - 0.55) / 0.3) ** 2,
    coke: 0.045 + 0.02 * ((x - 0.55) / 0.3),
  };
}

/** Conversion from reactor temperature (°C) and how aromatic the feed is (0–1; aromatic feed resists cracking). */
export function fccConversion(reactorC: number, feedAromaticity = 0.3): number {
  return Math.max(0.5, Math.min(0.9, 0.55 + ((reactorC - 490) / 60) * 0.3 - 0.12 * (feedAromaticity - 0.3)));
}

export interface FccPrices {
  gasoline: number;
  lpg: number;
  /** Light cycle oil, valued as a diesel blendstock that still needs hydrotreating. */
  lco: number;
  /** Slurry oil, valued as fuel oil. */
  slurry: number;
  /** The gas oil fed to the unit. */
  feed: number;
}

/** Operating cost of the FCC, $ per barrel of feed. */
export const FCC_OPEX = 2.5;

/** The FCC's margin per barrel of feed at a conversion, $/bbl. */
export function fccMargin(X: number, p: FccPrices): number {
  const y = fccYields(X);
  return y.gasoline * p.gasoline + y.lpg * p.lpg + y.lco * p.lco + y.slurry * p.slurry - p.feed - FCC_OPEX;
}

/** Delayed coker yields per barrel of vacuum residue; coke in tonnes per barrel. */
export const COKER = { lpg: 0.08, naphtha: 0.14, gasOil: 0.55, cokeTonnes: 0.05 };

/** Catalytic reformer: reformate and LPG per barrel of heavy naphtha, hydrogen in Mscf per barrel. */
export const REFORMER = { reformate: 0.84, lpg: 0.08, hydrogen: 1.0 };

// ---------------------------------------------------------------------------
// Carbon rejection and hydrogen addition.

/** Hydrogen-to-carbon atom ratios: fuels near 1.9, residue and gas oils lower, coke about 0.5. */
export const FUEL_HC = 1.9;
export const COKE_HC = 0.5;

/** Share of the feed's carbon that must leave as coke to bring the rest up to fuel's hydrogen content. */
export function carbonRejected(feedHC: number, productHC = FUEL_HC, cokeHC = COKE_HC): number {
  return Math.max(0, Math.min(1, (productHC - feedHC) / (productHC - cokeHC)));
}

/** Standard cubic feet per gram-mole of gas (60 °F, 1 atm). */
export const SCF_PER_MOL = 379.5 / 453.59;

/** Hydrogen (scf per barrel of feed) to raise a feed's H/C ratio to fuel's, with no carbon lost. */
export function hydrogenToUpgrade(feedHC: number, feedSG: number, productHC = FUEL_HC): number {
  const kg = (feedSG * 999 * LITERS_PER_BARREL) / 1000;
  const wC = 12.011 / (12.011 + 1.008 * feedHC);
  const molC = (kg * 1000 * wC) / 12.011;
  const molH2 = (Math.max(0, productHC - feedHC) / 2) * molC;
  return molH2 * SCF_PER_MOL;
}

// ---------------------------------------------------------------------------
// Hydrotreating (hydrodesulfurization).

export interface HdsFeed {
  /** Sulfur in, % by weight. */
  sulfur: number;
  /** Share of the sulfur in hard-to-reach molecules (alkylated dibenzothiophenes). */
  hardShare: number;
  /** Hydrogen consumed regardless of sulfur (saturating olefins and aromatics), scf/bbl. */
  baseHydrogen: number;
}

/** Rate constants (per hour of residence) at 350 °C, and the activation energy, J/mol. */
export const HDS = { kEasy: 20, kHard: 3.5, tRef: 350, activation: 120000 };

function arrhenius(k350: number, tempC: number): number {
  const R = 8.314;
  return k350 * Math.exp((-HDS.activation / R) * (1 / (tempC + 273.15) - 1 / (HDS.tRef + 273.15)));
}

/**
 * Sulfur left after hydrotreating at a temperature (°C) and liquid hourly space velocity (feed volume
 * per hour per volume of catalyst; residence time = 1/LHSV hours). Two first-order lumps: easy sulfur
 * and the hard, sterically hindered molecules that set how hard ultra-low sulfur is to reach.
 */
export function hdsSulfurOut(feed: HdsFeed, tempC: number, lhsv: number): number {
  const tau = 1 / Math.max(1e-6, lhsv);
  const easy = (1 - feed.hardShare) * Math.exp(-arrhenius(HDS.kEasy, tempC) * tau);
  const hard = feed.hardShare * Math.exp(-arrhenius(HDS.kHard, tempC) * tau);
  return feed.sulfur * (easy + hard);
}

/** Hydrogen to remove sulfur, scf/bbl: about three molecules of H2 per sulfur atom, plus the base. */
export function hdsHydrogen(feed: HdsFeed, sulfurOut: number, sg = 0.85): number {
  const kg = (sg * 999 * LITERS_PER_BARREL) / 1000;
  const molS = (kg * 1000 * Math.max(0, feed.sulfur - sulfurOut)) / 100 / 32.06;
  return feed.baseHydrogen + 3 * molS * SCF_PER_MOL;
}

/** Ultra-low-sulfur diesel limit, % by weight (15 ppm). */
export const ULSD_LIMIT = 0.0015;

// ---------------------------------------------------------------------------
// Gasoline blending.

export type BlendStreamId = 'butane' | 'lightNaphtha' | 'reformate' | 'fccGasoline' | 'alkylate';

export interface BlendStream {
  id: BlendStreamId;
  name: string;
  /** Research and motor octane numbers (blending values). */
  ron: number;
  mon: number;
  /** Reid vapor pressure, psi. */
  rvp: number;
  /** Sulfur, ppm by weight. */
  sulfur: number;
  /** What the stream could earn if not blended, $/bbl. */
  value: number;
  /** Available, kb/d. */
  available: number;
  color: string;
}

export const BLEND_STREAMS: BlendStream[] = [
  { id: 'butane', name: 'Butane', ron: 94, mon: 90, rvp: 52, sulfur: 1, value: 36, available: 10, color: '#9cc6e4' },
  { id: 'lightNaphtha', name: 'Light naphtha', ron: 70, mon: 67, rvp: 11, sulfur: 1, value: 68, available: 15, color: '#f3e08a' },
  { id: 'reformate', name: 'Reformate', ron: 98, mon: 88, rvp: 3, sulfur: 1, value: 90, available: 25, color: '#e6b25c' },
  { id: 'fccGasoline', name: 'FCC gasoline', ron: 92, mon: 80, rvp: 7, sulfur: 18, value: 0, available: 28, color: '#d0702a' },
  { id: 'alkylate', name: 'Alkylate', ron: 96, mon: 93, rvp: 4, sulfur: 1, value: 100, available: 8, color: '#8fc7a0' },
];

export interface GasolineSpec {
  /** Minimum anti-knock index, (R + M)/2. */
  aki: number;
  /** Maximum Reid vapor pressure, psi. */
  rvp: number;
  /** Maximum sulfur, ppm. */
  sulfur: number;
}

/** Regular gasoline in summer: 87 (R+M)/2, 9.0 psi, 10 ppm sulfur. Winter allows 13.5 psi. */
export const SUMMER: GasolineSpec = { aki: 87, rvp: 9.0, sulfur: 10 };
export const WINTER: GasolineSpec = { aki: 87, rvp: 13.5, sulfur: 10 };

/** Vapor pressure blends through an index, RVP^1.25, that mixes linearly by volume. */
export function rvpIndex(rvp: number): number {
  return Math.pow(rvp, 1.25);
}

export interface BlendResult {
  volume: number;
  aki: number;
  ron: number;
  mon: number;
  rvp: number;
  sulfur: number;
  /** Opportunity cost of the streams used, $ per day, and per barrel of blend. */
  cost: number;
  costPerBbl: number;
}

/** Properties of a blend (kb/d of each stream). Octane and sulfur blend linearly by volume here. */
export function blendProps(vols: Record<BlendStreamId, number>, streams: BlendStream[] = BLEND_STREAMS): BlendResult {
  const v = streams.reduce((s, b) => s + (vols[b.id] ?? 0), 0);
  if (v <= 0) return { volume: 0, aki: 0, ron: 0, mon: 0, rvp: 0, sulfur: 0, cost: 0, costPerBbl: 0 };
  const avg = (f: (b: BlendStream) => number) => streams.reduce((s, b) => s + (vols[b.id] ?? 0) * f(b), 0) / v;
  const ron = avg((b) => b.ron);
  const mon = avg((b) => b.mon);
  const cost = streams.reduce((s, b) => s + (vols[b.id] ?? 0) * 1000 * b.value, 0);
  return { volume: v, ron, mon, aki: (ron + mon) / 2, rvp: Math.pow(avg((b) => rvpIndex(b.rvp)), 1 / 1.25), sulfur: avg((b) => b.sulfur), cost, costPerBbl: cost / (v * 1000) };
}

export function meetsSpec(r: BlendResult, spec: GasolineSpec): boolean {
  return r.volume > 0 && r.aki >= spec.aki - 1e-9 && r.rvp <= spec.rvp + 1e-9 && r.sulfur <= spec.sulfur + 1e-9;
}

/**
 * The cheapest blend of at least `volume` kb/d meeting a spec (all FCC gasoline must be blended:
 * it has no other outlet). Returns the volumes, or null if no blend meets the spec.
 */
export function optimizeBlend(spec: GasolineSpec, volume: number, streams: BlendStream[] = BLEND_STREAMS): Record<BlendStreamId, number> | null {
  const n = streams.length;
  const A: number[][] = [];
  const b: number[] = [];
  const sense: Sense[] = [];
  // Total volume.
  A.push(streams.map(() => 1));
  b.push(volume);
  sense.push('=');
  // Octane: Σ v (AKI_i − spec) ≥ 0.
  A.push(streams.map((s) => (s.ron + s.mon) / 2 - spec.aki));
  b.push(0);
  sense.push('>=');
  // Vapor pressure index: Σ v (RVPI_i − RVPI_spec) ≤ 0.
  A.push(streams.map((s) => rvpIndex(s.rvp) - rvpIndex(spec.rvp)));
  b.push(0);
  sense.push('<=');
  // Sulfur.
  A.push(streams.map((s) => s.sulfur - spec.sulfur));
  b.push(0);
  sense.push('<=');
  // All FCC gasoline is blended.
  const fcc = streams.findIndex((s) => s.id === 'fccGasoline');
  if (fcc >= 0) {
    const row = Array<number>(n).fill(0);
    row[fcc] = 1;
    A.push(row);
    b.push(Math.min(streams[fcc].available, volume));
    sense.push('=');
  }
  const sol = solveLP({ c: streams.map((s) => s.value), A, b, sense, ub: streams.map((s) => s.available) });
  if (sol.status !== 'optimal') return null;
  return Object.fromEntries(streams.map((s, i) => [s.id, Math.max(0, sol.x[i])])) as Record<BlendStreamId, number>;
}
