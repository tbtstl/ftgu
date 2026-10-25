// Shipping chapter 5: assertions added by the pedagogy fix pass (numbers quoted in prose, challenge checks).

import { describe, expect, it } from 'vitest';
import { equilibrium } from '../src/engines/shipping/market';
import { forwardPrice } from '../src/engines/shipping/ffa';
import { whatIf } from '../src/engines/shipping/strategies';
import { eventAt, standardHistory } from '../src/model/shipping/history';
import {
  BUNKER_YEAR_AVG,
  CHALLENGE as CHALLENGE51,
  DEFAULT_STATE as DEFAULT51,
  FADE_ONLY_BEST,
  FUEL_ONLY_BEST,
  MISS,
  forecastRun,
  forecastSolved,
  sensitivity,
} from '../src/lessons/shipping/ch5/L5_1';
import {
  CORR_CHANGES,
  LEGS,
  MAY_SPREAD_NO_EVENT,
  NEWS_MAY,
  NEWS_MAY_NO_EVENT,
  NEWS_MONTH,
  capeFronthaulMiles,
  legForward,
  newsTradeSolved,
  shortClassWinShare,
  tradeResult,
} from '../src/lessons/shipping/ch5/L5_2';
import {
  BOOK_AVERAGE,
  BOOK_WINNERS,
  DUE_AVERAGE,
  DUE_WINNERS,
  LOW_DUE_Y8,
  LOW_DUE_Y8_RESULTS,
  SOLUTIONS as SOLUTIONS53,
  START as START53,
  dueWithinYear,
  fleetSurpriseSolved,
  growthAfter,
} from '../src/lessons/shipping/ch5/L5_3';
import {
  APRIL,
  APRIL5,
  APRIL_CHINA,
  CLOSEST,
  DEFAULTS as DEFAULTS54,
  FEB3,
  FLEX_DEFAULTS,
  FREE_NEWS,
  FREE_NEWS_BEST,
  FREE_NEWS_RUNNER_UP,
  SOY_GRID,
  WEAKEST_FULL,
  comparePlans,
  fixCredit,
  freeNewsSolved,
  harvestSolved,
} from '../src/lessons/shipping/ch5/L5_4';
import { DEFAULT_LAB, fundamentalsWithoutDeliveries, labRun } from '../src/lessons/shipping/ch5/L5_5';
import L55 from '../src/lessons/shipping/ch5/L5_5';
import L53 from '../src/lessons/shipping/ch5/L5_3';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { periodCharter } from '../src/engines/shipping/strategies';
import { dailyIndex } from '../src/engines/shipping/ffa';
import { monthAverage } from '../src/engines/shipping/indices';
import { mean, stdev } from '../src/engines/strategy/risk';

const HIST = standardHistory();

