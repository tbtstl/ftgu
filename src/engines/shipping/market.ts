// The freight market of the course's world: for one size class, the daily earnings (TCE) at which
// the fleet's capacity matches the trades' demand for it, and the freight rates that follow.
//
// Demand for ships comes from the trades: every cargo needs a laden voyage, days in port, and —
// because cargo flows are lopsided — a ballast voyage to its loading port, planned at the least
// total ballast distance (transport.ts). Supply comes from the fleet: ships trade whenever earnings
// beat their lay-up threshold, and each sails at the speed the slow-steaming rule of Lesson 2.3
// picks for those earnings. Raising earnings brings idle ships back and speeds everyone up, so the
// same fleet does more work: that is the supply curve. Past full speed, only charterers giving up
// marginal cargoes can balance the market, and earnings spike.
//
// Freight rates per tonne then cover each route's voyage at the market's earnings, its fuel, ports
// and canals, plus the change in the ship's positional value between where it loads and where it
// finishes — which is why a voyage that ends where ships are plentiful pays more.

import { CHOKEPOINTS, type Chokepoint } from '../../model/shipping/geo';
import { BASE_BUNKER, MARKET_CLASSES, OFF_HIRE_DAYS, routesOf, type ClassId, type MarketClass, type Route } from '../../model/shipping/trades';
import { seaRoute } from './network';
import { AUX_PORT_TPD } from './propulsion';
import { ballastPlan, type BallastPlan } from './transport';
import { COMMISSION, ballastDraft, fuelPerDay, ladenDraft } from './voyage';

/** How strongly charterers give up cargo when earnings pass the class's choke level. */
export const DEMAND_ELASTICITY = 0.15;
const EARNING_DAYS = 365 - OFF_HIRE_DAYS;

// ---------------------------------------------------------------------------
// Speed curves: fuel per day F(v) and the marginal-value function G(v) = v·F′(v) − F(v), whose
// inverse gives the best speed for a value of a day h at bunker price p: G(v) = h / p.

interface SpeedCurve {
  vs: number[];
  fuel: number[];
  g: number[];
}

function speedCurve(cls: MarketClass, draft: number): SpeedCurve {
  const vs: number[] = [];
  for (let v = 6; v <= 16.0001; v += 0.05) vs.push(Math.round(v * 100) / 100);
  const fuel = vs.map((v) => fuelPerDay(cls.vessel, v, draft));
  const g = vs.map((v, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(vs.length - 1, i + 1);
    const dF = (fuel[hi] - fuel[lo]) / (vs[hi] - vs[lo]);
    return v * dF - fuel[i];
  });
  // Enforce monotonicity (it is, up to rounding).
  for (let i = 1; i < g.length; i++) g[i] = Math.max(g[i], g[i - 1] + 1e-9);
  return { vs, fuel, g };
}

const CURVES = new Map<ClassId, { laden: SpeedCurve; ballast: SpeedCurve; ladenDraft: number; ballastDraft: number }>();

function curvesFor(id: ClassId) {
  let c = CURVES.get(id);
  if (!c) {
    const cls = MARKET_CLASSES[id];
    const ld = ladenDraft(cls.vessel, cls.cargo);
    const bd = ballastDraft(cls.vessel);
    c = { laden: speedCurve(cls, ld), ballast: speedCurve(cls, bd), ladenDraft: ld, ballastDraft: bd };
    CURVES.set(id, c);
  }
  return c;
}

/** Best speed for a value of a day, a bunker price and a fuel-efficiency multiple, clamped. */
function bestSpeed(curve: SpeedCurve, dayValue: number, bunker: number, fuelMult: number, vMin: number, vMax: number): number {
  const target = dayValue / (bunker * fuelMult);
  const { vs, g } = curve;
  let v: number;
  if (target <= g[0]) v = vs[0];
  else if (target >= g[g.length - 1]) v = vs[vs.length - 1];
  else {
    let lo = 0;
    let hi = g.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g[mid] < target) lo = mid;
      else hi = mid;
    }
    const k = (target - g[lo]) / (g[hi] - g[lo]);
    v = vs[lo] + k * (vs[hi] - vs[lo]);
  }
  return Math.min(vMax, Math.max(vMin, v));
}

function fuelAt(curve: SpeedCurve, v: number): number {
  const i = Math.min(curve.vs.length - 2, Math.max(0, Math.floor((v - curve.vs[0]) / 0.05)));
  const k = (v - curve.vs[i]) / (curve.vs[i + 1] - curve.vs[i]);
  return curve.fuel[i] + k * (curve.fuel[i + 1] - curve.fuel[i]);
}

