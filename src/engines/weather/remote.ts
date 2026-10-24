// Remote sensing: turning a simulated atmosphere into what a radar or a satellite would report.
// Radar: the beam climbs above the curving Earth, so distant rain is sampled high up or missed;
// reflectivity Z grows with the sixth power of drop size, and rain rate is recovered from it with
// the Marshall–Palmer relation Z = 200·R^1.6. Satellite: an infrared imager measures the
// temperature of whatever it sees — a cloud top's or, through gaps and thin cloud, the ground's.

export const EARTH_RADIUS_KM = 6371;
/** Standard refraction bends the beam as if the Earth were 4/3 its real size. */
export const EFFECTIVE_RADIUS_KM = (4 / 3) * EARTH_RADIUS_KM;

/** Height of the beam's center above the radar, km, at range r (km) and elevation angle θ (degrees). */
export function beamHeightKm(rangeKm: number, elevDeg: number): number {
  const a = EFFECTIVE_RADIUS_KM;
  const t = (elevDeg * Math.PI) / 180;
  return Math.sqrt(rangeKm * rangeKm + a * a + 2 * rangeKm * a * Math.sin(t)) - a;
}

/** Width of the beam at range r for a beam `widthDeg` wide, km. */
export function beamWidthKm(rangeKm: number, widthDeg = 1): number {
  return 2 * rangeKm * Math.tan(((widthDeg / 2) * Math.PI) / 180);
}

/** Radar reflectivity factor of rain falling at R mm/h (Marshall–Palmer), mm⁶/m³. */
export function reflectivityOfRain(rateMmH: number): number {
  return 200 * Math.pow(Math.max(0, rateMmH), 1.6);
}

export function toDbz(z: number): number {
  return z > 0 ? 10 * Math.log10(z) : -Infinity;
}

export function fromDbz(dbz: number): number {
  return Math.pow(10, dbz / 10);
}

/** Rain rate estimated from a reflectivity in dBZ, mm/h. */
export function rainFromDbz(dbz: number): number {
  return Math.pow(fromDbz(dbz) / 200, 1 / 1.6);
}

/** A storm, as the radar's model of the truth: rain below the freezing level, snow and ice above. */
export interface StormColumn {
  /** Range from the radar, km. */
  rangeKm: number;
  /** Half-width of the storm, km. */
  radiusKm: number;
  /** Rain rate at the ground under its core, mm/h. */
  rainMmH: number;
  /** Height of the 0 °C level, km. */
  freezingKm: number;
  /** Echo top, km. */
  topKm: number;
}

/**
 * Reflectivity (dBZ) of the storm at a point (range, height). Rain below the freezing level has its
 * surface reflectivity; a bright band of melting snow just under the freezing level reads about
 * 6 dB high; ice above it reads about 8 dB low and fades toward the echo top.
 */
export function stormDbz(s: StormColumn, rangeKm: number, zKm: number): number {
  const dx = Math.abs(rangeKm - s.rangeKm);
  if (dx > s.radiusKm || zKm > s.topKm || zKm < 0) return -Infinity;
  const edge = 1 - (dx / s.radiusKm) ** 2;
  const core = toDbz(reflectivityOfRain(s.rainMmH * edge));
  if (zKm <= s.freezingKm - 0.4) return core;
  if (zKm <= s.freezingKm) return core + 6;
  const fade = 1 - (zKm - s.freezingKm) / Math.max(0.1, s.topKm - s.freezingKm);
  return core - 8 - 20 * (1 - fade);
}

export interface RadarLook {
  /** Beam center height over the storm, km. */
  beamKm: number;
  /** Beam width there, km. */
  widthKm: number;
  /** What the radar measures: the average reflectivity across the beam, dBZ (−∞ if it sees nothing). */
  dbz: number;
  /** Rain rate the radar infers from it, mm/h. */
  estimatedMmH: number;
  /** What's actually falling at the ground under the storm's core, mm/h. */
  trueMmH: number;
  /** Whether the beam passes entirely over the storm. */
  overshoots: boolean;
}

/** Look at the storm's core with a beam at elevation θ: the radar's view versus the truth below. */
export function radarLook(s: StormColumn, elevDeg: number, beamDeg = 1): RadarLook {
  const beamKm = beamHeightKm(s.rangeKm, elevDeg);
  const widthKm = beamWidthKm(s.rangeKm, beamDeg);
  // Average linear Z across the beam's vertical extent.
  let zSum = 0;
  const n = 21;
  for (let i = 0; i < n; i++) {
    const z = beamKm - widthKm / 2 + (widthKm * i) / (n - 1);
    const dbz = stormDbz(s, s.rangeKm, z);
    zSum += Number.isFinite(dbz) ? fromDbz(dbz) : 0;
  }
  const zMean = zSum / n;
  const dbz = toDbz(zMean);
  return {
    beamKm,
    widthKm,
    dbz,
    estimatedMmH: zMean > 0 ? rainFromDbz(dbz) : 0,
    trueMmH: s.rainMmH,
    overshoots: beamKm - widthKm / 2 > s.topKm,
  };
}

// ---------------------------------------------------------------------------
// Satellite infrared.

/**
 * Brightness temperature an infrared imager sees over a pixel, °C: a cloud of emissivity ε at
 * cloud-top temperature Tc over a surface at Ts, combined as radiances (σT⁴), not temperatures.
 */
export function brightnessTempC(surfaceC: number, cloudTopC: number, emissivity: number): number {
  const k = 273.15;
  const ts = (surfaceC + k) ** 4;
  const tc = (cloudTopC + k) ** 4;
  const e = Math.max(0, Math.min(1, emissivity));
  return Math.pow(e * tc + (1 - e) * ts, 0.25) - k;
}

/** Cloud-top height a satellite infers from a brightness temperature, assuming an opaque cloud and a fixed lapse rate, km. */
export function inferredTopKm(brightnessC: number, surfaceC: number, lapse = 6.5): number {
  return Math.max(0, (surfaceC - brightnessC) / lapse);
}

/** Emissivity of a cloud layer from its optical depth in the infrared: 1 − e^(−τ). */
export function cloudEmissivity(opticalDepth: number): number {
  return 1 - Math.exp(-Math.max(0, opticalDepth));
}
