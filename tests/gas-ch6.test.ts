// Chapter 6 of the gas course: the weather desk of Lesson 6.1, one degree-day measure across the
// chapter, the late-expansion and Northline worlds, and the numbers the revised prose quotes.

import { describe, expect, it } from 'vitest';
import { HEATING_MONTHS, pnlByYear, ridgebackTakeaway } from '../src/engines/gas/strategies';
import { gasHistory } from '../src/model/gas/history';
import { GAS_MONTH_DAYS, GAS_MONTH_START, GAS_YEAR_DAYS, normalTemp, WINTER_START } from '../src/model/gas/weather';
import { HISTORY_MARKET, HISTORY_WORLD, isHistoryWorld, LATE_EXPANSION_WORLD, worldConditions, worldHistory, worldMarket } from '../src/engines/gas/worlds';
import {
  COLD_SPELL,
  coldSpellAnswer,
  coldSpellMiss,
  coldSpellSeen,
  forecasterRun,
  forecasterSolved,
  forecasterSurprises,
  forecasterRestError,
  forecasterTwoWeeks,
  FORECASTER_DEFAULTS,
  halfWeather,
  HALF_DEFAULTS,
  noLossThreshold,
  WEATHER_DESK_DEFAULTS,
  WEATHER_THRESHOLD,
  weatherDeskRun,
  weatherDeskSolved,
  weatherSlope,
} from '../src/lessons/gas/ch6/L6_1';
import { profitableThresholds, ruleBookFor, SPREAD_RULE_DEFAULTS, SPREAD_TRADER_DEFAULTS, spreadTraderSolved, traderBook, traderCold, traderWinters } from '../src/lessons/gas/ch6/L6_2';
import { BASIS_DESK_DEFAULTS, basisDeskNumbers, basisDeskRun, basisDeskSolved, firstNonGlutGrowth, GROWTH_STEP, leastGlutGrowth, metroDeskRun } from '../src/lessons/gas/ch6/L6_3';
import {
  ARB_LEASE_DEFAULTS,
  ARBITRAGE_DEFAULTS,
  arbitrageData,
  arbitrageNumbers,
  arbitrageSolved,
  FEE_SCALE,
  leaseFloorFee,
  leaseYearSolved,
  northlineAt,
  NORTHLINE_WORLD,
} from '../src/lessons/gas/ch6/L6_4';
import { LAB_WEATHER, labBook, labSkipBest, labWalk, labWinterHdd, strategyLabNumbers } from '../src/lessons/gas/ch6/L6_5';

const k = (x: number) => Math.round(x / 1000);

