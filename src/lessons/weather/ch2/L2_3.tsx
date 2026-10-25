import { useMemo, useState } from 'react';
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
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceTicks,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { STORM_KIND_LABEL, stormOutlook, type StormKind, type StormOutlook } from '../../../engines/weather/storms';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: a summer afternoon over Marlow and its four ingredients.

/** Surface temperature on the demonstration's summer afternoon, °C. */
export const SURFACE_C = 30;

export interface Ingredients {
  /** Surface dew point, °C. */
  dewC: number;
  /** How fast the air aloft cools with height, °C per km. */
  lapse: number;
  /** How far the surface air is pushed up, km. */
  liftKm: number;
  /** Change in wind between the ground and 6 km, m/s. */
  shear: number;
}

export const INGREDIENT_DEFAULTS: Ingredients = { dewC: 20, lapse: 7, liftKm: 1, shear: 5 };
/** The lift slider's step, km. */
export const LIFT_STEP = 0.1;

export function outlookOf(st: Ingredients): StormOutlook {
  return stormOutlook({ surfaceC: SURFACE_C, ...st });
}

/** The dew point slider's step, °C. */
export const DEW_STEP = 0.5;
/** The first challenge's weaker push: how far it lifts the surface air, km. */
export const WEAK_LIFT_KM = 1.8;
/** The data point the challenge's estimate starts from: two degrees drier than the start. */
export const DRIER_DEW_C = 18;

/** Whether the ingredients are the first challenge's: the weaker push, with the starting air aloft. */
export function onWeakLift(st: Ingredients): boolean {
  return st.lapse === INGREDIENT_DEFAULTS.lapse && Math.abs(st.liftKm - WEAK_LIFT_KM) < 1e-6;
}

/**
 * The first challenge: with only 1.8 km of lift and the starting air aloft, the least dew point
 * (on the slider's half-degree steps) that sets off a storm. Each degree of dew point lowers the
 * level of free convection by about 300 m, so it takes 23 °C, which brings it down to 1.75 km.
 */
export function leastDewSolved(st: Ingredients): boolean {
  if (!onWeakLift(st)) return false;
  return outlookOf(st).triggered && !outlookOf({ ...st, dewC: st.dewC - DEW_STEP }).triggered;
}

// ---------------------------------------------------------------------------
// The second demonstration: rain at one spot as storms cross it.

export interface RainState {
  /** Rain rate under the storm's core, mm/h. */
  rate: number;
  /** Width of the rain area along the storm's track, km. */
  width: number;
  /** How fast the storms move, m/s. */
  speed: number;
  /** Storms that follow one another over the same spot. */
  cells: number;
}

/** The starting storm: the first demonstration's single cell, once it's lifted far enough to go. */
export const RAIN_DEFAULTS: RainState = { rate: 48, width: 10, speed: 7.5, cells: 1 };
export const SPEED_STEP = 0.5;
/** The flash-flood challenge: three storms, each raining 48 mm/h over a 10 km rain area, must leave 100 mm. */
export const FLOOD = { rate: 48, width: 10, cells: 3, mm: 100 };

/** How long each storm rains on the spot, hours: its rain area's width divided by its speed. */
export function hoursOverSpot(st: RainState): number {
  return (st.width * 1000) / st.speed / 3600;
}

/** Rain the spot collects as every storm crosses it, mm. */
export function rainAtSpot(st: RainState): number {
  return st.cells * st.rate * hoursOverSpot(st);
}

/** The second challenge: the fastest the three storms can move and still leave 100 mm. */
export function floodSolved(st: RainState): boolean {
  if (st.rate !== FLOOD.rate || st.width !== FLOOD.width || st.cells !== FLOOD.cells) return false;
  return rainAtSpot(st) >= FLOOD.mm - 1e-6 && rainAtSpot({ ...st, speed: st.speed + SPEED_STEP }) < FLOOD.mm - 1e-6;
}

// ---------------------------------------------------------------------------
// Drawing the storm.

const HX = scale(-30, 30, 70, 620);
const HY = scale(0, 15, 330, 24);
const CLOUD = '#e8ebee';
const CLOUD_EDGE = '#c4cbd2';
const RAIN = GRAPHIC.teal;
const LIFT = GRAPHIC.violet;
const UPDRAFT = GRAPHIC.gold;
const STORMY: StormKind[] = ['single', 'multicell', 'supercell', 'sheared'];

const SHORT: Record<StormKind, string> = {
  stable: 'none: too stable',
  capped: 'none: capped',
  single: 'single cell',
  multicell: 'multicell',
  supercell: 'supercell',
  sheared: 'torn apart',
};

