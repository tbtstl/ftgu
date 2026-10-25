// Oil chapter 5: assertions added by the pedagogy fix pass (numbers quoted in prose, challenge checks).

import { describe, expect, it } from 'vitest';
import { WORLD, convenienceYield, fullCarry, futuresCurve, inventoryPrice } from '../src/engines/oil/market';
import { NETWORK_DEFAULTS, hubPricesFast } from '../src/engines/oil/network';
import { oilHistory } from '../src/model/oil/history';
import historySource from '../src/model/oil/history.ts?raw';
import { PRODUCT_DEFAULTS } from '../src/engines/oil/market';
import { HISTORY_DEFAULTS } from '../src/model/oil/history';
import {
  BALANCE_DEFAULTS,
  DEPTH_DEFAULT,
  SUMMER_DAYS,
  flatBoost,
  flatGroup,
  flatProductsSolved,
  flatStocksSolved,
  rowsOf,
  stockPath,
  unrunByMaintenance,
  yearOfStocks,
} from '../src/lessons/oil/ch5/L5_1';
import {
  CHALLENGE_GROWTH,
  COAST_DISCOUNT,
  EXPLORER_DEFAULTS,
  breakdown,
  cheapestNorthfieldSolved,
  historyFor,
  historyForMode,
  peakBasinAfterOpening,
  smallestExpansion,
  smallestExpansionSolved,
  spreadStats,
  widestAfterOpening,
} from '../src/lessons/oil/ch5/L5_2';
import { DISTILLATE_FLOOR, MARKET_DEFAULTS, distillateFloorSolved, marketFor, moreDieselSolved, outputAt, pctYield } from '../src/lessons/oil/ch5/L5_3';
import { PRODUCT_PRICE } from '../src/model/oil/refinery';
import {
  CHALLENGE_FEE,
  CURVE_STATE_DEFAULTS,
  FILL_PER_WORLD_STOCKS,
  KESSLER_NORMAL_FILL,
  KESSLER_SPOT,
  NETWORK_PRICES,
  RUSH_DAY_RATE,
  TANK_DEFAULTS,
  curveOf,
  fillFromWorld,
  flatFill,
  frontSpread,
  impliedDayRate,
  perBarrelMonth,
  tankTops,
  tankTopsSolved,
  turnSolved,
} from '../src/lessons/oil/ch5/L5_4';
import {
  CRACK_TARGET,
  OUTAGE_DEFAULTS,
  PRICE_CAP,
  SHOCK_START,
  SHOCK_STATE_DEFAULTS,
  crackRise,
  gasolineSolved,
  gasolineToLose,
  nonGroupResponseMonth,
  peakPrice,
  predictedRunsLost,
  releaseSolved,
  runShock,
} from '../src/lessons/oil/ch5/L5_5';

const r2 = (x: number) => Math.round(x * 100) / 100;

