// How a real gas departs from the ideal-gas law. The Peng–Robinson equation of state, with
// van der Waals mixing rules and no binary interaction terms, gives pressure from molar volume and
// temperature; the compressibility factor Z = PV/(nRT) measures the departure (Z = 1 for an ideal
// gas). At pipeline pressures natural gas has Z below 1: it packs into less space than the ideal
// law predicts.

import { COMPONENT, COMPONENTS, PIPELINE_GAS, R_PSIA, SCF_PER_LBMOL, gasProperties, rankine, type Composition } from './properties';

interface Mix {
  /** a(T) and b of the mixture, in psia·ft⁶/lbmol² and ft³/lbmol. */
  a: number;
  b: number;
}

const mixCache = new Map<string, { b: number; parts: Array<{ x: number; ac: number; kappa: number; tc: number }> }>();

function prepare(c: Composition) {
  const key = COMPONENTS.map((k) => c[k].toFixed(6)).join(',');
  let m = mixCache.get(key);
  if (!m) {
    let b = 0;
    const parts = COMPONENTS.filter((k) => c[k] > 0).map((k) => {
      const d = COMPONENT[k];
      const ac = (0.45724 * R_PSIA * R_PSIA * d.tc * d.tc) / d.pc;
      b += (c[k] * 0.0778 * R_PSIA * d.tc) / d.pc;
      const kappa = 0.37464 + 1.54226 * d.omega - 0.26992 * d.omega * d.omega;
      return { x: c[k], ac, kappa, tc: d.tc };
    });
    m = { b, parts };
    if (mixCache.size > 200) mixCache.clear();
    mixCache.set(key, m);
  }
  return m;
}

function mixAt(c: Composition, tR: number): Mix {
  const m = prepare(c);
  const ai = m.parts.map((p) => {
    const s = 1 + p.kappa * (1 - Math.sqrt(tR / p.tc));
    return { x: p.x, a: p.ac * s * s };
  });
  let a = 0;
  for (const i of ai) for (const j of ai) a += i.x * j.x * Math.sqrt(i.a * j.a);
  return { a, b: m.b };
}

/** Pressure (psia) of a gas at molar volume v (ft³/lb-mol) and temperature (°F), Peng–Robinson. */
export function prPressure(vMolar: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  const t = rankine(tempF);
  const { a, b } = mixAt(c, t);
  return (R_PSIA * t) / (vMolar - b) - a / (vMolar * vMolar + 2 * b * vMolar - b * b);
}

/** Compressibility factor Z at a pressure (psia) and temperature (°F): the gas-phase root of the Peng–Robinson cubic. */
export function zFactor(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  const t = rankine(tempF);
  const { a, b } = mixAt(c, t);
  const A = (a * pPsia) / (R_PSIA * R_PSIA * t * t);
  const B = (b * pPsia) / (R_PSIA * t);
  // Z³ − (1 − B) Z² + (A − 3B² − 2B) Z − (AB − B² − B³) = 0. Newton from the ideal-gas side finds the vapor root.
  const c2 = -(1 - B);
  const c1 = A - 3 * B * B - 2 * B;
  const c0 = -(A * B - B * B - B * B * B);
  let z = 1;
  for (let i = 0; i < 60; i++) {
    const f = ((z + c2) * z + c1) * z + c0;
    const df = (3 * z + 2 * c2) * z + c1;
    const step = f / df;
    z -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return z;
}

export interface PistonState {
  /** Pressure, psia. */
  pressure: number;
  /** What an ideal gas would exert in the same volume, psia. */
  idealPressure: number;
  /** Compressibility factor PV/(nRT). */
  z: number;
  /** Density, lb/ft³. */
  density: number;
  /** Standard cubic feet in each actual cubic foot: how many times the gas is compressed relative to standard conditions. */
  scfPerCf: number;
}

/**
 * A closed cylinder holding `scf` standard cubic feet of gas, squeezed into `volumeFt3` at `tempF`.
 * Returns the real (Peng–Robinson) and ideal pressures.
 */
export function piston(scf: number, volumeFt3: number, tempF: number, c: Composition = PIPELINE_GAS): PistonState {
  const n = scf / SCF_PER_LBMOL;
  const v = volumeFt3 / n;
  const pressure = prPressure(v, tempF, c);
  const idealPressure = (n * R_PSIA * rankine(tempF)) / volumeFt3;
  const mw = gasProperties(c).mw;
  return { pressure, idealPressure, z: pressure / idealPressure, density: (n * mw) / volumeFt3, scfPerCf: scf / volumeFt3 };
}

/** Standard cubic feet held in one actual cubic foot at a pressure (psia) and temperature (°F). */
export function scfPerCubicFoot(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  const z = zFactor(pPsia, tempF, c);
  return (pPsia * SCF_PER_LBMOL) / (z * R_PSIA * rankine(tempF));
}

/** Gas density (lb/ft³) at a pressure (psia) and temperature (°F). */
export function density(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  const z = zFactor(pPsia, tempF, c);
  return (pPsia * gasProperties(c).mw) / (z * R_PSIA * rankine(tempF));
}
