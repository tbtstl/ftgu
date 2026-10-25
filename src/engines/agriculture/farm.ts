// Farm decisions on top of the season model: which crop where, when to plant, how much of each
// input, and what it all earns. Everything is averaged over the simulated history of seasons
// (simulated years 1–HISTORY), because a farmer decides before knowing which season is coming.
// Season results are cached, so sweeping a slider re-uses work already done.

import { simulateSeason, type DiseaseOptions, type Irrigation, type SeasonResult } from './crop';
import { sufficiency, type SoilInputs } from './soil';
import { simulatedYear, type DayWeather } from '../../model/agriculture/climate';
import { DISTRICT, dayOf, type Crop, type DistrictId } from '../../model/agriculture/region';
import { BUDGET, LAND_RENT, N_PRICE, PUMP_PER_ACRE_INCH, perBushelCost } from '../../model/agriculture/economics';

/** Simulated seasons the farm lessons average over. */
export const HISTORY = 200;
export const YEARS = Array.from({ length: HISTORY }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// Cached seasons.

export interface FieldSpec {
  district: DistrictId;
  crop: Crop;
  plantDay?: number;
  population?: number;
  nutrient?: number;
  irrigation?: Irrigation | null;
  disease?: DiseaseOptions | null;
  /** Wheat: how well the stand established in the fall (0–1). */
  fallStand?: number;
  /** Share of the harvest lost to something other than the season (a resistant hybrid’s yield drag). */
  pestLoss?: number;
  /** Override the district’s soil. */
  pawIn?: number;
  /** Corn: override the district’s usual hybrid maturity, growing degree days to black layer. */
  maturityGdd?: number;
}

const cache = new Map<string, SeasonResult>();

function key(year: number, s: FieldSpec): string {
  return JSON.stringify([year, s.district, s.crop, s.plantDay, s.population, s.nutrient, s.irrigation, s.disease, s.fallStand, s.pawIn, s.pestLoss, s.maturityGdd]);
}

/** One season for a field, cached. */
export function fieldSeason(year: number, s: FieldSpec): SeasonResult {
  const k = key(year, s);
  let r = cache.get(k);
  if (!r) {
    const d = DISTRICT[s.district];
    r = simulateSeason(simulatedYear(year, s.district), {
      crop: s.crop,
      plantDay: s.plantDay ?? dayOf(5, 1),
      maturityGdd: s.crop === 'corn' ? (s.maturityGdd ?? d.hybridGdd) : undefined,
      population: s.population,
      pawIn: s.pawIn ?? d.pawIn,
      startWater: s.irrigation ? Math.max(d.springWater, 0.8) : d.springWater,
      nutrient: s.nutrient,
      irrigation: s.irrigation ?? null,
      disease: s.disease ?? null,
      fallStand: s.fallStand,
      pestLoss: s.pestLoss,
    });
    if (cache.size > 60000) cache.clear();
    cache.set(k, r);
  }
  return r;
}

/** Yields of a field over the whole simulated history, bushels per acre. */
export function historyYields(s: FieldSpec, years: number[] = YEARS): number[] {
  return years.map((y) => fieldSeason(y, s).yield);
}

/** How Cedar Bend's neighbors irrigate on the High Plains: an inch when half the root zone is used, at most every four days. */
export const PLAINS_IRRIGATION: Irrigation = { trigger: 0.5, amount: 1, interval: 4 };

// ---------------------------------------------------------------------------
// Leaf blight: the valley's main corn leaf disease, and the ways to fight it.

/** The blight as it arrives each year: a trace of diseased leaf around V12, spreading on warm, wet days. */
export const LEAF_BLIGHT: DiseaseOptions = { inoculum: 0.005, onset: 0.35, rate: 0.14 };
/** Corn after corn starts with three times the spores, from last year's infected residue. */
export const CORN_ON_CORN_INOCULUM = 3;
/** A resistant hybrid slows the blight's spread by this share. */
export const RESISTANCE = 0.4;
/** A resistant hybrid gives up this share of yield in exchange: its genetics trail the newest susceptible hybrids a little. */
export const RESISTANT_YIELD_DRAG = 0.03;
/** A fungicide sprayed at silking slows the blight by this share for three weeks. */
export const FUNGICIDE: Pick<DiseaseOptions, 'sprayAt' | 'efficacy' | 'protectDays'> = { sprayAt: 0.52, efficacy: 0.8, protectDays: 21 };

export type BlightStrategy = 'none' | 'resistant' | 'fungicide' | 'scout';

/** The disease options for a control strategy. `threshold` is the diseased share that triggers a spray when scouting. */
export function blightOptions(strategy: BlightStrategy, opts: { cornOnCorn?: boolean; threshold?: number; pressure?: number } = {}): DiseaseOptions {
  const base: DiseaseOptions = {
    ...LEAF_BLIGHT,
    inoculum: LEAF_BLIGHT.inoculum * (opts.cornOnCorn ? CORN_ON_CORN_INOCULUM : 1) * (opts.pressure ?? 1),
  };
  if (strategy === 'resistant') return { ...base, resistance: RESISTANCE };
  if (strategy === 'fungicide') return { ...base, ...FUNGICIDE, sprayThreshold: 0 };
  if (strategy === 'scout') return { ...base, ...FUNGICIDE, sprayThreshold: opts.threshold ?? 0.02 };
  return base;
}

/** A Prairie corn field facing the blight under a strategy: the disease options plus the resistant hybrid's yield drag. */
export function blightField(strategy: BlightStrategy, opts: { cornOnCorn?: boolean; threshold?: number; pressure?: number } = {}): FieldSpec {
  return { district: 'prairie', crop: 'corn', disease: blightOptions(strategy, opts), pestLoss: strategy === 'resistant' ? RESISTANT_YIELD_DRAG : undefined };
}

// ---------------------------------------------------------------------------
// Margins.

/** Variable cost per acre of a crop (no land, machinery or labor), with irrigation pumping if any. */
export function variableCost(crop: Crop, irrigationInches = 0): number {
  return BUDGET[crop].filter((l) => l.kind === 'variable').reduce((s, l) => s + l.perAcre, 0) + irrigationInches * PUMP_PER_ACRE_INCH;
}

/** Fixed cost per acre (machinery, labor and the district's land rent). */
export function fixedCost(crop: Crop, district: DistrictId): number {
  return BUDGET[crop].filter((l) => l.kind === 'fixed').reduce((s, l) => s + l.perAcre, 0) + LAND_RENT[district];
}

/** Return over variable costs, $ per acre: what an acre adds to the farm's income once the land is paid for. */
export function marginOverVariable(crop: Crop, yieldBu: number, price: number, irrigationInches = 0): number {
  return yieldBu * (price - perBushelCost(crop)) - variableCost(crop, irrigationInches);
}

// ---------------------------------------------------------------------------
// Rotation: corn after corn, and wheat after wheat, yield less.

/** Corn grown after corn loses this share of its yield, and needs more nitrogen. */
export const CORN_ON_CORN_PENALTY = 0.1;
export const CORN_ON_CORN_EXTRA_N = 40;
/** Wheat after wheat loses this share (root diseases build up). */
export const WHEAT_ON_WHEAT_PENALTY = 0.1;

export interface MixResult {
  cornAcres: number;
  wheatAcres: number;
  /** Corn acres following wheat (the rest follow corn). */
  cornAfterWheat: number;
  wheatAfterCorn: number;
  /** Farm return over variable costs in each season, $. */
  margins: number[];
  mean: number;
  /** The 1-in-10 worst season. */
  p10: number;
  /** Mean corn and wheat yields with rotation effects, bushels per acre. */
  cornYield: number;
  wheatYield: number;
}

/**
 * A farm of `acres` in a district split between corn and wheat, in a two-year rotation as far as the
 * mix allows, over every simulated season. Corn is irrigated if `irrigated`.
 */
export function cropMix(district: DistrictId, acres: number, cornShare: number, prices: Record<Crop, number>, irrigated = false): MixResult {
  const cornAcres = Math.round(acres * cornShare);
  const wheatAcres = acres - cornAcres;
  const cornAfterWheat = Math.min(cornAcres, wheatAcres);
  const wheatAfterCorn = Math.min(cornAcres, wheatAcres);
  const cornSpec: FieldSpec = { district, crop: 'corn', irrigation: irrigated ? PLAINS_IRRIGATION : null };
  const wheatSpec: FieldSpec = { district, crop: 'wheat' };
  const margins: number[] = [];
  let cy = 0;
  let wy = 0;
  for (const y of YEARS) {
    const c = fieldSeason(y, cornSpec);
    const w = fieldSeason(y, wheatSpec);
    const cornYield = c.yield;
    const wheatYield = w.yield;
    const cornBu = cornAfterWheat * cornYield + (cornAcres - cornAfterWheat) * cornYield * (1 - CORN_ON_CORN_PENALTY);
    const wheatBu = wheatAfterCorn * wheatYield + (wheatAcres - wheatAfterCorn) * wheatYield * (1 - WHEAT_ON_WHEAT_PENALTY);
    const irr = c.irrigationTotal;
    const m =
      cornBu * (prices.corn - perBushelCost('corn')) -
      cornAcres * variableCost('corn', irr) -
      (cornAcres - cornAfterWheat) * CORN_ON_CORN_EXTRA_N * N_PRICE +
      wheatBu * (prices.wheat - perBushelCost('wheat')) -
      wheatAcres * variableCost('wheat');
    margins.push(m);
    cy += cornAcres ? cornBu / cornAcres : 0;
    wy += wheatAcres ? wheatBu / wheatAcres : 0;
  }
  const sorted = [...margins].sort((a, b) => a - b);
  return {
    cornAcres,
    wheatAcres,
    cornAfterWheat,
    wheatAfterCorn,
    margins,
    mean: margins.reduce((s, x) => s + x, 0) / margins.length,
    p10: sorted[Math.floor(0.1 * (sorted.length - 1))],
    cornYield: cy / YEARS.length,
    wheatYield: wy / YEARS.length,
  };
}

// ---------------------------------------------------------------------------
// Planting: field-workable days and how fast a planter gets the crop in.

/** Can the planter run today? Not on a rainy day, nor while the soil is still wet from the last two days, nor in the cold. */
export function isWorkable(weather: DayWeather[], d: number): boolean {
  const w = weather[d];
  if (!w) return false;
  const prior = (weather[d - 1]?.rain ?? 0) + (weather[d - 2]?.rain ?? 0);
  return w.rain < 0.1 && prior < 0.5 && (w.tmax + w.tmin) / 2 >= 7;
}

export interface PlantingRun {
  /** Acres planted on each day from `start`, index 0 = start. */
  daily: number[];
  /** Cumulative acres planted by the end of each day. */
  cumulative: number[];
  /** Day the last acre went in, or −1 if the deadline came first. */
  finished: number;
  workableDays: number;
  /** Acre-weighted average planting day. */
  meanDay: number;
}

/** Plants `acres` from day `start` at `perDay` acres per workable day, until done or `deadline`. */
export function plantingRun(weather: DayWeather[], start: number, acres: number, perDay: number, deadline = dayOf(6, 20)): PlantingRun {
  const daily: number[] = [];
  const cumulative: number[] = [];
  let left = acres;
  let finished = -1;
  let workableDays = 0;
  let weighted = 0;
  for (let d = start; d <= deadline; d++) {
    let today = 0;
    if (left > 0 && isWorkable(weather, d)) {
      workableDays++;
      today = Math.min(perDay, left);
      left -= today;
      weighted += today * d;
      if (left <= 1e-9 && finished < 0) finished = d;
    }
    daily.push(today);
    cumulative.push(acres - left);
  }
  // Anything left at the deadline goes in on the deadline.
  if (left > 0) weighted += left * deadline;
  return { daily, cumulative, finished, workableDays, meanDay: acres > 0 ? weighted / acres : start };
}

/** Planting days on which the expected yield is computed; between them it is interpolated. */
const PLANT_GRID = Array.from({ length: 15 }, (_, i) => dayOf(4, 5) + 5 * i);
const expectedCache = new Map<string, number[]>();

/**
 * Expected corn yield (average over the simulated history) for each planting day on a 5-day grid
 * from April 5, interpolated between. Returns a function of the planting day.
 *
 * By default it averages the first 100 seasons and the grid ends on June 14, after which the yield
 * is held flat. `opts.years` chooses the seasons averaged, and `opts.through` extends the grid (in
 * 5-day steps) until it covers that planting day, so later days fall on the real curve.
 */
export function expectedYieldByPlantDay(district: DistrictId, opts: { years?: number[]; through?: number } = {}): (day: number) => number {
  const years = opts.years ?? YEARS.slice(0, 100);
  const n = opts.through === undefined ? PLANT_GRID.length : Math.max(PLANT_GRID.length, Math.ceil((opts.through - PLANT_GRID[0]) / 5) + 1);
  const days = Array.from({ length: n }, (_, i) => PLANT_GRID[0] + 5 * i);
  const k = opts.years === undefined && opts.through === undefined ? district : `${district}|${n}|${years.join(',')}`;
  let grid = expectedCache.get(k);
  if (!grid) {
    grid = days.map((p) => {
      const ys = historyYields({ district, crop: 'corn', plantDay: p }, years);
      return ys.reduce((s, x) => s + x, 0) / ys.length;
    });
    expectedCache.set(k, grid);
  }
  const g = grid;
  return (day: number) => {
    const x = (day - PLANT_GRID[0]) / 5;
    if (x <= 0) return g[0];
    if (x >= g.length - 1) return g[g.length - 1];
    const i = Math.floor(x);
    return g[i] + (g[i + 1] - g[i]) * (x - i);
  };
}

// ---------------------------------------------------------------------------
// Inputs and their marginal returns.

const FACTOR_GRID = Array.from({ length: 21 }, (_, i) => 0.5 + i * 0.025);
const factorCache = new Map<string, number[]>();

/** Mean corn yield over `years` seasons at each nutrient sufficiency on a grid from 0.5 to 1, interpolated. */
function meanYieldAtSufficiency(district: DistrictId, years: number[]): (f: number) => number {
  const k = `${district}|${years.length}`;
  let grid = factorCache.get(k);
  if (!grid) {
    grid = FACTOR_GRID.map((f) => {
      const ys = historyYields({ district, crop: 'corn', nutrient: Math.round(f * 1000) / 1000 }, years);
      return ys.reduce((s, x) => s + x, 0) / ys.length;
    });
    factorCache.set(k, grid);
  }
  const g = grid;
  return (f: number) => {
    const x = (Math.max(0.5, Math.min(1, f)) - 0.5) / 0.025;
    const i = Math.min(g.length - 2, Math.floor(x));
    return g[i] + (g[i + 1] - g[i]) * (x - i);
  };
}

export interface ResponsePoint {
  level: number;
  yield: number;
  /** Value of the crop minus the input's cost, $ per acre (return to this input). */
  net: number;
}

/**
 * Expected corn yield and net return at each nitrogen rate (lb N per acre), for a field's soil.
 * Uses the nitrogen budget of Lesson 1.3 and the mean over the simulated history.
 */
export function nitrogenResponse(district: DistrictId, soil: Omit<SoilInputs, 'nRate'>, rates: number[], cornPrice: number, nPrice = N_PRICE, years = YEARS.slice(0, 100)): ResponsePoint[] {
  const f = meanYieldAtSufficiency(district, years);
  return rates.map((rate) => {
    const y = f(sufficiency('corn', { ...soil, nRate: rate }).factor);
    return { level: rate, yield: y, net: y * (cornPrice - perBushelCost('corn')) - rate * nPrice };
  });
}

/** Expected yield, water pumped and net return of irrigated corn on the High Plains for each seasonal water allowance (inches). */
export function irrigationResponse(allowances: number[], cornPrice: number, pumpCost = PUMP_PER_ACRE_INCH, years = YEARS.slice(0, 100)): Array<ResponsePoint & { pumped: number }> {
  return allowances.map((cap) => {
    let ys = 0;
    let pumped = 0;
    for (const y of years) {
      const r = fieldSeason(y, { district: 'plains', crop: 'corn', irrigation: cap > 0 ? { ...PLAINS_IRRIGATION, cap } : null });
      ys += r.yield;
      pumped += r.irrigationTotal;
    }
    const yAvg = ys / years.length;
    const p = pumped / years.length;
    return { level: cap, yield: yAvg, pumped: p, net: yAvg * (cornPrice - perBushelCost('corn')) - p * pumpCost };
  });
}

/** The level with the highest net return. */
export function bestLevel(points: ResponsePoint[]): ResponsePoint {
  return points.reduce((a, b) => (b.net > a.net ? b : a));
}
