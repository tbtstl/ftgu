import { useId, useMemo } from 'react';
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
  beamHeightKm,
  beamWidthKm,
  brightnessTempC,
  cloudEmissivity,
  inferredTopKm,
  radarLook,
  reflectivityOfRain,
  stormDbz,
  toDbz,
  type StormColumn,
} from '../../../engines/weather/remote';
import { STATIONS } from '../../../model/weather/region';
import { useProgress } from '../../../course/progress';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: Fenwick Bay's radar and a storm.

/** Half-width of the demonstration's storm, km. */
export const STORM_RADIUS_KM = 10;
/** Echo top of the demonstration's storm, km. */
export const STORM_TOP_KM = 10;
/** The melting layer: the bright band sits in the 0.4 km just under the freezing level. */
export const MELT_DEPTH_KM = 0.4;
/** The radar's lowest scan, degrees. */
export const LOWEST_ELEV = 0.5;
export const RANGE_STEP = 5;
/**
 * Rain rate at the ground under the storm's core, mm/h. Fixed: the bright band and the ice change
 * the reflectivity by set factors, so the radar's percentage error is the same at any rain rate.
 */
export const STORM_RAIN_MMH = 30;

export interface RadarState {
  /** Distance from the radar to the storm, km. */
  rangeKm: number;
  /** Beam elevation angle, degrees. */
  elevDeg: number;
  /** Height of the 0 °C level, km. */
  freezingKm: number;
}

export const RADAR_DEFAULTS: RadarState = { rangeKm: 150, elevDeg: 0.5, freezingKm: 3 };

export function stormOf(s: RadarState, rainMmH = STORM_RAIN_MMH): StormColumn {
  return { rangeKm: s.rangeKm, radiusKm: STORM_RADIUS_KM, rainMmH, freezingKm: s.freezingKm, topKm: STORM_TOP_KM };
}

/** Height of the top edge of the beam at a range, km. */
export function beamTopKm(rangeKm: number, elevDeg: number): number {
  return beamHeightKm(rangeKm, elevDeg) + beamWidthKm(rangeKm) / 2;
}

/** The challenge's freezing level, km: a winter one, lower than the starting 3 km the prose explores. */
export const CHALLENGE_FREEZING_KM = 2;

/** The farthest storm, on the slider's 5 km steps, whose whole beam on a scan stays under the melting layer, km. */
export function rainLimitKm(freezingKm: number, elevDeg = LOWEST_ELEV): number {
  let lim = 0;
  for (let r = 20; r <= 360; r += RANGE_STEP) if (beamTopKm(r, elevDeg) <= freezingKm - MELT_DEPTH_KM) lim = r;
  return lim;
}

/**
 * The first challenge: with the lowest scan and a 2 km freezing level, the farthest storm (to the
 * slider's 5 km steps) whose whole beam stays in the rain, under the melting layer: 70 km.
 */
export function rainBeamSolved(s: RadarState): boolean {
  if (Math.abs(s.elevDeg - LOWEST_ELEV) > 1e-9 || Math.abs(s.freezingKm - CHALLENGE_FREEZING_KM) > 1e-9) return false;
  const limit = s.freezingKm - MELT_DEPTH_KM;
  return beamTopKm(s.rangeKm, s.elevDeg) <= limit && beamTopKm(s.rangeKm + RANGE_STEP, s.elevDeg) > limit;
}

/** Shares of the beam over the storm that lie in rain, in the melting layer, in ice, and over the top. */
export function beamShares(s: RadarState): { rain: number; melt: number; ice: number; above: number } {
  const h = beamHeightKm(s.rangeKm, s.elevDeg);
  const w = beamWidthKm(s.rangeKm);
  const lo = h - w / 2;
  const hi = h + w / 2;
  const part = (a: number, b: number) => Math.max(0, Math.min(hi, b) - Math.max(lo, a)) / w;
  const f = s.freezingKm;
  return { rain: part(-1e9, f - MELT_DEPTH_KM), melt: part(f - MELT_DEPTH_KM, f), ice: part(f, STORM_TOP_KM), above: part(STORM_TOP_KM, 1e9) };
}

