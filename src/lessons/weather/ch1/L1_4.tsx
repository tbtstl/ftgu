import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
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
import { ascendThrough, heatedProfile, mixedLayerTopKm, stepParcel, thermalTop, type ParcelState } from '../../../engines/weather/convection';
import { DRY_LAPSE, G, K0, bruntVaisala, displacedParcel, moistLapseRate, stabilityClass, type Ascent, type Sounding } from '../../../engines/weather/thermo';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: a summer morning over Marlow, heated through the day.

/** Dawn temperature at the surface, °C. */
export const MORNING_C = 20;
/** The tropopause: above it the morning air stops cooling with height, km. */
export const TROPOPAUSE_KM = 12;
/** The cap: a layer from 1.5 to 2 km where the morning air warms with height. */
export const CAP_LAYER = { baseKm: 1.5, depthKm: 0.5 };
/** Heights the ascent is computed to, km (the diagram shows the lowest 14). */
export const TOP_KM = 16;
/** A thermal leaves the ground at 3 m/s: ½w² = 4.5 J/kg of kinetic energy. */
export const THERMAL_W0 = 3;
/** Quadratic drag standing in for the mixing that slows a real updraft, per meter. */
export const DRAG = 1e-4;
/** How long a thermal is followed when judging whether it broke through, s. */
const FLIGHT_S = 2400;

export interface ConvectionState {
  /** Afternoon surface temperature, °C. */
  surfaceC: number;
  /** Surface dew point, °C. */
  dewC: number;
  /** How fast the morning air cools with height above the ground, °C per km. */
  lapse: number;
  /** How much warmer the top of the cap is than its base, °C. */
  cap: number;
}

export const CONVECTION_DEFAULTS: ConvectionState = { surfaceC: 24, dewC: 17, lapse: 6.5, cap: 3 };
export const T_MIN = MORNING_C;
export const T_MAX = 38;
export const T_STEP = 0.5;

export function morningSounding(lapse: number, cap: number): Sounding {
  return { surfaceC: MORNING_C, lapse, tropopauseKm: TROPOPAUSE_KM, inversion: { ...CAP_LAYER, strengthK: cap } };
}

/** The surface parcel's ascent through the heated morning profile. */
export function convectionAscent(st: ConvectionState): Ascent {
  const m = morningSounding(st.lapse, st.cap);
  return ascendThrough(heatedProfile(m, st.surfaceC), st.surfaceC, Math.min(st.dewC, st.surfaceC), { topKm: TOP_KM });
}

/** The highest a thermal leaving the ground at 3 m/s climbs, m. */
export function thermalTopM(st: ConvectionState): number {
  return thermalTop(convectionAscent(st), { w0: THERMAL_W0, drag: DRAG, durationS: FLIGHT_S });
}

/** A thermal breaks through when it climbs at least a kilometer past the top of the cap. */
export function breaksThrough(st: ConvectionState): boolean {
  return thermalTopM(st) > (CAP_LAYER.baseKm + CAP_LAYER.depthKm + 1) * 1000;
}

/** Whether the dew point, lapse rate and cap are the challenge's: the starting ones. */
export function capConditionsKept(st: ConvectionState): boolean {
  const d = CONVECTION_DEFAULTS;
  return Math.abs(st.dewC - d.dewC) < 1e-6 && Math.abs(st.lapse - d.lapse) < 1e-6 && Math.abs(st.cap - d.cap) < 1e-6;
}

/**
 * The challenge: with the starting dew point, lapse rate and cap, the lowest afternoon temperature
 * (to the half degree) at which a thermal breaks through. It's 30.5 °C.
 */
export function capSolved(st: ConvectionState): boolean {
  if (!capConditionsKept(st) || st.surfaceC - T_STEP < T_MIN - 1e-9) return false;
  return breaksThrough(st) && !breaksThrough({ ...st, surfaceC: st.surfaceC - T_STEP });
}

/**
 * The thermal's lift inside its first cloud: the warmest the parcel gets above its surroundings
 * between the cloud base and the level of free convection, and where.
 */
export function lowCloudLift(a: Ascent): { gapC: number; atKm: number } {
  let gapC = 0;
  let atKm = a.lclKm;
  const top = a.lfcKm ?? a.z[a.z.length - 1];
  for (let i = 0; i < a.z.length; i++) {
    if (a.z[i] < a.lclKm || a.z[i] >= top) continue;
    const g = a.parcel[i] - a.env[i];
    if (g > gapC) {
      gapC = g;
      atKm = a.z[i];
    }
  }
  return { gapC, atKm };
}

// ---------------------------------------------------------------------------
// The second demonstration: a dry parcel nudged up and released.

/** Temperature of the layer the parcel is displaced in, °C. */
export const LAYER_C = 10;
export const PERIOD_TARGET_MIN: [number, number] = [19, 21];

/** Period of a displaced parcel's oscillation, minutes, or null if the layer isn't stable. */
export function oscillationPeriodMin(lapse: number): number | null {
  const p = bruntVaisala(LAYER_C, lapse).periodS;
  return p === null ? null : p / 60;
}

