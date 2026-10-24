// The capstone's farm business: a farm the reader designs — where it is, how big, how much corn,
// whether it is irrigated, which hybrid, how much bin space — run through the simulated market's
// seasons. Its crops come from the season model (Chapters 1–3), its costs from the farm budget
// (Chapter 2), its prices and storage returns from the market (Chapters 4–5).

import { CORN_ON_CORN_EXTRA_N, CORN_ON_CORN_PENALTY, PLAINS_IRRIGATION, WHEAT_ON_WHEAT_PENALTY, fieldSeason, variableCost, type FieldSpec } from './farm';
import { CHECKPOINTS, EXPIRY, FARM_STORAGE_PER_MONTH, FINAL_REPORT, HARVEST_START, INTEREST, MONTH_DAYS, cashBid, cropYear, decFutures, futures, portSpot } from './market';
import { harvestRush } from './elevator';
import { hedgeGain, season as hedgeSeason } from './hedging';
import { PREDICTORS, fitForecast, observe, type Fit } from './forecast';
import type { Hub } from './logistics';
import { BASE_PRICE, meanValley } from './world';
import { BUDGET, LAND_RENT, N_PRICE, PLAN_PRICE, PROPERTY_TAX, perBushelCost } from '../../model/agriculture/economics';
import { DISTRICT, dayOf, type DistrictId } from '../../model/agriculture/region';

export type Hybrid = 'early' | 'standard' | 'late';

export interface FarmDesign {
  district: DistrictId;
  /** Total acres, how many of them grow corn (the rest winter wheat), and how many the family owns (the rest are rented). */
  acres: number;
  cornAcres: number;
  owned: number;
  /** Center pivots on the corn. */
  irrigated: boolean;
  hybrid: Hybrid;
  /** On-farm bin space, bushels. */
  bins: number;
}

/** Cedar Bend as the course has known it. */
export const CEDAR_DESIGN: FarmDesign = { district: 'prairie', acres: 1600, cornAcres: 1000, owned: 1000, irrigated: false, hybrid: 'standard', bins: 125000 };

/** How much earlier or later than the district's usual hybrid each choice matures, degree days. */
export const HYBRID_SHIFT: Record<Hybrid, number> = { early: -150, standard: 0, late: 150 };

/** Points of moisture each hybrid usually needs dried away after harvest: a later hybrid matures later and dries less in the field (Lesson 2.4). */
export const HYBRID_DRYING: Record<Hybrid, number> = { early: 1.5, standard: 3, late: 5 };

/** What a center pivot costs a year per irrigated acre to own — about $800 an acre to install, over twenty years with interest and upkeep (simulated). */
export const PIVOT_COST_PER_ACRE = 85;

/** What a bushel of bin space costs a year: about $2.50 to build, depreciated over twenty years, with interest and repairs (simulated). */
export const BIN_COST_PER_BU = 0.24;

/** The elevator each district's farms sell to. */
export const ELEVATOR_OF: Record<DistrictId, Hub> = { north: 'halsted', plains: 'dunmore', prairie: 'fairview', ridge: 'ashby', bottoms: 'landing' };

/** When corn is sold at harvest, and when stored corn is sold. */
export const HARVEST_DAY = dayOf(10, 15);
export const STORED_UNTIL = EXPIRY.Jul;

export function cornSpec(d: FarmDesign): FieldSpec {
  return {
    district: d.district,
    crop: 'corn',
    irrigation: d.irrigated ? PLAINS_IRRIGATION : null,
    maturityGdd: DISTRICT[d.district].hybridGdd + HYBRID_SHIFT[d.hybrid],
  };
}

/**
 * Winter wheat isn't traded in our market. We price it at its plan price, $6.00 at harvest in a
 * normal year, moved in proportion to corn futures on the day it is sold — wheat and corn prices
 * move together much of the time, through feed demand.
 */
export function wheatPrice(year: number): number {
  return PLAN_PRICE.wheat * (decFutures(year, dayOf(7, 15)) / BASE_PRICE);
}

export interface FarmYear {
  year: number;
  cornYield: number;
  wheatYield: number;
  cornBushels: number;
  wheatBushels: number;
  irrigationInches: number;
  cornPrice: number;
  wheatPrice: number;
  revenue: number;
  variableCosts: number;
  fixedCosts: number;
  /** Revenue less every cost, before storage, $. */
  net: number;
  /** Bushels stored, and what storing them hedged until July earned after the farm's storage and interest costs, $. */
  stored: number;
  storageGain: number;
  /** The yearly cost of owning the bins, $. */
  binCost: number;
  /** Net with storage: the farm's year. */
  total: number;
}

