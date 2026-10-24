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
import { simulateQueue, expectedWait, erlangC } from '../src/engines/shipping/queue';
import { bestAssignment, position } from '../src/engines/shipping/positioning';
import { fleetRequirement } from '../src/engines/shipping/market';
import { FARTHEST_FROM_QINGDAO, farthestSolved, routeBetween, tradeRows } from '../src/lessons/shipping/ch3/L3_1';
import { fewestBerthsSolved, CV, CHALLENGE as CHALLENGE32, serviceDays } from '../src/lessons/shipping/ch3/L3_2';
import { CUT_SLOTS, DETOUR_DAYS, canalState, extraShips, slotCutSolved, tradeStatus } from '../src/lessons/shipping/ch3/L3_3';
import { cheapestSolved as cheapestSolved34, cheapestPlan, planCost, START_PLAN, ballasters, SHIPS as SHIPS34, type Plan } from '../src/lessons/shipping/ch3/L3_4';
import { BASE_MT, QIN_TONNES, capeNeeds, sourcingSolved } from '../src/lessons/shipping/ch3/L3_5';
import { clearMarket, reservation } from '../src/engines/shipping/clearing';
import { equivalentFreight, equivalentHire, timeCharter, voyageCharter, PLANNED, sampleOutcomes } from '../src/engines/shipping/charter';
import { TC_ROUTES, dailyPath, monthAverage, panelAssessment, routeTce, weightedIndex } from '../src/engines/shipping/indices';
import { dailyIndex, ffaSettlement, forwardPrice, markToMarket } from '../src/engines/shipping/ffa';
import { qingdaoSolved, marketAt, BIDS, SHIPS as SHIPS41 } from '../src/lessons/shipping/ch4/L4_1';
import { CHALLENGE_FREIGHT, CHALLENGE_OUTCOME, START_FREIGHT, VOYAGE, averageMatchFreight, matchSolved, riskRuns, DEFAULT_SPREAD } from '../src/lessons/shipping/ch4/L4_2';
import { balancedSolved, truthOnDay, START_DAY, KFH, MISS, PAIR, K_FREIGHT, type BuilderState } from '../src/lessons/shipping/ch4/L4_3';
import { BASE as BASE44, START as START44, runCycle, swingHalvedSolved, eventEffect } from '../src/lessons/shipping/ch4/L4_4';
import { collapseSolved, ffaTrade, fastForward, hedgeStrip, missSpread, LAST_TRADE_DAY, COLLAPSE_MONTH } from '../src/lessons/shipping/ch4/L4_5';
import { forecastPath, forecastError, DEFAULT_ASSUMPTIONS } from '../src/engines/shipping/forecast';
import { periodCharter, spreadTrade, whatIf } from '../src/engines/shipping/strategies';
import { compareChoices, marketMonths, repositionPlan, stayPlan } from '../src/engines/shipping/allocation';
import { backtest, bunkerHedge } from '../src/engines/shipping/backtest';
import { historyWith, eventAt } from '../src/model/shipping/history';
import { DEFAULT_STATE as DEFAULT51, forecastSolved, forecastRun, sensitivity as sensitivity51, allDateErrors } from '../src/lessons/shipping/ch5/L5_1';
import { newsTradeSolved, tradeResult, spreadsAt, DRIVER_DEFAULTS, NEWS_MONTH, type Legs } from '../src/lessons/shipping/ch5/L5_2';
import { SOLUTIONS as SOLUTIONS53, START as START53, charterIn, fleetSurpriseSolved, charterOutSeries } from '../src/lessons/shipping/ch5/L5_3';
import { harvestSolved, weakestPayingHarvest, longestWaitSolved, waitValue, comparePlans, DEFAULTS as DEFAULTS54, BEST_MONTH, WEAKEST, SOY_GRID } from '../src/lessons/shipping/ch5/L5_4';
import { DEFAULT_LAB as LAB55, halvesSolved, labRun as labRun55, passingThresholds, worldTotals as worldTotals55 } from '../src/lessons/shipping/ch5/L5_5';
import { cargoOffers, operate, shipCost, shipPrice, DEFAULT_WORLD, DEFAULT_POLICY } from '../src/engines/shipping/company';
import { runStrategy, periodHire, STRATEGY_KEYS, NEUTRAL_DRIVERS, DEFAULT_TOURNAMENT } from '../src/engines/shipping/tournament';
import { defaultDesign as defaultCompany, sanitize as sanitizeCompany } from '../src/lessons/shipping/shared/company';
import { fleetSolved, fleetStats, breakEvenMultiple, historyYears, newShip, CAPACITY_TARGET } from '../src/lessons/shipping/ch6/L6_1';
import { W0 as W62, soySolved, expectedSoyShare, bookNeeds, SOY_TARGET } from '../src/lessons/shipping/ch6/L6_2';
import { decisionLog, fuelShockSolved, isStartingCompany, shockBaseline, runDesk, SHOCK_BUNKER, SHOCK_GAIN } from '../src/lessons/shipping/ch6/L6_3';
import { SCENARIOS as SCEN64, scenarioResult as result64, scenarioScored, forecastSolved as forecastSolved64, type Pair as Pair64 } from '../src/lessons/shipping/ch6/L6_4';
import { onlyCharterOutPays, optionsOf, quotedResults, VIEW_DEFAULTS, WORLD_NAMES } from '../src/lessons/shipping/ch6/L6_5';
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

