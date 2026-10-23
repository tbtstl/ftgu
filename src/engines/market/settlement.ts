// Settlement arithmetic shared by market and trading lessons.

/**
 * Two-settlement system: a day-ahead position is paid at the day-ahead price, and any deviation
 * in real time is settled at the real-time price. Positive MW = selling (a generator).
 */
export function twoSettlement({ daMW, rtMW, daPrice, rtPrice }: { daMW: number; rtMW: number; daPrice: number; rtPrice: number }) {
  const dayAhead = daMW * daPrice;
  const realTime = (rtMW - daMW) * rtPrice;
  return { dayAhead, realTime, total: dayAhead + realTime };
}

/**
 * Virtual (financial) bids. An increment offer ("inc") sells day-ahead and buys back in real time;
 * a decrement bid ("dec") buys day-ahead and sells back in real time. Per MW per hour.
 */
export function virtualPnL(kind: 'inc' | 'dec', mw: number, daPrice: number, rtPrice: number): number {
  return kind === 'inc' ? mw * (daPrice - rtPrice) : mw * (rtPrice - daPrice);
}

/** Financial transmission right from source to sink: pays MW × (LMP_sink − LMP_source). */
export function ftrPayoff(mw: number, lmpSource: number, lmpSink: number): number {
  return mw * (lmpSink - lmpSource);
}

/**
 * Two-way contract for differences at a strike price. The generator side receives
 * MW × (strike − spot); combined with selling at spot, it locks in the strike.
 */
export function cfdPayoff(mw: number, strike: number, spot: number): number {
  return mw * (strike - spot);
}

/** Forward contract: seller delivers MW at the agreed price; value to the seller vs. spot. */
export function forwardPnL(side: 'buy' | 'sell', mw: number, forwardPrice: number, spot: number): number {
  return side === 'sell' ? mw * (forwardPrice - spot) : mw * (spot - forwardPrice);
}
