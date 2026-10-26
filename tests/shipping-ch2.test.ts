// Shipping chapter 2: the numbers and claims the fix pass added to the lessons' prose and challenges.

import { describe, expect, it } from 'vitest';
import { ALBATROSS, HANDYSIZE, KESTREL, PETREL } from '../src/model/shipping/vessels';
import { designShip } from '../src/engines/shipping/design';
import { powerAndFuel } from '../src/engines/shipping/propulsion';
import { laytime } from '../src/engines/shipping/loading';
import { ladenDraft, ballastDraft } from '../src/engines/shipping/voyage';
import { classOpex, classScrapValue } from '../src/engines/shipping/cycle';
import { invest } from '../src/engines/shipping/investment';
import { standardHistory } from '../src/model/shipping/history';
// The lessons' source, to check what the figures no longer print and where the prose says what.
import SRC_21 from '../src/lessons/shipping/ch2/L2_1.tsx?raw';
import SRC_22 from '../src/lessons/shipping/ch2/L2_2.tsx?raw';
import SRC_24 from '../src/lessons/shipping/ch2/L2_4.tsx?raw';
import SRC_25 from '../src/lessons/shipping/ch2/L2_5.tsx?raw';
import { DESIGNER_DEFAULTS, NEO_BEST, NEO_TOLERANCE, SAVING_RANGE, SPEED_MAX, neopanamaxSlack, neopanamaxSolved } from '../src/lessons/shipping/ch2/L2_1';
import { CARGO, DEMURRAGE, DESPATCH, FORMALITIES_HOURS, LAYTIME_LOADING_HOURS, loadingRun } from '../src/lessons/shipping/ch2/L2_2';
import { RESTORE_BEST, RESTORE_FREIGHT, TARGET_TCE, bestAt, fleetPoint, mcrSpeed, restoreSolved, voyageAt } from '../src/lessons/shipping/ch2/L2_3';
import {
  AGED,
  CHALLENGE_TCE,
  DEFAULTS,
  EQUITY_RETURN,
  OFFHIRE_NEW,
  PER_MILLION,
  agedShip,
  costsFor,
  maxPriceFor,
  maxPriceSolved,
} from '../src/lessons/shipping/ch2/L2_4';
import {
  BOOM_MONTH,
  LAST_ORDER,
  PV_15K,
  PV_RATE_TCE,
  SLUMP_MONTH,
  SOLUTIONS,
  YEARS,
  lagCase,
  lagHistory,
  lastOrder,
  returnSolved,
} from '../src/lessons/shipping/ch2/L2_5';

const HIST = standardHistory().cls.kmax;
const load = (v: typeof PETREL, s: number) => powerAndFuel(v, s, { draft: v.designDraft }).load;

describe('lesson 2.1', () => {
  it('stops the speed slider below every ship’s MCR', () => {
    expect(SPEED_MAX).toBe(14.5);
    for (const v of [PETREL, KESTREL, ALBATROSS]) expect(load(v, SPEED_MAX)).toBeLessThan(1);
    expect(load(PETREL, 15)).toBeGreaterThan(1);
    const fam = designShip({ kind: 'bulk', loa: 362, beam: 65, draft: 23 });
    expect(powerAndFuel(fam, SPEED_MAX, { draft: fam.designDraft }).load).toBeLessThan(1);
  });

  it('credits a hull of the Handysize class’s dimensions with more deadweight than the class', () => {
    expect([HANDYSIZE.loa, HANDYSIZE.beam, HANDYSIZE.designDraft]).toEqual([180, 30, 10.5]);
    const sketch = designShip({ kind: 'bulk', loa: 180, beam: 30, draft: 10.5 });
    expect(sketch.dwt).toBeCloseTo(42_666, -1);
    expect(sketch.dwt).toBeGreaterThan(HANDYSIZE.dwt);
  });
});

describe('lesson 2.2', () => {
  it('gives the laytime figure the starting plan’s own loading time', () => {
    expect(LAYTIME_LOADING_HOURS).toBeCloseTo(loadingRun(2, 1, 4000, 3000).hours, 9);
    expect(LAYTIME_LOADING_HOURS).toBeCloseTo(27.45, 2);
    const terms = { ratePerDay: 25_000, noticeHours: 6, excludeWeather: true, demurrage: DEMURRAGE, despatch: DESPATCH };
    const lt = (waitDays: number, rain = 0, excludeWeather = true) =>
      laytime(CARGO, { waitingHours: waitDays * 24, formalitiesHours: FORMALITIES_HOURS, loadingHours: LAYTIME_LOADING_HOURS, rainHours: rain }, { ...terms, excludeWeather });
    expect(-lt(0).balance).toBeCloseTo(14_647, 0);
    expect(lt(2).balance).toBeCloseTo(706, 0);
    expect(lt(3).balance).toBeCloseTo(15_706, 0);
    expect(lt(3, 24, true).balance).toBeCloseTo(lt(3).balance, 6);
    expect(lt(3, 24, false).balance).toBeCloseTo(30_706, 0);
  });
});

