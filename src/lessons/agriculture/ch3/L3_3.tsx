import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  linePath,
  scale,
  useScenario,
} from '../../../framework';
import { blightField, fieldSeason } from '../../../engines/agriculture/farm';
import { BANDS, SOIL, canopyReflectance, clearMean, leaf, ndvi, satellitePasses, seasonNdvi } from '../../../engines/agriculture/vegetation';
import { REFERENCE_YEAR, simulatedYear } from '../../../model/agriculture/climate';
import { dayOf } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { buAc } from '../shared/format';

/** The canopy and its NDVI take the course's growth tone, as leaf area does in Lesson 1.1. */
const CANOPY = GRAPHIC.teal;
const SOIL_COLOR = '#9a7b52';

/** NDVI as the readout shows it, to three decimals. */
export function shown(lai: number, chlorophyll = 1, stress = 0): number {
  return Math.round(ndvi(canopyReflectance(lai, chlorophyll, stress)) * 1000) / 1000;
}

/** The challenge's two canopies: a thin, healthy one, and a full one whose leaves are losing their green. */
export const THIN_LAI = 2;
export const FULL_LAI = 5;

/** The challenge: a full, unstressed canopy whose lost chlorophyll makes it read, within 0.01, the NDVI of the thin, healthy one. */
export function lookalikeSolved(lai: number, chlorophyll: number, stress: number): boolean {
  if (lai !== FULL_LAI || stress !== 0 || chlorophyll >= 1) return false;
  return Math.abs(shown(lai, chlorophyll) - shown(THIN_LAI)) <= 0.01;
}

function Spectrum({ lai, chl, stress }: { lai: number; chl: number; stress: number }) {
  const x = scale(450, 1650, 70, 610);
  const y = scale(0, 0.6, 210, 24);
  const canopy = canopyReflectance(lai, chl, stress);
  const lf = leaf(chl, stress);
  const xs = BANDS.map((b) => x(b.nm));
  const v = ndvi(canopy);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`Reflectance of a canopy with leaf area index ${fmt(lai, 1)}, ${fmt(chl * 100)}% chlorophyll and ${fmt(stress * 100)}% water stress: red ${fmt(canopy[2], 3)}, near-infrared ${fmt(canopy[4], 3)}, NDVI ${fmt(v, 2)}.`}
    >
      <text className="ax" x={70} y={14}>
        Share of sunlight reflected
      </text>
      <rect x={x(640)} y={24} width={x(690) - x(640)} height={186} fill="rgba(231, 91, 85, .12)" />
      <rect x={x(780)} y={24} width={x(900) - x(780)} height={186} fill="rgba(171, 112, 182, .12)" />
      <GridY y={y} ticks={[0, 0.2, 0.4, 0.6]} x0={70} x1={610} format={(t) => `${fmt(t * 100)}%`} baseline={0} />
      <path d={linePath(xs, SOIL.map(y))} fill="none" stroke={SOIL_COLOR} strokeWidth={2} strokeDasharray="6 4" />
      <path d={linePath(xs, lf.map(y))} fill="none" stroke={CANOPY} strokeWidth={1.2} opacity={0.6} />
      <path d={linePath(xs, canopy.map(y))} fill="none" stroke={CANOPY} strokeWidth={2.8} />
      {canopy.map((c, i) => (
        <circle key={i} cx={xs[i]} cy={y(c)} r={4.5} fill={CANOPY} stroke="#fcfcfb" strokeWidth={1.5} />
      ))}
      {BANDS.map((b) => (
        <text key={b.id} className="ax ax-m" x={x(b.nm)} y={228}>
          {b.id === 'nir' ? 'NIR' : b.id === 'swir' ? 'SWIR' : b.name.toLowerCase()}
        </text>
      ))}
      <text className="ax ax-e" x={610} y={246}>
        wavelength: 490 to 1,610 nanometers
      </text>
      <text className="lab" x={x(665)} y={40} textAnchor="middle" style={{ fill: '#c4382f' }}>
        red
      </text>
      <text className="lab" x={x(842)} y={40} textAnchor="middle" style={{ fill: '#8e4fa0' }}>
        near-infrared
      </text>
    </svg>
  );
}

const SEASONS = {
  reference: { year: REFERENCE_YEAR, blight: false, label: 'Reference' },
  drought: { year: 46, blight: false, label: 'Drought' },
  bumper: { year: 180, blight: false, label: 'Bumper' },
  blight: { year: 80, blight: true, label: 'Wet, blighted' },
} as const;
type SeasonKey = keyof typeof SEASONS;

const ORBIT_FROM = dayOf(4, 15);
const ORBIT_TO = dayOf(10, 15);
const MID_FROM = dayOf(7, 15);
const MID_TO = dayOf(8, 15);

