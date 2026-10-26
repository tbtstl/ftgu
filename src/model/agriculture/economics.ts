// The Crane Valley's farm economics: what Cedar Bend pays for its inputs and land, and the prices
// it plans around. All prices are simulated for teaching, in realistic ranges for the 2020s; they
// are not market data. Chapter 5 shows where grain prices come from; until then a price is a given.

import type { Crop, DistrictId } from './region';


/** The harvest prices Cedar Bend plans around before it knows the season, $ per bushel. */
export const PLAN_PRICE: Record<Crop, number> = { corn: 4.6, wheat: 6.0 };

/** Cash rent for cropland in each district, $ per acre per year. */
export const LAND_RENT: Record<DistrictId, number> = { north: 175, plains: 75, prairie: 265, ridge: 190, bottoms: 250 };

/** Property tax on land a farm owns, $ per acre per year. */
export const PROPERTY_TAX = 35;

/** Nitrogen fertilizer, $ per pound of N. */
export const N_PRICE = 0.6;
/** Seed corn, $ per thousand seeds. */
export const SEED_PER_THOUSAND = 3.6;
/** Pumping an acre-inch of irrigation water on the High Plains, $ (energy, repairs, labor). */
export const PUMP_PER_ACRE_INCH = 11;
/** One fungicide application, product and application, $ per acre. */
export const FUNGICIDE_PER_ACRE = 32;
/** A disease-resistant hybrid's extra seed cost, $ per acre. */
export const RESISTANT_PREMIUM = 12;
/** Scouting a field for disease, $ per acre per season. */
export const SCOUTING_PER_ACRE = 4;
/** Propane and electricity to dry a bushel of corn by one percentage point of moisture, $. */
export const DRYING_PER_POINT = 0.035;
/** Hauling grain from the field to the bin or elevator, $ per bushel. */
export const HAULING_PER_BU = 0.12;

export interface CostLine {
  id: string;
  label: string;
  /** $ per acre, before anything that scales with bushels. */
  perAcre: number;
  /** Variable costs change with what you plant and how; fixed ones are owed either way. */
  kind: 'variable' | 'fixed';
}

/**
 * Cedar Bend's budget per acre for each crop, in a normal year. Corn's drying and hauling scale with
 * the bushels harvested and are added separately (see `perBushelCost`).
 */
export const BUDGET: Record<Crop, CostLine[]> = {
  corn: [
    { id: 'seed', label: 'Seed (32,000 seeds)', perAcre: 115, kind: 'variable' },
    { id: 'fert', label: 'Fertilizer (150 lb N) and lime', perAcre: 135, kind: 'variable' },
    { id: 'chem', label: 'Herbicide and insecticide', perAcre: 58, kind: 'variable' },
    { id: 'ops', label: 'Fuel, repairs and field operations', perAcre: 66, kind: 'variable' },
    { id: 'insurance', label: 'Crop insurance', perAcre: 22, kind: 'variable' },
    { id: 'interest', label: 'Operating interest', perAcre: 16, kind: 'variable' },
    { id: 'machinery', label: 'Machinery and buildings', perAcre: 78, kind: 'fixed' },
    { id: 'labor', label: 'Labor and management', perAcre: 40, kind: 'fixed' },
  ],
  wheat: [
    { id: 'seed', label: 'Seed', perAcre: 34, kind: 'variable' },
    { id: 'fert', label: 'Fertilizer (90 lb N) and lime', perAcre: 76, kind: 'variable' },
    { id: 'chem', label: 'Herbicide and insecticide', perAcre: 28, kind: 'variable' },
    { id: 'ops', label: 'Fuel, repairs and field operations', perAcre: 44, kind: 'variable' },
    { id: 'insurance', label: 'Crop insurance', perAcre: 12, kind: 'variable' },
    { id: 'interest', label: 'Operating interest', perAcre: 7, kind: 'variable' },
    { id: 'machinery', label: 'Machinery and buildings', perAcre: 52, kind: 'fixed' },
    { id: 'labor', label: 'Labor and management', perAcre: 28, kind: 'fixed' },
  ],
};

/** Costs that scale with bushels harvested, $ per bushel: hauling, plus drying for corn at a typical 3 points. */
export function perBushelCost(crop: Crop, dryingPoints = crop === 'corn' ? 3 : 0): number {
  return HAULING_PER_BU + DRYING_PER_POINT * dryingPoints;
}

/** Total per-acre cost of a crop by kind. */
export function budgetTotal(crop: Crop, kind?: 'variable' | 'fixed'): number {
  return BUDGET[crop].filter((l) => !kind || l.kind === kind).reduce((s, l) => s + l.perAcre, 0);
}