describe('shipping 5.1', () => {
  it('splits the Year 5 forecast’s January miss into cargo and fuel', () => {
    const run = forecastRun(DEFAULT51);
    const last = run.path[run.path.length - 1];
    expect(MISS.forecast).toBeCloseTo(last.tce, 0);
    expect(MISS.forecast).toBeCloseTo(11_018, -1);
    expect(MISS.cargo).toBeCloseTo(8_355, -1);
    expect(1 - MISS.cargo / MISS.forecast).toBeCloseTo(0.24, 2);
    expect(MISS.fuel).toBeCloseTo(8_791, -1);
    expect(1 - MISS.fuel / MISS.forecast).toBeCloseTo(0.2, 2);
    expect(MISS.both).toBeCloseTo(6_666, -1);
    expect(MISS.actual).toBeCloseTo(6_490, -1);
    expect(MISS.bunkerAssumed).toBe(752);
    expect(MISS.bunkerActual).toBe(600);
    expect(HIST.cls.kmax[last.t].idle).toBeLessThan(0.5);
  });

  it('measures the slump’s and the boom’s sensitivities without counting a month’s own queue twice', () => {
    const slump = sensitivity('cape', 60);
    const boom = sensitivity('cape', 30);
    const row = (s: typeof slump, key: string) => s.rows.find((r) => r.key === key)!;
    // Qingdao +2 days adds to the China-ports queue of months 40–45 rather than doubling it.
    const months = HIST.cls.cape.slice(31, 43);
    const by = (d: number) => months.reduce((a, m) => a + whatIf('cape', m, { congestion: { QIN: d } }, eventAt(m.t)), 0) / 12;
    expect(row(boom, 'qin').up.change).toBeCloseTo(by(2) / boom.base - 1, 9);
    expect(slump.floorMonths).toBe(9);
    const slumpBunker = Math.max(Math.abs(row(slump, 'bunker').up.change), Math.abs(row(slump, 'bunker').down!.change));
    expect(slumpBunker).toBeCloseTo(0.13, 2);
    const boomBunker = Math.min(Math.abs(row(boom, 'bunker').up.change), Math.abs(row(boom, 'bunker').down!.change));
    expect(boomBunker).toBeCloseTo(0.25, 2);
    expect(slumpBunker / boomBunker).toBeGreaterThan(0.4);
    expect(slumpBunker / boomBunker).toBeLessThan(0.6);
    const usd = (s: typeof slump, side: 'up' | 'down') => (side === 'up' ? row(s, 'cargo').up : row(s, 'cargo').down!).change * s.base;
    expect(Math.round((usd(boom, 'up') - usd(boom, 'down')) / 2 / 100) * 100).toBe(4_900);
    expect(Math.round(usd(slump, 'up') / 100) * 100).toBe(2_600);
    expect(Math.round(usd(slump, 'down') / 100) * 100).toBe(-800);
  });

  it('asks which one assumption explains the Year 5 miss, with growth and supply held right: only fuel does', () => {
    expect(CHALLENGE51.target).toBe(0.15);
    expect(forecastSolved(DEFAULT51)).toBe(false);
    // Every single-assumption change over the sliders' steps: only a bunker price from $602 to $702 solves it.
    const sols: string[] = [];
    for (let b = -300; b <= 300; b += 25) if (forecastSolved({ ...DEFAULT51, bunkerDelta: b })) sols.push(`bunker ${b}`);
    for (let i = 0; i <= 50; i++) if (forecastSolved({ ...DEFAULT51, fade: Math.round((0.5 + 0.01 * i) * 100) / 100 })) sols.push(`fade ${i}`);
    for (let q = 0; q <= 12; q++) if (forecastSolved({ ...DEFAULT51, qin: q * 0.5 })) sols.push(`qin ${q}`);
    expect(sols).toEqual([-150, -125, -100, -75, -50].map((b) => `bunker ${b}`));
    // The fuel price that actually came (−$150 → $602) solves it; near misses don't.
    expect(forecastRun({ ...DEFAULT51, bunkerDelta: -150 }).error).toBeCloseTo(0.137, 3);
    expect(forecastSolved({ ...DEFAULT51, bunkerDelta: -175 })).toBe(false);
    expect(forecastSolved({ ...DEFAULT51, bunkerDelta: -25 })).toBe(false);
    // Fudging the supply side or the trend is ruled out, even when it shrinks the miss.
    expect(forecastRun({ ...DEFAULT51, scrap: 0 }).error).toBeLessThan(0.15);
    expect(forecastSolved({ ...DEFAULT51, scrap: 0 })).toBe(false);
    expect(forecastSolved({ ...DEFAULT51, growth: 0.005 })).toBe(false);
    expect(forecastSolved({ ...DEFAULT51, bunkerDelta: -150, deliveries: false })).toBe(false);
    expect(forecastSolved({ ...DEFAULT51, bunkerDelta: -150, fade: 0.9 })).toBe(false);
    // Success-message numbers.
    expect(BUNKER_YEAR_AVG).toBeCloseTo(691.6, 1);
    expect(FADE_ONLY_BEST).toBeCloseTo(0.16, 2);
    expect(FUEL_ONLY_BEST).toBeCloseTo(0.129, 3);
    const qin = [0, 1, 2].map((q) => forecastRun({ ...DEFAULT51, qin: q }).forecastAvg);
    expect(qin[1]).toBeGreaterThan(qin[0]);
    expect(qin[2]).toBeGreaterThan(qin[1]);
    for (const m of HIST.cls.kmax.slice(49, 61)) expect(m.idle).toBeLessThan(0.05);
    const run = forecastRun(DEFAULT51);
    expect(Math.abs((run.actualFleetEnd as number) - run.fleetEnd)).toBeLessThan(2.5);
  });
});

