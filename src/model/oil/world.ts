// The oil course's world: one petroleum system the whole course returns to.
//
//   Pinyon Basin (inland)  — Pinyon shale wells (Pinyon Light) and the old Northfield
//                                conventional field (Northfield Sour).
//   Coldwater (far north)     — heavy-oil fields (Coldwater Heavy), piped south to Kessler.
//   Kessler hub (inland)      — tank farms where the basin's pipelines meet.
//   The Kessler–Corran line   — a 500-mile crude pipeline to the coast.
//   Port Corran (coast)       — the Corran refinery and an export terminal.
//   Overseas                  — Northport, a refining center across the ocean, and Eastbay, a
//                                distant importing region, both reached by tanker.
//
// Every price here is simulated for teaching. WTI and Brent are real benchmarks; the course's
// "WTI" and "Brent" are model prices that behave like them, not market data.

import type { CrudeId } from './crudes';

/** Reference prices, $ per barrel unless noted: simulated, a calm month in the model. */
export const REF_PRICES = {
  /** Benchmark crudes. */
  wti: 75,
  brent: 79,
  /** Products at Port Corran. */
  lpg: 36,
  naphtha: 68,
  gasoline: 96,
  jet: 102,
  diesel: 106,
  /** High-sulfur (3.5%) fuel oil and very-low-sulfur (0.5%) fuel oil. */
  hsfo: 62,
  vlsfo: 80,
  ethanol: 84,
  /** Petroleum coke, $ per tonne. */
  coke: 70,
};

export const GALLONS_PER_BARREL = 42;

/** $ per barrel → $ per gallon. */
export function perGallon(usdPerBarrel: number): number {
  return usdPerBarrel / GALLONS_PER_BARREL;
}

// ---------------------------------------------------------------------------
// The region map (src/lessons/oil/shared/RegionMap.tsx, first shown in Lesson 1.2).

export type PlaceId = 'coldwater' | 'pinyon' | 'northfield' | 'kessler' | 'inland' | 'corran' | 'seaboard' | 'northport' | 'eastbay';

export interface Place {
  id: PlaceId;
  /** The name the lessons use. */
  name: string;
  kind: 'field' | 'hub' | 'refinery' | 'port' | 'market';
  /** The crude a field produces. */
  crude?: CrudeId;
  /** A few words on what is there. */
  note: string;
  /**
   * Where the place sits on the region map: a schematic 640 × 460 frame, north up, with the land
   * to the west and the ocean to the east. Northport and Eastbay lie far across the ocean, so they
   * sit at the map's eastern edge, where the tanker routes leave it.
   */
  at: [number, number];
}

export const MAP_SIZE = { width: 640, height: 460 };

export const PLACES: Record<PlaceId, Place> = {
  coldwater: { id: 'coldwater', name: 'Coldwater', kind: 'field', crude: 'coldwater', note: 'oil sands', at: [240, 58] },
  pinyon: { id: 'pinyon', name: 'Pinyon wells', kind: 'field', crude: 'pinyon', note: 'shale', at: [70, 240] },
  northfield: { id: 'northfield', name: 'Northfield', kind: 'field', crude: 'northfield', note: 'sandstone', at: [176, 282] },
  kessler: { id: 'kessler', name: 'Kessler hub', kind: 'hub', note: 'tank farms where the pipes meet', at: [256, 196] },
  inland: { id: 'inland', name: 'Inland refineries', kind: 'refinery', note: 'near Kessler', at: [290, 340] },
  corran: { id: 'corran', name: 'Port Corran', kind: 'port', note: 'Corran refinery · export terminal', at: [440, 262] },
  seaboard: { id: 'seaboard', name: 'Seaboard field', kind: 'field', crude: 'seaboard', note: 'offshore', at: [556, 396] },
  northport: { id: 'northport', name: 'Northport', kind: 'market', note: 'refining center', at: [632, 84] },
  eastbay: { id: 'eastbay', name: 'Eastbay', kind: 'market', note: 'importing region', at: [632, 262] },
};

export const PLACE_IDS = Object.keys(PLACES) as PlaceId[];
