// Thunderstorms from four ingredients: moisture, instability, lift and wind shear. Moisture and
// instability set the CAPE; lift decides whether surface air ever reaches its level of free
// convection; shear organizes the storm. The organization rules are the forecaster's rules of
// thumb: 0–6 km bulk shear under about 10 m/s gives short-lived single cells, 10–20 m/s
// multicell clusters, and 20 m/s or more supports supercells when the bulk Richardson number
// (CAPE against the shear) is between about 10 and 45.

import { parcelAscent, satMixingRatio, type Ascent } from './thermo';

export interface StormInput {
  /** Surface air temperature, °C. */
  surfaceC: number;
  /** Surface dew point, °C. */
  dewC: number;
  /** How fast the air aloft cools with height, °C per km. */
  lapse: number;
  /** How far a front, hill or sea breeze pushes the surface air up, km. */
  liftKm: number;
  /** Change in wind between the ground and 6 km, m/s. */
  shear: number;
}

export type StormKind = 'stable' | 'capped' | 'single' | 'multicell' | 'supercell' | 'sheared';

export interface StormOutlook {
  ascent: Ascent;
  cape: number;
  cin: number;
  lfcKm: number | null;
  /** Cloud top: the equilibrium level, km. */
  topKm: number | null;
  /** Whether the lift carries surface air to its level of free convection. */
  triggered: boolean;
  /** Bulk Richardson number: CAPE ÷ ½U², with U about 0.55 × the 0–6 km shear. */
  brn: number;
  kind: StormKind;
  /** A realistic peak updraft: half of √(2·CAPE), for mixing and the weight of water, m/s. */
  updraftMs: number;
  /** Rain rate under the storm's core, mm/h. */
  rainRateMmH: number;
  /** How fast the storm moves, m/s. */
  motionMs: number;
  /** Width of the storm's rain area, km. */
  diameterKm: number;
  /** How long a storm (or a cluster's succession of cells) lasts, hours. */
  lifetimeH: number;
  /** Rain at one spot as the storm passes, mm. */
  pointRainMm: number;
}

export const STORM_KIND_LABEL: Record<StormKind, string> = {
  stable: 'No storm: the air is too stable',
  capped: 'No storm: the lift doesn’t reach free convection',
  single: 'Single-cell storm',
  multicell: 'Multicell cluster',
  supercell: 'Supercell',
  sheared: 'Storms torn apart by the shear',
};

const SHAPE: Record<StormKind, { diameterKm: number; lifetimeH: number; efficiency: number }> = {
  stable: { diameterKm: 0, lifetimeH: 0, efficiency: 0 },
  capped: { diameterKm: 0, lifetimeH: 0, efficiency: 0 },
  single: { diameterKm: 10, lifetimeH: 0.75, efficiency: 0.5 },
  multicell: { diameterKm: 30, lifetimeH: 3, efficiency: 0.5 },
  supercell: { diameterKm: 25, lifetimeH: 4, efficiency: 0.4 },
  sheared: { diameterKm: 10, lifetimeH: 0.5, efficiency: 0.2 },
};

/** Share of the storm's area in its updraft core. */
const CORE = 0.05;

export function stormOutlook(i: StormInput): StormOutlook {
  const ascent = parcelAscent({ surfaceC: i.surfaceC, lapse: i.lapse, tropopauseKm: 12 }, Math.min(i.dewC, i.surfaceC), { topKm: 15 });
  const cape = ascent.cape;
  const triggered = ascent.lfcKm !== null && i.liftKm >= ascent.lfcKm;
  const u = 0.55 * i.shear;
  const brn = u > 0 ? cape / (0.5 * u * u) : Infinity;
  let kind: StormKind;
  if (cape < 100 || ascent.lfcKm === null) kind = 'stable';
  else if (!triggered) kind = 'capped';
  else if (i.shear < 10) kind = 'single';
  else if (i.shear < 20) kind = 'multicell';
  else if (brn < 10) kind = 'sheared';
  else if (brn <= 45) kind = 'supercell';
  else kind = 'multicell';
  const s = SHAPE[kind];
  const updraftMs = kind === 'stable' || kind === 'capped' ? 0 : 0.5 * Math.sqrt(2 * cape);
  const q = satMixingRatio(Math.min(i.dewC, i.surfaceC), 1000);
  const rainRateMmH = s.efficiency * 1.1 * q * updraftMs * CORE * 3600;
  const motionMs = 5 + 0.5 * i.shear;
  const passH = s.diameterKm > 0 ? (s.diameterKm * 1000) / motionMs / 3600 : 0;
  return {
    ascent,
    cape,
    cin: ascent.cin,
    lfcKm: ascent.lfcKm,
    topKm: ascent.elKm,
    triggered,
    brn,
    kind,
    updraftMs,
    rainRateMmH,
    motionMs,
    diameterKm: s.diameterKm,
    lifetimeH: s.lifetimeH,
    pointRainMm: rainRateMmH * Math.min(passH, s.lifetimeH),
  };
}
