// The oil course's region as a map: the four fields with the crude each one yields, the Kessler
// hub and its tank farms, the inland refineries, Port Corran on the coast, and the gathering
// lines, pipelines, railroad and tanker routes between them, with Northport and Eastbay far across
// the ocean. Places sit where the world model puts them (PLACES); the pipelines' and sea routes'
// names and lengths come from logistics.ts. Schematic: the distances aren't to scale.

import { fmt, type LegendItem } from '../../../framework';
import { CRUDE_COLOR, CRUDE_SPECS } from '../../../model/oil/crudes';
import { COLDWATER_LINE, KESSLER_CORRAN, ROUTES } from '../../../model/oil/logistics';
import { MAP_SIZE, PLACES, PLACE_IDS, type Place, type PlaceId } from '../../../model/oil/world';

const LAND = '#f3efe5';
const SEA = '#eaf2f9';
const COAST = '#c4d5e4';
const BASIN = '#ebe2cd';
const BASIN_EDGE = '#d9cba9';
/** Link colors match the Petroleum Network Map's (Lesson 4.4). */
export const MAP_COLOR = { pipeline: '#9a9a9a', rail: '#a5603a', tanker: '#4590ce' };
/** The figure's legend for the links. */
export const REGION_LEGEND: LegendItem[] = [
  { label: 'Pipeline', color: MAP_COLOR.pipeline, kind: 'line' },
  { label: 'Rail', color: MAP_COLOR.rail, kind: 'line', dashed: true },
  { label: 'Tanker route', color: MAP_COLOR.tanker, kind: 'line', dashed: true },
];
const INK = '#333';
const MUTED = '#5f5f5f';
const NAME_SIZE = 13.5;
const NOTE_SIZE = 12.6;

type Pt = [number, number];
type LinkKind = 'gathering' | 'pipeline' | 'rail' | 'tanker';

interface MapLink {
  id: string;
  from: PlaceId;
  to: PlaceId;
  kind: LinkKind;
  /** Name and length, drawn as a two-line label at `label`. */
  name?: string;
  length?: string;
  label?: { at: Pt; anchor: 'start' | 'middle' | 'end' };
  /** Control point of a curved route (quadratic Bézier). */
  bend?: Pt;
  /** Shift a straight link sideways, so two links between the same places run side by side. */
  offset?: number;
  /** Ends at the map's edge with an arrowhead: the place is beyond it. */
  arrow?: boolean;
}

const miles = (n: number) => `${fmt(n)} miles`;
const nm = (n: number) => `${fmt(n)} nautical miles`;

const LINKS: MapLink[] = [
  { id: 'gather-pinyon', from: 'pinyon', to: 'kessler', kind: 'gathering' },
  { id: 'gather-northfield', from: 'northfield', to: 'kessler', kind: 'gathering' },
  {
    id: COLDWATER_LINE.id,
    from: 'coldwater',
    to: 'kessler',
    kind: 'pipeline',
    name: COLDWATER_LINE.name,
    length: miles(COLDWATER_LINE.lengthMiles),
    label: { at: [266, 118], anchor: 'start' },
  },
  { id: 'inland', from: 'kessler', to: 'inland', kind: 'gathering' },
  {
    id: KESSLER_CORRAN.id,
    from: 'kessler',
    to: 'corran',
    kind: 'pipeline',
    offset: -4,
    name: KESSLER_CORRAN.name,
    length: miles(KESSLER_CORRAN.lengthMiles),
    label: { at: [318, 186], anchor: 'start' },
  },
  { id: 'rail', from: 'kessler', to: 'corran', kind: 'rail', offset: 6, name: 'rail', label: { at: [352, 262], anchor: 'middle' } },
  { id: ROUTES.seaboard.id, from: 'seaboard', to: 'corran', kind: 'tanker', bend: [478, 368], length: nm(ROUTES.seaboard.nm), label: { at: [490, 334], anchor: 'start' } },
  { id: ROUTES.northport.id, from: 'corran', to: 'northport', kind: 'tanker', bend: [480, 120], arrow: true },
  { id: ROUTES.eastbay.id, from: 'corran', to: 'eastbay', kind: 'tanker', bend: [540, 274], arrow: true },
];

/** Where each place's two-line label goes. */
const LABELS: Record<PlaceId, { at: Pt; anchor: 'start' | 'middle' | 'end' }> = {
  coldwater: { at: [226, 54], anchor: 'end' },
  pinyon: { at: [24, 266], anchor: 'start' },
  northfield: { at: [176, 308], anchor: 'middle' },
  kessler: { at: [238, 164], anchor: 'end' },
  inland: { at: [290, 366], anchor: 'middle' },
  corran: { at: [428, 298], anchor: 'end' },
  seaboard: { at: [628, 426], anchor: 'end' },
  northport: { at: [628, 34], anchor: 'end' },
  eastbay: { at: [628, 214], anchor: 'end' },
};

const CRUDE_NAME = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<string, string>;

