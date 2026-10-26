// Probabilistic forecasts and how to judge them: ensembles drawn from a forecast distribution,
// event probabilities, and the scores and diagrams forecasters use to check calibration —
// the Brier score, the reliability diagram, the rank histogram and the CRPS.

import { normCdf } from '../../model/weather/archive';

/** A fixed bank of standard-normal draws, so ensembles don't flicker as sliders move. */
const BANK_SIZE = 4096;
let bank: Float64Array | null = null;
export function normalBank(): Float64Array {
  if (bank) return bank;
  let a = 424242;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  bank = new Float64Array(BANK_SIZE);
  for (let i = 0; i < BANK_SIZE; i += 2) {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    bank[i] = r * Math.cos(2 * Math.PI * v);
    bank[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return bank;
}

/** A standard-normal draw from the bank for (case, member). */
export function draw(caseIndex: number, member: number): number {
  const b = normalBank();
  return b[(caseIndex * 131 + member * 17) % BANK_SIZE];
}

/** Ensemble members: mean + bias + spread × sd × draw. */
export function ensemble(mean: number, sd: number, n: number, caseIndex: number, opts: { spread?: number; bias?: number } = {}): number[] {
  const k = opts.spread ?? 1;
  const b = opts.bias ?? 0;
  return Array.from({ length: n }, (_, m) => mean + b + k * sd * draw(caseIndex, m));
}

/** Probability the value falls below a threshold, from an ensemble's members (share of members below). */
export function ensembleProbBelow(members: number[], threshold: number): number {
  return members.filter((m) => m < threshold).length / Math.max(1, members.length);
}

/** Probability below a threshold for a normal forecast. */
export function normalProbBelow(mean: number, sd: number, threshold: number): number {
  if (sd <= 0) return mean < threshold ? 1 : 0;
  return normCdf((threshold - mean) / sd);
}

/** Brier score: the mean squared difference between forecast probabilities and what happened (1 or 0). */
export function brierScore(probs: number[], outcomes: boolean[]): number {
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i] - (outcomes[i] ? 1 : 0)) ** 2;
  return s / Math.max(1, probs.length);
}

/** Brier skill score against always forecasting the base rate: 1 is perfect, 0 no better, negative worse. */
export function brierSkill(probs: number[], outcomes: boolean[]): number {
  const base = outcomes.filter(Boolean).length / Math.max(1, outcomes.length);
  const ref = brierScore(probs.map(() => base), outcomes);
  return ref > 0 ? 1 - brierScore(probs, outcomes) / ref : 0;
}

export interface ReliabilityBin {
  /** Bin range of forecast probability. */
  lo: number;
  hi: number;
  /** Average forecast probability in the bin. */
  forecast: number;
  /** How often the event happened when forecasts fell in the bin. */
  observed: number;
  count: number;
}

/** Reliability diagram: forecasts grouped by probability, against how often the event happened. */
export function reliability(probs: number[], outcomes: boolean[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, forecast: 0, observed: 0, count: 0 }));
  probs.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    out[b].forecast += p;
    out[b].observed += outcomes[i] ? 1 : 0;
    out[b].count++;
  });
  for (const b of out) {
    if (b.count) {
      b.forecast /= b.count;
      b.observed /= b.count;
    }
  }
  return out;
}

/** Rank histogram: where the outcome falls among the sorted members (0 … n). Flat when calibrated. */
export function rankHistogram(cases: Array<{ members: number[]; outcome: number }>): number[] {
  const n = cases[0]?.members.length ?? 0;
  const counts = new Array(n + 1).fill(0);
  for (const c of cases) {
    const rank = c.members.filter((m) => m < c.outcome).length;
    counts[rank]++;
  }
  return counts;
}

/** Continuous ranked probability score of a normal forecast against an outcome (lower is better; same units as the variable). */
export function crpsNormal(mean: number, sd: number, outcome: number): number {
  if (sd <= 1e-9) return Math.abs(outcome - mean);
  const z = (outcome - mean) / sd;
  const pdf = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
  return sd * (z * (2 * normCdf(z) - 1) + 2 * pdf - 1 / Math.sqrt(Math.PI));
}

/** Probability integral transform: where the outcome falls in the forecast distribution (0–1). Uniform when calibrated. */
export function pit(mean: number, sd: number, outcome: number): number {
  return sd > 0 ? normCdf((outcome - mean) / sd) : outcome >= mean ? 1 : 0;
}
