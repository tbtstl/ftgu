import { useDeferredValue, useMemo, type ReactNode } from 'react';
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
  niceDomain,
  niceTicks,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { BUSINESS_DEFAULTS, FAN_SEEDS, businessFan, exposures, fanOf, quantile, runBusiness, type Band, type BusinessFan, type OilBusiness } from '../../../engines/oil/business';
import { NETWORK_DEFAULTS } from '../../../engines/oil/network';
import { CRACK_RATIOS, crackOf } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams, type HistoryWeek } from '../../../model/oil/history';
import { BusinessCard } from '../shared/BusinessCard';
import { useBusiness } from '../shared/business';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// The four prices the company lives on.

export type SeriesId = 'wti' | 'crack' | 'basis' | 'heavy';

export const SERIES: Record<SeriesId, { label: string; axis: string; value: (w: HistoryWeek) => number }> = {
  wti: { label: 'WTI at Kessler', axis: 'WTI at Kessler, $ per barrel (simulated)', value: (w) => w.wti },
  crack: {
    label: 'Calder’s crack',
    axis: 'Crack in Calder’s product mix against Brent, $ per barrel',
    value: (w) => crackOf(w, 'brent', CRACK_RATIOS.calder),
  },
  basis: { label: 'Kessler–Calder spread', axis: 'Light crude at Port Calder minus WTI at Kessler, $ per barrel', value: (w) => w.calderCrude - w.wti },
  heavy: { label: 'Coldwater’s discount', axis: 'Light crude minus Coldwater Heavy at Port Calder, $ per barrel', value: (w) => w.calderCrude - w.coldwater },
};

const SERIES_IDS: SeriesId[] = ['wti', 'crack', 'basis', 'heavy'];

// ---------------------------------------------------------------------------
// The physical drivers, and the histories they make.

export type GroupMode = 'steady' | 'free';
export type ExpansionYear = '1' | '2' | '3' | '4' | '5' | 'never';

export interface Drivers {
  /** Does the producer group use spare capacity to steady prices? */
  group: GroupMode;
  /** Supply outages and refinery outages a year. */
  supply: number;
  refinery: number;
  /** Scale on the seasonal swings in demand. */
  seasonality: number;
  /** Ridgeback Basin growth, kb/d a year. */
  growth: number;
  /** Year the Kessler–Calder expansion opens, or never. */
  expansion: ExpansionYear;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
  /** A lasting widening of fuel oil's discount to crude after year 2, $/bbl. */
  fuelShift: number;
}

const EXPANSION = HISTORY_DEFAULTS.expansion ?? { year: 3, add: 300 };
export const FUEL_SHIFT_YEAR = 2;

export const DRIVER_DEFAULTS: Drivers = {
  group: HISTORY_DEFAULTS.groupStabilizes ? 'steady' : 'free',
  supply: HISTORY_DEFAULTS.supplyShocks,
  refinery: HISTORY_DEFAULTS.refineryOutages,
  seasonality: HISTORY_DEFAULTS.seasonality,
  growth: HISTORY_DEFAULTS.basinGrowth,
  expansion: String(EXPANSION.year) as ExpansionYear,
  rail: HISTORY_DEFAULTS.rail,
  fuelShift: 0,
};

/** History parameters for a set of drivers: only what differs from the course's world, so equal worlds share cached histories. */
export function paramsOf(d: Drivers): HistoryParams {
  const D = DRIVER_DEFAULTS;
  const p: HistoryParams = {};
  if (d.group !== D.group) p.groupStabilizes = d.group === 'steady';
  if (d.supply !== D.supply) p.supplyShocks = d.supply;
  if (d.refinery !== D.refinery) p.refineryOutages = d.refinery;
  if (d.seasonality !== D.seasonality) p.seasonality = d.seasonality;
  if (d.growth !== D.growth) p.basinGrowth = d.growth;
  if (d.expansion !== D.expansion) p.expansion = d.expansion === 'never' ? null : { year: Number(d.expansion), add: EXPANSION.add };
  if (d.rail !== D.rail) p.rail = d.rail;
  if (d.fuelShift > 0) p.fuelOilShock = { year: FUEL_SHIFT_YEAR, size: d.fuelShift };
  return p;
}

function driversOf<T extends Drivers>(st: T): Drivers {
  return {
    group: st.group,
    supply: st.supply,
    refinery: st.refinery,
    seasonality: st.seasonality,
    growth: st.growth,
    expansion: st.expansion,
    rail: st.rail,
    fuelShift: st.fuelShift,
  };
}

const sameDrivers = (a: Drivers, b: Drivers) => JSON.stringify(driversOf(a)) === JSON.stringify(driversOf(b));

