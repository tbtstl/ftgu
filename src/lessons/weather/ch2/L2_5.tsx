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
import { AXIAL_TILT_DEG, dailySunlight, dayLengthHours, declination, noonSunHeightDeg } from '../../../engines/weather/seasons';
import { YEARS } from '../../../model/weather/archive';
import { FENWICK, LAPSE_F_PER_KM, LATITUDE, MARLOW, MONTH_NAMES, MONTH_SHORT, MONTH_START, RIDGE, STATIONS, climateOf, fToC, normalTemp, type Climate, type StationId } from '../../../model/weather/region';
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

/** The first demonstration starts with a station at Fenwick Bay's latitude, on a coast where the wind comes off the sea. */
export const STATION_DEFAULTS: StationSettings = { latitude: 41, continentality: 0.1, elevation: 0 };

/** The reader's station shares Fenwick Bay's sensitivity to El Niño. */
export function stationOf(s: StationSettings): Climate {
  return climateOf({ latitude: s.latitude, continentality: s.continentality, elevation: s.elevation, ensoF: FENWICK.ensoF });
}

/**
 * The first challenge: a January colder (on average) than Marlow's, with midwinter days that swing
 * less from one to the next than Fenwick Bay's.
 */
export function steadyColdSolved(s: StationSettings): boolean {
  const cl = stationOf(s);
  return monthNormal(cl, 0) < monthNormal(MARLOW, 0) && cl.winterSd < FENWICK.winterSd;
}

// ---------------------------------------------------------------------------
// The region's three stations, through the 41 simulated years.

const STATION_ROWS: Array<{ id: StationId; name: string; climate: Climate }> = [
  { id: 'fenwick', name: 'Fenwick Bay', climate: FENWICK },
  { id: 'marlow', name: 'Marlow', climate: MARLOW },
  { id: 'ridge', name: 'Hollin Ridge', climate: RIDGE },
];

let seriesCache: Record<StationId, Float64Array> | null = null;
function stationSeries(): Record<StationId, Float64Array> {
  if (!seriesCache) seriesCache = { fenwick: climateSeries(FENWICK, 'fenwick'), marlow: climateSeries(MARLOW, 'marlow'), ridge: climateSeries(RIDGE, 'ridge') };
  return seriesCache;
}

/** A station's days in a month, across all the archive's years: the spread and its middle 80%. */
export function stationMonth(id: StationId, month: number): MonthStats {
  return monthStats(monthSample(stationSeries()[id], month));
}

/** Width of the middle 80% of Fenwick Bay's days in a month (90th minus 10th percentile), °F. */
export function fenwickSpread(month: number): number {
  const s = stationMonth('fenwick', month);
  return s.p90 - s.p10;
}

/** The month in which Fenwick Bay's days are most alike. */
export function steadiestMonth(): number {
  let best = 0;
  for (let m = 1; m < 12; m++) if (fenwickSpread(m) < fenwickSpread(best)) best = m;
  return best;
}

/** The second challenge: find that month. */
export function steadiestSolved(month: number): boolean {
  return month === steadiestMonth();
}

/** Share of Fenwick Bay's days in a month that fall within one standard deviation of the month's average. */
export function withinOneSd(month: number): number {
  const sample = monthSample(stationSeries().fenwick, month);
  const s = monthStats(sample);
  let n = 0;
  for (let i = 0; i < sample.length; i++) if (Math.abs(sample[i] - s.mean) <= s.sd) n++;
  return n / sample.length;
}