describe('queues and positioning', () => {
  it('agrees with Erlang C for one server', () => {
    // M/M/1: P(wait) = ρ.
    expect(erlangC(1, 0.6)).toBeCloseTo(0.6, 9);
    expect(expectedWait(1, 0.6, 1, 1)).toBeCloseTo(0.6 / 0.4, 9);
    expect(expectedWait(2, 3, 1)).toBe(Infinity);
  });

  it('simulates a queue whose waits grow with utilization', () => {
    const low = simulateQueue({ berths: 4, arrivalsPerDay: 1.5, serviceDays: 1.25, serviceCv: 0.5, days: 365, seed: 3 });
    const high = simulateQueue({ berths: 4, arrivalsPerDay: 3, serviceDays: 1.25, serviceCv: 0.5, days: 365, seed: 3 });
    expect(high.avgWait).toBeGreaterThan(low.avgWait * 5);
    for (const s of high.ships) expect(s.start).toBeGreaterThanOrEqual(s.arrive);
  });

  it('finds the cheapest positioning', () => {
    const o = { speed: 12, bunker: 600, dayValue: 15_000 };
    const ships = [
      { id: 'a', name: 'A', at: 'QIN', openDay: 0 },
      { id: 'c', name: 'C', at: 'ROT', openDay: 5 },
    ];
    const cargoes = [{ id: 'x', port: 'TUB', from: 30, to: 40, label: '' }];
    expect(position(ALBATROSS, ships[0], cargoes[0], o).ok).toBe(true);
    expect(bestAssignment(ALBATROSS, ships, cargoes, o).pairs.x).toBe('c');
  });

  it('measures demand for ships before any prices', () => {
    const r = fleetRequirement('cape');
    expect(r.ballastRatio).toBeCloseTo(1, 6);
    expect(r.ships).toBeGreaterThan(650);
    expect(r.ships).toBeLessThan(MARKET_CLASSES.cape.fleet);
    expect(fleetRequirement('cape', { routeScale: { 'C-TUB-QIN': 1.2 } }).ships).toBeGreaterThan(r.ships);
  });
});

describe('lesson 3.1', () => {
  it('finds Santos the farthest cargo port from Qingdao', () => {
    expect(FARTHEST_FROM_QINGDAO).toBe('SAN');
    expect(routeBetween('SAN', 'QIN').nm).toBeGreaterThan(routeBetween('TUB', 'QIN').nm);
    expect(farthestSolved('QIN', 'SAN')).toBe(true);
    expect(farthestSolved('SAN', 'QIN')).toBe(true);
    expect(farthestSolved('TUB', 'QIN')).toBe(false);
    expect(farthestSolved('SAN', 'ROT')).toBe(false);
  });

  it('shows long hauls taking more ship time than their tonnage', () => {
    const cape = tradeRows('cape');
    const c3 = cape.find((r) => r.id === 'C-TUB-QIN')!;
    const c5 = cape.find((r) => r.id === 'C-PHE-QIN')!;
    expect(c5.tonneShare).toBeGreaterThan(c3.tonneShare);
    expect(c3.dayShare).toBeGreaterThan(c5.dayShare);
    expect(cape.reduce((s, r) => s + r.dayShare, 0)).toBeCloseTo(1, 9);
  });

  it('routes along Brazil’s coast and south of Australia', () => {
    expect(seaRoute('NOL', 'SAN')!.places).not.toContain('CGH');
    expect(seaRoute('NEW', 'SIN')!.nm).toBeLessThan(4_800);
  });
});

describe('lesson 3.2', () => {
  it('needs eight berths with variable handling and seven with steady handling', () => {
    const sols: string[] = [];
    for (let b = 1; b <= 8; b++)
      for (let rate = 60_000; rate <= 200_000; rate += 10_000)
        for (let a = 5; a <= 50; a++)
          for (const [k, cv] of Object.entries(CV)) if (fewestBerthsSolved(b, rate, a / 10, cv)) sols.push(`${b}/${rate}/${a / 10}/${k}`);
    expect(sols).toEqual(['7/100000/2.6/steady', '8/100000/2.6/variable']);
    expect(serviceDays(CHALLENGE32.rate)).toBeCloseTo(2.2, 9);
  });
});

describe('lesson 3.3', () => {
  it('has one answer to the slot-cut challenge: 29.5 ships a day', () => {
    const sols: string[] = [];
    for (let s = 18; s <= 40; s++) for (let a = 15; a <= 40; a += 0.5) if (slotCutSolved(s, a)) sols.push(`${s}/${a}`);
    expect(sols).toEqual(['24/29.5']);
    expect(canalState(CUT_SLOTS, 29.5).divertDay).toBeGreaterThanOrEqual(60);
    expect(canalState(CUT_SLOTS, 30).divertDay).toBeLessThan(60);
  });

  it('quotes the model’s detours and fleet effects', () => {
    expect(DETOUR_DAYS).toBeCloseTo(14.5, 1);
    const drought = canalState(24, 32);
    expect(drought.divertShare).toBeCloseTo(0.25, 9);
    expect(drought.settledQueue).toBeCloseTo(24 * DETOUR_DAYS, 6);
    expect(canalState(36, 32).divertShare).toBe(0);
    expect(tradeStatus(['suez']).find((x) => x.trade.id === 'box')!.extraNm).toBeCloseTo(3741, -1);
    expect(tradeStatus(['hormuz']).filter((x) => !x.route)).toHaveLength(2);
    expect(extraShips(['panama']).kmax).toBeCloseTo(27, 0);
    expect(extraShips(['suez']).cape).toBe(0);
  });
});

describe('lesson 3.4', () => {
  it('has exactly one cheapest full plan at each ballast speed', () => {
    const choices = [...SHIPS34.map((s) => s.id), 'none'];
    for (const sp of [10, 11, 11.5, 12, 14]) {
      const sols: string[] = [];
      for (const a of choices) for (const b of choices) for (const c of choices) for (const d of choices)
        if (cheapestSolved34({ tub: a, phe: b, rby: c, new: d } as Plan, sp)) sols.push(`${a}/${b}/${c}/${d}`);
      expect(sols).toHaveLength(1);
    }
    expect(cheapestSolved34({ tub: 'skua', phe: 'gannet', rby: 'tern', new: 'fulmar' }, 12)).toBe(true);
    expect(cheapestSolved34({ tub: 'skua', phe: 'gannet', rby: 'tern', new: 'albatross' }, 10)).toBe(true);
    expect(cheapestSolved34(START_PLAN, 12)).toBe(false);
    expect(cheapestPlan(12).cost).toBeCloseTo(1_371_239, -1);
    expect(planCost(START_PLAN, 12).cost).toBeCloseTo(1_817_719, -1);
  });

  it('sends more ballasters into the Atlantic when Brazil exports more', () => {
    expect(ballasters('cape', 1, 1).intoAtlantic).toBeCloseTo(1470.6, 0);
    expect(ballasters('cape', 1.5, 1).intoAtlantic).toBeGreaterThan(ballasters('cape', 1, 1).intoAtlantic);
    expect(ballasters('cape', 1, 1).req.ballastRatio).toBeCloseTo(1, 6);
    expect(ballasters('kmax', 1, 1).req.ballastRatio).toBeLessThan(1);
  });
});

