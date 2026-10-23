import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { AxisTitle, GridY } from './Axes';
import { areaPath, clamp, linePath, niceDomain, niceTicks, scale, stepPath } from './scale';
import { hour as fmtHour } from '../format';

export interface TimeSeries {
  values: number[];
  color: string;
  /** line (default), step (hourly prices), bar (signed bars from zero), area (filled to zero). */
  kind?: 'line' | 'step' | 'bar' | 'area';
  width?: number;
  dash?: string;
  opacity?: number;
  /** Per-point bar colors, for kind "bar". */
  colors?: string[];
}

export interface TimeChartProps {
  /** Filled areas stacked bottom to top, e.g. generation by source. */
  stack?: Array<{ values: number[]; color: string }>;
  /** Lines, steps and bars drawn over the stack. */
  series?: TimeSeries[];
  /** Hours spanned by the data (default 24). Each value occupies an equal slot. */
  hours?: number;
  /** First hour on the axis (default 0). */
  startHour?: number;
  yMin?: number;
  yMax?: number;
  yLabel?: string;
  yFormat?: (v: number) => string;
  /** viewBox height; width is always 640. */
  height?: number;
  /** Index of the highlighted slot. */
  cursor?: number;
  /** Called with a slot index while the reader clicks or drags across the chart. */
  onScrub?: (index: number) => void;
  /** Horizontal reference lines (limits, averages). */
  refLines?: Array<{ y: number; color?: string; dash?: string; label?: string }>;
  /** Shaded x ranges in slot indices, [from, to) . */
  bands?: Array<{ from: number; to: number; color: string; label?: string }>;
  /** Hour ticks to label (default every 6 h). */
  xTicks?: number[];
  ariaLabel: string;
}

const W = 640;
const X0 = 52;
const X1 = 628;

