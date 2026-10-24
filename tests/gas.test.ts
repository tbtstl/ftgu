// The natural gas course: its engines, its world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import { checkSpec, combustionProducts, composition, gasProperties, METHANE, MMBTU_PER_MCF, MMBTU_PER_MWH, PIPELINE_GAS, R_PSIA, rankine, SCF_PER_LBMOL, psig } from '../src/engines/gas/properties';
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
import { DAYS_PER_MONTH, gasFVF, gasInPlace, gasViscosity, pOverZ, pressureFromPz, simulateTank, wellRate } from '../src/engines/gas/reservoir';
import { arpsCum, arpsEur, arpsRate, declineAt, fieldCash, fieldProduction, firstYearDecline, fitArps, noisyHistory, ridgebackMonthly, ridgebackRate, productionByVintage, SANDHILL_WELL, sandhillMonthly, sumBcf, switchTime } from '../src/engines/gas/decline';
import { gallonsPerMcf, ethaneBreakeven, plantValue, mmbtuPerGallon, processGas } from '../src/engines/gas/processing';
import { NGL_PRICES, OPEX_PER_MCF, RAW_WATER, RIDGEBACK_PI, RIDGEBACK_RAW, RIDGEBACK_ROCK, ROYALTY, SANDHILL_PI, SANDHILL_RAW, SANDHILL_ROCK, WELL_COST } from '../src/model/gas/production';
import { BASE_ROCK, CHALLENGE_PRESSURE, explorerRate, fieldNumbers, FIELDS_DEFAULTS, leastPermSolved, permOf, permText, PWF, rateText, ROCK_DEFAULTS } from '../src/lessons/gas/ch2/L2_1';
import { BLOCK_GIP, blockSolved, lineEstimate, runWell, steadyCap, steadySolved, SURVEYS, WELL_DEFAULTS, wellOf } from '../src/lessons/gas/ch2/L2_2';
import { ACTUAL_BCF, bestFit, fitError, FORECAST_DEFAULTS, forecastSolved, HISTORY, SEEN } from '../src/lessons/gas/ch2/L2_3';
import { breakevenPrice, BUDGET_WELLS, FIELD_DEFAULTS, fieldSolved, promise, schedule, TARGET } from '../src/lessons/gas/ch2/L2_4';
import { breakevenSolved, CHALLENGE_GAS, dayValue, DEEP, ethaneLeftSolved, lowestPayingCent, PLANT_DEFAULTS, recoveryGain, runPlant, STANDARD, VALUE_DEFAULTS } from '../src/lessons/gas/ch2/L2_5';

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

