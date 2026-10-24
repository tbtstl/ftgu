// A chart over the days of a year: lines, filled areas, bars and shaded stage bands on one
// calendar axis labeled by month. The agriculture course's counterpart to the framework's
// hourly TimeChart. Optional scrubbing picks a day with the pointer or the arrow keys.

import { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GridY, areaPath, clamp, linePath, niceDomain, niceTicks, scale } from '../../../framework';
import { MONTHS, MONTH_START, dateLabel } from '../../../model/agriculture/region';

export interface DaySeries {
  /** One value per entry in `days`. */
  values: number[];
  color: string;
  /** line (default), area (filled to the baseline), bar (thin bars from zero). */
  kind?: 'line' | 'area' | 'bar';
  width?: number;
  dash?: string;
  opacity?: number;
  /** Optional separate x positions (days) for this series; defaults to the chart's `days`. */
  days?: number[];
}

export interface DayBand {
  from: number;
  to: number;
  color: string;
  label?: string;
}

export interface DayChartProps {
  /** Day of year for each value. */
  days: number[];
  series: DaySeries[];
  /** First and last day shown. */
  from: number;
  to: number;
  yMin?: number;
  yMax?: number;
  yLabel?: string;
  yFormat?: (v: number) => string;
  yTicks?: number[];
  height?: number;
  bands?: DayBand[];
  /** Vertical marks at days, with a short label. */
  marks?: Array<{ day: number; label?: string; color?: string; dash?: string }>;
  /** Horizontal reference lines. */
  refLines?: Array<{ y: number; label?: string; color?: string; dash?: string }>;
  /** Highlighted day. */
  cursor?: number;
  onScrub?: (day: number) => void;
  ariaLabel: string;
  /** Extra SVG drawn over the plot, given the scales. */
  overlay?: (x: (d: number) => number, y: (v: number) => number) => ReactNode;
}

const W = 640;
const X0 = 56;
const X1 = 626;

/** Month boundaries and mid-month labels between two days. */
function monthTicks(from: number, to: number) {
  const ticks: Array<{ day: number; label: string; mid: number }> = [];
  for (let m = 0; m < 12; m++) {
    const start = MONTH_START[m];
    const end = m < 11 ? MONTH_START[m + 1] : 365;
    if (end <= from || start >= to) continue;
    ticks.push({ day: start, label: MONTHS[m], mid: (Math.max(start, from) + Math.min(end, to)) / 2 });
  }
  return ticks;
}

