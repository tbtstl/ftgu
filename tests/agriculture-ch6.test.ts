// The agriculture capstone (Chapter 6): the numbers its prose quotes and its challenges' checks.
// First fix pass: the farm's bins, the sale ahead of 6.2, the scoring threshold of 6.3, the
// merchant's storage rule and history-sized charter in 6.4, and the desk's futures sized in
// contracts against the whole business in 6.5. Second pass: predict-then-check challenges, prose
// true for the reader's saved business, resets that touch only their own part, and the migrated
// desk field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  BIN_COST_PER_BU,
  CEDAR_DESIGN,
  ELEVATOR_OF,
  HARVEST_DAY,
  MERCHANT_RUSH,
  MERCHANT_STORAGE,
  NEW_SEASONS,
  deskYear,
  expectedCorn,
  farmForecast,
  farmRecord,
  farmYear,
  harvestCarryShare,
  hedgeResult,
  merchantYear,
  priceExposure,
  storagePerBushel,
  type FarmDesign,
  type MerchantPlan,
} from '../src/engines/agriculture/capstone';
import { harvestRush } from '../src/engines/agriculture/elevator';
import { INTEREST, checkpointForecast, cropYear, decFutures, fullCarry, portSpot, valleyCorn } from '../src/engines/agriculture/market';
import { meanValley } from '../src/engines/agriculture/world';
import { observe } from '../src/engines/agriculture/forecast';
import { DISTRICTS, dayOf } from '../src/model/agriculture/region';
import Lesson61, { resilientSolved, summaryOf } from '../src/lessons/agriculture/ch6/L6_1';
import { START_SHARE, bandNarrowing, largestSafeShare, lowEndShare, saleAhead, saleRecord, worstAugustMiss } from '../src/lessons/agriculture/ch6/L6_2';
import Lesson63, {
  BEAT_BY,
  CHALLENGE_MISS,
  CHALLENGE_SEASONS,
  bandGuessSolved,
  beatClimatology,
  bestHalfWidth,
  climatologyScore,
  crps,
  fortySeasons,
  type Entry,
} from '../src/lessons/agriculture/ch6/L6_3';
import Lesson64, {
  MIN_STORAGE,
  SPREAD_TOLERANCE,
  average,
  bestMinCarry,
  bestSpread,
  buyingBySpread,
  largestSafeCharter,
  skippedSeasons,
  spreadGuessSolved,
  storageGuessSolved,
} from '../src/lessons/agriculture/ch6/L6_4';
import { hedgeParts, planOf, positionNoun, stats, steadiestPosition, steadySolved, withFutures } from '../src/lessons/agriculture/ch6/L6_5';
import {
  DEFAULT_DESK,
  DEFAULT_MERCHANT,
  HEDGE_RANGE,
  defaultState,
  getCapstone,
  resetBins,
  resetFarmDesign,
  resetHedge,
  resetSpread,
  resetStorageAndCharter,
  sanitize,
  setDesk,
  setFarm,
  setMerchant,
} from '../src/lessons/agriculture/shared/capstone';
import { describeFarm, describeMerchant, elevatorPhrase } from '../src/lessons/agriculture/shared/SoFar';

const HISTORY = Array.from({ length: 60 }, (_, i) => i + 1);
const ALL = [...HISTORY, ...NEW_SEASONS];
const K = (x: number) => Math.round(x / 1000);
const pct = (x: number) => Math.round(x * 100);
const AUG1 = dayOf(8, 1);
const Z80 = 1.2816;
/** The merchant's rules once 6.4's three challenges are solved. */
const SOLVED: MerchantPlan = { spreadCents: 38, storeUntil: 'Jul', storeMinCarry: 0.6, charterMillions: 5 };

describe('6.1: the farm', () => {
  it('says what the Plains can and can’t do', () => {
    expect(summaryOf({ ...CEDAR_DESIGN, district: 'plains', irrigated: true }).mean).toBeLessThan(0);
    expect(K(summaryOf({ ...CEDAR_DESIGN, district: 'plains', cornAcres: 0 }).mean)).toBe(-53);
    expect(summaryOf({ ...CEDAR_DESIGN, district: 'plains', cornAcres: 0, bins: 0 }).mean).toBeLessThan(0);
    // "the best the Plains can do is about break even"
    let best = -Infinity;
    for (let c = 0; c <= 1600; c += 200)
      for (const irrigated of [false, true])
        for (const hybrid of ['early', 'standard', 'late'] as const)
          for (const bins of [0, 125000, 250000]) best = Math.max(best, summaryOf({ ...CEDAR_DESIGN, district: 'plains', cornAcres: c, irrigated, hybrid, bins }).mean);
    expect(Math.abs(best)).toBeLessThan(25000);
  });
  it('counts today’s bins in the first figure’s bars', () => {
    const rows = farmRecord(CEDAR_DESIGN, HISTORY);
    expect(rows.every((r) => r.stored > 0)).toBe(true);
    expect(summaryOf(CEDAR_DESIGN).mean).not.toBeCloseTo(summaryOf({ ...CEDAR_DESIGN, bins: 0 }).mean, 0);
  });
});

