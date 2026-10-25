// Chapter 1 of the oil course: the numbers and challenge checks added or changed in the fix passes.
// The chapter's original assertions live in tests/oil.test.ts.

import { describe, expect, it } from 'vitest';
import { FAMILY_RANGE, buildMolecule, type Family } from '../src/engines/oil/molecules';
import { LITERS_PER_BARREL, blend, blendViscosity, crude, massFractions, viscosity } from '../src/engines/oil/assay';
import { CRUDE_SPECS } from '../src/model/oil/crudes';
import { makeCrude } from '../src/engines/oil/assay';
import { COMPONENTS, bubblePoint, dewPoint, flash, relativeVolatility, stages, txy } from '../src/engines/oil/phase';
import { FUEL_BY_ID, LITERS_PER_GALLON, GALLONS_PER_BARREL, airFuelRatio, gjPerBarrel, usdPerGJ } from '../src/engines/oil/fuels';
import { REF_PRICES } from '../src/model/oil/world';
import { fmt, pct, usd } from '../src/framework';
import { gasolineSolved, lowestEightSolved } from '../src/lessons/oil/ch1/L1_1';
import { residueCapSolved } from '../src/lessons/oil/ch1/L1_2';
import { PIPE_TEMP_C, WTI_API_FLOOR_SHARE, WTI_SULFUR_SHARE_BY_WEIGHT, diluentSolved, heatSolved, wtiSolved } from '../src/lessons/oil/ch1/L1_3';
import { PRESSURE_DROP_P, PRESSURE_DROP_T, P_MAX, P_MIN, fewestStagesSolved, pairAxis } from '../src/lessons/oil/ch1/L1_4';
import { airSolved, gasDieselGapPct, parityPrice, paritySolved } from '../src/lessons/oil/ch1/L1_5';

const FAMILIES: Family[] = ['straight', 'branched', 'ring', 'aromatic'];

describe('oil/1.1', () => {
  it('keeps challenge b from being solved by challenge a’s answer', () => {
    const iso = buildMolecule('branched', 8);
    expect(lowestEightSolved('branched', 8)).toBe(true);
    expect(gasolineSolved(iso)).toBe(false);
    // The default molecule doesn't solve it either.
    expect(gasolineSolved(buildMolecule('straight', 8))).toBe(false);
    // Switching straight to Ring at eight carbons gives ethylcyclohexane, which knocks.
    expect(gasolineSolved(buildMolecule('ring', 8))).toBe(false);
    expect(gasolineSolved(buildMolecule('ring', 5))).toBe(true);
  });
  it('matches the success message: only the smallest ring qualifies; iso-octane and benzene–propylbenzene rate high too; no straight chain does', () => {
    const goodGasoline = FAMILIES.flatMap((f) => {
      const [lo, hi] = FAMILY_RANGE[f];
      return Array.from({ length: hi - lo + 1 }, (_, i) => buildMolecule(f, lo + i)).filter((m) => m.bp >= 30 && m.bp < 160 && m.knock === 'high');
    });
    expect(goodGasoline.map((m) => m.name).sort()).toEqual(['Benzene', 'Cyclopentane', 'Ethylbenzene', 'Iso-octane', 'Propylbenzene', 'Toluene']);
    expect(goodGasoline.filter((m) => m.family === 'ring').map((m) => m.carbons)).toEqual([FAMILY_RANGE.ring[0]]);
  });
  it('rates the single-branch molecules below iso-octane, the only highly branched one', () => {
    for (const n of [7, 9, 10]) expect(['low', 'very low']).toContain(buildMolecule('branched', n).knock);
    expect(buildMolecule('branched', 8).knock).toBe('high');
  });
});

