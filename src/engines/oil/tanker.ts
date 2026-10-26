// Tanker voyage economics (Lessons 4.2, 4.5 and later).
//
// A round voyage: laden one way, in ballast (empty) back, plus days in port. The charterer pays
// hire for every day, fuel for every day at sea (scaling with the cube of speed, since a hull's
// resistance rises steeply with speed) and in port, and port charges. Dividing by the cargo gives
// freight per barrel. Because hire falls with speed and fuel rises with its square, there is a
// cheapest speed: v* = (hire · 14³ / (2 · fuel₁₄ · bunker price))^(1/3) knots. A ship loading or
// discharging at Port Corran pays to lighter whatever it carries above the dock limit.

import { BUNKER_PRICE, CORRAN_DOCK_LIMIT, LIGHTERING_COST, PORT_DAYS, ROUTES, VESSELS, type RouteId, type Vessel, type VesselId } from '../../model/oil/logistics';

export interface VoyageInputs {
  vessel: VesselId;
  route: RouteId;
  /** Speed at sea, knots. */
  speed: number;
  /** Charter hire, $/day (default: the vessel's). */
  hire?: number;
  /** Bunker fuel, $/tonne. */
  bunker?: number;
  /**
   * Whether the voyage loads or discharges at Port Corran, whose dock limit means any cargo above it
   * is moved to or from smaller ships offshore (lightering). Default: when the route starts or ends
   * at Port Corran.
   */
  atCorran?: boolean;
}

export interface Voyage {
  seaDays: number;
  portDays: number;
  days: number;
  fuelTonnes: number;
  hireCost: number;
  fuelCost: number;
  portCost: number;
  lightering: number;
  total: number;
  cargo: number;
  perBbl: number;
}

export function fuelPerDay(v: Vessel, speed: number): number {
  return v.fuelAt14 * Math.pow(speed / 14, 3);
}

export function voyage(inp: VoyageInputs): Voyage {
  const v = VESSELS[inp.vessel];
  const r = ROUTES[inp.route];
  const hire = inp.hire ?? v.hire;
  const bunker = inp.bunker ?? BUNKER_PRICE;
  const speed = Math.max(1, inp.speed);
  const seaDays = (2 * r.nm) / (speed * 24);
  const days = seaDays + PORT_DAYS;
  const fuelTonnes = fuelPerDay(v, speed) * seaDays + v.fuelInPort * PORT_DAYS;
  const hireCost = hire * days;
  const fuelCost = fuelTonnes * bunker;
  const atCorran = inp.atCorran ?? (r.from === 'Port Corran' || r.to === 'Port Corran');
  const lightering = atCorran ? Math.max(0, v.cargo - CORRAN_DOCK_LIMIT) * LIGHTERING_COST : 0;
  const total = hireCost + fuelCost + v.portCharges + lightering;
  return { seaDays, portDays: PORT_DAYS, days, fuelTonnes, hireCost, fuelCost, portCost: v.portCharges, lightering, total, cargo: v.cargo, perBbl: total / v.cargo };
}

/** The speed (knots) that minimizes freight per barrel. */
export function cheapestSpeed(vessel: VesselId, hire?: number, bunker?: number): number {
  const v = VESSELS[vessel];
  const h = hire ?? v.hire;
  const b = bunker ?? BUNKER_PRICE;
  return Math.cbrt((h * 14 ** 3) / (2 * v.fuelAt14 * b));
}

/** Days at sea on the laden leg of a route. */
export function ladenDays(route: RouteId, speed: number): number {
  return ROUTES[route].nm / (speed * 24);
}
