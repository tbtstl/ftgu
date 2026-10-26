// Chapter 6 of the oil course: the numbers its prose quotes and its challenges' checks, after the
// first fix pass (seasonal-forward hedges in 6.4, fuel oil's pull in 6.2, definitions in 6.1) and the
// second (predict-then-check challenges, mirrored controls, one style across the chapter).

import { describe, expect, it } from 'vitest';
import {
  CORRAN_DAY,
  CARRY_DEFAULTS,
  CRACK_RATIOS,
  RULE_DEFAULTS,
  backtest,
  corranMargin,
  calendarFit as engineCalendarFit,
  correlation,
  hedgeRefinery,
  qualityRule,
  seasonalForwards,
} from '../src/engines/oil/trading';
import { FUEL_OIL_REVERSION, HISTORY_DEFAULTS, oilHistory } from '../src/model/oil/history';
import {
  CAPACITY_MIN,
  CARRY_STATE_DEFAULTS,
  PREDICT_HUB,
  TRADER_DEFAULTS,
  largestCarryHub,
  predictedHubSolved,
  ruleSettingsRange,
  runCarry,
  runTrader,
  smallestProfitableHub,
  weeklyCatchUp,
} from '../src/lessons/oil/ch6/L6_1';
import { BASIS_DEFAULTS, PULL_DEFAULT, QUALITY_DEFAULTS, halfLife, losingShiftSolved, runBasis, runQuality } from '../src/lessons/oil/ch6/L6_2';
import { CRACK_STATE_DEFAULTS, HALF_SEASONS, calendarFit, halfSeasonsSolved, runCrack, splitFor, stillTradesSolved } from '../src/lessons/oil/ch6/L6_3';
import {
  HEDGE_DEFAULTS,
  QUARTER_DEFAULTS,
  SEASON_MAX,
  STANDARD_TARGET,
  WTI_TARGET,
  bestHedge,
  fastestWtiGrowth,
  hedgeFor,
  hedgeOn,
  historyOf,
  lessonFacts,
  quartersFor,
  standardCrackSolved,
  summarizeQuarters,
  wtiGrowthSolved,
} from '../src/lessons/oil/ch6/L6_4';
import {
  BOOK_DEFAULTS,
  DRIVER_DEFAULTS,
  LAB_DEFAULTS,
  SIZING_TARGET,
  STRATEGIES,
  TUNED_BOOK,
  crackSolved,
  runLab,
  sizingSolved,
  sizingStory,
} from '../src/lessons/oil/ch6/L6_5';
import { money, seasonDisplay, yearTick } from '../src/lessons/oil/ch6/style';
import { usd } from '../src/framework';

const h = oilHistory();
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

describe('oil chapter 6: shared model options keep the defaults exactly', () => {
  it('fuel oil’s pull defaults to 5% a week, identical to the history without it', () => {
    expect(FUEL_OIL_REVERSION).toBe(0.05);
    const explicit = oilHistory({ fuelOilReversion: 0.05 });
    expect(explicit.map((w) => w.hsfo)).toEqual(h.map((w) => w.hsfo));
    expect(explicit.map((w) => w.coldwater)).toEqual(h.map((w) => w.coldwater));
  });
  it('hedgeRefinery is flat unless asked for the seasonal forward', () => {
    const a = hedgeRefinery(h, 0.8, 'brent', CRACK_RATIOS.corran);
    const b = hedgeRefinery(h, 0.8, 'brent', CRACK_RATIOS.corran, CORRAN_DAY, 'flat');
    expect(b.effectiveness).toBe(a.effectiveness);
    expect(a.locked[5]).toBe(a.locked[0]);
    const s = hedgeRefinery(h, 0.8, 'brent', CRACK_RATIOS.corran, CORRAN_DAY, 'seasonal');
    expect(s.locked[5]).not.toBe(s.locked[0]);
  });
  it('a seasonal forward is today’s level plus the calendar’s change', () => {
    const xs = h.map((w) => w.gasolineCrack);
    const cal = engineCalendarFit(xs);
    const f = seasonalForwards(xs);
    expect(f(13, 20)).toBeCloseTo(xs[13] + cal[20] - cal[13], 12);
    expect(f(13, 13)).toBe(xs[13]);
    expect(calendarFit).toBe(engineCalendarFit);
  });
});