describe('oil/1.2', () => {
  it('defines the barrel as 42 US gallons, about 159 liters', () => {
    expect(GALLONS_PER_BARREL).toBe(42);
    expect(Math.round(GALLONS_PER_BARREL * LITERS_PER_GALLON)).toBe(159);
    expect(GALLONS_PER_BARREL * LITERS_PER_GALLON).toBeCloseTo(LITERS_PER_BARREL, 2);
  });
  it('concentrates Northfield Sour’s 60 ppm of nickel and vanadium to about 260 ppm in the residue', () => {
    const nf = crude('northfield');
    expect(fmt(nf.metals)).toBe('60');
    expect(fmt(Math.round(nf.cutMetals[6] / 10) * 10)).toBe('260');
    // The caption's numbers move with the metals slider.
    const sp = CRUDE_SPECS.find((s) => s.id === 'northfield')!;
    const more = makeCrude({ ...sp, metals: 120 });
    expect(more.cutMetals[6]).toBeCloseTo(2 * nf.cutMetals[6], 9);
    expect(fmt(nf.cutMetals[6] / nf.metals, 1)).toBe('4.3');
  });
  it('keeps the lightest cuts mostly chains in every crude, and the residue holds well under all the sulfur', () => {
    for (const sp of CRUDE_SPECS) {
      const c = makeCrude(sp);
      expect(c.cutClasses[0].paraffins).toBeGreaterThan(0.5);
      expect(c.cutClasses[1].paraffins).toBeGreaterThan(0.5);
      // Even at the slider's most aromatic setting.
      expect(makeCrude({ ...sp, aromaticity: 1 }).cutClasses[1].paraffins).toBeGreaterThan(0.5);
      const m = massFractions(c);
      // "Much of" the sulfur (Lesson 1.5), not "most" (Lesson 1.2's old wording).
      expect((m[6] * c.cutSulfur[6]) / c.sulfur).toBeGreaterThan(0.25);
      expect((m[6] * c.cutSulfur[6]) / c.sulfur).toBeLessThan(0.7);
      // Nearly all the metals are in the residue.
      expect((m[6] * c.cutMetals[6]) / c.metals).toBeGreaterThan(0.85);
    }
  });
});

describe('oil/1.3', () => {
  it('quotes the half-and-half blend at the pipeline temperature, where the figure opens', () => {
    const rb = crude('pinyon');
    const cw = crude('coldwater');
    const parts = [
      { crude: rb, share: 50 },
      { crude: cw, share: 50 },
    ];
    const v = blendViscosity(parts, PIPE_TEMP_C);
    expect(PIPE_TEMP_C).toBe(10);
    expect(Math.round(v)).toBe(41);
    // "About a third of the way" on the log scale, "a tiny fraction" in centistokes.
    const a = viscosity(rb, PIPE_TEMP_C);
    const b = viscosity(cw, PIPE_TEMP_C);
    const logFrac = (Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a));
    expect(logFrac).toBeGreaterThan(0.3);
    expect(logFrac).toBeLessThan(0.4);
    expect((v - a) / (b - a)).toBeLessThan(0.05);
  });
});

describe('oil/1.4', () => {
  const hx = COMPONENTS.hexane;
  const oc = COMPONENTS.octane;
  it('boils the half-and-half mixture by lowering the pressure at 70 °C', () => {
    expect(flash([hx, oc], [0.5, 0.5], PRESSURE_DROP_T, 1).phase).toBe('liquid');
    const f = flash([hx, oc], [0.5, 0.5], PRESSURE_DROP_T, PRESSURE_DROP_P);
    expect(f.phase).toBe('two-phase');
    expect(pct(f.vapor)).toBe('27%');
    expect(pct(f.y[0])).toBe('81%');
  });
  it('multiplies the heptane-to-octane ratio by about the relative volatility at each stage', () => {
    const st = stages(COMPONENTS.heptane, oc, 0.5, 1, 4);
    const odds = st.map((s) => s.vapor / (1 - s.vapor));
    expect(fmt(odds[0], 1)).toBe('2.2');
    expect(fmt(odds[1], 1)).toBe('4.9');
    expect(pct(st[0].vapor)).toBe('69%');
    expect(pct(st[1].vapor)).toBe('83%');
    expect(fmt(relativeVolatility(COMPONENTS.heptane, oc, 110), 1)).toBe('2.2');
    for (let k = 1; k < 4; k++) expect(odds[k] / odds[k - 1]).toBeCloseTo(relativeVolatility(COMPONENTS.heptane, oc, st[k].t), 6);
    // The challenge (95% heptane) still needs four stages; the prose no longer states that.
    expect(fewestStagesSolved('hepOct', 50, 2)).toBe(false);
    expect(fewestStagesSolved('hepOct', 50, 4)).toBe(true);
  });
});

