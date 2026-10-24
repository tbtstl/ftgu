// The corn market the Crane Valley trades in: futures for No. 2 corn delivered onto ships at Port
// Sable, the cash price there and at each of the valley's elevators, and how all of them move through
// a crop year as the market learns about the harvest. It is built from the rest of the course: the
// world balance (world.ts) sets the futures price, the valley's network (logistics.ts) the gap between
// each elevator and the port, the elevator's harvest rush (elevator.ts) the harvest-time discount, and the
// yield forecasts of Chapter 3 (forecast.ts) what the market knows about the valley's crop and when.
// Every price here is simulated.
//
// Days are days of the year (0 = January 1) of a crop's growing year; the following year's days
// run on from 365.

import { HANDLING, harvestRush } from './elevator';
import { PREDICTORS, fitForecast, observe, type Fit } from './forecast';
import { DEFAULT_NETWORK, HUBS, routeCrop, scaleSupply, type Hub } from './logistics';
import { valleySeason } from './valley';
import { BASE_PRICE, REGION, US_OWN_SD, VALLEY_SHARE, meanValley, stocksAt, worldHistory, worldPrice, type HistoryYear, type RegionId } from './world';
import { DISTRICTS, dayOf, type DistrictId } from '../../model/agriculture/region';
import { gaussian, rng } from '../../model/random';

/** One corn futures contract: 5,000 bushels. */
export const CONTRACT_BUSHELS = 5000;
/** Commercial storage, $ a bushel a month, and the interest rate on money tied up in grain (Lesson 4.2). */
export const STORAGE_PER_MONTH = 0.035;
export const INTEREST = 0.07;
export const MONTH_DAYS = 30.4;

export const SEASON_START = dayOf(5, 1);
/** Dates on which the valley's crop is observed (Chapter 3's forecasts). */
export const CHECKPOINTS = [dayOf(6, 1), dayOf(7, 1), dayOf(8, 1), dayOf(9, 1)];
/** The government's monthly crop reports: the day each is released and the day its data describe. */
export const REPORTS = [
  { day: dayOf(8, 12), data: dayOf(8, 1) },
  { day: dayOf(9, 12), data: dayOf(9, 1) },
];
/** The November report, after which the harvest is known. */
export const FINAL_REPORT = dayOf(11, 9);
/** Harvest begins: from here to the November report, yields reported from the combines close in on the truth. */
export const HARVEST_START = dayOf(10, 1);

export type Contract = 'Dec' | 'Mar' | 'May' | 'Jul';
/** Each contract's last trading day; old-crop contracts expire in the year after harvest. */
export const EXPIRY: Record<Contract, number> = { Dec: dayOf(12, 14), Mar: 365 + dayOf(3, 14), May: 365 + dayOf(5, 14), Jul: 365 + dayOf(7, 14) };
export const CONTRACTS: Contract[] = ['Dec', 'Mar', 'May', 'Jul'];

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------------------------
// What can be known about the valley's crop, and when

/** Seasons the valley forecasts are fitted on and judged on — none of them in the market history. */
const TRAIN = range(101, 300);
const TEST = range(301, 400);

export function valleyCorn(year: number): number {
  return valleySeason(year).corn / 1e6;
}

export interface CheckpointFit {
  day: number;
  /** From temperature and rain alone: what anyone can see. */
  weather: Fit;
  /** With satellite NDVI and crop condition too: what a crop survey or a satellite analyst sees. */
  full: Fit;
}

let fitCache: CheckpointFit[] | null = null;
/** Regressions of the valley's corn production on what can be observed in the Black Prairie by each checkpoint. */
export function valleyFits(): CheckpointFit[] {
  if (!fitCache) {
    fitCache = CHECKPOINTS.map((day) => {
      const set = (years: number[]) => years.map((y) => ({ ...observe(y, day), yield: valleyCorn(y) }));
      const train = set(TRAIN);
      const test = set(TEST);
      return { day, weather: fitForecast(train, test, ['temp', 'rain']), full: fitForecast(train, test, PREDICTORS) };
    });
  }
  return fitCache;
}

