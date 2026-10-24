// Two ways to hire a ship for the same voyage, and who carries which risk.
//
// Voyage charter: the charterer pays freight per tonne; the owner runs the voyage and pays its
// fuel, port costs and canal tolls. Time lost at sea or to a dearer bunker is the owner's problem;
// time lost in port beyond the agreed laytime is paid for by the charterer as demurrage.
// Time charter: the charterer pays hire per day for the ship and runs the voyage, paying fuel and
// ports; the owner pays only operating costs, and loses hire for any days the ship is off hire
// (broken down). The time-charter equivalent (TCE) makes the two comparable.

import { rng, gaussian } from '../../model/random';
import type { VesselClass } from '../../model/shipping/vessels';
import { AUX_PORT_TPD } from './propulsion';
import { COMMISSION, ladenDraft, fuelPerDay } from './voyage';

export interface CharterVoyage {
  vessel: VesselClass;
  /** Laden passage, nm (the voyage starts at the loading port). */
  ladenNm: number;
  cargo: number;
  speed: number;
  /** Laytime for loading and discharging together, days. */
  laytime: number;
  portCosts: number;
  canalCost: number;
  /** Bunker price when the deal is agreed, $/t. */
  bunker: number;
  /** Demurrage rate, $/day. */
  demurrage: number;
}

/** What actually happens on the voyage. */
export interface Outcome {
  /** Bunker price actually paid, $/t. */
  bunker: number;
  /** Extra days at sea from weather. */
  weatherDays: number;
  /** Extra days in port beyond laytime (congestion, slow handling). */
  portDelay: number;
  /** Days the ship is broken down. */
  offHire: number;
}

export const PLANNED: (v: CharterVoyage) => Outcome = (v) => ({ bunker: v.bunker, weatherDays: 0, portDelay: 0, offHire: 0 });

export interface Party {
  /** Money in less money out over the voyage, $. */
  net: number;
  /** For the owner: net per day of the ship's time (its realized TCE). For the charterer: cost per tonne. */
  perUnit: number;
}

export interface CharterResult {
  days: number;
  seaDays: number;
  fuel: number;
  owner: Party;
  charterer: Party;
}

function fuelFor(v: CharterVoyage, o: Outcome) {
  const draft = ladenDraft(v.vessel, v.cargo);
  const seaDays = v.ladenNm / (24 * v.speed) + o.weatherDays;
  const portDays = v.laytime + o.portDelay;
  // Weather days are spent fighting the sea at the same engine output.
  const fuel = seaDays * fuelPerDay(v.vessel, v.speed, draft) + portDays * AUX_PORT_TPD;
  return { seaDays, portDays, fuel, days: seaDays + portDays + o.offHire };
}

/**
 * Voyage charter at `freight` $/t: the charterer pays freight (less commissions) and demurrage for
 * port delays; the owner pays fuel at the actual price, port costs and tolls. The charterer's
 * `cargoValuePerDay` is what each day of delay costs it in the cargo's time (interest, missed sales).
 */
export function voyageCharter(v: CharterVoyage, freight: number, o: Outcome, cargoValuePerDay = 0): CharterResult {
  const f = fuelFor(v, o);
  const revenue = freight * v.cargo * (1 - COMMISSION) + v.demurrage * o.portDelay;
  const ownerNet = revenue - f.fuel * o.bunker - v.portCosts - v.canalCost;
  const chartererCost = freight * v.cargo + v.demurrage * o.portDelay + cargoValuePerDay * (f.days - fuelFor(v, PLANNED(v)).days);
  return {
    days: f.days,
    seaDays: f.seaDays,
    fuel: f.fuel,
    owner: { net: ownerNet, perUnit: ownerNet / f.days },
    charterer: { net: -chartererCost, perUnit: chartererCost / v.cargo },
  };
}

/**
 * Time charter at `hire` $/day for the trip: hire is paid for every day except off-hire days (less
 * commissions); the charterer pays the fuel, ports and tolls.
 */
export function timeCharter(v: CharterVoyage, hire: number, o: Outcome, cargoValuePerDay = 0): CharterResult {
  const f = fuelFor(v, o);
  const hireDays = f.days - o.offHire;
  const ownerNet = hire * hireDays * (1 - COMMISSION);
  const chartererCost = hire * hireDays + f.fuel * o.bunker + v.portCosts + v.canalCost + cargoValuePerDay * (f.days - fuelFor(v, PLANNED(v)).days);
  return {
    days: f.days,
    seaDays: f.seaDays,
    fuel: f.fuel,
    owner: { net: ownerNet, perUnit: ownerNet / f.days },
    charterer: { net: -chartererCost, perUnit: chartererCost / v.cargo },
  };
}

/** The voyage freight that earns the owner exactly `hire` a day net of commissions, as planned. */
export function equivalentFreight(v: CharterVoyage, hire: number): number {
  const f = fuelFor(v, PLANNED(v));
  return (hire * f.days * (1 - COMMISSION) + f.fuel * v.bunker + v.portCosts + v.canalCost) / (v.cargo * (1 - COMMISSION));
}

/** The hire that matches a voyage freight as planned: the voyage's TCE gross of commissions. */
export function equivalentHire(v: CharterVoyage, freight: number): number {
  const r = voyageCharter(v, freight, PLANNED(v));
  return r.owner.net / (r.days * (1 - COMMISSION));
}

export interface RiskSpread {
  /** Bunker price can move by this share (standard deviation) between fixing and bunkering. */
  bunkerSd: number;
  /** Average extra weather days at sea (exponential). */
  weatherMean: number;
  /** Average extra days in port (exponential). */
  delayMean: number;
  /** Chance of a breakdown, and its average length in days. */
  breakdownChance: number;
  breakdownDays: number;
}

/** Random outcomes for the voyage, seeded. */
export function sampleOutcomes(v: CharterVoyage, s: RiskSpread, n: number, seed: number): Outcome[] {
  const r = rng(seed);
  const expo = (m: number) => (m > 0 ? -m * Math.log(1 - r()) : 0);
  return Array.from({ length: n }, () => ({
    bunker: v.bunker * Math.exp(s.bunkerSd * gaussian(r) - (s.bunkerSd * s.bunkerSd) / 2),
    weatherDays: expo(s.weatherMean),
    portDelay: expo(s.delayMean),
    offHire: r() < s.breakdownChance ? expo(s.breakdownDays) : 0,
  }));
}
