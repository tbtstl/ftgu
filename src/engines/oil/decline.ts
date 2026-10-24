// Production decline (Lesson 2.4).
//
// Arps decline curves, the industry's standard way to forecast a well:
//   q(t) = qi / (1 + b·Di·t)^(1/b)   (hyperbolic; b = 0 is exponential, b = 1 harmonic)
// Declines are quoted as an effective annual rate: the share of the rate lost over a year.
//
// And a simple "tank" model of a whole conventional field — Northfield — through primary
// depletion, artificial lift and waterflooding, with water cut from Corey relative permeabilities.
// It's a teaching model: one average pressure, one average saturation, annual (monthly) steps.

import { FIELDS, gradient } from '../../model/oil/fields';
import { trapVolume } from './reservoir';

// ---------------------------------------------------------------------------
// Arps.

/** Nominal initial decline (per year) from an effective first-year decline (0–1) and b. */
export function nominalFromEffective(de: number, b: number): number {
  const d = Math.min(0.999, Math.max(0, de));
  return b < 1e-6 ? -Math.log(1 - d) : (Math.pow(1 - d, -b) - 1) / b;
}

export function arpsRate(qi: number, di: number, b: number, tYears: number): number {
  if (b < 1e-6) return qi * Math.exp(-di * tYears);
  return qi * Math.pow(1 + b * di * tYears, -1 / b);
}

/** Cumulative production over t years, in barrels, for rates in barrels per day. */
export function arpsCum(qi: number, di: number, b: number, tYears: number): number {
  const q = arpsRate(qi, di, b, tYears);
  const qiY = qi * 365.25;
  const qY = q * 365.25;
  if (di <= 0) return qiY * tYears;
  if (b < 1e-6) return (qiY - qY) / di;
  if (Math.abs(b - 1) < 1e-6) return (qiY / di) * Math.log(qiY / qY);
  return (Math.pow(qiY, b) / ((1 - b) * di)) * (Math.pow(qiY, 1 - b) - Math.pow(qY, 1 - b));
}

/**
 * Modified hyperbolic: the hyperbola's decline rate falls over time, D(t) = Di / (1 + b·Di·t);
 * once it reaches a terminal decline Dmin, the curve switches to exponential at Dmin. Without the
 * switch a curve with b ≥ 1 would produce forever.
 */
export function modifiedRate(qi: number, di: number, b: number, dmin: number, t: number): number {
  if (b < 1e-6 || di <= dmin) return qi * Math.exp(-Math.max(di, dmin) * t);
  const tSwitch = (di / dmin - 1) / (b * di);
  if (t <= tSwitch) return arpsRate(qi, di, b, t);
  return arpsRate(qi, di, b, tSwitch) * Math.exp(-dmin * (t - tSwitch));
}

/** Cumulative of the modified hyperbolic over t years, barrels (numerical, monthly steps). */
export function modifiedCum(qi: number, di: number, b: number, dmin: number, t: number): number {
  const n = Math.max(1, Math.round(t * 48));
  const dt = t / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += modifiedRate(qi, di, b, dmin, (i + 0.5) * dt) * dt * 365.25;
  return s;
}

/** Root-mean-square error of log rates between a curve and observed points (fractional, ~percent/100). */
export function logRmsError(points: Array<{ t: number; q: number }>, curve: (t: number) => number): number {
  if (!points.length) return 0;
  const s = points.reduce((a, p) => a + Math.log(Math.max(1e-9, curve(p.t)) / p.q) ** 2, 0);
  return Math.sqrt(s / points.length);
}

// ---------------------------------------------------------------------------
// Northfield as a tank.

export type Drive = 'flowing' | 'pumps' | 'waterflood';

export interface FieldParams {
  drive: Drive;
  /** Year the waterflood starts (waterflood drive only). */
  floodYear: number;
  wells: number;
  /** Oil price, $/bbl, for the economic limit. */
  oilPrice: number;
  years?: number;
}

export const NORTHFIELD_MODEL = {
  /** Oil in place, STB: the trap filled to the 8,000 ft contact. */
  ooip: trapVolume(FIELDS.northfield, 8000).oil,
  /** Liquid productivity index per well, STB/day per psi. */
  pi: 1.75,
  initialPressure: FIELDS.northfield.initialPressure,
  /** Pressure reached when primary depletion is exhausted, psi (as low as pumps can draw a well). */
  abandonPressure: 500,
  /** Most oil primary depletion can recover, share of oil in place. */
  primaryMax: 0.18,
  /** Shape of the pressure decline: steep while the oil is undersaturated, gentler once gas comes out. */
  pressureExponent: 1.4,
  /** Pressure the waterflood holds the reservoir at, psi, and how fast it gets there (years). */
  floodPressure: 3300,
  floodRamp: 1.5,
  /** Most a waterflood can recover (moveable oil × sweep), share of oil in place. */
  floodMax: 0.5,
  /** Share of the oil's displacement done by water under primary depletion (a weak aquifer). */
  aquiferShare: 0.3,
  /** Bottomhole pressure with pumps, psi. */
  pumpPwf: 500,
  /** Largest drawdown the wells are produced at, psi (more would pull in sand and water). */
  maxDrawdown: 1500,
  /** Wellhead pressure the flow must overcome, psi. */
  wellhead: 100,
  oilSG: FIELDS.northfield.reservoirOilSG,
  brineSG: 1.07,
  /** Oil and water viscosity, cP. */
  muOil: FIELDS.northfield.oilViscosity,
  muWater: 0.5,
  /** Operating costs: per well per year, per barrel of liquid lifted, per barrel of water handled. */
  wellCostPerYear: 400000,
  liftPerBbl: 2.0,
  waterPerBbl: 1.0,
  /** Water the surface facilities can handle, STB/day. */
  waterCapacity: 200000,
};

