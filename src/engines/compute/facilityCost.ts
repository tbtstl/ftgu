// What a GPU-hour costs to produce. Almost all of it is capital: the servers, the network and the
// building with its power and cooling plant, each paid back over its life with interest. The rest
// is electricity (scaled by PUE) and upkeep. Spread over the hours the GPUs are actually used, that
// gives the cost of a used GPU-hour, the floor under any price a GPU cloud can charge for long.
// Every price here is simulated.

import { ACCELERATORS, SERVERS, serverPowerW, type Cooling, type GpuId } from '../../model/compute/hardware';
import type { Site } from '../../model/compute/sites';

/** Building, power and cooling plant per kW of IT capacity, $ (before the site's cost index). */
export const FACILITY_CAPEX_PER_KW: Record<Cooling, number> = { air: 10_000, liquid: 11_000 };
/** Network per GPU at a non-blocking fabric, $ (see dcNetwork.ts); L-class cards use cheaper 100 Gb/s links. */
export const NETWORK_PER_GPU: Record<GpuId, number> = { L: 1_500, A: 4_200, B: 4_200 };
/** A GPU drawing nothing useful still draws this share of its full-load power. */
export const IDLE_POWER_SHARE = 0.3;
/** Upkeep (staff, spares, support contracts) per year, as a share of hardware capital. */
export const UPKEEP_SHARE = 0.03;

/** Capital recovery factor: the yearly payment that repays $1 over `years` at interest rate `rate`. */
export function capitalRecovery(rate: number, years: number): number {
  if (rate <= 0) return 1 / years;
  return rate / (1 - (1 + rate) ** -years);
}

export interface FacilityPlan {
  gpu: GpuId;
  cooling: Cooling;
  site: Site;
  /** Annual PUE (from cooling.ts). */
  pue: number;
  /** Electricity price, $/MWh (defaults to the site's). */
  powerPrice?: number;
  /** Share of hours the GPUs are sold and busy. */
  utilization: number;
  /** Years over which the servers are paid off (their useful life). */
  serverLifeYears: number;
  /** Years for the building and plant. */
  facilityLifeYears: number;
  /** Cost of capital per year. */
  rate: number;
  /** Network cost per GPU, $ (defaults to NETWORK_PER_GPU). */
  networkPerGpu?: number;
}

export interface GpuHourCost {
  /** Capital per GPU, $. */
  serverCapex: number;
  networkCapex: number;
  facilityCapex: number;
  /** Yearly costs per GPU, $. */
  serverYear: number;
  networkYear: number;
  facilityYear: number;
  powerYear: number;
  upkeepYear: number;
  totalYear: number;
  /** IT power per GPU at full load, kW. */
  itKW: number;
  /** Cost per hour the GPU exists, used or not. */
  perHour: number;
  /** Cost per hour the GPU is actually used. */
  perUsedHour: number;
  /** Electricity as a share of the total. */
  powerShare: number;
}

export function gpuHourCost(p: FacilityPlan): GpuHourCost {
  const s = SERVERS[p.gpu];
  const itKW = serverPowerW(p.gpu, p.cooling) / 1000 / s.gpus;
  const serverCapex = s.capex / s.gpus;
  const networkCapex = p.networkPerGpu ?? NETWORK_PER_GPU[p.gpu];
  const facilityCapex = itKW * FACILITY_CAPEX_PER_KW[p.cooling] * p.site.buildCostIndex;
  const serverYear = serverCapex * capitalRecovery(p.rate, p.serverLifeYears);
  const networkYear = networkCapex * capitalRecovery(p.rate, p.serverLifeYears);
  const facilityYear = facilityCapex * capitalRecovery(p.rate, p.facilityLifeYears);
  const load = IDLE_POWER_SHARE + (1 - IDLE_POWER_SHARE) * p.utilization;
  const price = p.powerPrice ?? p.site.powerPrice;
  const powerYear = (itKW * load * p.pue * 8760 * price) / 1000;
  const upkeepYear = UPKEEP_SHARE * (serverCapex + networkCapex);
  const totalYear = serverYear + networkYear + facilityYear + powerYear + upkeepYear;
  const perHour = totalYear / 8760;
  return {
    serverCapex,
    networkCapex,
    facilityCapex,
    serverYear,
    networkYear,
    facilityYear,
    powerYear,
    upkeepYear,
    totalYear,
    itKW,
    perHour,
    perUsedHour: p.utilization > 0 ? perHour / p.utilization : Infinity,
    powerShare: powerYear / totalYear,
  };
}

/** Utilization at which a used GPU-hour costs exactly `price`. */
export function breakEvenUtilization(p: Omit<FacilityPlan, 'utilization'>, price: number): number {
  let lo = 0.01;
  let hi = 1;
  if (gpuHourCost({ ...p, utilization: hi }).perUsedHour > price) return Infinity;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gpuHourCost({ ...p, utilization: mid }).perUsedHour > price) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Board power of one accelerator, kW (for prose). */
export function boardKW(gpu: GpuId): number {
  return ACCELERATORS[gpu].tdpW / 1000;
}