describe('lesson 3.5', () => {
  it('needs 50 more Capesizes only when about 60 Mt of Qingdao’s ore moves from Australia to Brazil', () => {
    const base = capeNeeds(BASE_MT).ships;
    expect(QIN_TONNES).toBe(890);
    expect(base).toBeCloseTo(700.3, 1);
    expect(sourcingSolved({ ...BASE_MT })).toBe(false);
    expect(sourcingSolved({ ...BASE_MT, 'C-PHE-QIN': 540, 'C-TUB-QIN': 310 })).toBe(false);
    expect(sourcingSolved({ ...BASE_MT, 'C-PHE-QIN': 530, 'C-TUB-QIN': 320 })).toBe(true);
    expect(sourcingSolved({ ...BASE_MT, 'C-PHE-QIN': 540, 'C-TUB-QIN': 315, 'C-NEW-QIN': 35 })).toBe(true);
    expect(sourcingSolved({ ...BASE_MT, 'C-PHE-QIN': 530, 'C-TUB-QIN': 320, 'C-TUB-ROT': 45 })).toBe(false);
    expect(sourcingSolved({ ...BASE_MT, 'C-TUB-QIN': 340 })).toBe(false);
    expect(capeNeeds({ ...BASE_MT, 'C-PHE-QIN': 890, 'C-TUB-QIN': 0, 'C-NEW-QIN': 0 }).ships).toBeLessThan(capeNeeds({ ...BASE_MT, 'C-PHE-QIN': 0, 'C-TUB-QIN': 890, 'C-NEW-QIN': 0 }).ships / 2);
  });
});

describe('spot clearing, charters, indices and FFAs (engines)', () => {
  const lane = { vessel: ALBATROSS, load: 'TUB', discharge: 'QIN', cargo: 170_000, portDays: 6, portCosts: 250_000, ladenSpeed: 11, ballastSpeed: 12, bunker: 600 };

  it('ranks ships by distance and clears at the marginal ship', () => {
    const near = reservation({ id: 'a', name: 'A', at: 'TUB', openIn: 0 }, lane, 15_000);
    const far = reservation({ id: 'b', name: 'B', at: 'QIN', openIn: 0 }, lane, 15_000);
    expect(near.reservation).toBeLessThan(far.reservation);
    const c = clearMarket([near, far], [{ id: 'x', bid: 30 }]);
    expect(c.fixtures).toHaveLength(1);
    expect(c.fixtures[0].ship.ship.id).toBe('a');
    expect(c.rate).toBeGreaterThanOrEqual(near.reservation);
    expect(c.rate).toBeLessThanOrEqual(30);
  });

  it('makes voyage and time charters equivalent as planned', () => {
    const v = { vessel: KESTREL, ladenNm: 11_339, cargo: 75_000, speed: 12, laytime: 8, portCosts: 150_000, canalCost: 0, bunker: 600, demurrage: 15_000 };
    const f = equivalentFreight(v, 15_000);
    expect(equivalentHire(v, f)).toBeCloseTo(15_000, 3);
    const vc = voyageCharter(v, f, PLANNED(v));
    const tc = timeCharter(v, 15_000, PLANNED(v));
    expect(vc.owner.net).toBeCloseTo(tc.owner.net, 3);
    // Dearer bunkers hurt the voyage-charter owner and the time charterer.
    const dear = { ...PLANNED(v), bunker: 800 };
    expect(voyageCharter(v, f, dear).owner.net).toBeLessThan(vc.owner.net);
    expect(timeCharter(v, 15_000, dear).owner.net).toBeCloseTo(tc.owner.net, 6);
    expect(sampleOutcomes(v, { bunkerSd: 0.1, weatherMean: 1, delayMean: 1, breakdownChance: 0.1, breakdownDays: 2 }, 50, 1)).toHaveLength(50);
  });

  it('prices fronthaul above and backhaul below the market', () => {
    const m = standardHistory().cls.kmax[30];
    const [ta, fh, , bh] = TC_ROUTES.kmax.map((r) => routeTce(m, r));
    expect(ta).toBeCloseTo(m.tce, 6);
    expect(fh).toBeGreaterThan(m.tce);
    expect(bh).toBeLessThan(m.tce);
    expect(weightedIndex([1, 3], [1, 1])).toBe(2);
    const p = panelAssessment(10_000, { panelists: 5, error: 0, trim: true, seed: 1 }, 3);
    expect(p.published).toBeCloseTo(10_000, 6);
    expect(dailyPath('kmax').tce).toHaveLength(144 * 21);
  });

  it('settles FFAs on the month’s average and marks them to the forward curve', () => {
    const idx = dailyIndex('kmax');
    expect(ffaSettlement('buy', 10_000, 30, 12_000)).toBe(60_000);
    expect(ffaSettlement('sell', 10_000, 30, 12_000)).toBe(-60_000);
    const day = 30 * 21;
    const month = 33;
    const price = forwardPrice('kmax', idx, day, month);
    const mtm = markToMarket('kmax', idx, day, month, 'sell', price, 30);
    expect(mtm[0].value).toBeCloseTo(0, 6);
    expect(mtm[mtm.length - 1].forward).toBeCloseTo(monthAverage(idx, month), 6);
    // Past months price at their settlement.
    expect(forwardPrice('kmax', idx, 40 * 21, 33)).toBeCloseTo(monthAverage(idx, 33), 6);
  });
});

describe('lesson 4.1', () => {
  it('needs nine cargoes before a ship from Qingdao is fixed, at $17.80 a tonne', () => {
    expect(qingdaoSolved(9, 15_000, 600)).toBe(true);
    expect(qingdaoSolved(8, 15_000, 600)).toBe(false);
    expect(qingdaoSolved(10, 15_000, 600)).toBe(false);
    expect(qingdaoSolved(9, 15_000, 900)).toBe(false);
    expect(marketAt(9, 15_000, 600).rate).toBeCloseTo(17.8, 1);
    expect(marketAt(6, 15_000, 600).rate).toBeCloseTo(13.78, 2);
    expect(marketAt(7, 15_000, 600).fixtures.at(-1)!.ship.ship.at).toBe('SIN');
    expect(BIDS).toHaveLength(10);
    expect(SHIPS41).toHaveLength(11);
  });
});

