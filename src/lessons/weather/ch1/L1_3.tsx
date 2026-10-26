import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
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
  useScenario,
} from '../../../framework';
import {
  K0,
  KAPPA,
  condense,
  dewPoint,
  lcl,
  latentWarming,
  mixingRatio,
  moistLapseRate,
  potentialTemperature,
  relativeHumidity,
  satMixingRatio,
  satVaporPressure,
  standardPressure,
  vaporPressure,
} from '../../../engines/weather/thermo';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: a sample of air on the saturation curve.

/** A July afternoon at Fenwick Bay: 30 °C, 14 g/kg of vapor, 1,000 hPa. */
export const AFTERNOON_AIR = { tC: 30, w: 14, p: 1000 };

export interface AirSample {
  /** Temperature the air is brought to, before any condensation, °C. */
  tC: number;
  /** Water vapor, grams per kilogram of dry air. */
  w: number;
  /** Air pressure, hPa. */
  p: number;
}

/** The sample after any excess vapor has condensed: temperature, vapor left and water condensed (g/kg). */
export function airState(s: AirSample) {
  const w = s.w / 1000;
  const e0 = vaporPressure(w, s.p);
  const c = condense(s.tC, w, s.p);
  const e = vaporPressure(c.w, s.p);
  return {
    /** Vapor pressure before condensation, hPa. */
    e0,
    /** Vapor pressure after, hPa. */
    e,
    /** Dew point of the vapor the sample started with, °C. */
    dew0: dewPoint(e0),
    /** Dew point of the vapor left after any condensation, °C: equal to the temperature once saturated. */
    dew: dewPoint(e),
    tC: c.tC,
    vapor: c.w * 1000,
    liquid: c.liquid * 1000,
    rh: Math.min(1, e / satVaporPressure(c.tC)),
    capacity: satMixingRatio(c.tC, s.p) * 1000,
  };
}

/**
 * The first challenge: the afternoon air cooled to within half a degree of its dew point (19.04 °C),
 * so either half-degree step beside it counts: 19.5 °C, where it is 97% saturated, or 19.0 °C,
 * where it is just saturated and a hundredth of a gram per kilogram condenses.
 */
export function dewPointSolved(s: AirSample): boolean {
  if (Math.abs(s.w - AFTERNOON_AIR.w) > 0.05 || s.p !== AFTERNOON_AIR.p) return false;
  const dew = dewPoint(vaporPressure(s.w / 1000, s.p));
  return Math.abs(s.tC - dew) < 0.5;
}

// ---------------------------------------------------------------------------
// The second demonstration: lifting surface air to its cloud base and beyond.

export interface LiftProfile {
  /** Heights, m. */
  z: number[];
  /** The parcel's temperature, °C: dry-adiabatic to the cloud base, moist-adiabatic above. */
  parcel: number[];
  /** What it would be if none of its vapor condensed, °C. */
  dry: number[];
  /** The parcel's dew point, °C (equal to its temperature in the cloud). */
  dew: number[];
  /** Water condensed so far, g/kg. */
  condensed: number[];
  /** The lifting condensation level, m. */
  baseM: number;
}

/**
 * Lift a parcel of surface air (at 1,000 hPa) through the standard atmosphere's pressures. Below
 * the cloud base its potential temperature and its vapor are conserved; above it, it cools at the
 * moist rate and the vapor beyond saturation condenses and falls out.
 */
export function liftProfile(tC: number, dewC: number, topM = 6000, dz = 10): LiftProfile {
  const p0 = 1000;
  const td = Math.min(dewC, tC);
  const w0 = mixingRatio(satVaporPressure(td), p0);
  const theta = potentialTemperature(tC, p0);
  const baseM = lcl(tC, td, p0).heightM;
  const pAt = (zm: number) => (p0 * standardPressure(zm)) / standardPressure(0);
  const out: LiftProfile = { z: [], parcel: [], dry: [], dew: [], condensed: [], baseM };
  let t = tC;
  let pPrev = p0;
  for (let i = 0; i * dz <= topM + 1e-9; i++) {
    const zm = i * dz;
    const p = pAt(zm);
    const tDry = theta * Math.pow(p / 1000, KAPPA) - K0;
    if (zm <= baseM) t = tDry;
    else t -= (moistLapseRate(t, pPrev) * dz) / 1000;
    const cloudy = zm > baseM;
    out.z.push(zm);
    out.parcel.push(t);
    out.dry.push(tDry);
    out.dew.push(cloudy ? t : dewPoint(vaporPressure(w0, p)));
    out.condensed.push(cloudy ? Math.max(0, w0 - satMixingRatio(t, p)) * 1000 : 0);
    pPrev = p;
  }
  return out;
}

