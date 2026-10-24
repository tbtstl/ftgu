import { useDeferredValue, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  niceDomain,
  niceTicks,
  pct,
} from '../../../framework';
import {
  PASSIVE,
  PORTFOLIO_DEFAULTS,
  PRACTICE_SEEDS,
  portfolioYear,
  summarizeYear,
  systemCost,
  systemKey,
  systemYear,
  winterColder,
  type FirmLine,
  type GasSystem,
  type PortfolioSettings,
  type PortfolioYear,
} from '../../../engines/gas/capstone';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { GAS_MONTHS, GAS_MONTH_NAMES } from '../../../model/gas/weather';
import { CORRIDORS, GAS_NODES, PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { resetGasPortfolio, updateGasPortfolio, useGasCapstone } from '../shared/capstone';
import { basis, bcf, money as moneyExact } from '../shared/format';

// ---------------------------------------------------------------------------
// The reader's portfolio over the eight practice winters.

const MMBTU_PER_BCF = MMBTU_PER_MCF * 1e6;
const SALT_FLAT_BCF = STORAGE_SPECS.saltflat.workingBcf;
/** Largest lease the figures offer, Bcf of Salt Flat's working gas, and its step. */
export const PM_LEASE_MAX = 6;
export const PM_LEASE_STEP = 0.25;
/** Firm capacity and Metro basis volumes on offer, MMBtu/d. */
export const PM_VOLUME_MAX = 50_000;
export const PM_VOLUME_STEP = 5_000;
/** The challenge: money in every practice winter, this much on average, and no more than this cash at any time, $. */
export const PM_TARGET = { mean: 1.5e6, capital: 15e6 };
/** Figure 1: the practice winter shown (0–7). */
export const PM_DEFAULTS = { winter: 0 };

/** The lease in Bcf of Salt Flat's working gas, and back. */
export function pmLeaseBcf(p: PortfolioSettings): number {
  return p.storageShare * SALT_FLAT_BCF;
}
export function pmShare(leaseBcf: number): number {
  return leaseBcf / SALT_FLAT_BCF;
}

export type PmPart = 'storage' | 'firm' | 'toll' | 'weather' | 'metro';
export const PM_PARTS: PmPart[] = ['storage', 'firm', 'toll', 'weather', 'metro'];
const PART_COLOR: Record<PmPart, string> = {
  storage: GRAPHIC.gold,
  firm: GRAPHIC.orange,
  toll: GRAPHIC.red,
  weather: GRAPHIC.teal,
  metro: GRAPHIC.green,
};
const PART_NAME: Record<PmPart, string> = {
  storage: 'lease',
  firm: 'firm capacity',
  toll: 'toll',
  weather: 'weather trades',
  metro: 'Metro basis',
};

/** Whether a portfolio holds a part at all. */
export function pmHolds(p: PortfolioSettings, part: PmPart): boolean {
  if (part === 'storage') return p.storageShare > 0;
  if (part === 'firm') return p.firmMMBtuD > 0;
  if (part === 'toll') return p.toll;
  if (part === 'weather') return p.weatherLots > 0 && p.skill > 0;
  return p.metroSellMMBtuD > 0;
}

export interface PmEight {
  years: PortfolioYear[];
  totals: number[];
  mean: number;
  worst: number;
  best: number;
  /** Winters that made money. */
  wins: number;
  /** Most cash the portfolio needed in any of the winters, $. */
  peakCapital: number;
  /** The average winter's profit as a share of that cash. */
  returnOnCash: number;
}

const eightCache = new Map<string, PmEight>();

/** A portfolio through the eight practice winters on a network (cached). */
export function pmEight(s: GasSystem, p: PortfolioSettings): PmEight {
  const key = `${systemKey(s)}#${JSON.stringify(p)}`;
  const hit = eightCache.get(key);
  if (hit) return hit;
  const years = PRACTICE_SEEDS.map((seed) => portfolioYear(s, seed, p));
  const totals = years.map((y) => y.total);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const peakCapital = Math.max(...years.map((y) => y.peakCapital));
  const r: PmEight = {
    years,
    totals,
    mean,
    worst: Math.min(...totals),
    best: Math.max(...totals),
    wins: totals.filter((t) => t > 0).length,
    peakCapital,
    returnOnCash: peakCapital > 0 ? mean / peakCapital : 0,
  };
  if (eightCache.size > 400) eightCache.clear();
  eightCache.set(key, r);
  return r;
}

/** The challenge: money in every practice winter, at least PM_TARGET.mean on average, and never more than PM_TARGET.capital of cash. */
export function portfolioManagerSolved(s: GasSystem, p: PortfolioSettings): boolean {
  const e = pmEight(s, p);
  return e.worst > 0 && e.mean >= PM_TARGET.mean - 1e-6 && e.peakCapital <= PM_TARGET.capital + 1e-6;
}

export interface PmDrivers {
  /** Degree-days colder than normal over November–March (negative = milder). */
  colder: number[];
  /** Days Northline ran full. */
  northlineFull: number[];
  /** Ridgeback's average basis, $/MMBtu. */
  ridgebackBasis: number[];
}

const driverCache = new Map<string, PmDrivers>();

/** What decided each practice winter on a network: its cold, Northline's full days and Ridgeback's basis (cached). */
export function pmDrivers(s: GasSystem): PmDrivers {
  const key = systemKey(s);
  const hit = driverCache.get(key);
  if (hit) return hit;
  const sums = PRACTICE_SEEDS.map((seed) => {
    const y = systemYear(s, seed);
    return { y, sum: summarizeYear(s, y) };
  });
  const r: PmDrivers = {
    colder: sums.map((x) => winterColder(x.y.weather)),
    northlineFull: sums.map((x) => x.sum.fullDays['calder-metro']),
    ridgebackBasis: sums.map((x) => x.sum.avg.ridgeback - x.sum.avg.calder),
  };
  driverCache.set(key, r);
  return r;
}

/** Positions held alone, at the sizes the portfolio starts with. */
const LEASE_ONLY: PortfolioSettings = { ...PASSIVE, storageShare: PORTFOLIO_DEFAULTS.storageShare, storageHedged: true };
const LEASE_UNHEDGED: PortfolioSettings = { ...LEASE_ONLY, storageHedged: false };
const FIRM_ONLY: PortfolioSettings = { ...PASSIVE, firmLine: 'calder-metro', firmMMBtuD: PORTFOLIO_DEFAULTS.firmMMBtuD };
const METRO_GUARDED: PortfolioSettings = { ...PASSIVE, metroSellMMBtuD: PORTFOLIO_DEFAULTS.metroSellMMBtuD, metroSkipColderF: PORTFOLIO_DEFAULTS.metroSkipColderF };
const METRO_OPEN: PortfolioSettings = { ...METRO_GUARDED, metroSkipColderF: null };
const BOTH_SIDES: PortfolioSettings = { ...FIRM_ONLY, metroSellMMBtuD: PORTFOLIO_DEFAULTS.metroSellMMBtuD, metroSkipColderF: null };
const TOLL_ONLY: PortfolioSettings = { ...PASSIVE, toll: true };
const WEATHER_ONLY: PortfolioSettings = { ...PASSIVE, weatherLots: PORTFOLIO_DEFAULTS.weatherLots, skill: PORTFOLIO_DEFAULTS.skill, weatherThresholdF: PORTFOLIO_DEFAULTS.weatherThresholdF };

const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));
const argmin = (xs: number[]) => xs.indexOf(Math.min(...xs));

