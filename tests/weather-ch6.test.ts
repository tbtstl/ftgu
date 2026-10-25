// The weather capstone (chapter 6): the numbers its prose and challenge messages claim, checked
// against the model they come from.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmt, pct } from '../src/framework';
import {
  CAPSTONE_DEFAULTS,
  DESK_DEFAULTS,
  DESK_RANGE,
  FORECASTER_DEFAULTS,
  REFERENCE_BOOK,
  REGION_DEFAULTS,
  confirmResetPart,
  getWeatherCapstone,
  regionKnobs,
  resetCapstone,
  samePart,
  setCapstoneParts,
  updateCapstone,
} from '../src/lessons/weather/shared/capstone';
import { atReference } from '../src/lessons/weather/shared/CapstoneStrip';
import {
  DOUBLED,
  ENSO_PULL_ANSWER,
  QUIETED,
  QUIET_PULL_ANSWER,
  fenwickWinters,
  doubledSolved,
  ensoShareSolved,
  quietedSolved,
  regionWinters,
  trendShareOf,
} from '../src/lessons/weather/ch6/L6_1';
import { CHALLENGE_MONTH, MAX_LEAD, beatModelSolved, challengeMonth, ensoMajorityFrom, ensoShareOfSkill, modelSkill, seasonScores, skillLeadSolved } from '../src/lessons/weather/ch6/L6_2';
import { BOARD_OFFSET, DOLLARS_PER_HDD, STORY_WINTER, STRIPS_MAX, archiveResults, boardAnswer, boardSolved, outlook, shortfallAtUnit, stripsSolved } from '../src/lessons/weather/ch6/L6_3';
import { DESK_WINTER, STRIP_GRID, bestStrips, deskBook, hedgeSolved, hedgeSuccessText, knobsOf, marketOf, minVarianceStrips, viewDefaults } from '../src/lessons/weather/ch6/L6_4';
import {
  NO_PULL,
  REF_BUSINESS,
  REF_DESK,
  WORLD_DEFAULTS,
  archiveMarginSd,
  bookOf,
  bookScore,
  knobsFor,
  marketCatchesUpSolved,
  marketFor,
  noPullEdgeSolved,
  removesText,
  staleText,
} from '../src/lessons/weather/ch6/L6_5';
import { hedgeFit, exposureSeries } from '../src/engines/weather/exposureFit';
import { summarize } from '../src/engines/weather/exposure';
import { bookOutcome, novemberFirst } from '../src/engines/weather/desk';
import { MARKET, expectedIndex } from '../src/engines/weather/market';
import { SEASON_STRIP, replayBook } from '../src/engines/weather/portfolio';

const R = REGION_DEFAULTS;

describe('weather 6.1', () => {
  it('splits the winter-to-winter variance into ENSO, the trend and the days', () => {
    const c = fenwickWinters();
    const noTrend = regionWinters({ ...R, trend: 0 });
    const trend = trendShareOf(c, noTrend);
    expect(pct(c.r2)).toBe('23%');
    expect(pct(1 - c.r2)).toBe('77%');
    expect(fmt(c.sd)).toBe('231');
    expect(fmt(noTrend.sd)).toBe('222');
    expect(fmt(trend * 100)).toBe('8');
    expect(pct(1 - c.r2 - trend)).toBe('69%');
  });
  it('quotes El Niño and La Niña winters as departures with the right signs', () => {
    const c = fenwickWinters();
    expect(c.elMean - c.mean).toBeLessThan(0);
    expect(c.laMean - c.mean).toBeGreaterThan(0);
  });
  it('names the weakest pull that solves the second challenge in Fenwick Bay’s geography', () => {
    expect(ensoShareSolved({ ...R, ensoF: ENSO_PULL_ANSWER })).toBe(true);
    expect(ensoShareSolved({ ...R, ensoF: ENSO_PULL_ANSWER - 0.1 })).toBe(false);
    expect(ensoShareSolved(R)).toBe(false);
  });
});

