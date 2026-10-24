// The region's gas market: a seasonal storage plan, and a market that clears every day.
//
// Seasonal plan. Storage moves gas through time the way a pipeline moves it through space, so a
// year can be solved as one network: the region's five places in each of twelve months, linked by
// the pipelines within each month and by each storage field from one month to the next
// (injecting in one month, holding, withdrawing in a later one), with limits on how much a field
// holds and how fast it fills and empties. The same min-cost flow that priced places in Chapter 3
// then prices every place in every month, and the difference between two months' prices is what
// storing gas between them is worth.
//
// Daily market. Each day, production, storage and the weather-driven demand at every place clear
// across the pipeline network (`solveFlow`). Storage offers to withdraw at its "water value" —
// what its gas is expected to be worth later — and bids to inject just below it. A field's water
// value comes from the seasonal plan's price at its location, nudged up when the field holds less
// gas than planned and down when it holds more. Prices at each place are the network's
// locational prices.

import { demandBlocks, sectorOf, type DemandOptions } from '../../model/gas/demand';
import { GAS_MONTH_DAYS, GAS_MONTH_START, GAS_YEAR_DAYS, normalTemp, weatherYear, type WeatherYear } from '../../model/gas/weather';
import { BASINS, GAS_NODES, PIPELINES, PRODUCTION_COST, STORAGE_SPECS, type GasNodeId } from '../../model/gas/world';
import { solveFlow, type DemandStep, type FlowProblem, type FlowSolution, type SupplyStep } from './network';
import { injectCapacity, withdrawCapacity, type StorageSpec } from './storage';

/** A pipeline in a corridor the region hasn't built (the capstone's new lines). */
export interface ExtraPipe {
  id: string;
  from: GasNodeId;
  to: GasNodeId;
  capacityBcfd: number;
  variableCost: number;
}

export type FieldId = 'saltflat' | 'hollowcreek';
export const FIELDS: FieldId[] = ['saltflat', 'hollowcreek'];
/** Where each storage field connects to the network. */
export const FIELD_NODE: Record<FieldId, GasNodeId> = { saltflat: 'calder', hollowcreek: 'metro' };
export type StorageState = Record<FieldId, number>;

// ---------------------------------------------------------------------------
// The seasonal plan.

export interface SeasonalOptions {
  /** Production at each basin, Bcf/d (default the world's). */
  production?: Partial<Record<GasNodeId, number>>;
  /** Pipeline capacities, Bcf/d (default certificated). */
  capacity?: Record<string, number>;
  /** Multiplies both fields' working gas capacity and rates. */
  storageScale?: number;
  /** Working gas in each field on April 1, and required on March 31, Bcf (default a quarter full). */
  start?: Partial<StorageState>;
  end?: Partial<StorageState>;
  /** Cost of putting gas in and taking it out (fees and fuel), $/MMBtu each way. */
  injectCost?: number;
  withdrawCost?: number;
  /** Cost of holding gas for a month (mostly the interest on its value), $/MMBtu per month. */
  holdCostPerMonth?: number;
  /** Monthly mean temperatures (°F, April first); defaults to normal weather. */
  monthlyTemp?: number[];
  /** Demand options (LNG, growth). */
  demand?: DemandOptions;
  /** Storage specs (default the world's). */
  specs?: Record<FieldId, StorageSpec>;
  /**
   * Gas-year month the plan starts in (0 = April, 7 = November). The plan still covers twelve
   * months, wrapping past March; `start` is the working gas at the start of that month and `end`
   * the working gas required twelve months later.
   */
  startMonth?: number;
  /** Use the faster shortest-path search (the same optimum, possibly a different tie among equally good solutions). */
  fast?: boolean;
  /**
   * For a plan that starts after April: working gas each field keeps in reserve on March 31, and
   * what the operators would accept to give it up, $/MMBtu. Without it a plan drawn in midwinter
   * would happily empty storage in March, because nothing after March asks for that gas.
   */
  springFloor?: { level: Partial<StorageState>; value: number };
  /**
   * Each field's most injection and withdrawal in each gas-year month (April first), Bcf, in place
   * of the flat monthly rates — for instance from `monthlyRates` along an expected inventory path,
   * since a filling field injects more slowly and an emptying one withdraws more slowly.
   */
  rates?: Partial<Record<FieldId, { inject: number[]; withdraw: number[] }>>;
  /** Pipelines in corridors the region hasn't built. */
  extraPipelines?: ExtraPipe[];
}

