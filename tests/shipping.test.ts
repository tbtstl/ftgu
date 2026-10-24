// The shipping course: its engines, its world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import { ALBATROSS, KESTREL, PETREL, RHO_FRESH, RHO_SEA, VESSEL_CLASSES } from '../src/model/shipping/vessels';
import {
  deadweight,
  displacementAt,
  draftFor,
  draftSurvey,
  freshWaterAllowanceMm,
  loadLines,
  maxCargo,
  summerDisplacement,
  tpc,
} from '../src/engines/shipping/hydrostatics';
import { calmResistance, froude, ittc57 } from '../src/engines/shipping/resistance';
import { FUELS, passage, powerAndFuel, sfocBest, speedForPower } from '../src/engines/shipping/propulsion';
import { CARGOES, equilibriumHeel, righting, smallAngleHeel, stabilityOf } from '../src/engines/shipping/stability';
import { CALM, beaufort, passageInWeather, speedInWeather, waveHeadingFactor } from '../src/engines/shipping/weather';
import { floating, freshLoadSolved, surveyResult } from '../src/lessons/shipping/ch1/L1_1';
import { CLEAN_14_KW, drag, foulingSolved, shipWavelength } from '../src/lessons/shipping/ch1/L1_2';
import { twelveDaySolved, voyageAt, PASSAGE_NM } from '../src/lessons/shipping/ch1/L1_3';
import { cargoLimit, listHeel, loadedState, uprightSolved, TRANSFER_MOMENT } from '../src/lessons/shipping/ch1/L1_4';
import { detourSolved, routes, STORM_MIN, STORM_MAX, laden } from '../src/lessons/shipping/ch1/L1_5';

const K = KESTREL;

describe('vessels', () => {
  it('have deadweights typical of their classes', () => {
    expect(K.dwt).toBeGreaterThan(80_000);
    expect(K.dwt).toBeLessThan(83_000);
    expect(ALBATROSS.dwt).toBeGreaterThan(175_000);
    expect(PETREL.dwt).toBeGreaterThan(60_000);
    for (const v of VESSEL_CLASSES) expect(v.dwt).toBeCloseTo(deadweight(v), -1);
  });
});

describe('hydrostatics', () => {
  it('floats a ship at the draft whose displacement equals its weight', () => {
    const d = draftFor(K, 60_000);
    expect(displacementAt(K, d)).toBeCloseTo(60_000, 6);
    expect(draftFor(K, summerDisplacement(K))).toBeCloseTo(K.designDraft, 9);
  });

  it('floats deeper in fresh water, by the fresh water allowance', () => {
    const disp = summerDisplacement(K);
    const extra = (draftFor(K, disp, RHO_FRESH) - draftFor(K, disp, RHO_SEA)) * 1000;
    // Δ/(4·TPC) assumes a density ratio of exactly 1.025 → 1.000.
    expect(extra).toBeCloseTo(freshWaterAllowanceMm(K), 0);
    expect(freshWaterAllowanceMm(K)).toBeCloseTo(361, 0);
    expect(tpc(K)).toBeCloseTo(64.7, 1);
  });

  it('places the seasonal marks a forty-eighth of the summer draft apart', () => {
    const m = loadLines(K);
    expect(m.T - m.S).toBeCloseTo(K.designDraft / 48, 9);
    expect(m.S - m.W).toBeCloseTo(K.designDraft / 48, 9);
    expect(m.F - m.S).toBeCloseTo(0.36125, 4);
  });

  it('recovers the cargo from a draft survey', () => {
    const before = { draft: draftFor(K, 47_000, 1.01), ballast: 33_000, consumables: 2_300 };
    const after = { draft: draftFor(K, 14_000 + 70_000, 1.01), ballast: 0, consumables: 2_300 };
    expect(draftSurvey(K, before, after, 1.01).cargo).toBeCloseTo(70_000, 6);
  });
});

describe('lesson 1.1', () => {
  it('the fresh-water loading challenge is solvable and exact', () => {
    expect(maxCargo(K, K.consumables)).toBeCloseTo(79_502.5, 0);
    expect(freshLoadSolved(79_500, K.cb, RHO_FRESH)).toBe(true);
    expect(freshLoadSolved(79_600, K.cb, RHO_FRESH)).toBe(false);
    expect(freshLoadSolved(79_300, K.cb, RHO_FRESH)).toBe(false);
    expect(freshLoadSolved(79_500, K.cb, RHO_SEA)).toBe(false);
    expect(floating(79_500, K.cb, RHO_FRESH).draft - K.designDraft).toBeCloseTo(0.361, 3);
  });

  it('the draft survey errs only by rounding unless the density is wrong', () => {
    for (const rho of [1.0, 1.005, 1.012, 1.025]) expect(Math.abs(surveyResult(72_000, 0, rho, false).error)).toBeLessThan(65);
    const wrong = surveyResult(72_000, 0, 1.012, true).cargo - surveyResult(72_000, 0, 1.012, false).cargo;
    expect(wrong).toBeCloseTo(501, -1);
  });
});

