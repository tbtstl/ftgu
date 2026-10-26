// Kestrel is open in Qingdao. Stay in the Pacific on short coal voyages, ballast to Brazil for a
// soybean cargo, or wait a few days and decide then? Each choice is a schedule of voyages over the
// same horizon, each voyage fixed at the market of the month it starts in.
//
// The market prices the long ballast leg into Brazil's freight (Lessons 3.4 and 4.3), so on an
// average month the choices earn about the same. What differs is timing — a soybean cargo fixed
// at the height of the harvest pays that month's rate for the whole round trip — and flexibility:
// a ship that hasn't committed can take whichever turns out better.

import { gaussian, rng } from '../../model/random';
import type { Chokepoint } from '../../model/shipping/geo';
import { KESTREL } from '../../model/shipping/vessels';
import { MARKET_CLASSES } from '../../model/shipping/trades';
import { equilibrium, type Equilibrium } from './market';
import { seaDistance } from './network';
import { COMMISSION, ballastDraft, ladenDraft, voyageEstimate } from './voyage';

export interface AllocationSetup {
  /** Calendar month now, 0–11. */
  month: number;
  bunker: number;
  /** Strength of Brazil's soybean exports (multiplier on the Santos–Qingdao trade). */
  soy: number;
  congestion?: Record<string, number>;
  closed?: Chokepoint[];
  /** Kestrel's speed, laden and in ballast, knots. */
  speed: number;
  /** Days over which the choices are compared. */
  horizon: number;
}

const MONTH = 365 / 12;
const PACIFIC = 'P-SAM-QIN';
const ATLANTIC = 'P-SAN-QIN';

/** The market for the next few months under the setup's conditions (expected, no surprises). */
export function marketMonths(s: AllocationSetup, n = 7): Equilibrium[] {
  return Array.from({ length: n }, (_, k) =>
    equilibrium('kmax', { month: (s.month + k) % 12, bunker: s.bunker, routeScale: { [ATLANTIC]: s.soy }, congestion: s.congestion, closed: s.closed }),
  );
}

/** A route's freight fixed at month k, with the market's earnings scaled by `shock`. */
export function freightAt(eqs: Equilibrium[], k: number, routeId: string, shock = 1): number {
  const eq = eqs[Math.min(eqs.length - 1, Math.max(0, k))];
  const q = eq.routes.find((r) => r.route.id === routeId)!;
  // How freight moves with the market's earnings: the voyage's days, and the ballast miles it pays for.
  const perDay = q.ladenDays + q.portDays + q.canalDays + (q.positional * 1) / (24 * eq.ballastSpeed);
  return q.freight + ((shock - 1) * eq.tce * perDay) / (MARKET_CLASSES.kmax.cargo * (1 - COMMISSION));
}

export interface Leg {
  kind: 'ballast' | 'voyage' | 'wait';
  route?: string;
  start: number;
  days: number;
  /** Net freight after voyage costs, $. */
  net: number;
  freight?: number;
}

function kestrelVoyage(s: AllocationSetup, from: string, routeId: string, freight: number) {
  const cls = MARKET_CLASSES.kmax;
  const route = equilibrium('kmax', {}).routes.find((r) => r.route.id === routeId)!.route;
  const ballastNm = from === route.from ? 0 : seaDistance(from, route.from, { draft: ballastDraft(KESTREL), closed: s.closed });
  const ladenNm = seaDistance(route.from, route.to, { draft: ladenDraft(KESTREL, cls.cargo), closed: s.closed });
  const portDays = route.portDays + (s.congestion?.[route.from] ?? 0) + (s.congestion?.[route.to] ?? 0);
  return voyageEstimate(KESTREL, { ballastNm, ladenNm, cargo: cls.cargo, freight, portDays, portCosts: cls.portCosts, bunkerPrice: s.bunker, ladenSpeed: s.speed, ballastSpeed: s.speed });
}

/** Back-to-back Pacific coal voyages from day `t0` until the horizon, the last one pro rata. */
function pacificFrom(s: AllocationSetup, eqs: Equilibrium[], t0: number, shocks: number[], legs: Leg[]): number {
  let t = t0;
  let total = 0;
  while (t < s.horizon - 1e-9) {
    const k = Math.floor(t / MONTH);
    const f = freightAt(eqs, k, PACIFIC, shocks[k] ?? 1);
    const v = kestrelVoyage(s, 'QIN', PACIFIC, f);
    const share = Math.min(1, (s.horizon - t) / v.days);
    legs.push({ kind: 'voyage', route: PACIFIC, start: t, days: v.days * share, net: v.net * share, freight: f });
    total += v.net * share;
    t += v.days;
  }
  return total;
}

