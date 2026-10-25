import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  DataTable,
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
import { cargoOffers, freightRatios, DEFAULT_WORLD, type CargoOffer, type CargoWorld } from '../../../engines/shipping/company';
import { geography } from '../../../engines/shipping/market';
import { seaDistance, seaRoute } from '../../../engines/shipping/network';
import { ballastPlan } from '../../../engines/shipping/transport';
import { ballastDraft, ladenDraft } from '../../../engines/shipping/voyage';
import { HISTORY_EVENTS, MONTH_SHORT, eventAt, monthLabel, standardHistory } from '../../../model/shipping/history';
import { PLACE } from '../../../model/shipping/geo';
import { MARKET_CLASSES, OFF_HIRE_DAYS, ROUTES, TRADE_PORTS, type ClassId, type Route } from '../../../model/shipping/trades';
import { WorldMap } from '../shared/WorldMap';
import {
  STARTING,
  START_MONTH,
  confirmReset,
  partChanged,
  resetWorldFields,
  updateCompany,
  useCompany,
  when,
  worldFieldsChanged,
} from '../shared/company';
import { CompanySoFar, ViewSwitch, worldText, type CompanyView } from '../shared/CompanyUi';

const HIST = standardHistory();
const MONTH = 365 / 12;
const LADEN_KN = 12;
const BALLAST_KN = 13;
const SOY = 'P-SAN-QIN';
/** Loading ports on the Atlantic side: Brazil and the US Gulf. */
const ATLANTIC = new Set(['TUB', 'SAN', 'NOL']);
const CLASS_COLOR: Record<ClassId, string> = { cape: GRAPHIC.blue, kmax: GRAPHIC.orange };
const CLASS_TEXT: Record<ClassId, string> = { cape: TEXT.blue, kmax: TEXT.orange };
const CLASS_NAME: Record<ClassId, string> = { cape: 'Capesize', kmax: 'Kamsarmax' };

/** The export-strength dials, each scaling the routes that load in that region. */
export const GROUPS: Array<{ key: string; label: string; routes: string[] }> = [
  { key: 'brazilOre', label: 'Brazil’s iron ore', routes: ['C-TUB-QIN', 'C-TUB-ROT'] },
  { key: 'ausOre', label: 'Australia’s iron ore', routes: ['C-PHE-QIN'] },
  { key: 'soy', label: 'Brazil’s soybeans', routes: ['P-SAN-QIN'] },
  { key: 'grain', label: 'US grain', routes: ['P-NOL-QIN', 'P-NOL-ROT'] },
  { key: 'indoCoal', label: 'Indonesian coal', routes: ['P-SAM-QIN', 'P-SAM-PAR'] },
  { key: 'coal', label: 'Australian and South African coal', routes: ['C-NEW-QIN', 'P-NEW-QIN', 'C-RBY-PAR', 'P-RBY-PAR'] },
];

/** The starting cargo world (what the prose describes). */
export const W0: CargoWorld = { ...DEFAULT_WORLD, start: START_MONTH, routeScale: {} };

const place = (id: string) => PLACE[id].name;
const routeName = (r: Route) => `${place(r.from)}–${place(r.to)}`;
const perT = (x: number) => (Number.isFinite(x) ? `$${fmt(x, 2)}/t` : '—');

/**
 * The cargoes brokers can expect over the period, by route: the same arithmetic as the cargo
 * generator's average — each trade's share of world voyages in its season, times the brokers' reach.
 */
export function expectedOffers(w: CargoWorld): Record<string, number> {
  const out: Record<string, number> = {};
  for (let week = 0; week < w.weeks; week++) {
    const t = Math.min(HIST.months - 1, w.start + Math.floor((week * 7) / MONTH));
    const ev = eventAt(t);
    for (const route of ROUTES) {
      const m = HIST.cls[route.cls][t];
      const perWeek = (route.mtpa * 1e6 * route.season[m.month] * m.demand * (w.routeScale[route.id] ?? 1) * (ev?.routeScale?.[route.id] ?? 1)) / MARKET_CLASSES[route.cls].cargo / 52;
      out[route.id] = (out[route.id] ?? 0) + perWeek * w.reach;
    }
  }
  return out;
}

/** Brazilian soybeans' share of the Kamsarmax cargoes brokers can expect. */
export function expectedSoyShare(w: CargoWorld): number {
  const e = expectedOffers(w);
  const kmax = ROUTES.filter((r) => r.cls === 'kmax').reduce((a, r) => a + e[r.id], 0);
  return kmax > 0 ? e[SOY] / kmax : 0;
}

export const SOY_TARGET = 0.25;
/**
 * The longest window anywhere in the history in which soybeans are expected to make up a quarter of
 * the Kamsarmax cargoes: 25 weeks, from a March (checked by longestSoyWindow in the tests).
 */
