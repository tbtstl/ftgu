// The season model: a corn or wheat crop growing day by day through a year of weather.
//
// Each day the crop (1) develops — counts growing degree days (GDD) toward its next stage;
// (2) grows leaves, which intercept sunlight; (3) turns the intercepted light into dry matter at
// a radiation use efficiency (RUE) that falls off when it is too cold or hot (photosynthesis.ts),
// when the soil runs short of water, or when nitrogen is short; and (4) uses water, from a
// root-zone "bucket" filled by rain and irrigation and emptied by evapotranspiration.
// Yield forms in two steps, as it does in the field: the number of kernels is set in the weeks
// around flowering, in proportion to how well the crop is growing then; the kernels are then
// filled from the sugar the canopy makes afterward, up to the most each kernel can hold.

import type { Crop } from '../../model/agriculture/region';
import type { DayWeather } from '../../model/agriculture/climate';
import { extraterrestrial } from '../../model/agriculture/climate';
import { EXTINCTION, tempResponse } from './photosynthesis';

// ---------------------------------------------------------------------------
// Development.

/** Base and cutoff temperatures for growing degree days, °C. */
export const GDD_LIMITS: Record<Crop, { base: number; cap: number }> = {
  corn: { base: 10, cap: 30 },
  wheat: { base: 0, cap: 30 },
};

/**
 * Growing degree days for one day: the day's mean temperature above the base, with the high and
 * low first held between the base and the cap (the "86/50" method, in Celsius: 30/10 for corn).
 */
export function gdd(crop: Crop, tmax: number, tmin: number): number {
  const { base, cap } = GDD_LIMITS[crop];
  const hi = Math.min(cap, Math.max(base, tmax));
  const lo = Math.min(cap, Math.max(base, tmin));
  return Math.max(0, (hi + lo) / 2 - base);
}

export interface Stage {
  code: string;
  name: string;
  /** Fraction of the GDD to maturity at which the stage begins. */
  at: number;
}

/** Corn stages as fractions of the GDD from planting to black layer. */
export const CORN_STAGES: Stage[] = [
  { code: 'VE', name: 'emergence', at: 0.045 },
  { code: 'V6', name: 'six leaves', at: 0.21 },
  { code: 'V12', name: 'twelve leaves', at: 0.35 },
  { code: 'VT', name: 'tasseling', at: 0.49 },
  { code: 'R1', name: 'silking', at: 0.52 },
  { code: 'R2', name: 'blister', at: 0.6 },
  { code: 'R3', name: 'milk', at: 0.66 },
  { code: 'R4', name: 'dough', at: 0.73 },
  { code: 'R5', name: 'dent', at: 0.81 },
  { code: 'R6', name: 'black layer', at: 1 },
];

/** Winter wheat stages as fractions of the GDD from January 1 to ripeness. */
export const WHEAT_STAGES: Stage[] = [
  { code: 'GU', name: 'green-up', at: 0.1 },
  { code: 'J', name: 'jointing', at: 0.3 },
  { code: 'B', name: 'boot', at: 0.47 },
  { code: 'H', name: 'heading', at: 0.52 },
  { code: 'F', name: 'flowering', at: 0.56 },
  { code: 'M', name: 'milk', at: 0.68 },
  { code: 'D', name: 'dough', at: 0.8 },
  { code: 'R', name: 'ripe', at: 1 },
];

export const STAGES: Record<Crop, Stage[]> = { corn: CORN_STAGES, wheat: WHEAT_STAGES };

/** GDD from planting (corn) or January 1 (wheat) to maturity, for the standard varieties, °C·days. */
export const MATURITY_GDD: Record<Crop, number> = { corn: 1500, wheat: 1650 };

/** The stage a crop is in at this fraction of its development (−1 before the first). */
export function stageIndex(crop: Crop, frac: number): number {
  const st = STAGES[crop];
  let i = -1;
  for (let k = 0; k < st.length; k++) if (frac >= st[k].at - 1e-9) i = k;
  return i;
}

/** Fraction of development where a stage begins. */
export function stageAt(crop: Crop, code: string): number {
  return STAGES[crop].find((s) => s.code === code)?.at ?? 1;
}

