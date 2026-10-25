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
  monthForecasts,
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
import { GAS_MONTHS, GAS_MONTH_DAYS, GAS_MONTH_NAMES, GAS_MONTH_START } from '../../../model/gas/weather';
import { CORRIDORS, GAS_NODES, PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { CapstoneSoFar, ConfirmReset, isStartingPortfolio } from '../shared/CapstoneUi';
import { resetGasPortfolio, updateGasPortfolio, useGasCapstone } from '../shared/capstone';
import { basis, bcf, gp, money as moneyExact } from '../shared/format';

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
/** The challenge asks for this much more than the starting portfolio's average winter (a fifth), on no more cash. */
export const PM_TARGET_GAIN = 0.2;
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

/**
 * The challenge's targets on a network, rounded to the $10,000 the prose shows: a fifth more than the
 * starting portfolio's average winter, on no more than the cash the starting portfolio needs.
 */
export function pmTarget(s: GasSystem): { mean: number; capital: number } {
  const ref = pmEight(s, PORTFOLIO_DEFAULTS);
  const r = (x: number) => Math.round(x / 1e4) * 1e4;
  return { mean: r(ref.mean + PM_TARGET_GAIN * Math.abs(ref.mean)), capital: r(ref.peakCapital) };
}

/** The challenge: money in every practice winter, at least the target average, and never more than the target cash. */
export function portfolioManagerSolved(s: GasSystem, p: PortfolioSettings): boolean {
  const e = pmEight(s, p);
  const t = pmTarget(s);
  return e.worst > 0 && e.mean >= t.mean - 1e-6 && e.peakCapital <= t.capital + 1e-6;
}

export interface PmDrivers {
  /** Heating degree days above normal over November–March (negative = milder). */
  colder: number[];
  /** Days Northline ran full. */
  northlineFull: number[];
  /** Metro's highest daily price, $/MMBtu: how far its basis broke away. */
  metroMax: number[];
  /** Ridgeback's average basis, $/MMBtu. */
  ridgebackBasis: number[];
}

const driverCache = new Map<string, PmDrivers>();

/** What decided each practice winter on a network: its cold, Northline's full days, Metro's highest price and Ridgeback's basis (cached). */
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
    metroMax: sums.map((x) => x.sum.max.metro),
    ridgebackBasis: sums.map((x) => x.sum.avg.ridgeback - x.sum.avg.calder),
  };
  driverCache.set(key, r);
  return r;
}

/** Positions held alone, at the sizes the portfolio starts with. */
const LEASE_ONLY: PortfolioSettings = { ...PASSIVE, storageShare: PORTFOLIO_DEFAULTS.storageShare, storageHedged: true };
const LEASE_UNHEDGED: PortfolioSettings = { ...LEASE_ONLY, storageHedged: false };
const FIRM_ONLY: PortfolioSettings = { ...PASSIVE, firmLine: 'calder-metro', firmMMBtuD: PORTFOLIO_DEFAULTS.firmMMBtuD };
const EXPRESS_ONLY: PortfolioSettings = { ...FIRM_ONLY, firmLine: 'ridgeback-calder' };
const METRO_GUARDED: PortfolioSettings = { ...PASSIVE, metroSellMMBtuD: PORTFOLIO_DEFAULTS.metroSellMMBtuD, metroSkipColderF: PORTFOLIO_DEFAULTS.metroSkipColderF };
const METRO_OPEN: PortfolioSettings = { ...METRO_GUARDED, metroSkipColderF: null };
const BOTH_SIDES: PortfolioSettings = { ...FIRM_ONLY, metroSellMMBtuD: PORTFOLIO_DEFAULTS.metroSellMMBtuD, metroSkipColderF: null };
const TOLL_ONLY: PortfolioSettings = { ...PASSIVE, toll: true };
const WEATHER_ONLY: PortfolioSettings = { ...PASSIVE, weatherLots: PORTFOLIO_DEFAULTS.weatherLots, skill: PORTFOLIO_DEFAULTS.skill, weatherThresholdF: PORTFOLIO_DEFAULTS.weatherThresholdF };

