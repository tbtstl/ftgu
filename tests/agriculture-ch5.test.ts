// Chapter 5 of the agriculture course: the numbers and challenge checks added or changed by the
// fix passes. The chapter's original assertions live in tests/agriculture.test.ts.

import { describe, expect, it } from 'vitest';
import { usd } from '../src/framework';
import { wheatPrice } from '../src/engines/agriculture/capstone';
import { HANDLING } from '../src/engines/agriculture/elevator';
import { allSeasons, hedgeGain, revenue, summarize, walkForward } from '../src/engines/agriculture/hedging';
import { EXPIRY, FINAL_REPORT, MARKET_YEARS, REPORTS, SEASON_START, cropYear, decFutures, futures, harvestCurve, marketView } from '../src/engines/agriculture/market';
import { BASE_PRICE } from '../src/engines/agriculture/world';
import { REFERENCE_YEAR } from '../src/model/agriculture/climate';
import { PLAN_PRICE } from '../src/model/agriculture/economics';
import { dayOf } from '../src/model/agriculture/region';
import { HEDGED, SIXTY_DOMAIN, deliveryGain, deliverySolved, expiryCash, hedgeYear, marginSolved, worstMarginYear } from '../src/lessons/agriculture/ch5/L5_1';
import { CURVE0, HARVEST_SALE, STORAGE0, carryEdge, curveOf, interestOf, stopsPayingSolved, storageRecord, storedReturn, thinCarrySolved, thinnestCarryYear, worstStorageYear } from '../src/lessons/agriculture/ch5/L5_2';
import { BASIS0, avgCents, charterProfit, charterSolved, cliffSolved, partsOf } from '../src/lessons/agriculture/ch5/L5_3';
import { EXAMPLE_YEAR, DROUGHT_YEAR as DRY_46, SEASON0, VIEW_DOMAIN, backtest, reportJump, seasonPath, shareSolved, trade } from '../src/lessons/agriculture/ch5/L5_4';
import { DROUGHT_YEAR, GLUT_YEAR, LAB0, SHORT_LOOKBACK, WALK0, costliestYear, forgottenSolved, leastVariableSolved, meanPutVolatility, putYear, tradingCosts } from '../src/lessons/agriculture/ch5/L5_5';

const cents = (x: number) => Math.round(x * 100);
const dollars = (x: number) => Math.round(x * 100) / 100;
const thousands = (x: number) => Math.round(x / 1000) * 1000;

describe('5.1: delivery, wheat and the drought-year hedge', () => {
  it('quotes cash to the cent, so the displayed numbers give the answer', () => {
    expect(expiryCash()).toBe(5.01);
    // $5.01 cash plus 3¢ of delivery: at $5.04 a short exactly breaks even.
    expect(deliveryGain(504, 1)).toBe(0);
    expect(deliveryGain(505, 1)).toBe(0.01);
    expect(deliveryGain(498, -1)).toBe(0);
    expect(deliverySolved(504)).toBe(true);
    expect(deliverySolved(530)).toBe(false); // the figure's starting price
  });
  it('tells the year-46 hedge story as the success message says', () => {
    expect(worstMarginYear()).toBe(46);
    expect(REFERENCE_YEAR).not.toBe(worstMarginYear()); // challenge b starts unsolved
    const h = hedgeYear(46, 'mar');
    expect(dollars(h.hedged)).toBe(5.29);
    expect(thousands(h.crop * h.cash)).toBe(671000);
    expect(thousands(-h.gain * HEDGED)).toBe(610000);
    expect(thousands(h.crop * h.cash + h.gain * HEDGED)).toBe(61000);
  });
  it('prices wheat off corn as the wheat paragraph says', () => {
    expect(PLAN_PRICE.wheat).toBe(6);
    expect(dollars(BASE_PRICE)).toBe(5.6);
    expect(dollars(curveOf(CURVE0).futures.Dec)).toBe(dollars(BASE_PRICE)); // December's normal price
    for (const y of [1, 40, 46]) expect(wheatPrice(y)).toBeCloseTo((PLAN_PRICE.wheat * decFutures(y, dayOf(7, 15))) / BASE_PRICE, 9);
  });
});

