// Chapter 3 of the agriculture course: the numbers its prose quotes and its challenges' answers.

import { describe, expect, it } from 'vitest';
import { describe as describeSample, quantile } from '../src/engines/strategy/distribution';
import { valleySeason } from '../src/engines/agriculture/valley';
import { simulateSeason } from '../src/engines/agriculture/crop';
import { fieldSeason } from '../src/engines/agriculture/farm';
import { canopyReflectance, ndvi, seasonNdvi } from '../src/engines/agriculture/vegetation';
import { forecastSets, observe } from '../src/engines/agriculture/forecast';
import { REFERENCE_YEAR, applyShift, simulatedYear, withEvents } from '../src/model/agriculture/climate';
import { DISTRICT, DISTRICTS, VALLEY_CORN_KAC, dayOf } from '../src/model/agriculture/region';
import { WARMER, annualRain, summerRain, suitability, switchesToWheat, warmerSolved, yearToYearRows } from '../src/lessons/agriculture/ch3/L3_1';
import { SILKING, SILKING_LOSS_PCT, droughtSolved, freezeSolved, type LabState } from '../src/lessons/agriculture/ch3/L3_2';
import { FULL_LAI, THIN_LAI, blightLooks, lookalikeSolved, shown } from '../src/lessons/agriculture/ch3/L3_3';
import { Z80, bandCount, crps, fitFor, meanScore, pairSolved, partnerErrors } from '../src/lessons/agriculture/ch3/L3_4';
import { independentSolved, normalWeatherProduction, pairStats, production, sharedTenth } from '../src/lessons/agriculture/ch3/L3_5';

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('agriculture 3.1: climate and crop suitability', () => {
  it('quotes annual and summer rain as the map shows it', () => {
    expect(Math.round(annualRain('bottoms'))).toBe(38);
    expect(Math.round(annualRain('plains'))).toBe(22);
    expect(r1(summerRain('bottoms'))).toBe(16.7);
    expect(r1(summerRain('plains'))).toBe(11.6);
  });
  it('cools the whole valley, and the North’s corn falls from 137 to 106', () => {
    expect(Math.round(suitability({ rain: 1, temp: 0, soil: 1 }).north.corn)).toBe(137);
    expect(Math.round(suitability({ rain: 1, temp: -3, soil: 1 }).north.corn)).toBe(106);
  });
  it('shows irrigated Plains corn beating both dryland crops, and steadier', () => {
    const p = suitability({ rain: 1, temp: 0, soil: 1 }).plains;
    expect(p.irrigatedMargin).toBeGreaterThan(Math.max(p.cornMargin, p.wheatMargin));
    const rows = yearToYearRows('corn');
    expect(rows.length).toBe(6);
    expect(Math.round(rows[5].cv * 100)).toBe(9);
    expect(yearToYearRows('wheat').length).toBe(5);
  });
  it('averages 506 and 239 million bushels over the 50 seasons', () => {
    const v = Array.from({ length: 50 }, (_, i) => valleySeason(i + 1));
    expect(Math.round(v.reduce((s, x) => s + x.corn, 0) / 50 / 1e6)).toBe(506);
    expect(Math.round(v.reduce((s, x) => s + x.wheat, 0) / 50 / 1e6)).toBe(239);
  });
});

