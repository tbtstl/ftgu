// The Crane Valley as the reader first meets it: every district, the river, the rail line, the
// farm we follow and each place that handles grain, named as the lessons name them. Built on
// ValleyMap; the places are drawn here so their labels can sit clear of the river and the rail
// and of each other.

import { TEXT } from '../../../framework';
import { CEDAR_BEND, DISTRICT, DISTRICTS, PLACES, type DistrictId, type Place } from '../../../model/agriculture/region';
import { PLACE_SHAPE, ValleyMap } from './ValleyMap';

const INK = '#444';
const SIZE = 13;

/** Where each place's name sits relative to its marker. */
const LABEL_AT: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  halsted: { dx: 9, dy: 4, anchor: 'start' },
  dunmore: { dx: 9, dy: 16, anchor: 'start' },
  fairview: { dx: 9, dy: 18, anchor: 'start' },
  ashby: { dx: 9, dy: 4, anchor: 'start' },
  landing: { dx: 9, dy: -9, anchor: 'start' },
  bluestem: { dx: 9, dy: 4, anchor: 'start' },
  feedyards: { dx: -10, dy: 4, anchor: 'end' },
  mill: { dx: -8, dy: 21, anchor: 'end' },
  sable: { dx: -8, dy: 16, anchor: 'end' },
  westhaven: { dx: 19, dy: -9, anchor: 'start' },
};

const KEY: Array<{ kind: Place['kind'] | 'rail'; label: string }> = [
  { kind: 'elevator', label: 'country elevator' },
  { kind: 'terminal', label: 'river terminal' },
  { kind: 'port', label: 'export port' },
  { kind: 'rail', label: 'rail line' },
];

const at = (p: Place): [number, number] => [Math.min(632, Math.max(8, p.x)), Math.min(392, Math.max(8, p.y))];

/** Close land tones, so neighboring districts read apart; they encode nothing. */
const TINT: Record<DistrictId, string> = { north: '#e9eadc', plains: '#f3ecda', prairie: '#ebe5d3', ridge: '#f1ebe0', bottoms: '#e6ebdd' };

/** The land color under a point: its district's tint, or the page off the map. */
function groundAt(x: number, y: number): string {
  const d = DISTRICTS.find(({ polygon: poly }) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
  return d ? TINT[d.id] : '#fcfcfb';
}

/** A label with a thin halo in the land color under it, so a selected district's outline never runs through its letters. */
function Name({ x, y, anchor = 'start', bold, fill = INK, italic, children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; fill?: string; italic?: boolean; children: string }) {
  return (
    <text
      className={bold ? 'lab' : 'ax'}
      x={x}
      y={y}
      textAnchor={anchor}
      stroke={groundAt(x, y - 4)}
      strokeWidth={3}
      strokeLinejoin="round"
      style={{ fill, fontSize: SIZE, fontStyle: italic ? 'italic' : undefined, paintOrder: 'stroke' }}
    >
      {children}
    </text>
  );
}

export function ValleyOverview({ selected, onSelect }: { selected?: DistrictId | null; onSelect?: (id: DistrictId) => void }) {
  return (
    <ValleyMap
      selected={selected}
      onSelect={onSelect}
      fill={(id) => TINT[id]}
      places="none"
      beneath={
        // ValleyMap's outline of the selected district is partly covered by its neighbors; draw it whole.
        selected ? <polygon points={DISTRICT[selected].polygon.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" pointerEvents="none" /> : null
      }
      ariaLabel={`A map of the Crane Valley. Its five districts: ${DISTRICTS.map((d) => d.name).join(', ')}. The Crane River runs from the North Tier south-east through the Black Prairie and the River Bottoms to Port Sable; a rail line runs west from Ashby through Fairview and Dunmore to Westhaven. ${CEDAR_BEND.name} is on the Black Prairie near the Fairview elevator. Places that handle grain: ${PLACES.map((p) => p.name).join(', ')}.`}
    >
      <g pointerEvents="none">
        <Name x={186} y={54} fill={TEXT.blue} italic>
          Crane River
        </Name>
        {PLACES.map((p) => {
          const [x, y] = at(p);
          const l = LABEL_AT[p.id] ?? { dx: 9, dy: 4, anchor: 'start' as const };
          return (
            <g key={p.id}>
              <path d={PLACE_SHAPE[p.kind]} transform={`translate(${x},${y})`} fill="#fcfcfb" stroke={INK} strokeWidth={1.4} />
              <Name x={x + l.dx} y={y + l.dy} anchor={l.anchor}>
                {p.name}
              </Name>
            </g>
          );
        })}
        <circle cx={CEDAR_BEND.x} cy={CEDAR_BEND.y} r={5.5} fill="#333" stroke="#fcfcfb" strokeWidth={2} />
        <Name x={CEDAR_BEND.x + 8} y={CEDAR_BEND.y - 10} bold fill="#111">
          {CEDAR_BEND.name}
        </Name>
        {KEY.map((k, i) => {
          const y = 40 + i * 19;
          return (
            <g key={k.kind}>
              {k.kind === 'rail' ? (
                <line x1={5} x2={21} y1={y} y2={y} stroke="#6b6b6b" strokeWidth={2} strokeDasharray="5 3" />
              ) : (
                <path d={PLACE_SHAPE[k.kind]} transform={`translate(13,${y})`} fill="#fcfcfb" stroke={INK} strokeWidth={1.4} />
              )}
              <text className="ax" x={26} y={y + 4} style={{ fill: INK, fontSize: SIZE }}>
                {k.label}
              </text>
            </g>
          );
        })}
        <g transform="translate(626,34)">
          <path d="M0 -10 L5 4 L0 1 L-5 4 Z" fill="#6b6b6b" />
          <text className="ax ax-m" x={0} y={19} style={{ fontSize: SIZE }}>
            N
          </text>
        </g>
      </g>
    </ValleyMap>
  );
}
