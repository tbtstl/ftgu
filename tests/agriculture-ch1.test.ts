// Agriculture chapter 1: assertions for the numbers and challenge checks added in the pedagogy fix pass.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { fmt } from '../src/framework';
import { BASAL, CROP, TRANSPIRATION_EFFICIENCY, et0, simulateSeason, vpd, waterLimitedGrowth } from '../src/engines/agriculture/crop';
import { EXTINCTION, STOMATA_CLOSE_BELOW, UMOL_PER_J, interception, stomatalFactor } from '../src/engines/agriculture/photosynthesis';
import { nitrogenSupply, sufficiency } from '../src/engines/agriculture/soil';
import { REFERENCE_YEAR, applyShift, simulatedYear, spliceWeather } from '../src/model/agriculture/climate';
import { CEDAR_BEND, DISTRICT, DISTRICTS, PLACES, dateLabel, dayOf } from '../src/model/agriculture/region';
import Lesson11, { CORN_NINETY, crossingEstimate, districtFacts, ninetySolved, wheatAheadSolved } from '../src/lessons/agriculture/ch1/L1_1';
import { autumnMarks, lateHybridSolved } from '../src/lessons/agriculture/ch1/L1_2';
import { THIN_OM_N, limitingLabel, ridgeSolved } from '../src/lessons/agriculture/ch1/L1_3';
import { JULY, triggerSolved } from '../src/lessons/agriculture/ch1/L1_4';
import { SPELL_AT, THIN, grow as grow15, kernelHeadroom, thinnerSolved } from '../src/lessons/agriculture/ch1/L1_5';

const P = DISTRICT.prairie;
const REF = simulatedYear(REFERENCE_YEAR, 'prairie');
const cornOpts = { crop: 'corn' as const, plantDay: dayOf(5, 1), maturityGdd: P.hybridGdd, pawIn: P.pawIn, startWater: P.springWater };
const ref = simulateSeason(REF, cornOpts);
const shifted = (temp: number, extra: Partial<typeof cornOpts> = {}) => simulateSeason(applyShift(REF, { temp }), { ...cornOpts, ...extra });

describe('agriculture 1.1', () => {
  it('closes the stomata at the same point as the water balance', () => {
    expect(STOMATA_CLOSE_BELOW).toBeCloseTo(1 - CROP.corn.stressAt, 10);
    expect(stomatalFactor(0.45)).toBe(1);
    expect(stomatalFactor(0.3)).toBeLessThan(1);
  });
  it('gives the canopy and light numbers in the prose', () => {
    expect(CORN_NINETY).toBe(1300);
    expect(fmt(Math.exp(-EXTINCTION.corn) * 100)).toBe('55');
    expect(fmt(UMOL_PER_J, 1)).toBe('4.6');
    expect(fmt(interception('corn', 5) * 100)).toBe('95');
    expect(fmt(interception('corn', 3) * 100, 1)).toBe('83.5');
  });
  it('asks for the warmest degree at which wheat leads, predictable from the closing gap', () => {
    const leaf = { light: 1500, co2: 420, temp: 28, water: 100 };
    expect(wheatAheadSolved(leaf)).toBe(false);
    expect(wheatAheadSolved({ ...leaf, temp: 18 })).toBe(true);
    // Near misses: wheat still ahead a degree cooler, corn ahead a degree warmer.
    expect(wheatAheadSolved({ ...leaf, temp: 17 })).toBe(false);
    expect(wheatAheadSolved({ ...leaf, temp: 19 })).toBe(false);
    expect(wheatAheadSolved({ ...leaf, temp: 18, co2: 560 })).toBe(false);
    expect(wheatAheadSolved({ ...leaf, temp: 18, light: 1000 })).toBe(false);
    // The answer is the same at any strong light and any soil at least half full.
    for (let light = 1500; light <= 2200; light += 50) {
      expect(wheatAheadSolved({ ...leaf, light, temp: 18 })).toBe(true);
      expect(wheatAheadSolved({ ...leaf, light, temp: 18, water: 50 })).toBe(true);
      const e = crossingEstimate(light, 420, 100);
      expect(Math.abs(e.at - 18)).toBeLessThan(1);
    }
    const e = crossingEstimate(1500, 420, 100);
    expect(fmt(e.rate, 1)).toBe('2.4');
    expect(fmt(e.at)).toBe('18');
  });
  it('asks for the 90% canopy, predictable from 55% per unit of leaf', () => {
    const pass = Math.exp(-EXTINCTION.corn);
    expect([fmt(pass ** 2 * 100), fmt(pass ** 3 * 100), fmt(pass ** 4 * 100)]).toEqual(['30', '17', '9']);
    expect(Math.log(0.1) / Math.log(pass)).toBeGreaterThan(3.8);
    expect(Math.log(0.1) / Math.log(pass)).toBeLessThan(3.9);
    expect(ninetySolved('corn', 5)).toBe(false);
    expect(ninetySolved('corn', 3.9)).toBe(true);
    expect(ninetySolved('corn', 3.8)).toBe(false);
    expect(ninetySolved('corn', 4.0)).toBe(false);
    expect(ninetySolved('wheat', 3.9)).toBe(false);
    // The one-decimal readout tells the near miss from the answer.
    expect(fmt(interception('corn', 3.8) * 100, 1)).toBe('89.8');
    expect(fmt(interception('corn', 3.9) * 100, 1)).toBe('90.4');
  });
});

