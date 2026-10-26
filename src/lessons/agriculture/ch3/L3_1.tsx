import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
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
  mix,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { marginOverVariable } from '../../../engines/agriculture/farm';
import { districtMeans, valleySeason, type DistrictSeason, type ValleyScenario } from '../../../engines/agriculture/valley';
import { gdd } from '../../../engines/agriculture/crop';
import { applyShift, normalYear, rainBetween } from '../../../model/agriculture/climate';
import { PLAN_PRICE } from '../../../model/agriculture/economics';
import { DISTRICT, DISTRICTS, dayOf, type DistrictId } from '../../../model/agriculture/region';
import { ValleyMap } from '../shared/ValleyMap';
import { buAc, inch, perAcre } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const YEARS = Array.from({ length: 50 }, (_, i) => i + 1);
type Metric = 'best' | 'corn' | 'wheat' | 'rain' | 'season';
type Best = 'corn' | 'wheat' | 'irrigated';

interface Climate {
  rain: number;
  temp: number;
  soil: number;
}

function scenario(c: Climate): ValleyScenario {
  return { shift: c.rain !== 1 || c.temp !== 0 ? { rain: c.rain, temp: c.temp } : undefined, soil: c.soil !== 1 ? c.soil : undefined };
}

export interface DistrictSuitability extends DistrictSeason {
  cornMargin: number;
  irrigatedMargin: number;
  wheatMargin: number;
  best: Best;
  /** May–August rain in a normal year, inches. */
  summerRain: number;
  /** Corn degree days from May 1 to September 30 in a normal year. */
  seasonGdd: number;
}

/** Each district's average yields and returns over 50 simulated seasons, under a climate scenario. */
export function suitability(c: Climate): Record<DistrictId, DistrictSuitability> {
  const means = districtMeans(YEARS, scenario(c));
  const out = {} as Record<DistrictId, DistrictSuitability>;
  for (const d of DISTRICTS) {
    const m = means[d.id];
    const cornMargin = marginOverVariable('corn', m.corn, PLAN_PRICE.corn);
    const wheatMargin = marginOverVariable('wheat', m.wheat, PLAN_PRICE.wheat);
    // Irrigated corn pays for its water: about 9 inches a season at $11 an acre-inch (Lesson 2.2).
    const irrigatedMargin = d.irrigatedKAc > 0 ? marginOverVariable('corn', m.cornIrrigated, PLAN_PRICE.corn, 9) : -Infinity;
    const best: Best = cornMargin >= wheatMargin ? 'corn' : 'wheat';
    const n = applyShift(normalYear(d.id), { rain: c.rain, temp: c.temp });
    let g = 0;
    for (let day = dayOf(5, 1); day < dayOf(10, 1); day++) g += gdd('corn', n[day].tmax, n[day].tmin);
    out[d.id] = { ...m, cornMargin, irrigatedMargin, wheatMargin, best, summerRain: rainBetween(n, dayOf(5, 1), dayOf(9, 1)), seasonGdd: g };
  }
  return out;
}

/** Normal-year rain in a district: the whole year, and May through August, inches. */
export const annualRain = (id: DistrictId) => rainBetween(normalYear(id), 0, 365);
export const summerRain = (id: DistrictId) => rainBetween(normalYear(id), dayOf(5, 1), dayOf(9, 1));

const TODAY: Climate = { rain: 1, temp: 0, soil: 1 };
/** The challenge's climate: the valley 2 °C warmer, with today's rain and soil. */
export const WARMER: Climate = { rain: 1, temp: 2, soil: 1 };

/** Whether a district's better crop is corn in today's climate and wheat in this one. */
export function switchesToWheat(c: Climate, id: DistrictId): boolean {
  return suitability(TODAY)[id].best === 'corn' && suitability(c)[id].best === 'wheat';
}

