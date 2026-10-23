// Challenge progress, kept in the reader's browser. Storage can be unavailable (private
// windows, blocked site data), so every access is guarded and the app works without it.

import { useSyncExternalStore } from 'react';

const KEY = 'emc.progress.v1';
type Progress = Record<string, string[]>; // lesson id → solved challenge ids

let cache: Progress | null = null;
const listeners = new Set<() => void>();

function read(): Progress {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(p: Progress) {
  cache = p;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Progress just won't persist.
  }
  listeners.forEach((l) => l());
}

export function markSolved(lessonId: string, challengeId: string) {
  const p = read();
  const done = p[lessonId] ?? [];
  if (done.includes(challengeId)) return;
  write({ ...p, [lessonId]: [...done, challengeId] });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, read, () => ({}));
}
