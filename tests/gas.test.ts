// The natural gas course: its engines, its world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import { METHANE, MMBTU_PER_MCF, MMBTU_PER_MWH, PIPELINE_GAS, R_PSIA, SCF_PER_LBMOL, checkSpec, combustionProducts, composition, gasProperties, psig, rankine } from '../src/engines/gas/properties';
import { piston, scfPerCubicFoot, zFactor } from '../src/engines/gas/eos';
import { ROUGHNESS, averagePressure, frictionFactor, inletPressure, outletPressure, pipeFlow, pipeInventory, pressureProfile } from '../src/engines/gas/hydraulics';
import { compress, lineCapacity, stationLine } from '../src/engines/gas/compression';
import { PIPELINE, PIPELINES, stationLineOf } from '../src/model/gas/world';
import { psia } from '../src/engines/gas/properties';
import { MIX_DEFAULTS, PRESETS, ethaneSolved, mixComposition } from '../src/lessons/gas/ch1/L1_1';
import { CHARGE_SCF, HEAT, MAOP_PSIG, PISTON_DEFAULTS, V_MAX, V_MIN, maopSolved, zMinimum } from '../src/lessons/gas/ch1/L1_2';
import { FLOW_DEFAULTS, TARGET_MMCFD, flowAt, northlineSolved, transitHours } from '../src/lessons/gas/ch1/L1_3';
import { FEWEST_FOR_TARGET, LINE_DEFAULTS, STATION_DEFAULTS, TARGET_FLOW, capacityWith, delivers, expansionSolved, fewestStations } from '../src/lessons/gas/ch1/L1_4';
import { BILL_DEFAULTS, CCF_THERM_HHV, HOME_SCF_PER_CF, METER_DEFAULTS, billsEqualSolved, meterHour, thermsPerCcf } from '../src/lessons/gas/ch1/L1_5';

describe('gas chapter 1: properties', () => {
  it('uses 60 °F and 14.73 psia as standard conditions', () => {
    expect(SCF_PER_LBMOL).toBeCloseTo(378.6, 1);
  });

  it('gives methane its textbook heating value, Wobbe index and CO2 factor', () => {
    const m = gasProperties(METHANE);
    expect(m.hhv).toBeCloseTo(1012.3, 1);
    expect(m.sg).toBeCloseTo(0.554, 3);
    expect(m.wobbe).toBeCloseTo(1360, 0);
    expect(m.co2KgPerMMBtu).toBeCloseTo(52.1, 1);
    expect(m.lhv / m.hhv).toBeCloseTo(0.9, 2);
    expect(m.airPerVolume).toBeCloseTo(9.55, 2);
  });

  it('makes the region’s pipeline gas about 1,037 Btu per standard cubic foot, within spec', () => {
    const p = gasProperties(PIPELINE_GAS);
    expect(p.hhv).toBeCloseTo(1037, 0);
    expect(checkSpec(PIPELINE_GAS).ok).toBe(true);
  });

  it('normalizes partial compositions', () => {
    const c = composition({ methane: 2, ethane: 2 });
    expect(c.methane).toBeCloseTo(0.5);
    expect(c.ethane).toBeCloseTo(0.5);
    expect(c.co2).toBe(0);
  });
});

describe('gas chapter 1: real-gas behavior', () => {
  it('is nearly ideal at standard conditions and compressible at pipeline pressures', () => {
    expect(zFactor(14.73, 60)).toBeGreaterThan(0.995);
    const z1000 = zFactor(1000, 60);
    expect(z1000).toBeGreaterThan(0.8);
    expect(z1000).toBeLessThan(0.87);
    // Z has a minimum between 2,000 and 3,000 psia at 60 °F, then rises.
    expect(zFactor(2000, 60)).toBeLessThan(zFactor(1000, 60));
    expect(zFactor(4000, 60)).toBeGreaterThan(zFactor(2500, 60));
  });

  it('lets a piston’s real pressure fall short of the ideal one when compressed', () => {
    const s = piston(1000, 10, 60);
    expect(s.pressure).toBeLessThan(s.idealPressure);
    expect(s.z).toBeCloseTo(s.pressure / s.idealPressure, 9);
    const loose = piston(1000, 1000, 60);
    expect(loose.pressure).toBeCloseTo(14.73, 0);
  });

  it('packs about 80 standard cubic feet into a cubic foot at 1,000 psia', () => {
    expect(scfPerCubicFoot(1000, 60)).toBeGreaterThan(75);
    expect(scfPerCubicFoot(1000, 60)).toBeLessThan(85);
  });
});

