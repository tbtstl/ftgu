// A weather station's day, hour by hour, built around the archive's daily record for Calder Bay.
// The archive's daily temperature is the station's official daily mean, (max + min) / 2, as US
// weather contracts define it; the hourly curve is shaped and shifted so it reproduces that
// value exactly. Instrument problems — an unshielded sensor, a hot surface nearby, drift — are
// layered on top, to show what they do to the readings a contract would settle on.

import { archive, dayInfo, tempF } from '../../model/weather/archive';
import { rng, gaussian } from '../../model/random';

export interface SensorFaults {
  /** No radiation shield: sunlight heats the sensor on clear days, up to this much at noon, °F. */
  unshielded?: number;
  /** Paving or a building nearby: warmth given back at night, building after sunset and fading after sunrise, °F at full strength. */
  heatIsland?: number;
  /** Calibration drift: a constant offset, °F. */
  drift?: number;
}

export interface StationHourObs {
  hour: number;
  /** What the air was, °F. */
  trueF: number;
  /** What the sensor read, °F. */
  readF: number;
  dewF: number;
  /** Relative humidity from the true temperature and the dew point, 0–1. */
  rh: number;
  pressureHpa: number;
  windMs: number;
  /** Direction the wind blows from, degrees. */
  windFrom: number;
  rainIn: number;
  /** Sunshine at the sensor, 0–1 (sun height times clear sky). */
  sun: number;
}

export interface StationDay {
  d: number;
  hours: StationHourObs[];
  /** The archive's official daily mean, (max + min) / 2 of the true air, °F. */
  officialMeanF: number;
  /** Average of the 24 hourly true temperatures, °F. */
  hourlyMeanF: number;
  trueMax: number;
  trueMin: number;
  /** Max and min the faulty sensor recorded, and the daily mean it would report, °F. */
  readMax: number;
  readMin: number;
  readMeanF: number;
  rainIn: number;
  /** Share of the sky that's cloudy, 0–1. */
  cloud: number;
}

/** Daily pressure, a persistent series of its own: lower on wet days. */
let pressureCache: Float64Array | null = null;
function dailyPressure(d: number): number {
  if (!pressureCache) {
    const a = archive();
    const r = rng(31415);
    const n = a.z.length;
    pressureCache = new Float64Array(n);
    let x = 0;
    for (let i = 0; i < n; i++) {
      x = 0.7 * x + Math.sqrt(1 - 0.49) * gaussian(r);
      pressureCache[i] = 1016 + 6 * x - (a.rain.calder[i] > 0.05 ? 7 : 0);
    }
  }
  const i = Math.max(0, Math.min(pressureCache.length - 1, d));
  return pressureCache[i];
}

/** Diurnal shape, −1 at the 06:00 minimum to +1 at the 15:00 maximum. */
export function diurnalShape(h: number): number {
  // Warming from 06:00 to 15:00 (9 h), cooling from 15:00 to 06:00 (15 h).
  const x = ((h - 6) % 24 + 24) % 24;
  return x <= 9 ? -Math.cos((Math.PI * x) / 9) : Math.cos((Math.PI * (x - 9)) / 15);
}

/** Sun height at Calder Bay's latitude on a day of the year, as a share of noon's on the summer solstice, 0–1. */
export function sunAt(doy: number, h: number): number {
  const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
  const lat = 41;
  const hourAngle = (h - 12) * 15;
  const r = Math.PI / 180;
  const sinElev = Math.sin(lat * r) * Math.sin(decl * r) + Math.cos(lat * r) * Math.cos(decl * r) * Math.cos(hourAngle * r);
  const noonMax = Math.sin((90 - lat + 23.44) * r);
  return Math.max(0, sinElev / noonMax);
}

/** Sunrise and sunset at Calder Bay's 41° north, hours of local solar time. */
export function sunTimes(doy: number, lat = 41): { sunrise: number; sunset: number } {
  const r = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
  const c = Math.max(-1, Math.min(1, -Math.tan(lat * r) * Math.tan(decl * r)));
  const half = Math.acos(c) / r / 15;
  return { sunrise: 12 - half, sunset: 12 + half };
}

