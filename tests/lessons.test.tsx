// Smoke test: every lesson renders without throwing, shows its title, and has at least one
// demonstration and one challenge. Interactive checks live in each chapter's own tests.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { ALL_LESSONS, lessonModulePath, OUTLINES } from '../src/course/registry';
import { CHALLENGES } from '../src/course/challenges';
import { COURSES } from '../src/course/courses';
import { Course } from '../src/pages/Course';
import { Home } from '../src/pages/Home';

const modules = import.meta.glob<{ default: ComponentType }>(['../src/lessons/ch*/L*_*.tsx', '../src/lessons/*/ch*/L*_*.tsx']);

// lessonModulePath is relative to src/course; the glob above is relative to tests/.
function pathOf(id: string) {
  return lessonModulePath(id).replace(/^\.\.\//, '../src/');
}

// The home and course footers fetch a forecast; keep tests offline.
beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});

describe('home', () => {
  it('lists every course', () => {
    const { container, unmount } = render(<Home />);
    expect(container.querySelectorAll('.rows > li').length).toBe(COURSES.length);
    unmount();
  });
});

describe('challenge table', () => {
  const sources = import.meta.glob<string>(['../src/lessons/ch*/L*_*.tsx', '../src/lessons/*/ch*/L*_*.tsx'], { query: '?raw', import: 'default', eager: true });
  it('lists every challenge id each lesson renders', () => {
    for (const lesson of ALL_LESSONS) {
      const src = sources[pathOf(lesson.id)];
      if (!src) continue;
      const ids = [...new Set(Array.from(src.matchAll(/<Challenge\b[^>]*?\bid="([^"]+)"/gs), (m) => m[1]))].sort();
      expect(CHALLENGES[lesson.id], lesson.id).toEqual(ids);
    }
  });
});

describe('course', () => {
  for (const outline of OUTLINES) {
    it(`renders the ${outline.slug} contents`, () => {
      const { getAllByRole, unmount } = render(<Course slug={outline.slug} />);
      expect(getAllByRole('heading', { level: 3 }).length).toBe(outline.chapters.length);
      unmount();
    });
  }
});

describe('lessons', () => {
  for (const lesson of ALL_LESSONS) {
    const load = modules[pathOf(lesson.id)];
    it.skipIf(!load)(`${lesson.id} ${lesson.title}`, async () => {
      const mod = await load!();
      const Lesson = mod.default;
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e.error);
      window.addEventListener('error', onError);
      const view = render(<Lesson />);
      expect(view.getByRole('heading', { level: 1 }).textContent).toBe(lesson.title);
      expect(view.container.querySelectorAll('figure').length).toBeGreaterThan(0);
      expect(view.container.querySelectorAll('.chal').length).toBeGreaterThan(0);
      // Nudge every slider and press every segmented button: nothing should throw.
      for (const input of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
        if (input.disabled) continue;
        await act(async () => {
          fireEvent.change(input, { target: { value: input.max } });
          fireEvent.change(input, { target: { value: input.min } });
        });
      }
      for (const button of Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button'))) {
        await act(async () => {
          fireEvent.click(button);
        });
      }
      // Advance animations a little.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      window.removeEventListener('error', onError);
      cleanup();
      expect(errors).toEqual([]);
    });
  }
});
