// Balancing supply and demand (Lesson 3.1). Two models of the course region run as an electrical
// island — no neighbors to lean on — so that every mismatch shows up in its frequency.
//
// 1. A compressed-time balancing game. Demand follows the reference day's shape plus seeded
//    noise; the player moves setpoints of a few units, which ramp at their rated limits. At
//    minutes-per-second speeds the seconds-scale physics (inertia, governors) settles within a
//    frame, so frequency is its quasi-steady value: mismatch ÷ the island's frequency response β.
//
// 2. The island's response to a sudden load step across time scales — kinetic energy from the
//    spinning machines, load relief, governors, AGC and, a few minutes later, dispatch — integrated
//    in sub-second steps.

import { STANDARD_FLEET } from '../../model/fleet';
import { SYSTEM_DEMAND } from '../../model/profiles';
import { ar1, rng } from '../../model/random';

const plant = (id: string) => STANDARD_FLEET.find((g) => g.id === id)!;

/** A unit the player (or AGC) moves. */
export interface GameUnit {
  id: string;
  name: string;
  capacity: number;
  /** MW per hour. */
  rampPerHour: number;
}

export interface GameConfig {
  f0: number;
  /** Simulated minutes per real second. */
  minutesPerSecond: number;
  /** Tolerance band, ± Hz. */
  band: number;
  /** Units held at a fixed output, MW. */
  fixed: Array<{ id: string; name: string; mw: number }>;
  /** Units whose setpoints the player moves. */
  controlled: GameUnit[];
  /** The unit AGC moves when it's switched on, and where it sits otherwise. */
  agcUnit: GameUnit;
  agcBase: number;
  /** AGC integral time constant, simulated minutes. */
  agcMinutes: number;
  /** Governor-equipped capacity, MW, its droop, and the load's damping (% per %). */
  governorMW: number;
  droop: number;
  damping: number;
  /** Demand noise: standard deviation (MW) and correlation time (minutes). */
  noiseMW: number;
  noiseMinutes: number;
}

export const GAME: GameConfig = {
  f0: 60,
  minutesPerSecond: 10,
  band: 0.1,
  fixed: [
    { id: 'nuc', name: plant('nuc').name, mw: 400 },
    { id: 'coal', name: plant('coal').name, mw: 250 },
  ],
  controlled: ['cc1', 'cc2', 'ct'].map((id) => ({ id, name: plant(id).name, capacity: plant(id).capacity, rampPerHour: plant(id).rampRate })),
  agcUnit: { id: 'hydro', name: plant('hydro').name, capacity: plant('hydro').capacity, rampPerHour: plant('hydro').rampRate },
  agcBase: 75,
  agcMinutes: 2,
  // Ironwood coal, Lakeside, Mill Creek and Falls hydro carry governors.
  governorMW: plant('coal').capacity + plant('cc1').capacity + plant('cc2').capacity + plant('hydro').capacity,
  droop: 0.05,
  damping: 1.5,
  noiseMW: 14,
  noiseMinutes: 40,
};

/** The island's frequency response β at a given load, MW per Hz: governors plus load damping. */
export function islandBeta(cfg: GameConfig, loadMW: number): number {
  return cfg.governorMW / (cfg.droop * cfg.f0) + (cfg.damping * loadMW) / cfg.f0;
}