describe('5.2: storage', () => {
  it('starts the sixty-year figure away from its challenge’s answer', () => {
    expect(STORAGE0.year).not.toBe(thinnestCarryYear());
    expect(thinCarrySolved(STORAGE0)).toBe(false);
  });
  it('relates harvest pressure to the harvest spread', () => {
    const c = curveOf(CURVE0);
    expect(cents(c.harvestSpread)).toBe(35);
    expect(cents(HANDLING)).toBe(8);
    expect(cents(c.harvestSpread - HANDLING)).toBe(27);
  });
  it('falls with a 650-million harvest as the prose says', () => {
    const c = curveOf(CURVE0);
    const big = harvestCurve({ valley: 650, world: 0, carryIn: 100 });
    expect(cents(c.futures.Dec - big.futures.Dec)).toBe(92);
    expect(dollars(c.harvestCash - big.harvestCash)).toBe(1.7);
  });
  it('names both causes when storage stops paying at 6% short', () => {
    const c = curveOf({ ...CURVE0, world: -6 });
    const spread = c.futures.Jul - c.futures.Dec;
    const full = c.carry * ((EXPIRY.Jul - EXPIRY.Dec) / 30.4);
    expect(cents(spread)).toBe(14);
    expect(Math.round((spread / full) * 100)).toBe(25);
    expect(dollars(c.harvestCash)).toBe(6.42);
    expect(cents(interestOf({ ...CURVE0, world: -6 }))).toBe(34);
    expect(cents(interestOf(CURVE0))).toBe(23);
  });
  it('lets July futures rise after harvest by 5 cents on average, in 31 of 60 years', () => {
    let rose = 0;
    let total = 0;
    for (let y = 1; y <= MARKET_YEARS; y++) {
      const d = futures(y, 'Jul', EXPIRY.Jul) - futures(y, 'Jul', HARVEST_SALE);
      if (d > 0) rose++;
      total += d;
    }
    expect(rose).toBe(31);
    expect(cents(total / MARKET_YEARS)).toBe(5);
  });
});

describe('5.3: basis and the charter', () => {
  it('reads the basis without a double negative', () => {
    expect(usd(-partsOf(BASIS0, 'fairview').total, 2)).toBe('$1.30');
  });
  it('leaves one export-basis year outside the four groups: year 19, at capacity', () => {
    const basis = Array.from({ length: MARKET_YEARS }, (_, i) => charterProfit(i + 1, 0));
    const grouped = (b: number) => (b > 0.82 && b < 0.88) || (b > 0.64 && b < 0.72) || Math.abs(b - 0.45) < 0.005 || Math.abs(b - 1.5) < 0.005;
    const odd = basis.map((b, i) => [i + 1, b]).filter(([, b]) => !grouped(b));
    expect(odd.map(([y]) => y)).toEqual([19]);
    expect(dollars(basis[18])).toBe(1.12);
    expect(Math.round(cropYear(19).valley)).toBe(567);
  });
  it('shows the charter’s knife-edge loss at 88¢ instead of 0.0¢', () => {
    const avg = (c: number) => Array.from({ length: MARKET_YEARS }, (_, i) => charterProfit(i + 1, c / 100)).reduce((a, b) => a + b, 0) / MARKET_YEARS;
    expect(avg(88)).toBeLessThan(0);
    expect(avgCents(avg(88))).toBe('0.02¢');
    expect(avgCents(avg(87))).toBe('1.0¢');
    expect(charterSolved(60)).toBe(false); // the figure's starting rate
    expect(charterSolved(87)).toBe(true);
  });
});

describe('5.4: the bet after the report', () => {
  it('adds 4.6 cents a year from August and costs 5.1 from September', () => {
    const post = (d: 'aug' | 'sep') =>
      Array.from({ length: MARKET_YEARS }, (_, i) => trade(i + 1, d, 'harvest').pnl - trade(i + 1, d, 'report').pnl).reduce((a, b) => a + b, 0) / MARKET_YEARS;
    expect(Math.round(post('aug') * 1000)).toBe(46);
    expect(Math.round(post('sep') * 1000)).toBe(-51);
  });
});

