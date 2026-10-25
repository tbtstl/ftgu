// A thermal circulation in two side-by-side columns of air, one over land and one over the sea.
// Heating the lowest layer over the land doesn't change the weight of the air above the ground,
// so it doesn't change the surface pressure at first; the column just expands upward, and aloft,
// at any fixed height, the pressure over the land is now higher than over the sea. Air spreading
// toward the sea aloft then moves weight from one column to the other, and the surface pressure
// falls over the land and rises over the sea: the push behind a sea breeze, a land breeze at
// night, and a thermal low over hot ground. Hydrostatic columns; °C, meters and hPa.

import { G, K0, RD } from './thermo';

/** The sketch's fixed settings. */
export const SEA_BREEZE = {
  /** Air temperature just above the sea, °C. */
  seaC: 20,
  /** How fast both columns cool with height, °C per km (the standard atmosphere's rate). */
  lapse: 6.5,
  /** Depth of the layer the land heats (or, at night, cools), m. */
  layerM: 1000,
  /** Surface pressure on both sides before anything moves, hPa. */
  p0: 1013,
};

export type SeaBreezeStage = 'heated' | 'moving';

export interface SeaBreeze {
  /** How much warmer the lowest layer is over the land than over the sea, °C. */
  deltaC: number;
  stage: SeaBreezeStage;
  /** Surface pressure over the land, hPa. */
  landSurface: number;
  /** Surface pressure over the sea, hPa. */
  seaSurface: number;
  /** Height at which the pressures over the land and the sea are equal, m (0 before any air has moved). */
  levelM: number;
  /** Pressure over the land at a height, hPa. */
  landAt: (zM: number) => number;
  /** Pressure over the sea at a height, hPa. */
  seaAt: (zM: number) => number;
  /** Height of a pressure level over the land, m (negative if it lies below the ground). */
  landHeightOf: (pHpa: number) => number;
  /** Height of a pressure level over the sea, m. */
  seaHeightOf: (pHpa: number) => number;
}

/** Temperature over the sea at a height, °C. */
export function seaTempAt(zM: number): number {
  return SEA_BREEZE.seaC - (SEA_BREEZE.lapse * zM) / 1000;
}

/** Temperature over the land at a height, °C: the sea's, plus `deltaC` within the heated layer. */
export function landTempAt(zM: number, deltaC: number): number {
  return seaTempAt(zM) + (zM < SEA_BREEZE.layerM ? deltaC : 0);
}

const GAMMA = SEA_BREEZE.lapse / 1000; // K per m
const C = G / (RD * GAMMA);

/** ln(p(0)/p(z)) for a layer whose temperature falls at the lapse rate from `t0K` at its bottom, over a depth `dz`. */
function drop(t0K: number, dz: number): number {
  return C * Math.log(t0K / (t0K - GAMMA * dz));
}

/** ln(ps/p(z)) over the sea: the integral of g/(R·T) from the ground to z (z may be negative). */
function seaDrop(zM: number): number {
  return drop(SEA_BREEZE.seaC + K0, zM);
}

/** ln(ps/p(z)) over the land. */
function landDrop(zM: number, deltaC: number): number {
  const H = SEA_BREEZE.layerM;
  const t0 = SEA_BREEZE.seaC + deltaC + K0;
  if (zM <= H) return drop(t0, zM);
  return drop(t0, H) + drop(seaTempAt(H) + K0, zM - H);
}

/** Invert a column's pressure profile by bisection. */
function heightOf(pHpa: number, ps: number, dropAt: (zM: number) => number): number {
  const target = Math.log(ps / pHpa);
  let lo = -2000;
  let hi = 12000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dropAt(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The two columns with the land `deltaC` warmer than the sea through the lowest kilometer.
 * 'heated': no air has moved, so both columns hold the same air and the surface pressures are
 * equal. 'moving': air has spread from the higher pressure aloft toward the lower, until the
 * pressures are level halfway up the heated layer; the total amount of air is unchanged.
 */
export function seaBreeze(deltaC: number, stage: SeaBreezeStage): SeaBreeze {
  const { p0, layerM } = SEA_BREEZE;
  let landSurface = p0;
  let seaSurface = p0;
  const levelM = stage === 'moving' ? layerM / 2 : 0;
  if (stage === 'moving') {
    // Equal pressure at levelM: ps_land·e^(−I_land) = ps_sea·e^(−I_sea), with ps_land + ps_sea = 2·p0.
    const r = Math.exp(seaDrop(levelM) - landDrop(levelM, deltaC));
    landSurface = (2 * p0) / (1 + r);
    seaSurface = landSurface * r;
  }
  const landAt = (zM: number) => landSurface * Math.exp(-landDrop(zM, deltaC));
  const seaAt = (zM: number) => seaSurface * Math.exp(-seaDrop(zM));
  return {
    deltaC,
    stage,
    landSurface,
    seaSurface,
    levelM,
    landAt,
    seaAt,
    landHeightOf: (p) => heightOf(p, landSurface, (z) => landDrop(z, deltaC)),
    seaHeightOf: (p) => heightOf(p, seaSurface, seaDrop),
  };
}
