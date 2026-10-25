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
import { HEATING_MONTHS, runBook, weatherSignals, weatherTrades, type BookResult, type WeatherSignal } from '../../../engines/gas/strategies';
import { demandBlocks } from '../../../model/gas/demand';
import { conditionsOf, END_OF_WINTER, EXPRESS_EXPANSION, gasHistory, HISTORY_YEARS } from '../../../model/gas/history';
import { GAS_MONTHS, GAS_MONTH_NAMES, GAS_MONTH_START, GAS_YEAR_DAYS, WINTER_START, gasDayLabel, hdd, normalTemp, weatherYear } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { bcf, bcfd, gp, money } from '../shared/format';

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

export interface HalfWeather {
  /** Each imagined winter's heating degree days (November to March), gas left on March 31 (Bcf) and average price at Calder ($/MMBtu). */
  hdd: number[];
  storage: number[];
  price: number[];
  /** The same for the winter that happened. */
  actual: { hdd: number; storage: number; price: number };
  /** The least-squares rates: Bcf less on March 31, and $/MMBtu more on the winter's price, per extra heating degree day. */
  storagePerHdd: number;
  pricePerHdd: number;
  /** The members' averages, through which both fitted lines pass. */
  mean: { hdd: number; storage: number; price: number };
}

/** The third demonstration: the winters imagined on November 1 of history year `year` (0-based), with no skill. */
export function halfWeather(year: number): HalfWeather {
  const f = forecasterRun(year, WINTER_START, 0);
  const winterHdd = (temp: number[]) => temp.reduce((s, t) => s + hdd(t), 0);
  const xs = f.members.map((m) => winterHdd(m.temp));
  const ys = f.members.map((m) => m.storage[m.storage.length - 1]);
  const ps = f.members.map((m) => avg(m.calder));
  return {
    hdd: xs,
    storage: ys,
    price: ps,
    actual: { hdd: winterHdd(f.actual.temp), storage: f.endActual, price: avg(f.actual.calder) },
    storagePerHdd: forecasterStoragePerHdd(f),
    pricePerHdd: forecasterPricePerHdd(f),
    mean: { hdd: avg(xs), storage: avg(ys), price: avg(ps) },
  };
}

export const HALF_DEFAULTS = { year: 0 };

// ---------------------------------------------------------------------------
// The first challenge: the cold spell that began on January 1 of Year 3.

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

/** The share of the cold spell's departure from normal that a forecast of `skill` saw, over its two weeks. */
export function coldSpellSeen(skill: number): number {
  const t = forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, skill));
  return (t.normalTemp - t.fcTemp) / (t.normalTemp - t.actTemp);
}

/**
 * Solved: the reader has predicted whether even a full-skill forecast gets within 50 cents, and
 * checks it — the forecast made on January 1 of Year 3, with the skill at full.
 */