describe('5.5: puts and the least-variable hedge', () => {
  it('shows the challenge’s answer apart from its neighbor', () => {
    const d = allSeasons('dryland');
    const sd = (r: number) => summarize(d.map((s) => revenue(s, 'futures', r))).sd;
    expect(usd(sd(0.3), 2)).toBe('$98.17');
    expect(usd(sd(0.4), 2)).toBe('$98.07');
    expect(leastVariableSolved(LAB0)).toBe(false);
    expect(leastVariableSolved({ ...LAB0, ratio: 40 })).toBe(true);
  });
  it('works the drought-year put as the prose says', () => {
    const p = putYear(DROUGHT_YEAR);
    expect([dollars(p.f0), cents(p.put0), dollars(p.f1)]).toEqual([5.95, 31, 9.44]);
    expect(p.put1).toBeLessThan(0.005);
    expect(cents(-p.gain)).toBe(35);
    expect(Math.round(-p.perAcre)).toBe(61);
    expect([Math.round(p.yield), dollars(p.cash), dollars(p.f1 - p.f0)]).toEqual([76, 8.78, 3.49]);
  });
  it('works the glut-year put as the prose says', () => {
    const d = allSeasons('dryland');
    const best = d.reduce((b, s) => (s.put1 - s.put0 > b.put1 - b.put0 ? s : b));
    expect(best.year).toBe(GLUT_YEAR);
    const p = putYear(GLUT_YEAR);
    expect([dollars(p.f0), dollars(p.f1), dollars(p.cash)]).toEqual([5.72, 4.57, 2.59]);
    expect([cents(p.put0), dollars(p.put1)]).toEqual([29, 1.13]);
    expect([Math.round(p.perAcre), Math.round(p.plain)]).toEqual([140, 549]);
    expect(p.gain).toBeCloseTo(hedgeGain(d[GLUT_YEAR - 1], 'puts'), 12);
  });
  it('prices puts at about 15% volatility', () => {
    expect(Math.round(meanPutVolatility() * 100)).toBe(15);
  });
  it('over-insures with puts for the walk-forward’s first seventeen years', () => {
    const wf = walkForward('puts', 20);
    const early = wf.ratios.filter((_, i) => wf.years[i] <= 27);
    expect(early.length).toBe(17);
    expect(Math.min(...early)).toBe(1.4);
    expect(Math.max(...early)).toBe(1.5);
    expect(wf.ratios[wf.years.indexOf(28)]).toBeLessThan(1.4);
  });
});

// ---------------------------------------------------------------------------------------------
// Second fix pass: predict-then-check challenges, the sixty-year hedge strip, the season the market
// learns through (5.4), and the controls the prose now uses.

describe('5.1 (pass 2): sixty years of hedges and the drought-year challenge', () => {
  it('fits every year of every hedge date in the strip’s fixed range', () => {
    for (const date of ['mar', 'jul', 'sep'] as const)
      for (let y = 1; y <= MARKET_YEARS; y++) {
        const h = hedgeYear(y, date);
        for (const v of [h.cash, h.hedged]) {
          expect(v).toBeGreaterThan(SIXTY_DOMAIN[0]);
          expect(v).toBeLessThan(SIXTY_DOMAIN[1]);
        }
      }
  });
  it('is solved by the drought year of Lesson 4.5 with a March hedge, and nothing near it', () => {
    expect(marginSolved({ year: REFERENCE_YEAR, date: 'mar' })).toBe(false); // the figure's start
    expect(marginSolved({ year: 46, date: 'mar' })).toBe(true);
    expect(marginSolved({ year: 46, date: 'jul' })).toBe(false);
    expect(marginSolved({ year: 45, date: 'mar' })).toBe(false);
    expect(marginSolved({ year: 47, date: 'mar' })).toBe(false);
    expect(cropYear(46).valley).toBe(Math.min(...Array.from({ length: MARKET_YEARS }, (_, i) => cropYear(i + 1).valley)));
    // The starting year’s March hedge never needed margin: the status says so instead of “$0”.
    expect(hedgeYear(REFERENCE_YEAR, 'mar').maxMargin).toBeLessThan(1);
  });
});

describe('5.2 (pass 2): the storage prediction and the sale month', () => {
  it('stops paying before the spread vanishes', () => {
    expect(stopsPayingSolved(CURVE0)).toBe(false);
    const c8 = curveOf({ ...CURVE0, world: -8 });
    expect(Math.abs(c8.futures.Jul - c8.futures.Dec)).toBeLessThan(0.005);
    expect(stopsPayingSolved({ ...CURVE0, world: -6 })).toBe(true); // before 8%
  });
  it('earns about the same hedged to March, May or July, and loses more often unhedged the longer it waits', () => {
    const mar = storageRecord('Mar');
    const may = storageRecord('May');
    const jul = storageRecord('Jul');
    expect([cents(mar.hedgedMean), cents(may.hedgedMean), cents(jul.hedgedMean)]).toEqual([28, 29, 29]);
    expect(Math.abs(jul.hedgedMean - mar.hedgedMean)).toBeLessThan(0.01);
    expect([mar.unhedgedLosses, jul.unhedgedLosses]).toEqual([9, 17]);
  });
});