describe('oil 5.1', () => {
  it('quotes non-group growth per year, slower than demand growth', () => {
    const rows = rowsOf(BALANCE_DEFAULTS);
    const perYear = (rows[4].nonGroup - rows[0].nonGroup);
    expect(perYear).toBeCloseTo(BALANCE_DEFAULTS.nonGroupGrowth * 4, 9);
    expect(r2(perYear)).toBe(0.6);
    expect(perYear).toBeLessThan(BALANCE_DEFAULTS.demandGrowth);
  });
  it('never lets stocks run below empty, and leaves sensible settings alone', () => {
    const extreme = rowsOf({ group: 29, demandGrowth: 2, nonGroupGrowth: 0 });
    expect(Math.min(...extreme.map((r) => r.stocks))).toBeLessThan(0);
    const path = stockPath(extreme);
    expect(Math.min(...path)).toBe(0);
    expect(path.findIndex((x) => x <= 0)).toBe(7);
    const rows = rowsOf(BALANCE_DEFAULTS);
    expect(stockPath(rows)).toEqual(rows.map((r) => r.stocks));
  });
  it('challenge a: 31.60 + 0.15 = 31.75 mb/d at the starting growth rates', () => {
    const rows = rowsOf(BALANCE_DEFAULTS);
    const y1 = rows.slice(0, 4).reduce((a, r) => a + r.balance, 0) / 4;
    expect(r2(y1)).toBe(-0.15);
    expect(r2(WORLD.group - y1)).toBe(31.75);
    expect(flatGroup(BALANCE_DEFAULTS.demandGrowth, BALANCE_DEFAULTS.nonGroupGrowth)).toEqual([31.75]);
    expect(flatStocksSolved(BALANCE_DEFAULTS)).toBe(false);
    expect(flatStocksSolved({ ...BALANCE_DEFAULTS, group: 31.75 })).toBe(true);
    expect(flatStocksSolved({ ...BALANCE_DEFAULTS, group: 31.7 })).toBe(false);
    expect(flatStocksSolved({ ...BALANCE_DEFAULTS, group: 31.8 })).toBe(false);
    // No shortcut: with both growth rates at zero the starting 31.6 would be flat, but the challenge is set at the starting growth.
    expect(flatGroup(0, 0)).toEqual([31.6]);
    expect(flatStocksSolved({ group: 31.6, demandGrowth: 0, nonGroupGrowth: 0 })).toBe(false);
    // The success message: even then the second year draws 0.40 mb/d.
    const solved = rowsOf({ ...BALANCE_DEFAULTS, group: 31.75 });
    expect(r2(solved.slice(4, 8).reduce((a, r) => a + r.balance, 0) / 4)).toBe(-0.4);
  });
  it('challenge b: 195 million barrels over 91 summer days is 2.13 mb/d, so 2.1', () => {
    expect(DEPTH_DEFAULT).toBe(2);
    expect(Math.round(unrunByMaintenance(DEPTH_DEFAULT))).toBe(195);
    expect(unrunByMaintenance(DEPTH_DEFAULT)).toBeCloseTo(yearOfStocks(DEPTH_DEFAULT, 0)[11].crudeStock, 9);
    expect(Math.round(SUMMER_DAYS)).toBe(91);
    expect(r2(unrunByMaintenance(DEPTH_DEFAULT) / SUMMER_DAYS)).toBe(2.13);
    expect(flatBoost(DEPTH_DEFAULT)).toEqual([2.1]);
    expect(flatProductsSolved(DEPTH_DEFAULT, 0)).toBe(false);
    expect(flatProductsSolved(DEPTH_DEFAULT, 2.1)).toBe(true);
    expect(flatProductsSolved(DEPTH_DEFAULT, 2.0)).toBe(false);
    expect(flatProductsSolved(DEPTH_DEFAULT, 2.2)).toBe(false);
    // No shortcut: without maintenance the starting 0 would be flat.
    expect(flatProductsSolved(0, 0)).toBe(false);
    const y = yearOfStocks(DEPTH_DEFAULT, 2.1)[11];
    expect(r2(y.productStock)).toBe(-3.13);
    expect(Math.round(y.crudeStock)).toBe(3);
  });
});

