// Hash routing so the built site works on any static host without rewrites.
//   #/             the school's home page
//   #/electricity  the electricity course: introduction and contents
//   #/4.4          lesson 4.4
// The old #/contents and #/engines links lead to the course page.

import { useSyncExternalStore } from 'react';

export type Route = { kind: 'home' } | { kind: 'course' } | { kind: 'lesson'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'electricity' || path === 'contents' || path === 'engines') return { kind: 'course' };
  if (/^\d+\.\d+$/.test(path)) return { kind: 'lesson', id: path };
  return { kind: 'home' };
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return parse(hash);
}

export function lessonHref(id: string): string {
  return `#/${id}`;
}

export function courseHref(): string {
  return '#/electricity';
}