describe('agriculture 1.1: the valley map', () => {
  afterEach(() => cleanup());
  const MAP = 'Photosynthesis Lab · the Crane Valley';
  const figures = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('figure.fig'));

  it('shows the region before the first demonstration, with every place the model defines', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { container } = render(createElement(Lesson11));
    const figs = figures(container);
    expect(figs[0].getAttribute('aria-label')).toBe(MAP);
    expect(figs[1].getAttribute('aria-label')).toBe('Photosynthesis Lab');
    const svg = figs[0].querySelector('svg')!;
    const names = Array.from(svg.querySelectorAll('text'), (t) => t.textContent);
    for (const d of DISTRICTS) expect(names).toContain(d.name);
    for (const p of PLACES) expect(names).toContain(p.name);
    expect(names).toContain(CEDAR_BEND.name);
    expect(names).toContain('Crane River');
    // The prose introduces the map before the leaf, and points back to it.
    const prose = Array.from(container.querySelectorAll('p'), (el) => el.textContent ?? '');
    expect(prose.some((t) => t.includes('Crane Valley') && t.endsWith('Select a district to see what sets it apart:'))).toBe(true);
    expect(container.querySelector(`[data-fig-focus="${MAP}"]`)).not.toBeNull();
  });

  it('starts on Cedar Bend’s district and describes whichever district is selected', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { container } = render(createElement(Lesson11));
    const map = figures(container)[0];
    const caption = () => map.querySelector('.cap')?.textContent ?? '';
    expect(CEDAR_BEND.district).toBe('prairie');
    expect(caption()).toBe(`${DISTRICT.prairie.name}. ${districtFacts('prairie')}`);
    const plains = map.querySelector<SVGGElement>('[role="button"][aria-label="High Plains"]')!;
    act(() => {
      fireEvent.click(plains);
    });
    expect(plains.getAttribute('aria-pressed')).toBe('true');
    expect(caption()).toBe(`${DISTRICT.plains.name}. ${districtFacts('plains')}`);
  });

  it('builds each district’s caption from the model', () => {
    expect(districtFacts('prairie')).toBe(
      'Deep, dark, rich soils and reliable summer rain: the valley’s best corn ground. It gets 35 inches of rain in a normal year and plants 1.3 million acres of corn and 1 million acres of wheat.',
    );
    expect(districtFacts('plains')).toContain('plants 300,000 acres of corn, 260,000 of them irrigated, and 1.5 million acres of wheat.');
    for (const d of DISTRICTS) {
      expect(districtFacts(d.id).startsWith(d.note)).toBe(true);
      expect(districtFacts(d.id)).toContain(`${d.rainIn} inches of rain`);
    }
  });
});