/**
 * A field's injection and withdrawal limits for each gas-year month, Bcf, if its inventory follows
 * `inventory` (13 values, April 1 to March 31): the daily limits of Lesson 3.4 summed along the
 * path, times the monthly rate shares.
 */
export function monthlyRates(spec: StorageSpec, inventory: number[]): { inject: number[]; withdraw: number[] } {
  const inject: number[] = [];
  const withdraw: number[] = [];
  for (let m = 0; m < 12; m++) {
    const n = GAS_MONTH_DAYS[m];
    let inj = 0;
    let wd = 0;
    for (let d = 0; d < n; d++) {
      const x = inventory[m] + ((inventory[m + 1] - inventory[m]) * (d + 0.5)) / n;
      inj += injectCapacity(spec, Math.min(x, spec.workingBcf - 0.5));
      wd += withdrawCapacity(spec, Math.max(x, 0.5));
    }
    inject.push(inj * MONTHLY_RATE_SHARE.inject);
    withdraw.push(wd * MONTHLY_RATE_SHARE.withdraw);
  }
  return { inject, withdraw };
}

export const SEASONAL_COSTS = { injectCost: 0.05, withdrawCost: 0.05, holdCostPerMonth: 0.02 };
/** Over a month, a field averages this share of its peak injection and withdrawal rates (ratchets). */
export const MONTHLY_RATE_SHARE = { inject: 0.85, withdraw: 0.8 };

export interface SeasonalPlan {
  /** Gas-year month the plan starts in (0 = April). Every monthly array below starts there. */
  startMonth: number;
  /** Price at each place in each month, $/MMBtu. */
  price: Record<GasNodeId, number[]>;
  /** Each field's injection (+) or withdrawal (−) in each month, Bcf. */
  storageFlow: Record<FieldId, number[]>;
  /** Each field's working gas at the start of each month and on March 31 (13 values), Bcf. */
  inventory: Record<FieldId, number[]>;
  /** All storage together, Bcf (13 values). */
  totalInventory: number[];
  /** Average pipeline flows in each month, Bcf/d. */
  flow: Record<string, number[]>;
  /** Protected demand left unserved in each month, Bcf. */
  rationed: number[];
  /** Working gas capacity of each field in this plan, Bcf. */
  capacity: StorageState;
}

/** Mean of normal temperature over each gas-year month. */
export function normalMonthlyTemps(): number[] {
  return GAS_MONTH_DAYS.map((n, m) => {
    let s = 0;
    for (let d = 0; d < n; d++) s += normalTemp(GAS_MONTH_START[m] + d);
    return s / n;
  });
}

/**
 * The year's equilibrium, solved as a flow through space and time. A month's demand blocks are a
 * day's blocks at the month's mean temperature, times its days; supplies and pipeline capacities
 * likewise. Prices come out for every place and month.
 */
