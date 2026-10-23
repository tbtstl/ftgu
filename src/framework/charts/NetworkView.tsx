import type { KeyboardEvent, ReactNode } from 'react';
import { fmt } from '../format';

export interface NetNode {
  id: string;
  x: number;
  y: number;
  /** Name drawn next to the node ("A", "Riverside"). */
  label?: string;
  labelPos?: 'above' | 'below' | 'left' | 'right';
  labelColor?: string;
  /** Big text inside the node (a price, a voltage). */
  value?: string;
  /** Small text under the value. */
  sub?: string;
  fill?: string;
  r?: number;
  /** Dashed outline for a de-energized or islanded node. */
  dead?: boolean;
}

export interface NetLine {
  id: string;
  from: string;
  to: string;
  /** MW, positive from → to. */
  flow: number;
  /** Thermal limit in MW; colors the line by loading. */
  limit?: number;
  /** Out of service: drawn dashed with no flow. */
  out?: boolean;
  /** Overrides the default "120 / 250 MW" label; empty string hides it. */
  label?: string;
  /** Label offset from the line midpoint (viewBox units). */
  labelDx?: number;
  labelDy?: number;
}

/** Line color by loading: gray under 80%, orange near the limit, red at or over it. */
export function loadingColor(flow: number, limit?: number, out?: boolean): string {
  if (out) return '#d6d6d6';
  if (!limit) return '#c4c4c4';
  const u = Math.abs(flow) / limit;
  if (u > 1.001) return '#b8302a';
  if (u >= 0.999) return '#e75b55';
  if (u >= 0.8) return '#eda06f';
  return '#c4c4c4';
}

/**
 * A power network drawn as nodes and lines, with moving dots showing the direction and size of
 * each flow. Use it for every grid diagram so lines, loadings and labels look the same everywhere.
 */
export function NetworkView({
  nodes,
  lines,
  width = 600,
  height = 400,
  flowScale = 0.4,
  onLineClick,
  onNodeClick,
  lineAction = 'Toggle',
  ariaLabel,
  children,
}: {
  nodes: NetNode[];
  lines: NetLine[];
  width?: number;
  height?: number;
  /** Dot speed in viewBox units per second per MW. */
  flowScale?: number;
  onLineClick?: (id: string) => void;
  onNodeClick?: (id: string) => void;
  /** What clicking a line does, for screen readers ("Toggle", "Select"). */
  lineAction?: string;
  ariaLabel: string;
  /** Extra SVG drawn on top (annotations, generator icons). */
  children?: ReactNode;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const key = (fn?: (id: string) => void, id?: string) => (e: KeyboardEvent) => {
    if (fn && id && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      fn(id);
    }
  };

  return (
    <svg className="diagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {lines.map((l) => {
        const a = byId.get(l.from);
        const b = byId.get(l.to);
        if (!a || !b) return null;
        const col = loadingColor(l.flow, l.limit, l.out);
        const fwd = l.flow >= 0;
        const d = fwd ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${b.x} ${b.y} L${a.x} ${a.y}`;
        const speed = Math.abs(l.flow) * flowScale;
        const moving = !l.out && speed > 0.5;
        const mx = (a.x + b.x) / 2 + (l.labelDx ?? 0);
        const my = (a.y + b.y) / 2 + (l.labelDy ?? -10);
        const text = l.label ?? (l.out ? 'out of service' : l.limit ? `${fmt(Math.abs(l.flow))} / ${fmt(l.limit)} MW` : `${fmt(Math.abs(l.flow))} MW`);
        const interactive = !!onLineClick;
        return (
          <g
            key={l.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Line ${a.label ?? a.id}–${b.label ?? b.id}: ${l.out ? 'out of service' : 'in service'}. ${lineAction}.` : undefined}
            onClick={interactive ? () => onLineClick?.(l.id) : undefined}
            onKeyDown={key(onLineClick, l.id)}
            style={interactive ? { cursor: 'pointer' } : undefined}
          >
            {interactive && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={28} />}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={l.out ? 4 : 10} strokeLinecap="round" strokeDasharray={l.out ? '6 8' : undefined} />
            {moving && (
              <path
                d={d}
                className="flow-dots"
                stroke="#fff"
                strokeWidth={4.5}
                style={{ animationDuration: `${(18 / speed).toFixed(3)}s` }}
              />
            )}
            {text && (
              <text className="lab" x={mx} y={my} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#f8f8f8', strokeWidth: 4 }}>
                {text}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const r = n.r ?? 30;
        const pos = n.labelPos ?? 'above';
        const lx = pos === 'left' ? n.x - r - 8 : pos === 'right' ? n.x + r + 8 : n.x;
        const ly = pos === 'above' ? n.y - r - 10 : pos === 'below' ? n.y + r + 20 : n.y + 5;
        const anchor = pos === 'left' ? 'end' : pos === 'right' ? 'start' : 'middle';
        const interactive = !!onNodeClick;
        return (
          <g
            key={n.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Node ${n.label ?? n.id}` : undefined}
            onClick={interactive ? () => onNodeClick?.(n.id) : undefined}
            onKeyDown={key(onNodeClick, n.id)}
            style={interactive ? { cursor: 'pointer' } : undefined}
          >
            <circle cx={n.x} cy={n.y} r={r} fill={n.fill ?? '#fff'} stroke={n.dead ? '#9a9a9a' : '#555'} strokeWidth={1.5} strokeDasharray={n.dead ? '4 4' : undefined} />
            {n.value && (
              <text x={n.x} y={n.sub ? n.y + 5 : n.y + 6} textAnchor="middle" style={{ fontFamily: 'var(--display)', fontSize: r > 32 ? 20 : 15, fontWeight: 600, fill: '#222' }}>
                {n.value}
              </text>
            )}
            {n.sub && (
              <text x={n.x} y={n.y + 20} textAnchor="middle" style={{ fontSize: 10.5, fill: '#333' }}>
                {n.sub}
              </text>
            )}
            {n.label && (
              <text x={lx} y={ly} textAnchor={anchor} style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, fill: n.labelColor ?? '#444' }}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
