// The agriculture course: engines, the numbers quoted in the lessons' prose, and that every
// challenge can be solved. Chapter by chapter.

import { describe, expect, it } from 'vitest';
import { canopyDay, gramsToBushels, interception, leafAssimilation } from '../src/engines/agriculture/photosynthesis';
import { CROP, gdd, kernelSetFactor, simulateSeason, waterStress } from '../src/engines/agriculture/crop';
import { nitrogenSeason, sufficiency } from '../src/engines/agriculture/soil';
import { describe as describeSample } from '../src/engines/strategy/distribution';
import { REFERENCE_YEAR, applyShift, frostDates, normalYear, simulatedYear, spliceWeather } from '../src/model/agriculture/climate';
import { DISTRICT, DISTRICTS, dateLabel, dayOf } from '../src/model/agriculture/region';
import { ninetySolved, wheatAheadSolved } from '../src/lessons/agriculture/ch1/L1_1';
import { lateHybridSolved } from '../src/lessons/agriculture/ch1/L1_2';
import { ridgeSolved } from '../src/lessons/agriculture/ch1/L1_3';
import { triggerSolved } from '../src/lessons/agriculture/ch1/L1_4';
import { bumperSolved } from '../src/lessons/agriculture/ch1/L1_5';

const P = DISTRICT.prairie;
const REF = simulatedYear(REFERENCE_YEAR, 'prairie');
const cornOpts = { crop: 'corn' as const, plantDay: dayOf(5, 1), maturityGdd: P.hybridGdd, pawIn: P.pawIn, startWater: P.springWater };
const ref = simulateSeason(REF, cornOpts);
const r1 = (x: number) => Math.round(x * 10) / 10;

describe('the valley’s climate', () => {
  it('is deterministic and centered on the normals', () => {
    expect(simulatedYear(7, 'plains')).toEqual(simulatedYear(7, 'plains'));
    for (const d of DISTRICTS) {
      const normal = normalYear(d.id).reduce((s, w) => s + w.rain, 0);
      let total = 0;
      for (let y = 1; y <= 100; y++) total += simulatedYear(y, d.id).reduce((s, w) => s + w.rain, 0);
      expect(total / 100 / normal).toBeGreaterThan(0.85);
      expect(total / 100 / normal).toBeLessThan(1.15);
    }
  });
  it('splices a known season onto an unknown one', () => {
    const other = simulatedYear(3, 'prairie');
    const s = spliceWeather(REF, other, 150);
    expect(s[149]).toEqual(REF[149]);
    expect(s[150]).toEqual(other[150]);
  });
});

describe('chapter 1: photosynthesis (1.1)', () => {
  it('gives the leaf numbers in the prose', () => {
    expect(r1(leafAssimilation('corn', 1500, 420, 28).net)).toBe(47.3);
    expect(r1(leafAssimilation('wheat', 1500, 420, 28).net)).toBe(23.5);
    expect(r1(leafAssimilation('wheat', 1500, 560, 28).net)).toBe(28.5);
    expect(r1(leafAssimilation('corn', 1500, 420, 28, 0.3).net)).toBe(30.6);
    expect(r1(leafAssimilation('wheat', 1500, 420, 28, 0.3).net)).toBe(8.7);
    // Wheat ahead below about 18 °C in strong light.
    expect(leafAssimilation('wheat', 1500, 420, 18).net).toBeGreaterThan(leafAssimilation('corn', 1500, 420, 18).net);
    expect(leafAssimilation('wheat', 1500, 420, 19).net).toBeLessThan(leafAssimilation('corn', 1500, 420, 19).net);
  });
  it('gives the canopy numbers', () => {
    const d = canopyDay('corn', 5, 1700, 15, 28);
    expect(r1(d.dryMatter)).toBe(49.2);
    expect(r1(gramsToBushels('corn', d.dryMatter, 0.5))).toBe(4.6);
    expect(r1(canopyDay('corn', 3, 1700, 15, 28).dryMatter)).toBe(44.8);
    expect(d.rue).toBeGreaterThan(3.9);
    expect(d.rue).toBeLessThan(4.2);
    expect(Math.round(canopyDay('wheat', 5, 1700, 15, 20).rue * 10) / 10).toBe(3.3);
    expect(interception('corn', 3.9)).toBeGreaterThanOrEqual(0.9);
    expect(interception('corn', 3.8)).toBeLessThan(0.9);
  });
  it('has solvable challenges', () => {
    expect(wheatAheadSolved({ light: 1500, co2: 420, temp: 15, water: 100 })).toBe(true);
    expect(wheatAheadSolved({ light: 1500, co2: 420, temp: 28, water: 100 })).toBe(false);
    expect(ninetySolved('corn', 3.9)).toBe(true);
    expect(ninetySolved('corn', 4.0)).toBe(false);
  });
});

