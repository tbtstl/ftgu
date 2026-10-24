// Hash routing so the built site works on any static host without rewrites.
//   #/             the school's home page
//   #/electricity  the electricity course: introduction and contents
//   #/4.4          electricity lesson 4.4
//   #/gas          another course's page
//   #/gas/4.4      that course's lesson 4.4
// The old #/contents and #/engines links lead to the electricity course page.

import { useSyncExternalStore } from 'react';

export type Route = { kind: 'home' } | { kind: 'course'; course: string } | { kind: 'lesson'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'electricity' || path === 'contents' || path === 'engines') return { kind: 'course', course: 'electricity' };
  if (/^\d+\.\d+$/.test(path)) return { kind: 'lesson', id: path };
  if (/^[a-z]+\/\d+\.\d+$/.test(path)) return { kind: 'lesson', id: path };
  if (/^[a-z]+$/.test(path)) return { kind: 'course', course: path };
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

/** "4.4" → "#/4.4"; "gas/4.4" → "#/gas/4.4". */
export function lessonHref(id: string): string {
  return `#/${id}`;
}

export function courseHref(course = 'electricity'): string {
  return `#/${course}`;
}