export function seasonalPlan(o: SeasonalOptions = {}): SeasonalPlan {
  const specs = o.specs ?? STORAGE_SPECS;
  const costs = { ...SEASONAL_COSTS, ...o };
  const m0 = ((o.startMonth ?? 0) % 12 + 12) % 12;
  const tempsGas = o.monthlyTemp ?? normalMonthlyTemps();
  // Work in plan order: month k of the plan is gas-year month (m0 + k) % 12.
  const temps = Array.from({ length: 12 }, (_, k) => tempsGas[(m0 + k) % 12]);
  const monthDays = Array.from({ length: 12 }, (_, k) => GAS_MONTH_DAYS[(m0 + k) % 12]);
  const scale = o.storageScale ?? 1;
  const capOf = (f: FieldId) => specs[f].workingBcf * scale;
  const prod = { ridgeback: BASINS[0].productionBcfd, sandhill: BASINS[1].productionBcfd, ...o.production };
  const places = GAS_NODES.map((n) => n.id);
  const nodes: string[] = [];
  const arcs: FlowProblem['arcs'] = [];
  const supplies: SupplyStep[] = [];
  const demands: DemandStep[] = [];
  const reserveAt: Array<{ field: FieldId; index: number; demand: number }> = [];
  for (let m = 0; m < 12; m++) for (const n of places) nodes.push(`${n}@${m}`);
  for (const f of FIELDS) {
    for (let m = 0; m <= 12; m++) {
      nodes.push(`${f}:in${m}`, `${f}:out${m}`);
      arcs.push({ id: `${f}:hold${m}`, from: `${f}:in${m}`, to: `${f}:out${m}`, cap: capOf(f), cost: 0 });
    }
    const at = FIELD_NODE[f];
    for (let m = 0; m < 12; m++) {
      const days = monthDays[m];
      arcs.push({ id: `${f}:carry${m}`, from: `${f}:out${m}`, to: `${f}:in${m + 1}`, cap: capOf(f), cost: costs.holdCostPerMonth });
      const gm = (m0 + m) % 12;
      const injCap = o.rates?.[f]?.inject[gm] ?? specs[f].maxInjectBcfd * scale * MONTHLY_RATE_SHARE.inject * days;
      const wdCap = o.rates?.[f]?.withdraw[gm] ?? specs[f].maxWithdrawBcfd * scale * MONTHLY_RATE_SHARE.withdraw * days;
      arcs.push({ id: `${f}:inj${m}`, from: `${at}@${m}`, to: `${f}:in${m + 1}`, cap: injCap, cost: costs.injectCost });
      arcs.push({ id: `${f}:wd${m}`, from: `${f}:out${m}`, to: `${at}@${m}`, cap: wdCap, cost: costs.withdrawCost });
    }
    supplies.push({ id: `${f}:start`, node: `${f}:in0`, cap: o.start?.[f] ?? capOf(f) * 0.25, cost: 0 });
    demands.push({ id: `${f}:end`, node: `${f}:out12`, cap: o.end?.[f] ?? capOf(f) * 0.25, value: 50 });
    // The spring reserve: gas leaves the field's stock as March ends and comes back as April begins,
    // so the operators keep it unless the market pays more than its value.
    const reserve = o.springFloor?.level[f] ?? 0;
    if (m0 !== 0 && reserve > 0) {
      const k = 12 - m0;
      reserveAt.push({ field: f, index: k, demand: demands.length });
      demands.push({ id: `${f}:reserve`, node: `${f}:in${k}`, cap: reserve, value: o.springFloor!.value });
      supplies.push({ id: `${f}:reserve-back`, node: `${f}:out${k}`, cap: reserve, cost: 0 });
    }
  }
  for (let m = 0; m < 12; m++) {
    const days = monthDays[m];
    for (const p of [...PIPELINES, ...(o.extraPipelines ?? [])]) arcs.push({ id: `${p.id}@${m}`, from: `${p.from}@${m}`, to: `${p.to}@${m}`, cap: (o.capacity?.[p.id] ?? p.capacityBcfd) * days, cost: p.variableCost });
    supplies.push({ id: `prod-ridgeback@${m}`, node: `ridgeback@${m}`, cap: (prod.ridgeback ?? 0) * days, cost: PRODUCTION_COST.ridgeback ?? 1.2 });
    supplies.push({ id: `prod-sandhill@${m}`, node: `sandhill@${m}`, cap: (prod.sandhill ?? 0) * days, cost: PRODUCTION_COST.sandhill ?? 1.6 });
    for (const d of demandBlocks(temps[m], o.demand)) demands.push({ id: `${d.id}@${m}`, node: `${d.node}@${m}`, cap: d.cap * days, value: d.value });
  }
  const sol = solveFlow({ nodes, arcs, supplies, demands }, { fast: o.fast });
  const price = Object.fromEntries(places.map((n) => [n, Array.from({ length: 12 }, (_, m) => sol.prices[`${n}@${m}`])])) as Record<GasNodeId, number[]>;
  const storageFlow = Object.fromEntries(FIELDS.map((f) => [f, Array.from({ length: 12 }, (_, m) => (sol.flow[`${f}:inj${m}`] ?? 0) - (sol.flow[`${f}:wd${m}`] ?? 0))])) as Record<FieldId, number[]>;
  const inventory = Object.fromEntries(FIELDS.map((f) => [f, Array.from({ length: 13 }, (_, m) => sol.flow[`${f}:hold${m}`] ?? 0)])) as Record<FieldId, number[]>;
  // The spring reserve leaves the hold arc for an instant; count it back in.
  for (const r of reserveAt) inventory[r.field][r.index] += sol.served[r.demand];
  const totalInventory = inventory.saltflat.map((x, m) => x + inventory.hollowcreek[m]);
  const flow = Object.fromEntries([...PIPELINES, ...(o.extraPipelines ?? [])].map((p) => [p.id, Array.from({ length: 12 }, (_, m) => (sol.flow[`${p.id}@${m}`] ?? 0) / monthDays[m])]));
  const rationed = Array<number>(12).fill(0);
  demands.forEach((d, i) => {
    if (d.value < 100) return;
    const m = Number(d.id!.slice(d.id!.lastIndexOf('@') + 1));
    rationed[m] += d.cap - sol.served[i];
  });
  return { startMonth: m0, price, storageFlow, inventory, totalInventory, flow, rationed, capacity: { saltflat: capOf('saltflat'), hollowcreek: capOf('hollowcreek') } };
}