describe('5.3 (pass 2): predictable cliff and charter', () => {
  it('starts both challenges unsolved, with the cliff just past Lesson 4.4’s 566 million', () => {
    expect(cliffSolved(BASIS0)).toBe(false);
    expect(cliffSolved({ ...BASIS0, valley: 570 })).toBe(true);
  });
  it('lets the prose’s handful of export-basis values estimate the charter answer', () => {
    // 27 years at 87¢, 22 at 65–71¢ (68¢), 2 at 45¢, 8 at $1.50 and year 19 at $1.12.
    const estimate = (27 * 87 + 22 * 68 + 2 * 45 + 8 * 150 + 112) / 60;
    expect(Math.floor(estimate)).toBe(87);
    expect(charterSolved(87)).toBe(true);
  });
});

describe('5.4 (pass 2): how the market learns, the gap control and the share challenge', () => {
  it('tells the season as the prose says', () => {
    const start = marketView(EXAMPLE_YEAR, SEASON_START);
    expect([Math.round(start.mean), Math.round(start.sd)]).toEqual([506, 64]);
    const sep = reportJump(EXAMPLE_YEAR, REPORTS[1].day);
    expect([Math.round(sep.before.view.mean), Math.round(sep.before.view.sd), Math.round(sep.after.view.mean)]).toEqual([493, 42, 460]);
    expect([dollars(sep.before.futures), dollars(sep.after.futures)]).toEqual([5.99, 6.3]);
    // Between September 1 and the report the view of the valley stands still while futures drift.
    const sep1 = marketView(EXAMPLE_YEAR, REPORTS[1].data);
    expect(sep1.mean).toBeCloseTo(sep.before.view.mean, 9);
    expect(sep1.sd).toBeCloseTo(sep.before.view.sd, 9);
    expect(dollars(decFutures(EXAMPLE_YEAR, REPORTS[1].data))).toBe(5.82);
    const dry = reportJump(DRY_46, REPORTS[0].day).after;
    expect(Math.round(dry.view.mean)).toBe(363);
    expect([dollars(decFutures(DRY_46, SEASON_START)), dollars(dry.futures)]).toEqual([5.95, 7.99]);
    expect(marketView(EXAMPLE_YEAR, FINAL_REPORT).sd).toBe(0);
    expect(SEASON0).toEqual({ year: 26, day: SEASON_START });
  });
  it('keeps every year’s band inside the chart', () => {
    for (let y = 1; y <= MARKET_YEARS; y++)
      for (const p of seasonPath(y)) {
        expect(p.view.mean - p.view.sd).toBeGreaterThanOrEqual(VIEW_DOMAIN[0]);
        expect(p.view.mean + p.view.sd).toBeLessThanOrEqual(VIEW_DOMAIN[1]);
      }
  });
  it('makes the analyst choosy as the prose says', () => {
    const every = backtest('sep', 'report', 0, 0);
    const five = backtest('sep', 'report', 0, 0.05);
    const fifteen = backtest('sep', 'report', 0, 0.15);
    expect(every.trades).toBe(60);
    expect([five.trades, Math.round((five.total / five.trades) * 1000), Math.round((five.total * 5000) / 100) * 100]).toEqual([41, 109, 22400]);
    expect([fifteen.trades, cents(fifteen.total / fifteen.trades), Math.round((fifteen.total * 5000) / 100) * 100]).toEqual([13, 20, 13200]);
    // The trades a 5¢ gap skips earned nothing, to within half a cent, before their cent of costs.
    const skipped = every.trades - five.trades;
    expect(Math.abs((every.total - five.total) / skipped + 0.01)).toBeLessThan(0.005);
  });
  it('makes the share challenge predictable from 7.1 and 4.6 cents, and checks it', () => {
    const per = (s: number) => {
      const r = backtest('sep', 'report', s, 0);
      return r.total / r.trades;
    };
    expect([Math.round(per(0) * 1000), Math.round(per(0.25) * 1000)]).toEqual([71, 46]);
    const bite = per(0) - per(0.25);
    expect(per(0) - 2 * bite).toBeGreaterThan(0); // a straight line says it still pays at 50%…
    expect(per(0) - 3 * bite).toBeLessThan(0); // …and loses at 75%
    const st = { decision: 'sep' as const, exit: 'report' as const, threshold: 0 };
    expect(shareSolved({ ...st, share: 0 })).toBe(false); // the figure's start
    expect(shareSolved({ ...st, share: 50 })).toBe(false);
    expect(shareSolved({ ...st, share: 75 })).toBe(true);
    expect(shareSolved({ ...st, share: 100 })).toBe(false);
    expect(backtest('sep', 'report', 1, 0).trades).toBe(0);
    expect(Math.round(per(0.5) * 1000)).toBe(22);
  });
});

