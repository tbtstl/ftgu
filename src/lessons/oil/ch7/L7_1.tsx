import { useDeferredValue, useEffect, useMemo, useState } from 'react';
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
  areaPath,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  FAN_SEEDS,
  LONG_RUN_WTI,
  PLAN_LIMITS,
  PRODUCTION_DEFAULTS,
  WELL_BREAKEVEN,
  drillingYears,
  monthlyWti,
  productionOnPath,
  quantile,
  type ProductionPlan,
  type ProductionResult,
} from '../../../engines/oil/business';
import { TERMS, WATERFLOOD, pinyonWellCost } from '../../../engines/oil/economics';
import { CRUDE_COLOR } from '../../../model/oil/crudes';
import { KESSLER_CORRAN } from '../../../model/oil/logistics';
import { CORRAN } from '../../../model/oil/refinery';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams, type HistoryWeek } from '../../../model/oil/history';
import { XYChart } from '../shared/charts';
import { BusinessCard } from '../shared/BusinessCard';
import { confirmResetPart, updateBusiness, useBusiness } from '../shared/business';

// ---------------------------------------------------------------------------
// The world the prices come from (lesson-level assumptions, not part of the saved plan).

export type GroupMode = 'steady' | 'free';

export interface WorldState {
  /** Does the producer group use its spare capacity to steady prices (Lesson 5.1)? */
  group: GroupMode;
  /** Supply outages a year (Lesson 5.5). */
  shocks: number;
}

export const WORLD_DEFAULTS: WorldState = { group: 'steady', shocks: HISTORY_DEFAULTS.supplyShocks };

/** History parameters for a world (only the drivers that differ from the course's). */
export function worldParams(st: WorldState): HistoryParams {
  const p: HistoryParams = {};
  if (st.group === 'free') p.groupStabilizes = false;
  if (st.shocks !== HISTORY_DEFAULTS.supplyShocks) p.supplyShocks = st.shocks;
  return p;
}

/** The course's history (the first of the thirty) in a world. */
export function ourHistory(st: WorldState = WORLD_DEFAULTS): HistoryWeek[] {
  return oilHistory({ ...worldParams(st), seed: FAN_SEEDS[0] });
}

/** Average production in a year of the plan (1 = the coming year), b/d, in total or from one source. */
export function yearProduction(r: ProductionResult, year: number, source?: 'northfield' | 'flood' | 'pinyon'): number {
  const parts = source ? [r[source]] : [r.northfield, r.flood, r.pinyon];
  const from = (year - 1) * 12;
  return parts.reduce((s, arr) => s + arr.slice(from, from + 12).reduce((a, q) => a + q, 0) / 12, 0);
}

const DAYS_PER_MONTH = 365.25 / 12;
/** The producer's share of each extra dollar of WTI, after royalty and production tax (Lesson 2.5). */
const NET_SHARE = (1 - TERMS.royalty) * (1 - TERMS.productionTax);
const MONTHLY_DISCOUNT = Math.pow(1 + TERMS.discount, 1 / 12);

export interface Valuation {
  /** NPV at the course's long-run price, $, and its change per $1 of long-run price. */
  at75: number;
  slope: number;
}

/**
 * The plan valued on many histories, exactly but quickly. A plan's volumes depend on a history
 * only through the years it drills in, and its cash is linear in each month's price; so each
 * drilling pattern is valued once in full (productionOnPath), and the other histories with that
 * pattern by adding the discounted volume times their price differences. The slope against the
 * long-run price is the discounted volume after the five years.
 */
export function valuations(plan: ProductionPlan, hs: HistoryWeek[][]): Valuation[] {
  const refs = new Map<string, { r: ProductionResult; slope: number }>();
  return hs.map((h) => {
    const key = drillingYears(plan, h).join();
    let ref = refs.get(key);
    if (!ref) {
      const r = productionOnPath(plan, h);
      const histMonths = Math.floor((h.length * 12) / 52);
      let slope = 0;
      let f = 1;
      for (let m = 0; m < r.price.length; m++) {
        if (m >= histMonths) slope += ((r.northfield[m] + r.flood[m] + r.pinyon[m]) * DAYS_PER_MONTH * NET_SHARE) / f;
        f *= MONTHLY_DISCOUNT;
      }
      ref = { r, slope };
      refs.set(key, ref);
      return { at75: r.npv, slope };
    }
    const { r } = ref;
    const p = monthlyWti(h, r.price.length);
    let d = 0;
    let f = 1;
    for (let m = 0; m < p.length; m++) {
      if (p[m] !== r.price[m]) d += ((r.northfield[m] + r.flood[m] + r.pinyon[m]) * DAYS_PER_MONTH * NET_SHARE * (p[m] - r.price[m])) / f;
      f *= MONTHLY_DISCOUNT;
    }
    return { at75: r.npv + d, slope: ref.slope };
  });
}

const valuationCache = new Map<string, Valuation[]>();
/** The plan valued on each of the thirty histories of a world (the course's first). */
export function fanValuations(plan: ProductionPlan, st: WorldState = WORLD_DEFAULTS): Valuation[] {
  const key = JSON.stringify([plan, st]);
  let v = valuationCache.get(key);
  if (!v) {
    v = valuations(
      plan,
      FAN_SEEDS.map((seed) => oilHistory({ ...worldParams(st), seed })),
    );
    if (valuationCache.size > 200) valuationCache.clear();
    valuationCache.set(key, v);
  }
  return v;
}

/** The plan's NPV on each of the thirty histories of a world, $ (long-run price $75). */
export function fanNpvs(plan: ProductionPlan, st: WorldState = WORLD_DEFAULTS): number[] {
  return fanValuations(plan, st).map((v) => v.at75);
}

