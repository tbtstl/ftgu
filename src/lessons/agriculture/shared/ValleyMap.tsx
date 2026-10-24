// The Crane Valley on a map: its five districts, the Crane River, the rail line west, and the
// places that handle grain. Districts can be filled and labeled by any number, and selected with
// a click or the keyboard.

import type { KeyboardEvent, ReactNode } from 'react';
import { DISTRICTS, PLACES, RAIL_PATH, RIVER_PATH, type DistrictId, type Place } from '../../../model/agriculture/region';

const WATER = '#9cc3e4';

export interface ValleyMapProps {
  /** Fill for each district. */
  fill?: (id: DistrictId) => string;
  /** One or two short lines printed in each district. */
  label?: (id: DistrictId) => [string, string?];
  selected?: DistrictId | null;
  onSelect?: (id: DistrictId) => void;
  /** Which places to mark: all, none, or a list of ids. */
  places?: 'all' | 'none' | string[];
  showRail?: boolean;
  ariaLabel: string;
  /** Extra SVG drawn on top (routes, flows). */
  children?: ReactNode;
  height?: number;
}

function centroid(poly: Array<[number, number]>): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

const PLACE_SHAPE: Record<Place['kind'], string> = {
  elevator: 'M-5 5 L-5 -3 L0 -7 L5 -3 L5 5 Z',
  terminal: 'M-6 5 L-6 -4 L6 -4 L6 5 Z',
  ethanol: 'M-4 5 L-4 -6 L4 -6 L4 5 Z',
  feedlot: 'M-6 5 L-6 0 L6 0 L6 5 Z',
  mill: 'M-5 5 L-5 -5 L5 -5 L5 5 Z',
  port: 'M0 -7 L7 0 L0 7 L-7 0 Z',
};

export function ValleyMap({ fill, label, selected, onSelect, places = 'all', showRail = true, ariaLabel, children, height = 400 }: ValleyMapProps) {
  const shown = places === 'all' ? PLACES : places === 'none' ? [] : PLACES.filter((p) => places.includes(p.id));
  const key = (id: DistrictId) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(id);
    }
  };
  return (
    <svg className="diagram" viewBox={`0 0 640 ${height}`} role={onSelect ? 'group' : 'img'} aria-label={ariaLabel}>
      {DISTRICTS.map((d) => {
        const pts = d.polygon.map(([x, y]) => `${x},${y}`).join(' ');
        const isSel = selected === d.id;
        return (
          <g
            key={d.id}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? `${d.name}${label ? `: ${label(d.id).filter(Boolean).join(', ')}` : ''}` : undefined}
            aria-pressed={onSelect ? isSel : undefined}
            onClick={onSelect ? () => onSelect(d.id) : undefined}
            onKeyDown={onSelect ? key(d.id) : undefined}
            style={{ cursor: onSelect ? 'pointer' : undefined, outline: 'none' }}
          >
            <polygon points={pts} fill={fill ? fill(d.id) : '#efeadf'} stroke={isSel ? '#333' : '#fcfcfb'} strokeWidth={isSel ? 2.5 : 2} />
          </g>
        );
      })}
      <path d={RIVER_PATH} fill="none" stroke={WATER} strokeWidth={6} strokeLinecap="round" />
      {showRail && <path d={RAIL_PATH} fill="none" stroke="#6b6b6b" strokeWidth={2} strokeDasharray="7 4" />}
      {DISTRICTS.map((d) => {
        const [lx, ly] = d.label ?? centroid(d.polygon);
        const lines = label ? label(d.id) : [d.name];
        return (
          <g key={`l-${d.id}`} pointerEvents="none">
            <text className="lab" x={lx} y={ly} textAnchor="middle" style={{ fontSize: 13 }}>
              {d.name}
            </text>
            {lines[0] && label && (
              <text className="ax" x={lx} y={ly + 16} textAnchor="middle" style={{ fill: '#333', fontSize: 12.5 }}>
                {lines[0]}
              </text>
            )}
            {lines[1] && (
              <text className="ax" x={lx} y={ly + 31} textAnchor="middle" style={{ fill: '#333', fontSize: 12.5 }}>
                {lines[1]}
              </text>
            )}
          </g>
        );
      })}
      {shown.map((p) => (
        <g key={p.id} transform={`translate(${Math.min(632, Math.max(8, p.x))},${Math.min(height - 8, Math.max(8, p.y))})`} pointerEvents="none">
          <path d={PLACE_SHAPE[p.kind]} fill="#fcfcfb" stroke="#444" strokeWidth={1.4} />
          <text className="ax" x={p.kind === 'port' ? (p.x < 320 ? 10 : -10) : 8} y={p.kind === 'port' ? -10 : 4} textAnchor={p.kind === 'port' && p.x > 320 ? 'end' : 'start'} style={{ fill: '#444' }}>
            {p.name}
          </text>
        </g>
      ))}
      {children}
    </svg>
  );
}