describe('lesson 4.2', () => {
  const s = { contract: 'voyage' as const, freight: 22.85, hire: 15_000, bunker: 800, weather: 3, delay: 0, offHire: 0 };
  it('matches the time charter after dear bunkers and weather only at $22.85 a tonne', () => {
    expect(START_FREIGHT).toBeCloseTo(19.03, 2);
    expect(CHALLENGE_FREIGHT).toBeCloseTo(22.85, 2);
    expect(matchSolved(s)).toBe(true);
    expect(matchSolved({ ...s, freight: 22.84 })).toBe(false);
    expect(matchSolved({ ...s, freight: 22.86 })).toBe(false);
    expect(matchSolved({ ...s, bunker: 790 })).toBe(false);
    expect(matchSolved({ ...s, hire: 15_250 })).toBe(false);
    expect(voyageCharter(VOYAGE, 22.85, CHALLENGE_OUTCOME).owner.net).toBeGreaterThanOrEqual(timeCharter(VOYAGE, 15_000, CHALLENGE_OUTCOME).owner.net);
    expect(voyageCharter(VOYAGE, 22.84, CHALLENGE_OUTCOME).owner.net).toBeLessThan(timeCharter(VOYAGE, 15_000, CHALLENGE_OUTCOME).owner.net);
  });

  it('gives the owner a steady income on time charter and a spread one on voyage charter', () => {
    const r = riskRuns(DEFAULT_SPREAD, START_FREIGHT);
    const spread = (a: number[]) => a[475] - a[24];
    expect(spread(r.ownerVc)).toBeGreaterThan(10 * spread(r.ownerTc));
    expect(spread(r.chartTc)).toBeGreaterThan(spread(r.chartVc));
    expect(averageMatchFreight()).toBeCloseTo(19.7, 2);
  });
});

describe('lesson 4.3', () => {
  const st = (cls: 'kmax' | 'cape', w: Record<string, number>, day = START_DAY, extra: Partial<BuilderState> = {}): BuilderState => ({ cls, day, panelists: 5, error: 0, trim: false, biased: false, weights: w, ...extra });
  const kw = (fh: number, bh: number, ta = 0) => ({ 'P-TA': ta, 'P-FH': fh, 'P-TP': 0, 'P-BH': bh });
  const cw = (fh: number, bh: number) => ({ 'C-TA': 0, 'C-FH': fh, 'C-TP': 0, 'C-BR': 0, 'C-BH': bh });

  it('balances the fronthaul and backhaul by trip length on any day', () => {
    expect(balancedSolved(st('kmax', kw(60, 55)))).toBe(true);
    expect(balancedSolved(st('kmax', kw(50, 50)))).toBe(false);
    expect(balancedSolved(st('kmax', kw(60, 55, 5)))).toBe(false);
    expect(balancedSolved(st('kmax', kw(60, 55), START_DAY, { error: 0.01 }))).toBe(false);
    expect(balancedSolved(st('kmax', kw(60, 55), START_DAY, { biased: true }))).toBe(false);
    for (let d = 0; d < 3024; d += 97) {
      expect(balancedSolved(st('kmax', kw(60, 55), d))).toBe(true);
      expect(balancedSolved(st('cape', cw(65, 60), d))).toBe(true);
    }
  });

  it('prices round voyages at the market and quotes the model', () => {
    const t = truthOnDay('kmax', START_DAY);
    expect(t.routes[0]).toBeCloseTo(t.market, 6);
    expect(t.routes[1]).toBeGreaterThan(t.market);
    expect(t.routes[3]).toBeLessThan(t.market);
    expect(KFH.mean).toBeCloseTo(8_531, -1);
    expect(MISS.ten).toBeLessThan(MISS.five);
    expect(MISS.fiveBiasedTrim).toBeLessThan(MISS.fiveBiased);
    expect(K_FREIGHT[PAIR.dear]).toBeGreaterThan(K_FREIGHT[PAIR.cheap]);
  });
});

describe('lesson 4.4', () => {
  it('halves the swing only with a shipyard lag of 10 months or less', () => {
    const sols: number[] = [];
    for (let lag = 6; lag <= 48; lag++) if (swingHalvedSolved({ ...START44, lag })) sols.push(lag);
    expect(sols).toEqual([6, 7, 8, 9, 10]);
    expect(BASE44.gap).toBeCloseTo(12_260, -1);
    expect(BASE44.peaks).toEqual([3, 8, 12]);
    expect(swingHalvedSolved({ ...START44, lag: 8, shock: 0.06 })).toBe(false);
    expect(swingHalvedSolved({ ...START44, lag: 8, congestion: 'qingdao' })).toBe(false);
    expect(swingHalvedSolved({ ...START44, shock: 0 })).toBe(false);
    expect(runCycle({ ...START44, shock: 0 }).gap).toBeLessThan(BASE44.gap / 2);
  });

  it('shows each disruption hitting the class that carries its trade', () => {
    expect(eventEffect('cape', 'brazil')).toBeCloseTo(-0.628, 2);
    expect(eventEffect('kmax', 'brazil')).toBeCloseTo(0, 9);
    expect(eventEffect('kmax', 'panama')).toBeCloseTo(0.159, 2);
    expect(eventEffect('cape', 'panama')).toBeCloseTo(0, 9);
    expect(eventEffect('cape', 'china')).toBeGreaterThan(0.3);
  });
});