describe('gas chapter 2: reservoirs, wells and decline', () => {
  it('holds about 30 Bcf per square mile at Sandhill’s discovery and over 100 at Ridgeback', () => {
    expect(gasInPlace(SANDHILL_ROCK, SANDHILL_PI) / 1e9).toBeCloseTo(29.8, 1);
    expect(gasInPlace(RIDGEBACK_ROCK, RIDGEBACK_PI) / 1e9).toBeGreaterThan(100);
  });

  it('gives gas a viscosity of about 0.011 cp at the surface and more at depth', () => {
    expect(gasViscosity(14.7, 60)).toBeCloseTo(0.011, 3);
    expect(gasViscosity(5500, 200)).toBeGreaterThan(0.02);
  });

  it('lets a vertical well flow a thousand times less from shale than from sandstone', () => {
    const sand = wellRate(SANDHILL_ROCK, SANDHILL_PI, 600);
    const shale = wellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, 1000);
    expect(sand / shale).toBeGreaterThan(500);
  });

  it('inverts P/Z', () => {
    for (const p of [500, 1500, 3800, 5500]) expect(pressureFromPz(pOverZ(p, 160), 160)).toBeCloseTo(p, 3);
  });

  it('depletes a tank along a straight P/Z line', () => {
    const r = simulateTank(SANDHILL_WELL);
    const pzi = pOverZ(SANDHILL_WELL.piPsia, SANDHILL_WELL.rock.tempF);
    for (const m of r.months.slice(0, 100)) expect(m.pz).toBeCloseTo(pzi * (1 - m.cumBcf / r.gipBcf), 0);
    expect(r.plateauMonths).toBeGreaterThan(30);
    expect(r.recovery).toBeGreaterThan(0.8);
  });

  it('matches Arps’ closed forms to numerical integration', () => {
    const a = { qi: 10, di: 0.8, b: 1.2, dMin: 0.06 };
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) s += arpsRate(a, ((i + 0.5) / n) * 20) * (20 / n) * 365.25;
    expect(arpsCum(a, 20)).toBeCloseTo(s, -1);
    expect(declineAt(a, 50)).toBe(0.06);
    expect(arpsRate({ qi: 10, di: 0.5, b: 0 }, 1)).toBeCloseTo(10 * Math.exp(-0.5), 9);
  });

  it('makes the Ridgeback well about 13 Bcf over 30 years, and a two-year fit overstates it', () => {
    const rb = ridgebackMonthly();
    expect(sumBcf(rb)).toBeCloseTo(12.9, 1);
    expect(rb[0]).toBeCloseTo(15, 6);
    const fit = fitArps(noisyHistory(rb.slice(0, 24), 7));
    expect(arpsEur(fit).eurBcf).toBeGreaterThan(sumBcf(rb) * 1.15);
  });

  it('adds field production up from a drilling schedule', () => {
    const type = [10, 5, 2];
    expect(fieldProduction([1, 0, 2], type, 4)).toEqual([10, 5, 22, 10]);
    const cash = fieldCash([1, 0, 0], [10, 5, 2], { wellheadPrice: 3, royalty: 0, opexPerMcf: 0, wellCost: 1e6, discount: 0, mmbtuPerMcf: 1 });
    expect(cash.capex).toBe(1e6);
    expect(cash.cumulative[2]).toBeCloseTo(17 * 1000 * DAYS_PER_MONTH * 3 - 1e6, 3);
  });
});

describe('gas chapter 2: processing', () => {
  const full = { ethane: 0.9, propane: 0.98, butane: 1, co2Removal: 0.8, dehydrate: true };

  it('turns Ridgeback’s raw gas into pipeline gas, with or without its ethane', () => {
    expect(checkSpec(RIDGEBACK_RAW).ok).toBe(false);
    expect(processGas(RIDGEBACK_RAW, 400, RAW_WATER, full).ok).toBe(true);
    expect(processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...full, ethane: 0 }).ok).toBe(true);
    expect(processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...full, dehydrate: false }).ok).toBe(false);
  });

  it('conserves the hydrocarbons it doesn’t burn', () => {
    const r = processGas(RIDGEBACK_RAW, 400, RAW_WATER, full);
    const ethaneGas = r.ngl.ethane / gallonsPerMcf('ethane') / 1000;
    expect(ethaneGas).toBeCloseTo(400 * RIDGEBACK_RAW.ethane * 0.9, 6);
    expect(r.shrink).toBeGreaterThan(0.15);
  });

  it('puts the ethane breakeven between $0.25 and $0.30 a gallon at the reference prices', () => {
    const be = ethaneBreakeven(RIDGEBACK_RAW, NGL_PRICES);
    expect(be).toBeGreaterThan(0.25);
    expect(be).toBeLessThan(0.3);
    const keep = plantValue(processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...full, ethane: 0 }), NGL_PRICES).total;
    const take = plantValue(processGas(RIDGEBACK_RAW, 400, RAW_WATER, full), NGL_PRICES).total;
    expect(keep).toBeGreaterThan(take);
  });
});

