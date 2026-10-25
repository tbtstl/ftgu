import { useId, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import {
  AIR_DENSITY,
  coriolis,
  cycloneWind,
  geostrophicSpeed,
  inertialPeriodHours,
  pressureForce,
  steadyWind,
  windTrack,
} from '../../../engines/weather/dynamics';
import { SEA_BREEZE, seaBreeze, type SeaBreeze, type SeaBreezeStage } from '../../../engines/weather/seaBreeze';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// Constants and challenge checks (exported for the tests).

/** Fenwick Bay's latitude, °N. */
export const FENWICK_LAT = 41;
/** The first challenge: a 20 m/s geostrophic wind at 41° north. */
export const GEO_TARGET = 20;
export function geostrophicSolved(gradient: number, lat: number): boolean {
  return lat === FENWICK_LAT && Math.abs(geostrophicSpeed(gradient, lat) - GEO_TARGET) < 0.5;
}

/** The first demonstration's starting state: the land 5 °C warmer than the sea, before any air has moved. */
export const BREEZE_DEFAULTS: { deltaC: number; stage: SeaBreezeStage } = { deltaC: 5, stage: 'heated' };
/** The height the first demonstration compares the two columns at, m. */
export const ALOFT_M = 1000;

/** Friction slider units: 10⁻⁵ per second. */
const K_UNIT = 1e-5;
/** How long the first demonstration follows the parcel, hours. */
export const TRACK_HOURS = 48;
const STEP_MIN = 10;
/** Simulated hours per second of animation. */
const HOURS_PER_SECOND = 8;

/** The storm in the second demonstration: a Gaussian low this wide. */
export const STORM_RADIUS_KM = 450;

export interface StormState {
  /** Storm center, km east of Fenwick Bay. */
  east: number;
  /** Storm center, km north of Fenwick Bay. */
  north: number;
  depth: number;
  lat: number;
  /** Friction, 10⁻⁵ per second. */
  friction: number;
}

export const STORM_DEFAULTS: StormState = { east: -500, north: 200, depth: 20, lat: FENWICK_LAT, friction: 5.5 };
/** The deeper low the prose compares with the starting one, hPa. */
export const DEEP_LOW = 40;

const POINTS = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];

/** The compass point a wind blows from. */
export function compassPoint(fromDeg: number): string {
  return POINTS[Math.round((((fromDeg % 360) + 360) % 360) / 22.5) % 16];
}

/** The steady wind at Fenwick Bay with the storm where `st` puts it. */
export function windAtFenwick(st: StormState): { u: number; v: number; speed: number; fromDeg: number; pressure: number } {
  const w = cycloneWind(-st.east, -st.north, { depthHpa: st.depth, radiusKm: STORM_RADIUS_KM, latDeg: st.lat, friction: st.friction * K_UNIT });
  const speed = Math.hypot(w.u, w.v);
  const fromDeg = ((Math.atan2(-w.u, -w.v) * 180) / Math.PI + 360) % 360;
  return { u: w.u, v: w.v, speed, fromDeg, pressure: w.pressure };
}

/** The second challenge: a nor’easter — a wind of at least 10 m/s from the north-east at Fenwick Bay’s latitude. */
export const NOREASTER_MIN_SPEED = 10;
export function noreasterSolved(st: StormState): boolean {
  if (st.lat !== FENWICK_LAT) return false;
  const w = windAtFenwick(st);
  return w.speed >= NOREASTER_MIN_SPEED && compassPoint(w.fromDeg) === 'north-east';
}

// ---------------------------------------------------------------------------
// Drawing helpers.

function latLabel(lat: number): string {
  return lat === 0 ? 'the equator' : `${Math.abs(lat)}° ${lat > 0 ? 'N' : 'S'}`;
}

function frictionLabel(k: number): string {
  return k === 0 ? 'none' : `${fmt(k, 1)} × 10⁻⁵ per second`;
}

/** An arrow from (x, y) by (dx, dy) pixels. */
function Vec({ x, y, dx, dy, color, width = 2.5, dashed }: { x: number; y: number; dx: number; dy: number; color: string; width?: number; dashed?: boolean }) {
  const len = Math.hypot(dx, dy);
  if (len < 3) return null;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(9, len * 0.45);
  const tx = x + dx;
  const ty = y + dy;
  const bx = tx - ux * head;
  const by = ty - uy * head;
  const hw = head * 0.55;
  return (
    <g>
      <line x1={x} y1={y} x2={bx} y2={by} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? '3 3' : undefined} />
      <polygon points={`${tx},${ty} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`} fill={color} />
    </g>
  );
}

// The sea-breeze cross-section: land on the left, sea on the right, heights to 2.2 km.
const SB_X0 = 52;
const SB_COAST = 300;
const SB_X1 = 548;
const SB_Y = scale(0, 2200, 256, 26);
/** How many times the isobars' rise and fall is exaggerated. */
export const ISOBAR_EXAGGERATION = 20;
const SB_LEVELS = [1000, 950, 900, 850];
const SB_PUSH_Z = [50, 500, 1000, 1700];
const SB_PX_PER_HPA = 45;
const SB_REST = seaBreeze(0, 'heated');

