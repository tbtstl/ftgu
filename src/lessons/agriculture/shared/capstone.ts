// The reader's agricultural business for Chapter 6: one farm design and one set of business rules,
// built up lesson by lesson and kept in the browser. 6.1 designs the farm; 6.4 sets the merchant's
// rules; 6.5 the trading desk's. Storage can be unavailable (private windows, blocked site data),
// so every access is guarded and the design then lasts for this visit only.

import { useSyncExternalStore } from 'react';
import { CEDAR_DESIGN, expectedCorn, type FarmDesign, type Hybrid, type MerchantPlan } from '../../../engines/agriculture/capstone';
import { CONTRACT_BUSHELS } from '../../../engines/agriculture/market';
import { DISTRICT_IDS, type DistrictId } from '../../../model/agriculture/region';

export type MerchantRules = MerchantPlan;

export interface DeskRules {
  /** December futures traded on March 1, contracts: positive sells, negative buys. */
  hedgeContracts: number;
  /** Kept for saved businesses from before the desk dropped puts; the desk now always trades futures. */
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
/** The futures slider's range and step, contracts. */
export const HEDGE_RANGE = { min: -600, max: 200, step: 5 };
/** The desk starts where Lesson 5.5 left Cedar Bend: selling a little under half of the farm's expected corn, 15 contracts. */
export const DEFAULT_DESK: DeskRules = { hedgeContracts: 15, hedgeWith: 'futures', forecastTrading: false, forecastContracts: 10 };

export function defaultState(): CapstoneState {
  return { farm: { ...CEDAR_DESIGN }, merchant: { ...DEFAULT_MERCHANT }, desk: { ...DEFAULT_DESK } };
}

const KEY = 'groundup.agriculture.capstone.v1';
let cache: CapstoneState | null = null;
const listeners = new Set<() => void>();

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const pick = <T extends string>(x: unknown, options: readonly T[], d: T): T => (options.includes(x as T) ? (x as T) : d);

/**
 * The desk's position as it was first saved: a share of the farm's expected corn, in percent
 * ("hedgePct"), before positions were counted in contracts. Converted to the nearest step of
 * contracts for the farm as saved, so a returning reader keeps the hedge they chose.
 */
export function contractsFromShare(pct: number, farm: FarmDesign): number {
  const raw = ((pct / 100) * expectedCorn(farm)) / CONTRACT_BUSHELS;
  const stepped = Math.round(raw / HEDGE_RANGE.step) * HEDGE_RANGE.step;
  return Math.max(HEDGE_RANGE.min, Math.min(HEDGE_RANGE.max, stepped));
}

export function sanitize(raw: unknown): CapstoneState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<CapstoneState>;
  const f = (r.farm ?? {}) as Partial<FarmDesign>;
  const m = (r.merchant ?? {}) as Partial<MerchantRules>;
  const k = (r.desk ?? {}) as Partial<DeskRules> & { hedgePct?: unknown };
  const acres = num(f.acres, 400, 4000, d.farm.acres);
  const farm: FarmDesign = {
    district: pick<DistrictId>(f.district, DISTRICT_IDS, d.farm.district),
    acres,
    cornAcres: num(f.cornAcres, 0, acres, d.farm.cornAcres),
    owned: num(f.owned, 0, acres, d.farm.owned),
    irrigated: typeof f.irrigated === 'boolean' ? f.irrigated : d.farm.irrigated,
    hybrid: pick<Hybrid>(f.hybrid, ['early', 'standard', 'late'] as const, d.farm.hybrid),
    bins: num(f.bins, 0, 1e6, d.farm.bins),
  };
  // Puts are no longer a choice on the desk; a saved puts position starts again from Lesson 5.5's hedge.
  const puts = k.hedgeWith === 'puts';
  const hedgeContracts = puts
    ? d.desk.hedgeContracts
    : typeof k.hedgeContracts === 'number'
      ? num(k.hedgeContracts, HEDGE_RANGE.min, HEDGE_RANGE.max, d.desk.hedgeContracts)
      : typeof k.hedgePct === 'number' && Number.isFinite(k.hedgePct)
        ? contractsFromShare(num(k.hedgePct, -150, 150, 0), farm)
        : d.desk.hedgeContracts;
  return {
    farm,
    merchant: {
      spreadCents: num(m.spreadCents, 20, 80, d.merchant.spreadCents),
      storeUntil: pick(m.storeUntil, ['none', 'Mar', 'May', 'Jul'] as const, d.merchant.storeUntil),
      storeMinCarry: num(m.storeMinCarry, 0, 1, d.merchant.storeMinCarry),
      charterMillions: num(m.charterMillions, 0, 10, d.merchant.charterMillions),
    },
    desk: {
      hedgeContracts,
      hedgeWith: 'futures',
      forecastTrading: typeof k.forecastTrading === 'boolean' ? k.forecastTrading : d.desk.forecastTrading,
      forecastContracts: num(k.forecastContracts, 0, 200, d.desk.forecastContracts),
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

// ---------------------------------------------------------------------------------------------
// Resets. Each figure resets only its own part of the business, and asks first, since the reset
// reaches every later lesson. A reset that would change nothing asks nothing.

/** The farm choices of 6.1's first figure (everything but the bins). */
export const FARM_DESIGN_KEYS = ['district', 'acres', 'cornAcres', 'owned', 'irrigated', 'hybrid'] as const;

/** Whether two farms agree on the given choices (all of them by default). */
export function sameFarm(a: FarmDesign, b: FarmDesign, keys: ReadonlyArray<keyof FarmDesign> = [...FARM_DESIGN_KEYS, 'bins']): boolean {
  return keys.every((k) => a[k] === b[k]);
}

function confirmed(message: string): boolean {
  try {
    return typeof window === 'undefined' || typeof window.confirm !== 'function' ? true : window.confirm(message);
  } catch {
    return true;
  }
}

function resetPart<T extends object>(current: T, defaults: T, message: string, apply: (patch: T) => void) {
  const changed = (Object.keys(defaults) as Array<keyof T>).some((k) => current[k] !== defaults[k]);
  if (changed && confirmed(message)) apply({ ...defaults });
}

const pickKeys = <T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

/** 6.1's first figure: the district, the corn acres, the hybrid and the pivots go back to Cedar Bend's; the bins stay. */
export function resetFarmDesign() {
  resetPart(
    pickKeys(read().farm, FARM_DESIGN_KEYS),
    pickKeys(CEDAR_DESIGN, FARM_DESIGN_KEYS),
    'Put the farm back to Cedar Bend’s design? Its bins, and the choices of the later lessons, stay as they are.',
    setFarm,
  );
}

/** 6.1's second figure: the bins only. */
export function resetBins() {
  resetPart({ bins: read().farm.bins }, { bins: CEDAR_DESIGN.bins }, `Put the bins back to Cedar Bend’s ${CEDAR_DESIGN.bins.toLocaleString('en-US')} bushels?`, setFarm);
}

/** 6.4's first figure: the harvest spread only. */
export function resetSpread() {
  resetPart({ spreadCents: read().merchant.spreadCents }, { spreadCents: DEFAULT_MERCHANT.spreadCents }, `Put the harvest spread back to ${DEFAULT_MERCHANT.spreadCents}¢? The storage rule and the charter stay as they are.`, setMerchant);
}

const STORE_KEYS = ['storeUntil', 'storeMinCarry', 'charterMillions'] as const;

/** 6.4's second figure: the storage rule and the charter; the spread stays. */
export function resetStorageAndCharter() {
  resetPart(pickKeys(read().merchant, STORE_KEYS), pickKeys(DEFAULT_MERCHANT, STORE_KEYS), 'Go back to selling at harvest with no barge charter? The harvest spread stays as it is.', setMerchant);
}

/** 6.5's first figure: the whole desk. */
export function resetDesk() {
  resetPart(read().desk, DEFAULT_DESK, 'Put the desk back to Lesson 5.5’s hedge, with no report trading? The farm and the merchant stay as they are.', setDesk);
}

/** 6.5's second figure: the futures position only. */
export function resetHedge() {
  resetPart({ hedgeContracts: read().desk.hedgeContracts }, { hedgeContracts: DEFAULT_DESK.hedgeContracts }, `Put the futures back to Lesson 5.5’s hedge, selling ${DEFAULT_DESK.hedgeContracts} contracts?`, setDesk);
}
