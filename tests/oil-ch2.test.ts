// Oil course, chapter 2: numbers quoted in the lessons' prose and challenge checks added or
// changed by the fix passes. Engine-level checks stay in tests/oil.test.ts.
import { describe, expect, it } from 'vitest';
import { fieldWell, naturalFlowMargin, productivityIndex, trapVolume } from '../src/engines/oil/reservoir';
import { COST, fractureSpacing, rockOf, wellCost, wellProfile } from '../src/engines/oil/wells';
import { fieldOutcome, simulateField } from '../src/engines/oil/decline';
import { STANDARD_WELL, TERMS, wellEconomics, worldProjects } from '../src/engines/oil/economics';
import { FIELDS, gradient } from '../src/model/oil/fields';
import { BASE_OIL, DOUBLE_OWC, FLOW_NEEDS, SW_HIGH, doubleSolved, flowStopSolved, oilRatio } from '../src/lessons/oil/ch2/L2_1';
import {
  HALFWAY_ESTIMATE_HOURS,
  HOURS_PER_YEAR,
  MU_ESTIMATE,
  MU_MATCH,
  NORTHFIELD_PI,
  fieldDefaults,
  halfwaySolved,
  heavyOilSolved,
  reach,
} from '../src/lessons/oil/ch2/L2_2';
import {
  LATERAL_500_COST,
  STAGES_ESTIMATE,
  STANDARD_CAP_DAYS,
  cheapestSolved,
  cheapestYearOneWell,
  fewestStagesSolved,
  firstMonthRate,
  perStageRate,
} from '../src/lessons/oil/ch2/L2_3';
import { FIT_TOLERANCE, GOOD_B, bestFloodRecovery, fitError, floodPriceNote, floodTimingSolved, latestFloodStart, ordinal, pumpsLife } from '../src/lessons/oil/ch2/L2_4';
import {
  FRINGE_QUALITY,
  NORTHFIELD_DECLINES,
  QUALITY,
  SHUT_IN_RATE_70,
  STRAIGHT_LINE_BREAKEVEN,
  blockLabel,
  breakevenAt,
  breakevenSolved,
  demandSolved,
  marginalProject,
  money,
  volumeCleared,
} from '../src/lessons/oil/ch2/L2_5';

