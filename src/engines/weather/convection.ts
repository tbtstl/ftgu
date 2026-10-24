// Afternoon convection: a morning sounding warmed from below into a well-mixed layer, the ascent
// of a surface parcel through it, and the flight of a released parcel driven by its buoyancy.
// Builds on thermo.ts; temperatures in °C, heights in km unless named.

import {
  DRY_LAPSE,
  G,
  K0,
  RD,
  envTemp,
  mixingRatio,
  moistLapseRate,
  satMixingRatio,
  satVaporPressure,
  type Ascent,
  type Sounding,
} from './thermo';

/**
 * The morning sounding after the ground has heated the air above it to `afternoonC`. Thermals mix
 * the lowest layer until it follows the dry adiabat from the surface; above the top of that mixed
 * layer the morning profile is unchanged. (A simple “encroachment” picture of the growing layer.)
 */
export function heatedProfile(morning: Sounding, afternoonC: number): (zKm: number) => number {
  return (z: number) => Math.max(envTemp(morning, z), afternoonC - DRY_LAPSE * z);
}

/** Height where the afternoon's dry adiabat meets the morning profile: the top of the mixed layer, km. */
export function mixedLayerTopKm(morning: Sounding, afternoonC: number, topKm = 15): number {
  if (afternoonC <= morning.surfaceC) return 0;
  for (let z = 0; z <= topKm; z += 0.005) {
    if (afternoonC - DRY_LAPSE * z <= envTemp(morning, z)) return z;
  }
  return topKm;
}

/**
 * Lift a surface parcel through any temperature profile: along the dry adiabat (9.8 K per km)
 * until it saturates, then along the moist adiabat with the condensed water falling out.
 * CAPE is the area of the highest layer of positive buoyancy, whose bottom is the level of free
 * convection and whose top the equilibrium level; CIN is the negative area beneath it.
 * Virtual-temperature effects are ignored.
 */
export function ascendThrough(
  env: (zKm: number) => number,
  startC: number,
  dewC: number,
  opts: { surfaceHpa?: number; topKm?: number; dzM?: number } = {},
): Ascent {
  const top = opts.topKm ?? 15;
  const dz = opts.dzM ?? 50;
  const p0 = opts.surfaceHpa ?? 1000;
  const w0 = mixingRatio(satVaporPressure(Math.min(dewC, startC)), p0);
  const z: number[] = [];
  const envs: number[] = [];
  const parcel: number[] = [];
  const pr: number[] = [];
  const buoy: number[] = [];
  let p = p0;
  let tp = startC;
  let saturated = satMixingRatio(tp, p) <= w0;
  let lclKm = saturated ? 0 : NaN;
  const steps = Math.round((top * 1000) / dz);
  for (let i = 0; i <= steps; i++) {
    const zk = (i * dz) / 1000;
    const te = env(zk);
    z.push(zk);
    envs.push(te);
    parcel.push(tp);
    pr.push(p);
    // Differences under a hundredth of a degree are rounding, not buoyancy.
    const diff = Math.abs(tp - te) < 0.01 ? 0 : tp - te;
    buoy.push((G * diff) / (te + K0));
    const teMid = env(zk + dz / 2000);
    const pNext = p * Math.exp((-G * dz) / (RD * (teMid + K0)));
    if (!saturated) {
      const tNext = tp - (DRY_LAPSE * dz) / 1000;
      if (satMixingRatio(tNext, pNext) <= w0) {
        // Saturates partway through the step: find where, so results vary smoothly.
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 30; k++) {
          const f = (lo + hi) / 2;
          const t = tp - (DRY_LAPSE * dz * f) / 1000;
          const pf = p * Math.pow(pNext / p, f);
          if (satMixingRatio(t, pf) <= w0) hi = f;
          else lo = f;
        }
        const f = hi;
        saturated = true;
        lclKm = zk + (f * dz) / 1000;
        const tl = tp - (DRY_LAPSE * dz * f) / 1000;
        const pl = p * Math.pow(pNext / p, f);
        tp = tl - (moistLapseRate(tl, pl) * dz * (1 - f)) / 1000;
      } else {
        tp = tNext;
      }
    } else {
      tp -= (moistLapseRate(tp, p) * dz) / 1000;
    }
    p = pNext;
  }
  if (Number.isNaN(lclKm)) lclKm = top;
  // The deep convective layer is the highest run of positive buoyancy (ignoring slivers under
  // 1 J/kg): a shallow buoyant layer trapped under an inversion doesn't make a storm.
  let best = { from: -1, to: -1, area: 0 };
  for (let i = 1; i < z.length; i++) {
    if (buoy[i] <= 0) continue;
    let j = i;
    let area = 0;
    while (j < z.length && buoy[j] > 0) area += buoy[j++] * dz;
    if (area >= 1) best = { from: i, to: j, area };
    i = j;
  }
  let cin = 0;
  if (best.from >= 0) for (let i = 0; i < best.from; i++) if (buoy[i] < 0) cin -= buoy[i] * dz;
  return {
    z,
    env: envs,
    parcel,
    p: pr,
    buoyancy: buoy,
    lclKm,
    lfcKm: best.from >= 0 ? z[best.from] : null,
    elKm: best.from >= 0 ? (best.to < z.length ? z[best.to] : top) : null,
    cape: best.area,
    cin,
  };
}

