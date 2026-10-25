// The strategy tournament: the company's fleet run month by month through a history under one
// commercial strategy at a time, with the world's physical drivers as dials. Each strategy is one
// already taught: trading spot (4.1), chartering out or in on the forward strip (4.2, 5.3),
// repositioning Kamsarmaxes for the harvest (5.4), and selling FFAs against the fleet's days (4.5).

import type { History } from '../../model/shipping/history';
import { eventAt } from '../../model/shipping/history';
import { OFF_HIRE_DAYS, type ClassId } from '../../model/shipping/trades';
import { summarize, maxDrawdown, type PnlSummary } from '../strategy/risk';
import { marketMonths, repositionPlan, stayPlan } from './allocation';
import { shipCost, type CompanyFinance, type CompanyShip } from './company';
import { replacementEarnings } from './cycle';
import { equilibrium } from './market';
import { DAYS_PER_MONTH, monthAverage } from './indices';
import { dailyIndex, forwardPrice } from './ffa';
import { forecastPath, DEFAULT_ASSUMPTIONS } from './forecast';
import { whatIf, type Drivers } from './strategies';

export type StrategyKey = 'spot' | 'charterOut' | 'charterIn' | 'reposition' | 'hedge';

export const STRATEGY_LABELS: Record<StrategyKey, string> = {
  spot: 'All spot',
  charterOut: 'Charter out for a year',
  charterIn: 'Charter in when hire is cheap',
  reposition: 'Reposition for the harvest',
  hedge: 'Sell FFAs against the fleet',
};

export interface TournamentDrivers {
  /** Brazil's soybean exports (multiplier). */
  soy: number;
  /** Brazil's iron-ore exports (multiplier). */
  ore: number;
  panama: boolean;
  /** Extra waiting at Qingdao, days per call. */
  congestion: number;
  /** Extra ships delivered, as a multiplier on both fleets. */
  fleet: number;
}

export const NEUTRAL_DRIVERS: TournamentDrivers = { soy: 1, ore: 1, panama: false, congestion: 0, fleet: 1 };

export interface TournamentOptions {
  from: number;
  to: number;
  /** Share of the fleet's days sold forward each month (hedge). */
  hedgeShare: number;
  /** Kamsarmaxes chartered in when the forecast beats the hire (charter in). */
  extraShips: number;
}

export const DEFAULT_TOURNAMENT: TournamentOptions = { from: 0, to: 144, hedgeShare: 0.5, extraShips: 2 };

const MONTH = 365 / 12;
const EARN = (365 - OFF_HIRE_DAYS) / 365;

function toDrivers(d: TournamentDrivers): Drivers {
  return {
    fleet: d.fleet,
    closed: d.panama ? ['panama'] : undefined,
    congestion: d.congestion ? { QIN: d.congestion } : undefined,
    routeScale: { 'P-SAN-QIN': d.soy, 'C-TUB-QIN': d.ore, 'C-TUB-ROT': d.ore },
  };
}

const PATH_CACHE = new WeakMap<History, Map<string, Record<ClassId, number[]>>>();

/** Each month's market earnings for both classes with the drivers applied, $/day. */
export function drivenEarnings(hist: History, d: TournamentDrivers): Record<ClassId, number[]> {
  const key = JSON.stringify(d);
  let byHist = PATH_CACHE.get(hist);
  if (!byHist) {
    byHist = new Map();
    PATH_CACHE.set(hist, byHist);
  }
  const hit = byHist.get(key);
  if (hit) return hit;
  const neutral = JSON.stringify(d) === JSON.stringify(NEUTRAL_DRIVERS);
  const out = {
    kmax: hist.cls.kmax.map((m, t) => (neutral ? m.tce : whatIf('kmax', m, toDrivers(d), eventAt(t, hist.events)))),
    cape: hist.cls.cape.map((m, t) => (neutral ? m.tce : whatIf('cape', m, toDrivers(d), eventAt(t, hist.events)))),
  };
  byHist.set(key, out);
  return out;
}

/**
 * The twelve-month period hire on offer at the start of month `t`: what the market expects for the
 * year from the fundamentals it can see (fleet, orderbook, cargo trend — Lesson 5.1), on the index.
 */
export function periodHire(cls: ClassId, hist: History, t: number): number {
  const idx = dailyIndex(cls, undefined, hist.cls[cls]);
  const fc = forecastPath(cls, hist.cls[cls], t, 12, DEFAULT_ASSUMPTIONS);
  const forecast = fc.reduce((a, x) => a + x.tce, 0) / fc.length;
  const indexScale = monthAverage(idx, t) / Math.max(1, hist.cls[cls][t].tce);
  return forecast * indexScale;
}

export interface TournamentResult {
  strategy: StrategyKey;
  monthly: number[];
  total: number;
  summary: PnlSummary;
  /** Worst rolling 12 months, $. */
  worstYear: number;
  maxDrawdown: number;
}

/** The owned ships' daily cash costs: operating costs and loan payments, $. */
function ownedDailyCost(ships: CompanyShip[], f: CompanyFinance): number {
  return ships.reduce((a, s) => {
    if (s.mode !== 'owned') return a;
    const c = shipCost(s, f);
    return a + c.opex + c.debtService;
  }, 0);
}

