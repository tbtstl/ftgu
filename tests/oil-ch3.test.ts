// Oil chapter 3: assertions for the prose numbers and challenge checks changed in the audit's fix pass.
import { describe, expect, it } from 'vitest';
import { fmt } from '../src/framework';
import { crude } from '../src/engines/oil/assay';
import {
  COKER,
  CRACKING_LIMIT,
  DEFAULT_CUTS,
  FCC_OPEX,
  HDS,
  SUMMER,
  ULSD_LIMIT,
  atmosphericEquivalent,
  carbonRejected,
  distill,
  fccConversion,
  fccYields,
  hdsSulfurOut,
  hydrogenToUpgrade,
  optimizeBlend,
} from '../src/engines/oil/refining';
import { FUEL_OIL_SULFUR, JET_SULFUR, crudeBreakeven, planRefinery, shadowPrices } from '../src/engines/oil/refinery';
import { CORRAN, CRUDE_PRICE, HYDROGEN_COST, PRODUCT_PRICE, UNIT_OPEX } from '../src/model/oil/refinery';
import { AIRLINE_BEST, AIRLINE_JET, CUT_PRICE, TOWER_DEFAULTS, airlineSolved, cutValue, jetRate, type TowerState } from '../src/lessons/oil/ch3/L3_1';
import { CHALLENGE_FEED, FEED_AROMATICITY, H2_SUPPLY, HEAVY_HC, HEAVY_SG, bestConversion, bestTempSolved, bestTemperature, hydrogenLimitSolved, marginAt } from '../src/lessons/oil/ch3/L3_2';
import { getSlates, hydrogenPlantSolved, throughputSolved } from '../src/lessons/oil/ch3/L3_3';
import { BUTANE_PER_PSI, butaneAt, butaneFiveSolved, handBlendSolved } from '../src/lessons/oil/ch3/L3_4';
import {
  DHT_EXAMPLE,
  DIESEL_EXAMPLE,
  EXPANSION,
  GASOLINE_EXAMPLE,
  bestExpansionSolved,
  coldwaterLimitSolved,
  coldwaterSteps,
  cokerBottleneckEnd,
  expandedConfig,
  expansionGain,
  northfieldSteps,
} from '../src/lessons/oil/ch3/L3_5';

const round10 = (x: number) => Math.round(x / 10) * 10;

