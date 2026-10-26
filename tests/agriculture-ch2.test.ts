// Agriculture chapter 2: the numbers its prose quotes after the first fix pass — the valley's corn
// supply (2.1), the planting curve run to the June 20 deadline over all 200 seasons, the seed and
// budget comparison (2.2), the scouting knife-edge (2.3), the harvest values (2.4) and the
// profit drivers (2.5) — and, from the second pass, the predict-then-check challenges.

import { describe, expect, it } from 'vitest';
import { YEARS, cropMix, expectedYieldByPlantDay } from '../src/engines/agriculture/farm';
import { SUPPLY_AREAS, areaMargin, areaPlan, supplyArea, supplySteps, switchPrice, valleyCornSupply } from '../src/engines/agriculture/supply';
import { PLAN_PRICE, perBushelCost } from '../src/model/agriculture/economics';
import { DISTRICT, VALLEY_CORN_KAC, VALLEY_WHEAT_KAC, dayOf } from '../src/model/agriculture/region';
import { allCornSolved, allWheatPrice, mixCurve, plantYield, plantingStats } from '../src/lessons/agriculture/ch2/L2_1';
import { DEAR_N_PRICE, SEEDS, SEED_LEVELS, atDearNitrogen, budgetVsOptimum, dearNitrogenSolved, inputCurve, seedYields } from '../src/lessons/agriculture/ch2/L2_2';
import { REFERENCE_YEAR } from '../src/model/agriculture/climate';
import { START_THRESHOLD, outcome, scoutingRecord, strategyRecord, thresholdSolved } from '../src/lessons/agriculture/ch2/L2_3';
import { BASE as HARVEST_BASE, DEAR_DRYING, MATURE, MOISTURE, atChallenge, bestStart, harvest, harvestSolved, nearBest, wheatValue } from '../src/lessons/agriculture/ch2/L2_4';
import { RAISED_RENT, acreBudget, atRaisedRent, breakevenSolved, farmProfits, profitRange, swings } from '../src/lessons/agriculture/ch2/L2_5';
import { fieldSeason } from '../src/engines/agriculture/farm';
import { simulatedYear } from '../src/model/agriculture/climate';
import { dateLabel } from '../src/model/agriculture/region';

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('agriculture 2.1: the valley’s corn supply', () => {
  it('splits the valley’s cropland into six areas', () => {
    expect(SUPPLY_AREAS.reduce((s, a) => s + a.kAcres, 0)).toBe(VALLEY_CORN_KAC + VALLEY_WHEAT_KAC);
    expect(supplyArea('plainsIrrigated').kAcres).toBe(2 * DISTRICT.plains.irrigatedKAc);
    expect(supplyArea('plainsIrrigated').kAcres * 1000).toBe(520000);
    expect(supplyArea('plains').kAcres).toBe(1280);
  });
  it('matches the farm planner’s best mix and return', () => {
    for (const prices of [PLAN_PRICE, { corn: 3.5, wheat: 6 }, { corn: 5.2, wheat: 5 }, { corn: 6.4, wheat: 7.5 }]) {
      for (const a of SUPPLY_AREAS) {
        const means = Array.from({ length: 21 }, (_, i) => cropMix(a.district, 1000, i / 20, prices, a.irrigated).mean);
        const best = means.indexOf(Math.max(...means)) / 20;
        const plan = areaPlan(a, prices);
        expect(plan.share).toBe(best);
        expect(areaMargin(a, plan.share, prices) * 1000).toBeCloseTo(means[best * 20], 3);
      }
    }
  });
  it('gives the acres, harvest and switch prices in the prose', () => {
    const plan = valleyCornSupply(PLAN_PRICE);
    expect(plan.cornKAcres).toBe(2785);
    expect(r1(plan.cornKAcres / 1000)).toBe(2.8);
    expect(Math.round(plan.cornMBu)).toBe(455);
    expect(plan.areas.find((a) => a.area.id === 'plains')!.share).toBe(0);
    expect(plan.areas.filter((a) => a.area.id !== 'plains').every((a) => a.share === 0.5)).toBe(true);
    const sw = (id: string, from: number, to: number) => r2(switchPrice(supplyArea(id), from, to, PLAN_PRICE.wheat));
    expect(sw('north', 0, 0.5)).toBe(4);
    expect(sw('ridge', 0, 0.5)).toBe(3.97);
    expect(sw('plainsIrrigated', 0, 0.5)).toBe(3.74);
    expect(sw('bottoms', 0, 0.5)).toBe(3.3);
    expect(sw('prairie', 0, 0.5)).toBe(3.23);
    expect(sw('prairie', 0.5, 1)).toBe(4.88);
    expect(sw('bottoms', 0.5, 1)).toBe(5);
    expect(sw('plainsIrrigated', 0.5, 1)).toBe(5.49);
    // The Prairie's step agrees with the challenge's answer in 10-cent steps.
    expect(allCornSolved('prairie', 4.9, 6)).toBe(true);
    expect(r1(valleyCornSupply({ corn: PLAN_PRICE.corn, wheat: 5 }).cornKAcres / 1000)).toBe(4.5);
    expect((VALLEY_CORN_KAC - plan.cornKAcres) * 1000).toBe(315000);
    expect(r1(VALLEY_CORN_KAC / 1000)).toBe(3.1);
  });
  it('draws one step for each change of plan, in order', () => {
    const steps = supplySteps(6, 3, 6.5);
    expect(steps.map((s) => s.area.id)).toEqual(['prairie', 'bottoms', 'plainsIrrigated', 'ridge', 'north', 'prairie', 'bottoms', 'plainsIrrigated', 'ridge', 'north']);
    let acres = valleyCornSupply({ corn: 3, wheat: 6 }).cornKAcres;
    for (const s of steps) acres += s.area.kAcres * (s.to - s.from);
    expect(acres).toBe(valleyCornSupply({ corn: 6.5, wheat: 6 }).cornKAcres);
  });
  it('starts the planner on Cedar Bend’s split, about $5 an acre below the peak', () => {
    const curve = mixCurve('prairie', PLAN_PRICE);
    expect(curve.length).toBe(41);
    expect(curve[25].cornAcres).toBe(1000);
    expect(Math.round(curve[20].mean / 1600 - curve[25].mean / 1600)).toBe(5);
  });
});

