// The gas course's region drawn as a map: land and sea, the two producing basins, Calder Hub,
// Metro and Bayport, the pipelines between them (width by size, color by how full they are,
// moving dots for flow) and the two storage fields. Drawn in the world's 600 × 400 coordinates,
// so every lesson shows the same places in the same spots.

import type { KeyboardEvent, ReactNode } from 'react';
import { TEXT, fmt, loadingColor } from '../../../framework';
import { CORRIDORS, GAS_NODES, GAS_NODE, PIPELINE, STORAGE_FIELDS, type GasNodeId } from '../../../model/gas/world';

const LAND = '#f2f0e9';
const SEA = '#d6e5f1';
const SEA_EDGE = '#a9c3d9';
const CONTOUR = '#e0d9c8';

export interface NodeInfo {
  /** Big text in the node (a price, a demand). */
  value?: string;
  /** Small text under it. */
  sub?: string;
  fill?: string;
}

export interface GasMapProps {
  ariaLabel: string;
  /** Flow on each pipeline or corridor (Bcf/d), positive from its `from` node to its `to` node. */
  flows?: Record<string, number>;
  /** Capacity of each pipeline (Bcf/d), for coloring by loading; defaults to the world's. */
  capacities?: Record<string, number>;
  /** Pipelines that exist (default: the world's six). Corridors not listed are hidden unless `showCorridors`. */
  built?: string[];
  /** Draw unbuilt corridors as faint dashed lines (for building networks). */
  showCorridors?: boolean;
  /** Nominal size (inches) of each built pipeline, for its drawn width; defaults to the world's. */
  sizes?: Record<string, number>;
  /** Text inside each node. */
  nodeInfo?: (id: GasNodeId) => NodeInfo | undefined;
  /** Label beside each pipeline; defaults to "flow / capacity" when flows are given, else the name. Empty string hides it. */
  pipeLabel?: (id: string) => string | undefined;
  /** Show the storage fields; a function gives each one's caption (e.g. its inventory). */
  storage?: boolean | ((id: string) => string | undefined);
  selected?: { kind: 'node' | 'pipe'; id: string } | null;
  onNodeClick?: (id: GasNodeId) => void;
  onPipeClick?: (id: string) => void;
  /** Flow-dot speed per Bcf/d. */
  flowScale?: number;
  height?: number;
  children?: ReactNode;
}

/** Where each pipeline's label sits relative to its midpoint. */
const LABEL_OFFSET: Record<string, [number, number]> = {
  'ridgeback-calder': [-14, 22],
  'ridgeback-bayport': [0, 20],
  'sandhill-calder': [12, -12],
  'sandhill-metro': [0, -10],
  'calder-metro': [44, 6],
  'calder-bayport': [52, -2],
  'ridgeback-sandhill': [-34, 0],
  'bayport-metro': [36, 0],
};

function key(fn: ((id: string) => void) | undefined, id: string) {
  return (e: KeyboardEvent) => {
    if (fn && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      fn(id);
    }
  };
}

