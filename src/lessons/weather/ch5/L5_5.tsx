import { useDeferredValue, useMemo } from 'react';
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
import { CME_TICK, WINTER_SEASON, monthContract, type ContractSpec } from '../../../engines/weather/pricing';
import { MARKET, marketQuote, replay, tradeStats, type Trade, type TradeStats } from '../../../engines/weather/market';
import { decisions, errorToClaim, hedgeAgainstBudget, pitHistogram, rehedge, type BudgetHedge } from '../../../engines/weather/backtest';
import { regress, utilityWinters } from '../../../engines/weather/exposure';
import { MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The backtest: one decision per winter month, held to settlement.

export type MonthKey = 'dec' | 'jan' | 'feb';
const MONTH_OF: Record<MonthKey, number> = { dec: 11, jan: 0, feb: 1 };

/** Contract years replayed: 2–40, so every decision up to 60 days ahead falls inside the archive. */
export const YEARS = Array.from({ length: 39 }, (_, i) => i + 2);

export interface BacktestState {
  month: MonthKey;
  /** Days before the month starts that the decision is made. */
  lead: number;
  /** Index points by which our number must beat the market's price. */
  threshold: number;
  /** The market's half-spread, index points. */
  spread: number;
  /** Days after the trade date that the forecast used was issued — a bug, not a strategy. */
  lookAhead: number;
  /** Calder Bay's winter warming per °C of Niño-3.4, °F. */
  ensoF: number;
}

export const BACKTEST_DEFAULTS: BacktestState = { month: 'jan', lead: 60, threshold: 5, spread: 5, lookAhead: 0, ensoF: 1 };

export interface BacktestRun {
  trades: Trade[];
  stats: TradeStats;
  /** Standard error of the average trade, $. */
  se: number;
  firstHalf: TradeStats;
  secondHalf: TradeStats;
}

const runCache = new Map<string, BacktestRun>();

/** Replay the rule over the archive's winters, one contract per trade. */
export function runBacktest(st: BacktestState): BacktestRun {
  const key = `${st.month}|${st.lead}|${st.threshold}|${st.spread}|${st.lookAhead}|${st.ensoF}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const knobs = { ensoF: st.ensoF };
  const trades = replay(
    monthContract('HDD', MONTH_OF[st.month]),
    YEARS,
    st.lead,
    { threshold: st.threshold, size: 1, view: { lookAheadDays: st.lookAhead, knobs } },
    { ...MARKET, halfSpread: st.spread },
    knobs,
  );
  const stats = tradeStats(trades);
  const run: BacktestRun = {
    trades,
    stats,
    se: stats.trades ? stats.sd / Math.sqrt(stats.trades) : 0,
    firstHalf: tradeStats(trades.filter((t) => t.year <= 20)),
    secondHalf: tradeStats(trades.filter((t) => t.year > 20)),
  };
  if (runCache.size > 400) runCache.clear();
  runCache.set(key, run);
  return run;
}

const pitCache = new Map<string, { hist: number[]; ratio: number }>();

/** Where each year's settled index fell in the distribution honestly available on the trade date. */
export function calibration(st: BacktestState): { hist: number[]; ratio: number } {
  const key = `${st.month}|${st.lead}|${st.lookAhead}|${st.ensoF}`;
  const hit = pitCache.get(key);
  if (hit) return hit;
  const ds = decisions(monthContract('HDD', MONTH_OF[st.month]), YEARS, st.lead, st.lookAhead, { ensoF: st.ensoF });
  const out = { hist: pitHistogram(ds.map((d) => d.pit)), ratio: errorToClaim(ds) };
  if (pitCache.size > 200) pitCache.clear();
  pitCache.set(key, out);
  return out;
}

/** The first challenge: at 60 days before January, the strongest ENSO link (0.1 steps) at which the rule never trades. */
export const ENSO_STEP = 0.1;
export function ensoGoneSolved(st: BacktestState): boolean {
  const d = BACKTEST_DEFAULTS;
  if (st.month !== 'jan' || st.lead !== 60 || st.threshold !== d.threshold || st.spread !== d.spread || st.lookAhead !== 0) return false;
  const next = Math.round((st.ensoF + ENSO_STEP) * 10) / 10;
  return runBacktest(st).stats.trades === 0 && runBacktest({ ...st, ensoF: next }).stats.trades > 0;
}

/** The second challenge: deciding on January 1, the shortest look-ahead that makes the average trade at least five times the honest one. */
export const LOOKAHEAD_MULTIPLE = 5;
export function shortestFlatteringLookAhead(st: BacktestState): number | null {
  const honest = runBacktest({ ...st, lookAhead: 0 }).stats.mean;
  if (honest <= 0) return null;
  for (let l = 1; l <= 30; l++) if (runBacktest({ ...st, lookAhead: l }).stats.mean >= LOOKAHEAD_MULTIPLE * honest) return l;
  return null;
}
export function lookAheadSolved(st: BacktestState): boolean {
  const d = BACKTEST_DEFAULTS;
  if (st.month !== 'jan' || st.lead !== 0 || st.threshold !== d.threshold || st.spread !== d.spread || st.ensoF !== d.ensoF) return false;
  return st.lookAhead > 0 && st.lookAhead === shortestFlatteringLookAhead(st);
}

// ---------------------------------------------------------------------------
// The hedge: Calder Gas & Light sells seasonal strips the day before November 1.

const SEASON: ContractSpec = { kind: 'HDD', months: WINTER_SEASON, type: 'future', strike: 0, tick: CME_TICK };
export const HEDGE_STEP = 100;
export const HEDGE_MAX = 4000;
export const HEDGE_DAYS_BEFORE = 1;

export interface HedgeState {
  contracts: number;
  variability: number;
  ensoF: number;
}

export const HEDGE_DEFAULTS: HedgeState = { contracts: 0, variability: 1, ensoF: 1 };

export interface HedgeBase {
  base: BudgetHedge;
  /** The utility's margin per HDD, from its 40 winters, $. */
  slope: number;
  r2: number;
}

const hedgeCache = new Map<string, HedgeBase>();

/** The utility's winters, its budget fit and the quotes, for a setting of the physics (unhedged). */
export function hedgeBase(variability: number, ensoF: number): HedgeBase {
  const key = `${variability}|${ensoF}`;
  const hit = hedgeCache.get(key);
  if (hit) return hit;
  const knobs = { variability, ensoF };
  const w = utilityWinters(knobs);
  const margins = w.map((x) => x.margin);
  const fit = regress(
    w.map((x) => x.hdd),
    margins,
  );
  const base = hedgeAgainstBudget(SEASON, w.map((x) => x.winter), margins, fit, 0, HEDGE_DAYS_BEFORE, (y, t) => marketQuote(SEASON, y, t, MARKET, knobs), knobs);
  const out = { base, slope: fit.slope, r2: fit.r2 };
  if (hedgeCache.size > 100) hedgeCache.clear();
  hedgeCache.set(key, out);
  return out;
}

export function hedgeWith(st: HedgeState): BudgetHedge {
  return rehedge(hedgeBase(st.variability, st.ensoF).base, st.contracts, CME_TICK);
}

/** The number of strips, on the slider's steps, that leaves the misses with the smallest spread. */
export function bestStrips(variability: number, ensoF: number): number {
  const base = hedgeBase(variability, ensoF).base;
  let best = 0;
  let bestSd = Infinity;
  for (let n = 0; n <= HEDGE_MAX; n += HEDGE_STEP) {
    const sd = rehedge(base, n, CME_TICK).hedgedMissSd;
    if (sd < bestSd - 1e-6) {
      bestSd = sd;
      best = n;
    }
  }
  return best;
}

export function hedgeSolved(st: HedgeState): boolean {
  return st.contracts === bestStrips(st.variability, st.ensoF);
}

// ---------------------------------------------------------------------------
// Drawing.

function kusd(v: number): string {
  if (Math.abs(v) < 0.5) return '$0';
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${fmt(a / 1e6, a >= 1e7 ? 0 : 1)}M` : a >= 1000 ? `$${fmt(a / 1000, a >= 1e4 ? 0 : 1)}k` : `$${fmt(a)}`;
  return (v < 0 ? '−' : '') + s;
}

function cumulative(trades: Trade[]): number[] {
  const byYear = new Map(trades.map((t) => [t.year, t.pnl]));
  let run = 0;
  return YEARS.map((y) => (run += byYear.get(y) ?? 0));
}

function BacktestChart({ run, honest, cal, label }: { run: BacktestRun; honest: BacktestRun | null; cal: { hist: number[]; ratio: number }; label: string }) {
  const cum = cumulative(run.trades);
  const cumH = honest ? cumulative(honest.trades) : null;
  const vals = [0, ...cum, ...(cumH ?? [])];
  const [lo, hi] = niceDomain(Math.min(...vals), Math.max(1000, ...vals), 4);
  const x = scale(YEARS[0] - 0.5, YEARS[YEARS.length - 1] + 0.5, 70, 620);
  const y = scale(lo, hi, 196, 26);
  const xs = YEARS.map(x);
  const byYear = new Map(run.trades.map((t) => [t.year, t]));
  // Per-trade bars.
  const maxAbs = Math.max(1500, ...run.trades.map((t) => Math.abs(t.pnl)));
  const [blo, bhi] = niceDomain(-maxAbs, maxAbs, 2);
  const xb = scale(YEARS[0] - 0.5, YEARS[YEARS.length - 1] + 0.5, 70, 400);
  const yb = scale(blo, bhi, 352, 248);
  // Calibration histogram.
  const total = cal.hist.reduce((s, v) => s + v, 0);
  const hx = scale(0, 5, 452, 620);
  const hy = scale(0, Math.max(total, 10), 352, 248);
  const expected = total / 5;
  return (
    <svg className="chart" viewBox="0 0 640 380" role="img" aria-label={label}>
      <text className="ax" x={70} y={14}>
        Cumulative P&amp;L, one contract a trade
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={kusd} baseline={0} />
      {cumH && <path d={linePath(xs, cumH.map(y))} fill="none" stroke="#9a9a9a" strokeWidth={2} strokeDasharray="6 4" />}
      <path d={linePath(xs, cum.map(y))} fill="none" stroke={TEXT.green} strokeWidth={2.5} strokeLinejoin="round" />
      {YEARS.map((yr, i) => {
        const t = byYear.get(yr);
        if (!t) return null;
        return <circle key={yr} cx={xs[i]} cy={y(cum[i])} r={3} fill={t.pnl >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
      })}
      {[2, 10, 20, 30, 40].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr)} y={212}>
          {yr === 2 ? 'year 2' : yr}
        </text>
      ))}
      <text className="ax" x={70} y={238}>
        Each trade’s P&amp;L
      </text>
      <line className="base" x1={70} x2={400} y1={yb(0)} y2={yb(0)} />
      <text className="ax ax-e" x={64} y={yb(bhi) + 4}>
        {kusd(bhi)}
      </text>
      <text className="ax ax-e" x={64} y={yb(blo) + 4}>
        {kusd(blo)}
      </text>
      {run.trades.map((t) => {
        const cx = xb(t.year);
        const top = yb(Math.max(0, t.pnl));
        const h = Math.abs(yb(t.pnl) - yb(0));
        return <rect key={t.year} x={cx - 3} y={top} width={6} height={Math.max(1, h)} fill={t.pnl >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
      })}
      <text className="ax" x={452} y={238}>
        Where outcomes fell
      </text>
      {cal.hist.map((c, i) => (
        <rect key={i} x={hx(i) + 3} y={hy(c)} width={hx(1) - hx(0) - 6} height={hy(0) - hy(c)} fill={GRAPHIC.blue} opacity={0.7} />
      ))}
      <line x1={452} x2={620} y1={hy(expected)} y2={hy(expected)} stroke="#555" strokeDasharray="4 3" />
      <text className="ax ax-m" x={hx(0.5)} y={368}>
        low
      </text>
      <text className="ax ax-m" x={hx(2.5)} y={368}>
        middle
      </text>
      <text className="ax ax-m" x={hx(4.5)} y={368}>
        high
      </text>
    </svg>
  );
}