describe('oil 5.2', () => {
  it('splits the first-year spread into tariff and coastal discount', () => {
    expect(r2(COAST_DISCOUNT)).toBe(0.8);
    expect(r2(NETWORK_DEFAULTS.pipelineTariff + COAST_DISCOUNT)).toBe(2.8);
    const h = oilHistory();
    // Weeks with room on the line: WTI is Brent less the tariff and the coast's discount, plus weekly noise.
    const first = spreadStats(h.slice(0, 52));
    expect(r2(first.average)).toBe(2.82);
    expect(Math.abs(first.average - 2.8)).toBeLessThan(0.1);
  });
  it('states the basin, line and rail numbers the prediction needs', () => {
    expect(HISTORY_DEFAULTS.basinStart).toBe(380);
    expect(HISTORY_DEFAULTS.basinGrowth).toBe(70);
    expect(HISTORY_DEFAULTS.pipeline).toBe(480);
    expect(HISTORY_DEFAULTS.rail).toBe(150);
    // Coldwater's crude into Kessler matches the inland refineries' take, so the basin's output must leave for the coast.
    expect(NETWORK_DEFAULTS.coldwaterSupply).toBe(NETWORK_DEFAULTS.inlandDemand);
    expect(NETWORK_DEFAULTS.coldwaterLine).toBeGreaterThanOrEqual(NETWORK_DEFAULTS.coldwaterSupply);
  });
  it('challenge a: at 100 kb/d a year the basin needs 425 kb/d more line', () => {
    expect(CHALLENGE_GROWTH).toBe(100);
    expect(smallestExpansionSolved(EXPLORER_DEFAULTS)).toBe(false);
    const ready = { ...EXPLORER_DEFAULTS, growth: CHALLENGE_GROWTH };
    expect(smallestExpansionSolved({ ...ready, add: 425 })).toBe(true);
    expect(smallestExpansionSolved({ ...ready, add: 400 })).toBe(false);
    expect(smallestExpansionSolved({ ...ready, add: 450 })).toBe(false);
    expect(smallestExpansionSolved({ ...ready, add: 425, year: '2' })).toBe(false);
    // The old answer at the default growth no longer counts.
    expect(smallestExpansionSolved({ ...EXPLORER_DEFAULTS, add: 275 })).toBe(false);
    // The same at any rail capacity.
    for (const rail of [0, 75, 150, 225, 300]) {
      expect(smallestExpansion(rail, CHALLENGE_GROWTH)).toBe(425);
      expect(smallestExpansionSolved({ ...ready, rail, add: 425 })).toBe(true);
    }
    // The estimate: 380 + 5 × 100 = 880 kb/d by the end, 400 more than the line; weekly swings take it to about 891.
    expect(HISTORY_DEFAULTS.basinStart + CHALLENGE_GROWTH * HISTORY_DEFAULTS.years).toBe(880);
    expect(Math.round(peakBasinAfterOpening(CHALLENGE_GROWTH))).toBe(891);
    expect(widestAfterOpening(400, 150, CHALLENGE_GROWTH)).toBeGreaterThan(10);
    expect(r2(widestAfterOpening(425, 150, CHALLENGE_GROWTH))).toBe(4.43);
  });
  it('rail is the safety valve: twice the rail and no expansion, no collapse', () => {
    const never = spreadStats(historyFor({ ...EXPLORER_DEFAULTS, year: 'never' }));
    const bigRail = spreadStats(historyFor({ ...EXPLORER_DEFAULTS, year: 'never', rail: 300 }));
    expect(r2(never.widest)).toBe(30.48);
    expect(r2(bigRail.widest)).toBe(12.43);
  });
  it('challenge b: the line-full stretch, not cheap fuel oil, makes Northfield cheapest', () => {
    expect(cheapestNorthfieldSolved('built', 26)).toBe(false);
    expect(cheapestNorthfieldSolved('built', 140)).toBe(true);
    expect(cheapestNorthfieldSolved('never', 140)).toBe(false);
    const h = historyForMode('built');
    const parts = h.map(breakdown);
    const at = parts[140];
    expect(r2(at.nfLocation)).toBe(-11.14);
    expect(r2(at.nfQuality)).toBe(-5.38);
    const q = parts.map((p) => p.nfQuality);
    const qw = q.indexOf(Math.min(...q));
    expect(qw + 1).toBe(249);
    expect(r2(-parts[qw].nfQuality)).toBe(5.68);
    expect(r2(-(parts[qw].northfield - parts[qw].brent))).toBe(9.02);
    expect(h[qw].pipelineUse).toBeLessThan(1);
    expect(cheapestNorthfieldSolved('built', qw)).toBe(false);
  });
  it('treats an expansion that opens after the history ends like none', () => {
    const late = oilHistory({ expansion: { year: 5, add: 300 } });
    const none = historyFor({ ...EXPLORER_DEFAULTS, year: 'never' });
    expect(late.map((w) => w.wti)).toEqual(none.map((w) => w.wti));
  });
});