let sdCache: number | null = null;
/** The spread of the valley's harvest with nothing yet known, million bushels. */
export function valleySd(): number {
  if (sdCache === null) {
    const m = meanValley();
    const v = range(1, 400).map(valleyCorn);
    sdCache = Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / v.length);
  }
  return sdCache;
}

export interface View {
  /** Expected valley corn, million bushels, and its uncertainty (standard deviation). */
  mean: number;
  sd: number;
}

function fitAt(day: number): CheckpointFit {
  return valleyFits().find((f) => f.day === day) as CheckpointFit;
}

/** A forecast of the valley's crop from what can be observed on a checkpoint. */
export function checkpointForecast(year: number, day: number, kind: 'weather' | 'full'): View {
  const f = fitAt(day)[kind];
  return { mean: f.predict(observe(year, day)), sd: f.rmseTest };
}

function weatherView(year: number, t: number): View {
  const pts: Array<{ day: number } & View> = [{ day: SEASON_START, mean: meanValley(), sd: valleySd() }, ...CHECKPOINTS.map((c) => ({ day: c, ...checkpointForecast(year, c, 'weather') }))];
  if (t <= pts[0].day) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].day) {
      const k = (t - pts[i - 1].day) / (pts[i].day - pts[i - 1].day);
      return { mean: pts[i - 1].mean + k * (pts[i].mean - pts[i - 1].mean), sd: pts[i - 1].sd + k * (pts[i].sd - pts[i - 1].sd) };
    }
  }
  return pts[pts.length - 1];
}

/** What a satellite analyst knows on day t: the full forecast as of the latest checkpoint. */
export function analystView(year: number, t: number): View {
  if (t >= FINAL_REPORT) return { mean: valleyCorn(year), sd: 0 };
  const done = CHECKPOINTS.filter((c) => c <= t);
  if (!done.length) return { mean: meanValley(), sd: valleySd() };
  return harvestNews(year, t, checkpointForecast(year, done[done.length - 1], 'full'));
}

/** As the harvest comes in, everyone's view closes in on the actual crop. */
function harvestNews(year: number, t: number, v: View): View {
  if (t < HARVEST_START) return v;
  const k = clamp((t - HARVEST_START) / (FINAL_REPORT - HARVEST_START), 0, 1);
  return { mean: (1 - k) * v.mean + k * valleyCorn(year), sd: (1 - k) * v.sd };
}

/**
 * What the market knows about the valley's crop on day t: the weather so far, plus whatever the
 * latest government report added beyond the weather. `analysts` is the share of the market that
 * also watches the satellites, between 0 and 1.
 */
export function marketView(year: number, t: number, analysts = 0): View {
  if (t >= FINAL_REPORT) return { mean: valleyCorn(year), sd: 0 };
  const w = weatherView(year, t);
  const done = REPORTS.filter((r) => r.day <= t);
  let mean = w.mean;
  let sd = w.sd;
  if (done.length) {
    const r = done[done.length - 1];
    const full = checkpointForecast(year, r.data, 'full');
    mean += full.mean - checkpointForecast(year, r.data, 'weather').mean;
    sd = Math.min(sd, full.sd);
  }
  if (analysts > 0) {
    const a = checkpointView(year, t);
    mean = analysts * a.mean + (1 - analysts) * mean;
    sd = analysts * a.sd + (1 - analysts) * sd;
  }
  return harvestNews(year, t, { mean, sd });
}

function checkpointView(year: number, t: number): View {
  const done = CHECKPOINTS.filter((c) => c <= t);
  return done.length ? checkpointForecast(year, done[done.length - 1], 'full') : { mean: meanValley(), sd: valleySd() };
}

// ---------------------------------------------------------------------------------------------
// What the rest of the world's harvests will be: learned gradually through the season

type Source = 'usOwn' | Exclude<RegionId, 'us'>;
const SOURCES: Source[] = ['usOwn', 'southAmerica', 'blackSea', 'china', 'importers'];
const SOURCE_SD: Record<Source, number> = {
  usOwn: US_OWN_SD,
  southAmerica: REGION.southAmerica.cropSd,
  blackSea: REGION.blackSea.cropSd,
  china: REGION.china.cropSd,
  importers: REGION.importers.cropSd,
};

/** Share of the season's news about the world's harvests that has arrived by day t. */
export function newsShare(t: number): number {
  return clamp((t - SEASON_START) / (FINAL_REPORT - SEASON_START), 0, 1);
}

