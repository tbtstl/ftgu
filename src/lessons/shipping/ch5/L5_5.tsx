import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { backtest, bunkerHedge, STRATEGY_NAMES, type StrategyId, type Trade } from '../../../engines/shipping/backtest';
import type { CycleMonth } from '../../../engines/shipping/cycle';
import { DEFAULT_ASSUMPTIONS } from '../../../engines/shipping/forecast';
import { dailyIndex, longRun } from '../../../engines/shipping/ffa';
import { monthAverage } from '../../../engines/shipping/indices';
import { equityCurve, mean, stdev, summarize, type PnlSummary } from '../../../engines/strategy/risk';
import { HISTORY_MONTHS, historyWith, standardHistory, type HistoryOverrides } from '../../../model/shipping/history';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The lab: rules traded one month ahead on the Kamsarmax index, on our history or another one.

export interface World {
  id: string;
  label: string;
  /** Two short lines for the bar chart. */
  short: [string, string];
  group: 'ours' | 'draw' | 'physics';
  overrides?: HistoryOverrides;
}

export const WORLDS: World[] = [
  { id: 'ours', label: 'Our history', short: ['Our', 'history'], group: 'ours' },
  ...Array.from({ length: 10 }, (_, i): World => ({ id: `draw${i + 1}`, label: `Another draw of luck, number ${i + 1}`, short: [String(i + 1), ''], group: 'draw', overrides: { seed: i + 1 } })),
  { id: 'noseason', label: 'No harvest season', short: ['No', 'season'], group: 'physics', overrides: { seasonal: false } },
  { id: 'lag12', label: 'Ships built in a year', short: ['1-year', 'yards'], group: 'physics', overrides: { lag: 12 } },
  { id: 'steady', label: 'Steadier cargo demand', short: ['Steady', 'demand'], group: 'physics', overrides: { shock: 0.03 } },
];

const STD = standardHistory();
const WORLD_CACHE = new Map<string, { hist: CycleMonth[]; index: number[]; bunker: number[] }>();

/** A world's Kamsarmax history and daily index (memoized). */
export function worldData(id: string): { hist: CycleMonth[]; index: number[]; bunker: number[] } {
  const hit = WORLD_CACHE.get(id);
  if (hit) return hit;
  const w = WORLDS.find((x) => x.id === id)!;
  const h = w.overrides ? historyWith(w.overrides) : STD;
  const data = { hist: h.cls.kmax, index: w.overrides ? dailyIndex('kmax', undefined, h.cls.kmax) : dailyIndex('kmax'), bunker: h.bunker };
  WORLD_CACHE.set(id, data);
  return data;
}

const TRADE_CACHE = new Map<string, Trade[]>();

/** A rule's trades in a world, sized at one day and with no costs (memoized); totals scale from them. */
export function baseTrades(world: string, strategy: StrategyId, threshold: number): Trade[] {
  const key = `${world}|${strategy}|${strategy === 'reversion' || strategy === 'fundamental' ? threshold : 0}`;
  const hit = TRADE_CACHE.get(key);
  if (hit) return hit;
  const d = worldData(world);
  const t = backtest({ strategy, cls: 'kmax', days: 1, cost: 0, threshold, from: 1, to: HISTORY_MONTHS - 1 }, d.index, d.hist).trades;
  TRADE_CACHE.set(key, t);
  return t;
}

export interface LabState {
  strategy: StrategyId;
  /** Days of FFA a month. */
  days: number;
  /** Costs as a share of the contract's value, in percent. */
  cost: number;
  /** Threshold in percent. */
  threshold: number;
  /** Last year of the in-sample period. */
  split: number;
  bunker: boolean;
}

export const DEFAULT_LAB: LabState = { strategy: 'seasonal', days: 30, cost: 0.25, threshold: 10, split: 6, bunker: false };

/** Monthly P&L of a trade at a size and cost, $. */
function tradePnl(t: Trade, days: number, cost: number): number {
  if (!t.side) return 0;
  return ((t.side === 'buy' ? 1 : -1) * (t.settlement - t.price) - cost * t.price) * days;
}

export interface LabRun {
  months: number[];
  pnl: number[];
  trades: Trade[];
  all: PnlSummary;
  first: PnlSummary;
  second: PnlSummary;
  hitRate: number;
  traded: number;
  fees: number;
}

