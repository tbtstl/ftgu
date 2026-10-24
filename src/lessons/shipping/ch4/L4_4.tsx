import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
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
import { DEFAULT_CYCLE, simulateCycle, type CycleEvent, type CycleMonth, type CycleParams } from '../../../engines/shipping/cycle';
import { equilibrium } from '../../../engines/shipping/market';
import { HISTORY_EVENTS, HISTORY_MONTHS, HISTORY_SEED, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The first demonstration: fifteen years of the Kamsarmax market from the history's demand shocks,
// with no disruptions and a steady bunker price.

/** The congestion episode the reader can add: four extra days at Qingdao in the first half of Year 6. */
export const CONGESTION: CycleEvent = { from: 60, to: 66, label: 'Port congestion in China', congestion: { QIN: 4 } };

export interface CycleState {
  orderResponse: number;
  lag: number;
  scrapResponse: number;
  growth: number;
  shock: number;
  congestion: 'none' | 'qingdao';
}

export const START: CycleState = {
  orderResponse: DEFAULT_CYCLE.orderResponse,
  lag: DEFAULT_CYCLE.lag,
  scrapResponse: DEFAULT_CYCLE.scrapResponse,
  growth: DEFAULT_CYCLE.growth,
  shock: DEFAULT_CYCLE.shock,
  congestion: 'none',
};

const YEARS = DEFAULT_CYCLE.months / 12;

export function paramsOf(s: CycleState): CycleParams {
  return {
    ...DEFAULT_CYCLE,
    seed: HISTORY_SEED,
    orderResponse: s.orderResponse,
    lag: s.lag,
    scrapResponse: s.scrapResponse,
    growth: s.growth,
    shock: s.shock,
    events: s.congestion === 'qingdao' ? [CONGESTION] : [],
  };
}

export interface CycleStats {
  months: CycleMonth[];
  /** Average earnings in each year, $/day. */
  annual: number[];
  best: number;
  worst: number;
  bestYear: number;
  worstYear: number;
  /** Best minus worst year. */
  gap: number;
  /** Years (1-based) whose average beats the years on either side. */
  peaks: number[];
  /** Average years between peaks (NaN with fewer than two). */
  spacing: number;
  fleetGrowth: number;
  cargoGrowth: number;
}

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function cycleStats(months: CycleMonth[]): CycleStats {
  const n = Math.floor(months.length / 12);
  const annual = Array.from({ length: n }, (_, y) => avg(months.slice(y * 12, y * 12 + 12).map((m) => m.tce)));
  const best = Math.max(...annual);
  const worst = Math.min(...annual);
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) if (annual[i] > annual[i - 1] && annual[i] >= annual[i + 1]) peaks.push(i + 1);
  const spacing = peaks.length > 1 ? (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) : NaN;
  return {
    months,
    annual,
    best,
    worst,
    bestYear: annual.indexOf(best) + 1,
    worstYear: annual.indexOf(worst) + 1,
    gap: best - worst,
    peaks,
    spacing,
    fleetGrowth: months[months.length - 1].fleet / months[0].fleet - 1,
    cargoGrowth: months[months.length - 1].demand / months[0].demand - 1,
  };
}

const CACHE = new Map<string, CycleStats>();

/** The model's run for a set of slider positions (memoized). */
export function runCycle(s: CycleState): CycleStats {
  const key = JSON.stringify(s);
  let r = CACHE.get(key);
  if (!r) {
    r = cycleStats(simulateCycle('kmax', paramsOf(s)));
    if (CACHE.size > 300) CACHE.clear();
    CACHE.set(key, r);
  }
  return r;
}

export const BASE = runCycle(START);

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * The challenge: with every other setting at its start and no congestion, a shipyard lag at which
 * the gap between the best and worst years is less than half the starting gap (6–10 months).
 */
export function swingHalvedSolved(s: CycleState): boolean {
  if (s.congestion !== 'none') return false;
  if (!same(s.orderResponse, START.orderResponse) || !same(s.scrapResponse, START.scrapResponse) || !same(s.growth, START.growth) || !same(s.shock, START.shock)) return false;
  return runCycle(s).gap < 0.5 * BASE.gap;
}

