// The shipping cycle: a fleet that takes years to change, chasing demand that changes every month.
//
// Each month the freight market clears (market.ts) on that month's cargo volumes and fleet. Owners
// then look at what a new ship would be worth — the present value of the earnings they expect,
// net of operating costs, plus her scrap value — against what a shipyard charges to build one. When
// ships are worth more than they cost to build, they order; the ships arrive `lag` months later.
// When earnings are poor, the oldest ships go for scrap. Expectations lean on recent earnings, so
// orders bunch up at the top of the market and deliveries arrive into the bottom.

import type { Chokepoint } from '../../model/shipping/geo';
import { gaussian, rng } from '../../model/random';
import { BASE_BUNKER, MARKET_CLASSES, OFF_HIRE_DAYS, type ClassId } from '../../model/shipping/trades';
import { NEWBUILD_PRICE, OPEX, opexTotal, SCRAP_PER_LDT } from './economics';
import { equilibrium } from './market';

export interface CycleEvent {
  from: number;
  to: number;
  label: string;
  closed?: Chokepoint[];
  congestion?: Record<string, number>;
  /** Multiplier on cargo volumes while the event lasts. */
  demand?: number;
  /** Multipliers on particular routes. */
  routeScale?: Record<string, number>;
}

export interface CycleParams {
  months: number;
  seed: number;
  /** Annual growth of cargo volumes. */
  growth: number;
  /** Size of monthly demand shocks (standard deviation of the long-run log deviation). */
  shock: number;
  /** Month-to-month persistence of demand shocks, 0–1. */
  persistence: number;
  /** Ships ordered each month, as a share of the fleet, per unit that a ship's value exceeds its price. */
  orderResponse: number;
  /** Months from order to delivery. */
  lag: number;
  /** Extra share of ships 18 years and older scrapped each month when earnings are below their running cost. */
  scrapResponse: number;
  /** Weight on the last year's earnings in owners' expectations (the rest on long-run earnings). */
  memory: number;
  /** Bunker price path, $/t, by month (or a constant). */
  bunker?: number | number[];
  /** Apply the trades' seasons. */
  seasonal?: boolean;
  events?: CycleEvent[];
  /** Fleet at the start as a multiple of the class baseline. */
  startFleet?: number;
  /** Orderbook at the start as a share of the fleet. */
  startOrderbook?: number;
}

export const DEFAULT_CYCLE: CycleParams = {
  months: 180,
  seed: 7,
  growth: 0.025,
  shock: 0.07,
  persistence: 0.94,
  orderResponse: 0.05,
  lag: 30,
  scrapResponse: 0.02,
  memory: 0.75,
  seasonal: true,
  startFleet: 1,
  startOrderbook: 0.08,
};

export interface CycleMonth {
  t: number;
  /** Calendar month 0–11 and model year 1, 2, … */
  month: number;
  year: number;
  tce: number;
  fleet: number;
  orderbook: number;
  orders: number;
  deliveries: number;
  scrapped: number;
  demand: number;
  ladenSpeed: number;
  idle: number;
  bunker: number;
  /** Newbuilding price and a five-year-old ship's value, $ million. */
  newbuild: number;
  secondhand: number;
  /** Value of a new ship over its newbuilding price. */
  q: number;
  event?: string;
  /** Freight per tonne on each of the class's routes, $. */
  freights: Record<string, number>;
  /** Cost of a ballast mile and the regions' positional values (nm), for trip earnings. */
  ballastMileCost: number;
  open: Record<string, number>;
  ready: Record<string, number>;
  /** Ships by age in whole years, 0–27. */
  ages: number[];
  /** Ships on order by the year they deliver: within 12 months, 12–24, 24–36, 36–48. */
  bookByYear: number[];
}

const LIFE = 25;
const RATE = 0.08;
const REVERT = 0.7; // yearly decay of expected earnings back toward the long run
const EARN_DAYS = 365 - OFF_HIRE_DAYS;
const BANDS = [5, 10, 15, 20, Infinity];

export function classOpex(id: ClassId): number {
  return opexTotal(OPEX[MARKET_CLASSES[id].vessel.id]);
}

export function classScrapValue(id: ClassId): number {
  return MARKET_CLASSES[id].vessel.lightship * SCRAP_PER_LDT;
}

/**
 * Value of a ship of an age, $: expected earnings net of opex over her remaining life, plus scrap.
 * Older ships earn a little less (worse fuel economy, 0.8% a year of age) and cost more to run
 * (2.5% a year of age): the ageing of Lesson 2.4, slightly simplified (its fuel penalty is 1% a year).
 */
export function shipValue(id: ClassId, age: number, expected: number, longRun: number): number {
  const years = Math.max(0, Math.round(LIFE - age));
  let v = 0;
  for (let y = 0; y < years; y++) {
    const a = age + y;
    const h = (longRun + (expected - longRun) * REVERT ** y) * (1 - 0.008 * a);
    const opex = classOpex(id) * (1 + 0.025 * a);
    v += ((h - opex) * EARN_DAYS) / (1 + RATE) ** (y + 0.5);
  }
  return Math.max(classScrapValue(id), v + classScrapValue(id) / (1 + RATE) ** years);
}

const REPLACEMENT = new Map<ClassId, number>();

/** The earnings at which a new ship is worth exactly its baseline newbuilding price (memoized). */
export function replacementEarnings(id: ClassId): number {
  const hit = REPLACEMENT.get(id);
  if (hit !== undefined) return hit;
  const v = solveReplacement(id);
  REPLACEMENT.set(id, v);
  return v;
}

