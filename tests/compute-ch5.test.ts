// Chapter 5 of the compute course: numbers and challenge checks added or changed by the pedagogy fixes.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { cleanup, render } from '@testing-library/react';
import { pct, usd } from '../src/framework';
import { MARKET_BUYERS, clearMarket, pricesAt, productivity } from '../src/engines/compute/marketplace';
import { A_EQUIVALENT, BUILD, dieYield } from '../src/engines/compute/supplyChain';
import { PHYSICS_DEFAULTS, productivityUnder } from '../src/engines/compute/yieldManager';
import Lesson51, { CHEAP_L_ANSWER, EXPLORER_DEFAULTS, LESSON_NUMBERS as L5_1_N, L_STEP, cheapLSolved, lCheapestForBatch } from '../src/lessons/compute/ch5/L5_1';
import Lesson52, {
  CLEAN_ANSWER,
  CLEAN_LIMIT,
  LESSON_NUMBERS as L5_2_N,
  WAFER_DEFAULTS,
  WAFER_DEFECTS_MIN,
  WAFER_DEFECTS_STEP,
  cleanSolved,
} from '../src/lessons/compute/ch5/L5_2';
import Lesson53, {
  DEMO_DEFAULTS,
  FLEET_STEP,
  FORECAST_DEFAULTS,
  LESSON_NUMBERS as L5_3_N,
  START_FLEET,
  finalRisk,
  fleetSolved,
  runDemand,
} from '../src/lessons/compute/ch5/L5_3';
import Lesson54, { FLAT_INTERVALS, LESSON_NUMBERS as L5_4_N, SPOT_DEFAULTS, intervalSolved, reserveSolved, spotOf } from '../src/lessons/compute/ch5/L5_4';
import Lesson55, {
  LESSON_NUMBERS as L5_5_N,
  MARKET_DEFAULTS,
  buildSolved,
  latencySolved,
  premium,
  PATH_DEFAULTS,
  PATH_QUARTERS,
  SCARCE_GROWTH,
  SLOW_BUILD,
  buyersOf,
  marketAt,
  premiumClosesAt,
  pricePath,
  priceSetter,
  supplyOf,
} from '../src/lessons/compute/ch5/L5_5';

const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

describe('compute 5.1: the A-class equivalent', () => {
  it('counts a B-class hour by the job', () => {
    expect(r(L5_1_N.chatGpus.A / L5_1_N.chatGpus.B, 2)).toBe(2.57);
    expect(r(productivity('chat70', 'B'), 2)).toBe(2.57);
    expect(L5_1_N.tuneBEq).toBeCloseTo(2, 9);
    expect(L5_1_N.bLow).toBeCloseTo(2, 9);
    expect(L5_1_N.bHigh).toBeCloseTo(3, 9);
  });
});