function HedgeChart({ h, label }: { h: BudgetHedge; label: string }) {
  const vals = h.years.flatMap((y) => [y.miss, y.hedgedMiss]);
  const m = Math.max(5e6, ...vals.map(Math.abs));
  const [lo, hi] = niceDomain(-m, m, 4);
  const x = scale(0.5, h.years.length + 0.5, 70, 620);
  const y = scale(lo, hi, 214, 24);
  return (
    <svg className="chart" viewBox="0 0 640 240" role="img" aria-label={label}>
      <text className="ax" x={70} y={14}>
        Margin against the November plan, by winter
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={kusd} baseline={0} />
      {h.years.map((w, i) => {
        const cx = x(i + 1);
        const top = y(Math.max(0, w.miss));
        const bh = Math.abs(y(w.miss) - y(0));
        const ht = y(Math.max(0, w.hedgedMiss));
        const hh = Math.abs(y(w.hedgedMiss) - y(0));
        return (
          <g key={w.winter}>
            <rect x={cx - 5} y={top} width={10} height={Math.max(1, bh)} fill="#cfcfcf" />
            <rect x={cx - 2.5} y={ht} width={5} height={Math.max(1, hh)} fill={w.hedgedMiss >= 0 ? GRAPHIC.green : GRAPHIC.red} />
          </g>
        );
      })}
      {[1, 10, 20, 30, 40].map((wn) => (
        <text key={wn} className="ax ax-m" x={x(wn)} y={232}>
          {wn === 1 ? 'winter 1' : wn}
        </text>
      ))}
    </svg>
  );
}

