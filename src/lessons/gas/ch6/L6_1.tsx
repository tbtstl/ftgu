import { useMemo, useState } from 'react';
import {
  Caption,
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
  TEXT,
  fmt,
  lessonHref,
  signed,
  tint,
  useScenario,
} from '../../../framework';
import { forecastFundamentals, forecastSkill, forecastTemps, remainingHddError, type FundamentalsForecast } from '../../../engines/gas/forecast';
import { demandBlocks } from '../../../model/gas/demand';
import { conditionsOf, END_OF_WINTER, EXPRESS_EXPANSION, gasHistory, HISTORY_YEARS } from '../../../model/gas/history';
import { GAS_MONTHS, GAS_MONTH_START, GAS_YEAR_DAYS, WINTER_START, gasDayLabel, hdd, normalTemp, weatherYear } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { bcf, bcfd, gp } from '../shared/format';

// ---------------------------------------------------------------------------
// Forecasts from a day in the history, remembered.

/** Imagined winters in each forecast, and the days the weather forecast covers. */
export const FORECAST_MEMBERS = 16;
export const FORECAST_HORIZON = 14;
/** Slider step for forecast skill. */
export const SKILL_STEP = 0.05;
/** The last day a forecast can be made (March 24), and the first day the charts show (October 1). */
const DAY_MAX = GAS_YEAR_DAYS - 8;
const CHART_FROM = GAS_MONTH_START[6];
/** The first demonstration opens on November 1 of Year 6 with a good forecast. */
export const FORECASTER_DEFAULTS = { year: 5, day: WINTER_START, skill: 0.8 };
export type ForecasterState = typeof FORECASTER_DEFAULTS;

const round2 = (x: number) => Math.round(x * 100) / 100;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const totalStorage = (s: { saltflat: number; hollowcreek: number }) => s.saltflat + s.hollowcreek;

const runCache = new Map<string, FundamentalsForecast>();
/** The forecast made on `day` of history year `year` (0-based) with a weather forecast of `skill`. */
export function forecasterRun(year: number, day: number, skill: number): FundamentalsForecast {
  const s = round2(skill);
  const key = `${year}|${day}|${s}`;
  let f = runCache.get(key);
  if (!f) {
    f = forecastFundamentals(year, day, { skill: s, members: FORECAST_MEMBERS, horizon: FORECAST_HORIZON });
    if (runCache.size > 400) runCache.clear();
    runCache.set(key, f);
  }
  return f;
}

export interface TwoWeeks {
  /** Days covered (fewer at the very end of March). */
  days: number;
  /** Average temperature over the forecast days: forecast, actual and normal, °F. */
  fcTemp: number;
  actTemp: number;
  normalTemp: number;
  /** Average price at Calder over those days: the forecast's (mean of its members) and what happened. */
  fcPrice: number;
  actPrice: number;
}

/** The forecast's next two weeks against what happened. */
export function forecasterTwoWeeks(f: FundamentalsForecast): TwoWeeks {
  const n = Math.min(FORECAST_HORIZON, f.actual.temp.length);
  return {
    days: n,
    fcTemp: avg(f.members[0].temp.slice(0, n)),
    actTemp: avg(f.actual.temp.slice(0, n)),
    normalTemp: avg(Array.from({ length: n }, (_, i) => normalTemp(f.fromDay + i))),
    fcPrice: avg(f.meanCalder.slice(0, n)),
    actPrice: avg(f.actual.calder.slice(0, n)),
  };
}

/** Bcf less in storage at the end of March for each extra heating degree day among the imagined winters of a forecast (least squares). */
export function forecasterStoragePerHdd(f: FundamentalsForecast): number {
  const xs = f.members.map((m) => m.temp.reduce((s, t) => s + hdd(t), 0));
  const ys = f.members.map((m) => m.storage[m.storage.length - 1]);
  const mx = avg(xs);
  const my = avg(ys);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return -xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
}

/** The same for the members' average winter price at Calder: dollars per MMBtu per extra degree day. */
export function forecasterPricePerHdd(f: FundamentalsForecast): number {
  const xs = f.members.map((m) => m.temp.reduce((s, t) => s + hdd(t), 0));
  const ys = f.members.map((m) => avg(m.calder));
  const mx = avg(xs);
  const my = avg(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
}

// ---------------------------------------------------------------------------
// The challenge: the cold spell that began on January 1 of Year 3.

export const COLD_SPELL = { year: 2, day: GAS_MONTH_START[9] };
/** How close the two-week price forecast must come, $/MMBtu. */
export const PRICE_TOLERANCE = 0.5;

/** How far the forecast of the cold spell's two-week average price at Calder misses, $/MMBtu. */
export function coldSpellMiss(skill: number): number {
  const t = forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, skill));
  return Math.abs(t.actPrice - t.fcPrice);
}

