// What it costs to own and run a ship for a day, and the earnings it needs to break even.
// All money in this course is illustrative: realistic in size, not quotes for any real ship.

import { ALBATROSS, KESTREL, PETREL, type VesselClass } from '../../model/shipping/vessels';

/** Daily operating costs, $/day: what it takes to keep a ship crewed, insured and in class. */
export interface Opex {
  crew: number;
  insurance: number;
  repairs: number;
  stores: number;
  management: number;
  drydock: number;
}

export const OPEX: Record<string, Opex> = {
  [KESTREL.id]: { crew: 3_000, insurance: 600, repairs: 900, stores: 700, management: 600, drydock: 500 },
  [ALBATROSS.id]: { crew: 3_200, insurance: 900, repairs: 1_300, stores: 900, management: 700, drydock: 800 },
  [PETREL.id]: { crew: 3_000, insurance: 550, repairs: 850, stores: 650, management: 600, drydock: 450 },
};

export const OPEX_LABEL: Record<keyof Opex, string> = {
  crew: 'Crew',
  insurance: 'Insurance',
  repairs: 'Repairs and maintenance',
  stores: 'Stores and lubricants',
  management: 'Management',
  drydock: 'Drydocking reserve',
};

export function opexTotal(o: Opex): number {
  return o.crew + o.insurance + o.repairs + o.stores + o.management + o.drydock;
}

/** Illustrative newbuilding prices, $ million. */
export const NEWBUILD_PRICE: Record<string, number> = {
  [KESTREL.id]: 36,
  [ALBATROSS.id]: 72,
  [PETREL.id]: 34,
};

/** Illustrative demolition price, $ per tonne of lightship. */
export const SCRAP_PER_LDT = 450;
/** Typical economic life of a bulk carrier, years. */
export const SHIP_LIFE = 25;

export function scrapValue(v: VesselClass, perLdt = SCRAP_PER_LDT): number {
  return v.lightship * perLdt;
}

export interface Financing {
  /** Purchase price, $. */
  price: number;
  /** Ship's age at purchase, years. */
  age: number;
  /** Share of the price borrowed. */
  ltv: number;
  /** Annual interest rate on the loan. */
  rate: number;
  /** Years over which the loan is repaid in equal installments. */
  tenor: number;
  /** Return the owner wants on its own money, per year. */
  equityReturn: number;
}

export interface DailyCost {
  opex: number;
  /** First-year interest, $/day. */
  interest: number;
  /** First-year principal repayment, $/day. */
  principal: number;
  /** Price less scrap value, spread over the remaining life, $/day. */
  depreciation: number;
  /** The owner's required return on its equity, $/day. */
  equity: number;
}

/** Annual payment on an amortizing loan. */
export function annuity(principal: number, rate: number, years: number): number {
  if (years <= 0) return principal;
  if (rate === 0) return principal / years;
  return (principal * rate) / (1 - (1 + rate) ** -years);
}

export function dailyCost(v: VesselClass, o: Opex, f: Financing): DailyCost {
  const loan = f.price * f.ltv;
  const payment = annuity(loan, f.rate, f.tenor);
  const interest = loan * f.rate;
  const principal = Math.max(0, payment - interest);
  const life = Math.max(1, SHIP_LIFE - f.age);
  const depreciation = Math.max(0, f.price - scrapValue(v)) / life;
  const equity = f.price * (1 - f.ltv) * f.equityReturn;
  return { opex: opexTotal(o), interest: interest / 365, principal: principal / 365, depreciation: depreciation / 365, equity: equity / 365 };
}

export interface Breakeven {
  /** TCE needed per earning day to pay opex and the loan's interest and principal. */
  cash: number;
  /** TCE needed to also cover depreciation and the owner's required return. */
  full: number;
}

/**
 * Break-even earnings per earning day. Costs run all 365 days; the ship earns only on the days she
 * isn't off hire (drydocking, repairs).
 */
export function breakeven(c: DailyCost, offHireDays: number): Breakeven {
  const earning = (365 - offHireDays) / 365;
  const cash = (c.opex + c.interest + c.principal) / earning;
  const full = (c.opex + c.interest + c.depreciation + c.equity) / earning;
  return { cash, full };
}

/** A year's result for a ship earning a TCE on its earning days: cash flow after debt service, and profit after depreciation. */
export function annualResult(tce: number, c: DailyCost, offHireDays: number): { revenue: number; cashFlow: number; profit: number } {
  const revenue = tce * (365 - offHireDays);
  const cashFlow = revenue - 365 * (c.opex + c.interest + c.principal);
  const profit = revenue - 365 * (c.opex + c.interest + c.depreciation);
  return { revenue, cashFlow, profit };
}