const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));
const argmin = (xs: number[]) => xs.indexOf(Math.min(...xs));

/** A part's average winter, $. */
export function partMean(e: PmEight, part: PmPart): number {
  return e.years.reduce((a, y) => a + y[part].total, 0) / e.years.length;
}

/** Running totals from monthly profits, starting at zero (13 values). */
export function pmRunning(monthly: number[]): number[] {
  const out = [0];
  monthly.forEach((m) => out.push(out[out.length - 1] + m));
  return out;
}

/** Days the forecast behind the weather trades and the guard covers (as in `monthForecasts`). */
const PM_FORECAST_DAYS = 14;

export interface PmGuardMonth {
  /** The winter month (gas-year index) in which Metro's basis, sold every month, lost the most. */
  month: number;
  /** What the guard's forecast said on its first day: how much colder than normal its two weeks looked, °F (negative = warmer). */
  signal: number;
  /** The month's coldest day (0 = the 1st), its mean temperature, °F, and whether it fell inside the forecast's two weeks. */
  coldDay: number;
  coldTemp: number;
  inWindow: boolean;
}

/** In a practice winter, the month Metro's basis sold cost the most, and what the guard's forecast saw of it. */
export function pmGuardMonth(s: GasSystem, winter: number): PmGuardMonth {
  const seed = PRACTICE_SEEDS[winter];
  const y = systemYear(s, seed);
  const sold = portfolioYear(s, seed, METRO_OPEN).metro.monthly;
  const month = [8, 9, 10].reduce((b, m) => (sold[m] < sold[b] ? m : b), 8);
  const temps = y.weather.temp.slice(GAS_MONTH_START[month], GAS_MONTH_START[month] + GAS_MONTH_DAYS[month]);
  const coldDay = argmin(temps);
  return { month, signal: monthForecasts(y, METRO_GUARDED.skill)[month], coldDay, coldTemp: temps[coldDay], inWindow: coldDay < PM_FORECAST_DAYS };
}

/** Of the parts a portfolio holds, the one that fell furthest below its own median winter in a given winter: what made that winter what it was. */
export function pmShortfall(e: PmEight, p: PortfolioSettings, winter: number): PmPart | null {
  const held = PM_PARTS.filter((part) => pmHolds(p, part));
  if (!held.length) return null;
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const gap = (part: PmPart) => e.years[winter][part].total - median(e.years.map((y) => y[part].total));
  return held.reduce((b, part) => (gap(part) < gap(b) ? part : b), held[0]);
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
  /** The same firm volume on Ridgeback Express instead of Northline, and its fee. */
  express: PmEight;
  expressFee: number;
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
  const express = pmEight(s, EXPRESS_ONLY);
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
    express,
    expressFee: express.years[0].firm.fee,
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

/** A day's price: "$100", "$15", "$5.92". */
function peakPrice(x: number): string {
  return gp(x, Math.abs(x - Math.round(x)) < 0.005 ? 0 : 2);
}

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
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

const setPortfolio = (patch: Partial<PortfolioSettings>) => updateGasPortfolio((q) => ({ ...q, ...patch }));

/** The lease's controls: its size and its hedge (the first demonstration). Every change is saved for Lesson 7.5. */
function LeaseControls({ p }: { p: PortfolioSettings }) {
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
        onChange={(v) => setPortfolio({ storageShare: pmShare(v) })}
        display={lease > 0 ? bcf(lease, 2) : 'none'}
      />
      <Checkbox label="Hedge the lease’s schedule with futures" checked={p.storageHedged} onChange={(v) => setPortfolio({ storageHedged: v })} />
    </div>
  );
}