describe('gas chapter 1: pipe flow and compression', () => {
  const pipe = { diameterIn: 35, lengthMi: 100, roughnessIn: 0.0007 };

  it('agrees with itself: outlet and inlet pressures invert the flow equation', () => {
    const f = pipeFlow(pipe, 1000, 700);
    expect(outletPressure(pipe, 1000, f.qMMcfd)).toBeCloseTo(700, 2);
    expect(inletPressure(pipe, 700, f.qMMcfd)).toBeCloseTo(1000, 2);
  });

  it('grows throughput with diameter to about the 2.5 power', () => {
    const a = pipeFlow({ ...pipe, diameterIn: 20 }, 1000, 700).qMMcfd;
    const b = pipeFlow({ ...pipe, diameterIn: 40 }, 1000, 700).qMMcfd;
    expect(b / a).toBeGreaterThan(5.4);
    expect(b / a).toBeLessThan(6.2);
  });

  it('uses fully turbulent friction in big gas pipes', () => {
    const f = pipeFlow(pipe, 1000, 700);
    expect(f.re).toBeGreaterThan(1e7);
    expect(f.f).toBeCloseTo(frictionFactor(1e12, 0.0007 / 35), 3);
  });

  it('has the textbook average pressure and a concave pressure profile', () => {
    expect(averagePressure(1000, 1000)).toBeCloseTo(1000, 6);
    const prof = pressureProfile(1000, 600, 10);
    expect(prof[0]).toBe(1000);
    expect(prof[10]).toBeCloseTo(600, 6);
    // Falls faster near the outlet.
    expect(prof[0] - prof[1]).toBeLessThan(prof[9] - prof[10]);
  });

  it('heats gas and burns fuel when it compresses it', () => {
    const c = compress(1000, 700, 1000);
    expect(c.ratio).toBeCloseTo(1000 / 700, 9);
    expect(c.dischargeF).toBeGreaterThan(c.isentropicDischargeF);
    expect(c.hp).toBeGreaterThan(15000);
    expect(c.hp).toBeLessThan(22000);
    expect(c.fuelShare).toBeGreaterThan(0.002);
    expect(c.fuelShare).toBeLessThan(0.005);
  });

  it('gives every pipeline in the world at least its certificated capacity, within 15%', () => {
    for (const p of PIPELINES) {
      const cap = lineCapacity(stationLineOf(p), psia(p.minDeliveryPsig)) / 1000;
      expect(cap).toBeGreaterThanOrEqual(p.capacityBcfd);
      expect(cap).toBeLessThan(p.capacityBcfd * 1.15);
      expect(stationLine(stationLineOf(p), p.capacityBcfd * 1000).feasible).toBe(true);
    }
  });
});