/** What storing a bushel of corn at a district's elevator price, hedged with July futures, earns from harvest to mid-July, $ (Lesson 5.2). */
export function storagePerBushel(year: number, hub: Hub): number {
  const months = (STORED_UNTIL - HARVEST_DAY) / MONTH_DAYS;
  const c0 = cashBid(year, hub, HARVEST_DAY);
  const c1 = cashBid(year, hub, STORED_UNTIL);
  const hedge = futures(year, 'Jul', HARVEST_DAY) - futures(year, 'Jul', STORED_UNTIL);
  return c1 - c0 + hedge - months * FARM_STORAGE_PER_MONTH - (INTEREST / 12) * months * c0;
}

const yearCache = new Map<string, FarmYear>();

export function farmYear(d: FarmDesign, year: number): FarmYear {
  const k = JSON.stringify([d, year]);
  let r = yearCache.get(k);
  if (!r) {
    const cornAcres = Math.min(d.cornAcres, d.acres);
    const wheatAcres = d.acres - cornAcres;
    const afterWheat = Math.min(cornAcres, wheatAcres);
    const wheatAfterCorn = Math.min(cornAcres, wheatAcres);
    const c = fieldSeason(year, cornSpec(d));
    const w = fieldSeason(year, { district: d.district, crop: 'wheat' });
    const cornBushels = afterWheat * c.yield + (cornAcres - afterWheat) * c.yield * (1 - CORN_ON_CORN_PENALTY);
    const wheatBushels = wheatAfterCorn * w.yield + (wheatAcres - wheatAfterCorn) * w.yield * (1 - WHEAT_ON_WHEAT_PENALTY);
    const hub = ELEVATOR_OF[d.district];
    const cornPrice = cashBid(year, hub, HARVEST_DAY);
    const wp = wheatPrice(year);
    const revenue = cornBushels * cornPrice + wheatBushels * wp;
    const variableCosts =
      cornBushels * perBushelCost('corn', HYBRID_DRYING[d.hybrid]) +
      wheatBushels * perBushelCost('wheat') +
      cornAcres * variableCost('corn', c.irrigationTotal) +
      (cornAcres - afterWheat) * CORN_ON_CORN_EXTRA_N * N_PRICE +
      wheatAcres * variableCost('wheat');
    const machinery = (crop: 'corn' | 'wheat') => BUDGET[crop].filter((l) => l.kind === 'fixed').reduce((t, l) => t + l.perAcre, 0);
    const owned = Math.min(d.owned, d.acres);
    const fixedCosts =
      cornAcres * machinery('corn') +
      wheatAcres * machinery('wheat') +
      owned * PROPERTY_TAX +
      (d.acres - owned) * LAND_RENT[d.district] +
      (d.irrigated ? cornAcres * PIVOT_COST_PER_ACRE : 0);
    const net = revenue - variableCosts - fixedCosts;
    const stored = Math.min(d.bins, cornBushels);
    const storageGain = stored * storagePerBushel(year, hub);
    const binCost = d.bins * BIN_COST_PER_BU;
    r = {
      year,
      cornYield: cornAcres ? cornBushels / cornAcres : 0,
      wheatYield: wheatAcres ? wheatBushels / wheatAcres : 0,
      cornBushels,
      wheatBushels,
      irrigationInches: c.irrigationTotal,
      cornPrice,
      wheatPrice: wp,
      revenue,
      variableCosts,
      fixedCosts,
      net,
      stored,
      storageGain,
      binCost,
      total: net + storageGain - binCost,
    };
    if (yearCache.size > 20000) yearCache.clear();
    yearCache.set(k, r);
  }
  return r;
}

export function farmRecord(d: FarmDesign, years: number[]): FarmYear[] {
  return years.map((y) => farmYear(d, y));
}

export interface FarmSummary {
  mean: number;
  sd: number;
  /** The one-in-ten worst year. */
  p10: number;
  worst: number;
  /** Years with a loss. */
  losses: number;
}

export function summarizeFarm(xs: number[]): FarmSummary {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const s = [...xs].sort((a, b) => a - b);
  return { mean, sd, p10: s[Math.floor(0.1 * (s.length - 1))], worst: s[0], losses: xs.filter((x) => x < 0).length };
}

// ---------------------------------------------------------------------------------------------
// Seasons the history hasn't seen, and forecasts of the farm's own crop

/** Seasons 61–100: simulated seasons beyond the market history the reader has studied. */
export const NEW_SEASONS = Array.from({ length: 40 }, (_, i) => 61 + i);

/** Seasons the farm's forecasts are fitted on and judged on (none of them a market season). */
const FIT_TRAIN = Array.from({ length: 200 }, (_, i) => 101 + i);
const FIT_TEST = Array.from({ length: 100 }, (_, i) => 301 + i);

export interface FarmFit {
  day: number;
  fit: Fit;
}

const fitCache = new Map<string, FarmFit[]>();
const statCache = new Map<string, { mean: number; sd: number }>();

