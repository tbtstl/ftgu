// The runner logo's color, kept in the reader's browser so it follows them from page to page.
// Only the logo on the home page changes it. Storage can be unavailable, so every access is
// guarded and the logo falls back to ink.

import { useSyncExternalStore } from 'react';

const KEY = 'emc.logo-color.v1';
export const LOGO_INK = '#111111';

let cache: string | undefined;
const listeners = new Set<() => void>();

function read(): string {
  if (cache !== undefined) return cache;
  try {
    const v = window.localStorage.getItem(KEY);
    cache = v && /^#[0-9a-f]{6}$/i.test(v) ? v : LOGO_INK;
  } catch {
    cache = LOGO_INK;
  }
  return cache;
}

export function setLogoColor(color: string) {
  cache = color;
  try {
    window.localStorage.setItem(KEY, color);
  } catch {
    // The color just won't carry over to the next visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLogoColor(): string {
  return useSyncExternalStore(subscribe, read, () => LOGO_INK);
}
