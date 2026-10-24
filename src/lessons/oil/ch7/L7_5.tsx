import { useDeferredValue, useMemo } from 'react';
import { Caption, Challenge, DataTable, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, niceDomain, pct, useScenario } from '../../../framework';
import {
  BUSINESS_DEFAULTS,
  FAN_SEEDS,
  PLAN_LIMITS,
  bestHedges,
  businessFan,
  exposures,
  hedgeWeek,
  refineryDay,
  refineryMargin,
  runBusiness,
  type BestHedges,
  type BusinessResult,
  type CrackMix,
  type OilBusiness,
} from '../../../engines/oil/business';
import { TERMS, netbackPerBbl } from '../../../engines/oil/economics';
import { correlation, type HedgeCrack } from '../../../engines/oil/trading';
import { HISTORY_DEFAULTS, type HistoryParams } from '../../../model/oil/history';
import { BusinessCard } from '../shared/BusinessCard';
import { resetBusinessPart, updateBusiness, useBusiness } from '../shared/business';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// The physical world the business runs in.

export type GroupMode = 'steady' | 'free';

export interface DriverState {
  /** Scale on demand's seasonal swings (1 = the course's seasons). */
  seasonality: number;
  /** Does the producer group steady prices with its spare capacity? */
  group: GroupMode;
  /** Ridgeback Basin growth, kb/d a year, and rail capacity from Kessler to the coast, kb/d. */
  growth: number;
  rail: number;
  /** A lasting widening of fuel oil's discount to crude after year 2, $/bbl. */
  fuelOil: number;
  /** 0: the course's history; 1–8: other histories drawn from the same physics. */
  history: number;
}

export const DRIVER_DEFAULTS: DriverState = {
  seasonality: HISTORY_DEFAULTS.seasonality,
  group: 'steady',
  growth: HISTORY_DEFAULTS.basinGrowth,
  rail: HISTORY_DEFAULTS.rail,
  fuelOil: 0,
  history: 0,
};

/** The other histories the first demonstration can switch to. */
export const OTHER_SEEDS = FAN_SEEDS.slice(1, 9);
export const FUEL_OIL_YEAR = 2;
export const SEASON_STEP = 0.1;

/** History parameters for a setting of the drivers (only those that differ from the course's). */
export function driverParams(d: DriverState, withHistory = true): HistoryParams {
  const p: HistoryParams = {};
  if (d.seasonality !== HISTORY_DEFAULTS.seasonality) p.seasonality = d.seasonality;
  if (d.group === 'free') p.groupStabilizes = false;
  if (d.growth !== HISTORY_DEFAULTS.basinGrowth) p.basinGrowth = d.growth;
  if (d.rail !== HISTORY_DEFAULTS.rail) p.rail = d.rail;
  if (d.fuelOil > 0) p.fuelOilShock = { year: FUEL_OIL_YEAR, size: d.fuelOil };
  if (withHistory && d.history > 0) p.seed = OTHER_SEEDS[d.history - 1];
  return p;
}

/** Are the physical drivers (not the history) at their starting values? */
export function physicalAtStart(d: DriverState): boolean {
  const s = DRIVER_DEFAULTS;
  return Math.abs(d.seasonality - s.seasonality) < 1e-9 && d.group === s.group && d.growth === s.growth && d.rail === s.rail && d.fuelOil === s.fuelOil;
}