describe('oil chapter 2, fix pass 1', () => {
  it('2.1: halving the porosity halves the oil', () => {
    const half = trapVolume(FIELDS.northfield, 8000, { porosity: FIELDS.northfield.porosity / 2, sw: FIELDS.northfield.waterSaturation }).oil;
    expect(half / BASE_OIL).toBeCloseTo(0.5, 6);
    expect(Math.round(FIELDS.northfield.porosity * 50)).toBe(11);
  });

  it('2.3: fracture spacing and the per-stage rate', () => {
    expect(fractureSpacing(STANDARD_WELL)).toBe(100);
    expect(fractureSpacing({ ...STANDARD_WELL, lateral: 5000 })).toBe(50);
    const answer = { type: 'fractured' as const, lateral: 10000, stages: 30 };
    expect(fewestStagesSolved('pinyon', answer)).toBe(true);
    expect(Math.round(perStageRate(answer))).toBe(34);
  });

  it('2.4: good fits need b near or above 1', () => {
    const bestAt = (b: number) => {
      let best = Infinity;
      for (let qi = 500; qi <= 4000; qi += 50) for (let d = 30; d <= 95; d++) best = Math.min(best, fitError({ qi, de: d / 100, b }));
      return best;
    };
    expect(bestAt(GOOD_B[0])).toBeLessThanOrEqual(FIT_TOLERANCE);
    expect(bestAt(GOOD_B[1])).toBeLessThanOrEqual(FIT_TOLERANCE);
    expect(bestAt(0.85)).toBeGreaterThan(FIT_TOLERANCE);
    expect(bestAt(1.3)).toBeGreaterThan(FIT_TOLERANCE);
  });

  it('2.4: pumps and the flood’s latest start at other prices', () => {
    const y1 = (drive: 'flowing' | 'pumps') => Math.round(simulateField({ drive, floodYear: 0, wells: 25, oilPrice: 70, years: 50 })[0].oil / 100) * 100;
    expect(y1('flowing')).toBe(25900);
    expect(y1('pumps')).toBe(65600);
    expect(latestFloodStart(40)).toBe(-1);
    expect(Math.round(bestFloodRecovery(40) * 1000)).toBe(397);
    expect(latestFloodStart(70)).toBe(12);
    expect(latestFloodStart(100)).toBe(14);
    expect(floodPriceNote()).toBe('At $40 no start reaches 40% (the best recovers 39.7%); at $100 the field lasts 15 years on pumps, and the last start that does comes after 14 years.');
  });

  it('2.5: challenge a needs the core rock', () => {
    expect(breakevenSolved(70, QUALITY.core)).toBe(false);
    expect(breakevenSolved(56, QUALITY.core)).toBe(true);
    expect(breakevenSolved(56, FRINGE_QUALITY)).toBe(false);
    expect(breakevenSolved(55.5, QUALITY.core)).toBe(false);
  });

  it('2.5: breakevens traced to the rock', () => {
    expect(breakevenAt(100)).toBeCloseTo(55.77, 2);
    expect(Math.round(breakevenAt(FRINGE_QUALITY))).toBe(78);
    expect(Math.round(breakevenAt(120))).toBe(49);
    // Every breakeven on the rock slider can be reached on the price slider ($30–$120).
    expect(breakevenAt(QUALITY.min)).toBeLessThan(120);
    expect(breakevenAt(QUALITY.max)).toBeGreaterThan(30);
    // The fringe block of the supply curve is the same rock.
    expect(worldProjects().find((p) => p.id === 'fringe')!.fullCycle).toBeCloseTo(breakevenAt(FRINGE_QUALITY), 6);
  });

  it('2.5: prose numbers', () => {
    expect(money(wellEconomics(60).npv)).toBe('$0.9 million');
    expect(money(wellEconomics(50).npv)).toBe('−$1.3 million');
    expect(NORTHFIELD_DECLINES.map((d) => Math.round(d * 100))).toEqual([42, 37, 34]);
    expect(Math.round(SHUT_IN_RATE_70)).toBe(6);
    const half = TERMS.differential + TERMS.opexPerBbl / ((1 - TERMS.royalty) * (1 - TERMS.productionTax));
    expect(half).toBeCloseTo(14.48, 2);
  });

  it('2.5: supply-curve labels show cents', () => {
    const fringe = worldProjects().find((p) => p.id === 'fringe')!;
    expect(blockLabel(fringe.fullCycle)).toBe('$78.01');
    expect(blockLabel(worldProjects().find((p) => p.id === 'core')!.fullCycle)).toBe('$55.77');
    expect(blockLabel(64)).toBe('$64');
  });
});