const STEPS = 40;
const bridgeCache = new Map<number, Record<Source, number[]>>();

/** Each source's expected shock along the season: a Brownian bridge that ends at the true shock. */
function bridges(year: number): Record<Source, number[]> {
  let b = bridgeCache.get(year);
  if (!b) {
    const w = history(year);
    const r = rng(7000 + year * 13);
    const truth: Record<Source, number> = {
      usOwn: w.crop.us - VALLEY_SHARE * (w.valleyCorn / meanValley() - 1),
      southAmerica: w.crop.southAmerica,
      blackSea: w.crop.blackSea,
      china: w.crop.china,
      importers: w.crop.importers,
    };
    b = {} as Record<Source, number[]>;
    for (const s of SOURCES) {
      const free = [0];
      for (let k = 1; k <= STEPS; k++) free.push(free[k - 1] + gaussian(r) / Math.sqrt(STEPS));
      const end = truth[s] / SOURCE_SD[s];
      b[s] = free.map((x, k) => SOURCE_SD[s] * (x - (k / STEPS) * free[STEPS] + (k / STEPS) * end));
    }
    bridgeCache.set(year, b);
  }
  return b;
}

function expectedShocks(year: number, t: number): Record<Source, number> {
  const b = bridges(year);
  const x = newsShare(t) * STEPS;
  const i = Math.min(STEPS - 1, Math.floor(x));
  const k = x - i;
  return Object.fromEntries(SOURCES.map((s) => [s, b[s][i] + k * (b[s][i + 1] - b[s][i])])) as Record<Source, number>;
}

// ---------------------------------------------------------------------------------------------
// Prices

let hubGrid: { h: number[]; value: Array<Record<Hub, number>> } | null = null;

/**
 * Each elevator's location value less the export price, $ a bushel, as a function of the valley's
 * corn harvest (each district keeping its average share): the gap the valley's network puts
 * between the port and each elevator. From the linear program of Lesson 4.4.
 */
export function hubSpreads(h: number): Record<Hub, number> {
  if (!hubGrid) {
    const avg = averageSupply();
    const total = Object.values(avg).reduce((a, b) => a + b, 0);
    const hs = range(0, 124).map((i) => 240 + i * 5);
    hubGrid = {
      h: hs,
      value: hs.map((x) => {
        const r = routeCrop({ ...DEFAULT_NETWORK, supply: scaleSupply(avg, x / total) });
        return Object.fromEntries(HUBS.map((n) => [n, (r ? r.locationValue[n] : NaN) - DEFAULT_NETWORK.sable])) as Record<Hub, number>;
      }),
    };
  }
  const g = hubGrid;
  const x = clamp(h, g.h[0], g.h[g.h.length - 1]);
  const i = Math.min(g.h.length - 2, Math.floor((x - g.h[0]) / 5));
  const k = (x - g.h[i]) / 5;
  return Object.fromEntries(HUBS.map((n) => [n, g.value[i][n] + k * (g.value[i + 1][n] - g.value[i][n])])) as Record<Hub, number>;
}

let avgSupply: Record<DistrictId, number> | null = null;
function averageSupply(): Record<DistrictId, number> {
  if (!avgSupply) {
    const out = {} as Record<DistrictId, number>;
    for (const d of DISTRICTS) out[d.id] = 0;
    for (const y of range(1, 400)) {
      const s = valleySeason(y);
      for (const d of DISTRICTS) out[d.id] += ((d.cornKAc - d.irrigatedKAc) * s.districts[d.id].corn + d.irrigatedKAc * s.districts[d.id].cornIrrigated) / 1000 / 400;
    }
    avgSupply = out;
  }
  return avgSupply;
}

/** Production behind each source of news, million tonnes. */
const SOURCE_TONNES: Record<Source, number> = {
  usOwn: REGION.us.production,
  southAmerica: REGION.southAmerica.production,
  blackSea: REGION.blackSea.production,
  china: REGION.china.production,
  importers: REGION.importers.production,
};

/** The world's harvest outside the valley's share of it, as a change from normal, million tonnes. */
function restOfWorld(shocks: Record<Source, number>): number {
  return SOURCES.reduce((t, src) => t + SOURCE_TONNES[src] * shocks[src], 0);
}

