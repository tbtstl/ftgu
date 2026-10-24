// The capstone's integrated oil business (Chapter 7).
//
// One company owns the pieces the course has built: the Northfield field and acreage in the
// Ridgeback Basin (Chapter 2), the Calder refinery (Chapter 3), and a commitment on the
// Kessler–Calder line (Chapter 4); it hedges with the spreads of Chapter 6. Each capstone lesson
// owns one part of the plan — production (7.1), the refinery (7.2), logistics (7.3), hedges (7.5) —
// and this module turns a plan and a simulated history (Chapter 5's physical drivers) into cash
// flows by segment. Nothing here is a new mechanism: it composes the course's engines.
//
// Segments are accounted at market prices, as separate businesses inside one company would be:
//   • upstream sells its crude at Kessler at the WTI-like price, less the Lesson 2.5 differential,
//     royalty and production tax, and pays its operating costs;
//   • logistics holds firm space on the Kessler–Calder line: it buys crude at Kessler, ships it at
//     a committed tariff whether or not it uses the space (take-or-pay), and sells at Port Calder;
//   • the refinery buys its crudes and sells its products at Port Calder;
//   • hedges are swaps settled each week against the price locked at the start of the quarter.
// Capital (wells, the waterflood, refinery expansions) is kept apart from operating cash.
// Capital costs and the committed tariff are illustrative. All prices are simulated.

import { CRUDE_IDS, type CrudeId } from '../../model/oil/crudes';
import { DIFF_SLOPE, oilHistory, type HistoryParams, type HistoryWeek } from '../../model/oil/history';
import { CALDER, type ProductId, type RefineryConfig, type UnitId } from '../../model/oil/refinery';
import { REF_PRICES } from '../../model/oil/world';
import { mean, summarize, type PnlSummary } from '../strategy/risk';
import { TERMS, WATERFLOOD, netbackPerBbl, northfieldMonthly, npv, ridgebackRates, ridgebackWellCost, wellBreakeven, wellCashFlows } from './economics';
import { NETWORK_DEFAULTS } from './network';
import { planRefinery, type RefineryPlan } from './refinery';
import { CRACK_RATIOS, crackOf, type HedgeCrack } from './trading';

const DAYS_PER_MONTH = 365.25 / 12;
const WEEKS_PER_QUARTER = 13;

// ---------------------------------------------------------------------------
// The plan.

export interface ProductionPlan {
  /** Ridgeback wells planned in each of the next five years. */
  wellsPerYear: number;
  /** Fund Northfield's waterflood now (its oil starts next year). */
  waterflood: boolean;
  /** Drill a year's wells only if WTI at the start of the year is at least this, $/bbl (0: always drill). */
  drillAbove: number;
}

export type CrackMix = keyof typeof CRACK_RATIOS;

export interface LogisticsPlan {
  /** Firm space committed on the Kessler–Calder line, kb/d. */
  firmSpace: number;
}

export interface HedgePlan {
  /** Share of the company's net production (after royalty and tax) sold forward each quarter. */
  production: number;
  /** Crack barrels sold forward per barrel of crude the refinery runs. */
  crack: number;
  /** The crack's product mix, and the crude it is priced against. */
  mix: CrackMix;
  bench: HedgeCrack;
}

export interface OilBusiness {
  production: ProductionPlan;
  refinery: RefineryConfig;
  logistics: LogisticsPlan;
  hedges: HedgePlan;
}

export const PRODUCTION_DEFAULTS: ProductionPlan = { wellsPerYear: 20, waterflood: true, drillAbove: 0 };
export const LOGISTICS_DEFAULTS: LogisticsPlan = { firmSpace: 0 };
export const HEDGE_PLAN_DEFAULTS: HedgePlan = { production: 0, crack: 0, mix: 'calder', bench: 'brent' };

export const BUSINESS_DEFAULTS: OilBusiness = {
  production: PRODUCTION_DEFAULTS,
  refinery: CALDER,
  logistics: LOGISTICS_DEFAULTS,
  hedges: HEDGE_PLAN_DEFAULTS,
};

