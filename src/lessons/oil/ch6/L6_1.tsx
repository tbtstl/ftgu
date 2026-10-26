import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, niceDomain, niceTicks, pct, usd, useScenario } from '../../../framework';
import { fullCarry } from '../../../engines/oil/market';
import { CARRY_DEFAULTS, COST_PER_BBL, RULE_DEFAULTS, backtest, calendarRule, cashAndCarry, type BacktestResult, type CarryResult } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { XYChart, type XYMarker } from '../shared/charts';
import { LONG_SWATCH, RISK_TONE, SHORT_SWATCH, YEAR_TICKS, money, pnlTone, positionBands, yearTick } from './style';

const GREEN = '#6d9c37';
const ORANGE = '#d0702a';
const GRAY = '#9a9a9a';
const INK = '#333333';
/** Above this fill, the engine's futures curve starts paying for storage at sea (Lesson 5.4). */
const TANK_TOPS = 0.97;

// ---------------------------------------------------------------------------
// The calendar rule (first demonstration).

export type GroupMode = 'steady' | 'free';

export interface TraderState {
  /** Kessler's working storage, million barrels. */
  capacity: number;
  /** Supply outages a year. */
  shocks: number;
  /** Does the producer group use spare capacity to steady prices? */
  group: GroupMode;
  /** Weeks over which the change in fill is measured. */
  lookback: number;
  /** Change in fill that triggers a position, percentage points of capacity. */
  threshold: number;
}

export const TRADER_DEFAULTS: TraderState = {
  capacity: HISTORY_DEFAULTS.kesslerCapacity,
  shocks: HISTORY_DEFAULTS.supplyShocks,
  group: HISTORY_DEFAULTS.groupStabilizes ? 'steady' : 'free',
  lookback: RULE_DEFAULTS.calendar.lookback,
  threshold: RULE_DEFAULTS.calendar.threshold * 100,
};

/** Units of the spread traded (each: one month-1 and one month-2 contract of 1,000 barrels). */
export const UNITS = 10;
export const CAPACITY_MIN = 4;
export const CAPACITY_MAX = 60;

/** The simulated history for a set of physical drivers. */
export function traderHistory(st: TraderState): HistoryWeek[] {
  return oilHistory({ kesslerCapacity: st.capacity, supplyShocks: st.shocks, groupStabilizes: st.group === 'steady' });
}

/** The calendar rule's backtest at ten units. */
export function runTrader(st: TraderState, costPerBbl: number = COST_PER_BBL): BacktestResult {
  const h = traderHistory(st);
  return backtest(h, 'calendar', calendarRule(h, { lookback: st.lookback, threshold: st.threshold / 100 }), { units: UNITS, costPerBbl });
}

/** WTI month 1 minus month 2, $/bbl: positive in backwardation, negative in contango. */
export function calendarSpread(w: HistoryWeek): number {
  return w.wtiCurve[0] - w.wtiCurve[1];
}

function atStart(st: TraderState): boolean {
  const d = TRADER_DEFAULTS;
  return st.shocks === d.shocks && st.group === d.group && st.lookback === d.lookback && st.threshold === d.threshold;
}

/** Challenge a: the hub the reader predicts for, which closes about two-thirds of the gap a week. */
export const PREDICT_HUB = 6;

/**
 * The share of the gap between Kessler's stock and where the market is pushing it that a hub of
 * `capacity` million barrels closes in a week: the history's fill moves 1/τ of the gap a week, with
 * τ = capacity / 4 weeks (at least one).
 */
export function weeklyCatchUp(capacity: number): number {
  return 1 / Math.max(1, capacity / 4);
}

/**
 * Challenge a: with the outages, the producer group and the rule at their starting settings, the
 * reader predicts whether the calendar rule makes money in a 6-million-barrel hub, then sets it to check.
 */
export function predictedHubSolved(st: TraderState): boolean {
  return atStart(st) && st.capacity === PREDICT_HUB;
}

/** The smallest hub, to the nearest million barrels, in which the rule makes money at its starting settings. */
export function smallestProfitableHub(): number {
  for (let cap = CAPACITY_MIN; cap <= CAPACITY_MAX; cap++) if (runTrader({ ...TRADER_DEFAULTS, capacity: cap }).stats.total > 0) return cap;
  return NaN;
}