describe('chapter 1: the season model (1.2)', () => {
  it('counts degree days with the 30/10 limits', () => {
    expect(gdd('corn', 35, 15)).toBe(12.5);
    expect(gdd('corn', 8, 2)).toBe(0);
    expect(gdd('wheat', 10, -4)).toBe(5);
  });
  it('dates the reference season’s stages', () => {
    expect(ref.stageDays.map((d) => dateLabel(d))).toEqual(['May 13', 'Jun 12', 'Jun 27', 'Jul 13', 'Jul 17', 'Jul 27', 'Aug 2', 'Aug 9', 'Aug 19', 'Sep 16']);
    expect(Math.round(ref.yield)).toBe(188);
    expect(dateLabel(frostDates(REF, -2).firstFall)).toBe('Nov 16');
    const warm = simulateSeason(applyShift(REF, { temp: 2 }), cornOpts);
    expect(dateLabel(warm.stageDays[4])).toBe('Jul 7');
    expect(dateLabel(warm.stageDays[9])).toBe('Aug 26');
    expect(simulateSeason(applyShift(REF, { temp: -2 }), cornOpts).killed).toBe(true);
  });
  it('dates the two calendars', () => {
    const wheat = simulateSeason(REF, { crop: 'wheat', pawIn: P.pawIn, startWater: P.springWater });
    expect([wheat.stageDays[0], wheat.stageDays[3], wheat.stageDays[7]].map((d) => dateLabel(d))).toEqual(['Mar 22', 'May 24', 'Jun 30']);
    const plains = simulateSeason(simulatedYear(REFERENCE_YEAR, 'plains'), { crop: 'wheat', pawIn: 8, startWater: DISTRICT.plains.springWater });
    expect(dateLabel(plains.stageDays[7])).toBe('Jun 15');
  });
  it('has a solvable challenge', () => {
    expect(lateHybridSolved(dayOf(6, 5), 1475, 0)).toBe(true);
    expect(lateHybridSolved(dayOf(6, 5), 1450, 0)).toBe(false);
  });
});

describe('chapter 1: soil (1.3)', () => {
  const home = { nRate: 150, soilP: 25, soilK: 180, ph: 6.4, om: 4.5 };
  it('budgets nitrogen as the prose says', () => {
    const s = sufficiency('corn', home);
    expect(Math.round(s.nSupply)).toBe(218);
    expect(Math.round(sufficiency('corn', { ...home, nRate: 0 }).N * 100)).toBe(79);
    const yieldAt = (factor: number) => simulateSeason(REF, { ...cornOpts, nutrient: factor }).yield;
    expect(Math.round(yieldAt(sufficiency('corn', { ...home, nRate: 0 }).factor))).toBe(144);
  });
  it('makes the Ridge challenge need lime and nitrogen', () => {
    const ridge = { nRate: 150, soilP: 18, soilK: 150, ph: 5.3, om: 2.5 };
    expect(ridgeSolved('ridge', ridge)).toBe(false);
    expect(ridgeSolved('ridge', { ...ridge, nRate: 250 })).toBe(false);
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.0, nRate: 170 })).toBe(true);
    expect(ridgeSolved('ridge', { ...ridge, ph: 6.0, nRate: 160 })).toBe(false);
  });
  it('tracks nitrogen through the season', () => {
    const run = (rate: number, timing: 'fall' | 'spring' | 'split', spring = 1) => {
      const w = simulatedYear(REFERENCE_YEAR, 'prairie', { monthRain: [spring, spring, spring, spring, spring, spring, 1, 1, 1, 1, 1, 1] });
      const base = simulateSeason(w, cornOpts);
      const ns = nitrogenSeason(w, base, { rate, timing, om: P.om, ph: P.ph, pawIn: P.pawIn });
      return { ns, y: simulateSeason(w, { ...cornOpts, nutrient: ns.sufficiency }).yield };
    };
    const spring = run(150, 'spring');
    expect(Math.round(spring.ns.totalLeached)).toBe(44);
    expect(Math.round((spring.ns.totalUptake / spring.ns.totalDemand) * 100)).toBe(93);
    expect(Math.round(spring.y)).toBe(187);
    expect(Math.round(run(150, 'fall').ns.totalLeached)).toBe(74);
    expect(Math.round(run(150, 'fall').y)).toBe(178);
    expect(Math.round(run(150, 'split').ns.totalLeached)).toBe(32);
    expect(Math.round(run(150, 'fall', 1.5).ns.totalLeached)).toBe(104);
    expect(Math.round(run(150, 'fall', 1.5).y)).toBe(160);
    expect(Math.round(run(150, 'split', 1.5).y)).toBe(186);
  });
});