/** Distance from Fenwick Bay to another station on the region map (1 unit ≈ 1 km). */
function distanceKm(id: 'marlow' | 'ridge'): number {
  const a = STATIONS.fenwick;
  const b = STATIONS[id];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export const RIDGE_KM = distanceKm('ridge');
export const MARLOW_KM = distanceKm('marlow');

/** Standard radar colors, from light rain to downpour. */
function dbzColor(dbz: number): string | null {
  if (!Number.isFinite(dbz) || dbz < 20) return null;
  if (dbz < 30) return '#bfe2b4';
  if (dbz < 40) return '#74c063';
  if (dbz < 45) return '#efd24f';
  if (dbz < 50) return '#ef9f3f';
  return '#df5a48';
}

const DBZ_LEGEND = [
  { label: '20–30 dBZ', color: '#bfe2b4' },
  { label: '30–40', color: '#74c063' },
  { label: '40–45', color: '#efd24f' },
  { label: '45–50', color: '#ef9f3f' },
  { label: '50+', color: '#df5a48' },
];

const RX = scale(0, 360, 56, 616);
const RY = scale(0, 15, 292, 24);
const BEAM = '#4a4a4a';

function RadarSection({ s }: { s: RadarState }) {
  const clip = 'rs' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const storm = stormOf(s);
  const look = radarLook(storm, s.elevDeg);
  const cells = useMemo(() => {
    const out: Array<{ x: number; z: number; color: string }> = [];
    for (let x = s.rangeKm - STORM_RADIUS_KM; x < s.rangeKm + STORM_RADIUS_KM; x += 1) {
      for (let z = 0; z < STORM_TOP_KM; z += 0.25) {
        const c = dbzColor(stormDbz(storm, x + 0.5, z + 0.125));
        if (c) out.push({ x, z, color: c });
      }
    }
    return out;
  }, [s.rangeKm, s.freezingKm]);
  const ranges = Array.from({ length: 73 }, (_, i) => i * 5);
  const center = ranges.map((r) => beamHeightKm(r, s.elevDeg));
  const upper = ranges.map((r, i) => Math.min(15, center[i] + beamWidthKm(r) / 2));
  const lower = ranges.map((r, i) => Math.max(0, center[i] - beamWidthKm(r) / 2));
  const band =
    linePath(
      ranges.map(RX),
      upper.map(RY),
    ) +
    ' ' +
    [...ranges]
      .reverse()
      .map((r, k) => `L${RX(r).toFixed(1)} ${RY(lower[ranges.length - 1 - k]).toFixed(1)}`)
      .join(' ') +
    ' Z';
  const lo = Math.max(0, look.beamKm - look.widthKm / 2);
  const hi = look.beamKm + look.widthKm / 2;
  const sx = RX(s.rangeKm);
  const reading = Number.isFinite(look.dbz) ? `${fmt(look.dbz, 1)} dBZ, an estimate of ${fmt(look.estimatedMmH, 1)} mm/h` : 'nothing';
  return (
    <svg
      className="chart"
      viewBox="0 0 640 336"
      role="img"
      aria-label={`A storm ${fmt(s.rangeKm)} km from Fenwick Bay’s radar, raining ${fmt(STORM_RAIN_MMH)} mm/h at the ground, with the freezing level at ${fmt(s.freezingKm, 1)} km. The beam, raised ${fmt(s.elevDeg, 1)}°, passes over the storm ${fmt(look.beamKm, 1)} km up and ${fmt(look.widthKm, 1)} km wide, and the radar reads ${reading}.`}
    >
      <text className="ax" x={56} y={14}>
        Height above the ground
      </text>
      <GridY y={RY} ticks={[0, 3, 6, 9, 12, 15]} x0={56} x1={616} format={(v) => `${v} km`} baseline={0} />
      {/* The freezing level runs across the whole atmosphere. */}
      <line x1={56} x2={616} y1={RY(s.freezingKm)} y2={RY(s.freezingKm)} stroke={GRAPHIC.blue} strokeWidth={1.2} strokeDasharray="6 4" />
      <text className="ax" x={612} y={RY(s.freezingKm) - 5} textAnchor="end" style={{ fill: TEXT.blue }}>
        0 °C
      </text>
      {/* The storm's reflectivity, cell by cell. */}
      {cells.map((c, i) => (
        <rect key={i} x={RX(c.x)} y={RY(c.z + 0.25)} width={RX(1) - RX(0) + 0.3} height={RY(0) - RY(0.25) + 0.3} fill={c.color} />
      ))}
      {/* The beam: its centerline and its width, clipped to the chart. */}
      <defs>
        <clipPath id={clip}>
          <rect x={56} y={RY(15)} width={560} height={RY(0) - RY(15)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path d={band} fill={BEAM} opacity={0.1} />
        <path d={linePath(ranges.map(RX), center.map(RY))} fill="none" stroke={BEAM} strokeWidth={1.5} strokeDasharray="5 3" />
      </g>
      {/* What the beam samples over the storm. */}
      {!look.overshoots && <line x1={sx} x2={sx} y1={RY(Math.min(15, hi))} y2={RY(lo)} stroke="#222" strokeWidth={3} strokeLinecap="round" />}
      {look.beamKm <= 15 && <circle cx={sx} cy={RY(look.beamKm)} r={4} fill="#222" />}
      {/* The radar. */}
      <path d={`M${RX(0) - 7} ${RY(0)} L${RX(0)} ${RY(0) - 14} L${RX(0) + 7} ${RY(0)} Z`} fill="#555" />
      <circle cx={RX(0)} cy={RY(0) - 16} r={5} fill="#fcfcfb" stroke="#555" strokeWidth={2} />
      {/* Stations along the way. */}
      {[
        { km: RIDGE_KM, name: 'Hollin Ridge' },
        { km: MARLOW_KM, name: 'Marlow' },
      ].map((m) => (
        <g key={m.name}>
          <line x1={RX(m.km)} x2={RX(m.km)} y1={RY(0)} y2={RY(0) + 6} stroke="#777" strokeWidth={1.5} />
          <text className="ax ax-m" x={Math.min(RX(m.km), 600)} y={RY(0) + 30}>
            {m.name}
          </text>
        </g>
      ))}
      {[0, 50, 100, 150, 200, 250, 300, 350].map((r) => (
        <text key={r} className="ax ax-m" x={RX(r)} y={RY(0) + 16}>
          {r}
        </text>
      ))}
      <text className="ax" x={RX(0) - 4} y={RY(0) + 30}>
        radar
      </text>
      <text className="ax ax-e" x={616} y={RY(0) + 42}>
        distance from Fenwick Bay’s radar, km
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: an infrared satellite looking down on a cloud.

export interface SatState {
  /** Cloud-top height, km. */
  topKm: number;
  /** The cloud's optical depth in the infrared. */
  tau: number;
}

export const SAT_DEFAULTS: SatState = { topKm: 10, tau: 0.5 };
/** The ground under the cloud, °C. (Its temperature hardly matters: the profile, and the cloud top, move with it.) */
export const SAT_GROUND_C = 20;
/** The lapse rate the atmosphere has here, and the one the satellite's retrieval assumes, °C per km. */
export const SAT_LAPSE = 6.5;

export function satView(s: SatState, groundC = SAT_GROUND_C) {
  const cloudC = groundC - SAT_LAPSE * s.topKm;
  const emissivity = cloudEmissivity(s.tau);
  const brightnessC = brightnessTempC(groundC, cloudC, emissivity);
  const inferredKm = inferredTopKm(brightnessC, groundC, SAT_LAPSE);
  return { cloudC, emissivity, brightnessC, inferredKm, errorKm: s.topKm - inferredKm };
}

/** The second challenge's cloud: a top at 10 km. */
export const OPAQUE_TARGET = { topKm: 10, withinKm: 1 };

/**
 * The most of the ground's infrared that can leak through a cloud with its top at `topKm` while the
 * satellite still places it within `withinKm`: the blend may be at most SAT_LAPSE × withinKm warmer
 * than the top, and σT⁴ weights the warm ground heavily.
 */
export function maxLeak(topKm: number, withinKm: number, groundC = SAT_GROUND_C): number {
  const k = (c: number) => (c + 273.15) ** 4;
  const cloudC = groundC - SAT_LAPSE * topKm;
  return (k(cloudC + SAT_LAPSE * withinKm) - k(cloudC)) / (k(groundC) - k(cloudC));
}

/** The second challenge: the thinnest cloud (to 0.1 of optical depth) the satellite places within 1 km of its true top. */
export function opaqueSolved(s: SatState): boolean {
  if (s.topKm !== OPAQUE_TARGET.topKm) return false;
  const tau = Math.round(s.tau * 10) / 10;
  const ok = (t: number) => satView({ ...s, tau: t }).errorKm <= OPAQUE_TARGET.withinKm;
  return ok(tau) && (tau <= 0 || !ok(Math.round((tau - 0.1) * 10) / 10));
}

const SY = scale(0, 14, 300, 34);
const TX = scale(-80, 40, 352, 616);

function SatelliteColumn({ s }: { s: SatState }) {
  const v = satView(s);
  const through = 1 - v.emissivity;
  const cloudY = SY(s.topKm);
  const depthKm = Math.min(s.topKm - 0.3, 0.6 + 0.35 * Math.min(6, s.tau));
  const line = [0, 14].map((z) => SAT_GROUND_C - SAT_LAPSE * z);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 336"
      role="img"
      aria-label={`A cloud with its top at ${fmt(s.topKm, 1)} km (${fmt(v.cloudC)} °C) and an infrared optical depth of ${fmt(s.tau, 1)}, over ground at ${fmt(SAT_GROUND_C)} °C. It lets ${fmt(through * 100)}% of the ground’s infrared through. The satellite measures a brightness temperature of ${fmt(v.brightnessC, 1)} °C and, assuming an opaque cloud, places its top at ${fmt(v.inferredKm, 1)} km.`}
    >
      {/* The column. */}
      <rect x={40} y={SY(0)} width={250} height={22} fill="#e7e1d3" />
      <text className="lab" x={48} y={SY(0) + 16}>
        Ground · {fmt(SAT_GROUND_C)} °C
      </text>
      <rect
        x={70}
        y={cloudY}
        width={190}
        height={Math.max(6, SY(s.topKm - depthKm) - cloudY)}
        rx={14}
        fill={tint('#9aa6b0', 0.25 + 0.75 * v.emissivity)}
        stroke="#b8c0c7"
      />
      <text className="ax ax-m" x={165} y={cloudY + Math.max(6, SY(s.topKm - depthKm) - cloudY) / 2 + 4} style={{ fill: v.emissivity > 0.6 ? '#fcfcfb' : '#555' }}>
        cloud top {fmt(v.cloudC)} °C
      </text>
      {/* Infrared from the ground passing through, and from the cloud top. */}
      <line x1={110} x2={110} y1={SY(0)} y2={46} stroke={GRAPHIC.red} strokeWidth={1 + 9 * through} opacity={0.3 + 0.6 * through} />
      <line x1={220} x2={220} y1={cloudY} y2={46} stroke={GRAPHIC.red} strokeWidth={1 + 9 * v.emissivity} opacity={0.3 + 0.6 * v.emissivity} />
      <text className="ax ax-m" x={110} y={SY(0) - 8}>
        from the ground · {fmt(through * 100)}%
      </text>
      <text className="ax ax-m" x={220} y={cloudY - 8}>
        from the cloud · {fmt(v.emissivity * 100)}%
      </text>
      {/* The satellite. */}
      <rect x={150} y={14} width={30} height={16} rx={2} fill="#555" />
      <rect x={118} y={18} width={28} height={8} fill="#8fa7c0" />
      <rect x={184} y={18} width={28} height={8} fill="#8fa7c0" />
      <text x={222} y={27} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.red }}>
        sees {fmt(v.brightnessC, 1)} °C
      </text>

      {/* The temperature profile, and what the satellite infers from it. */}
      <text className="ax" x={352} y={20}>
        Temperature against height
      </text>
      {[-80, -40, 0, 40].map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={TX(t)} x2={TX(t)} y1={34} y2={300} />
          <text className="ax ax-m" x={TX(t)} y={318}>
            {t} °C
          </text>
        </g>
      ))}
      {[0, 4, 8, 12].map((z) => (
        <text key={z} className="ax ax-e" x={346} y={SY(z) + 4}>
          {z} km
        </text>
      ))}
      <path d={linePath(line.map(TX), [0, 14].map(SY))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} />
      {/* Brightness temperature, read across to the profile. */}
      <line x1={TX(v.brightnessC)} x2={TX(v.brightnessC)} y1={300} y2={SY(v.inferredKm)} stroke={GRAPHIC.blue} strokeWidth={1.2} strokeDasharray="4 3" />
      <line x1={TX(v.brightnessC)} x2={352} y1={SY(v.inferredKm)} y2={SY(v.inferredKm)} stroke={GRAPHIC.blue} strokeWidth={1.2} strokeDasharray="4 3" />
      <circle cx={TX(v.brightnessC)} cy={SY(v.inferredKm)} r={5} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={2} />
      <circle cx={TX(v.cloudC)} cy={SY(s.topKm)} r={6} fill="#333" stroke="#fcfcfb" strokeWidth={2} />
      <text className="ax" x={TX(v.cloudC) + 9} y={SY(s.topKm) - 6} style={{ fill: '#333' }}>
        true top
      </text>
      <text className="ax" x={Math.min(TX(v.brightnessC) + 9, 560)} y={SY(v.inferredKm) + 16} style={{ fill: TEXT.blue }}>
        satellite’s guess
      </text>
    </svg>
  );
}

