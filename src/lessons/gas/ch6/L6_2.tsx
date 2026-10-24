import { useMemo } from 'react';
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
  tint,
  useScenario,
} from '../../../framework';
import { curveAt } from '../../../engines/gas/futures';
import { planInventory } from '../../../engines/gas/market';
import { defaultCosts, runBook, spreadSignals, spreadTrades, type BookResult, type SpreadOptions, type SpreadSignal } from '../../../engines/gas/strategies';
import { gasHistory } from '../../../model/gas/history';
import { GAS_MONTHS, GAS_MONTH_NAMES, GAS_MONTH_START, GAS_YEAR_DAYS } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { basis as signed, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// Figure 1: one spread through one year of the history.

export type TraderSpread = 'marApr' | 'janOct';
export type TraderSide = 'buy' | 'sell';

/** The two spreads the figure trades: bought on the first day of `entryCal`, long one month and short another (gas-year months, 0 = April). */
export const TRADER_SPREADS: Record<TraderSpread, { label: string; long: string; short: string; entryCal: number; longCal: number; shortCal: number }> = {
  marApr: { label: 'March/April, bought November 1', long: 'March', short: 'April', entryCal: 7, longCal: 11, shortCal: 0 },
  janOct: { label: 'January/October, bought April 1', long: 'January', short: 'October', entryCal: 0, longCal: 9, shortCal: 6 },
};

export const SPREAD_TRADER_DEFAULTS = { spread: 'marApr' as TraderSpread, year: 2, side: 'buy' as TraderSide, lots: 10 };
export const TRADER_LOTS_MAX = 50;

/** The options the strategies engine takes for one of the figure's spreads. */
export function traderOptions(kind: TraderSpread, lots = 1, rule: SpreadOptions['rule'] = 'always', thresholdBcf = 0): SpreadOptions {
  const s = TRADER_SPREADS[kind];
  return { entryCal: s.entryCal, longCal: s.longCal, shortCal: s.shortCal, lots, rule, thresholdBcf };
}

/** Every year's trade of a spread (a year is missing when its second leg falls past the history's end). */
export function traderSignals(kind: TraderSpread): SpreadSignal[] {
  return spreadSignals(traderOptions(kind));
}

/** The spread bought in a given year (0-based), or the last one available. */
export function traderSignal(kind: TraderSpread, year: number): SpreadSignal {
  const all = traderSignals(kind);
  return all.find((s) => Math.floor(s.entry / 12) === year) ?? all[all.length - 1];
}

/** Degree-days colder than normal (°F colder than normal, summed over days) from `fromDay` up to `toDay` of a year. */
export function traderCold(year: number, fromDay: number, toDay: number): number {
  const w = gasHistory()[year].weather;
  let s = 0;
  for (let d = fromDay; d < toDay; d++) s += w.normal[d] - w.temp[d];
  return s;
}

/** Working gas at the start of a day less what the April plan had for that day, Bcf. */
export function traderGap(year: number, day: number): number {
  const y = gasHistory()[year];
  const st = day === 0 ? y.start : y.days[day - 1].storage;
  return st.saltflat + st.hollowcreek - planInventory(y.plan, 'saltflat', day) - planInventory(y.plan, 'hollowcreek', day);
}

/** First day of the gas year of an absolute month's first day. */
const dayOfMonth = (abs: number) => GAS_MONTH_START[abs % 12];

export interface TraderWinter {
  year: number;
  signal: SpreadSignal;
  /** Change in the spread from entry to exit, $/MMBtu. */
  change: number;
  /** Degree-days colder than normal between entry and exit. */
  cold: number;
  /** Working gas against the April plan on entry and on exit, Bcf. */
  gapEntry: number;
  gapExit: number;
}

/** Every year's spread trade with the weather and storage behind it. */
export function traderWinters(kind: TraderSpread): TraderWinter[] {
  return traderSignals(kind).map((s) => {
    const year = Math.floor(s.entry / 12);
    const exitDay = Math.floor(s.exit / 12) === year ? dayOfMonth(s.exit) : GAS_YEAR_DAYS;
    return {
      year,
      signal: s,
      change: s.atExit - s.atEntry,
      cold: traderCold(year, dayOfMonth(s.entry), exitDay),
      gapEntry: curveAt(s.entry).storage - curveAt(s.entry).planned,
      gapExit: curveAt(s.exit).storage - curveAt(s.exit).planned,
    };
  });
}

/** Profit after the default fees of buying (or selling) `lots` of a year's spread. */
export function traderBook(kind: TraderSpread, year: number, side: TraderSide, lots: number): BookResult {
  const s = traderSignal(kind, year);
  const n = side === 'buy' ? lots : -lots;
  return runBook(
    [
      {
        entry: s.entry,
        exit: s.exit,
        legs: [
          { kind: 'futures', delivery: s.longDelivery, lots: n },
          { kind: 'futures', delivery: s.shortDelivery, lots: -n },
        ],
      },
    ],
    defaultCosts(),
  );
}

/** Whether, in every year, the spread widened exactly when the months it spans were colder than normal. */
export function traderFollowsWeather(kind: TraderSpread): boolean {
  return traderWinters(kind).every((w) => w.change > 0 === w.cold > 0);
}

// ---------------------------------------------------------------------------
// Figure 2: a rule — buy March/April on November 1 when storage is short of plan.

export type TraderRule = 'always' | 'behind';
export const SPREAD_RULE_LOTS = 10;
export const SPREAD_RULE_MAX_THRESHOLD = 20;
export const SPREAD_RULE_DEFAULTS = { rule: 'always' as TraderRule, threshold: 10 };

const ruleCache = new Map<string, BookResult>();
/** The rule's book: ten lots of March/April each November 1 it trades; cached. */
export function ruleBookFor(rule: TraderRule, threshold: number): BookResult {
  const key = `${rule}|${threshold}`;
  let b = ruleCache.get(key);
  if (!b) {
    b = runBook(spreadTrades(traderOptions('marApr', SPREAD_RULE_LOTS, rule, threshold)), defaultCosts());
    ruleCache.set(key, b);
  }
  return b;
}

/** The years (0-based) a rule trades. */
export function ruleYears(rule: TraderRule, threshold: number): number[] {
  return spreadSignals(traderOptions('marApr', SPREAD_RULE_LOTS, rule, threshold))
    .filter((s) => s.traded)
    .map((s) => Math.floor(s.entry / 12));
}

/** The most the storage rule made over the history, across whole-Bcf thresholds, and the thresholds that make it. */
export function bestRuleThresholds(): { total: number; thresholds: number[] } {
  let best = -Infinity;
  let at: number[] = [];
  for (let t = 0; t <= SPREAD_RULE_MAX_THRESHOLD; t++) {
    const v = ruleBookFor('behind', t).total;
    if (v > best + 1e-6) {
      best = v;
      at = [t];
    } else if (Math.abs(v - best) <= 1e-6) at.push(t);
  }
  return { total: best, thresholds: at };
}

/** The challenge: the storage rule set to the threshold that made the most. */
export function spreadTraderSolved(s: { rule: TraderRule; threshold: number }): boolean {
  return s.rule === 'behind' && bestRuleThresholds().thresholds.includes(s.threshold);
}

// ---------------------------------------------------------------------------

const LONG = GRAPHIC.green;
const SHORT = '#7a7a7a';
const STORE = GRAPHIC.gold;
const COLD = GRAPHIC.teal;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const kUsd = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${fmt(Math.abs(v) / 1000, 0)}k`;
const signedBcf = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${fmt(Math.abs(v), 1)} Bcf`;
const yearsText = (ys: number[]) =>
  ys.length === 0 ? 'no winters' : ys.length === 1 ? `Year ${ys[0] + 1}` : `Years ${ys.slice(0, -1).map((y) => y + 1).join(', ')} and ${ys[ys.length - 1] + 1}`;

/** Fixed chart ranges for a spread, so that years can be compared. */
function rangesOf(kind: TraderSpread) {
  const ws = traderWinters(kind);
  let lo = Infinity;
  let hi = -Infinity;
  let gap = 0;
  let cold = 0;
  for (const w of ws) {
    for (let m = w.signal.entry; m <= w.signal.exit; m++) {
      const c = curveAt(m);
      lo = Math.min(lo, c.calder[w.signal.shortDelivery], c.calder[w.signal.longDelivery]);
      hi = Math.max(hi, c.calder[w.signal.shortDelivery], c.calder[w.signal.longDelivery]);
    }
    const from = dayOfMonth(w.signal.entry);
    const to = dayOfMonth(w.signal.exit);
    let run = 0;
    for (let d = from; d <= to; d++) {
      gap = Math.max(gap, Math.abs(traderGap(w.year, d)));
      if (d < to) run += gasHistory()[w.year].weather.normal[d] - gasHistory()[w.year].weather.temp[d];
      cold = Math.max(cold, Math.abs(run));
    }
  }
  return {
    price: [Math.floor(lo * 2) / 2, Math.ceil(hi * 2) / 2] as [number, number],
    gap: Math.ceil(gap / 5) * 5,
    cold: Math.ceil(cold / 100) * 100,
  };
}

function SpreadPanels({ kind, year, side, lots }: { kind: TraderSpread; year: number; side: TraderSide; lots: number }) {
  const spec = TRADER_SPREADS[kind];
  const s = traderSignal(kind, year);
  const r = useMemo(() => rangesOf(kind), [kind]);
  const from = dayOfMonth(s.entry);
  const to = dayOfMonth(s.exit);
  const months = Array.from({ length: s.exit - s.entry + 1 }, (_, k) => s.entry + k);
  const mx = months.map(dayOfMonth);
  const longP = months.map((m) => curveAt(m).calder[s.longDelivery]);
  const shortP = months.map((m) => curveAt(m).calder[s.shortDelivery]);
  const days = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const gaps = days.map((d) => traderGap(year, d));
  const w = gasHistory()[year].weather;
  const colds: number[] = [];
  let run = 0;
  for (const d of days) {
    colds.push(run);
    if (d < to) run += w.normal[d] - w.temp[d];
  }
  const ticks = mx;
  const xFormat = (v: number) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? '';
  const last = months.length - 1;
  const book = traderBook(kind, year, side, lots);
  return (
    <>
      <XYChart
        xDomain={[from, to]}
        yDomain={r.price}
        xTicks={ticks}
        xFormat={xFormat}
        yFormat={(v) => `$${fmt(v, 2)}`}
        yLabel="Futures price on the first of each month, $/MMBtu"
        height={210}
        series={[
          { xs: mx, ys: longP, lows: shortP, kind: 'band', color: tint(GRAPHIC.green, 0.35), opacity: 1 },
          { xs: mx, ys: longP, color: LONG, width: 2.5, label: spec.long, labelColor: TEXT.green },
          { xs: mx, ys: longP, color: LONG, kind: 'points', r: 3.5 },
          { xs: mx, ys: shortP, color: SHORT, width: 2, dash: '5 4', label: spec.short, labelColor: TEXT.gray },
          { xs: mx, ys: shortP, color: SHORT, kind: 'points', r: 3 },
        ]}
        markers={[{ x: mx[last], y: (longP[last] + shortP[last]) / 2, color: TEXT.green, r: 0, label: `spread ${gp(longP[last] - shortP[last])}`, labelPos: 'left' }]}
        ariaLabel={`The ${spec.long} and ${spec.short} contracts of Year ${year + 1}, from ${GAS_MONTH_NAMES[s.entry % 12]} 1 to ${GAS_MONTH_NAMES[s.exit % 12]} 1: ${months
          .map((m, k) => `${GAS_MONTHS[m % 12]} ${gp(longP[k])} and ${gp(shortP[k])}`)
          .join('; ')}. The spread goes from ${gp(s.atEntry)} to ${gp(s.atExit)}.`}
      />
      <XYChart
        xDomain={[from, to]}
        yDomain={[-r.gap, r.gap]}
        xTicks={ticks}
        xFormat={xFormat}
        yFormat={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`}
        yLabel="Working gas against the April plan, Bcf"
        height={130}
        series={[{ xs: days, ys: gaps, color: STORE, width: 2 }]}
        ariaLabel={`Working gas against the plan drawn on April 1: ${signedBcf(gaps[0])} on ${GAS_MONTH_NAMES[s.entry % 12]} 1, ${signedBcf(gaps[gaps.length - 1])} on ${GAS_MONTH_NAMES[s.exit % 12]} 1.`}
      />
      <XYChart
        xDomain={[from, to]}
        yDomain={[-r.cold, r.cold]}
        xTicks={ticks}
        xFormat={xFormat}
        yFormat={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`}
        yLabel="Degree-days colder than normal since the spread was bought"
        height={130}
        series={[
          { xs: days, ys: colds, color: tint(COLD, 0.45), kind: 'area', base: 0, opacity: 1 },
          { xs: days, ys: colds, color: COLD, width: 2 },
        ]}
        ariaLabel={`Since ${GAS_MONTH_NAMES[s.entry % 12]} 1 the weather has been ${fmt(Math.abs(run))} degree-days ${run >= 0 ? 'colder' : 'warmer'} than normal by ${GAS_MONTH_NAMES[s.exit % 12]} 1.`}
      />
      <Legend
        items={[
          { label: `${spec.long} (bought)`, color: LONG, kind: 'line' },
          { label: `${spec.short} (sold)`, color: SHORT, kind: 'line', dashed: true },
          { label: 'The spread between them', color: tint(GRAPHIC.green, 0.35) },
          { label: 'Storage against plan', color: STORE, kind: 'line' },
          { label: 'Weather', color: COLD, kind: 'line' },
        ]}
      />
      <Readouts
        items={[
          { label: `spread on ${GAS_MONTH_NAMES[s.entry % 12]} 1`, value: gp(s.atEntry), tone: 'green' },
          { label: `on ${GAS_MONTH_NAMES[s.exit % 12]} 1`, value: gp(s.atExit), tone: 'green' },
          { label: `profit on ${lots} lot${lots === 1 ? '' : 's'}, after fees`, value: money(book.total), tone: book.total < 0 ? 'red' : 'green' },
          { label: 'storage against plan', value: `${signedBcf(gaps[0])} → ${signedBcf(gaps[gaps.length - 1])}`, tone: 'gold' },
          { label: 'degree-days colder than normal', value: `${run < 0 ? '−' : ''}${fmt(Math.abs(run))}`, tone: 'teal' },
        ]}
      />
    </>
  );
}

function RuleChart({ rule, threshold }: { rule: TraderRule; threshold: number }) {
  const winters = traderWinters('marApr');
  const always = ruleBookFor('always', 0);
  const book = ruleBookFor(rule, threshold);
  const byEntry = new Map(book.trades.map((t) => [t.trade.entry, t.pnl]));
  const allPnl = always.trades.map((t) => Math.abs(t.pnl));
  const M = Math.ceil(Math.max(...allPnl) / 50_000) * 50_000;
  const W = 640;
  const left = 64;
  const right = W - 12;
  const top = 18;
  const bottom = 178;
  const mid = (top + bottom) / 2;
  const y = (v: number) => mid - ((bottom - top) / 2) * (v / M);
  const col = (right - left) / winters.length;
  const ticks = [-M, -M / 2, 0, M / 2, M];
  const label = winters
    .map((w) => {
      const p = byEntry.get(w.signal.entry);
      return `Year ${w.year + 1}: ${p === undefined ? 'no trade' : money(p)}`;
    })
    .join('; ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} 262`} role="img" aria-label={`Profit after fees, each winter, from ten lots of March/April bought on November 1. ${label}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#9a9a9a' : '#e4e1d8'} strokeWidth={1} />
          <text className="ax ax-e" x={left - 6} y={y(t) + 4}>
            {kUsd(t)}
          </text>
        </g>
      ))}
      {winters.map((w, i) => {
        const cx = left + col * (i + 0.5);
        const p = byEntry.get(w.signal.entry);
        const bw = col * 0.5;
        return (
          <g key={w.year}>
            {p === undefined ? (
              <>
                <rect x={cx - bw / 2} y={mid - 10} width={bw} height={20} fill="none" stroke="#b9b4a6" strokeDasharray="3 3" />
                <text className="ax ax-m" x={cx} y={mid - 16}>
                  no trade
                </text>
              </>
            ) : (
              <>
                <rect x={cx - bw / 2} y={Math.min(y(p), mid)} width={bw} height={Math.max(1, Math.abs(y(p) - mid))} fill={p >= 0 ? GRAPHIC.green : GRAPHIC.red} />
                <text x={cx} y={p >= 0 ? y(p) - 5 : y(p) + 14} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: p >= 0 ? TEXT.green : TEXT.red }}>
                  {kUsd(p)}
                </text>
              </>
            )}
            <text className="ax ax-m" x={cx} y={204} style={{ fill: TEXT.ink }}>
              {`Year ${w.year + 1}`}
            </text>
            <text x={cx} y={223} textAnchor="middle" style={{ fontSize: 12, fill: TEXT.gold }}>
              {signedBcf(w.gapEntry)}
            </text>
            <text x={cx} y={242} textAnchor="middle" style={{ fontSize: 12, fill: TEXT.teal }}>
              {`${w.cold < 0 ? '−' : '+'}${fmt(Math.abs(w.cold))}`}
            </text>
          </g>
        );
      })}
      <text className="ax ax-e" x={left - 6} y={223} style={{ fill: TEXT.gold }}>
        Nov 1
      </text>
      <text className="ax ax-e" x={left - 6} y={242} style={{ fill: TEXT.teal }}>
        winter
      </text>
    </svg>
  );
}

