// The weather course: its engines and world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import {
  EARTH_ABSORPTIVITY,
  EARTH_ALBEDO,
  SOLAR_CONSTANT,
  effectiveTemperature,
  imbalanceAt,
  latitudeBalance,
  planetBalance,
  tempAtLatitude,
} from '../src/engines/weather/radiation';
import {
  DRY_LAPSE,
  adiabaticTemperature,
  bruntVaisala,
  condense,
  density,
  dewPoint,
  lcl,
  moistLapseRate,
  parcelAscent,
  potentialTemperature,
  satMixingRatio,
  satVaporPressure,
  standardPressure,
} from '../src/engines/weather/thermo';
import { angularMomentumWind, coriolis, cycloneWind, geostrophicSpeed, hadleyEdgeDeg, inertialPeriodHours, steadyWind, windTrack } from '../src/engines/weather/dynamics';
import { CALDER, MARLOW, RIDGE, anomalySd, normalTemp } from '../src/model/weather/region';
import { greenhouseSolved, transportSolved } from '../src/lessons/weather/ch1/L1_1';
import { descentSolved, thermalTopSolved } from '../src/lessons/weather/ch1/L1_2';
import { airState, cloudBaseSolved, dewPointSolved } from '../src/lessons/weather/ch1/L1_3';
import { CONVECTION_DEFAULTS, capSolved, convectionAscent, periodSolved } from '../src/lessons/weather/ch1/L1_4';
import { STORM_DEFAULTS, geostrophicSolved, noreasterSolved, windAtCalder } from '../src/lessons/weather/ch1/L1_5';

describe('the Calder region', () => {
  it('gives Calder Bay a New York–like year', () => {
    expect(normalTemp(CALDER, 21)).toBeCloseTo(32, 0);
    expect(normalTemp(CALDER, 21 + 182.5)).toBeCloseTo(75.7, 0);
    expect(anomalySd(CALDER, 21)).toBeCloseTo(8.04, 2);
    expect(anomalySd(CALDER, 204)).toBeCloseTo(4.42, 1);
  });
  it('makes Marlow more continental and the ridge colder', () => {
    expect(MARLOW.amplitude).toBeGreaterThan(CALDER.amplitude);
    expect(MARLOW.winterSd).toBeGreaterThan(CALDER.winterSd);
    expect(RIDGE.annualMean).toBeLessThan(CALDER.annualMean - 8);
  });
});

describe('radiation', () => {
  it('balances a bare planet at the effective temperature', () => {
    const b = planetBalance({ solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO, absorptivity: 0 });
    expect(b.surfaceK).toBeCloseTo(254.6, 1);
    expect(b.olr).toBeCloseTo(b.absorbed, 6);
    expect(effectiveTemperature(590, 0.25)).toBeCloseTo(210, 0);
  });
  it('warms the surface to 288 K with a 78% absorbing layer', () => {
    const b = planetBalance({ solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO, absorptivity: EARTH_ABSORPTIVITY });
    expect(b.surfaceK).toBeCloseTo(288.06, 1);
    expect(b.olr).toBeCloseTo(b.absorbed, 6);
    // The surface's books: sunlight plus back radiation in, infrared out.
    expect(b.surfaceEmission).toBeCloseTo(b.absorbed + b.backRadiation, 6);
    expect(imbalanceAt({ solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO, absorptivity: EARTH_ABSORPTIVITY }, b.surfaceK)).toBeCloseTo(0, 6);
    // One more percent of sunlight reflected cools the surface by about a kelvin.
    const brighter = planetBalance({ solar: SOLAR_CONSTANT, albedo: 0.31, absorptivity: EARTH_ABSORPTIVITY });
    expect(b.surfaceK - brighter.surfaceK).toBeCloseTo(1.03, 1);
  });
  it('lesson 1.1’s challenges', () => {
    expect(greenhouseSolved({ solar: SOLAR_CONSTANT, albedo: 0.3, absorptivity: 0.78 })).toBe(true);
    expect(greenhouseSolved({ solar: SOLAR_CONSTANT, albedo: 0.3, absorptivity: 0.76 })).toBe(false);
    expect(transportSolved(0)).toBe(false);
    expect(transportSolved(0.5)).toBe(true);
    expect(transportSolved(0.65)).toBe(true);
    expect(transportSolved(0.7)).toBe(false);
  });
  it('carries the tropics’ surplus poleward without changing the global mean', () => {
    const none = latitudeBalance(0);
    const some = latitudeBalance(0.6);
    expect(none.globalMeanC).toBeCloseTo(15, 2);
    expect(some.globalMeanC).toBeCloseTo(none.globalMeanC, 6);
    expect(none.equatorC).toBeCloseTo(61.7, 0);
    expect(none.poleC).toBeCloseTo(-59.8, 0);
    expect(none.peakTransportPW).toBe(0);
    expect(some.peakTransportPW).toBeCloseTo(5.74, 1);
    expect(some.peakLat).toBeGreaterThan(31);
    expect(some.peakLat).toBeLessThan(35);
    expect(tempAtLatitude(none, 41)).toBeLessThan(0);
    expect(tempAtLatitude(some, 41)).toBeCloseTo(9.8, 0);
    // Surplus equals deficit: absorbed minus emitted integrates to zero over equal areas.
    const net = some.absorbed.reduce((s, a, i) => s + a - some.olr[i], 0);
    expect(net / some.absorbed.length).toBeCloseTo(0, 6);
  });
});