describe('shipping 5.2', () => {
  it('prices each leg at the forward curve, exactly as Lesson 4.5 does for a class index', () => {
    const [cape, kmax] = LEGS.class.legs;
    for (const e of [0, 30, 63, 100]) {
      const day = (e + 1) * 21 - 1;
      for (const h of [1, 3, 6]) {
        expect(legForward(cape, day, e + h)).toBeCloseTo(forwardPrice('cape', cape.daily, day, e + h), 6);
        expect(legForward(kmax, day, e + h)).toBeCloseTo(forwardPrice('kmax', kmax.daily, day, e + h), 6);
      }
    }
  });

  it('pays the Brazil news short from the forward spread, and almost nothing without the disruption', () => {
    expect(NEWS_MAY.entry).toBeCloseTo(3_018, -1);
    expect(NEWS_MAY.exit).toBeCloseTo(-4_988, -1);
    expect(NEWS_MAY.pnl).toBeCloseTo(240_207, -1);
    expect(MAY_SPREAD_NO_EVENT).toBeCloseTo(2_645, -1);
    expect(NEWS_MAY_NO_EVENT).toBeCloseTo(11_213, -1);
    expect(shortClassWinShare(6)).toBeCloseTo(0.73, 2);
    const capeAnchor = mean(LEGS.class.legs[0].longRun);
    const capeAvg = mean(LEGS.class.legs[0].monthly);
    expect(capeAnchor).toBeCloseTo(29_199, -1);
    expect(capeAvg).toBeCloseTo(20_538, -1);
  });

  it('starts unsolved and is solved by the short at 30 days a leg', () => {
    const start = { legs: 'class' as const, side: 'long' as const, entry: 24, held: 6, days: 30 };
    expect(newsTradeSolved(start)).toBe(false);
    expect(newsTradeSolved({ ...start, side: 'short', entry: NEWS_MONTH, held: 1 })).toBe(true);
    expect(newsTradeSolved({ ...start, side: 'long', entry: NEWS_MONTH, held: 1 })).toBe(false);
    expect(newsTradeSolved({ ...start, side: 'short', entry: NEWS_MONTH, held: 1, days: 90 })).toBe(false);
    expect(newsTradeSolved({ ...start, side: 'short', entry: NEWS_MONTH, held: 7 })).toBe(false);
    expect(tradeResult({ ...start, side: 'short', entry: NEWS_MONTH, held: 1 }).pnl).toBeCloseTo(NEWS_MAY.pnl, 6);
  });

  it('quotes the loose correlation of monthly changes, and a fronthaul gap that ore volumes don’t move', () => {
    expect(CORR_CHANGES).toBeCloseTo(0.35, 2);
    const miles = [0.5, 1, 1.5].map(capeFronthaulMiles);
    expect(miles[0]).toBeCloseTo(miles[1], 6);
    expect(miles[2]).toBeCloseTo(miles[1], 6);
    const more = equilibrium('cape', { month: 6, routeScale: { 'C-TUB-QIN': 1.5, 'C-TUB-ROT': 1.5, 'C-PHE-QIN': 1 }, closed: [] });
    expect(more.ballastMileCost).toBeCloseTo(226.4, 0);
  });
});

describe('shipping 5.3', () => {
  it('describes the challenge’s winners by the ships due within the year, not the whole orderbook', () => {
    expect(SOLUTIONS53).toEqual([15, 127, 128, 129, 130, 131]);
    expect(Math.min(...DUE_WINNERS)).toBeCloseTo(0.002, 3);
    expect(Math.max(...DUE_WINNERS)).toBeCloseTo(0.031, 3);
    expect(DUE_AVERAGE).toBeCloseTo(0.041, 3);
    expect(Math.max(...DUE_WINNERS)).toBeLessThan(DUE_AVERAGE);
    expect(Math.min(...BOOK_WINNERS)).toBeCloseTo(0.08, 3);
    expect(Math.max(...BOOK_WINNERS)).toBeCloseTo(0.146, 3);
    expect(BOOK_AVERAGE).toBeCloseTo(0.118, 3);
    for (const t of SOLUTIONS53) expect(growthAfter(t).cargo).toBeGreaterThan(growthAfter(t).fleet);
    expect(growthAfter(15).cargo).toBeCloseTo(0.142, 3);
    expect(growthAfter(15).fleet).toBeCloseTo(0.025, 3);
  });

  it('compares period hire with the month’s index at the Year 3 top and in the Year 9 slump', () => {
    const index = dailyIndex('kmax');
    const boom = periodCharter('kmax', index, 27, 12, 0).hire;
    const slump = periodCharter('kmax', index, 96, 12, 0).hire;
    expect(boom).toBeCloseTo(24_540, -1);
    expect(monthAverage(index, 27)).toBeCloseTo(43_306, -1);
    expect(slump).toBeCloseTo(13_752, -1);
    expect(monthAverage(index, 96)).toBeCloseTo(4_906, -1);
    // April of Year 3 is the top of that boom.
    const y3 = Array.from({ length: 12 }, (_, k) => monthAverage(index, 24 + k));
    expect(y3.indexOf(Math.max(...y3))).toBe(3);
  });

  it('starts the challenge unsolved and shows that few ships due isn’t enough without growing cargo', () => {
    expect(fleetSurpriseSolved(START53)).toBe(false);
    expect(fleetSurpriseSolved({ ...START53, fleet: 5 })).toBe(false);
    expect(fleetSurpriseSolved({ ...START53, start: 128, fleet: 5 })).toBe(true);
    expect(fleetSurpriseSolved({ ...START53, start: 128, fleet: 5, wait: 0.5 })).toBe(false);
    expect(fleetSurpriseSolved({ ...START53, start: 126, fleet: 5 })).toBe(false);
    // The Year 8 stretch: under 1% due (as the readout rounds it) from the end of Year 7, October to Year 8, October.
    expect(LOW_DUE_Y8).toEqual(Array.from({ length: 13 }, (_, k) => 81 + k));
    for (const t of LOW_DUE_Y8) expect(dueWithinYear(t)).toBeLessThan(0.0095);
    expect(dueWithinYear(80)).toBeGreaterThanOrEqual(0.0095);
    expect(dueWithinYear(94)).toBeGreaterThanOrEqual(0.0095);
    expect(LOW_DUE_Y8_RESULTS.every((x) => x < 0)).toBe(true);
    expect(Math.max(...LOW_DUE_Y8_RESULTS)).toBeCloseTo(-440_000, -4);
    expect(Math.min(...LOW_DUE_Y8_RESULTS)).toBeCloseTo(-2_740_000, -4);
    for (const t of LOW_DUE_Y8) expect(growthAfter(t).cargo).toBeLessThan(0.002);
  });

  it('drops the unused hire and length sliders and shows the yards and the trades in the readouts', () => {
    const view = render(createElement(L53));
    const fig = view.container.querySelector('figure[aria-label="Time Charter Arbitrage Lab"]')!;
    const text = fig.textContent ?? '';
    expect(text).not.toContain('Hire against the forward strip');
    expect(text).not.toContain('Length of the charter');
    expect(text).toContain('due from the yards within the year');
    expect(text).toContain('cargo growth over the year');
    cleanup();
  });
});