export const LONGEST_SOY = { weeks: 25, month: 2 };
/** The challenge accepts a window within a week of the longest. */
export const SOY_MIN_WEEKS = LONGEST_SOY.weeks - 1;

/** The longest qualifying window over every start the demonstration allows, and the starts that reach it. */
export function longestSoyWindow(): { weeks: number; starts: number[] } {
  let weeks = 0;
  let starts: number[] = [];
  for (let start = 0; start <= 117; start++) {
    let m = 0;
    for (let k = 13; k <= 52; k++) if (expectedSoyShare({ ...W0, start, weeks: k }) >= SOY_TARGET - 1e-9) m = k;
    if (m > weeks) {
      weeks = m;
      starts = [];
    }
    if (m === weeks && m > 0) starts.push(start);
  }
  return { weeks, starts };
}

const isNormal = (w: CargoWorld) => Object.values(w.routeScale).every((v) => Math.abs(v - 1) < 1e-9);

/**
 * The challenge: every export at its normal strength, soybeans at least a quarter of the expected
 * Kamsarmax cargoes, over a window within a week of the longest that can manage it.
 */
export function soySolved(w: CargoWorld): boolean {
  return isNormal(w) && w.weeks >= SOY_MIN_WEEKS && expectedSoyShare(w) >= SOY_TARGET - 1e-9;
}

export interface RouteRow {
  route: Route;
  n: number;
  avg: number;
  min: number;
  max: number;
}

export function routeRows(offers: CargoOffer[]): RouteRow[] {
  return ROUTES.map((route) => {
    const f = offers.filter((o) => o.route.id === route.id).map((o) => o.freight);
    return { route, n: f.length, avg: f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN, min: f.length ? Math.min(...f) : NaN, max: f.length ? Math.max(...f) : NaN };
  });
}

export interface BookNeeds {
  cargoes: number;
  tonnes: number;
  /** Billions of tonne-miles. */
  tonMiles: number;
  ladenMiles: number;
  ballastMiles: number;
  portDays: number;
  canalDays: number;
  shipDays: number;
  /** Ships needed to carry the whole book in the period, at 12 knots laden and 13 in ballast. */
  ships: number;
  byRoute: Array<{ route: Route; tonnes: number; tonMiles: number }>;
}

/**
 * What it would take to carry the whole book: each cargo's laden passage, port days (with any
 * congestion of its month) and canal days, plus the ballast voyages that match where cargoes end
 * to where they start, at the least total distance — the arithmetic of Lesson 3.5, applied to
 * this book instead of the world's trades. Ships = ship-days ÷ earning days in the period.
 */
export function bookNeeds(offers: CargoOffer[], w: CargoWorld, cls: ClassId): BookNeeds {
  const v = MARKET_CLASSES[cls].vessel;
  const mine = offers.filter((o) => o.cls === cls);
  const supply: Record<string, number> = {};
  const demand: Record<string, number> = {};
  let ladenMiles = 0;
  let portDays = 0;
  let canalDays = 0;
  let tonMiles = 0;
  const byRoute = new Map<string, { route: Route; tonnes: number; tonMiles: number }>();
  for (const o of mine) {
    const t = Math.min(HIST.months - 1, w.start + Math.floor(o.from / MONTH));
    const ev = eventAt(t);
    const sr = seaRoute(o.route.from, o.route.to, { draft: ladenDraft(v, o.tonnes), closed: ev?.closed });
    const nm = sr?.nm ?? 0;
    ladenMiles += nm;
    canalDays += sr?.canalDays ?? 0;
    portDays += o.route.portDays + (ev?.congestion?.[o.route.from] ?? 0) + (ev?.congestion?.[o.route.to] ?? 0);
    tonMiles += o.tonnes * nm;
    supply[o.route.to] = (supply[o.route.to] ?? 0) + 1;
    demand[o.route.from] = (demand[o.route.from] ?? 0) + 1;
    const row = byRoute.get(o.route.id) ?? { route: o.route, tonnes: 0, tonMiles: 0 };
    row.tonnes += o.tonnes;
    row.tonMiles += (o.tonnes * nm) / 1e9;
    byRoute.set(o.route.id, row);
  }
  const plan = mine.length ? ballastPlan(supply, demand, geography(cls, eventAt(w.start)?.closed ?? []).ballast) : { miles: 0 };
  const shipDays = portDays + canalDays + ladenMiles / (24 * LADEN_KN) + plan.miles / (24 * BALLAST_KN);
  const earningDays = w.weeks * 7 * ((365 - OFF_HIRE_DAYS) / 365);
  return {
    cargoes: mine.length,
    tonnes: mine.reduce((a, o) => a + o.tonnes, 0),
    tonMiles: tonMiles / 1e9,
    ladenMiles,
    ballastMiles: plan.miles,
    portDays,
    canalDays,
    shipDays,
    ships: shipDays / earningDays,
    byRoute: [...byRoute.values()].sort((a, b) => b.tonMiles - a.tonMiles),
  };
}