describe('weather 6.2', () => {
  it('keeps ENSO a minority of the skill past a week, and the majority only at fifteen days in January', () => {
    expect(ensoMajorityFrom(R, 0)).toBe(MAX_LEAD);
    for (let l = 7; l < MAX_LEAD; l++) expect(ensoShareOfSkill(R, 0, l)).toBeLessThan(0.5);
    expect(ensoShareOfSkill(R, 0, MAX_LEAD)).toBeGreaterThan(0.5);
    expect(pct(modelSkill(R, 0, 10), 1)).toBe('6.0%');
    expect(pct(modelSkill({ ...R, ensoF: 0 }, 0, 10), 1)).toBe('5.3%');
  });
  it('finds the calibrated model the best of the fixed forecasters at every lead of every winter month', () => {
    for (const m of [11, 0, 1]) {
      for (const s of seasonScores(R, m, FORECASTER_DEFAULTS)) {
        expect(s.crps.model).toBeLessThan(Math.min(s.crps.raw, s.crps.persistence, s.crps.climate));
      }
    }
  });
});

describe('weather 6.3', () => {
  it('fits a little more than the rule’s $54,000 per degree day, the wind’s doing', () => {
    const fit = hedgeFit(exposureSeries('utility', 1, regionKnobs(R), 'weather-ch6-utility'));
    expect(DOLLARS_PER_HDD).toBe(54_000);
    expect(fit.slope).toBeGreaterThan(DOLLARS_PER_HDD);
    expect(fit.slope).toBeLessThan(57_000);
  });
  it('measures the farm’s 1-in-20 year against its average, like the readout', () => {
    const s = summarize(archiveResults('farm', R));
    expect(s.mean - s.p5).toBeGreaterThan(0);
  });
});

describe('weather 6.4', () => {
  const v = viewDefaults(R);
  it('keeps the second challenge’s message true in Fenwick Bay', () => {
    const knobs = knobsOf(R, v.ensoF);
    const minVar = minVarianceStrips(knobs, 1);
    expect(fmt(minVar)).toBe('2,777');
    const best = bestStrips(DESK_WINTER, DESK_DEFAULTS, 'utility', 1, marketOf(v), knobs);
    expect(best.strips).toBe(2700);
    const book = bookOutcome(DESK_WINTER, { ...deskBook(DESK_DEFAULTS), hedgeStrips: best.strips }, 'utility', 1, marketOf(v), knobs);
    const fair = expectedIndex(SEASON_STRIP, DESK_WINTER, novemberFirst(DESK_WINTER) - 1, { knobs });
    const text = hedgeSuccessText(best.strips, book.p5, minVar, book.hedgePrice, fair);
    expect(text).toContain('a little below');
    expect(text).toContain('The market sold the strip cheap');
  });
  it('keeps it true where the best hedge is none at all', () => {
    const region = { ...R, ensoF: 2.1 };
    const rv = viewDefaults(region);
    const knobs = knobsOf(region, rv.ensoF);
    const best = bestStrips(DESK_WINTER, DESK_DEFAULTS, 'utility', 1, marketOf(rv), knobs);
    expect(best.strips).toBe(0);
    expect(hedgeSolved(region, rv, { ...DESK_DEFAULTS, hedgeStrips: 0 }, 'utility', 1)).toBe(true);
    expect(hedgeSolved(region, rv, { ...DESK_DEFAULTS, hedgeStrips: 2700 }, 'utility', 1)).toBe(false);
    const book = bookOutcome(DESK_WINTER, deskBook(DESK_DEFAULTS), 'utility', 1, marketOf(rv), knobs);
    expect(book.p5).toBeGreaterThan(0);
    const fair = expectedIndex(SEASON_STRIP, DESK_WINTER, novemberFirst(DESK_WINTER) - 1, { knobs });
    const text = hedgeSuccessText(0, book.p5, minVarianceStrips(knobs, 1), book.hedgePrice, fair);
    expect(text).toContain('none at all');
    expect(text).toContain('even the 1-in-20 result is a gain');
  });
  it('follows the reader’s size in the second challenge', () => {
    const knobs = knobsOf(R, v.ensoF);
    expect(Math.round(minVarianceStrips(knobs, 0.85))).toBe(2361);
    expect(hedgeSolved(R, v, { ...DESK_DEFAULTS, hedgeStrips: 2300 }, 'utility', 0.85)).toBe(true);
  });
  it('explains why the book’s spread is narrower than the archive’s', () => {
    const knobs = knobsOf(R, v.ensoF);
    const archive = archiveMarginSd(regionKnobs(R));
    expect(archive / 1e6).toBeCloseTo(12.98, 1);
    const fromOct31 = bookOutcome(DESK_WINTER, { ...deskBook(DESK_DEFAULTS), months: [] }, 'utility', 1, MARKET, knobs);
    const fromDec3 = bookOutcome(DESK_WINTER, deskBook(DESK_DEFAULTS), 'utility', 1, MARKET, knobs);
    expect(fromOct31.sd).toBeLessThan(archive);
    expect(fromDec3.sd).toBeLessThan(fromOct31.sd);
    expect(fmt(fromDec3.sd / 1e6, 1)).toBe('10.0');
  });
});

