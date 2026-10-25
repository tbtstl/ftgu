// Weather chapter 1: the numbers its lessons quote and its challenge checks, after the first and second fix passes.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import Lesson11 from '../src/lessons/weather/ch1/L1_1';
import { EARTH_ALBEDO, SIGMA, SOLAR_CONSTANT, latitudeBalance, planetBalance, tempAtLatitude } from '../src/engines/weather/radiation';
import { geostrophicSpeed, windTrack } from '../src/engines/weather/dynamics';
import { SEA_BREEZE, seaBreeze } from '../src/engines/weather/seaBreeze';
import { liftedParcel, thermalTopSolved } from '../src/lessons/weather/ch1/L1_2';
import { AFTERNOON_AIR, airState, dewPointSolved } from '../src/lessons/weather/ch1/L1_3';
import {
  CAP_LAYER,
  CONVECTION_DEFAULTS,
  TROPOPAUSE_KM,
  capConditionsKept,
  capSolved,
  convectionAscent,
  lowCloudLift,
  thermalTopM,
} from '../src/lessons/weather/ch1/L1_4';
import { ALOFT_M, BREEZE_DEFAULTS } from '../src/lessons/weather/ch1/L1_5';
import { dewPoint, lcl, moistLapseRate, satVaporPressure, stabilityClass, vaporPressure } from '../src/engines/weather/thermo';
import { fmt } from '../src/framework/format';
import { QUOTED_TRANSPORT, backRadiationNeeded, greenhouseSolved, transportSolved } from '../src/lessons/weather/ch1/L1_1';
import { cloudBaseSolved } from '../src/lessons/weather/ch1/L1_3';
import { COOL_LAPSE, STABLE_LAPSE, breaksThrough, oscillationPeriodMin, periodSolved } from '../src/lessons/weather/ch1/L1_4';
import { DEEP_LOW, STORM_DEFAULTS, geostrophicSolved, windAtFenwick } from '../src/lessons/weather/ch1/L1_5';

describe('1.1 Earth’s energy balance', () => {
  it('points from Fenwick Bay’s first mention to the region map in Lesson 2.2', () => {
    const view = render(createElement(Lesson11));
    const link = Array.from(view.container.querySelectorAll('a')).find((a) => a.getAttribute('href') === '#/weather/2.2');
    expect(link?.textContent).toBe('Lesson 2.2');
    cleanup();
  });

  it('the poleward transport peaks across 33°', () => {
    const b = latitudeBalance(0.6);
    expect(b.peakTransportPW).toBeCloseTo(5.7, 1);
    expect(Math.round(b.peakLat)).toBe(33);
    expect(Math.round(b.balanceLat)).toBe(33);
  });
});

describe('1.2 Air temperature, pressure, and density', () => {
  it('the parcel falls behind the standard atmosphere by a little over 3 °C per km', () => {
    const at = (z: number) => liftedParcel(z, 0).gap;
    const perKm13 = (at(1) - at(3)) / 2;
    expect(perKm13).toBeGreaterThan(3);
    expect(perKm13).toBeLessThan(3.2);
    // With a 3 °C head start the lead runs out just above 900 m: a little over 3 °C per km.
    expect(thermalTopSolved({ height: 0.9, head: 3 })).toBe(true);
    const rate = (3 - liftedParcel(0.9, 3).gap) / 0.9;
    expect(rate).toBeGreaterThan(3);
    expect(rate).toBeLessThan(3.5);
  });
});

describe('1.3 Water vapor and phase changes', () => {
  it('the dew-point readout follows the vapor left after condensation', () => {
    const afternoon = airState(AFTERNOON_AIR);
    expect(afternoon.dew).toBeCloseTo(19.04, 2);
    expect(afternoon.dew0).toBeCloseTo(afternoon.dew, 9);
    const cooled = airState({ ...AFTERNOON_AIR, tC: 15 });
    expect(cooled.liquid).toBeCloseTo(1.1, 1);
    expect(cooled.tC).toBeCloseTo(17.8, 1);
    // Saturated: its dew point is its temperature, not the 19.0 °C it started with.
    expect(cooled.dew).toBeCloseTo(cooled.tC, 6);
    expect(cooled.dew0).toBeCloseTo(19.04, 2);
  });
  it('challenge a: either half-degree step beside the dew point solves it', () => {
    expect(dewPointSolved(AFTERNOON_AIR)).toBe(false);
    expect(dewPointSolved({ ...AFTERNOON_AIR, tC: 19 })).toBe(true);
    expect(dewPointSolved({ ...AFTERNOON_AIR, tC: 19.5 })).toBe(true);
    expect(dewPointSolved({ ...AFTERNOON_AIR, tC: 18.5 })).toBe(false);
    expect(dewPointSolved({ ...AFTERNOON_AIR, tC: 20 })).toBe(false);
    expect(dewPointSolved({ ...AFTERNOON_AIR, tC: 19, w: 13 })).toBe(false);
    // The success message's numbers.
    const atDew = airState({ ...AFTERNOON_AIR, tC: 19 });
    expect(atDew.liquid).toBeGreaterThan(0.005);
    expect(atDew.liquid).toBeLessThan(0.015);
    expect(Math.round(airState({ ...AFTERNOON_AIR, tC: 19.5 }).rh * 100)).toBe(97);
  });
});