describe('oil 5.3', () => {
  it('challenge a: 725 million takes three quarter points, 42.75% distillate', () => {
    expect(DISTILLATE_FLOOR).toBe(725);
    const low = (d: number) => Math.min(...marketFor({ ...MARKET_DEFAULTS, distillate: d }).map((m) => m.distillateStock));
    // The prose: one quarter point lifts the low point from 681 to 700 million, about 19.
    expect(Math.round(low(0.42))).toBe(681);
    expect(Math.round(low(0.4225))).toBe(700);
    expect(Math.round(low(0.4225) - low(0.42))).toBe(19);
    // The estimate: (725 − 681) / 19 ≈ 2.3 quarter points, so three.
    const steps = (DISTILLATE_FLOOR - low(0.42)) / (low(0.4225) - low(0.42));
    expect(steps).toBeGreaterThan(2.2);
    expect(steps).toBeLessThan(2.5);
    expect(distillateFloorSolved(MARKET_DEFAULTS)).toBe(false);
    expect(distillateFloorSolved({ ...MARKET_DEFAULTS, distillate: 0.4275 })).toBe(true);
    expect(distillateFloorSolved({ ...MARKET_DEFAULTS, distillate: 0.425 })).toBe(false);
    expect(distillateFloorSolved({ ...MARKET_DEFAULTS, distillate: 0.43 })).toBe(false);
    expect(distillateFloorSolved({ ...MARKET_DEFAULTS, distillate: 0.4225 })).toBe(false);
    expect(distillateFloorSolved({ ...MARKET_DEFAULTS, distillate: 0.4275, outage: 'august' })).toBe(false);
    expect(Math.round(low(0.425))).toBe(715);
    expect(Math.round(low(0.4275))).toBe(728);
    // The success message: each step lifts the low less, because it moves from March to February.
    const at = marketFor({ ...MARKET_DEFAULTS, distillate: 0.4275 }).map((m) => m.distillateStock);
    expect(at.indexOf(Math.min(...at))).toBe(1);
    const ref = marketFor(MARKET_DEFAULTS).map((m) => m.distillateStock);
    expect(ref.indexOf(Math.min(...ref))).toBe(2);
    expect(low(0.425) - low(0.4225)).toBeLessThan(low(0.4225) - low(0.42));
    expect(low(0.4275) - low(0.425)).toBeLessThan(low(0.425) - low(0.4225));
  });
  it('challenge b: diesel overtakes gasoline at $88, below gasoline’s $96', () => {
    expect(PRODUCT_PRICE.gasoline).toBe(96);
    expect(moreDieselSolved(PRODUCT_PRICE.diesel)).toBe(false);
    expect(moreDieselSolved(88)).toBe(true);
    expect(moreDieselSolved(87)).toBe(false);
    expect(moreDieselSolved(89)).toBe(false);
    expect(r2(outputAt(87).dieselOut)).toBe(40.5);
    expect(r2(outputAt(88).dieselOut)).toBe(46.72);
    expect(outputAt(87).gasoline).toBeGreaterThan(outputAt(87).dieselOut);
  });
  it('formats yields without trailing zeros', () => {
    expect(pctYield(0.44)).toBe('44%');
    expect(pctYield(0.42)).toBe('42%');
    expect(pctYield(0.425)).toBe('42.5%');
    expect(pctYield(0.4225)).toBe('42.25%');
  });
});

