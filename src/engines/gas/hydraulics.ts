// Gas flow through a pipe. Steady, isothermal flow with no change in elevation follows the
// general flow equation,
//
//   Q = 77.54 (Tb/Pb) √[(P1² − P2²) / (G · T · L · Z · f)] · D^2.5
//
// with Q in standard cubic feet per day, pressures in psia, temperatures in °R, length L in
// miles, inside diameter D in inches, gas specific gravity G, average compressibility Z and the
// Darcy friction factor f (from the Swamee–Jain form of the Colebrook equation). Throughput
// depends on the difference of the squared pressures, not the pressures themselves, and grows
// with the diameter to the power 2.5.

import { zFactor } from './eos';
import { PIPELINE_GAS, R_PSIA, SCF_PER_LBMOL, STD_PSIA, STD_TEMP_F, gasProperties, rankine, type Composition } from './properties';

/** Viscosity of natural gas at pipeline conditions, lb/(ft·s): about 0.012 centipoise. */
export const GAS_VISCOSITY = 8.0e-6;

/** Internal roughness of a pipe wall, inches. */
export const ROUGHNESS = { coated: 0.0002, newSteel: 0.0007, oldSteel: 0.002 } as const;

/** Darcy friction factor: 64/Re when laminar, Swamee–Jain's explicit Colebrook approximation when turbulent. */
export function frictionFactor(re: number, relRoughness: number): number {
  if (re < 2000) return 64 / Math.max(re, 1);
  const t = Math.log10(relRoughness / 3.7 + 5.74 / Math.pow(re, 0.9));
  return 0.25 / (t * t);
}

/** Reynolds number for a standard flow (scf/d) of a gas in a pipe of inside diameter D (inches). */
export function reynolds(qScfd: number, diameterIn: number, c: Composition = PIPELINE_GAS): number {
  const mw = gasProperties(c).mw;
  const massLbPerS = (qScfd / 86400) * (mw / SCF_PER_LBMOL);
  return (4 * massLbPerS) / (Math.PI * (diameterIn / 12) * GAS_VISCOSITY);
}

/** Average pressure along a pipe whose ends are at p1 and p2 (psia): (2/3)(P1 + P2 − P1·P2/(P1 + P2)). */
export function averagePressure(p1: number, p2: number): number {
  return (2 / 3) * (p1 + p2 - (p1 * p2) / (p1 + p2));
}

/** Gas velocity (ft/s) at a point where the pressure is p (psia). */
export function velocity(qScfd: number, pPsia: number, tempF: number, diameterIn: number, c: Composition = PIPELINE_GAS): number {
  const z = zFactor(pPsia, tempF, c);
  const actualCfPerS = (qScfd / 86400) * (STD_PSIA / pPsia) * (rankine(tempF) / rankine(STD_TEMP_F)) * z;
  const area = (Math.PI * (diameterIn / 12) ** 2) / 4;
  return actualCfPerS / area;
}

export interface Pipe {
  /** Inside diameter, inches. */
  diameterIn: number;
  lengthMi: number;
  /** Absolute wall roughness, inches. */
  roughnessIn: number;
  /** Flowing gas temperature, °F (gas in a buried pipe settles near the ground temperature). */
  tempF?: number;
  gas?: Composition;
}

export interface PipeFlow {
  /** Throughput, MMcf/d (million standard cubic feet a day). */
  qMMcfd: number;
  p1: number;
  p2: number;
  pAvg: number;
  zAvg: number;
  /** Darcy friction factor. */
  f: number;
  re: number;
  /** Gas velocity at the inlet and the outlet, ft/s. */
  vIn: number;
  vOut: number;
}

/** K in P1² − P2² = K · Q², for Q in scf/d, at a given friction factor and average Z. */
function kOf(pipe: Pipe, f: number, z: number): number {
  const g = gasProperties(pipe.gas ?? PIPELINE_GAS).sg;
  const t = rankine(pipe.tempF ?? STD_TEMP_F);
  const coef = 77.54 * (rankine(STD_TEMP_F) / STD_PSIA) * Math.pow(pipe.diameterIn, 2.5);
  return (g * t * pipe.lengthMi * z * f) / (coef * coef);
}

