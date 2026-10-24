// Ship design at the level of a first sketch: from length, beam and draft to deadweight, cargo
// capacity and fuel, and whether the ship fits the canals and straits that shape the trades.
//
// The hull follows the hydrostatics of Chapter 1 (constant block coefficient). The rest is
// proportion: depth from draft, length between perpendiculars from length overall, and the empty
// ship's weight from its "cubic number" L × B × D, with coefficients fitted to the course's
// reference ships of each kind.

import { RHO_FRESH, RHO_SEA, type Hull, type VesselKind } from '../../model/shipping/vessels';
import { displacementAt } from './hydrostatics';
import { powerAndFuel } from './propulsion';

export interface KindRules {
  cb: number;
  /** Design draft ÷ depth. */
  draftToDepth: number;
  /** Lightship tonnes per m³ of L × B × D. */
  lightshipPerCubic: number;
  /** LBP ÷ LOA. */
  lbpToLoa: number;
  /** Consumables carried, as a share of deadweight. */
  consumablesShare: number;
}

export const KIND_RULES: Record<VesselKind, KindRules> = {
  bulk: { cb: 0.86, draftToDepth: 0.72, lightshipPerCubic: 0.079, lbpToLoa: 0.975, consumablesShare: 0.028 },
  tanker: { cb: 0.82, draftToDepth: 0.73, lightshipPerCubic: 0.074, lbpToLoa: 0.96, consumablesShare: 0.016 },
  container: { cb: 0.65, draftToDepth: 0.5, lightshipPerCubic: 0.085, lbpToLoa: 0.955, consumablesShare: 0.04 },
};

/** Crude oil, tonnes per m³, and barrels per m³. */
export const CRUDE_DENSITY = 0.86;
export const BARRELS_PER_M3 = 6.2898;
/** Average loaded weight of a container, tonnes per TEU, for container ships' weight capacity. */
export const TONNES_PER_TEU = 12;

export interface DesignInput {
  kind: VesselKind;
  loa: number;
  beam: number;
  draft: number;
}

export interface Design extends Hull {
  kind: VesselKind;
  dwt: number;
  /** Cargo that fits once fuel and stores are aboard, tonnes. */
  cargoTonnes: number;
  /** Tankers: barrels of crude. Containers: TEU slots. Bulk: tonnes. */
  capacity: number;
  capacityUnit: 't' | 'bbl' | 'TEU';
  mcr: number;
}

/** Container slots from the hull's cubic number, fitted to 4,500-, 14,000- and 24,000-TEU ships. */
export function teuFromCubic(cubic: number): number {
  return Math.exp(8.41 + 1.23 * (Math.log(cubic) - 12.2));
}

/** A first-sketch design from length, beam, draft and kind. */
export function designShip(d: DesignInput): Design {
  const r = KIND_RULES[d.kind];
  const lbp = d.loa * r.lbpToLoa;
  const depth = d.draft / r.draftToDepth;
  const lightship = r.lightshipPerCubic * lbp * d.beam * depth;
  const hull: Hull = { lbp, loa: d.loa, beam: d.beam, depth, designDraft: d.draft, cb: r.cb, lightship };
  const dwt = displacementAt(hull, d.draft, RHO_SEA) - lightship;
  const cargoTonnes = dwt * (1 - r.consumablesShare);
  let capacity = cargoTonnes;
  let capacityUnit: Design['capacityUnit'] = 't';
  if (d.kind === 'tanker') {
    capacity = (cargoTonnes / CRUDE_DENSITY) * BARRELS_PER_M3;
    capacityUnit = 'bbl';
  } else if (d.kind === 'container') {
    capacity = teuFromCubic(lbp * d.beam * depth);
    capacityUnit = 'TEU';
  }
  // Engine sized for 14 knots (bulk, tanker) or 22 knots (container) laden with a 15% sea margin.
  const service = d.kind === 'container' ? 22 : 14;
  const calm = powerAndFuel({ ...hull, mcr: 1 }, service, { draft: d.draft }).brakePower;
  const mcr = (calm * 1.15) / 0.9;
  return { ...hull, kind: d.kind, dwt, cargoTonnes, capacity, capacityUnit, mcr };
}