const MONTH_OPTIONS: Array<{ value: MonthKey; label: string }> = [
  { value: 'dec', label: 'December' },
  { value: 'jan', label: 'January' },
  { value: 'feb', label: 'February' },
];

export default function Lesson() {
  const s = useScenario('backtest', BACKTEST_DEFAULTS);
  const st = useDeferredValue(s.state);
  const run = useMemo(() => runBacktest(st), [st]);
  const honest = useMemo(() => (st.lookAhead > 0 ? runBacktest({ ...st, lookAhead: 0 }) : null), [st]);
  const cal = useMemo(() => calibration(st), [st]);
  const solved = ensoGoneSolved(s.state);
  const solved2 = lookAheadSolved(s.state);
  const monthName = MONTH_NAMES[MONTH_OF[st.month]];
  const tone = (v: number) => (v > 0.5 ? WX.money : v < -0.5 ? 'red' : 'ink');

  const hs = useScenario('hedge', HEDGE_DEFAULTS);
  const hst = useDeferredValue(hs.state);
  const hb = useMemo(() => hedgeBase(hst.variability, hst.ensoF), [hst.variability, hst.ensoF]);
  const hedge = useMemo(() => hedgeWith(hst), [hst]);
  const solved3 = hedgeSolved(hs.state);

  // Numbers the prose quotes, from the same engines.
  const q = useMemo(() => {
    const at60 = runBacktest(BACKTEST_DEFAULTS);
    const at0 = { ...BACKTEST_DEFAULTS, lead: 0 };
    const look = (l: number) => runBacktest({ ...at0, lookAhead: l });
    // In-sample tuning: the best month and lead (5-day steps) over the first half of the winters.
    let tuned = { month: 'jan' as MonthKey, lead: 0, first: -Infinity, second: 0 };
    let combos = 0;
    for (const m of ['dec', 'jan', 'feb'] as MonthKey[]) {
      for (let lead = 0; lead <= 60; lead += 5) {
        combos++;
        const r = runBacktest({ ...BACKTEST_DEFAULTS, month: m, lead });
        if (r.firstHalf.mean > tuned.first) tuned = { month: m, lead, first: r.firstHalf.mean, second: r.secondHalf.mean };
      }
    }
    const base = hedgeBase(1, 1);
    const at = (n: number) => rehedge(base.base, n, CME_TICK);
    const hv = hedgeBase(1.5, 1);
    return {
      at60,
      at0: runBacktest(at0),
      l1: look(1),
      l2: look(2),
      l5: look(5),
      l30: look(30),
      cal0: calibration(at0),
      cal5: calibration({ ...at0, lookAhead: 5 }),
      cal30: calibration({ ...at0, lookAhead: 30 }),
      ensoFew: runBacktest({ ...BACKTEST_DEFAULTS, ensoF: 0.5 }),
      tuned,
      combos,
      slope: base.slope,
      r2: base.r2,
      h0: at(0),
      h1000: at(1000),
      h2000: at(2000),
      hBest: at(bestStrips(1, 1)),
      bestN: bestStrips(1, 1),
      h4000: at(4000),
      hv0: rehedge(hv.base, 0, CME_TICK),
      hvBest: rehedge(hv.base, bestStrips(1.5, 1), CME_TICK),
    };
  }, []);
  const spreadCost = MARKET.halfSpread * CME_TICK * q.bestN;

  const ratioDisplay = (r: TradeStats) => (r.trades ? usd(r.mean) : '—');

  return (
    <LessonPage id="weather/5.5">
      <P>
        This chapter has built the whole machinery of a weather market. <a href={lessonHref('weather/5.1')}>Lesson 5.1</a> wrote contracts on station indices,{' '}
        <a href={lessonHref('weather/5.2')}>5.2</a> priced them from forecast distributions, <a href={lessonHref('weather/5.3')}>5.3</a> found where the
        simulated market’s prices and ours part company, and <a href={lessonHref('weather/5.4')}>5.4</a> carried a weather view into gas and power. Every one of
        those ideas sounds like money. Before anyone risks any, they replay the idea over past winters and count what it would have earned. That replay is a{' '}
        <b>backtest</b>, the most useful tool a trader has and the easiest one to fool yourself with.
      </P>
      <P>
        Its first rule is <b>point-in-time</b> data. Each past decision may use only what was known at the moment it was made: the forecast as it was issued that
        day, not a later revision, and observations up to that day and no further. Real weather desks keep archives of forecasts stamped with the time they were
        issued for exactly this reason. This site ships no archived forecast data. Our archive is simulated: for every day of the course’s 41 simulated years it
        holds the forecasts the course’s model issued, each stamped with its issue day and built only from what had been revealed by then (
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>), and we replay them in order, along with the simulated market’s quotes. Every price here is simulated.
      </P>
      <P>
        The rule under test is simple. On a chosen day before a winter month begins, compare our expected <K tone={WX.index}>index</K> for that month — the
        forecast issued that day for the days it can reach, and beyond them the climate tilted by ENSO, as in <a href={lessonHref('weather/2.4')}>Lesson 2.4</a> —
        with the market’s quote. If our number beats the market’s ask by more than a threshold, buy one contract at $20 a heating degree day; if it falls below the
        bid by more, sell one. Hold it to settlement. In the next demonstration, the top chart is the strategy’s running <K tone={WX.money}>profit</K> over 39
        winters, with each trade’s result marked; the lower left shows each trade; the lower right is a calibration check we’ll come to. Choose the month, the
        decision day, the threshold and the market’s spread — and two more controls, one physical and one a deliberate bug:
      </P>

      <Figure name="Weather Strategy Backtester" scenario={s}>
        <Segmented label="Contract month" value={s.state.month} onChange={(v) => s.set({ month: v })} options={MONTH_OPTIONS} />
        <BacktestChart
          run={run}
          honest={honest}
          cal={cal}
          label={`Backtest of ${monthName} HDD futures decided ${st.lead} days before the month${st.lookAhead ? `, with forecasts from ${st.lookAhead} days after each trade (a look-ahead bug)` : ''}: ${run.stats.trades} trades, ${usd(run.stats.total)} in all, ${usd(run.stats.mean)} a trade on average, ${pct(run.stats.hitRate)} won. Outcomes fell in the low, lower-middle, middle, upper-middle and high fifths of the honest forecast distributions ${cal.hist.join(', ')} times.`}
        />
        <Legend
          items={[
            { label: st.lookAhead ? 'With the bug' : 'Cumulative P&L', color: TEXT.green, kind: 'line' },
            ...(st.lookAhead ? [{ label: 'Honest', color: '#9a9a9a', kind: 'line' as const, dashed: true }] : []),
            { label: 'Share of outcomes per fifth', color: GRAPHIC.blue },
            { label: 'Flat, if calibrated', color: '#555', kind: 'line' as const, dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'trades', value: fmt(run.stats.trades) },
            { label: 'average trade, ± 2 standard errors', value: run.stats.trades ? `${usd(run.stats.mean)} ± ${usd(2 * run.se)}` : '—', tone: tone(run.stats.mean) },
            { label: 'won', value: run.stats.trades ? pct(run.stats.hitRate) : '—' },
            { label: 'years 2–20 · 21–40, a trade', value: `${ratioDisplay(run.firstHalf)} · ${ratioDisplay(run.secondHalf)}`, tone: WX.money },
            { label: 'errors as a share of the uncertainty claimed', value: pct(cal.ratio), tone: WX.probability },
          ]}
        />
        <Slider label="Decide, days before the month" value={s.state.lead} min={0} max={60} onChange={(v) => s.set({ lead: v })} display={`${s.state.lead} days`} />
        <Slider label="Threshold" tone={WX.index} value={s.state.threshold} min={0} max={30} onChange={(v) => s.set({ threshold: v })} display={`${s.state.threshold} HDD`} />
        <Slider label="Market’s half-spread" tone={WX.money} value={s.state.spread} min={0} max={20} onChange={(v) => s.set({ spread: v })} display={`${s.state.spread} HDD`} />
        <Slider
          label="ENSO’s pull on the winter"
          tone={WX.temperature}
          value={s.state.ensoF}
          min={0}
          max={2}
          step={ENSO_STEP}
          onChange={(v) => s.set({ ensoF: Math.round(v * 10) / 10 })}
          display={`${fmt(s.state.ensoF, 1)} °F per °C`}
        />
        <Slider
          label="Look-ahead bug"
          tone="red"
          value={s.state.lookAhead}
          min={0}
          max={30}
          onChange={(v) => s.set({ lookAhead: v })}
          display={s.state.lookAhead ? `forecasts from ${s.state.lookAhead} days later` : 'none'}
        />
        <Caption>
          {run.stats.trades
            ? `${run.stats.trades} ${monthName} trades over 39 winters made ${usd(run.stats.total)}; the worst lost ${usd(-Math.min(0, run.stats.worst))}.`
            : `The rule never found a gap wider than the threshold and the spread, so it never traded.`}
          {st.lookAhead ? ' Each decision used a forecast issued after it was made: these results could never have been earned.' : ''}
        </Caption>
      </Figure>

      <P>
        It starts on January, decided 60 days ahead, in early November. Over 39 winters the rule trades {q.at60.stats.trades} times and averages{' '}
        {usd(q.at60.stats.mean)} a trade, winning {pct(q.at60.stats.hitRate)} of them, {usd(q.at60.stats.total)} in all. Sixty days out, no weather forecast
        reaches January, so the edge isn’t forecasting skill. It’s the Pacific. The market prices January from the climate alone; our view adds ENSO’s tilt, known
        in November. Turn down ENSO’s pull on Calder Bay’s winter and the opportunity shrinks with it: at 0.5 °F per °C the rule trades only{' '}
        {q.ensoFew.stats.trades} times, for an average of {usd(q.ensoFew.stats.mean)}, and what is left of the edge is lost in the noise. The physics of Lesson 2.4
        is the strategy.
      </P>

      <Challenge
        id="a"
        question="Keep January, 60 days ahead, the threshold and the spread as they start. What’s the strongest ENSO pull, to 0.1 °F per °C, at which the rule never trades at all?"
        solved={solved}
        status={
          s.state.month !== 'jan' || s.state.lead !== 60 || s.state.threshold !== 5 || s.state.spread !== 5 || s.state.lookAhead !== 0
            ? 'Set January, 60 days ahead, a 5 HDD threshold, a 5 HDD spread and no look-ahead.'
            : run.stats.trades
              ? `At ${fmt(s.state.ensoF, 1)} °F per °C the rule still trades ${run.stats.trades} times.`
              : `At ${fmt(s.state.ensoF, 1)} °F per °C it never trades. Could ENSO pull harder and still leave nothing to trade?`
        }
        success={`Solved. At ${fmt(s.state.ensoF, 1)} °F per °C, even the strongest El Niño or La Niña in the archive shifts January’s expected index by less than the threshold plus the spread, so the market’s ENSO-blind price is never wrong by enough to pay for a trade. A tenth of a degree more and the first trade appears. An edge has to be larger than the cost of taking it.`}
      />

      <P>
        Now look at the error bars. A trade’s result swings by {usd(q.at60.stats.sd)} from one winter to the next, so the average of {q.at60.stats.trades}{' '}
        trades is uncertain by about {usd(q.at60.se)} — its standard error. Two standard errors either side of {usd(q.at60.stats.mean)} reach{' '}
        {q.at60.stats.mean - 2 * q.at60.se < 0 ? 'just past' : 'almost to'} zero.
        Split the winters in half and the same rule averaged {usd(q.at60.firstHalf.mean)} a trade in years 2–20 and {usd(q.at60.secondHalf.mean)} in years 21–40.
        A monthly contract settles once a year, so 39 winters are only 39 draws. This edge is real — it was built into the world — and the backtest can barely tell.
      </P>
      <P>
        That makes tuning dangerous. Try every month and every decision day in five-day steps, {q.combos} versions of the rule, and keep the one that did best in
        the first half of the winters: {MONTH_NAMES[MONTH_OF[q.tuned.month]]}, {q.tuned.lead} days ahead, at {usd(q.tuned.first)} a trade. In the second half it
        made {usd(q.tuned.second)}. The best of many backtests is partly the luckiest, which is why the threshold and lead should be chosen for a reason —
        here, how far forecasts reach and when ENSO is known — rather than for the best number.
      </P>

      <H2>The look-ahead bug</H2>
      <P>
        The most dangerous error is quieter: a decision that uses information from after its own timestamp. Move the decision to January 1, 0 days ahead. Honestly
        replayed, the rule averages {usd(q.at0.stats.mean)} a trade and wins {pct(q.at0.stats.hitRate)}. Now raise the look-ahead bug, which feeds each decision the
        forecast issued that many days after the trade — the kind of mistake that slips in when a forecast database is keyed by the day forecast instead of the
        day issued, or when a revised forecast overwrites the original. With a day of look-ahead the average is {usd(q.l1.stats.mean)}; with five,{' '}
        {usd(q.l5.stats.mean)}, winning {pct(q.l5.stats.hitRate)}; with thirty, the forecasts have seen the whole month, {pct(q.l30.stats.hitRate)} of its{' '}
        {q.l30.stats.trades} trades win, and they average {usd(q.l30.stats.mean)}. None of it could have been earned.
      </P>

      <Challenge
        id="b"
        question={`Decide on January 1 (0 days ahead), with the threshold, spread and ENSO pull as they start. What is the shortest look-ahead that makes the average trade at least ${LOOKAHEAD_MULTIPLE} times the honest one?`}
        solved={solved2}
        status={
          s.state.month !== 'jan' || s.state.lead !== 0 || s.state.threshold !== 5 || s.state.spread !== 5 || s.state.ensoF !== 1
            ? 'Set January, 0 days ahead, a 5 HDD threshold, a 5 HDD spread and an ENSO pull of 1.0.'
            : `With ${s.state.lookAhead} days of look-ahead the average trade is ${usd(run.stats.mean)}, against ${usd(q.at0.stats.mean)} honestly.`
        }
        success={`Solved. Just ${s.state.lookAhead} days of forecasts from the future turn an average of ${usd(q.at0.stats.mean)} into ${usd(run.stats.mean)}. The honest rule barely beat the spread at the month’s start, because the market’s forecasts are only two days stale; borrowing two days from the future is enough to look brilliant.`}
      />

      <P>
        Can a bug like that be caught? The lower right of <FigRef to="Weather Strategy Backtester">the demonstration</FigRef> shows, for every one of the 39
        decisions, where the settled index fell within the distribution the forecaster could honestly have claimed on the trade date, in fifths. Honest forecasts
        land in each fifth about equally often, and their errors are about as large as they claimed: {pct(q.cal0.ratio)} here, within sampling noise of 100%. With
        thirty days of look-ahead, {q.cal30.hist[2]} of the 39 land in the middle fifth and the errors shrink to {pct(q.cal30.ratio)} of the claimed uncertainty: forecasts
        better than anyone could have made. But with five days the histogram still looks plausible, and the errors are still {pct(q.cal5.ratio)} of what was
        claimed. Small leaks hide. The defenses are procedural: stamp every forecast with its issue time, never overwrite one, and compare the strategy’s live
        results with its backtest as soon as there are any.
      </P>

      <H2>Hedging the utility</H2>
      <P>
        A backtest serves a hedger too. Calder Gas &amp; Light, from <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>, earns about {usd(q.slope)} of margin for
        each heating degree day of its winter, counted as in <a href={lessonHref('weather/4.1')}>Lesson 4.1</a>, so a mild winter costs it millions. Each autumn it
        plans the winter on the market’s expected index, using its sensitivity as estimated from the archive’s winters; what it risks is the miss
        against that plan. To protect the plan it can sell the November–March seasonal
        strip — a contract on the season’s total, $20 a degree day — at the market’s bid on October 31, and hold it to settlement. (A position this large would in practice be arranged mostly as an over-the-counter swap with a dealer, settling on the same index; the simulated market fills it at its bid.) A mild winter then pays the
        utility on the strips exactly when its margin falls short. In the next demonstration, each gray bar is one winter’s miss without a hedge and the narrow
        bar inside it the miss with one. Choose how many strips to sell, and change the physics of the winters:
      </P>

      <Figure name="Weather Strategy Backtester · hedging the utility" scenario={hs}>
        <HedgeChart
          h={hedge}
          label={`Calder Gas & Light’s winter margin against its November plan over 40 simulated winters, hedged with ${fmt(hst.contracts)} seasonal strips: the misses’ standard deviation falls from ${usd(hedge.missSd)} to ${usd(hedge.hedgedMissSd)}, a ${pct(hedge.effectiveness)} reduction in variance; the worst winter misses by ${usd(-hedge.worstMiss)} unhedged and ${usd(-hedge.worstHedgedMiss)} hedged.`}
        />
        <Legend
          items={[
            { label: 'Unhedged', color: '#cfcfcf' },
            { label: 'Hedged', color: GRAPHIC.green },
          ]}
        />
        <Readouts
          items={[
            { label: 'spread of the misses', value: `${kusd(hedge.missSd)} → ${kusd(hedge.hedgedMissSd)}`, tone: WX.money },
            { label: 'variance removed', value: pct(hedge.effectiveness, 1), tone: WX.money },
            { label: 'worst winter', value: `${kusd(hedge.worstMiss)} → ${kusd(hedge.worstHedgedMiss)}`, tone: 'red' },
            { label: 'the hedge’s average result a winter', value: kusd(-hedge.costPerWinter), tone: tone(-hedge.costPerWinter) },
          ]}
        />
        <Slider label="Strips sold" tone={WX.index} value={hs.state.contracts} min={0} max={HEDGE_MAX} step={HEDGE_STEP} onChange={(v) => hs.set({ contracts: v })} display={fmt(hs.state.contracts)} />
        <Slider
          label="Day-to-day variability"
          tone={WX.temperature}
          value={hs.state.variability}
          min={0.6}
          max={1.6}
          step={0.05}
          onChange={(v) => hs.set({ variability: Math.round(v * 100) / 100 })}
          display={`× ${fmt(hs.state.variability, 2)}`}
        />
        <Slider
          label="ENSO’s pull on the winter"
          tone={WX.temperature}
          value={hs.state.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(v) => hs.set({ ensoF: Math.round(v * 10) / 10 })}
          display={`${fmt(hs.state.ensoF, 1)} °F per °C`}
        />
        <Caption>
          {`With this physics the utility earns ${usd(hb.slope)} of margin per degree day, and its degree days explain ${pct(hb.r2)} of its winters.`}
        </Caption>
      </Figure>

      <P>
        Unhedged, the utility’s winters miss the plan with a standard deviation of {usd(q.h0.missSd)}, and the worst falls {usd(-q.h0.worstMiss)} short. A
        thousand strips remove {pct(q.h1000.effectiveness)} of the variance; two thousand, {pct(q.h2000.effectiveness)}. The right number comes straight from{' '}
        <a href={lessonHref('weather/4.5')}>Lesson 4.5</a>: the dollars the utility gains per degree day divided by the dollars a strip pays,{' '}
        {usd(q.slope)} ÷ $20 ≈ {fmt(q.slope / CME_TICK)}. Sell more and the utility is no longer hedged but betting on cold: at 4,000 strips only{' '}
        {pct(q.h4000.effectiveness)} of the variance is gone. Make the winters more variable and the hedge matters more, not less — at 1.5 times the variability the
        unhedged spread is {usd(q.hv0.missSd)} and the hedged one {usd(q.hvBest.hedgedMissSd)}.
      </P>

      <Challenge
        id="c"
        question="How many strips, to the nearest hundred, leave the utility’s misses with the smallest spread?"
        solved={solved3}
        status={`At ${fmt(hs.state.contracts)} strips the misses’ standard deviation is ${usd(hedge.hedgedMissSd)}.`}
        success={`Solved: ${fmt(hs.state.contracts)} strips leave ${usd(hedge.hedgedMissSd)}, ${pct(hedge.effectiveness, 1)} of the variance removed. That is the minimum-variance hedge, the utility’s dollars per degree day divided by the strip’s $20 — and what remains is the part of the margin the index never measured.`}
      />

      <P>
        What remains is <b>basis risk</b>: the windy and calm winters of Lesson 4.5, which change the utility’s gas sales without changing a single degree day.
        At the best hedge the misses still have a standard deviation of {usd(q.hBest.hedgedMissSd)}, close to what the index left unexplained there; no number of
        strips on this index can remove it. Nor is the hedge free. Its expected cost is the spread, {MARKET.halfSpread} degree days a strip, about{' '}
        {usd(spreadCost)} a winter at {fmt(q.bestN)} strips. In these 40 winters it actually earned {usd(-q.hBest.costPerWinter)} a winter on average, because the
        market’s prices happened to run a little above what settled — luck, not a property of hedging. The hedger pays for certainty. On the other side, the trader
        of <FigRef to="Weather Strategy Backtester">the first demonstration</FigRef> collects the spread and is paid for carrying the risk, and earns more when the
        physics hands it information the price leaves out.
      </P>
      <P>
        That answers the chapter’s question. Probabilistic weather outcomes are priced as expected payoffs over forecast distributions; transferred through
        contracts on indices at named stations, from businesses that lose in one kind of weather to traders and businesses that gain from it or are paid to carry it;
        and traded by anyone whose forecasts beat the market’s — which only a point-in-time test can show. Chapter 6 puts all of it together. Starting in{' '}
        <a href={lessonHref('weather/6.1')}>the next lesson</a>, we’ll build a regional weather model of our own, forecast it, turn the forecasts into exposures,
        price and choose contracts, and test the whole system against the archive.
      </P>
    </LessonPage>
  );
}