describe('resistance and propulsion', () => {
  it('uses the ITTC-1957 friction line', () => {
    expect(ittc57(1e9)).toBeCloseTo(0.075 / 49, 9);
  });

  it('needs about 80% of Kestrel’s engine for 14 knots laden in calm water', () => {
    const pf = powerAndFuel(K, 14, { draft: K.designDraft });
    expect(pf.load).toBeGreaterThan(0.75);
    expect(pf.load).toBeLessThan(0.85);
    expect(pf.totalTpd).toBeGreaterThan(30);
    expect(pf.totalTpd).toBeLessThan(37);
    expect(froude(K, 14)).toBeCloseTo(0.153, 3);
  });

  it('grows resistance faster than the square of speed and power nearly with the cube', () => {
    const r12 = calmResistance(K, 12, K.designDraft);
    const r14 = calmResistance(K, 14, K.designDraft);
    expect(r14.total / r12.total).toBeGreaterThan((14 / 12) ** 2 * 0.95);
    expect(r14.effectivePower / r12.effectivePower).toBeGreaterThan((14 / 12) ** 2.6);
    expect(r14.wave / r14.total).toBeGreaterThan(r12.wave / r12.total);
  });

  it('meets less resistance in ballast than laden', () => {
    const ballastDraft = draftFor(K, K.lightship + K.consumables + K.ballast);
    expect(calmResistance(K, 14, ballastDraft).total).toBeLessThan(calmResistance(K, 14, K.designDraft).total * 0.8);
  });

  it('turns thermal efficiency and calorific value into SFOC', () => {
    expect(sfocBest(0.5, FUELS.vlsfo)).toBeCloseTo(174.8, 1);
    // A tonne of LNG holds more energy than a tonne of oil, so less is burned.
    const lng = powerAndFuel(K, 14, { draft: K.designDraft, fuel: FUELS.lng }).totalTpd;
    const oil = powerAndFuel(K, 14, { draft: K.designDraft, fuel: FUELS.vlsfo }).totalTpd;
    expect(lng / oil).toBeCloseTo(FUELS.vlsfo.lcv / FUELS.lng.lcv, 2);
  });

  it('burns less fuel per voyage at lower speed, roughly with the square', () => {
    const slow = passage(K, 3600, 12, { draft: K.designDraft });
    const fast = passage(K, 3600, 14, { draft: K.designDraft });
    expect(fast.fuelTonnes).toBeGreaterThan(slow.fuelTonnes * 1.2);
    expect(fast.days).toBeCloseTo((3600 / 14 / 24), 9);
  });

  it('inverts power to speed', () => {
    const p = powerAndFuel(K, 13.2, { draft: K.designDraft }).brakePower;
    expect(speedForPower(K, p, { draft: K.designDraft })).toBeCloseTo(13.2, 4);
  });
});

describe('stability', () => {
  const full = (id: string) => {
    const c = CARGOES[id];
    const cargo = Math.min(maxCargo(K, K.consumables), (K.holdVolume ?? 0) / c.stowage);
    return stabilityOf(K, { cargo, cargoType: c, consumables: K.consumables, lowerBallast: 0, topsideBallast: 0 });
  };

  it('makes an ore-laden ship stiff and a grain-laden one gentler', () => {
    const ore = full('ore');
    const grain = full('grain');
    expect(ore.gm).toBeGreaterThan(6);
    expect(grain.gm).toBeGreaterThan(1);
    expect(grain.gm).toBeLessThan(4);
    expect(ore.rollPeriod).toBeLessThan(grain.rollPeriod);
    expect(grain.cargoVolume).toBeCloseTo(K.holdVolume ?? 0, -1);
  });

  it('raises G with topside ballast', () => {
    const base = { cargo: 0, cargoType: CARGOES.ore, consumables: K.consumables, lowerBallast: 10_000, topsideBallast: 0 };
    const lo = stabilityOf(K, base);
    const hi = stabilityOf(K, { ...base, lowerBallast: 0, topsideBallast: 10_000 });
    expect(hi.kg).toBeGreaterThan(lo.kg);
    expect(hi.displacement).toBeCloseTo(lo.displacement, 9);
  });

  it('agrees with the small-angle heel formula at small angles', () => {
    const s = full('coal');
    const m = 2_000;
    expect(equilibriumHeel(s, m)).toBeCloseTo(smallAngleHeel(s, m), 2);
    expect(righting(s, 0)).toBe(0);
  });
});

describe('weather', () => {
  it('slows a ship in head seas at constant power, and barely in following seas', () => {
    const calm = speedInWeather(K, CALM, 0.85, { draft: K.designDraft });
    const head = speedInWeather(K, { waveHeight: 5, windKn: 30, dirDeg: 0, currentKn: 0 }, 0.85, { draft: K.designDraft });
    const follow = speedInWeather(K, { waveHeight: 5, windKn: 30, dirDeg: 180, currentKn: 0 }, 0.85, { draft: K.designDraft });
    expect(head.stw).toBeLessThan(calm.stw - 3);
    expect(follow.stw).toBeGreaterThan(calm.stw - 0.2);
    expect(waveHeadingFactor(90)).toBeCloseTo(0.25, 9);
  });

  it('adds a current to speed over the ground only', () => {
    const w = speedInWeather(K, { ...CALM, currentKn: 1.5 }, 0.85, { draft: K.designDraft });
    expect(w.sog - w.stw).toBeCloseTo(1.5, 9);
    const r = passageInWeather(K, [{ nm: 1000, weather: CALM }, { nm: 500, weather: CALM }], 0.85, { draft: K.designDraft });
    expect(r.nm).toBe(1500);
  });

  it('names Beaufort forces', () => {
    expect(beaufort(0).force).toBe(0);
    expect(beaufort(35).name).toBe('gale');
    expect(beaufort(70).force).toBe(12);
  });
});

