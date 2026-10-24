// Oil market price formation (Chapter 5, and the simulated history of Chapters 6–7).
//
// One stylized world market, in million barrels a day (mb/d):
//   supply = non-group producers (including the Ridgeback Basin) + a producer group that holds
//            spare capacity (like OPEC+) + refinery processing gains
//   demand = world consumption, seasonal, responding a little to price
// The gap between them changes commercial inventories, and inventories set price: when stocks are
// scarce relative to normal, each barrel on hand is worth more (Lesson 4.3's convenience yield).
// The model uses P = P* × (S / S*)^(−θ): a 5% stock deficit raises price by about a fifth at θ = 4.
// All numbers are illustrative and simulated; the magnitudes (about 100 mb/d of demand, about
// 2.8 billion barrels of commercial stocks) are realistic.

export const WORLD = {
  /** World oil demand, mb/d, at the reference price. */
  demand: 102.0,
  /** Seasonal swing in demand by quarter, mb/d (northern summer peak). */
  seasonal: [-0.8, -0.3, 1.0, 0.1],
  /** Supply from producers outside the group, mb/d. */
  nonGroup: 68.0,
  /** The producer group's production and its capacity, mb/d. */
  group: 31.6,
  groupCapacity: 35.0,
  /** Volume gained in refining (products take more room than the crude), mb/d. */
  processingGains: 2.4,
  /** Normal commercial stocks, million barrels. */
  normalStocks: 2800,
  /** Reference crude price (the Brent-like benchmark), $/bbl. */
  referencePrice: 79,
  /** How strongly price answers stocks: P = P*·(S/S*)^(−θ). */
  theta: 4,
};

export function seasonalDemand(quarter: number, base = WORLD.demand): number {
  return base + WORLD.seasonal[((quarter % 4) + 4) % 4];
}

/** Price from stocks. */
export function inventoryPrice(stocks: number, normal = WORLD.normalStocks, pStar = WORLD.referencePrice, theta = WORLD.theta): number {
  return pStar * Math.pow(Math.max(0.2, stocks / normal), -theta);
}

/** Stocks consistent with a price (the inverse of inventoryPrice). */
export function stocksForPrice(price: number, normal = WORLD.normalStocks, pStar = WORLD.referencePrice, theta = WORLD.theta): number {
  return normal * Math.pow(price / pStar, -1 / theta);
}

// ---------------------------------------------------------------------------
// The balance sheet (Lesson 5.1).

export interface BalanceInputs {
  /** Group production, mb/d. */
  group: number;
  /** Non-group supply in the first quarter, mb/d, and its growth per quarter. */
  nonGroup?: number;
  nonGroupGrowth?: number;
  /** Demand in the first quarter (before seasonality), and its growth per year, mb/d. */
  demand?: number;
  demandGrowth?: number;
  startStocks?: number;
  quarters?: number;
}

export interface BalanceRow {
  quarter: number;
  supply: number;
  nonGroup: number;
  group: number;
  gains: number;
  demand: number;
  /** Implied stock change, mb/d (supply − demand). */
  balance: number;
  /** Stocks at the end of the quarter, million barrels. */
  stocks: number;
}