/** Throughput of a pipe with inlet pressure p1 and outlet pressure p2 (psia). Zero if p2 ≥ p1. */
export function pipeFlow(pipe: Pipe, p1: number, p2: number): PipeFlow {
  const gas = pipe.gas ?? PIPELINE_GAS;
  const tempF = pipe.tempF ?? STD_TEMP_F;
  const pAvg = averagePressure(p1, Math.max(0, p2));
  const zAvg = zFactor(pAvg, tempF, gas);
  if (!(p1 > p2)) return { qMMcfd: 0, p1, p2, pAvg, zAvg, f: 0, re: 0, vIn: 0, vOut: 0 };
  const rel = pipe.roughnessIn / pipe.diameterIn;
  let f = frictionFactor(1e7, rel);
  let q = 0;
  for (let i = 0; i < 30; i++) {
    q = Math.sqrt((p1 * p1 - p2 * p2) / kOf(pipe, f, zAvg));
    const next = frictionFactor(reynolds(q, pipe.diameterIn, gas), rel);
    if (Math.abs(next - f) < 1e-10) {
      f = next;
      break;
    }
    f = next;
  }
  q = Math.sqrt((p1 * p1 - p2 * p2) / kOf(pipe, f, zAvg));
  return {
    qMMcfd: q / 1e6,
    p1,
    p2,
    pAvg,
    zAvg,
    f,
    re: reynolds(q, pipe.diameterIn, gas),
    vIn: velocity(q, p1, tempF, pipe.diameterIn, gas),
    vOut: velocity(q, p2, tempF, pipe.diameterIn, gas),
  };
}

/** Outlet pressure (psia) for a throughput (MMcf/d) entering at p1; NaN if the pipe can't carry that much. */
export function outletPressure(pipe: Pipe, p1: number, qMMcfd: number): number {
  const gas = pipe.gas ?? PIPELINE_GAS;
  const tempF = pipe.tempF ?? STD_TEMP_F;
  const q = qMMcfd * 1e6;
  if (q <= 0) return p1;
  const f = frictionFactor(reynolds(q, pipe.diameterIn, gas), pipe.roughnessIn / pipe.diameterIn);
  let p2 = p1 * 0.8;
  for (let i = 0; i < 40; i++) {
    const z = zFactor(averagePressure(p1, Math.max(p2, 1)), tempF, gas);
    const sq = p1 * p1 - kOf(pipe, f, z) * q * q;
    if (sq <= 0) return NaN;
    const next = Math.sqrt(sq);
    if (Math.abs(next - p2) < 1e-6) return next;
    p2 = next;
  }
  return p2;
}

/** Inlet pressure (psia) needed to deliver a throughput (MMcf/d) at outlet pressure p2. */
export function inletPressure(pipe: Pipe, p2: number, qMMcfd: number): number {
  const gas = pipe.gas ?? PIPELINE_GAS;
  const tempF = pipe.tempF ?? STD_TEMP_F;
  const q = qMMcfd * 1e6;
  if (q <= 0) return p2;
  const f = frictionFactor(reynolds(q, pipe.diameterIn, gas), pipe.roughnessIn / pipe.diameterIn);
  let p1 = p2 * 1.2;
  for (let i = 0; i < 40; i++) {
    const z = zFactor(averagePressure(p1, p2), tempF, gas);
    const next = Math.sqrt(p2 * p2 + kOf(pipe, f, z) * q * q);
    if (Math.abs(next - p1) < 1e-6) return next;
    p1 = next;
  }
  return p1;
}

/** Pressure at `n + 1` evenly spaced points along a pipe from p1 to p2: P(x) = √(P1² − (P1² − P2²)·x/L). */
export function pressureProfile(p1: number, p2: number, n = 40): number[] {
  return Array.from({ length: n + 1 }, (_, i) => Math.sqrt(Math.max(0, p1 * p1 - (p1 * p1 - p2 * p2) * (i / n))));
}

/** Linepack: standard cubic feet held in a pipe whose ends are at p1 and p2 (psia). */
export function pipeInventory(pipe: Pipe, p1: number, p2: number): number {
  const gas = pipe.gas ?? PIPELINE_GAS;
  const tempF = pipe.tempF ?? STD_TEMP_F;
  const pAvg = averagePressure(p1, p2);
  const z = zFactor(pAvg, tempF, gas);
  const volumeFt3 = ((Math.PI * (pipe.diameterIn / 12) ** 2) / 4) * pipe.lengthMi * 5280;
  return (volumeFt3 * pAvg * SCF_PER_LBMOL) / (z * R_PSIA * rankine(tempF));
}