describe('agriculture 1.2', () => {
  it('moves the autumn marks with the year', () => {
    const normal = autumnMarks(0);
    expect([dateLabel(normal.cold), dateLabel(normal.kill)]).toEqual(['Oct 9', 'Nov 16']);
    const cool = autumnMarks(-2);
    expect([dateLabel(cool.cold), dateLabel(cool.kill)]).toEqual(['Oct 3', 'Oct 28']);
    // In a year 2 °C cooler the crop is still filling when that year's cold spell arrives.
    const c2 = shifted(-2);
    expect(c2.premature).toBe(true);
    expect(c2.maturityDay).toBe(cool.cold);
  });
  it('gives the yields of warmer and cooler years', () => {
    expect(fmt(ref.yield)).toBe('188');
    expect(fmt(shifted(2).yield)).toBe('163');
    expect(fmt(shifted(-1).yield)).toBe('203');
    expect(shifted(-1).premature).toBe(false);
  });
  it('shows the late hybrid gains nothing when it is stopped short', () => {
    const late = (h: number) => shifted(0, { plantDay: dayOf(6, 5), maturityGdd: h });
    expect(lateHybridSolved(dayOf(6, 5), 1425, 0)).toBe(true);
    expect(lateHybridSolved(dayOf(5, 1), 1500, 0)).toBe(false);
    expect(late(1450).premature).toBe(true);
    expect(Math.abs(late(1450).yield - late(1425).yield)).toBeLessThan(0.5);
    expect(late(1500).yield).toBeLessThan(late(1425).yield);
    // Planted May 1, the same 1,425-GDD hybrid finishes and yields less than the standard 1,500.
    const may = shifted(0, { maturityGdd: 1425 });
    expect(may.premature || may.killed).toBe(false);
    expect(may.yield).toBeLessThan(ref.yield - 5);
  });
  it('gives the wheat numbers', () => {
    const wheat = simulateSeason(REF, { crop: 'wheat', pawIn: P.pawIn, startWater: P.springWater });
    expect(fmt(wheat.yield)).toBe('70');
    expect(ref.stageDays[4] - wheat.stageDays[7]).toBe(17);
    expect(CROP.wheat.buDryGrams / 0.865 / 453.59237).toBeCloseTo(60, 6);
    expect(CROP.corn.buDryGrams / 0.845 / 453.59237).toBeCloseTo(56, 6);
  });
});

describe('agriculture 1.3', () => {
  const home = { nRate: 150, soilP: 25, soilK: 180, ph: 6.4, om: 4.5 };
  const ridge = { nRate: 150, soilP: 18, soilK: 150, ph: 5.3, om: 2.5 };
  it('closes the organic-matter loophole in the Ridge challenge', () => {
    expect(ridgeSolved('ridge', ridge)).toBe(false);
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.0, nRate: 170 })).toBe(true);
    expect(sufficiency('corn', { ...ridge, ph: 6.4, om: 3.5 }).factor).toBeGreaterThanOrEqual(0.98);
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.4, om: 3.5 })).toBe(false);
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.0, nRate: 170, soilK: 200 })).toBe(false);
  });
  it('names no limiting nutrient on the healthy home field', () => {
    expect(limitingLabel(sufficiency('corn', home))).toBe('none');
    const lowK = sufficiency('corn', { ...home, soilK: 80 });
    expect(limitingLabel(lowK)).toBe('Potassium');
    expect(fmt(lowK.K * 100)).toBe('94');
  });
  it('uses the organic-matter slider: the Ridge’s thinner organic matter on the home field', () => {
    expect(nitrogenSupply(home).mineralized - nitrogenSupply({ ...home, om: 2.5 }).mineralized).toBeCloseTo(40, 6);
    expect(fmt(THIN_OM_N * 100)).toBe('96');
    expect(fmt(nitrogenSupply(home).mineralized)).toBe('90');
  });
  it('backs the Ridge challenge’s success message', () => {
    // Limed to 6.0 with the usual 150 lb, nitrogen is the short stave; more fertilizer lifts it.
    expect(sufficiency('corn', { ...ridge, ph: 6.0 }).limiting).toBe('N');
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.0 })).toBe(false);
    // At the starting pH, 200 lb does no better than 150: phosphorus is the limit.
    const at = (nRate: number) => sufficiency('corn', { ...ridge, nRate });
    expect(at(150).limiting).toBe('P');
    expect(at(200).factor).toBeCloseTo(at(150).factor, 10);
  });
});

