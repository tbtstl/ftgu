// The oil & petroleum course: engine tests, the numbers quoted in the lessons' prose, and checks
// that every challenge is reachable (and not already solved at the lesson's starting state).

import { describe, expect, it } from 'vitest';
import { FAMILY_RANGE, buildMolecule, hydrogenCount, type Family } from '../src/engines/oil/molecules';
import {
  apiFromSG,
  blend,
  blendViscosity,
  classify,
  crude,
  cumulativeYield,
  makeCrude,
  sgFromAPI,
  sulfurKgPerBarrel,
  tbpTemperature,
  tiltYields,
  viscosity,
  yieldBetween,
} from '../src/engines/oil/assay';
import { COMPONENTS, bubblePoint, dewPoint, flash, stages, vaporPressure } from '../src/engines/oil/phase';
import { FUELS, FUEL_BY_ID, airFuelRatio, co2PerKg, gjPerBarrel, lhvFromHC, usdPerGJ } from '../src/engines/oil/fuels';
import { CRUDE_SPECS, CUTS } from '../src/model/oil/crudes';
import { REF_PRICES } from '../src/model/oil/world';
import { gasolineSolved, lowestEightSolved } from '../src/lessons/oil/ch1/L1_1';
import { NORTHFIELD_API, residueCapSolved, sameDensitySolved } from '../src/lessons/oil/ch1/L1_2';
import { diluentSolved, heatSolved, wtiSolved } from '../src/lessons/oil/ch1/L1_3';
import { fewestStagesSolved, halfBoiledSolved } from '../src/lessons/oil/ch1/L1_4';
import { airSolved, parityPrice, paritySolved } from '../src/lessons/oil/ch1/L1_5';
import { FIELDS } from '../src/model/oil/fields';
import { fieldWell, hoursToReach, naturalFlowMargin, oilInPlace, productivityIndex, radialPressure, radialRate, trapVolume } from '../src/engines/oil/reservoir';
import { rockOf, wellCost, wellSummary, type WellDesign } from '../src/engines/oil/wells';
import { arpsCum, arpsRate, fieldOutcome, modifiedRate, nominalFromEffective, simulateField, waterCut } from '../src/engines/oil/decline';
import { STANDARD_WELL, irr, netbackPerBbl, npv, runProgram, wellBreakeven, wellEconomics, worldProjects } from '../src/engines/oil/economics';
import { hydrostatic } from '../src/engines/oil/reservoir';
import { fractureArea, wellProfile } from '../src/engines/oil/wells';
import { BASE_OIL, FLOW_NEEDS, doubleSolved, flowStopSolved } from '../src/lessons/oil/ch2/L2_1';
import { NORTHFIELD_PI, TIME_STEP, fieldDefaults, halfwaySolved, heavyOilSolved, reach } from '../src/lessons/oil/ch2/L2_2';
import { cheapestSolved, cheapestYearOneWell, contactArea, fewestStagesSolved as fewestFracStagesSolved, firstMonthRate } from '../src/lessons/oil/ch2/L2_3';
import { BEST_FIT, DATA, TRUE_EUR30, fitError, fitSolved, floodTimingSolved } from '../src/lessons/oil/ch2/L2_4';
import { allProjectsSolved, breakevenSolved, volumeCleared } from '../src/lessons/oil/ch2/L2_5';

const finite = (x: number) => Number.isFinite(x);