describe('gas 6.1: trading two weeks', () => {
  it('trades the heating months, October to April, whose every normal day is below 65 °F', () => {
    expect([...HEATING_MONTHS].sort((a, b) => a - b)).toEqual([0, 6, 7, 8, 9, 10, 11]);
    const maxNormal = (m: number) => Math.max(...Array.from({ length: GAS_MONTH_DAYS[m] }, (_, i) => normalTemp(GAS_MONTH_START[m] + i)));
    for (const m of HEATING_MONTHS) expect(maxNormal(m)).toBeLessThan(65);
    for (const m of [1, 5]) expect(maxNormal(m)).toBeGreaterThan(65);
  });

  it('quotes the desk at skill 0.8 and 1 °F: 27 of 56 months, 22 winners, $585,000, about $0.11 per °F', () => {
    expect(WEATHER_DESK_DEFAULTS).toEqual({ skill: LAB_WEATHER.skill, threshold: LAB_WEATHER.thresholdF });
    const r = weatherDeskRun(WEATHER_DESK_DEFAULTS.skill, WEATHER_DESK_DEFAULTS.threshold);
    expect(r.signals).toHaveLength(56);
    expect(r.book.trades).toHaveLength(27);
    expect(r.book.trades.filter((o) => o.pnl > 0)).toHaveLength(22);
    expect(k(r.book.total)).toBe(585);
    expect(weatherSlope(0.8)).toBeCloseTo(0.11, 2);
    // The same desk Lesson 6.5 tests.
    expect(labBook('weather', 1, 1).total).toBeCloseTo(r.book.total, 6);
    // No skill: the forecast is normal and the desk never trades, whatever the threshold.
    expect(weatherDeskRun(0, 0).book.trades).toHaveLength(0);
  });

  it('solves the challenge at 4 °F: three months, $128,000; at 3.5 °F January of Year 1 loses', () => {
    expect(noLossThreshold(1)).toBe(4);
    const at = weatherDeskRun(1, 4);
    expect(at.book.trades).toHaveLength(3);
    expect(at.book.trades.every((o) => o.pnl > 0)).toBe(true);
    expect(k(at.book.total)).toBe(128);
    const below = weatherDeskRun(1, 4 - WEATHER_THRESHOLD.step);
    const losers = below.book.trades.filter((o) => o.pnl <= 0);
    expect(losers.map((o) => o.trade.entry)).toEqual([9]);
    const g = below.signals.find((x) => x.month === 9)!;
    expect(g.forecastColder).toBeCloseTo(3.6, 1);
    expect(g.actualColder).toBeCloseTo(1.0, 1);
    expect(weatherDeskSolved(WEATHER_DESK_DEFAULTS)).toBe(false);
    expect(weatherDeskSolved({ skill: 1, threshold: 4 })).toBe(true);
    expect(weatherDeskSolved({ skill: 1, threshold: 3.5 })).toBe(false);
    expect(weatherDeskSolved({ skill: 1, threshold: 4.5 })).toBe(false);
    expect(weatherDeskSolved({ skill: 0.9, threshold: 4 })).toBe(false);
  });

  it('finds Year 3’s November forecast rosier than Year 6’s, and five years outside a typical miss', () => {
    const base = forecasterRun(FORECASTER_DEFAULTS.year, WINTER_START, FORECASTER_DEFAULTS.skill);
    const cold = forecasterRun(2, WINTER_START, FORECASTER_DEFAULTS.skill);
    expect(cold.endMean).toBeGreaterThan(base.endMean + 0.5);
    const rest0 = forecasterRestError(0);
    expect(forecasterSurprises().filter((s) => Math.abs(s[0]) > rest0[0])).toHaveLength(5);
  });
});

describe('gas chapter 6: one degree-day measure', () => {
  it('counts heating degree days against normal, November to March, in 6.1, 6.4 and 6.5 alike', () => {
    const hdd = labWinterHdd().map((x) => Math.round(x));
    expect(hdd).toEqual([-37, -452, 610, -440, 495, 67, -233, 103]);
    expect(forecasterSurprises().map((s) => Math.round(s[0]))).toEqual(hdd);
    expect(arbitrageData().colder.map((x) => Math.round(x))).toEqual(hdd);
    expect(Array.from({ length: 8 }, (_, y) => Math.round(traderCold(y, WINTER_START, GAS_YEAR_DAYS)))).toEqual(hdd);
  });

  it('labels 6.2’s window to March 1, where Years 1 and 6 change sides', () => {
    const ma = traderWinters('marApr');
    expect(ma.map((w) => Math.round(w.cold))).toEqual([152, -409, 431, -431, 516, -27, -315]);
    const flips = ma.filter((w) => w.cold > 0 !== traderCold(w.year, WINTER_START, GAS_YEAR_DAYS) > 0).map((w) => w.year);
    expect(flips).toEqual([0, 5]);
  });
});

