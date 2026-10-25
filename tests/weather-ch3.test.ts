// Weather chapter 3: the claims the lessons' prose and challenges make about the model.

import { describe, expect, it } from 'vitest';
import { radarLook } from '../src/engines/weather/remote';
import { NO_FAULTS, monthBias, sunTimes, trueDay } from '../src/engines/weather/sensors';
import { RAW_SPREAD, calibrationStats, plume, winterDay } from '../src/engines/weather/calibration';
import { LYAPUNOV } from '../src/engines/weather/lorenz';
import { YEARS, dayInfo, knownShare, monthDays } from '../src/model/weather/archive';
import { FAULT_DEFAULTS, STATION_DEFAULTS, SHIELD_FAULT, WINTER_MONTHS, correctionSolved, dayOf, gapOf, gapSolved, neighbors, type DayChoice } from '../src/lessons/weather/ch3/L3_1';
import {
  CHALLENGE_FREEZING_KM,
  OPAQUE_TARGET,
  RADAR_DEFAULTS,
  SAT_DEFAULTS,
  SAT_LAPSE,
  STORM_RAIN_MMH,
  beamShares,
  maxLeak,
  opaqueSolved,
  rainBeamSolved,
  rainLimitKm,
  satView,
  stormOf,
} from '../src/lessons/weather/ch3/L3_2';
import { CFL_WIND, FORECAST_DEFAULTS, RUN_HOURS, blowUpHour, courantNumber, skillOf, stepSolved } from '../src/lessons/weather/ch3/L3_3';
import {
  EXP_DEFAULT,
  EXP_STEP,
  SPREAD_DEFAULT,
  START_DEFAULT,
  START_MAX,
  START_MIN,
  START_STEP,
  STEADY_BEFORE,
  TOGETHER_UNTIL,
  ensembleRun,
  pointAt,
  staysTogether,
  steadySolved,
  togetherSolved,
  twinRuns,
} from '../src/lessons/weather/ch3/L3_4';
import {
  CAL_DEFAULTS,
  INFLATION_GRID,
  PLUME_DEFAULTS,
  bestCrps,
  calSettings,
  calibrationSolved,
  climateLeadSolved,
  crpsByInflation,
  flatRange,
  spreadShare,
} from '../src/lessons/weather/ch3/L3_5';

/** Every winter day in the archive, with its gap, its warm-up and when its extremes come. */
function winterDays() {
  const out: Array<{ st: DayChoice; gap: number; rise: number; iMin: number; iMax: number; sunrise: number; above: number }> = [];
  for (let year = 1; year <= YEARS; year++)
    for (const month of WINTER_MONTHS) {
      const { start, days } = monthDays(year, month);
      for (let dom = 1; dom <= days; dom++) {
        const st = { year, month, dom };
        const day = trueDay(start + dom - 1);
        const t = day.hours.map((h) => h.trueF);
        const nb = neighbors(st);
        out.push({
          st,
          gap: gapOf(st),
          rise: nb.after - nb.before,
          iMin: t.indexOf(Math.min(...t)),
          iMax: t.indexOf(Math.max(...t)),
          sunrise: sunTimes(dayInfo(start + dom - 1).doy).sunrise,
          above: t.filter((v) => v > day.officialMeanF).length,
        });
      }
    }
  return out;
}