describe('agriculture 2.1: planting to the deadline', () => {
  it('runs the yield curve past June 14, over 200 seasons', () => {
    const ey = plantYield();
    expect(r1(ey(dayOf(5, 25)))).toBe(172.7);
    expect(r1(ey(dayOf(6, 4)))).toBe(164.4);
    expect(r1(ey(dayOf(6, 14)))).toBe(148);
    expect(r1(ey(dayOf(6, 20)))).toBe(134);
    // "nearly flat … about 176 bushels" from mid-April to mid-May.
    for (let d = dayOf(4, 10); d <= dayOf(5, 15); d++) expect(Math.abs(ey(d) - 176)).toBeLessThan(1);
    // The default (first 100 seasons, grid ending June 14) is unchanged for anyone else.
    expect(r1(expectedYieldByPlantDay('prairie')(dayOf(6, 14)))).toBe(148.5);
    expect(expectedYieldByPlantDay('prairie')(dayOf(6, 20))).toBe(expectedYieldByPlantDay('prairie')(dayOf(6, 14)));
    expect(YEARS.length).toBe(200);
  });
  it('gives the planter losses in the prose', () => {
    const small = plantingStats(dayOf(4, 25), 90);
    const large = plantingStats(dayOf(4, 25), 270);
    expect(Math.round(small.meanLost)).toBe(656);
    expect(Math.round(large.meanLost)).toBe(254);
    expect(Math.round(((small.meanLost - large.meanLost) * PLAN_PRICE.corn) / 100) * 100).toBe(1800);
    expect(Math.round(small.worstLost)).toBe(17602);
    expect(Math.round(large.worstLost)).toBe(797);
  });
});