function designKey(d: FarmDesign): string {
  return JSON.stringify([d.district, d.irrigated, d.hybrid]);
}

/** The farm's corn yield per acre with nothing yet known: its average and spread over seasons 101–400. */
export function farmClimatology(d: FarmDesign): { mean: number; sd: number } {
  const k = designKey(d);
  let s = statCache.get(k);
  if (!s) {
    const ys = [...FIT_TRAIN, ...FIT_TEST].map((y) => fieldSeason(y, cornSpec(d)).yield);
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    s = { mean, sd: Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length) };
    statCache.set(k, s);
  }
  return s;
}

/**
 * Regressions of the farm's corn yield on what can be seen in its district by each checkpoint —
 * temperature, rain, satellite NDVI and crop condition, as in Lesson 3.4.
 */
export function farmFits(d: FarmDesign): FarmFit[] {
  const k = designKey(d);
  let f = fitCache.get(k);
  if (!f) {
    f = CHECKPOINTS.map((day) => {
      const set = (years: number[]) => years.map((y) => ({ ...observe(y, day, d.district), yield: fieldSeason(y, cornSpec(d)).yield }));
      return { day, fit: fitForecast(set(FIT_TRAIN), set(FIT_TEST), PREDICTORS) };
    });
    fitCache.set(k, f);
  }
  return f;
}

/** The farm's forecast of its own corn yield on day t of a season, bushels an acre: a most likely value and its spread. */
export function farmForecast(d: FarmDesign, year: number, t: number): { mean: number; sd: number } {
  const actual = fieldSeason(year, cornSpec(d)).yield;
  if (t >= FINAL_REPORT) return { mean: actual, sd: 0 };
  const done = farmFits(d).filter((f) => f.day <= t);
  const v = done.length ? { mean: done[done.length - 1].fit.predict(observe(year, done[done.length - 1].day, d.district)), sd: done[done.length - 1].fit.rmseTest } : farmClimatology(d);
  if (t < HARVEST_START) return v;
  const k = Math.min(1, (t - HARVEST_START) / (FINAL_REPORT - HARVEST_START));
  return { mean: (1 - k) * v.mean + k * actual, sd: (1 - k) * v.sd };
}

/** Bushels of corn the farm grows per acre-of-yield: corn after wheat at full yield, corn after corn a tenth less. */
export function cornAcreFactor(d: FarmDesign): number {
  const cornAcres = Math.min(d.cornAcres, d.acres);
  const afterWheat = Math.min(cornAcres, d.acres - cornAcres);
  return afterWheat + (cornAcres - afterWheat) * (1 - CORN_ON_CORN_PENALTY);
}

// ---------------------------------------------------------------------------------------------
// The merchant: an elevator that buys the district's corn at harvest, keeps some of it, and ships

export interface MerchantPlan {
  /** Harvest bid under the elevator's value, cents (Lesson 4.3). */
  spreadCents: number;
  /** When corn left in the bins after harvest is sold, hedged; 'none' sells it at harvest. */
  storeUntil: 'none' | 'Mar' | 'May' | 'Jul';
  /** Store only when the curve pays at least this share of full carry (Lesson 5.2). */
  storeMinCarry: number;
  /** Barge freight chartered before the season at the offered rate, million bushels (Lesson 5.3). */
  charterMillions: number;
}

/** The rate barge lines offer for a season's charter, booked before the crop is known, $ a bushel (simulated). */
export const CHARTER_RATE = 0.6;
/** What keeping corn in the elevator's own bins costs at the margin — fans, monitoring, shrink — $ a bushel a month (simulated). */
export const MERCHANT_STORAGE = 0.01;

/** The elevator's draw area and plant, as in Lesson 4.3. */
export const MERCHANT_RUSH = { harvest: 12e6, capacity: 3e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 };

export interface MerchantYear {
  year: number;
  /** The valley's corn harvest that season, million bushels. */
  valley: number;
  bought: number;
  turnedAway: number;
  /** Margins, $: buying at harvest, storing what was left in the bins, and the barge charter. */
  buying: number;
  stored: number;
  storage: number;
  charter: number;
  total: number;
}

function elevatorValue(year: number, hub: Hub, t: number): number {
  return portSpot(year, t) + cropYear(year).hubBasis[hub];
}

/** What a bushel kept in the elevator's bins from harvest to a contract's expiry, hedged, earns, $. */
export function merchantStorage(year: number, hub: Hub, until: 'Mar' | 'May' | 'Jul'): number {
  const months = (EXPIRY[until] - HARVEST_DAY) / MONTH_DAYS;
  const v0 = elevatorValue(year, hub, HARVEST_DAY);
  const v1 = elevatorValue(year, hub, EXPIRY[until]);
  const hedge = futures(year, until, HARVEST_DAY) - futures(year, until, EXPIRY[until]);
  return v1 - v0 + hedge - months * MERCHANT_STORAGE - (INTEREST / 12) * months * v0;
}

