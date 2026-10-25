import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Caption, Challenge, DataTable, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, niceDomain, pct, useScenario } from '../../../framework';
import {
  BUSINESS_DEFAULTS,
  FAN_SEEDS,
  PLAN_LIMITS,
  bestHedges,
  businessFan,
  exposures,
  refineryDay,
  runBusiness,
  type BestHedges,
  type BusinessResult,
  type CrackMix,
  type OilBusiness,
} from '../../../engines/oil/business';
import { TERMS } from '../../../engines/oil/economics';
import { CORRAN_DAY, CRACK_RATIOS, correlation, hedgeRefinery, type HedgeCrack } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams } from '../../../model/oil/history';
import { CORRAN } from '../../../model/oil/refinery';
import { BusinessCard } from '../shared/BusinessCard';
import { confirmResetPart, updateBusiness, useBusiness } from '../shared/business';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// The plan the demonstrations run: the reader's, or the starting plan the prose quotes. Either way
// the hedges are the reader's, since this lesson owns them.

export type PlanChoice = 'yours' | 'start';

export function planInUse(choice: PlanChoice, yours: OilBusiness): OilBusiness {
  return choice === 'start' ? { ...BUSINESS_DEFAULTS, hedges: yours.hedges } : yours;
}

/** Whether a plan's production, refinery and logistics are the starting plan's. */
export function sameAsStart(b: OilBusiness): boolean {
  const D = BUSINESS_DEFAULTS;
  return JSON.stringify([b.production, b.refinery, b.logistics]) === JSON.stringify([D.production, D.refinery, D.logistics]);
}

// ---------------------------------------------------------------------------
// The physical world (the second demonstration).

export type GroupMode = 'steady' | 'free';

export interface DriverState {
  /** Scale on demand's seasonal swings (1 = the course's seasons). */
  seasonality: number;
  /** Does the producer group steady prices with its spare capacity? */
  group: GroupMode;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
  /** A lasting widening of fuel oil's discount to crude after year 2, $/bbl. */
  fuelOil: number;
}

export const DRIVER_DEFAULTS: DriverState = {
  seasonality: HISTORY_DEFAULTS.seasonality,
  group: 'steady',
  rail: HISTORY_DEFAULTS.rail,
  fuelOil: 0,
};

export const FUEL_OIL_YEAR = 2;
export const SEASON_STEP = 0.1;

/** History parameters for a setting of the drivers (only those that differ from the course's). */
export function driverParams(d: DriverState): HistoryParams {
  const p: HistoryParams = {};
  if (d.seasonality !== HISTORY_DEFAULTS.seasonality) p.seasonality = d.seasonality;
  if (d.group === 'free') p.groupStabilizes = false;
  if (d.rail !== HISTORY_DEFAULTS.rail) p.rail = d.rail;
  if (d.fuelOil > 0) p.fuelOilShock = { year: FUEL_OIL_YEAR, size: d.fuelOil };
  return p;
}

/** Are the physical drivers at their starting values? */
export function physicalAtStart(d: DriverState): boolean {
  const s = DRIVER_DEFAULTS;
  return Math.abs(d.seasonality - s.seasonality) < 1e-9 && d.group === s.group && d.rail === s.rail && d.fuelOil === s.fuelOil;
}

// ---------------------------------------------------------------------------
// Hedges and what they leave.

/** The business with its hedges set. */
export function withHedges(b: OilBusiness, production: number, crack: number, mix: CrackMix = b.hedges.mix, bench: HedgeCrack = b.hedges.bench): OilBusiness {
  return { ...b, hedges: { ...b.hedges, production, crack, mix, bench } };
}

const NET_SHARE = (1 - TERMS.royalty) * (1 - TERMS.productionTax);
const QUARTER = 13;

/** Each segment's quarterly surprise against the plan made at the quarter's start, $ (they add up to the company's). */
export function segmentSurprises(b: OilBusiness, hp: HistoryParams = {}): { upstream: number[]; refinery: number[]; logistics: number[] } {
  const r = runBusiness(b, hp);
  const q = (actual: number[], plan: number[]) =>
    r.quarterSurprise.map((_, k) => actual.slice(k * QUARTER, (k + 1) * QUARTER).reduce((a, v, j) => a + v - plan[k * QUARTER + j], 0));
  return { upstream: q(r.upstream, r.plan.upstream), refinery: q(r.refinery, r.plan.refinery), logistics: q(r.logistics, r.plan.logistics) };
}

const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length));

/** The best single hedge when the other is left off: Lesson 6.4's minimum-variance ratio, for the whole company. */
export function bestSingle(b: OilBusiness, which: 'production' | 'crack', hp: HistoryParams = {}): { ratio: number; effectiveness: number } {
  const s = runBusiness(withHedges(b, 0, 0), hp).quarterSurprise;
  const one = runBusiness(which === 'production' ? withHedges(b, 1, 0) : withHedges(b, 0, 1), hp).quarterHedgedSurprise;
  const x = one.map((v, i) => v - s[i]);
  const dot = (a: number[], c: number[]) => a.reduce((acc, v, i) => acc + v * c[i], 0);
  const [lo, hi] = which === 'production' ? PLAN_LIMITS.production : PLAN_LIMITS.crack;
  const ratio = Math.min(hi, Math.max(lo, dot(x, x) > 0 ? -dot(x, s) / dot(x, x) : 0));
  const resid = s.map((v, i) => v + ratio * x[i]);
  return { ratio, effectiveness: 1 - dot(resid, resid) / dot(s, s) };
}

export const INSTRUMENTS: Array<{ mix: CrackMix; bench: HedgeCrack }> = (['corran', '2:1:1', '3:2:1'] as CrackMix[]).flatMap((mix) => (['brent', 'wti'] as HedgeCrack[]).map((bench) => ({ mix, bench })));

/** The most any hedges could remove: the best ratios for each crack and crude leg, and the best of those. */
export function bestAnyHedges(b: OilBusiness, hp: HistoryParams = {}): BestHedges & { mix: CrackMix; bench: HedgeCrack } {
  let best: BestHedges & { mix: CrackMix; bench: HedgeCrack } = { production: 0, crack: 0, effectiveness: -Infinity, mix: 'corran', bench: 'brent' };
  for (const ins of INSTRUMENTS) {
    const x = bestHedges(withHedges(b, 0, 0, ins.mix, ins.bench), hp);
    if (x.effectiveness > best.effectiveness) best = { ...x, ...ins };
  }
  return best;
}

