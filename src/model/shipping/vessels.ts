// The shipping course's ships: the vessel classes the reader meets in Chapter 2, and the three
// bulk carriers of the fictional Northwind Bulk fleet that the course follows from the first lesson
// to the capstone — Kestrel, a Kamsarmax; Albatross, a Capesize; Petrel, an Ultramax.
//
// Dimensions, deadweights and engine sizes are typical of real ships of each class. Hydrostatics
// use a simple hull: the same block coefficient at every draft, so displacement grows in
// proportion to draft (see engines/shipping/hydrostatics).

export type VesselKind = 'bulk' | 'tanker' | 'container';

export interface Hull {
  /** Length between perpendiculars, m: the length used for hydrostatics and resistance. */
  lbp: number;
  /** Length overall, m: what locks and berths limit. */
  loa: number;
  /** Moulded beam, m. */
  beam: number;
  /** Moulded depth to the main deck, m. */
  depth: number;
  /** Summer load-line draft in sea water, m. */
  designDraft: number;
  /** Block coefficient: underwater volume ÷ (L × B × T). */
  cb: number;
  /** Weight of the empty ship, tonnes. */
  lightship: number;
}

export interface VesselClass extends Hull {
  id: string;
  name: string;
  kind: VesselKind;
  /** Summer deadweight, tonnes (displacement at the summer draft in sea water minus lightship). */
  dwt: number;
  /** Main engine maximum continuous rating, kW. */
  mcr: number;
  /** Service speed laden, knots. */
  serviceSpeed: number;
  /** Fuel, water, stores and constants carried on a typical voyage, tonnes. */
  consumables: number;
  /** Normal ballast water carried on a ballast voyage, tonnes. */
  ballast: number;
  /** Cargo hold volume, m³ (bulk carriers). */
  holdVolume?: number;
  /** Cargo tank volume, m³ (tankers). */
  tankVolume?: number;
  /** Container capacity, TEU. */
  teu?: number;
  /** Has its own cranes. */
  geared?: boolean;
  /** Where the class's name comes from, in one line. */
  origin: string;
}

/** Sea water and fresh water, t/m³. */
export const RHO_SEA = 1.025;
export const RHO_FRESH = 1.0;

function vessel(v: Omit<VesselClass, 'dwt'>): VesselClass {
  const disp = RHO_SEA * v.cb * v.lbp * v.beam * v.designDraft;
  return { ...v, dwt: Math.round(disp - v.lightship) };
}

/** Kestrel: an 82,000-tonne Kamsarmax bulk carrier, the course's reference ship. */
export const KESTREL: VesselClass = vessel({
  id: 'kamsarmax',
  name: 'Kamsarmax',
  kind: 'bulk',
  lbp: 225,
  loa: 229,
  beam: 32.25,
  depth: 20.05,
  designDraft: 14.45,
  cb: 0.87,
  lightship: 11_700,
  mcr: 9_500,
  serviceSpeed: 14,
  consumables: 2_300,
  ballast: 33_000,
  holdVolume: 97_000,
  origin: 'At most 229 m long, to fit the berth at Kamsar, Guinea’s bauxite port.',
});

/** Albatross: a 180,000-tonne Capesize. */
export const ALBATROSS: VesselClass = vessel({
  id: 'capesize',
  name: 'Capesize',
  kind: 'bulk',
  lbp: 283,
  loa: 292,
  beam: 45,
  depth: 24.8,
  designDraft: 18.2,
  cb: 0.86,
  lightship: 24_500,
  mcr: 15_000,
  serviceSpeed: 14,
  consumables: 4_000,
  ballast: 60_000,
  holdVolume: 199_000,
  origin: 'Originally too big for the Suez and Panama canals, so they sailed round the capes.',
});

/** Petrel: a 63,000-tonne Ultramax with its own cranes. */
export const PETREL: VesselClass = vessel({
  id: 'ultramax',
  name: 'Ultramax',
  kind: 'bulk',
  lbp: 195,
  loa: 199.9,
  beam: 32.24,
  depth: 18.5,
  designDraft: 13.3,
  cb: 0.855,
  lightship: 10_300,
  mcr: 8_000,
  serviceSpeed: 14,
  consumables: 1_900,
  ballast: 26_000,
  holdVolume: 79_000,
  geared: true,
  origin: 'The largest of the Supramax family: geared ships with their own cranes.',
});

