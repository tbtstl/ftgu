// Strategy engine: a small trading book of physical and financial positions in one hour.
//
// The book can hold a generator selling its output in the real-time market, a virtual bid
// (inc or dec) and a two-way contract for differences. Each leg's P&L comes from the shared
// settlement arithmetic, so the payoffs here are the same ones the market lessons use.

import type { MarketDay } from '../../model/history';
import { cfdPayoff, virtualPnL } from '../market/settlement';

export interface Book {
  /** Physical output sold at the real-time price, MW. */
  genMW: number;
  /** The generator's running cost, $/MWh. */
  genCost: number;
  /** When true the plant switches off in hours where the real-time price is below its cost. */
  flexible: boolean;
  /** Virtual position, MW: positive is an inc (sell day-ahead, buy back in real time), negative a dec. */
  incMW: number;
  /** CfD sold, MW: positive receives strike − spot (the generator's side), negative pays it. */
  cfdMW: number;
  /** CfD strike, $/MWh. */
  strike: number;
}

export interface BookPnl {
  physical: number;
  virtual: number;
  cfd: number;
  total: number;
}

/** P&L of each leg of the book for one hour, given that hour's day-ahead and real-time prices, $. */
export function bookPnL(b: Book, da: number, rt: number): BookPnl {
  const runs = !b.flexible || rt >= b.genCost;
  const physical = runs ? b.genMW * (rt - b.genCost) : 0;
  const virtual = b.incMW >= 0 ? virtualPnL('inc', b.incMW, da, rt) : virtualPnL('dec', -b.incMW, da, rt);
  const cfd = cfdPayoff(b.cfdMW, b.strike, rt);
  return { physical, virtual, cfd, total: physical + virtual + cfd };
}

/**
 * Slope of the book's P&L with respect to the real-time price, $ per $1/MWh — its net MW of
 * exposure. A flat (fully hedged) book has slope 0. For a flexible plant this is the slope above its cost.
 */
export function bookExposure(b: Book): number {
  return b.genMW - b.incMW - b.cfdMW;
}

/**
 * The same book held in one hour of every historical day. A gas plant's running cost moves with
 * that day's gas price: `costAtGas1` is its cost when the gas multiplier is 1.
 */
export function bookHistory(days: MarketDay[], b: Book, hour: number, costAtGas1: number): BookPnl[] {
  const h = Math.max(0, Math.min(23, Math.round(hour)));
  return days.map((d) => bookPnL({ ...b, genCost: costAtGas1 * d.gas }, d.da[h], d.rt[h]));
}
