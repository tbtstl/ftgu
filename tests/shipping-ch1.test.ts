// Chapter 1 of the shipping course: the numbers its prose quotes and the challenge checks.

import { describe, expect, it } from 'vitest';
import { KESTREL, RHO_FRESH, RHO_SEA } from '../src/model/shipping/vessels';
import { displacementAt, draftFor, freshWaterAllowanceMm, loadLines, maxCargo, summerDisplacement, tpc } from '../src/engines/shipping/hydrostatics';
import { KNOT } from '../src/engines/shipping/resistance';
import { ETA_D, FUELS, powerAndFuel } from '../src/engines/shipping/propulsion';
import { CARGOES, LOGS, ballastTanks, deckEdgeAngle, deckStack, stabilityOf } from '../src/engines/shipping/stability';
import { beaufort } from '../src/engines/shipping/weather';
import { FWA_TONNES, SUMMER_MARK_FRESH_CARGO, floating, freshLoadSolved, surveyBallastRoom, surveyResult } from '../src/lessons/shipping/ch1/L1_1';
import { CLEAN_14_KW, FOULED_CUBE_ESTIMATE, FOULED_TOP_SPEED, drag, foulingSolved, shipWavelength } from '../src/lessons/shipping/ch1/L1_2';
import { DEADLINE_DAYS, PASSAGE_NM, twelveDaySolved, voyageAt } from '../src/lessons/shipping/ch1/L1_3';
import {
  DECK_MAX,
  GM_FOR_TARGET,
  LOG_HOLDS,
  ORE_SWAP_FOR_TARGET,
  TRANSFER_MOMENT,
  cargoLimit,
  listHeel,
  loadedState,
  logSplit,
  logsWhereGmBelow,
  lollAngle,
  oreRollSolved,
  uprightSolved,
} from '../src/lessons/shipping/ch1/L1_4';
import { ROUTES_TIE_HS, routes, tieSolved } from '../src/lessons/shipping/ch1/L1_5';

const K = KESTREL;

describe('lesson 1.1', () => {
  it('the fresh-water challenge is solved only by loading to the F mark', () => {
    // Default state: unsolved.
    expect(freshLoadSolved(40_000, K.cb, RHO_SEA)).toBe(false);
    // Loading to the summer mark in the river leaves her short.
    expect(freshLoadSolved(77_200, K.cb, RHO_FRESH)).toBe(false);
    expect(freshLoadSolved(79_400, K.cb, RHO_FRESH)).toBe(false);
    expect(freshLoadSolved(79_500, K.cb, RHO_FRESH)).toBe(true);
    expect(freshLoadSolved(79_600, K.cb, RHO_FRESH)).toBe(false);
    // The F mark is exactly where the summer displacement floats in fresh water.
    const f = floating(79_500, K.cb, RHO_FRESH);
    expect(f.draft).toBeLessThanOrEqual(loadLines(K).F);
    expect(f.seaDraft).toBeLessThanOrEqual(K.designDraft);
    expect((loadLines(K).F - K.designDraft) * 1000).toBeCloseTo(361, 0);
  });

  it('quotes the cargo the summer mark would leave on the quay', () => {
    expect(summerDisplacement(K) - displacementAt(K, K.designDraft, RHO_FRESH)).toBeCloseTo(2_281, 0);
  });

  it('quotes the survey error the figure shows, and counts the ballast left aboard', () => {
    expect(surveyResult(72_000, 0, 1.012, true).error).toBeCloseTo(472, 0);
    // The surveyor sounds the tanks, so ballast left aboard barely changes the answer.
    expect(Math.abs(surveyResult(72_000, 10_000, 1.012, false).error)).toBeLessThan(5);
  });

  it('caps the survey’s ballast so cargo and ballast never take her past her marks', () => {
    expect(surveyBallastRoom(40_000)).toBe(10_000);
    expect(surveyBallastRoom(72_000)).toBe(7_500);
    expect(surveyBallastRoom(78_000)).toBe(1_500);
    for (let c = 40_000; c <= 78_000; c += 500) {
      expect(K.lightship + K.consumables + c + surveyBallastRoom(c)).toBeLessThanOrEqual(summerDisplacement(K));
      // Even in fresh dock water the after reading stays well inside the chart's 16 m axis.
      expect(draftFor(K, K.lightship + K.consumables + c + surveyBallastRoom(c), RHO_FRESH)).toBeLessThan(15);
    }
  });

  it('lets the reader predict the fresh water allowance’s tonnage before loading to the F mark', () => {
    // The estimate the question invites: 36.1 cm × 64.7 t/cm ≈ 2,340 t.
    expect(freshWaterAllowanceMm(K)).toBeCloseTo(361, 0);
    expect(tpc(K)).toBeCloseTo(64.7, 1);
    expect(Math.round(((freshWaterAllowanceMm(K) / 10) * tpc(K)) / 10) * 10).toBe(2_340);
    // The true figure: about 2,280 t, from 77,200 t at the summer mark in the river to 79,500 t at the F mark.
    expect(Math.round(FWA_TONNES / 10) * 10).toBe(2_280);
    expect(SUMMER_MARK_FRESH_CARGO).toBe(77_200);
    expect(floating(77_200, K.cb, RHO_FRESH).draft).toBeLessThanOrEqual(K.designDraft);
    expect(floating(77_300, K.cb, RHO_FRESH).draft).toBeGreaterThan(K.designDraft);
    // In fresh water a centimeter holds 63.1 t, and the sea lifts her 361 mm.
    expect(tpc(K) * (RHO_FRESH / RHO_SEA)).toBeCloseTo(63.1, 1);
    const f = floating(79_500, K.cb, RHO_FRESH);
    expect((f.draft - f.seaDraft) * 1000).toBeCloseTo(361, 0);
    expect((f.draft - K.designDraft) * 1000).toBeCloseTo(361, 0);
  });
});

