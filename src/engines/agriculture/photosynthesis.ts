// Photosynthesis: how fast a leaf, and then a whole canopy, turns light and CO₂ into sugar.
//
// The leaf model is the standard non-rectangular hyperbola: at low light, assimilation rises in
// proportion to light (the slope is the quantum yield); at high light it levels off at the leaf's
// capacity, Amax. Corn is a C4 plant: it pumps CO₂ to its Rubisco, so it barely responds to more
// CO₂, wastes nothing on photorespiration, and has a high, warm optimum. Wheat is C3: it gains from
// extra CO₂, loses more to photorespiration as it warms, and prefers cool weather.
// The same temperature curves drive daily crop growth in the season model (crop.ts).

import type { Crop } from '../../model/agriculture/region';

/** Today's CO₂ concentration, ppm, used as the reference for the CO₂ response. */
export const CO2_TODAY = 420;

export interface LeafParams {
  /** Light-saturated gross assimilation at the optimum temperature and today's CO₂, µmol CO₂ m⁻² s⁻¹. */
  amax: number;
  /** Quantum yield at the reference conditions, mol CO₂ per mol photons. */
  alpha: number;
  /** Curvature of the light response (0 = gradual, 1 = sharp corner). */
  theta: number;
  /** Leaf respiration in the light, µmol CO₂ m⁻² s⁻¹. */
  rd: number;
  /** Temperature response: zero at t0, full from t1 to t2, zero again at t3 (°C). */
  temps: [number, number, number, number];
}

export const LEAF: Record<Crop, LeafParams> = {
  corn: { amax: 58, alpha: 0.065, theta: 0.8, rd: 1.1, temps: [6, 26, 36, 46] },
  wheat: { amax: 34, alpha: 0.052, theta: 0.75, rd: 0.9, temps: [-1, 16, 26, 38] },
};

/** Fraction of full photosynthetic capacity at temperature t (°C): a trapezoid. */
export function tempResponse(crop: Crop, t: number): number {
  const [t0, t1, t2, t3] = LEAF[crop].temps;
  if (t <= t0 || t >= t3) return 0;
  if (t < t1) return (t - t0) / (t1 - t0);
  if (t <= t2) return 1;
  return (t3 - t) / (t3 - t2);
}

/** CO₂ compensation point of a C3 leaf, ppm: photorespiration grows as the leaf warms. */
export function compensationPoint(t: number): number {
  return 45 * Math.pow(1.055, t - 25);
}

/**
 * Multiplier on light-saturated capacity from the CO₂ concentration, 1 at today's 420 ppm.
 * C4 leaves saturate at low CO₂; C3 leaves keep gaining (Rubisco-limited, near-linear).
 */
export function co2Capacity(crop: Crop, co2: number, t = 25): number {
  if (crop === 'corn') {
    const f = (c: number) => 1 - Math.exp(-c / 140);
    return f(co2) / f(CO2_TODAY);
  }
  const g = compensationPoint(t);
  const f = (c: number) => Math.max(0, c - g) / (Math.max(0, c - g) + 800);
  const g25 = compensationPoint(25);
  return f(co2) / (Math.max(0, CO2_TODAY - g25) / (CO2_TODAY - g25 + 800));
}

/** Quantum yield at this CO₂ and temperature: constant for C4, falling with heat for C3. */
export function quantumYield(crop: Crop, co2: number, t: number): number {
  const p = LEAF[crop];
  if (crop === 'corn') return p.alpha;
  const g = compensationPoint(t);
  const g25 = compensationPoint(25);
  const eff = (c: number, gg: number) => Math.max(0, c - gg) / (c + 2 * gg);
  return (p.alpha * eff(co2, g)) / eff(CO2_TODAY, g25);
}

/** Share of the plant-available water left when the stomata begin to close (crop.ts's stressAt is 0.55 used). */
export const STOMATA_CLOSE_BELOW = 0.45;

/**
 * How much the stomata stay open, from soil water (fraction of the plant-available water left):
 * fully open until 55% of it is used, then closing in proportion — the same rule as the water balance.
 */
export function stomatalFactor(soilWater: number): number {
  return Math.max(0, Math.min(1, soilWater / STOMATA_CLOSE_BELOW));
}

export interface LeafResult {
  /** Net assimilation, µmol CO₂ m⁻² s⁻¹ (negative in the dark). */
  net: number;
  /** Gross assimilation before respiration. */
  gross: number;
  /** Light-saturated capacity under these conditions. */
  capacity: number;
  /** Initial slope under these conditions, mol/mol. */
  alpha: number;
}

/**
 * Net CO₂ assimilation of one leaf.
 * @param par photosynthetically active light, µmol photons m⁻² s⁻¹ (full sun ≈ 2,000)
 * @param co2 air CO₂, ppm
 * @param t leaf temperature, °C
 * @param soilWater fraction of plant-available soil water remaining (0–1)
 */