describe('agriculture 2.2: seed, the planter and the budget', () => {
  it('gives the seed numbers in the prose', () => {
    expect(SEEDS).toEqual([28000, 30000, 32000, 34000]);
    const y = seedYields();
    expect(y.map(r1)).toEqual([172.6, 174.3, 175.8, 177.1]);
    const margin = PLAN_PRICE.corn - perBushelCost('corn');
    expect(r2(y[1] - y[0])).toBe(1.73);
    expect(r2((y[1] - y[0]) * margin)).toBe(7.58);
    expect(r2(y[2] - y[1])).toBe(1.46);
    expect(r2((y[2] - y[1]) * margin)).toBe(6.4);
  });
  it('gives the planter step in the prose', () => {
    const p = inputCurve('planter', PLAN_PRICE.corn, 1);
    expect(p.best).toBe(0);
    expect(Math.round(p.output[1] - p.output[0])).toBe(328);
    expect(Math.round((p.value[1] - p.value[0]) / 100) * 100).toBe(1400);
    expect(p.cost[1] - p.cost[0]).toBe(8000);
  });
  it('compares Cedar Bend’s budget with the optima', () => {
    const b = budgetVsOptimum();
    expect(b.seedCost).toBeGreaterThan(0);
    expect(b.seedCost).toBeLessThan(1);
    expect(Math.round(b.nitrogenCost)).toBe(7);
    expect(b.wetWins).toBe(30);
    expect(r1(b.yieldAt150)).toBe(174.6);
    expect(r1(b.neverShort)).toBe(175.6);
  });
});

describe('agriculture 2.3: the scouting knife-edge', () => {
  it('gives the neighbors of the best threshold', () => {
    const lo = scoutingRecord(0.015);
    const best = scoutingRecord(0.02);
    const hi = scoutingRecord(0.025);
    expect(r2(lo.mean)).toBe(1.73);
    expect(lo.sprays).toBe(132);
    expect(r2(best.mean)).toBe(3.2);
    expect(best.sprays).toBe(62);
    expect(r2(hi.mean)).toBe(-0.08);
    expect(hi.sprays).toBe(24);
  });
  it('gives the resistant hybrid the smallest harvest in the dry summer', () => {
    const o = { cornOnCorn: false, threshold: 0.02, pressure: 1, price: 4.6, fungicide: 32 };
    const ys = (['none', 'resistant', 'fungicide', 'scout'] as const).map((s) => outcome(136, s, o).yield);
    expect(Math.min(...ys)).toBe(ys[1]);
    expect(ys[2] - ys[0]).toBeLessThan(1);
    expect(ys[2] - ys[0]).toBeGreaterThan(0);
    // ...but the spray, not the hybrid, loses the most money there.
    expect(outcome(136, 'fungicide', o).gain).toBeLessThan(outcome(136, 'resistant', o).gain);
    expect(REFERENCE_YEAR).toBe(40);
  });
});

describe('agriculture 2.4: harvest values', () => {
  it('gives the late-September start and the October moisture', () => {
    const base = { perDay: 100, drying: 0.035, price: 4.6 };
    expect(Math.round(harvest({ ...base, start: dayOf(9, 30) }).valuePerAcre)).toBe(816);
    expect(Math.round(harvest({ ...base, start: MATURE }).valuePerAcre)).toBe(775);
    expect(Math.round(harvest({ ...base, start: dayOf(11, 25) }).valuePerAcre)).toBe(794);
    expect(r1(MOISTURE[dayOf(10, 15) - MATURE])).toBe(19.3);
    expect(r1(MOISTURE[dayOf(10, 31) - MATURE])).toBe(17.7);
  });
});

describe('agriculture 2.5: profit drivers', () => {
  it('quotes each driver as a one-way 30% move', () => {
    const s = swings();
    expect(Math.round(s.price)).toBe(191);
    expect(Math.round(s.yield)).toBe(183);
    expect(Math.round(s.fert)).toBe(36);
    expect(Math.round(s.rent)).toBe(30);
  });
  it('widens the histogram when the seasons run past ±$600k', () => {
    const at = (corn: number, wheat: number) => profitRange(farmProfits({ corn, wheat, yieldMult: 1, fertMult: 1, rent: 265 }));
    expect(at(4.6, 6)).toEqual({ lo: -600000, hi: 600000 });
    expect(at(7, 9)).toEqual({ lo: -600000, hi: 1200000 });
    const p = farmProfits({ corn: 7, wheat: 9, yieldMult: 1, fertMult: 1, rent: 265 });
    expect(Math.max(...p)).toBeLessThanOrEqual(1200000);
  });
});

