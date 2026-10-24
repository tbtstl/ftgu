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