/** Running totals from monthly profits, starting at zero (13 values). */
export function pmRunning(monthly: number[]): number[] {
  const out = [0];
  monthly.forEach((m) => out.push(out[out.length - 1] + m));
  return out;
}

export interface PmNumbers {
  ref: PmEight;
  first: PortfolioYear;
  /** The lease in the first winter: its lowest running total and the month it came. */
  leaseLow: number;
  leaseLowMonth: number;
  /** The month the lease earned the most, and how much. */
  leaseBestMonth: number;
  leaseBestMonthCash: number;
  /** Most gas the lease's schedule still had to buy or sell at unfixed prices in the first winter, Bcf, hedged and not, and the month of the latter. */
  exposureHedged: number;
  exposureOpen: number;
  exposureOpenMonth: number;
  lease: PmEight;
  leaseOpen: PmEight;
  firm: PmEight;
  firmFee: number;
  metroGuarded: PmEight;
  metroOpen: PmEight;
  both: PmEight;
  toll: PmEight;
  tollFee: number;
  weather: PmEight;
  drivers: PmDrivers;
}

const numbersCache = new Map<string, PmNumbers>();

/** Everything the prose quotes, on a network, for the positions the portfolio starts with (cached). */
export function pmNumbers(s: GasSystem): PmNumbers {
  const key = systemKey(s);
  const hit = numbersCache.get(key);
  if (hit) return hit;
  const ref = pmEight(s, PORTFOLIO_DEFAULTS);
  const first = ref.years[0];
  const leaseRun = pmRunning(first.storage.monthly);
  const lowAt = argmin(leaseRun);
  const bestAt = argmax(first.storage.monthly);
  const leaseOpen = pmEight(s, LEASE_UNHEDGED);
  const openExposure = leaseOpen.years[0].exposure;
  const firm = pmEight(s, FIRM_ONLY);
  const toll = pmEight(s, TOLL_ONLY);
  const r: PmNumbers = {
    ref,
    first,
    leaseLow: leaseRun[lowAt],
    leaseLowMonth: Math.max(0, lowAt - 1),
    leaseBestMonth: bestAt,
    leaseBestMonthCash: first.storage.monthly[bestAt],
    exposureHedged: Math.max(...first.exposure) / MMBTU_PER_BCF,
    exposureOpen: Math.max(...openExposure) / MMBTU_PER_BCF,
    exposureOpenMonth: argmax(openExposure),
    lease: pmEight(s, LEASE_ONLY),
    leaseOpen,
    firm,
    firmFee: firm.years[0].firm.fee,
    metroGuarded: pmEight(s, METRO_GUARDED),
    metroOpen: pmEight(s, METRO_OPEN),
    both: pmEight(s, BOTH_SIDES),
    toll,
    tollFee: toll.years[0].toll.fee,
    weather: pmEight(s, WEATHER_ONLY),
    drivers: pmDrivers(s),
  };
  numbersCache.set(key, r);
  return r;
}

