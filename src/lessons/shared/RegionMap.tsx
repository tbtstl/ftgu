// A map of the course's fictional region: its coast, river, hills and lake, the city of Metro,
// and the nine power plants of the standard fleet at their sites. Drawn in the same 600 × 400
// coordinates as the REGION network, so a plant sits in the same place on every diagram.

import { useEffect, useState, type KeyboardEvent } from 'react';
import { FUEL } from '../../framework';
import { FUEL_LABEL, STANDARD_FLEET } from '../../model/fleet';
import type { Generator } from '../../model/types';

const LAND = '#f2f0e9';
const WATER = '#d6e5f1';
const WATER_EDGE = '#a9c3d9';
const CONTOUR = '#d8d2c2';
const ROAD = '#e3ddd1';
const CITY = '#e7e1d8';
const TOWN = '#6b6b6b';

/** Where each plant's marker sits, and where its two-line label goes. */
const SITES: Record<string, { x: number; y: number; lx: number; ly: number; anchor: 'start' | 'end' | 'middle' }> = {
  nuc: { x: 100, y: 226, lx: 122, ly: 222, anchor: 'start' },
  coal: { x: 214, y: 330, lx: 192, ly: 326, anchor: 'end' },
  cc1: { x: 292, y: 186, lx: 270, ly: 182, anchor: 'end' },
  cc2: { x: 478, y: 254, lx: 456, ly: 250, anchor: 'end' },
  ct: { x: 528, y: 74, lx: 528, ly: 104, anchor: 'middle' },
  oil: { x: 548, y: 322, lx: 548, ly: 356, anchor: 'middle' },
  hydro: { x: 136, y: 70, lx: 158, ly: 66, anchor: 'start' },
  wind: { x: 100, y: 64, lx: 76, ly: 60, anchor: 'end' },
  solar: { x: 430, y: 94, lx: 408, ly: 90, anchor: 'end' },
};

const SHORT: Record<string, string> = {
  nuc: 'Harbor Point',
  coal: 'Ironwood',
  cc1: 'Lakeside',
  cc2: 'Mill Creek',
  ct: 'Eastgate',
  oil: 'Old Quay',
  hydro: 'Falls',
  wind: 'Ridge',
  solar: 'Valley',
};

const KIND: Record<string, string> = {
  nuclear: 'nuclear',
  coal: 'coal',
  gasCC: 'combined-cycle',
  gasCT: 'gas peaker',
  oil: 'oil',
  hydro: 'hydro',
  wind: 'wind',
  solar: 'solar',
  battery: 'battery',
};

/** One sentence on each plant's role, true to its numbers in the standard fleet. */
const ROLE: Record<string, string> = {
  nuc: 'It runs day and night and can’t go below 360 MW, so it covers the region’s base of demand. Only wind and sun are cheaper to run.',
  coal: 'Cheaper to run than gas at today’s fuel prices, but slow to change output and the region’s biggest emitter per megawatt-hour.',
  cc1: 'The region’s workhorse: efficient and quick to ramp, it follows demand up and down through the day.',
  cc2: 'Older and less efficient than Lakeside, so it runs when Lakeside isn’t enough. It sits in the city itself.',
  ct: 'It can start in minutes, but its fuel is expensive, so it runs only when demand is near its peak.',
  oil: 'The most expensive plant in the region to run: a last resort for the hottest evenings.',
  hydro: 'Water costs nothing, but the reservoir holds only so much, so its output is saved for the hours it’s worth most.',
  wind: 'Free to run once built, but its output follows the wind, which on the reference day blows hardest at night.',
  solar: 'Free to run once built, but it produces only in daylight, peaking around midday.',
};

function markerRadius(mw: number) {
  return 4 + Math.sqrt(mw) * 0.75;
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

function Turbine({ x, y, spin }: { x: number; y: number; spin: boolean }) {
  const hub = `${x} ${y - 12}`;
  return (
    <g aria-hidden="true">
      <line x1={x} y1={y} x2={x} y2={y - 12} stroke="#8a8a8a" strokeWidth={1.4} />
      <g>
        {[0, 120, 240].map((a) => (
          <line key={a} x1={x} y1={y - 12} x2={x} y2={y - 20} stroke="#7a7a7a" strokeWidth={1.4} strokeLinecap="round" transform={`rotate(${a} ${hub})`} />
        ))}
        {spin && <animateTransform attributeName="transform" type="rotate" from={`0 ${hub}`} to={`360 ${hub}`} dur="5s" repeatCount="indefinite" />}
      </g>
    </g>
  );
}

function SolarField({ x, y }: { x: number; y: number }) {
  const panels = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) panels.push(<rect key={`${r}-${c}`} x={x + c * 9} y={y + r * 8} width={7} height={5} rx={0.8} fill="#e2c160" stroke="#b8952e" strokeWidth={0.6} />);
  return <g aria-hidden="true">{panels}</g>;
}

/**
 * The region map. `selected` highlights a plant; `onSelect` makes plants clickable (and
 * keyboard-operable) so a figure can show details of the chosen one.
 */
