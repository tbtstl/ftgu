import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Scenario } from './hooks';
import { FigureActiveContext, useTwoUp } from './twoUp';

export interface FigureProps<T extends object> {
  /** The sandbox's name, shown under the figure ("Circuit Builder"). */
  name: string;
  children: ReactNode;
  /** Adds Save / saved-scenario picker / Reset to the footer. */
  scenario?: Scenario<T>;
  /** Reset handler when the figure doesn't use a scenario. */
  onReset?: () => void;
  /** Adds a play/pause button for animated figures. */
  play?: { playing: boolean; toggle: () => void };
  /** Extra buttons for the footer's right side (e.g. "Step", "New day"). */
  actions?: ReactNode;
}

/**
 * A demonstration: the figure, its controls, and a footer naming the sandbox.
 *
 * The figure renders into its own container node. On narrow screens that node sits where the
 * figure appears in the prose; in the two-up layout it moves into the side panel and the prose
 * keeps a marker in its place. Moving the node (rather than re-rendering) keeps the figure's
 * state when the window crosses the breakpoint.
 */
export function Figure<T extends object>({ name, children, scenario, onReset, play, actions }: FigureProps<T>) {
  const reset = scenario?.reset ?? onReset;
  const tu = useTwoUp();
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [slot] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  const inPanel = !!tu?.wide && !!tu.panel;
  const active = !inPanel || tu?.active === id;
  const register = tu?.register;
  const index = tu ? tu.figures.findIndex((f) => f.id === id) : -1;

  useLayoutEffect(() => {
    if (!register) return;
    return register({ id, name, anchor: anchorRef.current });
  }, [register, id, name]);

  useLayoutEffect(() => {
    if (!slot) return;
    const host = inPanel ? tu?.panel : anchorRef.current;
    if (host && slot.parentNode !== host) host.appendChild(slot);
  }, [slot, inPanel, tu?.panel]);

  useLayoutEffect(() => {
    if (!slot) return;
    slot.className = inPanel ? 'tu-slot in-panel' : 'tu-slot';
    slot.hidden = !active;
  }, [slot, inPanel, active]);

  useLayoutEffect(() => () => slot?.remove(), [slot]);

  const figure = (
    <FigureActiveContext.Provider value={active}>
    <figure className="fig" style={{ marginLeft: 0, marginRight: 0 }} tabIndex={inPanel ? -1 : undefined} aria-label={name}>
      {children}
      <div className="fig-ft">
        <div className="fig-ft-l">
          {play && (
            <button type="button" className="tbtn icb" aria-label={play.playing ? 'Pause animation' : 'Play animation'} onClick={play.toggle}>
              {play.playing ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect x="1" y="0.5" width="2.5" height="9" rx="0.6" fill="currentColor" />
                  <rect x="6.5" y="0.5" width="2.5" height="9" rx="0.6" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M1.5 0.8 L9 5 L1.5 9.2 Z" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
          <span>{name}</span>
        </div>
        <div className="fig-ft-r">
          {actions}
          {scenario && (
            <>
              {scenario.saved.length > 0 && (
                <select
                  className="tsel"
                  aria-label="Load a saved scenario"
                  value=""
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    if (!Number.isNaN(i)) scenario.load(i);
                  }}
                >
                  <option value="">Saved scenarios…</option>
                  {scenario.saved.map((s, i) => (
                    <option key={s.at + '-' + i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="tbtn" onClick={scenario.save}>
                Save
              </button>
            </>
          )}
          {reset && (
            <button type="button" className="tbtn" onClick={reset}>
              Reset
            </button>
          )}
        </div>
      </div>
    </figure>
    </FigureActiveContext.Provider>
  );

  return (
    <div ref={anchorRef} className="fig-anchor" data-fig-anchor={tu ? id : undefined}>
      {inPanel && (
        <button
          type="button"
          className={'fig-mark' + (active ? ' on' : '')}
          aria-current={active ? 'true' : undefined}
          onClick={(e) => {
            tu?.activate(id, { pin: true });
            // From the keyboard, follow the figure into the panel.
            if (e.detail === 0) requestAnimationFrame(() => slot?.querySelector<HTMLElement>('figure')?.focus({ preventScroll: true }));
          }}
        >
          <svg className="fig-mark-a" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="fig-mark-n">{index >= 0 ? `Demonstration ${index + 1}` : 'Demonstration'}</span>
          <span className="fig-mark-t">{active ? `${name}, at right` : name}</span>
        </button>
      )}
      {slot ? createPortal(figure, slot) : figure}
    </div>
  );
}