describe('lesson 1.2', () => {
  it('turns 14 knots into kilometers an hour', () => {
    expect(14 * KNOT * 3.6).toBeCloseTo(25.9, 1);
  });

  it('makes waves as long as the ship near a Froude number of 0.4', () => {
    const fn = 1 / Math.sqrt(2 * Math.PI);
    expect(fn).toBeCloseTo(0.4, 2);
    const speedKn = (fn * Math.sqrt(9.81 * K.lbp)) / KNOT;
    expect(shipWavelength(speedKn)).toBeCloseTo(K.lbp, 6);
    expect(drag(14).froude).toBeCloseTo(0.153, 3);
  });
});

describe('lesson 1.2 challenge', () => {
  it('predicts about 12.5 knots by the cube law and accepts 12.4–12.6 on the fouled hull', () => {
    expect(FOULED_TOP_SPEED).toBe(12.6);
    expect(FOULED_CUBE_ESTIMATE).toBeCloseTo(12.53, 2);
    // Fouling adds close to 40% at every speed the challenge visits.
    for (const s of [12.4, 12.5, 12.6, 13, 14]) {
      const r = drag(s, K.designDraft, K.cb, 1).effectivePower / drag(s).effectivePower;
      expect(r).toBeGreaterThan(1.38);
      expect(r).toBeLessThan(1.42);
    }
    expect(drag(14, K.designDraft, K.cb, 1).effectivePower / drag(14).effectivePower).toBeCloseTo(1.39, 2);
    expect(Math.cbrt(drag(14, K.designDraft, K.cb, 1).effectivePower / drag(14).effectivePower)).toBeCloseTo(1.12, 2);
    // Default (14 kn, clean) is unsolved; the prediction and the answer solve; near misses don't.
    expect(foulingSolved(14, 0)).toBe(false);
    expect(foulingSolved(12.5, 0.95)).toBe(false);
    for (const s of [12.4, 12.5, 12.6]) expect(foulingSolved(s, 1)).toBe(true);
    expect(foulingSolved(12.3, 1)).toBe(false);
    expect(foulingSolved(12.7, 1)).toBe(false);
    expect(drag(12.6, K.designDraft, K.cb, 1).effectivePower).toBeLessThanOrEqual(CLEAN_14_KW);
    expect(drag(12.7, K.designDraft, K.cb, 1).effectivePower).toBeGreaterThan(CLEAN_14_KW);
  });
});