describe('gas 2.1', () => {
  it('starts the Reservoir Explorer at 26.9 Bcf a square mile, 184 scf per ft³ of pore space and 4.0 MMcf/d', () => {
    expect(ROCK_DEFAULTS).toEqual({ porosity: 0.15, logK: 0, pressure: 3000 });
    const rock = { ...BASE_ROCK, porosity: ROCK_DEFAULTS.porosity, permMd: permOf(ROCK_DEFAULTS.logK) };
    expect(gasInPlace(rock, 3000) / 1e9).toBeCloseTo(26.9, 1);
    expect(Math.round(1 / gasFVF(3000, BASE_ROCK.tempF))).toBe(184);
    expect(explorerRate(ROCK_DEFAULTS)).toBeCloseTo(4.0, 1);
    expect(Math.round(gasInPlace(rock, 3000) / 1e9 / PIPELINE['calder-metro'].capacityBcfd)).toBe(15);
  });

  it('holds less than twice as much gas at twice the pressure, because Z rises', () => {
    const rock = { ...BASE_ROCK, porosity: 0.15, permMd: 1 };
    expect(gasInPlace(rock, 6000) / 1e9).toBeCloseTo(46.8, 1);
    expect(zFactor(3000, 180).toFixed(2)).toBe('0.90');
    expect(zFactor(6000, 180).toFixed(2)).toBe('1.03');
  });

  it('solves the challenge at 0.25 md (rate 1.01 MMcf/d) and nowhere else on the grid', () => {
    const answers: number[] = [];
    for (let i = -40; i <= 30; i++) if (leastPermSolved({ ...ROCK_DEFAULTS, logK: i / 10 })) answers.push(i / 10);
    expect(answers).toEqual([-0.6]);
    expect(permText(permOf(-0.6))).toBe('0.25 md');
    expect(explorerRate({ ...ROCK_DEFAULTS, logK: -0.6 })).toBeGreaterThanOrEqual(1);
    expect(explorerRate({ ...ROCK_DEFAULTS, logK: -0.7 })).toBeLessThan(1);
    // Porosity doesn't matter; pressure does.
    expect(leastPermSolved({ porosity: 0.3, logK: -0.6, pressure: CHALLENGE_PRESSURE })).toBe(true);
    expect(leastPermSolved({ porosity: 0.15, logK: -0.6, pressure: 3100 })).toBe(false);
    expect(Math.round(permOf(-0.6) / RIDGEBACK_ROCK.permMd / 10) * 10).toBe(840);
  });

  it('compares the two fields: 29.8, 12.0 and 106 Bcf; 15.8 MMcf/d, 2.4 MMcf/d and 17 Mcf/d', () => {
    const sd = fieldNumbers('sandDisc', PWF);
    const sn = fieldNumbers('sandNow', PWF);
    const rb = fieldNumbers('ridge', PWF);
    expect(FIELDS_DEFAULTS).toEqual({ field: 'sandDisc', pwf: 600 });
    expect(sd.gip).toBeCloseTo(29.8, 1);
    expect(sn.gip).toBeCloseTo(12.0, 1);
    expect(Math.round(rb.gip)).toBe(106);
    expect((rb.gip / sd.gip).toFixed(1)).toBe('3.6');
    expect(rateText(sd.rate)).toBe('15.8 MMcf/d');
    expect(rateText(sn.rate)).toBe('2.4 MMcf/d');
    expect(rateText(rb.rate)).toBe('17 Mcf/d');
    expect(Math.round(sd.rate / rb.rate / 10) * 10).toBe(950);
    expect(Math.round((rb.gip * 1e9) / (rb.rate * 1e6) / 365.25 / 1000) * 1000).toBe(17000);
    expect((sd.gip - sn.gip).toFixed(1)).toBe('17.8');
    expect(gasViscosity((SANDHILL_PI + PWF) / 2, 160).toFixed(3)).toBe('0.017');
  });
});

