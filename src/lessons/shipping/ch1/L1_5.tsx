import { useState } from 'react';
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
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { powerAndFuel } from '../../../engines/shipping/propulsion';
import { calmResistance } from '../../../engines/shipping/resistance';
import {
  CALM,
  beaufort,
  passageInWeather,
  speedInWeather,
  waveAddedResistance,
  waveHeadingFactor,
  windAddedResistance,
  type LegResult,
  type Weather,
} from '../../../engines/shipping/weather';
import { SEA_FILL, SEA_LINE, ShipSide, shipSideScale } from '../shared/ShipSide';
import { useRevealed } from './reveal';

const K_ = KESTREL;
const LADEN = { draft: K_.designDraft };
/** The engine setting held through this lesson unless the reader changes it. */
const POWER = 0.85;
/** The passage the first demonstration times: about the haul from Western Australia to northern China. */
const PASSAGE_NM = 3600;

const kn = (x: number) => `${fmt(x, 1)} kn`;
const days = (x: number) => `${fmt(x, 1)} days`;
const t = (x: number) => `${fmt(x)} t`;

const DIRS = [
  { value: '0', label: 'Head' },
  { value: '45', label: 'Bow' },
  { value: '90', label: 'Beam' },
  { value: '135', label: 'Quarter' },
  { value: '180', label: 'Following' },
] as const;
type Dir = (typeof DIRS)[number]['value'];
const DIR_WORDS: Record<Dir, string> = {
  '0': 'from dead ahead',
  '45': 'on the bow',
  '90': 'on the beam',
  '135': 'on the quarter',
  '180': 'from astern',
};

/** Kestrel laden, engine at a fraction of MCR, in some weather. */
export function laden(w: Weather, powerFrac = POWER) {
  return speedInWeather(K_, w, powerFrac, LADEN);
}

export function ladenPassage(w: Weather, powerFrac = POWER, nm = PASSAGE_NM) {
  return passageInWeather(K_, [{ nm, weather: w }], powerFrac, LADEN);
}

const head = (waveHeight: number, windKn: number): Weather => ({ waveHeight, windKn, dirDeg: 0, currentKn: 0 });

// Numbers the prose quotes, all from the model.
const CALM_85 = laden(CALM);
const CALM_14 = powerAndFuel(K_, 14, LADEN);
const CALM_R14 = calmResistance(K_, 14, K_.designDraft).total;
const RAW_2 = waveAddedResistance(K_, 2, 0);
const RAW_4 = waveAddedResistance(K_, 4, 0);
const HS4 = laden(head(4, 25));
const HS4_BEAM = laden({ ...head(4, 25), dirDeg: 90 });
const HS4_FOLLOW = laden({ ...head(4, 25), dirDeg: 180 });
const HS4_FULL = laden(head(4, 25), 1);
const HS6 = laden(head(6, 35));
const WIND30 = laden(head(0, 30));
const WIND30_KN = windAddedResistance(K_, K_.designDraft, 14, 30, 0);
const PASS_CALM = ladenPassage(CALM);
const PASS_GALE = ladenPassage(head(5, 30));
const CURRENT = laden({ ...CALM, currentKn: 1.5 });
const PASS_CURRENT = ladenPassage({ ...CALM, currentKn: 1.5 });

// ---------------------------------------------------------------------------
// Weather routing: a direct route through a storm, or a longer one around it.

export const ROUTE = { direct: 3000, storm: 1000, detour: 3300 } as const;
/** The moderate head sea both routes meet outside the storm. */
export const MODERATE: Weather = { waveHeight: 2, windKn: 12, dirDeg: 0, currentKn: 0 };
export const STORM_MIN = 2;
export const STORM_MAX = 8;
export const STORM_STEP = 0.1;

/** The storm's sea: head seas, with the wind rising with the waves (6 knots per meter, at most 50). */
export function stormWeather(hs: number): Weather {
  return { waveHeight: hs, windKn: Math.min(50, 6 * hs), dirDeg: 0, currentKn: 0 };
}

export function routes(stormHs: number) {
  const edge = (ROUTE.direct - ROUTE.storm) / 2;
  const direct = passageInWeather(
    K_,
    [
      { nm: edge, weather: MODERATE },
      { nm: ROUTE.storm, weather: stormWeather(stormHs) },
      { nm: edge, weather: MODERATE },
    ],
    POWER,
    LADEN,
  );
  const detour = passageInWeather(K_, [{ nm: ROUTE.detour, weather: MODERATE }], POWER, LADEN);
  return { direct, detour };
}