describe('weather 6.5', () => {
  const ref = (desk = {}, w = {}) => bookScore(R, REF_BUSINESS, { ...REF_DESK, ...desk }, { ...WORLD_DEFAULTS, ...w });
  it('misses its October plan a little less than its winters vary around their average', () => {
    const r = ref();
    expect(fmt(r.missSd / 1e6, 1)).toBe('12.5');
    expect(r.missSd).toBeLessThan(archiveMarginSd(regionKnobs(R)));
  });
  it('grows the risk by less than double when the variability doubles', () => {
    const ratio = ref({}, { variability: 2 }).missSd / ref().missSd;
    expect(fmt(ratio, 2)).toBe('1.73');
  });
  it('traces the ENSO-priced market’s trades to its stale view', () => {
    const priced = ref({}, { usesEnso: true });
    expect(priced.trades).toBe(7);
    expect(ref({}, { usesEnso: true, lag: 0 }).trades).toBe(0);
    // Every one is a December or January trade, decided on October 2 or November 2: two days of lag
    // reach back into the previous month, and with it the previous month's ENSO outlook.
    const book = replayBook(bookOf(REF_BUSINESS, REF_DESK), knobsFor(R, WORLD_DEFAULTS), marketFor({ ...WORLD_DEFAULTS, usesEnso: true }));
    const trades = book.winters.flatMap((w) => w.trades);
    expect(trades.length).toBe(7);
    for (const t of trades) {
      expect([9, 10]).toContain(t.month);
      expect(t.day).toBe(2);
    }
  });
  it('quotes the wide-spread world back at 60 days, with the Pacific and the lag restored', () => {
    const wide = ref({}, { halfSpread: 15 });
    const r = ref();
    expect(REF_DESK.lead).toBe(60);
    expect(wide.trades).toBe(39);
    expect(wide.tradingTotal).toBeLessThan(0.5 * r.tradingTotal);
    expect(wide.tradingTotal).toBeGreaterThan(0);
    expect(ref({ lead: 5 }, { halfSpread: 15, pull: 0, lag: 0 }).trades).toBe(0);
  });
  it('labels a hedge that adds risk, and the market’s staleness, in words', () => {
    expect(removesText(bookScore(R, { kind: 'farm', scale: 1 }, REF_DESK, WORLD_DEFAULTS).effectiveness)).toBe('adds risk');
    expect(removesText(0.977)).toBe('98%');
    expect(staleText(0)).toBe('fresh');
    expect(staleText(1)).toBe('1 day stale');
    expect(staleText(2)).toBe('2 days stale');
  });
});

// ---------------------------------------------------------------------------
// Pass 2: the redesigned challenges (each unsolved by default, solved by its answer, not by its
// near misses) and the capstone-state mechanics.

