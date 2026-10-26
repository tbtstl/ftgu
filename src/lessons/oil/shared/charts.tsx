// Small chart components shared by the oil course's lessons: an x–y chart with numeric axes and a
// horizontal stacked bar. Both draw into a fixed viewBox that scales to the figure's width and use
// the framework's axis classes, so they match the electricity course's charts.

import { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GridY, clamp, linePath, niceTicks, scale } from '../../../framework';

type Scale = ReturnType<typeof scale>;

export interface XYSeries {
  points: Array<[number, number]>;
  color: string;
  width?: number;
  dash?: string;
  opacity?: number;
  /** Fill the area between the line and this y value. */
  fillTo?: number;
  fillOpacity?: number;
  /** Text drawn at the last point (or at `labelAt`). */
  label?: string;
  labelAt?: [number, number];
  labelAnchor?: 'start' | 'middle' | 'end';
  labelColor?: string;
}

export interface XYMarker {
  x: number;
  y: number;
  color: string;
  r?: number;
  label?: string;
  labelDx?: number;
  labelDy?: number;
  labelAnchor?: 'start' | 'middle' | 'end';
  hollow?: boolean;
}

export interface XYBand {
  /** Shade an x range (from, to) or a y range (axis: 'y'). */
  axis?: 'x' | 'y';
  from: number;
  to: number;
  color: string;
  label?: string;
  labelColor?: string;
  /** Where a y band's label sits (default right). */
  labelSide?: 'left' | 'right';
}

export interface XYRef {
  axis: 'x' | 'y';
  at: number;
  color?: string;
  dash?: string;
  label?: string;
  /** For a y line: draw the label under the line instead of over it (to clear a nearby line's label). */
  labelBelow?: boolean;
  /** For the cursor style (thin dashed black). */
  cursor?: boolean;
}

export interface XYChartProps {
  ariaLabel: string;
  width?: number;
  height?: number;
  x: [number, number];
  y: [number, number];
  xTicks?: number[];
  yTicks?: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Axis titles: the y title sits top-left, the x title bottom-right. */
  xLabel?: string;
  yLabel?: string;
  series?: XYSeries[];
  markers?: XYMarker[];
  bands?: XYBand[];
  refs?: XYRef[];
  /** Log-scale x axis (domain must be positive). */
  logX?: boolean;
  logY?: boolean;
  /** Margins: left, right, top, bottom. */
  margin?: [number, number, number, number];
  /** Called with an x value while the reader clicks or drags across the plot. */
  onScrub?: (x: number) => void;
  /** Current x for keyboard scrubbing, and the step arrow keys move it by. */
  scrubValue?: number;
  scrubStep?: number;
  scrubLabel?: string;
  /** Extra SVG drawn on top, given the scales. */
  children?: (sx: (v: number) => number, sy: (v: number) => number) => ReactNode;
}

function logScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  return (v: number) => r0 + ((Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0)) * (r1 - r0);
}

