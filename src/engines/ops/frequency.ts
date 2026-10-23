// System frequency after a disturbance: the aggregate swing equation with governor droop,
// load damping, fast frequency response and under-frequency load shedding.
//
//   (2H·S / f0) · dΔf/dt = P_governors + P_fast − P_lost − D·Load·(Δf / f0) + P_shed

export interface FrequencyParams {
  /** Nominal frequency, Hz. */
  f0: number;
  /** Online synchronous capacity, MW (MVA). */
  onlineMW: number;
  /** Average inertia constant of online machines, s. */
  inertiaH: number;
  /** System demand, MW. */
  loadMW: number;
  /** Load damping: % change in load per % change in frequency (≈1–2). */
  damping: number;
  /** Governor droop as a fraction (0.05 = full response at a 5% frequency drop). */
  droop: number;
  /** Capacity that governors respond with, MW (online, with headroom). */
  governorMW: number;
  /** Most extra output governors can add (headroom), MW. */
  headroomMW: number;
  /** Governor/turbine time constant, s. */
  governorT: number;
  /** Fast frequency response (batteries), MW, delivered after `fastDelay` once frequency falls below the trigger. */
  fastMW: number;
  fastDelay: number;
  fastTrigger: number;
  /** Under-frequency load shedding stages: shed `share` of load when frequency falls below `hz`. */
  ufls: Array<{ hz: number; share: number }>;
}

/**
 * Frequency is shared by the whole synchronous interconnection, not just the course region,
 * so these defaults describe an interconnection of about 18 GW that the region belongs to.
 */
export const DEFAULT_FREQUENCY: FrequencyParams = {
  f0: 60,
  onlineMW: 20000,
  inertiaH: 5,
  loadMW: 18000,
  damping: 1.5,
  droop: 0.05,
  governorMW: 15000,
  headroomMW: 2500,
  governorT: 3,
  fastMW: 0,
  fastDelay: 0.3,
  fastTrigger: 59.8,
  ufls: [
    { hz: 59.3, share: 0.05 },
    { hz: 59.0, share: 0.05 },
    { hz: 58.7, share: 0.05 },
  ],
};

export interface FrequencyState {
  t: number;
  /** Frequency deviation, Hz. */
  df: number;
  governor: number;
  fast: number;
  /** Time frequency first fell below the fast-response trigger (or null). */
  fastArmedAt: number | null;
  shedMW: number;
  stagesTripped: number;
  /** Generation lost so far, MW. */
  lostMW: number;
}

export function initialFrequency(): FrequencyState {
  return { t: 0, df: 0, governor: 0, fast: 0, fastArmedAt: null, shedMW: 0, stagesTripped: 0, lostMW: 0 };
}

/** Advance the system by dt seconds. Integrates in 10 ms sub-steps for stability. */
export function stepFrequency(s: FrequencyState, p: FrequencyParams, dt: number): FrequencyState {
  let x = { ...s };
  const sub = Math.max(1, Math.ceil(dt / 0.01));
  const h = dt / sub;
  // After a trip, the lost unit's inertia is gone too, but we keep H·S fixed for clarity.
  const M = (2 * p.inertiaH * Math.max(1, p.onlineMW)) / p.f0; // MW·s per Hz
  for (let i = 0; i < sub; i++) {
    const f = p.f0 + x.df;
    // Governor target: proportional to the frequency drop, limited by headroom.
    const target = Math.max(-p.headroomMW, Math.min(p.headroomMW, (-x.df / p.f0 / p.droop) * p.governorMW));
    const governor = x.governor + ((target - x.governor) * h) / p.governorT;
    // Fast frequency response: arms on the trigger, delivers fully after the delay.
    let fastArmedAt = x.fastArmedAt;
    if (fastArmedAt === null && p.fastMW > 0 && f < p.fastTrigger) fastArmedAt = x.t;
    const fast = fastArmedAt !== null && x.t - fastArmedAt >= p.fastDelay ? Math.min(p.fastMW, x.fast + (p.fastMW * h) / 0.2) : x.fast;
    // Under-frequency load shedding.
    let shedMW = x.shedMW;
    let stages = x.stagesTripped;
    while (stages < p.ufls.length && f < p.ufls[stages].hz) {
      shedMW += p.ufls[stages].share * p.loadMW;
      stages++;
    }
    const dampingMW = p.damping * (p.loadMW - shedMW) * (x.df / p.f0);
    const imbalance = governor + fast - x.lostMW + shedMW - dampingMW;
    x = { ...x, t: x.t + h, df: x.df + (imbalance / M) * h, governor, fast, fastArmedAt, shedMW, stagesTripped: stages };
  }
  return x;
}

/** Rate of change of frequency right after losing `lostMW`, Hz/s (negative = falling). */
export function initialRocof(p: FrequencyParams, lostMW: number): number {
  return -(lostMW * p.f0) / (2 * p.inertiaH * p.onlineMW);
}

/** Simulate a generation loss of `lostMW` at t = 0 for `seconds`; returns samples every `every` s. */
export function simulateTrip(p: FrequencyParams, lostMW: number, seconds = 30, every = 0.1) {
  let s: FrequencyState = { ...initialFrequency(), lostMW };
  const samples: Array<{ t: number; f: number; governor: number; fast: number; shed: number }> = [{ t: 0, f: p.f0, governor: 0, fast: 0, shed: 0 }];
  let nadir = p.f0;
  let nadirT = 0;
  while (s.t < seconds - 1e-9) {
    s = stepFrequency(s, p, every);
    const f = p.f0 + s.df;
    if (f < nadir) {
      nadir = f;
      nadirT = s.t;
    }
    samples.push({ t: s.t, f, governor: s.governor, fast: s.fast, shed: s.shedMW });
  }
  return { samples, nadir, nadirT, settled: p.f0 + s.df, shedMW: s.shedMW, rocof: initialRocof(p, lostMW) };
}
