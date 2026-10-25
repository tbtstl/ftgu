// Chapter 2 of the weather course: the numbers its prose quotes, and its challenges after the second fix pass.

import { describe, expect, it } from 'vitest';
import { fmt } from '../src/framework';
import { angularMomentumWind, EARTH_RADIUS_M, hadleyEdgeDeg, OMEGA } from '../src/engines/weather/dynamics';
import { ENSO_DEFAULTS } from '../src/engines/weather/enso';
import { frontPassage, frontWeather } from '../src/engines/weather/fronts';
import { latitudeBalance } from '../src/engines/weather/radiation';
import { AXIAL_TILT_DEG, dailySunlight, dayLengthHours, declination, noonSunHeightDeg } from '../src/engines/weather/seasons';
import { FENWICK, LAPSE_F_PER_KM, LATITUDE, RIDGE, STATIONS, climateOf } from '../src/model/weather/region';
import { climateSeries, yearBands } from '../src/engines/weather/climatology';
import { CONTRAST_DEFAULT_K, JET_TARGET, ROTATION_STEP, THETA0_K, TROPOPAUSE_KM, circulationFor, jetSolved, ringWind, tradesSolved } from '../src/lessons/weather/ch2/L2_1';
import { FRONT_DEFAULTS, LAG_TARGET_H, LOW_DEFAULTS, coldLagHours, lagSolved, leastRainDewC, pressureJump, rainSolved } from '../src/lessons/weather/ch2/L2_2';
import { DEW_STEP, DRIER_DEW_C, INGREDIENT_DEFAULTS, STORM_LIFT_KM, WEAK_LIFT_KM, leastDewSolved, outlookOf } from '../src/lessons/weather/ch2/L2_3';
import { PACIFIC_DEFAULTS, growthPerMonth, laNinaSolved, teleconnection, thresholdSolved, warmestLaNinaWinter } from '../src/lessons/weather/ch2/L2_4';
import {
  DECEMBER_SOLSTICE,
  JUNE_SOLSTICE,
  STATION_DEFAULTS,
  hoursMinutes,
  stationMonth,
  stationOf,
  steadiestMonth,
  steadiestSolved,
  withinOneSd,
} from '../src/lessons/weather/ch2/L2_5';

