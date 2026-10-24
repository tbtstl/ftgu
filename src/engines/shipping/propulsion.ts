// Propulsion and fuel: from the power the hull needs to the fuel the engine burns.
//
//   effective power  P_E = R × V                     (the hull's resistance times its speed)
//   delivered power  P_D = P_E ÷ η_D                 (η_D: propeller and hull interaction, ~0.70)
//   brake power      P_B = P_D ÷ η_shaft             (shaft and bearings, ~0.99)
//   fuel             P_B × hours × SFOC
// SFOC, the specific fuel oil consumption in g/kWh, follows from the engine's thermal efficiency
// and the fuel's energy content, and rises when a two-stroke engine runs far from its best load.

import type { Hull } from '../../model/shipping/vessels';
import { calmResistance } from './resistance';

export const ETA_D = 0.7;
export const ETA_SHAFT = 0.99;
/** Thermal efficiency of a modern slow-speed two-stroke diesel at its best load. */
export const ENGINE_EFFICIENCY = 0.5;
/** Engine load (fraction of MCR) at which SFOC is lowest. */
const BEST_LOAD = 0.8;
/** Auxiliary engines' fuel at sea (electricity for the ship), t/day. */
export const AUX_SEA_TPD = 2.5;
/** Auxiliary fuel in port (no cranes), t/day. */
export const AUX_PORT_TPD = 3;

export type FuelId = 'hsfo' | 'vlsfo' | 'mgo' | 'lng';

export interface Fuel {
  id: FuelId;
  name: string;
  short: string;
  /** Lower calorific value, MJ/kg (IMO default values). */
  lcv: number;
  /** Tonnes of CO₂ per tonne of fuel burned (IMO conversion factors; LNG excludes methane slip). */
  co2: number;
  /** Illustrative price, $ per tonne. */
  price: number;
  note: string;
}

export const FUELS: Record<FuelId, Fuel> = {
  hsfo: { id: 'hsfo', name: 'High-sulfur fuel oil', short: 'HSFO', lcv: 40.2, co2: 3.114, price: 480, note: 'Allowed since 2020 only with an exhaust scrubber.' },
  vlsfo: { id: 'vlsfo', name: 'Very-low-sulfur fuel oil', short: 'VLSFO', lcv: 41.2, co2: 3.151, price: 600, note: 'The usual bunker since the 2020 sulfur cap.' },
  mgo: { id: 'mgo', name: 'Marine gasoil', short: 'MGO', lcv: 42.7, co2: 3.206, price: 780, note: 'A light distillate, required in emission control areas.' },
  lng: { id: 'lng', name: 'Liquefied natural gas', short: 'LNG', lcv: 48.0, co2: 2.75, price: 700, note: 'Needs a dual-fuel engine and insulated tanks.' },
};

/** Best-load SFOC, g/kWh, for an engine of a thermal efficiency burning a fuel. */
export function sfocBest(efficiency: number, fuel: Fuel): number {
  return 3600 / (efficiency * fuel.lcv);
}

/** SFOC at a load (fraction of MCR): a shallow bowl around the best load. */
export function sfocAt(load: number, efficiency: number, fuel: Fuel): number {
  return sfocBest(efficiency, fuel) * (1 + 0.4 * (load - BEST_LOAD) ** 2);
}

export interface PropulsionOptions {
  draft: number;
  fouling?: number;
  /** Extra resistance from wind and waves, kN. */
  addedResistance?: number;
  etaD?: number;
  efficiency?: number;
  fuel?: Fuel;
}

export interface PowerFuel {
  effectivePower: number;
  deliveredPower: number;
  brakePower: number;
  /** Fraction of the engine's MCR. */
  load: number;
  sfoc: number;
  /** Main engine fuel, t/day. */
  mainTpd: number;
  /** Main plus auxiliary fuel, t/day. */
  totalTpd: number;
}

/** Power and daily fuel at a speed through the water. */
export function powerAndFuel(h: Hull & { mcr: number }, speedKn: number, o: PropulsionOptions): PowerFuel {
  const fuel = o.fuel ?? FUELS.vlsfo;
  const eff = o.efficiency ?? ENGINE_EFFICIENCY;
  const r = calmResistance(h, speedKn, o.draft, o.fouling ?? 0);
  const effectivePower = (r.total + (o.addedResistance ?? 0)) * speedKn * (1852 / 3600);
  const deliveredPower = effectivePower / (o.etaD ?? ETA_D);
  const brakePower = deliveredPower / ETA_SHAFT;
  const load = brakePower / h.mcr;
  const sfoc = sfocAt(load, eff, fuel);
  const mainTpd = (brakePower * 24 * sfoc) / 1e6;
  // Auxiliary fuel scales with the fuel's energy content too (the gensets burn the same fuel).
  const aux = (AUX_SEA_TPD * FUELS.vlsfo.lcv) / fuel.lcv;
  return { effectivePower, deliveredPower, brakePower, load, sfoc, mainTpd, totalTpd: mainTpd + aux };
}

export interface VoyageFuel extends PowerFuel {
  days: number;
  fuelTonnes: number;
  co2Tonnes: number;
  cost: number;
}

/** A sea passage at constant speed: days, fuel, CO₂ and fuel cost. */
export function passage(h: Hull & { mcr: number }, distanceNm: number, speedKn: number, o: PropulsionOptions): VoyageFuel {
  const fuel = o.fuel ?? FUELS.vlsfo;
  const pf = powerAndFuel(h, speedKn, o);
  const days = distanceNm / (speedKn * 24);
  const fuelTonnes = pf.totalTpd * days;
  return { ...pf, days, fuelTonnes, co2Tonnes: fuelTonnes * fuel.co2, cost: fuelTonnes * fuel.price };
}

/** The speed through the water a given brake power can sustain, by bisection, knots. */
export function speedForPower(h: Hull & { mcr: number }, brakePowerKw: number, o: PropulsionOptions, maxKn = 25): number {
  let lo = 0;
  let hi = maxKn;
  if (powerAndFuel(h, hi, o).brakePower <= brakePowerKw) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (powerAndFuel(h, mid, o).brakePower > brakePowerKw) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
