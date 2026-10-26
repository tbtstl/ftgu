// The reader's shipping company for Chapter 6, kept in this browser so each capstone lesson picks
// up where the last left it: the fleet and its financing (6.1), the cargo world it trades in (6.2),
// the operations desk's policy (6.3) and the physical dials of the tournament (6.5). Every lesson
// also works from the starting company: figures that reuse earlier lessons' parts can switch
// between the starting company (which the prose describes) and the reader's.

import { useSyncExternalStore } from 'react';
import { fmt } from '../../../framework/format';
import {
  DEFAULT_POLICY,
  DEFAULT_WORLD,
  shipPrice,
  type CargoWorld,
  type CompanyFinance,
  type CompanyShip,
  type DispatchRule,
  type OpsPolicy,
} from '../../../engines/shipping/company';
import { NEUTRAL_DRIVERS, type TournamentDrivers } from '../../../engines/shipping/tournament';
import { monthLabel, standardHistory } from '../../../model/shipping/history';
import { ROUTES, type ClassId } from '../../../model/shipping/trades';

export interface CompanyDesign {
  v: 1;
  ships: CompanyShip[];
  finance: CompanyFinance;
  world: CargoWorld;
  policy: OpsPolicy;
  drivers: TournamentDrivers;
}

/** Northwind's own money available for buying ships, $ (illustrative). */
export const EQUITY_BUDGET = 60e6;
export const MAX_SHIPS = 8;
export const DEFAULT_FINANCE: CompanyFinance = { ltv: 0.6, rate: 0.07, tenor: 12, equityReturn: 0.1 };
/** The month the company starts trading: Year 9, July — late in the long slump. */
export const START_MONTH = 102;
export const OPEN_PORTS = ['QIN', 'SIN', 'PAR', 'ROT'];

const BIRD_NAMES = ['Tern', 'Gannet', 'Skua', 'Fulmar', 'Puffin', 'Shearwater', 'Guillemot', 'Cormorant', 'Plover', 'Curlew'];

export function startingShips(start = START_MONTH): CompanyShip[] {
  const h = standardHistory();
  return [
    { id: 'kestrel', name: 'Kestrel', cls: 'kmax', age: 6, mode: 'owned', price: shipPrice('kmax', 6, h.cls.kmax, start), hire: 0, at: 'QIN', openDay: 0 },
    { id: 'albatross', name: 'Albatross', cls: 'cape', age: 8, mode: 'owned', price: shipPrice('cape', 8, h.cls.cape, start), hire: 0, at: 'QIN', openDay: 4 },
  ];
}

export function defaultDesign(): CompanyDesign {
  return {
    v: 1,
    ships: startingShips(),
    finance: { ...DEFAULT_FINANCE },
    world: { ...DEFAULT_WORLD, start: START_MONTH, routeScale: {} },
    policy: { ...DEFAULT_POLICY },
    drivers: { ...NEUTRAL_DRIVERS },
  };
}

/** A name not yet used in the fleet. */
export function nextName(ships: CompanyShip[]): string {
  return BIRD_NAMES.find((n) => !ships.some((s) => s.name === n)) ?? `Ship ${ships.length + 1}`;
}

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);

/** Accept only well-formed designs from storage; anything odd falls back to the default. */
export function sanitize(raw: unknown): CompanyDesign {
  const d = defaultDesign();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<CompanyDesign>;
  const ships = Array.isArray(r.ships)
    ? r.ships
        .filter((s) => s && typeof s.id === 'string' && (s.cls === 'kmax' || s.cls === 'cape') && (s.mode === 'owned' || s.mode === 'chartered'))
        .slice(0, MAX_SHIPS)
        .map((s) => ({
          id: s.id,
          name: typeof s.name === 'string' ? s.name.slice(0, 24) : 'Ship',
          cls: s.cls as ClassId,
          age: num(s.age, 0, 25, 10),
          mode: s.mode,
          price: num(s.price, 0, 200e6, 0),
          hire: num(s.hire, 0, 200_000, 0),
          at: typeof s.at === 'string' && OPEN_PORTS.includes(s.at) ? s.at : 'QIN',
          openDay: num(s.openDay, 0, 60, 0),
        }))
    : d.ships;
  const f = r.finance ?? d.finance;
  const w = r.world ?? d.world;
  const p = r.policy ?? d.policy;
  const dr = r.drivers ?? d.drivers;
  const rules: DispatchRule[] = ['bestTce', 'nearest', 'bestFreight'];
  const routeScale: Record<string, number> = {};
  for (const route of ROUTES) if (typeof w.routeScale?.[route.id] === 'number') routeScale[route.id] = num(w.routeScale[route.id], 0, 3, 1);
  return {
    v: 1,
    ships: ships.length ? ships : d.ships,
    finance: { ltv: num(f.ltv, 0, 0.8, 0.6), rate: num(f.rate, 0, 0.2, 0.07), tenor: num(f.tenor, 1, 25, 12), equityReturn: num(f.equityReturn, 0, 0.3, 0.1) },
    world: { start: num(w.start, 0, 117, START_MONTH), weeks: num(w.weeks, 4, 52, 26), reach: num(w.reach, 0.005, 0.1, 0.02), routeScale, seed: num(w.seed, 1, 999, 11) },
    policy: {
      rule: rules.includes(p.rule) ? p.rule : 'bestTce',
      speed: num(p.speed, 9, 15, 12),
      minTce: num(p.minTce, 0, 60_000, 0),
      waitDays: num(p.waitDays, 1, 14, 3),
      bunker: p.bunker === undefined ? undefined : num(p.bunker, 200, 1200, 600),
      congestion: num(p.congestion, 0, 10, 0),
    },
    drivers: {
      soy: num(dr.soy, 0.3, 1.7, 1),
      ore: num(dr.ore, 0.3, 1.7, 1),
      panama: !!dr.panama,
      congestion: num(dr.congestion, 0, 10, 0),
      fleet: num(dr.fleet, 0.8, 1.2, 1),
    },
  };
}