describe('5.5 (pass 2): the U of the least-variable hedge, and the costs toggle', () => {
  const d = allSeasons('dryland');
  const variance = (r: number) => summarize(d.map((s) => revenue(s, 'futures', r))).sd ** 2;
  it('traces a symmetric U whose bottom must lie under half', () => {
    // Revenue is linear in the share hedged, so its variance is a parabola: constant second differences.
    const second = (r: number) => variance(r + 0.1) - 2 * variance(r) + variance(r - 0.1);
    expect(second(0.3)).toBeCloseTo(second(1.2), 6);
    expect(variance(1)).toBeGreaterThan(variance(0));
    const a = second(0.5) / 0.02;
    const bottom = 0.5 - (variance(0.6) - variance(0.4)) / 0.2 / (2 * a);
    expect(bottom).toBeLessThan(0.5);
    expect(Math.round(bottom * 10)).toBe(4);
  });
  it('is solved only at 40%, for the dryland farm and futures with costs', () => {
    expect(leastVariableSolved(LAB0)).toBe(false);
    for (const r of [30, 50]) expect(leastVariableSolved({ ...LAB0, ratio: r })).toBe(false);
    expect(leastVariableSolved({ ...LAB0, ratio: 40 })).toBe(true);
    expect(leastVariableSolved({ ...LAB0, ratio: 40, farm: 'irrigated' })).toBe(false);
    expect(leastVariableSolved({ ...LAB0, ratio: 40, kind: 'puts' })).toBe(false);
    expect(leastVariableSolved({ ...LAB0, ratio: 40, costs: false })).toBe(false);
  });
  it('splits the puts’ $11 an acre into trading costs and premium', () => {
    const none = summarize(d.map((s) => revenue(s, 'none', 0))).mean;
    const puts = summarize(d.map((s) => revenue(s, 'puts', 1))).mean;
    const putsFree = summarize(d.map((s) => revenue(s, 'puts', 1, false))).mean;
    expect(dollars(tradingCosts('dryland', 'puts', 1))).toBe(7.44);
    expect(dollars(none - putsFree)).toBe(3.37);
    expect(Math.round(none - puts)).toBe(11);
    expect(tradingCosts('dryland', 'none', 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Year 46 answered 5.1b, 5.2b and 5.5b alike. 5.1b keeps it; 5.2b and 5.5b now ask their own
// lesson's question, each with its own answer.

describe('5.2b: the thinnest carry storing survived', () => {
  const share = (w: number) => {
    const c = curveOf({ ...CURVE0, world: w });
    return (c.futures.Jul - c.futures.Dec) / (c.carry * ((EXPIRY.Jul - EXPIRY.Dec) / 30.4));
  };
  it('lets the first demonstration predict the line: storing stops paying between a quarter and a third of full carry', () => {
    expect(Math.round(share(-5) * 100)).toBe(36);
    expect(Math.round(share(-6) * 100)).toBe(25);
    expect(stopsPayingSolved({ ...CURVE0, world: -6 })).toBe(true); // pays at −5%, not at −6%
    // The success message quotes the same two shares, computed live.
    const edge = carryEdge();
    expect([Math.round(edge.paid * 100), Math.round(edge.lost * 100)]).toEqual([36, 25]);
  });
  it('finds year 35: 28% of full carry, 9.0% stocks-to-use, and just 2¢', () => {
    const y = thinnestCarryYear();
    expect(y).toBe(35);
    const c = cropYear(y);
    expect(Math.round(c.theta * 100)).toBe(28);
    expect(Math.round(c.world.stocksToUse * 1000) / 10).toBe(9);
    expect(cents(storedReturn(y, 'Jul', true))).toBe(2);
    // Between the first demonstration’s 25% and 36%.
    expect(c.theta).toBeGreaterThan(carryEdge().lost);
    expect(c.theta).toBeLessThan(carryEdge().paid);
    // No year that paid shows a thinner carry, to the readout’s whole percent.
    for (let yy = 1; yy <= MARKET_YEARS; yy++)
      if (storedReturn(yy, 'Jul', true) > 0) expect(Math.round(cropYear(yy).theta * 100)).toBeGreaterThanOrEqual(28);
  });
  it('is solved by year 35 alone, hedged until July, and not by the drought year', () => {
    const solvedYears = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1).filter((year) => thinCarrySolved({ ...STORAGE0, year }));
    expect(solvedYears).toEqual([35]);
    expect(solvedYears).not.toContain(46);
    // Year 27’s curve paid as thin a carry, but storing lost: a near miss.
    expect(Math.round(cropYear(27).theta * 100)).toBe(28);
    expect(storedReturn(27, 'Jul', true)).toBeLessThan(0);
    expect(thinCarrySolved({ ...STORAGE0, year: 27 })).toBe(false);
    for (const year of [5, 34, 36]) expect(thinCarrySolved({ ...STORAGE0, year })).toBe(false);
    expect(thinCarrySolved({ ...STORAGE0, year: 35, sell: 'May' })).toBe(false);
    expect(thinCarrySolved({ ...STORAGE0, year: 35, hedged: 'no' })).toBe(false);
    // Neither a slider end nor one step from the starting year.
    expect(Math.abs(35 - STORAGE0.year)).toBeGreaterThan(1);
    expect([1, MARKET_YEARS]).not.toContain(35);
  });
  it('tells the drought year after the challenge: the only inverted curve, 7.8% stocks, 53¢ lost', () => {
    expect(worstStorageYear()).toBe(46);
    const inverted = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1).filter((y) => cropYear(y).theta < 0);
    expect(inverted).toEqual([46]);
    expect(Math.round(cropYear(46).world.stocksToUse * 1000) / 10).toBe(7.8);
    expect(cents(-storedReturn(46, 'Jul', true))).toBe(53);
  });
});

describe('5.5b: the five-year memory', () => {
  const plain = allSeasons('dryland').map((x) => revenue(x, 'none', 0));
  const wf = walkForward('futures', SHORT_LOOKBACK);
  const at = (y: number) => wf.years.indexOf(y);
  it('forgets the drought in year 52 and hedges the whole crop or more until year 56', () => {
    expect(SHORT_LOOKBACK).toBe(5);
    for (let y = DROUGHT_YEAR + 1; y <= DROUGHT_YEAR + SHORT_LOOKBACK; y++) expect(wf.ratios[at(y)]).toBeLessThanOrEqual(0.1);
    for (let y = DROUGHT_YEAR + SHORT_LOOKBACK + 1; y <= 56; y++) expect(wf.ratios[at(y)]).toBeGreaterThanOrEqual(1);
    expect(wf.ratios[at(56)]).toBe(1);
  });
  it('costs $249 an acre in year 56, a dry year with futures up $1.37', () => {
    expect(costliestYear(SHORT_LOOKBACK, DROUGHT_YEAR)).toBe(56);
    const s = allSeasons('dryland')[55];
    expect(Math.round(s.yield)).toBe(135);
    expect(dollars(s.f1 - s.f0)).toBe(1.37);
    expect(Math.round(plain[55] - wf.revenues[at(56)])).toBe(249);
    // The drought itself is still the costliest year overall, at either lookback: hence “after the drought”.
    expect(costliestYear()).toBe(46);
    expect(costliestYear(SHORT_LOOKBACK)).toBe(46);
  });
  it('starts unsolved, is solved at year 56 with futures and a 5-year lookback, and not by its neighbors', () => {
    expect(forgottenSolved(WALK0)).toBe(false);
    const st = { kind: 'futures' as const, lookback: SHORT_LOOKBACK, year: 56 };
    expect(forgottenSolved(st)).toBe(true);
    for (const year of [DROUGHT_YEAR, 55, 57]) expect(forgottenSolved({ ...st, year })).toBe(false);
    for (const lookback of [10, 20]) expect(forgottenSolved({ ...st, lookback })).toBe(false);
    expect(forgottenSolved({ ...st, kind: 'puts' })).toBe(false);
    // Neither a slider end nor one step from the starting year.
    expect(Math.abs(56 - WALK0.year)).toBeGreaterThan(1);
    expect(56).not.toBe(MARKET_YEARS);
  });
});
