import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLessonId } from './Page';
import { useFigureActive } from './twoUp';

/**
 * Calls `cb(dt, elapsed)` every animation frame while `running`.
 * dt is in seconds and capped at 0.05 so a backgrounded tab doesn't jump.
 * Used inside a figure that's hidden in the two-up side panel, it pauses.
 */
export function useAnimationFrame(cb: (dt: number, elapsed: number) => void, running = true) {
  const visible = useFigureActive();
  running = running && visible;
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      if (last) {
        const dt = Math.min((now - last) / 1000, 0.05);
        elapsed += dt;
        ref.current(dt, elapsed);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}

/** Play/pause state for animated figures. */
export function usePlay(initial = true) {
  const [playing, setPlaying] = useState(initial);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  return { playing, toggle, setPlaying };
}

/**
 * A time-stepped simulation: `step(state, dt)` runs every frame while `running`.
 * Returns the current state and a setter for user interventions.
 */
export function useSimulation<S>(initial: () => S, step: (s: S, dt: number) => S, running: boolean) {
  const [state, setState] = useState<S>(initial);
  const stepRef = useRef(step);
  stepRef.current = step;
  useAnimationFrame((dt) => setState((s) => stepRef.current(s, dt)), running);
  return [state, setState] as const;
}

// ---------------------------------------------------------------------------
// Saved scenarios: a figure's parameters, saved by name in the reader's browser.

export interface SavedScenario<T> {
  name: string;
  state: T;
  at: number;
}

const SKEY = 'emc.scenarios.v1';
type Store = Record<string, Array<SavedScenario<unknown>>>;
let scache: Store | null = null;
const slisteners = new Set<() => void>();

function sread(): Store {
  if (scache) return scache;
  try {
    const raw = window.localStorage.getItem(SKEY);
    scache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    scache = {};
  }
  return scache;
}

function swrite(s: Store) {
  scache = s;
  try {
    window.localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
    // Saved scenarios last for this visit only.
  }
  slisteners.forEach((l) => l());
}

function ssubscribe(l: () => void) {
  slisteners.add(l);
  return () => slisteners.delete(l);
}

const EMPTY: Array<SavedScenario<unknown>> = [];

export interface Scenario<T> {
  state: T;
  /** Merge a partial update (or a function of the current state) into the state. */
  set: (patch: Partial<T> | ((s: T) => Partial<T>)) => void;
  reset: () => void;
  saved: Array<SavedScenario<T>>;
  save: () => void;
  load: (index: number) => void;
  remove: (index: number) => void;
}

/**
 * State for a sandbox, with Reset and named saves. `key` must be unique within the lesson.
 * Pass the returned object to <Figure scenario={...}> to get the Save/Load/Reset controls.
 */
export function useScenario<T extends object>(key: string, defaults: T): Scenario<T> {
  const lessonId = useLessonId();
  const full = `${lessonId}/${key}`;
  const [state, setState] = useState<T>(defaults);
  const defaultsRef = useRef(defaults);

  const all = useSyncExternalStore(ssubscribe, sread, sread);
  const saved = (all[full] ?? EMPTY) as Array<SavedScenario<T>>;

  const set = useCallback((patch: Partial<T> | ((s: T) => Partial<T>)) => {
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  const reset = useCallback(() => setState(defaultsRef.current), []);

  const save = useCallback(() => {
    const store = sread();
    const list = (store[full] ?? []) as Array<SavedScenario<T>>;
    const n = list.length ? Math.max(...list.map((s) => Number(/\d+$/.exec(s.name)?.[0] ?? 0))) + 1 : 1;
    const next = [...list, { name: `Scenario ${n}`, state, at: Date.now() }].slice(-8);
    swrite({ ...store, [full]: next });
  }, [full, state]);

  const load = useCallback(
    (i: number) => {
      const s = saved[i];
      if (s) setState({ ...defaultsRef.current, ...s.state });
    },
    [saved],
  );

  const remove = useCallback(
    (i: number) => {
      const store = sread();
      const list = (store[full] ?? []).filter((_, j) => j !== i);
      swrite({ ...store, [full]: list });
    },
    [full],
  );

  return { state, set, reset, saved, save, load, remove };
}
