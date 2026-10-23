// The shared grid model. Every sandbox describes its world with these types, so a generator
// placed in Chapter 2 is the same object that bids in Chapter 4 and is traded around in Chapter 6.

export type Fuel = 'nuclear' | 'coal' | 'gasCC' | 'gasCT' | 'oil' | 'hydro' | 'wind' | 'solar' | 'battery';

export interface Generator {
  id: string;
  name: string;
  fuel: Fuel;
  /** Network node the plant connects to. */
  node?: string;
  /** Nameplate capacity, MW. */
  capacity: number;
  /** Lowest stable output while running, MW (must-run plants never go below it). */
  minOutput: number;
  /** Fuel plus variable operating cost, $/MWh. Offers default to this. */
  marginalCost: number;
  /** Maximum change in output per hour, MW/h. */
  rampRate: number;
  /** Cost of a start, $. */
  startupCost: number;
  /** Annualized capital plus fixed operating cost, $ per MW of capacity per year. */
  fixedCost: number;
  /** Long-run share of hours the plant is mechanically available, 0–1. */
  availability: number;
  /** tCO2 per MWh produced. */
  emissions: number;
  /** Inertia constant H in seconds (0 for inverter-based plants). */
  inertiaH: number;
  /** Output follows the weather (wind, solar). */
  variable: boolean;
  /** Can be started, stopped and moved on instruction. */
  dispatchable: boolean;
}

export type LoadKind = 'residential' | 'commercial' | 'industrial' | 'dataCenter';

export interface Load {
  id: string;
  node: string;
  kind: LoadKind;
  /** Peak demand, MW. */
  peak: number;
}

export interface Battery {
  id: string;
  node?: string;
  /** Maximum charge or discharge rate, MW. */
  powerMW: number;
  /** Usable energy, MWh. */
  energyMWh: number;
  /** Round-trip efficiency, 0–1. */
  efficiency: number;
  /** Initial state of charge, 0–1. */
  soc0: number;
}

export interface GridNode {
  id: string;
  name: string;
  /** Position in a 600 × 400 drawing. */
  x: number;
  y: number;
}

export interface Line {
  id: string;
  from: string;
  to: string;
  /** Series reactance (relative units). Power divides in inverse proportion to it. */
  reactance: number;
  /** Thermal limit, MW. */
  limit: number;
  lengthKm?: number;
  kV?: number;
}

export interface Network {
  nodes: GridNode[];
  lines: Line[];
}

export type Role = 'generator' | 'utility' | 'retailer' | 'trader' | 'iso' | 'aggregator';

export interface Participant {
  id: string;
  name: string;
  role: Role;
}

/** One value per hour of a day. */
export type Hourly = number[];