// ---------------------------------------------------------------------------
// Challenge a: the cheapest plan that reaches a production target in year 3.

/** Average production in year 3 the plan should reach, b/d. */
export const PRODUCTION_TARGET = 60000;

const WELL_STEPS = PLAN_LIMITS.wellsPerYear;

let cheapest: { capital: number; plan: ProductionPlan } | null = null;
/**
 * The least capital, among plans on the controls' grid with no drilling rule, that brings year-3
 * production to the target. Volumes don't depend on prices, so any history gives the same answer;
 * and more wells only add production and capital, so each branch stops at its first success.
 */
export function cheapestTargetPlan(): { capital: number; plan: ProductionPlan } {
  if (cheapest) return cheapest;
  const h = ourHistory();
  let best = { capital: Infinity, plan: PRODUCTION_DEFAULTS };
  for (const waterflood of [false, true]) {
    const most = productionOnPath({ wellsPerYear: WELL_STEPS[1], waterflood, drillAbove: 0 }, h);
    if (yearProduction(most, 3) < PRODUCTION_TARGET) continue;
    for (let w = WELL_STEPS[0]; w <= WELL_STEPS[1]; w += WELL_STEPS[2]) {
      const plan = { wellsPerYear: w, waterflood, drillAbove: 0 };
      const r = productionOnPath(plan, h);
      if (yearProduction(r, 3) >= PRODUCTION_TARGET) {
        if (r.capitalTotal < best.capital) best = { capital: r.capitalTotal, plan };
        break;
      }
    }
  }
  cheapest = best;
  return best;
}

/** Challenge a: no drilling rule, year-3 production at the target, and no more capital than the cheapest such plan. */
export function cheapestPlanSolved(plan: ProductionPlan): boolean {
  if (plan.drillAbove !== 0) return false;
  const r = productionOnPath(plan, ourHistory());
  return yearProduction(r, 3) >= PRODUCTION_TARGET && r.capitalTotal <= cheapestTargetPlan().capital + 1;
}

// ---------------------------------------------------------------------------
// The second demonstration: the long-run price after the five years.

export interface DeckState {
  /** WTI assumed after the simulated five years, $/bbl. */
  longRun: number;
}

export const DECK_DEFAULTS: DeckState = { longRun: LONG_RUN_WTI };
export const DECK_RANGE: [number, number] = [30, 110];

export type DeckLine = Valuation;

/** The thirty histories' lines in the course's world: NPV against the long-run price is a straight line for each. */
export function deckLines(plan: ProductionPlan): DeckLine[] {
  return fanValuations(plan, WORLD_DEFAULTS);
}

export function npvAt(l: DeckLine, longRun: number): number {
  return l.at75 + l.slope * (longRun - LONG_RUN_WTI);
}

/** The width of the middle 80% of the thirty histories' NPVs at a long-run price, $. */
export function middleSpread(lines: DeckLine[], longRun = LONG_RUN_WTI): number {
  const xs = lines.map((l) => npvAt(l, longRun));
  return quantile(xs, 0.9) - quantile(xs, 0.1);
}

/**
 * Challenge b's answer: the highest whole-dollar long-run price at which the plan's NPV on our
 * history is at least the thirty histories' middle-80% spread (at $75) below its NPV at $75.
 */
export function luckAnswer(plan: ProductionPlan): number {
  const lines = deckLines(plan);
  return Math.floor(LONG_RUN_WTI - middleSpread(lines) / lines[0].slope + 1e-9);
}

export function luckSolved(plan: ProductionPlan, st: DeckState): boolean {
  return st.longRun === luckAnswer(plan);
}

// ---------------------------------------------------------------------------
// Formatting and colors.

const NF_COLOR = CRUDE_COLOR.northfield;
const FLOOD_COLOR = tint(CRUDE_COLOR.northfield, 0.45);
const RB_COLOR = CRUDE_COLOR.pinyon;
const YEARS_SHOWN = 10;

/** Money as the chapter writes it: billions to two decimals, millions whole. */
function money(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${fmt(a / 1e9, 2)} billion`;
  if (a >= 1e6) return `${s}$${fmt(a / 1e6)} million`;
  return usd(x);
}

/** Millions to one decimal, for the numbers challenge b is estimated from. */
const money1 = (x: number) => `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, 1)} million`;

/** A range of values in the chapter's format ("$2.79–2.89 billion"). */
function moneyRange(lo: number, hi: number): string {
  if (lo >= 1e9 && hi >= 1e9) return `$${fmt(lo / 1e9, 2)}–${fmt(hi / 1e9, 2)} billion`;
  return `${money(lo)}–${money(hi)}`;
}

function moneyM(x: number, digits = 0): string {
  return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, digits)}M`;
}

const dollars = (x: number) => usd(x, 2);
/** Production to the nearest hundred barrels a day. */
const bpd = (x: number) => `${fmt(Math.round(x / 100) * 100)} b/d`;
const X0 = 60;
const X1 = 624;

// ---------------------------------------------------------------------------
// Charts.

