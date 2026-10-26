// The weather course, chapter 5: the numbers its lessons quote after the two fix passes, and the
// challenges whose checks changed (pass 2: predict-then-check, each default unsolved).

import { describe, expect, it } from 'vitest';
import {
  BUILDER_DEFAULTS,
  MILD_YEAR,
  SETTLE_DEFAULTS,
  droughtSolved,
  settle,
  settlementSolved,
  worstOutage,
} from '../src/lessons/weather/ch5/L5_1';
import { PARITY, PRICER_DEFAULTS, bestRawWindow, burnError, crossingWindow, paritySolved, pricerDist, windowSolved } from '../src/lessons/weather/ch5/L5_2';
import {
  EDGE_DEFAULTS,
  FIRST_DAY,
  PREMIUM_EXAMPLE,
  PREMIUM_PAID,
  REPLAY_DEFAULTS,
  WIDER_SPREAD,
  WIDE_SPREAD,
  YEARS_TRADED,
  biggestGapYear,
  gapOf,
  gapSolved,
  replayOf,
  specOf,
  timeline,
  vanishSolved,
  views,
} from '../src/lessons/weather/ch5/L5_3';
import { BOOK_DEFAULTS, BOOK_WEEK, LAB_DEFAULTS, bestBook, bookChallengeSolved, labIdeas, pipelineSolved } from '../src/lessons/weather/ch5/L5_4';
import {
  BACKTEST_DEFAULTS,
  CROSS_DEFAULTS,
  FORECAST_REACH,
  HEDGE_DEFAULTS,
  REACH_LEAD,
  STRONG_PULL,
  TIGHT_PIPELINE,
  WALK_FROM,
  YEARS,
  bestStrips,
  clearOfZero,
  crossRun,
  gasVisibleSolved,
  hedgeBase,
  hedgeSolved,
  lookAheadSolved,
  mostWindGasShows,
  runBacktest,
  sameAsHonest,
  shortestChangingLookAhead,
  walkForwardHedge,
} from '../src/lessons/weather/ch5/L5_5';
import { WEEKS_PER_WINTER, crossMarketReplay } from '../src/engines/weather/crossBacktest';
import { DRIVER_DEFAULTS } from '../src/engines/weather/crossMarket';
import { contractSpan } from '../src/engines/weather/pricing';
import { ninoAt } from '../src/model/weather/archive';

describe('weather 5.2: the burn window', () => {
  it('at the best window the noise and bias are not equal; their marginal changes balance', () => {
    const e = burnError(bestRawWindow(), false);
    expect(bestRawWindow()).toBe(27);
    expect(e.noise - e.bias).toBeGreaterThan(2);
  });
});

describe('weather 5.3: the risk premium', () => {
  it('a premium moves the price and the implied probability, not our view', () => {
    const p0 = timeline(EDGE_DEFAULTS).points[0];
    const p1 = timeline({ ...EDGE_DEFAULTS, premium: PREMIUM_EXAMPLE }).points[0];
    expect(p1.mid - p0.mid).toBeCloseTo(PREMIUM_EXAMPLE, 6);
    expect(p1.ours).toBeCloseTo(p0.ours, 6);
    const v0 = views(EDGE_DEFAULTS);
    const v1 = views({ ...EDGE_DEFAULTS, premium: PREMIUM_EXAMPLE });
    expect(v0.pMarket).toBeCloseTo(0.5, 2);
    expect(v1.pMarket).toBeCloseTo(0.46, 2);
    expect(v1.pOurs).toBe(v0.pOurs);
  });

  it('with no physical gap, a −15 premium leaves $200 a contract and is too small to see in 39 winters', () => {
    const p = timeline({ ...EDGE_DEFAULTS, ensoF: 0, premium: PREMIUM_PAID }).points[0];
    expect((Math.abs(p.ours - p.mid) - (p.ask - p.mid)) * 20).toBeCloseTo(200, 6);
    const s = replayOf({ ...REPLAY_DEFAULTS, ensoF: 0 }, PREMIUM_PAID).stats;
    expect(s.trades).toBe(39);
    expect(s.mean).toBeGreaterThan(0);
    expect(s.mean - 2 * (s.sd / Math.sqrt(s.trades))).toBeLessThan(0);
    // The demonstration's replay has no premium.
    expect(replayOf(REPLAY_DEFAULTS).stats.trades).toBe(26);
  });

  it('the first challenge needs the premium at zero; the second is unchanged', () => {
    expect(gapSolved({ ...EDGE_DEFAULTS, year: 24 })).toBe(true);
    expect(gapSolved({ ...EDGE_DEFAULTS, year: 24, premium: -5 })).toBe(false);
    expect(gapSolved(EDGE_DEFAULTS)).toBe(false);
    expect(vanishSolved({ ...REPLAY_DEFAULTS, lead: 5, ensoF: 0, lag: 0 })).toBe(true);
    expect(vanishSolved(REPLAY_DEFAULTS)).toBe(false);
  });

  it('the distributions have a standard deviation of about 90, and the worst losses are about a typical win', () => {
    expect(Math.round(views(EDGE_DEFAULTS).oursSd / 10) * 10).toBe(90);
    const trades = replayOf(REPLAY_DEFAULTS).trades;
    const wins = trades.filter((t) => t.pnl > 0);
    const avgWin = wins.reduce((a, t) => a + t.pnl, 0) / wins.length;
    const worst = -Math.min(...trades.map((t) => t.pnl));
    expect(worst / avgWin).toBeGreaterThan(0.8);
    expect(worst / avgWin).toBeLessThan(1.25);
  });
});