function solveReplacement(id: ClassId): number {
  const nb = NEWBUILD_PRICE[MARKET_CLASSES[id].vessel.id] * 1e6;
  let lo = 0;
  let hi = 200_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (shipValue(id, 0, mid, mid) < nb) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface Cohort {
  built: number; // month index (negative for ships built before the start)
  count: number;
}

function ageProfile(cohorts: Cohort[], t: number): number[] {
  const ages = Array<number>(28).fill(0);
  for (const c of cohorts) {
    const a = Math.floor((t - c.built) / 12);
    if (a >= 0 && a < 28) ages[a] += c.count;
  }
  return ages;
}

export function simulateCycle(id: ClassId, p: CycleParams): CycleMonth[] {
  const cls = MARKET_CLASSES[id];
  const r = rng(p.seed);
  const nb0 = NEWBUILD_PRICE[cls.vessel.id] * 1e6;
  const longRun = replacementEarnings(id);
  const scrapLine = classOpex(id) + 2_000;
  const fleet0 = cls.fleet * (p.startFleet ?? 1);
  // Starting age structure from the class's age bands.
  const cohorts: Cohort[] = [];
  const bandYears = [5, 5, 5, 5, 6];
  cls.cohorts.forEach((k, b) => {
    for (let y = 0; y < bandYears[b]; y++) {
      const age = b * 5 + y;
      cohorts.push({ built: -12 * age - 6, count: (fleet0 * k.share) / bandYears[b] });
    }
  });
  const pipeline = Array<number>(p.months + p.lag + 1).fill(0);
  const startBook = fleet0 * (p.startOrderbook ?? 0);
  for (let m = 0; m < p.lag; m++) pipeline[m] = startBook / p.lag;
  const out: CycleMonth[] = [];
  const innov = p.shock * Math.sqrt(1 - p.persistence * p.persistence);
  let x = 0;
  const recent: number[] = [];
  let nb = nb0;
  for (let t = 0; t < p.months; t++) {
    const month = t % 12;
    // Deliveries.
    const deliveries = pipeline[t];
    if (deliveries > 0) cohorts.push({ built: t, count: deliveries });
    // Scrapping: everything reaching 28 years, plus old ships when earnings are poor.
    const avg6 = recent.length ? recent.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, recent.length) : longRun;
    const extra = p.scrapResponse * Math.max(0, Math.min(1, (scrapLine - avg6) / scrapLine)) * 4;
    let scrapped = 0;
    for (const c of cohorts) {
      const age = (t - c.built) / 12;
      if (age >= 28) {
        scrapped += c.count;
        c.count = 0;
      } else if (age >= 18) {
        const k = Math.min(1, 0.002 + extra);
        scrapped += c.count * k;
        c.count *= 1 - k;
      }
    }
    const fleet = cohorts.reduce((s, c) => s + c.count, 0);
    // Age-band shares for the market.
    const shares = BANDS.map(() => 0);
    for (const c of cohorts) {
      const age = (t - c.built) / 12;
      const b = BANDS.findIndex((u) => age < u);
      shares[b] += c.count / fleet;
    }
    // Demand.
    x = p.persistence * x + innov * gaussian(r);
    const ev = p.events?.find((e) => t >= e.from && t < e.to);
    const demand = (1 + p.growth) ** (t / 12) * Math.exp(x) * (ev?.demand ?? 1);
    const bunker = Array.isArray(p.bunker) ? (p.bunker[t] ?? p.bunker[p.bunker.length - 1]) : (p.bunker ?? BASE_BUNKER);
    const eq = equilibrium(id, {
      demand,
      month: p.seasonal ? month : undefined,
      fleet,
      bunker,
      closed: ev?.closed,
      congestion: ev?.congestion,
      routeScale: ev?.routeScale,
      cohortShares: shares,
    });
    recent.push(eq.tce);
    const avg12 = recent.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, recent.length);
    const expected = p.memory * avg12 + (1 - p.memory) * longRun;
    // Shipyards charge more when their order books are full.
    const book = pipeline.slice(t + 1).reduce((a, b) => a + b, 0);
    const target = nb0 * Math.min(1.5, Math.max(0.7, 0.85 + 1.5 * (book / fleet - 0.1)));
    nb = nb + 0.15 * (target - nb);
    const value = shipValue(id, 0, expected, longRun);
    const q = value / nb;
    const orders = Math.max(0, fleet * p.orderResponse * (q - 1));
    if (t + p.lag < pipeline.length) pipeline[t + p.lag] += orders;
    out.push({
      t,
      month,
      year: Math.floor(t / 12) + 1,
      tce: eq.tce,
      fleet,
      orderbook: book + orders,
      orders,
      deliveries,
      scrapped,
      demand,
      ladenSpeed: eq.ladenSpeed,
      idle: eq.idleShips,
      bunker,
      newbuild: nb / 1e6,
      secondhand: shipValue(id, 5, expected, longRun) / 1e6,
      q,
      event: ev?.label,
      freights: Object.fromEntries(eq.routes.map((rq) => [rq.route.id, rq.freight])),
      ages: ageProfile(cohorts, t),
      bookByYear: [0, 1, 2, 3].map((k) => pipeline.slice(t + 1 + 12 * k, t + 13 + 12 * k).reduce((a, b) => a + b, 0)),
      ballastMileCost: eq.ballastMileCost,
      open: eq.plan.open,
      ready: eq.plan.ready,
    });
  }
  return out;
}