/** Every position's controls (the second demonstration). Every change is saved for Lesson 7.5. */
function PortfolioControls({ p }: { p: PortfolioSettings }) {
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
        onChange={(v) => setPortfolio({ storageShare: pmShare(v) })}
        display={lease > 0 ? bcf(lease, 2) : 'none'}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 28 }}>
        <Checkbox label="Hedge the lease" checked={p.storageHedged} onChange={(v) => setPortfolio({ storageHedged: v })} />
        <Checkbox label="Toll Lakeside for the year" checked={p.toll} onChange={(v) => setPortfolio({ toll: v })} />
      </div>
      <Segmented<FirmLine>
        label="Line for firm capacity"
        value={p.firmLine}
        onChange={(v) => setPortfolio({ firmLine: v })}
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
        onChange={(v) => setPortfolio({ firmMMBtuD: v })}
        display={p.firmMMBtuD > 0 ? `${fmt(p.firmMMBtuD)} MMBtu/d` : 'none'}
      />
      <Slider
        label="Metro basis sold"
        tone="green"
        value={p.metroSellMMBtuD}
        min={0}
        max={PM_VOLUME_MAX}
        step={PM_VOLUME_STEP}
        onChange={(v) => setPortfolio({ metroSellMMBtuD: v })}
        display={p.metroSellMMBtuD > 0 ? `${fmt(p.metroSellMMBtuD)} MMBtu/d` : 'none'}
      />
      <Segmented<GuardKey>
        label="When to stand aside from selling Metro’s basis"
        value={guardKey(p.metroSkipColderF)}
        onChange={(v) => setPortfolio({ metroSkipColderF: v === 'never' ? null : Number(v) })}
        options={[
          { value: 'never', label: 'Sell Metro’s basis always' },
          { value: '0', label: 'not if colder' },
          { value: '2', label: 'not if 2 °F colder' },
          { value: '4', label: 'not if 4 °F colder' },
        ]}
      />
      <Slider
        label="Weather trades"
        value={p.weatherLots}
        min={0}
        max={50}
        step={5}
        onChange={(v) => setPortfolio({ weatherLots: v })}
        display={p.weatherLots > 0 ? `${fmt(p.weatherLots)} lots` : 'none'}
      />
      <Slider label="Weather forecast skill" tone="teal" value={p.skill} min={0} max={1} step={0.05} onChange={(v) => setPortfolio({ skill: v })} display={fmt(p.skill, 2)} />
    </div>
  );
}