// ---------------------------------------------------------------------------
// Cash and carry (second demonstration).

export interface CarryState {
  /** Kessler's working storage, million barrels. */
  capacity: number;
  /** Months between buying spot and delivering on the future sold. */
  months: number;
  /** The storage fee the trader pays, $/bbl-month. */
  fee: number;
}

export const CARRY_STATE_DEFAULTS: CarryState = { capacity: HISTORY_DEFAULTS.kesslerCapacity, months: CARRY_DEFAULTS.months, fee: CARRY_DEFAULTS.fee };

export function runCarry(st: CarryState): CarryResult {
  return cashAndCarry(oilHistory({ kesslerCapacity: st.capacity }), { ...CARRY_DEFAULTS, fee: st.fee, months: st.months });
}

/** The cost of carrying a barrel for the trade's months, plus handling in and out, $/bbl. */
export function carryCost(spot: number, st: CarryState): number {
  return st.months * fullCarry(spot, st.fee, CARRY_DEFAULTS.rate) + 2 * CARRY_DEFAULTS.handling;
}

/** The future `months` out minus spot, $/bbl. */
export function forwardPremium(w: HistoryWeek, months: number): number {
  return w.wtiCurve[months] - w.wtiCurve[0];
}

/** The week in which the forward premium came closest to (or furthest past) the cost of carrying, and by how much. */
export function closestCarry(st: CarryState): { week: number; gap: number; fill: number } {
  const h = oilHistory({ kesslerCapacity: st.capacity });
  let best = { week: 0, gap: -Infinity, fill: 0 };
  h.forEach((w, t) => {
    const gap = forwardPremium(w, st.months) - carryCost(w.wtiCurve[0], st);
    if (gap > best.gap) best = { week: t, gap, fill: w.kesslerFill };
  });
  return best;
}

/**
 * Challenge b: with the trader's fee at the market's $0.40, the largest hub (to the nearest million
 * barrels) in which the cash-and-carry trade ever pays, for the holding period chosen.
 */
export function largestHubSolved(st: CarryState): boolean {
  if (st.fee !== CARRY_DEFAULTS.fee) return false;
  if (runCarry(st).trades === 0) return false;
  return st.capacity >= CAPACITY_MAX || runCarry({ ...st, capacity: st.capacity + 1 }).trades === 0;
}

/** The answer to challenge b for a holding period. */
export function largestCarryHub(months: number = CARRY_STATE_DEFAULTS.months): number {
  for (let cap = CAPACITY_MAX; cap >= CAPACITY_MIN; cap--) if (runCarry({ capacity: cap, months, fee: CARRY_DEFAULTS.fee }).trades > 0) return cap;
  return NaN;
}

/** Every setting of the rule the first demonstration's sliders offer, at the starting physical world: the range of five-year results. */
export function ruleSettingsRange(): { min: number; max: number; profitable: number; count: number } {
  const totals: number[] = [];
  for (let lookback = 1; lookback <= 8; lookback++)
    for (let i = 0; i <= 10; i++) totals.push(runTrader({ ...TRADER_DEFAULTS, lookback, threshold: i / 2 }).stats.total);
  return { min: Math.min(...totals), max: Math.max(...totals), profitable: totals.filter((x) => x > 0).length, count: totals.length };
}

// ---------------------------------------------------------------------------
// Formatting.

function kusd(v: number): string {
  if (Math.round(v) === 0) return '$0';
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1e6 ? `$${fmt(a / 1e6, 1)}M` : `$${fmt(a / 1000)}k`);
}

function cents(x: number): string {
  return `${fmt(Math.abs(x) * 100)} cents`;
}

