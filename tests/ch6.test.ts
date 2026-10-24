// Chapter 6: trading engines, the numbers quoted in the lessons' prose (at default settings),
// reachability of every challenge, and no NaN/Infinity anywhere at slider extremes.

import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { standardHistory } from '../src/model/history';
import { describe as describeSample, histogram, quantile } from '../src/engines/strategy/distribution';
import { bookExposure, bookHistory, bookPnL, type Book } from '../src/engines/strategy/positions';
import { backtestVirtuals, forecastSpreads, peakForecast, settleVirtuals, spreadsByHour, virtualPositions } from '../src/engines/strategy/spreads';
import { basis, congestion, ftrDaily, knownDayAhead, matches, meanByHour, meanWindForecast, spreadPositionDaily } from '../src/engines/strategy/basis';
import { batteryDay, batteryHistory, forecastBatteryPnL, levelsFor, ruleSchedule } from '../src/engines/strategy/batteryTrading';
import { optimizeArbitrage } from '../src/engines/strategy/arbitrage';
import { solveLP, type Sense } from '../src/engines/market/lp';
import {
  EVENING_HOURS,
  OFF_PEAK_HOURS,
  ON_PEAK_HOURS,
  averageLoad,
  averagePrice,
  dailyMargin,
  hedgedMW,
  hourlyMargin,
  portfolioHistory,
  type RetailBook,
} from '../src/engines/strategy/hedging';
import { LAB_SPLIT, LAB_START, applyStopLoss, drawdownSeries, labDailyPnL, splitTotals } from '../src/engines/strategy/lab';
import { maxDrawdown, summarize, valueAtRisk } from '../src/engines/strategy/risk';

const H = standardHistory();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => sum(xs) / xs.length;
/** Days 73 and 120: the two evenings when the real-time price passed $2,000. */
const SPIKES = [72, 119];
const withoutSpikes = <T,>(xs: T[]) => xs.filter((_, i) => !SPIKES.includes(i));

// ---------------------------------------------------------------------------
describe('distribution engine', () => {
  it('computes quantiles, summaries and histograms', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(quantile([], 0.5)).toBe(0);
    const d = describeSample([1, 2, 3, 4, 100]);
    expect(d.median).toBe(3);
    expect(d.mean).toBeCloseTo(22);
    expect(describeSample([]).n).toBe(0);
    const hg = histogram([-5, 0, 0.5, 1.5, 9, 10, 12], 0, 10, 5);
    expect(hg.counts).toEqual([3, 0, 0, 0, 1]);
    expect(hg.below).toBe(1);
    expect(hg.above).toBe(2);
  });
});

describe('positions engine (6.1)', () => {
  const base: Book = { genMW: 400, genCost: 36, flexible: false, incMW: 0, cfdMW: 0, strike: 42 };
  it('adds legs and measures exposure', () => {
    expect(bookPnL(base, 40, 50).total).toBe(400 * 14);
    expect(bookExposure(base)).toBe(400);
    const hedged = { ...base, incMW: 400 };
    expect(bookExposure(hedged)).toBe(0);
    for (const rt of [-20, 0, 40, 150, 2000]) expect(bookPnL(hedged, 40, rt).total).toBeCloseTo(1600);
    const cfd = { ...base, cfdMW: 400 };
    for (const rt of [-20, 40, 150]) expect(bookPnL(cfd, 40, rt).total).toBeCloseTo(2400);
  });
  it('a flexible plant never loses money on its own', () => {
    const flex = { ...base, flexible: true };
    expect(bookPnL(flex, 40, 10).total).toBe(0);
    expect(bookPnL(flex, 40, 50).total).toBe(400 * 14);
  });
  it('the $1,200 challenge is reachable and the default is not flat', () => {
    const at = (b: Book) => Array.from({ length: 69 }, (_, i) => bookPnL(b, 40, -20 + 2.5 * i).total);
    const ok = at({ ...base, genMW: 300, incMW: 300 });
    expect(Math.max(...ok) - Math.min(...ok)).toBeLessThan(0.5);
    expect(ok[0]).toBeCloseTo(1200);
    const alt = at({ ...base, genMW: 200, cfdMW: 200 });
    expect(alt[10]).toBeCloseTo(1200);
    const def = at(base);
    expect(Math.max(...def) - Math.min(...def)).toBeGreaterThan(1);
    // Over the sliders' whole range, only Lakeside at 100–300 MW can be flat at $1,200 — so the
    // question says the plant needn't run at full output.
    const gens = new Set<number>();
    for (const flexible of [false, true])
      for (let genMW = 0; genMW <= 400; genMW += 10)
        for (let incMW = -300; incMW <= 300; incMW += 10)
          for (let cfdMW = -400; cfdMW <= 400; cfdMW += 10) {
            const c = at({ ...base, genMW, incMW, cfdMW, flexible });
            if (Math.max(...c) - Math.min(...c) < 0.5 && Math.abs(c[0] - 1200) < 0.5) gens.add(genMW);
          }
    expect(Math.min(...gens)).toBe(100);
    expect(Math.max(...gens)).toBe(300);
    expect(gens.has(400)).toBe(false);
  });
  it('matches the description of the history', () => {
    const temps = H.map((d) => d.temp);
    expect(Math.round(avg(temps.slice(0, 30)))).toBe(16);
    expect(Math.round(avg(temps.slice(90)))).toBe(27);
    expect(Math.min(...H.map((d) => d.gas))).toBe(0.85);
    expect(Math.max(...H.map((d) => d.gas))).toBe(1.48);
    const spikes = H.filter((d) => Math.max(...d.rt) > 2000);
    expect(spikes.map((d) => d.day + 1)).toEqual([73, 120]);
    for (const d of spikes) {
      expect(d.outages.length).toBeGreaterThan(0);
      expect(d.rt.indexOf(Math.max(...d.rt))).toBeGreaterThanOrEqual(17);
    }
    expect(Math.max(...H.flatMap((d) => d.da))).toBeLessThan(2000);
  });
  it('matches the prose at 17:00', () => {
    const run = (b: Partial<Book>) => bookHistory(H, { ...base, ...b }, 17, 36).map((x) => x.total);
    const gen = run({});
    expect(Math.round(avg(gen))).toBe(2595);
    expect(gen.filter((v) => v < 0).length).toBe(35);
    expect(Math.round(Math.max(...gen))).toBe(109800);
    expect(gen.indexOf(Math.max(...gen))).toBe(72);
    expect(Math.round(H[72].rt[17])).toBe(325);
    const top3 = [...gen].sort((a, b) => b - a).slice(0, 3);
    expect(Math.round((100 * sum(top3)) / sum(gen))).toBe(61);
    expect(Math.round(avg(withoutSpikes(gen)))).toBe(1100);
    const genCfd = run({ cfdMW: 400 });
    expect(Math.round(Math.min(...genCfd))).toBe(-4512);
    expect(genCfd.indexOf(Math.min(...genCfd))).toBe(70);
    expect(H[70].gas).toBe(1.48);
    expect(Math.round(Math.min(...run({ incMW: 400 })))).toBe(-68);
    const inc = run({ genMW: 0, incMW: 300 });
    expect(inc.filter((v) => v > 0).length).toBe(53);
    expect(inc.filter((v) => v < 0).length).toBe(67);
    expect(Math.round(Math.min(...inc))).toBe(-79002);
    expect(inc.indexOf(Math.min(...inc))).toBe(72);
    // The counterexample: a 300 MW dec, long the spike, pays mostly because of days 73 and 120.
    const dec = run({ genMW: 0, incMW: -300 });
    expect(dec.filter((v) => v > 0).length).toBe(67);
    expect(Math.round(avg(dec))).toBe(1245);
    expect(Math.round(avg(withoutSpikes(dec)))).toBe(162);
  });
});

