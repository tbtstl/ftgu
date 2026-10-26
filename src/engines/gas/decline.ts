// Production decline and field development.
//
// Arps' decline curves describe how a well's rate falls: q(t) = qi / (1 + b·Di·t)^(1/b), where qi is
// the initial rate, Di the initial (nominal, instantaneous) decline rate per year and b the
// curvature: b = 0 is exponential decline, b = 1 harmonic, and shale wells early in life often look
// like b near 2. A "modified hyperbolic" curve switches to exponential decline once the decline
// rate falls to a terminal value Dmin, so the forecast can't run on forever.
//
// A field is a schedule of wells: its production is every well's curve, shifted to the month the
// well came on and added up.

import { gaussian, rng } from '../../model/random';
import { SANDHILL_WELL } from '../../model/gas/production';
import { DAYS_PER_MONTH, simulateTank } from './reservoir';

export interface Arps {
  /** Initial rate, MMcf/d. */
  qi: number;
  /** Initial nominal decline, per year. */
  di: number;
  /** Curvature: 0 exponential, 1 harmonic, above 1 typical of early shale production. */
  b: number;
  /** Terminal nominal decline per year; 0 or undefined for none. */
  dMin?: number;
}

/** Years at which a modified hyperbolic curve switches to its terminal exponential decline (Infinity if never). */
export function switchTime(a: Arps): number {
  if (!a.dMin || a.dMin <= 0) return Infinity;
  if (a.di <= a.dMin) return 0;
  if (a.b <= 1e-9) return Infinity;
  return (a.di / a.dMin - 1) / (a.b * a.di);
}

function hyperRate(qi: number, di: number, b: number, t: number): number {
  if (b <= 1e-9) return qi * Math.exp(-di * t);
  return qi / Math.pow(1 + b * di * t, 1 / b);
}

function hyperCum(qi: number, di: number, b: number, t: number): number {
  // MMcf/d × years → MMcf, multiplied by days per year.
  if (t <= 0) return 0;
  const d = 365.25;
  if (b <= 1e-9) return (d * qi * (1 - Math.exp(-di * t))) / di;
  if (Math.abs(b - 1) < 1e-9) return (d * qi * Math.log(1 + di * t)) / di;
  return ((d * qi) / ((1 - b) * di)) * (1 - Math.pow(1 + b * di * t, 1 - 1 / b));
}

/** Rate (MMcf/d) at time t (years). */
export function arpsRate(a: Arps, tYears: number): number {
  const ts = switchTime(a);
  if (tYears <= ts) return hyperRate(a.qi, a.di, a.b, tYears);
  const qs = hyperRate(a.qi, a.di, a.b, ts);
  return qs * Math.exp(-(a.dMin ?? 0) * (tYears - ts));
}

/** Cumulative production (MMcf) from 0 to t years. */
export function arpsCum(a: Arps, tYears: number): number {
  const ts = switchTime(a);
  if (tYears <= ts) return hyperCum(a.qi, a.di, a.b, tYears);
  const qs = hyperRate(a.qi, a.di, a.b, ts);
  const dm = a.dMin ?? 0;
  return hyperCum(a.qi, a.di, a.b, ts) + (365.25 * qs * (1 - Math.exp(-dm * (tYears - ts)))) / dm;
}

/** Instantaneous nominal decline rate (per year) at time t. */
export function declineAt(a: Arps, tYears: number): number {
  const ts = switchTime(a);
  if (tYears > ts) return a.dMin ?? 0;
  return a.di / (1 + a.b * a.di * tYears);
}

/** Average daily rate in each of `months` months (MMcf/d). */
export function arpsMonthly(a: Arps, months: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let m = 1; m <= months; m++) {
    const cum = arpsCum(a, m / 12);
    out.push((cum - prev) / DAYS_PER_MONTH);
    prev = cum;
  }
  return out;
}

/**
 * Estimated ultimate recovery (Bcf): cumulative production until the rate falls to the economic
 * limit (MMcf/d), or until `maxYears`, whichever comes first.
 */