/** The second challenge: surface air at 28 °C with its cloud base within 50 m of 1,000 m. */
export const CLOUD_TARGET = { surfaceC: 28, baseM: 1000, toleranceM: 50 };
export function cloudBaseSolved(tC: number, dewC: number): boolean {
  if (tC !== CLOUD_TARGET.surfaceC) return false;
  return Math.abs(lcl(tC, Math.min(dewC, tC), 1000).heightM - CLOUD_TARGET.baseM) <= CLOUD_TARGET.toleranceM;
}

// ---------------------------------------------------------------------------
// Drawing.

const MOIST = GRAPHIC.teal;
const HOT = GRAPHIC.red;
const CX = scale(-20, 40, 64, 616);
const CY = scale(0, 80, 262, 24);
const CURVE_T = Array.from({ length: 121 }, (_, i) => -20 + i * 0.5);

function SaturationChart({ s }: { s: AirSample }) {
  const a = airState(s);
  const condensing = a.liquid > 1e-6;
  const curve = linePath(CURVE_T.map(CX), CURVE_T.map((t) => CY(satVaporPressure(t))));
  const half = linePath(CURVE_T.map(CX), CURVE_T.map((t) => CY(0.5 * satVaporPressure(t))));
  // The region above the curve, where air would hold more vapor than it can.
  const over = `${curve} L${CX(40)} ${CY(80)} L${CX(-20)} ${CY(80)} Z`;
  const px = CX(a.tC);
  const py = CY(a.e);
  const dewX = CX(Math.max(-20, a.dew));
  // Droplets in a sunflower spiral around the point, one per 0.1 g/kg condensed.
  const drops = Math.min(60, Math.round(a.liquid * 10));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 296"
      role="img"
      aria-label={
        condensing
          ? `Air cooled toward ${fmt(s.tC, 1)} °C with ${fmt(s.w, 1)} g/kg of vapor at ${fmt(s.p)} hPa passes its dew point of ${fmt(a.dew0, 1)} °C: ${fmt(a.liquid, 2)} g/kg condenses, and its latent heat leaves the saturated air at ${fmt(a.tC, 1)} °C, which is now its dew point too.`
          : `Air at ${fmt(s.tC, 1)} °C with ${fmt(s.w, 1)} g/kg of vapor at ${fmt(s.p)} hPa: vapor pressure ${fmt(a.e, 1)} hPa against a saturation vapor pressure of ${fmt(satVaporPressure(a.tC), 1)} hPa, a relative humidity of ${fmt(a.rh * 100)}% and a dew point of ${fmt(a.dew, 1)} °C.`
      }
    >
      <text className="ax" x={64} y={12}>
        Vapor pressure, hPa
      </text>
      <path d={over} fill={tint(MOIST, 0.12)} />
      <text className="ax" x={CX(-17)} y={CY(70)} style={{ fill: TEXT.teal }}>
        more vapor than the air can hold: it condenses
      </text>
      <GridY y={CY} ticks={[0, 20, 40, 60, 80]} x0={64} x1={616} baseline={0} />
      <path d={half} fill="none" stroke={MOIST} strokeWidth={1.2} strokeDasharray="4 4" opacity={0.8} />
      <text className="ax ax-e" x={CX(40) - 4} y={CY(0.5 * satVaporPressure(40)) + 16}>
        50% relative humidity
      </text>
      <path d={curve} fill="none" stroke={MOIST} strokeWidth={3} />
      <text className="ax ax-e" x={CX(33) - 8} y={CY(satVaporPressure(33)) - 4} style={{ fill: TEXT.teal, fontWeight: 600 }}>
        saturation
      </text>
      {condensing ? (
        <g>
          <circle cx={CX(s.tC)} cy={CY(a.e0)} r={6} fill="#fcfcfb" stroke="#555" strokeWidth={1.5} strokeDasharray="2 2" />
          <line x1={CX(s.tC)} y1={CY(a.e0)} x2={px} y2={py} stroke="#555" strokeWidth={1.5} />
          {Array.from({ length: drops }, (_, k) => {
            const ang = k * 2.39996;
            const r = 9 + 3.2 * Math.sqrt(k);
            return <circle key={k} cx={px + r * Math.cos(ang)} cy={py + r * Math.sin(ang)} r={2.2} fill={MOIST} opacity={0.7} />;
          })}
          <circle cx={px} cy={py} r={7} fill={HOT} stroke="#fcfcfb" strokeWidth={2} />
          <text className="lab" x={px + 12} y={py + 26}>
            {fmt(a.liquid, 2)} g/kg condensed · {fmt(a.tC, 1)} °C
          </text>
        </g>
      ) : (
        <g>
          {/* Room for more vapor: up to the curve at this temperature. */}
          <line x1={px} y1={py} x2={px} y2={CY(satVaporPressure(a.tC))} stroke={MOIST} strokeWidth={1.5} strokeDasharray="2 3" />
          {/* Cooling at constant vapor: across to the dew point. */}
          {a.dew > -20 && <line x1={px} y1={py} x2={dewX} y2={py} stroke="#555" strokeWidth={1.2} strokeDasharray="5 4" />}
          {a.dew > -20 && <circle cx={dewX} cy={py} r={4.5} fill={MOIST} />}
          {a.dew > -20 && (
            <text className="lab" x={dewX - 8} y={py - 8} textAnchor="end" style={{ fill: TEXT.teal }}>
              dew point {fmt(a.dew, 1)} °C
            </text>
          )}
          <circle cx={px} cy={py} r={7} fill={HOT} stroke="#fcfcfb" strokeWidth={2} />
        </g>
      )}
      {[-20, -10, 0, 10, 20, 30, 40].map((t) => (
        <text key={t} className="ax ax-m" x={CX(t)} y={280}>
          {t === 40 ? '' : `${t}°`}
        </text>
      ))}
      <text className="ax ax-e" x={616} y={280}>
        temperature, °C
      </text>
    </svg>
  );
}