export function DayChart({
  days,
  series,
  from,
  to,
  yMin,
  yMax,
  yLabel,
  yFormat = (v) => String(Math.round(v * 100) / 100),
  yTicks,
  height = 220,
  bands = [],
  marks = [],
  refLines = [],
  cursor,
  onScrub,
  ariaLabel,
  overlay,
}: DayChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = 'dc' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const top = yLabel ? 26 : 12;
  const bottom = height - 24;
  const all = [...series.flatMap((s) => s.values), ...refLines.map((r) => r.y), 0].filter((v) => Number.isFinite(v));
  const [d0, d1] = yMin !== undefined && yMax !== undefined ? [yMin, yMax] : niceDomain(yMin ?? Math.min(...all), yMax ?? Math.max(...all), 4);
  const y = scale(d0, d1, bottom, top);
  const x = scale(from, to, X0, X1);
  const ticks = yTicks ?? niceTicks(d0, d1, 4);
  const months = monthTicks(from, to);

  const scrub = (e: PointerEvent<SVGRectElement>) => {
    if (!onScrub || !svgRef.current) return;
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    onScrub(Math.round(clamp(from + ((p.x - X0) / (X1 - X0)) * (to - from), from, to)));
  };
  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (!onScrub) return;
    const at = cursor ?? from;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? at + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? at - 1
          : e.key === 'PageUp'
            ? at + 7
            : e.key === 'PageDown'
              ? at - 7
              : e.key === 'Home'
                ? from
                : e.key === 'End'
                  ? to
                  : null;
    if (next === null) return;
    e.preventDefault();
    onScrub(clamp(next, from, to));
  };

  return (
    <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${height}`} role={onScrub ? 'group' : 'img'} aria-label={ariaLabel}>
      <defs>
        <clipPath id={clipId}>
          <rect x={X0} y={top - 6} width={X1 - X0} height={bottom - top + 7} />
        </clipPath>
      </defs>
      {yLabel && (
        <text className="ax" x={X0} y={14}>
          {yLabel}
        </text>
      )}
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={x(Math.max(from, b.from))} y={top} width={Math.max(0, x(Math.min(to, b.to)) - x(Math.max(from, b.from)))} height={bottom - top} fill={b.color} />
          {b.label && x(Math.min(to, b.to)) - x(Math.max(from, b.from)) > 30 && (
            <text className="ax" x={x(Math.max(from, b.from)) + 4} y={top + 12}>
              {b.label}
            </text>
          )}
        </g>
      ))}
      <GridY y={y} ticks={ticks} x0={X0} x1={X1} format={yFormat} baseline={d0 <= 0 && d1 >= 0 ? 0 : d0} />
      {months.map((m) =>
        m.day > from ? <line key={`l${m.day}`} className="gl" x1={x(m.day)} x2={x(m.day)} y1={top} y2={bottom} /> : null,
      )}
      <g clipPath={`url(#${clipId})`}>
        {series.map((s, i) => {
          const ds = s.days ?? days;
          const xs = ds.map((d) => x(d));
          const kind = s.kind ?? 'line';
          if (kind === 'area') {
            const base = y(Math.max(d0, 0));
            return <path key={i} d={areaPath(xs, s.values.map(y), s.values.map(() => base))} fill={s.color} opacity={s.opacity ?? 0.3} />;
          }
          if (kind === 'bar') {
            const bw = Math.max(1, ((X1 - X0) / Math.max(1, to - from)) * 0.8);
            return (
              <g key={i} opacity={s.opacity}>
                {s.values.map((v, j) =>
                  v === 0 ? null : <rect key={j} x={xs[j] - bw / 2} width={bw} y={Math.min(y(0), y(v))} height={Math.abs(y(v) - y(0))} fill={s.color} />,
                )}
              </g>
            );
          }
          return (
            <path
              key={i}
              d={linePath(xs, s.values.map(y))}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              opacity={s.opacity}
            />
          );
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
        {overlay?.(x, y)}
      </g>
      {marks.map((m, i) =>
        m.day >= from && m.day <= to ? (
          <g key={i}>
            <line x1={x(m.day)} x2={x(m.day)} y1={top} y2={bottom} stroke={m.color ?? '#777'} strokeWidth={1.2} strokeDasharray={m.dash ?? '3 3'} />
            {m.label && (
              <text
                className={x(m.day) > X1 - 90 ? 'ax ax-e' : 'ax'}
                x={x(m.day) > X1 - 90 ? x(m.day) - 4 : x(m.day) + 4}
                y={bottom - 6}
                style={{ fill: m.color ?? undefined }}
              >
                {m.label}
              </text>
            )}
          </g>
        ) : null,
      )}
      <line className="base" x1={X0} x2={X1} y1={bottom} y2={bottom} />
      {months.map((m) => (
        <text key={m.day} className="ax ax-m" x={x(m.mid)} y={height - 6}>
          {m.label}
        </text>
      ))}
      {cursor !== undefined && cursor >= from && cursor <= to && <line className="cur" x1={x(cursor)} x2={x(cursor)} y1={top - 4} y2={bottom} />}
      {onScrub && (
        <rect
          x={X0}
          y={top}
          width={X1 - X0}
          height={bottom - top}
          fill="transparent"
          tabIndex={0}
          role="slider"
          aria-label="Day of the year"
          aria-valuemin={from}
          aria-valuemax={to}
          aria-valuenow={cursor ?? from}
          aria-valuetext={dateLabel(cursor ?? from, true)}
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

/** x position of a day in a DayChart spanning [from, to], for drawing extra marks. */
export function dayChartX(day: number, from: number, to: number): number {
  return X0 + ((day - from) / (to - from)) * (X1 - X0);
}
