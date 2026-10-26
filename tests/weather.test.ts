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
import { angularMomentumWind, circulation, coriolis, cycloneWind, geostrophicSpeed, hadleyEdgeDeg, inertialPeriodHours, steadyWind, windTrack } from '../src/engines/weather/dynamics';
import { FENWICK, MARLOW, RIDGE, anomalySd, normalTemp } from '../src/model/weather/region';
import { DAYS, LEAD_MAX, YEARS, archive, dayIndex, dayInfo, expectedTemp, forecastTemp, knownShare, monthDays, ninoMonth, revealedShare, tempF } from '../src/model/weather/archive';
import { ENSO_DEFAULTS, ensoHistory, ensoPeriod } from '../src/engines/weather/enso';
import { frontPassage, frontWeather } from '../src/engines/weather/fronts';
import { stormOutlook } from '../src/engines/weather/storms';
import { stationDay } from '../src/engines/weather/station';
import { beamHeightKm, brightnessTempC, rainFromDbz } from '../src/engines/weather/remote';
import { runModel, truthField, truthWaves } from '../src/engines/weather/nwp';
import { attractorPoint, separationTime } from '../src/engines/weather/lorenz';
import { brierScore, crpsNormal } from '../src/engines/weather/verify';
import { cdd, demandFactor, hdd, indexFromMonthlyMean, indexOf, sendout } from '../src/engines/weather/degreeDays';
import { REFERENCE_GAS, energyDay, plantCost } from '../src/engines/weather/energyMarket';
import { capacityFactor, powerCurve } from '../src/engines/weather/renewables';
import { farmSeason, yieldHistory } from '../src/engines/weather/crops';
import { regress, utilityWinters, windYear } from '../src/engines/weather/exposure';
import { contractSpan, indexDistribution, indexValue, monthContract, payoff, probAbove, settledIndex } from '../src/engines/weather/pricing';
import { MARKET, expectedIndex, replay, tradeStats } from '../src/engines/weather/market';
import { DRIVER_DEFAULTS, crossMarketIdeas } from '../src/engines/weather/crossMarket';
import { scoreSeason } from '../src/engines/weather/competition';
import { replayBook } from '../src/engines/weather/portfolio';
import { DESK_DEFAULTS, REGION_DEFAULTS, isFenwick, regionKnobs, sanitize } from '../src/lessons/weather/shared/capstone';
import { doubledSolved, ensoShareSolved, quietedSolved } from '../src/lessons/weather/ch6/L6_1';
import { CHALLENGE_MONTH, beatModelSolved, skillLeadSolved } from '../src/lessons/weather/ch6/L6_2';
import { stripsSolved } from '../src/lessons/weather/ch6/L6_3';
import { hedgeSolved as deskHedgeSolved, vanishSolved as deskVanishSolved, viewDefaults } from '../src/lessons/weather/ch6/L6_4';
import { REF_BUSINESS, REF_DESK, WORLD_DEFAULTS, marketCatchesUpSolved, noPullEdgeSolved } from '../src/lessons/weather/ch6/L6_5';
import { exposureSeries } from '../src/engines/weather/exposureFit';
import { greenhouseSolved, transportSolved } from '../src/lessons/weather/ch1/L1_1';
import { descentSolved, thermalTopSolved } from '../src/lessons/weather/ch1/L1_2';
import { airState, cloudBaseSolved, dewPointSolved } from '../src/lessons/weather/ch1/L1_3';
import { CONVECTION_DEFAULTS, capSolved, convectionAscent, periodSolved } from '../src/lessons/weather/ch1/L1_4';
import { STORM_DEFAULTS, geostrophicSolved, noreasterSolved, windAtFenwick } from '../src/lessons/weather/ch1/L1_5';
import { jetSolved, tradesSolved } from '../src/lessons/weather/ch2/L2_1';
import { FRONT_DEFAULTS, lagSolved, rainSolved } from '../src/lessons/weather/ch2/L2_2';
import { INGREDIENT_DEFAULTS, floodSolved, leastDewSolved } from '../src/lessons/weather/ch2/L2_3';
import { PACIFIC_DEFAULTS, laNinaSolved, thresholdSolved } from '../src/lessons/weather/ch2/L2_4';
import { STATION_DEFAULTS as CLIMATE_STATION_DEFAULTS, steadiestSolved, steadyColdSolved } from '../src/lessons/weather/ch2/L2_5';
import { STATION_DEFAULTS, correctionSolved, gapSolved } from '../src/lessons/weather/ch3/L3_1';
import { RADAR_DEFAULTS, SAT_DEFAULTS, opaqueSolved, rainBeamSolved } from '../src/lessons/weather/ch3/L3_2';
import { FORECAST_DEFAULTS, stepSolved, windSolved } from '../src/lessons/weather/ch3/L3_3';
import { steadySolved, togetherSolved } from '../src/lessons/weather/ch3/L3_4';
import { CAL_DEFAULTS, calibrationSolved, climateLeadSolved } from '../src/lessons/weather/ch3/L3_5';
import { MONTH_DEFAULTS, normalShiftSolved, swingSolved } from '../src/lessons/weather/ch4/L4_1';
import { COLDEST_WINTER, DAY_DEFAULTS, oilSolved, pipelineSolved } from '../src/lessons/weather/ch4/L4_2';
import { breakevenRainSolved, steadiestSolved as cropSteadiestSolved } from '../src/lessons/weather/ch4/L4_3';
import { SITE_DEFAULTS, cfSolved, uncertaintySolved } from '../src/lessons/weather/ch4/L4_4';
import { INDEX_DEFAULTS, RISK_DEFAULTS, bestIndexSolved, variabilitySolved } from '../src/lessons/weather/ch4/L4_5';
import { BUILDER_DEFAULTS, SETTLE_DEFAULTS, droughtSolved, settlementSolved } from '../src/lessons/weather/ch5/L5_1';
import { atTheMoneySolved, windowSolved } from '../src/lessons/weather/ch5/L5_2';
import { EDGE_DEFAULTS, REPLAY_DEFAULTS, gapSolved as edgeGapSolved, vanishSolved } from '../src/lessons/weather/ch5/L5_3';
import { BOOK_DEFAULTS, LAB_DEFAULTS, bookSolved, pipelineSolved as labPipelineSolved } from '../src/lessons/weather/ch5/L5_4';
import { BACKTEST_DEFAULTS, hedgeSolved, lookAheadSolved } from '../src/lessons/weather/ch5/L5_5';

