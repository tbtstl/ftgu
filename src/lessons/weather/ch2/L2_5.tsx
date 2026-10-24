import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
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
  Slider,
  TEXT,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { climateSeries, dateOfYear, histogram, monthNormal, monthSample, monthStats, yearBands, type MonthStats } from '../../../engines/weather/climatology';
import { YEARS } from '../../../model/weather/archive';
import { CALDER, MARLOW, MONTH_NAMES, MONTH_SHORT, MONTH_START, RIDGE, climateOf, fToC, normalTemp, type Climate, type StationId } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The reader's station.

export interface StationSettings {
  /** Degrees north. */
  latitude: number;
  /** 0 = a coast where the wind blows in off the sea; 1 = deep inland. */
  continentality: number;
  /** Meters above sea level. */
  elevation: number;
}

/** The first demonstration starts with a station at Calder Bay's latitude, on a coast where the wind comes off the sea. */
export const STATION_DEFAULTS: StationSettings = { latitude: 41, continentality: 0.1, elevation: 0 };

/** The reader's station shares Calder Bay's sensitivity to El Niño. */
export function stationOf(s: StationSettings): Climate {
  return climateOf({ latitude: s.latitude, continentality: s.continentality, elevation: s.elevation, ensoF: CALDER.ensoF });
}

/**
 * The first challenge: a January colder (on average) than Marlow's, with midwinter days that swing
 * less from one to the next than Calder Bay's.
 */
export function steadyColdSolved(s: StationSettings): boolean {
  const cl = stationOf(s);
  return monthNormal(cl, 0) < monthNormal(MARLOW, 0) && cl.winterSd < CALDER.winterSd;
}

// ---------------------------------------------------------------------------
// The region's three stations, through the 41 simulated years.

const STATION_ROWS: Array<{ id: StationId; name: string; climate: Climate }> = [
  { id: 'calder', name: 'Calder Bay', climate: CALDER },
  { id: 'marlow', name: 'Marlow', climate: MARLOW },
  { id: 'ridge', name: 'Hollin Ridge', climate: RIDGE },
];

let seriesCache: Record<StationId, Float64Array> | null = null;
function stationSeries(): Record<StationId, Float64Array> {
  if (!seriesCache) seriesCache = { calder: climateSeries(CALDER, 'calder'), marlow: climateSeries(MARLOW, 'marlow'), ridge: climateSeries(RIDGE, 'ridge') };
  return seriesCache;
}

/** A station's days in a month, across all the archive's years: the spread and its middle 80%. */
export function stationMonth(id: StationId, month: number): MonthStats {
  return monthStats(monthSample(stationSeries()[id], month));
}

/** Width of the middle 80% of Calder Bay's days in a month (90th minus 10th percentile), °F. */
export function calderSpread(month: number): number {
  const s = stationMonth('calder', month);
  return s.p90 - s.p10;
}

/** The month in which Calder Bay's days are most alike. */
export function steadiestMonth(): number {
  let best = 0;
  for (let m = 1; m < 12; m++) if (calderSpread(m) < calderSpread(best)) best = m;
  return best;
}

/** The second challenge: find that month. */
export function steadiestSolved(month: number): boolean {
  return month === steadiestMonth();
}

// ---------------------------------------------------------------------------
// The year chart.

const YX = scale(0, 365, 56, 620);
const YY = scale(-40, 100, 286, 26);

function continentalityWords(c: number): string {
  if (c <= 0.2) return 'a coast, wind off the sea';
  if (c <= 0.5) return 'near a windward sea';
  if (c <= 0.85) return 'wind mostly off the land';
  return 'deep inland';
}

function clampY(v: number) {
  return YY(Math.max(-40, Math.min(100, v)));
}

