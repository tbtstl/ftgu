// A generation trip run through the shared frequency model (frequency.ts), with two refinements a
// sandbox needs once its sliders can reach extreme settings (Lesson 3.2):
//
//   • Governor headroom limits how much plants can add, not how much they can cut. If load
//     shedding or fast response overshoots, governors are free to pull back (down to half of the
//     governed capacity).
//   • Fast frequency response is sized to the event: batteries deliver up to the loss that load
//     shedding hasn't already covered, and back off as the frequency returns to 60 Hz.
//
// With the frequency staying below nominal and no load shed, the result is identical to simulateTrip.

import { initialFrequency, initialRocof, stepFrequency, type FrequencyParams, type FrequencyState } from './frequency';

export interface TripSample {
  t: number;
  f: number;
  governor: number;
  fast: number;
  shed: number;
}

export interface TripResult {
  samples: TripSample[];
  nadir: number;
  nadirT: number;
  /** Frequency at the end of the run, Hz. */
  settled: number;
  shedMW: number;
  rocof: number;
}

const H = 0.01; // the frequency model's own integration step, s

/** Simulate losing `lostMW` at t = 0 for `seconds`, sampling every `every` seconds. */
export function simulateEvent(p: FrequencyParams, lostMW: number, seconds = 30, every = 0.05): TripResult {
  let s: FrequencyState = { ...initialFrequency(), lostMW };
  const samples: TripSample[] = [{ t: 0, f: p.f0, governor: 0, fast: 0, shed: 0 }];
  let nadir = p.f0;
  let nadirT = 0;
  const perSample = Math.max(1, Math.round(every / H));
  const steps = Math.round(seconds / H);
  for (let k = 1; k <= steps; k++) {
    // Once armed, the batteries cover what shedding hasn't, tapering off within 0.05 Hz of nominal.
    const taper = Math.max(0, Math.min(1, -s.df / 0.05));
    const fastCap = Math.min(p.fastMW, Math.max(0, lostMW - s.shedMW)) * taper;
    const q: FrequencyParams = {
      ...p,
      headroomMW: s.df < 0 ? p.headroomMW : 0.5 * p.governorMW,
      fastMW: s.fastArmedAt === null ? p.fastMW : fastCap,
    };
    s = stepFrequency(s, q, H);
    const fNow = p.f0 + s.df;
    if (fNow < nadir) {
      nadir = fNow;
      nadirT = s.t;
    }
    if (k % perSample === 0) samples.push({ t: s.t, f: fNow, governor: s.governor, fast: s.fast, shed: s.shedMW });
  }
  return { samples, nadir, nadirT, settled: p.f0 + s.df, shedMW: s.shedMW, rocof: initialRocof(p, lostMW) };
}
