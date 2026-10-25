// A forecasting competition: several forecasters issue a probability forecast for each day's
// mean temperature at the settlement station, `lead` days ahead, and are scored against what
// happened with the CRPS of Lesson 3.5. Every forecast uses only what was known on its issue day.
//
//   climate      the normal for the date (with the trend), with the climate's spread
//   persistence  today's departure from normal, decaying toward the normal with the lead
//   raw model    the weather model's forecast with a spread only 0.6 as wide as its errors
//   model        the weather model's forecast, calibrated
//   yours        a blend of the model and the climate, with your own spread and bias

import { dayInfo, expectedTemp, forecastTemp, knownShare, monthDays, tempF, climateFor, type WorldKnobs } from '../../model/weather/archive';
import { anomalySd } from '../../model/weather/region';
import { crpsNormal } from './verify';

export type ForecasterId = 'climate' | 'persistence' | 'raw' | 'model' | 'yours';

export const FORECASTER_LABEL: Record<ForecasterId, string> = {
  climate: 'Climate',
  persistence: 'Persistence',
  raw: 'Raw model',
  model: 'Calibrated model',
  yours: 'Yours',
};

/** Day-to-day persistence of the departure from normal, used by the persistence forecaster. */
export const PERSISTENCE = 0.66;

export interface YourForecaster {
  /** Weight on the model's forecast against the climate, 0–1. */
  blend: number;
  /** Multiplies the model's spread. */
  spread: number;
  /** Added to the forecast, °F. */
  bias: number;
}

export interface DayForecasts {
  d: number;
  outcome: number;
  forecasts: Record<ForecasterId, { mean: number; sd: number }>;
}

/** Every forecaster's forecast for day d, issued `lead` days earlier. */
export function dayForecasts(d: number, lead: number, knobs: WorldKnobs, yours: YourForecaster): DayForecasts {
  const cl = climateFor('fenwick', knobs);
  const info = dayInfo(d);
  const climSd = anomalySd(cl, info.doy) * (knobs.variability ?? 1);
  const normal = expectedTemp('fenwick', d, knobs);
  const issue = d - lead;
  const today = tempF('fenwick', issue, knobs) - expectedTemp('fenwick', issue, knobs);
  const decay = PERSISTENCE ** lead;
  const m = forecastTemp('fenwick', d, lead, knobs);
  const climate = { mean: normal, sd: climSd };
  // Error of a blend b·M + (1 − b)·C: the model's own error plus (1 − b) of the forecast anomaly it
  // throws away, whose variance is the known share of the climate's.
  const blendSd = Math.sqrt(m.sd ** 2 + (1 - yours.blend) ** 2 * climSd * climSd * knownShare(lead));
  return {
    d,
    outcome: tempF('fenwick', d, knobs),
    forecasts: {
      climate,
      persistence: { mean: normal + today * decay, sd: climSd * Math.sqrt(1 - decay * decay) },
      raw: { mean: m.mean, sd: m.sd * 0.6 },
      model: m,
      yours: { mean: yours.blend * m.mean + (1 - yours.blend) * normal + yours.bias, sd: Math.max(0.1, blendSd * yours.spread) },
    },
  };
}

export interface MonthScores {
  days: DayForecasts[];
  /** Mean CRPS by forecaster, °F (lower is better). */
  crps: Record<ForecasterId, number>;
  /** Skill against the climate: 1 − CRPS / CRPS(climate). */
  skill: Record<ForecasterId, number>;
}

const IDS: ForecasterId[] = ['climate', 'persistence', 'raw', 'model', 'yours'];

/** Score every forecaster over the first `upTo` days of a month (all of it by default). */
export function scoreMonth(year: number, month: number, lead: number, knobs: WorldKnobs, yours: YourForecaster, upTo?: number): MonthScores {
  const { start, days } = monthDays(year, month);
  const n = Math.max(0, Math.min(days, upTo ?? days));
  const list: DayForecasts[] = [];
  for (let i = 0; i < n; i++) list.push(dayForecasts(start + i, lead, knobs, yours));
  const crps = Object.fromEntries(IDS.map((id) => [id, 0])) as Record<ForecasterId, number>;
  for (const day of list) for (const id of IDS) crps[id] += crpsNormal(day.forecasts[id].mean, day.forecasts[id].sd, day.outcome) / Math.max(1, n);
  const skill = Object.fromEntries(IDS.map((id) => [id, crps.climate > 0 ? 1 - crps[id] / crps.climate : 0])) as Record<ForecasterId, number>;
  return { days: list, crps, skill };
}

/** Scores over many months, for a steadier verdict than one month gives. */
export function scoreSeason(years: number[], months: number[], lead: number, knobs: WorldKnobs, yours: YourForecaster): Record<ForecasterId, number> {
  const tot = Object.fromEntries(IDS.map((id) => [id, 0])) as Record<ForecasterId, number>;
  let n = 0;
  for (const y of years)
    for (const m of months) {
      const s = scoreMonth(y, m, lead, knobs, yours);
      for (const id of IDS) tot[id] += s.crps[id] * s.days.length;
      n += s.days.length;
    }
  for (const id of IDS) tot[id] /= Math.max(1, n);
  return tot;
}