/** Quarterly supply, demand and the implied change in stocks. */
export function balanceSheet(b: BalanceInputs): BalanceRow[] {
  const q = b.quarters ?? 8;
  let stocks = b.startStocks ?? WORLD.normalStocks;
  const rows: BalanceRow[] = [];
  for (let i = 0; i < q; i++) {
    const nonGroup = (b.nonGroup ?? WORLD.nonGroup) + (b.nonGroupGrowth ?? 0.15) * i;
    const demand = seasonalDemand(i, (b.demand ?? WORLD.demand) + ((b.demandGrowth ?? 1.0) * i) / 4);
    const supply = nonGroup + b.group + WORLD.processingGains;
    const balance = supply - demand;
    stocks += balance * 91.25;
    rows.push({ quarter: i, supply, nonGroup, group: b.group, gains: WORLD.processingGains, demand, balance, stocks });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Crude and product balances (Lesson 5.1's second demonstration).

export interface CrudeProductInputs {
  /** Crude production available to refiners, mb/d. */
  crudeSupply: number;
  /** Refinery runs by month, mb/d. */
  runs: number[];
  /** Product demand by month, mb/d, met from refinery output plus other liquids. */
  productDemand: number[];
  /** Liquids that bypass refineries (natural gas liquids, biofuels), mb/d. */
  otherLiquids: number;
  /** Refinery output per barrel of crude run (above 1: processing gain). */
  yieldFactor?: number;
}

export function crudeAndProductStocks(inp: CrudeProductInputs): Array<{ month: number; crudeChange: number; productChange: number; crudeStock: number; productStock: number }> {
  let crude = 0;
  let product = 0;
  const y = inp.yieldFactor ?? 1.03;
  return inp.runs.map((r, m) => {
    const crudeChange = inp.crudeSupply - r;
    const productChange = r * y + inp.otherLiquids - inp.productDemand[m];
    crude += crudeChange * 30.4;
    product += productChange * 30.4;
    return { month: m, crudeChange, productChange, crudeStock: crude, productStock: product };
  });
}

// ---------------------------------------------------------------------------
// Shocks and responses (Lesson 5.5, and the history generator).

export interface ShockInputs {
  months?: number;
  /** A supply outage: mb/d lost, starting month, duration in months. */
  outage?: { size: number; start: number; months: number };
  /** A fall in demand (a recession): mb/d, starting month, duration. */
  demandDrop?: { size: number; start: number; months: number };
  /** Strategic reserve release: mb/d, starting month, duration. */
  reserveRelease?: { rate: number; start: number; months: number };
  /** Does the group use its spare capacity to stabilize prices? */
  groupStabilizes?: boolean;
  /** Spare capacity the group holds, mb/d. */
  spare?: number;
  /** Short-run and long-run price elasticity of demand. */
  shortRunElasticity?: number;
  longRunElasticity?: number;
  /** Elasticity of non-group supply to the price six months earlier. */
  supplyElasticity?: number;
}

export interface ShockMonth {
  month: number;
  price: number;
  stocks: number;
  demand: number;
  supply: number;
  groupExtra: number;
  release: number;
}

export const SHOCK_DEFAULTS = {
  months: 24,
  spare: 3.4,
  shortRunElasticity: -0.04,
  longRunElasticity: -0.1,
  supplyElasticity: 0.05,
};

/**
 * A two-year monthly path from a balanced start. Each month, demand answers the current price
 * (short run) and the average of the past year's prices (long run); non-group supply answers the
 * average price of the year to six months ago (wells take months to drill and complete); the group,
 * if stabilizing, adds spare capacity in proportion to how far price is above the reference (or cuts
 * when below); stocks absorb the rest; price follows stocks.
 */
export function simulateShock(s: ShockInputs): ShockMonth[] {
  const T = s.months ?? SHOCK_DEFAULTS.months;
  const spare = s.spare ?? SHOCK_DEFAULTS.spare;
  const er = s.shortRunElasticity ?? SHOCK_DEFAULTS.shortRunElasticity;
  const elr = s.longRunElasticity ?? SHOCK_DEFAULTS.longRunElasticity;
  const es = s.supplyElasticity ?? SHOCK_DEFAULTS.supplyElasticity;
  const P0 = WORLD.referencePrice;
  const D0 = WORLD.demand;
  const N0 = WORLD.nonGroup;
  const G0 = D0 - N0 - WORLD.processingGains; // the group fills the balance at the start
  let stocks = WORLD.normalStocks;
  let price = P0;
  const history: number[] = [];
  const out: ShockMonth[] = [];
  const active = (e: { start: number; months: number } | undefined, m: number) => !!e && m >= e.start && m < e.start + e.months;
  for (let m = 0; m < T; m++) {
    const avg12 = history.length ? history.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, history.length) : P0;
    const past = history.slice(Math.max(0, history.length - 18), Math.max(0, history.length - 6));
    const lag6 = past.length ? past.reduce((a, b) => a + b, 0) / past.length : P0;
    let demand = D0 * Math.pow(price / P0, er) * Math.pow(avg12 / P0, elr - er);
    if (active(s.demandDrop, m)) demand -= s.demandDrop!.size;
    let supply = N0 * Math.pow(lag6 / P0, es) + G0 + WORLD.processingGains;
    if (active(s.outage, m)) supply -= s.outage!.size;
    let groupExtra = 0;
    if (s.groupStabilizes) {
      // Add (or cut) output in proportion to the price gap, within spare capacity.
      groupExtra = Math.max(-3, Math.min(spare, 0.25 * (price - P0)));
    }
    supply += groupExtra;
    const release = active(s.reserveRelease, m) ? s.reserveRelease!.rate : 0;
    stocks += (supply + release - demand) * 30.4;
    price = inventoryPrice(stocks);
    history.push(price);
    out.push({ month: m, price, stocks, demand, supply, groupExtra, release });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The futures curve (Lesson 5.4).

export interface CurveInputs {
  /** Stocks at the delivery hub as a share of its working capacity, 0–1. */
  fill: number;
  /** Spot price, $/bbl (default: from fill, via the hub's own stock–price relation). */
  spot?: number;
  /** Storage fee, $/bbl-month, and annual financing rate. */
  fee?: number;
  rate?: number;
  /** Convenience yield when the hub is empty, $/bbl-month, and how fast it falls as stocks rise. */
  cyMax?: number;
  cyDecay?: number;
  /** How quickly stocks drift back to normal along the curve, months. */
  meanReversion?: number;
  /** Fill considered normal. */
  normalFill?: number;
  /** Cost of storing at sea once tanks are full, $/bbl-month. */
  floatingCost?: number;
  months?: number;
}

export const CURVE_DEFAULTS = {
  fee: 0.4,
  rate: 0.06,
  cyMax: 6.0,
  cyDecay: 6.0,
  meanReversion: 18,
  normalFill: 0.55,
  floatingCost: 1.2,
  months: 24,
};

/** Convenience yield, $/bbl per month, at a hub fill. Large when tanks are near empty, near zero when full. */
export function convenienceYield(fill: number, cyMax = CURVE_DEFAULTS.cyMax, cyDecay = CURVE_DEFAULTS.cyDecay): number {
  return cyMax * Math.exp(-cyDecay * Math.max(0, fill));
}

/** Full carry: the most a month's spread can be while onshore tanks have room, $/bbl. */
export function fullCarry(price: number, fee = CURVE_DEFAULTS.fee, rate = CURVE_DEFAULTS.rate): number {
  return fee + (rate / 12) * price;
}

/** The hub's spot price from its fill (a local version of the stock–price relation). */
export function hubSpot(fill: number, normalFill = CURVE_DEFAULTS.normalFill): number {
  return WORLD.referencePrice * Math.pow(Math.max(0.05, fill) / normalFill, -0.35);
}

/**
 * Monthly futures prices: each month's price exceeds the previous by full carry minus the
 * convenience yield of the stocks expected then (stocks drift back toward normal). When tanks are
 * full, the spread must also pay for storage at sea.
 */
export function futuresCurve(c: CurveInputs): number[] {
  const months = c.months ?? CURVE_DEFAULTS.months;
  const normal = c.normalFill ?? CURVE_DEFAULTS.normalFill;
  const tau = c.meanReversion ?? CURVE_DEFAULTS.meanReversion;
  const spot = c.spot ?? hubSpot(c.fill, normal);
  const out = [spot];
  let p = spot;
  for (let m = 1; m < months; m++) {
    const fillM = normal + (c.fill - normal) * Math.exp(-(m - 1) / tau);
    let spread = fullCarry(p, c.fee, c.rate) - convenienceYield(fillM, c.cyMax, c.cyDecay);
    if (fillM > 0.97) spread += ((fillM - 0.97) / 0.03) * Math.max(0, (c.floatingCost ?? CURVE_DEFAULTS.floatingCost) - fullCarry(p, c.fee, c.rate));
    p += spread;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Products (Lesson 5.3).

export interface ProductMarketInputs {
  /** Refinery runs, mb/d (world). */
  runs: number;
  /** Share of each barrel run that becomes gasoline and distillate (diesel and jet). */
  gasolineYield: number;
  distillateYield: number;
  /** Monthly demand multipliers (12 values) for gasoline and distillate. */
  gasolineSeason?: number[];
  distillateSeason?: number[];
  /** Base demand, mb/d. */
  gasolineDemand?: number;
  distillateDemand?: number;
  /** Refinery outage: mb/d of runs lost in a span of months. */
  outage?: { size: number; start: number; months: number };
  months?: number;
}

export const PRODUCT_DEFAULTS = {
  gasolineDemand: 36.5,
  distillateDemand: 34.8,
  gasolineSeason: [0.96, 0.97, 0.99, 1.0, 1.02, 1.04, 1.05, 1.05, 1.01, 0.99, 0.97, 0.95],
  distillateSeason: [1.03, 1.03, 1.01, 0.99, 0.98, 0.97, 0.98, 0.99, 1.0, 1.01, 1.02, 1.03],
  /** Normal product stocks, million barrels. */
  normalGasoline: 900,
  normalDistillate: 750,
  /** Crack spreads at normal stocks, $/bbl over crude. */
  gasolineCrack: 17,
  distillateCrack: 27,
  /** How strongly cracks answer stocks: dollars added for each 1% that stocks sit below normal. */
  crackSensitivity: 0.6,
};

export interface ProductMonth {
  month: number;
  gasolineStock: number;
  distillateStock: number;
  gasolineCrack: number;
  distillateCrack: number;
  gasolineSupply: number;
  distillateSupply: number;
  gasolineDemand: number;
  distillateDemand: number;
}

/** Crack spread from a product's stocks: each 1% below normal adds `sensitivity` dollars; floors at −$5. */
export function crackFromStocks(stock: number, normal: number, base: number, sensitivity = PRODUCT_DEFAULTS.crackSensitivity): number {
  return Math.max(-5, base + sensitivity * 100 * (1 - stock / normal));
}

/** A year (or more) of gasoline and distillate: refinery output against seasonal demand, stocks and cracks. */
export function productMarket(p: ProductMarketInputs): ProductMonth[] {
  const T = p.months ?? 12;
  const gs = p.gasolineSeason ?? PRODUCT_DEFAULTS.gasolineSeason;
  const ds = p.distillateSeason ?? PRODUCT_DEFAULTS.distillateSeason;
  const g0 = p.gasolineDemand ?? PRODUCT_DEFAULTS.gasolineDemand;
  const d0 = p.distillateDemand ?? PRODUCT_DEFAULTS.distillateDemand;
  let gStock = PRODUCT_DEFAULTS.normalGasoline;
  let dStock = PRODUCT_DEFAULTS.normalDistillate;
  const out: ProductMonth[] = [];
  for (let m = 0; m < T; m++) {
    const lost = p.outage && m >= p.outage.start && m < p.outage.start + p.outage.months ? p.outage.size : 0;
    const runs = p.runs - lost;
    const gSupply = runs * p.gasolineYield;
    const dSupply = runs * p.distillateYield;
    const gDemand = g0 * gs[m % 12];
    const dDemand = d0 * ds[m % 12];
    gStock += (gSupply - gDemand) * 30.4;
    dStock += (dSupply - dDemand) * 30.4;
    out.push({
      month: m,
      gasolineStock: gStock,
      distillateStock: dStock,
      gasolineCrack: crackFromStocks(gStock, PRODUCT_DEFAULTS.normalGasoline, PRODUCT_DEFAULTS.gasolineCrack),
      distillateCrack: crackFromStocks(dStock, PRODUCT_DEFAULTS.normalDistillate, PRODUCT_DEFAULTS.distillateCrack),
      gasolineSupply: gSupply,
      distillateSupply: dSupply,
      gasolineDemand: gDemand,
      distillateDemand: dDemand,
    });
  }
  return out;
}