describe('weather 5.4: ratios at the extremes', () => {
  const at = (week: number) => labIdeas({ ...LAB_DEFAULTS, week });
  it('at 14 °F gas is just short of the future, though both show 1.05', () => {
    const [h, g] = at(14);
    expect(g.ratio).toBeLessThan(h.ratio);
    expect(g.ratio.toFixed(2)).toBe('1.05');
    expect(h.ratio.toFixed(2)).toBe('1.05');
  });
  it('at 0 °F gas has the best ratio of the three', () => {
    const [h, g, p] = at(0);
    expect(g.ratio).toBeGreaterThan(Math.max(h.ratio, p.ratio));
  });
  it('at 34 °F the best book has no gas, though gas still pays its spread', () => {
    const ideas = at(34);
    expect(bestBook(ideas).book.gas).toBe(0);
    expect(ideas[1].netPerContract).toBeGreaterThan(0);
    expect(ideas[2].ratio).toBeGreaterThan(ideas[1].ratio);
  });
});

describe('weather 5.5: the cross-market backtest', () => {
  const run = crossRun(CROSS_DEFAULTS);

  it('replays twelve weeks in each of 39 winters', () => {
    expect(YEARS.length).toBe(39);
    expect(run.weeks).toBe(39 * WEEKS_PER_WINTER);
    expect(crossMarketReplay(YEARS, 2, DRIVER_DEFAULTS).stats).toEqual(run.stats);
  });

  it('the HDD edge shows; gas and power can’t be told from zero or from what they expected', () => {
    const { hdd, gas, power } = run.stats;
    expect(hdd.trades).toBe(318);
    expect(clearOfZero(hdd)).toBe(1);
    expect(Math.abs(hdd.mean - hdd.expected)).toBeLessThan(2 * hdd.se);
    expect(hdd.mean).toBeLessThan(hdd.expected);
    expect(gas.trades).toBe(41);
    expect(clearOfZero(gas)).toBe(0);
    expect(Math.abs(gas.mean - gas.expected)).toBeLessThan(2 * gas.se);
    expect(clearOfZero(power)).toBe(0);
    expect(Math.abs(power.mean - power.expected)).toBeLessThan(2 * power.se);
    for (const id of ['hdd', 'gas', 'power'] as const) for (const t of run.trades[id]) expect(t.expected).toBeGreaterThan(0);
  });

  it('fresh forecasts leave nothing to trade', () => {
    const fresh = crossRun({ ...CROSS_DEFAULTS, lag: 0 });
    expect(fresh.stats.hdd.trades + fresh.stats.gas.trades + fresh.stats.power.trades).toBe(0);
  });

  it('tight pipelines make the gas edge visible, and wind takes it away again', () => {
    expect(clearOfZero(crossRun({ ...CROSS_DEFAULTS, pipeline: 1.2 }).stats.gas)).toBe(1);
    expect(clearOfZero(crossRun({ ...CROSS_DEFAULTS, pipeline: 1.25 }).stats.gas)).toBe(0);
    expect(crossRun({ ...CROSS_DEFAULTS, pipeline: 1.2 }).stats.gas.trades).toBeGreaterThan(run.stats.gas.trades);
  });
});

