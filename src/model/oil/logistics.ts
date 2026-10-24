// The course world's logistics: pipelines, tankers, terminals and storage (Chapter 4 on).
//
//   Ridgeback Basin ──gathering──┐
//   Northfield ──────────────────┤
//   Coldwater ──Coldwater line───┴─▶ Kessler hub (tank farms) ──Kessler–Calder line──▶ Port Calder
//                                     │                                                 │  (Calder refinery,
//                                     └─▶ inland refineries                             │   other coastal refiners,
//                                                                                       │   export terminal)
//   Seaboard offshore field ──tanker──▶ Port Calder, Northport          tankers ──▶ Northport, Eastbay
//
// Distances, sizes and costs are illustrative but realistic in magnitude. All prices are simulated.

/** A crude pipeline. Inner diameter in inches; elevation is the delivery end minus the origin, ft. */
export interface Pipeline {
  id: string;
  name: string;
  lengthMiles: number;
  innerDiameterIn: number;
  /** Wall roughness, inches (new commercial steel ≈ 0.0018). */
  roughnessIn: number;
  elevationFt: number;
  /** Maximum allowable operating pressure, psi. */
  maop: number;
  /** Pressure kept at each pump station's intake and at delivery, psi. */
  suction: number;
  /** Pump stations built. */
  stations: number;
  /** Capital cost, $ (pipe and stations). */
  capital: number;
}

/** A 30-inch line from the inland hub down to the coast, with three pump stations. */
export const KESSLER_CALDER: Pipeline = {
  id: 'kessler-calder',
  name: 'Kessler–Calder line',
  lengthMiles: 500,
  innerDiameterIn: 29.25,
  roughnessIn: 0.0018,
  elevationFt: -1000,
  maop: 1440,
  suction: 50,
  stations: 3,
  capital: 1.8e9,
};

/** The mix of basin crudes the Kessler–Calder line usually carries. */
export const TYPICAL_CRUDE = { name: 'Basin mix', sg: 0.84, viscosity: 8 };

export const COLDWATER_LINE: Pipeline = {
  id: 'coldwater',
  name: 'Coldwater line',
  lengthMiles: 800,
  innerDiameterIn: 29.25,
  roughnessIn: 0.0018,
  elevationFt: -600,
  maop: 1440,
  suction: 50,
  stations: 8,
  capital: 2.6e9,
};

/** Electricity for pump stations, $/MWh (simulated), and pump-and-motor efficiency. */
export const PUMP_POWER_PRICE = 70;
export const PUMP_EFFICIENCY = 0.75;
/** Annual capital charge on a pipeline (return of and on capital), share of capital per year. */
export const CAPITAL_CHARGE = 0.12;
/** Operating and maintenance cost of a pipeline, $ per year per mile. */
export const PIPE_OM_PER_MILE = 60000;

// ---------------------------------------------------------------------------
// Tankers.

export type VesselId = 'aframax' | 'suezmax' | 'vlcc';

export interface Vessel {
  id: VesselId;
  name: string;
  /** Crude cargo, barrels. */
  cargo: number;
  /** Deadweight tonnes. */
  dwt: number;
  /** Charter hire, $ per day (simulated, a calm market). */
  hire: number;
  /** Fuel burned at sea at 14 knots, tonnes per day; it scales roughly with the cube of speed. */
  fuelAt14: number;
  /** Fuel burned in port and at anchor, tonnes per day. */
  fuelInPort: number;
  /** Port and canal charges per round voyage, $. */
  portCharges: number;
}

export const VESSELS: Record<VesselId, Vessel> = {
  aframax: { id: 'aframax', name: 'Aframax', cargo: 700000, dwt: 110000, hire: 30000, fuelAt14: 38, fuelInPort: 6, portCharges: 120000 },
  suezmax: { id: 'suezmax', name: 'Suezmax', cargo: 1000000, dwt: 160000, hire: 38000, fuelAt14: 48, fuelInPort: 7, portCharges: 160000 },
  vlcc: { id: 'vlcc', name: 'VLCC', cargo: 2000000, dwt: 300000, hire: 45000, fuelAt14: 65, fuelInPort: 9, portCharges: 250000 },
};

export type RouteId = 'northport' | 'eastbay' | 'seaboard';

export interface Route {
  id: RouteId;
  name: string;
  from: string;
  to: string;
  /** One-way distance, nautical miles. */
  nm: number;
}

export const ROUTES: Record<RouteId, Route> = {
  northport: { id: 'northport', name: 'Port Calder to Northport', from: 'Port Calder', to: 'Northport', nm: 5000 },
  eastbay: { id: 'eastbay', name: 'Port Calder to Eastbay', from: 'Port Calder', to: 'Eastbay', nm: 12000 },
  seaboard: { id: 'seaboard', name: 'Seaboard field to Port Calder', from: 'Seaboard terminal', to: 'Port Calder', nm: 1500 },
};

/** Very-low-sulfur marine fuel, $ per tonne (simulated). */
export const BUNKER_PRICE = 600;
/** Days in port per round voyage (loading, discharging, waiting). */
export const PORT_DAYS = 4;
/** Port Calder's channel: the largest cargo a tanker can load at the dock, barrels. More must be topped up offshore. */
export const CALDER_DOCK_LIMIT = 1000000;
/** Cost of topping up a cargo offshore from smaller vessels (reverse lightering), $ per barrel so loaded. */
export const LIGHTERING_COST = 0.6;

// ---------------------------------------------------------------------------
// Storage.

export const KESSLER_STORAGE = {
  /** Working capacity, barrels (tanks are never emptied below a heel, nor filled to the brim). */
  workingCapacity: 20e6,
  /** Fee for storing a barrel for a month, $ (simulated). */
  feePerMonth: 0.4,
  /** Pumping a barrel in or out, $. */
  handling: 0.1,
  /** Most the terminal can receive or ship in a month, barrels. */
  monthlyThroughput: 8e6,
};

/** Annual interest rate at which inventory is financed. */
export const FINANCING_RATE = 0.06;