/** Index into an April-first array for the k-th month of a plan that starts in `startMonth`. */
export function planMonth(startMonth: number, k: number): number {
  return (startMonth + k) % 12;
}

// ---------------------------------------------------------------------------
// The daily market.

export interface MarketDayInput {
  tempF: number;
  /** Production at each basin today, Bcf/d. */
  production?: Partial<Record<GasNodeId, number>>;
  /** Pipeline capacities today, Bcf/d (default: certificated capacity). */
  capacity?: Record<string, number>;
  /** Working gas in each storage field at the start of the day, Bcf. */
  storage: StorageState;
  /** Each field's water value today, $/MMBtu at its own location. */
  waterValue: StorageState;
  /** Demand options (LNG value and size, growth). */
  demand?: DemandOptions;
  /** The storage fields' specs (default the world's). */
  specs?: Record<FieldId, StorageSpec>;
  /** Use the faster shortest-path search. */
  fast?: boolean;
  /** Pipelines in corridors the region hasn't built. */
  extraPipelines?: ExtraPipe[];
}

/** Storage withdraws when the price is above its water value plus this, and injects when below it minus this, $/MMBtu. */
export const STORAGE_HALF_SPREAD = 0.05;

export interface MarketDay {
  problem: FlowProblem;
  solution: FlowSolution;
  /** Price at each place, $/MMBtu. */
  price: Record<GasNodeId, number>;
  /** Flow on each pipeline, Bcf/d. */
  flow: Record<string, number>;
  /** Net storage flow at each field (+ inject, − withdraw), Bcf/d. */
  storageFlow: StorageState;
  /** Demand served and unserved at each place (storage injection excluded), Bcf/d. */
  served: Record<GasNodeId, number>;
  unserved: Record<GasNodeId, number>;
  /** Protected demand left unserved (rationing), Bcf/d. */
  rationed: number;
  /** Gas burned by each kind of user, Bcf/d (storage injection excluded). */
  sectors: Record<Sector, number>;
}

export type Sector = 'homes' | 'power' | 'industry' | 'lng' | 'field';