describe('lesson 2.3', () => {
  it('never asks Kestrel for more than her MCR', () => {
    const laden = ladenDraft(KESTREL, 75_000);
    const ballast = ballastDraft(KESTREL);
    expect(mcrSpeed(laden)).toBeCloseTo(15.1, 6);
    expect(mcrSpeed(ballast)).toBe(15.5);
    for (const bunker of [400, 600, 800])
      for (let day = 5_000; day <= 50_000; day += 1_000) {
        const p = fleetPoint(day, bunker);
        expect(powerAndFuel(KESTREL, p.laden, { draft: laden }).load).toBeLessThanOrEqual(1);
        expect(powerAndFuel(KESTREL, p.ballast, { draft: ballast }).load).toBeLessThanOrEqual(1);
      }
    expect(fleetPoint(50_000, 400).laden).toBeCloseTo(15.1, 6);
  });
});

describe('lesson 2.4', () => {
  it('spreads cash break-even over the earning days and explains the new ship’s two full costs', () => {
    expect(costsFor({ ...DEFAULTS, ltv: 0 }).b.cash).toBeCloseTo((classOpex('kmax') * 365) / (365 - DEFAULTS.offHire), 6);
    const [n] = AGED.map((a) => agedShip(a.age, a.price, 600));
    expect(n.offHire).toBe(OFFHIRE_NEW);
    expect(n.price).toBe(DEFAULTS.price);
    expect(n.fullBreakeven).toBeCloseTo(18_002.5, 1);
    expect(costsFor(DEFAULTS).b.full).toBeCloseTo(18_256, 0);
    // Same ship, same financing: only the off-hire days differ.
    expect(costsFor({ ...DEFAULTS, offHire: OFFHIRE_NEW }).b.full).toBeCloseTo(n.fullBreakeven, 6);
  });
});