describe('oil 5.4', () => {
  it('pins spot to the network, whatever the fill', () => {
    expect(r2(KESSLER_SPOT)).toBe(76.2);
    expect(r2(NETWORK_PRICES.corran)).toBe(78.2);
    expect(KESSLER_SPOT).toBeCloseTo(NETWORK_PRICES.corran - NETWORK_DEFAULTS.pipelineTariff, 9);
    for (const fill of [5, 20, 55, 100]) expect(curveOf({ ...CURVE_STATE_DEFAULTS, fill })[0]).toBe(KESSLER_SPOT);
  });
  it('quotes the curve at 55%, 90%, 20% and 30% full', () => {
    const at = (fill: number) => {
      const c = curveOf({ ...CURVE_STATE_DEFAULTS, fill });
      return { m21: c[1] - c[0], m121: c[11] - c[0], yearOut: c[11] };
    };
    expect(r2(at(55).m21)).toBe(0.56);
    expect(r2(at(55).yearOut)).toBe(82.51);
    expect(r2(at(90).m21)).toBe(0.75);
    expect(r2(0.4 + (0.06 / 12) * KESSLER_SPOT)).toBe(0.78);
    expect(r2(at(20).m21)).toBe(-1.03);
    expect(r2(at(20).m121)).toBe(-4.32);
    expect(r2(convenienceYield(0.2))).toBe(1.81);
    expect(r2(convenienceYield(0.55))).toBe(0.22);
    // At 30% the front is backwardated and a year out is back in contango: the curve bends.
    expect(r2(at(30).m21)).toBe(-0.21);
    expect(r2(at(30).m121)).toBe(0.71);
  });
  it('names the flat point at the starting fee: 34% full, where convenience yield falls to $0.78', () => {
    expect(flatFill(CURVE_STATE_DEFAULTS.fee)).toBe(34);
    expect(r2(convenienceYield(0.34))).toBe(0.78);
    expect(Math.abs(frontSpread({ ...CURVE_STATE_DEFAULTS, fill: 34 }))).toBeLessThan(0.003);
  });
  it('challenge a: with the fee at $0.70 the flat point moves emptier, to 29%', () => {
    expect(CHALLENGE_FEE).toBe(0.7);
    expect(turnSolved(CURVE_STATE_DEFAULTS)).toBe(false);
    const dear = { ...CURVE_STATE_DEFAULTS, fee: CHALLENGE_FEE };
    expect(flatFill(CHALLENGE_FEE)).toBe(29);
    expect(turnSolved({ ...dear, fill: 29 })).toBe(true);
    expect(turnSolved({ ...dear, fill: 28 })).toBe(false);
    expect(turnSolved({ ...dear, fill: 30 })).toBe(false);
    // The old answer at the starting fee no longer counts, nor does the right fill at another rate.
    expect(turnSolved({ ...CURVE_STATE_DEFAULTS, fill: 34 })).toBe(false);
    expect(turnSolved({ ...dear, fill: 29, rate: 5 })).toBe(false);
    // Not a knife-edge against the cent grid: +$0.03 at 29%, −$0.04 at 28%.
    expect(frontSpread({ ...dear, fill: 29 })).toBeGreaterThan(0.02);
    expect(frontSpread({ ...dear, fill: 28 })).toBeLessThan(-0.03);
    // The success message: carry $1.08, convenience yield $1.05 at 29%.
    expect(r2(fullCarry(KESSLER_SPOT, CHALLENGE_FEE, 0.06))).toBe(1.08);
    expect(r2(convenienceYield(0.29))).toBe(1.05);
    // The prediction the prose supports: at 30% the starting-fee front is −$0.21, so convenience yield there is $0.99, short of $1.08.
    expect(r2(convenienceYield(0.3))).toBe(0.99);
  });
  it('converts tanker hire into a cost per barrel-month', () => {
    expect(r2(perBarrelMonth(45000))).toBe(0.68);
    expect(Math.round(impliedDayRate(1.2) / 1000) * 1000).toBe(79000);
    expect(r2(perBarrelMonth(RUSH_DAY_RATE))).toBe(1.52);
  });
  it('challenge b: at $100,000 a day, full tanks put the front spread at the cost at sea', () => {
    expect(tankTopsSolved(TANK_DEFAULTS)).toBe(false);
    expect(tankTopsSolved({ fill: 100, floating: 1.5 })).toBe(true);
    expect(tankTopsSolved({ fill: 100, floating: 1.55 })).toBe(true);
    expect(tankTopsSolved({ fill: 100, floating: 1.45 })).toBe(false);
    expect(tankTopsSolved({ fill: 100, floating: 1.6 })).toBe(false);
    expect(tankTopsSolved({ fill: 100, floating: 1.2 })).toBe(false);
    expect(tankTopsSolved({ fill: 99.5, floating: 1.5 })).toBe(false);
    // The old answer (the first fill past the labeled line) no longer solves.
    expect(tankTopsSolved({ fill: 97.5, floating: 1.2 })).toBe(false);
    expect(r2(tankTops({ fill: 100, floating: 1.5 }).spread)).toBe(1.49);
    expect(r2(tankTops({ fill: 100, floating: 1.55 }).spread)).toBe(1.54);
    expect(r2(tankTops({ fill: 100, floating: 1.2 }).spread)).toBe(1.19);
    expect(r2(tankTops({ fill: 100, floating: 1.2 }).carry)).toBe(0.78);
  });
  it('ties Kessler’s fill to the world’s stocks as the history does', () => {
    // The lesson's constants mirror the history's `worldFill` line; if that line changes, revisit Lesson 5.4.
    expect(historySource).toContain(`const worldFill = ${KESSLER_NORMAL_FILL} + ${FILL_PER_WORLD_STOCKS} * (stocks / WORLD.normalStocks - 1);`);
    const short = WORLD.normalStocks * 0.95;
    expect(short).toBe(2660);
    expect(r2(inventoryPrice(short))).toBe(96.99);
    const brentShort = inventoryPrice(short);
    const kesslerShort = hubPricesFast({ ...NETWORK_DEFAULTS, northportPrice: brentShort }).kessler;
    expect(r2(kesslerShort)).toBe(94.19);
    expect(fillFromWorld(short)).toBeCloseTo(0.2, 9);
    const c = futuresCurve({ fill: fillFromWorld(short), spot: kesslerShort, months: 2 });
    expect(r2(c[1] - c[0])).toBe(-0.94);
    // In the generated history, Kessler's fill does follow the world's stocks.
    const h = oilHistory();
    const xs = h.map((w) => w.worldStocks);
    const ys = h.map((w) => w.kesslerFill);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.5);
  });
});