/** The day's market problem: network, supply offers, demand bids and storage. */
export function marketProblem(inp: MarketDayInput): FlowProblem {
  const specs = inp.specs ?? STORAGE_SPECS;
  const prod = { ridgeback: BASINS[0].productionBcfd, sandhill: BASINS[1].productionBcfd, ...inp.production };
  const supplies: SupplyStep[] = [
    { id: 'prod-ridgeback', node: 'ridgeback', cap: prod.ridgeback ?? 0, cost: PRODUCTION_COST.ridgeback ?? 1.2 },
    { id: 'prod-sandhill', node: 'sandhill', cap: prod.sandhill ?? 0, cost: PRODUCTION_COST.sandhill ?? 1.6 },
  ];
  const demands: DemandStep[] = demandBlocks(inp.tempF, inp.demand);
  for (const f of FIELDS) {
    const inv = inp.storage[f];
    const w = inp.waterValue[f];
    supplies.push({ id: `wd-${f}`, node: FIELD_NODE[f], cap: withdrawCapacity(specs[f], inv), cost: w + STORAGE_HALF_SPREAD });
    demands.push({ id: `inj-${f}`, node: FIELD_NODE[f], cap: injectCapacity(specs[f], inv), value: Math.max(0, w - STORAGE_HALF_SPREAD) });
  }
  return {
    nodes: GAS_NODES.map((n) => n.id),
    arcs: [...PIPELINES, ...(inp.extraPipelines ?? [])].map((p) => ({ id: p.id, from: p.from, to: p.to, cap: inp.capacity?.[p.id] ?? p.capacityBcfd, cost: p.variableCost })),
    supplies,
    demands,
  };
}

/** Clears one day. */
export function marketDay(inp: MarketDayInput): MarketDay {
  const problem = marketProblem(inp);
  const solution = solveFlow(problem, { fast: inp.fast });
  const at = (id: string, list: Array<{ id?: string }>, values: number[]) => values[list.findIndex((x) => x.id === id)] ?? 0;
  const storageFlow: StorageState = {
    saltflat: at('inj-saltflat', problem.demands, solution.served) - at('wd-saltflat', problem.supplies, solution.supplied),
    hollowcreek: at('inj-hollowcreek', problem.demands, solution.served) - at('wd-hollowcreek', problem.supplies, solution.supplied),
  };
  const served = { sandhill: 0, ridgeback: 0, calder: 0, metro: 0, bayport: 0 } as Record<GasNodeId, number>;
  const unserved = { ...served };
  const sectors: Record<Sector, number> = { homes: 0, power: 0, industry: 0, lng: 0, field: 0 };
  let rationed = 0;
  problem.demands.forEach((d, i) => {
    if (d.id?.startsWith('inj-')) return;
    served[d.node as GasNodeId] += solution.served[i];
    unserved[d.node as GasNodeId] += d.cap - solution.served[i];
    sectors[sectorOf(d.id ?? '')] += solution.served[i];
    if (d.value >= 100) rationed += d.cap - solution.served[i];
  });
  return { problem, solution, price: solution.prices as Record<GasNodeId, number>, flow: solution.flow, storageFlow, served, unserved, rationed, sectors };
}

/**
 * The same day with the pipelines taken away: every supply and demand meets at one place, as if the
 * region were a single market with no limits on moving gas. Returns the clearing price and what
 * each supply and demand block did, for drawing supply and demand curves.
 */
export function clearRegion(inp: MarketDayInput): { price: number; problem: FlowProblem; solution: FlowSolution; storageFlow: StorageState; sectors: Record<Sector, number> } {
  const p = marketProblem(inp);
  const problem: FlowProblem = {
    nodes: ['region'],
    arcs: [],
    supplies: p.supplies.map((s) => ({ ...s, node: 'region' })),
    demands: p.demands.map((d) => ({ ...d, node: 'region' })),
  };
  const solution = solveFlow(problem);
  const at = (id: string, list: Array<{ id?: string }>, values: number[]) => values[list.findIndex((x) => x.id === id)] ?? 0;
  const sectors: Record<Sector, number> = { homes: 0, power: 0, industry: 0, lng: 0, field: 0 };
  problem.demands.forEach((d, i) => {
    if (!d.id?.startsWith('inj-')) sectors[sectorOf(d.id ?? '')] += solution.served[i];
  });
  return {
    price: solution.prices.region,
    problem,
    solution,
    storageFlow: {
      saltflat: at('inj-saltflat', problem.demands, solution.served) - at('wd-saltflat', problem.supplies, solution.supplied),
      hollowcreek: at('inj-hollowcreek', problem.demands, solution.served) - at('wd-hollowcreek', problem.supplies, solution.supplied),
    },
    sectors,
  };
}