/** The least skill on the slider's steps whose forecast comes within the tolerance. */
export function coldSpellAnswer(): number {
  const n = Math.round(1 / SKILL_STEP);
  for (let i = 0; i <= n; i++) if (coldSpellMiss(round2(i * SKILL_STEP)) <= PRICE_TOLERANCE) return round2(i * SKILL_STEP);
  return NaN;
}

/** Solved: on January 1 of Year 3, the least skill whose two-week price forecast comes within 50 cents. */
export function forecasterSolved(st: ForecasterState): boolean {
  if (st.year !== COLD_SPELL.year || st.day !== COLD_SPELL.day) return false;
  if (coldSpellMiss(st.skill) > PRICE_TOLERANCE) return false;
  const k = Math.round(st.skill / SKILL_STEP);
  for (let i = 0; i < k; i++) if (coldSpellMiss(round2(i * SKILL_STEP)) <= PRICE_TOLERANCE) return false;
  return true;
}

// ---------------------------------------------------------------------------
// How far ahead: the heating degree days still to come, and a forecast's typical miss.

/** Forecast days on the second demonstration's grid: every week from November 1, and the first of each month. */
export const WEEKS = [...new Set([...Array.from({ length: Math.floor((DAY_MAX - WINTER_START) / 7) + 1 }, (_, i) => WINTER_START + 7 * i), ...GAS_MONTH_START.slice(8)])].sort((a, b) => a - b);
/** Simulated winters behind each typical miss. */
export const ERROR_YEARS = 120;

let surpriseMemo: number[][] | null = null;
/** For each history year and each day from November 1 to March 31, heating degree days still to come above (+) or below (−) normal. */
export function forecasterSurprises(): number[][] {
  if (surpriseMemo) return surpriseMemo;
  surpriseMemo = gasHistory().map((y) => {
    const out = Array<number>(GAS_YEAR_DAYS + 1 - WINTER_START).fill(0);
    for (let d = GAS_YEAR_DAYS - 1; d >= WINTER_START; d--) out[d - WINTER_START] = out[d + 1 - WINTER_START] + hdd(y.weather.temp[d]) - hdd(y.weather.normal[d]);
    return out;
  });
  return surpriseMemo;
}

const restCache = new Map<number, number[]>();
/** A forecast's typical miss (root mean square, degree days) of the heating degree days left in the winter, on each day of `WEEKS`. */
export function forecasterRestError(skill: number): number[] {
  const s = round2(skill);
  let e = restCache.get(s);
  if (!e) {
    e = WEEKS.map((d) => remainingHddError(d, s, FORECAST_HORIZON, ERROR_YEARS));
    restCache.set(s, e);
  }
  return e;
}

const twoCache = new Map<string, number>();
/**
 * A forecast's typical miss (root mean square, degree days) of the heating degree days in its own
 * two weeks, made on `fromDay`, over `years` simulated years (the same years `remainingHddError` uses).
 */
export function forecasterTwoWeekError(fromDay: number, skill: number, years = ERROR_YEARS): number {
  const key = `${fromDay}|${round2(skill)}|${years}`;
  const hit = twoCache.get(key);
  if (hit !== undefined) return hit;
  let s = 0;
  for (let k = 0; k < years; k++) {
    const w = weatherYear(7000 + k);
    const fc = forecastTemps(w, fromDay, FORECAST_HORIZON, round2(skill), 7000 + k);
    let e = 0;
    fc.forEach((t, i) => (e += hdd(w.temp[fromDay + i]) - hdd(t)));
    s += e * e;
  }
  const v = Math.sqrt(s / years);
  twoCache.set(key, v);
  return v;
}

/** The second demonstration opens with the same skill, picking out Year 3. */
export const HORIZON_DEFAULTS = { skill: 0.8, year: 2 };

// ---------------------------------------------------------------------------
// Numbers the prose quotes (computed once, on first render).