let blightCache: { passes: number; all: number; mid: number; daily: number; dailyClearSky: number; days: number; wet: number } | null = null;
/**
 * What the satellite sees of the wet, blighted summer: clear passes at the figure's defaults (every five days, 30% cloud on dry
 * days), over the season and from mid-July to mid-August; and in that month with a pass every day, at 30% and at no cloud on dry days.
 */
export function blightLooks() {
  if (!blightCache) {
    const year = SEASONS.blight.year;
    const truth = seasonNdvi(fieldSeason(year, blightField('none')));
    const w = simulatedYear(year, 'prairie');
    const look = (revisit: number, cloud: number) => satellitePasses(truth, w, revisit, cloud, 7000 + year, ORBIT_FROM, ORBIT_TO);
    const clear = (obs: ReturnType<typeof look>, a = 0, b = 999) => obs.filter((x) => x.day >= a && x.day < b && x.value !== null).length;
    const five = look(5, 0.3);
    let wet = 0;
    for (let d = MID_FROM; d < MID_TO; d++) if ((w[d]?.rain ?? 0) >= 0.05) wet++;
    blightCache = {
      passes: five.length,
      all: clear(five),
      mid: clear(five, MID_FROM, MID_TO),
      daily: clear(look(1, 0.3), MID_FROM, MID_TO),
      dailyClearSky: clear(look(1, 0), MID_FROM, MID_TO),
      days: MID_TO - MID_FROM,
      wet,
    };
  }
  return blightCache;
}