describe('lesson 4.5', () => {
  it('only selling April from January of Year 6 makes $400,000 on 30 days', () => {
    const sols: string[] = [];
    for (let d = COLLAPSE_MONTH * 21; d < (COLLAPSE_MONTH + 1) * 21; d++)
      for (let a = 1; a <= 6; a++) for (const side of ['buy', 'sell'] as const) for (let q = 15; q <= 90; q += 15) if (collapseSolved(d, a, side, q)) sols.push(`${a}/${side}/${q}`);
    expect(sols).toHaveLength(21);
    expect(new Set(sols)).toEqual(new Set(['3/sell/30']));
    expect(collapseSolved(24 * 21, 3, 'sell', 30)).toBe(false);
    expect(ffaTrade(COLLAPSE_MONTH * 21, 3, 'sell', 30).pnl).toBeCloseTo(465_747, -1);
    expect(ffaTrade(24 * 21, 3, 'sell', 30).pnl).toBeCloseTo(-402_856, -1);
  });

  it('prices forwards exactly as the engine does', () => {
    const idx = dailyIndex('kmax');
    for (let d = 0; d <= LAST_TRADE_DAY; d += 97)
      for (let a = 0; a <= 6; a++) expect(fastForward(d, Math.floor(d / 21) + a)).toBeCloseTo(forwardPrice('kmax', idx, d, Math.floor(d / 21) + a), 6);
  });

  it('a full hedge leaves only basis; over-hedging adds risk back', () => {
    const tp = hedgeStrip(54, 'P-TP', 1);
    expect(missSpread(tp, true)).toBeLessThan(missSpread(tp, false) / 10);
    expect(missSpread(hedgeStrip(54, 'P-TP', 1.5), true)).toBeGreaterThan(missSpread(tp, true) * 5);
    expect(missSpread(hedgeStrip(54, 'P-FH', 1), true)).toBeGreaterThan(missSpread(tp, true) * 3);
  });
});

describe('strategy engines', () => {
  const k = standardHistory().cls.kmax;

  it('forecasts better when it counts the orderbook', () => {
    const withBook = forecastPath('kmax', k, 48, 12, DEFAULT_ASSUMPTIONS);
    const without = forecastPath('kmax', k, 48, 12, { ...DEFAULT_ASSUMPTIONS, deliveries: false });
    expect(withBook).toHaveLength(12);
    expect(forecastError(withBook)).toBeLessThan(forecastError(without));
  });

  it('re-solves a month with its drivers changed', () => {
    const m = k[30];
    expect(whatIf('kmax', m, {})).toBeCloseTo(m.tce, 6);
    expect(whatIf('kmax', m, { fleet: 1.05 })).toBeLessThan(m.tce);
    expect(whatIf('kmax', m, { congestion: { QIN: 3 } })).toBeGreaterThan(m.tce);
    expect(eventAt(101)?.closed).toContain('panama');
  });

  it('charters in, trades spreads, repositions and backtests', () => {
    const idx = dailyIndex('kmax');
    const p = periodCharter('kmax', idx, 24, 12);
    expect(p.monthly).toHaveLength(12);
    expect(p.total).toBeCloseTo(p.monthly.reduce((a, b) => a + b, 0), 6);
    expect(spreadTrade([1, 2, 3], [0, 0, 1], 0, 2, 10).pnl).toBe(10);
    const s = { month: 1, bunker: 600, soy: 1, speed: 12, horizon: 100 };
    const eqs = marketMonths(s);
    expect(repositionPlan(s, eqs).tce).toBeGreaterThan(stayPlan(s, eqs).tce);
    const c = compareChoices(s, eqs, 0, 0, 5, 1);
    expect(c.mean.stay).toBeCloseTo(stayPlan(s, eqs).tce, 3);
    const bt = backtest({ strategy: 'hedge', cls: 'kmax', days: 30, cost: 0, threshold: 0.1, from: 1, to: 143 }, idx, k);
    expect(bt.trades.every((t) => t.side === 'sell')).toBe(true);
    expect(bunkerHedge([500, 600, 550], 100, 0, 3)).toEqual([10_000, -5_000]);
  });

  it('keeps different histories apart', () => {
    const plain = historyWith({ events: false });
    expect(plain.cls.kmax[0].tce).toBeCloseTo(k[0].tce, 6);
    expect(plain.cls.kmax.some((m, i) => Math.abs(m.tce - k[i].tce) > 1)).toBe(true);
    const a = dailyIndex('kmax', undefined, plain.cls.kmax);
    const b = dailyIndex('kmax');
    expect(a.some((v, i) => Math.abs(v - b[i]) > 1)).toBe(true);
  });
});

describe('lesson 5.1', () => {
  it('reaches a 10% miss from Year 5 only with slower growth and the orderbook counted', () => {
    expect(forecastSolved(DEFAULT51)).toBe(false);
    expect(forecastRun(DEFAULT51).error).toBeCloseTo(0.181, 3);
    const good = { ...DEFAULT51, growth: 0.005, fade: 0.92, scrap: 0, qin: 2 };
    expect(forecastSolved(good)).toBe(true);
    expect(forecastSolved({ ...DEFAULT51, growth: 0, fade: 0.98, scrap: 0 })).toBe(true);
    expect(forecastSolved({ ...good, deliveries: false })).toBe(false);
    expect(forecastSolved({ ...good, month: 49 })).toBe(false);
    expect(forecastSolved({ ...good, cls: 'cape' })).toBe(false);
    expect(forecastRun(DEFAULT51).errorNoDeliveries).toBeGreaterThan(0.5);
  });

  it('counts the orderbook and shows lopsided risks in a slump', () => {
    const e = allDateErrors();
    expect(e.kmax.m24).toBeLessThan(e.kmax.m24no);
    expect(e.cape.m12).toBeLessThan(e.cape.m12no);
    const slump = sensitivity51('cape', 60);
    const cargo = slump.rows.find((r) => r.key === 'cargo')!;
    expect(cargo.up.change).toBeGreaterThan(3 * Math.abs(cargo.down!.change));
    expect(slump.idleMax).toBeGreaterThan(50);
    expect(sensitivity51('cape', 60).rows.find((r) => r.key === 'panama')!.up.change).toBeCloseTo(0, 9);
    expect(sensitivity51('kmax', 60).rows.find((r) => r.key === 'panama')!.up.change).toBeGreaterThan(0.1);
  });
});