/** Best laden and ballast speed for a ship of the class at given earnings (fleet-average efficiency). */
export function speedsAt(id: ClassId, dayValue: number, bunker = BASE_BUNKER, fuelMult = 1): { laden: number; ballast: number } {
  const cls = MARKET_CLASSES[id];
  const c = curvesFor(id);
  return { laden: bestSpeed(c.laden, dayValue, bunker, fuelMult, cls.vMin, cls.vMax), ballast: bestSpeed(c.ballast, dayValue, bunker, fuelMult, cls.vMin, cls.vMax + 0.5) };
}

// ---------------------------------------------------------------------------
// Geography for a class under a set of closures.

export interface RouteLeg {
  route: Route;
  nm: number;
  canalDays: number;
  canalCost: number;
  chokepoints: Chokepoint[];
  /** False when every way between the ports is closed. */
  open: boolean;
}

export interface Geography {
  legs: RouteLeg[];
  /** Ballast distances from discharge ports to load ports. */
  ballast: Record<string, Record<string, number>>;
}

const GEO_CACHE = new Map<string, Geography>();

export function geography(id: ClassId, closed: Chokepoint[] = []): Geography {
  const key = `${id}|${[...closed].sort().join(',')}`;
  const hit = GEO_CACHE.get(key);
  if (hit) return hit;
  const cls = MARKET_CLASSES[id];
  const c = curvesFor(id);
  const routes = routesOf(id);
  const legs = routes.map((route) => {
    const sr = seaRoute(route.from, route.to, { closed, draft: c.ladenDraft });
    const chokepoints = sr?.chokepoints ?? [];
    const canalCost = (chokepoints.includes('panama') ? cls.canalTolls.panama : 0) + (chokepoints.includes('suez') ? cls.canalTolls.suez : 0);
    return { route, nm: sr?.nm ?? Infinity, canalDays: sr?.canalDays ?? 0, canalCost, chokepoints, open: !!sr };
  });
  const discharge = [...new Set(routes.map((r) => r.to))];
  const load = [...new Set(routes.map((r) => r.from))];
  const ballast: Record<string, Record<string, number>> = {};
  for (const d of discharge) {
    ballast[d] = {};
    for (const l of load) ballast[d][l] = d === l ? 0 : (seaRoute(d, l, { closed, draft: c.ballastDraft })?.nm ?? Infinity);
  }
  const g = { legs, ballast };
  GEO_CACHE.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// Equilibrium.

export interface MarketConditions {
  /** Multiplier on every trade's volume (1 = the baseline). */
  demand?: number;
  /** Extra multipliers on particular routes, by id. */
  routeScale?: Record<string, number>;
  /** Month 0–11: applies the trades' seasonal shapes. */
  month?: number;
  /** Ships in the fleet (default: the class's baseline). */
  fleet?: number;
  /** Bunker price, $/t. */
  bunker?: number;
  closed?: Chokepoint[];
  /** Extra days waiting per call at particular ports. */
  congestion?: Record<string, number>;
  /** Extra share of sea time lost to weather (0.05 = 5% longer passages). */
  weather?: number;
  /** Cap on speed (e.g. a regulation), knots. */
  speedCap?: number;
  /** Shares of the fleet in each age group (default: the class's). */
  cohortShares?: number[];
}

export interface RouteQuote {
  route: Route;
  nm: number;
  open: boolean;
  /** Voyages a year at this route's volume. */
  voyages: number;
  ladenDays: number;
  portDays: number;
  canalDays: number;
  /** Freight per tonne, $. */
  freight: number;
  /** Positional change the freight pays for, nm (ready at loading port minus open at discharge). */
  positional: number;
}

export interface Equilibrium {
  cls: ClassId;
  /** Market earnings, time-charter equivalent, $/day. */
  tce: number;
  /** Fleet-average laden and ballast speeds, knots. */
  ladenSpeed: number;
  ballastSpeed: number;
  fleet: number;
  activeShips: number;
  idleShips: number;
  /** Share of demand served (below 1 when earnings pass the choke level). */
  served: number;
  /** Laden and ballast miles and port days a year, at the served demand. */
  ladenMiles: number;
  ballastMiles: number;
  portDays: number;
  /** Tonne-miles a year, billions. */
  tonMiles: number;
  tonnes: number;
  /** Ship-days a year the trades need (equal to what the active fleet supplies). */
  shipDays: number;
  plan: BallastPlan;
  /** Cost of sailing one ballast mile at the market's earnings, $. */
  ballastMileCost: number;
  routes: RouteQuote[];
  bunker: number;
}

interface Inputs {
  cls: MarketClass;
  geo: Geography;
  voyages: number[];
  plan: BallastPlan;
  ladenMiles: number;
  portDays: number;
  canalDays: number;
  tonMiles: number;
  tonnes: number;
}

/** Trade inputs at unit demand, cached: scaling every volume scales all of them in proportion. */
const BASE_CACHE = new Map<string, Inputs>();

function baseInputs(id: ClassId, c: MarketConditions): Inputs {
  const key = JSON.stringify([id, [...(c.closed ?? [])].sort(), c.month ?? -1, c.routeScale ?? {}, c.congestion ?? {}]);
  const hit = BASE_CACHE.get(key);
  if (hit) return hit;
  const cls = MARKET_CLASSES[id];
  const geo = geography(id, c.closed ?? []);
  const voyages = geo.legs.map((leg) => {
    if (!leg.open) return 0;
    const s = (c.month !== undefined ? leg.route.season[c.month] : 1) * (c.routeScale?.[leg.route.id] ?? 1);
    return (leg.route.mtpa * 1e6 * s) / cls.cargo;
  });
  const supply: Record<string, number> = {};
  const need: Record<string, number> = {};
  geo.legs.forEach((leg, i) => {
    supply[leg.route.to] = (supply[leg.route.to] ?? 0) + voyages[i];
    need[leg.route.from] = (need[leg.route.from] ?? 0) + voyages[i];
  });
  const plan = ballastPlan(supply, need, geo.ballast);
  let ladenMiles = 0;
  let portDays = 0;
  let canalDays = 0;
  let tonMiles = 0;
  let tonnes = 0;
  geo.legs.forEach((leg, i) => {
    const v = voyages[i];
    if (!v) return;
    ladenMiles += v * leg.nm;
    portDays += v * (leg.route.portDays + (c.congestion?.[leg.route.from] ?? 0) + (c.congestion?.[leg.route.to] ?? 0));
    canalDays += v * leg.canalDays;
    tonMiles += v * cls.cargo * leg.nm;
    tonnes += v * cls.cargo;
  });
  const inp = { cls, geo, voyages, plan, ladenMiles, portDays, canalDays, tonMiles, tonnes };
  if (BASE_CACHE.size > 2000) BASE_CACHE.clear();
  BASE_CACHE.set(key, inp);
  return inp;
}

function inputs(id: ClassId, c: MarketConditions): Inputs {
  const b = baseInputs(id, c);
  const d = c.demand ?? 1;
  if (d === 1) return b;
  return {
    ...b,
    voyages: b.voyages.map((v) => v * d),
    plan: { ...b.plan, miles: b.plan.miles * d, flows: b.plan.flows.map((f) => ({ ...f, ships: f.ships * d })) },
    ladenMiles: b.ladenMiles * d,
    portDays: b.portDays * d,
    canalDays: b.canalDays * d,
    tonMiles: b.tonMiles * d,
    tonnes: b.tonnes * d,
  };
}

interface SupplyAt {
  active: number;
  ladenSpeed: number;
  ballastSpeed: number;
  /** Active-fleet average fuel multiple. */
  fuelMult: number;
}

function supplyAt(id: ClassId, h: number, fleet: number, bunker: number, speedCap?: number, shares?: number[]): SupplyAt {
  const cls = MARKET_CLASSES[id];
  const c = curvesFor(id);
  let active = 0;
  let sl = 0;
  let sb = 0;
  let fm = 0;
  for (let ki = 0; ki < cls.cohorts.length; ki++) {
    const k = cls.cohorts[ki];
    if (h < k.layup) continue;
    const n = fleet * (shares?.[ki] ?? k.share);
    let vl = bestSpeed(c.laden, h, bunker, k.fuel, cls.vMin, cls.vMax);
    let vb = bestSpeed(c.ballast, h, bunker, k.fuel, cls.vMin, cls.vMax + 0.5);
    if (speedCap !== undefined) {
      vl = Math.min(vl, speedCap);
      vb = Math.min(vb, speedCap);
    }
    active += n;
    sl += n * vl;
    sb += n * vb;
    fm += n * k.fuel;
  }
  return active > 0 ? { active, ladenSpeed: sl / active, ballastSpeed: sb / active, fuelMult: fm / active } : { active: 0, ladenSpeed: cls.vMin, ballastSpeed: cls.vMin, fuelMult: 1 };
}

function servedAt(cls: MarketClass, h: number): number {
  return h <= cls.choke ? 1 : (cls.choke / h) ** DEMAND_ELASTICITY;
}

/** Ship-days a year the trades need at earnings h, minus what the fleet supplies. */
function excess(inp: Inputs, h: number, fleet: number, bunker: number, weather: number, speedCap?: number, shares?: number[]): { e: number; s: SupplyAt; need: number; served: number } {
  const s = supplyAt(inp.cls.id, h, fleet, bunker, speedCap, shares);
  const served = servedAt(inp.cls, h);
  const sea = (inp.ladenMiles / (24 * s.ladenSpeed) + inp.plan.miles / (24 * s.ballastSpeed)) * (1 + weather);
  const need = served * (inp.portDays + inp.canalDays + sea);
  return { e: need - s.active * EARNING_DAYS, s, need, served };
}

/** The market-clearing earnings for a class under some conditions. */
export function equilibrium(id: ClassId, c: MarketConditions = {}): Equilibrium {
  const inp = inputs(id, c);
  const cls = inp.cls;
  const fleet = c.fleet ?? cls.fleet;
  const bunker = c.bunker ?? BASE_BUNKER;
  const weather = c.weather ?? 0;
  let lo = 0;
  let hi = 600_000;
  if (excess(inp, lo, fleet, bunker, weather, c.speedCap, c.cohortShares).e <= 0) hi = 0;
  for (let i = 0; i < 70 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (excess(inp, mid, fleet, bunker, weather, c.speedCap, c.cohortShares).e > 0) lo = mid;
    else hi = mid;
  }
  const h = hi;
  const x = excess(inp, h, fleet, bunker, weather, c.speedCap, c.cohortShares);
  const activeShips = Math.min(fleet, x.need / EARNING_DAYS);
  const cv = curvesFor(id);
  const ballastFuel = fuelAt(cv.ballast, x.s.ballastSpeed) * x.s.fuelMult;
  const ladenFuel = fuelAt(cv.laden, x.s.ladenSpeed) * x.s.fuelMult;
  const ballastMileCost = (h + bunker * ballastFuel) / (24 * x.s.ballastSpeed);
  const routes: RouteQuote[] = inp.geo.legs.map((leg, i) => {
    const ladenDays = (leg.nm / (24 * x.s.ladenSpeed)) * (1 + weather);
    const portDays = leg.route.portDays + (c.congestion?.[leg.route.from] ?? 0) + (c.congestion?.[leg.route.to] ?? 0);
    const positional = (inp.plan.ready[leg.route.from] ?? 0) - (inp.plan.open[leg.route.to] ?? 0);
    const cost =
      h * (ladenDays + portDays + leg.canalDays) +
      bunker * (ladenFuel * ladenDays + AUX_PORT_TPD * (portDays + leg.canalDays)) +
      cls.portCosts +
      leg.canalCost +
      ballastMileCost * positional;
    return {
      route: leg.route,
      nm: leg.nm,
      open: leg.open,
      voyages: inp.voyages[i] * x.served,
      ladenDays,
      portDays,
      canalDays: leg.canalDays,
      freight: leg.open ? cost / (cls.cargo * (1 - COMMISSION)) : NaN,
      positional,
    };
  });
  return {
    cls: id,
    tce: h,
    ladenSpeed: x.s.ladenSpeed,
    ballastSpeed: x.s.ballastSpeed,
    fleet,
    activeShips,
    idleShips: fleet - activeShips,
    served: x.served,
    ladenMiles: inp.ladenMiles * x.served,
    ballastMiles: inp.plan.miles * x.served,
    portDays: inp.portDays * x.served,
    tonMiles: (inp.tonMiles * x.served) / 1e9,
    tonnes: inp.tonnes * x.served,
    shipDays: x.need,
    plan: inp.plan,
    ballastMileCost,
    routes,
    bunker,
  };
}

/**
 * Time-charter earnings for a trip delivered where the ship is worth `fromValue` (nm) and redelivered
 * where it is worth `toValue`, lasting `days`: the market rate plus the positional change spread
 * over the trip.
 */
export function tripTce(eq: Equilibrium, fromValue: number, toValue: number, days: number): number {
  return eq.tce + (eq.ballastMileCost * (fromValue - toValue)) / days;
}

/** The fleet's supply curve: market earnings as demand is scaled, holding everything else. */
export function supplyCurve(id: ClassId, demands: number[], c: MarketConditions = {}): Array<{ demand: number; eq: Equilibrium }> {
  return demands.map((d) => ({ demand: d, eq: equilibrium(id, { ...c, demand: d }) }));
}

export function chokepointLabel(c: Chokepoint): string {
  return CHOKEPOINTS[c].name;
}
