import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  signed,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { MARKET, expectedIndex, marketQuote, replay, tradeStats, type MarketModel, type Trade, type TradeStats } from '../../../engines/weather/market';
import { contractSpan, indexDistribution, monthContract, settledIndex, CME_TICK, type ContractSpec } from '../../../engines/weather/pricing';
import { ninoAt } from '../../../model/weather/archive';
import { MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// Settings shared by both demonstrations.

export type MonthKey = 'dec' | 'jan' | 'feb';
export const MONTH_OF: Record<MonthKey, number> = { dec: 11, jan: 0, feb: 1 };
const MONTH_OPTIONS: Array<{ value: MonthKey; label: string }> = [
  { value: 'dec', label: 'December' },
  { value: 'jan', label: 'January' },
  { value: 'feb', label: 'February' },
];
/** Contract years the demonstrations cover. */
export const FIRST_YEAR = 2;
export const LAST_YEAR = 40;
export const YEARS_TRADED = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => i + FIRST_YEAR);
/** The first demonstration starts 60 days before the month. */
export const FIRST_DAY = -60;

export function specOf(month: MonthKey): ContractSpec {
  return monthContract('HDD', MONTH_OF[month]);
}

/** The simulated market with the reader's changes: whether it prices ENSO, and how stale its forecasts are. */
export function marketFor(usesEnso: boolean, lag: number, halfSpread = MARKET.halfSpread): MarketModel {
  return { ...MARKET, usesEnso, infoDelay: lag, halfSpread };
}

// ---------------------------------------------------------------------------
// The first demonstration: one contract through time.

export interface EdgeState {
  month: MonthKey;
  year: number;
  /** Decision day, relative to the month's first day (−60 = sixty days before it). */
  day: number;
  /** Winter warming at Calder Bay per °C of Niño-3.4, °F. */
  ensoF: number;
  usesEnso: boolean;
  /** How many days stale the market's forecasts are. */
  lag: number;
}

export const EDGE_DEFAULTS: EdgeState = { month: 'jan', year: 20, day: FIRST_DAY, ensoF: 1, usesEnso: false, lag: 2 };

interface TimelinePoint {
  rel: number;
  mid: number;
  bid: number;
  ask: number;
  ours: number;
}

export interface Timeline {
  points: TimelinePoint[];
  settled: number;
  /** The climate's expected index: what a forecaster with no information would expect. */
  normal: number;
  days: number;
}

const timelineCache = new Map<string, Timeline>();

/** The market's quotes and our expected index on every day from 60 days before the month to its end. */
export function timeline(st: Pick<EdgeState, 'month' | 'year' | 'ensoF' | 'usesEnso' | 'lag'>): Timeline {
  const key = `${st.month}|${st.year}|${st.ensoF}|${st.usesEnso}|${st.lag}`;
  const hit = timelineCache.get(key);
  if (hit) return hit;
  const spec = specOf(st.month);
  const { start, days } = contractSpan(spec, st.year);
  const knobs = { ensoF: st.ensoF };
  const m = marketFor(st.usesEnso, st.lag);
  const points: TimelinePoint[] = [];
  for (let rel = FIRST_DAY; rel <= days - 1; rel++) {
    const t = start + rel;
    const q = marketQuote(spec, st.year, t, m, knobs);
    points.push({ rel, mid: q.mid, bid: q.bid, ask: q.ask, ours: expectedIndex(spec, st.year, t, { knobs }) });
  }
  const out: Timeline = {
    points,
    settled: settledIndex(spec, st.year, knobs),
    normal: expectedIndex(spec, st.year, start - 30, { ignoreEnso: true }),
    days,
  };
  if (timelineCache.size > 120) timelineCache.clear();
  timelineCache.set(key, out);
  return out;
}

/** Our expected index minus the market's mid on the decision day, index points. */
export function gapOf(st: EdgeState): number {
  const tl = timeline(st);
  const p = tl.points[st.day - FIRST_DAY];
  return p.ours - p.mid;
}

let biggest: number | null = null;
/** The January, among years 2–40, whose market price 60 days ahead was furthest from our expected index at the starting settings. */
export function biggestGapYear(): number {
  if (biggest !== null) return biggest;
  let best = FIRST_YEAR;
  let gap = -1;
  for (const y of YEARS_TRADED) {
    const g = Math.abs(gapOf({ ...EDGE_DEFAULTS, year: y }));
    if (g > gap) {
      gap = g;
      best = y;
    }
  }
  biggest = best;
  return best;
}

/** The first challenge: the January with the largest gap, 60 days before, at the starting physics and market. */
export function gapSolved(st: EdgeState): boolean {
  return (
    st.month === 'jan' &&
    st.day === FIRST_DAY &&
    st.ensoF === EDGE_DEFAULTS.ensoF &&
    st.usesEnso === EDGE_DEFAULTS.usesEnso &&
    st.lag === EDGE_DEFAULTS.lag &&
    st.year === biggestGapYear()
  );
}