describe('oil/1.5', () => {
  it('puts gasoline and diesel within about 1% of each other per gigajoule', () => {
    expect(fmt(gasDieselGapPct())).toBe('1');
  });
  it('judges the air challenge on the displayed readout, within 0.05 kg', () => {
    const r2 = (x: number) => Math.round(x * 100) / 100;
    expect(airSolved(1.5)).toBe(false);
    expect(fmt(airFuelRatio(1.9), 2)).toBe('14.65');
    expect(airSolved(r2(1.9))).toBe(true);
    expect(airSolved(r2(1.89))).toBe(false);
    expect(airSolved(r2(1.94))).toBe(true);
    expect(airSolved(r2(1.97))).toBe(true);
    expect(airSolved(r2(1.98))).toBe(false);
    expect(fmt(FUEL_BY_ID.gasoline.hc, 1)).toBe('1.9');
  });
});

// ---------------------------------------------------------------------------
// Pass 2: predict-then-check challenges, the fixed boiling-diagram axis and the chapter's tones.

describe('oil/1.1 pass 2', () => {
  it('judges challenge a on the shape alone: only the branched eight-carbon molecule solves it', () => {
    expect(lowestEightSolved('straight', 8)).toBe(false); // the default
    expect(lowestEightSolved('branched', 8)).toBe(true);
    expect(lowestEightSolved('ring', 8)).toBe(false);
    expect(lowestEightSolved('aromatic', 8)).toBe(false);
    expect(lowestEightSolved('branched', 7)).toBe(false);
    expect(lowestEightSolved('branched', 9)).toBe(false);
  });
});

describe('oil/1.2 pass 2', () => {
  const sp = CRUDE_SPECS.find((s) => s.id === 'northfield')!;
  const st = { preset: 'northfield' as const, tilt: 0, aromaticity: sp.aromaticity, sulfur: sp.sulfur, metals: sp.metals };
  const factor = (sulfur: number) => makeCrude({ ...sp, sulfur }).cutSulfur[6] / sulfur;
  it('gives a residue factor, shown to two decimals, that doesn’t change with the sulfur slider', () => {
    expect(fmt(factor(sp.sulfur), 2)).toBe('2.05');
    for (const s of [0.1, 0.24, 1, 3.5, 5]) expect(factor(s)).toBeCloseTo(factor(sp.sulfur), 9);
  });
  it('lets the prediction 0.5 ÷ 2.05 ≈ 0.244% land on the answer, 0.24%', () => {
    expect(fmt(0.5 / factor(sp.sulfur), 3)).toBe('0.244');
    expect(Math.floor((0.5 / 2.05) * 100) / 100).toBe(0.24);
    expect(residueCapSolved(st)).toBe(false); // the default, 1.9%
    expect(residueCapSolved({ ...st, sulfur: 0.24 })).toBe(true);
    expect(residueCapSolved({ ...st, sulfur: 0.23 })).toBe(false);
    expect(residueCapSolved({ ...st, sulfur: 0.25 })).toBe(false);
    // Not on another crude, or on a changed Northfield Sour.
    expect(residueCapSolved({ ...st, preset: 'pinyon', sulfur: 0.24 })).toBe(false);
    expect(residueCapSolved({ ...st, tilt: -0.1, sulfur: 0.24 })).toBe(false);
  });
});