/** Whether a challenge of this lesson is solved now or was on an earlier visit: readouts that would give it away appear once it is. */
function useRevealed(challenge: string, solved: boolean): boolean {
  const done = useProgress()['weather/3.2']?.includes(challenge) ?? false;
  return solved || done;
}

export default function Lesson() {
  const r = useScenario('radar', RADAR_DEFAULTS);
  const s = r.state;
  const look = radarLook(stormOf(s), s.elevDeg);
  const shares = beamShares(s);
  const solved = rainBeamSolved(s);
  const top = beamTopKm(s.rangeKm, s.elevDeg);
  const meltBase = s.freezingKm - MELT_DEPTH_KM;
  const seen = Number.isFinite(look.dbz);
  const errPct = seen ? (look.estimatedMmH / look.trueMmH - 1) * 100 : -100;

  const sat = useScenario('satellite', SAT_DEFAULTS);
  const v = satView(sat.state);
  const solved2 = opaqueSolved(sat.state);
  const leak = 1 - v.emissivity;
  const allowedLeak = maxLeak(OPAQUE_TARGET.topKm, OPAQUE_TARGET.withinKm);
  // The satellite's height stays hidden on the challenge's cloud, once thickened, until the challenge is solved.
  const hideGuess = !useRevealed('b', solved2) && sat.state.topKm === OPAQUE_TARGET.topKm && sat.state.tau !== SAT_DEFAULTS.tau;

  // Numbers quoted in the prose, all for the starting storm (30 mm/h, freezing level 3 km).
  const summerLimit = rainLimitKm(RADAR_DEFAULTS.freezingKm);
  const winterLimit = rainLimitKm(CHALLENGE_FREEZING_KM);
  const at = (rangeKm: number, elevDeg = LOWEST_ELEV) => radarLook(stormOf({ ...RADAR_DEFAULTS, rangeKm }), elevDeg);
  const start = at(RADAR_DEFAULTS.rangeKm);
  const startShares = beamShares(RADAR_DEFAULTS);
  const near = at(100);
  const far = at(250);
  const ridge = at(RIDGE_KM);
  const marlow = at(MARLOW_KM);
  const steeper = at(RADAR_DEFAULTS.rangeKm, 1.5);
  const thin = satView(SAT_DEFAULTS);

  let caption: string;
  if (!seen) caption = 'The whole beam passes over the top of the storm: the radar sees clear air where it is pouring.';
  else {
    const parts = [
      shares.rain > 0.005 ? `${fmt(shares.rain * 100)}% in rain` : '',
      shares.melt > 0.005 ? `${fmt(shares.melt * 100)}% in the melting layer` : '',
      shares.ice > 0.005 ? `${fmt(shares.ice * 100)}% in snow and ice` : '',
      shares.above > 0.005 ? `${fmt(shares.above * 100)}% over the top` : '',
    ].filter(Boolean);
    const verdict =
      Math.abs(errPct) < 2 ? 'so its estimate is right' : errPct > 0 ? `so it overestimates the rain by ${fmt(errPct)}%` : `so it underestimates the rain by ${fmt(-errPct)}%`;
    caption = `Over the storm the beam is ${parts.join(', ')}, ${verdict}.`;
  }

  return (
    <LessonPage id="weather/3.2">
      <P>
        The station of <a href={lessonHref('weather/3.1')}>the previous lesson</a> measures one point very well. But weather happens in three dimensions, and much
        of it between the points. <a href={lessonHref('weather/2.3')}>Lesson 2.3</a> found that a thunderstorm 10 km wide can soak one farm and leave the next one
        dry; a rain gauge catches only what falls into a circle about 20 cm across. To forecast the atmosphere we need to know its state everywhere, at all heights,
        right now — and most of it will never be within reach of a thermometer. This lesson is about the instruments that measure it from a distance.
      </P>
      <P>
        The first is weather radar. A radar sends out a short pulse of microwaves — about 10 cm long for the big weather radars — and listens for the faint echo
        scattered back by raindrops, snowflakes and hail. The pulse travels at the speed of light, so the delay gives the distance: an echo from 150 km away
        returns after one thousandth of a second. The antenna turns and tilts, sweeping its narrow beam around the sky, and builds up a picture of everything
        falling within a few hundred kilometers.
      </P>
      <P>
        What it measures is the <K tone={WX.moisture}>reflectivity</K>, written Z. Drops much smaller than the wavelength scatter in proportion to the sixth
        power of their diameter, so one 4 mm drop echoes as strongly as 4,096 drops of 1 mm. Because Z spans many powers of ten, it’s quoted in decibels, dBZ:
        10 times its logarithm. To turn reflectivity into a rain rate, the radar has to assume how many drops of each size there are. The classic assumption, from
        measurements Marshall and Palmer published in 1948, gives
      </P>
      <Eq label="The Marshall–Palmer relation: Z equals 200 times the rain rate to the power 1.6">
        <K tone={WX.moisture}>Z</K>
        <Op>=</Op>
        <span>200</span>
        <Op>×</Op>
        <span>
          <K tone={WX.moisture}>R</K>
          <Sup>1.6</Sup>
        </span>
      </Eq>
      <P>
        with Z in mm⁶/m³ and R in millimeters an hour. Light rain of 1 mm an hour is {fmt(toDbz(reflectivityOfRain(1)))} dBZ; 10 mm an hour is{' '}
        {fmt(toDbz(reflectivityOfRain(10)))} dBZ; a 50 mm downpour is {fmt(toDbz(reflectivityOfRain(50)))} dBZ.
      </P>
      <P>
        In the next demonstration, Fenwick Bay’s radar sits at the left and looks inland. The chart is a slice of the atmosphere along the beam, with height
        stretched far more than distance. The ground is drawn flat, so the beam appears to climb: really it goes straight while the Earth curves away beneath it
        (bent slightly by the atmosphere, which the model allows for). The gray band is the beam’s width, the colors are the storm’s reflectivity, and the dark bar
        is the slice of storm the radar actually samples. The dashed blue line is the <K tone={WX.temperature}>freezing level</K>, the height at which the air
        cools to 0 °C; above it, the storm’s water is frozen, as snow and ice. The storm rains {fmt(STORM_RAIN_MMH)} mm an hour at the ground. Change its
        distance, the beam’s angle and the height of the freezing level:
      </P>

      <Figure name="Radar and Satellite Explorer" scenario={r}>
        <RadarSection s={s} />
        <Legend
          items={[
            ...DBZ_LEGEND,
            { label: 'Beam center', color: BEAM, kind: 'line', dashed: true },
            { label: 'Freezing level', color: GRAPHIC.blue, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'beam over the storm', value: look.overshoots ? 'over the top' : `${fmt(look.beamKm, 1)} km up, ${fmt(look.widthKm, 1)} km wide` },
            { label: 'radar reads', value: seen ? `${fmt(look.dbz, 1)} dBZ` : 'no echo', tone: WX.moisture },
            { label: `radar’s rain estimate (${fmt(STORM_RAIN_MMH)} mm/h falling)`, value: `${fmt(look.estimatedMmH, 1)} mm/h`, tone: WX.moisture },
          ]}
        />
        <Slider label="Distance to the storm" value={s.rangeKm} min={20} max={360} step={RANGE_STEP} onChange={(x) => r.set({ rangeKm: x })} display={`${fmt(s.rangeKm)} km`} />
        <Slider label="Beam angle" value={s.elevDeg} min={0.5} max={4} step={0.1} onChange={(x) => r.set({ elevDeg: x })} display={`${fmt(s.elevDeg, 1)}°`} />
        <Slider label="Freezing level" tone={WX.temperature} value={s.freezingKm} min={1.5} max={5} step={0.5} onChange={(x) => r.set({ freezingKm: x })} display={`${fmt(s.freezingKm, 1)} km`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At the start, the storm is {fmt(RADAR_DEFAULTS.rangeKm)} km away and raining {fmt(STORM_RAIN_MMH)} mm an hour. Even on the lowest angle the radar
        scans, {LOWEST_ELEV}° — as on the US national network’s radars, whose beams are about 1° wide — the beam over the storm is centered{' '}
        {fmt(start.beamKm, 1)} km up and has spread to {fmt(start.widthKm, 1)} km across. It no longer sees only the rain the farms will get. It sees a mixture
        of what is happening between {fmt(start.beamKm - start.widthKm / 2, 1)} and {fmt(start.beamKm + start.widthKm / 2, 1)} km: rain in the lowest{' '}
        {fmt(startShares.rain * 100)}% of the beam, melting snow and ice in the rest. Here the errors those two cause, which we’ll meet in a moment, happen to
        cancel, and the radar reports {fmt(start.estimatedMmH, 1)} mm an hour — close to the truth by luck, not because it sees the rain. Move the storm in to 100 km and the whole
        beam is in the rain: it reads {fmt(near.dbz, 1)} dBZ, and the estimate, {fmt(near.estimatedMmH, 1)} mm an hour, is exactly right, because the model’s rain
        obeys Marshall and Palmer’s relation. Real rain doesn’t always, which is one reason radar estimates are checked against gauges.
      </P>
      <P>
        Move it out instead. Just under the freezing level, falling snowflakes melt from the outside in. A wet snowflake is large and coated in water, and it
        echoes like a giant raindrop, so a layer a few hundred meters thick shines brightly on the radar: the <b>bright band</b>. Above the freezing level, ice
        reflects much less than water. A beam that catches the bright band overestimates the rain; one that sees only ice badly underestimates it. At 250 km the
        beam is {fmt(far.beamKm, 1)} km up, entirely in the ice, and the {fmt(STORM_RAIN_MMH)} mm downpour is reported as {fmt(far.estimatedMmH, 1)} mm an
        hour. Raising the beam only makes this worse: at 1.5°, the same storm at 150 km reads {fmt(steeper.estimatedMmH, 1)} mm an hour.
      </P>
      <P>
        Notice the stations on the axis. A storm over Hollin Ridge, {fmt(RIDGE_KM)} km from the city, is sampled {fmt(ridge.beamKm, 1)} km up and reported as{' '}
        {fmt(ridge.estimatedMmH, 1)} mm an hour. Over Marlow, {fmt(MARLOW_KM)} km away, the beam is centered {fmt(marlow.beamKm, 1)} km up, near the top of the storm,
        and sees {fmt(marlow.estimatedMmH, 1)} mm an hour. A single radar sees the rain well only within a hundred kilometers or so, which is why national networks
        space their radars a few hundred kilometers apart.
      </P>

      <Challenge
        id="a"
        question={`In winter the freezing level can sit as low as ${CHALLENGE_FREEZING_KM} km, so the melting layer begins at ${fmt(CHALLENGE_FREEZING_KM - MELT_DEPTH_KM, 1)} km. Predict first: set the freezing level to ${CHALLENGE_FREEZING_KM} km and read off the chart roughly where the top edge of the gray beam climbs past that height. Then, on the lowest scan, ${LOWEST_ELEV}°, find how far away the storm can be — to the nearest ${RANGE_STEP} km — while the whole beam over it stays in the rain.`}
        solved={solved}
        status={
          Math.abs(s.elevDeg - LOWEST_ELEV) > 1e-9 || Math.abs(s.freezingKm - CHALLENGE_FREEZING_KM) > 1e-9
            ? `First set the beam to ${LOWEST_ELEV}° and the freezing level to ${CHALLENGE_FREEZING_KM} km.`
            : top > meltBase
              ? `At ${fmt(s.rangeKm)} km the top of the beam is ${fmt(top, 2)} km up, inside the melting layer, which starts at ${fmt(meltBase, 1)} km.`
              : `At ${fmt(s.rangeKm)} km the whole beam is in the rain, its top ${fmt(top, 2)} km up. Can the storm be farther away?`
        }
        success={`Solved. At ${fmt(s.rangeKm)} km the top of the beam is ${fmt(top, 2)} km up, just under the melting layer; ${RANGE_STEP} km farther, it reaches into it. With the starting ${fmt(RADAR_DEFAULTS.freezingKm)} km freezing level the beam stayed in the rain out to ${fmt(summerLimit)} km; on a winter day the radar measures true rain only ${fmt(winterLimit)} km out, and sees much of its territory only as melting snow and ice aloft.`}
      />

      <H2>Looking down from orbit</H2>
      <P>
        Radars stand on land, and so do almost all weather stations. Over the oceans, which cover most of the planet, there are only scattered buoys and ships.
        Satellites fill the gap. Geostationary satellites orbit about 36,000 km above the equator, turning with the Earth so that each one watches the same
        hemisphere continuously; polar-orbiting satellites fly much lower and see the whole globe in strips. Their cameras look in visible light, which shows
        clouds by the sunlight they reflect and works only by day, and in the infrared, which works day and night.
      </P>
      <P>
        An infrared imager measures the radiation coming up from below, in a band of wavelengths that the clear atmosphere lets through. As in{' '}
        <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>, everything emits according to σT⁴ — strictly, an imager measures one narrow band of wavelengths,
        where Planck’s law makes the emission climb even more steeply with temperature, but the idea is the same — so the satellite can report what it sees as a{' '}
        <K tone={WX.temperature}>brightness temperature</K>: the temperature of a black body that would emit as much. A thick cloud is opaque in the infrared, so the
        satellite sees its top. And because the atmosphere cools with height, about 6.5 °C per kilometer (<a href={lessonHref('weather/1.2')}>Lesson 1.2</a>), a
        cold top is a high top. That is how infrared images pick out towering storms, whose tops are the coldest things on them.
      </P>
      <P>
        In the next demonstration, a cloud floats over warm ground. Its <b>optical depth</b> says how thick it is to infrared: the share of the ground’s radiation
        that gets through is e<Sup>−τ</Sup>. The satellite mixes what comes from the ground with what comes from the cloud, and then, assuming the cloud is opaque,
        reads its height off the temperature profile on the right. The cloud starts as thin cirrus, high up, over ground at {fmt(SAT_GROUND_C)} °C. Change its
        height and thickness:
      </P>

      <Figure name="Radar and Satellite Explorer · infrared satellite" scenario={sat}>
        <SatelliteColumn s={sat.state} />
        <Readouts
          items={[
            hideGuess
              ? { label: 'satellite puts the top at: challenge b asks', value: '?', tone: WX.probability }
              : { label: 'satellite puts the top at', value: `${fmt(v.inferredKm, 1)} km`, tone: WX.probability },
          ]}
        />
        <Slider label="Cloud-top height" value={sat.state.topKm} min={1} max={12} step={0.5} onChange={(x) => sat.set({ topKm: x })} display={`${fmt(sat.state.topKm, 1)} km`} />
        <Slider label="Cloud optical depth" tone={WX.moisture} value={sat.state.tau} min={0} max={8} step={0.1} onChange={(x) => sat.set({ tau: x })} display={fmt(sat.state.tau, 1)} />
        <Eq
          label={`Brightness temperature to the fourth power equals ${fmt(v.emissivity, 2)} times ${fmt(v.cloudC + 273.15)} kelvins to the fourth plus ${fmt(1 - v.emissivity, 2)} times ${fmt(SAT_GROUND_C + 273.15)} kelvins to the fourth, so the satellite sees ${fmt(v.brightnessC + 273.15)} kelvins, ${fmt(v.brightnessC, 1)} degrees Celsius`}
        >
          <span>
            <K tone={WX.temperature}>
              T<Sub>b</Sub>
            </K>
            <Sup>4</Sup>
          </span>
          <Op>=</Op>
          <span>{fmt(v.emissivity, 2)}</span>
          <Op>×</Op>
          <span>
            ({fmt(v.cloudC + 273.15)} K)<Sup>4</Sup>
          </span>
          <Op>+</Op>
          <span>{fmt(1 - v.emissivity, 2)}</span>
          <Op>×</Op>
          <span>
            ({fmt(SAT_GROUND_C + 273.15)} K)<Sup>4</Sup>
          </span>
          <Op>→</Op>
          <K tone={WX.temperature}>
            T<Sub>b</Sub> = {fmt(v.brightnessC + 273.15)} K = {fmt(v.brightnessC, 1)} °C
          </K>
        </Eq>
      </Figure>

      <P>
        The cirrus’s top is at {fmt(SAT_DEFAULTS.topKm)} km and {fmt(thin.cloudC)} °C. But with an optical depth of {fmt(SAT_DEFAULTS.tau, 1)} it lets{' '}
        {fmt((1 - thin.emissivity) * 100)}% of the ground’s infrared through, and the satellite sees a blend: {fmt(thin.brightnessC, 1)} °C, the temperature of
        a cloud {fmt(thin.inferredKm, 1)} km up. A thin veil of ice crystals near the top of the troposphere is mistaken for a mid-level cloud. Thicken it and the
        ground disappears behind it; the guess climbs toward the truth. Real retrievals guard against this by comparing several infrared wavelengths, which thin
        ice clouds treat differently, but the principle stands: a satellite measures radiation, and every number it reports about the atmosphere is an
        inference, with its own errors.
      </P>

      <Challenge
        id="b"
        question={`Keep the cloud’s top at ${OPAQUE_TARGET.topKm} km, where it is ${fmt(thin.cloudC)} °C. The satellite places it within ${OPAQUE_TARGET.withinKm} km of the truth only if the blend it sees is no more than ${fmt(SAT_LAPSE, 1)} °C warmer than that. Predict first: ${fmt(SAT_LAPSE, 1)} °C is a tenth of the ${fmt(SAT_GROUND_C - thin.cloudC)} °C between the top and the ground — so may a tenth of the ground’s infrared leak through, or must it be less? Then find the thinnest cloud, to the nearest 0.1 of optical depth, that the satellite places within ${OPAQUE_TARGET.withinKm} km. Its guess at the height stays hidden until you do.`}
        solved={solved2}
        status={
          sat.state.topKm !== OPAQUE_TARGET.topKm
            ? `First put the cloud top back at ${OPAQUE_TARGET.topKm} km.`
            : v.errorKm > OPAQUE_TARGET.withinKm
              ? `At an optical depth of ${fmt(sat.state.tau, 1)}, ${fmt(leak * 100, 1)}% of the ground’s infrared leaks through, and the satellite sees ${fmt(v.brightnessC, 1)} °C: more than ${fmt(SAT_LAPSE, 1)} °C warmer than the top.`
              : `At ${fmt(sat.state.tau, 1)}, ${fmt(leak * 100, 1)}% leaks through, and the satellite sees ${fmt(v.brightnessC, 1)} °C: close enough. Would a thinner cloud do?`
        }
        success={`Solved. At an optical depth of ${fmt(sat.state.tau, 1)} the cloud lets only ${fmt(leak * 100, 1)}% of the ground’s infrared through, and the satellite puts its top at ${fmt(v.inferredKm, 2)} km. Had the blend been a plain average of the two temperatures, a tenth could have leaked through; but σT⁴ weights the warm ground so heavily that no more than ${fmt(allowedLeak * 100, 1)}% may, and even that drags the reading down most of a kilometer.`}
      />

      <P>
        Infrared imagery is only the beginning. Satellites also carry sounders that measure the temperature and moisture at different heights, and the motion of
        clouds between successive images gives the wind. Add the surface stations, weather balloons launched twice a day from hundreds of sites, aircraft, ships,
        buoys and radars, and the world’s weather services gather millions of observations a day, of different quantities, at different places and times, each
        with its own errors — the ones in <FigRef to="Radar and Satellite Explorer">the first demonstration</FigRef> among them.
      </P>
      <P>
        A forecast needs all of that turned into one complete, consistent picture of the atmosphere now: a value of temperature, pressure, wind and moisture at
        every point of a grid. That picture is the starting state. The next lesson builds a small model that takes such a state and steps it forward in time,
        and shows what happens to the forecast where the picture has gaps.
      </P>
    </LessonPage>
  );
}
