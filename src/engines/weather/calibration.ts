// Ensembles drawn from the archive's forecasts, and the verification of a whole archive of them:
// how often each probability came true, where outcomes fall among the members, and the scores
// that reward a forecast for being both sharp and honest. Used by the ensemble lesson; every
// forecast here was issued before its target day and is judged only against what then happened.

import { dayIndex, dayInfo, expectedTemp, forecastTemp, LEAD_MAX, tempF } from '../../model/weather/archive';
import { FENWICK, anomalySd } from '../../model/weather/region';
import { brierScore, brierSkill, crpsNormal, draw, ensembleProbBelow, rankHistogram, reliability, type ReliabilityBin } from './verify';

/** Winter y runs from December 1 of year y through February 28 of year y + 1: 90 days. */
export const WINTER_DAYS = 90;
/** Winters in the archive with all three months: 1–40. */
export const WINTERS = 40;
/** Day-to-day persistence of a member's departure from the forecast mean, so each member is a plausible path. */
export const MEMBER_PERSISTENCE = 0.7;

/** Archive index of a day of winter y (0 = December 1). */
export function winterDay(winter: number, offset: number): number {
  return dayIndex(winter, 11, 1) + offset;
}

export interface Plume {
  /** Issue day (archive index). */
  issue: number;
  /** Forecast mean and standard deviation for leads 1…LEAD_MAX, °F. */
  mean: number[];
  sd: number[];
  /** Each member's path over leads 1…LEAD_MAX, °F. */
  members: number[][];
  /** What happened on each of those days, °F. */
  outcome: number[];
  /** The climate's mean and day-to-day standard deviation on each of those days, °F. */
  climMean: number[];
  climSd: number[];
}

/**
 * The ensemble issued on day `issue`: `n` members whose departures from the forecast mean are
 * standard-normal draws (persistent from one day to the next) scaled by each lead's spread. Every
 * day's members are distributed as the archive's forecast says, N(mean, (spread·sd)²).
 */
export function plume(issue: number, n: number, spread = 1): Plume {
  const mean: number[] = [];
  const sd: number[] = [];
  const outcome: number[] = [];
  const climMean: number[] = [];
  const climSd: number[] = [];
  for (let lead = 1; lead <= LEAD_MAX; lead++) {
    const d = issue + lead;
    const f = forecastTemp('fenwick', d, lead);
    mean.push(f.mean);
    sd.push(f.sd);
    outcome.push(tempF('fenwick', d));
    climMean.push(expectedTemp('fenwick', d));
    climSd.push(anomalySd(FENWICK, dayInfo(d).doy));
  }
  const phi = MEMBER_PERSISTENCE;
  const members = Array.from({ length: n }, (_, m) => {
    let x = 0;
    return mean.map((mu, i) => {
      const e = draw(issue, m * 16 + i + 1);
      x = i === 0 ? e : phi * x + Math.sqrt(1 - phi * phi) * e;
      return mu + spread * sd[i] * x;
    });
  });
  return { issue, mean, sd, members, outcome, climMean, climSd };
}

/** How wide a forecast's spread is relative to the climate's own day-to-day spread at a lead (the same for every day). */
export function spreadRatio(lead: number, knownShare: (k: number) => number): number {
  return Math.sqrt(1 - knownShare(lead));
}

export interface WinterCase {
  d: number;
  mean: number;
  sd: number;
  outcome: number;
}

const caseCache = new Map<number, WinterCase[]>();

/** Every winter day of the archive with the forecast issued `lead` days before it. */
export function winterCases(lead: number): WinterCase[] {
  let c = caseCache.get(lead);
  if (!c) {
    c = [];
    for (let y = 1; y <= WINTERS; y++) {
      for (let i = 0; i < WINTER_DAYS; i++) {
        const d = winterDay(y, i);
        const f = forecastTemp('fenwick', d, lead);
        c.push({ d, mean: f.mean, sd: f.sd, outcome: tempF('fenwick', d) });
      }
    }
    caseCache.set(lead, c);
  }
  return c;
}

/** The raw model's ensemble is overconfident: its members spread only this share as widely as they should. */
export const RAW_SPREAD = 0.6;

export interface CalibrationSettings {
  lead: number;
  /** The event: a daily mean below this temperature, °F. */
  threshold: number;
  /** Multiplies the raw model's spread. */
  inflation: number;
  /** Added to every member, °F. */
  bias: number;
  members: number;
}

export interface CalibrationStats {
  cases: number;
  baseRate: number;
  reliability: ReliabilityBin[];
  rank: number[];
  brier: number;
  brierSkill: number;
  /** Mean CRPS of the ensemble's normal distribution, °F. */
  crps: number;
  /** Share of outcomes colder than every member or warmer than every member. */
  outside: number;
  /** What `outside` would be for a calibrated ensemble of this size: 2/(n + 1). */
  outsideCalibrated: number;
  /** The spread actually used, as a multiple of the calibrated spread. */
  effectiveSpread: number;
}

const statCache = new Map<string, CalibrationStats>();

export function calibrationStats(s: CalibrationSettings): CalibrationStats {
  const key = `${s.lead}|${s.threshold}|${s.inflation.toFixed(3)}|${s.bias}|${s.members}`;
  const hit = statCache.get(key);
  if (hit) return hit;
  const cases = winterCases(s.lead);
  const k = RAW_SPREAD * s.inflation;
  const probs: number[] = [];
  const outcomes: boolean[] = [];
  const ranked: Array<{ members: number[]; outcome: number }> = [];
  let crps = 0;
  let outside = 0;
  for (const c of cases) {
    const members: number[] = [];
    for (let m = 0; m < s.members; m++) members.push(c.mean + s.bias + k * c.sd * draw(c.d, m));
    probs.push(ensembleProbBelow(members, s.threshold));
    outcomes.push(c.outcome < s.threshold);
    ranked.push({ members, outcome: c.outcome });
    crps += crpsNormal(c.mean + s.bias, k * c.sd, c.outcome);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of members) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (c.outcome < lo || c.outcome > hi) outside++;
  }
  const stats: CalibrationStats = {
    cases: cases.length,
    baseRate: outcomes.filter(Boolean).length / outcomes.length,
    reliability: reliability(probs, outcomes, 10),
    rank: rankHistogram(ranked),
    brier: brierScore(probs, outcomes),
    brierSkill: brierSkill(probs, outcomes),
    crps: crps / cases.length,
    outside: outside / cases.length,
    outsideCalibrated: 2 / (s.members + 1),
    effectiveSpread: k,
  };
  if (statCache.size > 300) statCache.clear();
  statCache.set(key, stats);
  return stats;
}

/** Mean CRPS of the raw ensemble's normal distribution over all winter cases at a lead, for each inflation in `grid`. */
export function crpsCurve(lead: number, bias: number, grid: number[]): number[] {
  const cases = winterCases(lead);
  return grid.map((g) => {
    const k = RAW_SPREAD * g;
    let s = 0;
    for (const c of cases) s += crpsNormal(c.mean + bias, k * c.sd, c.outcome);
    return s / cases.length;
  });
}