// ---------------------------------------------------------------------------
// Second pass: challenges that ask for a prediction, and the sentences that use every control.

describe('agriculture 2.1: the wheat price slider', () => {
  it('tips the North Tier to all wheat at $7.60', () => {
    expect(allWheatPrice('north')).toBe(7.6);
    const at = (wheat: number) => [0, 0.5, 1].map((s) => cropMix('north', 1600, s, { corn: 4.6, wheat }).mean);
    const lo = at(7.5);
    expect(lo[1]).toBeGreaterThan(lo[0]);
    const hi = at(7.6);
    expect(hi[0]).toBeGreaterThan(hi[1]);
    expect(hi[0]).toBeGreaterThan(hi[2]);
    // The Prairie stays at 50–50 there.
    const prairie = [0, 0.5, 1].map((s) => cropMix('prairie', 1600, s, { corn: 4.6, wheat: 7.6 }).mean);
    expect(prairie.indexOf(Math.max(...prairie))).toBe(1);
  });
});

describe('agriculture 2.2: nitrogen at $1.40, predicted from the bars', () => {
  const today = inputCurve('nitrogen', 4.6, 0.6);
  const step = (i: number) => today.value[i + 1] - today.value[i];
  it('has bars that don’t depend on the nitrogen price', () => {
    const dear = inputCurve('nitrogen', 4.6, DEAR_N_PRICE);
    expect(dear.value).toEqual(today.value);
  });
  it('peaks at 80 lb, with clear margins on both sides of the $28 line', () => {
    expect(DEAR_N_PRICE * 20).toBeCloseTo(28, 9);
    const dear = inputCurve('nitrogen', 4.6, DEAR_N_PRICE);
    expect(dear.levels[dear.best]).toBe(80);
    expect(step(3) - 28).toBeGreaterThan(4); // 60 → 80: $32.9
    expect(28 - step(4)).toBeGreaterThan(3.5); // 80 → 100: $24.0
    expect(r1(step(3))).toBe(32.9);
    expect(r1(step(4))).toBe(24);
    // "40 less than at 60 cents", "gives up 9.1 bushels"
    expect(today.levels[today.best] - dear.levels[dear.best]).toBe(40);
    expect(r1(today.output[today.best] - dear.output[dear.best])).toBe(9.1);
  });
  it('starts unsolved, solves at 80 lb and not at its neighbors', () => {
    expect(dearNitrogenSolved('nitrogen', 6, 4.6, 0.6)).toBe(false);
    expect(atDearNitrogen('nitrogen', 4.6, 0.6)).toBe(false);
    expect(dearNitrogenSolved('nitrogen', 4, 4.6, 1.4)).toBe(true);
    expect(dearNitrogenSolved('nitrogen', 3, 4.6, 1.4)).toBe(false);
    expect(dearNitrogenSolved('nitrogen', 5, 4.6, 1.4)).toBe(false);
    expect(dearNitrogenSolved('nitrogen', 6, 4.6, 1.4)).toBe(false);
    expect(dearNitrogenSolved('nitrogen', 4, 4.6, 1.2)).toBe(false);
    expect(dearNitrogenSolved('nitrogen', 4, 5, 1.4)).toBe(false);
    expect(dearNitrogenSolved('water', 4, 4.6, 1.4)).toBe(false);
  });
});