describe('lesson 1.3', () => {
  it('the 12-day challenge is solved by the predicted 3,600 ÷ 288 = 12.5 knots only', () => {
    expect(PASSAGE_NM / (DEADLINE_DAYS * 24)).toBe(12.5);
    expect(twelveDaySolved(14)).toBe(false);
    expect(twelveDaySolved(12.5)).toBe(true);
    expect(twelveDaySolved(12.4)).toBe(false);
    expect(twelveDaySolved(12.6)).toBe(false);
    expect((voyageAt(12.4).days - DEADLINE_DAYS) * 24).toBeCloseTo(2.3, 1);
  });

  it('cuts either efficiency by a tenth to about the same daily burn', () => {
    const engine = powerAndFuel(K, 14, { draft: K.designDraft, efficiency: 0.45 }).totalTpd;
    const prop = powerAndFuel(K, 14, { draft: K.designDraft, etaD: ETA_D * 0.9 }).totalTpd;
    expect(ETA_D * 0.9).toBeCloseTo(0.63, 9);
    expect(engine).toBeCloseTo(37.3, 1);
    expect(prop).toBeCloseTo(37.4, 1);
  });

  it('turns voyage fuel into a cost per tonne of cargo', () => {
    const cargo = Math.round(maxCargo(K, K.consumables) / 100) * 100;
    expect(cargo).toBe(79_500);
    expect(FUELS.vlsfo.price).toBe(600);
    expect(voyageAt(14).cost).toBeCloseTo(217_626, 0);
    expect(voyageAt(14).cost / cargo).toBeCloseTo(2.74, 2);
    expect(voyageAt(12).cost / cargo).toBeCloseTo(2.11, 2);
  });
});

describe('lesson 1.4', () => {
  it('leaves the bulk cargoes and the engine’s default loading unchanged', () => {
    expect(cargoLimit('ore')).toBe(79_500);
    expect(cargoLimit('grain')).toBe(74_600);
    const s = stabilityOf(K, { cargo: 79_500, cargoType: CARGOES.coal, consumables: K.consumables, lowerBallast: 0, topsideBallast: 0 });
    expect(s.items.length).toBe(5);
    expect(s.gm).toBeCloseTo(2.5, 2);
  });

  it('fills the holds with logs, then stacks the rest on deck', () => {
    expect(LOG_HOLDS).toBe(48_500);
    expect(cargoLimit('logs')).toBe(LOG_HOLDS + DECK_MAX);
    expect(logSplit(60_000)).toEqual({ hold: 48_500, deck: 11_500 });
    expect(logSplit(30_000)).toEqual({ hold: 30_000, deck: 0 });
    expect(loadedState('logs', LOG_HOLDS, 0, 0).gm).toBeCloseTo(3.11, 2);
    expect(deckStack(K, DECK_MAX, LOGS.stowage).height).toBeCloseTo(7.2, 1);
  });

  it('lets GM fall through the 0.15 m floor and below zero short of her marks', () => {
    expect(logsWhereGmBelow(0.15)).toBe(64_300);
    expect(logsWhereGmBelow(0.15) - LOG_HOLDS).toBe(15_800);
    expect(logsWhereGmBelow(0)).toBe(65_200);
    expect(logsWhereGmBelow(0) - LOG_HOLDS).toBe(16_700);
    expect(Math.round((maxCargo(K, K.consumables) - logsWhereGmBelow(0)) / 100) * 100).toBe(14_300);
    expect(loadedState('logs', 64_200, 0, 0).gm).toBeGreaterThanOrEqual(0.15);
    expect(loadedState('logs', 65_100, 0, 0).gm).toBeGreaterThan(0);
  });

  it('lolls with the whole deck stack, short of deck-edge immersion, and lower ballast cures it', () => {
    const max = loadedState('logs', cargoLimit('logs'), 0, 0);
    expect(max.gm).toBeLessThan(0);
    expect(max.displacement).toBeLessThan(summerDisplacement(K));
    expect(lollAngle(max)).toBeCloseTo(21.5, 1);
    expect(lollAngle(max)).toBeLessThan(deckEdgeAngle(K, max.draft));
    expect(lollAngle(loadedState('coal', 79_500, 0, 0))).toBe(0);
    expect(loadedState('logs', cargoLimit('logs'), 6_000, 0).gm).toBeGreaterThan(0);
  });

  it('quotes the empty and ballasted conditions', () => {
    const empty = loadedState('ore', 0, 0, 0);
    expect(empty.draft).toBeCloseTo(2.16, 2);
    expect(empty.gm).toBeCloseTo(33.03, 2);
    expect(K.depth - empty.draft).toBeCloseTo(17.9, 1);
    const t = ballastTanks(K);
    const ballasted = loadedState('ore', 0, t.lower.capacity, t.topside.capacity);
    expect(ballasted.draft).toBeCloseTo(7.26, 2);
    expect(ballasted.gm).toBeCloseTo(6.92, 2);
  });
});