/** Whether this storm, on the slider's 0.1 m steps, is the smallest at which the detour arrives sooner (the challenge's success message quotes it). */
export function detourSolved(stormHs: number) {
  const h = Math.round(stormHs / STORM_STEP) * STORM_STEP;
  const now = routes(h);
  const before = routes(h - STORM_STEP);
  return now.detour.days < now.direct.days && before.detour.days >= before.direct.days;
}

/** The storm wave height at which the two routes take exactly as long, m (found by bisection). */
export const ROUTES_TIE_HS = (() => {
  let lo = STORM_MIN;
  let hi = STORM_MAX;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const r = routes(mid);
    if (r.detour.days < r.direct.days) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
})();

/** The smallest storm on the slider's grid at which the detour arrives first. */
const DETOUR_FIRST_HS = (() => {
  for (let i = Math.round(STORM_MIN / STORM_STEP); i <= Math.round(STORM_MAX / STORM_STEP); i++) if (detourSolved(i * STORM_STEP)) return i * STORM_STEP;
  return STORM_MAX;
})();

/**
 * The challenge: find the storm at which the routes tie, to within a tenth of a meter. The routes'
 * days stay hidden until it is solved, so the reader predicts the tying storm speed from the caption
 * (13.5 knots × 1,000 ÷ 1,300 ≈ 10.4 knots) and raises the storm until it slows her that much.
 */
export function tieSolved(stormHs: number): boolean {
  const h = Math.round(stormHs / STORM_STEP) * STORM_STEP;
  return Math.abs(h - ROUTES_TIE_HS) <= 0.1 + 1e-9;
}

/** Nautical miles covered after `tau` days on a passage made of legs. */
function milesAt(legs: LegResult[], tau: number) {
  let nm = 0;
  let left = tau;
  for (const l of legs) {
    if (left >= l.days) {
      nm += l.nm;
      left -= l.days;
    } else {
      return nm + (l.nm * left) / l.days;
    }
  }
  return nm;
}

// Map geometry for the routing figure.
const A = { x: 62, y: 112 };
const B = { x: 578, y: 112 };
const CTRL = { x: 320, y: 300 };
const bez = (u: number) => ({
  x: (1 - u) ** 2 * A.x + 2 * (1 - u) * u * CTRL.x + u * u * B.x,
  y: (1 - u) ** 2 * A.y + 2 * (1 - u) * u * CTRL.y + u * u * B.y,
});
const DETOUR_PTS = Array.from({ length: 81 }, (_, i) => bez(i / 80));
const DETOUR_LEN = DETOUR_PTS.reduce((acc, p, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + Math.hypot(p.x - DETOUR_PTS[i - 1].x, p.y - DETOUR_PTS[i - 1].y));
  return acc;
}, [] as number[]);
function detourPoint(frac: number) {
  const target = Math.max(0, Math.min(1, frac)) * DETOUR_LEN[DETOUR_LEN.length - 1];
  let i = 1;
  while (i < DETOUR_LEN.length - 1 && DETOUR_LEN[i] < target) i++;
  const k = (target - DETOUR_LEN[i - 1]) / Math.max(1e-9, DETOUR_LEN[i] - DETOUR_LEN[i - 1]);
  return { x: DETOUR_PTS[i - 1].x + k * (DETOUR_PTS[i].x - DETOUR_PTS[i - 1].x), y: DETOUR_PTS[i - 1].y + k * (DETOUR_PTS[i].y - DETOUR_PTS[i - 1].y) };
}
const DETOUR_D = `M${A.x} ${A.y} Q${CTRL.x} ${CTRL.y} ${B.x} ${B.y}`;
const STORM_X0 = A.x + ((B.x - A.x) * (ROUTE.direct - ROUTE.storm)) / 2 / ROUTE.direct;
const STORM_X1 = B.x - ((B.x - A.x) * (ROUTE.direct - ROUTE.storm)) / 2 / ROUTE.direct;

// ---------------------------------------------------------------------------
// The side view for the first demonstration.