/** The range each choice may take: [min, max, step]. */
export const PLAN_LIMITS = {
  wellsPerYear: [0, 60, 5],
  drillAbove: [0, 100, 5],
  firmSpace: [0, 200, 10],
  production: [0, 1, 0.05],
  crack: [0, 1.2, 0.05],
  capacity: {
    cdu: [150, 200, 5],
    reformer: [30, 50, 5],
    fcc: [50, 80, 5],
    coker: [25, 50, 5],
    dht: [55, 80, 5],
  } as Record<UnitId, [number, number, number]>,
  hydrogenPlant: [40, 80, 5],
  sulfurPlant: [300, 500, 25],
} as const;

/** Clamps a number into [min, max] on its step grid (falling back to `fallback` if it isn't a number). */
export function snap(x: unknown, [min, max, step]: readonly [number, number, number], fallback: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  const v = Math.min(max, Math.max(min, x));
  return Math.round((v - min) / step) * step + min;
}

/** A plan read from anywhere (saved in a browser, typed by hand), made valid. */
export function sanitizeBusiness(raw: unknown): OilBusiness {
  const r = (raw ?? {}) as Partial<Record<keyof OilBusiness, Record<string, unknown>>>;
  const p = r.production ?? {};
  const rf = r.refinery ?? {};
  const cap = (rf.capacity ?? {}) as Record<string, unknown>;
  const lg = r.logistics ?? {};
  const hg = r.hedges ?? {};
  const D = BUSINESS_DEFAULTS;
  const L = PLAN_LIMITS;
  const units = Object.keys(L.capacity) as UnitId[];
  return {
    production: {
      wellsPerYear: snap(p.wellsPerYear, L.wellsPerYear, D.production.wellsPerYear),
      waterflood: typeof p.waterflood === 'boolean' ? p.waterflood : D.production.waterflood,
      drillAbove: snap(p.drillAbove, L.drillAbove, D.production.drillAbove),
    },
    refinery: {
      capacity: Object.fromEntries(units.map((u) => [u, snap(cap[u], L.capacity[u], D.refinery.capacity[u])])) as Record<UnitId, number>,
      hydrogenPlant: snap(rf.hydrogenPlant, L.hydrogenPlant, D.refinery.hydrogenPlant),
      sulfurPlant: snap(rf.sulfurPlant, L.sulfurPlant, D.refinery.sulfurPlant),
    },
    logistics: { firmSpace: snap(lg.firmSpace, L.firmSpace, D.logistics.firmSpace) },
    hedges: {
      production: snap(hg.production, L.production, D.hedges.production),
      crack: snap(hg.crack, L.crack, D.hedges.crack),
      mix: typeof hg.mix === 'string' && hg.mix in CRACK_RATIOS ? (hg.mix as CrackMix) : D.hedges.mix,
      bench: hg.bench === 'wti' || hg.bench === 'brent' ? hg.bench : D.hedges.bench,
    },
  };
}

// ---------------------------------------------------------------------------
// Production (7.1): the Lesson 2.5 program on a price path instead of a flat price.

/** After the simulated five years, the plan's cash flows are valued at the reference WTI. */
export const LONG_RUN_WTI = REF_PRICES.wti;
/** Production plans are valued over 20 years of months. */
export const PLAN_MONTHS = 240;

/** Monthly WTI: the history's monthly averages, then the long-run price. */
export function monthlyWti(h: HistoryWeek[], months = PLAN_MONTHS, longRun = LONG_RUN_WTI): number[] {
  const out: number[] = [];
  const histMonths = Math.floor((h.length * 12) / 52);
  for (let m = 0; m < months; m++) {
    if (m < histMonths) {
      const ws = h.filter((w) => Math.floor((w.week * 12) / 52) === m);
      out.push(mean(ws.map((w) => w.wti)));
    } else out.push(longRun);
  }
  return out;
}

/** A Ridgeback well's breakeven WTI (Lesson 2.5). */
export const WELL_BREAKEVEN = wellBreakeven();

/** Which of the five years' wells get drilled: those whose year starts with WTI at or above the plan's threshold. */
export function drillingYears(plan: ProductionPlan, h: HistoryWeek[]): boolean[] {
  return [0, 1, 2, 3, 4].map((y) => (h[Math.min(h.length - 1, y * 52)]?.wti ?? LONG_RUN_WTI) >= plan.drillAbove);
}