describe('weather 5.5: the rest', () => {
  it('the backtester starts where 5.3’s replay left off', () => {
    const a = runBacktest(BACKTEST_DEFAULTS).stats;
    const b = replayOf(REPLAY_DEFAULTS).stats;
    expect(a.trades).toBe(b.trades);
    expect(a.mean).toBeCloseTo(b.mean, 6);
  });

  it('fitted on past winters only, the hedge removes a little less of the variance', () => {
    const w = walkForwardHedge(1, 1);
    expect(w.winters).toBe(40 - WALK_FROM + 1);
    expect(w.outOfSample).toBeLessThan(w.inSample);
    expect(w.outOfSample).toBeGreaterThan(0.95);
    expect((w.outOfSample * 100).toFixed(1)).toBe('96.2');
    expect((w.inSample * 100).toFixed(1)).toBe('96.6');
  });

  it('each fifth of an honest histogram expects 7.8 of 39, give or take 2.5', () => {
    expect((39 / 5).toFixed(1)).toBe('7.8');
    expect(Math.sqrt(39 * 0.2 * 0.8).toFixed(1)).toBe('2.5');
  });
});

// ---------------------------------------------------------------------------
// The second fix pass: predict-then-check challenges, and the numbers their prose quotes.

describe('weather 5.1, pass 2', () => {
  it('the drought put is unchanged: the default is unsolved, a capped put struck at 9.5 in solves', () => {
    expect(droughtSolved(BUILDER_DEFAULTS)).toBe(false);
    expect(droughtSolved({ ...BUILDER_DEFAULTS, index: 'rain', station: 'marlow', start: 5, length: 3, type: 'put', strike: 9.5, tickI: 11, capI: 5 })).toBe(true);
  });

  it('the fallback challenge: only the adjusted ridge settles within 2 degree days', () => {
    expect(settlementSolved(SETTLE_DEFAULTS)).toBe(false);
    expect(settlementSolved({ ...SETTLE_DEFAULTS, fill: 'ridgeAdj' })).toBe(true);
    for (const fill of ['ridge', 'marlow', 'marlowAdj'] as const) expect(settlementSolved({ ...SETTLE_DEFAULTS, fill })).toBe(false);
    // Elsewhere in the month or with drift, the same rule doesn't count.
    expect(settlementSolved({ ...SETTLE_DEFAULTS, fill: 'ridgeAdj', outStart: 16 })).toBe(false);
  });

  it('the normal fill errs either way: −58.6 in year 23, +69.5 in mild year 15', () => {
    const cold = settle(SETTLE_DEFAULTS);
    const mild = settle({ ...SETTLE_DEFAULTS, year: MILD_YEAR });
    expect((cold.reportedIndex - cold.trueIndex).toFixed(1)).toBe('-58.6');
    expect((mild.reportedIndex - mild.trueIndex).toFixed(1)).toBe('69.5');
    expect(mild.moved).toBeGreaterThan(0);
  });

  it('the adjusted ridge can still miss by 30.4 degree days, for an outage starting January 3', () => {
    const w = worstOutage('ridgeAdj');
    expect(w.start).toBe(3);
    expect(w.err.toFixed(1)).toBe('30.4');
  });
});

describe('weather 5.2, pass 2', () => {
  it('the parity challenge: year 12 on the eve of January, expected index 1,120.7', () => {
    const d = pricerDist(PARITY.year, PARITY.offset);
    expect(d.mean.toFixed(1)).toBe('1120.7');
    expect(paritySolved({ ...PARITY, strike: 1120 })).toBe(true);
    expect(paritySolved({ ...PARITY, strike: 1110 })).toBe(false);
    expect(paritySolved({ ...PARITY, strike: 1130 })).toBe(false);
    expect(paritySolved({ ...PARITY, strike: PRICER_DEFAULTS.strike })).toBe(false);
    expect(paritySolved(PRICER_DEFAULTS)).toBe(false);
    // The right strike on another date doesn't count.
    expect(paritySolved({ year: 20, offset: PARITY.offset, strike: 1120 })).toBe(false);
  });

  it('the window challenge: the curves cross at 33 years, but the best window is 27', () => {
    expect(crossingWindow()).toBe(33);
    const cross = burnError(33, false);
    const best = burnError(bestRawWindow(), false);
    expect(Math.abs(cross.noise - cross.bias)).toBeLessThan(0.5);
    expect(cross.total.toFixed(1)).toBe('22.5');
    expect(best.total.toFixed(1)).toBe('21.9');
    expect(windowSolved({ window: 33, detrend: false })).toBe(false);
    expect(windowSolved({ window: 10, detrend: false })).toBe(false);
    expect(windowSolved({ window: 22, detrend: false })).toBe(false);
    expect(windowSolved({ window: 31, detrend: false })).toBe(false);
    for (const w of [23, 27, 30]) expect(windowSolved({ window: w, detrend: false })).toBe(true);
    expect(windowSolved({ window: 27, detrend: true })).toBe(false);
  });
});