function YearChart({ mine, settings }: { mine: Climate; settings: StationSettings }) {
  const calderBands = useMemo(() => yearBands(stationSeries().calder), []);
  const myBands = useMemo(() => yearBands(climateSeries(mine)), [mine]);
  const days = Array.from({ length: 74 }, (_, i) => Math.min(365, i * 5));
  const normalLine = (cl: Climate) => linePath(days.map(YX), days.map((d) => clampY(normalTemp(cl, d))));
  const band = (b: { doy: number[]; low: number[]; high: number[] }) => areaPath(b.doy.map(YX), b.high.map(clampY), b.low.map(clampY));
  const jan = monthNormal(mine, 0);
  const jul = monthNormal(mine, 6);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 316"
      role="img"
      aria-label={`The year at Calder Bay and at a station at ${fmt(settings.latitude, 1)}° north, continentality ${fmt(settings.continentality, 2)}, ${fmt(settings.elevation)} m up. Its normal runs from ${fmt(jan)} °F in January to ${fmt(jul)} °F in July, against Calder Bay’s ${fmt(monthNormal(CALDER, 0))} °F and ${fmt(monthNormal(CALDER, 6))} °F; the shaded bands hold the middle 80% of the ${YEARS} simulated years’ days.`}
    >
      <text className="ax" x={56} y={14}>
        Daily mean temperature, °F
      </text>
      <GridY y={YY} ticks={[-40, -20, 0, 20, 40, 60, 80, 100]} x0={56} x1={620} format={(v) => `${v}°`} />
      <line x1={56} x2={620} y1={YY(32)} y2={YY(32)} stroke={GRAPHIC.blue} strokeWidth={1} strokeDasharray="3 4" opacity={0.6} />
      <text className="ax" x={616} y={YY(32) - 4} textAnchor="end" style={{ fill: TEXT.blue }}>
        freezing
      </text>
      <path d={band(calderBands)} fill="#8a8a8a" opacity={0.22} />
      <path d={band(myBands)} fill={GRAPHIC.red} opacity={0.2} />
      <path d={normalLine(CALDER)} fill="none" stroke="#555" strokeWidth={2} strokeDasharray="6 4" />
      <path d={normalLine(mine)} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} />
      {MONTH_START.map((s, m) => (
        <g key={m}>
          <line className="gl" x1={YX(s)} x2={YX(s)} y1={282} y2={290} />
          <text className="ax ax-m" x={YX(s + 15)} y={304}>
            {MONTH_SHORT[m]}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The month histograms.

const HX = scale(-20, 100, 104, 620);
const BIN = 2;
const BINS = 60;
const ROW_H = 78;

function MonthHistograms({ month }: { month: number }) {
  const series = stationSeries();
  const rows = STATION_ROWS.map((r) => {
    const sample = monthSample(series[r.id], month);
    return { ...r, stats: monthStats(sample), counts: histogram(sample, -20, BIN, BINS) };
  });
  const maxCount = Math.max(...rows.flatMap((r) => r.counts));
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${rows.length * ROW_H + 40}`}
      role="img"
      aria-label={`Daily mean temperatures in ${MONTH_NAMES[month]} over the ${YEARS} simulated years. ${rows
        .map((r) => `${r.name}: average ${fmt(r.stats.mean)} °F, middle 80% of days from ${fmt(r.stats.p10)} to ${fmt(r.stats.p90)} °F`)
        .join('; ')}.`}
    >
      {rows.map((r, k) => {
        const y0 = 16 + k * ROW_H;
        const yb = y0 + ROW_H - 18;
        const h = (c: number) => ((ROW_H - 26) * c) / maxCount;
        return (
          <g key={r.id}>
            <text className="lab" x={8} y={yb - 22}>
              {r.name}
            </text>
            <text className="ax" x={8} y={yb - 6}>
              sd {fmt(r.stats.sd, 1)} °F
            </text>
            {r.counts.map((c, i) => {
              const lo = -20 + i * BIN;
              const inside = lo + BIN > r.stats.p10 && lo < r.stats.p90;
              return c > 0 ? <rect key={i} x={HX(lo) + 0.5} y={yb - h(c)} width={HX(BIN) - HX(0) - 1} height={h(c)} fill={inside ? GRAPHIC.red : tint(GRAPHIC.red, 0.4)} opacity={inside ? 0.7 : 1} /> : null;
            })}
            <line className="base" x1={HX(-20)} x2={HX(100)} y1={yb} y2={yb} />
            <line x1={HX(r.stats.mean)} x2={HX(r.stats.mean)} y1={yb - (ROW_H - 22)} y2={yb} stroke="#333" strokeWidth={1.5} strokeDasharray="3 3" />
            <line x1={HX(r.stats.p10)} x2={HX(r.stats.p90)} y1={yb + 6} y2={yb + 6} stroke={GRAPHIC.red} strokeWidth={2} />
            <line x1={HX(r.stats.p10)} x2={HX(r.stats.p10)} y1={yb + 2} y2={yb + 10} stroke={GRAPHIC.red} strokeWidth={2} />
            <line x1={HX(r.stats.p90)} x2={HX(r.stats.p90)} y1={yb + 2} y2={yb + 10} stroke={GRAPHIC.red} strokeWidth={2} />
          </g>
        );
      })}
      {[-20, 0, 20, 40, 60, 80, 100].map((t) => (
        <text key={t} className="ax ax-m" x={HX(t)} y={rows.length * ROW_H + 30}>
          {t}°F
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('station', STATION_DEFAULTS);
  const st = s.state;
  const mine = useMemo(() => stationOf(st), [st]);
  const solved = steadyColdSolved(st);

  const m = useScenario('month', { month: 0 });
  const month = m.state.month;
  const monthRows = STATION_ROWS.map((r) => ({ ...r, stats: stationMonth(r.id, month) }));
  const solved2 = steadiestSolved(month);
  const steadiest = steadiestMonth();

  const tableRows = [...STATION_ROWS.map((r) => ({ key: r.id, name: r.name, cl: r.climate, mine: false })), { key: 'mine', name: 'Your station', cl: mine, mine: true }];

  // Numbers the prose quotes.
  const calderJan = monthNormal(CALDER, 0);
  const calderJul = monthNormal(CALDER, 6);
  const sea = stationOf(STATION_DEFAULTS);
  const janStats = stationMonth('calder', 0);
  const julStats = stationMonth('calder', 6);
  const marlowJan = stationMonth('marlow', 0);

  return (
    <LessonPage id="weather/2.5">
      <P>
        This chapter has assembled the machinery of large-scale weather. Unequal heating drives a planetary circulation whose westerlies sweep across 41° north (
        <a href={lessonHref('weather/2.1')}>Lesson 2.1</a>). Air masses from the north and the south meet along fronts and are forced up over each other (
        <a href={lessonHref('weather/2.2')}>Lesson 2.2</a>). Heat and moisture build storms (<a href={lessonHref('weather/2.3')}>Lesson 2.3</a>), and the slow
        warming and cooling of the tropical Pacific tilts whole winters (<a href={lessonHref('weather/2.4')}>Lesson 2.4</a>). Every place on the planet gets the same
        machinery, but in different proportions. This lesson asks what that does to the weather of a particular place.
      </P>
      <P>
        The answer is its <K tone={WX.temperature}>climate</K>. A climate is often summarized by an average, but the average is the least interesting thing about it.
        What a place’s climate really is, and what anyone exposed to it has to plan for, is the whole distribution of its weather: how warm a typical July day is,
        and also how cold the coldest tenth of its January days are, and how far one day can differ from the next.
      </P>
      <P>
        As in the previous lesson, station temperatures are in degrees Fahrenheit, the way weather records in the United States are kept and the way the weather
        contracts later in this course are counted. A Fahrenheit degree is five-ninths of a Celsius degree, and water freezes at 32 °F. The records themselves come from this
        course’s simulated archive: {YEARS} years of daily weather at the region’s three stations — Calder Bay on the coast, Marlow on the plains 350 km inland,
        and Hollin Ridge, 700 m up, to the north-west — generated by a model, not measured. Calder Bay averages {fmt(CALDER.annualMean, 1)} °F (
        {fmt(fToC(CALDER.annualMean), 1)} °C) over the year, with a January normal of {fmt(calderJan, 1)} °F and a July normal of {fmt(calderJul, 1)} °F.
      </P>
      <P>
        Every station’s normal year in the model comes from three facts about where it is: its latitude, how far it lies from a sea the wind blows in from, and its
        height. In the next demonstration, the dashed line is Calder Bay’s normal year and the gray band holds the middle 80% of its {YEARS} simulated years’ days.
        The red line and band are a station you build, which starts on a coast at Calder Bay’s latitude where the wind comes in off the sea. Its day-to-day ups and
        downs follow Calder Bay’s weather, reshaped to its own climate. Move it:
      </P>

      <Figure name="Climate Geography Explorer" scenario={s}>
        <YearChart mine={mine} settings={st} />
        <Legend
          items={[
            { label: 'Calder Bay, normal', color: '#555', kind: 'line', dashed: true },
            { label: 'Calder Bay, middle 80% of days', color: tint('#8a8a8a', 0.4) },
            { label: 'Your station, normal', color: GRAPHIC.red, kind: 'line' },
            { label: 'Your station, middle 80% of days', color: tint(GRAPHIC.red, 0.35) },
          ]}
        />
        <DataTable
          caption="Each station's climate: annual mean, January and July normals, its coldest day, and the standard deviation of its daily temperatures in midwinter and midsummer"
          rows={tableRows}
          rowKey={(r) => r.key}
          rowClass={(r) => (r.mine ? 'hl' : '')}
          columns={[
            { label: 'Station', cell: (r) => r.name },
            { label: 'Year', cell: (r) => `${fmt(r.cl.annualMean)} °F`, align: 'right' },
            { label: 'January', cell: (r) => `${fmt(monthNormal(r.cl, 0), 1)} °F`, align: 'right' },
            { label: 'July', cell: (r) => `${fmt(monthNormal(r.cl, 6), 1)} °F`, align: 'right' },
            { label: 'Coldest day', cell: (r) => dateOfYear(r.cl.coldestDay, MONTH_NAMES), align: 'right' },
            { label: <>Day-to-day, winter</>, cell: (r) => `±${fmt(r.cl.winterSd, 1)} °F`, align: 'right' },
            { label: <>summer</>, cell: (r) => `±${fmt(r.cl.summerSd, 1)} °F`, align: 'right' },
          ]}
        />
        <Slider
          label="Latitude"
          tone={WX.energy}
          value={st.latitude}
          min={25}
          max={55}
          step={0.5}
          onChange={(v) => s.set({ latitude: v })}
          display={`${fmt(st.latitude, 1)}° N`}
        />
        <Slider
          label="Continentality"
          tone={WX.moisture}
          value={st.continentality}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => s.set({ continentality: v })}
          display={`${fmt(st.continentality, 2)} · ${continentalityWords(st.continentality)}`}
        />
        <Slider label="Elevation" value={st.elevation} min={0} max={1500} step={50} onChange={(v) => s.set({ elevation: v })} display={`${fmt(st.elevation)} m`} />
      </Figure>

      <P>
        <b>Latitude</b> sets the sunlight, as <a href={lessonHref('weather/1.1')}>Lesson 1.1</a> showed: farther from the equator, the year is colder on average and
        the difference between summer and winter sunshine is larger. Slide the station from 30° to 50° north and its annual mean falls by{' '}
        {fmt(stationOf({ ...st, latitude: 30 }).annualMean - stationOf({ ...st, latitude: 50 }).annualMean)} °F while its seasonal swing grows.
      </P>
      <P>
        <b>Continentality</b> is the sea’s influence, and it acts on everything except the average. The upper ocean stores enormous amounts of heat, so air that
        arrives off the sea has been held near the sea’s slowly changing temperature: winters are mild, summers cool, and one day is much like the next. The starting
        station, on a coast with the wind off the sea, has a January normal of {fmt(monthNormal(sea, 0), 1)} °F and a July normal of {fmt(monthNormal(sea, 6), 1)}{' '}
        °F, and its midwinter days swing by ±{fmt(sea.winterSd, 1)} °F from normal, against Calder Bay’s ±{fmt(CALDER.winterSd, 1)} °F. Because the sea warms and
        cools so slowly, its coldest day falls on {dateOfYear(sea.coldestDay, MONTH_NAMES)}, almost three weeks after Calder Bay’s. Inland, the ground heats and
        cools quickly and nothing damps the swings.
      </P>
      <P>
        Calder Bay is on a coast, but its continentality is 0.8. The westerlies of <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> reach it across the land, and
        the ocean lies downwind. That is why the east coasts of the mid-latitude continents have harsher climates than their west coasts: New York’s winters are far
        colder than Seattle’s, though Seattle lies farther north. Marlow, deep in the plains, has the full continental climate: a January normal of{' '}
        {fmt(monthNormal(MARLOW, 0), 1)} °F, a July of {fmt(monthNormal(MARLOW, 6), 1)} °F, and the largest day-to-day swings in the region.
      </P>
      <P>
        <b>Elevation</b> subtracts the lapse rate of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a>: about 6.5 °C, or 11.7 °F, for every kilometer of height,
        all year round. It moves the whole year down without changing its shape. Hollin Ridge averages {fmt(CALDER.annualMean - RIDGE.annualMean)} °F colder than
        Calder Bay, and {fmt((11.7 * 690) / 1000)} °F of that is its 690 m of extra height; the rest is its slightly more northern, more continental position.
      </P>

      <Challenge
        id="a"
        question="Build a station whose January is colder on average than Marlow’s, yet whose midwinter days swing less from one to the next than Calder Bay’s."
        solved={solved}
        status={
          monthNormal(mine, 0) >= monthNormal(MARLOW, 0)
            ? `Your station’s January normal is ${fmt(monthNormal(mine, 0), 1)} °F, against Marlow’s ${fmt(monthNormal(MARLOW, 0), 1)} °F.`
            : `January is cold enough, at ${fmt(monthNormal(mine, 0), 1)} °F, but its midwinter days swing ±${fmt(mine.winterSd, 1)} °F, against Calder Bay’s ±${fmt(CALDER.winterSd, 1)} °F.`
        }
        success={`Solved: a January of ${fmt(monthNormal(mine, 0), 1)} °F with midwinter days swinging ±${fmt(mine.winterSd, 1)} °F. The controls do different jobs. Latitude and height make a place cold; the sea upwind makes it steady. Cold and steady takes both — a high or far-northern place with the wind blowing in off the ocean.`}
      />

      <H2>The spread is the climate</H2>
      <P>
        The bands in <FigRef to="Climate Geography Explorer">the first demonstration</FigRef> are much wider in winter than in summer. In winter the contrast
        between the tropics and the pole is at its greatest, the jet stream is stronger and lies farther south, and the fronts of{' '}
        <a href={lessonHref('weather/2.2')}>Lesson 2.2</a> sweep through every few days, bringing air from far to the north one week and far to the south the next.
        In summer the contrasts are weaker, and the air over a place is more often its own.
      </P>
      <P>
        The next demonstration looks at a single month at a time. It stacks every day of that month from all {YEARS} simulated years at each of the region’s
        stations into a histogram, in bins of 2 °F. The dashed line is the average; the red bar beneath marks the middle 80% of the days, from the coldest tenth to
        the warmest tenth, and the paler bars outside it are the tails. Choose a month:
      </P>

      <Figure name="Climate Geography Explorer · distributions" scenario={m}>
        <MonthHistograms month={month} />
        <Readouts
          items={monthRows.map((r) => ({
            label: `${r.name}, middle 80% of days`,
            value: `${fmt(r.stats.p10)}–${fmt(r.stats.p90)} °F`,
            tone: WX.temperature,
          }))}
        />
        <Slider label="Month" value={month} min={0} max={11} onChange={(v) => m.set({ month: v })} display={MONTH_NAMES[month]} />
        <Caption>
          In {MONTH_NAMES[month]}, Calder Bay’s days average {fmt(monthRows[0].stats.mean, 1)} °F, and a tenth of them are colder than{' '}
          {fmt(monthRows[0].stats.p10, 1)} °F; the coldest of all {YEARS} years’ {MONTH_NAMES[month]} days was {fmt(monthRows[0].stats.min, 1)} °F.
        </Caption>
      </Figure>

      <P>
        In January, Calder Bay’s days average {fmt(janStats.mean, 1)} °F, but a tenth of them are colder than {fmt(janStats.p10, 1)} °F and a tenth warmer than{' '}
        {fmt(janStats.p90, 1)} °F: the middle 80% spans {fmt(janStats.p90 - janStats.p10)} °F. In July it spans {fmt(julStats.p90 - julStats.p10)} °F, and the
        standard deviation of the days is {fmt(julStats.sd, 1)} °F against January’s {fmt(janStats.sd, 1)} °F — winter’s spread is almost twice summer’s. Marlow’s
        January is wider still: {fmt(marlowJan.p10, 1)} °F to {fmt(marlowJan.p90, 1)} °F, with a coldest day in the archive of {fmt(marlowJan.min, 1)} °F.
      </P>

      <Challenge
        id="b"
        question="Find the month in which Calder Bay’s days are most alike: the narrowest middle 80%, from its coldest tenth of days to its warmest."
        solved={solved2}
        status={`In ${MONTH_NAMES[month]}, Calder Bay’s middle 80% of days spans ${fmt(calderSpread(month), 1)} °F.`}
        success={`Solved. In ${MONTH_NAMES[steadiest]} Calder Bay’s middle 80% spans just ${fmt(calderSpread(steadiest), 1)} °F, against ${fmt(calderSpread(0), 1)} °F in January. The quietest month is the one that holds the warmest days of the year, when the contrast between the tropics and the pole, and the storms it feeds, are at their weakest.`}
      />

      <P>
        Notice which part of each distribution a business would care about. Nobody runs short of heating gas on an average January day; they run short on the
        coldest tenth of days, and on the years when those days come in a run. The tails are where the risk is, and the same average can hide very different tails —
        Calder Bay and Marlow have nearly the same July but quite different Januaries. Chapter 4 will turn these distributions into heating demand, crop yields and
        cash flows.
      </P>
      <P>
        That answers this chapter’s question. Uneven heating drives a planetary circulation; its westerlies carry air masses that meet at fronts and feed storms;
        the oceans store heat and release it slowly, shifting whole seasons; and geography reshapes all of it into the distribution of weather each place lives
        with. But a distribution only says what a January can bring. It doesn’t say what next week will bring. For that we need to know the state of the atmosphere
        now, and how it will evolve — which starts with measuring it. Chapter 3 begins with a weather station in{' '}
        <a href={lessonHref('weather/3.1')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
