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
  mix,
  scale,
  useAnimationFrame,
  usd,
  useScenario,
  usePlay,
} from '../../../framework';
import { ELEVATOR_OF, NEW_SEASONS, cornAcreFactor, cornSpec, farmClimatology, farmFits, farmForecast, type FarmDesign } from '../../../engines/agriculture/capstone';
import { CHECKPOINTS, FINAL_REPORT, decFutures, harvestBasis, cropYear, thetaOn, fullCarry } from '../../../engines/agriculture/market';
import { fieldSeason } from '../../../engines/agriculture/farm';
import { CORN_STAGES } from '../../../engines/agriculture/crop';
import { normalYear, simulatedYear } from '../../../model/agriculture/climate';
import { DISTRICT, dateLabel, dayOf } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { inch } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';
import { useCapstone } from '../shared/capstone';

const START = dayOf(5, 1);
const END = FINAL_REPORT;
const Z80 = 1.2816;

/** The farm's yield forecast on each day of a season, for drawing. */
function forecastPath(d: FarmDesign, year: number): Array<{ day: number; mean: number; sd: number }> {
  const out: Array<{ day: number; mean: number; sd: number }> = [];
  for (let t = START; t <= END; t += 2) out.push({ day: t, ...farmForecast(d, year, t) });
  return out;
}

/** Challenge 1: the season whose August 1 forecast missed the farm's harvest by the most. */
export function worstAugustMiss(d: FarmDesign): number {
  let worst = NEW_SEASONS[0];
  let miss = -1;
  for (const y of NEW_SEASONS) {
    const m = Math.abs(fieldSeason(y, cornSpec(d)).yield - farmForecast(d, y, dayOf(8, 1)).mean);
    if (m > miss) {
      miss = m;
      worst = y;
    }
  }
  return worst;
}

export interface Calibration {
  day: number;
  /** Seasons whose harvest fell inside the forecast's 80% band, and the typical miss, bushels an acre. */
  inside: number;
  mae: number;
  points: Array<{ year: number; mean: number; sd: number; actual: number }>;
}

export function calibration(d: FarmDesign): Calibration[] {
  return CHECKPOINTS.map((day) => {
    const points = NEW_SEASONS.map((year) => ({ year, ...farmForecast(d, year, day), actual: fieldSeason(year, cornSpec(d)).yield }));
    return {
      day,
      points,
      inside: points.filter((p) => Math.abs(p.actual - p.mean) <= Z80 * p.sd).length,
      mae: points.reduce((a, p) => a + Math.abs(p.actual - p.mean), 0) / points.length,
    };
  });
}

/** Challenge 2: the checkpoint whose 80% bands held the harvest closest to 80% of the time. */
export function bestCalibrated(d: FarmDesign): number {
  const c = calibration(d);
  let best = c[0];
  for (const k of c) if (Math.abs(k.inside / NEW_SEASONS.length - 0.8) < Math.abs(best.inside / NEW_SEASONS.length - 0.8) - 1e-9) best = k;
  return best.day;
}

function Player({ playing, day, onDay, onEnd }: { playing: boolean; day: number; onDay: (d: number) => void; onEnd: () => void }) {
  useAnimationFrame((dt) => {
    const next = Math.min(END, day + dt * 24);
    onDay(Math.round(next * 10) / 10);
    if (next >= END) onEnd();
  }, playing);
  return null;
}

const CHECK_LABEL: Record<number, string> = Object.fromEntries(CHECKPOINTS.map((c) => [c, dateLabel(c)]));