describe('weather 5.3, pass 2', () => {
  const nino60 = (y: number) => ninoAt(contractSpan(specOf('jan'), y).start + FIRST_DAY);

  it('the most extreme Niño-3.4 sixty days ahead marks the largest gap: year 24', () => {
    const extreme = YEARS_TRADED.reduce((a, y) => (Math.abs(nino60(y)) > Math.abs(nino60(a)) ? y : a), YEARS_TRADED[0]);
    expect(extreme).toBe(24);
    expect(biggestGapYear()).toBe(extreme);
    expect(nino60(24).toFixed(1)).toBe('-1.8');
    const gap = gapOf({ ...EDGE_DEFAULTS, year: 24 });
    expect(gap.toFixed(1)).toBe('54.2');
    // Close to Niño × pull × 31 days.
    expect(Math.abs(Math.abs(nino60(24)) * EDGE_DEFAULTS.ensoF * 31 - gap)).toBeLessThan(3);
    expect(gapSolved({ ...EDGE_DEFAULTS, year: 6 })).toBe(false);
    expect(gapSolved({ ...EDGE_DEFAULTS, year: 24, day: FIRST_DAY + 1 })).toBe(false);
  });

  it('the costs: wider spreads eat the edge; higher thresholds cut trades without a clear gain', () => {
    const r = (p: Partial<typeof REPLAY_DEFAULTS>) => replayOf({ ...REPLAY_DEFAULTS, ...p }).stats;
    const wide = r({ halfSpread: WIDE_SPREAD });
    const wider = r({ halfSpread: WIDER_SPREAD });
    expect(wide.trades).toBe(19);
    expect(Math.round(wide.mean)).toBe(201);
    expect(Math.round(wider.mean)).toBe(28);
    expect(wider.mean - 2 * (wider.sd / Math.sqrt(wider.trades))).toBeLessThan(0);
    const t10 = r({ threshold: 10 });
    const t20 = r({ threshold: 20 });
    expect([t10.trades, t20.trades]).toEqual([19, 11]);
    expect([Math.round(t10.mean), Math.round(t20.mean)]).toEqual([301, 605]);
    const base = r({});
    for (const t of [t10, t20]) expect(Math.abs(t.mean - base.mean)).toBeLessThan(2 * (t.sd / Math.sqrt(t.trades)));
  });
});

describe('weather 5.4, pass 2', () => {
  it('the pipeline challenge: the gas edge drops below the $0.15 half-spread at 1.85', () => {
    const edge = (p: number) => labIdeas({ ...LAB_DEFAULTS, pipeline: p })[1].edge;
    expect(edge(1.8)).toBeGreaterThan(0.15);
    expect(edge(1.85)).toBeLessThan(0.15);
    expect(edge(1.8).toFixed(2)).toBe('0.16');
    expect(edge(1.85).toFixed(2)).toBe('0.10');
    expect(pipelineSolved({ ...LAB_DEFAULTS, pipeline: 1.85 })).toBe(true);
    for (const p of [1.4, 1.8, 1.9]) expect(pipelineSolved({ ...LAB_DEFAULTS, pipeline: p })).toBe(false);
  });

  it('the book challenge is set at 30 °F, where the best book is 50 HDD futures and 8 power contracts', () => {
    const st = { ...LAB_DEFAULTS, week: BOOK_WEEK };
    const ideas = labIdeas(st);
    expect(bestBook(ideas).book).toEqual({ hdd: 50, gas: 0, power: 8 });
    const [, gas, power] = ideas;
    expect(power.ratio).toBeGreaterThan(gas.ratio);
    expect(gas.netPerContract).toBeGreaterThan(power.netPerContract);
    expect(gas.riskPerContract / power.riskPerContract).toBeGreaterThan(1.9);
    expect(gas.riskPerContract / power.riskPerContract).toBeLessThan(2.2);
    expect(bookChallengeSolved(LAB_DEFAULTS, BOOK_DEFAULTS)).toBe(false);
    expect(bookChallengeSolved(st, BOOK_DEFAULTS)).toBe(false);
    expect(bookChallengeSolved(st, { hdd: 50, gas: 0, power: 8 })).toBe(true);
    expect(bookChallengeSolved(st, { hdd: 49, gas: 0, power: 8 })).toBe(true);
    expect(bookChallengeSolved(st, { hdd: 50, gas: 1, power: 6 })).toBe(false);
    expect(bookChallengeSolved(st, { hdd: 50, gas: 0, power: 9 })).toBe(false);
    // The book of the paragraph before, at the starting week, doesn't count.
    expect(bookChallengeSolved(LAB_DEFAULTS, { hdd: 50, gas: 1, power: 0 })).toBe(false);
    expect(bookChallengeSolved({ ...st, wind: 10 }, { hdd: 50, gas: 0, power: 8 })).toBe(false);
  });
});

