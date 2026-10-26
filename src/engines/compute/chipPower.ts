// Why chips get hot: every clock tick charges and discharges billions of tiny capacitors, so
// dynamic power is a·C·V²·f; leakage adds a share that grows with voltage and temperature; and the
// fastest clock a chip can run is set by its slowest chain of gates, which speeds up with voltage.
// The example chip is a fictional A-class-sized GPU die: about 700 W at 0.8 V and 2 GHz.

import { gateDelayPs } from './transistor';

/** Gate delays on the chip's slowest path between clocked registers. */
export const CRITICAL_PATH_GATES = 62;
/** Switched capacitance of the whole die at full activity, F. */
export const CHIP_CAPACITANCE_F = 4.6e-7;
/** Leakage current of the whole die at 0.8 V and 60 °C, A (about 56 W). */
export const LEAK_AMPS_REF = 70;
/** Leakage doubles for every this many °C. */
export const LEAK_DOUBLING_C = 25;
/** Thermal resistance from the die to the coolant, K/W (a liquid cold plate). */
export const DIE_THERMAL_RESISTANCE = 0.05;
/** The die throttles (slows its clock) above this junction temperature, °C. */
export const MAX_JUNCTION_C = 90;
/** Floating-point operations per clock cycle at full activity (≈ 989 TFLOPS at 1.98 GHz). */
export const FLOPS_PER_CYCLE = 989e12 / 1.98e9;

/** Fastest clock the chip's critical path allows at supply voltage `vdd`, GHz. */
export function maxClockGHz(vdd: number): number {
  const ps = CRITICAL_PATH_GATES * gateDelayPs(vdd);
  return Number.isFinite(ps) && ps > 0 ? 1000 / ps : 0;
}

/** Lowest supply voltage that runs a given clock, V (bisection over 0.35–1.3 V). */
export function minVoltageFor(clockGHz: number): number {
  let lo = 0.35;
  let hi = 1.3;
  if (maxClockGHz(hi) < clockGHz) return Infinity;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (maxClockGHz(mid) >= clockGHz) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Dynamic power a·C·V²·f, W. `activity` is the share of the chip switching each cycle (0–1). */
export function dynamicPowerW(vdd: number, clockGHz: number, activity: number, capacitanceF = CHIP_CAPACITANCE_F): number {
  return activity * capacitanceF * vdd * vdd * clockGHz * 1e9;
}

/**
 * Leakage power at a voltage and junction temperature, W. Leakage current rises with voltage
 * (drain-induced barrier lowering: roughly tenfold per 0.8 V here) and doubles every 25 °C.
 */
export function leakagePowerW(vdd: number, junctionC: number): number {
  const amps = LEAK_AMPS_REF * 10 ** ((vdd - 0.8) / 0.8) * 2 ** ((junctionC - 60) / LEAK_DOUBLING_C);
  return vdd * amps;
}

export interface ChipState {
  vdd: number;
  clockGHz: number;
  activity: number;
  coolantC: number;
  /** The clock is too fast for this voltage: results would be wrong. */
  timingFails: boolean;
  dynamicW: number;
  leakageW: number;
  totalW: number;
  junctionC: number;
  /** Leakage and temperature feed each other without settling. */
  runaway: boolean;
  overheated: boolean;
  /** TFLOPS of useful arithmetic (zero if timing fails). */
  tflops: number;
  /** Energy per floating-point operation, pJ. */
  pjPerFlop: number;
}

/**
 * Steady state of the chip: power heats the die, a hotter die leaks more, and that heats it
 * further. Iterates temperature to a fixed point (or detects runaway).
 */
export function chipState(vdd: number, clockGHz: number, activity: number, coolantC = 40, rTh = DIE_THERMAL_RESISTANCE): ChipState {
  const timingFails = clockGHz > maxClockGHz(vdd) + 1e-9;
  const dyn = dynamicPowerW(vdd, clockGHz, activity);
  let tj = coolantC + dyn * rTh;
  let leak = leakagePowerW(vdd, tj);
  let runaway = false;
  for (let i = 0; i < 200; i++) {
    const next = coolantC + (dyn + leak) * rTh;
    if (next > 250) {
      runaway = true;
      tj = next;
      break;
    }
    if (Math.abs(next - tj) < 1e-6) {
      tj = next;
      break;
    }
    tj = next;
    leak = leakagePowerW(vdd, tj);
  }
  leak = leakagePowerW(vdd, Math.min(tj, 250));
  const total = dyn + leak;
  const tflops = timingFails ? 0 : (activity * FLOPS_PER_CYCLE * clockGHz * 1e9) / 1e12;
  return {
    vdd,
    clockGHz,
    activity,
    coolantC,
    timingFails,
    dynamicW: dyn,
    leakageW: leak,
    totalW: total,
    junctionC: tj,
    runaway,
    overheated: runaway || tj > MAX_JUNCTION_C,
    tflops,
    pjPerFlop: tflops > 0 ? (total / (tflops * 1e12)) * 1e12 : Infinity,
  };
}

/**
 * Many slower units against one fast one, at the same total work rate: `units` copies of the
 * chip's logic, each clocked at `targetGHz / units`, each at the lowest voltage that clock needs.
 * Leakage grows with the number of units (more transistors powered), so there is a best number.
 */
export function parallelPower(units: number, targetGHz: number, activity = 1, junctionC = 60) {
  const clock = targetGHz / units;
  const v = Math.max(minVoltageFor(clock), 0.45);
  const dyn = units * dynamicPowerW(v, clock, activity);
  const leak = units * leakagePowerW(v, junctionC);
  return { units, clockGHz: clock, vdd: v, dynamicW: dyn, leakageW: leak, totalW: dyn + leak };
}
