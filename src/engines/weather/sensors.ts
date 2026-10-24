// What a faulty thermometer records. Builds on the station's true hourly curve (station.ts) and
// times each fault the way it happens: a missing radiation shield lets sunlight heat the sensor
// (worst at midday on clear days); a heat source such as nearby paving gives back the day's
// stored heat at night, building up after sunset and fading in the hours after sunrise; and a
// drifting calibration adds the same offset to every reading. The station's day is reported as
// (max + min) / 2 of whatever the sensor read.

import { DAYS, YEARS, dayInfo, monthDays } from '../../model/weather/archive';
import { heatIslandWeight, stationDay, sunTimes, type StationDay } from './station';

export { heatIslandWeight, sunTimes };

export interface Faults {
  /** Warming of an unshielded sensor in full sun, °F. */
  unshielded: number;
  /** Warmth released at night by a heat source next to the sensor, at full strength, °F. */
  heatIsland: number;
  /** Calibration offset, °F. */
  drift: number;
}

export const NO_FAULTS: Faults = { unshielded: 0, heatIsland: 0, drift: 0 };

const cache = new Map<number, StationDay>();
/** The station's true day, kept for the session. */
export function trueDay(d: number): StationDay {
  let v = cache.get(d);
  if (!v) {
    v = stationDay(Math.max(0, Math.min(DAYS - 1, d)));
    if (cache.size > 20000) cache.clear();
    cache.set(d, v);
  }
  return v;
}

/** The sensor's 24 hourly readings, °F. */
export function readCurve(day: StationDay, f: Faults): number[] {
  const { doy } = dayInfo(day.d);
  return day.hours.map((o) => o.trueF + f.unshielded * o.sun + f.heatIsland * heatIslandWeight(o.hour, doy) + f.drift);
}

export interface Recorded {
  max: number;
  min: number;
  /** (max + min) / 2, °F. */
  mean: number;
}

export function recorded(day: StationDay, f: Faults): Recorded {
  const r = readCurve(day, f);
  const max = Math.max(...r);
  const min = Math.min(...r);
  return { max, min, mean: (max + min) / 2 };
}

/** Average error in the recorded max, min and daily mean over every day of a month in all the archive's years, °F. */
export function monthBias(month: number, f: Faults): Recorded {
  let sMax = 0;
  let sMin = 0;
  let sMean = 0;
  let n = 0;
  for (let y = 1; y <= YEARS; y++) {
    const { start, days } = monthDays(y, month);
    for (let i = 0; i < days; i++) {
      const day = trueDay(start + i);
      const r = recorded(day, f);
      sMax += r.max - day.trueMax;
      sMin += r.min - day.trueMin;
      sMean += r.mean - day.officialMeanF;
      n++;
    }
  }
  return { max: sMax / n, min: sMin / n, mean: sMean / n };
}