describe('weather 5.5, pass 2', () => {
  const reach = { ...BACKTEST_DEFAULTS, lead: REACH_LEAD };

  it('the look-ahead challenge: 30 days ahead, the bug changes nothing until it reaches January, at 15 days', () => {
    expect(shortestChangingLookAhead(reach)).toBe(REACH_LEAD - FORECAST_REACH);
    expect(sameAsHonest({ ...reach, lookAhead: 14 })).toBe(true);
    expect(sameAsHonest({ ...reach, lookAhead: 15 })).toBe(false);
    expect(lookAheadSolved({ ...reach, lookAhead: 15 })).toBe(true);
    for (const l of [0, 1, 14, 16]) expect(lookAheadSolved({ ...reach, lookAhead: l })).toBe(false);
    expect(lookAheadSolved(BACKTEST_DEFAULTS)).toBe(false);
    expect(lookAheadSolved({ ...BACKTEST_DEFAULTS, lead: 0, lookAhead: 2 })).toBe(false);
    expect(lookAheadSolved({ ...reach, lookAhead: 15, ensoF: 2 })).toBe(false);
    const honest = runBacktest(reach).stats;
    const leaked = runBacktest({ ...reach, lookAhead: 15 }).stats;
    expect([honest.trades, Math.round(honest.mean)]).toEqual([29, 463]);
    expect([leaked.trades, Math.round(leaked.mean)]).toEqual([27, 557]);
  });

  it('a stronger pull lifts the edge clear of its error bars', () => {
    const base = runBacktest(BACKTEST_DEFAULTS);
    expect(base.stats.mean - 2 * base.se).toBeLessThan(0);
    const strong = runBacktest({ ...BACKTEST_DEFAULTS, ensoF: STRONG_PULL });
    expect(strong.stats.trades).toBe(32);
    expect(Math.round(strong.stats.mean)).toBe(761);
    expect(Math.round(2 * strong.se)).toBe(514);
    expect(strong.stats.mean - 2 * strong.se).toBeGreaterThan(0);
  });

  it('the wind challenge: with tight pipelines, gas shows up to 9 m/s and not beyond', () => {
    expect(mostWindGasShows()).toBe(9);
    const tight = { ...CROSS_DEFAULTS, pipeline: TIGHT_PIPELINE };
    expect(gasVisibleSolved({ ...tight, wind: 9 })).toBe(true);
    for (const wind of [7.5, 8.5, 9.5, 13]) expect(gasVisibleSolved({ ...tight, wind })).toBe(false);
    expect(gasVisibleSolved(CROSS_DEFAULTS)).toBe(false);
    expect(gasVisibleSolved({ ...tight, wind: 9, lag: 3 })).toBe(false);
    expect(gasVisibleSolved({ ...CROSS_DEFAULTS, pipeline: 1.25, wind: 9 })).toBe(false);
    expect(clearOfZero(crossRun({ ...tight, wind: 9.5 }).stats.gas)).toBe(0);
    // More wind: fewer gas trades, each expected to make less.
    const at9 = crossRun({ ...tight, wind: 9 }).stats.gas;
    const at75 = crossRun(tight).stats.gas;
    expect(at9.trades).toBeLessThan(at75.trades);
    expect(at9.expected).toBeLessThan(at75.expected);
  });

  it('the hedge challenge: slope ÷ $20, to the nearest hundred, is the best strip count for every physics', () => {
    for (const variability of [0.6, 1, 1.5, 1.6]) {
      for (const ensoF of [0, 1, 3]) {
        const n = bestStrips(variability, ensoF);
        expect(Math.round(hedgeBase(variability, ensoF).slope / 20 / 100) * 100).toBe(n);
      }
    }
    expect(hedgeSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(hedgeSolved({ ...HEDGE_DEFAULTS, contracts: 2800 })).toBe(true);
    for (const contracts of [2700, 2900]) expect(hedgeSolved({ ...HEDGE_DEFAULTS, contracts })).toBe(false);
  });
});
