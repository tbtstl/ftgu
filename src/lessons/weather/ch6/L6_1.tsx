import { useDeferredValue, useMemo, useState } from 'react';
import {
  Button,
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
  confirmResetPart,
  isFenwick,
  regionClimate,
  regionKnobs,
  setCapstoneParts,
  updateCapstone,
  useWeatherCapstone,
  type RegionSettings,
} from '../shared/capstone';
import { CapstoneStrip, regionWords } from '../shared/CapstoneStrip';
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
  /** Fenwick Gas & Light's winter margin, if it served this region: its standard deviation and its 1-in-20 shortfall, $. */
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
    for (let i = 0; i < days; i++) july += cdd(tempF('fenwick', start + i, knobs));
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

/** Fenwick Bay's own winters: the reference every region is compared with. */
export function fenwickWinters(): RegionWinters {
  return regionWinters(REGION_DEFAULTS);
}

// ---------------------------------------------------------------------------
// The challenges.

/** Whether the region is Fenwick Bay's in everything but the day-to-day variability. */
export function othersFenwick(r: RegionSettings): boolean {
  return (Object.keys(REGION_DEFAULTS) as Array<keyof RegionSettings>).every((k) => k === 'variability' || Math.abs(r[k] - REGION_DEFAULTS[k]) < 1e-9);
}

/** Fenwick Bay with only the variability changed, to `v`. */
export function onlyVariability(r: RegionSettings, v: number): boolean {
  return othersFenwick(r) && Math.abs(r.variability - v) < 1e-9;
}

/** The first challenge's setting: every day's swing doubled. */
export const DOUBLED = 2;
/** The second challenge's setting: every day's swing halved. */
export const QUIETED = 0.5;

/** First challenge: the reader predicts whether doubling the days' swings doubles the winters' spread, then sets it. */
export const doubledSolved = (r: RegionSettings) => onlyVariability(r, DOUBLED);
/** Second challenge: the reader predicts, from the variance shares, whether quieting the days to half makes ENSO explain half, then sets it. */
export const quietedSolved = (r: RegionSettings) => onlyVariability(r, QUIETED);

export const ENSO_SHARE_TARGET = 0.5;

/** ENSO explains at least half of the variance of the region's winters. */
export function ensoShareSolved(r: RegionSettings): boolean {
  return regionWinters(r).r2 >= ENSO_SHARE_TARGET;
}

/** In Fenwick Bay's geography with the variability at × 1, the weakest pull (on the slider's 0.1 grid) at which ENSO explains half. */
export const ENSO_PULL_ANSWER = 2.1;
/** The same with the days quieted to × 0.5. */
export const QUIET_PULL_ANSWER = 1.2;