describe('oil 6.1', () => {
  it('challenge a: predict, then check a 6-million-barrel hub — it loses, though it pays before costs', () => {
    expect(PREDICT_HUB).toBe(6);
    expect(predictedHubSolved(TRADER_DEFAULTS)).toBe(false);
    expect(predictedHubSolved({ ...TRADER_DEFAULTS, capacity: 6 })).toBe(true);
    expect(predictedHubSolved({ ...TRADER_DEFAULTS, capacity: 5 })).toBe(false);
    expect(predictedHubSolved({ ...TRADER_DEFAULTS, capacity: 7 })).toBe(false);
    expect(predictedHubSolved({ ...TRADER_DEFAULTS, capacity: 6, shocks: 0 })).toBe(false);
    expect(predictedHubSolved({ ...TRADER_DEFAULTS, capacity: 6, lookback: 3 })).toBe(false);
    const r = runTrader({ ...TRADER_DEFAULTS, capacity: 6 });
    expect(money(r.stats.total)).toBe('−$2,900');
    expect(money(r.stats.total + r.costs)).toBe('$35,100');
    expect(money(r.costs)).toBe('$38,000');
    expect(smallestProfitableHub()).toBe(7);
    expect(money(runTrader({ ...TRADER_DEFAULTS, capacity: 7 }).stats.total)).toBe('$11,900');
  });
  it('a hub closes 4/capacity of its gap a week: a fifth at 20, two-thirds at 6, all of it at 4', () => {
    expect(weeklyCatchUp(20)).toBeCloseTo(0.2, 12);
    expect(weeklyCatchUp(6)).toBeCloseTo(2 / 3, 12);
    expect(weeklyCatchUp(CAPACITY_MIN)).toBe(1);
    // The history's own rule, which weeklyCatchUp restates.
    const src = Object.values(import.meta.glob<string>('../src/model/oil/history.ts', { query: '?raw', import: 'default', eager: true }))[0];
    expect(src).toContain('const tau = Math.max(1, p.kesslerCapacity / 4);');
    expect(src).toContain('fill += (target - fill) / tau;');
  });
  it('every setting the rule sliders offer makes money on this history, $3,800 to $29,400', () => {
    const r = ruleSettingsRange();
    expect(r.count).toBe(88);
    expect(r.profitable).toBe(88);
    expect(money(r.min)).toBe('$3,800');
    expect(money(r.max)).toBe('$29,400');
  });
  it('holding longer doesn’t help cash and carry', () => {
    const at = (months: number) => runCarry({ ...CARRY_STATE_DEFAULTS, capacity: CAPACITY_MIN, months }).profit;
    expect(money(at(1))).toBe('$965,000');
    expect(money(at(3))).toBe('$603,600');
    expect(at(2)).toBeLessThan(at(1));
    expect(at(3)).toBeLessThan(at(2));
    expect([1, 2, 3, 4, 5].map((m) => largestCarryHub(m))).toEqual([15, 14, 13, 13, 12]);
  });
  it('an idle million-barrel lease would cost $24 million over five years', () => {
    expect(CARRY_DEFAULTS.lease * CARRY_DEFAULTS.fee * 12 * HISTORY_DEFAULTS.years).toBeCloseTo(24e6, 6);
  });
  it('a smaller hub’s fill moves faster from week to week', () => {
    const step = (cap: number) => {
      const hh = oilHistory({ kesslerCapacity: cap });
      return hh.slice(1).reduce((a, w, i) => a + Math.abs(w.kesslerFill - hh[i].kesslerFill), 0) / (hh.length - 1);
    };
    expect(step(4)).toBeGreaterThan(step(20));
    expect(step(20)).toBeGreaterThan(step(60));
  });
});