/** The second challenge: an oscillation of about 20 minutes, twice the standard atmosphere's. */
export function periodSolved(lapse: number): boolean {
  const p = oscillationPeriodMin(lapse);
  return p !== null && p >= PERIOD_TARGET_MIN[0] && p <= PERIOD_TARGET_MIN[1];
}

// ---------------------------------------------------------------------------
// Drawing.

const SKEW = 6.5; // °C per km: the standard lapse rate draws a vertical line
const Z_MAX = 14;
const PX0 = 56;
const PX1 = 528;
const X = scale(-5, 65, PX0, PX1);
const Y = scale(0, Z_MAX, 352, 18);
const sx = (t: number, z: number) => X(t + SKEW * z);
const PARCEL_DRY = '#666666';
const PARCEL_MOIST = GRAPHIC.teal;
/** CIN is where the parcel is colder, and so denser, than its surroundings: the density tone, hatched to set it apart from CAPE's gold. */
const CIN_FILL = GRAPHIC.orange;
const CIN_SWATCH = `repeating-linear-gradient(135deg, ${CIN_FILL} 0 2px, ${tint(CIN_FILL, 0.25)} 2px 5px)`;

/** Index of the last ascent level at or below a height. */
function idx(a: Ascent, zKm: number) {
  const dz = a.z[1] - a.z[0];
  return Math.max(0, Math.min(a.z.length - 1, Math.floor(zKm / dz + 1e-9)));
}

/** Parcel temperature at any height, °C. */
function parcelAt(a: Ascent, zKm: number) {
  const dz = a.z[1] - a.z[0];
  const i = Math.min(a.z.length - 2, Math.max(0, zKm / dz));
  const lo = Math.floor(i);
  return a.parcel[lo] + (a.parcel[lo + 1] - a.parcel[lo]) * (i - lo);
}

/** Spread labels vertically so none sits closer than `gap` px to the next. */
function spread<T extends { y: number }>(items: T[], gap = 15): T[] {
  const s = [...items].sort((a, b) => b.y - a.y);
  for (let i = 1; i < s.length; i++) if (s[i - 1].y - s[i].y < gap) s[i] = { ...s[i], y: s[i - 1].y - gap };
  return s;
}