describe('shipping 5.4', () => {
  it('asks for the weakest harvest at which the April freight credits the whole ballast leg', () => {
    expect(WEAKEST_FULL).toBe(0.8);
    expect(APRIL_CHINA).toBeCloseTo(27.4, 1);
    expect(harvestSolved(DEFAULTS54)).toBe(false);
    expect(harvestSolved({ ...DEFAULTS54, month: 2 })).toBe(false);
    expect(SOY_GRID.filter((soy) => harvestSolved({ ...DEFAULTS54, month: 2, soy }))).toEqual([0.8]);
    expect(harvestSolved({ ...DEFAULTS54, month: 1, soy: 0.8 })).toBe(false);
    // Each step weaker removes about six of the ships Santos draws from China: 27 → 21 → … → 3 → none.
    const at = (soy: number) => fixCredit({ ...DEFAULTS54, month: 2, soy });
    expect(at(1).month).toBe(3);
    expect(at(1).china - at(0.95).china).toBeCloseTo(6.2, 1);
    expect(at(0.8).full).toBe(true);
    expect(at(0.8).china).toBeCloseTo(2.7, 1);
    expect(at(0.8).diff).toBeCloseTo(890, -1);
    expect(at(0.75).full).toBe(false);
    expect(at(0.75).china).toBe(0);
    expect(at(0.75).miles).toBeCloseTo(10_906, 0);
    expect(at(0.75).diff).toBeCloseTo(321, 0);
    for (const soy of SOY_GRID) expect(at(soy).full).toBe(soy >= 0.8 - 1e-9);
    // Full credit always comes with ships drawn from China, and only then.
    for (const soy of SOY_GRID) expect(at(soy).full).toBe(at(soy).china > 0.05);
  });

  it('asks in which month free news is worth most: April, where the plans are closest', () => {
    expect(freeNewsSolved(FLEX_DEFAULTS)).toBe(false);
    expect(FLEX_DEFAULTS.month).toBe(1);
    expect(FREE_NEWS_BEST).toBe(3);
    expect(CLOSEST).toBe(3);
    expect(FREE_NEWS[3]).toBeCloseTo(736, -1);
    expect(FREE_NEWS[1]).toBeLessThan(5);
    expect(FREE_NEWS[3] / FREE_NEWS_RUNNER_UP).toBeGreaterThan(3);
    expect(freeNewsSolved({ month: 3, vol: 0.2, wait: 0 })).toBe(true);
    for (const month of [2, 4]) expect(freeNewsSolved({ month, vol: 0.2, wait: 0 })).toBe(false);
    expect(freeNewsSolved({ month: 3, vol: 0.2, wait: 1 })).toBe(false);
    expect(freeNewsSolved({ month: 3, vol: 0.15, wait: 0 })).toBe(false);
    // The walk-through: three days cost $734 a day in February, earn $199 in April; five days cost $243.
    expect(FEB3.mean.reposition).toBeGreaterThan(FEB3.mean.stay);
    expect(FEB3.value).toBeCloseTo(-734, 0);
    expect(APRIL.value).toBeCloseTo(199, 0);
    expect(APRIL5.value).toBeCloseTo(-243, 0);
  });

  it('explains the flat speed effect: both plans move together', () => {
    const [p10, p12, p14] = [10, 12, 14].map((speed) => comparePlans({ ...DEFAULTS54, month: 1, speed }));
    expect(p10.diff).toBeCloseTo(3_315, -1);
    expect(p14.diff).toBeCloseTo(3_478, -1);
    expect(p12.stay.tce - p10.stay.tce).toBeCloseTo(1_168, -1);
    expect(p12.repo.tce - p10.repo.tce).toBeCloseTo(1_506, -1);
    expect(Math.abs(p12.diff - p10.diff)).toBeLessThan(p12.stay.tce - p10.stay.tce);
  });
});