export function GasMap({
  ariaLabel,
  flows,
  capacities,
  built = Object.keys(PIPELINE),
  showCorridors = false,
  sizes,
  nodeInfo,
  pipeLabel,
  storage = true,
  selected,
  onNodeClick,
  onPipeClick,
  flowScale = 40,
  height = 400,
  children,
}: GasMapProps) {
  const corridors = CORRIDORS.filter((c) => built.includes(c.id) || showCorridors);
  return (
    <svg className="diagram" viewBox={`0 0 600 ${height}`} role={onNodeClick || onPipeClick ? 'group' : 'img'} aria-label={ariaLabel}>
      <rect x={0} y={0} width={600} height={height} fill={LAND} />
      {/* The sea along the southeast, with Bayport on its shore. */}
      <path d={`M600 ${height} L600 250 C 570 262, 552 300, 540 318 C 528 338, 500 356, 470 364 C 430 376, 380 382, 330 ${height} Z`} fill={SEA} stroke={SEA_EDGE} strokeWidth={1.5} />
      <text x={576} y={height - 14} textAnchor="end" style={{ fontSize: 12, fontStyle: 'italic', fill: '#6c8aa6' }}>
        sea
      </text>
      {/* Hills over the basins. */}
      {[0, 1, 2].map((i) => (
        <ellipse key={'r' + i} cx={96} cy={292} rx={52 + i * 18} ry={30 + i * 11} fill="none" stroke={CONTOUR} strokeWidth={1.2} />
      ))}
      {[0, 1].map((i) => (
        <ellipse key={'s' + i} cx={110} cy={96} rx={44 + i * 18} ry={26 + i * 10} fill="none" stroke={CONTOUR} strokeWidth={1.2} />
      ))}
      <text x={96} y={352} textAnchor="middle" style={{ fontSize: 11, fill: '#8a7f66', fontStyle: 'italic' }}>
        Ridgeback shale
      </text>
      <text x={110} y={150} textAnchor="middle" style={{ fontSize: 11, fill: '#8a7f66', fontStyle: 'italic' }}>
        Sandhill field
      </text>

      {corridors.map((c) => {
        const a = GAS_NODE[c.from];
        const b = GAS_NODE[c.to];
        const isBuilt = built.includes(c.id);
        const f = flows?.[c.id] ?? 0;
        const cap = capacities?.[c.id] ?? PIPELINE[c.id]?.capacityBcfd;
        const size = sizes?.[c.id] ?? PIPELINE[c.id]?.sizeIn ?? 24;
        const w = isBuilt ? 2 + size / 6 : 2;
        const col = isBuilt ? (flows ? loadingColor(f, cap) : '#b9b4a6') : '#cfc9b9';
        const fwd = f >= 0;
        const d = fwd ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${b.x} ${b.y} L${a.x} ${a.y}`;
        const speed = Math.abs(f) * flowScale;
        const [dx, dy] = LABEL_OFFSET[c.id] ?? [0, -10];
        const mx = (a.x + b.x) / 2 + dx;
        const my = (a.y + b.y) / 2 + dy;
        const name = PIPELINE[c.id]?.name;
        const text =
          pipeLabel?.(c.id) ??
          (isBuilt ? (flows ? `${fmt(Math.abs(f), 2)}${cap ? ` / ${fmt(cap, 2)}` : ''}` : (name ?? '')) : '');
        const sel = selected?.kind === 'pipe' && selected.id === c.id;
        const interactive = !!onPipeClick;
        return (
          <g
            key={c.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${name ?? `Corridor ${GAS_NODE[c.from].name}–${GAS_NODE[c.to].name}`}, ${c.lengthMi} miles${isBuilt ? '' : ', not built'}. Select.` : undefined}
            onClick={interactive ? () => onPipeClick?.(c.id) : undefined}
            onKeyDown={key(onPipeClick, c.id)}
            style={interactive ? { cursor: 'pointer' } : undefined}
          >
            {interactive && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={26} />}
            {sel && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={TEXT.green} strokeWidth={w + 8} strokeOpacity={0.25} strokeLinecap="round" />}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={col}
              strokeWidth={w}
              strokeLinecap="round"
              strokeDasharray={isBuilt ? undefined : '5 7'}
            />
            {isBuilt && speed > 0.5 && (
              <path d={d} className="flow-dots" stroke="#fff" strokeWidth={Math.max(2.5, w * 0.45)} style={{ animationDuration: `${(18 / speed).toFixed(3)}s` }} />
            )}
            {text && (
              <text className="lab" x={mx} y={my} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: LAND, strokeWidth: 4 }}>
                {text}
              </text>
            )}
          </g>
        );
      })}

      {storage &&
        STORAGE_FIELDS.map((s) => {
          const n = GAS_NODE[s.node];
          const cap = typeof storage === 'function' ? storage(s.id) : undefined;
          const left = s.id === 'hollowcreek';
          return (
            <g key={s.id}>
              <line x1={n.x} y1={n.y} x2={s.x} y2={s.y} stroke="#b9b4a6" strokeWidth={2} strokeDasharray="2 3" />
              <path d={`M${s.x - 14} ${s.y + 6} Q ${s.x} ${s.y - 14} ${s.x + 14} ${s.y + 6} Z`} fill="#e8d9a8" stroke="#a88c3c" strokeWidth={1.2} />
              <text x={s.x + (left ? -18 : 18)} y={s.y + 2} textAnchor={left ? 'end' : 'start'} style={{ fontSize: 11.5, fontWeight: 500, fill: '#7a6420' }}>
                {s.name}
              </text>
              <text x={s.x + (left ? -18 : 18)} y={s.y + 16} textAnchor={left ? 'end' : 'start'} style={{ fontSize: 11, fill: '#6b6b6b' }}>
                {cap ?? (s.kind === 'salt' ? 'salt caverns' : 'old gas reservoir')}
              </text>
            </g>
          );
        })}

      {GAS_NODES.map((n) => {
        const info = nodeInfo?.(n.id);
        const r = info?.value ? 30 : 14;
        const sel = selected?.kind === 'node' && selected.id === n.id;
        const pos = n.labelPos;
        const lx = pos === 'left' ? n.x - r - 8 : pos === 'right' ? n.x + r + 8 : n.x;
        const ly = pos === 'above' ? n.y - r - 10 : pos === 'below' ? n.y + r + 18 : n.y + 5;
        const anchor = pos === 'left' ? 'end' : pos === 'right' ? 'start' : 'middle';
        const interactive = !!onNodeClick;
        return (
          <g
            key={n.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${n.name}, ${n.kind}. Select.` : undefined}
            onClick={interactive ? () => onNodeClick?.(n.id) : undefined}
            onKeyDown={key(onNodeClick as ((id: string) => void) | undefined, n.id)}
            style={interactive ? { cursor: 'pointer' } : undefined}
          >
            {sel && <circle cx={n.x} cy={n.y} r={r + 7} fill="none" stroke={TEXT.green} strokeWidth={2} strokeDasharray="5 4" />}
            <circle cx={n.x} cy={n.y} r={r} fill={info?.fill ?? '#fff'} stroke="#111" strokeWidth={1} />
            {info?.value && (
              <text x={n.x} y={info.sub ? n.y + 3 : n.y + 5} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: '#111' }}>
                {info.value}
              </text>
            )}
            {info?.sub && (
              <text x={n.x} y={n.y + 17} textAnchor="middle" style={{ fontSize: 10, fill: '#333' }}>
                {info.sub}
              </text>
            )}
            <text x={lx} y={ly} textAnchor={anchor} style={{ fontSize: 13.5, fontWeight: 600, fill: '#111', paintOrder: 'stroke', stroke: LAND, strokeWidth: 4 }}>
              {n.name}
            </text>
          </g>
        );
      })}
      {children}
    </svg>
  );
}