/** Stacked oil production over ten years, b/d. */
function ProductionChart({ r }: { r: ProductionResult }) {
  const n = YEARS_SHOWN * 12;
  const totals = Array.from({ length: n }, (_, m) => r.northfield[m] + r.flood[m] + r.pinyon[m]);
  const [, top] = niceDomain(0, Math.max(10000, ...totals), 4);
  const x = scale(0, n, X0, X1);
  const y = scale(0, top, 132, 22);
  const xs = Array.from({ length: n }, (_, m) => x(m + 0.5));
  const lay0 = r.northfield.slice(0, n);
  const lay1 = lay0.map((v, m) => v + r.flood[m]);
  const lay2 = lay1.map((v, m) => v + r.pinyon[m]);
  const zero = lay0.map(() => 0);
  const peakAt = totals.indexOf(Math.max(...totals));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 152"
      role="img"
      aria-label={`The plan’s oil production over ten years, stacked: ${bpd(yearProduction(r, 1))} in year 1, ${bpd(yearProduction(r, 3))} in year 3 (${bpd(
        yearProduction(r, 3, 'flood'),
      )} of it from the waterflood and ${bpd(yearProduction(r, 3, 'pinyon'))} from Pinyon wells), peaking at ${bpd(totals[peakAt])} in year ${
        Math.floor(peakAt / 12) + 1
      }, and ${bpd(yearProduction(r, 10))} in year 10.`}
    >
      <text className="ax" x={X0} y={13}>
        Oil production, barrels per day
      </text>
      <GridY y={y} ticks={niceTicks(0, top, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={areaPath(xs, lay0.map(y), zero.map(y))} fill={NF_COLOR} opacity={0.85} />
      <path d={areaPath(xs, lay1.map(y), lay0.map(y))} fill={FLOOD_COLOR} />
      <path d={areaPath(xs, lay2.map(y), lay1.map(y))} fill={RB_COLOR} opacity={0.85} />
      <path d={linePath(xs, lay2.map(y))} fill="none" stroke="#333" strokeWidth={1.2} />
      {[0, 2, 4, 6, 8, 10].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr * 12)} y={146}>
          {yr === 0 ? 'now' : `year ${yr}`}
        </text>
      ))}
    </svg>
  );
}

/** WTI along our history, then the long-run price; the year starts at which drilling is decided. */
function PriceChart({ r, h, plan }: { r: ProductionResult; h: HistoryWeek[]; plan: ProductionPlan }) {
  const hist = r.price.slice(0, 60);
  const starts = [0, 1, 2, 3, 4].map((yr) => h[yr * 52].wti);
  const lo = Math.min(45, ...hist, ...starts) - 3;
  const hi = Math.max(...hist, ...starts, plan.drillAbove, LONG_RUN_WTI) + 3;
  const [d0, d1] = niceDomain(lo, hi, 4);
  const skipped = r.drilled.map((d, i) => (d ? null : i + 1)).filter((v): v is number => v !== null);
  return (
    <XYChart
      ariaLabel={`WTI on the course’s simulated history: years start at ${starts.map((p) => dollars(p)).join(', ')}; afterward the long-run $${LONG_RUN_WTI}. A well’s breakeven is ${dollars(
        WELL_BREAKEVEN,
      )}.${plan.drillAbove > 0 ? ` The drilling rule needs at least $${plan.drillAbove}: ${skipped.length ? `year${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')} skipped` : 'no year skipped'}.` : ''}`}
      height={136}
      x={[0, YEARS_SHOWN]}
      y={[d0, d1]}
      xTicks={[0, 2, 4, 6, 8, 10]}
      xFormat={(v) => (v === 0 ? 'now' : `year ${v}`)}
      yFormat={(v) => `$${fmt(v)}`}
      yLabel="WTI, $ per barrel (simulated)"
      margin={[X0, 16, 26, 26]}
      series={[
        { points: hist.map((p, m) => [(m + 0.5) / 12, p] as [number, number]), color: GRAPHIC.green, width: 2 },
        { points: [[5, LONG_RUN_WTI], [YEARS_SHOWN, LONG_RUN_WTI]], color: GRAPHIC.green, width: 2, dash: '6 4', label: 'long-run price', labelAnchor: 'end' },
      ]}
      refs={[
        { axis: 'y', at: WELL_BREAKEVEN, color: '#777', label: `well breakeven ${dollars(WELL_BREAKEVEN)}` },
        ...(plan.drillAbove > 0 ? [{ axis: 'y' as const, at: plan.drillAbove, color: GRAPHIC.violet, dash: '2 3', label: `drill only at $${plan.drillAbove} or more` }] : []),
      ]}
      markers={starts.map((p, i) => ({ x: i, y: p, color: r.drilled[i] ? GRAPHIC.green : GRAPHIC.red, hollow: !r.drilled[i], r: 4.5 }))}
    />
  );
}

/** The plan's NPV on each of the thirty histories, as a strip of dots; ours is dark. */
function NpvStrip({ npvs }: { npvs: number[] }) {
  const [d0, d1] = niceDomain(Math.min(...npvs), Math.max(...npvs), 4);
  const x = scale(d0, d1, X0, X1);
  const R = 5;
  const order = npvs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const placed: Array<{ cx: number; row: number; i: number }> = [];
  const rows = [0, -1, 1, -2, 2];
  for (const { v, i } of order) {
    const cx = x(v);
    const row = rows.find((rw) => placed.every((p) => p.row !== rw || Math.abs(p.cx - cx) > 2 * R + 1)) ?? 0;
    placed.push({ cx, row, i });
  }
  const mid = 46;
  const step = 2 * R + 1;
  const bracket = mid + 2 * step + 12;
  const p10 = quantile(npvs, 0.1);
  const p90 = quantile(npvs, 0.9);
  const ours = placed.find((p) => p.i === 0)!;
  const halo = { stroke: '#fcfcfb', strokeWidth: 3, paintOrder: 'stroke' as const };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 116"
      role="img"
      aria-label={`The plan’s value on thirty simulated histories: from ${money(Math.min(...npvs))} to ${money(Math.max(...npvs))}, the middle 80% between ${money(p10)} and ${money(
        p90,
      )}; on the course’s history, ${money(npvs[0])}.`}
    >
      <text className="ax" x={X0} y={12}>
        The plan’s value (NPV at 10%) on thirty histories
      </text>
      <line x1={x(p10)} x2={x(p90)} y1={bracket} y2={bracket} stroke={GRAPHIC.violet} strokeWidth={2} />
      <line x1={x(p10)} x2={x(p10)} y1={bracket - 5} y2={bracket + 5} stroke={GRAPHIC.violet} strokeWidth={2} />
      <line x1={x(p90)} x2={x(p90)} y1={bracket - 5} y2={bracket + 5} stroke={GRAPHIC.violet} strokeWidth={2} />
      <text className={x(p90) > X1 - 90 ? 'ax ax-e' : 'ax'} x={x(p90) > X1 - 90 ? x(p10) - 6 : x(p90) + 6} y={bracket + 4} style={{ fill: TEXT.violet }}>
        middle 80%
      </text>
      {placed.map((p) => (
        <circle key={p.i} cx={p.cx} cy={mid + p.row * step} r={R} fill={p.i === 0 ? '#333' : tint(GRAPHIC.green, 0.6)} stroke="#fcfcfb" strokeWidth={1} />
      ))}
      <text className="ax ax-m" x={Math.min(X1 - 30, Math.max(X0 + 30, ours.cx))} y={mid + ours.row * step - 9} style={{ fill: '#333', fontWeight: 500, ...halo }}>
        our history
      </text>
      {niceTicks(d0, d1, 4).map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={112}>
          {moneyM(t)}
        </text>
      ))}
    </svg>
  );
}

