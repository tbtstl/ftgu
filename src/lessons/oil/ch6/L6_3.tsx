import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, niceDomain, niceTicks, usd, useScenario } from '../../../framework';
import { PRODUCT_DEFAULTS } from '../../../engines/oil/market';
import { RULE_DEFAULTS, SPREADS, backtest, crackRule, type BacktestResult, type CrackRule } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { PRODUCT_COLOR } from '../../../model/oil/refinery';
import { XYChart, type XYBand } from '../shared/charts';

// ---------------------------------------------------------------------------
// The strategy: the 3:2:1 crack against WTI, traded on product stocks and refinery outages.

export type CrackView = 'crack' | 'gasoline' | 'diesel';

export interface CrackState {
  /** Scale on the seasonal swing in product demand (1 = normal). */
  seasonality: number;
  /** Refinery outages a year. */
  outages: number;
  /** The rule: weeks over which stocks are compared, the change that triggers it (million bbl), weeks long after an outage begins. */
  lookback: number;
  threshold: number;
  outageWeeks: number;
  /** Which crack the second demonstration draws. */
  view: CrackView;
}

export const CRACK_STATE_DEFAULTS: CrackState = {
  seasonality: HISTORY_DEFAULTS.seasonality,
  outages: HISTORY_DEFAULTS.refineryOutages,
  lookback: RULE_DEFAULTS.crack.lookback,
  threshold: RULE_DEFAULTS.crack.threshold,
  outageWeeks: RULE_DEFAULTS.crack.outageWeeks,
  view: 'crack',
};

/** Units of the spread the rule holds when it holds a position. */
export const UNITS = 10;
export const SEASON_STEP = 0.1;
const WEEKS_PER_YEAR = 52;

/** The simulated history for a setting of the physical drivers. */
export function historyFor(st: Pick<CrackState, 'seasonality' | 'outages'>): HistoryWeek[] {
  return oilHistory({ seasonality: st.seasonality, refineryOutages: st.outages });
}

export function ruleOf(st: Pick<CrackState, 'lookback' | 'threshold' | 'outageWeeks'>): CrackRule {
  return { lookback: st.lookback, threshold: st.threshold, outageWeeks: st.outageWeeks };
}

/** The rule's backtest at ten units over a setting's history. */
export function runCrack(st: Omit<CrackState, 'view'>): BacktestResult {
  const h = historyFor(st);
  return backtest(h, 'crack', crackRule(h, ruleOf(st)), { units: UNITS });
}

/** The products' side of the 3:2:1 crack: (2 gasoline cracks + 1 diesel crack) / 3 against Brent, $/bbl. */
export function productsCrack(w: HistoryWeek): number {
  return (2 * w.gasolineCrack + w.dieselCrack) / 3;
}

/**
 * The calendar: a smooth annual curve (the mean plus two harmonics of the year) fitted to whole
 * years of a weekly series. Over whole years the harmonics are orthogonal, so each coefficient is a
 * simple projection. Returns the curve's value in every week.
 */
export function calendarFit(xs: number[]): number[] {
  const n = Math.max(WEEKS_PER_YEAR, Math.floor(xs.length / WEEKS_PER_YEAR) * WEEKS_PER_YEAR);
  const part = xs.slice(0, n);
  const mean = part.reduce((a, b) => a + b, 0) / part.length;
  const coef: Array<[number, number, number]> = [];
  for (let k = 1; k <= 2; k++) {
    let a = 0;
    let b = 0;
    part.forEach((x, t) => {
      const ph = (2 * Math.PI * k * t) / WEEKS_PER_YEAR;
      a += (x - mean) * Math.cos(ph);
      b += (x - mean) * Math.sin(ph);
    });
    coef.push([k, (2 * a) / part.length, (2 * b) / part.length]);
  }
  return xs.map((_, t) => coef.reduce((s, [k, a, b]) => s + a * Math.cos((2 * Math.PI * k * t) / WEEKS_PER_YEAR) + b * Math.sin((2 * Math.PI * k * t) / WEEKS_PER_YEAR), mean));
}

export interface PnlSplit {
  /** P&L from the crack's regular annual swing, from the Brent–WTI spread inside it, and from everything else. */
  calendar: number;
  basis: number;
  surprise: number;
  costs: number;
  total: number;
}