describe('agriculture 3.1: the warmer-valley challenge', () => {
  const today = { rain: 1, temp: 0, soil: 1 };
  it('starts unsolved, and only the North Tier solves it at +2 °C', () => {
    expect(warmerSolved(today, 'ridge')).toBe(false);
    expect(warmerSolved(today, 'north')).toBe(false);
    expect(warmerSolved(WARMER, 'north')).toBe(true);
    for (const id of ['plains', 'prairie', 'ridge', 'bottoms'] as const) expect(warmerSolved(WARMER, id)).toBe(false);
    expect(warmerSolved({ rain: 1, temp: 1.5, soil: 1 }, 'north')).toBe(false);
    expect(warmerSolved({ rain: 1, temp: 2, soil: 1.1 }, 'north')).toBe(false);
  });
  it('switches the North, and only the North, both 2 °C warmer and at 80% rain', () => {
    for (const c of [WARMER, { rain: 0.8, temp: 0, soil: 1 }]) {
      expect(DISTRICTS.filter((d) => switchesToWheat(c, d.id)).map((d) => d.id)).toEqual(['north']);
    }
    const t = suitability(today);
    expect(t.ridge.best).toBe('wheat');
    expect(t.plains.best).toBe('wheat');
    const w = suitability(WARMER);
    expect(Math.round(t.north.corn)).toBe(137);
    expect(Math.round(w.north.corn)).toBe(119);
    expect(Math.round(w.north.cornMargin)).toBe(110);
    expect(Math.round(w.north.wheatMargin)).toBe(169);
    for (const d of DISTRICTS) expect(w[d.id].corn).toBeLessThan(t[d.id].corn);
    const hot = suitability({ rain: 1, temp: 3, soil: 1 });
    expect(hot.prairie.best).toBe('corn');
    expect(hot.bottoms.best).toBe('corn');
  });
  it('hurries the North’s corn even with water to spare', () => {
    const N = DISTRICT.north;
    const opts = { crop: 'corn' as const, plantDay: dayOf(5, 1), maturityGdd: N.hybridGdd, pawIn: 100, startWater: 1 };
    let base = 0;
    let warm = 0;
    let earlier = 0;
    for (let y = 1; y <= 50; y++) {
      const w = simulatedYear(y, 'north');
      const a = simulateSeason(w, opts);
      const b = simulateSeason(applyShift(w, { rain: 1, temp: 2 }), opts);
      base += a.yield;
      warm += b.yield;
      earlier += a.maturityDay - b.maturityDay;
    }
    expect(warm).toBeLessThan(base * 0.92);
    expect(earlier / 50).toBeGreaterThan(14);
  });
  it('tips the Ridge to corn with a tenth more water-holding, and its wheat hardly notices', () => {
    const a = suitability(today).ridge;
    const b = suitability({ rain: 1, temp: 0, soil: 1.1 }).ridge;
    expect(Math.round(b.cornMargin)).toBe(224);
    expect(Math.round(b.wheatMargin)).toBe(199);
    expect(Math.abs(b.wheat - a.wheat)).toBeLessThan(0.5);
  });
});

describe('agriculture 3.2: extreme weather', () => {
  const st = (o: Partial<LabState>): LabState => ({ crop: 'corn', kind: 'drought', date: dayOf(7, 17), days: 21, degrees: 6, low: -3, ...o });
  it('starts the dry-spell demonstration unsolved, at silking', () => {
    expect(droughtSolved(st({}))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(6, 13) }))).toBe(true);
    expect(droughtSolved(st({ date: dayOf(6, 13), days: 28 }))).toBe(false);
  });
  it('costs the wheat only a few percent with a −2 °C night around flowering', () => {
    const w = simulatedYear(REFERENCE_YEAR, 'prairie');
    const grow = (low: number, day: number) =>
      simulateSeason(withEvents(w, [{ kind: 'frost', day, low }]), { crop: 'wheat', pawIn: DISTRICT.prairie.pawIn, startWater: DISTRICT.prairie.springWater }).yield;
    const base = simulateSeason(w, { crop: 'wheat', pawIn: DISTRICT.prairie.pawIn, startWater: DISTRICT.prairie.springWater }).yield;
    for (let d = dayOf(5, 21); d <= dayOf(6, 5); d++) expect(1 - grow(-2, d) / base).toBeLessThan(0.05);
    expect(freezeSolved({ crop: 'wheat', kind: 'frost', date: dayOf(5, 10), days: 21, degrees: 6, low: -4 })).toBe(false);
  });
});

describe('agriculture 3.2: the prediction challenges', () => {
  const st = (o: Partial<LabState>): LabState => ({ crop: 'corn', kind: 'drought', date: SILKING, days: 21, degrees: 6, low: -3, ...o });
  const P = DISTRICT.prairie;
  const corn = (start: number, days = 21) =>
    simulateSeason(withEvents(simulatedYear(REFERENCE_YEAR, 'prairie'), [{ kind: 'drought', start, days }]), {
      crop: 'corn',
      plantDay: dayOf(5, 1),
      maturityGdd: P.hybridGdd,
      pawIn: P.pawIn,
      startWater: P.springWater,
    }).yield;
  it('sets the dry spell at silking, July 17, where it costs 8%', () => {
    expect(SILKING).toBe(dayOf(7, 17));
    expect(SILKING_LOSS_PCT).toBe(8);
  });
  it('solves only for spells that start three weeks or more before silking', () => {
    expect(droughtSolved(st({}))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(6, 13) }))).toBe(true);
    expect(droughtSolved(st({ date: dayOf(6, 11) }))).toBe(true);
    expect(droughtSolved(st({ date: dayOf(6, 10) }))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(6, 16) }))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(7, 10) }))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(6, 13), days: 28 }))).toBe(false);
    for (let d = dayOf(5, 15); d <= dayOf(10, 1); d++) if (droughtSolved(st({ date: d }))) expect(d).toBeLessThanOrEqual(SILKING - 21);
  });
  it('finds the worst start on June 13', () => {
    let worst = dayOf(5, 15);
    for (let d = dayOf(5, 15); d <= dayOf(10, 1); d++) if (corn(d) < corn(worst)) worst = d;
    expect([dayOf(6, 13), dayOf(6, 14)]).toContain(worst);
    expect(Math.round(corn(dayOf(6, 13)))).toBe(153);
    expect(Math.round(corn(SILKING))).toBe(172);
  });
  it('starts the freeze challenge unsolved, and solves it the day after boot', () => {
    expect(freezeSolved({ crop: 'corn', kind: 'frost', date: dayOf(8, 15), days: 21, degrees: 6, low: -3 })).toBe(false);
    const w = (date: number) => ({ crop: 'wheat' as const, kind: 'frost' as const, date, days: 21, degrees: 6, low: -4 });
    expect(freezeSolved(w(dayOf(5, 21)))).toBe(true);
    expect(freezeSolved(w(dayOf(5, 20)))).toBe(false);
    expect(freezeSolved(w(dayOf(5, 24)))).toBe(false);
  });
});