describe('shipping 5.5', () => {
  it('finds the fundamentals rule’s edge without the orderbook, and defines its Sharpe ratio', () => {
    const fund = labRun({ ...DEFAULT_LAB, strategy: 'fundamental' });
    const noDel = fundamentalsWithoutDeliveries();
    expect(fund.all.total / 1e6).toBeCloseTo(3.646, 2);
    expect(fund.traded).toBe(68);
    expect(noDel.total / 1e6).toBeCloseTo(3.634, 2);
    expect(noDel.traded).toBe(70);
    expect(fund.all.mean).toBeCloseTo(25_676, -1);
    expect(fund.all.stdev).toBeCloseTo(65_802, -1);
    expect(fund.all.sharpe).toBeCloseTo((fund.all.mean / fund.all.stdev) * Math.sqrt(12), 9);
    expect(fund.all.sharpe).toBeCloseTo(1.35, 2);
  });

  it('loses on the season because the curve prices in more of it than arrives, not because of fees', () => {
    const r = labRun({ ...DEFAULT_LAB, strategy: 'seasonal' });
    const buys = r.trades.filter((t) => t.side === 'buy');
    const sells = r.trades.filter((t) => t.side === 'sell');
    expect(mean(buys.map((t) => t.price))).toBeCloseTo(23_348, -1);
    expect(mean(buys.map((t) => t.settlement))).toBeCloseTo(22_178, -1);
    expect(mean(sells.map((t) => t.price))).toBeCloseTo(10_447, -1);
    expect(mean(sells.map((t) => t.settlement))).toBeCloseTo(10_891, -1);
    expect((r.all.total + r.fees) / 1e6).toBeCloseTo(-2.165, 2);
    expect(r.fees / 1e6).toBeCloseTo(0.112, 2);
  });

  it('leaves the spread of monthly earnings almost unchanged with the owner’s hedge', () => {
    const h = labRun({ ...DEFAULT_LAB, strategy: 'hedge' });
    const physical = h.trades.map((t) => t.settlement * 30);
    const hedged = physical.map((x, i) => x + h.pnl[i]);
    expect(stdev(physical)).toBeCloseTo(291_008, -1);
    expect(stdev(hedged)).toBeCloseTo(290_686, -1);
    expect(stdev(hedged) / stdev(physical)).toBeGreaterThan(0.99);
  });

  it('mirrors the threshold slider into the other-worlds figure, sharing the first figure’s state', async () => {
    window.localStorage.clear();
    const view = render(createElement(L55));
    const worlds = view.container.querySelector('figure[aria-label="Freight Trading Lab · other worlds"]')!;
    const main = view.container.querySelector('figure[aria-label="Freight Trading Lab"]')!;
    const slider = (fig: Element) =>
      Array.from(fig.querySelectorAll<HTMLInputElement>('input[type="range"]')).find((i) => fig.querySelector(`label[for="${i.id}"]`)?.textContent === 'Threshold')!;
    expect(slider(worlds)).toBeTruthy();
    const reversion = Array.from(worlds.querySelectorAll('button')).find((b) => b.textContent === 'Mean reversion')!;
    await act(async () => {
      fireEvent.click(reversion);
    });
    expect(slider(worlds).disabled).toBe(false);
    await act(async () => {
      fireEvent.change(slider(worlds), { target: { value: '45' } });
    });
    expect(slider(main).value).toBe('45');
    cleanup();
  });
});
