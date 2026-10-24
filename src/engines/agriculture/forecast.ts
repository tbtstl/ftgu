// Statistical yield forecasting: predict a season's yield from what is observable by a forecast
// date — temperature and rain so far, and what satellites saw of the canopy — with a linear
// regression fitted on past seasons and judged on seasons it never saw.

import { fieldSeason } from './farm';
import { satellitePasses, seasonNdvi } from './vegetation';
import { normalYear, simulatedYear } from '../../model/agriculture/climate';
import { dayOf, type DistrictId } from '../../model/agriculture/region';
import { rng } from '../../model/random';

export type Predictor = 'temp' | 'rain' | 'ndvi' | 'condition';
export const PREDICTORS: Predictor[] = ['temp', 'rain', 'ndvi', 'condition'];
export const PREDICTOR_NAME: Record<Predictor, string> = {
  temp: 'Temperature since June 1',
  rain: 'Rain since May 1',
  ndvi: 'Satellite NDVI, last 30 days',
  condition: 'Crop condition rating',
};

export interface Observed {
  year: number;
  /** Mean daily temperature from June 1 to the forecast date, minus normal, °C. */
  temp: number;
  /** Rain from May 1 to the forecast date, minus normal, inches. */
  rain: number;
  /** Mean of the clear satellite NDVI readings in the 30 days before the date (or the latest clear one before). */
  ndvi: number;
  /**
   * A crop condition rating, 0–100: scouts' judgment of how well the crop is doing over the past
   * three weeks — how free of water stress and disease — with the noise of human judgment.
   */
  condition: number;
  /** The season's final yield, bushels per acre. */
  yield: number;
}

const obsCache = new Map<string, Observed>();

/** What a forecaster could observe about a district's corn on `date` of simulated year `year`, and how it turned out. */
export function observe(year: number, date: number, district: DistrictId = 'prairie'): Observed {
  const k = `${year}|${date}|${district}`;
  let o = obsCache.get(k);
  if (!o) {
    const w = simulatedYear(year, district);
    const n = normalYear(district);
    const r = fieldSeason(year, { district, crop: 'corn' });
    let t = 0;
    let tn = 0;
    let cnt = 0;
    for (let d = dayOf(6, 1); d < date; d++) {
      t += (w[d].tmax + w[d].tmin) / 2;
      tn += (n[d].tmax + n[d].tmin) / 2;
      cnt++;
    }
    let rain = 0;
    let rainN = 0;
    for (let d = dayOf(5, 1); d < date; d++) {
      rain += w[d].rain;
      rainN += n[d].rain;
    }
    const passes = satellitePasses(seasonNdvi(r), w, 5, 0.3, 9100 + year, dayOf(5, 1), date - 1);
    const recent = passes.filter((p) => p.day >= date - 30 && p.value !== null).map((p) => p.value as number);
    const any = passes.filter((p) => p.value !== null);
    const ndvi = recent.length ? recent.reduce((s, x) => s + x, 0) / recent.length : any.length ? (any[any.length - 1].value as number) : 0.2;
    const recentDays = r.days.filter((x) => x.day >= date - 21 && x.day < date);
    const health = recentDays.length ? recentDays.reduce((s, x) => s + x.ks * (1 - x.disease) * Math.min(1, x.ft + 0.2), 0) / recentDays.length : 1;
    const rr = rng(4400 + year * 7 + date);
    const noise = (rr() + rr() + rr() - 1.5) * 0.08;
    const condition = Math.max(0, Math.min(100, 100 * (health + noise)));
    o = { year, temp: cnt ? (t - tn) / cnt : 0, rain: rain - rainN, ndvi, condition, yield: r.yield };
    obsCache.set(k, o);
  }
  return o;
}

export interface Fit {
  predictors: Predictor[];
  /** Intercept first, then one coefficient per predictor. */
  coef: number[];
  predict: (o: Observed) => number;
  /** Root-mean-square error on the seasons it was fitted to, and on seasons it never saw. */
  rmseTrain: number;
  rmseTest: number;
  /** Share of the test seasons’ variance explained. */
  r2Test: number;
}

/** Solves A x = b by Gaussian elimination with partial pivoting (small systems). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-12));
}

/** Ordinary least squares of yield on the chosen predictors over `train` seasons, judged on `test` seasons. */
export function fitForecast(train: Observed[], test: Observed[], predictors: Predictor[]): Fit {
  const row = (o: Observed) => [1, ...predictors.map((p) => o[p])];
  const k = predictors.length + 1;
  const XtX = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const Xty = Array<number>(k).fill(0);
  for (const o of train) {
    const x = row(o);
    for (let i = 0; i < k; i++) {
      Xty[i] += x[i] * o.yield;
      for (let j = 0; j < k; j++) XtX[i][j] += x[i] * x[j];
    }
  }
  const coef = solve(XtX, Xty);
  const predict = (o: Observed) => row(o).reduce((s, x, i) => s + x * coef[i], 0);
  const rmse = (set: Observed[]) => Math.sqrt(set.reduce((s, o) => s + (predict(o) - o.yield) ** 2, 0) / set.length);
  const meanTest = test.reduce((s, o) => s + o.yield, 0) / test.length;
  const ssTot = test.reduce((s, o) => s + (o.yield - meanTest) ** 2, 0);
  const ssRes = test.reduce((s, o) => s + (predict(o) - o.yield) ** 2, 0);
  return { predictors, coef, predict, rmseTrain: rmse(train), rmseTest: rmse(test), r2Test: 1 - ssRes / ssTot };
}

/** Seasons 1–100 to fit on and 101–200 to test on, observed on `date`. */
export function forecastSets(date: number, district: DistrictId = 'prairie'): { train: Observed[]; test: Observed[] } {
  return {
    train: Array.from({ length: 100 }, (_, i) => observe(i + 1, date, district)),
    test: Array.from({ length: 100 }, (_, i) => observe(i + 101, date, district)),
  };
}