const SIDE_X = 14;
const SIDE_W = 420;
const KEEL = 224;
const { sx: SX, sz: SZ } = shipSideScale(K_, SIDE_W);
const WL = KEEL - K_.designDraft * SZ;
const MID_X = SIDE_X + SIDE_W / 2;
const WAVELENGTH_M = 140;

function Arrow({ x1, y1, x2, y2, color, width = 3 }: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = 9;
  const p1 = `${x2},${y2}`;
  const p2 = `${x2 - h * Math.cos(a - 0.45)},${y2 - h * Math.sin(a - 0.45)}`;
  const p3 = `${x2 - h * Math.cos(a + 0.45)},${y2 - h * Math.sin(a + 0.45)}`;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2 - 6 * Math.cos(a)} y2={y2 - 6 * Math.sin(a)} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${p1} ${p2} ${p3}`} fill={color} />
    </g>
  );
}

export default function Lesson() {
  // ---- Demonstration 1: Kestrel in weather.
  const lab = useScenario('weather', { waveHeight: 3, windKn: 20, dir: '0' as Dir, currentKn: 0, power: 85 });
  const { waveHeight, windKn, dir, currentKn, power } = lab.state;
  const dirDeg = Number(dir);
  const w: Weather = { waveHeight, windKn, dirDeg, currentKn };
  const sp = laden(w, power / 100);
  const calmSame = laden(CALM, power / 100);
  const pass = ladenPassage(w, power / 100);
  const bf = beaufort(windKn);
  const raw = waveAddedResistance(K_, waveHeight, dirDeg);
  const hf = waveHeadingFactor(dirDeg);

  const play = usePlay(true);
  const [clock, setClock] = useState(0);
  useAnimationFrame((dt) => setClock((c) => c + dt), play.playing);

  const cosd = Math.cos((dirDeg * Math.PI) / 180);
  const sind = Math.sin((dirDeg * Math.PI) / 180);
  const amp = (waveHeight / 2) * SZ;
  const kWave = (2 * Math.PI) / (WAVELENGTH_M * SX);
  const omega = (2 * Math.PI) / 3.2;
  const surf = (x: number) => WL - amp * Math.sin(kWave * cosd * (x - MID_X) + omega * clock);
  let seaPath = `M-4 ${surf(-4).toFixed(1)}`;
  for (let x = 0; x <= 644; x += 8) seaPath += ` L${x} ${surf(x).toFixed(1)}`;
  const pitch = Math.min(4, 0.5 * waveHeight) * Math.abs(cosd) * Math.sin(omega * clock + 1.1) * Math.sign(cosd || 1);
  const heave = 0.35 * amp * Math.sin(omega * clock + 0.4);

  // Plan-view inset.
  const C = { x: 548, y: 116 };
  const from = (r: number, off: number) => ({ x: C.x + r * sind + off * cosd, y: C.y - r * cosd + off * sind });
  const windLen = 10 + windKn * 0.5;
  const waveLen = 10 + waveHeight * 3.5;

  // ---- Demonstration 2: weather routing.
  const rt = useScenario('routing', { stormHs: 3 });
  const stormHs = Math.round(rt.state.stormHs * 10) / 10;
  const r = routes(stormHs);
  const storm = stormWeather(stormHs);
  const stormBf = beaufort(storm.windKn);
  const detourFaster = r.detour.days < r.direct.days;
  const gap = r.direct.days - r.detour.days;
  const solved = tieSolved(stormHs);
  const revealed = useRevealed('shipping/1.5', 'a', solved);
  const vMod = r.detour.legs[0].speed.stw;
  const vStorm = r.direct.legs[1].speed.stw;
  const breakEvenKn = (vMod * ROUTE.storm) / (ROUTE.storm + ROUTE.detour - ROUTE.direct);

  const race = usePlay(true);
  const [tau, setTau] = useState(0);
  const span = Math.max(r.direct.days, r.detour.days) + 1.5;
  useAnimationFrame((dt) => setTau((x) => (x + (dt * span) / 7) % span), race.playing);
  const nmDirect = milesAt(r.direct.legs, tau);
  const nmDetour = milesAt(r.detour.legs, tau);
  const pDirect = { x: A.x + ((B.x - A.x) * nmDirect) / ROUTE.direct, y: A.y };
  const pDetour = detourPoint(nmDetour / ROUTE.detour);
  const stormOpacity = 0.06 + ((stormHs - STORM_MIN) / (STORM_MAX - STORM_MIN)) * 0.34;

  return (
    <LessonPage id="shipping/1.5">
      <P>
        Every measurement so far has been made in still water. In <a href={lessonHref('shipping/1.2')}>Lesson 1.2</a> Kestrel, fully laden, met {fmt(CALM_R14)} kilonewtons
        of resistance at 14 knots, and in <a href={lessonHref('shipping/1.3')}>Lesson 1.3</a> that took {fmt(CALM_14.brakePower)} kilowatts — {fmt(CALM_14.load * 100)}% of
        her engine’s maximum continuous rating. <a href={lessonHref('shipping/1.4')}>Lesson 1.4</a> checked that she would come back upright when she rolled. But the
        ocean is rarely still. Wind piles against her superstructure, waves break on her bow, and the water itself may be flowing with her or against her.
      </P>
      <P>
        What does weather do to a voyage’s time and fuel, and what can a navigator do about it? A ship’s engine is usually set to a steady power, and the speed is
        whatever that power can make against the sea. So we’ll do the same: hold Kestrel’s engine at {fmt(POWER * 100)}% of its rating, {fmt(CALM_85.brakePower)}{' '}
        kilowatts, which drives her at {kn(CALM_85.stw)} in calm water on {fmt(CALM_85.tpd, 1)} tonnes of fuel a day, and change the weather around her.
      </P>
      <P>
        In the next demonstration, Kestrel is laden at her summer draft. Set the height of the waves, the strength of the wind and the direction both come from,
        and a current running along her track. The wave height is the <b>significant wave height</b> forecasters use: the average height of the highest third of
        the waves, close to what an experienced eye would estimate. The wind is also named on the <b>Beaufort scale</b>, the sailor’s scale of force 0, calm, to
        force 12, hurricane. The side view shows her in the sea (heights stretched, as before); the plan view on the right shows where the wind and waves come
        from. The readouts include the {fmt(PASSAGE_NM)}-nautical-mile passage from <a href={lessonHref('shipping/1.3')}>Lesson 1.3</a>, about the haul from
        Western Australia’s ore ports to northern China, sailed entirely in these conditions:
      </P>

      <Figure name="Voyage Physics Lab" scenario={lab} play={play}>
        <svg
          className="diagram"
          viewBox="0 0 640 268"
          role="img"
          aria-label={`Kestrel laden at ${power}% engine power in ${fmt(waveHeight, 1)} m waves and a ${windKn}-knot wind ${DIR_WORDS[dir]}, with a ${fmt(currentKn, 1)}-knot current along her track. She makes ${kn(sp.stw)} through the water and ${kn(sp.sog)} over the ground, burning ${fmt(sp.tpd, 1)} t a day.`}
        >
          <defs>
            <clipPath id="l15-above-keel">
              <rect x={-50} y={-200} width={700} height={KEEL + 200.5} />
            </clipPath>
          </defs>
          <g transform={`translate(0 ${heave.toFixed(2)}) rotate(${(-pitch).toFixed(3)} ${MID_X} ${WL})`}>
            <g clipPath="url(#l15-above-keel)">
              <ShipSide v={K_} draft={-10} x={SIDE_X} width={SIDE_W} keelY={KEEL} />
            </g>
          </g>
          <path d={`${seaPath} L644 268 L-4 268 Z`} fill={SEA_FILL} opacity={0.82} />
          <path d={seaPath} fill="none" stroke={SEA_LINE} strokeWidth={1.5} />
          <text x={SIDE_X + 4} y={262} className="ax">
            {waveHeight > 0 ? `${fmt(waveHeight, 1)} m seas ${DIR_WORDS[dir]}` : 'calm sea'}
          </text>
          {/* plan view */}
          <rect x={466} y={28} width={166} height={206} rx={6} fill="#fbfaf7" stroke="#dedbd3" />
          <text x={474} y={46} className="ax">
            Plan view
          </text>
          <circle cx={C.x} cy={C.y} r={58} fill="none" stroke="#e4e1da" strokeDasharray="3 4" />
          <polygon points={`${C.x},${C.y - 36} ${C.x + 9},${C.y - 20} ${C.x + 9},${C.y + 30} ${C.x - 9},${C.y + 30} ${C.x - 9},${C.y - 20}`} fill="#f3f1ec" stroke="#5a5a5a" strokeWidth={1.3} />
          <text x={C.x} y={C.y - 42} textAnchor="middle" className="ax">
            bow
          </text>
          {windKn > 0 && (
            <Arrow
              x1={from(42 + windLen, -9).x}
              y1={from(42 + windLen, -9).y}
              x2={from(42, -9).x}
              y2={from(42, -9).y}
              color="#8a8a8a"
              width={2.5}
            />
          )}
          {waveHeight > 0 && (
            <Arrow x1={from(42 + waveLen, 9).x} y1={from(42 + waveLen, 9).y} x2={from(42, 9).x} y2={from(42, 9).y} color={GRAPHIC.blue} width={3.5} />
          )}
          {Math.abs(currentKn) > 0.04 && (
            <Arrow
              x1={C.x - 46}
              y1={C.y + (currentKn > 0 ? 18 : -18)}
              x2={C.x - 46}
              y2={C.y + (currentKn > 0 ? 18 : -18) - Math.sign(currentKn) * (14 + Math.abs(currentKn) * 12)}
              color={TEXT.teal}
              width={2.5}
            />
          )}
          <text x={474} y={214} className="ax">
            <tspan fill="#777">━</tspan> wind {windKn} kn
          </text>
          <text x={560} y={214} className="ax">
            <tspan fill={TEXT.teal}>━</tspan> current
          </text>
          <text x={474} y={228} className="ax">
            <tspan fill={GRAPHIC.blue}>━</tspan> waves {fmt(waveHeight, 1)} m
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'speed through the water', value: kn(sp.stw), tone: 'teal' },
            { label: 'speed over the ground', value: kn(sp.sog), tone: 'teal' },
            { label: 'fuel', value: `${fmt(sp.tpd, 1)} t/day`, tone: 'red' },
            { label: `${fmt(PASSAGE_NM)}-nm passage`, value: `${days(pass.days)}, ${t(pass.fuel)}`, tone: 'gold' },
            { label: `wind: Beaufort force ${bf.force}`, value: bf.name },
          ]}
        />
        <Caption>
          {sp.stw < calmSame.stw - 0.05
            ? `In calm water the same power would drive her at ${kn(calmSame.stw)}: the weather costs her ${kn(calmSame.stw - sp.stw)} of speed, with ${fmt(sp.added)} kN of added resistance.`
            : `In calm water the same power would drive her at ${kn(calmSame.stw)}; this weather costs her no speed through the water.`}
        </Caption>
        <Segmented label="Direction the wind and waves come from" value={dir} onChange={(v) => lab.set({ dir: v })} options={DIRS.map((d) => ({ ...d }))} />
        <Slider label="Wave height" tone="blue" value={waveHeight} min={0} max={8} step={0.5} onChange={(v) => lab.set({ waveHeight: v })} display={`${fmt(waveHeight, 1)} m`} />
        <Slider label="Wind speed" value={windKn} min={0} max={50} step={1} onChange={(v) => lab.set({ windKn: v })} display={`${windKn} kn`} />
        <Slider
          label="Current along her track"
          tone="teal"
          value={currentKn}
          min={-2}
          max={2}
          step={0.1}
          onChange={(v) => lab.set({ currentKn: v })}
          display={`${currentKn > 0 ? '+' : currentKn < 0 ? '−' : ''}${fmt(Math.abs(currentKn), 1)} kn`}
        />
        <Slider label="Engine power" tone="red" value={power} min={50} max={100} step={1} onChange={(v) => lab.set({ power: v })} display={`${power}% MCR`} />
        <Eq label={`Added resistance in waves: 0.64 rho g H squared B squared C b over L, times the heading factor ${hf.toFixed(2)}, equals ${fmt(raw)} kilonewtons`}>
          <K tone="violet">R<sub>waves</sub></K>
          <Op>=</Op>
          <Frac top={<span>0.64 ρ g <Tn tone="blue">H</Tn>² B² C<sub>b</sub></span>} bottom="L" />
          <Op>×</Op>
          <span>f<sub>dir</sub></span>
          <Op>=</Op>
          <Frac top={<span>0.64 × 1,025 × 9.81 × <Tn tone="blue">{fmt(waveHeight, 1)}</Tn>² × 32.25² × 0.87</span>} bottom="225" />
          <Op>×</Op>
          <span>{hf.toFixed(2)}</span>
          <Op>=</Op>
          <K tone="violet">{fmt(raw)} kN</K>
        </Eq>
      </Figure>

      <P>
        At the starting settings — three-meter seas and a 20-knot breeze from dead ahead — Kestrel makes {kn(laden(head(3, 20)).stw)} instead of{' '}
        {kn(CALM_85.stw)}, and her {fmt(PASSAGE_NM)}-mile passage stretches from {days(PASS_CALM.days)} to {days(ladenPassage(head(3, 20)).days)}. Nothing about
        the engine changed: it delivers the same power and burns the same {fmt(CALM_85.tpd, 1)} tonnes a day. The weather simply adds resistance, and at fixed
        power the only thing that can give is the speed. Seafarers call this <b>involuntary speed loss</b>. Because the fuel burned per day stays the same while
        the days pile up, the fuel per mile — and per voyage — rises with them.
      </P>
      <P>
        The waves do most of the damage. Our model uses an empirical estimate known as Kreitner’s formula, the equation in the demonstration: the{' '}
        <K tone="violet">added resistance</K> grows with the <i>square</i> of the wave height. Two-meter head seas add {fmt(RAW_2)} kilonewtons; four-meter seas
        add {fmt(RAW_4)}, four times as much, and more than half of Kestrel’s whole calm-water resistance at 14 knots. Direction matters as much as height. Our
        model scales the head-sea estimate by direction: waves on the bow do {fmt(waveHeadingFactor(45) * 100)}% of the harm of a head sea, beam seas a quarter,
        and seas on the quarter or from astern almost none. In
        four-meter waves with a 25-knot wind, Kestrel makes {kn(HS4.stw)} heading into them, {kn(HS4_BEAM.stw)} with them on the beam, and{' '}
        {kn(HS4_FOLLOW.stw)} running before them — a touch faster than in calm water, because the following wind now pushes on her superstructure instead of
        dragging on it. In a {beaufort(35).name}, six-meter seas and 35 knots of wind from ahead, she is down to {kn(HS6.stw)}.
      </P>
      <P>
        The wind on its own matters less. What the ship feels is the <b>apparent wind</b>, the true wind combined with the breeze of her own motion. Our model
        keeps only its part along her track — her own speed plus the true wind’s component in that direction — acting on the hull above water and the
        accommodation block at her stern. A 30-knot headwind adds {fmt(WIND30_KN)} kilonewtons at 14 knots and, on its
        own, slows her only to {kn(WIND30.stw)}. In real storms wind and waves come together, of course, because it is the wind that raises the sea.
      </P>

      <H2>The sea margin</H2>
      <P>
        Why not simply open the throttle? Try it: in those four-meter head seas, even 100% of the engine’s rating holds only {kn(HS4_FULL.stw)}, at{' '}
        {fmt(HS4_FULL.tpd, 1)} tonnes a day. This is why ships are not given engines sized for calm water. Designers add a <b>sea margin</b>, commonly about 15% more
        power than the calm-water speed needs, so that the service speed can be kept in ordinary weather. Kestrel’s calm-water 14 knots needs{' '}
        {fmt(CALM_14.load * 100)}% of her rating, so she has more than that margin in hand. No affordable margin covers a gale.
      </P>
      <P>
        Real masters also slow down on purpose. In a heavy head sea the bow lifts clear and slams back down, green water sweeps over the hatch covers, and the
        propeller races as the stern lifts out of the water. Easing the engine to spare the hull and cargo is called <b>voluntary speed loss</b>, and our model
        leaves it out. So does the roll: a stiff, ore-laden ship of the kind we met in <a href={lessonHref('shipping/1.4')}>Lesson 1.4</a> rolls hard and fast in
        a beam sea, which is a second reason to turn her head to the weather.
      </P>

      <H2>Currents</H2>
      <P>
        Now set the waves and wind to zero and add a current. Unlike the weather, a current adds no resistance at all: the ship moves through the water exactly as
        before, and the water carries both of them over the ground. A 1.5-knot current along her track leaves her speed through the water at{' '}
        {kn(CURRENT.stw)} but lifts her speed over the ground to {kn(CURRENT.sog)}, and the {fmt(PASSAGE_NM)}-mile passage drops from {days(PASS_CALM.days)} to{' '}
        {days(PASS_CURRENT.days)} on the same fuel per day. Some ocean currents, such as the Gulf Stream off North America and the Agulhas Current off southeastern
        Africa, can run at two knots or more, so navigators ride them when they flow the right way and keep clear of them when they don’t.
      </P>

      <H2>Weather routing</H2>
      <P>
        Over a whole passage the effects add up. Sailed entirely in five-meter head seas with a 30-knot wind, Kestrel’s {fmt(PASSAGE_NM)}-mile passage takes{' '}
        {days(PASS_GALE.days)} and {t(PASS_GALE.fuel)} of fuel, against {days(PASS_CALM.days)} and {t(PASS_CALM.fuel)} in calm water. Weather is forecast days
        ahead, though, and the ocean is wide. Many ocean-going ships now sail on <b>weather routing</b> advice: forecasters plot a track that bends around the worst of the
        weather, trading extra miles for better seas.
      </P>
      <P>
        In the next demonstration, Kestrel must cross {fmt(ROUTE.direct)} nautical miles of ocean. The direct route runs straight through a storm {fmt(ROUTE.storm)}{' '}
        miles across, whose waves you can set; its wind rises with the waves, and both meet her head on. The detour swings south around it, {fmt(ROUTE.detour)}{' '}
        miles in all. Outside the storm, both routes meet the same moderate two-meter head sea. Her engine stays at {fmt(POWER * 100)}%; the dots race the two
        routes, day by day:
      </P>

      <Figure name="Voyage Physics Lab · weather routing" scenario={rt} play={race}>
        <svg
          className="diagram"
          viewBox="0 0 640 262"
          role="img"
          aria-label={`Two routes across ${fmt(ROUTE.direct)} nautical miles of ocean. The direct route crosses a storm with ${fmt(stormHs, 1)}-meter waves, where Kestrel makes ${kn(vStorm)}; the ${fmt(ROUTE.detour)}-mile detour stays in moderate seas at ${kn(vMod)}.${revealed ? ` The direct route takes ${days(r.direct.days)} and ${t(r.direct.fuel)} of fuel; the detour, ${days(r.detour.days)} and ${t(r.detour.fuel)}.` : ''}`}
        >
          <rect x={8} y={8} width={624} height={246} rx={6} fill={SEA_FILL} opacity={0.55} />
          {[0.35, 0.6, 0.85, 1].map((k) => (
            <ellipse
              key={k}
              cx={(STORM_X0 + STORM_X1) / 2}
              cy={A.y}
              rx={((STORM_X1 - STORM_X0) / 2 + 10) * k}
              ry={62 * k}
              fill={GRAPHIC.red}
              opacity={stormOpacity * (k === 1 ? 0.6 : 0.45)}
            />
          ))}
          <text x={(STORM_X0 + STORM_X1) / 2} y={A.y - 70} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
            storm: {fmt(stormHs, 1)} m seas, {fmt(storm.windKn)} kn wind
          </text>
          <line x1={A.x} x2={B.x} y1={A.y} y2={A.y} stroke="#333" strokeWidth={revealed ? (detourFaster ? 1.6 : 3) : 2} />
          <path d={DETOUR_D} fill="none" stroke="#333" strokeWidth={revealed ? (detourFaster ? 3 : 1.6) : 2} strokeDasharray="7 5" />
          <circle cx={A.x} cy={A.y} r={6} fill="#fcfcfb" stroke="#333" strokeWidth={2} />
          <circle cx={B.x} cy={B.y} r={6} fill="#fcfcfb" stroke="#333" strokeWidth={2} />
          <text x={A.x} y={A.y - 14} textAnchor="middle" className="ax">
            depart
          </text>
          <text x={B.x} y={B.y - 14} textAnchor="middle" className="ax">
            arrive
          </text>
          <text x={A.x + 10} y={A.y + 20} className="lab">
            Direct · {fmt(ROUTE.direct)} nm{revealed && ` · ${days(r.direct.days)}`}
          </text>
          <text x={CTRL.x} y={232} textAnchor="middle" className="lab">
            Detour · {fmt(ROUTE.detour)} nm{revealed && ` · ${days(r.detour.days)}`}
          </text>
          <circle cx={pDirect.x} cy={pDirect.y} r={6.5} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />
          <circle cx={pDetour.x} cy={pDetour.y} r={6.5} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={2} />
          <text x={624} y={248} textAnchor="end" className="ax">
            day {fmt(Math.min(tau, span - 1.5), 1)}
          </text>
        </svg>
        {revealed && (
          <Readouts
            items={[
              { label: 'direct route', value: `${days(r.direct.days)}, ${t(r.direct.fuel)}`, tone: 'orange' },
              { label: 'detour', value: `${days(r.detour.days)}, ${t(r.detour.fuel)}`, tone: 'teal' },
              { label: detourFaster ? 'the detour saves' : 'the detour costs', value: `${fmt(Math.abs(gap) * 24, 1)} hours` },
            ]}
          />
        )}
        <Slider
          label="Storm wave height"
          tone="blue"
          value={stormHs}
          min={STORM_MIN}
          max={STORM_MAX}
          step={STORM_STEP}
          onChange={(v) => rt.set({ stormHs: v })}
          display={`${fmt(stormHs, 1)} m`}
        />
        <Caption>
          In the storm the wind blows at {fmt(storm.windKn)} knots, Beaufort force {stormBf.force} ({stormBf.name}), and Kestrel makes {kn(vStorm)}; outside it she
          makes {kn(vMod)}. Either way she burns {fmt(r.detour.legs[0].speed.tpd, 1)} tonnes a day.
        </Caption>
      </Figure>

      <P>
        A small storm isn’t worth avoiding. At three meters the direct route still arrives in {days(routes(3).direct.days)}, against {days(routes(3).detour.days)}{' '}
        for the detour: the storm costs her a few hours, the extra {fmt(ROUTE.detour - ROUTE.direct)} miles almost a day. But added resistance grows with the
        square of the wave height, so the storm’s cost climbs steeply while the detour’s stays fixed. Because the engine burns the same tonnes per day on either
        route, whichever arrives first also burns less fuel.
      </P>

      <Challenge
        id="a"
        question={`The routes’ days stay hidden until you find where they tie. Predict first: both routes sail ${fmt(ROUTE.direct - ROUTE.storm)} miles of moderate sea, where the caption shows her making ${kn(vMod)}; then the direct route crosses the storm’s ${fmt(ROUTE.storm)} miles, while the detour sails ${fmt(ROUTE.storm + ROUTE.detour - ROUTE.direct)} more miles of moderate sea. How slow must the storm make her for the two to take the same time? Then raise the storm until it slows her that much, and set the wave height at which the routes tie, to within a tenth of a meter.`}
        solved={solved}
        status={`With ${fmt(stormHs, 1)} m seas in the storm, she makes ${kn(vStorm)} through it.`}
        success={`Solved. The routes tie at about ${fmt(ROUTES_TIE_HS, 1)} m, where the storm holds Kestrel to ${kn(breakEvenKn)}: ${kn(vMod)} × ${fmt(ROUTE.storm)} ÷ ${fmt(ROUTE.storm + ROUTE.detour - ROUTE.direct)}, so that ${fmt(ROUTE.storm)} miles in the storm take as long as ${fmt(ROUTE.storm + ROUTE.detour - ROUTE.direct)} outside it. In a smaller storm the direct route arrives first; from ${fmt(DETOUR_FIRST_HS, 1)} m up, the detour does, by more with every tenth of a meter. She burns the same ${fmt(r.detour.legs[0].speed.tpd, 1)} tonnes a day on either route, so the quicker one is also the cheaper.`}
      />

      <P>
        Real routing weighs more than speed: a forecast that may be wrong, the risk of damage to hull and cargo, a charter contract that may specify the route, and
        the cost of arriving late. But the physics underneath is the one in <FigRef to="Voyage Physics Lab">the first demonstration</FigRef>: resistance from
        waves that grows with the square of their height, a fixed engine, and speed as the thing that gives.
      </P>
      <P>
        This chapter has followed one ship. We now know what sets how much Kestrel can carry, what it takes to push her through calm water and rough, what her
        engine burns doing it, and how her cargo must sit to keep her upright. Ships, though, come in many sizes and shapes, each built around a cargo and the ports
        and canals it must pass. In <a href={lessonHref('shipping/2.1')}>the next chapter</a> we’ll widen the view from one ship to the classes of ship that make up
        the world’s fleets, and what each can carry.
      </P>
    </LessonPage>
  );
}
