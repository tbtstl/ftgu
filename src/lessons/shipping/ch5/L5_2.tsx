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
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { equilibrium, type MarketConditions } from '../../../engines/shipping/market';
import { TC_ROUTES, monthAverage, routeTceAt } from '../../../engines/shipping/indices';
import { dailyIndex } from '../../../engines/shipping/ffa';
import { routeSeries, spreadTrade } from '../../../engines/shipping/strategies';
import { sharesAt } from '../../../engines/shipping/forecast';
import { HISTORY_EVENTS, HISTORY_MONTHS, monthLabel, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const perDay = (x: number) => `$${fmt(x)}/day`;
const money = (x: number) => `${x < 0 ? '−' : ''}$${fmt(Math.abs(x))}`;
const signedDay = (x: number) => `${x >= 0 ? '+' : '−'}$${fmt(Math.abs(x))}`;

// ---------------------------------------------------------------------------
// Demonstration 1: one month's market with its physical drivers changed.

export interface DriverState {
  /** Calendar month, 0–11. */
  month: number;
  /** Multipliers on Brazil's and Australia's iron ore, Brazil's soybeans, Indonesia's coal. */
  brazilOre: number;
  ausOre: number;
  soy: number;
  coal: number;
  panama: boolean;
  /** Extra days waiting per call at Qingdao. */
  qingdao: number;
}

export const DRIVER_DEFAULTS: DriverState = { month: 6, brazilOre: 1, ausOre: 1, soy: 1, coal: 1, panama: false, qingdao: 0 };

export interface Spreads {
  cape: number;
  kmax: number;
  /** Capesize minus Kamsarmax earnings, $/day. */
  cls: number;
  /** Each class's fronthaul minus its transpacific round voyage, $/day. */
  capeRoute: number;
  kmaxRoute: number;
}

function conditions(s: DriverState, cls: ClassId): MarketConditions {
  const routeScale: Record<string, number> =
    cls === 'cape'
      ? { 'C-TUB-QIN': s.brazilOre, 'C-TUB-ROT': s.brazilOre, 'C-PHE-QIN': s.ausOre }
      : { 'P-SAN-QIN': s.soy, 'P-SAM-QIN': s.coal, 'P-SAM-PAR': s.coal };
  return {
    month: s.month,
    routeScale,
    closed: s.panama ? ['panama'] : [],
    congestion: s.qingdao > 0 ? { QIN: s.qingdao } : undefined,
  };
}

const route = (cls: ClassId, id: string) => TC_ROUTES[cls].find((r) => r.id === id)!;

/** Both classes' earnings and the three spreads under a set of drivers. */
export function spreadsAt(s: DriverState): Spreads {
  const c = equilibrium('cape', conditions(s, 'cape'));
  const k = equilibrium('kmax', conditions(s, 'kmax'));
  return {
    cape: c.tce,
    kmax: k.tce,
    cls: c.tce - k.tce,
    capeRoute: routeTceAt(c, route('cape', 'C-FH')) - routeTceAt(c, route('cape', 'C-TP')),
    kmaxRoute: routeTceAt(k, route('kmax', 'P-FH')) - routeTceAt(k, route('kmax', 'P-TP')),
  };
}

const DRIVERS: Array<{ key: keyof DriverState; name: string }> = [
  { key: 'brazilOre', name: 'Brazil’s ore' },
  { key: 'ausOre', name: 'Australia’s ore' },
  { key: 'soy', name: 'Brazil’s soybeans' },
  { key: 'coal', name: 'Indonesia’s coal' },
  { key: 'panama', name: 'The Panama closure' },
  { key: 'qingdao', name: 'Waiting at Qingdao' },
];

/** Each changed driver's effect on its own, against the month's baseline. */
export function driverEffects(s: DriverState): Array<{ name: string; d: Spreads }> {
  const base = spreadsAt({ ...DRIVER_DEFAULTS, month: s.month });
  return DRIVERS.filter((x) => s[x.key] !== DRIVER_DEFAULTS[x.key]).map((x) => {
    const one = spreadsAt({ ...DRIVER_DEFAULTS, month: s.month, [x.key]: s[x.key] });
    return {
      name: x.name,
      d: { cape: one.cape - base.cape, kmax: one.kmax - base.kmax, cls: one.cls - base.cls, capeRoute: one.capeRoute - base.capeRoute, kmaxRoute: one.kmaxRoute - base.kmaxRoute },
    };
  });
}

// Numbers the prose quotes, in July.
const BASE = spreadsAt(DRIVER_DEFAULTS);
const HALF_BRAZIL = spreadsAt({ ...DRIVER_DEFAULTS, brazilOre: 0.5 });
const MORE_BRAZIL = spreadsAt({ ...DRIVER_DEFAULTS, brazilOre: 1.5 });
const SOY_UP = spreadsAt({ ...DRIVER_DEFAULTS, soy: 1.3 });
const PANAMA = spreadsAt({ ...DRIVER_DEFAULTS, panama: true });
const QIN4 = spreadsAt({ ...DRIVER_DEFAULTS, qingdao: 4 });
const ROT_EDGE = (closed: boolean) => {
  const e = equilibrium('kmax', conditions({ ...DRIVER_DEFAULTS, panama: closed }, 'kmax'));
  return { nm: (e.plan.open.ROT ?? 0) - (e.plan.open.QIN ?? 0), mile: e.ballastMileCost };
};
const ROT_OPEN = ROT_EDGE(false);
const ROT_CLOSED = ROT_EDGE(true);
const CAPE_MILE = equilibrium('cape', conditions(DRIVER_DEFAULTS, 'cape')).ballastMileCost;
const CAPE_MILE_HALF = equilibrium('cape', conditions({ ...DRIVER_DEFAULTS, brazilOre: 0.5 }, 'cape')).ballastMileCost;

// ---------------------------------------------------------------------------
// Demonstration 2: a spread trade on the simulated history.

const HIST = standardHistory();
const CAPE_INDEX = dailyIndex('cape');
const KMAX_INDEX = dailyIndex('kmax');
const MONTHS = Array.from({ length: HISTORY_MONTHS }, (_, t) => t);
const CAPE_M = MONTHS.map((t) => monthAverage(CAPE_INDEX, t));
const KMAX_M = MONTHS.map((t) => monthAverage(KMAX_INDEX, t));
const CFH = routeSeries(HIST.cls.cape, 'C-FH', 'cape');
const CTP = routeSeries(HIST.cls.cape, 'C-TP', 'cape');
const KFH = routeSeries(HIST.cls.kmax, 'P-FH', 'kmax');
const KTP = routeSeries(HIST.cls.kmax, 'P-TP', 'kmax');

export type Legs = 'class' | 'capeRoute' | 'kmaxRoute';
export const LEGS: Record<Legs, { name: string; long: string; short: string; series: [number[], number[]] }> = {
  class: { name: 'Capesize − Kamsarmax', long: 'Capesize index', short: 'Kamsarmax index', series: [CAPE_M, KMAX_M] },
  capeRoute: { name: 'Capesize fronthaul − transpacific', long: 'Capesize fronthaul', short: 'Capesize transpacific', series: [CFH, CTP] },
  kmaxRoute: { name: 'Kamsarmax fronthaul − transpacific', long: 'Kamsarmax fronthaul', short: 'Kamsarmax transpacific', series: [KFH, KTP] },
};

export interface TradeState {
  legs: Legs;
  side: 'long' | 'short';
  entry: number;
  held: number;
  days: number;
}

/** A spread trade's result: long buys the first leg and sells the second; short the reverse. */
export function tradeResult(s: TradeState) {
  const [a, b] = LEGS[s.legs].series;
  const exit = Math.min(HISTORY_MONTHS - 1, s.entry + s.held);
  const r = spreadTrade(a, b, s.entry, exit, s.days);
  return { ...r, exitMonth: exit, pnl: (s.side === 'long' ? 1 : -1) * r.pnl };
}

/** The month the news reaches the market in the challenge: April of Year 6. */
export const NEWS_MONTH = 63;
export const TARGET = 300_000;

/**
 * The challenge: trade the class spread on the news of Brazil's mine disruption — entered in
 * April of Year 6, held at most six months — and make at least $300,000.
 */
export function newsTradeSolved(s: TradeState): boolean {
  return s.legs === 'class' && s.entry === NEWS_MONTH && s.held <= 6 && tradeResult(s).pnl >= TARGET - 1e-6;
}

const CLASS_SPREAD = CAPE_M.map((c, t) => c - KMAX_M[t]);
const SPREAD_MIN = Math.min(...CLASS_SPREAD);
const SPREAD_MAX = Math.max(...CLASS_SPREAD);

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
}
function sdChange(a: number[]) {
  const d = a.slice(1).map((x, i) => x - a[i]);
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  return Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1));
}
const CORR = corr(CAPE_M, KMAX_M);
const SD_CAPE = sdChange(CAPE_M);
const SD_KMAX = sdChange(KMAX_M);
const SD_SPREAD = sdChange(CLASS_SPREAD);

