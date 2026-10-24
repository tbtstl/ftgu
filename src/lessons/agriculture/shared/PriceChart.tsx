// A price chart over the days of a crop year: one or more series against the calendar, with
// optional marks (a trade, an expiry), vertical lines (report days) and a shaded band. Days are
// days of the growing year; the following year's run on from 365.

import type { ReactNode } from 'react';
import { GridY, linePath, niceDomain, niceTicks, scale, usd } from '../../../framework';
import { MONTHS, MONTH_START } from '../../../model/agriculture/region';

export interface PriceSeries {
  days: number[];
  values: number[];
  color: string;
  dashed?: boolean;
  width?: number;
}

export interface PriceMark {
  day: number;
  value: number;
  color: string;
  label?: string;
  /** Put the label to the left of the mark. */
  left?: boolean;
}

export interface PriceChartProps {
  series: PriceSeries[];
  from: number;
  to: number;
  ariaLabel: string;
  marks?: PriceMark[];
  vlines?: Array<{ day: number; label?: string }>;
  band?: { from: number; to: number; lo: number; hi: number; color: string };
  /** Fixed y range; otherwise fitted to the series. */
  domain?: [number, number];
  title?: string;
  height?: number;
  format?: (v: number) => string;
  children?: (x: (d: number) => number, y: (v: number) => number) => ReactNode;
}

export function PriceChart({ series, from, to, ariaLabel, marks = [], vlines = [], band, domain, title = 'Price, $ a bushel', height = 240, format = (v) => usd(v, 2), children }: PriceChartProps) {
  const all = series.flatMap((s) => s.values).concat(marks.map((m) => m.value));
  if (band) all.push(band.lo, band.hi);
  const finite = all.filter((v) => Number.isFinite(v));
  const [lo, hi] = domain ?? niceDomain(Math.min(...finite), Math.max(...finite), 4);
  const bottom = height - 30;
  const x = scale(from, to, 60, 620);
  const y = scale(lo, hi, bottom, 24);
  const ticks = niceTicks(lo, hi, 4);
  const months: Array<{ d: number; m: string }> = [];
  for (let yr = 0; yr < 3; yr++)
    MONTH_START.forEach((s, i) => {
      const d = s + yr * 365;
      if (d >= from && d <= to) months.push({ d, m: MONTHS[i] });
    });
  const step = months.length > 9 ? 2 : 1;
  return (
    <svg className="chart" viewBox={`0 0 640 ${height}`} role="img" aria-label={ariaLabel}>
      <text className="ax" x={60} y={14}>
        {title}
      </text>
      <GridY y={y} ticks={ticks} x0={60} x1={620} format={format} />
      {band && <rect x={x(band.from)} y={y(band.hi)} width={Math.max(1, x(band.to) - x(band.from))} height={Math.max(1, y(band.lo) - y(band.hi))} fill={band.color} />}
      {vlines.map((v, i) => (
        <g key={i}>
          <line x1={x(v.day)} x2={x(v.day)} y1={24} y2={bottom} stroke="#999" strokeDasharray="3 3" />
          {v.label && (
            <text className="ax ax-m" x={x(v.day)} y={22} style={{ fontSize: 10.5 }}>
              {v.label}
            </text>
          )}
        </g>
      ))}
      {series.map((s, i) => (
        <path
          key={i}
          d={linePath(
            s.days.map(x),
            s.values.map((v) => y(Math.max(lo, Math.min(hi, v)))),
          )}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width ?? 2.2}
          strokeDasharray={s.dashed ? '6 4' : undefined}
        />
      ))}
      {children?.(x, y)}
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={x(m.day)} cy={y(m.value)} r={5} fill={m.color} stroke="#fcfcfb" strokeWidth={1.5} />
          {m.label && (
            <text className="ax" x={x(m.day) + (m.left ? -8 : 8)} y={y(m.value) - 8} textAnchor={m.left ? 'end' : 'start'} style={{ fill: '#333' }}>
              {m.label}
            </text>
          )}
        </g>
      ))}
      {months
        .filter((_, i) => i % step === 0)
        .map((k) => (
          <text key={k.d} className="ax ax-m" x={x(k.d + 14)} y={height - 10}>
            {k.m}
          </text>
        ))}
    </svg>
  );
}

/** Evenly spaced days from `from` to `to`, `step` apart, always including `to`. */
export function daysBetween(from: number, to: number, step = 3): number[] {
  const out: number[] = [];
  for (let d = from; d < to; d += step) out.push(d);
  out.push(to);
  return out;
}