describe('weather 6.1 challenges, predict then check', () => {
  const c = fenwickWinters();
  it('doubles the days’ swings without doubling the winters’ spread', () => {
    expect(doubledSolved(R)).toBe(false);
    expect(doubledSolved({ ...R, variability: DOUBLED })).toBe(true);
    expect(doubledSolved({ ...R, variability: 1.95 })).toBe(false);
    expect(doubledSolved({ ...R, variability: 2.05 })).toBe(false);
    expect(doubledSolved({ ...R, variability: DOUBLED, latitude: 45 })).toBe(false);
    const w = regionWinters({ ...R, variability: DOUBLED });
    expect(fmt(c.sd)).toBe('231');
    expect(fmt(2 * c.sd)).toBe('462');
    expect(fmt(w.sd)).toBe('396');
    expect(fmt(w.sd / c.sd, 2)).toBe('1.71');
    expect(fmt(w.mean)).toBe('4,137');
    expect(w.mean).toBeGreaterThan(c.mean);
    const half = regionWinters({ ...R, variability: 1.5 });
    expect(fmt(half.sd / c.sd, 2)).toBe('1.37');
    expect(fmt(half.sd)).toBe('317');
  });
  it('quiets the days, and the shares predict ENSO falls just short of half', () => {
    expect(quietedSolved(R)).toBe(false);
    expect(quietedSolved({ ...R, variability: QUIETED })).toBe(true);
    expect(quietedSolved({ ...R, variability: 0.45 })).toBe(false);
    expect(quietedSolved({ ...R, variability: 0.55 })).toBe(false);
    const trend = trendShareOf(c, regionWinters({ ...R, trend: 0 }));
    const days = 1 - c.r2 - trend;
    expect(fmt((days * 100) / 4)).toBe('17');
    const predicted = c.r2 / (c.r2 + trend + days / 4);
    expect(pct(predicted)).toBe('48%');
    expect(predicted).toBeLessThan(0.5);
    const w = regionWinters({ ...R, variability: QUIETED });
    expect(pct(w.r2)).toBe('43%');
    expect(w.r2).toBeLessThan(predicted);
    // A little more pull carries it past half; 0.1 less doesn't.
    expect(ensoShareSolved({ ...R, variability: QUIETED, ensoF: QUIET_PULL_ANSWER })).toBe(true);
    expect(pct(regionWinters({ ...R, variability: QUIETED, ensoF: QUIET_PULL_ANSWER }).r2)).toBe('51%');
    expect(ensoShareSolved({ ...R, variability: QUIETED, ensoF: QUIET_PULL_ANSWER - 0.1 })).toBe(false);
  });
});

describe('weather 6.2 challenges', () => {
  it('asks for the bias that wins by the most, which the month’s average miss predicts', () => {
    const cm = challengeMonth(R);
    expect(fmt(cm.err, 1)).toBe('1.9');
    expect(cm.bias).toBe(2);
    expect(fmt(cm.crps, 2)).toBe('3.12');
    expect(fmt(cm.model, 2)).toBe('3.29');
    expect(cm.byBias.get(4)!).toBeGreaterThan(cm.model);
    expect(fmt(cm.byBias.get(4)!, 2)).toBe('3.35');
    const one = (bias: number, extra = {}) => beatModelSolved(CHALLENGE_MONTH, { ...FORECASTER_DEFAULTS, bias, ...extra });
    expect(one(0)).toBe(false);
    expect(one(2)).toBe(true);
    // One notch already beats the model, but not by the most.
    expect(cm.byBias.get(0.5)!).toBeLessThan(cm.model);
    expect(one(0.5)).toBe(false);
    expect(one(1.5)).toBe(false);
    expect(one(2.5)).toBe(false);
    expect(one(2, { spread: 1.1 })).toBe(false);
    expect(beatModelSolved({ ...CHALLENGE_MONTH, year: 21 }, { ...FORECASTER_DEFAULTS, bias: 2 })).toBe(false);
  });
  it('finds the 15% horizon at six days in January and seven in December and February', () => {
    expect(skillLeadSolved('jan', 5)).toBe(false);
    expect(skillLeadSolved('jan', 6)).toBe(true);
    expect(skillLeadSolved('jan', 7)).toBe(false);
    expect(skillLeadSolved('dec', 7)).toBe(true);
    expect(skillLeadSolved('feb', 7)).toBe(true);
    // The default (five days) is unsolved; the success message's ENSO lead for each month.
    expect([ensoMajorityFrom(R, 11), ensoMajorityFrom(R, 0), ensoMajorityFrom(R, 1)]).toEqual([12, 15, 13]);
  });
});

