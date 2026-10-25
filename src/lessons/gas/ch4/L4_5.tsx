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
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { FUTURES_CONTRACT_MMBTU, futuresMarks, marginCalls } from '../../../engines/gas/contracts';
import { SEASONAL_COSTS, forwardCurve, normalPlan, planInventory, simulateYear, type ForwardCurve, type StorageState, type YearDay } from '../../../engines/gas/market';
import { GAS_MONTHS, GAS_MONTH_NAMES, GAS_MONTH_START, gasDayLabel, weatherYear } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { basis as signedBasis, money } from '../shared/format';
import { FORWARD_CURVES, WINTER_PATHS } from './forwardTable';

// ---------------------------------------------------------------------------
// Figure 1: the forward curve, as the market would draw it from a given day and storage level.

export type CurveDate = 'apr1' | 'nov1' | 'feb1';
/** Days of the gas year the curve can be drawn on. */
export const CURVE_DAY: Record<CurveDate, number> = { apr1: 0, nov1: 214, feb1: 306 };
const CURVE_DATE_LABEL: Record<CurveDate, string> = { apr1: 'April 1', nov1: 'November 1', feb1: 'February 1' };

/** Storage on the curve's day, as a percentage of what the seasonal plan expects then. */
export const LEVEL_MIN = 60;
export const LEVEL_MAX = 100;
export const LEVEL_STEP = 5;
export const FWD_DEFAULTS = { date: 'nov1' as CurveDate, level: 100, month: 2 };
/** The storage shortfall the prose discusses: 75% of the planned gas on November 1. */
export const SHORT_LEVEL = 75;

/** Working gas in each field on a day, scaled from the normal-year plan. */
export function storageAtLevel(day: number, levelPct: number): StorageState {
  const plan = normalPlan();
  return { saltflat: (planInventory(plan, 'saltflat', day) * levelPct) / 100, hollowcreek: (planInventory(plan, 'hollowcreek', day) * levelPct) / 100 };
}

/** The expected forward curve (24 simulated weather years) drawn on `date` with storage at `levelPct` of plan, computed live (about 0.2 s). */
export function computeCurve(date: CurveDate, levelPct: number): ForwardCurve {
  return forwardCurve({ startDay: CURVE_DAY[date], startStorage: storageAtLevel(CURVE_DAY[date], levelPct) });
}

const curveCache = new Map<string, ForwardCurve>();
/**
 * The same curve, read from the table precomputed for every setting of the figure (forwardTable.ts) so
 * the lesson paints at once; any other setting is computed and cached.
 */
export function curveAt(date: CurveDate, levelPct: number): ForwardCurve {
  const key = `${date}|${levelPct}`;
  let c = curveCache.get(key);
  if (!c) {
    c = FORWARD_CURVES[key] ?? computeCurve(date, levelPct);
    curveCache.set(key, c);
  }
  return c;
}

/** Index of a gas-year month (0 = April) in a curve, or −1. */
function idx(c: ForwardCurve, gasMonth: number): number {
  return c.months.indexOf(gasMonth);
}

/** True when the curve's December, January and February each cost less than the month before: backwardation through the winter. */
export function winterBackwardated(c: ForwardCurve): boolean {
  const [dec, jan, feb] = [8, 9, 10].map((m) => c.calder[idx(c, m)]);
  return dec > jan && jan > feb;
}

/** Average of the curve's months that fall in the withdrawal season (Nov–Mar) and in the injection season (Apr–Oct). */
export function strips(c: ForwardCurve): { winter: number; summer: number } {
  const w: number[] = [];
  const s: number[] = [];
  c.months.forEach((m, k) => (m >= 7 ? w : s).push(c.calder[k]));
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  return { winter: mean(w), summer: mean(s) };
}

/** The highest storage level (on the slider's grid) at which the curve drawn on November 1 is backwardated through the winter. */
export function backwardationThreshold(): number {
  for (let l = LEVEL_MAX; l >= LEVEL_MIN; l -= LEVEL_STEP) if (winterBackwardated(curveAt('nov1', l))) return l;
  return NaN;
}

/** The first challenge: November 1, the highest storage level at which December > January > February. */
export function curveChallengeSolved(s: { date: CurveDate; level: number }): boolean {
  if (s.date !== 'nov1' || !winterBackwardated(curveAt('nov1', s.level))) return false;
  return s.level + LEVEL_STEP > LEVEL_MAX || !winterBackwardated(curveAt('nov1', s.level + LEVEL_STEP));
}