export function arpsEur(a: Arps, econLimit = 0.1, maxYears = 30): { eurBcf: number; years: number } {
  if (arpsRate(a, maxYears) >= econLimit) return { eurBcf: arpsCum(a, maxYears) / 1000, years: maxYears };
  let lo = 0;
  let hi = maxYears;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (arpsRate(a, mid) > econLimit) lo = mid;
    else hi = mid;
  }
  return { eurBcf: arpsCum(a, lo) / 1000, years: lo };
}

/** First-year decline: the share of the initial rate lost over the first year. */
export function firstYearDecline(a: Arps): number {
  return 1 - arpsRate(a, 1) / a.qi;
}

/** Sum of monthly rates × days: Bcf. */
export function sumBcf(monthlyRates: number[]): number {
  return (monthlyRates.reduce((s, q) => s + q, 0) * DAYS_PER_MONTH) / 1000;
}

/**
 * The best Arps curve through a monthly rate history (least squares on the logarithm of the rate),
 * searching b over [0, bMax] and Di over a log grid. Months with zero rate are skipped.
 */
export function fitArps(history: number[], opts: { bMax?: number; dMin?: number } = {}): Arps {
  const pts = history.map((q, i) => ({ t: (i + 0.5) / 12, lq: Math.log(Math.max(q, 1e-9)), ok: q > 0 })).filter((p) => p.ok);
  const bMax = opts.bMax ?? 2;
  let best: Arps & { err: number } = { qi: history[0] ?? 1, di: 0.5, b: 0, dMin: opts.dMin, err: Infinity };
  for (let bi = 0; bi <= Math.round(bMax * 20); bi++) {
    const b = bi / 20;
    for (let k = 0; k <= 60; k++) {
      const di = 0.02 * Math.pow(10, k / 20); // 0.02 to 20 per year
      const shape = { qi: 1, di, b, dMin: opts.dMin };
      let sum = 0;
      const logs = pts.map((p) => Math.log(arpsRate(shape, p.t)));
      pts.forEach((p, j) => (sum += p.lq - logs[j]));
      const lqi = sum / pts.length;
      let err = 0;
      pts.forEach((p, j) => (err += (p.lq - lqi - logs[j]) ** 2));
      if (err < best.err) best = { qi: Math.exp(lqi), di, b, dMin: opts.dMin, err };
    }
  }
  return { qi: best.qi, di: best.di, b: best.b, dMin: best.dMin };
}

// ---------------------------------------------------------------------------
// The course's two kinds of well.

/**
 * A Ridgeback shale well, as it really produces in our model: held at 15 MMcf/d for its first two
 * months, then falling as 1/√t while the pressure disturbance spreads out from the fractures
 * (transient linear flow, which looks like Arps b = 2), until month 36, when the disturbance reaches
 * the edges of the rock the well drains and depletion takes over (hyperbolic, b = 0.5).
 */
export const RIDGEBACK_WELL = {
  /** Restricted initial rate, MMcf/d. */
  qCap: 15,
  /** Months on restricted rate. */
  capMonths: 2,
  /** Month transient linear flow ends. */
  linearEnds: 36,
  /** Boundary-dominated decline after that: initial nominal decline per year and b. */
  bdfDi: 0.35,
  bdfB: 0.5,
} as const;

/** The Ridgeback well's rate (MMcf/d) at time t in months since first production. */
export function ridgebackRate(tMonths: number, w = RIDGEBACK_WELL): number {
  if (tMonths <= w.capMonths) return w.qCap;
  if (tMonths <= w.linearEnds) return w.qCap * Math.sqrt(w.capMonths / tMonths);
  const q36 = w.qCap * Math.sqrt(w.capMonths / w.linearEnds);
  return hyperRate(q36, w.bdfDi, w.bdfB, (tMonths - w.linearEnds) / 12);
}

/** The Ridgeback well's average rate in each month (MMcf/d), integrating numerically. */
export function ridgebackMonthly(months = 360, w = RIDGEBACK_WELL): number[] {
  const out: number[] = [];
  const n = 20;
  for (let m = 0; m < months; m++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += ridgebackRate(m + (k + 0.5) / n, w);
    out.push(s / n);
  }
  return out;
}

/**
 * A recorded history: the true monthly rates with measurement noise (lognormal, `noise` standard
 * deviation) and an occasional month cut short by downtime. Seeded, so it's the same every visit.
 */