describe('1.4 Atmospheric stability and convection', () => {
  it('challenge a holds the dew point, lapse rate and cap at their starting values', () => {
    expect(capConditionsKept(CONVECTION_DEFAULTS)).toBe(true);
    expect(capSolved(CONVECTION_DEFAULTS)).toBe(false);
    expect(capSolved({ ...CONVECTION_DEFAULTS, surfaceC: 30.5 })).toBe(true);
    expect(capSolved({ ...CONVECTION_DEFAULTS, surfaceC: 30 })).toBe(false);
    // Shortcuts that used to pass: changing the conditions the question says to keep.
    expect(capSolved({ ...CONVECTION_DEFAULTS, lapse: 7.1 })).toBe(false);
    expect(capSolved({ ...CONVECTION_DEFAULTS, dewC: 18, surfaceC: 24.5 })).toBe(false);
    expect(capSolved({ ...CONVECTION_DEFAULTS, cap: 2, surfaceC: 25 })).toBe(false);
  });
  it('at the start, the cloud’s own lift carries the thermal into the cap, but not through it', () => {
    const a = convectionAscent(CONVECTION_DEFAULTS);
    const lift = lowCloudLift(a);
    expect(lift.gapC).toBeCloseTo(2.3, 1);
    expect(lift.atKm).toBeCloseTo(1.5, 1);
    const top = thermalTopM(CONVECTION_DEFAULTS) / 1000;
    expect(top).toBeGreaterThan(CAP_LAYER.baseKm + CAP_LAYER.depthKm);
    expect(top).toBeCloseTo(2.2, 1);
  });
  it('at 32 °C the storm tops out below the tropopause and overshoots above it', () => {
    const a = convectionAscent({ ...CONVECTION_DEFAULTS, surfaceC: 32 });
    expect(a.elKm!).toBeLessThan(TROPOPAUSE_KM);
    expect(thermalTopM({ ...CONVECTION_DEFAULTS, surfaceC: 32 }) / 1000).toBeGreaterThan(TROPOPAUSE_KM);
  });
});

describe('1.5 Pressure gradients and rotation', () => {
  it('heating the land raises the pressure aloft, not at the ground', () => {
    const b = seaBreeze(BREEZE_DEFAULTS.deltaC, 'heated');
    expect(b.landSurface).toBe(SEA_BREEZE.p0);
    expect(b.seaSurface).toBe(SEA_BREEZE.p0);
    expect(b.landAt(ALOFT_M) - b.seaAt(ALOFT_M)).toBeCloseTo(1.8, 1);
  });
  it('once air moves aloft, the surface pressure falls over the land and rises over the sea', () => {
    const b = seaBreeze(BREEZE_DEFAULTS.deltaC, 'moving');
    expect(b.landSurface).toBeCloseTo(1012.5, 1);
    expect(b.seaSurface).toBeCloseTo(1013.5, 1);
    expect(b.landSurface + b.seaSurface).toBeCloseTo(2 * SEA_BREEZE.p0, 9);
    expect(b.landAt(b.levelM)).toBeCloseTo(b.seaAt(b.levelM), 9);
    // Aloft the push still points out to sea.
    expect(b.landAt(ALOFT_M) - b.seaAt(ALOFT_M)).toBeGreaterThan(0.5);
  });
  it('a colder land reverses everything: a land breeze', () => {
    const b = seaBreeze(-3, 'moving');
    expect(b.landSurface).toBeGreaterThan(b.seaSurface);
    expect(b.landAt(ALOFT_M)).toBeLessThan(b.seaAt(ALOFT_M));
    const same = seaBreeze(0, 'moving');
    expect(same.landSurface).toBe(same.seaSurface);
  });
  it('pressure levels sit higher over the warm land', () => {
    const b = seaBreeze(5, 'heated');
    expect(b.landHeightOf(900) - b.seaHeightOf(900)).toBeCloseTo(17, 0);
    expect(b.seaAt(b.seaHeightOf(900))).toBeCloseTo(900, 6);
    expect(b.landAt(b.landHeightOf(900))).toBeCloseTo(900, 6);
  });
  it('with friction, the released parcel drifts 685 km toward lower pressure in two days', () => {
    const track = windTrack(1, 41, 5.5e-5, 48, 10);
    expect(Math.round(track[track.length - 1].y)).toBe(685);
  });
});

