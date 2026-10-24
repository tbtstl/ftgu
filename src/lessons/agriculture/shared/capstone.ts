// The reader's agricultural business for Chapter 6: one farm design and one set of business rules,
// built up lesson by lesson and kept in the browser. 6.1 designs the farm; 6.4 sets the merchant's
// rules; 6.5 the trading desk's. Storage can be unavailable (private windows, blocked site data),
// so every access is guarded and the design then lasts for this visit only.

import { useSyncExternalStore } from 'react';
import { CEDAR_DESIGN, type FarmDesign, type Hybrid, type MerchantPlan } from '../../../engines/agriculture/capstone';
import { DISTRICT_IDS, type DistrictId } from '../../../model/agriculture/region';

export type MerchantRules = MerchantPlan;

export interface DeskRules {
  /** Share of the farm's expected corn hedged on March 1, percent, and with what. */
  hedgePct: number;
  hedgeWith: 'futures' | 'puts';
  /** Trade the September crop report with the forecast of Lesson 5.4. */
  forecastTrading: boolean;
  /** Contracts traded on the forecast each year. */
  forecastContracts: number;
}

export interface CapstoneState {
  farm: FarmDesign;
  merchant: MerchantRules;
  desk: DeskRules;
}

export const DEFAULT_MERCHANT: MerchantRules = { spreadCents: 35, storeUntil: 'none', storeMinCarry: 0, charterMillions: 0 };
export const DEFAULT_DESK: DeskRules = { hedgePct: 40, hedgeWith: 'futures', forecastTrading: false, forecastContracts: 10 };

export function defaultState(): CapstoneState {
  return { farm: { ...CEDAR_DESIGN }, merchant: { ...DEFAULT_MERCHANT }, desk: { ...DEFAULT_DESK } };
}

const KEY = 'groundup.agriculture.capstone.v1';
let cache: CapstoneState | null = null;
const listeners = new Set<() => void>();

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const pick = <T extends string>(x: unknown, options: readonly T[], d: T): T => (options.includes(x as T) ? (x as T) : d);

function sanitize(raw: unknown): CapstoneState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<CapstoneState>;
  const f = (r.farm ?? {}) as Partial<FarmDesign>;
  const m = (r.merchant ?? {}) as Partial<MerchantRules>;
  const k = (r.desk ?? {}) as Partial<DeskRules>;
  const acres = num(f.acres, 400, 4000, d.farm.acres);
  return {
    farm: {
      district: pick<DistrictId>(f.district, DISTRICT_IDS, d.farm.district),
      acres,
      cornAcres: num(f.cornAcres, 0, acres, d.farm.cornAcres),
      owned: num(f.owned, 0, acres, d.farm.owned),
      irrigated: typeof f.irrigated === 'boolean' ? f.irrigated : d.farm.irrigated,
      hybrid: pick<Hybrid>(f.hybrid, ['early', 'standard', 'late'] as const, d.farm.hybrid),
      bins: num(f.bins, 0, 1e6, d.farm.bins),
    },
    merchant: {
      spreadCents: num(m.spreadCents, 20, 80, d.merchant.spreadCents),
      storeUntil: pick(m.storeUntil, ['none', 'Mar', 'May', 'Jul'] as const, d.merchant.storeUntil),
      storeMinCarry: num(m.storeMinCarry, 0, 1, d.merchant.storeMinCarry),
      charterMillions: num(m.charterMillions, 0, 10, d.merchant.charterMillions),
    },
    desk: {
      hedgePct: num(k.hedgePct, 0, 150, d.desk.hedgePct),
      hedgeWith: pick(k.hedgeWith, ['futures', 'puts'] as const, d.desk.hedgeWith),
      forecastTrading: typeof k.forecastTrading === 'boolean' ? k.forecastTrading : d.desk.forecastTrading,
      forecastContracts: num(k.forecastContracts, 0, 100, d.desk.forecastContracts),
    },
  };
}

function read(): CapstoneState {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : defaultState();
  } catch {
    cache = defaultState();
  }
  return cache;
}

function write(s: CapstoneState) {
  cache = s;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // The business lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let serverState: CapstoneState | null = null;
function readServer(): CapstoneState {
  return (serverState ??= defaultState());
}

/** The reader's business, re-rendering whenever any lesson changes it. */
export function useCapstone(): CapstoneState {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getCapstone(): CapstoneState {
  return read();
}

export function setFarm(patch: Partial<FarmDesign>) {
  const s = read();
  write({ ...s, farm: { ...s.farm, ...patch } });
}

export function setMerchant(patch: Partial<MerchantRules>) {
  const s = read();
  write({ ...s, merchant: { ...s.merchant, ...patch } });
}

export function setDesk(patch: Partial<DeskRules>) {
  const s = read();
  write({ ...s, desk: { ...s.desk, ...patch } });
}

export function resetFarm() {
  setFarm({ ...CEDAR_DESIGN });
}

export function resetMerchant() {
  setMerchant({ ...DEFAULT_MERCHANT });
}

export function resetDesk() {
  setDesk({ ...DEFAULT_DESK });
}