describe('gas 6.3: the world where the expansion opens a year late', () => {
  it('changes only Ridgeback Express from Year 6, and reruns the years it touches', () => {
    expect(isHistoryWorld(HISTORY_WORLD)).toBe(true);
    expect(worldMarket(HISTORY_WORLD)).toBe(HISTORY_MARKET);
    expect(worldConditions(LATE_EXPANSION_WORLD, 5).ridgebackExpress).toBeCloseTo(2.1, 9);
    expect(worldConditions(LATE_EXPANSION_WORLD, 6).ridgebackExpress).toBeCloseTo(2.6, 9);
    const late = worldHistory(LATE_EXPANSION_WORLD);
    const real = gasHistory();
    for (let y = 0; y < 5; y++) expect(late[y]).toBe(real[y]);
    expect(late[5].days.every((d) => d.rationed < 1e-6)).toBe(true);
    // Storage still carries from one March to the next April.
    for (let y = 5; y < 8; y++) expect(late[y].start).toEqual(late[y - 1].days[364].storage);
  });

  it('quotes Year 6 in the late world and the desk’s six Year 6 purchases failing there', () => {
    const n = basisDeskNumbers();
    expect(n.lateProdY6).toBeCloseTo(3.2, 9);
    expect(n.lateTakeawayY6).toBeCloseTo(3.05, 9);
    expect(n.lateProdY6 - n.lateTakeawayY6).toBeGreaterThan(n.prod(4) - n.takeaway);
    expect(n.lateY6Avg).toBeCloseTo(-2.69, 2);
    expect(n.lateY6Avg).toBeLessThan(n.y5Avg);
    expect(n.lateY6Count).toBe(6);
    expect(n.lateY6Losers).toBe(5);
    expect(k(n.lateY6Pnl)).toBe(-208);
    expect(n.expOnlyPnl / 1e6).toBeCloseTo(2.77, 2);
    expect(n.lateY7Count).toBe(6);
    expect(n.lateY7Pnl / 1e6).toBeCloseTo(3.38, 2);
    // The market's own hypothesis never trades in either world, and the challenge's answer doesn't depend on the world.
    expect(basisDeskRun({ ...BASIS_DESK_DEFAULTS, late: true }).book.trades).toHaveLength(0);
    expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: 0.1, late: true })).toBe(true);
  });

  it('sells months of years without a glut only from 0.22 Bcf/d a year: Years 4 and 8 at 0.30', () => {
    expect(firstNonGlutGrowth()).toBeCloseTo(0.22, 9);
    const n = basisDeskNumbers();
    expect(n.eagerYears).toEqual([3, 7]);
    expect(basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: 0.2 }).book.trades).toHaveLength(6);
  });

  it('skips January of Year 3 from skill 0.1 yet loses until 0.4 (challenge b’s success text)', () => {
    const n = basisDeskNumbers();
    expect(n.firstSkipJan3).toBeCloseTo(0.1, 9);
    for (const skill of [0.1, 0.2, 0.3]) {
      const r = metroDeskRun({ mode: 'forecast', skill, colder: 0 });
      expect(r.pnl.has(2 * 12 + 9)).toBe(false);
      expect(r.book.total).toBeLessThan(0);
    }
    expect(metroDeskRun({ mode: 'forecast', skill: 0.4, colder: 0 }).book.trades).toHaveLength(9);
  });
});

describe('gas 6.4: Northline’s capacity as a world', () => {
  it('values firm capacity by the pipe: 30, 79 and 178 days full at 2.0, 1.8 and 1.6 Bcf/d', () => {
    const built = northlineAt(NORTHLINE_WORLD.built);
    const bigger = northlineAt(2.0);
    const smaller = northlineAt(1.6);
    expect([bigger.fullDays, built.fullDays, smaller.fullDays]).toEqual([30, 79, 178]);
    expect(k(built.forward)).toBe(325);
    expect(k(bigger.forward)).toBe(107);
    expect(k(smaller.forward)).toBe(644);
    // In each world the curve prices it flat, at what that world's snaps paid on average.
    for (const x of [bigger, smaller]) expect(x.earned / x.forward).toBeCloseTo(1, 6);
    for (const c of [1.6, 2.0]) {
      const fwd = arbitrageData({ ...HISTORY_WORLD, northlineBcfd: c }).northline.map((a) => a.forward);
      expect(Math.max(...fwd) - Math.min(...fwd)).toBeLessThan(1);
    }
  });

  it('solves the lease-fee challenge only in the world as built', () => {
    const at = { ...ARBITRAGE_DEFAULTS, lease: leaseFloorFee() };
    expect(arbitrageSolved(at)).toBe(true);
    expect(arbitrageSolved({ ...at, northlineBcfd: 2.0 })).toBe(false);
  });
});