export interface ProductionResult {
  /** Monthly oil, b/d: Northfield on pumps, the waterflood's extra oil, and Ridgeback wells. */
  northfield: number[];
  flood: number[];
  ridgeback: number[];
  /** Monthly WTI used. */
  price: number[];
  /** Monthly operating cash and capital, $ (capital as a positive number). */
  operating: number[];
  capital: number[];
  /** Operating cash less capital, and its value today at 10%. */
  cash: number[];
  npv: number;
  capitalTotal: number;
  wellsDrilled: number;
  drilled: boolean[];
}

const WELL_RATES = ridgebackRates();
const WELL_COST = ridgebackWellCost();
/** A well's producing life in months at the long-run price (its economic limit, Lesson 2.5). */
const WELL_LIFE = wellCashFlows(WELL_RATES, WELL_COST, LONG_RUN_WTI).cash.length - 1;

const productionCache = new WeakMap<HistoryWeek[], Map<string, ProductionResult>>();

/**
 * The production plan on a history's price path, then `longRun` after it. Volumes follow
 * Lessons 2.4–2.5 (Northfield's field model and each Ridgeback well's decline curve, with lives set
 * at the reference WTI), and each month's cash is earned at that month's WTI.
 */
export function productionOnPath(plan: ProductionPlan, h: HistoryWeek[], months = PLAN_MONTHS, t = TERMS, longRun = LONG_RUN_WTI): ProductionResult {
  const key = `${JSON.stringify(plan)}|${months}|${JSON.stringify(t)}|${longRun}`;
  let byPlan = productionCache.get(h);
  if (!byPlan) productionCache.set(h, (byPlan = new Map()));
  const hit = byPlan.get(key);
  if (hit) return hit;
  const price = monthlyWti(h, months, longRun);
  const base = northfieldMonthly(false, LONG_RUN_WTI, months);
  const withFlood = plan.waterflood ? northfieldMonthly(true, LONG_RUN_WTI, months) : base;
  const flood = withFlood.map((q, i) => Math.max(0, q - base[i]));
  const ridgeback = Array<number>(months).fill(0);
  const operating = Array<number>(months).fill(0);
  const capital = Array<number>(months).fill(0);
  const per = (m: number) => netbackPerBbl(price[m], t) - t.opexPerBbl;
  for (let m = 0; m < months; m++) operating[m] += withFlood[m] * DAYS_PER_MONTH * per(m);
  if (plan.waterflood) capital[0] += WATERFLOOD.capital;
  const drilled = drillingYears(plan, h);
  let wellsDrilled = 0;
  for (let y = 0; y < 5; y++) {
    if (!drilled[y]) continue;
    for (let w = 0; w < plan.wellsPerYear; w++) {
      const start = y * 12 + Math.floor((w * 12) / Math.max(1, plan.wellsPerYear));
      if (start >= months) continue;
      wellsDrilled++;
      capital[start] += WELL_COST;
      for (let k = 1; k <= WELL_LIFE && start + k < months; k++) {
        const q = WELL_RATES[k - 1];
        ridgeback[start + k] += q;
        operating[start + k] += q * DAYS_PER_MONTH * per(start + k) - t.fixedPerWellMonth;
      }
    }
  }
  const cash = operating.map((c, m) => c - capital[m]);
  const r: ProductionResult = {
    northfield: base,
    flood,
    ridgeback,
    price,
    operating,
    capital,
    cash,
    npv: npv(cash, t.discount),
    capitalTotal: capital.reduce((a, b) => a + b, 0),
    wellsDrilled,
    drilled,
  };
  if (byPlan.size > 200) byPlan.clear();
  byPlan.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// The refinery (7.2): the Lesson 3.5 LP, solved once at reference prices for a configuration,
// then run every week at that week's prices (as Lesson 6.4 ran Calder's reference day).

/** Capital to add capacity, $ per kb/d of feed (hydrogen per MMscf/d, sulfur per t/d): illustrative. */
export const UNIT_CAPITAL: Record<UnitId, number> = { cdu: 10e6, reformer: 15e6, fcc: 20e6, coker: 30e6, dht: 10e6 };
export const HYDROGEN_CAPITAL = 2e6;
export const SULFUR_CAPITAL = 0.5e6;

/** Capital to build a configuration from today's Calder, $. */
export function refineryCapital(c: RefineryConfig): number {
  const units = Object.keys(UNIT_CAPITAL) as UnitId[];
  return (
    units.reduce((s, u) => s + Math.max(0, c.capacity[u] - CALDER.capacity[u]) * UNIT_CAPITAL[u], 0) +
    Math.max(0, c.hydrogenPlant - CALDER.hydrogenPlant) * HYDROGEN_CAPITAL +
    Math.max(0, c.sulfurPlant - CALDER.sulfurPlant) * SULFUR_CAPITAL
  );
}

export interface RefineryDay {
  /** Crude runs and products at reference prices, kb/d (coke t/d). */
  crude: Record<CrudeId, number>;
  products: Record<ProductId, number>;
  /** Total crude run, kb/d, and operating costs including hydrogen, $/day. */
  runs: number;
  fixed: number;
  /** Margin at reference prices, $/day. */
  margin: number;
  plan: RefineryPlan;
}

const dayCache = new Map<string, RefineryDay>();
/** A configuration's day at reference prices (Lesson 3.5's LP). */
export function refineryDay(c: RefineryConfig = CALDER): RefineryDay {
  const key = JSON.stringify(c);
  const hit = dayCache.get(key);
  if (hit) return hit;
  const plan = planRefinery({ config: c });
  const runs = CRUDE_IDS.reduce((s, k) => s + plan.crude[k], 0);
  const d: RefineryDay = { crude: plan.crude, products: plan.products, runs, fixed: plan.opex, margin: plan.margin, plan };
  if (dayCache.size > 300) dayCache.clear();
  dayCache.set(key, d);
  return d;
}

/**
 * Prices at Port Calder in a week of the history: light crude at the coast, Coldwater and fuel oil
 * from the quality relation, Northfield shipped down the line at that week's Kessler–Calder spread,
 * and the products as in Lesson 6.4 (jet a little under diesel, LPG and naphtha tied to crude).
 */
export function calderPrices(w: HistoryWeek): { crude: Record<CrudeId, number>; product: Record<ProductId, number> } {
  return {
    crude: {
      ridgeback: w.calderCrude - 1.7,
      seaboard: w.calderCrude + 1.3,
      northfield: w.northfield + (w.calderCrude - w.wti),
      coldwater: w.coldwater,
    },
    product: {
      lpg: 0.455 * w.brent,
      naphtha: w.brent - 11,
      gasoline: w.gasoline,
      jet: w.diesel - 4,
      diesel: w.diesel,
      hsfo: w.hsfo,
      coke: REF_PRICES.coke,
    },
  };
}

/** A refinery day's gross margin at a week's prices, $/day. */
export function refineryMargin(w: HistoryWeek, d: RefineryDay): number {
  const p = calderPrices(w);
  let revenue = 0;
  for (const k of Object.keys(d.products) as ProductId[]) revenue += d.products[k] * p.product[k] * (k === 'coke' ? 1 : 1000);
  const crude = CRUDE_IDS.reduce((s, k) => s + d.crude[k] * p.crude[k] * 1000, 0);
  return revenue - crude - d.fixed;
}

// ---------------------------------------------------------------------------
// Logistics (7.3).

/** Committed (take-or-pay) tariff for firm space on the Kessler–Calder line, $/bbl: the walk-up tariff plus an illustrative premium for guaranteed space. */
export const COMMITTED_TARIFF = NETWORK_DEFAULTS.pipelineTariff + 1.5;

/** Firm space's weekly result, $: ship `kbd` from Kessler to Port Calder, paying the committed tariff on all of it. */
export function firmSpaceWeek(w: HistoryWeek, kbd: number, tariff = COMMITTED_TARIFF): number {
  return kbd * 1000 * 7 * (w.calderCrude - w.wti - tariff);
}

// ---------------------------------------------------------------------------
// The whole business, week by week.

export interface BusinessResult {
  h: HistoryWeek[];
  /** Weekly cash by segment, $. */
  upstream: number[];
  logistics: number[];
  refinery: number[];
  productionHedge: number[];
  crackHedge: number[];
  /** Weekly operating cash, all segments and hedges, $; and capital spent, $. */
  total: number[];
  capital: number[];
  /** Weekly production (b/d) and the refinery's crude run (kb/d). */
  production: number[];
  runs: number;
  /** Quarterly operating cash, $ (20 quarters). */
  quarters: number[];
  /**
   * The plan and the surprise (Lesson 6.4's measure, for the whole company): each week's cash had
   * that quarter's prices held at their level when the quarter's hedges were placed, and actual
   * cash less that, before and after hedges, $. Volumes are known in advance; prices are not.
   */
  expected: number[];
  surprise: number[];
  hedgedSurprise: number[];
  /** Quarterly sums of the surprise, before and after hedges, $. */
  quarterSurprise: number[];
  quarterHedgedSurprise: number[];
  /** Root-mean-square quarterly surprise, before and after hedges, $; and the share of its variance the hedges remove. */
  rmsSurprise: number;
  rmsHedged: number;
  effectiveness: number;
  /** Five-year sums by segment, $. */
  sums: { upstream: number; logistics: number; refinery: number; productionHedge: number; crackHedge: number; total: number; capital: number };
  stats: PnlSummary;
  worstQuarter: number;
}

/** The quarter a week's hedge was placed in: the week before its quarter began (as in Lesson 6.4). */
export function hedgeWeek(t: number): number {
  return Math.floor((t - 1) / WEEKS_PER_QUARTER) * WEEKS_PER_QUARTER;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const businessCache = new Map<string, BusinessResult>();

/** Runs the business through a simulated history. */
export function runBusiness(b: OilBusiness = BUSINESS_DEFAULTS, hp: HistoryParams = {}): BusinessResult {
  const key = JSON.stringify([b, hp]);
  const hit = businessCache.get(key);
  if (hit) return hit;
  const h = oilHistory(hp);
  const n = h.length;
  const prod = productionOnPath(b.production, h);
  const day = refineryDay(b.refinery);
  const t = TERMS;
  const netShare = (1 - t.royalty) * (1 - t.productionTax);
  const share = CRACK_RATIOS[b.hedges.mix];
  const upstream: number[] = [];
  const logistics: number[] = [];
  const refinery: number[] = [];
  const productionHedge: number[] = [];
  const crackHedge: number[] = [];
  const capital: number[] = [];
  const production: number[] = [];
  const expected: number[] = [];
  // Each week's month, and how many weeks each month has, to spread monthly costs over weeks.
  const monthOf = h.map((w) => Math.floor((w.week * 12) / 52));
  const weeksIn: number[] = [];
  monthOf.forEach((m) => (weeksIn[m] = (weeksIn[m] ?? 0) + 1));
  for (let i = 0; i < n; i++) {
    const w = h[i];
    const m = monthOf[i];
    const bpd = prod.northfield[m] + prod.flood[m] + prod.ridgeback[m];
    production.push(bpd);
    // The month's fixed costs on Ridgeback wells (what the monthly operating cash holds beyond
    // its per-barrel margin), and its capital, spread over the month's weeks.
    const fixedMonth = prod.operating[m] - bpd * DAYS_PER_MONTH * (netbackPerBbl(prod.price[m], t) - t.opexPerBbl);
    upstream.push(bpd * 7 * (netbackPerBbl(w.wti, t) - t.opexPerBbl) + fixedMonth / weeksIn[m]);
    capital.push(prod.capital[m] / weeksIn[m] + (i === 0 ? refineryCapital(b.refinery) : 0));
    logistics.push(firmSpaceWeek(w, b.logistics.firmSpace));
    refinery.push(7 * refineryMargin(w, day));
    const p = h[i === 0 ? 0 : hedgeWeek(i)];
    expected.push(bpd * 7 * (netbackPerBbl(p.wti, t) - t.opexPerBbl) + fixedMonth / weeksIn[m] + firmSpaceWeek(p, b.logistics.firmSpace) + 7 * refineryMargin(p, day));
    if (i === 0) {
      productionHedge.push(0);
      crackHedge.push(0);
    } else {
      const t0 = hedgeWeek(i);
      productionHedge.push(b.hedges.production * bpd * netShare * 7 * (h[t0].wti - w.wti));
      crackHedge.push(b.hedges.crack * day.runs * 1000 * 7 * (crackOf(h[t0], b.hedges.bench, share) - crackOf(w, b.hedges.bench, share)));
    }
  }
  const total = upstream.map((u, i) => u + logistics[i] + refinery[i] + productionHedge[i] + crackHedge[i]);
  const surprise = upstream.map((u, i) => u + logistics[i] + refinery[i] - expected[i]);
  const hedgedSurprise = surprise.map((x, i) => x + productionHedge[i] + crackHedge[i]);
  const byQuarter = (xs: number[]) => {
    const out: number[] = [];
    for (let q = 0; q * WEEKS_PER_QUARTER < n; q++) out.push(sum(xs.slice(q * WEEKS_PER_QUARTER, (q + 1) * WEEKS_PER_QUARTER)));
    return out;
  };
  const quarters = byQuarter(total);
  const quarterSurprise = byQuarter(surprise);
  const quarterHedgedSurprise = byQuarter(hedgedSurprise);
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length));
  const rmsSurprise = rms(quarterSurprise);
  const rmsHedged = rms(quarterHedgedSurprise);
  const r: BusinessResult = {
    h,
    upstream,
    logistics,
    refinery,
    productionHedge,
    crackHedge,
    total,
    capital,
    production,
    runs: day.runs,
    quarters,
    expected,
    surprise,
    hedgedSurprise,
    quarterSurprise,
    quarterHedgedSurprise,
    rmsSurprise,
    rmsHedged,
    effectiveness: rmsSurprise > 0 ? 1 - (rmsHedged * rmsHedged) / (rmsSurprise * rmsSurprise) : 0,
    sums: {
      upstream: sum(upstream),
      logistics: sum(logistics),
      refinery: sum(refinery),
      productionHedge: sum(productionHedge),
      crackHedge: sum(crackHedge),
      total: sum(total),
      capital: sum(capital),
    },
    stats: summarize(total, 52),
    worstQuarter: Math.min(...quarters),
  };
  if (businessCache.size > 200) businessCache.clear();
  businessCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// Many histories (7.4, 7.5): the same physics with different luck.

/** The course's history first, then others drawn from the same physics. */
export const FAN_SEEDS = [2024, ...Array.from({ length: 29 }, (_, i) => i + 1)];

/** The p-quantile of a list (linear interpolation). */
export function quantile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, p * (s.length - 1)));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

