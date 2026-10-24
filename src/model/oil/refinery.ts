// The Calder refinery at Port Calder: the course's refinery from Chapter 3 to the capstone.
//
// A 150,000-barrel-a-day cracking and coking refinery: a crude unit with a vacuum column, a
// catalytic reformer for octane, a fluid catalytic cracker (FCC) for gas oil, a delayed coker for
// residue, a distillate hydrotreater for ultra-low-sulfur diesel, a hydrogen plant and a sulfur
// plant. Capacities are in thousand barrels a day of feed (kb/d). All prices are simulated.

import type { CrudeId } from './crudes';

export type UnitId = 'cdu' | 'reformer' | 'fcc' | 'coker' | 'dht';

export const UNIT_NAME: Record<UnitId, string> = {
  cdu: 'Crude unit',
  reformer: 'Reformer',
  fcc: 'Catalytic cracker',
  coker: 'Coker',
  dht: 'Diesel hydrotreater',
};

export interface RefineryConfig {
  /** Unit capacities, kb/d of feed. */
  capacity: Record<UnitId, number>;
  /** Hydrogen plant capacity, million standard cubic feet a day. */
  hydrogenPlant: number;
  /** Sulfur plant capacity, tonnes of sulfur a day. */
  sulfurPlant: number;
}

export const CALDER: RefineryConfig = {
  capacity: { cdu: 150, reformer: 30, fcc: 50, coker: 25, dht: 55 },
  hydrogenPlant: 40,
  sulfurPlant: 300,
};

/** Operating cost of each unit, $ per barrel of feed (energy, catalyst, labor). */
export const UNIT_OPEX: Record<UnitId, number> = { cdu: 1.0, reformer: 2.0, fcc: 2.5, coker: 3.0, dht: 1.5 };

/** Cost of hydrogen from the hydrogen plant, $ per thousand standard cubic feet (natural gas at about $3.50/MMBtu). */
export const HYDROGEN_COST = 3.0;

/** Crude delivered to Port Calder, $/bbl: the reference month (simulated). */
export const CRUDE_PRICE: Record<CrudeId, number> = { ridgeback: 76.5, seaboard: 79.5, northfield: 72, coldwater: 62 };

export type ProductId = 'lpg' | 'naphtha' | 'gasoline' | 'jet' | 'diesel' | 'hsfo' | 'coke';

export const PRODUCT_NAME: Record<ProductId, string> = {
  lpg: 'LPG',
  naphtha: 'Naphtha',
  gasoline: 'Gasoline',
  jet: 'Jet fuel',
  diesel: 'Diesel (ULSD)',
  hsfo: 'Fuel oil',
  coke: 'Petroleum coke',
};

export const PRODUCT_COLOR: Record<ProductId, string> = {
  lpg: '#9cc6e4',
  naphtha: '#f3e08a',
  gasoline: '#ecc65a',
  jet: '#e9a557',
  diesel: '#d97f3e',
  hsfo: '#5d4637',
  coke: '#3d3d3d',
};

/** Product prices at Port Calder, $/bbl (coke $/tonne): the reference month (simulated). */
export const PRODUCT_PRICE: Record<ProductId, number> = { lpg: 36, naphtha: 68, gasoline: 96, jet: 102, diesel: 106, hsfo: 62, coke: 70 };