describe('weather chapter 2', () => {
  it('2.1: the Held–Hou reach, its symbols and the numbers the prose quotes', () => {
    const earth = circulationFor(1, CONTRAST_DEFAULT_K);
    // The lesson's tropopause height is the one the engine uses.
    expect(hadleyEdgeDeg({ rotation: 1, contrast: CONTRAST_DEFAULT_K / THETA0_K, tropopauseKm: TROPOPAUSE_KM })).toBeCloseTo(earth.hadleyEdge, 10);
    expect(CONTRAST_DEFAULT_K / THETA0_K).toBeCloseTo(1 / 3, 10);
    expect(fmt(earth.hadleyEdge)).toBe('35');
    expect(fmt(earth.jetSpeedIdeal)).toBe('190');
    expect(fmt(EARTH_RADIUS_M / 1000)).toBe('6,371');
    // Lesson 1.1's contrast without transport, and the reach it would give.
    const nt = latitudeBalance(0);
    const contrast11 = nt.equatorC - nt.poleC;
    expect(fmt(contrast11)).toBe('121');
    expect(fmt(circulationFor(1, contrast11).hadleyEdge)).toBe('39');
    // Inversely proportional to the spin: twice the rate, half the reach.
    expect(circulationFor(2, CONTRAST_DEFAULT_K).hadleyEdge).toBeCloseTo(earth.hadleyEdge / 2, 10);
    expect(fmt(circulationFor(2, CONTRAST_DEFAULT_K).hadleyEdge, 1)).toBe('17.6');
    expect(fmt((1 - earth.hadleyEdge / LATITUDE) * 100)).toBe('14');
    expect(tradesSolved(0.85, CONTRAST_DEFAULT_K)).toBe(true);
    // The ring: 134 m/s at 30°; the trade wind of air that left 30° at rest, reaching 10°.
    expect(fmt(angularMomentumWind(30))).toBe('134');
    const rad = (d: number) => (d * Math.PI) / 180;
    const m30 = OMEGA * EARTH_RADIUS_M * EARTH_RADIUS_M * Math.cos(rad(30)) ** 2;
    const trade10 = m30 / (EARTH_RADIUS_M * Math.cos(rad(10))) - OMEGA * EARTH_RADIUS_M * Math.cos(rad(10));
    expect(Math.round(-trade10 / 10) * 10).toBe(100);
  });

  it('2.2: the pressure jump, the saturated limit and the distance', () => {
    expect(fmt(pressureJump(frontPassage(FRONT_DEFAULTS, 48, 24)))).toBe('9');
    // At the starting 16 °C, even saturated warm air can't reach 10 mm.
    const saturated = frontWeather({ ...FRONT_DEFAULTS, warmDewC: FRONT_DEFAULTS.warmC }).rainMm;
    expect(fmt(saturated, 1)).toBe('9.5');
    expect(rainSolved({ ...FRONT_DEFAULTS, warmDewC: FRONT_DEFAULTS.warmC })).toBe(false);
    expect(STATIONS.fenwick.x - STATIONS.marlow.x).toBe(356);
  });

  it('2.4: the threshold sits a little above zero net feedback', () => {
    expect(growthPerMonth({ ...ENSO_DEFAULTS, coupling: 0 })).toBeLessThan(1);
    expect(growthPerMonth({ ...ENSO_DEFAULTS, coupling: 0.025 })).toBeGreaterThan(1);
  });

  it('2.5: the seasons', () => {
    expect(declination(JUNE_SOLSTICE)).toBeCloseTo(AXIAL_TILT_DEG, 2);
    expect(declination(DECEMBER_SOLSTICE)).toBeCloseTo(-AXIAL_TILT_DEG, 2);
    expect(dayLengthHours(0, 30)).toBeCloseTo(12, 9);
    expect(hoursMinutes(dayLengthHours(LATITUDE, JUNE_SOLSTICE))).toBe('14 h 57 min');
    expect(hoursMinutes(dayLengthHours(LATITUDE, DECEMBER_SOLSTICE))).toBe('9 h 03 min');
    expect(fmt(noonSunHeightDeg(LATITUDE, JUNE_SOLSTICE))).toBe('72');
    expect(fmt(noonSunHeightDeg(LATITUDE, DECEMBER_SOLSTICE))).toBe('26');
    const june = dailySunlight(LATITUDE, JUNE_SOLSTICE);
    const dec = dailySunlight(LATITUDE, DECEMBER_SOLSTICE);
    expect(fmt(june)).toBe('499');
    expect(fmt(dec)).toBe('144');
    expect(fmt(june / dec, 1)).toBe('3.5');
    // The pole on June 21 gets more than the equator.
    expect(fmt(dailySunlight(90, JUNE_SOLSTICE))).toBe('541');
    expect(fmt(dailySunlight(0, JUNE_SOLSTICE))).toBe('397');
    // Past the Arctic Circle: midnight sun and polar night.
    expect(fmt(90 - AXIAL_TILT_DEG, 1)).toBe('66.6');
    expect(dayLengthHours(67, JUNE_SOLSTICE)).toBe(24);
    expect(dayLengthHours(67, DECEMBER_SOLSTICE)).toBe(0);
    expect(dailySunlight(67, DECEMBER_SOLSTICE)).toBe(0);
    // Fenwick Bay's coldest day comes 32 days after the shortest; the coastal station's 18 days later still.
    expect(Math.round(FENWICK.coldestDay) + 365 - DECEMBER_SOLSTICE).toBe(32);
    expect(Math.round(stationOf(STATION_DEFAULTS).coldestDay) - Math.round(FENWICK.coldestDay)).toBe(18);
  });

  it('2.5: Hollin Ridge is colder by its height and its latitude, not its continentality', () => {
    const colder = FENWICK.annualMean - RIDGE.annualMean;
    const rise = STATIONS.ridge.elevation - STATIONS.fenwick.elevation;
    const height = (LAPSE_F_PER_KM * rise) / 1000;
    expect(fmt(colder, 1)).toBe('9.4');
    expect(fmt(height, 1)).toBe('8.1');
    expect(fmt(colder - height, 1)).toBe('1.3');
    // Continentality leaves the average alone; the remainder is all latitude.
    const at = (latitude: number, continentality: number) => climateOf({ latitude, continentality, elevation: 0 }).annualMean;
    expect(at(41, 0.8)).toBeCloseTo(at(41, 0.85), 10);
    expect(colder - height).toBeCloseTo(at(STATIONS.fenwick.latitude, 0.8) - at(STATIONS.ridge.latitude, 0.8), 10);
  });

  it('2.5: a standard deviation holds about two-thirds of January', () => {
    expect(fmt(withinOneSd(0) * 100)).toBe('67');
  });

  // ---------------------------------------------------------------------------
  // Pass 2: every challenge is predicted first, then checked.

  it('2.1a: the reach is inversely proportional to the spin, so 35.3 ÷ 41 ≈ 0.86 → 0.85', () => {
    const earth = circulationFor(1, CONTRAST_DEFAULT_K);
    expect(fmt(earth.hadleyEdge, 1)).toBe('35.3');
    expect(fmt(earth.hadleyEdge / LATITUDE, 2)).toBe('0.86');
    // The prediction, rounded down to the slider's steps, is the answer.
    const predicted = Math.floor(earth.hadleyEdge / LATITUDE / ROTATION_STEP) * ROTATION_STEP;
    expect(tradesSolved(Math.round(predicted * 100) / 100, CONTRAST_DEFAULT_K)).toBe(true);
    expect(fmt(circulationFor(0.85, CONTRAST_DEFAULT_K).hadleyEdge, 1)).toBe('41.5');
    expect(fmt(24 / 0.85)).toBe('28');
    // Default unsolved; near misses don't solve; the contrast must be the starting one.
    expect(tradesSolved(1, CONTRAST_DEFAULT_K)).toBe(false);
    expect(tradesSolved(0.8, CONTRAST_DEFAULT_K)).toBe(false);
    expect(tradesSolved(0.9, CONTRAST_DEFAULT_K)).toBe(false);
    expect(tradesSolved(0.85, CONTRAST_DEFAULT_K + 5)).toBe(false);
  });

  it('2.1b: the ring keeps what eddies leave, so 1 − 40/134 ≈ 70%', () => {
    expect(fmt(1 - JET_TARGET / angularMomentumWind(30), 2)).toBe('0.70');
    expect(ringWind(30, 0.7)).toBeCloseTo(0.3 * angularMomentumWind(30), 10);
    expect(fmt(ringWind(30, 0.7), 1)).toBe('40.2');
    expect(jetSolved(0)).toBe(false);
    expect(jetSolved(0.7)).toBe(true);
    expect(jetSolved(0.65)).toBe(false);
    expect(jetSolved(0.75)).toBe(false);
  });

  it('2.2a: the dew point alone can’t do it at 16 °C; it takes 18 °C in warm-enough air', () => {
    expect(rainSolved(FRONT_DEFAULTS)).toBe(false);
    // The front's speed and the warm air's heat leave the total alone.
    expect(fmt(frontWeather(FRONT_DEFAULTS).rainMm, 1)).toBe('8.3');
    expect(rainSolved({ ...FRONT_DEFAULTS, speed: 20 })).toBe(false);
    expect(rainSolved({ ...FRONT_DEFAULTS, warmC: 32 })).toBe(false);
    // Raising only the dew point stops at saturation, short of 10 mm.
    expect(rainSolved({ ...FRONT_DEFAULTS, warmDewC: 28 })).toBe(false);
    expect(leastRainDewC()).toBe(18);
    expect(rainSolved({ ...FRONT_DEFAULTS, warmC: 18, warmDewC: 18 })).toBe(true);
    expect(rainSolved({ ...FRONT_DEFAULTS, warmC: 24, warmDewC: 17 })).toBe(false);
    expect(fmt(frontWeather({ ...FRONT_DEFAULTS, warmC: 24, warmDewC: 17 }).rainMm, 1)).toBe('9.8');
    // A warm front doesn't count.
    expect(rainSolved({ ...FRONT_DEFAULTS, kind: 'warm', warmC: 24, warmDewC: 20 })).toBe(false);
  });

  it('2.2b: the lag is inversely proportional to the speed: 9.6 h at 10 m/s → 12 h at 8 m/s', () => {
    const lag10 = coldLagHours(LOW_DEFAULTS.speed);
    expect(fmt(lag10, 1)).toBe('9.6');
    expect(coldLagHours(8) * 8).toBeCloseTo(lag10 * LOW_DEFAULTS.speed, 9);
    const predicted = Math.round(((lag10 * LOW_DEFAULTS.speed) / LAG_TARGET_H) * 2) / 2;
    expect(predicted).toBe(8);
    expect(lagSolved(predicted)).toBe(true);
    expect(fmt(coldLagHours(8), 1)).toBe('12.0');
    expect(fmt(8 * 3.6 * LAG_TARGET_H)).toBe('346');
    expect(lagSolved(LOW_DEFAULTS.speed)).toBe(false);
    expect(lagSolved(7.5)).toBe(false);
    expect(lagSolved(8.5)).toBe(false);
  });

  it('2.3a: with 1.8 km of lift, about 0.3 km of free convection per degree of dew point → 23 °C', () => {
    const start = outlookOf(INGREDIENT_DEFAULTS);
    const drier = outlookOf({ ...INGREDIENT_DEFAULTS, dewC: DRIER_DEW_C, liftKm: STORM_LIFT_KM });
    expect(fmt(start.lfcKm ?? 0, 2)).toBe('2.65');
    expect(fmt(drier.lfcKm ?? 0, 2)).toBe('3.30');
    // The prose's lift sets the starting storm off; 100 m less doesn't.
    expect(outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: STORM_LIFT_KM }).triggered).toBe(true);
    expect(outlookOf({ ...INGREDIENT_DEFAULTS, liftKm: 2.6 }).triggered).toBe(false);
    // The estimate: 0.65 km per 2 °C; bring 2.65 km down to 1.8 km → about 2.6 °C more → the next half degree, 23 °C.
    const perDegree = ((drier.lfcKm ?? 0) - (start.lfcKm ?? 0)) / (INGREDIENT_DEFAULTS.dewC - DRIER_DEW_C);
    const estimate = INGREDIENT_DEFAULTS.dewC + ((start.lfcKm ?? 0) - WEAK_LIFT_KM) / perDegree;
    expect(fmt(estimate, 1)).toBe('22.6');
    expect(Math.ceil(estimate / DEW_STEP) * DEW_STEP).toBe(23);
    const weak = { ...INGREDIENT_DEFAULTS, liftKm: WEAK_LIFT_KM };
    expect(leastDewSolved(weak)).toBe(false);
    expect(leastDewSolved({ ...weak, dewC: 23 })).toBe(true);
    expect(leastDewSolved({ ...weak, dewC: 22.5 })).toBe(false);
    expect(leastDewSolved({ ...weak, dewC: 23.5 })).toBe(false);
    expect(leastDewSolved({ ...weak, dewC: 23, lapse: 7.5 })).toBe(false);
    expect(leastDewSolved({ ...INGREDIENT_DEFAULTS, dewC: 23, liftKm: STORM_LIFT_KM })).toBe(false);
    // The success message's numbers.
    const at23 = outlookOf({ ...weak, dewC: 23 });
    expect(fmt(at23.lfcKm ?? 0, 2)).toBe('1.75');
    expect(fmt(outlookOf({ ...weak, dewC: 22.5 }).lfcKm ?? 0, 2)).toBe('1.95');
    expect(fmt((start.lfcKm ?? 0) - (at23.lfcKm ?? 0), 2)).toBe('0.90');
    expect(fmt(at23.cape / start.cape, 1)).toBe('2.0');
  });

  it('2.4a: the threshold sits a little above zero, not at it', () => {
    expect(thresholdSolved(PACIFIC_DEFAULTS)).toBe(false);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0 })).toBe(false);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.02 })).toBe(false);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.025 })).toBe(true);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.03 })).toBe(false);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.025, recharge: 1.2 })).toBe(false);
    // Without the stored heat's own leak, the line would sit below zero instead.
    expect(growthPerMonth({ ...ENSO_DEFAULTS, coupling: 0, r: 0 })).toBeGreaterThan(1);
  });

  it('2.4b: doubling the link just makes every La Niña winter cold; 1.8 is the weakest', () => {
    const at1 = teleconnection(1);
    expect(at1.laNinaCount - at1.laNinaCold).toBe(3);
    expect(at1.laNinaCount).toBe(10);
    expect(fmt(at1.warmestLaNina, 1)).toBe('0.4');
    expect(teleconnection(2).warmestLaNina).toBeLessThan(0);
    expect(laNinaSolved(1)).toBe(false);
    expect(laNinaSolved(1.8)).toBe(true);
    expect(laNinaSolved(1.7)).toBe(false);
    expect(laNinaSolved(1.9)).toBe(false);
    expect(fmt(-teleconnection(1.8).warmestLaNina, 2)).toBe('0.02');
    // The last holdout is a weak La Niña, cooled about half a degree per unit of link.
    const holdout = warmestLaNinaWinter(1.7);
    expect(fmt(holdout.nino, 2)).toBe('−0.53');
    expect(Math.abs(holdout.ensoUnit)).toBeGreaterThan(0.45);
    expect(Math.abs(holdout.ensoUnit)).toBeLessThan(0.6);
  });

  it('2.5b: the gray band pinches in July, the steadiest month', () => {
    expect(steadiestMonth()).toBe(6);
    expect(steadiestSolved(0)).toBe(false);
    expect(steadiestSolved(6)).toBe(true);
    expect(steadiestSolved(5)).toBe(false);
    expect(steadiestSolved(7)).toBe(false);
    // The first demonstration's band is narrowest in July (days 181–211).
    const b = yearBands(climateSeries(FENWICK, 'fenwick'));
    let at = 0;
    for (let i = 1; i < b.doy.length; i++) if (b.high[i] - b.low[i] < b.high[at] - b.low[at]) at = i;
    expect(b.doy[at]).toBeGreaterThanOrEqual(181);
    expect(b.doy[at]).toBeLessThan(212);
    const jan = stationMonth('fenwick', 0);
    const jul = stationMonth('fenwick', 6);
    expect(fmt(jul.sd, 1)).toBe('4.4');
    expect(fmt(jan.sd, 1)).toBe('7.9');
    expect(jan.sd / jul.sd).toBeGreaterThan(1.7);
    expect(jan.sd / jul.sd).toBeLessThan(2);
  });
});
