// Agriculture chapter 4: the numbers its prose computes or quotes, and that each challenge starts
// unsolved and is solved by its intended answer. (The shared tests/agriculture.test.ts covers the rest.)

import { describe, expect, it } from 'vitest';
import { CORN_GRADES, CORN_SCHEDULE, cornGrade, cornPrice, wheatPrice } from '../src/engines/agriculture/grain';
import { harvestRush } from '../src/engines/agriculture/elevator';
import { simulateBin } from '../src/engines/agriculture/storage';
import { routeCrop } from '../src/engines/agriculture/logistics';
import { meanValley } from '../src/engines/agriculture/world';
import { DRYING_PER_POINT } from '../src/model/agriculture/economics';
import { REFERENCE_YEAR } from '../src/model/agriculture/climate';
import { dayOf } from '../src/model/agriculture/region';
import { CORN_BID, LIGHT_LOAD, WET_LOAD, gradeSolved, paidProteinPremium } from '../src/lessons/agriculture/ch4/L4_1';
import { wettestSolved, wettestSound } from '../src/lessons/agriculture/ch4/L4_2';
import { BIG_AT_USUAL, BIG_PEAK, TERMINAL, blendGain, blendSolved, factorLimit, spreadSolved } from '../src/lessons/agriculture/ch4/L4_3';
import { CAP0, NET0, RIDGE_BY_BARGE, RIDGE_BY_RAIL, VALLEY_USE, bargeSolved, bigCropOneInTen, fillShare, leftInBins, lowWater, railSolved, seasons, settingsOf } from '../src/lessons/agriculture/ch4/L4_4';
import { WORLD0, dearBigYear, dearShortfallSolved, harvestsAdd, history, shortfallAdds, valleyAverage } from '../src/lessons/agriculture/ch4/L4_5';

const cents = (x: number) => Math.round(x * 100);
const usd2 = (x: number) => x.toFixed(2);

describe('agriculture 4.1: grain quality', () => {
  it('works the wet-load example live', () => {
    expect(WET_LOAD.paidBushels.toFixed(3)).toBe('0.936');
    expect(Math.round(WET_LOAD.drying * 1000)).toBe(225);
    expect(cents(WET_LOAD.netPerBushel)).toBe(391);
  });
  it('charges more to dry at the elevator than on the farm', () => {
    expect(CORN_SCHEDULE.drying).toBeCloseTo(0.045, 9);
    expect(DRYING_PER_POINT).toBeCloseTo(0.035, 9);
  });
  it('pays no protein premium on wheat sold as feed', () => {
    const feed = wheatPrice({ protein: 13, testWeight: 59, don: 6, damaged: 2 }, 6);
    expect(feed.rejected).toBe(true);
    expect(paidProteinPremium(feed)).toBe(0);
    expect(cents(feed.net)).toBe(405);
    const milled = wheatPrice({ protein: 13, testWeight: 59, don: 1, damaged: 2 }, 6);
    expect(paidProteinPremium(milled)).toBeCloseTo(0.4, 9);
  });
  it('grades by the worst factor: a No. 3 load on test weight takes damage up to No. 3’s limit', () => {
    const start = { testWeight: 55, damaged: 2.5, bcfm: 1.5, moisture: 15 };
    expect(gradeSolved(start)).toBe(false);
    const light = { ...start, testWeight: LIGHT_LOAD };
    expect(cornGrade(light).grade).toBe(3);
    expect(gradeSolved(light)).toBe(false);
    expect(CORN_GRADES[2].damaged).toBe(7);
    expect(gradeSolved({ ...light, damaged: 7 })).toBe(true);
    expect(gradeSolved({ ...light, damaged: 6.5 })).toBe(false);
    expect(gradeSolved({ ...light, damaged: 7.5 })).toBe(false);
    expect(cornGrade({ ...light, damaged: 7.5 }).grade).toBe(4);
    // Another test weight in No. 3, or BCFM already at No. 4, doesn’t count.
    expect(gradeSolved({ ...light, testWeight: 52.5, damaged: 7 })).toBe(false);
    expect(gradeSolved({ ...light, damaged: 7, bcfm: 4.5 })).toBe(false);
    expect(gradeSolved({ ...light, damaged: 7, bcfm: 4, moisture: 20 })).toBe(true);
    // The success message: the grade holds, but the damage above No. 2 still costs 4¢ on top of test weight’s 2¢.
    const p = cornPrice({ ...light, damaged: 7 }, CORN_BID);
    expect(cents((7 - 5) * CORN_SCHEDULE.damaged)).toBe(4);
    expect(cents((54 - LIGHT_LOAD) * CORN_SCHEDULE.testWeight)).toBe(2);
    expect(cents(p.quality)).toBe(6);
  });
});