/** How much a disruption moved a class's earnings in each month it lasted, against the same month without it. */
function eventEffects(cls: ClassId, label: string): number[] {
  const ev = HISTORY_EVENTS.find((e) => e.label === label)!;
  const out: number[] = [];
  for (let t = ev.from; t < ev.to; t++) {
    const m = HIST.cls[cls][t];
    const base = { demand: m.demand, month: m.month, fleet: m.fleet, bunker: m.bunker, cohortShares: sharesAt(m) };
    const w = equilibrium(cls, { ...base, routeScale: ev.routeScale, closed: ev.closed, congestion: ev.congestion }).tce;
    out.push(w / equilibrium(cls, base).tce - 1);
  }
  return out;
}
const BRAZIL_EVENT = HISTORY_EVENTS.find((e) => e.routeScale?.['C-TUB-QIN'])!;
const PANAMA_EVENT = HISTORY_EVENTS.find((e) => e.closed?.includes('panama'))!;
const BRAZIL_CAPE = eventEffects('cape', BRAZIL_EVENT.label);
const BRAZIL_KMAX = eventEffects('kmax', BRAZIL_EVENT.label);
const PANAMA_KMAX = eventEffects('kmax', PANAMA_EVENT.label);
const NEWS_BEST = tradeResult({ legs: 'class', side: 'short', entry: NEWS_MONTH, held: 1, days: 90 });
const NEWS_LATE = tradeResult({ legs: 'class', side: 'short', entry: NEWS_MONTH, held: 5, days: 90 });