/** Week-by-week P10/P50/P90 of a quantity across histories. */
export function fanOf(hp: HistoryParams, f: (w: HistoryWeek) => number, seeds = FAN_SEEDS): Band[] {
  const hs = seeds.map((seed) => oilHistory({ ...hp, seed }));
  const n = Math.min(...hs.map((h) => h.length));
  return Array.from({ length: n }, (_, i) => {
    const xs = hs.map((h) => f(h[i]));
    return { p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) };
  });
}

export interface BusinessFan {
  /** Each history's five-year operating cash and worst quarter, $ (in FAN_SEEDS order). */
  totals: number[];
  worstQuarters: number[];
  total: Band;
  worstQuarter: Band;
  /** Each quarter's operating cash across histories, $. */
  quarters: Band[];
  /** Each history's worst quarterly surprise after hedges (most negative), $. */
  worstSurprises: number[];
  worstSurprise: Band;
}

const fanCache = new Map<string, BusinessFan>();
/** The business across many histories. */
export function businessFan(b: OilBusiness = BUSINESS_DEFAULTS, hp: HistoryParams = {}, seeds = FAN_SEEDS): BusinessFan {
  const key = JSON.stringify([b, hp, seeds]);
  const hit = fanCache.get(key);
  if (hit) return hit;
  const runs = seeds.map((seed) => runBusiness(b, { ...hp, seed }));
  const totals = runs.map((r) => r.sums.total);
  const worstQuarters = runs.map((r) => r.worstQuarter);
  const worstSurprises = runs.map((r) => Math.min(...r.quarterHedgedSurprise));
  const band = (xs: number[]): Band => ({ p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) });
  const nq = Math.min(...runs.map((r) => r.quarters.length));
  const r: BusinessFan = {
    totals,
    worstQuarters,
    total: band(totals),
    worstQuarter: band(worstQuarters),
    quarters: Array.from({ length: nq }, (_, q) => band(runs.map((x) => x.quarters[q]))),
    worstSurprises,
    worstSurprise: band(worstSurprises),
  };
  if (fanCache.size > 100) fanCache.clear();
  fanCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// The company's minimum-variance hedges (7.5): Lesson 6.4's regression, for two hedges at once.