describe('gas 1.1', () => {
  it('starts the Molecule Lab on the region’s pipeline gas', () => {
    expect(gasProperties(mixComposition(MIX_DEFAULTS)).hhv).toBeCloseTo(gasProperties(PIPELINE_GAS).hhv, 6);
  });

  it('quotes the pure gases’ heating values, per pound and per cubic foot', () => {
    expect(Math.round(gasProperties(METHANE).hhv)).toBe(1012);
    expect(Math.round(gasProperties(composition({ ethane: 1 })).hhv)).toBe(1774);
    expect(Math.round(gasProperties(composition({ propane: 1 })).hhv)).toBe(2522);
    expect(Math.round(gasProperties(composition({ butane: 1 })).hhv)).toBe(3270);
    expect(Math.round(gasProperties(METHANE).btuPerLb)).toBe(23891);
    expect(Math.round(gasProperties(composition({ propane: 1 })).btuPerLb)).toBe(21653);
    expect(Math.round(gasProperties(PIPELINE_GAS).hhv)).toBe(1037);
  });

  it('rejects both fields’ raw gas', () => {
    const ridge = mixComposition(PRESETS.ridgeback);
    const sand = mixComposition(PRESETS.sandhill);
    expect(Math.round(gasProperties(ridge).hhv)).toBe(1173);
    expect(Math.round(gasProperties(sand).hhv)).toBe(959);
    expect(sand.nitrogen + sand.co2).toBeCloseTo(0.075, 9);
    expect(checkSpec(ridge).ok).toBe(false);
    expect(checkSpec(sand).ok).toBe(false);
  });

  it('gives methane a Wobbe index of 1,360 and needs 9.55 ft³ of air per ft³', () => {
    const m = gasProperties(METHANE);
    expect(m.sg.toFixed(3)).toBe('0.554');
    expect(Math.round(m.wobbe)).toBe(1360);
    expect(m.airPerVolume.toFixed(2)).toBe('9.55');
    expect(combustionProducts(METHANE)).toEqual({ o2: 2, co2: 1, water: 2 });
  });

  it('solves the challenge at 2.4% ethane and nowhere else', () => {
    const r = PRESETS.ridgeback;
    expect(ethaneSolved({ ...r, ethane: 2.4 })).toBe(true);
    expect(ethaneSolved({ ...r, ethane: 2.3 })).toBe(false);
    expect(ethaneSolved({ ...r, ethane: 2.5 })).toBe(false);
    expect(ethaneSolved({ ...r, ethane: 2.4, propane: 3 })).toBe(false);
    // Success text: propane and butane alone give 1,081.3; each ethane point adds 7.6; without them 12% ethane fits at 1,078.
    expect(gasProperties(mixComposition({ ...r, ethane: 0 })).hhv.toFixed(1)).toBe('1081.3');
    const noLiquids = mixComposition({ ...r, propane: 0, butane: 0 });
    expect(Math.round(gasProperties(noLiquids).hhv)).toBe(1078);
    expect(checkSpec(noLiquids).ok).toBe(true);
  });

  it('quotes net vs gross heat and CO2 per MMBtu', () => {
    const m = gasProperties(METHANE);
    expect(Math.round(m.lhv)).toBe(911);
    expect(Math.round((m.lhv / m.hhv) * 100)).toBe(90);
    expect(m.co2KgPerMMBtu.toFixed(1)).toBe('52.1');
    expect(gasProperties(composition({ butane: 1 })).co2KgPerMMBtu.toFixed(1)).toBe('64.5');
    expect(gasProperties(PIPELINE_GAS).co2KgPerMMBtu.toFixed(1)).toBe('52.9');
    expect(gasProperties(mixComposition(PRESETS.sandhill)).co2KgPerMMBtu.toFixed(1)).toBe('54.4');
  });
});