describe('lesson 2.5', () => {
  it('pins the challenge to the history’s own 30-month lag', () => {
    expect(returnSolved('newbuild', BOOM_MONTH)).toBe(false); // the starting order
    expect(returnSolved('newbuild', SLUMP_MONTH)).toBe(true); // the prose’s slump order
    expect(returnSolved('newbuild', SLUMP_MONTH, 30)).toBe(true);
    expect(returnSolved('newbuild', SLUMP_MONTH, 12)).toBe(false);
    expect(returnSolved('newbuild', SLUMP_MONTH, 48)).toBe(false);
    expect(lastOrder(30)).toBe(LAST_ORDER);
  });

  it('tells the slump order’s story as the model has it', () => {
    // Owners were still ordering: no “nobody wants ships”.
    expect(HIST[SLUMP_MONTH].orders).toBeGreaterThan(1);
    expect(YEARS[6].orders).toBeGreaterThan(40);
    expect(YEARS[7].orders).toBeGreaterThan(20);
    expect(HIST[SLUMP_MONTH].newbuild).toBeLessThan(HIST[BOOM_MONTH].newbuild);
    // Delivered into a market still weak, before the boom of Years 11 and 12.
    expect(HIST[SLUMP_MONTH + 30].tce).toBeCloseTo(10_708, 0);
    const late = Math.min(YEARS[10].tce, YEARS[11].tce);
    for (let y = 5; y <= 9; y++) expect(YEARS[y].tce).toBeLessThan(late);
    expect(invest('kmax', HIST, 'newbuild', SLUMP_MONTH).irr).toBeCloseTo(0.2775, 3);
    expect(invest('kmax', HIST, 'newbuild', BOOM_MONTH).irr).toBeCloseTo(0.0816, 3);
  });

  it('lists the challenge’s answers truthfully in the success text', () => {
    expect(SOLUTIONS[0]).toBe(74);
    expect(SOLUTIONS[SOLUTIONS.length - 1]).toBe(113);
    expect(Math.floor(SOLUTIONS[0] / 12)).toBe(6); // none in the first six years
    expect(SOLUTIONS.every((m, i) => i === 0 || m === SOLUTIONS[i - 1] + 1)).toBe(true);
    expect(Math.max(...SOLUTIONS.map((m) => HIST[m].newbuild))).toBeLessThan(30);
    expect(SOLUTIONS[0] + 30).toBeGreaterThanOrEqual(8 * 12); // delivered from Year 9 on
  });

  it('shows timing mattering less as the shipyard lag shortens', () => {
    const [c12, c30, c48] = [12, 30, 48].map(lagCase);
    expect(c12.peak).toBeCloseTo(38_272, 0);
    expect(c30.peak).toBeCloseTo(58_535, 0);
    expect(c48.peak).toBeCloseTo(72_542, 0);
    const gap = (c: typeof c12) => 100 * (c.slump - c.boom);
    expect(gap(c12)).toBeCloseTo(6.94, 1);
    expect(gap(c30)).toBeCloseTo(19.59, 1);
    expect(gap(c48)).toBeGreaterThan(gap(c30));
    expect(c12.boom).toBeCloseTo(0.0232, 3);
    expect(c12.slump).toBeCloseTo(0.0926, 3);
    expect(c48.boom).toBeCloseTo(0.1295, 3);
    expect(c48.slump).toBeCloseTo(0.3421, 3);
    // “In our model every order earns less” with the 12-month lag.
    const h12 = lagHistory(12);
    for (let m = 0; m <= LAST_ORDER; m++) expect(invest('kmax', h12, 'newbuild', m, 12).irr).toBeLessThan(invest('kmax', HIST, 'newbuild', m).irr);
    // Owners still order most in the boom of Year 3.
    const orders12 = Array.from({ length: 12 }, (_, y) => h12.slice(y * 12, y * 12 + 12).reduce((s, m) => s + m.orders, 0));
    expect(orders12.slice(0, 8).indexOf(Math.max(...orders12.slice(0, 8)))).toBe(2);
    expect(lagHistory(30)).toBe(HIST);
  });

  it('values a ship by present value at 8%, close to Lesson 2.4’s full-cost answer', () => {
    // Recompute the cycle model’s value of a new ship at a steady TCE, discounting at 8% a year.
    let v = 0;
    for (let y = 0; y < 25; y++) v += ((PV_RATE_TCE * (1 - 0.008 * y) - classOpex('kmax') * (1 + 0.025 * y)) * 355) / 1.08 ** (y + 0.5);
    v += classScrapValue('kmax') / 1.08 ** 25;
    expect(PV_15K).toBeCloseTo(v, 0);
    expect(PV_15K / 1e6).toBeCloseTo(26.04, 2);
    expect(maxPriceFor({ ...DEFAULTS, tce: PV_RATE_TCE })).toBe(26.5);
    expect(Math.abs(26.5e6 - PV_15K)).toBeLessThan(1e6);
  });
});

// ---------------------------------------------------------------------------
// Fix pass 2: the redesigned challenges and the numbers their prose now quotes.

const SOURCES: Record<number, string> = { 1: SRC_21, 2: SRC_22, 4: SRC_24, 5: SRC_25 };
const lesson = (n: number) => SOURCES[n];

describe('lesson 2.1, pass 2', () => {
  const bulk = (loa: number, beam: number, draft: number) => ({ kind: 'bulk' as const, loa, beam, draft });

  it('asks for the biggest Neopanamax bulk carrier to within half a percent, not to the tonne', () => {
    expect(NEO_TOLERANCE).toBe(0.005);
    expect(NEO_BEST.dwt * NEO_TOLERANCE).toBeCloseTo(1_049, 0);
    expect(neopanamaxSolved(DESIGNER_DEFAULTS)).toBe(false); // Kestrel, the starting design
    expect(neopanamaxSolved(bulk(366, 51.25, 14.86))).toBe(true);
    expect(neopanamaxSolved(bulk(365.5, 51.2, 14.85))).toBe(true); // a few clicks short in every dimension
    // Clear shortfalls in one dimension, or a little in all three, don't count.
    expect(neopanamaxSolved(bulk(360, 51.25, 14.86))).toBe(false);
    expect(neopanamaxSolved(bulk(366, 50, 14.86))).toBe(false);
    expect(neopanamaxSolved(bulk(366, 51.25, 14.7))).toBe(false);
    expect(neopanamaxSolved(bulk(365, 51.1, 14.82))).toBe(false);
    // Over a limit: too long, or too deep for the locks' fresh water.
    expect(neopanamaxSolved(bulk(366.1, 51.25, 14.86))).toBe(false);
    expect(neopanamaxSolved(bulk(366, 51.25, 14.87))).toBe(false);
    expect(neopanamaxSolved({ ...bulk(366, 51.25, 14.86), kind: 'tanker' })).toBe(false);
  });

  it('names the dimensions that still have room', () => {
    expect(neopanamaxSlack(DESIGNER_DEFAULTS)).toEqual(['longer', 'wider', 'deeper']);
    expect(neopanamaxSlack(bulk(366, 51.25, 14.5))).toEqual(['deeper']);
    expect(neopanamaxSlack(bulk(366, 51.25, 14.86))).toEqual([]);
  });

  it('finds size saving much the same share of fuel at every speed on the slider', () => {
    expect(SAVING_RANGE.albatross[0]).toBeCloseTo(0.294, 3);
    expect(SAVING_RANGE.albatross[1]).toBeCloseTo(0.305, 3);
    expect(SAVING_RANGE.ore[0]).toBeCloseTo(0.471, 3);
    expect(SAVING_RANGE.ore[1]).toBeCloseTo(0.485, 3);
  });

  it('no longer prints readouts that repeat the economies-of-scale markers', () => {
    expect(lesson(1)).not.toMatch(/label: 'Petrel, kg per 1,000 tonne-miles'/);
    expect(lesson(1)).not.toMatch(/<DataTable/);
  });
});

