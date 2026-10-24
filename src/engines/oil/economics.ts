// Oil field economics (Lesson 2.5, and the capstone's production portfolio).
//
// A producer's cash flow, month by month: revenue at the wellhead price, less the royalty owner's
// share and production taxes, less operating costs, less capital when it's spent. Its value today
// is the net present value at a discount rate (the industry habitually quotes NPV at 10%, "PV-10").
// The breakeven price is the oil price at which NPV is zero.
// Fiscal terms here are illustrative but typical of onshore North America: a 20% royalty and a
// 4.6% production tax.

import { simulateField } from './decline';
import { rockOf, wellProfile, wellCost, type WellDesign } from './wells';

export interface Terms {
  /** Royalty owner's share of revenue. */
  royalty: number;
  /** Production (severance) tax on the producer's revenue. */
  productionTax: number;
  /** Wellhead price below the benchmark: gathering, transport to Kessler, quality, $/bbl. */
  differential: number;
  /** Operating cost per barrel produced, $. */
  opexPerBbl: number;
  /** Fixed operating cost per well per month, $. */
  fixedPerWellMonth: number;
  /** Annual discount rate. */
  discount: number;
}

export const TERMS: Terms = {
  royalty: 0.2,
  productionTax: 0.046,
  differential: 4,
  opexPerBbl: 8,
  fixedPerWellMonth: 8000,
  discount: 0.1,
};

/** Net value per barrel to the producer at a benchmark price, before operating costs. */
export function netbackPerBbl(price: number, t: Terms = TERMS): number {
  return (price - t.differential) * (1 - t.royalty) * (1 - t.productionTax);
}

/** Present value of monthly cash flows (index 0 = now), at an annual discount rate. */
export function npv(monthly: number[], annualRate: number): number {
  const m = Math.pow(1 + annualRate, 1 / 12);
  let s = 0;
  let f = 1;
  for (const c of monthly) {
    s += c / f;
    f *= m;
  }
  return s;
}

