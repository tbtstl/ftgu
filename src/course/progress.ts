// Progress, kept only in the reader's browser: which challenges they've solved, and the last
// lesson they opened, so the home and course pages can say where they left off. Storage can be
// unavailable (private windows, blocked site data), so every access is guarded and the app
// works without it.

import { useSyncExternalStore } from 'react';
import { CHALLENGES } from './challenges';

const KEY = 'emc.progress.v1';
const LAST_KEY = 'emc.last.v1';
type Progress = Record<string, string[]>; // lesson id → solved challenge ids

let cache: Progress | null = null;
let lastCache: string | null | undefined;
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

function readLast(): string | null {
  if (lastCache !== undefined) return lastCache;
  try {
    lastCache = window.localStorage.getItem(LAST_KEY);
  } catch {
    lastCache = null;
  }
  return lastCache;
}

export function markSolved(lessonId: string, challengeId: string) {
  const p = read();
  const done = p[lessonId] ?? [];
  if (done.includes(challengeId)) return;
  write({ ...p, [lessonId]: [...done, challengeId] });
}

/** How many of a lesson's challenges are solved, out of how many it has. Done when they match. */
export function lessonProgress(p: Progress, lessonId: string): { solved: number; total: number; done: boolean } {
  const ids = CHALLENGES[lessonId] ?? [];
  const solved = ids.filter((id) => p[lessonId]?.includes(id)).length;
  return { solved, total: ids.length, done: ids.length > 0 && solved === ids.length };
}

/** Remember the lesson the reader is on. */
export function markVisited(lessonId: string) {
  if (readLast() === lessonId) return;
  lastCache = lessonId;
  try {
    window.localStorage.setItem(LAST_KEY, lessonId);
  } catch {
    // The home page just won't know where they left off.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, read, () => ({}));
}

/** The id of the last lesson the reader opened, if any. */
export function useLastLesson(): string | null {
  return useSyncExternalStore(subscribe, readLast, () => null);
}