// Numbers for the prose, all from the model.
const yearOf = (st: CycleStats, y: number, f: (m: CycleMonth) => number) => st.months.slice((y - 1) * 12, y * 12).reduce((s, m) => s + f(m), 0);
const FIRST_PEAK = BASE.peaks[0];
const FIRST_BOOK = Math.max(...[1, 2, 3, 4].map((y) => BASE.months[y * 12 - 1].orderbook / BASE.months[y * 12 - 1].fleet));
const TROUGH = BASE.annual.slice(FIRST_PEAK, FIRST_PEAK + 5).reduce((w, v, i) => (v < BASE.annual[w - 1] ? FIRST_PEAK + i + 1 : w), FIRST_PEAK + 1);
const DELIVERIES_TROUGH = yearOf(BASE, TROUGH - 1, (m) => m.deliveries) + yearOf(BASE, TROUGH, (m) => m.deliveries);
const ORDERS_PEAK = yearOf(BASE, FIRST_PEAK, (m) => m.orders);
const SOLVED_LAGS = Array.from({ length: 43 }, (_, i) => i + 6).filter((lag) => swingHalvedSolved({ ...START, lag }));
const LAG_FAST = runCycle({ ...START, lag: SOLVED_LAGS[SOLVED_LAGS.length - 1] ?? 10 });
const TIMID = runCycle({ ...START, orderResponse: 0.01 });
const EAGER = runCycle({ ...START, orderResponse: 0.15 });
const CALM = runCycle({ ...START, shock: 0 });
const CONGESTED = runCycle({ ...START, congestion: 'qingdao' });
const EAGER_NO_SCRAP = runCycle({ ...START, orderResponse: 0.15, scrapResponse: 0 });
const EAGER_SCRAP = runCycle({ ...START, orderResponse: 0.15, scrapResponse: 0.06 });
const CONG_DURING = avg(CONGESTED.months.slice(CONGESTION.from, CONGESTION.to).map((m) => m.tce));
const BASE_DURING = avg(BASE.months.slice(CONGESTION.from, CONGESTION.to).map((m) => m.tce));
const CONG_ORDERS = yearOf(CONGESTED, 6, (m) => m.orders);
const BASE_ORDERS6 = yearOf(BASE, 6, (m) => m.orders);
const MONTHLY = BASE.months.map((m) => m.tce);
const SORTED = [...MONTHLY].sort((a, b) => a - b);
const MEDIAN = SORTED[Math.floor(SORTED.length / 2)];
const MEAN = avg(MONTHLY);
const HIGH_MONTHS = MONTHLY.filter((t) => t > 1.5 * MEDIAN).length;
const LOW_MONTHS = MONTHLY.filter((t) => t < MEDIAN / 1.5).length;
const PEAK_MONTH = BASE.months[MONTHLY.indexOf(SORTED[SORTED.length - 1])];
const LOW_MONTH = BASE.months[MONTHLY.indexOf(SORTED[0])];
const EQ = { base: equilibrium('kmax').tce, down: equilibrium('kmax', { demand: 0.9 }).tce, up: equilibrium('kmax', { demand: 1.1 }).tce };

// ---------------------------------------------------------------------------
// The second demonstration: the course history's two classes, with and without each disruption.

const HIST = standardHistory();
const EVENT_KEYS = ['none', 'china', 'brazil', 'panama'] as const;
type EventKey = (typeof EVENT_KEYS)[number];
const EVENT_BY_KEY: Record<Exclude<EventKey, 'none'>, CycleEvent> = { china: HISTORY_EVENTS[0], brazil: HISTORY_EVENTS[1], panama: HISTORY_EVENTS[2] };
const SHORT: Record<Exclude<EventKey, 'none'>, string> = { china: 'China congestion', brazil: 'Brazil ore', panama: 'Panama drought' };
const GROWTH: Record<ClassId, number> = { kmax: 0.025, cape: 0.02 };

const WITHOUT = new Map<string, CycleMonth[]>();

/** The history re-run without one of its disruptions (same shocks, bunker prices and parameters). */
export function historyWithout(id: ClassId, key: Exclude<EventKey, 'none'>): CycleMonth[] {
  const k = `${id}|${key}`;
  let r = WITHOUT.get(k);
  if (!r) {
    const ev = EVENT_BY_KEY[key];
    r = simulateCycle(id, { ...DEFAULT_CYCLE, months: HISTORY_MONTHS, seed: HISTORY_SEED, bunker: HIST.bunker, growth: GROWTH[id], events: HISTORY_EVENTS.filter((e) => e !== ev) });
    WITHOUT.set(k, r);
  }
  return r;
}