export interface BestHedges {
  /** Production hedge ratio and crack hedge ratio that leave the smallest quarterly surprise (within the plan's limits). */
  production: number;
  crack: number;
  /** The variance of the quarterly surprise they remove. */
  effectiveness: number;
}

/**
 * Least squares of the company's quarterly surprise on the two hedges' quarterly payoffs per unit
 * of ratio, solved for both ratios together and clipped to the plan's limits (then each re-fitted
 * with the other held, so a clipped answer is still the best available).
 */
export function bestHedges(b: OilBusiness = BUSINESS_DEFAULTS, hp: HistoryParams = {}): BestHedges {
  const unit = (production: number, crack: number) => runBusiness({ ...b, hedges: { ...b.hedges, production, crack } }, hp);
  const base = unit(0, 0);
  const p1 = unit(1, 0);
  const c1 = unit(0, 1);
  const s = base.quarterSurprise;
  const xp = p1.quarterHedgedSurprise.map((v, i) => v - s[i]);
  const xc = c1.quarterHedgedSurprise.map((v, i) => v - s[i]);
  const dot = (a: number[], c: number[]) => a.reduce((acc, v, i) => acc + v * c[i], 0);
  const app = dot(xp, xp);
  const acc = dot(xc, xc);
  const apc = dot(xp, xc);
  const bp = -dot(xp, s);
  const bc = -dot(xc, s);
  const det = app * acc - apc * apc;
  let rp = det !== 0 ? (bp * acc - bc * apc) / det : 0;
  let rc = det !== 0 ? (bc * app - bp * apc) / det : 0;
  const [pMin, pMax] = PLAN_LIMITS.production;
  const [cMin, cMax] = PLAN_LIMITS.crack;
  const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (rp < pMin || rp > pMax || rc < cMin || rc > cMax) {
    rp = clip(rp, pMin, pMax);
    rc = clip(acc > 0 ? (bc - rp * apc) / acc : 0, cMin, cMax);
    rp = clip(app > 0 ? (bp - rc * apc) / app : 0, pMin, pMax);
  }
  const resid = s.map((v, i) => v + rp * xp[i] + rc * xc[i]);
  const v0 = dot(s, s);
  return { production: rp, crack: rc, effectiveness: v0 > 0 ? 1 - dot(resid, resid) / v0 : 0 };
}

