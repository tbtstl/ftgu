// The course's world map: coarse coastlines, the sea lanes, ports, chokepoints, routes, flows and
// ships, in an equirectangular projection 640 units wide. Lines that cross the Pacific leave the
// left edge and re-enter on the right.

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { CHOKEPOINTS, LAND, LANES, MAP, MAP_HEIGHT, PLACE, PLACES, lanePoints, project, type Chokepoint } from '../../../model/shipping/geo';
import { TEXT } from '../../../framework';

export const MAP_W = MAP.width;
export const MAP_H = Math.round(MAP_HEIGHT);
const LAND_FILL = '#ece8df';
const LAND_STROKE = '#cfc9bd';
const SEA = '#f3f7fa';
const LANE = '#d5dde4';

/** Project a polyline, splitting it where it wraps across the map's edges. */
export function projectLine(points: Array<[number, number]>): string {
  let d = '';
  const f = (n: number) => n.toFixed(1);
  points.forEach(([lat, lon], i) => {
    const [x, y] = project(lat, lon);
    if (i > 0 && Math.abs(lon - points[i - 1][1]) > 180) {
      const [plat, plon] = points[i - 1];
      const shift = lon > plon ? -360 : 360;
      // Continue off the edge we're leaving, then restart beyond the opposite edge.
      const [ax, ay] = project(lat, lon + shift);
      const [bx, by] = project(plat, plon - shift);
      d += ` L${f(ax)} ${f(ay)} M${f(bx)} ${f(by)} L${f(x)} ${f(y)}`;
    } else d += `${d ? ' L' : 'M'}${f(x)} ${f(y)}`;
  });
  return d;
}