function SeaBreezeChart({ b }: { b: SeaBreeze }) {
  const clip = 'sb' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const d = b.deltaC;
  const shown = (p: number, z: number) => {
    const z0 = SB_REST.seaHeightOf(p);
    return SB_Y(z0 + ISOBAR_EXAGGERATION * (z - z0));
  };
  const aloft = b.landAt(ALOFT_M) - b.seaAt(ALOFT_M);
  const looping = b.stage === 'moving' && Math.abs(d) >= 0.25;
  // The air's loop: in along the ground toward the lower surface pressure, up, back aloft, down.
  const L = 150;
  const R = 450;
  const B = SB_Y(330);
  const T = SB_Y(1400);
  const r = 28;
  const loop =
    d > 0
      ? `M${R - r} ${B} L${L + r} ${B} Q${L} ${B} ${L} ${B - r} L${L} ${T + r} Q${L} ${T} ${L + r} ${T} L${R - r} ${T} Q${R} ${T} ${R} ${T + r} L${R} ${B - r} Q${R} ${B} ${R - r} ${B} Z`
      : `M${L + r} ${B} L${R - r} ${B} Q${R} ${B} ${R} ${B - r} L${R} ${T + r} Q${R} ${T} ${R - r} ${T} L${L + r} ${T} Q${L} ${T} ${L} ${T + r} L${L} ${B - r} Q${L} ${B} ${L + r} ${B} Z`;
  // A weather map's H or L beside each side's name.
  const letter = (mine: number, other: number) => (Math.abs(mine - other) < 0.05 ? '' : mine < other ? 'L' : 'H');
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 282"
      role="img"
      aria-label={`A cross-section of the coast: the lowest kilometer of air over the land is ${d === 0 ? 'the same temperature as over the sea' : `${fmt(Math.abs(d), 1)} °C ${d > 0 ? 'warmer' : 'colder'} than over the sea`}, ${b.stage === 'heated' ? 'before any air has moved' : 'with air moving across the coast'}. The pressure at the ground is ${fmt(b.landSurface, 1)} hPa over the land and ${fmt(b.seaSurface, 1)} hPa over the sea; 1 km up it is ${fmt(Math.abs(aloft), 1)} hPa ${aloft >= 0 ? 'higher' : 'lower'} over the land.${looping ? ` Air flows ${d > 0 ? 'in from the sea' : 'out to sea'} near the ground and back aloft.` : ''}`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={SB_X0} y={SB_Y(2200)} width={SB_X1 - SB_X0} height={SB_Y(0) - SB_Y(2200)} />
        </clipPath>
      </defs>
      <text className="ax" x={SB_X0} y={14}>
        Height
      </text>
      {[0, 1000, 2000].map((z) => (
        <text key={z} className="ax ax-e" x={SB_X0 - 6} y={SB_Y(z) + 4}>
          {z === 0 ? '0' : `${z / 1000} km`}
        </text>
      ))}
      {d !== 0 && (
        <g>
          <rect
            x={SB_X0}
            y={SB_Y(SEA_BREEZE.layerM)}
            width={SB_COAST - SB_X0}
            height={SB_Y(0) - SB_Y(SEA_BREEZE.layerM)}
            fill={tint(d > 0 ? GRAPHIC.red : GRAPHIC.blue, Math.min(0.3, 0.04 + 0.025 * Math.abs(d)))}
          />
          <text className="ax" x={SB_X0 + 6} y={SB_Y(SEA_BREEZE.layerM) + 14} style={{ fill: d > 0 ? TEXT.red : TEXT.blue }}>
            {d > 0 ? 'heated' : 'cooled'} layer
          </text>
        </g>
      )}
      <g clipPath={`url(#${clip})`}>
        {SB_LEVELS.map((p) => {
          const yl = shown(p, b.landHeightOf(p));
          const ys = shown(p, b.seaHeightOf(p));
          return (
            <path
              key={p}
              d={`M${SB_X0} ${yl} L${SB_COAST - 40} ${yl} C${SB_COAST} ${yl} ${SB_COAST} ${ys} ${SB_COAST + 40} ${ys} L${SB_X1} ${ys}`}
              fill="none"
              stroke={GRAPHIC.blue}
              strokeOpacity={0.45}
              strokeWidth={1.3}
            />
          );
        })}
        {looping && (
          <g>
            <path d={loop} fill="none" stroke={GRAPHIC.violet} strokeOpacity={0.25} strokeWidth={1.5} />
            <path d={loop} className="flow-dots" fill="none" stroke={GRAPHIC.violet} strokeWidth={4.5} style={{ animationDuration: `${Math.min(6, 3 / Math.abs(d)).toFixed(2)}s` }} />
          </g>
        )}
      </g>
      {SB_LEVELS.map((p) => {
        const ys = shown(p, b.seaHeightOf(p));
        return ys < SB_Y(2200) || ys > SB_Y(0) ? null : (
          <text key={p} className="ax" x={SB_X1 + 6} y={ys + 4} style={{ fill: TEXT.blue }}>
            {fmt(p)} hPa
          </text>
        );
      })}
      {SB_PUSH_Z.map((z) => {
        const dp = b.landAt(z) - b.seaAt(z);
        const len = dp * SB_PX_PER_HPA;
        const y = SB_Y(z);
        // Pushes under 0.15 hPa are left out: near the ground, just after heating, the difference is still close to nothing.
        return Math.abs(dp) < 0.15 ? null : (
          <g key={z}>
            <Vec x={SB_COAST - len / 2} y={y} dx={len} dy={0} color={PGF_COLOR} />
            <text className="ax ax-m" x={SB_COAST} y={y - 7} style={{ fill: TEXT.blue }}>
              {fmt(Math.abs(dp), 1)} hPa
            </text>
          </g>
        );
      })}
      <rect x={SB_X0} y={SB_Y(0)} width={SB_COAST - SB_X0} height={18} fill="#e9e4d4" />
      <rect x={SB_COAST} y={SB_Y(0)} width={SB_X1 - SB_COAST} height={18} fill="#d6e5f1" />
      <text className="ax ax-m" x={(SB_X0 + SB_COAST) / 2} y={SB_Y(0) + 13}>
        <tspan style={{ fill: TEXT.blue, fontWeight: 700 }}>{letter(b.landSurface, b.seaSurface)}</tspan>
        <tspan dx={letter(b.landSurface, b.seaSurface) ? 5 : 0}>land</tspan>
      </text>
      <text className="ax ax-m" x={(SB_COAST + SB_X1) / 2} y={SB_Y(0) + 13} style={{ fill: '#5d7f9c' }}>
        <tspan style={{ fill: TEXT.blue, fontWeight: 700 }}>{letter(b.seaSurface, b.landSurface)}</tspan>
        <tspan dx={letter(b.seaSurface, b.landSurface) ? 5 : 0}>sea</tspan>
      </text>
    </svg>
  );
}