interface Facts {
  first: ReturnType<typeof conditionsOf>;
  last: ReturnType<typeof conditionsOf>;
  growth: number;
  restFeb: number;
  restMar: number;
  lngYear15: number;
  lngYear18: number;
  demandPerHdd: number;
  homesPerHdd: number;
  powerPerHdd: number;
  winterSurprise: number[];
  normalWinterHdd: number;
  base: FundamentalsForecast;
  baseSkill0: FundamentalsForecast;
  baseSkill1: FundamentalsForecast;
  cold: FundamentalsForecast;
  coldMar: FundamentalsForecast;
  slopeRun: FundamentalsForecast;
  storagePerHdd: number;
  pricePerHdd: number;
  spell: TwoWeeks;
  rest0: number[];
  outsideNov1: number;
  two0Jan: number;
  two8Jan: number;
}

let factsMemo: Facts | null = null;
function facts(): Facts {
  if (factsMemo) return factsMemo;
  const h = gasHistory();
  const total = (t: number) => demandBlocks(t).reduce((s, b) => s + b.cap, 0);
  const block = (t: number, id: string) => demandBlocks(t).find((b) => b.id === id)!.cap;
  let normalWinterHdd = 0;
  for (let d = WINTER_START; d < GAS_YEAR_DAYS; d++) normalWinterHdd += hdd(normalTemp(d));
  const sur = forecasterSurprises();
  const rest0 = forecasterRestError(0);
  const slopeRun = forecasterRun(0, WINTER_START, 0);
  factsMemo = {
    first: conditionsOf(0),
    last: conditionsOf(HISTORY_YEARS - 1),
    growth: (conditionsOf(HISTORY_YEARS - 1).ridgeback - conditionsOf(0).ridgeback) / (HISTORY_YEARS - 1),
    restFeb: rest0[WEEKS.indexOf(GAS_MONTH_START[10])],
    restMar: rest0[WEEKS.indexOf(GAS_MONTH_START[11])],
    lngYear15: h.findIndex((y) => y.conditions.lngBcfd > 1.2 + 1e-9) + 1,
    lngYear18: h.findIndex((y) => y.conditions.lngBcfd > 1.5 + 1e-9) + 1,
    demandPerHdd: (total(30) - total(40)) / 10,
    homesPerHdd: (block(30, 'metro-homes') - block(40, 'metro-homes')) / 10,
    powerPerHdd: (block(30, 'metro-power') - block(40, 'metro-power')) / 10,
    winterSurprise: sur.map((s) => s[0]),
    normalWinterHdd,
    base: forecasterRun(FORECASTER_DEFAULTS.year, FORECASTER_DEFAULTS.day, FORECASTER_DEFAULTS.skill),
    baseSkill0: forecasterRun(FORECASTER_DEFAULTS.year, FORECASTER_DEFAULTS.day, 0),
    baseSkill1: forecasterRun(FORECASTER_DEFAULTS.year, FORECASTER_DEFAULTS.day, 1),
    cold: forecasterRun(2, WINTER_START, FORECASTER_DEFAULTS.skill),
    coldMar: forecasterRun(2, GAS_MONTH_START[11], FORECASTER_DEFAULTS.skill),
    slopeRun,
    storagePerHdd: forecasterStoragePerHdd(slopeRun),
    pricePerHdd: forecasterPricePerHdd(slopeRun),
    spell: forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, 0)),
    rest0,
    outsideNov1: sur.filter((s) => Math.abs(s[0]) > rest0[0]).length,
    two0Jan: forecasterTwoWeekError(GAS_MONTH_START[9], 0),
    two8Jan: forecasterTwoWeekError(GAS_MONTH_START[9], 0.8),
  };
  return factsMemo;
}

// ---------------------------------------------------------------------------
// Charts.

const STORED = GRAPHIC.gold;
const MEMBER = tint(GRAPHIC.gold, 0.45);
const ACTUAL = '#333333';
const NORMAL = '#8a8a8a';
const WEATHER = GRAPHIC.teal;
const DAY_TICKS = GAS_MONTH_START.slice(6);
const dayTick = (v: number) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? '';
const WINTER_TICKS = GAS_MONTH_START.slice(7);
const RESERVE = totalStorage(END_OF_WINTER);
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const YEAR_OPTIONS = Array.from({ length: HISTORY_YEARS }, (_, i) => ({ value: String(i), label: `Year ${i + 1}` }));
const weekOf = (x: number) => {
  let best = WEEKS[0];
  for (const w of WEEKS) if (Math.abs(w - x) < Math.abs(best - x)) best = w;
  return best;
};