/** The plan's NPV against the long-run price: our history, the thirty histories' middle 80%, and Northfield alone. */
function DeckChart({ lines, pumps, longRun }: { lines: DeckLine[]; pumps: DeckLine; longRun: number }) {
  const grid = Array.from({ length: 17 }, (_, i) => DECK_RANGE[0] + i * 5);
  const band = grid.map((lr) => {
    const xs = lines.map((l) => npvAt(l, lr));
    return { lr, lo: quantile(xs, 0.1), hi: quantile(xs, 0.9) };
  });
  const ours = (lr: number) => npvAt(lines[0], lr);
  const lo = Math.min(npvAt(pumps, DECK_RANGE[0]), band[0].lo, 0);
  const hi = Math.max(band[band.length - 1].hi, ours(DECK_RANGE[1]));
  const [d0, d1] = niceDomain(lo, hi, 4);
  return (
    <XYChart
      ariaLabel={`The plan’s value against the long-run price: on our history ${money(ours(DECK_RANGE[0]))} at $${DECK_RANGE[0]} and ${money(ours(DECK_RANGE[1]))} at $${
        DECK_RANGE[1]
      }; at the chosen $${longRun}, ${money(ours(longRun))}, with the thirty histories’ middle 80% ${money(middleSpread(lines, longRun))} wide. Northfield on pumps alone is worth ${money(
        npvAt(pumps, longRun),
      )}.`}
      height={240}
      x={DECK_RANGE}
      y={[d0, d1]}
      xTicks={[30, 50, 70, 90, 110]}
      xFormat={(v) => `$${v}`}
      yFormat={(v) => moneyM(v)}
      xLabel="long-run WTI after year 5, $ per barrel"
      yLabel="NPV at 10%"
      margin={[X0, 16, 26, 40]}
      series={[
        { points: band.map((b) => [b.lr, b.lo] as [number, number]), color: GRAPHIC.violet, width: 1 },
        { points: band.map((b) => [b.lr, b.hi] as [number, number]), color: GRAPHIC.violet, width: 1 },
        { points: [[DECK_RANGE[0], npvAt(pumps, DECK_RANGE[0])], [DECK_RANGE[1], npvAt(pumps, DECK_RANGE[1])]], color: '#888', width: 2, dash: '6 4', label: 'Northfield on pumps alone', labelAnchor: 'end' },
        { points: [[DECK_RANGE[0], ours(DECK_RANGE[0])], [DECK_RANGE[1], ours(DECK_RANGE[1])]], color: GRAPHIC.green, width: 2.5, label: 'the plan, our history', labelAnchor: 'end' },
      ]}
      refs={[{ axis: 'x', at: LONG_RUN_WTI, color: '#999', label: 'course’s $75' }]}
      markers={[{ x: longRun, y: ours(longRun), color: GRAPHIC.green, r: 5.5 }]}
    >
      {(sx, sy) => (
        <path
          d={`${band.map((b, i) => `${i ? 'L' : 'M'}${sx(b.lr)} ${sy(b.hi)}`).join(' ')} ${[...band]
            .reverse()
            .map((b) => `L${sx(b.lr)} ${sy(b.lo)}`)
            .join(' ')} Z`}
          fill={GRAPHIC.violet}
          opacity={0.12}
        />
      )}
    </XYChart>
  );
}

// ---------------------------------------------------------------------------
// Numbers for the prose. Some describe the world or each investment on its own; the rest are the
// reader's plan, computed live (planFacts), so the text matches the figures whatever the plan.

function lessonFacts() {
  const h = ourHistory();
  const none: ProductionPlan = { wellsPerYear: 0, waterflood: false, drillAbove: 0 };
  const pumps = productionOnPath(none, h);
  const floodOnly = productionOnPath({ ...none, waterflood: true }, h);
  const wellsOnly = productionOnPath({ ...none, wellsPerYear: PRODUCTION_DEFAULTS.wellsPerYear }, h);
  const D = productionOnPath(PRODUCTION_DEFAULTS, h);
  const startsDefault = yearStarts(WORLD_DEFAULTS);
  return {
    pumpsY1: yearProduction(pumps, 1),
    pumpsY5: yearProduction(pumps, 5),
    startY3: yearProduction(D, 3),
    startY3flood: yearProduction(D, 3, 'flood'),
    floodBbl: barrelsOf(floodOnly.flood),
    wellBbl: barrelsOf(wellsOnly.pinyon),
    wellsCapital: wellsOnly.capitalTotal,
    ourStarts: [0, 1, 2, 3, 4].map((yr) => h[yr * 52].wti),
    minStart: Math.min(...startsDefault),
    belowDefault: startsDefault.filter((p) => p < WELL_BREAKEVEN).length,
    startsCount: startsDefault.length,
    averageWti: averageWti(WORLD_DEFAULTS),
  };
}

