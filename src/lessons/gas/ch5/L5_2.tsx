import type { KeyboardEvent } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
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
import { useProgress } from '../../../course/progress';
import { forwardCurve, normalPlan, planInventory, simulateYear, type ForwardCurve, type StorageState } from '../../../engines/gas/market';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { dailyFromMonthly, optimizeStorage, type StorageOptimum, type StorageSpec } from '../../../engines/gas/storage';
import { GAS_MONTHS, GAS_MONTH_DAYS, GAS_MONTH_NAMES, GAS_MONTH_START, GAS_YEAR_DAYS, monthOfDay, weatherYear } from '../../../model/gas/weather';
import { STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// Two leases: 1 Bcf of space in each field, with fixed daily rights in proportion to the field's
// peak rates (no ratchets), so the arithmetic stays visible.

export type LeaseId = 'salt' | 'reservoir';
export const LEASE_IDS: LeaseId[] = ['salt', 'reservoir'];
const LEASE_FIELD: Record<LeaseId, 'saltflat' | 'hollowcreek'> = { salt: 'saltflat', reservoir: 'hollowcreek' };
const LEASE_LABEL: Record<LeaseId, string> = { salt: 'Salt Flat lease', reservoir: 'Hollow Creek lease' };
/**
 * Inventory grid for the dynamic program: chosen so each lease's daily rights are whole numbers of
 * grid steps (Salt Flat 4 in and 8 out of 200; Hollow Creek 4 in and 5 out of 600), which makes the
 * optimum exact for flat rights.
 */
export const LEASE_GRID: Record<LeaseId, number> = { salt: 200, reservoir: 600 };

/** 1 Bcf of a field's space with fixed daily rights scaled from the field's peak rates. */
export function leaseSpec(id: LeaseId): StorageSpec {
  const s = STORAGE_SPECS[LEASE_FIELD[id]];
  const k = 1 / s.workingBcf;
  // Very large headroom turns the field's ratchets off: the rights are flat at the peak rates.
  return { ...s, workingBcf: 1, baseBcf: s.baseBcf * k, maxInjectBcfd: s.maxInjectBcfd * k, maxWithdrawBcfd: s.maxWithdrawBcfd * k, wdHeadroom: 1e6, injHeadroom: 1e6 };
}

/** Days to fill a lease from empty, and to empty it from full, at its daily rights. */
export function leaseDays(id: LeaseId): { fill: number; empty: number } {
  const s = leaseSpec(id);
  return { fill: s.workingBcf / s.maxInjectBcfd, empty: s.workingBcf / s.maxWithdrawBcfd };
}

const MMBTU_PER_BCF = MMBTU_PER_MCF * 1e6;

// ---------------------------------------------------------------------------
// The forward curve, drawn on March 1 for the coming April–March, from a level of regional storage.

/** March 1: the curve covers the coming gas year, April to March. */
export const CURVE_DAY = GAS_MONTH_START[11];
/** Regional storage on March 1, as a percentage of what the seasonal plan expects then. */
export const LEVEL_MIN = 60;
export const LEVEL_MAX = 140;
export const LEVEL_STEP = 10;
/** Fees for putting gas in and taking it out, each way, $/MMBtu (the market model's default is $0.05). */
export const LEASE_FEE = 0.05;
export const FEE_MAX = 0.5;
export const FEE_STEP = 0.05;
export const LEASE_DEFAULTS = { lease: 'salt' as LeaseId, level: 100, fee: LEASE_FEE };
/** The first challenge's target: the Salt Flat lease's intrinsic value, $ a year. */
export const LEVEL_TARGET = 2.2e6;

/** Working gas in each field on March 1 at `level`% of plan (never above a field's capacity). */
export function storageOnMarch1(level: number): StorageState {
  const plan = normalPlan();
  return {
    saltflat: Math.min(STORAGE_SPECS.saltflat.workingBcf, (planInventory(plan, 'saltflat', CURVE_DAY) * level) / 100),
    hollowcreek: Math.min(STORAGE_SPECS.hollowcreek.workingBcf, (planInventory(plan, 'hollowcreek', CURVE_DAY) * level) / 100),
  };
}

const curveCache = new Map<number, ForwardCurve>();
/** The forward curve (24 simulated weather years) drawn on March 1 with regional storage at `level`% of plan; cached. */
export function leaseCurve(level: number): ForwardCurve {
  let c = curveCache.get(level);
  if (!c) {
    c = forwardCurve({ startDay: CURVE_DAY, startStorage: storageOnMarch1(level) });
    curveCache.set(level, c);
  }
  return c;
}

/** The curve laid out day by day, April 1 to March 31 (each month's price on each of its days). */
export function curveDaily(level: number): number[] {
  return dailyFromMonthly(leaseCurve(level).calder, GAS_MONTH_DAYS);
}

const costsOf = (fee: number) => ({ injectCost: fee, withdrawCost: fee });

const intrinsicCache = new Map<string, StorageOptimum>();
/** A lease's intrinsic value: the best schedule against the curve, which forwards can lock in today. */
export function leaseIntrinsic(id: LeaseId, level = 100, fee = LEASE_FEE): StorageOptimum {
  const key = `${id}|${level}|${fee}`;
  let r = intrinsicCache.get(key);
  if (!r) {
    r = optimizeStorage(curveDaily(level), leaseSpec(id), { grid: LEASE_GRID[id], costs: costsOf(fee) });
    intrinsicCache.set(key, r);
  }
  return r;
}

export interface LeaseTrades {
  /** Bcf bought (injected) and sold (withdrawn). */
  bought: number;
  sold: number;
  /** Volume-weighted average purchase and sale prices, $/MMBtu. */
  buyAvg: number;
  sellAvg: number;
}

/** Summarizes a schedule's purchases and sales against a daily price path. */
export function leaseTrades(flow: number[], prices: number[]): LeaseTrades {
  let bought = 0;
  let sold = 0;
  let paid = 0;
  let got = 0;
  flow.forEach((f, t) => {
    if (f > 0) {
      bought += f;
      paid += f * prices[t];
    } else if (f < 0) {
      sold -= f;
      got -= f * prices[t];
    }
  });
  return { bought, sold, buyAvg: bought > 0 ? paid / bought : 0, sellAvg: sold > 0 ? got / sold : 0 };
}

/** Cash a fixed schedule earns against a price path, after fees, $. */
export function scheduleValue(flow: number[], prices: number[], fee = LEASE_FEE): number {
  return flow.reduce((a, f, t) => a + (f > 0 ? -f * MMBTU_PER_BCF * (prices[t] + fee) : -f * MMBTU_PER_BCF * (prices[t] - fee)), 0);
}

// ---------------------------------------------------------------------------
// The same 24 weather years the curve averages over, day by day: what actually happened.

export const LEASE_YEARS = 24;
let pathCache: number[][] | null = null;
/** Daily Calder prices, April to March, in each of the 24 simulated years behind the curve (storage as planned). */
export function leaseSpotPaths(): number[][] {
  if (!pathCache) {
    const lead = GAS_YEAR_DAYS - CURVE_DAY;
    const st = storageOnMarch1(100);
    pathCache = Array.from({ length: LEASE_YEARS }, (_, s) =>
      simulateYear({ weather: weatherYear(1000 + s), startDay: CURVE_DAY, days: lead + GAS_YEAR_DAYS, startStorage: st })
        .slice(lead)
        .map((d) => d.price.calder),
    );
  }
  return pathCache;
}

const perfectCache = new Map<string, StorageOptimum>();
/** The most a lease could have earned in year `year` (1–24) with perfect foresight of its prices. */
export function leasePerfect(id: LeaseId, year: number): StorageOptimum {
  const key = `${id}|${year}`;
  let r = perfectCache.get(key);
  if (!r) {
    r = optimizeStorage(leaseSpotPaths()[year - 1], leaseSpec(id), { grid: LEASE_GRID[id], costs: costsOf(LEASE_FEE) });
    perfectCache.set(key, r);
  }
  return r;
}

/** Perfect-foresight values for all 24 years, $. */
export function leasePerfectValues(id: LeaseId): number[] {
  return Array.from({ length: LEASE_YEARS }, (_, i) => leasePerfect(id, i + 1).value);
}

/** The intrinsic plan (storage as planned, default fee) carried out without a hedge in each year, $. */
export function leaseUnhedged(id: LeaseId): number[] {
  const plan = leaseIntrinsic(id).flow;
  return leaseSpotPaths().map((p) => scheduleValue(plan, p));
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

// ---------------------------------------------------------------------------
// Challenges.

/** The first challenge: the Salt Flat lease, default fee, at the lowest storage level where it's worth at least $2.2 million. */
export function levelChallengeSolved(s: { lease: LeaseId; level: number; fee: number }): boolean {
  if (s.lease !== 'salt' || Math.abs(s.fee - LEASE_FEE) > 1e-9) return false;
  if (leaseIntrinsic('salt', s.level).value < LEVEL_TARGET) return false;
  return s.level - LEVEL_STEP < LEVEL_MIN || leaseIntrinsic('salt', s.level - LEVEL_STEP).value < LEVEL_TARGET;
}

/**
 * The spread between the average prices received and paid that the first challenge's target takes:
 * the Salt Flat lease buys and sells its whole 1 Bcf, so its value is MMBtu per Bcf × (spread − both
 * fees), $/MMBtu.
 */
export const LEVEL_SPREAD_NEEDED = LEVEL_TARGET / MMBTU_PER_BCF + 2 * LEASE_FEE;

/** The Salt Flat lease's spread at the standard fee: average price received less average price paid, $/MMBtu. */
export function levelSpread(level: number): number {
  const t = leaseTrades(leaseIntrinsic('salt', level).flow, curveDaily(level));
  return t.sellAvg - t.buyAvg;
}

/**
 * While the first challenge is unsolved, the figure keeps the Salt Flat lease's value to itself above
 * plan at the standard fee, so the reader works it out from the prices paid and received.
 */
export function levelValueHidden(s: { lease: LeaseId; level: number; fee: number }, solved: boolean): boolean {
  return !solved && s.lease === 'salt' && Math.abs(s.fee - LEASE_FEE) < 1e-9 && s.level > 100;
}

/** The second challenge: a year in which the Salt Flat lease, even with perfect foresight, earns less than its intrinsic value. */
export function hedgeYearSolved(s: { lease: LeaseId; year: number }): boolean {
  return s.lease === 'salt' && leasePerfect('salt', s.year).value < leaseIntrinsic('salt').value;
}

export const SCENARIO_DEFAULTS = { lease: 'salt' as LeaseId, year: 1 };

// ---------------------------------------------------------------------------
// Charts.

const MONTH_TICKS = GAS_MONTH_START;
const monthLabel = (d: number) => GAS_MONTHS[monthOfDay(d)];
const DAYS = Array.from({ length: GAS_YEAR_DAYS }, (_, d) => d + 1);
const INJECT_COLOR = GRAPHIC.blue;
const SELL_COLOR = GRAPHIC.red;

/** x and y of a monthly curve drawn as steps across the year. */
function curveSteps(monthly: number[]) {
  return { xs: [...GAS_MONTH_START, GAS_YEAR_DAYS], ys: [...monthly, monthly[11]] };
}

/** Month bands for buying and selling months of a schedule. */
function activityBands(flow: number[]) {
  const bands: Array<{ from: number; to: number; color: string }> = [];
  GAS_MONTH_START.forEach((s, m) => {
    const net = flow.slice(s, s + GAS_MONTH_DAYS[m]).reduce((a, b) => a + b, 0);
    if (net > 1e-6) bands.push({ from: s, to: s + GAS_MONTH_DAYS[m], color: tint(INJECT_COLOR, 0.14) });
    else if (net < -1e-6) bands.push({ from: s, to: s + GAS_MONTH_DAYS[m], color: tint(SELL_COLOR, 0.14) });
  });
  return bands;
}

const BX = scale(0, LEASE_YEARS, 64, 616);

function YearBars({ id, selected, intrinsic, onSelect }: { id: LeaseId; selected: number; intrinsic: number; onSelect: (n: number) => void }) {
  const values = leasePerfectValues(id);
  const top = Math.ceil(Math.max(...values, intrinsic) / 1e6) || 1;
  const y = scale(0, top * 1e6, 104, 22);
  const slot = BX(1) - BX(0);
  const key = (n: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(n);
    }
  };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 140"
      role="group"
      aria-label={`What the ${LEASE_LABEL[id]} could have earned with perfect foresight in each of ${LEASE_YEARS} simulated years, from ${money(Math.min(...values))} to ${money(Math.max(...values))}, ${money(mean(values))} on average, against an intrinsic value of ${money(intrinsic)}. Year ${selected} is selected.`}
    >
      <text className="ax" x={64} y={12}>
        With perfect foresight, each year, $ million
      </text>
      <GridY y={y} ticks={Array.from({ length: top + 1 }, (_, i) => i * 1e6)} x0={64} x1={616} format={(v) => fmt(v / 1e6)} baseline={0} />
      {values.map((v, i) => {
        const on = i + 1 === selected;
        const h = Math.max(1.5, y(0) - y(v));
        return (
          <g key={i} role="button" tabIndex={0} aria-label={`Year ${i + 1}: ${money(v)}`} aria-pressed={on} onClick={() => onSelect(i + 1)} onKeyDown={key(i + 1)} style={{ cursor: 'pointer' }}>
            <rect x={BX(i)} y={22} width={slot} height={y(0) - 22} fill="transparent" />
            <rect x={BX(i) + slot * 0.18} y={y(0) - h} width={slot * 0.64} height={h} fill={on ? GRAPHIC.gold : tint(GRAPHIC.gold, v < intrinsic ? 0.35 : 0.6)} stroke={on ? '#333' : 'none'} strokeWidth={1} />
            {(i === 0 || (i + 1) % 6 === 0) && (
              <text className="ax ax-m" x={BX(i) + slot / 2} y={124} style={on ? { fill: '#111', fontWeight: 600 } : undefined}>
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
      <line x1={64} x2={616} y1={y(intrinsic)} y2={y(intrinsic)} stroke={GRAPHIC.green} strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />
      <text x={616} y={y(intrinsic) - 5} textAnchor="end" style={{ fontSize: 12, fill: TEXT.green, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }} pointerEvents="none">
        intrinsic {money(intrinsic)}
      </text>
      <text className="ax ax-e" x={616} y={138}>
        simulated year
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose (storage as planned, default fee, unless stated).

const PLAN_MARCH1 = storageOnMarch1(100);
const PLAN_TOTAL = PLAN_MARCH1.saltflat + PLAN_MARCH1.hollowcreek;
const BASE_CURVE = () => leaseCurve(100).calder;
const SALT = () => leaseIntrinsic('salt');
const RES = () => leaseIntrinsic('reservoir');

/** Months in which a schedule buys (net) and sells (net), by gas-year index. */
function activeMonths(flow: number[]) {
  const buy: number[] = [];
  const sell: number[] = [];
  GAS_MONTH_START.forEach((s, m) => {
    const net = flow.slice(s, s + GAS_MONTH_DAYS[m]).reduce((a, b) => a + b, 0);
    if (net > 1e-6) buy.push(m);
    else if (net < -1e-6) sell.push(m);
  });
  return { buy, sell };
}

function monthsText(ms: number[]): string {
  const names = ms.map((m) => GAS_MONTH_NAMES[m]);
  if (names.length <= 1) return names.join('');
  // A run of consecutive months reads as a range.
  const consecutive = ms.every((m, i) => i === 0 || m === ms[i - 1] + 1);
  if (consecutive && names.length > 2) return `${names[0]} through ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const strip = (c: number[], from: number, to: number) => mean(c.slice(from, to));
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** Money for prose: amounts under a million rounded to the nearest thousand dollars. */
const roughly = (x: number) => money(Math.abs(x) >= 1e6 ? x : Math.round(x / 1000) * 1000);

export default function Lesson() {
  // ---- Figure 1: intrinsic value.
  const s = useScenario('intrinsic', LEASE_DEFAULTS);
  const st = s.state;
  const curve = leaseCurve(st.level);
  const daily = curveDaily(st.level);
  const opt = leaseIntrinsic(st.lease, st.level, st.fee);
  const trades = leaseTrades(opt.flow, daily);
  const solvedLevel = levelChallengeSolved(st);
  const progress = useProgress();
  const levelDone = solvedLevel || (progress['gas/5.2']?.includes('a') ?? false);
  const hidden = levelValueHidden(st, levelDone);
  const spreadNow = trades.sellAvg - trades.buyAvg;
  const levelStatus =
    st.lease !== 'salt'
      ? 'Choose the Salt Flat lease first.'
      : Math.abs(st.fee - LEASE_FEE) > 1e-9
        ? `Set the fee back to ${gp(LEASE_FEE)} each way.`
        : st.level <= 100
          ? `At ${st.level}% of plan the lease is worth ${money(opt.value)}, with a spread of ${gp(spreadNow)}. It needs more gas in storage.`
          : opt.value < LEVEL_TARGET
            ? `At ${st.level}% of plan the lease receives ${gp(spreadNow)} more than it pays. Is that enough, after the fees?`
            : `At ${st.level}% of plan the lease receives ${gp(spreadNow)} more than it pays. Is this the lowest level that does it?`;
  const levelTotal = storageOnMarch1(st.level);

  // ---- Figure 2: what actually happened.
  const w = useScenario('years', SCENARIO_DEFAULTS);
  const ws = w.state;
  const path = leaseSpotPaths()[ws.year - 1];
  const intr = leaseIntrinsic(ws.lease);
  const perfect = leasePerfect(ws.lease, ws.year);
  const unhedged = scheduleValue(intr.flow, path);
  const perfectAll = leasePerfectValues(ws.lease);
  const perfectAvg = mean(perfectAll);
  const solvedHedge = hedgeYearSolved(ws);
  const yearTop = Math.max(6, Math.ceil(Math.max(...path)));

  // ---- Prose numbers.
  const base = BASE_CURVE();
  const salt = SALT();
  const res = RES();
  const saltMonths = activeMonths(salt.flow);
  const resMonths = activeMonths(res.flow);
  const resTrades = leaseTrades(res.flow, curveDaily(100));
  const saltTrades = leaseTrades(salt.flow, curveDaily(100));
  const saltDays = leaseDays('salt');
  const resDays = leaseDays('reservoir');
  const cheapest = Math.min(...base.slice(0, 7));
  // The summer month the Salt Flat plan passes over that is closest in price to the months it buys.
  const nextCheapest = Math.min(...base.slice(0, 7).filter((_, m) => !saltMonths.buy.includes(m)));
  const nextCheapestMonth = GAS_MONTH_NAMES[base.indexOf(nextCheapest)];
  const dearest = Math.max(...base.slice(7));
  const low = leaseIntrinsic('salt', LEVEL_MIN).value;
  const high = leaseIntrinsic('salt', LEVEL_MAX).value;
  const lowCurve = leaseCurve(LEVEL_MIN).calder;
  const highCurve = leaseCurve(LEVEL_MAX).calder;
  const saltPF = leasePerfectValues('salt');
  const resPF = leasePerfectValues('reservoir');
  const saltPFAvg = mean(saltPF);
  const resPFAvg = mean(resPF);
  const saltBelow = saltPF.filter((v) => v < salt.value).length;
  const resBelow = resPF.filter((v) => v < res.value).length;
  const saltUnhedged = leaseUnhedged('salt');

  return (
    <LessonPage id="gas/5.2">
      <P>
        <a href={lessonHref('gas/5.1')}>The previous lesson</a> traced the price gap between two places to a full pipeline, and found that whoever holds the pipe
        collects it. The other great gap in gas is between two times: the same gas costs less in summer than in winter. The asset that spans that gap is storage, and{' '}
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a> showed that when the region’s fields fill, the gap grows into a rent. So what, exactly, is a storage field worth
        to the person who controls it?
      </P>
      <P>
        Storage owners rarely use all their space themselves. Much of it is leased out under contracts that give the holder a share of the space and the right to put
        gas in and take it out up to set amounts each day. Suppose you can lease <K c="energy">1 Bcf of space</K> for the coming gas year in either of the region’s fields. A Salt Flat lease carries
        Salt Flat’s quick rights, scaled to your share: you can fill it from empty in {fmt(saltDays.fill)} days and empty it in {fmt(saltDays.empty)}. A Hollow Creek
        lease carries the depleted field’s slow ones: {fmt(resDays.fill)} days to fill, {fmt(resDays.empty)} to empty. (Real leases often add ratchets like those of{' '}
        <a href={lessonHref('gas/3.4')}>Lesson 3.4</a>; we leave them out so the arithmetic stays visible.) Either way you pay {gp(LEASE_FEE)} per MMBtu to put gas
        in and {gp(LEASE_FEE)} to take it out, and you decide when to buy gas, when to store it and when to sell it.
      </P>
      <P>
        Start with what can be known for certain. It is March 1, and the forward curve of <a href={lessonHref('gas/4.5')}>Lesson 4.5</a> prices every month of the
        coming year. By buying forwards for the months you plan to inject and selling forwards for the months you plan to withdraw, you can fix your profit today. The
        best such plan — found by trying every way of moving gas in and out within the lease’s daily rights — earns the lease’s <K c="price">intrinsic value</K>. In
        the next demonstration, the upper chart is the curve, with the months the plan buys shaded blue and the months it sells shaded red; the lower one is the gas in
        your lease. Choose the lease, how much gas the whole region has in storage on March 1, and the fee:
      </P>

      <Figure name="Storage Optionality Lab" scenario={s}>
        <Segmented label="Lease" value={st.lease} onChange={(v) => s.set({ lease: v })} options={LEASE_IDS.map((id) => ({ value: id, label: LEASE_LABEL[id] }))} />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[1.5, 6]}
          yTicks={[2, 3, 4, 5, 6]}
          xTicks={MONTH_TICKS}
          xFormat={monthLabel}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Forward price at Calder Hub on March 1, $/MMBtu"
          height={190}
          bands={activityBands(opt.flow)}
          series={[{ ...curveSteps(curve.calder), kind: 'step', color: GRAPHIC.green, width: 2.5 }]}
          ariaLabel={`The forward curve drawn on March 1 with the region’s storage at ${st.level}% of plan: ${GAS_MONTHS.map((m, i) => `${m} ${gp(curve.calder[i])}`).join(', ')}. The ${LEASE_LABEL[st.lease]}’s best plan buys in ${monthsText(activeMonths(opt.flow).buy) || 'no month'} and sells in ${monthsText(activeMonths(opt.flow).sell) || 'no month'}.`}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, 1]}
          yTicks={[0, 0.5, 1]}
          xTicks={MONTH_TICKS}
          xFormat={monthLabel}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Gas in your lease, Bcf"
          height={130}
          series={[
            { xs: [0, ...DAYS], ys: [0, ...opt.inventory], color: GRAPHIC.gold, kind: 'area', opacity: 0.3 },
            { xs: [0, ...DAYS], ys: [0, ...opt.inventory], color: GRAPHIC.gold, width: 2 },
          ]}
          ariaLabel={`Gas in the ${LEASE_LABEL[st.lease]} through the year under the intrinsic plan, peaking at ${fmt(Math.max(0, ...opt.inventory), 2)} Bcf.`}
        />
        <Legend
          items={[
            { label: 'Forward price', color: GRAPHIC.green, kind: 'line' },
            { label: 'Months the plan buys and injects', color: tint(INJECT_COLOR, 0.35) },
            { label: 'Months it withdraws and sells', color: tint(SELL_COLOR, 0.35) },
          ]}
        />
        <Readouts
          items={[
            { label: hidden ? 'intrinsic value, a year (above plan, hidden until the challenge is solved)' : 'intrinsic value, a year', value: hidden ? '?' : money(opt.value), tone: 'green' },
            { label: 'average price paid', value: trades.bought > 0 ? gp(trades.buyAvg) : '—', tone: 'green' },
            { label: 'average price received', value: trades.sold > 0 ? gp(trades.sellAvg) : '—', tone: 'green' },
            { label: 'received − paid', value: trades.bought > 0 && trades.sold > 0 ? gp(spreadNow) : '—', tone: 'green' },
          ]}
        />
        <Slider
          label="Region’s storage on March 1"
          tone="gold"
          value={st.level}
          min={LEVEL_MIN}
          max={LEVEL_MAX}
          step={LEVEL_STEP}
          onChange={(v) => s.set({ level: v })}
          display={`${st.level}% of plan · ${fmt(levelTotal.saltflat + levelTotal.hollowcreek, 1)} Bcf`}
        />
        <Slider
          label="Fee to inject, and to withdraw"
          tone="green"
          value={st.fee}
          min={0}
          max={FEE_MAX}
          step={FEE_STEP}
          onChange={(v) => s.set({ fee: Math.round(v * 100) / 100 })}
          display={`${gp(st.fee)} per MMBtu each way`}
        />
        <Eq
          label={`Intrinsic value equals ${fmt(MMBTU_PER_BCF / 1e6, 3)} million MMBtu per Bcf times (${fmt(trades.sold, 2)} Bcf sold at ${gp(trades.sellAvg)} minus the fee, minus ${fmt(trades.bought, 2)} Bcf bought at ${gp(trades.buyAvg)} plus the fee)${hidden ? ', hidden above plan until the challenge is solved' : `: ${money(opt.value)}`}`}
        >
          <K c="price">value</K>
          <Op>=</Op>
          <span>{fmt(MMBTU_PER_BCF / 1e6, 3)} million</span>
          <Op>×</Op>
          <span>
            [{fmt(trades.sold, 2)} × ({gp(trades.sellAvg)} − {gp(st.fee)}) − {fmt(trades.bought, 2)} × ({gp(trades.buyAvg)} + {gp(st.fee)})]
          </span>
          <Op>=</Op>
          <K c="price">{hidden ? '?' : money(opt.value)}</K>
        </Eq>
      </Figure>

      <P>
        With the region’s storage as planned — {fmt(PLAN_TOTAL, 1)} Bcf on March 1 — the curve’s cheapest month is {GAS_MONTH_NAMES[base.indexOf(cheapest)]} at{' '}
        {gp(cheapest)} and its dearest is {GAS_MONTH_NAMES[base.indexOf(dearest)]} at {gp(dearest)}. The Salt Flat lease goes straight for both. Its plan buys gas in{' '}
        {monthsText(saltMonths.buy)}, the two cheapest months — by a fraction of a cent, since {nextCheapestMonth} also rounds to {gp(nextCheapest)} — holds it, and sells it all in {monthsText(saltMonths.sell)}: {fmt(saltTrades.sold, 2)} Bcf bought at an
        average of {gp(saltTrades.buyAvg)} and sold at {gp(saltTrades.sellAvg)}. After fees that is {money(salt.value)} a year, or {gp(salt.value / MMBTU_PER_BCF)}{' '}
        for every MMBtu of space. The Hollow Creek lease can’t be so choosy. It takes {fmt(resDays.fill)} days to fill, so it must spread its buying across{' '}
        {WORDS[resMonths.buy.length]} months, {monthsText(resMonths.buy)}, and {fmt(resDays.empty)} days to empty, so it sells across {WORDS[resMonths.sell.length]},{' '}
        {monthsText(resMonths.sell)}, averaging {gp(resTrades.buyAvg)} paid and {gp(resTrades.sellAvg)} received. Its intrinsic value is {money(res.value)}, {gp(res.value / MMBTU_PER_BCF)} per MMBtu. Speed is worth money even before
        anything uncertain happens: it lets the lease buy and sell at the curve’s extremes.
      </P>
      <P>
        The curve, though, depends on the region. Lower the storage slider to {LEVEL_MIN}% of plan: with little gas left at the end of winter, the market has to refill
        storage over the summer, summer gas averages {gp(strip(lowCurve, 0, 7))} instead of {gp(strip(base, 0, 7))}, and the Salt Flat lease is worth only{' '}
        {money(low)}. Raise it to {LEVEL_MAX}%: summer falls to {gp(strip(highCurve, 0, 7))} while winter falls only to {gp(strip(highCurve, 7, 12))}, from{' '}
        {gp(strip(base, 7, 12))}, so the gap the lease trades widens. (Above plan, the figure keeps the lease’s value to itself until you’ve tried the challenge that
        follows.) A glut of gas in storage makes storage space more valuable, because it cheapens the gas that goes in. Fees work the other way, cent for cent on
        every MMBtu that moves in or out.
      </P>

      <Challenge
        id="a"
        figure="Storage Optionality Lab"
        question={`With the fee at ${gp(LEASE_FEE)} each way, what’s the lowest level of storage on March 1, on the slider’s steps, at which the Salt Flat lease is worth at least ${money(LEVEL_TARGET)} a year? Work it out first: the lease buys and sells all of its 1 Bcf, ${fmt(MMBTU_PER_BCF / 1e6, 3)} million MMBtu, and pays a fee each way. What spread between the average prices received and paid does ${money(LEVEL_TARGET)} take? Then find the lowest level that earns it.`}
        solved={solvedLevel}
        status={levelStatus}
        success={`Solved: ${st.level}% of plan. ${money(LEVEL_TARGET)} over ${fmt(MMBTU_PER_BCF / 1e6, 3)} million MMBtu is ${gp(LEVEL_TARGET / MMBTU_PER_BCF)} per MMBtu, and the two fees add ${gp(2 * LEASE_FEE)}, so the lease needs a spread of at least ${gp(LEVEL_SPREAD_NEEDED)}. Here it earns ${gp(spreadNow)} and is worth ${money(leaseIntrinsic('salt', st.level).value)}${st.level - LEVEL_STEP >= LEVEL_MIN ? `; at ${st.level - LEVEL_STEP}% the spread is ${gp(levelSpread(st.level - LEVEL_STEP))} and the lease would be worth ${money(leaseIntrinsic('salt', st.level - LEVEL_STEP).value)}` : ''}, and at ${LEVEL_MAX}% it would be worth ${money(high)}. More gas in the ground on March 1 means less to inject over the summer, so summer prices fall further than winter’s, and the spread the lease earns widens. A storage owner leasing out space would charge more in a year that starts with a surplus.`}
      />

      <H2>What the curve leaves out</H2>
      <P>
        The curve is an average over many possible years. The year that actually comes will have its own cold spells and mild weeks, and a lease that can move gas
        quickly can answer them: sell into a three-day spike, buy back on a mild week, sell again. Nothing obliges it to. A lease is a right, not an obligation: its
        holder moves gas only when the spread between buying and selling pays, and stands aside when it doesn’t. A contract that gives its holder that kind of choice
        is an <K c="price">option</K>, and a storage lease is an option on the spread between the days it can buy and the days it can sell. Its intrinsic value is what
        the option is worth if prices come out exactly as the curve says. Its <K c="price">extrinsic value</K> is the worth of the flexibility on top: of being able to
        change the plan when they don’t. To see how much that could be, the next demonstration takes the {LEASE_YEARS} simulated years the curve was
        averaged from and, for each, finds the best possible plan with <b>perfect foresight</b> — knowing every day’s price in advance. No real trader does that well,
        so this is an upper limit. The upper chart is the year’s daily Calder price against the curve; the middle one, the gas in your lease under the intrinsic plan
        and under the perfect-foresight plan; the bars, what perfect foresight earns in each year. Choose a lease and a year:
      </P>

      <Figure name="Storage Optionality Lab · scenarios" scenario={w}>
        <Segmented label="Lease" value={ws.lease} onChange={(v) => w.set({ lease: v })} options={LEASE_IDS.map((id) => ({ value: id, label: LEASE_LABEL[id] }))} />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[1.5, yearTop]}
          yTicks={Array.from({ length: Math.floor(yearTop / 2) + 1 }, (_, i) => i * 2).filter((v) => v >= 2)}
          xTicks={MONTH_TICKS}
          xFormat={monthLabel}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel={`Year ${ws.year}: daily Calder price, $/MMBtu`}
          height={170}
          series={[
            { ...curveSteps(BASE_CURVE()), kind: 'step', color: GRAPHIC.green, width: 1.5, dash: '5 4' },
            { xs: DAYS.map((d) => d - 0.5), ys: path, color: '#333', width: 1.5 },
          ]}
          ariaLabel={`Daily Calder prices in simulated year ${ws.year}, from ${gp(Math.min(...path))} to ${gp(Math.max(...path))}, against the forward curve drawn on March 1.`}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, 1]}
          yTicks={[0, 0.5, 1]}
          xTicks={MONTH_TICKS}
          xFormat={monthLabel}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Gas in your lease, Bcf"
          height={120}
          series={[
            { xs: [0, ...DAYS], ys: [0, ...intr.inventory], color: '#8a8a8a', width: 1.5, dash: '5 4' },
            { xs: [0, ...DAYS], ys: [0, ...perfect.inventory], color: GRAPHIC.gold, width: 2.5 },
          ]}
          ariaLabel={`Gas in the ${LEASE_LABEL[ws.lease]} in year ${ws.year}: the intrinsic plan, and the perfect-foresight plan, which earns ${money(perfect.value)}.`}
        />
        <Legend
          items={[
            { label: 'Daily price that year', color: '#333', kind: 'line' },
            { label: 'Forward curve on March 1', color: GRAPHIC.green, kind: 'line', dashed: true },
            { label: 'Intrinsic plan', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Perfect-foresight plan', color: GRAPHIC.gold, kind: 'line' },
          ]}
        />
        <YearBars id={ws.lease} selected={ws.year} intrinsic={intr.value} onSelect={(n) => w.set({ year: n })} />
        <Readouts
          items={[
            { label: `year ${ws.year}, perfect foresight`, value: money(perfect.value), tone: 'green' },
            { label: `year ${ws.year}, intrinsic plan without a hedge`, value: money(unhedged), tone: unhedged < 0 ? 'red' : 'green' },
            { label: 'perfect foresight, average', value: money(perfectAvg), tone: 'green' },
            { label: 'intrinsic value, locked in', value: money(intr.value), tone: 'green' },
          ]}
        />
        <Slider label="Simulated year" tone="teal" value={ws.year} min={1} max={LEASE_YEARS} onChange={(v) => w.set({ year: v })} display={`${ws.year} of ${LEASE_YEARS}`} />
      </Figure>

      <P>
        Averaged over the {LEASE_YEARS} years, perfect foresight would have earned the Salt Flat lease {money(saltPFAvg)}, {roughly(saltPFAvg - salt.value)} more than its
        intrinsic {money(salt.value)}: up to {pct(saltPFAvg / salt.value - 1)} of extra value from flexibility. The Hollow Creek lease gains only{' '}
        {roughly(resPFAvg - res.value)}, {pct(resPFAvg / res.value - 1)}. Look at a cold year for each and the reason is plain. The fast lease can hold its gas until prices
        spike and then sell a {fmt(saltDays.empty)}th of its space on every day the spike lasts. The slow one can sell only a {fmt(resDays.empty)}th a day, so even
        knowing the future it must sell steadily through the winter, spike or no spike. Flexibility is worth most to the asset that can use it, which is why
        high-deliverability salt storage tends to lease for more per unit of space than depleted fields.
      </P>
      <P>
        Real traders capture part of that extra, not all of it. A common way is <b>rolling intrinsic</b>: lock in the intrinsic plan with forwards on March 1, and each
        time the curve moves, find the best plan again from the gas actually in the lease and trade forwards to switch to it. The old plan and its hedges are always
        still there to keep, so a switch is made only when the new plan is worth more, and each one locks in a little of the extrinsic value. Another is to sell
        options of one’s own — the right, say, to buy gas at a fixed price on whichever winter days the buyer chooses — to a utility that wants protection against the
        very spikes the lease can serve, with the lease’s gas standing behind the promise. How much traders capture depends on how well they read the weather and the
        storage report, the subject of <a href={lessonHref('gas/6.1')}>Chapter 6</a>; <a href={lessonHref('gas/6.4')}>Lesson 6.4</a> runs rolling intrinsic on a lease
        like this one, a month at a time, over eight simulated years.
      </P>

      <H2>Why lock anything in</H2>
      <P>
        Now look at the bars’ spread. Perfect foresight earned the Salt Flat lease anywhere from {money(Math.min(...saltPF))} to {money(Math.max(...saltPF))},
        and in {saltBelow} of the {LEASE_YEARS} years it earned less than the intrinsic value that could have been locked in on March 1; for the Hollow Creek lease, in{' '}
        {resBelow}. Those are the mild years, when winter never delivered the prices the curve expected. A holder who had locked in the plan of{' '}
        <FigRef to="Storage Optionality Lab">the first demonstration</FigRef> on March 1 got the curve’s prices anyway. A holder who simply followed the intrinsic plan without a hedge collected anywhere from {roughly(Math.min(...saltUnhedged))} to{' '}
        {money(Math.max(...saltUnhedged))} on the same Salt Flat lease, depending on the year. The hedge doesn’t add value on average — the curve is the market’s best
        guess — but it turns a gamble on the winter into a known {money(salt.value)}, the kind of income a storage owner can borrow against.
      </P>

      <Challenge
        id="b"
        figure="Storage Optionality Lab · scenarios"
        question="Find a year in which the Salt Flat lease, even run with perfect foresight, would have earned less than the intrinsic value you could have locked in on March 1."
        solved={solvedHedge}
        status={
          ws.lease !== 'salt'
            ? 'Choose the Salt Flat lease first.'
            : `In year ${ws.year} perfect foresight earns ${money(perfect.value)}, ${perfect.value >= intr.value ? 'more' : 'less'} than the ${money(intr.value)} intrinsic value.`
        }
        success={`Solved: in year ${ws.year} the best possible plan earns ${money(perfect.value)}, against the ${money(intr.value)} the forwards locked in. Prices that year never rewarded storing gas as much as the curve expected, so no amount of skill could have made up the difference — but a hedge did. That is the trade at the heart of storage. The hedge gives up the chance that the plan’s trades pay more than the curve expected, in exchange for knowing what they pay; it doesn’t give up the lease’s flexibility, which a hedged holder can still use to re-optimize when a cold spell comes and earn more on top.`}
      />

      <P>
        Storage’s value, then, has two parts with two different sources. The intrinsic part is the spread the curve already shows, set by how much gas the region has
        and how cold it expects the winter to be. The extrinsic part comes from the weather itself — from how far the year that arrives strays from the average — and
        only a lease fast enough to respond can collect it. Storage is one way the region answers the price of gas. The buyers that answer it most readily, day by
        day, are the region’s power plants, which can burn more gas or less as the spread between gas and electricity moves. That spread is the subject of{' '}
        <a href={lessonHref('gas/5.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