describe('compute 5.2: corrected supply numbers', () => {
  it('starts from 1 million A-class GPUs and switches Q4 on from Q3’s output', () => {
    expect(L5_2_N.startBase).toBe(1000);
    expect(r(L5_2_N.q3Built)).toBe(726);
    expect(r(L5_2_N.q4Ready)).toBe(726);
    expect(r(L5_2_N.q4Ready)).toBe(r(L5_2_N.q4Deployed) + r(L5_2_N.q4Waiting));
    expect(r(L5_2_N.q4Deployed)).toBe(698);
    expect(r(L5_2_N.q4Waiting)).toBe(28);
    expect(r(L5_2_N.q4Built)).toBe(799);
  });

  it('cuts A-class output to about a fifth of its Q4 peak once the B-class ramps', () => {
    expect(r(L5_2_N.aLateLow, 2)).toBe(0.2);
    expect(r(L5_2_N.aLateHigh, 2)).toBe(0.24);
    expect(L5_2_N.aLateLow).toBeGreaterThan(0.18);
    expect(L5_2_N.aLateHigh).toBeLessThan(0.25);
  });

  it('labels the 2.28 as an approximation inside 5.1’s job-by-job range', () => {
    expect(L5_2_N.bEqLow).toBeCloseTo(2, 9);
    expect(L5_2_N.bEqHigh).toBeCloseTo(3, 9);
    expect(L5_2_N.bAEq).toBeGreaterThan(L5_2_N.bEqLow);
    expect(L5_2_N.bAEq).toBeLessThan(L5_2_N.bEqHigh);
  });

  it('credits the B-class’s extra arithmetic per wafer to its dies, not to the two-die package', () => {
    expect(r(L5_2_N.bDieYield * 100, 1)).toBe(44.9);
    expect(r(L5_2_N.aYield * 100, 1)).toBe(44.3);
    expect(r(L5_2_N.doubleDieYield * 100)).toBe(20);
    expect(r((A_EQUIVALENT.B / BUILD.B.dies - 1) * 100)).toBe(14);
    expect(r(((L5_2_N.bPerWafer * L5_2_N.bAEq) / L5_2_N.aPerWafer - 1) * 100)).toBe(17);
  });
});

describe('compute 5.4: challenge b matches the readout', () => {
  const show = (x: number) => usd(x, 2);

  it('accepts exactly the intervals that read the cheapest cost to the cent', () => {
    expect(FLAT_INTERVALS).toEqual({ from: 10, to: 28 });
    expect(intervalSolved(SPOT_DEFAULTS)).toBe(false);
    for (const interval of [10, 17, 28]) expect(intervalSolved({ ...SPOT_DEFAULTS, interval })).toBe(true);
    for (const interval of [9, 29, 60]) expect(intervalSolved({ ...SPOT_DEFAULTS, interval })).toBe(false);
    for (let interval = 1; interval <= 120; interval++)
      expect(intervalSolved({ ...SPOT_DEFAULTS, interval })).toBe(show(spotOf({ ...SPOT_DEFAULTS, interval }).perUsefulHour) === show(L5_4_N.tuneBestCost));
    expect(show(L5_4_N.tuneBestCost)).toBe('$1.03');
    expect(intervalSolved({ job: 'train70', reclaims: 2, interval: 17 })).toBe(false);
    expect(intervalSolved({ ...SPOT_DEFAULTS, reclaims: 1.75, interval: 17 })).toBe(false);
  });
});