describe('agriculture 3.3: satellite crop observations', () => {
  it('makes a full, yellowing canopy read like a thin, healthy one at 75% chlorophyll', () => {
    expect(THIN_LAI).toBe(2);
    expect(FULL_LAI).toBe(5);
    expect(shown(2)).toBe(0.664);
    expect(shown(5, 0.75)).toBe(0.669);
    expect(lookalikeSolved(2, 1, 0)).toBe(false);
    expect(lookalikeSolved(5, 1, 0)).toBe(false);
    expect(lookalikeSolved(5, 0.75, 0)).toBe(true);
    expect(lookalikeSolved(5, 0.7, 0)).toBe(false);
    expect(lookalikeSolved(5, 0.8, 0)).toBe(false);
    expect(lookalikeSolved(5, 0.75, 0.05)).toBe(false);
    expect(lookalikeSolved(4, 0.75, 0)).toBe(false);
    // The paragraph before the challenge: 70% chlorophyll on a full canopy reads 0.64, and water stress at worst 0.75.
    expect(r2(ndvi(canopyReflectance(5, 0.7)))).toBe(0.64);
    expect(r2(ndvi(canopyReflectance(5, 1, 1)))).toBe(0.75);
  });
  it('sees the wet summer little better with daily passes, and no better with clear dry days', () => {
    const b = blightLooks();
    expect([b.all, b.passes, b.mid]).toEqual([14, 37, 0]);
    expect([b.daily, b.days, b.wet]).toEqual([9, 31, 24]);
    expect(b.dailyClearSky).toBe(b.daily);
  });
  it('sees the drought early and green, and the bumper season late', () => {
    const ref = seasonNdvi(fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'corn' }));
    const drought = seasonNdvi(fieldSeason(46, { district: 'prairie', crop: 'corn' }));
    const bumperRun = fieldSeason(180, { district: 'prairie', crop: 'corn' });
    const refRun = fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'corn' });
    const bumper = seasonNdvi(bumperRun);
    expect(r2(drought[dayOf(6, 15)])).toBe(0.74);
    expect(r2(ref[dayOf(6, 15)])).toBe(0.58);
    expect(r2(drought[dayOf(7, 20)])).toBe(0.78);
    for (let d = dayOf(7, 1); d < dayOf(8, 15); d++) expect(Math.abs(bumper[d] - ref[d])).toBeLessThan(0.02);
    expect(r2(bumper[dayOf(9, 1)])).toBe(0.61);
    expect(r2(ref[dayOf(9, 1)])).toBe(0.45);
    expect(Math.round(bumperRun.yield - refRun.yield)).toBe(45);
    expect(bumperRun.maturityDay).toBe(dayOf(9, 30));
    expect(refRun.maturityDay).toBe(dayOf(9, 16));
  });
});

