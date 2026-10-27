// Two-up lesson layout: on wide screens the prose scrolls in one column while the
// demonstration it's discussing stays fixed in a panel beside it. Figures still render inline
// on narrower screens, so lessons are written once and work at every width.
//
// How the panel knows which figure to show:
//   - Each <Figure> leaves an anchor where it sits in the prose.
//   - Prose can point back at an earlier figure with <FigRef to="name"> or <Challenge figure="name">.
//   - The figure of the last anchor or reference above the reading line is the one shown.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/** Viewport width at which lessons switch to text beside a sticky figure panel. */
export const TWO_UP_MIN_WIDTH = 1320;

/** Where, as a share of the window height, a figure's anchor must reach to take over the panel. */
const READING_LINE = 0.68;

/** Scrolling this far after picking a figure by hand hands control back to the scroll position. */
const PIN_RELEASE_PX = 240;

function hasMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * True when the window is wide enough for the two-up layout. `reserve` is width taken by
 * something docked beside the lesson (the mentor panel), which the layout can't use.
 */
export function useWideViewport(reserve = 0): boolean {
  const query = `(min-width: ${TWO_UP_MIN_WIDTH + reserve}px)`;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  const snapshot = useCallback(() => hasMatchMedia() && window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export interface FigureEntry {
  id: string;
  name: string;
  anchor: HTMLElement | null;
}

export interface TwoUp {
  /** The two-up layout is active (lesson opted in and the window is wide enough). */
  wide: boolean;
  /** Element figures move into while the layout is active. */
  panel: HTMLElement | null;
  /** Id of the figure on show. */
  active: string | null;
  /** The lesson's figures in document order. */
  figures: FigureEntry[];
  register: (f: FigureEntry) => () => void;
  /** Show a figure by id or name. `pin` holds it until the reader scrolls on; `scroll` brings it into view when figures are inline. */
  activate: (idOrName: string, opts?: { pin?: boolean; scroll?: boolean }) => void;
}

export const TwoUpContext = createContext<TwoUp | null>(null);

export function useTwoUp(): TwoUp | null {
  return useContext(TwoUpContext);
}

/** False inside a figure that's hidden in the side panel; animations use it to pause. */
export const FigureActiveContext = createContext(true);

export function useFigureActive(): boolean {
  return useContext(FigureActiveContext);
}

function documentOrder(list: FigureEntry[]): FigureEntry[] {
  return [...list].sort((a, b) => {
    if (!a.anchor || !b.anchor) return 0;
    return a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

/**
 * Lays out a lesson's body. When `wide`, the body becomes the left column and figures move
 * into a sticky panel on the right; otherwise it's the usual single column. The body stays
 * the first child in both cases, so crossing the breakpoint never remounts the lesson.
 */
export function TwoUpLayout({ wide, children }: { wide: boolean; children: ReactNode }) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [figures, setFigures] = useState<FigureEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const pinned = useRef<number | null>(null);
  const figuresRef = useRef(figures);
  figuresRef.current = figures;
  const wideRef = useRef(wide);
  wideRef.current = wide;

  const register = useCallback((f: FigureEntry) => {
    setFigures((list) => documentOrder([...list.filter((x) => x.id !== f.id), f]));
    return () => setFigures((list) => list.filter((x) => x.id !== f.id));
  }, []);

  const activate = useCallback((idOrName: string, opts: { pin?: boolean; scroll?: boolean } = {}) => {
    const list = figuresRef.current;
    const f = list.find((x) => x.id === idOrName) ?? list.find((x) => x.name === idOrName);
    if (!f) return;
    if (wideRef.current) {
      if (opts.pin) pinned.current = window.scrollY;
      setActive(f.id);
    } else if (opts.scroll) {
      f.anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Follow the reader: the last figure anchor or reference above the reading line wins.
  useEffect(() => {
    if (!wide) return;
    let raf = 0;
    let timer = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
      const root = textRef.current;
      if (!root) return;
      if (pinned.current !== null) {
        if (Math.abs(window.scrollY - pinned.current) < PIN_RELEASE_PX) return;
        pinned.current = null;
      }
      const line = window.innerHeight * READING_LINE;
      let pick: string | null = null;
      for (const m of Array.from(root.querySelectorAll<HTMLElement>('[data-fig-anchor], [data-fig-focus]'))) {
        if (m.getBoundingClientRect().top > line) break;
        const id = m.dataset.figAnchor ?? figuresRef.current.find((f) => f.name === m.dataset.figFocus)?.id;
        if (id) pick = id;
      }
      const next = pick ?? figuresRef.current[0]?.id ?? null;
      setActive((a) => (a === next ? a : next));
    };
    // Next frame, or after a short delay where frames are throttled (embedded views, background tabs).
    const schedule = () => {
      if (raf || timer) return;
      raf = requestAnimationFrame(update);
      timer = window.setTimeout(update, 120);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [wide, figures]);

  // A newly shown figure starts at its top.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [active]);

  const value = useMemo<TwoUp>(() => ({ wide, panel: wide ? panel : null, active, figures, register, activate }), [wide, panel, active, figures, register, activate]);

  return (
    <TwoUpContext.Provider value={value}>
      <div className={wide ? 'tu' : 'wrap'}>
        <div className="tu-text" ref={textRef}>
          {children}
        </div>
        {wide && (
          <aside className="tu-panel" ref={scrollerRef} aria-label="Demonstrations">
            {figures.length > 1 && (
              <nav className="tu-pager" aria-label="Demonstrations in this lesson">
                {figures.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    className={f.id === active ? 'on' : ''}
                    aria-current={f.id === active ? 'true' : undefined}
                    aria-label={`Show demonstration ${i + 1}: ${f.name}`}
                    title={f.name}
                    onClick={() => activate(f.id, { pin: true })}
                  >
                    {i + 1}
                  </button>
                ))}
              </nav>
            )}
            <div className="tu-slots" ref={setPanel} />
          </aside>
        )}
      </div>
    </TwoUpContext.Provider>
  );
}

/**
 * A reference in the prose to a demonstration by name ("the first demonstration"). It brings
 * that figure into the side panel as it's read, and clicking it shows (or scrolls to) the figure.
 */
export function FigRef({ to, children }: { to: string; children: ReactNode }) {
  const tu = useTwoUp();
  return (
    <button type="button" className="figref" data-fig-focus={to} onClick={() => tu?.activate(to, { pin: true, scroll: true })}>
      {children}
    </button>
  );
}
