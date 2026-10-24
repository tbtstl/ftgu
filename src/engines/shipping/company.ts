// A shipping company in the course's world: its ships and what they cost, the cargoes its brokers
// hear about, and a desk that schedules ships to cargoes week by week. Everything here reuses
// earlier mechanics — operating and capital costs (2.4), ship values (2.5), sea routes and ballast
// voyages (3.1, 3.4), freight rates from the market (4.1) and voyage TCE (2.3).

import { gaussian, rng } from '../../model/random';
import { standardHistory, eventAt, type History } from '../../model/shipping/history';
import { MARKET_CLASSES, OFF_HIRE_DAYS, ROUTES, type ClassId, type Route } from '../../model/shipping/trades';
import { classOpex, replacementEarnings, shipValue, type CycleMonth } from './cycle';
import { annuity, scrapValue, SHIP_LIFE } from './economics';
import { sharesAt } from './forecast';
import { equilibrium } from './market';
import { seaDistance } from './network';
import { AUX_PORT_TPD } from './propulsion';
import { COMMISSION, ballastDraft, fuelPerDay, ladenDraft } from './voyage';

export type ShipMode = 'owned' | 'chartered';

export interface CompanyShip {
  id: string;
  name: string;
  cls: ClassId;
  /** Age in years at the start. */
  age: number;
  mode: ShipMode;
  /** Price paid, $ (owned ships). */
  price: number;
  /** Daily hire, $ (chartered ships). */
  hire: number;
  /** Where she is open at the start, and on which day. */
  at: string;
  openDay: number;
}

export interface CompanyFinance {
  /** Share of each owned ship's price borrowed. */
  ltv: number;
  rate: number;
  tenor: number;
  equityReturn: number;
}

export interface ShipCost {
  /** Operating costs, $/day (rising 2.5% a year of age, as in Lesson 2.4). */
  opex: number;
  /** Interest plus loan repayment, $/day (owned). */
  debtService: number;
  /** Depreciation plus the owner's required return, $/day (owned). */
  capital: number;
  /** Hire, $/day (chartered). */
  hire: number;
  /** TCE needed per earning day to pay cash costs. */
  cashBreakeven: number;
  /** TCE needed per earning day to cover everything, including the return on equity. */
  fullBreakeven: number;
  /** The owner's own money in the ship, $. */
  equity: number;
}

const EARN = (365 - OFF_HIRE_DAYS) / 365;

export function shipCost(s: CompanyShip, f: CompanyFinance): ShipCost {
  const opex = classOpex(s.cls) * (1 + 0.025 * s.age);
  if (s.mode === 'chartered') {
    // A chartered-in ship's operating costs are her owner's; the charterer pays hire only.
    return { opex: 0, debtService: 0, capital: 0, hire: s.hire, cashBreakeven: s.hire / EARN, fullBreakeven: s.hire / EARN, equity: 0 };
  }
  const v = MARKET_CLASSES[s.cls].vessel;
  const loan = s.price * f.ltv;
  const interest = (loan * f.rate) / 365;
  const principal = Math.max(0, annuity(loan, f.rate, f.tenor) - loan * f.rate) / 365;
  const life = Math.max(1, SHIP_LIFE - s.age);
  const depreciation = Math.max(0, s.price - scrapValue(v)) / life / 365;
  const equity = s.price * (1 - f.ltv);
  const required = (equity * f.equityReturn) / 365;
  return {
    opex,
    debtService: interest + principal,
    capital: depreciation + required + interest,
    hire: 0,
    cashBreakeven: (opex + interest + principal) / EARN,
    fullBreakeven: (opex + interest + depreciation + required) / EARN,
    equity,
  };
}

/** What a secondhand ship of an age changes hands for in a month of the history, $. */
export function shipPrice(cls: ClassId, age: number, hist: CycleMonth[], t: number): number {
  const recent = hist.slice(Math.max(0, t - 11), t + 1);
  const avg = recent.reduce((a, m) => a + m.tce, 0) / recent.length;
  const lr = replacementEarnings(cls);
  return shipValue(cls, age, 0.75 * avg + 0.25 * lr, lr);
}