describe('agriculture 1.4', () => {
  it('asks for the latest trigger that costs nothing: the stress point', () => {
    const st = { rain: 0.6, temp: 0, paw: P.pawIn, irrigate: 'on' as const, trigger: 55 };
    expect(triggerSolved({ rain: 1, temp: 0, paw: P.pawIn, irrigate: 'off', trigger: 30 })).toBe(false);
    expect(triggerSolved({ ...st, trigger: 30 })).toBe(false);
    expect(triggerSolved(st)).toBe(true);
    expect(triggerSolved({ ...st, trigger: 50 })).toBe(false);
    expect(triggerSolved({ ...st, trigger: 60 })).toBe(false);
    expect(triggerSolved({ ...st, irrigate: 'off' })).toBe(false);
    expect(Math.round((1 - CROP.corn.stressAt) * 100)).toBe(45);
    // Not a knife-edge: 55% loses nothing, 60% loses more than a bushel and a half.
    const run = (t: number) => simulateSeason(applyShift(REF, { rain: 0.6, temp: 0 }), { ...cornOpts, irrigation: { trigger: t / 100, amount: 1, interval: 4 } });
    expect(Math.abs(run(55).yield - run(20).yield)).toBeLessThan(0.05);
    expect(run(20).yield - run(60).yield).toBeGreaterThan(1.5);
  });
  it('gives July’s water bill', () => {
    expect(fmt(JULY.et, 1)).toBe('6.5');
    expect(fmt(JULY.rain, 1)).toBe('3.8');
  });
  it('finishes the warm season before the soil runs low', () => {
    const warm = shifted(2);
    expect(dateLabel(warm.maturityDay)).toBe('Aug 26');
    expect(warm.days.filter((d) => d.dev < 1 && d.ks < 0.999).length).toBe(0);
    expect(ref.stressDays).toBe(0);
  });
  it('starves the High Plains corn twice over', () => {
    const d = DISTRICT.plains;
    const w = simulatedYear(REFERENCE_YEAR, 'plains');
    const res = simulateSeason(w, { ...cornOpts, maturityGdd: d.hybridGdd, pawIn: d.pawIn, startWater: d.springWater });
    let water = 0;
    let light = 0;
    let unstressed = 0;
    let unstressedWater = 0;
    for (const x of res.days) {
      const ww = w[x.day];
      if (!(x.dev < 1 && x.alive) || x.lai < 0.5) continue;
      const li = CROP.corn.rue * 0.48 * ww.srad * x.intercept * x.ft;
      const wa = waterLimitedGrowth('corn', et0(ww, x.day) * BASAL.corn * x.intercept * x.ks, vpd(ww));
      if (wa < li) water++;
      else light++;
      if (x.ks >= 0.999) {
        unstressed++;
        if (wa < li) unstressedWater++;
      }
    }
    expect([water, water + light]).toEqual([75, 82]);
    expect(d.springWater).toBeLessThan(0.5);
    expect(unstressedWater / unstressed).toBeGreaterThan(0.5);
    const first = res.days.find((x) => x.ks < 0.999);
    expect(first && first.day).toBeLessThan(dayOf(5, 15));
    expect(TRANSPIRATION_EFFICIENCY.corn).toBe(10.5);
  });
});

