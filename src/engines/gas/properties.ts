// What a natural gas is made of, and what that makes it worth: heating value, density, specific
// gravity, Wobbe index and the CO2 it releases when burned. Everything is per standard cubic foot
// (scf): the gas a cubic foot would hold at 60 °F and 14.73 psia, the base most North American
// gas contracts use. Component data are the ideal-gas values of GPA Standard 2145, moved from its
// 14.696 psia base to 14.73 psia.

/** The constituents the course works with. Butanes are lumped as n-butane. */
export type Component = 'methane' | 'ethane' | 'propane' | 'butane' | 'nitrogen' | 'co2';

export const COMPONENTS: Component[] = ['methane', 'ethane', 'propane', 'butane', 'nitrogen', 'co2'];

/** Mole fractions (equal to volume fractions for ideal gases), summing to 1. */
export type Composition = Record<Component, number>;

/** Standard conditions: 60 °F and 14.73 psia. */
export const STD_TEMP_F = 60;
export const STD_PSIA = 14.73;
/** Absolute temperature from °F, in degrees Rankine. */
export const rankine = (f: number) => f + 459.67;
/** psia from psig at sea level. */
export const psia = (psig: number) => psig + 14.696;
export const psig = (abs: number) => abs - 14.696;

/** Universal gas constant, psia·ft³ per (lb-mol·°R). */
export const R_PSIA = 10.7316;
/** Universal gas constant, ft·lbf per (lb-mol·°R). */
export const R_FTLBF = 1545.35;
/** Molar mass of dry air, lb per lb-mol. */
export const AIR_MW = 28.9625;
/** Standard cubic feet in one lb-mol of ideal gas at 60 °F and 14.73 psia (≈ 378.6). */
export const SCF_PER_LBMOL = (R_PSIA * rankine(STD_TEMP_F)) / STD_PSIA;

const BASE = STD_PSIA / 14.696;

export interface ComponentData {
  name: string;
  formula: string;
  /** Molar mass, lb/lb-mol. */
  mw: number;
  /** Ideal gross (higher) heating value, Btu/scf at 60 °F, 14.73 psia. */
  hhv: number;
  /** Carbon atoms per molecule (CO2 formed when burned, or carried through for CO2 itself). */
  carbon: number;
  /** Hydrogen atoms per molecule (water formed when burned). */
  hydrogen: number;
  /** Critical temperature, °R. */
  tc: number;
  /** Critical pressure, psia. */
  pc: number;
  /** Acentric factor. */
  omega: number;
}

export const COMPONENT: Record<Component, ComponentData> = {
  methane: { name: 'Methane', formula: 'CH₄', mw: 16.043, hhv: 1010.0 * BASE, carbon: 1, hydrogen: 4, tc: 343.0, pc: 667.0, omega: 0.0115 },
  ethane: { name: 'Ethane', formula: 'C₂H₆', mw: 30.069, hhv: 1769.7 * BASE, carbon: 2, hydrogen: 6, tc: 549.6, pc: 706.6, omega: 0.0995 },
  propane: { name: 'Propane', formula: 'C₃H₈', mw: 44.096, hhv: 2516.1 * BASE, carbon: 3, hydrogen: 8, tc: 665.7, pc: 616.1, omega: 0.1523 },
  butane: { name: 'Butane', formula: 'C₄H₁₀', mw: 58.122, hhv: 3262.3 * BASE, carbon: 4, hydrogen: 10, tc: 765.3, pc: 550.6, omega: 0.2002 },
  nitrogen: { name: 'Nitrogen', formula: 'N₂', mw: 28.013, hhv: 0, carbon: 0, hydrogen: 0, tc: 227.2, pc: 492.3, omega: 0.0377 },
  co2: { name: 'Carbon dioxide', formula: 'CO₂', mw: 44.01, hhv: 0, carbon: 1, hydrogen: 0, tc: 547.6, pc: 1070.0, omega: 0.2236 },
};

/** Heat released when a lb-mol of water vapor condenses at 60 °F, Btu (1,059.8 Btu/lb × 18.015). */
const LATENT_BTU_PER_LBMOL = 1059.8 * 18.015;
const LB_PER_KG = 2.20462;

/** A composition from partial fractions; missing components are 0 and the result is normalized to sum to 1. */
export function composition(parts: Partial<Composition>): Composition {
  const c = Object.fromEntries(COMPONENTS.map((k) => [k, Math.max(0, parts[k] ?? 0)])) as Composition;
  const total = COMPONENTS.reduce((s, k) => s + c[k], 0);
  if (total <= 0) return { ...c, methane: 1 };
  for (const k of COMPONENTS) c[k] /= total;
  return c;
}

/** Pure methane. */
export const METHANE = composition({ methane: 1 });

export interface GasProperties {
  /** Molar mass, lb/lb-mol. */
  mw: number;
  /** Specific gravity relative to air (ideal). */
  sg: number;
  /** Gross (higher) heating value, Btu/scf: water from combustion condensed. */
  hhv: number;
  /** Net (lower) heating value, Btu/scf: water left as vapor. */
  lhv: number;
  /** Wobbe index: HHV ÷ √(specific gravity), Btu/scf. Gases with the same Wobbe index give the same heat through a burner. */
  wobbe: number;
  /** Density at standard conditions, lb/scf. */
  density: number;
  /** Energy per pound, Btu/lb (gross). */
  btuPerLb: number;
  /** CO2 released when the gas is burned, including CO2 already in it, lb per MMBtu (gross). */
  co2LbPerMMBtu: number;
  /** The same in kg per MMBtu. */
  co2KgPerMMBtu: number;
  /** Cubic feet of air needed to burn one cubic foot of the gas completely. */
  airPerVolume: number;
}

