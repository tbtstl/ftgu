// Liquid pipeline hydraulics (Lesson 4.1).
//
// Friction: the Darcy–Weisbach equation, Δp = f·(L/D)·ρv²/2, with the friction factor f from the
// Swamee–Jain approximation of the Colebrook equation in turbulent flow (64/Re when laminar).
// Elevation adds or removes ρ·g·Δz. Pump stations each raise the pressure back to the line's
// maximum allowable operating pressure. Pumping power is flow × pressure rise ÷ efficiency.

import { CAPITAL_CHARGE, PIPE_OM_PER_MILE, PUMP_EFFICIENCY, PUMP_POWER_PRICE, type Pipeline } from '../../model/oil/logistics';

export interface Fluid {
  name: string;
  /** Specific gravity. */
  sg: number;
  /** Kinematic viscosity at line temperature, cSt. */
  viscosity: number;
}

const BBL_M3 = 0.158987;
const IN_M = 0.0254;
const MILE_M = 1609.344;
const PA_PSI = 6894.757;
const FT_M = 0.3048;

export interface Hydraulics {
  /** Mean velocity, m/s. */
  velocity: number;
  reynolds: number;
  regime: 'laminar' | 'turbulent';
  friction: number;
  /** Friction loss per mile, psi. */
  psiPerMile: number;
  frictionPsi: number;
  /** Pressure needed to climb (negative when the line runs downhill), psi. */
  elevationPsi: number;
  /** Total pressure the pumps must supply, psi. */
  totalPsi: number;
  /** Pump stations needed, each adding up to (MAOP − suction) psi. */
  stationsNeeded: number;
  /** Hydraulic power the pumps deliver, MW, and electricity drawn. */
  pumpMW: number;
  electricMW: number;
  /** Electricity cost per barrel moved, $. */
  energyPerBbl: number;
}

export function frictionFactor(re: number, relRoughness: number): number {
  if (re < 1e-9) return 0;
  if (re < 2300) return 64 / re;
  const a = relRoughness / 3.7 + 5.74 / Math.pow(re, 0.9);
  return 0.25 / Math.pow(Math.log10(a), 2);
}

/** Pressure losses and pumping for `flowBpd` barrels a day of a fluid through a pipeline. */
export function hydraulics(p: Pipeline, fluid: Fluid, flowBpd: number): Hydraulics {
  const D = p.innerDiameterIn * IN_M;
  const area = (Math.PI * D * D) / 4;
  const q = (Math.max(0, flowBpd) * BBL_M3) / 86400;
  const v = q / area;
  const nu = fluid.viscosity * 1e-6;
  const re = (v * D) / nu;
  const f = frictionFactor(re, p.roughnessIn / p.innerDiameterIn);
  const rho = fluid.sg * 999;
  const paPerM = (f * rho * v * v) / (2 * D);
  const psiPerMile = (paPerM * MILE_M) / PA_PSI;
  const frictionPsi = psiPerMile * p.lengthMiles;
  const elevationPsi = (rho * 9.80665 * p.elevationFt * FT_M) / PA_PSI;
  const totalPsi = Math.max(0, frictionPsi + elevationPsi + p.suction);
  const boost = p.maop - p.suction;
  const stationsNeeded = flowBpd > 0 ? Math.max(1, Math.ceil(totalPsi / boost - 1e-9)) : 0;
  const pumpW = q * totalPsi * PA_PSI;
  const electricMW = pumpW / PUMP_EFFICIENCY / 1e6;
  const energyPerBbl = flowBpd > 0 ? (electricMW * 24 * PUMP_POWER_PRICE) / flowBpd : 0;
  return {
    velocity: v,
    reynolds: re,
    regime: re < 2300 ? 'laminar' : 'turbulent',
    friction: f,
    psiPerMile,
    frictionPsi,
    elevationPsi,
    totalPsi,
    stationsNeeded,
    pumpMW: pumpW / 1e6,
    electricMW,
    energyPerBbl,
  };
}

/** The most a line can carry (b/d) with a number of pump stations, each boosting to MAOP. */
export function maxFlow(p: Pipeline, fluid: Fluid, stations = p.stations): number {
  const head = stations * (p.maop - p.suction);
  let lo = 0;
  let hi = 2e6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (hydraulics(p, fluid, mid).totalPsi <= head) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Pressure along the line (psi) at `points` places, with stations spaced evenly, for a flow. */
export function pressureProfile(p: Pipeline, fluid: Fluid, flowBpd: number, stations = p.stations, points = 101): Array<{ mile: number; psi: number }> {
  const h = hydraulics(p, fluid, flowBpd);
  const perMile = (h.frictionPsi + h.elevationPsi) / p.lengthMiles;
  const spacing = p.lengthMiles / Math.max(1, stations);
  const out: Array<{ mile: number; psi: number }> = [];
  for (let i = 0; i < points; i++) {
    const mile = (i / (points - 1)) * p.lengthMiles;
    const k = Math.min(stations - 1, Math.floor(mile / spacing + 1e-9));
    const since = mile - k * spacing;
    out.push({ mile, psi: p.maop - perMile * since });
  }
  return out;
}

export interface TariffBreakdown {
  capital: number;
  operations: number;
  energy: number;
  total: number;
}

/** Cost per barrel of running the line at a throughput: capital charge, O&M, and pumping energy. */
export function costPerBarrel(p: Pipeline, fluid: Fluid, flowBpd: number): TariffBreakdown {
  const bblPerYear = Math.max(1, flowBpd) * 365;
  const capital = (p.capital * CAPITAL_CHARGE) / bblPerYear;
  const operations = (PIPE_OM_PER_MILE * p.lengthMiles) / bblPerYear;
  const energy = hydraulics(p, fluid, flowBpd).energyPerBbl;
  return { capital, operations, energy, total: capital + operations + energy };
}