describe('the Fenwick region', () => {
  it('gives Fenwick Bay a New York–like year', () => {
    expect(normalTemp(FENWICK, 21)).toBeCloseTo(32, 0);
    expect(normalTemp(FENWICK, 21 + 182.5)).toBeCloseTo(75.7, 0);
    expect(anomalySd(FENWICK, 21)).toBeCloseTo(8.04, 2);
    expect(anomalySd(FENWICK, 204)).toBeCloseTo(4.42, 1);
  });
  it('makes Marlow more continental and the ridge colder', () => {
    expect(MARLOW.amplitude).toBeGreaterThan(FENWICK.amplitude);
    expect(MARLOW.winterSd).toBeGreaterThan(FENWICK.winterSd);
    expect(RIDGE.annualMean).toBeLessThan(FENWICK.annualMean - 8);
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
    expect(dewPointSolved({ tC: 19, w: 14, p: 1000 })).toBe(true);
    expect(dewPointSolved({ tC: 18.5, w: 14, p: 1000 })).toBe(false);
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
    expect(windAtFenwick(STORM_DEFAULTS).speed).toBeCloseTo(20, 0);
  });
});

describe('the archive', () => {
  it('reveals each day’s weather piece by piece, and its forecasts are calibrated', () => {
    const a = archive();
    expect(a.z.length).toBe(DAYS);
    let s2 = 0;
    let c1 = 0;
    for (let d = 0; d < DAYS; d++) {
      s2 += a.z[d] ** 2;
      if (d) c1 += a.z[d] * a.z[d - 1];
    }
    expect(s2 / DAYS).toBeCloseTo(1, 1);
    expect(c1 / s2).toBeGreaterThan(0.6);
    expect(c1 / s2).toBeLessThan(0.72);
    let total = 0;
    for (let k = 0; k <= LEAD_MAX; k++) total += revealedShare(k);
    expect(total).toBeCloseTo(1, 9);
    for (const k of [1, 5, 10]) {
      let inside = 0;
      let n = 0;
      for (let d = 400; d < DAYS; d += 3) {
        const f = forecastTemp('fenwick', d, k);
        if (Math.abs(tempF('fenwick', d) - f.mean) <= f.sd) inside++;
        n++;
      }
      expect(inside / n).toBeGreaterThan(0.64);
      expect(inside / n).toBeLessThan(0.72);
    }
    expect(knownShare(0)).toBe(1);
    expect(knownShare(LEAD_MAX + 1)).toBe(0);
  });
  it('builds forecasts only from pieces revealed by the issue date', () => {
    const a = archive();
    const d = 5000;
    for (let k = 1; k <= LEAD_MAX; k++) {
      let s = 0;
      for (let j = k; j <= LEAD_MAX; j++) s += a.piece[d * (LEAD_MAX + 1) + j];
      expect(a.known[d * (LEAD_MAX + 2) + k]).toBeCloseTo(s, 12);
    }
  });
  it('gives Fenwick Bay realistic degree days', () => {
    const jan: number[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const { start, days } = monthDays(y, 0);
      let h = 0;
      for (let i = 0; i < days; i++) h += Math.max(0, 65 - tempF('fenwick', start + i));
      jan.push(h);
    }
    const mean = jan.reduce((s, x) => s + x, 0) / jan.length;
    expect(mean).toBeGreaterThan(950);
    expect(mean).toBeLessThan(1080);
    expect(dayInfo(dayIndex(3, 1, 14))).toMatchObject({ year: 3, month: 1, dom: 14 });
  });
  it('makes El Niño winters mild at Fenwick Bay', () => {
    let warm = 0;
    let cold = 0;
    let nw = 0;
    let nc = 0;
    for (let y = 1; y <= 40; y++) {
      const nino = (ninoMonth(y, 11) + ninoMonth(y + 1, 0) + ninoMonth(y + 1, 1)) / 3;
      const { start } = monthDays(y + 1, 0);
      let t = 0;
      for (let i = 0; i < 31; i++) t += tempF('fenwick', start + i) - expectedTemp('fenwick', start + i);
      if (nino >= 0.5) {
        warm += t / 31;
        nw++;
      }
      if (nino <= -0.5) {
        cold += t / 31;
        nc++;
      }
    }
    expect(nw).toBeGreaterThan(5);
    expect(nc).toBeGreaterThan(5);
    expect(warm / nw).toBeGreaterThan(cold / nc);
  });
});