/** A rule's results in a world for a state, split at the end of year `split`. */
export function labRun(s: LabState, world = 'ours', split = s.split): LabRun {
  const trades = baseTrades(world, s.strategy, s.threshold / 100);
  const cost = s.cost / 100;
  const pnl = trades.map((t) => tradePnl(t, s.days, cost));
  const months = trades.map((t) => t.month);
  const made = trades.filter((t) => t.side);
  return {
    months,
    pnl,
    trades,
    all: summarize(pnl, 12),
    first: summarize(pnl.filter((_, i) => months[i] < split * 12), 12),
    second: summarize(pnl.filter((_, i) => months[i] >= split * 12), 12),
    hitRate: made.length ? made.filter((t) => tradePnl(t, s.days, cost) > 0).length / made.length : 0,
    traded: made.length,
    fees: made.reduce((a, t) => a + cost * t.price * s.days, 0),
  };
}

/** The challenge: mean reversion that makes money in both Years 1–6 and Years 7–12. */
export function halvesSolved(s: LabState): boolean {
  if (s.strategy !== 'reversion') return false;
  const r = labRun(s, 'ours', 6);
  return r.first.total > 0 && r.second.total > 0;
}

/** Every whole-percent threshold (0–60%) at which mean reversion passes both halves, at a cost. */
export function passingThresholds(costPct: number): number[] {
  const out: number[] = [];
  for (let th = 0; th <= 60; th++) if (halvesSolved({ ...DEFAULT_LAB, strategy: 'reversion', threshold: th, cost: costPct })) out.push(th);
  return out;
}

/** The fundamentals rule at the starting settings with the orderbook's deliveries left out of its forecast. */
export function fundamentalsWithoutDeliveries() {
  const d = worldData('ours');
  const r = backtest(
    {
      strategy: 'fundamental',
      cls: 'kmax',
      days: DEFAULT_LAB.days,
      cost: DEFAULT_LAB.cost / 100,
      threshold: DEFAULT_LAB.threshold / 100,
      from: 1,
      to: HISTORY_MONTHS - 1,
      forecast: { ...DEFAULT_ASSUMPTIONS, deliveries: false },
    },
    d.index,
    d.hist,
  );
  return { total: r.summary.total, traded: r.trades.filter((t) => t.side).length };
}

/** A rule's total in every world, $. */
export function worldTotals(s: LabState): number[] {
  return WORLDS.map((w) => labRun(s, w.id).all.total);
}

// Numbers for the prose, at the starting settings.
const AT = (strategy: StrategyId, extra: Partial<LabState> = {}) => labRun({ ...DEFAULT_LAB, strategy, ...extra });
const BUNKER_PNL = bunkerHedge(STD.bunker, 700, 1, HISTORY_MONTHS - 1);
const BUNKER = summarize(BUNKER_PNL, 12);
const INDEX = dailyIndex('kmax');
const INDEX_AVG = mean(Array.from({ length: HISTORY_MONTHS }, (_, m) => monthAverage(INDEX, m)));
const ANCHOR_AVG = mean(Array.from({ length: HISTORY_MONTHS }, (_, m) => longRun('kmax', m % 12)));

const $m = (x: number, d = 2) => `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, d)}m`;
const $k = (x: number) => `${x < 0 ? '−' : ''}$${fmt(Math.abs(x))}`;

const STRATEGIES: StrategyId[] = ['seasonal', 'momentum', 'reversion', 'fundamental', 'hedge'];

const RULE_TEXT: Record<StrategyId, string> = {
  seasonal: 'Buys next month’s contract when it falls in March to June, while Brazil’s soybeans ship, and sells it for September to November.',
  momentum: 'Buys next month if this month’s average beat last month’s, and sells it if it didn’t.',
  reversion: 'Sells next month when the index stands more than the threshold above its usual level for the time of year, and buys when it stands as far below.',
  fundamental: 'Forecasts next month from the fleet, the orderbook and the cargo, as in Lesson 5.1, and buys when the forecast beats the forward price by the threshold, sells when it falls short.',
  hedge: 'Always sells next month: what an owner trading a ship on the spot market does to fix next month’s earnings a month ahead.',
};