// ---------------------------------------------------------------------------
// Figure 2: the February futures contract from November 1 to expiry, along three winters.

export const FEB_START = GAS_MONTH_START[10];
export const FEB_END = GAS_MONTH_START[11];
export const FEB_DAYS = FEB_END - FEB_START;
/** Trading in the February contract stops on January 28. */
export const EXPIRY_DAY = GAS_MONTH_START[9] + 27;
/** Days the contract's price is shown: every second week from November 1, and the last trading day. */
export const MARK_DAYS = [214, 228, 242, 256, 270, 284, 298, EXPIRY_DAY];
const SCENARIOS = 24;

/**
 * The market's expectation, on `startDay`, of February's average daily Calder price: the same
 * calculation as the forward curve (24 simulated weather years from today's storage), stopped at the
 * end of February.
 */
export function expectedFebruary(startDay: number, storage: StorageState): number {
  let s = 0;
  for (let i = 0; i < SCENARIOS; i++) {
    const run = simulateYear({ weather: weatherYear(1000 + i), startDay, days: FEB_END - startDay, startStorage: storage });
    const feb = run.slice(FEB_START - startDay);
    s += feb.reduce((a, d) => a + d.price.calder, 0) / feb.length;
  }
  return s / SCENARIOS;
}

export type WinterId = 'cold' | 'typical' | 'warm';
/**
 * Three simulated winters, chosen for how much storage they used by late January: the cold winter of
 * Lesson 4.4, the typical winter of Lessons 4.1, 4.2 and 4.4, and a warm one seen only here.
 */
export const WINTERS: Record<WinterId, { seed: number; label: string }> = {
  cold: { seed: 29, label: 'A cold winter' },
  typical: { seed: 3, label: 'A typical winter' },
  warm: { seed: 61, label: 'A warm winter' },
};
/** A winter id from saved state, or the default if it names a winter no longer offered. */
const winterOf = (id: string): WinterId => (id in WINTERS ? (id as WinterId) : 'typical');

/** The February contract's price on each of MARK_DAYS, and February's daily Calder and Metro prices. */
export interface WinterPath {
  path: number[];
  febCalder: number[];
  febMetro: number[];
}
export interface WinterRun extends WinterPath {
  /** February's average Calder and Metro prices. */
  calderAvg: number;
  metroAvg: number;
}

/** The February contract along a winter's weather, from November 1 with storage as planned, computed live (about 0.3 s). */
export function computeWinterPath(seed: number): WinterPath {
  const start = storageAtLevel(214, 100);
  const days: YearDay[] = simulateYear({ weather: weatherYear(seed), startDay: 214, days: FEB_END - 214, startStorage: start });
  const path = MARK_DAYS.map((t) => expectedFebruary(t, t === 214 ? start : days[t - 214 - 1].storage));
  const feb = days.slice(FEB_START - 214);
  return { path, febCalder: feb.map((d) => d.price.calder), febMetro: feb.map((d) => d.price.metro) };
}

const winterCache = new Map<WinterId, WinterRun>();
/** A winter's February contract and February prices, from the precomputed table (or computed); cached. */
export function winterRun(id: WinterId): WinterRun {
  let w = winterCache.get(id);
  if (!w) {
    const seed = WINTERS[id].seed;
    const p = WINTER_PATHS[seed] ?? computeWinterPath(seed);
    const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
    w = { ...p, calderAvg: avg(p.febCalder), metroAvg: avg(p.febMetro) };
    winterCache.set(id, w);
  }
  return w;
}

/** Metro's utility buys this much gas a day through February. */
export const UTILITY_MMBTU_PER_DAY = 50_000;
/** Contracts that cover exactly the utility's February gas: 50,000 × 28 ÷ 10,000. */
export const HEDGE_CONTRACTS = (UTILITY_MMBTU_PER_DAY * FEB_DAYS) / FUTURES_CONTRACT_MMBTU;
/** Illustrative margins per contract, $. */
export const INITIAL_MARGIN = 4000;
export const MAINTENANCE_MARGIN = 3000;
export const HEDGE_DEFAULTS = { winter: 'typical' as WinterId, contracts: 0, swap: false };

/** The price of a February Metro basis swap on November 1: the curve's expected Metro − Calder for February. */
export function swapBasis(): number {
  const c = curveAt('nov1', 100);
  const k = idx(c, 10);
  return c.metro[k] - c.calder[k];
}