export function RegionMap({ selected, onSelect }: { selected?: string | null; onSelect?: (id: string | null) => void }) {
  const spin = !useReducedMotion();
  const key = (id: string) => (e: KeyboardEvent) => {
    if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(selected === id ? null : id);
    }
  };

  return (
    <svg className="diagram" viewBox="0 0 600 400" role="group" aria-label="Map of the course region: the city of Metro, its towns, and the nine power plants at their sites">
      <defs>
        <pattern id="region-streets" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 0 H9 M0 0 V9" stroke="#d8d0c4" strokeWidth={0.8} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={600} height={400} rx={8} fill={LAND} />

      {/* The sea along the south-west coast, and the lake by Central. */}
      <path d="M0 150 C 30 172, 52 212, 58 244 C 64 276, 50 300, 70 330 C 92 364, 140 372, 176 400 L 0 400 Z" fill={WATER} stroke={WATER_EDGE} strokeWidth={1.2} />
      <ellipse cx={336} cy={200} rx={26} ry={14} fill={WATER} stroke={WATER_EDGE} strokeWidth={1.2} />

      {/* Hills in the north, under the wind farm. */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${22 + i * 10} ${70 - i * 10} C ${70 + i * 8} ${38 - i * 9}, ${150 - i * 6} ${30 - i * 8}, ${250 - i * 18} ${52 - i * 6}`} fill="none" stroke={CONTOUR} strokeWidth={1.4} />
      ))}

      {/* The river, from the hills over the falls and down to the sea at Harbor. */}
      <path d="M182 0 C 162 28, 142 50, 136 72 C 128 112, 176 140, 190 176 C 206 216, 168 250, 122 266 C 96 276, 76 286, 60 294" fill="none" stroke={WATER_EDGE} strokeWidth={3.2} strokeLinecap="round" />

      {/* Roads between the towns. */}
      {[
        'M92 254 C 160 238, 230 214, 296 204',
        'M304 204 C 380 214, 430 236, 470 258',
        'M238 346 C 320 336, 400 316, 462 296',
        'M138 92 C 190 128, 250 166, 296 194',
        'M466 144 C 482 176, 496 206, 506 236',
        'M218 340 C 186 312, 140 280, 100 262',
      ].map((d) => (
        <path key={d} d={d} fill="none" stroke={ROAD} strokeWidth={2.4} strokeLinecap="round" />
      ))}

      {/* Metro, the region's city. */}
      <path
        d="M455 232 C 480 212, 545 216, 570 242 C 592 268, 588 320, 562 340 C 532 364, 480 358, 460 332 C 440 306, 438 254, 455 232 Z"
        fill={CITY}
        stroke="#d3cbbf"
        strokeWidth={1.2}
      />
      <path d="M455 232 C 480 212, 545 216, 570 242 C 592 268, 588 320, 562 340 C 532 364, 480 358, 460 332 C 440 306, 438 254, 455 232 Z" fill="url(#region-streets)" />
      <text x={516} y={296} textAnchor="middle" style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, letterSpacing: '.18em', fill: '#7a6f62' }}>
        METRO
      </text>

      {/* Towns, named after the substations that serve them. */}
      {[
        { x: 120, y: 106, t: 'NORTH' },
        { x: 462, y: 136, t: 'EAST' },
        { x: 304, y: 230, t: 'CENTRAL' },
        { x: 84, y: 276, t: 'HARBOR' },
        { x: 236, y: 372, t: 'WEST' },
      ].map((t) => (
        <text key={t.t} x={t.x} y={t.y} textAnchor="middle" style={{ fontSize: 10.5, letterSpacing: '.14em', fill: TOWN, fontWeight: 500 }}>
          {t.t}
        </text>
      ))}

      {/* The wind farm's turbines along the ridge, and the solar farm's panels. */}
      {[
        [44, 52],
        [64, 44],
        [86, 40],
        [108, 38],
        [130, 38],
      ].map(([x, y]) => (
        <Turbine key={x} x={x} y={y} spin={spin} />
      ))}
      <SolarField x={404} y={46} />

      {/* Compass and scale. */}
      <g aria-hidden="true" transform="translate(572 24)">
        <path d="M0 -12 L5 4 L0 0 L-5 4 Z" fill="#8a8a8a" />
        <text x={0} y={18} textAnchor="middle" style={{ fontSize: 10.5, fill: TOWN, fontWeight: 600 }}>
          N
        </text>
      </g>
      <g aria-hidden="true" transform="translate(470 384)">
        <line x1={0} y1={0} x2={45} y2={0} stroke="#8a8a8a" strokeWidth={2} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke="#8a8a8a" strokeWidth={1.4} />
        <line x1={45} y1={-4} x2={45} y2={4} stroke="#8a8a8a" strokeWidth={1.4} />
        <text x={52} y={4} style={{ fontSize: 10.5, fill: TOWN }}>
          30 km
        </text>
      </g>

      {/* The plants. */}
      {STANDARD_FLEET.map((g: Generator) => {
        const s = SITES[g.id];
        if (!s) return null;
        const r = markerRadius(g.capacity);
        const on = selected === g.id;
        const interactive = !!onSelect;
        return (
          <g
            key={g.id}
            role={interactive ? 'button' : 'img'}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? on : undefined}
            aria-label={`${g.name}: ${g.capacity} MW ${FUEL_LABEL[g.fuel].toLowerCase()}`}
            onClick={interactive ? () => onSelect?.(on ? null : g.id) : undefined}
            onKeyDown={key(g.id)}
            style={interactive ? { cursor: 'pointer', outline: 'none' } : undefined}
          >
            {on && <circle cx={s.x} cy={s.y} r={r + 6} fill="none" stroke="#333" strokeWidth={1.6} strokeDasharray="3 3" />}
            <circle cx={s.x} cy={s.y} r={r} fill={FUEL[g.fuel]} stroke="#fff" strokeWidth={2} />
            <text x={s.lx} y={s.ly} textAnchor={s.anchor} style={{ fontSize: 12.5, fontWeight: 600, fill: on ? '#111' : '#333', paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}>
              {SHORT[g.id]}
            </text>
            <text x={s.lx} y={s.ly + 14} textAnchor={s.anchor} style={{ fontSize: 11.5, fill: '#555', paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}>
              {g.capacity} MW {KIND[g.fuel]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function plantRole(id: string): string {
  return ROLE[id] ?? '';
}