describe('agriculture 4.2: drying and storage', () => {
  const FILL = dayOf(10, 20);
  const TO_JULY = 365 - FILL + dayOf(7, 15);
  const bin = (aeration: boolean) =>
    simulateBin({ year: REFERENCE_YEAR, district: 'prairie', fillDay: FILL, days: TO_JULY, harvestMoisture: 19, dryTo: 15, aeration, price: CORN_BID, interest: 0.07, perMonth: 0.02 });
  const meanGrain = (aeration: boolean, months: number[]) => {
    const xs = bin(aeration)
      .days.filter((d) => {
        const day = (FILL + d.t) % 365;
        return months.some((m) => day >= dayOf(m, 1) && day < (m === 12 ? 365 : dayOf(m + 1, 1)));
      })
      .map((d) => d.grain);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  it('keeps the temperatures the prose quotes', () => {
    expect(Math.round(meanGrain(false, [12, 1, 2]))).toBe(8);
    expect(Math.round(meanGrain(false, [6]))).toBe(10);
    expect(Math.round(meanGrain(true, [6]))).toBe(6);
  });
  it('lets aerated corn go into the bin two points wetter, saving 7 cents of drying', () => {
    expect(wettestSound('off')).toBe(16);
    expect(wettestSound('on')).toBe(18);
    expect(cents((wettestSound('on') - wettestSound('off')) * DRYING_PER_POINT)).toBe(7);
  });
  const used = (m: number, aeration: boolean) => {
    const r = simulateBin({ year: REFERENCE_YEAR, district: 'prairie', fillDay: FILL, days: TO_JULY, harvestMoisture: 19, dryTo: m, aeration, price: CORN_BID, interest: 0.07, perMonth: 0.02 });
    return { spoilage: r.days[r.days.length - 1].spoilage, spoiledOn: r.spoiledAt >= 0 ? (FILL + r.spoiledAt) % 365 : -1 };
  };
  it('doubles the share used for every point and a half of moisture, so the halving rule predicts the answer', () => {
    expect(Math.round(used(15, true).spoilage * 100)).toBe(25);
    expect(Math.round(used(15, false).spoilage * 100)).toBe(60);
    expect(used(16.5, true).spoilage / used(15, true).spoilage).toBeCloseTo(2, 9);
    expect(used(18, true).spoilage / used(15, true).spoilage).toBeCloseTo(4, 9);
    expect((used(18, true).spoilage * 100).toFixed(1)).toBe('99.7');
    expect(used(18.5, true).spoiledOn).toBe(dayOf(6, 20));
    expect(used(16.5, false).spoiledOn).toBe(dayOf(6, 13));
  });
  it('asks for the aerated case: unsolved at the start, solved at 18%, not at the near misses', () => {
    const at = (dryTo: number, aeration: 'on' | 'off' = 'on') => wettestSolved({ dryTo, aeration, days: TO_JULY, where: 'farm' });
    expect(at(15)).toBe(false);
    expect(at(18)).toBe(true);
    expect(at(17.5)).toBe(false);
    expect(at(18.5)).toBe(false);
    expect(at(16, 'off')).toBe(false);
    expect(wettestSolved({ dryTo: 18, aeration: 'on', days: TO_JULY - 1, where: 'farm' })).toBe(false);
    expect(wettestSolved({ dryTo: 18, aeration: 'on', days: TO_JULY, where: 'elevator' })).toBe(true);
  });
});

describe('agriculture 4.3 and 4.4: the price chain', () => {
  it('runs from the port to the farm', () => {
    const base = routeCrop(settingsOf(NET0))!;
    expect(TERMINAL).toBeCloseTo(4.75, 9);
    expect(base.locationValue.fairview).toBeCloseTo(TERMINAL, 6);
    expect(TERMINAL - 0.35).toBeCloseTo(CORN_BID, 9);
    expect(settingsOf(NET0).westhaven - settingsOf(NET0).sable).toBeCloseTo(0.35, 9);
  });
});

describe('agriculture 4.3: grain elevators', () => {
  it('grades the frosted bin and finds damage the tightest factor, at 3/7', () => {
    const frosted = { testWeight: 51, damaged: 9, bcfm: 3.5, moisture: 15 };
    expect(cornGrade(frosted).grade).toBe(4);
    expect(cents(CORN_BID - cornPrice(frosted, CORN_BID).netPerBushel)).toBe(15);
    expect(factorLimit('damaged')).toBeCloseTo(3 / 7, 12);
    expect((factorLimit('damaged') * 100).toFixed(1)).toBe('42.9');
    expect(Math.round(factorLimit('testWeight') * 100)).toBe(54);
    expect(Math.round(factorLimit('bcfm') * 100)).toBe(75);
    expect(factorLimit('damaged')).toBeLessThan(Math.min(factorLimit('testWeight'), factorLimit('bcfm')));
    expect(blendSolved(20)).toBe(false);
    expect(blendSolved(42)).toBe(true);
    expect(blendSolved(41)).toBe(false);
    expect(blendSolved(43)).toBe(false);
    expect(Math.round(blendGain(0.2))).toBe(12000);
    expect(Math.round(blendGain(0.42))).toBe(25200);
    expect(Math.round(-blendGain(0.43))).toBe(14280);
  });
  it('earns more at the narrowest spread that turns nobody away than at 35 cents', () => {
    const big = { harvestMult: 1.3, capacity: 3e6, trains: 1 };
    expect(spreadSolved({ harvestMult: 1, spreadCents: 35, capacity: 3e6, trains: 1 })).toBe(false);
    expect(spreadSolved({ ...big, spreadCents: 35 })).toBe(false);
    expect(spreadSolved({ ...big, spreadCents: 41 })).toBe(false);
    expect(spreadSolved({ ...big, spreadCents: 42 })).toBe(true);
    expect(spreadSolved({ ...big, spreadCents: 43 })).toBe(false);
    expect((BIG_AT_USUAL.turnedAway / 1e6).toFixed(2)).toBe('1.45');
    expect(BIG_AT_USUAL.daysFull).toBe(13);
    expect((BIG_AT_USUAL.bought / 1e6).toFixed(2)).toBe('6.35');
    expect((BIG_AT_USUAL.margin / 1e6).toFixed(2)).toBe('1.71');
    // More bins: another 1.5 million bushels of space would hold the peak (the bin-space slider’s 4.5 million clears it).
    expect((BIG_PEAK - 3).toFixed(1)).toBe('1.5');
    expect(harvestRush({ harvest: 15.6e6, spread: 0.35, capacity: 4.5e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 }).turnedAway).toBe(0);
    expect(harvestRush({ harvest: 15.6e6, spread: 0.35, capacity: 4.25e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 }).turnedAway).toBeGreaterThan(0);
    expect(harvestRush({ harvest: 15.6e6, spread: 0.35, capacity: 3e6, trainsPerWeek: 2, localPerDay: 30000, days: 50 }).turnedAway).toBe(0);
    const rush = (c: number) => harvestRush({ harvest: 15.6e6, spread: c / 100, capacity: 3e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 });
    const at42 = rush(42);
    expect((at42.margin / 1e6).toFixed(2)).toBe('2.06');
    expect(Math.round((at42.margin - BIG_AT_USUAL.margin) / 1000)).toBe(344);
    expect(((BIG_AT_USUAL.bought - at42.bought) / 1e6).toFixed(2)).toBe('0.30');
    expect((at42.bought / 1e6).toFixed(2)).toBe('6.05');
    for (let c = 25; c <= 60; c++) if (c !== 42) expect(rush(c).margin).toBeLessThan(at42.margin);
  });
});

describe('agriculture 4.4: transportation and exports', () => {
  it('gives the barge its 42-cent edge for Upland Ridge corn', () => {
    expect(cents(RIDGE_BY_BARGE)).toBe(495);
    expect(cents(RIDGE_BY_RAIL)).toBe(453);
    expect(RIDGE_BY_BARGE - RIDGE_BY_RAIL).toBeCloseTo(routeCrop(settingsOf(NET0))!.riverValue, 6);
  });
  it('values the High Plains highest, next to the feedyards', () => {
    const lv = routeCrop(settingsOf(NET0))!.locationValue;
    expect(lv.plains).toBeCloseTo(4.83, 6);
    for (const o of ['north', 'prairie', 'ridge', 'bottoms'] as const) expect(lv[o]).toBeLessThan(lv.plains);
  });
  it('lets one hub carry a whole district', () => {
    const base = routeCrop(settingsOf(NET0))!;
    expect(Math.round(seasons().supply.prairie)).toBe(227);
    expect(base.flows['prairie-fairview']).toBeCloseTo(seasons().supply.prairie, 6);
  });
  it('shows a small low-water remainder rather than none', () => {
    const low = lowWater();
    expect(low.railSpare.toFixed(1)).toBe('59.7');
    expect(Math.round(low.left * 100) * 1e4).toBe(260000);
    expect(leftInBins(low.left)).toBe('0.3');
    expect(leftInBins(0)).toBe('0');
    expect(leftInBins(42.4)).toBe('42');
  });
  it('plans the rail for the one-in-ten big crop: 190 million bushels', () => {
    const big = bigCropOneInTen();
    expect(Math.round(big)).toBe(584);
    expect(seasons().totals.filter((t) => t > big).length).toBe(40);
    expect(VALLEY_USE).toBe(216);
    expect(Math.round(big - VALLEY_USE - CAP0.river)).toBe(188);
    expect(Math.ceil((big - VALLEY_USE - CAP0.river) / 10) * 10).toBe(190);
    expect(railSolved(CAP0)).toBe(false);
    expect(railSolved({ ...CAP0, rail: 180 })).toBe(false);
    expect(railSolved({ ...CAP0, rail: 190 })).toBe(true);
    expect(railSolved({ ...CAP0, rail: 200 })).toBe(false);
    expect(Math.round(fillShare({ ...CAP0, rail: 190 }) * 400)).toBe(37);
    expect(Math.round(fillShare({ ...CAP0, rail: 180 }) * 400)).toBe(56);
    expect((190 - CAP0.rail) / 0.4).toBe(50);
  });
  it('ties the routes at 87 cents and costs the River Bottoms at 88', () => {
    const at = (barge: number) => routeCrop(settingsOf({ ...NET0, barge }))!;
    expect(at(87).riverValue).toBeCloseTo(0, 6);
    expect(at(87).locationValue.bottoms).toBeCloseTo(4.65, 6);
    expect(at(88).locationValue.bottoms).toBeLessThan(4.65 - 0.005);
    expect(bargeSolved(NET0)).toBe(false);
  });
});

describe('agriculture 4.5: international supply and demand', () => {
  it('names the sixty-year average against the 400-season one', () => {
    expect(Math.round(valleyAverage())).toBe(500);
    expect(Math.round(meanValley())).toBe(506);
  });
  it('explains year 7 with the importers’ short crop too', () => {
    const y = history()[dearBigYear() - 1];
    expect(y.year).toBe(7);
    expect(Math.round(-y.crop.southAmerica * 100)).toBe(9);
    expect(Math.round(-y.crop.blackSea * 100)).toBe(9);
    expect(Math.round(-y.crop.importers * 100)).toBe(4);
    expect(Math.round(-y.crop.importers * 334)).toBe(15);
    expect(Math.round(-y.crop.southAmerica * 172)).toBe(16);
    expect(Math.round(y.carryIn)).toBe(91);
  });
  it('makes the same shortfall dearer when the world carries in less', () => {
    expect(harvestsAdd(WORLD0)).toBeCloseTo(0, 9);
    expect(usd2(shortfallAdds(100))).toBe('0.95');
    expect(usd2(shortfallAdds(95))).toBe('0.98');
    expect(usd2(shortfallAdds(90))).toBe('1.01');
    expect(usd2(shortfallAdds(130))).toBe('0.78');
    for (let c = 40; c < 160; c += 5) expect(shortfallAdds(c)).toBeGreaterThan(shortfallAdds(c + 5));
    expect((385 * 0.1).toFixed(1)).toBe('38.5');
  });
  it('asks for the most carry-in at which a 10% U.S. shortfall adds more than $1: 90 million tons', () => {
    const at = (carryIn: number, extra: Partial<typeof WORLD0> = {}) => dearShortfallSolved({ ...WORLD0, us: -10, carryIn, ...extra });
    expect(dearShortfallSolved(WORLD0)).toBe(false);
    expect(at(100)).toBe(false);
    expect(at(95)).toBe(false);
    expect(at(90)).toBe(true);
    expect(at(85)).toBe(false);
    expect(at(90, { southAmerica: -5 })).toBe(false);
    expect(dearShortfallSolved({ ...WORLD0, us: -20, carryIn: 90 })).toBe(false);
  });
});