/** Smooth forecast demand (MW) at minute t of the reference day: a periodic Catmull–Rom curve through the hourly values, placed at each hour's midpoint. */
export function forecastAt(tMin: number): number {
  const n = SYSTEM_DEMAND.length;
  const x = tMin / 60 - 0.5;
  const i = Math.floor(x);
  const u = x - i;
  const p = (k: number) => SYSTEM_DEMAND[((k % n) + n) % n];
  const p0 = p(i - 1);
  const p1 = p(i);
  const p2 = p(i + 1);
  const p3 = p(i + 2);
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

/** Actual demand for each minute of the day (1,441 values, minute 0 … 1,440). Same seed, same day. */
export function gameDemand(seed: number, cfg: GameConfig = GAME): number[] {
  const r = rng(seed);
  const noise = ar1(r, 1441, Math.exp(-1 / cfg.noiseMinutes), cfg.noiseMW);
  return noise.map((e, t) => forecastAt(t) + e);
}

export interface GameSample {
  t: number;
  demand: number;
  /** Output of the fixed units, then each controlled unit, then the AGC unit. */
  out: number[];
  f: number;
}

export interface GameState {
  /** Simulated minutes since midnight. */
  t: number;
  /** Actual output of each controlled unit, MW. */
  out: Record<string, number>;
  /** Output of the AGC unit, MW. */
  agcOut: number;
  demand: number;
  /** Frequency deviation, Hz. */
  df: number;
  inBand: number;
  elapsed: number;
  /** Simulated minutes during which AGC was switched on. */
  agcTime: number;
  hist: GameSample[];
  done: boolean;
}

const SAMPLE_EVERY = 2; // minutes
const SUB = 0.5; // minutes per integration step

function freq(cfg: GameConfig, gen: number, load: number) {
  const df = (gen - load) / islandBeta(cfg, load);
  return Math.max(-2, Math.min(2, df));
}

function totalGen(cfg: GameConfig, out: Record<string, number>, agcOut: number) {
  return cfg.fixed.reduce((s, u) => s + u.mw, 0) + cfg.controlled.reduce((s, u) => s + (out[u.id] ?? 0), 0) + agcOut;
}

function sample(cfg: GameConfig, s: Pick<GameState, 't' | 'out' | 'agcOut' | 'demand' | 'df'>): GameSample {
  return { t: s.t, demand: s.demand, out: [...cfg.fixed.map((u) => u.mw), ...cfg.controlled.map((u) => s.out[u.id] ?? 0), s.agcOut], f: cfg.f0 + s.df };
}

/** A fresh day at midnight, with units already matching demand (cheapest first). */
export function initialGame(demand: number[], cfg: GameConfig = GAME): GameState {
  const need = demand[0] - cfg.fixed.reduce((s, u) => s + u.mw, 0) - cfg.agcBase;
  const out: Record<string, number> = {};
  let left = Math.max(0, need);
  for (const u of cfg.controlled) {
    out[u.id] = Math.min(u.capacity, left);
    left -= out[u.id];
  }
  const gen = totalGen(cfg, out, cfg.agcBase);
  const s = { t: 0, out, agcOut: cfg.agcBase, demand: demand[0], df: freq(cfg, gen, demand[0]) };
  return { ...s, inBand: 0, elapsed: 0, agcTime: 0, hist: [sample(cfg, s)], done: false };
}

/** Setpoints that would start the day balanced, for the player's sliders. */
export function initialSetpoints(demand: number[], cfg: GameConfig = GAME): Record<string, number> {
  return { ...initialGame(demand, cfg).out };
}

function demandAt(demand: number[], t: number) {
  const i = Math.min(demand.length - 2, Math.max(0, Math.floor(t)));
  const u = Math.min(1, Math.max(0, t - i));
  return demand[i] + (demand[i + 1] - demand[i]) * u;
}

/**
 * Advance the game by `dtMin` simulated minutes. Units ramp toward `setpoints` at their limits; with
 * `agc` on, the AGC unit integrates the area control error (here simply the mismatch, since the
 * region is an island) back toward zero.
 */
export function stepGame(s: GameState, setpoints: Record<string, number>, agc: boolean, dtMin: number, demand: number[], cfg: GameConfig = GAME): GameState {
  if (s.done || !(dtMin > 0)) return s;
  const end = Math.min(1440, s.t + dtMin);
  let t = s.t;
  const out = { ...s.out };
  let agcOut = s.agcOut;
  let { inBand, elapsed, df, agcTime } = s;
  let d = s.demand;
  let hist = s.hist;
  let nextSample = (Math.floor(s.t / SAMPLE_EVERY) + 1) * SAMPLE_EVERY;
  while (t < end - 1e-9) {
    const h = Math.min(SUB, end - t);
    for (const u of cfg.controlled) {
      const target = Math.max(0, Math.min(u.capacity, setpoints[u.id] ?? out[u.id]));
      const max = (u.rampPerHour / 60) * h;
      out[u.id] += Math.max(-max, Math.min(max, target - out[u.id]));
    }
    t += h;
    d = demandAt(demand, t);
    const gen = totalGen(cfg, out, agcOut);
    if (agc) {
      agcTime += h;
      const ace = gen - d;
      const max = (cfg.agcUnit.rampPerHour / 60) * h;
      const want = Math.max(-max, Math.min(max, (-ace * h) / cfg.agcMinutes));
      agcOut = Math.max(0, Math.min(cfg.agcUnit.capacity, agcOut + want));
    }
    df = freq(cfg, totalGen(cfg, out, agcOut), d);
    elapsed += h;
    if (Math.abs(df) <= cfg.band) inBand += h;
    if (t >= nextSample - 1e-9) {
      hist = [...hist, sample(cfg, { t, out, agcOut, demand: d, df })];
      nextSample += SAMPLE_EVERY;
    }
  }
  return { t, out, agcOut, demand: d, df, inBand, elapsed, agcTime, hist, done: t >= 1440 - 1e-9 };
}

/** Share of the elapsed day spent inside the tolerance band (0 before the day starts). */
export function inBandShare(s: GameState): number {
  return s.elapsed > 0 ? s.inBand / s.elapsed : 0;
}

// ---------------------------------------------------------------------------
// The island's response to a sudden load step, across time scales.

export interface IslandParams {
  f0: number;
  /** Online synchronous capacity, MW, and its average inertia constant, s. */
  onlineMW: number;
  inertiaH: number;
  loadMW: number;
  damping: number;
  governorMW: number;
  droop: number;
  headroomMW: number;
  governorT: number;
  /** Units on AGC: their combined ramp, MW per hour, and the AGC time constant, s. */
  agcRampPerHour: number;
  agcT: number;
  /** When the next dispatch run takes over, s, and the ramp of the unit it moves, MW per hour. */
  dispatchAt: number;
  dispatchRampPerHour: number;
}

/**
 * The island at midday: Harbor Point nuclear, Ironwood coal, Lakeside, Mill Creek and Falls hydro
 * online (Eastgate is off). Governors on everything but the nuclear plant; Lakeside, Mill Creek and
 * Falls hydro on AGC; the next dispatch run, five minutes later, gives the extra load to Lakeside.
 */
export const ISLAND: IslandParams = (() => {
  const online = ['nuc', 'coal', 'cc1', 'cc2', 'hydro'].map(plant);
  const S = online.reduce((s, g) => s + g.capacity, 0);
  const H = online.reduce((s, g) => s + g.inertiaH * g.capacity, 0) / S;
  return {
    f0: 60,
    onlineMW: S,
    inertiaH: H,
    loadMW: 1150,
    damping: GAME.damping,
    governorMW: GAME.governorMW,
    droop: GAME.droop,
    headroomMW: 250,
    governorT: 3,
    agcRampPerHour: plant('cc1').rampRate + plant('cc2').rampRate + plant('hydro').rampRate,
    agcT: 60,
    dispatchAt: 300,
    dispatchRampPerHour: plant('cc1').rampRate,
  };
})();

/** Kinetic energy stored in the island's spinning machines at 60 Hz, MW·s (= MJ). */
export function kineticEnergy(p: IslandParams): number {
  return p.inertiaH * p.onlineMW;
}

export interface StepSample {
  /** Seconds after the step. */
  t: number;
  f: number;
  /** Where the extra power comes from, MW; they add up to the step. */
  inertia: number;
  loadRelief: number;
  governors: number;
  agc: number;
  dispatch: number;
}

/**
 * Response of the island to `stepMW` of extra demand at t = 0, sampled at log-spaced times from
 * 0.05 s to `seconds`. Mechanisms can be switched off to see what each one does.
 */
export function stepResponse(
  p: IslandParams,
  stepMW: number,
  on: { governors?: boolean; agc?: boolean; dispatch?: boolean } = {},
  seconds = 3600,
  points = 220,
): StepSample[] {
  const gov = on.governors !== false;
  const agcOn = on.agc !== false;
  const dispOn = on.dispatch !== false;
  const M = (2 * p.inertiaH * p.onlineMW) / p.f0; // MW·s per Hz
  const D = (p.damping * p.loadMW) / p.f0; // MW per Hz
  const t0 = 0.05;
  const times = Array.from({ length: points }, (_, i) => t0 * Math.pow(seconds / t0, i / (points - 1)));
  const out: StepSample[] = [];
  let t = 0;
  let df = 0;
  let pg = 0;
  let pa = 0;
  let pd = 0;
  let k = 0;
  const agcRate = p.agcRampPerHour / 3600; // MW per s
  const dispRate = p.dispatchRampPerHour / 3600;
  while (k < times.length) {
    const h = t < 60 ? 0.005 : t < 600 ? 0.02 : 0.1;
    const target = gov ? Math.max(-p.headroomMW, Math.min(p.headroomMW, (-df / (p.droop * p.f0)) * p.governorMW)) : 0;
    const dpg = (target - pg) / p.governorT;
    // AGC drives the area control error to zero; in an island that error is β·Δf.
    const beta = (gov ? p.governorMW / (p.droop * p.f0) : 0) + D;
    const dpa = agcOn ? Math.max(-agcRate, Math.min(agcRate, (-beta * df) / p.agcT)) : 0;
    // The next dispatch run hands the extra load to the economic unit, at that unit's ramp rate.
    const dpd = dispOn && t >= p.dispatchAt ? Math.max(0, Math.min(dispRate, stepMW - pd)) : 0;
    const dfdt = (pg + pa + pd - stepMW - D * df) / M;
    // Sample before stepping when we pass a sample time.
    while (k < times.length && times[k] <= t + h) {
      const tau = times[k] - t;
      const f = df + dfdt * tau;
      out.push({ t: times[k], f: p.f0 + f, inertia: -M * dfdt, loadRelief: -D * f, governors: pg + dpg * tau, agc: pa, dispatch: pd });
      k++;
    }
    pg += dpg * h;
    pa += dpa * h;
    pd = Math.min(stepMW, pd + dpd * h);
    df += dfdt * h;
    t += h;
  }
  return out;
}

/** Summary of a step response: lowest frequency, when it happened, and when frequency was back within 0.01 Hz for good. */
export function summarizeStep(samples: StepSample[], f0 = 60) {
  let nadir = f0;
  let nadirT = 0;
  for (const s of samples) {
    if (s.f < nadir) {
      nadir = s.f;
      nadirT = s.t;
    }
  }
  let restored: number | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i].f - f0) > 0.01) {
      restored = i === samples.length - 1 ? null : samples[i + 1].t;
      break;
    }
    if (i === 0) restored = samples[0].t;
  }
  const at = (sec: number) => samples.reduce((b, s) => (Math.abs(s.t - sec) < Math.abs(b.t - sec) ? s : b), samples[0]);
  return { nadir, nadirT, restored, at30: at(30).f };
}