/** How uncertain that change still is on day t (standard deviation), million tonnes. */
function restOfWorldSd(t: number): number {
  const left = 1 - newsShare(t);
  return Math.sqrt(left * SOURCES.reduce((v, src) => v + (SOURCE_TONNES[src] * SOURCE_SD[src]) ** 2, 0));
}

/**
 * Corn at Port Sable at harvest, $ a bushel — the world price, which depends only on the world's
 * total supply — for a valley harvest of `h` million bushels and a change of `rest` million tonnes in
 * everyone else's.
 */
export function portValue(h: number, rest: number, carryIn: number): number {
  return worldPrice({ us: VALLEY_SHARE * (h / meanValley() - 1), importers: rest / REGION.importers.production }, carryIn);
}

/** Five-point Gauss–Hermite quadrature for a standard normal: nodes and weights. */
const GH: Array<[number, number]> = [
  [0, 0.533333333333333],
  [1.355626179974266, 0.222075922005613],
  [-1.355626179974266, 0.222075922005613],
  [2.856970013872806, 0.011257411327721],
  [-2.856970013872806, 0.011257411327721],
];

/**
 * The December futures price on day t of a crop's growing year: what the market expects corn at
 * Port Sable to fetch in December, averaged over what it doesn't yet know about the valley's
 * harvest and everyone else's.
 */
export function decFutures(year: number, t: number, analysts = 0): number {
  const y = history(year);
  if (t >= FINAL_REPORT) return portValue(y.valleyCorn, restOfWorld(expectedShocks(year, FINAL_REPORT)), y.carryIn);
  const v = marketView(year, t, analysts);
  const rest = restOfWorld(expectedShocks(year, t));
  const rsd = restOfWorldSd(t);
  let e = 0;
  for (const [z, w] of GH) {
    const h = Math.max(150, v.mean + v.sd * z);
    for (const [z2, w2] of GH) e += w * w2 * portValue(h, rest + rsd * z2, y.carryIn);
  }
  return e;
}

/** The market's expected world price on day t, at its central view of every harvest. */
export function expectedWorld(year: number, t: number, analysts = 0): number {
  const y = history(year);
  const v = marketView(year, t, analysts);
  const rest = restOfWorld(expectedShocks(year, t));
  return worldPrice({ us: VALLEY_SHARE * (v.mean / meanValley() - 1), importers: rest / REGION.importers.production }, y.carryIn);
}

/** The world's stocks-to-use ratio (outside China) at a world price. */
export function stocksToUseAt(price: number): number {
  let use = 0;
  for (const id of ['us', 'southAmerica', 'blackSea', 'importers'] as RegionId[]) use += REGION[id].use * Math.pow(price / BASE_PRICE, -REGION[id].elasticity);
  return stocksAt(price) / use;
}

/**
 * The share of full carry the futures spreads pay at a stocks-to-use ratio: the supply-of-storage
 * curve. Near 1 when stocks are plentiful; below zero — an inverted market — when they are scarce.
 */
export function carryShare(su: number): number {
  return Math.max(-1.5, 1 - 1.2 * Math.exp(-(su - 0.08) / 0.0185));
}

/** The full cost of carrying a bushel worth `price` for a month, $: storage plus interest. */
export function fullCarry(price: number): number {
  return STORAGE_PER_MONTH + (INTEREST / 12) * price;
}

// ---------------------------------------------------------------------------------------------
// A crop year

let historyAll: HistoryYear[] = [];
/** The world history of Lesson 4.5. Lessons use its first sixty years; later years exist for finishing a crop year and for tests. */
export const MARKET_YEARS = 60;
export function history(year: number): HistoryYear {
  if (historyAll.length < year) historyAll = worldHistory(Math.max(MARKET_YEARS + 2, year + 1));
  return historyAll[year - 1];
}

export interface CropYear {
  year: number;
  world: HistoryYear;
  valley: number;
  /** December futures at expiry: corn at Port Sable in mid-December — the world price. */
  decFinal: number;
  /** The share of full carry the old-crop spreads pay this year, and the full carry per month. */
  theta: number;
  carry: number;
  /** Fairview's harvest bid below the terminal: the narrowest spread that turns no farmer away (Lesson 4.3). */
  harvestSpread: number;
  /** Each elevator's value less the port's this year: the network's part of the basis. */
  hubBasis: Record<Hub, number>;
}