describe('gas 2.2', () => {
  const base = runWell(WELL_DEFAULTS);

  it('starts on Lesson 2.1’s Sandhill rock: 29.8 Bcf, 15.8 MMcf/d of potential held to 8', () => {
    expect(WELL_DEFAULTS).toEqual({ k: 3, area: 640, pwf: 600, cap: 8 });
    expect(base.gipBcf).toBeCloseTo(29.8, 1);
    expect(wellRate(wellOf(WELL_DEFAULTS).rock, SANDHILL_PI, 600)).toBeCloseTo(15.8, 1);
  });

  it('quotes the plateau, the decline and the 30-year recovery', () => {
    expect(base.plateauMonths).toBe(34);
    expect(base.months[base.plateauMonths - 1].pressure).toBeGreaterThan(2640);
    expect(base.months[base.plateauMonths - 1].pressure).toBeLessThan(2660);
    expect(base.months[59].rate).toBeCloseTo(4.8, 1);
    expect(base.months[119].rate).toBeCloseTo(2.0, 1);
    expect(base.months[359].rate).toBeCloseTo(0.23, 2);
    expect(base.eurBcf).toBeCloseTo(24.2, 1);
    expect(Math.round(base.recovery * 100)).toBe(81);
    const pzi = pOverZ(SANDHILL_PI, SANDHILL_ROCK.tempF);
    expect(Math.round(pzi)).toBe(4187);
    expect(Math.round(pzi / base.gipBcf)).toBe(141);
  });

  it('recovers more at a lower flowing pressure, and spreads the same gas over time with the cap', () => {
    expect(runWell({ ...WELL_DEFAULTS, pwf: 200 }).recovery * 100).toBeCloseTo(86.3, 1);
    expect(runWell({ ...WELL_DEFAULTS, pwf: 1000 }).recovery * 100).toBeCloseTo(72.6, 1);
    const c12 = runWell({ ...WELL_DEFAULTS, cap: 12 });
    const c4 = runWell({ ...WELL_DEFAULTS, cap: 4 });
    expect(c12.plateauMonths).toBe(10);
    expect(c4.plateauMonths).toBe(119);
    expect(c12.eurBcf).toBeCloseTo(24.25, 1);
    expect(c4.eurBcf).toBeCloseTo(23.8, 1);
  });

  it('quotes permeability and spacing', () => {
    const k30 = runWell({ ...WELL_DEFAULTS, k: 30 });
    expect(k30.recovery * 100).toBeCloseTo(84.7, 1);
    expect(Math.round(k30.lifeMonths / 12)).toBe(13);
    expect(Math.round(runWell({ ...WELL_DEFAULTS, k: 0.3 }).recovery * 100)).toBe(36);
    const small = runWell({ ...WELL_DEFAULTS, area: 160 });
    expect(small.gipBcf).toBeCloseTo(7.4, 1);
    expect(Math.round(small.recovery * 100)).toBe(83);
    expect(Math.round(small.lifeMonths / 12)).toBe(10);
  });

  it('solves the steady-rate challenge at 6 MMcf/d and nowhere else', () => {
    expect(steadyCap()).toBe(6);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6 })).toBe(true);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 5.5 })).toBe(false);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6.5 })).toBe(false);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6, pwf: 500 })).toBe(false);
  });

  it('hides a 20.5 Bcf fault block that one survey underestimates and eight nearly pin down', () => {
    expect(SURVEYS).toHaveLength(8);
    expect(BLOCK_GIP).toBeCloseTo(20.47, 2);
    expect(lineEstimate(1)).toBeCloseTo(17.1, 1);
    expect(lineEstimate(8)).toBeCloseTo(20.2, 1);
    expect(blockSolved(30)).toBe(false);
    expect(blockSolved(20.5)).toBe(true);
    expect(blockSolved(lineEstimate(1))).toBe(false);
    expect(blockSolved(lineEstimate(8))).toBe(true);
    expect(BLOCK_GIP * (1 - pOverZ(700, SANDHILL_ROCK.tempF) / pOverZ(SANDHILL_PI, SANDHILL_ROCK.tempF))).toBeCloseTo(16.8, 1);
  });
});