/** An x–y chart: lines, areas, markers, shaded bands and reference lines on numeric axes. */
export function XYChart({
  ariaLabel,
  width = 640,
  height = 260,
  x,
  y,
  xTicks,
  yTicks,
  xFormat = (v) => String(v),
  yFormat = (v) => String(v),
  xLabel,
  yLabel,
  series = [],
  markers = [],
  bands = [],
  refs = [],
  logX,
  logY,
  margin = [60, 16, yLabel ? 28 : 14, xLabel ? 40 : 26],
  onScrub,
  scrubValue,
  scrubStep,
  scrubLabel,
  children,
}: XYChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ml, mr, mt, mb] = margin;
  const x0 = ml;
  const x1 = width - mr;
  const yTop = mt;
  const yBot = height - mb;
  const sx: (v: number) => number = logX ? logScale(x[0], x[1], x0, x1) : (scale(x[0], x[1], x0, x1) as Scale);
  const syRaw: (v: number) => number = logY ? logScale(y[0], y[1], yBot, yTop) : (scale(y[0], y[1], yBot, yTop) as Scale);
  const sy = (v: number) => syRaw(v);
  const xt = xTicks ?? niceTicks(x[0], x[1], 6);
  const yt = yTicks ?? niceTicks(y[0], y[1], 4);
  const clipId = 'xy' + useId().replace(/[^a-zA-Z0-9]/g, '');

  const scrub = (e: PointerEvent<SVGRectElement>) => {
    if (!onScrub || !svgRef.current) return;
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const k = clamp((p.x - x0) / (x1 - x0), 0, 1);
    onScrub(logX ? 10 ** (Math.log10(x[0]) + k * (Math.log10(x[1]) - Math.log10(x[0]))) : x[0] + k * (x[1] - x[0]));
  };
  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (!onScrub || scrubValue === undefined) return;
    const step = scrubStep ?? (x[1] - x[0]) / 50;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? scrubValue + step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? scrubValue - step : e.key === 'Home' ? x[0] : e.key === 'End' ? x[1] : null;
    if (next === null) return;
    e.preventDefault();
    onScrub(clamp(next, x[0], x[1]));
  };

  return (
    <svg ref={svgRef} className="chart" viewBox={`0 0 ${width} ${height}`} role={onScrub ? 'group' : 'img'} aria-label={ariaLabel}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x0} y={yTop - 4} width={x1 - x0} height={yBot - yTop + 5} />
        </clipPath>
      </defs>
      {yLabel && (
        <text className="ax" x={x0} y={14}>
          {yLabel}
        </text>
      )}
      {bands.map((b, i) => {
        if (b.axis === 'y') {
          const a = sy(Math.min(b.to, y[1]));
          const c = sy(Math.max(b.from, y[0]));
          return (
            <g key={'b' + i}>
              <rect x={x0} y={a} width={x1 - x0} height={Math.max(0, c - a)} fill={b.color} />
              {b.label && (
                <text className={b.labelSide === 'left' ? 'ax' : 'ax ax-e'} x={b.labelSide === 'left' ? x0 + 6 : x1 - 4} y={a + 13} style={b.labelColor ? { fill: b.labelColor } : undefined}>
                  {b.label}
                </text>
              )}
            </g>
          );
        }
        const a = sx(Math.max(b.from, x[0]));
        const c = sx(Math.min(b.to, x[1]));
        return (
          <g key={'b' + i}>
            <rect x={a} y={yTop} width={Math.max(0, c - a)} height={yBot - yTop} fill={b.color} />
            {b.label && (
              <text className="ax" x={a + 4} y={yTop + 12} style={b.labelColor ? { fill: b.labelColor } : undefined}>
                {b.label}
              </text>
            )}
          </g>
        );
      })}
      <GridY y={sy as Scale} ticks={yt} x0={x0} x1={x1} format={yFormat} baseline={y[0] <= 0 && y[1] >= 0 && !logY ? 0 : y[0]} />
      <line className="base" x1={x0} x2={x1} y1={yBot} y2={yBot} />
      {xt.map((t) => (
        <text key={'x' + t} className="ax ax-m" x={sx(t)} y={yBot + 16}>
          {xFormat(t)}
        </text>
      ))}
      {xLabel && (
        <text className="ax ax-e" x={x1} y={height - 4}>
          {xLabel}
        </text>
      )}
      <g clipPath={`url(#${clipId})`}>
        {series.map((s, i) => {
          if (!s.points.length) return null;
          const xs = s.points.map((p) => sx(p[0]));
          const ys = s.points.map((p) => sy(p[1]));
          const d = linePath(xs, ys);
          return (
            <g key={'s' + i} opacity={s.opacity}>
              {s.fillTo !== undefined && (
                <path d={`${d} L${xs[xs.length - 1]} ${sy(s.fillTo)} L${xs[0]} ${sy(s.fillTo)} Z`} fill={s.color} opacity={s.fillOpacity ?? 0.18} />
              )}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.5} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {refs.map((r, i) =>
          r.axis === 'x' ? (
            <line key={'r' + i} className={r.cursor ? 'cur' : undefined} x1={sx(r.at)} x2={sx(r.at)} y1={yTop} y2={yBot} stroke={r.cursor ? undefined : (r.color ?? '#777')} strokeWidth={r.cursor ? undefined : 1.5} strokeDasharray={r.cursor ? undefined : (r.dash ?? '5 4')} />
          ) : (
            <line key={'r' + i} className={r.cursor ? 'cur' : undefined} x1={x0} x2={x1} y1={sy(r.at)} y2={sy(r.at)} stroke={r.cursor ? undefined : (r.color ?? '#777')} strokeWidth={r.cursor ? undefined : 1.5} strokeDasharray={r.cursor ? undefined : (r.dash ?? '5 4')} />
          ),
        )}
      </g>
      {refs.map((r, i) =>
        r.label ? (
          r.axis === 'x' ? (
            <text key={'rl' + i} className="ax" x={sx(r.at) + 4} y={yTop + 12} style={r.color ? { fill: r.color } : undefined}>
              {r.label}
            </text>
          ) : (
            <text key={'rl' + i} className="ax ax-e" x={x1 - 2} y={sy(r.at) + (r.labelBelow ? 13 : -5)} style={r.color ? { fill: r.color } : undefined}>
              {r.label}
            </text>
          )
        ) : null,
      )}
      {series.map((s, i) => {
        if (!s.label || !s.points.length) return null;
        const at = s.labelAt ?? s.points[s.points.length - 1];
        return (
          <text key={'sl' + i} x={sx(at[0])} y={sy(at[1]) - 6} textAnchor={s.labelAnchor ?? 'end'} style={{ fontSize: 12, fontWeight: 500, fill: s.labelColor ?? s.color }}>
            {s.label}
          </text>
        );
      })}
      {markers.map((m, i) => (
        <g key={'m' + i}>
          <circle cx={sx(m.x)} cy={sy(m.y)} r={m.r ?? 5} fill={m.hollow ? '#fcfcfb' : m.color} stroke={m.hollow ? m.color : '#fcfcfb'} strokeWidth={m.hollow ? 2 : 1.5} />
          {m.label && (
            <text x={sx(m.x) + (m.labelDx ?? 8)} y={sy(m.y) + (m.labelDy ?? 4)} textAnchor={m.labelAnchor ?? 'start'} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
              {m.label}
            </text>
          )}
        </g>
      ))}
      {children?.(sx, sy)}
      {onScrub && (
        <rect
          x={x0}
          y={yTop}
          width={x1 - x0}
          height={yBot - yTop}
          fill="transparent"
          tabIndex={0}
          role="slider"
          aria-label={scrubLabel ?? 'Position'}
          aria-valuemin={x[0]}
          aria-valuemax={x[1]}
          aria-valuenow={scrubValue ?? x[0]}
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

export interface Segment {
  id: string;
  value: number;
  color: string;
  label?: string;
  /** Text color inside the segment (defaults to dark on light fills). */
  textColor?: string;
}

/**
 * A horizontal bar split into segments by share, labeled inside when there's room. Used for
 * yields: how a barrel splits into cuts or products.
 */
export function StackedBar({
  segments,
  total,
  width = 640,
  height = 46,
  ariaLabel,
  title,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  segments: Segment[];
  /** Full-width value (defaults to the sum). */
  total?: number;
  width?: number;
  height?: number;
  ariaLabel: string;
  title?: string;
  format?: (v: number, s: Segment) => string;
}) {
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  const top = title ? 18 : 0;
  const barH = height - top;
  let acc = 0;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {title && (
        <text className="ax" x={0} y={12}>
          {title}
        </text>
      )}
      {segments.map((s) => {
        const w = sum > 0 ? (s.value / sum) * width : 0;
        const x = acc;
        acc += w;
        const text = s.label ? `${s.label} ${format(s.value, s)}` : format(s.value, s);
        const fits = w > text.length * 6.4 + 8;
        const fitsShort = w > format(s.value, s).length * 6.6 + 6;
        return (
          <g key={s.id}>
            <rect x={x} y={top} width={Math.max(0, w - 1)} height={barH} fill={s.color} />
            {(fits || fitsShort) && (
              <text x={x + w / 2} y={top + barH / 2 + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: s.textColor ?? '#2b2b2b' }}>
                {fits ? text : format(s.value, s)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Text color that reads on a fill: dark on light colors, white on dark ones. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#2b2b2b' : '#ffffff';
}