function SoundingDiagram({ a, st, sim, top, broke }: { a: Ascent; st: ConvectionState; sim: ParcelState; top: number; broke: boolean }) {
  const clip = 'cv' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const hatch = clip + 'h';
  const n = idx(a, Z_MAX) + 1;
  const zs = a.z.slice(0, n);
  const envX = zs.map((z, i) => sx(a.env[i], z));
  const parX = zs.map((z, i) => sx(a.parcel[i], z));
  const ys = zs.map(Y);
  const lclI = Math.min(n - 1, idx(a, a.lclKm) + 1);
  const dryPath = linePath(parX.slice(0, lclI + 1), ys.slice(0, lclI + 1));
  const moistPath = lclI < n - 1 ? linePath(parX.slice(lclI), ys.slice(lclI)) : '';

  // Gold: positive area from the LFC to the EL. Hatched orange: negative area beneath the LFC.
  let capePath = '';
  let cinPath = '';
  if (a.lfcKm !== null && a.elKm !== null && a.cape > 0.5) {
    const i0 = idx(a, a.lfcKm);
    const i1 = Math.min(n - 1, idx(a, a.elKm));
    if (i1 > i0) {
      const fwd = parX.slice(i0, i1 + 1).map((x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${ys[i0 + k].toFixed(1)}`).join(' ');
      const back = envX
        .slice(i0, i1 + 1)
        .map((x, k) => [x, ys[i0 + k]] as const)
        .reverse()
        .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ');
      capePath = `${fwd} ${back} Z`;
    }
    if (a.cin > 0.5) {
      const iL = Math.min(n - 1, i0);
      const lo = zs.slice(0, iL + 1).map((z, i) => sx(Math.min(a.parcel[i], a.env[i]), z));
      const fwd = envX.slice(0, iL + 1).map((x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${ys[k].toFixed(1)}`).join(' ');
      const back = lo
        .map((x, k) => [x, ys[k]] as const)
        .reverse()
        .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ');
      cinPath = `${fwd} ${back} Z`;
    }
  }

  const marks = spread(
    [
      { key: 'lcl', y: Y(Math.min(a.lclKm, Z_MAX)), z: a.lclKm, text: 'cloud base', color: TEXT.teal },
      ...(a.lfcKm !== null ? [{ key: 'lfc', y: Y(a.lfcKm), z: a.lfcKm, text: 'free convection', color: TEXT.gold }] : []),
      ...(a.elKm !== null ? [{ key: 'el', y: Y(Math.min(a.elKm, Z_MAX)), z: a.elKm, text: broke ? 'cloud top' : 'top if released', color: TEXT.gold }] : []),
    ],
    26,
  );

  const zk = Math.min(Z_MAX, sim.z / 1000);
  const dotX = sx(parcelAt(a, zk), zk);
  const dotY = Y(zk);
  const topKm = top / 1000;
  const cloudy = topKm > a.lclKm + 0.05;
  const anvil = a.elKm !== null && topKm > a.elKm - 0.2;
  const capTop = CAP_LAYER.baseKm + CAP_LAYER.depthKm;

  return (
    <svg
      className="chart"
      viewBox="0 0 640 384"
      role="img"
      aria-label={`Temperature against height over Marlow on a summer afternoon at ${fmt(st.surfaceC, 1)} °C, with a dew point of ${fmt(Math.min(st.dewC, st.surfaceC), 1)} °C, air aloft cooling ${fmt(st.lapse, 1)} °C per km and a cap ${fmt(st.cap, 1)} °C strong. Cloud base ${fmt(a.lclKm, 1)} km; ${a.lfcKm !== null ? `level of free convection ${fmt(a.lfcKm, 1)} km, cloud top ${broke ? '' : 'if the cap were broken '}${fmt(a.elKm ?? 0, 1)} km` : 'no level of free convection'}; CAPE ${fmt(a.cape)} J/kg, CIN ${fmt(a.cin)} J/kg. A thermal is at ${fmt(sim.z / 1000, 1)} km, moving ${fmt(Math.abs(sim.w))} m/s ${sim.w >= 0 ? 'up' : 'down'}.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={PX0} y={Y(Z_MAX)} width={PX1 - PX0} height={Y(0) - Y(Z_MAX)} />
        </clipPath>
        <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6} height={6} fill={CIN_FILL} opacity={0.12} />
          <line x1={0} y1={0} x2={0} y2={6} stroke={CIN_FILL} strokeWidth={2} opacity={0.6} />
        </pattern>
      </defs>
      <text className="ax" x={PX0} y={10}>
        Height
      </text>
      <GridY y={Y} ticks={[0, 2, 4, 6, 8, 10, 12, 14]} x0={PX0} x1={PX1} format={(v) => `${v} km`} baseline={0} />
      <g clipPath={`url(#${clip})`}>
        {/* Lines of equal temperature lean to the right. */}
        {Array.from({ length: 17 }, (_, k) => -100 + k * 10).map((t) => (
          <line key={t} x1={sx(t, 0)} y1={Y(0)} x2={sx(t, Z_MAX)} y2={Y(Z_MAX)} stroke="#e6e3dc" strokeWidth={1} />
        ))}
        {st.cap > 0 && <rect x={PX0} y={Y(capTop)} width={PX1 - PX0} height={Y(CAP_LAYER.baseKm) - Y(capTop)} fill="#8a8a8a" opacity={0.1} />}
        {cloudy && (
          <g opacity={0.9}>
            <rect x={452} y={Y(Math.min(topKm, Z_MAX))} width={56} height={Math.max(4, Y(a.lclKm) - Y(Math.min(topKm, Z_MAX)))} rx={14} fill="#e9ecef" stroke="#cfd4da" />
            {anvil && <rect x={420} y={Y(Math.min(a.elKm! + 0.4, Z_MAX))} width={104} height={14} rx={7} fill="#e9ecef" stroke="#cfd4da" />}
          </g>
        )}
        {cinPath && <path d={cinPath} fill={`url(#${hatch})`} />}
        {capePath && <path d={capePath} fill={GRAPHIC.gold} opacity={0.35} />}
        <path d={linePath(envX, ys)} fill="none" stroke={GRAPHIC.red} strokeWidth={3} strokeLinejoin="round" />
        <path d={dryPath} fill="none" stroke={PARCEL_DRY} strokeWidth={2} strokeDasharray="6 4" />
        {moistPath && <path d={moistPath} fill="none" stroke={PARCEL_MOIST} strokeWidth={2.5} />}
        <circle cx={dotX} cy={dotY} r={6.5} fill="#333" stroke="#fcfcfb" strokeWidth={2} />
      </g>
      {st.cap > 0 && (
        <text className="ax" x={PX0 + 6} y={Y(capTop) - 4}>
          cap
        </text>
      )}
      {cloudy && (
        <text className="ax ax-m" x={480} y={Y(a.lclKm) + 14}>
          cloud
        </text>
      )}
      <text x={Math.min(PX1 - 4, dotX + 12)} y={dotY + 4} textAnchor={dotX + 12 > PX1 - 70 ? 'end' : 'start'} style={{ fontSize: 12, fontWeight: 600, fill: '#333' }}>
        {fmt(Math.abs(sim.w))} m/s {sim.w >= 0 ? '↑' : '↓'}
      </text>
      {marks.map((m) => (
        <g key={m.key}>
          <line x1={PX1} x2={PX1 + 6} y1={Y(Math.min(m.z, Z_MAX))} y2={Y(Math.min(m.z, Z_MAX))} stroke={m.color} strokeWidth={1.5} />
          <text x={PX1 + 9} y={m.y - 1} style={{ fontSize: 11, fill: m.color, fontWeight: 500 }}>
            {m.text}
          </text>
          <text x={PX1 + 9} y={m.y + 11} style={{ fontSize: 11, fill: m.color }}>
            {fmt(m.z, 1)} km
          </text>
        </g>
      ))}
      {[0, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={X(t)} y={370}>
          {t}°
        </text>
      ))}
      <text className="ax ax-e" x={PX1} y={383}>
        temperature, °C · lines of equal temperature lean right
      </text>
    </svg>
  );
}

// The displaced-parcel chart.
const DT0 = 110;
const DT1 = 620;
const T_WINDOW_MIN = 40;
const TX = scale(0, T_WINDOW_MIN, DT0, DT1);
const DZ = scale(-1.25, 1.25, 206, 26);

function DisplacedChart({ lapse, lift, tS }: { lapse: number; lift: number; tS: number }) {
  const bv = bruntVaisala(LAYER_C, lapse);
  const clip = 'dp' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const pts: Array<[number, number]> = [];
  const end = Math.min(tS, T_WINDOW_MIN * 60);
  for (let t = 0; t <= end + 1e-9; t += 10) {
    const z = displacedParcel(bv.n2, lift, t) / 1000;
    pts.push([TX(t / 60), DZ(Math.max(-1.3, Math.min(1.3, z)))]);
    if (Math.abs(z) > 1.3) break;
  }
  const zNow = displacedParcel(bv.n2, lift, end) / 1000;
  const shown = Math.max(-1.25, Math.min(1.25, zNow));
  const period = bv.periodS;
  const label =
    period !== null
      ? `A dry parcel nudged ${fmt(lift)} m up in a layer cooling ${fmt(lapse, 1)} °C per km oscillates about its starting level every ${fmt(period / 60, 1)} minutes.`
      : bv.growthS !== null
        ? `A dry parcel nudged ${fmt(lift)} m up in a layer cooling ${fmt(lapse, 1)} °C per km, faster than the dry rate, keeps rising, its height growing e-fold every ${fmt(bv.growthS / 60, 1)} minutes.`
        : `A dry parcel nudged ${fmt(lift)} m up in a neutral layer stays where it is put.`;
  return (
    <svg className="chart" viewBox="0 0 640 236" role="img" aria-label={label}>
      <defs>
        <clipPath id={clip}>
          <rect x={DT0} y={DZ(1.25)} width={DT1 - DT0} height={DZ(-1.25) - DZ(1.25)} />
        </clipPath>
      </defs>
      <text className="ax" x={DT0} y={12}>
        Height above its starting level
      </text>
      <GridY y={DZ} ticks={[-1, -0.5, 0, 0.5, 1]} x0={DT0} x1={DT1} format={(v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v) * 1000)} m`)} baseline={0} />
      {/* The parcel itself, bobbing in a column at the left. */}
      <rect x={12} y={DZ(1.25)} width={20} height={DZ(-1.25) - DZ(1.25)} rx={4} fill={tint(GRAPHIC.blue, 0.12)} />
      <circle cx={22} cy={DZ(shown)} r={7} fill={GRAPHIC.red} opacity={Math.abs(zNow) > 1.25 ? 0.3 : 0.9} />
      <g clipPath={`url(#${clip})`}>
        <path d={linePath(pts.map((p) => p[0]), pts.map((p) => p[1]))} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} strokeLinejoin="round" />
        {Math.abs(zNow) <= 1.25 && <circle cx={TX(end / 60)} cy={DZ(shown)} r={5} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={2} />}
      </g>
      {[0, 10, 20, 30, 40].map((m) => (
        <text key={m} className="ax ax-m" x={TX(m)} y={224}>
          {m} min
        </text>
      ))}
    </svg>
  );
}

const SPEED = 150; // simulated seconds per second of animation
const SPEED2 = 120;

interface Sim extends ParcelState {
  top: number;
  hold: number;
}

const fresh = (): Sim => ({ t: 0, z: 0, w: THERMAL_W0, top: 0, hold: 0 });

export default function Lesson() {
  const s = useScenario('sounding', CONVECTION_DEFAULTS);
  const st = s.state;
  const dew = Math.min(st.dewC, st.surfaceC);
  const a = useMemo(() => convectionAscent(st), [st]);
  const top = useMemo(() => thermalTopM(st), [st]);
  const solved = useMemo(() => capSolved(st), [st]);
  const broke = top > (CAP_LAYER.baseKm + CAP_LAYER.depthKm + 1) * 1000;
  const lclI = idx(a, a.lclKm);
  const moistAtBase = moistLapseRate(a.parcel[lclI], a.p[lclI]);
  const cls = stabilityClass(st.lapse, moistAtBase);
  const mlTop = mixedLayerTopKm(morningSounding(st.lapse, st.cap), st.surfaceC);

  // The thermal: launched from the ground, relaunched after it settles or sinks back.
  const play = usePlay(true);
  const [sim, setSim] = useState<Sim>(fresh);
  const ascentRef = useRef(a);
  ascentRef.current = a;
  useEffect(() => setSim(fresh()), [a]);
  useAnimationFrame((dt) => {
    setSim((x) => {
      if (x.hold > 0) return x.hold - dt > 0 ? { ...x, hold: x.hold - dt } : fresh();
      const nx = stepParcel(ascentRef.current, x, dt * SPEED, DRAG);
      const done = nx.t > 1500 || (nx.z <= 0 && nx.t > 20);
      return { ...nx, top: Math.max(x.top, nx.z), hold: done ? 1.5 : 0 };
    });
  }, play.playing);

  // Figure 2.
  const d = useScenario('displaced', { lapse: 6.5, lift: 300 });
  const { lapse, lift } = d.state;
  const bv = bruntVaisala(LAYER_C, lapse);
  const n2Text = `${bv.n2 < 0 ? '−' : ''}${fmt(Math.abs(bv.n2) * 1e4, 2)}`;
  const play2 = usePlay(true);
  const [t2, setT2] = useState(0);
  useEffect(() => setT2(0), [lapse, lift]);
  const restart = useMemo(() => restartAt(lapse, lift), [lapse, lift]);
  useAnimationFrame((dt) => setT2((t) => (t + dt * SPEED2 > restart ? 0 : t + dt * SPEED2)), play2.playing);
  const solved2 = periodSolved(lapse);
  const period = oscillationPeriodMin(lapse);
  const standardPeriod = oscillationPeriodMin(6.5)!;

  const thermalWord = broke
    ? `A thermal punches through the cap and climbs to about ${fmt(top / 1000, 1)} km.`
    : a.lfcKm !== null
      ? `Thermals rise to about ${fmt(top / 1000, 1)} km and sink back: the cap holds.`
      : 'No layer aloft is cool enough for the parcel to float in: thermals can’t grow into storms.';

  return (
    <LessonPage id="weather/1.4">
      <P>
        <a href={lessonHref('weather/1.2')}>Lesson 1.2</a> lifted a dry parcel through the standard atmosphere and found that it came back. It cools by almost
        10 °C for every kilometer it rises, the air around it by only 6.5, so it ends up colder and denser than its surroundings and sinks.{' '}
        <a href={lessonHref('weather/1.3')}>Lesson 1.3</a> added a twist. Once the parcel saturates, its condensing vapor pays back its latent heat,
        and it cools at the moist rate instead, around 4 or 5 °C per kilometer in warm, humid air. So which is it? Does the atmosphere push a rising parcel back
        down, or can a small nudge grow into a thunderstorm?
      </P>
      <P>
        It depends on three rates of cooling with height. Two belong to the parcel: the dry rate, 9.8 °C per km, and the moist rate. The third belongs to the day: the{' '}
        <K tone={WX.temperature}>environmental lapse rate</K>, how fast the surrounding air actually cools with height, which changes from day to day. If the surrounding air cools more slowly than even the moist rate, every lifted parcel ends up colder than its surroundings, and the air is{' '}
        <b>absolutely stable</b>. If it cools faster than the dry rate, every lifted parcel ends up warmer, and the air is <b>absolutely unstable</b> — something
        that happens only in a thin layer over sun-baked ground, because it overturns as fast as it forms. In between, the air is stable for a clear parcel but
        unstable for a cloudy one: <b>conditionally unstable</b>. The standard atmosphere’s 6.5 °C per km sits squarely in that middle range, so whether lifted air
        keeps going depends on how much moisture it carries and how far it’s pushed.
      </P>
      <P>
        Take a summer morning over Marlow, a farm town on the plains 350 km inland from Fenwick Bay. At dawn the ground is at {MORNING_C} °C and the air above cools with height,
        except in a layer between 1.5 and 2 km where it warms instead — an inversion. Meteorologists call a layer like that a <b>cap</b>. As the sun heats the
        ground, rising bubbles of warm air called <b>thermals</b> stir the lowest layer until it cools at the dry rate, up to the height where it meets the morning
        air.
      </P>
      <P>
        The next demonstration plots temperature against height. To make small differences visible it leans, as meteorologists’ own charts do: each kilometer up,
        the temperature scale shifts 6.5 °C, so air cooling at the standard rate draws a vertical line and the faint lines of equal temperature lean to the right.
        The red line is the surrounding air. The dashed gray line is a parcel lifted from the ground at the dry rate, and it turns teal at its cloud base, where it
        saturates and cools at the moist rate. Where the parcel could rise on its own, warmer than its surroundings, the gap is shaded gold, with marks
        at the right for where that free convection begins and the cloud top it would reach; where it’s colder beneath that layer, the gap is hatched orange. Both areas are energies, which the readouts call CAPE and CIN; we’ll come to them once the thermal is moving. The dot is a
        thermal leaving the ground at {THERMAL_W0} m/s, sped up {SPEED} times. Heat the afternoon, and change the moisture, the air aloft and the cap:
      </P>

      <Figure name="Convection Simulator" scenario={s} play={play}>
        <SoundingDiagram a={a} st={st} sim={sim} top={sim.top} broke={broke} />
        <Legend
          items={[
            { label: 'Surrounding air', color: GRAPHIC.red, kind: 'line' },
            { label: 'Parcel, clear', color: PARCEL_DRY, kind: 'line', dashed: true },
            { label: 'Parcel, in cloud', color: PARCEL_MOIST, kind: 'line' },
            { label: 'CAPE', color: tint(GRAPHIC.gold, 0.5) },
            { label: 'CIN', color: CIN_SWATCH },
          ]}
        />
        <Readouts
          items={[
            { label: 'CAPE', value: `${fmt(a.cape)} J/kg`, tone: WX.energy },
            { label: 'CIN', value: `${fmt(a.cin)} J/kg`, tone: WX.density },
          ]}
        />
        <Slider
          label="Afternoon surface temperature"
          tone={WX.temperature}
          value={st.surfaceC}
          min={T_MIN}
          max={T_MAX}
          step={T_STEP}
          onChange={(v) => s.set({ surfaceC: v })}
          display={`${fmt(st.surfaceC, 1)} °C`}
        />
        <Slider
          label="Surface dew point"
          tone={WX.moisture}
          value={st.dewC}
          min={8}
          max={24}
          step={0.5}
          onChange={(v) => s.set({ dewC: v })}
          display={st.dewC > st.surfaceC ? `${fmt(dew, 1)} °C, saturated` : `${fmt(dew, 1)} °C`}
        />
        <Slider label="Lapse rate of the air aloft" value={st.lapse} min={4} max={8} step={0.1} onChange={(v) => s.set({ lapse: v })} display={`${fmt(st.lapse, 1)} °C per km`} />
        <Slider label="Strength of the cap" value={st.cap} min={0} max={6} step={0.5} onChange={(v) => s.set({ cap: v })} display={st.cap > 0 ? `+${fmt(st.cap, 1)} °C` : 'none'} />
        <Caption>
          With the air aloft cooling {fmt(st.lapse, 1)} °C per km, against {fmt(moistAtBase, 1)} for a saturated parcel at the cloud base and{' '}
          {fmt(DRY_LAPSE, 1)} for a clear one, the morning air is {cls}.{' '}
          {mlTop < 0.05 ? 'The ground hasn’t warmed yet.' : `The heated, mixed layer reaches ${fmt(mlTop, 1)} km.`} {thermalWord}
        </Caption>
      </Figure>

      <P>
        At the starting {CONVECTION_DEFAULTS.surfaceC} °C, late in the morning, the thermal reaches its cloud base at {fmt(START.lclKm, 1)} km and makes a small
        puff of cloud. In the cloud, warmed by its condensing vapor, the parcel is briefly warmer than the air around it — by up to {fmt(START_LIFT.gapC, 1)} °C,
        at {fmt(START_LIFT.atKm, 1)} km — and that lift carries it into the cap. But inside the cap the surrounding air warms with height, so the parcel soon
        falls behind and is denser than its surroundings. It climbs to about {fmt(START_TOP / 1000, 1)} km, slows, and sinks back. Higher up, from {fmt(START.lfcKm ?? 0, 1)} km, is a gold layer where the parcel would rise on its own. It
        just can’t get there.
      </P>
      <P>
        Here is why the shaded areas are energies. A parcel warmer than its surroundings by ΔT feels an upward push of g·ΔT/T for each kilogram, and adding that push up through
        the gold layer gives the <K tone={WX.energy}>convective available potential energy</K>, or <b>CAPE</b>, in joules per kilogram. The hatched area, where the
        parcel is denser than its surroundings, added the same way, is the <K tone={WX.density}>convective inhibition</K>, or <b>CIN</b>: the energy something must
        supply to lift the parcel to its <b>level of free convection</b>, the bottom of the gold layer. Here the CIN is {fmt(START.cin)} J/kg. The thermal’s own
        motion carries only ½w² = {fmt(0.5 * THERMAL_W0 * THERMAL_W0, 1)} J/kg. And if all the CAPE turned into motion, a parcel would leave the gold layer rising at
        √(2·CAPE), the <b>updraft limit</b>.
      </P>
      <P>
        The two sliders for the morning air show the opening’s classes. Slide the air aloft’s lapse rate down to {STABLE_LAPSE} °C per km, slower than the moist
        rate: the caption calls the air {STABLE_CLASS}, and the gold layer is gone. Raise it to {COOL_LAPSE} and the cooler air aloft holds{' '}
        {fmt(COOL_ALOFT.cape)} J/kg of CAPE behind just {fmt(COOL_ALOFT.cin)} J/kg of CIN; even the morning’s thermal gets through. Set it back to{' '}
        {CONVECTION_DEFAULTS.lapse} and take the cap away, and with no CIN the same {CONVECTION_DEFAULTS.surfaceC} °C morning grows a storm at once. The third
        class, air cooling faster than the dry rate, comes in the last demonstration.
      </P>

      <H2>Breaking the cap</H2>
      <P>
        Now let the afternoon warm up. Each degree of heating warms the parcel all the way up its path, and the hatched area shrinks while the gold one grows. Moisture
        works on the same areas from the other end: a higher dew point lowers the cloud base, so the parcel switches sooner to the slower, moist rate of cooling and
        arrives at the cap warmer.
      </P>

      <Challenge
        id="a"
        question={`Keep the dew point at ${CONVECTION_DEFAULTS.dewC} °C, the air aloft at ${CONVECTION_DEFAULTS.lapse} °C per km and the cap at +${CONVECTION_DEFAULTS.cap} °C. What is the coolest afternoon, to the half degree, at which a thermal breaks through the cap?`}
        solved={solved}
        status={
          !capConditionsKept(st)
            ? `First set the dew point back to ${CONVECTION_DEFAULTS.dewC} °C, the air aloft to ${CONVECTION_DEFAULTS.lapse} °C per km and the cap to +${CONVECTION_DEFAULTS.cap} °C (Reset does all three).`
            : broke
              ? `At ${fmt(st.surfaceC, 1)} °C the thermal breaks through, with ${fmt(a.cin)} J/kg of CIN left. Would a cooler afternoon do?`
              : `At ${fmt(st.surfaceC, 1)} °C the thermal stops at ${fmt(top / 1000, 1)} km, with ${fmt(a.cin)} J/kg of CIN to overcome.`
        }
        success={`Solved. At ${fmt(st.surfaceC, 1)} °C the CIN is down to ${fmt(a.cin, 1)} J/kg, little enough for the thermal’s momentum and the buoyancy it gains in its cloud to carry it through; half a degree cooler, the cap holds. Nothing changes gradually here. All morning nothing happens, and then within half a degree there is a ${fmt(a.cape)} J/kg storm.`}
      />

      <P>
        Push on to 32 °C, a hot afternoon. The CAPE grows to {fmt(AT_32.cape)} J/kg, the thermal rockets through the cap, and its cloud climbs to its{' '}
        <b>equilibrium level</b> at {fmt(AT_32.elKm ?? 0, 1)} km, where the parcel is finally no warmer than its surroundings. That height is the top of the
        thunderstorm. The updraft limit is {fmt(Math.sqrt(2 * AT_32.cape))} m/s, but the thermal in the demonstration peaks near {fmt(PEAK_32)} m/s, because its drag
        stands in for what slows real updrafts: they mix in cooler, drier air from around them and carry the weight of their water. Its momentum still carries it
        past the equilibrium level, to about {fmt(TOP_32 / 1000, 1)} km, before it falls back. On the way it passes {TROPOPAUSE_KM} km, where the red line stops
        cooling with height: the <b>tropopause</b>, the top of the <b>troposphere</b>, the layer that holds nearly all the weather.
        Above it, in the stratosphere, the air is very stable and caps even the strongest storms; the real tropopause sits near that height in the middle
        latitudes. Real storms overshoot too, poking an <b>overshooting top</b> above their flat tops.
      </P>
      <P>
        Moisture matters as much as heat. At 32 °C, a dew point of 14 °C leaves just {fmt(DRY_32.cape)} J/kg of CAPE behind {fmt(DRY_32.cin)} J/kg of CIN, and the
        cap holds; at 20 °C the CAPE is {fmt(WET_32.cape)} J/kg. That is the recipe for a summer afternoon over the plains: moist air near the ground, cooler air
        aloft, and a day’s heating to bring them into contact. It’s why storms over land are most common in the late afternoon and evening, and why a cap that holds
        until late in the day can produce fewer storms but more violent ones, fed by energy that has been building for hours.
      </P>

      <H2>Stable air pushes back</H2>
      <P>
        In stable air, a nudged parcel doesn’t simply return to where it started. It arrives with speed, overshoots, and is pushed back again, so it oscillates up
        and down. The stiffness of that spring is the <b>buoyancy frequency</b>, or Brunt–Väisälä frequency, N, and it depends on how far the surrounding air’s
        lapse rate falls short of the dry rate:
      </P>
      <Eq label="The square of the buoyancy frequency equals g over T times the dry rate minus the environmental lapse rate">
        <span>
          N<Sup>2</Sup>
        </span>
        <Op>=</Op>
        <Frac top="g" bottom={<K tone={WX.temperature}>T</K>} />
        <Op>×</Op>
        <span>
          (Γ<Sub>d</Sub>
        </span>
        <Op>−</Op>
        <span>
          <K tone={WX.temperature}>Γ</K>)
        </span>
      </Eq>
      <P>
        One cycle takes 2π/N seconds. In the next demonstration a dry parcel in a layer at {LAYER_C} °C is nudged upward and let go, and the chart follows its height
        for {T_WINDOW_MIN} minutes, sped up {SPEED2} times. Change the layer’s lapse rate and the size of the nudge:
      </P>

      <Figure name="Convection Simulator · displaced parcel" scenario={d} play={play2}>
        <DisplacedChart lapse={lapse} lift={lift} tS={t2} />
        <Readouts
          items={[
            period !== null
              ? { label: 'one oscillation', value: `${fmt(period, 1)} min`, tone: WX.temperature }
              : { label: bv.growthS !== null ? 'runs away: e-fold every' : 'neutral', value: bv.growthS !== null ? `${fmt(bv.growthS / 60, 1)} min` : '—', tone: WX.temperature },
          ]}
        />
        <Slider label="Lapse rate of the layer" tone={WX.temperature} value={lapse} min={4} max={12} step={0.1} onChange={(v) => d.set({ lapse: v })} display={`${fmt(lapse, 1)} °C per km`} />
        <Slider label="Nudge" value={lift} min={100} max={1000} step={50} onChange={(v) => d.set({ lift: v })} display={`${fmt(lift)} m`} />
        <Eq
          label={`N squared equals ${fmt(G, 2)} over ${fmt(LAYER_C + K0, 0)} kelvins times ${fmt(DRY_LAPSE, 1)} minus ${fmt(lapse, 1)} degrees per 1,000 meters: ${n2Text} times ten to the minus 4 per second squared`}
        >
          <span>
            N<Sup>2</Sup>
          </span>
          <Op>=</Op>
          <Frac top={`${fmt(G, 2)} m/s²`} bottom={<K tone={WX.temperature}>{fmt(LAYER_C + K0)} K</K>} />
          <Op>×</Op>
          <span>({fmt(DRY_LAPSE, 1)}</span>
          <Op>−</Op>
          <span>
            <K tone={WX.temperature}>{fmt(lapse, 1)}</K>) °C per 1,000 m
          </span>
          <Op>=</Op>
          <span>
            {n2Text} × 10<Sup>−4</Sup> s<Sup>−2</Sup>
          </span>
        </Eq>
      </Figure>

      <P>
        At the standard 6.5 °C per km, the parcel bobs once every {fmt(standardPeriod, 1)} minutes, whatever the size of the nudge. In more stable air the spring is
        stiffer: at 4 °C per km a cycle takes {fmt(oscillationPeriodMin(4)!, 1)} minutes. Since N² grows in proportion to the gap between the dry rate and the
        layer’s lapse rate, the period goes as one over the square root of that gap: a gap four times as wide halves it. As the lapse rate approaches the dry rate
        the restoring push fades and the period stretches without limit. Past it — the absolutely unstable air of the lesson’s opening — there is no push back at
        all, and the parcel runs away, its height growing e-fold every {fmt(bruntVaisala(LAYER_C, 11).growthS! / 60, 1)} minutes at 11 °C per km. Stable layers carry these oscillations as waves: wind
        blowing over a ridge sets them going downstream, and where their crests lift the air to saturation, smooth, lens-shaped clouds stay in place while the wind
        blows through them.
      </P>

      <Challenge
        id="b"
        question={`In the standard atmosphere a displaced parcel bobs once every ${fmt(standardPeriod, 1)} minutes. Predict first, from the square-root rule: what lapse rate doubles that, to about 20 minutes? Then set it and check.`}
        solved={solved2}
        status={
          lapse === 6.5
            ? 'Predict first, then set the lapse rate.'
            : period === null
              ? 'This layer isn’t stable at all: the parcel never comes back.'
              : period < PERIOD_TARGET_MIN[0]
                ? 'Too short: this layer is still too stable.'
                : 'Too long: this layer is too close to the dry rate.'
        }
        success={`Solved. Doubling the period takes a gap a quarter as wide: (9.8 − 6.5) ÷ 4 ≈ 0.8 °C per km, or a layer cooling about 9 °C per km. At ${fmt(lapse, 1)} °C per km one oscillation takes ${fmt(period ?? 0, 1)} minutes. Air that cools nearly as fast as the dry rate barely resists being lifted.`}
      />

      <P>
        <FigRef to="Convection Simulator">The first demonstration</FigRef> showed the atmosphere’s vertical machinery: heating from below builds up energy, and
        moisture and stability decide whether it is released. But the heating that drives it is uneven from place to place as well as from hour to hour. A column of
        warm air over the plains is less dense than a column of cool air over the sea, so it stands taller. The next lesson shows how that difference becomes a
        push that moves the air sideways, across a planet that turns beneath it.
      </P>
    </LessonPage>
  );
}

// Numbers the prose quotes, from the same model the figure runs.
const START = convectionAscent(CONVECTION_DEFAULTS);
const START_LIFT = lowCloudLift(START);
const START_TOP = thermalTopM(CONVECTION_DEFAULTS);
const AT_32_STATE = { ...CONVECTION_DEFAULTS, surfaceC: 32 };
const AT_32 = convectionAscent(AT_32_STATE);
const FLIGHT_32 = (() => {
  let s: ParcelState = { t: 0, z: 0, w: THERMAL_W0 };
  let peak = 0;
  let top = 0;
  while (s.t < FLIGHT_S) {
    s = stepParcel(AT_32, s, 5, DRAG);
    peak = Math.max(peak, s.w);
    top = Math.max(top, s.z);
  }
  return { peak, top };
})();
const PEAK_32 = FLIGHT_32.peak;
const TOP_32 = FLIGHT_32.top;
const DRY_32 = convectionAscent({ ...AT_32_STATE, dewC: 14 });
/** The stability prompts: air aloft cooling slower than the moist rate, faster than the standard one, and no cap. */
export const STABLE_LAPSE = 4;
export const COOL_LAPSE = 7.5;
const STABLE_ASCENT = convectionAscent({ ...CONVECTION_DEFAULTS, lapse: STABLE_LAPSE });
const STABLE_CLASS = stabilityClass(STABLE_LAPSE, moistLapseRate(STABLE_ASCENT.parcel[idx(STABLE_ASCENT, STABLE_ASCENT.lclKm)], STABLE_ASCENT.p[idx(STABLE_ASCENT, STABLE_ASCENT.lclKm)]));
const COOL_ALOFT = convectionAscent({ ...CONVECTION_DEFAULTS, lapse: COOL_LAPSE });
const WET_32 = convectionAscent({ ...AT_32_STATE, dewC: 20 });

/** When the displaced-parcel animation starts over, in simulated seconds: two seconds after its trace ends. */
function restartAt(lapse: number, lift: number): number {
  const bv = bruntVaisala(LAYER_C, lapse);
  let end = T_WINDOW_MIN * 60;
  if (bv.n2 < 0) {
    for (let t = 0; t <= end; t += 5) {
      if (Math.abs(displacedParcel(bv.n2, lift, t)) > 1250) {
        end = t;
        break;
      }
    }
  }
  return end + 2 * SPEED2;
}
