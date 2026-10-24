// Buying a ship: what an owner pays, earns and is left holding, month by month through a history.
// A newbuilding is ordered with a deposit and paid off on delivery, `lag` months later; a
// secondhand ship is paid for and delivered at once. The ship trades on the spot market, earning the
// month's TCE on her earning days and paying operating costs every day. At the end she is worth what
// the market would pay for a ship of her age, valued the same way as in the cycle model.

import { OFF_HIRE_DAYS, type ClassId } from '../../model/shipping/trades';
import { classOpex, replacementEarnings, shipValue, type CycleMonth } from './cycle';

export type InvestKind = 'newbuild' | 'secondhand';

export interface InvestResult {
  kind: InvestKind;
  month: number;
  /** Price paid, $. */
  price: number;
  deliveryMonth: number;
  /** Totals over the holding period, $. */
  earnings: number;
  opex: number;
  /** Value of the ship at the end of the history, $. */
  endValue: number;
  /** Earnings − opex − price + end value, $. */
  profit: number;
  /** Annual rate of return on the cash flows (NaN if it can't be found). */
  irr: number;
  ageAtEnd: number;
  cashflows: number[];
}

const DAYS = 365 / 12;
/** Share of a newbuilding's price paid when it is ordered. */
export const DEPOSIT = 0.2;
/** Age of the secondhand ships on offer, years. */
export const SECONDHAND_AGE = 5;
/** Weight on the last year's earnings in valuing a ship (as in the cycle model). */
const MEMORY = 0.75;

export function irrAnnual(flows: number[]): number {
  const npv = (r: number) => flows.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
  let lo = -0.08;
  let hi = 0.2;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const m = (lo + hi) / 2;
  return (1 + m) ** 12 - 1;
}

/** The value of a ship of an age at the end of a history, $. */
export function valueAtEnd(id: ClassId, hist: CycleMonth[], age: number): number {
  const last12 = hist.slice(-12);
  const avg = last12.reduce((s, m) => s + m.tce, 0) / last12.length;
  const lr = replacementEarnings(id);
  return shipValue(id, age, MEMORY * avg + (1 - MEMORY) * lr, lr);
}

export function invest(id: ClassId, hist: CycleMonth[], kind: InvestKind, month: number, lag = 30): InvestResult {
  const T = hist.length;
  const opexDay = classOpex(id);
  const flows = Array<number>(T + 1).fill(0);
  let price: number;
  let delivery: number;
  let startAge: number;
  if (kind === 'newbuild') {
    price = hist[month].newbuild * 1e6;
    delivery = month + lag;
    flows[month] -= DEPOSIT * price;
    if (delivery <= T) flows[Math.min(delivery, T)] -= (1 - DEPOSIT) * price;
    startAge = 0;
  } else {
    price = hist[month].secondhand * 1e6;
    delivery = month;
    flows[month] -= price;
    startAge = SECONDHAND_AGE;
  }
  let earnings = 0;
  let opex = 0;
  for (let t = delivery; t < T; t++) {
    const e = hist[t].tce * DAYS * ((365 - OFF_HIRE_DAYS) / 365);
    const o = opexDay * DAYS;
    earnings += e;
    opex += o;
    flows[t] += e - o;
  }
  const ageAtEnd = startAge + Math.max(0, T - delivery) / 12;
  // A ship still on order at the end is worth what was paid (no gain or loss on paper).
  const endValue = delivery < T ? valueAtEnd(id, hist, ageAtEnd) : DEPOSIT * price;
  flows[T] += endValue;
  const profit = earnings - opex - (delivery < T || kind === 'secondhand' ? price : DEPOSIT * price) + endValue;
  return { kind, month, price, deliveryMonth: delivery, earnings, opex, endValue, profit, irr: irrAnnual(flows), ageAtEnd, cashflows: flows };
}
