import { useDeferredValue, useMemo } from 'react';
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
  pct,
  scale,
  signed,
  tint,
  usd,
} from '../../../framework';
import { yearBands, monthNormal, type YearBands } from '../../../engines/weather/climatology';
import { cdd } from '../../../engines/weather/degreeDays';
import { regress, summarize, utilityWinters, winterHdd } from '../../../engines/weather/exposure';
import { DAYS, YEARS, monthDays, ninoMonth, tempF } from '../../../model/weather/archive';
import { MONTH_SHORT, MONTH_START, normalTemp } from '../../../model/weather/region';
import {
  REGION_DEFAULTS,
  isCalder,
  regionClimate,
  regionKnobs,
  resetCapstone,
  updateCapstone,
  useWeatherCapstone,
  type RegionSettings,
} from '../shared/capstone';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The region's winters, computed once per setting.

/** Winters in the archive with a full heating season: November of year y through March of y + 1. */
export const WINTERS = YEARS - 1;

export type Phase = 'el' | 'la' | 'neutral';

export interface RegionWinters {
  /** Heating-season (November–March) degree days, winters 1–40. */
  hdd: number[];
  /** December–February Niño-3.4, °C. */
  nino: number[];
  phase: Phase[];
  mean: number;
  sd: number;
  /** Share of the winter-to-winter variance the December–February Niño-3.4 explains. */
  r2: number;
  slope: number;
  intercept: number;
  /** Average heating season in El Niño and La Niña winters. */
  elMean: number;
  laMean: number;
  /** Average July cooling degree days. */
  julyCdd: number;
  /** Calder Gas & Light's winter margin, if it served this region: its standard deviation and its 1-in-20 shortfall, $. */
  marginSd: number;
  shortfall: number;
}

const DJF = Array.from({ length: WINTERS }, (_, i) => (ninoMonth(i + 1, 11) + ninoMonth(i + 2, 0) + ninoMonth(i + 2, 1)) / 3);

const cache = new Map<string, RegionWinters>();

function keyOf(r: RegionSettings) {
  return JSON.stringify([r.latitude, r.continentality, r.elevation, r.ensoF, r.variability, r.trend]);
}