describe('oil 5.5', () => {
  it('non-group supply answers the outage only after it ends', () => {
    const path = runShock(SHOCK_STATE_DEFAULTS);
    const month = nonGroupResponseMonth(path, SHOCK_STATE_DEFAULTS);
    expect(month).toBe(10);
    expect(month).toBeGreaterThan(SHOCK_START + SHOCK_STATE_DEFAULTS.months);
  });
  it('quotes the release numbers, including a release that stops halfway', () => {
    const bare = peakPrice(runShock(SHOCK_STATE_DEFAULTS));
    const one = peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, release: 1 }));
    expect(r2(bare)).toBe(101.85);
    expect(r2(one)).toBe(89.66);
    expect(r2(bare - one)).toBe(12.19);
    expect(r2(peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, release: 1, releaseMonths: 3 })))).toBe(99.67);
  });
  it('challenge a: the smallest release that keeps the peak under $88 is 1.2 mb/d', () => {
    expect(PRICE_CAP).toBe(88);
    expect(releaseSolved(SHOCK_STATE_DEFAULTS)).toBe(false);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1.2 })).toBe(true);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1.1 })).toBe(false);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1.3 })).toBe(false);
    // The prose's 1 mb/d is not the answer, and a shorter release doesn't count.
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1 })).toBe(false);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1.2, releaseMonths: 5 })).toBe(false);
    // Not a knife-edge: $87.41 at 1.2, $88.53 at 1.1.
    expect(r2(peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, release: 1.2 })))).toBe(87.41);
    expect(r2(peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, release: 1.1 })))).toBe(88.53);
    // The estimate: (101.85 − 88) / 12.19 ≈ 1.14 mb/d, so the next step up.
    const est = (101.85 - PRICE_CAP) / 12.19;
    expect(est).toBeGreaterThan(1.1);
    expect(est).toBeLessThan(1.2);
  });
  it('challenge b: a $6 gasoline rise from a two-month outage takes 3.4 mb/d', () => {
    expect(CRACK_TARGET).toBe(6);
    expect(gasolineSolved(OUTAGE_DEFAULTS)).toBe(false);
    expect(gasolineSolved({ ...OUTAGE_DEFAULTS, size: 3.4 })).toBe(true);
    expect(gasolineSolved({ ...OUTAGE_DEFAULTS, size: 3.3 })).toBe(false);
    expect(gasolineSolved({ ...OUTAGE_DEFAULTS, size: 3.5 })).toBe(false);
    expect(gasolineSolved({ ...OUTAGE_DEFAULTS, months: 3, size: 3.4 })).toBe(false);
    expect(r2(crackRise({ ...OUTAGE_DEFAULTS, size: 3.4 }).gasoline)).toBe(6.06);
    expect(r2(crackRise({ ...OUTAGE_DEFAULTS, size: 3.3 }).gasoline)).toBe(5.89);
    // The estimate in the success message: 10% of 900 = 90 M bbl of gasoline, 205 M bbl of runs, 3.36 mb/d over 61 days.
    expect(PRODUCT_DEFAULTS.crackSensitivity).toBe(0.6);
    expect(gasolineToLose(CRACK_TARGET)).toBeCloseTo(90, 9);
    expect(Math.round(gasolineToLose(CRACK_TARGET) / 0.44)).toBe(205);
    expect(Math.round(OUTAGE_DEFAULTS.months * 30.4)).toBe(61);
    expect(r2(predictedRunsLost(CRACK_TARGET, OUTAGE_DEFAULTS.months))).toBe(3.36);
    // The default outage, quoted in the prose.
    expect(r2(crackRise(OUTAGE_DEFAULTS).gasoline)).toBe(3.57);
  });
});