describe('compute 5.5: the reference market, and prices over time', () => {
  it('prices a few kinds of GPU exactly as the full clearing does', () => {
    const which = [
      { site: 'marston' as const, gpu: 'A' as const },
      { site: 'fernhill' as const, gpu: 'A' as const },
      { site: 'techpark' as const, gpu: 'B' as const },
    ];
    for (const [demand, addB] of [
      [100, 0],
      [140, 600],
      [70, 2000],
    ]) {
      const buyers = buyersOf({ lat: 30, demand });
      const c = clearMarket(buyers, supplyOf(addB));
      const p = pricesAt(buyers, supplyOf(addB), which);
      which.forEach((w, i) => expect(p[i]).toBeCloseTo(c.prices[w.site][w.gpu], 9));
    }
  });

  it('needs its own reference market for the second figure', () => {
    const solvedB = { ...MARKET_DEFAULTS, addB: 350 };
    expect(priceSetter(marketAt(MARKET_DEFAULTS), MARKET_DEFAULTS, 'marston', 'B')).toEqual({ kind: 'buyer', id: 'chat70' });
    // After challenge b, the first figure's market no longer matches the prose.
    expect(priceSetter(marketAt(solvedB), solvedB, 'marston', 'B')).not.toEqual({ kind: 'buyer', id: 'chat70' });
  });

  it('explains Fernhill’s and the open market’s prices through batch’s $1.40', () => {
    const batch = MARKET_BUYERS.find((b) => b.id === 'batch8')!.value;
    expect(batch).toBe(1.4);
    expect(r(batch * productivity('batch8', 'B'), 2)).toBe(r(L5_5_N.farB, 2));
    expect(r(L5_5_N.farA, 2)).toBe(1.52);
    expect(r(L5_5_N.openL, 2)).toBe(0.5);
    // The L-class's $0.50 is fine-tuning work at batch's price, not an hour of batch work.
    expect(r(batch * productivity('tune8', 'L'), 2)).toBe(0.5);
    expect(r(batch * productivity('batch8', 'L'), 2)).toBe(0.39);
  });

  it('starts every path at the reference market', () => {
    for (const s of [PATH_DEFAULTS, { growth: 8, build: 0 }, { growth: 0, build: 600 }]) {
      const p = pricePath(s);
      expect(p).toHaveLength(PATH_QUARTERS);
      expect(p[0].near).toBeCloseTo(L5_5_N.nearA, 9);
      expect(p[0].far).toBeCloseTo(L5_5_N.farA, 9);
    }
  });

  it('quotes the default path and the two alternatives', () => {
    expect(PATH_DEFAULTS).toEqual({ growth: 2, build: 400 });
    expect(r(L5_5_N.pathQ2Near, 2)).toBe(3.25);
    expect(L5_5_N.pathClose).toBe(2);
    expect(r(L5_5_N.pathCloseNear, 2)).toBe(1.52);
    expect(r(L5_5_N.pathEndNear, 2)).toBe(1.52);
    expect(r(L5_5_N.pathEndFar, 2)).toBe(1.52);
    expect(SLOW_BUILD).toBe(200);
    expect([r(L5_5_N.slowMin, 2), r(L5_5_N.slowMax, 2)]).toEqual([3.25, 3.5]);
    expect(L5_5_N.slowClose).toBe(-1);
    expect(SCARCE_GROWTH).toBe(6);
    expect(r(L5_5_N.scarceNearMax, 2)).toBe(3.5);
    expect(Math.min(...pricePath({ growth: SCARCE_GROWTH, build: 0 }).map((x) => x.near))).toBeCloseTo(3.5, 6);
    expect(L5_5_N.scarceFarRise).toBe(9);
    expect(r(L5_5_N.scarceEndFar, 2)).toBe(2.4);
  });

  it('lets fine-tuning set Fernhill’s price once demand outgrows the fleet', () => {
    const grow = (1 + SCARCE_GROWTH / 100) ** (PATH_QUARTERS - 1);
    const buyers = buyersOf(MARKET_DEFAULTS).map((b) => ({ ...b, quantity: b.quantity * grow }));
    const c = clearMarket(buyers, supplyOf(0));
    const tune = buyers.find((b) => b.id === 'tune8')!;
    expect(tune.value).toBeCloseTo(c.prices.fernhill.A, 6);
    expect(c.served.tune8).toBeLessThan(tune.quantity - 1);
    expect(c.allocation.some((a) => a.buyer === 'tune8' && a.site === 'fernhill' && a.gpu === 'A')).toBe(true);
  });

  it('steps rather than glides: every price on the default paths is a few buyers’ values', () => {
    const levels = new Set<number>();
    for (const s of [PATH_DEFAULTS, { ...PATH_DEFAULTS, build: SLOW_BUILD }]) for (const x of pricePath(s)) levels.add(r(x.near, 2));
    expect(levels.size).toBeLessThanOrEqual(5);
    expect(premiumClosesAt(pricePath({ growth: 0, build: 0 }))).toBe(-1);
  });
});