describe('gas 1.2', () => {
  it('starts the piston at 50 ft³ and 280 psia, and quotes Boyle’s halvings', () => {
    expect(PISTON_DEFAULTS).toEqual({ volume: 50, temp: 60 });
    expect(Math.round(piston(CHARGE_SCF, 50, 60).pressure)).toBe(280);
    expect(Math.round(piston(CHARGE_SCF, 25, 60).pressure)).toBe(534);
    expect(Math.round(piston(CHARGE_SCF, 12.5, 60).pressure)).toBe(988);
    const at12 = piston(CHARGE_SCF, 12, 60);
    expect(Math.round(at12.idealPressure)).toBe(1227);
    expect(Math.round(at12.pressure)).toBe(1024);
    expect(at12.z.toFixed(3)).toBe('0.834');
    expect(zFactor(14.73, 60).toFixed(3)).toBe('0.997');
  });

  it('has exactly one answer to the MAOP challenge on the slider grid: 8.0 ft³ at 60 °F', () => {
    const answers: number[] = [];
    for (let i = V_MIN * 10; i <= V_MAX * 10; i++) if (maopSolved(i / 10, 60)) answers.push(i / 10);
    expect(answers).toEqual([8]);
    expect(maopSolved(8, 61)).toBe(false);
    const s = piston(CHARGE_SCF, 8, 60);
    expect(s.pressure).toBeLessThanOrEqual(psia(MAOP_PSIG));
    expect(Math.round(s.pressure - 14.696)).toBe(1435);
    expect(Math.round(piston(CHARGE_SCF, 7.9, 60).pressure - 14.696)).toBe(1451);
    expect(Math.round((1 / s.z - 1) * 100)).toBe(27);
  });

  it('quotes how much gas fits at pipeline and CNG pressures', () => {
    expect(scfPerCubicFoot(1000, 60).toFixed(1)).toBe('81.1');
    expect(((1000 * SCF_PER_LBMOL) / (R_PSIA * rankine(60))).toFixed(1)).toBe('67.9');
    expect(Math.round(scfPerCubicFoot(psia(3600), 60))).toBe(306);
  });

  it('puts Z’s minimum near 2,300 psia at 60 °F and near 2,000 psia at 0 °F', () => {
    const m60 = zMinimum(60);
    expect(m60.z.toFixed(2)).toBe('0.75');
    expect(Math.round(m60.p / 100) * 100).toBe(2300);
    const m0 = zMinimum(0);
    expect(m0.z.toFixed(2)).toBe('0.63');
    expect(Math.round(m0.p / 100) * 100).toBe(2000);
  });

  it('heats the closed cylinder faster than the ideal law predicts', () => {
    const cold = piston(CHARGE_SCF, HEAT.volume, HEAT.cold);
    const warm = piston(CHARGE_SCF, HEAT.volume, HEAT.warm);
    expect(Math.round(cold.pressure - 14.696)).toBe(1023);
    expect(Math.round(warm.pressure - 14.696)).toBe(1219);
    const ideal = (cold.pressure * rankine(HEAT.warm)) / rankine(HEAT.cold);
    expect(Math.round(ideal - 14.696)).toBe(1147);
    expect(cold.z.toFixed(2)).toBe('0.81');
    expect(warm.z.toFixed(2)).toBe('0.86');
  });
});

describe('gas 1.3', () => {
  const D = FLOW_DEFAULTS;
  const base = flowAt(D.diameter, D.length, D.inlet, D.outlet);

  it('carries about 1,034 MMcf/d through Northline with no stations', () => {
    expect(Math.round(base.qMMcfd)).toBe(1034);
    expect(base.re).toBeGreaterThan(2.5e7);
    expect(base.vIn).toBeCloseTo(14.3, 1);
    expect(base.vOut).toBeCloseTo(29.4, 1);
  });

  it('quotes the roughness, pressure-squared, diameter and length comparisons', () => {
    expect(Math.round(flowAt(35, 240, 1440, 765, 'coated').qMMcfd)).toBe(1115);
    expect(Math.round(flowAt(35, 240, 1440, 765, 'oldSteel').qMMcfd)).toBe(953);
    expect(Math.round(flowAt(35, 240, 400, 100).qMMcfd)).toBe(304);
    expect(Math.round(flowAt(35, 240, 1000, 700).qMMcfd)).toBe(588);
    expect(Math.round(flowAt(35, 240, 1300, 1000).qMMcfd)).toBe(701);
    const low = flowAt(35, 240, 1440, 100);
    expect(Math.round((low.qMMcfd / base.qMMcfd - 1) * 100)).toBe(17);
    expect(Math.round(low.vOut)).toBe(263);
    const small = flowAt(18, 240, 1440, 765).qMMcfd;
    const big = flowAt(36, 240, 1440, 765).qMMcfd;
    expect(Math.round(small)).toBe(184);
    expect(Math.round(big)).toBe(1113);
    expect(big / small).toBeCloseTo(6.0, 1);
    expect(Math.round((flowAt(35, 120, 1440, 765).qMMcfd / base.qMMcfd - 1) * 100)).toBe(42);
  });

  it('quotes the profile, transit time and linepack', () => {
    const mid = Math.sqrt((psia(1440) ** 2 + psia(765) ** 2) / 2) - psia(0);
    expect(Math.round(mid)).toBe(1152);
    expect(Math.round(transitHours(35, 240, 1440, 765))).toBe(19);
    const pack = pipeInventory({ diameterIn: 35, lengthMi: 240, roughnessIn: ROUGHNESS.newSteel }, psia(1440), psia(765)) / 1e6;
    expect(Math.round(pack)).toBe(809);
  });

  it('solves the challenge at 44 inches and nowhere else', () => {
    expect(TARGET_MMCFD).toBe(1800);
    expect(northlineSolved(D)).toBe(false);
    expect(northlineSolved({ ...D, diameter: 43 })).toBe(false);
    expect(northlineSolved({ ...D, diameter: 44 })).toBe(true);
    expect(northlineSolved({ ...D, diameter: 45 })).toBe(false);
    expect(northlineSolved({ ...D, diameter: 44, rough: 'coated' })).toBe(false);
    expect(Math.round(flowAt(44, 240, 1440, 765).qMMcfd)).toBe(1871);
    expect(Math.round(flowAt(43, 240, 1440, 765).qMMcfd)).toBe(1763);
  });
});

