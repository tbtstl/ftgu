// Harvest: when to take the crop out of the field.
//
// Corn reaches black layer at about 32% moisture and keeps drying in the field afterward —
// quickly in warm September weather, slowly in a cool, damp November. Waiting saves the cost of
// drying it in a bin, but every week in the field costs some grain: stalks weaken and fall over,
// ears drop, and storms knock down more. Wheat is ready when it is dry enough to thresh, and rain
// on ripe wheat makes the kernels sprout and lose weight, which buyers discount.

import type { DayWeather } from '../../model/agriculture/climate';
import { DRYING_PER_POINT } from '../../model/agriculture/economics';
import { vpd } from './crop';

/** Kernel moisture at black layer, percent (wet basis). */
export const BLACK_LAYER_MOISTURE = 32;
/** The moisture buyers price corn at, percent. Wetter corn has to be dried to this. */
export const STANDARD_MOISTURE = 15;

/** Moisture the grain dries toward in today's air, percent: drier air, drier grain. */
export function equilibriumMoisture(w: DayWeather): number {
  return Math.max(11, Math.min(18, 17 - 3.5 * vpd(w)));
}

/**
 * Corn kernel moisture each day from black layer (index 0) to the end of the year. Each day the grain
 * loses a share of its excess moisture that grows with warmth; rain wets it a little.
 */
export function cornDrydown(weather: DayWeather[], maturityDay: number, start = BLACK_LAYER_MOISTURE): number[] {
  const out: number[] = [];
  let m = start;
  for (let d = maturityDay; d < weather.length; d++) {
    out.push(m);
    const w = weather[d];
    const t = (w.tmax + w.tmin) / 2;
    const k = 0.003 * Math.max(0, t + 4);
    const me = equilibriumMoisture(w);
    if (w.rain >= 0.25) m = Math.min(start, m + 0.4);
    else m = m - k * Math.max(0, m - me);
  }
  return out;
}

/**
 * Share of the standing crop lost in the field each day after black layer: little at first, more
 * as stalks weaken after a month, and a jump on stormy days (heavy rain), when weakened stalks lodge.
 */
export function dailyFieldLoss(daysAfterMaturity: number, w: DayWeather): number {
  const base = daysAfterMaturity < 30 ? 0.0004 : 0.0004 + 0.0012 * Math.min(1, (daysAfterMaturity - 30) / 30);
  const storm = w.rain >= 1 ? 0.004 + 0.006 * Math.min(1, daysAfterMaturity / 45) : 0;
  return base + storm;
}

/** Cumulative share of the crop lost in the field by each day after black layer (index 0 = black layer). */
export function cumulativeFieldLoss(weather: DayWeather[], maturityDay: number): number[] {
  const out: number[] = [];
  let standing = 1;
  for (let d = maturityDay; d < weather.length; d++) {
    out.push(1 - standing);
    standing *= 1 - dailyFieldLoss(d - maturityDay, weather[d]);
  }
  return out;
}

/** Extra grain the combine leaves behind when the crop is very wet or very dry, share of yield. */
export function machineLoss(moisture: number): number {
  if (moisture > 25) return 0.01 + 0.004 * (moisture - 25);
  if (moisture < 16) return 0.01 + 0.005 * (16 - moisture);
  return 0.01;
}

/** Cost of drying a bushel from `moisture` to the standard, $. */
export function dryingCost(moisture: number, perPoint = DRYING_PER_POINT): number {
  return Math.max(0, moisture - STANDARD_MOISTURE) * perPoint;
}

export interface HarvestDay {
  day: number;
  acres: number;
  moisture: number;
  fieldLoss: number;
  machineLoss: number;
  /** Bushels sold per acre harvested that day. */
  bushels: number;
  /** $ per acre harvested that day after drying. */
  value: number;
}

export interface HarvestRun {
  days: HarvestDay[];
  /** Day the last acre came out, or −1 if it didn't by year's end. */
  finished: number;
  /** Averages per acre over the whole crop. */
  bushelsPerAcre: number;
  valuePerAcre: number;
  dryingPerAcre: number;
  lossShare: number;
  meanMoisture: number;
}

/**
 * Harvests `acres` of corn that reached black layer on `maturityDay` with standing yield `yieldBu`,
 * starting on day `start` at `perDay` acres per workable day. Each day's acres carry that day's
 * moisture and losses; the grain is dried to the standard and valued at `price`.
 */
export function cornHarvest(weather: DayWeather[], maturityDay: number, yieldBu: number, acres: number, start: number, perDay: number, price: number, dryPerPoint = DRYING_PER_POINT): HarvestRun {
  const moisture = cornDrydown(weather, maturityDay);
  const loss = cumulativeFieldLoss(weather, maturityDay);
  const days: HarvestDay[] = [];
  let left = acres;
  let finished = -1;
  let bu = 0;
  let value = 0;
  let drying = 0;
  let lossBu = 0;
  let mSum = 0;
  for (let d = Math.max(start, maturityDay); d < weather.length && left > 1e-9; d++) {
    if (weather[d].rain >= 0.1) continue;
    const i = d - maturityDay;
    const m = moisture[i];
    const fl = loss[i];
    const ml = machineLoss(m);
    const a = Math.min(perDay, left);
    left -= a;
    const b = yieldBu * (1 - fl) * (1 - ml);
    const dry = dryingCost(m, dryPerPoint) * b;
    days.push({ day: d, acres: a, moisture: m, fieldLoss: fl, machineLoss: ml, bushels: b, value: b * price - dry });
    bu += a * b;
    value += a * (b * price - dry);
    drying += a * dry;
    lossBu += a * yieldBu * (1 - (1 - fl) * (1 - ml));
    mSum += a * m;
    if (left <= 1e-9) finished = d;
  }
  const done = acres - Math.max(0, left);
  return {
    days,
    finished,
    bushelsPerAcre: done ? bu / done : 0,
    valuePerAcre: done ? value / done : 0,
    dryingPerAcre: done ? drying / done : 0,
    lossShare: done ? lossBu / (done * yieldBu) : 0,
    meanMoisture: done ? mSum / done : 0,
  };
}

// ---------------------------------------------------------------------------
// Wheat: rain on a ripe crop.

/** Moisture at which wheat can be threshed and stored without drying, percent. */
export const WHEAT_HARVEST_MOISTURE = 13.5;

/**
 * Sprout damage on ripe wheat: each wet day it stands in the field after ripening adds to it, more
 * when warm. Returned as the share of kernels sprouted by each day after ripeness.
 */
export function sproutDamage(weather: DayWeather[], ripeDay: number, days = 30): number[] {
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < days && ripeDay + i < weather.length; i++) {
    out.push(s);
    const w = weather[ripeDay + i];
    const wet = w.rain >= 0.2 ? 1 : w.rain >= 0.05 ? 0.4 : 0;
    const warm = Math.max(0, Math.min(1, ((w.tmax + w.tmin) / 2 - 10) / 15));
    s = Math.min(0.6, s + 0.008 * wet * (0.5 + warm) * (1 + 6 * s));
  }
  return out;
}

/**
 * The buyer's discount for sprouted wheat, $ per bushel: nothing below 2% sprouted, then rising —
 * badly sprouted wheat can't be milled into bread flour and goes for feed.
 */
export function sproutDiscount(sprouted: number, price: number): number {
  if (sprouted < 0.02) return 0;
  if (sprouted < 0.08) return 0.15 + 4 * (sprouted - 0.02);
  return Math.min(0.45 * price, 0.39 + 5 * (sprouted - 0.08));
}
