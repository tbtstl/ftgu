// What a satellite sees: the sunlight a field reflects in a few wavelength bands, and the
// vegetation index computed from them. Healthy leaves absorb red light (chlorophyll uses it) and
// scatter near-infrared light strongly (the leaf's spongy inner cells), so the contrast between the
// two — the normalized difference vegetation index, NDVI — rises with green leaf area.
// The band centers follow the Sentinel-2 satellites' blue, green, red, red-edge, near-infrared and
// shortwave-infrared bands.

import type { DayWeather } from '../../model/agriculture/climate';
import { rng } from '../../model/random';
import type { SeasonResult } from './crop';
import { stageAt } from './crop';

export interface Band {
  id: string;
  name: string;
  /** Center wavelength, nanometers. */
  nm: number;
}

export const BANDS: Band[] = [
  { id: 'blue', name: 'Blue', nm: 490 },
  { id: 'green', name: 'Green', nm: 560 },
  { id: 'red', name: 'Red', nm: 665 },
  { id: 'edge', name: 'Red edge', nm: 705 },
  { id: 'nir', name: 'Near-infrared', nm: 842 },
  { id: 'swir', name: 'Shortwave infrared', nm: 1610 },
];

/** Reflectance of bare, dry soil in each band (fraction of incoming light). */
export const SOIL: number[] = [0.08, 0.11, 0.14, 0.17, 0.21, 0.3];

/** Reflectance of a single healthy leaf in each band; chlorophyll and water change it (see `leaf`). */
const LEAF: number[] = [0.04, 0.11, 0.04, 0.22, 0.48, 0.22];

/**
 * A leaf's reflectance given its chlorophyll (1 = fully green, 0 = yellow) and water stress (0–1):
 * losing chlorophyll lets red and blue light bounce back; drying shrinks the leaf's inner cells,
 * which scatter less near-infrared, and its water absorbs less shortwave infrared.
 */
export function leaf(chlorophyll: number, stress: number): number[] {
  const yellow = 1 - Math.max(0, Math.min(1, chlorophyll));
  const s = Math.max(0, Math.min(1, stress));
  return [LEAF[0] + 0.05 * yellow, LEAF[1] + 0.08 * yellow, LEAF[2] + 0.18 * yellow, LEAF[3] + 0.08 * yellow, LEAF[4] * (1 - 0.3 * s), LEAF[5] + 0.14 * s];
}

/**
 * A canopy's reflectance: soil showing through the gaps, plus leaves. Visible light is mostly
 * absorbed by the top leaves, so the canopy covers the soil quickly; near-infrared light is scattered
 * from leaf to leaf and keeps building with more layers.
 */
export function canopyReflectance(lai: number, chlorophyll = 1, stress = 0): number[] {
  const l = leaf(chlorophyll, stress);
  const cover = 1 - Math.exp(-0.55 * Math.max(0, lai));
  const deep = 1 - Math.exp(-0.42 * Math.max(0, lai));
  return BANDS.map((b, i) => (b.id === 'nir' || b.id === 'edge' ? SOIL[i] * (1 - deep) + l[i] * deep : SOIL[i] * (1 - cover) + l[i] * cover));
}

/** NDVI = (near-infrared − red) / (near-infrared + red). */
export function ndvi(reflectance: number[]): number {
  const red = reflectance[2];
  const nir = reflectance[4];
  return (nir - red) / (nir + red);
}

/** The true NDVI of a field on each day of a season (index = day of year), soil before planting and after harvest. */
export function seasonNdvi(r: SeasonResult, lastDay = 364): number[] {
  const byDay = new Map(r.days.map((d) => [d.day, d]));
  const soil = ndvi(canopyReflectance(0));
  const lateFrom = r.crop === 'corn' ? stageAt('corn', 'R5') : stageAt('wheat', 'D');
  const out: number[] = [];
  for (let d = 0; d <= lastDay; d++) {
    const e = byDay.get(d);
    if (!e) {
      out.push(d < r.start ? (r.crop === 'wheat' ? ndvi(canopyReflectance(0.5, 0.8)) : soil) : soil + 0.05);
      continue;
    }
    const green = e.lai * (1 - e.disease);
    // Leaves yellow as the grain fills and the plant moves its nitrogen into the kernels.
    const chl = e.dev < lateFrom ? 1 : Math.max(0.15, 1 - (e.dev - lateFrom) / (1 - lateFrom));
    out.push(ndvi(canopyReflectance(green, chl * (1 - 0.6 * e.disease), 1 - e.ks)));
  }
  return out;
}

export interface Observation {
  day: number;
  /** Measured NDVI, or null when clouds hid the field. */
  value: number | null;
}

/**
 * Satellite passes every `revisit` days: a pass sees nothing through cloud — likely on a rainy day,
 * and with chance `cloudiness` on others — and otherwise measures the true NDVI with a little noise.
 */
export function satellitePasses(truth: number[], weather: DayWeather[], revisit: number, cloudiness: number, seed: number, from = 0, to = truth.length - 1): Observation[] {
  const r = rng(seed);
  const out: Observation[] = [];
  for (let d = from; d <= to; d += revisit) {
    const wet = (weather[d]?.rain ?? 0) >= 0.05;
    const cloudy = wet ? r() < 0.9 : r() < cloudiness;
    const noise = (r() + r() + r() - 1.5) * 0.03;
    out.push({ day: d, value: cloudy ? null : Math.max(-0.1, Math.min(1, truth[d] + noise)) });
  }
  return out;
}

/** Mean of the clear observations between two days, or null if there were none. */
export function clearMean(obs: Observation[], from: number, to: number): number | null {
  const v = obs.filter((o) => o.day >= from && o.day < to && o.value !== null).map((o) => o.value as number);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