/** The label lines under a place's name. */
function noteLines(p: Place): string[] {
  if (p.kind === 'field' && p.crude) return [`${CRUDE_NAME[p.crude]} · ${p.note}`];
  if (p.id === 'northport') return [p.note, nm(ROUTES.northport.nm)];
  if (p.id === 'eastbay') return [p.note, nm(ROUTES.eastbay.nm)];
  if (p.id === 'corran') return p.note.split(' · ');
  if (p.id === 'inland') return [];
  return [p.note];
}

function shift(a: Pt, b: Pt, k: number): [Pt, Pt] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  return [
    [a[0] + nx * k, a[1] + ny * k],
    [b[0] + nx * k, b[1] + ny * k],
  ];
}

/** Where tankers tie up at Port Corran: the end of the export terminal's jetty. */
const BERTH: Pt = [PLACES.corran.at[0] + 22, PLACES.corran.at[1] + 8];

function linkPath(l: MapLink): string {
  const end = (id: PlaceId) => (id === 'corran' && l.kind === 'tanker' ? BERTH : PLACES[id].at);
  const a = end(l.from);
  const b = end(l.to);
  if (l.bend) return `M${a[0]} ${a[1]} Q${l.bend[0]} ${l.bend[1]} ${b[0]} ${b[1]}`;
  const [p, q] = l.offset ? shift(a, b, l.offset) : [a, b];
  return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
}

const STYLE: Record<LinkKind, { color: string; width: number; dash?: string }> = {
  gathering: { color: MAP_COLOR.pipeline, width: 1.8 },
  pipeline: { color: MAP_COLOR.pipeline, width: 3.6 },
  rail: { color: MAP_COLOR.rail, width: 2, dash: '3 4' },
  tanker: { color: MAP_COLOR.tanker, width: 1.8, dash: '7 5' },
};

function Arrowhead({ l }: { l: MapLink }) {
  const b = PLACES[l.to].at;
  const from = l.bend ?? PLACES[l.from].at;
  const angle = (Math.atan2(b[1] - from[1], b[0] - from[0]) * 180) / Math.PI;
  return <path d="M0 0 L-10 -5 L-10 5 Z" fill={MAP_COLOR.tanker} transform={`translate(${b[0]} ${b[1]}) rotate(${angle.toFixed(1)})`} />;
}

function Text({ at, anchor, lines, halo }: { at: Pt; anchor: 'start' | 'middle' | 'end'; lines: Array<{ t: string; strong?: boolean; color?: string }>; halo: string }) {
  return (
    <>
      {lines.map((ln, i) => (
        <text
          key={i}
          x={at[0]}
          y={at[1] + i * 15.5}
          textAnchor={anchor}
          style={{
            fontSize: ln.strong ? NAME_SIZE : NOTE_SIZE,
            fontWeight: ln.strong ? 600 : 400,
            fill: ln.color ?? (ln.strong ? INK : MUTED),
            paintOrder: 'stroke',
            stroke: halo,
            strokeWidth: 4,
            strokeLinejoin: 'round',
          }}
        >
          {ln.t}
        </text>
      ))}
    </>
  );
}

/** A field: one marker in its crude's color (the Pinyon wells as a cluster, for its many wells). */
function FieldMark({ p }: { p: Place }) {
  const [x, y] = p.at;
  const fill = CRUDE_COLOR[p.crude!];
  if (p.id === 'pinyon') {
    const dots: Pt[] = [
      [-9, -6],
      [2, -9],
      [10, -1],
      [-3, 3],
      [-11, 6],
      [6, 9],
    ];
    return (
      <g>
        {dots.map(([dx, dy], i) => (
          <circle key={i} cx={x + dx} cy={y + dy} r={3.6} fill={fill} stroke="#fff" strokeWidth={1.2} />
        ))}
      </g>
    );
  }
  return <circle cx={x} cy={y} r={7.5} fill={fill} stroke="#fff" strokeWidth={2} />;
}

/** Tanks at the hub. */
function HubMark({ p }: { p: Place }) {
  const [x, y] = p.at;
  return (
    <g>
      <rect x={x - 14} y={y - 12} width={28} height={24} rx={4} fill="#fff" stroke="#6b6b6b" strokeWidth={1.4} />
      {[
        [-6, -4],
        [6, -4],
        [0, 5],
      ].map(([dx, dy], i) => (
        <circle key={i} cx={x + dx} cy={y + dy} r={4.4} fill="#e6e1d6" stroke="#6b6b6b" strokeWidth={1.2} />
      ))}
    </g>
  );
}

/** A refinery: a block with two columns. */
function RefineryMark({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 10} y={y - 4} width={20} height={11} rx={1.5} fill="#6b6b6b" />
      <rect x={x - 7} y={y - 14} width={4} height={11} rx={1} fill="#6b6b6b" />
      <rect x={x + 2} y={y - 11} width={4} height={8} rx={1} fill="#6b6b6b" />
    </g>
  );
}