/** Internal rate of return (annual) of monthly cash flows; NaN if there is none in (−99%, 1000%). */
export function irr(monthly: number[]): number {
  let lo = -0.99;
  let hi = 10;
  const f = (r: number) => npv(monthly, r);
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A single well's monthly cash flows: capital in month 0, then production until the month's cash
 * turns negative (the well's economic limit), then nothing.
 */
export function wellCashFlows(rateBpd: number[], capital: number, price: number, t: Terms = TERMS): { cash: number[]; oil: number[] } {
  const per = netbackPerBbl(price, t) - t.opexPerBbl;
  const cash: number[] = [-capital];
  const oil: number[] = [0];
  for (const q of rateBpd) {
    const bbl = q * (365.25 / 12);
    const c = bbl * per - t.fixedPerWellMonth;
    if (c < 0) break;
    cash.push(c);
    oil.push(bbl);
  }
  return { cash, oil };
}

/** Price at which a cash-flow builder's NPV is zero (bisection over $0–$300). */
export function breakeven(npvAt: (price: number) => number, lo = 0, hi = 300): number {
  if (npvAt(hi) < 0) return NaN;
  if (npvAt(lo) >= 0) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (npvAt(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** The course's standard Ridgeback well: a 10,000 ft lateral with 50 fracture stages. */
export const STANDARD_WELL: WellDesign = { type: 'fractured', lateral: 10000, stages: 50 };

const profileCache = new Map<string, number[]>();
/** Monthly rates (b/d) of a Ridgeback well design, scaled by rock quality (1 = the core of the play). */
export function ridgebackRates(d: WellDesign = STANDARD_WELL, quality = 1): number[] {
  const key = `${d.type}|${d.lateral}|${d.stages}`;
  let r = profileCache.get(key);
  if (!r) {
    r = wellProfile(d, rockOf('ridgeback'), 360).rate;
    profileCache.set(key, r);
  }
  return quality === 1 ? r : r.map((q) => q * quality);
}

export function ridgebackWellCost(d: WellDesign = STANDARD_WELL): number {
  return wellCost(d, rockOf('ridgeback')).total;
}

export interface WellEconomics {
  npv: number;
  irr: number;
  /** Months until cumulative cash turns positive (NaN if never). */
  payback: number;
  /** Oil produced over the well's economic life, bbl. */
  eur: number;
  life: number;
  cash: number[];
}

export function wellEconomics(price: number, d: WellDesign = STANDARD_WELL, quality = 1, t: Terms = TERMS): WellEconomics {
  const { cash, oil } = wellCashFlows(ridgebackRates(d, quality), ridgebackWellCost(d), price, t);
  let run = 0;
  let payback = NaN;
  cash.forEach((c, i) => {
    run += c;
    if (Number.isNaN(payback) && i > 0 && run >= 0) payback = i;
  });
  return { npv: npv(cash, t.discount), irr: irr(cash), payback, eur: oil.reduce((a, b) => a + b, 0), life: cash.length - 1, cash };
}

/** Breakeven benchmark price of a Ridgeback well. */
export function wellBreakeven(d: WellDesign = STANDARD_WELL, quality = 1, t: Terms = TERMS): number {
  return breakeven((p) => wellEconomics(p, d, quality, t).npv);
}

// ---------------------------------------------------------------------------
// A development program: Ridgeback wells drilled each year, and Northfield's waterflood.

export interface Program {
  /** Ridgeback wells drilled per year, for each of the next five years. */
  wellsPerYear: number;
  /** Fund Northfield's waterflood, starting next year. */
  waterflood: boolean;
  price: number;
}

export const WATERFLOOD = {
  /** Injection wells, water plant and pipework, $. */
  capital: 300e6,
  /** Northfield's age today, years: it has been on pumps since natural flow ended. */
  fieldAge: 3,
  wells: 25,
};

const fieldCache = new Map<string, number[]>();
/** Northfield's monthly oil (b/d) from today, with or without the waterflood, at a price. */
export function northfieldMonthly(waterflood: boolean, price: number, months = 360): number[] {
  const key = `${waterflood}|${price}`;
  let r = fieldCache.get(key);
  if (!r) {
    const rows = simulateField({ drive: waterflood ? 'waterflood' : 'pumps', floodYear: WATERFLOOD.fieldAge + 1, wells: WATERFLOOD.wells, oilPrice: price, years: 60 });
    const yearly = rows.slice(WATERFLOOD.fieldAge).map((y) => y.oil);
    r = Array.from({ length: months }, (_, m) => yearly[Math.floor(m / 12)] ?? 0);
    if (fieldCache.size > 200) fieldCache.clear();
    fieldCache.set(key, r);
  }
  return r;
}

export interface ProgramResult {
  /** Monthly oil by source, b/d. */
  northfield: number[];
  flood: number[];
  ridgeback: number[];
  /** Monthly net cash, $. */
  cash: number[];
  capital: number;
  npv: number;
}

export function runProgram(p: Program, months = 240, t: Terms = TERMS): ProgramResult {
  const base = northfieldMonthly(false, p.price, months);
  const withFlood = p.waterflood ? northfieldMonthly(true, p.price, months) : base;
  const flood = withFlood.map((q, i) => Math.max(0, q - base[i]));
  const rates = ridgebackRates();
  const wellCapital = ridgebackWellCost();
  const ridgeback = Array<number>(months).fill(0);
  const cash = Array<number>(months).fill(0);
  let capital = 0;
  const per = netbackPerBbl(p.price, t) - t.opexPerBbl;
  // Northfield's existing wells: fixed costs are already in its field model's economic limit, so
  // count its oil at the margin per barrel here.
  for (let m = 0; m < months; m++) {
    const bbl = withFlood[m] * (365.25 / 12);
    cash[m] += bbl * per;
  }
  if (p.waterflood) {
    cash[0] -= WATERFLOOD.capital;
    capital += WATERFLOOD.capital;
  }
  // Ridgeback wells: spread evenly through each of the first five years.
  for (let y = 0; y < 5; y++) {
    for (let w = 0; w < p.wellsPerYear; w++) {
      const start = y * 12 + Math.floor((w * 12) / Math.max(1, p.wellsPerYear));
      const wc = wellCashFlows(rates, wellCapital, p.price, t);
      capital += wellCapital;
      for (let k = 0; k < wc.cash.length && start + k < months; k++) {
        cash[start + k] += wc.cash[k];
        if (k > 0) ridgeback[start + k] += wc.oil[k] / (365.25 / 12);
      }
    }
  }
  return { northfield: base, flood, ridgeback, cash, capital, npv: npv(cash, t.discount) };
}

// ---------------------------------------------------------------------------
// The course world's development projects, for a supply curve of breakevens.

export interface Project {
  id: string;
  name: string;
  /** Oil the project would produce over its life, million barrels. */
  volume: number;
  /** Full-cycle breakeven: the benchmark price that pays back capital at 10%, $/bbl. */
  fullCycle: number;
  /** Half-cycle breakeven: the price that covers only the costs of keeping it running, $/bbl. */
  halfCycle: number;
  /** Years from the decision to first oil. */
  leadTime: number;
}

/**
 * Breakevens for the world's projects. Ridgeback's are computed from the well model; the others
 * are set to sit at realistic levels for their kind of project.
 */
export function worldProjects(): Project[] {
  const core = wellBreakeven();
  const fringe = wellBreakeven(STANDARD_WELL, 0.65);
  const coreEur = wellEconomics(core + 20).eur / 1e6;
  const fringeEur = wellEconomics(fringe + 20, STANDARD_WELL, 0.65).eur / 1e6;
  const halfCycle = TERMS.differential + TERMS.opexPerBbl / ((1 - TERMS.royalty) * (1 - TERMS.productionTax));
  return [
    { id: 'flood', name: 'Northfield waterflood', volume: 75, fullCycle: 22, halfCycle: 14, leadTime: 1 },
    { id: 'core', name: 'Ridgeback core wells (300)', volume: 300 * coreEur, fullCycle: core, halfCycle, leadTime: 0.5 },
    { id: 'seaboard', name: 'Seaboard offshore expansion', volume: 180, fullCycle: 48, halfCycle: 18, leadTime: 5 },
    { id: 'coldwater', name: 'Coldwater steam project', volume: 220, fullCycle: 64, halfCycle: 32, leadTime: 4 },
    { id: 'fringe', name: 'Ridgeback fringe wells (400)', volume: 400 * fringeEur, fullCycle: fringe, halfCycle, leadTime: 0.5 },
  ].sort((a, b) => a.fullCycle - b.fullCycle);
}