describe('agriculture 2.2: seed in the optimizer', () => {
  it('runs from 24,000 to 36,000 seeds, and agrees with the prose', () => {
    expect(SEED_LEVELS).toEqual([24000, 26000, 28000, 30000, 32000, 34000, 36000]);
    const c = inputCurve('seed', 4.6, 3.6);
    expect(c.levels[c.best]).toBe(30000);
    expect(SEEDS.map((p) => c.output[SEED_LEVELS.indexOf(p)])).toEqual(seedYields());
    // Each step costs $7.20; 28k → 30k pays, 30k → 32k doesn't.
    expect(c.cost[4] - c.cost[3]).toBeCloseTo(7.2, 9);
    expect(c.value[3] - c.value[2]).toBeGreaterThan(7.2);
    expect(c.value[4] - c.value[3]).toBeLessThan(7.2);
    // The budget's 32,000 gives up less than a dollar (the readout the figure opens on).
    expect(c.net[3] - c.net[4]).toBeLessThan(1);
    expect(c.net[3] - c.net[4]).toBeGreaterThan(0);
  });
});

describe('agriculture 2.3: the scouting challenge starts at 4%', () => {
  const base = { cornOnCorn: false, pressure: 1, price: 4.6, fungicide: 32 };
  it('starts well away from the best threshold', () => {
    expect(START_THRESHOLD).toBe(0.04);
    const start = scoutingRecord(START_THRESHOLD);
    expect(start.sprays).toBe(3);
    expect(r2(start.mean)).toBe(-2.74);
    // "most of the $4 it pays to look"
    expect(-start.mean).toBeGreaterThan(2);
  });
  it('is unsolved at the defaults and at the neighbors, solved at 2%', () => {
    expect(thresholdSolved({ strategy: 'fungicide', ...base, threshold: START_THRESHOLD })).toBe(false);
    expect(thresholdSolved({ strategy: 'scout', ...base, threshold: START_THRESHOLD })).toBe(false);
    expect(thresholdSolved({ strategy: 'scout', ...base, threshold: 0.02 })).toBe(true);
    expect(thresholdSolved({ strategy: 'scout', ...base, threshold: 0.015 })).toBe(false);
    expect(thresholdSolved({ strategy: 'scout', ...base, threshold: 0.025 })).toBe(false);
    expect(thresholdSolved({ strategy: 'scout', ...base, threshold: 0.02, pressure: 2 })).toBe(false);
  });
  it('gives the sentence that uses pressure, corn price and spray cost', () => {
    const o = { ...base, threshold: 0.02 };
    const spray = (x: Partial<typeof o>) => r2(strategyRecord('fungicide', { ...o, ...x }).mean);
    expect(spray({ pressure: 2 })).toBe(19.85);
    expect(spray({ price: 6 })).toBe(11.01);
    expect(spray({ fungicide: 20 })).toBe(12.58);
    // "At its best, scouting beats spraying every field but not the resistant hybrid."
    const scout = strategyRecord('scout', o).mean;
    expect(scout).toBeGreaterThan(strategyRecord('fungicide', o).mean);
    expect(scout).toBeLessThan(strategyRecord('resistant', o).mean);
  });
});

