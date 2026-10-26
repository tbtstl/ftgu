// The reader's gas capstone, kept in the browser: the system Lesson 7.1 builds and the portfolio
// Lesson 7.4 sets up, read by every Chapter 7 lesson. Storage can be unavailable (private windows,
// blocked site data), so every access is guarded and the capstone then lasts for the visit only.

import { useSyncExternalStore } from 'react';
import { AS_BUILT, PORTFOLIO_DEFAULTS, type FirmLine, type GasSystem, type PortfolioSettings } from '../../../engines/gas/capstone';
import { PIPE_SIZES } from '../../../engines/gas/network';
import { CORRIDORS } from '../../../model/gas/world';

export interface GasCapstone {
  system: GasSystem;
  portfolio: PortfolioSettings;
}

export function defaultCapstone(): GasCapstone {
  return { system: { sizes: { ...AS_BUILT.sizes }, stations: { ...AS_BUILT.stations } }, portfolio: { ...PORTFOLIO_DEFAULTS } };
}

const clamp = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt);

/** A stored capstone, checked field by field; anything malformed falls back to the default. */
export function sanitizeCapstone(raw: unknown): GasCapstone {
  const d = defaultCapstone();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as { system?: { sizes?: Record<string, unknown>; stations?: Record<string, unknown> }; portfolio?: Record<string, unknown> };
  for (const c of CORRIDORS) {
    const size = r.system?.sizes?.[c.id];
    if (typeof size === 'number' && (size === 0 || PIPE_SIZES.includes(size))) d.system.sizes[c.id] = size;
    d.system.stations[c.id] = Math.round(clamp(r.system?.stations?.[c.id], 1, 5, d.system.stations[c.id]));
  }
  const p = r.portfolio ?? {};
  const q = d.portfolio;
  q.storageShare = clamp(p.storageShare, 0, 0.2, q.storageShare);
  q.storageHedged = typeof p.storageHedged === 'boolean' ? p.storageHedged : q.storageHedged;
  q.firmLine = p.firmLine === 'ridgeback-calder' || p.firmLine === 'calder-metro' ? (p.firmLine as FirmLine) : q.firmLine;
  q.firmMMBtuD = clamp(p.firmMMBtuD, 0, 100_000, q.firmMMBtuD);
  q.toll = typeof p.toll === 'boolean' ? p.toll : q.toll;
  q.weatherLots = Math.round(clamp(p.weatherLots, 0, 50, q.weatherLots));
  q.skill = clamp(p.skill, 0, 1, q.skill);
  q.weatherThresholdF = clamp(p.weatherThresholdF, 0, 10, q.weatherThresholdF);
  q.metroSellMMBtuD = clamp(p.metroSellMMBtuD, 0, 100_000, q.metroSellMMBtuD);
  q.metroSkipColderF = p.metroSkipColderF === null ? null : clamp(p.metroSkipColderF, -10, 10, q.metroSkipColderF ?? 0);
  return d;
}

const KEY = 'groundup.gas.capstone.v1';
let cache: GasCapstone | null = null;
const listeners = new Set<() => void>();

function read(): GasCapstone {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitizeCapstone(JSON.parse(raw)) : defaultCapstone();
  } catch {
    cache = defaultCapstone();
  }
  return cache;
}

function write(d: GasCapstone) {
  cache = d;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // The capstone lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let serverDefault: GasCapstone | null = null;
function readServer(): GasCapstone {
  return (serverDefault ??= defaultCapstone());
}

/** The reader's capstone, re-rendering whenever any lesson changes it. */
export function useGasCapstone(): GasCapstone {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getGasCapstone(): GasCapstone {
  return read();
}

/** Change the reader's system (Lesson 7.1). */
export function updateGasSystem(fn: (s: GasSystem) => GasSystem) {
  const d = read();
  write({ ...d, system: fn(d.system) });
}

/** Change the reader's portfolio (Lesson 7.4). */
export function updateGasPortfolio(fn: (p: PortfolioSettings) => PortfolioSettings) {
  const d = read();
  write({ ...d, portfolio: fn(d.portfolio) });
}

/** Put the system back as built (Lesson 7.1) or the portfolio back to its defaults (Lesson 7.4). */
export function resetGasSystem() {
  const d = read();
  write({ ...d, system: defaultCapstone().system });
}

export function resetGasPortfolio() {
  const d = read();
  write({ ...d, portfolio: defaultCapstone().portfolio });
}