describe('gas 1.4', () => {
  const NL = PIPELINE['calder-metro'];
  const line = (n: number) => ({ ...stationLineOf(NL), stations: n });

  it('quotes the starting station: 1,800 MMcf/d from 765 to 1,440 psig', () => {
    const c = compress(STATION_DEFAULTS.flow, psia(765), psia(1440));
    expect(c.ratio).toBeCloseTo(1.87, 2);
    expect(Math.round(c.hp / 1000) * 1000).toBe(59000);
    expect(Math.round(c.mw)).toBe(44);
    expect(c.fuelMMcfd).toBeCloseTo(10.9, 1);
    expect(c.fuelShare * 100).toBeCloseTo(0.61, 2);
    expect(Math.round((c.fuelMMBtuPerDay * 3) / 1000) * 1000).toBe(34000);
    expect(Math.round(c.dischargeF)).toBe(155);
    expect(Math.round(c.isentropicDischargeF)).toBe(136);
    // Doubling the flow doubles power and fuel; the share stays put.
    const d = compress(3600, psia(765), psia(1440));
    expect(Math.round(d.hp)).toBe(117968);
    expect(d.fuelMMcfd).toBeCloseTo(21.8, 1);
    expect(d.fuelShare).toBeCloseTo(c.fuelShare, 9);
  });

  it('shows that the ratio, not the difference, sets the work', () => {
    const a = compress(1800, psia(300), psia(615));
    const b = compress(1800, psia(700), psia(1415));
    expect(Math.round(a.hp)).toBe(71041);
    expect(Math.round(b.hp)).toBe(66807);
    expect(Math.round(compress(1800, psia(300), psia(1440)).dischargeF)).toBe(318);
  });

  it('quotes Northline’s capacity for one to six stations, and its fuel at 1.8 Bcf/d', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => Math.round(capacityWith(n)))).toEqual([1034, 1469, 1802, 2083, 2331, 2555]);
    const three = stationLine(line(3), 1800);
    expect(Math.round(psig(three.deliveryPsia))).toBe(767);
    expect(Math.round(three.totalHp)).toBe(176334);
    expect(Math.round(three.totalHp * 0.0007457)).toBe(131);
    expect(three.fuelMMcfd).toBeCloseTo(32.6, 1);
    expect(three.fuelShare * 100).toBeCloseTo(1.81, 2);
    expect(three.fuelShare * 3 * 100).toBeCloseTo(5.4, 1);
    expect(stationLine(line(4), 1800).fuelShare * 100).toBeCloseTo(1.63, 2);
    expect(stationLine(line(6), 1800).fuelShare * 100).toBeCloseTo(1.54, 2);
  });

  it('needs four stations for 2.0 Bcf/d, and the challenge is solved only there', () => {
    expect(fewestStations(TARGET_FLOW)).toBe(4);
    expect(FEWEST_FOR_TARGET).toBe(4);
    expect(delivers(3, 2000)).toBe(false);
    expect(expansionSolved(LINE_DEFAULTS)).toBe(false);
    expect(expansionSolved({ stations: 4, flow: 2000 })).toBe(true);
    expect(expansionSolved({ stations: 5, flow: 2000 })).toBe(false);
    expect(expansionSolved({ stations: 4, flow: 1950 })).toBe(false);
    const four = stationLine(line(4), 2000);
    expect(Math.round(four.totalHp)).toBe(229272);
    expect(four.fuelShare * 100).toBeCloseTo(2.12, 2);
  });
});