describe('gas 2.3', () => {
  it('quotes the exponential and hyperbolic curves of the first demonstration', () => {
    const exp = { qi: 15, di: 1.2, b: 0 };
    expect(Math.round(firstYearDecline(exp) * 100)).toBe(70);
    expect(arpsEur(exp).years).toBeCloseTo(4.2, 1);
    expect(arpsEur(exp).eurBcf).toBeCloseTo(4.5, 1);
    expect(arpsEur({ qi: 15, di: 1.2, b: 0.5 }).years).toBeCloseTo(18.7, 1);
    expect(arpsEur({ qi: 15, di: 1.2, b: 0.5 }).eurBcf).toBeCloseTo(8.4, 1);
    expect(arpsEur({ qi: 15, di: 1.2, b: 1 }).eurBcf).toBeCloseTo(16.5, 1);
    expect(arpsEur({ qi: 15, di: 1.2, b: 2 }).eurBcf).toBeCloseTo(34.4, 1);
    expect(arpsCum({ qi: 15, di: 1.2, b: 2 }, 60) / 1000).toBeCloseTo(50.4, 1);
    expect(arpsCum({ qi: 15, di: 1.2, b: 2 }, 100) / 1000).toBeCloseTo(66.3, 1);
    const t = { qi: 15, di: 1.2, b: 2, dMin: 0.08 };
    expect(switchTime(t)).toBeCloseTo(5.8, 1);
    expect(arpsEur(t).eurBcf).toBeCloseTo(28.2, 1);
    expect(fitArps(sandhillMonthly().slice(34, 106)).b).toBeCloseTo(0.5, 6);
  });

  it('quotes the Ridgeback well’s first year', () => {
    expect(ridgebackRate(12)).toBeCloseTo(6.1, 1);
    expect(Math.round((1 - ridgebackRate(12) / 15) * 100)).toBe(59);
  });

  it('forecasts from two years of history: the best fit is about 32% high', () => {
    expect(SEEN).toBe(24);
    expect(HISTORY.length).toBe(360);
    expect(ACTUAL_BCF).toBeCloseTo(12.5, 1);
    const best = bestFit();
    expect(best).toEqual({ qi: 13.3, di: 1.26, b: 1.15, dMin: 0 });
    expect(arpsEur(best).eurBcf).toBeCloseTo(16.5, 1);
    expect(Math.round((arpsEur(best).eurBcf / ACTUAL_BCF - 1) * 100)).toBe(32);
    expect(forecastSolved(best)).toBe(false);
    // The starting curve is the best exponential: it fits nearly as well and forecasts 7.3 Bcf.
    expect(FORECAST_DEFAULTS.b).toBe(0);
    expect(arpsEur(FORECAST_DEFAULTS).eurBcf).toBeCloseTo(7.3, 1);
    expect(forecastSolved(FORECAST_DEFAULTS)).toBe(false);
    const capped = [0.5, 0.8].map((bMax) => arpsEur(fitArps(HISTORY.slice(0, SEEN), { bMax })).eurBcf);
    expect(capped[0]).toBeCloseTo(10.2, 1);
    expect(capped[1]).toBeCloseTo(13.0, 1);
  });

  it('is solved by lowering b or adding a steep terminal decline', () => {
    const h = HISTORY.slice(0, SEEN);
    const b08 = fitArps(h, { bMax: 0.8 });
    expect(forecastSolved(b08)).toBe(true);
    expect(forecastSolved({ ...bestFit(), dMin: 0.15 })).toBe(true);
    expect(forecastSolved({ ...bestFit(), dMin: 0.12 })).toBe(false);
    // A curve far off the history doesn't count even if its total is right.
    expect(fitError({ qi: 5, di: 0.05, b: 0 }, h)).toBeGreaterThan(fitError(bestFit(), h) + 0.02);
  });
});