describe('weather 3.1: measuring the atmosphere', () => {
  it('opens on the cold outbreak of January 11, year 10, the archive’s widest January gap', () => {
    const day = trueDay(dayOf(STATION_DEFAULTS));
    const t = day.hours.map((h) => h.trueF);
    const nb = neighbors(STATION_DEFAULTS);
    expect(nb.before).toBeCloseTo(47.1, 1);
    expect(nb.after).toBeCloseTo(16.9, 1);
    expect(gapOf(STATION_DEFAULTS)).toBeCloseTo(1.43, 2);
    // Maximum in the first hour, by a whisker over the afternoon peak; minimum in the last.
    expect(t.indexOf(Math.max(...t))).toBe(0);
    expect(t.indexOf(Math.min(...t))).toBe(23);
    const dawnH = 3 + t.slice(3, 11).indexOf(Math.min(...t.slice(3, 11)));
    const peakH = 11 + t.slice(11, 19).indexOf(Math.max(...t.slice(11, 19)));
    expect(dawnH).toBe(7);
    expect(dawnH).toBeLessThan(sunTimes(dayInfo(dayOf(STATION_DEFAULTS)).doy).sunrise);
    expect(peakH).toBe(14);
    expect(t[0] - t[peakH]).toBeGreaterThan(0);
    expect(t[0] - t[peakH]).toBeLessThan(0.3);
    expect(t.filter((v) => v > day.officialMeanF).length).toBe(14);
    // Pressure falls through the day; the wind is from the northwest.
    expect(day.hours[23].pressureHpa).toBeLessThan(day.hours[0].pressureHpa);
    expect(day.hours[0].windFrom).toBe(315);
    // No January in the archive has a wider gap.
    let max = 0;
    for (let y = 1; y <= YEARS; y++) {
      const { start, days } = monthDays(y, 0);
      for (let i = 0; i < days; i++) max = Math.max(max, Math.abs(trueDay(start + i).hourlyMeanF - trueDay(start + i).officialMeanF));
    }
    expect(max).toBeCloseTo(gapOf(STATION_DEFAULTS), 9);
  });
  it('challenge a: a warming winter day with the two means at least 0.4 °F apart', () => {
    expect(gapSolved(STATION_DEFAULTS)).toBe(false); // cooling, though its gap is wide
    expect(gapSolved({ year: 10, month: 0, dom: 10 })).toBe(false); // cooling, gap 0.46
    expect(gapSolved({ year: 10, month: 0, dom: 13 })).toBe(false); // warming, gap 0.36
    expect(gapSolved({ year: 10, month: 1, dom: 4 })).toBe(false); // warming, gap 0.39
    expect(gapSolved({ year: 10, month: 0, dom: 23 })).toBe(true); // warming 26 °F, gap 0.54
    expect(gapSolved({ year: 10, month: 1, dom: 3 })).toBe(true);
    const all = winterDays();
    const warming = all.filter((d) => d.rise > 0);
    const solutions = all.filter((d) => gapSolved(d.st));
    expect(solutions.length).toBeGreaterThan(25);
    expect(solutions.length).toBeLessThan(60);
    // The success message's claims: on every warming day the average is at least as warm as the official mean,
    // wider the faster it warms; on the solutions the minimum comes before sunrise.
    for (const d of warming) expect(d.gap).toBeGreaterThanOrEqual(-1e-9);
    const band = (lo: number, hi: number) => warming.filter((d) => d.rise >= lo && d.rise < hi).map((d) => d.gap);
    for (const [a, b, c] of [[0, 5, 10], [5, 10, 15], [10, 15, 20], [15, 20, 25]]) expect(Math.max(...band(a, b))).toBeLessThanOrEqual(Math.min(...band(b, c)) + 1e-9);
    for (const d of solutions) {
      expect(d.gap).toBeGreaterThan(0);
      expect(d.iMin).toBeLessThan(d.sunrise);
      expect(d.above).toBeGreaterThan(12);
    }
  });
  it('challenge b: half of January’s 0.4 °F maximum error predicts the offset, and July is left about 0.6 °F off', () => {
    const jan = monthBias(0, { ...NO_FAULTS, unshielded: SHIELD_FAULT });
    expect(jan.max).toBeCloseTo(0.36, 2);
    expect(jan.mean).toBeCloseTo(jan.max / 2, 6);
    expect(correctionSolved({ ...NO_FAULTS, drift: FAULT_DEFAULTS.drift, unshielded: SHIELD_FAULT })).toBe(false);
    expect(correctionSolved({ unshielded: SHIELD_FAULT, heatIsland: 0, drift: -0.2 })).toBe(true);
    expect(correctionSolved({ unshielded: SHIELD_FAULT, heatIsland: 0, drift: -0.15 })).toBe(true);
    expect(correctionSolved({ unshielded: SHIELD_FAULT, heatIsland: 0, drift: -0.1 })).toBe(false);
    expect(correctionSolved({ unshielded: SHIELD_FAULT, heatIsland: 0, drift: -0.25 })).toBe(false);
    expect(monthBias(6, { unshielded: SHIELD_FAULT, heatIsland: 0, drift: -0.2 }).mean).toBeCloseTo(0.6, 2);
  });
  it('moves July’s mean by more than half the missing shield’s maximum error, because the minimum is sunlit too', () => {
    const jul = monthBias(6, { ...NO_FAULTS, unshielded: SHIELD_FAULT });
    expect(jul.min).toBeGreaterThan(0.3);
    expect(jul.mean).toBeGreaterThan(jul.max / 2 + 0.1);
    const jan = monthBias(0, { ...NO_FAULTS, unshielded: SHIELD_FAULT });
    expect(jan.min).toBeCloseTo(0, 6);
  });
});