// ---------------------------------------------------------------------------
// A year, day by day.

export interface YearOptions {
  weather: WeatherYear;
  /** Production at each basin on a day, Bcf/d. */
  production?: (day: number) => Partial<Record<GasNodeId, number>>;
  /** Pipeline capacities on a day, Bcf/d (outages, expansions). */
  capacity?: (day: number) => Record<string, number> | undefined;
  /** Working gas on April 1, Bcf (default the plan's). */
  startStorage?: StorageState;
  /** The seasonal plan the storage operators work from (default: normal weather). */
  plan?: SeasonalPlan;
  /** How strongly a field's water value rises when it holds less gas than planned. */
  scarcityWeight?: number;
  demand?: DemandOptions | ((day: number) => DemandOptions);
  specs?: Record<FieldId, StorageSpec>;
  /** Day of the gas year to start on (default 0, April 1); the run wraps past March 31 into the next April. */
  startDay?: number;
  /** Days to run (default 365). */
  days?: number;
  /** Use the faster shortest-path search. */
  fast?: boolean;
  /** Pipelines in corridors the region hasn't built. */
  extraPipelines?: ExtraPipe[];
}

export interface YearDay {
  day: number;
  tempF: number;
  price: Record<GasNodeId, number>;
  flow: Record<string, number>;
  /** Working gas at the end of the day, Bcf. */
  storage: StorageState;
  storageFlow: StorageState;
  served: Record<GasNodeId, number>;
  unserved: Record<GasNodeId, number>;
  rationed: number;
  waterValue: StorageState;
  sectors: Record<Sector, number>;
}

/** Interpolates a plan's monthly values to a day (values at month midpoints). */
export function planAt(monthly: number[], day: number): number {
  const mids = GAS_MONTH_START.map((s, m) => s + GAS_MONTH_DAYS[m] / 2);
  if (day <= mids[0]) return monthly[0];
  if (day >= mids[11]) return monthly[11];
  let m = 0;
  while (mids[m + 1] < day) m++;
  const t = (day - mids[m]) / (mids[m + 1] - mids[m]);
  return monthly[m] + t * (monthly[m + 1] - monthly[m]);
}

/** A field's planned working gas on a day: linear within each month between the plan's month boundaries. */
export function planInventory(plan: SeasonalPlan, field: FieldId, day: number): number {
  let m = 11;
  while (GAS_MONTH_START[m] > day) m--;
  const t = (day - GAS_MONTH_START[m]) / GAS_MONTH_DAYS[m];
  const inv = plan.inventory[field];
  return inv[m] + t * (inv[m + 1] - inv[m]);
}

let defaultPlan: SeasonalPlan | null = null;
/** The seasonal plan under normal weather with the world's defaults (cached). */
export function normalPlan(): SeasonalPlan {
  if (!defaultPlan) defaultPlan = seasonalPlan();
  return defaultPlan;
}

/** A field's water value on a day: the plan's price at its place, raised when it's behind plan and lowered when ahead. */
export function waterValueOf(plan: SeasonalPlan, field: FieldId, day: number, inventory: number, workingBcf: number, kappa = 1.5): number {
  const base = planAt(plan.price[FIELD_NODE[field]], day + 0.5);
  const gap = (planInventory(plan, field, day) - inventory) / workingBcf;
  return base * Math.exp(kappa * gap);
}

export interface ScenarioOptions {
  /** Weather year seed, and an optional shift (°F) and severity. */
  seed: number;
  shift?: number;
  severity?: number;
  /** Production at each basin, Bcf/d, all year. */
  production?: Partial<Record<GasNodeId, number>>;
  /** Pipeline capacities, Bcf/d, all year. */
  capacity?: Record<string, number>;
  demand?: DemandOptions;
  storageScale?: number;
}