describe('weather 6.3 challenges', () => {
  const knobs = regionKnobs(R);
  const key = JSON.stringify(R);
  it('predicts the board’s largest utility from the 1-in-20 at × 1', () => {
    const o = outlook('season', STORY_WINTER, BOARD_OFFSET, knobs, key);
    const unit = shortfallAtUnit(o);
    expect(fmt(unit / 1e6, 1)).toBe('11.3');
    expect(fmt(10_000_000 / unit, 2)).toBe('0.89');
    expect(boardAnswer(unit)).toBe(0.85);
    expect(fmt((0.85 * unit) / 1e6, 2)).toBe('9.59');
    expect(fmt((0.9 * unit) / 1e6, 2)).toBe('10.16');
    const st = { kind: 'utility' as const, period: 'season' as const, winter: STORY_WINTER, offset: BOARD_OFFSET };
    expect(boardSolved({ ...st, scale: 1, offset: -60 }, outlook('season', STORY_WINTER, -60, knobs, key))).toBe(false);
    expect(boardSolved({ ...st, scale: 1 }, o)).toBe(false);
    expect(boardSolved({ ...st, scale: 0.85 }, o)).toBe(true);
    expect(boardSolved({ ...st, scale: 0.8 }, o)).toBe(false);
    expect(boardSolved({ ...st, scale: 0.9 }, o)).toBe(false);
    expect(boardSolved({ ...st, scale: 0.85, winter: 21 }, outlook('season', 21, BOARD_OFFSET, knobs, key))).toBe(false);
  });
  it('asks for the strips at the reader’s own size', () => {
    const at = (k: number) => exposureSeries('utility', k, knobs, `ch6-p2-${k}`);
    expect(stripsSolved('utility', 0, at(1))).toBe(false);
    expect(stripsSolved('utility', 2800, at(1))).toBe(true);
    expect(stripsSolved('utility', 2400, at(0.85))).toBe(true);
    expect(stripsSolved('utility', 2300, at(0.85))).toBe(false);
    expect(stripsSolved('utility', 2500, at(0.85))).toBe(false);
    expect(fmt(hedgeFit(at(0.85)).strips)).toBe('2,361');
  });
});

describe('weather 6.4 and 6.5: one strip range, and the desk challenges', () => {
  it('uses the same ranges in every lesson', () => {
    expect(STRIPS_MAX).toBe(DESK_RANGE.strips.max);
    expect(STRIP_GRID[STRIP_GRID.length - 1]).toBe(DESK_RANGE.strips.max);
    expect(DESK_RANGE.threshold.step).toBe(1);
    // The utility at × 2, the largest size, still fits.
    expect(minVarianceStrips(regionKnobs(R), 2)).toBeLessThan(DESK_RANGE.strips.max);
  });
  it('still puts 6.4’s best hedge just below the minimum-variance one on the wider grid', () => {
    const v = viewDefaults(R);
    const knobs = knobsOf(R, v.ensoF);
    expect(bestStrips(DESK_WINTER, DESK_DEFAULTS, 'utility', 1, marketOf(v), knobs).strips).toBe(2700);
    expect(hedgeSolved(R, v, DESK_DEFAULTS, 'utility', 1)).toBe(false);
    expect(hedgeSolved(R, v, { ...DESK_DEFAULTS, hedgeStrips: 2800 }, 'utility', 1)).toBe(false);
    expect(hedgeSolved(R, v, { ...DESK_DEFAULTS, hedgeStrips: 2600 }, 'utility', 1)).toBe(false);
    const book = bookOutcome(DESK_WINTER, deskBook(DESK_DEFAULTS), 'utility', 1, marketOf(v), knobs);
    const fair = expectedIndex(SEASON_STRIP, DESK_WINTER, novemberFirst(DESK_WINTER) - 1, { knobs });
    expect(fmt(book.hedgePrice)).toBe('4,091');
    expect(fmt(fair)).toBe('4,257');
  });
  it('makes the market catch up only when it prices ENSO and its forecasts are (nearly) fresh', () => {
    const solved = (w: Partial<typeof WORLD_DEFAULTS>, desk = REF_DESK) => marketCatchesUpSolved(R, REF_BUSINESS, desk, { ...WORLD_DEFAULTS, ...w });
    expect(solved({})).toBe(false);
    expect(solved({ usesEnso: true })).toBe(false);
    expect(bookScore(R, REF_BUSINESS, REF_DESK, { ...WORLD_DEFAULTS, usesEnso: true }).trades).toBe(7);
    expect(solved({ lag: 0 })).toBe(false);
    expect(solved({ usesEnso: true, lag: 0 })).toBe(true);
    expect(solved({ usesEnso: true, lag: 1 })).toBe(true);
    // The physical route is the prose's, not this challenge's.
    expect(solved({ pull: 0 })).toBe(false);
    expect(solved({ pull: 0, usesEnso: true, lag: 0 })).toBe(false);
    // The desk has to be open and the strips sold.
    expect(solved({ usesEnso: true, lag: 0 }, { ...REF_DESK, size: 0 })).toBe(false);
    expect(solved({ usesEnso: true, lag: 0 }, { ...REF_DESK, hedgeStrips: 0 })).toBe(false);
  });
  it('brings the desk’s edge back, with no pull, only within the forecasts’ reach', () => {
    const at = (lead: number) => bookScore(R, REF_BUSINESS, { ...REF_DESK, lead }, NO_PULL);
    expect(noPullEdgeSolved(R, REF_BUSINESS, REF_DESK)).toBe(false);
    expect(at(60).trades).toBe(0);
    for (const lead of [15, 30, 90]) expect(noPullEdgeSolved(R, REF_BUSINESS, { ...REF_DESK, lead })).toBe(false);
    // Ten days out it trades, and loses.
    expect(at(10).trades).toBe(10);
    expect(at(10).tradingTotal).toBeLessThan(0);
    expect(noPullEdgeSolved(R, REF_BUSINESS, { ...REF_DESK, lead: 10 })).toBe(false);
    expect(noPullEdgeSolved(R, REF_BUSINESS, { ...REF_DESK, lead: 5 })).toBe(true);
    expect(noPullEdgeSolved(R, REF_BUSINESS, { ...REF_DESK, lead: 0 })).toBe(true);
    expect(at(5).trades).toBe(57);
    // With the market's forecasts fresh too, that edge is gone.
    for (const lead of [0, 5]) expect(bookScore(R, REF_BUSINESS, { ...REF_DESK, lead }, { ...NO_PULL, lag: 0 }).trades).toBe(0);
  });
});

