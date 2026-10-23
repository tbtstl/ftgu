// Hash routing so the built site works on any static host without rewrites.
//   #/            home
//   #/contents    home, scrolled to the contents
//   #/engines     home, scrolled to the engine diagram
//   #/4.4         lesson 4.4

import { useSyncExternalStore } from 'react';

export type Route = { kind: 'home'; section?: 'contents' | 'engines' } | { kind: 'lesson'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'contents' || path === 'engines') return { kind: 'home', section: path };
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
