// Storing grain: a bin of corn from harvest to the next summer, and the valley's whole inventory
// through a marketing year.
//
// Stored grain is alive: its kernels and the molds on them respire, slowly when cool and dry and
// fast when warm and wet. We track that as a spoilage index: the share of the grain's allowable
// storage time used up, where the allowable time roughly halves for every 5.6 °C (10 °F) warmer and every 1.5
// points of moisture wetter (a rule of thumb, scaled to our model). Aeration fans push cold autumn and
// winter air through the bin to chill the grain. Holding grain also costs money every month — the
// bin, the fans, and the interest on the grain's value.

import { simulatedYear, type DayWeather } from '../../model/agriculture/climate';
import { DRYING_PER_POINT } from '../../model/agriculture/economics';

/** Days corn keeps (to half a percent of dry matter lost) at 15.6 °C and 15% moisture. */
export const BASE_STORAGE_DAYS = 200;

/** Allowable storage time, days, at a grain temperature and moisture. */
export function allowableDays(tempC: number, moisture: number): number {
  return BASE_STORAGE_DAYS * Math.pow(2, (15.6 - Math.max(-5, tempC)) / 5.6) * Math.pow(2, (15 - moisture) / 1.5);
}

export interface BinOptions {
  /** Year whose weather the bin sits through (the next year supplies January onward). */
  year: number;
  district: 'prairie';
  /** Day the bin is filled. */
  fillDay: number;
  /** Days held. */
  days: number;
  /** Moisture at harvest and after drying, percent. */
  harvestMoisture: number;
  dryTo: number;
  aeration: boolean;
  /** Value of the grain, $ per bushel, for interest and for weight lost to over-drying. */
  price: number;
  /** Annual interest rate on the money tied up in the grain. */
  interest: number;
  /** Storage cost per bushel per month (bin, fans, insurance), $. */
  perMonth: number;
}

export interface BinDay {
  /** Days since filling. */
  t: number;
  /** Day of year (wrapping into the next year). */
  day: number;
  air: number;
  grain: number;
  /** Share of the allowable storage time used, 0 to 1+ (1 = spoiling). */
  spoilage: number;
  /** Cumulative cost per bushel, $. */
  cost: number;
}

export interface BinResult {
  days: BinDay[];
  /** Day index (t) when spoilage reached 1, or −1. */
  spoiledAt: number;
  costs: { drying: number; overdrying: number; storage: number; interest: number; total: number };
}

/** Weather from fill day into the next year. */
function weatherFrom(year: number, fillDay: number, days: number): DayWeather[] {
  const a = simulatedYear(year, 'prairie');
  const b = simulatedYear(year + 1, 'prairie');
  return Array.from({ length: days }, (_, i) => (fillDay + i < 365 ? a[fillDay + i] : b[(fillDay + i) % 365]));
}

export function simulateBin(o: BinOptions): BinResult {
  const w = weatherFrom(o.year, o.fillDay, o.days + 1);
  const recent = w.slice(0, 1).map((x) => (x.tmax + x.tmin) / 2)[0];
  let grain = recent + 8; // grain comes out of the dryer warmer than the air
  let spoil = 0;
  let spoiledAt = -1;
  const drying = Math.max(0, o.harvestMoisture - o.dryTo) * DRYING_PER_POINT;
  // Drying below 15% throws away weight that would have been sold: each point is ~1.2% of the bushel.
  const overdrying = Math.max(0, 15 - o.dryTo) * (1 / 85) * o.price;
  const out: BinDay[] = [];
  for (let t = 0; t <= o.days; t++) {
    const air = (w[t].tmax + w[t].tmin) / 2;
    const day = (o.fillDay + t) % 365;
    // Fans run when the air is cooler than the grain, from fill through March; the bin is sealed in warm months.
    const fanSeason = day >= 244 || day < 90;
    const k = o.aeration && fanSeason && air < grain - 1 ? 0.2 : 0.008;
    grain += k * (air - grain);
    spoil += 1 / allowableDays(grain, o.dryTo);
    if (spoil >= 1 && spoiledAt < 0) spoiledAt = t;
    const storage = (o.perMonth * t) / 30.4;
    const interest = (o.price * o.interest * t) / 365;
    out.push({ t, day, air, grain, spoilage: spoil, cost: drying + overdrying + storage + interest });
  }
  const storage = (o.perMonth * o.days) / 30.4;
  const interest = (o.price * o.interest * o.days) / 365;
  return { days: out, spoiledAt, costs: { drying, overdrying, storage, interest, total: drying + overdrying + storage + interest } };
}

// ---------------------------------------------------------------------------
// The valley's corn inventory through a marketing year (September–August).

export const MARKETING_MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
/** Share of the corn harvest that comes off the fields in each marketing month. */
export const HARVEST_PACE = [0.1, 0.5, 0.35, 0.05, 0, 0, 0, 0, 0, 0, 0, 0];

export interface InventoryOptions {
  /** Stocks carried in from last year, million bushels. */
  carryIn: number;
  /** This year's harvest, million bushels. */
  harvest: number;
  /** Corn used in the valley each month — ethanol, feed, food — million bushels. */
  domesticPerMonth: number;
  /** Exports over the year, million bushels, and the share shipped each month. */
  exports: number;
  exportPace: number[];
  /** Space to store grain: farm bins plus elevators, million bushels. */
  capacity: number;
}

export interface InventoryMonth {
  month: string;
  harvested: number;
  used: number;
  exported: number;
  /** Stocks at the end of the month, million bushels. */
  stocks: number;
  /** Grain with nowhere to go but a ground pile (stocks above capacity). */
  overflow: number;
}

/** Stocks month by month: what the harvest adds, and what use and exports take away. */
export function inventoryYear(o: InventoryOptions): InventoryMonth[] {
  let stocks = o.carryIn;
  const paceSum = o.exportPace.reduce((s, x) => s + x, 0) || 1;
  return MARKETING_MONTHS.map((month, i) => {
    const harvested = o.harvest * HARVEST_PACE[i];
    const used = o.domesticPerMonth;
    const exported = (o.exports * o.exportPace[i]) / paceSum;
    stocks = Math.max(0, stocks + harvested - used - exported);
    return { month, harvested, used, exported, stocks, overflow: Math.max(0, stocks - o.capacity) };
  });
}

/** Exports shipped evenly through the year, or front-loaded after harvest. */
export const EXPORT_PACE = {
  even: Array<number>(12).fill(1),
  harvest: [0.6, 1.4, 1.6, 1.4, 1.2, 1, 0.9, 0.8, 0.8, 0.8, 0.8, 0.7],
};