export default function Lesson() {
  const s = useScenario('spectrum', { lai: 2, chl: 1, stress: 0 });
  const canopy = canopyReflectance(s.state.lai, s.state.chl, s.state.stress);
  const v = ndvi(canopy);
  const solved = lookalikeSolved(s.state.lai, s.state.chl, s.state.stress);
  const thin = shown(THIN_LAI);

  const o = useScenario('orbit', { season: 'reference' as SeasonKey, revisit: 5, cloud: 0.3 });
  const def = SEASONS[o.state.season];
  const run = useMemo(() => fieldSeason(def.year, def.blight ? blightField('none') : { district: 'prairie', crop: 'corn' }), [def]);
  const truth = useMemo(() => seasonNdvi(run), [run]);
  const ref = useMemo(() => seasonNdvi(fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'corn' })), []);
  const from = ORBIT_FROM;
  const to = ORBIT_TO;
  const obs = useMemo(() => satellitePasses(truth, simulatedYear(def.year, 'prairie'), o.state.revisit, o.state.cloud, 7000 + def.year, from, to), [truth, def.year, o.state.revisit, o.state.cloud, from, to]);
  const july = obs.filter((x) => x.day >= dayOf(7, 1) && x.day < dayOf(8, 1));
  const midSummer = clearMean(obs, MID_FROM, MID_TO);
  const blightSeen = useMemo(() => blightLooks(), []);
  const days = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <LessonPage id="agriculture/3.3">
      <P>
        <a href={lessonHref('agriculture/3.2')}>The previous lesson</a> struck Cedar Bend’s crops with droughts and freezes and watched the damage in the model. A grain
        trader in the real world can’t run the model on the real valley; they need to see the crops. Walking fields is slow and samples only a few. Satellites look
        at all of them every few days — the European Sentinel-2 satellites, for instance, working in pairs, return to the same spot every five days or sooner and
        measure visible and near-infrared light in squares 10 meters across — and what they measure is light. This lesson is about what that light can and can’t tell us.
      </P>
      <P>
        Sunlight striking a field is partly absorbed and partly reflected, and how much comes back depends on the wavelength. A green leaf absorbs most of the{' '}
        <K tone="red">red</K> light, because chlorophyll uses it for photosynthesis — the same light the leaves of <a href={lessonHref('agriculture/1.1')}>Lesson
        1.1</a> turned into sugar. But it reflects about half of the <K tone="violet">near-infrared</K> light just beyond what our eyes can see, scattered back by
        the spongy cells inside the leaf. Bare soil does neither particularly: it reflects a little more of each as the wavelength rises. In the next demonstration,
        the heavy line is the reflectance of a field of corn in six bands like those of the Sentinel-2 satellites; the thin line is a single leaf and the
        dashed line bare soil. The canopy’s size is its leaf area index, the square meters of leaf over each square meter of ground from{' '}
        <a href={lessonHref('agriculture/1.1')}>Lesson 1.1</a>. Grow the canopy, drain its chlorophyll, stress it for water:
      </P>

      <Figure name="Vegetation Index Explorer" scenario={s}>
        <Spectrum lai={s.state.lai} chl={s.state.chl} stress={s.state.stress} />
        <Legend
          items={[
            { label: 'Canopy', color: CANOPY, kind: 'line' },
            { label: 'One leaf', color: CANOPY, kind: 'line' },
            { label: 'Bare soil', color: SOIL_COLOR, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'red reflected', value: `${fmt(canopy[2] * 100, 1)}%`, tone: 'red' },
            { label: 'near-infrared reflected', value: `${fmt(canopy[4] * 100, 1)}%`, tone: 'violet' },
            { label: 'NDVI', value: fmt(v, 3), tone: 'teal' },
          ]}
        />
        <Slider label="Leaf area index" tone="teal" value={s.state.lai} min={0} max={6} step={0.1} onChange={(x) => s.set({ lai: Math.round(x * 10) / 10 })} display={fmt(s.state.lai, 1)} />
        <Slider label="Chlorophyll" value={s.state.chl} min={0} max={1} step={0.05} onChange={(x) => s.set({ chl: Math.round(x * 20) / 20 })} display={`${fmt(s.state.chl * 100)}%`} />
        <Slider label="Water stress" tone="blue" value={s.state.stress} min={0} max={1} step={0.05} onChange={(x) => s.set({ stress: Math.round(x * 20) / 20 })} display={`${fmt(s.state.stress * 100)}%`} />
      </Figure>

      <P>
        The contrast between red and near-infrared is the signature of green leaf, and remote sensing condenses it into one number, the{' '}
        <K tone="teal">normalized difference vegetation index</K>: NDVI = (near-infrared − red) ÷ (near-infrared + red). Bare soil reads about 0.20. A canopy with
        a leaf area index of 1 reads 0.51; at 3, 0.74; at 5, 0.81. Notice how the index flattens: once the canopy covers the ground, the red is already gone, and
        extra leaf adds only a little near-infrared. Yellowing leaves pull it down fast — at 70% chlorophyll a full canopy, with a leaf area index of 5, reads 0.64
        — and water stress more gently, to 0.75 at its worst for the same canopy, mostly through the near-infrared.
      </P>
      <P>
        The other bands carry information too. In the red edge, where a leaf’s reflectance climbs steeply from red to near-infrared, the climb starts earlier, at
        shorter wavelengths, as chlorophyll is lost, so it is sensitive to the yellowing of a stressed or nitrogen-starved crop. In the shortwave infrared, water inside the leaf absorbs
        light, so a drying leaf reflects more of it: watch the right-hand end of the line rise as you add water stress. Indices built from those bands are used
        alongside NDVI, but NDVI, simple and decades old, is still the workhorse.
      </P>

      <Challenge
        id="a"
        question={`Predict first: a thin, healthy canopy with a leaf area index of ${THIN_LAI} reads an NDVI of ${fmt(thin, 3)}. How much of its chlorophyll would a full canopy, with a leaf area index of ${FULL_LAI} and no water stress, have to lose to read the same from orbit? Then set it, in 5% steps, to within 0.01.`}
        solved={solved}
        status={
          s.state.lai !== FULL_LAI || s.state.stress !== 0
            ? `Set the leaf area index to ${FULL_LAI} and water stress to 0%, then lower the chlorophyll.`
            : `At ${fmt(s.state.chl * 100)}% chlorophyll the full canopy reads ${fmt(v, 3)}, against ${fmt(thin, 3)} for the thin, healthy one.`
        }
        success={`Solved: with ${fmt(s.state.chl * 100)}% of its chlorophyll, a canopy with two and a half times the leaf reads ${fmt(v, 3)}, against ${fmt(thin, 3)} for the thin, healthy one. From orbit the two fields look alike: losing ${fmt((1 - s.state.chl) * 100)}% of its green undoes all the extra leaf. A low NDVI says that something is short — leaf, or the green in it — but not which.`}
      />

      <H2>Watching a season from orbit</H2>
      <P>
        A satellite doesn’t see a field every day. It passes over every few days, and when it does, clouds often hide the ground — especially in a wet summer, and
        especially on the rainy days that matter most. In the next demonstration, the line is the true NDVI of Cedar Bend’s corn through a season, the dots are the
        passes that saw it, and the marks along the bottom are the passes that saw only cloud. The dashed line is the reference season, for comparison. Choose a
        season, how often the satellite passes, and how cloudy the dry days are:
      </P>

      <Figure name="Vegetation Index Explorer · from orbit" scenario={o}>
        <Segmented
          label="Season"
          value={o.state.season}
          onChange={(x) => o.set({ season: x })}
          options={(Object.keys(SEASONS) as SeasonKey[]).map((k) => ({ value: k, label: SEASONS[k].label }))}
        />
        <DayChart
          days={days}
          series={[
            { values: days.map((d) => ref[d]), color: '#999', dash: '6 4', width: 1.5 },
            { values: days.map((d) => truth[d]), color: CANOPY, width: 2.5 },
          ]}
          from={from}
          to={to}
          yMin={0}
          yMax={0.9}
          yTicks={[0, 0.2, 0.4, 0.6, 0.8]}
          yLabel="NDVI of Cedar Bend’s corn"
          yFormat={(t) => fmt(t, 1)}
          height={220}
          overlay={(x, y) => (
            <g>
              {obs.map((ob) =>
                ob.value === null ? (
                  <text key={ob.day} x={x(ob.day)} y={y(0.03)} textAnchor="middle" style={{ fontSize: 10, fill: '#999' }}>
                    ×
                  </text>
                ) : (
                  <circle key={ob.day} cx={x(ob.day)} cy={y(ob.value)} r={4} fill="#fcfcfb" stroke={GRAPHIC.violet} strokeWidth={2} />
                ),
              )}
            </g>
          )}
          ariaLabel={`True and satellite-measured NDVI of Cedar Bend’s corn in the ${def.label.toLowerCase()} season, with a pass every ${o.state.revisit} days: ${obs.filter((x) => x.value !== null).length} of ${obs.length} passes saw the field. From mid-July to mid-August the clear passes averaged ${midSummer === null ? 'nothing' : fmt(midSummer, 2)}.`}
        />
        <Legend
          items={[
            { label: 'True NDVI', color: CANOPY, kind: 'line' },
            { label: 'Reference season', color: '#999', kind: 'line', dashed: true },
            { label: 'Clear pass', color: GRAPHIC.violet },
            { label: 'Cloud (×)', color: '#bbb' },
          ]}
        />
        <Readouts
          items={[
            { label: 'clear looks in July', value: `${july.filter((x) => x.value !== null).length} of ${july.length}` },
            { label: 'mid-July to mid-August, measured', value: midSummer === null ? '—' : fmt(midSummer, 2), tone: 'violet' },
            { label: 'the crop’s final yield', value: buAc(run.yield), tone: 'gold' },
          ]}
        />
        <Slider label="A pass every" tone="violet" value={o.state.revisit} min={1} max={16} onChange={(x) => o.set({ revisit: x })} display={`${o.state.revisit} day${o.state.revisit > 1 ? 's' : ''}`} />
        <Slider label="Cloud on dry days" tone="blue" value={o.state.cloud} min={0} max={0.8} step={0.05} onChange={(x) => o.set({ cloud: Math.round(x * 20) / 20 })} display={`${fmt(o.state.cloud * 100)}%`} />
      </Figure>

      <P>
        In the reference season, a pass every five days sees the field on 20 of its 37 visits, and the index climbs from bare soil in May to about 0.81 by early
        July, holds there until the kernels dent in August, and falls as the leaves yellow. The drought season looks better than the reference at first — 0.74
        against 0.58 on June 15, because its warm, sunny start races the canopy ahead — and a hot early summer that looks good from orbit is worth remembering. It
        matches the reference through July, still 0.78 on July 20, then drops away, to 0.72 on August 1 and 0.37 by mid-August, as the leaves roll, wilt and die
        early. That is the warning sign the market watches for, and it arrives two to three weeks after the trouble began in the soil, as{' '}
        <FigRef to="Drought and Frost Lab · inside the season">the previous lesson’s dry spell</FigRef> showed. The bumper season, by contrast, is all but
        indistinguishable from the reference from July to mid-August: a canopy can’t get greener than full. Its extra 45 bushels come from a long, cool grain fill
        that keeps the leaves working two weeks longer, to September 30 instead of September 16, and the index sees that only from late August, when the
        reference’s leaves yellow and the bumper’s stay green — 0.61 against 0.45 on September 1.
      </P>
      <P>
        In the wet, blighted summer the satellite is nearly blind: only {blightSeen.all} of {blightSeen.passes} passes see the field, and none between mid-July and
        mid-August, the month when the blight is spreading. Passing more often helps only so much. With a pass every day the field shows through on{' '}
        {blightSeen.daily} of those {blightSeen.days} days, and clearing the sky on the dry days adds none, because {blightSeen.wet} of the {blightSeen.days} brought
        rain and a rainy day is almost always overcast. Clouds come with the weather that makes them, which is why real crop monitoring combines many satellites,
        radar that sees through cloud, and reports from the ground.
      </P>

      <P>
        In practice nobody looks at one field. Government agencies and private analytics firms compute vegetation indices for every field in the world’s major grain
        regions as the satellites pass, and publish them as maps of the difference from normal for the date: a district greener than usual, or browner. A trader
        reading those maps in late July is doing, across thousands of fields at once, what we just did for Cedar Bend — looking for the moment a season starts to
        separate from the normal one.
      </P>
      <P>
        An index is not a yield, though. It says how much green leaf a field has; it doesn’t say how many kernels the ears set in July or how heavy they’ll grow.
        Turning observations like these — and the weather that produced them — into a forecast of bushels is the work of the next lesson, where the satellite becomes one witness among several.
      </P>
    </LessonPage>
  );
}