// ---------------------------------------------------------------------------
// Parameters.

export interface CropParams {
  /** Radiation use efficiency at the best temperature, grams of dry matter per MJ of intercepted PAR. */
  rue: number;
  /** Most leaf area per unit ground the canopy reaches (at the reference plant population). */
  laiMax: number;
  /** Share of each day's growth that goes into grain during grain fill. */
  fillShare: number;
  /** Share of the biomass standing at flowering that can be moved into the grain later. */
  remobilize: number;
  /** Grams of dry matter per bushel. */
  buDryGrams: number;
  /** Kernels in a bushel when every kernel is filled to its maximum. */
  minKernelsPerBu: number;
  /** Depletion of the root zone's available water at which stress begins (fraction). */
  stressAt: number;
  /** Low temperature that kills the canopy outright, °C. */
  killingFrost: number;
}

export const CROP: Record<Crop, CropParams> = {
  corn: {
    rue: 4.0,
    laiMax: 5,
    fillShare: 0.75,
    remobilize: 0.12,
    buDryGrams: 56 * 453.59237 * 0.845,
    minKernelsPerBu: 72000,
    stressAt: 0.55,
    killingFrost: -2,
  },
  wheat: {
    rue: 3.2,
    laiMax: 4.2,
    fillShare: 0.65,
    remobilize: 0.15,
    buDryGrams: 60 * 453.59237 * 0.865,
    minKernelsPerBu: 560000,
    stressAt: 0.55,
    killingFrost: -6,
  },
};

/** Reference corn population, plants per acre, at which laiMax and the kernel potential apply. */
export const REF_POPULATION = 32000;
/** Kernels per ear when nothing limits them, at the reference population. */
export const KERNELS_PER_EAR = 640;
/** Wheat kernels per acre when nothing limits them (about 50 heads per square foot × 30 kernels). */
export const WHEAT_KERNELS_PER_ACRE = 52e6;
export const M2_PER_ACRE = 4046.86;

/** Bushels per acre from grams of grain dry matter per m². */
export function bushelsFromGrams(crop: Crop, g: number): number {
  return (g * M2_PER_ACRE) / CROP[crop].buDryGrams;
}

// ---------------------------------------------------------------------------
// Water.

/** Reference evapotranspiration (Hargreaves), inches per day. */
export function et0(w: DayWeather, d: number): number {
  const tmean = (w.tmax + w.tmin) / 2;
  const mm = 0.0023 * extraterrestrial(d) * 0.408 * (tmean + 17.8) * Math.sqrt(Math.max(0, w.tmax - w.tmin));
  return Math.max(0, mm / 25.4);
}

/** A full canopy transpires this multiple of the reference evapotranspiration. */
export const BASAL: Record<Crop, number> = { corn: 1.1, wheat: 1.05 };
/** Moist bare soil evaporates this multiple of the reference. */
export const SOIL_EVAP = 0.25;

/** Crop coefficient with the soil moist and no stress: soil evaporation plus canopy transpiration. */
export function cropCoefficient(crop: Crop, lai: number): number {
  const f = 1 - Math.exp(-EXTINCTION[crop] * lai);
  return SOIL_EVAP * (1 - f) + BASAL[crop] * f;
}

/**
 * Water stress factor (0–1) for a root zone holding `taw` inches when full, now `depletion` inches
 * short: none until `p` of it is used, then falling linearly to zero when it's empty (FAO-56).
 */
export function waterStress(depletion: number, taw: number, p = 0.5): number {
  if (taw <= 0) return 0;
  const raw = p * taw;
  if (depletion <= raw) return 1;
  return Math.max(0, (taw - depletion) / (taw - raw));
}

/** Rain that soaks in: very heavy rain partly runs off. */
export function effectiveRain(rain: number): number {
  return rain - 0.3 * Math.max(0, rain - 1.2);
}