describe('gas 2.4', () => {
  const TYPE = ridgebackMonthly(360);
  const econ = (price: number, cost = WELL_COST) => ({ wellheadPrice: price, royalty: ROYALTY, opexPerMcf: OPEX_PER_MCF, wellCost: cost, discount: 0.1, mmbtuPerMcf: MMBTU_PER_MCF });
  const def = [FIELD_DEFAULTS.y1, FIELD_DEFAULTS.y2, FIELD_DEFAULTS.y3, FIELD_DEFAULTS.y4, FIELD_DEFAULTS.y5];

  it('spreads each year’s wells evenly through its twelve months', () => {
    expect(schedule([30])).toEqual([2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3]);
    expect(schedule([41, 24]).reduce((a, b) => a + b, 0)).toBe(65);
  });

  it('quotes the type well: 15 MMcf/d, 6.3 a year later, 12.9 Bcf, 28% in the first year', () => {
    expect(TYPE[0]).toBeCloseTo(15, 9);
    expect(TYPE[11]).toBeCloseTo(6.26, 2);
    expect(sumBcf(TYPE)).toBeCloseTo(12.9, 1);
    expect(Math.round((sumBcf(TYPE.slice(0, 12)) / sumBcf(TYPE)) * 100)).toBe(28);
  });

  it('starts at 30 wells a year: too slow, then too much', () => {
    expect(TARGET).toBe(400);
    const p = fieldProduction(schedule(def), TYPE, 96);
    expect(Math.round(p[11])).toBe(295);
    const pr = promise(def);
    expect(pr.short).toBe(7);
    expect(pr.lowMonth).toBe(12); // the first seven months of the promise
    expect(Math.round(pr.low)).toBe(302);
    expect(Math.round(p[59])).toBe(722);
    const v = productionByVintage(schedule(def), TYPE, 96);
    expect(Math.round(v[0][59])).toBe(67);
    expect((v[0][59] / 30).toFixed(1)).toBe('2.2');
    expect(Math.round(v[4][59])).toBe(295);
    expect(Math.round((1 - p[71] / p[59]) * 100)).toBe(34);
  });

  it('shows the treadmill: 100 wells at once peak at 977 and fall to 508 and 223', () => {
    const b = fieldProduction(schedule([100, 0, 0, 0, 0]), TYPE, 96);
    expect(Math.round(Math.max(...b))).toBe(977);
    expect(Math.round(b[23])).toBe(508);
    expect(Math.round(b[59])).toBe(223);
    const perWell = (sumBcf(TYPE) * 1000) / 365.25;
    expect(perWell.toFixed(1)).toBe('35.4');
    expect(Math.round(400 / perWell)).toBe(11);
  });

  it('has a budget of 105 wells, and the challenge is solved by the 104-well plans', () => {
    expect(BUDGET_WELLS).toBe(105);
    expect(fieldSolved(FIELD_DEFAULTS)).toBe(false);
    expect(fieldSolved({ y1: 41, y2: 24, y3: 14, y4: 13, y5: 12 })).toBe(true);
    expect(fieldSolved({ y1: 42, y2: 24, y3: 12, y4: 14, y5: 12 })).toBe(true);
    expect(fieldSolved({ y1: 41, y2: 24, y3: 14, y4: 13, y5: 11 })).toBe(false);
    expect(fieldSolved({ y1: 60, y2: 30, y3: 14, y4: 13, y5: 12 })).toBe(false); // holds, but over budget
    expect(promise([60, 30, 14, 13, 12]).holds).toBe(true);
  });

  it('finds 104 wells the exact minimum, with 41 to 48 first-year wells in every plan within budget', () => {
    // Cohorts add up, so production can be tabulated per year and the search done exhaustively.
    const cohort = [0, 1, 2, 3, 4].map((y) =>
      Array.from({ length: 81 }, (_, n) => {
        const ys = [0, 0, 0, 0, 0];
        ys[y] = n;
        return fieldProduction(schedule(ys), TYPE, 60);
      }),
    );
    const ok = (ys: number[], from: number, to: number) => {
      for (let m = from; m < to; m++) {
        let p = 0;
        for (let y = 0; y < ys.length; y++) p += cohort[y][ys[y]][m];
        if (p < 400 - 1e-9) return false;
      }
      return true;
    };
    let best = Infinity;
    let lo = 99;
    let hi = 0;
    for (let a = 0; a <= 80; a++)
      for (let b = 0; a + b <= 105 && b <= 80; b++) {
        if (!ok([a, b], 12, 24)) continue;
        for (let c = 0; a + b + c <= 105 && c <= 80; c++) {
          if (!ok([a, b, c], 24, 36)) continue;
          for (let d = 0; a + b + c + d <= 105 && d <= 80; d++) {
            if (!ok([a, b, c, d], 36, 48)) continue;
            for (let e = 0; a + b + c + d + e <= 105 && e <= 80; e++) {
              if (!ok([a, b, c, d, e], 48, 60)) continue;
              best = Math.min(best, a + b + c + d + e);
              lo = Math.min(lo, a);
              hi = Math.max(hi, a);
              break;
            }
          }
        }
      }
    expect(best).toBe(104);
    expect([lo, hi]).toEqual([41, 48]);
  });

  it('quotes one well’s economics: $1.68 net per Mcf, $5.99 million in year one, paid back in 24 months, NPV $6.23 million', () => {
    expect((2.75 * MMBTU_PER_MCF * (1 - ROYALTY) - OPEX_PER_MCF).toFixed(2)).toBe('1.68');
    const one = fieldCash([1], TYPE, econ(2.75));
    expect(((one.cumulative[11] + WELL_COST) / 1e6).toFixed(2)).toBe('5.99');
    expect(one.payoutMonth! + 1).toBe(24);
    expect((one.npv / 1e6).toFixed(2)).toBe('6.23');
  });

  it('quotes the starting plan’s and the lean plan’s cash, and a $1.92 breakeven for every plan', () => {
    const s = schedule(def);
    const c = fieldCash(s, fieldProduction(s, TYPE, 420), econ(2.75));
    expect(Math.round(-c.maxExposure / 1e6)).toBe(196);
    expect(((c.payoutMonth! + 1) / 12).toFixed(1)).toBe('4.4');
    expect(Math.round(c.npv / 1e6)).toBe(746);
    const l = schedule([41, 24, 14, 13, 12]);
    const lc = fieldCash(l, fieldProduction(l, TYPE, 420), econ(2.75));
    expect(Math.round(lc.capex / 1e6)).toBe(936);
    expect(Math.round(-lc.maxExposure / 1e6)).toBe(217);
    expect(Math.round(lc.npv / 1e6)).toBe(550);
    expect(breakevenPrice(def, WELL_COST).toFixed(2)).toBe('1.92');
    expect(breakevenPrice([41, 24, 14, 13, 12], WELL_COST)).toBeCloseTo(breakevenPrice(def, WELL_COST), 9);
    expect(breakevenPrice(def, 12e6)).toBeGreaterThan(breakevenPrice(def, 6e6));
  });
});

