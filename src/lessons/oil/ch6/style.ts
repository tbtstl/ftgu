// The look shared by chapter 6's trading figures, so the five lessons read as one: position shading,
// five-year axes, money rounding and the tones of the risk readouts.

import { fmt, usd, type Tone } from '../../../framework';
import type { XYBand } from '../shared/charts';

/** Weeks the rule holds the spread long (green) or short (red): chart bands, and stronger legend swatches. */
export const LONG_FILL = 'rgba(109, 156, 55, .2)';
export const SHORT_FILL = 'rgba(231, 91, 85, .18)';
export const LONG_SWATCH = 'rgba(109, 156, 55, .5)';
export const SHORT_SWATCH = 'rgba(231, 91, 85, .45)';

/** Five simulated years on an axis in years: "start", "year 1" … "year 5" at the year boundaries. */
export const YEAR_TICKS = [0, 1, 2, 3, 4, 5];
export const yearTick = (v: number) => (v === 0 ? 'start' : `year ${fmt(v)}`);

/** Profits and losses: to the nearest $100, or in millions with two decimals from $1 million. */
export function money(x: number): string {
  if (Math.abs(x) >= 1e6) return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, 2)} million`;
  return usd(Math.round(x / 100) * 100);
}

/** A P&L readout is green when it makes money and red when it loses; risk readouts (Sharpe, drawdown, VaR) are violet. */
export const pnlTone = (v: number): Tone => (v < 0 ? 'red' : v > 0 ? 'green' : 'ink');
export const RISK_TONE: Tone = 'violet';

/** The seasonal-swing slider's value, as in Lessons 6.3–6.5. */
export const seasonDisplay = (s: number) =>
  s === 0 ? 'none' : s === 1 ? '×1.0 (normal)' : `×${fmt(s, Math.abs(Math.round(s * 10) - s * 10) < 1e-9 ? 1 : 2)}`;

/** Runs of long and short positions as shaded bands; position i is held from week i to week i + 1. */
export function positionBands(positions: number[]): XYBand[] {
  const out: XYBand[] = [];
  let i = 0;
  while (i < positions.length) {
    const s = Math.sign(positions[i]);
    let j = i;
    while (j + 1 < positions.length && Math.sign(positions[j + 1]) === s) j++;
    if (s !== 0) out.push({ from: i / 52, to: (j + 1) / 52, color: s > 0 ? LONG_FILL : SHORT_FILL });
    i = j + 1;
  }
  return out;
}
