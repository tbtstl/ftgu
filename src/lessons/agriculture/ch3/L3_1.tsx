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

/** The challenge: the smallest increase in the Upland Ridge's water-holding (10% steps) at which its corn out-earns its wheat. */
export function ridgeSoilSolved(c: Climate): boolean {
  if (c.rain !== 1 || c.temp !== 0) return false;
  const wins = (soil: number) => {
    const s = suitability({ rain: 1, temp: 0, soil }).ridge;
    return s.cornMargin > s.wheatMargin;
  };
  return c.soil > 1 && wins(c.soil) && !wins(Math.round((c.soil - 0.1) * 10) / 10);
}

const BEST_FILL: Record<Best, string> = { corn: mix('#fcfcfb', CROP_LINE.corn, 0.55), wheat: mix('#fcfcfb', CROP_LINE.wheat, 0.5), irrigated: mix('#fcfcfb', GRAPHIC.blue, 0.4) };

function ramp(v: number, lo: number, hi: number, color: string) {
  return mix('#f4f1e8', color, 0.15 + 0.75 * Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}

/** Each district's yields across 50 seasons, as rows of dots. */
function YearToYear({ crop }: { crop: 'corn' | 'wheat' }) {
  const rows = DISTRICTS.map((d) => {
    const ys = YEARS.map((y) => {
      const s = valleySeason(y).districts[d.id];
      return crop === 'corn' ? s.corn : s.wheat;
    });
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length - 1));
    return { d, ys, mean, cv: sd / mean };
  });
  const x = scale(0, crop === 'corn' ? 260 : 100, 150, 600);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`${crop === 'corn' ? 'Unirrigated corn' : 'Wheat'} yields in each district over 50 simulated seasons. ${rows.map((r) => `${r.d.name}: average ${fmt(r.mean)}, varying by ${fmt(r.cv * 100)}%`).join('; ')}.`}
    >
      {rows.map((r, i) => {
        const y = 30 + i * 42;
        return (
          <g key={r.d.id}>
            <text className="lab" x={140} y={y + 4} textAnchor="end">
              {r.d.name}
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
        <text key={v} className="ax ax-m" x={x(v)} y={240}>
          {v}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('map', { metric: 'best' as Metric, rain: 1, temp: 0, soil: 1, selected: 'ridge' as DistrictId });
  const c = { rain: s.state.rain, temp: s.state.temp, soil: s.state.soil };
  const suit = useMemo(() => suitability(c), [c.rain, c.temp, c.soil]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = suit[s.state.selected];
  const solved = useMemo(() => ridgeSoilSolved(c), [c.rain, c.temp, c.soil]); // eslint-disable-line react-hooks/exhaustive-deps
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
        brings 38 inches to the River Bottoms and 22 to the High Plains. The <K tone="red">growing season</K> — the warmth available between spring and autumn, which
        we measure in degree days as in <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a> — is longest on the High Plains and in the River Bottoms and shortest in the North Tier. And the{' '}
        <K tone="teal">soil</K> decides how much of the rain is kept for the crop: the Black Prairie and the Bottoms hold 11 inches of water in the root zone, the
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
            { label: 'corn returns', value: perAcre(sel.cornMargin), tone: 'green' },
            { label: 'wheat returns', value: perAcre(sel.wheatMargin), tone: 'green' },
          ]}
        />
        <Slider label="Rain" tone="blue" value={s.state.rain} min={0.6} max={1.6} step={0.1} onChange={(v) => s.set({ rain: Math.round(v * 10) / 10 })} display={`${fmt(s.state.rain * 100)}% of normal`} />
        <Slider label="Warmer or cooler" tone="red" value={s.state.temp} min={-3} max={3} step={0.5} onChange={(v) => s.set({ temp: v })} display={`${s.state.temp > 0 ? '+' : ''}${fmt(s.state.temp, 1)} °C`} />
        <Slider label="Soil water-holding" tone="teal" value={s.state.soil} min={0.6} max={1.4} step={0.1} onChange={(v) => s.set({ soil: Math.round(v * 10) / 10 })} display={`${fmt(s.state.soil * 100)}% of today’s`} />
      </Figure>

      <P>
        As the valley is, the map splits three ways. On the Black Prairie and in the River Bottoms, deep soils and plenty of summer rain make corn the clear winner:
        about 175 bushels an acre, returning $355 and $349 over variable costs against about $200 for wheat. On the High Plains, unirrigated corn averages only 73
        bushels and loses $93 an acre, while wheat — which does its growing in the cooler, wetter spring — returns $138; with wells, irrigated corn does better than
        either. In the North Tier and on the Upland Ridge the two crops come out nearly even, the North because its season is short and the Ridge because its thin
        soil runs dry in August. The same pattern holds on a continental scale in real grain belts: corn where summers are warm and wet and soils deep, wheat where
        they are drier.
      </P>
      <P>
        That pattern decides where the valley’s grain comes from. In an average season it harvests about 506 million bushels of corn and 239 million of wheat. The
        Black Prairie alone grows 45% of the corn and the River Bottoms another 24%, so more than two-thirds of the valley’s corn depends on the summer weather of two
        neighboring districts. Wheat is spread more evenly, with the High Plains growing the largest share, 36%. A dry July on the Prairie is a corn problem for the
        whole valley, and a dry spring on the Plains a wheat problem — a fact that will matter a great deal when we get to prices.
      </P>

      <Challenge
        id="a"
        question="On the Upland Ridge, wheat narrowly out-earns corn. Keeping today’s rain and temperatures, what is the smallest increase in the soil’s water-holding, in 10% steps, that makes corn earn more?"
        solved={solved}
        status={
          s.state.rain !== 1 || s.state.temp !== 0
            ? 'Set rain back to 100% and temperature to +0.0 °C.'
            : `With soil at ${fmt(s.state.soil * 100)}%, Ridge corn returns ${perAcre(suit.ridge.cornMargin)} and wheat ${perAcre(suit.ridge.wheatMargin)}.`
        }
        success={`Solved: at ${fmt(s.state.soil * 100)}% of today’s water-holding, Ridge corn returns ${perAcre(suit.ridge.cornMargin)} against ${perAcre(suit.ridge.wheatMargin)} for wheat. A tenth more water in the root zone carries the corn through August often enough to tip the balance — and wheat, which is done by July, hardly notices. Soil is a slow-moving part of geography, but it decides which crop a place grows as surely as the rain does.`}
      />

      <H2>Changing the climate</H2>
      <P>
        Now move the valley’s climate. A drier valley loses corn first: at 80% of normal rain, North Tier corn falls to 122 bushels and wheat out-earns it, and only the
        Prairie and the Bottoms stay firmly corn country. A wetter one makes corn win almost everywhere but the Plains, which even with 60% more
        rain earns less from dryland corn than from wheat. Warmth is subtler. With today’s hybrids, a valley 2 °C warmer grows less corn everywhere — the Prairie
        falls from 175 to 153 bushels — because, as Lesson 1.2 showed, a warmer season races the crop through grain fill. Cooling the North by 3 °C hurts too, by
        the opposite route: its corn no longer finishes before the cold. Farmers adapt, of course, by switching hybrids and planting dates, which this map doesn’t
        do; but the direction is the lesson. Every number on the map is a bet on a climate, and the climate of a given year is never the average one.
      </P>
      <P>
        That last point deserves its own picture. In the next demonstration each dot is one of the 50 seasons, and the dark tick is the district’s average; the
        figure on the right is how much a typical season strays from that average:
      </P>

      <Figure name="Agricultural Geography Map · year to year" scenario={y}>
        <Segmented
          label="Crop"
          value={y.state.crop}
          onChange={(v) => y.set({ crop: v })}
          options={[
            { value: 'corn', label: 'Unirrigated corn' },
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