/** Tonne-miles a year one ship of the class carries at the market's work rate, billions. */
export function shipCapacity(cls: ClassId): number {
  const eq = equilibrium(cls);
  return eq.tonMiles / eq.activeShips;
}

// ---------------------------------------------------------------------------
// Cargoes the company hears about.

export interface CargoOffer {
  id: string;
  route: Route;
  cls: ClassId;
  /** Loading window, days from the start. */
  from: number;
  to: number;
  tonnes: number;
  /** Freight offered, $/t. */
  freight: number;
}

export interface CargoWorld {
  /** Month of the history the company starts in. */
  start: number;
  weeks: number;
  /** Share of the world's cargoes the company's brokers bring it. */
  reach: number;
  /** Multipliers on each route's volume (export strength). */
  routeScale: Record<string, number>;
  seed: number;
}

export const DEFAULT_WORLD: CargoWorld = { start: 96, weeks: 26, reach: 0.02, routeScale: {}, seed: 11 };

const WEEK = 7;
const MONTH = 365 / 12;

/** How a month's freight on a route moves when route volumes change: the re-solved market's ratio. */
const RATIO_CACHE = new Map<string, Record<string, number>>();
export function freightRatios(cls: ClassId, m: CycleMonth, t: number, routeScale: Record<string, number>): Record<string, number> {
  const key = `${cls}|${t}|${JSON.stringify(routeScale)}`;
  const hit = RATIO_CACHE.get(key);
  if (hit) return hit;
  const ev = eventAt(t);
  const base = { demand: m.demand, month: m.month, fleet: m.fleet, bunker: m.bunker, cohortShares: sharesAt(m), closed: ev?.closed, congestion: ev?.congestion, routeScale: ev?.routeScale };
  const plain = equilibrium(cls, base);
  // The reader's export strength multiplies whatever the history already had that month.
  const combined: Record<string, number> = { ...(ev?.routeScale ?? {}) };
  for (const [id, x] of Object.entries(routeScale)) combined[id] = (combined[id] ?? 1) * x;
  const changed = equilibrium(cls, { ...base, routeScale: combined });
  const out: Record<string, number> = {};
  for (const q of plain.routes) {
    const c = changed.routes.find((x) => x.route.id === q.route.id)!;
    out[q.route.id] = q.freight > 0 && Number.isFinite(c.freight) ? c.freight / q.freight : 1;
  }
  if (RATIO_CACHE.size > 3000) RATIO_CACHE.clear();
  RATIO_CACHE.set(key, out);
  return out;
}

/**
 * The cargo offers over the period: for each route and week, a random number of cargoes (the
 * route's share of world voyages × reach × its season), each with a week's loading window and the
 * month's freight for its route with a little noise.
 */