const bandCache = new Map<string, Band[]>();
/** P10/P50/P90 of a price, week by week, across the 30 histories of a world. */
export function seriesFan(d: Drivers, id: SeriesId): Band[] {
  const key = `${id}|${JSON.stringify(driversOf(d))}`;
  let f = bandCache.get(key);
  if (!f) {
    f = fanOf(paramsOf(d), SERIES[id].value);
    if (bandCache.size > 120) bandCache.clear();
    bandCache.set(key, f);
  }
  return f;
}

/** The course's own history in a world (one of the 30). */
export function courseHistory(d: Drivers): HistoryWeek[] {
  return oilHistory(paramsOf(d));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** The band's average width (P90 − P10) through a year of the forecast (year 1 = the first 52 weeks). */
export function bandWidth(fan: Band[], year: number): number {
  return mean(fan.slice((year - 1) * 52, year * 52).map((b) => b.p90 - b.p10));
}

/** Lowest and highest points of the central path (P50). */
export function centralRange(fan: Band[]): [number, number] {
  const m = fan.map((b) => b.p50);
  return [Math.min(...m), Math.max(...m)];
}

/** Share of weeks in which a history falls outside the P10–P90 band. */
export function outsideShare(h: HistoryWeek[], fan: Band[], id: SeriesId): number {
  const n = Math.min(h.length, fan.length);
  let out = 0;
  for (let i = 0; i < n; i++) {
    const v = SERIES[id].value(h[i]);
    if (v < fan[i].p10 || v > fan[i].p90) out++;
  }
  return out / n;
}

/** The band (P90 − P10) of a price's five-year average across the 30 histories of a world. */
export function averageBand(d: Drivers, id: SeriesId): number {
  const avgs = FAN_SEEDS.map((seed) => mean(oilHistory({ ...paramsOf(d), seed }).map(SERIES[id].value)));
  return quantile(avgs, 0.9) - quantile(avgs, 0.1);
}

/** The central path averaged by week of the year: its usual yearly shape. */
export function yearlyShape(fan: Band[]): number[] {
  return Array.from({ length: 52 }, (_, k) => mean(fan.filter((_, i) => i % 52 === k).map((b) => b.p50)));
}

// ---------------------------------------------------------------------------
// The desk's demonstration state, and challenge a.

export interface DeskState extends Drivers {
  series: SeriesId;
  /** Years into the forecast the cursor reads. */
  at: number;
}

export const DESK_DEFAULTS: DeskState = { ...DRIVER_DEFAULTS, series: 'wti', at: 2 };

/** Challenge a: the spread's P90 must stay under this in every week, $/bbl. */
export const BASIS_LIMIT = 4;
export const GROWTH_STEP = 10;
export const GROWTH_MAX = 140;

/** The highest P90 of the Kessler–Calder spread over the five years, at a basin growth (every other driver at its start). */
export function basisPeakP90(growth: number): number {
  return Math.max(...seriesFan({ ...DRIVER_DEFAULTS, growth }, 'basis').map((b) => b.p90));
}

export function atStartExceptGrowth(d: Drivers): boolean {
  return sameDrivers({ ...d, growth: DRIVER_DEFAULTS.growth }, DRIVER_DEFAULTS);
}

/**
 * Challenge a: with every other driver at its start, the fastest basin growth (on the 10 kb/d grid)
 * at which the spread's P90 stays under $4 in every week.
 */
export function steadyBasisSolved(d: Drivers): boolean {
  if (!atStartExceptGrowth(d)) return false;
  if (basisPeakP90(d.growth) >= BASIS_LIMIT) return false;
  return d.growth + GROWTH_STEP > GROWTH_MAX || basisPeakP90(d.growth + GROWTH_STEP) >= BASIS_LIMIT;
}

/** The answer to challenge a. */
export function fastestSteadyGrowth(): number {
  let best = NaN;
  for (let g = 0; g <= GROWTH_MAX; g += GROWTH_STEP) if (basisPeakP90(g) < BASIS_LIMIT) best = g;
  return best;
}

// ---------------------------------------------------------------------------
// Cash flow at risk (second demonstration), and challenge b.

export type PlanChoice = 'yours' | 'start';

export interface CashState {
  plan: PlanChoice;
  group: GroupMode;
  supply: number;
  refinery: number;
  seasonality: number;
  expansion: ExpansionYear;
}

export const CASH_DEFAULTS: CashState = {
  plan: 'yours',
  group: DRIVER_DEFAULTS.group,
  supply: DRIVER_DEFAULTS.supply,
  refinery: DRIVER_DEFAULTS.refinery,
  seasonality: DRIVER_DEFAULTS.seasonality,
  expansion: DRIVER_DEFAULTS.expansion,
};

export function cashDrivers(st: CashState): Drivers {
  return { ...DRIVER_DEFAULTS, group: st.group, supply: st.supply, refinery: st.refinery, seasonality: st.seasonality, expansion: st.expansion };
}

/** The plan in use: the reader's, or the starting plan. */
export function planFor(st: CashState, yours: OilBusiness): OilBusiness {
  return st.plan === 'start' ? BUSINESS_DEFAULTS : yours;
}

/** The plan across the 30 histories of the chosen world. */
export function cashFan(plan: OilBusiness, st: CashState): BusinessFan {
  return businessFan(plan, paramsOf(cashDrivers(st)));
}

/** Width of the band of five-year operating cash (P90 − P10), $. */
export function totalBandWidth(f: BusinessFan): number {
  return f.total.p90 - f.total.p10;
}

const isStartingPlan = (b: OilBusiness) => JSON.stringify(b) === JSON.stringify(BUSINESS_DEFAULTS);

/** Challenge b: with the starting plan, a world in which the band of five-year totals is less than half as wide as in the course's world. */
export function narrowBandSolved(st: CashState, yours: OilBusiness): boolean {
  const plan = planFor(st, yours);
  if (!isStartingPlan(plan)) return false;
  const start = totalBandWidth(cashFan(BUSINESS_DEFAULTS, { ...CASH_DEFAULTS, plan: 'start' }));
  return totalBandWidth(cashFan(plan, st)) < start / 2;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose: the starting plan in the course's world, computed once.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOfWeek = (k: number) => MONTHS[Math.min(11, Math.floor((k / 52) * 12))];

let facts: ReturnType<typeof computeFacts> | null = null;
function computeFacts() {
  const D = DRIVER_DEFAULTS;
  const wti = seriesFan(D, 'wti');
  const crack = seriesFan(D, 'crack');
  const basis = seriesFan(D, 'basis');
  const heavy = seriesFan(D, 'heavy');
  const free = seriesFan({ ...D, group: 'free' }, 'wti');
  const calmRefining = seriesFan({ ...D, refinery: 0 }, 'crack');
  const shape = yearlyShape(crack);
  const peak = shape.indexOf(Math.max(...shape));
  const trough = shape.indexOf(Math.min(...shape));
  const basisHigh = basis.map((b, i) => (b.p50 > 5 ? i : -1)).filter((i) => i >= 0);
  // A lasting fuel-oil shift moves every history the same way, so the course's history shows the central path's shift.
  const h0 = courseHistory(D);
  const hs = courseHistory({ ...D, fuelShift: 10 });
  const from = (FUEL_SHIFT_YEAR + 1) * 52;
  const heavyShift = mean(hs.slice(from).map((w, i) => SERIES.heavy.value(w) - SERIES.heavy.value(h0[from + i])));
  const cash = businessFan(BUSINESS_DEFAULTS, paramsOf(D));
  const cashFree = businessFan(BUSINESS_DEFAULTS, paramsOf({ ...D, group: 'free' }));
  const firstWeakest = FAN_SEEDS.filter((seed) => {
    const r = runBusiness(BUSINESS_DEFAULTS, { ...paramsOf(D), seed });
    return r.quarters.indexOf(Math.min(...r.quarters)) === 0;
  }).length;
  const p50s = cash.quarters.map((q) => q.p50);
  return {
    wti1: bandWidth(wti, 1),
    wti4: bandWidth(wti, 4),
    free4: bandWidth(free, 4),
    wtiOutside: outsideShare(h0, wti, 'wti'),
    crackBand: mean(crack.map((b) => b.p90 - b.p10)),
    calmBand: mean(calmRefining.map((b) => b.p90 - b.p10)),
    crackSwing: shape[peak] - shape[trough],
    crackPeak: monthOfWeek(peak),
    crackTrough: monthOfWeek(trough),
    basisHigh: centralRange(basis)[1],
    basisFrom: basisHigh.length ? basisHigh[0] / 52 : NaN,
    basisTo: basisHigh.length ? (basisHigh[basisHigh.length - 1] + 1) / 52 : NaN,
    basis2: bandWidth(basis, 2),
    basis4: bandWidth(basis, 4),
    heavyBand: mean(heavy.map((b) => b.p90 - b.p10)),
    heavyCentral: centralRange(heavy),
    heavyShift,
    cash,
    cashFree,
    firstWeakest,
    q1: p50s[0],
    qPeak: Math.max(...p50s),
    averageBand: averageBand(D, 'wti'),
    averageBandFree: averageBand({ ...D, group: 'free' }, 'wti'),
    exposureNow: exposures(BUSINESS_DEFAULTS, 0),
    exposureLater: exposures(BUSINESS_DEFAULTS, 156),
  };
}
function getFacts() {
  if (!facts) facts = computeFacts();
  return facts;
}

// ---------------------------------------------------------------------------
// Display helpers.

const BAND = GRAPHIC.violet;
const BAND_FILL = tint(GRAPHIC.violet, 0.72);
const PRICE = GRAPHIC.green;
const yearTick = (v: number) => (v === 0 ? 'start' : `year ${v}`);
const dollars = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), 2)}`;
const millions = (v: number, d = 1) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, d)} million`;
const billions = (v: number) => `$${fmt(v / 1e9, 2)} billion`;
const kusd = (v: number) => `$${fmt(Math.round(Math.abs(v) / 100) * 100)}`;
/** "raises it by $X" or "lowers it by $X", for a daily cash change. */
const moves = (v: number) => `${v < 0 ? 'lowers' : 'raises'} it by ${kusd(v)}`;
/** Years, without a trailing ".0". */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const yrs = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? (WORDS[Math.round(v)] ?? fmt(Math.round(v))) : fmt(v, 1));

function GroupLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: TEXT.gray, margin: '14px 0 2px' }}>{children}</div>;
}

const EXPANSION_OPTIONS: Array<{ value: ExpansionYear; label: string }> = [
  { value: '1', label: 'Year 1' },
  { value: '2', label: 'Year 2' },
  { value: '3', label: 'Year 3' },
  { value: '4', label: 'Year 4' },
  { value: '5', label: 'Year 5' },
  { value: 'never', label: 'Never' },
];

/** The P10–P90 band as a closed path, then the central path. */
function bandPaths(fan: Band[], sx: (v: number) => number, sy: (v: number) => number) {
  const up = fan.map((b, i) => `${sx(i / 52).toFixed(1)} ${sy(b.p90).toFixed(1)}`);
  const dn = fan.map((b, i) => `${sx(i / 52).toFixed(1)} ${sy(b.p10).toFixed(1)}`).reverse();
  const mid = fan.map((b, i) => `${i ? 'L' : 'M'}${sx(i / 52).toFixed(1)} ${sy(b.p50).toFixed(1)}`).join(' ');
  return { band: `M${up.join(' L')} L${dn.join(' L')} Z`, mid };
}

export default function Lesson() {
  const f = getFacts();
  const yours = useBusiness();

  // ---- Figure 1: the desk's forecasts.
  const s1 = useScenario<DeskState>('desk', DESK_DEFAULTS);
  const st = s1.state;
  const driverKey = useDeferredValue(JSON.stringify(driversOf(st)));
  const drivers = useMemo(() => JSON.parse(driverKey) as Drivers, [driverKey]);
  const id = st.series;
  const fan = useMemo(() => seriesFan(drivers, id), [drivers, id]);
  const h = useMemo(() => courseHistory(drivers), [drivers]);
  const hist = useMemo(() => h.map((w) => SERIES[id].value(w)), [h, id]);
  const w1 = bandWidth(fan, 1);
  const w4 = bandWidth(fan, 4);
  const [cLo, cHi] = centralRange(fan);
  const outside = outsideShare(h, fan, id);
  const [yLo, yHi] = niceDomain(Math.min(...fan.map((b) => b.p10), ...hist), Math.max(...fan.map((b) => b.p90), ...hist), 4);
  const week = Math.min(fan.length - 1, Math.max(0, Math.round(st.at * 52)));
  const cur = fan[week];
  const solvedA = useMemo(() => steadyBasisSolved(drivers), [drivers]);
  const basisPeak = useMemo(() => (atStartExceptGrowth(drivers) ? basisPeakP90(drivers.growth) : NaN), [drivers]);
  const nextPeak = useMemo(() => (solvedA && drivers.growth + GROWTH_STEP <= GROWTH_MAX ? basisPeakP90(drivers.growth + GROWTH_STEP) : NaN), [solvedA, drivers]);

  // ---- Figure 2: the company's cash across histories.
  const s2 = useScenario<CashState>('cash', CASH_DEFAULTS);
  const cs = s2.state;
  const cashKey = useDeferredValue(JSON.stringify(cs));
  const csd = useMemo(() => JSON.parse(cashKey) as CashState, [cashKey]);
  const plan = planFor(csd, yours);
  const cf = useMemo(() => cashFan(plan, csd), [plan, csd]);
  const course = useMemo(() => runBusiness(plan, paramsOf(cashDrivers(csd))), [plan, csd]);
  const startWidth = useMemo(() => totalBandWidth(cashFan(BUSINESS_DEFAULTS, { ...CASH_DEFAULTS, plan: 'start' })), []);
  const width = totalBandWidth(cf);
  const solvedB = useMemo(() => narrowBandSolved(csd, yours), [csd, yours]);
  const usingStart = isStartingPlan(plan);
  const qVals = cf.quarters.flatMap((q) => [q.p10, q.p90]).concat(course.quarters);
  const [qLo, qHi] = niceDomain(Math.min(...qVals) / 1e6, Math.max(...qVals) / 1e6, 4);
  const weakest = cf.quarters.reduce((m, q, i) => (q.p50 < cf.quarters[m].p50 ? i : m), 0);

  return (
    <LessonPage id="oil/7.4">
      <P>
        Lessons <a href={lessonHref('oil/7.1')}>7.1</a> to <a href={lessonHref('oil/7.3')}>7.3</a> laid out the company’s physical plan: the fields it will
        develop, the refinery it will run, and how its crude reaches the coast. Every part of that plan earns a price the company doesn’t set.
        Before it decides how to protect itself, it needs a desk that can say what those prices are likely to do — and, just as important, how far anyone can see.
      </P>
      <P>
        Our desk doesn’t make one guess. It runs the course’s physics thirty times: the course’s own five years and 29 others drawn from the same model with
        different luck, as <a href={lessonHref('oil/6.5')}>Lesson 6.5</a> did with eight. In each week it reads the middle of the thirty, the{' '}
        <K tone="violet">central path</K> (P50), and a <K tone="violet">band</K> from the <K tone="violet">P10</K> to the <K tone="violet">P90</K>, with three
        histories in thirty below it and three above. The width of the band is what the physics can’t pin down. Every price here is simulated for teaching.
      </P>
      <P>
        The desk watches four prices. <K c="price">WTI</K> at Kessler is what the company’s fields sell at; <K c="price">Calder’s crack</K>, its own product mix
        against Brent, is what the refinery earns; the <K c="price">Kessler–Calder spread</K> is what firm space earns; and{' '}
        <K c="price">Coldwater’s discount</K> is what makes the coker pay. In the next demonstration, pick a price, then change the physical world and watch which
        bands move:
      </P>

      <Figure name="Oil Forecasting Desk" scenario={s1}>
        <Segmented<SeriesId> label="Price" value={st.series} onChange={(v) => s1.set({ series: v })} options={SERIES_IDS.map((k) => ({ value: k, label: SERIES[k].label }))} />
        <Legend
          items={[
            { label: 'P10–P90 band (30 histories)', color: BAND_FILL },
            { label: 'Central path (P50)', color: BAND, kind: 'line', dashed: true },
            { label: 'The course’s history', color: PRICE, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`${SERIES[id].label} over five simulated years. The band from P10 to P90 averages ${dollars(w1)} wide in year 1 and ${dollars(w4)} in year 4; the central path runs from ${dollars(cLo)} to ${dollars(cHi)}. At ${fmt(st.at, 1)} years: P10 ${dollars(cur.p10)}, P50 ${dollars(cur.p50)}, P90 ${dollars(cur.p90)}; the course’s history ${dollars(hist[week])}.`}
          height={250}
          x={[0, 5]}
          y={[yLo, yHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(yLo, yHi, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel={SERIES[id].axis}
          refs={[{ axis: 'x', at: week / 52, cursor: true }]}
          onScrub={(x) => s1.set({ at: Math.round(x * 52) / 52 })}
          scrubValue={st.at}
          scrubStep={4 / 52}
          scrubLabel="Weeks into the forecast"
        >
          {(sx, sy) => {
            const p = bandPaths(fan, sx, sy);
            const hp = hist.map((v, i) => `${i ? 'L' : 'M'}${sx(i / 52).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
            return (
              <g pointerEvents="none">
                <path d={p.band} fill={BAND_FILL} opacity={0.75} />
                <path d={hp} fill="none" stroke={PRICE} strokeWidth={1.6} strokeLinejoin="round" />
                <path d={p.mid} fill="none" stroke={BAND} strokeWidth={2.2} strokeDasharray="6 4" />
              </g>
            );
          }}
        </XYChart>
        <Readouts
          items={[
            { label: <K tone="violet">band, year 1</K>, value: dollars(w1), tone: 'violet' },
            { label: <K tone="violet">band, year 4</K>, value: dollars(w4), tone: 'violet' },
            { label: 'central path moves', value: dollars(cHi - cLo), tone: 'green' },
            { label: 'weeks the course’s history is outside', value: pct(outside) },
          ]}
        />
        <GroupLabel>Physical drivers</GroupLabel>
        <Segmented<GroupMode>
          label="Producer group"
          value={st.group}
          onChange={(v) => s1.set({ group: v })}
          options={[
            { value: 'steady', label: 'Group steadies prices' },
            { value: 'free', label: 'Group doesn’t' },
          ]}
        />
        <Slider label="Supply outages" tone="orange" value={st.supply} min={0} max={2} step={0.2} onChange={(v) => s1.set({ supply: Math.round(v * 10) / 10 })} display={`${fmt(st.supply, 1)} a year`} />
        <Slider label="Refinery outages" tone="orange" value={st.refinery} min={0} max={4} step={0.5} onChange={(v) => s1.set({ refinery: v })} display={`${fmt(st.refinery, 1)} a year`} />
        <Slider label="Seasonal swing in demand" tone="red" value={st.seasonality} min={0} max={2} step={0.25} onChange={(v) => s1.set({ seasonality: v })} display={`×${fmt(st.seasonality, 2)}`} />
        <Slider label="Basin growth" tone="orange" value={st.growth} min={0} max={GROWTH_MAX} step={GROWTH_STEP} onChange={(v) => s1.set({ growth: v })} display={`${fmt(st.growth)} kb/d a year`} />
        <Segmented<ExpansionYear> label="Expansion opens" value={st.expansion} onChange={(v) => s1.set({ expansion: v })} options={EXPANSION_OPTIONS} />
        <Slider label="Rail to the coast" tone="orange" value={st.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={`${fmt(st.rail)} kb/d`} />
        <Slider
          label="Fuel-oil discount shift"
          tone="gold"
          value={st.fuelShift}
          min={0}
          max={20}
          step={1}
          onChange={(v) => s1.set({ fuelShift: v })}
          display={st.fuelShift === 0 ? 'none' : `+$${fmt(st.fuelShift)} after year ${FUEL_SHIFT_YEAR}`}
        />
        <Caption>
          Drag across the chart, or use the arrow keys, to read a week. At {fmt(st.at, 1)} years, the desk’s band for {SERIES[id].label} runs from{' '}
          {dollars(cur.p10)} to {dollars(cur.p90)} around a central {dollars(cur.p50)}; the course’s history was at {dollars(hist[week])}.
        </Caption>
      </Figure>

      <P>
        Start with <K c="price">WTI</K>. In the first year the band averages {dollars(f.wti1)} wide; in the fourth, {dollars(f.wti4)}. It doesn’t keep widening
        the further out the desk looks, because the physics pulls prices back: stocks drift toward normal (<a href={lessonHref('oil/5.1')}>Lesson 5.1</a>), and the producer group leans
        against big moves (<a href={lessonHref('oil/5.5')}>Lesson 5.5</a>). Let the group stop steadying prices and the band in year 4 averages{' '}
        {dollars(f.free4)}. Either way, most of what WTI will do lies inside the band. The desk can say how uncertain the price is, not where it will go — and
        the course’s own history spent {pct(f.wtiOutside)} of its weeks outside even that band.
      </P>
      <P>
        Calder’s crack is different. Its band averages only {dollars(f.crackBand)}, while its central path rises and falls by {dollars(f.crackSwing)} each year,
        lowest in {f.crackTrough} and highest in {f.crackPeak}: Calder’s mix leans toward diesel, whose crack is strongest in the cold months (
        <a href={lessonHref('oil/6.3')}>Lesson 6.3</a>). The seasons are a forecast the desk can make years ahead. Most of what’s left in the band is refinery
        outages around the world, which drain product stocks without warning (<a href={lessonHref('oil/5.5')}>Lesson 5.5</a>); with none, the band averages{' '}
        {dollars(f.calmBand)}.
      </P>

      <H2>Forecasts the physics can make</H2>
      <P>
        The <K c="price">Kessler–Calder spread</K> is the most foreseeable price the company has. Its central path sits near the line’s{' '}
        ${fmt(NETWORK_DEFAULTS.pipelineTariff)} tariff until about {yrs(f.basisFrom)} years in, climbs as high as {dollars(f.basisHigh)} — the rail freight —
        while the line is full, and falls back when the expansion opens {yrs(f.basisTo)} years in (<a href={lessonHref('oil/5.2')}>Lesson 5.2</a>). The basin’s growth and the expansion’s date are both known, so the desk
        can draw that shape in advance. Its band is widest in year 2, averaging {dollars(f.basis2)}, when a few thousand barrels a day decide whether the line is
        full that week, and only {dollars(f.basis4)} in year 4.
      </P>
      <P>
        <K c="price">Coldwater’s discount</K> is the opposite case: a band about {dollars(f.heavyBand)} wide around a central path that barely moves, from{' '}
        {dollars(f.heavyCentral[0])} to {dollars(f.heavyCentral[1])}. It follows fuel oil, whose discount wanders for reasons nothing in our physics schedules (
        <a href={lessonHref('oil/4.5')}>Lesson 4.5</a>). The exception is a change announced in advance. The limit on sulfur in ships’ fuel that took effect in
        2020 was decided years before; add a lasting $10 widening of fuel oil’s discount after year {FUEL_SHIFT_YEAR} and, over the last two years of the
        forecast, the central path sits {dollars(f.heavyShift)} higher on average. A desk that read the rule could have drawn that shift into its forecast long before it arrived.
      </P>

      <Challenge
        id="a"
        question={`With every other driver at its starting value, find the fastest basin growth, to the nearest ${GROWTH_STEP} kb/d a year, at which the Kessler–Calder spread’s P90 stays under $${BASIS_LIMIT} in every week of the five years.`}
        solved={solvedA}
        status={
          !atStartExceptGrowth(drivers)
            ? 'Set every driver except basin growth back to its starting value.'
            : basisPeak >= BASIS_LIMIT
              ? `At ${fmt(drivers.growth)} kb/d a year the spread’s P90 reaches ${dollars(basisPeak)}: in some histories the line fills.`
              : `At ${fmt(drivers.growth)} kb/d a year the P90 never passes ${dollars(basisPeak)}. Could the basin grow faster?`
        }
        success={`Solved: ${fmt(drivers.growth)} kb/d a year. The P90 peaks at ${dollars(basisPeak)}${Number.isFinite(nextPeak) ? `; at ${fmt(drivers.growth + GROWTH_STEP)} kb/d it reaches ${dollars(nextPeak)}, because in some histories the line fills before the expansion opens and the spread jumps to the rail freight` : ''}. Below that growth the desk can promise the company a narrow spread; above it, it can only promise a band.`}
      />

      <H2>The company’s cash at risk</H2>
      <P>
        A forecast of prices is a step toward the forecast that matters: the company’s cash. In the next demonstration, the desk runs your plan from Lessons 7.1 to
        7.3 — and any hedges from <a href={lessonHref('oil/7.5')}>Lesson 7.5</a> — through the same thirty histories, and shows each quarter’s operating cash as a
        band, with the course’s history drawn in. You can switch to the starting plan to compare:
      </P>

      <Figure name="Oil Forecasting Desk · cash flow at risk" scenario={s2}>
        <Segmented<PlanChoice>
          label="Plan"
          value={cs.plan}
          onChange={(v) => s2.set({ plan: v })}
          options={[
            { value: 'yours', label: 'Your plan' },
            { value: 'start', label: 'Starting plan' },
          ]}
        />
        {cs.plan === 'yours' && <BusinessCard />}
        <Legend
          items={[
            { label: 'P10–P90 of the quarter’s cash', color: BAND_FILL },
            { label: 'P50', color: BAND, kind: 'line' },
            { label: 'The course’s history', color: PRICE, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Quarterly operating cash over five simulated years across 30 histories. Five-year total: P10 ${billions(cf.total.p10)}, P50 ${billions(cf.total.p50)}, P90 ${billions(cf.total.p90)}. The weakest quarter by its P50 is quarter ${weakest + 1}, at ${millions(cf.quarters[weakest].p50, 0)}.`}
          height={220}
          x={[0, 5]}
          y={[qLo, qHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(qLo, qHi, 4)}
          yFormat={(v) => `$${fmt(v)}M`}
          yLabel="Operating cash in the quarter, $ million"
        >
          {(sx, sy) => {
            const half = (sx(0.25) - sx(0)) * 0.32;
            const pts = course.quarters.map((q, i) => `${i ? 'L' : 'M'}${sx((i + 0.5) / 4).toFixed(1)} ${sy(q / 1e6).toFixed(1)}`).join(' ');
            return (
              <g pointerEvents="none">
                {cf.quarters.map((q, i) => {
                  const cx = sx((i + 0.5) / 4);
                  return (
                    <g key={i}>
                      <rect x={cx - half} y={sy(q.p90 / 1e6)} width={2 * half} height={Math.max(1, sy(q.p10 / 1e6) - sy(q.p90 / 1e6))} fill={BAND_FILL} />
                      <line x1={cx - half} x2={cx + half} y1={sy(q.p50 / 1e6)} y2={sy(q.p50 / 1e6)} stroke={BAND} strokeWidth={2} />
                    </g>
                  );
                })}
                <path d={pts} fill="none" stroke={PRICE} strokeWidth={1.6} />
                {course.quarters.map((q, i) => (
                  <circle key={i} cx={sx((i + 0.5) / 4)} cy={sy(q / 1e6)} r={2.6} fill={PRICE} />
                ))}
              </g>
            );
          }}
        </XYChart>
        <Readouts
          items={[
            { label: <K c="price">five-year cash, P50</K>, value: billions(cf.total.p50), tone: 'green' },
            { label: <K tone="violet">band of five-year totals</K>, value: millions(width, 0), tone: 'violet' },
            { label: 'weakest quarter, P50', value: `${millions(cf.quarters[weakest].p50, 0)} (Q${weakest + 1})` },
            { label: <K tone="violet">worst quarter against plan, P10</K>, value: millions(cf.worstSurprise.p10), tone: 'red' },
          ]}
        />
        <GroupLabel>Physical drivers</GroupLabel>
        <Segmented<GroupMode>
          label="Producer group"
          value={cs.group}
          onChange={(v) => s2.set({ group: v })}
          options={[
            { value: 'steady', label: 'Group steadies prices' },
            { value: 'free', label: 'Group doesn’t' },
          ]}
        />
        <Slider label="Supply outages" tone="orange" value={cs.supply} min={0} max={2} step={0.2} onChange={(v) => s2.set({ supply: Math.round(v * 10) / 10 })} display={`${fmt(cs.supply, 1)} a year`} />
        <Slider label="Refinery outages" tone="orange" value={cs.refinery} min={0} max={4} step={0.5} onChange={(v) => s2.set({ refinery: v })} display={`${fmt(cs.refinery, 1)} a year`} />
        <Slider label="Seasonal swing in demand" tone="red" value={cs.seasonality} min={0} max={2} step={0.25} onChange={(v) => s2.set({ seasonality: v })} display={`×${fmt(cs.seasonality, 2)}`} />
        <Segmented<ExpansionYear> label="Expansion opens" value={cs.expansion} onChange={(v) => s2.set({ expansion: v })} options={EXPANSION_OPTIONS} />
        <Caption>
          {usingStart ? 'The starting plan' : 'Your plan'} earns {billions(cf.total.p10)} to {billions(cf.total.p90)} over five years in eight histories out of ten
          ({pct(width / cf.total.p50, 1)} of the central {billions(cf.total.p50)}); the course’s history earned {billions(course.sums.total)}.
        </Caption>
      </Figure>

      <P>
        With the starting plan, the company’s central forecast is {billions(f.cash.total.p50)} of operating cash over five years, and the band runs from{' '}
        {billions(f.cash.total.p10)} to {billions(f.cash.total.p90)}: {millions(f.cash.total.p90 - f.cash.total.p10, 0)} wide,{' '}
        {pct((f.cash.total.p90 - f.cash.total.p10) / f.cash.total.p50, 0)} of the total. The quarters climb from {millions(f.q1, 0)} to {millions(f.qPeak, 0)} as
        the waterflood’s oil and the new wells arrive (<a href={lessonHref('oil/7.1')}>Lesson 7.1</a>), and that climb is in every history: the weakest quarter is the first in {f.firstWeakest} of {FAN_SEEDS.length}. A low
        quarter the company can see coming is a plan, not a risk.
      </P>
      <P>
        Now look at what moves the band. Let the producer group stop steadying prices — the change that made the WTI band in{' '}
        <FigRef to="Oil Forecasting Desk">the first demonstration</FigRef> {fmt(f.free4 / f.wti4, 1)} times as wide in year 4 — and the band of five-year totals
        goes only from {millions(f.cash.total.p90 - f.cash.total.p10, 0)} to {millions(f.cashFree.total.p90 - f.cashFree.total.p10, 0)}. The company barely
        notices the crude price over five years, for two reasons. The price’s swings mostly average out: across the thirty histories, the band of WTI’s five-year
        average is only {dollars(f.averageBand)} wide, or {dollars(f.averageBandFree)} without the group. And the company’s two halves face crude in opposite
        directions: each $1 rise in crude {moves(f.exposureNow.crude).replace(' it ', ' its daily cash ')} today, since a dearer crude squeezes the refinery (as{' '}
        <a href={lessonHref('oil/6.4')}>Lesson 6.4</a> found) {f.exposureNow.crude < 0 ? 'more than it helps the fields' : 'less than it helps the fields'}, and{' '}
        {moves(f.exposureLater.crude)} three years on, with the waterflood and the new wells producing. Each $1 on Calder’s crack, by contrast, is worth{' '}
        {kusd(f.exposureNow.crack)} a day.
      </P>
      <P>
        Over a single quarter, crude matters more. Measured as Lesson 6.4 measured Calder, against a plan that holds each quarter’s prices where they stood when
        it began, the worst quarter of the five years falls {millions(-f.cash.worstSurprise.p50)} short in the median history and{' '}
        {millions(-f.cash.worstSurprise.p10)} or more in one history in ten; without the producer group’s steadying hand, {millions(-f.cashFree.worstSurprise.p10)}.
        Part of that shortfall is the seasons, which the desk saw coming; the rest no one could.
      </P>

      <Challenge
        id="b"
        figure="Oil Forecasting Desk · cash flow at risk"
        question="With the starting plan, find a physical world in which the band of five-year totals is less than half as wide as in the course’s world."
        solved={solvedB}
        status={
          !usingStart
            ? 'Switch to the starting plan (or set your plan back to it).'
            : `The band is ${millions(width, 0)} wide, against ${millions(startWidth, 0)} in the course’s world; the target is under ${millions(startWidth / 2, 0)}.`
        }
        success={`Solved: the band is ${millions(width, 0)} wide, against ${millions(startWidth, 0)} in the course’s world.${csd.refinery < DRIVER_DEFAULTS.refinery ? ` With ${csd.refinery === 0 ? 'no refinery outages' : `only ${fmt(csd.refinery, 1)} refinery outages a year`} around the world, Calder’s crack — the company’s largest exposure — has little left to surprise it with.` : ''}`}
      />

      <P>
        The desk’s job ends where the band begins. It can foresee the seasons in the crack, the spread before and after a scheduled expansion, a regulation
        announced in advance, and the quarters when the company’s own production is low. It can’t foresee outages, or how the producer group will answer them. What
        can’t be forecast can still be hedged: in <a href={lessonHref('oil/7.5')}>Lesson 7.5</a> we choose the company’s hedges and test them against the same
        physics, looking for the combination that narrows the bands the desk can’t.
      </P>
    </LessonPage>
  );
}