describe('agriculture 3.4: yield forecasting', () => {
  const ALL = ['temp', 'rain', 'ndvi', 'condition'] as const;
  it('errs a little more on the training seasons, which swing more', () => {
    expect(r1(fitFor(dayOf(8, 1), ['temp', 'rain']).rmseTrain)).toBe(20);
    expect(r1(fitFor(dayOf(8, 1), []).rmseTrain)).toBe(26.5);
    expect(r1(fitFor(dayOf(8, 1), []).rmseTest)).toBe(25);
  });
  it('follows the ordinary season below its truth, then the wrong way on September 1', () => {
    const dates = [dayOf(6, 15), dayOf(7, 1), dayOf(7, 15), dayOf(8, 1), dayOf(8, 15), dayOf(9, 1)];
    const actual = observe(150, dates[0]).yield;
    const f = dates.map((d) => fitFor(d, [...ALL]).predict(observe(150, d)));
    for (const x of f) expect(x).toBeLessThan(actual);
    const misses = f.map((x) => actual - x);
    expect(Math.min(...misses)).toBe(misses[4]);
    expect(misses[5]).toBeGreaterThan(misses[4]);
    expect(misses[5]).toBeGreaterThan(Z80 * fitFor(dates[5], [...ALL]).rmseTest);
    expect(Math.round(actual)).toBe(185);
    expect(Math.round(misses[5])).toBe(17);
  });
  it('holds about 8 seasons in 10 inside the band, with the misses leaning high', () => {
    const aug1 = bandCount(dayOf(8, 1), ['temp', 'rain']);
    const sep1 = bandCount(dayOf(9, 1), [...ALL]);
    expect(aug1).toEqual({ n: 100, inside: 81, above: 12, below: 7 });
    expect(sep1).toEqual({ n: 100, inside: 80, above: 15, below: 5 });
    expect(sep1.above - sep1.below).toBeGreaterThan(aug1.above - aug1.below);
  });
  it('asks for temperature’s best partner on August 15: the condition rating', () => {
    expect(pairSolved(3, ['temp', 'rain'])).toBe(false);
    expect(pairSolved(4, ['temp', 'condition'])).toBe(true);
    expect(pairSolved(4, ['temp', 'rain'])).toBe(false);
    expect(pairSolved(4, ['temp', 'ndvi'])).toBe(false);
    expect(pairSolved(4, ['ndvi', 'condition'])).toBe(false);
    expect(pairSolved(3, ['temp', 'condition'])).toBe(false);
    expect(pairSolved(4, ['temp', 'rain', 'condition'])).toBe(false);
    const e = partnerErrors();
    expect([r1(e.temp), r1(e.rain), r1(e.ndvi), r1(e.condition)]).toEqual([18.5, 16.9, 18, 13.9]);
    expect(e.condition).toBeLessThan(fitFor(dayOf(8, 15), [...ALL]).rmseTest);
    // By mid-August the satellite mostly repeats temperature: hot summers brown the fields.
    const train = forecastSets(dayOf(8, 15)).train;
    const t = train.map((o) => o.temp);
    const n = train.map((o) => o.ndvi);
    const mt = t.reduce((a, b) => a + b, 0) / t.length;
    const mn = n.reduce((a, b) => a + b, 0) / n.length;
    const cov = t.reduce((a, x, i) => a + (x - mt) * (n[i] - mn), 0);
    const corr = cov / Math.sqrt(t.reduce((a, x) => a + (x - mt) ** 2, 0) * n.reduce((a, x) => a + (x - mn) ** 2, 0));
    expect(corr).toBeLessThan(-0.5);
  });
  it('draws the best band at about one and a half times the average miss', () => {
    const date = dayOf(8, 1);
    const pr: Array<'temp' | 'rain'> = ['temp', 'rain'];
    const half = Z80 * fitFor(date, pr).rmseTest;
    const miss = meanScore(date, pr, 0);
    expect(Math.round(half)).toBe(24);
    expect(r1(miss)).toBe(15.3);
    expect(half / miss).toBeGreaterThan(1.5);
    expect(half / miss).toBeLessThan(1.6);
    let best = 0.5;
    for (let w = 0.5; w <= 2.001; w += 0.01) if (meanScore(date, pr, w) < meanScore(date, pr, best)) best = w;
    expect(best).toBeGreaterThan(0.95);
    expect(best).toBeLessThan(1.1);
    expect((Z80 * best * fitFor(date, pr).rmseTest) / miss).toBeLessThan(1.7);
  });
  it('scores a bare number as its miss, and an honest band best', () => {
    expect(crps(10, 0, 13)).toBe(3);
    expect(crps(10, 1e-6, 13)).toBeCloseTo(3, 4);
    // A bell-shaped forecast that is exactly right still pays a little for its width: σ(√2 − 1)/√π.
    expect(crps(0, 1, 0)).toBeCloseTo((Math.SQRT2 - 1) / Math.sqrt(Math.PI), 5);
    const sc = (w: number) => meanScore(dayOf(8, 1), ['temp', 'rain'], w);
    expect(r1(sc(0))).toBe(15.3);
    expect(r1(sc(1))).toBe(10.7);
    expect(r1(sc(2))).toBe(12.3);
    expect(r1(sc(0.5))).toBe(11.7);
    let best = 0.5;
    for (let w = 0.5; w <= 2.001; w += 0.05) if (sc(w) < sc(best)) best = w;
    expect(best).toBeGreaterThan(0.8);
    expect(best).toBeLessThan(1.25);
  });
});