describe('oil chapter 3 fix pass', () => {
  it('3.1: sulfur in ppm, and the atmospheric column’s reach', () => {
    expect(Math.round(distill(crude('northfield')).diesel.sulfur * 100) * 100).toBe(11500);
    expect(atmosphericEquivalent(CRACKING_LIMIT, 760) - DEFAULT_CUTS.dieselGasoil).toBeCloseTo(50, 6);
  });

  it('3.2: challenge b has no rounding trap', () => {
    const h = (r: number) => hydrogenToUpgrade(r, HEAVY_SG.gasOil);
    expect(H2_SUPPLY).toBe(1250);
    // The default state (reject route, gas oil at its typical 1.6) is unsolved; the intended answer solves; its neighbors don't.
    expect(hydrogenLimitSolved('reject', 'gasOil', HEAVY_HC.gasOil)).toBe(false);
    expect(hydrogenLimitSolved('add', 'gasOil', HEAVY_HC.gasOil)).toBe(false);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.63)).toBe(true);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.62)).toBe(false);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.64)).toBe(false);
    expect(hydrogenLimitSolved('add', 'residue', 1.63)).toBe(false);
    // The readout (rounded to 10 scf) agrees with the check on both sides of the answer.
    expect(round10(h(1.62))).toBeGreaterThan(H2_SUPPLY);
    expect(round10(h(1.63))).toBeLessThanOrEqual(H2_SUPPLY);
    expect(h(1.62) - H2_SUPPLY).toBeGreaterThan(5);
    expect(H2_SUPPLY - h(1.63)).toBeGreaterThan(5);
  });

  it('3.2: the cracker’s best conversion at the reference prices', () => {
    expect(bestConversion().X).toBeCloseTo(0.656, 3);
    expect(Math.round(bestConversion().X * 100)).toBe(66);
  });

  it('3.3: the hydrotreater squeeze', () => {
    const all = getSlates();
    const at = (share: number) => all.find((s) => s.share === share)!;
    const nf = distill(crude('northfield'));
    // Northfield’s kerosene is too sour for jet; Pinyon’s isn’t.
    expect(nf.kerosene.sulfur).toBeGreaterThan(JET_SULFUR);
    expect(nf.kerosene.sulfur).toBeCloseTo(0.44, 2);
    expect(distill(crude('pinyon')).kerosene.sulfur).toBeLessThan(JET_SULFUR);
    // The hydrotreater fills at 40%.
    const full = all.find((s) => s.plan.unitFeed.dht >= CORRAN.capacity.dht - 1e-6)!;
    expect(full.share).toBe(40);
    // No diesel ever goes to fuel oil.
    for (const s of all) {
      expect(s.plan.flows.df_pinyon).toBeLessThan(1e-6);
      expect(s.plan.flows.df_northfield).toBeLessThan(1e-6);
    }
    // Coker gas oil is pushed out of the hydrotreater: 9.5 kb/d at 35%, none by 90%.
    expect(at(35).plan.flows.cgoD).toBeCloseTo(9.5, 1);
    expect(all.find((s) => s.share > 40 && s.plan.flows.cgoD < 0.05)!.share).toBe(90);
    // On Northfield alone: 28.5 kb/d of residue, 6.8 coked, 21.7 to fuel oil.
    expect(nf.residue.volume * CORRAN.capacity.cdu).toBeCloseTo(28.5, 1);
    expect(at(100).plan.unitFeed.coker).toBeCloseTo(6.8, 1);
    expect(at(100).plan.flows.ro_northfield).toBeCloseTo(21.7, 1);
    expect(at(0).plan.products.hsfo).toBeCloseTo(2.2, 1);
    expect(at(100).plan.products.hsfo).toBeCloseTo(26.9, 1);
    expect(all.find((s) => s.plan.fuelOilSulfur >= FUEL_OIL_SULFUR - 1e-6)!.share).toBe(55);
    // The cause is the hydrotreater: with 15 kb/d more of it, the coker runs full again; more cracker changes nothing.
    const slate80 = { pinyon: 30, northfield: 120, seaboard: 0, coldwater: 0 };
    const moreDht = planRefinery({ crudeAvailable: slate80, config: { ...CORRAN, capacity: { ...CORRAN.capacity, dht: CORRAN.capacity.dht + 15 } } });
    expect(moreDht.unitFeed.coker).toBeCloseTo(CORRAN.capacity.coker, 4);
    expect(moreDht.flows.ro_northfield).toBeLessThan(0.5);
    const moreFcc = planRefinery({ crudeAvailable: slate80, config: { ...CORRAN, capacity: { ...CORRAN.capacity, fcc: CORRAN.capacity.fcc + 20 } } });
    expect(moreFcc.margin).toBeCloseTo(at(80).plan.margin, 0);
    // Coking a barrel of residue whose gas oil must go to the cracker earns less than selling the residue as fuel oil.
    const fy = fccYields(0.75);
    const p = PRODUCT_PRICE;
    const crackedGasOil = fy.gasoline * p.gasoline + fy.lpg * p.lpg + (fy.lco + fy.slurry) * p.hsfo - FCC_OPEX;
    const coked = COKER.lpg * p.lpg + COKER.naphtha * p.naphtha + COKER.cokeTonnes * p.coke - UNIT_OPEX.coker + COKER.gasOil * crackedGasOil;
    expect(coked).toBeLessThan(p.hsfo);
    // The margin’s kink: about 16¢ a step before the hydrotreater fills, about 2¢ after.
    expect(Math.round((all[1].marginPerBbl - all[0].marginPerBbl) * 100)).toBe(16);
    expect(Math.round((all[10].marginPerBbl - all[9].marginPerBbl) * 100)).toBe(2);
    // Peak at 80%; past it, little coker gas oil is left, kerosene goes to fuel oil and more residue is coked for the cracker.
    const best = all.reduce((a, s) => (s.marginPerBbl > a.marginPerBbl ? s : a), all[0]);
    expect(best.share).toBe(80);
    expect(best.marginPerBbl).toBeCloseTo(13.2, 2);
    expect(best.plan.flows.cgoD).toBeLessThan(0.25 * at(35).plan.flows.cgoD);
    expect(best.plan.fuelOilSulfur).toBeCloseTo(FUEL_OIL_SULFUR, 4);
    expect(best.plan.flows.kf_northfield).toBeLessThan(1e-6);
    expect(at(100).plan.flows.kf_northfield).toBeGreaterThan(1);
    expect(at(100).plan.flows.rc_northfield).toBeGreaterThan(best.plan.flows.rc_northfield + 1);
    expect(at(100).plan.flows.cgoF).toBeGreaterThan(1);
    // Hydrogen is a minor cost: at most 1.4 MMscf/d, about $4,200 a day, against $57,000 a day below the peak.
    const plantMax = Math.max(...all.map((s) => s.plan.hydrogen.plant));
    expect(all.find((s) => s.plan.hydrogen.plant > 0.01)!.share).toBe(90);
    expect(plantMax).toBeCloseTo(1.39, 2);
    expect(Math.round((plantMax * 1000 * HYDROGEN_COST) / 100) * 100).toBe(4200);
    expect(Math.round((best.plan.margin - at(100).plan.margin) / 1000) * 1000).toBe(57000);
  });

  it('3.5: challenge a needs the reference prices', () => {
    const ref = { gasoline: PRODUCT_PRICE.gasoline, diesel: PRODUCT_PRICE.diesel, coldwater: CRUDE_PRICE.coldwater, northfield: CRUDE_PRICE.northfield };
    expect(coldwaterLimitSolved(ref)).toBe(false);
    expect(coldwaterLimitSolved({ ...ref, coldwater: 68.5 })).toBe(true);
    expect(coldwaterLimitSolved({ ...ref, coldwater: 69 })).toBe(false);
    expect(coldwaterLimitSolved({ ...ref, coldwater: 68.5, gasoline: 100 })).toBe(false);
    expect(coldwaterLimitSolved({ ...ref, coldwater: 68.5, northfield: 75 })).toBe(false);
  });

  it('3.5: the prose numbers', () => {
    const base = planRefinery();
    // The corners Coldwater’s price crosses.
    const steps = coldwaterSteps();
    expect(steps.cut).toBe(67.5);
    expect(steps.cutTo).toBeCloseTo(84.4, 1);
    expect(steps.switchAt).toBe(68.5);
    expect(cokerBottleneckEnd()).toBe(38);
    // Why that mix: Pinyon’s kerosene goes straight to jet; the coker and hydrotreater are full; fuel oil at its limit.
    const rb = distill(crude('pinyon')).kerosene;
    expect(rb.sulfur).toBeCloseTo(0.05, 3);
    expect(base.flows.kj_pinyon).toBeCloseTo(rb.volume * base.crude.pinyon, 4);
    expect(base.flows.kd_pinyon).toBeLessThan(1e-6);
    expect(base.fuelOilSulfur).toBeCloseTo(FUEL_OIL_SULFUR, 4);
    // The fixed 75% conversion, against Lesson 3.2’s best.
    expect(planRefinery({ fccConversion: 0.75 }).margin).toBeCloseTo(base.margin, 6);
    const gain = planRefinery({ fccConversion: bestConversion().X }).margin - base.margin;
    expect(Math.round(gain / 1000) * 1000).toBe(104000);
    // A crude’s value depends on the refinery.
    const nfBase = crudeBreakeven('northfield');
    const cwBase = crudeBreakeven('coldwater');
    expect(nfBase).toBeCloseTo(69.77, 2);
    const nfDht = crudeBreakeven('northfield', { config: expandedConfig('dht', DHT_EXAMPLE) });
    expect(nfDht).toBeCloseTo(71.65, 2);
    expect(nfDht).toBeLessThan(CRUDE_PRICE.northfield);
    const coker = expandedConfig('coker', EXPANSION);
    expect(planRefinery({ config: coker }).crude.coldwater).toBeCloseTo(120.4, 1);
    expect(crudeBreakeven('northfield', { config: coker })).toBeCloseTo(69.1, 2);
    const cwCoker = crudeBreakeven('coldwater', { config: coker });
    expect(cwCoker).toBeCloseTo(cwBase, 2);
    expect(cwCoker).toBeCloseTo(68.7, 2);
    // Just above that value the plan has switched to Northfield and leaves most of the coker idle.
    const above = planRefinery({ config: coker, crudePrice: { coldwater: cwCoker + 0.1 } });
    expect(above.crude.northfield).toBeGreaterThan(CORRAN.capacity.cdu / 2);
    expect(above.unitFeed.coker).toBeLessThan(0.5 * coker.capacity.coker);
  });

  // -------------------------------------------------------------------------
  // Pass 2: the redesigned challenges and the new readouts.

  it('3.1: the value readout prices the swing cut', () => {
    const rb: TowerState = { ...TOWER_DEFAULTS, crude: 'pinyon' };
    const up: TowerState = { ...rb, kd: rb.kd + 5 };
    expect(jetRate(up) - jetRate(rb)).toBeCloseTo(1.575, 3);
    expect(cutValue(rb) - cutValue(up)).toBeCloseTo(6300, 0);
    expect(CUT_PRICE.diesel - CUT_PRICE.kerosene).toBe(4);
    expect(CUT_PRICE.kerosene - CUT_PRICE.naphtha).toBe(34);
    expect(CUT_PRICE.diesel - CUT_PRICE.residue).toBe(44);
    expect(cutValue(rb) / 1e6).toBeCloseTo(11.7615, 4);
  });

  it('3.1: challenge a — the airline’s jet from the cheap side, diesel to its limit', () => {
    expect(AIRLINE_BEST).toMatchObject({ crude: 'pinyon', nk: 150, kd: 260, dg: 360 });
    expect(jetRate(AIRLINE_BEST)).toBeCloseTo(30.34, 2);
    expect(AIRLINE_BEST.value / 1e6).toBeCloseTo(11.9365, 4);
    // The default state is unsolved; the intended answer solves.
    expect(airlineSolved(TOWER_DEFAULTS)).toBe(false);
    expect(airlineSolved({ crude: 'pinyon', nk: 150, kd: 260, dg: 360 })).toBe(true);
    // Near misses: jet taken from diesel instead of naphtha, diesel short of its limit, too little jet, out of limits, another crude.
    const miss: TowerState[] = [
      { crude: 'pinyon', nk: 155, kd: 265, dg: 360 },
      { crude: 'pinyon', nk: 150, kd: 265, dg: 360 },
      { crude: 'pinyon', nk: 150, kd: 260, dg: 355 },
      { crude: 'pinyon', nk: 150, kd: 255, dg: 360 },
      { crude: 'pinyon', nk: 145, kd: 255, dg: 360 },
      { crude: 'pinyon', nk: 150, kd: 260, dg: 365 },
      { crude: 'seaboard', nk: 150, kd: 260, dg: 360 },
    ];
    for (const m of miss) expect(airlineSolved(m)).toBe(false);
    expect(jetRate({ crude: 'pinyon', nk: 150, kd: 255, dg: 360 })).toBeLessThan(AIRLINE_JET);
    // The readout (millions to three decimals) tells the answer from its nearest rival.
    const shown = (st: TowerState) => fmt(cutValue(st) / 1e6, 3);
    expect(shown(AIRLINE_BEST)).toBe('11.936');
    expect(shown({ crude: 'pinyon', nk: 150, kd: 265, dg: 360 })).toBe('11.930');
    // Kerosene and diesel together: 55.5 kb/d at the standard cuts, 60.5 at the answer.
    const both = (st: TowerState) => {
      const d = distill(crude(st.crude), { naphthaKero: st.nk, keroDiesel: st.kd, dieselGasoil: st.dg, vacuumCut: DEFAULT_CUTS.vacuumCut });
      return (d.kerosene.volume + d.diesel.volume) * CORRAN.capacity.cdu;
    };
    expect(both(TOWER_DEFAULTS)).toBeCloseTo(55.5, 1);
    expect(both(AIRLINE_BEST)).toBeCloseTo(60.5, 1);
  });

  it('3.2: challenge a — Coldwater’s best riser, to the cent the readout shows', () => {
    expect(CHALLENGE_FEED).toBe('coldwater');
    expect(bestTemperature('coldwater')).toBe(521);
    // Default (Northfield at 530 °C) is unsolved; 520 and 521 °C both show $7.90; 519 and 522 °C show less.
    expect(bestTempSolved('northfield', 530, 96, 88)).toBe(false);
    expect(bestTempSolved('coldwater', 530, 96, 88)).toBe(false);
    expect(bestTempSolved('coldwater', 521, 96, 88)).toBe(true);
    expect(bestTempSolved('coldwater', 520, 96, 88)).toBe(true);
    expect(bestTempSolved('coldwater', 519, 96, 88)).toBe(false);
    expect(bestTempSolved('coldwater', 522, 96, 88)).toBe(false);
    expect(bestTempSolved('northfield', 516, 96, 88)).toBe(false);
    expect(bestTempSolved('coldwater', 521, 96, 90)).toBe(false);
    expect(marginAt('coldwater', 520).toFixed(2)).toBe('7.90');
    expect(marginAt('coldwater', 522).toFixed(2)).toBe('7.89');
    // Every feed's best riser lands within a point of the curve's 66% peak (65.4%, 65.6%, 65.7%).
    expect(Math.round(bestConversion().X * 100)).toBe(66);
    for (const f of ['pinyon', 'northfield', 'coldwater'] as const) {
      expect(Math.abs(fccConversion(bestTemperature(f), FEED_AROMATICITY[f]) - bestConversion().X)).toBeLessThan(0.005);
    }
  });

  it('3.2: each feed preset sets its own hydrogen content', () => {
    expect(HEAVY_HC).toEqual({ gasOil: 1.6, residue: 1.5 });
    expect(carbonRejected(HEAVY_HC.gasOil)).toBeCloseTo(0.214, 3);
    expect(round10(hydrogenToUpgrade(HEAVY_HC.gasOil, HEAVY_SG.gasOil))).toBe(1360);
    expect(carbonRejected(HEAVY_HC.residue)).toBeCloseTo(0.286, 3);
    expect(round10(hydrogenToUpgrade(HEAVY_HC.residue, HEAVY_SG.residue))).toBe(1970);
  });

  it('3.3: challenge a can be estimated from the speed-up', () => {
    const speedup = Math.exp((-HDS.activation / 8.314) * (1 / (370 + 273.15) - 1 / (350 + 273.15)));
    // The reader's estimate from the prose's rounded numbers, 0.70 × 2.1 ≈ 1.47, lands within a step of the answer, 1.50.
    expect(speedup).toBeCloseTo(2.1, 1);
    expect(Math.abs(0.7 * 2.1 - 1.5)).toBeLessThan(0.05);
    expect(Math.abs(0.7 * speedup - 1.5)).toBeLessThan(0.07);
    expect(throughputSolved('northfield', 370, 1.5)).toBe(true);
    expect(throughputSolved('northfield', 370, 1.45)).toBe(false);
    expect(throughputSolved('northfield', 350, 1)).toBe(false);
    const feed = { sulfur: distill(crude('northfield')).diesel.sulfur, hardShare: 0.15, baseHydrogen: 150 };
    expect(hdsSulfurOut(feed, 370, 1.55)).toBeGreaterThan(ULSD_LIMIT);
  });

  it('3.3: challenge b — the hydrogen lines cross between 85% and 90%', () => {
    const all = getSlates();
    const at = (share: number) => all.find((x) => x.share === share)!;
    expect(at(85).plan.hydrogen.used).toBeLessThan(at(85).plan.hydrogen.reformer);
    expect(at(90).plan.hydrogen.used).toBeGreaterThan(at(90).plan.hydrogen.reformer);
    // The status shows both to one decimal, and they read the right way round.
    expect(at(85).plan.hydrogen.used.toFixed(1)).toBe('18.0');
    expect(at(85).plan.hydrogen.reformer.toFixed(1)).toBe('18.5');
    expect(at(90).plan.hydrogen.used.toFixed(1)).toBe('18.2');
    expect(at(90).plan.hydrogen.reformer.toFixed(1)).toBe('18.1');
    expect(hydrogenPlantSolved(20)).toBe(false);
    expect(hydrogenPlantSolved(85)).toBe(false);
    expect(hydrogenPlantSolved(90)).toBe(true);
    expect(hydrogenPlantSolved(95)).toBe(false);
  });

  it('3.4: challenge a can’t be passed by nudging the optimizer’s blend', () => {
    const opt = optimizeBlend(SUMMER, 60)!;
    const nudged = { ...opt, reformate: 22.7 };
    expect(handBlendSolved(nudged, false)).toBe(true);
    expect(handBlendSolved(nudged, true)).toBe(false);
    expect(handBlendSolved({ butane: 6, lightNaphtha: 10, reformate: 16, fccGasoline: 28, alkylate: 0 }, false)).toBe(false);
    expect(handBlendSolved({ butane: 2.8, lightNaphtha: 6.5, reformate: 22.7, fccGasoline: 28, alkylate: 0 }, false)).toBe(true);
    expect(handBlendSolved({ butane: 2.8, lightNaphtha: 6.5, reformate: 22.7, fccGasoline: 28, alkylate: 0 }, true)).toBe(false);
  });

  it('3.4: challenge b — predicted from the summer blend and the slope', () => {
    expect(BUTANE_PER_PSI.toFixed(2)).toBe('0.98');
    const summer = butaneAt(SUMMER.rvp);
    expect(summer.toFixed(2)).toBe('2.83');
    const predicted = SUMMER.rvp + (5 - summer) / BUTANE_PER_PSI;
    expect(predicted.toFixed(1)).toBe('11.2');
    expect(((5 - summer) / BUTANE_PER_PSI).toFixed(1)).toBe('2.2');
    // The default limit is unsolved; the prediction solves; its neighbors don't.
    expect(butaneFiveSolved(SUMMER.rvp, 60)).toBe(false);
    expect(butaneFiveSolved(11.2, 60)).toBe(true);
    expect(butaneFiveSolved(11.1, 60)).toBe(false);
    expect(butaneFiveSolved(11.3, 60)).toBe(false);
    expect(butaneFiveSolved(11.2, 61)).toBe(false);
    // The blend bar (one decimal) agrees with the check on both sides.
    expect(butaneAt(11.1).toFixed(1)).toBe('4.9');
    expect(butaneAt(11.2).toFixed(1)).toBe('5.0');
  });

  it('3.5: the other price sliders, each moved alone', () => {
    const base = planRefinery();
    const gas = planRefinery({ productPrice: { gasoline: GASOLINE_EXAMPLE } });
    expect(gas.crude.pinyon).toBeCloseTo(30.9, 1);
    expect(gas.crude.coldwater).toBeCloseTo(119.1, 1);
    expect(gas.products.hsfo).toBeCloseTo(31.0, 1);
    expect(base.products.hsfo).toBeCloseTo(14.2, 1);
    const dsl = planRefinery({ productPrice: { diesel: DIESEL_EXAMPLE } });
    expect(dsl.products.diesel).toBeLessThan(0.05);
    expect(dsl.flows.df_coldwater).toBeGreaterThan(20);
    expect(dsl.flows.ro_coldwater).toBeGreaterThan(base.flows.ro_coldwater + 20);
    expect(dsl.crude.coldwater).toBeCloseTo(144.0, 1);
    expect(distill(crude('coldwater')).diesel.sulfur).toBeLessThan(FUEL_OIL_SULFUR);
    expect(northfieldSteps()).toEqual({ enters: 69.5, only: 65 });
  });

  it('3.5: challenge a’s success, and challenge b’s collapsing shadow price', () => {
    const at685 = planRefinery({ crudePrice: { coldwater: 68.5 } });
    expect(at685.crude.northfield).toBeCloseTo(115.9, 1);
    expect(at685.crude.coldwater).toBeCloseTo(9.2, 1);
    const dht = [0, 1, 2, 3].map((a) => shadowPrices({ config: expandedConfig('dht', a) }).dht / 1000);
    expect(dht[0]).toBeCloseTo(18.06, 2);
    expect(dht[2]).toBeCloseTo(5.05, 2);
    expect(dht[3]).toBeCloseTo(0, 2);
    expect(shadowPrices({ config: expandedConfig('coker', EXPANSION) }).coker / 1000).toBeCloseTo(8.09, 2);
    // The bars rank the hydrotreater first, but the coker wins at 10 kb/d.
    const sp = shadowPrices();
    expect(sp.dht).toBeGreaterThan(sp.coker);
    expect(sp.dht).toBeGreaterThan(sp.cdu);
    expect(Math.round(expansionGain('coker', EXPANSION))).toBe(112549);
    expect(Math.round(expansionGain('cdu', EXPANSION))).toBe(84656);
    expect(Math.round(expansionGain('dht', EXPANSION))).toBe(41167);
    expect(bestExpansionSolved('none', EXPANSION)).toBe(false);
    expect(bestExpansionSolved('dht', EXPANSION)).toBe(false);
    expect(bestExpansionSolved('coker', EXPANSION)).toBe(true);
    expect(bestExpansionSolved('coker', EXPANSION - 1)).toBe(false);
  });
});
