// The dry bulk trades of the course's world: who ships what, from where to where, on which size
// of ship. The ports and commodities are real trades; the volumes are round, illustrative numbers
// of a realistic size, and the fleets are sized to carry them. None of this is market data.

import { ALBATROSS, KESTREL, type VesselClass } from './vessels';

export type ClassId = 'cape' | 'kmax';

export interface MarketClass {
  id: ClassId;
  name: string;
  vessel: VesselClass;
  /** Cargo per voyage, tonnes. */
  cargo: number;
  /** Ships in the world fleet of this class (the model's baseline). */
  fleet: number;
  /** Port charges for a load and a discharge call together, $ (illustrative). */
  portCosts: number;
  /** Panama and Suez tolls for a laden transit, $ (illustrative). */
  canalTolls: { panama: number; suez: number };
  /** Fuel efficiency of the fleet's age groups, as multiples of the reference ship, and their shares. */
  cohorts: Array<{ name: string; share: number; fuel: number; layup: number }>;
  /** Earnings above which charterers start to give up marginal cargoes, $/day. */
  choke: number;
  /** Laden and ballast speed limits, knots. */
  vMin: number;
  vMax: number;
}

export interface Route {
  id: string;
  cls: ClassId;
  from: string;
  to: string;
  commodity: string;
  /** Million tonnes a year at the baseline. */
  mtpa: number;
  /** Days in port for loading and discharging together. */
  portDays: number;
  /** Monthly shape, January first; averages 1. */
  season: number[];
}

const flat = Array(12).fill(1);
const norm = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.map((x) => x / m);
};

/** Brazil's soybean harvest ships mostly from March to July. */
export const SEASON_BRAZIL_SOY = norm([0.6, 0.9, 1.4, 1.6, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6, 0.5, 0.5]);
/** The US harvest ships mostly from September to January. */
export const SEASON_US_GRAIN = norm([1.3, 1.1, 0.9, 0.7, 0.6, 0.6, 0.7, 0.8, 1.1, 1.4, 1.5, 1.4]);
/** Brazil's rainy season slows ore shipments early in the year. */
export const SEASON_BRAZIL_ORE = norm([0.85, 0.85, 0.9, 1.0, 1.05, 1.05, 1.08, 1.08, 1.05, 1.05, 1.02, 1.02]);
/** Cyclones close Western Australia's ore ports at times from January to March. */
export const SEASON_AUS_ORE = norm([0.92, 0.9, 0.95, 1.02, 1.03, 1.03, 1.03, 1.03, 1.02, 1.02, 1.02, 1.03]);
/** Coal demand peaks in the northern winter and summer. */
export const SEASON_COAL = norm([1.05, 0.95, 0.95, 0.95, 0.95, 1.0, 1.05, 1.05, 1.0, 1.0, 1.0, 1.05]);

export const MARKET_CLASSES: Record<ClassId, MarketClass> = {
  cape: {
    id: 'cape',
    name: 'Capesize',
    vessel: ALBATROSS,
    cargo: 170_000,
    fleet: 820,
    portCosts: 250_000,
    canalTolls: { panama: 0, suez: 350_000 },
    cohorts: [
      { name: 'under 5 years', share: 0.22, fuel: 0.92, layup: 1_500 },
      { name: '5–9 years', share: 0.26, fuel: 0.98, layup: 2_000 },
      { name: '10–14 years', share: 0.23, fuel: 1.05, layup: 3_000 },
      { name: '15–19 years', share: 0.18, fuel: 1.12, layup: 4_500 },
      { name: '20 years and over', share: 0.11, fuel: 1.22, layup: 6_000 },
    ],
    choke: 45_000,
    vMin: 8.5,
    vMax: 14.5,
  },
  kmax: {
    id: 'kmax',
    name: 'Kamsarmax',
    vessel: KESTREL,
    cargo: 75_000,
    fleet: 640,
    portCosts: 150_000,
    canalTolls: { panama: 200_000, suez: 180_000 },
    cohorts: [
      { name: 'under 5 years', share: 0.22, fuel: 0.92, layup: 1_200 },
      { name: '5–9 years', share: 0.26, fuel: 0.98, layup: 1_600 },
      { name: '10–14 years', share: 0.23, fuel: 1.05, layup: 2_400 },
      { name: '15–19 years', share: 0.18, fuel: 1.12, layup: 3_600 },
      { name: '20 years and over', share: 0.11, fuel: 1.22, layup: 4_800 },
    ],
    choke: 35_000,
    vMin: 8.5,
    vMax: 14.5,
  },
};

export const ROUTES: Route[] = [
  { id: 'C-PHE-QIN', cls: 'cape', from: 'PHE', to: 'QIN', commodity: 'iron ore', mtpa: 600, portDays: 5, season: SEASON_AUS_ORE },
  { id: 'C-TUB-QIN', cls: 'cape', from: 'TUB', to: 'QIN', commodity: 'iron ore', mtpa: 250, portDays: 6, season: SEASON_BRAZIL_ORE },
  { id: 'C-TUB-ROT', cls: 'cape', from: 'TUB', to: 'ROT', commodity: 'iron ore', mtpa: 40, portDays: 6, season: SEASON_BRAZIL_ORE },
  { id: 'C-NEW-QIN', cls: 'cape', from: 'NEW', to: 'QIN', commodity: 'coal', mtpa: 40, portDays: 6, season: SEASON_COAL },
  { id: 'C-RBY-PAR', cls: 'cape', from: 'RBY', to: 'PAR', commodity: 'coal', mtpa: 20, portDays: 6, season: SEASON_COAL },
  { id: 'P-SAN-QIN', cls: 'kmax', from: 'SAN', to: 'QIN', commodity: 'soybeans', mtpa: 70, portDays: 8, season: SEASON_BRAZIL_SOY },
  { id: 'P-NOL-QIN', cls: 'kmax', from: 'NOL', to: 'QIN', commodity: 'grain', mtpa: 30, portDays: 8, season: SEASON_US_GRAIN },
  { id: 'P-NOL-ROT', cls: 'kmax', from: 'NOL', to: 'ROT', commodity: 'grain', mtpa: 15, portDays: 7, season: SEASON_US_GRAIN },
  { id: 'P-SAM-QIN', cls: 'kmax', from: 'SAM', to: 'QIN', commodity: 'coal', mtpa: 120, portDays: 7, season: SEASON_COAL },
  { id: 'P-SAM-PAR', cls: 'kmax', from: 'SAM', to: 'PAR', commodity: 'coal', mtpa: 80, portDays: 7, season: SEASON_COAL },
  { id: 'P-NEW-QIN', cls: 'kmax', from: 'NEW', to: 'QIN', commodity: 'coal', mtpa: 30, portDays: 7, season: SEASON_COAL },
  { id: 'P-RBY-PAR', cls: 'kmax', from: 'RBY', to: 'PAR', commodity: 'coal', mtpa: 30, portDays: 7, season: SEASON_COAL },
];

export const FLAT_SEASON = flat;

export function routesOf(cls: ClassId): Route[] {
  return ROUTES.filter((r) => r.cls === cls);
}

/** The ports that appear in any trade. */
export const TRADE_PORTS = [...new Set(ROUTES.flatMap((r) => [r.from, r.to]))];

/** Off-hire days a year: drydockings and repairs. */
export const OFF_HIRE_DAYS = 10;
/** Illustrative baseline bunker price, $/t (VLSFO). */
export const BASE_BUNKER = 600;