describe('compute 5.1, pass 2: two ways to count A-class equivalents', () => {
  it('counts by GPUs needed here and by work rate from Lesson 6.1 on', () => {
    const rate = productivityUnder(PHYSICS_DEFAULTS);
    expect(r(L5_1_N.chatGpus.A / L5_1_N.chatGpus.B, 2)).toBe(2.57);
    expect(r(L5_1_N.countFrontierB, 2)).toBe(3);
    expect(r(L5_1_N.rateChatB, 2)).toBe(2.69);
    expect(r(L5_1_N.rateFrontierB, 2)).toBe(3.13);
    expect(L5_1_N.rateChatB).toBe(rate.chat70.B);
    expect(L5_1_N.rateFrontierB).toBe(rate.frontier400.B);
  });
});

describe('compute 5.1, pass 2: challenge a asks for the highest L-class price', () => {
  const batch = { ...EXPLORER_DEFAULTS, work: 'batch8' as const, unit: 'work' as const };

  it('predicts $0.50 from tokens per hour', () => {
    expect(r(L5_1_N.batchTokPerHour.L / 1e6, 2)).toBe(2.25);
    expect(r(L5_1_N.batchTokPerHour.B / 1e6, 1)).toBe(21);
    expect(pct(L5_1_N.batchTokPerHour.L / L5_1_N.batchTokPerHour.B, 1)).toBe('10.7%');
    expect(r(L5_1_N.lParity, 2)).toBe(0.52);
    expect(CHEAP_L_ANSWER).toBe(0.5);
    expect(L5_1_N.cheapLAnswer).toBe(0.5);
    // The B-class is the cheapest of the other two, so it is the one to beat.
    expect(L5_1_N.batchTokens.B).toBeLessThan(L5_1_N.batchTokens.A);
  });

  it('is unsolved at the start, solved only at $0.50 with Batch and Million tokens', () => {
    expect(cheapLSolved(EXPLORER_DEFAULTS)).toBe(false);
    expect(cheapLSolved({ ...batch, pL: 0.5 })).toBe(true);
    // Near misses: a cent-step above or below, the slider's floor, and the right price on the wrong view.
    for (const pL of [0.55, 0.45, 0.2, 0.9]) expect(cheapLSolved({ ...batch, pL })).toBe(false);
    expect(cheapLSolved({ ...batch, unit: 'gpuHour', pL: 0.5 })).toBe(false);
    expect(cheapLSolved({ ...batch, work: 'chat70', pL: 0.5 })).toBe(false);
    // Any price at or below $0.50 makes the L-class cheapest; only the highest solves.
    for (const pL of [0.2, 0.35, 0.5]) expect(lCheapestForBatch(pL)).toBe(true);
    expect(lCheapestForBatch(0.5 + L_STEP)).toBe(false);
    // Tolerates the float noise of a slider step.
    expect(cheapLSolved({ ...batch, pL: 0.2 + 6 * 0.05 })).toBe(true);
  });
});

describe('compute 5.2, pass 2: the yield challenge is predicted from the formula', () => {
  it('puts the answer at −ln 0.6 ÷ 8.14 cm², rounded down', () => {
    expect(r(-Math.log(0.6), 2)).toBe(0.51);
    expect(r(CLEAN_LIMIT, 3)).toBe(0.063);
    expect(CLEAN_ANSWER).toBe(0.06);
    expect(r(dieYield(CLEAN_ANSWER, BUILD.A.dieMm2) * 100, 1)).toBe(61.4);
    expect(r(dieYield(CLEAN_ANSWER + 0.01, BUILD.A.dieMm2) * 100, 1)).toBe(56.6);
  });

  it('keeps the answer away from the slider’s floor and the default', () => {
    expect((CLEAN_ANSWER - WAFER_DEFECTS_MIN) / WAFER_DEFECTS_STEP).toBeGreaterThanOrEqual(3);
    expect(Math.round((WAFER_DEFAULTS.defects - CLEAN_ANSWER) / WAFER_DEFECTS_STEP)).toBeGreaterThanOrEqual(3);
    expect(cleanSolved(WAFER_DEFAULTS.area, WAFER_DEFAULTS.defects)).toBe(false);
    expect(cleanSolved(BUILD.A.dieMm2, CLEAN_ANSWER)).toBe(true);
    for (const d of [0.02, 0.05, 0.07]) expect(cleanSolved(BUILD.A.dieMm2, d)).toBe(false);
  });
});