describe('spreads engine (6.2)', () => {
  it('settles decs as RT − DA and incs as DA − RT, minus costs', () => {
    const d = H[0];
    const pos = Array<number>(24).fill(0);
    pos[19] = 10;
    expect(settleVirtuals(pos, d, 0.5)).toBeCloseTo(10 * (d.rt[19] - d.da[19]) - 5);
    pos[19] = -10;
    expect(settleVirtuals(pos, d, 0.5)).toBeCloseTo(10 * (d.da[19] - d.rt[19]) - 5);
    expect(virtualPositions([5, -5, 0.5], 1, 10, [0, 1, 2])).toEqual([10, -10, 0]);
    expect(forecastSpreads([], 'mean').every((v) => v === 0)).toBe(true);
  });
  it('walks forward without peeking', () => {
    const s = { rule: 'mean' as const, window: 10, threshold: 1, mw: 10, costPerMWh: 0.5 };
    const a = backtestVirtuals(H, s);
    const tampered = H.map((d, i) => (i === 50 ? { ...d, rt: d.rt.map((p) => p + 1000) } : d));
    const b = backtestVirtuals(tampered, s);
    // Positions up to and including day 50 can't depend on day 50's real-time prices.
    for (let i = 0; i <= 50 - a.firstIndex; i++) expect(b.positions[i]).toEqual(a.positions[i]);
  });
  it('matches the prose about the distribution', () => {
    const all = spreadsByHour(H).flat();
    expect(all.length).toBe(2880);
    expect(quantile(all, 0.5)).toBe(0);
    expect(all.filter((v) => v > 0).length).toBe(1439);
    expect(all.filter((v) => v < 0).length).toBe(1437);
    expect(Math.round((100 * all.filter((v) => Math.abs(v) <= 5).length) / all.length)).toBe(85);
    const h19 = describeSample(spreadsByHour(H)[19]);
    expect(h19.median.toFixed(2)).toBe('0.46');
    expect(h19.mean.toFixed(2)).toBe('47.97');
    expect(Math.round(h19.max)).toBe(2022);
    expect(spreadsByHour(H)[19].filter((v) => v >= 30).length).toBe(18);
    expect(spreadsByHour(H)[19].filter((v) => v < -30).length).toBe(5);
    expect(Math.round(h19.min)).toBe(-161);
    // Without days 73 and 120, 19:00's mean spread is $14.88: those two days supply over two-thirds of its total.
    const calm19 = withoutSpikes(spreadsByHour(H)[19]);
    expect(avg(calm19).toFixed(2)).toBe('14.88');
    expect(1 - sum(calm19) / sum(spreadsByHour(H)[19])).toBeGreaterThan(2 / 3);
    const cells = H.flatMap((d) => d.da.map((p, h) => ({ v: d.rt[h] - p, d: d.day, h })));
    const top = [...cells].sort((x, y) => Math.abs(y.v) - Math.abs(x.v)).slice(0, 29);
    expect(Math.round(sum(top.map((c) => c.v)))).toBe(16759);
    expect(Math.round(sum(all))).toBe(17298);
    expect(((17298 - 16759) / (2880 - 29)).toFixed(2)).toBe('0.19');
    expect(top.every((c) => c.h >= 17 && c.h <= 21)).toBe(true);
    expect(new Set(top.map((c) => c.d)).size).toBe(11);
    expect(H.filter((d) => d.outages.length > 0).length).toBe(15);
    // Outages drive the tail: 9 of its 11 days had one (both $2,000 evenings lost Mill Creek), and
    // those days carry essentially all of the tail's total.
    const tailDays = [...new Set(top.map((c) => c.d))];
    expect(tailDays.filter((i) => H[i].outages.length > 0).length).toBe(9);
    expect(H[72].outages).toEqual(['cc2']);
    expect(H[119].outages).toEqual(['cc2']);
    expect(sum(top.filter((c) => H[c.d].outages.length > 0).map((c) => c.v)) / sum(top.map((c) => c.v))).toBeGreaterThan(0.99);
    const calm = tailDays.filter((i) => H[i].outages.length === 0);
    expect(calm.map((i) => i + 1).sort((a, b) => a - b)).toEqual([100, 115]);
    expect(calm.map((i) => Math.abs(Math.round((100 * H[i].demand[19]) / H[i].demandForecast[19] - 100))).sort()).toEqual([2, 6]);
    for (const i of calm) expect(Math.abs(H[i].rt[19] - H[i].da[19])).toBeGreaterThan(100);
  });
  it('matches the prose about the backtests, and the challenge is reachable', () => {
    const def = backtestVirtuals(H, { rule: 'median', window: 10, threshold: 1, mw: 10, costPerMWh: 0.5 });
    expect(Math.round(sum(def.pnl))).toBe(-28350);
    const wi = def.pnl.indexOf(Math.min(...def.pnl));
    expect(Math.round(def.pnl[wi])).toBe(-42260);
    expect(wi + def.firstIndex).toBe(119);
    expect([17, 18, 19].every((h) => def.positions[wi][h] < 0)).toBe(true);

    const good = backtestVirtuals(H, { rule: 'mean', window: 30, threshold: 2, mw: 10, costPerMWh: 1 });
    const total = sum(good.pnl);
    const ranked = good.pnl.map((v, i) => ({ v, day: i + good.firstIndex })).sort((x, y) => y.v - x.v);
    expect(Math.round(total)).toBe(127343);
    expect(ranked.slice(0, 2).map((r) => r.day)).toEqual([119, 72]);
    expect(Math.round(ranked[0].v + ranked[1].v)).toBe(107633);
    expect(Math.round(total - ranked[0].v - ranked[1].v)).toBe(19710);
    expect(good.tradedDays).toBe(90);
    expect(good.pnl.filter((v, i) => good.positions[i].some((x) => x !== 0) && v > 0).length).toBe(37);
    const tailDays = [102, 2, 50, 37, 29, 114, 24, 99, 65];
    const rest = good.pnl.filter((_, i) => ![119, 72, ...tailDays].includes(i + good.firstIndex));
    expect(Math.round(sum(rest))).toBe(22);
    expect(H.filter((d) => peakForecast(d) >= 1500).length).toBe(41);
  });
  // The lesson's predicate: after costs of at least $1, positive, and at least $10,000 without its two best days.
  const challenge = (bt: ReturnType<typeof backtestVirtuals>, cost: number) => {
    const total = sum(bt.pnl);
    const best2 = [...bt.pnl].sort((a, b) => b - a).slice(0, 2).filter((v) => v > 0);
    return cost >= 1 && bt.tradedDays >= 20 && total > 0 && total - sum(best2) >= 10000;
  };
  it('the challenge: default unsolved, the trailing mean solves it', () => {
    expect(challenge(backtestVirtuals(H, { rule: 'median', window: 10, threshold: 1, mw: 10, costPerMWh: 0.5 }), 0.5)).toBe(false);
    expect(challenge(backtestVirtuals(H, { rule: 'median', window: 10, threshold: 1, mw: 10, costPerMWh: 1 }), 1)).toBe(false);
    expect(challenge(backtestVirtuals(H, { rule: 'mean', window: 30, threshold: 2, mw: 10, costPerMWh: 1 }), 1)).toBe(true);
  });
  it('the challenge: no trailing median solves it, as the success text says', () => {
    // Positions don't depend on the cost, and every day's P&L falls as the cost rises, so $1 is the easiest case.
    // A higher threshold trades a subset of the same hours, so once fewer than 20 days trade, higher thresholds can't solve it either.
    const filters = [undefined, (d: (typeof H)[number]) => peakForecast(d) >= 1500, (d: (typeof H)[number]) => d.gas >= 1.2];
    for (const filter of filters)
      for (let window = 5; window <= 60; window++)
        for (let threshold = 0; threshold <= 20; threshold += 0.5) {
          const bt = backtestVirtuals(H, { rule: 'median', window, threshold, mw: 10, costPerMWh: 1, filter });
          expect(challenge(bt, 1)).toBe(false);
          if (bt.tradedDays < 20) break;
        }
  }, 60000);
});