const KEY = 'groundup.shipping.company.v1';
let cache: CompanyDesign | null = null;
const listeners = new Set<() => void>();

function read(): CompanyDesign {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : defaultDesign();
  } catch {
    cache = defaultDesign();
  }
  return cache;
}

function write(d: CompanyDesign) {
  cache = d;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // The company lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let serverDefault: CompanyDesign | null = null;
function readServer(): CompanyDesign {
  return (serverDefault ??= defaultDesign());
}

/** The reader's company, re-rendering whenever any lesson changes it. */
export function useCompany(): CompanyDesign {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getCompany(): CompanyDesign {
  return read();
}

export function updateCompany(fn: (d: CompanyDesign) => CompanyDesign) {
  write(sanitize(fn(read())));
}

/** The parts of the company, each owned by one lesson. */
export type CompanyPart = 'ships' | 'world' | 'policy' | 'drivers';

/** Put one part of the company back to its start, or the whole company. */
export function resetCompany(part?: CompanyPart) {
  const d = defaultDesign();
  if (!part) return write(d);
  const cur = read();
  if (part === 'ships') write({ ...cur, ships: d.ships, finance: d.finance });
  else write({ ...cur, [part]: d[part] });
}

/** Put some fields of the cargo world back to their start, leaving the rest as the reader set them. */
export function resetWorldFields(keys: Array<keyof CargoWorld>) {
  const d = defaultDesign();
  const cur = read();
  const world = { ...cur.world };
  for (const k of keys) (world as Record<string, unknown>)[k] = d.world[k];
  write({ ...cur, world });
}

/** The starting company (what the prose describes). */
export const STARTING: CompanyDesign = defaultDesign();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a part of the reader's company differs from the starting company's. */
export function partChanged(d: CompanyDesign, part: CompanyPart): boolean {
  if (part === 'ships') return !same(d.ships, STARTING.ships) || !same(d.finance, STARTING.finance);
  return !same(d[part], STARTING[part]);
}

/** Whether some fields of the reader's cargo world differ from the start. */
export function worldFieldsChanged(d: CompanyDesign, keys: Array<keyof CargoWorld>): boolean {
  return keys.some((k) => !same(d.world[k], STARTING.world[k]));
}

/**
 * Ask before a lesson's Reset puts its part of the company back: the later lessons use it. Nothing
 * to ask if it is already at the start. Returns whether to go ahead.
 */
export function confirmReset(what: string, changed: boolean): boolean {
  if (!changed) return true;
  try {
    return typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(`Reset puts ${what} back to the starting company’s, and the later lessons will use that. Reset?`) === true;
  } catch {
    return false;
  }
}

/**
 * Chapter 6's one money format for sums: millions with an “m”, to two decimals below $10 million
 * and one above (“$0.82m”, “$22.6m”, “−$5.23m”). Rates keep their units (“$12,100/day”, “$7.31/t”).
 */
export function money(x: number, digits?: number): string {
  if (!Number.isFinite(x)) return '—';
  const m = Math.abs(x) / 1e6;
  const d = digits ?? (m >= 9.995 ? 1 : 2);
  const s = fmt(m, d);
  return `${x < 0 && s.replace(/[0.,]/g, '') !== '' ? '−' : ''}$${s}m`;
}

/** “July of Year 9” for a month of the history. */
export function when(t: number): string {
  const [y, m] = monthLabel(t).split(', ');
  return `${m} of ${y}`;
}
