// The agriculture course: engines, the numbers quoted in the lessons' prose, and that every
// challenge can be solved. Chapter by chapter.

import { describe, expect, it } from 'vitest';
import { canopyDay, gramsToBushels, interception, leafAssimilation } from '../src/engines/agriculture/photosynthesis';
import { CROP, gdd, kernelSetFactor, simulateSeason, waterStress } from '../src/engines/agriculture/crop';
import { nitrogenSeason, sufficiency } from '../src/engines/agriculture/soil';
import { describe as describeSample } from '../src/engines/strategy/distribution';
import { REFERENCE_YEAR, applyShift, firstColdSpell, frostDates, normalYear, simulatedYear, spliceWeather } from '../src/model/agriculture/climate';
import { DISTRICT, DISTRICTS, dateLabel, dayOf, type Crop, type DistrictId } from '../src/model/agriculture/region';
import { PLAN_PRICE } from '../src/model/agriculture/economics';
import {
  PLAINS_IRRIGATION,
  YEARS,
  blightField,
  cropMix,
  expectedYieldByPlantDay,
  fieldSeason,
  historyYields,
  marginOverVariable,
  plantingRun,
  variableCost,
  type MixResult,
} from '../src/engines/agriculture/farm';
import { allCornSolved, plantingStats } from '../src/lessons/agriculture/ch2/L2_1';
import { doubledNitrogenSolved, inputCurve } from '../src/lessons/agriculture/ch2/L2_2';
import { bestScoutingThreshold, outcome, strategyRecord, thresholdSolved } from '../src/lessons/agriculture/ch2/L2_3';
import { bestStart, harvestSolved, wheatValue } from '../src/lessons/agriculture/ch2/L2_4';
import { acreBudget, breakevenSolved, farmProfits } from '../src/lessons/agriculture/ch2/L2_5';
import { withEvents, type WeatherEvent } from '../src/model/agriculture/climate';
import { canopyReflectance, ndvi, seasonNdvi } from '../src/engines/agriculture/vegetation';
import { ridgeSoilSolved, suitability } from '../src/lessons/agriculture/ch3/L3_1';
import { droughtSolved, freezeSolved, type LabState } from '../src/lessons/agriculture/ch3/L3_2';
import { ndviSolved } from '../src/lessons/agriculture/ch3/L3_3';
import { fitFor, pairSolved } from '../src/lessons/agriculture/ch3/L3_4';
import { endings, normalWeatherProduction, percentileSolved, production } from '../src/lessons/agriculture/ch3/L3_5';
import { ninetySolved, wheatAheadSolved } from '../src/lessons/agriculture/ch1/L1_1';
import { lateHybridSolved } from '../src/lessons/agriculture/ch1/L1_2';
import { ridgeSolved } from '../src/lessons/agriculture/ch1/L1_3';
import { triggerSolved } from '../src/lessons/agriculture/ch1/L1_4';
import { blend, cornGrade, cornPrice } from '../src/engines/agriculture/grain';
import { EXPORT_PACE, inventoryYear, simulateBin } from '../src/engines/agriculture/storage';
import { harvestRush } from '../src/engines/agriculture/elevator';
import { DEFAULT_NETWORK, districtProduction, networkCapacity, routeCrop, scaleSupply } from '../src/engines/agriculture/logistics';
import { clearWorld, worldHistory } from '../src/engines/agriculture/world';
import { valleySeason } from '../src/engines/agriculture/valley';
import { moistureSolved } from '../src/lessons/agriculture/ch4/L4_1';
import { wettestSolved } from '../src/lessons/agriculture/ch4/L4_2';
import { blendGain, blendSolved, spreadSolved } from '../src/lessons/agriculture/ch4/L4_3';
import { NET0, bargeSolved, fillShare, railSolved, seasons, settingsOf } from '../src/lessons/agriculture/ch4/L4_4';
import { WORLD0, balanceOf, bufferSolved, dearBigYear, history, valleyAverage } from '../src/lessons/agriculture/ch4/L4_5';
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
    const cool = simulateSeason(applyShift(REF, { temp: -2 }), cornOpts);
    expect(cool.premature).toBe(true);
    expect(dateLabel(cool.maturityDay)).toBe('Oct 3');
    expect(dateLabel(firstColdSpell(REF))).toBe('Oct 9');
    const north = simulateSeason(simulatedYear(REFERENCE_YEAR, 'north'), { ...cornOpts, maturityGdd: 1250, pawIn: 8, startWater: 0.95 });
    expect(north.premature).toBe(true);
    expect(dateLabel(north.maturityDay)).toBe('Sep 30');
    expect(dateLabel(frostDates(simulatedYear(REFERENCE_YEAR, 'north'), -2).firstFall)).toBe('Oct 3');
  });
  it('dates the two calendars', () => {
    const wheat = simulateSeason(REF, { crop: 'wheat', pawIn: P.pawIn, startWater: P.springWater });
    expect([wheat.stageDays[0], wheat.stageDays[3], wheat.stageDays[7]].map((d) => dateLabel(d))).toEqual(['Mar 22', 'May 24', 'Jun 30']);
    const plains = simulateSeason(simulatedYear(REFERENCE_YEAR, 'plains'), { crop: 'wheat', pawIn: 8, startWater: DISTRICT.plains.springWater });
    expect(dateLabel(plains.stageDays[7])).toBe('Jun 15');
  });
  it('has a solvable challenge', () => {
    expect(lateHybridSolved(dayOf(6, 5), 1425, 0)).toBe(true);
    expect(lateHybridSolved(dayOf(6, 5), 1400, 0)).toBe(false);
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
      [REFERENCE_YEAR, 538, 88800, 188],
      [111, 553, 120200, 143],
      [133, 460, 78500, 182],
      [46, 358, 145500, 76],
      [180, 550, 73300, 233],
    ];
    for (const [year, kpe, kpb, y] of rows) {
      const r = grow(year);
      expect(Math.round(r.kernelsPerEar)).toBe(kpe);
      expect(Math.round(r.kernelsPerBu / 100) * 100).toBe(kpb);
      expect(Math.round(r.yield)).toBe(y);
    }
    expect(Math.round(ref.sink)).toBe(232);
    expect(kernelSetFactor(0.9)).toBe(1);
    expect(CROP.corn.minKernelsPerBu).toBe(72000);
    // The light-or-water figure: the High Plains' unirrigated corn in the reference season.
    const plains = simulateSeason(simulatedYear(REFERENCE_YEAR, 'plains'), { ...cornOpts, pawIn: 8, startWater: DISTRICT.plains.springWater });
    expect(Math.round(plains.yield)).toBe(27);
  });
  it('has a solvable challenge', () => {
    expect(bumperSolved('bumper', 30000)).toBe(true);
    expect(bumperSolved('bumper', 29000)).toBe(false);
  });
  it('narrows the forecast as the season unfolds', () => {
    const at = (truth: number, cut: number) =>
      describeSample(Array.from({ length: 200 }, (_, i) => simulateSeason(spliceWeather(simulatedYear(truth, 'prairie'), simulatedYear(i + 1, 'prairie'), cut), cornOpts).yield));
    const may = at(REFERENCE_YEAR, dayOf(5, 1));
    expect(Math.round(may.mean)).toBe(176);
    expect(Math.round(may.q25)).toBe(160);
    expect(Math.round(may.q75)).toBe(195);
    expect(Math.round(may.q05)).toBe(131);
    expect(Math.round(at(REFERENCE_YEAR, dayOf(8, 1)).mean)).toBe(190);
    expect(Math.round(at(46, dayOf(7, 1)).mean)).toBe(154);
    expect(Math.round(at(46, dayOf(7, 15)).mean)).toBe(132);
    expect(Math.round(at(46, dayOf(8, 1)).mean)).toBe(99);
    expect(Math.round(at(180, dayOf(8, 1)).mean)).toBe(202);
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

// ---------------------------------------------------------------------------
// Chapter 2

describe('chapter 2: planting and land allocation (2.1)', () => {
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  it('gives the margins and mixes in the prose', () => {
    expect(variableCost('corn')).toBe(412);
    expect(variableCost('wheat')).toBe(201);
    const margin = (d: DistrictId, crop: Crop) => Math.round(marginOverVariable(crop, mean(historyYields({ district: d, crop })), PLAN_PRICE[crop]));
    expect(margin('prairie', 'corn')).toBe(357);
    expect(margin('prairie', 'wheat')).toBe(195);
    expect(margin('north', 'corn')).toBe(189);
    expect(margin('north', 'wheat')).toBe(185);
    expect(margin('plains', 'corn')).toBe(-79);
    expect(margin('plains', 'wheat')).toBe(134);
    const perAcre = (r: MixResult) => Math.round(r.mean / 1600);
    expect(perAcre(cropMix('prairie', 1600, 0.5, PLAN_PRICE))).toBe(276);
    expect(perAcre(cropMix('prairie', 1600, 1, PLAN_PRICE))).toBe(256);
    expect(perAcre(cropMix('prairie', 1600, 0.625, PLAN_PRICE))).toBe(271);
    expect(Math.round(cropMix('prairie', 1600, 0.5, PLAN_PRICE).p10 / 1600)).toBe(190);
    expect(Math.round(cropMix('prairie', 1600, 1, PLAN_PRICE).p10 / 1600)).toBe(103);
    const irr = YEARS.map((y) => fieldSeason(y, { district: 'plains', crop: 'corn', irrigation: PLAINS_IRRIGATION }));
    expect(Math.round(marginOverVariable('corn', mean(irr.map((r) => r.yield)), PLAN_PRICE.corn, mean(irr.map((r) => r.irrigationTotal))))).toBe(208);
  });
  it('has a solvable challenge', () => {
    expect(allCornSolved('prairie', 4.9, 6)).toBe(true);
    expect(allCornSolved('prairie', 4.8, 6)).toBe(false);
    expect(allCornSolved('prairie', 5.0, 6)).toBe(false);
  });
  it('plants on workable days', () => {
    const ey = expectedYieldByPlantDay('prairie');
    expect(Math.round(ey(dayOf(5, 25)) * 10) / 10).toBe(172.5);
    expect(Math.round(ey(dayOf(6, 14)) * 10) / 10).toBe(148.5);
    const ref = simulatedYear(REFERENCE_YEAR, 'prairie');
    expect(dateLabel(plantingRun(ref, dayOf(4, 25), 1000, 180).finished)).toBe('May 10');
    expect(dateLabel(plantingRun(ref, dayOf(4, 25), 1000, 90).finished)).toBe('May 21');
    const wet = plantingRun(simulatedYear(3, 'prairie'), dayOf(4, 25), 1000, 90, dayOf(6, 20));
    expect(wet.finished).toBe(-1);
    expect(Math.round(1000 - wet.cumulative[wet.cumulative.length - 1])).toBe(280);
    expect(Math.round(plantingStats(dayOf(4, 25), 90).meanLost)).toBe(676);
    expect(Math.round(plantingStats(dayOf(4, 25), 270).meanLost)).toBe(212);
    expect(Math.round(plantingStats(dayOf(4, 25), 90).worstLost)).toBe(13017);
  });
});

describe('chapter 2: inputs (2.2)', () => {
  it('finds the optima in the prose', () => {
    const n = inputCurve('nitrogen', 4.6, 0.6);
    expect(n.levels[n.best]).toBe(120);
    expect(Math.round(n.output[n.best] * 10) / 10).toBe(172);
    expect(Math.round(n.output[1] - n.output[0])).toBe(14);
    expect(inputCurve('nitrogen', 3.5, 0.6).levels[inputCurve('nitrogen', 3.5, 0.6).best]).toBe(100);
    expect(inputCurve('nitrogen', 4.6, 0.3).levels[inputCurve('nitrogen', 4.6, 0.3).best]).toBe(140);
    const w = inputCurve('water', 4.6, 11);
    expect(w.levels[w.best]).toBe(12);
    expect(Math.round(w.output[0] * 10) / 10).toBe(78.6);
    expect(Math.round(w.output[1] * 10) / 10).toBe(109.1);
    expect(inputCurve('water', 4.6, 20).levels[inputCurve('water', 4.6, 20).best]).toBe(10);
    expect(inputCurve('planter', 4.6, 1).best).toBe(0);
  });
  it('has a solvable challenge', () => {
    expect(doubledNitrogenSolved('nitrogen', 5, 4.6, 1.2)).toBe(true);
    expect(doubledNitrogenSolved('nitrogen', 6, 4.6, 1.2)).toBe(false);
  });
});

describe('chapter 2: crop risk (2.3)', () => {
  const o = { cornOnCorn: false, threshold: 0.02, pressure: 1, price: 4.6, fungicide: 32 };
  it('gives the blight numbers in the prose', () => {
    const ref = outcome(REFERENCE_YEAR, 'fungicide', o);
    expect(Math.round(ref.none * 10) / 10).toBe(175.5);
    expect(Math.round(ref.yield * 10) / 10).toBe(183.5);
    expect(Math.round(fieldSeason(REFERENCE_YEAR, blightField('none', { cornOnCorn: true })).yield * 10) / 10).toBe(157.3);
    expect(Math.round(strategyRecord('fungicide', o).mean * 100) / 100).toBe(0.58);
    expect(strategyRecord('fungicide', o).pays).toBe(75);
    expect(Math.round(strategyRecord('resistant', o).mean * 100) / 100).toBe(6.22);
    expect(Math.round(strategyRecord('scout', o).mean * 100) / 100).toBe(3.2);
  });
  it('has a solvable challenge', () => {
    expect(bestScoutingThreshold()).toBe(0.02);
    expect(thresholdSolved({ strategy: 'scout', ...o })).toBe(true);
    expect(thresholdSolved({ strategy: 'scout', ...o, threshold: 0.025 })).toBe(false);
  });
});

describe('chapter 2: harvest (2.4)', () => {
  it('finds the best start and the wheat discounts', () => {
    const best = bestStart({ perDay: 100, drying: 0.035, price: 4.6 });
    expect(dateLabel(best.day)).toBe('Oct 17');
    expect(dateLabel(bestStart({ perDay: 100, drying: 0.02, price: 4.6 }).day)).toBe('Oct 4');
    expect(dateLabel(bestStart({ perDay: 100, drying: 0.06, price: 4.6 }).day)).toBe('Nov 1');
    expect(harvestSolved({ start: dayOf(10, 17), perDay: 100, drying: 0.035, price: 4.6 })).toBe(true);
    expect(harvestSolved({ start: dayOf(9, 16), perDay: 100, drying: 0.035, price: 4.6 })).toBe(false);
    expect(Math.round(wheatValue(7).sprouted * 1000) / 10).toBe(2.7);
    expect(Math.round(wheatValue(28).discount * 100)).toBe(46);
  });
});

describe('chapter 2: farm economics (2.5)', () => {
  it('gives the budget numbers in the prose', () => {
    const b = acreBudget('corn', 4.6, 176, 1, 265);
    expect(Math.round(b.cost)).toBe(835);
    expect(Math.round(b.profit)).toBe(-25);
    expect(Math.round(b.breakevenPrice * 100)).toBe(474);
    const farm = farmProfits({ corn: 4.6, wheat: 6, yieldMult: 1, fertMult: 1, rent: 265 });
    expect(Math.round(farm.reduce((s, x) => s + x, 0) / farm.length)).toBe(73649);
    expect(farm.filter((x) => x < 0).length).toBe(50);
  });
  it('has a solvable challenge', () => {
    expect(breakevenSolved('corn', 4.75, 176, 1, 265)).toBe(true);
    expect(breakevenSolved('corn', 4.8, 176, 1, 265)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chapter 3

describe('chapter 3: geography (3.1)', () => {
  it('maps the districts as the prose says', () => {
    const s = suitability({ rain: 1, temp: 0, soil: 1 });
    expect(Math.round(s.prairie.cornMargin)).toBe(355);
    expect(Math.round(s.bottoms.cornMargin)).toBe(349);
    expect(Math.round(s.plains.corn)).toBe(73);
    expect(Math.round(s.plains.cornMargin)).toBe(-93);
    expect(Math.round(s.plains.wheatMargin)).toBe(138);
    expect(s.ridge.best).toBe('wheat');
    expect(Math.round(suitability({ rain: 0.8, temp: 0, soil: 1 }).north.corn)).toBe(122);
    expect(Math.round(suitability({ rain: 1, temp: 2, soil: 1 }).prairie.corn)).toBe(153);
    expect(ridgeSoilSolved({ rain: 1, temp: 0, soil: 1.1 })).toBe(true);
    expect(ridgeSoilSolved({ rain: 1, temp: 0, soil: 1.2 })).toBe(false);
  });
});

describe('chapter 3: extremes (3.2)', () => {
  const st = (o: Partial<LabState>): LabState => ({ crop: 'corn', kind: 'drought', date: dayOf(7, 10), days: 21, degrees: 6, low: -3, ...o });
  it('finds the vulnerable windows', () => {
    expect(freezeSolved(st({ crop: 'wheat', kind: 'frost', low: -4, date: dayOf(5, 21) }))).toBe(true);
    expect(freezeSolved(st({ crop: 'wheat', kind: 'frost', low: -4, date: dayOf(5, 22) }))).toBe(false);
    expect(droughtSolved(st({ date: dayOf(6, 13) }))).toBe(true);
    expect(droughtSolved(st({ date: dayOf(7, 17) }))).toBe(false);
    const w = simulatedYear(REFERENCE_YEAR, 'prairie');
    const corn = (e: WeatherEvent) => Math.round(simulateSeason(withEvents(w, [e]), cornOpts).yield);
    expect(corn({ kind: 'drought', start: dayOf(6, 13), days: 21 })).toBe(153);
    expect(corn({ kind: 'drought', start: dayOf(7, 17), days: 21 })).toBe(172);
    expect(corn({ kind: 'drought', start: dayOf(6, 26), days: 28 })).toBe(148);
    expect(corn({ kind: 'frost', day: dayOf(8, 15), low: -3 })).toBe(99);
    expect(corn({ kind: 'frost', day: dayOf(9, 5), low: -3 })).toBe(161);
    expect(corn({ kind: 'frost', day: dayOf(8, 15), low: -1 })).toBe(171);
  });
});

describe('chapter 3: satellites (3.3)', () => {
  it('reads the canopy as the prose says', () => {
    expect(Math.round(ndvi(canopyReflectance(0)) * 100) / 100).toBe(0.2);
    expect(Math.round(ndvi(canopyReflectance(1)) * 100) / 100).toBe(0.51);
    expect(Math.round(ndvi(canopyReflectance(5)) * 100) / 100).toBe(0.81);
    expect(Math.round(ndvi(canopyReflectance(5, 0.7)) * 100) / 100).toBe(0.64);
    expect(ndviSolved(3.2, 1, 0)).toBe(true);
    expect(ndviSolved(3.3, 1, 0)).toBe(false);
    const drought = seasonNdvi(fieldSeason(46, { district: 'prairie', crop: 'corn' }));
    expect(Math.round(drought[dayOf(8, 1)] * 100) / 100).toBe(0.72);
    expect(Math.round(drought[dayOf(8, 15)] * 100) / 100).toBe(0.37);
  });
});

describe('chapter 3: forecasting (3.4)', () => {
  it('forecasts with the skill in the prose', () => {
    expect(Math.round(fitFor(dayOf(8, 1), ['temp', 'rain']).rmseTest * 10) / 10).toBe(18.6);
    expect(Math.round(fitFor(dayOf(8, 1), []).rmseTest * 10) / 10).toBe(25);
    expect(Math.round(fitFor(dayOf(8, 15), ['temp', 'rain', 'ndvi', 'condition']).rmseTest * 10) / 10).toBe(14);
    expect(Math.round(fitFor(dayOf(9, 1), ['temp', 'rain', 'ndvi', 'condition']).rmseTest * 10) / 10).toBe(11.6);
    expect(pairSolved(4, ['temp', 'condition'])).toBe(true);
    expect(pairSolved(4, ['temp', 'rain'])).toBe(false);
  });
});

describe('chapter 3: Monte Carlo (3.5)', () => {
  it('describes the valley’s harvest distribution', () => {
    const corn = Array.from({ length: 400 }, (_, i) => production(i + 1, 'corn', false));
    const d = describeSample(corn);
    expect(Math.round(d.mean)).toBe(506);
    expect(Math.round(d.q05)).toBe(390);
    expect(Math.round(d.min)).toBe(269);
    expect(Math.round(normalWeatherProduction().corn)).toBe(630);
    expect(percentileSolved(200, 'corn', false, 420)).toBe(true);
    expect(percentileSolved(200, 'corn', false, 410)).toBe(false);
    expect(Math.round(describeSample(endings(46, dayOf(8, 1))).mean)).toBe(321);
  });
});

describe('chapter 4: grain quality (4.1)', () => {
  it('grades and discounts as the prose says', () => {
    const load = { testWeight: 55, damaged: 2.5, bcfm: 1.5, moisture: 15 };
    expect(cornGrade(load).grade).toBe(2);
    expect(moistureSolved({ ...load, moisture: 20.5 })).toBe(true);
    expect(moistureSolved({ ...load, moisture: 20 })).toBe(false);
    expect(cornPrice({ ...load, moisture: 20 }, 4.4).netPerBushel).toBeLessThan(4.4);
  });
});

describe('chapter 4: storage (4.2)', () => {
  const fill = dayOf(10, 20);
  const toJuly = 365 - fill + dayOf(7, 15);
  it('keeps and spoils corn as the prose says', () => {
    expect(wettestSolved({ dryTo: 16, aeration: 'off', days: toJuly, where: 'farm' })).toBe(true);
    expect(wettestSolved({ dryTo: 15.5, aeration: 'off', days: toJuly, where: 'farm' })).toBe(false);
    const held = simulateBin({ year: REFERENCE_YEAR, district: 'prairie', fillDay: fill, days: toJuly, harvestMoisture: 19, dryTo: 15, aeration: true, price: 4.4, interest: 0.07, perMonth: 0.02 });
    expect(held.spoiledAt).toBeLessThan(0);
    expect(Math.round(held.costs.total * 100)).toBe(54);
    const elevator = simulateBin({ year: REFERENCE_YEAR, district: 'prairie', fillDay: fill, days: toJuly, harvestMoisture: 19, dryTo: 15, aeration: true, price: 4.4, interest: 0.07, perMonth: 0.035 });
    expect(Math.round(elevator.costs.total * 100)).toBe(67);
  });
  it('fills the valley’s storage in a big year', () => {
    const inv = (harvest: number, pace: keyof typeof EXPORT_PACE) => inventoryYear({ carryIn: 70, harvest, domesticPerMonth: 18, exports: 290, exportPace: EXPORT_PACE[pace], capacity: 450 });
    const avg = inv(506, 'harvest');
    expect(Math.round(Math.max(...avg.map((m) => m.stocks)))).toBe(410);
    expect(Math.round(avg[avg.length - 1].stocks)).toBe(70);
    const big = inv(600, 'harvest');
    expect(Math.round(Math.max(...big.map((m) => m.overflow)))).toBe(49);
  });
});

describe('chapter 4: the elevator (4.3)', () => {
  it('blends and rations as the prose says', () => {
    expect(blendSolved(42)).toBe(true);
    expect(blendSolved(43)).toBe(false);
    expect(Math.round(blendGain(0.2))).toBe(12000);
    expect(Math.round(blendGain(0.3))).toBe(18000);
    expect(Math.round(blendGain(0.43))).toBe(-14280);
    const base = { harvest: 12e6, spread: 0.35, capacity: 3e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 };
    const r = harvestRush(base);
    expect(r.turnedAway).toBe(0);
    expect(Math.round(Math.max(...r.stocks) / 1e5) / 10).toBe(2.8);
    expect(Math.round(r.margin / 1e4) / 100).toBe(1.62);
    const big = harvestRush({ ...base, harvest: 15.6e6 });
    expect(Math.round(big.turnedAway / 1e4) / 100).toBe(1.45);
    expect(big.daysFull).toBe(13);
    expect(harvestRush({ ...base, harvest: 15.6e6, trainsPerWeek: 2 }).turnedAway).toBe(0);
    expect(spreadSolved({ harvestMult: 1.3, spreadCents: 42, capacity: 3e6, trains: 1 })).toBe(true);
    expect(spreadSolved({ harvestMult: 1.3, spreadCents: 43, capacity: 3e6, trains: 1 })).toBe(false);
    expect(blend([{ bushels: 1, sample: { testWeight: 56, damaged: 2, bcfm: 1, moisture: 15 } }]).testWeight).toBe(56);
  });
});

describe('chapter 4: logistics (4.4)', () => {
  const lv = (st = NET0) => routeCrop(settingsOf(st))!;
  it('routes the average crop as the prose says', () => {
    expect(Math.round(Object.values(seasons().supply).reduce((a, b) => a + b, 0))).toBe(506);
    const r = lv();
    expect(Math.round(r.exports.sable)).toBe(180);
    expect(Math.round(r.exports.westhaven)).toBe(110);
    expect(r.stored).toBeLessThan(0.01);
    expect(r.locationValue.prairie).toBeCloseTo(4.65, 6);
    expect(r.locationValue.bottoms).toBeCloseTo(4.65, 6);
    expect(r.locationValue.fairview).toBeCloseTo(4.75, 6);
    expect(r.riverValue).toBeCloseTo(0.42, 6);
    expect(DEFAULT_NETWORK.sable - DEFAULT_NETWORK.barge).toBeCloseTo(5.15, 9);
    expect(bargeSolved({ ...NET0, barge: 87 })).toBe(true);
    expect(bargeSolved({ ...NET0, barge: 86 })).toBe(false);
    expect(bargeSolved({ ...NET0, barge: 88 })).toBe(false);
  });
  it('fills in a big year or at low water', () => {
    const big = lv({ ...NET0, harvest: 120 });
    expect(Math.round(big.stored)).toBe(42);
    expect(big.locationValue.prairie).toBeCloseTo(4.02, 6);
    for (const o of ['north', 'plains', 'prairie', 'ridge', 'bottoms'] as const) expect(lv().locationValue[o] - big.locationValue[o]).toBeCloseTo(0.63, 6);
    const low = lv({ ...NET0, river: 120 });
    expect(low.stored).toBeGreaterThan(0.1);
    expect(low.stored).toBeLessThan(1);
    for (const o of ['north', 'plains', 'prairie', 'ridge', 'bottoms'] as const) expect(lv().locationValue[o] - low.locationValue[o]).toBeGreaterThanOrEqual(0.63 - 1e-6);
    expect(lv({ ...NET0, river: 130 }).stored).toBeLessThan(0.01);
  });
  it('fills as often as the prose says', () => {
    expect(networkCapacity(DEFAULT_NETWORK)).toBe(566);
    expect(Math.round(fillShare({ rail: 170, river: 180, ethanol: 96 }) * 400)).toBe(74);
    expect(railSolved({ rail: 190, river: 180, ethanol: 96 })).toBe(true);
    expect(railSolved({ rail: 180, river: 180, ethanol: 96 })).toBe(false);
    expect(railSolved({ rail: 200, river: 180, ethanol: 96 })).toBe(false);
    expect(fillShare({ rail: 190, river: 180, ethanol: 96 }) * 2).toBeCloseTo(fillShare({ rail: 170, river: 180, ethanol: 96 }), 9);
    // The capacity rule matches the linear program season by season.
    const s0 = seasons();
    void s0;
    for (const y of [1, 46, 100, 250]) {
      const supply = districtProduction(valleySeason(y), DISTRICTS);
      const total = Object.values(supply).reduce((a, b) => a + b, 0);
      const r = routeCrop({ ...DEFAULT_NETWORK, supply })!;
      expect(r.stored > 1e-6).toBe(total > networkCapacity(DEFAULT_NETWORK));
    }
    // A Black Prairie bushel in the smallest harvests, and along the middle.
    const small = routeCrop({ ...DEFAULT_NETWORK, supply: scaleSupply(s0.supply, 0.6) })!;
    expect(small.locationValue.prairie).toBeCloseTo(5.15, 6);
  });
});

describe('chapter 4: the world balance (4.5)', () => {
  it('clears the world as the prose says', () => {
    const base = balanceOf(WORLD0);
    expect(base.price).toBeCloseTo(5.6, 6);
    expect(Math.round(base.price * 39.368)).toBe(220);
    expect(Math.round(base.production)).toBe(1230);
    expect(Math.round(base.trade)).toBe(171);
    expect(Math.round(base.stocksToUse * 100)).toBe(11);
    const drought = balanceOf({ ...WORLD0, us: -20 });
    expect(Math.round(drought.price * 100) / 100).toBe(7.77);
    expect(Math.round((drought.price / 5.6 - 1) * 100)).toBe(39);
    expect(Math.round(485 - drought.regions[4].use)).toBe(31);
    expect(Math.round(drought.carryIn - drought.carryOut)).toBe(23);
    expect(Math.round(balanceOf({ ...WORLD0, us: -10 }).price * 100) / 100).toBe(6.55);
    expect(bufferSolved({ ...WORLD0, us: -10, carryIn: 125 })).toBe(true);
    expect(bufferSolved({ ...WORLD0, us: -10, carryIn: 120 })).toBe(false);
    expect(bufferSolved({ ...WORLD0, us: -10, carryIn: 130 })).toBe(false);
    const noExports = clearWorld({ crop: { blackSea: -0.65 } });
    expect(Math.abs(noExports.regions[2].net)).toBeLessThan(1);
    expect(Math.round(noExports.price * 100) / 100).toBe(6.37);
  });
  it('simulates a history like the one the prose describes', () => {
    const h = history();
    expect(h).toHaveLength(60);
    expect(dearBigYear()).toBe(7);
    expect(Math.round(h[6].valleyCorn)).toBe(551);
    expect(Math.round(valleyAverage())).toBe(500);
    const worst = h.reduce((a, b) => (b.valleyCorn < a.valleyCorn ? b : a));
    expect(worst.year).toBe(46);
    expect(Math.round(worst.valleyCorn)).toBe(269);
    expect(Math.round(worst.crop.us * 100)).toBe(-24);
    expect(Math.round(worst.price * 100) / 100).toBe(9.94);
    const long = worldHistory(400);
    const corr = (a: number[], b: number[]) => {
      const m = (x: number[]) => x.reduce((t, v) => t + v, 0) / x.length;
      const ma = m(a);
      const mb = m(b);
      let c = 0;
      let va = 0;
      let vb = 0;
      a.forEach((v, i) => {
        c += (v - ma) * (b[i] - mb);
        va += (v - ma) ** 2;
        vb += (b[i] - mb) ** 2;
      });
      return c / Math.sqrt(va * vb);
    };
    const r = corr(long.map((y) => y.valleyCorn), long.map((y) => y.price));
    expect(Math.round(r * 100)).toBe(-63);
    expect(Math.round(r * r * 5)).toBe(2);
    expect(corr(long.slice(1).map((y) => y.price), long.slice(0, -1).map((y) => y.price))).toBeGreaterThan(0.2);
  });
});