const EVENT_SHORT: Record<string, string> = {
  [HISTORY_EVENTS[0].label]: 'China ports',
  [BRAZIL_EVENT.label]: 'Brazil ore',
  [PANAMA_EVENT.label]: 'Panama',
};

// ---------------------------------------------------------------------------
// Demonstration 1's bar chart.

const ROWS: Array<{ key: keyof Spreads; name: string; sub: string }> = [
  { key: 'cape', name: 'Capesize earnings', sub: 'market TCE' },
  { key: 'kmax', name: 'Kamsarmax earnings', sub: 'market TCE' },
  { key: 'cls', name: 'Class spread', sub: 'Capesize − Kamsarmax' },
  { key: 'capeRoute', name: 'Capesize route spread', sub: 'fronthaul − transpacific' },
  { key: 'kmaxRoute', name: 'Kamsarmax route spread', sub: 'fronthaul − transpacific' },
];
const X_MIN = -30_000;
const X_MAX = 60_000;

function SpreadBars({ now, base, month }: { now: Spreads; base: Spreads; month: number }) {
  const x = scale(X_MIN, X_MAX, 196, 600);
  const rowH = 38;
  const top = 30;
  const clip = (v: number) => Math.max(X_MIN, Math.min(X_MAX, v));
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${top + ROWS.length * rowH + 30}`}
      role="img"
      aria-label={`${MONTH_NAMES[month]}: ${ROWS.map((r) => `${r.name} ${perDay(now[r.key])} (baseline ${perDay(base[r.key])})`).join('; ')}.`}
    >
      <text className="ax" x={196} y={14}>
        $ per day · dashed ticks: {MONTH_NAMES[month]} with every driver at its baseline
      </text>
      {[-30_000, 0, 30_000, 60_000].map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={top - 6} y2={top + ROWS.length * rowH - 6} />
          <text className="ax ax-m" x={x(t)} y={top + ROWS.length * rowH + 10}>
            {t === 0 ? '$0' : `${t < 0 ? '−' : ''}$${fmt(Math.abs(t) / 1000)}k`}
          </text>
        </g>
      ))}
      {ROWS.map((r, i) => {
        const y = top + i * rowH;
        const v = now[r.key];
        const b = base[r.key];
        const x0 = x(0);
        const x1 = x(clip(v));
        const over = v > X_MAX || v < X_MIN;
        const level = i < 2;
        const fill = v < 0 ? GRAPHIC.red : level ? tint(GRAPHIC.green, 0.55) : GRAPHIC.green;
        return (
          <g key={r.key}>
            {i === 2 && <line x1={10} x2={630} y1={y - 8} y2={y - 8} stroke="#e4e1da" />}
            <text x={10} y={y + 9} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
              {r.name}
            </text>
            <text x={10} y={y + 24} className="ax">
              {r.sub}
            </text>
            <rect x={Math.min(x0, x1)} y={y} width={Math.abs(x1 - x0)} height={20} fill={fill} />
            <line x1={x(clip(b))} x2={x(clip(b))} y1={y - 4} y2={y + 24} stroke="#333" strokeWidth={1.5} strokeDasharray="3 2" />
            <text
              x={v >= 0 ? Math.min(x1 + 6, 604) : Math.max(x1 - 6, 200)}
              y={y + 15}
              textAnchor={v >= 0 ? (x1 + 70 > 640 ? 'end' : 'start') : 'end'}
              style={{ fontSize: 12, fontWeight: 600, fill: v < 0 ? TEXT.red : TEXT.green }}
            >
              {money(v)}
              {over ? ' ›' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function effectSentence(e: { name: string; d: Spreads }): string {
  const parts: string[] = [];
  const add = (label: string, v: number) => {
    if (Math.abs(v) >= 100) parts.push(`${label} ${signedDay(v)}`);
  };
  add('Capesize', e.d.cape);
  add('Kamsarmax', e.d.kmax);
  add('class spread', e.d.cls);
  add('Capesize route spread', e.d.capeRoute);
  add('Kamsarmax route spread', e.d.kmaxRoute);
  return parts.length ? `${e.name}: ${parts.join(', ')}.` : `${e.name} changes nothing this month.`;
}

export default function Lesson() {
  const dr = useScenario('drivers', DRIVER_DEFAULTS);
  const s = dr.state;
  const now = spreadsAt(s);
  const base = useMemo(() => spreadsAt({ ...DRIVER_DEFAULTS, month: s.month }), [s.month]);
  const effects = driverEffects(s);

  const tr = useScenario('trade', { legs: 'class' as Legs, side: 'long' as 'long' | 'short', entry: 24, held: 6, days: 30 });
  const t = tr.state;
  const res = tradeResult(t);
  const leg = LEGS[t.legs];
  const xs = MONTHS.map((m) => m / 12);
  const solved = newsTradeSolved(t);

  return (
    <LessonPage id="shipping/5.2">
      <P>
        <a href={lessonHref('shipping/5.1')}>The previous lesson</a> forecast the level of freight earnings from the fleet, the cargo and the ports. A forecast of
        the level bets on everything at once: the world’s appetite for steel and grain, the orderbook, the price of fuel. Many freight traders would rather bet on a
        difference — between two sizes of ship, or between two routes — because a spread cancels whatever moves both legs together and keeps what moves only one.
        If you believe Brazil’s iron-ore mines are about to ship less, a bet on Capesize earnings alone also bets on China’s steel mills; a bet on Capesizes{' '}
        <i>against</i> Kamsarmaxes keeps mostly the part that is Brazil’s ore.
      </P>
      <P>
        Two kinds of spread matter here. The <K tone="green">class spread</K> is Capesize earnings minus Kamsarmax earnings. Each size of ship serves its own
        trades — the ports and cargo lots of <a href={lessonHref('shipping/2.1')}>Lesson 2.1</a>, iron ore on Capesizes and grain and coal on Kamsarmaxes in our
        world, as <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a> counted them — so each responds to its own cargoes. The <K tone="green">route spread</K>{' '}
        compares two trips for the same class: a fronthaul, delivered in the Atlantic and redelivered in China, against a transpacific round voyage. It is the
        positional value of <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>, priced the way <a href={lessonHref('shipping/4.3')}>Lesson 4.3</a> showed.
      </P>
      <P>
        So what moves a spread, and can you trade it? In the next demonstration, choose a month and change the physical drivers behind the trades. Both markets
        clear again with every change. The dashed ticks mark that month with every driver at its baseline, and the caption names what each change moved. As
        everywhere in this course, the earnings are simulated:
      </P>

      <Figure name="Freight Spread Trader" scenario={dr}>
        <SpreadBars now={now} base={base} month={s.month} />
        <Readouts
          items={[
            { label: 'Capesize earnings', value: perDay(now.cape), tone: 'green' },
            { label: 'Kamsarmax earnings', value: perDay(now.kmax), tone: 'green' },
            { label: 'class spread', value: money(now.cls), tone: now.cls < 0 ? 'red' : 'green' },
            { label: 'change in the class spread', value: signedDay(now.cls - base.cls) },
          ]}
        />
        <Slider label="Month" tone="teal" value={s.month} min={0} max={11} onChange={(v) => dr.set({ month: v })} display={MONTH_NAMES[s.month]} />
        <Slider label="Brazil’s iron-ore exports" tone="orange" value={s.brazilOre} min={0.5} max={1.5} step={0.05} onChange={(v) => dr.set({ brazilOre: v })} display={pct(s.brazilOre)} />
        <Slider label="Australia’s iron-ore exports" tone="orange" value={s.ausOre} min={0.5} max={1.5} step={0.05} onChange={(v) => dr.set({ ausOre: v })} display={pct(s.ausOre)} />
        <Slider label="Brazil’s soybean exports" tone="orange" value={s.soy} min={0.5} max={1.5} step={0.05} onChange={(v) => dr.set({ soy: v })} display={pct(s.soy)} />
        <Slider label="Indonesia’s coal exports" tone="orange" value={s.coal} min={0.5} max={1.5} step={0.05} onChange={(v) => dr.set({ coal: v })} display={pct(s.coal)} />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={s.qingdao} min={0} max={6} step={0.5} onChange={(v) => dr.set({ qingdao: v })} display={`${fmt(s.qingdao, 1)} days`} />
        <Checkbox label="Panama Canal closed" checked={s.panama} onChange={(v) => dr.set({ panama: v })} />
        <Caption>{effects.length ? effects.map(effectSentence).join(' ') : `Every driver is at its baseline for ${MONTH_NAMES[s.month]}. Move one and the caption will say what it moved.`}</Caption>
      </Figure>

      <P>
        In July at the baseline, Capesizes earn {perDay(BASE.cape)} and Kamsarmaxes {perDay(BASE.kmax)}, a class spread of {money(BASE.cls)}. Now halve Brazil’s
        ore exports. Fewer long hauls round the Cape of Good Hope means far fewer Capesize ship-days needed, the fleet runs into its lay-up floor, and Capesize
        earnings fall to {perDay(HALF_BRAZIL.cape)}; the class spread swings to {money(HALF_BRAZIL.cls)}. Kamsarmax earnings don’t move a dollar, because no
        Kamsarmax carries Brazilian ore. Bring the ore back and raise Brazil’s soybeans to 130% instead: now only the other leg moves, Kamsarmax earnings rise to{' '}
        {perDay(SOY_UP.kmax)} and the spread turns to {money(SOY_UP.cls)}. Each cargo moves the leg of the class that carries it, which is what makes the class
        spread a bet on particular trades. Try the months too: the soybean harvest makes the same change far larger in April than in October.
      </P>

      <H2>What moves the route spread</H2>
      <P>
        The route spread follows different causes. A fronthaul pays more than a round voyage because it leaves the ship in China, where ships are plentiful, and
        the fronthaul premium is the cost of the ballast leg needed to get her back: its miles, times what a mile of ballast costs, spread over the trip. Close the
        Panama Canal in this demonstration. Grain from the US Gulf now has to be fetched the long way from Asia (<a href={lessonHref('shipping/3.3')}>Lesson
        3.3</a>), so a Kamsarmax already in the Atlantic is worth more: in July, a ship open at Rotterdam goes from {fmt(ROT_OPEN.nm)} to {fmt(ROT_CLOSED.nm)}{' '}
        nautical miles of ballast ahead of one open in Qingdao. The Kamsarmax route spread jumps from {perDay(BASE.kmaxRoute)} to {perDay(PANAMA.kmaxRoute)}, while
        Kamsarmax earnings rise only to {perDay(PANAMA.kmax)} and Capesizes, which never used the canal, are untouched.
      </P>
      <P>
        Geography isn’t the only cause. Halving Brazil’s ore lowers the Capesize route spread from {perDay(BASE.capeRoute)} to {perDay(HALF_BRAZIL.capeRoute)}{' '}
        without moving a single ballast mile: a mile costs less when ships earn less, {fmt(CAPE_MILE_HALF)} dollars instead of {fmt(CAPE_MILE)}, because most of its
        cost is the ship’s time. Push Brazil’s ore to 150% instead and the Capesize route spread climbs to {perDay(MORE_BRAZIL.capeRoute)}: more ore loads in
        the Atlantic, more ships must ballast there to fetch it, and every mile of that ballast is dearer because Capesizes now earn{' '}
        {perDay(MORE_BRAZIL.cape)}. And four extra days of waiting at Qingdao (<a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>) take ships out of both markets at
        once, raising Capesize earnings to {perDay(QIN4.cape)}, Kamsarmax earnings to {perDay(QIN4.kmax)} and both route spreads with them. The class spread moves
        by only {signedDay(QIN4.cls - BASE.cls)}, less than either leg: congestion is a cause both legs share, and a spread cancels most of it.
      </P>

      <H2>Trading the spread</H2>
      <P>
        Nobody needs to own ships to hold a spread. Forward freight agreements trade on routes and on class averages (<a href={lessonHref('shipping/4.5')}>Lesson
        4.5</a>), so a trader can buy one leg and sell the other: long the spread if they expect it to widen, short if they expect it to narrow. Each leg is its own
        contract, settled on its own index’s monthly average, so the profit is the change in the spread times the days traded. Being right about where Capesize
        earnings go earns nothing if Kamsarmax earnings go the same way; the trade is paid only for the difference. In the next
        demonstration, take a spread position on the twelve simulated years of history, settled on each month’s average, and choose the legs, the side, when to
        enter, how long to hold and how many days of each leg to trade:
      </P>

      <Figure name="Freight Spread Trader · history" scenario={tr}>
        <Segmented
          label="Legs"
          value={t.legs}
          onChange={(v) => tr.set({ legs: v })}
          options={[
            { value: 'class', label: 'Capesize − Kamsarmax' },
            { value: 'capeRoute', label: 'Capesize route' },
            { value: 'kmaxRoute', label: 'Kamsarmax route' },
          ]}
        />
        <Segmented
          label="Side"
          value={t.side}
          onChange={(v) => tr.set({ side: v })}
          options={[
            { value: 'long', label: 'Long the spread' },
            { value: 'short', label: 'Short the spread' },
          ]}
        />
        <XYChart
          ariaLabel={`${leg.name}, month by month over twelve simulated years, from ${money(Math.min(...leg.series[0].map((a, i) => a - leg.series[1][i])))} to ${money(Math.max(...leg.series[0].map((a, i) => a - leg.series[1][i])))} a day. ${t.side === 'long' ? 'Long' : 'Short'} from ${monthLabel(t.entry)} to ${monthLabel(res.exitMonth)}: the spread goes from ${money(res.entry)} to ${money(res.exit)}, and the trade makes ${money(res.pnl)}.`}
          series={[{ xs, ys: res.path, color: GRAPHIC.green, width: 2 }]}
          xMin={0}
          xMax={12}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`}
          yLabel={`${leg.name}, $ per day`}
          refLines={[{ y: 0, color: '#9a9a9a', dash: '2 3' }]}
          bands={[
            ...HISTORY_EVENTS.map((e) => ({ from: e.from / 12, to: e.to / 12, color: tint(GRAPHIC.red, 0.16), label: EVENT_SHORT[e.label] })),
            { from: t.entry / 12, to: res.exitMonth / 12, color: tint(GRAPHIC.teal, 0.22) },
          ]}
          markers={[
            { x: t.entry / 12, y: res.entry, color: TEXT.teal, label: 'in', anchor: 'end' },
            { x: res.exitMonth / 12, y: res.exit, color: TEXT.teal, label: 'out', anchor: 'start' },
          ]}
          height={230}
        />
        <Readouts
          items={[
            { label: `spread on entry, ${monthLabel(t.entry)}`, value: money(res.entry), tone: 'green' },
            { label: `spread on exit, ${monthLabel(res.exitMonth)}`, value: money(res.exit), tone: 'green' },
            { label: `${t.side === 'long' ? 'long' : 'short'} ${t.days} days a leg`, value: money(res.pnl), tone: res.pnl < 0 ? 'red' : 'green' },
          ]}
        />
        <Slider label="Enter in" tone="teal" value={t.entry} min={0} max={HISTORY_MONTHS - 2} onChange={(v) => tr.set({ entry: v })} display={monthLabel(t.entry)} />
        <Slider label="Hold for" tone="teal" value={t.held} min={1} max={12} onChange={(v) => tr.set({ held: v })} display={`${t.held} month${t.held === 1 ? '' : 's'}`} />
        <Slider label="Days of each leg" value={t.days} min={15} max={90} step={15} onChange={(v) => tr.set({ days: v })} display={`${t.days} days`} />
        <Caption>
          {t.side === 'long' ? `Long buys the ${leg.long} and sells the ${leg.short}` : `Short sells the ${leg.long} and buys the ${leg.short}`}; the result is the change in the spread
          times the days traded. Shaded: the history’s three disruptions.
        </Caption>
      </Figure>

      <P>
        Over the history the class spread runs from {money(SPREAD_MIN)} to {money(SPREAD_MAX)} a day. The disruptions leave their marks where the physics says
        they should — the same causes you switched on and off in <FigRef to="Freight Spread Trader">the first demonstration</FigRef>. While Brazil’s mines are disrupted, from {monthLabel(BRAZIL_EVENT.from)}, Capesize earnings run {pct(-Math.max(...BRAZIL_CAPE))} to{' '}
        {pct(-Math.min(...BRAZIL_CAPE))} below what the same months would have paid without it, and Kamsarmax earnings{' '}
        {BRAZIL_KMAX.every((x) => Math.abs(x) < 0.005) ? 'not at all' : `by up to ${pct(Math.max(...BRAZIL_KMAX.map(Math.abs)))}`}. When drought restricts the Panama
        Canal from {monthLabel(PANAMA_EVENT.from)}, Kamsarmax earnings run {pct(Math.min(...PANAMA_KMAX))} to {pct(Math.max(...PANAMA_KMAX))} higher, and the
        Kamsarmax route spread with them. Switch the legs and look.
      </P>
      <P>
        Spreads are not a quiet trade, though. In our history the two classes’ monthly indices have a correlation of only {fmt(CORR, 2)}, and the class spread moves
        more from month to month than either leg does on its own: a typical monthly change of {perDay(SD_SPREAD)}, against {perDay(SD_CAPE)} for the Capesize index
        and {perDay(SD_KMAX)} for the Kamsarmax. A spread removes what the legs share; what remains is the specific cause, plus everything else that happens to
        move one leg — a harvest, a season, a disruption in the other trade. The trade pays only if its cause actually happens, and only while it lasts.
      </P>

      <P>
        Northwind Bulk already holds both legs of the class spread without trying: Albatross earns the Capesize market and Kestrel the Kamsarmax one. Selling
        the Capesize index forward and buying the Kamsarmax index would shift the company’s exposure away from Brazil’s and Australia’s ore and toward the grain
        and coal trades, without selling or buying a ship. The same pair of contracts is a bet for a trader with no ships and a hedge for an owner with the wrong
        mix of them.
      </P>

      <Challenge
        id="a"
        question={`News of trouble at Brazil’s iron-ore mines reaches the market at the end of April, Year 6. Trade the class spread on it: enter that month, hold for at most six months, and make at least ${money(TARGET)}.`}
        solved={solved}
        status={
          t.legs !== 'class'
            ? 'Choose the Capesize − Kamsarmax legs first.'
            : t.entry !== NEWS_MONTH
              ? `Enter in ${monthLabel(NEWS_MONTH)}; you’re entering in ${monthLabel(t.entry)}.`
              : t.held > 6
                ? 'Hold for six months or less.'
                : `${t.side === 'long' ? 'Long' : 'Short'} for ${t.held} month${t.held === 1 ? '' : 's'} at ${t.days} days a leg makes ${money(res.pnl)}.`
        }
        success={`Solved. Fewer Brazilian cargoes hit only the Capesize leg, so the trade is short the spread, and it has to be big: the spread falls from ${money(NEWS_BEST.entry)} in April to ${money(NEWS_BEST.exit)} in May, ${money(NEWS_BEST.entry - NEWS_BEST.exit)} a day, so only 75 or 90 days a leg clear the target. Timing matters as much as direction: held for five months, into the end of the soybean season, the same position ${NEWS_LATE.pnl < 0 ? `loses ${money(-NEWS_LATE.pnl)}` : `makes only ${money(NEWS_LATE.pnl)}`}, because the Kamsarmax leg falls too.`}
      />

      <P>
        A spread trades the difference on paper. Owners and operators can also take a view with a real ship: charter one in for a year at a fixed daily hire and
        trade her on the spot market, or charter their own ship out and lock in the hire. <a href={lessonHref('shipping/5.3')}>The next lesson</a> builds that
        trade — and asks what physical conditions it needs in order to pay.
      </P>
    </LessonPage>
  );
}