/** Buoyancy at any height, interpolated from an ascent, m/s². */
export function buoyancyAt(a: Ascent, zKm: number): number {
  const dz = a.z[1] - a.z[0];
  if (zKm <= 0) return a.buoyancy[0];
  const i = zKm / dz;
  if (i >= a.z.length - 1) return a.buoyancy[a.z.length - 1];
  const lo = Math.floor(i);
  return a.buoyancy[lo] + (a.buoyancy[lo + 1] - a.buoyancy[lo]) * (i - lo);
}

export interface ParcelState {
  /** Seconds since release. */
  t: number;
  /** Height, m. */
  z: number;
  /** Vertical speed, m/s. */
  w: number;
}

/**
 * One step of a released parcel: dw/dt = b(z) − k·w·|w|, where the quadratic drag k stands in for
 * the mixing that slows a real updraft. A parcel that sinks back to the ground stops there.
 */
export function stepParcel(a: Ascent, s: ParcelState, dtS: number, drag = 2e-5): ParcelState {
  // Semi-implicit Euler in small sub-steps, so the animation's frame rate doesn't matter.
  const n = Math.max(1, Math.ceil(dtS / 0.5));
  const h = dtS / n;
  let { z, w } = s;
  for (let i = 0; i < n; i++) {
    const b = buoyancyAt(a, z / 1000);
    w += (b - drag * w * Math.abs(w)) * h;
    z += w * h;
    if (z <= 0) {
      z = 0;
      w = 0;
    }
  }
  return { t: s.t + dtS, z, w };
}

/** The highest a released parcel climbs in `durationS` seconds, m. */
export function thermalTop(a: Ascent, opts: { w0?: number; drag?: number; durationS?: number } = {}): number {
  let top = 0;
  for (const s of flight(a, { ...opts, dtS: 5 })) top = Math.max(top, s.z);
  return top;
}

/** A released parcel's whole flight, sampled every `dtS` seconds. */
export function flight(a: Ascent, opts: { w0?: number; drag?: number; dtS?: number; durationS?: number } = {}): ParcelState[] {
  const dt = opts.dtS ?? 5;
  const dur = opts.durationS ?? 1800;
  let s: ParcelState = { t: 0, z: 0, w: opts.w0 ?? 2 };
  const out = [s];
  while (s.t < dur - 1e-9) {
    s = stepParcel(a, s, dt, opts.drag);
    out.push(s);
  }
  return out;
}
