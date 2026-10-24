import { useState } from 'react';
import { GRAPHIC } from '../framework/tokens';
import { RUNNER_PATH, RUNNER_SIZE } from './runner';

// The colors the runner bursts into: the ink, then the figures' concept tones.
const COLORS = ['#111111', GRAPHIC.blue, GRAPHIC.orange, GRAPHIC.green, GRAPHIC.violet, GRAPHIC.teal, GRAPHIC.red, GRAPHIC.gold];

/**
 * The runner beside the site's name. Each click bursts it into a new color: a 200 ms pop with
 * a ring flaring out behind it. Purely for fun; the color isn't remembered.
 */
export function Logo() {
  const [color, setColor] = useState(COLORS[0]);
  const [burst, setBurst] = useState(0);

  const next = () => {
    const others = COLORS.filter((c) => c !== color);
    setColor(others[Math.floor(Math.random() * others.length)]);
    setBurst((b) => b + 1);
  };

  return (
    <button type="button" className="logo" onClick={next} aria-label="From The Ground Up logo: click for a new color" style={{ color }}>
      {burst > 0 && <span key={burst} className="logo-ring" aria-hidden="true" />}
      <svg key={`m${burst}`} className={burst > 0 ? 'logo-mark pop' : 'logo-mark'} viewBox={`0 0 ${RUNNER_SIZE} ${RUNNER_SIZE}`} aria-hidden="true">
        <path fill="currentColor" fillRule="evenodd" d={RUNNER_PATH} />
      </svg>
    </button>
  );
}