describe('thermodynamics', () => {
  it('follows the ideal gas law and the dry adiabat', () => {
    expect(density(1013.25, 15)).toBeCloseTo(1.225, 3);
    expect(DRY_LAPSE).toBeCloseTo(9.77, 2);
    expect(adiabaticTemperature(-5, 700, 1000)).toBeCloseTo(23.8, 1);
    expect(potentialTemperature(-5, 700)).toBeCloseTo(296.9, 1);
    expect(standardPressure(5500)).toBeCloseTo(505, 0);
  });
  it('handles water vapor', () => {
    expect(satVaporPressure(20)).toBeCloseTo(23.37, 2);
    expect(satMixingRatio(20, 1000) * 1000).toBeCloseTo(14.9, 1);
    expect(dewPoint(satVaporPressure(12.3))).toBeCloseTo(12.3, 6);
    expect(moistLapseRate(20, 1000)).toBeCloseTo(4.2, 1);
    // Cloud base: about 125 m per degree of dew-point depression.
    expect(lcl(30, 18).heightM).toBeGreaterThan(1400);
    expect(lcl(30, 18).heightM).toBeLessThan(1550);
    // Condensing releases latent heat.
    const c = condense(10, 0.012, 1000);
    expect(c.liquid).toBeGreaterThan(0);
    expect(c.tC).toBeGreaterThan(10);
    expect(c.w).toBeCloseTo(satMixingRatio(c.tC, 1000), 9);
  });
  it('lifts a parcel and measures its buoyancy', () => {
    const a = parcelAscent({ surfaceC: 30, lapse: 7 }, 20);
    expect(a.lclKm).toBeCloseTo(1.3, 1);
    expect(a.cape).toBeGreaterThan(1500);
    expect(a.lfcKm).not.toBeNull();
    const stable = parcelAscent({ surfaceC: 20, lapse: 5 }, 5);
    expect(stable.cape).toBeLessThan(1);
    const bv = bruntVaisala(10, 6.5);
    expect(bv.periodS! / 60).toBeCloseTo(9.8, 0);
    expect(bruntVaisala(10, 11).growthS).not.toBeNull();
  });
});