const merchantCache = new Map<string, MerchantYear>();

export function merchantYear(p: MerchantPlan, year: number, hub: Hub = 'fairview'): MerchantYear {
  const k = JSON.stringify([p, year, hub]);
  let r = merchantCache.get(k);
  if (!r) {
    const c = cropYear(year);
    const rush = harvestRush({ ...MERCHANT_RUSH, harvest: MERCHANT_RUSH.harvest * (c.valley / meanValley()), spread: p.spreadCents / 100 });
    const left = rush.stocks[rush.stocks.length - 1] ?? 0;
    const store = p.storeUntil !== 'none' && c.theta >= p.storeMinCarry - 1e-9;
    const stored = store ? left : 0;
    const storage = store && p.storeUntil !== 'none' ? stored * merchantStorage(year, hub, p.storeUntil) : 0;
    const charter = p.charterMillions * 1e6 * (-c.hubBasis.landing - CHARTER_RATE);
    r = { year, valley: c.valley, bought: rush.bought, turnedAway: rush.turnedAway, buying: rush.margin, stored, storage, charter, total: rush.margin + storage + charter };
    if (merchantCache.size > 20000) merchantCache.clear();
    merchantCache.set(k, r);
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// The trading desk: the farm and the merchant together, with a hedge on the farm's crop and
// trades on the September crop report

export interface DeskPlan {
  /** Share of the farm's expected corn sold (positive) or bought (negative) in December futures on March 1, percent. */
  hedgePct: number;
  /** Futures, or puts struck at the March futures price (puts only protect a crop: positive shares). */
  hedgeWith: 'futures' | 'puts';
  /** Contracts traded each September on the forecast of Lesson 5.4. */
  forecastContracts: number;
}

/** Costs of the desk's futures, as in Lesson 5.5: commissions and slippage, and interest on margin. */
const ROUND_TRIP = 0.01;
const INITIAL_MARGIN = 0.06;

const longInterestCache = new Map<number, number>();
/** Interest on margin for a long December position held March 1 to mid-October, per bushel. */
function longMarginInterest(year: number): number {
  let v = longInterestCache.get(year);
  if (v === undefined) {
    const f0 = decFutures(year, HEDGE_DAY_DESK);
    v = INITIAL_MARGIN * f0 * INTEREST * ((HARVEST_DAY - HEDGE_DAY_DESK) / 365);
    for (let t = HEDGE_DAY_DESK; t < HARVEST_DAY; t += 3) v += Math.max(0, f0 - decFutures(year, t)) * INTEREST * (3 / 365);
    longInterestCache.set(year, v);
  }
  return v;
}

const HEDGE_DAY_DESK = dayOf(3, 1);

/** The farm's expected corn, bushels: its average yield times its corn acres, with the rotation. */
export function expectedCorn(d: FarmDesign): number {
  return farmClimatology(d).mean * cornAcreFactor(d);
}

/** What the hedge on the farm's crop earned in a season, $. */
export function hedgeResult(d: FarmDesign, desk: DeskPlan, year: number): number {
  const q = (desk.hedgePct / 100) * expectedCorn(d);
  if (Math.abs(q) < 1) return 0;
  const s = hedgeSeason(year);
  if (desk.hedgeWith === 'puts') return Math.max(0, q) * hedgeGain(s, 'puts');
  if (q > 0) return q * hedgeGain(s, 'futures');
  return -q * (s.f1 - s.f0 - ROUND_TRIP - longMarginInterest(year));
}

/** One September report trade of Lesson 5.4, per bushel after costs: buy or sell on the analyst's forecast, close after the report. */
export function reportTrade(year: number): number {
  const sep1 = dayOf(9, 1);
  const f = decFutures(year, sep1);
  const fair = decFutures(year, sep1, 1);
  const exit = decFutures(year, dayOf(9, 12));
  const side = Math.sign(fair - f);
  return side === 0 ? 0 : side * (exit - f) - ROUND_TRIP;
}

export interface DeskYear {
  year: number;
  farm: number;
  merchant: number;
  hedge: number;
  forecast: number;
  total: number;
}

export function deskYear(d: FarmDesign, m: MerchantPlan, desk: DeskPlan, year: number): DeskYear {
  const farm = farmYear(d, year).total;
  const merchant = merchantYear(m, year, ELEVATOR_OF[d.district]).total;
  const hedge = hedgeResult(d, desk, year);
  const forecast = desk.forecastContracts * 5000 * reportTrade(year);
  return { year, farm, merchant, hedge, forecast, total: farm + merchant + hedge + forecast };
}
