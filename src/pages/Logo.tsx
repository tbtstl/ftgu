import { useState } from 'react';
import { GRAPHIC } from '../framework/tokens';
import { RunnerMark } from '../framework/RunnerMark';
import { LOGO_INK, setLogoColor, useLogoColor } from '../course/logoColor';

// The colors the runner bursts into: the ink, then the figures' concept tones.
const COLORS = [LOGO_INK, GRAPHIC.blue, GRAPHIC.orange, GRAPHIC.green, GRAPHIC.violet, GRAPHIC.teal, GRAPHIC.red, GRAPHIC.gold];

/**
 * The runner beside the site's name. Each click bursts it into a new color as it dashes a step
 * forward and settles back, in 200 ms. The color is remembered, and the runner in the lesson
 * header wears it too; this is the only place it changes.
 */
export function Logo() {
  const color = useLogoColor();
  const [burst, setBurst] = useState(0);

  const next = () => {
    const others = COLORS.filter((c) => c.toLowerCase() !== color.toLowerCase());
    setLogoColor(others[Math.floor(Math.random() * others.length)]);
    setBurst((b) => b + 1);
  };

  return (
    <button type="button" className="logo" onClick={next} aria-label="From The Ground Up logo: click for a new color">
      <RunnerMark key={burst} size={40} className={burst > 0 ? 'logo-mark dash' : 'logo-mark'} />
    </button>
  );
}