/**
 * Splits a crack backtest's P&L. The WTI 3:2:1 crack is (Brent − WTI) plus the products' crack
 * against Brent; the products' part is split into its fitted calendar and the rest (surprise).
 */
export function splitPnl(h: HistoryWeek[], r: BacktestResult): PnlSplit {
  const prod = h.map(productsCrack);
  const cal = calendarFit(prod);
  const bbl = SPREADS.crack.barrels;
  let calendar = 0;
  let basis = 0;
  let surprise = 0;
  r.positions.forEach((pos, t) => {
    if (!pos) return;
    const db = h[t + 1].brent - h[t + 1].wti - (h[t].brent - h[t].wti);
    const dc = cal[t + 1] - cal[t];
    const dp = prod[t + 1] - prod[t];
    basis += pos * db * bbl;
    calendar += pos * dc * bbl;
    surprise += pos * (dp - dc) * bbl;
  });
  return { calendar, basis, surprise, costs: r.costs, total: r.stats.total };
}

export function splitFor(st: Omit<CrackState, 'view'>): PnlSplit {
  return splitPnl(historyFor(st), runCrack(st));
}

const positionsTaken = (st: Omit<CrackState, 'view'>) => runCrack(st).positions.filter((p) => p !== 0).length;
const ruleIsDefault = (st: Pick<CrackState, 'lookback' | 'threshold' | 'outageWeeks'>) =>
  st.lookback === RULE_DEFAULTS.crack.lookback && st.threshold === RULE_DEFAULTS.crack.threshold && st.outageWeeks === RULE_DEFAULTS.crack.outageWeeks;
const stepDown = (s: number) => Math.round((s - SEASON_STEP) * 10) / 10;

/** Challenge a: no outages, the rule at its defaults, and the smallest seasonal swing at which the rule still takes a position. */
export function stillTradesSolved(st: Omit<CrackState, 'view'>): boolean {
  if (st.outages !== 0 || !ruleIsDefault(st)) return false;
  if (positionsTaken(st) === 0) return false;
  return st.seasonality < SEASON_STEP / 2 || positionsTaken({ ...st, seasonality: stepDown(st.seasonality) }) === 0;
}

/** Challenge b: default outages and rule, and the smallest seasonal swing at which the calendar earns the rule more than surprises do. */
export function calendarWinsSolved(st: Omit<CrackState, 'view'>): boolean {
  if (st.outages !== HISTORY_DEFAULTS.refineryOutages || !ruleIsDefault(st)) return false;
  const wins = (s: number) => {
    const x = splitFor({ ...st, seasonality: s });
    return x.calendar > x.surprise;
  };
  return wins(st.seasonality) && (st.seasonality < SEASON_STEP / 2 || !wins(stepDown(st.seasonality)));
}

