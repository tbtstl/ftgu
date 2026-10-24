// The course's simulated market history: five years of weekly prices and fundamentals, generated
// from the physical model rather than taken from any market. Chapters 5–7 read it, and their
// strategies backtest on it. Because it is generated, the physical drivers — basin production,
// pipeline and storage capacity, refinery outages, supply shocks, the producer group's behavior —
// are parameters: change them and the history, and every strategy's results, change with them.
//
// Each week:
//   • World: demand (seasonal, growing, a little price-responsive) against non-group supply
//     (answering the price of a year before), the producer group (filling the gap, and if it
//     stabilizes, leaning against price moves with its spare capacity) and random outages. Stocks
//     absorb the difference; the Brent-like benchmark follows stocks (engines/oil/market).
//   • The inland hub: the crude network's closed-form prices (engines/oil/network) set the WTI-like
//     Kessler price from basin production and the Kessler–Calder line; when the line is full,
//     crude backs up into Kessler's tanks. Each hub's futures curve follows from its stocks
//     (theory of storage, Lesson 5.4).
//   • Products: world refinery runs (with spring and autumn maintenance and random outages) make
//     gasoline and distillate against seasonal demand; their stocks set the crack spreads, and
//     refiners lean their yields toward the richer product.
//   • Quality: high-sulfur fuel oil wanders around its usual discount to crude, and the sour and
//     heavy crudes' differentials follow it (slopes fitted to the Calder refinery model, Lesson 4.5).
// All prices are simulated; WTI and Brent are names for the model's two benchmarks.

import { WORLD, crackFromStocks, futuresCurve, inventoryPrice, PRODUCT_DEFAULTS } from '../../engines/oil/market';
import { NETWORK_DEFAULTS, hubPricesFast } from '../../engines/oil/network';
import { gaussian, rng } from '../random';

export interface HistoryParams {
  years?: number;
  seed?: number;
  /** Ridgeback Basin production at the start, kb/d, and its growth per year. */
  basinStart?: number;
  basinGrowth?: number;
  /** Kessler–Calder line capacity, kb/d, and an expansion (year it opens, kb/d added). */
  pipeline?: number;
  expansion?: { year: number; add: number } | null;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail?: number;
  /** Kessler's working storage, million barrels (bigger tanks fill and empty more slowly). */
  kesslerCapacity?: number;
  /** Refinery outages a year (each takes 0.5–1.5 mb/d of world runs for 2–8 weeks). */
  refineryOutages?: number;
  /** Supply outages a year (each 1.5–3.5 mb/d for 6–20 weeks). */
  supplyShocks?: number;
  /** Does the producer group use spare capacity to steady prices? */
  groupStabilizes?: boolean;
  /** Scale on the seasonal swings in demand. */
  seasonality?: number;
}

export const HISTORY_DEFAULTS: Required<Omit<HistoryParams, 'expansion'>> & { expansion: { year: number; add: number } | null } = {
  years: 5,
  seed: 2024,
  basinStart: 380,
  basinGrowth: 70,
  pipeline: 480,
  expansion: { year: 3, add: 300 },
  rail: 150,
  kesslerCapacity: 20,
  refineryOutages: 1.5,
  supplyShocks: 0.6,
  groupStabilizes: true,
  seasonality: 1,
};

export interface HistoryWeek {
  week: number;
  /** Years since the start, fractional. */
  t: number;
  worldStocks: number;
  /** The Brent-like coastal benchmark and the WTI-like inland one, $/bbl. */
  brent: number;
  wti: number;
  /** Futures for the next six months at Kessler (WTI) and the next two for Brent, $/bbl. */
  wtiCurve: number[];
  brentCurve: number[];
  kesslerFill: number;
  basinSupply: number;
  pipelineCapacity: number;
  /** Share of the Kessler–Calder line in use. */
  pipelineUse: number;
  /** World refinery runs and the runs lost to outages, mb/d. */
  runs: number;
  refineryOutage: number;
  supplyOutage: number;
  gasolineStock: number;
  distillateStock: number;
  /** Product prices at the coast and their cracks against Brent, $/bbl. */
  gasoline: number;
  diesel: number;
  gasolineCrack: number;
  dieselCrack: number;
  /** The 3:2:1 crack against WTI: (2 gasoline + 1 diesel − 3 crude) / 3, $/bbl. */
  crack321: number;
  hsfo: number;
  /** Physical crude prices: Northfield Sour at Kessler, Coldwater Heavy delivered to Port Calder. */
  northfield: number;
  coldwater: number;
  /** Aframax freight, Port Calder to Northport, $/bbl. */
  freight: number;
}

/** The fuel-oil sensitivity of each crude's differential, fitted to the Calder refinery model. */
export const DIFF_SLOPE = { northfield: 0.154, coldwater: 0.364 };

