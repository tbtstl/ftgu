import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  signed,
  tint,
  useScenario,
} from '../../../framework';
import { dayInfo, ninoForecast, type WorldKnobs } from '../../../model/weather/archive';
import { MONTH_NAMES } from '../../../model/weather/region';
import { UTILITY } from '../../../engines/weather/degreeDays';
import { farmYears, summarize, windYears, type Summary } from '../../../engines/weather/exposure';
import { exposureSeries, hedgeFit, hedgedSpread, type BusinessKind, type ExposureSeries } from '../../../engines/weather/exposureFit';
import { expectedIndex } from '../../../engines/weather/market';
import { CME_TICK, WINTER_SEASON, contractSpan, indexDistribution, monthContract, quantile, settledIndex, type ContractSpec } from '../../../engines/weather/pricing';
import { REGION_DEFAULTS, isCalder, regionKnobs, resetCapstone, updateCapstone, useWeatherCapstone, type RegionSettings } from '../shared/capstone';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The utility's outlook on a valuation date: the index distribution of Lesson 5.2, rescaled to
// the utility's margin.

export const SEASON: ContractSpec = { kind: 'HDD', months: WINTER_SEASON, type: 'future', strike: 0, tick: CME_TICK };
export const JAN = monthContract('HDD', 0);
export type Period = 'season' | 'january';
export const PATHS = 400;
/** First valuation date shown: this many days before the period begins. */
export const LEAD_DAYS = 60;
/** The utility's margin per heating degree day, before scaling: $3 × 18,000 MMBtu. */
export const DOLLARS_PER_HDD = UTILITY.margin * UTILITY.perHdd;

function specOf(period: Period, winter: number): { spec: ContractSpec; year: number } {
  return period === 'season' ? { spec: SEASON, year: winter } : { spec: JAN, year: winter + 1 };
}

export function periodDays(period: Period): number {
  return contractSpan(period === 'season' ? SEASON : JAN, 2).days;
}

export interface Outlook {
  /** Simulated index outcomes, sorted, with their mean set to the exact expected index. */
  samples: number[];
  mean: number;
  sd: number;
  /** The plan: the index expected from the climate alone, before any forecast or ENSO. */
  plan: number;
  settled: number;
  daysRealized: number;
  daysForecast: number;
  daysClimate: number;
  /** The 1-in-20 outcome: the 5th percentile of the index. */
  p5: number;
  days: number;
}

const outlookCache = new Map<string, Outlook>();

/** The index outlook for the utility's period on a date (offset from the period's first day). */
export function outlook(period: Period, winter: number, offset: number, knobs: WorldKnobs, regionKey: string): Outlook {
  const key = `${period}|${winter}|${offset}|${regionKey}`;
  const hit = outlookCache.get(key);
  if (hit) return hit;
  const { spec, year } = specOf(period, winter);
  const { start, days } = contractSpan(spec, year);
  const day = start + offset;
  const d = indexDistribution(spec, year, day, { paths: PATHS, knobs });
  // As in Lesson 5.2: keep the simulation's spread and shape, take its mean from the exact
  // closed form built from the same information.
  const shift = expectedIndex(spec, year, day, { knobs }) - d.mean;
  const samples = Array.from(d.samples, (v) => Math.max(d.realized, v + shift)).sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
  const out: Outlook = {
    samples,
    mean,
    sd,
    plan: expectedIndex(spec, year, start - LEAD_DAYS - 1, { knobs, ignoreEnso: true }),
    settled: settledIndex(spec, year, knobs),
    daysRealized: d.daysRealized,
    daysForecast: d.daysForecast,
    daysClimate: d.daysClimate,
    p5: quantile(samples, 0.05),
    days,
  };
  if (outlookCache.size > 300) outlookCache.clear();
  outlookCache.set(key, out);
  return out;
}

/** Margin difference from plan for an index value, $. */
export function missOf(o: Outlook, index: number, scaleFactor: number): number {
  return scaleFactor * DOLLARS_PER_HDD * (index - o.plan);
}

/** The plan's margin, $. */
export function planMargin(o: Outlook, scaleFactor: number): number {
  return scaleFactor * UTILITY.margin * (UTILITY.baseLoad * o.days + UTILITY.perHdd * o.plan);
}

// ---------------------------------------------------------------------------
// The first challenge: the largest utility whose 1-in-20 season, judged on October 31, falls
// no more than $10 million short of plan.

export const BOARD_LIMIT = 10_000_000;
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 2;
export const SCALE_STEP = 0.05;

/** The 1-in-20 shortfall against plan at scale 1, $ (negative if even the 1-in-20 beats the plan). */
export function shortfallAtUnit(o: Outlook): number {
  return -missOf(o, o.p5, 1);
}