/** The fastest fall and rise of combined gasoline and distillate stocks over the rule's lookback, million bbl. */
export function fastestMoves(h: HistoryWeek[], lookback: number): { draw: number; build: number } {
  let draw = 0;
  let build = 0;
  for (let t = lookback; t < h.length; t++) {
    const d = h[t].gasolineStock + h[t].distillateStock - (h[t - lookback].gasolineStock + h[t - lookback].distillateStock);
    draw = Math.max(draw, -d);
    build = Math.max(build, d);
  }
  return { draw, build };
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose, all from the model.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INITIAL = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const monthOfWeek = (w: number) => MONTHS[Math.min(11, Math.floor(((w % WEEKS_PER_YEAR) / WEEKS_PER_YEAR) * 12))];

const BASE_STATE: Omit<CrackState, 'view'> = { ...CRACK_STATE_DEFAULTS };
const BASE = runCrack(BASE_STATE);
const BASE_SPLIT = splitFor(BASE_STATE);
const NO_SEASONS = runCrack({ ...BASE_STATE, seasonality: 0 });
const NO_SEASONS_SPLIT = splitFor({ ...BASE_STATE, seasonality: 0 });
const NO_OUTAGES = runCrack({ ...BASE_STATE, outages: 0 });
const BASIS_LOSS = splitFor({ ...BASE_STATE, seasonality: 0, outages: 3 });
const longWeeks = (r: BacktestResult) => r.positions.filter((p) => p > 0).length;
const shortWeeks = (r: BacktestResult) => r.positions.filter((p) => p < 0).length;

/** With the seasons off: the products' crack's average weekly rise during outages, and the crack's weekly standard deviation. */
const OUTAGE_EFFECT = (() => {
  const h = historyFor({ seasonality: 0, outages: HISTORY_DEFAULTS.refineryOutages });
  const on: number[] = [];
  const moves: number[] = [];
  for (let t = 1; t < h.length; t++) {
    if (h[t].refineryOutage > 0) on.push(productsCrack(h[t]) - productsCrack(h[t - 1]));
    moves.push(h[t].crack321 - h[t - 1].crack321);
  }
  const m = moves.reduce((a, b) => a + b, 0) / moves.length;
  return {
    perWeek: on.reduce((a, b) => a + b, 0) / Math.max(1, on.length),
    sd: Math.sqrt(moves.reduce((a, b) => a + (b - m) ** 2, 0) / (moves.length - 1)),
  };
})();

/** The calendar of one series over a year: its lowest and highest weeks. */
function calendarRange(xs: number[]): { lo: number; hi: number; loWeek: number; hiWeek: number; resid: number } {
  const fit = calendarFit(xs).slice(0, WEEKS_PER_YEAR);
  const lo = Math.min(...fit);
  const hi = Math.max(...fit);
  const all = calendarFit(xs);
  const res = xs.map((x, t) => x - all[t]);
  return { lo, hi, loWeek: fit.indexOf(lo), hiWeek: fit.indexOf(hi), resid: Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length) };
}
const BASE_H = historyFor(BASE_STATE);
const CAL_GAS = calendarRange(BASE_H.map((w) => w.gasolineCrack));
const CAL_DSL = calendarRange(BASE_H.map((w) => w.dieselCrack));
const CAL_321 = calendarRange(BASE_H.map(productsCrack));

// ---------------------------------------------------------------------------

const money = (x: number) => usd(Math.round(x / 1000) * 1000);
const cents = (x: number) => `${fmt(x * 100)} cents`;
const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));
const YEAR_TICKS = [26, 78, 130, 182, 234];
const yearLabel = (v: number) => `year ${Math.round((v - 26) / 52) + 1}`;
const LONG_FILL = 'rgba(109, 156, 55, .22)';
const SHORT_FILL = 'rgba(231, 91, 85, .2)';
const OUTAGE_FILL = 'rgba(0, 0, 0, .09)';
const STOCK_COLOR = GRAPHIC.orange;
const CRACK_COLOR = GRAPHIC.green;
const NORMAL_STOCKS = PRODUCT_DEFAULTS.normalGasoline + PRODUCT_DEFAULTS.normalDistillate;

/** Contiguous runs of nonzero values with the same sign. */
function runsOf(values: number[]): Array<{ from: number; to: number; sign: number }> {
  const out: Array<{ from: number; to: number; sign: number }> = [];
  let i = 0;
  while (i < values.length) {
    const s = Math.sign(values[i]);
    if (s === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < values.length && Math.sign(values[j]) === s) j++;
    out.push({ from: i, to: j, sign: s });
    i = j;
  }
  return out;
}

const VIEW_LABEL: Record<CrackView, string> = { crack: '3:2:1 products', gasoline: 'gasoline', diesel: 'diesel' };
const VIEW_COLOR: Record<CrackView, string> = { crack: CRACK_COLOR, gasoline: PRODUCT_COLOR.gasoline, diesel: PRODUCT_COLOR.diesel };