export function noisyHistory(rates: number[], seed: number, noise = 0.05, downtime = 0.06): number[] {
  const r = rng(seed);
  return rates.map((q) => {
    const down = r() < downtime ? 0.55 + 0.35 * r() : 1;
    return q * Math.exp(noise * gaussian(r)) * down;
  });
}

/**
 * A Sandhill conventional well: a vertical well in the field's permeable sandstone draining a closed
 * square mile, held at 600 psia with its rate capped at 8 MMcf/d (from the world's SANDHILL_WELL).
 */
export { SANDHILL_WELL };

export function sandhillMonthly(months = 360): number[] {
  const r = simulateTank(SANDHILL_WELL, months);
  const rates = r.months.map((m) => m.rate);
  while (rates.length < months) rates.push(0);
  return rates;
}

// ---------------------------------------------------------------------------
// Field development.

/** Field production (MMcf/d by month) from a drilling schedule: wellsOnline[m] wells start in month m. */
export function fieldProduction(wellsOnline: number[], typeWell: number[], months: number): number[] {
  const out = Array<number>(months).fill(0);
  wellsOnline.forEach((n, start) => {
    if (!n) return;
    for (let k = 0; start + k < months && k < typeWell.length; k++) out[start + k] += n * typeWell[k];
  });
  return out;
}

/** Production by the year the wells came online: one row per vintage, MMcf/d by month. */
export function productionByVintage(wellsOnline: number[], typeWell: number[], months: number, monthsPerVintage = 12): number[][] {
  const vintages = Math.ceil(wellsOnline.length / monthsPerVintage);
  return Array.from({ length: vintages }, (_, v) =>
    fieldProduction(
      wellsOnline.map((n, m) => (Math.floor(m / monthsPerVintage) === v ? n : 0)),
      typeWell,
      months,
    ),
  );
}

export interface FieldEconomics {
  /** Price the producer receives at the wellhead, $/MMBtu. */
  wellheadPrice: number;
  /** Share of revenue owed to the mineral owners. */
  royalty: number;
  /** Operating cost per Mcf produced: lifting, gathering and processing, $. */
  opexPerMcf: number;
  /** Capital cost of drilling and completing one well, $. */
  wellCost: number;
  /** Annual discount rate. */
  discount: number;
  /** MMBtu per Mcf of the gas sold. */
  mmbtuPerMcf: number;
}

export interface FieldCash {
  /** Net cash flow by month, $ (negative while drilling). */
  monthly: number[];
  /** Cumulative cash by month, $. */
  cumulative: number[];
  capex: number;
  revenue: number;
  /** Net present value of the monthly cash flows, $. */
  npv: number;
  /** Lowest point of the cumulative cash: the most money tied up, $ (negative). */
  maxExposure: number;
  /** First month cumulative cash turns positive for good, or null. */
  payoutMonth: number | null;
}

/** Monthly cash flows of a field development: revenue after royalty and operating cost, less drilling capital. */
export function fieldCash(wellsOnline: number[], rates: number[], e: FieldEconomics): FieldCash {
  const months = rates.length;
  const monthly: number[] = [];
  const cumulative: number[] = [];
  let cum = 0;
  let capex = 0;
  let revenue = 0;
  let npv = 0;
  let low = 0;
  let payout: number | null = null;
  const perMcf = e.wellheadPrice * e.mmbtuPerMcf * (1 - e.royalty) - e.opexPerMcf;
  for (let m = 0; m < months; m++) {
    const mcf = rates[m] * 1000 * DAYS_PER_MONTH;
    const rev = mcf * e.wellheadPrice * e.mmbtuPerMcf * (1 - e.royalty);
    const cap = (wellsOnline[m] ?? 0) * e.wellCost;
    const cash = mcf * perMcf - cap;
    capex += cap;
    revenue += rev;
    cum += cash;
    npv += cash / Math.pow(1 + e.discount, (m + 0.5) / 12);
    low = Math.min(low, cum);
    monthly.push(cash);
    cumulative.push(cum);
  }
  for (let m = months - 1; m >= 0; m--) {
    if (cumulative[m] <= 0) {
      payout = m + 1 < months ? m + 1 : null;
      break;
    }
    if (m === 0) payout = 0;
  }
  return { monthly, cumulative, capex, revenue, npv, maxExposure: low, payoutMonth: payout };
}