export interface UtilityCost {
  /** What February's gas cost at Metro's daily prices, per MMBtu. */
  unhedged: number;
  /** Gain on the futures (+) or loss (−), $. */
  futuresGain: number;
  /** Payment from the basis swap (+) or to it (−), $. */
  swapPayoff: number;
  /** Net cost per MMBtu after the futures and the swap. */
  net: number;
}

/** The utility's February gas bill in a winter, with `contracts` futures bought on November 1 and, optionally, a basis swap. */
export function utilityCost(id: WinterId, contracts: number, swap: boolean): UtilityCost {
  const w = winterRun(id);
  const volume = UTILITY_MMBTU_PER_DAY * FEB_DAYS;
  const bill = w.febMetro.reduce((a, p) => a + p * UTILITY_MMBTU_PER_DAY, 0);
  const futuresGain = (w.path[w.path.length - 1] - w.path[0]) * contracts * FUTURES_CONTRACT_MMBTU;
  const swapPayoff = swap ? (w.metroAvg - w.calderAvg - swapBasis()) * volume : 0;
  return { unhedged: bill / volume, futuresGain, swapPayoff, net: (bill - futuresGain - swapPayoff) / volume };
}

/** The lowest and highest net cost per MMBtu across the three winters for a position. */
export function costRange(contracts: number, swap: boolean): { lo: number; hi: number } {
  const xs = (Object.keys(WINTERS) as WinterId[]).map((id) => utilityCost(id, contracts, swap).net);
  return { lo: Math.min(...xs), hi: Math.max(...xs) };
}

/** The position, on the slider's steps of 10, that narrows the cost range across these three winters most: hindsight, not a hedge rule. */
export function narrowestHedge(swap: boolean): number {
  let best = 0;
  for (let n = 0; n <= 200; n += 10) {
    const r = costRange(n, swap);
    const b = costRange(best, swap);
    if (r.hi - r.lo < b.hi - b.lo) best = n;
  }
  return best;
}

/** The second challenge: futures covering exactly the utility's February gas, plus the basis swap. */
export function hedgeSolved(s: { contracts: number; swap: boolean }): boolean {
  return s.contracts === HEDGE_CONTRACTS && s.swap;
}

// ---------------------------------------------------------------------------

const CALDER = GRAPHIC.green;
const METRO = '#6b6b6b';
const SPOT = GRAPHIC.orange;
const usd2 = (x: number) => usd(x, 2);
const MONTH_TICKS = [214, 244, 275, 306, 334];

