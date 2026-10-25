// A map of the course's three data-center sites: Marston on the warm coast among most of the users,
// Tech Park inland beside Metro (the electricity course's city), and Fernhill in a cold valley far to
// the north, below a hydro dam. Each site is labeled with what the model holds about it — its grid
// connection and power price, its climate and its building cost — and joined to the users by the
// fiber its round trip runs over. Positions come from the model's SITE_MAP; the sketch is not to
// scale, so Fernhill's long route carries a break.

import { GRAPHIC, TEXT, fmt, tint, usd } from '../../../framework';
import { SITES, SITE_IDS, SITE_MAP, type SiteId } from '../../../model/compute/sites';

const LAND = '#f2f0e9';
const WATER = '#d6e5f1';
const WATER_EDGE = '#a9c3d9';
const CONTOUR = '#d2cbba';
const CITY = '#e7e1d8';
const CITY_EDGE = '#d3cbbf';
const MUTED = '#5f5f5f';
const ROUTE = '#6f6f6f';

/** A word for a site's humidity (0 dry – 1 very humid). */
export function humidityWord(h: number): string {
  return h >= 0.7 ? 'high' : h >= 0.4 ? 'moderate' : 'low';
}

/** Marker radius: the circle's area is in proportion to the site's grid connection. */
export function markerRadius(gridMW: number): number {
  return 1.5 * Math.sqrt(gridMW);
}

/** Where each site's label goes, relative to its marker, and which way it reads. */
const LABEL: Record<SiteId, { dx: number; dy: number; anchor: 'start' | 'end' }> = {
  fernhill: { dx: 34, dy: -16, anchor: 'start' },
  techpark: { dx: 18, dy: -72, anchor: 'end' },
  marston: { dx: -30, dy: -10, anchor: 'end' },
};

type Pt = [number, number];

function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

function tangent(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const x = 3 * (u * u * (c1[0] - p0[0]) + 2 * u * t * (c2[0] - c1[0]) + t * t * (p3[0] - c2[0]));
  const y = 3 * (u * u * (c1[1] - p0[1]) + 2 * u * t * (c2[1] - c1[1]) + t * t * (p3[1] - c2[1]));
  const n = Math.hypot(x, y) || 1;
  return [x / n, y / n];
}

const M = SITE_MAP.marston;
const T = SITE_MAP.techpark;
const F = SITE_MAP.fernhill;

/** Fernhill's route south to the users: down its valley, then across to the coast. */
const FERN: [Pt, Pt, Pt, Pt] = [
  [F.x, F.y + markerRadius(SITES.fernhill.gridMW)],
  [F.x + 24, F.y + 150],
  [M.x, M.y - 150],
  [M.x - 2, M.y - markerRadius(SITES.marston.gridMW)],
];
const FERN_D = `M${FERN[0][0]} ${FERN[0][1]} C ${FERN[1][0]} ${FERN[1][1]}, ${FERN[2][0]} ${FERN[2][1]}, ${FERN[3][0]} ${FERN[3][1]}`;

/** Tech Park's route to the users: a short, straight hop to the coast. */
const TP_FROM: Pt = [T.x, T.y];
const TP_TO: Pt = [M.x, M.y];

