// Removing the heat. Every watt a data center's IT equipment draws ends up as heat that must be
// carried out of the chips, out of the servers, and out of the building. Air does this badly and
// liquid well; outdoor air can do much of it for free when it's cold enough; otherwise chillers
// pump the heat uphill, at a cost in electricity. The total shows up in PUE.

import { ACCELERATORS, type Cooling, type GpuId } from '../../model/compute/hardware';
import { outdoorTempC, type Site } from '../../model/compute/sites';
import { MAX_JUNCTION_C, dynamicPowerW, leakagePowerW, minVoltageFor } from './chipPower';
import { POWER_DEFAULTS, powerChain, type PowerChainConfig } from './facilityPower';

// ---------------------------------------------------------------------------
// Carrying heat: Q = ṁ · c · ΔT.

export const AIR = { specificHeat: 1005, density: 1.2 }; // J/kg·K, kg/m³
export const WATER = { specificHeat: 4186, density: 1000 };

/** Air flow to carry `kw` with a temperature rise of `deltaC`, m³/s. */
export function airflowM3s(kw: number, deltaC: number): number {
  return (kw * 1000) / (AIR.specificHeat * deltaC) / AIR.density;
}

/** Water flow to carry `kw` with a temperature rise of `deltaC`, liters per second. */
export function waterFlowLs(kw: number, deltaC: number): number {
  return (kw * 1000) / (WATER.specificHeat * deltaC);
}

// ---------------------------------------------------------------------------
// The chip.

/** Thermal resistance from the coolant (air at the server inlet, or water at the cold plate) to the chip, K/W. */
export const CHIP_RTH: Record<Cooling, number> = { air: 0.06, liquid: 0.05 };

export function junctionC(chipW: number, coolantC: number, cooling: Cooling): number {
  return coolantC + chipW * CHIP_RTH[cooling];
}

/** Most power a chip can dissipate without passing its junction limit. */
export function maxChipW(coolantC: number, cooling: Cooling): number {
  return Math.max(0, (MAX_JUNCTION_C - coolantC) / CHIP_RTH[cooling]);
}

/** Power of Lesson 1.5's die at clock f, at the lowest voltage that runs it (full activity, 75 °C). */
function diePowerAt(clockGHz: number): number {
  const v = minVoltageFor(clockGHz);
  return dynamicPowerW(v, clockGHz, 1) + leakagePowerW(v, 75);
}

/**
 * Share of full speed a chip keeps when it must cut its power to `share` of its rating: it lowers
 * clock and voltage together, so power falls faster than speed (Lesson 1.5's die, normalized at 2 GHz).
 */
export function speedAtPowerShare(share: number): number {
  if (share >= 1) return 1;
  if (share <= 0) return 0;
  const full = diePowerAt(2);
  let lo = 0.3;
  let hi = 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (diePowerAt(mid) / full > share) hi = mid;
    else lo = mid;
  }
  return lo / 2;
}

export interface ChipCooling {
  junctionC: number;
  /** The chip must slow down to stay at its limit. */
  throttled: boolean;
  /** Share of full speed it keeps. */
  speed: number;
  /** Power it runs at, W. */
  chipW: number;
}

export function chipCooling(gpu: GpuId, coolantC: number, cooling: Cooling): ChipCooling {
  const tdp = ACCELERATORS[gpu].tdpW;
  const allowed = maxChipW(coolantC, cooling);
  if (allowed >= tdp) return { junctionC: junctionC(tdp, coolantC, cooling), throttled: false, speed: 1, chipW: tdp };
  return { junctionC: MAX_JUNCTION_C, throttled: true, speed: speedAtPowerShare(allowed / tdp), chipW: allowed };
}

// ---------------------------------------------------------------------------
// The building.

export interface CoolingPlant {
  cooling: Cooling;
  /** Temperature of the coolant delivered to the IT equipment: supply air, or water for the cold plates, °C. */
  supplyC: number;
}