export interface Views {
  /** Our simulated index values, and the market's, recentred on each side's exact expected index. */
  ours: Float64Array;
  market: Float64Array;
  oursSd: number;
  marketSd: number;
  /** Probability the month finishes colder than normal (index above the normal), each side's view. */
  pOurs: number;
  pMarket: number;
}

const viewCache = new Map<string, Views>();

/**
 * Both sides' distributions of the index on the decision day. Ours uses the forecast issued that
 * day and the oscillator's ENSO projection; the market's uses its stale forecast and, unless it
 * prices ENSO, none. Each simulation's mean is shifted onto the exact expected index, which
 * removes the simulation's sampling noise without changing its spread.
 */
export function views(st: EdgeState): Views {
  const key = `${st.month}|${st.year}|${st.day}|${st.ensoF}|${st.usesEnso}|${st.lag}`;
  const hit = viewCache.get(key);
  if (hit) return hit;
  const spec = specOf(st.month);
  const t = contractSpan(spec, st.year).start + st.day;
  const knobs = { ensoF: st.ensoF };
  const tl = timeline(st);
  const p = tl.points[st.day - FIRST_DAY];
  const o = indexDistribution(spec, st.year, t, { paths: 300, knobs });
  const mk = indexDistribution(spec, st.year, t, { paths: 300, knobs, infoDelay: st.lag, ignoreEnso: !st.usesEnso });
  const ours = o.samples.map((v) => v + p.ours - o.mean);
  const market = mk.samples.map((v) => v + p.mid - mk.mean);
  const above = (xs: Float64Array) => xs.reduce((c, v) => c + (v > tl.normal ? 1 : 0), 0) / xs.length;
  const out: Views = { ours, market, oursSd: o.sd, marketSd: mk.sd, pOurs: above(ours), pMarket: above(market) };
  if (viewCache.size > 200) viewCache.clear();
  viewCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// The second demonstration: one rule, every winter.

export interface ReplayState {
  month: MonthKey;
  /** Days before the month the decision is made (negative: days into it). */
  lead: number;
  /** Trade only when the gap beats the spread by this much, index points. */
  threshold: number;
  halfSpread: number;
  ensoF: number;
  variability: number;
  usesEnso: boolean;
  lag: number;
}

export const REPLAY_DEFAULTS: ReplayState = { month: 'jan', lead: 60, threshold: 5, halfSpread: 5, ensoF: 1, variability: 1, usesEnso: false, lag: 2 };

const replayCache = new Map<string, { trades: Trade[]; stats: TradeStats }>();

/** The rule replayed over winters 2–40, one contract per trade, with the settings' physics and market. */
export function replayOf(st: ReplayState): { trades: Trade[]; stats: TradeStats } {
  const key = JSON.stringify(st);
  const hit = replayCache.get(key);
  if (hit) return hit;
  const trades = replay(
    specOf(st.month),
    YEARS_TRADED,
    st.lead,
    { threshold: st.threshold, size: 1, view: {} },
    marketFor(st.usesEnso, st.lag, st.halfSpread),
    { ensoF: st.ensoF, variability: st.variability },
  );
  const out = { trades, stats: tradeStats(trades) };
  if (replayCache.size > 300) replayCache.clear();
  replayCache.set(key, out);
  return out;
}

/** The decision lead of the second challenge: five days before January. */
export const VANISH_LEAD = 5;

/**
 * The second challenge: five days before January, with the threshold, the spread and the market's
 * blindness to ENSO left as they were, remove both edges so the rule finds nothing to trade.
 */
export function vanishSolved(st: ReplayState): boolean {
  return (
    st.month === 'jan' &&
    st.lead === VANISH_LEAD &&
    !st.usesEnso &&
    st.threshold === REPLAY_DEFAULTS.threshold &&
    st.halfSpread === REPLAY_DEFAULTS.halfSpread &&
    replayOf(st).stats.trades === 0
  );
}

// ---------------------------------------------------------------------------
// Drawing.

const MARKET_C = GRAPHIC.green;
const OURS_C = GRAPHIC.blue;
const SETTLED_C = GRAPHIC.orange;

function dayLabel(rel: number, month: number): string {
  if (rel < 0) return `${-rel} days before ${MONTH_NAMES[month]} 1`;
  return `${MONTH_NAMES[month]} ${rel + 1}`;
}

function contractLabel(month: MonthKey, year: number): string {
  return `${MONTH_NAMES[MONTH_OF[month]]} of year ${year}`;
}

/** A smoothed density of a sample on a grid of x values (Gaussian kernel). */
function density(xs: Float64Array, grid: number[], sd: number): number[] {
  const h = Math.max(2, 1.06 * sd * Math.pow(xs.length, -0.2));
  return grid.map((g) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) {
      const z = (g - xs[i]) / h;
      if (z > -4 && z < 4) s += Math.exp(-0.5 * z * z);
    }
    return s / (xs.length * h * Math.sqrt(2 * Math.PI));
  });
}

