// A gas processing plant: what it takes out of raw gas to make it fit for a pipeline, and what the
// pieces are worth. Three units in sequence:
//   1. An amine unit absorbs carbon dioxide.
//   2. A glycol dehydrator dries the gas.
//   3. A cryogenic plant chills the gas until ethane, propane and butane condense as natural gas
//      liquids (NGLs), leaving "residue gas" — mostly methane — for the pipeline.
// The plant burns some of its residue gas for fuel (chiefly to recompress the gas after the
// cryogenic expansion), more when it recovers ethane deeply.

import { COMPONENT, COMPONENTS, PIPELINE_SPEC, SCF_PER_LBMOL, checkSpec, composition, gasProperties, type Component, type Composition } from './properties';

/** Liquid density at 60 °F, lb per gallon (GPA 2145). */
export const LIQUID_LB_PER_GAL: Partial<Record<Component, number>> = { ethane: 2.97, propane: 4.227, butane: 4.868 };

/** Gallons of liquid in one Mcf of the pure component as gas. */
export function gallonsPerMcf(k: 'ethane' | 'propane' | 'butane'): number {
  return ((1000 / SCF_PER_LBMOL) * COMPONENT[k].mw) / (LIQUID_LB_PER_GAL[k] ?? 1);
}

/** Heat in one gallon of the liquid, MMBtu (its gas heating value × the gas a gallon makes). */
export function mmbtuPerGallon(k: 'ethane' | 'propane' | 'butane'): number {
  return (COMPONENT[k].hhv * 1000) / gallonsPerMcf(k) / 1e6;
}

/** Water left in gas by a glycol dehydrator, lb per MMscf. */
export const DRY_WATER = 4;
/** The most water the region's pipelines accept, lb per MMscf. */
export const WATER_SPEC = 7;
/** Plant fuel: a base share of the inlet gas's energy, plus more for deep ethane recovery. */
export const FUEL_BASE = 0.01;
export const FUEL_PER_ETHANE = 0.025;

export interface PlantSettings {
  /** Share of each NGL recovered as liquid, 0–1. */
  ethane: number;
  propane: number;
  butane: number;
  /** Share of the CO2 the amine unit removes, 0–1. */
  co2Removal: number;
  /** Whether the dehydrator runs. */
  dehydrate: boolean;
}

export interface PlantResult {
  /** Residue gas sent to the pipeline: composition, volume (MMcf/d) and energy (MMBtu/d). */
  residue: Composition;
  residueMMcfd: number;
  residueMMBtu: number;
  hhv: number;
  wobbe: number;
  /** Water in the residue gas, lb/MMscf. */
  water: number;
  /** Liquids recovered, gallons a day by component, and barrels a day in all. */
  ngl: { ethane: number; propane: number; butane: number };
  nglBarrels: number;
  /** Energy of the liquids recovered, MMBtu/d. */
  nglMMBtu: number;
  /** CO2 removed, MMcf/d. */
  co2Removed: number;
  /** Plant fuel burned, MMcf/d of residue gas. */
  fuelMMcfd: number;
  /** Volume lost between inlet and residue, share of the inlet ("shrink"). */
  shrink: number;
  /** The pipeline's rules, plus water. */
  checks: Array<{ id: 'hhv' | 'wobbe' | 'co2' | 'inerts' | 'water'; ok: boolean; value: number; min?: number; max: number }>;
  ok: boolean;
}

