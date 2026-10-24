// The voyage estimate: what a voyage earns, what it costs, and what that is worth per day — the
// time-charter equivalent (TCE), the number every freight decision in this course comes back to.
//
//   TCE = (freight − commissions − bunkers − port costs − canal tolls) ÷ voyage days
//
// Fuel comes from the physics of Chapter 1: each leg at its own speed and draft.

import { RHO_SEA, type VesselClass } from '../../model/shipping/vessels';
import { draftFor } from './hydrostatics';
import { AUX_PORT_TPD, FUELS, powerAndFuel } from './propulsion';

/** Address commission plus brokerage, a typical total for dry bulk fixtures. */
export const COMMISSION = 0.05;

/** The draft of a ship carrying a cargo, m. */
export function ladenDraft(v: VesselClass, cargo: number): number {
  return draftFor(v, v.lightship + v.consumables + cargo, RHO_SEA);
}

/** The draft in normal ballast, m. */
export function ballastDraft(v: VesselClass): number {
  return draftFor(v, v.lightship + v.consumables + v.ballast, RHO_SEA);
}

export interface VoyageSpec {
  /** Ballast miles to the loading port, laden miles to discharge. */
  ballastNm: number;
  ladenNm: number;
  cargo: number;
  /** Freight, $ per tonne of cargo. */
  freight: number;
  /** Days in port loading and discharging, including waiting. */
  portDays: number;
  /** Port charges, agency, pilotage and towage for both ends, $. */
  portCosts: number;
  /** Canal tolls, $. */
  canalCost?: number;
  /** Extra steaming days for a canal transit or waiting at it. */
  canalDays?: number;
  bunkerPrice: number;
  ladenSpeed: number;
  ballastSpeed: number;
  commission?: number;
}

export interface VoyageResult {
  ladenDays: number;
  ballastDays: number;
  portDays: number;
  days: number;
  ladenFuel: number;
  ballastFuel: number;
  portFuel: number;
  fuel: number;
  bunkers: number;
  grossFreight: number;
  commissions: number;
  voyageCosts: number;
  /** Freight net of commissions and voyage costs, $. */
  net: number;
  tce: number;
}

/** Fuel per day at a speed and draft, t/day (VLSFO, Kestrel's standard engine and propeller). */
export function fuelPerDay(v: VesselClass, speedKn: number, draft: number): number {
  return powerAndFuel(v, speedKn, { draft, fuel: FUELS.vlsfo }).totalTpd;
}

export function voyageEstimate(v: VesselClass, s: VoyageSpec): VoyageResult {
  const ld = ladenDraft(v, s.cargo);
  const bd = ballastDraft(v);
  const ladenDays = s.ladenNm / (s.ladenSpeed * 24);
  const ballastDays = s.ballastNm / (s.ballastSpeed * 24);
  const canalDays = s.canalDays ?? 0;
  const ladenFuel = ladenDays * fuelPerDay(v, s.ladenSpeed, ld);
  const ballastFuel = ballastDays * fuelPerDay(v, s.ballastSpeed, bd);
  const portFuel = (s.portDays + canalDays) * AUX_PORT_TPD;
  const fuel = ladenFuel + ballastFuel + portFuel;
  const bunkers = fuel * s.bunkerPrice;
  const grossFreight = s.freight * s.cargo;
  const commissions = grossFreight * (s.commission ?? COMMISSION);
  const voyageCosts = bunkers + s.portCosts + (s.canalCost ?? 0);
  const net = grossFreight - commissions - voyageCosts;
  const days = ladenDays + ballastDays + s.portDays + canalDays;
  return { ladenDays, ballastDays, portDays: s.portDays, days, ladenFuel, ballastFuel, portFuel, fuel, bunkers, grossFreight, commissions, voyageCosts, net, tce: net / days };
}

/** The single speed (laden and ballast alike) that maximizes TCE, searched on a 0.1-knot grid. */
export function bestSpeed(v: VesselClass, s: Omit<VoyageSpec, 'ladenSpeed' | 'ballastSpeed'>, min = 9, max = 15): { speed: number; result: VoyageResult } {
  let best = { speed: min, result: voyageEstimate(v, { ...s, ladenSpeed: min, ballastSpeed: min }) };
  for (let k = Math.round(min * 10) + 1; k <= Math.round(max * 10); k++) {
    const sp = k / 10;
    const r = voyageEstimate(v, { ...s, ladenSpeed: sp, ballastSpeed: sp });
    if (r.tce > best.result.tce) best = { speed: sp, result: r };
  }
  return best;
}

/** The freight rate, $/t, at which a voyage earns a given TCE. */
export function freightForTce(v: VesselClass, s: VoyageSpec, tce: number): number {
  const at0 = voyageEstimate(v, { ...s, freight: 0 });
  // net = freight·cargo·(1 − c) − costs = tce·days  →  freight = (tce·days + costs) / (cargo·(1 − c))
  return (tce * at0.days + at0.voyageCosts) / (s.cargo * (1 - (s.commission ?? COMMISSION)));
}

/**
 * The speed that minimizes the cost of covering a mile when a day of the ship's time is worth
 * `dayValue` dollars: (fuel/day × price + dayValue) ÷ (24 × speed). This is the slow-steaming rule:
 * the marginal fuel cost of going faster equals the value of the time saved.
 */
export function speedForDayValue(v: VesselClass, draft: number, dayValue: number, bunkerPrice: number, min = 8, max = 15.5): number {
  let best = min;
  let bestCost = Infinity;
  for (let k = Math.round(min * 20); k <= Math.round(max * 20); k++) {
    const sp = k / 20;
    const cost = (fuelPerDay(v, sp, draft) * bunkerPrice + dayValue) / (24 * sp);
    if (cost < bestCost) {
      bestCost = cost;
      best = sp;
    }
  }
  return best;
}

/**
 * How much cargo one ship moves in a year on a round voyage, tonnes, at a speed: the number of
 * round trips that fit in its earning days times its cargo.
 */
export function annualCargo(v: VesselClass, s: Omit<VoyageSpec, 'ladenSpeed' | 'ballastSpeed' | 'freight'>, speed: number, earningDays = 355): number {
  const r = voyageEstimate(v, { ...s, freight: 0, ladenSpeed: speed, ballastSpeed: speed });
  return (earningDays / r.days) * s.cargo;
}
