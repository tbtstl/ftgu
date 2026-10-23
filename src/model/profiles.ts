// Hourly shapes for demand and weather on a typical day in the course region (hour 0 = midnight).

import type { Hourly, LoadKind } from './types';

/** Region-wide demand on the reference day, MW. Peak 1,440 MW at 19:00. */
export const SYSTEM_DEMAND: Hourly = [
  840, 795, 765, 750, 758, 810, 915, 1035, 1110, 1140, 1155, 1163, 1155, 1148, 1155, 1178, 1230, 1320, 1410, 1440, 1380, 1260, 1095, 945,
];

/** Wind capacity factor (share of nameplate) on the reference day: windier at night. */
export const WIND_CF: Hourly = [
  0.45, 0.475, 0.49, 0.49, 0.49, 0.46, 0.425, 0.375, 0.325, 0.29, 0.26, 0.25, 0.24, 0.24, 0.25, 0.275, 0.3, 0.34, 0.375, 0.4, 0.425, 0.44, 0.45, 0.45,
];

/** Solar capacity factor on the reference day (clear spring day). */
export const SOLAR_CF: Hourly = [
  0, 0, 0, 0, 0, 0, 0.02, 0.15, 0.34, 0.54, 0.7, 0.81, 0.85, 0.85, 0.79, 0.62, 0.42, 0.2, 0.05, 0, 0, 0, 0, 0,
];

/** Normalized (peak = 1) daily shapes by customer type. */
export const LOAD_SHAPE: Record<LoadKind, Hourly> = {
  residential: [0.55, 0.5, 0.47, 0.46, 0.47, 0.52, 0.64, 0.74, 0.72, 0.66, 0.63, 0.62, 0.62, 0.62, 0.64, 0.68, 0.76, 0.88, 0.97, 1.0, 0.96, 0.87, 0.75, 0.63],
  commercial: [0.45, 0.43, 0.42, 0.42, 0.43, 0.47, 0.58, 0.75, 0.9, 0.97, 1.0, 1.0, 0.99, 0.99, 0.98, 0.95, 0.9, 0.8, 0.68, 0.6, 0.55, 0.52, 0.49, 0.47],
  industrial: [0.82, 0.8, 0.8, 0.8, 0.8, 0.82, 0.88, 0.95, 0.98, 1.0, 1.0, 1.0, 0.98, 0.99, 1.0, 1.0, 0.98, 0.95, 0.92, 0.9, 0.88, 0.86, 0.84, 0.83],
  dataCenter: [0.93, 0.92, 0.92, 0.91, 0.91, 0.92, 0.93, 0.95, 0.97, 0.98, 0.99, 1.0, 1.0, 1.0, 1.0, 1.0, 0.99, 0.98, 0.97, 0.96, 0.95, 0.95, 0.94, 0.93],
};

export const LOAD_LABEL: Record<LoadKind, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  dataCenter: 'Data centers',
};

/** A typical home's hourly use on the reference day, kWh per hour (about 30 kWh/day). */
export const HOME_LOAD_KW: Hourly = [
  0.7, 0.6, 0.55, 0.55, 0.55, 0.65, 0.95, 1.35, 1.2, 1.0, 0.95, 0.95, 1.0, 1.0, 1.05, 1.2, 1.55, 2.0, 2.35, 2.4, 2.2, 1.8, 1.3, 0.9,
];

/** Scale a normalized shape to a peak value. */
export function scaled(shape: Hourly, peak: number): Hourly {
  return shape.map((v) => v * peak);
}

/** Element-wise sum of hourly series. */
export function sumHourly(...series: Hourly[]): Hourly {
  return Array.from({ length: series[0]?.length ?? 24 }, (_, h) => series.reduce((s, x) => s + (x[h] ?? 0), 0));
}

/** Total energy of an hourly MW series, MWh. */
export function energy(series: Hourly): number {
  return series.reduce((s, v) => s + v, 0);
}
