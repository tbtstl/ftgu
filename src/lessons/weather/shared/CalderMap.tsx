// A map of the weather course's fictional region: the coast and the bay, the port city of Calder
// Bay, the corn plains around Marlow and the wind farm on Hollin Ridge. Drawn in a 600 × 400 frame
// where one unit is about a kilometer, with north up. Figures draw their own overlays (fronts,
// storms, wind arrows) as children, in the same coordinates.

import type { KeyboardEvent, ReactNode } from 'react';
import { STATIONS, type StationId } from '../../../model/weather/region';

const LAND = '#f2f0e9';
const WATER = '#d6e5f1';
const WATER_EDGE = '#a9c3d9';
const CONTOUR = '#d8d2c2';
const FIELD = '#e8e4cf';

/** The coastline, north to south; the sea lies to its east. */
export const COAST =
  'M560 0 C548 40 566 80 552 120 C540 160 556 190 540 214 C532 224 524 226 518 232 C524 240 536 244 540 256 C552 290 540 330 556 360 C562 376 560 390 566 400';
const SEA = `${COAST} L600 400 L600 0 Z`;
const RIVER = 'M300 118 C320 150 360 168 392 190 C428 214 470 226 518 232';

/** Map position of a station. */
export function stationXY(id: StationId): { x: number; y: number } {
  return { x: STATIONS[id].x, y: STATIONS[id].y };
}

function Turbine({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <line x1={x} y1={y} x2={x} y2={y - 11} stroke="#8a8a8a" strokeWidth={1.2} />
      {[0, 120, 240].map((a) => (
        <line key={a} x1={x} y1={y - 11} x2={x} y2={y - 18} stroke="#7a7a7a" strokeWidth={1.2} strokeLinecap="round" transform={`rotate(${a} ${x} ${y - 11})`} />
      ))}
    </g>
  );
}

export interface CalderMapProps {
  /** Drawn over the land and sea, under the station markers. */
  children?: ReactNode;
  /** Drawn over everything. */
  overlay?: ReactNode;
  highlight?: StationId | null;
  /** Makes the stations clickable (and keyboard-operable). */
  onSelect?: (id: StationId) => void;
  ariaLabel?: string;
  /** Hide the station markers and names. */
  bare?: boolean;
  /** Part of the map to show, as a viewBox (defaults to the whole map). */
  viewBox?: string;
}

export function CalderMap({ children, overlay, highlight, onSelect, ariaLabel, bare, viewBox = '0 0 600 400' }: CalderMapProps) {
  const key = (id: StationId) => (e: KeyboardEvent) => {
    if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <svg
      className="diagram"
      viewBox={viewBox}
      role={onSelect ? 'group' : 'img'}
      aria-label={
        ariaLabel ??
        'Map of the Calder region: the port city of Calder Bay on the coast, the farm town of Marlow on the plains 350 km to the west, and the wind farm on Hollin Ridge to the north-west.'
      }
    >
      <defs>
        <pattern id="calder-fields" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
          <rect width="14" height="14" fill={LAND} />
          <rect x="1" y="1" width="12" height="5" fill={FIELD} />
          <rect x="1" y="8" width="5" height="5" fill={FIELD} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={600} height={400} fill={LAND} />
      <ellipse cx={170} cy={270} rx={140} ry={95} fill="url(#calder-fields)" opacity={0.9} />
      {/* Hollin Ridge: contours running south-west to north-east. */}
      {[0, 1, 2].map((k) => (
        <ellipse key={k} cx={300} cy={108} rx={120 - k * 34} ry={34 - k * 10} transform="rotate(-18 300 108)" fill="none" stroke={CONTOUR} strokeWidth={1.4} />
      ))}
      <path d={SEA} fill={WATER} />
      <path d={COAST} fill="none" stroke={WATER_EDGE} strokeWidth={1.4} />
      <path d={RIVER} fill="none" stroke={WATER_EDGE} strokeWidth={1.6} />
      <text x={586} y={392} textAnchor="end" className="ax" style={{ fill: '#5d7f9c' }}>
        ocean
      </text>
      <text x={170} y={378} textAnchor="middle" className="ax">
        the plains
      </text>
      {/* The city. */}
      <rect x={486} y={220} width={28} height={26} rx={4} fill="#e2dccf" />
      {[262, 284, 306, 330].map((x, i) => (
        <Turbine key={i} x={x} y={104 + (i % 2) * 8 - i * 4} />
      ))}
      {children}
      {!bare &&
        (Object.keys(STATIONS) as StationId[]).map((id) => {
          const s = STATIONS[id];
          const on = highlight === id;
          const labelLeft = id === 'calder';
          return (
            <g
              key={id}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `${s.name}${on ? ', selected' : ''}` : undefined}
              aria-pressed={onSelect ? on : undefined}
              onClick={onSelect ? () => onSelect(id) : undefined}
              onKeyDown={onSelect ? key(id) : undefined}
              style={onSelect ? { cursor: 'pointer', outline: 'none' } : undefined}
            >
              {onSelect && <circle cx={s.x} cy={s.y} r={16} fill="transparent" />}
              <circle cx={s.x} cy={s.y} r={on ? 7 : 5} fill={on ? '#333' : '#fff'} stroke="#333" strokeWidth={2} />
              <text x={labelLeft ? s.x - 12 : s.x + 10} y={s.y + (id === 'ridge' ? -12 : 4)} textAnchor={labelLeft ? 'end' : 'start'} className="lab">
                {s.name}
              </text>
            </g>
          );
        })}
      {overlay}
      {/* Scale bar and north arrow. */}
      <g aria-hidden="true">
        <line x1={20} y1={386} x2={120} y2={386} stroke="#777" strokeWidth={1.5} />
        <line x1={20} y1={382} x2={20} y2={390} stroke="#777" strokeWidth={1.5} />
        <line x1={120} y1={382} x2={120} y2={390} stroke="#777" strokeWidth={1.5} />
        <text x={70} y={378} textAnchor="middle" className="ax">
          100 km
        </text>
        <path d="M24 30 L30 14 L36 30 L30 26 Z" fill="#777" />
        <text x={30} y={44} textAnchor="middle" className="ax">
          N
        </text>
      </g>
    </svg>
  );
}