/** Change in a class's average earnings during a disruption, as a share of what they'd have been. */
export function eventEffect(id: ClassId, key: Exclude<EventKey, 'none'>): number {
  const ev = EVENT_BY_KEY[key];
  const w = historyWithout(id, key).slice(ev.from, ev.to).map((m) => m.tce);
  const h = HIST.cls[id].slice(ev.from, ev.to).map((m) => m.tce);
  return avg(h) / avg(w) - 1;
}

export function correlation(a: number[], b: number[]): number {
  const ma = avg(a);
  const mb = avg(b);
  let sab = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(sa * sb);
}

const K_TCE = HIST.cls.kmax.map((m) => m.tce);
const C_TCE = HIST.cls.cape.map((m) => m.tce);
const annualOf = (xs: number[]) => Array.from({ length: xs.length / 12 }, (_, y) => avg(xs.slice(y * 12, y * 12 + 12)));
const CORR_MONTH = correlation(K_TCE, C_TCE);
const CORR_YEAR = correlation(annualOf(K_TCE), annualOf(C_TCE));
const BRAZIL_AFTER = (() => {
  const ev = EVENT_BY_KEY.brazil;
  const w = historyWithout('cape', 'brazil').slice(ev.to, ev.to + 12).map((m) => m.tce);
  const h = HIST.cls.cape.slice(ev.to, ev.to + 12).map((m) => m.tce);
  return avg(h) - avg(w);
})();

// ---------------------------------------------------------------------------

const perDay = (x: number) => `$${fmt(x)}/day`;
const yearX = (v: number) => (v === 0 ? 'Year 1' : v === YEARS ? 'end' : `Year ${v + 1}`);
const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${pct(Math.abs(x), 1)}`;
const listYears = (ys: number[]) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}` : String(ys[0] ?? '—'));