describe('lesson 1.4 challenges', () => {
  it('slows the ore-laden roll to 10 seconds only by swapping a sixth of her ore, at her marks', () => {
    const ore = loadedState('ore', 79_500, 0, 0);
    expect(ore.gm).toBeCloseTo(8.01, 2);
    expect(ore.rollPeriod).toBeCloseTo(9.1, 1);
    // The prediction: GM scales with 1 / T², so (9.1 / 10)² of 8.01 m ≈ 6.6 m; exactly 10 s needs 6.70 m.
    expect(ore.gm * (9.1 / 10) ** 2).toBeCloseTo(6.6, 1);
    expect(GM_FOR_TARGET).toBeCloseTo(6.7, 2);
    expect(ORE_SWAP_FOR_TARGET).toBe(12_650);
    expect(ORE_SWAP_FOR_TARGET / 79_500).toBeCloseTo(0.16, 2);
    expect(loadedState('ore', 79_500 - 12_650, 0, 12_650).gm).toBeCloseTo(6.7, 2);
    // Default (coal, no ballast) and full ore are unsolved.
    expect(oreRollSolved('coal', 79_500, 0, 0)).toBe(false);
    expect(oreRollSolved('ore', 79_500, 0, 0)).toBe(false);
    // The intended answer solves.
    expect(oreRollSolved('ore', 79_500 - 12_650, 0, 12_650)).toBe(true);
    // Near misses: too little swapped (reads 9.9 s), too much (10.1 s), the full swap (10.2 s), over or short of her marks, lower ballast.
    expect(oreRollSolved('ore', 79_500 - 12_000, 0, 12_000)).toBe(false);
    expect(oreRollSolved('ore', 79_500 - 13_300, 0, 13_300)).toBe(false);
    expect(oreRollSolved('ore', 79_500 - 14_850, 0, 14_850)).toBe(false);
    expect(loadedState('ore', 79_500 - 14_850, 0, 14_850).rollPeriod).toBeCloseTo(10.2, 1);
    expect(oreRollSolved('ore', 79_500, 0, 12_650)).toBe(false);
    expect(oreRollSolved('ore', 66_000, 0, 12_650)).toBe(false);
    expect(oreRollSolved('ore', 66_800, 50, 12_650)).toBe(false);
  });

  it('the list challenge’s prediction, 4,800 ÷ 25.2 ≈ 191 t, brings her upright', () => {
    expect((600 * 8) / TRANSFER_MOMENT).toBeCloseTo(190.8, 1);
    expect(uprightSolved('coal', 600, 0)).toBe(false);
    expect(uprightSolved('coal', 600, 190)).toBe(true);
    expect(uprightSolved('coal', 600, 170)).toBe(false);
    expect(uprightSolved('coal', 600, 230)).toBe(false);
    expect(listHeel('coal', 600, 0)).toBeCloseTo(0.99, 2);
  });
});

describe('lesson 1.5', () => {
  it('ties the routes at about 4.7 m, where the storm slows her to 13.5 × 1,000 ÷ 1,300 ≈ 10.4 knots', () => {
    expect(ROUTES_TIE_HS).toBeCloseTo(4.67, 2);
    const r = routes(ROUTES_TIE_HS);
    const vMod = r.detour.legs[0].speed.stw;
    expect(vMod).toBeCloseTo(13.5, 1);
    expect((vMod * 1000) / 1300).toBeCloseTo(10.4, 1);
    expect(r.direct.legs[1].speed.stw).toBeCloseTo((vMod * 1000) / 1300, 6);
    // Default (3 m) is unsolved; 4.6 and 4.7 m solve; 4.5 and 4.8 m don't.
    expect(tieSolved(3)).toBe(false);
    expect(tieSolved(4.6)).toBe(true);
    expect(tieSolved(4.7)).toBe(true);
    expect(tieSolved(4.5)).toBe(false);
    expect(tieSolved(4.8)).toBe(false);
    // The caption's storm speed reads 10.5 and 10.4 kn at the two solving heights.
    expect(routes(4.6).direct.legs[1].speed.stw).toBeCloseTo(10.5, 1);
    expect(routes(4.7).direct.legs[1].speed.stw).toBeCloseTo(10.4, 1);
    // The detour first wins at 4.7 m, and its lead grows with the storm.
    expect(routes(4.6).detour.days).toBeGreaterThan(routes(4.6).direct.days);
    expect(routes(4.7).detour.days).toBeLessThan(routes(4.7).direct.days);
    let prev = -Infinity;
    for (let i = 47; i <= 80; i++) {
      const q = routes(i / 10);
      expect(q.direct.days - q.detour.days).toBeGreaterThan(prev);
      prev = q.direct.days - q.detour.days;
    }
  });

  it('calls 35 knots a gale', () => {
    expect(beaufort(35)).toEqual({ force: 8, name: 'gale' });
  });
});