describe('6.2: the season and the sale ahead', () => {
  it('describes season 82 as the prose says', () => {
    const o = observe(82, AUG1);
    expect(Math.round(o.temp)).toBe(2);
    expect(Math.round(o.rain * 2) / 2).toBe(-4.5);
    const june = saleAhead(CEDAR_DESIGN, 82, 1, dayOf(6, 1));
    expect([K(june.sold), K(june.harvest), K(june.short)]).toEqual([165, 112, 53]);
    expect([june.price, june.harvestPrice].map((p) => Math.round(p * 100) / 100)).toEqual([3.75, 5.23]);
    expect(K(june.cost)).toBe(78);
    const f = farmForecast(CEDAR_DESIGN, 82, AUG1);
    const aug = saleAhead(CEDAR_DESIGN, 82, (f.mean - Z80 * f.sd) / f.mean, AUG1);
    expect([K(aug.short), K(aug.cost)]).toEqual([8, 7]);
    expect([pct(lowEndShare(CEDAR_DESIGN, dayOf(6, 1))), pct(lowEndShare(CEDAR_DESIGN, dayOf(9, 1)))]).toEqual([80, 91]);
  });
  it('explains the worst August miss from the data', () => {
    const y = worstAugustMiss(CEDAR_DESIGN);
    expect(y).toBe(71);
    const aug = farmForecast(CEDAR_DESIGN, y, AUG1).mean;
    const sep = farmForecast(CEDAR_DESIGN, y, dayOf(9, 1)).mean;
    const h = farmForecast(CEDAR_DESIGN, y, dayOf(11, 9)).mean;
    // The success message's "Even on September 1" branch, with an upward miss.
    expect(Math.abs(h - sep)).toBeGreaterThan(Math.abs(h - aug) / 2);
    expect(h).toBeGreaterThan(aug);
  });
  it('gives the honest range for forty seasons', () => {
    const sd = Math.sqrt(40 * 0.8 * 0.2);
    expect([Math.round(32 - 2 * sd), Math.round(32 + 2 * sd)]).toEqual([27, 37]);
  });
  it('makes the sale challenge solvable and unsolved at the start', () => {
    expect(largestSafeShare(CEDAR_DESIGN, AUG1)).toBe(0.9);
    expect(saleRecord(CEDAR_DESIGN, 0.9, AUG1).short).toBe(4);
    expect(saleRecord(CEDAR_DESIGN, 1, AUG1).short).toBeGreaterThan(4);
    expect(largestSafeShare(CEDAR_DESIGN, dayOf(7, 1))).toBe(0.8);
    // The figure starts at 80% on August 1, which is not the answer.
    expect(largestSafeShare(CEDAR_DESIGN, AUG1)).not.toBe(0.8);
    // Every design has an answer below 100%: selling the whole forecast comes up short about half the time.
    for (const d of [CEDAR_DESIGN, { ...CEDAR_DESIGN, irrigated: true }, { ...CEDAR_DESIGN, district: 'plains' as const }]) {
      const s = largestSafeShare(d, AUG1);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });
});

describe('6.3: forecasting the valley', () => {
  it('puts the best band at about one and a half times the miss', () => {
    for (const m of [10, 20, 40, 60, 100]) expect(bestHalfWidth(m)).toBe(1.5 * m);
    let bh = 0;
    let bs = Infinity;
    for (let h = 0.5; h <= 3; h += 0.001) {
      const s = crps(0, h / Z80, 1);
      if (s < bs) {
        bs = s;
        bh = h;
      }
    }
    expect(bh).toBeGreaterThan(1.45);
    expect(bh).toBeLessThan(1.6);
    // An honest bell-shaped 80% band against its average miss.
    expect(Z80 / Math.sqrt(2 / Math.PI)).toBeGreaterThan(1.5);
    expect(Z80 / Math.sqrt(2 / Math.PI)).toBeLessThan(1.65);
  });
  it('can’t be solved without the evidence', () => {
    for (let mean = 250; mean <= 700; mean += 5)
      for (let half = 5; half <= 150; half += 5) {
        const e: Entry = { mean, half, locked: true };
        expect(beatClimatology(Object.fromEntries(CHALLENGE_SEASONS.map((y) => [y, e])))).toBe(false);
      }
    const clim = CHALLENGE_SEASONS.reduce((a, y) => a + climatologyScore(y), 0);
    expect(BEAT_BY).toBe(0.25);
    // A forecaster within 30 million bushels on each season with ±45 bands clears the bar.
    const close = Object.fromEntries(CHALLENGE_SEASONS.map((y, i) => [y, { mean: valleyCorn(y) + (i % 2 ? 30 : -30), half: 45, locked: true }]));
    expect(beatClimatology(close)).toBe(true);
    expect(clim / 5).toBeGreaterThan(40);
  });
  it('quotes the regression over all forty new seasons', () => {
    const f = fortySeasons();
    expect(Math.round(f.miss)).toBe(36);
    expect([Math.round(f.model * 10) / 10, Math.round(f.clim * 10) / 10]).toEqual([25.8, 37.1]);
    expect(f.inside).toBe(33);
    const five = Math.max(...CHALLENGE_SEASONS.map((y) => Math.abs(checkpointForecast(y, AUG1, 'full').mean - valleyCorn(y))));
    expect(Math.ceil(five)).toBe(10);
    expect(Math.round(meanValley())).toBe(506);
  });
});

describe('6.4: the merchant', () => {
  it('shows the best spread at the precision of its status', () => {
    const buy = (c: number) => Math.round(average({ ...DEFAULT_MERCHANT, spreadCents: c }, HISTORY, (x) => x.buying) / 1000);
    expect(bestSpread()).toBe(38);
    expect([buy(37), buy(38), buy(39)]).toEqual([1596, 1603, 1602]);
  });
  it('stores on the curve as it stands at harvest', () => {
    for (const hub of ['fairview', 'halsted', 'dunmore', 'ashby', 'landing'] as const) {
      expect(bestMinCarry(35, hub)).toBe(0.6);
      expect(bestMinCarry(38, hub)).toBe(0.6);
    }
    const store = (sp: number, t: number) => K(average({ spreadCents: sp, storeUntil: 'Jul', storeMinCarry: t, charterMillions: 0 }, HISTORY, (x) => x.storage));
    expect([store(38, 0), store(38, 0.6), store(35, 0)]).toEqual([182, 199, 212]);
    const left = (sp: number) => Math.round(average({ spreadCents: sp, storeUntil: 'Jul', storeMinCarry: 0, charterMillions: 0 }, HISTORY, (x) => x.stored) / 1e5) / 10;
    expect([left(35), left(38)]).toEqual([2.0, 1.6]);
    // Only season 46 is inverted at harvest, and its bins are empty after the rush at the spreads the prose names.
    expect(HISTORY.filter((y) => harvestCarryShare(y) < 0)).toEqual([46]);
    for (const sp of [35, 38]) {
      const rush = harvestRush({ ...MERCHANT_RUSH, harvest: MERCHANT_RUSH.harvest * (cropYear(46).valley / meanValley()), spread: sp / 100 });
      expect(rush.stocks[rush.stocks.length - 1] ?? 0).toBeLessThan(1);
    }
    // The skipped seasons pay carry, but less than the merchant's own cost: every one lost money stored.
    const sk = skippedSeasons(38, 0.6);
    expect(sk.years.length).toBe(13);
    expect([pct(Math.min(...sk.shares)), pct(Math.max(...sk.shares))]).toEqual([28, 58]);
    expect(Math.round(sk.perBushel * 1000) / 10).toBe(-6.5);
    const all = { spreadCents: 38, storeUntil: 'Jul' as const, storeMinCarry: 0, charterMillions: 0 };
    for (const y of sk.years) expect(merchantYear(all, y).storage).toBeLessThan(0);
    // "a little over half of full carry"
    const own = HISTORY.map((y) => (MERCHANT_STORAGE + (INTEREST / 12) * (portSpot(y, HARVEST_DAY) + cropYear(y).hubBasis.fairview)) / fullCarry(decFutures(y, HARVEST_DAY)));
    const meanOwn = own.reduce((a, b) => a + b, 0) / own.length;
    expect(meanOwn).toBeGreaterThan(0.5);
    expect(meanOwn).toBeLessThan(0.6);
  });
  it('sizes the charter on the history and checks it on the new seasons', () => {
    const per = HISTORY.map((y) => ({ y, c: merchantYear({ ...DEFAULT_MERCHANT, charterMillions: 1 }, y).charter, v: cropYear(y).valley }));
    const losers = per.filter((r) => r.c < 0).map((r) => r.y);
    expect(losers).toEqual([46, 57]);
    expect([...per].sort((a, b) => a.v - b.v).slice(0, 2).map((r) => r.y).sort((a, b) => a - b)).toEqual([46, 57]);
    for (const p of [DEFAULT_MERCHANT, { ...SOLVED, charterMillions: 0 }]) {
      expect(largestSafeCharter(p)).toBe(5);
      const newWorst = NEW_SEASONS.map((y) => ({ y, t: merchantYear({ ...p, charterMillions: 5 }, y).total })).reduce((a, b) => (b.t < a.t ? b : a));
      expect(newWorst.y).toBe(82);
      expect(newWorst.t).toBeGreaterThan(0);
    }
    expect(Math.min(...HISTORY.map((y) => merchantYear({ ...SOLVED, charterMillions: 6 }, y).total))).toBeLessThan(0);
    // "in every season it earns something"
    for (let sp = 30; sp <= 60; sp += 5) for (const y of ALL) expect(merchantYear({ ...DEFAULT_MERCHANT, spreadCents: sp }, y).buying).toBeGreaterThan(0);
    // "the new seasons happen to have had fewer short crops"
    const short = (ys: number[]) => ys.filter((y) => cropYear(y).valley < 450).length;
    expect(short(NEW_SEASONS)).toBeLessThan(short(HISTORY));
    expect(short(NEW_SEASONS) / 40).toBeLessThan(short(HISTORY) / 60);
  });
});

describe('6.5: the desk', () => {
  const exposures = (f: FarmDesign, m: MerchantPlan) => {
    const farm = HISTORY.map((y) => farmYear(f, y).total);
    const merchant = HISTORY.map((y) => merchantYear(m, y, ELEVATOR_OF[f.district]).total);
    const r = (x: number) => Math.round(x / 1e4) * 1e4;
    return [r(priceExposure(farm, HISTORY)), r(priceExposure(merchant, HISTORY)), r(priceExposure(farm.map((v, i) => v + merchant[i]), HISTORY))];
  };
  it('sizes the hedge against the business as Chapter 4 ran it', () => {
    const p = hedgeParts(CEDAR_DESIGN, DEFAULT_MERCHANT, 0, HISTORY);
    expect(steadiestPosition(CEDAR_DESIGN, DEFAULT_MERCHANT, 0, HISTORY)).toBe(-15);
    expect(steadiestPosition(CEDAR_DESIGN, DEFAULT_MERCHANT, 0, NEW_SEASONS)).toBe(-10);
    expect([K(withFutures(p, 0).sd), K(withFutures(p, DEFAULT_DESK.hedgeContracts).sd), K(withFutures(p, -15).sd)]).toEqual([208, 232, 201]);
    expect([Math.round(withFutures(p, 0).worst / 1e4) / 100, Math.round(withFutures(p, -15).worst / 1e4) / 100]).toEqual([0.81, 1.07]);
    expect(Math.round((1 - withFutures(p, -15).sd / withFutures(p, 0).sd) * 100)).toBe(4);
    expect(exposures(CEDAR_DESIGN, DEFAULT_MERCHANT)).toEqual([60000, -130000, -70000]);
    expect(pct((DEFAULT_DESK.hedgeContracts * 5000) / 167198)).toBe(45);
    const n = hedgeParts(CEDAR_DESIGN, DEFAULT_MERCHANT, 0, NEW_SEASONS);
    expect([Math.round(withFutures(n, 0).worst / 1e4) / 100, Math.round(withFutures(n, -15).worst / 1e4) / 100]).toEqual([0.93, 0.99]);
    // The worst season of the history is the drought of season 46, the shortest crop.
    expect(HISTORY[p.base.indexOf(Math.min(...p.base))]).toBe(46);
    // Challenges start unsolved; the steadiest positions solve them.
    expect(steadySolved(p, DEFAULT_DESK.hedgeContracts)).toBe(false);
    expect(steadySolved(p, -15)).toBe(true);
    expect(steadySolved(n, DEFAULT_DESK.hedgeContracts)).toBe(false);
    expect(steadySolved(n, -10)).toBe(true);
    expect(steadySolved(n, -15)).toBe(false);
  });
  it('sizes the hedge against the business once 6.4 is solved', () => {
    const p = hedgeParts(CEDAR_DESIGN, SOLVED, 0, HISTORY);
    const n = hedgeParts(CEDAR_DESIGN, SOLVED, 0, NEW_SEASONS);
    const hb = steadiestPosition(CEDAR_DESIGN, SOLVED, 0, HISTORY);
    expect(hb).toBe(-190);
    expect(steadiestPosition(CEDAR_DESIGN, SOLVED, 0, NEW_SEASONS)).toBe(-330);
    expect(exposures(CEDAR_DESIGN, SOLVED)).toEqual([60000, -1030000, -970000]);
    expect(withFutures(p, 15).sd).toBeGreaterThan(withFutures(p, 0).sd);
    expect(withFutures(p, hb).worst).toBeGreaterThan(withFutures(p, 0).worst);
    expect(withFutures(n, hb).worst).toBeGreaterThan(withFutures(n, 0).worst);
    expect(steadySolved(p, -195)).toBe(true);
    expect(steadySolved(p, DEFAULT_DESK.hedgeContracts)).toBe(false);
  });
  it('keeps every steadiest position on the slider', () => {
    const big = { ...SOLVED, charterMillions: 10 };
    for (const ys of [HISTORY, NEW_SEASONS]) {
      const b = steadiestPosition(CEDAR_DESIGN, big, 0, ys);
      expect(b).toBeGreaterThan(HEDGE_RANGE.min);
      expect(b).toBeLessThan(HEDGE_RANGE.max);
    }
    // A farm with a large irrigated corn crop outweighs the elevator: then the steadying position is short.
    expect(steadiestPosition({ ...CEDAR_DESIGN, cornAcres: 1600, irrigated: true, hybrid: 'late' }, DEFAULT_MERCHANT, 0, HISTORY)).toBeGreaterThan(0);
  });
  it('finds puts protect a business that is short a drought in the wrong seasons', () => {
    for (const m of [DEFAULT_MERCHANT, SOLVED]) {
      const base = HISTORY.map((y) => deskYear(CEDAR_DESIGN, m, { hedgeContracts: 0, hedgeWith: 'futures', forecastContracts: 0 }, y).total);
      const puts = HISTORY.map((y, i) => base[i] + hedgeResult({ hedgeContracts: 100, hedgeWith: 'puts' }, y));
      expect(stats(puts).sd).toBeGreaterThan(stats(base).sd);
      expect(stats(puts).worst).toBeLessThan(stats(base).worst);
    }
  });
  it('reads positions in words', () => {
    expect([positionNoun(-195), positionNoun(15), positionNoun(0)]).toEqual(['buying 195 contracts', 'selling 15 contracts', 'holding no futures']);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix pass 2: predict-then-check challenges, prose true for the reader's saved business, resets
// that touch only their own part, and the migrated desk field.

const HUBS = ['fairview', 'halsted', 'dunmore', 'ashby', 'landing'] as const;
const DESIGNS: FarmDesign[] = DISTRICTS.flatMap((dd) =>
  ([false, true] as const).flatMap((irrigated) => (['early', 'standard', 'late'] as const).map((hybrid) => ({ ...CEDAR_DESIGN, district: dd.id, irrigated, hybrid }))),
);
const resetAll = () => {
  const d = defaultState();
  setFarm(d.farm);
  setMerchant(d.merchant);
  setDesk(d.desk);
};
const solvedFlags = (root: HTMLElement) => Array.from(root.querySelectorAll('.chal-st')).map((e) => e.classList.contains('ok'));
const slider = (root: HTMLElement, label: string) => {
  const el = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find((l) => l.textContent === label);
  return document.getElementById(el!.htmlFor) as HTMLInputElement;
};
const button = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)!;
const segment = (root: HTMLElement, group: string, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)).find((b) => b.textContent === text)!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetAll();
});

describe('6.1 pass 2: the design challenge and the bins', () => {
  it('leaves the rotation for the reader to find, and the prose after it names designs that pass', () => {
    expect(resilientSolved(CEDAR_DESIGN)).toBe(false);
    expect(resilientSolved({ ...CEDAR_DESIGN, cornAcres: 800 })).toBe(true);
    // "The River Bottoms pass too, with a late hybrid on 500 to 900 acres of corn"
    for (let c = 500; c <= 900; c += 100) expect(resilientSolved({ ...CEDAR_DESIGN, district: 'bottoms', cornAcres: c, hybrid: 'late' })).toBe(true);
    expect(resilientSolved({ ...CEDAR_DESIGN, district: 'bottoms', cornAcres: 400, hybrid: 'late' })).toBe(false);
    expect(resilientSolved({ ...CEDAR_DESIGN, district: 'bottoms', cornAcres: 1000, hybrid: 'late' })).toBe(false);
    // "Cedar Bend grows corn after corn on 400 of its acres"
    expect(CEDAR_DESIGN.cornAcres - (CEDAR_DESIGN.acres - CEDAR_DESIGN.cornAcres)).toBe(400);
  });
  it('says storage pays only where a stored bushel earns more than a bushel of space costs', () => {
    // At every district's elevator a stored bushel earns more than the bins cost, so the "full bin earns more" branch is the usual one.
    for (const hub of HUBS) expect(HISTORY.reduce((a, y) => a + storagePerBushel(y, hub), 0) / 60).toBeGreaterThan(BIN_COST_PER_BU);
  });
  it('resets the first figure without touching the bins, and only after asking', () => {
    setFarm({ district: 'bottoms', cornAcres: 800, hybrid: 'late', bins: 200000 });
    vi.stubGlobal('confirm', () => false);
    resetFarmDesign();
    expect(getCapstone().farm.district).toBe('bottoms');
    vi.stubGlobal('confirm', () => true);
    resetFarmDesign();
    expect(getCapstone().farm).toEqual({ ...CEDAR_DESIGN, bins: 200000 });
    resetBins();
    expect(getCapstone().farm).toEqual(CEDAR_DESIGN);
    // A reset that changes nothing asks nothing.
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    resetFarmDesign();
    resetBins();
    expect(ask).not.toHaveBeenCalled();
  });
  it('notes a saved farm that differs from Cedar Bend’s', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const cedar = render(createElement(Lesson61));
    expect(cedar.container.textContent).not.toContain('the demonstration shows the farm you saved');
    cleanup();
    setFarm({ cornAcres: 800 });
    const mine = render(createElement(Lesson61));
    expect(mine.container.textContent).toContain('the demonstration shows the farm you saved');
  });
});