// Numbers the prose quotes, for the starting world.
const OFFERS0 = cargoOffers(W0);
const ROWS0 = routeRows(OFFERS0);
const row0 = (id: string) => ROWS0.find((r) => r.route.id === id)!;
const COUNT0 = { cape: OFFERS0.filter((o) => o.cls === 'cape').length, kmax: OFFERS0.filter((o) => o.cls === 'kmax').length };
/** Share of the starting book that loads in Brazil or the US Gulf. */
export const ATLANTIC0 = OFFERS0.filter((o) => ATLANTIC.has(o.route.from)).length / OFFERS0.length;
const NEEDS0 = { cape: bookNeeds(OFFERS0, W0, 'cape'), kmax: bookNeeds(OFFERS0, W0, 'kmax') };
/** The starting window with the brokers' reach at its lowest. */
const W_NARROW: CargoWorld = { ...W0, reach: 0.005 };
const OFFERS_NARROW = cargoOffers(W_NARROW);
const NEEDS_NARROW = { cape: bookNeeds(OFFERS_NARROW, W_NARROW, 'cape'), kmax: bookNeeds(OFFERS_NARROW, W_NARROW, 'kmax') };
/** How long the history's Panama drought lasts, in words. */
const PANAMA_EVENT = HISTORY_EVENTS.find((e) => e.closed?.includes('panama'))!;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const PANAMA_SPAN = WORDS[PANAMA_EVENT.to - PANAMA_EVENT.from] ?? fmt(PANAMA_EVENT.to - PANAMA_EVENT.from);
/** How much longer Tubarão's round trip to Qingdao is than Port Hedland's, laden out and empty back. */
const capeRound = (port: string) => {
  const v = MARKET_CLASSES.cape.vessel;
  return seaDistance(port, 'QIN', { draft: ladenDraft(v, MARKET_CLASSES.cape.cargo) }) + seaDistance('QIN', port, { draft: ballastDraft(v) });
};
export const ROUND_RATIO = capeRound('TUB') / capeRound('PHE');
/** New Orleans grain against Brazilian soybeans in a normal month and during the drought. */
const NORMAL_MONTH = 99;
const NOL_NORMAL = HIST.cls.kmax[NORMAL_MONTH].freights['P-NOL-QIN'];
const SAN_NORMAL = HIST.cls.kmax[NORMAL_MONTH].freights[SOY];
const NOL_DROUGHT = HIST.cls.kmax[W0.start].freights['P-NOL-QIN'];
const SAN_DROUGHT = HIST.cls.kmax[W0.start].freights[SOY];
/** What doubling-and-a-half Brazil's ore does to the Capesize market at the start month. */
const ORE_UP = { 'C-TUB-QIN': 1.5, 'C-TUB-ROT': 1.5 };
const ORE_RATIO = freightRatios('cape', HIST.cls.cape[W0.start], W0.start, ORE_UP);
/** Expected soybean shares by start month (13 weeks) and the best one. */
const SOY_BY_MONTH = Array.from({ length: 12 }, (_, k) => expectedSoyShare({ ...W0, start: 96 + k, weeks: 13 }));
const SOY_SHARE0 = expectedSoyShare(W0);
const BEST_SOY = SOY_BY_MONTH.indexOf(Math.max(...SOY_BY_MONTH));

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function groupValue(w: CargoWorld, routes: string[]): number {
  return w.routeScale[routes[0]] ?? 1;
}