export default function Lesson() {
  const lab = useScenario('lab', DEFAULT_LAB);
  const s = lab.state;
  const run = useMemo(() => labRun(s), [s]);
  const usesThreshold = s.strategy === 'reversion' || s.strategy === 'fundamental';
  const solved = halvesSolved(s);
  const halves = useMemo(() => labRun(s, 'ours', 6), [s]);
  const passing = useMemo(() => (solved ? passingThresholds(s.cost) : []), [solved, s.cost]);

  // Equity and drawdown.
  const equity = equityCurve(run.pnl);
  const xs = run.months.map((m) => m / 12);
  let peak = 0;
  const drawdown = equity.map((e) => {
    peak = Math.max(peak, e);
    return e - peak;
  });
  const bunkerEq = equityCurve(BUNKER_PNL);
  const [eLo, eHi] = niceDomain(Math.min(0, ...equity, ...(s.bunker ? bunkerEq : [])), Math.max(0, ...equity, ...(s.bunker ? bunkerEq : [])), 4);
  const ddLo = Math.min(-1, ...drawdown);

  // Prose numbers, computed once at the starting settings.
  const N = useMemo(
    () => ({
      seasonal: AT('seasonal'),
      momentum: AT('momentum'),
      reversion: AT('reversion'),
      fundamental: AT('fundamental'),
      hedge: AT('hedge'),
      seasonalWorlds: worldTotals({ ...DEFAULT_LAB, strategy: 'seasonal' }),
      momentumWorlds: worldTotals({ ...DEFAULT_LAB, strategy: 'momentum' }),
      reversionWorlds: worldTotals({ ...DEFAULT_LAB, strategy: 'reversion' }),
      fundamentalWorlds: worldTotals({ ...DEFAULT_LAB, strategy: 'fundamental' }),
      wide45: worldTotals({ ...DEFAULT_LAB, strategy: 'reversion', threshold: 45 }),
      wide50: worldTotals({ ...DEFAULT_LAB, strategy: 'reversion', threshold: 50 }),
      noDeliveries: fundamentalsWithoutDeliveries(),
    }),
    [],
  );

  // The owner's hedge, against a ship earning the index for 30 days a month.
  const hedgeRun = N.hedge;
  const physical = hedgeRun.trades.map((t) => t.settlement * 30);
  const surprise = hedgeRun.trades.map((t) => (t.settlement - t.price) * 30);
  const hedged = physical.map((x, i) => x + hedgeRun.pnl[i]);

  // Other worlds, computed from a deferred copy so the sliders stay quick.
  const deferred = useDeferredValue(s);
  const totals = useMemo(() => worldTotals(deferred), [deferred]);
  const positive = totals.filter((x) => x > 0).length;
  const sorted = [...totals].sort((a, b) => a - b);

  // Bar chart geometry.
  const BX0 = 66;
  const BX1 = 624;
  const groupGap = 14;
  const bw = (BX1 - BX0 - 2 * groupGap) / WORLDS.length;
  const barX = (i: number) => BX0 + i * bw + (i >= 1 ? groupGap : 0) + (i >= 11 ? groupGap : 0);
  const [bLo, bHi] = niceDomain(Math.min(0, ...totals), Math.max(0, ...totals), 4);
  const by = scale(bLo, bHi, 186, 30);

  const seasonBuys = N.seasonal.trades.filter((t) => t.side === 'buy');
  const seasonSells = N.seasonal.trades.filter((t) => t.side === 'sell');
  const draws = (xs: number[]) => xs.slice(1, 11);
  const idxOf = (id: string) => WORLDS.findIndex((w) => w.id === id);

  return (
    <LessonPage id="shipping/5.5">
      <P>
        Every strategy in this chapter has ended in a number: a forecast’s error in <a href={lessonHref('shipping/5.1')}>Lesson 5.1</a>, a spread’s profit in{' '}
        <a href={lessonHref('shipping/5.2')}>5.2</a>, a charter’s result in <a href={lessonHref('shipping/5.3')}>5.3</a>, a voyage’s earnings in{' '}
        <a href={lessonHref('shipping/5.4')}>5.4</a>. Numbers measured on a simulated past, like the twelve years the course has used since{' '}
        <a href={lessonHref('shipping/2.5')}>Chapter 2</a>, are easy to fool yourself with. A strategy’s result can be large because the strategy works, or
        because it happened to suit that history’s particular storms, harvests and orders.
      </P>
      <P>
        This lesson is a laboratory for telling the two apart. Its tools are forward freight agreements on the Kamsarmax index of{' '}
        <a href={lessonHref('shipping/4.5')}>Lesson 4.5</a>, traded one month ahead at the forward price and settled on the next month’s average, 30 days at a
        time, less commissions and clearing fees. Five rules decide each month whether to buy, sell or stay out. One is the rule a shipping person reaches for
        first: buy the soybean season. The next demonstration runs a rule through the history; the shaded years are <K tone="teal">out of sample</K> — years you would
        hold back, choosing the rule and its settings only by the years before them. Pick a rule and its size:
      </P>

      <Figure name="Freight Trading Lab" scenario={lab}>
        <Segmented label="Rule" value={s.strategy} onChange={(v) => lab.set({ strategy: v })} options={STRATEGIES.map((id) => ({ value: id, label: STRATEGY_NAMES[id] }))} />
        <XYChart
          ariaLabel={`${STRATEGY_NAMES[s.strategy]} on the simulated Kamsarmax index, ${s.days} days a month, ${fmt(s.cost, 2)}% costs: ${$m(run.first.total)} in Years 1–${s.split} and ${$m(run.second.total)} in Years ${s.split + 1}–12.`}
          series={[
            { xs, ys: equity.map((e) => e / 1e6), color: GRAPHIC.green, width: 2.5 },
            ...(s.bunker ? [{ xs: BUNKER_PNL.map((_, i) => (i + 2) / 12), ys: bunkerEq.map((e) => e / 1e6), color: GRAPHIC.gold, width: 2, dash: '5 4' }] : []),
          ]}
          xMin={0}
          xMax={12}
          yMin={eLo / 1e6}
          yMax={eHi / 1e6}
          yTicks={niceTicks(eLo / 1e6, eHi / 1e6, 4)}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0)}m`.replace('$−', '−$')}
          yLabel="Running total, $ million"
          bands={[{ from: s.split, to: 12, color: tint(GRAPHIC.gray, 0.16), label: 'out of sample' }]}
          refLines={[{ y: 0, color: '#9a9a9a', dash: '2 3' }]}
          height={190}
        />
        <XYChart
          ariaLabel={`Drawdown: the deepest fall from a previous high is ${$m(-run.all.maxDrawdown)}.`}
          series={[{ xs, ys: drawdown.map((d) => d / 1e6), color: GRAPHIC.red, width: 1.5, fillTo: 0, fillOpacity: 0.18 }]}
          xMin={0}
          xMax={12}
          yMin={ddLo / 1e6}
          yMax={0}
          yTicks={niceTicks(ddLo / 1e6, 0, 2)}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0)}m`.replace('$−', '−$')}
          yLabel="Below its previous high"
          bands={[{ from: s.split, to: 12, color: tint(GRAPHIC.gray, 0.16) }]}
          height={110}
        />
        {s.bunker && <Legend items={[{ label: 'The rule', color: GRAPHIC.green, kind: 'line' }, { label: 'Bunker hedge on 700 t a month', color: GRAPHIC.gold, kind: 'line', dashed: true }]} />}
        <Readouts
          items={[
            { label: `Years 1–${s.split} · Sharpe`, value: `${$m(run.first.total)} · ${fmt(run.first.sharpe, 2)}`, tone: run.first.total >= 0 ? 'green' : 'red' },
            { label: `Years ${s.split + 1}–12 · Sharpe`, value: `${$m(run.second.total)} · ${fmt(run.second.sharpe, 2)}`, tone: run.second.total >= 0 ? 'green' : 'red' },
            { label: 'worst drawdown', value: $m(-run.all.maxDrawdown), tone: 'red' },
            { label: `trades that made money, of ${run.traded}`, value: pct(run.hitRate) },
          ]}
        />
        <Slider label="Days traded each month" value={s.days} min={15} max={90} step={15} onChange={(v) => lab.set({ days: v })} display={`${s.days} days`} />
        <Slider label="Commissions and fees" tone="green" value={s.cost} min={0} max={1} step={0.05} onChange={(v) => lab.set({ cost: v })} display={`${fmt(s.cost, 2)}% of value`} />
        <Slider
          label="Threshold"
          value={s.threshold}
          min={0}
          max={60}
          disabled={!usesThreshold}
          onChange={(v) => lab.set({ threshold: v })}
          display={usesThreshold ? `${s.threshold}%` : 'not used'}
        />
        <Slider label="In sample through" tone="teal" value={s.split} min={3} max={10} onChange={(v) => lab.set({ split: v })} display={`Year ${s.split}`} />
        <Checkbox label="Show a bunker hedge on 700 t of fuel a month" checked={s.bunker} onChange={(v) => lab.set({ bunker: v })} />
        <Caption>
          {RULE_TEXT[s.strategy]}
          {s.bunker ? ` The bunker hedge fixes each month’s fuel price a month ahead: over the history it nets ${$k(BUNKER.total)}, against fuel bills that moved by about ${$k(BUNKER.stdev)} a month.` : ''}
        </Caption>
      </Figure>

      <P>
        The harvest rule loses {$m(-N.seasonal.all.total)} over the twelve years. The season is perfectly real — Brazil’s soybeans really do fill Kamsarmaxes from
        March to July, and the Kamsarmax index really does rise with them. But everyone knows it, and the forward curve of Lesson 4.5 prices it in — more of it, in
        fact, than arrives. The March-to-June contracts this rule buys were priced at {$k(mean(seasonBuys.map((t) => t.price)))} a day on average and settled at{' '}
        {$k(mean(seasonBuys.map((t) => t.settlement)))}; the September-to-November contracts it sells were priced at {$k(mean(seasonSells.map((t) => t.price)))}{' '}
        and settled at {$k(mean(seasonSells.map((t) => t.settlement)))}. A physical fact that is already in the price earns nothing, and a rule that pays the
        curve’s price for more season than the market delivers loses: commissions account for only {$m(N.seasonal.fees)} of its {$m(-N.seasonal.all.total)}.
      </P>
      <P>
        Momentum does worse, {$m(-N.momentum.all.total)}, and its worst <K tone="red">drawdown</K> — the deepest fall from a previous high — is{' '}
        {$m(-N.momentum.all.maxDrawdown)}. Month-to-month moves in this market are
        largely the season turning, which the forward curve already expects, and short spikes fading, as in <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a>; a
        rule that follows last month’s move is usually late. It trades every month, too, and pays {$m(N.momentum.fees)} in fees. Mean reversion at a 10% threshold loses {$m(-N.reversion.all.total)} —
        but look at its halves: {$m(N.reversion.first.total)} in Years 1–6, {$m(N.reversion.second.total)} in Years 7–12. Anyone who chose it on the first six
        years would have been badly surprised by the next six.
      </P>
      <P>
        The fundamentals rule makes {$m(N.fundamental.all.total)}, with {pct(N.fundamental.hitRate)} of its {N.fundamental.traded} trades winning and a{' '}
        <K>Sharpe ratio</K> of {fmt(N.fundamental.all.sharpe, 2)}, the yardstick traders use for how steady a profit is. It divides the average monthly result, here{' '}
        {$k(N.fundamental.all.mean)}, by the <K>standard deviation</K> of the monthly results, here {$k(N.fundamental.all.stdev)} — a measure of how far a typical
        month lands from the average — and scales the ratio to a year by multiplying it by √12. The higher it is, the less the profit rests on a few lucky months.
      </P>
      <P>
        Be clear about why this rule works. It isn’t the orderbook: leave the shipyards’ deliveries out of its forecast and it makes{' '}
        {$m(N.noDeliveries.total)} on {N.noDeliveries.traded} trades, almost the same, because one month ahead too few ships arrive to matter. As in{' '}
        <a href={lessonHref('shipping/5.1')}>Lesson 5.1</a>, the forecaster uses the very equilibrium that generated the history and builds next month from this
        month’s ships, cargo and season. Our model’s traders build their forward curve from nothing but today’s index and a fixed long-run level for each month of
        the year. One month ahead, the forecast is simply the better guess. That is a blind spot we built into the simulation, not a law of the sea: real forward
        freight markets are full of people running exactly this kind of analysis, and a gap this wide shouldn’t be expected in practice.
      </P>

      <Challenge
        id="a"
        question="Mean reversion at a 10% threshold made money in Years 1–6 and lost it in Years 7–12. Find a threshold at which it makes money in both halves."
        solved={solved}
        status={
          s.strategy !== 'reversion'
            ? 'Switch the rule to mean reversion.'
            : `At a ${s.threshold}% threshold it makes ${$m(halves.first.total)} in Years 1–6 and ${$m(halves.second.total)} in Years 7–12.`
        }
        success={`Solved. At ${s.threshold}% it makes ${$m(halves.first.total)} and ${$m(halves.second.total)}, on ${labRun(s).traded} trades in twelve years. At these costs, ${passing.length > 1 ? `thresholds from ${passing[0]}% to ${passing[passing.length - 1]}% pass (not all of them)` : 'only this threshold passes'}; ${passing.includes(40) ? '' : '40% doesn’t, '}and the 10% you started with lost. But notice how you found it: by trying thresholds on the same twelve years you are judging them by. The next demonstration asks the fairer question — does it still work in a history it has never seen?`}
      />

      <H2>Other worlds</H2>
      <P>
        A backtest measures a rule and a history at the same time. The cure is to test the rule where it couldn’t have been fitted: other histories the same world
        could have produced. The model can make as many as we like. In the next demonstration the bars are the rule’s twelve-year total, with the settings you
        chose, in our history; in ten others with different draws of demand shocks and fuel prices; and in three worlds with a piece of the physics changed — no
        harvest seasons in any trade, shipyards that deliver in a year instead of two and a half, and cargo demand that swings less than half as much:
      </P>

      <Figure name="Freight Trading Lab · other worlds" scenario={lab}>
        <Segmented label="Rule" value={s.strategy} onChange={(v) => lab.set({ strategy: v })} options={STRATEGIES.map((id) => ({ value: id, label: STRATEGY_NAMES[id] }))} />
        <svg
          className="chart"
          viewBox="0 0 640 236"
          role="img"
          aria-label={`${STRATEGY_NAMES[deferred.strategy]} in fourteen worlds: it makes money in ${positive}. Our history ${$m(totals[0])}; ${WORLDS.slice(11)
            .map((w, i) => `${w.label.toLowerCase()} ${$m(totals[11 + i])}`)
            .join('; ')}.`}
        >
          <text className="ax" x={BX0} y={14}>
            Twelve-year total, $ million
          </text>
          <GridY y={by} ticks={niceTicks(bLo, bHi, 4)} x0={BX0} x1={BX1} format={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, Math.abs(v) < 1e6 && v !== 0 ? 1 : 0)}m`} baseline={0} />
          {totals.map((v, i) => {
            const x = barX(i) + 3;
            const w = bw - 6;
            const y0 = by(0);
            const y1 = by(v);
            const color = v >= 0 ? GRAPHIC.green : GRAPHIC.red;
            return (
              <g key={WORLDS[i].id}>
                <rect x={x} y={Math.min(y0, y1)} width={w} height={Math.max(1, Math.abs(y1 - y0))} fill={color} opacity={WORLDS[i].group === 'ours' ? 1 : 0.75} />
                <text x={x + w / 2} y={v >= 0 ? y1 - 4 : y1 + 12} textAnchor="middle" style={{ fontSize: 10, fill: v >= 0 ? TEXT.green : TEXT.red }}>
                  {fmt(v / 1e6, 1)}
                </text>
                <text x={x + w / 2} y={204} textAnchor="middle" className="ax">
                  {WORLDS[i].short[0]}
                </text>
                {WORLDS[i].short[1] && (
                  <text x={x + w / 2} y={217} textAnchor="middle" className="ax">
                    {WORLDS[i].short[1]}
                  </text>
                )}
              </g>
            );
          })}
          <text x={(barX(1) + barX(10) + bw) / 2} y={232} textAnchor="middle" className="ax">
            ten other draws of luck
          </text>
          <text x={(barX(11) + barX(13) + bw) / 2} y={232} textAnchor="middle" className="ax">
            changed physics
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'worlds where it makes money', value: `${positive} of ${WORLDS.length}`, tone: positive === WORLDS.length ? 'green' : undefined },
            { label: 'worst world', value: $m(sorted[0]), tone: sorted[0] < 0 ? 'red' : 'green' },
            { label: 'median world', value: $m((sorted[6] + sorted[7]) / 2) },
            { label: 'best world', value: $m(sorted[sorted.length - 1]), tone: 'green' },
          ]}
        />
        <Slider
          label="Threshold"
          value={s.threshold}
          min={0}
          max={60}
          disabled={!usesThreshold}
          onChange={(v) => lab.set({ threshold: v })}
          display={usesThreshold ? `${s.threshold}%` : 'not used'}
        />
        <Caption>
          {STRATEGY_NAMES[deferred.strategy]}
          {deferred.strategy === 'reversion' || deferred.strategy === 'fundamental' ? ` at a ${deferred.threshold}% threshold` : ''}, {deferred.days} days a month and{' '}
          {fmt(deferred.cost, 2)}% costs, as set in the first demonstration. Every history here is simulated.
        </Caption>
      </Figure>

      <P>
        With the starting settings, the harvest rule loses in all fourteen worlds, between {$m(-Math.max(...N.seasonalWorlds))} and{' '}
        {$m(-Math.min(...N.seasonalWorlds))}. Its worst world is the one without seasons, {$m(N.seasonalWorlds[idxOf('noseason')])}: there the cargo no longer follows
        the harvests, but our model’s traders still price the season in, and the rule keeps paying for a surge that never comes. Momentum loses in every world that
        has seasons and makes {$m(N.momentumWorlds[idxOf('noseason')])} in the one that hasn’t. Switch the harvests off and the thing that fooled it is gone — the
        clearest case in this lesson of a physical cause you can remove and watch the result change.
      </P>
      <P>
        Mean reversion at 10% is a coin toss: it makes money in {draws(N.reversionWorlds).filter((x) => x > 0).length} of the ten other draws and loses in the
        rest. There is no physical reason behind a 10% band; it trades noise. Widen the band and the rule trades only at the extremes, mostly buying when earnings
        sit far below normal, down toward the floor where old ships stop trading (<a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>). At 45% it makes money in{' '}
        {N.wide45.filter((x) => x > 0).length} of the fourteen worlds and at 50% in {N.wide50.filter((x) => x > 0).length}, though never much, and it fails in
        the world whose shipyards deliver in a year, where the cycle is gentler. The fundamentals rule makes money in{' '}
        {N.fundamentalWorlds.filter((x) => x > 0).length} of fourteen, from {$m(Math.min(...N.fundamentalWorlds))} to {$m(Math.max(...N.fundamentalWorlds))}. None of
        these worlds breaks it, because its edge lies in our traders, not in the sea.
      </P>

      <H2>Hedges are for risk</H2>
      <P>
        The owner’s hedge makes {$m(N.hedge.all.total)}, small beside the swings it sits in. In our history the forward curve’s long-run level averaged{' '}
        {$k(ANCHOR_AVG)} a day while the index averaged {$k(INDEX_AVG)}, so sellers collected a little; a hedge isn’t bought for that. What it buys is certainty a
        month ahead: for a Kamsarmax earning the index, it removes surprises of about {$k(stdev(surprise))} a month (one standard deviation, on 30 days). Notice what
        it doesn’t remove. Over the twelve years the ship’s monthly earnings have a standard deviation of {$k(stdev(physical))}, and with the hedge{' '}
        {$k(stdev(hedged))} — barely less — because the price the hedge locks in, next month’s forward, moves with the market. Fixing earnings across a cycle takes longer contracts — a strip of FFAs or a period charter, as in{' '}
        <a href={lessonHref('shipping/5.3')}>Lesson 5.3</a>. The bunker hedge is the same story for costs: over the history it nets {$k(BUNKER.total)}, which is
        nothing, while taking the guesswork out of fuel bills that moved by about {$k(BUNKER.stdev)} a month.
      </P>
      <P>
        Through all of this, size and costs scale what a rule does without changing what it is. Double the days and every profit and drawdown doubles; raise the
        fees and the rules that trade every month suffer most. A rule worth trusting is one you can explain by something physical — a fleet that can’t grow faster
        than shipyards build it, a floor set by the cost of laying ships up, a harvest that moves cargo — that still works in histories it has never seen, and that
        stops working when you take its physical cause away. In <a href={lessonHref('shipping/6.1')}>Chapter 6</a> all of these pieces come together: you’ll design
        a fleet, find it cargo, schedule its voyages, forecast its market and decide how much of its future to hedge.
      </P>
    </LessonPage>
  );
}