describe('weather capstone state', () => {
  afterEach(() => {
    resetCapstone();
    vi.restoreAllMocks();
  });
  it('loads the reference book the text of 6.5 quotes', () => {
    expect(REF_DESK).toEqual({ ...DESK_DEFAULTS, hedgeStrips: 2800 });
    expect(REFERENCE_BOOK.hedgeStrips).toBe(2800);
  });
  it('compares parts to rounding, and months as a set', () => {
    expect(samePart('region', { ...R, variability: 1 + 1e-12 }, R)).toBe(true);
    expect(samePart('business', { kind: 'utility', scale: 0.85 }, { kind: 'utility', scale: 1 })).toBe(false);
    expect(samePart('desk', { ...DESK_DEFAULTS, months: [0, 11, 1] }, DESK_DEFAULTS)).toBe(true);
    const s = { ...CAPSTONE_DEFAULTS, desk: REFERENCE_BOOK };
    expect(atReference(s, ['region', 'business', 'desk'], { desk: REFERENCE_BOOK })).toBe(true);
    expect(atReference(s, ['region', 'business', 'desk'], {})).toBe(false);
  });
  it('asks before a reset, and resets only the lesson’s own part', () => {
    updateCapstone('region', { latitude: 45 });
    updateCapstone('business', { scale: 0.85 });
    const no = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmResetPart('business')).toBe(false);
    expect(no).toHaveBeenCalledTimes(1);
    expect(getWeatherCapstone().business.scale).toBe(0.85);
    no.mockReturnValue(true);
    expect(confirmResetPart('business')).toBe(true);
    expect(getWeatherCapstone().business.scale).toBe(1);
    expect(getWeatherCapstone().region.latitude).toBe(45);
    // An unchanged part resets without asking.
    no.mockClear();
    expect(confirmResetPart('desk')).toBe(true);
    expect(no).not.toHaveBeenCalled();
    setCapstoneParts({ region: R });
    expect(getWeatherCapstone().region).toEqual(R);
  });
});