// ---------------------------------------------------------------------------
describe('molecules', () => {
  it('builds every molecule with the right formula and hydrogens drawn', () => {
    for (const f of ['straight', 'branched', 'ring', 'aromatic'] as Family[]) {
      const [lo, hi] = FAMILY_RANGE[f];
      for (let n = lo; n <= hi; n++) {
        const m = buildMolecule(f, n);
        expect(m.atoms.filter((a) => a.el === 'H').length).toBe(hydrogenCount(f, n));
        expect(m.atoms.filter((a) => a.el === 'C').length).toBe(n);
        expect(finite(m.bp)).toBe(true);
      }
    }
  });
  it('matches the numbers in Lesson 1.1', () => {
    expect(buildMolecule('straight', 8).formula).toBe('C8H18');
    expect(buildMolecule('branched', 8).bp).toBeCloseTo(99.3, 1);
    expect(buildMolecule('straight', 18).state).toBe('solid');
    expect(buildMolecule('straight', 17).state).toBe('liquid');
    expect(buildMolecule('straight', 4).state).toBe('gas');
    expect(buildMolecule('aromatic', 7).density).toBe(0.867);
    expect(buildMolecule('straight', 7).density).toBe(0.684);
    // Naphtha (30–160 °C) runs from five to nine carbons, kerosene (160–250) ten to thirteen, diesel to twenty.
    expect(buildMolecule('straight', 5).cut).toMatch(/naphtha/);
    expect(buildMolecule('straight', 9).cut).toMatch(/naphtha/);
    expect(buildMolecule('straight', 10).cut).toMatch(/kerosene/);
    expect(buildMolecule('straight', 13).cut).toMatch(/kerosene/);
    expect(buildMolecule('straight', 14).cut).toMatch(/diesel/);
    expect(buildMolecule('straight', 20).cut).toMatch(/diesel/);
  });
  it('has reachable challenges', () => {
    expect(lowestEightSolved('straight', 8)).toBe(false);
    expect(lowestEightSolved('branched', 8)).toBe(true);
    // Of the eight-carbon molecules, iso-octane boils lowest.
    const eights = (['straight', 'branched', 'ring', 'aromatic'] as Family[]).map((f) => buildMolecule(f, 8).bp);
    expect(Math.min(...eights)).toBe(buildMolecule('branched', 8).bp);
    expect(gasolineSolved(buildMolecule('straight', 8))).toBe(false);
    const qualifying = (['straight', 'branched', 'ring', 'aromatic'] as Family[]).flatMap((f) => {
      const [lo, hi] = FAMILY_RANGE[f];
      return Array.from({ length: hi - lo + 1 }, (_, i) => buildMolecule(f, lo + i)).filter(gasolineSolved).map((m) => m.name);
    });
    expect(qualifying.sort()).toEqual(['Benzene', 'Cyclopentane', 'Ethylbenzene', 'Iso-octane', 'Propylbenzene', 'Toluene']);
  });
});