const yearCache = new Map<number, CropYear>();

const RUSH = { harvest: 12e6, capacity: 3e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 };

/** The narrowest whole-cent spread, at least 35 cents, at which Fairview turns no farmer away in a harvest of `h` million bushels. */
const spreadCache = new Map<number, number>();
export function harvestSpread(h: number): number {
  const k = Math.round(h);
  let v = spreadCache.get(k);
  if (v === undefined) {
    const harvest = RUSH.harvest * (k / meanValley());
    v = 0.9;
    for (let c = 35; c <= 90; c++) {
      if (harvestRush({ ...RUSH, harvest, spread: c / 100 }).turnedAway < 1) {
        v = c / 100;
        break;
      }
    }
    spreadCache.set(k, v);
  }
  return v;
}

export function cropYear(year: number): CropYear {
  let c = yearCache.get(year);
  if (!c) {
    const world = history(year);
    const valley = world.valleyCorn;
    const decFinal = decFutures(year, FINAL_REPORT);
    const theta = carryShare(world.stocksToUse);
    const hs = hubSpreads(valley);
    c = {
      year,
      world,
      valley,
      decFinal,
      theta,
      carry: fullCarry(decFinal),
      harvestSpread: harvestSpread(valley),
      hubBasis: hs,
    };
    yearCache.set(year, c);
  }
  return c;
}

const noiseCache = new Map<number, number[]>();
/** Demand news after harvest: a weekly random walk, as a share of the price, 10% a year. */
function demandNews(year: number, t: number): number {
  if (t <= EXPIRY.Dec) return 0;
  let w = noiseCache.get(year);
  if (!w) {
    const r = rng(9100 + year * 31);
    w = [0];
    for (let k = 1; k <= 45; k++) w.push(w[k - 1] + (0.1 / Math.sqrt(52)) * gaussian(r));
    noiseCache.set(year, w);
  }
  const x = (t - EXPIRY.Dec) / 7;
  const i = Math.min(w.length - 2, Math.floor(x));
  return w[i] + (x - i) * (w[i + 1] - w[i]);
}

/** Next year's December futures, seen from day t of this year's calendar. */
export function newCrop(year: number, t: number): number {
  return decFutures(year + 1, t - 365);
}

/** The carry share the market expects on day t: from the world price it expects. */
export function thetaOn(year: number, t: number): number {
  return t >= FINAL_REPORT ? cropYear(year).theta : carryShare(stocksToUseAt(expectedWorld(year, t)));
}

/**
 * Corn in store at Port Sable, $ a bushel, from the start of harvest (October 1) to the next
 * August. Before December's expiry it is December futures less the carry to December; after, it
 * earns the carry the market pays, moves with demand news, and — as far as stocks link the two
 * crops — with news about next year's harvest.
 */
export function portSpot(year: number, t: number): number {
  if (t < EXPIRY.Dec) {
    const dec = decFutures(year, t);
    return dec - thetaOn(year, t) * fullCarry(dec) * ((EXPIRY.Dec - t) / MONTH_DAYS);
  }
  const c = cropYear(year);
  const link = clamp(c.theta, 0, 1);
  return c.decFinal * (1 + demandNews(year, t)) + c.theta * c.carry * ((t - EXPIRY.Dec) / MONTH_DAYS) + link * (newCrop(year, t) - newCrop(year, EXPIRY.Dec));
}

/** A futures contract's price on day t (before it expires). Dec is this year's new crop; Mar, May and Jul are the old crop that follows. */
export function futures(year: number, contract: Contract, t: number): number {
  if (contract === 'Dec' && t < FINAL_REPORT) return decFutures(year, t);
  const tt = Math.min(t, EXPIRY[contract]);
  const spot = portSpot(year, tt);
  const theta = thetaOn(year, tt);
  const carryBase = tt < EXPIRY.Dec ? decFutures(year, tt) : cropYear(year).decFinal;
  return spot + theta * fullCarry(carryBase) * ((EXPIRY[contract] - tt) / MONTH_DAYS);
}

