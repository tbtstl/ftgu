// Weather-dependent generation: a wind turbine's power curve against the wind's distribution,
// air density, height above ground, and forecast uncertainty; and solar output from the sun's
// height, cloud and panel temperature. Hollin Ridge's wind farm and Valley solar are the
// electricity course's Ridge wind (350 MW) and Valley solar (400 MW), set in the Calder region.

import { sunAt } from './station';

export const TURBINE = { cutIn: 3, rated: 12, cutOut: 25 };
export const RIDGE_MW = 350;
export const VALLEY_MW = 400;
/** Air density at which the power curve is quoted, kg/m³. */
export const RHO_STANDARD = 1.225;

/**
 * A turbine's output as a share of its rating at wind speed v (m/s) and air density ρ: nothing
 * below cut-in, growing with the cube of the speed (and in proportion to density) up to rated,
 * flat at rated, and shut down beyond cut-out.
 */
export function powerCurve(v: number, rho = RHO_STANDARD): number {
  const { cutIn, rated, cutOut } = TURBINE;
  if (v < cutIn || v >= cutOut) return 0;
  const raw = (v ** 3 - cutIn ** 3) / (rated ** 3 - cutIn ** 3);
  return Math.max(0, Math.min(1, raw * (rho / RHO_STANDARD)));
}

/** Weibull probability density of wind speed v with shape k and scale c. */
export function weibullPdf(v: number, k: number, c: number): number {
  if (v < 0) return 0;
  return (k / c) * (v / c) ** (k - 1) * Math.exp(-((v / c) ** k));
}

/** Γ(x) by the Lanczos approximation. */
export function gammaFn(x: number): number {
  const g = 7;
  const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1;
  let a = p[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += p[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
}

export function weibullMean(k: number, c: number): number {
  return c * gammaFn(1 + 1 / k);
}

/** Weibull scale that gives a mean speed with shape k. */
export function weibullScaleFor(mean: number, k: number): number {
  return mean / gammaFn(1 + 1 / k);
}

/** Capacity factor: the average output over the wind's distribution, as a share of the rating. */
export function capacityFactor(meanSpeed: number, k = 2, rho = RHO_STANDARD): number {
  const c = weibullScaleFor(meanSpeed, k);
  let s = 0;
  const dv = 0.05;
  for (let v = dv / 2; v < 35; v += dv) s += powerCurve(v, rho) * weibullPdf(v, k, c) * dv;
  return s;
}

/** Wind speed at a hub height from a 10 m reading, by the power law with exponent α (1/7 over open land). */
export function hubSpeed(v10: number, hubM = 100, alpha = 1 / 7): number {
  return v10 * (hubM / 10) ** alpha;
}

/** Density of dry air at a temperature and pressure, kg/m³. */
export function airDensity(tC: number, pHpa = 1013.25): number {
  return (pHpa * 100) / (287.05 * (tC + 273.15));
}

/**
 * Expected output and its spread when the wind speed is uncertain: speed ~ Normal(mean, sd),
 * truncated at zero, pushed through the power curve.
 */
export function outputUnderUncertainty(meanSpeed: number, sdSpeed: number, rho = RHO_STANDARD): { mean: number; sd: number; p10: number; p90: number } {
  if (sdSpeed <= 1e-6) {
    const p = powerCurve(meanSpeed, rho);
    return { mean: p, sd: 0, p10: p, p90: p };
  }
  const n = 400;
  const pts: Array<[number, number]> = [];
  let m = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const z = -4 + (8 * (i + 0.5)) / n;
    const pdf = Math.exp(-(z * z) / 2);
    const v = Math.max(0, meanSpeed + sdSpeed * z);
    const p = powerCurve(v, rho);
    pts.push([p, pdf]);
    m += p * pdf;
    w += pdf;
  }
  m /= w;
  let s2 = 0;
  for (const [p, pdf] of pts) s2 += (p - m) ** 2 * pdf;
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const q = (frac: number) => {
    let c = 0;
    for (const [p, pdf] of sorted) {
      c += pdf / w;
      if (c >= frac) return p;
    }
    return sorted[sorted.length - 1][0];
  };
  return { mean: m, sd: Math.sqrt(s2 / w), p10: q(0.1), p90: q(0.9) };
}

/**
 * The wind farm's share of its rating over a day whose mean hub-height wind is `dailyMean`: the
 * hours scatter around the daily mean (a standard deviation of a quarter of it), so the day's
 * output is the curve averaged over that scatter, not the curve at the mean.
 */
export function dailyWindCf(dailyMean: number, rho = RHO_STANDARD): number {
  // A 41-point rule over ±3 standard deviations: fast enough to run over every day of the archive.
  const sd = 0.25 * dailyMean;
  let s = 0;
  let w = 0;
  for (let i = 0; i <= 40; i++) {
    const z = -3 + (6 * i) / 40;
    const pdf = Math.exp(-(z * z) / 2);
    s += powerCurve(Math.max(0, dailyMean + sd * z), rho) * pdf;
    w += pdf;
  }
  return s / w;
}

// ---------------------------------------------------------------------------
// Solar.

/**
 * Valley solar's output as a share of its rating in an hour: clear-sky sunlight from the sun's
 * height, cut by cloud (the Kasten–Czeplak relation, 1 − 0.75·cloud^3.4), and by 0.4% for each
 * °C the panels run above 25 °C.
 */
export function solarShare(doy: number, hour: number, cloud: number, airC: number): number {
  const sun = sunAt(doy, hour);
  if (sun <= 0) return 0;
  const clear = Math.pow(sun, 1.15);
  const sky = clear * (1 - 0.75 * Math.pow(Math.max(0, Math.min(1, cloud)), 3.4));
  const cellC = airC + 25 * sky;
  const heat = 1 - 0.004 * Math.max(0, cellC - 25);
  return Math.max(0, Math.min(1, 0.92 * sky * heat));
}

/** Valley solar's energy over a day, MWh. */
export function solarDayMWh(doy: number, cloud: number, airC: number, mw = VALLEY_MW): number {
  let s = 0;
  for (let h = 0; h < 24; h++) s += solarShare(doy, h + 0.5, cloud, airC) * mw;
  return s;
}