const cache = new Map<string, HistoryWeek[]>();

/** Generates (or returns the cached) weekly history for a set of physical drivers. */
export function oilHistory(params: HistoryParams = {}): HistoryWeek[] {
  const p = { ...HISTORY_DEFAULTS, ...params };
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(p.seed);
  const weeks = Math.round(p.years * 52);
  const out: HistoryWeek[] = [];

  // Event schedules, drawn up front so changing one driver doesn't reshuffle the others.
  const draw = (perYear: number, minSize: number, maxSize: number, minLen: number, maxLen: number, rr: () => number) => {
    const events: Array<{ start: number; len: number; size: number }> = [];
    let w = 0;
    while (true) {
      w += Math.ceil((-Math.log(1 - rr()) * 52) / Math.max(1e-6, perYear));
      if (w >= weeks || perYear <= 0) break;
      events.push({ start: w, len: Math.round(minLen + rr() * (maxLen - minLen)), size: minSize + rr() * (maxSize - minSize) });
    }
    return events;
  };
  const supplyEvents = draw(p.supplyShocks, 1.5, 3.5, 6, 20, rng(p.seed + 1));
  const refineryEvents = draw(p.refineryOutages, 0.5, 1.5, 2, 8, rng(p.seed + 2));
  const sizeAt = (events: Array<{ start: number; len: number; size: number }>, w: number) =>
    events.reduce((s, e) => s + (w >= e.start && w < e.start + e.len ? e.size : 0), 0);

  const P0 = WORLD.referencePrice;
  const prices: number[] = [];
  let stocks = WORLD.normalStocks;
  let demandNoise = 0;
  let priceNoise = 0;
  let fill = 0.55;
  let fillNoise = 0;
  let gStock = PRODUCT_DEFAULTS.normalGasoline;
  let dStock = PRODUCT_DEFAULTS.normalDistillate;
  let yieldShift = 0;
  let hsfoDisc = 17;
  let freightMult = 1;
  let gCrack = PRODUCT_DEFAULTS.gasolineCrack;
  let dCrack = PRODUCT_DEFAULTS.distillateCrack;
  const demandGrowth = 1.0;
  const nonGroupGrowth = 0.8;

  for (let w = 0; w < weeks; w++) {
    const t = w / 52;
    const phase = (2 * Math.PI * (w % 52)) / 52;
    const season = p.seasonality * (0.9 * Math.sin(phase - Math.PI / 2 - 0.6));
    const price = prices.length ? prices[prices.length - 1] : P0;
    const avg52 = prices.length ? prices.slice(-52).reduce((a, b) => a + b, 0) / Math.min(52, prices.length) : P0;
    const lagged = prices.slice(Math.max(0, prices.length - 78), Math.max(0, prices.length - 26));
    const lagAvg = lagged.length ? lagged.reduce((a, b) => a + b, 0) / lagged.length : P0;

    // World balance.
    demandNoise = 0.85 * demandNoise + 0.15 * gaussian(r);
    const trendDemand = WORLD.demand + demandGrowth * t;
    const demand = (trendDemand + season + 0.6 * demandNoise) * Math.pow(price / P0, -0.04) * Math.pow(avg52 / P0, -0.06);
    const nonGroup = (WORLD.nonGroup + nonGroupGrowth * t) * Math.pow(lagAvg / P0, 0.05);
    const groupBase = trendDemand - (WORLD.nonGroup + nonGroupGrowth * t) - WORLD.processingGains;
    const lean = p.groupStabilizes ? Math.max(-3, Math.min(3.4, 0.25 * (price - P0))) : 0;
    // A slow pull of stocks back toward normal: the market's long-run balancing.
    const pull = 0.0004 * (WORLD.normalStocks - stocks);
    const supplyOutage = sizeAt(supplyEvents, w);
    const supply = nonGroup + groupBase + lean + pull + WORLD.processingGains - supplyOutage;
    stocks += (supply - demand) * 7;
    priceNoise = 0.9 * priceNoise + 0.02 * gaussian(r);
    const brent = inventoryPrice(stocks) * Math.exp(priceNoise);
    prices.push(brent);

    // The inland hub.
    const basinSupply = p.basinStart + p.basinGrowth * t + 8 * gaussian(r);
    const pipelineCapacity = p.pipeline + (p.expansion && t >= p.expansion.year ? p.expansion.add : 0);
    const net = { ...NETWORK_DEFAULTS, basinSupply, pipeline: pipelineCapacity, rail: p.rail, northportPrice: brent, floor: (brent * NETWORK_DEFAULTS.floor) / NETWORK_DEFAULTS.northportPrice };
    const hub = hubPricesFast(net);
    const surplus = basinSupply + Math.min(net.coldwaterSupply, net.coldwaterLine) - net.inlandDemand;
    const pipelineUse = Math.min(1, surplus / pipelineCapacity);
    const congestion = surplus > pipelineCapacity + p.rail ? 0.4 : surplus > pipelineCapacity ? 0.25 : 0;
    const worldFill = 0.55 + 7 * (stocks / WORLD.normalStocks - 1);
    // Local swings: crude backs up at the hub when refineries run less (spring and autumn
    // maintenance, outages) and draws down when they run hard; plus week-to-week noise.
    const runsSeasonNow = -0.012 * Math.exp(-(((w % 52) - 14) ** 2) / 18) - 0.01 * Math.exp(-(((w % 52) - 41) ** 2) / 18);
    fillNoise = 0.95 * fillNoise + 0.02 * gaussian(r);
    const local = -6 * runsSeasonNow - 0.06 * Math.cos(phase - 3.4) + 0.12 * sizeAt(refineryEvents, w) + fillNoise;
    const target = Math.max(0.1, Math.min(1, worldFill + congestion + local));
    const tau = Math.max(1, p.kesslerCapacity / 4);
    fill += (target - fill) / tau;
    const wti = hub.kessler + 0.3 * gaussian(r);
    const wtiCurve = futuresCurve({ fill, spot: wti, months: 6 });
    const brentCurve = futuresCurve({ fill: Math.max(0.1, Math.min(1, worldFill)), spot: brent, months: 2 });

    // Products.
    const runsSeason = -0.012 * Math.exp(-(((w % 52) - 14) ** 2) / 18) - 0.01 * Math.exp(-(((w % 52) - 41) ** 2) / 18);
    const refineryOutage = sizeAt(refineryEvents, w);
    const baseRuns = 83 + 0.8 * t;
    const runs = baseRuns * (1 + runsSeason) - refineryOutage;
    yieldShift = 0.9 * yieldShift + 0.1 * 0.015 * Math.max(-1, Math.min(1, (dCrack - gCrack - 10) / 10));
    const gy = 0.44 - yieldShift;
    const dy = 0.42 + yieldShift;
    const gSeason = PRODUCT_DEFAULTS.gasolineSeason[Math.floor(((w % 52) / 52) * 12)];
    const dSeason = PRODUCT_DEFAULTS.distillateSeason[Math.floor(((w % 52) / 52) * 12)];
    const scale = baseRuns / 83;
    gStock += (runs * gy - PRODUCT_DEFAULTS.gasolineDemand * scale * (1 + (gSeason - 1) * p.seasonality)) * 7;
    dStock += (runs * dy - PRODUCT_DEFAULTS.distillateDemand * scale * (1 + (dSeason - 1) * p.seasonality)) * 7;
    // Refiners and blenders lean against extremes: stocks drift back toward normal over months.
    gStock += 0.02 * (PRODUCT_DEFAULTS.normalGasoline - gStock);
    dStock += 0.02 * (PRODUCT_DEFAULTS.normalDistillate - dStock);
    gCrack = crackFromStocks(gStock, PRODUCT_DEFAULTS.normalGasoline, PRODUCT_DEFAULTS.gasolineCrack) + 0.8 * gaussian(r);
    dCrack = crackFromStocks(dStock, PRODUCT_DEFAULTS.normalDistillate, PRODUCT_DEFAULTS.distillateCrack) + 0.8 * gaussian(r);
    const gasoline = brent + gCrack;
    const diesel = brent + dCrack;
    const crack321 = (2 * gasoline + diesel) / 3 - wti;

    // Quality and freight.
    hsfoDisc = 0.95 * hsfoDisc + 0.05 * 17 + 1.0 * gaussian(r);
    const hsfo = brent - hsfoDisc;
    const northfield = wti - 5.0 + DIFF_SLOPE.northfield * (hsfo - 62 * (brent / P0));
    const coldwater = hub.calder - 16.2 + DIFF_SLOPE.coldwater * (hsfo - 62 * (brent / P0));
    freightMult = Math.max(0.5, 0.97 * freightMult + 0.03 + 0.05 * gaussian(r) + (r() < 0.01 ? 0.6 : 0));
    const freight = 2.57 * freightMult;

    out.push({
      week: w,
      t,
      worldStocks: stocks,
      brent,
      wti,
      wtiCurve,
      brentCurve,
      kesslerFill: fill,
      basinSupply,
      pipelineCapacity,
      pipelineUse,
      runs,
      refineryOutage,
      supplyOutage,
      gasolineStock: gStock,
      distillateStock: dStock,
      gasoline,
      diesel,
      gasolineCrack: gCrack,
      dieselCrack: dCrack,
      crack321,
      hsfo,
      northfield,
      coldwater,
      freight,
    });
  }
  if (cache.size > 60) cache.clear();
  cache.set(key, out);
  return out;
}