export interface Passage {
  id: 'panama' | 'neopanamax' | 'suez' | 'malacca';
  name: string;
  maxLoa: number;
  maxBeam: number;
  /** Maximum draft, m, measured in the passage's own water. */
  maxDraft: number;
  /** Ships wider than this may pass only at a reduced draft (Suez), m. */
  fullDraftBeam?: number;
  /** The reduced draft allowed at the maximum beam, m (linear in between, in our model). */
  draftAtMaxBeam?: number;
  /** Water density in the passage (the Panama locks are filled with fresh lake water). */
  rho: number;
  note: string;
}

/**
 * The passages that name ship classes. Panama limits are for the locks (fresh water). Suez's
 * 20.1 m (66 ft) draft limit applies to ships up to 50 m wide; wider ships must float higher, which
 * our model simplifies to a straight line down to 12 m at the 77.5 m maximum beam. Malacca's is the
 * usual "Malaccamax" draft.
 */
export const PASSAGES: Passage[] = [
  { id: 'panama', name: 'Panama Canal, original locks', maxLoa: 294.13, maxBeam: 32.31, maxDraft: 12.04, rho: RHO_FRESH, note: 'Limits set when the canal opened in 1914.' },
  { id: 'neopanamax', name: 'Panama Canal, Neopanamax locks', maxLoa: 366, maxBeam: 51.25, maxDraft: 15.24, rho: RHO_FRESH, note: 'The larger locks opened in 2016.' },
  { id: 'suez', name: 'Suez Canal', maxLoa: 500, maxBeam: 77.5, maxDraft: 20.1, fullDraftBeam: 50, draftAtMaxBeam: 12, rho: RHO_SEA, note: 'No locks; the limit is the channel’s depth.' },
  { id: 'malacca', name: 'Strait of Malacca', maxLoa: 500, maxBeam: 80, maxDraft: 20.5, rho: RHO_SEA, note: 'The shallowest stretch, near Singapore, limits draft.' },
];

export interface PassageCheck {
  passage: Passage;
  /** Fits by length and beam at all. */
  fits: boolean;
  /** Can pass at its full summer draft. */
  laden: boolean;
  /** Draft in the passage's water when fully laden, m. */
  ladenDraft: number;
  /** The most cargo it could carry through, tonnes (0 if it doesn't fit). */
  cargoThrough: number;
}

/** The draft a passage allows a ship of this beam, m, in the passage's own water. */
export function allowedDraft(p: Passage, beam: number): number {
  if (p.fullDraftBeam === undefined || p.draftAtMaxBeam === undefined || beam <= p.fullDraftBeam) return p.maxDraft;
  const k = Math.min(1, (beam - p.fullDraftBeam) / (p.maxBeam - p.fullDraftBeam));
  return p.maxDraft + k * (p.draftAtMaxBeam - p.maxDraft);
}

/** Whether a design passes each canal or strait, and how much cargo it could take through. */
export function checkPassages(d: Design): PassageCheck[] {
  return PASSAGES.map((p) => {
    const fits = d.loa <= p.maxLoa + 1e-9 && d.beam <= p.maxBeam + 1e-9;
    const maxDraft = allowedDraft(p, d.beam);
    const ladenDraft = (d.designDraft * RHO_SEA) / p.rho;
    const laden = fits && ladenDraft <= maxDraft + 1e-9;
    // Draft allowed, converted to an equivalent sea-water draft, then the displacement it allows.
    const seaDraft = Math.min(d.designDraft, (maxDraft * p.rho) / RHO_SEA);
    const disp = displacementAt(d, seaDraft, RHO_SEA);
    const cargoThrough = fits ? Math.max(0, Math.min(d.cargoTonnes, disp - d.lightship - (d.dwt - d.cargoTonnes))) : 0;
    return { passage: p, fits, laden, ladenDraft, cargoThrough };
  });
}

/** Fuel per tonne of cargo per 1,000 nautical miles at a speed, laden, kg. */
export function fuelPerKiloTonneMile(d: Design, speedKn: number): number {
  const pf = powerAndFuel(d, speedKn, { draft: d.designDraft });
  const milesPerDay = speedKn * 24;
  return ((pf.totalTpd * 1000) / (d.cargoTonnes * milesPerDay)) * 1000;
}
