// A small Sankey diagram: nodes in columns, links drawn as bands whose thickness is the flow.
// Used for barrels moving through the refinery (crudes → cuts → units → products).

import { fmt } from '../../../framework';
import { inkOn } from './charts';

export interface SankeyNode {
  id: string;
  label: string;
  /** Column, 0 at the left. */
  layer: number;
  color: string;
  /** Text after the label, e.g. "42 kb/d". Defaults to the node's throughput. */
  value?: string;
  /** Put the label on the left of the node (default: right, except the last column). */
  labelLeft?: boolean;
  /** Put the label centered over the node instead. */
  labelAbove?: boolean;
}

export interface SankeyLink {
  from: string;
  to: string;
  value: number;
  color?: string;
}

/**
 * Lays nodes out top to bottom in each column (in the order given), sized by throughput, and
 * links them with bands. Flows below `minValue` are omitted.
 */
export function Sankey({
  nodes,
  links,
  width = 660,
  height = 380,
  columns,
  scaleFactor,
  ariaLabel,
  minValue = 0.05,
  unit = 'kb/d',
  gap = 10,
}: {
  nodes: SankeyNode[];
  links: SankeyLink[];
  width?: number;
  height?: number;
  /** x position of each column's nodes (left edge). */
  columns: number[];
  /** Pixels per unit of flow (default: fit the busiest column). */
  scaleFactor?: number;
  ariaLabel: string;
  minValue?: number;
  unit?: string;
  gap?: number;
}) {
  const NW = 12;
  const ls = links.filter((l) => l.value >= minValue);
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of ls) {
    outflow.set(l.from, (outflow.get(l.from) ?? 0) + l.value);
    inflow.set(l.to, (inflow.get(l.to) ?? 0) + l.value);
  }
  const through = (id: string) => Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);
  const shown = nodes.filter((n) => through(n.id) >= minValue);
  const layers = Math.max(...shown.map((n) => n.layer), 0) + 1;
  const byLayer = Array.from({ length: layers }, (_, i) => shown.filter((n) => n.layer === i));
  const top = 24;
  const bottom = height - 10;
  const k =
    scaleFactor ??
    Math.min(
      ...byLayer
        .filter((l) => l.length)
        .map((l) => (bottom - top - gap * (l.length - 1)) / Math.max(1e-9, l.reduce((s, n) => s + through(n.id), 0))),
    );
  const pos = new Map<string, { x: number; y: number; h: number }>();
  byLayer.forEach((col, li) => {
    const total = col.reduce((s, n) => s + through(n.id) * k, 0) + gap * Math.max(0, col.length - 1);
    let y = top + Math.max(0, (bottom - top - total) / 2);
    for (const n of col) {
      const h = Math.max(2, through(n.id) * k);
      pos.set(n.id, { x: columns[li] ?? 0, y, h });
      y += h + gap;
    }
  });
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const order = (id: string) => {
    const n = shown.find((m) => m.id === id);
    const p = pos.get(id);
    return (n?.layer ?? 0) * 10000 + (p?.y ?? 0);
  };
  // Sort links so bands leave and enter in the vertical order of their other ends.
  const sorted = [...ls].sort((a, b) => order(a.to) - order(b.to) || order(a.from) - order(b.from));
  const bands = sorted
    .map((l) => {
      const a = pos.get(l.from);
      const b = pos.get(l.to);
      if (!a || !b) return null;
      const w = l.value * k;
      const oa = outOff.get(l.from) ?? 0;
      outOff.set(l.from, oa + w);
      return { l, a, b, w, oa };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const sortedIn = [...bands].sort((p, q) => order(p.l.from) - order(q.l.from) || p.a.y + p.oa - (q.a.y + q.oa));
  const inStart = new Map<SankeyLink, number>();
  for (const bd of sortedIn) {
    const ob = inOff.get(bd.l.to) ?? 0;
    inOff.set(bd.l.to, ob + bd.w);
    inStart.set(bd.l, ob);
  }
  const colorOf = (id: string) => shown.find((n) => n.id === id)?.color ?? '#999';
  return (
    <svg className="diagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {bands.map(({ l, a, b, w, oa }, i) => {
        const ob = inStart.get(l) ?? 0;
        const x0 = a.x + NW;
        const x1 = b.x;
        const y0 = a.y + oa;
        const y1 = b.y + ob;
        const xm = (x0 + x1) / 2;
        const d = `M${x0} ${y0} C${xm} ${y0} ${xm} ${y1} ${x1} ${y1} L${x1} ${y1 + w} C${xm} ${y1 + w} ${xm} ${y0 + w} ${x0} ${y0 + w} Z`;
        return <path key={i} d={d} fill={l.color ?? colorOf(l.from)} opacity={0.42} />;
      })}
      {shown.map((n) => {
        const p = pos.get(n.id)!;
        const last = n.layer === layers - 1;
        const left = n.labelLeft ?? last;
        const value = n.value ?? `${fmt(through(n.id), through(n.id) < 10 ? 1 : 0)} ${unit}`;
        if (n.labelAbove)
          return (
            <g key={n.id}>
              <rect x={p.x} y={p.y} width={NW} height={p.h} fill={n.color} />
              <text
                x={p.x + NW / 2}
                y={p.y - 5}
                textAnchor="middle"
                style={{ fontSize: 11.5, fontWeight: 500, fill: '#333', paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
              >
                {n.label}
              </text>
            </g>
          );
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={NW} height={p.h} fill={n.color} />
            <text
              x={left ? p.x - 5 : p.x + NW + 5}
              y={p.y + Math.min(p.h / 2, 30) + 4}
              textAnchor={left ? 'end' : 'start'}
              style={{ fontSize: 11.5, fontWeight: 500, fill: '#333', paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
            >
              {n.label}
              <tspan style={{ fontWeight: 400, fill: '#5f5f5f' }}> {value}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export { inkOn };