/** Runs `inletMMcfd` of raw gas (with `inletWater` lb/MMscf of water vapor) through the plant. */
export function processGas(inlet: Composition, inletMMcfd: number, inletWater: number, s: PlantSettings): PlantResult {
  const recov: Partial<Record<Component, number>> = { ethane: s.ethane, propane: s.propane, butane: s.butane, co2: s.co2Removal };
  // Volumes (MMcf/d) of each component staying in the gas.
  const stay: Record<Component, number> = Object.fromEntries(COMPONENTS.map((k) => [k, inletMMcfd * inlet[k] * (1 - (recov[k] ?? 0))])) as Record<Component, number>;
  const pre = COMPONENTS.reduce((t, k) => t + stay[k], 0);
  const residue = composition(stay);
  const props = gasProperties(residue);
  const inletEnergy = inletMMcfd * gasProperties(inlet).hhv; // MMBtu/d (MMcf × Btu/scf = MMBtu)
  const fuelMMBtu = inletEnergy * (FUEL_BASE + FUEL_PER_ETHANE * s.ethane);
  const fuelMMcfd = props.hhv > 0 ? fuelMMBtu / props.hhv : 0;
  const residueMMcfd = Math.max(0, pre - fuelMMcfd);
  const ngl = {
    ethane: inletMMcfd * 1000 * inlet.ethane * s.ethane * gallonsPerMcf('ethane'),
    propane: inletMMcfd * 1000 * inlet.propane * s.propane * gallonsPerMcf('propane'),
    butane: inletMMcfd * 1000 * inlet.butane * s.butane * gallonsPerMcf('butane'),
  };
  const nglMMBtu = ngl.ethane * mmbtuPerGallon('ethane') + ngl.propane * mmbtuPerGallon('propane') + ngl.butane * mmbtuPerGallon('butane');
  const water = s.dehydrate ? DRY_WATER : inletWater;
  const spec = checkSpec(residue, PIPELINE_SPEC);
  const checks: PlantResult['checks'] = [...spec.rules, { id: 'water', ok: water <= WATER_SPEC, value: water, max: WATER_SPEC }];
  return {
    residue,
    residueMMcfd,
    residueMMBtu: residueMMcfd * props.hhv,
    hhv: props.hhv,
    wobbe: props.wobbe,
    water,
    ngl,
    nglBarrels: (ngl.ethane + ngl.propane + ngl.butane) / 42,
    nglMMBtu,
    co2Removed: inletMMcfd * inlet.co2 * s.co2Removal,
    fuelMMcfd,
    shrink: inletMMcfd > 0 ? 1 - residueMMcfd / inletMMcfd : 0,
    checks,
    ok: checks.every((c) => c.ok),
  };
}

export interface ProductPrices {
  /** Price of the residue gas at the plant, $/MMBtu. */
  gas: number;
  /** NGL prices at the market hub, $/gallon. */
  ethane: number;
  propane: number;
  butane: number;
  /** Cost of moving NGLs to market and splitting them into products, $/gallon. */
  nglFee: number;
}

export interface PlantValue {
  /** Revenue a day from the residue gas and from each liquid net of the fee, $. */
  gas: number;
  ethane: number;
  propane: number;
  butane: number;
  total: number;
}

/** What a day's output is worth. */
export function plantValue(r: PlantResult, p: ProductPrices): PlantValue {
  const gas = r.residueMMBtu * p.gas;
  const ethane = r.ngl.ethane * (p.ethane - p.nglFee);
  const propane = r.ngl.propane * (p.propane - p.nglFee);
  const butane = r.ngl.butane * (p.butane - p.nglFee);
  return { gas, ethane, propane, butane, total: gas + ethane + propane + butane };
}

/**
 * The ethane price ($/gallon) at which recovering a gallon of ethane earns exactly what leaving it in
 * the gas would: its heat at the gas price, plus the NGL fee, plus the extra plant fuel deep recovery burns.
 */
export function ethaneBreakeven(inlet: Composition, p: Pick<ProductPrices, 'gas' | 'nglFee'>): number {
  const perGal = mmbtuPerGallon('ethane') * p.gas;
  // Extra fuel per gallon of ethane recovered: FUEL_PER_ETHANE of the inlet energy per unit of recovery.
  const inletBtuPerScf = gasProperties(inlet).hhv;
  const gallonsPerScfInlet = (inlet.ethane * gallonsPerMcf('ethane')) / 1000;
  const fuelPerGal = gallonsPerScfInlet > 0 ? (FUEL_PER_ETHANE * inletBtuPerScf) / 1e6 / gallonsPerScfInlet : 0;
  return perGal + p.nglFee + fuelPerGal * p.gas;
}