describe('oil 6.2', () => {
  it('fuel oil’s pull: half of a gap closes in about 13.5 weeks', () => {
    expect(PULL_DEFAULT).toBe(5);
    expect(halfLife(PULL_DEFAULT)).toBeCloseTo(13.5, 1);
    expect(halfLife(0)).toBe(Infinity);
    expect(runQuality(QUALITY_DEFAULTS).result.stats.total).toBeCloseTo(85323, -2);
  });
  it('with no pull, the quality trade dies', () => {
    const r = runQuality({ ...QUALITY_DEFAULTS, pull: 0 }).result;
    expect(Math.round(r.stats.total / 100) * 100).toBe(8300);
    expect(r.stats.sharpe).toBeCloseTo(0.09, 2);
    expect(Math.round(r.costs / 1000) * 1000).toBe(14000);
    // On average over other histories, the rule with no pull loses money; with the pull it makes money.
    const others = (pull: number) =>
      [1, 2, 3, 4, 5, 6, 7, 8].reduce((a, seed) => {
        const hh = oilHistory({ seed, fuelOilReversion: pull });
        return a + backtest(hh, 'quality', qualityRule(hh, RULE_DEFAULTS.quality), { units: 10 }).stats.total;
      }, 0) / 8;
    expect(others(0)).toBeLessThan(0);
    expect(others(0.05)).toBeGreaterThan(0);
  });
  it('challenge b needs fuel oil’s pull at its starting value', () => {
    expect(losingShiftSolved({ ...QUALITY_DEFAULTS, shift: 16 })).toBe(true);
    expect(losingShiftSolved({ ...QUALITY_DEFAULTS, shift: 16, pull: 4 })).toBe(false);
  });
  it('without the expansion, the basin outgrows the railroad in its fourth year', () => {
    const nv = runBasis({ ...BASIS_DEFAULTS, year: 'never' });
    const first = nv.h.findIndex((w) => w.basinSupply > w.pipelineCapacity + BASIS_DEFAULTS.rail);
    expect(Math.floor(first / 52) + 1).toBe(4);
    expect(nv.result.stats.total / 1e6).toBeCloseTo(0.93, 2);
  });
  it('with no short before the opening, the trader is long into it and makes $231,400', () => {
    const base = runBasis(BASIS_DEFAULTS);
    const r = runBasis({ ...BASIS_DEFAULTS, lead: 0 });
    const opening = base.opening!;
    expect(r.result.positions[opening - 1]).toBeGreaterThan(0);
    expect(money(-r.result.pnl[opening - 1])).toBe('$78,300');
    expect(money(r.result.stats.total)).toBe('$231,400');
    expect(money(base.result.stats.total)).toBe('$393,600');
  });
  it('cutting the rail changes the basis trade; adding it doesn’t', () => {
    const base = runBasis(BASIS_DEFAULTS).result.stats.total;
    expect(runBasis({ ...BASIS_DEFAULTS, rail: 300 }).result.stats.total).toBeCloseTo(base, 6);
    expect(Math.abs(runBasis({ ...BASIS_DEFAULTS, rail: 0 }).result.stats.total - base)).toBeGreaterThan(1000);
  });
});