/** Hours and minutes, "14 h 57 min". */
export function hoursMinutes(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

// ---------------------------------------------------------------------------
// The seasons: a tilted globe and the year's sunlight.

/** The seasons demonstration starts at Fenwick Bay's latitude on the June solstice (day 171 = June 21). */
export const SEASON_DEFAULTS = { latitude: 41, doy: 171 };
export const JUNE_SOLSTICE = 171;
export const DECEMBER_SOLSTICE = 354;

const RAD = Math.PI / 180;
const GLOBE = { cx: 118, cy: 116, r: 84 };
const SUN_X = scale(0, 365, 270, 620);
const SUN_Y = scale(0, 560, 206, 30);
const SUN_DAYS = Array.from({ length: 74 }, (_, i) => Math.min(364, i * 5));

function SeasonsChart({ latitude, doy }: { latitude: number; doy: number }) {
  const dec = declination(doy);
  const t = dec * RAD;
  const { cx, cy, r } = GLOBE;
  // Unit vectors in screen coordinates (y down): along the axis toward the North Pole, which tips
  // toward the Sun (on the left) when the declination is positive, and across the axis.
  const n = { x: -Math.sin(t), y: -Math.cos(t) };
  const e = { x: Math.cos(t), y: -Math.sin(t) };
  const p = latitude * RAD;
  // The latitude circle, seen edge-on: a segment across the axis. Left of the terminator is day.
  const c = { x: cx + r * Math.sin(p) * n.x, y: cy + r * Math.sin(p) * n.y };
  const half = r * Math.cos(p);
  const a = { x: c.x - half * e.x, y: c.y - half * e.y };
  const b = { x: c.x + half * e.x, y: c.y + half * e.y };
  const share = half > 0.5 ? Math.max(0, Math.min(1, (cx - a.x) / (b.x - a.x))) : c.x < cx ? 1 : 0;
  const m = { x: a.x + share * (b.x - a.x), y: a.y + share * (b.y - a.y) };
  const q = dailySunlight(latitude, doy);
  const qEq = dailySunlight(0, doy);
  const len = dayLengthHours(latitude, doy);
  const noon = noonSunHeightDeg(latitude, doy);
  const mine = SUN_DAYS.map((d) => dailySunlight(latitude, d));
  const equator = SUN_DAYS.map((d) => dailySunlight(0, d));
  const tip = Math.abs(dec) < 0.05 ? 'neither toward nor away from the Sun' : `${fmt(Math.abs(dec), 1)}° ${dec > 0 ? 'toward' : 'away from'} the Sun`;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`On ${dateOfYear(doy, MONTH_NAMES)} the North Pole’s end of Earth’s axis leans ${tip}. At ${fmt(latitude)}° north the day lasts ${hoursMinutes(len)}, the noon Sun ${noon > 0 ? `stands ${fmt(noon)}° above the horizon` : 'stays below the horizon'}, and the day’s sunlight at the top of the atmosphere averages ${fmt(q)} W/m², against ${fmt(qEq)} W/m² at the equator.`}
    >
      {/* Sunlight from the left. */}
      <text className="ax" x={8} y={14} style={{ fill: TEXT.gold }}>
        sunlight
      </text>
      {[-48, 0, 48].map((dy) => (
        <g key={dy}>
          <line x1={8} x2={cx - r - 16} y1={cy + dy} y2={cy + dy} stroke={GRAPHIC.gold} strokeWidth={2} />
          <polygon points={`${cx - r - 8},${cy + dy} ${cx - r - 17},${cy + dy - 5} ${cx - r - 17},${cy + dy + 5}`} fill={GRAPHIC.gold} />
        </g>
      ))}
      {/* The globe: night on the right, day on the left. */}
      <circle cx={cx} cy={cy} r={r} fill="#dcdad3" stroke="#bdb7a8" strokeWidth={1.2} />
      <path d={`M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill={tint(GRAPHIC.gold, 0.3)} />
      <line x1={cx - r * 1.16 * n.x} y1={cy - r * 1.16 * n.y} x2={cx + r * 1.24 * n.x} y2={cy + r * 1.24 * n.y} stroke="#555" strokeWidth={1.5} />
      <text x={cx + r * 1.38 * n.x} y={cy + r * 1.38 * n.y + 4} textAnchor="middle" className="ax">
        N
      </text>
      <line x1={cx - r * e.x} y1={cy - r * e.y} x2={cx + r * e.x} y2={cy + r * e.y} stroke="#8a8a8a" strokeDasharray="3 3" />
      <line x1={a.x} y1={a.y} x2={m.x} y2={m.y} stroke={GRAPHIC.gold} strokeWidth={4} strokeLinecap="round" />
      <line x1={m.x} y1={m.y} x2={b.x} y2={b.y} stroke="#6f6f6f" strokeWidth={4} strokeLinecap="round" />
      <text x={b.x + 7} y={b.y + 4} className="ax">
        {fmt(latitude)}°
      </text>
      <text x={cx} y={234} textAnchor="middle" className="ax">
        {Math.abs(dec) < 0.05 ? 'noon Sun overhead at the equator' : `noon Sun overhead at ${fmt(Math.abs(dec), 1)}° ${dec > 0 ? 'N' : 'S'}`}
      </text>

      {/* The day's sunlight through the year. */}
      <text className="ax" x={270} y={14}>
        Day’s average sunlight, top of the atmosphere, W/m²
      </text>
      <GridY y={SUN_Y} ticks={[0, 100, 200, 300, 400, 500]} x0={270} x1={620} baseline={0} />
      <path d={linePath(SUN_DAYS.map(SUN_X), equator.map(SUN_Y))} fill="none" stroke="#8a8a8a" strokeWidth={1.8} strokeDasharray="6 4" />
      <path d={linePath(SUN_DAYS.map(SUN_X), mine.map(SUN_Y))} fill="none" stroke={GRAPHIC.gold} strokeWidth={2.5} />
      <line className="cur" x1={SUN_X(doy)} x2={SUN_X(doy)} y1={30} y2={206} />
      <circle cx={SUN_X(doy)} cy={SUN_Y(q)} r={5} fill={GRAPHIC.gold} stroke="#fcfcfb" strokeWidth={1.5} />
      {MONTH_START.map((s, k) => (
        <text key={k} className="ax ax-m" x={SUN_X(s + 15)} y={224}>
          {MONTH_SHORT[k][0]}
        </text>
      ))}
    </svg>
  );
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
  const fenwickBands = useMemo(() => yearBands(stationSeries().fenwick), []);
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
      aria-label={`The year at Fenwick Bay and at a station at ${fmt(settings.latitude, 1)}° north, continentality ${fmt(settings.continentality, 2)}, ${fmt(settings.elevation)} m up. Its normal runs from ${fmt(jan)} °F in January to ${fmt(jul)} °F in July, against Fenwick Bay’s ${fmt(monthNormal(FENWICK, 0))} °F and ${fmt(monthNormal(FENWICK, 6))} °F; the shaded bands hold the middle 80% of the ${YEARS} simulated years’ days.`}
    >
      <text className="ax" x={56} y={14}>
        Daily mean temperature, °F
      </text>
      <GridY y={YY} ticks={[-40, -20, 0, 20, 40, 60, 80, 100]} x0={56} x1={620} format={(v) => `${v}°`} />
      <line x1={56} x2={620} y1={YY(32)} y2={YY(32)} stroke={GRAPHIC.blue} strokeWidth={1} strokeDasharray="3 4" opacity={0.6} />
      <text className="ax" x={616} y={YY(32) - 4} textAnchor="end" style={{ fill: TEXT.blue }}>
        freezing
      </text>
      <path d={band(fenwickBands)} fill="#8a8a8a" opacity={0.22} />
      <path d={band(myBands)} fill={GRAPHIC.red} opacity={0.2} />
      <path d={normalLine(FENWICK)} fill="none" stroke="#555" strokeWidth={2} strokeDasharray="6 4" />
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

  const z = useScenario('seasons', SEASON_DEFAULTS);
  const sun = z.state;

  // Numbers the prose quotes.
  const fenwickJan = monthNormal(FENWICK, 0);
  const fenwickJul = monthNormal(FENWICK, 6);
  const sea = stationOf(STATION_DEFAULTS);
  const janStats = stationMonth('fenwick', 0);
  const steadyStats = stationMonth('fenwick', steadiest);
  const marlowJan = stationMonth('marlow', 0);
  // Hollin Ridge against Fenwick Bay: the part of the difference that is height, and the rest.
  const ridgeColder = FENWICK.annualMean - RIDGE.annualMean;
  const ridgeRise = STATIONS.ridge.elevation - STATIONS.fenwick.elevation;
  const ridgeHeight = (LAPSE_F_PER_KM * ridgeRise) / 1000;
  // The days between the two coldest days, as the dates print.
  const coldestLag = Math.round(sea.coldestDay) - Math.round(FENWICK.coldestDay);
  // The seasons at Fenwick Bay's latitude.
  const juneLen = dayLengthHours(LATITUDE, JUNE_SOLSTICE);
  const decLen = dayLengthHours(LATITUDE, DECEMBER_SOLSTICE);
  const juneSun = dailySunlight(LATITUDE, JUNE_SOLSTICE);
  const decSun = dailySunlight(LATITUDE, DECEMBER_SOLSTICE);
  const sunLag = Math.round(FENWICK.coldestDay) + 365 - DECEMBER_SOLSTICE;
  const janWithin = withinOneSd(0);

  return (
    <LessonPage id="weather/2.5">
      <P>
        This chapter has assembled the machinery of large-scale weather: a planetary circulation whose westerlies sweep across 41° north (
        <a href={lessonHref('weather/2.1')}>Lesson 2.1</a>), fronts (<a href={lessonHref('weather/2.2')}>Lesson 2.2</a>), storms (
        <a href={lessonHref('weather/2.3')}>Lesson 2.3</a>) and the slow swings of the tropical Pacific (<a href={lessonHref('weather/2.4')}>Lesson 2.4</a>).
        Every place gets the same machinery in different proportions. This lesson asks what that does to the weather of a particular place.
      </P>
      <P>
        The answer is its <K tone={WX.temperature}>climate</K>. A climate is often summarized by an average, but the average is the least interesting thing about it.
        What anyone exposed to a climate has to plan for is the whole distribution of its weather: how warm a typical July day is, how cold the coldest tenth of its
        January days are, and how far one day can differ from the next.
      </P>
      <P>
        As in <a href={lessonHref('weather/2.4')}>the previous lesson</a>, station temperatures are in degrees Fahrenheit. The records
        come from this course’s simulated archive: {YEARS} years of daily weather at the region’s three stations — Fenwick Bay on the coast, Marlow on the plains
        about 350 km inland, and Hollin Ridge, 700 m up, to the north-west — generated by a model, not measured. Fenwick Bay averages{' '}
        {fmt(FENWICK.annualMean, 1)} °F ({fmt(fToC(FENWICK.annualMean), 1)} °C) over the year. Its January normal, the month’s long-run average, is{' '}
        {fmt(fenwickJan, 1)} °F, and its July normal {fmt(fenwickJul, 1)} °F.
      </P>
      <P>
        Every station’s normal year in the model comes from three facts about where it is: its latitude, how far it lies from a sea the wind blows in from, and its
        height. In the next demonstration, the dashed line is Fenwick Bay’s normal year and the gray band holds the middle 80% of its {YEARS} simulated years’ days.
        The red line and band are a station you build, which starts on a coast at Fenwick Bay’s latitude where the wind comes in off the sea. Its day-to-day ups and
        downs follow Fenwick Bay’s weather, reshaped to its own climate. Move it:
      </P>

      <Figure name="Climate Geography Explorer" scenario={s}>
        <YearChart mine={mine} settings={st} />
        <Legend
          items={[
            { label: 'Fenwick Bay, normal', color: '#555', kind: 'line', dashed: true },
            { label: 'Fenwick Bay, middle 80% of days', color: tint('#8a8a8a', 0.4) },
            { label: 'Your station, normal', color: GRAPHIC.red, kind: 'line' },
            { label: 'Your station, middle 80% of days', color: tint(GRAPHIC.red, 0.35) },
          ]}
        />
        <DataTable
          caption="Each station's climate: annual mean, January and July normals, its coldest day, and the standard deviation of its daily temperatures in midwinter"
          rows={tableRows}
          rowKey={(r) => r.key}
          rowClass={(r) => (r.mine ? 'hl' : '')}
          columns={[
            { label: 'Station', cell: (r) => r.name },
            { label: 'Annual', cell: (r) => `${fmt(r.cl.annualMean)} °F`, align: 'right' },
            { label: 'January', cell: (r) => `${fmt(monthNormal(r.cl, 0), 1)} °F`, align: 'right' },
            { label: 'July', cell: (r) => `${fmt(monthNormal(r.cl, 6), 1)} °F`, align: 'right' },
            { label: 'Coldest day', cell: (r) => dateOfYear(r.cl.coldestDay, MONTH_NAMES), align: 'right' },
            { label: 'Midwinter swings', cell: (r) => `±${fmt(r.cl.winterSd, 1)} °F`, align: 'right' },
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
        <b>Latitude</b> sets the sunlight. <a href={lessonHref('weather/1.1')}>Lesson 1.1</a> showed the yearly average: farther from the equator, sunlight
        strikes at a lower angle and the year is colder. The gap between summer’s sunshine and winter’s also grows toward the poles, as the next section
        explains. Slide the station from 30° to 50° north and its annual mean falls by{' '}
        {fmt(stationOf({ ...st, latitude: 30 }).annualMean - stationOf({ ...st, latitude: 50 }).annualMean)} °F while its seasonal swing grows.
      </P>
      <P>
        <b>Continentality</b> is the sea’s influence, and it acts on everything except the average. The upper ocean stores so much heat that air
        arriving off the sea has been held near the sea’s slowly changing temperature: winters are mild, summers cool, and one day is much like the next. The starting
        station, on a coast with the wind off the sea, has a January normal of {fmt(monthNormal(sea, 0), 1)} °F and a July normal of {fmt(monthNormal(sea, 6), 1)}{' '}
        °F, and its midwinter days swing by ±{fmt(sea.winterSd, 1)} °F from normal, against Fenwick Bay’s ±{fmt(FENWICK.winterSd, 1)} °F. (The table’s ±
        figures are standard deviations, which the last section explains.) Because the sea warms and cools so slowly, its coldest
        day falls on {dateOfYear(sea.coldestDay, MONTH_NAMES)}, {fmt(coldestLag)} days after Fenwick Bay’s. Inland, the ground heats and cools quickly and nothing
        damps the swings.
      </P>
      <P>
        Fenwick Bay is on a coast, but its continentality is 0.8. The westerlies of <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> reach it across the land, and
        the ocean lies downwind. That is why the east coasts of the mid-latitude continents have harsher climates than their west coasts: New York’s winters are far
        colder than Seattle’s, though Seattle lies farther north. Marlow, deep in the plains, has the full continental climate: a January normal of{' '}
        {fmt(monthNormal(MARLOW, 0), 1)} °F, a July of {fmt(monthNormal(MARLOW, 6), 1)} °F, and the largest day-to-day swings in the region.
      </P>
      <P>
        <b>Elevation</b> subtracts the lapse rate of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a>: about 6.5 °C, or {fmt(LAPSE_F_PER_KM, 1)} °F, for every
        kilometer of height, all year round. It moves the whole year down without changing its shape. Hollin Ridge averages {fmt(ridgeColder, 1)} °F colder than
        Fenwick Bay, and {fmt(ridgeHeight, 1)} °F of that is its {fmt(ridgeRise)} m of extra height. The other {fmt(ridgeColder - ridgeHeight, 1)} °F is its latitude,{' '}
        {fmt(STATIONS.ridge.latitude - STATIONS.fenwick.latitude)}° farther north; its more continental position changes its swings, not its average.
      </P>

      <Challenge
        id="a"
        question="Build a station whose January is colder on average than Marlow’s, yet whose midwinter days swing less from one to the next than Fenwick Bay’s."
        solved={solved}
        status={
          monthNormal(mine, 0) >= monthNormal(MARLOW, 0)
            ? `Your station’s January normal is ${fmt(monthNormal(mine, 0), 1)} °F, against Marlow’s ${fmt(monthNormal(MARLOW, 0), 1)} °F.`
            : `January is cold enough, at ${fmt(monthNormal(mine, 0), 1)} °F, but its midwinter days swing ±${fmt(mine.winterSd, 1)} °F, against Fenwick Bay’s ±${fmt(FENWICK.winterSd, 1)} °F.`
        }
        success={`Solved: a January of ${fmt(monthNormal(mine, 0), 1)} °F with midwinter days swinging ±${fmt(mine.winterSd, 1)} °F. The controls do different jobs. Latitude and height make a place cold; the sea upwind makes it steady. Cold and steady takes both — a high or far-northern place with the wind blowing in off the ocean.`}
      />

      <H2>Why there are seasons</H2>
      <P>
        Earth spins about an axis that leans {fmt(AXIAL_TILT_DEG, 1)}° from upright to the plane of its orbit — its <K tone={WX.energy}>axial tilt</K> — and the
        axis keeps pointing the same way in space all year, toward the North Star. So for half the year the Northern Hemisphere leans toward the Sun, and for the
        other half it leans away. Leaning toward the Sun does two things at once. The noon Sun climbs higher, so its light strikes the ground more nearly head-on,
        as it does at the equator in <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>. And more of each circle of latitude lies on the sunlit side of the
        planet, so the days are longer. Distance has little to do with it: Earth is closest to the Sun in early January.
      </P>
      <P>
        In the next demonstration, the globe is seen from the side with the Sun far off to the left. The thick line is one circle of latitude, gold where it is in
        daylight: the longer the gold part, the longer the day. The chart follows that latitude’s sunlight through the year, averaged over 24 hours at the top of
        the atmosphere, against the equator’s. Choose a latitude and a date:
      </P>

      <Figure name="Climate Geography Explorer · the seasons" scenario={z}>
        <SeasonsChart latitude={sun.latitude} doy={sun.doy} />
        <Legend
          items={[
            { label: 'Daylit side', color: tint(GRAPHIC.gold, 0.3) },
            { label: 'Sunlight at your latitude', color: GRAPHIC.gold, kind: 'line' },
            { label: 'At the equator', color: '#8a8a8a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'day length', value: hoursMinutes(dayLengthHours(sun.latitude, sun.doy)) },
            {
              label: 'noon Sun’s height',
              value: noonSunHeightDeg(sun.latitude, sun.doy) > 0 ? `${fmt(noonSunHeightDeg(sun.latitude, sun.doy))}°` : 'below the horizon',
            },
            { label: 'sunlight, day’s average', value: `${fmt(dailySunlight(sun.latitude, sun.doy))} W/m²`, tone: WX.energy },
          ]}
        />
        <Slider label="Latitude" tone={WX.energy} value={sun.latitude} min={0} max={90} onChange={(v) => z.set({ latitude: v })} display={`${fmt(sun.latitude)}° N`} />
        <Slider label="Date" value={sun.doy} min={0} max={364} onChange={(v) => z.set({ doy: v })} display={dateOfYear(sun.doy, MONTH_NAMES)} />
      </Figure>

      <P>
        At Fenwick Bay’s {LATITUDE}° on June 21, the day lasts {hoursMinutes(juneLen)} and the noon Sun stands {fmt(noonSunHeightDeg(LATITUDE, JUNE_SOLSTICE))}°
        above the horizon. On December 21 the day lasts {hoursMinutes(decLen)} and the noon Sun reaches only {fmt(noonSunHeightDeg(LATITUDE, DECEMBER_SOLSTICE))}°.
        Together they give June {fmt(juneSun / decSun, 1)} times December’s sunlight: {fmt(juneSun)} against {fmt(decSun)} W/m². At the equator the day lasts 12
        hours all year and its sunlight changes far less. Toward the pole the gap widens, until past the Arctic Circle, at {fmt(90 - AXIAL_TILT_DEG, 1)}° north, the
        Sun stays up all day at midsummer and never rises at midwinter. On June 21 the top of the atmosphere over the North Pole gets{' '}
        {fmt(dailySunlight(90, JUNE_SOLSTICE))} W/m², more than the equator’s {fmt(dailySunlight(0, JUNE_SOLSTICE))}. (The demonstration treats Earth’s orbit as a
        circle, which shifts these numbers by a few percent.)
      </P>
      <P>
        The temperature follows the sunlight, but late. After the shortest day the ground and the upper ocean go on losing heat for as long as they emit more than
        they absorb, so Fenwick Bay’s coldest day, on average, comes {sunLag} days after December 21, and its warmest about as long after June 21. Near the sea the lag
        is longer still, as the starting station on the coast showed.
      </P>

      <H2>The spread is the climate</H2>
      <P>
        The bands in <FigRef to="Climate Geography Explorer">the first demonstration</FigRef> are much wider in winter than in summer. In winter the high
        latitudes lean away from the Sun while the tropics stay bright, so the contrast between them is at its greatest; the jet stream is stronger and lies
        farther south, and the fronts of{' '}
        <a href={lessonHref('weather/2.2')}>Lesson 2.2</a> sweep through every few days, bringing air from far to the north one week and far to the south the next.
        In summer the contrasts are weaker, and the air over a place is more often its own.
      </P>
      <P>
        The next demonstration looks at a single month at a time. It stacks every day of that month from all {YEARS} simulated years at each of the region’s
        stations into a histogram: a bar for each 2 °F of temperature, as tall as the number of days that fell in it. The shape the bars make is the month’s{' '}
        <K tone={WX.probability}>distribution</K>, how often each temperature turns up. The dashed line is the average. A <K tone={WX.probability}>percentile</K>{' '}
        is the temperature that a given share of the days fall below: a tenth of the days are colder than the 10th percentile, and a tenth warmer than the 90th.
        The red bar beneath each histogram runs from one to the other, marking the middle 80% of the days; the paler bars outside it are the tails. Beside each
        station’s name is its <K tone={WX.probability}>standard deviation</K> (sd), the typical size of a day’s departure from the average: square each day’s
        departure, average the squares, and take the square root. Choose a month:
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
          In {MONTH_NAMES[month]}, Fenwick Bay’s days average {fmt(monthRows[0].stats.mean, 1)} °F; the coldest of all {YEARS} years’ {MONTH_NAMES[month]} days
          was {fmt(monthRows[0].stats.min, 1)} °F.
        </Caption>
      </Figure>

      <P>
        In January, Fenwick Bay’s days average {fmt(janStats.mean, 1)} °F, but a tenth of them are colder than {fmt(janStats.p10, 1)} °F and a tenth warmer than{' '}
        {fmt(janStats.p90, 1)} °F: the middle 80% spans {fmt(janStats.p90 - janStats.p10)} °F, and the standard deviation of the days is{' '}
        {fmt(janStats.sd, 1)} °F. For a bell-shaped distribution like these, about two-thirds of the days fall within one standard deviation of the average; in Fenwick Bay’s January,{' '}
        {fmt(janWithin * 100)}% do. Marlow’s January is wider still: {fmt(marlowJan.p10, 1)} °F to {fmt(marlowJan.p90, 1)} °F, with a coldest day in the archive of{' '}
        {fmt(marlowJan.min, 1)} °F.
      </P>

      <Challenge
        id="b"
        question={
          <>
            Predict first, from where the gray band in <FigRef to="Climate Geography Explorer">the first demonstration</FigRef> pinches tightest: in which month
            are Fenwick Bay’s days most alike, with the narrowest middle 80% from its coldest tenth of days to its warmest? Then choose that month here to check.
          </>
        }
        solved={solved2}
        status={
          month === 0
            ? `In January, Fenwick Bay’s middle 80% of days spans ${fmt(fenwickSpread(0), 1)} °F. Which month did you predict?`
            : `In ${MONTH_NAMES[month]}, Fenwick Bay’s middle 80% of days spans ${fmt(fenwickSpread(month), 1)} °F. Is that the narrowest?`
        }
        success={`Solved. In ${MONTH_NAMES[steadiest]} Fenwick Bay’s middle 80% spans just ${fmt(fenwickSpread(steadiest), 1)} °F, against ${fmt(fenwickSpread(0), 1)} °F in January. The quietest month is the one that holds the warmest days of the year, when the contrast between the tropics and the pole, and the storms it feeds, are at their weakest.`}
      />

      <P>
        {MONTH_NAMES[steadiest]}’s days have a standard deviation of {fmt(steadyStats.sd, 1)} °F against January’s {fmt(janStats.sd, 1)} °F: winter’s spread is
        almost twice summer’s. Notice which part of each distribution a business would care about. Nobody runs short of heating gas on an average January day; they run short on the
        coldest tenth of days, and in the years when those days come in a run. The tails are where the risk is, and the same average can hide very different tails. Chapter 4 will turn these distributions into heating demand, crop yields and
        cash flows.
      </P>
      <P>
        That answers this chapter’s question. Uneven heating drives a planetary circulation; its westerlies carry air masses that meet at fronts and feed storms;
        the oceans store heat and release it slowly, shifting whole seasons; and geography reshapes all of it into the distribution of weather each place lives
        with. But a distribution only says what a January can bring, not what next week will. For that we need to know the state of the atmosphere now, and how it
        will evolve — which starts with measuring it. Chapter 3 begins with a weather station in{' '}
        <a href={lessonHref('weather/3.1')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
