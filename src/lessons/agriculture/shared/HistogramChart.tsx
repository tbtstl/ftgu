// A histogram of a sample — yields across simulated seasons, prices, P&L — with labeled marks
// for the mean, percentiles or a particular value.

import { GridY, niceTicks, scale } from '../../../framework';
import { histogram } from '../../../engines/strategy/distribution';

export interface HistMark {
  x: number;
  label: string;
  color?: string;
  dash?: string;
  /** Put the label on the left of the line. */
  left?: boolean;
  /** Label row: 0 (top) or 1. */
  row?: number;
}

export function HistogramChart({
  values,
  lo,
  hi,
  bins = 30,
  color,
  marks = [],
  xTicks,
  xFormat = (v) => String(v),
  xLabel,
  yLabel = 'Seasons',
  height = 210,
  ariaLabel,
  highlight,
  band,
}: {
  values: number[];
  lo: number;
  hi: number;
  bins?: number;
  color: string;
  marks?: HistMark[];
  xTicks?: number[];
  xFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  ariaLabel: string;
  /** Bins whose range satisfies this are drawn darker (e.g. "below 150 bu"). */
  highlight?: (binLo: number, binHi: number) => boolean;
  /** An optional shaded range drawn behind the bars (e.g. the average ± one standard deviation). */
  band?: { from: number; to: number; color?: string };
}) {
  const h = histogram(values, lo, hi, bins);
  // Values outside the range are added to the end bins so nothing disappears.
  const counts = h.counts.slice();
  counts[0] += h.below;
  counts[counts.length - 1] += h.above;
  const top = 34;
  const bottom = height - (xLabel ? 40 : 24);
  const maxC = Math.max(1, ...counts);
  const yTicks = niceTicks(0, maxC, 3);
  const y = scale(0, Math.max(maxC, yTicks[yTicks.length - 1]), bottom, top);
  const x = scale(lo, hi, 56, 626);
  const ticks = xTicks ?? niceTicks(lo, hi, 6);
  return (
    <svg className="chart" viewBox={`0 0 640 ${height}`} role="img" aria-label={ariaLabel}>
      <text className="ax" x={56} y={14}>
        {yLabel}
      </text>
      <GridY y={y} ticks={yTicks} x0={56} x1={626} baseline={0} />
      {band && band.to > band.from && (
        <rect
          x={x(Math.max(lo, Math.min(hi, band.from)))}
          y={top}
          width={x(Math.max(lo, Math.min(hi, band.to))) - x(Math.max(lo, Math.min(hi, band.from)))}
          height={bottom - top}
          fill={band.color ?? 'rgba(0, 0, 0, .08)'}
        />
      )}
      {counts.map((c, i) => {
        const b0 = lo + i * h.width;
        const b1 = b0 + h.width;
        const dark = highlight?.(b0, b1);
        return c > 0 ? (
          <rect key={i} x={x(b0) + 0.75} y={y(c)} width={Math.max(0.5, x(b1) - x(b0) - 1.5)} height={bottom - y(c)} fill={color} opacity={dark ? 0.95 : 0.55} />
        ) : null;
      })}
      {marks.map((m, i) => {
        const mx = x(Math.max(lo, Math.min(hi, m.x)));
        const ly = 26 + 13 * (m.row ?? 0);
        const left = m.left ?? mx > 520;
        return (
          <g key={i}>
            <line x1={mx} x2={mx} y1={ly + 3} y2={bottom} stroke={m.color ?? '#333'} strokeWidth={1.5} strokeDasharray={m.dash} />
            <text className="ax" x={left ? mx - 4 : mx + 4} y={ly} textAnchor={left ? 'end' : 'start'} style={{ fill: m.color ?? '#333' }}>
              {m.label}
            </text>
          </g>
        );
      })}
      <line className="base" x1={56} x2={626} y1={bottom} y2={bottom} />
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={bottom + 16}>
          {xFormat(t)}
        </text>
      ))}
      {xLabel && (
        <text className="ax ax-e" x={626} y={height - 4}>
          {xLabel}
        </text>
      )}
    </svg>
  );
}