let facts: ReturnType<typeof lessonFacts> | null = null;
function getFacts() {
  return (facts ??= lessonFacts());
}

/** Barrels produced over a run of months, from monthly rates in b/d. */
function barrelsOf(arr: number[]): number {
  return arr.reduce((s, q) => s + (q * 365.25) / 12, 0);
}

/** The prose's numbers for a production plan in the course's world. */
function computePlanFacts(plan: ProductionPlan) {
  const h = ourHistory();
  const r = productionOnPath(plan, h);
  const always = productionOnPath({ ...plan, drillAbove: 0 }, h);
  const gate65 = productionOnPath({ ...plan, drillAbove: 65 }, h);
  const fan = fanNpvs(plan);
  const lines = deckLines(plan);
  const spread = middleSpread(lines);
  const late = { old: barrelsOf(r.northfield.slice(60)), flood: barrelsOf(r.flood.slice(60)), wells: barrelsOf(r.pinyon.slice(60)) };
  const all = barrelsOf(r.northfield) + barrelsOf(r.flood) + barrelsOf(r.pinyon);
  return {
    r,
    y3: yearProduction(r, 3),
    y3sour: yearProduction(r, 3, 'northfield') + yearProduction(r, 3, 'flood'),
    y3light: yearProduction(r, 3, 'pinyon'),
    peak: Math.max(...r.northfield.map((q, m) => q + r.flood[m] + r.pinyon[m])),
    fanMin: Math.min(...fan),
    fanMax: Math.max(...fan),
    fanP10: quantile(fan, 0.1),
    fanP50: quantile(fan, 0.5),
    fanP90: quantile(fan, 0.9),
    rank: fan.filter((v) => v > fan[0]).length + 1,
    gate65Loss: always.npv - gate65.npv,
    gate65Skipped: gate65.drilled.map((d, i) => (d ? null : i + 1)).filter((v): v is number => v !== null),
    lateShare: (late.old + late.flood + late.wells) / all,
    /** Where most of the late barrels come from. */
    lateFrom: late.wells > late.old + late.flood ? 'the Pinyon wells' : late.flood > 0 ? 'the waterflood and Northfield’s old wells' : 'Northfield’s old wells',
    slope: lines[0].slope,
    spread,
    luck: spread / lines[0].slope,
  };
}

export type PlanFacts = ReturnType<typeof computePlanFacts>;
const planFactsCache = new Map<string, PlanFacts>();
export function planFacts(plan: ProductionPlan): PlanFacts {
  const key = JSON.stringify(plan);
  let v = planFactsCache.get(key);
  if (!v) {
    v = computePlanFacts(plan);
    if (planFactsCache.size > 50) planFactsCache.clear();
    planFactsCache.set(key, v);
  }
  return v;
}

/** Average weekly WTI over all thirty histories of a world. */
function averageWti(st: WorldState): number {
  let sum = 0;
  let n = 0;
  for (const seed of FAN_SEEDS) {
    for (const w of oilHistory({ ...worldParams(st), seed })) {
      sum += w.wti;
      n++;
    }
  }
  return sum / n;
}

/** WTI at the start of each of the five years, on all thirty histories of a world. */
function yearStarts(st: WorldState): number[] {
  return FAN_SEEDS.flatMap((seed) => [0, 1, 2, 3, 4].map((yr) => oilHistory({ ...worldParams(st), seed })[yr * 52].wti));
}

const FREE_WORLD: WorldState = { ...WORLD_DEFAULTS, group: 'free' };

/**
 * The prose's numbers for the world without the producer group's steadying. They need thirty more
 * histories, so the lesson computes them just after it first appears rather than before.
 */
export function freeWorldFacts(plan: ProductionPlan = PRODUCTION_DEFAULTS) {
  const always = { ...plan, drillAbove: 0 };
  const free = fanNpvs(always, FREE_WORLD);
  const starts = yearStarts(FREE_WORLD);
  // The histories with a year starting below the breakeven, and what skipping those years' wells did.
  const gatedPlan = { ...always, drillAbove: WELL_BREAKEVEN };
  const skipLosses = FAN_SEEDS.map((seed) => {
    const hf = oilHistory({ ...worldParams(FREE_WORLD), seed });
    if (drillingYears(gatedPlan, hf).every(Boolean)) return null;
    return productionOnPath(gatedPlan, hf).npv - productionOnPath(always, hf).npv;
  }).filter((v): v is number => v !== null);
  return {
    averageWti: averageWti(FREE_WORLD),
    p10: quantile(free, 0.1),
    p90: quantile(free, 0.9),
    p50: quantile(free, 0.5),
    max: Math.max(...free),
    below: starts.filter((p) => p < WELL_BREAKEVEN).length,
    starts: starts.length,
    skipLosses,
  };
}


const ORDINAL = ['best', 'second-best', 'third-best', 'fourth-best', 'fifth-best'];

