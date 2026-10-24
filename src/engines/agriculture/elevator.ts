// A country elevator through harvest: farmers' trucks bring corn in faster than trains and the
// ethanol plant take it away, and the bins in between have a fixed size. The elevator's main lever
// is its bid: the further below the terminal price it bids, the more farmers keep their corn on the
// farm for now — and the more the elevator earns on what it does buy.

export interface RushOptions {
  /** Corn harvested in the elevator's draw area, bushels. */
  harvest: number;
  /** How far below the terminal price the elevator bids, $ per bushel. */
  spread: number;
  /** Bin space, bushels. */
  capacity: number;
  /** Shuttle trains a week (each 400,000 bushels). */
  trainsPerWeek: number;
  /** Corn trucked to the ethanol plant each day, bushels. */
  localPerDay: number;
  /** Days the harvest runs. */
  days: number;
}

export const TRAIN_BUSHELS = 400000;
/** Handling cost per bushel through the elevator (labor, power, shrink), $. */
export const HANDLING = 0.08;

/**
 * Share of the harvest farmers sell at harvest rather than store on the farm, at a given spread:
 * half at a 35-cent spread, more when the elevator bids up, fewer when it bids down.
 */
export function harvestSales(spread: number): number {
  return Math.max(0.1, Math.min(0.9, 0.5 - 1.6 * (spread - 0.35)));
}

/** The harvest's daily pace: a bell over the harvest weeks, summing to 1. */
export function harvestPace(days: number): number[] {
  const raw = Array.from({ length: days }, (_, i) => Math.sin((Math.PI * (i + 0.5)) / days) ** 2);
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / s);
}

export interface RushResult {
  /** Bushels in the bins at the end of each day. */
  stocks: number[];
  delivered: number[];
  shipped: number[];
  /** Bushels farmers wanted to deliver but had to take elsewhere because the bins were full. */
  turnedAway: number;
  daysFull: number;
  bought: number;
  /** The elevator's margin on what it bought, $: spread less handling. */
  margin: number;
}

export function harvestRush(o: RushOptions): RushResult {
  const pace = harvestPace(o.days);
  const offered = o.harvest * harvestSales(o.spread);
  const trainPerDay = (o.trainsPerWeek * TRAIN_BUSHELS) / 7;
  let s = 0;
  let turned = 0;
  let full = 0;
  let bought = 0;
  const stocks: number[] = [];
  const delivered: number[] = [];
  const shipped: number[] = [];
  for (let d = 0; d < o.days; d++) {
    const want = offered * pace[d];
    const out = Math.min(s + want, o.localPerDay + trainPerDay);
    const room = o.capacity - (s - out);
    const take = Math.max(0, Math.min(want, room));
    if (take < want - 1) {
      turned += want - take;
      full++;
    }
    s = s + take - Math.min(s + take, out);
    bought += take;
    stocks.push(s);
    delivered.push(take);
    shipped.push(Math.min(out, s + out));
  }
  return { stocks, delivered, shipped, turnedAway: turned, daysFull: full, bought, margin: bought * (o.spread - HANDLING) };
}
