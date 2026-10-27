// Selecting text in a lesson raises a small bar beside the selection: Ask mentor brings the
// passage into the next question, Explain asks about it straight away.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMentor } from './MentorContext';
import { ChatIcon } from './icons';

interface Spot {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

/** Room the bar needs either side of its center, so it never runs off the window. */
const HALF_WIDTH = 110;

function selectedPassage(): Spot | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el?.closest('main.art')) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 3) return null;
  const r = range.getBoundingClientRect();
  // On touch screens the system's own menu sits above a selection, so go below it.
  const below = r.top < 72 || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  const x = Math.min(Math.max(r.left + r.width / 2, HALF_WIDTH + 8), document.documentElement.clientWidth - HALF_WIDTH - 8);
  return { text: text.slice(0, 600), x: x + window.scrollX, y: (below ? r.bottom + 10 : r.top - 10) + window.scrollY, below };
}

export function HighlightBar() {
  const m = useMentor();
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    let timer = 0;
    // Wait for the selection to settle so the bar doesn't chase the pointer while dragging.
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setSpot(selectedPassage()), 160);
    };
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  if (!m || !spot) return null;

  const done = () => {
    document.getSelection()?.removeAllRanges();
    setSpot(null);
  };

  return createPortal(
    <div
      className={spot.below ? 'mt-hl below' : 'mt-hl'}
      role="toolbar"
      aria-label="Selected text"
      style={{ left: spot.x, top: spot.y }}
      // Keep the selection while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={() => {
          m.attach(spot.text);
          done();
        }}
      >
        <ChatIcon />
        Ask mentor
      </button>
      <span className="mt-hl-sep" aria-hidden="true" />
      <button
        type="button"
        onClick={() => {
          m.explain(spot.text);
          done();
        }}
      >
        Explain
      </button>
    </div>,
    document.body,
  );
}