export default function Lesson() {
  // ---- Figure 1.
  const f = useScenario('curve', FWD_DEFAULTS);
  const fs = f.state;
  const curve = curveAt(fs.date, fs.level);
  const k = Math.max(0, Math.min(11, Math.round(fs.month)));
  const st = strips(curve);
  const solvedCurve = curveChallengeSolved(fs);
  const xs = curve.months.map((_, i) => i);
  const lo = curve.calder.map((p, i) => p - curve.calderSd[i]);
  const hi = curve.calder.map((p, i) => p + curve.calderSd[i]);
  const yTop = Math.max(6.5, Math.ceil(Math.max(...hi, ...curve.metro) * 2) / 2);
  const label = (i: number) => GAS_MONTHS[curve.months[i]];

  // ---- Numbers for the prose (cached; the defaults are drawn first anyway).
  const BASE = curveAt('nov1', 100);
  const SHORT = curveAt('nov1', SHORT_LEVEL);
  const APR = curveAt('apr1', 100);
  const baseStrips = strips(BASE);
  const shortStrips = strips(SHORT);
  const PLAN_FEB = normalPlan().price.calder[10];
  const at = (c: ForwardCurve, m: number) => c.calder[idx(c, m)];
  /** A difference of two prices as shown, rounded to cents first, so the prose's arithmetic adds up. */
  const gap = (a: number, b: number) => Math.round(a * 100) / 100 - Math.round(b * 100) / 100;
  const bAt = (c: ForwardCurve, m: number) => c.metro[idx(c, m)] - c.calder[idx(c, m)];

  // ---- Figure 2.
  const h = useScenario('hedge', HEDGE_DEFAULTS);
  const hs = h.state;
  const wid = winterOf(hs.winter);
  const w = winterRun(wid);
  const entry = w.path[0];
  const final = w.path[w.path.length - 1];
  const marks = futuresMarks(hs.contracts, entry, w.path.slice(1));
  const calls = hs.contracts > 0 ? marginCalls(hs.contracts, marks.cumulative, INITIAL_MARGIN, MAINTENANCE_MARGIN) : [];
  const cost = utilityCost(wid, hs.contracts, hs.swap);
  const solvedHedge = hedgeSolved(hs);
  const rNow = costRange(hs.contracts, hs.swap);
  const rNone = costRange(0, false);
  const rFull = costRange(HEDGE_CONTRACTS, false);
  const rSwap = costRange(HEDGE_CONTRACTS, true);
  const COLD = winterRun('cold');
  const WARM = winterRun('warm');
  const TYP = winterRun('typical');
  const OVER = narrowestHedge(false);
  const OVER_SWAP = narrowestHedge(true);
  const rOver = costRange(OVER, false);
  const rOverSwap = costRange(OVER_SWAP, true);
  /** From the warm winter to the cold one: how much the unhedged bill rose, and how much the contract's final price did, per MMBtu. */
  const billSwing = utilityCost('cold', 0, false).unhedged - utilityCost('warm', 0, false).unhedged;
  const futuresSwing = COLD.path[COLD.path.length - 1] - WARM.path[WARM.path.length - 1];
  const WARM_CALLS = marginCalls(HEDGE_CONTRACTS, futuresMarks(HEDGE_CONTRACTS, WARM.path[0], WARM.path.slice(1)).cumulative, INITIAL_MARGIN, MAINTENANCE_MARGIN).length;
  const swapB = swapBasis();
  /** What futures plus the swap lock in, $/MMBtu, and how far each winter's February spot ended from the contract's last price. */
  const LOCKED = COLD.path[0] + swapB;
  const miss = (r: WinterRun) => r.calderAvg - r.path[r.path.length - 1];
  const febDays = Array.from({ length: FEB_DAYS }, (_, i) => FEB_START + i + 0.5);
  const pTop = Math.max(6.5, Math.ceil(Math.max(...w.febCalder, ...w.path) * 2) / 2);
  const pBot = Math.min(3, Math.floor(Math.min(...w.febCalder, ...w.path) * 2) / 2);

  const curveStatus =
    fs.date !== 'nov1'
      ? `Draw the curve on November 1 first; it’s drawn on ${CURVE_DATE_LABEL[fs.date]}.`
      : fs.level === LEVEL_MAX
        ? `Set storage to ${SHORT_LEVEL}% of plan to check your prediction, then keep going.`
        : `Storage is at ${fs.level}% of plan; the caption gives December, January and February.`;

  return (
    <LessonPage id="gas/4.5">
      <P>
        <a href={lessonHref('gas/4.4')}>The previous lesson</a> watched storage carry gas from summer into winter, and a real winter wander away from the plan. Nobody
        in the market waits until February to find out what February’s gas will cost. Buyers and sellers agree prices for future months today, and those prices are
        where the physical system’s expectations become numbers anyone can see.
      </P>
      <P>
        Three kinds of price are traded. The <b>spot</b> price is for gas delivered right away: in practice, tomorrow, bought and sold today. A <b>forward</b> is a price
        agreed now for gas delivered later, at a set place, over a set month, between two parties who write their own contract. A <b>futures</b> contract is a forward made
        standard enough to trade on an exchange: in our region, 10,000 MMBtu of gas delivered evenly through a month at Calder Hub, the same size as the futures contract
        on Henry Hub, North America’s benchmark. The list of prices for the coming months is the <K c="price">forward curve</K>.
      </P>
      <P>
        What should a forward price be? If traders expect the weather to be like it has been and ask nothing extra for bearing risk, it should be the average spot price
        they expect that month. The next demonstration computes exactly that: it runs the region’s market from the chosen day through 24 simulated weather years, starting
        from the gas in storage that day, and averages each month’s prices.
      </P>
      <P>
        The 24 years don’t agree. The shaded band shows by how much, as one <b>standard deviation</b> either side of the curve: square how far each year’s average
        for the month lies from the average of all 24, average the squares, and take the square root. That gives a typical distance from the average — for numbers
        spread in a bell shape, about two in three lie within it. Choose the day the curve is drawn on and how much gas storage holds, as a share of the
        plan of <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>, and drag across the chart to read any month:
      </P>

      <Figure name="Gas Forward Curve" scenario={f}>
        <Segmented
          label="Curve drawn on"
          value={fs.date}
          onChange={(v) => f.set({ date: v })}
          options={(Object.keys(CURVE_DAY) as CurveDate[]).map((d) => ({ value: d, label: CURVE_DATE_LABEL[d] }))}
        />
        <XYChart
          xDomain={[-0.5, 11.5]}
          yDomain={[2, yTop]}
          xTicks={xs}
          xFormat={(v) => label(v)}
          yFormat={(v) => `$${fmt(v, 2)}`}
          yLabel="Price for delivery in each month, $/MMBtu"
          height={250}
          series={[
            { xs, ys: hi, lows: lo, kind: 'band', color: tint(GRAPHIC.green, 0.3), opacity: 1 },
            { xs, ys: curve.metro, color: METRO, width: 1.5, dash: '5 4' },
            { xs, ys: curve.calder, color: CALDER, width: 2.5 },
            { xs, ys: curve.calder, color: CALDER, kind: 'points', r: 3.5 },
          ]}
          markers={[{ x: k, y: curve.calder[k], color: TEXT.green, r: 6, label: usd2(curve.calder[k]), labelPos: k > 8 ? 'left' : 'above' }]}
          cursor={k}
          onScrub={(x) => f.set({ month: Math.round(x) })}
          scrubLabel="Delivery month"
          ariaLabel={`Forward curve for Calder Hub drawn on ${CURVE_DATE_LABEL[fs.date]} with storage at ${fs.level}% of plan: ${curve.months.map((m, i) => `${GAS_MONTHS[m]} ${usd2(curve.calder[i])}`).join(', ')}. Metro is ${signedBasis(curve.metro[k] - curve.calder[k])} above Calder in ${GAS_MONTH_NAMES[curve.months[k]]}.`}
        />
        <Legend
          items={[
            { label: 'Calder Hub', color: CALDER, kind: 'line' },
            { label: 'One standard deviation either side', color: tint(GRAPHIC.green, 0.3) },
            { label: 'Metro', color: METRO, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `${GAS_MONTH_NAMES[curve.months[k]]} at Calder`, value: `${usd2(curve.calder[k])} ± ${usd2(curve.calderSd[k])}`, tone: 'green' },
            { label: `Metro basis in ${GAS_MONTHS[curve.months[k]]}`, value: signedBasis(curve.metro[k] - curve.calder[k]), tone: 'green' },
            { label: 'winter months, average', value: usd2(st.winter), tone: 'green' },
            { label: 'summer months, average', value: usd2(st.summer), tone: 'green' },
          ]}
        />
        <Slider
          label="Storage that day"
          tone="gold"
          value={fs.level}
          min={LEVEL_MIN}
          max={LEVEL_MAX}
          step={LEVEL_STEP}
          onChange={(v) => f.set({ level: v })}
          display={`${fs.level}% of plan`}
        />
        <Caption>{`December ${usd2(at(curve, 8))}, January ${usd2(at(curve, 9))}, February ${usd2(at(curve, 10))}.`}</Caption>
      </Figure>

      <P>
        Drawn on November 1, with storage as full as the plan expects, the curve starts at {usd2(at(BASE, 8))} for December, climbs to {usd2(at(BASE, 9))} for
        January and {usd2(at(BASE, 10))} for February, eases to {usd2(at(BASE, 11))} for March, and drops to {usd2(at(BASE, 0))} for April. Winter months average {usd2(baseStrips.winter)} and summer months{' '}
        {usd2(baseStrips.summer)}. Two things put the winter premium there. One is the scarcity rent of <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>: storage is
        full by November, so summer gas can’t all be carried into winter. The other is that prices answer the weather lopsidedly: a cold spell that drains storage raises
        them more than an equally mild spell lowers them. So the average over all the winters the market might get comes out above the price of a perfectly average
        one — Lesson 4.4’s plan, with normal weather every day, put February at {usd2(PLAN_FEB)}. The band is widest in February, ±
        {usd2(BASE.calderSd[idx(BASE, 10)])}, because by then a whole winter’s luck has accumulated.
      </P>
      <P>
        Traders have names for the curve’s shape. When later months cost more than nearer ones, the curve is in <b>contango</b>; when they cost less, it’s in{' '}
        <b>backwardation</b>. This curve is in contango from December to February, as the chance of a cold spell builds while storage empties and its wells deliver less
        (the ratchets of <a href={lessonHref('gas/3.4')}>Lesson 3.4</a>). It is backwardated from February into spring, nearly flat through the summer — storage, with
        room to spare, holds summer months within cents of each other — and in contango again toward the next winter.
      </P>
      <P>
        That winter climb — {usd2(at(BASE, 9) - at(BASE, 8))} from December to January and {usd2(at(BASE, 10) - at(BASE, 9))} from January to February — is far
        more than the {usd2(SEASONAL_COSTS.holdCostPerMonth)} a month of carry that <a href={lessonHref('gas/4.4')}>Lesson 4.4</a> found between neighboring
        months. Carry sets the gap only while storage can shift gas between the months. By February the fields are partly empty and deliver less each day: in these simulated winters
        Hollow Creek, which holds most of the region’s gas, is withdrawing as fast as it can on most February days. Then its deliverability, not carry, decides how
        much gas it can give February, and the gap can grow. Nothing limits backwardation
        either: storage carries gas forward in time, but gas that hasn’t been produced yet can’t be sold now, so a later month can fall any distance below an
        earlier one.
      </P>
      <Challenge
        id="a"
        figure="Gas Forward Curve"
        question={`Predict first: if storage held only ${SHORT_LEVEL}% of the planned gas on November 1, would the climb from December to February get steeper or flatter? Check it, then find the highest storage level, in the slider’s steps, at which the winter tilts the other way: December dearer than January, and January dearer than February.`}
        solved={solvedCurve}
        status={curveStatus}
        success={`Solved: ${fs.level}% of plan — December ${usd2(at(curve, 8))}, January ${usd2(at(curve, 9))}, February ${usd2(at(curve, 10))}. Short of gas from the start, the fields can’t deliver freely even in December, so the nearest months rise most: the climb from December to February shrinks from ${usd2(gap(at(BASE, 10), at(BASE, 8)))} with storage as planned to ${usd2(gap(at(SHORT, 10), at(SHORT, 8)))} at ${SHORT_LEVEL}%, and here it tips over. A step more storage and the winter climbs again. A backwardated front of the curve is the market’s way of saying “we’re short now”.`}
      />

      <P>
        With only {SHORT_LEVEL}% of the planned gas on November 1, every month rises, and the nearest winter months most: December by{' '}
        {usd2(gap(at(SHORT, 8), at(BASE, 8)))}, to {usd2(at(SHORT, 8))}, February by {usd2(gap(at(SHORT, 10), at(BASE, 10)))}, to {usd2(at(SHORT, 10))}. The winter months
        average {usd2(shortStrips.winter)}; next summer rises less, to {usd2(shortStrips.summer)}, because the region has to refill storage then. The dashed line
        is Metro: {signedBasis(bAt(BASE, 9))} over Calder in January and {signedBasis(bAt(BASE, 10))} in February with storage as planned, more than the{' '}
        {usd2(bAt(BASE, 0))} it costs to move gas up Northline, because a cold February can fill Northline (<a href={lessonHref('gas/4.2')}>Lesson 4.2</a>).
        With storage short, February’s Metro basis widens to {signedBasis(bAt(SHORT, 10))}. Drawn on April 1 instead, the whole year lies ahead: summer near{' '}
        {usd2(at(APR, 3))} and February at {usd2(at(APR, 10))}.
      </P>

      <H2>Futures</H2>
      <P>
        A futures contract settles its gains and losses every day. Buyer and seller each deal with the exchange’s clearinghouse, not with each other, and post{' '}
        <b>margin</b>: a deposit against losses. Every evening each contract is marked to the day’s settlement price, and the change in its value, $10,000 for every $1 per
        MMBtu, is paid from the losing side’s account to the winning side’s. If an account falls below its <b>maintenance margin</b>, the holder must top it up the next
        day — a <b>margin call</b> — or the position is closed. A contract that’s still open when trading stops is settled by delivery: the buyer receives 10,000 MMBtu at
        Calder Hub, spread evenly over the month, at the final settlement price. On the Henry Hub contract, trading stops three business days before the month begins, and
        only a small share of contracts ever reach delivery; most are closed out first. Someone who wants gas somewhere other than the hub can add a <b>basis swap</b>,
        which pays the difference between that place’s price and the hub’s.
      </P>
      <P>
        In the next demonstration, the February contract trades from November 1 until January 28, its last trading day here, through one of three simulated winters:
        the cold winter of Lesson 4.4, the typical winter of Lessons 4.2 and 4.4, or a warm one. Its
        price on each date is the market’s expectation of February, recomputed from the gas then in storage, exactly as the curve in{' '}
        <FigRef to="Gas Forward Curve">the first demonstration</FigRef> was. We mark it every second week, not every evening, and count margin calls only on
        those dates. After trading stops, the dots are February’s actual daily prices. Metro’s gas utility will buy{' '}
        {fmt(UTILITY_MMBTU_PER_DAY)} MMBtu a day at Metro’s price through February; set how many February contracts it buys on November 1 and whether it adds a basis
        swap at the November 1 price of {signedBasis(swapB)}:
      </P>

      <Figure name="Gas Forward Curve · convergence" scenario={h}>
        <Segmented label="Winter" value={wid} onChange={(v) => h.set({ winter: v })} options={(Object.keys(WINTERS) as WinterId[]).map((id) => ({ value: id, label: WINTERS[id].label }))} />
        <XYChart
          xDomain={[214, FEB_END]}
          yDomain={[pBot, pTop]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => gasDayLabel(v)}
          yFormat={(v) => `$${fmt(v, 2)}`}
          yLabel="$/MMBtu"
          height={240}
          series={[
            { xs: MARK_DAYS, ys: w.path, color: CALDER, width: 2.5 },
            { xs: MARK_DAYS, ys: w.path, color: CALDER, kind: 'points', r: 3.5 },
            { xs: febDays, ys: w.febCalder, color: SPOT, kind: 'points', r: 2.5 },
            { xs: [FEB_START, FEB_END], ys: [w.calderAvg, w.calderAvg], color: SPOT, width: 1.5, dash: '4 3' },
          ]}
          hLines={[{ at: entry, color: '#9a9a9a', dash: '4 4', width: 1, label: `bought at ${usd2(entry)}`, labelAt: 'start' }]}
          vLines={[{ at: EXPIRY_DAY, color: '#777', dash: '3 4', width: 1, label: 'trading stops', labelAt: 'end' }]}
          markers={[{ x: EXPIRY_DAY, y: final, color: TEXT.green, r: 6, label: usd2(final), labelPos: 'left' }]}
          ariaLabel={`${WINTERS[wid].label}: the February contract trades at ${usd2(entry)} on November 1 and ${usd2(final)} on January 28. February’s daily Calder prices average ${usd2(w.calderAvg)}.`}
        />
        <Legend
          items={[
            { label: 'February futures', color: CALDER, kind: 'line' },
            { label: 'February’s daily price at Calder', color: SPOT },
            { label: 'Its average', color: SPOT, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'February’s average spot', value: usd2(w.calderAvg), tone: 'orange' },
            { label: `gain on ${hs.contracts} contracts`, value: money(cost.futuresGain), tone: cost.futuresGain < 0 ? 'red' : 'green' },
            { label: 'margin calls', value: hs.contracts > 0 ? `${calls.length}` : '—' },
            { label: 'utility’s cost, unhedged', value: usd2(cost.unhedged), tone: 'green' },
            { label: 'utility’s cost, net', value: usd2(cost.net), tone: 'green' },
          ]}
        />
        <Slider
          label="February contracts bought"
          tone="green"
          value={hs.contracts}
          min={0}
          max={200}
          step={10}
          onChange={(v) => h.set({ contracts: v })}
          display={`${hs.contracts} · ${fmt(hs.contracts * FUTURES_CONTRACT_MMBTU)} MMBtu`}
        />
        <Checkbox label={`Add a Metro basis swap at ${signedBasis(swapB)}`} checked={hs.swap} onChange={(v) => h.set({ swap: v })} />
        <Caption>
          {`Across the three winters, this position leaves the utility paying between ${usd2(rNow.lo)} and ${usd2(rNow.hi)} per MMBtu for February’s gas.`}
          {hs.contracts > 0 ? ` Margin: ${money(INITIAL_MARGIN * hs.contracts)} up front, topped up whenever it falls below ${money(MAINTENANCE_MARGIN * hs.contracts)} (illustrative).` : ''}
        </Caption>
      </Figure>

      <P>
        All three winters start from the same {usd2(entry)}. In the cold one, December and January drain storage faster than planned, every recalculation finds less gas
        in the ground, and the contract climbs to {usd2(COLD.path[COLD.path.length - 1])} by January 28. In the warm one, storage stays fuller than planned and the price
        slides to {usd2(WARM.path[WARM.path.length - 1])}. The futures price doesn’t jump to the answer; it drifts as the evidence arrives, because most of what decides
        February — February’s own weather — is still unknown until February.
      </P>
      <P>
        At expiry the contract becomes February gas bought for the whole month: the futures price has <b>converged</b> on the price of the gas it delivers. February’s
        daily prices still scatter around it as February’s weather arrives. In the cold winter they average {usd2(COLD.calderAvg)}, close to the final{' '}
        {usd2(COLD.path[COLD.path.length - 1])}; in the typical one, {usd2(TYP.calderAvg)} against {usd2(TYP.path[TYP.path.length - 1])}; in the warm one,{' '}
        {usd2(WARM.calderAvg)} against {usd2(WARM.path[WARM.path.length - 1])}.
      </P>

      <Challenge
        id="b"
        figure="Gas Forward Curve · convergence"
        question={`Metro’s utility wants to fix, on November 1, what it pays for February’s gas: ${fmt(UTILITY_MMBTU_PER_DAY)} MMBtu a day for ${FEB_DAYS} days, at Metro’s price. Predict first: with the February contract at ${usd2(COLD.path[0])} and the basis swap at ${signedBasis(swapB)}, what price per MMBtu would a perfect hedge lock in? Then build the hedge — contracts covering exactly that gas, plus the swap — and see how close the three winters come.`}
        solved={solvedHedge}
        status={
          hs.contracts !== HEDGE_CONTRACTS
            ? `${hs.contracts} contracts cover ${fmt(hs.contracts * FUTURES_CONTRACT_MMBTU)} MMBtu of the ${fmt(UTILITY_MMBTU_PER_DAY * FEB_DAYS)} the utility buys.`
            : 'The futures cover the gas at Calder’s price, but the utility pays Metro’s: add the swap.'
        }
        success={`Solved: ${HEDGE_CONTRACTS} contracts (${fmt(UTILITY_MMBTU_PER_DAY)} × ${FEB_DAYS} ÷ ${fmt(FUTURES_CONTRACT_MMBTU)}) and the swap, which together lock in about ${usd2(COLD.path[0])} + ${usd2(swapB)} = ${usd2(LOCKED)}. The three winters land between ${usd2(rSwap.lo)} and ${usd2(rSwap.hi)}, against ${usd2(rNone.lo)}–${usd2(rNone.hi)} unhedged and ${usd2(rFull.lo)}–${usd2(rFull.hi)} with the futures alone. Each misses ${usd2(LOCKED)} by how far February’s spot price ended from the contract’s last price — ${signedBasis(miss(COLD))} in the cold winter, ${signedBasis(miss(TYP))} in the typical one, ${signedBasis(miss(WARM))} in the warm one: February’s own weather, after trading stopped.`}
      />

      <P>
        Keep adding contracts and the range keeps narrowing, to {usd2(rOver.hi - rOver.lo)} wide at {OVER}, or {usd2(rOverSwap.hi - rOverSwap.lo)} at {OVER_SWAP} with
        the swap. That isn’t a better hedge. The first {HEDGE_CONTRACTS} contracts match the gas the utility buys; each one more is a bet that its bill moves
        further than the futures price. In these three winters it did — from the warm winter to the cold one the bill rose {usd2(billSwing)} per MMBtu and the
        contract only {usd2(futuresSwing)}, as Metro’s basis widened and February’s weather pushed the way the futures had drifted — but three winters are too few
        to count on. A winter warm until late January and cold in February would make the extra contracts lose money just as the bill rose.
      </P>
      <P>
        Look at what the hedge costs, too. In the warm winter the utility loses {money(-utilityCost('warm', HEDGE_CONTRACTS, false).futuresGain)} on its futures — the
        price of certainty, paid in exactly the year it turned out not to be needed — and meets {WARM_CALLS} margin call{WARM_CALLS === 1 ? '' : 's'} on our
        fortnightly marks, each paid in cash before February’s gas is even bought. Hedgers need cash to survive the marks.
      </P>

      <H2>From pipes to prices</H2>
      <P>
        This chapter asked how physical constraints become prices, contracts and institutions. A single price balances the region’s supply against its most flexible
        uses (<a href={lessonHref('gas/4.1')}>Lesson 4.1</a>). Every place prices against a hub by a basis that stays at the cost of transport until a pipe fills (
        <a href={lessonHref('gas/4.2')}>Lesson 4.2</a>). The right to use a full pipe becomes property that is auctioned and resold (
        <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>). Storage ties the months together and, when it fills, puts a premium on winter (
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>). And forward and futures markets turn it all into a curve of prices that anyone can trade today.
      </P>
      <P>
        Each of those prices differs from another — Metro from Calder, January from July, a cold winter’s February from a warm one’s — and each difference has a
        physical cause. In <a href={lessonHref('gas/5.1')}>Chapter 5</a> we take those differences one at a time, starting with the price gap between two places.
      </P>
    </LessonPage>
  );
}