export function boardSolved(st: { kind: BusinessKind; scale: number; period: Period; offset: number }, o: Outlook): boolean {
  if (st.kind !== 'utility' || st.period !== 'season' || st.offset !== -1) return false;
  const unit = shortfallAtUnit(o);
  if (unit <= 0) return false;
  const within = st.scale * unit <= BOARD_LIMIT + 1e-6;
  const nextOver = st.scale + SCALE_STEP > SCALE_MAX + 1e-9 || (st.scale + SCALE_STEP) * unit > BOARD_LIMIT;
  return within && nextOver;
}

// ---------------------------------------------------------------------------
// Wind farm and corn farm: their archive distributions (no forecasts for them in this course).

const archiveCache = new Map<string, number[]>();
export function archiveResults(kind: 'wind' | 'farm', region: RegionSettings): number[] {
  const key = `${kind}|${kind === 'farm' ? `${region.variability}|${region.trend}` : ''}`;
  let v = archiveCache.get(key);
  if (!v) {
    v = kind === 'wind' ? windYears().map((w) => w.revenue) : farmYears(0.02, { variability: region.variability, trend: region.trend }).map((f) => f.profit);
    archiveCache.set(key, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// The second challenge: the number of strips, to the nearest hundred, with the smallest spread.

export const STRIPS_MAX = 6000;
export const STRIPS_STEP = 100;

export function bestStripsOnGrid(s: ExposureSeries): number {
  let best = 0;
  let bestSd = Infinity;
  for (let n = 0; n <= STRIPS_MAX; n += STRIPS_STEP) {
    const sd = hedgedSpread(s, n);
    if (sd < bestSd - 1e-6) {
      bestSd = sd;
      best = n;
    }
  }
  return best;
}

export function stripsSolved(kind: BusinessKind, strips: number, s: ExposureSeries): boolean {
  return kind === 'utility' && strips === bestStripsOnGrid(s);
}

// ---------------------------------------------------------------------------
// Drawing.

const BUSINESS_LABEL: Record<BusinessKind, string> = {
  utility: 'Calder Gas & Light',
  wind: 'Hollin Ridge wind farm',
  farm: 'Marlow corn farm',
};

function millions(x: number, digits = 1): string {
  const s = `$${fmt(Math.abs(x) / 1e6, digits)}M`;
  return x < 0 ? `−${s}` : s;
}

function signedMillions(x: number, digits = 1): string {
  return (x > 0 ? '+' : '') + millions(x, digits);
}

function money(x: number): string {
  return Math.abs(x) >= 1e6 ? millions(x) : (x < 0 ? '−' : '') + `$${fmt(Math.abs(x) / 1e3)}k`;
}

/** "60 days before November 1", "the close of October 31", "the close of December 14". */
export function dateLabel(period: Period, winter: number, offset: number): string {
  const { spec, year } = specOf(period, winter);
  const { start } = contractSpan(spec, year);
  const first = period === 'season' ? 'November 1' : 'January 1';
  if (offset < -1) return `${-offset} days before ${first}`;
  const info = dayInfo(start + offset);
  return `the close of ${MONTH_NAMES[info.month]} ${info.dom}`;
}

const HX0 = 56;
const HX1 = 624;
const HY0 = 30;
const HY1 = 200;

function OutcomeChart({ o, k, show, label }: { o: Outlook; k: number; show: boolean; label: string }) {
  const misses = o.samples.map((v) => missOf(o, v, k) / 1e6);
  const marks = [0, missOf(o, o.mean, k) / 1e6, missOf(o, o.p5, k) / 1e6, ...(show ? [missOf(o, o.settled, k) / 1e6] : [])];
  let lo = Math.min(...misses, ...marks);
  let hi = Math.max(...misses, ...marks);
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const [d0, d1] = niceDomain(lo, hi, 6);
  const x = scale(d0, d1, HX0, HX1);
  const bins = 36;
  const counts = new Array(bins).fill(0);
  for (const m of misses) counts[Math.min(bins - 1, Math.max(0, Math.floor(((m - d0) / (d1 - d0)) * bins)))]++;
  const maxC = Math.max(...counts);
  const y = scale(0, maxC, HY1, HY0 + 14);
  const bw = (HX1 - HX0) / bins;
  const mean = missOf(o, o.mean, k) / 1e6;
  const p5 = missOf(o, o.p5, k) / 1e6;
  const settled = missOf(o, o.settled, k) / 1e6;
  return (
    <svg className="chart" viewBox="0 0 640 236" role="img" aria-label={label}>
      <text className="ax" x={HX0} y={14}>
        The winter’s margin against plan, $ millions, as known on this date
      </text>
      <line className="base" x1={HX0} x2={HX1} y1={HY1} y2={HY1} />
      {counts.map((c, i) =>
        c ? (
          <rect
            key={i}
            x={HX0 + i * bw + 0.5}
            y={y(c)}
            width={bw - 1}
            height={HY1 - y(c)}
            fill={d0 + ((i + 0.5) / bins) * (d1 - d0) < p5 ? tint(GRAPHIC.red, 0.55) : tint(GRAPHIC.blue, 0.5)}
          />
        ) : null,
      )}
      <line x1={x(0)} x2={x(0)} y1={HY0} y2={HY1} stroke="#777" strokeWidth={1.5} strokeDasharray="5 4" />
      <text className="ax ax-m" x={x(0)} y={HY0 - 4}>
        plan
      </text>
      <line x1={x(mean)} x2={x(mean)} y1={HY0 + 10} y2={HY1} stroke={GRAPHIC.blue} strokeWidth={2.5} />
      <line x1={x(p5)} x2={x(p5)} y1={HY0 + 22} y2={HY1} stroke={GRAPHIC.red} strokeWidth={2} />
      <text x={x(p5) - 4} y={HY0 + 32} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red, fontWeight: 500 }}>
        1 in 20
      </text>
      {show && (
        <g>
          <line x1={x(settled)} x2={x(settled)} y1={HY0 + 10} y2={HY1} stroke={GRAPHIC.orange} strokeWidth={2.5} strokeDasharray="6 3" />
          <text x={x(settled) + 4} y={HY0 + 20} style={{ fontSize: 12, fill: TEXT.orange, fontWeight: 500 }}>
            settled
          </text>
        </g>
      )}
      {niceTicks(d0, d1, 6).map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={HY1 + 16}>
          {t === 0 ? '0' : signed(t, Math.abs(t) < 1 ? 1 : 0)}
        </text>
      ))}
      <InfoBar o={o} />
    </svg>
  );
}