describe('oil 6.3', () => {
  const inMarket = (st: typeof CRACK_STATE_DEFAULTS) => runCrack(st).positions.filter((p) => p !== 0).length;
  it('challenge b: predict, then halve the seasons — the calendar keeps far less than half', () => {
    const half = { ...CRACK_STATE_DEFAULTS, seasonality: HALF_SEASONS };
    expect(HALF_SEASONS).toBe(0.5);
    expect(halfSeasonsSolved(CRACK_STATE_DEFAULTS)).toBe(false);
    expect(halfSeasonsSolved(half)).toBe(true);
    expect(halfSeasonsSolved({ ...half, seasonality: 0.4 })).toBe(false);
    expect(halfSeasonsSolved({ ...half, seasonality: 0.6 })).toBe(false);
    expect(halfSeasonsSolved({ ...half, outages: 0 })).toBe(false);
    expect(halfSeasonsSolved({ ...half, outageWeeks: 0 })).toBe(false);
    const full = splitFor(CRACK_STATE_DEFAULTS).calendar;
    const halved = splitFor(half).calendar;
    expect(money(full)).toBe('$700,200');
    expect(money(halved)).toBe('$97,100');
    expect(halved / full).toBeLessThan(0.25);
    expect(halved / full).toBeCloseTo(0.139, 3);
    expect(inMarket(half)).toBe(40);
    expect(inMarket(CRACK_STATE_DEFAULTS)).toBe(95);
  });
  it('challenge a ignores the outage setting, which can’t matter without outages', () => {
    const a = { ...CRACK_STATE_DEFAULTS, outages: 0, seasonality: 0.6 };
    expect(stillTradesSolved(a)).toBe(true);
    expect(stillTradesSolved({ ...a, outageWeeks: 0 })).toBe(true);
    expect(runCrack({ ...a, outageWeeks: 0 }).stats.total).toBe(runCrack(a).stats.total);
  });
  it('ignoring outages earns the rule more than buying after them', () => {
    const base = runCrack(CRACK_STATE_DEFAULTS).stats.total;
    const ignore = runCrack({ ...CRACK_STATE_DEFAULTS, outageWeeks: 0 }).stats.total;
    expect(money(base)).toBe('$933,600');
    expect(money(ignore)).toBe('$961,300');
    expect(ignore).toBeGreaterThan(base);
  });
});

