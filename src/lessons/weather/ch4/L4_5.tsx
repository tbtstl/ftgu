import { useMemo } from 'react';
import {
  Caption,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import {
  WIND_PPA,
  farmYears,
  regress,
  summarize,
  utilityDollarsPerHdd,
  utilityWinters,
  windYears,
  type FarmYear,
  type Summary,
  type UtilityWinter,
  type WindYear,
} from '../../../engines/weather/exposure';
import { CITY_WIND_SHARE, UTILITY, monthIndex } from '../../../engines/weather/degreeDays';
import { FARM, yieldHistory } from '../../../engines/weather/crops';
import { archive, monthDays } from '../../../model/weather/archive';
import { CALDER, MARLOW, STATIONS } from '../../../model/weather/region';
import { RIDGE_MW } from '../../../engines/weather/renewables';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The three businesses' seasons, cached by the physical knobs that shape them.

export type Business = 'utility' | 'farm' | 'wind';

export interface RiskState {
  business: Business;
  /** Multiplies the day-to-day temperature variability (utility and farm). */
  variability: number;
  /** Calder Bay's winter warming per °C of Niño-3.4, °F (utility). */
  ensoF: number;
  /** The Marlow region's share of the national corn crop (farm). */
  share: number;
  /** Multiplies every day's wind on Hollin Ridge (wind farm). */
  windScale: number;
}

export const RISK_DEFAULTS: RiskState = { business: 'utility', variability: 1, ensoF: STATIONS.calder.ensoF ?? 1, share: 0.02, windScale: 1 };
export const VARIABILITY_STEP = 0.05;

const utilCache = new Map<string, UtilityWinter[]>();
const farmCache = new Map<string, FarmYear[]>();
const windCache = new Map<string, WindYear[]>();

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let v = cache.get(key);
  if (!v) {
    if (cache.size > 200) cache.clear();
    v = make();
    cache.set(key, v);
  }
  return v;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function utilityRun(variability: number, ensoF: number): UtilityWinter[] {
  return cached(utilCache, `${r2(variability)}|${r2(ensoF)}`, () => utilityWinters({ variability: r2(variability), ensoF: r2(ensoF) }));
}

export function farmRun(variability: number, share: number): FarmYear[] {
  return cached(farmCache, `${r2(variability)}|${r2(share)}`, () => farmYears(r2(share), { variability: r2(variability) }));
}

export function windRun(windScale: number): WindYear[] {
  return cached(windCache, `${r2(windScale)}`, () => windYears({ windScale: r2(windScale) }));
}

export interface Risk {
  /** One outcome per season: winter margin, farm profit or wind revenue, $. */
  values: number[];
  /** Number of the first season (winters and years both start at 1). */
  summary: Summary;
  /** The budget: the average season. */
  budget: number;
  /** How far the 1-in-20 bad season (the 5th percentile) falls short of budget, $. */
  shortfall: number;
  /** How far the worst season falls short of budget, $. */
  worst: number;
  /** Index (0-based) of the worst season. */
  worstIndex: number;
}

export function riskOf(st: RiskState): Risk {
  const values =
    st.business === 'utility'
      ? utilityRun(st.variability, st.ensoF).map((w) => w.margin)
      : st.business === 'farm'
        ? farmRun(st.variability, st.share).map((f) => f.profit)
        : windRun(st.windScale).map((w) => w.revenue);
  const summary = summarize(values);
  let worstIndex = 0;
  values.forEach((v, i) => {
    if (v < values[worstIndex]) worstIndex = i;
  });
  return { values, summary, budget: summary.mean, shortfall: summary.mean - summary.p5, worst: summary.mean - summary.min, worstIndex };
}

/** The first challenge's line: a 1-in-20 winter that falls more than $25 million short. */
export const SHORTFALL_TARGET = 25_000_000;

function utilityShortfall(variability: number, ensoF: number): number {
  return riskOf({ ...RISK_DEFAULTS, business: 'utility', variability, ensoF }).shortfall;
}

/**
 * The first challenge: with ENSO's pull left at Calder Bay's own, the smallest variability on the
 * slider's steps at which the utility's 1-in-20 winter falls more than $25 million short.
 */
export function variabilitySolved(st: RiskState): boolean {
  if (st.business !== 'utility' || Math.abs(st.ensoF - RISK_DEFAULTS.ensoF) > 1e-9) return false;
  const lower = r2(st.variability - VARIABILITY_STEP);
  return utilityShortfall(st.variability, st.ensoF) > SHORTFALL_TARGET && (lower < 0.5 - 1e-9 || utilityShortfall(lower, st.ensoF) <= SHORTFALL_TARGET);
}

// ---------------------------------------------------------------------------
// The second demonstration: each season's cash flow against a weather index.

export type FarmIndex = 'calderCdd' | 'rain' | 'heat';

export interface IndexState {
  business: Business;
  farmIndex: FarmIndex;
}

export const INDEX_DEFAULTS: IndexState = { business: 'utility', farmIndex: 'calderCdd' };

export interface IndexFit {
  x: number[];
  y: number[];
  slope: number;
  intercept: number;
  r2: number;
  /** Standard deviation of the cash flow, and of what's left after the index's fit, $. */
  sd: number;
  residualSd: number;
  /** Text for the index and its unit. */
  index: string;
  unit: string;
  /** Text for the cash flow. */
  outcome: string;
}

const fitCache = new Map<string, IndexFit>();

/** Mean of the city's wind over winter y (November–March), m/s. */
export function winterCityWind(y: number): number {
  const a = archive();
  let t = 0;
  let n = 0;
  for (const [dy, m] of [
    [0, 10],
    [0, 11],
    [1, 0],
    [1, 1],
    [1, 2],
  ]) {
    const { start, days } = monthDays(y + dy, m);
    for (let i = 0; i < days; i++) {
      t += CITY_WIND_SHARE * a.wind[start + i];
      n++;
    }
  }
  return t / n;
}

/** Each season's cash flow against the chosen index, with the least-squares fit. */
export function indexFit(st: IndexState): IndexFit {
  const key = st.business === 'farm' ? `farm|${st.farmIndex}` : st.business;
  const hit = fitCache.get(key);
  if (hit) return hit;
  let x: number[];
  let y: number[];
  let index: string;
  let unit: string;
  let outcome: string;
  if (st.business === 'utility') {
    const w = utilityRun(1, RISK_DEFAULTS.ensoF);
    x = w.map((v) => v.hdd);
    y = w.map((v) => v.margin);
    index = 'Calder Bay heating degree days, November–March';
    unit = 'HDD';
    outcome = 'winter margin';
  } else if (st.business === 'wind') {
    const a = archive();
    const w = windRun(1);
    x = w.map((v) => {
      let s = 0;
      for (let i = 0; i < 365; i++) s += a.wind[(v.year - 1) * 365 + i];
      return s / 365;
    });
    y = w.map((v) => v.revenue);
    index = 'Hollin Ridge’s average wind speed for the year';
    unit = 'm/s';
    outcome = 'revenue';
  } else {
    const f = farmRun(1, RISK_DEFAULTS.share);
    const yh = yieldHistory();
    y = f.map((v) => v.profit);
    if (st.farmIndex === 'calderCdd') {
      x = yh.map((v) => monthIndex('CDD', v.year, 6) + monthIndex('CDD', v.year, 7));
      index = 'Calder Bay cooling degree days, July–August';
      unit = 'CDD';
    } else if (st.farmIndex === 'rain') {
      x = yh.map((v) => v.rainIn);
      index = 'Marlow’s rain, June–August';
      unit = 'inch';
    } else {
      x = yh.map((v) => v.heatDD);
      index = 'Marlow’s heat degree days above 86 °F, July–August';
      unit = 'degree day';
    }
    outcome = 'profit';
  }
  const fit = regress(x, y);
  const sd = summarize(y).sd;
  const out: IndexFit = { x, y, ...fit, sd, residualSd: sd * Math.sqrt(Math.max(0, 1 - fit.r2)), index, unit, outcome };
  fitCache.set(key, out);
  return out;
}

/** The second challenge: the index that explains the most of the Marlow farm's profit. */
export function bestIndexSolved(st: IndexState): boolean {
  if (st.business !== 'farm') return false;
  const all: FarmIndex[] = ['calderCdd', 'rain', 'heat'];
  const best = all.reduce((a, b) => (indexFit({ business: 'farm', farmIndex: b }).r2 > indexFit({ business: 'farm', farmIndex: a }).r2 ? b : a));
  return st.farmIndex === best;
}

// ---------------------------------------------------------------------------
// Drawing.

/** Dollars per unit of an index: in millions when large, otherwise whole dollars. */
export function perUnit(x: number): string {
  return Math.abs(x) >= 1e6 ? money(x, true) : usd(x);
}

/** Dollars, in millions or thousands: "$292.6M", "−$18.5M", "$70k". */
export function money(x: number, big = Math.abs(x) >= 1e6): string {
  return big ? `${usd(x / 1e6, 1)}M` : `${usd(x / 1e3)}k`;
}

function ordinal(n: number): string {
  return n === 1 ? '' : n === 2 ? 'second' : n === 3 ? 'third' : n === 4 ? 'fourth' : n === 5 ? 'fifth' : `${n}th`;
}

const BUSINESS_LABEL: Record<Business, string> = {
  utility: 'Calder Gas & Light',
  farm: 'the Marlow corn farm',
  wind: 'the Hollin Ridge wind farm',
};

const SEASON_WORD: Record<Business, string> = { utility: 'winter', farm: 'year', wind: 'year' };

function SeasonBars({ risk, business }: { risk: Risk; business: Business }) {
  const big = business !== 'farm';
  const devs = risk.values.map((v) => v - risk.budget);
  const [lo, hi] = niceDomain(Math.min(...devs, -risk.shortfall), Math.max(...devs, 1), 4);
  const n = devs.length;
  const X0 = 74;
  const X1 = 620;
  const x = scale(0, n, X0, X1);
  const y = scale(lo, hi, 222, 24);
  const bw = (X1 - X0) / n;
  const label = `${BUSINESS_LABEL[business]} in each of the archive’s ${n} ${SEASON_WORD[business]}s, against its average of ${money(risk.budget, big)}: the standard deviation is ${money(risk.summary.sd, big)}, the 1-in-20 bad ${SEASON_WORD[business]} falls ${money(risk.shortfall, big)} short, and the worst, ${SEASON_WORD[business]} ${risk.worstIndex + 1}, ${money(risk.worst, big)} short.`;
  return (
    <svg className="chart" viewBox="0 0 640 262" role="img" aria-label={label}>
      <text className="ax" x={X0} y={12}>
        Above or below the average {SEASON_WORD[business]}
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(v) => (v === 0 ? 'average' : money(v, big))} baseline={0} />
      {devs.map((d, i) => (
        <rect
          key={i}
          x={x(i) + bw * 0.15}
          y={Math.min(y(0), y(d))}
          width={bw * 0.7}
          height={Math.max(1, Math.abs(y(d) - y(0)))}
          fill={d >= 0 ? GRAPHIC.green : GRAPHIC.red}
          opacity={i === risk.worstIndex ? 0.95 : 0.6}
        />
      ))}
      <line x1={X0} x2={X1} y1={y(-risk.shortfall)} y2={y(-risk.shortfall)} stroke={TEXT.red} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={X1} y={y(-risk.shortfall) + 15} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.red }}>
        1 in 20 {SEASON_WORD[business]}s falls this short
      </text>
      {[1, 10, 20, 30, 40].map((s) => (
        <text key={s} className="ax ax-m" x={x(s - 0.5)} y={240}>
          {s}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={256}>
        {SEASON_WORD[business]} of the simulated archive
      </text>
    </svg>
  );
}

function IndexScatter({ fit, business }: { fit: IndexFit; business: Business }) {
  const big = business !== 'farm';
  const [x0, x1] = niceDomain(Math.min(...fit.x), Math.max(...fit.x), 5);
  const [y0, y1] = niceDomain(Math.min(...fit.y), Math.max(...fit.y), 4);
  const X0 = 80;
  const X1 = 620;
  const x = scale(x0, x1, X0, X1);
  const y = scale(y0, y1, 236, 24);
  const line = (v: number) => fit.intercept + fit.slope * v;
  const tone = business === 'utility' ? GRAPHIC.orange : business === 'farm' ? GRAPHIC.red : GRAPHIC.violet;
  const xDigits = x1 - x0 < 5 ? 1 : 0;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 286"
      role="img"
      aria-label={`${BUSINESS_LABEL[business]}’s ${fit.outcome} in each season against ${fit.index}. The fitted line has a slope of ${perUnit(fit.slope)} per ${fit.unit} and explains ${pct(fit.r2)} of the variation; what it leaves unexplained has a standard deviation of ${money(fit.residualSd, big)}.`}
    >
      <text className="ax" x={X0} y={12}>
        {fit.outcome[0].toUpperCase() + fit.outcome.slice(1)}
      </text>
      <GridY y={y} ticks={niceTicks(y0, y1, 4)} x0={X0} x1={X1} format={(v) => money(v, big)} />
      {fit.x.map((v, i) => (
        <line key={`r${i}`} x1={x(v)} x2={x(v)} y1={y(fit.y[i])} y2={y(line(v))} stroke="#9a9a9a" strokeWidth={1} />
      ))}
      <path d={linePath([x(x0), x(x1)], [y(line(x0)), y(line(x1))])} fill="none" stroke="#333" strokeWidth={2} />
      {fit.x.map((v, i) => (
        <circle key={i} cx={x(v)} cy={y(fit.y[i])} r={4.5} fill={tone} opacity={0.8} stroke="#fcfcfb" strokeWidth={1} />
      ))}
      {niceTicks(x0, x1, 5).map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={256}>
          {fmt(t, xDigits)}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={276}>
        {fit.index}
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('risk', RISK_DEFAULTS);
  const st = s.state;
  const risk = useMemo(() => riskOf(st), [st]);
  const big = st.business !== 'farm';
  const solved = useMemo(() => variabilitySolved(st), [st]);

  const ix = useScenario('index', INDEX_DEFAULTS);
  const fit = useMemo(() => indexFit(ix.state), [ix.state]);
  const solved2 = bestIndexSolved(ix.state);

  // Numbers the prose quotes, with the region's own physics.
  const q = useMemo(() => {
    const utilWinters = utilityRun(1, RISK_DEFAULTS.ensoF);
    const util = riskOf({ ...RISK_DEFAULTS, business: 'utility' });
    const farm = riskOf({ ...RISK_DEFAULTS, business: 'farm' });
    const farmBig = riskOf({ ...RISK_DEFAULTS, business: 'farm', share: 0.4 });
    const wind = riskOf({ ...RISK_DEFAULTS, business: 'wind' });
    const hddMean = utilWinters.reduce((a, w) => a + w.hdd, 0) / utilWinters.length;
    const warmest = utilWinters.reduce((a, b) => (b.hdd < a.hdd ? b : a));
    const worstW = utilWinters[util.worstIndex];
    const winterWinds = utilWinters.map((w) => winterCityWind(w.winter));
    const avgWinterWind = winterWinds.reduce((a, v) => a + v, 0) / winterWinds.length;
    const fitU = indexFit({ business: 'utility', farmIndex: 'heat' });
    const fitW = indexFit({ business: 'wind', farmIndex: 'heat' });
    const fitCdd = indexFit({ business: 'farm', farmIndex: 'calderCdd' });
    const fitRain = indexFit({ business: 'farm', farmIndex: 'rain' });
    const fitHeat = indexFit({ business: 'farm', farmIndex: 'heat' });
    const doubled = riskOf({ ...RISK_DEFAULTS, business: 'utility', ensoF: 3 });
    const worstRank = [...utilWinters].sort((a, b) => a.hdd - b.hdd).findIndex((w) => w.winter === worstW.winter) + 1;
    return { worstRank, util, farm, farmBig, wind, hddMean, warmest, worstW, avgWinterWind, winterWinds, fitU, fitW, fitCdd, fitRain, fitHeat, doubled };
  }, []);

  const perHdd = utilityDollarsPerHdd();
  const shortNow = risk.shortfall;

  const caption =
    st.business === 'utility'
      ? `Calder Gas & Light earns $${UTILITY.margin} on every MMBtu it delivers, and each heating degree day adds ${fmt(UTILITY.perHdd)} MMBtu, so each degree day is worth about ${usd(perHdd)} of margin. Its average winter earns ${money(risk.budget)}.`
      : st.business === 'farm'
        ? `The farm grows ${fmt(FARM.acres)} acres of corn at ${usd(FARM.costPerAcre)} an acre. In an average year it earns ${money(risk.budget, false)}; with the region at ${pct(st.share)} of the national crop, its worst year ${risk.summary.min < 0 ? `loses ${money(-risk.summary.min, false)}` : `still earns ${money(risk.summary.min, false)}`}.`
        : `Hollin Ridge’s ${RIDGE_MW} MW sell every megawatt-hour at a contracted $${WIND_PPA}. With the wind at ${fmt(st.windScale * 100)}% of the archive’s, its average year earns ${money(risk.budget)}.`;

  return (
    <LessonPage id="weather/4.5">
      <P>
        The last four lessons followed the weather into the region’s economy one link at a time: degree days into gas sendout
        (<a href={lessonHref('weather/4.1')}>Lesson 4.1</a>), cold snaps and heat waves into energy prices (<a href={lessonHref('weather/4.2')}>4.2</a>), heat and
        drought into corn (<a href={lessonHref('weather/4.3')}>4.3</a>), wind into megawatt-hours (<a href={lessonHref('weather/4.4')}>4.4</a>). This lesson adds it
        up the way a finance department would: in dollars, season by season, against a budget.
      </P>
      <P>
        Weather can hurt a business through prices or through quantities. A utility that has to buy gas at short notice in a cold snap pays the spiking city-gate
        prices of Lesson 4.2 — <b>price risk</b>, the cold snap in the first sentence of this course. But many US gas utilities pass the cost of the gas itself
        straight through to their customers. What they keep is a <K tone={WX.money}>margin</K> on every unit they deliver, and the weather decides how many units
        that is. That is <b>volume risk</b>, and it runs the other way: a mild winter is the expensive one, the other half of that first sentence. The Hollin Ridge
        wind farm is in the same position, selling every megawatt-hour at a contracted ${WIND_PPA} while the wind decides how many it has to sell, and so is the Marlow farm,
        whose costs are fixed in spring while the summer decides the harvest.
      </P>
      <P>
        Each of them plans on a normal season. A warm winter doesn’t look like a disaster from inside a utility; it looks like a shortfall against budget, explained
        in the annual report by the weather. In the next demonstration, choose a business. Each bar is one season of the course’s simulated archive — a winter,
        November to March, for the utility; a year for the farms — drawn as how far that season’s cash came in above or below the average season, which serves as
        the budget. The dashed line marks the <K tone={WX.money}>1-in-20 bad season</K>, the fifth percentile. The sliders change the physics underneath: how
        variable the weather is, how hard ENSO tilts the winter, how much wind blows, how much of the nation’s corn grows around Marlow. All of it is simulated,
        the businesses included:
      </P>

      <Figure name="Weather Risk Calculator" scenario={s}>
        <Segmented
          label="Business"
          value={st.business}
          onChange={(v) => s.set({ business: v })}
          options={[
            { value: 'utility', label: 'Calder Gas & Light' },
            { value: 'farm', label: 'Marlow corn farm' },
            { value: 'wind', label: 'Hollin Ridge wind farm' },
          ]}
        />
        <SeasonBars risk={risk} business={st.business} />
        <Legend
          items={[
            { label: 'Above average', color: GRAPHIC.green },
            { label: 'Below average', color: GRAPHIC.red },
            { label: '1-in-20 bad season', color: TEXT.red, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `average ${SEASON_WORD[st.business]}, the budget`, value: money(risk.budget, big), tone: WX.money },
            { label: 'standard deviation', value: money(risk.summary.sd, big), tone: WX.money },
            { label: '1-in-20 bad season', value: money(-risk.shortfall, big), tone: 'red' },
            { label: 'worst season', value: money(-risk.worst, big), tone: 'red' },
          ]}
        />
        {st.business !== 'wind' && (
          <Slider
            label="Day-to-day temperature variability"
            tone={WX.temperature}
            value={st.variability}
            min={0.5}
            max={2}
            step={VARIABILITY_STEP}
            onChange={(v) => s.set({ variability: v })}
            display={`× ${fmt(st.variability, 2)}`}
          />
        )}
        {st.business === 'utility' && (
          <Slider
            label="ENSO’s pull on the winter"
            tone={WX.temperature}
            value={st.ensoF}
            min={0}
            max={3}
            step={0.1}
            onChange={(v) => s.set({ ensoF: v })}
            display={`${fmt(st.ensoF, 1)} °F per °C`}
          />
        )}
        {st.business === 'farm' && (
          <Slider
            label="Region’s share of the national corn crop"
            value={st.share}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => s.set({ share: v })}
            display={pct(st.share)}
          />
        )}
        {st.business === 'wind' && (
          <Slider
            label="Wind on Hollin Ridge"
            tone={WX.wind}
            value={st.windScale}
            min={0.8}
            max={1.2}
            step={0.02}
            onChange={(v) => s.set({ windScale: v })}
            display={`${fmt(st.windScale * 100)}% of the archive’s`}
          />
        )}
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with Calder Gas & Light. Its average winter earns {money(q.util.budget)} of margin, with a standard deviation of {money(q.util.summary.sd)}. One winter
        in 20 falls {money(q.util.shortfall)} short of that, and the worst falls {money(q.util.worst)} short. Each heating degree day is worth about{' '}
        {usd(perHdd)}: ${UTILITY.margin} on each of the {fmt(UTILITY.perHdd)} MMBtu it adds. The warmest winter in the archive, winter {q.warmest.winter}, brought{' '}
        {fmt(q.warmest.hdd)} degree days against an average of {fmt(q.hddMean)}. Turn up ENSO’s pull and the spread widens: at 3 °F per °C the 1-in-20 winter falls{' '}
        {money(q.doubled.shortfall)} short, because the Pacific now pushes whole winters warm or cold together. (Some states let utilities adjust their bills for
        the weather, which shifts much of this risk to their customers; Calder Gas & Light keeps it.)
      </P>
      <P>
        Switch to the corn farm and the scale changes, but the risk doesn’t shrink. Its average year earns {money(q.farm.budget, false)} on {fmt(FARM.acres)} acres;
        its standard deviation is {money(q.farm.summary.sd, false)}, {fmt(q.farm.summary.sd / q.farm.budget, 1)} times as much; one year in 20 loses {money(-q.farm.summary.p5, false)}, and the
        worst loses {money(-q.farm.summary.min, false)}. The farm’s costs are fixed, so a short harvest falls straight through to profit. Raise the region’s share of
        the national crop and the natural hedge of <a href={lessonHref('weather/4.3')}>Lesson 4.3</a> appears: at 40%, a bad harvest raises the price enough that
        the standard deviation falls to {money(q.farmBig.summary.sd, false)}.
      </P>
      <P>
        The wind farm is the steadiest. Its average year earns {money(q.wind.budget)}, its standard deviation is {money(q.wind.summary.sd)}, about{' '}
        {pct(q.wind.summary.sd / q.wind.budget)} of that, and its 1-in-20 year falls {money(q.wind.shortfall)} short. A year of wind is the sum of 365 days of
        weather, and the days’ ups and downs largely cancel. The farm’s harvest hangs on a few weeks of July, and a whole winter’s gas on how a few cold spells
        happen to fall.
      </P>

      <Challenge
        id="a"
        question={`Leave ENSO’s pull at Calder Bay’s own ${fmt(RISK_DEFAULTS.ensoF, 1)} °F per °C. How much more variable — to the nearest ${VARIABILITY_STEP} — would the weather have to be before Calder Gas & Light’s 1-in-20 winter fell more than $25 million short of budget?`}
        solved={solved}
        status={
          st.business !== 'utility'
            ? 'Choose Calder Gas & Light first.'
            : Math.abs(st.ensoF - RISK_DEFAULTS.ensoF) > 1e-9
              ? `Set ENSO’s pull back to ${fmt(RISK_DEFAULTS.ensoF, 1)} °F per °C.`
              : shortNow > SHORTFALL_TARGET
                ? `At × ${fmt(st.variability, 2)} the 1-in-20 winter falls ${money(shortNow)} short. Would less variability do it?`
                : `At × ${fmt(st.variability, 2)} the 1-in-20 winter falls ${money(shortNow)} short.`
        }
        success={`Solved. At × ${fmt(st.variability, 2)} the 1-in-20 winter falls ${money(shortNow)} short of budget. The shortfall grows almost in proportion to the variability: the utility’s exposure is linear in the degree days, so making every day’s departure from normal bigger makes every winter’s bigger with it. Even Marlow’s winter days are only ${fmt(MARLOW.winterSd / CALDER.winterSd, 2)} times as variable as Calder Bay’s; a climate half again as variable would be a different place.`}
      />

      <H2>What an index can explain</H2>
      <P>
        A business that wants to hand some of this risk to someone else needs two things. It needs a number that anyone can measure and nobody can manipulate, that
        moves with its cash: a <K tone={WX.index}>weather index</K>, such as the heating degree days at a named station. And it needs to know how much its cash moves
        per unit of that index. In the next demonstration each point is one season, placed by an index and by the business’s cash that season. The line is the
        least-squares fit: its slope is the dollars per unit of index, and the share of the variation it explains, R², says how faithfully the index tracks the
        business. The gray ticks are what the line misses. For the farm, choose among three indexes:
      </P>

      <Figure name="Weather Risk Calculator · against the index" scenario={ix}>
        <Segmented
          label="Business"
          value={ix.state.business}
          onChange={(v) => ix.set({ business: v })}
          options={[
            { value: 'utility', label: 'Calder Gas & Light' },
            { value: 'farm', label: 'Marlow corn farm' },
            { value: 'wind', label: 'Hollin Ridge wind farm' },
          ]}
        />
        {ix.state.business === 'farm' && (
          <Segmented
            label="Index for the farm"
            value={ix.state.farmIndex}
            onChange={(v) => ix.set({ farmIndex: v })}
            options={[
              { value: 'calderCdd', label: 'Calder Bay summer CDD' },
              { value: 'rain', label: 'Marlow summer rain' },
              { value: 'heat', label: 'Marlow heat degree days' },
            ]}
          />
        )}
        <IndexScatter fit={fit} business={ix.state.business} />
        <Readouts
          items={[
            { label: `${fit.outcome} per ${fit.unit}`, value: perUnit(fit.slope), tone: WX.money },
            { label: 'share explained, R²', value: pct(fit.r2), tone: WX.index },
            { label: `spread of ${fit.outcome}`, value: money(fit.sd, ix.state.business !== 'farm'), tone: WX.money },
            { label: 'left unexplained', value: money(fit.residualSd, ix.state.business !== 'farm'), tone: 'red' },
          ]}
        />
      </Figure>

      <P>
        For Calder Gas & Light the fit is close: winter degree days at Calder Bay explain {pct(q.fitU.r2)} of its margin, at {usd(q.fitU.slope)} per degree day — a
        little more than {usd(perHdd)}, because winter winds in the city average {fmt(q.avgWinterWind, 1)} m/s against its year-round {fmt(UTILITY.meanWind, 1)}, and
        windy days need more gas for each degree day. The wind is also most of what the line misses. Winter {q.worstW.winter}, with {fmt(q.worstW.hdd)} degree days,
        was only the {ordinal(q.worstRank)}-warmest in the archive, but it was calm, averaging {fmt(q.winterWinds[q.worstW.winter - 1], 1)} m/s, and it was the utility’s worst. Winter{' '}
        {q.warmest.winter} was warmer but windier, at {fmt(q.winterWinds[q.warmest.winter - 1], 1)} m/s, and lost less. After the fit, the margin still varies by{' '}
        {money(q.fitU.residualSd)} a winter, against {money(q.fitU.sd)} before it.
      </P>
      <P>
        The wind farm’s revenue follows Hollin Ridge’s average wind almost as faithfully: R² of {pct(q.fitW.r2)}, at {perUnit(q.fitW.slope)} per meter per second of
        the year’s average wind. What the average misses is how the wind was spread through the year — the steep power curve of{' '}
        <a href={lessonHref('weather/4.4')}>Lesson 4.4</a> rewards a few strong days more than many middling ones.
      </P>
      <P>
        The farm is where indexes struggle. Calder Bay’s summer cooling degree days explain only {pct(q.fitCdd.r2)} of its profit: they measure heat 350 km away, on
        the coast, as a daily mean, while the corn suffers from inland afternoon peaks. Marlow’s summer rain explains {pct(q.fitRain.r2)}, since the yield suffers only once a
        summer falls well short of rain, and heat does damage whatever the rain.
      </P>

      <Challenge
        id="b"
        figure="Weather Risk Calculator · against the index"
        question="Which of the three indexes explains the most of the Marlow farm’s profit?"
        solved={solved2}
        status={
          ix.state.business !== 'farm'
            ? 'Choose the Marlow corn farm first.'
            : `This index explains ${pct(fit.r2)} of the farm’s profit, leaving ${money(fit.residualSd, false)} a year unexplained.`
        }
        success={`Solved. Marlow’s own heat degree days explain ${pct(q.fitHeat.r2)}, at ${perUnit(q.fitHeat.slope)} of profit per degree day. Even so, ${money(q.fitHeat.residualSd, false)} a year is left unexplained — the dry summers and the timing that the index doesn’t count.`}
      />

      <P>
        The gap between an index and a business has a name: <b>basis risk</b>. It comes from geography (the station isn’t the farm), from definition (a daily mean
        isn’t an afternoon peak; degree days aren’t wind) and from timing. A hedge built on an index pays what the index says, not what the business lost, and the
        unexplained spread in <FigRef to="Weather Risk Calculator · against the index">this demonstration</FigRef> is roughly what would remain even after a
        perfect hedge on that index. That is why the slope and the R² are the first things a hedger works out, before anyone talks about price.
      </P>
      <P>
        That answers this chapter’s question. Weather creates financial risk wherever a business’s volumes, yields or costs move with the weather while its prices
        and budgets don’t — a utility’s winter, a farm’s summer, a wind farm’s year — and wherever a shock in one market spills into another, as cold snaps do from
        gas into power. Each is an opportunity for someone on the other side who is exposed the opposite way, or who is paid to carry the risk. Turning that into a
        trade needs an index that both sides trust. Chapter 5 begins there, in <a href={lessonHref('weather/5.1')}>the next lesson</a>: how weather indexes are
        defined, which station and which days count, and how a contract on them settles.
      </P>
    </LessonPage>
  );
}
