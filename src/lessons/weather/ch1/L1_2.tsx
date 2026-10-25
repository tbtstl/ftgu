import { useRef, useState } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
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
  K0,
  RD,
  adiabaticTemperature,
  density,
  potentialTemperature,
  specificVolume,
  standardPressure,
  standardTemperature,
} from '../../../engines/weather/thermo';
import { WX } from '../shared/tones';

type Mode = 'insulated' | 'isothermal';

/** The first demonstration's starting state: air at 15 °C and 1,000 hPa. */
export const PARCEL_DEFAULTS = { tC: 15, pHpa: 1000, mode: 'insulated' as Mode };

/** The challenge's air: about 3 km up, at 700 hPa and −5 °C. */
export const CHINOOK = { tC: -5, pHpa: 700 };
export const CHINOOK_THETA = potentialTemperature(CHINOOK.tC, CHINOOK.pHpa);

/**
 * The challenge: bring the 700 hPa, −5 °C air down to 1,000 hPa without heating it. Its potential
 * temperature must be the chinook air's, to within 0.15 K — a tolerance no temperature the slider
 * can set directly at 1,000 hPa meets, so the reader has to compress it.
 */
export function descentSolved(st: { tC: number; pHpa: number }): boolean {
  return st.pHpa === 1000 && Math.abs(potentialTemperature(st.tC, st.pHpa) - CHINOOK_THETA) < 0.15;
}

/** Sea-level pressure and temperature of the standard atmosphere. */
const P_SEA = standardPressure(0);
const T_SEA = standardTemperature(0);

/** A parcel lifted dry-adiabatically from sea level, `head` °C warmer than the standard atmosphere there. */
export function liftedParcel(heightKm: number, head: number) {
  const p = standardPressure(heightKm * 1000);
  const env = standardTemperature(heightKm * 1000);
  const parcel = adiabaticTemperature(T_SEA + head, P_SEA, p);
  return { p, env, parcel, gap: parcel - env, rhoParcel: density(p, parcel), rhoEnv: density(p, env), volume: specificVolume(p, parcel) };
}

/** The second challenge's head start, °C. */
export const HEAD_START = 3;
/** The second challenge: with a 3 °C head start, the highest 100 m step at which the parcel is still no colder than its surroundings. */
export function thermalTopSolved(st: { height: number; head: number }): boolean {
  if (st.head !== HEAD_START) return false;
  const here = liftedParcel(st.height, st.head).gap;
  const next = liftedParcel(Math.round((st.height + 0.1) * 10) / 10, st.head).gap;
  return here >= 0 && next < 0;
}

// ---------------------------------------------------------------------------
// The first demonstration: a kilogram of air as a cube, and its state on a pressure–volume chart.

const N_MOL = 44;
const PX_PER_M = 150;
const BOX = { cx: 160, cy: 150 };