/** Where the outlook's days come from: settled, forecast, climate. */
function InfoBar({ o }: { o: Outlook }) {
  const total = o.days;
  const x = scale(0, total, HX0, HX1);
  const segs = [
    { n: o.daysRealized, fill: '#8a8a8a', label: 'settled' },
    { n: o.daysForecast, fill: GRAPHIC.blue, label: 'forecast' },
    { n: o.daysClimate, fill: '#d9d6cf', label: 'climate' },
  ];
  let at = 0;
  return (
    <g aria-hidden="true">
      {segs.map((s) => {
        const x0 = x(at);
        at += s.n;
        const w = x(at) - x0;
        return s.n > 0 ? (
          <g key={s.label}>
            <rect x={x0} y={HY1 + 22} width={w} height={8} fill={s.fill} />
            {w > 70 && (
              <text className="ax" x={x0 + 2} y={HY1 + 44}>
                {s.n} {s.label}
              </text>
            )}
          </g>
        ) : null;
      })}
    </g>
  );
}

function ArchiveChart({ results, label }: { results: number[]; label: string }) {
  const s = summarize(results);
  const rel = results.map((r) => r - s.mean);
  const [lo, hi] = niceDomain(Math.min(...rel, s.p5 - s.mean), Math.max(...rel), 4);
  const y = scale(lo, hi, 196, 28);
  const x = scale(0, results.length, HX0, HX1);
  const bw = (HX1 - HX0) / results.length;
  return (
    <svg className="chart" viewBox="0 0 640 226" role="img" aria-label={label}>
      <text className="ax" x={HX0} y={14}>
        Each year against the average, in the simulated archive
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={HX0} x1={HX1} format={(v) => (v === 0 ? '0' : money(v))} baseline={0} />
      {rel.map((r, i) => (
        <rect key={i} x={x(i) + 1} y={Math.min(y(r), y(0))} width={bw - 2} height={Math.abs(y(r) - y(0))} fill={r < 0 ? tint(GRAPHIC.red, 0.7) : tint(GRAPHIC.green, 0.7)} />
      ))}
      <line x1={HX0} x2={HX1} y1={y(s.p5 - s.mean)} y2={y(s.p5 - s.mean)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={HX1} y={y(s.p5 - s.mean) + 14} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red, fontWeight: 500 }}>
        1 in 20
      </text>
      {[1, 11, 21, 31, 41].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr - 0.5)} y={214}>
          {yr === 1 ? 'year 1' : yr}
        </text>
      ))}
    </svg>
  );
}

