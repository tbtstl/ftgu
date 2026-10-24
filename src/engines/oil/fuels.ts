// Fuels and combustion (Lesson 1.5).
//
// Typical published properties of commercial fuels: lower heating value (the heat released when
// the water formed leaves as vapor, as in an engine), liquid density, and carbon content. Carbon
// contents are set so that the CO2 per kilogram matches the factors regulators publish (for
// example 3.16 kg CO2 per kg of jet fuel, 3.114 per kg of heavy fuel oil).
// For a generic hydrocarbon CH_r, energy per kilogram is estimated as 34.7·w_C + 95.6·w_H MJ/kg,
// where w_C and w_H are the mass fractions of carbon and hydrogen: a two-term fit that lands within
// about 2% of methane, propane, octane, benzene and the commercial fuels.

export type FuelId = 'lpg' | 'gasoline' | 'jet' | 'diesel' | 'fuelOil' | 'ethanol';

export interface Fuel {
  id: FuelId;
  name: string;
  /** Lower heating value, MJ/kg. */
  lhv: number;
  /** Liquid density, kg/L (LPG as a liquid under pressure). */
  density: number;
  /** Carbon, mass fraction. */
  carbon: number;
  /** Hydrogen atoms per carbon atom. */
  hc: number;
  /** One-line description of how it burns and what limits it. */
  burns: string;
  color: string;
}

export const FUELS: Fuel[] = [
  { id: 'lpg', name: 'LPG (propane)', lhv: 46.4, density: 0.508, carbon: 0.817, hc: 2.67, burns: 'a gas at room temperature; stored as a liquid under pressure', color: '#9cc6e4' },
  { id: 'gasoline', name: 'Gasoline', lhv: 43.4, density: 0.745, carbon: 0.86, hc: 1.94, burns: 'spark-ignited; must resist knock (octane)', color: '#ecc65a' },
  { id: 'jet', name: 'Jet fuel', lhv: 43.2, density: 0.8, carbon: 0.862, hc: 1.91, burns: 'burned continuously in turbines; must not freeze at altitude', color: '#e9a557' },
  { id: 'diesel', name: 'Diesel', lhv: 42.6, density: 0.847, carbon: 0.866, hc: 1.84, burns: 'compression-ignited; must ignite readily (cetane)', color: '#d97f3e' },
  { id: 'fuelOil', name: 'Heavy fuel oil', lhv: 40.2, density: 0.98, carbon: 0.849, hc: 1.54, burns: 'too thick to pour cold; heated before burning in ships and boilers', color: '#5d4637' },
  { id: 'ethanol', name: 'Ethanol', lhv: 26.8, density: 0.789, carbon: 0.5214, hc: 3, burns: 'already partly oxidized (it contains oxygen), so it releases less heat', color: '#8fc7a0' },
];

export const FUEL_BY_ID: Record<FuelId, Fuel> = Object.fromEntries(FUELS.map((f) => [f.id, f])) as Record<FuelId, Fuel>;

export const LITERS_PER_BARREL = 158.987;
export const LITERS_PER_GALLON = 3.78541;
export const GALLONS_PER_BARREL = 42;
const CO2_PER_C = 44.009 / 12.011;

/** Energy per liter, MJ/L. */
export function mjPerLiter(f: Fuel): number {
  return f.lhv * f.density;
}

/** Energy per barrel, GJ. */
export function gjPerBarrel(f: Fuel): number {
  return (mjPerLiter(f) * LITERS_PER_BARREL) / 1000;
}

/** CO2 released per kilogram burned, kg. */
export function co2PerKg(f: Fuel): number {
  return f.carbon * CO2_PER_C;
}

/** CO2 per megajoule of heat, grams. */
export function co2PerMJ(f: Fuel): number {
  return (co2PerKg(f) / f.lhv) * 1000;
}

/** Price per gigajoule from a price per barrel. */
export function usdPerGJ(f: Fuel, usdPerBarrel: number): number {
  return usdPerBarrel / gjPerBarrel(f);
}

// ---------------------------------------------------------------------------
// A generic hydrocarbon CH_r.

/** Mass fraction of carbon in CH_r. */
export function carbonFraction(r: number): number {
  return 12.011 / (12.011 + 1.008 * r);
}

/** Estimated lower heating value of CH_r, MJ/kg. */
export function lhvFromHC(r: number): number {
  const wC = carbonFraction(r);
  return 34.7 * wC + 95.6 * (1 - wC);
}

/** Oxygen molecules needed per carbon atom: CH_r + (1 + r/4) O2 → CO2 + (r/2) H2O. */
export function oxygenPerCarbon(r: number): number {
  return 1 + r / 4;
}

/** Air needed per kilogram of fuel at the stoichiometric ratio (air is 23.14% oxygen by mass). */
export function airFuelRatio(r: number): number {
  return (oxygenPerCarbon(r) * 31.998) / (12.011 + 1.008 * r) / 0.2314;
}

/** CO2 per MJ for CH_r, grams. */
export function co2PerMJFromHC(r: number): number {
  return ((carbonFraction(r) * CO2_PER_C) / lhvFromHC(r)) * 1000;
}