describe('chapter 1: water (1.4)', () => {
  const grow = (rain: number, temp: number, paw: number) => simulateSeason(applyShift(REF, { rain, temp }), { ...cornOpts, pawIn: paw });
  it('gives the water numbers in the prose', () => {
    expect(r1(ref.drainageTotal)).toBe(6.1);
    expect(ref.stressDays).toBe(0);
    const dry = grow(0.6, 0, 11);
    expect(dry.stressDays).toBe(37);
    expect(Math.round(dry.yield)).toBe(161);
    expect(Math.round(grow(0.4, 0, 11).yield)).toBe(134);
    expect(Math.round(grow(1, 0, 7.5).yield)).toBe(174);
    expect(Math.round(ref.yield - grow(1, 0, 6).yield)).toBe(27);
    expect(Math.round(grow(1, 2, 11).yield)).toBe(163);
    expect(waterStress(4, 10, 0.5)).toBe(1);
    expect(waterStress(7.5, 10, 0.5)).toBe(0.5);
  });
  it('has a solvable challenge', () => {
    const st = { rain: 0.6, temp: 0, paw: 11, irrigate: 'on' as const, trigger: 55 };
    expect(triggerSolved(st)).toBe(true);
    expect(triggerSolved({ ...st, trigger: 50 })).toBe(false);
  });
});

describe('chapter 1: yield formation (1.5)', () => {
  const grow = (year: number, population = 32000) => simulateSeason(simulatedYear(year, 'prairie'), { ...cornOpts, population });
  it('gives the yield components in the prose', () => {
    const rows = [
      [REFERENCE_YEAR, 541, 89296, 188],
      [111, 556, 120829, 143],
      [133, 431, 73577, 182],
      [46, 339, 137574, 76],
      [180, 579, 77130, 233],
    ];
    for (const [year, kpe, kpb, y] of rows) {
      const r = grow(year);
      expect(Math.round(r.kernelsPerEar)).toBe(kpe);
      expect(Math.abs(r.kernelsPerBu - kpb)).toBeLessThan(1);
      expect(Math.round(r.yield)).toBe(y);
    }
    expect(Math.round(ref.sink)).toBe(233);
    expect(kernelSetFactor(1)).toBe(1);
    expect(CROP.corn.minKernelsPerBu).toBe(72000);
  });
  it('has a solvable challenge', () => {
    expect(bumperSolved('bumper', 27000)).toBe(true);
    expect(bumperSolved('bumper', 26000)).toBe(false);
  });
  it('narrows the forecast as the season unfolds', () => {
    const at = (truth: number, cut: number) =>
      describeSample(Array.from({ length: 200 }, (_, i) => simulateSeason(spliceWeather(simulatedYear(truth, 'prairie'), simulatedYear(i + 1, 'prairie'), cut), cornOpts).yield));
    const may = at(REFERENCE_YEAR, dayOf(5, 1));
    expect(Math.round(may.mean)).toBe(177);
    expect(Math.round(may.q25)).toBe(160);
    expect(Math.round(may.q75)).toBe(196);
    expect(Math.round(may.q05)).toBe(131);
    expect(Math.round(at(REFERENCE_YEAR, dayOf(8, 1)).mean)).toBe(191);
    expect(Math.round(at(46, dayOf(7, 1)).mean)).toBe(154);
    expect(Math.round(at(46, dayOf(7, 15)).mean)).toBe(131);
    expect(Math.round(at(46, dayOf(8, 1)).mean)).toBe(99);
    expect(Math.round(at(180, dayOf(8, 1)).mean)).toBe(203);
  });
});

describe('the season model stays finite at the extremes', () => {
  it('handles every district, crop and odd setting', () => {
    for (const d of DISTRICTS) {
      for (const crop of ['corn', 'wheat'] as const) {
        for (const shift of [{ temp: -4 }, { temp: 4, rain: 0.2 }, { rain: 2 }]) {
          const r = simulateSeason(applyShift(simulatedYear(5, d.id), shift), { crop, plantDay: dayOf(6, 15), pawIn: 2, startWater: 0, population: 44000, nutrient: 0.3 });
          expect(Number.isFinite(r.yield)).toBe(true);
          expect(r.yield).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