// Figure 2's plot area.
const PX0 = 20;
const PX1 = 620;
const PY0 = 40;
const PY1 = 266;
const FORCE_PX = 46;
const PGF_COLOR = GRAPHIC.blue;
const COR_COLOR = '#333333';
const FRIC_COLOR = '#9a9a9a';
const VEL_COLOR = GRAPHIC.violet;

function TrackChart({ gradient, lat, friction, hours }: { gradient: number; lat: number; friction: number; hours: number }) {
  const k = friction * K_UNIT;
  const track = useMemo(() => windTrack(gradient, lat, k, TRACK_HOURS, STEP_MIN), [gradient, lat, k]);
  const view = useMemo(() => {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const p of track) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const sc = 0.9 * Math.min((PX1 - PX0) / Math.max(maxX - minX, 100), (PY1 - PY0) / Math.max(maxY - minY, 100));
    return { sc, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }, [track]);
  const px = (xKm: number) => (PX0 + PX1) / 2 + (xKm - view.cx) * view.sc;
  const py = (yKm: number) => (PY0 + PY1) / 2 - (yKm - view.cy) * view.sc;

  // Isobars every 4 hPa, thinned out when they'd crowd.
  let hpa = 4;
  while (((PY1 - PY0) / view.sc / ((hpa / gradient) * 100)) > 12) hpa *= 2;
  const spacing = (hpa / gradient) * 100;
  const yTop = view.cy + (PY1 - PY0) / 2 / view.sc;
  const yBot = view.cy - (PY1 - PY0) / 2 / view.sc;
  const isobars: number[] = [];
  for (let j = Math.floor(yBot / spacing); j <= Math.ceil(yTop / spacing); j++) isobars.push(j);

  const i = Math.min(track.length - 1, Math.round((hours * 60) / STEP_MIN));
  const cur = track[i];
  const path = linePath(
    track.slice(0, i + 1).map((p) => px(p.x)),
    track.slice(0, i + 1).map((p) => py(p.y)),
  );
  const f = coriolis(lat);
  const F = pressureForce(gradient, AIR_DENSITY);
  const sx = px(cur.x);
  const sy = py(cur.y);
  const speed = Math.hypot(cur.u, cur.v);
  const vScale = Math.min(3, speed > 0 ? 90 / speed : 3);
  const scaleF = (a: number) => (FORCE_PX * a) / F;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 296"
      role="img"
      aria-label={`A parcel of air released at rest at ${latLabel(lat)} in a pressure gradient of ${fmt(gradient, 1)} hPa per 100 km, with lower pressure to the north and friction ${frictionLabel(friction)}. After ${fmt(hours)} hours it is ${fmt(cur.x)} km east and ${fmt(cur.y)} km north of where it started, moving at ${fmt(speed, 1)} m/s.`}
    >
      <defs>
        <clipPath id="wfe-plot">
          <rect x={PX0 - 10} y={PY0 - 6} width={PX1 - PX0 + 20} height={PY1 - PY0 + 12} />
        </clipPath>
      </defs>
      <text className="ax" x={PX0} y={16}>
        ↑ Lower pressure (north)
      </text>
      <text className="ax" x={PX0} y={290}>
        Higher pressure (south)
      </text>
      <text className="ax ax-e" x={PX1} y={16} style={{ fill: TEXT.ink }}>
        {fmt(hours)} h after release
      </text>
      <g clipPath="url(#wfe-plot)">
        {isobars.map((j) => {
          const y = py(j * spacing);
          if (y < PY0 - 4 || y > PY1 + 4) return null;
          return (
            <g key={j}>
              <line x1={PX0} x2={PX1} y1={y} y2={y} stroke={GRAPHIC.blue} strokeOpacity={0.35} strokeWidth={1.2} />
              <text className="ax ax-e" x={PX1} y={y - 4} style={{ fill: TEXT.blue }}>
                {fmt(1012 - j * hpa)} hPa
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke={VEL_COLOR} strokeWidth={2.5} strokeLinejoin="round" opacity={0.85} />
        <circle cx={px(0)} cy={py(0)} r={4} fill="#fcfcfb" stroke="#555" strokeWidth={1.5} />
      </g>
      {/* Forces on the parcel, scaled so the pressure force is always the same length. */}
      <Vec x={sx} y={sy} dx={0} dy={-FORCE_PX} color={PGF_COLOR} />
      <Vec x={sx} y={sy} dx={scaleF(f * cur.v)} dy={scaleF(f * cur.u)} color={COR_COLOR} />
      <Vec x={sx} y={sy} dx={scaleF(-k * cur.u)} dy={scaleF(k * cur.v)} color={FRIC_COLOR} />
      <Vec x={sx} y={sy} dx={cur.u * vScale} dy={-cur.v * vScale} color={VEL_COLOR} width={3.5} />
      <circle cx={sx} cy={sy} r={6} fill={VEL_COLOR} stroke="#fcfcfb" strokeWidth={2} />
    </svg>
  );
}

// Figure 3: the map around Fenwick Bay, 0.25 px per km.
const MAP_SCALE = 0.25;
const CAL_X = 300;
const CAL_Y = 200;
const COAST = 'M352 0 C340 60 362 120 334 182 C322 206 338 246 350 290 C360 330 350 368 364 400';
const SEA = `${COAST} L640 400 L640 0 Z`;

function StormMap({ st }: { st: StormState }) {
  const k = st.friction * K_UNIT;
  const f = coriolis(st.lat);
  const noBalance = f === 0 && k === 0;
  const cx = CAL_X + st.east * MAP_SCALE;
  const cy = CAL_Y - st.north * MAP_SCALE;
  const arrows: Array<{ x: number; y: number; dx: number; dy: number; o: number }> = [];
  for (let gx = 28; gx <= 620; gx += 48) {
    for (let gy = 24; gy <= 380; gy += 48) {
      const xKm = (gx - cx) / MAP_SCALE;
      const yKm = (cy - gy) / MAP_SCALE;
      if (Math.hypot(xKm, yKm) < 60) continue;
      if (noBalance) {
        // Nothing balances the push: draw it, pointing straight at the low.
        const r = Math.hypot(xKm, yKm);
        const g = Math.exp(-(r * r) / (2 * STORM_RADIUS_KM ** 2)) * (r / STORM_RADIUS_KM);
        arrows.push({ x: gx, y: gy, dx: (-xKm / r) * 30 * Math.min(1, g * 2), dy: (yKm / r) * 30 * Math.min(1, g * 2), o: 0.6 });
        continue;
      }
      const w = cycloneWind(xKm, yKm, { depthHpa: st.depth, radiusKm: STORM_RADIUS_KM, latDeg: st.lat, friction: k });
      const sp = Math.hypot(w.u, w.v);
      const len = Math.min(34, sp * 1.4);
      if (sp < 0.3) continue;
      arrows.push({ x: gx, y: gy, dx: (w.u / sp) * len, dy: (-w.v / sp) * len, o: Math.min(1, 0.35 + sp / 25) });
    }
  }
  // Isobars every 4 hPa from 1,012 hPa down to the center.
  const rings: Array<{ p: number; r: number }> = [];
  for (let p = 1012; p > 1013 - st.depth; p -= 4) {
    const r = STORM_RADIUS_KM * Math.sqrt(2 * Math.log(st.depth / (1013 - p)));
    rings.push({ p, r: r * MAP_SCALE });
  }
  const cal = windAtFenwick(st);
  const sense = st.lat > 0 ? 'counterclockwise' : st.lat < 0 ? 'clockwise' : 'straight inward';
  const calLen = Math.min(44, cal.speed * 1.8);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 400"
      role="img"
      aria-label={`A low of ${fmt(1013 - st.depth)} hPa centered ${fmt(Math.abs(st.east))} km ${st.east >= 0 ? 'east' : 'west'} and ${fmt(Math.abs(st.north))} km ${st.north >= 0 ? 'north' : 'south'} of Fenwick Bay, at ${latLabel(st.lat)}, with friction ${frictionLabel(st.friction)}. The winds blow ${sense} around it${k > 0 && st.lat !== 0 ? ', spiraling in' : ''}. At Fenwick Bay the wind blows from the ${compassPoint(cal.fromDeg)} at ${fmt(cal.speed, 1)} m/s.`}
    >
      <defs>
        <clipPath id="wfe-map">
          <rect x={0} y={0} width={640} height={400} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={640} height={400} fill="#f2f0e9" />
      <path d={SEA} fill="#d6e5f1" />
      <path d={COAST} fill="none" stroke="#a9c3d9" strokeWidth={1.5} />
      <text className="ax" x={600} y={388} textAnchor="end" style={{ fill: '#5d7f9c' }}>
        sea
      </text>
      <g clipPath="url(#wfe-map)">
        {rings.map((r) => (
          <g key={r.p}>
            <circle cx={cx} cy={cy} r={r.r} fill="none" stroke={GRAPHIC.blue} strokeOpacity={0.45} strokeWidth={1.2} />
            <text x={cx} y={cy - r.r - 3} textAnchor="middle" className="ax" style={{ fill: TEXT.blue }}>
              {r.p}
            </text>
          </g>
        ))}
        {arrows.map((a, i) => (
          <g key={i} opacity={a.o}>
            <Vec x={a.x - a.dx / 2} y={a.y - a.dy / 2} dx={a.dx} dy={a.dy} color={VEL_COLOR} width={1.8} dashed={noBalance} />
          </g>
        ))}
        <text x={cx} y={cy + 7} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: TEXT.blue }}>
          L
        </text>
      </g>
      {/* Fenwick Bay and its wind. */}
      <circle cx={CAL_X} cy={CAL_Y} r={5} fill="#333" />
      <text x={CAL_X - 10} y={CAL_Y + 20} textAnchor="end" className="lab">
        Fenwick Bay
      </text>
      {!noBalance && cal.speed > 0.3 && <Vec x={CAL_X} y={CAL_Y} dx={(cal.u / cal.speed) * calLen} dy={(-cal.v / cal.speed) * calLen} color={TEXT.violet} width={3.5} />}
    </svg>
  );
}

