// Gas in rock: how much a reservoir holds, how fast it can flow to a well, and how the pressure
// falls as it's produced. Field units throughout: acres, feet, psia, °F, millidarcies (md),
// centipoise (cp), and gas volumes in standard cubic feet (60 °F, 14.73 psia).
//
// - Gas in place (volumetric): G = 43,560 · A · h · φ · (1 − Sw) / Bg.
// - Flow to a vertical well once the whole drainage area feels it (pseudo-steady state):
//   q [Mscf/d] = k·h·(P̄² − Pwf²) / (1422 · T · μ · Z · [ln(re/rw) − 0.75 + s]).
// - Material balance for a closed (volumetric) gas reservoir: P/Z falls in a straight line with
//   the gas produced, reaching zero when all of it is gone: P/Z = (Pi/Zi)(1 − Gp/G).

import { zFactor } from './eos';
import { PIPELINE_GAS, STD_PSIA, STD_TEMP_F, gasProperties, rankine, type Composition } from './properties';

/** Square feet in an acre. */
export const SQFT_PER_ACRE = 43_560;
/** Radius of a typical vertical wellbore (8½-inch hole), ft. */
export const WELLBORE_RADIUS_FT = 0.354;
/** Days in an average month. */
export const DAYS_PER_MONTH = 365.25 / 12;

/** Gas formation volume factor: reservoir cubic feet occupied by one standard cubic foot. */
export function gasFVF(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  return (STD_PSIA / rankine(STD_TEMP_F)) * ((zFactor(pPsia, tempF, c) * rankine(tempF)) / pPsia);
}

/**
 * Gas viscosity, centipoise, by the Lee–Gonzalez–Eakin correlation: about 0.012 cp at low pressure,
 * rising to 0.02–0.03 cp at reservoir pressures.
 */
export function gasViscosity(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  const t = rankine(tempF);
  const m = gasProperties(c).mw;
  const z = zFactor(pPsia, tempF, c);
  const rho = (pPsia * m) / (z * 10.7316 * t) / 62.428; // g/cm³
  const k = ((9.4 + 0.02 * m) * Math.pow(t, 1.5)) / (209 + 19 * m + t);
  const x = 3.5 + 986 / t + 0.01 * m;
  const y = 2.4 - 0.2 * x;
  return 1e-4 * k * Math.exp(x * Math.pow(rho, y));
}

export interface Rock {
  /** Drainage area, acres (640 acres is a square mile). */
  areaAcres: number;
  /** Net thickness of the gas-bearing rock, ft. */
  thicknessFt: number;
  /** Share of the rock's volume that is pore space, 0–1. */
  porosity: number;
  /** Share of the pore space filled with water, 0–1. */
  waterSat: number;
  /** Permeability, millidarcies. */
  permMd: number;
  /** Reservoir temperature, °F. */
  tempF: number;
}

/** Standard cubic feet of gas in place at reservoir pressure p (psia). */
export function gasInPlace(rock: Rock, pPsia: number, c: Composition = PIPELINE_GAS): number {
  const poreGas = SQFT_PER_ACRE * rock.areaAcres * rock.thicknessFt * rock.porosity * (1 - rock.waterSat);
  return poreGas / gasFVF(pPsia, rock.tempF, c);
}

/** Radius of a circle with the drainage area, ft. */
export function drainageRadius(areaAcres: number): number {
  return Math.sqrt((areaAcres * SQFT_PER_ACRE) / Math.PI);
}

/**
 * Deliverability coefficient C (Mscf/d per psi²) of a vertical well: q = C·(P̄² − Pwf²), with the gas
 * properties taken at the average of the reservoir and flowing pressures.
 */
export function wellCoefficient(rock: Rock, pAvg: number, skin = 0, c: Composition = PIPELINE_GAS): number {
  const re = drainageRadius(rock.areaAcres);
  const mu = gasViscosity(pAvg, rock.tempF, c);
  const z = zFactor(pAvg, rock.tempF, c);
  const geom = Math.log(re / WELLBORE_RADIUS_FT) - 0.75 + skin;
  return (rock.permMd * rock.thicknessFt) / (1422 * rankine(rock.tempF) * mu * z * Math.max(geom, 0.5));
}

/** Rate (MMcf/d) a vertical well flows at reservoir pressure pR with its bottom held at pwf (psia). */
export function wellRate(rock: Rock, pR: number, pwf: number, skin = 0, c: Composition = PIPELINE_GAS): number {
  if (pR <= pwf) return 0;
  const coef = wellCoefficient(rock, (pR + pwf) / 2, skin, c);
  return (coef * (pR * pR - pwf * pwf)) / 1000;
}

// ---------------------------------------------------------------------------
// A horizontal well with fracture stages. Gas flows straight toward the flat faces of the fractures
// (linear flow) instead of converging on a hole, so Darcy's law takes its linear form,
//   q [Mscf/d] = k·A·(P̄² − Pwf²) / (8,935 · T · μ · Z · d),
// where A is the rock face and d the distance the gas crosses. 8,935 is 2π × 1,422: the radial form's
// constant already contains the circle's 2π. Once the flow between neighboring fractures has settled
// (pseudo-steady state), d is a third of the distance from the midpoint between two fractures to a face.

/** The constant of Darcy's law for gas in linear flow, in the field units of `wellCoefficient`. */
export const LINEAR_FLOW_CONSTANT = 2 * Math.PI * 1422;

export interface FracturedWell {
  /** Fracture stages along the horizontal section, one fracture each. */
  stages: number;
  /** Distance between neighboring fractures along the well, ft. */
  stageSpacingFt: number;
  /** How far each fracture reaches into the rock on either side of the well, ft. */
  halfLengthFt: number;
}

