// A field-effect transistor as a voltage-controlled switch, and the CMOS inverter built from a
// pair of them. The current model (a simplified EKV model) is smooth from "off", where a tiny
// leakage current grows tenfold for every ~78 mV on the gate, to "on", where current grows with
// the square of the gate's overdrive. Currents are per micrometer of transistor width.

import { thermalVoltage } from './semiconductor';

export interface FetParams {
  /** Threshold voltage, V. */
  vth: number;
  /** Subthreshold slope factor; the swing is n·(kT/q)·ln 10 per decade. */
  n: number;
  /** Specific current, µA per µm of width. */
  is: number;
}

/** The course's example logic transistor: a 0.30 V threshold and about 1 mA/µm when fully on at 0.8 V. */
export const NFET: FetParams = { vth: 0.3, n: 1.3, is: 18.1 };
/** Its p-channel partner, sized to match. */
export const PFET: FetParams = { vth: 0.3, n: 1.3, is: 18.1 };

/** The supply voltage of the example logic, V. */
export const VDD = 0.8;

function f(x: number): number {
  // ln²(1 + e^(x/2)), computed without overflow.
  const h = x / 2;
  const l = h > 30 ? h : Math.log1p(Math.exp(h));
  return l * l;
}

/**
 * Drain current of an n-channel transistor, µA/µm, for gate–source and drain–source voltages (V).
 * Symmetric in source and drain, so it also handles V_DS < 0.
 */
export function drainCurrent(vgs: number, vds: number, p: FetParams = NFET, tempK = 300): number {
  const vt = thermalVoltage(tempK);
  const vp = (vgs - p.vth) / p.n;
  return p.is * (f(vp / vt) - f((vp - vds) / vt));
}

/** Subthreshold swing: millivolts of gate voltage per tenfold change in off-state current. */
export function subthresholdSwingMV(p: FetParams = NFET, tempK = 300): number {
  return p.n * thermalVoltage(tempK) * Math.LN10 * 1000;
}

/** On current (gate and drain both at the supply), µA/µm. */
export function onCurrent(vdd = VDD, p: FetParams = NFET, tempK = 300): number {
  return drainCurrent(vdd, vdd, p, tempK);
}

/** Off current (gate at 0 V, drain at the supply): the leakage, µA/µm. */
export function offCurrent(vdd = VDD, p: FetParams = NFET, tempK = 300): number {
  return drainCurrent(0, vdd, p, tempK);
}

/** Region the transistor is in, for labels. */
export function fetRegion(vgs: number, vds: number, p: FetParams = NFET): 'off' | 'linear' | 'saturated' {
  if (vgs < p.vth) return 'off';
  return vds < (vgs - p.vth) / p.n ? 'linear' : 'saturated';
}

/**
 * Output voltage of a CMOS inverter with input vin: the voltage at which the n-channel
 * transistor's pull-down current equals the p-channel transistor's pull-up current.
 */
export function inverterOut(vin: number, vdd = VDD, n: FetParams = NFET, p: FetParams = PFET): number {
  let lo = 0;
  let hi = vdd;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const down = drainCurrent(vin, mid, n);
    const up = drainCurrent(vdd - vin, vdd - mid, p);
    if (down > up) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Current drawn straight through an inverter from supply to ground at input vin (µA/µm): only a leak unless it's mid-switch. */
export function inverterThroughCurrent(vin: number, vdd = VDD, n: FetParams = NFET, p: FetParams = PFET): number {
  const vout = inverterOut(vin, vdd, n, p);
  return drainCurrent(vin, vout, n);
}

/**
 * Load a logic gate drives, fF per µm of its transistors' width: the gates of the four similar
 * gates it typically feeds, its own drain, and the wire between them.
 */
export const LOAD_FF_PER_UM = 10;

/**
 * Time for a gate to swing its output halfway (ps): the charge C·V/2 moved at an average current
 * of about half the on current. Higher supply voltage or a lower threshold means more current
 * and a faster gate. About 8 ps for the example transistor at 0.8 V.
 */
export function gateDelayPs(vdd = VDD, p: FetParams = NFET, loadFF = LOAD_FF_PER_UM, tempK = 300): number {
  const iOn = onCurrent(vdd, p, tempK); // µA/µm
  if (iOn <= 0) return Infinity;
  // fF × V / µA = 1e-15 C / 1e-6 A = 1e-9 s = 1000 ps
  return ((loadFF * vdd) / iOn) * 1000;
}