describe('gas 6.5: the backtest’s revised numbers', () => {
  const n = strategyLabNumbers();

  it('splits the Ridgeback desk into its sold Year 5 and bought Year 6, and tries the purchases in the late world', () => {
    expect(n.ridgeSoldCount).toBe(6);
    expect(n.ridgeBoughtCount).toBe(6);
    expect(n.ridgeSoldYear).toBe(4);
    expect(n.ridgeBoughtYear).toBe(5);
    expect(n.ridgeSold / 1e6).toBeCloseTo(1.84, 2);
    expect(n.ridgeBought / 1e6).toBeCloseTo(2.77, 2);
    expect(n.ridgeSold + n.ridgeBought).toBeCloseTo(n.ridgeback.total, 3);
    expect(n.lateSameCount).toBe(6);
    expect(n.lateSameLosers).toBe(5);
    expect(k(n.lateSame)).toBe(-208);
  });

  it('quotes the spread’s margin and Year 7 drawdown, and the Metro desk’s edge before fees', () => {
    expect(Math.max(...n.spread.margin)).toBe(270000);
    expect(n.spreadWorstYear).toBe(6);
    expect(n.spread.maxDrawdown).toBeCloseTo(-pnlByYear(n.spread)[6], 3);
    expect(n.metroEdge).toBeCloseTo(0.106, 3);
  });

  it('walks the Metro desk’s skip threshold forward: sell all to Year 3, 4 °F after, −$72,000 against $638,000', () => {
    expect(labSkipBest(0)).toBeNull();
    expect(n.skipWalked).toEqual([null, null, null, 4, 4, 4, 4, 4]);
    expect(n.skipHindsight).toBe(4);
    expect(k(n.skipWalk.walk.total)).toBe(-72);
    expect(k(n.skipWalk.hindsight.total)).toBe(638);
    expect(n.skipColdest[2]).toBeCloseTo(4.8, 1);
    expect(n.skipColdest.slice(3).every((c) => c <= 4)).toBe(true);
    expect(labWalk('skip').used).toHaveLength(8);
    expect(k(n.metro.total)).toBe(312);
  });

  it('keeps Ridgeback’s takeaway as Lesson 6.3 quotes it', () => {
    expect(ridgebackTakeaway(worldConditions(HISTORY_WORLD, 0))).toBeCloseTo(3.05, 9);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: figures and predict-then-check challenges.

describe('gas 6.1 pass 2: the cold spell, half the weather, the red dots', () => {
  it('asks whether even full skill gets within 50 cents of the cold spell: yes, just, seeing only 39% of the cold', () => {
    const none = forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, 0));
    expect(none.actTemp).toBeCloseTo(10.1, 1);
    expect(none.normalTemp).toBeCloseTo(28.6, 1);
    expect(coldSpellMiss(0)).toBeCloseTo(0.75, 2);
    // The answer is yes, by 8 cents: not a knife-edge at the displayed cent.
    expect(coldSpellMiss(1)).toBeCloseTo(0.42, 2);
    expect(0.5 - coldSpellMiss(1)).toBeGreaterThan(0.05);
    expect(coldSpellAnswer()).toBeCloseTo(0.9, 9);
    expect(coldSpellMiss(0.8)).toBeCloseTo(0.57, 2);
    expect(Math.round(coldSpellSeen(1) * 100)).toBe(39);
    // The check: Year 3, January 1, full skill. The default and near misses are unsolved.
    expect(forecasterSolved(FORECASTER_DEFAULTS)).toBe(false);
    expect(forecasterSolved({ ...COLD_SPELL, skill: 1 })).toBe(true);
    expect(forecasterSolved({ ...COLD_SPELL, skill: 0.95 })).toBe(false);
    expect(forecasterSolved({ ...COLD_SPELL, skill: 0.9 })).toBe(false);
    expect(forecasterSolved({ ...COLD_SPELL, day: COLD_SPELL.day + 1, skill: 1 })).toBe(false);
    expect(forecasterSolved({ ...COLD_SPELL, year: 1, skill: 1 })).toBe(false);
  });

  it('shows storage taking about half a degree day: 0.027 Bcf, 50% and $0.09 per 100 in Year 1, 30–61% across the years', () => {
    expect(HALF_DEFAULTS).toEqual({ year: 0 });
    const y1 = halfWeather(0);
    expect(y1.hdd).toHaveLength(16);
    expect(y1.storagePerHdd).toBeCloseTo(0.027, 3);
    expect(Math.round((y1.storagePerHdd / 0.0535) * 100)).toBe(50);
    expect(y1.pricePerHdd * 100).toBeCloseTo(0.09, 2);
    const shares = Array.from({ length: 8 }, (_, y) => Math.round((halfWeather(y).storagePerHdd / 0.0535) * 100));
    expect(Math.min(...shares)).toBe(30);
    expect(Math.max(...shares)).toBe(61);
    // Every dot and ring fits the charts' fixed axes: 4,100–5,300 degree days, 20–65 Bcf, $2–$6.50.
    for (let y = 0; y < 8; y++) {
      const h = halfWeather(y);
      for (const x of [...h.hdd, h.actual.hdd]) expect(x > 4100 && x < 5300).toBe(true);
      for (const v of [...h.storage, h.actual.storage]) expect(v > 20 && v < 65).toBe(true);
      for (const v of [...h.price, h.actual.price]) expect(v > 2 && v < 6.5).toBe(true);
    }
  });

  it('lets the reader predict the no-loss threshold from the red dots at full skill and 0 °F', () => {
    const r = weatherDeskRun(1, 0);
    const red = r.book.trades.filter((o) => o.pnl <= 0).map((o) => Math.abs(r.signals.find((x) => x.month === o.trade.entry)!.forecastColder));
    const far = Math.max(...red);
    expect(far).toBeCloseTo(3.6, 1);
    // The least slider step beyond the farthest red dot is the answer, and it is not at either end of the slider.
    expect(Math.ceil(far / WEATHER_THRESHOLD.step + 1e-9) * WEATHER_THRESHOLD.step).toBe(noLossThreshold(1));
    expect(noLossThreshold(1)).toBeLessThan(WEATHER_THRESHOLD.max);
    expect(weatherDeskSolved({ skill: 1, threshold: 0 })).toBe(false);
  });
});

describe('gas 6.2 pass 2: one spread at ten lots, and the profitable thresholds', () => {
  it('drops the side and lots controls: the figure buys ten lots', () => {
    expect(SPREAD_TRADER_DEFAULTS).toEqual({ spread: 'marApr', year: 2 });
    expect(Math.round(traderBook('marApr', 2, 'buy', 10).total)).toBe(171934);
  });

  it('asks for the highest threshold that makes money, predicted from the bars: 12 Bcf, of only 11 and 12', () => {
    expect(profitableThresholds()).toEqual([11, 12]);
    // At 0 Bcf the storage rule buys every November too.
    expect(ruleBookFor('behind', 0).total).toBeCloseTo(ruleBookFor('always', 0).total, 6);
    expect(SPREAD_RULE_DEFAULTS).toEqual({ rule: 'always', threshold: 0 });
    expect(spreadTraderSolved(SPREAD_RULE_DEFAULTS)).toBe(false);
    expect(spreadTraderSolved({ rule: 'behind', threshold: 0 })).toBe(false);
    expect(spreadTraderSolved({ rule: 'behind', threshold: 12 })).toBe(true);
    for (const t of [11, 13, 16]) expect(spreadTraderSolved({ rule: 'behind', threshold: t })).toBe(false);
    expect(spreadTraderSolved({ rule: 'always', threshold: 12 })).toBe(false);
    // The success text: the window lets in Year 3 (12.9 Bcf short, widest) and shuts out Year 4 (10.9 Bcf, costliest).
    const ma = traderWinters('marApr');
    const widest = ma.reduce((a, b) => (b.change > a.change ? b : a));
    const costliest = ma.reduce((a, b) => (traderBook('marApr', b.year, 'buy', 10).total < traderBook('marApr', a.year, 'buy', 10).total ? b : a));
    expect([widest.year, costliest.year]).toEqual([2, 3]);
    expect(Math.round(-widest.gapEntry * 10) / 10).toBe(12.9);
    expect(Math.round(-costliest.gapEntry * 10) / 10).toBe(10.9);
  });
});

describe('gas 6.3 pass 2: a fixed threshold and a predicted growth', () => {
  it('predicts the least growth from Year 4’s 2.96 against 3.05 of takeaway: 0.10 on the slider', () => {
    const n = basisDeskNumbers();
    const need = n.takeaway - n.prod(3);
    expect(need).toBeCloseTo(0.09, 9);
    expect(leastGlutGrowth()).toBeCloseTo(Math.ceil(need / GROWTH_STEP - 1e-9) * GROWTH_STEP, 9);
    expect(basisDeskSolved(BASIS_DESK_DEFAULTS)).toBe(false);
    expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: 0.1 })).toBe(true);
    for (const g of [0.08, 0.12]) expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: g })).toBe(false);
  });

  it('drops the threshold slider, which changed nothing from $0.05 to $0.25', () => {
    expect(BASIS_DESK_DEFAULTS.threshold).toBe(0.25);
    for (const h of [
      { growth: 0.1, expansion: false },
      { growth: 0.1, expansion: true },
      { growth: 0.3, expansion: true },
    ]) {
      const at = (threshold: number) => basisDeskRun({ ...BASIS_DESK_DEFAULTS, ...h, threshold }).book;
      expect(at(0.05).trades.length).toBe(at(0.25).trades.length);
      expect(at(0.05).total).toBeCloseTo(at(0.25).total, 6);
    }
  });
});