describe('lesson 5.2', () => {
  it('pays $300,000 on the Brazil news only short, entered in April of Year 6, held three months or less, at 75–90 days a leg', () => {
    const sols: string[] = [];
    for (const legs of ['class', 'capeRoute', 'kmaxRoute'] as Legs[])
      for (const side of ['long', 'short'] as const)
        for (let entry = 0; entry <= 142; entry++)
          for (let held = 1; held <= 12; held++)
            for (let days = 15; days <= 90; days += 15) if (newsTradeSolved({ legs, side, entry, held, days })) sols.push(`${legs}/${side}/${entry}/${held}/${days}`);
    expect(sols).toEqual(['class/short/63/1/75', 'class/short/63/1/90', 'class/short/63/2/75', 'class/short/63/2/90', 'class/short/63/3/75', 'class/short/63/3/90']);
    expect(tradeResult({ legs: 'class', side: 'short', entry: NEWS_MONTH, held: 1, days: 90 }).pnl).toBeCloseTo(401_476, -1);
    expect(tradeResult({ legs: 'class', side: 'short', entry: NEWS_MONTH, held: 5, days: 90 }).pnl).toBeLessThan(0);
  });

  it('moves each spread through the class that carries the cargo', () => {
    const base = spreadsAt(DRIVER_DEFAULTS);
    const ore = spreadsAt({ ...DRIVER_DEFAULTS, brazilOre: 0.5 });
    expect(ore.kmax).toBeCloseTo(base.kmax, 6);
    expect(ore.cls).toBeLessThan(0);
    const panama = spreadsAt({ ...DRIVER_DEFAULTS, panama: true });
    expect(panama.cape).toBeCloseTo(base.cape, 6);
    expect(panama.kmaxRoute).toBeGreaterThan(base.kmaxRoute * 1.5);
  });
});

describe('lesson 5.3', () => {
  it('survives 5% more ships only from Year 2 April or Year 11 August–December', () => {
    expect(SOLUTIONS53).toEqual([15, 127, 128, 129, 130, 131]);
    expect(fleetSurpriseSolved({ ...START53, start: 15, fleet: 5 })).toBe(true);
    expect(fleetSurpriseSolved({ ...START53, start: 16, fleet: 5 })).toBe(false);
    expect(fleetSurpriseSolved({ ...START53, start: 15, fleet: 4 })).toBe(false);
    expect(fleetSurpriseSolved({ ...START53, start: 15, fleet: 5, margin: 1 })).toBe(false);
    expect(charterIn({ ...START53, start: 15, fleet: 5 }).total).toBeCloseTo(1_754_326, -1);
  });

  it('quotes the model: a boom-year charter-in turns to a loss with 5% more ships', () => {
    expect(charterIn(START53).hire).toBeCloseTo(18_939, 0);
    expect(charterIn(START53).total).toBeCloseTo(1_359_093, -1);
    expect(charterIn({ ...START53, fleet: 5 }).total).toBeLessThan(0);
    const out = charterOutSeries('actual');
    expect(out.filter((x) => x > 0).length / out.length).toBeCloseTo(0.61, 2);
    expect(charterOutSeries('fleet').filter((x) => x > 0).length).toBeGreaterThan(out.filter((x) => x > 0).length);
  });
});

describe('lesson 5.4', () => {
  it('repositions best in February, and only while the harvest is at least 0.75 of normal', () => {
    expect(BEST_MONTH).toBe(1);
    expect(WEAKEST).toBe(0.75);
    expect(comparePlans({ ...DEFAULTS54, month: 1 }).diff).toBeCloseTo(3654, -1);
    expect(comparePlans(DEFAULTS54).diff).toBeLessThan(0);
    const sols = SOY_GRID.filter((soy) => harvestSolved({ ...DEFAULTS54, month: 1, soy }));
    expect(sols).toEqual([0.75]);
    expect(harvestSolved({ ...DEFAULTS54, month: 0, soy: 0.75 })).toBe(false);
    expect(weakestPayingHarvest(600, 12, 0)).toBe(0.75);
  });

  it('values waiting only when the choice is close: four days in April at ±20%', () => {
    const sols = Array.from({ length: 21 }, (_, w) => w).filter((wait) => longestWaitSolved({ month: 3, vol: 0.2, wait }));
    expect(sols).toEqual([4]);
    expect(waitValue(3, 0.2, 3).value).toBeGreaterThan(0);
    expect(waitValue(1, 0.2, 0).value).toBeLessThan(50);
    expect(longestWaitSolved({ month: 3, vol: 0.25, wait: 4 })).toBe(false);
  });
});

describe('lesson 5.5', () => {
  it('passes both halves only with a wide mean-reversion band', () => {
    expect(passingThresholds(0.25)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 55, 56]);
    expect(halvesSolved({ ...LAB55, strategy: 'reversion', threshold: 45 })).toBe(true);
    expect(halvesSolved({ ...LAB55, strategy: 'reversion', threshold: 10 })).toBe(false);
    expect(halvesSolved({ ...LAB55, strategy: 'fundamental', threshold: 45 })).toBe(false);
  });

  it('matches the engine and quotes the model', () => {
    const k = standardHistory().cls.kmax;
    const eng = backtest({ strategy: 'fundamental', cls: 'kmax', days: 30, cost: 0.0025, threshold: 0.1, from: 1, to: 143 }, dailyIndex('kmax'), k);
    const at = (strategy: 'seasonal' | 'momentum' | 'reversion' | 'fundamental' | 'hedge') => labRun55({ ...LAB55, strategy });
    expect(at('fundamental').all.total).toBeCloseTo(eng.summary.total, 3);
    expect(at('seasonal').all.total / 1e6).toBeCloseTo(-2.277, 2);
    expect(at('fundamental').hitRate).toBeCloseTo(0.824, 2);
    expect(worldTotals55({ ...LAB55, strategy: 'seasonal' }).every((x) => x < 0)).toBe(true);
    const mom = worldTotals55({ ...LAB55, strategy: 'momentum' });
    expect(mom.filter((x) => x > 0)).toHaveLength(1);
    expect(mom[11]).toBeGreaterThan(0);
    expect(worldTotals55({ ...LAB55, strategy: 'fundamental' }).every((x) => x > 0)).toBe(true);
  });
});