/** The share of a region's winter-to-winter variance that its warming trend adds: what setting the trend to zero removes. */
export function trendShareOf(w: RegionWinters, noTrend: RegionWinters): number {
  return 1 - (noTrend.sd * noTrend.sd) / (w.sd * w.sd);
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
  for (let d = 0; d < DAYS; d++) series[d] = tempF('fenwick', d, knobs);
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
  const fenwick = regionClimate(REGION_DEFAULTS);
  const line = (c: typeof cl) => linePath(DAY_GRID.map(YX), DAY_GRID.map((d) => clampY(normalTemp(c, d))));
  const band = areaPath(bands.doy.map(YX), bands.high.map(clampY), bands.low.map(clampY));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 306"
      role="img"
      aria-label={`The region's year: a January normal of ${fmt(monthNormal(cl, 0), 1)} °F and a July normal of ${fmt(monthNormal(cl, 6), 1)} °F, with the middle 80% of its simulated days shaded, against Fenwick Bay's normal of ${fmt(monthNormal(fenwick, 0), 1)} °F in January and ${fmt(monthNormal(fenwick, 6), 1)} °F in July.`}
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
      <path d={line(fenwick)} fill="none" stroke="#777" strokeWidth={1.6} strokeDasharray="6 4" />
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
        label="Continentality"
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
      <Slider label="Day-to-day variability" tone={WX.temperature} value={r.variability} min={0.25} max={2.5} step={0.05} onChange={(v) => set({ variability: v })} display={`× ${fmt(r.variability, 2)}`} />
      {trend && (
        <Slider label="Warming trend" tone={WX.temperature} value={r.trend} min={-0.05} max={0.1} step={0.01} onChange={(v) => set({ trend: v })} display={`${signed(r.trend, 2)} °F a year`} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The end of the lesson: keep the region, or return to Fenwick Bay to follow the text.

const BOX = { margin: '1.5em 0 0', padding: '10px 14px 12px', border: '1px solid var(--rule-strong)', borderRadius: 6, fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' } as const;

function RegionChoice({ region }: { region: RegionSettings }) {
  const [kept, setKept] = useState(false);
  const [undo, setUndo] = useState<RegionSettings | null>(null);
  const fenwick = isFenwick(region);
  return (
    <aside aria-label="The region for the rest of the capstone" style={BOX}>
      <div style={{ fontSize: 13 }}>The region for Lessons 6.2–6.5</div>
      <p style={{ margin: '4px 0 8px', color: 'var(--text)' }}>
        {fenwick
          ? 'Fenwick Bay: the next four lessons run on it, and their text quotes it number for number.'
          : `Your own: ${regionWords(region).replace(/^your own: /, '')}. Keep it, and the next four lessons run their figures and challenges on it, while their text quotes Fenwick Bay’s numbers and each lesson shows where yours differ. Or return to Fenwick Bay to follow the text number for number.`}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
        {!fenwick && (
          <>
            <Button primary onClick={() => setKept(true)}>
              Keep my region
            </Button>
            <Button
              onClick={() => {
                setUndo(region);
                setKept(false);
                setCapstoneParts({ region: REGION_DEFAULTS });
              }}
            >
              Return to Fenwick Bay
            </Button>
            {kept && <span>Kept. The top of every capstone lesson shows it, with a button back to Fenwick Bay.</span>}
          </>
        )}
        {fenwick && undo && (
          <Button
            onClick={() => {
              setCapstoneParts({ region: undo });
              setUndo(null);
            }}
          >
            Undo: back to my region
          </Button>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const { region } = useWeatherCapstone();
  const r = useDeferredValue(region);
  const w = regionWinters(r);
  const c = fenwickWinters();
  const cl = regionClimate(r);
  const fenwickCl = regionClimate(REGION_DEFAULTS);
  const fenwick = isFenwick(region);
  const solved = doubledSolved(region);
  const solved2 = quietedSolved(region);
  const others = othersFenwick(region);

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
      quietPull: at({ variability: QUIETED, ensoF: QUIET_PULL_ANSWER }),
    };
  }, []);
  // Of Fenwick Bay's winter-to-winter variance: ENSO's share, the trend's (what setting the trend to
  // zero removes), and what is left for the days themselves.
  const trendShare = trendShareOf(c, n.noTrend);
  const daysShare = 1 - c.r2 - trendShare;
  // What the shares predict for ENSO's share with the days' part cut to a quarter.
  const quietPredicted = c.r2 / (c.r2 + trendShare + daysShare / 4);
  const decade = (x: RegionWinters, from: number) => x.hdd.slice(from, from + 10).reduce((a, b) => a + b, 0) / 10;

  const rows = [
    { key: 'mine', name: fenwick ? 'Your region (Fenwick Bay)' : 'Your region', cl, w },
    { key: 'fenwick', name: 'Fenwick Bay', cl: fenwickCl, w: c },
  ];

  const ratio = w.sd / c.sd;
  const meanOff = w.mean / c.mean - 1;
  const othersFirst = 'Put the other controls back to Fenwick Bay’s first (Reset does it): only the variability should change.';

  return (
    <LessonPage id="weather/6.1">
      <CapstoneStrip parts={['region']} button="Return to Fenwick Bay" />
      <P>
        This course has climbed from sunlight to markets one step at a time. Chapter 1 asked why weather happens at all: a planet heated unevenly, air that grows
        lighter as it warms, water vapor that carries energy, and a spinning Earth that turns every push into a wind. Chapter 2 assembled those pieces into the
        circulation, the fronts and storms, the slow swings of the Pacific and the climates of particular places. Chapter 3 measured the atmosphere and forecast it
        honestly, as probabilities that fade toward climate within two weeks. Chapter 4 turned the weather into money for a gas utility, a farm and a wind farm, and
        Chapter 5 wrote contracts on the weather, priced them, traded them against a market and tested every idea against history.
      </P>
      <P>
        Each of those lessons took one piece at a time, in Fenwick Bay. This chapter puts them together, in a region of your own. First you build the region;
        in <a href={lessonHref('weather/6.2')}>6.2</a> you forecast its days; in <a href={lessonHref('weather/6.3')}>6.3</a> you turn those forecasts into a
        business’s exposure; in <a href={lessonHref('weather/6.4')}>6.4</a> you price contracts on its weather and choose which to hold; and in{' '}
        <a href={lessonHref('weather/6.5')}>6.5</a> you replay the whole book over the archive’s winters, with every decision made from forecasts issued on their own
        dates. There is nothing new to learn. Every mechanic is one you have already used, and your choices carry from lesson to lesson — they are saved in your
        browser, and nowhere else. The text quotes Fenwick Bay and the starting settings throughout; the box at the top of each lesson shows what yours are.
      </P>
      <P>
        A region, in this course, is the climate of the station its contracts settle on. Three facts set it, by the rules of{' '}
        <a href={lessonHref('weather/2.5')}>Lesson 2.5</a>: its <b>latitude</b>, which sets the sunlight of <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>; its{' '}
        <b>continentality</b>, how far it lies from a sea the wind blows in from, which damps the seasons — less so on an east coast, where the westerlies of{' '}
        <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> arrive over land; and its <b>elevation</b>, which subtracts the lapse rate of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a>. Three more knobs act on the weather
        itself: how hard the Pacific pulls on its winters (<a href={lessonHref('weather/2.4')}>Lesson 2.4</a>), how far its days swing from one to the next, and how
        fast it is warming. Underneath is the course’s simulated archive — the same 41 years of days, each day’s departure from normal stretched and shifted by your
        climate. None of it is real weather, and nothing built on it is real money.
      </P>
      <P>
        In the next demonstration, the red line is your region’s normal year and the shaded band holds the middle 80% of its simulated days; the dashed gray line is
        Fenwick Bay’s normal year, where the region starts. The table compares the two, including the <K tone={WX.index}>heating season</K> — November through March,
        counted in the degree days of <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> — and how much it varies from one winter to the next. Build the region:
      </P>

      <Figure name="Weather World Builder" onReset={() => confirmResetPart('region')}>
        <YearChart r={r} />
        <Legend
          items={[
            { label: 'Your region’s normal', color: GRAPHIC.red, kind: 'line' },
            { label: 'Middle 80% of its days', color: tint(GRAPHIC.red, 0.35) },
            { label: 'Fenwick Bay’s normal', color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <DataTable
          caption="Your region and Fenwick Bay: annual mean, January and July normals, the heating season's average degree days and their winter-to-winter standard deviation, and July's cooling degree days"
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
            { label: 'July cooling', cell: (row) => `${fmt(row.w.julyCdd)} CDD`, align: 'right' },
          ]}
        />
        <GeographySliders r={region} />
        <WeatherSliders r={region} />
        <Caption>
          {fenwick
            ? 'This is Fenwick Bay’s own climate. Move any control to make the region your own.'
            : `Your heating season averages ${signed(meanOff * 100)}% against Fenwick Bay’s, and varies ${fmt(ratio, 2)} times as much from winter to winter.`}
        </Caption>
      </Figure>

      <P>
        Each control does what its lesson said it would. Move the region to 45° north and its heating season grows from {fmt(c.mean)} to {fmt(n.north.mean)} degree
        days; at 35°, it shrinks to {fmt(n.south.mean)}. Put the sea upwind and the seasons flatten: with the wind off the sea, a winter collects only{' '}
        {fmt(n.sea.mean)} degree days and varies by {fmt(n.sea.sd)} from one winter to the next, against Fenwick Bay’s {fmt(c.sd)}. Deep inland, it is{' '}
        {fmt(n.inland.mean)} and {fmt(n.inland.sd)}. Raise it 500 m and every day is colder by the lapse rate: {fmt(n.high.mean)} degree days.
      </P>
      <P>
        The weather knobs are subtler. Raise the warming trend to 0.10 °F a year, more than three times Fenwick Bay’s, and the average barely moves, but the first ten
        winters now average {fmt(decade(n.fastTrend, 0))} degree days and the last ten {fmt(decade(n.fastTrend, 30))}: a market that prices a winter from the past
        has to allow for the drift, as the burn analysis of <a href={lessonHref('weather/5.2')}>Lesson 5.2</a> did. The day-to-day variability stretches every
        day’s departure from its normal, the cold snaps and the mild spells alike.
      </P>

      <Challenge
        id="a"
        question={`Predict first: Fenwick Bay’s winters vary by ±${fmt(c.sd)} degree days from one to the next. Make every day swing twice as far from its normal — variability × ${fmt(DOUBLED)}, everything else left as Fenwick Bay’s — and will the winters vary twice as much, by ±${fmt(2 * c.sd)}? Decide, then set it and read the table.`}
        solved={solved}
        status={others ? `Make your prediction, then set the day-to-day variability to × ${fmt(DOUBLED)}.` : othersFirst}
        success={`Solved: the winters now vary by ±${fmt(w.sd)}, ${fmt(ratio, 2)} times as much — not twice. Part of a winter’s spread doesn’t come from its days at all: it comes from the Pacific and from the trend, and stretching the days leaves those alone. The average moves a little too, to ${fmt(w.mean)}, because a mild day can’t count fewer than zero degree days while a cold one counts in full.`}
      />

      <P>
        Stretch the days by half, to × 1.5, and the spread grows only {fmt(n.wild.sd / c.sd, 2)} times, to {fmt(n.wild.sd)}. A winter’s spread has parts that
        don’t come from its days — the Pacific’s tilt and the warming trend — and the next demonstration pulls them apart.
      </P>

      <H2>The winters you’ll trade</H2>
      <P>
        The rest of the capstone deals in whole winters: the utility’s winter margin of <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>, the seasonal strips of{' '}
        <a href={lessonHref('weather/5.5')}>Lesson 5.5</a>, the monthly futures of <a href={lessonHref('weather/5.3')}>Lesson 5.3</a>. In the next demonstration, the
        upper chart is your region’s 40 simulated winters, each drawn as how far its heating season came in above or below the region’s average: red circles and
        bars for El Niño winters, blue squares and bars for La Niña winters, gray for the rest. The lower chart places each winter against that winter’s
        December–February <K tone={WX.temperature}>Niño-3.4</K>, with the best straight line through them. The readouts imagine Fenwick Gas &amp; Light serving your
        region instead. Its two controls are the same as in <FigRef to="Weather World Builder">the first demonstration</FigRef>:
      </P>

      <Figure name="Weather World Builder · its winters" onReset={() => confirmResetPart('region')}>
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
        At Fenwick Bay’s own settings, the winter’s Niño-3.4 explains {pct(c.r2)} of the variance of its heating seasons. El Niño winters average {fmt(c.elMean)}{' '}
        degree days, {signed(c.elMean - c.mean)} against the average, and La Niña winters {fmt(c.laMean)}, {signed(c.laMean - c.mean)}: a gap of{' '}
        {fmt(c.laMean - c.elMean)}. Fenwick Gas &amp; Light’s winter margin varies with a standard deviation of {usd(c.marginSd / 1e6, 1)} million, and one
        winter in 20 falls {usd(c.shortfall / 1e6, 1)} million short of its average. Of the other {pct(1 - c.r2)} of the variance, a little is the warming trend:
        set it to zero and the spread falls from {fmt(c.sd)} to {fmt(n.noTrend.sd)} degree days, about {fmt(trendShare * 100)} points of the variance. The
        remaining {pct(daysShare)} is the weather of the days themselves — the cold snaps and mild spells that the forecasts of{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> see only a week or two ahead.
      </P>
      <P>
        Those two parts of the risk call for different tools, and the rest of the capstone will use both. The part ENSO explains is visible in the autumn; a market
        that ignores it misprices whole winters, and that is where <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> found its edge. The rest can only be hedged,
        with the contracts of <a href={lessonHref('weather/5.5')}>Lesson 5.5</a>, or forecast at short range, day by day, as the winter unfolds.
      </P>

      <Challenge
        id="b"
        question={`Predict first, from those shares: quiet the days to half their swings — variability × ${fmt(QUIETED, 1)}, everything else Fenwick Bay’s — and the days’ part of the variance falls to about a quarter. Will the Pacific then explain at least half of the variance of the winters? Decide, then set it and read the readouts.`}
        solved={solved2}
        status={others ? `Make your prediction, then set the day-to-day variability to × ${fmt(QUIETED, 1)}.` : othersFirst}
        success={`Solved: ENSO now explains ${pct(w.r2)} — far more than Fenwick Bay’s ${pct(c.r2)}, but still short of half. The shares said as much: a quarter of the days’ ${fmt(daysShare * 100)} points is about ${fmt((daysShare * 100) / 4)}, so ENSO’s ${fmt(c.r2 * 100)} points sit against the trend’s ${fmt(trendShare * 100)} and those ${fmt((daysShare * 100) / 4)} — about ${pct(quietPredicted)}, a little under half — and the simulation puts it lower still. With the days this quiet, a little more pull carries it past half: at ${fmt(QUIET_PULL_ANSWER, 1)} °F per °C ENSO explains ${pct(n.quietPull.r2)}; at Fenwick Bay’s own days it takes ${fmt(ENSO_PULL_ANSWER, 1)}. In a region like that, a forecaster who reads the Pacific in October knows a great deal about the winter before it starts.`}
      />

      <P>
        Your region is built: a climate, a distribution of winters, and the same simulated days of weather underneath. A distribution says what a winter can bring;
        it doesn’t say what next week will bring. The next lesson forecasts your region’s days, one at a time, with five forecasters — the climate alone, today’s
        departure from normal, an overconfident weather model, a calibrated one, and one you tune yourself — and scores them. From Lesson 6.3 on, the capstone
        forecasts with the calibrated model; the competition shows why it deserves that trust. Before you go, choose the region the rest of the capstone runs on:
      </P>
      <RegionChoice region={region} />
    </LessonPage>
  );
}