/** The region's 40 simulated winters, with how ENSO and the utility's margin line up with them. */
export function regionWinters(r: RegionSettings): RegionWinters {
  const key = keyOf(r);
  const hit = cache.get(key);
  if (hit) return hit;
  const knobs = regionKnobs(r);
  const hdd = Array.from({ length: WINTERS }, (_, i) => winterHdd(i + 1, knobs));
  const s = summarize(hdd);
  const fit = regress(DJF, hdd);
  const phase: Phase[] = DJF.map((n) => (n >= 0.5 ? 'el' : n <= -0.5 ? 'la' : 'neutral'));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  let july = 0;
  for (let y = 1; y <= YEARS; y++) {
    const { start, days } = monthDays(y, 6);
    for (let i = 0; i < days; i++) july += cdd(tempF('calder', start + i, knobs));
  }
  const m = summarize(utilityWinters(knobs).map((w) => w.margin));
  const out: RegionWinters = {
    hdd,
    nino: DJF,
    phase,
    mean: s.mean,
    sd: s.sd,
    r2: fit.r2,
    slope: fit.slope,
    intercept: fit.intercept,
    elMean: avg(hdd.filter((_, i) => phase[i] === 'el')),
    laMean: avg(hdd.filter((_, i) => phase[i] === 'la')),
    julyCdd: july / YEARS,
    marginSd: m.sd,
    shortfall: m.mean - m.p5,
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

/** Calder Bay's own winters: the reference every region is compared with. */
export function calderWinters(): RegionWinters {
  return regionWinters(REGION_DEFAULTS);
}

// ---------------------------------------------------------------------------
// The challenges.

export const MEAN_TOLERANCE = 0.05;
export const RISK_MULTIPLE = 1.5;

/** A heating season as large as Calder Bay's on average (within 5%), with winters at least 1.5 times as variable. */
export function riskierSolved(r: RegionSettings): boolean {
  const w = regionWinters(r);
  const c = calderWinters();
  return Math.abs(w.mean / c.mean - 1) <= MEAN_TOLERANCE && w.sd >= RISK_MULTIPLE * c.sd;
}

export const ENSO_SHARE_TARGET = 0.5;

/** ENSO explains at least half of the variance of the region's winters. */
export function ensoShareSolved(r: RegionSettings): boolean {
  return regionWinters(r).r2 >= ENSO_SHARE_TARGET;
}

// ---------------------------------------------------------------------------
// The year chart.

const yearCache = new Map<string, YearBands>();

/** The middle 80% of the region's days through the year, across all 41 simulated years. */
export function regionYear(r: RegionSettings): YearBands {
  const key = keyOf(r);
  const hit = yearCache.get(key);
  if (hit) return hit;
  const knobs = regionKnobs(r);
  const series = new Float64Array(DAYS);
  for (let d = 0; d < DAYS; d++) series[d] = tempF('calder', d, knobs);
  const b = yearBands(series);
  if (yearCache.size > 100) yearCache.clear();
  yearCache.set(key, b);
  return b;
}

const YX = scale(0, 365, 56, 620);
const YY = scale(-40, 100, 280, 24);
const clampY = (v: number) => YY(Math.max(-40, Math.min(100, v)));
const DAY_GRID = Array.from({ length: 74 }, (_, i) => Math.min(365, i * 5));

function YearChart({ r }: { r: RegionSettings }) {
  const bands = regionYear(r);
  const cl = regionClimate(r);
  const calder = regionClimate(REGION_DEFAULTS);
  const line = (c: typeof cl) => linePath(DAY_GRID.map(YX), DAY_GRID.map((d) => clampY(normalTemp(c, d))));
  const band = areaPath(bands.doy.map(YX), bands.high.map(clampY), bands.low.map(clampY));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 306"
      role="img"
      aria-label={`The region's year: a January normal of ${fmt(monthNormal(cl, 0), 1)} °F and a July normal of ${fmt(monthNormal(cl, 6), 1)} °F, with the middle 80% of its simulated days shaded, against Calder Bay's normal of ${fmt(monthNormal(calder, 0), 1)} °F in January and ${fmt(monthNormal(calder, 6), 1)} °F in July.`}
    >
      <text className="ax" x={56} y={12}>
        Daily mean temperature, °F
      </text>
      <GridY y={YY} ticks={[-40, -20, 0, 20, 40, 60, 80, 100]} x0={56} x1={620} />
      <path d={band} fill={tint(GRAPHIC.red, 0.22)} />
      <line x1={56} x2={620} y1={YY(65)} y2={YY(65)} stroke={GRAPHIC.orange} strokeWidth={1.2} strokeDasharray="2 4" />
      <text className="ax ax-e" x={616} y={YY(65) - 5} style={{ fill: TEXT.orange }}>
        65 °F, the degree-day base
      </text>
      <path d={line(calder)} fill="none" stroke="#777" strokeWidth={1.6} strokeDasharray="6 4" />
      <path d={line(cl)} fill="none" stroke={GRAPHIC.red} strokeWidth={2.6} />
      {MONTH_SHORT.map((m, i) => (
        <text key={m} className="ax ax-m" x={YX(MONTH_START[i] + 15)} y={298}>
          {m}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The winters chart.

const PHASE_COLOR: Record<Phase, string> = { el: GRAPHIC.red, la: GRAPHIC.blue, neutral: '#9a9a9a' };
const PHASE_LABEL: Record<Phase, string> = { el: 'El Niño', la: 'La Niña', neutral: 'neutral' };

function Marker({ x, y, phase }: { x: number; y: number; phase: Phase }) {
  if (phase === 'la') return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill={PHASE_COLOR.la} stroke="#fcfcfb" strokeWidth={1} />;
  if (phase === 'el') return <circle cx={x} cy={y} r={5} fill={PHASE_COLOR.el} stroke="#fcfcfb" strokeWidth={1} />;
  return <circle cx={x} cy={y} r={3} fill={PHASE_COLOR.neutral} />;
}

function WintersChart({ w }: { w: RegionWinters }) {
  const dev = w.hdd.map((h) => h - w.mean);
  const lim = Math.max(400, Math.ceil(Math.max(...dev.map(Math.abs)) / 200) * 200);
  const bx = scale(0.5, WINTERS + 0.5, 64, 620);
  const by = scale(-lim, lim, 158, 24);
  const sx = scale(-2.5, 2.5, 64, 620);
  const sy = scale(-lim, lim, 316, 196);
  const fitAt = (n: number) => w.intercept + w.slope * n - w.mean;
  const step = lim / 2;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 344"
      role="img"
      aria-label={`The region's 40 simulated winters: heating seasons averaging ${fmt(w.mean)} degree days with a standard deviation of ${fmt(w.sd)}. El Niño winters average ${fmt(w.elMean)} and La Niña winters ${fmt(w.laMean)}; the winter's Niño-3.4 explains ${pct(w.r2)} of the variance.`}
    >
      <text className="ax" x={64} y={12}>
        Each winter’s degree days, above or below the region’s average
      </text>
      <GridY y={by} ticks={[-lim, -step, 0, step, lim]} x0={64} x1={620} format={(v) => signed(v)} baseline={0} />
      {dev.map((v, i) => {
        const x = bx(i + 1);
        return <rect key={i} x={x - 5} width={10} y={Math.min(by(v), by(0))} height={Math.abs(by(v) - by(0))} fill={PHASE_COLOR[w.phase[i]]} opacity={w.phase[i] === 'neutral' ? 0.6 : 0.85} />;
      })}
      {[1, 10, 20, 30, 40].map((y) => (
        <text key={y} className="ax ax-m" x={bx(y)} y={174}>
          {y === 1 ? 'winter 1' : y}
        </text>
      ))}
      <text className="ax" x={64} y={190}>
        Against that winter’s December–February Niño-3.4
      </text>
      <GridY y={sy} ticks={[-lim, 0, lim]} x0={64} x1={620} format={(v) => signed(v)} baseline={0} />
      <line x1={sx(-2.5)} x2={sx(2.5)} y1={sy(fitAt(-2.5))} y2={sy(fitAt(2.5))} stroke="#333" strokeWidth={1.6} strokeDasharray="6 4" />
      {dev.map((v, i) => (
        <Marker key={i} x={sx(Math.max(-2.5, Math.min(2.5, w.nino[i])))} y={sy(v)} phase={w.phase[i]} />
      ))}
      {[-2, -1, 0, 1, 2].map((n) => (
        <text key={n} className="ax ax-m" x={sx(n)} y={334}>
          {n === 0 ? '0 °C' : `${signed(n)}`}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The controls, shared by both figures (they write to the capstone).

function continentalityWords(c: number): string {
  if (c <= 0.2) return 'wind off the sea';
  if (c <= 0.5) return 'near a windward sea';
  if (c <= 0.85) return 'wind mostly off the land';
  return 'deep inland';
}

const set = (patch: Partial<RegionSettings>) => updateCapstone('region', patch);

function GeographySliders({ r }: { r: RegionSettings }) {
  return (
    <>
      <Slider label="Latitude" value={r.latitude} min={25} max={55} step={0.5} onChange={(v) => set({ latitude: v })} display={`${fmt(r.latitude, 1)}° N`} />
      <Slider
        label="Distance from a windward sea"
        value={r.continentality}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => set({ continentality: v })}
        display={`${fmt(r.continentality, 2)} · ${continentalityWords(r.continentality)}`}
      />
      <Slider label="Elevation" value={r.elevation} min={0} max={1500} step={50} onChange={(v) => set({ elevation: v })} display={`${fmt(r.elevation)} m`} />
    </>
  );
}

function WeatherSliders({ r, trend = true }: { r: RegionSettings; trend?: boolean }) {
  return (
    <>
      <Slider label="The Pacific’s pull on winter" tone={WX.temperature} value={r.ensoF} min={0} max={3} step={0.1} onChange={(v) => set({ ensoF: v })} display={`${fmt(r.ensoF, 1)} °F per °C`} />
      <Slider label="Day-to-day variability" tone={WX.temperature} value={r.variability} min={0.5} max={2} step={0.05} onChange={(v) => set({ variability: v })} display={`× ${fmt(r.variability, 2)}`} />
      {trend && (
        <Slider label="Warming trend" tone={WX.temperature} value={r.trend} min={-0.05} max={0.1} step={0.01} onChange={(v) => set({ trend: v })} display={`${signed(r.trend, 2)} °F a year`} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const { region } = useWeatherCapstone();
  const r = useDeferredValue(region);
  const w = regionWinters(r);
  const c = calderWinters();
  const cl = regionClimate(r);
  const calderCl = regionClimate(REGION_DEFAULTS);
  const calder = isCalder(region);
  const solved = riskierSolved(region);
  const solved2 = ensoShareSolved(region);

  // Numbers the prose quotes, from the same model the figures run.
  const n = useMemo(() => {
    const at = (patch: Partial<RegionSettings>) => regionWinters({ ...REGION_DEFAULTS, ...patch });
    return {
      north: at({ latitude: 45 }),
      south: at({ latitude: 35 }),
      sea: at({ continentality: 0 }),
      inland: at({ continentality: 1 }),
      high: at({ elevation: 500 }),
      noTrend: at({ trend: 0 }),
      fastTrend: at({ trend: 0.1 }),
      wild: at({ variability: 1.5 }),
      pull: at({ ensoF: 2.1 }),
      calm: at({ variability: 0.5 }),
    };
  }, []);
  const decade = (x: RegionWinters, from: number) => x.hdd.slice(from, from + 10).reduce((a, b) => a + b, 0) / 10;

  const rows = [
    { key: 'mine', name: calder ? 'Your region (Calder Bay)' : 'Your region', cl, w },
    { key: 'calder', name: 'Calder Bay', cl: calderCl, w: c },
  ];

  const ratio = w.sd / c.sd;
  const meanOff = w.mean / c.mean - 1;

  return (
    <LessonPage id="weather/6.1">
      <P>
        This course has climbed from sunlight to markets one step at a time. Chapter 1 asked why weather happens at all: a planet heated unevenly, air that grows
        lighter as it warms, water vapor that carries energy, and a spinning Earth that turns every push into a wind. Chapter 2 assembled those pieces into the
        circulation, the fronts and storms, the slow swings of the Pacific and the climates of particular places. Chapter 3 measured the atmosphere and forecast it
        honestly, as probabilities that fade toward climate within two weeks. Chapter 4 turned the weather into money for a gas utility, a farm and a wind farm, and
        Chapter 5 wrote contracts on the weather, priced them, traded them against a market and tested every idea against history.
      </P>
      <P>
        Each of those lessons took one piece at a time, in Calder Bay. This chapter puts them together, in a region of your own. First you build the region;
        in <a href={lessonHref('weather/6.2')}>6.2</a> you forecast its days; in <a href={lessonHref('weather/6.3')}>6.3</a> you turn those forecasts into a
        business’s exposure; in <a href={lessonHref('weather/6.4')}>6.4</a> you price contracts on its weather and choose which to hold; and in{' '}
        <a href={lessonHref('weather/6.5')}>6.5</a> you replay the whole book over the archive’s winters, with every decision made from forecasts issued on their own
        dates. There is nothing new to learn. Every mechanic is one you have already used, and your choices carry from lesson to lesson — they are saved in your
        browser, and nowhere else.
      </P>
      <P>
        A region, in this course, is the climate of the station its contracts settle on. Three facts set it, by the rules of{' '}
        <a href={lessonHref('weather/2.5')}>Lesson 2.5</a>: its <b>latitude</b>, which sets the sunlight of <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>; its
        distance from a sea the wind blows in from, which damps the seasons — less so on an east coast, where the westerlies of{' '}
        <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> arrive over land; and its <b>elevation</b>, which subtracts the lapse rate of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a>. Three more knobs act on the weather
        itself: how hard the Pacific pulls on its winters (<a href={lessonHref('weather/2.4')}>Lesson 2.4</a>), how far its days swing from one to the next, and how
        fast it is warming. Underneath is the course’s simulated archive — the same 41 years of days, each day’s departure from normal stretched and shifted by your
        climate. None of it is real weather, and nothing built on it is real money.
      </P>
      <P>
        In the next demonstration, the red line is your region’s normal year and the shaded band holds the middle 80% of its simulated days; the dashed gray line is
        Calder Bay’s normal year, where the region starts. The table compares the two, including the <K tone={WX.index}>heating season</K> — November through March,
        counted in the degree days of <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> — and how much it varies from one winter to the next. Build the region:
      </P>

      <Figure name="Weather World Builder" onReset={() => resetCapstone('region')}>
        <YearChart r={r} />
        <Legend
          items={[
            { label: 'Your region’s normal', color: GRAPHIC.red, kind: 'line' },
            { label: 'Middle 80% of its days', color: tint(GRAPHIC.red, 0.35) },
            { label: 'Calder Bay’s normal', color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <DataTable
          caption="Your region and Calder Bay: annual mean, January and July normals, the heating season's average degree days and their winter-to-winter standard deviation, and July's cooling degree days"
          rows={rows}
          rowKey={(row) => row.key}
          rowClass={(row) => (row.key === 'mine' ? 'hl' : '')}
          columns={[
            { label: '', cell: (row) => row.name },
            { label: 'Annual mean', cell: (row) => `${fmt(row.cl.annualMean, 1)} °F`, align: 'right' },
            { label: 'January', cell: (row) => `${fmt(monthNormal(row.cl, 0), 1)} °F`, align: 'right' },
            { label: 'July', cell: (row) => `${fmt(monthNormal(row.cl, 6), 1)} °F`, align: 'right' },
            { label: <span style={{ color: TEXT.orange }}>Heating season</span>, cell: (row) => `${fmt(row.w.mean)} HDD`, align: 'right' },
            { label: 'Winter to winter', cell: (row) => `± ${fmt(row.w.sd)}`, align: 'right' },
            { label: 'July', cell: (row) => `${fmt(row.w.julyCdd)} CDD`, align: 'right' },
          ]}
        />
        <GeographySliders r={region} />
        <WeatherSliders r={region} />
        <Caption>
          {calder
            ? 'This is Calder Bay’s own climate. Move any control to make the region your own.'
            : `Your heating season averages ${signed(meanOff * 100)}% against Calder Bay’s, and varies ${fmt(ratio, 2)} times as much from winter to winter.`}
        </Caption>
      </Figure>

      <P>
        Each control does what its lesson said it would. Move the region to 45° north and its heating season grows from {fmt(c.mean)} to {fmt(n.north.mean)} degree
        days; at 35°, it shrinks to {fmt(n.south.mean)}. Put the sea upwind and the seasons flatten: with the wind off the sea, a winter collects only{' '}
        {fmt(n.sea.mean)} degree days and varies by {fmt(n.sea.sd)} from one winter to the next, against Calder Bay’s {fmt(c.sd)}. Deep inland, it is{' '}
        {fmt(n.inland.mean)} and {fmt(n.inland.sd)}. Raise it 500 m and every day is colder by the lapse rate: {fmt(n.high.mean)} degree days.
      </P>
      <P>
        The weather knobs are subtler. Raise the warming trend to 0.10 °F a year, more than three times Calder Bay’s, and the average barely moves, but the first ten winters now
        average {fmt(decade(n.fastTrend, 0))} degree days and the last ten {fmt(decade(n.fastTrend, 30))}: a market that prices a winter from the past has to
        allow for the drift, as the burn analysis of <a href={lessonHref('weather/5.2')}>Lesson 5.2</a> did. Stretch the day-to-day variability to 1.5 times and
        the winter-to-winter spread grows to {fmt(n.wild.sd)}, only {fmt(n.wild.sd / c.sd, 2)} times Calder Bay’s. Part of a winter’s spread doesn’t come from its
        days at all. It comes from the Pacific, and from the trend, and stretching the days leaves those alone.
      </P>

      <Challenge
        id="a"
        question="Build a region whose heating season averages within 5% of Calder Bay’s, but whose winters vary at least 1.5 times as much from one to the next."
        solved={solved}
        status={`Right now your heating season averages ${fmt(w.mean)} degree days (${signed(meanOff * 100, 1)}% against Calder Bay’s ${fmt(c.mean)}) and varies by ${fmt(w.sd)}, ${fmt(ratio, 2)} times Calder Bay’s ${fmt(c.sd)}.`}
        success={`Solved: ${fmt(w.mean)} degree days on average, swinging by ${fmt(w.sd)} — ${fmt(ratio, 2)} times Calder Bay’s. ${
          w.r2 >= 0.4
            ? `Much of that extra spread comes from the Pacific: ENSO now explains ${pct(w.r2)} of it. That part of the risk is announced in the autumn, months ahead — the edge Lesson 5.3 traded.`
            : `Most of that extra spread comes from the days themselves: ENSO explains only ${pct(w.r2)} of it. That part of the risk no forecast sees more than about two weeks ahead, as Lesson 3.4 showed. It can be hedged, as in Lesson 5.5, but not predicted from the autumn.`
        } The same size of risk can be a very different thing to trade.`}
      />

      <H2>The winters you’ll trade</H2>
      <P>
        The rest of the capstone deals in whole winters: the utility’s winter margin of <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>, the seasonal strips of{' '}
        <a href={lessonHref('weather/5.5')}>Lesson 5.5</a>, the monthly futures of <a href={lessonHref('weather/5.3')}>Lesson 5.3</a>. In the next demonstration, the
        upper chart is your region’s 40 simulated winters, each drawn as how far its heating season came in above or below the region’s average: red circles and
        bars for El Niño winters, blue squares and bars for La Niña winters, gray for the rest. The lower chart places each winter against that winter’s
        December–February <K tone={WX.temperature}>Niño-3.4</K>, with the best straight line through them. The readouts imagine Calder Gas &amp; Light serving your
        region instead. The last two controls are the same as in <FigRef to="Weather World Builder">the first demonstration</FigRef>:
      </P>

      <Figure name="Weather World Builder · its winters" onReset={() => resetCapstone('region')}>
        <WintersChart w={w} />
        <Legend
          items={[
            { label: 'El Niño winter', color: PHASE_COLOR.el },
            { label: 'La Niña winter', color: PHASE_COLOR.la },
            { label: 'Neutral', color: PHASE_COLOR.neutral },
            { label: 'Best straight line', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'of the variance ENSO explains', value: pct(w.r2), tone: WX.probability },
            { label: `${PHASE_LABEL.el} winters, average`, value: `${signed(w.elMean - w.mean)} HDD`, tone: WX.index },
            { label: `${PHASE_LABEL.la} winters, average`, value: `${signed(w.laMean - w.mean)} HDD`, tone: WX.index },
            { label: 'the utility’s winter margin, standard deviation', value: usd(w.marginSd / 1e6, 1) + 'M', tone: WX.money },
            { label: 'its 1-in-20 winter falls short by', value: usd(w.shortfall / 1e6, 1) + 'M', tone: WX.money },
          ]}
        />
        <WeatherSliders r={region} trend={false} />
      </Figure>

      <P>
        At Calder Bay’s own settings, the winter’s Niño-3.4 explains {pct(c.r2)} of the variance of its heating seasons. El Niño winters average {fmt(c.elMean)}{' '}
        degree days and La Niña winters {fmt(c.laMean)}, a gap of {fmt(c.laMean - c.elMean)}. Calder Gas &amp; Light’s winter margin varies with a standard
        deviation of {usd(c.marginSd / 1e6, 1)} million, and one winter in 20 falls {usd(c.shortfall / 1e6, 1)} million short of its average. The other{' '}
        {pct(1 - c.r2)} of the variance is the weather of the days themselves — the cold snaps and mild spells that the forecasts of{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> see only a week or two ahead.
      </P>
      <P>
        Those two parts of the risk call for different tools, and the rest of the capstone will use both. The part ENSO explains is visible in the autumn; a market
        that ignores it misprices whole winters, and that is where <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> found its edge. The rest can only be hedged,
        with the contracts of <a href={lessonHref('weather/5.5')}>Lesson 5.5</a>, or forecast at short range, day by day, as the winter unfolds.
      </P>

      <Challenge
        id="b"
        question="Shape your region’s weather so that the Pacific explains at least half of the variance of its winters."
        solved={solved2}
        status={`ENSO explains ${pct(w.r2, 1)} of the variance of your region’s winters.`}
        success={`Solved: ENSO explains ${pct(w.r2, 1)}. There are two ways there, and you may have used either: pull the winters harder toward the Pacific (with the day-to-day variability at × 1, it takes about ${fmt(2.1, 1)} °F per °C, where it explains ${pct(n.pull.r2)}), or quiet the days so that the Pacific’s share stands out — though quieting alone isn’t enough: at half the variability it explains only ${pct(n.calm.r2)}. In a region like this, a forecaster who reads the Pacific in October knows a great deal about the winter before it starts.`}
      />

      <P>
        Your region is built: a climate, a distribution of winters, and the same simulated days of weather underneath. A distribution says what a winter can bring;
        it doesn’t say what next week will bring. The next lesson forecasts your region’s days, one at a time, against forecasters who use only the climate, only
        yesterday’s weather, or an overconfident model — and asks you to choose the forecaster the rest of the capstone will trust.
      </P>
    </LessonPage>
  );
}