describe('lesson 2.2, pass 2', () => {
  const terms = { ratePerDay: 25_000, noticeHours: 6, excludeWeather: true, demurrage: DEMURRAGE, despatch: DESPATCH };
  const lt = (waitDays: number, ratePerDay = 25_000, noticeHours = 6) =>
    laytime(CARGO, { waitingHours: waitDays * 24, formalitiesHours: FORMALITIES_HOURS, loadingHours: LAYTIME_LOADING_HOURS, rainHours: 0 }, { ...terms, ratePerDay, noticeHours });

  it('quotes what the agreed rate and the notice time are worth', () => {
    expect(lt(2, 30_000).allowedDays).toBeCloseTo(2.65, 9);
    expect(lt(2, 30_000).balance).toBeCloseTo(8_656, 0); // demurrage
    expect(lt(2).balance).toBeCloseTo(706, 0);
    expect(lt(2, 20_000).allowedDays).toBeCloseTo(3.975, 9);
    expect(-lt(2, 20_000).balance).toBeCloseTo(5_609, 0); // despatch
    expect(lt(0).balance - lt(0, 25_000, 12).balance).toBeCloseTo(1_875, 6);
  });

  it('drops the loading figure’s readouts, which repeated the timeline’s labels', () => {
    expect(lesson(2)).not.toMatch(/label: 'loading time, cargo in and ballast out'/);
    expect(lesson(2)).not.toMatch(/label: 'laytime allowed'/);
  });
});

describe('lesson 2.3, pass 2', () => {
  it('asks the reader to predict that dearer fuel at the same day value means slower', () => {
    const before = bestAt(14, 600).speed;
    expect(before).toBe(12.4);
    expect(RESTORE_FREIGHT).toBe(16.5);
    expect(RESTORE_BEST.speed).toBe(11.2);
    expect(RESTORE_BEST.speed).toBeLessThan(before);
    expect(RESTORE_BEST.result.tce).toBeCloseTo(20_088, 0);
    expect(Math.abs(RESTORE_BEST.result.tce / TARGET_TCE - 1)).toBeLessThan(0.06); // a day worth about what it was
    expect(bestAt(16, 900).result.tce).toBeCloseTo(18_975, 0);
  });

  it('is solved only at the lowest freight rate and its best speed', () => {
    expect(restoreSolved(14, 14, 600)).toBe(false); // the starting state
    expect(restoreSolved(11.2, 16.5, 900)).toBe(true);
    expect(restoreSolved(11.1, 16.5, 900)).toBe(true);
    expect(restoreSolved(11.3, 16.5, 900)).toBe(true);
    // Fast enough to earn the target at the old speed, but not the best speed.
    expect(voyageAt(12.4, 16.5, 900).tce).toBeGreaterThan(TARGET_TCE);
    expect(restoreSolved(12.4, 16.5, 900)).toBe(false);
    expect(restoreSolved(11.5, 16.5, 900)).toBe(false);
    expect(restoreSolved(11.2, 16, 900)).toBe(false);
    expect(restoreSolved(11.4, 17, 900)).toBe(false);
    expect(restoreSolved(11.2, 16.5, 890)).toBe(false);
  });
});

