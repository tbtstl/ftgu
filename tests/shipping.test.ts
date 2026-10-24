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
import { checkPassages, designShip, fuelPerKiloTonneMile, PASSAGES } from '../src/engines/shipping/design';
import { ALLOWABLE_MOMENT, holdPlan, hullStrength, laytime, pourOrder, simulateLoading } from '../src/engines/shipping/loading';
import { annualCargo, bestSpeed, freightForTce, speedForDayValue, voyageEstimate } from '../src/engines/shipping/voyage';
import { annuity, breakeven, dailyCost, OPEX, opexTotal } from '../src/engines/shipping/economics';
import { seaRoute, distanceMatrix } from '../src/engines/shipping/network';
import { ballastPlan } from '../src/engines/shipping/transport';
import { equilibrium, speedsAt, tripTce } from '../src/engines/shipping/market';
import { DEFAULT_CYCLE, replacementEarnings, shipValue, simulateCycle } from '../src/engines/shipping/cycle';
import { invest, irrAnnual } from '../src/engines/shipping/investment';
import { standardHistory, bunkerPath } from '../src/model/shipping/history';
import { MARKET_CLASSES, ROUTES, SEASON_BRAZIL_SOY } from '../src/model/shipping/trades';
import { LANES, PLACE, laneNm } from '../src/model/shipping/geo';
import { LAST_ORDER, YEARS, returnSolved } from '../src/lessons/shipping/ch2/L2_5';
import { floating, freshLoadSolved, surveyResult } from '../src/lessons/shipping/ch1/L1_1';
import { CLEAN_14_KW, drag, foulingSolved, shipWavelength } from '../src/lessons/shipping/ch1/L1_2';
import { twelveDaySolved, voyageAt, PASSAGE_NM } from '../src/lessons/shipping/ch1/L1_3';
import { cargoLimit, listHeel, loadedState, uprightSolved, TRANSFER_MOMENT } from '../src/lessons/shipping/ch1/L1_4';
import { detourSolved, routes, STORM_MIN, STORM_MAX, laden } from '../src/lessons/shipping/ch1/L1_5';
import { NEO_BEST, neopanamaxSolved } from '../src/lessons/shipping/ch2/L2_1';
import { fastSafeSolved, loadingRun } from '../src/lessons/shipping/ch2/L2_2';
import { restoreSolved, RESTORE_FREIGHT, TARGET_TCE, bestAt, voyageAt as voyageAt23, fleetPoint } from '../src/lessons/shipping/ch2/L2_3';
import { DEFAULTS as DEFAULTS24, CHALLENGE_TCE, costsFor, maxPriceFor, maxPriceSolved, agedShip, AGED } from '../src/lessons/shipping/ch2/L2_4';

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

