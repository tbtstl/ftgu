// Fronts: the boundary between a cold air mass and a warm one, and the weather a station sees as
// it passes. The warm air is forced up over the denser cold air; where it reaches its condensation
// level it makes cloud, and the rain rate is the vapor carried up, ρ·w·Δq, where w is the rate
// the frontal surface lifts the warm air and Δq the vapor it gives up by the top of the lift.

import { G, K0, RD, lcl, moistLapseRate, mixingRatio, satMixingRatio, satVaporPressure, standardPressure } from './thermo';

export type FrontKind = 'cold' | 'warm';

export interface FrontInput {
  kind: FrontKind;
  /** Temperature of the cold air mass at the ground, °C. */
  coldC: number;
  /** Temperature of the warm air mass at the ground, °C. */
  warmC: number;
  /** Dew point of the warm air, °C. */
  warmDewC: number;
  /** How fast the front moves across the ground, m/s. */
  speed: number;
}

/**
 * The shape of each kind of front. A cold front's nose is steep, so it lifts the warm air
 * quickly in a narrow band; a warm front's surface is gentle, so the warm air glides up it slowly
 * over hundreds of kilometers.
 */
export const FRONT_SHAPE: Record<FrontKind, { slope: number; bandKm: number; liftKm: number; transitionKm: number; domeKm: number }> = {
  cold: { slope: 1 / 50, bandKm: 60, liftKm: 4, transitionKm: 25, domeKm: 1.5 },
  warm: { slope: 1 / 150, bandKm: 300, liftKm: 3, transitionKm: 120, domeKm: 1.5 },
};

export interface FrontWeather {
  slope: number;
  /** Upward speed of the warm air riding the frontal surface, m/s. */
  liftMs: number;
  /** Base of the cloud the lifted warm air forms, m. */
  cloudBaseM: number;
  /** Top of the lifted layer, m. */
  cloudTopM: number;
  /** Vapor the warm air gives up by the top of the lift, g/kg. */
  condensedGkg: number;
  rainRateMmH: number;
  /** Width of the rain band, km; for a warm front it lies ahead of the surface front, for a cold front at and just behind it. */
  bandKm: number;
  /** How long the band takes to pass a station, hours. */
  rainHours: number;
  /** Rain a station receives from one passage, mm. */
  rainMm: number;
  /** How much higher the surface pressure is under the cold air than under the warm, hPa. */
  domeHpa: number;
}

/** Vapor (kg/kg) that warm surface air gives up when lifted to its cloud base and `aboveBaseKm` beyond it. */
export function condensedOnLift(tC: number, dewC: number, aboveBaseKm: number): { baseM: number; condensed: number } {
  const base = lcl(tC, Math.min(dewC, tC), 1000);
  const w0 = mixingRatio(satVaporPressure(Math.min(dewC, tC)), 1000);
  let t = base.tempC;
  let z = base.heightM;
  const dz = 50;
  const steps = Math.round((aboveBaseKm * 1000) / dz);
  for (let i = 0; i < steps; i++) {
    const p = (1000 * standardPressure(z)) / standardPressure(0);
    t -= (moistLapseRate(t, p) * dz) / 1000;
    z += dz;
  }
  const pTop = (1000 * standardPressure(z)) / standardPressure(0);
  return { baseM: base.heightM, condensed: Math.max(0, w0 - satMixingRatio(t, pTop)) };
}

/** Hydrostatic excess pressure under a cold dome `depthKm` deep: p·(g·h/R)·(1/Tc − 1/Tw), hPa. */
export function domePressure(coldC: number, warmC: number, depthKm: number, pHpa = 1000): number {
  return pHpa * ((G * depthKm * 1000) / RD) * (1 / (coldC + K0) - 1 / (warmC + K0));
}

export function frontWeather(f: FrontInput): FrontWeather {
  const shape = FRONT_SHAPE[f.kind];
  const liftMs = f.speed * shape.slope;
  const c = condensedOnLift(f.warmC, f.warmDewC, shape.liftKm);
  const rho = 1.1;
  const rainRateMmH = rho * liftMs * c.condensed * 3600;
  const rainHours = f.speed > 0 ? (shape.bandKm * 1000) / f.speed / 3600 : Infinity;
  return {
    slope: shape.slope,
    liftMs,
    cloudBaseM: c.baseM,
    cloudTopM: c.baseM + shape.liftKm * 1000,
    condensedGkg: c.condensed * 1000,
    rainRateMmH,
    bandKm: shape.bandKm,
    rainHours,
    rainMm: rainRateMmH * rainHours,
    domeHpa: Math.max(0, domePressure(f.coldC, f.warmC, shape.domeKm)),
  };
}

export interface StationHour {
  /** Hours since the start of the record. */
  t: number;
  tempC: number;
  dewC: number;
  pressureHpa: number;
  /** Direction the wind blows from, degrees (180 = from the south). */
  windFrom: number;
  windMs: number;
  /** Rain in this hour, mm. */
  rainMm: number;
  /** Which air mass is over the station: 0 = the one ahead of the front, 1 = the one behind. */
  behind: number;
}

/**
 * A station's record as the front passes, hour by hour. The surface front reaches the station
 * at `arrivalH`. A cold front replaces warm air with cold; a warm front, cold with warm.
 */
export function frontPassage(f: FrontInput, hours = 48, arrivalH = 24): StationHour[] {
  const shape = FRONT_SHAPE[f.kind];
  const wx = frontWeather(f);
  const coldDew = Math.min(f.coldC - 6, f.warmDewC);
  const ahead = f.kind === 'cold' ? { t: f.warmC, d: f.warmDewC, wind: 215 } : { t: f.coldC, d: coldDew, wind: 110 };
  const after = f.kind === 'cold' ? { t: f.coldC, d: coldDew, wind: 310 } : { t: f.warmC, d: f.warmDewC, wind: 215 };
  const out: StationHour[] = [];
  const km = (h: number) => (f.speed * 3600 * (h - arrivalH)) / 1000; // km the front has moved past the station
  for (let h = 0; h <= hours; h++) {
    const x = km(h);
    const s = 1 / (1 + Math.exp(-x / (shape.transitionKm / 4)));
    // A trough of low pressure travels with the front; the cold dome raises pressure under it.
    const trough = -4 * Math.exp(-(x * x) / (2 * 150 * 150));
    const coldSide = f.kind === 'cold' ? s : 1 - s;
    const pressureHpa = 1012 + trough + wx.domeHpa * coldSide - wx.domeHpa / 2;
    // Rain in the hour: the overlap of [x − v, x] with the band.
    const [b0, b1] = f.kind === 'cold' ? [-shape.bandKm / 3, (2 * shape.bandKm) / 3] : [-shape.bandKm, 0];
    const xa = km(h - 1);
    const overlap = Math.max(0, Math.min(x, b1) - Math.max(xa, b0));
    const frac = x > xa ? overlap / (x - xa) : 0;
    out.push({
      t: h,
      tempC: ahead.t + (after.t - ahead.t) * s,
      dewC: ahead.d + (after.d - ahead.d) * s,
      pressureHpa,
      windFrom: ahead.wind + (after.wind - ahead.wind) * s,
      windMs: 6 + 4 * Math.exp(-(x * x) / (2 * 60 * 60)),
      rainMm: h === 0 ? 0 : wx.rainRateMmH * frac,
      behind: s,
    });
  }
  return out;
}