/** Saturation vapor pressure of air at t °C, kPa. */
export function saturationVp(t: number): number {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/** Daytime vapor pressure deficit — how dry the air is — estimated from the day's high and low, kPa. */
export function vpd(w: DayWeather): number {
  return Math.max(0.3, 0.75 * (saturationVp(w.tmax) - saturationVp(w.tmin)));
}

/**
 * Transpiration efficiency: grams of dry matter per kilogram of water transpired, at 1 kPa of
 * vapor pressure deficit. Drier air costs more water per gram. Corn, a C4 plant, needs much less
 * water per gram than wheat.
 */
export const TRANSPIRATION_EFFICIENCY: Record<Crop, number> = { corn: 10.5, wheat: 5.5 };

/** Grams of dry matter per m² that `inches` of transpiration can pay for, in air this dry. */
export function waterLimitedGrowth(crop: Crop, inches: number, vpdKPa: number): number {
  return (TRANSPIRATION_EFFICIENCY[crop] * inches * 25.4) / Math.max(0.3, vpdKPa);
}


// ---------------------------------------------------------------------------
// The season.

export interface Irrigation {
  /** Irrigate when the root zone is this far depleted (fraction of its available water). */
  trigger: number;
  /** Inches applied per irrigation. */
  amount: number;
  /** Fewest days between irrigations (the well's capacity). */
  interval: number;
  /** Most water that may be pumped in the season, inches (a water allocation). */
  cap?: number;
}

export interface SeasonOptions {
  crop: Crop;
  /** Planting day (corn), day of year. Ignored for wheat, which starts the year already planted. */
  plantDay?: number;
  /** GDD from planting to black layer (corn) or January 1 to ripe (wheat). */
  maturityGdd?: number;
  /** Corn plants per acre. */
  population?: number;
  /** Root zone's plant-available water when full, inches. */
  pawIn: number;
  /** How full the root zone is at the start (planting for corn, January 1 for wheat), fraction. */
  startWater: number;
  /** Nutrient sufficiency, 0–1 (1 = nothing short). Multiplies growth. */
  nutrient?: number;
  /** Extra yield lost to pests or disease, fraction (applied to the harvest). */
  pestLoss?: number;
  irrigation?: Irrigation | null;
  /** Wheat only: how well the stand established in the fall, 0–1. */
  fallStand?: number;
  /** A leaf disease that spreads through the canopy in warm, wet weather. */
  disease?: DiseaseOptions | null;
}

export interface DiseaseOptions {
  /** Share of the leaf area diseased when the disease first appears. */
  inoculum: number;
  /** Development fraction at which it appears. */
  onset: number;
  /** Daily growth rate of the epidemic on a favorable day (logistic). */
  rate: number;
  /** How much a resistant hybrid slows the epidemic, 0–1. */
  resistance?: number;
  /** Development fraction at which a fungicide is sprayed. */
  sprayAt?: number;
  /** Spray only if the diseased share is at least this when sprayAt arrives (scouting). 0 = always spray. */
  sprayThreshold?: number;
  /** How much the fungicide slows the epidemic while it lasts, 0–1. */
  efficacy?: number;
  /** Days the fungicide protects the leaves. */
  protectDays?: number;
}

/** Is today's weather good for leaf disease? Wet or humid, and warm. */
export function diseaseFavorability(w: DayWeather): number {
  const tmean = (w.tmax + w.tmin) / 2;
  const warm = tmean >= 17 && tmean <= 30;
  const wet = w.rain >= 0.1 || vpd(w) < 0.9;
  return warm && wet ? 1 : warm ? 0.3 : 0.1;
}

export interface SeasonDay {
  day: number;
  /** Cumulative GDD since planting (corn) or January 1 (wheat). */
  gdd: number;
  /** Development as a fraction of maturity (0–1, capped). */
  dev: number;
  stage: number;
  lai: number;
  /** Fraction of sunlight intercepted. */
  intercept: number;
  /** Standing dry matter, g/m². */
  biomass: number;
  /** Today's growth, g/m². */
  growth: number;
  /** Root-zone depletion at the start of the day, inches. */
  depletion: number;
  /** Plant-available water left, fraction of full. */
  water: number;
  /** Water stress factor, 0–1. */
  ks: number;
  /** Temperature factor, 0–1. */
  ft: number;
  /** Actual evapotranspiration, inches. */
  et: number;
  irrigation: number;
  /** Water draining below the root zone today, inches. */
  drainage: number;
  /** Share of the leaf area diseased. */
  disease: number;
  /** Grain dry matter so far, g/m². */
  grain: number;
  alive: boolean;
}

export interface SeasonResult {
  crop: Crop;
  days: SeasonDay[];
  /** First and last simulated days. */
  start: number;
  end: number;
  /** Day the crop reached each stage (index matching STAGES), or −1 if it never did. */
  stageDays: number[];
  /** Day maturity was reached, or the day the crop was killed. */
  maturityDay: number;
  killed: boolean;
  /** Corn: cold weather after dent ended grain fill before the hybrid reached black layer on its own. */
  premature: boolean;
  /** Share of the potential kernels that set around flowering (0–1). */
  setIndex: number;
  /** Corn: grams of dry matter each plant added per day around silking, which sets its kernel number. */
  plantGrowthRate: number;
  /** Growing conditions (0–1) through grain fill. */
  fillIndex: number;
  /** Mean stress factors over the season: water, temperature. */
  meanKs: number;
  /** Kernels per acre. */
  kernels: number;
  /** Corn: ears per acre and kernels per ear. */
  ears: number;
  kernelsPerEar: number;
  /** Kernels per bushel (more = lighter kernels). */
  kernelsPerBu: number;
  /** Yield limits, bushels per acre: what the kernels could hold, and what the canopy supplied. */
  sink: number;
  source: number;
  /** Harvested yield, bushels per acre, after pest losses. */
  yield: number;
  /** Water used and supplied over the season, inches. */
  etTotal: number;
  rainTotal: number;
  irrigationTotal: number;
  /** Days with water stress (ks < 0.8). */
  stressDays: number;
  /** Water that drained below the root zone, inches. */
  drainageTotal: number;
  /** Share of the leaf area diseased at the end of the season. */
  diseaseFinal: number;
  /** Day a fungicide was sprayed, or −1. */
  sprayDay: number;
}

/** Leaf area the crop is programmed to reach at this development fraction (no stress). */
export function potentialLai(crop: Crop, dev: number, laiMax: number): number {
  if (crop === 'corn') {
    const ve = CORN_STAGES[0].at;
    const vt = stageAt('corn', 'VT');
    const r3 = stageAt('corn', 'R3');
    if (dev < ve) return 0;
    if (dev <= vt) {
      const x = (dev - ve) / (vt - ve);
      const s = (z: number) => 1 / (1 + Math.exp(-9 * (z - 0.55)));
      return (laiMax * (s(x) - s(0))) / (s(1) - s(0));
    }
    if (dev <= r3) return laiMax;
    return laiMax * (1 - 0.75 * Math.min(1, (dev - r3) / (1 - r3)));
  }
  const gu = stageAt('wheat', 'GU');
  const hd = stageAt('wheat', 'H');
  const fl = stageAt('wheat', 'F');
  const start = 0.5;
  if (dev <= gu) return start;
  if (dev <= hd) {
    const x = (dev - gu) / (hd - gu);
    return start + (laiMax - start) * x * x * (3 - 2 * x);
  }
  if (dev <= fl) return laiMax;
  return laiMax * Math.max(0, 1 - (dev - fl) / (1 - fl));
}

/**
 * Grows one crop through a year of weather (365 days, index 0 = January 1).
 * Corn runs from planting until black layer (or a killing frost); wheat from January 1 until ripe.
 */
export function simulateSeason(weather: DayWeather[], opts: SeasonOptions): SeasonResult {
  const crop = opts.crop;
  const P = CROP[crop];
  const maturity = opts.maturityGdd ?? MATURITY_GDD[crop];
  const population = opts.population ?? REF_POPULATION;
  const nutrient = opts.nutrient ?? 1;
  const taw = opts.pawIn;
  const start = crop === 'corn' ? Math.round(opts.plantDay ?? 120) : 0;
  const stages = STAGES[crop];
  const popRatio = population / REF_POPULATION;
  const laiMax = crop === 'corn' ? Math.min(7, P.laiMax * Math.pow(popRatio, 0.6)) : P.laiMax * (0.6 + 0.4 * (opts.fallStand ?? 1));
  const setFrom = crop === 'corn' ? 0.46 : 0.36;
  const setTo = crop === 'corn' ? 0.62 : stageAt('wheat', 'F') + 0.03;
  const fillFrom = crop === 'corn' ? stageAt('corn', 'R2') : stageAt('wheat', 'F');

  const days: SeasonDay[] = [];
  const stageDays = stages.map(() => -1);
  let cum = 0;
  let lai = crop === 'corn' ? 0 : 0.5 * (0.6 + 0.4 * (opts.fallStand ?? 1));
  let biomass = crop === 'corn' ? 0 : 60 * (0.6 + 0.4 * (opts.fallStand ?? 1));
  let depletion = (1 - Math.max(0, Math.min(1, opts.startWater))) * taw;
  let grain = 0;
  let fillSupply = 0;
  let biomassAtFill = -1;
  let alive = true;
  let killed = false;
  let maturityDay = -1;
  let lastIrr = -99;
  let setSum = 0;
  let ratioSum = 0;
  let setN = 0;
  let fillSum = 0;
  let fillN = 0;
  let ksSum = 0;
  let ksN = 0;
  let etTotal = 0;
  let rainTotal = 0;
  let irrTotal = 0;
  let stressDays = 0;
  let drainTotal = 0;
  let coldRun = 0;
  let premature = false;
  let frostSurvival = 1;
  let severity = 0;
  let diseaseStarted = false;
  let sprayDecided = false;
  let sprayDay = -1;

  let prevPotLai = potentialLai(crop, 0, laiMax);

  for (let d = start; d < weather.length; d++) {
    const w = weather[d];
    const dev = Math.min(1, cum / maturity);
    const tDay = w.tmax - 0.25 * (w.tmax - w.tmin);
    const ft = tempResponse(crop, tDay);
    let ks = waterStress(depletion, taw, P.stressAt);

    // Irrigation, when the rule calls for it and the well has had time to recover.
    let irr = 0;
    const ir = opts.irrigation;
    if (ir && alive && dev < 0.97 && depletion >= ir.trigger * taw && d - lastIrr >= ir.interval) {
      irr = Math.max(0, Math.min(ir.amount, depletion, (ir.cap ?? Infinity) - irrTotal));
      lastIrr = d;
      depletion -= irr;
      ks = waterStress(depletion, taw, P.stressAt);
    }

    // Water use: the canopy transpires in proportion to the light it intercepts, held back when
    // the soil runs dry; bare soil between the plants evaporates a little.
    const growing = alive && dev < 1;
    // Leaf disease: diseased leaf area catches light but doesn't use it.
    const dz = opts.disease;
    if (dz && growing) {
      if (!diseaseStarted && dev >= dz.onset) {
        severity = dz.inoculum;
        diseaseStarted = true;
      }
      if (dz.sprayAt !== undefined && !sprayDecided && dev >= dz.sprayAt) {
        sprayDecided = true;
        if (severity >= (dz.sprayThreshold ?? 0)) sprayDay = d;
      }
    }
    const intercept = 1 - Math.exp(-EXTINCTION[crop] * lai * (1 - severity));
    const e0 = et0(w, d);
    const transpiration = growing ? e0 * BASAL[crop] * intercept * ks : 0;
    const evaporation = e0 * SOIL_EVAP * (1 - (growing ? intercept : 0)) * (depletion < 0.25 * taw ? 1 : 0.4);

    // Growth: the smaller of what the intercepted light allows and what the water the canopy can
    // transpire today pays for. Each gram costs more water in dry air.
    const par = 0.48 * w.srad;
    const lightGrowth = P.rue * par * intercept * ft * nutrient;
    const waterGrowth = waterLimitedGrowth(crop, transpiration, vpd(w)) * nutrient;
    const growth = growing ? Math.min(lightGrowth, waterGrowth) : 0;
    biomass += growth;

    // Kernel setting and grain fill.
    if (alive && dev >= setFrom && dev < setTo) {
      let pollen = 1;
      if (crop === 'corn' && dev >= 0.5 && dev < 0.58) pollen = Math.max(0.3, 1 - 0.07 * Math.max(0, w.tmax - 35));
      if (crop === 'wheat' && dev >= stageAt('wheat', 'B') && dev < setTo) {
        // A freeze kills the florets it reaches outright; heat only weakens pollination for the day.
        if (w.tmin < -1.5) frostSurvival *= 1 - Math.min(0.9, 0.3 * (-1.5 - w.tmin));
        if (w.tmax > 32) pollen = Math.min(pollen, Math.max(0.3, 1 - 0.06 * (w.tmax - 32)));
      }
      // How close the crop grows to what the light allows: every shortfall — heat, dry air, dry soil, nitrogen — counts.
      const potential = P.rue * par * intercept;
      ratioSum += (potential > 0.5 ? Math.min(1, growth / potential) : Math.min(1, ft) * ks * nutrient) * pollen;
      // Corn also counts how fast each plant is growing.
      setSum += growth * pollen;
      setN++;
    }
    if (alive && dev >= fillFrom && dev < 1) {
      if (biomassAtFill < 0) biomassAtFill = biomass - growth;
      // Very hot days cut short the kernels' filling.
      const heat = fillHeatFactor(crop, w.tmax);
      fillSupply += growth * P.fillShare * heat;
      fillSum += Math.min(1, ft) * ks * nutrient * heat;
      fillN++;
    }

    // Water balance.
    const et = transpiration + evaporation;
    const rainIn = effectiveRain(w.rain);
    depletion = depletion + et - rainIn;
    let drainage = 0;
    if (depletion < 0) {
      drainage = -depletion;
      depletion = 0;
    }
    drainTotal += drainage;
    if (depletion > taw) depletion = taw;
    etTotal += et;
    rainTotal += w.rain;
    irrTotal += irr;
    if (alive && dev < 1) {
      ksSum += ks;
      ksN++;
      if (ks < 0.8) stressDays++;
    }

    // The epidemic grows logistically on favorable days, slowed by resistance and by fungicide while it lasts.
    if (dz && diseaseStarted && growing) {
      const protectedNow = sprayDay >= 0 && d - sprayDay < (dz.protectDays ?? 21);
      const r = dz.rate * diseaseFavorability(w) * (1 - (dz.resistance ?? 0)) * (protectedNow ? 1 - (dz.efficacy ?? 0.8) : 1);
      severity = Math.min(0.95, severity + r * severity * (1 - severity));
    }

    // Development.
    const g = gdd(crop, w.tmax, w.tmin);
    if (alive && dev < 1) cum += g;
    const newDev = Math.min(1, cum / maturity);
    for (let k = 0; k < stages.length; k++) if (stageDays[k] < 0 && newDev >= stages[k].at - 1e-9) stageDays[k] = d;

    // Leaves: grow toward the programmed area as stress allows; drought hastens senescence.
    const pot = potentialLai(crop, newDev, laiMax);
    if (alive && newDev < 1) {
      if (pot > prevPotLai) lai += (pot - prevPotLai) * Math.min(1, 0.3 + 0.7 * ks) * Math.min(1, 0.5 + 0.5 * nutrient);
      else lai = Math.min(lai, lai * (pot / Math.max(1e-6, prevPotLai)));
      if (ks < 0.5) lai *= 1 - 0.03 * (0.5 - ks) / 0.5;
      // Late in a corn season, cold nights age the leaves, and a light frost burns some of them.
      if (crop === 'corn' && newDev > stageAt('corn', 'R1')) {
        if (w.tmin <= 0 && w.tmin > P.killingFrost) lai *= 0.65;
        else if (w.tmin < 6) lai *= 0.95;
      }
      lai = Math.max(0, lai);
    }
    prevPotLai = pot;

    // A killing frost ends the season; so does maturity.
    if (alive && w.tmin <= P.killingFrost && newDev < 1 && newDev > (crop === 'corn' ? stageAt('corn', 'V6') : stageAt('wheat', 'J'))) {
      alive = false;
      killed = true;
      lai = 0;
      maturityDay = d;
    }
    if (alive && newDev >= 1 && maturityDay < 0) {
      maturityDay = d;
      alive = false;
    }
    // A run of cold days after dent ends grain fill early: a premature black layer.
    coldRun = (w.tmax + w.tmin) / 2 < 12 ? coldRun + 1 : 0;
    if (alive && crop === 'corn' && newDev >= stageAt('corn', 'R5') && newDev < 1 && coldRun >= 4) {
      maturityDay = d;
      alive = false;
      premature = true;
    }

    grain = Math.max(grain, fillSupply);
    days.push({
      day: d,
      gdd: cum,
      dev: newDev,
      stage: stageIndex(crop, newDev),
      lai: alive || newDev >= 1 ? lai : 0,
      intercept,
      biomass,
      growth,
      depletion,
      water: taw > 0 ? 1 - depletion / taw : 0,
      ks,
      ft,
      et,
      irrigation: irr,
      drainage,
      grain: fillSupply,
      disease: severity,
      alive: alive || (newDev >= 1 && !killed),
    });
    if (!alive && maturityDay >= 0 && d >= maturityDay) break;
  }

  // Kernel number, set around flowering.
  const fillIndex = fillN ? fillSum / fillN : 0;
  let ears = 0;
  let kernelsPerEar = 0;
  let kernels: number;
  let plantGrowthRate = 0;
  let setIndex: number;
  const growthRatio = setN ? ratioSum / setN : 0;
  if (crop === 'corn') {
    plantGrowthRate = setN ? setSum / setN / (population / M2_PER_ACRE) : 0;
    setIndex = cornKernelSet(plantGrowthRate) * Math.pow(Math.min(1, growthRatio / 0.78), 0.9);
    ears = population * 0.97 * Math.max(0.4, Math.min(1, plantGrowthRate / 1.0));
    kernelsPerEar = KERNELS_PER_EAR * setIndex;
    kernels = ears * kernelsPerEar;
  } else {
    setIndex = kernelSetFactor(growthRatio);
    kernels = WHEAT_KERNELS_PER_ACRE * (0.55 + 0.45 * (opts.fallStand ?? 1)) * setIndex * frostSurvival;
  }
  // Grain fill: the canopy's supply after flowering plus what the stems can give back.
  const remob = biomassAtFill > 0 ? biomassAtFill * P.remobilize : 0;
  const source = bushelsFromGrams(crop, fillSupply + remob);
  const sink = kernels / P.minKernelsPerBu;
  const raw = Math.max(0, Math.min(sink, source));
  // A crop killed before it matured keeps only what it had filled.
  const finalYield = raw * (1 - (opts.pestLoss ?? 0));
  const kernelsPerBu = raw > 0.01 ? kernels / raw : 0;
  const end = days.length ? days[days.length - 1].day : start;
  return {
    crop,
    days,
    start,
    end,
    stageDays,
    maturityDay: maturityDay >= 0 ? maturityDay : end,
    killed,
    premature,
    setIndex,
    plantGrowthRate,
    fillIndex,
    meanKs: ksN ? ksSum / ksN : 1,
    kernels,
    ears,
    kernelsPerEar,
    kernelsPerBu,
    sink,
    source,
    yield: finalYield,
    etTotal,
    rainTotal,
    irrigationTotal: irrTotal,
    stressDays,
    drainageTotal: drainTotal,
    diseaseFinal: severity,
    sprayDay,
  };
}

/** Hot days during grain fill: above 32 °C for wheat and 35 °C for corn, the kernels fill less. */
export function fillHeatFactor(crop: Crop, tmax: number): number {
  const limit = crop === 'corn' ? 35 : 32;
  return Math.max(0.4, 1 - 0.06 * Math.max(0, tmax - limit));
}

/** Wheat: share of the potential kernels that set, from how close growth came to the light's ceiling around flowering (0–1). */
export function kernelSetFactor(ratio: number): number {
  const x = Math.max(0, Math.min(1, (ratio - 0.2) / 0.7));
  return Math.pow(x, 0.6);
}

/** Below this plant growth rate around silking, g per plant per day, an ear sets no kernels. */
export const PGR_THRESHOLD = 0.8;

/**
 * Corn: share of the 640 potential kernels per ear that set, from the plant's growth rate around
 * silking (grams per plant per day). Kernel number rises steeply above a threshold and saturates.
 */
export function cornKernelSet(pgr: number): number {
  return Math.max(0, 1 - Math.exp(-(pgr - PGR_THRESHOLD) / 1.5));
}
