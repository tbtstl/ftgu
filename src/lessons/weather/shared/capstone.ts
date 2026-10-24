// The weather capstone's shared state: the reader's region (6.1), forecaster (6.2), business
// (6.3) and trading desk (6.4), carried from lesson to lesson and replayed in 6.5. Kept only in the
// reader's browser; storage can be unavailable, so every access is guarded and the lessons work
// without it.

import { useSyncExternalStore } from 'react';
import type { WorldKnobs } from '../../../model/weather/archive';
import { STATIONS, climateOf, type Climate } from '../../../model/weather/region';

export interface RegionSettings {
  /** The settlement city's latitude, degrees north. */
  latitude: number;
  /** 0 = wind off the sea; 1 = deep in a continent. */
  continentality: number;
  /** Meters above sea level. */
  elevation: number;
  /** Winter warming per °C of Niño-3.4, °F. */
  ensoF: number;
  /** Multiplies the day-to-day variability. */
  variability: number;
  /** Warming per year, °F. */
  trend: number;
}

/** The starting region is Calder Bay itself. */
export const REGION_DEFAULTS: RegionSettings = {
  latitude: STATIONS.calder.latitude,
  continentality: STATIONS.calder.continentality,
  elevation: STATIONS.calder.elevation,
  ensoF: STATIONS.calder.ensoF ?? 1,
  variability: 1,
  trend: 0.03,
};

export interface ForecasterSettings {
  /** Weight on the weather model's forecast against the climate, 0–1. */
  blend: number;
  /** Multiplies the model's forecast spread. */
  spread: number;
  /** Added to every forecast, °F. */
  bias: number;
}

export const FORECASTER_DEFAULTS: ForecasterSettings = { blend: 1, spread: 1, bias: 0 };

export type BusinessKind = 'utility' | 'wind' | 'farm';

export interface BusinessSettings {
  kind: BusinessKind;
  /** Multiplies the business's size. */
  scale: number;
}

export const BUSINESS_DEFAULTS: BusinessSettings = { kind: 'utility', scale: 1 };

export interface DeskSettings {
  /** Seasonal HDD strips sold on October 31 to hedge the utility. */
  hedgeStrips: number;
  /** Months traded (0 = January, 1 = February, 11 = December). */
  months: number[];
  /** Days before each month the trade is decided. */
  lead: number;
  /** Gap beyond the spread needed to trade, index points. */
  threshold: number;
  /** Contracts per trade. */
  size: number;
}

export const DESK_DEFAULTS: DeskSettings = { hedgeStrips: 0, months: [11, 0, 1], lead: 60, threshold: 5, size: 10 };

export interface WeatherCapstone {
  region: RegionSettings;
  forecaster: ForecasterSettings;
  business: BusinessSettings;
  desk: DeskSettings;
}

export const CAPSTONE_DEFAULTS: WeatherCapstone = {
  region: REGION_DEFAULTS,
  forecaster: FORECASTER_DEFAULTS,
  business: BUSINESS_DEFAULTS,
  desk: DESK_DEFAULTS,
};

const KEY = 'ground-up.weather.capstone.v1';
let cache: WeatherCapstone | null = null;
const listeners = new Set<() => void>();

function num(x: unknown, lo: number, hi: number, dflt: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
}

/** Fill in and clamp anything missing or out of range in a stored state. */
export function sanitize(raw: unknown): WeatherCapstone {
  const r = (raw ?? {}) as Partial<WeatherCapstone>;
  const g = (r.region ?? {}) as Partial<RegionSettings>;
  const f = (r.forecaster ?? {}) as Partial<ForecasterSettings>;
  const b = (r.business ?? {}) as Partial<BusinessSettings>;
  const d = (r.desk ?? {}) as Partial<DeskSettings>;
  return {
    region: {
      latitude: num(g.latitude, 25, 60, REGION_DEFAULTS.latitude),
      continentality: num(g.continentality, 0, 1, REGION_DEFAULTS.continentality),
      elevation: num(g.elevation, 0, 2000, REGION_DEFAULTS.elevation),
      ensoF: num(g.ensoF, 0, 4, REGION_DEFAULTS.ensoF),
      variability: num(g.variability, 0.25, 2.5, REGION_DEFAULTS.variability),
      trend: num(g.trend, -0.1, 0.2, REGION_DEFAULTS.trend),
    },
    forecaster: {
      blend: num(f.blend, 0, 1, FORECASTER_DEFAULTS.blend),
      spread: num(f.spread, 0.2, 3, FORECASTER_DEFAULTS.spread),
      bias: num(f.bias, -10, 10, FORECASTER_DEFAULTS.bias),
    },
    business: {
      kind: b.kind === 'wind' || b.kind === 'farm' ? b.kind : 'utility',
      scale: num(b.scale, 0.1, 5, BUSINESS_DEFAULTS.scale),
    },
    desk: {
      hedgeStrips: num(d.hedgeStrips, 0, 20000, DESK_DEFAULTS.hedgeStrips),
      months: Array.isArray(d.months) ? d.months.filter((m) => m === 11 || m === 0 || m === 1 || m === 2 || m === 10) : DESK_DEFAULTS.months,
      lead: num(d.lead, -20, 120, DESK_DEFAULTS.lead),
      threshold: num(d.threshold, 0, 200, DESK_DEFAULTS.threshold),
      size: num(d.size, 0, 500, DESK_DEFAULTS.size),
    },
  };
}

function read(): WeatherCapstone {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : CAPSTONE_DEFAULTS;
  } catch {
    cache = CAPSTONE_DEFAULTS;
  }
  return cache;
}

function write(s: WeatherCapstone) {
  cache = s;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // The capstone lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The capstone state, shared by every capstone lesson and kept between visits. */
export function useWeatherCapstone(): WeatherCapstone {
  return useSyncExternalStore(subscribe, read, () => CAPSTONE_DEFAULTS);
}

export function getWeatherCapstone(): WeatherCapstone {
  return read();
}

/** Change part of the state: e.g. updateCapstone('region', { latitude: 45 }). */
export function updateCapstone<K extends keyof WeatherCapstone>(part: K, patch: Partial<WeatherCapstone[K]>) {
  const s = read();
  write({ ...s, [part]: { ...s[part], ...patch } });
}

/** Put one part (or all) back to its starting values. */
export function resetCapstone(part?: keyof WeatherCapstone) {
  if (!part) write(CAPSTONE_DEFAULTS);
  else write({ ...read(), [part]: CAPSTONE_DEFAULTS[part] });
}

/** The region's climate. */
export function regionClimate(r: RegionSettings): Climate {
  return climateOf({ latitude: r.latitude, continentality: r.continentality, elevation: r.elevation, ensoF: r.ensoF });
}

/** The archive knobs that make the course's engines run in the reader's region. */
export function regionKnobs(r: RegionSettings): WorldKnobs {
  return { climate: regionClimate(r), ensoF: r.ensoF, variability: r.variability, trend: r.trend };
}

/** Whether the region is still Calder Bay's. */
export function isCalder(r: RegionSettings): boolean {
  return (Object.keys(REGION_DEFAULTS) as Array<keyof RegionSettings>).every((k) => Math.abs(r[k] - REGION_DEFAULTS[k]) < 1e-9);
}
