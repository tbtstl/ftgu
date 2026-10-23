// The two-up layout: on a wide window every figure moves into the side panel, one is shown at a
// time, markers stay in the prose, and markers, figure numbers and FigRefs switch the panel.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentType } from 'react';

const modules = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch*/L*_*.tsx');

function setWide(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function renderLesson(path: string) {
  const Lesson = (await modules[path]()).default;
  const view = render(<Lesson />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return view;
}

const visibleFigures = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.tu-panel .tu-slot')).filter((s) => !s.hidden);

describe('two-up layout', () => {
  beforeEach(() => setWide(true));
  afterEach(() => {
    cleanup();
    setWide(false);
  });

  it('moves every figure into the panel and shows one at a time', async () => {
    const { container } = await renderLesson('../src/lessons/ch4/L4_4.tsx');
    expect(container.querySelector('.tu')).not.toBeNull();
    expect(container.querySelectorAll('.tu-text figure').length).toBe(0);
    expect(container.querySelectorAll('.tu-panel figure').length).toBe(2);
    expect(container.querySelectorAll('.fig-mark').length).toBe(2);
    expect(visibleFigures(container).length).toBe(1);
  });

  it('switches figures from the prose markers and the figure numbers', async () => {
    const { container } = await renderLesson('../src/lessons/ch4/L4_4.tsx');
    const marks = container.querySelectorAll<HTMLButtonElement>('.fig-mark');
    await act(async () => fireEvent.click(marks[0]));
    expect(visibleFigures(container)[0].textContent).toContain('Market Clearing Simulator');
    expect(marks[0].getAttribute('aria-current')).toBe('true');
    const pager = container.querySelectorAll<HTMLButtonElement>('.tu-pager button');
    await act(async () => fireEvent.click(pager[1]));
    expect(visibleFigures(container)[0].textContent).toContain('your plant');
  });

  it('brings an earlier figure back from a FigRef', async () => {
    const { container } = await renderLesson('../src/lessons/ch1/L1_2.tsx');
    const pager = container.querySelectorAll<HTMLButtonElement>('.tu-pager button');
    await act(async () => fireEvent.click(pager[1]));
    expect(visibleFigures(container)[0].textContent).toContain('Waveform Explorer · power');
    const ref = container.querySelector<HTMLButtonElement>('.figref[data-fig-focus="Waveform Explorer"]');
    expect(ref).not.toBeNull();
    await act(async () => fireEvent.click(ref!));
    const shown = visibleFigures(container)[0].textContent ?? '';
    expect(shown).toContain('Waveform Explorer');
    expect(shown).not.toContain('· power');
  });

  it('keeps figures inline on narrow windows', async () => {
    setWide(false);
    const { container } = await renderLesson('../src/lessons/ch4/L4_4.tsx');
    expect(container.querySelector('.tu')).toBeNull();
    expect(container.querySelectorAll('.tu-text figure').length).toBe(2);
    expect(container.querySelectorAll('.fig-mark').length).toBe(0);
  });

  it('every lesson lays out two-up without errors', async () => {
    for (const path of Object.keys(modules)) {
      const { container, unmount } = await renderLesson(path);
      const figs = container.querySelectorAll('.tu-panel figure').length;
      expect(figs, path).toBeGreaterThan(0);
      expect(container.querySelectorAll('.tu-text figure').length, path).toBe(0);
      expect(visibleFigures(container).length, path).toBe(1);
      unmount();
    }
  }, 120_000);
});