describe('gas 6.4 pass 2: the warmest winter, and a fee floor with room', () => {
  it('finds Year 4, not the warmest Year 2, as the unhedged lease’s worst share: February’s price, not the winter', () => {
    const n = arbitrageNumbers();
    expect(n.worst).toBe(3);
    expect(n.warmest).toBe(1);
    expect(n.warmestRatio).toBeCloseTo(0.6, 2);
    expect(n.worstRatio).toBeCloseTo(0.3, 2);
    expect(n.worstSellMonth).toBe(10);
    expect(n.warmestSellMonth).toBe(10);
    expect(n.worstFebGap).toBeCloseTo(10.6, 1);
    expect(n.warmestFebGap).toBeCloseTo(7.9, 1);
    expect(n.worstSellQuote).toBeCloseTo(3.35, 2);
    expect(n.worstSellAvg).toBeCloseTo(2.37, 2);
    expect(n.warmestSellQuote).toBeCloseTo(4.01, 2);
    expect(n.warmestSellAvg).toBeCloseTo(3.72, 2);
    expect(leaseYearSolved(ARB_LEASE_DEFAULTS)).toBe(false);
    expect(leaseYearSolved({ year: 4 })).toBe(true);
    expect(leaseYearSolved({ year: 2 })).toBe(false);
  });

  it('puts the lease fee on odd tenths so the floor, $1.9 million, clears by about $100,000 either side', () => {
    const { min = 0, step } = FEE_SCALE.lease;
    const onGrid = (v: number) => Math.abs((v - min) / step - Math.round((v - min) / step)) < 1e-9;
    expect(onGrid(ARBITRAGE_DEFAULTS.lease)).toBe(true);
    expect(onGrid(FEE_SCALE.lease.max)).toBe(true);
    const n = arbitrageNumbers();
    expect(leaseFloorFee()).toBeCloseTo(1.9, 9);
    expect(n.hedgedMin).toBeCloseTo(2_001_504, -1);
    expect(n.floorMargin).toBeGreaterThan(90_000);
    expect(n.floorNextLoss).toBeGreaterThan(90_000);
    const at = { ...ARBITRAGE_DEFAULTS, lease: 1.9 };
    expect(arbitrageSolved(ARBITRAGE_DEFAULTS)).toBe(false);
    expect(arbitrageSolved(at)).toBe(true);
    expect(arbitrageSolved({ ...at, lease: 2.1 })).toBe(false);
    expect(arbitrageSolved({ ...at, lease: 1.7 })).toBe(false);
    // Unchanged by the new grid: the starting fee's worst years.
    expect(Math.round(n.hedgedWorstAtDefault / 1000)).toBe(-498);
    expect(n.unhedgedWorstAtDefault / 1e6).toBeCloseTo(-2.03, 2);
  });
});