/**
 * Run one strategy for the fleet over the history. The run is a what-if: the fleet trades through
 * the whole window on the terms it was given. Owned ships keep their price, loans and running
 * costs throughout; ships chartered in are rechartered every twelve months at that year's period
 * hire (a hire fixed in a slump can't be had for a boom).
 */
export function runStrategy(key: StrategyKey, ships: CompanyShip[], f: CompanyFinance, hist: History, d: TournamentDrivers, o: TournamentOptions): TournamentResult {
  const earn = drivenEarnings(hist, d);
  const base = { kmax: hist.cls.kmax.map((m) => m.tce), cape: hist.cls.cape.map((m) => m.tce) };
  const idx = { kmax: dailyIndex('kmax', undefined, hist.cls.kmax), cape: dailyIndex('cape', undefined, hist.cls.cape) };
  const ownedCost = ownedDailyCost(ships, f);
  const chartered = ships.filter((s) => s.mode === 'chartered');
  const to = Math.min(o.to, hist.months);
  const monthly: number[] = [];
  // Period hires, fixed at the start of each twelve-month block: what the market expects for the
  // year from the fundamentals it can see (fleet, orderbook, cargo trend — Lesson 5.1), on the index.
  const hireCache = new Map<string, number>();
  const hireFor = (cls: ClassId, t: number) => {
    const blockStart = t - ((t - o.from) % 12);
    const k = `${cls}|${blockStart}`;
    const hit = hireCache.get(k);
    if (hit !== undefined) return hit;
    const hire = periodHire(cls, hist, blockStart);
    hireCache.set(k, hire);
    return hire;
  };
  /** A Kamsarmax's long-run earnings over a year: what a new ship needs (Lesson 2.5). */
  const longRunYear = replacementEarnings('kmax');
  for (let t = o.from; t < to; t++) {
    let rev = 0;
    for (const s of ships) {
      const spot = earn[s.cls][t];
      if (key === 'charterOut' && s.mode === 'owned') rev += hireFor(s.cls, t) * EARN * MONTH;
      else rev += spot * EARN * MONTH;
    }
    let extra = 0;
    if (key === 'charterIn' && o.extraShips > 0) {
      // Charter in for the year when the period hire is cheap: below what a new ship needs to earn.
      const hire = hireFor('kmax', t);
      if (hire < longRunYear) extra = o.extraShips * (earn.kmax[t] - hire) * EARN * MONTH;
    }
    if (key === 'reposition' && t % 12 === 1) {
      // Each February, Kamsarmaxes weigh ballasting to Brazil against staying, on this year's market.
      const shocks = Array.from({ length: 7 }, (_, k) => {
        const m = Math.min(hist.months - 1, t + k);
        const baseline = equilibrium('kmax', { month: m % 12 }).tce;
        return earn.kmax[m] / baseline;
      });
      const setup = { month: 1, bunker: hist.bunker[t], soy: d.soy, speed: 12, horizon: 100, congestion: d.congestion ? { QIN: d.congestion } : undefined, closed: d.panama ? (['panama'] as Array<'panama'>) : undefined };
      const eqs = marketMonths(setup);
      const gain = repositionPlan(setup, eqs, shocks).total - stayPlan(setup, eqs, shocks).total;
      const kmaxShips = ships.filter((s) => s.cls === 'kmax').length;
      // A planner who saw this year's market would reposition only when it pays; we use the expected sign.
      const expectedGain = repositionPlan(setup, eqs).total - stayPlan(setup, eqs).total;
      if (expectedGain > 0) extra += gain * kmaxShips;
    }
    if (key === 'hedge' && t + 1 < to) {
      for (const cls of ['kmax', 'cape'] as ClassId[]) {
        const n = ships.filter((s) => s.cls === cls).length;
        if (!n) continue;
        const day = (t + 1) * DAYS_PER_MONTH - 1;
        const price = forwardPrice(cls, idx[cls], day, t + 1);
        const ratio = earn[cls][t + 1] / Math.max(1, base[cls][t + 1]);
        const settle = monthAverage(idx[cls], t + 1) * ratio;
        extra += (price - settle) * 30 * n * o.hedgeShare;
      }
    }
    const cost = ownedCost + chartered.reduce((a, s) => a + hireFor(s.cls, t), 0);
    monthly.push(rev + extra - cost * MONTH);
  }
  const summary = summarize(monthly, 12);
  let worstYear = Infinity;
  for (let i = 0; i + 12 <= monthly.length; i++) worstYear = Math.min(worstYear, monthly.slice(i, i + 12).reduce((a, b) => a + b, 0));
  return { strategy: key, monthly, total: summary.total, summary, worstYear: Number.isFinite(worstYear) ? worstYear : summary.total, maxDrawdown: maxDrawdown(monthly).drawdown };
}

export const STRATEGY_KEYS: StrategyKey[] = ['spot', 'charterOut', 'charterIn', 'reposition', 'hedge'];
