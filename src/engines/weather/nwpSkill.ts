// Forecast skill of the miniature weather model (nwp.ts), averaged over many weather situations.
// One forecast is a single throw of the dice; skill is what happens on average. For each of many
// random truths, the model starts from its analysis of the observations and carries it east with
// the wind; the error at Fenwick Bay is compared, lead by lead, with the error of knowing nothing
// (forecasting no anomaly at all).

import { FENWICK_I, DX_KM, NX, analysis, observationSites, truthField, truthWaves, type Wave } from './nwp';

/** The true anomaly at one grid point — the same sum of waves as truthField, evaluated at a single point. */
export function truthAt(waves: Wave[], i: number, tDays: number, windMs: number, evolution: number): number {
  const shiftCells = (windMs * 86400 * tDays) / 1000 / DX_KM;
  let v = 0;
  for (const w of waves) {
    const amp = w.amp * Math.exp(evolution * w.growth * tDays);
    const ph = w.phase + evolution * w.drift * tDays;
    v += amp * Math.sin((2 * Math.PI * w.k * (i - shiftCells)) / NX + ph);
  }
  return v;
}

/** Grid cells the wind carries the air in a day. */
export function cellsPerDay(windMs: number): number {
  return (windMs * 86400) / 1000 / DX_KM;
}

/** Where the air that reaches Fenwick Bay `lead` days from now is at the start: a grid index, 0–359. */
export function upstreamIndex(lead: number, windMs: number): number {
  const j = FENWICK_I - cellsPerDay(windMs) * lead;
  return ((j % NX) + NX) % NX;
}

export interface SkillCurve {
  /** Lead times, days. */
  leads: number[];
  /** Root-mean-square forecast error at Fenwick Bay, °F. */
  rms: number[];
  /** Root-mean-square error of forecasting no anomaly at all (the size of the weather itself), °F. */
  none: number[];
}

/**
 * Forecast error at Fenwick Bay by lead, over `cases` random weather situations (seeds 1…cases),
 * with observations every `land` grid points over land and every `ocean` over the ocean (0 = none).
 */
export function forecastSkill(opts: { land: number; ocean: number; windMs: number; evolution: number; days?: number; step?: number; cases?: number }): SkillCurve {
  const days = opts.days ?? 10;
  const step = opts.step ?? 0.5;
  const cases = opts.cases ?? 40;
  const leads: number[] = [];
  for (let l = 0; l <= days + 1e-9; l += step) leads.push(Math.round(l * 1000) / 1000);
  const se = new Array(leads.length).fill(0);
  const s0 = new Array(leads.length).fill(0);
  const sites = observationSites(opts.land, opts.ocean);
  for (let c = 1; c <= cases; c++) {
    const waves = truthWaves(c);
    const an = analysis(truthField(waves, 0, opts.windMs, opts.evolution), sites);
    leads.forEach((lead, k) => {
      const j = upstreamIndex(lead, opts.windMs);
      const j0 = Math.floor(j);
      const fr = j - j0;
      const forecast = an[j0] * (1 - fr) + an[(j0 + 1) % NX] * fr;
      const truth = truthAt(waves, FENWICK_I, lead, opts.windMs, opts.evolution);
      se[k] += (forecast - truth) ** 2;
      s0[k] += truth * truth;
    });
  }
  return { leads, rms: se.map((v) => Math.sqrt(v / cases)), none: s0.map((v) => Math.sqrt(v / cases)) };
}