function landPath(ring: Array<[number, number]>): string {
  return ring.map(([lon, lat], i) => {
    const [x, y] = project(lat, lon);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

const LAND_PATHS = LAND.map(landPath);
const LANE_PATHS = LANES.map((l) => ({ id: l.id, d: projectLine(lanePoints(l)) }));

export interface MapRoute {
  points: Array<[number, number]>;
  color: string;
  width?: number;
  dash?: string;
  /** Moving dots along the route. */
  flow?: boolean;
  opacity?: number;
}

export interface MapPort {
  id: string;
  color?: string;
  r?: number;
  /** Show the label (default true), or replace its text. */
  label?: boolean | string;
  /** Text under the name, e.g. a quantity. */
  sub?: string;
  selected?: boolean;
  onClick?: () => void;
}

export interface MapShip {
  lat: number;
  lon: number;
  color: string;
  label?: string;
  /** Laden ships are filled; ships in ballast are hollow. */
  laden?: boolean;
}

export interface WorldMapProps {
  ariaLabel: string;
  /** Faint network of every lane (default true). */
  lanes?: boolean;
  routes?: MapRoute[];
  /** Ports to draw (default: the cargo ports). */
  ports?: MapPort[];
  chokepoints?: Array<{ id: Chokepoint; closed: boolean; onToggle?: () => void; label?: boolean }>;
  ships?: MapShip[];
  children?: ReactNode;
  /** Crop to a window: [lonMin, lonMax, latMax, latMin]. */
  height?: number;
}

const OFFSET: Record<string, [number, number, 'start' | 'middle' | 'end']> = {
  n: [0, -8, 'middle'],
  s: [0, 15, 'middle'],
  e: [7, 4, 'start'],
  w: [-7, 4, 'end'],
  ne: [5, -6, 'start'],
  nw: [-5, -6, 'end'],
  se: [5, 13, 'start'],
  sw: [-5, 13, 'end'],
};

function keyActivate(fn?: () => void) {
  return (e: KeyboardEvent) => {
    if (!fn) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

export const DEFAULT_PORTS: MapPort[] = PLACES.filter((p) => p.port).map((p) => ({ id: p.id }));

/** The world map. Coordinates of children are in the 640-wide projected frame. */
export function WorldMap({ ariaLabel, lanes = true, routes = [], ports = DEFAULT_PORTS, chokepoints = [], ships = [], children }: WorldMapProps) {
  const clip = 'wm' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg className="diagram" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={ariaLabel}>
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={MAP_W} height={MAP_H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={0} y={0} width={MAP_W} height={MAP_H} fill={SEA} />
        {LAND_PATHS.map((d, i) => (
          <path key={i} d={d} fill={LAND_FILL} stroke={LAND_STROKE} strokeWidth={0.6} strokeLinejoin="round" />
        ))}
        {lanes && LANE_PATHS.map((l) => <path key={l.id} d={l.d} fill="none" stroke={LANE} strokeWidth={1} />)}
        {routes.map((r, i) => (
          <g key={i} opacity={r.opacity ?? 1}>
            <path d={projectLine(r.points)} fill="none" stroke={r.color} strokeWidth={r.width ?? 2.5} strokeDasharray={r.dash} strokeLinejoin="round" strokeLinecap="round" />
            {r.flow && <path d={projectLine(r.points)} className="flow-dots" stroke="#ffffff" strokeWidth={Math.max(2, (r.width ?? 2.5) - 1)} style={{ animationDuration: '2.4s' }} />}
          </g>
        ))}
        {ships.map((s, i) => {
          const [x, y] = project(s.lat, s.lon);
          return (
            <g key={i}>
              <path d={`M${x - 5} ${y + 3} L${x + 6} ${y} L${x - 5} ${y - 3} Z`} fill={s.laden === false ? '#ffffff' : s.color} stroke={s.color} strokeWidth={1.5} />
              {s.label && (
                <text x={x + 8} y={y + 4} style={{ fontSize: 10, fill: TEXT.ink }}>
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      {chokepoints.map((c) => {
        const at = PLACE[CHOKEPOINTS[c.id].at];
        const [x, y] = project(at.lat, at.lon);
        const interactive = !!c.onToggle;
        return (
          <g
            key={c.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${CHOKEPOINTS[c.id].name}: ${c.closed ? 'closed' : 'open'}. Press to ${c.closed ? 'open' : 'close'}.` : undefined}
            aria-pressed={interactive ? c.closed : undefined}
            onClick={c.onToggle}
            onKeyDown={keyActivate(c.onToggle)}
            style={{ cursor: interactive ? 'pointer' : undefined }}
          >
            <circle cx={x} cy={y} r={interactive ? 9 : 6} fill={c.closed ? TEXT.red : '#ffffff'} stroke={c.closed ? TEXT.red : '#555'} strokeWidth={1.5} />
            {c.closed ? (
              <g stroke="#ffffff" strokeWidth={2}>
                <line x1={x - 3.5} y1={y - 3.5} x2={x + 3.5} y2={y + 3.5} />
                <line x1={x - 3.5} y1={y + 3.5} x2={x + 3.5} y2={y - 3.5} />
              </g>
            ) : (
              <circle cx={x} cy={y} r={2.5} fill="#555" />
            )}
            {c.label && (
              <text x={x} y={y - 12} textAnchor="middle" style={{ fontSize: 10, fontWeight: 500, fill: c.closed ? TEXT.red : '#444' }}>
                {CHOKEPOINTS[c.id].name.replace(' and the Red Sea', '')}
              </text>
            )}
          </g>
        );
      })}
      {ports.map((p) => {
        const pl = PLACE[p.id];
        const [x, y] = project(pl.lat, pl.lon);
        const [dx, dy, anchor] = OFFSET[pl.label ?? 'e'];
        const interactive = !!p.onClick;
        const name = typeof p.label === 'string' ? p.label : pl.name;
        return (
          <g
            key={p.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${pl.name}, ${pl.area}${p.selected ? ', selected' : ''}` : undefined}
            aria-pressed={interactive ? !!p.selected : undefined}
            onClick={p.onClick}
            onKeyDown={keyActivate(p.onClick)}
            style={{ cursor: interactive ? 'pointer' : undefined }}
          >
            {interactive && <circle cx={x} cy={y} r={11} fill="transparent" />}
            <circle cx={x} cy={y} r={p.r ?? (p.selected ? 6 : 4.5)} fill={p.color ?? '#555'} stroke={p.selected ? '#111' : '#ffffff'} strokeWidth={p.selected ? 2 : 1.5} />
            {p.label !== false && (
              <text x={x + dx} y={y + dy} textAnchor={anchor} style={{ fontSize: 11, fontWeight: p.selected ? 600 : 500, fill: '#333', paintOrder: 'stroke', stroke: '#f6f8fa', strokeWidth: 3 }}>
                {name}
              </text>
            )}
            {p.sub && (
              <text x={x + dx} y={y + dy + 12} textAnchor={anchor} style={{ fontSize: 10, fill: '#555', paintOrder: 'stroke', stroke: '#f6f8fa', strokeWidth: 3 }}>
                {p.sub}
              </text>
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
