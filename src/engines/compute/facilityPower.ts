// Getting power from the grid to the chips. The utility delivers high voltage to the site's
// substation; transformers step it down; uninterruptible power supplies (UPS) ride through grid
// faults until the generators start; power distribution units feed the racks; inside each server
// a power supply converts AC to DC and voltage regulators feed the chips at under a volt. Every
// stage loses a little, and redundancy means running each piece of equipment at part load, where
// it loses proportionally more.

export type Redundancy = 'N' | 'N+1' | '2N';
export type UpsMode = 'double conversion' | 'eco';

export interface PowerChainConfig {
  /** IT load at the racks, MW (what PUE calls IT power). */
  itMW: number;
  redundancy: Redundancy;
  upsMode: UpsMode;
  /** Rating of one UPS module, MW. */
  upsModuleMW: number;
  /** Server power-supply efficiency (AC in to DC out). */
  psuEfficiency: number;
  /** On-board voltage-regulator efficiency (12 V or 48 V down to the chip's ~0.8 V). */
  vrmEfficiency: number;
}

export const POWER_DEFAULTS: PowerChainConfig = {
  itMW: 20,
  redundancy: 'N+1',
  upsMode: 'double conversion',
  upsModuleMW: 2.5,
  psuEfficiency: 0.94,
  vrmEfficiency: 0.9,
};

/**
 * Efficiency of a piece of power equipment at a load fraction x of its rating, from its losses: a
 * fixed part (no-load, like a transformer's core), a part proportional to load, and a part growing
 * with the square of load (I²R in its conductors).
 */
export function partLoadEfficiency(x: number, fixed: number, proportional: number, quadratic: number): number {
  if (x <= 0) return 0;
  return x / (x + fixed + proportional * x + quadratic * x * x);
}

/** A double-conversion UPS: ≈96% near full load, falling at light load. */
export function upsEfficiency(load: number, mode: UpsMode): number {
  return mode === 'eco' ? partLoadEfficiency(load, 0.002, 0.006, 0.002) : partLoadEfficiency(load, 0.01, 0.02, 0.01);
}

/** A large power transformer: core loss 0.1% of rating, copper loss 0.4% at full load. */
export function transformerEfficiency(load: number): number {
  return partLoadEfficiency(load, 0.001, 0, 0.004);
}

export interface UpsPlan {
  modules: number;
  installedMW: number;
  /** Load on each module as a share of its rating. */
  loadFraction: number;
}

/** UPS modules for an IT load: N carries it exactly, N+1 adds a spare, 2N builds two complete systems sharing the load. */
export function upsPlan(itMW: number, moduleMW: number, r: Redundancy): UpsPlan {
  const n = Math.max(1, Math.ceil(itMW / moduleMW - 1e-9));
  const modules = r === 'N' ? n : r === 'N+1' ? n + 1 : 2 * n;
  const installedMW = modules * moduleMW;
  return { modules, installedMW, loadFraction: itMW / installedMW };
}

export interface Stage {
  id: string;
  name: string;
  /** Power entering the stage, MW. */
  inMW: number;
  /** Power leaving it, MW. */
  outMW: number;
  lossMW: number;
  efficiency: number;
}

export interface PowerChain {
  stages: Stage[];
  /** Power drawn from the grid for the IT load and its electrical losses (cooling not included), MW. */
  gridMW: number;
  /** Power reaching the chips' silicon, MW. */
  chipMW: number;
  /** Electrical losses outside the IT equipment (count toward PUE), MW. */
  facilityLossMW: number;
  /** Losses inside the servers (counted as IT power), MW. */
  serverLossMW: number;
  ups: UpsPlan;
  /** The electrical part of PUE: (IT + facility electrical losses) / IT. */
  electricalPue: number;
}

/**
 * The chain from grid to chip for a given IT load. Facility stages (substation transformer, UPS,
 * distribution transformer) are worked backward from the IT load; server stages (power supply,
 * voltage regulators) forward from it.
 */
export function powerChain(c: PowerChainConfig): PowerChain {
  const ups = upsPlan(c.itMW, c.upsModuleMW, c.redundancy);
  // Distribution transformers (480 → 415 V) sized like the UPS; the substation transformer has one spare in N+1 or a full twin in 2N.
  const pduEff = transformerEfficiency(Math.min(1, ups.loadFraction));
  const upsEff = upsEfficiency(Math.min(1, ups.loadFraction), c.upsMode);
  const subLoad = c.redundancy === '2N' ? 0.5 * 0.8 : c.redundancy === 'N+1' ? 0.67 * 0.8 : 0.8;
  const subEff = transformerEfficiency(subLoad);
  const pduIn = c.itMW / pduEff;
  const upsIn = pduIn / upsEff;
  const subIn = upsIn / subEff;
  const psuOut = c.itMW * c.psuEfficiency;
  const chip = psuOut * c.vrmEfficiency;
  const stage = (id: string, name: string, inMW: number, outMW: number): Stage => ({ id, name, inMW, outMW, lossMW: inMW - outMW, efficiency: inMW > 0 ? outMW / inMW : 0 });
  const stages = [
    stage('substation', 'Substation transformer', subIn, upsIn),
    stage('ups', 'UPS', upsIn, pduIn),
    stage('pdu', 'Distribution transformer', pduIn, c.itMW),
    stage('psu', 'Server power supply', c.itMW, psuOut),
    stage('vrm', 'Voltage regulators', psuOut, chip),
  ];
  const facilityLossMW = subIn - c.itMW;
  return { stages, gridMW: subIn, chipMW: chip, facilityLossMW, serverLossMW: c.itMW - chip, ups, electricalPue: subIn / c.itMW };
}

/** Diesel generators to carry the whole site (IT plus cooling) through a grid outage, N+1. */
export function generatorPlan(siteMW: number, unitMW = 3): { units: number; installedMW: number } {
  const units = Math.ceil(siteMW / unitMW - 1e-9) + 1;
  return { units, installedMW: units * unitMW };
}
