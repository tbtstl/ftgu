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
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <rect x="4" y="3" width="3.5" height="12" rx="1" fill="#444" />
                  <rect x="10.5" y="3" width="3.5" height="12" rx="1" fill="#444" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M5 3 L15 9 L5 15 Z" fill="#444" />
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
          <span className="fig-mark-n">{index >= 0 ? `Demonstration ${index + 1}` : 'Demonstration'}</span>
          <span className="fig-mark-t">{name}</span>
          <span className="fig-mark-a" aria-hidden="true">
            {active ? 'shown beside' : 'show'} →
          </span>
        </button>
      )}
      {slot ? createPortal(figure, slot) : figure}
    </div>
  );
}