// ---------------------------------------------------------------------------
// Fix pass 2: the predict-then-check challenges and the numbers their prompts rely on.

describe('pass 2: 1.1 predict-then-check', () => {
  const today = { solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO };
  it('challenge a: 390 − 238 = 152 W/m² of back-radiation, from an atmosphere absorbing 78%', () => {
    expect(fmt(SIGMA * 288 ** 4)).toBe('390');
    expect(fmt(planetBalance({ ...today, absorptivity: 0 }).absorbed)).toBe('238');
    expect(fmt(backRadiationNeeded())).toBe('152');
    // The atmosphere sends half of what it absorbs back down: 2 × 152 / 390 ≈ 0.78.
    expect((2 * backRadiationNeeded()) / (SIGMA * 288 ** 4)).toBeCloseTo(0.78, 2);
    const at78 = planetBalance({ ...today, absorptivity: 0.78 });
    expect(fmt(at78.backRadiation)).toBe('152');
    expect(fmt(0.78 * at78.surfaceEmission)).toBe('305');
    expect(greenhouseSolved({ ...today, absorptivity: 0 })).toBe(false);
    expect(greenhouseSolved({ ...today, absorptivity: 0.78 })).toBe(true);
    expect(greenhouseSolved({ ...today, absorptivity: 0.77 })).toBe(false);
    expect(greenhouseSolved({ ...today, absorptivity: 0.79 })).toBe(false);
    expect(greenhouseSolved({ solar: 1360, albedo: EARTH_ALBEDO, absorptivity: 0.78 })).toBe(false);
  });
  it('the prose’s 0.2 W/m² per °C: 3.4 PW across 32°, where the curves cross, and 41° near 6 °C', () => {
    const q = latitudeBalance(QUOTED_TRANSPORT);
    expect(fmt(q.peakTransportPW, 1)).toBe('3.4');
    expect(fmt(q.peakLat)).toBe('32');
    expect(fmt(q.balanceLat)).toBe('32');
    expect(fmt(tempAtLatitude(q, 41))).toBe('6');
  });
  it('challenge b: a proportional guess (0.30–0.36) falls short; 0.45–0.65 carries 5–6 PW', () => {
    const q = latitudeBalance(QUOTED_TRANSPORT);
    expect(fmt((5 / q.peakTransportPW) * QUOTED_TRANSPORT, 2)).toBe('0.30');
    expect(fmt((6 / q.peakTransportPW) * QUOTED_TRANSPORT, 2)).toBe('0.36');
    expect(transportSolved(0)).toBe(false);
    for (const d of [0.3, 0.35, 0.4]) expect(transportSolved(d)).toBe(false);
    for (const d of [0.45, 0.5, 0.6, 0.65]) expect(transportSolved(d)).toBe(true);
    expect(transportSolved(0.7)).toBe(false);
  });
});

describe('pass 2: 1.2 predict-then-check', () => {
  it('challenge b: a 3 °C lead lost at a little over 3 °C per km runs out at 900 m', () => {
    expect(thermalTopSolved({ height: 0, head: 0 })).toBe(false);
    expect(thermalTopSolved({ height: 0.9, head: 3 })).toBe(true);
    expect(thermalTopSolved({ height: 0.8, head: 3 })).toBe(false);
    expect(thermalTopSolved({ height: 1.0, head: 3 })).toBe(false);
  });
});