describe('weather 3.2: remote sensing', () => {
  it('reads the default storm close to the truth only because the bright band and the ice cancel', () => {
    const shares = beamShares(RADAR_DEFAULTS);
    expect(shares.rain).toBeGreaterThan(0.4);
    expect(shares.rain).toBeLessThan(0.6);
    expect(shares.melt).toBeGreaterThan(0.1);
    expect(shares.ice).toBeGreaterThan(0.3);
    const look = radarLook(stormOf(RADAR_DEFAULTS), RADAR_DEFAULTS.elevDeg);
    expect(Math.abs(look.estimatedMmH / look.trueMmH - 1)).toBeLessThan(0.1);
  });
  it('places thin cirrus at a mid-level height', () => {
    const v = satView(SAT_DEFAULTS);
    expect(v.inferredKm).toBeGreaterThan(2);
    expect(v.inferredKm).toBeLessThan(7);
  });
  it('gives the same percentage error at any rain rate, so the rain slider was dropped', () => {
    const err = (rain: number) => {
      const look = radarLook(stormOf(RADAR_DEFAULTS, rain), RADAR_DEFAULTS.elevDeg);
      return look.estimatedMmH / look.trueMmH;
    };
    expect(err(2)).toBeCloseTo(err(STORM_RAIN_MMH), 6);
    expect(err(100)).toBeCloseTo(err(STORM_RAIN_MMH), 6);
  });
  it('challenge a: with a 2 km freezing level the beam stays in the rain to 70 km, against 105 at 3 km', () => {
    expect(CHALLENGE_FREEZING_KM).toBe(2);
    expect(rainLimitKm(3)).toBe(105);
    expect(rainLimitKm(2)).toBe(70);
    expect(rainBeamSolved(RADAR_DEFAULTS)).toBe(false);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2 })).toBe(false);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2, rangeKm: 70 })).toBe(true);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2, rangeKm: 65 })).toBe(false);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, freezingKm: 2, rangeKm: 75 })).toBe(false);
    expect(rainBeamSolved({ ...RADAR_DEFAULTS, rangeKm: 105 })).toBe(false);
  });
  it('challenge b: σT⁴ lets less than a tenth leak through — under 7% — so the answer is 2.7', () => {
    const allowed = maxLeak(OPAQUE_TARGET.topKm, OPAQUE_TARGET.withinKm);
    expect(allowed).toBeLessThan(0.1);
    expect(allowed).toBeCloseTo(0.069, 3);
    expect(SAT_LAPSE * OPAQUE_TARGET.withinKm).toBeCloseTo((20 - satView(SAT_DEFAULTS).cloudC) / 10, 9);
    const leak = (tau: number) => 1 - satView({ topKm: 10, tau }).emissivity;
    expect(leak(2.7)).toBeLessThan(allowed);
    expect(leak(2.6)).toBeGreaterThan(allowed);
    expect(opaqueSolved(SAT_DEFAULTS)).toBe(false);
    expect(opaqueSolved({ topKm: 10, tau: 2.7 })).toBe(true);
    expect(opaqueSolved({ topKm: 10, tau: 2.6 })).toBe(false);
    expect(opaqueSolved({ topKm: 10, tau: 2.8 })).toBe(false);
    expect(opaqueSolved({ topKm: 10, tau: 1.2 })).toBe(false); // a tenth leaking through
    // The dropped ground-temperature slider hardly mattered.
    expect(Math.abs(satView(SAT_DEFAULTS, -10).inferredKm - satView(SAT_DEFAULTS, 35).inferredKm)).toBeLessThan(0.2);
  });
});