describe('basis engine (6.3)', () => {
  it('measures congestion in the usual direction', () => {
    for (const d of H) {
      expect(congestion(d, 'metro', 'da').every((v) => v >= -1e-9)).toBe(true);
      expect(congestion(d, 'north', 'da').every((v) => v >= -1e-9)).toBe(true);
    }
    const be = avg(H.flatMap((d) => EVENING_HOURS.map((h) => congestion(d, 'metro', 'da')[h])));
    expect(Math.abs(sum(ftrDaily(H, 'metro', EVENING_HOURS, 10, be)))).toBeLessThan(1e-6);
    expect(knownDayAhead({ kind: 'outage', level: 0 })).toBe(false);
    expect(knownDayAhead({ kind: 'windy', level: 150 })).toBe(true);
  });
  it('matches the prose about North and Metro', () => {
    const NIGHT = [0, 1, 2, 3, 4, 5];
    const AFT = [12, 13, 14, 15, 16];
    const night = (ds: typeof H) => avg(NIGHT.map((h) => meanByHour(ds, (d) => basis(d, 'north', 'da'))[h]));
    expect(night(H).toFixed(2)).toBe('-0.61');
    expect(H.filter((d) => basis(d, 'north', 'da').some((v) => v < -0.01)).length).toBe(4);
    expect(H.reduce((s, d) => s + basis(d, 'north', 'da').filter((v) => v < -0.01).length, 0)).toBe(30);
    expect(Math.min(...H.flatMap((d) => d.daNorth))).toBe(-5);
    const w200 = H.filter((d) => matches(d, { kind: 'windy', level: 200 }));
    expect(w200.length).toBe(6);
    expect(night(w200)).toBeLessThanOrEqual(-10);
    expect(night(H.filter((d) => meanWindForecast(d) >= 190))).toBeGreaterThan(-10);
    // Challenge a: 200 MW is the lowest level on the slider (50–300 in steps of 10) at which the belief holds.
    const holds = (level: number) => {
      const ds = H.filter((d) => matches(d, { kind: 'windy', level }));
      return ds.length > 0 && night(ds) <= -10;
    };
    const levels = Array.from({ length: 26 }, (_, i) => 50 + 10 * i);
    expect(levels.find(holds)).toBe(200);
    expect(holds(150)).toBe(false); // the default level is unsolved
    // On outage days, Metro's afternoon premium is far larger in real time than day-ahead.
    const out = H.filter((d) => matches(d, { kind: 'outage', level: 0 }));
    expect(out.length).toBe(15);
    const metroAft = (m: 'da' | 'rt') => avg(AFT.map((h) => meanByHour(out, (d) => basis(d, 'metro', m))[h]));
    expect(metroAft('da').toFixed(2)).toBe('13.33');
    expect(metroAft('rt').toFixed(2)).toBe('43.02');
    const metro = (ds: typeof H, hs: number[]) => avg(hs.map((h) => meanByHour(ds, (d) => basis(d, 'metro', 'da'))[h]));
    expect(metro(H, AFT).toFixed(2)).toBe('11.79');
    expect(metro(H, EVENING_HOURS).toFixed(2)).toBe('24.11');
    const hot = H.filter((d) => matches(d, { kind: 'demand', level: 1500 }));
    expect(hot.length).toBe(41);
    expect(metro(hot, AFT).toFixed(2)).toBe('8.98');
    expect(metro(hot, EVENING_HOURS).toFixed(2)).toBe('58.90');
    // Metro is congested day-ahead exactly when forecast demand exceeds about 1,018 MW.
    for (const d of H)
      d.demandForecast.forEach((D, h) => {
        if (D <= 1018) expect(d.daMetro[h]).toBe(d.da[h]);
      });
  });
  it('matches the prose about the positions, and both challenges are reachable', () => {
    const ftr15 = ftrDaily(H, 'metro', EVENING_HOURS, 10, 15);
    expect(Math.round(sum(ftr15))).toBe(54658);
    let run = 0;
    const cum = ftr15.map((v) => (run += v));
    expect(cum.indexOf(Math.min(...cum)) + 1).toBe(66);
    const daily = H.map((d) => avg(EVENING_HOURS.map((h) => congestion(d, 'metro', 'da')[h])));
    expect(daily.filter((v) => v > 24.11).length).toBe(45);
    expect(Math.round(sum(spreadPositionDaily(H, 'metro', EVENING_HOURS, 10, { kind: 'demand', level: 1500 }, 0.5)))).toBe(-24310);
    const aft = spreadPositionDaily(H, 'metro', [12, 13, 14, 15, 16], 10, { kind: 'all', level: 0 }, 0.5);
    expect(Math.round(sum(aft))).toBe(15112);
    const cc2 = H.map((d, i) => (d.outages.includes('cc2') ? aft[i] : 0));
    expect(H.filter((d) => d.outages.includes('cc2')).length).toBe(6);
    expect(Math.round(sum(cc2))).toBe(22553);
    expect(sum(aft) - sum(cc2)).toBeCloseTo(-7441, 0);
  });
  it('challenge b: the FTR breaks even at the first figure’s average evening premium, to the nearest 25 cents', () => {
    const be = avg(H.flatMap((d) => EVENING_HOURS.map((h) => congestion(d, 'metro', 'da')[h])));
    // The first figure's Metro evening readout (day-ahead, every day) is the same number.
    expect(avg(EVENING_HOURS.map((h) => meanByHour(H, (d) => basis(d, 'metro', 'da'))[h]))).toBeCloseTo(be, 9);
    const solved = (price: number) => Math.abs(price - be) <= 0.125 + 1e-9;
    expect(solved(15)).toBe(false); // the default
    const answers = Array.from({ length: 161 }, (_, i) => i * 0.25).filter(solved);
    expect(answers).toEqual([24]);
    expect(sum(ftrDaily(H, 'metro', EVENING_HOURS, 10, 24))).toBeGreaterThan(0);
    expect(sum(ftrDaily(H, 'metro', EVENING_HOURS, 10, 24.25))).toBeLessThan(0);
  });
});