export default function Lesson() {
  // Reference results quoted in the prose (starting settings unless noted).
  const ref = useMemo(() => {
    const D = TRADER_DEFAULTS;
    const hd = traderHistory(D);
    const spreads = hd.map(calendarSpread);
    const fills = hd.map((w) => w.kesslerFill);
    const base = runTrader(D);
    const loose = traderHistory({ ...D, group: 'free' });
    const smallH = oilHistory({ kesslerCapacity: CAPACITY_MIN });
    const firstHub = smallestProfitableHub();
    return {
      base,
      free: runTrader(D, 0),
      rules: ruleSettingsRange(),
      spreadMin: Math.min(...spreads),
      spreadMax: Math.max(...spreads),
      fillMin: Math.min(...fills),
      fillMax: Math.max(...fills),
      small: runTrader({ ...D, capacity: CAPACITY_MIN }),
      smallFree: runTrader({ ...D, capacity: CAPACITY_MIN }, 0),
      big: runTrader({ ...D, capacity: CAPACITY_MAX }),
      firstHub,
      first: runTrader({ ...D, capacity: firstHub }),
      calm: runTrader({ ...D, shocks: 0 }),
      calmMaxSpread: Math.max(...traderHistory({ ...D, shocks: 0 }).map(calendarSpread)),
      loose: runTrader({ ...D, group: 'free' }),
      looseFillMin: Math.min(...loose.map((w) => w.kesslerFill)),
      looseFillMax: Math.max(...loose.map((w) => w.kesslerFill)),
      carryClosest: closestCarry(CARRY_STATE_DEFAULTS),
      carrySmall: runCarry({ ...CARRY_STATE_DEFAULTS, capacity: CAPACITY_MIN }),
      carrySmall1: runCarry({ ...CARRY_STATE_DEFAULTS, capacity: CAPACITY_MIN, months: 1 }),
      carrySmall3: runCarry({ ...CARRY_STATE_DEFAULTS, capacity: CAPACITY_MIN, months: 3 }),
      topsSmall: smallH.filter((w) => w.kesslerFill >= TANK_TOPS).length,
      topsBase: hd.filter((w) => w.kesslerFill >= TANK_TOPS).length,
      fee30: runCarry({ ...CARRY_STATE_DEFAULTS, fee: 0.3 }),
      fee20: runCarry({ ...CARRY_STATE_DEFAULTS, fee: 0.2 }),
    };
  }, []);

  // --- First demonstration.
  const s1 = useScenario<TraderState>('time-spread', TRADER_DEFAULTS);
  const st = s1.state;
  const { capacity, shocks, group, lookback, threshold } = st;
  const h = useMemo(() => traderHistory({ ...TRADER_DEFAULTS, capacity, shocks, group }), [capacity, shocks, group]);
  const res = useMemo(() => backtest(h, 'calendar', calendarRule(h, { lookback, threshold: threshold / 100 }), { units: UNITS }), [h, lookback, threshold]);
  const stats = res.stats;
  const bands = useMemo(() => positionBands(res.positions), [res]);
  const longWeeks = res.positions.filter((p) => p > 0).length;
  const shortWeeks = res.positions.filter((p) => p < 0).length;
  const fillPts = h.map((w) => [w.t, w.kesslerFill * 100] as [number, number]);
  const spreadPts = h.map((w) => [w.t, calendarSpread(w)] as [number, number]);
  const sMin = Math.min(...spreadPts.map((p) => p[1]));
  const sMax = Math.max(...spreadPts.map((p) => p[1]));
  const [sy0, sy1] = niceDomain(Math.min(-0.5, sMin), Math.max(0.5, sMax), 4);
  const cum: Array<[number, number]> = [[0, 0]];
  let run = 0;
  res.pnl.forEach((v, i) => cum.push([(i + 1) / 52, (run += v)]));
  const cumVals = cum.map((p) => p[1]);
  const [py0, py1] = niceDomain(Math.min(0, ...cumVals), Math.max(1000, ...cumVals), 4);
  const fillLo = Math.min(...h.map((w) => w.kesslerFill));
  const fillHi = Math.max(...h.map((w) => w.kesslerFill));
  const solvedA = predictedHubSolved(st);

  // --- Second demonstration.
  const s2 = useScenario<CarryState>('cash-and-carry', CARRY_STATE_DEFAULTS);
  const cs = s2.state;
  const ch = useMemo(() => oilHistory({ kesslerCapacity: cs.capacity }), [cs.capacity]);
  const carry = useMemo(() => runCarry(cs), [cs]);
  const premPts = ch.map((w) => [w.t, forwardPremium(w, cs.months)] as [number, number]);
  const costPts = ch.map((w) => [w.t, carryCost(w.wtiCurve[0], cs)] as [number, number]);
  const tradeMarks: XYMarker[] = carry.locked.flatMap((v, t) => (v > 0 ? [{ x: ch[t].t, y: premPts[t][1], color: GREEN, r: 6 }] : []));
  const allY = [...premPts.map((p) => p[1]), ...costPts.map((p) => p[1])];
  const [cy0, cy1] = niceDomain(Math.min(...allY), Math.max(...allY), 4);
  const tops = ch.filter((w) => w.kesslerFill >= TANK_TOPS).length;
  const cFillPts = ch.map((w) => [w.t, w.kesslerFill * 100] as [number, number]);
  const solvedB = largestHubSolved(cs);
  const nextTrades = useMemo(() => (cs.capacity < CAPACITY_MAX ? runCarry({ ...cs, capacity: cs.capacity + 1 }).trades : 0), [cs]);
  const monthsLabel = `${cs.months} month${cs.months === 1 ? '' : 's'}`;

  const D = TRADER_DEFAULTS;
  const b = ref.base.stats;

  return (
    <LessonPage id="oil/6.1">
      <P>
        Chapter 5 ended with a list of the spreads that physical mechanisms leave behind: between delivery months, between places, between crudes, and between crude and
        the products made from it. This chapter takes them one at a time and asks a trader’s question of each: can we earn from it, and what in the physical world
        makes that possible? We start with the spread closest to the tanks.
      </P>
      <P>
        In <a href={lessonHref('oil/5.4')}>Lesson 5.4</a>, the futures curve turned out to be a reading of stocks. When Kessler’s tanks are scarce, the first delivery
        month trades over the second: backwardation. When they are ample, it trades under it: contango. The difference, month 1 minus month 2, is the{' '}
        <K c="price">calendar spread</K>. Mind the sign: Lesson 5.4 read the curve the other way round, so here a positive spread means backwardation. In our
        simulated history it runs from {cents(ref.spreadMin)} of contango to {usd(ref.spreadMax, 2)} of backwardation as Kessler’s fill swings between{' '}
        {pct(ref.fillMin)} and {pct(ref.fillMax)}. WTI is a real benchmark, delivered at Cushing, Oklahoma; ours is simulated at Kessler, like every price in this
        chapter.
      </P>
      <P>
        A spread that follows stocks can be traded only if stocks are somewhat predictable, and the tanks help. Oil arrives and leaves through pipelines and
        refineries at limited rates, so the hub’s <K tone="orange">fill</K> moves toward wherever the market is pushing it over weeks, not overnight. If the tanks
        have drained for a fortnight, they will probably keep draining next week, and the front month will keep gaining on the second. That suggests a rule. Each
        week, look at how Kessler’s fill has changed over the last {D.lookback} weeks. If it has fallen by more than {fmt(D.threshold)}% of capacity, buy the
        calendar spread: buy a month-1 contract and sell a month-2 contract. If it has risen by more than that, sell the spread. Otherwise, stay out.
      </P>
      <P>
        A <b>unit</b> of the spread is one contract of each month, 1,000 barrels apiece — the size of the real NYMEX WTI
        contract — so every dollar the spread gains earns $1,000 for each unit held long. We trade {UNITS} units. Each contract bought or sold costs{' '}
        {cents(COST_PER_BBL)} a barrel in commission and the bid–ask spread, an illustrative figure. The running total of the weekly gains and losses is the{' '}
        <K c="price">cumulative P&amp;L</K>. Running a rule over past data like this, deciding each week from only what was known that week, is a <b>backtest</b>.
      </P>
      <P>
        Two more numbers describe how a backtest got there. The first rests on the <K tone="violet">standard deviation</K>, which measures how far numbers stray
        from their average: square each week’s distance from the average week, average the squares, and take the square root. The{' '}
        <K tone="violet">Sharpe ratio</K> divides the average weekly P&amp;L by that standard deviation and scales the result to a year, multiplying by √52; at 1,
        the average year’s profit is about as large as a year’s typical swing. The <K tone="violet">maximum drawdown</K> is the largest fall of the cumulative
        P&amp;L from an earlier peak, the worst stretch anyone running the strategy would have lived through. (In <a href={lessonHref('oil/2.2')}>Lesson 2.2</a>
        drawdown was a reservoir’s pressure difference; here it always means a fall in money.)
      </P>
      <P>
        In the next demonstration, the rule trades five simulated years at Kessler. The first chart is the hub’s fill, shaded where the rule holds the spread long or
        short; the second is the spread itself; the third is the cumulative P&amp;L. The first three controls change the physical world; the last two change the rule:
      </P>

      <Figure name="Oil Time-Spread Trader" scenario={s1}>
        <Legend
          items={[
            { label: 'Kessler’s fill', color: ORANGE, kind: 'line' },
            { label: 'Calendar spread', color: GREEN, kind: 'line' },
            { label: 'Cumulative P&L', color: INK, kind: 'line' },
            { label: 'Long the spread', color: LONG_SWATCH },
            { label: 'Short the spread', color: SHORT_SWATCH },
          ]}
        />
        <XYChart
          ariaLabel={`Kessler’s fill over five simulated years, between ${pct(fillLo)} and ${pct(fillHi)} full, shaded where the rule holds the calendar spread long (${longWeeks} weeks) or short (${shortWeeks} weeks).`}
          height={140}
          x={[0, 5]}
          y={[0, 100]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={[0, 50, 100]}
          yFormat={(v) => `${v}%`}
          yLabel="Kessler’s tanks, % full"
          bands={bands}
          series={[{ points: fillPts, color: ORANGE, width: 2 }]}
        />
        <XYChart
          ariaLabel={`WTI month 1 minus month 2 over five simulated years, from ${usd(sMin, 2)} to ${usd(sMax, 2)} a barrel.`}
          height={130}
          x={[0, 5]}
          y={[sy0, sy1]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={niceTicks(sy0, sy1, 3)}
          yFormat={(v) => `$${fmt(v, 1)}`}
          yLabel="Month 1 − month 2, $ per barrel"
          bands={bands}
          refs={[{ axis: 'y', at: 0, color: '#777', dash: '3 3' }]}
          series={[{ points: spreadPts, color: GREEN, width: 2 }]}
        >
          {(sx, sy) => (
            <g>
              <text className="ax" x={sx(0) + 6} y={sy(0) - 5}>
                backwardation ↑
              </text>
              <text className="ax" x={sx(0) + 6} y={sy(0) + 14}>
                contango ↓
              </text>
            </g>
          )}
        </XYChart>
        <XYChart
          ariaLabel={`Cumulative P&L of ${UNITS} units over five simulated years: ${money(stats.total)} at the end, with a maximum drawdown of ${money(stats.maxDrawdown)}.`}
          height={140}
          x={[0, 5]}
          y={[py0, py1]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={niceTicks(py0, py1, 3)}
          yFormat={kusd}
          yLabel="Cumulative P&L"
          series={[{ points: cum, color: INK, width: 2.5, fillTo: 0, fillOpacity: 0.1 }]}
        />
        <Readouts
          items={[
            { label: <K c="price">total P&amp;L</K>, value: money(stats.total), tone: pnlTone(stats.total) },
            { label: <K tone="violet">Sharpe ratio</K>, value: fmt(stats.sharpe, 2), tone: RISK_TONE },
            { label: <K tone="violet">maximum drawdown</K>, value: money(stats.maxDrawdown), tone: RISK_TONE },
            { label: 'trading costs', value: money(res.costs) },
          ]}
        />
        <Slider
          label="Kessler’s storage"
          tone="orange"
          value={st.capacity}
          min={CAPACITY_MIN}
          max={CAPACITY_MAX}
          step={1}
          onChange={(v) => s1.set({ capacity: v })}
          display={`${st.capacity} million bbl`}
        />
        <Slider
          label="Supply outages"
          tone="red"
          value={st.shocks}
          min={0}
          max={2}
          step={0.2}
          onChange={(v) => s1.set({ shocks: Math.round(v * 10) / 10 })}
          display={`${fmt(st.shocks, 1)} a year`}
        />
        <Segmented
          label="Producer group"
          value={st.group}
          onChange={(v) => s1.set({ group: v })}
          options={[
            { value: 'steady', label: 'Group steadies prices' },
            { value: 'free', label: 'Group doesn’t' },
          ]}
        />
        <Slider label="Rule: lookback" value={st.lookback} min={1} max={8} step={1} onChange={(v) => s1.set({ lookback: v })} display={`${st.lookback} week${st.lookback === 1 ? '' : 's'}`} />
        <Slider
          label="Rule: threshold"
          value={st.threshold}
          min={0}
          max={5}
          step={0.5}
          onChange={(v) => s1.set({ threshold: Math.round(v * 10) / 10 })}
          display={`${fmt(st.threshold, 1)}% of capacity`}
        />
        <Caption>
          The rule was long the spread for {longWeeks} weeks and short for {shortWeeks}, and out of the market for {res.positions.length - longWeeks - shortWeeks}.
        </Caption>
      </Figure>

      <P>
        At the start, the rule makes {money(b.total)} in five years, long while the tanks drain and short while they fill. Its Sharpe ratio is {fmt(b.sharpe, 2)} and its maximum drawdown {money(b.maxDrawdown)}. Notice the costs, too: {money(ref.base.costs)}.
        Trading for free, the rule would have made {money(ref.free.stats.total)}; costs take about half its edge. Try the rule’s settings too: on this history, {ref.rules.profitable === ref.rules.count ? 'every lookback and threshold the sliders offer makes money' : `${ref.rules.profitable} of the ${ref.rules.count} settings the sliders offer make money`},
        from {money(ref.rules.min)} to {money(ref.rules.max)}. That looks reassuring, but it is one history; <a href={lessonHref('oil/6.5')}>Lesson 6.5</a> asks
        how much of it another five years would keep.
      </P>

      <H2>What the trade needs</H2>
      <P>
        The rule leans on two physical facts, and the controls let us remove each one. The first is that stocks swing widely and for months at a time. Kessler’s fill
        follows the world’s stocks, whose big swings come from supply outages and the producer group’s response to them (
        <a href={lessonHref('oil/5.1')}>Lesson 5.1</a>, <a href={lessonHref('oil/5.5')}>Lesson 5.5</a>). Set the outages to zero and the hub never runs low: the spread
        stays in contango for all five years, with month 1 always at least {cents(ref.calmMaxSpread)} under month 2. Its moves are too small to pay for trading, and
        the rule loses {money(-ref.calm.stats.total)}. Restore the outages and let the producer group stop steadying prices. Stocks swing further, the hub runs from{' '}
        {pct(ref.looseFillMin)} to {pct(ref.looseFillMax)} full, and the rule makes {money(ref.loose.stats.total)} with a Sharpe ratio of{' '}
        {fmt(ref.loose.stats.sharpe, 2)}.
      </P>
      <P>
        The second fact is that the hub moves slowly. The flows in and out, through pipelines and refineries, set how many barrels a week can move, so the bigger the tanks, the more slowly they fill and empty. In our model, a {HISTORY_DEFAULTS.kesslerCapacity}-million-barrel hub closes
        about a fifth of the gap between its stock and where the market is pushing it each week, so a fall this week foretells more of the same. Shrink the hub to{' '}
        {CAPACITY_MIN} million barrels and the same flows close the gap within a week: the fill jumps to wherever the market is, and its weekly changes are mostly
        noise. The rule flips back and forth, its costs climb to {money(ref.small.costs)}, and it loses {money(-ref.small.stats.total)}; it would have lost{' '}
        {money(-ref.smallFree.stats.total)} even trading for free. Make the hub {CAPACITY_MAX} million barrels and the opposite happens: the trend is steadier than
        ever, but so gradual that the spread hardly moves, and the rule makes only {money(ref.big.stats.total)}.
      </P>

      <Challenge
        id="a"
        question={`Predict first, then check: with the outages, the producer group and the rule at their starting settings, does the calendar rule make money in a ${PREDICT_HUB}-million-barrel hub, which closes about two-thirds of the gap each week? Set Kessler’s storage to ${PREDICT_HUB} million barrels to see.`}
        solved={solvedA}
        status={
          !atStart(st)
            ? `Set the outages back to ${fmt(D.shocks, 1)} a year, the producer group to steadying prices, and the rule to ${D.lookback} weeks and ${fmt(D.threshold)}% of capacity.`
            : `Make your prediction, then set Kessler’s storage to ${PREDICT_HUB} million barrels.`
        }
        success={`Solved: in a ${PREDICT_HUB}-million-barrel hub the rule ${stats.total > 0 ? 'makes' : 'loses'} ${money(Math.abs(stats.total))}. Before costs it makes ${money(stats.total + res.costs)} — the fill’s recent past still says something about its future — but not enough to cover ${money(res.costs)} of trading costs. The rule first pays at ${ref.firstHub} million barrels, where it makes ${money(ref.first.stats.total)}.`}
      />

      <P>
        A caution applies to every backtest in this chapter. Our futures curve reads only this week’s stocks, ignoring where the tanks are heading even when that is
        plain to see. Real traders see it: the U.S. Energy Information Administration publishes Cushing’s stocks every week, and a pattern this simple would be
        partly priced in. A backtest like this shows the mechanism and the physical facts it depends on.
      </P>

      <H2>Earning the contango</H2>
      <P>
        The calendar rule bets on the spread’s direction. Cash and carry, the terminal’s trade in <a href={lessonHref('oil/4.3')}>Lesson 4.3</a>, earns from its
        level: buy crude now, store it, and sell it forward whenever the forward price beats spot by more than the cost of carrying. The theory of storage said this
        should almost never pay, because anyone with tank space would run the trade until the forward premium fell back to{' '}
        <K c="price">full carry</K>. In the next demonstration we can store up to {fmt(CARRY_DEFAULTS.lease / 1e6)} million barrels at Kessler, paying the storage
        fee only for the barrel-months we fill. (A tank leased outright costs its rent full or empty,{' '}
        {usd((CARRY_DEFAULTS.lease * CARRY_DEFAULTS.fee * 12 * HISTORY_DEFAULTS.years) / 1e6)} million over five years for a million barrels at{' '}
        {usd(CARRY_DEFAULTS.fee, 2)} a barrel-month; we ask only when filling one pays.) In any week our tank is empty, if the future a set number of months out
        beats spot by more than that many months of full carry plus {cents(CARRY_DEFAULTS.handling)} a barrel each way for handling, we fill the tank and sell the
        oil forward. The first chart compares the forward premium (future minus spot, positive in contango) with that cost; the second is Kessler’s fill:
      </P>

      <Figure name="Oil Time-Spread Trader · cash and carry" scenario={s2}>
        <Legend
          items={[
            { label: `Future ${monthsLabel} out minus spot`, color: GREEN, kind: 'line' },
            { label: 'Cost of carrying, with handling', color: GRAY, kind: 'line', dashed: true },
            { label: 'Trade locked in', color: GREEN },
          ]}
        />
        <XYChart
          ariaLabel={`Over five simulated years, the future ${monthsLabel} out minus spot against the cost of carrying a barrel that long. The premium beat the cost ${carry.trades} time${carry.trades === 1 ? '' : 's'} when our tank was free.`}
          height={210}
          x={[0, 5]}
          y={[cy0, cy1]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={niceTicks(cy0, cy1, 4)}
          yFormat={(v) => `$${fmt(v, 1)}`}
          yLabel="$ per barrel"
          series={[
            { points: costPts, color: GRAY, width: 1.5, dash: '6 4' },
            { points: premPts, color: GREEN, width: 2 },
          ]}
          markers={tradeMarks}
        />
        <XYChart
          ariaLabel={`Kessler’s fill over five simulated years, at least ${pct(TANK_TOPS)} full in ${tops} weeks.`}
          height={120}
          x={[0, 5]}
          y={[0, 100]}
          xTicks={YEAR_TICKS}
          xFormat={yearTick}
          yTicks={[0, 50, 100]}
          yFormat={(v) => `${v}%`}
          yLabel="Kessler’s tanks, % full"
          refs={[{ axis: 'y', at: TANK_TOPS * 100, color: '#777', dash: '2 3', label: 'tanks effectively full' }]}
          series={[{ points: cFillPts, color: ORANGE, width: 2 }]}
        />
        <Readouts
          items={[
            { label: 'trades', value: String(carry.trades) },
            { label: <K c="price">profit locked in</K>, value: money(carry.profit), tone: carry.profit > 0 ? 'green' : 'ink' },
            { label: 'tank in use', value: pct(carry.utilization) },
            { label: <K tone="orange">weeks ≥ 97% full</K>, value: String(tops), tone: 'orange' },
          ]}
        />
        <Slider
          label="Kessler’s storage"
          tone="orange"
          value={cs.capacity}
          min={CAPACITY_MIN}
          max={CAPACITY_MAX}
          step={1}
          onChange={(v) => s2.set({ capacity: v })}
          display={`${cs.capacity} million bbl`}
        />
        <Slider label="Months held" value={cs.months} min={1} max={5} step={1} onChange={(v) => s2.set({ months: v })} display={monthsLabel} />
        <Slider
          label="Your storage fee"
          tone="green"
          value={cs.fee}
          min={0.2}
          max={0.6}
          step={0.05}
          onChange={(v) => s2.set({ fee: Math.round(v * 100) / 100 })}
          display={`${usd(cs.fee, 2)} per barrel-month`}
        />
      </Figure>

      <P>
        At the start, the trade never fires. The premium for oil {CARRY_STATE_DEFAULTS.months} months out comes closest to the cost in week{' '}
        {ref.carryClosest.week + 1}, when Kessler is {pct(ref.carryClosest.fill)} full, and even then falls {cents(ref.carryClosest.gap)} short. As the theory of
        storage says, the market pays storers to hold oil, but no more than it costs them. Now shrink the hub. At {CAPACITY_MIN} million barrels, Kessler is at least{' '}
        {pct(TANK_TOPS)} full in {ref.topsSmall} weeks of the five years rather than {ref.topsBase}. The tanks top out, the next barrel has nowhere onshore to go, and
        the curve has to pay for storage at sea — the super-contango of Lesson 5.4. Whoever has tank space to fill then collects it: the trade fires{' '}
        {ref.carrySmall.trades} times and locks in {money(ref.carrySmall.profit)}. Holding longer doesn’t help, since each extra month must earn its own carry:
        one-month holds lock in {money(ref.carrySmall1.profit)} here, three-month holds {money(ref.carrySmall3.profit)}.
      </P>
      <P>
        The cost that matters is our own. The curve’s contango is capped by the market’s cost of carry, built in our model on a storage fee of{' '}
        {usd(CARRY_DEFAULTS.fee, 2)} a barrel-month. A terminal that stores more cheaply earns the difference whenever contango nears full carry: lower the fee to{' '}
        {usd(0.3, 2)} and, at the starting hub and a two-month hold, the trade fires {ref.fee30.trades === 1 ? 'once' : `${ref.fee30.trades} times`}, for{' '}
        {money(ref.fee30.profit)}; at {usd(0.2, 2)}, it fires {ref.fee20.trades} times for {money(ref.fee20.profit)}. So storage pays steadily only for
        those whose tanks cost less than the market’s; for everyone else, it pays when the tanks run out.
      </P>

      <Challenge
        id="b"
        question={`With your storage fee at the market’s ${usd(CARRY_DEFAULTS.fee, 2)}, find the largest Kessler hub, to the nearest million barrels, in which the cash-and-carry trade ever pays.`}
        solved={solvedB}
        status={
          cs.fee !== CARRY_DEFAULTS.fee
            ? `Set your storage fee back to ${usd(CARRY_DEFAULTS.fee, 2)} a barrel-month.`
            : `In a ${cs.capacity}-million-barrel hub, holding for ${monthsLabel}, the trade fires ${carry.trades} time${carry.trades === 1 ? '' : 's'}.`
        }
        success={`Solved: ${cs.capacity} million barrels, for a ${monthsLabel} hold${cs.capacity < CAPACITY_MAX ? `; one million barrels more and it fires ${nextTrades === 0 ? 'never' : `${nextTrades} times`}` : ''}. A bigger hub absorbs the same surplus without topping out, so its contango stays within full carry. The storage trade pays when storage itself runs short.`}
      />

      <P>
        The two trades pull in opposite directions. The calendar rule needs a hub big enough that its fill moves slowly; cash and carry needs a hub small enough to
        fill up. In <FigRef to="Oil Time-Spread Trader">the first demonstration</FigRef>, a {CAPACITY_MIN}-million-barrel hub cost the calendar rule{' '}
        {money(-ref.small.stats.total)}; in the second, the same hub earned a storer {money(ref.carrySmall.profit)}. Both results come from one physical fact — how
        much a hub holds compared with the flows through it — and both vanish when that fact changes. The <a href={lessonHref('oil/6.2')}>next lesson</a> moves from
        time to place and quality: Brent against WTI, set by the pipeline out of the basin, and a heavy, sour crude against a light one, set by what a refinery can
        make of each.
      </P>
    </LessonPage>
  );
}