export interface Plan {
  legs: Leg[];
  total: number;
  /** Average earnings over the horizon, $/day. */
  tce: number;
}

/** Stay in the Pacific. */
export function stayPlan(s: AllocationSetup, eqs: Equilibrium[], shocks: number[] = []): Plan {
  const legs: Leg[] = [];
  const total = pacificFrom(s, eqs, 0, shocks, legs);
  return { legs, total, tce: total / s.horizon };
}

/** Ballast to Santos, fix a soybean cargo on arrival, sail to Qingdao, then stay in the Pacific. */
export function repositionPlan(s: AllocationSetup, eqs: Equilibrium[], shocks: number[] = [], startDay = 0): Plan {
  const legs: Leg[] = [];
  const ballastNm = seaDistance('QIN', 'SAN', { draft: ballastDraft(KESTREL), closed: s.closed });
  const ballastDays = ballastNm / (24 * s.speed);
  const k = Math.floor((startDay + ballastDays) / MONTH);
  const f = freightAt(eqs, k, ATLANTIC, shocks[k] ?? 1);
  const v = kestrelVoyage(s, 'QIN', ATLANTIC, f);
  const end = startDay + v.days;
  const share = Math.min(1, (s.horizon - startDay) / v.days);
  legs.push({ kind: 'ballast', start: startDay, days: v.ballastDays * share, net: 0 });
  legs.push({ kind: 'voyage', route: ATLANTIC, start: startDay + v.ballastDays, days: (v.days - v.ballastDays) * share, net: v.net * share, freight: f });
  let total = v.net * share;
  if (end < s.horizon) total += pacificFrom(s, eqs, end, shocks, legs);
  return { legs, total, tce: total / s.horizon };
}

/** Monthly multipliers on the market's earnings: a random walk with `vol` per month (month 0 known). */
export function scenarios(n: number, months: number, vol: number, seed: number): number[][] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const out = [1];
    let x = 0;
    for (let k = 1; k < months; k++) {
      x += vol * gaussian(r) - (vol * vol) / 2;
      out.push(Math.exp(x));
    }
    return out;
  });
}

export interface ChoiceSummary {
  stay: number[];
  reposition: number[];
  /** Waiting `waitDays`, seeing the next month's market, then taking the better of the two. */
  wait: number[];
  mean: { stay: number; reposition: number; wait: number };
}

/**
 * Average earnings ($/day over the horizon) of each choice across market scenarios. The waiting
 * choice spends `waitDays` idle (burning port fuel) and then picks whichever choice is better
 * given the month-1 market it has now seen.
 */
export function compareChoices(s: AllocationSetup, eqs: Equilibrium[], vol: number, waitDays: number, n = 200, seed = 5): ChoiceSummary {
  const sc = scenarios(n, eqs.length, vol, seed);
  const stay: number[] = [];
  const reposition: number[] = [];
  const wait: number[] = [];
  const idleCost = waitDays * 3 * s.bunker; // auxiliary fuel at anchor
  for (const shocks of sc) {
    stay.push(stayPlan(s, eqs, shocks).tce);
    reposition.push(repositionPlan(s, eqs, shocks).tce);
    // After waiting, the next month's market is known; later months are expected to stay at that level.
    const seen = shocks.map((_, k) => (k === 0 ? 1 : shocks[1]));
    const later = { ...s, horizon: s.horizon };
    const a = stayPlanFrom(later, eqs, seen, waitDays);
    const b = repositionPlan(later, eqs, seen, waitDays).total;
    // Judge with what's known, then earn what actually happens.
    const pickReposition = b > a;
    const realized = pickReposition ? repositionPlan(later, eqs, shocks, waitDays).total : stayPlanFrom(later, eqs, shocks, waitDays);
    wait.push((realized - idleCost) / s.horizon);
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return { stay, reposition, wait, mean: { stay: avg(stay), reposition: avg(reposition), wait: avg(wait) } };
}

function stayPlanFrom(s: AllocationSetup, eqs: Equilibrium[], shocks: number[], start: number): number {
  return pacificFrom(s, eqs, start, shocks, []);
}