describe('compute 5.3, pass 2: the fleet challenge starts well away from its answer', () => {
  it('starts at 6,000 GPUs, which serve everything', () => {
    expect(DEMO_DEFAULTS.fleet).toBe(START_FLEET);
    expect(START_FLEET).toBe(6000);
    expect(runDemand(DEMO_DEFAULTS).unmetShare).toBe(0);
    expect(r(L5_3_N.startUtil * 100, 1)).toBe(56.5);
    expect(r(L5_3_N.peak)).toBe(5675);
  });

  it('is solved only at 4,900, below the busiest hour, with the starting training and flexible batch', () => {
    expect(fleetSolved(DEMO_DEFAULTS)).toBe(false);
    expect(L5_3_N.flexFleet).toBe(4900);
    expect((START_FLEET - L5_3_N.flexFleet) / FLEET_STEP).toBeGreaterThanOrEqual(10);
    expect(L5_3_N.flexFleet).toBeLessThan(L5_3_N.peak);
    expect(fleetSolved({ ...DEMO_DEFAULTS, fleet: 4900 })).toBe(true);
    for (const fleet of [4800, 5000, 5700]) expect(fleetSolved({ ...DEMO_DEFAULTS, fleet })).toBe(false);
    expect(fleetSolved({ ...DEMO_DEFAULTS, fleet: 4900, runsPerWeek: 0 })).toBe(false);
    expect(fleetSolved({ ...DEMO_DEFAULTS, fleet: 4900, batch: 'fixed' })).toBe(false);
  });

  it('shows the served share precisely enough to tell 4,800 from 4,900', () => {
    const served = (fleet: number) => pct(1 - runDemand({ ...DEMO_DEFAULTS, fleet }).unmetShare, 3);
    expect(served(4900)).toBe('99.935%');
    expect(served(4800)).toBe('99.896%');
  });

  it('quotes the prose after the challenge at 4,900 GPUs', () => {
    expect(pct(L5_3_N.flexUnmet, 3)).toBe('0.065%');
    expect(L5_3_N.flexShortHours).toBe(5);
    expect(r(L5_3_N.flexShortWorst)).toBe(775);
    expect(r(L5_3_N.flexUtil * 100, 1)).toBe(69.1);
    expect(L5_3_N.fullFleet - L5_3_N.flexFleet).toBe(800);
    expect(r(L5_3_N.noTrainingUtil * 100, 1)).toBe(46.7);
    expect(L5_3_N.fixedShortHours).toBe(125);
    expect(pct(L5_3_N.fixedUnmet, 2)).toBe('2.71%');
  });

  it('shows the forecast risk to a tenth of a percent, so 12,100 reads above 10%', () => {
    expect(pct(finalRisk({ ...FORECAST_DEFAULTS, fleet: 12100 }), 1)).toBe('10.1%');
    expect(pct(finalRisk({ ...FORECAST_DEFAULTS, fleet: 12200 }), 1)).toBe('9.1%');
  });
});

describe('compute 5.4, pass 2: the reservation is read off the sorted chart', () => {
  it('solves at the level the need exceeds in two-thirds of the hours, not at the start', () => {
    expect(r(L5_4_N.levelAtBreakEven)).toBe(139);
    expect(reserveSolved(0)).toBe(false);
    expect(reserveSolved(Math.round(L5_4_N.levelAtBreakEven))).toBe(true);
    for (const reserved of [137, 140, 150, 269]) expect(reserveSolved(reserved)).toBe(false);
  });
});