export default function Lesson() {
  const sc = useScenario('cycle', START);
  const s = sc.state;
  const run = runCycle(s);
  const xs = useMemo(() => run.months.map((m) => m.t / 12), [run]);
  const baseXs = useMemo(() => BASE.months.map((m) => m.t / 12), []);
  const moved = JSON.stringify(s) !== JSON.stringify(START);
  const solved = swingHalvedSolved(s);
  const othersAtStart = s.congestion === 'none' && same(s.orderResponse, START.orderResponse) && same(s.scrapResponse, START.scrapResponse) && same(s.growth, START.growth) && same(s.shock, START.shock);

  const hs = useScenario('two-classes', { remove: 'none' as EventKey });
  const removed = hs.state.remove;
  const counter = useMemo(() => (removed === 'none' ? null : { kmax: historyWithout('kmax', removed), cape: historyWithout('cape', removed) }), [removed]);
  const hx = useMemo(() => HIST.cls.kmax.map((m) => m.t / 12), []);
  const effects = useMemo(
    () =>
      (['china', 'brazil', 'panama'] as const).map((k) => ({
        key: k,
        ev: EVENT_BY_KEY[k],
        cape: eventEffect('cape', k),
        kmax: eventEffect('kmax', k),
      })),
    [],
  );
  const bands = HISTORY_EVENTS.map((e, i) => ({
    from: e.from / 12,
    to: e.to / 12,
    color: tint(GRAPHIC.red, removed !== 'none' && EVENT_BY_KEY[removed] === e ? 0.35 : 0.18),
    label: SHORT[(['china', 'brazil', 'panama'] as const)[i]],
  }));

  return (
    <LessonPage id="shipping/4.4">
      <P>
        The <a href={lessonHref('shipping/4.1')}>Freight Clearing Engine</a> set a freight rate for one moment: the fleet as it stood, the cargoes as they were
        waiting. Run that moment month after month and the rate becomes a history, and <a href={lessonHref('shipping/4.3')}>the indices of the previous lesson</a>{' '}
        show what kind: not a level with noise around it, but long waves, booms and slumps several years apart.{' '}
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> used that history to time an investment and promised that this chapter would open up the model behind it.
        This lesson does. Why do freight rates move in cycles years long, when the cargoes that drive them change month by month?
      </P>
      <P>
        The model does three things every month. First, the market clears, exactly as in Lesson 4.1: the month’s cargoes against the ships that exist, with idle
        ships coming back and every ship choosing her speed. Second, owners decide whether to order. As in Lesson 2.5, they compare what a new ship would be worth —
        the earnings they expect over her life, leaning on the past year — with what a shipyard charges, and the further the first is above the second, the more
        they order. The ships arrive after the <K tone="teal">shipyard lag</K>. Third, when earnings fall below what old ships cost to run, the oldest go to the
        breakers. Nothing else moves the fleet.
      </P>
      <P>
        In the next demonstration, the model runs fifteen years of the Kamsarmax market. Cargo grows each year and is hit by the same random shocks as the
        course’s history, but without its disruptions and with bunkers held at an illustrative $600 a tonne. The dashed lines are the run with the starting
        settings. Change how eagerly owners order, how long shipyards take, how readily old ships are scrapped, how fast trade grows and how big its shocks are,
        and try adding a spell of congestion at Qingdao:
      </P>

      <Figure name="Shipping Cycle Model" scenario={sc}>
        <Segmented
          label="Congestion"
          value={s.congestion}
          onChange={(v) => sc.set({ congestion: v })}
          options={[
            { value: 'none', label: 'No disruption' },
            { value: 'qingdao', label: 'Four days’ wait at Qingdao, early Year 6' },
          ]}
        />
        <XYChart
          ariaLabel={`Kamsarmax earnings, month by month, over fifteen simulated years. The best year averages ${perDay(run.best)} (Year ${run.bestYear}), the worst ${perDay(run.worst)} (Year ${run.worstYear}).`}
          series={[
            ...(moved ? [{ xs: baseXs, ys: BASE.months.map((m) => m.tce), color: '#9a9a9a', width: 1.5, dash: '4 3' }] : []),
            { xs, ys: run.months.map((m) => m.tce), color: GRAPHIC.green, width: 2 },
          ]}
          bands={s.congestion === 'qingdao' ? [{ from: CONGESTION.from / 12, to: CONGESTION.to / 12, color: tint(GRAPHIC.red, 0.2), label: 'congestion' }] : []}
          xMin={0}
          xMax={YEARS}
          yMin={0}
          xTicks={[0, 3, 6, 9, 12, 15]}
          xFormat={yearX}
          yFormat={(v) => `$${fmt(v / 1000)}k`}
          yLabel="Earnings, $ per day (TCE)"
          height={170}
        />
        <XYChart
          ariaLabel={`The fleet grows ${pct(run.fleetGrowth)} over fifteen years while cargo grows ${pct(run.cargoGrowth)}.`}
          series={[
            { xs, ys: run.months.map((m) => (100 * m.demand) / run.months[0].demand), color: TEXT.ink, width: 1.5, label: 'cargo', labelColor: TEXT.ink },
            { xs, ys: run.months.map((m) => (100 * m.fleet) / run.months[0].fleet), color: GRAPHIC.teal, width: 2.5, label: 'fleet', labelColor: TEXT.teal },
          ]}
          xMin={0}
          xMax={YEARS}
          xTicks={[0, 3, 6, 9, 12, 15]}
          xFormat={yearX}
          yFormat={(v) => fmt(v)}
          yLabel="Fleet and cargo, start = 100"
          height={120}
        />
        <XYChart
          ariaLabel={`Ships on order as a share of the fleet, at most ${pct(Math.max(...run.months.map((m) => m.orderbook / m.fleet)))}.`}
          series={[{ xs, ys: run.months.map((m) => (100 * m.orderbook) / m.fleet), color: GRAPHIC.teal, width: 1.5, fillTo: 0, fillOpacity: 0.2 }]}
          xMin={0}
          xMax={YEARS}
          yMin={0}
          xTicks={[0, 3, 6, 9, 12, 15]}
          xFormat={yearX}
          yFormat={(v) => `${fmt(v)}%`}
          yLabel="Orderbook, share of the fleet"
          height={104}
        />
        <Readouts
          items={[
            { label: `best year, Year ${run.bestYear}`, value: perDay(run.best), tone: 'green' },
            { label: `worst year, Year ${run.worstYear}`, value: perDay(run.worst), tone: 'green' },
            { label: 'years between peaks', value: Number.isFinite(run.spacing) ? fmt(run.spacing, 1) : '—', tone: 'teal' },
            { label: 'fleet growth · cargo growth', value: `${pct(run.fleetGrowth)} · ${pct(run.cargoGrowth)}` },
          ]}
        />
        <Slider label="Owners’ ordering response" value={s.orderResponse} min={0.01} max={0.15} step={0.01} onChange={(v) => sc.set({ orderResponse: v })} display={fmt(s.orderResponse, 2)} />
        <Slider label="Shipyard lag" tone="teal" value={s.lag} min={6} max={48} onChange={(v) => sc.set({ lag: v })} display={`${s.lag} months`} />
        <Slider label="Scrapping response" value={s.scrapResponse} min={0} max={0.06} step={0.005} onChange={(v) => sc.set({ scrapResponse: v })} display={fmt(s.scrapResponse, 3)} />
        <Slider label="Trade growth" tone="orange" value={s.growth} min={0} max={0.06} step={0.005} onChange={(v) => sc.set({ growth: v })} display={`${fmt(s.growth * 100, 1)}% a year`} />
        <Slider label="Size of demand shocks" tone="orange" value={s.shock} min={0} max={0.12} step={0.01} onChange={(v) => sc.set({ shock: v })} display={pct(s.shock)} />
        <Caption>
          {run.peaks.length
            ? `Earnings peak in Year${run.peaks.length > 1 ? 's' : ''} ${listYears(run.peaks)}; the gap between the best and worst years is ${perDay(run.gap)}${moved ? `, against ${perDay(BASE.gap)} at the start` : ''}.`
            : `No year stands above its neighbors on both sides; the gap between the best and worst years is ${perDay(run.gap)}.`}
        </Caption>
      </Figure>

      <P>
        At the starting settings, earnings peak in Years {listYears(BASE.peaks)}: waves about {fmt(BASE.spacing, 1)} years apart, from{' '}
        {perDay(BASE.worst)} in the worst year to {perDay(BASE.best)} in the best. Follow the first one through all three charts. Cargo jumps in Year 2, earnings
        climb, and in Year {FIRST_PEAK} owners order {fmt(ORDERS_PEAK)} ships, until the orderbook reaches {pct(FIRST_BOOK)} of the fleet. None of those ships
        can carry anything yet. They arrive {DEFAULT_CYCLE.lag} months later — {fmt(DELIVERIES_TROUGH)} of them in Years {TROUGH - 1} and {TROUGH} — just as the
        cargo boom has faded, and earnings fall to their low of {perDay(BASE.annual[TROUGH - 1])} in Year {TROUGH}. Then the loop runs the other way: nobody
        orders, old ships go for scrap, cargo keeps growing, and the shortage that follows starts the next wave.
      </P>
      <P>
        Notice what starts a wave and what sustains it. The demand shocks start them: set their size to zero and the gap between the best and worst years shrinks
        to {perDay(CALM.gap)}. But the shocks are random and short-lived, and the waves are not. What turns a burst of cargo into a cycle years long is that the
        response to it — ships — takes years to arrive and decades to leave.
      </P>

      <H2>The lag makes the waves</H2>
      <P>
        Drag the shipyard lag. Every month an owner waits for a ship is a month in which the signal that made her order it can change, and every owner waits
        together. With a long lag, the fleet answers the market of two or three years ago; with a short one, it answers today’s. Short lags also keep order books
        thin, and shipyards with thin order books charge less, so in the model ships get ordered at lower earnings and the market settles lower as well as
        calmer.
      </P>

      <Challenge
        id="a"
        question="Keep every other setting where it starts. How quickly would shipyards have to deliver for the gap between the best and worst years’ average earnings to be less than half as wide as it is with a 30-month lag?"
        solved={solved}
        status={
          !othersAtStart
            ? 'Put the other sliders back where they started and switch congestion off: only the shipyard lag should change.'
            : `With a ${s.lag}-month lag the gap is ${perDay(run.gap)}, ${pct(run.gap / BASE.gap)} of the starting ${perDay(BASE.gap)}.`
        }
        success={`Solved. Any lag from ${SOLVED_LAGS[0]} to ${SOLVED_LAGS[SOLVED_LAGS.length - 1]} months halves the swing: at ${SOLVED_LAGS[SOLVED_LAGS.length - 1]} months the best year averages ${perDay(LAG_FAST.best)} and the worst ${perDay(LAG_FAST.worst)}, a gap of ${perDay(LAG_FAST.gap)}. In the real industry a ship ordered in a strong market typically arrives two or three years later, because shipyards’ berths are booked well ahead — so the lag, and the cycle it drives, is built into the business.`}
      />

      <P>
        Owners’ eagerness matters too, though less simply. Turn the ordering response down to 0.01 and the fleet can’t keep up: over fifteen years it grows{' '}
        {pct(TIMID.fleetGrowth)} while cargo grows {pct(TIMID.cargoGrowth)}, and the best year averages {perDay(TIMID.best)}. Turn it up to 0.15 and owners
        overshoot instead: the fleet grows {pct(EAGER.fleetGrowth)}, and the worst year sinks to {perDay(EAGER.worst)}. Scrapping works at the other end, but
        only once earnings fall below what old ships cost to run. At the starting settings that rarely happens, so the scrapping response barely moves anything;
        with eager owners ordering at 0.15, raising it from 0 to 0.06 lifts the worst year from {perDay(EAGER_NO_SCRAP.worst)} to {perDay(EAGER_SCRAP.worst)}.
        And a disruption tightens supply at a stroke. Add the congestion at Qingdao: for six
        months every call there loses four days, earnings in those months average {perDay(CONG_DURING)} instead of {perDay(BASE_DURING)}, and owners respond by
        ordering {fmt(CONG_ORDERS)} ships in Year 6 instead of {fmt(BASE_ORDERS6)} — ships that arrive long after the queue has cleared.
      </P>

      <H2>Short spikes, long troughs</H2>
      <P>
        Look at the shape of the waves. The peaks are sharp and the troughs are broad and flat. That comes from the supply curve of Lesson 4.1. With cargo 10%
        below its baseline, the Kamsarmax market clears at {perDay(EQ.down)}; at the baseline, {perDay(EQ.base)}; 10% above, {perDay(EQ.up)}. A surplus is
        absorbed by ships slowing down a little, which costs them little; a shortage has to be met by ships going much faster, and only much higher earnings
        make that fuel worth burning. In the starting run, earnings spend {HIGH_MONTHS} of {MONTHLY.length} months more than half again above their median of{' '}
        {perDay(MEDIAN)}, and only {LOW_MONTHS} months below two-thirds of it. The best month, at {perDay(PEAK_MONTH.tce)}, has ships steaming at{' '}
        {fmt(PEAK_MONTH.ladenSpeed, 1)} knots laden; the worst, at {perDay(LOW_MONTH.tce)}, at {fmt(LOW_MONTH.ladenSpeed, 1)}. The average,{' '}
        {perDay(MEAN)}, sits well above the typical month, because a few spikes carry it.
      </P>
      <P>
        All of this is a stylized model, not a forecast. Real markets add things it leaves out: shipyards whose capacity itself grows and shrinks, owners who
        expect more than the past year, banks that lend freely in booms and not at all in slumps. But the mechanics are real ones. Ships take years to order and
        build, order books swell after strong markets, and deliveries arrive whatever the market is doing when they come. After the long dry bulk boom that ended
        in 2008, the ships ordered at its height went on arriving for years, and earnings stayed low for much of the following decade.
      </P>

      <H2>Two classes, one wave</H2>
      <P>
        The course’s history was produced by this same model, with its disruptions and a wandering bunker price, for both size classes at once. The two markets
        share their demand shocks, because the same economies buy the ore, coal and grain, but each has its own fleet, trades and lags. In the next
        demonstration, both classes’ earnings run side by side through the twelve years, with the three disruptions shaded. Remove one to see the history as it
        would have been without it:
      </P>

      <Figure name="Shipping Cycle Model · Capesize and Kamsarmax" scenario={hs}>
        <Segmented
          label="Remove a disruption"
          value={removed}
          onChange={(v) => hs.set({ remove: v })}
          options={[
            { value: 'none', label: 'The history as it was' },
            { value: 'china', label: 'Without the congestion' },
            { value: 'brazil', label: 'Without the ore disruption' },
            { value: 'panama', label: 'Without the drought' },
          ]}
        />
        <Legend
          items={[
            { label: 'Capesize', color: GRAPHIC.violet, kind: 'line' },
            { label: 'Kamsarmax', color: GRAPHIC.green, kind: 'line' },
            ...(counter ? [{ label: 'Without the disruption', color: '#9a9a9a', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <XYChart
          ariaLabel={`Monthly earnings of Capesizes and Kamsarmaxes over the twelve simulated years of the history. Their monthly correlation is ${fmt(CORR_MONTH, 2)}.${counter ? ` Dashed: the history without ${EVENT_BY_KEY[removed as Exclude<EventKey, 'none'>].label.replace(/^./, (c) => c.toLowerCase())}.` : ''}`}
          series={[
            ...(counter
              ? [
                  { xs: hx, ys: counter.cape.map((m) => m.tce), color: tint(GRAPHIC.violet, 0.6), width: 1.5, dash: '4 3' },
                  { xs: hx, ys: counter.kmax.map((m) => m.tce), color: tint(GRAPHIC.green, 0.6), width: 1.5, dash: '4 3' },
                ]
              : []),
            { xs: hx, ys: C_TCE, color: GRAPHIC.violet, width: 2 },
            { xs: hx, ys: K_TCE, color: GRAPHIC.green, width: 2 },
          ]}
          bands={bands}
          xMin={0}
          xMax={HISTORY_MONTHS / 12}
          yMin={0}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 0 ? 'Year 1' : v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v / 1000)}k`}
          yLabel="Earnings, $ per day (TCE)"
          height={200}
        />
        <DataTable
          caption="How much each disruption changed average earnings while it lasted"
          rows={effects}
          rowKey={(r) => r.key}
          rowClass={(r) => (r.key === removed ? 'hl' : '')}
          columns={[
            { label: 'Disruption', cell: (r) => r.ev.label },
            { label: 'Months', cell: (r) => `${r.ev.from + 1}–${r.ev.to}`, align: 'right' },
            { label: 'Capesize', cell: (r) => signedPct(r.cape), align: 'right' },
            { label: 'Kamsarmax', cell: (r) => signedPct(r.kmax), align: 'right' },
          ]}
        />
        <Readouts
          items={[
            { label: 'correlation of monthly earnings', value: fmt(CORR_MONTH, 2) },
            { label: 'correlation of yearly averages', value: fmt(CORR_YEAR, 2) },
          ]}
        />
      </Figure>

      <P>
        Month by month the two classes’ earnings have a correlation of {fmt(CORR_MONTH, 2)}; year by year, {fmt(CORR_YEAR, 2)}. They rise and fall together
        because the cycle is driven by the same cargo, the same shipyards and the same owners’ moods. The months are noisier because the classes carry
        different trades with different seasons — Brazilian soybeans from March to July for the Kamsarmaxes, iron ore that slows in Brazil’s rainy season early
        in the year for the Capesizes.
      </P>
      <P>
        The disruptions pull them apart. Congestion in China raises both, by {signedPct(effects[0].cape)} for Capesizes and {signedPct(effects[0].kmax)} for
        Kamsarmaxes, because both queue there. The disruption at Brazil’s ore mines touches only Capesizes, which carry the ore: {signedPct(effects[1].cape)}{' '}
        while it lasts. It also leaves a mark afterward. The slump sends old Capesizes to the breakers, and in the twelve months after the mines recover,
        Capesizes earn {perDay(BRAZIL_AFTER)} more than they would have. The Panama drought touches only Kamsarmaxes, whose grain from the US Gulf has to go the
        long way round: {signedPct(effects[2].kmax)}. Trades are the market’s wiring. Switch disruptions off in <FigRef to="Shipping Cycle Model · Capesize and Kamsarmax">this
        demonstration</FigRef> and watch which line moves.
      </P>
      <P>
        Cycles like these are why anyone who owns ships, or needs them, worries about next year’s rate as much as today’s. An owner with a ship coming open in six
        months doesn’t know what she will earn; a charterer with cargo to move next spring doesn’t know what it will cost. Both can agree a price for that future
        month today, without either touching a ship. <a href={lessonHref('shipping/4.5')}>The next lesson</a> shows how: forward freight agreements, settled
        against the index.
      </P>
    </LessonPage>
  );
}