describe('battery trading engine (6.4)', () => {
  const b = { powerMW: 100, energyMWh: 400, efficiency: 0.85, soc0: 0 };
  it('keeps the rule within power and energy limits', () => {
    for (const d of [H[0], H[60], H[116]]) {
      const r = ruleSchedule(d.da, b, 4, 5);
      expect(r.schedule.every((mw) => Math.abs(mw) <= 100 + 1e-9)).toBe(true);
      expect(r.soc.every((e) => e >= -1e-9 && e <= 400 + 1e-9)).toBe(true);
    }
    expect(levelsFor(b, 30)).toBe(121);
    expect(levelsFor({ ...b, powerMW: 0 }, 30)).toBeGreaterThanOrEqual(6);
  });
  it('matches the prose for day 61 and the challenge is reachable', () => {
    const d = H[60];
    const L = levelsFor(b, 30);
    const opt = optimizeArbitrage(d.da, b, { degradationPerMWh: 5, levels: L });
    expect(Math.round(opt.profit)).toBe(8513);
    expect(opt.cycles.toFixed(2)).toBe('1.90');
    expect(Math.round(ruleSchedule(d.da, b, 4, 5).profit)).toBe(4960);
    expect((d.da[8] - 28 / 0.85).toFixed(2)).toBe('13.63');
    expect((Math.max(...d.da) - 28 / 0.85).toFixed(2)).toBe('22.40');
    expect((d.da[8] - 28 / 0.7).toFixed(2)).toBe('6.57');
    const sells = (wear: number, hs: number[]) => {
      const o = optimizeArbitrage(d.da, b, { degradationPerMWh: wear, levels: L });
      return hs.some((h) => o.schedule[h] > 0.5);
    };
    const MORNING = [6, 7, 8, 9, 10, 11];
    // The prose gives the prices; the reader computes the margins.
    expect(Math.min(...d.da)).toBe(28);
    expect(Math.max(...MORNING.map((h) => d.da[h])).toFixed(2)).toBe('46.57');
    expect(Math.max(...EVENING_HOURS.map((h) => d.da[h])).toFixed(2)).toBe('55.34');
    // The challenge: the smallest whole-dollar wear that skips the morning but still sells in the evening.
    const smallest = (bb: typeof b) => {
      const LL = levelsFor(bb, 30);
      const s2 = (wear: number, hs: number[]) => hs.some((h) => optimizeArbitrage(d.da, bb, { degradationPerMWh: wear, levels: LL }).schedule[h] > 0.5);
      for (let wear = 1; wear <= 40; wear++) if (!s2(wear, MORNING) && s2(wear, EVENING_HOURS) && s2(wear - 1, MORNING)) return wear;
      return -1;
    };
    expect(sells(5, MORNING)).toBe(true); // default: not solved
    expect(sells(13, MORNING)).toBe(true);
    expect(sells(14, MORNING)).toBe(false);
    expect(sells(14, EVENING_HOURS)).toBe(true);
    expect(smallest(b)).toBe(14);
    // It is the margin rounded up, at other efficiencies too: the equation predicts it.
    for (const eff of [0.7, 0.95]) expect(smallest({ ...b, efficiency: eff })).toBe(Math.ceil(46.57 - 28 / eff));
    expect(smallest({ ...b, energyMWh: 800 })).toBe(14);
  });
  it('matches the prose for the 120 days', () => {
    // The 120-day figure uses 12 state-of-charge steps per hour of duration.
    const L = levelsFor(b, 12);
    const hist = batteryHistory(H, b, 5, L);
    const tot = (k: 'daOptimal' | 'rule' | 'daPlanAtRt' | 'rtOptimal') => sum(hist.map((x) => x[k]));
    expect(Math.round(tot('daOptimal'))).toBe(783469);
    expect(Math.round(tot('rule'))).toBe(663878);
    expect(Math.round((100 * tot('rule')) / tot('daOptimal'))).toBe(85);
    expect(Math.round(tot('daPlanAtRt'))).toBe(2306696);
    expect((tot('daPlanAtRt') / tot('daOptimal')).toFixed(1)).toBe('2.9');
    expect(Math.round(tot('rtOptimal'))).toBe(2584733);
    expect(((tot('daOptimal') * 365) / 120 / 100000).toFixed(2)).toBe('23.83');
    expect(Math.round(hist[72].daPlanAtRt + hist[119].daPlanAtRt)).toBe(1298555);
    // Without days 73 and 120 the real-time plan earns less than those two days did, but still more than day-ahead.
    const calm = withoutSpikes(hist);
    expect(Math.round(sum(calm.map((x) => x.daPlanAtRt)))).toBe(1008141);
    expect(Math.round(sum(calm.map((x) => x.daOptimal)))).toBe(723980);
    expect(hist[72].daPlanAtRt + hist[119].daPlanAtRt).toBeGreaterThan(sum(calm.map((x) => x.daPlanAtRt)));
    expect(hist.filter((x) => x.daPlanAtRt < x.daOptimal).length).toBe(74);
    const wear20 = batteryHistory(H, b, 20, L);
    expect(wear20.filter((x) => x.cycles < 0.01).length).toBe(74);
    expect(sum(wear20.map((x) => x.rule))).toBeLessThan(0.1 * tot('rule'));
    const eight = { ...b, energyMWh: 800 };
    const t8 = sum(batteryHistory(H, eight, 5, levelsFor(eight, 12)).map((x) => x.daOptimal));
    expect(Math.round(100 * (t8 / tot('daOptimal') - 1))).toBe(14);
    // Profit scales exactly with power at a fixed duration, as the prose says (so the figure has no power control).
    const big = { ...b, powerMW: 200, energyMWh: 800 };
    const h200 = batteryHistory(H, big, 5, levelsFor(big, 12));
    for (const k of ['daOptimal', 'rule', 'daPlanAtRt', 'rtOptimal'] as const) expect(sum(h200.map((x) => x[k]))).toBeCloseTo(2 * tot(k), 3);
  });
  it('the 120-day grid is within 0.2% of the exact day-ahead optimum', () => {
    // The exact optimum as a linear program: charge c_t and discharge d_t, 0–100 MW, storage 0–400 MWh.
    const eta = Math.sqrt(0.85);
    const exact = (prices: number[]) => {
      const n = prices.length;
      const A: number[][] = [];
      const rhs: number[] = [];
      const sense: Sense[] = [];
      for (let t = 0; t < n; t++) {
        const row = Array.from({ length: 2 * n }, (_, j) => (j <= t ? eta : j >= n && j - n <= t ? -1 / eta : 0));
        A.push(row, row);
        rhs.push(400, 0);
        sense.push('<=', '>=');
      }
      const c = [...prices, ...prices.map((p) => -(p - 5))];
      return -solveLP({ c, A, b: rhs, sense, ub: Array<number>(2 * n).fill(100) }).objective;
    };
    const lp = sum(H.map((d) => exact(d.da)));
    const grid = sum(batteryHistory(H, b, 5, levelsFor(b, 12)).map((x) => x.daOptimal));
    expect(grid / lp).toBeGreaterThan(0.998);
    expect(grid / lp).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('stays finite at the sliders’ extremes', () => {
    for (const power of [10, 200])
      for (const hours of [1, 8])
        for (const eff of [0.6, 0.95])
          for (const wear of [0, 40]) {
            const bb = { powerMW: power, energyMWh: power * hours, efficiency: eff, soc0: 0 };
            const r = batteryDay(H[119], bb, wear, levelsFor(bb, 6));
            expect(Object.values(r).every(Number.isFinite)).toBe(true);
          }
    expect(Number.isFinite(forecastBatteryPnL([], H[0], b, 5, 0.5, 21))).toBe(true);
  });
});

describe('hedging engine (6.5)', () => {
  const SHARE = 0.2;
  const F_ON = averagePrice(H, ON_PEAK_HOURS) + 2;
  const F_OFF = averagePrice(H, OFF_PEAK_HOURS) + 2;
  const K = averagePrice(H, EVENING_HOURS) + 2;
  const book = (on: number, off: number, cfd: number): RetailBook => ({
    share: SHARE,
    retailPrice: 45,
    onPeakMW: on,
    offPeakMW: off,
    onPeakPrice: F_ON,
    offPeakPrice: F_OFF,
    cfdMW: cfd,
    cfdStrike: K,
  });
  const margins = (on: number, off: number, cfd: number) => portfolioHistory(H, book(on, off, cfd)).map((d) => d.margin);
  it('hourly and daily margins agree; hedges cost their premium on average', () => {
    const d = H[30];
    expect(sum(hourlyMargin(d, book(250, 170, 50)).map((x) => x.margin))).toBeCloseTo(dailyMargin(d, book(250, 170, 50)).margin);
    expect(hedgedMW(book(250, 170, 50))[19]).toBe(300);
    expect(hedgedMW(book(250, 170, 50))[3]).toBe(170);
    const diff = avg(margins(0, 0, 0)) - avg(margins(250, 170, 0));
    expect(diff).toBeCloseTo(2 * (250 * 16 + 170 * 8), 4);
  });
  it('matches the prose', () => {
    expect(F_ON.toFixed(2)).toBe('42.80');
    expect(F_OFF.toFixed(2)).toBe('31.12');
    expect(K.toFixed(2)).toBe('52.64');
    expect(Math.round(averageLoad(H, ON_PEAK_HOURS, SHARE))).toBe(247);
    expect(Math.round(averageLoad(H, OFF_PEAK_HOURS, SHARE))).toBe(168);
    const u = margins(0, 0, 0);
    expect(Math.round(avg(u))).toBe(32201);
    expect(u.filter((v) => v < 0).length).toBe(18);
    expect(Math.round(Math.min(...u))).toBe(-268847);
    expect(u.indexOf(Math.min(...u))).toBe(116);
    expect(Math.round(valueAtRisk(u))).toBe(52011);
    // VaR is the loss exceeded on 6 of the 120 days.
    expect(u.filter((v) => v < -valueAtRisk(u)).length).toBe(6);
    const d = H[116];
    expect(d.temp).toBe(33);
    expect(Math.round(d.da[18])).toBe(250);
    expect(Math.round(d.da[19])).toBe(461);
    expect(Math.round(d.demand[19] * SHARE)).toBe(342);
    expect(d.outages.length).toBe(0);
    const h = margins(250, 170, 0);
    expect(Math.round(h[116])).toBe(-41262);
    expect(Math.round(avg(h))).toBe(21481);
    const hot = H.filter((x) => Math.max(...x.demandForecast) >= 1500);
    const mild = H.filter((x) => Math.max(...x.demandForecast) < 1500);
    const eveLoad = (ds: typeof H) => avg(ds.map((x) => avg(EVENING_HOURS.map((hh) => SHARE * x.demand[hh]))));
    const eveDa = (ds: typeof H) => avg(ds.map((x) => avg(EVENING_HOURS.map((hh) => x.da[hh]))));
    expect(Math.round(eveLoad(hot))).toBe(298);
    expect(Math.round(eveLoad(mild))).toBe(266);
    expect(eveDa(hot).toFixed(2)).toBe('66.05');
    expect(eveDa(mild).toFixed(2)).toBe('42.64');
  });
  it('the challenge is reachable only with the evening CfD', () => {
    const ok = (m: number[]) => Math.min(...m) >= -20000 && avg(m) >= 24000;
    expect(ok(margins(0, 0, 0))).toBe(false);
    expect(ok(margins(200, 0, 150))).toBe(true);
    let withoutCfd = 0;
    for (let on = 0; on <= 400; on += 10) for (let off = 0; off <= 300; off += 10) if (ok(margins(on, off, 0))) withoutCfd++;
    expect(withoutCfd).toBe(0);
    // And none without an on-peak block: the CfD covers only five hours.
    let withoutOnPeak = 0;
    for (let off = 0; off <= 300; off += 10) for (let cfd = 0; cfd <= 200; cfd += 10) if (ok(margins(0, off, cfd))) withoutOnPeak++;
    expect(withoutOnPeak).toBe(0);
  });
});

describe('lab engine (6.6)', () => {
  it('applies stop-losses and drawdowns', () => {
    expect(drawdownSeries([10, -5, -10, 20])).toEqual([0, -5, -15, 0]);
    const r = applyStopLoss([10, -20, 5, 5, 5], 15, 2);
    expect(r.pnl).toEqual([10, -20, 0, 0, 5]);
    expect(r.stops).toBe(1);
    expect(applyStopLoss([1, -100], 0).pnl).toEqual([1, -100]);
    expect(splitTotals(Array<number>(120).fill(1))).toEqual({ inSample: LAB_SPLIT, outOfSample: 120 - LAB_SPLIT });
  });
  it('never trades before LAB_START and scales with the position limit', () => {
    for (const strategy of ['spread', 'basis', 'battery'] as const) {
      const one = labDailyPnL(H, { strategy, window: 20, threshold: 2, costPerMWh: 0.5, mw: 1 });
      const ten = labDailyPnL(H, { strategy, window: 20, threshold: 2, costPerMWh: 0.5, mw: 10 });
      expect(one.slice(0, LAB_START).every((v) => v === 0)).toBe(true);
      expect(sum(ten)).toBeCloseTo(10 * sum(one), 3);
      expect(one.every(Number.isFinite)).toBe(true);
    }
  });
  it('matches the prose', () => {
    const def = labDailyPnL(H, { strategy: 'spread', window: 5, threshold: 2, costPerMWh: 0.5, mw: 10 });
    expect(Math.round(sum(def))).toBe(-71851);
    expect(Math.round(splitTotals(def).inSample)).toBe(3908);
    expect(Math.round(def[119])).toBe(-63384);
    expect(Math.round(Math.min(...def))).toBe(-63384);
    expect(Math.round(def[72])).toBe(-22752);
    expect(Math.round(sum(def) - def[72] - def[119])).toBe(14286);
    expect(Math.round(maxDrawdown(def).drawdown)).toBe(76437);
    const stopped = applyStopLoss(def, 1000);
    expect(Math.round(sum(stopped.pnl))).toBe(-81023);
    expect(stopped.stops).toBe(4);
    expect(Math.round(Math.min(...stopped.pnl))).toBe(-63384);

    const sweep = (strategy: 'spread' | 'basis' | 'battery', threshold: number) =>
      Array.from({ length: 12 }, (_, i) => 5 + 5 * i).map((w) => {
        const p = labDailyPnL(H, { strategy, window: w, threshold, costPerMWh: 0.5, mw: 10 });
        const sp = splitTotals(p);
        return { w, inD: sp.inSample / (LAB_SPLIT - LAB_START), outD: sp.outOfSample / (H.length - LAB_SPLIT), p };
      });
    const basisSweep = sweep('basis', 2);
    const bestB = basisSweep.reduce((a, x) => (x.inD > a.inD ? x : a));
    expect(bestB.w).toBe(5);
    expect(Math.round(bestB.inD)).toBe(104);
    expect(Math.round(bestB.outD)).toBe(-75);
    expect(Math.min(...basisSweep.map((x) => x.outD))).toBe(bestB.outD);
    const outs = basisSweep.map((x) => x.outD).sort((a, b) => a - b);
    expect(Math.round((outs[5] + outs[6]) / 2)).toBe(187);
    const spreadSweep = sweep('spread', 2);
    const bestS = spreadSweep.reduce((a, x) => (x.inD > a.inD ? x : a));
    expect(Math.round(bestS.outD / bestS.inD)).toBe(7);
    const bat = sweep('battery', 2);
    expect(Math.round(Math.min(...bat.map((x) => x.outD)))).toBe(2724);
    expect(Math.round(Math.max(...bat.map((x) => x.outD)))).toBe(3108);
    for (const x of bat) {
      const oos = sum(x.p.slice(LAB_SPLIT));
      const share = (x.p[72] + x.p[119]) / oos;
      expect(share).toBeGreaterThan(0.6);
      expect(share).toBeLessThan(0.72);
    }
  });
  it('the challenge: the largest position limit that keeps every day within $20,000', () => {
    const unit = labDailyPnL(H, { strategy: 'spread', window: 5, threshold: 2, costPerMWh: 0.5, mw: 1 });
    const worst = (mw: number, stop: number) => Math.min(...applyStopLoss(unit.map((v) => v * mw), stop).pnl);
    // The lesson's predicate: within the limit at this size, beyond it one megawatt more.
    const solved = (mw: number, stop = 0) => mw < 50 && worst(mw, stop) >= -20000 && worst(mw + 1, stop) < -20000;
    expect(solved(10)).toBe(false); // the default
    expect(Array.from({ length: 50 }, (_, i) => i + 1).filter((mw) => solved(mw))).toEqual([3]);
    // The stop-loss doesn't change the answer: it can't stop a loss that arrives in one day.
    for (const stop of [1000, 5000, 20000]) expect(solved(3, stop)).toBe(true);
    // 20,000 / 6,338 per MW: the worst day scales with the position.
    expect(Math.round(Math.min(...unit))).toBe(-6338);
    expect(summarize(labDailyPnL(H, { strategy: 'battery', window: 60, threshold: 0, costPerMWh: 3, mw: 50 })).total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Every Chapter 6 lesson, every segmented option, every slider at both ends: no NaN or Infinity.

const modules = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch6/L6_*.tsx');

describe('chapter 6 lessons at the extremes', () => {
  for (const [path, load] of Object.entries(modules)) {
    it(`${path} shows no NaN`, async () => {
      const Lesson = (await load()).default;
      const view = render(createElement(Lesson));
      const check = (where: string) => {
        const text = view.container.textContent ?? '';
        const labels = Array.from(view.container.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') ?? '');
        const attrs = Array.from(view.container.querySelectorAll('path, rect, circle, line')).flatMap((e) =>
          ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'x1', 'x2', 'y1', 'y2'].map((a) => e.getAttribute(a) ?? ''),
        );
        for (const s of [text, ...labels, ...attrs]) {
          if (/NaN|Infinity/.test(s)) throw new Error(`${where}: ${s.slice(0, 120)}`);
        }
      };
      check('initial');
      const groups = Array.from(view.container.querySelectorAll<HTMLElement>('.seg'));
      for (let g = 0; g < groups.length; g++) {
        const count = view.container.querySelectorAll<HTMLElement>('.seg')[g].querySelectorAll('button').length;
        for (let b = 0; b < count; b++) {
          await act(async () => {
            fireEvent.click(view.container.querySelectorAll<HTMLElement>('.seg')[g].querySelectorAll('button')[b]);
          });
          const sliders = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
          for (const input of sliders) {
            if (input.disabled) continue;
            for (const v of [input.max, input.min]) {
              await act(async () => {
                fireEvent.change(input, { target: { value: v } });
              });
              check(`${input.id}=${v}, group ${g} option ${b}`);
            }
          }
        }
      }
      if (!groups.length) {
        for (const input of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
          for (const v of [input.max, input.min]) {
            await act(async () => {
              fireEvent.change(input, { target: { value: v } });
            });
            check(`${input.id}=${v}`);
          }
        }
      }
      for (const box of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
        await act(async () => {
          fireEvent.click(box);
        });
        check('checkbox');
      }
      cleanup();
    }, 60000);
  }
});

// ---------------------------------------------------------------------------
// The challenges in the lessons themselves: unsolved at the defaults, solved by the intended answer.

describe('chapter 6 challenges in the lessons', () => {
  const load = async (n: number) => {
    const Lesson = (await modules[`../src/lessons/ch6/L6_${n}.tsx`]()).default;
    return render(createElement(Lesson));
  };
  const solvedCount = (view: ReturnType<typeof render>) => view.container.querySelectorAll('.chal-s.ok').length;
  const slide = async (view: ReturnType<typeof render>, label: string, value: number, index = 0) => {
    const input = view.getAllByLabelText(label)[index] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: String(value) } });
    });
  };
  const press = async (view: ReturnType<typeof render>, text: string) => {
    const button = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button')).find((b) => b.textContent === text)!;
    await act(async () => {
      fireEvent.click(button);
    });
  };

  it('6.1: hedging 300 MW of Lakeside with a 300 MW inc', async () => {
    const view = await load(1);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Lakeside output', 300);
    await slide(view, 'Virtual position', 300);
    expect(solvedCount(view)).toBe(1);
    cleanup();
  });
  it('6.2: the trailing mean over 30 days, a $2 threshold, $1 costs', async () => {
    const view = await load(2);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Transaction cost', 1);
    expect(solvedCount(view)).toBe(0); // the default median rule doesn't get there
    await press(view, 'Trailing mean');
    await slide(view, 'Lookback window', 30);
    await slide(view, 'Threshold', 2);
    expect(solvedCount(view)).toBe(1);
    cleanup();
  });
  it('6.3: 200 MW of wind, and an FTR at $24', async () => {
    const view = await load(3);
    expect(solvedCount(view)).toBe(0);
    await press(view, 'Windy');
    await slide(view, 'Daily mean wind forecast at least', 210);
    expect(solvedCount(view)).toBe(0); // the belief holds, but not at the lowest level
    await slide(view, 'Daily mean wind forecast at least', 200);
    expect(solvedCount(view)).toBe(1);
    await slide(view, 'FTR auction price', 24.25);
    expect(solvedCount(view)).toBe(1);
    await slide(view, 'FTR auction price', 24);
    expect(solvedCount(view)).toBe(2);
    cleanup();
  });
  it('6.4: $14 of wear on day 61', async () => {
    const view = await load(4);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Degradation cost', 15);
    expect(solvedCount(view)).toBe(0); // skips the morning, but isn't the smallest
    await slide(view, 'Degradation cost', 14);
    expect(solvedCount(view)).toBe(1);
    cleanup();
  });
  it('6.5: an on-peak block and the evening CfD', async () => {
    const view = await load(5);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'On-peak block bought', 200);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Evening CfD bought', 150);
    expect(solvedCount(view)).toBe(1);
    cleanup();
  });
  it('6.6: a 3 MW position limit', async () => {
    const view = await load(6);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Position limit', 2);
    expect(solvedCount(view)).toBe(0);
    await slide(view, 'Stop-loss', 1000);
    await slide(view, 'Position limit', 3);
    expect(solvedCount(view)).toBe(1);
    cleanup();
  });
});
