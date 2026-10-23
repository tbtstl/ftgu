// A distribution substation: the day's load from a mix of customer types, how much of the
// transformer capacity it uses, and whether the remaining transformers can carry it if one fails
// (the N-1 test). Loads are treated as drawing real power only, so 1 MW uses 1 MVA.

import { LOAD_SHAPE } from '../../model/profiles';
import type { Hourly, LoadKind } from '../../model/types';

export const LOAD_KINDS: LoadKind[] = ['residential', 'commercial', 'industrial', 'dataCenter'];

export type LoadMix = Record<LoadKind, number>;

/** Hourly load of each customer type, MW, from its peak and the standard daily shape. */
export function loadByKind(peaks: Partial<LoadMix>): Record<LoadKind, Hourly> {
  return Object.fromEntries(LOAD_KINDS.map((k) => [k, LOAD_SHAPE[k].map((v) => v * Math.max(0, peaks[k] ?? 0))])) as Record<LoadKind, Hourly>;
}

export interface SubstationLoad {
  /** Total load each hour, MW. */
  total: Hourly;
  /** The highest hourly total, MW, and when it happens. */
  peak: number;
  peakHour: number;
  /** Sum of each customer type's own peak, MW. */
  sumOfPeaks: number;
  /** Sum of individual peaks ÷ combined peak (≥ 1; 1 when everyone peaks together). */
  diversityFactor: number;
  /** Average load ÷ peak load. */
  loadFactor: number;
}

export function substationLoad(peaks: Partial<LoadMix>): SubstationLoad {
  const by = loadByKind(peaks);
  const total = Array.from({ length: 24 }, (_, h) => LOAD_KINDS.reduce((s, k) => s + by[k][h], 0));
  const peak = Math.max(...total);
  const peakHour = total.indexOf(peak);
  const sumOfPeaks = LOAD_KINDS.reduce((s, k) => s + Math.max(0, peaks[k] ?? 0), 0);
  const avg = total.reduce((s, v) => s + v, 0) / total.length;
  return {
    total,
    peak,
    peakHour,
    sumOfPeaks,
    diversityFactor: peak > 0 ? sumOfPeaks / peak : 1,
    loadFactor: peak > 0 ? avg / peak : 0,
  };
}

export interface TransformerCheck {
  /** Total installed rating, MVA. */
  installed: number;
  /** Rating left after losing one transformer, MVA. */
  firm: number;
  /** Peak ÷ installed rating. */
  peakUtilization: number;
  /** Peak ÷ firm rating (Infinity with a single transformer and any load). */
  n1Utilization: number;
  /** Hours in which the load exceeds the firm rating. */
  n1Violations: number[];
  /** The substation can carry its load at every hour with any one transformer out. */
  n1Secure: boolean;
}

/** Load sharing between `count` identical transformers of `ratingMVA` each. */
export function checkTransformers(load: Hourly, count: number, ratingMVA: number): TransformerCheck {
  const installed = Math.max(0, count) * ratingMVA;
  const firm = Math.max(0, count - 1) * ratingMVA;
  const peak = Math.max(0, ...load);
  const n1Violations = load.map((v, h) => (v > firm + 1e-9 ? h : -1)).filter((h) => h >= 0);
  return {
    installed,
    firm,
    peakUtilization: installed > 0 ? peak / installed : peak > 0 ? Infinity : 0,
    n1Utilization: firm > 0 ? peak / firm : peak > 0 ? Infinity : 0,
    n1Violations,
    n1Secure: n1Violations.length === 0,
  };
}

/** Rating of a three-phase circuit, MVA, from its line-to-line voltage (kV) and current limit (A). */
export function circuitMVA(kV: number, amps: number): number {
  return (Math.sqrt(3) * kV * amps) / 1000;
}