/** The challenge: with the valley 2 °C warmer, the reader has selected a district that switched from corn to wheat. */
export function warmerSolved(c: Climate, selected: DistrictId): boolean {
  if (c.rain !== WARMER.rain || c.temp !== WARMER.temp || c.soil !== WARMER.soil) return false;
  return switchesToWheat(c, selected);
}

const BEST_FILL: Record<Best, string> = { corn: mix('#fcfcfb', CROP_LINE.corn, 0.55), wheat: mix('#fcfcfb', CROP_LINE.wheat, 0.5), irrigated: mix('#fcfcfb', GRAPHIC.blue, 0.4) };

function ramp(v: number, lo: number, hi: number, color: string) {
  return mix('#f4f1e8', color, 0.15 + 0.75 * Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}

/** Each district's yields across 50 seasons, as rows of dots (for corn, with the High Plains' irrigated corn as a row of its own). */
export function yearToYearRows(crop: 'corn' | 'wheat'): Array<{ id: string; name: string; ys: number[]; mean: number; cv: number }> {
  const row = (id: string, district: DistrictId, name: string, pick: (s: DistrictSeason) => number) => {
    const ys = YEARS.map((y) => pick(valleySeason(y).districts[district]));
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length - 1));
    return { id, name, ys, mean, cv: sd / mean };
  };
  const rows = DISTRICTS.map((d) => row(d.id, d.id, d.name, (s) => (crop === 'corn' ? s.corn : s.wheat)));
  if (crop === 'corn') rows.push(row('plains-irrigated', 'plains', `${DISTRICT.plains.name}, irrigated`, (s) => s.cornIrrigated));
  return rows;
}