export function cargoOffers(w: CargoWorld, hist: History = standardHistory()): CargoOffer[] {
  const r = rng(w.seed);
  const out: CargoOffer[] = [];
  for (let week = 0; week < w.weeks; week++) {
    const day = week * WEEK;
    const t = Math.min(hist.months - 1, w.start + Math.floor(day / MONTH));
    for (const route of ROUTES) {
      const m = hist.cls[route.cls][t];
      const scale = w.routeScale[route.id] ?? 1;
      const ev = eventAt(t);
      const evScale = ev?.routeScale?.[route.id] ?? 1;
      const voyagesPerWeek = (route.mtpa * 1e6 * route.season[m.month] * m.demand * scale * evScale) / MARKET_CLASSES[route.cls].cargo / 52;
      const mean = voyagesPerWeek * w.reach;
      // Poisson draw.
      let n = 0;
      let p = Math.exp(-mean);
      const u = r();
      let cum = p;
      while (u > cum && n < 20) {
        n += 1;
        p *= mean / n;
        cum += p;
      }
      const ratio = freightRatios(route.cls, m, t, w.routeScale)[route.id] ?? 1;
      for (let i = 0; i < n; i++) {
        const from = day + Math.floor(r() * WEEK);
        out.push({
          id: `${route.id}-${week}-${i}`,
          route,
          cls: route.cls,
          from,
          to: from + 7,
          tonnes: MARKET_CLASSES[route.cls].cargo,
          freight: (m.freights[route.id] ?? NaN) * ratio * (1 + 0.04 * gaussian(r)),
        });
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------
// The operations desk.

export type DispatchRule = 'bestTce' | 'nearest' | 'bestFreight';

export interface OpsPolicy {
  rule: DispatchRule;
  /** Laden and ballast speed, knots. */
  speed: number;
  /** Skip cargoes earning less than this, $/day (wait a few days for better). */
  minTce: number;
  /** Days to wait before looking again when nothing is acceptable. */
  waitDays: number;
  /** Bunker price, $/t (default: the history's for each month). */
  bunker?: number;
  /** Extra waiting at Qingdao, days per call. */
  congestion?: number;
}

export const DEFAULT_POLICY: OpsPolicy = { rule: 'bestTce', speed: 12, minTce: 0, waitDays: 3 };

export interface Fixture {
  cargo: CargoOffer;
  ballastNm: number;
  ballastDays: number;
  /** Day she starts sailing to the loading port, arrives, starts loading, and finishes discharging. */
  depart: number;
  arrive: number;
  load: number;
  end: number;
  fuel: number;
  /** Freight less commissions, fuel, ports and canals, $. */
  net: number;
  /** Net over the days from departure to discharge, $/day. */
  tce: number;
}

export interface ShipRun {
  ship: CompanyShip;
  fixtures: Fixture[];
  /** Days with nothing to do. */
  idle: number;
  /** Net voyage result over the period, $. */
  net: number;
  /** Where and when she ends. */
  at: string;
  freeDay: number;
}

export interface OpsResult {
  runs: ShipRun[];
  unfilled: CargoOffer[];
  /** Voyage results less the ships' daily costs over the period, $. */
  profit: number;
  voyageNet: number;
  dailyCosts: number;
  /** What the same ships would have earned at the market index, less the same costs, $. */
  benchmark: number;
  days: number;
}

function bunkerAt(p: OpsPolicy, hist: History, start: number, day: number): number {
  return p.bunker ?? hist.bunker[Math.min(hist.months - 1, start + Math.floor(day / MONTH))];
}

/** Plan one fixture for a ship free at `at` on `day`, or null if she can't make the window. */
export function planFixture(s: CompanyShip, at: string, day: number, c: CargoOffer, p: OpsPolicy, hist: History, start: number): Fixture | null {
  const cls = MARKET_CLASSES[s.cls];
  const v = cls.vessel;
  const closed = eventAt(start + Math.floor(day / MONTH))?.closed;
  const ballastNm = at === c.route.from ? 0 : seaDistance(at, c.route.from, { draft: ballastDraft(v), closed });
  const ballastDays = ballastNm / (24 * p.speed);
  const arrive = day + ballastDays;
  if (arrive > c.to + 1e-9 || !Number.isFinite(ballastNm)) return null;
  const load = Math.max(arrive, c.from);
  const ladenNm = seaDistance(c.route.from, c.route.to, { draft: ladenDraft(v, c.tonnes), closed });
  if (!Number.isFinite(ladenNm) || !Number.isFinite(c.freight)) return null;
  const qin = c.route.to === 'QIN' || c.route.from === 'QIN' ? (p.congestion ?? 0) : 0;
  const ev = eventAt(start + Math.floor(day / MONTH));
  const evWait = (ev?.congestion?.[c.route.from] ?? 0) + (ev?.congestion?.[c.route.to] ?? 0);
  const portDays = c.route.portDays + qin + evWait;
  const ladenDays = ladenNm / (24 * p.speed);
  const canal = ladenNm > 0 && c.route.id === 'P-NOL-QIN' && !closed?.includes('panama') ? cls.canalTolls.panama : 0;
  const bunker = bunkerAt(p, hist, start, day);
  const fuel = ballastDays * fuelPerDay(v, p.speed, ballastDraft(v)) + ladenDays * fuelPerDay(v, p.speed, ladenDraft(v, c.tonnes)) + (portDays + (load - arrive)) * AUX_PORT_TPD;
  const net = c.freight * c.tonnes * (1 - COMMISSION) - fuel * bunker - cls.portCosts - canal;
  const end = load + portDays + ladenDays;
  return { cargo: c, ballastNm, ballastDays, depart: day, arrive, load, end, fuel, net, tce: net / (end - day) };
}

/**
 * Run the desk: whenever a ship is free, she takes the best cargo she can still reach by the rule;
 * if none clears the minimum, she waits and looks again. Cargoes go to whichever ship gets to them
 * first. The period ends at `weeks` × 7 days; voyages that finish later count in full.
 */
export function operate(ships: CompanyShip[], offers: CargoOffer[], p: OpsPolicy, f: CompanyFinance, world: CargoWorld, hist: History = standardHistory()): OpsResult {
  const days = world.weeks * WEEK;
  const state = ships.map((s) => ({ ship: s, at: s.at, free: s.openDay, fixtures: [] as Fixture[], idle: s.openDay }));
  const taken = new Set<string>();
  let guard = 0;
  while (guard++ < 2000) {
    const next = state.filter((x) => x.free < days).sort((a, b) => a.free - b.free)[0];
    if (!next) break;
    const options: Fixture[] = [];
    for (const c of offers) {
      if (taken.has(c.id) || c.cls !== next.ship.cls || c.to < next.free || c.from > next.free + 45) continue;
      const fx = planFixture(next.ship, next.at, next.free, c, p, hist, world.start);
      if (fx) options.push(fx);
    }
    const ok = options.filter((o) => o.tce >= p.minTce);
    if (!ok.length) {
      const wait = Math.min(p.waitDays, days - next.free);
      next.idle += wait;
      next.free += Math.max(0.5, wait);
      continue;
    }
    const pick =
      p.rule === 'nearest'
        ? ok.reduce((a, b) => (b.ballastNm < a.ballastNm || (b.ballastNm === a.ballastNm && b.tce > a.tce) ? b : a))
        : p.rule === 'bestFreight'
          ? ok.reduce((a, b) => (b.cargo.freight > a.cargo.freight ? b : a))
          : ok.reduce((a, b) => (b.tce > a.tce ? b : a));
    taken.add(pick.cargo.id);
    next.fixtures.push(pick);
    next.idle += pick.load - pick.arrive; // waiting for the window to open
    next.at = pick.cargo.route.to;
    next.free = pick.end;
  }
  const runs: ShipRun[] = state.map((x) => ({ ship: x.ship, fixtures: x.fixtures, idle: x.idle, net: x.fixtures.reduce((a, fx) => a + fx.net, 0), at: x.at, freeDay: x.free }));
  const voyageNet = runs.reduce((a, r) => a + r.net, 0);
  // Daily costs run over each ship's busy span (at least the period).
  const dailyCosts = runs.reduce((a, r) => {
    const c = shipCost(r.ship, f);
    const span = Math.max(days, r.freeDay);
    return a + (c.opex + c.debtService + c.hire) * span;
  }, 0);
  const benchmark = runs.reduce((a, r) => {
    const c = shipCost(r.ship, f);
    const span = Math.max(days, r.freeDay);
    let earn = 0;
    for (let d = 0; d < span; d += MONTH) {
      const t = Math.min(hist.months - 1, world.start + Math.floor(d / MONTH));
      earn += hist.cls[r.ship.cls][t].tce * Math.min(MONTH, span - d) * EARN;
    }
    return a + earn - (c.opex + c.debtService + c.hire) * span;
  }, 0);
  const unfilled = offers.filter((o) => !taken.has(o.id));
  return { runs, unfilled, profit: voyageNet - dailyCosts, voyageNet, dailyCosts, benchmark, days };
}