/** The least risky pair in Corran's mix against Brent, the instrument challenge a uses. */
export function bestCorranPair(b: OilBusiness, hp: HistoryParams = {}): BestHedges {
  return bestHedges(withHedges(b, 0, 0, 'corran', 'brent'), hp);
}

export interface PhysicalRatios {
  /** Crude run and light products (gasoline, jet fuel, diesel), b/d, and their ratio. */
  runs: number;
  light: number;
  lightShare: number;
  /**
   * Net production (after royalty and tax) on average over the five years, b/d; the refinery's
   * short crude position in barrels a day (its loss for each $1 on crude, as year 1 begins); and the
   * share of net production that position leaves unoffset.
   */
  meanNet: number;
  refShort: number;
  production: number;
}

/** The physical facts challenge a predicts the two ratios from. */
export function physicalRatios(b: OilBusiness): PhysicalRatios {
  const day = refineryDay(b.refinery);
  const light = (day.products.gasoline + day.products.jet + day.products.diesel) * 1000;
  const r = runBusiness(withHedges(b, 0, 0));
  const meanNet = (r.production.reduce((a, v) => a + v, 0) / r.production.length) * NET_SHARE;
  const refShort = -refineryCrudeExposure(b, 0);
  return { runs: day.runs * 1000, light, lightShare: light / (day.runs * 1000), meanNet, refShort, production: Math.max(0, 1 - refShort / meanNet) };
}

/** Challenge a's target: 85% of the variance, or a little under the best Corran's-mix pair if that is less. */
export const TARGET_CAP = 0.85;
export function hedgeTarget(bestEffectiveness: number): number {
  return Math.min(TARGET_CAP, Math.floor((bestEffectiveness - 0.03) * 20) / 20);
}

/**
 * Challenge a: hedges in Corran's mix against Brent that remove at least the target share of the
 * variance (any value the readout shows as the target or more). The reader predicts the two ratios
 * first, from the light-product share and the refinery's short crude position.
 */
export function hedgesSolved(b: OilBusiness): boolean {
  if (b.hedges.mix !== 'corran' || b.hedges.bench !== 'brent') return false;
  return runBusiness(b).effectiveness >= hedgeTarget(bestCorranPair(b).effectiveness) - 0.005;
}

/** Challenge b: how far the best possible hedges must fall, in shares of variance. */
export const HARDER_DROP = 0.05;

/** Challenge b: a physical world in which even the best hedges remove at least five points less than in the starting world. */
export function harderWorldSolved(b: OilBusiness, d: DriverState): boolean {
  if (physicalAtStart(d)) return false;
  return bestAnyHedges(b, driverParams(d)).effectiveness <= bestAnyHedges(b).effectiveness - HARDER_DROP + 1e-12;
}

export interface Exposure {
  crude: number;
  crack: number;
  basis: number;
}

/**
 * The company's exposures in a week, $ a day for a $1/bbl move (crude: every crude-linked price;
 * crack: gasoline and diesel against crude; basis: WTI at Kessler falling against the coast),
 * before and after its hedges.
 */
export function hedgedExposures(b: OilBusiness, week: number, hp: HistoryParams = {}): { before: Exposure; after: Exposure } {
  const before = exposures(b, week, hp);
  const r = runBusiness(b, hp);
  const net = r.production[Math.min(week, r.production.length - 1)] * NET_SHARE;
  const runs = r.runs * 1000;
  const h = b.hedges;
  return {
    before,
    after: {
      crude: before.crude - h.production * net,
      crack: before.crack - h.crack * runs,
      basis: before.basis + h.production * net - (h.bench === 'wti' ? h.crack * runs : 0),
    },
  };
}

/** The refinery's own share of the crude exposure (what's left after taking upstream's long position out), $ a day per $1. */
export function refineryCrudeExposure(b: OilBusiness, week: number, hp: HistoryParams = {}): number {
  const r = runBusiness(b, hp);
  return exposures(b, week, hp).crude - r.production[Math.min(week, r.production.length - 1)] * NET_SHARE;
}

export interface HistoriesResult {
  /** Each history's share of variance removed and worst quarterly surprise unhedged and hedged, $ (FAN_SEEDS order: the course's first). */
  effectiveness: number[];
  worstUnhedged: number[];
  worstHedged: number[];
  /** P10 of the worst quarterly surprise across histories, unhedged and hedged, $. */
  p10Unhedged: number;
  p10Hedged: number;
}

/** The hedges across the 30 histories of the starting world (Lesson 6.5's out-of-sample test). */
export function acrossHistories(b: OilBusiness): HistoriesResult {
  const un = businessFan(withHedges(b, 0, 0));
  const he = businessFan(b);
  const effectiveness = FAN_SEEDS.map((seed) => runBusiness(b, { seed }).effectiveness);
  const worstUnhedged = FAN_SEEDS.map((seed) => Math.min(...runBusiness(withHedges(b, 0, 0), { seed }).quarterSurprise));
  return { effectiveness, worstUnhedged, worstHedged: he.worstSurprises, p10Unhedged: un.worstSurprise.p10, p10Hedged: he.worstSurprise.p10 };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, c) => a - c);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The hedges the third demonstration starts with: near the starting plan's best, on the grid. */
export const EXAMPLE_HEDGES = { production: 0.5, crack: 0.75 };

/** A refinery the prose suggests building in Lesson 7.2 to test the crack ratio: the crude unit alone at its largest. */
export const BIG_CRUDE_UNIT = { ...CORRAN, capacity: { ...CORRAN.capacity, cdu: PLAN_LIMITS.capacity.cdu[1] } };
/** The firm space the prose uses to show a WTI crack paying off. */
export const FIRM_EXAMPLE = 100;

