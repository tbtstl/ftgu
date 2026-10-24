// Number formats for the natural gas course. Volumes follow North American practice: Mcf, MMcf
// and Bcf (thousand, million and billion standard cubic feet); energy in MMBtu; prices in $/MMBtu.

import { fmt, usd } from '../../../framework';

/** "$3.25": a gas price in dollars per MMBtu, two decimals. */
export function gp(x: number, digits = 2): string {
  return usd(x, digits);
}

/** "$3.25/MMBtu". */
export function perMMBtu(x: number, digits = 2): string {
  return usd(x, digits) + '/MMBtu';
}

/** "+$0.35" or "−$1.20": a basis or spread, signed. */
export function basis(x: number, digits = 2): string {
  const r = Math.round(x * 10 ** digits) / 10 ** digits;
  return (r > 0 ? '+' : '') + usd(x, digits);
}

/** "1,250 MMcf/d". */
export function mmcfd(x: number, digits = 0): string {
  return fmt(x, digits) + ' MMcf/d';
}

/** "1.80 Bcf/d". */
export function bcfd(x: number, digits = 2): string {
  return fmt(x, digits) + ' Bcf/d';
}

/** "62.5 Bcf". */
export function bcf(x: number, digits = 1): string {
  return fmt(x, digits) + ' Bcf';
}

/** "1,037 MMBtu". */
export function mmbtu(x: number, digits = 0): string {
  return fmt(x, digits) + ' MMBtu';
}

/** "1,000 psia". */
export function psiaFmt(x: number, digits = 0): string {
  return fmt(x, digits) + ' psia';
}

/** "1,000 psig". */
export function psigFmt(x: number, digits = 0): string {
  return fmt(x, digits) + ' psig';
}

/** "60 °F". */
export function degF(x: number, digits = 0): string {
  return fmt(x, digits) + ' °F';
}

/** "$1.2 million", "$350,000", "−$2.4 billion": money at a readable precision. */
export function money(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return usd(x / 1e9, a >= 1e10 ? 1 : 2) + ' billion';
  if (a >= 1e6) return usd(x / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + ' million';
  return usd(x);
}

/** Month abbreviations, January first. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
