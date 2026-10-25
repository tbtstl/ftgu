// The oil course's Chapter 7 (the capstone): numbers and claims its prose relies on, beyond the
// challenge checks in tests/oil.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_DEFAULTS, FAN_SEEDS, PRODUCTION_DEFAULTS, corranPrices, hedgeWeek, quantile, refineryDay, refineryMargin, runBusiness } from '../src/engines/oil/business';
import { CRACK_RATIOS, crackOf, seasonalForwards } from '../src/engines/oil/trading';
import { oilHistory } from '../src/model/oil/history';
import { CORRAN } from '../src/model/oil/refinery';
import { DECK_DEFAULTS, deckLines, fanNpvs, luckAnswer, luckSolved, middleSpread, planFacts } from '../src/lessons/oil/ch7/L7_1';
import { COKER_TEST, HISTORY_STATE_DEFAULTS, designOf, designShadowPrices, designValue, heavyDiscount, historyParams, neededGain, shiftSolved, smallestShift } from '../src/lessons/oil/ch7/L7_2';
import { CHAIN_DEFAULTS, SWEEP_DEFAULTS, chainFacts, chainHistoryParams, lineFull, slowestPayingSolved, steadiestSolved } from '../src/lessons/oil/ch7/L7_3';
import {
  DRIVER_DEFAULTS as DESK_DRIVERS,
  EXPANSION_YEARS,
  LINE_ROOM,
  SERIES,
  centralRange,
  getFacts as deskFacts,
  seriesFan,
  steadyBasisSolved,
} from '../src/lessons/oil/ch7/L7_4';
import {
  BIG_CRUDE_UNIT,
  DRIVER_DEFAULTS as TRADER_DRIVERS,
  bestCorranPair,
  harderWorldSolved,
  hedgeTarget,
  hedgesSolved,
  lessonFacts as traderFacts,
  physicalRatios,
  planInUse,
  sameAsStart,
  withHedges,
} from '../src/lessons/oil/ch7/L7_5';
import { confirmResetPart, getBusiness, resetBusiness, updateBusiness } from '../src/lessons/oil/shared/business';