/**
 * The company's exposure in a week: how its daily cash moves with a $1/bbl rise in crude (every
 * crude-linked price together), in the crack (gasoline and diesel against crude), and in the
 * Kessler–Calder spread (WTI falling against the coast), $ per day.
 */
export function exposures(b: OilBusiness, week = 0, hp: HistoryParams = {}): { crude: number; crack: number; basis: number } {
  const r = runBusiness(b, hp);
  const w = r.h[Math.min(week, r.h.length - 1)];
  const day = refineryDay(b.refinery);
  const t = TERMS;
  const netShare = (1 - t.royalty) * (1 - t.productionTax);
  const bpd = r.production[Math.min(week, r.production.length - 1)];
  const coldwaterSlope = 1 + DIFF_SLOPE.coldwater * (1 - 62 / 79);
  const level = { ...w, brent: w.brent + 1, wti: w.wti + 1, calderCrude: w.calderCrude + 1, gasoline: w.gasoline + 1, diesel: w.diesel + 1, hsfo: w.hsfo + 1, coldwater: w.coldwater + coldwaterSlope, northfield: w.northfield + 1 };
  const crackUp = { ...w, gasoline: w.gasoline + 1, diesel: w.diesel + 1 };
  const basisUp = { ...w, wti: w.wti - 1, northfield: w.northfield - 1 };
  const refineryMove = (x: HistoryWeek) => refineryMargin(x, day) - refineryMargin(w, day);
  return {
    crude: bpd * netShare + refineryMove(level),
    crack: refineryMove(crackUp),
    basis: -bpd * netShare + b.logistics.firmSpace * 1000 + refineryMove(basisUp),
  };
}
