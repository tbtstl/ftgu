import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
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
import { HISTORY_EVENTS, HISTORY_MONTHS, HISTORY_SEED, monthLabel, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The first demonstration: fifteen years of the Kamsarmax market from the history's demand shocks,
// with no disruptions and a steady bunker price.

/** The congestion episode the reader can add: four extra days at Qingdao in the first half of Year 6. */
export const CONGESTION: CycleEvent = { from: 60, to: 66, label: 'Port congestion in China', congestion: { QIN: 4 } };
/** The single surge the reader can swap the random shocks for: cargo 20% above its trend for the twelve months from July of Year 1. */
export const SURGE: CycleEvent = { from: 6, to: 18, label: 'Cargo surge', demand: 1.2 };

export interface CycleState {
  orderResponse: number;
  lag: number;
  scrapResponse: number;
  growth: number;
  shock: number;
  congestion: 'none' | 'qingdao';
  /** Cargo moved by the history's random shocks, or by one surge in Year 2 with no shocks at all. */
  cargo: 'shocks' | 'surge';
}

export const START: CycleState = {
  orderResponse: DEFAULT_CYCLE.orderResponse,
  lag: DEFAULT_CYCLE.lag,
  scrapResponse: DEFAULT_CYCLE.scrapResponse,
  growth: DEFAULT_CYCLE.growth,
  shock: DEFAULT_CYCLE.shock,
  congestion: 'none',
  cargo: 'shocks',
};
/** The surge run at the starting settings. */
export const SURGE_START: CycleState = { ...START, cargo: 'surge' };

const YEARS = DEFAULT_CYCLE.months / 12;

export function paramsOf(s: CycleState): CycleParams {
  return {
    ...DEFAULT_CYCLE,
    seed: HISTORY_SEED,
    orderResponse: s.orderResponse,
    lag: s.lag,
    scrapResponse: s.scrapResponse,
    growth: s.growth,
    shock: s.cargo === 'surge' ? 0 : s.shock,
    events: [...(s.cargo === 'surge' ? [SURGE] : []), ...(s.congestion === 'qingdao' ? [CONGESTION] : [])],
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
  /** The month with the most deliveries, and the month with the most orders. */
  deliveryPeak: number;
  orderPeak: number;
  /** Average monthly earnings over the run, $/day. */
  mean: number;
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
    deliveryPeak: months.reduce((b, m, i) => (m.deliveries > months[b].deliveries ? i : b), 0),
    orderPeak: months.reduce((b, m, i) => (m.orders > months[b].orders ? i : b), 0),
    mean: avg(months.map((m) => m.tce)),
  };
}

const CACHE = new Map<string, CycleStats>();

/** The settings that matter: with the single surge, the shock slider does nothing. */
const keyOf = (s: CycleState) => JSON.stringify({ ...s, shock: s.cargo === 'surge' ? 0 : s.shock });

/** The model's run for a set of slider positions (memoized). */
export function runCycle(s: CycleState): CycleStats {
  const key = keyOf(s);
  let r = CACHE.get(key);
  if (!r) {
    r = cycleStats(simulateCycle('kmax', paramsOf(s)));
    if (CACHE.size > 300) CACHE.clear();
    CACHE.set(key, r);
  }
  return r;
}

export const BASE = runCycle(START);
export const SURGE_BASE = runCycle(SURGE_START);

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The year the challenge asks the slump after the surge to land in. */
export const TARGET_YEAR = 6;

/** Every setting but the lag (and the shocks, which the surge switches off) where it starts, and no congestion. */
export function othersAtStart(s: CycleState): boolean {
  return s.congestion === 'none' && same(s.orderResponse, START.orderResponse) && same(s.scrapResponse, START.scrapResponse) && same(s.growth, START.growth);
}

/**
 * The challenge: with the single surge, every other setting at its start and no congestion, a shipyard
 * lag that puts the worst year in Year 6 (31–41 months).
 */
export function slumpTimedSolved(s: CycleState): boolean {
  return s.cargo === 'surge' && othersAtStart(s) && runCycle(s).worstYear === TARGET_YEAR;
}

// Numbers for the prose, all from the model.
const yearOf = (st: CycleStats, y: number, f: (m: CycleMonth) => number) => st.months.slice((y - 1) * 12, y * 12).reduce((s, m) => s + f(m), 0);
const FIRST_PEAK = BASE.peaks[0];
const FIRST_BOOK = Math.max(...[1, 2, 3, 4].map((y) => BASE.months[y * 12 - 1].orderbook / BASE.months[y * 12 - 1].fleet));
const TROUGH = BASE.annual.slice(FIRST_PEAK, FIRST_PEAK + 5).reduce((w, v, i) => (v < BASE.annual[w - 1] ? FIRST_PEAK + i + 1 : w), FIRST_PEAK + 1);
const DELIVERIES_TROUGH = yearOf(BASE, TROUGH - 1, (m) => m.deliveries) + yearOf(BASE, TROUGH, (m) => m.deliveries);
const ORDERS_PEAK = yearOf(BASE, FIRST_PEAK, (m) => m.orders);
const demandOf = (st: CycleStats, y: number) => yearOf(st, y, (m) => m.demand) / 12;
const fleetAtEnd = (st: CycleStats, y: number) => st.months[y * 12 - 1].fleet;
/** After the first peak: the year with the fewest orders, and how flat cargo stays until the trough. */
export const ORDERS_LOW_YEAR = Array.from({ length: TROUGH - FIRST_PEAK }, (_, i) => FIRST_PEAK + 1 + i).reduce((b, y) =>
  yearOf(BASE, y, (m) => m.orders) < yearOf(BASE, b, (m) => m.orders) ? y : b,
);
const ORDERS_LOW = yearOf(BASE, ORDERS_LOW_YEAR, (m) => m.orders);
const PEAK_TO_TROUGH = Array.from({ length: TROUGH - FIRST_PEAK + 1 }, (_, i) => demandOf(BASE, FIRST_PEAK + i));
export const CARGO_FLAT = Math.max(...PEAK_TO_TROUGH) / Math.min(...PEAK_TO_TROUGH) - 1;
export const BOOM_DROP = 1 - BASE.annual[TROUGH - 1] / BASE.annual[FIRST_PEAK - 1];
/** The year after the trough: cargo jumps, and the fleet barely grows. */
export const NEXT_JUMP = { year: TROUGH + 1, cargo: demandOf(BASE, TROUGH + 1) / demandOf(BASE, TROUGH) - 1, fleet: fleetAtEnd(BASE, TROUGH + 1) / fleetAtEnd(BASE, TROUGH) - 1 };
// The sliders' units: orders a month at a 10% gap between a new ship's value and her price, and extra
// scrapping a month when six months' earnings sit a quarter below the scrapping line (cycle.ts: the
// response times the shortfall's share times 4).
export const ORDERS_AT_10 = START.orderResponse * 0.1;
export const SCRAP_AT_QUARTER = START.scrapResponse * 0.25 * 4;
// The single surge.
export const SOLVED_LAGS = Array.from({ length: 43 }, (_, i) => i + 6).filter((lag) => slumpTimedSolved({ ...SURGE_START, lag }));
const surgeMonths = (st: CycleStats, from: number, to: number) => st.months.slice(from, to);
/** Ships ordered while the surge lasts, and earnings while it lasts, in the six months before it and in the twelve after it. */
export const SURGE_ORDERS = surgeMonths(SURGE_BASE, SURGE.from, SURGE.to).reduce((s, m) => s + m.orders, 0);
export const SURGE_TCE = avg(surgeMonths(SURGE_BASE, SURGE.from, SURGE.to).map((m) => m.tce));
const PRE_SURGE_TCE = avg(surgeMonths(SURGE_BASE, 0, SURGE.from).map((m) => m.tce));
const POST_SURGE_TCE = avg(surgeMonths(SURGE_BASE, SURGE.to, SURGE.to + 12).map((m) => m.tce));
export const SURGE_YEAR_LAG = runCycle({ ...SURGE_START, lag: 12 });
export const SURGE_FOUR_YEARS = runCycle({ ...SURGE_START, lag: 48 });
// With the random shocks: a short lag against the starting one, and trade growth.
export const LAG6 = runCycle({ ...START, lag: 6 });
export const NO_GROWTH = runCycle({ ...START, growth: 0 });
export const FAST_GROWTH = runCycle({ ...START, growth: 0.06 });
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
/** A month of the run as prose: "March of Year 5". */
const whenLabel = (t: number) => monthLabel(t).split(', ').reverse().join(' of ');
const listYears = (ys: number[]) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}` : String(ys[0] ?? '—'));

export default function Lesson() {
  const sc = useScenario('cycle', START);
  const s = sc.state;
  const run = runCycle(s);
  const surge = s.cargo === 'surge';
  const ref = surge ? SURGE_BASE : BASE;
  const xs = useMemo(() => run.months.map((m) => m.t / 12), [run]);
  const baseXs = useMemo(() => BASE.months.map((m) => m.t / 12), []);
  const moved = keyOf(s) !== keyOf(surge ? SURGE_START : START);
  const solved = slumpTimedSolved(s);
  const others = othersAtStart(s);

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
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> timed an investment in that history; this lesson opens up the model behind it. Why do freight rates move in cycles years long, when the cargoes that drive them change month by month?
      </P>
      <P>
        The model does three things every month. First, the market clears, exactly as in <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>: the month’s
        cargoes against the ships that exist, with laid-up ships coming back and every ship choosing her speed. Second, owners decide whether to order. They
        compare what a new ship would be worth — the earnings they expect over her life, leaning on
        the past year — with what a shipyard charges, and the further the first is above the second, the more they order. How hard they lean in is the{' '}
        <b>ordering response</b>: at the starting {fmt(START.orderResponse, 2)}, a new ship worth 10% more than her price brings orders for{' '}
        {pct(ORDERS_AT_10, 1)} of the fleet each month. The ships arrive after the shipyard lag of{' '}
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a>. Third, old ships go to the breakers: all of
        them at 28 years, a trickle of those 18 and over, and more when earnings fall below what old ships cost to run. The <b>scrapping response</b> sets how
        many more: at the starting {fmt(START.scrapResponse, 3)}, an extra {pct(SCRAP_AT_QUARTER)} of the ships 18 and over each month once the past six
        months’ earnings sit a quarter below that cost. Nothing else moves the fleet.
      </P>
      <P>
        In the next demonstration, the model runs fifteen years of the Kamsarmax market. Cargo grows each year and is hit by the same random shocks as the
        course’s history, but without its disruptions and with bunkers held at an illustrative $600 a tonne. The dashed line is the run with the starting
        settings, for the same cargo. Change the sliders, swap the shocks for a single surge of cargo, or add a spell of congestion at Qingdao:
      </P>

      <Figure name="Shipping Cycle Model" scenario={sc}>
        <Segmented
          label="Cargo"
          value={s.cargo}
          onChange={(v) => sc.set({ cargo: v })}
          options={[
            { value: 'shocks', label: 'Random shocks' },
            { value: 'surge', label: 'One twelve-month surge, no shocks' },
          ]}
        />
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
            ...(moved ? [{ xs: baseXs, ys: ref.months.map((m) => m.tce), color: '#9a9a9a', width: 1.5, dash: '4 3' }] : []),
            { xs, ys: run.months.map((m) => m.tce), color: GRAPHIC.green, width: 2 },
          ]}
          bands={[
            ...(surge ? [{ from: SURGE.from / 12, to: SURGE.to / 12, color: tint(GRAPHIC.orange, 0.2), label: 'surge' }] : []),
            ...(s.congestion === 'qingdao' ? [{ from: CONGESTION.from / 12, to: CONGESTION.to / 12, color: tint(GRAPHIC.red, 0.2), label: 'congestion' }] : []),
          ]}
          xMin={0}
          xMax={YEARS}
          yMin={0}
          xTicks={[0, 3, 6, 9, 12, 15]}
          xFormat={yearX}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
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
            surge
              ? { label: 'deliveries peak', value: monthLabel(run.deliveryPeak), tone: 'teal' }
              : { label: 'years between peaks', value: Number.isFinite(run.spacing) ? fmt(run.spacing, 1) : '—', tone: 'teal' },
            { label: 'fleet growth · cargo growth', value: `${pct(run.fleetGrowth)} · ${pct(run.cargoGrowth)}` },
          ]}
        />
        <Slider label="Owners’ ordering response" value={s.orderResponse} min={0.01} max={0.15} step={0.01} onChange={(v) => sc.set({ orderResponse: v })} display={fmt(s.orderResponse, 2)} />
        <Slider label="Shipyard lag" tone="teal" value={s.lag} min={6} max={48} onChange={(v) => sc.set({ lag: v })} display={`${s.lag} months`} />
        <Slider label="Scrapping response" value={s.scrapResponse} min={0} max={0.06} step={0.005} onChange={(v) => sc.set({ scrapResponse: v })} display={fmt(s.scrapResponse, 3)} />
        <Slider label="Trade growth" tone="orange" value={s.growth} min={0} max={0.06} step={0.005} onChange={(v) => sc.set({ growth: v })} display={`${fmt(s.growth * 100, 1)}% a year`} />
        <Slider
          label="Size of demand shocks"
          tone="orange"
          value={s.shock}
          min={0}
          max={0.12}
          step={0.01}
          onChange={(v) => sc.set({ shock: v })}
          display={surge ? 'none' : pct(s.shock)}
          disabled={surge}
        />
        <Caption>
          {surge
            ? `The surge’s ships arrive ${s.lag} months after they’re ordered: deliveries peak in ${whenLabel(run.deliveryPeak)}, and the worst year is Year ${run.worstYear}, at ${perDay(run.worst)}${moved ? `, against Year ${SURGE_BASE.worstYear} with the starting settings` : ''}.`
            : run.peaks.length
              ? `Earnings peak in Year${run.peaks.length > 1 ? 's' : ''} ${listYears(run.peaks)}; the gap between the best and worst years is ${perDay(run.gap)}${moved ? `, against ${perDay(BASE.gap)} at the start` : ''}.`
              : `No year stands above its neighbors on both sides; the gap between the best and worst years is ${perDay(run.gap)}.`}
        </Caption>
      </Figure>

      <P>
        At the starting settings, earnings peak in Years {listYears(BASE.peaks)}: waves about {fmt(BASE.spacing, 1)} years apart, from{' '}
        {perDay(BASE.worst)} in the worst year to {perDay(BASE.best)} in the best. Follow the first one through all three charts. Cargo jumps in Year 2, earnings
        climb, and in Year {FIRST_PEAK} owners order {fmt(ORDERS_PEAK)} ships, until the orderbook reaches {pct(FIRST_BOOK)} of the fleet. They arrive {DEFAULT_CYCLE.lag} months later — {fmt(DELIVERIES_TROUGH)} of them in Years {TROUGH - 1} and {TROUGH} — just as the
        cargo boom has faded, and earnings fall to their low of {perDay(BASE.annual[TROUGH - 1])} in Year {TROUGH}. Then the loop runs the other way. Orders
        fall to {fmt(ORDERS_LOW)} ships in Year {ORDERS_LOW_YEAR}, so few new ships follow the boom’s, and when cargo jumps {pct(NEXT_JUMP.cargo)} in Year{' '}
        {NEXT_JUMP.year}, the fleet grows by only {pct(NEXT_JUMP.fleet, 1)}: the shortage that follows starts the next wave.
      </P>
      <P>
        The demand shocks start the waves: set their size to zero and the gap between the best and worst years shrinks to {perDay(CALM.gap)}. But from Year{' '}
        {FIRST_PEAK} to Year {TROUGH} cargo moves within {pct(CARGO_FLAT, 1)}, and earnings still fall by {pct(BOOM_DROP)}: what ends the boom is the ships it
        ordered, arriving. Ships take years to arrive and decades to leave, so every boom carries the seed of a slump.
      </P>

      <H2>The lag times the slump</H2>
      <P>
        With random shocks starting new waves all the time, the lag’s own effect is hard to see: drag it, and the peaks stay where the shocks put them. So
        switch the cargo to a single surge: no shocks, just cargo {pct(SURGE.demand! - 1)} above its trend for twelve months from {whenLabel(SURGE.from)}.
        Earnings average {perDay(SURGE_TCE)} while it lasts, against {perDay(PRE_SURGE_TCE)} in the six months before, and owners order {fmt(SURGE_ORDERS)} ships, most heavily
        at its end. When it ends, earnings fall back to {perDay(POST_SURGE_TCE)} over the next year. Then the surge’s ships arrive, deliveries peaking
        in {whenLabel(SURGE_BASE.deliveryPeak)}, into a market that no longer needs them, and earnings sink to {perDay(SURGE_BASE.worst)} in Year{' '}
        {SURGE_BASE.worstYear}.
      </P>
      <P>
        Now drag the shipyard lag, and the slump moves with it. With shipyards delivering in a year, the worst year is Year {SURGE_YEAR_LAG.worstYear}; with
        four years, it is Year {SURGE_FOUR_YEARS.worstYear}. Every month an owner waits for a ship is a month in which the signal that made her order it can
        change, and every owner waits together. With a long lag, the fleet answers the market of two or three years ago; with a short one, it answers today’s.
      </P>
      <P>
        With random shocks the lag doesn’t move the peaks, which the shocks decide, but it changes how far earnings swing and where they settle. With a six-month
        lag the best year averages {fmt(LAG6.best / LAG6.worst, 1)} times the worst, against {fmt(BASE.best / BASE.worst, 1)} at 30 months, and earnings
        average {perDay(LAG6.mean)} over the fifteen years instead of {perDay(BASE.mean)}: short lags keep order books thin, shipyards with thin order books
        charge less, and cheaper ships get ordered at lower earnings.
      </P>

      <Challenge
        id="a"
        question={`Predict first: with the single surge, a ${START.lag}-month lag puts the worst year in Year ${SURGE_BASE.worstYear}, a one-year lag in Year ${SURGE_YEAR_LAG.worstYear} and a four-year lag in Year ${SURGE_FOUR_YEARS.worstYear}. How long would shipyards have to take for the worst year to come in Year ${TARGET_YEAR}? Then switch the cargo to the surge, keep every other setting where it starts, and set that lag.`}
        solved={solved}
        status={
          !surge
            ? 'Switch the cargo to the single surge first.'
            : !others
              ? 'Put the other sliders back where they started and switch congestion off: only the shipyard lag should change.'
              : `With a ${s.lag}-month lag, deliveries peak in ${whenLabel(run.deliveryPeak)} and the worst year is Year ${run.worstYear}.`
        }
        success={`Solved. With a ${s.lag}-month lag the worst year is Year ${TARGET_YEAR}, and any lag from ${SOLVED_LAGS[0]} to ${SOLVED_LAGS[SOLVED_LAGS.length - 1]} months puts it there. Owners order most heavily in ${whenLabel(SURGE_BASE.orderPeak)}, after a year of high earnings; the ships arrive one shipyard lag later, deliveries peaking in ${whenLabel(run.deliveryPeak)}, years after the surge has ended. In the real industry a ship ordered in a strong market typically arrives two or three years later, because shipyards’ berths are booked well ahead — so the lag, and the slump it times, is built into the business.`}
      />

      <P>
        Switch back to random shocks. Owners’ eagerness matters too, though less simply. Turn the ordering response down to 0.01 and the fleet can’t keep up: over fifteen years it grows{' '}
        {pct(TIMID.fleetGrowth)} while cargo grows {pct(TIMID.cargoGrowth)}, and the best year averages {perDay(TIMID.best)}. Turn it up to 0.15 and owners
        overshoot instead: the fleet grows {pct(EAGER.fleetGrowth)}, and the worst year sinks to {perDay(EAGER.worst)}. Scrapping only works once earnings fall
        below what old ships cost to run, which at the starting settings rarely happens; with eager owners ordering at 0.15, raising the scrapping response from
        0 to 0.06 lifts the worst year from {perDay(EAGER_NO_SCRAP.worst)} to {perDay(EAGER_SCRAP.worst)}.
        Trade growth moves the level most of all: with none, earnings average {perDay(NO_GROWTH.mean)} over the fifteen years; at 6% a year,{' '}
        {perDay(FAST_GROWTH.mean)}, because a fast-growing trade keeps order books full, and full order books make ships dear. And a disruption tightens supply at a stroke. Add the congestion at Qingdao: for six
        months every call there loses four days, earnings in those months average {perDay(CONG_DURING)} instead of {perDay(BASE_DURING)}, and owners respond by
        ordering {fmt(CONG_ORDERS)} ships in Year 6 instead of {fmt(BASE_ORDERS6)} — ships that arrive long after the queue has cleared.
      </P>

      <H2>Short spikes, long troughs</H2>
      <P>
        Look at the shape of the waves. The peaks are sharp and the troughs are broad and flat. That comes from the supply curve of <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>. With cargo 10%
        below its baseline, the Kamsarmax market clears at {perDay(EQ.down)}; at the baseline, {perDay(EQ.base)}; 10% above, {perDay(EQ.up)}. A surplus is
        absorbed by ships slowing down a little, which costs them little; a shortage has to be met by ships going much faster, and only much higher earnings
        make that fuel worth burning. In the starting run, earnings spend {HIGH_MONTHS} of {MONTHLY.length} months more than half again above their median of{' '}
        {perDay(MEDIAN)}, and only {LOW_MONTHS} months below two-thirds of it. The best month, at {perDay(PEAK_MONTH.tce)}, has ships steaming at{' '}
        {fmt(PEAK_MONTH.ladenSpeed, 1)} knots laden; the worst, at {perDay(LOW_MONTH.tce)}, at {fmt(LOW_MONTH.ladenSpeed, 1)}. The average,{' '}
        {perDay(MEAN)}, sits well above the typical month, because a few spikes carry it.
      </P>
      <P>
        All of this is a stylized model, not a forecast. Real markets add things it leaves out: shipyards whose capacity itself grows and shrinks, owners who
        expect more than the past year, banks that lend freely in booms and not at all in slumps. But the mechanics are real ones: after the long dry bulk boom that ended
        in 2008, the ships ordered at its height went on arriving for years, and earnings stayed low for much of the following decade.
      </P>

      <H2>Two classes, one wave</H2>
      <P>
        The course’s history was produced by this same model, with its disruptions and a wandering bunker price, for both size classes at once. The two markets
        share their demand shocks, because the same economies buy the ore, coal and grain, but each has its own fleet, trades and lags. In the next
        demonstration both run side by side through the twelve years, the three disruptions shaded. Remove one to see the history without it:
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
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
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