describe('agriculture 1.5', () => {
  it('finds the kernels could always hold more than the canopy filled', () => {
    const h = kernelHeadroom();
    expect(h.kernelLimited).toBe(0);
    expect(Math.round((h.median - 1) * 20) * 5).toBe(30);
  });
  it('gives the dry spell numbers in the prose', () => {
    expect(Math.abs(SPELL_AT.june1.yield - ref.yield)).toBeLessThan(1);
    expect(fmt(ref.yield - SPELL_AT.july10.yield)).toBe('18');
    expect(fmt(ref.yield - SPELL_AT.aug1.yield)).toBe('10');
    expect(Math.abs(SPELL_AT.aug25.yield - ref.yield)).toBeLessThan(1);
    expect(SPELL_AT.july10.kernelsPerEar - ref.kernelsPerEar).toBeGreaterThan(24);
    expect(SPELL_AT.july10.kernelsPerEar - ref.kernelsPerEar).toBeLessThan(48);
    expect(fmt(ref.kernelsPerEar)).toBe('538');
    // Silking is a week after the July 10 spell begins; by August 25 two-thirds of the grain is in.
    expect(dateLabel(ref.stageDays[4])).toBe('Jul 17');
    const aug25 = ref.days.find((d) => d.day === dayOf(8, 25))!;
    expect(Math.round((aug25.grain / ref.days[ref.days.length - 1].grain) * 100)).toBe(67);
    // From late August on, no two-week dry spell costs a bushel.
    for (let d = dayOf(8, 25); d <= dayOf(9, 1); d++) expect(ref.yield - grow15(REFERENCE_YEAR, 32000, d).yield).toBeLessThan(1);
    // Whatever its start, the kernels hardly change and the canopy, not the kernels, sets the yield.
    for (let d = dayOf(5, 15); d <= dayOf(9, 1); d += 2) {
      const r = grow15(REFERENCE_YEAR, 32000, d);
      expect(r.sink).toBeGreaterThan(r.source);
      expect(Math.abs(r.kernelsPerEar - ref.kernelsPerEar)).toBeLessThan(45);
    }
  });
  it('locates the kernel-set window around silking', () => {
    const from = ref.days.find((d) => d.dev >= 0.46)!.day;
    const to = ref.days.find((d) => d.dev >= 0.62)!.day;
    expect(ref.stageDays[4] - from).toBe(8);
    expect(to - ref.stageDays[4]).toBe(12);
  });
  it('asks which season a tenth fewer plants leaves kernel-limited, predictable from the bars', () => {
    const seasons = { reference: REFERENCE_YEAR, bumper: 180, hotJuly: 133, dryAugust: 111, drought: 46 } as const;
    const spare = (y: number) => {
      const r = grow15(y, 32000);
      return r.sink / r.source - 1;
    };
    // At 32,000 plants the bumper season's kernels have the least to spare.
    expect(fmt(spare(180) * 100)).toBe('2');
    expect(fmt(spare(133) * 100)).toBe('9');
    expect(fmt(spare(REFERENCE_YEAR) * 100)).toBe('23');
    for (const y of [REFERENCE_YEAR, 133, 111, 46]) expect(spare(y)).toBeGreaterThan(spare(180) * 4);
    expect(thinnerSolved('reference', 32000)).toBe(false);
    expect(thinnerSolved('bumper', 32000)).toBe(false);
    expect(thinnerSolved('bumper', 31000)).toBe(false);
    expect(thinnerSolved('bumper', 27000)).toBe(false);
    expect(thinnerSolved('bumper', 29000, 'on')).toBe(false);
    for (let pop = THIN.from; pop <= THIN.to; pop += 1000) {
      expect(thinnerSolved('bumper', pop)).toBe(true);
      for (const k of ['reference', 'hotJuly', 'dryAugust', 'drought'] as const) expect(thinnerSolved(k, pop)).toBe(false);
      // Not knife-edges: every season sits at least two bushels to one side.
      for (const y of Object.values(seasons)) {
        const r = grow15(y, pop);
        expect(Math.abs(r.sink - r.source)).toBeGreaterThan(2);
      }
    }
    // What the success message quotes at 29,000 plants.
    const bumper = grow15(180, 29000);
    expect([fmt(bumper.sink), fmt(bumper.source), fmt(bumper.yield), fmt(grow15(180, 32000).yield)]).toEqual(['222', '230', '222', '233']);
    expect(fmt(ref.yield - grow15(REFERENCE_YEAR, 29000).yield, 1)).toBe('3.4');
  });
  it('gives the wheat yield', () => {
    const wheat = simulateSeason(REF, { crop: 'wheat', pawIn: P.pawIn, startWater: P.springWater });
    expect(fmt(wheat.yield)).toBe('70');
    expect(dateLabel(wheat.stageDays[4])).toBe('May 28');
  });
  it('gives the chance of a poor crop as the reference season unfolds', () => {
    const below150 = (cut: number) =>
      Array.from({ length: 200 }, (_, i) => simulateSeason(spliceWeather(REF, simulatedYear(i + 1, 'prairie'), cut), cornOpts).yield).filter((y) => y < 150).length / 200;
    expect(fmt(below150(dayOf(5, 1)) * 100)).toBe('18');
    expect(below150(dayOf(8, 1))).toBeLessThan(0.01);
  });
});
