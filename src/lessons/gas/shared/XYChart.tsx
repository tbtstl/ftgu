// A general x–y chart in the house style: gridlines and labels on the left, a baseline, lines,
// areas, steps, bands and points, reference lines, shaded x ranges, markers and an optional
// scrubbable cursor (pointer and arrow keys). Most of the gas course's charts are one of these.

import { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GridY, clamp, linePath, niceTicks, scale } from '../../../framework';
import type { Scale } from '../../../framework/charts/scale';

export interface XYSeries {
  xs: number[];
  ys: number[];
  color: string;
  /** line (default), area (filled down to `base` or the y-domain floor), step (each x a step to the next), band (between `lows` and ys), points. */
  kind?: 'line' | 'area' | 'step' | 'band' | 'points';
  /** Lower edge for kind "band". */
  lows?: number[];
  /** Floor for kind "area" (default: the bottom of the y domain or 0, whichever is higher). */
  base?: number;
  width?: number;
  dash?: string;
  opacity?: number;
  /** Radius for kind "points". */
  r?: number;
  /** Text drawn at the series' last point. */
  label?: string;
  /** Color of that text (default: the series color; pass a TEXT color for pale series). */
  labelColor?: string;
}

export interface XYMarker {
  x: number;
  y: number;
  color: string;
  r?: number;
  label?: string;
  labelPos?: 'left' | 'right' | 'above' | 'below';
  /** Hollow ring instead of a filled dot. */
  ring?: boolean;
}

export interface XYRefLine {
  at: number;
  color?: string;
  dash?: string;
  label?: string;
  /** Where the label sits along the line: 'start' or 'end' (default end). */
  labelAt?: 'start' | 'end';
  width?: number;
}

export interface XYChartProps {
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks?: number[];
  yTicks?: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Title over the y axis, top left. */
  yLabel?: string;
  /** Title under the x axis, bottom right. */
  xLabel?: string;
  series: XYSeries[];
  markers?: XYMarker[];
  /** Vertical reference lines at x values. */
  vLines?: XYRefLine[];
  /** Horizontal reference lines at y values. */
  hLines?: XYRefLine[];
  /** Shaded x ranges. */
  bands?: Array<{ from: number; to: number; color: string; label?: string }>;
  /** x of a dashed cursor line. */
  cursor?: number;
  /** Called with an x value while the reader clicks, drags or uses the arrow keys on the chart. */
  onScrub?: (x: number) => void;
  /** Accessible name of the scrubbing control ("Day of the year"). */
  scrubLabel?: string;
  /** Step for arrow keys, in x units (default 1). */
  scrubStep?: number;
  /** viewBox width (default 640) and height (default 240). */
  width?: number;
  height?: number;
  /** Left margin for the y labels (default 56). */
  left?: number;
  ariaLabel: string;
  /** Extra SVG drawn over the series, given the chart's scales. */
  children?: (x: Scale, y: Scale) => ReactNode;
}