export default function Lesson() {
  const F = useMemo(() => facts(), []);
  const s = useScenario('forecaster', FORECASTER_DEFAULTS);
  const st = s.state;
  const f = useMemo(() => forecasterRun(st.year, st.day, st.skill), [st.year, st.day, st.skill]);
  const two = forecasterTwoWeeks(f);
  const hist = gasHistory()[st.year];
  const solved = forecasterSolved(st);

  // Upper chart: temperature from October 1.
  const tXs = Array.from({ length: GAS_YEAR_DAYS - CHART_FROM }, (_, i) => CHART_FROM + i + 0.5);
  const tNormal = tXs.map((x) => hist.weather.normal[Math.floor(x)]);
  const before = st.day - CHART_FROM;
  const tActual = hist.weather.temp.slice(CHART_FROM);
  const fcXs = f.members[0].temp.slice(0, two.days).map((_, i) => st.day + i + 0.5);
  const fcYs = f.members[0].temp.slice(0, two.days);

  // Lower chart: storage, ending each day.
  const sPastXs = Array.from({ length: st.day - CHART_FROM + 1 }, (_, i) => CHART_FROM + i);
  const sPast = sPastXs.map((x) => totalStorage(x === 0 ? hist.start : hist.days[x - 1].storage));
  const sFutXs = [st.day, ...f.actual.storage.map((_, i) => st.day + i + 1)];
  const start = sPast[sPast.length - 1];
  const inside = f.endActual >= f.endLow && f.endActual <= f.endHigh;

  const status =
    st.year !== COLD_SPELL.year || st.day !== COLD_SPELL.day
      ? 'Choose Year 3 and move the forecast day to Jan 1.'
      : coldSpellMiss(st.skill) > PRICE_TOLERANCE
        ? `The forecast expects ${gp(two.fcPrice)} over the two weeks; ${gp(two.actPrice)} came. It misses by ${gp(Math.abs(two.actPrice - two.fcPrice))}.`
        : `Within ${gp(PRICE_TOLERANCE)}: it expects ${gp(two.fcPrice)} against ${gp(two.actPrice)}. Would a less skilled forecast do?`;

  // Second demonstration.
  const hz = useScenario('forecaster-horizon', HORIZON_DEFAULTS);
  const hs = hz.state;
  const [cursor, setCursor] = useState(GAS_MONTH_START[9]);
  const at = weekOf(cursor);
  const wi = WEEKS.indexOf(at);
  const sur = forecasterSurprises();
  const rest = useMemo(() => forecasterRestError(hs.skill), [hs.skill]);
  const rest0 = F.rest0;
  const twoSkill = forecasterTwoWeekError(at, hs.skill);
  const twoNone = forecasterTwoWeekError(at, 0);
  const surXs = Array.from({ length: GAS_YEAR_DAYS + 1 - WINTER_START }, (_, i) => WINTER_START + i);
  const picked = sur[hs.year][at - WINTER_START];

  const year = (i: number) => `Year ${i + 1}`;

  return (
    <LessonPage id="gas/6.1">
      <P>
        <a href={lessonHref('gas/5.5')}>Chapter 5</a> ended with a claim worth testing. Every price difference in our region traces back to a physical limit — a full
        pipeline, a full storage field, a field that can’t deliver fast enough — and a trader who sees one coming before the market prices it might profit from it.
        This chapter asks whether that’s really so: whether understanding the system well enough to explain its prices is enough to trade them. Two things come before
        any trade. One is a forecast. The other is a history to test it on, so that an idea that works can be told apart from one that only sounds right.
      </P>
      <P>
        Our history is eight simulated gas years, April to March, run day by day on the market model of Chapter 4. Each year has its own weather, and the region
        changes underneath the market from one year to the next, as real ones do. Ridgeback’s producers keep drilling, so the basin’s{' '}
        <K tone="orange">production</K> grows by {bcfd(F.growth, 2)} a year, from{' '}
        {bcfd(F.first.ridgeback, 2)} in Year 1 to {bcfd(F.last.ridgeback, 2)} in Year {HISTORY_YEARS}, while old Sandhill declines from {fmt(F.first.sandhill, 2)} to{' '}
        {fmt(F.last.sandhill, 2)}. Bayport’s LNG terminal takes {bcfd(conditionsOf(F.lngYear15 - 1).lngBcfd, 1)} of feed gas from Year {F.lngYear15} and{' '}
        {fmt(conditionsOf(F.lngYear18 - 1).lngBcfd, 1)} from Year {F.lngYear18}, the region’s own demand grows by{' '}
        {fmt((conditionsOf(1).demandScale - 1) * 100)}% a year, and in Year {EXPRESS_EXPANSION.year + 1} Ridgeback Express is expanded by{' '}
        {bcfd(EXPRESS_EXPANSION.addBcfd, 1)}. The storage operators draw up their seasonal plan on April 1 and redraw it on the first of every month from the gas they
        actually hold, assuming normal weather from then on — the plan and water values of <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>. As everywhere in this
        course, the prices are simulated.
      </P>
      <P>
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> gave the rule every forecast starts from: gas can’t pile up or vanish, so whatever the fields produce and the
        region doesn’t burn or export goes into <K c="energy">storage</K>. Within a year, two of those terms hardly move. Production in our history is steady through
        each year, and the LNG terminal takes its feed gas whenever cargoes pay. Consumption is the term that moves, and it moves with the{' '}
        <K tone="teal">weather</K>. Each heating degree day — each degree by which a day’s mean temperature falls below 65 °F — adds{' '}
        {bcfd(F.demandPerHdd, 3)} to what the region would burn: {fmt(F.homesPerHdd, 3)} in Metro’s homes, {fmt(F.powerPerHdd, 3)} in its power plants, the rest in
        Calder and Bayport. A forecast of storage is, above all, a forecast of the weather.
      </P>
      <P>
        Weather forecasts are good for a few days and fade after that, and ours fade the same way. A forecast’s <b>skill</b> measures how closely its predicted
        departures from normal follow what happens. At full skill the correlation is {fmt(forecastSkill(1, 1), 2)} a day ahead, {fmt(forecastSkill(1, 7), 2)} a week
        ahead and only {fmt(forecastSkill(1, FORECAST_HORIZON), 2)} two weeks ahead; a forecast with no skill simply predicts the normal temperature. Past the
        forecast’s two weeks nobody knows, so we imagine {FORECAST_MEMBERS} possible winters, each borrowing the departures from normal of a different simulated year,
        and run the market through every one from the gas actually in storage that morning. Weather services handle their own uncertainty in a similar spirit, running
        their models many times over to get an ensemble of possible outcomes.
      </P>
      <P>
        In the next demonstration, choose a year, the day the forecast is made and how skilled its weather forecast is. The upper chart is Metro’s temperature, with
        the next two weeks’ forecast in teal; the lower one is the gas in storage, with the imagined winters fanning out from the forecast day and a dashed line for
        what actually happened:
      </P>

      <Figure name="Gas Fundamentals Forecaster" scenario={s}>
        <Segmented label="Year" value={String(st.year)} onChange={(v) => s.set({ year: Number(v) })} options={YEAR_OPTIONS} />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[0, 80]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 20, 40, 60, 80]}
          yFormat={(v) => `${v}°`}
          yLabel="Metro’s daily mean temperature, °F"
          height={170}
          bands={[{ from: st.day, to: st.day + two.days, color: 'rgba(42, 157, 144, 0.10)', label: 'forecast' }]}
          series={[
            { xs: tXs, ys: tNormal, color: NORMAL, width: 1.5, dash: '5 4' },
            { xs: tXs.slice(0, before), ys: tActual.slice(0, before), color: ACTUAL, width: 1.5 },
            { xs: tXs.slice(before), ys: tActual.slice(before), color: ACTUAL, width: 1, dash: '3 3', opacity: 0.7 },
            { xs: fcXs, ys: fcYs, color: WEATHER, width: 3 },
          ]}
          vLines={[{ at: st.day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          ariaLabel={`Metro’s temperature in ${year(st.year)} from October to March. Forecast made on ${gasDayLabel(st.day)}: the next ${two.days} days average ${fmt(two.fcTemp, 1)} °F in the forecast, ${fmt(two.actTemp, 1)} °F in fact, against a normal ${fmt(two.normalTemp, 1)} °F.`}
        />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[0, 160]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 40, 80, 120, 160]}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in storage, Bcf"
          height={230}
          series={[
            ...f.members.map((m) => ({ xs: sFutXs, ys: [start, ...m.storage], color: MEMBER, width: 1 })),
            { xs: sPastXs, ys: sPast, color: STORED, width: 2.5 },
            { xs: sFutXs, ys: [start, ...f.meanStorage], color: STORED, width: 2.5 },
            { xs: sFutXs, ys: [start, ...f.actual.storage], color: ACTUAL, width: 1.5, dash: '5 3' },
          ]}
          hLines={[{ at: RESERVE, color: '#8a8a8a', dash: '2 4', width: 1, label: `spring reserve ${fmt(RESERVE, 1)} Bcf`, labelAt: 'start' }]}
          vLines={[{ at: st.day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          markers={[
            { x: GAS_YEAR_DAYS, y: f.endMean, color: TEXT.gold, r: 4 },
            { x: GAS_YEAR_DAYS, y: f.endActual, color: ACTUAL, r: 4, ring: true },
          ]}
          ariaLabel={`Working gas in ${year(st.year)}. Forecast made on ${gasDayLabel(st.day)} with ${fmt(start, 1)} Bcf in storage: the imagined winters end March with ${fmt(f.endLow, 1)} to ${fmt(f.endHigh, 1)} Bcf, ${fmt(f.endMean, 1)} on average; ${fmt(f.endActual, 1)} Bcf actually remained.`}
        >
          {(x, y) => (
            <g>
              <line x1={x(GAS_YEAR_DAYS) - 3} x2={x(GAS_YEAR_DAYS) - 3} y1={y(f.endLow)} y2={y(f.endHigh)} stroke={TEXT.gold} strokeWidth={3} opacity={0.6} />
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'forecast', color: WEATHER, kind: 'line' },
            { label: 'normal', color: NORMAL, kind: 'line', dashed: true },
            { label: 'imagined winters', color: MEMBER, kind: 'line' },
            { label: 'their average', color: STORED, kind: 'line' },
            { label: 'what happened', color: ACTUAL, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `Mar 31 forecast (${fmt(f.endLow, 1)}–${fmt(f.endHigh, 1)})`, value: bcf(f.endMean), tone: 'gold' },
            { label: 'Mar 31, what remained', value: bcf(f.endActual), tone: 'ink' },
            { label: `Calder, ${two.days} days: forecast`, value: gp(two.fcPrice), tone: 'green' },
            { label: `Calder, ${two.days} days: actual`, value: gp(two.actPrice), tone: 'green' },
          ]}
        />
        <Slider
          label="Forecast made on"
          tone="teal"
          value={st.day}
          min={WINTER_START}
          max={DAY_MAX}
          step={1}
          onChange={(v) => s.set({ day: Math.round(v) })}
          display={`${gasDayLabel(st.day)}, Year ${st.year + 1}`}
        />
        <Slider
          label="Forecast skill"
          tone="teal"
          value={st.skill}
          min={0}
          max={1}
          step={SKILL_STEP}
          onChange={(v) => s.set({ skill: round2(v) })}
          display={st.skill === 0 ? 'none: normal weather' : `${fmt(st.skill, 2)} · ${fmt(forecastSkill(st.skill, 7), 2)} a week out`}
        />
        <Caption>
          On {gasDayLabel(st.day)} of {year(st.year)}, with {fmt(start, 1)} Bcf in storage, the next {two.days} days are forecast at {fmt(two.fcTemp, 1)} °F against a
          normal {fmt(two.normalTemp, 1)} °F; they came in at {fmt(two.actTemp, 1)} °F. The imagined winters end March with {fmt(f.endLow, 1)}–{fmt(f.endHigh, 1)} Bcf;{' '}
          {fmt(f.endActual, 1)} Bcf actually remained, {inside ? 'inside that range' : f.endActual < f.endLow ? 'less than in any of them' : 'more than in any of them'}.
        </Caption>
      </Figure>

      <P>
        The demonstration opens on November 1 of Year 6, whose winter turned out {fmt(Math.abs(F.winterSurprise[5]))} heating degree days{' '}
        {F.winterSurprise[5] >= 0 ? 'colder' : 'warmer'} than normal, out of a normal {fmt(F.normalWinterHdd)} — about as ordinary as winters come. The{' '}
        {FORECAST_MEMBERS} imagined winters end March with between {fmt(F.base.endLow, 1)} and {fmt(F.base.endHigh, 1)} Bcf in storage, {fmt(F.base.endMean, 1)} on
        average, and storage actually ended with {fmt(F.base.endActual, 1)}. Now choose Year 3, the coldest winter in the history, {fmt(F.winterSurprise[2])} degree
        days colder than normal. On November 1 the forecast looks much the same — {fmt(F.cold.endMean, 1)} Bcf on average, no imagined winter lower than{' '}
        {fmt(F.cold.endLow, 1)} — but storage ended March with {fmt(F.cold.endActual, 1)}. Move the forecast day forward. The range narrows as the winter passes, and
        by March 1 it runs from {fmt(F.coldMar.endLow, 1)} to {fmt(F.coldMar.endHigh, 1)} Bcf and{' '}
        {F.coldMar.endActual >= F.coldMar.endLow && F.coldMar.endActual <= F.coldMar.endHigh ? 'at last contains' : 'still misses'} what happened.
      </P>
      <P>
        The forecast got better without the forecaster learning anything: there was simply less winter left to be wrong about. Nor does the weather forecast’s skill
        do much for the end of March. On November 1 of Year 6, turning the skill from none to full moves the forecast by only{' '}
        {fmt(Math.abs(F.baseSkill0.endMean - F.baseSkill1.endMean), 1)} Bcf, because two weeks of better information are a small part of five months of winter. Skill
        matters for the next two weeks, which is why the readouts follow the price at Calder over the forecast’s own days as well.
      </P>

      <H2>Half the weather</H2>
      <P>
        Set the year to 1, the forecast day to November 1 and the skill to none, and look at how the imagined winters spread. A colder one draws storage down further, but not by as much as
        its extra demand. Across the {FORECAST_MEMBERS} winters imagined on November 1 of Year 1, each extra heating degree day leaves about{' '}
        {bcf(F.storagePerHdd, 3)} less in storage at the end of March — about {fmt((F.storagePerHdd / F.demandPerHdd) * 100)}% of the {bcf(F.demandPerHdd, 3)} it adds
        to demand. The rest never comes out of storage. A cold spell draws the fields down faster than planned, the operators raise their water values, the{' '}
        <K c="price">price</K> rises — by about {gp(F.pricePerHdd * 100)} on the winter’s average for every hundred extra degree days — and the users with somewhere
        else to go give way, as in Lesson 4.1: power plants switch back to coal and Bayport’s flexible industry cuts back. So the weather a forecast misses lands partly in storage and
        partly in the price, and a trader who forecasts storage is really forecasting the price.
      </P>
      <P>
        A forecast of the next two weeks is where skill pays, and a cold spell is where it pays most. Try it:
      </P>

      <Challenge
        id="a"
        figure="Gas Fundamentals Forecaster"
        question={`On January 1 of Year 3 a cold spell begins: the next two weeks average ${fmt(F.spell.actTemp, 1)} °F, against a normal ${fmt(F.spell.normalTemp, 1)} °F. Set the forecast to that day. What’s the least forecast skill, on the slider’s steps, at which the forecast of those two weeks’ average price at Calder comes within 50 cents of what happened?`}
        solved={solved}
        status={status}
        success={`Solved: a skill of ${fmt(st.skill, 2)}. The forecast now expects ${fmt(two.fcTemp, 1)} °F over the two weeks and ${gp(two.fcPrice)} at Calder, against the ${fmt(two.actTemp, 1)} °F and ${gp(two.actPrice)} that came; with no skill it expected ${gp(F.spell.fcPrice)}. Even a very good forecast sees only part of a cold spell this deep, because its best guess pulls every departure toward normal, more so the further ahead it looks. A forecaster who could see these two weeks more clearly than everyone else would have something worth trading — for two weeks.`}
      />

      <H2>How far ahead</H2>
      <P>
        How far ahead, then, can the balance be forecast? In the next demonstration each thin line is one year of the history. On each day of the winter it shows how
        many more heating degree days than normal (or fewer) were still to come before the end of March, which is exactly what a forecast with no skill, made that
        day, would miss. The teal band is the typical miss — the root-mean-square error over {ERROR_YEARS} simulated winters — of a forecast with the skill you set; the
        dashed lines are the same for a forecast with no skill. Choose a year to pick out, set the skill, and drag across the chart:
      </P>

      <Figure name="Gas Fundamentals Forecaster · how far ahead" scenario={hz}>
        <Segmented label="Year" value={String(hs.year)} onChange={(v) => hz.set({ year: Number(v) })} options={YEAR_OPTIONS} />
        <XYChart
          xDomain={[WINTER_START, GAS_YEAR_DAYS]}
          yDomain={[-800, 800]}
          xTicks={WINTER_TICKS}
          xFormat={dayTick}
          yTicks={[-800, -400, 0, 400, 800]}
          yFormat={(v) => signed(v)}
          yLabel="Heating degree days still to come, above or below normal"
          height={280}
          series={[
            { xs: WEEKS, ys: rest, lows: rest.map((v) => -v), color: WEATHER, kind: 'band', opacity: 0.18 },
            { xs: WEEKS, ys: rest0, color: NORMAL, width: 1.25, dash: '5 4' },
            { xs: WEEKS, ys: rest0.map((v) => -v), color: NORMAL, width: 1.25, dash: '5 4' },
            ...sur.map((ys, i) => (i === hs.year ? null : { xs: surXs, ys, color: '#b5b5b5', width: 1 })).filter((x): x is NonNullable<typeof x> => x !== null),
            { xs: surXs, ys: sur[hs.year], color: ACTUAL, width: 2.25 },
          ]}
          markers={[{ x: at, y: picked, color: ACTUAL, r: 4.5, label: `${year(hs.year)}: ${signed(picked)}`, labelPos: picked >= 0 ? 'above' : 'below' }]}
          cursor={at}
          onScrub={setCursor}
          scrubLabel="Day the forecast is made"
          scrubStep={7}
          ariaLabel={`Heating degree days still to come above or below normal, by day of the winter, for the eight years of the history. On ${gasDayLabel(at)}, ${year(hs.year)} had ${signed(picked)} still to come; a forecast with skill ${fmt(hs.skill, 2)} typically misses by ${fmt(rest[wi])}, one with no skill by ${fmt(rest0[wi])}.`}
        />
        <Legend
          items={[
            { label: `typical miss, skill ${fmt(hs.skill, 2)}`, color: tint(WEATHER, 0.6) },
            { label: 'typical miss, no skill', color: NORMAL, kind: 'line', dashed: true },
            { label: year(hs.year), color: ACTUAL, kind: 'line' },
            { label: 'other years', color: '#b5b5b5', kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: `rest of winter: typical miss (no skill ${fmt(rest0[wi])})`, value: `${fmt(rest[wi])} HDD`, tone: 'teal' },
            { label: 'as storage on March 31', value: `≈ ${bcf(rest[wi] * F.storagePerHdd)}`, tone: 'gold' },
            { label: `next two weeks: typical miss (no skill ${fmt(twoNone)})`, value: `${fmt(twoSkill)} HDD`, tone: 'teal' },
          ]}
        />
        <Slider
          label="Forecast skill"
          tone="teal"
          value={hs.skill}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => hz.set({ skill: round2(v) })}
          display={hs.skill === 0 ? 'none: normal weather' : `${fmt(hs.skill, 1)} · ${fmt(forecastSkill(hs.skill, 7), 2)} a week out`}
        />
        <Caption>
          On {gasDayLabel(at)}, {year(hs.year)} still had {fmt(Math.abs(picked))} heating degree days {picked >= 0 ? 'more' : 'fewer'} than normal to come. A forecast
          made that day with skill {fmt(hs.skill, 1)} typically misses the rest of the winter by {fmt(rest[wi])} and its own next two weeks by {fmt(twoSkill)}.
        </Caption>
      </Figure>

      <P>
        On November 1 a forecast of the rest of the winter typically misses by {fmt(rest0[0])} heating degree days, about {bcf(rest0[0] * F.storagePerHdd)} of
        storage at the end of March, and {WORDS[F.outsideNov1]} of our eight years began their winter further from normal than that; Year 3 began it{' '}
        {fmt(F.winterSurprise[2] / rest0[0], 1)} typical misses colder. The typical miss falls to {fmt(F.restFeb)} on February 1
        and {fmt(F.restMar)} on March 1, and skill hardly narrows it until the last weeks, when the forecast’s two weeks
        are most of what’s left. Over its own two weeks, skill does count: a two-week forecast made on January 1 with no skill typically misses by{' '}
        {fmt(F.two0Jan)} degree days, and one with skill {fmt(0.8, 1)} by {fmt(F.two8Jan)} — {fmt((1 - F.two8Jan / F.two0Jan) * 100)}% less, most of it from the
        first few days, where the forecast is sharpest.
      </P>
      <P>
        So gas fundamentals can be forecast in two very different senses. Over the next few days a skilled weather forecast narrows the miss, and the edge fades
        within a couple of weeks. Over the rest of the winter nobody can do much better than the climate, and a forecast’s honest answer is a range that narrows only as the winter is used up — as{' '}
        <FigRef to="Gas Fundamentals Forecaster">the first demonstration</FigRef> showed, the history held winters well outside it. The other side of the balance is
        easier. Production in our history is steady within each year, and from one year to the next Ridgeback adds{' '}
        {bcfd(F.growth, 2)}, a trend anyone reading the history could extrapolate. The
        market’s prices in our history, as <a href={lessonHref('gas/6.3')}>Lesson 6.3</a> will show, are drawn as if the region stayed as it stands.
      </P>
      <P>
        A forecast of storage is, at bottom, a forecast of what gas will be worth in one month compared with another: how much is left at the end of March decides how
        dear March gas is against April’s, and how full storage is in the fall decides how dear the winter is against the summer before it. That difference between
        months trades on its own, as a calendar spread, and whether a storage forecast is enough to trade it is the question of{' '}
        <a href={lessonHref('gas/6.2')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