/** A cloud tower from `base` to `top` km, leaning `tilt` km to the right at its top. */
function towerPath(x0: number, base: number, top: number, tilt: number, half: number): string {
  const n = 12;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= n; i++) {
    const z = base + ((top - base) * i) / n;
    const c = x0 + (tilt * i) / n;
    // Slight bulges, like the turrets of a growing cumulus.
    const w = half * (0.9 + 0.12 * Math.sin(i * 1.7));
    left.push(`${HX(c - w).toFixed(1)} ${HY(z).toFixed(1)}`);
    right.push(`${HX(c + w).toFixed(1)} ${HY(z).toFixed(1)}`);
  }
  const cx = HX(x0 + tilt);
  const ty = HY(top);
  const r = (HX(half) - HX(0)) * 0.9;
  return `M${left.join(' L')} Q${(cx - r).toFixed(1)} ${(ty - r * 0.9).toFixed(1)} ${cx.toFixed(1)} ${(ty - r * 0.5).toFixed(1)} Q${(cx + r).toFixed(1)} ${(ty - r * 0.9).toFixed(1)} ${right[n]} L${right.slice(0, n).reverse().join(' L')} Z`;
}

/** Slanted streaks of rain under a cloud, from its base to the ground. */
function RainShaft({ x, half, base, rate, slant }: { x: number; half: number; base: number; rate: number; slant: number }) {
  const streaks = [];
  const k = Math.max(4, Math.round(half * 2.2));
  for (let i = 0; i < k; i++) {
    const xi = x - half + ((i + 0.5) * 2 * half) / k;
    streaks.push(
      <line
        key={i}
        x1={HX(xi)}
        y1={HY(base) + 4}
        x2={HX(xi + slant)}
        y2={HY(0) - 2}
        stroke={RAIN}
        strokeWidth={1.4}
        strokeDasharray="7 6"
        opacity={Math.min(0.9, 0.3 + rate / 100)}
      />,
    );
  }
  return (
    <g>
      <rect x={HX(x - half)} y={HY(base)} width={HX(half) - HX(-half)} height={HY(0) - HY(base)} fill={tint(RAIN, 0.08 + Math.min(0.25, rate / 300))} />
      {streaks}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, color, width = 2.5 }: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return null;
  const ux = dx / len;
  const uy = dy / len;
  const h = Math.min(9, len * 0.4);
  const bx = x2 - ux * h;
  const by = y2 - uy * h;
  return (
    <g>
      <line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${bx - uy * h * 0.55},${by + ux * h * 0.55} ${bx + uy * h * 0.55},${by - ux * h * 0.55}`} fill={color} />
    </g>
  );
}

function StormSection({ st, o }: { st: Ingredients; o: StormOutlook }) {
  const storm = STORMY.includes(o.kind);
  const base = o.ascent.lclKm;
  const top = o.topKm ?? base;
  // The updraft leans downshear: about 0.45 km at its top for every m/s of shear.
  const tilt = (o.kind === 'sheared' ? 0.6 : 0.4) * st.shear;
  const towerTop = o.kind === 'sheared' ? base + (top - base) * 0.55 : top;
  const anvil = 6 + 0.5 * st.shear;
  // Where the rain falls: in the updraft itself when the shear is weak, beside it when it's strong.
  const rainX = st.shear < 10 ? 0.5 : Math.min(14, 3 + 0.3 * st.shear);
  const windAt = (z: number) => 5 + (st.shear * Math.min(z, 6)) / 6;
  const lifted = Math.min(st.liftKm, 14);
  const forcedCloud = !storm && st.liftKm > base + 0.05;

  let label: string;
  if (o.kind === 'stable') label = `No storm. The air is too stable: a parcel lifted from the surface ${o.cape > 0 ? `finds only ${fmt(o.cape)} J/kg of CAPE` : 'is colder than its surroundings at every height'}.`;
  else if (o.kind === 'capped') label = `No storm. Surface air lifted ${fmt(st.liftKm, 1)} km falls short of its level of free convection at ${fmt(o.lfcKm ?? 0, 2)} km, and sinks back.`;
  else label = `${STORM_KIND_LABEL[o.kind]}: cloud base ${fmt(base, 1)} km, top ${fmt(top, 1)} km, updraft ${fmt(o.updraftMs)} m/s, rain ${fmt(o.rainRateMmH)} mm an hour.`;

  return (
    <svg
      className="diagram"
      viewBox="0 0 640 364"
      role="img"
      aria-label={`A cross-section of the afternoon sky over Marlow at ${SURFACE_C} °C, with a dew point of ${fmt(st.dewC, 1)} °C, air aloft cooling ${fmt(st.lapse, 1)} °C per km, surface air lifted ${fmt(st.liftKm, 1)} km and ${fmt(st.shear)} m/s of shear between the ground and 6 km. CAPE ${fmt(o.cape)} J/kg. ${label}`}
    >
      <GridY y={HY} ticks={[0, 5, 10, 15]} x0={70} x1={620} format={(v) => `${v} km`} baseline={0} />
      <rect x={70} y={HY(0)} width={550} height={14} fill="#e7e1d3" />
      <text className="ax" x={HX(-29)} y={HY(15) - 8}>
        Wind
      </text>
      {/* The wind profile: faster aloft by the shear. */}
      {[1, 3, 5, 7, 9, 11].map((z) => (
        <Arrow key={z} x1={HX(-29)} y1={HY(z)} x2={HX(-29) + 2.2 * windAt(z)} y2={HY(z)} color={LIFT} width={1.8} />
      ))}

      {/* Reference heights. */}
      <line x1={70} x2={620} y1={HY(base)} y2={HY(base)} stroke={RAIN} strokeWidth={1.1} strokeDasharray="6 4" />
      <text x={616} y={HY(base) + 14} textAnchor="end" style={{ fontSize: 11, fill: TEXT.teal, fontWeight: 500 }}>
        cloud base {fmt(base, 1)} km
      </text>
      {o.lfcKm !== null && o.cape >= 100 && (
        <g>
          <line x1={70} x2={620} y1={HY(o.lfcKm)} y2={HY(o.lfcKm)} stroke={UPDRAFT} strokeWidth={1.1} strokeDasharray="6 4" />
          <text x={616} y={HY(o.lfcKm) - 5} textAnchor="end" style={{ fontSize: 11, fill: TEXT.gold, fontWeight: 500 }}>
            free convection {fmt(o.lfcKm, 2)} km
          </text>
        </g>
      )}

      {storm && (
        <g>
          {/* Rain under the storm. */}
          <RainShaft x={rainX} half={o.kind === 'multicell' ? 6 : 3.5} base={base} rate={o.rainRateMmH} slant={0.15 * st.shear} />
          {o.kind === 'multicell' && (
            <g>
              {/* An older cell decaying downshear and a new one growing upshear. */}
              <path d={towerPath(13, base, top * 0.62, 2, 2.6)} fill={CLOUD} stroke={CLOUD_EDGE} opacity={0.75} />
              <path d={towerPath(-9, base, base + (top - base) * 0.45, tilt * 0.3, 2.4)} fill={CLOUD} stroke={CLOUD_EDGE} />
            </g>
          )}
          {o.kind !== 'sheared' && (
            <rect x={HX(tilt - 4)} y={HY(top + 0.5)} width={HX(anvil + 4) - HX(0)} height={HY(top - 1.1) - HY(top + 0.5)} rx={10} fill={CLOUD} stroke={CLOUD_EDGE} />
          )}
          <path d={towerPath(0, base, towerTop, tilt, o.kind === 'supercell' ? 4.6 : 4)} fill={CLOUD} stroke={CLOUD_EDGE} />
          {o.kind === 'supercell' && (
            <g>
              {/* The rotating updraft and its overshooting top. */}
              <ellipse cx={HX(tilt * 0.45)} cy={HY(base + (top - base) * 0.35)} rx={26} ry={8} fill="none" stroke={LIFT} strokeWidth={1.8} strokeDasharray="5 4" />
              <path d={`M${HX(tilt * 0.45) + 24} ${HY(base + (top - base) * 0.35) - 4} l7 2 l-6 4`} fill="none" stroke={LIFT} strokeWidth={1.8} />
              <ellipse cx={HX(tilt)} cy={HY(top + 0.6)} rx={16} ry={9} fill={CLOUD} stroke={CLOUD_EDGE} />
            </g>
          )}
          <Arrow x1={HX(0.4)} y1={HY(Math.min(lifted, base))} x2={HX(tilt * 0.92)} y2={HY(towerTop - 0.9)} color={UPDRAFT} width={3.5} />
          {o.kind !== 'sheared' && (
            <text x={HX(tilt) + 6} y={HY(top + 0.5) - 6} style={{ fontSize: 11, fill: '#555', fontWeight: 500 }}>
              top {fmt(top, 1)} km
            </text>
          )}
        </g>
      )}
      {forcedCloud && (
        <rect
          x={HX(-6)}
          y={HY(Math.min(st.liftKm, base + 1.2))}
          width={HX(6) - HX(-6)}
          height={HY(base) - HY(Math.min(st.liftKm, base + 1.2))}
          rx={8}
          fill={CLOUD}
          stroke={CLOUD_EDGE}
        />
      )}

      {/* The lift: how far the surface air is pushed up. */}
      <Arrow x1={HX(-3)} y1={HY(0) - 2} x2={HX(-3)} y2={HY(Math.max(0.15, lifted))} color={LIFT} width={3} />
      <text x={HX(-3) - 8} y={HY(Math.max(0.15, lifted) / 2) + 4} textAnchor="end" style={{ fontSize: 11, fill: TEXT.violet, fontWeight: 600 }}>
        lift {fmt(st.liftKm, 1)} km
      </text>
      <text x={HX(0)} y={358} textAnchor="middle" className="ax">
        {storm ? '' : o.kind === 'capped' ? 'capped: the lifted air sinks back' : 'clear: the air is too stable'}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Drawing rain at a spot.

function rainTimeline(st: RainState) {
  const kmh = st.speed * 3.6;
  const spacing = 1.5 * st.width;
  const spans = Array.from({ length: st.cells }, (_, i) => ({ from: (i * spacing) / kmh, to: (i * spacing + st.width) / kmh }));
  const end = spans[spans.length - 1].to;
  const accum = (t: number) => st.rate * spans.reduce((s, sp) => s + Math.max(0, Math.min(t, sp.to) - sp.from), 0);
  return { kmh, spacing, spans, end, accum };
}

function SpotChart({ st, frac }: { st: RainState; frac: number }) {
  const tl = rainTimeline(st);
  const total = rainAtSpot(st);
  const t0 = -0.12 * tl.end;
  const t1 = 1.08 * tl.end;
  const t = t0 + (t1 - t0) * frac;
  // Map strip: storms moving left to right past the gauge.
  const half = Math.max(30, 1.6 * st.width);
  const MX = scale(-half, half, 40, 620);
  const gauge = MX(0);
  const cells = tl.spans.map((_, i) => -st.width / 2 - i * tl.spacing + tl.kmh * t);
  // Accumulation chart.
  const yMax = Math.max(40, Math.ceil((total * 1.1) / 20) * 20);
  const CX = scale(t0, t1, 64, 620);
  const CY = scale(0, yMax, 290, 160);
  const pts: number[] = [t0, 0];
  for (const sp of tl.spans) pts.push(sp.from, sp.to);
  pts.push(t1);
  const ts = [...new Set(pts)].sort((a, b) => a - b);
  const full = linePath(ts.map(CX), ts.map((x) => CY(tl.accum(x))));
  const shown = [...ts.filter((x) => x < t), t];
  const now = linePath(shown.map(CX), shown.map((x) => CY(tl.accum(x))));
  // Label the time axis in minutes for short passages, hours for long ones.
  const inMinutes = tl.end < 2;
  const hTicks = inMinutes ? niceTicks(0, tl.end * 60, 5).map((m) => m / 60) : niceTicks(0, tl.end, 5);
  const raining = cells.some((c) => Math.abs(c) <= st.width / 2);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 316"
      role="img"
      aria-label={`${st.cells} storm${st.cells > 1 ? 's' : ''}, each raining ${fmt(st.rate)} mm an hour over a rain area ${fmt(st.width)} km wide and moving at ${fmt(st.speed, 1)} m/s, cross a rain gauge. Each rains on it for ${fmt(hoursOverSpot(st) * 60)} minutes, and the gauge collects ${fmt(total, 1)} mm in all.`}
    >
      <text className="ax" x={40} y={14}>
        Seen from above · storms move with the wind →
      </text>
      <rect x={40} y={26} width={580} height={86} fill="#f2f0e9" />
      {cells.map((c, i) =>
        Math.abs(c) - st.width / 2 > half ? null : (
          <g key={i}>
            <rect
              x={Math.max(40, MX(c - st.width / 2))}
              y={40}
              width={Math.max(0, Math.min(620, MX(c + st.width / 2)) - Math.max(40, MX(c - st.width / 2)))}
              height={58}
              rx={12}
              fill={tint(RAIN, 0.2 + Math.min(0.55, st.rate / 160))}
              stroke={RAIN}
              strokeWidth={1}
            />
          </g>
        ),
      )}
      <line x1={gauge} x2={gauge} y1={30} y2={108} stroke="#333" strokeWidth={1} strokeDasharray="3 3" />
      <rect x={gauge - 5} y={62} width={10} height={16} rx={2} fill={raining ? GRAPHIC.teal : '#fff'} stroke="#333" strokeWidth={1.5} />
      <text x={gauge + 9} y={122} className="ax">
        rain gauge
      </text>
      <line x1={MX(-half) + 4} x2={MX(-half + 10) + 4} y1={106} y2={106} stroke="#777" strokeWidth={1.5} />
      <text x={MX(-half + 10) + 10} y={110} className="ax">
        10 km
      </text>

      <text className="ax" x={64} y={150}>
        Rain collected at the gauge
      </text>
      <GridY y={CY} ticks={niceTicks(0, yMax, 4)} x0={64} x1={620} format={(v) => `${fmt(v)} mm`} baseline={0} />
      {yMax >= FLOOD.mm && (
        <g>
          <line x1={64} x2={620} y1={CY(FLOOD.mm)} y2={CY(FLOOD.mm)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="6 4" />
          <text x={616} y={CY(FLOOD.mm) - 5} textAnchor="end" style={{ fontSize: 11, fill: TEXT.red }}>
            100 mm
          </text>
        </g>
      )}
      <path d={full} fill="none" stroke={RAIN} strokeWidth={1.5} opacity={0.3} />
      <path d={now} fill="none" stroke={RAIN} strokeWidth={3} strokeLinejoin="round" />
      <line className="cur" x1={CX(t)} x2={CX(t)} y1={160} y2={290} />
      {hTicks
        .filter((h) => h <= t1)
        .map((h) => (
          <text key={h} className="ax ax-m" x={CX(h)} y={306}>
            {inMinutes ? `${fmt(h * 60)} min` : `${fmt(h)} h`}
          </text>
        ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, from the same model the figures run.

/** The lift that sets the starting afternoon's storm off, km: just past its level of free convection. */
export const STORM_LIFT_KM = 2.7;
const START = outlookOf(INGREDIENT_DEFAULTS);
const GO = outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: STORM_LIFT_KM });
const DRIER = outlookOf({ ...INGREDIENT_DEFAULTS, dewC: DRIER_DEW_C, liftKm: STORM_LIFT_KM });
const GENTLER = outlookOf({ ...INGREDIENT_DEFAULTS, lapse: 6.5, liftKm: STORM_LIFT_KM });
const MULTI = outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: STORM_LIFT_KM, shear: 15 });
const SUPER = outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: STORM_LIFT_KM, shear: 25 });
const TORN = outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: STORM_LIFT_KM, shear: 40 });
const SUPER_U = 0.55 * 25;

const PLAY_SECONDS = 7;

export default function Lesson() {
  const s = useScenario('ingredients', INGREDIENT_DEFAULTS);
  const st = s.state;
  const o = useMemo(() => outlookOf(st), [st]);
  const solved = useMemo(() => leastDewSolved(st), [st]);
  const storm = STORMY.includes(o.kind);
  const u = 0.55 * st.shear;

  const r = useScenario('spot', RAIN_DEFAULTS);
  const rs = r.state;
  const total = rainAtSpot(rs);
  const solved2 = floodSolved(rs);
  const play = usePlay(true);
  const [frac, setFrac] = useState(0);
  useAnimationFrame((dt) => setFrac((f) => (f >= 1.15 ? 0 : f + dt / PLAY_SECONDS)), play.playing);
  const setRain = (patch: Partial<RainState>) => {
    r.set(patch);
    setFrac(0);
  };

  let caption: string;
  if (o.kind === 'stable') caption = `With these ingredients the lifted air is never warmer than its surroundings for long: ${fmt(o.cape)} J/kg of CAPE is too little to grow a storm.`;
  else if (o.kind === 'capped')
    caption = `There are ${fmt(o.cape)} J/kg of CAPE waiting, but the lift stops ${fmt((o.lfcKm ?? 0) - st.liftKm, 2)} km short of the level of free convection, where the air would start to rise on its own.`;
  else if (o.kind === 'single') caption = 'Little shear: the rain falls back down through the updraft that made it, and the storm chokes itself within the hour.';
  else if (o.kind === 'multicell') caption = 'Moderate shear: the rain falls beside the updraft, and the outflow of each dying cell lifts the air that feeds the next.';
  else if (o.kind === 'supercell') caption = 'Strong shear and enough CAPE: one rotating updraft, kept apart from its downdraft, can last for hours.';
  else caption = 'More shear than the CAPE can stand: the young updraft is blown over and torn apart before it can organize.';

  return (
    <LessonPage id="weather/2.3">
      <P>
        The fronts of <a href={lessonHref('weather/2.2')}>the previous lesson</a> lift warm air slowly, along a surface that rises a kilometer for every 50 or 150
        kilometers of ground, and they make wide bands of steady rain. On a summer afternoon over the plains around Marlow, lifting can set off something far more
        violent. <a href={lessonHref('weather/1.4')}>Lesson 1.4</a> showed where its energy comes from. Surface air that is lifted past its{' '}
        <b>level of free convection</b> becomes warmer than the air around it and rises on its own, accelerated by the <K tone={WX.energy}>CAPE</K>, the convective
        available potential energy, of the layer above. Below that level it is colder than its surroundings and has to be pushed through the <b>CIN</b>, the
        convective inhibition.
      </P>
      <P>
        A <b>sounding</b> — the profile of temperature and humidity with height that a weather balloon measures on its way up — can be full of CAPE while the
        sky stays clear all afternoon, so forecasters reason about thunderstorms by their ingredients. A storm needs{' '}
        <K tone={WX.moisture}>moisture</K>, because condensing vapor is what keeps rising air warm; <b>instability</b>, air aloft that cools quickly enough with
        height for a cloudy parcel to stay warmer than it; and <K tone={WX.wind}>lift</K>, something to push surface air up to the level of free convection — a
        front, a range of hills, a sea breeze, or the cold outflow of an earlier storm. A fourth ingredient decides what kind of storm grows: the{' '}
        <K tone={WX.wind}>wind shear</K>, how much the wind changes between the ground and 6 km up.
      </P>
      <P>
        In the next demonstration it’s a {SURFACE_C} °C afternoon at Marlow. The cross-section is 60 km wide and 15 km high; the violet arrows on the left are the
        wind at each height, and the violet arrow in the middle is how far the surface air is lifted. Change the four ingredients:
      </P>

      <Figure name="Storm Formation Simulator" scenario={s}>
        <StormSection st={st} o={o} />
        <Legend
          items={[
            { label: 'Lift and wind', color: LIFT },
            { label: 'Updraft', color: UPDRAFT },
            { label: 'Rain', color: RAIN },
            { label: 'Cloud base', color: RAIN, kind: 'line', dashed: true },
            { label: 'Level of free convection', color: UPDRAFT, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'CAPE', value: `${fmt(o.cape)} J/kg`, tone: WX.energy },
            { label: 'storm', value: SHORT[o.kind] },
            { label: 'updraft', value: storm ? `${fmt(o.updraftMs)} m/s` : '—', tone: WX.wind },
            { label: 'rain rate', value: storm ? `${fmt(o.rainRateMmH)} mm/h` : '—', tone: WX.moisture },
          ]}
        />
        <Slider label="Moisture: dew point" tone={WX.moisture} value={st.dewC} min={10} max={24} step={DEW_STEP} onChange={(v) => s.set({ dewC: v })} display={`${fmt(st.dewC, 1)} °C`} />
        <Slider label="Instability: air aloft cools" tone={WX.temperature} value={st.lapse} min={5.5} max={8} step={0.1} onChange={(v) => s.set({ lapse: v })} display={`${fmt(st.lapse, 1)} °C per km`} />
        <Slider label="Lift" tone={WX.wind} value={st.liftKm} min={0} max={4} step={LIFT_STEP} onChange={(v) => s.set({ liftKm: v })} display={`${fmt(st.liftKm, 1)} km`} />
        <Slider label="Shear, ground to 6 km" tone={WX.wind} value={st.shear} min={0} max={40} onChange={(v) => s.set({ shear: v })} display={`${fmt(st.shear)} m/s`} />
        {storm && st.shear > 0 && (
          <Eq label={`Bulk Richardson number: CAPE ${fmt(o.cape)} joules per kilogram divided by one half of ${fmt(u, 1)} meters per second squared equals ${fmt(o.brn, 1)}`}>
            <span>BRN</span>
            <Op>=</Op>
            <Frac top={<K tone={WX.energy}>CAPE</K>} bottom={<>½ U<Sup>2</Sup></>} />
            <Op>=</Op>
            <Frac top={<K tone={WX.energy}>{fmt(o.cape)} J/kg</K>} bottom={<>½ × ({fmt(u, 1)} m/s)<Sup>2</Sup></>} />
            <Op>=</Op>
            <span>{fmt(o.brn, 1)}</span>
          </Eq>
        )}
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Two of the ingredients are already here. With a dew point of {INGREDIENT_DEFAULTS.dewC} °C and air aloft cooling {INGREDIENT_DEFAULTS.lapse} °C for every
        kilometer, a surface parcel has {fmt(START.cape)} J/kg of CAPE above it — plenty for a strong storm. But the lift is only {fmt(INGREDIENT_DEFAULTS.liftKm, 1)}{' '}
        km. Lifted that far, the air doesn’t even reach its cloud base at {fmt(START.ascent.lclKm, 1)} km. It is colder than its surroundings, and when the push
        stops, it sinks back. Its level of free convection is at {fmt(START.lfcKm ?? 0, 2)} km, and the {fmt(START.cin)} J/kg of CIN beneath it is the lid. Raise
        the lift to {fmt(STORM_LIFT_KM, 1)} km and the air gets past it. From there the storm runs on its own energy: the cloud shoots up to{' '}
        {fmt(GO.topKm ?? 0, 1)} km in an updraft of {fmt(GO.updraftMs)} m/s. Nothing changes gradually here — 100 meters less and no storm forms at all.
      </P>
      <P>
        Moisture works on both sides of the ledger. Moister air reaches its cloud base sooner and switches sooner to the slower, moist rate of cooling, so it is
        warmer at every height above: it has more CAPE, and its level of free convection is lower. Drop the dew point to {DRIER_DEW_C} °C, keeping a lift of {fmt(STORM_LIFT_KM, 1)}
        km, and the CAPE falls to {fmt(DRIER.cape)} J/kg while the level of free convection rises to {fmt(DRIER.lfcKm ?? 0, 2)} km, out of reach. Instability works
        the same way: air aloft cooling 6.5 °C per km instead of 7 leaves {fmt(GENTLER.cape)} J/kg and moves free convection up to{' '}
        {fmt(GENTLER.lfcKm ?? 0, 2)} km. That is why the humid, sticky days of a plains summer are the stormy ones.
      </P>

      <Challenge
        id="a"
        question={`Suppose a weaker push, one that lifts the surface air only ${fmt(WEAK_LIFT_KM, 1)} km, with the air aloft still cooling ${INGREDIENT_DEFAULTS.lapse} °C per km. Estimate first: two degrees less dew point raised the level of free convection from ${fmt(START.lfcKm ?? 0, 2)} to ${fmt(DRIER.lfcKm ?? 0, 2)} km. How much moister than ${INGREDIENT_DEFAULTS.dewC} °C must the air be for ${fmt(WEAK_LIFT_KM, 1)} km of lift to set off a storm? Then set the lift to ${fmt(WEAK_LIFT_KM, 1)} km and find the least dew point, in half-degree steps, that does it.`}
        solved={solved}
        status={
          !onWeakLift(st)
            ? `Set the lift to ${fmt(WEAK_LIFT_KM, 1)} km and the air aloft to ${INGREDIENT_DEFAULTS.lapse} °C per km.`
            : o.triggered
              ? `A dew point of ${fmt(st.dewC, 1)} °C sets off a storm. Would drier air do?`
              : o.lfcKm === null || o.cape < 100
                ? `At a dew point of ${fmt(st.dewC, 1)} °C the air is too stable to grow a storm.`
                : `At a dew point of ${fmt(st.dewC, 1)} °C the level of free convection is at ${fmt(o.lfcKm, 2)} km, ${fmt(o.lfcKm - st.liftKm, 2)} km above the lift.`
        }
        success={`Solved. At ${fmt(st.dewC, 1)} °C the level of free convection is down to ${fmt(o.lfcKm ?? 0, 2)} km, within reach of the ${fmt(WEAK_LIFT_KM, 1)} km push; half a degree drier, it sits at ${fmt(outlookOf({ ...st, dewC: st.dewC - DEW_STEP }).lfcKm ?? 0, 2)} km. From ${INGREDIENT_DEFAULTS.dewC} °C that is ${fmt(st.dewC - INGREDIENT_DEFAULTS.dewC, (st.dewC - INGREDIENT_DEFAULTS.dewC) % 1 ? 1 : 0)} degrees for ${fmt((START.lfcKm ?? 0) - (o.lfcKm ?? 0), 2)} km, close to the estimate of about a third of a kilometer per degree. The moister afternoon also has ${fmt(o.cape / START.cape, 1)} times the CAPE.`}
      />

      <H2>What the shear does</H2>
      <P>
        Once a storm goes, the shear shapes it. Set the dew point back to {INGREDIENT_DEFAULTS.dewC} °C and the lift to {fmt(STORM_LIFT_KM, 1)} km, so the starting afternoon has its
        storm. With little shear, as at the start, it is a <b>single cell</b>. Its updraft carries vapor up, the vapor
        condenses into rain, and the rain falls straight back down through the updraft that made it. The falling rain drags air down with it and cools it by
        evaporating, and that cold downdraft spreads out along the ground and cuts off the warm, moist air feeding the storm. A single cell usually rains itself
        out in 30 minutes to an hour.
      </P>
      <P>
        Raise the shear past 10 m/s. The wind aloft now carries the top of the updraft downwind, so the rain falls beside it instead of into it. The cold outflow
        still spreads along the ground, but now its leading edge, the <b>gust front</b>, lifts fresh warm air on the storm’s flank, and a new cell grows there as
        the old one dies. That is a <b>multicell cluster</b>, a family of storms that can keep going for hours. Past about 20 m/s, if there’s enough CAPE, the
        updraft itself can begin to rotate. The result is a <b>supercell</b>: a single, long-lived storm whose rotating updraft stays separate from its downdraft.
        Supercells are rare, but they bring most of the largest hail and the strongest tornadoes. With too much shear for the CAPE, though, a young updraft is
        blown over before it can organize: at 40 m/s the storm here is torn apart.
      </P>
      <P>
        Forecasters weigh the two against each other with the <b>bulk Richardson number</b>, the CAPE divided by half the square of a shear speed U (in this
        model, 0.55 times the change in wind from the ground to 6 km). At 25 m/s of shear, U is {fmt(SUPER_U, 1)} m/s and the number is {fmt(SUPER.brn, 1)}, inside the range
        of roughly 10 to 45 where supercells are favored. At 40 m/s it falls to {fmt(TORN.brn, 1)}. These are rules of thumb distilled from observations and
        computer simulations, not laws, but they are the rules this demonstration follows.
      </P>

      <H2>Rain at one spot</H2>
      <P>
        The rain rate under a storm depends on how much vapor its updraft carries up and how much of that falls out as rain rather than evaporating or blowing
        away in the <b>anvil</b>, the flat sheet of cloud that spreads out where the rising air reaches the tropopause of{' '}
        <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> and stops climbing. In this model the starting single cell, once lifted, rains{' '}
        {fmt(GO.rainRateMmH)} mm an hour under its core — almost 2 inches. The supercell rains a little less, {fmt(SUPER.rainRateMmH)} mm an hour, because more
        of its water is carried off downwind.
      </P>
      <P>
        But what floods a field or a street is the total at one spot, and that is the rain rate times the time the storm spends overhead. Storms drift with the
        average wind through their depth, in this model 5 m/s plus half the shear. The single cell moves at {fmt(GO.motionMs, 1)} m/s and drops{' '}
        {fmt(GO.pointRainMm, 1)} mm on a spot it crosses; the multicell cluster at 15 m/s of shear, wider and slower than the supercell, drops{' '}
        {fmt(MULTI.pointRainMm, 1)} mm; the fast-moving supercell, only {fmt(SUPER.pointRainMm, 1)} mm. In the next demonstration, storms raining at the same rate
        cross a rain gauge one after another. Change the rain rate, the width of the rain area, the speed, and how many storms follow the same track:
      </P>

      <Figure name="Storm Formation Simulator · rain at a point" scenario={r} play={play}>
        <SpotChart st={rs} frac={Math.min(1, frac)} />
        <Readouts
          items={[
            { label: 'each storm rains on the gauge for', value: `${fmt(hoursOverSpot(rs) * 60)} min` },
            { label: 'rain at the gauge', value: `${fmt(total, 1)} mm · ${fmt(total / 25.4, 2)} in`, tone: WX.moisture },
          ]}
        />
        <Slider label="Rain rate under the storm" tone={WX.moisture} value={rs.rate} min={10} max={100} onChange={(v) => setRain({ rate: v })} display={`${fmt(rs.rate)} mm/h`} />
        <Slider label="Width of the rain area" value={rs.width} min={5} max={40} onChange={(v) => setRain({ width: v })} display={`${fmt(rs.width)} km`} />
        <Slider label="Storm speed" tone={WX.wind} value={rs.speed} min={1} max={20} step={SPEED_STEP} onChange={(v) => setRain({ speed: v })} display={`${fmt(rs.speed, 1)} m/s`} />
        <Slider label="Storms on the same track" value={rs.cells} min={1} max={5} onChange={(v) => setRain({ cells: v })} display={`${rs.cells}`} />
      </Figure>

      <P>
        The total is the rain rate times the width of the rain area divided by the storm’s speed, once for each storm that crosses. Halve the speed and the gauge
        collects twice as much; a storm that barely moves can pour for hours on the same few square kilometers. The same thing happens when storms line up along
        a front or an <b>outflow boundary</b> — the gust front left behind by earlier storms — and new cells keep forming at the upwind end, so one after another
        passes over the same ground. Meteorologists call it{' '}
        <b>training</b>, after a line of railway cars, and it is behind many flash floods.
      </P>

      <Challenge
        id="b"
        question={`Three storms on the same track each rain ${FLOOD.rate} mm an hour over a rain area ${FLOOD.width} km wide. What is the fastest they can move, to the nearest 0.5 m/s, and still leave ${FLOOD.mm} mm — about 4 inches — in the gauge?`}
        solved={solved2}
        status={
          rs.rate !== FLOOD.rate || rs.width !== FLOOD.width || rs.cells !== FLOOD.cells
            ? `Set the rain rate to ${FLOOD.rate} mm/h, the width to ${FLOOD.width} km and the storms on the same track to ${FLOOD.cells} first.`
            : total < FLOOD.mm - 1e-6
              ? `At ${fmt(rs.speed, 1)} m/s the gauge collects ${fmt(total, 1)} mm.`
              : `At ${fmt(rs.speed, 1)} m/s the gauge collects ${fmt(total, 1)} mm. Could the storms move faster?`
        }
        success={`Solved. Each storm spends 10 km ÷ ${fmt(rs.speed, 1)} m/s = ${fmt(hoursOverSpot(rs) * 60)} minutes over the gauge and leaves ${fmt(rainAtSpot({ ...rs, cells: 1 }), 1)} mm; three of them leave ${fmt(total, 1)} mm. That is about ${fmt(rs.speed * 3.6)} km an hour, slow for a storm. In many places 100 mm in a few hours is enough to flood small streams and city streets.`}
      />

      <P>
        Notice how local all of this is. A storm 10 km wide can soak one farm and leave the next one dry, so a season’s rain at Marlow is a patchwork, and the
        gauge that measures it reports only what falls into its own mouth, a circle about 20 cm across. That matters for anyone who depends on rain: in Chapter 4 we’ll see how the timing and
        amount of summer rain set the size of a corn crop, and in Chapter 3, how radar fills in the gaps between gauges.
      </P>
      <P>
        Storms live for minutes to hours, fronts for days. Compare <FigRef to="Storm Formation Simulator">the first demonstration</FigRef>, where a degree of dew point
        decides between a clear evening and a storm: weather on this scale is hard to predict far ahead. Some of the largest swings in a season’s weather come
        from something much slower — the ocean, whose surface temperatures change over months and push the atmosphere’s odds one way or the other for a whole
        winter. That is the subject of <a href={lessonHref('weather/2.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