describe('ship design', () => {
  it('sketches ships close to the reference classes', () => {
    const kam = designShip({ kind: 'bulk', loa: 229, beam: 32.25, draft: 14.45 });
    expect(kam.dwt).toBeGreaterThan(78_000);
    expect(kam.dwt).toBeLessThan(84_000);
    const vlcc = designShip({ kind: 'tanker', loa: 333, beam: 60, draft: 22.5 });
    expect(vlcc.capacity / 1e6).toBeGreaterThan(2);
    const box = designShip({ kind: 'container', loa: 366, beam: 51, draft: 15.2 });
    expect(box.capacity).toBeGreaterThan(13_000);
    expect(box.capacity).toBeLessThan(16_000);
  });

  it('measures Panama drafts in the locks’ fresh water', () => {
    const fits = designShip({ kind: 'bulk', loa: 366, beam: 51.25, draft: 14.86 });
    const tooDeep = designShip({ kind: 'bulk', loa: 366, beam: 51.25, draft: 14.9 });
    const neo = (d: ReturnType<typeof designShip>) => checkPassages(d).find((c) => c.passage.id === 'neopanamax')!;
    expect(neo(fits).laden).toBe(true);
    expect(neo(tooDeep).laden).toBe(false);
    expect(neo(tooDeep).fits).toBe(true);
    expect(PASSAGES.find((p) => p.id === 'panama')!.maxBeam).toBeCloseTo(32.31, 2);
  });

  it('a VLCC passes Suez only part-laden, a Capesize fully laden', () => {
    const vlcc = checkPassages(designShip({ kind: 'tanker', loa: 333, beam: 60, draft: 22.5 })).find((c) => c.passage.id === 'suez')!;
    expect(vlcc.fits && !vlcc.laden).toBe(true);
    const cape = checkPassages(designShip({ kind: 'bulk', loa: 292, beam: 45, draft: 18.2 })).find((c) => c.passage.id === 'suez')!;
    expect(cape.laden).toBe(true);
  });

  it('burns less fuel per tonne-mile in bigger ships', () => {
    const small = designShip({ kind: 'bulk', loa: 180, beam: 30, draft: 10.5 });
    const big = designShip({ kind: 'bulk', loa: 292, beam: 45, draft: 18.2 });
    expect(fuelPerKiloTonneMile(big, 13)).toBeLessThan(fuelPerKiloTonneMile(small, 13) * 0.75);
  });
});

describe('loading', () => {
  it('floats a full, even load near even keel and within the allowable moment', () => {
    const plan = holdPlan(KESTREL);
    const full = hullStrength(KESTREL, plan, Array(7).fill(79_500 / 7), 0);
    expect(Math.abs(full.trim)).toBeLessThan(0.5);
    expect(full.maxMoment).toBeLessThan(ALLOWABLE_MOMENT);
    expect(full.moment[full.moment.length - 1]).toBeCloseTo(0, -2);
    const ballast = hullStrength(KESTREL, plan, Array(7).fill(0), KESTREL.ballast);
    expect(ballast.trim).toBeGreaterThan(1);
  });

  it('works holds from midships outward', () => {
    expect(pourOrder(7)).toEqual([3, 2, 4, 1, 5, 0, 6]);
  });

  it('overstresses the hull if holds are filled one at a time, not if loaded in passes', () => {
    const base = { cargo: 79_500, loaders: 2, loaderRate: 4_000, pumpRate: 4_000, ballast: 33_000, shiftHours: 0.5 };
    const one = simulateLoading({ ...base, passes: 1 });
    const two = simulateLoading({ ...base, passes: 2 });
    expect(one.peakMoment).toBeGreaterThan(ALLOWABLE_MOMENT);
    expect(two.peakMoment).toBeLessThan(ALLOWABLE_MOMENT);
    const last = two.frames[two.frames.length - 1];
    expect(last.cargoPerHold.reduce((a, b) => a + b, 0)).toBeCloseTo(79_500, 3);
    expect(last.ballast).toBe(0);
  });

  it('makes loaders wait when the pumps fall behind', () => {
    const slow = simulateLoading({ cargo: 79_500, passes: 2, loaders: 2, loaderRate: 4_000, pumpRate: 1_500, ballast: 33_000, shiftHours: 0.5 });
    expect(slow.waitHours).toBeGreaterThan(1);
  });

  it('counts laytime and demurrage', () => {
    const r = laytime(75_000, { waitingHours: 48, formalitiesHours: 6, loadingHours: 30, rainHours: 10 }, { ratePerDay: 25_000, noticeHours: 6, excludeWeather: true, demurrage: 15_000, despatch: 7_500 });
    expect(r.allowedDays).toBe(3);
    expect(r.usedDays).toBeCloseTo(78 / 24, 9);
    expect(r.balance).toBeCloseTo((78 / 24 - 3) * 15_000, 6);
  });
});