describe('6.2 pass 2: prose true for the design on show', () => {
  it('calls the band half as wide by September only where it is', () => {
    expect(bandNarrowing(CEDAR_DESIGN)).toBeLessThan(0.55);
    const wide = DESIGNS.filter((d) => bandNarrowing(d) > 0.6);
    expect(wide.length).toBeGreaterThan(0);
    // The pivots explanation is printed only for irrigated designs; the dryland designs all narrow to 60% or less ("about half").
    for (const d of wide) expect(d.irrigated).toBe(true);
  });
  it('starts the sale challenge unsolved for every design and checkpoint', () => {
    for (const d of DESIGNS) for (const m of [6, 7, 8, 9]) expect(largestSafeShare(d, dayOf(m, 1))).not.toBe(START_SHARE);
  });
  it('keeps the band’s low end a share between 0 and 1', () => {
    for (const d of DESIGNS) for (const m of [6, 7, 8, 9]) {
      const v = lowEndShare(d, dayOf(m, 1));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('6.3 pass 2: predict the band, then check', () => {
  it('asks about a miss the reader has to scale to', () => {
    expect(CHALLENGE_MISS).toBe(80);
    // From 40 → ±60 the reader predicts ±120 for 80.
    expect(bandGuessSolved(CHALLENGE_MISS, 120)).toBe(true);
    for (const h of [100, 110, 130, 140]) expect(bandGuessSolved(CHALLENGE_MISS, h)).toBe(true);
    // The band as wide as the miss, the default band, the slider's end and near misses don't.
    for (const h of [25, 80, 95, 145, 150]) expect(bandGuessSolved(CHALLENGE_MISS, h)).toBe(false);
    expect(bandGuessSolved(CHALLENGE_MISS, undefined)).toBe(false);
    // Every accepted band scores within 2% of the best.
    const best = crps(0, bestHalfWidth(CHALLENGE_MISS) / Z80, CHALLENGE_MISS);
    for (let h = 100; h <= 140; h += 5) expect(crps(0, h / Z80, CHALLENGE_MISS)).toBeLessThan(best * 1.02);
    expect(crps(0, 95 / Z80, CHALLENGE_MISS)).toBeGreaterThan(best * 1.02);
  });
  it('hides the curve until a band is checked, and solves only on the committed band', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const v = render(createElement(Lesson63));
    const root = v.container;
    expect(root.querySelector('[aria-label^="A forecast that misses by 40"]')).not.toBeNull();
    expect(solvedFlags(root)[1]).toBe(false);
    // The score's figure is the second; its band slider is the last of that label.
    const bands = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).filter((l) => l.textContent === '80% band, either side');
    const misses = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).filter((l) => l.textContent === 'How far the forecast missed');
    const band = document.getElementById(bands[bands.length - 1].htmlFor) as HTMLInputElement;
    const miss = document.getElementById(misses[0].htmlFor) as HTMLInputElement;
    act(() => {
      fireEvent.change(band, { target: { value: '60' } });
    });
    act(() => {
      fireEvent.click(button(root, 'Check this band'));
    });
    expect(root.querySelector('[aria-label*="You checked ±60"]')).not.toBeNull();
    act(() => {
      fireEvent.change(miss, { target: { value: String(CHALLENGE_MISS) } });
    });
    // A new miss hides the curve again.
    expect(root.querySelector(`[aria-label^="A forecast that misses by ${CHALLENGE_MISS}"]`)).not.toBeNull();
    act(() => {
      fireEvent.change(band, { target: { value: '120' } });
    });
    expect(solvedFlags(root)[1]).toBe(false);
    act(() => {
      fireEvent.click(button(root, 'Check this band'));
    });
    expect(solvedFlags(root)[1]).toBe(true);
  });
});

describe('6.4 pass 2: predict, then check against the history', () => {
  it('accepts spreads at the top of the curve, not the default or its neighbors', () => {
    expect(SPREAD_TOLERANCE).toBe(10000);
    const ok = buyingBySpread().filter((r) => spreadGuessSolved(r.cents)).map((r) => r.cents);
    expect(ok).toEqual([37, 38, 39, 40]);
    expect(spreadGuessSolved(DEFAULT_MERCHANT.spreadCents)).toBe(false);
    expect(spreadGuessSolved(null)).toBe(false);
  });
  it('accepts a storage threshold of 50% or 60% wherever there is corn to store', () => {
    for (const hub of HUBS)
      for (const sp of [30, 35, 38, 40]) {
        const at = (t: number, u: MerchantPlan['storeUntil'] = 'Jul') => storageGuessSolved({ spreadCents: sp, storeUntil: u, storeMinCarry: t, charterMillions: 0 }, hub);
        expect([0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].filter((t) => at(t))).toEqual(expect.arrayContaining([0.6]));
        expect(at(0)).toBe(false);
        expect(at(0.7)).toBe(false);
        expect(at(0.8)).toBe(false);
        expect(at(0.6, 'May')).toBe(false);
        expect(at(0.5) || sp >= 40).toBe(true);
      }
    // A spread that leaves the bins empty after harvest has nothing to judge.
    expect(average({ spreadCents: 50, storeUntil: 'Jul', storeMinCarry: 0.6, charterMillions: 0 }, HISTORY, (x) => x.storage)).toBeLessThan(MIN_STORAGE);
    expect(storageGuessSolved({ spreadCents: 50, storeUntil: 'Jul', storeMinCarry: 0.6, charterMillions: 0 })).toBe(false);
  });
  it('lets the reader predict the charter from season 46', () => {
    for (const hub of HUBS)
      for (let sp = 30; sp <= 60; sp += 6)
        for (const u of ['none', 'May', 'Jul'] as const)
          for (const t of [0, 0.6]) {
            const p: MerchantPlan = { spreadCents: sp, storeUntil: u, storeMinCarry: t, charterMillions: 0 };
            const m46 = merchantYear(p, 46, hub).total;
            expect(m46).toBeLessThan(merchantYear(p, 57, hub).total);
            expect(largestSafeCharter(p, hub)).toBe(Math.floor(m46 / 150000));
          }
    // The default plan's answer is not the slider's default or its end.
    expect(largestSafeCharter(DEFAULT_MERCHANT)).toBe(5);
  }, 60000);
  it('earns least storing to March and most to July', () => {
    for (const hub of HUBS)
      for (const sp of [30, 35, 38, 40])
        for (const t of [0, 0.5, 0.6]) {
          const m = (['Mar', 'May', 'Jul'] as const).map((u) => average({ spreadCents: sp, storeUntil: u, storeMinCarry: t, charterMillions: 0 }, HISTORY, (x) => x.storage, hub));
          expect(m[0]).toBeLessThan(m[1]);
          expect(m[1]).toBeLessThan(m[2]);
        }
    const m = (['Mar', 'May', 'Jul'] as const).map((u) => K(average({ spreadCents: 38, storeUntil: u, storeMinCarry: 0.6, charterMillions: 0 }, HISTORY, (x) => x.storage)));
    expect(m).toEqual([110, 155, 199]);
  });
  it('names the Bottoms’ merchant as the river terminal', () => {
    expect(elevatorPhrase({ ...CEDAR_DESIGN, district: 'bottoms' })).toBe('the river terminal at Crane Landing');
    expect(elevatorPhrase(CEDAR_DESIGN)).toBe('the country elevator at Fairview');
  });
  it('checks each prediction, starting unsolved, and keeps the deciding readouts hidden until then', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const v = render(createElement(Lesson64));
    const root = v.container;
    expect(solvedFlags(root)).toEqual([false, false, false]);
    expect(root.textContent).not.toContain('storage, average');
    expect(root.textContent).not.toContain('worst season, history');
    // Challenge 1: checking the default 35¢ doesn't solve; predicting again at 38¢ does.
    act(() => {
      fireEvent.click(button(root, 'Check this spread on all sixty seasons'));
    });
    expect(solvedFlags(root)[0]).toBe(false);
    expect(root.querySelector('[aria-label^="Buying margin over the sixty seasons"]')).not.toBeNull();
    act(() => {
      fireEvent.click(button(root, 'Predict again'));
    });
    act(() => {
      fireEvent.change(slider(root, 'Harvest spread'), { target: { value: '38' } });
    });
    act(() => {
      fireEvent.click(button(root, 'Check this spread on all sixty seasons'));
    });
    expect(solvedFlags(root)[0]).toBe(true);
    // Challenge 2: July at 60%, checked.
    act(() => {
      fireEvent.click(segment(root, 'Store until', 'July'));
    });
    act(() => {
      fireEvent.change(slider(root, 'Store only if the curve pays at least'), { target: { value: '60' } });
    });
    expect(solvedFlags(root)[1]).toBe(false);
    act(() => {
      fireEvent.click(button(root, 'Check the storage rule'));
    });
    expect(solvedFlags(root)[1]).toBe(true);
    expect(root.textContent).toContain('storage, average');
    // Challenge 3: 6 million is checked and fails, 5 solves.
    act(() => {
      fireEvent.change(slider(root, 'Barge charter'), { target: { value: '6' } });
    });
    act(() => {
      fireEvent.click(button(root, 'Check the charter'));
    });
    expect(solvedFlags(root)[2]).toBe(false);
    expect(root.textContent).toContain('worst season, history');
    act(() => {
      fireEvent.change(slider(root, 'Barge charter'), { target: { value: '5' } });
    });
    act(() => {
      fireEvent.click(button(root, 'Check the charter'));
    });
    expect(solvedFlags(root)[2]).toBe(true);
    expect(getCapstone().merchant).toEqual(SOLVED);
  });
  it('resets each figure’s own rules, after asking', () => {
    setMerchant(SOLVED);
    vi.stubGlobal('confirm', () => true);
    resetSpread();
    expect(getCapstone().merchant).toEqual({ ...SOLVED, spreadCents: 35 });
    resetStorageAndCharter();
    expect(getCapstone().merchant).toEqual(DEFAULT_MERCHANT);
  });
});

describe('6.5 pass 2: the desk', () => {
  it('trades futures only, whatever was saved', () => {
    expect(planOf({ ...DEFAULT_DESK, hedgeWith: 'puts' }).hedgeWith).toBe('futures');
    expect(planOf({ ...DEFAULT_DESK, forecastTrading: false, forecastContracts: 50 }).forecastContracts).toBe(0);
  });
  it('migrates the old share-of-crop setting to contracts', () => {
    // The old default, 40% of Cedar Bend's expected corn, is the new default of 15 contracts.
    expect(Math.round(expectedCorn(CEDAR_DESIGN))).toBe(167198);
    expect(sanitize({ farm: CEDAR_DESIGN, desk: { hedgePct: 40, hedgeWith: 'futures', forecastTrading: true, forecastContracts: 20 } }).desk).toEqual({
      hedgeContracts: 15,
      hedgeWith: 'futures',
      forecastTrading: true,
      forecastContracts: 20,
    });
    expect(sanitize({ farm: CEDAR_DESIGN, desk: { hedgePct: 100 } }).desk.hedgeContracts).toBe(35);
    expect(sanitize({ farm: CEDAR_DESIGN, desk: { hedgePct: 0 } }).desk.hedgeContracts).toBe(0);
    // A saved contracts field wins; a saved puts position starts again from Lesson 5.5's hedge.
    expect(sanitize({ desk: { hedgeContracts: -190, hedgePct: 40 } }).desk.hedgeContracts).toBe(-190);
    expect(sanitize({ desk: { hedgeContracts: 40, hedgeWith: 'puts' } }).desk).toMatchObject({ hedgeContracts: 15, hedgeWith: 'futures' });
    // The report slider's full range survives a reload.
    expect(sanitize({ desk: { forecastContracts: 150 } }).desk.forecastContracts).toBe(150);
  });
  it('resets the scorecard’s futures without touching the report trades', () => {
    setDesk({ hedgeContracts: -190, forecastTrading: true, forecastContracts: 50 });
    vi.stubGlobal('confirm', () => true);
    resetHedge();
    expect(getCapstone().desk).toEqual({ ...DEFAULT_DESK, forecastTrading: true, forecastContracts: 50 });
  });
  it('describes the business so far', () => {
    expect(describeFarm({ ...CEDAR_DESIGN, cornAcres: 800 })).toBe('Black Prairie, 800 of 1,600 acres in corn, standard hybrid, no pivots, 125,000 bushels of bins');
    expect(describeFarm(CEDAR_DESIGN)).toContain('(400 after corn)');
    expect(describeMerchant(SOLVED)).toBe('38¢ harvest spread; stores until July when the curve pays at least 60% of full carry; 5 million bushels of barge charter');
  });
  it('makes no claim about the worst season the steadiest position doesn’t bear out', () => {
    // "the hedge’s real work is in the bad seasons" is printed only when the worst season gains more, in proportion, than the spread narrows.
    const claim = (f: FarmDesign, m: MerchantPlan) => {
      const p = hedgeParts(f, m, 0, HISTORY);
      const b = steadiestPosition(f, m, 0, HISTORY);
      const u = withFutures(p, 0);
      const s = withFutures(p, b);
      return (s.worst > u.worst ? (s.worst - u.worst) / Math.abs(u.worst) : 0) > 1 - s.sd / u.sd;
    };
    expect(claim(CEDAR_DESIGN, DEFAULT_MERCHANT)).toBe(true);
    expect(claim(CEDAR_DESIGN, SOLVED)).toBe(true);
    expect(claim({ ...CEDAR_DESIGN, district: 'bottoms', cornAcres: 800, hybrid: 'late' }, DEFAULT_MERCHANT)).toBe(false);
    // With the hedge at its steadiest, no season of the hundred loses money for these businesses.
    for (const m of [DEFAULT_MERCHANT, SOLVED]) {
      const b = steadiestPosition(CEDAR_DESIGN, m, 0, HISTORY);
      expect(ALL.every((y) => deskYear(CEDAR_DESIGN, m, { hedgeContracts: b, hedgeWith: 'futures', forecastContracts: 0 }, y).total >= 0)).toBe(true);
    }
  });
});
