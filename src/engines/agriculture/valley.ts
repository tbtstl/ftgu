// The whole Crane Valley: every district's corn and wheat in a season, added up to the valley's
// production. This is the supply side that the rest of the course's prices respond to.

import { simulateSeason, type SeasonResult } from './crop';
import { PLAINS_IRRIGATION } from './farm';
import { applyShift, simulatedYear, type WeatherShift } from '../../model/agriculture/climate';
import { DISTRICTS, DISTRICT, dayOf, type Crop, type DistrictId } from '../../model/agriculture/region';

export interface DistrictSeason {
  /** Unirrigated corn, irrigated corn (the High Plains only) and wheat yields, bushels per acre. */
  corn: number;
  cornIrrigated: number;
  wheat: number;
}

export interface ValleySeason {
  year: number;
  districts: Record<DistrictId, DistrictSeason>;
  /** Production, bushels. */
  corn: number;
  wheat: number;
  /** Area-weighted average yields, bushels per acre. */
  cornYield: number;
  wheatYield: number;
}

/** Valley-wide changes to try in a lesson: a climate shift and a soil multiplier. */
export interface ValleyScenario {
  shift?: WeatherShift;
  /** Multiplies every district's root-zone water-holding capacity. */
  soil?: number;
}

const cache = new Map<string, ValleySeason>();

/** One district's crop in a season, under a scenario. */
export function districtCrop(year: number, district: DistrictId, crop: Crop, sc: ValleyScenario = {}, irrigated = false): SeasonResult {
  const d = DISTRICT[district];
  const w = sc.shift ? applyShift(simulatedYear(year, district), sc.shift) : simulatedYear(year, district);
  return simulateSeason(w, {
    crop,
    plantDay: dayOf(5, 1),
    maturityGdd: crop === 'corn' ? d.hybridGdd : undefined,
    pawIn: d.pawIn * (sc.soil ?? 1),
    startWater: irrigated ? Math.max(d.springWater, 0.8) : d.springWater,
    irrigation: irrigated ? PLAINS_IRRIGATION : null,
  });
}

/** The valley in one simulated season: each district's yields and the valley's production. Cached. */
export function valleySeason(year: number, sc: ValleyScenario = {}): ValleySeason {
  const k = JSON.stringify([year, sc]);
  let v = cache.get(k);
  if (!v) {
    const districts = {} as Record<DistrictId, DistrictSeason>;
    let corn = 0;
    let wheat = 0;
    let cornAc = 0;
    let wheatAc = 0;
    for (const d of DISTRICTS) {
      const c = districtCrop(year, d.id, 'corn', sc).yield;
      const ci = d.irrigatedKAc > 0 ? districtCrop(year, d.id, 'corn', sc, true).yield : c;
      const w = districtCrop(year, d.id, 'wheat', sc).yield;
      districts[d.id] = { corn: c, cornIrrigated: ci, wheat: w };
      corn += ((d.cornKAc - d.irrigatedKAc) * c + d.irrigatedKAc * ci) * 1000;
      wheat += d.wheatKAc * w * 1000;
      cornAc += d.cornKAc * 1000;
      wheatAc += d.wheatKAc * 1000;
    }
    v = { year, districts, corn, wheat, cornYield: corn / cornAc, wheatYield: wheat / wheatAc };
    if (cache.size > 5000) cache.clear();
    cache.set(k, v);
  }
  return v;
}

/**
 * Valley production when each district's weather may come from a different simulated year
 * (`yearOf(district)`), or from a fixed weather series (`weatherOf`) — for shuffling districts
 * independently, splicing a known season onto possible endings, or using normal weather.
 */
export function valleyFrom(weatherOf: (d: DistrictId) => import('../../model/agriculture/climate').DayWeather[]): { corn: number; wheat: number; districts: Record<DistrictId, DistrictSeason> } {
  const districts = {} as Record<DistrictId, DistrictSeason>;
  let corn = 0;
  let wheat = 0;
  for (const d of DISTRICTS) {
    const w = weatherOf(d.id);
    const opts = { plantDay: dayOf(5, 1), pawIn: d.pawIn, startWater: d.springWater };
    const c = simulateSeason(w, { ...opts, crop: 'corn', maturityGdd: d.hybridGdd }).yield;
    const ci = d.irrigatedKAc > 0 ? simulateSeason(w, { ...opts, crop: 'corn', maturityGdd: d.hybridGdd, startWater: Math.max(d.springWater, 0.8), irrigation: PLAINS_IRRIGATION }).yield : c;
    const wh = simulateSeason(w, { ...opts, crop: 'wheat' }).yield;
    districts[d.id] = { corn: c, cornIrrigated: ci, wheat: wh };
    corn += ((d.cornKAc - d.irrigatedKAc) * c + d.irrigatedKAc * ci) * 1000;
    wheat += d.wheatKAc * wh * 1000;
  }
  return { corn, wheat, districts };
}

/** The valley over many seasons (years 1…n). */
export function valleyHistory(n: number, sc: ValleyScenario = {}, first = 1): ValleySeason[] {
  return Array.from({ length: n }, (_, i) => valleySeason(first + i, sc));
}

/** Each district's average yields over `years` simulated seasons under a scenario. */
export function districtMeans(years: number[], sc: ValleyScenario = {}): Record<DistrictId, DistrictSeason> {
  const out = {} as Record<DistrictId, DistrictSeason>;
  for (const d of DISTRICTS) {
    let c = 0;
    let ci = 0;
    let w = 0;
    for (const y of years) {
      const s = valleySeason(y, sc).districts[d.id];
      c += s.corn;
      ci += s.cornIrrigated;
      w += s.wheat;
    }
    out[d.id] = { corn: c / years.length, cornIrrigated: ci / years.length, wheat: w / years.length };
  }
  return out;
}