describe('voyage economics', () => {
  const spec = { ballastNm: 3600, ladenNm: 3600, cargo: 75_000, portDays: 5, portCosts: 120_000, bunkerPrice: 600 };

  it('computes TCE as net freight per voyage day', () => {
    const r = voyageEstimate(KESTREL, { ...spec, freight: 14, ladenSpeed: 13, ballastSpeed: 13 });
    expect(r.tce).toBeCloseTo((14 * 75_000 * 0.95 - r.bunkers - 120_000) / r.days, 6);
    expect(freightForTce(KESTREL, { ...spec, freight: 0, ladenSpeed: 13, ballastSpeed: 13 }, r.tce)).toBeCloseTo(14, 6);
  });

  it('sails faster when freight is dear and slower when fuel is', () => {
    expect(bestSpeed(KESTREL, { ...spec, freight: 20 }).speed).toBeGreaterThan(bestSpeed(KESTREL, { ...spec, freight: 12 }).speed);
    expect(speedForDayValue(KESTREL, 13.75, 15_000, 800)).toBeLessThan(speedForDayValue(KESTREL, 13.75, 15_000, 400));
    expect(annualCargo(KESTREL, spec, 14)).toBeGreaterThan(annualCargo(KESTREL, spec, 11));
  });

  it('prices a ship’s day (engine)', () => {
    expect(opexTotal(OPEX[KESTREL.id])).toBe(6_300);
    expect(annuity(1_000, 0, 10)).toBe(100);
    const c = dailyCost(KESTREL, OPEX[KESTREL.id], { price: 36e6, age: 0, ltv: 0.6, rate: 0.07, tenor: 12, equityReturn: 0.1 });
    const b = breakeven(c, 10);
    expect(b.full).toBeGreaterThan(b.cash);
    expect(c.interest * 365).toBeCloseTo(36e6 * 0.6 * 0.07, 3);
  });
});

describe('lesson 2.1', () => {
  it('the biggest fully laden Neopanamax bulk carrier sits on every limit', () => {
    expect(NEO_BEST).toMatchObject({ loa: 366, beam: 51.25, draft: 14.86 });
    expect(NEO_BEST.dwt).toBeCloseTo(209_745, -1);
    expect(neopanamaxSolved({ kind: 'bulk', loa: 366, beam: 51.25, draft: 14.86 })).toBe(true);
    expect(neopanamaxSolved({ kind: 'bulk', loa: 366, beam: 51.25, draft: 14.87 })).toBe(false);
    expect(neopanamaxSolved({ kind: 'bulk', loa: 366, beam: 51.25, draft: 14.85 })).toBe(false);
    expect(neopanamaxSolved({ kind: 'bulk', loa: 365.9, beam: 51.25, draft: 14.86 })).toBe(false);
    expect(neopanamaxSolved({ kind: 'bulk', loa: 366, beam: 51.24, draft: 14.86 })).toBe(false);
    expect(neopanamaxSolved({ kind: 'tanker', loa: 366, beam: 51.25, draft: 14.86 })).toBe(false);
  });
});

describe('lesson 2.2', () => {
  it('has exactly seven fast, safe plans on the sliders’ grid, all with two passes and two loaders', () => {
    const sols: string[] = [];
    for (let p = 1; p <= 4; p++)
      for (const l of [1, 2])
        for (let r = 2000; r <= 8000; r += 500)
          for (let pu = 1500; pu <= 4500; pu += 500) if (fastSafeSolved(p, l, r, pu)) sols.push(`${p}/${l}/${r}/${pu}`);
    expect(sols).toEqual(['2/2/6000/4000', '2/2/6000/4500', '2/2/6500/4000', '2/2/6500/4500', '2/2/7000/4500', '2/2/7500/4500', '2/2/8000/4500']);
  });

  it('quotes the model’s loading runs', () => {
    const def = loadingRun(2, 1, 4000, 3000);
    expect(def.hours).toBeCloseTo(27.45, 2);
    expect(def.peakMoment).toBeLessThan(0.8 * ALLOWABLE_MOMENT);
    expect(loadingRun(1, 1, 4000, 3000).peakMoment / ALLOWABLE_MOMENT).toBeCloseTo(1.776, 2);
    expect(loadingRun(2, 2, 4000, 1500).waitHours).toBeCloseTo(5.5, 1);
    expect(loadingRun(2, 2, 8000, 4500).hours).toBeCloseTo(8.55, 2);
  });
});