describe('agriculture 3.5: uncertainty and harvest distributions', () => {
  const corn = Array.from({ length: 400 }, (_, i) => production(i + 1, 'corn', false));
  const d = describeSample(corn);
  it('defines the standard deviation with the numbers the prose gives', () => {
    expect(Math.round(d.stdev)).toBe(64);
    expect(corn.filter((x) => Math.abs(x - d.mean) <= d.stdev).length).toBe(260);
    expect(r2((d.mean - d.q05) / d.stdev)).toBe(1.81);
    expect(r2((d.q95 - d.mean) / d.stdev)).toBe(1.45);
    expect(Math.round(d.q95)).toBe(599);
    expect(Math.round(d.median)).toBe(512);
    expect(Math.round(d.mean - d.min)).toBe(237);
    expect(Math.round(d.max - d.mean)).toBe(124);
  });
  it('fills in the tail slowly', () => {
    const at = (n: number) => describeSample(corn.slice(0, n));
    expect(Math.round(at(10).mean)).toBe(521);
    expect(Math.round(at(50).mean)).toBe(506);
    expect(Math.round(at(200).mean)).toBe(507);
    expect(Math.round(at(200).q05)).toBe(408);
    expect(corn.indexOf(d.min) + 1).toBe(46);
  });
  it('grows as much with average weather as in the best of the 400 seasons', () => {
    expect(Math.round(normalWeatherProduction().corn)).toBe(Math.round(d.max));
  });
  it('links the Prairie and the Bottoms through shared weather', () => {
    const shared = pairStats(false);
    const separate = pairStats(true);
    expect(r2(shared.correlation)).toBe(0.37);
    expect(Math.abs(separate.correlation)).toBeLessThan(0.15);
    expect(shared.prairieBadSeasons).toBe(40);
    expect(shared.bothBad).toBe(13);
    expect(separate.bothBad).toBe(5);
    expect(shared.bothBad / shared.prairieBadSeasons).toBeGreaterThan(0.25);
    expect(shared.bothBad / shared.prairieBadSeasons).toBeLessThan(0.4);
  });
  it('narrows the valley’s spread when each district draws its own weather', () => {
    const ind = describeSample(Array.from({ length: 400 }, (_, i) => production(i + 1, 'corn', true)));
    expect(Math.round(ind.stdev)).toBe(46);
    expect(Math.round(ind.q05)).toBe(426);
    expect(Math.round(ind.min)).toBe(338);
    expect(Math.abs(ind.mean - d.mean)).toBeLessThan(1);
    const wheat = describeSample(Array.from({ length: 400 }, (_, i) => production(i + 1, 'wheat', false)));
    expect(Math.round(wheat.q05)).toBe(201);
    expect(Math.round(wheat.q95)).toBe(262);
  });
  it('puts about 5 million bushels on each 1% of the 3.1 million corn acres', () => {
    expect(VALLEY_CORN_KAC / 1000).toBe(3.1);
    expect(Math.round(d.mean / 100)).toBe(5);
    expect(quantile(corn, 0.1)).toBeGreaterThan(0);
  });
  it('names 420 as the shared valley’s 1-in-10 bad crop', () => {
    expect(sharedTenth()).toBe(420);
    expect(corn.filter((x) => x < 420).length / corn.length).toBeCloseTo(0.1, 1);
  });
  it('solves only with each district on its own, 200 seasons run, against 420', () => {
    expect(independentSolved(0, 'corn', false, 450)).toBe(false);
    expect(independentSolved(200, 'corn', true, 420)).toBe(true);
    expect(independentSolved(400, 'corn', true, 420)).toBe(true);
    expect(independentSolved(199, 'corn', true, 420)).toBe(false);
    expect(independentSolved(200, 'corn', false, 420)).toBe(false);
    expect(independentSolved(200, 'corn', true, 450)).toBe(false);
    expect(independentSolved(200, 'wheat', true, 420)).toBe(false);
  });
  it('puts fewer than one season in ten below 420 with separate weather, and lifts the 1-in-10 crop', () => {
    for (const n of [200, 400]) {
      const v = Array.from({ length: n }, (_, i) => production(i + 1, 'corn', true));
      expect(v.filter((x) => x < 420).length / n).toBeLessThan(0.05);
      expect(quantile(v, 0.1)).toBeGreaterThan(445);
    }
  });
});