/**
 * How much of a heat source's warmth reaches the sensor at clock hour h: nothing by day, building
 * steadily for four hours after sunset, and fading out over the two hours after sunrise.
 */
export function heatIslandWeight(h: number, doy: number): number {
  const { sunrise, sunset } = sunTimes(doy);
  const build = (sinceSunset: number) => Math.max(0, Math.min(1, sinceSunset / 4));
  if (h >= sunset) return build(h - sunset);
  if (h < sunrise) return build(h + 24 - sunset);
  const atDawn = build(sunrise + 24 - sunset);
  return Math.max(0, atDawn * (1 - (h - sunrise) / 2));
}

/** The station's day: hourly true air, sensor readings, humidity, pressure, wind and rain. */
export function stationDay(d: number, faults: SensorFaults = {}): StationDay {
  const a = archive();
  const { doy } = dayInfo(d);
  const official = tempF('calder', d);
  const prev = tempF('calder', Math.max(0, d - 1));
  const next = tempF('calder', Math.min(a.z.length - 1, d + 1));
  const rain = a.rain.calder[d];
  const cloud = Math.min(1, rain > 0.05 ? 0.9 : 0.3 + 0.2 * Math.abs(a.z[d]) * 0.5);
  // A clear day swings ±9 °F around its mean, a cloudy one much less.
  const amp = 9 * (1 - 0.65 * cloud);
  const trend = (next - prev) / 2;
  const raw = Array.from({ length: 24 }, (_, h) => trend * ((h - 11.5) / 24) + amp * diurnalShape(h));
  const rmax = Math.max(...raw);
  const rmin = Math.min(...raw);
  const shift = official - (rmax + rmin) / 2;
  const trueT = raw.map((v) => v + shift);
  const spread = rain > 0.05 ? 2 : 6 + 6 * (1 - cloud);
  const dew = official - spread - amp * 0.4;
  const p0 = dailyPressure(d);
  const p1 = dailyPressure(d + 1);
  const ridgeWind = a.wind[d];
  const windFrom = trend > 1.5 ? 220 : trend < -1.5 ? 315 : 270;
  // Spread the day's rain over a block of hours.
  const rainHours = rain > 0 ? Math.max(1, Math.min(12, Math.round(rain * 10))) : 0;
  const rainStart = (d * 7) % Math.max(1, 24 - rainHours);
  const hours: StationHourObs[] = trueT.map((t, h) => {
    const sun = sunAt(doy, h + 0.5) * (1 - 0.8 * cloud);
    const readF = t + (faults.unshielded ?? 0) * sun + (faults.heatIsland ?? 0) * heatIslandWeight(h, doy) + (faults.drift ?? 0);
    const es = (tf: number) => 6.112 * Math.exp((17.67 * ((tf - 32) * 5) / 9) / (((tf - 32) * 5) / 9 + 243.5));
    const dewH = Math.min(dew, t);
    return {
      hour: h,
      trueF: t,
      readF,
      dewF: dewH,
      rh: es(dewH) / es(t),
      pressureHpa: p0 + ((p1 - p0) * h) / 24 + 0.5 * Math.cos((2 * Math.PI * (h - 10)) / 12),
      windMs: 0.7 * ridgeWind * (0.8 + 0.4 * Math.max(0, diurnalShape(h))),
      windFrom,
      rainIn: rainHours && h >= rainStart && h < rainStart + rainHours ? rain / rainHours : 0,
      sun,
    };
  });
  const reads = hours.map((x) => x.readF);
  const readMax = Math.max(...reads);
  const readMin = Math.min(...reads);
  return {
    d,
    hours,
    officialMeanF: official,
    hourlyMeanF: trueT.reduce((s, v) => s + v, 0) / 24,
    trueMax: Math.max(...trueT),
    trueMin: Math.min(...trueT),
    readMax,
    readMin,
    readMeanF: (readMax + readMin) / 2,
    rainIn: rain,
    cloud,
  };
}

/** Heating degree days over a run of days from a station's (max + min) / 2, base 65 °F. */
export function hddFromMeans(means: number[], base = 65): number {
  return means.reduce((s, m) => s + Math.max(0, base - m), 0);
}