describe('pass 2: 1.3 predict-then-check', () => {
  it('challenge a: air about half saturated at 30 °C has its dew point a little more than 10 °C lower', () => {
    const dew = airState(AFTERNOON_AIR).dew;
    const ratio = satVaporPressure(30) / satVaporPressure(dew);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2);
    expect(30 - dew).toBeGreaterThan(10);
    expect(30 - dew).toBeLessThan(11.5);
    expect(dewPointSolved(AFTERNOON_AIR)).toBe(false);
    // After the challenge, the prose compares the dew point at 850 hPa.
    expect(fmt(dewPoint(vaporPressure(AFTERNOON_AIR.w / 1000, 850)), 1)).toBe('16.5');
    expect(fmt(dew, 1)).toBe('19.0');
  });
  it('challenge b: 28 − 1,000 ÷ 120 ≈ 19.7, so 19.5 or 20 °C, and nothing else', () => {
    expect(28 - 1000 / 120).toBeCloseTo(19.67, 2);
    expect(cloudBaseSolved(25, 15)).toBe(false);
    expect(cloudBaseSolved(28, 19.5)).toBe(true);
    expect(cloudBaseSolved(28, 20)).toBe(true);
    expect(cloudBaseSolved(28, 19)).toBe(false);
    expect(cloudBaseSolved(28, 20.5)).toBe(false);
    expect(lcl(28, 19.5, 1000).heightM).toBeCloseTo(1035, 0);
  });
});

describe('pass 2: 1.4 stability classes and the square-root rule', () => {
  it('4 °C per km aloft is absolutely stable; 7.5 lets the morning thermal through; so does taking the cap away', () => {
    const stable = convectionAscent({ ...CONVECTION_DEFAULTS, lapse: STABLE_LAPSE });
    const i = Math.floor(stable.lclKm / (stable.z[1] - stable.z[0]) + 1e-9);
    expect(stabilityClass(STABLE_LAPSE, moistLapseRate(stable.parcel[i], stable.p[i]))).toBe('absolutely stable');
    expect(stable.cape).toBe(0);
    expect(stable.lfcKm).toBeNull();
    const cool = convectionAscent({ ...CONVECTION_DEFAULTS, lapse: COOL_LAPSE });
    expect(Math.round(cool.cape)).toBe(1701);
    expect(Math.round(cool.cin)).toBe(19);
    expect(breaksThrough({ ...CONVECTION_DEFAULTS, lapse: COOL_LAPSE })).toBe(true);
    expect(convectionAscent({ ...CONVECTION_DEFAULTS, cap: 0 }).cin).toBe(0);
    expect(breaksThrough({ ...CONVECTION_DEFAULTS, cap: 0 })).toBe(true);
    expect(breaksThrough(CONVECTION_DEFAULTS)).toBe(false);
  });
  it('challenge b: a gap a quarter as wide, 9.8 − 3.3 ÷ 4 ≈ 9.0 °C per km, doubles the period', () => {
    const p65 = oscillationPeriodMin(6.5)!;
    // The rule the prose states, checked against its 4 °C per km example.
    expect(p65 * Math.sqrt(3.3 / 5.8)).toBeCloseTo(oscillationPeriodMin(4)!, 1);
    expect(9.8 - 3.3 / 4).toBeCloseTo(8.975, 3);
    expect(periodSolved(6.5)).toBe(false);
    expect(periodSolved(8.9)).toBe(true);
    expect(periodSolved(9)).toBe(true);
    expect(periodSolved(8.8)).toBe(false);
    expect(periodSolved(9.1)).toBe(false);
  });
});

describe('pass 2: 1.5 predict-then-check', () => {
  it('challenge a: 20 ÷ 8.7 ≈ 2.3 hPa per 100 km', () => {
    expect(fmt(geostrophicSpeed(1, 41), 1)).toBe('8.7');
    expect(fmt(20 / geostrophicSpeed(1, 41), 1)).toBe('2.3');
    expect(geostrophicSolved(1, 41)).toBe(false);
    expect(geostrophicSolved(2.3, 41)).toBe(true);
    expect(geostrophicSolved(2.2, 41)).toBe(false);
    expect(geostrophicSolved(2.4, 41)).toBe(false);
  });
  it('a low twice as deep doubles the wind at Fenwick Bay', () => {
    const start = windAtFenwick(STORM_DEFAULTS);
    const deep = windAtFenwick({ ...STORM_DEFAULTS, depth: DEEP_LOW });
    expect(deep.speed / start.speed).toBeCloseTo(2, 2);
    expect(fmt(start.speed)).toBe('20');
    expect(fmt(deep.speed)).toBe('39');
  });
});
