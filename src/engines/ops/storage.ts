// Battery model: power and energy limits, with round-trip losses split evenly between charging
// and discharging. Positive MW = discharging to the grid; negative = charging from it.

import type { Battery } from '../../model/types';

export interface BatteryStep {
  /** MW actually delivered (+) or drawn (−) after limits. */
  mw: number;
  /** State of charge after the step, MWh. */
  socMWh: number;
  /** Energy lost to inefficiency during the step, MWh. */
  lossMWh: number;
}

export function stepBattery(b: Pick<Battery, 'powerMW' | 'energyMWh' | 'efficiency'>, socMWh: number, requestMW: number, hours = 1): BatteryStep {
  const eta = Math.sqrt(Math.max(1e-6, b.efficiency));
  if (requestMW >= 0) {
    const max = Math.min(b.powerMW, (socMWh * eta) / hours);
    const mw = Math.min(requestMW, max);
    const drawn = (mw * hours) / eta;
    return { mw, socMWh: Math.max(0, socMWh - drawn), lossMWh: drawn - mw * hours };
  }
  const max = Math.min(b.powerMW, (b.energyMWh - socMWh) / (eta * hours));
  const mw = -Math.min(-requestMW, max);
  const stored = -mw * hours * eta;
  return { mw, socMWh: Math.min(b.energyMWh, socMWh + stored), lossMWh: -mw * hours - stored };
}

/** Run a schedule of requested MW (one per step) and return what actually happened. */
export function runBattery(b: Battery, schedule: number[], hours = 1) {
  let soc = b.soc0 * b.energyMWh;
  const socs = [soc];
  const mw: number[] = [];
  let loss = 0;
  for (const req of schedule) {
    const s = stepBattery(b, soc, req, hours);
    soc = s.socMWh;
    socs.push(soc);
    mw.push(s.mw);
    loss += s.lossMWh;
  }
  return { mw, soc: socs, lossMWh: loss };
}
