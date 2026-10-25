import { useDeferredValue, useMemo, useState } from 'react';
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
  useScenario,
} from '../../../framework';
import { lineCapacity } from '../../../engines/gas/compression';
import { planFor, scenarioYear, simulateYear, type YearDay } from '../../../engines/gas/market';
import { MMBTU_PER_MCF, psia } from '../../../engines/gas/properties';
import { COAL_SWITCH_BLOCKS, OIL_SWITCH_VALUE, PROTECTED_VALUE } from '../../../model/gas/demand';
import { GAS_MONTHS, GAS_MONTH_NAMES, GAS_MONTH_START, GAS_YEAR_DAYS, monthOfDay, weatherYear } from '../../../model/gas/weather';
import { BASINS, PIPELINE, PRODUCTION_COST, stationLineOf } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { basis, bcfd, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// A year of basis under the reader's pipelines.

const NL = PIPELINE['calder-metro'];
const RE = PIPELINE['ridgeback-calder'];
const CL = PIPELINE['ridgeback-bayport'];
const RIDGEBACK_PROD = BASINS[0].productionBcfd;
const RIDGEBACK_COST = PRODUCTION_COST.ridgeback ?? 1.2;
/** Gas the Ridgeback field burns itself, Bcf/d (its field-use demand block). */
const FIELD_USE = 0.1;
/** MMBtu in a Bcf of the region's gas. */
const MMBTU_PER_BCF = MMBTU_PER_MCF * 1e6;

export type BasisWinter = 'mild' | 'typical' | 'harsh';
/** The three winters of Lesson 4.2, by weather seed. */
export const BASIS_WINTER_SEED: Record<BasisWinter, number> = { mild: 2, typical: 3, harsh: 1 };
export const BASIS_DEFAULTS = { winter: 'harsh' as BasisWinter, northline: NL.capacityBcfd, express: RE.capacityBcfd };
export type BasisState = typeof BASIS_DEFAULTS;
const CAP_STEP = 0.05;

/** What Northline carries at its promised pressure with one of its compressor stations out (Lesson 1.4), MMcf/d. */
export const NORTHLINE_STATION_OUT_MMCFD = lineCapacity({ ...stationLineOf(NL), stations: NL.stations - 1 }, psia(NL.minDeliveryPsig));
/** The same on the capacity sliders' 0.05 Bcf/d steps (Lesson 5.5 uses the same figure), Bcf/d. */
export const NORTHLINE_STATION_OUT = round2(Math.round(NORTHLINE_STATION_OUT_MMCFD / 1000 / CAP_STEP) * CAP_STEP);

/** The gas year under the chosen winter and pipeline capacities, with the storage plan redrawn for them. */
export function basisYear(s: BasisState): YearDay[] {
  return scenarioYear({ seed: BASIS_WINTER_SEED[s.winter], capacity: { [NL.id]: round2(s.northline), [RE.id]: round2(s.express) } });
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

export interface BasisStats {
  /** Daily basis to Calder, $/MMBtu. */
  metro: number[];
  ridgeback: number[];
  metroAvg: number;
  ridgebackAvg: number;
  /** Days Metro is more than $1 over Calder; days Ridgeback is more than $0.50 under. */
  metroOver1: number;
  /** Days Metro sits at exactly the cost of the trip up Northline. */
  metroAtTrip: number;
  ridgebackUnder50: number;
  metroMax: number;
  ridgebackMin: number;
  calderAvg: number;
  /** What holders of each pipeline's capacity earned beyond its variable cost over the year: (price gap − cost) × flow, $. */
  northlineRent: number;
  expressRent: number;
}

/** Rent on a pipeline over a year: its flow times the price gap across it beyond its variable cost, $. */
export function pipeRent(year: YearDay[], id: string): number {
  const p = PIPELINE[id];
  return year.reduce((s, d) => s + Math.max(0, d.price[p.to] - d.price[p.from] - p.variableCost) * (d.flow[id] ?? 0) * MMBTU_PER_BCF, 0);
}

export function basisStats(year: YearDay[]): BasisStats {
  const metro = year.map((d) => d.price.metro - d.price.calder);
  const ridgeback = year.map((d) => d.price.ridgeback - d.price.calder);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    metro,
    ridgeback,
    metroAvg: avg(metro),
    ridgebackAvg: avg(ridgeback),
    metroOver1: metro.filter((x) => x > 1).length,
    metroAtTrip: metro.filter((x) => Math.abs(x - NL.variableCost) < 0.005).length,
    ridgebackUnder50: ridgeback.filter((x) => x < -0.5).length,
    metroMax: Math.max(...metro),
    ridgebackMin: Math.min(...ridgeback),
    calderAvg: avg(year.map((d) => d.price.calder)),
    northlineRent: pipeRent(year, NL.id),
    expressRent: pipeRent(year, RE.id),
  };
}

const statsCache = new Map<string, BasisStats>();
export function basisStatsFor(s: BasisState): BasisStats {
  const k = `${s.winter}|${round2(s.northline)}|${round2(s.express)}`;
  let v = statsCache.get(k);
  if (!v) {
    v = basisStats(basisYear(s));
    statsCache.set(k, v);
  }
  return v;
}

/**
 * The first challenge: in the harsh winter, with Ridgeback Express as built, the least Northline
 * capacity (on the slider's 0.05 Bcf/d steps) at which Metro never trades more than $1 over Calder.
 */
export function northlineSolved(s: BasisState): boolean {
  if (s.winter !== 'harsh' || Math.abs(s.express - RE.capacityBcfd) > 1e-9) return false;
  if (basisStatsFor(s).metroOver1 > 0) return false;
  return basisStatsFor({ ...s, northline: round2(s.northline - CAP_STEP) }).metroOver1 > 0;
}

// ---------------------------------------------------------------------------
// Six years of growth at Ridgeback.

/** Ridgeback's production grows steadily from today's 2.6 Bcf/d; Bayport's LNG terminal grows alongside to take the new gas. */
export const GROWTH = { start: RIDGEBACK_PROD, perYear: 0.12, years: 6, firstSeed: 40 };
export const EXPANSION_SIZES = [0.25, 0.5, 1] as const;
export type ExpansionYear = 'never' | '2' | '3' | '4' | '5' | '6';
export const GROWTH_DEFAULTS = { online: 'never' as ExpansionYear, size: '0.5' as `${(typeof EXPANSION_SIZES)[number]}` };
/** Ridgeback's takeaway: Ridgeback Express, the Coastal Line, and the field's own use. */
export const TAKEAWAY = RE.capacityBcfd + CL.capacityBcfd + FIELD_USE;

/** Ridgeback production on day `day` of growth year `i` (0-based), Bcf/d. */
export function growthProduction(i: number, day: number): number {
  return GROWTH.start + GROWTH.perYear * (i + day / GAS_YEAR_DAYS);
}

const growthCache = new Map<string, YearDay[]>();
/** One year of the growth story, with Ridgeback Express at `express` Bcf/d. */
export function growthYear(i: number, express: number): YearDay[] {
  const k = `${i}|${round2(express)}`;
  let y = growthCache.get(k);
  if (!y) {
    const mid = growthProduction(i, GAS_YEAR_DAYS / 2);
    const lng = (p: number) => 1.2 + p - GROWTH.start;
    const capacity = { [RE.id]: round2(express) };
    const plan = planFor({ production: { ridgeback: round2(mid) }, demand: { lngBcfd: round2(lng(mid)) }, capacity });
    y = simulateYear({
      weather: weatherYear(GROWTH.firstSeed + i),
      plan,
      production: (d) => ({ ridgeback: growthProduction(i, d) }),
      demand: (d) => ({ lngBcfd: lng(growthProduction(i, d)) }),
      capacity: () => capacity,
    });
    growthCache.set(k, y);
  }
  return y;
}

export interface GrowthRun {
  /** Average Ridgeback basis in each of the 72 months, $/MMBtu. */
  monthly: number[];
  /** Ridgeback Express's capacity in each year, Bcf/d. */
  express: number[];
  /** Ridgeback Express's rent in each year, $. */
  rent: number[];
  /** Average Calder price in each year. */
  calder: number[];
}

/** The six years with an expansion of `size` Bcf/d coming online at the start of year `online` (1-based), or never. */
export function growthRun(online: ExpansionYear, size: number): GrowthRun {
  const monthly: number[] = [];
  const express: number[] = [];
  const rent: number[] = [];
  const calder: number[] = [];
  for (let i = 0; i < GROWTH.years; i++) {
    const cap = RE.capacityBcfd + (online !== 'never' && i + 1 >= Number(online) ? size : 0);
    const y = growthYear(i, cap);
    express.push(cap);
    rent.push(pipeRent(y, RE.id));
    calder.push(y.reduce((s, d) => s + d.price.calder, 0) / y.length);
    for (let m = 0; m < 12; m++) {
      const ds = y.filter((d) => monthOfDay(d.day) === m);
      monthly.push(ds.reduce((s, d) => s + d.price.ridgeback - d.price.calder, 0) / ds.length);
    }
  }
  return { monthly, express, rent, calder };
}

/** A month counts as normal when Ridgeback trades within $0.20 of Calder (the $0.12 trip and a little more). */
export const NORMAL_GAP = -0.2;

/** The second challenge: with a 0.5 Bcf/d expansion, the latest year it can come online with no month's basis below −$0.20. */
export function latestYearSolved(s: typeof GROWTH_DEFAULTS): boolean {
  if (s.size !== '0.5' || s.online === 'never') return false;
  const ok = (y: ExpansionYear) => growthRun(y, 0.5).monthly.every((b) => b >= NORMAL_GAP);
  if (!ok(s.online)) return false;
  const later = String(Number(s.online) + 1) as ExpansionYear;
  return Number(s.online) === GROWTH.years || !ok(later);
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const HARSH = basisStatsFor(BASIS_DEFAULTS);
const MILD = basisStatsFor({ ...BASIS_DEFAULTS, winter: 'mild' });
const TYPICAL = basisStatsFor({ ...BASIS_DEFAULTS, winter: 'typical' });
const NL_OUT = basisStatsFor({ ...BASIS_DEFAULTS, northline: NORTHLINE_STATION_OUT });
const SWITCH_STEP = COAL_SWITCH_BLOCKS[0].value - COAL_SWITCH_BLOCKS[1].value;
const SWITCH_BLOCK = COAL_SWITCH_BLOCKS[0].bcfd;
const RE_16 = basisStatsFor({ ...BASIS_DEFAULTS, express: round2(RIDGEBACK_PROD - CL.capacityBcfd - FIELD_USE - CAP_STEP) });
/** The lowest Ridgeback Express capacity, on the slider's steps, that still carries all of Ridgeback's gas out. */
export const EXPRESS_ENOUGH = round2(RIDGEBACK_PROD - CL.capacityBcfd - FIELD_USE);
const RE_ENOUGH = basisStatsFor({ ...BASIS_DEFAULTS, express: EXPRESS_ENOUGH });
const RE_BELOW = round2(EXPRESS_ENOUGH - CAP_STEP);
const NEVER = growthRun('never', 0.5);
const FIRST_BAD_MONTH = NEVER.monthly.findIndex((b) => b < NORMAL_GAP);
/** Production crosses the takeaway during this growth year (0-based). */
const CROSS_YEAR = Math.floor((TAKEAWAY - GROWTH.start) / GROWTH.perYear);
const END_PRODUCTION = growthProduction(GROWTH.years - 1, GAS_YEAR_DAYS);
const QUARTER = growthRun('4', 0.25);
const QUARTER_BAD = QUARTER.monthly.findIndex((b) => b < NORMAL_GAP);

/** The duration chart shows this many of the year's days. */
const WIDEST = 60;
const widestDays = Array.from({ length: WIDEST + 1 }, (_, i) => i);
const METRO_COLOR = GRAPHIC.green;
const RIDGE_COLOR = '#6b6b6b';

function monthLabel(i: number): string {
  return `${GAS_MONTH_NAMES[i % 12]} of year ${Math.floor(i / 12) + 1}`;
}

/** "$3.06 million", or "nothing" for a rent under $1,000. */
function rentText(x: number): string {
  return x < 1000 ? 'nothing' : money(x);
}

export default function Lesson() {
  // ---- Figure 1.
  const s = useScenario('basis', BASIS_DEFAULTS);
  const st = s.state;
  const deferred = useDeferredValue(st);
  const stats = useMemo(() => basisStatsFor(deferred), [deferred]);
  const days = useMemo(() => Array.from({ length: GAS_YEAR_DAYS }, (_, d) => d), []);
  const sortedMetro = useMemo(() => [...stats.metro].sort((a, b) => b - a), [stats]);
  const sortedRidge = useMemo(() => [...stats.ridgeback].sort((a, b) => a - b), [stats]);
  const [y0, y1] = niceDomain(Math.min(-0.5, stats.ridgebackMin), Math.max(0.5, stats.metroMax), 4);
  const [cursor, setCursor] = useState(294);
  const day = Math.max(0, Math.min(GAS_YEAR_DAYS - 1, Math.round(cursor)));
  const solvedA = northlineSolved(st);

  // ---- Figure 2.
  const g = useScenario('growth', GROWTH_DEFAULTS);
  const gd = useDeferredValue(g.state);
  const run = useMemo(() => growthRun(gd.online, Number(gd.size)), [gd]);
  const months = useMemo(() => Array.from({ length: GROWTH.years * 12 }, (_, i) => i), []);
  const prodLine = useMemo(() => months.map((i) => growthProduction(Math.floor(i / 12), ((i % 12) + 0.5) * (GAS_YEAR_DAYS / 12))), [months]);
  const takeaway = run.express.flatMap((c) => Array<number>(12).fill(c + CL.capacityBcfd + FIELD_USE));
  const [g0] = niceDomain(Math.min(-0.5, ...run.monthly), 0, 3);
  const badMonths = run.monthly.filter((b) => b < NORMAL_GAP).length;
  const totalRent = run.rent.reduce((a, b) => a + b, 0);
  const solvedB = latestYearSolved(g.state);
  const [gCursor, setGCursor] = useState(57);
  const gm = Math.max(0, Math.min(months.length - 1, Math.round(gCursor)));

  const statusA =
    st.winter !== 'harsh'
      ? 'Choose the harsh winter first.'
      : Math.abs(st.express - RE.capacityBcfd) > 1e-9
        ? `Put Ridgeback Express back to its ${bcfd(RE.capacityBcfd, 1)} first.`
        : stats.metroOver1 > 0
          ? `At ${bcfd(st.northline)}, Metro’s line on the lower chart still rises above the $1 line.`
          : `At ${bcfd(st.northline)}, Metro’s line stays under the $1 line all year. Would a smaller Northline do?`;

  const statusB =
    g.state.size !== '0.5'
      ? 'Choose the 0.5 Bcf/d expansion.'
      : g.state.online === 'never'
        ? 'Choose a year for the expansion to come online.'
        : badMonths > 0
          ? `Online in year ${g.state.online}, ${badMonths} month${badMonths === 1 ? '' : 's'} still see Ridgeback more than $0.20 under Calder.`
          : `Online in year ${g.state.online}, every month stays within $0.20. Could it come later?`;

  return (
    <LessonPage id="gas/5.1">
      <P>
        Chapter 4 ended with a list of price differences — Metro against Calder, January against July, a cold winter against a mild one — and the claim that each has
        a physical cause. This chapter takes them one at a time and asks which of them are worth anything: which are steady enough, large enough or valuable enough to
        build a pipeline for, run a storage field on, or trade. We start with the gap between two places, the <K c="price">basis</K> of{' '}
        <a href={lessonHref('gas/4.2')}>Lesson 4.2</a>.
      </P>
      <P>
        Two places on a pipeline network can’t differ in price by more than the cost of moving gas between them, so long as the pipeline between them has room:
        anyone could buy at the cheap end, ship, and sell at the dear end. A basis wider than the cost of transport needs something that stops the shipping. That
        something is always a full pipeline — a cut, in the language of <a href={lessonHref('gas/3.2')}>Lesson 3.2</a> — and there are two places in our region where
        one can bind. Gas can fail to get <i>into</i> a market, as it does into Metro on the coldest days, or fail to get <i>out of</i> a basin, as it would out of
        Ridgeback if the basin produced more than its pipelines could carry. Either way, someone collects the gap. Whoever holds space on the full pipe can still
        buy at the cheap end, ship, and sell at the dear end, and keeps the price gap beyond the cost of the trip on every MMBtu the pipe carries: the pipe’s{' '}
        <K c="price">rent</K>.
      </P>
      <P>
        Lesson 4.2 looked at single days. In the next demonstration, the region runs through a whole gas year, April to March, with the weather of one of that
        lesson’s three winters; as everywhere in this course, the prices are simulated. The upper chart traces Metro’s and Ridgeback’s basis to Calder day by day; the
        lower one sorts the year’s days from the widest basis to the narrowest and shows the {WIDEST} widest, which tells at a glance how many days are unusual. Choose a winter, and change the <K tone="orange">capacity</K> of Northline, Metro’s main
        supply line, and of Ridgeback Express, the basin’s main outlet:
      </P>

      <Figure name="Regional Basis Simulator" scenario={s}>
        <Segmented
          label="Winter"
          value={st.winter}
          onChange={(v) => s.set({ winter: v })}
          options={[
            { value: 'mild', label: 'Mild winter' },
            { value: 'typical', label: 'Typical winter' },
            { value: 'harsh', label: 'Harsh winter' },
          ]}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[y0, y1]}
          yTicks={niceTicks(y0, y1, 4)}
          xTicks={GAS_MONTH_START}
          xFormat={(v) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? ''}
          yFormat={(v) => (v > 0 ? `+$${fmt(v)}` : v < 0 ? `−$${fmt(-v)}` : '$0')}
          yLabel="Basis to Calder, $/MMBtu, day by day"
          height={200}
          series={[
            { xs: days, ys: stats.ridgeback, color: RIDGE_COLOR, width: 1.6 },
            { xs: days, ys: stats.metro, color: METRO_COLOR, width: 1.6 },
          ]}
          markers={[
            { x: day, y: stats.metro[day], color: METRO_COLOR, r: 4 },
            { x: day, y: stats.ridgeback[day], color: RIDGE_COLOR, r: 4 },
          ]}
          cursor={day}
          onScrub={setCursor}
          scrubLabel="Day of the gas year"
          ariaLabel={`Metro’s and Ridgeback’s basis to Calder through the ${st.winter} gas year with Northline at ${fmt(st.northline, 2)} and Ridgeback Express at ${fmt(st.express, 2)} Bcf/d. Metro averages ${basis(stats.metroAvg)} and peaks at ${basis(stats.metroMax)}; Ridgeback averages ${basis(stats.ridgebackAvg)}.`}
        />
        <XYChart
          xDomain={[0, WIDEST]}
          yDomain={[y0, y1]}
          yTicks={niceTicks(y0, y1, 4)}
          xTicks={[0, 10, 20, 30, 40, 50, 60]}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => (v > 0 ? `+$${fmt(v)}` : v < 0 ? `−$${fmt(-v)}` : '$0')}
          yLabel={`The ${WIDEST} days with the widest basis, widest first`}
          xLabel="days"
          height={170}
          series={[
            { xs: widestDays, ys: sortedRidge.slice(0, WIDEST + 1), color: RIDGE_COLOR, width: 2 },
            { xs: widestDays, ys: sortedMetro.slice(0, WIDEST + 1), color: METRO_COLOR, width: 2 },
          ]}
          hLines={[{ at: 1, color: '#9a9a9a', dash: '4 4', label: '$1 over Calder', labelAt: 'end', width: 1 }]}
          ariaLabel={`The year’s days sorted by basis: Metro is more than $1 over Calder on ${stats.metroOver1} days and Ridgeback more than $0.50 under it on ${stats.ridgebackUnder50}.`}
        />
        <Legend
          items={[
            { label: 'Metro − Calder', color: METRO_COLOR, kind: 'line' },
            { label: 'Ridgeback − Calder', color: RIDGE_COLOR, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'Metro’s average basis', value: basis(stats.metroAvg), tone: 'green' },
            { label: 'Ridgeback’s average basis', value: basis(stats.ridgebackAvg), tone: 'green' },
            { label: 'rent on Northline', value: money(stats.northlineRent), tone: 'green' },
            { label: 'rent on Ridgeback Express', value: money(stats.expressRent), tone: 'green' },
          ]}
        />
        <Slider label="Northline’s capacity" tone="orange" value={st.northline} min={1.2} max={2.2} step={CAP_STEP} onChange={(v) => s.set({ northline: round2(v) })} display={bcfd(st.northline)} />
        <Slider label="Ridgeback Express’s capacity" tone="orange" value={st.express} min={1.4} max={2.4} step={CAP_STEP} onChange={(v) => s.set({ express: round2(v) })} display={bcfd(st.express)} />
        <Caption>
          On {GAS_MONTHS[monthOfDay(day)]} {day - GAS_MONTH_START[monthOfDay(day)] + 1} Metro is {basis(stats.metro[day])} and Ridgeback {basis(stats.ridgeback[day])} against
          Calder. Calder averages {gp(stats.calderAvg)} over the year.
        </Caption>
      </Figure>

      <P>
        Start with the harsh winter and the pipelines as built. For {HARSH.metroAtTrip} days of the year Metro sits at {basis(NL.variableCost)}, the cost
        of a trip up Northline, and Ridgeback at {basis(-RE.variableCost)}, the cost of the trip down Ridgeback Express. On {HARSH.metroOver1} winter days Northline fills,
        Hollow Creek can’t make up the rest, and Metro breaks away, as high as {basis(HARSH.metroMax)}. The year’s average basis is only {basis(HARSH.metroAvg)}, but
        Northline’s rent on those few days comes to {money(HARSH.northlineRent)}. That money goes to whoever holds Northline’s capacity: it is the firm capacity value of <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>, counted over all of the pipe. The typical
        winter makes {rentText(TYPICAL.northlineRent)}, and the mild one {rentText(MILD.northlineRent)}.
      </P>

      <H2>Into a market</H2>
      <P>
        Lower Northline’s capacity to {bcfd(NORTHLINE_STATION_OUT)}, as if one of its three compressor stations were out all year: the two left can push about{' '}
        {fmt(NORTHLINE_STATION_OUT_MMCFD)} MMcf/d through it, as <a href={lessonHref('gas/1.4')}>Lesson 1.4</a> found. The basis doesn’t widen a little every day. Most
        days are untouched; what changes is how many days cross the line — {NL_OUT.metroOver1} instead of {HARSH.metroOver1} — and the average rises to{' '}
        {basis(NL_OUT.metroAvg)}. A
        basis into a market is set by the market’s cold days, and the pipe decides how cold a day has to be before it binds.
      </P>
      <P>
        When it does bind, the basis has a ceiling, and the ceiling is not a cost of moving gas. With every molecule that can reach Metro already there, the city’s
        price climbs the demand curve of <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> until enough users have stopped: {gp(OIL_SWITCH_VALUE, 0)} when power plants
        switch to oil, {gp(PROTECTED_VALUE, 0)} — rationing — if homes must be cut. A congested market’s basis is the value of the gas it can’t get, less the hub price.
      </P>

      <Challenge
        id="a"
        figure="Regional Basis Simulator"
        question={`In the harsh winter, with Ridgeback Express as built, what’s the least capacity Northline needs, on the slider’s steps, for Metro never to trade more than $1 above Calder? Judge it from the lower chart and its $1 line. Before you move the slider, guess what Northline’s ${money(HARSH.northlineRent)} rent falls to at that size.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${bcfd(st.northline)}, ${bcfd(st.northline - NL.capacityBcfd)} more than Northline has. A step less and Metro still breaks away on ${basisStatsFor({ ...st, northline: round2(st.northline - CAP_STEP) }).metroOver1} day${basisStatsFor({ ...st, northline: round2(st.northline - CAP_STEP) }).metroOver1 === 1 ? '' : 's'}. Expanded that far, Northline would earn its holders ${money(stats.northlineRent)} in the harsh winter instead of ${money(HARSH.northlineRent)} — an expansion destroys the very rent that measures how much it is needed, which is why it has to be paid for by contracts signed in advance.`}
      />

      <H2>Out of a basin</H2>
      <P>
        Now put Northline back and lower Ridgeback Express instead. Down to {bcfd(EXPRESS_ENOUGH)} nothing happens at all: Ridgeback’s{' '}
        {bcfd(RIDGEBACK_PROD, 1)} still fits out through Ridgeback Express, the {bcfd(CL.capacityBcfd)} Coastal Line and the {bcfd(FIELD_USE, 1)} the field burns
        itself, and its basis stays at {basis(RE_ENOUGH.ridgebackAvg)}. One step lower, at {bcfd(RE_BELOW)}, the outlets add up to{' '}
        {bcfd(RE_BELOW + CL.capacityBcfd + FIELD_USE)}, less than the field produces. Every day of the year some gas has nowhere to go, and Ridgeback’s price falls to{' '}
        {gp(RIDGEBACK_COST)}, the cost of keeping its wells flowing: its basis averages {basis(RE_16.ridgebackAvg)}. A basin’s basis has a floor, and the floor is
        its producers’ cost of carrying on, not anything about the hub — which is why, where gas comes up with oil and must flow regardless, it can sink below zero.
      </P>
      <P>
        Watch Calder at the same time. Only {bcfd(RIDGEBACK_PROD - (RE_BELOW + CL.capacityBcfd + FIELD_USE))} is stranded, but the hub averages {gp(RE_16.calderAvg)} for
        the year against {gp(HARSH.calderAvg)} with the pipe as built. A small loss moves the hub that far because the region’s demand is steep at the margin: most
        of the gas is given up by Metro’s power plants, which switch between coal and gas in blocks of {bcfd(SWITCH_BLOCK)} set {fmt(SWITCH_STEP * 100)}¢ apart (
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a>). Losing one block’s worth of gas moves the region about one block up its demand curve, about{' '}
        {fmt(SWITCH_STEP * 100)}¢ on the average day. The same cut that floods the basin starves the market: the gap opens from both sides at once, and Ridgeback
        Express’s holders collect {money(RE_16.expressRent)} on it.
      </P>

      <H2>Growth and lumps</H2>
      <P>
        Pipelines aren’t derated for a year very often. The usual way a basin’s basis blows out is growth. Wells are drilled every month, so production rises smoothly;
        pipelines are built a few at a time, take years to plan and come online all at once. Suppose Ridgeback’s production grows by{' '}
        {bcfd(GROWTH.perYear)} a year from today’s {bcfd(GROWTH.start, 1)}, and suppose there is a buyer for every new cubic foot — Bayport’s LNG terminal, say, adding
        liquefaction as fast. Ridgeback’s <K tone="orange">takeaway</K> capacity — the most gas that can leave the basin through Ridgeback Express and the Coastal
        Line, plus what the field burns itself — is {bcfd(TAKEAWAY)}. In the next demonstration the region runs through six years of that growth, each with its own
        weather; the upper chart is Ridgeback’s basis, month by month, and the lower one compares production with the takeaway. Choose when an expansion of
        Ridgeback Express comes online, and how big it is:
      </P>

      <Figure name="Regional Basis Simulator · growth and expansion" scenario={g}>
        <Segmented
          label="Expansion online"
          value={g.state.online}
          onChange={(v) => g.set({ online: v })}
          options={[
            { value: 'never', label: 'Never' },
            ...(['2', '3', '4', '5', '6'] as const).map((y) => ({ value: y, label: `Year ${y}` })),
          ]}
        />
        <Segmented
          label="Expansion size"
          value={g.state.size}
          onChange={(v) => g.set({ size: v })}
          options={EXPANSION_SIZES.map((x) => ({ value: `${x}` as `${(typeof EXPANSION_SIZES)[number]}`, label: `+${fmt(x, 2)} Bcf/d` }))}
        />
        <XYChart
          xDomain={[0, months.length]}
          yDomain={[g0, 0.5]}
          yTicks={niceTicks(g0, 0, 3)}
          xTicks={months.filter((i) => i % 12 === 6)}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={(v) => (v < 0 ? `−$${fmt(-v)}` : '$0')}
          yLabel="Ridgeback − Calder, monthly average, $/MMBtu"
          height={190}
          series={[{ xs: [...months, months.length], ys: [...run.monthly, run.monthly[run.monthly.length - 1]], color: RIDGE_COLOR, kind: 'step', width: 2 }]}
          hLines={[{ at: NORMAL_GAP, color: '#9a9a9a', dash: '4 4', label: '−$0.20', labelAt: 'start', width: 1 }]}
          vLines={months.filter((i) => i % 12 === 0 && i > 0).map((i) => ({ at: i, color: '#d9d9d5', dash: '2 3', width: 1 }))}
          cursor={gm + 0.5}
          onScrub={(x) => setGCursor(x - 0.5)}
          scrubLabel="Month of the six years"
          ariaLabel={`Ridgeback’s basis to Calder month by month over six years of growth, ${g.state.online === 'never' ? 'with no expansion' : `with a ${g.state.size} Bcf/d expansion online in year ${g.state.online}`}. ${badMonths} months are more than $0.20 below Calder; the lowest is ${basis(Math.min(...run.monthly))}.`}
        />
        <XYChart
          xDomain={[0, months.length]}
          yDomain={[2.5, 4.2]}
          yTicks={[2.5, 3, 3.5, 4]}
          xTicks={months.filter((i) => i % 12 === 6)}
          xFormat={(v) => `Year ${Math.floor(v / 12) + 1}`}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Ridgeback, Bcf/d"
          height={150}
          series={[
            { xs: months.map((i) => i + 0.5), ys: prodLine, color: GRAPHIC.orange, width: 2.5, label: 'production', labelColor: TEXT.orange },
            { xs: [...months, months.length], ys: [...takeaway, takeaway[takeaway.length - 1]], color: '#333', kind: 'step', width: 2, dash: '6 4', label: 'takeaway', labelColor: TEXT.ink },
          ]}
          cursor={gm + 0.5}
          ariaLabel={`Ridgeback’s production rising from ${bcfd(GROWTH.start, 2)} to ${bcfd(END_PRODUCTION, 2)} against takeaway of ${bcfd(takeaway[0], 2)}${g.state.online === 'never' ? '' : `, rising to ${bcfd(takeaway[takeaway.length - 1], 2)} in year ${g.state.online}`}.`}
        />
        <Readouts
          items={[
            { label: monthLabel(gm), value: basis(run.monthly[gm]), tone: 'green' },
            { label: 'months below −$0.20', value: fmt(badMonths) },
            { label: 'rent on Ridgeback Express, six years', value: money(totalRent), tone: 'green' },
            { label: 'Calder’s average, year 6', value: gp(run.calder[GROWTH.years - 1]), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        With no expansion, for more than three years nothing seems to happen: production climbs toward the takeaway with the basis pinned at{' '}
        {basis(-RE.variableCost)}. Production closes in on {bcfd(TAKEAWAY)} during year {CROSS_YEAR + 1}, and in {monthLabel(FIRST_BAD_MONTH)} the basis breaks. From
        then on it never recovers, because production keeps growing: by year 6 Ridgeback’s gas sells for its {gp(RIDGEBACK_COST)} cost while Calder, short of the gas that
        can’t get out, averages {gp(NEVER.calder[GROWTH.years - 1])}. The producers lose the difference on every MMBtu; the shippers on Ridgeback Express collect{' '}
        {money(NEVER.rent.reduce((a, b) => a + b, 0))} over the six years.
      </P>
      <P>
        Bring an expansion online and the basis snaps back to the cost of the trip — not gradually, but the day the new capacity opens. Size matters as well as timing,
        up to a point. Production reaches {bcfd(END_PRODUCTION)} by the end of year 6, so a {bcfd(0.25, 2)} expansion in year 4 buys only a couple of years before
        the basis breaks again{QUARTER_BAD >= 0 ? `, in ${monthLabel(QUARTER_BAD)}` : ''}, while a {bcfd(1, 2)} expansion does no better than a {bcfd(0.5, 2)} one:
        the smaller one already lifts the takeaway to {bcfd(TAKEAWAY + 0.5)}, more than the six years ever produce. A basin’s basis follows a sawtooth: tight,
        blown out, relieved by a new pipe, and tight again as drilling catches up.
      </P>

      <Challenge
        id="b"
        figure="Regional Basis Simulator · growth and expansion"
        question="With a 0.5 Bcf/d expansion of Ridgeback Express, what’s the latest year it can come online so that no month sees Ridgeback trading more than $0.20 below Calder? Predict it from the month the basis first breaks, then check."
        solved={solvedB}
        status={statusB}
        success={`Solved: year ${g.state.online}. Production reaches the takeaway during year ${CROSS_YEAR + 1}, so the new capacity has to be there by then — and a pipeline takes years to plan, permit and build. The shippers who sign up for it are betting on production they can only forecast, which is why basins tend to run short of pipe before the pipe arrives.`}
      />

      <H2>A rent on a full pipe</H2>
      <P>
        Every basis wider than the cost of the trip, in <FigRef to="Regional Basis Simulator">the first demonstration</FigRef> and the second, has the same anatomy. A pipeline is full; the price on its far side is set by whatever the market there
        does without, and the price on its near side by whatever the basin there would rather not produce; and the difference, beyond the cost of moving the gas, is a
        rent paid to whoever holds the pipe’s capacity. It is not a mispricing, and no amount of trading closes it — only steel does. Trading on basis, which{' '}
        <a href={lessonHref('gas/6.3')}>Lesson 6.3</a> takes up, is therefore a bet on pipes and weather: on whether a constraint will bind, how often, and how hard.
      </P>
      <P>
        The same logic applies to the gap between seasons, with storage in place of the pipe. Storage’s rent is less obvious, because a storage field’s owner can
        choose when to fill and when to empty, and that choice has a value of its own. Valuing it is the subject of <a href={lessonHref('gas/5.2')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