describe('oil chapter 2, fix pass 2: predict-then-check challenges', () => {
  it('2.1a: twice the oil needs a 340 ft column, not 400', () => {
    const nf = FIELDS.northfield;
    expect(DOUBLE_OWC).toBe(8140);
    expect(oilRatio(8140)).toBeCloseTo(2, 9);
    expect(trapVolume(nf, 8000).column * 2).toBe(400);
    // A 400 ft column would sit below the spill point (8,150 ft, 350 ft below the crest).
    expect(8150 - nf.crestDepth).toBe(350);
    // Default unsolved; one 5 ft step either side solves; two steps don't; the rock must be the field's own.
    expect(doubleSolved(8000, 22, 25)).toBe(false);
    for (const d of [8135, 8140, 8145]) expect(doubleSolved(d, 22, 25)).toBe(true);
    expect(doubleSolved(8130, 22, 25)).toBe(false);
    expect(doubleSolved(8150, 22, 25)).toBe(false);
    expect(doubleSolved(8140, 11, 25)).toBe(false);
    // Prose: raising Sw from 25% to 50% cuts the oil by a third.
    const high = trapVolume(nf, 8000, { porosity: nf.porosity, sw: SW_HIGH }).oil;
    expect(1 - high / BASE_OIL).toBeCloseTo(1 / 3, 9);
  });

  it('2.1b: the estimate 0.329 × 7,800 + 100 rounds up to 2,670 psi', () => {
    const nf = FIELDS.northfield;
    expect(gradient(nf.reservoirOilSG).toFixed(3)).toBe('0.329');
    const estimate = 0.329 * nf.crestDepth + 100;
    expect(Math.ceil(estimate / 10) * 10).toBe(2670);
    expect(Math.round(FLOW_NEEDS)).toBe(2667);
    expect(flowStopSolved(nf.initialPressure)).toBe(false);
    expect(flowStopSolved(2670)).toBe(true);
    expect(flowStopSolved(2660)).toBe(false);
    expect(flowStopSolved(2680)).toBe(false);
    expect(naturalFlowMargin(2660, nf.crestDepth, nf.reservoirOilSG, 100)).toBeLessThan(0);
  });

  it('2.2a: 25 × 2 cP is the estimate, about 61 cP the match; within 10% solves', () => {
    expect(MU_ESTIMATE).toBe(50);
    expect(Math.round(MU_MATCH)).toBe(61);
    expect(fieldWell('coldwater').h).toBe(64);
    expect(fieldWell('northfield').h).toBe(60);
    const cw = fieldDefaults('coldwater');
    expect(heavyOilSolved(cw)).toBe(false);
    expect(heavyOilSolved({ ...cw, muExp: 1.7 })).toBe(false); // 50 cP: 22% too productive
    expect(heavyOilSolved({ ...cw, muExp: 1.75 })).toBe(true); // 56 cP
    expect(heavyOilSolved({ ...cw, muExp: 1.8 })).toBe(true); // 63 cP
    expect(heavyOilSolved({ ...cw, muExp: 1.85 })).toBe(false);
    expect(heavyOilSolved({ ...cw, muExp: 1.8, skin: 2 })).toBe(false);
    expect(productivityIndex(fieldWell('coldwater', { mu: 10 ** 1.7 })) / NORTHFIELD_PI - 1).toBeCloseTo(0.22, 2);
    expect(MU_MATCH / FIELDS.coldwater.oilViscosity).toBeCloseTo(0.1, 1);
  });

  it('2.2b: √t scaling puts 50 ft at about 83 days; within 10% solves', () => {
    expect(Math.round(reach('pinyon', HOURS_PER_YEAR))).toBe(105);
    expect(Math.round(HALFWAY_ESTIMATE_HOURS / 24)).toBe(83);
    expect(halfwaySolved(1.38)).toBe(false); // the default, a day
    expect(halfwaySolved(Math.log10(HALFWAY_ESTIMATE_HOURS))).toBe(true);
    expect(halfwaySolved(Math.round(Math.log10(HOURS_PER_YEAR / 4) * 100) / 100)).toBe(true); // a quarter year
    expect(halfwaySolved(3.16)).toBe(false); // two months
    expect(halfwaySolved(3.48)).toBe(false); // four months
  });

  it('2.3b: 1,591 / 50 per stage points to 31; the answer is 30', () => {
    const std = { type: 'fractured' as const, lateral: 10000, stages: 50 };
    expect(Math.round(firstMonthRate(std))).toBe(1591);
    expect(perStageRate(std)).toBeCloseTo(31.8, 1);
    expect(Math.round(STAGES_ESTIMATE)).toBe(31);
    expect(Math.round(STANDARD_CAP_DAYS)).toBe(3);
    // The standard well is held at 3,000 b/d at the start of its first month, the 30-stage well isn't.
    expect(wellProfile(std, rockOf('pinyon'), 1).rate[0]).toBeLessThan(50 * perStageRate({ ...std, stages: 30 }));
    expect(fewestStagesSolved('pinyon', { ...std, stages: 50 })).toBe(false);
    expect(fewestStagesSolved('pinyon', { ...std, stages: 31 })).toBe(false);
    expect(fewestStagesSolved('pinyon', { ...std, stages: 30 })).toBe(true);
    expect(fewestStagesSolved('pinyon', { ...std, lateral: 9500, stages: 30 })).toBe(false);
  });

  it('2.3a: anything within 1% of the cheapest design solves', () => {
    const best = cheapestYearOneWell();
    expect(best.design).toEqual({ type: 'fractured', lateral: 9000, stages: 41 });
    expect((best.cost / 1e6).toFixed(2)).toBe('7.51');
    const f = (lateral: number, stages: number) => ({ type: 'fractured' as const, lateral, stages });
    for (const [L, n] of [
      [7500, 44],
      [8000, 43],
      [8500, 42],
      [9000, 41],
      [9000, 42],
      [9500, 41],
      [10000, 40],
    ])
      expect(cheapestSolved('pinyon', f(L, n))).toBe(true);
    expect(cheapestSolved('pinyon', f(8500, 43))).toBe(false); // 1.1% over
    expect(cheapestSolved('pinyon', f(9000, 40))).toBe(false); // misses the target
    expect(cheapestSolved('pinyon', f(10000, 50))).toBe(false); // the standard well
    expect(cheapestSolved('pinyon', { type: 'vertical', lateral: 10000, stages: 50 })).toBe(false); // the default
    expect(Math.round(LATERAL_500_COST / 1000) * 1000).toBe(65000);
    expect(Math.round((COST.perStage - LATERAL_500_COST) / 1000) * 1000).toBe(10000);
    expect(wellCost(f(8500, 42), rockOf('pinyon')).total - best.cost).toBeCloseTo(COST.perStage - LATERAL_500_COST, 6);
  });

  it('2.4b: the last flood start is one year short of the field’s life on pumps', () => {
    expect(pumpsLife(70)).toBe(13);
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(11)).toBe('11th');
    const rows = simulateField({ drive: 'pumps', floodYear: 0, wells: 25, oilPrice: 70, years: 50 });
    expect(rows[12].producing).toBe(true);
    expect(rows[13].producing).toBe(false);
    expect(fieldOutcome(rows).life).toBe(13);
    expect(latestFloodStart(70)).toBe(pumpsLife(70) - 1);
    expect(latestFloodStart(100)).toBe(pumpsLife(100) - 1);
    expect(floodTimingSolved('waterflood', 3, 70)).toBe(false); // the default start
    expect(floodTimingSolved('waterflood', 12, 70)).toBe(true);
    expect(floodTimingSolved('waterflood', 13, 70)).toBe(false);
  });

  it('2.5a: a straight line between $50 and $60 puts the breakeven near $56', () => {
    expect(STRAIGHT_LINE_BREAKEVEN).toBeCloseTo(55.91, 2);
    expect(Math.ceil(STRAIGHT_LINE_BREAKEVEN * 2) / 2).toBe(56);
    expect(breakevenSolved(56)).toBe(true);
  });

  it('2.5b: the 500 millionth barrel comes from Coldwater steam, at $64', () => {
    const m = marginalProject();
    expect(m.id).toBe('coldwater');
    expect(m.fullCycle).toBe(64);
    expect(Math.round(volumeCleared(m.fullCycle - 0.01, 'full'))).toBe(367);
    expect(Math.round(volumeCleared(64, 'full'))).toBe(587);
    expect(demandSolved('full', 50)).toBe(false); // the default
    expect(demandSolved('full', 64)).toBe(true);
    expect(demandSolved('full', 63.5)).toBe(false);
    expect(demandSolved('full', 64.5)).toBe(false);
    expect(demandSolved('full', 78.5)).toBe(false);
    expect(demandSolved('half', 64)).toBe(false);
  });
});