describe('dynamics', () => {
  it('balances the pressure gradient with the Coriolis force', () => {
    expect(coriolis(41)).toBeCloseTo(9.568e-5, 8);
    expect(geostrophicSpeed(1, 41)).toBeCloseTo(8.7, 1);
    expect(inertialPeriodHours(41)).toBeCloseTo(18.2, 1);
    const w = steadyWind(1, 41, 5.5e-5);
    expect(w.angleDeg).toBeCloseTo(29.9, 0);
    expect(w.speed).toBeLessThan(geostrophicSpeed(1, 41));
  });
  it('swings a released parcel around the geostrophic wind', () => {
    const tr = windTrack(1, 41, 0, 48, 10);
    const maxU = Math.max(...tr.map((p) => p.u));
    expect(maxU).toBeCloseTo(2 * geostrophicSpeed(1, 41), 1);
    // With friction it settles to the steady wind.
    const tf = windTrack(1, 41, 5e-5, 96, 10);
    const end = tf[tf.length - 1];
    const s = steadyWind(1, 41, 5e-5);
    expect(end.u).toBeCloseTo(s.along, 1);
    expect(end.v).toBeCloseTo(s.across, 1);
  });
  it('turns counterclockwise around a northern low', () => {
    const east = cycloneWind(300, 0, { depthHpa: 20, radiusKm: 400, latDeg: 41, friction: 0 });
    expect(east.v).toBeGreaterThan(0);
    const south = cycloneWind(300, 0, { depthHpa: 20, radiusKm: 400, latDeg: -41, friction: 0 });
    expect(south.v).toBeLessThan(0);
  });
  it('gives a Hadley cell reaching about 35°', () => {
    expect(hadleyEdgeDeg({ rotation: 1, contrast: 1 / 3 })).toBeCloseTo(35.3, 0);
    expect(angularMomentumWind(30)).toBeCloseTo(134, 0);
  });
});

describe('chapter 1 challenges', () => {
  it('1.2: the chinook descent and the thermal’s top', () => {
    expect(descentSolved({ tC: adiabaticTemperature(-5, 700, 1000), pHpa: 1000 })).toBe(true);
    expect(descentSolved({ tC: 24, pHpa: 1000 })).toBe(false);
    expect(descentSolved({ tC: 23.5, pHpa: 1000 })).toBe(false);
    expect(thermalTopSolved({ height: 0.9, head: 3 })).toBe(true);
    expect(thermalTopSolved({ height: 1.0, head: 3 })).toBe(false);
    expect(thermalTopSolved({ height: 0.8, head: 3 })).toBe(false);
  });
  it('1.3: the dew point and the cloud base', () => {
    expect(airState({ tC: 30, w: 14, p: 1000 }).dew).toBeCloseTo(19.0, 1);
    expect(dewPointSolved({ tC: 19.5, w: 14, p: 1000 })).toBe(true);
    expect(dewPointSolved({ tC: 19, w: 14, p: 1000 })).toBe(false);
    expect(dewPointSolved({ tC: 20, w: 14, p: 1000 })).toBe(false);
    expect(cloudBaseSolved(28, 19.5)).toBe(true);
    expect(cloudBaseSolved(28, 19)).toBe(false);
    expect(cloudBaseSolved(27, 19.5)).toBe(false);
  });
  it('1.4: breaking the cap, and a 20-minute oscillation', () => {
    expect(capSolved({ ...CONVECTION_DEFAULTS, surfaceC: 30.5 })).toBe(true);
    expect(capSolved({ ...CONVECTION_DEFAULTS, surfaceC: 30 })).toBe(false);
    expect(capSolved({ ...CONVECTION_DEFAULTS, surfaceC: 31 })).toBe(false);
    expect(convectionAscent({ ...CONVECTION_DEFAULTS, surfaceC: 32 }).cape).toBeGreaterThan(1000);
    expect(periodSolved(9)).toBe(true);
    expect(periodSolved(6.5)).toBe(false);
  });
  it('1.5: the geostrophic wind and a nor’easter', () => {
    expect(geostrophicSolved(2.3, 41)).toBe(true);
    expect(geostrophicSolved(2.2, 41)).toBe(false);
    expect(geostrophicSolved(2.3, 40)).toBe(false);
    expect(noreasterSolved({ ...STORM_DEFAULTS, east: 100, north: -300 })).toBe(true);
    expect(noreasterSolved(STORM_DEFAULTS)).toBe(false);
    expect(windAtCalder(STORM_DEFAULTS).speed).toBeCloseTo(20, 0);
  });
});
