// The weather course's fictional world: the Calder region, on the east coast of a mid-latitude
// continent at about 41°N, where the prevailing westerlies arrive over land. Its port city,
// Calder Bay, is where the course's weather contracts settle; the plains around Marlow grow corn;
// the wind farm sits on Hollin Ridge. Every station's climate comes from one small set of rules
// (latitude, distance from the sea, elevation), so a reader can build a new station in the same
// world and get a climate that behaves like the others.
//
// Station temperatures are in °F, as US weather contracts count them; the physics lessons work in
// °C and kelvins. Years have 365 days: the model ignores leap days.

export const LATITUDE = 41;

/** Days in each month of a 365-day year. */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Day of year (0 = January 1) on which each month starts. */
export const MONTH_START: number[] = MONTH_DAYS.map((_, i) => MONTH_DAYS.slice(0, i).reduce((a, b) => a + b, 0));

/** Month (0–11) of a day of the year (0–364). */
export function monthOf(dayOfYear: number): number {
  const d = ((Math.floor(dayOfYear) % 365) + 365) % 365;
  for (let m = 11; m >= 0; m--) if (d >= MONTH_START[m]) return m;
  return 0;
}

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
/** A temperature difference in °F, as °C. */
export const dfToDc = (df: number) => (df * 5) / 9;

/** The rules that set a station's climate. */
export interface ClimateInput {
  /** Degrees north. */
  latitude: number;
  /**
   * 0 = a coast where the prevailing wind blows in off the sea; 1 = deep in a continent's
   * interior. Calder Bay is on a coast, but the westerlies reach it over land, so it's 0.8.
   */
  continentality: number;
  /** Meters above sea level. */
  elevation: number;
  /** Winter (December–February) warming per °C of the Niño-3.4 index, °F. */
  ensoF?: number;
}

/** What those rules give: the shape of a station's year, in °F. */
export interface Climate {
  /** Average of the daily mean temperature over the year, °F. */
  annualMean: number;
  /** Half the difference between the warmest and coldest days of the normal year, °F. */
  amplitude: number;
  /** Day of the year (0 = January 1) of the normal year's coldest day. */
  coldestDay: number;
  /** Standard deviation of the daily mean's departure from normal in midwinter and midsummer, °F. */
  winterSd: number;
  summerSd: number;
  ensoF: number;
}

/** Temperature falls about 6.5 °C per km of height in the lower atmosphere: 11.7 °F per km. */
export const LAPSE_F_PER_KM = 11.7;

/** A station's climate from its latitude, continentality and elevation. */
export function climateOf(c: ClimateInput): Climate {
  const lat = Math.abs(c.latitude);
  const k = Math.max(0, Math.min(1, c.continentality));
  // Annual mean at sea level: about 27 °C at the equator, falling with the square of latitude.
  const seaLevelC = 27 - 0.0088 * lat * lat;
  const annualMean = cToF(seaLevelC) - (LAPSE_F_PER_KM * c.elevation) / 1000;
  // The seasonal swing grows with latitude, and the sea damps it.
  const amplitude = 1.8 * lat * (0.08 + 0.27 * k);
  // Oceans store heat, so a maritime station's coldest day comes later.
  const coldestDay = 16 + 25 * (1 - k);
  // Day-to-day variability: largest in a mid-latitude continental winter.
  const winterSd = lat * (0.1 + 0.12 * k);
  return { annualMean, amplitude, coldestDay, winterSd, summerSd: winterSd * 0.55, ensoF: c.ensoF ?? 0 };
}

/** The normal (long-run average) daily mean temperature on a day of the year, °F. */
export function normalTemp(cl: Climate, dayOfYear: number): number {
  return cl.annualMean - cl.amplitude * Math.cos((2 * Math.PI * (dayOfYear - cl.coldestDay)) / 365);
}

/**
 * Standard deviation of the daily mean's departure from normal on a day of the year, °F:
 * midwinter's value on the coldest day, midsummer's half a year later, and a smooth blend between.
 */
export function anomalySd(cl: Climate, dayOfYear: number): number {
  const w = 0.5 + 0.5 * Math.cos((2 * Math.PI * (dayOfYear - cl.coldestDay)) / 365);
  return cl.summerSd + (cl.winterSd - cl.summerSd) * w;
}

/** Weight of the ENSO signal in each month: full in December–February, half in November and March. */
export const ENSO_MONTH_WEIGHT = [1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 1] as const;

export interface Station extends ClimateInput {
  id: StationId;
  name: string;
  /** What the station is for in the course. */
  role: string;
  /** Position on the region map (600 × 400; 1 unit ≈ 1 km). */
  x: number;
  y: number;
}

export type StationId = 'calder' | 'marlow' | 'ridge';

/** The region's three weather stations. */
export const STATIONS: Record<StationId, Station> = {
  calder: {
    id: 'calder',
    name: 'Calder Bay',
    role: 'The port city’s airport station. The course’s degree-day contracts settle on its readings.',
    latitude: 41,
    continentality: 0.8,
    elevation: 10,
    ensoF: 1.0,
    x: 506,
    y: 236,
  },
  marlow: {
    id: 'marlow',
    name: 'Marlow',
    role: 'A farm town on the inland plains, 350 km west of the coast, surrounded by corn.',
    latitude: 41.5,
    continentality: 1,
    elevation: 250,
    ensoF: 1.4,
    x: 150,
    y: 262,
  },
  ridge: {
    id: 'ridge',
    name: 'Hollin Ridge',
    role: 'A line of hills north-west of the city, high and windy, where the region’s wind farm stands.',
    latitude: 42,
    continentality: 0.85,
    elevation: 700,
    ensoF: 1.2,
    x: 300,
    y: 104,
  },
};

export const CALDER = climateOf(STATIONS.calder);
export const MARLOW = climateOf(STATIONS.marlow);
export const RIDGE = climateOf(STATIONS.ridge);

/** Climate of a named station. */
export function stationClimate(id: StationId): Climate {
  return id === 'calder' ? CALDER : id === 'marlow' ? MARLOW : RIDGE;
}

/** Day-of-year index of a month's first day and its length. */
export function monthSpan(month: number): { start: number; days: number } {
  return { start: MONTH_START[month], days: MONTH_DAYS[month] };
}
