import { useDeferredValue, useMemo } from 'react';
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
  TEXT,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  pct,
  useScenario,
} from '../../../framework';
import {
  AS_BUILT,
  CAPSTONE_CONDITIONS,
  PRACTICE_SEEDS,
  summarizeYear,
  systemCapacity,
  systemCost,
  systemKey,
  systemTakeaway,
  systemYear,
  winterColder,
  type GasSystem,
  type SystemYear,
  type YearSummary,
} from '../../../engines/gas/capstone';
import type { YearDay } from '../../../engines/gas/market';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { OIL_SWITCH_VALUE, PROTECTED_VALUE, demandBlocks } from '../../../model/gas/demand';
import { GAS_MONTHS, GAS_MONTH_START, GAS_YEAR_DAYS, gasDayLabel } from '../../../model/gas/weather';
import { CORRIDORS, GAS_NODE, PIPELINE, PRODUCTION_COST, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { XYChart } from '../shared/XYChart';
import { CHEAPEST_NETWORK, CapstoneSoFar } from '../shared/CapstoneUi';
import { useGasCapstone } from '../shared/capstone';
import { basis, bcf, bcfd, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The reader's network, run through the eight practice winters.

const MMBTU_PER_BCF = MMBTU_PER_MCF * 1e6;
const RIDGEBACK_COST = PRODUCTION_COST.ridgeback ?? 1.2;
const NODES: GasNodeId[] = ['sandhill', 'ridgeback', 'calder', 'metro', 'bayport'];
/** The price chart's ceiling, $/MMBtu: high enough to show oil switching at Metro; anything above is drawn at the top. */
export const RM_PRICE_CAP = 16;
/** A line counts as full on a day when it carries at least this share of its capacity (as in summarizeYear). */
const FULL = 0.99;

export type RmNetwork = 'yours' | 'built';
export type RmView = 'money' | 'lines' | 'winters';

/** Figure 1: a practice winter (0–7), the network, and a day of the gas year. */
export const REGIONAL_MARKET_DEFAULTS = { winter: 0, network: 'yours' as RmNetwork, day: 284 };
export type RegionalMarketState = typeof REGIONAL_MARKET_DEFAULTS;
/** Figure 2: which table to show. */
export const RM_TABLE_DEFAULTS = { view: 'money' as RmView };

/** A corridor's line name: the region's own name, or the two places it joins. */
export function rmLineName(id: string): string {
  const c = CORRIDORS.find((k) => k.id === id);
  return PIPELINE[id]?.name ?? (c ? `${GAS_NODE[c.from].name}–${GAS_NODE[c.to].name} line` : id);
}

/** A line's name as it reads in a sentence: "the Valley Line", "Northline", "the Bayport–Metro line". */
export function rmLineRef(id: string): string {
  const n = rmLineName(id);
  return /(Line|Lateral|line)$/.test(n) ? `the ${n}` : n;
}

/** Gas a basin sold on a day, Bcf/d: what it burned itself plus what left it by pipe, less what arrived from elsewhere. */
export function rmSold(d: YearDay, node: 'ridgeback' | 'sandhill'): number {
  let s = d.served[node];
  for (const c of CORRIDORS) {
    const f = d.flow[c.id] ?? 0;
    if (c.from === node) s += f;
    if (c.to === node) s -= f;
  }
  return s;
}

export interface RmWinter {
  seed: number;
  /** Heating degree days above normal over November–March (negative = milder). */
  colder: number;
  summary: YearSummary;
  /** Days of the gas year on which Metro's homes were rationed. */
  rationedDays: number[];
  /** Metro's highest price and the day it came. */
  metroMax: number;
  metroMaxDay: number;
  /** Days Metro's price reached the oil-switching value. */
  oilDays: number;
  /** What the region's producers earned on the gas they sold, what Metro's gas users paid, and the pipes' rents, $ over the year. */
  producers: number;
  ridgebackSales: number;
  metroBill: number;
  rents: number;
}

const winterCache = new Map<string, RmWinter>();

/** One practice winter on a network (cached). */
export function rmWinter(s: GasSystem, i: number): RmWinter {
  const key = `${systemKey(s)}#${i}`;
  const hit = winterCache.get(key);
  if (hit) return hit;
  const y: SystemYear = systemYear(s, PRACTICE_SEEDS[i]);
  const summary = summarizeYear(s, y);
  let producers = 0;
  let ridgebackSales = 0;
  let metroBill = 0;
  let metroMax = -Infinity;
  let metroMaxDay = 0;
  const rationedDays: number[] = [];
  y.days.forEach((d, j) => {
    const rb = d.price.ridgeback * rmSold(d, 'ridgeback') * MMBTU_PER_BCF;
    ridgebackSales += rb;
    producers += rb + d.price.sandhill * rmSold(d, 'sandhill') * MMBTU_PER_BCF;
    metroBill += d.price.metro * d.served.metro * MMBTU_PER_BCF;
    if (d.price.metro > metroMax) {
      metroMax = d.price.metro;
      metroMaxDay = j;
    }
    if (d.rationed > 1e-6) rationedDays.push(j);
  });
  const r: RmWinter = {
    seed: PRACTICE_SEEDS[i],
    colder: winterColder(y.weather),
    summary,
    rationedDays,
    metroMax,
    metroMaxDay,
    oilDays: y.days.filter((d) => d.price.metro >= OIL_SWITCH_VALUE - 1e-6).length,
    producers,
    ridgebackSales,
    metroBill,
    rents: Object.values(summary.rent).reduce((a, b) => a + b, 0),
  };
  winterCache.set(key, r);
  return r;
}

export interface RmLine {
  id: string;
  name: string;
  capacity: number;
  /** Days full and rent, averaged over the eight winters. */
  fullDays: number;
  rent: number;
}

export interface RmEight {
  winters: RmWinter[];
  /** Averages over the eight winters. */
  calder: number;
  ridgebackBasis: number;
  metroBasis: number;
  producers: number;
  ridgebackSales: number;
  metroBill: number;
  rents: number;
  /** The yearly charge on the capital added to the network as built, $. */
  capital: number;
  lines: RmLine[];
  /** Highest price at Metro over all eight winters, and the days homes were rationed in all of them. */
  metroMax: number;
  rationedDays: number;
  /** Winters in which Metro's price reached the oil-switching value. */
  oilWinters: number;
}

const eightCache = new Map<string, RmEight>();

/** The eight practice winters on a network, added up (cached). */
export function rmEight(s: GasSystem): RmEight {
  const key = systemKey(s);
  const hit = eightCache.get(key);
  if (hit) return hit;
  const winters = PRACTICE_SEEDS.map((_, i) => rmWinter(s, i));
  const avg = (f: (w: RmWinter) => number) => winters.reduce((a, w) => a + f(w), 0) / winters.length;
  const cap = systemCapacity(s);
  const lines: RmLine[] = CORRIDORS.filter((c) => cap[c.id] > 0).map((c) => ({
    id: c.id,
    name: rmLineName(c.id),
    capacity: cap[c.id],
    fullDays: avg((w) => w.summary.fullDays[c.id]),
    rent: avg((w) => w.summary.rent[c.id]),
  }));
  const r: RmEight = {
    winters,
    calder: avg((w) => w.summary.avg.calder),
    ridgebackBasis: avg((w) => w.summary.avg.ridgeback - w.summary.avg.calder),
    metroBasis: avg((w) => w.summary.avg.metro - w.summary.avg.calder),
    producers: avg((w) => w.producers),
    ridgebackSales: avg((w) => w.ridgebackSales),
    metroBill: avg((w) => w.metroBill),
    rents: avg((w) => w.rents),
    capital: systemCost(s).annual,
    lines,
    metroMax: Math.max(...winters.map((w) => w.metroMax)),
    rationedDays: winters.reduce((a, w) => a + w.rationedDays.length, 0),
    oilWinters: winters.filter((w) => w.oilDays > 0).length,
  };
  eightCache.set(key, r);
  return r;
}

/** Whether a line ran full only in winter (November–March) in all eight practice winters. */
export function rmFullOnlyInWinter(s: GasSystem, id: string): boolean {
  const c = systemCapacity(s)[id];
  if (!c) return false;
  return PRACTICE_SEEDS.every((seed) => systemYear(s, seed).days.every((d, j) => j >= GAS_MONTH_START[7] || (d.flow[id] ?? 0) < c * FULL - 1e-9));
}

const METRO_VALUE = Object.fromEntries(demandBlocks(30).map((b) => [b.id, b.value]));
/** What Metro's interruptible industry and the rest of its industry are worth to them, $/MMBtu (Lesson 4.1's demand curve). */
export const RM_INTERRUPTIBLE = METRO_VALUE['metro-interruptible'];
export const RM_INDUSTRY = METRO_VALUE['metro-industry'];

/** Whether two networks are the same. */
export function rmSameNetwork(a: GasSystem, b: GasSystem): boolean {
  return systemKey(a) === systemKey(b);
}

/** What the reader changed, line by line, in words ("the Coastal Line: 30-inch with 4 stations instead of 3"). */
export function rmChanges(s: GasSystem): string[] {
  return systemCost(s).changed.map((id) => {
    const size = s.sizes[id] ?? 0;
    const n = s.stations[id] ?? 1;
    const o = AS_BUILT.sizes[id];
    const on = AS_BUILT.stations[id];
    const name = rmLineName(id);
    if (!size) return `${name} taken out`;
    const spec = `${size}-inch with ${n} station${n === 1 ? '' : 's'}`;
    if (!o) return `a new ${name}, ${spec}`;
    if (size === o) return `${name}: ${n} station${n === 1 ? '' : 's'} instead of ${on}`;
    return `${name}: ${spec}, instead of ${o}-inch with ${on}`;
  });
}

export interface RmPeak {
  /** Metro's highest price over the eight practice winters, $/MMBtu, and every day it came. */
  price: number;
  days: Array<{ winter: number; day: number }>;
}

/** Metro's highest price over the eight practice winters on a network, and the days it came (a tie counts every day). */
export function rmPeak(s: GasSystem): RmPeak {
  const price = rmEight(s).metroMax;
  const days: RmPeak['days'] = [];
  PRACTICE_SEEDS.forEach((seed, winter) =>
    systemYear(s, seed).days.forEach((d, day) => {
      if (d.price.metro >= price - 0.005) days.push({ winter, day });
    }),
  );
  return { price, days };
}

/**
 * The challenge: on the reader's network — or the one as built, when the reader's is the same —
 * a day of the eight practice winters that brings Metro's highest price.
 */
export function regionalMarketSolved(st: RegionalMarketState, yours: GasSystem): boolean {
  if (st.network !== 'yours' && !rmSameNetwork(yours, AS_BUILT)) return false;
  return rmPeak(yours).days.some((p) => p.winter === st.winter && p.day === Math.round(st.day));
}

/** The pipes into Metro that run full on a day of a network's year. */
export function rmFullIntoMetro(s: GasSystem, d: YearDay): string[] {
  const cap = systemCapacity(s);
  return CORRIDORS.filter((c) => c.to === 'metro' && cap[c.id] > 0 && (d.flow[c.id] ?? 0) >= cap[c.id] * FULL - 1e-9).map((c) => c.id);
}

/** What sets Metro's price at a step of Lesson 4.1's demand curve. */
export function rmPriceWords(price: number, calder: number): string {
  if (price >= PROTECTED_VALUE - 0.005) return 'what rationing its homes costs';
  if (price >= RM_INDUSTRY - 0.005) return 'the value of the industry that gives way';
  if (price >= OIL_SWITCH_VALUE - 0.005) return 'where its power plants switch to oil';
  if (price >= RM_INTERRUPTIBLE - 0.005) return 'the value of its interruptible industry';
  return price - calder > lineTariffOf('calder-metro') + 0.01 ? 'set by the users who give way first' : 'Calder’s price plus the trip on Northline';
}

function lineTariffOf(id: string): number {
  return PIPELINE[id]?.variableCost ?? 0;
}

/** Map fill for a price: pale at hub levels, orange at oil switching, red at rationing. */
function rmFill(p: number): string {
  if (p <= 2) return mix('#dbe9f6', '#eef3e6', Math.max(0, (p - 1) / 1));
  if (p <= 5) return mix('#eef3e6', '#f6e2b8', (p - 2) / 3);
  if (p <= 15) return mix('#f6e2b8', '#f2a078', (p - 5) / 10);
  return mix('#f2a078', '#e0645a', Math.min(1, (p - 15) / 30));
}

const CALDER_COLOR = '#93c35a';
const METRO_COLOR = '#1f4710';
const RIDGE_COLOR = '#8a8a8a';
const DAYS = Array.from({ length: GAS_YEAR_DAYS }, (_, d) => d);
const WINTER_OPTIONS = PRACTICE_SEEDS.map((_, i) => ({ value: String(i), label: i === 0 ? 'Winter 1' : String(i + 1) }));

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
const TOTAL_PRODUCTION = CAPSTONE_CONDITIONS.ridgeback + CAPSTONE_CONDITIONS.sandhill;

function dayText(d: number): string {
  return gasDayLabel(d).replace(/^(\w+) (\d+)$/, (_, m: string, n: string) => `${monthWord(m)} ${n}`);
}

const MONTH_WORD: Record<string, string> = {
  Apr: 'April',
  May: 'May',
  Jun: 'June',
  Jul: 'July',
  Aug: 'August',
  Sep: 'September',
  Oct: 'October',
  Nov: 'November',
  Dec: 'December',
  Jan: 'January',
  Feb: 'February',
  Mar: 'March',
};
function monthWord(m: string): string {
  return MONTH_WORD[m] ?? m;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function word(n: number): string {
  return WORDS[n] ?? fmt(n);
}

/** A change in money: "+$2.91 billion", "−$44 million", or a dash for nothing. */
function rmChange(x: number): string {
  return Math.abs(x) < 500 ? '—' : `${x > 0 ? '+' : '−'}${money(Math.abs(x))}`;
}

/** "$1.2 million more" / "$40,000 less". */
function moreLess(x: number): string {
  return `${money(Math.abs(x))} ${x >= 0 ? 'more' : 'less'}`;
}

export default function Lesson() {
  const cap = useGasCapstone();
  const yours = cap.system;
  const changed = !rmSameNetwork(yours, AS_BUILT);
  const changes = rmChanges(yours);
  const cost = systemCost(yours);

  // The network as built over the eight winters: the prose's fixed reference.
  const built = useMemo(() => rmEight(AS_BUILT), []);
  // Set beside it: the reader's network, or Lesson 7.1's cheapest network while the reader's is the one as built.
  const other = changed ? yours : CHEAPEST_NETWORK;
  const mine = useMemo(() => rmEight(other), [other]);
  const otherName = changed ? 'your network' : 'the cheapest network';
  const builtTakeaway = systemTakeaway(AS_BUILT);
  const yourTakeaway = systemTakeaway(yours);
  const stranded = CAPSTONE_CONDITIONS.ridgeback - builtTakeaway;
  const builtRationed = built.winters.flatMap((w, i) => w.rationedDays.map((d) => ({ winter: i, day: d })));
  const firstRationed = builtRationed[0];
  const builtNL = built.lines.find((l) => l.id === 'calder-metro');
  const builtRB = built.lines.filter((l) => l.id === 'ridgeback-calder' || l.id === 'ridgeback-bayport');
  const builtRBRent = builtRB.reduce((a, l) => a + l.rent, 0);
  const nlRentByWinter = built.winters.map((w) => w.summary.rent['calder-metro']);
  const nlRentMax = Math.max(...nlRentByWinter);
  const nlRentMaxWinter = nlRentByWinter.indexOf(nlRentMax);
  const ridgeAtCost = built.winters.every((w) => w.summary.max.ridgeback <= RIDGEBACK_COST + 1e-6);
  const builtNLWinterOnly = useMemo(() => rmFullOnlyInWinter(AS_BUILT, 'calder-metro'), []);

  // ---- Figure 1.
  const s = useScenario('regional', REGIONAL_MARKET_DEFAULTS);
  const st = s.state;
  const deferred = useDeferredValue(st);
  const net = deferred.network === 'built' ? AS_BUILT : yours;
  const winter = useMemo(() => rmWinter(net, deferred.winter), [net, deferred.winter]);
  const year = useMemo(() => systemYear(net, PRACTICE_SEEDS[deferred.winter]), [net, deferred.winter]);
  const day = Math.max(0, Math.min(GAS_YEAR_DAYS - 1, Math.round(st.day)));
  const d = year.days[day];
  const netCap = useMemo(() => systemCapacity(net), [net]);
  const builtLines = CORRIDORS.filter((c) => netCap[c.id] > 0).map((c) => c.id);
  const fullToday = builtLines.filter((id) => (d.flow[id] ?? 0) >= netCap[id] * FULL - 1e-9);
  const series = useMemo(() => {
    const clip = (n: GasNodeId) => year.days.map((x) => Math.min(RM_PRICE_CAP, x.price[n]));
    const demand = year.days.map((x) => NODES.reduce((a, n) => a + x.served[n], 0));
    const supply = year.days.map((x) => rmSold(x, 'ridgeback') + rmSold(x, 'sandhill'));
    return { calder: clip('calder'), metro: clip('metro'), ridgeback: clip('ridgeback'), demand, supply };
  }, [year]);
  const spikes = winter.metroMax > RM_PRICE_CAP ? [{ x: winter.metroMaxDay, y: RM_PRICE_CAP, color: METRO_COLOR, r: 4, label: gp(winter.metroMax, 0), labelPos: 'left' as const }] : [];
  const [b0, b1] = niceDomain(0, Math.max(...series.demand, TOTAL_PRODUCTION) * 1.05, 4);
  const solved = regionalMarketSolved(st, yours);
  const storageToday = d.storage.saltflat + d.storage.hollowcreek;
  const flowToday = d.storageFlow.saltflat + d.storageFlow.hollowcreek;
  const status =
    st.network === 'built' && changed
      ? 'That is the network as built. Switch to your network.'
      : `On ${dayText(day)} of winter ${st.winter + 1}, Metro pays ${gp(d.price.metro)}. Some day of the eight winters costs it more.`;
  // The success message: the day found, on the reader's network.
  const peakFull = rmFullIntoMetro(yours, d);
  const isDesignMorning = firstRationed ? st.winter === firstRationed.winter && day === firstRationed.day : false;
  const peakSuccess = `Solved: ${dayText(day)} of winter ${st.winter + 1}, ${fmt(d.tempF, 1)} °F${isDesignMorning ? ', the design morning of Lesson 7.1' : ''}. Metro pays ${gp(d.price.metro, d.price.metro % 1 ? 2 : 0)}, ${rmPriceWords(d.price.metro, d.price.calder)}: ${
    peakFull.length ? `${listWords(peakFull.map(rmLineRef))} ${peakFull.length === 1 ? 'is' : 'are'} full` : 'no pipe into Metro is full'
  }, Hollow Creek gives ${bcfd(Math.max(0, -d.storageFlow.hollowcreek))}${d.rationed > 1e-6 ? `, and its homes still go without ${bcfd(d.rationed)}` : ''}. The worst day comes with the worst cold, when the pipes into the city fill and its users bid against one another for what gets through; the price stops at the value of the last user who has to give way.`;
  const builtOnThatDay = firstRationed ? systemYear(AS_BUILT, PRACTICE_SEEDS[firstRationed.winter]).days[firstRationed.day] : null;

  // ---- Figure 2.
  const t = useScenario('regional-eight', RM_TABLE_DEFAULTS);
  const view = t.state.view;
  const ledger = [
    { id: 'producers', who: 'Producers earn', a: built.producers, b: mine.producers },
    { id: 'metro', who: 'Metro’s gas users pay', a: built.metroBill, b: mine.metroBill },
    { id: 'rents', who: 'Full pipes’ rents', a: built.rents, b: mine.rents },
    { id: 'capital', who: changed ? 'Your changes cost' : 'Its changes cost', a: 0, b: mine.capital },
  ];
  const lineRows = CORRIDORS.filter((c) => (built.lines.some((l) => l.id === c.id) || mine.lines.some((l) => l.id === c.id))).map((c) => ({
    id: c.id,
    name: rmLineName(c.id),
    a: built.lines.find((l) => l.id === c.id),
    b: mine.lines.find((l) => l.id === c.id),
  }));
  const winterRows = built.winters.map((w, i) => ({ i, a: w, b: mine.winters[i] }));

  const dProducers = mine.producers - built.producers;
  const dRents = mine.rents - built.rents;
  const dMetro = mine.metroBill - built.metroBill;

  return (
    <LessonPage id="gas/7.2">
      <CapstoneSoFar capstone={cap} />
      <P>
        In <a href={lessonHref('gas/7.1')}>Lesson 7.1</a> you took charge of the region’s network for Year 9 and tested it twice: against one number, Ridgeback’s
        takeaway, and on one morning, the coldest of eight practice winters. A network has to work on every day of the year, though, and the way to find out whether
        it does is to run its market. This lesson runs the region through those eight winters — each a whole gas year, April to March, named for the winter in
        it — on your network, with the market that made Chapter 6’s history: the
        storage operators plan the year on April 1 and redraw the plan on the first of every month from the gas they hold (
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>), and each day the region’s production, demand and storage clear across the pipes, with a price at every
        place (<a href={lessonHref('gas/4.1')}>Lesson 4.1</a>, <a href={lessonHref('gas/4.2')}>Lesson 4.2</a>). As everywhere in this course, the prices are
        simulated.
      </P>
      <P>
        Year 9’s region is the one Chapter 6 left behind, grown a year further: Ridgeback produces {bcfd(CAPSTONE_CONDITIONS.ridgeback)}, Sandhill{' '}
        {bcfd(CAPSTONE_CONDITIONS.sandhill)}, Bayport’s terminal takes {bcfd(CAPSTONE_CONDITIONS.lngBcfd, 1)} of feed gas, and the region burns{' '}
        {pct(CAPSTONE_CONDITIONS.demandScale - 1)} more than in Year 1.{' '}
        {changed
          ? `Your network changes ${word(changes.length)} line${changes.length === 1 ? '' : 's'} — ${changes.join('; ')} — for ${money(cost.added)} of capital, or ${money(cost.annual)} a year. Every figure here sets it beside the network as built.`
          : 'You haven’t changed the network in Lesson 7.1 yet, so for now “your network” here is the network as built: the region’s six lines, with Ridgeback Express on its third compressor station. Change it there and come back, and this lesson runs your version beside it.'}
      </P>
      <P>
        In the next demonstration, choose a practice winter and a network. The upper chart is the price at Calder, Metro and Ridgeback, day by day; the middle one
        is the gas the region burns and exports against what its fields sell, with the difference drawn from <K c="energy">storage</K> or put into it; the map
        shows one day’s flows and prices, each line colored by how full it runs. Drag across either chart to choose the day:
      </P>

      <Figure name="Regional Gas Market" scenario={s}>
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 40 }}>
          <Segmented label="Practice winter" value={String(st.winter)} onChange={(v) => s.set({ winter: Number(v) })} options={WINTER_OPTIONS} />
          <Segmented
            label="Network"
            value={st.network}
            onChange={(v) => s.set({ network: v })}
            options={[
              { value: 'yours', label: changed ? 'Your network' : 'Yours (as built)' },
              { value: 'built', label: 'As built' },
            ]}
          />
        </div>
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, RM_PRICE_CAP]}
          yTicks={[0, 4, 8, 12, 16]}
          xTicks={GAS_MONTH_START}
          xFormat={(v) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? ''}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Price, $/MMBtu, day by day"
          height={155}
          series={[
            { xs: DAYS, ys: series.ridgeback, color: RIDGE_COLOR, width: 1.6 },
            { xs: DAYS, ys: series.calder, color: CALDER_COLOR, width: 3 },
            { xs: DAYS, ys: series.metro, color: METRO_COLOR, width: 1.2 },
          ]}
          hLines={[{ at: OIL_SWITCH_VALUE, color: '#9a9a9a', dash: '4 4', label: 'oil switching', labelAt: 'start', width: 1 }]}
          markers={[
            ...spikes,
            { x: day, y: Math.min(RM_PRICE_CAP, d.price.metro), color: METRO_COLOR, r: 4 },
            { x: day, y: d.price.calder, color: CALDER_COLOR, r: 4 },
            { x: day, y: d.price.ridgeback, color: RIDGE_COLOR, r: 4 },
          ]}
          cursor={day}
          onScrub={(x) => s.set({ day: Math.round(x) })}
          scrubLabel="Day of the gas year"
          ariaLabel={`Prices through practice winter ${st.winter + 1} on ${st.network === 'built' ? 'the network as built' : 'your network'}: Calder averages ${gp(winter.summary.avg.calder)}, Ridgeback ${gp(winter.summary.avg.ridgeback)}, Metro ${gp(winter.summary.avg.metro)}, with Metro’s highest ${gp(winter.metroMax)} on ${dayText(winter.metroMaxDay)}.`}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[b0, b1]}
          yTicks={niceTicks(b0, b1, 4)}
          xTicks={GAS_MONTH_START}
          xFormat={(v) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? ''}
          yFormat={(v) => fmt(v)}
          yLabel="Bcf/d: gas burned and exported, and gas sold by the fields"
          height={110}
          series={[
            { xs: DAYS, ys: series.demand, lows: series.supply, color: GRAPHIC.gold, kind: 'band', opacity: 0.35 },
            { xs: DAYS, ys: series.supply, color: GRAPHIC.orange, width: 2 },
            { xs: DAYS, ys: series.demand, color: TEXT.ink, width: 1.5 },
          ]}
          cursor={day}
          onScrub={(x) => s.set({ day: Math.round(x) })}
          scrubLabel="Day of the gas year"
          ariaLabel={`Gas burned and exported against gas sold by the fields through the winter; on ${dayText(day)} the region burns ${fmt(series.demand[day], 2)} Bcf/d against ${fmt(series.supply[day], 2)} from its fields.`}
        />
        <Legend
          items={[
            { label: 'Calder', color: CALDER_COLOR, kind: 'line' },
            { label: 'Metro', color: METRO_COLOR, kind: 'line' },
            { label: 'Ridgeback', color: RIDGE_COLOR, kind: 'line' },
            { label: 'burned and exported', color: TEXT.ink, kind: 'line' },
            { label: 'fields’ sales', color: GRAPHIC.orange, kind: 'line' },
            { label: 'storage', color: GRAPHIC.gold },
          ]}
        />
        <div style={{ maxWidth: 450, margin: '0 auto' }}>
        <GasMap
          ariaLabel={`The region on ${dayText(day)} of practice winter ${st.winter + 1}, ${fmt(d.tempF)} °F: ${NODES.map((n) => `${GAS_NODE[n].name} ${gp(d.price[n])}`).join(', ')}. ${fullToday.length ? `Running full: ${fullToday.map(rmLineName).join(', ')}.` : 'No line runs full.'}`}
          flows={d.flow}
          capacities={netCap}
          built={builtLines}
          sizes={net.sizes}
          height={380}
          nodeInfo={(id: GasNodeId) => ({
            value: gp(d.price[id]),
            sub: id === 'calder' ? 'the hub' : basis(d.price[id] - d.price.calder),
            fill: rmFill(d.price[id]),
          })}
          storage={(id) => {
            const f = d.storageFlow[id as 'saltflat' | 'hollowcreek'];
            const inv = d.storage[id as 'saltflat' | 'hollowcreek'];
            const verb = f < -1e-6 ? `drawing ${fmt(-f, 2)}` : f > 1e-6 ? `filling ${fmt(f, 2)}` : 'idle';
            return `${fmt(inv)} Bcf · ${verb}`;
          }}
        />
        </div>
        <Readouts
          items={[
            { label: 'Calder’s average', value: gp(winter.summary.avg.calder), tone: 'green' },
            { label: 'Ridgeback’s basis', value: basis(winter.summary.avg.ridgeback - winter.summary.avg.calder), tone: 'green' },
            { label: 'Metro’s highest', value: gp(winter.metroMax), tone: 'green' },
            { label: 'days of rationing', value: fmt(winter.rationedDays.length) },
          ]}
        />
        <Caption>
          {dayText(day)}, {fmt(d.tempF)} °F at Metro: the region burns and exports {bcfd(series.demand[day])}, its fields sell {bcfd(series.supply[day])}, and storage{' '}
          {flowToday < -1e-6 ? `gives up ${bcfd(-flowToday)}` : flowToday > 1e-6 ? `takes in ${bcfd(flowToday)}` : 'sits idle'}, leaving {bcf(storageToday, 0)}.{' '}
          {fullToday.length ? `Running full: ${fullToday.map(rmLineName).join(', ')}.` : 'No line runs full.'}
          {d.rationed > 1e-6 ? ` Metro’s homes go without ${bcfd(d.rationed)}.` : ''}
        </Caption>
      </Figure>

      <P>
        Begin with the network as built. Ridgeback’s price {ridgeAtCost ? 'never rises above' : 'rarely rises above'} {gp(RIDGEBACK_COST)}, the cost of keeping its
        wells flowing, in any of the eight winters, and its basis averages {basis(built.ridgebackBasis)}. Ridgeback produces{' '}
        {bcfd(CAPSTONE_CONDITIONS.ridgeback)}, and its pipes and its own field can take only {bcfd(builtTakeaway)}. The {bcfd(stranded)} left over is a sliver, but
        as in <a href={lessonHref('gas/5.1')}>Lesson 5.1</a> the last molecule decides the price: with nowhere to send it, every molecule in the basin is worth only
        what it costs to produce. Metro’s trouble comes on the coldest days. Northline runs full on about {fmt(builtNL?.fullDays ?? 0)} days a year
        {builtNLWinterOnly ? ', all of them in winter' : ''}, and on those days Metro’s price climbs the demand curve of Lesson 4.1 as one user after another gives
        way: power plants that can burn coal, then interruptible industry at {gp(RM_INTERRUPTIBLE, 0)}, then power plants switching to oil at{' '}
        {gp(OIL_SWITCH_VALUE, 0)} — in {word(built.oilWinters)} of the eight winters — then the rest of Metro’s industry at {gp(RM_INDUSTRY, 0)}, and last of all
        its homes, at the {gp(PROTECTED_VALUE, 0)} that rationing costs. How far up that ladder does your network’s worst day go, and when does it come? Lesson
        7.1 has given you a candidate:
      </P>

      <Challenge
        id="a"
        figure="Regional Gas Market"
        question="Predict, then check: on your network, which day of the eight practice winters brings Metro’s highest price, and which pipes into Metro are full that day? Find the day."
        solved={solved}
        status={status}
        success={peakSuccess}
      />

      <P>
        {firstRationed && builtOnThatDay
          ? `As built, the worst day is ${dayText(firstRationed.day)} of winter ${firstRationed.winter + 1}, Lesson 7.1’s design morning: at ${fmt(builtOnThatDay.tempF, 1)} °F Metro reaches ${gp(PROTECTED_VALUE, 0)} and its homes go without ${bcfd(builtOnThatDay.rationed)}, the only day of the eight winters when they do.`
          : ''}{' '}
        {changed ? (
          <>
            On your network,{' '}
            {mine.ridgebackBasis > -0.2
              ? `Ridgeback’s basis is back at the cost of the trip, averaging ${basis(mine.ridgebackBasis)}: your ${bcfd(yourTakeaway)} of takeaway carries out all ${bcfd(CAPSTONE_CONDITIONS.ridgeback)}, and the basin’s price follows Calder’s instead of its own cost.`
              : `Ridgeback is still stranded, its basis averaging ${basis(mine.ridgebackBasis)}: ${bcfd(yourTakeaway)} of takeaway can’t carry ${bcfd(CAPSTONE_CONDITIONS.ridgeback)}.`}{' '}
            {mine.rationedDays === 0
              ? `At Metro, the highest price of the eight winters is ${gp(mine.metroMax, mine.metroMax % 1 ? 2 : 0)} instead of ${gp(built.metroMax, built.metroMax % 1 ? 2 : 0)}, and no home goes without gas.`
              : `At Metro, homes still go without gas on ${word(mine.rationedDays)} day${mine.rationedDays === 1 ? '' : 's'} of the eight winters, and the price reaches ${gp(mine.metroMax)}.`}{' '}
            Calder hardly notices either way: its average over the eight winters is {gp(mine.calder)} on your network and {gp(built.calder)} as built. The hub’s
            level is set by the whole region’s balance and the weather, through storage and the seasons of Lesson 4.4, not by one basin’s pipe.
          </>
        ) : (
          <>
            Your network is the one as built, so it shares all of this. Notice what the market says about the remedies before you go back to choose one: the
            basis at Ridgeback is the whole basin’s price, set by a sliver of gas, so a sliver of pipe should end it; and Metro’s spikes come on a handful of days,
            so what Metro needs is capacity for those days, not for the average one. Notice, too, how little Calder moves between winters next to Metro and
            Ridgeback: its average over the eight winters is {gp(built.calder)}, and the hub’s level is set by the whole region’s balance and the weather,
            through storage and the seasons of Lesson 4.4, not by one basin’s pipe.
          </>
        )}
      </P>

      <H2>Who gains</H2>
      <P>
        A pipeline changes more than prices: it changes who is paid. In the next demonstration the eight winters are added up and shown as an average year. The
        first view sets out the money — what the region’s producers earn on the gas they sell, what Metro’s gas users pay, what the holders of full pipes collect
        as <K c="price">rent</K> (the price gap across a full pipe beyond the cost of the trip, times the gas it carries, as in Lesson 5.1), and what the changes
        to the network cost each year at the capital charge of <a href={lessonHref('gas/3.1')}>Lesson 3.1</a>. The other two views go line by line and winter by
        winter:
      </P>

      <Figure name="Regional Gas Market · eight winters" scenario={t}>
        <Segmented
          label="Show"
          value={view}
          onChange={(v) => t.set({ view: v })}
          options={[
            { value: 'money', label: 'Who gains' },
            { value: 'lines', label: 'Line by line' },
            { value: 'winters', label: 'Winter by winter' },
          ]}
        />
        {view === 'money' && (
          <DataTable
            caption={`An average year of the eight practice winters, as built and on ${otherName}`}
            columns={[
              { label: 'A year', cell: (r: (typeof ledger)[0]) => r.who },
              { label: 'as built', cell: (r) => (r.id === 'capital' ? '—' : money(r.a)), align: 'right' },
              { label: changed ? 'yours' : 'cheapest', cell: (r) => money(r.b), align: 'right' },
              { label: 'change', cell: (r) => rmChange(r.b - r.a), align: 'right' },
            ]}
            rows={ledger}
            rowKey={(r) => r.id}
          />
        )}
        {view === 'lines' && (
          <DataTable
            caption={`Each line’s capacity, days full and rent in an average winter, as built and on ${otherName}`}
            columns={[
              { label: 'Line', cell: (r: (typeof lineRows)[0]) => r.name },
              { label: 'Bcf/d', cell: (r) => `${r.a ? fmt(r.a.capacity, 2) : '—'} → ${r.b ? fmt(r.b.capacity, 2) : '—'}`, align: 'right' },
              { label: 'days full a year', cell: (r) => `${r.a ? fmt(r.a.fullDays) : '—'} → ${r.b ? fmt(r.b.fullDays) : '—'}`, align: 'right' },
              { label: 'rent a year', cell: (r) => `${r.a ? money(r.a.rent) : '—'} → ${r.b ? money(r.b.rent) : '—'}`, align: 'right' },
            ]}
            rows={lineRows}
            rowKey={(r) => r.id}
            rowClass={(r) => ((r.a?.rent ?? 0) > 1e6 || (r.b?.rent ?? 0) > 1e6 ? 'hl' : '')}
          />
        )}
        {view === 'winters' && (
          <DataTable
            caption={`Each practice winter, as built and on ${otherName}`}
            columns={[
              { label: 'Winter', cell: (r: (typeof winterRows)[0]) => String(r.i + 1) },
              { label: 'Heating degree days vs normal', cell: (r) => `${r.a.colder >= 0 ? '+' : '−'}${fmt(Math.abs(r.a.colder))}`, align: 'right' },
              { label: 'Ridgeback basis', cell: (r) => `${basis(r.a.summary.avg.ridgeback - r.a.summary.avg.calder)} → ${basis(r.b.summary.avg.ridgeback - r.b.summary.avg.calder)}`, align: 'right' },
              { label: 'Metro’s highest', cell: (r) => `${gp(r.a.metroMax, 0)} → ${gp(r.b.metroMax, 0)}`, align: 'right' },
              { label: 'Northline rent, $ million', cell: (r) => `${fmt(r.a.summary.rent['calder-metro'] / 1e6, 1)} → ${fmt(r.b.summary.rent['calder-metro'] / 1e6, 1)}`, align: 'right' },
            ]}
            rows={winterRows}
            rowKey={(r) => r.i}
            rowClass={(r) => (r.a.rationedDays.length || r.b.rationedDays.length ? 'hl' : '')}
          />
        )}
        <Readouts
          items={[
            { label: 'Calder’s average, eight winters', value: `${gp(built.calder)} → ${gp(mine.calder)}`, tone: 'green' },
            { label: 'days homes went without, eight winters', value: `${fmt(built.rationedDays)} → ${fmt(mine.rationedDays)}` },
          ]}
        />
        <Caption>
          {changed ? '' : 'Your network is still the one as built, so the comparison is with Lesson 7.1’s cheapest network: a fourth station on the Coastal Line and a fifth on the Valley Line. '}
          {view === 'money'
            ? 'Averages over the eight practice winters. Producers are Ridgeback’s and Sandhill’s, earning on the gas they sell; the changes cost their capital charge.'
            : view === 'lines'
              ? `Each cell reads “as built → ${otherName}”, averaged over the eight practice winters; highlighted lines carry more than a million dollars of rent a year.`
              : `Each cell reads “as built → ${otherName}”; the highlighted winter has a day when homes went without gas. A winter’s heating degree days add up, from November to March, how far each day’s mean temperature fell below 65 °F (Lesson 6.1); the column shows how many more (+) or fewer (−) the winter had than a normal one.`}
        </Caption>
      </Figure>

      <P>
        As built, the holders of Ridgeback Express and the Coastal Line collect {money(builtRBRent)} a year between them, and Ridgeback’s producers sell their gas
        for {money(built.ridgebackSales)}. That rent isn’t a cost of anything. It is the price gap across two full pipes, set by the {bcfd(stranded)} that can’t get
        out, and it moves money from the basin’s producers to whoever holds the pipes’ capacity. Northline’s rent is smaller and lumpier, the way Lesson 5.1 found a
        market’s basis to be: {money(builtNL?.rent ?? 0)} in an average winter, but {money(nlRentMax)} in winter {nlRentMaxWinter + 1} alone, the winter of Metro’s
        coldest morning.
      </P>
      <P>
        {changed ? (
          <>
            On your network, the producers earn {moreLess(dProducers)} a year, the rents on full pipes come to {moreLess(dRents)}, and Metro’s gas users pay{' '}
            {moreLess(dMetro)}, against {money(mine.capital)} a year for your changes.{' '}
          </>
        ) : (
          <>
            Your network is still the one as built, so the demonstration sets it beside Lesson 7.1’s cheapest network, the Coastal Line’s fourth station and the
            Valley Line’s fifth. There the producers earn {moreLess(dProducers)} a year, the rents on full pipes come to {moreLess(dRents)}, and Metro’s gas users pay{' '}
            {moreLess(dMetro)}, against {money(mine.capital)} a year for the changes; Calder’s average moves only from {gp(built.calder)} to {gp(mine.calder)}.{' '}
          </>
        )}
        The capital charge is small beside the money a pipe moves, and that is typical: a full pipe’s rent is mostly a transfer, from the producers stuck behind it
        or the customers stuck in front of it to the holders of its capacity, and it can be far larger than the cost of the steel that would end it. Who gains from
        an expansion is therefore no mystery — the producers behind it and the customers in front of it — and they are the shippers who, as in{' '}
        <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>, sign the long firm contracts that pay for one, because the rent that measured the need disappears the day
        the pipe opens.
      </P>
      <P>
        Running the market showed, with hindsight, where <FigRef to="Regional Gas Market">your network</FigRef> binds and what that costs. A trader doesn’t get
        hindsight. On a given morning there is only what is known that day — the gas in storage, the market’s curve, a two-week weather forecast whose skill fades
        as it reaches ahead — and from it, a judgment about where the network will bind next. Making that judgment, and checking it against the winter, is the challenge of{' '}
        <a href={lessonHref('gas/7.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