/** Share of a liquid-cooled server's heat that the cold plates capture; the rest still goes to air. */
export const LIQUID_CAPTURE = 0.8;
/** Approach: outdoor air must be this much cooler than the coolant for dry coolers to reject heat unaided, °C. */
export const APPROACH_C = 8;
/** Chilled water for air cooling runs this much below the supply air, °C. */
export const CHILLED_WATER_OFFSET_C = 8;

/** Coefficient of performance of a chiller lifting heat from `fromC` to outdoor air at `outdoorC`. */
export function chillerCop(fromC: number, outdoorC: number): number {
  const lift = Math.max(0, outdoorC + 10 - fromC);
  return Math.max(2.5, Math.min(12, 9 - 0.2 * lift));
}

/**
 * Share of a heat stream that free cooling handles when the coolant is at `waterC`: all of it if the
 * outdoors (adjusted for humidity) is cold enough, none if too warm, in between over 6 °C.
 */
export function freeShare(waterC: number, outdoorC: number, humidity: number): number {
  const effective = outdoorC + 4 * humidity;
  const limit = waterC - APPROACH_C;
  if (effective <= limit - 6) return 1;
  if (effective >= limit) return 0;
  return (limit - effective) / 6;
}

export interface CoolingHour {
  /** Electricity for cooling per kW of IT heat. */
  coolingPerKW: number;
  /** Share of the heat rejected without chillers. */
  freeShare: number;
}

/** Cooling electricity for one hour at a given outdoor temperature, per kW of IT load. */
export function coolingHour(p: CoolingPlant, outdoorC: number, humidity: number): CoolingHour {
  const airStream = (heat: number, supplyAirC: number) => {
    const water = supplyAirC - CHILLED_WATER_OFFSET_C;
    const free = freeShare(water, outdoorC, humidity);
    const mech = (heat * (1 - free)) / chillerCop(water, outdoorC);
    const fans = 0.06 * heat; // air handlers moving the room's air
    const pumps = 0.02 * heat; // water loops and tower or dry-cooler fans
    return { power: mech + fans + pumps, free: free * heat };
  };
  if (p.cooling === 'air') {
    const a = airStream(1, p.supplyC);
    return { coolingPerKW: a.power, freeShare: a.free };
  }
  // Liquid: most heat leaves in warm water; the rest still needs air cooling at 24 °C.
  const water = LIQUID_CAPTURE;
  const free = freeShare(p.supplyC, outdoorC, humidity);
  const mech = (water * (1 - free)) / chillerCop(p.supplyC, outdoorC);
  const pumps = 0.03 * water; // pumps and the cooling distribution units
  const air = airStream(1 - LIQUID_CAPTURE, 24);
  return { coolingPerKW: mech + pumps + air.power, freeShare: free * water + air.free };
}

export interface AnnualCooling {
  /** Average cooling electricity per kW of IT. */
  coolingPerKW: number;
  /** Share of the year's heat rejected without chillers. */
  freeShare: number;
  /** Electrical losses per kW of IT, from the power chain. */
  electricalPerKW: number;
  /** Lights, offices, security: per kW of IT. */
  miscPerKW: number;
  pue: number;
  /** Hottest hour's PUE. */
  peakPue: number;
}

export const MISC_PER_KW = 0.01;

/** PUE over a year at a site: hourly cooling from the site's temperatures, plus the power chain's losses. */
export function annualPue(site: Site, p: CoolingPlant, chain: PowerChainConfig = POWER_DEFAULTS): AnnualCooling {
  const electrical = powerChain(chain).electricalPue - 1;
  let cool = 0;
  let free = 0;
  let peak = 0;
  for (let h = 0; h < 8760; h++) {
    const c = coolingHour(p, outdoorTempC(site, h), site.humidity);
    cool += c.coolingPerKW;
    free += c.freeShare;
    peak = Math.max(peak, c.coolingPerKW);
  }
  const coolingPerKW = cool / 8760;
  return {
    coolingPerKW,
    freeShare: free / 8760,
    electricalPerKW: electrical,
    miscPerKW: MISC_PER_KW,
    pue: 1 + coolingPerKW + electrical + MISC_PER_KW,
    peakPue: 1 + peak + electrical + MISC_PER_KW,
  };
}
