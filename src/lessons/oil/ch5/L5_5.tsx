import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  usd,
  useScenario,
} from '../../../framework';
import { PRODUCT_DEFAULTS, SHOCK_DEFAULTS, WORLD, productMarket, simulateShock, type ShockMonth } from '../../../engines/oil/market';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// Figure 1: a shock to the world balance.

export type ShockKind = 'outage' | 'demand';

/** The month every shock begins (0 = the first month shown): month 3, so the run shows the calm before it. */
export const SHOCK_START = 2;

export interface ShockState {
  kind: ShockKind;
  /** Size of the shock, mb/d. */
  size: number;
  /** How many months it lasts (from month 3). */
  months: number;
  /** Does the producer group use its spare capacity, and how much does it hold (mb/d)? */
  group: boolean;
  spare: number;
  /** Strategic reserve release, mb/d, starting when the outage starts, for `releaseMonths` months. */
  release: number;
  releaseMonths: number;
}

export const SHOCK_STATE_DEFAULTS: ShockState = {
  kind: 'outage',
  size: 2,
  months: 6,
  group: false,
  spare: SHOCK_DEFAULTS.spare,
  release: 0,
  releaseMonths: 6,
};

/** The challenge's price ceiling, $/bbl. */
export const PRICE_CAP = 88;
export const RELEASE_STEP = 0.1;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Runs the shock model for a state of the first demonstration. */
export function runShock(st: ShockState): ShockMonth[] {
  const shock = { size: st.size, start: SHOCK_START, months: st.months };
  return simulateShock({
    outage: st.kind === 'outage' ? shock : undefined,
    demandDrop: st.kind === 'demand' ? shock : undefined,
    reserveRelease: st.kind === 'outage' && st.release > 0 ? { rate: st.release, start: SHOCK_START, months: st.releaseMonths } : undefined,
    groupStabilizes: st.group,
    spare: st.spare,
  });
}

export function peakPrice(path: ShockMonth[]): number {
  return Math.max(...path.map((m) => m.price));
}

export function lowestPrice(path: ShockMonth[]): number {
  return Math.min(...path.map((m) => m.price));
}

/**
 * The first month (1-based) in which non-group producers add supply in answer to a supply outage's
 * high prices — their response lags the price (wells take months to drill and complete).
 */
export function nonGroupResponseMonth(path: ShockMonth[], st: ShockState): number {
  const i = path.findIndex((m, k) => {
    const lost = st.kind === 'outage' && k >= SHOCK_START && k < SHOCK_START + st.months ? st.size : 0;
    return m.supply + lost - m.groupExtra > WORLD.demand + 1e-6;
  });
  return i < 0 ? NaN : i + 1;
}

/**
 * Challenge a: a 2 mb/d outage lasting six months, no help from the producer group, and a strategic
 * release for those same six months. The release must be the smallest (on 0.1 mb/d steps) that keeps
 * the price under $88 throughout. The reader estimates it from the prose: 1 mb/d cuts the peak from
 * $101.85 to $89.66, about $12 per mb/d, so a little more than 1.1.
 */
export function challengeReady(st: ShockState): boolean {
  return st.kind === 'outage' && r1(st.size) === 2 && st.months === 6 && !st.group && st.releaseMonths === 6;
}

export function releaseSolved(st: ShockState): boolean {
  if (!challengeReady(st)) return false;
  const peakAt = (rate: number) => peakPrice(runShock({ ...st, release: r1(rate) }));
  return peakAt(st.release) < PRICE_CAP && (r1(st.release) <= 0 || peakAt(st.release - RELEASE_STEP) >= PRICE_CAP);
}

// ---------------------------------------------------------------------------
// Figure 2: a refinery outage.

export interface OutageState {
  /** World refinery runs lost, mb/d. */
  size: number;
  /** Months it lasts, from August. */
  months: number;
}

/**
 * The refinery outage starts in August (0 = January), the height of the hurricane season. The month
 * doesn't change the crack's rise in this model, because a crack answers only how far stocks fall.
 */
