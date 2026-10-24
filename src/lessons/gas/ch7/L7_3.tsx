import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  DataTable,
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
import {
  CHALLENGE_SEEDS,
  lineTariff,
  systemCost,
  systemForecast,
  systemYear,
  winterColder,
  type GasSystem,
  type SystemYear,
} from '../../../engines/gas/capstone';
import { forecastSkill, forecastTemps } from '../../../engines/gas/forecast';
import { END_OF_WINTER } from '../../../model/gas/history';
import { GAS_MONTHS, GAS_MONTH_DAYS, GAS_MONTH_NAMES, GAS_MONTH_START, GAS_YEAR_DAYS, gasDayLabel } from '../../../model/gas/weather';
import { CORRIDORS, GAS_NODES } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { useGasCapstone } from '../shared/capstone';
import { basis, bcf, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// A round: one hidden winter, one forecast day, on the reader's network.

/** The forecast days of each hidden winter: the first of December, January and February (gas-year months). */
export const ROUND_MONTHS = [8, 9, 10];
/** Imagined winters in each forecast, and the days the weather forecast covers (as in Lesson 6.1). */
export const ROUND_MEMBERS = 12;
export const ROUND_HORIZON = 14;
/** The steps the reader's forecasts move in: $/MMBtu for the basis and Calder, Bcf for storage. */
export const ENTRY_STEPS = { basis: 0.01, calder: 0.01, storage: 0.1 };
export const SKILL_STEP = 0.1;

export type Question = 'basis' | 'calder' | 'storage';
export const QUESTIONS: Question[] = ['basis', 'calder', 'storage'];
export interface Forecasts {
  basis: number;
  calder: number;
  storage: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const snap = (x: number, step: number) => Math.round(Math.round(x / step) * step * 100) / 100;
const round2 = (x: number) => Math.round(x * 100) / 100;
const totalStorage = (s: { saltflat: number; hollowcreek: number }) => s.saltflat + s.hollowcreek;

export interface ForecastRound {
  seed: number;
  winter: number;
  month: number;
  day: number;
  /** The market's forecasts that morning: the prompt month's basis forward and futures price, and the operators' plan for March 31. */
  market: Forecasts;
  /** The imagined winters' averages, and the days they expect Metro above Calder plus Northline's trip. */
  ensemble: Forecasts & { fullDays: number };
  /** What happened. */
  actual: Forecasts & { fullDays: number };
  /** Working gas that morning, Bcf. */
  storageNow: number;
  /** The weather forecast's next two weeks: average forecast, normal and (hidden until the reveal) actual temperature, °F. */
  fcTemp: number;
  normalTemp: number;
  actTemp: number;
}

/** Days in a list of daily Metro basis values on which Metro sat above Calder plus Northline's trip — the pipes into Metro were full. */
export function fullPipeDays(basisDays: number[]): number {
  const trip = lineTariff('calder-metro');
  return basisDays.filter((b) => b > trip + 0.01).length;
}

/**
 * A round of the forecast challenge on a network (pure; cached through the engine): the hidden
 * winter `winter` (index into CHALLENGE_SEEDS), forecast on the first day of gas-year month `month`
 * with a weather forecast of `skill`.
 */
export function forecastRound(s: GasSystem, winter: number, month: number, skill: number): ForecastRound {
  const seed = CHALLENGE_SEEDS[winter];
  const y = systemYear(s, seed);
  const day = GAS_MONTH_START[month];
  const f = systemForecast(s, seed, day, round2(skill), ROUND_MEMBERS, ROUND_HORIZON);
  const n = GAS_MONTH_DAYS[month];
  const plan = y.plans[month];
  const ens = {
    basis: avg(f.members.map((m) => avg(m.metroBasis.slice(0, n)))),
    calder: avg(f.members.map((m) => avg(m.calder.slice(0, n)))),
    storage: avg(f.members.map((m) => m.storage[m.storage.length - 1])),
    fullDays: avg(f.members.map((m) => fullPipeDays(m.metroBasis.slice(0, n)))),
  };
  const actualBasis = y.days.slice(day, day + n).map((d) => d.price.metro - d.price.calder);
  const temps = y.weather.temp;
  const fc = roundForecastTemps(s, winter, month, skill);
  const fcDays = fc.map((_, i) => day + i);
  return {
    seed,
    winter,
    month,
    day,
    market: { basis: y.curves[month].metroBasis[month], calder: y.curves[month].calder[month], storage: plan.totalInventory[12 - month] },
    ensemble: ens,
    actual: {
      basis: y.monthly.metro[month] - y.monthly.calder[month],
      calder: y.monthly.calder[month],
      storage: totalStorage(y.days[GAS_YEAR_DAYS - 1].storage),
      fullDays: fullPipeDays(actualBasis),
    },
    storageNow: totalStorage(y.days[day - 1].storage),
    fcTemp: avg(fc),
    normalTemp: avg(fcDays.map((d) => y.weather.normal[d])),
    actTemp: avg(fcDays.map((d) => temps[d])),
  };
}

const tempCache = new Map<string, number[]>();
/** The weather forecast issued on the round's morning for its next two weeks, °F (the same forecast the imagined winters start from). */
export function roundForecastTemps(s: GasSystem, winter: number, month: number, skill: number): number[] {
  const key = `${winter}|${month}|${round2(skill)}`;
  let t = tempCache.get(key);
  if (!t) {
    const seed = CHALLENGE_SEEDS[winter];
    const y = systemYear(s, seed);
    const day = GAS_MONTH_START[month];
    // systemForecast keeps only prices and storage; the forecast itself comes from the same call the engine makes.
    t = forecastTempsFor(y, day, round2(skill));
    tempCache.set(key, t);
  }
  return t;
}

function forecastTempsFor(y: SystemYear, day: number, skill: number): number[] {
  return forecastTemps(y.weather, day, ROUND_HORIZON, skill, y.seed);
}

/** The market's forecasts on the reader's slider steps (what a reader who doesn't move a slider enters). */
export function marketOnSteps(r: ForecastRound): Forecasts {
  return {
    basis: round2(snap(r.market.basis, ENTRY_STEPS.basis)),
    calder: round2(snap(r.market.calder, ENTRY_STEPS.calder)),
    storage: snap(r.market.storage, ENTRY_STEPS.storage),
  };
}

export interface RoundScore {
  /** Absolute misses of the reader, the market (on the slider's steps) and the imagined winters. */
  you: Forecasts;
  market: Forecasts;
  ensemble: Forecasts;
  /** Questions on which the reader came closer than the market. */
  beat: Record<Question, boolean>;
  beaten: number;
}

/** How a committed round scored. */
export function scoreRound(entry: Forecasts, r: ForecastRound): RoundScore {
  const m = marketOnSteps(r);
  const miss = (f: Forecasts): Forecasts => ({ basis: Math.abs(f.basis - r.actual.basis), calder: Math.abs(f.calder - r.actual.calder), storage: Math.abs(f.storage - r.actual.storage) });
  const you = miss(entry);
  const market = miss(m);
  const beat = { basis: you.basis < market.basis - 1e-9, calder: you.calder < market.calder - 1e-9, storage: you.storage < market.storage - 1e-9 };
  return { you, market, ensemble: miss(r.ensemble), beat, beaten: QUESTIONS.filter((q) => beat[q]).length };
}

/** Solved: in at least one committed round the reader came closer than the market on all three forecasts. */
export function forecastChallengeSolved(scores: RoundScore[]): boolean {
  return scores.some((s) => s.beaten === QUESTIONS.length);
}

/** A reader who enters the imagined winters' averages (on the slider's steps) in every round: the rounds it wins outright. */
export function ensembleSweeps(s: GasSystem, skill: number): Array<{ winter: number; month: number }> {
  const out: Array<{ winter: number; month: number }> = [];
  CHALLENGE_SEEDS.forEach((_, w) =>
    ROUND_MONTHS.forEach((m) => {
      const r = forecastRound(s, w, m, skill);
      const e = { basis: snap(r.ensemble.basis, ENTRY_STEPS.basis), calder: snap(r.ensemble.calder, ENTRY_STEPS.calder), storage: snap(r.ensemble.storage, ENTRY_STEPS.storage) };
      if (scoreRound(e, r).beaten === 3) out.push({ winter: w, month: m });
    }),
  );
  return out;
}

export interface Tally {
  /** Rounds in which the imagined winters came closer than the market, for each question. */
  wins: Record<Question, number>;
  /** Mean absolute misses, for each question: the market's and the imagined winters'. */
  marketMiss: Forecasts;
  ensembleMiss: Forecasts;
  rounds: ForecastRound[];
}

/** Every round of the six hidden winters on a network, at a skill. */
export function roundTally(s: GasSystem, skill: number): Tally {
  const rounds: ForecastRound[] = [];
  CHALLENGE_SEEDS.forEach((_, w) => ROUND_MONTHS.forEach((m) => rounds.push(forecastRound(s, w, m, skill))));
  const wins = { basis: 0, calder: 0, storage: 0 };
  const mm = { basis: 0, calder: 0, storage: 0 };
  const em = { basis: 0, calder: 0, storage: 0 };
  for (const r of rounds) {
    for (const q of QUESTIONS) {
      const me = Math.abs(r.market[q] - r.actual[q]);
      const ee = Math.abs(r.ensemble[q] - r.actual[q]);
      if (ee < me) wins[q]++;
      mm[q] += me / rounds.length;
      em[q] += ee / rounds.length;
    }
  }
  return { wins, marketMiss: mm, ensembleMiss: em, rounds };
}

/** The first demonstration opens on January 1 of the first hidden winter, with Lesson 6.1's skill. */
/** Your forecasts start at the market's (null) until you move them. */
export const FORECAST_CHALLENGE_DEFAULTS = { winter: 0, month: 9, skill: 0.8, members: true, basis: null as number | null, calder: null as number | null, storage: null as number | null };
export type ChallengeState = typeof FORECAST_CHALLENGE_DEFAULTS;
/** The second demonstration's defaults. */
export const TALLY_DEFAULTS = { question: 'basis' as Question, skill: 0.8 };

/** A description of the reader's network for the prose: as built, or what changed. */
export function networkWords(s: GasSystem): { asBuilt: boolean; changed: string[]; capital: number } {
  const c = systemCost(s);
  const name = (id: string) => {
    const k = CORRIDORS.find((x) => x.id === id)!;
    const n = (g: string) => GAS_NODES.find((x) => x.id === g)!.name;
    return `${n(k.from)}–${n(k.to)}`;
  };
  return { asBuilt: c.changed.length === 0, changed: c.changed.map(name), capital: c.added };
}

// ---------------------------------------------------------------------------
// Charts.

const CHART_FROM = GAS_MONTH_START[6];
const DAY_TICKS = GAS_MONTH_START.slice(6);
const dayTick = (v: number) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? '';
const ACTUAL = '#333333';
const NORMAL = '#8a8a8a';
const WEATHER = GRAPHIC.teal;
const MARKET = GRAPHIC.green;
const ENSEMBLE = GRAPHIC.gold;
const MEMBER = tint(GRAPHIC.gold, 0.45);
const YOU = GRAPHIC.violet;
const RESERVE = totalStorage(END_OF_WINTER);
const WINTER_OPTIONS = CHALLENGE_SEEDS.map((_, i) => ({ value: String(i), label: `Winter ${i + 1}` }));
const MONTH_OPTIONS = ROUND_MONTHS.map((m) => ({ value: String(m), label: `${GAS_MONTHS[m]} 1` }));
const SHORT_LABEL: Record<Question, string> = { basis: 'Metro’s basis', calder: 'Calder', storage: 'Storage, Mar 31' };
const QUESTION_LABEL: Record<Question, string> = { basis: 'Metro’s basis, the month ahead', calder: 'Calder, the month ahead', storage: 'Working gas, March 31' };
const fmtQ = (q: Question, v: number) => (q === 'storage' ? bcf(v) : q === 'basis' ? basis(v) : gp(v));
/** A miss, unsigned. */
const fmtMiss = (q: Question, v: number) => (q === 'storage' ? bcf(v) : gp(v));
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen'];
const word = (n: number) => WORDS[n] ?? fmt(n);
const keyOf = (w: number, m: number) => `${w}|${m}`;

export default function Lesson() {
  const { system } = useGasCapstone();
  const net = networkWords(system);
  const s = useScenario('forecast-challenge', FORECAST_CHALLENGE_DEFAULTS);
  const st = s.state;
  const [committed, setCommitted] = useState<Record<string, Forecasts>>({});
  const round = useMemo(() => forecastRound(system, st.winter, st.month, st.skill), [system, st.winter, st.month, st.skill]);
  const y = systemYear(system, round.seed);
  const f = systemForecast(system, round.seed, round.day, round2(st.skill), ROUND_MEMBERS, ROUND_HORIZON);
  const fcTemps = roundForecastTemps(system, st.winter, st.month, st.skill);
  const key = keyOf(st.winter, st.month);
  const locked = committed[key];
  const mkt = marketOnSteps(round);
  const entry: Forecasts = locked ?? { basis: st.basis ?? mkt.basis, calder: st.calder ?? mkt.calder, storage: st.storage ?? mkt.storage };
  const score = locked ? scoreRound(locked, round) : null;
  const scores = Object.entries(committed).map(([k, e]) => {
    const [w, m] = k.split('|').map(Number);
    return { w, m, score: scoreRound(e, forecastRound(system, w, m, st.skill)) };
  });
  const solved = forecastChallengeSolved(scores.map((x) => x.score));
  const best = scores.reduce<(typeof scores)[0] | null>((b, x) => (!b || x.score.beaten > b.score.beaten ? x : b), null);

  const goTo = (winter: number, month: number) => {
    s.set({ winter, month, basis: null, calder: null, storage: null });
  };

  // Numbers the prose quotes for the opening round, on the reader's network.
  const open = useMemo(() => forecastRound(system, FORECAST_CHALLENGE_DEFAULTS.winter, FORECAST_CHALLENGE_DEFAULTS.month, FORECAST_CHALLENGE_DEFAULTS.skill), [system]);
  const openMembersFull = useMemo(() => {
    const ff = systemForecast(system, open.seed, open.day, FORECAST_CHALLENGE_DEFAULTS.skill, ROUND_MEMBERS, ROUND_HORIZON);
    return ff.members.filter((m) => fullPipeDays(m.metroBasis.slice(0, GAS_MONTH_DAYS[open.month])) > 0).length;
  }, [system, open]);

  // Charts: what is known up to the forecast day, and the rest once revealed.
  const day = round.day;
  const n = GAS_MONTH_DAYS[st.month];
  const xs = Array.from({ length: GAS_YEAR_DAYS - CHART_FROM }, (_, i) => CHART_FROM + i + 0.5);
  const known = day - CHART_FROM;
  const temps = y.weather.temp.slice(CHART_FROM);
  const normals = xs.map((x) => y.weather.normal[Math.floor(x)]);
  const basisDays = y.days.slice(CHART_FROM).map((d) => d.price.metro - d.price.calder);
  const calderDays = y.days.slice(CHART_FROM).map((d) => d.price.calder);
  const monthXs = [day, day + n];
  const ensBasisDaily = Array.from({ length: n }, (_, i) => avg(f.members.map((m) => m.metroBasis[i])));
  const ensCalderDaily = Array.from({ length: n }, (_, i) => avg(f.members.map((m) => m.calder[i])));
  const aheadXs = Array.from({ length: n }, (_, i) => day + i + 0.5);
  const fcXs = fcTemps.map((_, i) => day + i + 0.5);
  // The market's curve for the rest of the year, as steps.
  const curveXs: number[] = [];
  const curveYs: number[] = [];
  for (let m = st.month; m < 12; m++) {
    curveXs.push(GAS_MONTH_START[m], m < 11 ? GAS_MONTH_START[m + 1] : GAS_YEAR_DAYS);
    curveYs.push(y.curves[st.month].calder[m], y.curves[st.month].calder[m]);
  }
  // Storage: known path, operators' plan, imagined winters, and (revealed) what happened.
  const sPastXs = Array.from({ length: day - CHART_FROM + 1 }, (_, i) => CHART_FROM + i);
  const sPast = sPastXs.map((x) => totalStorage(y.days[x - 1].storage));
  const sFutXs = [day, ...f.actual.storage.map((_, i) => day + i + 1)];
  const plan = y.plans[st.month];
  const planXs = Array.from({ length: 13 - st.month }, (_, k) => (st.month + k < 12 ? GAS_MONTH_START[st.month + k] : GAS_YEAR_DAYS));
  const planYs = planXs.map((_, k) => plan.totalInventory[k]);
  const ensEnd = f.members.map((m) => m.storage[m.storage.length - 1]);
  const BASIS_TOP = 4;
  const clipped = locked && Math.max(...basisDays.slice(known, known + n)) > BASIS_TOP;

  const status = best
    ? `Rounds revealed: ${scores.length}. Your best, Winter ${best.w + 1} on ${GAS_MONTHS[best.m]} 1, came closer than the market on ${word(best.score.beaten)} of three.`
    : 'Set your three forecasts for a round, then press Reveal.';

  // Second demonstration: every round.
  const tz = useScenario('forecast-tally', TALLY_DEFAULTS);
  const ts = tz.state;
  const tally = useMemo(() => roundTally(system, ts.skill), [system, ts.skill]);
  const tally0 = useMemo(() => roundTally(system, 0), [system]);
  const tallyDefault = useMemo(() => roundTally(system, TALLY_DEFAULTS.skill), [system]);
  const q = ts.question;
  const GAP = 3.6;
  const roundX = (w: number, i: number) => w * GAP + i;
  const tXs = tally.rounds.map((r) => roundX(r.winter, ROUND_MONTHS.indexOf(r.month)));
  const mMiss = tally.rounds.map((r) => Math.abs(r.market[q] - r.actual[q]));
  const eMiss = tally.rounds.map((r) => Math.abs(r.ensemble[q] - r.actual[q]));
  const tTop = q === 'storage' ? Math.max(20, Math.ceil(Math.max(...mMiss, ...eMiss) / 5) * 5) : q === 'basis' ? Math.max(1, Math.ceil(Math.max(...mMiss, ...eMiss))) : Math.max(0.5, Math.ceil(Math.max(...mMiss, ...eMiss) * 4) / 4);
  const winters = CHALLENGE_SEEDS.map((sd) => winterColder(systemYear(system, sd).weather));
  const coldest = winters.indexOf(Math.max(...winters));
  // The biggest miss of Metro's basis by the market, at the default skill.
  const bigBasis = tallyDefault.rounds.reduce((b, r) => (Math.abs(r.market.basis - r.actual.basis) > Math.abs(b.market.basis - b.actual.basis) ? r : b), tallyDefault.rounds[0]);
  const decembers = tallyDefault.rounds.filter((r) => r.month === 8);
  const decWins = decembers.filter((r) => Math.abs(r.ensemble.basis - r.actual.basis) < Math.abs(r.market.basis - r.actual.basis)).length;
  const sweeps = useMemo(() => ensembleSweeps(system, TALLY_DEFAULTS.skill), [system]);

  const netLink = (
    <a href={lessonHref('gas/7.1')}>
      {net.asBuilt ? 'the network as built' : `your network from Lesson 7.1`}
    </a>
  );

  return (
    <LessonPage id="gas/7.3">
      <P>
        <a href={lessonHref('gas/7.2')}>The previous lesson</a> ran your network through eight practice winters, every day of them in view. A trader never
        sees a winter that way. It arrives a day at a time, and every decision is made on a morning when the rest of it is still hidden. This lesson hides the
        winter. On the first of December, January or February of one of six winters you haven’t seen, with only what is known that morning, you forecast where the
        system will bind — whether the pipes into Metro will run full in the month ahead, what gas will cost at Calder, and how much will be left in storage at the
        end of March — and then compare your forecasts with the market’s.
      </P>
      <P>
        The network running is {netLink}
        {net.asBuilt
          ? ', the region’s six pipelines in Year 9'
          : `, with ${net.changed.length === 1 ? 'one change' : `${word(net.changed.length)} changes`} (${net.changed.join(', ')}) costing ${money(net.capital)} of capital`}
        ; change it there and every forecast here follows. The market’s forecasts are its prices, as in Chapter 6. On the first of each month it quotes that month’s
        gas at Calder and Metro’s <K c="price">basis</K> for the month, drawn from the storage operators’ plan for this network — normal weather from that morning
        on — and adjusted by the premiums it learned in Chapter 6’s history, where they were right on average (<a href={lessonHref('gas/6.2')}>Lesson 6.2</a>,{' '}
        <a href={lessonHref('gas/6.3')}>Lesson 6.3</a>). For the end of March, the market’s forecast is that plan itself: the operators expect to finish with the
        gas they plan to keep, usually the spring reserve of {bcf(RESERVE)}. Your tools are the ones of <a href={lessonHref('gas/6.1')}>Lesson 6.1</a>: a two-week
        weather forecast whose skill you choose, and {ROUND_MEMBERS} imagined winters run through this network from the gas actually in storage that morning.
      </P>
      <P>
        In the next demonstration, choose a winter and a forecast day. The upper chart is Metro’s <K tone="teal">temperature</K>, with the two-week forecast in teal;
        the middle ones are Metro’s basis and Calder’s price, with the market’s forecasts for the rest of the year in green and the imagined winters’ average in
        gold; the lower one is the gas in <K c="energy">storage</K>, with the operators’ plan and the imagined winters fanning out. Everything after the forecast day
        stays hidden. Set your three forecasts — they start at the market’s — and press Reveal; a revealed round is locked:
      </P>

      <Figure
        name="Gas Forecast Challenge"
        scenario={s}
        actions={
          <Button onClick={() => setCommitted({})} disabled={!Object.keys(committed).length}>
            Forget rounds
          </Button>
        }
      >
        <Segmented label="Winter" value={String(st.winter)} onChange={(v) => goTo(Number(v), st.month)} options={WINTER_OPTIONS} />
        <Segmented label="Forecast day" value={String(st.month)} onChange={(v) => goTo(st.winter, Number(v))} options={MONTH_OPTIONS} />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[-20, 80]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[-20, 0, 20, 40, 60, 80]}
          yFormat={(v) => `${v}°`}
          yLabel="Metro’s daily mean temperature, °F"
          height={140}
          bands={[{ from: day, to: day + fcTemps.length, color: 'rgba(42, 157, 144, 0.10)', label: 'forecast' }]}
          series={[
            { xs, ys: normals, color: NORMAL, width: 1.25, dash: '5 4' },
            { xs: xs.slice(0, known), ys: temps.slice(0, known), color: ACTUAL, width: 1.5 },
            ...(locked ? [{ xs: xs.slice(known), ys: temps.slice(known), color: ACTUAL, width: 1, dash: '3 3', opacity: 0.75 }] : []),
            { xs: fcXs, ys: fcTemps, color: WEATHER, width: 3 },
          ]}
          vLines={[{ at: day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          ariaLabel={`Metro’s temperature in winter ${st.winter + 1} up to ${gasDayLabel(day)}. The next ${fcTemps.length} days are forecast at ${fmt(round.fcTemp, 1)} °F against a normal ${fmt(round.normalTemp, 1)} °F${locked ? `; they came in at ${fmt(round.actTemp, 1)} °F` : ''}.`}
        />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[0, BASIS_TOP]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 1, 2, 3, 4]}
          yFormat={(v) => `$${v}`}
          yLabel="Metro’s basis to Calder, $/MMBtu"
          height={150}
          bands={[{ from: day, to: day + n, color: 'rgba(171, 112, 182, 0.08)', label: 'month ahead' }]}
          series={[
            { xs: xs.slice(0, known), ys: basisDays.slice(0, known), color: ACTUAL, width: 1.5 },
            ...(st.members ? f.members.map((m) => ({ xs: aheadXs, ys: m.metroBasis.slice(0, n), color: MEMBER, width: 0.75 })) : []),
            { xs: aheadXs, ys: ensBasisDaily, color: ENSEMBLE, width: 2 },
            { xs: monthXs, ys: [round.market.basis, round.market.basis], color: MARKET, width: 2.5, dash: '6 4' },
            { xs: monthXs, ys: [entry.basis, entry.basis], color: YOU, width: 3 },
            ...(locked
              ? [
                  { xs: xs.slice(known, known + n), ys: basisDays.slice(known, known + n), color: ACTUAL, width: 1.25, dash: '3 2' },
                  { xs: monthXs, ys: [round.actual.basis, round.actual.basis], color: ACTUAL, width: 2.5 },
                ]
              : []),
          ]}
          vLines={[{ at: day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          ariaLabel={`Metro’s basis up to ${gasDayLabel(day)}. For the month ahead the market quotes ${basis(round.market.basis)}, the imagined winters average ${basis(round.ensemble.basis)}, and your forecast is ${basis(entry.basis)}${locked ? `; it averaged ${basis(round.actual.basis)}` : ''}.`}
        />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[0, 10]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 2, 4, 6, 8, 10]}
          yFormat={(v) => `$${v}`}
          yLabel="Calder Hub, $/MMBtu"
          height={140}
          series={[
            { xs: xs.slice(0, known), ys: calderDays.slice(0, known), color: ACTUAL, width: 1.5 },
            { xs: curveXs, ys: curveYs, color: MARKET, width: 2, dash: '6 4' },
            { xs: aheadXs, ys: ensCalderDaily, color: ENSEMBLE, width: 2 },
            { xs: monthXs, ys: [entry.calder, entry.calder], color: YOU, width: 3 },
            ...(locked
              ? [
                  { xs: xs.slice(known), ys: calderDays.slice(known), color: ACTUAL, width: 1.25, dash: '3 2' },
                  { xs: monthXs, ys: [round.actual.calder, round.actual.calder], color: ACTUAL, width: 2.5 },
                ]
              : []),
          ]}
          vLines={[{ at: day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          ariaLabel={`Calder’s price up to ${gasDayLabel(day)}. For the month ahead the futures price is ${gp(round.market.calder)}, the imagined winters average ${gp(round.ensemble.calder)}, and your forecast is ${gp(entry.calder)}${locked ? `; it averaged ${gp(round.actual.calder)}` : ''}.`}
        />
        <XYChart
          xDomain={[CHART_FROM, GAS_YEAR_DAYS]}
          yDomain={[0, 160]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 40, 80, 120, 160]}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in storage, Bcf"
          height={170}
          series={[
            ...(st.members ? f.members.map((m) => ({ xs: sFutXs, ys: [round.storageNow, ...m.storage], color: MEMBER, width: 0.75 })) : []),
            { xs: sPastXs, ys: sPast, color: ENSEMBLE, width: 2.5 },
            { xs: planXs, ys: planYs, color: MARKET, width: 2, dash: '6 4' },
            ...(locked ? [{ xs: sFutXs, ys: [round.storageNow, ...f.actual.storage], color: ACTUAL, width: 1.5, dash: '5 3' }] : []),
          ]}
          hLines={[{ at: RESERVE, color: '#8a8a8a', dash: '2 4', width: 1, label: `spring reserve ${fmt(RESERVE, 1)} Bcf`, labelAt: 'start' }]}
          vLines={[{ at: day, color: TEXT.teal, dash: '2 3', width: 1 }]}
          markers={[
            { x: GAS_YEAR_DAYS, y: entry.storage, color: YOU, r: 4.5 },
            ...(locked ? [{ x: GAS_YEAR_DAYS, y: round.actual.storage, color: ACTUAL, r: 4.5, ring: true }] : []),
          ]}
          ariaLabel={`Working gas: ${fmt(round.storageNow, 1)} Bcf on ${gasDayLabel(day)}. The operators plan to end March with ${fmt(round.market.storage, 1)} Bcf, the imagined winters with ${fmt(Math.min(...ensEnd), 1)} to ${fmt(Math.max(...ensEnd), 1)}, ${fmt(round.ensemble.storage, 1)} on average; your forecast is ${fmt(entry.storage, 1)}${locked ? `; ${fmt(round.actual.storage, 1)} remained` : ''}.`}
        >
          {(x, yy) => (
            <line x1={x(GAS_YEAR_DAYS) - 3} x2={x(GAS_YEAR_DAYS) - 3} y1={yy(Math.min(...ensEnd))} y2={yy(Math.max(...ensEnd))} stroke={TEXT.gold} strokeWidth={3} opacity={0.6} />
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'weather forecast', color: WEATHER, kind: 'line' },
            { label: 'the market', color: MARKET, kind: 'line', dashed: true },
            { label: 'imagined winters’ average', color: ENSEMBLE, kind: 'line' },
            { label: 'your forecast', color: YOU, kind: 'line' },
            { label: locked ? 'what happened' : 'what happened (after Reveal)', color: ACTUAL, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `next ${fcTemps.length} days, forecast (normal ${fmt(round.normalTemp, 1)} °F)`, value: `${fmt(round.fcTemp, 1)} °F`, tone: 'teal' },
            { label: `in storage on ${gasDayLabel(day)}`, value: bcf(round.storageNow), tone: 'gold' },
            {
              label: `days Metro’s pipes run full in ${GAS_MONTH_NAMES[st.month]}: imagined${locked ? ' · happened' : ''}`,
              value: `${fmt(round.ensemble.fullDays, 1)}${locked ? ` · ${round.actual.fullDays}` : ''}`,
              tone: 'orange',
            },
          ]}
        />
        <Slider
          label={`Your forecast: ${QUESTION_LABEL.basis}`}
          tone="green"
          value={entry.basis}
          min={0}
          max={4}
          step={ENTRY_STEPS.basis}
          disabled={!!locked}
          onChange={(v) => s.set({ basis: round2(snap(v, ENTRY_STEPS.basis)) })}
          display={`${basis(entry.basis)} (market ${basis(mkt.basis)})`}
        />
        <Slider
          label={`Your forecast: ${QUESTION_LABEL.calder}`}
          tone="green"
          value={entry.calder}
          min={2}
          max={10}
          step={ENTRY_STEPS.calder}
          disabled={!!locked}
          onChange={(v) => s.set({ calder: round2(snap(v, ENTRY_STEPS.calder)) })}
          display={`${gp(entry.calder)} (market ${gp(mkt.calder)})`}
        />
        <Slider
          label={`Your forecast: ${QUESTION_LABEL.storage}`}
          tone="gold"
          value={entry.storage}
          min={0}
          max={90}
          step={ENTRY_STEPS.storage}
          disabled={!!locked}
          onChange={(v) => s.set({ storage: snap(v, ENTRY_STEPS.storage) })}
          display={`${bcf(entry.storage)} (plan ${bcf(mkt.storage)})`}
        />
        <Slider
          label="Weather forecast skill"
          tone="teal"
          value={st.skill}
          min={0}
          max={1}
          step={SKILL_STEP}
          onChange={(v) => s.set({ skill: round2(snap(v, SKILL_STEP)) })}
          display={st.skill === 0 ? 'none: normal weather' : `${fmt(st.skill, 1)} · ${fmt(forecastSkill(st.skill, 7), 2)} a week out`}
        />
        <Checkbox label="Show the imagined winters" checked={st.members} onChange={(v) => s.set({ members: v })} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <Button primary onClick={() => setCommitted((c) => ({ ...c, [key]: { ...entry } }))} disabled={!!locked}>
            {locked ? 'Revealed' : 'Reveal'}
          </Button>
          <span style={{ fontSize: 13, color: TEXT.gray }}>
            {locked ? `Locked: Winter ${st.winter + 1}, ${GAS_MONTH_NAMES[st.month]} 1. Choose another round to play on.` : 'Your forecasts are committed when you press Reveal.'}
          </span>
        </div>
        {locked && score && (
          <DataTable
            columns={[
              { label: 'Forecast', cell: (r: Question) => SHORT_LABEL[r] },
              { label: 'You', cell: (r: Question) => fmtQ(r, locked[r]), align: 'right' },
              { label: 'Market', cell: (r: Question) => fmtQ(r, mkt[r]), align: 'right' },
              { label: 'Imagined', cell: (r: Question) => fmtQ(r, round.ensemble[r]), align: 'right' },
              { label: 'Happened', cell: (r: Question) => fmtQ(r, round.actual[r]), align: 'right' },
            ]}
            rows={QUESTIONS}
            rowKey={(r) => r}
            rowClass={(r) => (score.beat[r] ? 'hl' : '')}
          />
        )}
        <Caption>
          {locked
            ? `Winter ${st.winter + 1}, ${GAS_MONTH_NAMES[st.month]} 1: you came closer than the market on ${score!.beaten === 0 ? 'none' : word(score!.beaten)} of the three forecasts${score!.beaten ? ' (highlighted)' : ''}.${clipped ? ` Metro’s basis went off the chart’s top at ${basis(Math.max(...basisDays.slice(known, known + n)))}.` : ''} The winter turned out ${fmt(Math.abs(winterColder(y.weather)))} degree days ${winterColder(y.weather) >= 0 ? 'colder' : 'warmer'} than normal.`
            : `Winter ${st.winter + 1}, ${GAS_MONTH_NAMES[st.month]} 1, with ${fmt(round.storageNow, 1)} Bcf in storage. The market quotes ${basis(round.market.basis)} for Metro’s basis and ${gp(round.market.calder)} at Calder for ${GAS_MONTH_NAMES[st.month]}, and its operators plan to end March with ${fmt(round.market.storage, 1)} Bcf; the imagined winters average ${basis(round.ensemble.basis)}, ${gp(round.ensemble.calder)} and ${fmt(round.ensemble.storage, 1)} Bcf.`}
        </Caption>
      </Figure>

      <P>
        The demonstration opens on January 1 of the first hidden winter, with {bcf(open.storageNow)} in storage. For January the market quotes Metro’s basis at{' '}
        {basis(open.market.basis)}: the trip on Northline, {gp(lineTariff('calder-metro'))}, plus the premium the market charges for the chance that Metro’s pipes
        run out. Its futures price for Calder is {gp(open.market.calder)}, and its operators plan to end March with {bcf(open.market.storage)}. The weather forecast
        expects the next two weeks at {fmt(open.fcTemp, 1)} °F against a normal {fmt(open.normalTemp, 1)} °F, and the imagined winters average{' '}
        {basis(open.ensemble.basis)}, {gp(open.ensemble.calder)} and {bcf(open.ensemble.storage)}; {openMembersFull === ROUND_MEMBERS ? `all ${word(ROUND_MEMBERS)}` : `${word(openMembersFull)} of the ${ROUND_MEMBERS}`} see Metro’s pipes
        run full on at least one January day. None of that says what will happen. It says what the market and the imagined winters each expect, and how far apart they
        are.
      </P>
      <P>
        Read each forecast for what it is. Metro’s basis sits at the cost of the trip on most days and leaves it only when the pipes into the city are full, so its
        average for a month is the trip plus a few days of breakaway, if any (<a href={lessonHref('gas/4.2')}>Lesson 4.2</a>). A forecast of the basis is a forecast of
        those days. Calder’s month moves with the weather the two-week forecast can partly see and the weather after it, which no one can. And the end of March is
        five months of weather away from December, a long way from February (<a href={lessonHref('gas/6.1')}>Lesson 6.1</a>): the imagined winters’ range
        is your honest answer there, and their average is only its middle.
      </P>

      <Challenge
        id="a"
        figure="Gas Forecast Challenge"
        question="In a single round, come closer than the market on all three forecasts."
        solved={solved}
        status={status}
        success={`Solved: in Winter ${(scores.find((x) => x.score.beaten === 3)?.w ?? 0) + 1} on ${GAS_MONTHS[scores.find((x) => x.score.beaten === 3)?.m ?? 9]} 1 you beat the market on all three. One round is one draw of the weather, and a good forecast can lose it while a lucky one wins; whether your method beats the market is a question for many rounds, which the next demonstration asks of the imagined winters.`}
      />

      <H2>Every round</H2>
      <P>
        Playing rounds one at a time, it is hard to tell judgment from luck. The fair test is the one of <a href={lessonHref('gas/6.5')}>Lesson 6.5</a>: one rule,
        applied the same way to every round, scored on all of them. In the next demonstration the rule is to forecast the imagined winters’ average every time, on
        all {word(CHALLENGE_SEEDS.length * ROUND_MONTHS.length)} rounds of the six hidden winters; it gives the game away, so play a few rounds first. Each pair of
        dots is one round: how far the market’s forecast missed, in green, and how far the imagined winters missed, in gold. The rounds are grouped by winter,
        December to February, with each winter’s degree days colder (+) or warmer (−) than normal over it. Choose the forecast and the weather forecast’s skill:
      </P>

      <Figure name="Gas Forecast Challenge · every round" scenario={tz}>
        <Segmented
          label="Forecast"
          value={q}
          onChange={(v) => tz.set({ question: v as Question })}
          options={QUESTIONS.map((x) => ({ value: x, label: x === 'basis' ? 'Metro’s basis' : x === 'calder' ? 'Calder' : 'March 31 storage' }))}
        />
        <XYChart
          xDomain={[-0.7, (CHALLENGE_SEEDS.length - 1) * GAP + 2.7]}
          yDomain={[0, tTop]}
          xTicks={CHALLENGE_SEEDS.map((_, w) => roundX(w, 1))}
          xFormat={(v) => `Winter ${Math.round((v - 1) / GAP) + 1}`}
          yFormat={(v) => (q === 'storage' ? fmt(v) : `$${fmt(v, q === 'basis' ? 1 : 2)}`)}
          yLabel={q === 'storage' ? 'Miss on March 31, Bcf' : 'Miss on the month’s average, $/MMBtu'}
          height={260}
          series={[
            { xs: tXs, ys: mMiss, color: MARKET, kind: 'points', r: 4.5 },
            { xs: tXs, ys: eMiss, color: ENSEMBLE, kind: 'points', r: 4.5 },
          ]}
          ariaLabel={`How far each forecast missed, for ${QUESTION_LABEL[q].toLowerCase()}, in the ${tally.rounds.length} rounds of the six hidden winters. The imagined winters came closer than the market in ${tally.wins[q]} of them; on average the market missed by ${fmtMiss(q, tally.marketMiss[q])} and the imagined winters by ${fmtMiss(q, tally.ensembleMiss[q])}.`}
        >
          {(x, yy) => (
            <g>
              {tally.rounds.map((_, i) => (
                <line key={i} x1={x(tXs[i])} x2={x(tXs[i])} y1={yy(mMiss[i])} y2={yy(eMiss[i])} stroke="#b5b5b5" strokeWidth={1} />
              ))}
              {CHALLENGE_SEEDS.map((_, w) => (
                <text key={w} x={x(roundX(w, 1))} y={yy(tTop) + 12} textAnchor="middle" fontSize={11} fill={TEXT.teal}>
                  {signed(winters[w])}
                </text>
              ))}
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'the market’s miss', color: MARKET },
            { label: 'the imagined winters’ miss', color: ENSEMBLE },
          ]}
        />
        <Readouts
          items={[
            { label: `rounds the imagined winters came closer`, value: `${tally.wins[q]} of ${tally.rounds.length}`, tone: 'gold' },
            { label: 'the market’s average miss', value: fmtMiss(q, tally.marketMiss[q]), tone: 'green' },
            { label: 'the imagined winters’ average miss', value: fmtMiss(q, tally.ensembleMiss[q]), tone: 'gold' },
          ]}
        />
        <Slider
          label="Weather forecast skill"
          tone="teal"
          value={ts.skill}
          min={0}
          max={1}
          step={SKILL_STEP}
          onChange={(v) => tz.set({ skill: round2(snap(v, SKILL_STEP)) })}
          display={ts.skill === 0 ? 'none: normal weather' : fmt(ts.skill, 1)}
        />
        <Caption>
          With skill {fmt(ts.skill, 1)}, the imagined winters came closer than the market on {QUESTION_LABEL[q].toLowerCase()} in {tally.wins[q]} of the{' '}
          {tally.rounds.length} rounds; without a weather forecast, in {tally0.wins[q]}.
        </Caption>
      </Figure>

      <P>
        On this network, with skill {fmt(TALLY_DEFAULTS.skill, 1)}, the imagined winters came closer than the market on Metro’s basis in {tallyDefault.wins.basis} of
        the {tallyDefault.rounds.length} rounds, on Calder’s month in {tallyDefault.wins.calder} and on the end of March in {tallyDefault.wins.storage}. Their average
        misses were {gp(tallyDefault.ensembleMiss.basis)} against the market’s {gp(tallyDefault.marketMiss.basis)} for the basis,{' '}
        {gp(tallyDefault.ensembleMiss.calder)} against {gp(tallyDefault.marketMiss.calder)} for Calder, and {bcf(tallyDefault.ensembleMiss.storage)} against{' '}
        {bcf(tallyDefault.marketMiss.storage)} for storage. Turn the skill to none and the Calder rounds won{' '}
        {tally0.wins.calder < tallyDefault.wins.calder ? 'fall' : tally0.wins.calder === tallyDefault.wins.calder ? 'stay' : 'rise'}{' '}
        {tally0.wins.calder === tallyDefault.wins.calder ? 'at' : 'to'} {tally0.wins.calder}
        {tally0.wins.calder < tallyDefault.wins.calder
          ? ': what the imagined winters know about Calder’s month is mostly the next two weeks of weather, the edge of Lesson 6.1 and one the market of Chapter 6 doesn’t use.'
          : ': on this network the next two weeks of weather add little to a forecast of Calder’s month.'}{' '}
        The end of March hardly notices the skill — {tally0.wins.storage} rounds without it — because two weeks are a small part of what is left of a winter.
      </P>
      <P>
        The basis is the constraint itself. In {decWins === 6 ? 'all six' : `${word(decWins)} of the six`} Decembers the imagined winters came closer than the market, which charged the premium it
        learned from Chapter 6’s history for breakaways that a December seldom brings.{' '}
        {bigBasis.actual.basis > bigBasis.market.basis ? (
          <>
            But the month that mattered most, neither saw coming. In {GAS_MONTH_NAMES[bigBasis.month]} of Winter {bigBasis.winter + 1}, Metro’s basis averaged{' '}
            {basis(bigBasis.actual.basis)}, against {basis(bigBasis.market.basis)} from the market and {basis(bigBasis.ensemble.basis)} from the imagined winters:
            the cold that filled the pipes arrived after the weather forecast ran out. The constraint a trader most wants to forecast is the one that binds beyond
            the forecast’s reach.
          </>
        ) : (
          <>
            On this network the market’s biggest miss ran the other way. In {GAS_MONTH_NAMES[bigBasis.month]} of Winter {bigBasis.winter + 1} it charged{' '}
            {basis(bigBasis.market.basis)} for a basis that averaged {basis(bigBasis.actual.basis)}: a premium learned on a network whose pipes into Metro ran out
            more often than yours.
          </>
        )}
      </P>
      <P>
        Entering the imagined winters’ averages every time would have beaten the market on all three forecasts in {word(sweeps.length)} of the{' '}
        {tallyDefault.rounds.length} rounds
        {sweeps.every((r) => r.winter !== coldest) ? `, none of them in Winter ${coldest + 1}, the coldest` : ''}. That is what forecasting constraints amounts to:
        an edge on average, made of many small wins in calm months and a few large misses in the months when the system binds hardest. A forecast like that can’t be
        traded as if it were certain. It has to be traded so that the misses can be survived — with storage hedged, with firm capacity held as insurance against
        the breakaways, and with the forecast standing guard over any basis sold, a guard that{' '}
        <FigRef to="Gas Forecast Challenge">the first demonstration</FigRef> showed can see two weeks and no further. Putting those positions together on your
        network is the work of <a href={lessonHref('gas/7.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
