// The course's standard generating fleet: one fictional region, used from Chapter 2 onward.
// Costs and sizes are illustrative, chosen to be in a realistic range rather than to match
// any particular market.

import type { Fuel, Generator } from './types';

function gen(g: Partial<Generator> & Pick<Generator, 'id' | 'name' | 'fuel' | 'capacity' | 'marginalCost'>): Generator {
  const d = FUEL_DEFAULTS[g.fuel];
  return { ...d, minOutput: 0, ...g } as Generator;
}

const FUEL_DEFAULTS: Record<Fuel, Omit<Generator, 'id' | 'name' | 'fuel' | 'capacity' | 'marginalCost' | 'minOutput'>> = {
  nuclear: { rampRate: 20, startupCost: 0, fixedCost: 550_000, availability: 0.92, emissions: 0, inertiaH: 6, variable: false, dispatchable: false },
  coal: { rampRate: 90, startupCost: 40_000, fixedCost: 250_000, availability: 0.85, emissions: 1.0, inertiaH: 4, variable: false, dispatchable: true },
  gasCC: { rampRate: 200, startupCost: 15_000, fixedCost: 120_000, availability: 0.9, emissions: 0.37, inertiaH: 5, variable: false, dispatchable: true },
  gasCT: { rampRate: 200, startupCost: 2_000, fixedCost: 80_000, availability: 0.92, emissions: 0.55, inertiaH: 3, variable: false, dispatchable: true },
  oil: { rampRate: 80, startupCost: 3_000, fixedCost: 50_000, availability: 0.85, emissions: 0.8, inertiaH: 3, variable: false, dispatchable: true },
  hydro: { rampRate: 150, startupCost: 0, fixedCost: 300_000, availability: 0.95, emissions: 0, inertiaH: 3.5, variable: false, dispatchable: true },
  wind: { rampRate: 1000, startupCost: 0, fixedCost: 120_000, availability: 1, emissions: 0, inertiaH: 0, variable: true, dispatchable: false },
  solar: { rampRate: 1000, startupCost: 0, fixedCost: 80_000, availability: 1, emissions: 0, inertiaH: 0, variable: true, dispatchable: false },
  battery: { rampRate: 1000, startupCost: 0, fixedCost: 100_000, availability: 0.98, emissions: 0, inertiaH: 0, variable: false, dispatchable: true },
};

/** The region's power plants. Nodes refer to REGION in networks.ts. */
export const STANDARD_FLEET: Generator[] = [
  gen({ id: 'nuc', name: 'Harbor Point nuclear', fuel: 'nuclear', node: 'harbor', capacity: 400, minOutput: 360, marginalCost: 9 }),
  gen({ id: 'coal', name: 'Ironwood coal', fuel: 'coal', node: 'west', capacity: 300, minOutput: 120, marginalCost: 28 }),
  gen({ id: 'cc1', name: 'Lakeside combined-cycle', fuel: 'gasCC', node: 'center', capacity: 400, marginalCost: 36 }),
  gen({ id: 'cc2', name: 'Mill Creek combined-cycle', fuel: 'gasCC', node: 'city', capacity: 250, marginalCost: 42, rampRate: 150 }),
  gen({ id: 'ct', name: 'Eastgate peaker', fuel: 'gasCT', node: 'east', capacity: 200, marginalCost: 88 }),
  gen({ id: 'oil', name: 'Old Quay oil', fuel: 'oil', node: 'city', capacity: 80, marginalCost: 165 }),
  gen({ id: 'hydro', name: 'Falls hydro', fuel: 'hydro', node: 'north', capacity: 150, marginalCost: 20 }),
  gen({ id: 'wind', name: 'Ridge wind', fuel: 'wind', node: 'north', capacity: 350, marginalCost: 0 }),
  gen({ id: 'solar', name: 'Valley solar', fuel: 'solar', node: 'east', capacity: 400, marginalCost: 0 }),
];

export function fleetById(id: string): Generator {
  const g = STANDARD_FLEET.find((x) => x.id === id);
  if (!g) throw new Error(`No generator ${id}`);
  return g;
}

/** Human labels for fuels. */
export const FUEL_LABEL: Record<Fuel, string> = {
  nuclear: 'Nuclear',
  coal: 'Coal',
  gasCC: 'Gas combined-cycle',
  gasCT: 'Gas peaker',
  oil: 'Oil',
  hydro: 'Hydro',
  wind: 'Wind',
  solar: 'Solar',
  battery: 'Battery',
};

/** Build a generator with sensible defaults for its fuel (for sandboxes that create plants). */
export function makeGenerator(g: Partial<Generator> & Pick<Generator, 'id' | 'name' | 'fuel' | 'capacity' | 'marginalCost'>): Generator {
  return gen(g);
}