describe('lesson 2.4, pass 2', () => {
  it('quotes the slope of full cost against price', () => {
    expect(PER_MILLION.interest).toBeCloseTo((1e6 * DEFAULTS.ltv * DEFAULTS.rate) / 365, 6);
    expect(PER_MILLION.interest).toBeCloseTo(115.07, 2);
    expect(PER_MILLION.depreciation).toBeCloseTo(109.59, 2);
    expect(PER_MILLION.equity).toBeCloseTo(109.59, 2);
    expect(PER_MILLION.interest + PER_MILLION.depreciation + PER_MILLION.equity).toBeCloseTo(334.25, 2);
    expect(PER_MILLION.full).toBeCloseTo(343.66, 2);
    // The prediction lands on the answer.
    const full36 = costsFor(DEFAULTS).b.full;
    const predicted = DEFAULTS.price - (full36 - CHALLENGE_TCE) / PER_MILLION.full;
    expect(predicted).toBeCloseTo(26.53, 2);
    expect(Math.floor(predicted * 2) / 2).toBe(maxPriceFor(DEFAULTS));
    // Not a knife-edge: $26.5 million clears the market by a few dollars a day, $27 million misses by much more.
    expect(CHALLENGE_TCE - costsFor({ ...DEFAULTS, price: 26.5 }).b.full).toBeCloseTo(8.7, 1);
    expect(costsFor({ ...DEFAULTS, price: 27 }).b.full - CHALLENGE_TCE).toBeCloseTo(163.1, 1);
  });

  it('judges the challenge with the starting financing only', () => {
    expect(maxPriceSolved(DEFAULTS)).toBe(false); // the starting price, $36 million
    expect(maxPriceSolved({ ...DEFAULTS, price: 26.5 })).toBe(true);
    expect(maxPriceSolved({ ...DEFAULTS, price: 26 })).toBe(false);
    expect(maxPriceSolved({ ...DEFAULTS, price: 27 })).toBe(false);
    expect(maxPriceSolved({ ...DEFAULTS, price: 26.5, tenor: 10 })).toBe(true); // repayment doesn't touch full cost
    expect(maxPriceFor({ ...DEFAULTS, ltv: 0.8 })).toBe(27.5);
    expect(maxPriceSolved({ ...DEFAULTS, ltv: 0.8, price: 27.5 })).toBe(false);
    expect(maxPriceSolved({ ...DEFAULTS, rate: 0.08, price: 26.5 })).toBe(false);
    expect(maxPriceSolved({ ...DEFAULTS, offHire: 5, price: 26.5 })).toBe(false);
  });

  it('makes the loan’s size irrelevant to full cost at the owners’ own return, and costly above it', () => {
    const full = (rate: number, ltv: number) => costsFor({ ...DEFAULTS, rate, ltv }).b.full;
    expect(full(EQUITY_RETURN, 0.8)).toBeCloseTo(full(EQUITY_RETURN, 0.6), 6);
    expect(full(EQUITY_RETURN, 0)).toBeCloseTo(full(EQUITY_RETURN, 0.6), 6);
    expect(full(0.12, 0.8)).toBeGreaterThan(full(0.12, 0.6));
    expect(full(0.07, 0.8)).toBeLessThan(full(0.07, 0.6));
  });

  it('drops readouts that repeat the bars and the equation, and writes prices one way', () => {
    expect(lesson(4)).not.toMatch(/label: 'full-cost break-even'/);
    expect(lesson(4)).not.toMatch(/label: 'Full break-even'/);
    for (const n of [4, 5]) expect(lesson(n)).not.toMatch(/\)\}m`|\$\$\{fmt\([^`]*\)\} million|\)\} million`\)/);
  });
});

describe('lesson 2.5, pass 2', () => {
  it('starts unsolved, and its earliest answer is a slump order', () => {
    expect(returnSolved('newbuild', BOOM_MONTH)).toBe(false);
    expect(returnSolved('newbuild', 73)).toBe(false);
    expect(invest('kmax', HIST, 'newbuild', 73).irr).toBeCloseTo(0.196, 3);
    expect(returnSolved('newbuild', 74)).toBe(true);
    expect(invest('kmax', HIST, 'newbuild', 74).irr).toBeCloseTo(0.204, 3);
    expect(returnSolved('secondhand', 84)).toBe(false);
    expect(SOLUTIONS).toContain(SLUMP_MONTH);
  });

  it('tells the slump order’s return only after the challenge', () => {
    const src = lesson(5);
    const challenge = src.indexOf('<Challenge');
    expect(challenge).toBeGreaterThan(0);
    expect(src.indexOf('pct(SLUMP.irr')).toBeGreaterThan(challenge);
  });
});