/** Numbers quoted in the prose, for the starting plan of Lessons 7.1–7.3. */
export function lessonFacts() {
  const D = BUSINESS_DEFAULTS;
  const base = runBusiness(withHedges(D, 0, 0));
  const all = runBusiness(withHedges(D, 1, 0));
  const seg = segmentSurprises(withHedges(D, 0, 0));
  const worstIdx = base.quarterSurprise.indexOf(Math.min(...base.quarterSurprise));
  const phys = physicalRatios(D);
  const best = bestCorranPair(D);
  const example = runBusiness(withHedges(D, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, 'corran', 'brent'));
  const hist = acrossHistories(withHedges(D, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, 'corran', 'brent'));
  const bests = FAN_SEEDS.map((seed) => bestCorranPair(D, { seed }));
  const big = { ...D, refinery: BIG_CRUDE_UNIT };
  const firm = { ...D, logistics: { firmSpace: FIRM_EXAMPLE } };
  const bigDay = refineryDay(BIG_CRUDE_UNIT);
  const day = refineryDay(D.refinery);
  return {
    base,
    worstIdx,
    all,
    corr: correlation(seg.upstream, seg.refinery),
    rmsUp: rms(seg.upstream),
    rmsRef: rms(seg.refinery),
    exp1: exposures(D, 0),
    exp4: exposures(D, 156),
    prod1: base.production[0],
    prod4: base.production[156],
    prodPeak: Math.max(...base.production),
    prodPeakWeek: base.production.indexOf(Math.max(...base.production)),
    phys,
    refShort: phys.refShort,
    meanNet: phys.meanNet,
    prodOnly: bestSingle(D, 'production'),
    crackOnly: bestSingle(D, 'crack'),
    best,
    example,
    standard: bestHedges(withHedges(D, 0, 0, '3:2:1', 'brent')),
    twoOne: bestHedges(withHedges(D, 0, 0, '2:1:1', 'brent')),
    wti: bestHedges(withHedges(D, 0, 0, 'corran', 'wti')),
    /** Lesson 6.4's best ratio for Corran alone, in its own mix against Brent. */
    corranAlone: hedgeRefinery(oilHistory(), 0, 'brent', CRACK_RATIOS.corran, CORRAN_DAY, 'seasonal').bestRatio,
    bigPhys: physicalRatios(big),
    bigBest: bestCorranPair(big),
    /** The bigger crude unit's extra runs, and how much more fuel oil and light product it makes, kb/d. */
    bigExtraRuns: bigDay.runs - day.runs,
    bigExtraFuel: bigDay.products.hsfo - day.products.hsfo,
    bigExtraLight: bigDay.products.gasoline + bigDay.products.jet + bigDay.products.diesel - (day.products.gasoline + day.products.jet + day.products.diesel),
    firmBrent: bestHedges(withHedges(firm, 0, 0, 'corran', 'brent')),
    firmWti: bestHedges(withHedges(firm, 0, 0, 'corran', 'wti')),
    start: bestAnyHedges(D),
    noSeasons: bestAnyHedges(D, { seasonality: 0 }),
    fuel20: bestAnyHedges(D, { fuelOilShock: { year: FUEL_OIL_YEAR, size: 20 } }),
    noRail: bestAnyHedges(D, { rail: 0 }),
    free: bestAnyHedges(D, { groupStabilizes: false }),
    free0: runBusiness(withHedges(D, 0, 0), { groupStabilizes: false }),
    hist,
    histMedian: median(hist.effectiveness),
    histLow: Math.min(...hist.effectiveness),
    histHigh: Math.max(...hist.effectiveness),
    bestProdLo: Math.min(...bests.map((x) => x.production)),
    bestProdHi: Math.max(...bests.map((x) => x.production)),
    bestCrackLo: Math.min(...bests.map((x) => x.crack)),
    bestCrackHi: Math.max(...bests.map((x) => x.crack)),
    /** In the middle history, how much less the example hedges remove than that history's own best pair. */
    gapMedian: median(bests.map((x, i) => x.effectiveness - hist.effectiveness[i])),
  };
}

// ---------------------------------------------------------------------------
// Formatting.

const mUsd = (v: number, d = 1) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, d)} million`;
const mShort = (v: number, d = 1) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, d)}M`;
const bUsd = (v: number) => `$${fmt(v / 1e9, 2)} billion`;
const kDay = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${fmt(Math.abs(v) / 1000, 1)}k`;
const kAbs = (v: number) => `$${fmt(Math.abs(v) / 1000, 1)}k`;
const pct1 = (v: number) => pct(v, 1);
const MIX_LABEL: Record<CrackMix, string> = { corran: 'Corran’s mix', '2:1:1': '2:1:1', '3:2:1': '3:2:1' };
const BENCH_LABEL: Record<HedgeCrack, string> = { brent: 'Brent', wti: 'WTI' };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Barrels to the nearest hundred. */
const bbl = (v: number) => fmt(Math.round(v / 100) * 100);

const YEAR_TICKS = [2.5, 6.5, 10.5, 14.5, 18.5];

function SurpriseBars({ r, label }: { r: BusinessResult; label: string }) {
  const un = r.quarterSurprise.map((v) => v / 1e6);
  const he = r.quarterHedgedSurprise.map((v) => v / 1e6);
  const [lo, hi] = niceDomain(Math.min(0, ...un, ...he), Math.max(0, ...un, ...he), 4);
  const n = un.length;
  return (
    <XYChart
      ariaLabel={label}
      height={200}
      x={[0.5, n + 0.5]}
      y={[lo, hi]}
      xTicks={YEAR_TICKS}
      xFormat={(v) => `year ${Math.round((v + 1.5) / 4)}`}
      yFormat={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v))}M`}
      yLabel="Quarter’s cash against its plan, $ million"
    >
      {(sx, sy) => {
        const bw = (sx(1.5) - sx(0.5)) * 0.36;
        return (
          <g>
            {un.map((v, q) => (
              <rect key={'u' + q} x={sx(q + 1) - bw} width={bw} y={Math.min(sy(v), sy(0))} height={Math.abs(sy(v) - sy(0))} fill={GRAPHIC.gray} opacity={0.75} />
            ))}
            {he.map((v, q) => (
              <rect key={'h' + q} x={sx(q + 1)} width={bw} y={Math.min(sy(v), sy(0))} height={Math.abs(sy(v) - sy(0))} fill={GRAPHIC.violet} />
            ))}
          </g>
        );
      }}
    </XYChart>
  );
}

