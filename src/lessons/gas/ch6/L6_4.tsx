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
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { curveAt, monthAverage } from '../../../engines/gas/futures';
import { switchingGasPrice } from '../../../engines/market/offerCost';
import {
  leasedStorage,
  monthlyStorageOptimum,
  powerAsset,
  ridgebackTakeaway,
  storageAsset,
  transportAsset,
  type AssetYear,
  type StorageYear,
} from '../../../engines/gas/strategies';
import { fleetById } from '../../../model/fleet';
import { gasHistory } from '../../../model/gas/history';
import { GAS_MONTHS, GAS_MONTH_NAMES, GAS_YEAR_DAYS, WINTER_START } from '../../../model/gas/weather';
import { PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { bcf, bcfd, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The three assets and their eight years.

/** The storage lease: this much of Salt Flat's working gas, with its rights scaled down (Lesson 5.2's lease). */
export const LEASE_BCF = 1;
/** Firm capacity held on a pipeline, MMBtu a day (the desk size of Lesson 6.3). */
export const FIRM_MMBTU_D = 10_000;
const MILLION = 1e6;
/** What the lease pays to inject or withdraw, $/MMBtu each way (the strategies engine's storage cost, as in Lesson 5.2). */
const LEASE_COST = 0.05;
const NORTHLINE = PIPELINE['calder-metro'];
const EXPRESS = PIPELINE['ridgeback-calder'];

export interface ArbitrageData {
  /** The lease each year: April's intrinsic value, earned unhedged and hedged (rolling intrinsic), and its schedule as run. */
  lease: StorageYear[];
  /** The schedule April 1's curve called for each year: each month's move, Bcf (+ injection). */
  aprilPlan: number[][];
  /** Each year's April 1 curve and each month's realized average at Calder, $/MMBtu (April first). */
  curve: number[][];
  average: number[][];
  northline: AssetYear[];
  express: AssetYear[];
  lakeside: AssetYear[];
  /** The physical drivers: each winter's degree-days colder than normal (Nov–Mar), the year's coldest day at Metro (°F), Ridgeback's production less its takeaway (Bcf/d), Metro's average gas price ($/MMBtu). */
  colder: number[];
  coldest: number[];
  surplus: number[];
  metroAvg: number[];
}

let dataCache: ArbitrageData | null = null;

/** Everything the figures show, computed once from the history (call lazily). */
export function arbitrageData(): ArbitrageData {
  if (dataCache) return dataCache;
  const h = gasHistory();
  const spec = leasedStorage(LEASE_BCF / STORAGE_SPECS.saltflat.workingBcf);
  const start = spec.workingBcf * 0.25;
  const curve = h.map((_, y) => Array.from({ length: 12 }, (_, k) => curveAt(y * 12).calder[y * 12 + k]));
  dataCache = {
    lease: storageAsset(LEASE_BCF / STORAGE_SPECS.saltflat.workingBcf),
    aprilPlan: curve.map((c) => monthlyStorageOptimum(c, spec, { startCal: 0, start, end: start }).moves),
    curve,
    average: h.map((_, y) => Array.from({ length: 12 }, (_, k) => monthAverage(y * 12 + k, 'calder'))),
    northline: transportAsset('northline', FIRM_MMBTU_D),
    express: transportAsset('express', FIRM_MMBTU_D),
    lakeside: powerAsset(),
    colder: h.map((y) => {
      let s = 0;
      for (let d = WINTER_START; d < GAS_YEAR_DAYS; d++) s += y.weather.normal[d] - y.weather.temp[d];
      return s;
    }),
    coldest: h.map((y) => Math.min(...y.days.map((d) => d.tempF))),
    surplus: h.map((y) => y.conditions.ridgeback - ridgebackTakeaway(y.conditions)),
    metroAvg: h.map((y) => y.days.reduce((s, d) => s + d.price.metro, 0) / y.days.length),
  };
  return dataCache;
}

/** Gas in the lease at the start of each month and at the end of March (13 values), given its moves. */
export function leasePath(moves: number[]): number[] {
  const out = [LEASE_BCF * 0.25];
  for (const m of moves) out.push(out[out.length - 1] + m);
  return out;
}

// ---------------------------------------------------------------------------
// Figure 1: the lease through one year.

export const ARB_LEASE_DEFAULTS = { year: 1 };
export type ArbLeaseState = typeof ARB_LEASE_DEFAULTS;

/** The year (1-based) in which the unhedged lease earned the smallest share of what April's curve offered. */
export function worstUnhedgedYear(): number {
  const l = arbitrageData().lease;
  let best = 0;
  l.forEach((a, y) => {
    if (a.realized / a.forward < l[best].realized / l[best].forward) best = y;
  });
  return best + 1;
}

/** The first challenge: the year chosen is the one in which running unhedged fell furthest short of April's value. */
export function leaseYearSolved(s: ArbLeaseState): boolean {
  return s.year === worstUnhedgedYear();
}

// ---------------------------------------------------------------------------
// Figure 2: eight years of each asset against a fee.

export type ArbAsset = 'hedged' | 'unhedged' | 'northline' | 'express' | 'lakeside';
export type ArbRule = 'every' | 'april';
type FeeKey = 'lease' | 'northline' | 'express' | 'lakeside';

/** Fee sliders, $ million a year. */
export const FEE_SCALE: Record<FeeKey, { max: number; step: number }> = {
  lease: { max: 5, step: 0.1 },
  northline: { max: 1.5, step: 0.05 },
  express: { max: 10, step: 0.25 },
  lakeside: { max: 8, step: 0.25 },
};

/** The fees start near each asset's average April value over the eight years ($ million a year). */
export const ARBITRAGE_DEFAULTS = { asset: 'hedged' as ArbAsset, rule: 'every' as ArbRule, lease: 2.5, northline: 0.3, express: 0.75, lakeside: 4.25 };
export type ArbitrageState = typeof ARBITRAGE_DEFAULTS;

export const feeKeyOf = (a: ArbAsset): FeeKey => (a === 'hedged' || a === 'unhedged' ? 'lease' : a);

/** Each year's April value and earnings for an asset, $. */
export function assetValues(asset: ArbAsset): Array<{ forward: number; earned: number }> {
  const d = arbitrageData();
  if (asset === 'hedged') return d.lease.map((a) => ({ forward: a.forward, earned: a.hedged }));
  if (asset === 'unhedged') return d.lease.map((a) => ({ forward: a.forward, earned: a.realized }));
  return d[asset].map((a) => ({ forward: a.forward, earned: a.realized }));
}

export interface ArbYear {
  year: number;
  forward: number;
  earned: number;
  held: boolean;
  /** Earnings less the fee in a year held, else 0, $. */
  profit: number;
}

/** The eight years of an asset under a fee and a holding rule. */
export function arbitrageYears(s: ArbitrageState): ArbYear[] {
  const fee = s[feeKeyOf(s.asset)] * MILLION;
  return assetValues(s.asset).map((v, year) => {
    const held = s.rule === 'every' || v.forward > fee;
    return { year, forward: v.forward, earned: v.earned, held, profit: held ? v.earned - fee : 0 };
  });
}

export function arbitrageTotal(s: ArbitrageState): number {
  return arbitrageYears(s).reduce((a, y) => a + y.profit, 0);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The highest lease fee on the slider's steps at which the hedged lease, held every year, made money in all eight. */
export function leaseFloorFee(): number {
  const min = Math.min(...arbitrageData().lease.map((a) => a.hedged)) / MILLION;
  const step = FEE_SCALE.lease.step;
  let k = Math.floor(min / step + 1e-9);
  if (k * step >= min - 1e-12) k -= 1;
  return round2(k * step);
}

/** The second challenge: hedged lease, held every year, at the highest fee that loses in no year. */
export function arbitrageSolved(s: ArbitrageState): boolean {
  return s.asset === 'hedged' && s.rule === 'every' && Math.abs(round2(s.lease) - leaseFloorFee()) < 1e-9;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const argmin = (xs: number[]) => xs.indexOf(Math.min(...xs));
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

/** Every number the prose quotes (call lazily: it needs the whole history). */
export function arbitrageNumbers() {
  const d = arbitrageData();
  const fwd = d.lease.map((a) => a.forward);
  const hedged = d.lease.map((a) => a.hedged);
  const unhedged = d.lease.map((a) => a.realized);
  const ratio = unhedged.map((u, y) => u / fwd[y]);
  const colderYears = d.colder.map((c, y) => (c > 0 ? y : -1)).filter((y) => y >= 0);
  const mildYears = d.colder.map((c, y) => (c < -100 ? y : -1)).filter((y) => y >= 0);
  const worst = worstUnhedgedYear() - 1;
  const sellMonth = argmin(d.lease[worst].moves);
  const north = d.northline.map((a) => a.realized);
  const northFwd = d.northline.map((a) => a.forward);
  const expYears = d.express.map((a, y) => (a.forward > 1 ? y : -1)).filter((y) => y >= 0);
  const lake = d.lakeside.map((a) => a.realized);
  const lakeDev = Math.ceil(100 * Math.max(...d.lakeside.map((a) => Math.abs(a.realized - a.forward) / a.realized))) / 100;
  const total = (asset: ArbAsset, rule: ArbRule) => arbitrageTotal({ ...ARBITRAGE_DEFAULTS, asset, rule });
  const floor = leaseFloorFee();
  return {
    allAbove: hedged.every((x, y) => x >= fwd[y]),
    hedgedMin: Math.min(...hedged),
    hedgedMinYear: argmin(hedged) + 1,
    hedgedMax: Math.max(...hedged),
    hedgedMaxYear: argmax(hedged) + 1,
    hedgedExtra: mean(hedged) - mean(fwd),
    fwdAvg: mean(fwd),
    unhedgedMin: Math.min(...unhedged),
    unhedgedMax: Math.max(...unhedged),
    colderYears,
    colderMinRatio: Math.min(...colderYears.map((y) => ratio[y])),
    mildYears,
    mildLow: Math.min(...mildYears.map((y) => ratio[y])),
    mildHigh: Math.max(...mildYears.map((y) => ratio[y])),
    worst,
    worstRatio: ratio[worst],
    worstWarmer: -d.colder[worst],
    worstSellMonth: sellMonth,
    worstSellBcf: -d.lease[worst].moves[sellMonth],
    worstSellAvg: d.average[worst][sellMonth],
    worstSellQuote: d.curve[worst][sellMonth],
    northFlat: Math.max(...northFwd) - Math.min(...northFwd) < 1,
    northFwd: northFwd[0],
    northAvg: mean(north),
    northCalm: Math.min(...north),
    northCalmMax: Math.max(...north.filter((x) => x < 0.05 * MILLION)),
    northBestYear: argmax(north),
    northBest: Math.max(...north),
    northBestColdest: d.coldest[argmax(north)],
    northCalmCount: north.filter((x) => x < 0.05 * MILLION).length,
    expYears,
    expYear: expYears[0],
    expFwd: d.express[expYears[0]]?.forward ?? 0,
    expEarned: d.express[expYears[0]]?.realized ?? 0,
    expSurplus: d.surplus[expYears[0]] ?? 0,
    lakeDev,
    lakeMaxYear: argmax(lake),
    lakeMax: Math.max(...lake),
    lakeMinYear: argmin(lake),
    lakeMin: Math.min(...lake),
    metroAvg: d.metroAvg,
    coalSwitch: switchingGasPrice(fleetById('cc1'), fleetById('coal')) ?? NaN,
    every: { hedged: total('hedged', 'every'), unhedged: total('unhedged', 'every'), express: total('express', 'every'), lakeside: total('lakeside', 'every'), northline: total('northline', 'every') },
    rule: { hedged: total('hedged', 'april'), unhedged: total('unhedged', 'april'), express: total('express', 'april'), lakeside: total('lakeside', 'april'), northline: total('northline', 'april') },
    floor,
    floorMargin: Math.min(...hedged) - floor * MILLION,
    hedgedWorstAtDefault: Math.min(...hedged) - ARBITRAGE_DEFAULTS.lease * MILLION,
    unhedgedWorstAtDefault: Math.min(...unhedged) - ARBITRAGE_DEFAULTS.lease * MILLION,
  };
}

// ---------------------------------------------------------------------------
// Chart helpers.

const BUY = tint(GRAPHIC.blue, 0.3);
const SELL = tint(GRAPHIC.red, 0.3);
const MONTH_TICKS = Array.from({ length: 12 }, (_, k) => k + 0.5);
const YEAR_TICKS = Array.from({ length: 8 }, (_, y) => y + 0.5);
const ASSET_COLOR: Record<ArbAsset, string> = {
  hedged: GRAPHIC.gold,
  unhedged: GRAPHIC.gold,
  northline: GRAPHIC.orange,
  express: GRAPHIC.orange,
  lakeside: GRAPHIC.red,
};
const ASSET_NAME: Record<ArbAsset, string> = {
  hedged: 'the hedged lease',
  unhedged: 'the unhedged lease',
  northline: 'firm Northline capacity',
  express: 'firm Ridgeback Express capacity',
  lakeside: 'the Lakeside toll',
};
const DRIVER_NAME: Record<ArbAsset, string> = {
  hedged: 'winter degree-days colder than normal',
  unhedged: 'winter degree-days colder than normal',
  northline: 'the year’s coldest day at Metro',
  express: 'Ridgeback’s production less takeaway, Bcf/d',
  lakeside: 'Metro’s average gas price',
};

function driverText(asset: ArbAsset, y: number, d: ArbitrageData): string {
  if (asset === 'hedged' || asset === 'unhedged') return `${d.colder[y] >= 0 ? '+' : '−'}${fmt(Math.abs(d.colder[y]))}`;
  if (asset === 'northline') return `${fmt(d.coldest[y])} °F`;
  if (asset === 'express') return `${d.surplus[y] > 0 ? '+' : '−'}${fmt(Math.abs(d.surplus[y]), 2)}`;
  return gp(d.metroAvg[y]);
}

/** "$2.4 million" or "$310,000": money for prose. */
function cash(x: number): string {
  return Math.abs(x) >= MILLION ? money(x) : money(Math.round(x / 1000) * 1000);
}

/** "Years 2, 4 and 7". */
function yearsText(ys: number[]): string {
  const n = ys.map((y) => String(y + 1));
  if (n.length === 1) return `Year ${n[0]}`;
  return `Years ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function moveText(d: number): string {
  if (d > 0.005) return `injected ${bcf(d, 2)}`;
  if (d < -0.005) return `withdrew ${bcf(-d, 2)}`;
  return 'moved no gas';
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

export default function Lesson() {
  const n = useMemo(arbitrageNumbers, []);
  const d = arbitrageData();

  // ---- Figure 1: one year of the lease.
  const s = useScenario('arbitrage-lease', ARB_LEASE_DEFAULTS);
  const yi = Math.max(0, Math.min(7, Math.round(s.state.year) - 1));
  const lease = d.lease[yi];
  const curve = d.curve[yi];
  const avg = d.average[yi];
  const planPath = leasePath(d.aprilPlan[yi]);
  const runPath = leasePath(lease.moves);
  const [cursor, setCursor] = useState(10.5);
  const cm = Math.max(0, Math.min(11, Math.floor(cursor)));
  const ends = (a: number[]) => [...a, a[a.length - 1]];
  const solvedA = leaseYearSolved(s.state);
  const ratioA = lease.realized / lease.forward;
  const statusA = `Year ${yi + 1}: run without a hedge, the lease earned ${pct(ratioA)} of the ${money(lease.forward)} April’s curve offered.`;

  // ---- Figure 2: eight years of one asset.
  const a = useScenario('arbitrage-assets', ARBITRAGE_DEFAULTS);
  const st = a.state;
  const key = feeKeyOf(st.asset);
  const scaleCfg = FEE_SCALE[key];
  const fee = st[key];
  const years = arbitrageYears(st);
  const held = years.filter((y) => y.held);
  const total = held.reduce((x, y) => x + y.profit, 0);
  const worstHeld = held.length ? Math.min(...held.map((y) => y.profit)) : 0;
  const bestHeld = held.length ? Math.max(...held.map((y) => y.profit)) : 0;
  const color = ASSET_COLOR[st.asset];
  const solvedB = arbitrageSolved(st);
  const statusB =
    st.asset !== 'hedged'
      ? 'Choose the hedged lease first.'
      : st.rule !== 'every'
        ? 'Hold the lease every year.'
        : worstHeld <= 0
          ? `At ${money(fee * MILLION)} a year the lease loses money in ${WORDS[years.filter((y) => y.profit <= 0).length]} of the eight years.`
          : `At ${money(fee * MILLION)} a year the lease makes money in all eight years. Could it pay more?`;

  return (
    <LessonPage id="gas/6.4">
      <P>
        <a href={lessonHref('gas/6.3')}>The previous lesson</a> ended with a different way to own a basis: not a swap but the pipe itself. Until then this chapter traded
        paper — futures, spreads and swaps that pay for being right about prices. A physical asset pays its holder for using it. A lease of storage space buys gas in
        one month and sells it in another (<a href={lessonHref('gas/5.2')}>Lesson 5.2</a>); firm capacity on a pipeline buys it in one place and sells it in another (
        <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>, <a href={lessonHref('gas/5.1')}>Lesson 5.1</a>); a gas-fired plant buys gas and sells electricity, keeping the{' '}
        <K c="price">spark spread</K> of <a href={lessonHref('gas/5.3')}>Lesson 5.3</a>. Each is a spread with a choice attached, since the holder uses the asset only
        when the spread pays, and each has a price, paid for the year whether the spread pays or not. Over the eight simulated years, which was worth its price, and
        how should it have been run?
      </P>
      <P>
        We’ll hold three, one gas year at a time. The first is a lease like Lesson 5.2’s: {bcf(LEASE_BCF, 0)} of Salt Flat’s <K c="energy">working gas</K>, with Salt
        Flat’s rights to inject and withdraw scaled down to match — this time with the field’s ratchets, which slow injection as the lease fills and withdrawal as it
        empties (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>) — and the same {gp(LEASE_COST)} per MMBtu to put gas in or take it out, starting and ending each year
        a quarter full. The second is firm capacity for{' '}
        {fmt(FIRM_MMBTU_D)} MMBtu a day on Northline or on Ridgeback Express, used on every day that the price at the far end beats the near end by more than the
        pipeline’s charge for the trip. The third is a <b>toll</b> on Lakeside, the electricity course’s combined-cycle plant: the right to run it for a year, buying
        its gas at Metro and selling its power. As in Lesson 5.3, the electricity region’s demand stays at its reference day, so only the price of gas changes. On
        April 1 the curve says what each asset would earn if prices came out as quoted, its <K c="price">intrinsic value</K>. The year then pays something else.
      </P>
      <P>
        Storage comes first, because its holder has the most to decide. The best schedule against April’s curve — when to buy, hold and sell — is worth the lease’s
        intrinsic value, and the holder can lock it in by buying futures for the months the schedule injects and selling them for the months it withdraws. A month
        later there is a new curve, and the holder can redraw the schedule from the gas actually in the lease and trade futures to match: the rolling intrinsic of
        Lesson 5.2. Or the holder can skip the futures and simply follow the schedule, buying and selling at each month’s average price. In the next demonstration,
        choose a year. The upper chart is Calder’s price, as April’s curve quoted each month and as each month averaged, with the months the lease put gas in shaded
        blue and those it took gas out shaded red; the lower one is the gas in the lease under April’s schedule and as run, redrawn each month. Drag across the upper
        chart to read a month:
      </P>

      <Figure name="Physical Arbitrage Optimizer" scenario={s}>
        <XYChart
          xDomain={[0, 12]}
          yDomain={[0, 7]}
          yTicks={[0, 1, 2, 3, 4, 5, 6, 7]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => GAS_MONTHS[Math.floor(v)]}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel={`Calder, $/MMBtu, Year ${yi + 1}`}
          height={210}
          bands={lease.moves.map((m, k) => ({ from: k, to: k + 1, color: m > 0.005 ? BUY : m < -0.005 ? SELL : 'transparent' }))}
          series={[
            { xs: Array.from({ length: 13 }, (_, k) => k), ys: ends(curve), color: GRAPHIC.green, kind: 'step', width: 2, dash: '5 3' },
            { xs: Array.from({ length: 13 }, (_, k) => k), ys: ends(avg), color: TEXT.ink, kind: 'step', width: 2 },
          ]}
          cursor={cm + 0.5}
          onScrub={(x) => setCursor(x)}
          scrubLabel="Month of the year"
          ariaLabel={`Year ${yi + 1}: Calder’s price as April’s curve quoted it, from ${gp(Math.min(...curve))} to ${gp(Math.max(...curve))}, and as each month averaged, from ${gp(Math.min(...avg))} to ${gp(Math.max(...avg))}. The lease injected in ${lease.moves.filter((m) => m > 0.005).length} months and withdrew in ${lease.moves.filter((m) => m < -0.005).length}.`}
        />
        <XYChart
          xDomain={[0, 12]}
          yDomain={[0, LEASE_BCF * 1.05]}
          yTicks={[0, 0.25, 0.5, 0.75, 1]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => GAS_MONTHS[Math.floor(v)]}
          yFormat={(v) => fmt(v, 2)}
          yLabel="Gas in the lease, Bcf"
          height={150}
          series={[
            { xs: Array.from({ length: 13 }, (_, k) => k), ys: planPath, color: GRAPHIC.gold, width: 2, dash: '5 3' },
            { xs: Array.from({ length: 13 }, (_, k) => k), ys: runPath, color: GRAPHIC.gold, width: 3 },
          ]}
          cursor={cm + 0.5}
          ariaLabel={`The gas in the lease through Year ${yi + 1}: under April’s schedule it peaks at ${bcf(Math.max(...planPath), 2)}; as run it peaks at ${bcf(Math.max(...runPath), 2)}. Both end at ${bcf(runPath[12], 2)}.`}
        />
        <Legend
          items={[
            { label: 'April’s curve', color: GRAPHIC.green, kind: 'line', dashed: true },
            { label: 'month’s average', color: TEXT.ink, kind: 'line' },
            { label: 'injected', color: BUY },
            { label: 'withdrew', color: SELL },
            { label: 'April’s schedule', color: GRAPHIC.gold, kind: 'line', dashed: true },
            { label: 'as run', color: GRAPHIC.gold, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'April’s value', value: money(lease.forward), tone: 'green' },
            { label: 'earned, hedged', value: money(lease.hedged), tone: 'green' },
            { label: 'earned, unhedged', value: money(lease.realized), tone: 'green' },
            { label: 'winter vs normal', value: `${fmt(Math.abs(d.colder[yi]))} degree-days ${d.colder[yi] >= 0 ? 'colder' : 'warmer'}`, tone: 'teal' },
          ]}
        />
        <Slider label="Year" value={yi + 1} min={1} max={8} step={1} onChange={(v) => s.set({ year: Math.round(v) })} display={`Year ${yi + 1}`} />
        <Caption>
          {GAS_MONTH_NAMES[cm]} of Year {yi + 1}: April’s curve quoted {gp(curve[cm])}, and the month averaged {gp(avg[cm])}. As run, the lease {moveText(lease.moves[cm])};
          April’s schedule {moveText(d.aprilPlan[yi][cm])}.
        </Caption>
      </Figure>

      <P>
        Step through the years. {n.allAbove ? 'In every one of the eight' : 'In most of them'} the hedged lease earned at least what April’s curve offered: from{' '}
        {money(n.hedgedMin)} in Year {n.hedgedMinYear} to {money(n.hedgedMax)} in Year {n.hedgedMaxYear}, {cash(n.hedgedExtra)} a year more than April’s value on
        average. The redrawing is the reason. Each month the holder already owns a schedule locked in at earlier prices. If the new curve makes another schedule better,
        the holder switches and trades futures for the difference — and switches only because the new schedule is worth more at today’s prices, since the old one is
        still there to keep. What the switches add is a share of the extrinsic value of Lesson 5.2: the curve’s moves are the year’s surprises, and a lease that can
        move gas collects some of them.
      </P>
      <P>
        Unhedged, the same lease earned anywhere from {cash(n.unhedgedMin)} to {money(n.unhedgedMax)}. In the {WORDS[n.colderYears.length]} winters colder than normal (
        {yearsText(n.colderYears)}) it earned {n.colderMinRatio >= 1 ? 'at least' : 'close to'} what April’s curve had offered; in the {WORDS[n.mildYears.length]} more
        than 100 degree-days warmer ({yearsText(n.mildYears)}), between {pct(n.mildLow)} and {pct(n.mildHigh)} of it. An unhedged lease is a bet on the winter, the
        same bet as the spread of <a href={lessonHref('gas/6.2')}>Lesson 6.2</a>, and the hedge sells that bet for a known income.
      </P>

      <Challenge
        id="a"
        figure="Physical Arbitrage Optimizer"
        question="Find the year in which the lease, run without a hedge, earned the smallest share of what April’s curve offered."
        solved={solvedA}
        status={statusA}
        success={`Solved: Year ${n.worst + 1}, ${pct(n.worstRatio)} of April’s ${money(d.lease[n.worst].forward)}. The winter came in ${fmt(n.worstWarmer)} degree-days warmer than normal, and the lease sold ${bcf(n.worstSellBcf, 2)} in ${GAS_MONTH_NAMES[n.worstSellMonth]} at an average of ${gp(n.worstSellAvg)}, against the ${gp(n.worstSellQuote)} April had quoted. Hedged, the same schedule earned ${money(d.lease[n.worst].hedged)}: the futures sold in April paid for the winter that never came.`}
      />

      <H2>Pipes and plants</H2>
      <P>
        The other two assets decide far more often. The lease’s holder chooses once a month; the holder of firm capacity chooses every day, and the holder of a toll
        every hour: ship if the spread beats the charge, run the plant if power pays more than its fuel and upkeep. Northline’s spread is Metro’s basis beyond its{' '}
        {gp(NORTHLINE.variableCost)} charge, Express’s is Calder’s price less Ridgeback’s beyond {gp(EXPRESS.variableCost)}, and Lakeside’s is the spark spread in each
        hour of the reference day. On April 1 the curve values each with its monthly prices; the year pays each day’s.
      </P>
      <P>
        In the next demonstration, choose an asset, its fee for the year, and a rule for holding it: every year, or only in the years when April’s curve values it
        above the fee. For each year, the hollow bar is April’s value and the filled bar what the year paid; the dashed line is the fee, and faded bars are years not
        held. Over each year is the physical fact that decided it: the winter for the lease, the coldest day at Metro for Northline, Ridgeback’s production against
        what its pipes can take for Express, and Metro’s average gas price for Lakeside. Each fee starts near the asset’s average April value over the eight years:
      </P>

      <Figure name="Physical Arbitrage Optimizer · eight years" scenario={a}>
        <Segmented
          label="Asset"
          value={st.asset}
          onChange={(v) => a.set({ asset: v })}
          options={[
            { value: 'hedged', label: 'Lease, hedged' },
            { value: 'unhedged', label: 'Lease, unhedged' },
            { value: 'northline', label: 'Northline' },
            { value: 'express', label: 'Express' },
            { value: 'lakeside', label: 'Lakeside' },
          ]}
        />
        <XYChart
          xDomain={[0, 8]}
          yDomain={[0, scaleCfg.max]}
          xTicks={YEAR_TICKS}
          xFormat={(v) => `Year ${Math.floor(v) + 1}`}
          yFormat={(v) => (v === 0 ? '$0' : `$${fmt(v, scaleCfg.max < 2 ? 1 : 0)}M`)}
          yLabel="Value for the year, $ million"
          xLabel={`Over each year: ${DRIVER_NAME[st.asset]}`}
          height={250}
          series={[]}
          ariaLabel={`${ASSET_NAME[st.asset]} over eight years at a fee of ${money(fee * MILLION)}, ${st.rule === 'every' ? 'held every year' : 'held when April’s value beats the fee'}: April values ${years.map((y) => fmt(y.forward / MILLION, 2)).join(', ')} million; earned ${years.map((y) => fmt(y.earned / MILLION, 2)).join(', ')} million. Held ${held.length} years for ${money(total)} after fees.`}
        >
          {(x, y) => (
            <g>
              {years.map((r) => {
                const x0 = x(r.year + 0.2);
                const w = x(r.year + 0.48) - x0;
                const x1 = x(r.year + 0.52);
                const top = (v: number) => y(Math.min(scaleCfg.max, v / MILLION));
                const op = r.held ? 1 : 0.3;
                return (
                  <g key={r.year} opacity={op}>
                    <rect x={x0} y={top(r.forward)} width={w} height={Math.max(0.5, y(0) - top(r.forward))} fill="none" stroke={color} strokeWidth={1.6} />
                    <rect x={x1} y={top(r.earned)} width={w} height={Math.max(0.5, y(0) - top(r.earned))} fill={color} />
                  </g>
                );
              })}
              {years.map((r) => (
                <text key={`t${r.year}`} className="ax ax-m" x={x(r.year + 0.5)} y={y(scaleCfg.max) + 12}>
                  {driverText(st.asset, r.year, d)}
                </text>
              ))}
              <line x1={x(0)} x2={x(8)} y1={y(Math.min(fee, scaleCfg.max))} y2={y(Math.min(fee, scaleCfg.max))} stroke={TEXT.ink} strokeWidth={1.5} strokeDasharray="6 4" />
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'April’s value', color: color, kind: 'line' },
            { label: 'earned', color: color },
            { label: 'fee', color: TEXT.ink, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'years held', value: fmt(held.length) },
            { label: 'profit after fees', value: money(total), tone: 'green' },
            { label: 'worst year held', value: held.length ? money(worstHeld) : '—', tone: 'green' },
            { label: 'best year held', value: held.length ? money(bestHeld) : '—', tone: 'green' },
          ]}
        />
        <Segmented
          label="Holding rule"
          value={st.rule}
          onChange={(v) => a.set({ rule: v })}
          options={[
            { value: 'every', label: 'Hold every year' },
            { value: 'april', label: 'Hold when April’s value beats the fee' },
          ]}
        />
        <Slider
          key={key}
          label="Fee for the year"
          tone="green"
          value={fee}
          min={0}
          max={scaleCfg.max}
          step={scaleCfg.step}
          onChange={(v) => a.set({ [key]: round2(v) } as Partial<ArbitrageState>)}
          display={money(fee * MILLION)}
        />
        <Caption>
          {held.length
            ? `Held ${st.rule === 'every' ? 'every year' : `in ${WORDS[held.length]} of the eight years`}, ${ASSET_NAME[st.asset]} made ${money(total)} after fees of ${money(fee * MILLION)} a year; it lost money in ${WORDS[held.filter((y) => y.profit <= 0).length]} of them.`
            : `April’s curve never valued ${ASSET_NAME[st.asset]} above ${money(fee * MILLION)}, so the rule never holds it.`}
        </Caption>
      </Figure>

      <P>
        Start with Northline. {n.northFlat ? `Its April value is the same every year, ${cash(n.northFwd)}:` : `Its April value barely changes, about ${cash(n.northFwd)}:`} the
        curve can’t see a cold snap months ahead, so it prices the capacity at what the snaps are worth on average, and on average that is what they paid,{' '}
        {cash(n.northAvg)} a year. But it paid less than {cash(n.northCalmMax)} in {WORDS[n.northCalmCount]} of the years and {money(n.northBest)} in Year{' '}
        {n.northBestYear + 1}, whose coldest day reached {fmt(n.northBestColdest)} °F: firm capacity into a city is the insurance of Lesson 6.3’s Metro desk in another
        form, collected in the year the city runs short. Express is the opposite. Its April value was zero in every year but Year {n.expYear + 1}, when Ridgeback
        produced {bcfd(n.expSurplus)} more than its pipes could carry and its field could burn — a sliver, but enough to strand gas behind a full pipe (
        <a href={lessonHref('gas/3.2')}>Lesson 3.2</a>). The curve drawn that April already saw it and valued the year’s capacity at {money(n.expFwd)}; the year paid{' '}
        {money(n.expEarned)}.
      </P>
      <P>
        Lakeside’s April value came within {pct(n.lakeDev)} of what it earned in every year, because its margin depends mostly on something the curve already knows:
        the level of the gas price. Below {gp(n.coalSwitch)}, Lakeside’s offer — its fuel and upkeep for each megawatt-hour — undercuts Ironwood coal’s, and it runs
        through the night; above it, Lakeside earns mostly in the evening, when a less efficient gas plant sets the power price (Lesson 5.3). Year{' '}
        {n.lakeMaxYear + 1}, with gas averaging{' '}
        {gp(n.metroAvg[n.lakeMaxYear])} at Metro, paid the toll the most, {money(n.lakeMax)}; Year {n.lakeMinYear + 1}, at {gp(n.metroAvg[n.lakeMinYear])}, the least,{' '}
        {money(n.lakeMin)}. A toll on an efficient plant is, in this region, a bet on cheap gas.
      </P>

      <H2>What the curve can see</H2>
      <P>
        Now switch the rule to holding only when April’s value beats the fee. At the starting fees it turns {money(n.every.hedged)} into {money(n.rule.hedged)} for the
        hedged lease, {money(n.every.express)} into {money(n.rule.express)} for Express, and {cash(n.every.lakeside)} into {money(n.rule.lakeside)} for Lakeside. For
        Northline it changes nothing, because Northline’s April value never changes. The rule works where an asset’s value depends on what the curve can see on April
        1 — the price level for Lakeside, the summer-to-winter spread for the lease, a glut already in the basin for Express — and fails where it depends on what the
        curve can’t, a cold week next January. That is the chapter’s question asked of things you can own. The physics says what each asset’s value rests on, and so
        whether the price of holding it can be beaten or only paid.
      </P>
      <P>
        The hedge matters in a different way. Held every year at the starting fee of {money(ARBITRAGE_DEFAULTS.lease * MILLION)}, the hedged lease’s worst year{' '}
        {n.hedgedWorstAtDefault < 0 ? `lost ${cash(-n.hedgedWorstAtDefault)}` : `made ${cash(n.hedgedWorstAtDefault)}`}; the unhedged lease’s lost{' '}
        {money(-n.unhedgedWorstAtDefault)}. A fee is paid every year, so what a holder can afford depends on the worst year as much as the average one.
      </P>

      <Challenge
        id="b"
        figure="Physical Arbitrage Optimizer · eight years"
        question="Holding the hedged lease every year, what’s the highest fee, on the slider’s steps, at which it made money in all eight years?"
        solved={solvedB}
        status={statusB}
        success={`Solved: ${money(n.floor * MILLION)} a year. The hedged lease’s worst year, Year ${n.hedgedMinYear}, still earned ${money(n.hedgedMin)}, clearing the fee by ${money(Math.round(n.floorMargin / 100) * 100)}. Unhedged, the same lease earned only ${cash(n.unhedgedMin)} in its worst year, so any fee above that lost money at least once. A storage holder who hedges can promise a lender a floor; one who doesn’t is betting on the winter.`}
      />

      <P>
        Physical assets answer the chapter’s question differently from paper. Their holders don’t have to beat the market’s price for a spread; they have to hold
        something worth more than its fee, and the curve says on April 1 roughly what that is. <FigRef to="Physical Arbitrage Optimizer">Hedged storage</FigRef>{' '}
        earned what the curve promised and more from the curve’s moves; a pipe into a city paid out like insurance, almost half of it in one cold year; a pipe out of an overflowing basin and a plant on cheap gas earned what
        the curve could already see. All of it, though, was judged with hindsight: we chose the fees and the rules looking at the same eight years we scored them on,
        paid no trading costs beyond the fees, and posted no margin for the hedges. <a href={lessonHref('gas/6.5')}>The next lesson</a> asks which of the chapter’s
        strategies survive when that hindsight is taken away.
      </P>
    </LessonPage>
  );
}