function PortMark({ p }: { p: Place }) {
  const [x, y] = p.at;
  return (
    <g>
      {/* The export terminal's jetty, reaching into the sea. */}
      <path d={`M${x + 4} ${y + 2} L${BERTH[0]} ${y + 2} L${BERTH[0]} ${BERTH[1]}`} fill="none" stroke="#6b6b6b" strokeWidth={2.4} strokeLinecap="round" />
      <RefineryMark x={x - 4} y={y} />
    </g>
  );
}

/**
 * The region map: every place and link the course's lessons use, labelled with the names the
 * lessons use. Static; it scales to its figure's width.
 */
export function RegionMap() {
  const { width: W, height: H } = MAP_SIZE;
  const places = PLACE_IDS.map((id) => PLACES[id]);
  const fields = places.filter((p) => p.kind === 'field');
  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Schematic map of the course’s oil region, not to scale. ${fields.map((p) => `${CRUDE_NAME[p.crude!]} comes from ${p.name}`).join('; ')}. The basin’s gathering lines and the ${COLDWATER_LINE.name} (${miles(COLDWATER_LINE.lengthMiles)}) meet at the Kessler hub’s tank farms, which also supply the inland refineries. From Kessler, the ${KESSLER_CORRAN.name} (${miles(KESSLER_CORRAN.lengthMiles)}) and a railroad run to Port Corran on the coast, home of the Corran refinery and an export terminal. Tankers bring Seaboard Blend ${nm(ROUTES.seaboard.nm)} to Port Corran, and sail to Northport, a refining center ${nm(ROUTES.northport.nm)} away, and to Eastbay, an importing region ${nm(ROUTES.eastbay.nm)} away.`}
    >
      <rect x={0} y={0} width={W} height={H} rx={8} fill={LAND} />
      {/* The ocean to the east. */}
      <path d={`M420 0 C 432 80, 466 160, 448 250 C 438 310, 470 390, 488 ${H} L${W - 8} ${H} Q${W} ${H} ${W} ${H - 8} L${W} 8 Q${W} 0 ${W - 8} 0 Z`} fill={SEA} stroke={COAST} strokeWidth={1.4} />
      <text x={580} y={300} textAnchor="middle" style={{ fontSize: 12.6, letterSpacing: '.22em', fill: '#7d9bb8' }}>
        OCEAN
      </text>

      {/* The Pinyon Basin, holding the Pinyon shale and the Northfield field. */}
      <path d="M14 222 C 30 190, 120 196, 196 236 C 262 270, 270 346, 200 356 C 140 364, 60 350, 26 320 C 6 300, 4 246, 14 222 Z" fill={BASIN} stroke={BASIN_EDGE} strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={60} y={344} textAnchor="start" style={{ fontSize: 12.6, letterSpacing: '.18em', fill: '#8a7a58', fontWeight: 500 }}>
        PINYON BASIN
      </text>

      {/* Compass. */}
      <g aria-hidden="true" transform="translate(26 28)">
        <path d="M0 -12 L5 4 L0 0 L-5 4 Z" fill="#8a8a8a" />
        <text x={0} y={19} textAnchor="middle" style={{ fontSize: NOTE_SIZE, fill: MUTED, fontWeight: 600 }}>
          N
        </text>
      </g>

      {/* Links, pipes over the sea routes. */}
      {[...LINKS].sort((a, b) => Number(a.kind !== 'tanker') - Number(b.kind !== 'tanker')).map((l) => {
        const st = STYLE[l.kind];
        return (
          <g key={l.id}>
            <path d={linkPath(l)} fill="none" stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinecap={st.dash ? 'butt' : 'round'} />
            {l.arrow && <Arrowhead l={l} />}
          </g>
        );
      })}

      {/* Places. */}
      {places.map((p) => (
        <g key={p.id}>
          {p.kind === 'field' && <FieldMark p={p} />}
          {p.kind === 'hub' && <HubMark p={p} />}
          {p.kind === 'refinery' && <RefineryMark x={p.at[0]} y={p.at[1]} />}
          {p.kind === 'port' && <PortMark p={p} />}
        </g>
      ))}

      {/* Link labels. */}
      {LINKS.filter((l) => l.label).map((l) => (
        <Text
          key={l.id}
          at={l.label!.at}
          anchor={l.label!.anchor}
          halo={l.kind === 'tanker' ? SEA : LAND}
          lines={[...(l.name ? [{ t: l.name, color: l.kind === 'rail' ? MAP_COLOR.rail : '#555' }] : []), ...(l.length ? [{ t: l.length, color: l.kind === 'tanker' ? '#2f5f8f' : MUTED }] : [])]}
        />
      ))}

      {/* Place labels. */}
      {places.map((p) => (
        <Text
          key={p.id}
          at={LABELS[p.id].at}
          anchor={LABELS[p.id].anchor}
          halo={p.id === 'seaboard' || p.kind === 'market' ? SEA : LAND}
          lines={[{ t: p.name, strong: true }, ...noteLines(p).map((t) => ({ t }))]}
        />
      ))}

      <text x={14} y={H - 12} style={{ fontSize: 12.6, fill: MUTED }}>
        schematic, not to scale
      </text>
    </svg>
  );
}