function CalibrationChart({ c, clim }: { c: Calibration; clim: number }) {
  const lo = 80;
  const hi = 260;
  const x = scale(lo, hi, 70, 620);
  const y = scale(lo, hi, 250, 24);
  return (
    <svg className="chart" viewBox="0 0 640 282" role="img" aria-label={`Forecasts on ${dateLabel(c.day)} against the harvests that came, in forty seasons: ${c.inside} harvests inside the forecast’s 80% band.`}>
      <text className="ax" x={70} y={14}>
        Harvest, bushels an acre
      </text>
      <GridY y={y} ticks={[100, 150, 200, 250]} x0={70} x1={620} format={(v) => fmt(v)} />
      <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="#999" strokeDasharray="4 4" />
      <line x1={x(clim)} x2={x(clim)} y1={24} y2={250} stroke="#bbb" strokeDasharray="2 3" />
      {c.points.map((p) => {
        const inside = Math.abs(p.actual - p.mean) <= Z80 * p.sd;
        const color = inside ? GRAPHIC.teal : GRAPHIC.red;
        return (
          <g key={p.year}>
            <line x1={x(Math.max(lo, p.mean - Z80 * p.sd))} x2={x(Math.min(hi, p.mean + Z80 * p.sd))} y1={y(p.actual)} y2={y(p.actual)} stroke={mix('#fcfcfb', color, 0.55)} strokeWidth={2} />
            <circle cx={x(p.mean)} cy={y(p.actual)} r={3.4} fill={color} />
          </g>
        );
      })}
      {[100, 150, 200, 250].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={266}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={280}>
        forecast, bushels an acre
      </text>
    </svg>
  );
}

export default function Lesson() {
  const { farm } = useCapstone();
  const s = useScenario('season', { year: 61, day: dayOf(8, 1) });
  const play = usePlay(false);
  const year = s.state.year;
  const day = Math.round(s.state.day);
  const season = useMemo(() => fieldSeason(year, cornSpec(farm)), [year, farm]);
  const path = useMemo(() => forecastPath(farm, year), [year, farm]);
  const clim = farmClimatology(farm);
  const now = farmForecast(farm, year, day);
  const fut = decFutures(year, Math.min(day, END));
  const factor = cornAcreFactor(farm);
  const hub = ELEVATOR_OF[farm.district];
  const basis = harvestBasis(cropYear(year).valley, thetaOn(year, Math.min(day, END)), fullCarry(fut), hub);
  const weather = useMemo(() => simulatedYear(year, farm.district), [year, farm.district]);
  const normal = useMemo(() => normalYear(farm.district), [farm.district]);
  let rain = 0;
  let rainN = 0;
  for (let t = START; t < day; t++) {
    rain += weather[t].rain;
    rainN += normal[t].rain;
  }
  const today = season.days.find((x) => x.day === day) ?? season.days[season.days.length - 1];
  const stage = today && today.stage >= 0 ? `${CORN_STAGES[today.stage].code}, ${CORN_STAGES[today.stage].name}` : 'not yet up';
  const shown = path.filter((p) => p.day <= day);
  const waterDays = season.days.filter((x) => x.day >= START && x.day <= day);
  const worst = useMemo(() => worstAugustMiss(farm), [farm]);
  const solved1 = year === worst && day >= FINAL_REPORT;
  const augMiss = Math.abs(season.yield - farmForecast(farm, year, dayOf(8, 1)).mean);

  const c = useScenario('calibration', { day: dayOf(8, 1) });
  const cal = useMemo(() => calibration(farm), [farm]);
  const sel = cal.find((k) => k.day === c.state.day) ?? cal[0];
  const bestDay = useMemo(() => bestCalibrated(farm), [farm]);
  const solved2 = c.state.day === bestDay;
  void farmFits;

  return (
    <LessonPage id="agriculture/6.2">
      <P>
        <a href={lessonHref('agriculture/6.1')}>The farm you designed</a> was judged on sixty seasons at once. Now it lives them one at a time. The seasons in this
        lesson are new: simulated years 61 to 100, which the market history of Chapter 5 never included, so nothing in them was used to build the forecasts or to
        choose the design. They are, in effect, the next forty years of the valley’s weather, drawn from the same climate. On May 1 the farmer knows the soil, the hybrid and the long-run odds — an average harvest of {fmt(clim.mean)} bushels an acre, give or
        take {fmt(clim.sd)} — and nothing about the summer to come.
      </P>
      <P>
        Then the season reports in, a little at a time. Rain falls or doesn’t, and the soil’s water rises and falls as in{' '}
        <a href={lessonHref('agriculture/1.4')}>Lesson 1.4</a>. On the first of June, July, August and September, the farm runs the forecast of{' '}
        <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> on what can be seen in its district — temperature, rain, satellite NDVI and the crop’s condition —
        refitted for this farm’s own corn on two hundred other seasons. Each forecast is a most likely yield and a band that should hold the harvest four times
        in five: its <K tone="teal">80% band</K>. In October the combines report the truth field by field. In the next demonstration the upper chart is the water
        in the farm’s root zone, the lower one its yield forecast with the band, and the dashed line the long-run average. Choose a season and play it, or drag
        across the charts to move through it:
      </P>

      <Figure name="Season Simulator" scenario={s} play={{ playing: play.playing, toggle: play.toggle }}>
        <Player playing={play.playing} day={s.state.day} onDay={(v) => s.set({ day: v })} onEnd={() => play.setPlaying(false)} />
        <DayChart
          days={waterDays.map((x) => x.day)}
          series={[
            { values: waterDays.map((x) => x.water * 100), color: GRAPHIC.blue, kind: 'area', opacity: 0.3 },
            { values: waterDays.map((x) => x.water * 100), color: GRAPHIC.blue, width: 2 },
          ]}
          from={START}
          to={END}
          yMin={0}
          yMax={100}
          yTicks={[0, 50, 100]}
          yLabel="Water left in the root zone, %"
          yFormat={(v) => `${v}%`}
          height={140}
          cursor={day}
          onScrub={(v) => s.set({ day: Math.max(START, Math.min(END, v)) })}
          ariaLabel={`Water in the farm’s root zone from May 1 to ${dateLabel(day)} of season ${year}.`}
        />
        <DayChart
          days={shown.map((p) => p.day)}
          series={[
            { values: shown.map((p) => p.mean + Z80 * p.sd), color: mix('#fcfcfb', GRAPHIC.teal, 0.5), width: 1.2 },
            { values: shown.map((p) => Math.max(0, p.mean - Z80 * p.sd)), color: mix('#fcfcfb', GRAPHIC.teal, 0.5), width: 1.2 },
            { values: shown.map((p) => p.mean), color: GRAPHIC.teal, width: 2.5 },
          ]}
          from={START}
          to={END}
          yMin={60}
          yMax={260}
          yTicks={[100, 150, 200, 250]}
          yLabel="Forecast corn yield, bushels an acre"
          yFormat={(v) => fmt(v)}
          height={200}
          cursor={day}
          onScrub={(v) => s.set({ day: Math.max(START, Math.min(END, v)) })}
          refLines={[
            { y: clim.mean, label: 'long-run average', color: '#888', dash: '4 4' },
            ...(day >= END ? [{ y: season.yield, label: `harvest ${fmt(season.yield)}`, color: MARKET_LINE.cash }] : []),
          ]}
          marks={CHECKPOINTS.map((cp) => ({ day: cp, label: CHECK_LABEL[cp], color: '#bbb', dash: '2 3' }))}
          ariaLabel={`The farm’s yield forecast through season ${year}: on ${dateLabel(day)}, ${fmt(now.mean)} bushels an acre, with an 80% band from ${fmt(now.mean - Z80 * now.sd)} to ${fmt(now.mean + Z80 * now.sd)}.`}
        />
        <Legend
          items={[
            { label: 'Forecast', color: GRAPHIC.teal, kind: 'line' },
            { label: '80% band', color: mix('#fcfcfb', GRAPHIC.teal, 0.5), kind: 'line' },
            { label: 'Long-run average', color: '#888', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `${dateLabel(day)}: the corn`, value: stage, tone: 'gold' },
            { label: 'rain since May 1', value: `${inch(rain)} (normal ${inch(rainN)})`, tone: 'blue' },
            { label: 'yield forecast', value: now.sd > 0 ? `${fmt(now.mean)} ± ${fmt(Z80 * now.sd)} bu/ac` : `${fmt(now.mean)} bu/ac, harvested`, tone: 'teal' },
            { label: 'corn revenue, expected', value: usd(Math.round((now.mean * factor * (fut + basis)) / 1000) * 1000), tone: 'green' },
          ]}
        />
        <Slider label="Season" value={year} min={NEW_SEASONS[0]} max={NEW_SEASONS[NEW_SEASONS.length - 1]} onChange={(v) => s.set({ year: v })} display={String(year)} />
      </Figure>

      <P>
        Play a few seasons and watch what the farmer is up against. In June the forecast stays close to the long-run average: the corn is small and the summer
        that decides it hasn’t happened. July narrows the band a little. By August 1 the forecast knows how pollination went; by September 1 it knows most of
        the story, and its band is half as wide as in June. Meanwhile the expected revenue moves with December futures, and when the farm’s crop goes short the
        price often rises to meet it. The decisions a farmer makes in July — how much corn to sell ahead, whether to spray, whether to book trucks for a big
        harvest — are made with the August band, not the October harvest.
      </P>
      <P>
        Season 82 shows a drought arriving the way droughts do, a little at a time. For Cedar Bend’s own design, the forecast on June 1 expected 172 bushels an
        acre, a shade under average, though the spring had already been an inch and a third short of rain. After a dry, warm June it expected 161; after a July
        two degrees hotter than normal and four and a half inches short of rain, 150; and on September 1, with the canopy browning early in the satellite
        images, 125. The farm harvested 117. Nothing on June 1 said “drought”: the dry soil in the upper chart was the first sign, the forecast the second, and
        each month the band slid lower before the truth was known. A farmer who sold corn ahead in June on the long-run average would have promised bushels the farm never grew —
        the double blow of <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a>. One who waited for the August band would have sold less.
      </P>

      <Challenge
        id="a"
        question="Find the season, of the forty, in which the farm’s August 1 forecast missed its harvest by the most. Play it to the end."
        solved={solved1}
        status={day < FINAL_REPORT ? `Season ${year}: play it to November 9 to see the harvest.` : `In season ${year} the August 1 forecast missed by ${fmt(augMiss)} bushels an acre.`}
        success={`Solved: in season ${year} the August 1 forecast said ${fmt(farmForecast(farm, year, dayOf(8, 1)).mean)} bushels an acre and the farm harvested ${fmt(season.yield)}, a miss of ${fmt(augMiss)}. What the forecast couldn’t see on August 1 was the rest of the summer: the weather of grain fill, after the satellites’ last look. No forecast made on August 1 can know it.`}
      />

      <H2>Are the bands honest?</H2>
      <P>
        A band that claims to hold the harvest four times in five should do so about four times in five — no more, or it is wider than it needs to be, and no
        less, or it is overconfident. That property is called <K tone="teal">calibration</K>, and it can only be checked over many seasons. In the next
        demonstration each dot is one of the forty new seasons: the forecast across, the harvest up, and the bar the forecast’s 80% band. Dots on the dashed
        line were forecast exactly. Choose the checkpoint:
      </P>

      <Figure name="Season Simulator · forty seasons" scenario={c}>
        <CalibrationChart c={sel} clim={clim.mean} />
        <Legend
          items={[
            { label: 'Harvest inside the band', color: GRAPHIC.teal },
            { label: 'Harvest outside it', color: GRAPHIC.red },
          ]}
        />
        <Readouts
          items={[
            { label: 'inside the 80% band', value: `${sel.inside} of ${NEW_SEASONS.length}`, tone: 'teal' },
            { label: 'typical miss', value: `${fmt(sel.mae, 1)} bu/ac` },
            { label: 'band half-width', value: `${fmt(Z80 * sel.points[0].sd)} bu/ac` },
          ]}
        />
        <Segmented label="Forecast made on" value={String(c.state.day)} onChange={(v) => c.set({ day: Number(v) })} options={CHECKPOINTS.map((cp) => ({ value: String(cp), label: CHECK_LABEL[cp] }))} />
      </Figure>

      <P>
        For Cedar Bend’s own design the bands held the harvest in 35, 32, 33 and 34 of the forty seasons, from June to September, against the 32 that an honest
        80% band would hold on average; and the typical miss fell from 21 bushels an acre in June to 10 in September. The forecasts are uncertain, but honest about
        it — which is the most a forecast can be. Your own design in {DISTRICT[farm.district].name} has its own numbers, shown in the demonstration; the
        lesson is the same.
      </P>
      <P>
        Calibration is what makes a forecast useful to a business. A lender deciding how much operating credit a farm can carry, an insurer pricing a revenue
        policy, and a merchant deciding how much corn to buy forward all need to know how far wrong the forecast can be, not only what it expects. An honest 80%
        band says that one season in five will fall outside it — eight of the forty here — and a plan that can’t survive those eight is a plan that will fail.
        Real forecasters are judged the same way: by how often the truth lands where they said it would, over many seasons.
      </P>

      <Challenge
        id="b"
        question="For your farm, find the checkpoint whose 80% bands held the harvest closest to 80% of the time."
        solved={solved2}
        status={`On ${dateLabel(sel.day)} the bands held ${sel.inside} of ${NEW_SEASONS.length} harvests, ${fmt((sel.inside / NEW_SEASONS.length) * 100)}%.`}
        success={`Solved: on ${dateLabel(sel.day)} the bands held ${sel.inside} of the forty harvests, ${fmt((sel.inside / NEW_SEASONS.length) * 100)}% — the forecast means what it says. A trader, a lender or an insurer can only use a forecast whose bands can be trusted, which is why the width of a forecast matters as much as its center.`}
      />

      <P>
        <FigRef to="Season Simulator">The season</FigRef> showed one farm’s view of its own crop. A market cares about the whole valley’s, and pays for knowing it
        before everyone else. The next lesson turns the tables: you make the forecast, for the valley’s harvest, and the scoring is strict.
      </P>
    </LessonPage>
  );
}