export const OUTAGE_START = 7;
export const OUTAGE_DEFAULTS: OutageState = { size: 2, months: 2 };
/** World refinery runs and the yields of gasoline and distillate (diesel and jet). */
export const RUNS = 83;
export const GASOLINE_YIELD = 0.44;
export const DISTILLATE_YIELD = 0.42;
/** The second challenge's target: the gasoline crack lifted by at least $6. */
export const CRACK_TARGET = 6;

const BASE_PRODUCTS = productMarket({ runs: RUNS, gasolineYield: GASOLINE_YIELD, distillateYield: DISTILLATE_YIELD });

export function outageRun(st: OutageState) {
  return productMarket({ runs: RUNS, gasolineYield: GASOLINE_YIELD, distillateYield: DISTILLATE_YIELD, outage: { size: st.size, start: OUTAGE_START, months: st.months } });
}

/** The largest rise in each crack over the no-outage year, $/bbl. */
export function crackRise(st: OutageState): { gasoline: number; distillate: number } {
  const run = outageRun(st);
  return {
    gasoline: Math.max(...run.map((m, i) => m.gasolineCrack - BASE_PRODUCTS[i].gasolineCrack)),
    distillate: Math.max(...run.map((m, i) => m.distillateCrack - BASE_PRODUCTS[i].distillateCrack)),
  };
}

/** Crude that went unrefined and backed up into tanks, million barrels. */
export function crudeBackedUp(st: OutageState): number {
  const months = Math.min(st.months, 12 - OUTAGE_START);
  return st.size * Math.max(0, months) * 30.4;
}

/**
 * The reader's back-of-envelope for challenge b: the gasoline a crack rise needs taken out of stocks
 * ($0.60 for every 1% under normal), as runs lost at 44% gasoline over the outage's days, mb/d.
 */
export function gasolineToLose(rise: number): number {
  return (rise / (PRODUCT_DEFAULTS.crackSensitivity * 100)) * PRODUCT_DEFAULTS.normalGasoline;
}
export function predictedRunsLost(rise: number, months: number): number {
  return gasolineToLose(rise) / GASOLINE_YIELD / (months * 30.4);
}

/** Challenge b: the smallest two-month outage (0.1 mb/d steps) that lifts the gasoline crack by $6. */
export function gasolineSolved(st: OutageState): boolean {
  if (st.months !== 2) return false;
  const rise = (size: number) => crackRise({ ...st, size: r1(size) }).gasoline;
  return rise(st.size) >= CRACK_TARGET && rise(st.size - 0.1) < CRACK_TARGET;
}

// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRICE_COLOR = GRAPHIC.green;
const STOCK_COLOR = GRAPHIC.orange;
const GAS_COLOR = '#c99a1e';
const DIST_COLOR = '#d0702a';

function mb(x: number): string {
  return `${fmt(x)} million bbl`;
}

function dollars(x: number): string {
  return usd(x, 2);
}