const LX = scale(-50, 40, 64, 616);
const LY = scale(0, 6000, 300, 22);

function LiftChart({ prof, topM, surfaceC }: { prof: LiftProfile; topM: number; surfaceC: number }) {
  const i = Math.round(topM / 10);
  const baseInView = prof.baseM <= 6000;
  const xs = (arr: number[], upTo = arr.length) => arr.slice(0, upTo).map(LX);
  const zs = (upTo: number) => prof.z.slice(0, upTo).map(LY);
  const baseIdx = Math.min(prof.z.length, Math.round(prof.baseM / 10) + 1);
  const cloudTop = topM > prof.baseM ? topM : null;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`Air lifted from the surface at ${fmt(surfaceC, 1)} °C to ${fmt(topM)} m. Its cloud base is at ${fmt(prof.baseM)} m. At the top it is ${fmt(prof.parcel[i], 1)} °C, against ${fmt(prof.dry[i], 1)} °C had none of its vapor condensed, and ${fmt(prof.condensed[i], 1)} g/kg of water has condensed.`}
    >
      <text className="ax" x={64} y={12}>
        Height, m
      </text>
      <GridY y={LY} ticks={[0, 1000, 2000, 3000, 4000, 5000, 6000]} x0={64} x1={616} format={(v) => fmt(v)} baseline={0} />
      {cloudTop !== null && (
        <g>
          <rect x={LX(prof.parcel[i]) - 70} y={LY(cloudTop)} width={140} height={LY(prof.baseM) - LY(cloudTop)} rx={18} fill="#eef1f3" stroke="#c9d2d8" />
          <text className="ax ax-m" x={LX(prof.parcel[i])} y={LY((cloudTop + prof.baseM) / 2) + 4}>
            cloud
          </text>
        </g>
      )}
      {baseInView && (
        <g>
          <line x1={64} x2={616} y1={LY(prof.baseM)} y2={LY(prof.baseM)} stroke={MOIST} strokeWidth={1.2} strokeDasharray="6 4" />
          <text className="lab" x={612} y={LY(prof.baseM) - 6} textAnchor="end" style={{ fill: TEXT.teal }}>
            cloud base {fmt(prof.baseM)} m
          </text>
        </g>
      )}
      <path d={linePath(xs(prof.dry), zs(prof.dry.length))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={linePath(xs(prof.parcel), zs(prof.parcel.length))} fill="none" stroke={HOT} strokeWidth={1.5} opacity={0.3} />
      <path d={linePath(xs(prof.dew, baseIdx), zs(baseIdx))} fill="none" stroke={MOIST} strokeWidth={2.5} />
      <path d={linePath(xs(prof.parcel, i + 1), zs(i + 1))} fill="none" stroke={HOT} strokeWidth={3} />
      <circle cx={LX(prof.parcel[i])} cy={LY(topM)} r={6.5} fill={HOT} stroke="#fcfcfb" strokeWidth={2} />
      {[-40, -20, 0, 20, 40].map((t) => (
        <text key={t} className="ax ax-m" x={LX(t)} y={318}>
          {t === 40 ? '' : `${t}°`}
        </text>
      ))}
      <text className="ax ax-e" x={616} y={318}>
        temperature, °C
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('air', { ...AFTERNOON_AIR });
  const a = airState(s.state);
  const condensing = a.liquid > 1e-6;
  const solved = dewPointSolved(s.state);
  const es = satVaporPressure(a.tC);

  const l = useScenario('lift', { surfaceC: 25, dewC: 15, topM: 3000 });
  const { surfaceC, dewC, topM } = l.state;
  const prof = useMemo(() => liftProfile(surfaceC, dewC), [surfaceC, dewC]);
  const top = Math.round(topM / 10);
  const solved2 = cloudBaseSolved(surfaceC, dewC);

  // Numbers quoted in the prose.
  const afternoon = airState(AFTERNOON_AIR);
  const dawn = airState({ ...AFTERNOON_AIR, tC: 20 });
  const cooled = airState({ ...AFTERNOON_AIR, tC: 15 });
  const nearDew = airState({ ...AFTERNOON_AIR, tC: 19.5 });
  const atDew = airState({ ...AFTERNOON_AIR, tC: 19 });
  const at850 = dewPoint(vaporPressure(AFTERNOON_AIR.w / 1000, 850));
  const ref = liftProfile(25, 15);
  const ref3k = 300;
  const dewAt1k = ref.dew[100];

  let caption: string;
  if (condensing)
    caption = `Cooled toward ${fmt(s.state.tC, 1)} °C, this air couldn’t hold all its vapor. The heat released as it condenses leaves the air at ${fmt(a.tC, 1)} °C, saturated: its dew point now.`;
  else caption = 'The dashed line shows this air cooling with nothing added or removed. Where it meets the curve, at the dew point, the air would be saturated.';

  return (
    <LessonPage id="weather/1.3">
      <P>
        The parcels of <a href={lessonHref('weather/1.2')}>the previous lesson</a> were dry air. Real air always carries some water vapor — from a fraction of a gram
        per kilogram in a polar winter to about 20 grams in the humid tropics — and that small ingredient does much of what makes weather. Water is the one substance in
        the atmosphere that changes phase at the temperatures we live at. It evaporates from the sea, travels as an invisible gas, and condenses into dew, fog,
        cloud and rain. Each change of phase takes in or gives out a great deal of energy.
      </P>
      <P>
        We saw that rising air expands and cools. This lesson asks what cooling does to the water vapor in it. Water molecules are always escaping from any water
        surface and always returning to it. Air above the water is <b>saturated</b> when as many molecules return as escape, and the pressure the vapor exerts at that
        point — its share of the air’s pressure — is the <K tone={WX.moisture}>saturation vapor pressure</K>. It depends only on the{' '}
        <K tone={WX.temperature}>temperature</K>, and it rises steeply with it, because warmer molecules escape more easily. (Strictly it’s a property of water, not
        of air, but “how much vapor the air can hold” is a convenient shorthand.) The vapor actually present we’ll measure by its <b>mixing ratio</b>: grams of water
        vapor per kilogram of dry air. Heating, cooling or lifting air doesn’t change it; only condensation or evaporation does.
      </P>
      <P>
        In the next demonstration, the teal curve is the saturation vapor pressure at each temperature, and the red dot is a sample of air, placed by its temperature
        and its <b>vapor pressure</b>, the pressure its vapor exerts. It starts as a humid July afternoon at Fenwick Bay: 30 °C, with 14 grams of vapor per kilogram, at 1,000 hPa. Change the
        temperature, the amount of water vapor and the air’s pressure:
      </P>

      <Figure name="Humidity Lab" scenario={s}>
        <SaturationChart s={s.state} />
        <Legend
          items={[
            { label: 'Saturation vapor pressure', color: MOIST, kind: 'line' },
            { label: 'Half saturated', color: MOIST, kind: 'line', dashed: true },
            { label: 'The air sample', color: HOT },
          ]}
        />
        <Readouts
          items={[
            { label: 'relative humidity', value: `${fmt(a.rh * 100)}%`, tone: WX.moisture },
            condensing
              ? { label: 'condensed, warming the air', value: `${fmt(a.liquid, 2)} g/kg · +${fmt(a.tC - s.state.tC, 1)} °C`, tone: WX.temperature }
              : { label: 'most it could hold', value: `${fmt(a.capacity, 1)} g/kg`, tone: WX.moisture },
          ]}
        />
        <Slider label="Temperature" tone={WX.temperature} value={s.state.tC} min={-20} max={40} step={0.5} onChange={(v) => s.set({ tC: v })} display={`${fmt(s.state.tC, 1)} °C`} />
        <Slider label="Water vapor" tone={WX.moisture} value={s.state.w} min={0.5} max={30} step={0.1} onChange={(v) => s.set({ w: v })} display={`${fmt(s.state.w, 1)} g/kg`} />
        <Slider label="Air pressure" tone={WX.pressure} value={s.state.p} min={500} max={1050} step={10} onChange={(v) => s.set({ p: v })} display={`${fmt(s.state.p)} hPa`} />
        <Eq label={`Saturation vapor pressure at ${fmt(a.tC, 1)} degrees: ${fmt(es, 1)} hectopascals`}>
          <K tone={WX.moisture}>
            e<Sub>s</Sub>
          </K>
          <Op>=</Op>
          <span>6.112 hPa × e</span>
          <Sup>
            17.67 × {fmt(a.tC, 1)} / ({fmt(a.tC, 1)} + 243.5)
          </Sup>
          <Op>=</Op>
          <K tone={WX.moisture}>{fmt(es, 1)} hPa</K>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The curve is steep. In this model, air at 1,000 hPa can hold {fmt(satMixingRatio(30, 1000) * 1000, 1)} g/kg of vapor at 30 °C,{' '}
        {fmt(satMixingRatio(0, 1000) * 1000, 1)} g/kg at 0 °C and only {fmt(satMixingRatio(-20, 1000) * 1000, 1)} g/kg at −20 °C. The saturation vapor pressure
        rises by roughly 6–7% for every degree at everyday temperatures, so it nearly doubles with every 10 °C. That’s why heated indoor air is so dry in winter: take saturated outdoor air at 0 °C,
        warm it to 20 °C without adding water, and its relative humidity falls to about {fmt(relativeHumidity(20, 0) * 100)}%.
      </P>
      <P>
        The <K tone={WX.moisture}>relative humidity</K> is the vapor pressure as a share of the saturation vapor pressure — in the chart, the dot’s height as a share
        of the curve’s height at the same temperature. The afternoon air is at {fmt(afternoon.rh * 100)}%. Now cool it, as the evening does, without adding or
        removing any water. The dot slides straight left, and its relative humidity climbs: at 20 °C it’s {fmt(dawn.rh * 100)}%, though not a gram of water has
        been added. Relative humidity measures the air’s temperature as much as its moisture, which is why it’s usually highest around dawn, the coolest time of day,
        and lowest in mid-afternoon.
      </P>
      <P>
        The moisture itself is better measured by the <K tone={WX.moisture}>dew point</K>: the temperature at which the air’s vapor would saturate it, where the
        dashed line meets the curve. Cooling the air doesn’t move it — only adding or removing vapor does — so it stays put all evening as the temperature falls
        toward it.
      </P>

      <Challenge
        id="a"
        question={`The afternoon air holds 14 g/kg of vapor, about half the ${fmt(satMixingRatio(30, 1000) * 1000, 1)} g/kg it could hold at 30 °C. Predict first, from how fast the curve climbs: about how cool must the evening get before this air is saturated? Then cool it to its dew point, to within half a degree.`}
        solved={solved}
        status={
          Math.abs(s.state.w - AFTERNOON_AIR.w) > 0.05 || s.state.p !== AFTERNOON_AIR.p
            ? 'First set the water vapor back to 14 g/kg and the pressure to 1,000 hPa.'
            : s.state.tC >= AFTERNOON_AIR.tC
              ? 'Predict first, then cool the air.'
              : condensing
                ? 'Vapor is condensing: that’s past the dew point.'
                : 'Not saturated yet. Keep cooling.'
        }
        success={`Solved. The air holds about half what it could at 30 °C, so it saturates where the curve has fallen to about half its height. The curve only nearly doubles every 10 °C, so that takes a little more than 10 °C of cooling: the dew point is ${fmt(afternoon.dew, 2)} °C. At 19.5 °C the air is ${fmt(nearDew.rh * 100)}% saturated; at 19.0 °C it just passes saturation, and ${fmt(atDew.liquid, 2)} g/kg — the first droplets — condenses. A summer night at Fenwick Bay that cools below about 19 °C brings dew or fog.`}
      />

      <P>
        Pressure matters too, a little. At a lower pressure the same grams of vapor exert less vapor pressure, so the same air at 850 hPa has a dew point of{' '}
        {fmt(at850, 1)} °C instead of {fmt(afternoon.dew, 1)}. Rising air, as we’ll see, carries its dew point down with it.
      </P>
      <P>
        Cool the air past its dew point and it can no longer hold all its vapor. The excess condenses — on grass as dew, on dust and salt particles in the air as the
        droplets of fog and cloud. Drag the temperature down to 15 °C. The dot doesn’t stop at 15 °C, because condensing water releases heat: {fmt(cooled.liquid, 1)}{' '}
        g/kg condenses, and the heat it gives up leaves the air at {fmt(cooled.tC, 1)} °C, saturated, on the curve. Its dew point has fallen to the same{' '}
        {fmt(cooled.dew, 1)} °C, because less vapor is left. The slider sets how far we try to cool the air; the latent heat pushes back.
      </P>

      <H2>Latent heat</H2>
      <P>
        Evaporating a kilogram of water takes about 2.5 million joules, the <K tone={WX.energy}>latent heat</K> of vaporization, and condensing it gives the same energy
        back. Spread through a kilogram of air, each gram of vapor that condenses releases enough to warm it by about {fmt(latentWarming(0.001), 1)} °C. So water vapor
        is a store of energy as well as of water. Sunlight absorbed by the sea goes into the vapor as the water evaporates, travels with the air, and comes out wherever
        the vapor condenses, often thousands of kilometers away. A substantial share of the heat the atmosphere carries poleward, in{' '}
        <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>’s transport, travels this way.
      </P>
      <P>
        The most common way air is cooled to its dew point isn’t a cold night but lifting. In the next demonstration, a parcel of surface air is pushed upward. The red
        line is its temperature, the teal line its dew point, and the dashed gray line the temperature it would have if none of its vapor condensed. Set the surface
        temperature and dew point, and how high to lift it:
      </P>

      <Figure name="Humidity Lab · lifting" scenario={l}>
        <LiftChart prof={prof} topM={topM} surfaceC={surfaceC} />
        <Legend
          items={[
            { label: 'Parcel temperature', color: HOT, kind: 'line' },
            { label: 'Parcel dew point', color: MOIST, kind: 'line' },
            { label: 'If nothing condensed', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'temperature at the top', value: `${fmt(prof.parcel[top], 1)} °C`, tone: WX.temperature },
            { label: 'if nothing condensed', value: `${fmt(prof.dry[top], 1)} °C`, tone: WX.temperature },
            { label: 'water condensed', value: `${fmt(prof.condensed[top], 1)} g/kg`, tone: WX.moisture },
          ]}
        />
        <Slider label="Surface temperature" tone={WX.temperature} value={surfaceC} min={10} max={35} step={0.5} onChange={(v) => l.set({ surfaceC: v })} display={`${fmt(surfaceC, 1)} °C`} />
        <Slider
          label="Surface dew point"
          tone={WX.moisture}
          value={dewC}
          min={-5}
          max={30}
          step={0.5}
          onChange={(v) => l.set({ dewC: v })}
          display={dewC > surfaceC ? `${fmt(surfaceC, 1)} °C, saturated` : `${fmt(dewC, 1)} °C`}
        />
        <Slider label="Lift to" value={topM} min={0} max={6000} step={100} onChange={(v) => l.set({ topM: v })} display={`${fmt(topM)} m`} />
      </Figure>

      <P>
        Below the cloud base the parcel is unsaturated, so it cools at the dry adiabatic rate of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a>, almost 10 °C per
        kilometer. Its dew point falls too, but only by about {fmt(ref.dew[0] - dewAt1k, 1)} °C in the first kilometer, because the same grams of vapor exert less
        pressure as the air expands. The two lines close in on each other at about 8 °C per kilometer, so the parcel saturates roughly 120 m up for every degree its
        surface temperature exceeds its dew point. (Meteorologists often round it to 125 m.) That height is the <b>lifting condensation level</b>, and it’s why
        fair-weather cumulus clouds have flat bases: the air feeding them comes from the same surface layer, and saturates at the same height. Starting from 25 °C
        with a dew point of 15 °C, the base is at {fmt(ref.baseM)} m.
      </P>
      <P>
        Above the base the parcel is in cloud, and it cools more slowly, because every gram of vapor that condenses pays back its latent heat. The <b>moist adiabatic
        lapse rate</b> is around 4 °C per kilometer in warm, humid air near the ground and approaches the dry rate in cold air high up, which has little vapor left to
        condense. Lifted to 3,000 m, the starting parcel has condensed {fmt(ref.condensed[ref3k], 1)} g/kg of water and is {fmt(ref.parcel[ref3k], 1)} °C, where dry air
        would have cooled to {fmt(ref.dry[ref3k], 1)} °C — about {fmt(ref.parcel[ref3k] - ref.dry[ref3k])} °C warmer, close to the{' '}
        {fmt(latentWarming(ref.condensed[ref3k] / 1000), 1)} °C that much condensation releases. Compare <FigRef to="Humidity Lab">the first demonstration</FigRef>:
        it’s the same physics, played out in height instead of over an evening.
      </P>

      <Challenge
        id="b"
        question="On a summer morning the surface air is 28 °C. Predict first, with the 120 m rule: what dew point puts the base of the clouds that form when it’s lifted at 1,000 m? Then set it and check, to within 50 m."
        solved={solved2}
        status={
          surfaceC !== CLOUD_TARGET.surfaceC
            ? 'First set the surface temperature to 28 °C.'
            : prof.baseM > CLOUD_TARGET.baseM
              ? 'The cloud base is too high: this air is too dry.'
              : 'The cloud base is too low: this air is too moist.'
        }
        success={`Solved. A 1,000 m base needs the air to be about 1,000 ÷ 120 ≈ 8 °C warmer than its dew point. Here the dew point is ${fmt(Math.min(dewC, surfaceC), 1)} °C and the base is at ${fmt(prof.baseM)} m. Moister air would make lower clouds; drier air, higher ones.`}
      />

      <P>
        A cloudy parcel, then, cools more slowly than a clear one, and the more vapor it started with, the more slowly it cools. That matters as soon as we ask
        whether lifted air keeps rising on its own. It will if it stays warmer, and so lighter, than the air around it — and latent heat can keep it warmer. That
        question, of stability, and the convection and thunderstorms it leads to, is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
