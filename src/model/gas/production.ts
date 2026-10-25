// The region's two gas fields, their rock, their raw gas, and the costs and prices of producing
// it (illustrative, in a realistic range). Chapter 2 builds on these; later chapters use the
// basins' output.

import { composition } from '../../engines/gas/properties';
import type { Rock, TankWell } from '../../engines/gas/reservoir';
import type { ProductPrices } from '../../engines/gas/processing';

/** Raw gas from the Ridgeback shale: rich in ethane, propane and butane. */
export const RIDGEBACK_RAW = composition({ methane: 0.8, ethane: 0.12, propane: 0.04, butane: 0.015, nitrogen: 0.01, co2: 0.015 });
/** Raw gas from the old Sandhill field: lean, with nitrogen and carbon dioxide. */
export const SANDHILL_RAW = composition({ methane: 0.9, ethane: 0.02, propane: 0.005, nitrogen: 0.04, co2: 0.035 });
/** Water vapor in raw gas leaving the wells' separators, lb per MMscf. */
export const RAW_WATER = 60;

/** Sandhill's sandstone: porous and permeable, but thin and long since partly drained. */
export const SANDHILL_ROCK: Rock = { areaAcres: 640, thicknessFt: 40, porosity: 0.16, waterSat: 0.3, permMd: 3, tempF: 160 };
/** Sandhill's pressure when it was discovered, and today. */
export const SANDHILL_PI = 3800;
export const SANDHILL_P_NOW = 1500;
/** A Sandhill well as drilled at discovery: vertical, draining a closed square mile, held at 600 psia, capped at 8 MMcf/d by its facilities. */
export const SANDHILL_WELL: TankWell = { rock: SANDHILL_ROCK, piPsia: SANDHILL_PI, pwfPsia: 600, rateCapMMcfd: 8, abandonMMcfd: 0.1 };

/** Ridgeback's shale: thick and full of gas, but almost impermeable (0.0003 md = 300 nanodarcies). */
export const RIDGEBACK_ROCK: Rock = { areaAcres: 640, thicknessFt: 250, porosity: 0.07, waterSat: 0.25, permMd: 0.0003, tempF: 200 };
export const RIDGEBACK_PI = 5500;
/**
 * How a Ridgeback horizontal well is fractured: a stage every 440 ft along the well (twelve a mile), each
 * fracture reaching 500 ft into the shale on either side. At that spacing, the pressure drop spreading from
 * neighboring fractures takes about three years to meet in the middle (Lesson 2.3's 36 months of linear flow).
 */
export const RIDGEBACK_FRACS = { stageSpacingFt: 440, halfLengthFt: 500 } as const;

/** Drilling and completing one Ridgeback horizontal well, $. */
export const WELL_COST = 9_000_000;
/** Share of revenue paid to mineral owners. */
export const ROYALTY = 0.2;
/** Lifting, gathering and processing cost per Mcf produced, $. */
export const OPEX_PER_MCF = 0.6;
/** Simulated price producers receive at Ridgeback, $/MMBtu: Calder Hub's typical $3.00 less the cost of getting there. */
export const RIDGEBACK_WELLHEAD_PRICE = 2.75;

/** Simulated NGL prices at the market center and the cost of getting liquids there and splitting them, $/gallon. */
export const NGL_PRICES: ProductPrices = { gas: 2.75, ethane: 0.25, propane: 0.75, butane: 0.95, nglFee: 0.08 };

/** The Ridgeback plant's inlet: the gas of one large operator's wells, MMcf/d. */
export const PLANT_INLET_MMCFD = 400;