describe('lesson 2.3', () => {
  it('restores the old best TCE at $900 bunkers only from $16.50 a tonne', () => {
    expect(TARGET_TCE).toBeCloseTo(19_115.7, 0);
    expect(RESTORE_FREIGHT).toBe(16.5);
    expect(bestAt(16, 900).result.tce).toBeLessThan(TARGET_TCE);
    expect(bestAt(16.5, 900).speed).toBe(11.2);
    expect(restoreSolved(11.2, 16.5, 900)).toBe(true);
    expect(restoreSolved(13.1, 16.5, 900)).toBe(true);
    expect(restoreSolved(13.2, 16.5, 900)).toBe(false);
    expect(restoreSolved(11.2, 17, 900)).toBe(false);
    expect(restoreSolved(11.2, 16.5, 600)).toBe(false);
  });

  it('finds the best speed rising with freight and falling with fuel', () => {
    expect(bestAt(14, 600).speed).toBe(12.4);
    expect(bestAt(20, 600).speed).toBeGreaterThan(bestAt(12, 600).speed);
    expect(bestAt(14, 800).speed).toBeLessThan(bestAt(14, 600).speed);
    expect(voyageAt23(14, 14, 600).tce).toBeCloseTo(18_488.5, 0);
    expect(fleetPoint(30_000, 600).cargo).toBeGreaterThan(fleetPoint(15_000, 600).cargo);
    expect(fleetPoint(15_000, 600).ballast).toBeGreaterThan(fleetPoint(15_000, 600).laden);
  });
});

describe('lesson 2.4', () => {
  it('the challenge has one answer on the price grid with the starting financing: $26.5 million', () => {
    const sols: number[] = [];
    for (let p = 15; p <= 45 + 1e-9; p = Math.round((p + 0.5) * 10) / 10) if (maxPriceSolved({ ...DEFAULTS24, price: p })) sols.push(p);
    expect(sols).toEqual([26.5]);
    expect(maxPriceFor(DEFAULTS24)).toBe(26.5);
    expect(costsFor({ ...DEFAULTS24, price: 26.5 }).b.full).toBeLessThanOrEqual(CHALLENGE_TCE);
    expect(maxPriceSolved({ ...DEFAULTS24, price: 26.5, tce: 15_250 })).toBe(false);
    expect(maxPriceSolved({ ...DEFAULTS24, price: 26.5, age: 5 })).toBe(false);
  });

  it('quotes the model’s break-evens', () => {
    const d = costsFor(DEFAULTS24);
    expect(d.b.cash).toBeCloseTo(13_158, 0);
    expect(d.b.full).toBeCloseTo(18_256, 0);
    expect(costsFor({ ...DEFAULTS24, ltv: 0 }).b.cash).toBeCloseTo(6_477, 0);
  });

  it('old ships are cheaper to own but dearer to run', () => {
    const [n, , o] = AGED.map((a) => agedShip(a.age, a.price, 600));
    expect(o.fullBreakeven).toBeLessThan(n.fullBreakeven);
    expect(o.runningBreakeven).toBeGreaterThan(n.runningBreakeven * 1.5);
  });
});

