// Single-zone market clearing: merit order, uniform (pay-as-clear) and pay-as-bid settlement,
// and clearing against price-sensitive demand bids.

export interface Offer {
  id: string;
  /** MW offered. */
  mw: number;
  /** $/MWh. */
  price: number;
}

export interface Bid {
  id: string;
  mw: number;
  /** Highest price the buyer will pay, $/MWh. */
  price: number;
}

export interface StackStep {
  id: string;
  start: number;
  end: number;
  price: number;
}

/** Offers sorted cheapest first, with each step's position on the MW axis. Ties keep input order. */
export function supplyStack(offers: Offer[]): StackStep[] {
  const sorted = offers.map((o, i) => ({ o, i })).sort((a, b) => a.o.price - b.o.price || a.i - b.i);
  let cum = 0;
  return sorted.map(({ o }) => {
    const s = { id: o.id, start: cum, end: cum + o.mw, price: o.price };
    cum += o.mw;
    return s;
  });
}

export interface Clearing {
  /** Clearing price, $/MWh: the offer of the last unit needed. */
  price: number;
  /** Id of the marginal (price-setting) offer, or null if none was needed. */
  marginal: string | null;
  /** Accepted MW per offer. */
  dispatch: Record<string, number>;
  /** Demand that couldn't be met with the offers available, MW. */
  shortfall: number;
  stack: StackStep[];
}

/**
 * Meet a fixed demand with the cheapest offers. If offers run out, the price goes to
 * `priceCap` and the shortfall is reported.
 */
export function clearMeritOrder(offers: Offer[], demand: number, priceCap = 1000): Clearing {
  const stack = supplyStack(offers);
  const dispatch: Record<string, number> = Object.fromEntries(offers.map((o) => [o.id, 0]));
  let price = 0;
  let marginal: string | null = null;
  for (const s of stack) {
    const q = Math.max(0, Math.min(s.end - s.start, demand - s.start));
    dispatch[s.id] = q;
    if (q > 1e-9) {
      price = s.price;
      marginal = s.id;
    }
  }
  const supplied = stack.length ? stack[stack.length - 1].end : 0;
  const shortfall = Math.max(0, demand - supplied);
  if (shortfall > 1e-9) {
    price = priceCap;
    marginal = null;
  }
  return { price, marginal, dispatch, shortfall, stack };
}

/** Revenue per offer under the chosen payment rule. */
export function settle(offers: Offer[], c: Clearing, rule: 'uniform' | 'payAsBid' = 'uniform'): Record<string, number> {
  return Object.fromEntries(offers.map((o) => [o.id, c.dispatch[o.id] * (rule === 'uniform' ? c.price : o.price)]));
}

export interface TwoSidedClearing {
  price: number;
  quantity: number;
  sold: Record<string, number>;
  bought: Record<string, number>;
  /** Total surplus (buyers' value minus sellers' cost) of the accepted trades, $/h. */
  surplus: number;
}

/**
 * Clear supply offers against demand bids: accept trades while the next buyer values a MW
 * more than the next seller asks. The price is set by the marginal offer or bid.
 */
export function clearTwoSided(offers: Offer[], bids: Bid[]): TwoSidedClearing {
  const S = [...offers].sort((a, b) => a.price - b.price).map((o) => ({ ...o, left: o.mw }));
  const D = [...bids].sort((a, b) => b.price - a.price).map((d) => ({ ...d, left: d.mw }));
  const sold: Record<string, number> = Object.fromEntries(offers.map((o) => [o.id, 0]));
  const bought: Record<string, number> = Object.fromEntries(bids.map((b) => [b.id, 0]));
  let i = 0;
  let j = 0;
  let q = 0;
  let surplus = 0;
  let lastS: number | null = null;
  let lastD: number | null = null;
  while (i < S.length && j < D.length && D[j].price >= S[i].price) {
    const t = Math.min(S[i].left, D[j].left);
    S[i].left -= t;
    D[j].left -= t;
    sold[S[i].id] += t;
    bought[D[j].id] += t;
    surplus += t * (D[j].price - S[i].price);
    q += t;
    lastS = S[i].price;
    lastD = D[j].price;
    if (S[i].left <= 1e-9) i++;
    if (D[j].left <= 1e-9) j++;
  }
  // Price: the partially filled side sets it; if both steps closed exactly, take the midpoint
  // between the last accepted and the next rejected prices.
  let price = 0;
  if (lastS !== null && lastD !== null) {
    if (i < S.length && S[i].left < S[i].mw) price = S[i].price;
    else if (j < D.length && D[j].left < D[j].mw) price = D[j].price;
    else {
      const nextS = i < S.length ? S[i].price : Infinity;
      const nextD = j < D.length ? D[j].price : -Infinity;
      const lo = Math.max(lastS, nextD);
      const hi = Math.min(lastD, nextS);
      price = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : lastS;
    }
  }
  return { price, quantity: q, sold, bought, surplus };
}