describe('weather 3.3: numerical weather prediction', () => {
  it('challenge a: at 15 m/s the longest stable step is 1.5 h, and a quarter hour more blows up within the run', () => {
    expect(CFL_WIND).toBe(15);
    expect(stepSolved(1, 12)).toBe(false);
    expect(stepSolved(1, CFL_WIND)).toBe(false);
    expect(stepSolved(1.25, CFL_WIND)).toBe(false);
    expect(stepSolved(1.5, CFL_WIND)).toBe(true);
    expect(stepSolved(1.75, CFL_WIND)).toBe(false);
    expect(courantNumber(CFL_WIND, 1.5)).toBeLessThan(0.97);
    expect(blowUpHour(CFL_WIND, 1.5)).toBeNull();
    const h = blowUpHour(CFL_WIND, 1.75);
    expect(h).not.toBeNull();
    expect(h!).toBeLessThanOrEqual(RUN_HOURS);
  });
  it('smears more with a shorter step, as 1 − C grows', () => {
    expect(1 - courantNumber(12, 1)).toBeCloseTo(0.49, 2);
    expect(1 - courantNumber(12, 0.25)).toBeCloseTo(0.87, 2);
  });
  it('keeps a perfect model’s error small for ten days; development (model error) makes it grow', () => {
    const perfect = skillOf({ ...FORECAST_DEFAULTS, ocean: 4, evolution: 0 });
    expect(Math.max(...perfect.rms)).toBeLessThan(1.05);
    const ships = skillOf({ ...FORECAST_DEFAULTS, ocean: 4 });
    expect(ships.rms[ships.rms.length - 1]).toBeGreaterThan(3 * Math.max(...perfect.rms));
  });
});

describe('weather 3.4: chaos and forecast uncertainty', () => {
  it('challenge a: the average rate estimates 3 × 10⁻⁷; 10⁻⁶ is the largest error that works', () => {
    const atDefault = twinRuns(EXP_DEFAULT).parted!;
    const est = Math.round((EXP_DEFAULT - ((TOGETHER_UNTIL - atDefault) * LYAPUNOV) / Math.LN10) / EXP_STEP) * EXP_STEP;
    expect(est).toBe(-6.5);
    expect(staysTogether(est)).toBe(true);
    expect(togetherSolved(-6)).toBe(true);
    expect(togetherSolved(est)).toBe(false);
    expect(togetherSolved(EXP_DEFAULT)).toBe(false);
  });
  it('has exactly one solution to challenge b, just past the junction at 3', () => {
    const solutions: number[] = [];
    for (let s = START_MIN; s <= START_MAX + 1e-9; s += START_STEP) if (steadySolved(s, SPREAD_DEFAULT)) solutions.push(s);
    expect(solutions).toEqual([3.25]);
    expect(steadySolved(START_DEFAULT, SPREAD_DEFAULT)).toBe(false);
    expect(START_DEFAULT + START_STEP).toBeGreaterThanOrEqual(STEADY_BEFORE);
    // A quarter earlier the run is crossing between the wings, and the cloud comes apart fast.
    expect(Math.abs(pointAt(3).x)).toBeLessThan(2);
    expect(ensembleRun(3, SPREAD_DEFAULT).loosened!).toBeLessThan(1);
  });
});