describe('the world map and sea routes', () => {
  it('joins every lane end to a known place', () => {
    for (const l of LANES) {
      expect(PLACE[l.from]).toBeDefined();
      expect(PLACE[l.to]).toBeDefined();
      expect(laneNm(l)).toBeGreaterThan(0);
    }
  });

  it('gives distances close to published ones', () => {
    const near = (a: string, b: string, nm: number, tol = 0.08) => expect(Math.abs(seaRoute(a, b)!.nm / nm - 1)).toBeLessThan(tol);
    near('TUB', 'QIN', 11_000);
    near('ROT', 'SIN', 8_300);
    near('SIN', 'QIN', 2_500);
    near('TUB', 'ROT', 5_000);
    expect(seaRoute('ROT', 'SIN')!.chokepoints).toContain('suez');
  });

  it('reroutes around closed chokepoints and deep drafts', () => {
    const viaSuez = seaRoute('ROT', 'SIN')!.nm;
    const viaCape = seaRoute('ROT', 'SIN', { closed: ['suez'] })!;
    expect(viaCape.nm - viaSuez).toBeGreaterThan(3_000);
    expect(viaCape.places).toContain('CGH');
    expect(seaRoute('NOL', 'QIN')!.chokepoints).toContain('panama');
    expect(seaRoute('NOL', 'QIN', { closed: ['panama'] })!.chokepoints).not.toContain('panama');
    expect(seaRoute('RTA', 'QIN', { draft: 22.5 })!.chokepoints).not.toContain('malacca');
    expect(seaRoute('RTA', 'QIN', { closed: ['hormuz'] })).toBeNull();
    const m = distanceMatrix(['TUB', 'QIN']);
    expect(m.TUB.QIN).toBeCloseTo(m.QIN.TUB, 6);
  });
});

describe('ballast planning', () => {
  it('sends surplus ships the shortest total way and prices position by distance', () => {
    const dist = { A: { X: 10, Y: 30 }, B: { X: 25, Y: 5 } };
    const p = ballastPlan({ A: 2, B: 1 }, { X: 1, Y: 2 }, dist);
    // Optimal: A→X 1, A→Y 1, B→Y 1 = 10 + 30 + 5 = 45.
    expect(p.miles).toBeCloseTo(45, 6);
    for (const f of p.flows) expect(p.ready[f.to] - p.open[f.from]).toBeCloseTo(f.nm, 6);
    expect(Math.min(...Object.values(p.open), ...Object.values(p.ready))).toBeCloseTo(0, 9);
  });
});

describe('the freight market', () => {
  it('clears the baseline at realistic earnings and freight', () => {
    const k = equilibrium('kmax');
    const c = equilibrium('cape');
    expect(k.tce).toBeGreaterThan(10_000);
    expect(k.tce).toBeLessThan(18_000);
    expect(c.tce).toBeGreaterThan(14_000);
    expect(c.tce).toBeLessThan(24_000);
    const c3 = c.routes.find((r) => r.route.id === 'C-TUB-QIN')!;
    const c5 = c.routes.find((r) => r.route.id === 'C-PHE-QIN')!;
    expect(c3.freight).toBeGreaterThan(15);
    expect(c3.freight).toBeLessThan(30);
    expect(c5.freight).toBeLessThan(c3.freight / 1.8);
  });

  it('raises earnings with demand, congestion and closures, and lowers them with a bigger fleet', () => {
    const base = equilibrium('kmax').tce;
    expect(equilibrium('kmax', { demand: 1.1 }).tce).toBeGreaterThan(base);
    expect(equilibrium('kmax', { congestion: { QIN: 3 } }).tce).toBeGreaterThan(base);
    expect(equilibrium('kmax', { closed: ['panama'] }).tce).toBeGreaterThan(base);
    expect(equilibrium('kmax', { fleet: MARKET_CLASSES.kmax.fleet * 1.1 }).tce).toBeLessThan(base);
  });

  it('speeds the fleet up as earnings rise, and lays up old ships when they collapse', () => {
    expect(speedsAt('kmax', 30_000).laden).toBeGreaterThan(speedsAt('kmax', 10_000).laden);
    expect(speedsAt('kmax', 10_000).ballast).toBeGreaterThan(speedsAt('kmax', 10_000).laden);
    const slump = equilibrium('kmax', { demand: 0.7 });
    expect(slump.idleShips).toBeGreaterThan(0);
    expect(slump.tce).toBeLessThan(5_000);
    const boom = equilibrium('kmax', { demand: 1.3 });
    expect(boom.served).toBeLessThan(1);
  });

  it('balances ship-days: the active fleet supplies what the trades need', () => {
    const e = equilibrium('cape');
    expect(e.activeShips * (365 - 10)).toBeCloseTo(e.shipDays, -1);
  });

  it('pays a premium for trips that end where ships are plentiful', () => {
    const e = equilibrium('cape');
    const front = tripTce(e, e.plan.ready.TUB, e.plan.open.QIN, 40);
    expect(front).toBeGreaterThan(e.tce);
  });

  it('follows the seasons of the harvests', () => {
    expect(SEASON_BRAZIL_SOY.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 9);
    expect(equilibrium('kmax', { month: 4 }).tce).toBeGreaterThan(equilibrium('kmax', { month: 0 }).tce);
    expect(ROUTES.every((r) => r.season.length === 12)).toBe(true);
  });
});

