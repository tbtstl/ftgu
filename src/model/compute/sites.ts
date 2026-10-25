// Where the course's GPUs live: three fictional data-center sites. Tech Park is the empty site in
// the electricity course's region, beside Metro, and buys power at that region's hub price; Marston
// sits in a warm coastal city close to most users; Fernhill is a remote, cold valley with cheap
// hydro power and plenty of room. Prices, costs and climates are simulated for teaching.

export type SiteId = 'marston' | 'techpark' | 'fernhill';

export interface Site {
  id: SiteId;
  name: string;
  blurb: string;
  /** Average delivered electricity price, $/MWh (energy plus delivery charges). */
  powerPrice: number;
  /** Climate: annual mean outdoor temperature, °C. */
  meanTempC: number;
  /** Seasonal swing: the warmest month's mean is this far above the annual mean, °C. */
  seasonalSwingC: number;
  /** Daily swing: afternoon peak above the daily mean, °C. */
  dailySwingC: number;
  /** Humidity penalty on evaporative and free cooling (0 dry – 1 very humid). */
  humidity: number;
  /** Network round trip to the region's users, ms. */
  rttMs: number;
  /** Grid capacity available for a new data center, MW. */
  gridMW: number;
  /** Construction cost relative to the course's baseline (land, labor, permitting). */
  buildCostIndex: number;
}

export const SITES: Record<SiteId, Site> = {
  marston: {
    id: 'marston',
    name: 'Marston',
    blurb: 'a warm coastal city, beside most of the users',
    powerPrice: 95,
    meanTempC: 20,
    seasonalSwingC: 6,
    dailySwingC: 4,
    humidity: 0.8,
    rttMs: 2,
    gridMW: 20,
    buildCostIndex: 1.3,
  },
  techpark: {
    id: 'techpark',
    name: 'Tech Park',
    blurb: 'a campus in the electricity course’s region, beside Metro',
    powerPrice: 55,
    meanTempC: 14,
    seasonalSwingC: 10,
    dailySwingC: 5,
    humidity: 0.5,
    rttMs: 6,
    gridMW: 60,
    buildCostIndex: 1.0,
  },
  fernhill: {
    id: 'fernhill',
    name: 'Fernhill',
    blurb: 'a cold, remote valley with cheap hydro power',
    powerPrice: 35,
    meanTempC: 4,
    seasonalSwingC: 12,
    dailySwingC: 5,
    humidity: 0.3,
    rttMs: 40,
    gridMW: 200,
    buildCostIndex: 0.9,
  },
};

export const SITE_IDS: SiteId[] = ['marston', 'techpark', 'fernhill'];

/**
 * Outdoor temperature at a site in a given hour of the year (0–8,759): a seasonal cycle peaking in
 * late July plus a daily cycle peaking mid-afternoon. Smooth and deterministic, for annual sums.
 */
export function outdoorTempC(s: Site, hourOfYear: number): number {
  const day = hourOfYear / 24;
  const hour = hourOfYear % 24;
  return s.meanTempC + s.seasonalSwingC * Math.cos((2 * Math.PI * (day - 205)) / 365) + s.dailySwingC * Math.cos((2 * Math.PI * (hour - 15)) / 24);
}