/** How much of the elevator's harvest spread is still in its bid on day t: all of it in October and early November, none by February. */
export function harvestPressure(t: number): number {
  const full = dayOf(11, 15);
  const gone = 365 + dayOf(2, 1);
  if (t <= full) return 1;
  return clamp(1 - (t - full) / (gone - full), 0, 1);
}

/** An elevator's cash bid on day t (from October 1 of the harvest year), $ a bushel. */
export function cashBid(year: number, hub: Hub, t: number): number {
  const c = cropYear(year);
  const margin = HANDLING + (c.harvestSpread - HANDLING) * harvestPressure(t);
  return portSpot(year, t) + c.hubBasis[hub] - margin;
}

/** The nearest futures contract not yet in its delivery month on day t. */
export function nearby(t: number): Contract {
  if (t < dayOf(12, 1)) return 'Dec';
  if (t < 365 + dayOf(3, 1)) return 'Mar';
  if (t < 365 + dayOf(5, 1)) return 'May';
  return 'Jul';
}

// ---------------------------------------------------------------------------------------------
// Options

/** The standard normal cumulative distribution (Abramowitz and Stegun 7.1.26, error under 1e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/** Black's formula for an option on a futures price: F futures, K strike, vol annual, tau years, r interest. */
export function black76(kind: 'call' | 'put', F: number, K: number, vol: number, tau: number, r = INTEREST): number {
  if (tau <= 0 || vol <= 0) return Math.max(0, kind === 'call' ? F - K : K - F);
  const s = vol * Math.sqrt(tau);
  const d1 = (Math.log(F / K) + (s * s) / 2) / s;
  const d2 = d1 - s;
  const df = Math.exp(-r * tau);
  return kind === 'call' ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
}

/**
 * The volatility the model implies for December futures on day t, annualized: how uncertain the
 * December price still is, from what is left to learn about the valley's crop and the world's.
 */
export function decVolatility(year: number, t: number, analysts = 0): number {
  const tau = (EXPIRY.Dec - t) / 365;
  if (t >= FINAL_REPORT || tau <= 0) return 0.1;
  const y = history(year);
  const v = marketView(year, t, analysts);
  const rest = restOfWorld(expectedShocks(year, t));
  const dh = Math.max(5, v.sd);
  const dr = Math.max(1, restOfWorldSd(t));
  const lv = (h: number, r: number) => Math.log(portValue(h, r, y.carryIn));
  const valley = ((lv(v.mean + dh, rest) - lv(v.mean - dh, rest)) / 2) * (v.sd / dh);
  const world = ((lv(v.mean, rest + dr) - lv(v.mean, rest - dr)) / 2) * (restOfWorldSd(t) / dr);
  return Math.sqrt((valley * valley + world * world) / tau);
}

// ---------------------------------------------------------------------------------------------
// The curve at harvest, from the physical facts of a year

export interface CurveInputs {
  /** The valley's corn harvest, million bushels. */
  valley: number;
  /** Everyone else's harvest, as a change from normal (−0.05 = 5% short). */
  world: number;
  /** World stocks outside China carried in, million tonnes. */
  carryIn: number;
}

export interface HarvestCurve {
  /** The world price and its stocks-to-use ratio. */
  world: number;
  stocksToUse: number;
  /** Share of full carry the spreads pay, and full carry a month at the December price. */
  theta: number;
  carry: number;
  /** Futures on the day of the November report, by contract, and next year's December (new crop). */
  futures: Record<Contract, number>;
  newCrop: number;
  /** Fairview: its harvest spread, its bid in mid-October, and what it should bid in mid-July. */
  harvestSpread: number;
  harvestCash: number;
  julyCash: number;
  /** Each elevator's location value less the port's: the network's part of the basis. */
  hubBasis: Record<Hub, number>;
}

/** What a farmer's own bin costs to hold corn, $ a bushel a month, before interest (Lesson 4.2). */
export const FARM_STORAGE_PER_MONTH = 0.02;

/** The world's harvest outside the valley's share, million tonnes in a normal year. */
const WORLD_TONNES = SOURCES.reduce((t, s) => t + SOURCE_TONNES[s], 0);