describe('oil 6.4', () => {
  const F = lessonFacts();
  it('at the seasonal forward, the 3:2:1 removes 63.0% and Corran’s mix 63.4%', () => {
    expect(F.standard.effectiveness).toBeCloseTo(0.63, 3);
    expect(F.matched.effectiveness).toBeCloseTo(0.634, 3);
    expect(F.twoOne.effectiveness).toBeCloseTo(0.649, 3);
    expect(F.standard.sdUnhedged / 1000).toBeCloseTo(193.3, 1);
    expect(F.standard.sdHedged / 1000).toBeCloseTo(117.6, 1);
    expect(F.best.ratio).toBeCloseTo(0.911, 3);
    expect(F.best.effectiveness).toBeCloseTo(0.643, 3);
  });
  it('the mix hardly matters in any world the figure offers', () => {
    for (let g = 0; g <= 140; g += 10)
      for (let s = 0; s <= 20; s += 5) {
        const hh = historyOf({ seasonality: s / 10, growth: g });
        const std = hedgeOn(hh, 0.8, 'brent', '3:2:1').effectiveness;
        expect(std).toBeGreaterThan(0.55);
        expect(Math.abs(std - hedgeOn(hh, 0.8, 'brent', 'corran').effectiveness)).toBeLessThan(0.03);
      }
  });
  it('sold flat, the same 3:2:1 would double the variance', () => {
    expect(F.flatStandard.effectiveness).toBeCloseTo(-1.0, 2);
  });
  it('the cracks move against each other with the seasons, but their surprises are alike', () => {
    expect(F.comove).toBeCloseTo(-0.9, 2);
    expect(F.surprises.gasoline).toBeCloseTo(1.38, 2);
    expect(F.surprises.diesel).toBeCloseTo(1.42, 2);
    expect(F.surprises.correlation).toBeCloseTo(0.27, 2);
  });
  it('the WTI crack: adds 7.8% at 0.8, removes at most 26.7%', () => {
    expect(F.wti.effectiveness).toBeCloseTo(-0.078, 3);
    expect(F.wtiBest.effectiveness).toBeCloseTo(0.267, 3);
    expect(F.wtiBest.ratio).toBeCloseTo(0.374, 3);
  });
  it('most of what is left moves with crude, and most of the rest with fuel oil', () => {
    expect(F.levelShare).toBeCloseTo(0.736, 3);
    const r = hedgeOn(h, F.best.ratio, 'brent', 'corran');
    const bf = seasonalForwards(h.map((w) => w.brent));
    const fo = h.map((w) => w.brent - w.hsfo);
    const ff = seasonalForwards(fo);
    const xb: number[] = [];
    const xf: number[] = [];
    for (let t = 1; t < h.length; t++) {
      const t0 = Math.floor((t - 1) / 13) * 13;
      xb.push(h[t].brent - bf(t0, t));
      xf.push(fo[t] - ff(t0, t));
    }
    const y = r.hedgedSurprise;
    const mx = xb.reduce((a, b) => a + b, 0) / xb.length;
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    let c = 0;
    let v = 0;
    xb.forEach((x, i) => {
      c += (x - mx) * (y[i] - my);
      v += (x - mx) ** 2;
    });
    const rest = y.map((yy, i) => yy - my - (c / v) * (xb[i] - mx));
    expect(correlation(xf, rest) ** 2).toBeGreaterThan(0.5);
  });
  it('LPG gains about 45 cents for each dollar crude rises', () => {
    const w = h[10];
    const up = { ...w, brent: w.brent + 1 };
    // Only LPG (0.455 × Brent) and naphtha (Brent − 11) read Brent directly in Corran's margin.
    expect(corranMargin(up) - corranMargin(w)).toBeCloseTo((CORRAN_DAY.lpg * 0.455 + CORRAN_DAY.naphtha) * 1000, 6);
  });
  it('quarter by quarter: the quarters the prose reads, and a hedged line no steadier', () => {
    const rows = F.rows;
    const q = F.sum;
    expect(rows[q.shortfall].quarter).toBe(6);
    expect(rows[q.windfall].quarter).toBe(8);
    expect(rows[q.weakest].quarter).toBe(7);
    expect(rows[q.hedgedShortfall].quarter).toBe(15);
    expect(rows[q.shortfall].realized).toBeLessThan(rows[q.shortfall].locked);
    expect(rows[q.windfall].realized).toBeGreaterThan(rows[q.windfall].locked);
    expect(rows[q.weakest].plan).toBeLessThan(rows[q.shortfall].plan);
    expect(q.totalUnhedged - q.totalHedged).toBeGreaterThan(0);
    expect(F.maxLocked).toBeGreaterThan(rows[0].locked);
    expect(q.paidQuarters).toBe(9);
    expect(sd(rows.map((r) => r.hedged))).toBeGreaterThanOrEqual(sd(rows.map((r) => r.unhedged)));
    expect(q.rmsHedged).toBeLessThan(q.rmsUnhedged / 1.5);
    const plan = (s: number) => sd(quartersFor({ ...QUARTER_DEFAULTS, seasonality: s }).map((r) => r.plan));
    expect(plan(2)).toBeGreaterThan(plan(1));
    expect(summarizeQuarters(quartersFor(QUARTER_DEFAULTS)).rmsHedged).toBeCloseTo(q.rmsHedged, 6);
  });
  it('challenge a: with the seasons doubled, the 3:2:1 against Brent still removes more than half', () => {
    expect(STANDARD_TARGET).toBe(0.5);
    expect(standardCrackSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(standardCrackSolved({ ...HEDGE_DEFAULTS, seasonality: SEASON_MAX })).toBe(true);
    expect(hedgeFor({ ...HEDGE_DEFAULTS, seasonality: SEASON_MAX }).effectiveness).toBeCloseTo(0.63, 2);
    expect(standardCrackSolved({ ...HEDGE_DEFAULTS, seasonality: SEASON_MAX, bench: 'wti' })).toBe(false);
    expect(standardCrackSolved({ ...HEDGE_DEFAULTS, seasonality: SEASON_MAX, mix: 'corran' })).toBe(false);
  });
  it('challenge b: the fastest growth at which the WTI hedge removes half is 30 kb/d', () => {
    expect(WTI_TARGET).toBe(0.5);
    expect(fastestWtiGrowth()).toBe(30);
    const at30 = { ...HEDGE_DEFAULTS, mix: 'corran' as const, bench: 'wti' as const, growth: 30 };
    expect(wtiGrowthSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(wtiGrowthSolved(at30)).toBe(true);
    expect(wtiGrowthSolved({ ...at30, growth: 20 })).toBe(false);
    expect(hedgeFor(at30).effectiveness).toBeCloseTo(0.568, 3);
    expect(bestHedge({ ...at30, bench: 'brent' }).effectiveness).toBeCloseTo(0.619, 3);
    expect(bestHedge({ ...at30, growth: 40 }).effectiveness).toBeCloseTo(0.139, 3);
  });
});

describe('oil 6.5', () => {
  it('the book and drivers figures together make the laboratory’s starting state', () => {
    expect({ ...BOOK_DEFAULTS, ...DRIVER_DEFAULTS }).toEqual(LAB_DEFAULTS);
    expect(crackSolved({ ...LAB_DEFAULTS, ...DRIVER_DEFAULTS, expansion: 'none' })).toBe(true);
    expect(crackSolved({ ...LAB_DEFAULTS, ...DRIVER_DEFAULTS })).toBe(false);
  });
  it('the table’s weekly SD column: per unit, and the book’s less than the sum of its parts', () => {
    const base = runLab(LAB_DEFAULTS);
    const one = runLab({ ...LAB_DEFAULTS, calendar: 1, basis: 1, crack: 1, quality: 1 });
    expect(one.sds.calendar).toBeCloseTo(55.9, 1);
    expect(one.sds.basis).toBeCloseTo(1134.9, 1);
    expect(one.sds.crack).toBeCloseTo(3584.8, 1);
    expect(one.sds.quality).toBeCloseTo(248.4, 1);
    for (const id of STRATEGIES) expect(base.sds[id]).toBeCloseTo(10 * one.sds[id], 6);
    const sumSd = STRATEGIES.reduce((a, id) => a + base.sds[id], 0);
    const sumVar = STRATEGIES.reduce((a, id) => a + base.vars[id], 0);
    expect(usd(sumSd)).toBe('$50,240');
    expect(usd(base.stats.stdev)).toBe('$42,291');
    expect(money(sumVar)).toBe('$40,900');
    expect(money(base.stats.var95)).toBe('$29,400');
  });
  it('challenge a: reasoning from the SD column reaches the target; near misses don’t', () => {
    const at = (c: number, b: number, k: number, q: number) => ({ ...LAB_DEFAULTS, calendar: c, basis: b, crack: k, quality: q });
    expect(SIZING_TARGET).toEqual({ sharpe: 1.4, total: 400000 });
    // Cut the crack (the biggest swing), lean on the calendar and quality (the smallest), then trim the basis.
    expect(sizingSolved(at(10, 10, 1, 10))).toBe(false);
    expect(sizingSolved(at(20, 10, 1, 20))).toBe(false);
    expect(sizingSolved(at(20, 8, 1, 20))).toBe(true);
    expect(sizingSolved(at(20, 5, 1, 20))).toBe(true);
    expect(sizingSolved(at(20, 5, 2, 20))).toBe(false);
    expect(sizingSolved(at(20, 2, 1, 20))).toBe(false);
    expect(sizingSolved({ ...TUNED_BOOK, history: 1 })).toBe(false);
  });
  it('the sizing challenge’s success message describes the reader’s own book', () => {
    expect(sizingStory(TUNED_BOOK)).toBe('shrinking the basis trade and the crack, and leaning on the calendar spread and the quality trade — sizing by risk rather than by units');
  });
});

describe('oil chapter 6: one style', () => {
  it('money is to the nearest $100, or in millions from $1 million', () => {
    expect(money(25821)).toBe('$25,800');
    expect(money(-57521)).toBe('−$57,500');
    expect(money(1438357)).toBe('$1.44 million');
  });
  it('year axes and the seasonal swing read the same in every lesson', () => {
    expect([0, 1, 5].map(yearTick)).toEqual(['start', 'year 1', 'year 5']);
    expect([0, 0.3, 0.5, 1, 1.25, 2].map(seasonDisplay)).toEqual(['none', '×0.3', '×0.5', '×1.0 (normal)', '×1.25', '×2.0']);
  });
});