export function atStart(d: DriverState): boolean {
  return physicalAtStart(d) && d.history === 0;
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
  const day = refineryDay(b.refinery);
  const up: number[] = [];
  const ref: number[] = [];
  const log: number[] = [];
  r.h.forEach((w, i) => {
    const p = r.h[i === 0 ? 0 : hedgeWeek(i)];
    up.push(r.production[i] * 7 * (netbackPerBbl(w.wti) - netbackPerBbl(p.wti)));
    ref.push(7 * (refineryMargin(w, day) - refineryMargin(p, day)));
    log.push(b.logistics.firmSpace * 1000 * 7 * (w.calderCrude - w.wti - (p.calderCrude - p.wti)));
  });
  const q = (xs: number[]) => r.quarterSurprise.map((_, k) => xs.slice(k * QUARTER, (k + 1) * QUARTER).reduce((a, v) => a + v, 0));
  return { upstream: q(up), refinery: q(ref), logistics: q(log) };
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

export const INSTRUMENTS: Array<{ mix: CrackMix; bench: HedgeCrack }> = (['calder', '2:1:1', '3:2:1'] as CrackMix[]).flatMap((mix) => (['brent', 'wti'] as HedgeCrack[]).map((bench) => ({ mix, bench })));

/** The most any hedges could remove: the best ratios for each crack and crude leg, and the best of those. */
export function bestAnyHedges(b: OilBusiness, hp: HistoryParams = {}): BestHedges & { mix: CrackMix; bench: HedgeCrack } {
  let best: BestHedges & { mix: CrackMix; bench: HedgeCrack } = { production: 0, crack: 0, effectiveness: -Infinity, mix: 'calder', bench: 'brent' };
  for (const ins of INSTRUMENTS) {
    const x = bestHedges(withHedges(b, 0, 0, ins.mix, ins.bench), hp);
    if (x.effectiveness > best.effectiveness) best = { ...x, ...ins };
  }
  return best;
}

/** Challenge a's target: 85% of the variance, or a little under the best any hedges could do if that is less. */
export const TARGET_CAP = 0.85;
export function hedgeTarget(bestEffectiveness: number): number {
  return Math.min(TARGET_CAP, Math.floor((bestEffectiveness - 0.03) * 20) / 20);
}

/** Challenge a: with the world and the history as they started, hedges that remove at least the target share of the variance. */
export function hedgesSolved(b: OilBusiness, d: DriverState): boolean {
  if (!atStart(d)) return false;
  return runBusiness(b).effectiveness >= hedgeTarget(bestAnyHedges(b).effectiveness) - 1e-12;
}

/** Challenge b: how far the best possible hedges must fall, in shares of variance. */
export const HARDER_DROP = 0.05;

/** Challenge b: a physical world (on the course's history) in which even the best hedges remove at least five points less than in the starting world. */
export function harderWorldSolved(b: OilBusiness, d: DriverState): boolean {
  if (d.history !== 0 || physicalAtStart(d)) return false;
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

/** The hedges across the 30 histories, with the physical drivers held (Lesson 6.5's out-of-sample test). */
export function acrossHistories(b: OilBusiness, d: DriverState): HistoriesResult {
  const hp = driverParams(d, false);
  const un = businessFan(withHedges(b, 0, 0), hp);
  const he = businessFan(b, hp);
  const effectiveness = FAN_SEEDS.map((seed) => runBusiness(b, { ...hp, seed }).effectiveness);
  const worstUnhedged = FAN_SEEDS.map((seed) => Math.min(...runBusiness(withHedges(b, 0, 0), { ...hp, seed }).quarterSurprise));
  return { effectiveness, worstUnhedged, worstHedged: he.worstSurprises, p10Unhedged: un.worstSurprise.p10, p10Hedged: he.worstSurprise.p10 };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, c) => a - c);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The hedges the prose's second demonstration discusses: near the company's best, on the grid. */
export const EXAMPLE_HEDGES = { production: 0.5, crack: 0.75 };

/** Numbers quoted in the prose, for the starting plan of Lessons 7.1–7.3. */
export function lessonFacts() {
  const D = BUSINESS_DEFAULTS;
  const base = runBusiness(withHedges(D, 0, 0));
  const all = runBusiness(withHedges(D, 1, 0));
  const seg = segmentSurprises(withHedges(D, 0, 0));
  const worstIdx = base.quarterSurprise.indexOf(Math.min(...base.quarterSurprise));
  const day = refineryDay(D.refinery);
  const light = day.products.gasoline + day.products.jet + day.products.diesel;
  const meanNet = (base.production.reduce((a, v) => a + v, 0) / base.production.length) * NET_SHARE;
  const refShort = -refineryCrudeExposure(D, 0);
  const best = bestHedges(withHedges(D, 0, 0, 'calder', 'brent'));
  const example = runBusiness(withHedges(D, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, 'calder', 'brent'));
  const hist = acrossHistories(withHedges(D, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, 'calder', 'brent'), DRIVER_DEFAULTS);
  const bests = FAN_SEEDS.map((seed) => bestHedges(withHedges(D, 0, 0, 'calder', 'brent'), { seed }));
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
    refShort,
    meanNet,
    prodOnly: bestSingle(D, 'production'),
    crackOnly: bestSingle(D, 'crack'),
    best,
    light,
    lightShare: light / day.runs,
    runs: day.runs * 1000,
    example,
    standard: bestHedges(withHedges(D, 0, 0, '3:2:1', 'brent')),
    standardAtExample: runBusiness(withHedges(D, EXAMPLE_HEDGES.production, EXAMPLE_HEDGES.crack, '3:2:1', 'brent')),
    twoOne: bestHedges(withHedges(D, 0, 0, '2:1:1', 'brent')),
    wti: bestHedges(withHedges(D, 0, 0, 'calder', 'wti')),
    noSeasons: bestAnyHedges(D, { seasonality: 0 }),
    fuel20: bestAnyHedges(D, { fuelOilShock: { year: FUEL_OIL_YEAR, size: 20 } }),
    noRail: bestAnyHedges(D, { rail: 0 }),
    free: bestAnyHedges(D, { groupStabilizes: false }),
    free0: runBusiness(withHedges(D, 0, 0), { groupStabilizes: false }),
    firm50: bestHedges(withHedges({ ...D, logistics: { firmSpace: 50 } }, 0, 0, 'calder', 'brent')),
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
const effPhrase = (e: number) => (e >= 0 ? `removes ${pct(e)} of the variance` : `adds ${pct(-e)} to the variance`);
const MIX_LABEL: Record<CrackMix, string> = { calder: 'Calder’s mix', '2:1:1': '2:1:1', '3:2:1': '3:2:1' };
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
      height={210}
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

// ---------------------------------------------------------------------------

export default function Lesson() {
  const F = useMemo(() => lessonFacts(), []);
  const plan = useBusiness();
  const hg = plan.hedges;
  const s1 = useScenario('drivers', DRIVER_DEFAULTS);
  const d = s1.state;
  const hp = useMemo(() => driverParams(d), [d]);

  const r = useMemo(() => runBusiness(plan, hp), [plan, hp]);
  const expo = useMemo(() => ({ y1: hedgedExposures(plan, 0, hp), y4: hedgedExposures(plan, 156, hp) }), [plan, hp]);
  const deferredPlan = useDeferredValue(plan);
  const deferredD = useDeferredValue(d);
  const bestHere = useMemo(() => bestAnyHedges(deferredPlan, driverParams(deferredD)), [deferredPlan, deferredD]);
  const bestStart = useMemo(() => bestAnyHedges(deferredPlan), [deferredPlan]);
  const target = hedgeTarget(bestStart.effectiveness);
  const solvedA = useMemo(() => hedgesSolved(plan, d), [plan, d]);
  const solvedB = useMemo(() => harderWorldSolved(deferredPlan, deferredD), [deferredPlan, deferredD]);
  const hist = useMemo(() => acrossHistories(deferredPlan, deferredD), [deferredPlan, deferredD]);

  const worstU = Math.min(...r.quarterSurprise);
  const worstH = Math.min(...r.quarterHedgedSurprise);
  const hedgePnl = r.sums.productionHedge + r.sums.crackHedge;
  const hedged = hg.production > 0 || hg.crack > 0;
  const net0 = r.production[0] * NET_SHARE;
  const instrument = `${MIX_LABEL[hg.mix]} crack against ${BENCH_LABEL[hg.bench]}`;
  const histLabel = d.history === 0 ? 'the course’s history' : `history no. ${d.history} of ${OTHER_SEEDS.length} others`;

  const rows: ExpRow[] = [
    { id: 'crude', label: 'Crude, all grades', y1: expo.y1.before.crude, y1h: expo.y1.after.crude, y4: expo.y4.before.crude, y4h: expo.y4.after.crude },
    { id: 'crack', label: 'Crack (products over crude)', y1: expo.y1.before.crack, y1h: expo.y1.after.crack, y4: expo.y4.before.crack, y4h: expo.y4.after.crack },
    { id: 'basis', label: 'Coast over Kessler', y1: expo.y1.before.basis, y1h: expo.y1.after.basis, y4: expo.y4.before.basis, y4h: expo.y4.after.basis },
  ];

  const effSorted = [...hist.effectiveness];
  const histMed = median(effSorted);
  const histLow = Math.min(...effSorted);
  const histLowIdx = hist.effectiveness.indexOf(histLow);
  const worstVals = [...hist.worstUnhedged, ...hist.worstHedged].map((v) => v / 1e6);
  const [wLo, wHi] = niceDomain(Math.min(...worstVals), Math.max(0, ...worstVals), 4);
  const effVals = hist.effectiveness.map((v) => v * 100);
  const [eLo] = niceDomain(Math.min(0, ...effVals), 100, 4);

  const onReset = () => {
    resetBusinessPart('hedges');
    s1.reset();
  };
  const set = (patch: Partial<OilBusiness['hedges']>) => updateBusiness('hedges', patch);

  const B = F.base;
  const ex = F.example;
  const statusA = !atStart(d)
    ? 'Return the physical drivers and the history to their starting values.'
    : `Your hedges ${effPhrase(r.effectiveness)} of the quarterly surprise; the target is ${pct(target)}.`;

  return (
    <LessonPage id="oil/7.5">
      <P>
        <a href={lessonHref('oil/7.4')}>Lesson 7.4</a> looked at what our company can forecast and what it can’t. The seasons in the crack, a pipeline’s opening
        date and a basin’s growth can be planned around; where crude will be a quarter from now can’t. This lesson does what companies do with the part
        they can’t forecast: hedge it. Everything the chapter has built runs together — the wells and waterflood of <a href={lessonHref('oil/7.1')}>Lesson 7.1</a>,
        the refinery of <a href={lessonHref('oil/7.2')}>Lesson 7.2</a>, the firm space of <a href={lessonHref('oil/7.3')}>Lesson 7.3</a> — through the course’s
        five simulated years. As everywhere in the course, every price is simulated for teaching.
      </P>
      <P>
        We measure risk as <a href={lessonHref('oil/6.4')}>Lesson 6.4</a> did for Calder, but for the whole company. At the start of each quarter, the company plans
        on that day’s prices holding; its <K c="price">surprise</K> is what it earned less that plan. With the starting plan of Lessons 7.1–7.3, the company makes{' '}
        {bUsd(B.sums.total)} of operating cash in five years. Its typical quarterly surprise, measured by its root-mean-square size, is {mUsd(B.rmsSurprise)}, and the
        worst, in quarter {F.worstIdx + 1}, is {mUsd(Math.min(...B.quarterSurprise))}. Two hedges are available, each placed at the start of a quarter at that
        day’s price: a <K tone="violet">production hedge</K>, selling forward at WTI a share of the company’s net production (what is left after royalty and tax),
        and a <K tone="violet">crack hedge</K>, selling the crack on a share of the refinery’s crude runs, in the mix and against the crude of our choice.
      </P>
      <P>
        In the next demonstration, the bars are the twenty quarters’ surprises, gray unhedged and violet hedged. The hedges you set here are kept as part of your
        business, and the physical drivers beside them reshape the five years:
      </P>

      <Figure name="Integrated Oil Trader" onReset={onReset}>
        <BusinessCard current="hedges" />
        <SurpriseBars
          r={r}
          label={`The company’s quarterly surprise over five simulated years on ${histLabel}: ${hedged ? `typical size ${mShort(r.rmsSurprise)} unhedged and ${mShort(r.rmsHedged)} with ${pct(hg.production)} of net production and ${fmt(hg.crack, 2)} of runs hedged in ${instrument}; worst quarter ${mShort(worstU)} unhedged and ${mShort(worstH)} hedged` : `no hedges in place; typical size ${mShort(r.rmsSurprise)}, worst quarter ${mShort(worstU)}`}.`}
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
            { label: 'hedges’ net result', value: mShort(hedgePnl), tone: hedgePnl < 0 ? 'red' : 'green' },
            { label: <K tone="violet">most any hedges could remove</K>, value: pct(bestHere.effectiveness), tone: 'violet' },
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
            { value: 'calder' as const, label: 'Calder’s mix' },
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
            { label: 'year 1', cell: (x) => kDay(x.y1), align: 'right' },
            { label: 'hedged', cell: (x) => kDay(x.y1h), align: 'right' },
            { label: 'year 4', cell: (x) => kDay(x.y4), align: 'right' },
            { label: 'hedged', cell: (x) => kDay(x.y4h), align: 'right' },
          ]}
          rows={rows}
          rowKey={(x) => x.id}
        />
        <Slider
          label="Seasonal swing in demand"
          tone="orange"
          value={d.seasonality}
          min={0}
          max={2}
          step={SEASON_STEP}
          onChange={(v) => s1.set({ seasonality: Math.round(v * 10) / 10 })}
          display={d.seasonality === 0 ? 'none' : `${fmt(d.seasonality, 1)}× normal`}
        />
        <Slider label="Ridgeback Basin growth" tone="orange" value={d.growth} min={0} max={140} step={10} onChange={(v) => s1.set({ growth: v })} display={`${d.growth} kb/d a year`} />
        <Slider label="Rail to the coast" tone="orange" value={d.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={`${d.rail} kb/d`} />
        <Slider
          label="Fuel oil’s discount, after year 2"
          tone="gold"
          value={d.fuelOil}
          min={0}
          max={20}
          step={1}
          onChange={(v) => s1.set({ fuelOil: v })}
          display={d.fuelOil === 0 ? 'no shift' : `$${d.fuelOil} wider`}
        />
        <Slider
          label="Simulated history"
          value={d.history}
          min={0}
          max={OTHER_SEEDS.length}
          step={1}
          onChange={(v) => s1.set({ history: v })}
          display={d.history === 0 ? 'the course’s' : `no. ${d.history} of ${OTHER_SEEDS.length} others`}
        />
        <Segmented
          label="Producer group"
          value={d.group}
          onChange={(v) => s1.set({ group: v })}
          options={[
            { value: 'steady' as const, label: 'Steadies prices' },
            { value: 'free' as const, label: 'Doesn’t' },
          ]}
        />
        <Caption>
          {hedged ? `Selling ${instrument} on ${fmt(hg.crack * r.runs)} kb/d and WTI on ${pct(hg.production)} of net output, the company` : 'Unhedged, the company'} carries a
          typical quarterly surprise of {mShort(r.rmsHedged)}. Here the best hedges — {fmt(bestHere.production, 2)} of net production and {fmt(bestHere.crack, 2)} of
          runs in {MIX_LABEL[bestHere.mix]} against {BENCH_LABEL[bestHere.bench]} — would remove {pct(bestHere.effectiveness)}.
        </Caption>
      </Figure>

      <P>
        Start with what each business would do on its own: the producer sells all its oil forward. Set the production hedge to 100% with no crack hedge, and the
        typical surprise grows from {mUsd(B.rmsSurprise)} to {mUsd(F.all.rmsHedged)}; the worst quarter falls to {mUsd(Math.min(...F.all.quarterHedgedSurprise))}.
        The company was partly hedged already. Its refinery is short crude: coke sells by the tonne at a price of its own, LPG at less than half the price of crude,
        and Coldwater Heavy, tied to fuel oil (<a href={lessonHref('oil/4.5')}>Lesson 4.5</a>), rises a little more than a dollar with every dollar on crude. So
        when crude rises, Calder’s margin falls by {kAbs(F.refShort)} a day for each dollar, while upstream gains on every barrel it sells. Over a quarter, the two
        segments’ surprises have a correlation of {fmt(F.corr, 2)}: a <K tone="violet">natural hedge</K>. Hedging upstream alone removes one side of it and leaves
        the refinery’s side exposed.
      </P>
      <P>
        The exposure table shows the balance shifting. As year 1 begins, the company pumps about {bbl(F.prod1)} barrels a day and is net short crude, losing{' '}
        {kAbs(F.exp1.crude)} a day for each dollar crude rises; three years on, the waterflood and new wells have lifted output to about {bbl(F.prod4)} barrels a day, and the company
        gains {kAbs(F.exp4.crude)}. One ratio has to serve both. On its own, the production hedge does best at {fmt(F.prodOnly.ratio, 2)}, removing only{' '}
        {pct(F.prodOnly.effectiveness)}; the crack hedge alone does best at {fmt(F.crackOnly.ratio, 2)}, removing {pct(F.crackOnly.effectiveness)}.
      </P>

      <Challenge
        id="a"
        question={`With the physical drivers and the history at their starting values, set the hedges so they remove at least ${pct(target)} of the variance of the company’s quarterly surprise.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${pct(hg.production)} of net production and ${fmt(hg.crack, 2)} of runs in ${instrument} remove ${pct(r.effectiveness)}. The least risky pair here is ${fmt(bestStart.production, 2)} and ${fmt(bestStart.crack, 2)} in ${MIX_LABEL[bestStart.mix]} against ${BENCH_LABEL[bestStart.bench]}, which removes ${pct(bestStart.effectiveness)}. Each hedge takes a different physical risk: the crack hedge the product stocks and seasons of Lesson 5.3, the production hedge the crude level that upstream is long and the refinery short.`}
      />

      <H2>Hedging one company</H2>
      <P>
        With the starting plan, the least risky pair sells WTI on {fmt(F.best.production, 2)} of net production and Calder’s mix against Brent on{' '}
        {fmt(F.best.crack, 2)} of runs, and removes {pct(F.best.effectiveness)} of the variance — far more than either hedge removes alone. Both ratios have
        physical meanings. Of the {bbl(F.runs)} barrels a day Calder runs, {bbl(F.light * 1000)} come out as gasoline, jet fuel and diesel
        (<a href={lessonHref('oil/3.5')}>Lesson 3.5</a>), a share of {fmt(F.lightShare, 2)}: the crack ratio is almost exactly that, so the hedge offsets the crack
        on every barrel of light product. And over the five years upstream sells {bbl(F.meanNet)} net barrels a day on average, of which the refinery’s
        short position, about {bbl(F.refShort)} barrels’ worth, already offsets {pct(F.refShort / F.meanNet)}. Selling forward the rest,{' '}
        {fmt(1 - F.refShort / F.meanNet, 2)} of net output, comes close to the production ratio.
      </P>
      <P>
        The instrument matters as it did for Calder alone. With the 3:2:1 crack, the best pair removes only {pct(F.standard.effectiveness)}, and at the ratios
        that suit Calder’s mix it {effPhrase(F.standardAtExample.effectiveness)}: the 3:2:1 is two-thirds gasoline, and the company’s refinery makes mostly diesel. The
        2:1:1 reaches {pct(F.twoOne.effectiveness)}. Pricing Calder’s mix against WTI, inland, reaches {pct(F.wti.effectiveness)}, since the company buys its
        crude at the coast and the Brent–WTI spread (<a href={lessonHref('oil/5.2')}>Lesson 5.2</a>) is a risk that crack doesn’t share. Firm space is the hedge for
        that spread: it is long the coast over Kessler (<a href={lessonHref('oil/6.2')}>Lesson 6.2</a>), as upstream is short it. With 50 kb/d of it, the best pair
        removes {pct(F.firm50.effectiveness)}.
      </P>

      <H2>What no hedge reaches</H2>
      <P>
        The best hedges leave {pct(1 - F.best.effectiveness)} behind, and the physical world decides how much. Take the seasons out of demand and even the best
        hedges remove only {pct(F.noSeasons.effectiveness)}: the big seasonal swings in the crack were the risk the crack hedge caught most cleanly, and without them
        the risks no swap contains — coke, LPG, the heavy barrel’s discount — make up more of what is left. Widen fuel oil’s discount by $20 after year 2 and the
        best hedges remove {pct(F.fuel20.effectiveness)}, since Coldwater’s price now moves with a fuel-oil market neither hedge trades. Take away the rail
        and the best remove {pct(F.noRail.effectiveness)}: the production hedge is sold at WTI, inland, but the refinery is short crude at the coast, and the more
        the spread between them swings, the less one offsets the other. Let the producer group stop steadying prices, and the typical surprise grows to{' '}
        {mUsd(F.free0.rmsSurprise)} — but it is crude’s own swings that grow, the risk the hedges reach, and the best remove {pct(F.free.effectiveness)}.
      </P>

      <Challenge
        id="b"
        figure="Integrated Oil Trader"
        question="Keeping the course’s history, change the physical world so that even the best hedges remove at least 5 points less of the variance than they can in the starting world."
        solved={solvedB}
        status={
          d.history !== 0
            ? 'Return to the course’s history.'
            : physicalAtStart(d)
              ? `In the starting world the best hedges remove ${pct(bestStart.effectiveness)}. Change the physical drivers.`
              : `Here the best hedges remove ${pct(bestHere.effectiveness)}, against ${pct(bestStart.effectiveness)} in the starting world.`
        }
        success={`Solved: in this world the best hedges remove ${pct(bestHere.effectiveness)}, against ${pct(bestStart.effectiveness)} at the start. What a hedge can’t reach is set by physics: the products the refinery makes that no crack contains, the heavy crude whose price follows fuel oil, the pipeline between the company’s wells and its refinery.`}
      />

      <H2>Other histories</H2>
      <P>
        In <a href={lessonHref('oil/6.5')}>Lesson 6.5</a>, settings chosen on one history often failed on others. Do hedges? In the next demonstration, the hedges
        and physical drivers you set in <FigRef to="Integrated Oil Trader">the first demonstration</FigRef> run through all 30 histories. Each history has two dots
        for its worst quarter, unhedged and hedged, and one for the share of variance the hedges remove:
      </P>

      <Figure name="Integrated Oil Trader · other histories" onReset={onReset}>
        <XYChart
          ariaLabel={`Worst quarterly surprise in each of ${FAN_SEEDS.length} simulated histories: one in ten is worse than ${mShort(hist.p10Unhedged)} unhedged and ${mShort(hist.p10Hedged)} hedged.`}
          height={200}
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
          height={170}
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
        <Slider
          label="Production hedge"
          tone="violet"
          value={hg.production}
          min={0}
          max={PLAN_LIMITS.production[1]}
          step={PLAN_LIMITS.production[2]}
          onChange={(v) => set({ production: r2(v) })}
          display={`${pct(hg.production)} of net output`}
        />
        <Slider
          label="Crack hedge"
          tone="violet"
          value={hg.crack}
          min={0}
          max={PLAN_LIMITS.crack[1]}
          step={PLAN_LIMITS.crack[2]}
          onChange={(v) => set({ crack: r2(v) })}
          display={`${fmt(hg.crack, 2)} of runs · ${MIX_LABEL[hg.mix]} vs ${BENCH_LABEL[hg.bench]}`}
        />
        <Caption>
          {hedged
            ? `Across the ${FAN_SEEDS.length} histories, these hedges remove between ${pct(histLow)} (${histLowIdx === 0 ? 'our history' : `history ${histLowIdx + 1}`}) and ${pct(Math.max(...hist.effectiveness))} of the variance.`
            : 'Set some hedges to see how they fare across the histories.'}
        </Caption>
      </Figure>

      <P>
        With {pct(EXAMPLE_HEDGES.production)} of production and {fmt(EXAMPLE_HEDGES.crack, 2)} of runs in Calder’s mix against Brent — near the starting plan’s
        best — the hedges remove {pct(ex.effectiveness)} on our history and between {pct(F.histLow)} and {pct(F.histHigh)} on the 30, {pct(F.histMedian)} in the
        middle one. In one history in ten, the worst quarter falls more than {mUsd(-F.hist.p10Unhedged)} short of its plan unhedged; hedged, more than{' '}
        {mUsd(-F.hist.p10Hedged)}. Fitted afresh on each history, the best ratios move — the crack ratio between {fmt(F.bestCrackLo, 2)} and{' '}
        {fmt(F.bestCrackHi, 2)}, the production ratio between {fmt(F.bestProdLo, 2)} and {fmt(F.bestProdHi, 2)} — but the bottom of the variance curve is flat:
        in the middle history, the fixed hedges remove just {fmt(F.gapMedian * 100, 1)} points less than that history’s own best pair. Unlike
        Chapter 6’s trading rules, these ratios weren’t found by searching for a pattern in one history’s luck. They come from the plant and the wells — how much
        light product each barrel yields, how many barrels the company pumps — and those are the same in every history.
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