/** A chart over a day (or any span of hours): stacked areas, lines, steps and bars on one time axis. */
export function TimeChart({
  stack = [],
  series = [],
  hours = 24,
  startHour = 0,
  yMin,
  yMax,
  yLabel,
  yFormat = (v) => String(Math.round(v * 100) / 100),
  height = 240,
  cursor,
  onScrub,
  refLines = [],
  bands = [],
  xTicks,
  ariaLabel,
}: TimeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = 'tc' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const n = stack[0]?.values.length ?? series[0]?.values.length ?? 24;
  const top = yLabel ? 26 : 12;
  const bottom = height - 24;

  // Domain: everything that's drawn, including stack totals and reference lines.
  const totals = Array.from({ length: n }, (_, i) => stack.reduce((s, a) => s + (a.values[i] ?? 0), 0));
  const all = [...(stack.length ? totals : []), ...series.flatMap((s) => s.values), ...refLines.map((r) => r.y), 0];
  const lo = yMin ?? Math.min(...all);
  const hi = yMax ?? Math.max(...all);
  const [d0, d1] = yMin !== undefined && yMax !== undefined ? [yMin, yMax] : niceDomain(lo, hi);
  const y = scale(d0, d1, bottom, top);
  const slot = (X1 - X0) / n;
  const xc = (i: number) => X0 + (i + 0.5) * slot;
  const xs = Array.from({ length: n }, (_, i) => xc(i));
  const xHour = (h: number) => X0 + ((h - startHour) / hours) * (X1 - X0);
  const ticks = xTicks ?? Array.from({ length: Math.floor(hours / 6) + 1 }, (_, i) => startHour + i * 6);
  const yTicks = niceTicks(d0, d1, 4);

  // Stack edges, extended to the plot edges so areas fill the width.
  let lower = Array<number>(n).fill(0);
  const areas = stack.map((a) => {
    const upper = lower.map((v, i) => v + Math.max(0, a.values[i] ?? 0));
    const ex = [X0, ...xs, X1];
    const up = [upper[0], ...upper, upper[n - 1]].map(y);
    const lw = [lower[0], ...lower, lower[n - 1]].map(y);
    lower = upper;
    return { d: areaPath(ex, up, lw), color: a.color };
  });

  const scrub = (e: PointerEvent<SVGRectElement>) => {
    if (!onScrub || !svgRef.current) return;
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    onScrub(clamp(Math.floor((p.x - X0) / slot), 0, n - 1));
  };

  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (!onScrub) return;
    const at = cursor ?? 0;
    const step = Math.max(1, Math.round(n / hours));
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? at - 1 : e.key === 'PageUp' ? at + step : e.key === 'PageDown' ? at - step : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onScrub(clamp(next, 0, n - 1));
  };

  return (
    <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${height}`} role={onScrub ? 'group' : 'img'} aria-label={ariaLabel}>
      <defs>
        <clipPath id={clipId}>
          <rect x={X0} y={top - 6} width={X1 - X0} height={bottom - top + 7} />
        </clipPath>
      </defs>
      {yLabel && <AxisTitle x={X0} y={14}>{yLabel}</AxisTitle>}
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={X0 + b.from * slot} y={top} width={(b.to - b.from) * slot} height={bottom - top} fill={b.color} />
          {b.label && (
            <text className="ax" x={X0 + b.from * slot + 4} y={top + 12}>
              {b.label}
            </text>
          )}
        </g>
      ))}
      <GridY y={y} ticks={yTicks} x0={X0} x1={X1} format={yFormat} baseline={d0 <= 0 && d1 >= 0 ? 0 : d0} />
      <g clipPath={`url(#${clipId})`}>
      {areas.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} />
      ))}
      {series.map((s, i) => {
        const kind = s.kind ?? 'line';
        if (kind === 'bar') {
          const bw = slot * 0.7;
          return (
            <g key={i} opacity={s.opacity}>
              {s.values.map((v, j) => {
                const y0 = y(0);
                const yv = y(v);
                return <rect key={j} x={xc(j) - bw / 2} width={bw} y={Math.min(y0, yv)} height={Math.abs(yv - y0)} fill={s.colors?.[j] ?? s.color} />;
              })}
            </g>
          );
        }
        if (kind === 'area') {
          const ex = [X0, ...xs, X1];
          const vals = [s.values[0], ...s.values, s.values[n - 1]];
          return <path key={i} d={areaPath(ex, vals.map(y), vals.map(() => y(Math.max(d0, 0))))} fill={s.color} opacity={s.opacity ?? 0.35} />;
        }
        const d = kind === 'step' ? stepPath(xs, s.values.map(y), slot / 2) : linePath(xs, s.values.map(y));
        return <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" opacity={s.opacity} />;
      })}
      {refLines.map((r, i) => (
        <g key={i}>
          <line x1={X0} x2={X1} y1={y(r.y)} y2={y(r.y)} stroke={r.color ?? '#333'} strokeWidth={1.5} strokeDasharray={r.dash ?? '6 4'} />
          {r.label && (
            <text className="ax ax-e" x={X1} y={y(r.y) - 5}>
              {r.label}
            </text>
          )}
        </g>
      ))}
      </g>
      <line className="base" x1={X0} x2={X1} y1={bottom} y2={bottom} />
      {ticks.map((h) => (
        <text key={h} className={h === startHour + hours ? 'ax ax-e' : 'ax ax-m'} x={h === startHour + hours ? xHour(h) + 2 : xHour(h)} y={height - 6}>
          {h === startHour + hours && h % 24 === 0 ? '24:00' : fmtHour(h)}
        </text>
      ))}
      {cursor !== undefined && cursor >= 0 && cursor < n && <line className="cur" x1={xc(cursor)} x2={xc(cursor)} y1={top - 4} y2={bottom} />}
      {onScrub && (
        <rect
          x={X0}
          y={top}
          width={X1 - X0}
          height={bottom - top}
          fill="transparent"
          tabIndex={0}
          role="slider"
          aria-label="Time of day"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={cursor ?? 0}
          aria-valuetext={fmtHour(startHour + ((cursor ?? 0) * hours) / n)}
          onKeyDown={key}
          style={{ cursor: 'ew-resize', touchAction: 'none', outline: 'none' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            scrub(e);
          }}
          onPointerMove={scrub}
        />
      )}
    </svg>
  );
}

/** x position (in the 640-wide viewBox) of slot i out of n, for drawing extra marks over a TimeChart. */
export function timeChartX(i: number, n: number): number {
  return X0 + (i + 0.5) * ((X1 - X0) / n);
}
