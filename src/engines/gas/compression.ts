// Compressor stations: the power it takes to raise a pipeline's pressure, how hot the gas comes
// out, and the gas the station burns to do it. Compression is modeled as adiabatic with an
// efficiency: the ideal (isentropic) work is
//
//   W = k/(k − 1) · Z · R · T1 · [(P2/P1)^((k−1)/k) − 1]   per lb-mol,
//
// divided by the compressor's adiabatic efficiency. The gas turbines that drive most pipeline
// compressors burn some of the gas they move.

import { zFactor } from './eos';
import { outletPressure, pipeFlow, type Pipe } from './hydraulics';
import { MMBTU_PER_MCF, PIPELINE_GAS, R_FTLBF, SCF_PER_LBMOL, rankine, type Composition } from './properties';

/** Ratio of specific heats for natural gas. */
export const K_GAS = 1.28;
/** Typical adiabatic efficiency of a pipeline centrifugal compressor. */
export const COMPRESSOR_EFFICIENCY = 0.8;
/** Fuel a gas-turbine driver burns per horsepower-hour, Btu (about 32% efficient). */
export const DRIVER_HEAT_RATE = 8000;
/** ft·lbf per second in one horsepower. */
const FTLBF_PER_S_PER_HP = 550;

export interface Compression {
  ratio: number;
  /** Shaft horsepower the compressor needs. */
  hp: number;
  /** The same power in megawatts. */
  mw: number;
  /** Discharge temperature, °F. */
  dischargeF: number;
  /** Discharge temperature an ideal (isentropic) compressor would reach, °F. */
  isentropicDischargeF: number;
  /** Fuel the driver burns, MMBtu/d and MMcf/d. */
  fuelMMBtuPerDay: number;
  fuelMMcfd: number;
  /** Fuel as a share of the throughput. */
  fuelShare: number;
}

/** One stage of compression of `qMMcfd` from suction to discharge pressure (psia). */
export function compress(
  qMMcfd: number,
  suctionPsia: number,
  dischargePsia: number,
  suctionF = 60,
  efficiency = COMPRESSOR_EFFICIENCY,
  heatRate = DRIVER_HEAT_RATE,
  gas: Composition = PIPELINE_GAS,
): Compression {
  const ratio = dischargePsia / suctionPsia;
  const e = (K_GAS - 1) / K_GAS;
  const t1 = rankine(suctionF);
  const rise = Math.pow(ratio, e) - 1;
  const isentropicT2 = t1 * (1 + rise);
  const t2 = t1 * (1 + rise / efficiency);
  const z1 = zFactor(suctionPsia, suctionF, gas);
  const z2 = zFactor(dischargePsia, t2 - 459.67, gas);
  const lbmolPerS = (qMMcfd * 1e6) / SCF_PER_LBMOL / 86400;
  const work = ratio > 1 ? (1 / e) * ((z1 + z2) / 2) * R_FTLBF * t1 * rise / efficiency : 0;
  const hp = (lbmolPerS * work) / FTLBF_PER_S_PER_HP;
  const fuelMMBtuPerDay = (hp * heatRate * 24) / 1e6;
  const fuelMMcfd = fuelMMBtuPerDay / MMBTU_PER_MCF / 1000;
  return {
    ratio,
    hp,
    mw: hp * 0.000745700,
    dischargeF: t2 - 459.67,
    isentropicDischargeF: isentropicT2 - 459.67,
    fuelMMBtuPerDay,
    fuelMMcfd,
    fuelShare: qMMcfd > 0 ? fuelMMcfd / qMMcfd : 0,
  };
}

export interface StationLine {
  /** Pipe from the receipt point to the delivery point. */
  pipe: Pipe;
  /** Compressor stations, evenly spaced, the first at the receipt point. */
  stations: number;
  /** Pressure gas arrives at the first station with, psia. */
  receiptPsia: number;
  /** Maximum allowable operating pressure: every station discharges at this, psia. */
  maopPsia: number;
}

export interface StationResult {
  /** Mile post of each station. */
  mile: number;
  suction: number;
  discharge: number;
  compression: Compression;
}

export interface LineResult {
  feasible: boolean;
  stations: StationResult[];
  /** Pressure at the delivery end, psia (NaN if the line can't carry the flow). */
  deliveryPsia: number;
  totalHp: number;
  fuelMMcfd: number;
  fuelShare: number;
}

/** Pressures and compression along a line with evenly spaced stations, each discharging at MAOP. */
export function stationLine(line: StationLine, qMMcfd: number): LineResult {
  const n = Math.max(1, Math.round(line.stations));
  const seg: Pipe = { ...line.pipe, lengthMi: line.pipe.lengthMi / n };
  const out: StationResult[] = [];
  let suction = line.receiptPsia;
  let feasible = true;
  for (let i = 0; i < n; i++) {
    const discharge = Math.max(line.maopPsia, suction);
    const c = compress(qMMcfd, suction, discharge);
    out.push({ mile: (i * line.pipe.lengthMi) / n, suction, discharge, compression: c });
    const p2 = outletPressure(seg, discharge, qMMcfd);
    if (!Number.isFinite(p2)) {
      feasible = false;
      suction = NaN;
      break;
    }
    suction = p2;
  }
  const totalHp = out.reduce((s, r) => s + r.compression.hp, 0);
  const fuelMMcfd = out.reduce((s, r) => s + r.compression.fuelMMcfd, 0);
  return { feasible, stations: out, deliveryPsia: suction, totalHp, fuelMMcfd, fuelShare: qMMcfd > 0 ? fuelMMcfd / qMMcfd : 0 };
}

/** The most a line of evenly spaced stations can carry while delivering at least `minDeliveryPsia`, MMcf/d. */
export function lineCapacity(line: StationLine, minDeliveryPsia: number): number {
  const n = Math.max(1, Math.round(line.stations));
  const seg: Pipe = { ...line.pipe, lengthMi: line.pipe.lengthMi / n };
  // Every segment starts at MAOP, so the last one decides: it must end at the minimum delivery pressure.
  return pipeFlow(seg, line.maopPsia, minDeliveryPsia).qMMcfd;
}