function HedgeChart({ s, strips, best, label }: { s: ExposureSeries; strips: number; best: number; label: string }) {
  const fit = hedgeFit(s);
  const meanC = s.cash.reduce((a, b) => a + b, 0) / s.cash.length;
  const meanH = s.hdd.reduce((a, b) => a + b, 0) / s.hdd.length;
  const rel = s.cash.map((c) => (c - meanC) / 1e6);
  const [h0, h1] = niceDomain(Math.min(...s.hdd), Math.max(...s.hdd), 5);
  const [c0, c1] = niceDomain(Math.min(...rel), Math.max(...rel), 4);
  const x = scale(h0, h1, HX0, HX1);
  const y = scale(c0, c1, 176, 28);
  const fitLine = linePath(
    [h0, h1].map(x),
    [h0, h1].map((h) => y((fit.slope * (h - meanH)) / 1e6)),
  );
  const grid = Array.from({ length: STRIPS_MAX / STRIPS_STEP + 1 }, (_, i) => i * STRIPS_STEP);
  const spreads = grid.map((n) => hedgedSpread(s, n) / 1e6);
  const [s0, s1] = niceDomain(0, Math.max(...spreads), 3);
  const sx = scale(0, STRIPS_MAX, HX0, HX1);
  const sy = scale(s0, s1, 330, 238);
  const now = hedgedSpread(s, strips) / 1e6;
  return (
    <svg className="chart" viewBox="0 0 640 362" role="img" aria-label={label}>
      <text className="ax" x={HX0} y={14}>
        Each winter’s cash against its average ($ millions) and the region’s winter HDD
      </text>
      <GridY y={y} ticks={niceTicks(c0, c1, 4)} x0={HX0} x1={HX1} format={(v) => (v === 0 ? '0' : signed(v, Math.abs(c1 - c0) < 2 ? 1 : 0))} baseline={0} />
      <path d={fitLine} fill="none" stroke={GRAPHIC.orange} strokeWidth={2} />
      {s.hdd.map((h, i) => (
        <circle key={i} cx={x(h)} cy={y(rel[i])} r={4} fill={GRAPHIC.green} opacity={0.8} />
      ))}
      {niceTicks(h0, h1, 5).map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={194}>
          {fmt(t)}
        </text>
      ))}
      <text className="ax ax-e" x={HX1} y={208}>
        winter heating degree days
      </text>
      <text className="ax" x={HX0} y={228}>
        Spread of the hedged cash ($ millions) by strips sold
      </text>
      <GridY y={sy} ticks={niceTicks(s0, s1, 3)} x0={HX0} x1={HX1} format={(v) => fmt(v, s1 < 3 ? 1 : 0)} baseline={0} />
      <path d={linePath(grid.map(sx), spreads.map(sy))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} />
      <line className="cur" x1={sx(strips)} x2={sx(strips)} y1={238} y2={330} />
      <circle cx={sx(strips)} cy={sy(now)} r={5.5} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={2} />
      {[0, 1000, 2000, 3000, 4000, 5000, 6000].map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={348}>
          {fmt(t)}
        </text>
      ))}
      <text className="ax ax-e" x={HX1} y={361}>
        strips · least spread at {fmt(best)}
      </text>
    </svg>
  );
}

function regionText(r: RegionSettings): string {
  if (isCalder(r)) return 'Calder Bay’s own climate, the starting region';
  return `your region from Lesson 6.1: ${fmt(r.latitude, 1)}° N, continentality ${fmt(r.continentality, 2)}, ${fmt(r.elevation)} m up, ENSO’s pull ${fmt(r.ensoF, 1)} °F per °C, variability × ${fmt(r.variability, 2)}, warming ${fmt(r.trend, 2)} °F a year`;
}

// Numbers the prose quotes: always Calder Bay's own climate, winter 20.
const CALDER_KEY = JSON.stringify(REGION_DEFAULTS);
const CALDER_KNOBS = regionKnobs(REGION_DEFAULTS);
export const STORY_WINTER = 20;