describe('ENSO', () => {
  it('oscillates every few years', () => {
    const p = ensoPeriod(ENSO_DEFAULTS);
    expect(p.periodMonths!).toBeGreaterThan(36);
    expect(p.periodMonths!).toBeLessThan(60);
    expect(p.growing).toBe(false);
    const h = ensoHistory(480);
    const sd = Math.sqrt(h.reduce((s, x) => s + x.t * x.t, 0) / h.length);
    expect(sd).toBeGreaterThan(0.6);
    expect(sd).toBeLessThan(1);
  });
});

describe('fronts and storms', () => {
  it('rains briefly and hard at a cold front, long and light at a warm one', () => {
    const cold = frontWeather({ kind: 'cold', coldC: 2, warmC: 16, warmDewC: 12, speed: 10 });
    const warm = frontWeather({ kind: 'warm', coldC: 2, warmC: 16, warmDewC: 12, speed: 5 });
    expect(cold.rainRateMmH).toBeGreaterThan(warm.rainRateMmH * 4);
    expect(warm.rainHours).toBeGreaterThan(cold.rainHours * 5);
    // A faster cold front rains harder for less time; the total is the same.
    const fast = frontWeather({ kind: 'cold', coldC: 2, warmC: 16, warmDewC: 12, speed: 15 });
    expect(fast.rainMm).toBeCloseTo(cold.rainMm, 6);
    expect(cold.domeHpa).toBeGreaterThan(8);
    const rec = frontPassage({ kind: 'cold', coldC: 2, warmC: 16, warmDewC: 12, speed: 10 });
    expect(rec[0].tempC).toBeCloseTo(16, 1);
    expect(rec[rec.length - 1].tempC).toBeCloseTo(2, 1);
    expect(rec.reduce((s, h) => s + h.rainMm, 0)).toBeCloseTo(cold.rainMm, 0);
  });
  it('sorts storms by their ingredients', () => {
    const base = { surfaceC: 30, dewC: 20, lapse: 7, liftKm: 3, shear: 5 };
    expect(stormOutlook(base).kind).toBe('single');
    expect(stormOutlook({ ...base, shear: 15 }).kind).toBe('multicell');
    expect(stormOutlook({ ...base, shear: 25 }).kind).toBe('supercell');
    expect(stormOutlook({ ...base, liftKm: 1 }).kind).toBe('capped');
    expect(stormOutlook({ ...base, dewC: 12, lapse: 6 }).kind).toBe('stable');
  });
  it('chapter 2 challenges', () => {
    expect(tradesSolved(0.85, 100)).toBe(true);
    expect(tradesSolved(0.8, 100)).toBe(false);
    expect(tradesSolved(0.9, 100)).toBe(false);
    expect(jetSolved(0.7)).toBe(true);
    expect(jetSolved(0.65)).toBe(false);
    expect(rainSolved({ ...FRONT_DEFAULTS, warmC: 20, warmDewC: 18 })).toBe(true);
    expect(rainSolved(FRONT_DEFAULTS)).toBe(false);
    expect(rainSolved({ ...FRONT_DEFAULTS, speed: 20 })).toBe(false);
    expect(lagSolved(8)).toBe(true);
    expect(lagSolved(10)).toBe(false);
    expect(leastDewSolved({ ...INGREDIENT_DEFAULTS, liftKm: 1.8, dewC: 23 })).toBe(true);
    expect(leastDewSolved({ ...INGREDIENT_DEFAULTS, liftKm: 1.8, dewC: 23.5 })).toBe(false);
    expect(floodSolved({ rate: 48, width: 10, cells: 3, speed: 4 })).toBe(true);
    expect(floodSolved({ rate: 48, width: 10, cells: 3, speed: 4.5 })).toBe(false);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.025 })).toBe(true);
    expect(thresholdSolved({ ...PACIFIC_DEFAULTS, coupling: 0.03 })).toBe(false);
    expect(laNinaSolved(1.8)).toBe(true);
    expect(laNinaSolved(1.0)).toBe(false);
    expect(steadyColdSolved({ latitude: 55, continentality: 0.35, elevation: 0 })).toBe(true);
    expect(steadyColdSolved(CLIMATE_STATION_DEFAULTS)).toBe(false);
    expect(steadiestSolved(6)).toBe(true);
    expect(steadiestSolved(0)).toBe(false);
  });
  it('measures, senses and models the atmosphere (chapter 3 engines)', () => {
    // The station's official mean is (max + min) / 2 of its hourly curve.
    const day = stationDay(dayIndex(10, 0, 15));
    expect((day.trueMax + day.trueMin) / 2).toBeCloseTo(day.officialMeanF, 9);
    const faulty = stationDay(dayIndex(10, 0, 15), { unshielded: 4 });
    expect(faulty.readMax).toBeGreaterThan(day.trueMax);
    // Radar: the beam climbs; 40 dBZ is about 11.5 mm/h.
    expect(beamHeightKm(100, 0.5)).toBeCloseTo(1.46, 1);
    expect(rainFromDbz(40)).toBeCloseTo(11.5, 0);
    expect(brightnessTempC(20, -50, 1)).toBeCloseTo(-50, 6);
    // The upwind scheme is stable up to a Courant number of 1.
    const t0 = truthField(truthWaves(), 0, 12, 0);
    expect(runModel(t0, 12, 1, 48).unstable).toBe(false);
    expect(runModel(t0, 12, 3, 48).unstable).toBe(true);
    // Lorenz: a hundredfold smaller error buys about ln(100)/0.9 ≈ 5 time units.
    const p = attractorPoint(5);
    const a = separationTime(p, 1e-3)!;
    const b = separationTime(p, 1e-5)!;
    expect(b - a).toBeGreaterThan(3);
    expect(b - a).toBeLessThan(7);
    // Scores.
    expect(crpsNormal(0, 1, 0)).toBeCloseTo(0.234, 3);
    expect(brierScore([1, 0], [true, false])).toBe(0);
  });
  it('chapter 3 challenges', () => {
    expect(gapSolved({ year: 10, month: 0, dom: 23 })).toBe(true);
    expect(gapSolved(STATION_DEFAULTS)).toBe(false);
    expect(correctionSolved({ unshielded: 3, heatIsland: 0, drift: -0.2 })).toBe(true);
    expect(correctionSolved({ unshielded: 3, heatIsland: 0, drift: -0.25 })).toBe(false);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2, rangeKm: 70 })).toBe(true);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2, rangeKm: 75 })).toBe(false);
    expect(opaqueSolved({ ...SAT_DEFAULTS, tau: 2.7 })).toBe(true);
    expect(opaqueSolved({ ...SAT_DEFAULTS, tau: 2.6 })).toBe(false);
    expect(stepSolved(1.5, 15)).toBe(true);
    expect(stepSolved(1.75, 15)).toBe(false);
    expect(windSolved({ ...FORECAST_DEFAULTS, windMs: 10 })).toBe(true);
    expect(windSolved(FORECAST_DEFAULTS)).toBe(false);
    expect(togetherSolved(-6)).toBe(true);
    expect(togetherSolved(-4)).toBe(false);
    expect(steadySolved(3.25, 0.2)).toBe(true);
    expect(steadySolved(13.25, 0.2)).toBe(false);
    expect(steadySolved(13, 0.2)).toBe(false);
    expect(climateLeadSolved(9)).toBe(true);
    expect(climateLeadSolved(8)).toBe(false);
    expect(calibrationSolved({ lead: 5, inflation: 1.65, bias: 0 })).toBe(true);
    expect(calibrationSolved(CAL_DEFAULTS)).toBe(false);
  });
  it('turns weather into energy demand, prices, crops and cash (chapter 4 engines)', () => {
    expect(hdd(40)).toBe(25);
    expect(cdd(40)).toBe(0);
    expect(indexOf('HDD', [60, 70, 50])).toBe(20);
    // Averaging first undercounts: a month swinging around 65 °F has degree days its mean doesn't.
    expect(indexFromMonthlyMean('HDD', 65, 2)).toBe(0);
    expect(indexOf('HDD', [55, 75])).toBe(10);
    expect(sendout(30)).toBe(150_000 + 18_000 * 30);
    expect(demandFactor(60)).toBeCloseTo(1, 9);
    // Cold snaps fill the pipelines and lift the city-gate price; heat waves lift the power price.
    const normal = energyDay({ doy: 20, meanF: 33, windMs: 7.5, cloud: 0.4 });
    const cold = energyDay({ doy: 20, meanF: 5, windMs: 7.5, cloud: 0.4 });
    expect(cold.gas).toBeGreaterThan(normal.gas * 3);
    expect(cold.avgPrice).toBeGreaterThan(normal.avgPrice * 2);
    const hot = energyDay({ doy: 200, meanF: 85, windMs: 7.5, cloud: 0.4 });
    expect(hot.peakPrice).toBeGreaterThanOrEqual(165);
    expect(plantCost('cc1', REFERENCE_GAS)).toBe(36);
    expect(plantCost('ct', REFERENCE_GAS)).toBe(88);
    // Wind: the power curve and capacity factors.
    expect(powerCurve(2)).toBe(0);
    expect(powerCurve(12)).toBe(1);
    expect(powerCurve(26)).toBe(0);
    expect(capacityFactor(7.6, 2.2)).toBeGreaterThan(0.3);
    expect(capacityFactor(7.6, 2.2)).toBeLessThan(0.4);
    // Corn: the archive's median is 180 bu/acre; a large share of the national crop softens the blow.
    const ys = yieldHistory().map((y) => y.bushels).sort((a, b) => a - b);
    expect(ys[20]).toBeCloseTo(180, -1);
    expect(farmSeason(130, 0.4).profit).toBeGreaterThan(farmSeason(130, 0.02).profit);
    // The utility's margin moves about $55,000 per heating degree day, almost but not quite exactly.
    const w = utilityWinters();
    const r = regress(
      w.map((x) => x.hdd),
      w.map((x) => x.margin),
    );
    expect(r.slope).toBeGreaterThan(50_000);
    expect(r.r2).toBeGreaterThan(0.95);
    expect(r.r2).toBeLessThan(1);
    expect(windYear(10).cf).toBeGreaterThan(0.28);
  });
  it('chapter 4 challenges', () => {
    expect(normalShiftSolved({ ...MONTH_DEFAULTS, shift: -3 })).toBe(true);
    expect(normalShiftSolved(MONTH_DEFAULTS)).toBe(false);
    expect(swingSolved({ mean: 65, swing: 7.5 })).toBe(true);
    expect(swingSolved({ mean: 65, swing: 7 })).toBe(false);
    expect(oilSolved({ ...DAY_DEFAULTS, meanF: 12 })).toBe(true);
    expect(oilSolved({ ...DAY_DEFAULTS, meanF: 13 })).toBe(false);
    expect(pipelineSolved({ winter: COLDEST_WINTER, pipeline: 1.55, windScale: 1 })).toBe(true);
    expect(pipelineSolved({ winter: COLDEST_WINTER, pipeline: 1.6, windScale: 1 })).toBe(false);
    expect(breakevenRainSolved({ heat: 96, rain: 9.7 })).toBe(true);
    expect(breakevenRainSolved({ heat: 96, rain: 9.6 })).toBe(false);
    expect(cropSteadiestSolved({ share: 0.39, warm: 0, rainScale: 1 })).toBe(true);
    expect(cropSteadiestSolved({ share: 0.02, warm: 0, rainScale: 1 })).toBe(false);
    expect(cfSolved({ mean: 8.3, k: 2.2, tempC: SITE_DEFAULTS.tempC })).toBe(true);
    expect(cfSolved({ mean: 8.2, k: 2.2, tempC: SITE_DEFAULTS.tempC })).toBe(false);
    expect(uncertaintySolved({ speed: 10, lead: 3 })).toBe(true);
    expect(uncertaintySolved({ speed: 9.5, lead: 3 })).toBe(false);
    expect(variabilitySolved({ ...RISK_DEFAULTS, variability: 1.5 })).toBe(true);
    expect(variabilitySolved({ ...RISK_DEFAULTS, variability: 1.45 })).toBe(false);
    expect(bestIndexSolved({ business: 'farm', farmIndex: 'heat' })).toBe(true);
    expect(bestIndexSolved(INDEX_DEFAULTS)).toBe(false);
  });
  it('prices, quotes and trades degree-day contracts honestly (chapter 5 engines)', () => {
    const jan = monthContract('HDD', 0);
    expect(payoff({ ...jan, strike: 1000 }, 1010)).toBe(200);
    expect(payoff({ ...jan, type: 'call', strike: 1000 }, 990)).toBe(0);
    expect(payoff({ ...jan, type: 'put', strike: 1000, cap: 100 }, 900)).toBe(100);
    // The distribution narrows as the month is settled, and ends at the settlement.
    const { start, end } = contractSpan(jan, 20);
    const early = indexDistribution(jan, 20, start - 30, { paths: 300 });
    const late = indexDistribution(jan, 20, end - 1, { paths: 300 });
    expect(early.sd).toBeGreaterThan(70);
    expect(late.sd).toBeLessThan(10);
    expect(late.mean).toBeCloseTo(settledIndex(jan, 20), -1);
    // The fast closed form agrees with the simulation's mean.
    expect(expectedIndex(jan, 20, start - 30)).toBeCloseTo(early.mean, -1.5);
    // Calibrated across Januaries: the outcome's rank in the distribution is roughly uniform.
    const ranks: number[] = [];
    for (let y = 2; y <= 40; y++) {
      const s = contractSpan(jan, y).start;
      const dist = indexDistribution(jan, y, s - 6, { paths: 200 });
      ranks.push(probAbove(dist, settledIndex(jan, y)));
    }
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
    // A forecaster who sees ENSO beats a market that doesn't; when the market sees it too, the edge goes.
    const years = Array.from({ length: 39 }, (_, i) => i + 2);
    const edge = tradeStats(replay(jan, years, 60, { threshold: 5, size: 1, view: {} }));
    const none = tradeStats(replay(jan, years, 60, { threshold: 5, size: 1, view: {} }, { ...MARKET, usesEnso: true }));
    expect(edge.mean).toBeGreaterThan(0);
    expect(none.trades).toBeLessThan(edge.trades / 4);
    // A look-ahead bug flatters the backtest.
    const honest = tradeStats(replay(jan, years, 0, { threshold: 5, size: 1, view: {} }));
    const cheat = tradeStats(replay(jan, years, 0, { threshold: 5, size: 1, view: { lookAheadDays: 7 } }));
    expect(cheat.mean).toBeGreaterThan(honest.mean);
    // Gas only answers a forecast revision when the pipelines are nearly full.
    const coldWeek = Array.from({ length: 7 }, () => ({ mean: 18, sd: 5 }));
    const mildWeek = Array.from({ length: 7 }, () => ({ mean: 34, sd: 5 }));
    const coldGas = crossMarketIdeas(coldWeek, -6, DRIVER_DEFAULTS)[1];
    const mildGas = crossMarketIdeas(mildWeek, -6, DRIVER_DEFAULTS)[1];
    expect(coldGas.edge).toBeGreaterThan(mildGas.edge * 10);
    const bigPipe = crossMarketIdeas(coldWeek, -6, { ...DRIVER_DEFAULTS, pipeline: 2_000_000 })[1];
    expect(bigPipe.netPerContract).toBeLessThan(0);
    // Rain and frost indices settle from the archive.
    expect(indexValue('rain', 'marlow', [[0, 5], [0, 6], [0, 7]], 10)).toBeGreaterThan(3);
    expect(indexValue('frost', 'fenwick', [[0, 0]], 10)).toBeGreaterThan(5);
  });
  it('chapter 5 challenges', () => {
    expect(droughtSolved({ ...BUILDER_DEFAULTS, index: 'rain', station: 'marlow', start: 5, length: 3, type: 'put', strike: 9.5, tickI: 11, capI: 5 })).toBe(true);
    expect(droughtSolved(BUILDER_DEFAULTS)).toBe(false);
    expect(settlementSolved({ ...SETTLE_DEFAULTS, fill: 'ridgeAdj' })).toBe(true);
    expect(settlementSolved(SETTLE_DEFAULTS)).toBe(false);
    expect(atTheMoneySolved({ year: 20, offset: -60, strike: 1000 })).toBe(true);
    expect(atTheMoneySolved({ year: 20, offset: -60, strike: 1050 })).toBe(false);
    expect(windowSolved({ window: 27, detrend: false })).toBe(true);
    expect(windowSolved({ window: 10, detrend: false })).toBe(false);
    expect(edgeGapSolved({ ...EDGE_DEFAULTS, year: 24 })).toBe(true);
    expect(edgeGapSolved(EDGE_DEFAULTS)).toBe(false);
    expect(vanishSolved({ ...REPLAY_DEFAULTS, lead: 5, ensoF: 0, lag: 0 })).toBe(true);
    expect(vanishSolved(REPLAY_DEFAULTS)).toBe(false);
    expect(labPipelineSolved({ ...LAB_DEFAULTS, pipeline: 1.85 })).toBe(true);
    expect(labPipelineSolved({ ...LAB_DEFAULTS, pipeline: 2.0 })).toBe(false);
    expect(bookSolved(LAB_DEFAULTS, { hdd: 50, gas: 1, power: 0 })).toBe(true);
    expect(bookSolved(LAB_DEFAULTS, BOOK_DEFAULTS)).toBe(false);
    expect(lookAheadSolved({ ...BACKTEST_DEFAULTS, lead: 30, lookAhead: 15 })).toBe(true);
    expect(lookAheadSolved({ ...BACKTEST_DEFAULTS, lead: 30, lookAhead: 14 })).toBe(false);
    expect(hedgeSolved({ contracts: 2800, variability: 1, ensoF: 1 })).toBe(true);
    expect(hedgeSolved({ contracts: 2700, variability: 1, ensoF: 1 })).toBe(false);
  });
  it('runs the capstone in any region (chapter 6 engines)', () => {
    const knobs = regionKnobs(REGION_DEFAULTS);
    const d = monthDays(20, 0).start + 5;
    expect(tempF('fenwick', d, knobs)).toBeCloseTo(tempF('fenwick', d), 9);
    expect(isFenwick(REGION_DEFAULTS)).toBe(true);
    expect(sanitize({ region: { latitude: 99 } }).region.latitude).toBe(60);
    // The calibrated model beats climate and persistence, and an overconfident one does worse.
    const yrs = Array.from({ length: 20 }, (_, i) => i + 2);
    const s = scoreSeason(yrs, [0], 3, knobs, { blend: 1, spread: 1, bias: 0 });
    expect(s.model).toBeLessThan(s.climate);
    expect(s.model).toBeLessThan(s.persistence);
    expect(s.model).toBeLessThan(s.raw);
    // The book: a minimum-variance hedge removes most of the utility's risk; the trading edge needs ENSO.
    const book = { business: 'utility' as const, scale: 1, hedgeStrips: 2800, months: [11, 0, 1], lead: 60, threshold: 5, size: 10 };
    const r = replayBook(book, knobs);
    expect(r.effectiveness).toBeGreaterThan(0.9);
    expect(r.tradingTotal).toBeGreaterThan(0);
    expect(replayBook(book, { ...knobs, ensoF: 0 }).trades).toBe(0);
    // A colder, more continental region has a riskier utility.
    const north = replayBook(book, regionKnobs({ ...REGION_DEFAULTS, latitude: 47, continentality: 1, elevation: 300 }));
    expect(north.businessSd).toBeGreaterThan(r.businessSd);
  });
  it('chapter 6 challenges', () => {
    const R = REGION_DEFAULTS;
    expect(doubledSolved({ ...R, variability: 2 })).toBe(true);
    expect(doubledSolved(R)).toBe(false);
    expect(quietedSolved({ ...R, variability: 0.5 })).toBe(true);
    expect(quietedSolved(R)).toBe(false);
    expect(ensoShareSolved({ ...R, ensoF: 2.1 })).toBe(true);
    expect(ensoShareSolved(R)).toBe(false);
    expect(beatModelSolved(CHALLENGE_MONTH, { blend: 1, spread: 1, bias: 2 })).toBe(true);
    expect(beatModelSolved(CHALLENGE_MONTH, { blend: 1, spread: 1, bias: 0 })).toBe(false);
    expect(skillLeadSolved('jan', 6)).toBe(true);
    expect(skillLeadSolved('jan', 7)).toBe(false);
    const series = exposureSeries('utility', 1, regionKnobs(R), 'fenwick');
    expect(stripsSolved('utility', 2800, series)).toBe(true);
    expect(stripsSolved('utility', 2700, series)).toBe(false);
    expect(deskVanishSolved(R, { ...viewDefaults(R), ensoF: 0, lag: 0 })).toBe(true);
    expect(deskVanishSolved(R, viewDefaults(R))).toBe(false);
    expect(deskHedgeSolved(R, viewDefaults(R), { ...DESK_DEFAULTS, hedgeStrips: 2700 }, 'utility', 1)).toBe(true);
    expect(deskHedgeSolved(R, viewDefaults(R), { ...DESK_DEFAULTS, hedgeStrips: 2800 }, 'utility', 1)).toBe(false);
    expect(marketCatchesUpSolved(R, REF_BUSINESS, REF_DESK, { ...WORLD_DEFAULTS, usesEnso: true, lag: 0 })).toBe(true);
    expect(marketCatchesUpSolved(R, REF_BUSINESS, REF_DESK, WORLD_DEFAULTS)).toBe(false);
    expect(noPullEdgeSolved(R, REF_BUSINESS, { ...REF_DESK, lead: 5 })).toBe(true);
    expect(noPullEdgeSolved(R, REF_BUSINESS, REF_DESK)).toBe(false);
  });
  it('places the Hadley cell’s edge with the rotation rate', () => {
    expect(circulation(1, 1 / 3).cells.length).toBe(3);
    expect(circulation(0.5, 1 / 3).cells.length).toBe(1);
    expect(circulation(2, 1 / 3).hadleyEdge).toBeCloseTo(circulation(1, 1 / 3).hadleyEdge / 2, 0);
  });
});