/** "best", "second-best", …, "30th-best". */
function ordinal(rank: number): string {
  if (ORDINAL[rank - 1]) return ORDINAL[rank - 1];
  const suffix = rank % 10 === 1 && rank !== 11 ? 'st' : rank % 10 === 2 && rank !== 12 ? 'nd' : rank % 10 === 3 && rank !== 13 ? 'rd' : 'th';
  return `${rank}${suffix}-best`;
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const f = getFacts();
  const plan = useBusiness().production;
  const deferredPlan = useDeferredValue(plan);
  const pf = useMemo(() => planFacts(deferredPlan), [deferredPlan]);
  // The free-world numbers need thirty more histories, so they arrive just after the lesson first appears.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const ff = useMemo(() => (ready ? freeWorldFacts(deferredPlan) : null), [ready, deferredPlan]);

  const s1 = useScenario<WorldState>('world', WORLD_DEFAULTS);
  const world = s1.state;
  const h = useMemo(() => ourHistory(world), [world]);
  const r = useMemo(() => productionOnPath(plan, h), [plan, h]);
  const deferredWorld = useDeferredValue(world);
  const npvs = useMemo(() => fanNpvs(deferredPlan, deferredWorld), [deferredPlan, deferredWorld]);
  const solvedA = useMemo(() => cheapestPlanSolved(plan), [plan]);
  const y3 = yearProduction(r, 3);
  const best = cheapestTargetPlan();

  const s2 = useScenario<DeckState>('deck', DECK_DEFAULTS);
  const lines = useMemo(() => deckLines(deferredPlan), [deferredPlan]);
  const pumps = useMemo(() => valuations({ wellsPerYear: 0, waterflood: false, drillAbove: 0 }, [ourHistory()])[0], []);
  const lr = s2.state.longRun;
  const ourAt = npvAt(lines[0], lr);
  const spread75 = middleSpread(lines);
  const solvedB = luckSolved(deferredPlan, s2.state);
  const drop = lines[0].at75 - ourAt;

  const set = (patch: Partial<ProductionPlan>) => updateBusiness('production', patch);
  const L = PLAN_LIMITS;
  const invests = plan.waterflood || plan.wellsPerYear > 0;
  const kindness = pf.rank <= 10 ? 'its five years happened to be kind to producers' : pf.rank > 20 ? 'its five years were hard on producers' : 'its five years were ordinary ones';

  return (
    <LessonPage id="oil/7.1">
      <P>
        <a href={lessonHref('oil/6.5')}>Chapter 6</a> traded against other people’s assets; in this last chapter we own them. Our company holds the Northfield field
        and acreage in the Pinyon play from Chapter 2, the Corran refinery from Chapter 3 and the right to commit to space on the Kessler–Corran line from Chapter
        4, and it has a trading desk that has learned Chapter 6. Its plan is built one part per lesson — the fields in this one, then the refinery and the line,
        with a forecast and the hedges to finish — and it’s kept in this browser, so the next lesson picks it up where this one leaves it. Every lesson also works
        from the starting plan if you’d rather skip ahead.
      </P>
      <P>
        Nothing in this chapter is new machinery. The company’s upstream half is the Oil Field Planner of <a href={lessonHref('oil/2.5')}>Lesson 2.5</a>.
        Northfield’s wells, on pumps, make {bpd(f.pumpsY1)} in the coming year and decline to {bpd(f.pumpsY5)} by the fifth (
        <a href={lessonHref('oil/2.4')}>Lesson 2.4</a>); a {money(WATERFLOOD.capital)} waterflood would sweep more of the field’s oil toward its producers; and
        each standard Pinyon well from <a href={lessonHref('oil/2.3')}>Lesson 2.3</a> costs ${fmt(pinyonWellCost() / 1e6, 1)} million, peaks within weeks, declines steeply
        and breaks even at {dollars(WELL_BREAKEVEN)}. What changes is the <K c="price">price</K>. Lesson 2.5 valued everything at one flat price. Here each month
        earns the WTI of the simulated history of Chapter 5 — five years made by the physics of stocks, pipelines and shocks — and after those five years a{' '}
        <K c="price">long-run price</K> of ${LONG_RUN_WTI}, with the cash discounted at 10% as before. Every price is simulated.
      </P>
      <BusinessCard current="production" />
      <P>
        In the next demonstration, the first three controls are the plan, and they’re saved as your company’s: how many Pinyon wells to drill in each of the next
        five years, whether to fund the waterflood, and an optional rule that skips a year’s wells when WTI is low as the year begins. The other two change the world
        the prices come from: whether the producer group steadies prices with its spare capacity (<a href={lessonHref('oil/5.1')}>Lesson 5.1</a>), and how often
        supply outages strike (<a href={lessonHref('oil/5.5')}>Lesson 5.5</a>). The charts show the plan’s production, WTI along our history (a hollow red dot
        marks a year the drilling rule skips), and the plan’s value on thirty histories drawn from the same physics with different luck, as in{' '}
        <a href={lessonHref('oil/6.5')}>Lesson 6.5</a> — ours is the dark dot:
      </P>

      <Figure
        name="Oil Production Portfolio"
        onReset={() => {
          if (confirmResetPart('production')) s1.reset();
        }}
      >
        <Legend
          items={[
            { label: 'Northfield on pumps (Northfield Sour)', color: NF_COLOR },
            { label: 'Waterflood’s extra oil (Northfield Sour)', color: FLOOD_COLOR },
            { label: 'Pinyon wells (Pinyon Light)', color: RB_COLOR },
          ]}
        />
        <ProductionChart r={r} />
        <PriceChart r={r} h={h} plan={plan} />
        <NpvStrip npvs={npvs} />
        <Readouts
          items={[
            { label: <K c="money">capital</K>, value: money(r.capitalTotal) },
            { label: <K c="price">NPV on our history</K>, value: money(r.npv), tone: 'green' },
            { label: <K tone="violet">middle 80%</K>, value: moneyRange(quantile(npvs, 0.1), quantile(npvs, 0.9)), tone: 'violet' },
            { label: <K tone="orange">year-3 production</K>, value: bpd(y3), tone: 'orange' },
          ]}
        />
        <Slider
          label="Pinyon wells per year"
          tone="orange"
          value={plan.wellsPerYear}
          min={L.wellsPerYear[0]}
          max={L.wellsPerYear[1]}
          step={L.wellsPerYear[2]}
          onChange={(v) => set({ wellsPerYear: v })}
          display={`${plan.wellsPerYear} for five years`}
        />
        <Checkbox
          label={`Fund Northfield’s waterflood (${money(WATERFLOOD.capital)}, oil from next year)`}
          checked={plan.waterflood}
          onChange={(v) => set({ waterflood: v })}
        />
        <Slider
          label="Drill a year’s wells only if WTI is at least"
          tone="green"
          value={plan.drillAbove}
          min={L.drillAbove[0]}
          max={L.drillAbove[1]}
          step={L.drillAbove[2]}
          onChange={(v) => set({ drillAbove: v })}
          display={plan.drillAbove === 0 ? 'always drill' : `$${plan.drillAbove} as the year starts`}
        />
        <Segmented
          label="Producer group"
          value={world.group}
          onChange={(v) => s1.set({ group: v })}
          options={[
            { value: 'steady', label: 'Group steadies prices' },
            { value: 'free', label: 'Group doesn’t' },
          ]}
        />
        <Slider
          label="Supply outages"
          tone="red"
          value={world.shocks}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => s1.set({ shocks: Math.round(v * 10) / 10 })}
          display={`${fmt(world.shocks, 1)} a year`}
        />
      </Figure>

      <P>
        Your plan drills {fmt(pf.r.wellsDrilled)} wells{plan.waterflood ? ' and funds the waterflood' : ' and leaves the waterflood unfunded'}, for{' '}
        {money(pf.r.capitalTotal)} of capital; on our history it’s worth {money(pf.r.npv)}, and in year 3 it produces {bpd(pf.y3)}. Compare what each investment
        buys. For its {money(WATERFLOOD.capital)}, the waterflood brings up {fmt(f.floodBbl / 1e6, 1)} million barrels, about{' '}
        {dollars(WATERFLOOD.capital / f.floodBbl)} of capital a barrel; {PRODUCTION_DEFAULTS.wellsPerYear} wells a year cost {money(f.wellsCapital)} for{' '}
        {fmt(f.wellBbl / 1e6, 1)} million barrels, {dollars(f.wellsCapital / f.wellBbl)} a barrel. In the starting plan, which funds both, the waterflood makes{' '}
        {bpd(f.startY3flood)} of the {bpd(f.startY3)} of year 3. As <a href={lessonHref('oil/2.5')}>Lesson 2.5</a> found for one field, oil already found, piped
        and staffed comes cheapest. The wells add value too — at these prices every one of them pays — but they buy their barrels dearly, and quickly.
      </P>

      <Challenge
        id="a"
        question={`With no drilling rule, find the plan that brings production to at least ${fmt(PRODUCTION_TARGET)} barrels a day, averaged over year 3, for the least capital.`}
        solved={solvedA}
        status={
          plan.drillAbove !== 0
            ? 'Set the drilling rule to “always drill.”'
            : `This plan makes ${bpd(y3)} in year 3 for ${money(r.capitalTotal)} of capital.`
        }
        success={`Solved: ${best.plan.waterflood ? 'the waterflood and ' : ''}${best.plan.wellsPerYear} wells a year, ${money(best.capital)}, reaching ${bpd(
          y3,
        )}. No number of wells gets there without the waterflood: even ${L.wellsPerYear[1]} a year, at ${money(
          productionOnPath({ wellsPerYear: L.wellsPerYear[1], waterflood: false, drillAbove: 0 }, ourHistory()).capitalTotal,
        )}, make only ${bpd(yearProduction(productionOnPath({ wellsPerYear: L.wellsPerYear[1], waterflood: false, drillAbove: 0 }, ourHistory()), 3))}.`}
      />

      <H2>Five years of luck</H2>
      <P>
        Now look at the thirty dots. With the starting world, your plan’s <K c="price">value</K> runs from {money(pf.fanMin)} on the unluckiest history to{' '}
        {money(pf.fanMax)} on the luckiest, and the <K tone="violet">middle 80%</K>, which leaves three histories below it and three above, lies between{' '}
        {money(pf.fanP10)} and {money(pf.fanP90)}. Our history is the {ordinal(pf.rank)} of the thirty: {kindness}. That range comes from the shocks of Chapter 5.
        Switch the producer group off and the dots fan out and shift right
        {ff
          ? `: the middle 80% now runs from ${money(ff.p10)} to ${money(ff.p90)}, one history reaches ${money(ff.max)}, and the median rises from ${money(pf.fanP50)} to ${money(ff.p50)}, as WTI over the thirty histories averages ${dollars(ff.averageWti)} instead of ${dollars(f.averageWti)}`
          : ''}
        . Part of that is the shape of the price curve: price rises further when stocks run short than it falls when they build by as much (
        <a href={lessonHref('oil/5.1')}>Lesson 5.1</a>), so wilder swings in stocks lift the average price a producer sells at. Set the outages to zero instead, and
        the thirty values crowd together: without shocks, one history is much like another.
      </P>
      <P>
        The plan’s third control is the short-cycle option of Lesson 2.5: a well’s capital isn’t spent until the company decides to drill, so it can skip a year’s
        wells when prices are low. On our history the five years begin with WTI at {f.ourStarts.map((p, i) => (i === 4 ? `and ${dollars(p)}` : `${dollars(p)}, `)).join('')}.
        With the producer group steadying prices,{' '}
        {f.belowDefault === 0
          ? `none of the ${f.startsCount} year-starts in the thirty histories falls below the ${dollars(WELL_BREAKEVEN)} breakeven — the lowest is ${dollars(f.minStart)} — so a rule at the breakeven never binds`
          : `${f.belowDefault} of the ${f.startsCount} year-starts fall below the breakeven`}
        {plan.wellsPerYear > 0 && pf.gate65Skipped.length > 0
          ? `, and a stricter rule only skips wells that would have paid: at $65, your plan skips year ${pf.gate65Skipped.join(' and ')}’s wells and gives up ${money(pf.gate65Loss)}.`
          : ', and a stricter rule only skips wells that would have paid.'}{' '}
        {ff
          ? `Even with the group switched off, only ${ff.below} of the ${ff.starts} year-starts fall below the breakeven${
              ff.skipLosses.length > 0 && ff.skipLosses.every((v) => v < 0)
                ? `, and skipping those years’ wells would have lowered the plan’s value ${ff.skipLosses.length === 1 ? 'that time' : ff.skipLosses.length === 2 ? 'both times' : 'every time'}, because prices recovered while the wells would still have been young`
                : ''
            }.`
          : 'Even with the group switched off, year-starts below the breakeven are rare.'}{' '}
        In a world whose dips are this rare and this brief, the option to stop is worth little.
      </P>

      <H2>The price after the history</H2>
      <P>
        The history ends after five years; the plan’s oil doesn’t. {pct(pf.lateShare)} of the barrels your plan produces over twenty years come after year 5, most
        of them from {pf.lateFrom}, and they’re valued at the long-run assumption of ${LONG_RUN_WTI}. Companies value their fields against an assumed path of
        prices like this, often called a <b>price deck</b>. In the next demonstration, change the assumption. The green line is the plan’s value on our history;
        the shaded band holds the middle 80% of the thirty histories at each long-run price; the dashed line is Northfield on pumps alone, with no new investment:
      </P>

      <Figure name="Oil Production Portfolio · price deck" scenario={s2}>
        <DeckChart lines={lines} pumps={pumps} longRun={lr} />
        <Readouts
          items={[
            { label: <K c="price">NPV on our history</K>, value: money(ourAt), tone: 'green' },
            { label: <K c="price">each $1 of long-run price</K>, value: money1(lines[0].slope), tone: 'green' },
            { label: <K tone="violet">middle 80% at ${LONG_RUN_WTI}, width</K>, value: money1(spread75), tone: 'violet' },
            ...(solvedB ? [{ label: `change from $${LONG_RUN_WTI}`, value: `${drop > 0 ? '−' : drop < 0 ? '+' : ''}${money1(Math.abs(drop))}` }] : []),
          ]}
        />
        <Slider
          label="Long-run WTI after year 5"
          tone="green"
          value={lr}
          min={DECK_RANGE[0]}
          max={DECK_RANGE[1]}
          onChange={(v) => s2.set({ longRun: Math.round(v) })}
          display={`$${lr} a barrel`}
        />
        <Caption>
          {`At $${lr} after year 5, your plan is worth ${money(ourAt)} on our history, and Northfield on pumps alone ${money(npvAt(pumps, lr))}.`}
        </Caption>
      </Figure>

      <P>
        For your plan, each dollar of long-run price is worth {money1(pf.slope)}: the barrels after year 5, discounted to today. The middle 80% of the thirty
        histories, the whole effect of five years of simulated shocks between the unlucky and the lucky, is {money1(pf.spread)} wide at ${LONG_RUN_WTI}. Which
        moves the plan’s value more?
      </P>

      <Challenge
        id="b"
        question={`Estimate first, from those two readouts: how many dollars of long-run price is the middle 80%’s width worth? Then check it: set the highest whole-dollar long-run price at which your plan’s value on our history has fallen by at least that width from its value at $${LONG_RUN_WTI}.`}
        solved={solvedB}
        status={`Make your estimate before you move the slider. At $${lr}, your plan is worth ${money(ourAt)} on our history.`}
        success={`Solved: $${lr}. The middle 80% is worth ${dollars(spread75 / lines[0].slope)} of long-run price to this plan: at $${lr} its value has fallen ${money1(drop)}, at $${lr + 1} only ${money1(drop - lines[0].slope)}. The long-run assumption can move the plan’s value more than the history’s luck does.`}
      />

      <P>
        The whole middle 80% is worth only {dollars(pf.luck)} of long-run price. Five years of simulated shocks move the plan’s value less than a modest change in a
        number nobody can observe: what oil will fetch in year 12.
        {invests
          ? ' Notice also the gap between the green line and the dashed one. It is the value our investments add, and it widens as the long-run price rises, because the late barrels of the waterflood and the wells earn that price.'
          : ''}
      </P>

      <P>
        Our plan makes two crudes. Northfield{plan.waterflood ? ' and its waterflood produce' : ' produces'} Northfield Sour, {bpd(pf.y3sour)} in year 3 under your
        plan; the Pinyon wells produce Pinyon Light, {bpd(pf.y3light)}. All of it reaches Kessler, {fmt(KESSLER_CORRAN.lengthMiles)} miles from the coast. At
        the coast, the Corran refinery runs {fmt(CORRAN.capacity.cdu * 1000)} barrels a day, {CORRAN.capacity.cdu * 1000 > 2 * pf.peak ? 'more than twice' : 'well over'}{' '}
        what our fields make even at their peak, and buys most of its crude from others. The <a href={lessonHref('oil/7.2')}>next lesson</a> turns to the refinery:
        what to build there, and what it would earn.
      </P>
      <P>
        Before moving on, return to <FigRef to="Oil Production Portfolio">the first demonstration</FigRef> and leave the plan the way you want your company to run
        it: the refinery, the logistics and the hedges of the coming lessons will all be built around it.
      </P>
    </LessonPage>
  );
}