describe('compute 5.5, pass 2: both challenges come before their explanations', () => {
  it('a: the map shows Fernhill at 40 ms, ten steps from the start', () => {
    expect(latencySolved(MARKET_DEFAULTS)).toBe(false);
    expect(latencySolved({ ...MARKET_DEFAULTS, lat: 40 })).toBe(true);
    for (const lat of [39, 41, 60]) expect(latencySolved({ ...MARKET_DEFAULTS, lat })).toBe(false);
  });

  it('b: serving chat in full (about 106 B-class GPUs) is not enough; 350 is', () => {
    expect(r(L5_5_N.chatShortInB)).toBe(106);
    expect(L5_5_N.firstDropAdd).toBe(125);
    expect(premium({ ...MARKET_DEFAULTS, addB: L5_5_N.firstDropAdd })).toBeGreaterThan(1);
    expect(L5_5_N.matchAdd).toBe(350);
    expect(L5_5_N.matchAdd / L5_5_N.chatShortInB).toBeGreaterThan(3);
    expect(buildSolved(MARKET_DEFAULTS)).toBe(false);
    for (const addB of [100, 125, 325, 375]) expect(buildSolved({ ...MARKET_DEFAULTS, addB })).toBe(false);
    expect(buildSolved({ ...MARKET_DEFAULTS, addB: 350 })).toBe(true);
  });
});

describe('compute 5.4, pass 2: the checkpoint interval is estimated first', () => {
  it('puts the rule of thumb’s 17 minutes inside the cheapest stretch', () => {
    expect(r(L5_4_N.tuneWriteMin * 60)).toBe(24);
    expect(1440 / L5_4_N.tuneInterruptions / 60).toBe(6);
    expect(r(L5_4_N.tuneRuleOfThumb)).toBe(17);
    expect(L5_4_N.tuneRuleOfThumb).toBeGreaterThanOrEqual(FLAT_INTERVALS.from);
    expect(L5_4_N.tuneRuleOfThumb).toBeLessThanOrEqual(FLAT_INTERVALS.to);
    expect(intervalSolved({ ...SPOT_DEFAULTS, interval: Math.round(L5_4_N.tuneRuleOfThumb) })).toBe(true);
  });
});

describe('compute chapter 5, pass 2: what the lessons show before a challenge is solved', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });
  afterEach(cleanup);

  const textOf = (C: ComponentType) => render(createElement(C)).container;
  const figureText = (root: HTMLElement, name: string) =>
    Array.from(root.querySelectorAll('figure')).find((f) => (f.textContent ?? '').includes(name))?.textContent ?? '';

  it('5.1 shows only the chosen unit, so the reversal waits for the unit switch', () => {
    const fig = figureText(textOf(Lesson51), 'Compute Economics Explorer');
    expect(fig).toContain('Per GPU-hour');
    expect(fig).toContain('Share of peak used');
    expect(fig).not.toContain('million tokens');
    expect(fig).not.toContain('PFLOP-hour$');
    expect(fig).not.toContain('A-class price');
    expect(fig).not.toContain('B-class price');
  });

  it('5.4 hides the reservation level and the cheapest checkpoint interval', () => {
    const root = textOf(Lesson54);
    expect(figureText(root, 'two-thirds of hours')).not.toContain(`${r(L5_4_N.levelAtBreakEven)} GPUs`);
    const spot = figureText(root, 'minutes between checkpoints');
    expect(spot).not.toContain('The cheapest interval here');
  });

  it('keeps every lesson’s prose within 1,600 words', () => {
    for (const C of [Lesson51, Lesson52, Lesson53, Lesson54, Lesson55]) {
      const root = textOf(C);
      let words = 0;
      const walk = (el: Element) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'figure' || el.classList.contains('chal')) return;
        if (tag === 'p' || tag === 'h2') {
          words += (el.textContent ?? '').split(/\s+/).filter(Boolean).length;
          return;
        }
        for (const c of Array.from(el.children)) walk(c);
      };
      walk(root);
      expect(words).toBeLessThanOrEqual(1600);
      cleanup();
    }
  });
});