describe('lesson 1.2', () => {
  it('the fouled-hull challenge has one answer on the 0.1-knot grid: 12.6 knots', () => {
    expect(CLEAN_14_KW).toBeCloseTo(5180, 0);
    expect(foulingSolved(12.6, 1)).toBe(true);
    expect(foulingSolved(12.5, 1)).toBe(false);
    expect(foulingSolved(12.7, 1)).toBe(false);
    expect(foulingSolved(12.6, 0.95)).toBe(false);
    expect(drag(12.6, KESTREL.designDraft, KESTREL.cb, 1).effectivePower).toBeLessThanOrEqual(CLEAN_14_KW);
  });

  it('quotes the model’s numbers', () => {
    expect(drag(14).total).toBeCloseTo(719.2, 1);
    expect(shipWavelength(14)).toBeCloseTo(33.2, 1);
    expect(drag(14, KESTREL.designDraft, KESTREL.cb, 1).effectivePower / drag(14).effectivePower).toBeCloseTo(1.394, 2);
  });
});

describe('lesson 1.3', () => {
  it('the 12-day challenge is solved only at 12.5 knots, the slowest speed that makes the deadline', () => {
    expect(twelveDaySolved(12.5)).toBe(true);
    expect(twelveDaySolved(12.4)).toBe(false);
    expect(twelveDaySolved(12.6)).toBe(false);
    expect(twelveDaySolved(14)).toBe(false);
    expect(voyageAt(12.5).days).toBeCloseTo(PASSAGE_NM / (12.5 * 24), 9);
    expect(voyageAt(12.5).fuelTonnes).toBeCloseTo(296.7, 1);
  });

  it('voyage fuel rises with speed across the slider range, so arriving exactly on the deadline is cheapest', () => {
    let prev = 0;
    for (let i = 80; i <= 150; i++) {
      const f = voyageAt(i / 10).fuelTonnes;
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });
});

describe('lesson 1.4', () => {
  it('limits wheat by volume and ore and coal by deadweight', () => {
    expect(cargoLimit('ore')).toBe(79_500);
    expect(cargoLimit('coal')).toBe(79_500);
    expect(cargoLimit('grain')).toBe(74_600);
    expect(loadedState('coal', 79_500, 0, 0).gm).toBeCloseTo(2.5, 2);
    expect(loadedState('ore', 79_500, 0, 0).rollPeriod).toBeCloseTo(9.14, 2);
  });

  it('heels a tender ship more for the same moment, and cancels it with about 191 t of ballast', () => {
    expect(listHeel('grain', 600, 0)).toBeGreaterThan(listHeel('coal', 600, 0));
    expect(listHeel('coal', 600, 0)).toBeGreaterThan(listHeel('ore', 600, 0));
    expect(listHeel('coal', 600, 0)).toBeCloseTo(0.989, 2);
    expect((600 * 8) / TRANSFER_MOMENT).toBeCloseTo(190.8, 1);
    for (const id of ['ore', 'coal', 'grain'] as const) {
      expect(uprightSolved(id, 600, 0)).toBe(false);
      expect(uprightSolved(id, 600, 190)).toBe(true);
    }
    expect(uprightSolved('coal', 600, 170)).toBe(false);
    expect(uprightSolved('grain', 1500, 475)).toBe(true);
  });
});

describe('lesson 1.5', () => {
  it('has exactly one smallest storm at which the detour wins: 4.7 m', () => {
    const solutions: number[] = [];
    for (let i = Math.round(STORM_MIN * 10); i <= STORM_MAX * 10; i++) if (detourSolved(i / 10)) solutions.push(i / 10);
    expect(solutions).toEqual([4.7]);
    expect(routes(4.7).detour.days).toBeLessThan(routes(4.7).direct.days);
    expect(routes(4.6).detour.days).toBeGreaterThanOrEqual(routes(4.6).direct.days);
  });

  it('quotes the speeds the prose gives', () => {
    expect(laden({ waveHeight: 0, windKn: 0, dirDeg: 0, currentKn: 0 }).stw).toBeCloseTo(14.32, 2);
    expect(laden({ waveHeight: 4, windKn: 25, dirDeg: 0, currentKn: 0 }).stw).toBeCloseTo(11.37, 2);
    expect(laden({ waveHeight: 6, windKn: 35, dirDeg: 0, currentKn: 0 }).stw).toBeCloseTo(8.32, 2);
    expect(routes(3).direct.days).toBeLessThan(routes(3).detour.days);
  });
});