function YearToYear({ crop }: { crop: 'corn' | 'wheat' }) {
  const rows = yearToYearRows(crop);
  const x = scale(0, crop === 'corn' ? 260 : 100, 150, 600);
  const axisY = 30 + rows.length * 42;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${axisY + 22}`}
      role="img"
      aria-label={`${crop === 'corn' ? 'Corn' : 'Wheat'} yields in each district over 50 simulated seasons. ${rows.map((r) => `${r.name}: average ${fmt(r.mean)} bushels an acre, varying by ${fmt(r.cv * 100)}%`).join('; ')}.`}
    >
      {rows.map((r, i) => {
        const y = 30 + i * 42;
        return (
          <g key={r.id}>
            <text className="lab" x={140} y={y + 4} textAnchor="end">
              {r.name}
            </text>
            <line className="gl" x1={150} x2={600} y1={y} y2={y} />
            {r.ys.map((v, j) => (
              <circle key={j} cx={x(v)} cy={y + ((j % 5) - 2) * 3} r={2.8} fill={CROP_LINE[crop]} opacity={0.55} />
            ))}
            <line x1={x(r.mean)} x2={x(r.mean)} y1={y - 12} y2={y + 12} stroke="#333" strokeWidth={2} />
            <text className="ax" x={604} y={y + 4}>
              ±{fmt(r.cv * 100)}%
            </text>
          </g>
        );
      })}
      {(crop === 'corn' ? [0, 50, 100, 150, 200, 250] : [0, 20, 40, 60, 80, 100]).map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={axisY}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={600} y={axisY + 17}>
        yield, bu/ac
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('map', { metric: 'best' as Metric, rain: 1, temp: 0, soil: 1, selected: 'ridge' as DistrictId });
  const c = { rain: s.state.rain, temp: s.state.temp, soil: s.state.soil };
  const suit = useMemo(() => suitability(c), [c.rain, c.temp, c.soil]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = suit[s.state.selected];
  const solved = useMemo(() => warmerSolved(c, s.state.selected), [c.rain, c.temp, c.soil, s.state.selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = useMemo(() => suitability(TODAY), []);
  const atWarmer = c.rain === WARMER.rain && c.temp === WARMER.temp && c.soil === WARMER.soil;
  const selName = DISTRICT[s.state.selected].name;
  const deeper = useMemo(() => suitability({ rain: 1, temp: 0, soil: 1.1 }).ridge, []);
  const warmer = useMemo(() => suitability(WARMER), []);
  const metric = s.state.metric;
  const bestName: Record<Best, string> = { corn: 'corn', wheat: 'wheat', irrigated: 'irrigated corn' };

  const fill = (id: DistrictId) => {
    const v = suit[id];
    if (metric === 'best') return BEST_FILL[v.best];
    if (metric === 'corn') return ramp(v.corn, 40, 200, CROP_LINE.corn);
    if (metric === 'wheat') return ramp(v.wheat, 40, 80, CROP_LINE.wheat);
    if (metric === 'rain') return ramp(v.summerRain, 6, 22, GRAPHIC.blue);
    return ramp(v.seasonGdd, 1000, 2200, GRAPHIC.red);
  };
  const label = (id: DistrictId): [string, string?] => {
    const v = suit[id];
    if (metric === 'best') return [bestName[v.best], `${usd(Math.max(v.cornMargin, v.wheatMargin))}/ac`];
    if (metric === 'corn') return [buAc(v.corn), DISTRICT[id].irrigatedKAc ? `irrigated ${fmt(v.cornIrrigated)}` : undefined];
    if (metric === 'wheat') return [buAc(v.wheat)];
    if (metric === 'rain') return [`${inch(v.summerRain)} May–Aug`];
    return [`${fmt(v.seasonGdd)} GDD`];
  };

  const y = useScenario('years', { crop: 'corn' as 'corn' | 'wheat' });

  return (
    <LessonPage id="agriculture/3.1">
      <P>
        Chapter 2 ended with Cedar Bend’s profit spread across 200 simulated seasons, from a loss of more than $370,000 to a profit of more than $300,000, and almost
        all of that spread came from the weather. This chapter asks why agricultural supply is so uncertain, and how far anyone can see ahead of it. We’ll start
        with the simplest form of the question: why is the same crop a safe bet in one place and a gamble in another?
      </P>
      <P>
        The Crane Valley’s five districts differ in three ways that matter to a crop. <K tone="blue">Rain</K> falls more in the east than the west: a normal year
        brings {fmt(annualRain('bottoms'))} inches to the River Bottoms and {fmt(annualRain('plains'))} to the High Plains, {fmt(summerRain('bottoms'), 1)} and{' '}
        {fmt(summerRain('plains'), 1)} of it between May and August. The <K tone="red">growing season</K> — the warmth available between spring and autumn, which we
        measure in degree days as in <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a> — is longest on the High Plains and in the River Bottoms and shortest in
        the North Tier. And the soil’s <K tone="blue">water-holding</K> decides how much of the rain is kept for the crop: the Black Prairie and the Bottoms hold 11 inches of water in the root zone, the
        thinner soils of the Upland Ridge only 7.5. In the next demonstration each district is colored by what its climate and soil favor, averaged over 50 simulated
        seasons at the plan prices of Chapter 2. Change the valley’s rain, temperature and soil, choose what to map, and click a district for its numbers:
      </P>

      <Figure name="Agricultural Geography Map" scenario={s}>
        <Segmented
          label="Map"
          value={metric}
          onChange={(v) => s.set({ metric: v })}
          options={[
            { value: 'best', label: 'Best crop' },
            { value: 'corn', label: 'Corn yield' },
            { value: 'wheat', label: 'Wheat yield' },
            { value: 'rain', label: 'Summer rain' },
            { value: 'season', label: 'Season length' },
          ]}
        />
        <ValleyMap
          fill={fill}
          label={label}
          selected={s.state.selected}
          onSelect={(id) => s.set({ selected: id })}
          places={['sable', 'westhaven', 'landing']}
          showRail={false}
          ariaLabel={`The Crane Valley’s districts, colored by ${metric === 'best' ? 'the crop that returns the most over its variable costs' : metric}. ${DISTRICTS.map((d) => `${d.name}: ${label(d.id).filter(Boolean).join(', ')}`).join('; ')}.`}
        />
        {metric === 'best' ? (
          <Legend
            items={[
              { label: 'Corn earns more', color: BEST_FILL.corn },
              { label: 'Wheat earns more', color: BEST_FILL.wheat },
            ]}
          />
        ) : null}
        <Readouts
          items={[
            { label: `${DISTRICT[s.state.selected].name}: corn`, value: buAc(sel.corn), tone: 'gold' },
            { label: 'wheat', value: buAc(sel.wheat), tone: 'orange' },
            { label: 'corn returns over variable costs', value: perAcre(sel.cornMargin), tone: 'green' },
            ...(DISTRICT[s.state.selected].irrigatedKAc > 0 ? [{ label: 'irrigated corn returns', value: perAcre(sel.irrigatedMargin), tone: 'green' as const }] : []),
            { label: 'wheat returns over variable costs', value: perAcre(sel.wheatMargin), tone: 'green' },
          ]}
        />
        <Slider label="Rain" tone="blue" value={s.state.rain} min={0.6} max={1.6} step={0.1} onChange={(v) => s.set({ rain: Math.round(v * 10) / 10 })} display={`${fmt(s.state.rain * 100)}% of normal`} />
        <Slider label="Warmer or cooler" tone="red" value={s.state.temp} min={-3} max={3} step={0.5} onChange={(v) => s.set({ temp: v })} display={`${s.state.temp > 0 ? '+' : ''}${fmt(s.state.temp, 1)} °C`} />
        <Slider label="Soil water-holding" tone="blue" value={s.state.soil} min={0.6} max={1.4} step={0.1} onChange={(v) => s.set({ soil: Math.round(v * 10) / 10 })} display={`${fmt(s.state.soil * 100)}% of today’s`} />
      </Figure>

      <P>
        As the valley is, the map splits three ways. On the Black Prairie and in the River Bottoms, deep soils and plenty of summer rain make corn the clear winner:
        about 175 bushels an acre, returning $355 and $349 over variable costs against about $200 for wheat. Those are returns before machinery, labor and land —
        on a rented Prairie acre, <a href={lessonHref('agriculture/2.5')}>Lesson 2.5</a> found, those take all of it and a little more — but they are what decides
        between two crops on the same ground, since the land costs the same whichever goes in. On the High Plains, unirrigated corn averages only 73
        bushels and loses $93 an acre, while wheat — which does its growing in the cooler, wetter spring — returns $138; with wells, irrigated corn does better than
        either. In the North Tier and on the Upland Ridge the two crops come out nearly even and neither has a clear edge, the North because its season is short —
        the map’s season-length view shows it — and the Ridge because its thin soil runs dry in August. Soil alone can tip the Ridge: give the valley a tenth more
        water-holding and its corn returns {perAcre(deeper.cornMargin)} against {perAcre(deeper.wheatMargin)} for wheat, because the extra water carries the corn
        through August while the wheat, done by July, hardly notices. The same pattern holds on a continental scale in real grain belts: corn where summers are
        warm and wet and soils deep, wheat where they are drier.
      </P>
      <P>
        That pattern decides where the valley’s grain comes from. Averaged over these 50 seasons it harvests about 506 million bushels of corn and 239 million of wheat. The
        Black Prairie alone grows 45% of the corn and the River Bottoms another 24%, so more than two-thirds of the valley’s corn depends on the summer weather of two
        neighboring districts. Wheat is spread more evenly, with the High Plains growing the largest share, 36%. A dry July on the Prairie is a corn problem for the
        whole valley, and a dry spring on the Plains a wheat problem — a fact that will matter a great deal when we get to prices.
      </P>

      <H2>Changing the climate</H2>
      <P>
        Now move the valley’s climate, but predict first. The North Tier and the Upland Ridge sit near the line between the two crops for different reasons, the
        North for its short season and the Ridge for its thin soil, while the Prairie and the Bottoms sit far from it. A warmer valley would give the North a longer
        season; it would also, as <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a> showed, hurry every crop through the season it has. Which matters more?
      </P>

      <Challenge
        id="a"
        question="Predict first: which district would a valley 2 °C warmer switch from corn to wheat? Select it on the map, then set the temperature to +2.0 °C, with rain and soil at 100%, to check."
        solved={solved}
        status={
          !atWarmer
            ? `Selected: the ${selName}. Set the temperature to +2.0 °C, with rain and soil at 100%.`
            : today[s.state.selected].best === 'wheat'
              ? `The ${selName} grew wheat already, at today’s temperatures.`
              : `At +2 °C the ${selName}’s corn still returns ${perAcre(sel.cornMargin)}, against ${perAcre(sel.wheatMargin)} for wheat.`
        }
        success={`Solved: 2 °C warmer, North Tier corn falls from ${fmt(today.north.corn)} to ${fmt(warmer.north.corn)} bushels an acre and returns ${perAcre(warmer.north.cornMargin)}, against ${perAcre(warmer.north.wheatMargin)} for wheat. A longer season might seem a gift to a district whose trouble is a short one, but its hybrid already fills the season it has, and the warmth only hurries the crop through grain fill. The Ridge grew wheat already, and the Prairie and the Bottoms stay corn country even 3 °C warmer.`}
      />

      <P>
        A drier valley tips the same district: at 80% of normal rain, North Tier corn falls to 122 bushels and wheat out-earns it, and only the Prairie and the
        Bottoms stay firmly corn country. A wetter one makes corn win almost everywhere but the Plains, which even with 60% more rain earns less from dryland corn
        than from wheat. Warmth works against corn everywhere: with today’s hybrids, a valley 2 °C warmer grows less corn in every district, and the Prairie falls
        from 175 to 153 bushels. Cool the valley by 3 °C and the North’s corn suffers by the opposite route, falling from 137 bushels to 106: it no longer finishes
        before the cold. Farmers adapt, of course, by switching hybrids and planting dates, which this map doesn’t do; but the direction is the lesson. Every
        number on the map is a bet on a climate, and the climate of a given year is never the average one.
      </P>
      <P>
        That last point deserves its own picture. In the next demonstration each dot is one of the 50 seasons, and the dark tick is the district’s average; the
        figure on the right is how much a typical season strays from that average, as a share of it:
      </P>

      <Figure name="Agricultural Geography Map · year to year" scenario={y}>
        <Segmented
          label="Crop"
          value={y.state.crop}
          onChange={(v) => y.set({ crop: v })}
          options={[
            { value: 'corn', label: 'Corn' },
            { value: 'wheat', label: 'Wheat' },
          ]}
        />
        <YearToYear crop={y.state.crop} />
      </Figure>

      <P>
        On the Black Prairie and in the River Bottoms, a typical season’s corn strays 16–17% from the average; in the North Tier and on the Upland Ridge, 24%; and
        unirrigated corn on the High Plains, 60%, anywhere from a single bushel to 185 across these 50 seasons. Wheat is steadier everywhere — 6–9% except on the
        Plains, 16% — because it grows in spring, when the soil is still full from winter. Irrigation steadies Plains corn too, to 9%. So geography sets not just
        what a place grows but how much its harvest swings, and a valley that grows most of its corn on deep, rain-fed soil is still exposed to the summer that
        dries all of it at once. Those swings are the raw material of the rest of this chapter.
      </P>

      <P>
        Geography, as <FigRef to="Agricultural Geography Map">the map</FigRef> showed, sets the odds; the weather of a particular year deals the hand. The next lesson looks at the worst hands — the droughts, heat waves and frosts that
        take a crop from a normal season to a disaster — and at why their timing matters as much as their size.
      </P>
    </LessonPage>
  );
}