export default function Lesson() {
  const cap = useWeatherCapstone();
  const region = cap.region;
  const regionKey = JSON.stringify(region);
  const knobs = useMemo(() => regionKnobs(region), [regionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = cap.business.kind;
  const k = cap.business.scale;

  const v = useScenario('outlook', { period: 'season' as Period, winter: STORY_WINTER, offset: -LEAD_DAYS, show: false });
  const { period, winter, show } = v.state;
  const days = periodDays(period);
  const offset = Math.min(v.state.offset, days - 1);
  const dPeriod = useDeferredValue(period);
  const dWinter = useDeferredValue(winter);
  const dOffset = useDeferredValue(offset);
  const dKey = useDeferredValue(regionKey);
  const o = useMemo(() => outlook(dPeriod, dWinter, Math.min(dOffset, periodDays(dPeriod) - 1), dKey === regionKey ? knobs : regionKnobs(JSON.parse(dKey)), dKey), [dPeriod, dWinter, dOffset, dKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const solved = boardSolved({ kind, scale: k, period: dPeriod, offset: dOffset }, o);
  const unitShort = shortfallAtUnit(o);

  const archiveRes = kind === 'utility' ? [] : archiveResults(kind, region);
  const archiveSum: Summary | null = kind === 'utility' ? null : summarize(archiveRes.map((r) => r * k));

  const h = useScenario('hedge', { strips: 0 });
  const strips = h.state.strips;
  const series = useMemo(() => exposureSeries(kind, k, knobs, `${kind}|${regionKey}`), [kind, k, knobs, regionKey]);
  const fit = useMemo(() => hedgeFit(series), [series]);
  const best = useMemo(() => bestStripsOnGrid(series), [series]);
  const spreadNow = hedgedSpread(series, strips);
  const solved2 = stripsSolved(kind, strips, series);

  // The story: Calder Bay's own climate, winter 20, at scale 1.
  const story = useMemo(() => {
    const at = (off: number) => outlook('season', STORY_WINTER, off, CALDER_KNOBS, CALDER_KEY);
    const early = at(-LEAD_DAYS);
    const eve = at(-1);
    const dec1 = at(30);
    const late = at(90);
    const { start } = contractSpan(SEASON, STORY_WINTER);
    const issue = dayInfo(start - LEAD_DAYS);
    const janAhead = (STORY_WINTER + 1 - issue.year) * 12 - issue.month;
    const nino = ninoForecast(issue.year, issue.month, janAhead);
    const util = exposureSeries('utility', 1, CALDER_KNOBS, `utility|${CALDER_KEY}`);
    const wind = exposureSeries('wind', 1, CALDER_KNOBS, `wind|${CALDER_KEY}`);
    const farm = exposureSeries('farm', 1, CALDER_KNOBS, `farm|${CALDER_KEY}`);
    const north = exposureSeries('utility', 1, regionKnobs({ ...REGION_DEFAULTS, latitude: 47, continentality: 1, elevation: 300 }), 'utility|story-north');
    const south = exposureSeries('utility', 1, regionKnobs({ ...REGION_DEFAULTS, latitude: 30, continentality: 0.3 }), 'utility|story-south');
    return {
      early,
      eve,
      dec1,
      late,
      nino,
      utilFit: hedgeFit(util),
      utilBest: bestStripsOnGrid(util),
      windFit: hedgeFit(wind),
      farmFit: hedgeFit(farm),
      northFit: hedgeFit(north),
      southFit: hedgeFit(south),
      windSum: summarize(archiveResults('wind', REGION_DEFAULTS)),
      farmSum: summarize(archiveResults('farm', REGION_DEFAULTS)),
    };
  }, []);

  const setKind = (kk: BusinessKind) => updateCapstone('business', { kind: kk });
  const setScale = (s: number) => updateCapstone('business', { scale: s });

  const kindSegment = (
    <Segmented
      label="Business"
      value={kind}
      onChange={setKind}
      options={[
        { value: 'utility', label: 'Calder Gas & Light' },
        { value: 'wind', label: 'Hollin Ridge wind' },
        { value: 'farm', label: 'Marlow corn' },
      ]}
    />
  );

  const date = dateLabel(dPeriod, dWinter, dOffset);
  const planM = planMargin(o, k);
  const expMiss = missOf(o, o.mean, k);
  const p5Miss = missOf(o, o.p5, k);
  const sdM = k * DOLLARS_PER_HDD * o.sd;
  const periodName = dPeriod === 'season' ? `winter ${dWinter}–${dWinter + 1}` : `January of year ${dWinter + 1}`;

  return (
    <LessonPage id="weather/6.3">
      <P>
        <a href={lessonHref('weather/6.1')}>Lesson 6.1</a> built a region and <a href={lessonHref('weather/6.2')}>Lesson 6.2</a> forecast its weather. A forecast is
        only half of what a business needs. The other half is the answer to the question a finance department asks every autumn: what will this winter do to us?{' '}
        <a href={lessonHref('weather/4.5')}>Lesson 4.5</a> answered it looking back, season by season over the archive. This lesson answers it looking forward,
        on a particular date, with only what is known by then — the method of <a href={lessonHref('weather/5.2')}>Lesson 5.2</a>, applied to a business instead of
        a contract.
      </P>
      <P>
        Nothing in it is new. The region in play is {regionText(region)}; change it in Lesson 6.1 and every number here follows. The weather comes from the course’s
        simulated archive, and the businesses are simulated too. The one choice that belongs to this lesson is the business itself: which of the region’s three to
        follow, and how big it is. The capstone keeps that choice, and the trading desk of the next lesson will hedge whatever you leave here.
      </P>
      <P>
        Start with Calder Gas &amp; Light. <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> gave its rule: it delivers {fmt(UTILITY.baseLoad)} MMBtu of gas a day
        plus {fmt(UTILITY.perHdd)} MMBtu for every <K tone={WX.index}>heating degree day</K>, and keeps ${UTILITY.margin} on each. So every degree day is worth{' '}
        ${fmt(DOLLARS_PER_HDD)} of <K tone={WX.money}>margin</K>, and the distribution of the winter’s margin is the distribution of its degree-day index, rescaled.
        (The windy days of Lesson 4.5 add a little that the index can’t see; we’ll come back to them.) The utility plans its winter on the climate alone — the
        degree days the region’s normal would bring, before any forecast — and what it risks is the miss against that plan. In the next demonstration, each bar is
        a share of the simulated outcomes for the utility’s margin as known on the chosen date, measured from the plan; the red bars are the worst twentieth. The
        strip underneath says where the period’s days come from on that date: settled already, forecast, or still climate. Choose the business, its size, the
        period, the winter and the date:
      </P>

      <Figure
        name="Weather Exposure Engine"
        onReset={() => {
          resetCapstone('business');
          v.reset();
        }}
      >
        {kindSegment}
        {kind === 'utility' ? (
          <>
            <Segmented
              label="Period"
              value={period}
              onChange={(p) => v.set({ period: p, offset: Math.min(offset, periodDays(p) - 1) })}
              options={[
                { value: 'season', label: 'The heating season' },
                { value: 'january', label: 'January' },
              ]}
            />
            <OutcomeChart
              o={o}
              k={k}
              show={show}
              label={`${BUSINESS_LABEL.utility} at ${fmt(k, 2)} times its size, ${periodName}, as known at ${date}: plan ${millions(planM)}, expected ${signedMillions(expMiss)} against plan, 1-in-20 ${signedMillions(p5Miss)}, spread ${millions(sdM)}. ${o.daysRealized} days settled, ${o.daysForecast} forecast, ${o.daysClimate} from the climate.${show ? ` It settled ${signedMillions(missOf(o, o.settled, k))} against plan.` : ''}`}
            />
            <Legend
              items={[
                { label: 'Simulated outcomes', color: tint(GRAPHIC.blue, 0.5) },
                { label: 'Worst twentieth', color: tint(GRAPHIC.red, 0.55) },
                { label: 'Expected now', color: GRAPHIC.blue, kind: 'line' },
                { label: 'Plan', color: '#777', kind: 'line', dashed: true },
                ...(show ? [{ label: 'How it settled', color: GRAPHIC.orange, kind: 'line' as const, dashed: true }] : []),
              ]}
            />
            <Readouts
              items={[
                { label: 'plan, from the climate alone', value: millions(planM), tone: WX.money },
                { label: 'expected now, against plan', value: signedMillions(expMiss), tone: WX.money },
                { label: '1-in-20 outcome, against plan', value: signedMillions(p5Miss), tone: p5Miss < 0 ? 'red' : WX.money },
                { label: 'spread (standard deviation)', value: millions(sdM), tone: WX.probability },
              ]}
            />
            <Slider label="Winter" value={winter} min={2} max={40} onChange={(w) => v.set({ winter: w })} display={`${winter}–${winter + 1}`} />
            <Slider label="Valuation date" tone={WX.probability} value={offset} min={-LEAD_DAYS} max={days - 1} onChange={(x) => v.set({ offset: x })} display={dateLabel(period, winter, offset)} />
            <Slider label="Size of the utility" tone={WX.money} value={k} min={SCALE_MIN} max={SCALE_MAX} step={SCALE_STEP} onChange={setScale} display={`× ${fmt(k, 2)}`} />
            <Checkbox label="Show how it settled" checked={show} onChange={(c) => v.set({ show: c })} />
            <Caption>
              On {date}, {o.daysRealized} of the {o.days} days are settled, the forecast reaches {o.daysForecast}, and {o.daysClimate} are still climate. The plan is{' '}
              {fmt(o.plan)} degree days; the outlook is {fmt(o.mean)} ± {fmt(o.sd)}.
            </Caption>
          </>
        ) : (
          <>
            <ArchiveChart
              results={archiveRes.map((r) => r * k)}
              label={`${BUSINESS_LABEL[kind]} at ${fmt(k, 2)} times its size over the archive's 41 simulated years: average ${money(archiveSum!.mean)}, spread ${money(archiveSum!.sd)}, 1-in-20 year ${money(archiveSum!.p5 - archiveSum!.mean)} against the average, worst ${money(archiveSum!.min - archiveSum!.mean)}.`}
            />
            <Readouts
              items={[
                { label: kind === 'wind' ? 'average revenue' : 'average profit', value: money(archiveSum!.mean), tone: WX.money },
                { label: 'spread (standard deviation)', value: money(archiveSum!.sd), tone: WX.probability },
                { label: '1-in-20 year, against average', value: money(archiveSum!.p5 - archiveSum!.mean), tone: 'red' },
                { label: 'worst year, against average', value: money(archiveSum!.min - archiveSum!.mean), tone: 'red' },
              ]}
            />
            <Slider label={`Size of the ${kind === 'wind' ? 'wind farm' : 'farm'}`} tone={WX.money} value={k} min={SCALE_MIN} max={SCALE_MAX} step={SCALE_STEP} onChange={setScale} display={`× ${fmt(k, 2)}`} />
            <Caption>
              {kind === 'wind'
                ? 'This course forecasts temperature, not wind, so the wind farm can plan only on the climate of its wind: the spread of the archive’s years.'
                : 'The corn farm’s season is decided in July and August, months after any forecast in this course can reach, so its plan is the climate of its harvests.'}
            </Caption>
          </>
        )}
      </Figure>

      <P>
        In Calder Bay’s own climate, follow winter {STORY_WINTER}–{STORY_WINTER + 1}. Its plan is {fmt(story.early.plan)} degree days, a margin of{' '}
        {millions(planMargin(story.early, 1))}. Sixty days before November no forecast reaches the season, yet the outlook already sits{' '}
        {signedMillions(missOf(story.early, story.early.mean, 1))} from plan: that autumn the Pacific was heading for a La Niña, about {fmt(story.nino, 1)} °C, and{' '}
        <a href={lessonHref('weather/2.4')}>Lesson 2.4</a> showed what that does to the region’s winters. The spread is {millions(DOLLARS_PER_HDD * story.early.sd)}, and
        the 1-in-20 winter falls {millions(-missOf(story.early, story.early.p5, 1))} short. By the close of October 31 the forecast of{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> reaches the first {story.eve.daysForecast} days, and the 1-in-20 shortfall is down to{' '}
        {millions(-missOf(story.eve, story.eve.p5, 1))}. On December 1, with November settled, it is {millions(-missOf(story.dec1, story.dec1.p5, 1))}. By the end of
        January even the worst twentieth of outcomes is ahead of plan, at {signedMillions(missOf(story.late, story.late.p5, 1))}. The winter settled at{' '}
        {fmt(story.early.settled)} degree days, {signedMillions(missOf(story.early, story.early.settled, 1))} against plan — inside every outlook along the way.
      </P>
      <P>
        Notice what narrows the distribution and what doesn’t. Each settled day removes its own uncertainty for good. The forecast removes some of the uncertainty
        of the next fortnight, more for the nearer days. Everything beyond is still climate, tilted only by the Pacific. A heating season is 151 days long, so for
        most of it the utility’s risk is the climate’s risk, and the forecast matters most at the end, when little is left to forecast. January alone, a month
        rather than a season, narrows much faster: switch the period and watch.
      </P>

      <Challenge
        id="a"
        question={`The utility’s board will accept a 1-in-20 heating season no more than $10 million short of plan, judged at the close of October 31. Pick a winter where that limit binds, and find the largest size of the utility, in steps of ${SCALE_STEP}, that meets it.`}
        solved={solved}
        status={
          kind !== 'utility'
            ? 'Choose Calder Gas & Light first.'
            : dPeriod !== 'season' || dOffset !== -1
              ? 'Set the period to the heating season and the date to the close of October 31.'
              : unitShort <= 0
                ? `In this winter even the 1-in-20 outcome beats the plan on October 31, so no size breaks the limit. Try another winter.`
                : `At × ${fmt(k, 2)} the 1-in-20 season falls ${millions(k * unitShort, 2)} short of plan.`
        }
        success={`Solved. At × ${fmt(k, 2)} the 1-in-20 season falls ${millions(k * unitShort, 2)} short; at × ${fmt(k + SCALE_STEP, 2)} it would fall ${millions((k + SCALE_STEP) * unitShort, 2)} short. The risk grows in proportion to the business, so a risk limit is also a limit on size — unless the risk can be handed to someone else.`}
      />

      <P>
        The other two businesses can’t be followed this way, and the honest thing is to say so. This course forecasts temperature, not wind, so the Hollin Ridge
        wind farm of <a href={lessonHref('weather/4.4')}>Lesson 4.4</a> plans on the climate of its wind: across the archive its revenue averages{' '}
        {millions(story.windSum.mean)} with a spread of {millions(story.windSum.sd)}, and its 1-in-20 year comes in {millions(story.windSum.mean - story.windSum.p5)}{' '}
        short. The Marlow corn farm of <a href={lessonHref('weather/4.3')}>Lesson 4.3</a> is decided by July and August heat and rain, far beyond any forecast here:
        its profit averages {money(story.farmSum.mean)} with a spread of {money(story.farmSum.sd)}, and its 1-in-20 year loses {money(-story.farmSum.p5)}. The farm keeps
        Marlow’s own climate in every region; it shares only the region’s variability and trend.
      </P>

      <H2>What to hedge</H2>
      <P>
        An outlook says how much is at risk. To hand the risk on, the desk also needs to know which index moves with the business and how many contracts of it
        match the business’s size. That is the regression of Lesson 4.5: set each winter’s cash against the region’s winter degree days, read the dollars per
        degree day off the slope, and the share of the variation the index explains off R². A seasonal strip pays ${CME_TICK} a degree day, so selling slope ÷ $
        {CME_TICK} strips cancels the slope exactly. In the next demonstration, the dots are the archive’s winters for the business chosen in{' '}
        <FigRef to="Weather Exposure Engine">the first demonstration</FigRef>, at its size, and the lower curve is how widely the cash would still vary after
        selling a given number of strips at a fixed level. Choose the business and the number of strips:
      </P>

      <Figure name="Weather Exposure Engine · what to hedge" scenario={h}>
        {kindSegment}
        <HedgeChart
          s={series}
          strips={strips}
          best={best}
          label={`${BUSINESS_LABEL[kind]} at ${fmt(k, 2)} times its size against the region's winter HDD: ${money(fit.slope)} per degree day, R² ${pct(fit.r2)}. Unhedged spread ${money(fit.cashSd)}; with ${fmt(strips)} strips, ${money(spreadNow)}; least at ${fmt(best)} strips.`}
        />
        <Readouts
          items={[
            { label: 'cash per degree day', value: money(fit.slope), tone: WX.money },
            { label: 'R², explained by the index', value: pct(fit.r2), tone: WX.index },
            { label: 'strips, slope ÷ $20', value: fmt(Math.max(0, fit.strips)), tone: WX.index },
            { label: `spread with ${fmt(strips)} strips`, value: money(spreadNow), tone: WX.probability },
          ]}
        />
        <Slider label="Seasonal strips sold" tone={WX.index} value={strips} min={0} max={STRIPS_MAX} step={STRIPS_STEP} onChange={(n) => h.set({ strips: n })} display={fmt(strips)} />
      </Figure>

      <P>
        For Calder Gas &amp; Light in Calder Bay’s climate the fit is close: {money(story.utilFit.slope)} per degree day, an R² of {pct(story.utilFit.r2)}, and a
        minimum-variance hedge of about {fmt(story.utilFit.strips)} strips, {fmt(story.utilBest)} to the nearest hundred, which takes the winter-to-winter spread from{' '}
        {millions(story.utilFit.cashSd)} to {millions(story.utilFit.residualSd)}. What is left is the wind, the basis risk no degree-day contract can touch. The
        number of strips comes from the business, not the climate. Move the region to a colder, more continental city at 47° north and the spread grows to{' '}
        {millions(story.northFit.cashSd)}, while the hedge barely moves, to {fmt(story.northFit.strips)} strips; in a mild city at 30° the spread is{' '}
        {millions(story.southFit.cashSd)} and the hedge is still {fmt(story.southFit.strips)}. The climate decides how much is at stake; the gas sent out per degree
        day decides how many contracts cover it.
      </P>
      <P>
        Switch to the other businesses and the same arithmetic gives a different verdict. The wind farm’s revenue has an R² of {pct(story.windFit.r2, 1)} against
        the winter’s degree days, the corn farm’s {pct(story.farmFit.r2, 1)}: selling strips adds risk to them rather than removing it, and the curve climbs from
        zero. Their weather lives in other indices — the wind at the farm, Marlow’s summer heat and rain — the kind of contracts written over the counter in{' '}
        <a href={lessonHref('weather/5.1')}>Lesson 5.1</a>.
      </P>

      <Challenge
        id="b"
        question="For Calder Gas & Light, at the size you’ve chosen and in your region, how many seasonal strips — to the nearest hundred — leave its winters varying the least?"
        solved={solved2}
        status={
          kind !== 'utility'
            ? 'Choose Calder Gas & Light: the other businesses barely follow this index.'
            : `With ${fmt(strips)} strips the utility’s winters vary by ${money(spreadNow)}, against ${money(fit.cashSd)} unhedged.`
        }
        success={`Solved: ${fmt(strips)} strips leave ${money(spreadNow)}, ${pct(1 - (spreadNow * spreadNow) / (fit.cashSd * fit.cashSd))} of the variance removed. That is ${money(fit.slope)} per degree day divided by the strip’s $${CME_TICK}, and it scales with the size of the business. The next lesson’s desk starts from this number.`}
      />

      <P>
        An exposure and a hedge ratio are not yet a trade. The strips have a price, set by a market that may see the winter differently from the forecast of{' '}
        <FigRef to="Weather Exposure Engine">the outlook</FigRef>, and the desk has more than one contract to choose from — the season, single months, options
        with a strike. <a href={lessonHref('weather/6.4')}>The next lesson</a> opens the trading desk: it prices the contracts on offer against your region’s
        forecast distribution, and chooses which to sell to cover the business and which, if any, to trade.
      </P>
    </LessonPage>
  );
}