describe('oil/1.3 pass 2', () => {
  const rb = crude('pinyon');
  const nf = crude('northfield');
  const cw = crude('coldwater');
  const cst = (v: number) => (v < 10 ? `${fmt(v, 1)} cSt` : `${fmt(v)} cSt`);
  it('challenge a: Coldwater Heavy reaches Northfield Sour’s 0 °C viscosity at 56 °C, and the display tells 55 from 56', () => {
    expect(cst(viscosity(nf, 0))).toBe('108 cSt');
    expect(cst(viscosity(cw, 50))).toBe('141 cSt');
    expect(cst(viscosity(cw, 55))).toBe('110 cSt');
    expect(cst(viscosity(cw, 56))).toBe('105 cSt');
    expect(heatSolved(20)).toBe(false); // the viscosity figure's default
    expect(heatSolved(56)).toBe(true);
    expect(heatSolved(55)).toBe(false);
    expect(heatSolved(57)).toBe(false);
  });
  it('quotes the viscosity figure’s 20 °C readouts', () => {
    expect(cst(viscosity(rb, 20))).toBe('3.5 cSt');
    expect(cst(viscosity(cw, 20))).toBe('907 cSt');
  });
  it('challenge b: the blending figure, now fixed at 10 °C, opens unsolved and needs 20%', () => {
    expect(diluentSolved('coldwater', 'pinyon', 10)).toBe(false); // the default
    expect(diluentSolved('coldwater', 'pinyon', 20)).toBe(true);
    expect(diluentSolved('coldwater', 'pinyon', 19)).toBe(false);
    expect(diluentSolved('coldwater', 'pinyon', 21)).toBe(false);
    expect(Math.round(blendViscosity([{ crude: cw, share: 80 }, { crude: rb, share: 20 }], PIPE_TEMP_C))).toBe(328);
  });
  it('challenge c: the sulfur balance predicts about 15% by weight, a little less by volume, and 14% is the answer', () => {
    expect(pct(WTI_SULFUR_SHARE_BY_WEIGHT)).toBe('15%');
    const b = (p: number) => blend([{ crude: rb, share: 100 - p }, { crude: nf, share: p }]);
    expect(b(14).sulfur).toBeLessThanOrEqual(0.42);
    expect(b(15).sulfur).toBeGreaterThan(0.42);
    expect(wtiSolved('coldwater', 'pinyon', 14)).toBe(false); // the figure's default crudes
    expect(wtiSolved('pinyon', 'northfield', 14)).toBe(true);
    expect(wtiSolved('pinyon', 'northfield', 13)).toBe(false);
    expect(wtiSolved('pinyon', 'northfield', 15)).toBe(false);
    // The gravity had room to spare: 1% is under 42°, and 37° is reached only at 37%.
    expect(b(1).api).toBeLessThan(42);
    expect(WTI_API_FLOOR_SHARE).toBe(37);
    expect(b(37).api).toBeGreaterThanOrEqual(37);
    expect(b(38).api).toBeLessThan(37);
  });
});