/** Heating value, density, Wobbe index and emissions of a gas mixture. */
export function gasProperties(c: Composition): GasProperties {
  let mw = 0;
  let hhv = 0;
  let water = 0;
  let carbon = 0;
  let o2 = 0;
  for (const k of COMPONENTS) {
    const d = COMPONENT[k];
    const x = c[k];
    mw += x * d.mw;
    hhv += x * d.hhv;
    water += (x * d.hydrogen) / 2;
    carbon += x * d.carbon;
    if (d.hhv > 0) o2 += x * (d.carbon + d.hydrogen / 4);
  }
  const lhv = hhv - (water * LATENT_BTU_PER_LBMOL) / SCF_PER_LBMOL;
  const sg = mw / AIR_MW;
  const co2LbPerScf = (carbon * COMPONENT.co2.mw) / SCF_PER_LBMOL;
  const co2LbPerMMBtu = hhv > 0 ? (co2LbPerScf / hhv) * 1e6 : Infinity;
  const density = mw / SCF_PER_LBMOL;
  return {
    mw,
    sg,
    hhv,
    lhv,
    wobbe: hhv / Math.sqrt(sg),
    density,
    btuPerLb: density > 0 ? hhv / density : 0,
    co2LbPerMMBtu,
    co2KgPerMMBtu: co2LbPerMMBtu / LB_PER_KG,
    airPerVolume: o2 / 0.2095,
  };
}

/** Cubic feet of oxygen used, and of CO2 and water vapor formed, per cubic foot of gas burned completely (CO2 already in the gas included). */
export function combustionProducts(c: Composition): { o2: number; co2: number; water: number } {
  let o2 = 0;
  let co2 = 0;
  let water = 0;
  for (const k of COMPONENTS) {
    const d = COMPONENT[k];
    co2 += c[k] * d.carbon;
    water += (c[k] * d.hydrogen) / 2;
    if (d.hhv > 0) o2 += c[k] * (d.carbon + d.hydrogen / 4);
  }
  return { o2, co2, water };
}

/**
 * The region's pipeline-quality gas: mostly methane with a little ethane, propane and butane and
 * traces of nitrogen and CO2. Its heating value, about 1,037 Btu/scf, is the conversion the
 * course uses from Chapter 3 on: one Mcf (thousand scf) carries 1.037 MMBtu.
 */
export const PIPELINE_GAS = composition({ methane: 0.95, ethane: 0.03, propane: 0.006, butane: 0.002, nitrogen: 0.008, co2: 0.004 });

/** MMBtu in one Mcf of the region's pipeline gas (its HHV in Btu/scf ÷ 1,000), rounded to 1.037. */
export const MMBTU_PER_MCF = 1.037;

/** A pipeline's gas-quality rule: limits on heating value, Wobbe index and inert gases. */
export interface QualitySpec {
  hhvMin: number;
  hhvMax: number;
  wobbeMin: number;
  wobbeMax: number;
  /** Maximum CO2 mole fraction. */
  co2Max: number;
  /** Maximum total inerts (N2 + CO2) mole fraction. */
  inertMax: number;
}

/** The region's pipelines accept gas within these limits (illustrative, in the usual North American range). */
export const PIPELINE_SPEC: QualitySpec = { hhvMin: 970, hhvMax: 1100, wobbeMin: 1310, wobbeMax: 1400, co2Max: 0.02, inertMax: 0.04 };

export interface SpecCheck {
  ok: boolean;
  /** One entry per rule, in a fixed order: heating value, Wobbe index, CO2, inerts. */
  rules: Array<{ id: 'hhv' | 'wobbe' | 'co2' | 'inerts'; ok: boolean; value: number; min?: number; max: number }>;
}

/** Whether a gas meets a pipeline's quality rule. */
export function checkSpec(c: Composition, spec: QualitySpec = PIPELINE_SPEC): SpecCheck {
  const p = gasProperties(c);
  const inerts = c.nitrogen + c.co2;
  const rules: SpecCheck['rules'] = [
    { id: 'hhv', ok: p.hhv >= spec.hhvMin - 1e-9 && p.hhv <= spec.hhvMax + 1e-9, value: p.hhv, min: spec.hhvMin, max: spec.hhvMax },
    { id: 'wobbe', ok: p.wobbe >= spec.wobbeMin - 1e-9 && p.wobbe <= spec.wobbeMax + 1e-9, value: p.wobbe, min: spec.wobbeMin, max: spec.wobbeMax },
    { id: 'co2', ok: c.co2 <= spec.co2Max + 1e-9, value: c.co2, max: spec.co2Max },
    { id: 'inerts', ok: inerts <= spec.inertMax + 1e-9, value: inerts, max: spec.inertMax },
  ];
  return { ok: rules.every((r) => r.ok), rules };
}

// ---------------------------------------------------------------------------
// Energy units.

/** Btu in a therm, the unit on many household gas bills. */
export const BTU_PER_THERM = 100_000;
/** A dekatherm is ten therms: exactly one MMBtu. */
export const THERMS_PER_DTH = 10;
/** Gigajoules in one MMBtu. */
export const GJ_PER_MMBTU = 1.055056;
/** MMBtu in one megawatt-hour of energy. */
export const MMBTU_PER_MWH = 3.412142;
