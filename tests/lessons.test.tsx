// Smoke test: every lesson renders without throwing, shows its title, and has at least one
// demonstration and one challenge. Interactive checks live in each chapter's own tests.

import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { LESSONS } from '../src/course/registry';
import { COURSES } from '../src/course/courses';
import { Course } from '../src/pages/Course';
import { Home } from '../src/pages/Home';

const modules = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch*/L*_*.tsx');

function pathOf(id: string) {
  const [c, m] = id.split('.');
  return `../src/lessons/ch${c}/L${c}_${m}.tsx`;
}

describe('home', () => {
  it('lists every course', () => {
    const { container, unmount } = render(<Home />);
    expect(container.querySelectorAll('.rows > li').length).toBe(COURSES.length);
    unmount();
  });
});

describe('course', () => {
  it('renders the contents', () => {
    const { getAllByRole, unmount } = render(<Course />);
    expect(getAllByRole('heading', { level: 3 }).length).toBe(8);
    unmount();
  });
});

describe('lessons', () => {
  for (const lesson of LESSONS) {
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