/** The footer's Reset for the portfolio: it asks first, and leaves the network alone. */
function PortfolioReset() {
  return (
    <ConfirmReset
      label="Reset portfolio"
      prompt="Put back the starting portfolio? This changes only Lesson 7.4’s positions; your network from 7.1 is kept."
      onConfirm={resetGasPortfolio}
    />
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
  const tollWins = n.toll.years.filter((y) => y.toll.total > 0).length;
  const guardHurts = n.metroGuarded.mean < n.metroOpen.mean - 10_000;
  const guardMissed = n.metroOpen.totals[metroWorst] < 0 && n.metroGuarded.totals[metroWorst] <= n.metroOpen.totals[metroWorst] + 1000;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gm = useMemo(() => (guardMissed ? pmGuardMonth(system, metroWorst) : null), [sysKey, guardMissed, metroWorst]);
  const refWorstPart = pmShortfall(r, PORTFOLIO_DEFAULTS, refWorst);
  const expressHeld = n.expressFee > 50_000;
  const worstPartText = (() => {
    if (!refWorstPart) return '';
    const got = r.years[refWorst][refWorstPart].total;
    const avg = partMean(r, refWorstPart);
    const did = got >= 0 ? `made ${got < avg ? 'only ' : ''}${money(got)}` : `lost ${money(-got)}`;
    return `: the ${PART_NAME[refWorstPart]} ${did} there, against ${avg >= 0 ? money(avg) : signedMoney(avg)} in an average winter`;
  })();
  const weatherBest = n.weather.returnOnCash > Math.max(n.lease.returnOnCash, n.toll.returnOnCash, n.firm.returnOnCash, n.metroGuarded.returnOnCash);
  const leaseShare = n.first.storage.total >= n.first.total ? 'all of it' : n.first.storage.total >= n.first.total / 2 ? 'most of it' : 'part of it';
  const refFirmBest = argmax(r.years.map((y) => y.firm.total));
  const refMetroWorst = argmin(r.years.map((y) => y.metro.total));

  const netLink = (
    <a href={lessonHref('gas/7.1')}>{net.asBuilt ? 'the network as built' : 'your network from Lesson 7.1'}</a>
  );

  // ---- The challenge: a fifth more than the starting portfolio, on no more cash.
  const target = pmTarget(system);
  const missing = [
    eight.mean < target.mean - 1e-6 ? `${money(target.mean - eight.mean)} short of the average` : '',
    eight.peakCapital > target.capital + 1e-6 ? `${money(eight.peakCapital - target.capital)} over the cash` : '',
    eight.worst <= 0 ? `a loss in winter ${argmin(eight.totals) + 1}` : '',
  ].filter(Boolean);
  const challengeStatus = `Now: ${money(eight.mean)} a winter on average, money in ${eight.wins === 8 ? 'all eight' : `${word(eight.wins)} of the eight`}, at most ${money(ePeak)} of cash${missing.length ? ` — ${missing.join(', ')}` : ''}.`;
  // Each position held alone at its starting size: what it earned a year for each dollar of cash it needed.
  const perCash = (
    [
      ['the weather trades', n.weather],
      ['the toll', n.toll],
      ['the hedged lease', n.lease],
      ['firm Northline capacity', n.firm],
      ['the guarded sale of Metro’s basis', n.metroGuarded],
    ] as Array<[string, PmEight]>
  )
    .map(([name, e]) => ({ name, roc: e.returnOnCash }))
    .sort((a, b) => b.roc - a.roc);
  const starting = isStartingPortfolio(p);
  const differs = starting ? '' : ' Your portfolio differs from the starting one the text describes; Reset portfolio puts it back.';

  return (
    <LessonPage id="gas/7.4">
      <CapstoneSoFar capstone={cap} />
      <P>
        <a href={lessonHref('gas/7.3')}>The previous lesson</a> ended with forecasts that are right on average and wrong, sometimes badly, in the months that matter
        most. A trader can live with forecasts like that only by holding positions whose misses can be survived. This lesson puts such positions together into a{' '}
        <K c="price">portfolio</K> on your network — the pieces Chapter 6 tested one at a time, now held side by side — and runs it through the eight practice
        winters of <a href={lessonHref('gas/7.2')}>Lesson 7.2</a>, on {netLink}.
      </P>
      <P>
        There are five kinds of position, each from a lesson you’ve met. A lease of space in Salt Flat, run like the storage desk of{' '}
        <a href={lessonHref('gas/6.4')}>Lesson 6.4</a>: on the first of each month its schedule is redrawn on that day’s curve from the gas it holds, and the
        month’s move is bought or sold at the month’s average price, with every later move locked in with futures if you hedge it.{' '}
        <K tone="orange">Firm capacity</K> on Northline or Ridgeback Express, used on every day the price at the far end beats the near end by more than the trip
        (<a href={lessonHref('gas/4.3')}>Lesson 4.3</a>). A toll on Lakeside, the right to run the plant for the year and keep its spark spread (
        <a href={lessonHref('gas/5.3')}>Lesson 5.3</a>). The prompt month’s gas, bought or sold on its first day from October to April when the two-week forecast
        leans cold or warm (<a href={lessonHref('gas/6.1')}>Lesson 6.1</a>). And Metro’s winter <K c="price">basis</K>, sold on the first of December, January and
        February unless the forecast warns of cold (<a href={lessonHref('gas/6.3')}>Lesson 6.3</a>).
      </P>
      <P>
        Each physical asset is sold to you at the price April 1’s curve puts on it, its intrinsic value: on this network, {money(n.first.storage.fee)} for a{' '}
        {bcf(pmLeaseBcf(PORTFOLIO_DEFAULTS), 0)} lease, {money(n.firmFee)} for {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of firm Northline capacity, and{' '}
        {money(n.tollFee)} for the toll. That price pays for April’s schedule — the moves, flows and running hours the curve itself would reward — but not for the
        right to change it, the extrinsic value of <a href={lessonHref('gas/5.2')}>Lesson 5.2</a>, which comes with the asset for nothing. So an asset pays its
        holder what the year adds to the curve’s value: what redrawing a schedule earns, the days a pipe or a plant is worth more than its month’s forward price
        said, or something about your network the market has missed. Trades pay Chapter 6’s costs and post its margin (<a href={lessonHref('gas/6.5')}>Lesson 6.5</a>),
        and as everywhere in this course, the prices are simulated.
      </P>
      <P>
        In the next demonstration, choose a practice winter and size the lease. The upper chart adds up each position’s profit month by month, with the assets’
        fees spread over the year; the lower one is the gas in the lease at the start of each month and, in gray, how much gas its schedule still has to buy or
        sell at prices not yet fixed. The other positions are set in the second demonstration, and everything you set is saved for{' '}
        <a href={lessonHref('gas/7.5')}>Lesson 7.5</a>:
      </P>

      <Figure name="Gas Portfolio Manager" actions={<PortfolioReset />}>
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
        <LeaseControls p={p} />
        <Readouts
          items={[
            { label: 'profit for the winter', value: money(year.total), tone: 'green' },
            { label: 'most cash needed', value: money(year.peakCapital), tone: 'green' },
            { label: 'profit on that cash', value: year.peakCapital > 0 ? pct(ret) : '—' },
          ]}
        />
        <Caption>
          Practice winter {winter + 1}, {fmt(Math.abs(n.drivers.colder[winter]))} heating degree days {n.drivers.colder[winter] >= 0 ? 'colder' : 'warmer'} than
          normal: {partWords.length ? `${partWords.join('; ')}.` : 'the portfolio holds nothing.'}
          {differs}
        </Caption>
      </Figure>

      <P>
        The portfolio starts with a {bcf(pmLeaseBcf(PORTFOLIO_DEFAULTS), 0)} lease, hedged; {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of firm Northline
        capacity; {fmt(PORTFOLIO_DEFAULTS.weatherLots)} lots of weather trades on a forecast of skill {fmt(PORTFOLIO_DEFAULTS.skill, 1)}; and{' '}
        {fmt(PORTFOLIO_DEFAULTS.metroSellMMBtuD)} MMBtu a day of Metro’s basis sold whenever the forecast isn’t colder than normal. On this network, in the first
        practice winter, it {madeLost(n.first.total)}, and the lease {n.first.storage.total >= 0 ? `earned ${leaseShare}` : 'decided it'}:{' '}
        {money(n.first.storage.fee + n.first.storage.total)} against its {money(n.first.storage.fee)} fee,{' '}
        {n.first.storage.total >= 0 ? money(n.first.storage.total) : `a loss of ${money(-n.first.storage.total)}`} after it. Its line in the upper chart sinks to{' '}
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

      <H2>Eight winters</H2>
      <P>
        One winter is one draw of the weather. In the next demonstration the same portfolio runs through all eight practice winters. Each bar is a winter, built up
        from its positions, with losses below the line and the winter’s total marked; under the bars are the facts that decided each winter — how much colder than
        normal it was, in heating degree days (HDD); Metro’s highest price, the measure of how far its basis broke away; and Ridgeback’s <K c="price">basis</K>.
        Every position can be set here:
      </P>

      <Figure name="Gas Portfolio Manager · eight winters" actions={<PortfolioReset />}>
        <XYChart
          xDomain={[0, PRACTICE_SEEDS.length]}
          yDomain={ax2.domain}
          yTicks={ax2.ticks}
          xTicks={PRACTICE_SEEDS.map((_, i) => i + 0.5)}
          xFormat={(v) => `Winter ${Math.floor(v) + 1}`}
          yFormat={(v) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Math.abs(v) < 1 ? 1 : 0)}M`)}
          yLabel="Profit for the winter, $ million"
          height={220}
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
          ariaLabel={`Each winter’s heating degree days colder than normal: ${n.drivers.colder.map((c) => fmt(c)).join(', ')}; Metro’s highest price: ${n.drivers.metroMax.map(peakPrice).join(', ')}; Ridgeback’s basis: ${n.drivers.ridgebackBasis.map((b) => basis(b)).join(', ')}.`}
          rows={[
            { label: 'HDD vs normal', color: TEXT.teal, cells: n.drivers.colder.map((c) => `${c >= 0 ? '+' : '−'}${fmt(Math.abs(c))}`) },
            { label: 'Metro’s highest', color: TEXT.orange, cells: n.drivers.metroMax.map(peakPrice) },
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
        {differs ? <Caption>{differs.trim()}</Caption> : null}
      </Figure>

      <H2>Two sides of a breakaway</H2>
      <P>
        Firm capacity on Northline earns when Metro breaks away from Calder; selling Metro’s basis earns when it doesn’t. Held alone,{' '}
        {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day of Northline capacity earned more than its {money(n.firmFee)} fee in {word(firmWins)} of the eight
        winters, {money(n.firm.years[firmBest].firm.total + n.firmFee)} in winter {firmBest + 1}, the winter Metro’s price reached{' '}
        {peakPrice(n.drivers.metroMax[firmBest])}. The same volume of Metro’s basis, sold every winter month with no forecast watching, averaged{' '}
        {signedMoney(n.metroOpen.mean)} a winter and {madeLost(n.metroOpen.totals[metroWorst])} in winter {metroWorst + 1}. Set the two to the same volume, selling
        always, and their bars cancel: held together they never make or lose more than {money(bothSpread)} in a winter, about the fees. They are two sides of the
        same bet on the same full pipe.
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
              guardMissed && gm
                ? ` — because on ${GAS_MONTH_NAMES[gm.month]} 1 of winter ${metroWorst + 1}, the first of its worst month, the forecast read ${
                    gm.signal < -0.005 ? `${fmt(-gm.signal, 2)} °F warmer than normal` : gm.signal > 0.005 ? `only ${fmt(gm.signal, 2)} °F colder than normal` : 'normal'
                  }, ${gm.inWindow ? 'though' : 'and'} the cold that filled the pipes, ${fmt(gm.coldTemp, 1)} °F on ${GAS_MONTH_NAMES[gm.month]} ${gm.coldDay + 1}, ${
                    gm.inWindow ? 'fell inside its two weeks' : 'came after its two weeks'
                  }${guardHurts ? '; in other months it turned the desk away from basis that would have paid' : ''}. That is Lesson 7.3’s lesson in money: ${
                    gm.inWindow ? 'a forecast’s skill fades inside its window.' : 'a forecast sees two weeks at most.'
                  }`
                : '.'
            }`}
      </P>
      <P>
        Switch the firm capacity to Ridgeback Express and it becomes the nearest thing here to Chapter 6’s biggest earner, the trade on Ridgeback’s basis.{' '}
        {expressHeld ? (
          <>
            {Math.abs(n.express.mean) < 0.1 * n.expressFee ? 'It earns little' : 'It costs a great deal'}, because this market isn’t Chapter 6’s. That one priced
            next year as if nothing would change (<a href={lessonHref('gas/6.5')}>Lesson 6.5</a>); this one draws its curve on your network in Year 9, so a
            stranded basin is already in April’s prices. The same {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day on Express costs {money(n.expressFee)}, and
            after that fee it averaged {signedMoney(n.express.mean)} a winter.
          </>
        ) : (
          <>
            On your network it has nothing to trade: Ridgeback’s gas gets out, its basis sits at the cost of the trip, and the same{' '}
            {fmt(PORTFOLIO_DEFAULTS.firmMMBtuD)} MMBtu a day on Express costs {money(n.expressFee)} and averages {signedMoney(n.express.mean)} a winter.
          </>
        )}
      </P>
      <P>
        The toll is a different kind of option. April’s value prices each month at its forward price, but the plant runs day by day: through the night when gas is
        cheap enough to beat coal, only in the evening when it isn’t (Lesson 5.3). A plant that runs only when it pays turns the days’ swings into earnings, and on
        this network it earned more than its {money(n.tollFee)} fee in {tollWins === 8 ? 'all eight winters' : `${word(tollWins)} of the eight winters`},{' '}
        {signedMoney(n.toll.mean)} a winter on average. The weather trades are small: at {fmt(PORTFOLIO_DEFAULTS.weatherLots)} lots they averaged{' '}
        {signedMoney(n.weather.mean)} a winter and made money in {word(n.weather.wins)} of eight, but they never needed more than {money(n.weather.peakCapital)} of
        cash{weatherBest ? ', the best return on cash of anything here' : ''}.
      </P>
      <P>
        As it starts, the portfolio averages {money(r.mean)} a winter on this network, makes money in {r.wins === 8 ? 'all eight winters' : `${word(r.wins)} of the eight`},
        and needs at most {money(r.peakCapital)} of cash: {pct(r.returnOnCash)} a year on that cash. Its worst winter is winter {refWorst + 1},{' '}
        {r.totals[refWorst] >= 0 ? `still making ${money(r.totals[refWorst])}` : `losing ${money(-r.totals[refWorst])}`}
        {worstPartText}. Its positions do well in different winters, which is the point of holding several:{' '}
        {refFirmBest === refMetroWorst
          ? `winter ${refFirmBest + 1} is the one in which Metro’s basis sold cost the most and firm capacity into Metro earned the most, so one paid for much of the other.`
          : `Metro’s basis sold cost the most in winter ${refMetroWorst + 1} and firm capacity into Metro earned the most in winter ${refFirmBest + 1}.`}{' '}
        But what earns the money is also what ties up the cash. Held alone at its starting size, each position earned, a year, for each dollar of cash it needed at
        its peak: {listWords(perCash.map((x) => `${x.name} ${pct(x.roc)}`))}.
      </P>

      <Challenge
        id="a"
        figure="Gas Portfolio Manager · eight winters"
        question={`Predict first which positions earn the most for the cash they tie up. Then, needing no more than ${money(target.capital)} of cash — what the starting portfolio needs on this network — set up a portfolio that makes money in every practice winter and averages at least ${money(target.mean)}, a fifth more than the start.`}
        solved={solved}
        status={challengeStatus}
        success={`Solved: ${money(eight.mean)} a winter on average with at most ${money(ePeak)} of cash, ${pct(eight.returnOnCash)} a year on it against the starting portfolio’s ${pct(r.returnOnCash)}. With the cash fixed, the size of each position is the choice: cash moved from what earns little for it to what earns more makes the same balance sheet go further. You tuned this portfolio on the winters you could see, though — the habit Lesson 6.5 warned against — and eight winters are a small sample of what weather can do.`}
      />

      <P>
        A portfolio built this way says what you believe about your network: that its storage is worth more than April’s curve says once the schedule is redrawn
        and hedged, that the market prices its pipes into Metro right or wrong, that a forecast’s two weeks are worth trading on. Every one of those beliefs was
        checked on the winters you could see, and the portfolio in <FigRef to="Gas Portfolio Manager · eight winters">the second demonstration</FigRef> was tuned
        on exactly the winters it was scored on. The honest test is the one of Lesson 6.5: winters no one has seen. <a href={lessonHref('gas/7.5')}>The next lesson</a>{' '}
        plays your saved portfolio on twelve of them, on your network, against desks that each play one of Chapter 6’s strategies alone.
      </P>
    </LessonPage>
  );
}
