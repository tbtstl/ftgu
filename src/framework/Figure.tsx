import type { ReactNode } from 'react';
import type { Scenario } from './hooks';

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

/** A demonstration: the figure, its controls, and a footer naming the sandbox. */
export function Figure<T extends object>({ name, children, scenario, onReset, play, actions }: FigureProps<T>) {
  const reset = scenario?.reset ?? onReset;
  return (
    <figure className="fig" style={{ marginLeft: 0, marginRight: 0 }}>
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
  );
}