/** Rock face the gas flows into: both faces of every fracture, tip to tip, through the layer's full thickness, ft². */
export function fractureFaceArea(rock: Rock, w: FracturedWell): number {
  return w.stages * 2 * (2 * w.halfLengthFt) * rock.thicknessFt;
}

/** Effective distance (ft) gas crosses to a fracture face once the flow between fractures has settled: a third of half the spacing. */
export function fractureFlowDistance(w: FracturedWell): number {
  return w.stageSpacingFt / 2 / 3;
}

/**
 * Rate (MMcf/d) a fractured horizontal well flows at reservoir pressure pR with its bottom held at pwf
 * (psia), once the flow in the rock between its fractures has settled, with the gas properties taken at
 * the average of the two pressures (as in `wellRate`). The rock beyond the fracture tips is ignored.
 */
export function fracturedWellRate(rock: Rock, pR: number, pwf: number, w: FracturedWell, c: Composition = PIPELINE_GAS): number {
  if (pR <= pwf || w.stages <= 0) return 0;
  const pAvg = (pR + pwf) / 2;
  const mu = gasViscosity(pAvg, rock.tempF, c);
  const z = zFactor(pAvg, rock.tempF, c);
  const coef = (rock.permMd * fractureFaceArea(rock, w)) / (LINEAR_FLOW_CONSTANT * rankine(rock.tempF) * mu * z * fractureFlowDistance(w));
  return (coef * (pR * pR - pwf * pwf)) / 1000;
}

/** P/Z at a pressure and temperature. */
export function pOverZ(pPsia: number, tempF: number, c: Composition = PIPELINE_GAS): number {
  return pPsia / zFactor(pPsia, tempF, c);
}

/** The pressure (psia) at which P/Z equals a target, at a temperature: inverts pOverZ (secant from a guess, bisection as a fallback). */
export function pressureFromPz(pz: number, tempF: number, c: Composition = PIPELINE_GAS, guess?: number): number {
  if (pz <= 0) return 0;
  let a = guess ?? pz;
  let b = a * 1.01 + 1;
  let fa = pOverZ(a, tempF, c) - pz;
  let fb = pOverZ(b, tempF, c) - pz;
  for (let i = 0; i < 30 && Math.abs(fb) > 1e-7 * pz; i++) {
    if (fb === fa) break;
    const next = b - (fb * (b - a)) / (fb - fa);
    if (!(next > 0) || !Number.isFinite(next)) break;
    a = b;
    fa = fb;
    b = next;
    fb = pOverZ(b, tempF, c) - pz;
  }
  if (Math.abs(fb) <= 1e-6 * pz) return b;
  let lo = 0.1;
  let hi = Math.max(20000, pz * 2);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pOverZ(mid, tempF, c) < pz) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TankWell {
  rock: Rock;
  /** Initial reservoir pressure, psia. */
  piPsia: number;
  /** Flowing bottomhole pressure the well is held at, psia. */
  pwfPsia: number;
  /** Most the surface facilities (or the choke) let the well flow, MMcf/d. */
  rateCapMMcfd: number;
  /** Mechanical skin; negative for a stimulated (fractured) well. */
  skin?: number;
  /** Rate below which the well is shut in for good, MMcf/d. */
  abandonMMcfd?: number;
}

export interface TankMonth {
  /** Months since first production (1 = the first month). */
  month: number;
  /** Average daily rate during the month, MMcf/d. */
  rate: number;
  /** Average reservoir pressure at the month's end, psia. */
  pressure: number;
  /** P/Z at the month's end. */
  pz: number;
  /** Cumulative production at the month's end, Bcf. */
  cumBcf: number;
}

export interface TankResult {
  /** Gas initially in place, Bcf. */
  gipBcf: number;
  months: TankMonth[];
  /** Cumulative production when the well is abandoned (or the run ends), Bcf. */
  eurBcf: number;
  /** Share of the gas in place recovered. */
  recovery: number;
  /** Month the well stops flowing at the cap, or 0 if it never reaches it. */
  plateauMonths: number;
  /** Month of abandonment (or the run's length). */
  lifeMonths: number;
}

/**
 * A well draining a closed tank of gas, month by month: the rate follows the deliverability equation
 * (capped by the facilities), and the reservoir pressure follows material balance.
 */
export function simulateTank(w: TankWell, months = 360, c: Composition = PIPELINE_GAS): TankResult {
  const t = w.rock.tempF;
  const G = gasInPlace(w.rock, w.piPsia, c);
  const pzi = pOverZ(w.piPsia, t, c);
  const abandon = w.abandonMMcfd ?? 0.1;
  const out: TankMonth[] = [];
  let gp = 0;
  let p = w.piPsia;
  let plateau = 0;
  let life = months;
  const steps = 4; // sub-steps per month for accuracy
  for (let m = 1; m <= months; m++) {
    let produced = 0;
    for (let s = 0; s < steps; s++) {
      const q = Math.min(w.rateCapMMcfd, wellRate(w.rock, p, w.pwfPsia, w.skin ?? 0, c));
      const dq = q * 1e6 * (DAYS_PER_MONTH / steps);
      produced += dq;
      gp = Math.min(G, gp + dq);
      p = pressureFromPz(pzi * (1 - gp / G), t, c, p);
    }
    const rate = produced / 1e6 / DAYS_PER_MONTH;
    if (rate >= w.rateCapMMcfd - 1e-6) plateau = m;
    out.push({ month: m, rate, pressure: p, pz: pOverZ(p, t, c), cumBcf: gp / 1e9 });
    if (rate < abandon) {
      life = m;
      break;
    }
  }
  return { gipBcf: G / 1e9, months: out, eurBcf: gp / 1e9, recovery: gp / G, plateauMonths: plateau, lifeMonths: life };
}
