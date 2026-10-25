// The reader's oil business: one plan that Chapter 7 builds lesson by lesson and keeps in the
// browser. 7.1 sets the production plan, 7.2 the refinery, 7.3 the firm space on the Kessler–Corran
// line, and 7.5 the hedges; 7.4 reads the whole plan. Each lesson owns its own part, so it can be
// reset alone. Storage can be unavailable (private windows, blocked site data), so every access is
// guarded and the plan then lasts for the visit only.

import { useSyncExternalStore } from 'react';
import { BUSINESS_DEFAULTS, sanitizeBusiness, type OilBusiness } from '../../../engines/oil/business';

export type BusinessPart = keyof OilBusiness;

/** The lesson that owns each part of the plan. */
export const PART_LESSON: Record<BusinessPart, string> = {
  production: 'oil/7.1',
  refinery: 'oil/7.2',
  logistics: 'oil/7.3',
  hedges: 'oil/7.5',
};

const KEY = 'groundup.oil.business.v1';
let cache: OilBusiness | null = null;
const listeners = new Set<() => void>();

function read(): OilBusiness {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitizeBusiness(JSON.parse(raw)) : BUSINESS_DEFAULTS;
  } catch {
    cache = BUSINESS_DEFAULTS;
  }
  return cache;
}

function write(b: OilBusiness) {
  cache = b;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // The plan lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const readServer = () => BUSINESS_DEFAULTS;

/** The reader's plan, re-rendering whenever any lesson changes it. */
export function useBusiness(): OilBusiness {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getBusiness(): OilBusiness {
  return read();
}

/** Changes one part of the plan (the result is made valid before it is kept). */
export function updateBusiness<K extends BusinessPart>(part: K, patch: Partial<OilBusiness[K]>) {
  const b = read();
  write(sanitizeBusiness({ ...b, [part]: { ...b[part], ...patch } }));
}

/** Puts one part of the plan back to its starting value. */
export function resetBusinessPart(part: BusinessPart) {
  write({ ...read(), [part]: BUSINESS_DEFAULTS[part] });
}

export function resetBusiness() {
  write(BUSINESS_DEFAULTS);
}

/** How a reset prompt names each part. */
const PART_NAME: Record<BusinessPart, string> = {
  production: 'production plan',
  refinery: 'refinery design',
  logistics: 'firm space',
  hedges: 'hedges',
};

/**
 * A figure's Reset for a lesson that owns `part`: if the reader has changed that part of the plan,
 * it asks before putting it back (the later lessons use it), and touches no other part. Returns
 * whether to go ahead, so the figure resets its own settings only when the plan was reset too.
 */
export function confirmResetPart(part: BusinessPart): boolean {
  if (!partChanged(read(), part)) return true;
  let ok = false;
  try {
    ok = window.confirm(`Reset puts your ${PART_NAME[part]} back to the starting plan, and the later lessons will use that. Reset it?`);
  } catch {
    ok = false;
  }
  if (ok) resetBusinessPart(part);
  return ok;
}

/** Whether a part of the plan differs from its starting value. */
export function partChanged(b: OilBusiness, part: BusinessPart): boolean {
  return JSON.stringify(b[part]) !== JSON.stringify(BUSINESS_DEFAULTS[part]);
}
