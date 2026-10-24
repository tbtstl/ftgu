// Number formats for the grain trade: bushels, bushels per acre, dollars and cents per bushel,
// inches of water. Minus signs are typographic, as in the framework's formatters.

import { fmt, usd } from '../../../framework';

/** "1,234 bu" */
export function bu(x: number, digits = 0): string {
  return `${fmt(x, digits)} bu`;
}

/** "182 bu/ac" */
export function buAc(x: number, digits = 0): string {
  return `${fmt(x, digits)} bu/ac`;
}

/** "$4.52/bu" */
export function perBu(x: number, digits = 2): string {
  return `${usd(x, digits)}/bu`;
}

/** Cents with a sign: "−35¢", "+12¢", "0¢". */
export function cents(dollars: number, digits = 0): string {
  const c = dollars * 100;
  const s = fmt(Math.abs(c), digits);
  const zero = Math.round(c * 10 ** digits) === 0;
  return (zero ? '' : c < 0 ? '−' : '+') + s + '¢';
}

/** Cents without a forced plus: "35¢", "−35¢". */
export function centsPlain(dollars: number, digits = 0): string {
  return `${fmt(dollars * 100, digits)}¢`;
}

/** "1.2 in" */
export function inch(x: number, digits = 1): string {
  return `${fmt(x, digits)} in`;
}

/** "24 °C" */
export function degC(x: number, digits = 0): string {
  return `${fmt(x, digits)} °C`;
}

/** Millions of bushels from bushels: "541 million bu". */
export function mbu(bushels: number, digits = 0): string {
  return `${fmt(bushels / 1e6, digits)} million bu`;
}

/** "1,400,000 acres" from thousands of acres. */
export function acres(kAc: number): string {
  return `${fmt(kAc * 1000)} acres`;
}

/** Dollars per acre: "$612/ac". */
export function perAcre(x: number, digits = 0): string {
  return `${usd(x, digits)}/ac`;
}