describe('oil chapter 7', () => {
  it('7.1: the middle 80% leaves three histories on each side, and is worth only a few dollars of long-run price', () => {
    const npvs = fanNpvs(PRODUCTION_DEFAULTS);
    expect(npvs.length).toBe(30);
    expect(npvs.filter((v) => v < quantile(npvs, 0.1)).length).toBe(3);
    expect(npvs.filter((v) => v > quantile(npvs, 0.9)).length).toBe(3);
    const lines = deckLines(PRODUCTION_DEFAULTS);
    // The challenge's success message: the history's luck is worth less than $10 of long-run price.
    expect(middleSpread(lines) / lines[0].slope).toBeLessThan(10);
  });

  it('7.2: the hydrotreater has the highest shadow price, but the program fills only about 57 kb/d of a bigger one', () => {
    const sp = designShadowPrices(CORRAN);
    expect(sp.dht).toBeGreaterThan(sp.coker);
    expect(sp.dht).toBeGreaterThan(sp.cdu);
    expect(Math.round(refineryDay(designOf({ dht: 60 })).plan.unitFeed.dht)).toBe(57);
  });

  it('7.2 and 7.4 measure Coldwater’s discount against the same crude, Pinyon Light at Port Corran', () => {
    for (const w of oilHistory().slice(0, 60)) {
      expect(SERIES.heavy.value(w)).toBeCloseTo(heavyDiscount(w), 9);
      expect(heavyDiscount(w)).toBeCloseTo(corranPrices(w).crude.pinyon - w.coldwater, 9);
    }
    const [lo, hi] = centralRange(seriesFan(DESK_DRIVERS, 'heavy'));
    expect(lo).toBeCloseTo(13.77, 2);
    expect(hi).toBeCloseTo(15.27, 2);
  });

  it('7.3: the upstream’s result from the discount is a loss at the starting drivers', () => {
    expect(chainFacts(PRODUCTION_DEFAULTS).loss).toBeGreaterThan(0);
  });

  it('7.4: the WTI band widens to year 2, then settles narrower', () => {
    const f = deskFacts();
    expect(f.wtiPeakYear).toBe(2);
    expect(f.wtiPeak).toBeCloseTo(10.86, 2);
    expect(f.wti1).toBeCloseTo(6.45, 2);
    expect(f.wtiLaterLo).toBeCloseTo(7.76, 2);
    expect(f.wtiLaterHi).toBeCloseTo(8.29, 2);
    expect(f.wtiLaterHi).toBeLessThan(f.wtiPeak);
    expect(f.wtiLaterLo).toBeGreaterThan(f.wti1);
  });

  it('7.5: Corran makes more diesel and jet than gasoline; output peaks late in year 3 and is lower as year 4 begins', () => {
    const p = refineryDay(CORRAN).products;
    expect(p.diesel + p.jet).toBeGreaterThan(p.gasoline);
    const F = traderFacts();
    expect(F.prodPeakWeek).toBeGreaterThanOrEqual(130);
    expect(F.prodPeakWeek).toBeLessThan(156);
    expect(Math.round(F.prodPeak / 100) * 100).toBe(69500);
    expect(Math.round(F.prod4 / 100) * 100).toBe(54800);
    expect(F.prod4).toBeLessThan(F.prodPeak);
    expect(runBusiness(BUSINESS_DEFAULTS).production[156]).toBe(F.prod4);
    expect(FAN_SEEDS.length).toBe(30);
  });

  it('the plan and the hedges are priced at seasonal forwards (Lesson 6.4)', () => {
    const b = { ...BUSINESS_DEFAULTS, hedges: { ...BUSINESS_DEFAULTS.hedges, production: 1, crack: 1 } };
    const r = runBusiness(b);
    const h = r.h;
    const day = refineryDay(CORRAN);
    const share = CRACK_RATIOS[b.hedges.mix];
    const crack = h.map((w) => crackOf(w, b.hedges.bench, share));
    const crackFwd = seasonalForwards(crack);
    const marginFwd = seasonalForwards(h.map((w) => refineryMargin(w, day)));
    for (const i of [1, 20, 77, 150, 259]) {
      const t0 = hedgeWeek(i);
      expect(r.crackHedge[i]).toBeCloseTo(day.runs * 1000 * 7 * (crackFwd(t0, i) - crack[i]), 3);
      expect(r.plan.refinery[i]).toBeCloseTo(7 * marginFwd(t0, i), 3);
      expect(r.expected[i]).toBeCloseTo(r.plan.upstream[i] + r.plan.logistics[i] + r.plan.refinery[i], 3);
    }
  });

  it('7.1b: estimated from the two readouts (to one decimal), the luck is worth $7.7 and the answer is $67', () => {
    const lines = deckLines(PRODUCTION_DEFAULTS);
    const slope = Math.round(lines[0].slope / 1e5) / 10;
    const width = Math.round(middleSpread(lines) / 1e5) / 10;
    expect(slope).toBe(13);
    expect(width).toBe(100);
    expect(Math.floor(75 - width / slope)).toBe(67);
    expect(luckAnswer(PRODUCTION_DEFAULTS)).toBe(67);
    expect(luckSolved(PRODUCTION_DEFAULTS, DECK_DEFAULTS)).toBe(false);
    expect(luckSolved(PRODUCTION_DEFAULTS, { longRun: 67 })).toBe(true);
    expect(luckSolved(PRODUCTION_DEFAULTS, { longRun: 68 })).toBe(false);
    expect(luckSolved(PRODUCTION_DEFAULTS, { longRun: 66 })).toBe(false);
    // The estimate also works for the plan challenge a leads to.
    const ten = { wellsPerYear: 10, waterflood: true, drillAbove: 0 };
    const l10 = deckLines(ten);
    expect(Math.floor(75 - Math.round(middleSpread(l10) / 1e5) / 10 / (Math.round(l10[0].slope / 1e5) / 10))).toBe(luckAnswer(ten));
    // The prose's live numbers for the starting plan.
    const pf = planFacts(PRODUCTION_DEFAULTS);
    expect(pf.rank).toBe(2);
    expect(pf.lateFrom).toBe('the waterflood and Northfield’s old wells');
    expect(Math.round(pf.y3 / 100) * 100).toBe(68300);
    expect(pf.luck).toBeCloseTo(7.72, 2);
  });

  it('7.2b: the coker needs about $137,000 a day; from the $0 and $10 gains the estimate is $11.6, so $12', () => {
    expect(neededGain()).toBeCloseTo(136986, 0);
    const g0 = designValue(COKER_TEST).gain;
    const g10 = designValue(COKER_TEST, historyParams({ shift: 10 })).gain;
    const estimate = (neededGain() - g0) / ((g10 - g0) / 10);
    expect(estimate).toBeGreaterThan(11.3);
    expect(estimate).toBeLessThan(11.9);
    expect(smallestShift()).toBe(12);
    expect(shiftSolved(HISTORY_STATE_DEFAULTS)).toBe(false);
    expect(shiftSolved({ compare: 'coker', shift: 12 })).toBe(true);
    expect(shiftSolved({ compare: 'coker', shift: 11 })).toBe(false);
    expect(shiftSolved({ compare: 'coker', shift: 13 })).toBe(false);
    expect(shiftSolved({ compare: 'yours', shift: 12 })).toBe(false);
  });

  it('7.3a: the 19% break-even share predicts 50 kb/d a year; 7.3b: the year-four exposure predicts 40 kb/d', () => {
    const f = chainFacts(PRODUCTION_DEFAULTS);
    const need = Math.ceil(f.breakeven * f.weeks);
    expect(need).toBe(50);
    const full = (growth: number) => oilHistory(chainHistoryParams({ growth, rail: CHAIN_DEFAULTS.rail })).filter(lineFull).length;
    expect(full(50)).toBeGreaterThanOrEqual(need);
    expect(full(40)).toBeLessThan(need);
    expect(slowestPayingSolved(CHAIN_DEFAULTS)).toBe(false);
    expect(slowestPayingSolved({ growth: 50, rail: CHAIN_DEFAULTS.rail })).toBe(true);
    expect(slowestPayingSolved({ growth: 40, rail: CHAIN_DEFAULTS.rail })).toBe(false);
    expect(slowestPayingSolved({ growth: 60, rail: CHAIN_DEFAULTS.rail })).toBe(false);
    expect(Math.round(-f.e4 / 1000 / 10) * 10).toBe(40);
    expect(steadiestSolved(0, PRODUCTION_DEFAULTS)).toBe(false);
    expect(steadiestSolved(40, PRODUCTION_DEFAULTS)).toBe(true);
    expect(steadiestSolved(30, PRODUCTION_DEFAULTS)).toBe(false);
    expect(steadiestSolved(50, PRODUCTION_DEFAULTS)).toBe(false);
    expect(steadiestSolved(40, PRODUCTION_DEFAULTS, { ...SWEEP_DEFAULTS, rail: 0 })).toBe(false);
  });

  it('7.4a: 100 kb/d of room over three years predicts 30 kb/d a year', () => {
    expect(LINE_ROOM).toBe(100);
    expect(EXPANSION_YEARS).toBe(3);
    expect(Math.floor(LINE_ROOM / EXPANSION_YEARS / 10) * 10).toBe(30);
    expect(steadyBasisSolved(DESK_DRIVERS)).toBe(false);
    expect(steadyBasisSolved({ ...DESK_DRIVERS, growth: 30 })).toBe(true);
    expect(steadyBasisSolved({ ...DESK_DRIVERS, growth: 20 })).toBe(false);
    expect(steadyBasisSolved({ ...DESK_DRIVERS, growth: 40 })).toBe(false);
    // The plan holds the seasons: without them the one-in-ten worst quarter barely changes.
    const f = deskFacts();
    expect(Math.abs(f.cashNoSeasons.worstSurprise.p10 - f.cash.worstSurprise.p10)).toBeLessThan(0.1 * Math.abs(f.cash.worstSurprise.p10));
  });

  it('7.5a: the physical facts predict the best ratios, and the predicted pair solves', () => {
    const F = traderFacts();
    expect(F.phys.lightShare).toBeCloseTo(0.73, 2);
    expect(F.phys.production).toBeCloseTo(0.5, 2);
    expect(Math.abs(F.best.crack - F.phys.lightShare)).toBeLessThan(0.02);
    expect(Math.abs(F.best.production - F.phys.production)).toBeLessThan(0.02);
    expect(F.best.effectiveness).toBeCloseTo(0.876, 3);
    expect(hedgeTarget(bestCorranPair(BUSINESS_DEFAULTS).effectiveness)).toBe(0.8);
    const at = (p: number, c: number, mix: 'corran' | '3:2:1' = 'corran') => hedgesSolved(withHedges(BUSINESS_DEFAULTS, p, c, mix, 'brent'));
    expect(hedgesSolved(BUSINESS_DEFAULTS)).toBe(false);
    expect(at(0.5, 0.75)).toBe(true);
    expect(at(0.5, 0.7)).toBe(true);
    expect(at(0.3, 0.75)).toBe(false);
    expect(at(0.5, 0.4)).toBe(false);
    expect(at(0, 0.75)).toBe(false);
    expect(at(0.5, 0)).toBe(false);
    expect(at(0.5, 0.75, '3:2:1')).toBe(false);
    // Changing the refinery in 7.2 moves the share and the best crack ratio together.
    const big = { ...BUSINESS_DEFAULTS, refinery: BIG_CRUDE_UNIT };
    expect(physicalRatios(big).lightShare).toBeCloseTo(0.56, 2);
    expect(Math.abs(bestCorranPair(big).crack - physicalRatios(big).lightShare)).toBeLessThan(0.06);
    expect(bestCorranPair(big).crack).toBeLessThan(F.best.crack - 0.05);
  });

  it('7.5: the instrument, the firm space and the worlds behave as the prose says', () => {
    const F = traderFacts();
    expect(F.standard.effectiveness).toBeLessThan(F.twoOne.effectiveness);
    expect(F.twoOne.effectiveness).toBeLessThan(F.best.effectiveness);
    expect(F.wti.effectiveness).toBeLessThan(F.twoOne.effectiveness);
    expect(F.corranAlone).toBeGreaterThan(F.phys.lightShare + 0.1);
    expect(F.firmWti.effectiveness).toBeGreaterThan(F.firmBrent.effectiveness + 0.1);
    expect(F.bigExtraLight).toBeLessThan(0.1 * F.bigExtraRuns);
    expect(F.corr).toBeLessThan(-0.7);
    expect(F.all.rmsHedged).toBeGreaterThan(F.base.rmsSurprise);
    expect(F.fuel20.effectiveness).toBeLessThan(F.start.effectiveness - 0.1);
    expect(F.noRail.effectiveness).toBeLessThan(F.start.effectiveness - 0.05);
    expect(Math.abs(F.noSeasons.effectiveness - F.start.effectiveness)).toBeLessThan(0.03);
    expect(F.free.effectiveness).toBeGreaterThan(F.start.effectiveness);
    // Challenge b: fuel oil or rail can cut five points; seasons and the producer group can't.
    const harder = (patch: Partial<typeof TRADER_DRIVERS>) => harderWorldSolved(BUSINESS_DEFAULTS, { ...TRADER_DRIVERS, ...patch });
    expect(harder({})).toBe(false);
    expect(harder({ fuelOil: 10 })).toBe(true);
    expect(harder({ fuelOil: 8 })).toBe(false);
    expect(harder({ rail: 0 })).toBe(true);
    expect(harder({ rail: 25 })).toBe(false);
    expect(harder({ seasonality: 0 })).toBe(false);
    expect(harder({ seasonality: 2 })).toBe(false);
    expect(harder({ group: 'free' })).toBe(false);
    // The other histories: the example hedges hold up.
    expect(F.histMedian).toBeCloseTo(0.861, 3);
    expect(F.gapMedian).toBeLessThan(0.03);
  });

  it('7.5: the plan switch keeps the reader’s hedges on the starting plan', () => {
    const mine = { ...BUSINESS_DEFAULTS, production: { wellsPerYear: 10, waterflood: true, drillAbove: 0 }, hedges: { ...BUSINESS_DEFAULTS.hedges, production: 0.4 } };
    expect(sameAsStart(mine)).toBe(false);
    const start = planInUse('start', mine);
    expect(sameAsStart(start)).toBe(true);
    expect(start.hedges.production).toBe(0.4);
    expect(planInUse('yours', mine)).toBe(mine);
  });
});

describe('oil chapter 7: the saved business', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetBusiness();
  });

  it('a reset asks first, and touches only its own lesson’s part', () => {
    resetBusiness();
    updateBusiness('production', { wellsPerYear: 10 });
    updateBusiness('hedges', { production: 0.5 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmResetPart('production')).toBe(false);
    expect(getBusiness().production.wellsPerYear).toBe(10);
    confirm.mockReturnValue(true);
    expect(confirmResetPart('production')).toBe(true);
    expect(getBusiness().production.wellsPerYear).toBe(PRODUCTION_DEFAULTS.wellsPerYear);
    expect(getBusiness().hedges.production).toBe(0.5);
    // An unchanged part resets without asking.
    confirm.mockClear();
    expect(confirmResetPart('refinery')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