export default function Lesson() {
  const s1 = useScenario<ShockState>('shock', SHOCK_STATE_DEFAULTS);
  const st = s1.state;
  const path = useMemo(() => runShock(st), [st]);
  const peak = peakPrice(path);
  const low = lowestPrice(path);
  const minStocks = Math.min(...path.map((m) => m.stocks));
  const maxStocks = Math.max(...path.map((m) => m.stocks));
  const solvedA = useMemo(() => releaseSolved(st), [st]);
  const outage = st.kind === 'outage';

  // Reference runs quoted in the prose.
  const ref = useMemo(() => {
    const bare = runShock(SHOCK_STATE_DEFAULTS);
    const group = runShock({ ...SHOCK_STATE_DEFAULTS, group: true });
    const reserve = runShock({ ...SHOCK_STATE_DEFAULTS, release: 1 });
    const reserveShort = runShock({ ...SHOCK_STATE_DEFAULTS, release: 1, releaseMonths: 3 });
    const demand = runShock({ ...SHOCK_STATE_DEFAULTS, kind: 'demand', size: 3 });
    const demandGroup = runShock({ ...SHOCK_STATE_DEFAULTS, kind: 'demand', size: 3, group: true });
    const bigGroup = runShock({ ...SHOCK_STATE_DEFAULTS, size: 4, group: true });
    return { bare, group, reserve, reserveShort, demand, demandGroup, bigGroup };
  }, []);
  const barePeak = peakPrice(ref.bare);
  const barePeakMonth = ref.bare.findIndex((m) => m.price === barePeak) + 1;
  const bareLow = lowestPrice(ref.bare);
  const bareLowMonth = ref.bare.findIndex((m) => m.price === bareLow) + 1;
  const bareDraw = WORLD.normalStocks - Math.min(...ref.bare.map((m) => m.stocks));
  const demandFall = WORLD.demand - Math.min(...ref.bare.map((m) => m.demand));
  const bareSupplyMonth = nonGroupResponseMonth(ref.bare, SHOCK_STATE_DEFAULTS);
  const releasePerMbd = barePeak - peakPrice(ref.reserve);
  const groupExtraMax = Math.max(...ref.group.map((m) => m.groupExtra));
  const demandLow = lowestPrice(ref.demand);
  const demandPeak = peakPrice(ref.demand);
  const demandPeakMonth = ref.demand.findIndex((m) => m.price === demandPeak) + 1;

  const xs = path.map((m) => m.month + 1);
  const [p0, p1] = niceDomain(Math.min(60, low, PRICE_CAP), Math.max(100, peak), 4);
  const [s0, sTop] = niceDomain(Math.min(minStocks, 2700), Math.max(maxStocks, 2900), 3);

  // ---- Figure 2.
  const s2 = useScenario<OutageState>('refinery', OUTAGE_DEFAULTS);
  const ot = s2.state;
  const run = useMemo(() => outageRun(ot), [ot]);
  const rise = useMemo(() => crackRise(ot), [ot]);
  const backed = crudeBackedUp(ot);
  const solvedB = useMemo(() => gasolineSolved(ot), [ot]);
  const refRise = crackRise(OUTAGE_DEFAULTS);
  const gasNeeded = gasolineToLose(CRACK_TARGET);
  const runsNeeded = predictedRunsLost(CRACK_TARGET, OUTAGE_DEFAULTS.months);
  const months12 = Array.from({ length: 12 }, (_, i) => i);
  const crackLo = 0;
  const crackHi = Math.max(40, ...run.map((m) => Math.max(m.gasolineCrack, m.distillateCrack)));

  return (
    <LessonPage id="oil/5.5">
      <P>
        Lessons <a href={lessonHref('oil/5.1')}>5.1</a> and <a href={lessonHref('oil/5.4')}>5.4</a> found the market’s working parts: supply minus demand changes the
        world’s stocks, and stocks set the price and shape the futures curve. Most months those parts move slowly. Then something breaks — a war shuts in a producer, a
        hurricane closes refineries, a recession or a pandemic takes demand away — and the market has to find millions of barrels a day, or lose them, at once. This
        lesson runs those shocks through our model and watches who absorbs them.
      </P>
      <P>
        The starting point is a fact about oil that every shock exposes: in the short run, almost nothing responds to price. Drivers still commute, trucks still
        deliver, airlines still fly; economists’ estimates of how much oil demand falls when its price rises are commonly well under a tenth of the price change in
        the first months. Our model uses a short-run elasticity of {fmt(SHOCK_DEFAULTS.shortRunElasticity, 2)}: a 10% higher price trims demand by only{' '}
        {fmt(-SHOCK_DEFAULTS.shortRunElasticity * 10, 1)}%. Supply is just as stiff — new wells take months to drill and complete (
        <a href={lessonHref('oil/2.3')}>Lesson 2.3</a>). So whatever is missing comes, at first, out of <K tone="orange">stocks</K>, and as stocks fall the{' '}
        <K c="price">price</K> climbs: in our model, each 1% that stocks fall below normal lifts the price by about {fmt((Math.pow(0.99, -WORLD.theta) - 1) * 100, 1)}%.
      </P>
      <P>
        In the next demonstration, a shock hits a balanced market, where the price would otherwise stay at the course’s simulated {usd(WORLD.referencePrice)}. Choose a
        supply outage or a drop in demand, set its size and how long it lasts, and decide who helps: the producer group with its spare capacity, or governments with their
        strategic stocks:
      </P>

      <Figure name="Oil Shock Simulator" scenario={s1}>
        <Segmented
          label="Kind of shock"
          value={st.kind}
          onChange={(v) => s1.set({ kind: v })}
          options={[
            { value: 'outage', label: 'Supply outage' },
            { value: 'demand', label: 'Demand drop' },
          ]}
        />
        <XYChart
          ariaLabel={`Monthly price over two years after a ${fmt(st.size, 1)} million barrel a day ${outage ? 'supply outage' : 'drop in demand'} from month ${SHOCK_START + 1} lasting ${st.months} months: the price peaks at ${dollars(peak)} and falls as low as ${dollars(low)}.`}
          height={200}
          x={[1, 24]}
          y={[p0, p1]}
          xTicks={[1, 6, 12, 18, 24]}
          yTicks={niceTicks(p0, p1, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Crude price, $ per barrel"
          bands={[{ from: SHOCK_START + 0.5, to: SHOCK_START + st.months + 0.5, color: outage ? 'rgba(231, 91, 85, .08)' : 'rgba(69, 144, 206, .08)', label: outage ? 'outage' : 'demand drop' }]}
          refs={[
            { axis: 'y', at: WORLD.referencePrice, color: '#9a9a9a', dash: '4 4', label: 'no shock' },
            ...(outage ? [{ axis: 'y' as const, at: PRICE_CAP, color: TEXT.red, dash: '2 4', label: `$${PRICE_CAP}` }] : []),
          ]}
          series={[{ points: xs.map((x, i) => [x, path[i].price] as [number, number]), color: PRICE_COLOR, width: 3 }]}
        />
        <XYChart
          ariaLabel={`World commercial stocks by month: from ${mb(WORLD.normalStocks)} they fall as low as ${mb(minStocks)} and rise as high as ${mb(maxStocks)}.`}
          height={150}
          x={[1, 24]}
          y={[s0, sTop]}
          xTicks={[1, 6, 12, 18, 24]}
          yTicks={niceTicks(s0, sTop, 3)}
          yFormat={(v) => fmt(v)}
          xLabel="month"
          yLabel="World stocks, million barrels"
          refs={[{ axis: 'y', at: WORLD.normalStocks, color: '#9a9a9a', dash: '4 4', label: 'normal' }]}
          series={[{ points: xs.map((x, i) => [x, path[i].stocks] as [number, number]), color: STOCK_COLOR, width: 2.5 }]}
        />
        <Readouts
          items={[
            { label: <K c="price">peak price</K>, value: dollars(peak), tone: 'green' },
            { label: <K c="price">lowest price</K>, value: dollars(low), tone: 'green' },
            { label: <K tone="orange">largest stock draw</K>, value: mb(Math.max(0, WORLD.normalStocks - minStocks)), tone: 'orange' },
          ]}
        />
        <Slider label="Size of the shock" tone="orange" value={st.size} min={0} max={5} step={0.1} onChange={(v) => s1.set({ size: r1(v) })} display={`${fmt(st.size, 1)} mb/d`} />
        <Slider label="Lasts" value={st.months} min={1} max={12} onChange={(v) => s1.set({ months: v })} display={`${st.months} month${st.months === 1 ? '' : 's'}`} />
        <Checkbox label="The producer group uses its spare capacity to steady the price" checked={st.group} onChange={(v) => s1.set({ group: v })} />
        <Slider
          label="Group’s spare capacity"
          tone="orange"
          value={st.spare}
          min={0}
          max={6}
          step={0.1}
          disabled={!st.group}
          onChange={(v) => s1.set({ spare: r1(v) })}
          display={st.group ? `${fmt(st.spare, 1)} mb/d` : '—'}
        />
        <Slider
          label="Strategic stock release"
          tone="orange"
          value={st.release}
          min={0}
          max={2}
          step={RELEASE_STEP}
          disabled={!outage}
          onChange={(v) => s1.set({ release: r1(v) })}
          display={outage ? `${fmt(st.release, 1)} mb/d` : '—'}
        />
        <Slider
          label="Release lasts"
          value={st.releaseMonths}
          min={1}
          max={12}
          disabled={!outage || st.release === 0}
          onChange={(v) => s1.set({ releaseMonths: v })}
          display={outage && st.release > 0 ? `${st.releaseMonths} month${st.releaseMonths === 1 ? '' : 's'} from the outage’s start` : '—'}
        />
        <Caption>
          {st.size === 0
            ? 'With no shock, the market stays balanced and the price stays put.'
            : outage
              ? `The outage removes ${fmt(st.size, 1)} mb/d for ${st.months} month${st.months === 1 ? '' : 's'}. The price peaks at ${dollars(peak)}${low < WORLD.referencePrice - 0.5 ? ` and later falls to ${dollars(low)}, below where it started` : ''}.`
              : `Demand falls by ${fmt(st.size, 1)} mb/d for ${st.months} month${st.months === 1 ? '' : 's'}. The price falls to ${dollars(low)}${peak > WORLD.referencePrice + 0.5 ? ` and later overshoots to ${dollars(peak)}` : ''}.`}
        </Caption>
      </Figure>

      <P>
        Start with a {fmt(SHOCK_STATE_DEFAULTS.size)} mb/d outage lasting {SHOCK_STATE_DEFAULTS.months} months and no help from anyone. Stocks fall by up to{' '}
        {mb(bareDraw)} and the price climbs every month the outage lasts, peaking at {dollars(barePeak)} in month {barePeakMonth}. The high price does its slow work.
        By the time the outage ends, demand is about {fmt(demandFall, 1)} mb/d lower than it would have been, and producers outside the group are drilling more — but
        their new wells add no oil until month {bareSupplyMonth}, after the outage is over. These responses arrive late, and they don’t stop when the outage does.
        Demand recovers only gradually, because its long-run response follows the past year’s prices; the new wells keep producing; and stocks overshoot: the price
        sinks to {dollars(bareLow)} in month {bareLowMonth} before recovering. Lagged responses to shocks are a big part of why oil prices cycle.
      </P>
      <P>
        Now let the producer group help. Spare capacity is production kept idle that can be brought on within weeks — in the real world, mostly held by a few members of
        the OPEC+ group. In our model the group adds output in proportion to how far the price is above normal, up to {fmt(groupExtraMax, 1)} mb/d here, and the
        peak falls to {dollars(peakPrice(ref.group))}. Afterward the group takes back what it added, and the undershoot nearly disappears. Spare capacity only works if
        it’s big enough, though: try a {fmt(4)} mb/d outage, and even with {fmt(SHOCK_DEFAULTS.spare, 1)} mb/d to spare the price reaches{' '}
        {dollars(peakPrice(ref.bigGroup))}.
      </P>

      <H2>Strategic stocks</H2>
      <P>
        Governments hold the other buffer. Members of the International Energy Agency are required to keep emergency stocks equal to at least 90 days of their net
        imports, and the agency has coordinated releases several times, including twice in 2022. The United States’ Strategic Petroleum Reserve, held in salt
        caverns along the Gulf Coast, is among the largest government stockpiles of crude in the world. A release puts barrels back into the market while an outage lasts. Here, with the group
        not responding, releasing 1 mb/d through the outage holds the peak to {dollars(peakPrice(ref.reserve))}. It has to last, though: stop the same release
        after three months, halfway through the outage, and the peak climbs back to {dollars(peakPrice(ref.reserveShort))}.
      </P>

      <Challenge
        id="a"
        figure="Oil Shock Simulator"
        question={`For a ${fmt(2)} mb/d outage lasting six months, with the producer group not responding, the price must stay under $${PRICE_CAP} the whole time. Estimate first: releasing 1 mb/d cut the peak by about ${usd(releasePerMbd)}, from ${dollars(barePeak)} to ${dollars(peakPrice(ref.reserve))}. How much more would it take? Then find the smallest release, in steps of 0.1 mb/d and lasting the same six months, that does it.`}
        solved={solvedA}
        status={
          !challengeReady(st)
            ? 'Set a 2.0 mb/d supply outage lasting 6 months, switch the producer group off, and let the release last 6 months.'
            : `Releasing ${fmt(st.release, 1)} mb/d, the price peaks at ${dollars(peak)}.`
        }
        success={`Solved: ${fmt(st.release, 1)} mb/d, which holds the peak to ${dollars(peak)}; a tenth of a million barrels a day less and it reaches ${dollars(peakPrice(runShock({ ...st, release: r1(st.release - RELEASE_STEP) })))}. Even this release replaces only part of what’s lost, and stocks still fall. It buys time while slower responses arrive.`}
      />

      <P>
        Demand shocks run the same machinery in reverse. Switch to a demand drop: with {fmt(3)} mb/d of demand gone for six months, stocks swell and the price falls
        to {dollars(demandLow)}. Then the lags bite the other way — producers outside the group have cut back their drilling, and when demand returns the market comes up
        short, pushing the price to {dollars(demandPeak)} by month {demandPeakMonth}. With the group cutting output while prices are low, the fall stops at{' '}
        {dollars(lowestPrice(ref.demandGroup))}. Real demand shocks can be far larger than this one, like the collapse of spring 2020 that sent WTI below zero in{' '}
        <a href={lessonHref('oil/5.4')}>Lesson 5.4</a>.
      </P>

      <H2>When refineries go down</H2>
      <P>
        Not every shock hits crude. A refinery outage — the classic case is a hurricane closing plants along the U.S. Gulf Coast — takes away products instead,
        while the crude those refineries would have run backs up in tanks. The next demonstration runs the product model of{' '}
        <a href={lessonHref('oil/5.3')}>Lesson 5.3</a> again — its outage switch tried a single case — with world refineries losing any part of their{' '}
        {fmt(RUNS)} mb/d of runs from {MONTH_FULL[OUTAGE_START]}, the height of the hurricane season, for as long as we choose. The dashed lines are the same year
        without the outage. Set its size and length:
      </P>

      <Figure name="Oil Shock Simulator · refinery outage" scenario={s2}>
        <Legend
          items={[
            { label: 'Gasoline crack', color: GAS_COLOR, kind: 'line' },
            { label: 'Distillate crack', color: DIST_COLOR, kind: 'line' },
            { label: 'Same year, no outage', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Gasoline and distillate crack spreads by month, with a refinery outage of ${fmt(ot.size, 1)} mb/d for ${ot.months} months from ${MONTH_FULL[OUTAGE_START]}: the gasoline crack rises up to ${dollars(rise.gasoline)} and the distillate crack up to ${dollars(rise.distillate)} above the year without it.`}
          height={210}
          x={[0, 11]}
          y={[crackLo, Math.ceil(crackHi / 10) * 10]}
          xTicks={[0, 2, 4, 6, 8, 10]}
          xFormat={(v) => MONTH_NAMES[v] ?? ''}
          yTicks={niceTicks(crackLo, Math.ceil(crackHi / 10) * 10, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Crack spread over crude, $ per barrel"
          bands={[{ from: OUTAGE_START - 0.5, to: Math.min(11.5, OUTAGE_START + ot.months - 0.5), color: 'rgba(231, 91, 85, .08)', label: 'outage' }]}
          series={[
            { points: months12.map((m) => [m, BASE_PRODUCTS[m].gasolineCrack] as [number, number]), color: '#9a9a9a', width: 1.5, dash: '5 4' },
            { points: months12.map((m) => [m, BASE_PRODUCTS[m].distillateCrack] as [number, number]), color: '#9a9a9a', width: 1.5, dash: '5 4' },
            { points: months12.map((m) => [m, run[m].gasolineCrack] as [number, number]), color: GAS_COLOR, width: 3 },
            { points: months12.map((m) => [m, run[m].distillateCrack] as [number, number]), color: DIST_COLOR, width: 3 },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="price">gasoline crack, largest rise</K>, value: `+${dollars(rise.gasoline)}`, tone: 'green' },
            { label: <K c="price">distillate crack, largest rise</K>, value: `+${dollars(rise.distillate)}`, tone: 'green' },
            { label: <K tone="orange">crude left unrefined</K>, value: mb(backed), tone: 'orange' },
          ]}
        />
        <Slider label="Refinery runs lost" tone="orange" value={ot.size} min={0} max={4} step={0.1} onChange={(v) => s2.set({ size: r1(v) })} display={`${fmt(ot.size, 1)} mb/d`} />
        <Slider label="Lasts" value={ot.months} min={1} max={4} onChange={(v) => s2.set({ months: v })} display={`${ot.months} month${ot.months === 1 ? '' : 's'}`} />
        <Caption>
          Stocks of gasoline end the year {mb(BASE_PRODUCTS[11].gasolineStock - run[11].gasolineStock)} lower than without the outage, and distillate{' '}
          {mb(BASE_PRODUCTS[11].distillateStock - run[11].distillateStock)} lower; normal stocks are {mb(PRODUCT_DEFAULTS.normalGasoline)} and{' '}
          {mb(PRODUCT_DEFAULTS.normalDistillate)}.
        </Caption>
      </Figure>

      <P>
        A {fmt(OUTAGE_DEFAULTS.size)} mb/d outage lasting {OUTAGE_DEFAULTS.months} months from {MONTH_FULL[OUTAGE_START]} lifts the gasoline crack by up to{' '}
        {dollars(refRise.gasoline)} and the distillate crack by {dollars(refRise.distillate)}, and leaves {mb(crudeBackedUp(OUTAGE_DEFAULTS))} of crude in tanks that
        refineries would otherwise have run. Product stocks, much smaller than crude stocks, then stay short for the rest of the year, and the cracks stay wide long
        after the refineries restart: nothing in our model refills them, though in the real market refiners elsewhere would run harder to chase the wide cracks, the
        first lever of Lesson 5.3. The crude side isn’t in our model, but the real market shows it: when Hurricane Harvey shut refineries on the Texas coast in 2017,
        gasoline prices jumped while U.S. crude prices fell, widening the crack from both ends at once. A refinery that escapes the storm earns the widened crack on
        every barrel it runs.
      </P>

      <Challenge
        id="b"
        question={`Estimate first: Lesson 5.3’s crack rises ${usd(PRODUCT_DEFAULTS.crackSensitivity, 2)} for every 1% gasoline stocks sit under their normal ${fmt(PRODUCT_DEFAULTS.normalGasoline)} million barrels, and each barrel of runs makes ${fmt(GASOLINE_YIELD, 2)} of a barrel of gasoline. How much refinery capacity must a two-month outage take out to lift the gasoline crack by $${CRACK_TARGET}? Then find the smallest loss, to the nearest 0.1 mb/d, that does it.`}
        solved={solvedB}
        status={
          ot.months !== 2
            ? 'Set the outage to last 2 months.'
            : `Losing ${fmt(ot.size, 1)} mb/d for two months lifts the gasoline crack by up to ${dollars(rise.gasoline)}.`
        }
        success={`Solved: ${fmt(ot.size, 1)} mb/d. A $${CRACK_TARGET} rise is ${fmt((CRACK_TARGET / PRODUCT_DEFAULTS.crackSensitivity), 0)}% of normal stocks, ${fmt(gasNeeded)} million barrels of gasoline; at ${fmt(GASOLINE_YIELD * 100)}% that is ${fmt(gasNeeded / GASOLINE_YIELD)} million barrels of runs, and over ${fmt(OUTAGE_DEFAULTS.months * 30.4)} days, ${fmt(runsNeeded, 2)} mb/d. The crack answers stocks in a straight line in our model, so the estimate is exact; the slider’s next step up is the answer. A few weeks of a large outage move the crack by dollars, and the effect lasts until stocks are rebuilt.`}
      />

      <P>
        That closes the chapter, and answers its question. Physical supply and demand set the world’s balance, and the balance runs through stocks: stocks set the
        level of price and the shape of the futures curve, with contango when tanks are full and backwardation when they’re scarce. Transport and quality set the
        differentials between crudes and places. Refinery capacity sits between crude and products, so its outages and its seasons set the cracks. You can return to{' '}
        <FigRef to="Oil Shock Simulator">the first demonstration</FigRef> to test any shock against any response.
      </P>
      <P>
        Every one of those mechanisms leaves a spread behind — between months, between places, between crudes, between crude and products — and spreads are what oil
        traders trade. Chapter 6 takes them one at a time, starting with the <a href={lessonHref('oil/6.1')}>calendar spread</a> between near and far futures, and asks
        in each case whether the physical cause is strong enough to make the trade pay.
      </P>
    </LessonPage>
  );
}