/** The weekly strip: one row per size class, a dot per cargo on the day its window opens. */
function OfferStrip({ offers, w }: { offers: CargoOffer[]; w: CargoWorld }) {
  const days = w.weeks * 7;
  const X0 = 96;
  const X1 = 624;
  const x = (d: number) => X0 + (d / days) * (X1 - X0);
  const rows: ClassId[] = ['cape', 'kmax'];
  const ys: Record<ClassId, number> = { cape: 46, kmax: 92 };
  const ticks: Array<{ d: number; label: string }> = [];
  for (let k = 0; k * MONTH < days; k++) {
    const t = w.start + k;
    ticks.push({ d: k * MONTH, label: k === 0 || t % 12 === 0 ? `${MONTH_SHORT[t % 12]} Y${Math.floor(t / 12) + 1}` : MONTH_SHORT[t % 12] });
  }
  const bands = HISTORY_EVENTS.map((e) => ({ e, a: Math.max(0, (e.from - w.start) * MONTH), b: Math.min(days, (e.to - w.start) * MONTH) })).filter((b) => b.b > b.a);
  const perWeek = new Map<string, number>();
  return (
    <svg
      className="chart"
      viewBox="0 0 640 128"
      role="img"
      aria-label={`Cargo offers week by week from ${monthLabel(w.start)} for ${w.weeks} weeks: ${offers.filter((o) => o.cls === 'cape').length} Capesize and ${offers.filter((o) => o.cls === 'kmax').length} Kamsarmax.${bands.length ? ` Under way: ${bands.map((b) => b.e.label.toLowerCase()).join('; ')}.` : ''}`}
    >
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={x(b.a)} y={20} width={x(b.b) - x(b.a)} height={92} fill={tint(GRAPHIC.red, 0.14)} />
          <text className="ax" x={x(b.a) + 3} y={124}>
            {b.e.label}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <g key={t.d}>
          <line className="gl" x1={x(t.d)} x2={x(t.d)} y1={20} y2={112} />
          <text className="ax" x={x(t.d) + 2} y={14}>
            {t.label}
          </text>
        </g>
      ))}
      {rows.map((c) => (
        <g key={c}>
          <line className="base" x1={X0} x2={X1} y1={ys[c]} y2={ys[c]} />
          <text x={X0 - 8} y={ys[c] - 2} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: CLASS_TEXT[c] }}>
            {CLASS_NAME[c]}
          </text>
          <text x={X0 - 8} y={ys[c] + 12} textAnchor="end" className="ax">
            {offers.filter((o) => o.cls === c).length} cargoes
          </text>
        </g>
      ))}
      {offers.map((o) => {
        const week = Math.floor(o.from / 7);
        const key = `${o.cls}|${week}`;
        const k = perWeek.get(key) ?? 0;
        perWeek.set(key, k + 1);
        const dy = ((k % 5) - 2) * 6;
        const atl = ATLANTIC.has(o.route.from);
        return (
          <circle
            key={o.id}
            cx={x(o.from)}
            cy={ys[o.cls] + dy}
            r={3.2}
            fill={atl ? CLASS_COLOR[o.cls] : '#ffffff'}
            stroke={CLASS_COLOR[o.cls]}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const design = useCompany();
  const w = design.world;
  const setWorld = (patch: Partial<CargoWorld>) => updateCompany((d) => ({ ...d, world: { ...d.world, ...patch } }));
  const setGroup = (routes: string[], v: number) =>
    updateCompany((d) => {
      const rs = { ...d.world.routeScale };
      for (const r of routes) {
        if (Math.abs(v - 1) < 1e-9) delete rs[r];
        else rs[r] = v;
      }
      return { ...d, world: { ...d.world, routeScale: rs } };
    });
  const key = JSON.stringify(w);
  const offers = useMemo(() => cargoOffers(w), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => routeRows(offers), [offers]);
  const soyShare = useMemo(() => expectedSoyShare(w), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const solved = soySolved(w);
  const normal = isNormal(w);
  const atlShare = offers.length ? offers.filter((o) => ATLANTIC.has(o.route.from)).length / offers.length : 0;
  const maxN = Math.max(1, ...rows.map((r) => r.n));
  const lastMonth = (x: CargoWorld) => x.start + Math.floor(((x.weeks - 1) * 7) / MONTH);
  const loadsAt = (port: string) => offers.filter((o) => o.route.from === port).length;
  const WINDOW: Array<keyof CargoWorld> = ['start', 'weeks', 'reach'];
  const windowChanged = worldFieldsChanged(design, WINDOW);
  const resetWindow = () => {
    if (confirmReset('your trading window and your brokers’ reach', windowChanged)) resetWorldFields(WINDOW);
  };

  // Demonstration 2: the freights, in the starting window (which the text describes) or the reader's.
  const [fView, setFView] = useState<CompanyView>('start');
  const fw: CargoWorld = !windowChanged || fView === 'start' ? { ...W0, routeScale: w.routeScale } : w;
  const fKey = JSON.stringify(fw);
  const fOffers = useMemo(() => cargoOffers(fw), [fKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const fRows = useMemo(() => routeRows(fOffers), [fOffers]);
  const resetExports = () => {
    if (!confirmReset('your export strengths', !normal)) return;
    resetWorldFields(['routeScale']);
    setFView('start');
  };

  // Demonstration 3: what the book needs, for the starting company or the reader's.
  const book = useScenario('book', { cls: 'kmax' as ClassId, view: 'start' as CompanyView });
  const cls = book.state.cls;
  const bookChanged = partChanged(design, 'world') || partChanged(design, 'ships');
  const bStart = !bookChanged || book.state.view === 'start';
  const bw = bStart ? W0 : w;
  const bOffers = bStart ? OFFERS0 : offers;
  const needs = useMemo(() => bookNeeds(bOffers, bw, cls), [bOffers, bw, cls]);
  const fleetCount = (bStart ? STARTING : design).ships.filter((s) => s.cls === cls).length;
  const totalT = needs.byRoute.reduce((a, r) => a + r.tonnes, 0);
  const totalTm = needs.byRoute.reduce((a, r) => a + r.tonMiles, 0);
  const BX0 = 196;
  const BX1 = 600;
  const barH = 9;
  const rowH = 30;
  const chartH = 34 + Math.max(1, needs.byRoute.length) * rowH;
  const minSoy = Math.min(...SOY_BY_MONTH);

  return (
    <LessonPage id="shipping/6.2">
      <P>
        In <a href={lessonHref('shipping/6.1')}>the previous lesson</a> Northwind Bulk became a fleet: Kestrel and Albatross and whatever ships you bought or
        chartered, each with a daily cost to cover. A fleet earns nothing until it has cargo. This lesson builds the market the company will trade in — not the
        whole world’s, which no company sees, but the slice its brokers bring it. Which cargoes, loading where, on which dates, at what freight?
      </P>
      <CompanySoFar d={design} lesson={2} />
      <P>
        The cargoes come from the trades we have followed since <a href={lessonHref('shipping/3.1')}>Chapter 3</a>: iron ore from Port Hedland and Tubarão, coal
        from Indonesia, Australia and South Africa, soybeans from Santos and grain from the US Gulf. Each week, each trade sends the company a random number of
        cargoes. On average it is that trade’s share of the world’s voyages that week — its volume divided by a ship’s cargo, shaped by its season, as in{' '}
        <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a> — times the brokers’ <K tone="orange">reach</K>, the share of the world market they hear about.
        Each cargo has a week-long loading window, a laycan, like the cargoes of <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>. In the next demonstration,
        choose when the company starts trading, for how long and how far its brokers reach; the map draws the cargoes by trade, and the strip by the day each
        loading window opens:
      </P>

      <Figure name="Global Cargo Simulator" onReset={resetWindow}>
        <WorldMap
          ariaLabel={`The company’s cargo offers from ${monthLabel(w.start)} for ${w.weeks} weeks, drawn by trade: ${rows
            .filter((r) => r.n > 0)
            .map((r) => `${routeName(r.route)} ${r.n}`)
            .join(', ')}.`}
          routes={rows
            .filter((r) => r.n > 0)
            .map((r) => ({ points: seaRoute(r.route.from, r.route.to)?.points ?? [], color: CLASS_COLOR[r.route.cls], width: 1.2 + (7 * r.n) / maxN, opacity: 0.75 }))}
          ports={TRADE_PORTS.map((id) => ({ id, sub: loadsAt(id) ? `${loadsAt(id)} to load` : undefined }))}
        />
        <Legend
          items={[
            { label: 'Capesize trades', color: CLASS_COLOR.cape, kind: 'line' },
            { label: 'Kamsarmax trades', color: CLASS_COLOR.kmax, kind: 'line' },
            { label: 'Filled dot: loads in Brazil or the US Gulf; hollow: elsewhere', color: '#777' },
          ]}
        />
        <OfferStrip offers={offers} w={w} />
        <Readouts
          items={[
            { label: 'soybeans’ share of the Kamsarmax cargoes to expect', value: pct(soyShare, 1), tone: soyShare >= SOY_TARGET ? 'green' : undefined },
            { label: 'cargoes loading in Brazil or the US Gulf', value: pct(atlShare) },
          ]}
        />
        <Slider label="Start" tone="teal" value={w.start} min={0} max={117} onChange={(v) => setWorld({ start: v })} display={monthLabel(w.start)} />
        <Slider label="Period" tone="teal" value={w.weeks} min={13} max={52} onChange={(v) => setWorld({ weeks: v })} display={`${w.weeks} weeks`} />
        <Slider label="Brokers’ reach" tone="orange" value={Math.round(w.reach * 1000) / 10} min={0.5} max={5} step={0.25} onChange={(v) => setWorld({ reach: v / 100 })} display={`${fmt(w.reach * 100, 2)}% of cargoes`} />
        <Caption>
          {monthLabel(w.start)} to {monthLabel(lastMonth(w))}: {fmt(offers.length)} cargoes on offer.
          {normal ? '' : ' Exports at the strengths set in the next demonstration.'}
        </Caption>
      </Figure>

      <P>
        At the start the company trades from {when(W0.start)} for {W0.weeks} weeks, with brokers reaching {pct(W0.reach)} of the world’s cargoes. They bring{' '}
        {fmt(OFFERS0.length)} cargoes, the company’s <K tone="orange">book</K>: the cargoes on offer to it, to take or leave. Of these, {fmt(COUNT0.cape)} are
        for Capesizes and {fmt(COUNT0.kmax)} for Kamsarmaxes, and only {pct(ATLANTIC0)} load in Brazil or the US Gulf — Port Hedland’s ore alone sends{' '}
        {fmt(row0('C-PHE-QIN').n)}. Widen the reach and the book grows in proportion; the trades it is made of stay the same.
      </P>

      <H2>The harvest calendar</H2>
      <P>
        Now move the start. The Kamsarmax book changes character with the seasons, because Brazil ships its soybeans mostly from March to July and the US its
        grain in the northern autumn (<a href={lessonHref('shipping/3.5')}>Lesson 3.5</a>). The starting window opens as Brazil’s season is ending, so soybeans
        should be only about {pct(SOY_SHARE0)} of its Kamsarmax cargoes: the share in the readout, the average of what the brokers can expect week by week. The
        dots in the strip are one random draw around those expectations, so a short window can come out ahead of or behind its season — the same randomness that
        made ships queue at the port of <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>.
      </P>

      <Challenge
        id="a"
        figure="Global Cargo Simulator"
        question={`Estimate first from the season, then check: leaving every export at its normal strength, how long can a window be — starting when you like — and still expect Brazilian soybeans to make up at least ${pct(SOY_TARGET)} of the Kamsarmax cargoes? Find the longest window you can.`}
        solved={solved}
        status={
          !normal ? (
            <>
              Put every export back to 100% first: the harvest has to do the work.{' '}
              <Button onClick={() => confirmReset('your export strengths', true) && resetWorldFields(['routeScale'])}>Set every export to 100%</Button>
            </>
          ) : soyShare < SOY_TARGET - 1e-9 ? (
            `From ${when(w.start)} for ${w.weeks} weeks, soybeans are ${pct(soyShare, 1)} of the Kamsarmax cargoes to expect: short of ${pct(SOY_TARGET)}.`
          ) : (
            `From ${when(w.start)} for ${w.weeks} weeks, soybeans are ${pct(soyShare, 1)}: that qualifies. Can a longer window still manage it?`
          )
        }
        success={`Solved: ${w.weeks} weeks from ${when(w.start)}, at ${pct(soyShare, 1)}. The longest window anywhere in the history is ${LONGEST_SOY.weeks} weeks, and it starts in ${MONTH_NAMES[LONGEST_SOY.month]}, with Brazil’s season; every week added after July brings slack months that dilute the harvest. The richest 13 weeks start in ${MONTH_NAMES[BEST_SOY]}, at ${pct(SOY_BY_MONTH[BEST_SOY])}; start in ${MONTH_NAMES[SOY_BY_MONTH.indexOf(minSoy)]} and soybeans are just ${pct(minSoy)}. The same ships will be wanted in Santos then, which is why Lesson 5.4 found that a Kamsarmax ballasting from China should leave in February.`}
      />

      <P>
        The window you leave here is the one Northwind trades in from now on. The later lessons can also run the starting window, which their text describes.
      </P>

      <H2>Export strength moves the freight</H2>
      <P>
        Each cargo offers the freight its route paid that month in the simulated history, give or take a few percent of negotiation. In the next demonstration the
        book is sorted by trade, with the freight each pays, and the dials set how strongly each region exports:
      </P>

      <Figure name="Global Cargo Simulator · freights" onReset={resetExports}>
        {windowChanged && (
          <ViewSwitch
            value={fView}
            onChange={setFView}
            labels={['Starting window', 'Your window']}
            note={`The text describes the starting window, ${W0.weeks} weeks from ${when(W0.start)}; yours is ${w.weeks} weeks from ${when(w.start)}.`}
          />
        )}
        {GROUPS.map((g) => (
          <Slider key={g.key} label={g.label} tone="orange" value={groupValue(w, g.routes)} min={0.5} max={1.5} step={0.05} onChange={(v) => setGroup(g.routes, v)} display={pct(groupValue(w, g.routes))} />
        ))}
        <DataTable
          caption="The cargoes on offer by trade, with the freight they pay"
          rows={fRows.filter((r) => r.n > 0)}
          rowKey={(r) => r.route.id}
          columns={[
            { label: 'Trade', cell: (r) => `${routeName(r.route)}, ${r.route.commodity}` },
            { label: 'Ship', cell: (r) => CLASS_NAME[r.route.cls], align: 'left' },
            { label: 'Cargoes', cell: (r) => fmt(r.n), align: 'right' },
            { label: 'Average freight', cell: (r) => perT(r.avg), align: 'right' },
            { label: 'Range', cell: (r) => (r.n > 1 ? `${fmt(r.min, 2)}–${fmt(r.max, 2)}` : '—'), align: 'right' },
          ]}
        />
        <Caption>
          {monthLabel(fw.start)} to {monthLabel(lastMonth(fw))}, brokers reaching {fmt(fw.reach * 100, 2).replace(/\.?0+$/, '')}% of cargoes. Freight is simulated and illustrative:
          each route’s rate in the course’s history for its month, re-solved for the export strengths you set.
        </Caption>
      </Figure>

      <P>
        Look at the freights. Port Hedland’s ore pays about {perT(row0('C-PHE-QIN').avg)} for a 3,800-mile voyage and Tubarão’s about{' '}
        {perT(row0('C-TUB-QIN').avg)} for 11,100 miles. Each freight pays for a round trip, out laden and back empty to the next cargo (
        <a href={lessonHref('shipping/4.3')}>Lesson 4.3</a>), and Tubarão’s round trip is about {WORDS[Math.round(ROUND_RATIO)]} times as long. These are slump
        freights: the starting window opens late in the long trough of Years 6 to 10.
      </P>
      <P>
        The window also catches the history’s drought at the Panama Canal, which in our model closes it to bulk carriers for {PANAMA_SPAN} months, and the trade
        it hits shows it. In a normal month, {monthLabel(NORMAL_MONTH)}, grain from New Orleans to Qingdao pays {perT(NOL_NORMAL)} against {perT(SAN_NORMAL)} for
        Brazilian soybeans: a shorter haul through the canal, and a shorter empty voyage back to the Gulf, but with the canal’s toll and a day in
        the locks to pay for, so it comes out about the same. In {monthLabel(W0.start)} it pays{' '}
        {perT(NOL_DROUGHT)} against {perT(SAN_DROUGHT)}: with the canal shut to it, the cargo goes the long way by Suez (
        <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a>), and the freight must pay for the extra weeks.
      </P>
      <P>
        Now raise Brazil’s iron ore. More Tubarão cargoes appear, as you’d expect — but in the starting window the freight on every Capesize trade rises too,
        not just Brazil’s. The dials don’t only add cargoes; they change the market the cargoes are priced in. The model re-solves each month’s Capesize market
        with the extra long-haul ore (<a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>): the fleet must sail more tonne-miles, ships speed up, and earnings
        rise until the fleet carries it all. At {pct(ORE_UP['C-TUB-QIN'])} of Brazil’s normal exports, the {MONTH_NAMES[HIST.cls.cape[W0.start].month]} freight
        from Port Hedland rises by {pct(ORE_RATIO['C-PHE-QIN'] - 1)} and Tubarão’s by {pct(ORE_RATIO['C-TUB-QIN'] - 1)}, though Port Hedland’s trade hasn’t
        changed at all. Ships are one pool; a strong trade anywhere pulls them from everywhere else.
      </P>

      <H2>Enough ships for the book?</H2>
      <P>
        A book of cargoes is a demand for ships. In the next demonstration we work out what this book would need, the way{' '}
        <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a> did for the world’s trades: each cargo’s laden passage at {LADEN_KN} knots, its days in port (with
        any congestion of its month) and canal, plus the ballast voyages that take ships from where the cargoes end to where the next ones load, matched at the
        least total distance and sailed at {BALLAST_KN} knots. Divide the ship-days by a ship’s earning days in the period and you have the ships the book
        needs. The bars compare each trade’s share of the book’s tonnes with its share of the tonne-miles:
      </P>

      <Figure name="Global Cargo Simulator · the book’s tonne-miles" scenario={book}>
        {bookChanged && (
          <ViewSwitch
            value={book.state.view}
            onChange={(v) => book.set({ view: v })}
            labels={['Starting book', 'Your book']}
            note={<>The text describes the starting company’s book. Yours: {worldText(design)}.</>}
          />
        )}
        <Segmented
          label="Size class"
          value={cls}
          onChange={(v) => book.set({ cls: v })}
          options={[
            { value: 'kmax', label: 'Kamsarmax' },
            { value: 'cape', label: 'Capesize' },
          ]}
        />
        <svg
          className="chart"
          viewBox={`0 0 640 ${chartH}`}
          role="img"
          aria-label={`The ${CLASS_NAME[cls]} book: ${fmt(needs.cargoes)} cargoes, ${fmt(needs.tonnes / 1e6, 2)} million tonnes and ${fmt(needs.tonMiles, 1)} billion tonne-miles. ${needs.byRoute.map((r) => `${routeName(r.route)} ${pct(totalT ? r.tonnes / totalT : 0)} of tonnes, ${pct(totalTm ? r.tonMiles / totalTm : 0)} of tonne-miles`).join('; ')}.`}
        >
          <text className="ax" x={BX0} y={14}>
            Share of the book
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((s) => (
            <g key={s}>
              <line className={s === 0 ? 'base' : 'gl'} x1={BX0 + s * (BX1 - BX0)} x2={BX0 + s * (BX1 - BX0)} y1={20} y2={chartH - 8} />
              <text className="ax ax-m" x={BX0 + s * (BX1 - BX0)} y={chartH} style={{ fontSize: 10 }}>
                {pct(s)}
              </text>
            </g>
          ))}
          {needs.byRoute.map((r, i) => {
            const y = 28 + i * rowH;
            const st = totalT ? r.tonnes / totalT : 0;
            const sm = totalTm ? r.tonMiles / totalTm : 0;
            return (
              <g key={r.route.id}>
                <text x={BX0 - 8} y={y + 12} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
                  {routeName(r.route)}
                </text>
                <rect x={BX0} y={y} width={st * (BX1 - BX0)} height={barH} fill={tint(CLASS_COLOR[cls], 0.45)} />
                <rect x={BX0} y={y + barH + 2} width={sm * (BX1 - BX0)} height={barH} fill={CLASS_COLOR[cls]} />
                <text x={BX0 + Math.max(st, sm) * (BX1 - BX0) + 6} y={y + 15} className="ax">
                  {pct(st)} · {pct(sm)}
                </text>
              </g>
            );
          })}
          {!needs.byRoute.length && (
            <text className="ax" x={BX0} y={40}>
              No {CLASS_NAME[cls]} cargoes in this book.
            </text>
          )}
        </svg>
        <Legend
          items={[
            { label: 'Share of tonnes', color: tint(CLASS_COLOR[cls], 0.45) },
            { label: 'Share of tonne-miles', color: CLASS_COLOR[cls] },
          ]}
        />
        <Readouts
          items={[
            { label: 'tonnes in the book', value: `${fmt(needs.tonnes / 1e6, 2)} Mt`, tone: 'orange' },
            { label: 'tonne-miles', value: `${fmt(needs.tonMiles, 1)} bn`, tone: 'blue' },
            { label: `${CLASS_NAME[cls]}s needed to carry it all`, value: fmt(needs.ships, 1) },
            { label: `${CLASS_NAME[cls]}s in ${bStart ? 'the starting' : 'your'} fleet`, value: fmt(fleetCount), tone: fleetCount >= needs.ships ? 'green' : undefined },
          ]}
        />
        <Caption>
          {bStart ? 'The starting book' : 'Your book'}: {fmt(needs.shipDays)} ship-days, {fmt(needs.portDays)} in port, {fmt(needs.ladenMiles / (24 * LADEN_KN))}{' '}
          laden at sea and {fmt(needs.ballastMiles / (24 * BALLAST_KN))} in ballast, against {fmt(bw.weeks * 7 * ((365 - OFF_HIRE_DAYS) / 365))} earning days per
          ship in {bw.weeks} weeks.
        </Caption>
      </Figure>

      <P>
        For the starting book, carrying every Capesize cargo would take {fmt(NEEDS0.cape.ships, 1)} Capesizes and every Kamsarmax cargo{' '}
        {fmt(NEEDS0.kmax.ships, 1)} Kamsarmaxes; Northwind starts with one of each. That is no mistake in the brokers’ work. A company that heard of only as many
        cargoes as it could carry would have to take whatever came, at whatever freight; one that hears of many can choose the voyages that pay best for where
        its ships are. The book is a menu, not a schedule. Even with the reach at its lowest, {pct(W_NARROW.reach, 1)}, the starting window’s cargoes would
        need {fmt(NEEDS_NARROW.cape.ships, 1)} Capesizes and {fmt(NEEDS_NARROW.kmax.ships, 1)} Kamsarmaxes.
      </P>
      <P>
        The bars show what kind of menu it is. In the starting Capesize book, Port Hedland supplies{' '}
        {pct(NEEDS0.cape.byRoute.find((r) => r.route.id === 'C-PHE-QIN')!.tonnes / NEEDS0.cape.tonnes)} of the tonnes but{' '}
        {pct(NEEDS0.cape.byRoute.find((r) => r.route.id === 'C-PHE-QIN')!.tonMiles / NEEDS0.cape.tonMiles)} of the tonne-miles, while Tubarão’s ore, fewer
        cargoes on a three-times-longer haul, takes{' '}
        {pct((NEEDS0.cape.byRoute.find((r) => r.route.id === 'C-TUB-QIN')?.tonMiles ?? 0) / NEEDS0.cape.tonMiles)} of the tonne-miles. A ship that takes a Brazilian
        cargo is gone for {fmt(seaRoute('TUB', 'QIN')!.nm / (24 * LADEN_KN), 0)} days laden and comes back empty; one that takes Port Hedland’s is back in about
        a month.{' '}
        {bookChanged
          ? 'Switch this demonstration to your book and set the ships it needs against the ships you have: the fleet and the trades have to fit each other.'
          : 'Once you have changed the fleet or the window, this demonstration can switch to your own book: the fleet and the trades have to fit each other.'}
      </P>
      <P>
        The company now has ships and a stream of cargoes it could carry. Which ship should take which cargo, at what speed, and when is it better to wait?{' '}
        <a href={lessonHref('shipping/6.3')}>The next lesson</a> opens the operations desk.
      </P>
    </LessonPage>
  );
}