describe('the company engines', () => {
  const fin = { ltv: 0.6, rate: 0.07, tenor: 12, equityReturn: 0.1 };
  const h = standardHistory();

  it('prices ships and their daily costs', () => {
    expect(shipPrice('kmax', 5, h.cls.kmax, 30)).toBeGreaterThan(shipPrice('kmax', 15, h.cls.kmax, 30));
    const owned = shipCost({ id: 'a', name: 'A', cls: 'kmax', age: 6, mode: 'owned', price: 22e6, hire: 0, at: 'QIN', openDay: 0 }, fin);
    expect(owned.fullBreakeven).toBeGreaterThan(owned.cashBreakeven);
    const chartered = shipCost({ id: 'b', name: 'B', cls: 'kmax', age: 6, mode: 'chartered', price: 0, hire: 10_000, at: 'QIN', openDay: 0 }, fin);
    expect(chartered.opex).toBe(0);
    expect(chartered.hire).toBe(10_000);
  });

  it('generates cargoes deterministically and schedules each at most once', () => {
    const a = cargoOffers(DEFAULT_WORLD);
    const b = cargoOffers(DEFAULT_WORLD);
    expect(a.map((o) => o.id)).toEqual(b.map((o) => o.id));
    expect(a.length).toBeGreaterThan(50);
    const ships = defaultCompany().ships;
    const r = operate(ships, a, DEFAULT_POLICY, fin, DEFAULT_WORLD);
    const ids = r.runs.flatMap((x) => x.fixtures.map((f) => f.cargo.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const run of r.runs) for (const f of run.fixtures) {
      expect(f.cargo.cls).toBe(run.ship.cls);
      expect(f.arrive).toBeLessThanOrEqual(f.cargo.to + 1e-9);
    }
    expect(r.profit).toBeCloseTo(r.voyageNet - r.dailyCosts, 3);
  });

  it('runs every strategy and keeps chartering out immune to the physical dials', () => {
    const ships = defaultCompany().ships;
    const base = STRATEGY_KEYS.map((k) => runStrategy(k, ships, fin, h, NEUTRAL_DRIVERS, DEFAULT_TOURNAMENT));
    expect(base.every((r) => r.monthly.length === 144)).toBe(true);
    const out = runStrategy('charterOut', ships, fin, h, { ...NEUTRAL_DRIVERS, soy: 0.7 }, DEFAULT_TOURNAMENT);
    expect(out.total).toBeCloseTo(base[1].total, 6);
    expect(periodHire('kmax', h, 30)).toBeGreaterThan(0);
  });

  it('keeps a stored company sane', () => {
    const bad = sanitizeCompany({ ships: [{ id: 'x', cls: 'tanker' }], finance: { ltv: 5 } });
    expect(bad.ships.length).toBeGreaterThan(0);
    expect(bad.finance.ltv).toBeLessThanOrEqual(0.8);
  });
});

describe('lesson 6.1', () => {
  const d0 = defaultCompany();
  const add = (d: typeof d0, ...o: Array<['kmax' | 'cape', 'owned' | 'chartered', number]>) =>
    o.reduce((x, [cls, mode, age]) => ({ ...x, ships: [...x.ships, newShip(x, cls, mode, age, 'QIN')] }), d);

  it('needs four ships, 20 billion tonne-miles and cash costs covered', () => {
    expect(CAPACITY_TARGET).toBe(20);
    expect(fleetSolved(d0)).toBe(false);
    expect(fleetStats(d0).margin).toBeCloseTo(-4072, 0);
    expect(fleetSolved(add(d0, ['cape', 'chartered', 10], ['cape', 'chartered', 10]))).toBe(false);
    expect(fleetSolved(add(d0, ['cape', 'chartered', 10], ['cape', 'chartered', 10], ['kmax', 'chartered', 10], ['kmax', 'chartered', 10]))).toBe(true);
    const lowLoan = { ...d0, finance: { ...d0.finance, ltv: 0.2 } };
    expect(fleetSolved(add(lowLoan, ['cape', 'chartered', 10], ['cape', 'chartered', 10]))).toBe(true);
    expect(fleetSolved({ ...d0, finance: { ...d0.finance, ltv: 0 } })).toBe(false);
  });

  it('quotes the starting company’s exposure', () => {
    expect(breakEvenMultiple(d0)).toBeCloseTo(1.157, 2);
    const ys = historyYears(d0);
    expect(ys.reduce((a, b) => (b.cashFlow < a.cashFlow ? b : a)).year).toBe(6);
    expect(ys.reduce((a, b) => (b.cashFlow > a.cashFlow ? b : a)).year).toBe(12);
  });
});

describe('lesson 6.2', () => {
  it('needs the harvest: soybeans reach a quarter of the expected Kamsarmax cargoes only in windows starting February–May', () => {
    const sols: Array<[number, number]> = [];
    for (let start = 0; start <= 117; start++) for (let weeks = 13; weeks <= 52; weeks++) if (soySolved({ ...W62, start, weeks })) sols.push([start, weeks]);
    expect(sols).toHaveLength(267);
    expect(new Set(sols.map(([s]) => s % 12))).toEqual(new Set([1, 2, 3, 4]));
    expect(Math.max(...sols.map(([, w]) => w))).toBe(25);
    expect(soySolved(W62)).toBe(false);
    expect(expectedSoyShare({ ...W62, start: 99, weeks: 13 })).toBeGreaterThan(SOY_TARGET);
    expect(soySolved({ ...W62, start: 99, weeks: 13, reach: 0.05 })).toBe(true);
    expect(soySolved({ ...W62, start: 99, weeks: 13, routeScale: { 'P-SAN-QIN': 1.05 } })).toBe(false);
  });

  it('needs far more ships for the book than Northwind has', () => {
    const offers = cargoOffers(W62);
    expect(bookNeeds(offers, W62, 'cape').ships).toBeCloseTo(12.7, 1);
    expect(bookNeeds(offers, W62, 'kmax').ships).toBeGreaterThan(10);
  });
});

describe('lesson 6.3', () => {
  const d = defaultCompany();
  it('solves the $900 fuel shock only by slowing to 9–10 knots', () => {
    expect(isStartingCompany(d)).toBe(true);
    expect(shockBaseline(d)).toBeCloseTo(-5_227_586, -1);
    expect(fuelShockSolved({ ...d, policy: { ...d.policy, bunker: SHOCK_BUNKER } })).toBe(false);
    expect(fuelShockSolved({ ...d, policy: { ...d.policy, bunker: SHOCK_BUNKER, speed: 9 } })).toBe(true);
    expect(fuelShockSolved({ ...d, policy: { ...d.policy, bunker: 890, speed: 9 } })).toBe(false);
    expect(fuelShockSolved({ ...d, policy: { ...d.policy, bunker: SHOCK_BUNKER, speed: 9, congestion: 0.5 } })).toBe(false);
    expect(fuelShockSolved({ ...d, ships: d.ships.slice(0, 1), policy: { ...d.policy, bunker: SHOCK_BUNKER, speed: 9 } })).toBe(false);
    let n = 0;
    for (const rule of ['bestTce', 'nearest', 'bestFreight'] as const)
      for (let sp = 9; sp <= 15; sp += 0.5)
        for (let mt = 0; mt <= 25000; mt += 5000)
          if (fuelShockSolved({ ...d, policy: { rule, speed: sp, minTce: mt, waitDays: 3, bunker: SHOCK_BUNKER, congestion: 0 } })) {
            n++;
            expect(sp).toBeLessThanOrEqual(10);
          }
    expect(n).toBeGreaterThan(0);
    expect(runDesk({ ...d, policy: { ...d.policy, bunker: SHOCK_BUNKER, speed: 9 } }).profit - shockBaseline(d)).toBeGreaterThan(SHOCK_GAIN);
  });

  it('replays the desk exactly and beats the benchmark at the start', () => {
    const offers = cargoOffers(d.world);
    const r = operate(d.ships, offers, d.policy, d.finance, d.world);
    const log = decisionLog(d.ships, offers, d.policy, d.world);
    expect(log.map((x) => x.chosen.cargo.id).sort()).toEqual(r.runs.flatMap((x) => x.fixtures.map((f) => f.cargo.id)).sort());
    expect(r.profit - r.benchmark).toBeCloseTo(1_050_165, -1);
    expect(log[0].options).toHaveLength(10);
  });
});

describe('lesson 6.4', () => {
  const grid = (x: number) => 2000 + Math.round((x - 2000) / 250) * 250;
  const best = (id: (typeof SCEN64)[number]['id']): Pair64 => ({ cape: grid(result64(id).cape.outcome), kmax: grid(result64(id).kmax.outcome) });
  const naive = (id: (typeof SCEN64)[number]['id']): Pair64 => ({ cape: result64(id).cape.naive, kmax: result64(id).kmax.naive });

  it('scores forecasts near the outcome, never the no-change forecast, and needs three scenarios', () => {
    for (const s of SCEN64) {
      expect(scenarioScored(s.id, best(s.id))).toBe(true);
      expect(scenarioScored(s.id, naive(s.id))).toBe(false);
      expect(scenarioScored(s.id, { cape: grid(naive(s.id).cape), kmax: grid(naive(s.id).kmax) })).toBe(false);
    }
    expect(forecastSolved64({ cyclone: best('cyclone'), panama: best('panama') })).toBe(false);
    expect(forecastSolved64({ cyclone: best('cyclone'), panama: best('panama'), steel: naive('steel') })).toBe(false);
    expect(forecastSolved64({ cyclone: best('cyclone'), panama: best('panama'), steel: best('steel') })).toBe(true);
  });

  it('hits the class that carries the trade, by several times the shock', () => {
    expect(result64('cyclone').kmax.effect).toBeCloseTo(0, 9);
    expect(result64('cyclone').cape.effect).toBeCloseTo(-0.089, 2);
    expect(result64('panama').cape.effect).toBeCloseTo(0, 9);
    expect(result64('panama').kmax.effect).toBeCloseTo(0.223, 2);
    expect(result64('steel').kmax.effect).toBeCloseTo(0, 9);
    expect(result64('steel').cape.effect).toBeCloseTo(-0.39, 2);
    expect(result64('deliveries').kmax.effect).toBeLessThan(-0.15);
    expect(result64('storms').cape.effect).toBeGreaterThan(0.18);
    expect(result64('deliveries').kmax.naive / result64('deliveries').kmax.outcome - 1).toBeCloseTo(0.898, 2);
  });
});

describe('lesson 6.5', () => {
  const d = defaultCompany();
  const full = optionsOf(VIEW_DEFAULTS);
  it('leaves only chartering out in profit when Brazil’s ore collapses or ships flood in', () => {
    expect(onlyCharterOutPays(d.ships, d.finance, NEUTRAL_DRIVERS, full)).toBe(false);
    expect(onlyCharterOutPays(d.ships, d.finance, { ...NEUTRAL_DRIVERS, ore: 0.6 }, full)).toBe(true);
    expect(onlyCharterOutPays(d.ships, d.finance, { ...NEUTRAL_DRIVERS, ore: 0.65 }, full)).toBe(false);
    expect(onlyCharterOutPays(d.ships, d.finance, { ...NEUTRAL_DRIVERS, ore: 0.65 }, { ...full, hedgeShare: 0 })).toBe(true);
    expect(onlyCharterOutPays(d.ships, d.finance, { ...NEUTRAL_DRIVERS, fleet: 1.05, ore: 0.8 }, full)).toBe(true);
    expect(onlyCharterOutPays(d.ships, d.finance, { ...NEUTRAL_DRIVERS, ore: 0.6 }, { ...full, from: 12 })).toBe(false);
    const chartered = d.ships.map((s) => ({ ...s, mode: 'chartered' as const, hire: 10_000 }));
    expect(onlyCharterOutPays(chartered, d.finance, { ...NEUTRAL_DRIVERS, ore: 0.6 }, full)).toBe(false);
  });

  it('quotes the starting company’s tournament', () => {
    const q = quotedResults();
    expect(q.neutral.charterIn.total).toBeGreaterThan(q.neutral.spot.total);
    expect(q.neutral.charterOut.maxDrawdown).toBeLessThan(q.neutral.spot.maxDrawdown);
    expect(q.weakSoy.reposition.total).toBeCloseTo(q.weakSoy.spot.total, 6);
    expect(q.moreShips.charterIn.total).toBeLessThan(q.moreShips.spot.total);
    expect(q.strongSoy.charterOut.total).toBeCloseTo(q.neutral.charterOut.total, 6);
    expect(q.beat).toEqual({ charterOut: 7, charterIn: 9, reposition: 10, hedge: 11 });
    expect(WORLD_NAMES).toHaveLength(11);
    expect(Object.values(q.worlds).every((xs) => xs[10] < 0)).toBe(true);
  });
});