function TimelineChart({ st, tl, v }: { st: EdgeState; tl: Timeline; v: Views }) {
  const month = MONTH_OF[st.month];
  const X0 = 64;
  const X1 = 616;
  const x = scale(FIRST_DAY, tl.days - 1, X0, X1);
  const vals = tl.points.flatMap((p) => [p.bid, p.ask, p.ours]).concat([tl.settled, tl.normal]);
  const [lo, hi] = niceDomain(Math.min(...vals) - 5, Math.max(...vals) + 5, 4);
  const y = scale(lo, hi, 196, 26);
  const xs = tl.points.map((p) => x(p.rel));
  const band = `${linePath(xs, tl.points.map((p) => y(p.ask)))} ${tl.points
    .map((p) => `L${x(p.rel).toFixed(1)} ${y(p.bid).toFixed(1)}`)
    .reverse()
    .join(' ')} Z`;
  const cur = tl.points[st.day - FIRST_DAY];

  // The distributions on the decision day.
  const sd = Math.max(v.oursSd, v.marketSd, 1);
  const center = (cur.ours + cur.mid) / 2;
  const span = Math.max(4 * sd + Math.abs(cur.ours - cur.mid) / 2, 25);
  const dLo = center - span;
  const dHi = center + span;
  const grid = Array.from({ length: 101 }, (_, i) => dLo + ((dHi - dLo) * i) / 100);
  const dOurs = density(v.ours, grid, v.oursSd);
  const dMkt = density(v.market, grid, v.marketSd);
  const peak = Math.max(...dOurs, ...dMkt, 1e-9);
  const dx = scale(dLo, dHi, X0, X1);
  const dy = (d: number) => 330 - (d / peak) * 84;
  const gx = grid.map(dx);
  const oursArea = `${linePath(gx, dOurs.map(dy))} L${X1} 330 L${X0} 330 Z`;
  const inRange = (val: number) => val >= dLo && val <= dHi;
  const tickVals = niceTicks(dLo, dHi, 5);

  const ticks = [FIRST_DAY, -45, -30, -15, 0, 14, tl.days - 1].filter((r) => r <= tl.days - 1);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 372"
      role="img"
      aria-label={`${contractLabel(st.month, st.year)} HDD future, simulated. On ${dayLabel(st.day, month)} the market bids ${fmt(cur.bid)} and offers ${fmt(cur.ask)}; our expected index is ${fmt(cur.ours)}. The climate's normal is ${fmt(tl.normal)} and the month settled at ${fmt(tl.settled)}. Probability of a colder-than-normal month: market ${pct(v.pMarket)}, ours ${pct(v.pOurs)}.`}
    >
      <text className="ax" x={X0} y={14}>
        Expected index, heating degree days
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(t) => fmt(t)} />
      <line x1={x(0)} x2={x(0)} y1={26} y2={196} stroke="#c9c9c4" strokeWidth={1} />
      <text className="ax" x={x(0) + 4} y={36}>
        {MONTH_NAMES[month]} 1
      </text>
      <path d={band} fill={tint(MARKET_C, 0.35)} />
      <path d={linePath(xs, tl.points.map((p) => y(p.mid)))} fill="none" stroke={MARKET_C} strokeWidth={1.5} />
      <line x1={X0} x2={X1} y1={y(tl.normal)} y2={y(tl.normal)} stroke="#9a9a9a" strokeDasharray="2 3" />
      <line x1={X0} x2={X1} y1={y(tl.settled)} y2={y(tl.settled)} stroke={SETTLED_C} strokeWidth={1.5} strokeDasharray="6 4" />
      <text className="ax ax-e" x={X1} y={y(tl.settled) + (tl.settled > tl.normal ? -5 : 13)} style={{ fill: TEXT.orange }}>
        settled {fmt(tl.settled)}
      </text>
      <path d={linePath(xs, tl.points.map((p) => y(p.ours)))} fill="none" stroke={OURS_C} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={x(st.day)} x2={x(st.day)} y1={26} y2={196} />
      <circle cx={x(st.day)} cy={y(cur.ours)} r={5} fill={OURS_C} stroke="#fcfcfb" strokeWidth={2} />
      <circle cx={x(st.day)} cy={y(cur.mid)} r={4} fill={MARKET_C} stroke="#fcfcfb" strokeWidth={2} />
      {ticks.map((r) => (
        <text key={r} className="ax ax-m" x={x(r)} y={212}>
          {r < 0 ? `−${-r} d` : r === 0 ? `${MONTH_NAMES[month].slice(0, 3)} 1` : `${MONTH_NAMES[month].slice(0, 3)} ${r + 1}`}
        </text>
      ))}

      <text className="ax" x={X0} y={240}>
        On {dayLabel(st.day, month)}: what each side thinks the month will settle at
      </text>
      <path d={oursArea} fill={tint(OURS_C, 0.35)} />
      <path d={linePath(gx, dOurs.map(dy))} fill="none" stroke={OURS_C} strokeWidth={2} />
      <path d={linePath(gx, dMkt.map(dy))} fill="none" stroke={MARKET_C} strokeWidth={2} strokeDasharray="6 4" />
      <line className="base" x1={X0} x2={X1} y1={330} y2={330} />
      {inRange(tl.normal) && (
        <g>
          <line x1={dx(tl.normal)} x2={dx(tl.normal)} y1={246} y2={330} stroke="#9a9a9a" strokeDasharray="2 3" />
          <text className="ax" x={dx(tl.normal) + 4} y={256}>
            normal
          </text>
        </g>
      )}
      {inRange(tl.settled) && <path d={`M${dx(tl.settled)} 330 l-5 9 l10 0 Z`} fill={SETTLED_C} />}
      {tickVals.map((t) => (
        <text key={t} className="ax ax-m" x={dx(t)} y={354}>
          {fmt(t)}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={370}>
        index at settlement
      </text>
    </svg>
  );
}

function ReplayChart({ st, trades }: { st: ReplayState; trades: Trade[] }) {
  const X0 = 72;
  const X1 = 616;
  const band = (X1 - X0) / YEARS_TRADED.length;
  const x = (yr: number) => X0 + (yr - FIRST_YEAR + 0.5) * band;
  const byYear = new Map(trades.map((t) => [t.year, t]));
  const pnls = trades.map((t) => t.pnl);
  const [lo, hi] = niceDomain(Math.min(-1000, ...pnls), Math.max(1000, ...pnls), 4);
  const y = scale(lo, hi, 170, 24);
  let run = 0;
  const cum = YEARS_TRADED.map((yr) => (run += byYear.get(yr)?.pnl ?? 0));
  const [c0, c1] = niceDomain(Math.min(0, ...cum), Math.max(1000, ...cum), 3);
  const yc = scale(c0, c1, 300, 222);
  const money = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k` : usd(v));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`One ${MONTH_NAMES[MONTH_OF[st.month]]} HDD future traded ${st.lead >= 0 ? `${st.lead} days before the month` : `${-st.lead} days into it`} in each of years ${FIRST_YEAR}–${LAST_YEAR} of the simulated archive: ${trades.length} trades, ${trades.filter((t) => t.pnl > 0).length} of them winners, ending at ${usd(cum[cum.length - 1])}.`}
    >
      <text className="ax" x={X0} y={12}>
        P&amp;L of each trade, one contract
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={money} baseline={0} />
      {YEARS_TRADED.map((yr) => {
        const t = byYear.get(yr);
        if (!t) return <circle key={yr} cx={x(yr)} cy={y(0)} r={1.8} fill="#b5b5b5" />;
        const top = Math.min(y(0), y(t.pnl));
        return <rect key={yr} x={x(yr) - band * 0.35} y={top} width={band * 0.7} height={Math.max(1, Math.abs(y(t.pnl) - y(0)))} fill={t.pnl >= 0 ? GRAPHIC.green : GRAPHIC.red} />;
      })}
      <text className="ax" x={X0} y={210}>
        Running total
      </text>
      <GridY y={yc} ticks={niceTicks(c0, c1, 3)} x0={X0} x1={X1} format={money} baseline={0} />
      <path d={linePath(YEARS_TRADED.map(x), cum.map(yc))} fill="none" stroke="#333" strokeWidth={2} strokeLinejoin="round" />
      {[2, 10, 20, 30, 40].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr)} y={318}>
          {yr === 2 ? 'year 2' : yr}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Numbers the prose quotes, computed from the same engines the figures run. */
function proseNumbers() {
  const start = EDGE_DEFAULTS;
  const tl = timeline(start);
  const p60 = tl.points[0];
  const v = views(start);
  const jan1 = tl.points[-FIRST_DAY];
  const jan1Lagless = timeline({ ...start, ensoF: 0 }).points[-FIRST_DAY];
  const spec = specOf('jan');
  const t60 = contractSpan(spec, start.year).start + FIRST_DAY;
  const big = biggestGapYear();
  const bigTl = timeline({ ...start, year: big });
  const bigT = contractSpan(spec, big).start + FIRST_DAY;
  const r = (patch: Partial<ReplayState>) => replayOf({ ...REPLAY_DEFAULTS, ...patch }).stats;
  return {
    p60,
    v,
    jan1Gap: jan1.ours - jan1.mid,
    jan1LagGap: jan1Lagless.ours - jan1Lagless.mid,
    nino60: ninoAt(t60),
    settled: tl.settled,
    normal: tl.normal,
    big,
    bigGap: bigTl.points[0].ours - bigTl.points[0].mid,
    bigOurs: bigTl.points[0].ours,
    bigMid: bigTl.points[0].mid,
    bigNino: ninoAt(bigT),
    bigSettled: bigTl.settled,
    base: r({}),
    noPull: r({ ensoF: 0 }),
    marketEnso: r({ usesEnso: true }),
    half: r({ ensoF: 0.5 }),
    double: r({ ensoF: 2 }),
    calm: r({ variability: 0.5 }),
    wild: r({ variability: 1.5 }),
    dec: r({ month: 'dec' }),
    near: r({ lead: VANISH_LEAD }),
    nearNoPull: r({ lead: VANISH_LEAD, ensoF: 0 }),
  };
}

export default function Lesson() {
  const e = useScenario('edge', EDGE_DEFAULTS);
  const st = e.state;
  const month = MONTH_OF[st.month];
  const spec = specOf(st.month);
  const days = contractSpan(spec, st.year).days;
  const day = Math.min(st.day, days - 2);
  const est = { ...st, day };
  const tl = useMemo(() => timeline(est), [est.month, est.year, est.ensoF, est.usesEnso, est.lag]);
  const deferred = useDeferredValue(est);
  const v = useMemo(() => views(deferred), [deferred.month, deferred.year, deferred.day, deferred.ensoF, deferred.usesEnso, deferred.lag]);
  const cur = tl.points[day - FIRST_DAY];
  const gap = cur.ours - cur.mid;
  const net = Math.abs(gap) - (cur.ask - cur.mid);
  const t = contractSpan(spec, st.year).start + day;
  const solved = gapSolved(est);

  const rp = useScenario('replay', REPLAY_DEFAULTS);
  const rs = rp.state;
  const rep = useMemo(() => replayOf(rs), [rs]);
  const withoutPull = useMemo(() => replayOf({ ...rs, ensoF: 0 }).stats, [rs]);
  const marketWatches = useMemo(() => replayOf({ ...rs, usesEnso: true }).stats, [rs]);
  const solved2 = vanishSolved(rs);

  const n = useMemo(proseNumbers, []);
  const tone = (x: number) => (x > 0 ? WX.money : x < 0 ? 'red' : 'ink');
  const side = gap > 0 ? 'buy' : 'sell';

  return (
    <LessonPage id="weather/5.3">
      <P>
        The last two lessons wrote contracts on Calder Bay’s weather and priced them: settle the days already past, forecast the next fortnight, and fill in the
        rest from the climate (<a href={lessonHref('weather/5.2')}>Lesson 5.2</a>). That gives a fair value. But nobody trades at a fair value they computed
        themselves. They trade at the market’s price, and the market’s price is someone else’s forecast. This lesson asks what a price says about the weather, and
        when it’s worth disagreeing with it.
      </P>
      <P>
        A price can be read as a forecast. A degree-day future pays $20 a point, so a January future quoted at {usd(Math.round(n.p60.mid) * CME_TICK)} says the
        market expects the index to settle at {fmt(n.p60.mid)}. A contract that pays $1,000 if January turns out colder than normal, quoted at{' '}
        {usd(Math.round(n.v.pMarket * 100) * 10)}, says the market puts the chance at {pct(n.v.pMarket)} — the{' '}
        <K tone={WX.probability}>market-implied probability</K>, the price divided by the payout (ignoring interest and any premium for taking the risk). A
        forecaster has a distribution of her own, and implies her own probabilities from it. The <K tone={WX.money}>edge</K> is the difference between the two
        views, and it pays only if it is larger than the cost of trading — here the bid–ask spread, 5 index points either side of the market’s mid, or $100 a
        contract.
      </P>
      <P>
        The market in this lesson is simulated, like everything in the course’s archive. It knows the climate of Calder Bay, trend included, so it isn’t naive.
        But its forecasts are two days stale, and it doesn’t watch the Pacific. In the next demonstration, choose a winter month and a year, and follow its HDD
        future from 60 days before the month to its last day. The green band is the market’s bid and ask, the blue line our expected index, made each day from
        only what was known that day; the dashed orange line is where the month finally settled, and the dotted gray one the climate’s normal. The lower chart
        shows both sides’ whole distributions on the decision day. The last three controls change the physics and the market:
      </P>

      <Figure name="Forecast Edge Explorer" scenario={e}>
        <Segmented label="Contract month" value={st.month} onChange={(m) => e.set({ month: m })} options={MONTH_OPTIONS} />
        <TimelineChart st={est} tl={tl} v={v} />
        <Legend
          items={[
            { label: 'Market bid–ask', color: tint(MARKET_C, 0.5) },
            { label: 'Our expected index', color: OURS_C, kind: 'line' },
            { label: 'Market’s distribution', color: MARKET_C, kind: 'line', dashed: true },
            { label: 'Settled', color: SETTLED_C, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'market bid–ask', value: `${fmt(cur.bid)}–${fmt(cur.ask)}`, tone: WX.money },
            { label: 'our expected index', value: fmt(cur.ours), tone: WX.probability },
            { label: `edge after the spread (${side})`, value: net > 0 ? `${usd(net * CME_TICK)} a contract` : 'none', tone: net > 0 ? WX.money : 'ink' },
            { label: 'colder than normal: market / ours', value: `${pct(v.pMarket)} / ${pct(v.pOurs)}`, tone: WX.probability },
            { label: 'Niño-3.4 that day', value: `${signed(ninoAt(t), 1)} °C`, tone: WX.temperature },
          ]}
        />
        <Slider label="Year" value={st.year} min={FIRST_YEAR} max={LAST_YEAR} onChange={(y) => e.set({ year: y })} display={contractLabel(st.month, st.year)} />
        <Slider label="Decision day" value={day} min={FIRST_DAY} max={days - 2} onChange={(d) => e.set({ day: d })} display={dayLabel(day, month)} />
        <Slider
          label="Pacific’s pull on the winter"
          tone={WX.temperature}
          value={st.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(x) => e.set({ ensoF: x })}
          display={`${fmt(st.ensoF, 1)} °F per °C`}
        />
        <Slider label="Market’s forecasts are" value={st.lag} min={0} max={5} onChange={(x) => e.set({ lag: x })} display={st.lag === 0 ? 'fresh' : `${st.lag} day${st.lag > 1 ? 's' : ''} stale`} />
        <Checkbox label="The market prices ENSO" checked={st.usesEnso} onChange={(x) => e.set({ usesEnso: x })} />
        <Caption>
          {Math.abs(gap) < 0.5
            ? `On ${dayLabel(day, month)} we and the market expect the same index.`
            : `On ${dayLabel(day, month)} we expect ${fmt(Math.abs(gap), 1)} points ${gap > 0 ? 'more' : 'fewer'} heating degree days than the market: a ${gap > 0 ? 'colder' : 'milder'} month.`}{' '}
          {day < -15 ? (st.usesEnso || st.ensoF === 0 ? 'No forecast reaches this far, and the Pacific adds nothing the market lacks.' : 'No forecast reaches this far: the whole gap is the Pacific.') : 'Forecasts now reach into the month, and the market’s are older than ours.'}
        </Caption>
      </Figure>

      <P>
        It opens on January of year {EDGE_DEFAULTS.year}, 60 days ahead. No weather forecast reaches that far, so the market quotes the climate: {fmt(n.p60.mid)}{' '}
        heating degree days, exactly the normal. We expect {fmt(n.p60.ours)}. The difference is the Pacific. That autumn Niño-3.4 stood at{' '}
        {signed(n.nino60, 1)} °C, an El Niño, and as <a href={lessonHref('weather/2.4')}>Lesson 2.4</a> showed, El Niño tilts Calder Bay’s winters mild. So we
        would sell: the gap is {fmt(Math.abs(n.p60.ours - n.p60.mid), 1)} points, {usd((Math.abs(n.p60.ours - n.p60.mid) - MARKET.halfSpread) * CME_TICK)} a
        contract after the spread. In probabilities, the market prices a colder-than-normal January at {pct(n.v.pMarket)}, and we put it at {pct(n.v.pOurs)}.
      </P>
      <P>
        Look at the distributions, though. Each has a standard deviation of about {fmt(Math.round(n.v.oursSd / 10) * 10)} points, and they overlap almost
        completely: an edge of {fmt(Math.abs(n.p60.ours - n.p60.mid))} points against a spread of {fmt(Math.round(n.v.oursSd / 10) * 10)}. The month settled at{' '}
        {fmt(n.settled)}, far milder than either side expected. Selling won, but the weather, not the edge, did most of the winning.
      </P>
      <P>
        Now move the decision day toward January. From about two weeks out, the forecasts of <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> reach into the
        month, and both lines start to move: the information about each day’s weather arrives from upstream, piece by piece, as{' '}
        <a href={lessonHref('weather/3.3')}>Lesson 3.3</a> showed. The market moves too, but it is two days behind. On January 1 the gap is{' '}
        {fmt(Math.abs(n.jan1Gap))} points, and {fmt(Math.abs(n.jan1LagGap))} of them remain even with the Pacific’s pull set to zero: that much is the forecast’s
        freshness alone. Through the month both sides learn each settled day, the lines close in, and on the last day they meet at the settlement.
      </P>

      <Challenge
        id="a"
        question="Keep the physics and the market as they start. Among years 2–40, which January did the market misprice most 60 days ahead — the largest gap, either way, between its price and our expected index?"
        solved={solved}
        status={
          st.month !== 'jan' || day !== FIRST_DAY
            ? 'Choose January, and set the decision day to 60 days before it.'
            : st.ensoF !== EDGE_DEFAULTS.ensoF || st.usesEnso || st.lag !== EDGE_DEFAULTS.lag
              ? 'Put the physics and the market back as they started.'
              : `In January of year ${st.year} the gap is ${fmt(Math.abs(gap), 1)} points. Is there a bigger one?`
        }
        success={`Solved. Sixty days before January of year ${n.big}, we expected ${fmt(n.bigOurs)} heating degree days and the market quoted ${fmt(n.bigMid)}: a gap of ${fmt(n.bigGap, 1)} points, the largest in the archive. Niño-3.4 stood at ${signed(n.bigNino, 1)} °C, a strong La Niña, which tilts Calder Bay’s winters cold, and a market that prices only the climate couldn’t see it. That January settled at ${fmt(n.bigSettled)}.`}
      />

      <H2>Where the gap comes from</H2>
      <P>
        Every gap in <FigRef to="Forecast Edge Explorer">the first demonstration</FigRef> has a physical source you can switch off. Months ahead, the only
        information either side can have in this world beyond the climate is the state of the Pacific. Slide its pull on Calder Bay’s winter to zero — a world where the jet
        stream doesn’t respond to the tropical Pacific — and the two lines lie on top of each other until the forecasts arrive. Or leave the physics alone and let
        the market price ENSO: the gap disappears just the same. Days ahead, the gap is the age of the market’s forecast. Make its forecasts fresh and the
        short-range gaps vanish. The edge also depends on how the index is counted. Both sides add up expected degree days day by day, with the hinge of{' '}
        <a href={lessonHref('weather/4.1')}>Lesson 4.1</a>; a trader who took the degree days of the expected temperature instead would misprice the shoulder
        months, where the days straddle 65 °F.
      </P>
      <P>
        One winter proves nothing. In the next demonstration, the same rule is replayed over every winter in the archive: on the decision day, compare our expected
        index with the market’s bid and ask, buy or sell one contract if the gap beats the spread by the threshold, and hold it to settlement. The bars are each
        trade’s profit or loss, the gray dots winters without a trade, the line the running total. Each decision uses only what was known on its day. Change the
        rule, the market and the physics:
      </P>

      <Figure name="Forecast Edge Explorer · every winter" scenario={rp}>
        <Segmented label="Contract month" value={rs.month} onChange={(m) => rp.set({ month: m })} options={MONTH_OPTIONS} />
        <ReplayChart st={rs} trades={rep.trades} />
        <Readouts
          items={[
            { label: 'trades, of 39 winters', value: fmt(rep.stats.trades) },
            { label: 'average per trade', value: usd(rep.stats.mean), tone: tone(rep.stats.mean) },
            { label: 'winners', value: rep.stats.trades ? pct(rep.stats.hitRate) : '—' },
            { label: 'total', value: usd(rep.stats.total), tone: tone(rep.stats.total) },
            { label: 'worst trade', value: usd(rep.stats.worst), tone: tone(rep.stats.worst) },
            { label: 'with no pull from the Pacific', value: `${withoutPull.trades} trades, ${usd(withoutPull.total)}`, tone: tone(withoutPull.total) },
            { label: 'if the market watched the Pacific', value: `${marketWatches.trades} trades, ${usd(marketWatches.total)}`, tone: tone(marketWatches.total) },
          ]}
        />
        <Slider
          label="Decision day"
          value={rs.lead}
          min={-15}
          max={60}
          onChange={(x) => rp.set({ lead: x })}
          display={rs.lead > 0 ? `${rs.lead} days before` : rs.lead === 0 ? `${MONTH_NAMES[MONTH_OF[rs.month]]} 1` : `${-rs.lead} days into the month`}
        />
        <Slider label="Threshold beyond the spread" tone={WX.index} value={rs.threshold} min={0} max={30} onChange={(x) => rp.set({ threshold: x })} display={`${rs.threshold} points`} />
        <Slider label="Half the bid–ask spread" tone={WX.money} value={rs.halfSpread} min={0} max={15} onChange={(x) => rp.set({ halfSpread: x })} display={`${rs.halfSpread} points · ${usd(rs.halfSpread * CME_TICK)}`} />
        <Slider
          label="Pacific’s pull on the winter"
          tone={WX.temperature}
          value={rs.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(x) => rp.set({ ensoF: x })}
          display={`${fmt(rs.ensoF, 1)} °F per °C`}
        />
        <Slider label="Day-to-day variability" tone={WX.temperature} value={rs.variability} min={0.5} max={1.5} step={0.1} onChange={(x) => rp.set({ variability: x })} display={`× ${fmt(rs.variability, 1)}`} />
        <Slider label="Market’s forecasts are" value={rs.lag} min={0} max={5} onChange={(x) => rp.set({ lag: x })} display={rs.lag === 0 ? 'fresh' : `${rs.lag} day${rs.lag > 1 ? 's' : ''} stale`} />
        <Checkbox label="The market prices ENSO" checked={rs.usesEnso} onChange={(x) => rp.set({ usesEnso: x })} />
      </Figure>

      <P>
        Traded 60 days before January, the rule makes {n.base.trades} trades in 39 winters. {fmt(Math.round(n.base.hitRate * n.base.trades))} win, and{' '}
        {fmt(n.base.trades - Math.round(n.base.hitRate * n.base.trades))} lose; the average trade earns {usd(n.base.mean)}, the worst loses{' '}
        {usd(-n.base.worst)}, and the total is {usd(n.base.total)}. That is what an edge looks like: not a sure thing, but a small tilt in the odds, visible only
        over many trades, with losses along the way that are as large as the average gain. A trade’s outcome swings by about {usd(n.base.sd)} either way, three
        times its expected profit. December happened to do better here, {n.dec.trades} trades averaging {usd(n.dec.mean)}, but with so few winters the
        difference between months is within the noise.
      </P>
      <P>
        Now break it. Set the Pacific’s pull to zero and there is nothing to trade 60 days out: {n.noPull.trades} trades. Let the market price ENSO and only{' '}
        {n.marketEnso.trades} remain. Halve the pull and the gaps shrink to the size of the spread and the threshold: {n.half.trades} trades, averaging{' '}
        {usd(n.half.mean)} — the physics is still there, but too weak to show through the weather in 39 winters. Double it and the rule trades{' '}
        {n.double.trades} times, averaging {usd(n.double.mean)}. The day-to-day variability works on the other side of the ledger. It doesn’t change the gaps,
        which come from the Pacific, but it changes how much the weather can overrule them: at half the variability a trade swings by {usd(n.calm.sd)} and{' '}
        {pct(n.calm.hitRate)} of trades win; at one and a half times, by {usd(n.wild.sd)}.
      </P>
      <P>
        Move the decision to {VANISH_LEAD} days before January and the second edge joins the first: {n.near.trades} trades averaging {usd(n.near.mean)}. With the
        Pacific’s pull at zero, {n.nearNoPull.trades} trades averaging {usd(n.nearNoPull.mean)} are left, and those come entirely from the market’s two-day-old
        forecasts.
      </P>

      <Challenge
        id="b"
        figure="Forecast Edge Explorer · every winter"
        question={`Set the decision to ${VANISH_LEAD} days before January, where both edges are at work. Leave the threshold, the spread and the market’s blindness to ENSO as they are. Remove both edges, so that the rule finds nothing to trade in any winter.`}
        solved={solved2}
        status={
          rs.month !== 'jan' || rs.lead !== VANISH_LEAD
            ? `Choose January and a decision ${VANISH_LEAD} days before it.`
            : rs.usesEnso || rs.threshold !== REPLAY_DEFAULTS.threshold || rs.halfSpread !== REPLAY_DEFAULTS.halfSpread
              ? 'Keep the market blind to ENSO, and the threshold and spread at 5 points.'
              : `Right now the rule still makes ${rep.stats.trades} trade${rep.stats.trades === 1 ? '' : 's'}.`
        }
        success="Solved. One edge was physical: with no teleconnection, the Pacific carries no news about Calder Bay’s winter, so a market that ignores it misses nothing. The other was informational: with fresh forecasts, the market knows what we know about the next fortnight. Remove both and our expected index and the market’s are the same number every time — there is no gap for the rule to trade."
      />

      <P>
        None of this is investment advice, and the market here is a simple, simulated one. Real weather markets are thinner, their spreads can be wider, and the
        traders in them watch the Pacific too; an edge that everyone can see is priced in quickly, which is exactly what the checkbox does. What carries over is the
        method. Write down what the market’s price implies, write down what your forecast implies, and before trading the difference, name the physical reason the
        two disagree and check that the difference survives the spread.
      </P>
      <P>
        The same forecast can be expressed in more than one market. A forecast that next week will be colder than the market thinks moves degree-day futures, but
        it also moves the gas and electricity prices of <a href={lessonHref('weather/4.2')}>Lesson 4.2</a> — each by a different amount, at a different cost. The
        next lesson, <a href={lessonHref('weather/5.4')}>Lesson 5.4</a>, puts one weather view into three markets and asks which of them pays.
      </P>
    </LessonPage>
  );
}