/** The reader's network in words: as built, or the lines changed and what they cost. */
export function pmNetworkWords(s: GasSystem): { asBuilt: boolean; changed: string[]; capital: number } {
  const c = systemCost(s);
  const place = (g: string) => GAS_NODES.find((x) => x.id === g)!.name;
  const name = (id: string) => {
    if (PIPELINE[id]) return PIPELINE[id].name;
    const k = CORRIDORS.find((x) => x.id === id)!;
    return `a new ${place(k.from)}–${place(k.to)} line`;
  };
  return { asBuilt: c.changed.length === 0, changed: c.changed.map(name), capital: c.added };
}

// ---------------------------------------------------------------------------
// Small pieces of text and charts.

/** Money as the prose quotes it: thousands below a million, as `money` above. */
function money(x: number): string {
  return moneyExact(Math.abs(x) < 1e6 ? Math.round(x / 1000) * 1000 : x);
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function word(n: number): string {
  return WORDS[n] ?? fmt(n);
}

/** "made $1.2 million" / "lost $40,000". */
function madeLost(x: number): string {
  return `${x >= 0 ? 'made' : 'lost'} ${money(Math.abs(x))}`;
}

/** "+$1.2 million" / "−$40,000". */
function signedMoney(x: number): string {
  return `${x >= 0 ? '+' : '−'}${money(Math.abs(x))}`;
}

const MONTH_TICKS = Array.from({ length: 13 }, (_, i) => i);
const monthTick = (v: number) => (v < 12 ? GAS_MONTHS[v] : '');
const WINTER_OPTIONS = PRACTICE_SEEDS.map((_, i) => ({ value: String(i), label: i === 0 ? 'Winter 1' : String(i + 1) }));
const MILLION = 1e6;

type GuardKey = 'never' | '0' | '2' | '4';
function guardKey(v: number | null): GuardKey {
  if (v === null) return 'never';
  return v <= 1 ? '0' : v <= 3 ? '2' : '4';
}

/** The portfolio's controls, shared by both demonstrations; every change is saved for Lesson 7.5. */
function PortfolioControls({ p }: { p: PortfolioSettings }) {
  const set = (patch: Partial<PortfolioSettings>) => updateGasPortfolio((q) => ({ ...q, ...patch }));
  const lease = pmLeaseBcf(p);
  return (
    <div>
      <Slider
        label="Salt Flat lease"
        tone="gold"
        value={lease}
        min={0}
        max={PM_LEASE_MAX}
        step={PM_LEASE_STEP}
        onChange={(v) => set({ storageShare: pmShare(v) })}
        display={lease > 0 ? bcf(lease, 2) : 'none'}
      />
      <Checkbox label="Hedge the lease’s schedule with futures" checked={p.storageHedged} onChange={(v) => set({ storageHedged: v })} />
      <Segmented<FirmLine>
        label="Line for firm capacity"
        value={p.firmLine}
        onChange={(v) => set({ firmLine: v })}
        options={[
          { value: 'calder-metro', label: 'Firm capacity on Northline' },
          { value: 'ridgeback-calder', label: 'on Ridgeback Express' },
        ]}
      />
      <Slider
        label="Firm capacity"
        tone="orange"
        value={p.firmMMBtuD}
        min={0}
        max={PM_VOLUME_MAX}
        step={PM_VOLUME_STEP}
        onChange={(v) => set({ firmMMBtuD: v })}
        display={p.firmMMBtuD > 0 ? `${fmt(p.firmMMBtuD)} MMBtu/d` : 'none'}
      />
      <Checkbox label="Toll Lakeside for the year" checked={p.toll} onChange={(v) => set({ toll: v })} />
      <Slider
        label="Weather trades"
        value={p.weatherLots}
        min={0}
        max={50}
        step={5}
        onChange={(v) => set({ weatherLots: v })}
        display={p.weatherLots > 0 ? `${fmt(p.weatherLots)} lots` : 'none'}
      />
      <Slider label="Weather forecast skill" tone="teal" value={p.skill} min={0} max={1} step={0.05} onChange={(v) => set({ skill: v })} display={fmt(p.skill, 2)} />
      <Slider
        label="Trade when forecast is off by"
        tone="teal"
        value={p.weatherThresholdF}
        min={0}
        max={5}
        step={0.5}
        onChange={(v) => set({ weatherThresholdF: v })}
        display={`${fmt(p.weatherThresholdF, 1)} °F`}
      />
      <Slider
        label="Metro basis sold"
        tone="green"
        value={p.metroSellMMBtuD}
        min={0}
        max={PM_VOLUME_MAX}
        step={PM_VOLUME_STEP}
        onChange={(v) => set({ metroSellMMBtuD: v })}
        display={p.metroSellMMBtuD > 0 ? `${fmt(p.metroSellMMBtuD)} MMBtu/d` : 'none'}
      />
      <Segmented<GuardKey>
        label="When to stand aside from selling Metro’s basis"
        value={guardKey(p.metroSkipColderF)}
        onChange={(v) => set({ metroSkipColderF: v === 'never' ? null : Number(v) })}
        options={[
          { value: 'never', label: 'Sell Metro’s basis always' },
          { value: '0', label: 'not if colder' },
          { value: '2', label: 'not if 2 °F colder' },
          { value: '4', label: 'not if 4 °F colder' },
        ]}
      />
    </div>
  );
}

/** A small table under the eight-winter chart: one column per winter, lined up with its x axis. */
function WinterRows({ rows, ariaLabel }: { rows: Array<{ label: string; color: string; cells: string[] }>; ariaLabel: string }) {
  const left = 56;
  const right = 624;
  const col = (right - left) / PRACTICE_SEEDS.length;
  const h = rows.length * 17 + 6;
  return (
    <svg className="chart" viewBox={`0 0 640 ${h}`} role="img" aria-label={ariaLabel} style={{ display: 'block', marginTop: -4 }}>
      {rows.map((r, i) => (
        <g key={r.label}>
          <text className="ax ax-e" x={left - 6} y={14 + i * 17} style={{ fontSize: 11 }}>
            {r.label}
          </text>
          {r.cells.map((c, w) => (
            <text key={w} className="ax ax-m" x={left + col * (w + 0.5)} y={14 + i * 17} style={{ fontSize: 11, fill: r.color }}>
              {c}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Ticks for a $ million axis that includes zero. */
function moneyAxis(lo: number, hi: number): { domain: [number, number]; ticks: number[] } {
  const [a, b] = niceDomain(Math.min(0, lo), Math.max(0, hi, 0.1), 5);
  return { domain: [a, b], ticks: niceTicks(a, b, 5) };
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const cap = useGasCapstone();
  const system = cap.system;
  const p = cap.portfolio;
  const net = pmNetworkWords(system);
  const sysKey = systemKey(system);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const n = useMemo(() => pmNumbers(system), [sysKey]);

  // ---- Figure 1: one winter.
  const [winter, setWinter] = useState(PM_DEFAULTS.winter);
  const live = useDeferredValue(p);
  const year = useMemo(() => portfolioYear(system, PRACTICE_SEEDS[winter], live), [system, winter, live]);
  const held = PM_PARTS.filter((part) => pmHolds(live, part));
  const runs = useMemo(() => Object.fromEntries(PM_PARTS.map((part) => [part, pmRunning(year[part].monthly).map((v) => v / MILLION)])) as Record<PmPart, number[]>, [year]);
  const totalRun = useMemo(() => pmRunning(year.monthly).map((v) => v / MILLION), [year]);
  const runAll = [...totalRun, ...held.flatMap((part) => runs[part])];
  const ax1 = moneyAxis(Math.min(...runAll), Math.max(...runAll));
  const fees = year.storage.fee + year.firm.fee + year.toll.fee;
  const leaseBcf = pmLeaseBcf(live);
  const inventory = leaseBcf > 0 ? [...year.storage.inventory, year.storage.inventory[11] + year.storage.moves[11]] : Array<number>(13).fill(0);
  const exposure = year.exposure.map((e) => e / MMBTU_PER_BCF);
  const expMax = Math.max(leaseBcf, ...exposure, 0.5);
  const ret = year.peakCapital > 0 ? year.total / year.peakCapital : 0;
  const partWords = held.map((part) => {
    const x = year[part];
    const extra =
      part === 'weather'
        ? ` from ${word(year.weather.trades)} trade${year.weather.trades === 1 ? '' : 's'}`
        : part === 'metro'
          ? ` from ${word(year.metro.trades)} month${year.metro.trades === 1 ? '' : 's'} sold`
          : ` after its ${money(x.fee)} fee`;
    return `the ${PART_NAME[part]} ${signedMoney(x.total)}${extra}`;
  });

  // ---- Figure 2: eight winters.
  const eight = useMemo(() => pmEight(system, live), [system, live]);
  const stacks = eight.years.map((y) =>
    PM_PARTS.map((part) => ({ part, v: y[part].total / MILLION })).filter((x) => Math.abs(x.v) > 1e-9),
  );
  const ups = stacks.map((s) => s.filter((x) => x.v > 0).reduce((a, x) => a + x.v, 0));
  const downs = stacks.map((s) => s.filter((x) => x.v < 0).reduce((a, x) => a + x.v, 0));
  const ax2 = moneyAxis(Math.min(...downs), Math.max(...ups));
  const solved = portfolioManagerSolved(system, p);
  const ePeak = eight.peakCapital;
  const status = `Now: ${money(eight.mean)} a winter on average, ${eight.worst > 0 ? `${money(eight.worst)} in the worst` : `${madeLost(eight.worst)} in the worst`}, money in ${eight.wins === 8 ? 'all eight' : `${word(eight.wins)} of the eight`}, and at most ${money(ePeak)} of cash.`;

  // ---- Prose numbers (the portfolio as it starts, on this network).
  const r = n.ref;
  const lease = n.lease;
  const open = n.leaseOpen;
  const firmBest = argmax(n.firm.totals);
  const firmWins = n.firm.wins;
  const metroWorst = argmin(n.metroOpen.totals);
  const guardHelps = n.metroGuarded.mean > n.metroOpen.mean + 10_000;
  const bothSpread = Math.max(...n.both.totals.map(Math.abs));
  const stale = n.firm.mean < -0.1 * n.firmFee && n.metroOpen.mean > 0;
  const refWorst = argmin(r.totals);
  const refWorstParts = PM_PARTS.filter((part) => r.years[refWorst][part].total < 0).map((part) => PART_NAME[part]);
  const tollWins = n.toll.years.filter((y) => y.toll.total > 0).length;
  const guardHurts = n.metroGuarded.mean < n.metroOpen.mean - 10_000;
  const guardMissed = n.metroOpen.totals[metroWorst] < 0 && n.metroGuarded.totals[metroWorst] <= n.metroOpen.totals[metroWorst] + 1000;
  const weatherBest = n.weather.returnOnCash > Math.max(n.lease.returnOnCash, n.toll.returnOnCash, n.firm.returnOnCash, n.metroGuarded.returnOnCash);
  const leaseShare = n.first.storage.total >= n.first.total ? 'all of it' : n.first.storage.total >= n.first.total / 2 ? 'most of it' : 'part of it';
  const refFirmBest = argmax(r.years.map((y) => y.firm.total));
  const refMetroWorst = argmin(r.years.map((y) => y.metro.total));
  const refLeaseWins = r.years.filter((y) => y.storage.total > 0).length;
  const mineLeaseAlways = pmHolds(p, 'storage') && eight.years.every((y) => y.storage.total > 0);

  const netLink = (
    <a href={lessonHref('gas/7.1')}>{net.asBuilt ? 'the network as built' : 'your network from Lesson 7.1'}</a>
  );

  return (
    <LessonPage id="gas/7.4">
      <P>
        <a href={lessonHref('gas/7.3')}>The previous lesson</a> ended with forecasts that are right on average and wrong, sometimes badly, in the months that matter
        most. A trader can live with forecasts like that only by holding positions whose misses can be survived. This lesson puts such positions together into a{' '}
        <K c="price">portfolio</K> on your network — the pieces Chapter 6 tested one at a time, now held side by side — and runs it through the eight practice
        winters of <a href={lessonHref('gas/7.2')}>Lesson 7.2</a>. The network running is {netLink}
        {net.asBuilt
          ? ', the region’s six pipelines in Year 9'
          : `, with ${net.changed.length === 1 ? 'one change' : `${word(net.changed.length)} changes`} (${net.changed.join('; ')}) costing ${money(net.capital)} of capital`}
        ; change it in Lesson 7.1 and everything here follows.
      </P>
      <P>
        There are five kinds of position, each from a lesson you’ve met. A lease of space in Salt Flat, run like the storage desk of{' '}
        <a href={lessonHref('gas/6.4')}>Lesson 6.4</a>: on the first of each month its schedule is redrawn on that day’s curve from the gas it holds, and the
        month’s move is bought or sold at the month’s average price, with every later move locked in with futures if you hedge it.{' '}
        <K tone="orange">Firm capacity</K> on Northline or Ridgeback Express, used on every day the price at the far end beats the near end by more than the trip
        (<a href={lessonHref('gas/4.3')}>Lesson 4.3</a>). A toll on Lakeside, the right to run the plant for the year and keep its spark spread (
        <a href={lessonHref('gas/5.3')}>Lesson 5.3</a>). The prompt month’s gas, bought or sold on its first day when the two-week forecast leans cold or warm (
        <a href={lessonHref('gas/6.1')}>Lesson 6.1</a>). And Metro’s winter <K c="price">basis</K>, sold on the first of December, January and February unless the
        forecast warns of cold (<a href={lessonHref('gas/6.3')}>Lesson 6.3</a>).
      </P>
      <P>
        Each physical asset is sold to you at the price April 1’s curve puts on it, its intrinsic value: on this network, {money(n.first.storage.fee)} for a{' '}
        {bcf(pmLeaseBcf(PORTFOLIO_DEFAULTS), 0)} lease, {money(n.firmFee)} for {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of firm Northline capacity, and{' '}
        {money(n.tollFee)} for the toll. It is a fair price, so an asset pays its holder only what the year adds to the curve’s value: what redrawing a schedule
        earns, the days a pipe or a plant is worth more than its month’s forward price said, or something about your network the market has missed. Trades pay
        Chapter 6’s costs and post its margin (<a href={lessonHref('gas/6.5')}>Lesson 6.5</a>), and as everywhere in this course, the prices are simulated.
      </P>
      <P>
        In the next demonstration, set up the portfolio and choose a practice winter. Your settings are saved: <a href={lessonHref('gas/7.5')}>Lesson 7.5</a> will
        play them. The upper chart adds up each position’s profit month by month, with the assets’ fees spread over the year; the lower one is the gas in the lease
        at the start of each month and, in gray, how much gas its schedule still has to buy or sell at prices not yet fixed:
      </P>

      <Figure
        name="Gas Portfolio Manager"
        onReset={() => {
          resetGasPortfolio();
          setWinter(PM_DEFAULTS.winter);
        }}
      >
        <Segmented label="Practice winter" value={String(winter)} onChange={(v) => setWinter(Number(v))} options={WINTER_OPTIONS} />
        <XYChart
          xDomain={[0, 12]}
          yDomain={ax1.domain}
          yTicks={ax1.ticks}
          xTicks={MONTH_TICKS}
          xFormat={monthTick}
          yFormat={(v) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Math.abs(v) < 1 ? 1 : 0)}M`)}
          yLabel="Profit so far, $ million"
          height={220}
          series={[
            ...held.map((part) => ({ xs: MONTH_TICKS, ys: runs[part], color: PART_COLOR[part], width: 2 })),
            { xs: MONTH_TICKS, ys: totalRun, color: TEXT.ink, width: 3 },
          ]}
          hLines={[{ at: 0, color: '#9a9a9a', width: 1 }]}
          ariaLabel={`Practice winter ${winter + 1}: the portfolio ${madeLost(year.total)} over the year. ${held.map((part) => `The ${PART_NAME[part]} ${madeLost(year[part].total)}.`).join(' ')}`}
        />
        <XYChart
          xDomain={[0, 12]}
          yDomain={[0, expMax * 1.05]}
          yTicks={niceTicks(0, expMax, 3)}
          xTicks={MONTH_TICKS}
          xFormat={monthTick}
          yFormat={(v) => fmt(v, expMax < 3 ? 1 : 0)}
          yLabel="Bcf: gas in the lease, and gas still to price"
          height={140}
          series={[]}
          ariaLabel={
            leaseBcf > 0
              ? `The lease, ${bcf(leaseBcf, 2)}, ${live.storageHedged ? 'hedged' : 'unhedged'}: it holds ${inventory.map((v) => fmt(v, 2)).join(', ')} Bcf at the start of each month, with at most ${bcf(Math.max(...exposure), 2)} of gas still to price.`
              : 'No lease is held.'
          }
        >
          {(x, y) => (
            <g>
              {exposure.map((e, t) =>
                e > 1e-6 ? <rect key={t} x={x(t + 0.15)} y={y(e)} width={x(t + 0.85) - x(t + 0.15)} height={Math.max(0.5, y(0) - y(e))} fill="#b5b5b5" opacity={0.75} /> : null,
              )}
              {leaseBcf > 0 && (
                <path d={inventory.map((v, t) => `${t ? 'L' : 'M'}${x(t)},${y(v)}`).join(' ')} fill="none" stroke={GRAPHIC.gold} strokeWidth={2.5} strokeLinejoin="round" />
              )}
              {leaseBcf <= 0 && (
                <text className="ax ax-m" x={x(6)} y={y(expMax * 0.5)}>
                  No lease held
                </text>
              )}
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            ...held.map((part) => ({ label: PART_NAME[part], color: PART_COLOR[part], kind: 'line' as const })),
            { label: 'all positions', color: TEXT.ink, kind: 'line' as const },
            { label: 'gas still to price', color: '#b5b5b5' },
          ]}
        />
        <PortfolioControls p={p} />
        <Readouts
          items={[
            { label: 'profit for the winter', value: money(year.total), tone: 'green' },
            { label: 'fees paid on April 1', value: money(fees), tone: 'green' },
            { label: 'most cash needed', value: money(year.peakCapital), tone: 'green' },
            { label: 'profit on that cash', value: year.peakCapital > 0 ? pct(ret) : '—' },
          ]}
        />
        <Caption>
          Practice winter {winter + 1}, {fmt(Math.abs(n.drivers.colder[winter]))} degree-days {n.drivers.colder[winter] >= 0 ? 'colder' : 'warmer'} than normal:{' '}
          {partWords.length ? `${partWords.join('; ')}.` : 'the portfolio holds nothing.'}
        </Caption>
      </Figure>

      <P>
        The portfolio starts with a {bcf(pmLeaseBcf(PORTFOLIO_DEFAULTS), 0)} lease, hedged; {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of firm Northline
        capacity; {fmt(PORTFOLIO_DEFAULTS.weatherLots)} lots of weather trades on a forecast of skill {fmt(PORTFOLIO_DEFAULTS.skill, 1)}; and{' '}
        {fmt(PORTFOLIO_DEFAULTS.metroSellMMBtuD)} MMBtu a day of Metro’s basis sold whenever the forecast isn’t colder than normal. On this network, in the first
        practice winter, it {madeLost(n.first.total)}, and the lease {n.first.storage.total >= 0 ? `earned ${leaseShare}` : 'decided it'}:{' '}
        {money(n.first.storage.fee + n.first.storage.total)} on its {money(n.first.storage.fee)} fee. Its line in the upper chart sinks to{' '}
        {money(n.leaseLow)} by the end of {GAS_MONTH_NAMES[n.leaseLowMonth]} while the lease pays its fee and buys gas it won’t sell until winter, then climbs:{' '}
        {GAS_MONTH_NAMES[n.leaseBestMonth]} alone brings in {money(n.leaseBestMonthCash)}. That is why the portfolio needs {money(n.first.peakCapital)} of cash at
        its peak to make {money(Math.abs(n.first.total))} — the fees, the gas bought ahead, and the margin on the futures that lock in its later moves.
      </P>
      <P>
        Now clear the hedge. The gray bars rise: unhedged, the lease’s schedule has as much as {bcf(n.exposureOpen, 1)} of purchases and sales still to make at
        prices nobody has fixed, at the start of {GAS_MONTH_NAMES[n.exposureOpenMonth]}, against {n.exposureHedged < 0.01 ? 'none' : bcf(n.exposureHedged, 2)}{' '}
        hedged. Over the eight winters, the hedged lease alone made money in {lease.wins === 8 ? 'all eight' : `${word(lease.wins)} of them`} and averaged{' '}
        {money(lease.mean)} a winter; unhedged it made money in {word(open.wins)} and averaged {signedMoney(open.mean)}, from {signedMoney(open.worst)} to{' '}
        {signedMoney(open.best)}. Unhedged storage is the calendar spread of <a href={lessonHref('gas/6.2')}>Lesson 6.2</a> with a field attached: a bet on how the
        curve will move. The hedge sells that bet and keeps what redrawing the schedule earns, the value of being able to move gas when the curve changes its mind
        (<a href={lessonHref('gas/5.2')}>Lesson 5.2</a>).
      </P>

      <H2>Two sides of a breakaway</H2>
      <P>
        Firm capacity on Northline earns when Metro breaks away from Calder; selling Metro’s basis earns when it doesn’t. Held alone,{' '}
        {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of Northline capacity earned more than its {money(n.firmFee)} fee in {word(firmWins)} of the eight
        winters, {money(n.firm.years[firmBest].firm.total + n.firmFee)} in winter {firmBest + 1}, when Northline ran full on {fmt(n.drivers.northlineFull[firmBest])}{' '}
        days. The same volume of Metro’s basis, sold every winter month with no forecast watching, averaged {signedMoney(n.metroOpen.mean)} a winter and{' '}
        {madeLost(n.metroOpen.totals[metroWorst])} in winter {metroWorst + 1}. Hold both and they cancel: the portfolio then never makes or loses more than{' '}
        {money(bothSpread)} in a winter, about the fees. They are two sides of the same bet on the same full pipe.
      </P>
      <P>
        {stale ? (
          <>
            On your network that bet is mispriced. The market prices Metro’s basis with the premium it learned in Chapter 6, on a network whose pipes into Metro
            ran full more often than yours do, so firm capacity costs more than it earns — {signedMoney(n.firm.mean)} a winter on average — and selling the basis
            pays. Knowing your own network is an edge the curve doesn’t have.
          </>
        ) : (
          <>
            On this network the market’s premium for Metro’s breakaways is about right: firm capacity averaged {signedMoney(n.firm.mean)} a winter after its fee.
          </>
        )}{' '}
        {guardHelps
          ? `The forecast’s guard improves the sale, to ${signedMoney(n.metroGuarded.mean)} a winter, by standing aside from cold months it can see coming.`
          : `The forecast’s guard ${guardHurts ? 'costs the sale' : 'doesn’t improve the sale'} here — ${signedMoney(n.metroGuarded.mean)} a winter with it, against ${signedMoney(n.metroOpen.mean)} without${
              guardMissed
                ? ` — because on the first of winter ${metroWorst + 1}’s worst month the forecast didn’t see the cold that would fill the pipes${guardHurts ? ', and in other months it turned the desk away from basis that would have paid' : ''}: Lesson 7.3’s lesson, in money.`
                : '.'
            }`}
      </P>
      <P>
        The toll is a different kind of option. April’s value prices each month at its forward price, but the plant runs day by day: through the night when gas is
        cheap enough to beat coal, only in the evening when it isn’t (Lesson 5.3). A plant that runs only when it pays turns the days’ swings into earnings, and on
        this network it earned more than its {money(n.tollFee)} fee in {tollWins === 8 ? 'all eight winters' : `${word(tollWins)} of the eight winters`},{' '}
        {signedMoney(n.toll.mean)} a winter on average. The weather trades are small: at {fmt(PORTFOLIO_DEFAULTS.weatherLots)} lots they averaged{' '}
        {signedMoney(n.weather.mean)} a winter and made money in {word(n.weather.wins)} of eight, but they never needed more than {money(n.weather.peakCapital)} of
        cash{weatherBest ? ', the best return on cash of anything here' : ''}.
      </P>

      <H2>Eight winters</H2>
      <P>
        One winter is one draw of the weather. In the next demonstration the same portfolio runs through all eight practice winters. Each bar is a winter, built up
        from its positions, with losses below the line and the winter’s total marked; under the bars are the facts that decided each winter — how much colder than
        normal it was, how many days Northline ran full, and Ridgeback’s <K c="price">basis</K>. The controls are the first demonstration’s, and they change the same
        saved portfolio:
      </P>

      <Figure name="Gas Portfolio Manager · eight winters" onReset={resetGasPortfolio}>
        <XYChart
          xDomain={[0, PRACTICE_SEEDS.length]}
          yDomain={ax2.domain}
          yTicks={ax2.ticks}
          xTicks={PRACTICE_SEEDS.map((_, i) => i + 0.5)}
          xFormat={(v) => `Winter ${Math.floor(v) + 1}`}
          yFormat={(v) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Math.abs(v) < 1 ? 1 : 0)}M`)}
          yLabel="Profit for the winter, $ million"
          height={240}
          series={[]}
          hLines={[{ at: 0, color: '#9a9a9a', width: 1 }]}
          ariaLabel={`The portfolio over the eight practice winters: ${eight.totals.map((t, i) => `winter ${i + 1} ${madeLost(t)}`).join(', ')}. Average ${money(eight.mean)}, at most ${money(ePeak)} of cash.`}
        >
          {(x, y) => (
            <g>
              {stacks.map((st, i) => {
                let up = 0;
                let down = 0;
                const x0 = x(i + 0.22);
                const w = x(i + 0.78) - x0;
                return (
                  <g key={i}>
                    {st.map(({ part, v }) => {
                      const from = v > 0 ? up : down;
                      const to = from + v;
                      if (v > 0) up = to;
                      else down = to;
                      const top = y(Math.max(from, to));
                      const h = Math.max(0.5, Math.abs(y(from) - y(to)));
                      return <rect key={part} x={x0} y={top} width={w} height={h} fill={PART_COLOR[part]} opacity={0.85} />;
                    })}
                    <line x1={x0 - 4} x2={x0 + w + 4} y1={y(eight.totals[i] / MILLION)} y2={y(eight.totals[i] / MILLION)} stroke={TEXT.ink} strokeWidth={2.5} />
                  </g>
                );
              })}
            </g>
          )}
        </XYChart>
        <WinterRows
          ariaLabel={`Each winter’s degree-days colder than normal: ${n.drivers.colder.map((c) => fmt(c)).join(', ')}; days Northline ran full: ${n.drivers.northlineFull.join(', ')}; Ridgeback’s basis: ${n.drivers.ridgebackBasis.map((b) => basis(b)).join(', ')}.`}
          rows={[
            { label: '°F-days colder', color: TEXT.teal, cells: n.drivers.colder.map((c) => `${c >= 0 ? '+' : '−'}${fmt(Math.abs(c))}`) },
            { label: 'Northline full', color: TEXT.orange, cells: n.drivers.northlineFull.map((d) => `${fmt(d)} days`) },
            { label: 'Ridgeback basis', color: TEXT.green, cells: n.drivers.ridgebackBasis.map((b) => basis(b)) },
          ]}
        />
        <Legend
          items={[
            ...PM_PARTS.filter((part) => pmHolds(live, part)).map((part) => ({ label: PART_NAME[part], color: PART_COLOR[part] })),
            { label: 'the winter’s total', color: TEXT.ink, kind: 'line' as const },
          ]}
        />
        <PortfolioControls p={p} />
        <Readouts
          items={[
            { label: 'average winter', value: money(eight.mean), tone: 'green' },
            { label: 'worst winter', value: money(eight.worst), tone: 'green' },
            { label: 'winters with a profit', value: `${fmt(eight.wins)} of 8` },
            { label: 'most cash needed', value: money(ePeak), tone: 'green' },
            { label: 'average profit on that cash', value: ePeak > 0 ? pct(eight.returnOnCash) : '—' },
          ]}
        />
        <Caption>
          {eight.wins === PRACTICE_SEEDS.length
            ? `The portfolio made money in every practice winter, least in winter ${argmin(eight.totals) + 1}.`
            : `The portfolio lost money in ${word(PRACTICE_SEEDS.length - eight.wins)} of the eight practice winters, most in winter ${argmin(eight.totals) + 1}.`}
        </Caption>
      </Figure>

      <P>
        As it starts, the portfolio averages {money(r.mean)} a winter on this network, makes money in {r.wins === 8 ? 'all eight winters' : `${word(r.wins)} of the eight`},
        and needs at most {money(r.peakCapital)} of cash: {pct(r.returnOnCash)} a year on that cash. Its worst winter is winter {refWorst + 1},{' '}
        {r.totals[refWorst] >= 0 ? `still making ${money(r.totals[refWorst])}` : `losing ${money(-r.totals[refWorst])}`}
        {refWorstParts.length ? `, pulled down by the ${refWorstParts.join(' and the ')}` : ''}. Its positions do well in different winters, which is the point of
        holding several.{' '}
        {refFirmBest === refMetroWorst
          ? `Winter ${refFirmBest + 1} is the one in which Metro’s basis sold cost the most and firm capacity into Metro earned the most, so one paid for much of the other; `
          : `Metro’s basis sold cost the most in winter ${refMetroWorst + 1} and firm capacity into Metro earned the most in winter ${refFirmBest + 1}; `}
        the hedged lease made money in {refLeaseWins === 8 ? 'every one' : `${word(refLeaseWins)} of them`}. Notice, too, that what earns the money is what ties up
        the cash: the lease earns most of the portfolio’s profit and needs most of its cash, and the weather trades earn little but need almost none.
      </P>

      <Challenge
        id="a"
        figure="Gas Portfolio Manager · eight winters"
        question={`Using the eight practice winters, set up a portfolio that makes money in every one of them, averages at least $${fmt(PM_TARGET.mean / 1e6, 1)} million a winter, and never needs more than $${fmt(PM_TARGET.capital / 1e6)} million of cash.`}
        solved={solved}
        status={status}
        success={`Solved: ${money(eight.mean)} a winter on average, ${money(eight.worst)} in the worst, at most ${money(ePeak)} of cash — ${pct(eight.returnOnCash)} a year on it. ${
          mineLeaseAlways ? `The lease of ${bcf(pmLeaseBcf(p), 2)} made money in every winter and does the heavy lifting. ` : ''
        }You tuned this portfolio on the winters you could see, though — the habit Lesson 6.5 warned against — and eight winters are a small sample of what weather can do.`}
      />

      <P>
        A portfolio built this way says what you believe about your network: that its storage is worth more than April’s curve says once the schedule is redrawn
        and hedged, that the market prices its pipes into Metro right or wrong, that a forecast can see two weeks and no further. Every one of those beliefs was
        checked on the winters you could see, and the portfolio in <FigRef to="Gas Portfolio Manager · eight winters">the second demonstration</FigRef> was tuned
        on exactly the winters it was scored on. A portfolio tested that way flatters itself. The honest test is the one of Lesson 6.5: winters no one has seen.{' '}
        <a href={lessonHref('gas/7.5')}>The next lesson</a> plays your saved portfolio on twelve of them, on your network, against desks that each play one of
        Chapter 6’s strategies alone.
      </P>
    </LessonPage>
  );
}