/** The futures curve and Fairview's bids in a harvest with these physical facts. */
export function harvestCurve(c: CurveInputs): HarvestCurve {
  const rest = c.world * WORLD_TONNES;
  const world = worldPrice({ us: VALLEY_SHARE * (c.valley / meanValley() - 1), importers: rest / REGION.importers.production }, c.carryIn);
  const spreads = hubSpreads(c.valley);
  const dec = world;
  const su = stocksToUseAt(world);
  const theta = carryShare(su);
  const carry = fullCarry(dec);
  const at = (k: Contract) => dec + theta * carry * ((EXPIRY[k] - EXPIRY.Dec) / MONTH_DAYS);
  const fut = { Dec: dec, Mar: at('Mar'), May: at('May'), Jul: at('Jul') };
  const nextIn = stocksAt(world);
  const rsd = restOfWorldSd(SEASON_START);
  let next = 0;
  for (const [z, w] of GH) for (const [z2, w2] of GH) next += w * w2 * portValue(Math.max(150, meanValley() + valleySd() * z), rsd * z2, nextIn);
  const spread = harvestSpread(c.valley);
  const gap = spreads.fairview;
  const harvestDay = dayOf(10, 15);
  const harvestCash = dec - theta * carry * ((EXPIRY.Dec - harvestDay) / MONTH_DAYS) + gap - spread;
  const julyCash = fut.Jul + gap - HANDLING;
  return { world, stocksToUse: su, theta, carry, futures: fut, newCrop: next, harvestSpread: spread, harvestCash, julyCash, hubBasis: spreads };
}

/** Cedar Bend's return, $ a bushel, from storing corn in its own bins from mid-October to mid-July, hedged with July futures. */
export function storageReturn(c: HarvestCurve, months = 9): number {
  return c.julyCash - c.harvestCash - months * FARM_STORAGE_PER_MONTH - (INTEREST / 12) * months * c.harvestCash;
}

export interface BasisParts {
  /** What the network takes between the port and the elevator: freight and, when it is full, congestion. */
  network: number;
  /** The elevator's handling margin. */
  handling: number;
  /** The extra the elevator takes off at harvest to ration its bins (Lesson 4.3). */
  harvest: number;
  /** The cost of carrying corn to the nearby contract's delivery, as far as the curve pays it. */
  carry: number;
  /** The elevator's basis: the sum of the parts. */
  basis: number;
  /** The nearby contract and its price. */
  contract: Contract;
  futures: number;
}

/** An elevator's basis on day t of a crop year (from mid-October to mid-July), taken apart. */
export function basisParts(c: HarvestCurve, hub: Hub, t: number): BasisParts {
  const k = nearby(t);
  const network = c.hubBasis[hub];
  const handling = -HANDLING;
  const harvest = -(c.harvestSpread - HANDLING) * harvestPressure(t);
  const carry = -c.theta * c.carry * ((EXPIRY[k] - t) / MONTH_DAYS);
  return { network, handling, harvest, carry, basis: network + handling + harvest + carry, contract: k, futures: c.futures[k] };
}

/** When the valley's farmers sell at harvest: mid-October. */
export const HARVEST_SALE = dayOf(10, 15);

/** An elevator's basis at harvest under December futures, for a valley harvest of `h` million bushels and a curve paying `theta` of `carry` a month. */
export function harvestBasis(h: number, theta: number, carry: number, hub: Hub = 'fairview'): number {
  return hubSpreads(h)[hub] - harvestSpread(h) - theta * carry * ((EXPIRY.Dec - HARVEST_SALE) / MONTH_DAYS);
}

/** The harvest basis expected on day t by someone with a given view of the valley's crop. */
export function expectedHarvestBasis(year: number, t: number, view: View, hub: Hub = 'fairview'): number {
  const theta = thetaOn(year, t);
  const carry = fullCarry(decFutures(year, t));
  let e = 0;
  for (const [z, w] of GH) e += w * harvestBasis(Math.max(150, view.mean + view.sd * z), theta, carry, hub);
  return e;
}

/** The harvest basis that actually came: the elevator's bid under December futures in mid-October. */
export function realizedHarvestBasis(year: number, hub: Hub = 'fairview'): number {
  return cashBid(year, hub, HARVEST_SALE) - decFutures(year, HARVEST_SALE);
}