function rotation(dir: Pt): number {
  let a = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

/** A route's round-trip label, set along the route at `at`, offset `off` units to one side. */
function RouteLabel({ at, dir, off, children }: { at: Pt; dir: Pt; off: number; children: string }) {
  const nx = -dir[1];
  const ny = dir[0];
  const x = at[0] + nx * off;
  const y = at[1] + ny * off;
  return (
    <text
      x={x}
      y={y}
      dy="0.35em"
      textAnchor="middle"
      transform={`rotate(${rotation(dir)} ${x} ${y})`}
      style={{ fontSize: 13.5, fontWeight: 500, fill: TEXT.teal, paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}
    >
      {children}
    </text>
  );
}

/** The break that says the long route is drawn shorter than it is. */
function RouteBreak({ at, dir }: { at: Pt; dir: Pt }) {
  const nx = -dir[1];
  const ny = dir[0];
  const half = 3.5;
  const len = 7;
  const lines = [-half, half].map((s) => {
    const cx = at[0] + dir[0] * s;
    const cy = at[1] + dir[1] * s;
    // Slanted a little off the perpendicular, like a cut.
    const ex = nx * 0.94 + dir[0] * 0.34;
    const ey = ny * 0.94 + dir[1] * 0.34;
    return { x1: cx - ex * len, y1: cy - ey * len, x2: cx + ex * len, y2: cy + ey * len };
  });
  const quad = [
    [lines[0].x1, lines[0].y1],
    [lines[0].x2, lines[0].y2],
    [lines[1].x2, lines[1].y2],
    [lines[1].x1, lines[1].y1],
  ];
  return (
    <g aria-hidden="true">
      <path d={`M${quad.map((p) => p.join(' ')).join(' L')} Z`} fill={LAND} />
      {lines.map((l, i) => (
        <line key={i} {...l} stroke={ROUTE} strokeWidth={1.4} strokeLinecap="round" />
      ))}
    </g>
  );
}

function Peak({ x, y, h = 18, w = 16 }: { x: number; y: number; h?: number; w?: number }) {
  return <path d={`M${x - w} ${y} L${x} ${y - h} L${x + w} ${y}`} fill="none" stroke={CONTOUR} strokeWidth={1.5} strokeLinejoin="round" />;
}

/** Small dots for the people the sites serve, scattered over Marston. */
const USERS: Pt[] = [
  [292, 346], [304, 338], [316, 350], [298, 360], [312, 364], [326, 340], [330, 356], [284, 368],
  [322, 372], [340, 364], [276, 354], [306, 326], [342, 346], [288, 330],
];

function siteFacts(id: SiteId) {
  const s = SITES[id];
  return {
    power: `${fmt(s.gridMW)} MW grid connection, ${usd(s.powerPrice)}/MWh`,
    climate: `${fmt(s.meanTempC)} °C on average, ${humidityWord(s.humidity)} humidity`,
    build: `building cost ${fmt(s.buildCostIndex, 1)}× Tech Park’s`,
    rtt: `${fmt(s.rttMs)} ms round trip to the users`,
  };
}

/** The map's description for screen readers: every site with every fact the map shows. */
export function sitesMapLabel(): string {
  const parts = SITE_IDS.map((id) => {
    const f = siteFacts(id);
    return `${SITES[id].name}, ${SITES[id].blurb}: ${f.power}; ${f.climate}; ${f.build}; ${f.rtt}`;
  });
  return `Map of the course’s three data-center sites, not to scale. ${parts.join('. ')}.`;
}

function SiteLabel({ id }: { id: SiteId }) {
  const s = SITES[id];
  const p = SITE_MAP[id];
  const l = LABEL[id];
  const x = p.x + l.dx;
  const y = p.y + l.dy;
  const halo = { paintOrder: 'stroke' as const, stroke: LAND, strokeWidth: 3.5, strokeLinejoin: 'round' as const };
  const fact = { ...halo, fontSize: 13.5, fill: '#4a4a4a' };
  return (
    <g>
      <text x={x} y={y} textAnchor={l.anchor} style={{ ...halo, fontSize: 15.5, fontWeight: 600, fill: '#222' }}>
        {s.name}
      </text>
      <text x={x} y={y + 17} textAnchor={l.anchor} style={fact}>
        <tspan style={{ fill: TEXT.red, fontWeight: 500 }}>{fmt(s.gridMW)} MW</tspan> grid ·{' '}
        <tspan style={{ fill: TEXT.green, fontWeight: 500 }}>{usd(s.powerPrice)}/MWh</tspan>
      </text>
      <text x={x} y={y + 33} textAnchor={l.anchor} style={fact}>
        {fmt(s.meanTempC)} °C average · {humidityWord(s.humidity)} humidity
      </text>
      <text x={x} y={y + 49} textAnchor={l.anchor} style={fact}>
        building cost {fmt(s.buildCostIndex, 1)}×
      </text>
    </g>
  );
}

/**
 * The course's three data-center sites on one map, each with its grid connection (the circle's
 * area, in red), its power price (green), its climate and its building cost, and the round trip
 * from each to the users who sit around Marston.
 */
export function SitesMap() {
  const fernMid = cubic(...FERN, 0.42);
  const fernDir = tangent(...FERN, 0.42);
  const fernBreak = cubic(...FERN, 0.7);
  const fernBreakDir = tangent(...FERN, 0.7);
  const tpDir: Pt = (() => {
    const dx = TP_TO[0] - TP_FROM[0];
    const dy = TP_TO[1] - TP_FROM[1];
    const n = Math.hypot(dx, dy);
    return [dx / n, dy / n];
  })();
  const tpMid: Pt = [(TP_FROM[0] + TP_TO[0]) / 2, (TP_FROM[1] + TP_TO[1]) / 2];

  return (
    <svg className="diagram" viewBox="0 0 640 440" role="img" aria-label={sitesMapLabel()}>
      <defs>
        <pattern id="compute-sites-streets" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 0 H9 M0 0 V9" stroke="#d8d0c4" strokeWidth={0.8} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={640} height={440} rx={8} fill={LAND} />

      {/* The warm sea along the south coast, with Marston's bay. */}
      <path
        d="M0 398 C 60 390, 120 404, 180 398 C 220 394, 238 384, 262 386 C 292 388, 306 402, 352 404 C 430 408, 520 394, 640 402 L640 440 L0 440 Z"
        fill={WATER}
        stroke={WATER_EDGE}
        strokeWidth={1.2}
      />

      {/* The mountains of the north, with Fernhill in a valley among them. */}
      <g aria-hidden="true">
        <Peak x={36} y={58} h={22} />
        <Peak x={62} y={46} h={26} w={18} />
        <Peak x={176} y={40} h={20} />
        <Peak x={204} y={52} h={24} w={18} />
        <Peak x={420} y={46} h={20} />
        <Peak x={448} y={36} h={24} w={18} />
        <Peak x={478} y={50} h={18} />
        <Peak x={540} y={70} h={16} w={14} />
        <path d="M20 120 C 50 132, 70 150, 76 176" fill="none" stroke={CONTOUR} strokeWidth={1.3} />
        <path d="M160 150 C 176 170, 188 186, 196 214" fill="none" stroke={CONTOUR} strokeWidth={1.3} />
      </g>

      {/* The hydro dam above Fernhill, and its river down to the sea. */}
      <g aria-hidden="true">
        <path d="M86 46 C 70 42, 50 52, 52 64 C 54 76, 76 80, 92 74 C 104 68, 102 50, 86 46 Z" fill={WATER} stroke={WATER_EDGE} strokeWidth={1.2} />
        <line x1={90} y1={76} x2={102} y2={66} stroke="#7a7a7a" strokeWidth={3} strokeLinecap="round" />
        <path
          d="M98 74 C 86 110, 60 130, 54 170 C 46 222, 74 260, 64 300 C 56 336, 44 370, 50 398"
          fill="none"
          stroke={WATER_EDGE}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <text x={30} y={98} textAnchor="middle" style={{ fontSize: 13.5, fill: MUTED, paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}>
          dam
        </text>
      </g>

      {/* Metro, the electricity course's city, and Marston on the coast. */}
      <g aria-hidden="true">
        <path d="M498 232 C 520 214, 584 216, 606 240 C 626 262, 620 304, 596 318 C 568 334, 518 330, 500 308 C 484 288, 482 248, 498 232 Z" fill={CITY} stroke={CITY_EDGE} strokeWidth={1.2} />
        <path d="M498 232 C 520 214, 584 216, 606 240 C 626 262, 620 304, 596 318 C 568 334, 518 330, 500 308 C 484 288, 482 248, 498 232 Z" fill="url(#compute-sites-streets)" />
        <text x={556} y={278} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '.16em', fill: '#7a6f62' }}>
          METRO
        </text>
        <text x={556} y={190} textAnchor="middle" style={{ fontSize: 13.5, fill: MUTED }}>
          the electricity
        </text>
        <text x={556} y={206} textAnchor="middle" style={{ fontSize: 13.5, fill: MUTED }}>
          course’s city
        </text>
        <path d="M240 336 C 248 316, 300 312, 336 322 C 362 330, 364 360, 350 376 C 332 392, 270 390, 250 376 C 236 366, 234 350, 240 336 Z" fill={CITY} stroke={CITY_EDGE} strokeWidth={1.2} />
        <path d="M240 336 C 248 316, 300 312, 336 322 C 362 330, 364 360, 350 376 C 332 392, 270 390, 250 376 C 236 366, 234 350, 240 336 Z" fill="url(#compute-sites-streets)" />
        {USERS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} fill="#7d7d7d" />
        ))}
        <text x={372} y={366} style={{ fontSize: 13.5, fill: MUTED, paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}>
          most of the users
        </text>
        <text x={372} y={382} style={{ fontSize: 13.5, fill: TEXT.teal, fontWeight: 500, paintOrder: 'stroke', stroke: LAND, strokeWidth: 3 }}>
          {fmt(SITES.marston.rttMs)} ms round trip from Marston
        </text>
      </g>

      {/* The fiber from each site to the users, with its round trip. */}
      <path d={FERN_D} fill="none" stroke={ROUTE} strokeWidth={1.6} strokeDasharray="5 4" />
      <RouteBreak at={fernBreak} dir={fernBreakDir} />
      <RouteLabel at={fernMid} dir={fernDir} off={-12}>{`${fmt(SITES.fernhill.rttMs)} ms round trip`}</RouteLabel>
      <line x1={TP_FROM[0]} y1={TP_FROM[1]} x2={TP_TO[0]} y2={TP_TO[1]} stroke={ROUTE} strokeWidth={1.6} strokeDasharray="5 4" />
      <RouteLabel at={tpMid} dir={tpDir} off={-11}>{`${fmt(SITES.techpark.rttMs)} ms round trip`}</RouteLabel>

      {/* The sites: each circle's area is its grid connection. */}
      {SITE_IDS.map((id) => (
        <circle key={id} cx={SITE_MAP[id].x} cy={SITE_MAP[id].y} r={markerRadius(SITES[id].gridMW)} fill={tint(GRAPHIC.red, 0.4)} stroke={GRAPHIC.red} strokeWidth={1.6} />
      ))}
      {SITE_IDS.map((id) => (
        <SiteLabel key={id} id={id} />
      ))}

      {/* Compass, and the reminder that distances are squeezed. */}
      <g aria-hidden="true" transform="translate(608 26)">
        <path d="M0 -12 L5 4 L0 0 L-5 4 Z" fill="#8a8a8a" />
        <text x={0} y={20} textAnchor="middle" style={{ fontSize: 13, fill: MUTED, fontWeight: 600 }}>
          N
        </text>
      </g>
      <text x={624} y={66} textAnchor="end" style={{ fontSize: 13.5, fill: MUTED }}>
        not to scale
      </text>
    </svg>
  );
}