interface ExpRow {
  id: string;
  label: string;
  y1: number;
  y1h: number;
  y4: number;
  y4h: number;
}

type HedgeSet = 'example' | 'yours';

// ---------------------------------------------------------------------------

export default function Lesson() {
  const F = useMemo(() => lessonFacts(), []);
  const yours = useBusiness();
  const hg = yours.hedges;

  // The plan from Lessons 7.1–7.3 the demonstrations run: one choice, mirrored in each figure.
  const [choice, setChoice] = useState<PlanChoice>('yours');
  const plan = useMemo(() => planInUse(choice, yours), [choice, yours]);
  const differs = choice === 'yours' && !sameAsStart(yours);
  const planSwitch = (
    <Segmented<PlanChoice>
      label="Plan from Lessons 7.1–7.3"
      value={choice}
      onChange={setChoice}
      options={[
        { value: 'yours', label: 'Your plan' },
        { value: 'start', label: 'Starting plan' },
      ]}
    />
  );
  const planNote = differs ? ' Your plan from Lessons 7.1–7.3 differs from the starting plan the text quotes; choose the starting plan to compare.' : '';

  // The plan without hedges: what the physical facts, the best pairs and the worlds depend on.
  const deferredPlan = useDeferredValue(plan);
  const baseKey = JSON.stringify([deferredPlan.production, deferredPlan.refinery, deferredPlan.logistics]);
  const base = useMemo(() => {
    const [production, refinery, logistics] = JSON.parse(baseKey) as [OilBusiness['production'], OilBusiness['refinery'], OilBusiness['logistics']];
    const b: OilBusiness = { production, refinery, logistics, hedges: { ...BUSINESS_DEFAULTS.hedges } };
    return b;
  }, [baseKey]);
  const ownRefinery = JSON.stringify(base.refinery) !== JSON.stringify(CORRAN);
  const phys = useMemo(() => physicalRatios(base), [base]);
  const bestPair = useMemo(() => bestCorranPair(base), [base]);
  const target = hedgeTarget(bestPair.effectiveness);

  // ---- Figure 1: the hedges.
  const r = useMemo(() => runBusiness(plan), [plan]);
  const expo = useMemo(() => ({ y1: hedgedExposures(plan, 0), y4: hedgedExposures(plan, 156) }), [plan]);
  const solvedA = useMemo(() => hedgesSolved(plan), [plan]);
  // Once challenge a is solved, the first demonstration's caption gives the best pair beside the physical facts.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (solvedA) setRevealed(true);
  }, [solvedA]);
  const worstU = Math.min(...r.quarterSurprise);
  const worstH = Math.min(...r.quarterHedgedSurprise);
  const hedged = hg.production > 0 || hg.crack > 0;
  const net0 = r.production[0] * NET_SHARE;
  const instrument = `${MIX_LABEL[hg.mix]} crack against ${BENCH_LABEL[hg.bench]}`;
  const set = (patch: Partial<OilBusiness['hedges']>) => updateBusiness('hedges', patch);
  const rows: ExpRow[] = [
    { id: 'crude', label: 'Crude, all grades', y1: expo.y1.before.crude, y1h: expo.y1.after.crude, y4: expo.y4.before.crude, y4h: expo.y4.after.crude },
    { id: 'crack', label: 'Crack (products over crude)', y1: expo.y1.before.crack, y1h: expo.y1.after.crack, y4: expo.y4.before.crack, y4h: expo.y4.after.crack },
    { id: 'basis', label: 'Coast over Kessler', y1: expo.y1.before.basis, y1h: expo.y1.after.basis, y4: expo.y4.before.basis, y4h: expo.y4.after.basis },
  ];
  const corranBrent = hg.mix === 'corran' && hg.bench === 'brent';

  // ---- Figure 2: the physical world, and the best hedges in it.
  const s2 = useScenario<DriverState>('world', DRIVER_DEFAULTS);
  const d = s2.state;
  const deferredD = useDeferredValue(d);
  const hp2 = useMemo(() => driverParams(deferredD), [deferredD]);
  const bestHere = useMemo(() => bestAnyHedges(base, hp2), [base, hp2]);
  const bestStart = useMemo(() => bestAnyHedges(base), [base]);
  const rWorld = useMemo(() => runBusiness(withHedges(base, bestHere.production, bestHere.crack, bestHere.mix, bestHere.bench), hp2), [base, bestHere, hp2]);
  const solvedB = useMemo(() => harderWorldSolved(base, deferredD), [base, deferredD]);
  const worldChanged = !physicalAtStart(d);

  // ---- Figure 3: hedges across the thirty histories of the starting world.
  const s3 = useScenario<{ hedges: HedgeSet }>('histories', { hedges: 'example' });
  const histPlan = useMemo(
    () => (s3.state.hedges === 'example' ? withHedges(base, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, 'corran', 'brent') : { ...base, hedges: hg }),
    [s3.state.hedges, base, hg],
  );
  const deferredHistPlan = useDeferredValue(histPlan);
  const hist = useMemo(() => acrossHistories(deferredHistPlan), [deferredHistPlan]);
  const histHedged = histPlan.hedges.production > 0 || histPlan.hedges.crack > 0;
  const histMed = median(hist.effectiveness);
  const histLow = Math.min(...hist.effectiveness);
  const histLowIdx = hist.effectiveness.indexOf(histLow);
  const worstVals = [...hist.worstUnhedged, ...hist.worstHedged].map((v) => v / 1e6);
  const [wLo, wHi] = niceDomain(Math.min(...worstVals), Math.max(0, ...worstVals), 4);
  const effVals = hist.effectiveness.map((v) => v * 100);
  const [eLo] = niceDomain(Math.min(0, ...effVals), 100, 4);
  const histHedgeText = `${pct(histPlan.hedges.production)} of net production and ${fmt(histPlan.hedges.crack, 2)} of runs in ${MIX_LABEL[histPlan.hedges.mix]} against ${BENCH_LABEL[histPlan.hedges.bench]}`;

  const B = F.base;
  const ex = F.example;

  return (
    <LessonPage id="oil/7.5">
      <P>
        <a href={lessonHref('oil/7.4')}>Lesson 7.4</a> looked at what our company can forecast and what it can’t. The seasons in the crack, a pipeline’s opening
        date and a basin’s growth can be planned around; where crude will be a quarter from now can’t. This lesson does what companies do with the part
        they can’t forecast: hedge it. Everything the chapter has built — the wells of <a href={lessonHref('oil/7.1')}>Lesson 7.1</a>, the refinery of{' '}
        <a href={lessonHref('oil/7.2')}>Lesson 7.2</a>, the firm space of <a href={lessonHref('oil/7.3')}>Lesson 7.3</a> — runs together through the five
        simulated years. Every price is simulated.
      </P>
      <P>
        We measure risk as <a href={lessonHref('oil/6.4')}>Lesson 6.4</a> did for Corran, but for the whole company. At the start of each quarter, the company plans
        each of the coming weeks at its <K c="price">seasonal forward</K> prices: each price as it stands that day, plus the change Lesson 6.3’s calendar expects by
        that week, as a futures curve that carries the seasons would price it. Its <K c="price">surprise</K> is what it earned less that plan. With the starting plan
        of Lessons 7.1–7.3, the company makes {bUsd(B.sums.total)} of operating cash in five years. Its typical quarterly surprise, measured by its root-mean-square
        size, is {mUsd(B.rmsSurprise)}, and the worst, in quarter {F.worstIdx + 1}, is {mUsd(Math.min(...B.quarterSurprise))}. Two hedges are available, and both
        are <K tone="violet">swaps</K>, contracts settled in cash with no oil changing hands, like Lesson 6.4’s crack hedge: at the start of each quarter the
        company fixes each week’s price at its seasonal forward, and each week, on every barrel covered, it receives the fixed price less that week’s price (paying
        when the price is higher). The <K tone="violet">production hedge</K> fixes WTI on a share of the company’s net production (what is left after royalty and
        tax). The <K tone="violet">crack hedge</K> fixes the crack on a share of the refinery’s crude runs, in the mix and against the crude of our choice.
      </P>
      <BusinessCard current="hedges" />
      <P>
        In the next demonstration, the bars are the twenty quarters’ surprises, gray unhedged and violet hedged. The hedges you set here are kept as part of your
        business. The first control chooses which plan from Lessons 7.1–7.3 the demonstrations run: yours, or the starting plan the text quotes:
      </P>

      <Figure
        name="Integrated Oil Trader"
        onReset={() => {
          if (confirmResetPart('hedges')) setChoice('yours');
        }}
      >
        {planSwitch}
        <SurpriseBars
          r={r}
          label={`The company’s quarterly surprise over five simulated years: ${hedged ? `typical size ${mShort(r.rmsSurprise)} unhedged and ${mShort(r.rmsHedged)} with ${pct(hg.production)} of net production and ${fmt(hg.crack, 2)} of runs hedged in ${instrument}; worst quarter ${mShort(worstU)} unhedged and ${mShort(worstH)} hedged` : `no hedges in place; typical size ${mShort(r.rmsSurprise)}, worst quarter ${mShort(worstU)}`}.`}
        />
        <Legend
          items={[
            { label: 'Unhedged', color: GRAPHIC.gray },
            { label: 'Hedged', color: GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="price">five-year operating cash</K>, value: bUsd(r.sums.total), tone: 'green' },
            { label: 'typical quarterly surprise', value: `${mShort(r.rmsSurprise)} → ${mShort(r.rmsHedged)}`, tone: 'green' },
            { label: <K tone="violet">variance removed</K>, value: pct(r.effectiveness), tone: r.effectiveness < 0 ? 'red' : 'violet' },
            { label: 'worst quarter', value: `${mShort(worstU)} → ${mShort(worstH)}`, tone: 'green' },
          ]}
        />
        <Slider
          label="Production hedge"
          tone="violet"
          value={hg.production}
          min={0}
          max={PLAN_LIMITS.production[1]}
          step={PLAN_LIMITS.production[2]}
          onChange={(v) => set({ production: r2(v) })}
          display={`${pct(hg.production)} of net output · ${fmt((hg.production * net0) / 1000, 1)} kb/d now`}
        />
        <Slider
          label="Crack hedge"
          tone="violet"
          value={hg.crack}
          min={0}
          max={PLAN_LIMITS.crack[1]}
          step={PLAN_LIMITS.crack[2]}
          onChange={(v) => set({ crack: r2(v) })}
          display={`${fmt(hg.crack, 2)} of runs · ${fmt(hg.crack * r.runs)} kb/d`}
        />
        <Segmented
          label="Crack sold"
          value={hg.mix}
          onChange={(v) => set({ mix: v })}
          options={[
            { value: 'corran' as const, label: 'Corran’s mix' },
            { value: '2:1:1' as const, label: '2:1:1' },
            { value: '3:2:1' as const, label: '3:2:1' },
          ]}
        />
        <Segmented
          label="Crude leg"
          value={hg.bench}
          onChange={(v) => set({ bench: v })}
          options={[
            { value: 'brent' as const, label: 'Brent (the coast)' },
            { value: 'wti' as const, label: 'WTI (Kessler)' },
          ]}
        />
        <DataTable<ExpRow>
          caption="The company’s exposure: change in daily cash for a $1 a barrel move, before and after hedges"
          columns={[
            { label: '$ a day per $1', cell: (x) => x.label },
            { label: 'year 1 start', cell: (x) => kDay(x.y1), align: 'right' },
            { label: 'hedged', cell: (x) => kDay(x.y1h), align: 'right' },
            { label: 'year 4 start', cell: (x) => kDay(x.y4), align: 'right' },
            { label: 'hedged', cell: (x) => kDay(x.y4h), align: 'right' },
          ]}
          rows={rows}
          rowKey={(x) => x.id}
        />
        <Caption>
          {hedged ? `Selling ${instrument} on ${fmt(hg.crack * r.runs)} kb/d and WTI on ${pct(hg.production)} of net output, the company` : 'Unhedged, the company'} carries a
          typical quarterly surprise of {mShort(r.rmsHedged)}.
          {revealed
            ? ` For this plan the least risky pair in Corran’s mix against Brent is ${fmt(bestPair.production, 2)} of net production and ${fmt(bestPair.crack, 2)} of runs, removing ${pct(bestPair.effectiveness)}; its refinery’s light-product share is ${fmt(phys.lightShare, 2)}, and the share of net output its short crude position leaves unoffset ${fmt(phys.production, 2)}.`
            : ''}
          {planNote}
        </Caption>
      </Figure>

      <P>
        Start with what each business would do on its own: the producer sells all its oil forward. Set the production hedge to 100% with no crack hedge, and the
        typical surprise grows from {mUsd(B.rmsSurprise)} to {mUsd(F.all.rmsHedged)}; the worst quarter falls to {mUsd(Math.min(...F.all.quarterHedgedSurprise))}.
        The company was partly hedged already. Its refinery is short crude: coke sells at a price of its own, LPG at less than half the price of crude, and
        Coldwater Heavy, tied to fuel oil (<a href={lessonHref('oil/4.5')}>Lesson 4.5</a>), rises a little more than a dollar with every dollar on crude. So each
        dollar on crude takes {kAbs(F.refShort)} a day from Corran’s margin, while upstream gains on every barrel it sells. Over a quarter, the two
        segments’ surprises have a correlation of {fmt(F.corr, 2)}: a <K tone="violet">natural hedge</K>. Hedging upstream alone removes one side of it and leaves
        the refinery’s side exposed.
      </P>
      <P>
        With the starting plan, the exposure table shows the balance shifting. As year 1 begins, the company pumps about {bbl(F.prod1)} barrels a day and is net
        short crude, losing {kAbs(F.exp1.crude)} a day for each dollar crude rises. Three years on, as year 4 begins, the waterflood and the new wells have brought
        output to about {bbl(F.prod4)} barrels a day (it peaked at about {bbl(F.prodPeak)} late in year 3), and the company gains {kAbs(F.exp4.crude)}. One ratio has
        to serve both. On its own, the production hedge does best at {fmt(F.prodOnly.ratio, 2)}, removing only {pct(F.prodOnly.effectiveness)}; the crack hedge
        alone does best at {fmt(F.crackOnly.ratio, 2)}, removing {pct(F.crackOnly.effectiveness)}. Together they can do far better, and the plant and the wells say
        roughly where.
      </P>

      <Challenge
        id="a"
        figure="Integrated Oil Trader"
        question={`Predict both ratios before you touch the sliders. The crack hedge has the light products to cover: of the ${bbl(phys.runs)} barrels a day ${ownRefinery ? 'your refinery' : 'Corran'} runs, ${bbl(phys.light)} come out as gasoline, jet fuel and diesel. The production hedge has only what the refinery doesn’t already offset: the fields sell ${bbl(phys.meanNet)} net barrels a day on average, and the refinery’s short crude position is worth about ${bbl(phys.refShort)} of them. Set your two ratios, in Corran’s mix against Brent, and check that together they remove at least ${pct(target)} of the variance.`}
        solved={solvedA}
        status={
          !corranBrent
            ? 'Sell Corran’s mix against Brent.'
            : `Your hedges ${r.effectiveness >= 0 ? `remove ${pct(r.effectiveness)} of the variance` : `add ${pct(-r.effectiveness)} to the variance`} of the quarterly surprise; the target is ${pct(target)}.`
        }
        success={`Solved: ${pct(hg.production)} of net production and ${fmt(hg.crack, 2)} of runs remove ${pct(r.effectiveness)}. The least risky pair is ${fmt(bestPair.production, 2)} and ${fmt(bestPair.crack, 2)}, removing ${pct(bestPair.effectiveness)}: close to the light-product share, ${fmt(phys.lightShare, 2)}, and to the share of net output the refinery doesn’t offset, ${fmt(phys.production, 2)}.`}
      />

      <H2>Hedging one company</H2>
      <P>
        With the starting plan, the least risky pair sells WTI on {fmt(F.best.production, 2)} of net production and Corran’s mix against Brent on{' '}
        {fmt(F.best.crack, 2)} of runs, and removes {pct(F.best.effectiveness)} of the variance — far more than either hedge removes alone. Both ratios are the
        physical facts the challenge started from. The crack ratio is almost exactly the light-product share, {fmt(F.phys.lightShare, 2)} (
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a>): the hedge covers the crack on every barrel of light product and leaves the rest of the barrel — coke, LPG,
        fuel oil — to the refinery. The production ratio is close to one less the refinery’s short position over net production, 1 − {bbl(F.refShort)}/
        {bbl(F.meanNet)} = {fmt(F.phys.production, 2)}: {pct(F.refShort / F.meanNet)} of what the fields sell is already offset inside the company, and the hedge
        sells forward the rest.
      </P>
      <P>
        Test the first on a refinery of your own. In <a href={lessonHref('oil/7.2')}>Lesson 7.2</a>, take the crude unit alone to{' '}
        {fmt(BIG_CRUDE_UNIT.capacity.cdu)} kb/d: with no more conversion or treating behind it, the extra {fmt(F.bigExtraRuns)} kb/d of crude yields only{' '}
        {fmt(F.bigExtraLight, 1)} kb/d more light product, and the light-product share falls to {fmt(F.bigPhys.lightShare, 2)}. Come back with your plan chosen in{' '}
        <FigRef to="Integrated Oil Trader">the first demonstration</FigRef>: the challenge’s facts and, once it’s solved, the caption follow your refinery, and the
        best crack ratio falls with the share, to {fmt(F.bigBest.crack, 2)}.
      </P>
      <P>
        The instrument matters more here than it did for Corran alone. In Lesson 6.4, Corran’s own best hedge ran on {fmt(F.corranAlone, 2)} of its runs, more than its
        light-product share, so the crack’s crude leg also covered the refinery’s short crude, and the mix hardly mattered. In the company, the fields already cover
        that crude, the crack is left with the light products alone, and it covers them best in the proportions Corran makes them, more diesel and jet fuel than
        gasoline: with the 3:2:1, two-thirds gasoline, the best pair removes only {pct(F.standard.effectiveness)}, and with the 2:1:1 {pct(F.twoOne.effectiveness)}.
        Corran’s mix against WTI, inland, reaches only {pct(F.wti.effectiveness)}: the company buys its crude at the coast, and a WTI crack adds the swings of the
        Kessler–Corran spread (<a href={lessonHref('oil/5.2')}>Lesson 5.2</a>). Firm space, long that spread (<a href={lessonHref('oil/6.2')}>Lesson 6.2</a>),
        turns it around: with {FIRM_EXAMPLE} kb/d of it, the WTI crack removes {pct(F.firmWti.effectiveness)} and the Brent one only {pct(F.firmBrent.effectiveness)}.
      </P>

      <H2>What no hedge reaches</H2>
      <P>
        The best hedges leave {pct(1 - F.best.effectiveness)} of the variance behind, and the physical world decides how much. In the next demonstration, change the
        world the company runs in: the seasonal swing in demand, the rail from Kessler to the coast, a lasting widening of fuel oil’s discount after year{' '}
        {FUEL_OIL_YEAR}, and whether the producer group steadies prices. For each world it finds the best hedges afresh, any ratios and any crack, and the bars
        compare the surprise unhedged (gray) and with them (violet):
      </P>

      <Figure name="Integrated Oil Trader · physical world" scenario={s2}>
        {planSwitch}
        <SurpriseBars
          r={rWorld}
          label={`The company’s quarterly surprise in this world: typical size ${mShort(rWorld.rmsSurprise)} unhedged and ${mShort(rWorld.rmsHedged)} with the best hedges, which remove ${pct1(bestHere.effectiveness)} of the variance, against ${pct1(bestStart.effectiveness)} in the starting world.`}
        />
        <Legend
          items={[
            { label: 'Unhedged', color: GRAPHIC.gray },
            { label: 'With the best hedges for this world', color: GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: <K tone="violet">best hedges remove, here</K>, value: pct1(bestHere.effectiveness), tone: 'violet' },
            { label: <K tone="violet">in the starting world</K>, value: pct1(bestStart.effectiveness), tone: 'violet' },
            { label: 'typical quarterly surprise', value: `${mShort(rWorld.rmsSurprise)} → ${mShort(rWorld.rmsHedged)}`, tone: 'green' },
          ]}
        />
        <Slider
          label="Seasonal swing in demand"
          tone="orange"
          value={d.seasonality}
          min={0}
          max={2}
          step={SEASON_STEP}
          onChange={(v) => s2.set({ seasonality: Math.round(v * 10) / 10 })}
          display={d.seasonality === 0 ? 'none' : `${fmt(d.seasonality, 1)}× normal`}
        />
        <Slider label="Rail to the coast" tone="orange" value={d.rail} min={0} max={300} step={25} onChange={(v) => s2.set({ rail: v })} display={`${d.rail} kb/d`} />
        <Slider
          label={`Fuel oil’s discount, after year ${FUEL_OIL_YEAR}`}
          tone="gold"
          value={d.fuelOil}
          min={0}
          max={20}
          step={1}
          onChange={(v) => s2.set({ fuelOil: v })}
          display={d.fuelOil === 0 ? 'no shift' : `$${d.fuelOil} wider`}
        />
        <Segmented
          label="Producer group"
          value={d.group}
          onChange={(v) => s2.set({ group: v })}
          options={[
            { value: 'steady' as const, label: 'Group steadies prices' },
            { value: 'free' as const, label: 'Group doesn’t' },
          ]}
        />
        <Caption>
          In this world the least risky instrument is {MIX_LABEL[bestHere.mix]} against {BENCH_LABEL[bestHere.bench]}. The world here doesn’t change the hedges you set
          in the first demonstration.{planNote}
        </Caption>
      </Figure>

      <Challenge
        id="b"
        question={`Predict first: which of the four changes in this demonstration will cut into what even the best hedges can remove, and which won’t? Think about what each swap trades — WTI, and a crack against Brent — and what else the company’s cash depends on. Then find a world in which the best hedges remove at least ${fmt(HARDER_DROP * 100)} points less of the variance than in the starting world.`}
        solved={solvedB}
        status={
          !worldChanged
            ? `In the starting world the best hedges remove ${pct1(bestStart.effectiveness)}. Make your prediction, then change the world.`
            : `Here the best hedges remove ${pct1(bestHere.effectiveness)}, against ${pct1(bestStart.effectiveness)} in the starting world.`
        }
        success={`Solved: here the best hedges remove ${pct1(bestHere.effectiveness)}, against ${pct1(bestStart.effectiveness)} in the starting world.${d.fuelOil > 0 ? ' Neither swap trades fuel oil, which now moves Coldwater Heavy’s price on its own.' : ''}${d.rail < DRIVER_DEFAULTS.rail ? ' Neither trades the coast’s price against Kessler’s, which swings harder when there is less rail to relieve a full line.' : ''} What a hedge can’t reach is set by physics.`}
      />

      <P>
        Two of the changes reach past the hedges. Widen fuel oil’s discount by $20 after year {FUEL_OIL_YEAR} and even the best hedges remove only{' '}
        {pct(F.fuel20.effectiveness)}: Coldwater’s price now moves with a fuel-oil market neither swap trades. Take away the rail and the best remove{' '}
        {pct(F.noRail.effectiveness)}: the production hedge is sold at WTI, inland, but the refinery is short crude at the coast, and with nothing to relieve a full
        line the spread between them swings harder. The other two don’t. Take the seasons out of demand and the best hedges remove {pct(F.noSeasons.effectiveness)},
        about what they did: the plan and the swaps price every week at its seasonal forward, so the seasons were never a surprise for the hedges to catch. Let the
        producer group stop steadying prices, and the typical surprise grows to {mUsd(F.free0.rmsSurprise)}, but in crude’s own swings, which the hedges reach: the
        best remove {pct(F.free.effectiveness)}.
      </P>

      <H2>Other histories</H2>
      <P>
        In <a href={lessonHref('oil/6.5')}>Lesson 6.5</a>, settings chosen on one history often failed on others. Do hedges? In the next demonstration, a pair of
        hedges runs through all {FAN_SEEDS.length} histories of the starting world: example hedges near the starting plan’s best,{' '}
        {pct(EXAMPLE_HEDGES.production)} of net production and {fmt(EXAMPLE_HEDGES.crack, 2)} of runs in Corran’s mix against Brent, or the ones you set in{' '}
        <FigRef to="Integrated Oil Trader">the first demonstration</FigRef>. Each history has dots for its worst quarter, unhedged and hedged, and for the share of
        variance the hedges remove:
      </P>

      <Figure name="Integrated Oil Trader · other histories" scenario={s3}>
        {planSwitch}
        <Segmented<HedgeSet>
          label="Hedges"
          value={s3.state.hedges}
          onChange={(v) => s3.set({ hedges: v })}
          options={[
            { value: 'example', label: 'Example hedges' },
            { value: 'yours', label: 'Your hedges' },
          ]}
        />
        <XYChart
          ariaLabel={`Worst quarterly surprise in each of ${FAN_SEEDS.length} simulated histories with ${histHedgeText}: one in ten is worse than ${mShort(hist.p10Unhedged)} unhedged and ${mShort(hist.p10Hedged)} hedged.`}
          height={190}
          x={[0.5, FAN_SEEDS.length + 0.5]}
          y={[wLo, wHi]}
          xTicks={[1, 5, 10, 15, 20, 25, 30]}
          xFormat={(v) => (v === 1 ? 'ours' : String(v))}
          yFormat={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v))}M`}
          yLabel="Worst quarter against its plan, $ million"
          xLabel="history"
          markers={[
            ...hist.worstUnhedged.map((v, i) => ({ x: i + 1, y: v / 1e6, color: GRAPHIC.gray, r: 3.5 })),
            ...hist.worstHedged.map((v, i) => ({ x: i + 1, y: v / 1e6, color: GRAPHIC.violet, r: 3.5 })),
          ]}
        />
        <XYChart
          ariaLabel={`Share of the quarterly surprise’s variance the hedges remove in each history: ${pct(histMed)} in the middle history, ${pct(histLow)} at the lowest.`}
          height={160}
          x={[0.5, FAN_SEEDS.length + 0.5]}
          y={[eLo, 100]}
          xTicks={[1, 5, 10, 15, 20, 25, 30]}
          xFormat={(v) => (v === 1 ? 'ours' : String(v))}
          yFormat={(v) => `${fmt(v)}%`}
          yLabel="Variance removed"
          xLabel="history"
          refs={[{ axis: 'y', at: 0, color: '#999' }]}
          markers={hist.effectiveness.map((v, i) => ({ x: i + 1, y: v * 100, color: GRAPHIC.violet, r: 3.5, hollow: i === 0 }))}
        />
        <Legend
          items={[
            { label: 'Worst quarter, unhedged', color: GRAPHIC.gray },
            { label: 'Hedged', color: GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: 'worst quarter, one history in ten', value: `${mShort(hist.p10Unhedged)} → ${mShort(hist.p10Hedged)}`, tone: 'green' },
            { label: <K tone="violet">variance removed, middle history</K>, value: pct(histMed), tone: 'violet' },
            { label: 'lowest', value: pct(histLow), tone: histLow < 0 ? 'red' : 'violet' },
          ]}
        />
        <Caption>
          {histHedged
            ? `With ${histHedgeText}, across the ${FAN_SEEDS.length} histories the hedges remove between ${pct(histLow)} (${histLowIdx === 0 ? 'our history' : `history ${histLowIdx + 1}`}) and ${pct(Math.max(...hist.effectiveness))} of the variance.`
            : 'Your hedges are both at zero; set some in the first demonstration, or switch to the example hedges.'}
          {planNote}
        </Caption>
      </Figure>

      <P>
        The example hedges remove {pct(ex.effectiveness)} on our history and between {pct(F.histLow)} and{' '}
        {pct(F.histHigh)} on the {FAN_SEEDS.length}, {pct(F.histMedian)} in the middle one. In one history in ten, the worst quarter falls more than{' '}
        {mUsd(-F.hist.p10Unhedged)} short of its plan unhedged; hedged, more than {mUsd(-F.hist.p10Hedged)}. Fitted afresh on each history, the best ratios move — the
        crack ratio between {fmt(F.bestCrackLo, 2)} and {fmt(F.bestCrackHi, 2)}, the production ratio between {fmt(F.bestProdLo, 2)} and {fmt(F.bestProdHi, 2)} — but
        the bottom of the variance curve is flat: in the middle history, the fixed hedges remove just {fmt(F.gapMedian * 100, 1)} points less than that history’s own
        best pair. Unlike Chapter 6’s trading rules, these ratios weren’t found by searching for a pattern in one history’s luck. They come from the plant and the
        wells — how much light product each barrel yields, how many barrels the company pumps — and those are the same in every history.
      </P>

      <H2>From molecules to markets</H2>
      <P>
        This course asked how turning crude oil into products creates connected physical and financial markets. Every number in this last lesson traces back
        through it. Crudes differ because their molecules do (<a href={lessonHref('oil/1.2')}>Chapter 1</a>), so a refinery pays more for some than others and
        makes different products from each (<a href={lessonHref('oil/3.5')}>Chapter 3</a>). Wells decline and cost money to drill
        (<a href={lessonHref('oil/2.5')}>Chapter 2</a>); pipes and tanks are finite (<a href={lessonHref('oil/4.4')}>Chapter 4</a>); stocks set prices and the shape
        of the futures curve (<a href={lessonHref('oil/5.4')}>Chapter 5</a>). Each of those facts leaves a spread — between crudes, places, months, and crude and
        products — and each spread became a trade or a hedge in <a href={lessonHref('oil/6.1')}>Chapter 6</a>. A company that pumps, ships and refines oil holds
        all of those spreads at once, and some of them offset. The markets are connected because the barrels are: a hedge works exactly as far as it follows the
        molecules, the pipes and the plant.
      </P>
    </LessonPage>
  );
}