describe('weather 3.5: ensemble forecasting', () => {
  it('challenge a: the spread is √(unknown share) and first reaches 90% of the climate’s at 9 days', () => {
    expect(climateLeadSolved(PLUME_DEFAULTS.lead)).toBe(false);
    expect(climateLeadSolved(8)).toBe(false);
    expect(climateLeadSolved(9)).toBe(true);
    expect(climateLeadSolved(10)).toBe(false);
    const p = plume(winterDay(PLUME_DEFAULTS.winter, PLUME_DEFAULTS.offset), PLUME_DEFAULTS.members);
    p.sd.forEach((sd, i) => expect(sd / p.climSd[i]).toBeCloseTo(spreadShare(i + 1), 6));
    expect(spreadShare(5)).toBeCloseTo(Math.sqrt(1 - knownShare(5)), 9);
    // Interpolating Lesson 3.3's 53% at five days and 11% at ten to the 19% known at 90% spread points to day 9.
    const k5 = knownShare(5);
    const k10 = knownShare(10);
    expect(Math.round(5 + (5 * (k5 - 0.19)) / (k5 - k10))).toBe(9);
  });
  it('challenge b: the prediction 1 ÷ 0.6 lands on the curve’s low point', () => {
    const k = Math.round((1 / RAW_SPREAD) * 20) / 20;
    expect(calibrationSolved({ lead: 5, inflation: k, bias: 0 })).toBe(true);
    expect(calibrationSolved({ lead: 5, inflation: 1.7, bias: 0 })).toBe(true);
  });
  it('draws a CRPS curve whose minimum sits near 1 ÷ RAW_SPREAD', () => {
    const c = crpsByInflation(5, 0);
    expect(c).toHaveLength(INFLATION_GRID.length);
    const k = INFLATION_GRID[c.indexOf(Math.min(...c))];
    expect(Math.abs(k - 1 / RAW_SPREAD)).toBeLessThan(0.1);
    expect(Math.min(...c)).toBeCloseTo(bestCrps(5), 9);
  });
  it('has a flat bottom: ×1.4 to ×2 within 1% of the best at five days, though badly calibrated at both ends', () => {
    expect(flatRange(5)).toEqual({ lo: 1.4, hi: 2 });
    const out = (inflation: number) => calibrationStats(calSettings({ lead: 5, inflation, bias: 0 })).outside;
    expect(out(1.4)).toBeGreaterThan(0.15);
    expect(out(2)).toBeLessThan(0.08);
  });
  it('keeps challenge b unsolved at the default and solved at the calibrated spread', () => {
    expect(calibrationSolved(CAL_DEFAULTS)).toBe(false);
    expect(calibrationSolved({ lead: 5, inflation: 1.65, bias: 0 })).toBe(true);
    expect(calibrationSolved({ lead: 5, inflation: 1.4, bias: 0 })).toBe(false);
  });
  it('lifts nearly the whole reliability curve with a +3 °F bias, all but the top bin', () => {
    const st = calibrationStats(calSettings({ lead: 5, inflation: 1, bias: 3 }));
    const bins = st.reliability.filter((b) => b.count > 0);
    const top = bins[bins.length - 1];
    expect(top.observed).toBeLessThan(top.forecast);
    for (const b of bins.slice(0, -1)) expect(b.observed).toBeGreaterThan(b.forecast);
  });
  it('freezes on about 39% of winter days', () => {
    const st = calibrationStats({ lead: 1, threshold: 32, inflation: 1 / RAW_SPREAD, bias: 0, members: 20 });
    expect(Math.round(st.baseRate * 100)).toBe(39);
  });
});
