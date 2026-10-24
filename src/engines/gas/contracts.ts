// The contracts that turn the region's physical limits into money: rights to pipeline capacity,
// auctions for them, and futures on the hub price.
//
// A shipper with firm capacity on a pipeline from A to B can buy gas at A and sell it at B every
// day, so each unit of capacity (1 MMBtu/d) is worth, over a year, the sum of the days' price
// spreads beyond the cost of moving the gas. Interruptible capacity is cheaper because the
// pipeline may cut it, and it cuts it on exactly the days the pipe is full: the days the spread
// is wide.

/** A futures contract on the hub covers 10,000 MMBtu, delivered evenly through its month. */
export const FUTURES_CONTRACT_MMBTU = 10_000;

/** What one MMBtu/d of firm capacity earned over the days given: the sum of positive spreads net of the variable cost, $. */
export function firmCapacityValue(spreads: number[], variableCost: number): number {
  return spreads.reduce((s, x) => s + Math.max(0, x - variableCost), 0);
}

/**
 * What one MMBtu/d of interruptible capacity earned: it flows only on days the pipe has room
 * (`full[d]` false), paying the interruptible rate as well as the variable cost.
 */
export function interruptibleValue(spreads: number[], full: boolean[], variableCost: number, itRate: number): number {
  return spreads.reduce((s, x, d) => s + (full[d] ? 0 : Math.max(0, x - variableCost - itRate)), 0);
}

export interface CapacityBid {
  id: string;
  /** Capacity wanted, MMBtu/d. */
  units: number;
  /** Most the bidder will pay, $ per MMBtu/d of capacity per year. */
  price: number;
}

export interface AuctionResult {
  /** Capacity awarded to each bidder, MMBtu/d. */
  awards: Record<string, number>;
  /** Uniform price: the lowest accepted bid (or the reserve price if capacity is left over), $ per MMBtu/d-year. */
  clearingPrice: number;
  /** What the pipeline collects a year under the rule, $. */
  revenue: number;
  /** Capacity left unsold, MMBtu/d. */
  unsold: number;
}

/**
 * Sells `supply` MMBtu/d of capacity to the highest bids, no lower than `reserve`. Under the uniform
 * rule every winner pays the lowest accepted bid; under pay-as-bid each pays its own bid.
 */
export function capacityAuction(bids: CapacityBid[], supply: number, reserve = 0, rule: 'uniform' | 'payAsBid' = 'uniform'): AuctionResult {
  const sorted = bids.filter((b) => b.price >= reserve && b.units > 0).sort((a, b) => b.price - a.price);
  const awards: Record<string, number> = Object.fromEntries(bids.map((b) => [b.id, 0]));
  let left = supply;
  let lowest = reserve;
  for (const b of sorted) {
    if (left <= 1e-9) break;
    const take = Math.min(left, b.units);
    awards[b.id] = take;
    left -= take;
    lowest = b.price;
  }
  const clearingPrice = left > 1e-9 ? reserve : lowest;
  const revenue = rule === 'uniform' ? (supply - left) * clearingPrice : sorted.reduce((s, b) => s + awards[b.id] * b.price, 0);
  return { awards, clearingPrice, revenue, unsold: Math.max(0, left) };
}

/**
 * Daily marking to market of a futures position: `contracts` long (+) or short (−), opened at
 * `entry`, marked at each day's settlement price. Returns each day's variation margin and the
 * running total, $.
 */
export function futuresMarks(contracts: number, entry: number, settles: number[]): { daily: number[]; cumulative: number[] } {
  const daily: number[] = [];
  const cumulative: number[] = [];
  let prev = entry;
  let cum = 0;
  for (const p of settles) {
    const v = (p - prev) * contracts * FUTURES_CONTRACT_MMBTU;
    daily.push(v);
    cum += v;
    cumulative.push(cum);
    prev = p;
  }
  return { daily, cumulative };
}

/** Days on which an account starting with `initial` margin per contract would get a margin call (balance below `maintenance` per contract). */
export function marginCalls(contracts: number, cumulative: number[], initial: number, maintenance: number): number[] {
  const n = Math.abs(contracts);
  let balance = initial * n;
  let last = 0;
  const calls: number[] = [];
  cumulative.forEach((c, d) => {
    balance += c - last;
    last = c;
    if (balance < maintenance * n) {
      calls.push(d);
      balance = initial * n;
    }
  });
  return calls;
}