export const HANDYSIZE: VesselClass = vessel({
  id: 'handysize',
  name: 'Handysize',
  kind: 'bulk',
  lbp: 172,
  loa: 180,
  beam: 30,
  depth: 14.8,
  designDraft: 10.5,
  cb: 0.83,
  lightship: 8_100,
  mcr: 6_000,
  serviceSpeed: 13.5,
  consumables: 1_400,
  ballast: 18_000,
  holdVolume: 48_000,
  geared: true,
  origin: 'Small, geared and shallow enough for minor ports: the handy size.',
});

export const VLCC: VesselClass = vessel({
  id: 'vlcc',
  name: 'VLCC',
  kind: 'tanker',
  lbp: 320,
  loa: 333,
  beam: 60,
  depth: 30.5,
  designDraft: 22.5,
  cb: 0.82,
  lightship: 43_000,
  mcr: 25_000,
  serviceSpeed: 15,
  consumables: 5_000,
  ballast: 100_000,
  tankVolume: 350_000,
  origin: 'Very large crude carrier: about two million barrels of crude.',
});

export const SUEZMAX: VesselClass = vessel({
  id: 'suezmax',
  name: 'Suezmax',
  kind: 'tanker',
  lbp: 264,
  loa: 274,
  beam: 48,
  depth: 23.7,
  designDraft: 17,
  cb: 0.82,
  lightship: 22_000,
  mcr: 16_000,
  serviceSpeed: 15,
  consumables: 3_500,
  ballast: 55_000,
  tankVolume: 175_000,
  origin: 'The largest tanker that can pass the Suez Canal fully laden.',
});

export const AFRAMAX: VesselClass = vessel({
  id: 'aframax',
  name: 'Aframax',
  kind: 'tanker',
  lbp: 239,
  loa: 250,
  beam: 44,
  depth: 21,
  designDraft: 15,
  cb: 0.81,
  lightship: 17_000,
  mcr: 13_000,
  serviceSpeed: 14.5,
  consumables: 3_000,
  ballast: 40_000,
  tankVolume: 125_000,
  origin: 'Named for the AFRA freight-rate assessment scale the class was priced on.',
});

export const PANAMAX_BOX: VesselClass = vessel({
  id: 'panamaxBox',
  name: 'Panamax container ship',
  kind: 'container',
  lbp: 283,
  loa: 294,
  beam: 32.2,
  depth: 21.8,
  designDraft: 12,
  cb: 0.62,
  lightship: 22_000,
  mcr: 36_000,
  serviceSpeed: 22,
  consumables: 4_000,
  ballast: 15_000,
  teu: 4_500,
  origin: 'Built to the limits of the original Panama Canal locks.',
});

export const NEOPANAMAX_BOX: VesselClass = vessel({
  id: 'neopanamaxBox',
  name: 'Neopanamax container ship',
  kind: 'container',
  lbp: 350,
  loa: 366,
  beam: 51,
  depth: 29.9,
  designDraft: 15.2,
  cb: 0.65,
  lightship: 45_000,
  mcr: 55_000,
  serviceSpeed: 22,
  consumables: 6_000,
  ballast: 30_000,
  teu: 14_000,
  origin: 'Built to the limits of the larger Panama Canal locks opened in 2016.',
});

export const ULCV: VesselClass = vessel({
  id: 'ulcv',
  name: 'Ultra-large container ship',
  kind: 'container',
  lbp: 383,
  loa: 400,
  beam: 61.5,
  depth: 33.2,
  designDraft: 16.5,
  cb: 0.66,
  lightship: 60_000,
  mcr: 60_000,
  serviceSpeed: 22,
  consumables: 7_000,
  ballast: 40_000,
  teu: 24_000,
  origin: 'Too wide for any Panama lock; built for the Asia–Europe trade through Suez.',
});

export const VESSEL_CLASSES: VesselClass[] = [HANDYSIZE, PETREL, KESTREL, ALBATROSS, AFRAMAX, SUEZMAX, VLCC, PANAMAX_BOX, NEOPANAMAX_BOX, ULCV];

export function vesselClass(id: string): VesselClass {
  const v = VESSEL_CLASSES.find((c) => c.id === id);
  if (!v) throw new Error(`Unknown vessel class ${id}`);
  return v;
}

/** The named ships of the Northwind Bulk fleet. */
export const NORTHWIND = {
  kestrel: { name: 'Kestrel', cls: KESTREL },
  albatross: { name: 'Albatross', cls: ALBATROSS },
  petrel: { name: 'Petrel', cls: PETREL },
} as const;