// ---------------------------------------------------------------------------
describe('assay', () => {
  it('converts API gravity both ways', () => {
    expect(apiFromSG(1)).toBeCloseTo(10);
    expect(sgFromAPI(apiFromSG(0.85))).toBeCloseTo(0.85);
  });
  it('gives the four crudes realistic properties', () => {
    const rb = crude('ridgeback');
    const sb = crude('seaboard');
    const nf = crude('northfield');
    const cw = crude('coldwater');
    expect(rb.api).toBeCloseTo(42.1, 1);
    expect(sb.api).toBeCloseTo(37.1, 1);
    expect(nf.api).toBeCloseTo(29.2, 1);
    expect(cw.api).toBeCloseTo(20.7, 1);
    expect(classify(rb.api, rb.sulfur)).toEqual({ gravity: 'light', sweetness: 'sweet' });
    expect(classify(sb.api, sb.sulfur)).toEqual({ gravity: 'light', sweetness: 'sweet' });
    expect(classify(nf.api, nf.sulfur)).toEqual({ gravity: 'medium', sweetness: 'sour' });
    expect(classify(cw.api, cw.sulfur)).toEqual({ gravity: 'heavy', sweetness: 'sour' });
    // Mass balances close.
    for (const c of [rb, sb, nf, cw]) {
      const mass = c.yields.map((y, i) => (y * c.cutSG[i]) / c.sg);
      expect(mass.reduce((s, m, i) => s + m * c.cutSulfur[i], 0)).toBeCloseTo(c.sulfur, 9);
      expect(mass.reduce((s, m, i) => s + m * c.cutMetals[i], 0)).toBeCloseTo(c.metals, 9);
      expect(c.yields.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });
  it('matches the numbers in Lesson 1.2', () => {
    const nf = crude('northfield');
    const cw = crude('coldwater');
    const rb = crude('ridgeback');
    expect(Math.round(cumulativeYield(nf, 350) * 100)).toBe(51);
    expect(Math.round(cumulativeYield(cw, 350) * 100)).toBe(37);
    expect(Math.round(cw.yields[6] * 100)).toBe(35);
    expect(Math.round(cumulativeYield(rb, 350) * 100)).toBe(69);
    expect(Math.round((nf.cutSulfur[1] * 10000) / 10) * 10).toBe(530);
    expect(nf.cutSulfur[6]).toBeCloseTo(3.9, 1);
    expect(Math.round((rb.cutSulfur[4] * 10000) / 10) * 10).toBe(1300);
    expect(NORTHFIELD_API).toBeCloseTo(29.2, 1);
  });
  it('interpolates the boiling curve', () => {
    const nf = crude('northfield');
    expect(yieldBetween(nf, -45, 800)).toBeCloseTo(1);
    expect(cumulativeYield(nf, tbpTemperature(nf, 0.4))).toBeCloseTo(0.4, 9);
  });
  it('has reachable challenges in Lesson 1.2', () => {
    const sp = CRUDE_SPECS[2];
    const at = (tilt: number, a: number) => makeCrude({ ...sp, yields: tiltYields(sp.yields, tilt), aromaticity: a });
    expect(sameDensitySolved(at(0, sp.aromaticity))).toBe(false);
    expect(sameDensitySolved(at(-0.15, 0.9))).toBe(true);
    const st = { preset: 'northfield' as const, tilt: 0, aromaticity: sp.aromaticity, sulfur: sp.sulfur, metals: sp.metals };
    expect(residueCapSolved(st)).toBe(false);
    expect(residueCapSolved({ ...st, sulfur: 0.24 })).toBe(true);
    expect(residueCapSolved({ ...st, sulfur: 0.23 })).toBe(false);
  });
  it('matches the viscosity and blending numbers in Lesson 1.3', () => {
    const rb = crude('ridgeback');
    const nf = crude('northfield');
    const cw = crude('coldwater');
    expect(viscosity(rb, 20)).toBeCloseTo(3.5, 1);
    expect(Math.round(viscosity(cw, 20))).toBe(907);
    expect(Math.round(viscosity(cw, 50))).toBe(141);
    expect(Math.round(viscosity(cw, 10))).toBe(2058);
    expect(Math.round(viscosity(nf, 0))).toBe(108);
    expect(sulfurKgPerBarrel(cw)).toBeCloseTo(5.17, 2);
    expect(sulfurKgPerBarrel(rb)).toBeCloseTo(0.19, 2);
    const half = blend([
      { crude: rb, share: 50 },
      { crude: cw, share: 50 },
    ]);
    expect(Math.round(half.sg * 999)).toBe(872);
    expect(half.api).toBeCloseTo(30.7, 1);
    expect(
      blendViscosity(
        [
          { crude: rb, share: 50 },
          { crude: cw, share: 50 },
        ],
        20,
      ),
    ).toBeCloseTo(26.7, 1);
    // Heating: Coldwater Heavy matches Northfield Sour at 0 °C somewhere in the slider's range.
    const t = Array.from({ length: 61 }, (_, i) => i).find(heatSolved);
    expect(t).toBe(56);
    expect(heatSolved(20)).toBe(false);
    // Diluent: 20% Ridgeback Light; 19% isn't enough.
    expect(diluentSolved('coldwater', 'ridgeback', 20)).toBe(true);
    expect(diluentSolved('coldwater', 'ridgeback', 10)).toBe(false);
    // The WTI blend: at most 14% Northfield Sour; 1% already brings the blend under 42°.
    expect(wtiSolved('ridgeback', 'northfield', 14)).toBe(true);
    expect(wtiSolved('ridgeback', 'northfield', 13)).toBe(false);
    expect(
      blend([
        { crude: rb, share: 99 },
        { crude: nf, share: 1 },
      ]).api,
    ).toBeLessThan(42);
  });
  it('stays finite at slider extremes', () => {
    for (const sp of CRUDE_SPECS) {
      for (const tilt of [-0.4, 0.4]) {
        for (const a of [0, 1]) {
          for (const s of [0, 5]) {
            const c = makeCrude({ ...sp, yields: tiltYields(sp.yields, tilt), aromaticity: a, sulfur: s, metals: 0 });
            expect(finite(c.api)).toBe(true);
            expect(c.cutSulfur.every(finite)).toBe(true);
            expect(finite(viscosity(c, 0)) && finite(viscosity(c, 60))).toBe(true);
          }
        }
      }
    }
    expect(CUTS.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
describe('phase equilibrium', () => {
  const hx = COMPONENTS.hexane;
  const oc = COMPONENTS.octane;
  it('reproduces normal boiling points', () => {
    expect(vaporPressure(hx, 68.7)).toBeCloseTo(1, 2);
    expect(vaporPressure(oc, 125.7)).toBeCloseTo(1, 2);
  });
  it('matches the numbers in Lesson 1.4', () => {
    expect(bubblePoint([hx, oc], [0.5, 0.5], 1)).toBeCloseTo(86.8, 1);
    expect(dewPoint([hx, oc], [0.5, 0.5], 1)).toBeCloseTo(108.3, 1);
    expect(bubblePoint([hx, oc], [0.5, 0.5], 0.5)).toBeCloseTo(64.5, 1);
    const f = flash([hx, oc], [0.5, 0.5], 98, 1);
    expect(f.vapor).toBeCloseTo(0.5, 1);
    expect(stages(hx, oc, 0.5, 1, 3)[2].vapor).toBeGreaterThan(0.99);
    expect(stages(COMPONENTS.pentane, COMPONENTS.decane, 0.5, 1, 1)[0].vapor).toBeGreaterThan(0.99);
    expect(stages(COMPONENTS.heptane, oc, 0.5, 1, 4)[3].vapor).toBeCloseTo(0.961, 3);
  });
  it('has reachable challenges', () => {
    expect(halfBoiledSolved('hexOct', 50, 1, 80)).toBe(false);
    expect(halfBoiledSolved('hexOct', 50, 1, 98)).toBe(true);
    expect(fewestStagesSolved('hepOct', 50, 2)).toBe(false);
    expect(fewestStagesSolved('hepOct', 50, 4)).toBe(true);
    expect(fewestStagesSolved('hepOct', 50, 5)).toBe(false);
  });
  it('flashes consistently', () => {
    for (const t of [0, 90, 100, 220]) {
      for (const p of [0.2, 3]) {
        const f = flash([hx, oc], [0.3, 0.7], t, p);
        expect(f.vapor).toBeGreaterThanOrEqual(0);
        expect(f.vapor).toBeLessThanOrEqual(1);
        // Component balance: z = (1 − V) x + V y.
        expect((1 - f.vapor) * f.x[0] + f.vapor * f.y[0]).toBeCloseTo(0.3, 6);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('fuels', () => {
  it('matches published CO2 factors', () => {
    expect(co2PerKg(FUEL_BY_ID.jet)).toBeCloseTo(3.16, 2);
    expect(co2PerKg(FUEL_BY_ID.fuelOil)).toBeCloseTo(3.114, 2);
    // EPA: about 8.89 kg CO2 per gallon of gasoline and 10.18 of diesel.
    expect(co2PerKg(FUEL_BY_ID.gasoline) * FUEL_BY_ID.gasoline.density * 3.78541).toBeCloseTo(8.89, 1);
    expect(co2PerKg(FUEL_BY_ID.diesel) * FUEL_BY_ID.diesel.density * 3.78541).toBeCloseTo(10.18, 1);
  });
  it('fits heating values within 2% for the hydrocarbon fuels with little sulfur', () => {
    for (const f of FUELS.filter((x) => x.id !== 'ethanol' && x.id !== 'fuelOil')) expect(Math.abs(lhvFromHC(f.hc) / f.lhv - 1)).toBeLessThan(0.02);
    expect(lhvFromHC(4)).toBeCloseTo(50.0, 1);
  });
  it('matches the numbers in Lesson 1.5', () => {
    const d = FUEL_BY_ID.diesel;
    const g = FUEL_BY_ID.gasoline;
    expect(Math.round((gjPerBarrel(d) / gjPerBarrel(g) - 1) * 100)).toBe(12);
    expect(Math.abs(usdPerGJ(d, REF_PRICES.diesel) - usdPerGJ(g, REF_PRICES.gasoline))).toBeLessThan(0.25);
    expect(usdPerGJ(FUEL_BY_ID.fuelOil, REF_PRICES.hsfo)).toBeLessThan(usdPerGJ(d, REF_PRICES.diesel) * 0.6);
    expect(Math.round(parityPrice())).toBe(116);
    expect(paritySolved(REF_PRICES.hsfo)).toBe(false);
    expect(paritySolved(115.5)).toBe(true);
    expect(airSolved(1.5)).toBe(false);
    expect(airSolved(1.94)).toBe(true);
    expect(airFuelRatio(1.94)).toBeCloseTo(14.7, 1);
  });
});

// ---------------------------------------------------------------------------
// Chapter 2 engines.

describe('reservoir', () => {
  it('computes oil in place', () => {
    expect(oilInPlace(1, 1, 0, 1)).toBeCloseTo(7758);
    const t = trapVolume(FIELDS.northfield, 8000);
    expect(t.column).toBe(200);
    expect(Math.round(t.areaAcres)).toBe(7181);
    expect(Math.round(t.oil / 1e6)).toBe(322);
    expect(Math.round(trapVolume(FIELDS.northfield, 8150).oil / 1e6)).toBe(666);
    expect(trapVolume(FIELDS.northfield, 7800).oil).toBe(0);
  });
  it('tests natural flow', () => {
    expect(Math.round(naturalFlowMargin(3650, 7800, 0.76))).toBe(983);
    expect(Math.round(naturalFlowMargin(2667, 7800, 0.76))).toBe(0);
  });
  it('computes radial inflow and reach', () => {
    expect(productivityIndex(fieldWell('northfield'))).toBeCloseTo(1.804, 3);
    expect(radialRate(fieldWell('coldwater'), 400)).toBeCloseTo(73.3, 1);
    expect(productivityIndex(fieldWell('ridgeback'))).toBeLessThan(0.001);
    const w = fieldWell('northfield');
    expect(radialPressure(w, w.rw, 1000, 2000)).toBe(1000);
    expect(radialPressure(w, w.re, 1000, 2000)).toBe(2000);
    expect(radialPressure(w, Math.sqrt(w.re * w.rw), 1000, 2000)).toBeCloseTo(1500, 6);
    expect(hoursToReach(1000, 80, 0.22, 2, 1.5e-5)).toBeCloseTo(78.2, 1);
    expect(hoursToReach(50, 0.0005, 0.07, 0.4, 1.5e-5) / 24).toBeCloseTo(83.0, 1);
  });
});

describe('wells', () => {
  const rb = rockOf('ridgeback');
  it('gives realistic shale and conventional wells', () => {
    const f = wellSummary(STANDARD_WELL, rb);
    expect(f.ip30).toBeGreaterThan(1400);
    expect(f.ip30).toBeLessThan(1800);
    expect(Math.round(f.firstYear / 1000)).toBe(178);
    expect(f.cost.total / 1e6).toBeCloseTo(8.32, 2);
    const v = wellSummary({ type: 'vertical', lateral: 0, stages: 0 }, rb);
    expect(v.ip30).toBeLessThan(2);
    const h = wellSummary({ type: 'horizontal', lateral: 10000, stages: 0 }, rb);
    expect(h.ip30).toBeGreaterThan(50);
    expect(h.ip30).toBeLessThan(100);
    expect(wellCost({ type: 'vertical', lateral: 0, stages: 0 }, rockOf('northfield')).total / 1e6).toBeCloseTo(2.75, 2);
  });
  it('finds a unique cheapest well for 150,000 barrels in a year', () => {
    let best: { c: number; d: WellDesign } | null = null;
    for (let L = 2000; L <= 15000; L += 500)
      for (let n = 5; n <= 80; n++) {
        const d: WellDesign = { type: 'fractured', lateral: L, stages: n };
        const s = wellSummary(d, rb);
        if (s.firstYear >= 150000 && (!best || s.cost.total < best.c)) best = { c: s.cost.total, d };
      }
    expect(best!.d).toEqual({ type: 'fractured', lateral: 9000, stages: 41 });
  });
});

describe('decline', () => {
  it('matches Arps identities', () => {
    const di = nominalFromEffective(0.65, 1.1);
    expect(arpsRate(1000, di, 1.1, 1)).toBeCloseTo(350, 6);
    expect(arpsRate(1000, nominalFromEffective(0.3, 0), 0, 1)).toBeCloseTo(700, 6);
    // Cumulative is the integral of rate.
    let s = 0;
    for (let i = 0; i < 4000; i++) s += (arpsRate(500, 1.2, 0.8, (i + 0.5) / 1000) * 365.25) / 1000;
    expect(arpsCum(500, 1.2, 0.8, 4)).toBeCloseTo(s, -1);
    expect(modifiedRate(1000, di, 1.1, 0.08, 40)).toBeLessThan(arpsRate(1000, di, 1.1, 40));
  });
  it('runs Northfield through its drives', () => {
    expect(waterCut(0)).toBe(0);
    expect(waterCut(1)).toBe(1);
    const flowing = fieldOutcome(simulateField({ drive: 'flowing', floodYear: 0, wells: 25, oilPrice: 70 }));
    const pumps = fieldOutcome(simulateField({ drive: 'pumps', floodYear: 0, wells: 25, oilPrice: 70 }));
    const flood = fieldOutcome(simulateField({ drive: 'waterflood', floodYear: 3, wells: 25, oilPrice: 70 }));
    expect(flowing.life).toBe(4);
    expect(flowing.recovery).toBeCloseTo(0.042, 3);
    expect(pumps.recovery).toBeCloseTo(0.177, 3);
    expect(pumps.life).toBe(13);
    expect(flood.recovery).toBeCloseTo(0.413, 3);
    expect(fieldOutcome(simulateField({ drive: 'waterflood', floodYear: 12, wells: 25, oilPrice: 70 })).recovery).toBeGreaterThan(0.4);
    expect(fieldOutcome(simulateField({ drive: 'waterflood', floodYear: 13, wells: 25, oilPrice: 70 })).recovery).toBeLessThan(0.4);
  });
});

describe('field economics', () => {
  it('discounts and finds rates of return', () => {
    expect(npv([100], 0.1)).toBe(100);
    expect(npv([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 110], 0.1)).toBeCloseTo(100, 6);
    expect(irr([-100, ...Array<number>(11).fill(0), 110])).toBeCloseTo(0.1, 4);
  });
  it('values a Ridgeback well', () => {
    expect(wellBreakeven()).toBeCloseTo(55.77, 1);
    expect(wellEconomics(70).npv / 1e6).toBeCloseTo(3.15, 1);
    expect(wellEconomics(70).payback).toBe(17);
    expect(wellBreakeven(STANDARD_WELL, 0.65)).toBeCloseTo(78.0, 0);
    const p = worldProjects();
    expect(p.map((x) => x.id)).toEqual(['flood', 'seaboard', 'core', 'coldwater', 'fringe']);
    const a = runProgram({ wellsPerYear: 10, waterflood: false, price: 70 });
    const b = runProgram({ wellsPerYear: 11, waterflood: false, price: 70 });
    expect(b.npv).toBeGreaterThan(a.npv);
    expect(Number.isFinite(runProgram({ wellsPerYear: 30, waterflood: true, price: 30 }).npv)).toBe(true);
  });
});

describe('chapter 2 lessons', () => {
  it('2.1: oil in place and natural flow', () => {
    expect(Math.round(BASE_OIL / 1e6)).toBe(322);
    expect(doubleSolved(8000, 22, 25)).toBe(false);
    expect(doubleSolved(8140, 22, 25)).toBe(true);
    expect(doubleSolved(8145, 22, 25)).toBe(false);
    expect(doubleSolved(8140, 23, 25)).toBe(false);
    expect(trapVolume(FIELDS.northfield, 8140).column).toBe(340);
    expect(Math.round(trapVolume(FIELDS.northfield, 8140).areaAcres)).toBe(12207);
    expect(Math.round(FLOW_NEEDS)).toBe(2667);
    expect(flowStopSolved(3650)).toBe(false);
    expect(flowStopSolved(2670)).toBe(true);
    expect(flowStopSolved(2680)).toBe(false);
    expect(Math.round(hydrostatic(8000))).toBe(3720);
    expect(Math.round(hydrostatic(9500))).toBe(4418);
  });
  it('2.2: Darcy flow and reach', () => {
    const cw = fieldDefaults('coldwater');
    expect(NORTHFIELD_PI).toBeCloseTo(1.804, 3);
    expect(heavyOilSolved(cw)).toBe(false);
    expect(heavyOilSolved(fieldDefaults('northfield'))).toBe(false);
    expect(heavyOilSolved({ ...cw, muExp: 1.75 })).toBe(true);
    expect(heavyOilSolved({ ...cw, muExp: 1.7 })).toBe(false);
    expect(halfwaySolved(1.38)).toBe(false);
    expect(halfwaySolved(3.3)).toBe(true);
    expect(halfwaySolved(3.29)).toBe(false);
    expect(halfwaySolved(3.31)).toBe(false);
    expect(TIME_STEP).toBe(0.01);
    expect(reach('ridgeback', 1)).toBeCloseTo(1.1, 1);
    expect(reach('ridgeback', 24)).toBeCloseTo(5.5, 1);
    expect(Math.round(reach('ridgeback', 8766))).toBe(105);
    expect(Math.round(reach('ridgeback', 30 * 365.25 * 24))).toBe(575);
  });
  it('2.3: the well designer', () => {
    const v = { type: 'vertical' as const, lateral: 10000, stages: 50 };
    expect(cheapestYearOneWell().design).toEqual({ type: 'fractured', lateral: 9000, stages: 41 });
    expect(cheapestYearOneWell().cost / 1e6).toBeCloseTo(7.51, 2);
    expect(cheapestSolved('ridgeback', v)).toBe(false);
    expect(cheapestSolved('ridgeback', { type: 'fractured', lateral: 9000, stages: 41 })).toBe(true);
    expect(cheapestSolved('ridgeback', { type: 'fractured', lateral: 8500, stages: 42 })).toBe(false);
    expect(cheapestSolved('northfield', { type: 'fractured', lateral: 9000, stages: 41 })).toBe(false);
    expect(fewestFracStagesSolved('ridgeback', v)).toBe(false);
    expect(fewestFracStagesSolved('ridgeback', { type: 'fractured', lateral: 10000, stages: 30 })).toBe(true);
    expect(fewestFracStagesSolved('ridgeback', { type: 'fractured', lateral: 10000, stages: 31 })).toBe(false);
    expect(firstMonthRate({ type: 'fractured', lateral: 10000, stages: 29 })).toBeLessThan(1000);
    expect(Math.round(contactArea({ type: 'vertical', lateral: 0, stages: 0 }, 'ridgeback'))).toBe(273);
    expect(Math.round(contactArea({ type: 'horizontal', lateral: 10000, stages: 0 }, 'ridgeback'))).toBe(18221);
    expect(Math.round(fractureArea(STANDARD_WELL) / 273.3 / 1000)).toBe(22);
    const rb = rockOf('ridgeback');
    const f = wellSummary(STANDARD_WELL, rb);
    const h = wellSummary({ type: 'horizontal', lateral: 10000, stages: 0 }, rb);
    expect(Math.round(f.ip30 / h.ip30)).toBe(23);
    expect(Math.round(f.cost.total / f.firstYear)).toBe(47);
    expect(Math.round(h.cost.total / h.firstYear)).toBe(237);
    expect(Math.round(f.profile.rate[11])).toBe(204);
    expect(Math.round(wellSummary({ type: 'vertical', lateral: 0, stages: 0 }, rockOf('northfield')).profile.rate[11])).toBe(1285);
  });
  it('2.4: decline curves and the field', () => {
    expect(DATA.length).toBe(24);
    expect(fitSolved({ qi: 1600, de: 0.6, b: 0 })).toBe(false);
    expect(fitSolved(BEST_FIT)).toBe(true);
    // The best fit is a local minimum on the sliders' grid.
    for (const [dq, dd, db] of [
      [50, 0, 0],
      [-50, 0, 0],
      [0, 0.01, 0],
      [0, -0.01, 0],
      [0, 0, 0.05],
      [0, 0, -0.05],
    ])
      expect(fitError({ qi: BEST_FIT.qi + dq, de: BEST_FIT.de + dd, b: BEST_FIT.b + db })).toBeGreaterThan(fitError(BEST_FIT));
    expect(Math.round(TRUE_EUR30 / 1000)).toBe(385);
    expect(Math.round(wellProfile(STANDARD_WELL, rockOf('ridgeback'), 360).cum[359] / 1000)).toBe(385);
    const di = nominalFromEffective(BEST_FIT.de, BEST_FIT.b);
    expect(Math.round(arpsCum(BEST_FIT.qi, di, BEST_FIT.b, 30) / 1000)).toBe(465);
    expect(Math.round(arpsCum(BEST_FIT.qi, di, BEST_FIT.b, 100) / 1000)).toBe(591);
    expect(floodTimingSolved('waterflood', 12, 70)).toBe(true);
    expect(floodTimingSolved('waterflood', 11, 70)).toBe(false);
    expect(floodTimingSolved('waterflood', 13, 70)).toBe(false);
    expect(floodTimingSolved('flowing', 3, 70)).toBe(false);
    const o = (fy: number, p: number) => fieldOutcome(simulateField({ drive: 'waterflood', floodYear: fy, wells: 25, oilPrice: p }));
    expect(o(3, 40).recovery).toBeCloseTo(0.397, 3);
    expect(o(3, 100).recovery).toBeCloseTo(0.424, 3);
  });
  it('2.5: field economics', () => {
    expect(netbackPerBbl(70)).toBeCloseTo(50.37, 2);
    expect(wellEconomics(70).irr).toBeCloseTo(0.5, 1);
    expect(wellEconomics(70).cash.slice(1, 13).reduce((a, b) => a + b, 0) / 1e6).toBeCloseTo(7.43, 2);
    expect(Math.round(wellEconomics(70).life / 12)).toBe(21);
    const p0 = runProgram({ wellsPerYear: 0, waterflood: false, price: 70 });
    expect((runProgram({ wellsPerYear: 10, waterflood: false, price: 70 }).npv - p0.npv) / 1e6).toBeCloseTo(126, 0);
    const pf = runProgram({ wellsPerYear: 0, waterflood: true, price: 70 });
    expect((pf.npv - p0.npv) / 1e9).toBeCloseTo(1.94, 2);
    expect(Math.round(pf.flood.reduce((s, q) => s + (q * 365.25) / 12, 0) / 1e6)).toBe(76);
    expect(volumeCleared(50, 'full')).toBeCloseTo(255, 0);
    expect(breakevenSolved(70)).toBe(false);
    expect(breakevenSolved(56)).toBe(true);
    expect(breakevenSolved(55.5)).toBe(false);
    expect(allProjectsSolved('full', 50)).toBe(false);
    expect(allProjectsSolved('full', 78.5)).toBe(true);
    expect(allProjectsSolved('full', 78)).toBe(false);
    expect(allProjectsSolved('half', 78.5)).toBe(false);
  });
});