const planCache = new Map<string, SeasonalPlan>();
/** A seasonal plan for a set of conditions, cached: storage operators plan for the region as it is. */
export function planFor(o: Pick<ScenarioOptions, 'production' | 'capacity' | 'demand' | 'storageScale'>): SeasonalPlan {
  const key = JSON.stringify([o.production ?? null, o.capacity ?? null, o.demand ?? null, o.storageScale ?? 1]);
  let p = planCache.get(key);
  if (!p) {
    p = seasonalPlan({ production: o.production, capacity: o.capacity, demand: o.demand, storageScale: o.storageScale });
    if (planCache.size > 200) planCache.clear();
    planCache.set(key, p);
  }
  return p;
}

const scenarioCache = new Map<string, YearDay[]>();
/**
 * A simulated year under changed conditions — more or less production, a pipeline derated or
 * expanded, different LNG demand — with the storage plan redrawn for those conditions, as the
 * operators would. Cached by its options.
 */
export function scenarioYear(o: ScenarioOptions): YearDay[] {
  const key = JSON.stringify(o);
  let y = scenarioCache.get(key);
  if (!y) {
    const plan = planFor(o);
    const scale = o.storageScale ?? 1;
    const specs = scale === 1 ? STORAGE_SPECS : scaledSpecs(scale);
    y = simulateYear({
      weather: weatherYear(o.seed, { shift: o.shift, severity: o.severity }),
      plan,
      production: o.production ? () => o.production! : undefined,
      capacity: o.capacity ? () => o.capacity : undefined,
      demand: o.demand,
      specs,
    });
    if (scenarioCache.size > 300) scenarioCache.clear();
    scenarioCache.set(key, y);
  }
  return y;
}

/** The storage fields with working gas and rates scaled. */
export function scaledSpecs(scale: number): Record<FieldId, StorageSpec> {
  const f = (s: StorageSpec): StorageSpec => ({ ...s, workingBcf: s.workingBcf * scale, baseBcf: s.baseBcf * scale, maxInjectBcfd: s.maxInjectBcfd * scale, maxWithdrawBcfd: s.maxWithdrawBcfd * scale });
  return { saltflat: f(STORAGE_SPECS.saltflat), hollowcreek: f(STORAGE_SPECS.hollowcreek) };
}

export interface CurveOptions {
  /** Day of the gas year the curve is drawn on. */
  startDay: number;
  /** Working gas in each field that day, Bcf (default: as planned). */
  startStorage?: StorageState;
  /** Weather years to average over (default 24). */
  scenarios?: number;
  /** First weather seed. */
  seed?: number;
  /** Shifts every scenario's temperatures, °F (a forecast of a warm or cold season). */
  weatherShift?: number;
  production?: (day: number) => Partial<Record<GasNodeId, number>>;
  capacity?: (day: number) => Record<string, number> | undefined;
  demand?: DemandOptions;
}

export interface ForwardCurve {
  /** Gas-year month index (0 = April) of each of the next twelve delivery months, starting with the month after `startDay`'s. */
  months: number[];
  /** Expected average price in each month at Calder and at Metro, $/MMBtu. */
  calder: number[];
  metro: number[];
  /** Spread of the monthly averages across the scenarios (standard deviation), $/MMBtu. */
  calderSd: number[];
}

/**
 * The market's expectation of each coming month's price: the average, over many simulated weather
 * years, of the daily prices the market would clear at, starting from today's storage. This is what
 * a forward or futures price should be if traders expect the weather to be like the past and
 * demand no premium for risk.
 */