export default function Lesson() {
  const h = useScenario('breeze', BREEZE_DEFAULTS);
  const breeze = seaBreeze(h.state.deltaC, h.state.stage);
  const dT = h.state.deltaC;
  const aloftGap = breeze.landAt(ALOFT_M) - breeze.seaAt(ALOFT_M);
  let breezeCaption: string;
  if (dT === 0) breezeCaption = 'With the land and the sea at the same temperature, the pressure is the same on both sides at every height: nothing pushes the air across the coast.';
  else if (h.state.stage === 'heated')
    breezeCaption = `The air over the land is ${fmt(Math.abs(dT), 1)} °C ${dT > 0 ? 'warmer, and has expanded upward' : 'colder, and has shrunk downward'}. Each column still holds the same air, so the pressure at the ground is ${fmt(SEA_BREEZE.p0)} hPa on both sides, but 1 km up it is ${fmt(Math.abs(aloftGap), 1)} hPa ${aloftGap > 0 ? 'higher over the land: the air there is pushed out to sea' : 'higher over the sea: the air there is pushed inland'}.`;
  else
    breezeCaption = `Air has moved ${dT > 0 ? 'out to sea' : 'inland'} aloft, so the pressure at the ground is now ${fmt(breeze.landSurface, 1)} hPa over the land and ${fmt(breeze.seaSurface, 1)} hPa over the sea, and near the ground the air is pushed ${dT > 0 ? 'inland: a sea breeze' : 'out to sea: a land breeze'}. In this sketch the air has moved until the pressure is level halfway up the ${dT > 0 ? 'heated' : 'cooled'} layer; above that height the push still points the other way.`;

  const s = useScenario('parcel', { gradient: 1, lat: FENWICK_LAT, friction: 0 });
  const { gradient, lat, friction } = s.state;
  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => (x >= TRACK_HOURS + 4 ? 0 : x + dt * HOURS_PER_SECOND)), play.playing);
  const hours = Math.min(t, TRACK_HOURS);
  const change = (patch: Partial<typeof s.state>) => {
    s.set(patch);
    setT(0);
  };

  const k = friction * K_UNIT;
  const f = coriolis(lat);
  const vg = f !== 0 ? geostrophicSpeed(gradient, lat) : Infinity;
  const period = f !== 0 ? inertialPeriodHours(lat) : Infinity;
  const steady = steadyWind(gradient, lat, k);
  const runaway = f === 0 && k === 0;
  const solved = geostrophicSolved(gradient, lat);

  const m = useScenario('storm', STORM_DEFAULTS);
  const st = m.state;
  const cal = windAtFenwick(st);
  const solved2 = noreasterSolved(st);

  // Numbers the prose quotes.
  const vg41 = geostrophicSpeed(1, FENWICK_LAT);
  const t41 = inertialPeriodHours(FENWICK_LAT);
  const free = useMemo(() => windTrack(1, FENWICK_LAT, 0, TRACK_HOURS, STEP_MIN), []);
  const peak = free.reduce((a, p) => (p.u > a.u ? p : a), free[0]);
  const land = steadyWind(1, FENWICK_LAT, 5.5 * K_UNIT);
  const landTrack = useMemo(() => windTrack(1, FENWICK_LAT, 5.5 * K_UNIT, TRACK_HOURS, STEP_MIN), []);
  const landEnd = landTrack[landTrack.length - 1];
  const sea = steadyWind(1, FENWICK_LAT, 2.5 * K_UNIT);
  const eqTrack = useMemo(() => windTrack(1, 0, 0, 6, STEP_MIN), []);
  const eq6 = eqTrack[eqTrack.length - 1];
  const need = (latDeg: number) => GEO_TARGET / geostrophicSpeed(1, latDeg);
  const start = windAtFenwick(STORM_DEFAULTS);
  const deep = windAtFenwick({ ...STORM_DEFAULTS, depth: DEEP_LOW });
  const justHeated = seaBreeze(BREEZE_DEFAULTS.deltaC, 'heated');
  const moving = seaBreeze(BREEZE_DEFAULTS.deltaC, 'moving');

  const fMantissa = Math.abs(f) / 1e-5;

  return (
    <LessonPage id="weather/1.5">
      <P>
        The last three lessons followed air up and down, as heating, moisture and stability lifted it or held it back. But most of the atmosphere’s motion is
        sideways, and that is what we feel as wind. This lesson asks what makes the wind blow, and why on a weather map it circles the highs and lows instead of
        flowing straight from one to the other.
      </P>
      <P>
        Where the pressure on one side of a parcel is higher than on the other, the difference pushes it toward the lower pressure. Such differences start with the
        uneven heating of <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>. The pressure at the ground is the weight of the air above it, and warming a column
        doesn’t change its weight, so at first it doesn’t change the pressure at the ground. The column expands upward instead, raising the pressure aloft: at any
        given height, more of its air now lies above than in a cooler column beside it.
      </P>
      <P>
        In the next demonstration it’s a summer afternoon at Fenwick Bay, and the sun has warmed the lowest kilometer of air over the land more than the air over
        the sea. The blue lines are <b>isobars</b>, surfaces of equal pressure, seen side-on, their rise and fall exaggerated {ISOBAR_EXAGGERATION} times; the
        blue arrows show which way the pressure difference at each height pushes the air. Change how much warmer the land is, and let the air move:
      </P>

      <Figure name="Wind Field Explorer" scenario={h}>
        <Segmented
          label="Stage"
          value={h.state.stage}
          onChange={(v) => h.set({ stage: v })}
          options={[
            { value: 'heated', label: 'Just heated' },
            { value: 'moving', label: 'Air on the move' },
          ]}
        />
        <SeaBreezeChart b={breeze} />
        <Legend
          items={[
            { label: 'Isobars', color: tint(GRAPHIC.blue, 0.55), kind: 'line' },
            { label: 'Push toward lower pressure', color: PGF_COLOR },
            { label: 'The air’s loop', color: GRAPHIC.violet, kind: 'line', dashed: true },
          ]}
        />
        <Slider
          label="Air over the land, against the sea"
          tone={WX.temperature}
          value={dT}
          min={-5}
          max={10}
          step={0.5}
          onChange={(v) => h.set({ deltaC: v })}
          display={dT === 0 ? 'the same' : `${fmt(Math.abs(dT), 1)} °C ${dT > 0 ? 'warmer' : 'colder'}`}
        />
        <Caption>{breezeCaption}</Caption>
      </Figure>

      <P>
        Just heated, with the land {fmt(BREEZE_DEFAULTS.deltaC)} °C warmer, the pressure at the ground is still {fmt(SEA_BREEZE.p0)} hPa on both sides, but 1 km up
        it is {fmt(justHeated.landAt(ALOFT_M) - justHeated.seaAt(ALOFT_M), 1)} hPa higher over the land, pushing the air there out to sea. Let it move,
        and the land’s column holds less air and the sea’s more: the pressure at the ground falls to {fmt(moving.landSurface, 1)} hPa over the land and rises to{' '}
        {fmt(moving.seaSurface, 1)} over the sea. Now the push near the ground points inland, and cool air flows in off the water: a <b>sea breeze</b>. At night
        the loop reverses into a land breeze. The same machine works at every scale: a low over hot ground is a <b>thermal
        low</b>, and the tropics, heated more than the poles, drive the circulation of <a href={lessonHref('weather/2.1')}>Chapter 2</a>.
      </P>
      <P>
        The push on each kilogram of air is the <K tone={WX.pressure}>pressure-gradient force</K>: the pressure difference divided by the air’s density and the
        distance over which the pressure changes, Δp/(ρ·Δn). Weather maps draw isobars at sea level, often 4 hPa apart; where they crowd together the force is
        strong. A gradient of 1 hPa per 100 km, an isobar every 400 km, is ordinary — and gentle, an acceleration of less than a thousandth of a meter per second
        every second. But it never lets up. With nothing to oppose it, it would take still air to {fmt(eq6.v)} m/s in six hours.
      </P>
      <P>
        It is opposed, because the ground is turning. Seen from Earth’s surface, anything moving across it is deflected — to the right of its motion in the Northern
        Hemisphere, to the left in the Southern — as if pushed sideways by a force proportional to its speed. This is the <K tone="ink">Coriolis effect</K>. It isn’t
        a push from anything, just how motion looks from a spinning platform. Its strength is set by the Coriolis parameter{' '}
        <i>f</i> = 2Ω·sin(latitude), where Ω is Earth’s rotation rate. <i>f</i> is zero at the equator and largest at the poles, and at Fenwick Bay’s 41° north it is{' '}
        {fmt(coriolis(FENWICK_LAT) / 1e-5, 2)} × 10⁻⁵ per second.
      </P>
      <P>
        In the next demonstration, a parcel of air starts at rest between straight isobars, with lower pressure to the north. The arrows are the forces on it, all drawn to
        the same scale, and its velocity; the violet line is its path over two days. The equation gives the <K tone={WX.wind}>geostrophic wind</K>, the speed at which the Coriolis force would balance the push, and a
        readout the <b>inertial period</b>, the time one loop takes. Change the pressure gradient, the latitude and the friction:
      </P>

      <Figure name="Wind Field Explorer · released parcel" scenario={s} play={play}>
        <TrackChart gradient={gradient} lat={lat} friction={friction} hours={hours} />
        <Legend
          items={[
            { label: 'Pressure-gradient force', color: PGF_COLOR },
            { label: 'Coriolis force', color: COR_COLOR },
            { label: 'Friction', color: FRIC_COLOR },
            { label: 'Velocity and path', color: VEL_COLOR },
          ]}
        />
        <Readouts
          items={[
            { label: 'inertial period', value: f !== 0 ? `${fmt(period, 1)} h` : '—' },
            { label: 'steady wind with friction', value: runaway ? 'never steady' : `${fmt(steady.speed, 1)} m/s`, tone: WX.wind },
            { label: 'angle across the isobars', value: runaway ? '90°' : `${fmt(steady.angleDeg)}°` },
          ]}
        />
        <Slider
          label="Pressure gradient"
          tone={WX.pressure}
          value={gradient}
          min={0.2}
          max={4}
          step={0.1}
          onChange={(v) => change({ gradient: v })}
          display={`${fmt(gradient, 1)} hPa per 100 km`}
        />
        <Slider label="Latitude" value={lat} min={-80} max={80} onChange={(v) => change({ lat: v })} display={latLabel(lat)} />
        <Slider label="Friction" value={friction} min={0} max={15} step={0.5} onChange={(v) => change({ friction: v })} display={frictionLabel(friction)} />
        {f !== 0 ? (
          <Eq label={`Geostrophic wind: ${fmt(gradient * 100)} pascals over 100 kilometers, divided by air density times f, is ${fmt(vg, 1)} meters per second`}>
            <K tone={WX.wind}>
              V<Sub>g</Sub>
            </K>
            <Op>=</Op>
            <Frac top={<K tone={WX.pressure}>Δp</K>} bottom={<>ρ · <i>f</i> · Δn</>} />
            <Op>=</Op>
            <Frac
              top={<K tone={WX.pressure}>{fmt(gradient * 100)} Pa</K>}
              bottom={
                <>
                  1.2 kg/m³ × {fmt(fMantissa, 2)} × 10<Sup>−5</Sup> s<Sup>−1</Sup> × 100,000 m
                </>
              }
            />
            <Op>=</Op>
            <K tone={WX.wind}>{fmt(vg, 1)} m/s</K>
          </Eq>
        ) : (
          <Caption>At the equator <i>f</i> = 0: no wind is fast enough for the Coriolis force to balance the push.</Caption>
        )}
      </Figure>

      <P>
        At the start, with no friction, the parcel sets off toward the low, but as it gathers speed the Coriolis force grows and turns it to the right, toward the
        east. About nine hours after release it is heading due east at {fmt(peak.u, 1)} m/s, {fmt(peak.y)} km north of where it
        started, and the Coriolis force is now twice the pressure force: it bends the parcel back south. At {fmt(t41)} hours it is back on its starting isobar, at
        rest, and the loop begins again. That interval, 2π/<i>f</i>, is the inertial period.
      </P>
      <P>
        Averaged over a loop, the parcel gets no closer to the low at all. It drifts east at {fmt(vg41, 1)} m/s, along the isobars, with low pressure on its left.
        That is the speed at which the two forces balance exactly, the pressure force pulling toward the low and the Coriolis force pushing away from it: the
        geostrophic wind. Its formula is the equation in the demonstration, and it grows in proportion to the gradient: the tighter the isobars, the faster the
        wind. Real air doesn’t loop for days; the pressure and wind fields nudge each other toward balance. Above the lowest kilometer or so, large-scale winds blow
        very nearly along the isobars at very nearly this speed, so a forecaster can read the winds aloft off a pressure map.
      </P>
      <P>
        Latitude matters as much as the gradient. The same 1 hPa per 100 km gives {fmt(geostrophicSpeed(1, 20), 1)} m/s at 20° and {fmt(geostrophicSpeed(1, 60), 1)}{' '}
        m/s at 60°: where the Coriolis effect is weaker, the wind must blow faster to balance the push. At the equator there is no balance at all: slide the
        latitude to 0° and the parcel heads straight for the low, and air flows down the pressure difference and fills it in. That is one
        reason tropical cyclones rarely form within about 5° of the equator.
      </P>

      <Challenge
        id="a"
        question={`Strong winds aloft come from tightly packed isobars. At Fenwick Bay’s 41° north, 1 hPa per 100 km gives a geostrophic wind of ${fmt(vg41, 1)} m/s. Predict first, from the proportion: what gradient gives 20 m/s? Then set it and check.`}
        solved={solved}
        status={
          lat !== FENWICK_LAT
            ? `Set the latitude back to 41° N first; it’s at ${latLabel(lat)}.`
            : gradient === 1
              ? 'Predict first, then set the pressure gradient.'
              : vg < GEO_TARGET
                ? 'Not fast enough yet: the isobars need to be tighter.'
                : 'Too fast: the isobars are packed too tightly.'
        }
        success={`Solved. The geostrophic wind grows in proportion to the gradient, so 20 m/s takes 20 ÷ ${fmt(vg41, 1)} ≈ ${fmt(need(FENWICK_LAT), 1)} times the starting gradient: ${fmt(need(FENWICK_LAT), 1)} hPa per 100 km, an isobar every ${fmt(400 / need(FENWICK_LAT))} km. At 20° the same wind would take only ${fmt(need(20), 1)} hPa per 100 km; at 60°, ${fmt(need(60), 1)}.`}
      />

      <H2>Friction near the ground</H2>
      <P>
        In the lowest kilometer or so, the wind drags over trees, buildings, hills and waves. Friction slows it, and since the Coriolis force is proportional to
        speed, a slower wind is turned less. The pressure force wins a little, and the wind settles at an angle across the isobars, toward low pressure. In this
        model friction is a drag proportional to the wind’s speed, and the tangent of the angle is the friction coefficient divided by <i>f</i>.
      </P>
      <P>
        Raise the friction in <FigRef to="Wind Field Explorer · released parcel">the released-parcel demonstration</FigRef> and watch the loops die away and the
        path bend toward lower pressure. At 5.5 × 10⁻⁵ per second the parcel settles at {fmt(land.speed, 1)} m/s, {fmt((100 * land.speed) / vg41)}% of the geostrophic
        speed, crossing the isobars at {fmt(land.angleDeg)}°; after two days it has drifted {fmt(landEnd.y)} km toward lower pressure. The angle is close to
        what is observed over land, around 30°, though real surface winds there are slower, nearer half the geostrophic speed. Over the smoother sea the angle is smaller: at 2.5 × 10⁻⁵ per second, the model’s wind crosses at{' '}
        {fmt(sea.angleDeg)}°. Those few degrees let air flow into low pressure — and air flowing in has to go somewhere.
      </P>

      <H2>Around a low</H2>
      <P>
        On a real weather map, isobars close around centers of low and high pressure. Around a low, the pressure force points inward from every side. In the Northern Hemisphere the wind, turned to the right, circles the low counterclockwise, and near the ground friction adds an inward drift, so the air
        spirals in. Air converging near the ground can only go up, and rising air expands and cools until its vapor condenses: lows bring cloud, rain and wind. Around
        a high everything reverses: clockwise, spiraling out, with sinking, drying air and usually clear skies. In 1857 the Dutch meteorologist C. H. D. Buys Ballot put the rule in a form sailors could use: in the Northern Hemisphere, stand with your back
        to the wind and low pressure is on your left.
      </P>
      <P>
        The next demonstration puts a storm near Fenwick Bay, on a coast with the sea to its east. The arrows show the steady surface wind around the low, with Fenwick
        Bay’s own wind drawn bold. Move the storm and change its depth, the latitude and the friction. It starts with a {fmt(STORM_DEFAULTS.depth)}{' '}
        hPa low 500 km west and 200 km north of the city, the kind that tracks inland:
      </P>

      <Figure name="Wind Field Explorer · around a low" scenario={m}>
        <StormMap st={st} />
        <Readouts
          items={[
            { label: 'wind at Fenwick Bay', value: `${fmt(cal.speed, 1)} m/s`, tone: WX.wind },
            { label: 'blowing from the', value: cal.speed > 0.3 ? compassPoint(cal.fromDeg) : '—', tone: WX.wind },
            { label: 'pressure at Fenwick Bay', value: `${fmt(cal.pressure)} hPa`, tone: WX.pressure },
          ]}
        />
        <Slider
          label="Storm center, east–west"
          value={st.east}
          min={-900}
          max={900}
          step={50}
          onChange={(v) => m.set({ east: v })}
          display={st.east === 0 ? 'due north–south of the city' : `${fmt(Math.abs(st.east))} km ${st.east > 0 ? 'east' : 'west'}`}
        />
        <Slider
          label="Storm center, north–south"
          value={st.north}
          min={-700}
          max={700}
          step={50}
          onChange={(v) => m.set({ north: v })}
          display={st.north === 0 ? 'level with the city' : `${fmt(Math.abs(st.north))} km ${st.north > 0 ? 'north' : 'south'}`}
        />
        <Slider label="Depth of the low" tone={WX.pressure} value={st.depth} min={4} max={40} onChange={(v) => m.set({ depth: v })} display={`${st.depth} hPa`} />
        <Slider label="Latitude" value={st.lat} min={-60} max={60} onChange={(v) => m.set({ lat: v })} display={latLabel(st.lat)} />
        <Slider label="Friction" value={st.friction} min={0} max={15} step={0.5} onChange={(v) => m.set({ friction: v })} display={frictionLabel(st.friction)} />
      </Figure>

      <P>
        With the low passing to the north-west, Fenwick Bay is on its warm side. The wind blows from the {compassPoint(start.fromDeg)} at {fmt(start.speed)} m/s,
        bringing in air from lower latitudes. Now move the storm offshore, south of the city, as happens when a storm runs up the coast. The wind at Fenwick Bay swings
        round until it blows off the cold ocean from the north-east. On the east coast of North America such storms are called nor’easters, after this wind;
        in winter they bring some of the region’s heaviest snow.
      </P>

      <Challenge
        id="b"
        question="Place the storm so that Fenwick Bay, at 41° north, gets a nor’easter: a wind of at least 10 m/s from the north-east."
        solved={solved2}
        status={
          st.lat !== FENWICK_LAT
            ? `Set the latitude back to 41° N first; it’s at ${latLabel(st.lat)}.`
            : cal.speed < 0.3
              ? 'Right now there’s almost no wind at Fenwick Bay.'
              : `Right now the wind at Fenwick Bay blows from the ${compassPoint(cal.fromDeg)} (${fmt(cal.fromDeg)}°) at ${fmt(cal.speed, 1)} m/s.`
        }
        success={`Solved. With your back to the north-east wind, low pressure is on your left and a little ahead: to the south and south-east, offshore. The wind blows from ${fmt(cal.fromDeg)}° at ${fmt(cal.speed, 1)} m/s. A low passing inland, to the west, would have given the city southerly winds and mild air instead — which way a storm tracks often decides whether a winter storm brings the city rain or snow.`}
      />

      <P>
        Drag the latitude south of the equator and the rotation reverses; at 0° the wind blows straight in and fills the low. Deepen the low to {fmt(DEEP_LOW)} hPa
        and its isobars crowd twice as close: the wind at Fenwick Bay doubles, to {fmt(deep.speed)} m/s.
      </P>
      <P>
        That completes this chapter’s answer to its question. Weather happens because the Sun heats the planet unevenly; because warmed air rises and cooled air
        sinks; because water vapor carries the Sun’s energy to wherever it condenses; and because the pressure differences heating creates push the air, while
        Earth’s rotation turns the push into winds that circle the highs and lows instead of filling them, so the contrast between the tropics and the poles is
        released in storms rather than draining away. Chapter 2
        puts these pieces together at the scale of the planet, starting in <a href={lessonHref('weather/2.1')}>the next lesson</a> with the global circulation — the
        trade winds, the westerlies and the jet streams that steer the weather of 41° north.
      </P>
    </LessonPage>
  );
}