describe('the cycle and the history', () => {
  it('values a new ship at its newbuilding price at replacement earnings', () => {
    const h = replacementEarnings('kmax');
    expect(shipValue('kmax', 0, h, h) / 1e6).toBeCloseTo(36, 3);
    expect(shipValue('kmax', 20, h, h)).toBeLessThan(shipValue('kmax', 5, h, h));
  });

  it('orders in booms, delivers later and scraps in slumps', () => {
    const hist = standardHistory();
    const k = hist.cls.kmax;
    expect(k).toHaveLength(144);
    const byYear = (f: (m: (typeof k)[number]) => number) => Array.from({ length: 12 }, (_, y) => k.slice(y * 12, y * 12 + 12).reduce((s, m) => s + f(m), 0));
    const orders = byYear((m) => m.orders);
    const deliveries = byYear((m) => m.deliveries);
    const peakOrder = orders.slice(0, 8).indexOf(Math.max(...orders.slice(0, 8)));
    const peakDelivery = deliveries.slice(0, 8).indexOf(Math.max(...deliveries.slice(0, 8)));
    expect(peakDelivery).toBeGreaterThan(peakOrder);
    expect(Math.min(...k.map((m) => m.tce))).toBeLessThan(6_000);
    expect(Math.max(...k.map((m) => m.tce))).toBeGreaterThan(40_000);
  });

  it('is deterministic and reacts to its parameters', () => {
    const a = simulateCycle('kmax', { ...DEFAULT_CYCLE, months: 60 });
    const b = simulateCycle('kmax', { ...DEFAULT_CYCLE, months: 60 });
    expect(a.map((m) => m.tce)).toEqual(b.map((m) => m.tce));
    expect(bunkerPath(24, 1)).toEqual(bunkerPath(24, 1));
  });

  it('computes investment returns', () => {
    expect(irrAnnual([-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 110])).toBeCloseTo(0.1, 3);
    const k = standardHistory().cls.kmax;
    const r = invest('kmax', k, 'newbuild', 30);
    expect(r.deliveryMonth).toBe(60);
    expect(r.profit).toBeCloseTo(r.earnings - r.opex - r.price + r.endValue, 3);
  });
});

describe('lesson 2.5', () => {
  it('only orders placed in the slump return 20% a year', () => {
    const sols = Array.from({ length: LAST_ORDER + 1 }, (_, m) => m).filter((m) => returnSolved('newbuild', m));
    expect(sols.length).toBeGreaterThan(6);
    expect(Math.min(...sols)).toBeGreaterThan(72);
    expect(returnSolved('secondhand', sols[0])).toBe(false);
    expect(YEARS).toHaveLength(12);
  });
});
