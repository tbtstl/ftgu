// The Chapter 8 challenges as pure functions of the reader's grid, so the lessons and the tests
// judge them the same way.

import type { NodalHour } from '../../engines/market/nodalday';
import { LOAD_KINDS, defaultDesign, nodeLoad, shiftHomesToOffices, type CapstoneDesign, type WeatherId } from './capstone';
import { argmax, checkDesign, emissions, nodeDemand, newCapital, runMarket, systemDemand, systemOf, type DesignChecks, type MarketRun } from './system';

// ---------------------------------------------------------------------------
// 8.1: a data-center campus at Tech Park.

export const CAMPUS_MW = 250;
export const CAMPUS_BUDGET = 400e6;

export interface CampusCheck {
  solved: boolean;
  techBuilt: boolean;
  techLoad: number;
  /** Capital spent on anything new since the starting design; removals save nothing. */
  added: number;
  /** Starting substations that are gone or serve fewer customers than at the start. */
  cut: string[];
  checks: DesignChecks;
}

/**
 * The campus has to be added on top of the starting region: every starting substation still
 * built and serving at least its starting customers, all three checks passing, and no more than
 * the budget spent on new things (taking plants or lines away doesn't pay for the campus).
 */
export function campusCheck(d: CapstoneDesign): CampusCheck {
  const s = defaultDesign();
  const checks = checkDesign(d);
  const techBuilt = d.nodes.includes('tech');
  const techLoad = techBuilt ? nodeLoad(d, 'tech') : 0;
  const cut = s.nodes.filter((n) => !d.nodes.includes(n) || LOAD_KINDS.some((k) => (d.loads[n]?.[k] ?? 0) < s.loads[n][k] - 0.5));
  const added = newCapital(d);
  return { solved: techBuilt && techLoad >= CAMPUS_MW && cut.length === 0 && checks.ok && added <= CAMPUS_BUDGET, techBuilt, techLoad, added, cut, checks };
}

// ---------------------------------------------------------------------------
// 8.2: how much of the region's household demand must behave like offices for a midday peak.

export const PEAK_BEFORE = 14;
export const SHIFT_STEP = 0.05;

/** The region's peak hour on a typical day with a share of household demand turned into office demand. */
export function shiftedPeakHour(d: CapstoneDesign, share: number): number {
  return argmax(systemDemand(nodeDemand(shiftHomesToOffices(d, share), 'typical')));
}

/** Solved at the smallest share, in 5% steps, that brings the typical day's peak before 14:00. */
export function peakShiftSolved(d: CapstoneDesign, share: number): boolean {
  if (!d.nodes.length || shiftedPeakHour(d, share) >= PEAK_BEFORE) return false;
  return share < SHIFT_STEP / 2 || shiftedPeakHour(d, share - SHIFT_STEP) >= PEAK_BEFORE;
}

// ---------------------------------------------------------------------------
// 8.3: the outage behind a price separation.

/** MW injected at each node in an hour of a market run (plants minus the demand served). */
export function hourInjections(run: MarketRun, h: number): Record<string, number> {
  const hr = run.hours[h];
  const inj: Record<string, number> = {};
  for (const n of run.sys.net.nodes) inj[n.id] = -(hr.netLoad[n.id] ?? 0) + (hr.shed[n.id] ?? 0);
  for (const u of run.units) inj[u.node] = (inj[u.node] ?? 0) + (hr.dispatch[u.id] ?? 0);
  return inj;
}

function spread(hr: NodalHour): number {
  const ps = Object.values(hr.lmp);
  return ps.length ? Math.max(...ps) - Math.min(...ps) : 0;
}

/**
 * The hour to ask about: the widest price separation caused only by an outage the dispatch guards
 * against (no line at its rating), else the widest with any such guard, else none.
 */
export function guardedHour(run: MarketRun): number | null {
  const pick = (ok: (h: NodalHour) => boolean) => {
    const hs = run.hours.filter((h) => ok(h) && spread(h) > 0.5 && h.bindingContingencies.length > 0);
    return hs.length ? hs.reduce((a, b) => (spread(b) > spread(a) + 1e-9 ? b : a)).hour : null;
  };
  return pick((h) => h.binding.length === 0) ?? pick(() => true);
}

/** Solved when the tripped line is one whose loss the dispatch is guarding against in an hour of separated prices. */
export function outageFound(hr: NodalHour, trip: string | null | undefined): boolean {
  return !!trip && spread(hr) > 0.5 && hr.bindingContingencies.some((b) => b.outage === trip);
}

// ---------------------------------------------------------------------------
// 8.4: the smallest wind farm, at a site of the reader's choosing, that halves emissions alone.

export const WIND_STEP = 50;
export const WIND_MAX = 1000;

export interface Siting {
  before: MarketRun;
  after: MarketRun;
  /** Share of the day's emissions the wind farm avoids. */
  cut: number;
  ok: boolean;
}

/** The reader's grid on a day with nothing added but one wind farm. */
export function windAlone(d: CapstoneDesign, day: WeatherId, node: string, mw: number): CapstoneDesign {
  return { ...d, weather: day, transition: { ...d.transition, windMW: mw, windNode: node, solarMW: 0, storageMW: 0 } };
}

export function siting(d: CapstoneDesign, day: WeatherId, node: string, mw: number): Siting {
  const before = runMarket(systemOf({ ...d, weather: day }, 'base'));
  const after = runMarket(systemOf(windAlone(d, day, node, mw), 'transition'));
  const e0 = emissions(before);
  const cut = e0 > 0 ? 1 - emissions(after) / e0 : 0;
  const ok = e0 > 0 && cut >= 0.5 - 1e-9 && after.summary.congestedHours <= before.summary.congestedHours && after.summary.unservedMWh <= 0.5;
  return { before, after, cut, ok };
}

/** Solved when the wind farm halves emissions without adding congestion, and one 50 MW step less doesn't. */
export function sitingSolved(d: CapstoneDesign, day: WeatherId, node: string, mw: number): boolean {
  if (mw < WIND_STEP || !d.nodes.includes(node) || !siting(d, day, node, mw).ok) return false;
  return !siting(d, day, node, mw - WIND_STEP).ok;
}