export function XYChart({
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xFormat = (v) => String(v),
  yFormat = (v) => String(v),
  yLabel,
  xLabel,
  series,
  markers = [],
  vLines = [],
  hLines = [],
  bands = [],
  cursor,
  onScrub,
  scrubLabel = 'Position on the chart',
  scrubStep = 1,
  width = 640,
  height = 240,
  left = 56,
  ariaLabel,
  children,
}: XYChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clip = 'xy' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const top = yLabel ? 28 : 12;
  const bottom = height - (xLabel ? 40 : 24);
  const right = width - 16;
  const x = scale(xDomain[0], xDomain[1], left, right);
  const y = scale(yDomain[0], yDomain[1], bottom, top);
  const yt = yTicks ?? niceTicks(yDomain[0], yDomain[1], 4);
  const xt = xTicks ?? niceTicks(xDomain[0], xDomain[1], 6);
  const floor = yDomain[0] <= 0 && yDomain[1] >= 0 ? 0 : yDomain[0];
  const cy = (v: number) => y(clamp(v, yDomain[0] - (yDomain[1] - yDomain[0]) * 0.05, yDomain[1] + (yDomain[1] - yDomain[0]) * 0.05));

  const toX = (e: PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return clamp(xDomain[0] + ((p.x - left) / (right - left)) * (xDomain[1] - xDomain[0]), xDomain[0], xDomain[1]);
  };
  const scrub = (e: PointerEvent<SVGRectElement>) => {
    if (!onScrub) return;
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
    const v = toX(e);
    if (v !== null) onScrub(v);
  };
  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (!onScrub) return;
    const at = cursor ?? xDomain[0];
    const big = scrubStep * 10;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? at + scrubStep
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? at - scrubStep
          : e.key === 'PageUp'
            ? at + big
            : e.key === 'PageDown'
              ? at - big
              : e.key === 'Home'
                ? xDomain[0]
                : e.key === 'End'
                  ? xDomain[1]
                  : null;
    if (next === null) return;
    e.preventDefault();
    onScrub(clamp(next, xDomain[0], xDomain[1]));
  };

  return (
    <svg ref={svgRef} className="chart" viewBox={`0 0 ${width} ${height}`} role={onScrub ? 'group' : 'img'} aria-label={ariaLabel}>
      <defs>
        <clipPath id={clip}>
          <rect x={left} y={top - 6} width={right - left} height={bottom - top + 7} />
        </clipPath>
      </defs>
      {yLabel && (
        <text className="ax" x={left} y={14}>
          {yLabel}
        </text>
      )}
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={x(Math.max(b.from, xDomain[0]))} y={top} width={Math.max(0, x(Math.min(b.to, xDomain[1])) - x(Math.max(b.from, xDomain[0])))} height={bottom - top} fill={b.color} />
          {b.label && (
            <text className="ax" x={x(Math.max(b.from, xDomain[0])) + 4} y={top + 12}>
              {b.label}
            </text>
          )}
        </g>
      ))}
      <GridY y={y} ticks={yt} x0={left} x1={right} format={yFormat} baseline={yDomain[0] <= 0 && yDomain[1] >= 0 ? 0 : yDomain[0]} />
      <g clipPath={`url(#${clip})`}>
        {series.map((s, i) => {
          const kind = s.kind ?? 'line';
          const xs = s.xs.map(x);
          if (kind === 'points')
            return (
              <g key={i} opacity={s.opacity}>
                {s.xs.map((v, j) => (
                  <circle key={j} cx={x(v)} cy={cy(s.ys[j])} r={s.r ?? 3} fill={s.color} />
                ))}
              </g>
            );
          if (kind === 'area' || kind === 'band') {
            const lows = kind === 'band' ? (s.lows ?? s.ys.map(() => floor)) : s.ys.map(() => s.base ?? floor);
            let d = '';
            xs.forEach((px, j) => (d += (j ? ' L' : 'M') + px.toFixed(1) + ' ' + cy(s.ys[j]).toFixed(1)));
            for (let j = xs.length - 1; j >= 0; j--) d += ' L' + xs[j].toFixed(1) + ' ' + cy(lows[j]).toFixed(1);
            return <path key={i} d={d + ' Z'} fill={s.color} opacity={s.opacity ?? 0.3} />;
          }
          if (kind === 'step') {
            let d = '';
            xs.forEach((px, j) => {
              const nx = j + 1 < xs.length ? xs[j + 1] : px;
              d += (j ? ' L' : 'M') + px.toFixed(1) + ' ' + cy(s.ys[j]).toFixed(1) + ' L' + nx.toFixed(1) + ' ' + cy(s.ys[j]).toFixed(1);
            });
            return <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} opacity={s.opacity} />;
          }
          return (
            <path
              key={i}
              d={linePath(xs, s.ys.map(cy))}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              opacity={s.opacity}
            />
          );
        })}
        {hLines.map((h, i) => (
          <line key={'h' + i} x1={left} x2={right} y1={y(h.at)} y2={y(h.at)} stroke={h.color ?? '#333'} strokeWidth={h.width ?? 1.5} strokeDasharray={h.dash ?? '6 4'} />
        ))}
        {vLines.map((v, i) => (
          <line key={'v' + i} x1={x(v.at)} x2={x(v.at)} y1={top} y2={bottom} stroke={v.color ?? '#333'} strokeWidth={v.width ?? 1.5} strokeDasharray={v.dash ?? '6 4'} />
        ))}
      </g>
      {hLines.map((h, i) =>
        h.label ? (
          <text
            key={'hl' + i}
            className={h.labelAt === 'start' ? 'ax' : 'ax ax-e'}
            x={h.labelAt === 'start' ? left + 4 : right}
            y={y(h.at) - 5}
            style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
          >
            {h.label}
          </text>
        ) : null,
      )}
      {vLines.map((v, i) =>
        v.label ? (
          <text
            key={'vl' + i}
            className={x(v.at) > (left + right) / 2 ? 'ax ax-e' : 'ax'}
            x={x(v.at) + (x(v.at) > (left + right) / 2 ? -5 : 5)}
            y={v.labelAt === 'end' ? bottom - 6 : top + 12}
            style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
          >
            {v.label}
          </text>
        ) : null,
      )}
      <line className="base" x1={left} x2={right} y1={bottom} y2={bottom} />
      {xt.map((t, i) => (
        <text key={t} className={i === xt.length - 1 && x(t) > right - 20 ? 'ax ax-e' : 'ax ax-m'} x={i === xt.length - 1 && x(t) > right - 20 ? x(t) + 2 : x(t)} y={bottom + 16}>
          {xFormat(t)}
        </text>
      ))}
      {xLabel && (
        <text className="ax ax-e" x={right} y={height - 4}>
          {xLabel}
        </text>
      )}
      {series.map((s, i) =>
        s.label && s.xs.length ? (
          <text
            key={'sl' + i}
            className="ax ax-e"
            x={x(s.xs[s.xs.length - 1]) - 4}
            y={cy(s.ys[s.ys.length - 1]) - 7}
            style={{ fill: s.labelColor ?? s.color, fontWeight: 500, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
          >
            {s.label}
          </text>
        ) : null,
      )}
      {children?.(x, y)}
      {cursor !== undefined && cursor >= xDomain[0] && cursor <= xDomain[1] && <line className="cur" x1={x(cursor)} x2={x(cursor)} y1={top - 4} y2={bottom} />}
      {markers.map((m, i) => {
        const mx = x(m.x);
        const my = cy(m.y);
        const r = m.r ?? 5;
        const pos = m.labelPos ?? 'right';
        const lx = pos === 'left' ? mx - r - 5 : pos === 'right' ? mx + r + 5 : mx;
        const ly = pos === 'above' ? my - r - 6 : pos === 'below' ? my + r + 14 : my + 4;
        return (
          <g key={'m' + i}>
            <circle cx={mx} cy={my} r={r} fill={m.ring ? 'none' : m.color} stroke={m.ring ? m.color : '#fcfcfb'} strokeWidth={2} />
            {m.label && (
              <text
                x={lx}
                y={ly}
                textAnchor={pos === 'left' ? 'end' : pos === 'right' ? 'start' : mx > right - 50 ? 'end' : mx < left + 50 ? 'start' : 'middle'}
                style={{ fontSize: 12, fontWeight: 500, fill: m.color, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
              >
                {m.label}
              </text>
            )}
          </g>
        );
      })}
      {onScrub && (
        <rect
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          fill="transparent"
          tabIndex={0}
          role="slider"
          aria-label={scrubLabel}
          aria-valuemin={xDomain[0]}
          aria-valuemax={xDomain[1]}
          aria-valuenow={cursor ?? xDomain[0]}
          aria-valuetext={xFormat(cursor ?? xDomain[0])}
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