interface Molecule {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function seedMolecules(): Molecule[] {
  let a = 48271;
  const r = () => (a = (a * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: N_MOL }, () => {
    const ang = 2 * Math.PI * r();
    const sp = 0.5 + r();
    return { x: r(), y: r(), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
  });
}

/** The cube of air with molecules bouncing inside it, faster the warmer it is. */
function ParcelBox({ tC, volume, playing }: { tC: number; volume: number; playing: boolean }) {
  const mol = useRef<Molecule[]>(seedMolecules());
  const [, setTick] = useState(0);
  const sideM = Math.cbrt(volume);
  const s = sideM * PX_PER_M;
  useAnimationFrame((dt) => {
    // Speed grows with the square root of the absolute temperature, as molecular speeds do.
    const k = (0.32 * Math.sqrt(Math.max(1, tC + K0) / 288.15)) / sideM;
    for (const m of mol.current) {
      m.x += m.vx * k * dt;
      m.y += m.vy * k * dt;
      if (m.x < 0) (m.x = -m.x), (m.vx = -m.vx);
      if (m.x > 1) (m.x = 2 - m.x), (m.vx = -m.vx);
      if (m.y < 0) (m.y = -m.y), (m.vy = -m.vy);
      if (m.y > 1) (m.y = 2 - m.y), (m.vy = -m.vy);
    }
    setTick((t) => t + 1);
  }, playing);
  const warm = Math.max(0, Math.min(1, (tC + 40) / 80));
  const x0 = BOX.cx - s / 2;
  const y0 = BOX.cy - s / 2;
  const ref = PX_PER_M;
  return (
    <g>
      <rect x={BOX.cx - ref / 2} y={BOX.cy - ref / 2} width={ref} height={ref} fill="none" stroke="#b5b5b5" strokeDasharray="4 4" />
      <text className="ax" x={BOX.cx + ref / 2 + 4} y={BOX.cy - ref / 2 + 12}>
        1 m³
      </text>
      <rect x={x0} y={y0} width={s} height={s} rx={3} fill={tint(GRAPHIC.orange, 0.12 + 0.2 * warm)} stroke={GRAPHIC.orange} strokeWidth={2} />
      {mol.current.map((m, i) => (
        <circle key={i} cx={x0 + 4 + m.x * (s - 8)} cy={y0 + 4 + m.y * (s - 8)} r={2.6} fill="#555" opacity={0.75} />
      ))}
    </g>
  );
}

const PV_X = scale(0.4, 2, 352, 620);
const PV_Y = scale(500, 1050, 262, 34);
const SWEEP = Array.from({ length: 56 }, (_, i) => 500 + i * 10);

function ParcelFigure({ tC, pHpa, mode, playing }: { tC: number; pHpa: number; mode: Mode; playing: boolean }) {
  const vol = specificVolume(pHpa, tC);
  const adiabat = SWEEP.map((p) => specificVolume(p, adiabaticTemperature(tC, pHpa, p)));
  const isotherm = SWEEP.map((p) => specificVolume(p, tC));
  const ys = SWEEP.map(PV_Y);
  const clip = 'pv-clip';
  const insulated = mode === 'insulated';
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`One kilogram of air at ${fmt(tC, 1)} °C and ${fmt(pHpa)} hPa fills ${fmt(vol, 2)} cubic meters, a density of ${fmt(1 / vol, 3)} kg/m³. On the pressure–volume chart, the ${insulated ? 'insulated (adiabatic)' : 'constant-temperature'} curve through this state is the path a change of pressure would follow.`}
    >
      <ParcelBox tC={tC} volume={vol} playing={playing} />
      <text className="lab" x={BOX.cx} y={286} textAnchor="middle">
        1 kg of air · {fmt(vol, 2)} m³
      </text>
      <defs>
        <clipPath id={clip}>
          <rect x={352} y={34} width={268} height={228} />
        </clipPath>
      </defs>
      <text className="ax" x={352} y={20}>
        Pressure, hPa
      </text>
      {[600, 800, 1000].map((p) => (
        <g key={p}>
          <line className="gl" x1={352} x2={620} y1={PV_Y(p)} y2={PV_Y(p)} />
          <text className="ax ax-e" x={346} y={PV_Y(p) + 4}>
            {fmt(p)}
          </text>
        </g>
      ))}
      <line className="base" x1={352} x2={620} y1={262} y2={262} />
      {[0.5, 1, 1.5, 2].map((v) => (
        <text key={v} className="ax ax-m" x={PV_X(v)} y={278}>
          {fmt(v, 1)}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={294}>
        volume of 1 kg, m³
      </text>
      <g clipPath={`url(#${clip})`}>
        <path d={linePath(isotherm.map(PV_X), ys)} fill="none" stroke="#8a8a8a" strokeWidth={insulated ? 1.5 : 2.5} strokeDasharray={insulated ? '5 4' : undefined} />
        <path d={linePath(adiabat.map(PV_X), ys)} fill="none" stroke={GRAPHIC.orange} strokeWidth={insulated ? 2.5 : 1.5} strokeDasharray={insulated ? undefined : '5 4'} />
      </g>
      <circle cx={PV_X(vol)} cy={PV_Y(pHpa)} r={6} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={2} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: a parcel lifted through the standard atmosphere.

const Z = Array.from({ length: 101 }, (_, i) => i / 10);
const HY = scale(0, 10, 310, 30);
const TX = scale(-80, 25, 300, 620);

function RisingFigure({ height, head }: { height: number; head: number }) {
  const now = liftedParcel(height, head);
  const profile = Z.map((z) => liftedParcel(z, head));
  const r = 20 * Math.cbrt(now.volume);
  const colder = now.gap < 0;
  const parcelFill = colder ? tint(GRAPHIC.blue, 0.25 + Math.min(0.5, -now.gap / 40)) : tint(GRAPHIC.red, 0.25 + Math.min(0.5, now.gap / 10));
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 340"
      role="img"
      aria-label={`A parcel lifted from sea level, starting ${fmt(head, 1)} °C warmer than the standard atmosphere, is at ${fmt(height, 1)} km where the pressure is ${fmt(now.p)} hPa. It has cooled to ${fmt(now.parcel, 1)} °C against ${fmt(now.env, 1)} °C around it, so it is ${fmt(Math.abs(now.gap), 1)} °C ${colder ? 'colder' : 'warmer'} and ${fmt(Math.abs(now.rhoParcel / now.rhoEnv - 1) * 100, 1)}% ${now.rhoParcel > now.rhoEnv ? 'denser' : 'lighter'}.`}
    >
      {/* The column of air, shaded by the surrounding air's density. */}
      {Z.slice(0, 20).map((_, i) => {
        const z0 = i * 0.5;
        const rho = density(standardPressure((z0 + 0.25) * 1000), standardTemperature((z0 + 0.25) * 1000));
        return <rect key={i} x={60} y={HY(z0 + 0.5)} width={140} height={HY(z0) - HY(z0 + 0.5) + 0.5} fill={GRAPHIC.blue} opacity={0.3 * (rho / 1.225)} />;
      })}
      <line className="base" x1={60} x2={200} y1={310} y2={310} />
      {[0, 2, 4, 6, 8, 10].map((z) => (
        <g key={z}>
          <text className="ax ax-e" x={54} y={HY(z) + 4}>
            {z} km
          </text>
          <text className="ax" x={206} y={HY(z) + 4} style={{ fill: TEXT.blue }}>
            {fmt(standardPressure(z * 1000))} hPa
          </text>
        </g>
      ))}
      <circle cx={130} cy={HY(height)} r={r} fill={parcelFill} stroke={colder ? GRAPHIC.blue : GRAPHIC.red} strokeWidth={2} />

      <text className="ax" x={300} y={18}>
        Temperature, °C
      </text>
      {[-80, -60, -40, -20, 0, 20].map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={TX(t)} x2={TX(t)} y1={30} y2={310} />
          <text className="ax ax-m" x={TX(t)} y={328}>
            {t}
          </text>
        </g>
      ))}
      <path d={linePath(profile.map((q) => TX(q.env)), Z.map(HY))} fill="none" stroke="#777" strokeWidth={2} />
      <path d={linePath(profile.map((q) => TX(q.parcel)), Z.map(HY))} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} strokeDasharray="7 4" />
      <line className="cur" x1={300} x2={620} y1={HY(height)} y2={HY(height)} />
      <circle cx={TX(now.env)} cy={HY(height)} r={5} fill="#777" stroke="#fcfcfb" strokeWidth={2} />
      <circle cx={TX(now.parcel)} cy={HY(height)} r={6} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={2} />
      <text className="ax ax-e" x={612} y={Math.max(44, HY(height) - 8)}>
        {Math.abs(now.gap) < 0.05 ? 'same temperature' : `${fmt(Math.abs(now.gap), 1)} °C ${colder ? 'colder' : 'warmer'}`}
      </text>
    </svg>
  );
}

export default function Lesson() {
  const play = usePlay(true);
  const s = useScenario('parcel', PARCEL_DEFAULTS);
  const { tC, pHpa, mode } = s.state;
  const rho = density(pHpa, tC);
  const theta = potentialTemperature(tC, pHpa);
  const solved = descentSolved(s.state);

  const r = useScenario('rising', { height: 0, head: 0 });
  const { height, head } = r.state;
  const lifted = liftedParcel(height, head);
  const solved2 = thermalTopSolved(r.state);

  // Numbers the prose quotes.
  const start = { rho: density(1000, 15), vol: specificVolume(1000, 15) };
  const warmer = { rho: density(1000, 25), vol: specificVolume(1000, 25) };
  const winter = density(1020, -10);
  const summer = density(1010, 32);
  const released = adiabaticTemperature(15, 1000, 900);
  const arrival = adiabaticTemperature(CHINOOK.tC, CHINOOK.pHpa, 1000);
  const at = (z: number) => liftedParcel(z, 0);
  const halfHeight = 5.5;

  const setPressure = (v: number) =>
    s.set((st) => (st.mode === 'insulated' ? { pHpa: v, tC: adiabaticTemperature(st.tC, st.pHpa, v) } : { pHpa: v }));

  return (
    <LessonPage id="weather/1.2">
      <P>
        The previous lesson ended with a planet that has too much energy at the equator and too little at the poles, and an atmosphere that carries the difference
        by moving. To see how heat turns into motion, we need a way to follow the air itself. Meteorologists do it with a <b>parcel</b>: a body of air large enough to
        have a definite temperature, and small enough that its temperature and pressure are the same throughout. Picture a balloon with a weightless skin that lets it
        expand and shrink freely but keeps its air from mixing with the air around it.
      </P>
      <P>
        Three numbers describe the parcel’s state. Its air is a crowd of molecules, mostly nitrogen and oxygen, flying about at an average of about 460 meters per
        second at 15 °C. Its <K tone={WX.temperature}>temperature</K> measures how fast they move. Its <K tone={WX.pressure}>pressure</K> is the push of their
        collisions on any surface, including the parcel’s skin, measured in hectopascals (hPa); the atmosphere presses down at sea level with about 1,013 hPa. And its{' '}
        <K tone={WX.density}>density</K> is how many kilograms of air fill each cubic meter. The three are tied together by the ideal gas law, p = ρRT, where R is a
        constant for dry air, 287 joules per kilogram per kelvin, and T is in kelvins. Pack the molecules closer, or make them move faster, and they push harder.
      </P>
      <P>
        In the next demonstration, the cube holds one kilogram of air. Its size shows the volume that kilogram fills, the dashed square is one cubic meter for
        scale, and the dots stand for its molecules, moving faster as the air warms. The chart on the right plots the same state as a dot, pressure against volume.
        The temperature slider heats or cools the air while holding its pressure fixed; the pressure slider squeezes or releases it. A switch sets what happens to
        the temperature when the pressure changes — the air is either insulated, so no heat goes in or out, or held at a constant temperature — and the chart’s
        two curves are the paths those choices would follow from the current state. The last readout, the potential temperature, is the temperature this air
        would have if it were squeezed or released, insulated, to 1,000 hPa; we’ll see why it matters once the pressure starts changing:
      </P>

      <Figure name="Air Parcel Simulator" scenario={s} play={play}>
        <Segmented
          label="When the pressure changes"
          value={mode}
          onChange={(v) => s.set({ mode: v })}
          options={[
            { value: 'insulated', label: 'Insulated: no heat in or out' },
            { value: 'isothermal', label: 'Held at a constant temperature' },
          ]}
        />
        <ParcelFigure tC={tC} pHpa={pHpa} mode={mode} playing={play.playing} />
        <Legend
          items={[
            { label: 'Insulated path', color: GRAPHIC.orange, kind: 'line', dashed: mode !== 'insulated' },
            { label: 'Constant-temperature path', color: '#8a8a8a', kind: 'line', dashed: mode === 'insulated' },
          ]}
        />
        <Readouts
          items={[
            { label: 'density', value: `${fmt(rho, 3)} kg/m³`, tone: WX.density },
            { label: 'potential temperature', value: `${fmt(theta, 1)} K`, tone: WX.temperature },
          ]}
        />
        <Slider label="Temperature" tone={WX.temperature} value={tC} min={-60} max={50} step={0.5} onChange={(v) => s.set({ tC: v })} display={`${fmt(tC, 1)} °C`} />
        <Slider label="Pressure" tone={WX.pressure} value={pHpa} min={500} max={1050} step={5} onChange={setPressure} display={`${fmt(pHpa)} hPa`} />
        <Eq label={`The ideal gas law: ${fmt(pHpa * 100)} pascals equals ${fmt(rho, 3)} kilograms per cubic meter times 287 times ${fmt(tC + K0, 1)} kelvins`}>
          <K tone={WX.pressure}>{fmt(pHpa * 100)} Pa</K>
          <Op>=</Op>
          <K tone={WX.density}>{fmt(rho, 3)} kg/m³</K>
          <Op>×</Op>
          <span>{fmt(RD)} J/(kg·K)</span>
          <Op>×</Op>
          <K tone={WX.temperature}>{fmt(tC + K0, 1)} K</K>
        </Eq>
      </Figure>

      <P>
        At 1,000 hPa and 15 °C, the kilogram fills {fmt(start.vol, 2)} m³, a density of {fmt(start.rho, 2)} kg/m³. Heat it to 25 °C and the molecules push harder;
        with the pressure held fixed, the only way to keep the push the same is to spread out, and the cube grows to {fmt(warmer.vol, 2)} m³. At the same pressure,
        warm air is less dense than cold air. That single fact is why warm air rises, and it will drive most of what follows.
      </P>
      <P>
        The differences are not small. A winter morning in Fenwick Bay at −10 °C and 1,020 hPa packs {fmt(winter, 2)} kg into every cubic meter; a summer afternoon at
        32 °C and 1,010 hPa, only {fmt(summer, 2)} kg — the winter air is {fmt((winter / summer - 1) * 100)}% denser. A wind turbine’s power is proportional to the
        density of the air passing through it, so a cold wind carries more energy than a warm one blowing at the same speed. We’ll use that in{' '}
        <a href={lessonHref('weather/4.4')}>Lesson 4.4</a>, when we turn weather into electricity.
      </P>

      <H2>Squeezing without heating</H2>
      <P>
        Now change the pressure. Held at a constant temperature, the air obeys the gas law in its simplest form: halve the pressure and the volume doubles. But that
        isn’t how air in the atmosphere behaves. Air conducts heat poorly, and a parcel can be hundreds of meters across, so when it moves up or down it changes
        pressure far faster than heat can leak in or out of it. A change with no heat exchanged is called <b>adiabatic</b>. Squeezing the parcel does work on it, and
        the work shows up as a higher temperature. Releasing it lets it push its surroundings outward, and it pays for that work out of its own energy and cools:
      </P>
      <Eq label="Temperature after an adiabatic change of pressure: T2 equals T1 times p2 over p1 to the power 0.286">
        <K tone={WX.temperature}>
          T<Sub>2</Sub>
        </K>
        <Op>=</Op>
        <K tone={WX.temperature}>
          T<Sub>1</Sub>
        </K>
        <Op>×</Op>
        <span>
          (<K tone={WX.pressure}>p</K>
          <Sub>2</Sub> / <K tone={WX.pressure}>p</K>
          <Sub>1</Sub>)<Sup>0.286</Sup>
        </span>
      </Eq>
      <P>
        The temperatures are in kelvins, and the exponent is the gas constant divided by air’s specific heat, R/c<Sub>p</Sub>. With the insulated setting chosen in{' '}
        <FigRef to="Air Parcel Simulator">the first demonstration</FigRef>, release air at 15 °C from 1,000 to 900 hPa and it cools to {fmt(released, 1)} °C,
        though no heat has left it. On the chart, the insulated path through the dot is steeper than the constant-temperature path: squeezed adiabatically, air
        resists more, because it heats up as it shrinks.
      </P>
      <P>
        So ordinary temperature is a poor way to compare air at different heights: it changes whenever a parcel moves up or down. That is what the{' '}
        <b>potential temperature</b> is for — the temperature after an insulated trip to 1,000 hPa. It stays the same however the parcel is squeezed or released,
        and changes only when heat is actually added or removed, so it works like a label the air carries with it.
      </P>
      <P>
        Run it the other way and descending air warms. The chinook, the warm, dry wind that sweeps down the eastern slopes of the Rocky Mountains in winter, owes
        much of its warmth to exactly this: air drawn down from high above the plains, compressed on the way.
      </P>

      <Challenge
        id="a"
        question="Air about 3 kilometers up, where the pressure is 700 hPa, has a temperature of −5 °C. Bring it down to 1,000 hPa without letting any heat in or out. How warm does it arrive?"
        solved={solved}
        status={
          mode !== 'insulated'
            ? 'The descent has to be insulated: choose “Insulated” before you change the pressure.'
            : pHpa === 1000
              ? `The parcel is at 1,000 hPa and ${fmt(tC, 1)} °C. Did it start at 700 hPa and −5 °C?`
              : `Right now the parcel is at ${fmt(pHpa)} hPa and ${fmt(tC, 1)} °C.`
        }
        success={`Solved. Squeezed from 700 to 1,000 hPa, the air warms by ${fmt(arrival - CHINOOK.tC, 1)} °C and arrives at ${fmt(arrival, 1)} °C — bitter cold aloft, a warm wind at the ground, with no heat added on the way. Its potential temperature stayed at ${fmt(CHINOOK_THETA, 1)} K the whole way down.`}
      />

      <P>
        By the label it carries, the −5 °C air at 700 hPa, at a potential temperature of {fmt(CHINOOK_THETA, 1)} K, was always warmer than 15 °C air at
        1,000 hPa, at {fmt(potentialTemperature(15, 1000), 1)} K.
      </P>

      <H2>Rising air cools</H2>
      <P>
        In the atmosphere, pressure falls with height, because the pressure at any level is the weight of all the air above it. In the standard atmosphere — an
        average profile used as a reference — sea level is at 15 °C and 1,013 hPa, the temperature falls by 6.5 °C for every kilometer of height, and the pressure
        is down to half its sea-level value at about {fmt(halfHeight, 1)} km, so half the atmosphere’s mass lies below that height.
      </P>
      <P>
        A parcel that rises therefore expands, and expanding without heat it cools, by about 9.8 °C for every kilometer — the <b>dry adiabatic lapse rate</b>,
        which is simply gravity divided by air’s specific heat. In the next demonstration, a parcel starts at sea level at the same 15 °C as the air around it. Lift it
        with the height slider. The chart on the right compares its temperature, dashed, with the surrounding air’s, solid:
      </P>

      <Figure name="Air Parcel Simulator · rising" scenario={r}>
        <RisingFigure height={height} head={head} />
        <Legend
          items={[
            { label: 'The parcel', color: GRAPHIC.red, kind: 'line', dashed: true },
            { label: 'Surrounding air', color: '#777', kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'pressure', value: `${fmt(lifted.p)} hPa`, tone: WX.pressure },
            { label: 'parcel', value: `${fmt(lifted.parcel, 1)} °C`, tone: WX.temperature },
            { label: 'surrounding air', value: `${fmt(lifted.env, 1)} °C` },
            {
              label: lifted.rhoParcel >= lifted.rhoEnv ? 'denser than its surroundings' : 'lighter than its surroundings',
              value: `${fmt(Math.abs(lifted.rhoParcel / lifted.rhoEnv - 1) * 100, 1)}%`,
              tone: WX.density,
            },
          ]}
        />
        <Slider label="Parcel’s height" value={height} min={0} max={10} step={0.1} onChange={(v) => r.set({ height: v })} display={`${fmt(height, 1)} km`} />
        <Slider
          label="Head start over the surrounding air"
          tone={WX.temperature}
          value={head}
          min={0}
          max={5}
          step={0.5}
          onChange={(v) => r.set({ head: v })}
          display={`+${fmt(head, 1)} °C`}
        />
      </Figure>

      <P>
        Lifted to 1 km, the parcel has cooled to {fmt(at(1).parcel, 1)} °C, while the air around it is at {fmt(at(1).env, 1)} °C. At 3 km it is{' '}
        {fmt(-at(3).gap, 1)} °C colder than its surroundings. The gap grows by a little over 3 °C for every kilometer, because the parcel cools at nearly 10 °C per
        kilometer and the surrounding air only 6.5. At the same pressure, colder means denser: at 3 km the parcel is {fmt((at(3).rhoParcel / at(3).rhoEnv - 1) * 100)}%
        denser than the air around it. Let go of it, and it sinks back toward where it started. Air that resists being lifted this way is called <b>stable</b>.
      </P>
      <P>
        Now give the parcel a head start, as a field baked by the afternoon sun warms the air just above it. A parcel warmer than its surroundings is lighter, and
        it rises on its own. But it cools faster than they do as it climbs, so its lead shrinks with every meter.
      </P>

      <Challenge
        id="b"
        question="Give the parcel a 3 °C head start. Predict first, from how fast the gap grows: what’s the highest it can rise, to the nearest 100 meters, while still no colder than the air around it? Then lift it and check."
        solved={solved2}
        status={
          head !== HEAD_START
            ? 'First set the head start to +3.0 °C.'
            : height === 0
              ? 'Predict first, then lift the parcel.'
              : lifted.gap < 0
                ? `At ${fmt(height, 1)} km the parcel is already colder than its surroundings.`
                : `At ${fmt(height, 1)} km it’s still warmer. Can it go higher?`
        }
        success={`Solved. The parcel loses its 3 °C lead at a little over 3 °C per kilometer, so it runs out just above ${fmt(height * 1000)} m: at ${fmt(height, 1)} km it’s a hair warmer than the air around it, and 100 meters higher it’s colder. A sun-warmed bubble of dry air in a standard atmosphere can’t climb far.`}
      />

      <P>
        In this demonstration, then, the atmosphere is a lid: dry air can be stirred by the sun, but it can’t climb far on its own, and lifted air sinks back. Yet
        clouds tower 10 km high on summer afternoons. Something is missing, and it’s the one ingredient we’ve left out — water. As rising air cools, the water vapor
        it carries condenses, and condensing water releases heat. Part of a real chinook’s warmth comes from the same source, released as the air climbs the far
        side of the mountains. The next lesson is about water vapor: how much the air can hold, and what happens when it holds too much.
      </P>
    </LessonPage>
  );
}