describe('oil/1.4 pass 2', () => {
  const pairs = {
    hexOct: [COMPONENTS.hexane, COMPONENTS.octane],
    hepOct: [COMPONENTS.heptane, COMPONENTS.octane],
    penDec: [COMPONENTS.pentane, COMPONENTS.decane],
  } as const;
  it('fixes each pair’s temperature axis across the whole pressure range', () => {
    expect(pairAxis('hexOct')).toEqual([20, 180]);
    expect(pairAxis('hepOct')).toEqual([40, 180]);
    expect(pairAxis('penDec')).toEqual([-20, 240]);
    for (const id of Object.keys(pairs) as Array<keyof typeof pairs>) {
      const [lo, hi] = pairAxis(id);
      const [l, h] = pairs[id];
      for (const p of [P_MIN, 0.5, 1, 2, P_MAX]) {
        for (const c of txy(l, h, p, 21)) {
          expect(c.bubble).toBeGreaterThanOrEqual(lo);
          expect(c.dew).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
  it('moves the curves on that axis as the pressure changes', () => {
    const z = [0.5, 0.5];
    const [hx, oc] = pairs.hexOct;
    expect(fmt(bubblePoint([hx, oc], z, 1), 1)).toBe('86.8');
    expect(fmt(bubblePoint([hx, oc], z, 0.5), 1)).toBe('64.5');
    expect(dewPoint([hx, oc], z, P_MAX) - dewPoint([hx, oc], z, P_MIN)).toBeGreaterThan(80);
  });
  it('challenge b: the ratio rule predicts four stages, and the default two doesn’t solve it', () => {
    const a = relativeVolatility(COMPONENTS.heptane, COMPONENTS.octane, 110);
    expect(fmt(a, 1)).toBe('2.2');
    expect(fmt(a ** 3)).toBe('11');
    expect(a ** 3).toBeLessThan(19);
    expect(a ** 4).toBeGreaterThan(19);
    expect(fewestStagesSolved('hepOct', 50, 2)).toBe(false);
    expect(fewestStagesSolved('hepOct', 50, 3)).toBe(false);
    expect(fewestStagesSolved('hepOct', 50, 4)).toBe(true);
    expect(fewestStagesSolved('hepOct', 50, 5)).toBe(false);
    expect(fewestStagesSolved('hexOct', 50, 4)).toBe(false);
  });
});

describe('oil/1.5 pass 2', () => {
  const d = FUEL_BY_ID.diesel;
  const h = FUEL_BY_ID.fuelOil;
  it('challenge a: diesel’s displayed $/GJ times fuel oil’s displayed GJ/bbl lands within the tolerance', () => {
    expect(usd(usdPerGJ(d, REF_PRICES.diesel), 2)).toBe('$18.48');
    expect(fmt(gjPerBarrel(h), 2)).toBe('6.26');
    const predicted = 18.48 * 6.26;
    expect(predicted).toBeCloseTo(115.68, 2);
    expect(usd(parityPrice(), 0)).toBe('$116');
    // The slider moves in 50¢ steps: both steps beside the prediction solve it, the next ones don't.
    expect(paritySolved(115.5)).toBe(true);
    expect(paritySolved(116)).toBe(true);
    expect(paritySolved(115)).toBe(false);
    expect(paritySolved(116.5)).toBe(false);
    expect(paritySolved(REF_PRICES.hsfo)).toBe(false); // the default
  });
  it('challenge b: the gasoline and jet-fuel dots predict a passing ratio; diesel’s falls just short', () => {
    expect(airSolved(FUEL_BY_ID.gasoline.hc)).toBe(true);
    expect(airSolved(FUEL_BY_ID.jet.hc)).toBe(true);
    expect(airSolved(FUEL_BY_ID.diesel.hc)).toBe(false);
    expect(airSolved(1.9)).toBe(true);
    expect(airSolved(1.5)).toBe(false); // the default
    expect(fmt(airFuelRatio(FUEL_BY_ID.diesel.hc), 2)).toBe('14.56');
  });
});

describe('oil chapter 1 tones', () => {
  const files = import.meta.glob<string>('../src/lessons/oil/ch1/L1_*.tsx', { query: '?raw', import: 'default', eager: true });
  const src = (n: number) => files[`../src/lessons/oil/ch1/L1_${n}.tsx`];
  const tones = (n: number) => new Set([...src(n).matchAll(/tone(?:=\"|: ')(\w+)/g)].map((m) => m[1]));
  it('keeps gold for energy (1.5), violet for viscosity (1.3) and teal for API gravity (1.2–1.3)', () => {
    for (const n of [1, 2, 3, 4]) expect(tones(n).has('gold')).toBe(false);
    for (const n of [1, 2, 4, 5]) expect(tones(n).has('violet')).toBe(false);
    for (const n of [1, 4, 5]) expect(tones(n).has('teal')).toBe(false);
    // Sulfur is orange wherever it's toned.
    expect(src(2)).toMatch(/<K tone="orange">Sulfur<\/K>/);
    expect(src(3)).toMatch(/<K tone="orange">sulfur<\/K>/);
    expect(src(3)).not.toMatch(/tone="orange"[^>]*value=\{share\}/);
  });
});