describe('agriculture 2.4: drying at 7¢', () => {
  const at = (start: number, drying = DEAR_DRYING) => ({ ...HARVEST_BASE, drying, start });
  it('gives the best start and the near-best window at 3.5¢', () => {
    const b = bestStart(HARVEST_BASE);
    expect(dateLabel(b.day)).toBe('Oct 17');
    expect(Math.round(b.value)).toBe(821);
    const n = nearBest(HARVEST_BASE);
    expect(dateLabel(n.from)).toBe('Oct 10');
    expect(dateLabel(n.to)).toBe('Oct 27');
  });
  it('moves the best start 16 days later at 7¢', () => {
    const d = { ...HARVEST_BASE, drying: DEAR_DRYING };
    const b = bestStart(d);
    expect(dateLabel(b.day)).toBe('Nov 2');
    expect(b.day - bestStart(HARVEST_BASE).day).toBe(16);
    const n = nearBest(d);
    expect(dateLabel(n.from)).toBe('Oct 29');
    expect(dateLabel(n.to)).toBe('Nov 8');
    // The old best falls about $6 short; the two windows don't overlap.
    expect(Math.round(b.value - harvest(at(dayOf(10, 17))).valuePerAcre)).toBe(6);
    expect(n.from).toBeGreaterThan(nearBest(HARVEST_BASE).to);
    // Every day in the window is within $1, and the slider's 7¢ isn't its end.
    for (let day = n.from; day <= n.to; day++) expect(harvestSolved(at(day))).toBe(true);
    expect(DEAR_DRYING).toBeLessThan(0.08);
  });
  it('is unsolved at the defaults and just outside the window', () => {
    expect(harvestSolved({ ...HARVEST_BASE, start: MATURE })).toBe(false);
    expect(atChallenge({ ...HARVEST_BASE, start: MATURE })).toBe(false);
    expect(harvestSolved(at(dayOf(10, 17), 0.035))).toBe(false);
    expect(harvestSolved(at(dayOf(10, 17)))).toBe(false);
    expect(harvestSolved(at(dayOf(10, 28)))).toBe(false);
    expect(harvestSolved(at(dayOf(11, 9)))).toBe(false);
    expect(harvestSolved({ start: dayOf(11, 2), perDay: 120, drying: DEAR_DRYING, price: 4.6 })).toBe(false);
  });
  it('gives the sweet spots in the prose that follows', () => {
    const best = (x: Partial<typeof HARVEST_BASE>) => dateLabel(bestStart({ ...HARVEST_BASE, ...x }).day);
    expect(best({ drying: 0.02 })).toBe('Oct 4');
    expect(best({ perDay: 160 })).toBe('Oct 24');
    expect(best({ price: 7 })).toBe('Oct 4');
    expect(best({ price: 3 })).toBe('Oct 27');
  });
  it('fits the wheat charts’ scales: rain under an inch a day, sprouting under 15%', () => {
    const ripe = fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'wheat' }).maturityDay;
    const w = simulatedYear(REFERENCE_YEAR, 'prairie');
    for (let d = ripe - 4; d <= ripe + 31; d++) expect(w[d].rain).toBeLessThan(1);
    expect(r2(w[ripe + 1].rain)).toBe(0.5);
    for (let k = 0; k <= 31; k++) expect(wheatValue(k).sprouted).toBeLessThan(0.15);
  });
});

describe('agriculture 2.5: breakeven at a $300 rent', () => {
  it('lifts the breakeven by 20 cents, to $4.94', () => {
    expect(RAISED_RENT).toBe(300);
    const base = acreBudget('corn', 4.6, 176, 1, 265);
    const raised = acreBudget('corn', 4.6, 176, 1, RAISED_RENT);
    expect(r2(raised.breakevenPrice - base.breakevenPrice)).toBe(0.2);
    expect(Math.round(((RAISED_RENT - 265) / 176) * 100)).toBe(20);
    expect(r2(raised.breakevenPrice)).toBe(4.94);
    expect(r2(base.breakevenPrice)).toBe(4.74);
  });
  it('is unsolved at the defaults, solved at $4.95, and not at its neighbors', () => {
    expect(breakevenSolved('corn', 4.6, 176, 1, 265)).toBe(false);
    expect(breakevenSolved('corn', 4.75, 176, 1, 265)).toBe(false);
    expect(atRaisedRent('corn', 176, 1, 265)).toBe(false);
    expect(breakevenSolved('corn', 4.95, 176, 1, RAISED_RENT)).toBe(true);
    expect(breakevenSolved('corn', 4.9, 176, 1, RAISED_RENT)).toBe(false);
    expect(breakevenSolved('corn', 5.0, 176, 1, RAISED_RENT)).toBe(false);
    expect(breakevenSolved('corn', 4.95, 177, 1, RAISED_RENT)).toBe(false);
    // Not a knife-edge: $1.60 above, $7.20 below.
    expect(r2(acreBudget('corn', 4.95, 176, 1, RAISED_RENT).profit)).toBe(1.6);
    expect(r2(acreBudget('corn', 4.9, 176, 1, RAISED_RENT).profit)).toBe(-7.2);
  });
  it('gives the fertilizer sentence', () => {
    const base = acreBudget('corn', 4.6, 176, 1, 265);
    const dear = acreBudget('corn', 4.6, 176, 1.3, 265);
    expect(r2(dear.cost - base.cost)).toBe(40.5);
    expect(r2(dear.breakevenPrice)).toBe(4.97);
  });
});