describe('gas 2.5', () => {
  const full = processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...STANDARD, ethane: DEEP });
  const reject = processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...STANDARD, ethane: 0 });

  it('starts with the plant off: raw gas fails on heating value, Wobbe index and water', () => {
    const r = runPlant(PLANT_DEFAULTS);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(['hhv', 'wobbe', 'water']);
    expect(Math.round(gasProperties(RIDGEBACK_RAW).hhv)).toBe(1173);
    expect(Math.round(gasProperties(RIDGEBACK_RAW).wobbe)).toBe(1410);
    expect((RAW_WATER - 4) * 400).toBe(22400);
  });

  it('quotes the deep-recovery plant: 1,009 Btu/scf, 315 MMcf/d, 21.2% shrink, 42,296 bbl/d', () => {
    expect(full.ok).toBe(true);
    expect(Math.round(full.hhv)).toBe(1009);
    expect(Math.round(full.residueMMcfd)).toBe(315);
    expect((full.shrink * 100).toFixed(1)).toBe('21.2');
    expect(Math.round(full.nglBarrels)).toBe(42296);
    expect(full.fuelMMcfd.toFixed(1)).toBe('15.1');
  });

  it('solves the first challenge with the ethane left in: 71% of the propane and all the butane at least', () => {
    expect(ethaneLeftSolved(PLANT_DEFAULTS)).toBe(false);
    expect(ethaneLeftSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 71, butane: 100 })).toBe(true);
    expect(ethaneLeftSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 70, butane: 100 })).toBe(false);
    expect(ethaneLeftSolved({ co2: 0, dehydrate: false, ethane: 0, propane: 99, butane: 100 })).toBe(false);
    expect(ethaneLeftSolved({ co2: 0, dehydrate: true, ethane: 5, propane: 99, butane: 100 })).toBe(false);
    // Ethane alone has to go almost entirely.
    expect(runPlant({ co2: 0, dehydrate: true, ethane: 90, propane: 0, butane: 0 }).ok).toBe(true);
    expect(runPlant({ co2: 0, dehydrate: true, ethane: 89, propane: 0, butane: 0 }).ok).toBe(false);
  });

  it('rejects ethane at the starting prices, and sits just under the heating-value cap', () => {
    expect(reject.ok).toBe(true);
    expect(Math.round(reject.hhv)).toBe(1097);
    const allCo2 = processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...STANDARD, co2Removal: 1, ethane: 0 });
    expect(allCo2.hhv.toFixed(1)).toBe('1100.9');
    expect(allCo2.ok).toBe(false);
    const vr = plantValue(reject, NGL_PRICES);
    const vf = plantValue(full, NGL_PRICES);
    expect((vr.total / 1e6).toFixed(2)).toBe('1.57');
    expect((vf.total / 1e6).toFixed(2)).toBe('1.53');
    expect(Math.round((vr.total - vf.total) / 100) * 100).toBe(43400);
    expect(Math.round(vr.propane + vr.butane)).toBe(454082);
    expect(dayValue(0, VALUE_DEFAULTS.gas, VALUE_DEFAULTS.ethanePrice)).toBeCloseTo(vr.total, 6);
  });

  it('values the liquids as gas and finds the breakeven at $0.288, the lowest paying cent 29¢', () => {
    expect((mmbtuPerGallon('propane') * 2.75).toFixed(2)).toBe('0.25');
    expect((mmbtuPerGallon('ethane') * 2.75).toFixed(2)).toBe('0.18');
    expect(ethaneBreakeven(RIDGEBACK_RAW, NGL_PRICES).toFixed(3)).toBe('0.288');
    const slope = ethaneBreakeven(RIDGEBACK_RAW, { gas: 3.75, nglFee: 0.08 }) - ethaneBreakeven(RIDGEBACK_RAW, NGL_PRICES);
    expect((slope * 100).toFixed(1)).toBe('7.5');
    expect(CHALLENGE_GAS).toBe(2.75);
    expect(lowestPayingCent(2.75)).toBe(29);
    expect(recoveryGain(2.75, 0.28)).toBeLessThan(0);
    expect(recoveryGain(2.75, 0.29)).toBeGreaterThan(0);
    expect(breakevenSolved(VALUE_DEFAULTS)).toBe(false);
    expect(breakevenSolved({ gas: 2.75, ethanePrice: 0.29, recovery: 0 })).toBe(true);
    expect(breakevenSolved({ gas: 2.75, ethanePrice: 0.3, recovery: 0 })).toBe(false);
    expect(breakevenSolved({ gas: 3, ethanePrice: 0.29, recovery: 0 })).toBe(false);
  });

  it('quotes Sandhill’s raw gas with and without its CO2', () => {
    expect(Math.round(gasProperties(SANDHILL_RAW).hhv)).toBe(959);
    expect(checkSpec(SANDHILL_RAW).rules.every((r) => !r.ok)).toBe(true);
    const noCo2 = composition({ ...SANDHILL_RAW, co2: 0 });
    expect(Math.round(gasProperties(noCo2).hhv)).toBe(994);
    expect(Math.round(gasProperties(noCo2).wobbe)).toBe(1298);
    expect((noCo2.nitrogen * 100).toFixed(2)).toBe('4.15');
    expect(checkSpec(noCo2).ok).toBe(false);
  });
});