export function leafAssimilation(crop: Crop, par: number, co2: number, t: number, soilWater = 1): LeafResult {
  const p = LEAF[crop];
  const ft = tempResponse(crop, t);
  const fw = stomatalFactor(soilWater);
  // Closing stomata starve a C3 leaf of CO₂ more than a C4 leaf, which concentrates its own.
  const waterOnCapacity = crop === 'corn' ? fw : fw * fw;
  const capacity = p.amax * ft * co2Capacity(crop, co2, t) * waterOnCapacity;
  const alpha = quantumYield(crop, co2, t) * Math.min(1, 0.35 + 0.65 * ft) * (crop === 'corn' ? 1 : 0.6 + 0.4 * fw);
  const i = alpha * Math.max(0, par);
  const gross = capacity > 0 ? (i + capacity - Math.sqrt((i + capacity) ** 2 - 4 * p.theta * i * capacity)) / (2 * p.theta) : 0;
  const rd = p.rd * (0.4 + 0.6 * Math.min(1, Math.max(0, t) / 25));
  return { net: gross - rd, gross, capacity, alpha };
}

// ---------------------------------------------------------------------------
// From a leaf to a field: a canopy through one day.

/** Light extinction coefficient: how quickly light fades down through the leaf layers. */
export const EXTINCTION: Record<Crop, number> = { corn: 0.6, wheat: 0.5 };

/** Fraction of the incoming light a canopy of this leaf area index intercepts. */
export function interception(crop: Crop, lai: number): number {
  return 1 - Math.exp(-EXTINCTION[crop] * Math.max(0, lai));
}

/** Grams of dry matter built per gram of CO₂ fixed, after the plant's own respiration. */
export const DM_PER_CO2 = (30 / 44) * 0.62;
/** µmol photons per joule of photosynthetically active light. */
export const UMOL_PER_J = 4.57;

export interface CanopyDay {
  /** Hour-by-hour net canopy assimilation, µmol CO₂ per m² of ground per second (index = hour 0–23). */
  hourly: number[];
  /** Light above the canopy each hour, µmol m⁻² s⁻¹. */
  light: number[];
  /** Grams of CO₂ fixed per m² of ground over the day. */
  co2Grams: number;
  /** Grams of dry matter added per m² of ground over the day. */
  dryMatter: number;
  /** Light energy (PAR) arriving over the day, MJ per m². */
  parMJ: number;
  /** Light energy intercepted by the canopy, MJ per m². */
  interceptedMJ: number;
  /** Dry matter per MJ of intercepted light, g/MJ — the radiation use efficiency. */
  rue: number;
}

/**
 * One day of a canopy, summed hour by hour over `layers` slices of leaf. Light falls off
 * exponentially down the canopy; each layer's leaves photosynthesize at the light they get.
 * @param peakPar light at solar noon, µmol m⁻² s⁻¹
 * @param dayLength hours from sunrise to sunset
 * @param tDay daytime temperature, °C
 */
export function canopyDay(crop: Crop, lai: number, peakPar: number, dayLength: number, tDay: number, co2 = CO2_TODAY, soilWater = 1, layers = 12): CanopyDay {
  const k = EXTINCTION[crop];
  const hourly: number[] = [];
  const light: number[] = [];
  let co2Mol = 0;
  let parJ = 0;
  const rise = 12 - dayLength / 2;
  for (let h = 0; h < 24; h++) {
    // Sample each hour at its midpoint; light follows a sine arch between sunrise and sunset.
    const tt = h + 0.5;
    const s = tt > rise && tt < 24 - rise ? Math.sin((Math.PI * (tt - rise)) / dayLength) : 0;
    const par = peakPar * s;
    light.push(par);
    let net = 0;
    const dl = lai / layers;
    for (let j = 0; j < layers; j++) {
      const above = (j + 0.5) * dl;
      // Light absorbed per unit leaf area in this layer.
      const leafLight = k * par * Math.exp(-k * above);
      net += leafAssimilation(crop, leafLight, co2, tDay, soilWater).net * dl;
    }
    // Night: the leaves only respire.
    hourly.push(net);
    co2Mol += (net * 3600) / 1e6;
    parJ += (par / UMOL_PER_J) * 3600;
  }
  const co2Grams = Math.max(0, co2Mol * 44);
  const dryMatter = co2Grams * DM_PER_CO2;
  const parMJ = parJ / 1e6;
  const interceptedMJ = parMJ * interception(crop, lai);
  return { hourly, light, co2Grams, dryMatter, parMJ, interceptedMJ, rue: interceptedMJ > 0.01 ? dryMatter / interceptedMJ : 0 };
}

/** Grams of dry matter per m² of ground, expressed as bushels of grain per acre if `share` of it became grain. */
export function gramsToBushels(crop: Crop, grams: number, share = 1): number {
  const buDryKg = crop === 'corn' ? 56 * 0.45359237 * 0.845 : 60 * 0.45359237 * 0.865;
  return (grams * share * 4046.86) / 1000 / buDryKg;
}
