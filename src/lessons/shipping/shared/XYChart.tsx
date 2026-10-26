// A small x–y chart for the shipping course: lines, dashed lines, shaded bands and markers on a
// numeric x axis (speed, draft, weeks, years…). Hand-built SVG in the course's chart style.

import type { ReactNode } from 'react';
import { GridY, linePath, niceDomain, niceTicks, scale, areaPath } from '../../../framework';
import type { Scale } from '../../../framework/charts/scale';

export interface XYSeries {
  xs: number[];
  ys: number[];
  color: string;
  width?: number;
  dash?: string;
  /** Text drawn at the end of the line. */
  label?: string;
  labelColor?: string;
  /** Fill down to this y value (or between this series and `fillTo` series values). */
  fillTo?: number | number[];
  fillOpacity?: number;
  /** Draw as steps (value held until the next x). */
  step?: boolean;
}

export interface XYMarker {
  x: number;
  y: number;
  color: string;
  r?: number;
  label?: string;
  labelDy?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export interface XYChartProps {
  series: XYSeries[];
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  xTicks?: number[];
  yTicks?: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  width?: number;
  /** Vertical cursor line at this x. */
  cursor?: number;
  markers?: XYMarker[];
  /** Shaded x ranges. */
  bands?: Array<{ from: number; to: number; color: string; label?: string; opacity?: number }>;
  /** Horizontal reference lines. */
  refLines?: Array<{ y: number; color?: string; dash?: string; label?: string }>;
  ariaLabel: string;
  /** Extra SVG drawn on top, given the scales. */
  overlay?: (x: Scale, y: Scale) => ReactNode;
  /** Left margin for y labels. */
  left?: number;
}

/** Line chart with a numeric x axis. */
export function XYChart({
  series,
  xMin,
  xMax,
  yMin,
  yMax,
  xTicks,
  yTicks,
  xFormat = (v) => String(v),
  yFormat = (v) => String(v),
  xLabel,
  yLabel,
  height = 220,
  width = 640,
  cursor,
  markers = [],
  bands = [],
  refLines = [],
  ariaLabel,
  overlay,
  left = 56,
}: XYChartProps) {
  const top = yLabel ? 26 : 12;
  const bottom = height - (xLabel ? 38 : 24);
  const right = width - 16;
  const all = series.flatMap((s) => s.ys).filter(Number.isFinite);
  const lo = yMin ?? Math.min(0, ...all);
  const hi = yMax ?? Math.max(...all, lo + 1);
  const [d0, d1] = yMin !== undefined && yMax !== undefined ? [yMin, yMax] : niceDomain(lo, hi, 4);
  const x = scale(xMin, xMax, left, right);
  const y = scale(d0, d1, bottom, top);
  const yt = yTicks ?? niceTicks(d0, d1, 4);
  const xt = xTicks ?? niceTicks(xMin, xMax, 6);
  const clamp = (v: number) => Math.max(d0, Math.min(d1, v));
  const pathOf = (s: XYSeries) => {
    if (!s.step) return linePath(s.xs.map(x), s.ys.map((v) => y(clamp(v))));
    let d = '';
    for (let i = 0; i < s.xs.length; i++) {
      const x0 = x(s.xs[i]);
      const x1 = x(i + 1 < s.xs.length ? s.xs[i + 1] : xMax);
      const yy = y(clamp(s.ys[i]));
      d += `${i ? ' L' : 'M'}${x0.toFixed(1)} ${yy.toFixed(1)} L${x1.toFixed(1)} ${yy.toFixed(1)}`;
    }
    return d;
  };
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {yLabel && (
        <text className="ax" x={left} y={14}>
          {yLabel}
        </text>
      )}
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={x(Math.max(xMin, b.from))} y={top} width={Math.max(0, x(Math.min(xMax, b.to)) - x(Math.max(xMin, b.from)))} height={bottom - top} fill={b.color} opacity={b.opacity ?? 1} />
          {b.label && (
            <text className="ax" x={x(Math.max(xMin, b.from)) + 4} y={top + 12}>
              {b.label}
            </text>
          )}
        </g>
      ))}
      <GridY y={y} ticks={yt} x0={left} x1={right} format={yFormat} baseline={d0 <= 0 && d1 >= 0 ? 0 : d0} />
      {xt.map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={bottom + 16}>
          {xFormat(t)}
        </text>
      ))}
      {xLabel && (
        <text className="ax ax-e" x={right} y={height - 6}>
          {xLabel}
        </text>
      )}
      {refLines.map((r, i) => (
        <g key={i}>
          <line x1={left} x2={right} y1={y(clamp(r.y))} y2={y(clamp(r.y))} stroke={r.color ?? '#777'} strokeWidth={1.2} strokeDasharray={r.dash ?? '5 4'} />
          {r.label && (
            <text className="ax ax-e" x={right - 2} y={y(clamp(r.y)) - 5}>
              {r.label}
            </text>
          )}
        </g>
      ))}
      {series.map((s, i) =>
        s.fillTo !== undefined ? (
          <path
            key={'f' + i}
            d={areaPath(
              s.xs.map(x),
              s.ys.map((v) => y(clamp(v))),
              Array.isArray(s.fillTo) ? s.fillTo.map((v) => y(clamp(v))) : s.xs.map(() => y(clamp(s.fillTo as number))),
            )}
            fill={s.color}
            opacity={s.fillOpacity ?? 0.15}
          />
        ) : null,
      )}
      {series.map((s, i) => (
        <path key={i} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.5} strokeDasharray={s.dash} strokeLinejoin="round" />
      ))}
      {series.map((s, i) =>
        s.label && s.xs.length ? (
          <text
            key={'l' + i}
            x={Math.min(right - 2, x(s.xs[s.xs.length - 1]) + 4)}
            y={y(clamp(s.ys[s.ys.length - 1])) - 6}
            textAnchor="end"
            style={{ fontSize: 12, fontWeight: 500, fill: s.labelColor ?? s.color }}
          >
            {s.label}
          </text>
        ) : null,
      )}
      {cursor !== undefined && <line className="cur" x1={x(cursor)} x2={x(cursor)} y1={top} y2={bottom} />}
      {markers.map((m, i) => (
        <g key={i}>
          <circle cx={x(m.x)} cy={y(clamp(m.y))} r={m.r ?? 5.5} fill={m.color} stroke="#fcfcfb" strokeWidth={2} />
          {m.label && (
            <text x={x(m.x) + (m.anchor === 'end' ? -8 : m.anchor === 'middle' ? 0 : 8)} y={y(clamp(m.y)) + (m.labelDy ?? -8)} textAnchor={m.anchor ?? 'start'} style={{ fontSize: 12, fontWeight: 500, fill: m.color }}>
              {m.label}
            </text>
          )}
        </g>
      ))}
      {overlay?.(x, y)}
    </svg>
  );
}