export function forecasterSolved(st: ForecasterState): boolean {
  return st.year === COLD_SPELL.year && st.day === COLD_SPELL.day && round2(st.skill) === 1;
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
// Trading the two weeks: index gas bought or sold on the forecast, in the months the region heats.

/** The weather desk trades this many lots of index gas (10,000 MMBtu each) in a month. */
export const WEATHER_LOTS = 10;
/** The third demonstration opens on the settings Lesson 6.5 tests: skill 0.8, a 1 °F threshold. */
export const WEATHER_DESK_DEFAULTS = { skill: 0.8, threshold: 1 };
export type WeatherDeskState = typeof WEATHER_DESK_DEFAULTS;
export const WEATHER_THRESHOLD = { max: 5, step: 0.5 };
export const WEATHER_SKILL_STEP = 0.1;

export interface WeatherDeskRun {
  /** The forecast on the first day of every heating month of the history, and what that month's gas did. */
  signals: WeatherSignal[];
  book: BookResult;
  /** Profit after fees on each month traded. */
  pnl: Map<number, number>;
}

const weatherCache = new Map<string, WeatherDeskRun>();

/** The weather desk at a forecast skill and a threshold (°F from normal), over the history's heating months (cached). */
export function weatherDeskRun(skill: number, threshold: number): WeatherDeskRun {
  const sk = round2(skill);
  const th = round2(threshold);
  const key = `${sk}|${th}`;
  let r = weatherCache.get(key);
  if (!r) {
    const signals = weatherSignals(sk).filter((x) => HEATING_MONTHS.includes(x.month % 12));
    const book = runBook(weatherTrades({ skill: sk, thresholdF: th, lots: WEATHER_LOTS, months: HEATING_MONTHS }));
    r = { signals, book, pnl: new Map(book.trades.map((o) => [o.trade.legs[0].delivery, o.pnl])) };
    weatherCache.set(key, r);
  }
  return r;
}

/** Dollars per MMBtu a month's index gas made for each °F of forecast cold, across the heating months (least squares). */
export function weatherSlope(skill: number): number {
  const s = weatherDeskRun(skill, 0).signals;
  const mx = avg(s.map((x) => x.forecastColder));
  const my = avg(s.map((x) => x.edge));
  const sxx = s.reduce((a, x) => a + (x.forecastColder - mx) ** 2, 0);
  return sxx > 0 ? s.reduce((a, x) => a + (x.forecastColder - mx) * (x.edge - my), 0) / sxx : 0;
}

/** The least threshold, on the slider's steps, at which a forecast of `skill` trades and loses in no month it trades. */
export function noLossThreshold(skill = 1): number {
  for (let k = 0; k * WEATHER_THRESHOLD.step <= WEATHER_THRESHOLD.max + 1e-9; k++) {
    const b = weatherDeskRun(skill, k * WEATHER_THRESHOLD.step).book;
    if (b.trades.length > 0 && b.trades.every((o) => o.pnl > 0)) return round2(k * WEATHER_THRESHOLD.step);
  }
  return NaN;
}

/** The second challenge: at full skill, the least threshold that loses in no month traded (predicted from the red dots at 0 °F). */
export function weatherDeskSolved(s: WeatherDeskState): boolean {
  return round2(s.skill) === 1 && Math.abs(round2(s.threshold) - noLossThreshold(1)) < 1e-9;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes (computed once, on first render).

interface Facts {
  first: ReturnType<typeof conditionsOf>;
  last: ReturnType<typeof conditionsOf>;
  growth: number;
  restFeb: number;
  restMar: number;
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
  /** The least and greatest share of a degree day's extra demand that storage absorbs, across the eight years. */
  shareLow: number;
  shareHigh: number;
  spell: TwoWeeks;
  spellFull: TwoWeeks;
  spellAnswer: number;
  spellSeen: number;
  rest0: number[];
  outsideNov1: number;
  two0Jan: number;
  two8Jan: number;
  weather: WeatherDeskRun;
  weatherSlope: number;
  noLoss: number;
  noLossRun: WeatherDeskRun;
  belowRun: WeatherDeskRun;
}

let factsMemo: Facts | null = null;
function facts(): Facts {
  if (factsMemo) return factsMemo;
  const total = (t: number) => demandBlocks(t).reduce((s, b) => s + b.cap, 0);
  const block = (t: number, id: string) => demandBlocks(t).find((b) => b.id === id)!.cap;
  let normalWinterHdd = 0;
  for (let d = WINTER_START; d < GAS_YEAR_DAYS; d++) normalWinterHdd += hdd(normalTemp(d));
  const sur = forecasterSurprises();
  const rest0 = forecasterRestError(0);
  const slopeRun = forecasterRun(0, WINTER_START, 0);
  const demandPerHdd = (total(30) - total(40)) / 10;
  const shares = Array.from({ length: HISTORY_YEARS }, (_, y) => halfWeather(y).storagePerHdd / demandPerHdd);
  factsMemo = {
    first: conditionsOf(0),
    last: conditionsOf(HISTORY_YEARS - 1),
    growth: (conditionsOf(HISTORY_YEARS - 1).ridgeback - conditionsOf(0).ridgeback) / (HISTORY_YEARS - 1),
    restFeb: rest0[WEEKS.indexOf(GAS_MONTH_START[10])],
    restMar: rest0[WEEKS.indexOf(GAS_MONTH_START[11])],
    demandPerHdd,
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
    shareLow: Math.min(...shares),
    shareHigh: Math.max(...shares),
    spell: forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, 0)),
    spellFull: forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, 1)),
    spellAnswer: coldSpellAnswer(),
    spellSeen: coldSpellSeen(1),
    rest0,
    outsideNov1: sur.filter((s) => Math.abs(s[0]) > rest0[0]).length,
    two0Jan: forecasterTwoWeekError(GAS_MONTH_START[9], 0),
    two8Jan: forecasterTwoWeekError(GAS_MONTH_START[9], 0.8),
    weather: weatherDeskRun(WEATHER_DESK_DEFAULTS.skill, WEATHER_DESK_DEFAULTS.threshold),
    weatherSlope: weatherSlope(WEATHER_DESK_DEFAULTS.skill),
    noLoss: noLossThreshold(1),
    noLossRun: weatherDeskRun(1, noLossThreshold(1)),
    belowRun: weatherDeskRun(1, noLossThreshold(1) - WEATHER_THRESHOLD.step),
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
/** The third demonstration's x axis: a winter's heating degree days, November to March. */
const HALF_HDD: [number, number] = [4100, 5300];
const HALF_HDD_TICKS = [4200, 4400, 4600, 4800, 5000, 5200];
const RESERVE = totalStorage(END_OF_WINTER);
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const YEAR_OPTIONS = Array.from({ length: HISTORY_YEARS }, (_, i) => ({ value: String(i), label: `Year ${i + 1}` }));
const monthOf = (abs: number) => `${GAS_MONTH_NAMES[abs % 12]} of Year ${Math.floor(abs / 12) + 1}`;
const signedGp = (v: number) => `${v > 0.005 ? '+' : v < -0.005 ? '−' : ''}$${fmt(Math.abs(v), 2)}`;
const signedF = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`;
const coldWord = (v: number) => (v >= 0 ? 'colder' : 'warmer');
const WON = GRAPHIC.green;
const LOST = GRAPHIC.red;
const ASIDE = '#a8a8a8';
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

  // The status never prints the miss: the reader predicts, then reads the two Calder readouts at full skill.
  const status =
    st.year !== COLD_SPELL.year || st.day !== COLD_SPELL.day
      ? 'Make your prediction, then choose Year 3 and move the forecast day to Jan 1.'
      : 'Now set the skill to full, 1.00, and compare the two Calder readouts.';

  // Third demonstration: half the weather.
  const hw = useScenario('forecaster-half', HALF_DEFAULTS);
  const half = useMemo(() => halfWeather(hw.state.year), [hw.state.year]);
  const fitAt = (x: number, mean: number, rate: number) => mean + rate * (x - half.mean.hdd);

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

  // Fourth demonstration: the weather desk.
  const wz = useScenario('weather-desk', WEATHER_DESK_DEFAULTS);
  const ws = wz.state;
  const wrun = useMemo(() => weatherDeskRun(ws.skill, ws.threshold), [ws.skill, ws.threshold]);
  const wTrades = wrun.book.trades;
  const wWins = wTrades.filter((o) => o.pnl > 0).length;
  const wBought = wTrades.filter((o) => o.trade.legs.some((l) => l.kind === 'index' && l.lots > 0)).length;
  const wWorst = wTrades.reduce<(typeof wTrades)[number] | null>((w, o) => (o.pnl <= 0 && (!w || o.pnl < w.pnl) ? o : w), null);
  const wWorstSig = wWorst ? wrun.signals.find((x) => x.month === wWorst.trade.entry) : undefined;
  const solvedB = weatherDeskSolved(ws);
  const statusB =
    round2(ws.skill) !== 1
      ? 'Set the forecast skill to full, 1.0, and the threshold to 0 °F.'
      : wTrades.length === 0
        ? `At ${fmt(ws.threshold, 1)} °F the desk never trades.`
        : wTrades.length > wWins
          ? `At ${fmt(ws.threshold, 1)} °F the desk trades ${wTrades.length} months and loses in ${wTrades.length - wWins}.`
          : `At ${fmt(ws.threshold, 1)} °F it trades ${wTrades.length} months and loses in none. Would a lower threshold do?`;
  const noLossTrades = F.noLossRun.book.trades;
  const belowLosers = F.belowRun.book.trades.filter((o) => o.pnl <= 0).map((o) => F.belowRun.signals.find((x) => x.month === o.trade.entry)!);

  const year = (i: number) => `Year ${i + 1}`;

  return (
    <LessonPage id="gas/6.1">
      <P>
        <a href={lessonHref('gas/5.5')}>Chapter 5</a> ended with a claim worth testing. Every price difference in our region traces back to a physical limit — a full
        pipeline, a full storage field, a field that can’t deliver fast enough — and a trader who sees one coming before the market prices it might profit from it.
        This chapter asks whether that’s really so. Two things come before any trade: a forecast, and a history to test it on, so that an idea that works can be told
        apart from one that only sounds right.
      </P>
      <P>
        Our history is eight simulated gas years, April to March, run day by day on Chapter 4’s market model. Each year has its own weather — the eight were
        picked to include some extreme winters — and the region changes underneath the market, as real ones do: Ridgeback’s <K tone="orange">production</K> grows
        by {bcfd(F.growth, 2)} a year, from {bcfd(F.first.ridgeback, 2)} in Year 1 to {bcfd(F.last.ridgeback, 2)} in Year {HISTORY_YEARS}, and in Year{' '}
        {EXPRESS_EXPANSION.year + 1} Ridgeback Express is expanded by {bcfd(EXPRESS_EXPANSION.addBcfd, 1)}. The storage operators draw up their seasonal plan on
        April 1 and redraw it on the first of every month from the gas they actually hold, assuming normal weather from then on — the plan and water values of{' '}
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>.
      </P>
      <P>
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> gave the rule every forecast starts from: gas can’t pile up or vanish, so whatever the fields produce and the
        region doesn’t burn or export goes into <K c="energy">storage</K>. Within a year, production is steady and the LNG terminal takes its feed gas whenever
        cargoes pay; consumption moves, with the <K tone="teal">weather</K>. Each heating degree day — each degree by which a day’s mean temperature falls below
        65 °F — adds {bcf(F.demandPerHdd, 3)} to what the region burns that day, {fmt((F.homesPerHdd / F.demandPerHdd) * 100)}% of it in Metro’s homes. A
        forecast of storage is, above all, a forecast of the weather.
      </P>
      <P>
        Weather forecasts are good for a few days and fade after that, and ours fade the same way. A forecast’s <b>skill</b> measures how closely its predicted
        departures from normal follow what happens: at full skill the correlation is {fmt(forecastSkill(1, 1), 2)} a day ahead, {fmt(forecastSkill(1, 7), 2)} a
        week ahead and only {fmt(forecastSkill(1, FORECAST_HORIZON), 2)} two weeks ahead, and a forecast with no skill simply predicts the normal temperature. Past
        its two weeks nobody knows, so we imagine {FORECAST_MEMBERS} possible winters, each borrowing the departures from normal of a different simulated year, and
        run the market through every one from the gas actually in storage that morning, as weather services do.
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
          normal {fmt(two.normalTemp, 1)} °F; they came in at {fmt(two.actTemp, 1)} °F. What remained on March 31 was{' '}
          {inside ? 'inside the imagined range' : f.endActual < f.endLow ? 'less than in any imagined winter' : 'more than in any imagined winter'}.
        </Caption>
      </Figure>

      <P>
        The demonstration opens on November 1 of Year 6, a winter that turned out {fmt(Math.abs(F.winterSurprise[5]))} heating degree days{' '}
        {F.winterSurprise[5] >= 0 ? 'colder' : 'warmer'} than a normal {fmt(F.normalWinterHdd)} — about as ordinary as winters come. The imagined winters end March
        with {fmt(F.base.endLow, 1)}–{fmt(F.base.endHigh, 1)} Bcf, {fmt(F.base.endMean, 1)} on average; {fmt(F.base.endActual, 1)} actually remained. Now choose
        Year 3, the coldest winter in the history, {fmt(F.winterSurprise[2])} heating degree days colder than normal. On November 1 its forecast looks{' '}
        {F.cold.endMean > F.base.endMean + 0.5 ? 'no worse than Year 6’s — rosier, even' : 'much the same'}: {fmt(F.cold.endMean, 1)} Bcf on average, no imagined
        winter lower than {fmt(F.cold.endLow, 1)}. Storage ended March with {fmt(F.cold.endActual, 1)}. Move the forecast day forward: the range narrows as the
        winter passes, and by March 1 it runs from {fmt(F.coldMar.endLow, 1)} to {fmt(F.coldMar.endHigh, 1)} Bcf and{' '}
        {F.coldMar.endActual >= F.coldMar.endLow && F.coldMar.endActual <= F.coldMar.endHigh ? 'at last contains' : 'still misses'} what happened.
      </P>
      <P>
        The forecast got better without the forecaster learning anything: there was simply less winter left to be wrong about. Skill does little for the end of
        March — on November 1 of Year 6, turning it from none to full moves the forecast by only {fmt(Math.abs(F.baseSkill0.endMean - F.baseSkill1.endMean), 1)}{' '}
        Bcf, since two weeks of better information are a small part of five months of winter. It matters for the next two weeks, which is why the readouts follow
        the price at Calder over the forecast’s own days:
      </P>

      <Challenge
        id="a"
        figure="Gas Fundamentals Forecaster"
        question={`On January 1 of Year 3 a cold spell begins: the next two weeks average ${fmt(F.spell.actTemp, 1)} °F against a normal ${fmt(F.spell.normalTemp, 1)} °F, and a forecast made that morning with no skill misses their average price at Calder by ${gp(Math.abs(F.spell.actPrice - F.spell.fcPrice))}. Predict first, from how fast skill fades: will even a full-skill forecast get within 50 cents? Then check it on that day.`}
        solved={solved}
        status={status}
        success={`Yes, just: at full skill the forecast expects ${gp(F.spellFull.fcPrice)} against the ${gp(F.spellFull.actPrice)} that came, ${fmt(Math.abs(F.spellFull.actPrice - F.spellFull.fcPrice) * 100)} cents short; ${fmt(F.spellAnswer, 2)} is the least skill that gets within 50 cents. Yet even full skill sees only ${fmt(F.spellSeen * 100)}% of the cold — ${fmt(F.spellFull.fcTemp, 1)} °F forecast against ${fmt(F.spellFull.actTemp, 1)} °F — because its best guess pulls every departure toward normal, more so the further ahead it looks. A forecaster who could see these two weeks more clearly than everyone else would have something worth trading — for two weeks.`}
      />

      <H2>Half the weather</H2>
      <P>
        A colder winter draws storage down further, but not by as much as its extra demand. In the next demonstration each dot is one of the {FORECAST_MEMBERS}{' '}
        winters imagined on November 1 of a year, with no skill, placed by its heating degree days from November to March: above, against the gas left on March
        31; below, against the winter’s average price at Calder. Each line is the best straight line through the dots, and the ring is the winter that happened.
        Choose a year:
      </P>

      <Figure name="Gas Fundamentals Forecaster · half the weather" scenario={hw}>
        <Segmented label="Year" value={String(hw.state.year)} onChange={(v) => hw.set({ year: Number(v) })} options={YEAR_OPTIONS} />
        <XYChart
          xDomain={HALF_HDD}
          yDomain={[20, 65]}
          xTicks={HALF_HDD_TICKS}
          xFormat={(v) => fmt(v)}
          yTicks={[20, 30, 40, 50, 60]}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas on March 31, Bcf"
          height={170}
          vLines={[{ at: F.normalWinterHdd, color: NORMAL, dash: '5 4', width: 1, label: 'normal winter', labelAt: 'end' }]}
          series={[
            { xs: HALF_HDD, ys: HALF_HDD.map((x) => fitAt(x, half.mean.storage, -half.storagePerHdd)), color: TEXT.gold, width: 1.5 },
            { xs: half.hdd, ys: half.storage, color: STORED, kind: 'points', r: 3.5 },
          ]}
          markers={[{ x: half.actual.hdd, y: half.actual.storage, color: ACTUAL, r: 5, ring: true, label: 'happened', labelPos: half.actual.hdd > 4900 ? 'left' : 'right' }]}
          ariaLabel={`The ${FORECAST_MEMBERS} winters imagined on November 1 of ${year(hw.state.year)}: from ${fmt(Math.min(...half.hdd))} to ${fmt(Math.max(...half.hdd))} heating degree days, leaving ${fmt(Math.min(...half.storage), 1)} to ${fmt(Math.max(...half.storage), 1)} Bcf on March 31, about ${fmt(half.storagePerHdd, 3)} Bcf less for each extra degree day. The winter that happened had ${fmt(half.actual.hdd)} and left ${fmt(half.actual.storage, 1)} Bcf.`}
        />
        <XYChart
          xDomain={HALF_HDD}
          yDomain={[2, 6.5]}
          xTicks={HALF_HDD_TICKS}
          xFormat={(v) => fmt(v)}
          yTicks={[2, 3, 4, 5, 6]}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="The winter’s average price at Calder, $/MMBtu"
          xLabel="Heating degree days, November to March"
          height={190}
          vLines={[{ at: F.normalWinterHdd, color: NORMAL, dash: '5 4', width: 1 }]}
          series={[
            { xs: HALF_HDD, ys: HALF_HDD.map((x) => fitAt(x, half.mean.price, half.pricePerHdd)), color: TEXT.green, width: 1.5 },
            { xs: half.hdd, ys: half.price, color: GRAPHIC.green, kind: 'points', r: 3.5 },
          ]}
          markers={[{ x: half.actual.hdd, y: half.actual.price, color: ACTUAL, r: 5, ring: true }]}
          ariaLabel={`The same winters’ average price at Calder, from ${gp(Math.min(...half.price))} to ${gp(Math.max(...half.price))}, about ${gp(half.pricePerHdd * 100)} more for every hundred extra degree days; the winter that happened averaged ${gp(half.actual.price)}.`}
        />
        <Readouts
          items={[
            { label: 'less on March 31, per extra degree day', value: bcf(half.storagePerHdd, 3), tone: 'gold' },
            { label: `of the ${bcf(F.demandPerHdd, 3)} it adds to demand`, value: `${fmt((half.storagePerHdd / F.demandPerHdd) * 100)}%`, tone: 'gold' },
            { label: 'more on the price, per 100 degree days', value: gp(half.pricePerHdd * 100), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        In Year 1 each extra heating degree day leaves about {bcf(F.storagePerHdd, 3)} less in storage at the end of March, about{' '}
        {fmt((F.storagePerHdd / F.demandPerHdd) * 100)}% of the {bcf(F.demandPerHdd, 3)} it adds to demand; across the eight years the share runs from{' '}
        {fmt(F.shareLow * 100)}% to {fmt(F.shareHigh * 100)}%. The rest never comes out of storage. A cold spell draws the fields down faster than planned, the
        operators raise their water values, the <K c="price">price</K> rises — in Year 1 by about {gp(F.pricePerHdd * 100)} on the winter’s average per hundred
        extra heating degree days — and power plants switch to coal and Bayport’s flexible industry cuts back (Lesson 4.1). So the weather a forecast misses lands
        partly in storage and partly in the price, and a trader who forecasts storage is really forecasting the price.
      </P>

      <H2>How far ahead</H2>
      <P>
        In the next demonstration each thin line is one year of the history. On each day of the winter it shows how
        many more heating degree days than normal (or fewer) were still to come before the end of March: exactly what a forecast with no skill, made that day,
        would miss. The teal band is the typical miss — the root-mean-square error over {ERROR_YEARS} simulated winters — of a forecast with the skill you set; the
        dashed lines are the same with no skill. Choose a year, set the skill, and drag across the chart:
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
            { label: 'as storage on March 31, at Year 1’s rate', value: `≈ ${bcf(rest[wi] * F.storagePerHdd)}`, tone: 'gold' },
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
      </Figure>

      <P>
        On November 1 a forecast of the rest of the winter typically misses by {fmt(rest0[0])} heating degree days — at Year 1’s rate, about{' '}
        {bcf(rest0[0] * F.storagePerHdd)} of storage at the end of March. {cap(WORDS[F.outsideNov1])} of our eight years began their winter further from normal than
        that, because the history was picked to include extreme winters; Year 3 began it {fmt(F.winterSurprise[2] / rest0[0], 1)} typical misses colder. The typical
        miss falls to {fmt(F.restFeb)} on February 1 and {fmt(F.restMar)} on March 1, and skill hardly narrows it until the last weeks. Over its own two weeks,
        skill does count: a forecast made on January 1 with no skill typically misses those two weeks by {fmt(F.two0Jan)} heating degree days, one with skill{' '}
        {fmt(0.8, 1)} by {fmt(F.two8Jan)} — {fmt((1 - F.two8Jan / F.two0Jan) * 100)}% less, most of it in the first few days.
      </P>
      <P>
        So gas fundamentals can be forecast in two senses. Over the next few days a skilled weather forecast narrows the miss. Over the rest of the
        winter nobody does much better than the climate, and the honest answer is a range that narrows only as the winter is used up — and that an extreme winter,
        like Year 3 in <FigRef to="Gas Fundamentals Forecaster">the first demonstration</FigRef>, can fall outside.
      </P>

      <H2>Trading two weeks</H2>
      <P>
        Two weeks of skill can be traded. On the first of every month the market quotes a futures price for that month’s gas at Calder (
        <a href={lessonHref('gas/4.5')}>Lesson 4.5</a>), drawn like the operators’
        plans: from the gas in storage that morning, as if the weather from then on will be normal. Buy a lot of the month’s gas at that price — 10,000 MMBtu spread
        through the month — and sell it back day by day at each day’s price, and you have swapped the futures price for the month’s average. We’ll call that
        position <K c="price">index gas</K>, after the published daily price indexes such swaps settle against.
      </P>
      <P>
        A forecast could beat a price that assumes normal weather. Here is a rule: in the months when the region heats — October to April, when every
        normal day is colder than 65 °F — buy {WORDS[WEATHER_LOTS] ?? fmt(WEATHER_LOTS)} lots of index gas on the first day if the forecast says the next two weeks
        will be colder than normal by more than a threshold, and sell {WORDS[WEATHER_LOTS] ?? fmt(WEATHER_LOTS)} if it says warmer. (In summer a cooler day burns
        less gas, in power plants running less air conditioning.) In the next demonstration each dot is one of the history’s {F.weather.signals.length} heating
        months: across, how far from normal its first day’s forecast put the next two weeks; up, what a lot of index gas bought that day made per MMBtu.
        The desk stands aside inside the shaded band; outside it, green dots made money after fees and red ones lost. Set the skill and the threshold:
      </P>

      <Figure name="Gas Fundamentals Forecaster · weather trades" scenario={wz}>
        <XYChart
          xDomain={[-4, 8]}
          yDomain={[-1, 1]}
          xTicks={[-4, -2, 0, 2, 4, 6, 8]}
          xFormat={(v) => `${signedF(v)} °F`}
          yTicks={[-1, -0.5, 0, 0.5, 1]}
          yFormat={signedGp}
          yLabel="The month’s average price at Calder less its futures price, $/MMBtu"
          xLabel="Forecast for the first two weeks: colder (+) or warmer (−) than normal"
          height={290}
          bands={ws.threshold > 0 ? [{ from: -ws.threshold, to: ws.threshold, color: 'rgba(0, 0, 0, 0.06)', label: 'stand aside' }] : []}
          hLines={[{ at: 0, color: '#9a9a9a', width: 1 }]}
          series={[]}
          ariaLabel={`The ${wrun.signals.length} heating months of the history, each placed by its two-week forecast (skill ${fmt(ws.skill, 1)}) and by what a lot of index gas made. With a threshold of ${fmt(ws.threshold, 1)} °F the desk trades ${wTrades.length} months, ${wWins} of them profitably, for ${money(wrun.book.total)} after fees.`}
        >
          {(x, y) => (
            <g>
              {wrun.signals.map((g) => {
                const p = wrun.pnl.get(g.month);
                const cx = x(Math.max(-4, Math.min(8, g.forecastColder)));
                const cy = y(Math.max(-1, Math.min(1, g.edge)));
                return p === undefined ? (
                  <circle key={g.month} cx={cx} cy={cy} r={4} fill="none" stroke={ASIDE} strokeWidth={1.3} />
                ) : (
                  <circle key={g.month} cx={cx} cy={cy} r={4.5} fill={p > 0 ? WON : LOST} opacity={0.9} />
                );
              })}
              {wrun.signals
                .filter((g) => g.month === COLD_SPELL.year * 12 + 9)
                .map((g) => (
                  <text key="spell" className="ax" x={x(Math.min(8, g.forecastColder)) - 8} y={y(Math.min(1, g.edge)) + 4} textAnchor="end">
                    {`Jan, Year ${COLD_SPELL.year + 1}`}
                  </text>
                ))}
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'traded, made money', color: WON },
            { label: 'traded, lost', color: LOST },
            { label: 'stood aside', color: ASIDE },
          ]}
        />
        <Readouts
          items={[
            { label: 'months traded', value: `${wTrades.length} of ${wrun.signals.length}` },
            { label: 'that made money', value: fmt(wWins) },
            { label: `profit after fees, ${WEATHER_LOTS} lots`, value: money(wrun.book.total), tone: wrun.book.total < 0 ? 'red' : 'green' },
          ]}
        />
        <Slider
          label="Forecast skill"
          tone="teal"
          value={ws.skill}
          min={0}
          max={1}
          step={WEATHER_SKILL_STEP}
          onChange={(v) => wz.set({ skill: round2(v) })}
          display={ws.skill === 0 ? 'none: normal weather' : fmt(ws.skill, 1)}
        />
        <Slider
          label="Trade if the forecast is off normal by more than"
          tone="teal"
          value={ws.threshold}
          min={0}
          max={WEATHER_THRESHOLD.max}
          step={WEATHER_THRESHOLD.step}
          onChange={(v) => wz.set({ threshold: round2(v) })}
          display={`${fmt(ws.threshold, 1)} °F`}
        />
        <Caption>
          {wTrades.length === 0
            ? `With skill ${fmt(ws.skill, 1)} no forecast strays more than ${fmt(ws.threshold, 1)} °F from normal, so the desk never trades.`
            : `The desk buys in ${wBought} months and sells in ${wTrades.length - wBought}, for ${money(wrun.book.total)} after fees. ${
                wWorst && wWorstSig
                  ? `Its worst, ${monthOf(wWorst.trade.entry)}, lost ${money(-wWorst.pnl)}: the forecast expected the first two weeks ${fmt(Math.abs(wWorstSig.forecastColder), 1)} °F ${coldWord(wWorstSig.forecastColder)} than normal, and they came in ${fmt(Math.abs(wWorstSig.actualColder), 1)} °F ${coldWord(wWorstSig.actualColder)}.`
                  : 'It loses in no month it trades.'
              }`}
        </Caption>
      </Figure>

      <P>
        At skill {fmt(WEATHER_DESK_DEFAULTS.skill, 1)} and {fmt(WEATHER_DESK_DEFAULTS.threshold)} °F the desk trades {F.weather.book.trades.length} of the{' '}
        {F.weather.signals.length} months, {F.weather.book.trades.filter((o) => o.pnl > 0).length} of them profitably, for{' '}
        {money(Math.round(F.weather.book.total / 1000) * 1000)}. The dots lean: each degree of cold in the forecast went with the month averaging about{' '}
        {gp(F.weatherSlope)} per MMBtu further above its futures price. With less skill they slide toward the middle, since a weaker forecast pulls its guess toward
        normal; with none the desk never trades. More skill doesn’t remove the red dots, because even the best forecast sees two weeks of a month that settles on
        all of it:
      </P>

      <Challenge
        id="b"
        figure="Gas Fundamentals Forecaster · weather trades"
        question="Set the skill to full and the threshold to 0 °F, so that every month trades. Predict from where the red dots sit: what’s the least threshold, on the slider’s steps, at which the desk loses money in no month it trades? Then set it."
        solved={solvedB}
        status={statusB}
        success={`Solved: ${fmt(F.noLoss, 1)} °F. Only ${WORDS[noLossTrades.length] ?? fmt(noLossTrades.length)} of the ${F.weather.signals.length} months clear it, for ${money(Math.round(F.noLossRun.book.total / 1000) * 1000)}. One step lower the desk also trades ${belowLosers.map((g) => `${monthOf(g.month)}, whose forecast expected its first two weeks ${fmt(Math.abs(g.forecastColder), 1)} °F ${coldWord(g.forecastColder)} than normal; they came in ${fmt(Math.abs(g.actualColder), 1)} °F ${coldWord(g.actualColder)}, and the month lost`).join('; ')}. A forecast that is never wrong is one that hardly ever speaks: a threshold strict enough to avoid every loss also skips most of the profit, so the desk has to live with losing months.`}
      />

      <P>
        Whether that profit survives trading costs, margin and a test that uses only what was known at the time is the question of{' '}
        <a href={lessonHref('gas/6.5')}>Lesson 6.5</a>. A forecast of storage, meanwhile, is at bottom a forecast of what gas will be worth in one month against
        another — how much is left at the end of March decides how dear March gas is against April’s — and whether that is enough to trade the difference is the
        question of <a href={lessonHref('gas/6.2')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