export default function Lesson() {
  const s = useScenario<CrackState>('crack-trader', CRACK_STATE_DEFAULTS);
  const st = s.state;
  const { seasonality, outages, lookback, threshold, outageWeeks, view } = st;

  const h = useMemo(() => historyFor({ seasonality, outages }), [seasonality, outages]);
  const r = useMemo(() => backtest(h, 'crack', crackRule(h, { lookback, threshold, outageWeeks }), { units: UNITS }), [h, lookback, threshold, outageWeeks]);
  const split = useMemo(() => splitPnl(h, r), [h, r]);
  const solvedA = useMemo(() => stillTradesSolved({ seasonality, outages, lookback, threshold, outageWeeks }), [seasonality, outages, lookback, threshold, outageWeeks]);
  const solvedB = useMemo(() => calendarWinsSolved({ seasonality, outages, lookback, threshold, outageWeeks }), [seasonality, outages, lookback, threshold, outageWeeks]);
  const moves = useMemo(() => fastestMoves(h, lookback), [h, lookback]);
  const below = useMemo(
    () => (seasonality >= SEASON_STEP / 2 ? fastestMoves(historyFor({ seasonality: stepDown(seasonality), outages }), lookback) : null),
    [seasonality, outages, lookback],
  );

  // Figure 1's series.
  const stocks = h.map((w, t) => [t, w.gasolineStock + w.distillateStock] as [number, number]);
  const crack = h.map((w, t) => [t, w.crack321] as [number, number]);
  const equity: Array<[number, number]> = [[0, 0]];
  r.pnl.reduce((acc, v, t) => {
    const next = acc + v;
    equity.push([t + 1, next]);
    return next;
  }, 0);
  const stockDomain = niceDomain(Math.min(NORMAL_STOCKS, ...stocks.map((p) => p[1])), Math.max(NORMAL_STOCKS, ...stocks.map((p) => p[1])), 3);
  const crackDomain = niceDomain(Math.min(...crack.map((p) => p[1])), Math.max(...crack.map((p) => p[1])), 3);
  const eqDomain = niceDomain(Math.min(0, ...equity.map((p) => p[1])), Math.max(1000, ...equity.map((p) => p[1])), 3);
  const positionBands: XYBand[] = runsOf(r.positions).map((run) => ({ from: run.from, to: run.to, color: run.sign > 0 ? LONG_FILL : SHORT_FILL }));
  const outageBands: XYBand[] = runsOf(h.map((w) => (w.refineryOutage > 0 ? 1 : 0))).map((run) => ({ from: run.from, to: run.to, color: OUTAGE_FILL }));
  const outageCount = h.filter((w, t) => t > 0 && w.refineryOutage > 0 && h[t - 1].refineryOutage === 0).length + (h[0].refineryOutage > 0 ? 1 : 0);
  const long = longWeeks(r);
  const short = shortWeeks(r);
  const st0 = r.stats;

  // Figure 2's series: each year's crack by week of the year, and the calendar.
  const series = h.map((w) => (view === 'crack' ? productsCrack(w) : view === 'gasoline' ? w.gasolineCrack : w.dieselCrack));
  const fit = calendarFit(series);
  const years = Math.floor(h.length / WEEKS_PER_YEAR);
  const yearLines = Array.from({ length: years }, (_, y) => ({
    points: series.slice(y * WEEKS_PER_YEAR, (y + 1) * WEEKS_PER_YEAR).map((v, i) => [i + 0.5, v] as [number, number]),
    color: '#b5b5b5',
    width: 1.25,
  }));
  const calYear = fit.slice(0, WEEKS_PER_YEAR);
  const calLo = Math.min(...calYear);
  const calHi = Math.max(...calYear);
  const calDomain = niceDomain(Math.min(0, ...series), Math.max(...series), 4);
  const monthTicks = Array.from({ length: 12 }, (_, m) => ((m + 0.5) * WEEKS_PER_YEAR) / 12);

  const ruleStatus = !ruleIsDefault(st) ? `Return the rule to a ${RULE_DEFAULTS.crack.lookback}-week lookback, a ${RULE_DEFAULTS.crack.threshold} million barrel change and ${RULE_DEFAULTS.crack.outageWeeks} weeks after an outage.` : null;

  return (
    <LessonPage id="oil/6.3">
      <P>
        <a href={lessonHref('oil/6.2')}>Lesson 6.2</a> traded the gaps between crudes: between an inland barrel and a coastal one, and between a heavy, sour barrel
        and a light, sweet one. This lesson trades the gap at the heart of the business, between crude and the products made from it. A refinery’s margin, as{' '}
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> found, is what its products sell for less what its crude costs. <a href={lessonHref('oil/5.3')}>Lesson 5.3</a>{' '}
        called each product’s part of that gap its <K c="price">crack spread</K>, and found that product stocks set it.
      </P>
      <P>
        Traders follow refining margins with a standard yardstick, the <K c="price">3:2:1 crack spread</K>: three barrels of crude in, two barrels of gasoline and
        one of distillate out. It’s the value of the two gasoline barrels and the distillate barrel, less the three crude barrels, divided by three — a real industry
        measure, and one a trader can hold with futures: short three crude contracts, long two gasoline contracts and one diesel contract, each for 1,000 barrels.
        We price ours against the WTI-like Kessler benchmark. One unit of the spread holds {fmt(SPREADS.crack.barrels)} barrels of crude against the products, so
        each $1 the crack moves is worth {usd(SPREADS.crack.barrels)} a unit. As everywhere in this course, the prices are simulated.
      </P>
      <P>
        Why should the crack be predictable at all? Lesson 5.3 gave the reason: a product’s crack rises as its <K tone="orange">stocks</K> fall below normal. Stocks
        fall when demand runs ahead of refinery output — in the driving season for gasoline, in winter for distillate — and when refineries break down, as in{' '}
        <a href={lessonHref('oil/5.5')}>Lesson 5.5</a>. So our rule watches the world’s combined gasoline and distillate stocks. Each week, if they have fallen by
        more than {RULE_DEFAULTS.crack.threshold} million barrels over the last {RULE_DEFAULTS.crack.lookback} weeks, it goes long {UNITS} units of the crack,
        expecting it to keep rising; if they have built by as much, it goes short. For {RULE_DEFAULTS.crack.outageWeeks} weeks after a refinery outage begins, it
        goes long whatever the stocks say. It decides from each week’s data and earns the next week’s change in the crack, less a cost on every contract it trades.
      </P>
      <P>
        In the next demonstration, the rule trades five years of simulated history. The first two sliders are the physical drivers: how strongly product demand
        swings with the seasons, and how often refineries fail. The other three set the rule. Change any of them and watch the profit and loss:
      </P>

      <Figure name="Refining Spread Trader" scenario={s}>
        <Legend
          items={[
            { label: 'Gasoline + distillate stocks', color: STOCK_COLOR, kind: 'line' },
            { label: 'Refinery outage', color: 'rgba(0, 0, 0, .18)' },
            { label: '3:2:1 crack against WTI', color: CRACK_COLOR, kind: 'line' },
            { label: 'Long the crack', color: 'rgba(109, 156, 55, .45)' },
            { label: 'Short the crack', color: 'rgba(231, 91, 85, .4)' },
          ]}
        />
        <XYChart
          ariaLabel={`World gasoline and distillate stocks over five simulated years, between ${fmt(Math.min(...stocks.map((p) => p[1])))} and ${fmt(Math.max(...stocks.map((p) => p[1])))} million barrels against a normal ${fmt(NORMAL_STOCKS)}, with ${outageCount} refinery outages shaded.`}
          height={150}
          x={[0, h.length]}
          y={stockDomain}
          xTicks={YEAR_TICKS}
          xFormat={yearLabel}
          yTicks={niceTicks(stockDomain[0], stockDomain[1], 3)}
          yFormat={(v) => fmt(v)}
          yLabel="Product stocks, million barrels"
          bands={outageBands}
          refs={[{ axis: 'y', at: NORMAL_STOCKS, color: STOCK_COLOR, dash: '5 4', label: 'normal' }]}
          series={[{ points: stocks, color: STOCK_COLOR, width: 2 }]}
        />
        <XYChart
          ariaLabel={`The 3:2:1 crack against WTI, between ${usd(crackDomain[0])} and ${usd(crackDomain[1])} a barrel, with the rule long for ${long} weeks and short for ${short}.`}
          height={150}
          x={[0, h.length]}
          y={crackDomain}
          xTicks={YEAR_TICKS}
          xFormat={yearLabel}
          yTicks={niceTicks(crackDomain[0], crackDomain[1], 3)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="3:2:1 crack against WTI, $ per barrel (simulated)"
          bands={positionBands}
          series={[{ points: crack, color: CRACK_COLOR, width: 1.75 }]}
        />
        <XYChart
          ariaLabel={`Cumulative profit of ${UNITS} units over five years: ${money(st0.total)} after ${money(r.costs)} of trading costs; maximum drawdown ${money(st0.maxDrawdown)}.`}
          height={150}
          x={[0, h.length]}
          y={eqDomain}
          xTicks={YEAR_TICKS}
          xFormat={yearLabel}
          yTicks={niceTicks(eqDomain[0], eqDomain[1], 3)}
          yFormat={(v) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`)}
          yLabel={`Cumulative P&L, ${UNITS} units`}
          series={[{ points: equity, color: '#333', width: 2.25, fillTo: 0, fillOpacity: 0.08 }]}
        />
        <Readouts
          items={[
            { label: <K c="price">total P&amp;L</K>, value: money(st0.total), tone: tone(st0.total) },
            { label: 'Sharpe ratio', value: fmt(st0.sharpe, 2) },
            { label: <K tone="violet">maximum drawdown</K>, value: money(st0.maxDrawdown), tone: st0.maxDrawdown > 0 ? 'red' : 'ink' },
            { label: 'trading costs', value: money(r.costs) },
          ]}
        />
        <Slider
          label="Seasons: demand swing"
          tone="red"
          value={seasonality}
          min={0}
          max={2}
          step={SEASON_STEP}
          onChange={(v) => s.set({ seasonality: Math.round(v * 10) / 10 })}
          display={seasonality === 1 ? '×1.0 (normal)' : `×${fmt(seasonality, 1)}`}
        />
        <Slider
          label="Refinery outages"
          tone="orange"
          value={outages}
          min={0}
          max={6}
          step={0.5}
          onChange={(v) => s.set({ outages: v })}
          display={`${fmt(outages, 1)} a year · ${outageCount} in five years`}
        />
        <Slider label="Rule: lookback" value={lookback} min={1} max={8} onChange={(v) => s.set({ lookback: v })} display={`${lookback} week${lookback === 1 ? '' : 's'}`} />
        <Slider
          label="Rule: stock change"
          tone="orange"
          value={threshold}
          min={0}
          max={40}
          onChange={(v) => s.set({ threshold: v })}
          display={`${threshold} million bbl`}
        />
        <Slider
          label="Rule: after an outage"
          value={outageWeeks}
          min={0}
          max={8}
          onChange={(v) => s.set({ outageWeeks: v })}
          display={outageWeeks === 0 ? 'ignore outages' : `long ${outageWeeks} week${outageWeeks === 1 ? '' : 's'}`}
        />
        <Caption>
          Long for {long} weeks and short for {short}; out of the market for {r.positions.length - long - short}. In any {lookback}-week stretch, stocks fell by
          at most {fmt(moves.draw, 1)} million barrels and rose by at most {fmt(moves.build, 1)}.
        </Caption>
      </Figure>

      <P>
        With the drivers at their defaults, the rule earns {money(BASE.stats.total)} over five years, with a <K tone="violet">Sharpe ratio</K> — average weekly profit over
        its standard deviation, scaled to a year — of {fmt(BASE.stats.sharpe, 2)} and a maximum drawdown of {money(BASE.stats.maxDrawdown)}. It is long the crack for {longWeeks(BASE)} weeks and short for{' '}
        {shortWeeks(BASE)}. Look at where the shading falls: the long positions bunch in July and August, when summer driving draws gasoline down, and the short ones
        between November and January, when stocks rebuild.
      </P>
      <P>
        Now take the physics away. Set the seasonal swing to zero, and the rule earns {money(NO_SEASONS.stats.total)}, with a Sharpe ratio of{' '}
        {fmt(NO_SEASONS.stats.sharpe, 2)}; it never goes short. Set refinery outages to zero as well, and it doesn’t trade at all:
        without seasons or outages, product stocks never move {RULE_DEFAULTS.crack.threshold} million barrels in{' '}
        {RULE_DEFAULTS.crack.lookback} weeks. The rule doesn’t find opportunities; it reads the ones the physical drivers create.
      </P>
      <P>
        The outages matter less than you might expect. Return the seasons to normal and remove the outages, and the rule earns {money(NO_OUTAGES.stats.total)},
        a little more than with them. An outage in our history takes 0.5 to 1.5 million barrels a day of the world’s refinery runs for two to eight weeks. With the
        seasons switched off, the products’ side of the crack rose by an average of {cents(OUTAGE_EFFECT.perWeek)} a week while an outage lasted — but the crack as a
        whole moves by about {usd(OUTAGE_EFFECT.sd, 2)} from one week to the next (one standard deviation). The signal is real, but small beside the noise.
      </P>

      <Challenge
        id="a"
        question="Switch refinery outages off and keep the rule at its starting settings. What’s the smallest seasonal swing at which the rule still takes a position?"
        solved={solvedA}
        status={
          outages !== 0
            ? 'Set refinery outages to zero.'
            : (ruleStatus ??
              (long + short === 0
                ? `At ×${fmt(seasonality, 1)} the rule never trades: stocks fall by at most ${fmt(moves.draw, 1)} and rise by at most ${fmt(moves.build, 1)} million barrels in ${lookback} weeks.`
                : `At ×${fmt(seasonality, 1)} the rule trades for ${long + short} weeks. Could the seasons be weaker still?`))
        }
        success={`Solved: ×${fmt(seasonality, 1)}. Here stocks rise by up to ${fmt(moves.build, 1)} million barrels in ${lookback} weeks and fall by up to ${fmt(moves.draw, 1)}${
          below ? `; one step weaker, the most they move is ${fmt(Math.max(below.draw, below.build), 1)} million, short of the ${threshold} million the rule needs` : ''
        }. The opportunity exists only when the physical swing is bigger than the rule’s threshold — and with no outages, the seasons are the only thing that moves stocks.`}
      />

      <H2>Whose profit is it?</H2>
      <P>
        The rule made money, but it’s worth asking what it was paid for. Each week’s change in the crack can be split into three parts. Because we price the crack
        against WTI, part of every move is the Brent–WTI spread of Lesson 6.2: the 3:2:1 crack against WTI is the products’ crack against Brent plus that spread.
        Of the products’ part, some follows the <K tone="red">calendar</K> — the same rise and fall every year — and the rest is <K tone="violet">surprise</K>. We
        estimate the calendar by fitting a smooth annual curve to all five years, a stand-in for what a market that has watched many years expects. In the next
        demonstration, each thin line is one year’s crack, drawn by week of the year; the thick line is the calendar; and the readouts split the rule’s P&amp;L from{' '}
        <FigRef to="Refining Spread Trader">the first demonstration</FigRef> the same way:
      </P>

      <Figure name="Refining Spread Trader · the calendar" scenario={s}>
        <Segmented
          label="Crack"
          value={view}
          onChange={(v) => s.set({ view: v })}
          options={[
            { value: 'crack', label: '3:2:1 products' },
            { value: 'gasoline', label: 'Gasoline' },
            { value: 'diesel', label: 'Diesel' },
          ]}
        />
        <Legend
          items={[
            { label: 'Each simulated year', color: '#b5b5b5', kind: 'line' },
            { label: `The calendar, ${VIEW_LABEL[view]} crack`, color: VIEW_COLOR[view], kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`The ${VIEW_LABEL[view]} crack against Brent by week of the year for each of ${years} simulated years, with its calendar running from ${usd(calLo, 2)} in ${monthOfWeek(calYear.indexOf(calLo))} to ${usd(calHi, 2)} in ${monthOfWeek(calYear.indexOf(calHi))}.`}
          height={230}
          x={[0, WEEKS_PER_YEAR]}
          y={calDomain}
          xTicks={monthTicks}
          xFormat={(v) => INITIAL[Math.min(11, Math.floor((v / WEEKS_PER_YEAR) * 12))]}
          yTicks={niceTicks(calDomain[0], calDomain[1], 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Crack against Brent, $ per barrel (simulated)"
          series={[...yearLines, { points: calYear.map((v, i) => [i + 0.5, v] as [number, number]), color: VIEW_COLOR[view], width: 3.5 }]}
        />
        <Readouts
          items={[
            { label: <K tone="red">from the calendar</K>, value: money(split.calendar), tone: tone(split.calendar) },
            { label: <K tone="violet">from surprises</K>, value: money(split.surprise), tone: tone(split.surprise) },
            { label: 'from Brent–WTI', value: money(split.basis), tone: tone(split.basis) },
            { label: 'trading costs', value: money(-split.costs), tone: split.costs > 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider
          label="Seasons: demand swing"
          tone="red"
          value={seasonality}
          min={0}
          max={2}
          step={SEASON_STEP}
          onChange={(v) => s.set({ seasonality: Math.round(v * 10) / 10 })}
          display={seasonality === 1 ? '×1.0 (normal)' : `×${fmt(seasonality, 1)}`}
        />
        <Caption>
          The four parts add up to the rule’s {money(split.total)}. The {VIEW_LABEL[view]} calendar swings by {usd(calHi - calLo, 2)} a barrel, from{' '}
          {monthOfWeek(calYear.indexOf(calLo))} to {monthOfWeek(calYear.indexOf(calHi))}.
        </Caption>
      </Figure>

      <P>
        Every year draws the same shape. Gasoline’s crack follows its stocks: its calendar is lowest in {monthOfWeek(CAL_GAS.loWeek)}, at {usd(CAL_GAS.lo, 2)}, and
        highest in {monthOfWeek(CAL_GAS.hiWeek)}, at {usd(CAL_GAS.hi, 2)}. Diesel’s runs the other way, highest in {monthOfWeek(CAL_DSL.hiWeek)} at{' '}
        {usd(CAL_DSL.hi, 2)} and lowest in {monthOfWeek(CAL_DSL.loWeek)} at {usd(CAL_DSL.lo, 2)}. The 3:2:1 is two-thirds gasoline, so it follows gasoline, from{' '}
        {usd(CAL_321.lo, 2)} in {monthOfWeek(CAL_321.loWeek)} to {usd(CAL_321.hi, 2)} in {monthOfWeek(CAL_321.hiWeek)}, and the years scatter around its calendar by
        only {usd(CAL_321.resid, 2)} (one standard deviation). At the default settings, {money(BASE_SPLIT.calendar)} of the rule’s {money(BASE_SPLIT.total)} came from
        the calendar, {money(BASE_SPLIT.basis)} from the Brent–WTI spread, and just {money(BASE_SPLIT.surprise)} from surprises, less {money(BASE_SPLIT.costs)} in
        costs.
      </P>
      <P>
        That split matters, because a real market wouldn’t pay for most of it. The calendar is about as predictable as anything in the oil business, and futures prices
        already carry it: gasoline futures for summer delivery usually trade above those for winter delivery. A trader who buys the crack for August delivery in March
        pays for August’s expected tightness up front, and profits only if August turns out tighter than expected. Our history has futures for crude but none for
        products, and the backtest earns each week’s change in the spot crack, as though no one had seen summer coming. A fair estimate of what this rule would earn
        in a real market leaves the calendar out.
      </P>

      <Challenge
        id="b"
        figure="Refining Spread Trader · the calendar"
        question="Keep refinery outages at 1.5 a year and the rule at its starting settings. What’s the smallest seasonal swing at which the calendar earns the rule more than surprises do?"
        solved={solvedB}
        status={
          outages !== HISTORY_DEFAULTS.refineryOutages
            ? 'Set refinery outages back to 1.5 a year.'
            : (ruleStatus ?? `At ×${fmt(seasonality, 1)}, the calendar earns ${money(split.calendar)} and surprises ${money(split.surprise)}.`)
        }
        success={`Solved: ×${fmt(seasonality, 1)}, where the calendar earns ${money(split.calendar)} against ${money(split.surprise)} from surprises. At every stronger swing the calendar stays ahead, and by more and more, because the rule’s positions line up with the seasons. Even a fairly mild seasonal cycle, once it is large enough to trigger the rule, is most of what the rule is paid for.`}
      />

      <H2>What’s left</H2>
      <P>
        Leave the calendar out and two parts remain. The {money(BASE_SPLIT.basis)} from the Brent–WTI spread is a passenger: the rule never looked at the inland
        discount, and its positions simply happened to line up with the spread’s moves. They can as easily line up against them. With the seasons off and three outages a year, the same rule loses{' '}
        {money(-BASIS_LOSS.basis)} on the spread. A crack priced against WTI is also a bet on WTI’s discount to the coast, which matters to anyone who uses the crack
        to stand in for a particular refinery’s margin.
      </P>
      <P>
        The surprises are the rule’s real edge: stock draws nobody scheduled, caught a week or two after they began. At the default settings they were worth{' '}
        {money(BASE_SPLIT.surprise)}; with the seasons switched off, where they are almost all the rule trades on, they were worth{' '}
        {money(NO_SEASONS_SPLIT.surprise)}. Surprises are what crack traders actually compete on — learning of a refinery fire or an unexpected draw in stocks
        before the price has moved — which is why weekly inventory reports and news of refinery outages move these markets so quickly.
      </P>
      <P>
        A speculator chooses whether to hold the crack. A refinery holds it whether it likes it or not: every barrel the Calder refinery runs earns the gap between its
        products and its crude, so its margin rises and falls with the same seasons and surprises this rule tried to catch. In{' '}
        <a href={lessonHref('oil/6.4')}>Lesson 6.4</a> the refinery stops trying to forecast the crack and sells it forward instead, to lock in a margin — and finds
        that how well that works depends on how closely the crack it sells matches the barrels it makes.
      </P>
    </LessonPage>
  );
}
