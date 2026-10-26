// Corn on the Marlow plains: how a season's heat and rain set the yield, and how the yield sets a
// farm's revenue. Two stresses matter most. Heat: corn grows faster with warmth up to about
// 29–30 °C, but each hour above that does damage, worst around pollination in July; we count it
// as degree days of daily maximum above 86 °F in July and August. Water: too little rain from
// June through August cuts the yield, steeply; too much does some harm too.

import { archive, monthDays, tempF, type WorldKnobs } from '../../model/weather/archive';

/** Marlow's summer days run about 10 °F warmer at their peak than their mean. */
export const SUMMER_HALF_RANGE_F = 10;
export const HEAT_THRESHOLD_F = 86;

export interface SeasonWeather {
  /** Degree days of daily maximum above 86 °F, July and August. */
  heatDD: number;
  /** Rain from June through August, inches. */
  rainIn: number;
  /** Average daily mean temperature in July, °F. */
  julyF: number;
}

/** Marlow's growing-season weather in a year of the archive. */
export function seasonWeather(year: number, knobs: WorldKnobs = {}): SeasonWeather {
  const a = archive();
  let heatDD = 0;
  let julyF = 0;
  for (const m of [6, 7]) {
    const { start, days } = monthDays(year, m);
    for (let i = 0; i < days; i++) {
      const mean = tempF('marlow', start + i, knobs);
      heatDD += Math.max(0, mean + SUMMER_HALF_RANGE_F - HEAT_THRESHOLD_F);
      if (m === 6) julyF += mean / days;
    }
  }
  let rainIn = 0;
  for (const m of [5, 6, 7]) {
    const { start, days } = monthDays(year, m);
    for (let i = 0; i < days; i++) rainIn += a.rain.marlow[start + i];
  }
  return { heatDD, rainIn, julyF };
}

export interface YieldParams {
  /** Yield with no heat or water stress, bushels per acre. */
  potential: number;
  /** Share of the yield lost per heat degree day. */
  heatLoss: number;
  /** Rain below which drought starts to bite, inches. */
  dryBelow: number;
  /** Rain above which waterlogging starts, inches. */
  wetAbove: number;
}

export const YIELD_PARAMS: YieldParams = { potential: 249, heatLoss: 0.003, dryBelow: 13, wetAbove: 18 };

export interface YieldResult {
  /** Bushels per acre. */
  bushels: number;
  /** Share kept after heat stress, 0–1. */
  heatFactor: number;
  /** Share kept after water stress, 0–1. */
  waterFactor: number;
}

/** Share of the yield kept for a season's rain: a quadratic penalty below `dryBelow`, a gentler one above `wetAbove`. */
export function waterFactor(rainIn: number, p: YieldParams = YIELD_PARAMS): number {
  if (rainIn < p.dryBelow) return Math.max(0.2, 1 - 0.0065 * (p.dryBelow - rainIn) ** 2);
  if (rainIn > p.wetAbove) return Math.max(0.5, 1 - 0.003 * (rainIn - p.wetAbove) ** 2);
  return 1;
}

/** Share of the yield kept for a season's heat: exp(−loss × heat degree days). */
export function heatFactor(heatDD: number, p: YieldParams = YIELD_PARAMS): number {
  return Math.exp(-p.heatLoss * Math.max(0, heatDD));
}

export function cornYield(w: SeasonWeather, p: YieldParams = YIELD_PARAMS): YieldResult {
  const hf = heatFactor(w.heatDD, p);
  const wf = waterFactor(w.rainIn, p);
  return { bushels: p.potential * hf * wf, heatFactor: hf, waterFactor: wf };
}

/** The archive's yields at Marlow, one per year (1–41). */
export function yieldHistory(knobs: WorldKnobs = {}, p: YieldParams = YIELD_PARAMS): Array<SeasonWeather & YieldResult & { year: number }> {
  return Array.from({ length: 41 }, (_, i) => {
    const w = seasonWeather(i + 1, knobs);
    return { year: i + 1, ...w, ...cornYield(w, p) };
  });
}

// ---------------------------------------------------------------------------
// From yield to revenue.

export const FARM = {
  name: 'a Marlow corn farm',
  acres: 2000,
  /** Growing costs, including land rent, $ per acre. */
  costPerAcre: 780,
  /** Price of corn in a normal year, $ per bushel. */
  basePrice: 4.5,
  /** Yield in a normal year, bushels per acre (the archive's median). */
  normalYield: 180,
};

/**
 * Price of corn when the region's yield departs from normal. A 1% smaller national crop raises the
 * price by about `flexibility` percent; the region's yield moves the national crop in proportion
 * to its share of it.
 */
export function cornPrice(regionYield: number, nationalShare: number, flexibility = 2.5, base = FARM.basePrice, normal = FARM.normalYield): number {
  const change = regionYield / normal - 1;
  return Math.max(0.5 * base, base * (1 - flexibility * nationalShare * change));
}

export interface FarmSeason {
  bushels: number;
  price: number;
  revenue: number;
  cost: number;
  profit: number;
}

export function farmSeason(bushelsPerAcre: number, nationalShare: number, farm = FARM): FarmSeason {
  const price = cornPrice(bushelsPerAcre, nationalShare);
  const revenue = bushelsPerAcre * farm.acres * price;
  const cost = farm.costPerAcre * farm.acres;
  return { bushels: bushelsPerAcre * farm.acres, price, revenue, cost, profit: revenue - cost };
}