/** Water cut from a normalized water saturation (0 at connate water, 1 at residual oil), Corey exponents 2 and 3. */
export function waterCut(swn: number, muOil = NORTHFIELD_MODEL.muOil, muWater = NORTHFIELD_MODEL.muWater): number {
  const s = Math.max(0, Math.min(1, swn));
  const kro = (1 - s) ** 2;
  const krw = 0.3 * s ** 3;
  if (krw <= 0) return 0;
  return 1 / (1 + (kro * muWater) / (krw * muOil));
}

export interface FieldYear {
  year: number;
  pressure: number;
  /** Average oil and water rates over the year, STB/day. */
  oil: number;
  water: number;
  waterCut: number;
  /** Cumulative oil, STB, and recovery factor. */
  cumOil: number;
  recovery: number;
  /** Net cash from operations over the year, $ (before any capital). */
  cash: number;
  producing: boolean;
}

/** Bottomhole pressure a well needs to lift its own fluid to the surface, psi. */
export function flowingPwf(fw: number): number {
  const m = NORTHFIELD_MODEL;
  const sg = m.oilSG * (1 - fw) + m.brineSG * fw;
  return m.wellhead + gradient(sg) * FIELDS.northfield.crestDepth;
}

export function simulateField(p: FieldParams): FieldYear[] {
  const m = NORTHFIELD_MODEL;
  const years = p.years ?? 50;
  const steps = 12;
  const dt = 1 / steps;
  const out: FieldYear[] = [];
  let np = 0;
  let fwEff = 0;
  let pFlood = 0; // pressure support built up by injection
  let shutIn = false;
  for (let y = 0; y < years; y++) {
    let oilY = 0;
    let waterY = 0;
    let cashY = 0;
    let pAvg = 0;
    let producingYear = false;
    for (let s = 0; s < steps; s++) {
      const t = y + (s + 0.5) * dt;
      const rf = np / m.ooip;
      const primaryP = m.abandonPressure + (m.initialPressure - m.abandonPressure) * Math.pow(Math.max(0, 1 - rf / m.primaryMax), m.pressureExponent);
      const flooding = p.drive === 'waterflood' && t >= p.floodYear;
      if (flooding) pFlood = Math.min(1, pFlood + dt / m.floodRamp);
      const pres = flooding || pFlood > 0 ? primaryP + (Math.max(primaryP, m.floodPressure) - primaryP) * pFlood : primaryP;
      const swn = rf / m.floodMax;
      const fwTarget = flooding ? waterCut(swn) : m.aquiferShare * waterCut(swn);
      fwEff += (fwTarget - fwEff) * Math.min(1, dt / 1.0);
      const pwf = Math.max(pres - m.maxDrawdown, p.drive === 'flowing' ? flowingPwf(fwEff) : m.pumpPwf);
      let liquid = shutIn ? 0 : Math.max(0, p.wells * m.pi * (pres - pwf));
      if (liquid * fwEff > m.waterCapacity) liquid = m.waterCapacity / Math.max(1e-9, fwEff);
      const oil = liquid * (1 - fwEff);
      const water = liquid - oil;
      const revenue = oil * p.oilPrice;
      const opex = (p.wells * m.wellCostPerYear) / 365.25 + liquid * m.liftPerBbl + water * m.waterPerBbl;
      // The economic limit: once a month's oil no longer pays its running costs, the field shuts in.
      if (!shutIn && (liquid <= 0 || revenue < opex) && t > 1) shutIn = true;
      if (shutIn) {
        pAvg += pres / steps;
        continue;
      }
      producingYear = true;
      const days = 365.25 * dt;
      np += oil * days;
      oilY += oil / steps;
      waterY += water / steps;
      cashY += (revenue - opex) * days;
      pAvg += pres / steps;
    }
    out.push({
      year: y,
      pressure: pAvg,
      oil: oilY,
      water: waterY,
      waterCut: oilY + waterY > 0 ? waterY / (oilY + waterY) : fwEff,
      cumOil: np,
      recovery: np / m.ooip,
      cash: cashY,
      producing: producingYear,
    });
  }
  return out;
}

/** The last year the field produced, and its final recovery factor. */
export function fieldOutcome(rows: FieldYear[]): { life: number; recovery: number; peakOil: number; cash: number } {
  const last = rows.reduce((a, r, i) => (r.producing ? i : a), -1);
  return {
    life: last + 1,
    recovery: rows[rows.length - 1].recovery,
    peakOil: Math.max(...rows.map((r) => r.oil)),
    cash: rows.reduce((a, r) => a + r.cash, 0),
  };
}