describe('gas 1.5', () => {
  const def = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv);
  const ideal = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv, true);

  it('starts the meter at Northline’s minimum delivery pressure, 50 °F and 1,037 Btu/scf', () => {
    expect(METER_DEFAULTS).toEqual({ pressure: 765, temp: 50, hhv: 1037, ideal: false });
  });

  it('turns an hour’s 1,000,000 actual cubic feet into 62.9 MMcf and 65,213 MMBtu', () => {
    expect(def.scfPerCf).toBeCloseTo(62.9, 1);
    expect(def.scf / 1e6).toBeCloseTo(62.9, 1);
    expect(Math.round(def.mmbtu)).toBe(65213);
    expect(Math.round(def.mmbtu * 3)).toBe(195639);
    // About five-sixths of an hour of Northline at 1.8 Bcf/d (75 MMcf).
    expect(def.scf / 1e6 / 75).toBeCloseTo(5 / 6, 1);
  });

  it('more than doubles at the 1,440 psig MAOP and carries 17% more energy at 30 °F than at 80 °F', () => {
    expect(meterHour(1440, 50, 1037).scf / 1e6).toBeCloseTo(130.7, 1);
    const cold = meterHour(765, 30, 1037).mmbtu;
    const warm = meterHour(765, 80, 1037).mmbtu;
    expect(Math.round((cold / warm - 1) * 100)).toBe(17);
  });

  it('under-counts by 14% ($27,735 an hour at $3) if the flow computer ignores Z', () => {
    expect(Math.round(ideal.mmbtu)).toBe(55968);
    expect(Math.round((1 - ideal.mmbtu / def.mmbtu) * 100)).toBe(14);
    expect(Math.round((def.mmbtu - ideal.mmbtu) * 3)).toBe(27735);
  });

  it('quotes the unit conversions in the prose', () => {
    expect(3 * MMBTU_PER_MCF).toBeCloseTo(3.11, 2);
    expect(Math.round((MMBTU_PER_MWH / 6.4) * 100)).toBe(53);
    expect(Math.round(1.8e6 * MMBTU_PER_MCF)).toBe(1866600);
    expect((1.8e6 * MMBTU_PER_MCF * 3) / 1e6).toBeCloseTo(5.6, 1);
  });

  it('bills a 120 CCF month at 126.6 therms', () => {
    expect(HOME_SCF_PER_CF).toBeCloseTo(1.017, 3);
    expect(thermsPerCcf(1037)).toBeCloseTo(1.055, 3);
    expect(BILL_DEFAULTS.ccf * thermsPerCcf(BILL_DEFAULTS.hhv)).toBeCloseTo(126.6, 1);
    expect(BILL_DEFAULTS.ccf * thermsPerCcf(BILL_DEFAULTS.hhv) * 1.3).toBeCloseTo(164.6, 2);
  });

  it('makes a CCF one therm at 983 Btu/scf, the challenge’s answer', () => {
    expect(CCF_THERM_HHV).toBe(983);
    expect(billsEqualSolved(983)).toBe(true);
    expect(billsEqualSolved(1037)).toBe(false);
    expect(billsEqualSolved(1000)).toBe(false);
    expect(Math.abs(thermsPerCcf(983) - 1)).toBeLessThan(0.0005);
  });
});
