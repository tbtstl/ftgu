// Generation mix planning: build a fleet by technology, dispatch it over a day, and add up what
// it costs, what it emits and how much of it can be counted on at the peak. Also the classic
// screening curve: the average cost of a megawatt-hour against the hours a plant runs per year.

import { STANDARD_FLEET } from '../../model/fleet';
import type { Fuel, Generator, Hourly } from '../../model/types';
import { dispatchDay, type DispatchUnit, type HourDispatch } from './dispatch';

/** Technologies a mix can be built from, in merit order (cheapest to run first). */
export const MIX_FUELS = ['nuclear', 'wind', 'solar', 'hydro', 'coal', 'gasCC', 'gasCT', 'oil'] as const satisfies readonly Fuel[];
export type MixFuel = (typeof MIX_FUELS)[number];

/**
 * Each technology takes its costs, availability and emissions from the standard fleet's plant of
 * that type (for gas combined-cycle, the newer Lakeside plant).
 */
export const MIX_TECH: Record<MixFuel, Generator> = Object.fromEntries(
  MIX_FUELS.map((f) => [f, STANDARD_FLEET.find((g) => g.fuel === f)!]),
) as Record<MixFuel, Generator>;

export type Mix = Record<MixFuel, number>;

/** The standard fleet's capacity by technology (Lakeside and Mill Creek counted together). */
export const STANDARD_MIX: Mix = Object.fromEntries(
  MIX_FUELS.map((f) => [f, STANDARD_FLEET.filter((g) => g.fuel === f).reduce((s, g) => s + g.capacity, 0)]),
) as Mix;

export interface MixWeather {
  demand: Hourly;
  /** Wind and solar capacity factors per hour. */
  wind: Hourly;
  solar: Hourly;
}

export interface MixResult {
  hours: HourDispatch[];
  /** MWh produced by each technology over the day. */
  energy: Mix;
  /** Energy ÷ (capacity × hours) for each technology; 0 where nothing is built. */
  capacityFactor: Mix;
  /** Fuel and other running costs over the day, $. */
  variableCost: number;
  /** The day's share of annualized capital and fixed costs (fixedCost × MW ÷ 365), $. */
  fixedCost: number;
  totalCost: number;
  /** Per technology, $ over the day. */
  variableBy: Mix;
  fixedBy: Mix;
  /** tCO2 over the day. */
  emissions: number;
  /** Demand that couldn't be met, MWh. */
  unserved: number;
  /** Wind and solar output turned away, MWh. */
  curtailed: number;
  /** Generation forced on by must-run floors beyond demand, MWh. */
  overGeneration: number;
  nameplate: number;
  /** Capacity that can be counted on at any hour: non-weather plants × availability, MW. */
  firm: number;
  peak: number;
}

function zeroMix(): Mix {
  return Object.fromEntries(MIX_FUELS.map((f) => [f, 0])) as Mix;
}

/** Dispatch units for a mix: must-run plants keep the floor of their fleet example, weather limits wind and solar. */
export function mixUnits(mix: Partial<Mix>, weather: Pick<MixWeather, 'wind' | 'solar'>): DispatchUnit[] {
  return MIX_FUELS.map((f) => {
    const g = MIX_TECH[f];
    const mw = Math.max(0, mix[f] ?? 0);
    return {
      id: f,
      capacity: mw,
      minOutput: g.dispatchable || g.variable ? 0 : (g.minOutput / g.capacity) * mw,
      cost: g.marginalCost,
      available: f === 'wind' ? weather.wind.map((cf) => cf * mw) : f === 'solar' ? weather.solar.map((cf) => cf * mw) : undefined,
    };
  });
}

/**
 * Dispatch a mix in merit order over a day (no ramp limits) and total its costs and emissions.
 * Every plant is assumed available on the day itself; `firm` derates by availability instead.
 */
export function evaluateMix(mix: Partial<Mix>, weather: MixWeather): MixResult {
  const hours = dispatchDay(mixUnits(mix, weather), weather.demand, { ramp: false });
  const energy = zeroMix();
  const variableBy = zeroMix();
  const fixedBy = zeroMix();
  const capacityFactor = zeroMix();
  let emissions = 0;
  let unserved = 0;
  let curtailed = 0;
  let overGeneration = 0;
  for (const h of hours) {
    unserved += h.shortfall;
    curtailed += h.curtailed;
    overGeneration += h.overGeneration;
    for (const f of MIX_FUELS) energy[f] += h.output[f] ?? 0;
  }
  let nameplate = 0;
  let firm = 0;
  for (const f of MIX_FUELS) {
    const g = MIX_TECH[f];
    const mw = Math.max(0, mix[f] ?? 0);
    variableBy[f] = energy[f] * g.marginalCost;
    fixedBy[f] = (mw * g.fixedCost) / 365;
    emissions += energy[f] * g.emissions;
    capacityFactor[f] = mw > 0 ? energy[f] / (mw * hours.length) : 0;
    nameplate += mw;
    if (!g.variable) firm += mw * g.availability;
  }
  const variableCost = MIX_FUELS.reduce((s, f) => s + variableBy[f], 0);
  const fixedCost = MIX_FUELS.reduce((s, f) => s + fixedBy[f], 0);
  return {
    hours,
    energy,
    capacityFactor,
    variableCost,
    fixedCost,
    totalCost: variableCost + fixedCost,
    variableBy,
    fixedBy,
    emissions,
    unserved,
    curtailed,
    overGeneration,
    nameplate,
    firm,
    peak: Math.max(...weather.demand),
  };
}

/**
 * Screening curve: average cost of energy from a plant run `hoursPerYear` hours a year,
 * $/MWh = annual fixed cost ÷ hours + running cost + carbon price × emissions.
 */
export function screeningCost(g: Pick<Generator, 'fixedCost' | 'marginalCost' | 'emissions'>, hoursPerYear: number, carbonPrice = 0): number {
  const h = Math.max(1e-6, hoursPerYear);
  return g.fixedCost / h + g.marginalCost + carbonPrice * g.emissions;
}

/** Hours a year above which plant `a` (cheaper to run) beats plant `b` (cheaper to build); Infinity if never. */
export function crossoverHours(
  a: Pick<Generator, 'fixedCost' | 'marginalCost' | 'emissions'>,
  b: Pick<Generator, 'fixedCost' | 'marginalCost' | 'emissions'>,
  carbonPrice = 0,
): number {
  const dRun = b.marginalCost + carbonPrice * b.emissions - (a.marginalCost + carbonPrice * a.emissions);
  const dFix = a.fixedCost - b.fixedCost;
  if (dRun <= 0) return dFix <= 0 ? 0 : Infinity;
  return Math.max(0, dFix / dRun);
}