export function forwardCurve(o: CurveOptions): ForwardCurve {
  const scenarios = o.scenarios ?? 24;
  const firstMonth = (monthOfStart(o.startDay) + 1) % 12;
  const startOfFirst = GAS_MONTH_START[firstMonth] + (firstMonth === 0 ? GAS_YEAR_DAYS : 0);
  const lead = (startOfFirst - o.startDay + GAS_YEAR_DAYS) % GAS_YEAR_DAYS;
  const months = Array.from({ length: 12 }, (_, k) => (firstMonth + k) % 12);
  const sum = { calder: Array<number>(12).fill(0), metro: Array<number>(12).fill(0), sq: Array<number>(12).fill(0) };
  for (let s = 0; s < scenarios; s++) {
    const weather = weatherYearCached((o.seed ?? 1000) + s, o.weatherShift ?? 0);
    const run = simulateYear({ weather, startDay: o.startDay, days: lead + GAS_YEAR_DAYS, startStorage: o.startStorage, production: o.production, capacity: o.capacity, demand: o.demand });
    const acc = { calder: Array<number>(12).fill(0), metro: Array<number>(12).fill(0), n: Array<number>(12).fill(0) };
    run.slice(lead).forEach((d, i) => {
      const day = (o.startDay + lead + i) % GAS_YEAR_DAYS;
      const k = (monthOfStart(day) - firstMonth + 12) % 12;
      acc.calder[k] += d.price.calder;
      acc.metro[k] += d.price.metro;
      acc.n[k] += 1;
    });
    for (let k = 0; k < 12; k++) {
      const c = acc.calder[k] / acc.n[k];
      sum.calder[k] += c / scenarios;
      sum.metro[k] += acc.metro[k] / acc.n[k] / scenarios;
      sum.sq[k] += (c * c) / scenarios;
    }
  }
  return { months, calder: sum.calder, metro: sum.metro, calderSd: sum.sq.map((q, k) => Math.sqrt(Math.max(0, q - sum.calder[k] ** 2))) };
}

function monthOfStart(day: number): number {
  let m = 11;
  while (GAS_MONTH_START[m] > day) m--;
  return m;
}

const weatherCache = new Map<string, WeatherYear>();
function weatherYearCached(seed: number, shift: number): WeatherYear {
  const k = `${seed}|${shift}`;
  let w = weatherCache.get(k);
  if (!w) {
    w = weatherYear(seed, { shift });
    if (weatherCache.size > 500) weatherCache.clear();
    weatherCache.set(k, w);
  }
  return w;
}

/** Runs the daily market through a gas year (April to March; the plan must start in April). */
export function simulateYear(o: YearOptions): YearDay[] {
  const specs = o.specs ?? STORAGE_SPECS;
  const plan = o.plan ?? normalPlan();
  if (plan.startMonth !== 0) throw new Error('simulateYear needs a plan that starts in April');
  const kappa = o.scarcityWeight ?? 1.5;
  const start = o.startDay ?? 0;
  const storage: StorageState = o.startStorage
    ? { ...o.startStorage }
    : { saltflat: planInventory(plan, 'saltflat', start), hollowcreek: planInventory(plan, 'hollowcreek', start) };
  const out: YearDay[] = [];
  const n = o.days ?? GAS_YEAR_DAYS;
  for (let i = 0; i < n; i++) {
    const d = (start + i) % GAS_YEAR_DAYS;
    const waterValue: StorageState = {
      saltflat: waterValueOf(plan, 'saltflat', d, storage.saltflat, specs.saltflat.workingBcf, kappa),
      hollowcreek: waterValueOf(plan, 'hollowcreek', d, storage.hollowcreek, specs.hollowcreek.workingBcf, kappa),
    };
    const demand = typeof o.demand === 'function' ? o.demand(d) : o.demand;
    const r = marketDay({ tempF: o.weather.temp[d], production: o.production?.(d), capacity: o.capacity?.(d), storage, waterValue, demand, specs, fast: o.fast, extraPipelines: o.extraPipelines });
    storage.saltflat = Math.max(0, Math.min(specs.saltflat.workingBcf, storage.saltflat + r.storageFlow.saltflat));
    storage.hollowcreek = Math.max(0, Math.min(specs.hollowcreek.workingBcf, storage.hollowcreek + r.storageFlow.hollowcreek));
    out.push({
      day: d,
      tempF: o.weather.temp[d],
      price: r.price,
      flow: r.flow,
      storage: { ...storage },
      storageFlow: r.storageFlow,
      served: r.served,
      unserved: r.unserved,
      rationed: r.rationed,
      waterValue,
      sectors: r.sectors,
    });
  }
  return out;
}