export default function Lesson() {
  // ---- Figure 1.
  const f = useScenario('trader', SPREAD_TRADER_DEFAULTS);
  const fs = f.state;
  const kind = fs.spread;
  const nYears = traderSignals(kind).length;
  const year = Math.min(fs.year, nYears - 1);
  const sig = traderSignal(kind, year);
  const spec = TRADER_SPREADS[kind];

  // ---- Numbers for the prose (computed once; the history is cached).
  const N = useMemo(() => {
    const ma = traderWinters('marApr');
    const jo = traderWinters('janOct');
    const y3 = ma[2];
    const y4 = ma[3];
    const c3 = curveAt(y3.signal.entry);
    const x3 = curveAt(y3.signal.exit);
    const colder = ma.filter((w) => w.cold > 0);
    const milder = ma.filter((w) => w.cold <= 0);
    const gaps = ma.map((w) => -w.gapEntry);
    const byGap = [...ma].sort((a, b) => a.gapEntry - b.gapEntry);
    const best = bestRuleThresholds();
    const at = (t: number) => ({ total: ruleBookFor('behind', t).total, years: ruleYears('behind', t) });
    const lo = best.thresholds[0];
    const hi = best.thresholds[best.thresholds.length - 1];
    const mildest = ma.reduce((a, b) => (b.cold < a.cold ? b : a));
    const widest = ma.reduce((a, b) => (b.change > a.change ? b : a));
    return {
      mildest,
      widest,
      y3,
      y4,
      y3Long: [c3.calder[y3.signal.longDelivery], x3.calder[y3.signal.longDelivery]],
      y3Short: [c3.calder[y3.signal.shortDelivery], x3.calder[y3.signal.shortDelivery]],
      y3EarlyCold: traderCold(2, GAS_MONTH_START[7], GAS_MONTH_START[9]),
      y3Book: traderBook('marApr', 2, 'buy', 10).total,
      y4Book: traderBook('marApr', 3, 'buy', 10).total,
      colder,
      milder,
      follows: traderFollowsWeather('marApr'),
      gapMin: Math.min(...gaps),
      gapMax: Math.max(...gaps),
      minGapYear: ma.find((w) => -w.gapEntry === Math.min(...gaps))!,
      big: [byGap[0], byGap[1]],
      maRange: [Math.min(...ma.map((w) => w.change)), Math.max(...ma.map((w) => w.change))],
      joRange: [Math.min(...jo.map((w) => w.change)), Math.max(...jo.map((w) => w.change))],
      always: ruleBookFor('always', 0),
      best,
      below: at(lo - 1),
      above: at(hi + 1),
      bestYears: ruleYears('behind', lo),
    };
  }, []);

  // ---- Figure 2.
  const g = useScenario('rule', SPREAD_RULE_DEFAULTS);
  const gs = g.state;
  const ruleBook = ruleBookFor(gs.rule, gs.threshold);
  const traded = ruleYears(gs.rule, gs.threshold);
  const solved = spreadTraderSolved(gs);
  const winsOf = ruleBook.trades.filter((t) => t.pnl > 0).length;

  return (
    <LessonPage id="gas/6.2">
      <P>
        <a href={lessonHref('gas/6.1')}>The previous lesson</a> forecast how much gas the region will have in storage at the end of winter, and found the forecast only
        as good as the weather forecast behind it: useful for a week or two, little better than the climate after that. Storage is also what ties one month’s price to
        another’s. It carries gas from the months when it’s cheap to the months when it’s dear, and the difference between the two prices is what a field earns for
        carrying it (<a href={lessonHref('gas/4.4')}>Lesson 4.4</a>, <a href={lessonHref('gas/5.2')}>Lesson 5.2</a>). Traders buy and sell that difference outright,
        with no storage field at all. What moves it, and is understanding storage enough to profit from it?
      </P>
      <P>
        First, the prices. Throughout the eight simulated years of Lesson 6.1, the market quotes a <K c="price">futures</K> price at Calder Hub on the first day of every
        month, for each of the next twelve months. As in <a href={lessonHref('gas/4.5')}>Lesson 4.5</a>, it starts from what is known that morning — the gas in storage
        and the region as it stands — and assumes normal weather from then on, the same calculation the storage operators make for their monthly plans. To that it adds a
        premium for what normal weather leaves out, since a cold spell raises prices more than a mild one lowers them. A contract is 10,000 MMBtu delivered through its
        month. Ours stop trading and settle on the first day of the delivery month, a little simpler than the real contract, and until then every position is marked to
        each month’s new curve. We set the premiums so that, across the eight years, every contract was priced right on average: bought on the first of any month and
        held to settlement, it neither made nor lost money overall. That is a property we gave the simulated market on purpose — a market that has learned its own
        history. If there is money to be made, it lies in knowing in which years the market was wrong.
      </P>
      <P>
        A <K c="price">calendar spread</K> is the purchase of one month’s contract and the sale of another’s. Its price is the difference between them, so it gains
        whenever the month bought rises against the month sold, whether gas as a whole gets dearer or cheaper. The best known in gas is March against April: the last
        month of winter against the first of the injection season. Traders call it the “widowmaker” for how violently it can swing. By March storage is low and its wells
        deliver slowly (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>); a month later the region starts to fill them again.
      </P>
      <P>
        In the next demonstration, buy the March/April spread on November 1 of one of the history’s winters and hold it until the March contract settles on March 1,
        when the April contract is sold back. The upper chart is the two contracts on the first day of each month, with the spread between them shaded; the middle one is
        the region’s <K c="energy">working gas</K> against the plan the storage operators drew up on April 1; the lower one adds up how much colder than normal the
        weather has been since the spread was bought, in <K tone="teal">degree-days</K> (one day 1 °F colder than normal is one degree-day). Choose the winter, the side
        and the number of lots; the January/October spread, bought on April 1 and held through the injection season, is there for comparison:
      </P>

      <Figure name="Gas Spread Trader" scenario={f}>
        <Segmented
          label="Spread"
          value={kind}
          onChange={(v) => f.set({ spread: v })}
          options={(Object.keys(TRADER_SPREADS) as TraderSpread[]).map((k) => ({ value: k, label: TRADER_SPREADS[k].label }))}
        />
        <Segmented
          label="Year"
          value={String(year)}
          onChange={(v) => f.set({ year: Number(v) })}
          options={Array.from({ length: nYears }, (_, i) => ({ value: String(i), label: `Year ${i + 1}` }))}
        />
        <SpreadPanels kind={kind} year={year} side={fs.side} lots={fs.lots} />
        <Segmented
          label="Side"
          value={fs.side}
          onChange={(v) => f.set({ side: v })}
          options={[
            { value: 'buy', label: 'Buy the spread' },
            { value: 'sell', label: 'Sell the spread' },
          ]}
        />
        <Slider
          label="Lots (10,000 MMBtu each leg)"
          tone="green"
          value={fs.lots}
          min={1}
          max={TRADER_LOTS_MAX}
          step={1}
          onChange={(v) => f.set({ lots: v })}
          display={`${fs.lots}`}
        />
        <Caption>
          {`Year ${year + 1}: ${fs.side === 'buy' ? 'bought' : 'sold'} at ${gp(sig.atEntry)} on ${GAS_MONTH_NAMES[sig.entry % 12]} 1, closed at ${gp(sig.atExit)} on ${GAS_MONTH_NAMES[sig.exit % 12]} 1 when the ${spec.long} contract settles.`}
        </Caption>
      </Figure>

      <P>
        In Year 3 the spread costs {gp(N.y3.signal.atEntry)} on November 1: March at {gp(N.y3Long[0])}, April at {gp(N.y3Short[0])}. November and December are close to
        normal — {fmt(Math.abs(N.y3EarlyCold))} degree-days {N.y3EarlyCold >= 0 ? 'colder' : 'warmer'} by January 1 — and the spread barely moves. Then January and
        February turn cold, storage falls behind plan again, and on March 1 the March contract settles at {gp(N.y3Long[1])} against April’s {gp(N.y3Short[1])}. The
        spread has widened to {gp(N.y3.signal.atExit)}, {fmt(N.y3.cold)} degree-days of cold after it was bought, and ten lots make {money(N.y3Book)} after fees. Year 4
        runs the other way. A winter {fmt(-N.y4.cold)} degree-days warmer than normal leaves storage {fmt(N.y4.gapExit, 1)} Bcf ahead of plan by March 1, March costs only
        {' '}{gp(N.y4.signal.atExit)} more than April, and the same ten lots lose {money(-N.y4Book)}.
      </P>
      <P>
        Step through all seven winters and a pattern appears.{' '}
        {N.follows
          ? `In each of the ${WORDS[N.colder.length]} winters colder than normal between November 1 and March 1 (${yearsText(N.colder.map((w) => w.year))}), the spread widened; in each of the ${WORDS[N.milder.length]} milder ones, it narrowed.`
          : 'The spread widened in most winters colder than normal and narrowed in most milder ones.'}{' '}
        Storage on November 1 says nothing about which way it will go. Storage was behind plan every November, by anything from {fmt(N.gapMin, 1)} Bcf in Year{' '}
        {N.minGapYear.year + 1} to {fmt(N.gapMax, 1)} Bcf, and the two biggest shortfalls, Years {N.big[0].year + 1} and {N.big[1].year + 1}, went opposite ways:{' '}
        {signed(N.big[0].change)} and {signed(N.big[1].change)}. The January/October spread, bought in April, moves far less — between {signed(N.joRange[0])} and{' '}
        {signed(N.joRange[1])} by October 1, against {signed(N.maRange[0])} to {signed(N.maRange[1])} for March/April — because a summer has less to surprise anyone
        with. Storage fills more or less on schedule, and the winter it is filling for hasn’t begun.
      </P>

      <H2>What the market already knows</H2>
      <P>
        Why doesn’t November’s shortfall predict anything? Because the market knew it too. The curve on November 1 is drawn from the gas actually in the ground that
        morning, so a region {fmt(N.gapMax, 0)} Bcf short already has a dearer March in its price. What the curve can’t know is the weather to come, and the weather is what moved the
        spread in <FigRef to="Gas Spread Trader">the first demonstration</FigRef>. Still, a rule that sounds like physical insight is tempting: buy ten lots of March/April
        on November 1 only when storage is short of plan by at least some threshold, because a short region is likelier to run out in March. In the next
        demonstration, each bar is a winter’s profit after fees from that rule; under it are that November’s storage against plan and the winter’s degree-days colder
        than normal. Choose the rule and the threshold:
      </P>

      <Figure name="Gas Spread Trader · a rule" scenario={g}>
        <Segmented
          label="Rule"
          value={gs.rule}
          onChange={(v) => g.set({ rule: v })}
          options={[
            { value: 'always', label: 'Buy every November' },
            { value: 'behind', label: 'Buy when storage is short' },
          ]}
        />
        <RuleChart rule={gs.rule} threshold={gs.threshold} />
        <Legend
          items={[
            { label: 'Profit', color: GRAPHIC.green },
            { label: 'Loss', color: GRAPHIC.red },
            { label: 'Storage against plan, November 1', color: STORE },
            { label: 'Degree-days colder than normal, November to March', color: COLD },
          ]}
        />
        <Readouts
          items={[
            { label: 'winters traded', value: `${traded.length} of ${traderSignals('marApr').length}` },
            { label: 'total after fees', value: money(ruleBook.total), tone: ruleBook.total < 0 ? 'red' : 'green' },
            { label: 'fees', value: money(ruleBook.totalFees), tone: 'green' },
            { label: 'winning winters', value: `${winsOf}` },
            { label: 'largest drawdown', value: money(ruleBook.maxDrawdown), tone: 'red' },
          ]}
        />
        <Slider
          label="Storage short of plan by at least"
          tone="gold"
          value={gs.threshold}
          min={0}
          max={SPREAD_RULE_MAX_THRESHOLD}
          step={1}
          onChange={(v) => g.set({ threshold: v })}
          display={`${gs.threshold} Bcf`}
          disabled={gs.rule === 'always'}
        />
        <Caption>
          {gs.rule === 'always'
            ? `Bought every November 1: ${money(ruleBook.total)} over the seven winters.`
            : `Short by ${gs.threshold} Bcf or more: the rule trades ${yearsText(traded)} and ${ruleBook.total >= 0 ? 'makes' : 'loses'} ${money(Math.abs(ruleBook.total))}.`}
        </Caption>
      </Figure>

      <P>
        Bought every November, the spread {N.always.total < 0 ? 'loses' : 'makes'} {money(Math.abs(N.always.total))} over the seven winters, after{' '}
        {money(N.always.totalFees)} in fees: the {WORDS[N.milder.length]} milder winters’ losses outweigh the {WORDS[N.colder.length]} colder winters’ gains. With the rule, everything depends on which winters a threshold happens to let in. At{' '}
        {N.best.thresholds.length > 1 ? `${N.best.thresholds[0]} or ${N.best.thresholds[N.best.thresholds.length - 1]}` : N.best.thresholds[0]} Bcf it trades{' '}
        {yearsText(N.bestYears)} and makes {money(N.best.total)}. One Bcf lower it lets in {yearsText(N.below.years.filter((y) => !N.bestYears.includes(y)))} and{' '}
        {N.below.total < 0 ? 'loses' : 'makes'} {money(Math.abs(N.below.total))}; one Bcf higher it drops{' '}
        {yearsText(N.bestYears.filter((y) => !N.above.years.includes(y)))} and {N.above.total < 0 ? 'loses' : 'makes'} {money(Math.abs(N.above.total))}.
      </P>

      <Challenge
        id="a"
        figure="Gas Spread Trader · a rule"
        question="Set the storage rule to the threshold that would have made the most over the seven winters."
        solved={solved}
        status={
          gs.rule === 'always'
            ? `Bought every November, the spread ${ruleBook.total >= 0 ? 'makes' : 'loses'} ${money(Math.abs(ruleBook.total))}. Switch to the storage rule.`
            : `At ${gs.threshold} Bcf the rule trades ${yearsText(traded)} and ${ruleBook.total >= 0 ? 'makes' : 'loses'} ${money(Math.abs(ruleBook.total))}.`
        }
        success={`Solved: ${gs.threshold} Bcf, ${money(ruleBook.total)} from ${yearsText(traded)}. The rule made money because it happened to include Year ${N.widest.year + 1}, the winter whose spread widened most, and to leave out Year ${N.mildest.year + 1}, the mildest. Neither had anything to do with the storage shortfall it was built on, and one Bcf either side of the best setting the rule ${N.below.total < 0 && N.above.total < 0 ? 'loses money' : 'earns far less'}. Tuned on the same history it is tested on, almost any rule finds a setting that looks good; Lesson 6.5 returns to how to tell such luck from an edge.`}
      />

      <P>
        Understanding storage tells a trader what a spread means: the value of carrying gas from one month to the next, and the price of running short in March. It
        doesn’t say which way the spread will move. On the day it is bought, the spread already holds everything public about storage, and what is left is the weather
        of the months between purchase and settlement, which Lesson 6.1 found no forecast can see. A spread held through a winter is a bet on the winter. That makes it
        useful as insurance — a storage owner who has locked in a spread (<a href={lessonHref('gas/5.2')}>Lesson 5.2</a>) can give part of it back in exchange for
        gaining in a cold winter, and a utility can take the other side — but it is not an edge.
      </P>
      <P>
        Price differences between places might be different. A basis depends on pipes and production, which change slowly and in public: a basin’s output grows month
        after month, and pipeline expansions are announced years before they open. If the market prices those differences from the region as it stands, a hypothesis
        about where the region is going might beat it. That is the subject of <a href={lessonHref('gas/6.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
