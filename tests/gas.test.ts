// The natural gas course: its engines, its world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import { checkSpec, combustionProducts, composition, gasProperties, METHANE, MMBTU_PER_MCF, MMBTU_PER_MWH, PIPELINE_GAS, psia, psig, R_PSIA, rankine, SCF_PER_LBMOL } from '../src/engines/gas/properties';
import { piston, scfPerCubicFoot, zFactor } from '../src/engines/gas/eos';
import { averagePressure, frictionFactor, inletPressure, outletPressure, pipeFlow, pipeInventory, pressureProfile, ROUGHNESS } from '../src/engines/gas/hydraulics';
import { compress, lineCapacity, stationLine } from '../src/engines/gas/compression';
import { BAYPORT_LNG, BAYPORT_LNG_FEEDGAS_BCFD, GAS_NODES, PIPELINE, PIPELINES, REFERENCE_DAYS, stationLineOf, STORAGE_SPECS } from '../src/model/gas/world';
import { ethaneSolved, MIX_DEFAULTS, mixComposition, PRESETS } from '../src/lessons/gas/ch1/L1_1';
import { CHARGE_SCF, HEAT, MAOP_PSIG, maopSolved, PISTON_DEFAULTS, V_MAX, V_MIN, zMinimum } from '../src/lessons/gas/ch1/L1_2';
import { FLOW_DEFAULTS, flowAt, northlineSolved, TARGET_MMCFD, transitHours } from '../src/lessons/gas/ch1/L1_3';
import { capacityWith, delivers, expansionSolved, FEWEST_FOR_TARGET, fewestStations, LINE_DEFAULTS, STATION_DEFAULTS, TARGET_FLOW } from '../src/lessons/gas/ch1/L1_4';
import { BILL_DEFAULTS, billsEqualSolved, CCF_THERM_HHV, HOME_SCF_PER_CF, METER_DEFAULTS, meterHour, thermsPerCcf } from '../src/lessons/gas/ch1/L1_5';
import { DAYS_PER_MONTH, gasFVF, gasInPlace, gasViscosity, pOverZ, pressureFromPz, simulateTank, wellRate } from '../src/engines/gas/reservoir';
import { arpsCum, arpsEur, arpsRate, declineAt, fieldCash, fieldProduction, firstYearDecline, fitArps, noisyHistory, productionByVintage, ridgebackMonthly, ridgebackRate, SANDHILL_WELL, sandhillMonthly, sumBcf, switchTime } from '../src/engines/gas/decline';
import { ethaneBreakeven, gallonsPerMcf, mmbtuPerGallon, plantValue, processGas } from '../src/engines/gas/processing';
import { NGL_PRICES, OPEX_PER_MCF, RAW_WATER, RIDGEBACK_PI, RIDGEBACK_RAW, RIDGEBACK_ROCK, ROYALTY, SANDHILL_PI, SANDHILL_RAW, SANDHILL_ROCK, WELL_COST } from '../src/model/gas/production';
import { BASE_ROCK, CHALLENGE_PRESSURE, explorerRate, fieldNumbers, FIELDS_DEFAULTS, leastPermSolved, permOf, permText, PWF, rateText, ROCK_DEFAULTS } from '../src/lessons/gas/ch2/L2_1';
import { BLOCK_GIP, blockSolved, lineEstimate, runWell, steadyCap, steadySolved, SURVEYS, WELL_DEFAULTS, wellOf } from '../src/lessons/gas/ch2/L2_2';
import { ACTUAL_BCF, bestFit, fitError, FORECAST_DEFAULTS, forecastSolved, HISTORY, SEEN } from '../src/lessons/gas/ch2/L2_3';
import { breakevenPrice, BUDGET_WELLS, FIELD_DEFAULTS, fieldSolved, promise, schedule, TARGET } from '../src/lessons/gas/ch2/L2_4';
import { breakevenSolved, CHALLENGE_GAS, dayValue, DEEP, ethaneLeftSolved, lowestPayingCent, PLANT_DEFAULTS, recoveryGain, runPlant, STANDARD, VALUE_DEFAULTS } from '../src/lessons/gas/ch2/L2_5';
import { bindingArcs, corridorDesign, type FlowProblem, loopedFlow, solveFlow } from '../src/engines/gas/network';
import { CITY_HOURLY_SHAPE, packLineCapacity, packLineOf, packWindow, runLinepack } from '../src/engines/gas/linepack';
import { dailyFromMonthly, daysToFill, deliverableOver, injectCapacity, optimizeStorage, runStorage, storagePressure, thresholdPolicy, withdrawCapacity } from '../src/engines/gas/storage';
import { breakevenHub, cargoChoice, cargoMargin, lngCargo, netback, overseasPrices } from '../src/engines/gas/lng';
import { BUILD_DEFAULTS, buildProblem, CAPITAL_CHARGE, chargePerMMBtu, CHEAPEST, CHEAPEST_COST, cheapestExpansion, design, expansionSolved as buildSolved, networkCost, onlyAdds, REGION_STATIONS } from '../src/lessons/gas/ch3/L3_1';
import { dayPreset, hollowSolved, LOOP_DEFAULTS, LOOP_TARGET, loopedCapacity, loopSolved, solveDay, SOLVER_DEFAULTS } from '../src/lessons/gas/ch3/L3_2';
import { ANSWER_RAMP, bestStart, ccgtMW, CHALLENGE_AVG, clean, dayMean, largestRamp, PACK_DEFAULTS, RAMP_STEP, rampSolved, simulate, START_MAX, START_MIN, START_STEP, startRange } from '../src/lessons/gas/ch3/L3_3';
import { coldSpell, CROSSOVER_DAY, crossoverSolved, dayLabel, DESIGN_INV, DESIGN_NEED, firmRate, firmSolved, gasYear, INJ_DAYS, WD_DAYS, YEAR_DEFAULTS } from '../src/lessons/gas/ch3/L3_4';
import { breakevenSolved as cargoBreakevenSolved, CHAIN_DEFAULTS, CHALLENGE, challengeAnswer, voyageOf, voyagePhase } from '../src/lessons/gas/ch3/L3_5';
import { clearRegion, forwardCurve, marketDay, normalPlan, planFor, planInventory, planMonth, scenarioYear, SEASONAL_COSTS, seasonalPlan, simulateYear } from '../src/engines/gas/market';
import { capacityAuction, firmCapacityValue, futuresMarks, interruptibleValue, marginCalls } from '../src/engines/gas/contracts';
import { GAS_MONTH_START, GAS_MONTHS, normalTemp, weatherYear, WINTER_START, withColdSnap } from '../src/model/gas/weather';
import { demandBlocks, demandByNode, OIL_SWITCH_VALUE } from '../src/model/gas/demand';
import { BAL_JAN15, BAL_JUL15, BALANCE_DEFAULTS, BALANCE_YEARS, balanceDay, balanceWeeks, LNG_CUT_TEMP, lngCutSolved, storageValue, winterDraw } from '../src/lessons/gas/ch4/L4_1';
import { BASIS_STEPS, breakawaySolved, breakawayTemp, HUB_DAY, HUB_DEFAULTS, hubDay, hubWinter, hubWinterStats, metroSetter, SHORTCUT_RENT } from '../src/lessons/gas/ch4/L4_2';
import { ANCHOR_ANSWER, anchorSolved, CAPACITY_AUCTION_DEFAULTS, EXPANSION_ANNUAL_COST, EXPANSION_COST, EXPANSION_COST_PER_UNIT, EXPANSION_MMBTU_D, expansionOutcome, IT_TOTAL, MARKETER_BID, METRO_GAS_VALUE, QTY_STEP, SPIKE_METRO_PRICE, WINTERS } from '../src/lessons/gas/ch4/L4_3';
import { enoughStorageScale, enoughStorageSolved, ROUND_TRIP, SEASON_DEFAULTS, seasonPlan, seasonSummary, STORAGE_BCF, WINTER_SEEDS, winterStats } from '../src/lessons/gas/ch4/L4_4';
import { backwardationThreshold, curveAt, curveChallengeSolved, HEDGE_CONTRACTS, hedgeSolved, INITIAL_MARGIN, MAINTENANCE_MARGIN, SHORT_LEVEL, strips, swapBasis, utilityCost, type WinterId, winterRun } from '../src/lessons/gas/ch4/L4_5';
import { GAS_PLANTS, impliedHeatRate, powerDay, sparkSpread } from '../src/engines/gas/power';
import { BASIS_DEFAULTS, basisStatsFor, EXPRESS_ENOUGH, GROWTH, growthProduction, growthRun, latestYearSolved, NORMAL_GAP, northlineSolved as basisNorthlineSolved, TAKEAWAY } from '../src/lessons/gas/ch5/L5_1';
import { curveDaily, hedgeYearSolved, LEASE_DEFAULTS, LEASE_GRID, LEASE_YEARS, leaseDays, leaseIntrinsic, leasePerfect, leasePerfectValues, leaseSpec, leaseSpotPaths, leaseTrades, leaseUnhedged, LEVEL_MAX, LEVEL_MIN, LEVEL_TARGET, levelChallengeSolved, SCENARIO_DEFAULTS, scheduleValue } from '../src/lessons/gas/ch5/L5_2';
import { COLD_POWER_ANSWER, coldDayG2P, coldPowerSolved, G2P_BURN_SWEEP, G2P_COLD_DEFAULTS, G2P_DEFAULTS, G2P_SWITCHES, g2pHour, lakesideSpark, SPARK_TARGET, sparkTargetSolved } from '../src/lessons/gas/ch5/L5_3';
import { asiaPremium, CANCEL_COST, cancelLevelSolved, CARGO_MMBTU, FIRST_CANCEL_LEVEL, firstSummerCut, homeBase, homeStats, summerCutSolved, TRADER_DEFAULTS, traderMonths, traderSummary } from '../src/lessons/gas/ch5/L5_4';
import { CRISIS_DEFAULTS, crisisRun, crisisStats, EVERY_DEFENSE, giveWay, marchDefenseSolved, NORTHLINE_CHALLENGE, northlineNeeded, STORM_DAYS, STORM_LEAD, stormNorthlineSolved, warmestRationing, WORST_STORM } from '../src/lessons/gas/ch5/L5_5';
import { COST_RECIPE } from '../src/engines/market/offerCost';
import { conditionsOf, END_OF_WINTER, gasHistory, HISTORY_YEARS, planFrom } from '../src/model/gas/history';
import { contractPath, curveAt as futuresCurveAt, historyMonths, monthAverage, monthLabel, settlement } from '../src/engines/gas/futures';
import { forecastFundamentals, forecastSkill, forecastTemps, remainingHddError, SKILL_DECAY_DAYS } from '../src/engines/gas/forecast';
import { daysIn, defaultCosts, hypothesizedConditions, lakesideMargin, leasedStorage, LOT_MMBTU, marginRates, metroBasisTrades, monthlyStorageOptimum, nextOf, powerAsset, ridgebackTakeaway, ridgebackTrades, runBook, spreadSignals, storageAsset, tradeable, transportAsset, weatherSignals, weatherTrades } from '../src/engines/gas/strategies';
import { COLD_SPELL, coldSpellAnswer, coldSpellMiss, ERROR_YEARS, FORECAST_MEMBERS, FORECASTER_DEFAULTS, forecasterPricePerHdd, forecasterRestError, forecasterRun, forecasterSolved, forecasterStoragePerHdd, forecasterSurprises, forecasterTwoWeekError, forecasterTwoWeeks, PRICE_TOLERANCE, WEEKS } from '../src/lessons/gas/ch6/L6_1';
import { bestRuleThresholds, ruleBookFor, ruleYears, SPREAD_RULE_DEFAULTS, SPREAD_TRADER_DEFAULTS, spreadTraderSolved, traderBook, traderCold, traderFollowsWeather, traderSignal, traderSignals, traderWinters } from '../src/lessons/gas/ch6/L6_2';
import { BASIS_DESK_DEFAULTS, basisDeskNumbers, basisDeskRun, basisDeskSignals, basisDeskSolved, GROWTH_MAX, leastGlutGrowth, METRO_DESK_DEFAULTS, metroDeskRun, metroForecastSolved, viewsYearFiveGlut } from '../src/lessons/gas/ch6/L6_3';
import { ARB_LEASE_DEFAULTS, ARBITRAGE_DEFAULTS, arbitrageData, arbitrageNumbers, arbitrageSolved, arbitrageTotal, arbitrageYears, assetValues, FEE_SCALE, feeKeyOf, LEASE_BCF, leaseFloorFee, leasePath, leaseYearSolved, worstUnhedgedYear } from '../src/lessons/gas/ch6/L6_4';
import { LAB_CHALLENGE, labBook, labCosts, labLargestSize, labOutcome, labSpreadHindsight, labWalk, labWinterHdd, STRATEGY_LAB_DEFAULTS, strategyLabNumbers, strategyLabSolved } from '../src/lessons/gas/ch6/L6_5';

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

describe('gas chapter 3: network flow', () => {
  const two: FlowProblem = {
    nodes: ['a', 'b'],
    arcs: [{ id: 'ab', from: 'a', to: 'b', cap: 1, cost: 0.2 }],
    supplies: [
      { node: 'a', cap: 5, cost: 2 },
      { node: 'b', cap: 5, cost: 6 },
    ],
    demands: [{ node: 'b', cap: 3, value: 50 }],
  };

  it('fills the cheap path first and prices each node at its marginal cost', () => {
    const s = solveFlow(two);
    expect(s.flow.ab).toBeCloseTo(1, 9);
    expect(s.supplied).toEqual([1, 2]);
    expect(s.prices.a).toBeCloseTo(2, 9);
    expect(s.prices.b).toBeCloseTo(6, 9);
    expect(bindingArcs(two, s)).toEqual(['ab']);
  });

  it('prices the far node at the near price plus transport when the pipe has room', () => {
    const s = solveFlow({ ...two, demands: [{ node: 'b', cap: 0.5, value: 50 }] });
    expect(s.prices.b).toBeCloseTo(2.2, 9);
    expect(s.unserved.b).toBeCloseTo(0, 9);
  });

  it('prices unserved demand at its value', () => {
    const s = solveFlow({ ...two, supplies: [{ node: 'a', cap: 5, cost: 2 }] });
    expect(s.unserved.b).toBeCloseTo(2, 9);
    expect(s.prices.b).toBeCloseTo(50, 9);
  });

  it('serves the region’s design day only with Hollow Creek withdrawing', () => {
    const nodes = GAS_NODES.map((n) => n.id);
    const d = REFERENCE_DAYS.design.demand;
    const base = {
      nodes,
      arcs: PIPELINES.map((p) => ({ id: p.id, from: p.from, to: p.to, cap: p.capacityBcfd, cost: p.variableCost })),
      demands: (Object.keys(d) as Array<keyof typeof d>).map((k) => ({ node: k, cap: d[k], value: 50 })),
    };
    const supplies = [
      { node: 'ridgeback', cap: 2.6, cost: 1.2 },
      { node: 'sandhill', cap: 0.8, cost: 1.6 },
      { node: 'calder', cap: 1.2, cost: 4 },
    ];
    const without = solveFlow({ ...base, supplies });
    expect(without.unserved.metro).toBeGreaterThan(0.5);
    const withHc = solveFlow({ ...base, supplies: [...supplies, { node: 'metro', cap: 1.0, cost: 4.5 }] });
    expect(withHc.unserved.metro).toBeCloseTo(0, 9);
  });

  it('reproduces the six built lines’ capacities and prices them in billions', () => {
    let total = 0;
    for (const p of PIPELINES) {
      const d = corridorDesign(p.id, p.sizeIn, p.stations);
      expect(d.capacityBcfd).toBe(p.capacityBcfd);
      total += d.cost;
    }
    expect(total / 1e9).toBeGreaterThan(5);
    expect(total / 1e9).toBeLessThan(12);
    expect(corridorDesign('calder-metro', 36, 4).capacityBcfd).toBeCloseTo(2.05, 9);
  });

  it('splits flow between looped pipes by their resistance', () => {
    const pipe = { diameterIn: 35, lengthMi: 80, roughnessIn: 0.0007 };
    const none = loopedFlow(pipe, 0, 0, 1454.7, 779.7).total;
    const half = loopedFlow(pipe, 30, 0.5, 1454.7, 779.7);
    const full = loopedFlow(pipe, 35, 1, 1454.7, 779.7);
    expect(half.total).toBeGreaterThan(none);
    expect(full.total).toBeCloseTo(2 * none, 0);
    expect(half.inLoop + half.inMain).toBeCloseTo(half.total, 9);
  });
});

describe('gas chapter 3: linepack, storage and LNG', () => {
  const NL = packLineOf(PIPELINE['calder-metro']);

  it('gives Northline its capacity and a pack window that closes at capacity', () => {
    expect(packLineCapacity(NL)).toBeCloseTo(1802, 0);
    const w0 = packWindow(NL, 600);
    const w1 = packWindow(NL, 1400);
    expect(w0.swing).toBeGreaterThan(w1.swing);
    expect(packWindow(NL, 1801).swing).toBeLessThan(5);
  });

  it('keeps linepack within its window hour by hour', () => {
    const dem = CITY_HOURLY_SHAPE.map((x) => 1200 * x);
    const w = packWindow(NL, 1200);
    const r = runLinepack(NL, (w.max + w.min) / 2, [1200], dem, 48);
    for (const h of r) {
      expect(h.discharge).toBeLessThanOrEqual(NL.maopPsia + 1e-3);
      expect(h.delivery).toBeGreaterThanOrEqual(NL.minDeliveryPsia - 1e-3);
    }
    expect(CITY_HOURLY_SHAPE.reduce((a, b) => a + b) / 24).toBeCloseTo(1, 9);
  });

  it('slows withdrawals as storage empties and injections as it fills', () => {
    const hc = STORAGE_SPECS.hollowcreek;
    expect(withdrawCapacity(hc, 120)).toBeCloseTo(1, 9);
    expect(withdrawCapacity(hc, 30)).toBeLessThan(withdrawCapacity(hc, 60));
    expect(injectCapacity(hc, 110)).toBeLessThan(injectCapacity(hc, 30));
    const days = daysToFill(hc, 0, 120);
    expect(days).toBeGreaterThan(180);
    expect(days).toBeLessThan(214);
    const salt = STORAGE_SPECS.saltflat;
    expect(daysToFill(salt, 0, 30)).toBeLessThan(70);
    expect(deliverableOver(salt, 30, 10)).toBeCloseTo(12, 6);
  });

  it('runs a storage season and respects its ratchets', () => {
    const hc = STORAGE_SPECS.hollowcreek;
    const r = runStorage(hc, 100, Array<number>(60).fill(-1.0));
    expect(r.some((d) => d.limited)).toBe(true);
    for (const d of r) expect(d.inventory).toBeGreaterThanOrEqual(0);
  });

  it('conserves energy along the LNG chain and agrees with its own netback', () => {
    const v = { hubPrice: 3, feedMultiplier: 1.15, liquefactionFee: 2.5, ladenDays: 13, charterPerDay: 80_000, voyageFees: 0, regasFee: 0.4 };
    const c = lngCargo(v);
    expect(c.feed).toBeCloseTo(c.liquefactionFuel + c.boilOff + c.regasFuel + c.sentOut, 3);
    expect(c.loaded / 1e6).toBeCloseTo(3.825, 3);
    expect(cargoMargin({ ...v, hubPrice: breakevenHub(v, 10) }, 10)).toBeCloseTo(0, 0);
    expect(c.delivered$).toBeGreaterThan(6.5);
    expect(c.delivered$).toBeLessThan(8);
  });
});

describe('gas 3.1', () => {
  const day = (d: 'summer' | 'winter' | 'design', plant = false) => {
    const p = buildProblem({ ...BUILD_DEFAULTS, day: d, plant });
    return { p, s: solveFlow(p) };
  };
  const supply = (r: ReturnType<typeof day>, id: string) => r.s.supplied[r.p.supplies.findIndex((x) => x.id === id)];
  const short = (r: ReturnType<typeof day>) => Object.values(r.s.unserved).reduce((a, b) => a + b, 0);

  it('quotes the region’s network on the three days', () => {
    const summer = day('summer');
    expect(summer.s.flow['calder-metro']).toBeCloseTo(0.65, 9);
    expect(summer.s.flow['calder-bayport']).toBeCloseTo(0.85, 9);
    expect(supply(summer, 'sandhill')).toBeCloseTo(0.55, 9);
    expect(Math.round((summer.s.flow['calder-metro'] / 1.8) * 100)).toBe(36);
    const winter = day('winter');
    expect(supply(winter, 'saltflat')).toBeCloseTo(1.05, 9);
    expect(supply(winter, 'hollowcreek')).toBeCloseTo(0.15, 9);
    const design = day('design');
    expect(short(design)).toBeLessThan(1e-9);
    expect(supply(design, 'hollowcreek')).toBeCloseTo(0.85, 9);
    expect(networkCost(BUILD_DEFAULTS) / 1e9).toBeCloseTo(7.89, 2);
  });

  it('can’t serve the design day without Hollow Creek, whatever the pipes', () => {
    const p = buildProblem({ ...BUILD_DEFAULTS, day: 'design' });
    const without = solveFlow({ ...p, supplies: p.supplies.filter((x) => x.id !== 'hollowcreek') });
    expect(without.unserved.metro).toBeCloseTo(0.85, 9);
    const supplyTotal = p.supplies.filter((x) => x.id !== 'hollowcreek').reduce((a, x) => a + x.cap, 0);
    expect(supplyTotal).toBeLessThan(p.demands.reduce((a, d) => a + d.cap, 0));
  });

  it('makes a fourth Valley Line station the cheapest way to serve the new plant', () => {
    expect(short(day('design', true))).toBeCloseTo(0.05, 9);
    const best = cheapestExpansion();
    expect({ id: best.id, size: best.size, stations: best.stations }).toEqual(CHEAPEST);
    expect(CHEAPEST_COST / 1e6).toBeCloseTo(39.3, 1);
    const answer = { ...BUILD_DEFAULTS, day: 'design' as const, plant: true, stations: { ...REGION_STATIONS, 'sandhill-metro': 4 } };
    expect(buildSolved(answer)).toBe(true);
    expect(buildSolved({ ...answer, day: 'winter' })).toBe(false);
    expect(buildSolved({ ...answer, stations: { ...REGION_STATIONS, 'calder-metro': 4 } })).toBe(false);
    expect(buildSolved({ ...answer, stations: { ...REGION_STATIONS, 'sandhill-metro': 4, 'calder-bayport': 2 } })).toBe(false);
    expect(onlyAdds({ ...answer, stations: { ...REGION_STATIONS, 'sandhill-metro': 4, 'calder-bayport': 2 } })).toBe(false);
    // The alternatives the success text names.
    const nl3 = design('calder-metro', 36, 3);
    const nl4 = design('calder-metro', 36, 4);
    expect(((nl4.hp - nl3.hp) * 3000) / 1e6).toBeCloseTo(233.5, 1);
    expect(nl4.capacityBcfd - 1.8).toBeCloseTo(0.25, 9);
    expect(design('bayport-metro', 20, 1).cost / 1e6).toBeCloseTo(768.1, 1);
  });

  it('quotes the economies of scale on Northline’s corridor', () => {
    expect(CAPITAL_CHARGE).toBeCloseTo(0.106, 3);
    const d20 = design('calder-metro', 20, 3);
    const d42 = design('calder-metro', 42, 3);
    expect(d20.capacityBcfd).toBeCloseTo(0.35, 9);
    expect(d20.cost / 1e6).toBeCloseTo(802, 0);
    expect(d42.capacityBcfd).toBeCloseTo(2.7, 9);
    expect(d20.cost / d20.capacityBcfd / (d42.cost / d42.capacityBcfd)).toBeCloseTo(2.7, 1);
    const per36 = [1, 2, 3, 4, 5].map((n) => Math.round(design('calder-metro', 36, n).cost / design('calder-metro', 36, n).capacityBcfd / 1e7));
    expect(per36).toEqual([139, 108, 101, 100, 103]);
    const nl = design('calder-metro', 36, 3);
    expect((nl.cost * CAPITAL_CHARGE) / 1e6).toBeCloseTo(193.6, 1);
    expect(chargePerMMBtu(nl.cost, nl.capacityBcfd, 1)).toBeCloseTo(0.28, 2);
    expect(chargePerMMBtu(nl.cost, nl.capacityBcfd, 0.6)).toBeCloseTo(0.47, 2);
  });
});

describe('gas 3.2', () => {
  it('routes the cold day through full Northline and Valley Line, with Hollow Creek making up the rest', () => {
    const w = solveDay(SOLVER_DEFAULTS);
    expect(SOLVER_DEFAULTS.metro).toBeCloseTo(2.4, 9);
    expect(w.flow['calder-metro']).toBeCloseTo(1.8, 9);
    expect(w.flow['sandhill-metro']).toBeCloseTo(0.45, 9);
    expect(w.hollow).toBeCloseTo(0.15, 9);
    expect(w.salt).toBeCloseTo(1.05, 9);
    expect(w.flow['ridgeback-calder']).toBeCloseTo(1.65, 9);
    expect(w.totalUnserved).toBeCloseTo(0, 9);
    expect(w.binding.sort()).toEqual(['calder-metro', 'ridgeback-bayport', 'sandhill-metro']);
    // The Coastal Line is full on all three reference days.
    for (const d of ['summer', 'winter', 'design'] as const) expect(solveDay(dayPreset(d)).flow['ridgeback-bayport']).toBeCloseTo(0.85, 9);
  });

  it('leaves Metro short with gas to spare when Northline is out', () => {
    const o = solveDay({ ...SOLVER_DEFAULTS, out: ['calder-metro'] });
    expect(o.served.metro).toBeCloseTo(1.45, 9);
    expect(o.unserved.metro).toBeCloseTo(0.95, 9);
    expect(SOLVER_DEFAULTS.ridgeback - o.ridgeback).toBeCloseTo(0.45, 9);
    expect(o.salt).toBeCloseTo(0, 9);
  });

  it('strands Ridgeback gas past its outlets’ 3.05 Bcf/d', () => {
    const g = solveDay({ ...dayPreset('summer'), ridgeback: 3.4 });
    expect(g.ridgeback).toBeCloseTo(3.05, 9);
    expect(g.binding.sort()).toEqual(['ridgeback-bayport', 'ridgeback-calder']);
  });

  it('solves the Hollow Creek challenge at 0.85 Bcf/d and nowhere else', () => {
    const answers: number[] = [];
    for (let i = 0; i <= 20; i++) if (hollowSolved({ ...dayPreset('design'), hollow: i * 0.05 })) answers.push(Math.round(i * 5));
    expect(answers).toEqual([85]);
    expect(hollowSolved(SOLVER_DEFAULTS)).toBe(false);
    expect(hollowSolved({ ...dayPreset('design'), hollow: 0.85, out: ['ridgeback-calder'] })).toBe(false);
  });

  it('quotes the looping numbers', () => {
    expect(loopedCapacity(36, 0).total).toBeCloseTo(1802, 0);
    const half = loopedCapacity(36, 0.5);
    expect(half.total / 1000).toBeCloseTo(2.28, 2);
    expect(half.inLoop).toBeCloseTo(half.inMain, 6);
    expect(Math.round(half.inLoop)).toBe(1140);
    expect(loopedCapacity(36, 1).total / 1000).toBeCloseTo(3.6, 2);
    const h24 = loopedCapacity(24, 0.5);
    expect(Math.round((h24.inLoop / h24.total) * 100)).toBe(26);
    expect(lineCapacity({ ...stationLineOf(PIPELINE['calder-metro']), stations: 4 }, psia(765)) / 1000).toBeCloseTo(2.08, 2);
  });

  it('solves the looping challenge at 75% with 36-inch pipe, for about $1.24 billion', () => {
    expect(LOOP_TARGET).toBe(2650);
    const answers: number[] = [];
    for (let i = 0; i <= 20; i++) if (loopSolved({ size: '36', share: i * 5 })) answers.push(i * 5);
    expect(answers).toEqual([75]);
    expect(loopSolved(LOOP_DEFAULTS)).toBe(false);
    expect(loopSolved({ size: '30', share: 90 })).toBe(false);
    const cap = loopedCapacity(36, 0.75).total;
    expect(cap / 1000).toBeCloseTo(2.72, 2);
    expect(loopedCapacity(36, 0.7).total).toBeLessThan(2650);
    const hp = (q: number) => 3 * compress(q, psia(765), psia(1440)).hp;
    const extra = hp(cap) - hp(loopedCapacity(36, 0).total);
    expect(Math.round(extra / 1000) * 1000).toBe(91000);
    expect((36 * 180 * 150_000 + extra * 3000) / 1e9).toBeCloseTo(1.24, 2);
    // 24-inch loops can never reach it; 30-inch loops need 90%.
    expect(loopedCapacity(24, 1).total).toBeLessThan(2650);
  });
});

describe('gas 3.3', () => {
  const NL = packLineOf(PIPELINE['calder-metro']);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('starts with a clean two days: an 89 MMcf swing and Metro never below 858 psig', () => {
    const run = simulate(PACK_DEFAULTS);
    expect(clean(run)).toBe(true);
    const packs = run.map((h) => h.pack);
    expect(Math.round(Math.max(...packs))).toBe(856);
    expect(Math.round(Math.min(...packs))).toBe(767);
    expect(Math.round(Math.min(...run.map((h) => h.delivery)) - 14.696)).toBe(858);
    const w = startRange(1300, 0, 1300);
    expect(Math.ceil(w.lo)).toBe(730);
    expect(Math.floor(w.hi)).toBe(828);
  });

  it('carries at most a 375 MMcf/d evening ramp at 1,300 MMcf/d, and only from 785 MMcf at midnight', () => {
    expect(ANSWER_RAMP).toBe(375);
    expect(Math.round(ccgtMW(ANSWER_RAMP) / 100) * 100).toBe(2500);
    const starts: number[] = [];
    for (let s = START_MIN; s <= START_MAX; s += START_STEP) if (clean(simulate({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP, start: s }))) starts.push(s);
    expect(starts).toEqual([785]);
    for (let s = START_MIN; s <= START_MAX; s += START_STEP) expect(clean(simulate({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP + RAMP_STEP, start: s }))).toBe(false);
    expect(bestStart({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP })).toBe(785);
    expect(rampSolved({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP, start: 785 })).toBe(true);
    expect(rampSolved({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP })).toBe(false);
    expect(rampSolved({ ...PACK_DEFAULTS, ramp: ANSWER_RAMP - RAMP_STEP, start: 785 })).toBe(false);
    expect(dayMean(CHALLENGE_AVG, 0)).toBeCloseTo(1300, 9);
  });

  it('cuts deliveries with a 475 MMcf/d ramp whatever the start', () => {
    const over = simulate({ ...PACK_DEFAULTS, ramp: 475 });
    expect(Math.round(ccgtMW(475) / 100) * 100).toBe(3200);
    expect(over.find((h) => h.shortfall > 1e-6)?.hour).toBe(19);
    expect(sum(over.map((h) => h.shortfall)) / 24).toBeCloseTo(12.9, 1);
    for (let s = START_MIN; s <= START_MAX; s += START_STEP) expect(clean(simulate({ ...PACK_DEFAULTS, ramp: 475, start: s }))).toBe(false);
  });

  it('runs short on day 1 when receipts are 100 MMcf/d below demand, and no start avoids it', () => {
    const drain = simulate({ ...PACK_DEFAULTS, ratable: false, receipts: 1200 });
    expect(drain.find((h) => h.shortfall > 1e-6)?.hour).toBe(18);
    expect(Math.round(sum(drain.map((h) => h.shortfall)) / 24)).toBe(100);
    let latest = 0;
    for (let s = START_MIN; s <= START_MAX; s += START_STEP) {
      const r = simulate({ ...PACK_DEFAULTS, ratable: false, receipts: 1200, start: s });
      expect(clean(r)).toBe(false);
      latest = Math.max(latest, r.find((h) => h.shortfall > 1e-6)?.hour ?? 48);
    }
    expect(latest).toBe(42);
  });

  it('loses its flexibility as it fills', () => {
    expect(Math.round(packWindow(NL, 0).swing)).toBe(472);
    expect(Math.round(packWindow(NL, 1000).swing)).toBe(320);
    expect(Math.round(packWindow(NL, 1400).swing)).toBe(183);
    expect(Math.round(packLineCapacity(NL))).toBe(1802);
    expect(largestRamp(1000)).toBe(800);
    expect(largestRamp(600, 25, 1500)).toBe(1375);
    let limit = 0;
    for (let q = 0; q <= 1800; q += 5) {
      const r = startRange(q, 0, q);
      if (r.lo <= r.hi) limit = q;
    }
    expect(limit).toBe(1480);
    // The hour-by-hour simulation agrees: 1,450 can be run clean, 1,500 can't.
    const any = (avg: number) => {
      for (let s = START_MIN; s <= START_MAX; s += START_STEP) if (clean(simulate({ ...PACK_DEFAULTS, avg, start: s }))) return true;
      return false;
    };
    expect(any(1450)).toBe(true);
    expect(any(1500)).toBe(false);
  });
});

describe('gas 3.4', () => {
  const HC = STORAGE_SPECS.hollowcreek;
  const SF = STORAGE_SPECS.saltflat;

  it('opens on Metro’s seasonal swing against its pipelines and Northline’s linepack', () => {
    const pipes = PIPELINE['calder-metro'].capacityBcfd + PIPELINE['sandhill-metro'].capacityBcfd;
    expect(pipes).toBeCloseTo(2.25, 9);
    expect(REFERENCE_DAYS.summer.demand.metro / pipes).toBeCloseTo(0.49, 2);
    expect(DESIGN_NEED).toBeCloseTo(0.85, 9);
    expect(Math.round(packWindow(packLineOf(PIPELINE['calder-metro']), 0).swing)).toBe(472);
    expect(Math.round(storagePressure(HC, 0))).toBe(957);
    expect(storagePressure(HC, 120)).toBeCloseTo(2000, 6);
  });

  it('labels the gas year’s days', () => {
    expect(dayLabel(0)).toBe('April 1');
    expect(dayLabel(INJ_DAYS)).toBe('November 1');
    expect(dayLabel(INJ_DAYS + WD_DAYS - 1)).toBe('March 31');
    expect(dayLabel(289)).toBe('January 15');
  });

  it('runs the starting year: 119.1 Bcf by November 1, ratchets on the last 43 and 27 days', () => {
    const r = gasYear(YEAR_DEFAULTS.start, YEAR_DEFAULTS.inject, YEAR_DEFAULTS.withdraw);
    expect(r[INJ_DAYS - 1].inventory).toBeCloseTo(119.1, 1);
    expect(r[r.length - 1].inventory).toBeCloseTo(30.4, 1);
    expect(r.slice(0, INJ_DAYS).filter((d) => d.limited).length).toBe(43);
    expect(r.slice(INJ_DAYS).filter((d) => d.limited).length).toBe(27);
    expect(dayLabel(r.findIndex((d, i) => i >= INJ_DAYS && d.limited))).toBe('March 5');
    expect(dayLabel(r.findIndex((d, i) => i >= INJ_DAYS && d.inventory < DESIGN_INV))).toBe('January 23');
  });

  it('quotes Hollow Creek’s ratchets and season limits', () => {
    expect(withdrawCapacity(HC, 60)).toBeCloseTo(0.75, 2);
    expect(withdrawCapacity(HC, 30)).toBeCloseTo(0.46, 2);
    expect(injectCapacity(HC, 60)).toBeCloseTo(0.68, 2);
    expect(injectCapacity(HC, 108)).toBeCloseTo(0.37, 2);
    expect(Math.round(deliverableOver(HC, 120, WD_DAYS))).toBe(105);
    expect(Math.round(DESIGN_INV)).toBe(69);
    expect(Math.round((DESIGN_INV / 120) * 100)).toBe(57);
  });

  it('holds 0.54 Bcf/d all winter from full, and the challenge is solved only there', () => {
    expect(firmRate()).toBe(0.54);
    expect(firmSolved({ start: 36, inject: 0.45, withdraw: 0.54 })).toBe(true);
    expect(firmSolved({ start: 36, inject: 0.45, withdraw: 0.53 })).toBe(false);
    expect(firmSolved({ start: 36, inject: 0.45, withdraw: 0.55 })).toBe(false);
    expect(firmSolved(YEAR_DEFAULTS)).toBe(false);
  });

  it('compares the salt caverns with the depleted field in a cold spell', () => {
    expect(deliverableOver(SF, 30, 10)).toBeCloseTo(12, 6);
    expect(deliverableOver(HC, 120, 10)).toBeCloseTo(10, 6);
    expect(deliverableOver(HC, 120, 30)).toBeCloseTo(30, 6);
    expect(deliverableOver(SF, 30, 30)).toBeCloseTo(26.5, 1);
    expect(deliverableOver(HC, 30, 10)).toBeCloseTo(4.45, 2);
    expect(deliverableOver(SF, 7.5, 10)).toBeCloseTo(4.18, 2);
    expect(CROSSOVER_DAY).toBe(25);
    expect(coldSpell(HC, 120, 30)[24]).toBeLessThan(coldSpell(SF, 30, 30)[24]);
    expect(crossoverSolved({ fill: 100, days: 25 })).toBe(true);
    expect(crossoverSolved({ fill: 100, days: 24 })).toBe(false);
    expect(crossoverSolved({ fill: 90, days: 25 })).toBe(false);
  });
});

describe('gas 3.5', () => {
  const eu = lngCargo(voyageOf(CHAIN_DEFAULTS));
  const as = lngCargo(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia' }));

  it('loads 3.83 million MMBtu from 4.1 Bcf of feed, a cargo every 3.4 days, 107 a year', () => {
    expect(eu.loaded).toBe(3_825_000);
    expect(eu.feed).toBeCloseTo(4_250_000, 3);
    const feedBcf = eu.feed / (MMBTU_PER_MCF * 1e6);
    expect(feedBcf).toBeCloseTo(4.1, 1);
    const every = feedBcf / BAYPORT_LNG_FEEDGAS_BCFD;
    expect(every).toBeCloseTo(3.4, 1);
    expect(Math.round(365 / every)).toBe(107);
    expect(Math.round(eu.roundTripDays / every)).toBe(9);
    expect(Math.round(as.roundTripDays / every)).toBe(16);
  });

  it('loses 12.5% of the gas on the way to Europe, against Northline’s 1.8%', () => {
    expect(Math.round(eu.liquefactionFuel)).toBe(425_000);
    expect(Math.round(eu.boilOff)).toBe(49_428);
    expect(Math.round(eu.regasFuel)).toBe(56_634);
    expect((1 - eu.sentOut / eu.feed) * 100).toBeCloseTo(12.5, 1);
    const nl = PIPELINE['calder-metro'];
    expect(stationLine(stationLineOf(nl), 1800).fuelShare * 100).toBeCloseTo(1.8, 1);
  });

  it('delivers to Europe at $7.17 and Asia at $7.91 with gas at $3.00', () => {
    expect(eu.delivered$).toBeCloseTo(7.17, 2);
    expect(eu.perMMBtu.shipping).toBeCloseTo(0.65, 2);
    expect(eu.costs.shipping).toBe(2_400_000);
    expect(Math.round((eu.delivered$ - 3) / 0.15)).toBe(28);
    expect(eu.perMMBtu.liquefaction).toBeGreaterThan(eu.perMMBtu.shipping + eu.perMMBtu.regas);
    expect(as.delivered$).toBeCloseTo(7.91, 2);
    expect(as.perMMBtu.shipping).toBeCloseTo(1.31, 2);
    expect(as.roundTripDays).toBe(54);
    expect((as.boilOff / as.loaded) * 100).toBeCloseTo(2.5, 1);
  });

  it('raises shipping at $200,000 a day', () => {
    expect(lngCargo(voyageOf({ ...CHAIN_DEFAULTS, charter: 200_000 })).perMMBtu.shipping).toBeCloseTo(1.61, 2);
    expect(lngCargo(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia', charter: 200_000 })).perMMBtu.shipping).toBeCloseTo(3.08, 2);
  });

  it('earns $6.82 million on a $9.00 cargo to Europe, with a $7.73 netback and a $4.55 breakeven', () => {
    const v = voyageOf(CHAIN_DEFAULTS);
    expect(cargoMargin(v, 9) / 1e6).toBeCloseTo(6.82, 2);
    expect(netback(v, 9)).toBeCloseTo(7.73, 2);
    expect(breakevenHub(v, 9)).toBeCloseTo(4.55, 2);
  });

  it('solves the challenge at $3.90 and nowhere else on the grid', () => {
    expect(challengeAnswer()).toBe(3.9);
    expect(breakevenHub(voyageOf({ ...CHAIN_DEFAULTS, ...CHALLENGE }), 9)).toBeCloseTo(3.91, 2);
    const base = { ...CHAIN_DEFAULTS, dest: 'asia' as const, destPrice: 9 };
    expect(cargoBreakevenSolved({ ...base, hub: 3.9 })).toBe(true);
    expect(cargoBreakevenSolved({ ...base, hub: 3.85 })).toBe(false);
    expect(cargoBreakevenSolved({ ...base, hub: 3.95 })).toBe(false);
    expect(cargoBreakevenSolved({ ...base, hub: 3.9, charter: 100_000 })).toBe(false);
    expect(cargoBreakevenSolved({ ...CHAIN_DEFAULTS })).toBe(false);
  });

  it('sails the round trip in the right order', () => {
    expect(voyagePhase(1, 13).phase).toBe('loading');
    expect(voyagePhase(8, 13).phase).toBe('laden');
    expect(voyagePhase(16, 13).phase).toBe('unloading');
    expect(voyagePhase(29, 13).phase).toBe('ballast');
  });
});

describe('gas chapter 4: the market model', () => {
  const plan = normalPlan();

  it('fills storage by November and empties it by April in a normal year', () => {
    expect(plan.inventory.hollowcreek[7]).toBeGreaterThan(115);
    expect(plan.inventory.saltflat[7]).toBeGreaterThan(28);
    expect(plan.totalInventory[12]).toBeCloseTo(plan.totalInventory[0], 6);
    expect(plan.rationed.every((x) => x < 1e-9)).toBe(true);
  });

  it('prices each month above the last by at least the cost of holding gas, and Metro one transport cost above Calder', () => {
    for (const m of [1, 2, 3, 4, 5, 7, 8, 9, 10]) expect(plan.price.calder[m + 1] - plan.price.calder[m]).toBeGreaterThanOrEqual(SEASONAL_COSTS.holdCostPerMonth - 1e-9);
    // Storage is full by November, so winter costs more than summer by more than the cost of carrying gas.
    expect(plan.price.calder[7] - plan.price.calder[6]).toBeGreaterThan(0.5);
    for (let m = 0; m < 12; m++) expect(plan.price.metro[m] - plan.price.calder[m]).toBeCloseTo(PIPELINE['calder-metro'].variableCost, 6);
    expect(plan.price.calder[0]).toBeGreaterThan(2.5);
    expect(plan.price.calder[11]).toBeLessThan(4);
  });

  it('starts a plan in any month', () => {
    const nov = seasonalPlan({ startMonth: 7, start: { saltflat: plan.inventory.saltflat[7], hollowcreek: plan.inventory.hollowcreek[7] }, end: { saltflat: plan.inventory.saltflat[7], hollowcreek: plan.inventory.hollowcreek[7] } });
    expect(nov.startMonth).toBe(7);
    expect(planMonth(7, 5)).toBe(0);
    expect(nov.price.calder[5]).toBeLessThan(nov.price.calder[4]);
  });

  it('clears a day with storage inside its limits and sectors adding up', () => {
    const d = marketDay({ tempF: 20, storage: { saltflat: 15, hollowcreek: 60 }, waterValue: { saltflat: 3.4, hollowcreek: 3.55 } });
    const total = Object.values(d.sectors).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(Object.values(d.served).reduce((a, b) => a + b, 0), 9);
    expect(-d.storageFlow.hollowcreek).toBeLessThanOrEqual(withdrawCapacity(STORAGE_SPECS.hollowcreek, 60) + 1e-9);
    expect(d.price.metro).toBeGreaterThanOrEqual(d.price.calder + PIPELINE['calder-metro'].variableCost - 1e-9);
    const r = clearRegion({ tempF: 20, storage: { saltflat: 15, hollowcreek: 60 }, waterValue: { saltflat: 3.4, hollowcreek: 3.55 } });
    expect(r.price).toBeGreaterThan(1);
  });

  it('runs a year deterministically and keeps storage within its fields', () => {
    const a = simulateYear({ weather: weatherYear(4) });
    const b = simulateYear({ weather: weatherYear(4) });
    expect(a[364].price.calder).toBe(b[364].price.calder);
    for (const d of a) {
      expect(d.storage.saltflat).toBeGreaterThanOrEqual(0);
      expect(d.storage.hollowcreek).toBeLessThanOrEqual(120 + 1e-9);
      expect(d.rationed).toBeLessThan(1e-6);
    }
    expect(Math.max(...a.map((d) => d.price.metro - d.price.calder))).toBeGreaterThan(1);
  });

  it('expects winter to cost more than summer, and more still when storage is short', () => {
    const st = { saltflat: planInventory(plan, 'saltflat', 214), hollowcreek: planInventory(plan, 'hollowcreek', 214) };
    const c = forwardCurve({ startDay: 214, startStorage: st, scenarios: 8 });
    const short = forwardCurve({ startDay: 214, startStorage: { saltflat: st.saltflat * 0.75, hollowcreek: st.hollowcreek * 0.75 }, scenarios: 8 });
    expect(GAS_MONTHS[c.months[0]]).toBe('Dec');
    const feb = c.months.indexOf(10);
    const jul = c.months.indexOf(3);
    expect(c.calder[feb]).toBeGreaterThan(c.calder[jul] + 0.5);
    expect(short.calder[feb]).toBeGreaterThan(c.calder[feb]);
  });

  it('keeps the demand model near the reference days of Chapter 3', () => {
    const summer = demandByNode(80);
    const cold = demandByNode(25);
    expect(summer.metro).toBeGreaterThan(0.9);
    expect(summer.metro).toBeLessThan(1.4);
    expect(cold.metro).toBeGreaterThan(2.2);
    expect(cold.metro).toBeLessThan(2.9);
  });
});

describe('gas chapter 4: contracts', () => {
  it('runs uniform and pay-as-bid capacity auctions', () => {
    const bids = [
      { id: 'a', units: 100, price: 5 },
      { id: 'b', units: 100, price: 3 },
      { id: 'c', units: 100, price: 1 },
    ];
    const u = capacityAuction(bids, 150, 0.5);
    expect(u.awards).toEqual({ a: 100, b: 50, c: 0 });
    expect(u.clearingPrice).toBe(3);
    expect(u.revenue).toBe(450);
    expect(capacityAuction(bids, 150, 0.5, 'payAsBid').revenue).toBe(650);
    expect(capacityAuction(bids, 400, 0.5).clearingPrice).toBe(0.5);
  });

  it('values firm capacity by its spreads and interruptible capacity by the days it flows', () => {
    expect(firmCapacityValue([0.1, 0.5, 2], 0.15)).toBeCloseTo(0.35 + 1.85, 9);
    expect(interruptibleValue([0.1, 0.5, 2], [false, false, true], 0.15, 0.05)).toBeCloseTo(0.3, 9);
  });

  it('marks futures to market and calls margin', () => {
    const m = futuresMarks(2, 3, [3.1, 2.9, 2.5]);
    expect(m.daily[0]).toBeCloseTo(2000, 6);
    expect(m.cumulative[2]).toBeCloseTo(-10000, 6);
    expect(marginCalls(2, m.cumulative, 3000, 1500)).toEqual([2]);
  });
});

describe('gas 4.1', () => {
  it('opens on a normal January 15 with storage setting the price', () => {
    expect(BALANCE_DEFAULTS).toEqual({ day: BAL_JAN15, temp: 28, lng: 6.5, ridgeback: 2.6 });
    expect(storageValue(BAL_JAN15)).toBeCloseTo(3.889, 3);
    const b = balanceDay(BALANCE_DEFAULTS);
    expect(b.price).toBeCloseTo(3.939, 3);
    expect(b.marginal.id.startsWith('wd-')).toBe(true);
    expect(b.consumption).toBeCloseTo(3.33, 2);
    expect(b.exports).toBeCloseTo(1.2, 9);
    expect(b.storage).toBeCloseTo(-1.13, 2);
    // The balance identity.
    expect(b.production - b.consumption - b.exports).toBeCloseTo(b.storage, 9);
  });

  it('injects on a normal July 15 at storage’s bid', () => {
    const b = balanceDay({ ...BALANCE_DEFAULTS, day: BAL_JUL15, temp: Math.round(normalTemp(BAL_JUL15)) });
    expect(Math.round(normalTemp(BAL_JUL15))).toBe(76);
    expect(b.price).toBeCloseTo(2.839, 3);
    expect(b.consumption).toBeCloseTo(1.58, 2);
    expect(b.storage).toBeCloseTo(0.62, 2);
    expect(b.marginal.id.startsWith('inj-')).toBe(true);
  });

  it('climbs the demand curve once storage reaches its limit on January 15', () => {
    const at = (t: number) => balanceDay({ ...BALANCE_DEFAULTS, temp: t });
    expect(at(10).marginal.id.startsWith('wd-')).toBe(true);
    expect(at(10).storage).toBeCloseTo(-2.09, 2);
    expect(at(10).withdrawLimit).toBeCloseTo(2.14, 2);
    expect(at(9).marginal.id.startsWith('wd-')).toBe(false);
    expect(at(9).price).toBeCloseTo(4.0, 9);
    expect(at(8).price).toBeCloseTo(4.5, 9);
    expect(at(7).price).toBeCloseTo(5.0, 9);
    expect(at(7).marginal.id).toBe('bayport-flexible');
    expect(Math.round((at(27).storage - at(28).storage) * -1000)).toBe(53);
  });

  it('solves the LNG challenge at 4 °F and nowhere else', () => {
    expect(LNG_CUT_TEMP).toBe(4);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: 4 })).toBe(true);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: 5 })).toBe(false);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: 3 })).toBe(false);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: 4, lng: 6 })).toBe(false);
    const b = balanceDay({ ...BALANCE_DEFAULTS, temp: 4 });
    expect(b.price).toBeCloseTo(6.5, 9);
    expect(b.lngCut).toBeCloseTo(0.024, 3);
  });

  it('quotes the cold December and the mild winter', () => {
    const cold = balanceWeeks(BALANCE_YEARS[2].seed);
    const surprise = cold.reduce((a, w) => (w.change - w.planChange < a.change - a.planChange ? w : a));
    expect(surprise.start).toBe(266);
    expect(surprise.change).toBeCloseTo(-12.4, 1);
    expect(surprise.planChange).toBeCloseTo(-5.9, 1);
    expect(surprise.tempDev).toBeCloseTo(-18.5, 1);
    const gap = cold.reduce((a, w) => (w.inventory - w.planInventory < a.inventory - a.planInventory ? w : a));
    expect(gap.planInventory - gap.inventory).toBeCloseTo(20.3, 1);
    const peak = cold.reduce((a, w) => (w.price > a.price ? w : a));
    expect(peak.start).toBe(273);
    expect(peak.price).toBeCloseTo(6.25, 2);
    const mild = balanceWeeks(BALANCE_YEARS[0].seed);
    expect(Math.max(...mild.map((w) => w.price))).toBeCloseTo(4.25, 2);
    expect(mild[51].inventory).toBeCloseTo(53.1, 1);
    expect(mild[51].planInventory).toBeCloseTo(37.5, 1);
    const draw = winterDraw(BALANCE_YEARS[0].seed);
    expect(draw.actual).toBeCloseTo(92.5, 1);
    expect(draw.plan - draw.actual).toBeCloseTo(20.0, 1);
  });
});

describe('gas 4.2', () => {
  const start = hubDay(HUB_DEFAULTS);
  const b = (d: ReturnType<typeof hubDay>, n: 'metro' | 'bayport' | 'ridgeback' | 'sandhill') => d.price[n] - d.price.calder;

  it('starts on January 20 at 28 °F with Hollow Creek a fraction above plan', () => {
    expect(HUB_DAY).toBe(294);
    expect(HUB_DEFAULTS).toEqual({ temp: 28, hollow: 73, northline: 1.8, ridgeback: 2.6 });
    expect(HUB_DEFAULTS.hollow).toBeGreaterThan(planInventory(normalPlan(), 'hollowcreek', HUB_DAY));
  });

  it('prices every place at the hub plus or minus transport at the start', () => {
    expect(start.price.calder).toBeCloseTo(3.94, 2);
    expect(b(start, 'metro')).toBeCloseTo(0.15, 2);
    expect(b(start, 'bayport')).toBeCloseTo(0.1, 2);
    expect(b(start, 'ridgeback')).toBeCloseTo(-0.12, 2);
    expect(b(start, 'sandhill')).toBeCloseTo(-0.1, 2);
    expect(metroSetter(start, HUB_DEFAULTS)).toBe('gas from Calder Hub, plus the cost of moving it');
    expect(-start.storageFlow.hollowcreek).toBeCloseTo(0.9, 2);
    expect(-start.storageFlow.hollowcreek).toBeCloseTo(withdrawCapacity(STORAGE_SPECS.hollowcreek, 73), 6);
    expect(start.flow['calder-metro']).toBeCloseTo(1.06, 2);
    expect(SHORTCUT_RENT.coastal).toBeCloseTo(0.06, 2);
    expect(SHORTCUT_RENT.valley).toBeCloseTo(0.07, 2);
  });

  it('breaks Metro away from Calder in steps as it gets colder', () => {
    expect(BASIS_STEPS).toEqual({ breaks: 12, interruptible: 10, oil: 8, industry: -7, homes: -12 });
    const at = (t: number) => hubDay({ ...HUB_DEFAULTS, temp: t });
    expect(b(at(13), 'metro')).toBeCloseTo(0.15, 6);
    expect(at(12).price.metro).toBeCloseTo(4.5, 6);
    expect(at(11).price.metro).toBeCloseTo(5, 6);
    expect(at(10).price.metro).toBeCloseTo(8, 6);
    expect(at(8).price.metro).toBeCloseTo(15, 6);
    expect(at(8).price.calder).toBeCloseTo(3.94, 2);
    expect(b(at(8), 'metro')).toBeCloseTo(11.06, 2);
  });

  it('solves the challenge at 11 °F and nowhere else', () => {
    expect(breakawayTemp()).toBe(11);
    expect(breakawaySolved({ ...HUB_DEFAULTS, temp: 11 })).toBe(true);
    expect(breakawaySolved({ ...HUB_DEFAULTS, temp: 12 })).toBe(false);
    expect(breakawaySolved({ ...HUB_DEFAULTS, temp: 10 })).toBe(false);
    expect(breakawaySolved({ ...HUB_DEFAULTS, temp: 11, hollow: 72 })).toBe(false);
  });

  it('quotes the derated Northline and the flooded basin', () => {
    expect(b(hubDay({ ...HUB_DEFAULTS, northline: 1.0 }), 'metro')).toBeCloseTo(1.06, 2);
    expect(b(hubDay({ ...HUB_DEFAULTS, northline: 0.8 }), 'metro')).toBeCloseTo(11.16, 2);
    expect(b(hubDay({ ...HUB_DEFAULTS, ridgeback: 3.05 }), 'ridgeback')).toBeCloseTo(-0.12, 2);
    const glut = hubDay({ ...HUB_DEFAULTS, ridgeback: 3.1 });
    expect(glut.price.ridgeback).toBeCloseTo(1.2, 6);
    expect(b(glut, 'ridgeback')).toBeCloseTo(-2.73, 2);
    expect(glut.price.calder).toBeCloseTo(3.93, 2);
  });

  it('describes the three winters correctly', () => {
    const mild = hubWinterStats('mild');
    const typical = hubWinterStats('typical');
    const harsh = hubWinterStats('harsh');
    expect(hubWinter('harsh').length).toBe(151);
    expect(mild.breakaways).toBe(0);
    expect(mild.maxBasis).toBeCloseTo(0.15, 6);
    expect(Math.round(mild.coldest)).toBe(15);
    expect(typical.breakaways).toBe(1);
    expect(typical.maxDay).toBe(342);
    expect(typical.maxBasis).toBeCloseTo(1.6, 2);
    expect(Math.round(typical.maxTemp)).toBe(17);
    expect(Math.round(typical.peakInv)).toBe(39);
    expect(typical.coldestDay).toBe(274);
    expect(Math.round(typical.coldest)).toBe(10);
    expect(typical.coldestBasis).toBeCloseTo(0.32, 2);
    expect(Math.round(typical.coldestInv)).toBe(81);
    expect(harsh.breakaways).toBe(7);
    expect(harsh.maxDay).toBe(harsh.coldestDay);
    expect(harsh.maxDay).toBe(281);
    expect(harsh.maxBasis).toBeCloseTo(10.43, 2);
    expect(Math.round(harsh.maxTemp)).toBe(7);
    expect(harsh.avgBasis).toBeCloseTo(0.45, 2);
  });
});

describe('gas 4.3', () => {
  it('prices Northline’s fourth station: 259,250 MMBtu/d for $233 million, $95.54 per MMBtu/d a year', () => {
    expect(Math.round(EXPANSION_MMBTU_D)).toBe(259250);
    expect(EXPANSION_COST / 1e6).toBeCloseTo(233.5, 1);
    expect(EXPANSION_ANNUAL_COST / 1e6).toBeCloseTo(24.77, 2);
    expect(EXPANSION_COST_PER_UNIT).toBeCloseTo(95.54, 2);
    expect((EXPANSION_COST_PER_UNIT / 365) * 100).toBeCloseTo(26.2, 1);
  });

  it('finds firm capacity worth $12.36 a year on average over twenty winters, and interruptible worth nothing', () => {
    const firm = WINTERS.map((w) => w.firm);
    expect(MARKETER_BID).toBeCloseTo(12.36, 2);
    expect(Math.max(...firm)).toBeCloseTo(45.31, 2);
    expect(firm.filter((v) => v < 1).length).toBe(10);
    expect(WINTERS.filter((w) => w.fullDays === 0).length).toBe(2);
    expect(WINTERS.reduce((a, w) => a + w.fullDays, 0) / 20).toBeCloseTo(4.4, 6);
    const share = WINTERS.reduce((a, w) => a + w.topThree, 0) / WINTERS.reduce((a, w) => a + w.firm, 0);
    expect(Math.round(share * 100)).toBe(81);
    expect(IT_TOTAL).toBeLessThan(0.005);
    expect(SPIKE_METRO_PRICE).toBeCloseTo(OIL_SWITCH_VALUE, 6);
  });

  it('settles the starting open season short of the station’s cost, under either rule', () => {
    const pab = expansionOutcome(CAPACITY_AUCTION_DEFAULTS);
    expect(pab.revenue / 1e6).toBeCloseTo(12.97, 2);
    expect(pab.built).toBe(false);
    const uni = expansionOutcome({ ...CAPACITY_AUCTION_DEFAULTS, rule: 'uniform' });
    expect(uni.result.clearingPrice).toBeCloseTo(MARKETER_BID, 9);
    expect(uni.revenue / 1e6).toBeCloseTo(3.2, 2);
    expect((EXPANSION_MMBTU_D * Math.max(...WINTERS.map((w) => w.firm))) / 1e6).toBeCloseTo(11.75, 2);
  });

  it('needs an anchor contract of 225,000 MMBtu/d at $110, and the challenge is solved only there', () => {
    expect(ANCHOR_ANSWER).toBe(225000);
    expect(anchorSolved({ rule: 'payAsBid', qty: 225000, bid: METRO_GAS_VALUE })).toBe(true);
    expect(anchorSolved({ rule: 'payAsBid', qty: 225000 - QTY_STEP, bid: METRO_GAS_VALUE })).toBe(false);
    expect(anchorSolved({ rule: 'payAsBid', qty: 230000, bid: METRO_GAS_VALUE })).toBe(false);
    expect(anchorSolved({ rule: 'uniform', qty: 225000, bid: METRO_GAS_VALUE })).toBe(false);
    expect(anchorSolved({ rule: 'payAsBid', qty: 225000, bid: 115 })).toBe(false);
    expect(expansionOutcome({ rule: 'payAsBid', qty: 225000, bid: METRO_GAS_VALUE }).revenue / 1e6).toBeCloseTo(25.2, 1);
  });
});

describe('gas 4.4', () => {
  it('fills storage by November and prices winter $0.90 above October, $0.80 of it scarcity rent', () => {
    const p = seasonPlan(SEASON_DEFAULTS);
    const s = seasonSummary(p);
    expect(p.totalInventory[0]).toBeCloseTo(37.5, 1);
    expect(p.totalInventory[7]).toBeCloseTo(150, 1);
    expect(s.full).toBe(true);
    expect(ROUND_TRIP).toBeCloseTo(0.1, 9);
    expect(s.step).toBeCloseTo(0.9, 6);
    expect(s.rent).toBeCloseTo(0.8, 6);
    expect(p.price.calder[1]).toBeCloseTo(2.85, 6);
    expect(p.price.calder[6]).toBeCloseTo(2.95, 6);
    expect(p.price.calder[11]).toBeCloseTo(3.93, 6);
    expect(p.price.metro[1]).toBeCloseTo(3.0, 6);
    expect(p.price.metro[7]).toBeCloseTo(4.0, 6);
    expect(Math.round((s.rent * STORAGE_BCF * 1e6 * MMBTU_PER_MCF) / 1e6)).toBe(124);
  });

  it('stops filling at 160.5 Bcf, the challenge’s only answer', () => {
    expect(enoughStorageScale()).toBe(1.07);
    const answers: number[] = [];
    for (let i = 50; i <= 150; i++) if (enoughStorageSolved({ ...SEASON_DEFAULTS, scale: i / 100 })) answers.push(i / 100);
    expect(answers).toEqual([1.07]);
    expect(enoughStorageSolved({ ...SEASON_DEFAULTS, scale: 1.07, shift: -1 })).toBe(false);
    expect(seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: 1.07 })).peak).toBeCloseTo(160, 0);
  });

  it('quotes the effects of storage size, winter weather and LNG', () => {
    const small = seasonPlan({ ...SEASON_DEFAULTS, scale: 0.75 });
    expect(small.price.calder[1]).toBeCloseTo(1.7, 6);
    expect(small.price.sandhill[1]).toBeCloseTo(1.6, 6);
    expect(small.price.calder[7]).toBeCloseTo(4.9, 6);
    expect(seasonSummary(small).rent).toBeCloseTo(3.0, 6);
    const big = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: 1.5 }));
    expect(big.rent).toBeCloseTo(0, 9);
    expect(big.summer).toBeCloseTo(3.36, 2);
    expect(big.winter).toBeCloseTo(3.55, 2);
    expect(seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, shift: -1 })).winter).toBeCloseTo(4.81, 2);
    expect(seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, shift: 1 })).winter).toBeCloseTo(3.39, 2);
    expect(seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, lng: 1.1 })).summer).toBeCloseTo(1.75, 2);
  });

  it('simulates the four winters', () => {
    expect(WINTER_SEEDS).toEqual({ mild: 23, typical: 11, cold: 29 });
    const n = winterStats('normal');
    const mild = winterStats('mild');
    const typ = winterStats('typical');
    const cold = winterStats('cold');
    expect(Math.round(n.winterHdd)).toBe(4640);
    expect(n.mar31).toBeCloseTo(33.2, 1);
    expect(n.winterPrice).toBeCloseTo(4.21, 2);
    expect(Math.round((1 - mild.winterHdd / n.winterHdd) * 100)).toBe(15);
    expect(mild.mar31).toBeCloseTo(56.9, 1);
    expect(mild.winterPrice).toBeCloseTo(3.91, 2);
    expect(Math.round(typ.winterHdd)).toBe(4643);
    expect(typ.winterPrice).toBeCloseTo(4.38, 2);
    expect(Math.round((cold.winterHdd / n.winterHdd - 1) * 100)).toBe(14);
    expect(cold.mar31).toBeCloseTo(22.2, 1);
    expect(cold.winterPrice).toBeCloseTo(4.97, 2);
    expect(cold.maxPrice).toBeCloseTo(6.4, 6);
  });
});

describe('gas 4.5', () => {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const at = (c: ReturnType<typeof curveAt>, m: number) => c.calder[c.months.indexOf(m)];
  const basisAt = (c: ReturnType<typeof curveAt>, m: number) => c.metro[c.months.indexOf(m)] - at(c, m);

  it('draws the November 1 curve with a winter premium', () => {
    const c = curveAt('nov1', 100);
    expect([8, 9, 10, 11, 0].map((m) => r2(at(c, m)))).toEqual([4.08, 4.31, 4.56, 4.23, 2.9]);
    const summer = [0, 1, 2, 3, 4, 5].map((m) => at(c, m));
    expect(r2(Math.min(...summer))).toBe(2.78);
    expect(r2(Math.max(...summer))).toBe(2.9);
    const s = strips(c);
    expect(r2(s.winter)).toBe(4.26);
    expect(r2(s.summer)).toBe(2.87);
    expect(r2(c.calderSd[c.months.indexOf(10)])).toBe(0.63);
    expect(Math.max(...c.calderSd)).toBe(c.calderSd[c.months.indexOf(10)]);
    expect(r2(normalPlan().price.calder[10])).toBe(3.91);
    expect(r2(basisAt(c, 9))).toBe(0.22);
    expect(r2(basisAt(c, 10))).toBe(0.32);
    expect(r2(basisAt(c, 0))).toBe(0.15);
    expect(r2(swapBasis())).toBe(0.32);
  });

  it('raises the curve, winter most, when storage is short, and draws a full year from April 1', () => {
    const c = curveAt('nov1', SHORT_LEVEL);
    expect(SHORT_LEVEL).toBe(75);
    expect(r2(at(c, 8))).toBe(5.35);
    expect(r2(at(c, 10))).toBe(5.5);
    expect(r2(strips(c).winter)).toBe(5.09);
    expect(r2(strips(c).summer)).toBe(3.16);
    expect(r2(basisAt(c, 10))).toBe(0.48);
    const apr = curveAt('apr1', 100);
    expect(r2(at(apr, 3))).toBe(2.91);
    expect(r2(at(apr, 10))).toBe(4.87);
  });

  it('backwardates the winter at 70% of plan and no higher: the first challenge', () => {
    expect(backwardationThreshold()).toBe(70);
    expect(curveChallengeSolved({ date: 'nov1', level: 70 })).toBe(true);
    for (const l of [60, 65, 75, 80, 100]) expect(curveChallengeSolved({ date: 'nov1', level: l })).toBe(false);
    expect(curveChallengeSolved({ date: 'apr1', level: 70 })).toBe(false);
  });

  it('moves the February contract with storage through three winters', () => {
    const end = (id: WinterId) => winterRun(id).path[winterRun(id).path.length - 1];
    for (const id of ['cold', 'ordinary', 'mild'] as WinterId[]) expect(r2(winterRun(id).path[0])).toBe(4.56);
    expect(r2(end('cold'))).toBe(5.06);
    expect(r2(end('ordinary'))).toBe(4.35);
    expect(r2(end('mild'))).toBe(3.54);
    expect(r2(winterRun('cold').calderAvg)).toBe(5.12);
    expect(r2(winterRun('ordinary').calderAvg)).toBe(4.23);
    expect(r2(winterRun('mild').calderAvg)).toBe(3.32);
  });

  it('hedges the utility with 140 contracts: the second challenge', () => {
    expect(HEDGE_CONTRACTS).toBe(140);
    expect(hedgeSolved({ contracts: 140 })).toBe(true);
    expect(hedgeSolved({ contracts: 130 })).toBe(false);
    const range = (n: number, swap: boolean) => {
      const xs = (['cold', 'ordinary', 'mild'] as WinterId[]).map((id) => utilityCost(id, n, swap).net);
      return [r2(Math.min(...xs)), r2(Math.max(...xs))];
    };
    expect(range(0, false)).toEqual([3.47, 5.57]);
    expect(range(140, false)).toEqual([4.49, 5.07]);
    expect(range(140, true)).toEqual([4.67, 4.94]);
    const mild = utilityCost('mild', 140, false);
    expect(Math.round(-mild.futuresGain / 1e4) / 100).toBe(1.43);
    const w = winterRun('mild');
    const marks = futuresMarks(140, w.path[0], w.path.slice(1));
    expect(marginCalls(140, marks.cumulative, INITIAL_MARGIN, MAINTENANCE_MARGIN).length).toBe(5);
  });
});

describe('gas chapter 5: engines', () => {
  it('reruns a year under new conditions with a matching plan, and caches it', () => {
    const a = scenarioYear({ seed: 3, capacity: { 'ridgeback-calder': 1.6 } });
    const b = scenarioYear({ seed: 3, capacity: { 'ridgeback-calder': 1.6 } });
    expect(a).toBe(b);
    const basis = a.reduce((s, d) => s + d.price.ridgeback - d.price.calder, 0) / a.length;
    expect(basis).toBeLessThan(-0.5);
    expect(planFor({ capacity: { 'ridgeback-calder': 1.6 } })).toBe(planFor({ capacity: { 'ridgeback-calder': 1.6 } }));
  });

  it('values storage on a known price path by dynamic programming', () => {
    const spec = { ...STORAGE_SPECS.saltflat, workingBcf: 1, baseBcf: 0.4, maxWithdrawBcfd: 0.5, maxInjectBcfd: 0.5 };
    // Buy at $2 for two days, sell at $4 for two days: 1 Bcf bought and sold, less $0.10 of costs.
    const r = optimizeStorage([2, 2, 4, 4], spec, { grid: 20 });
    expect(r.value).toBeCloseTo(1.037e6 * (4 - 2 - 0.1), 0);
    expect(r.inventory[1]).toBeCloseTo(1, 9);
    expect(r.inventory[3]).toBeCloseTo(0, 9);
    // A flat path earns nothing.
    expect(optimizeStorage([3, 3, 3, 3], spec, { grid: 20 }).value).toBeCloseTo(0, 6);
    expect(dailyFromMonthly([1, 2], [2, 3])).toEqual([1, 1, 2, 2, 2]);
    const t = thresholdPolicy([2, 2, 4, 4], [3, 3, 3, 3], spec, 0.5);
    expect(t.value).toBeCloseTo(1.037e6 * (4 - 2 - 0.1), 0);
  });

  it('runs the electricity region at a gas price and finds spark spreads', () => {
    expect(sparkSpread(40, 5, 6.4, 4)).toBeCloseTo(4, 9);
    expect(impliedHeatRate(40, 5)).toBe(8);
    const cheap = powerDay(2);
    const dear = powerDay(6);
    expect(cheap.gasBcf).toBeGreaterThan(dear.gasBcf);
    expect(dear.avgPrice).toBeGreaterThan(cheap.avgPrice);
    expect(GAS_PLANTS.map((g) => g.heatRate)).toEqual([6.4, 7.6, 14]);
  });

  it('sends a cargo to the better netback and cancels it only when the feed gas isn’t covered', () => {
    const terms = BAYPORT_LNG;
    const c = cargoChoice(3, { europe: 9, asia: 10 }, terms);
    expect(c.best).toBe('asia');
    expect(c.fob).toBeCloseTo(1.15 * 3 + 2.5, 9);
    expect(c.cancel).toBe(false);
    const weak = cargoChoice(3, { europe: 5, asia: 5.5 }, terms);
    expect(weak.margin).toBeLessThan(0);
    expect(weak.cancel).toBe(false);
    expect(cargoChoice(3, { europe: 4, asia: 4 }, terms).cancel).toBe(true);
    const p = overseasPrices(5, 24);
    expect(p.europe).toHaveLength(24);
    expect(Math.min(...p.europe)).toBeGreaterThan(3);
  });

  it('lays a cold snap over a weather year', () => {
    const w = weatherYear(8);
    const s = withColdSnap(w, 300, 5, 30);
    expect(s.temp[302]).toBeLessThanOrEqual(w.normal[302] - 30);
    expect(s.temp[299]).toBe(w.temp[299]);
    expect(s.hdd[302]).toBeGreaterThan(w.hdd[302]);
  });
});

describe('gas 5.1', () => {
  const harsh = basisStatsFor(BASIS_DEFAULTS);

  it('sits at the cost of the trip most of the harsh year and breaks away on 7 days', () => {
    expect(BASIS_DEFAULTS).toEqual({ winter: 'harsh', northline: 1.8, express: 2.1 });
    expect(harsh.metroAtTrip).toBe(358);
    expect(harsh.metroOver1).toBe(7);
    expect(harsh.metroMax).toBeCloseTo(10.43, 2);
    expect(harsh.metroAvg).toBeCloseTo(0.27, 2);
    expect(harsh.ridgebackAvg).toBeCloseTo(-0.12, 6);
    // Northline's rent equals 4.3's firm value ($45.31 per MMBtu/d) times its 1.8 Bcf/d.
    expect(harsh.northlineRent / 1e6).toBeCloseTo(84.6, 1);
    expect(basisStatsFor({ ...BASIS_DEFAULTS, winter: 'typical' }).northlineRent / 1e6).toBeCloseTo(3.06, 2);
    expect(basisStatsFor({ ...BASIS_DEFAULTS, winter: 'mild' }).northlineRent).toBeLessThan(1000);
  });

  it('crosses $1 on more days, not wider ones, when Northline shrinks', () => {
    const nl15 = basisStatsFor({ ...BASIS_DEFAULTS, northline: 1.5 });
    expect(nl15.metroOver1).toBe(19);
    expect(nl15.metroAvg).toBeCloseTo(0.56, 2);
  });

  it('solves the Northline challenge at 1.95 Bcf/d only', () => {
    expect(basisNorthlineSolved(BASIS_DEFAULTS)).toBe(false);
    expect(basisNorthlineSolved({ ...BASIS_DEFAULTS, northline: 1.9 })).toBe(false);
    expect(basisNorthlineSolved({ ...BASIS_DEFAULTS, northline: 1.95 })).toBe(true);
    expect(basisNorthlineSolved({ ...BASIS_DEFAULTS, northline: 2 })).toBe(false);
    expect(basisNorthlineSolved({ ...BASIS_DEFAULTS, northline: 1.95, winter: 'typical' })).toBe(false);
    expect(basisStatsFor({ ...BASIS_DEFAULTS, northline: 1.9 }).metroOver1).toBe(4);
  });

  it('strands Ridgeback gas one step below 1.65 Bcf/d on Ridgeback Express', () => {
    expect(EXPRESS_ENOUGH).toBe(1.65);
    expect(basisStatsFor({ ...BASIS_DEFAULTS, express: 1.65 }).ridgebackAvg).toBeCloseTo(-0.12, 6);
    const re16 = basisStatsFor({ ...BASIS_DEFAULTS, express: 1.6 });
    expect(re16.ridgebackAvg).toBeCloseTo(-2.94, 2);
    expect(re16.ridgebackUnder50).toBe(365);
    expect(re16.calderAvg).toBeCloseTo(4.14, 2);
    expect(harsh.calderAvg).toBeCloseTo(3.64, 2);
    expect(re16.expressRent / 1e9).toBeCloseTo(1.71, 2);
  });

  it('breaks the basis in December of year 4 without an expansion', () => {
    expect(TAKEAWAY).toBeCloseTo(3.05, 9);
    expect(growthProduction(GROWTH.years - 1, 365)).toBeCloseTo(3.32, 9);
    const never = growthRun('never', 0.5);
    expect(never.monthly.findIndex((b) => b < NORMAL_GAP)).toBe(44);
    expect(never.monthly.filter((b) => b < NORMAL_GAP).length).toBe(28);
    expect(never.calder[5]).toBeCloseTo(5.21, 2);
    expect(never.rent.reduce((a, b) => a + b, 0) / 1e9).toBeCloseTo(5.84, 2);
    // A quarter-Bcf/d expansion in year 4 lasts until February of year 6.
    expect(growthRun('4', 0.25).monthly.findIndex((b) => b < NORMAL_GAP)).toBe(70);
  });

  it('needs the 0.5 Bcf/d expansion by year 4', () => {
    expect(latestYearSolved({ online: '4', size: '0.5' })).toBe(true);
    expect(latestYearSolved({ online: '3', size: '0.5' })).toBe(false);
    expect(latestYearSolved({ online: '5', size: '0.5' })).toBe(false);
    expect(latestYearSolved({ online: 'never', size: '0.5' })).toBe(false);
    expect(latestYearSolved({ online: '4', size: '1' })).toBe(false);
    expect(growthRun('5', 0.5).monthly.filter((b) => b < NORMAL_GAP).length).toBe(4);
  });
});

describe('gas 5.2', () => {
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  it('gives the two leases their fields’ speeds', () => {
    expect(leaseDays('salt')).toEqual({ fill: 50, empty: 25 });
    const r = leaseDays('reservoir');
    expect(r.fill).toBeCloseTo(150, 9);
    expect(r.empty).toBeCloseTo(120, 9);
  });

  it('values the leases exactly on their grids: a finer grid changes nothing', () => {
    for (const id of ['salt', 'reservoir'] as const) {
      const fine = optimizeStorage(curveDaily(100), leaseSpec(id), { grid: LEASE_GRID[id] * 2, costs: { injectCost: 0.05, withdrawCost: 0.05 } });
      expect(fine.value).toBeCloseTo(leaseIntrinsic(id).value, 0);
    }
  });

  it('quotes the intrinsic values and the trades behind them', () => {
    const salt = leaseIntrinsic('salt');
    const res = leaseIntrinsic('reservoir');
    expect(salt.value / 1e6).toBeCloseTo(2.016, 2);
    expect(res.value / 1e6).toBeCloseTo(1.693, 2);
    const st = leaseTrades(salt.flow, curveDaily(100));
    expect(st.bought).toBeCloseTo(1, 6);
    expect(st.buyAvg).toBeCloseTo(2.8, 2);
    expect(st.sellAvg).toBeCloseTo(4.84, 2);
    const rt = leaseTrades(res.flow, curveDaily(100));
    expect(rt.buyAvg).toBeCloseTo(2.81, 2);
    expect(rt.sellAvg).toBeCloseTo(4.55, 2);
    expect(LEASE_DEFAULTS).toEqual({ lease: 'salt', level: 100, fee: 0.05 });
  });

  it('makes storage space worth more when the region starts the year with more gas', () => {
    expect(leaseIntrinsic('salt', LEVEL_MIN).value / 1e6).toBeCloseTo(1.794, 2);
    expect(leaseIntrinsic('salt', LEVEL_MAX).value / 1e6).toBeCloseTo(2.411, 2);
    for (let l = LEVEL_MIN + 10; l <= LEVEL_MAX; l += 10) expect(leaseIntrinsic('salt', l).value).toBeGreaterThan(leaseIntrinsic('salt', l - 10).value);
  });

  it('solves the first challenge at 120% of plan and nowhere else', () => {
    expect(leaseIntrinsic('salt', 110).value).toBeLessThan(LEVEL_TARGET);
    expect(leaseIntrinsic('salt', 120).value).toBeGreaterThanOrEqual(LEVEL_TARGET);
    expect(levelChallengeSolved({ lease: 'salt', level: 120, fee: 0.05 })).toBe(true);
    expect(levelChallengeSolved({ lease: 'salt', level: 130, fee: 0.05 })).toBe(false);
    expect(levelChallengeSolved({ lease: 'salt', level: 110, fee: 0.05 })).toBe(false);
    expect(levelChallengeSolved({ lease: 'reservoir', level: 120, fee: 0.05 })).toBe(false);
    expect(levelChallengeSolved({ lease: 'salt', level: 120, fee: 0.1 })).toBe(false);
  });

  it('finds the extrinsic value with perfect foresight: large for salt, small for the reservoir', () => {
    const saltPF = leasePerfectValues('salt');
    const resPF = leasePerfectValues('reservoir');
    expect(saltPF).toHaveLength(LEASE_YEARS);
    expect(avg(saltPF) / 1e6).toBeCloseTo(2.751, 2);
    expect(avg(resPF) / 1e6).toBeCloseTo(1.773, 2);
    expect(Math.round((avg(saltPF) / leaseIntrinsic('salt').value - 1) * 100)).toBe(36);
    expect(Math.round((avg(resPF) / leaseIntrinsic('reservoir').value - 1) * 100)).toBe(5);
    expect(Math.min(...saltPF) / 1e6).toBeCloseTo(1.68, 2);
    expect(Math.max(...saltPF) / 1e6).toBeCloseTo(4.49, 2);
  });

  it('never lets a fixed schedule beat perfect foresight', () => {
    for (const id of ['salt', 'reservoir'] as const) {
      const plan = leaseIntrinsic(id).flow;
      leaseSpotPaths().forEach((p, i) => expect(leasePerfect(id, i + 1).value).toBeGreaterThanOrEqual(scheduleValue(plan, p) - 1));
    }
  });

  it('shows years when even perfect foresight falls short of the hedge, and solves the second challenge in them', () => {
    const intr = leaseIntrinsic('salt').value;
    const below = leasePerfectValues('salt').map((v, i) => (v < intr ? i + 1 : 0)).filter(Boolean);
    expect(below).toEqual([7, 14, 21, 22]);
    expect(leasePerfectValues('reservoir').filter((v) => v < leaseIntrinsic('reservoir').value)).toHaveLength(11);
    expect(hedgeYearSolved({ lease: 'salt', year: 7 })).toBe(true);
    expect(hedgeYearSolved({ lease: 'salt', year: 1 })).toBe(false);
    expect(hedgeYearSolved({ lease: 'reservoir', year: 7 })).toBe(false);
    expect(SCENARIO_DEFAULTS).toEqual({ lease: 'salt', year: 1 });
    const unhedged = leaseUnhedged('salt');
    expect(Math.round(Math.min(...unhedged) / 1000)).toBe(681);
    expect(Math.max(...unhedged) / 1e6).toBeCloseTo(3.54, 2);
    expect(avg(unhedged) / intr).toBeCloseTo(1, 1);
  });
});

describe('gas 5.3', () => {
  const gasSet = (id: string | null) => !!id && COST_RECIPE[id]?.fuel === 'gas';

  it('starts at the electricity course’s $5 gas, where Mill Creek sets $42 at 19:00 and gas sets 8 hours', () => {
    expect(G2P_DEFAULTS).toEqual({ gas: 5, hour: 19 });
    const day = powerDay(5);
    expect(g2pHour(5, 19).price).toBeCloseTo(42, 9);
    expect(g2pHour(5, 19).marginal).toBe('cc2');
    expect(day.hours.filter((h) => gasSet(h.marginal)).length).toBe(8);
    expect(day.hours.filter((h) => h.marginal === 'cc1').length).toBe(6);
    expect(day.hours.filter((h) => h.marginal === 'cc2').map((h) => h.hour)).toEqual([18, 19]);
    expect(powerDay(3).hours.filter((h) => gasSet(h.marginal)).length).toBe(21);
    expect(day.energy.cc1).toBeCloseTo(1913, 6);
  });

  it('quotes Lakeside’s spark spread and the implied heat rates at $5', () => {
    expect(lakesideSpark(5, 19)).toBeCloseTo(6, 9);
    expect(impliedHeatRate(g2pHour(5, 19).price, 5)).toBeCloseTo(8.4, 9);
    expect(impliedHeatRate(powerDay(5).avgPrice, 5)).toBeCloseTo(6.36, 2);
  });

  it('solves the spark-spread challenge only at $10.00', () => {
    expect(SPARK_TARGET).toBe(12);
    const answers: number[] = [];
    for (let i = 0; i <= 210; i++) {
      const g = Math.round((1.5 + i * 0.05) / 0.05) * 0.05;
      if (sparkTargetSolved({ gas: g, hour: 19 })) answers.push(g);
    }
    expect(answers).toEqual([10]);
    expect(sparkTargetSolved({ gas: 10, hour: 18 })).toBe(false);
  });

  it('derives the power plants’ demand for gas: 65,478 MMBtu a day when cheap, 12,690 above $3.75', () => {
    expect(G2P_BURN_SWEEP[0].mmbtu).toBeCloseTo(65477.7, 1);
    expect(G2P_BURN_SWEEP[G2P_BURN_SWEEP.length - 1].mmbtu).toBeCloseTo(12689.7, 1);
    expect(G2P_BURN_SWEEP[0].mmbtu / G2P_BURN_SWEEP[G2P_BURN_SWEEP.length - 1].mmbtu).toBeCloseTo(5.2, 1);
    expect(G2P_SWITCHES.map((s) => Math.round(s.gas * 100) / 100)).toEqual([2.11, 2.5, 3.16, 3.75]);
    for (let i = 1; i < G2P_BURN_SWEEP.length; i++) expect(G2P_BURN_SWEEP[i].mmbtu).toBeLessThanOrEqual(G2P_BURN_SWEEP[i - 1].mmbtu + 1e-9);
  });

  it('carries Metro’s cold-day gas price into the power price, capped by oil at $15', () => {
    expect(G2P_COLD_DEFAULTS).toEqual({ temp: 28 });
    const normal = coldDayG2P(28);
    expect(normal.metro).toBeCloseTo(4.09, 2);
    expect(normal.p19).toBeCloseTo(35.1, 1);
    expect(coldDayG2P(13).metro).toBeCloseTo(normal.metro, 9);
    expect(coldDayG2P(12).metro).toBeCloseTo(4.5, 9);
    const oil = coldDayG2P(8);
    expect(oil.metro).toBeCloseTo(OIL_SWITCH_VALUE, 9);
    expect(oil.p19).toBeCloseTo(118, 9);
    expect(oil.p19 / normal.p19).toBeGreaterThan(3);
    expect(Math.round(normal.lakeMargin)).toBe(3929);
    expect(Math.round(oil.lakeMargin)).toBe(14400);
    expect(coldDayG2P(9).p19).toBeCloseTo(64.8, 9);
    expect(COLD_POWER_ANSWER).toBe(8);
    expect(coldPowerSolved(8)).toBe(true);
    expect(coldPowerSolved(7)).toBe(false);
    expect(coldPowerSolved(9)).toBe(false);
  });
});

describe('gas 5.4', () => {
  const D = traderMonths(TRADER_DEFAULTS);
  const S = traderSummary(D);

  it('sends the two years’ cargoes to the better netback, some at a loss and none cancelled', () => {
    expect(CARGO_MMBTU).toBe(3_825_000);
    expect(CANCEL_COST).toBeCloseTo(9_562_500, 6);
    expect([S.europe, S.asia, S.cancelled, S.atLoss]).toEqual([10, 14, 0, 8]);
    expect(S.result / 1e6).toBeCloseTo(90.3, 1);
    expect(S.resultCancelEveryLoss / 1e6).toBeCloseTo(28.9, 1);
  });

  it('quotes the first months and the sunk-fee example', () => {
    expect(D[0].choice.best).toBe('europe');
    expect(D[0].asia - D[0].europe).toBeCloseTo(0.63, 2);
    expect(D[0].choice.netback.europe).toBeCloseTo(10.73, 2);
    expect(D[1].choice.best).toBe('asia');
    expect(D[1].asia).toBeCloseTo(15.08, 2);
    const sep = D[8].choice;
    expect(sep.best).toBe('europe');
    expect(sep.netback.europe).toBeCloseTo(4.8, 2);
    expect(sep.fob).toBeCloseTo(5.87, 2);
    expect(sep.margin).toBeCloseTo(-1.07, 2);
    expect(sep.marginFeeSunk).toBeCloseTo(1.43, 2);
    expect(sep.cancel).toBe(false);
    expect(asiaPremium(9)).toBeCloseTo(0.76, 2);
  });

  it('starts cancelling cargoes at 75% of the simulated prices, and the challenge is solved only there', () => {
    expect(FIRST_CANCEL_LEVEL).toBe(75);
    expect(traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: 75 })).cancelled).toBe(2);
    expect(traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: 80 })).cancelled).toBe(0);
    expect(traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: 60 })).cancelled).toBe(14);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 75 })).toBe(true);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 70 })).toBe(false);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 75, charter: 100_000 })).toBe(false);
  });

  it('caps Calder at the netback ÷ 1.15 and pins it there when overseas prices fall', () => {
    const h9 = homeStats(9);
    expect(h9.cap).toBeCloseTo(6.09, 2);
    expect(h9.calderMax).toBeCloseTo(h9.cap, 6);
    expect(h9.cutDays).toBe(2);
    expect(h9.calderAvg.toFixed(2)).toBe(homeBase().calderAvg.toFixed(2));
    const h6 = homeStats(6);
    expect(h6.cap).toBeCloseTo(3.58, 2);
    expect([h6.cutDays, h6.summerCut]).toEqual([47, 0]);
    expect(h6.calderAvg).toBeCloseTo(3.3, 2);
    const h4 = homeStats(4);
    expect(h4.cap).toBeCloseTo(1.91, 2);
    expect(h4.cutDays).toBe(105);
    expect(h4.calderAvg).toBeCloseTo(1.82, 2);
    expect(h4.calderMax).toBeCloseTo(1.97, 2);
    const h3 = homeStats(3);
    expect(h3.lngAvg).toBeLessThan(1e-9);
    expect(h3.calderAvg).toBeCloseTo(1.36, 2);
  });

  it('first cuts the terminal in summer at $5.50 in Asia, and the challenge is solved only there', () => {
    expect(firstSummerCut()).toBe(5.5);
    expect(homeStats(5.5).summerCut).toBe(24);
    expect(homeStats(5.5).cap).toBeCloseTo(3.16, 2);
    expect(homeStats(6).summerCut).toBe(0);
    expect(summerCutSolved(5.5)).toBe(true);
    expect(summerCutSolved(5)).toBe(false);
    expect(summerCutSolved(6)).toBe(false);
  });
});

describe('gas 5.5', () => {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const FREEZE = { ...CRISIS_DEFAULTS, freeze: WORST_STORM.freeze };
  const OUTAGE = { ...FREEZE, northline: WORST_STORM.northline };
  const WORST = { ...OUTAGE, temp: WORST_STORM.temp };

  it('handles the cold alone with oil switching: Metro at $15, no one rationed, Calder creeping up', () => {
    const s = crisisStats(CRISIS_DEFAULTS);
    expect(s.peakMetro).toBeCloseTo(15, 6);
    expect(s.rationedBcf).toBeLessThan(1e-6);
    const run = crisisRun(CRISIS_DEFAULTS);
    const day1 = run[STORM_LEAD];
    const gw = giveWay(day1, CRISIS_DEFAULTS);
    expect(r2(gw.oil)).toBe(0.26);
    expect(r2(gw.industry)).toBe(0.08);
    expect(day1.flow['calder-metro']).toBeCloseTo(1.8, 6);
    expect(r2(-day1.storageFlow.hollowcreek)).toBe(0.82);
    expect(r2(run[STORM_LEAD - 1].price.calder)).toBe(3.9);
    expect(r2(run[STORM_LEAD + STORM_DAYS - 1].price.calder)).toBe(4.51);
  });

  it('lets LNG give way when the wells freeze, leaving Metro no worse off', () => {
    const s = crisisStats(FREEZE);
    expect(r2(s.peakCalder)).toBe(6.46);
    expect(r2(s.lngGivenUp)).toBe(3.85);
    expect(r2(giveWay(crisisRun(FREEZE)[STORM_LEAD], FREEZE).lng)).toBe(0.77);
    expect(s.peakMetro).toBeCloseTo(15, 6);
    expect(s.rationedBcf).toBeLessThan(1e-6);
  });

  it('climbs to $20 with Northline out and to rationing when colder still', () => {
    const o = crisisStats(OUTAGE);
    expect(o.peakMetro).toBeCloseTo(20, 6);
    expect(r2(giveWay(crisisRun(OUTAGE)[STORM_LEAD], OUTAGE).oil)).toBe(0.63);
    const w = crisisStats(WORST);
    expect(w.peakMetro).toBeCloseTo(100, 6);
    expect(r2(w.rationedBcf)).toBe(1.22);
    expect(w.rationDays).toBe(5);
    expect(r2(giveWay(crisisRun(WORST)[STORM_LEAD], WORST).homes)).toBe(0.23);
  });

  it('weighs the defenses against the worst storm', () => {
    expect(r2(crisisStats({ ...WORST, freeze: 0 }).rationedBcf)).toBe(1.22);
    expect(crisisStats({ ...WORST, northline: 1.8 }).rationedBcf).toBeLessThan(1e-6);
    const hold = crisisStats({ ...WORST, lngHold: true });
    expect(r2(hold.rationedBcf)).toBe(1.84);
    expect(r2(hold.peakCalder)).toBe(99.85);
    expect(r2(crisisStats({ ...WORST, when: 'dec' }).rationedBcf)).toBe(0.25);
    expect(r2(crisisStats({ ...WORST, when: 'mar' }).rationedBcf)).toBe(2.31);
    expect(r2(crisisStats({ ...WORST, when: 'mar', northline: 1.8 }).rationedBcf)).toBe(0.42);
    const s = crisisStats(WORST);
    expect(Math.round(s.hollowAtStorm)).toBe(67);
    expect(r2(withdrawCapacity(STORAGE_SPECS.hollowcreek, s.hollowAtStorm))).toBe(0.82);
  });

  it('solves the Northline challenge at 1.70 Bcf/d and nowhere else', () => {
    expect(northlineNeeded()).toBeCloseTo(1.7, 9);
    const base = { ...NORTHLINE_CHALLENGE, day: 6 };
    expect(stormNorthlineSolved({ ...base, northline: 1.7 })).toBe(true);
    expect(stormNorthlineSolved({ ...base, northline: 1.65 })).toBe(false);
    expect(stormNorthlineSolved({ ...base, northline: 1.75 })).toBe(false);
    expect(stormNorthlineSolved({ ...base, northline: 1.7, freeze: 0 })).toBe(false);
    expect(r2(crisisStats({ ...NORTHLINE_CHALLENGE, northline: 1.65 }).rationedBcf)).toBe(0.01);
  });

  it('solves the March challenge at −10 °F with every defense', () => {
    expect(warmestRationing()).toBe(-10);
    const base = { ...EVERY_DEFENSE, day: 6 };
    expect(marchDefenseSolved({ ...base, temp: -10 })).toBe(true);
    expect(marchDefenseSolved({ ...base, temp: -9 })).toBe(false);
    expect(marchDefenseSolved({ ...base, temp: -11 })).toBe(false);
    expect(crisisStats({ ...EVERY_DEFENSE, temp: -9 }).rationedBcf).toBeLessThan(1e-6);
    expect(crisisStats({ ...EVERY_DEFENSE, temp: -10 }).rationedBcf).toBeGreaterThan(0.05);
  });
});

describe('gas chapter 6: history, futures and forecasts', () => {
  it('runs eight years with storage carried from one March to the next April', () => {
    const h = gasHistory();
    expect(h).toHaveLength(HISTORY_YEARS);
    for (let y = 1; y < h.length; y++) expect(h[y].start).toEqual(h[y - 1].days[364].storage);
    expect(h.every((y) => y.days.length === 365 && y.plans.length === 12)).toBe(true);
    // The history never rations protected demand.
    expect(h.every((y) => y.days.every((d) => d.rationed < 1e-6))).toBe(true);
  });

  it('grows Ridgeback until it outruns its pipes in year 5, and the expansion clears it', () => {
    expect(ridgebackTakeaway(conditionsOf(3))).toBeGreaterThan(conditionsOf(3).ridgeback);
    expect(ridgebackTakeaway(conditionsOf(4))).toBeLessThan(conditionsOf(4).ridgeback);
    expect(ridgebackTakeaway(conditionsOf(5))).toBeGreaterThan(conditionsOf(5).ridgeback);
    const basis = (y: number) => gasHistory()[y].days.reduce((s, d) => s + d.price.ridgeback - d.price.calder, 0) / 365;
    expect(basis(3)).toBeCloseTo(-0.12, 2);
    expect(basis(4)).toBeLessThan(-1.5);
    expect(basis(5)).toBeCloseTo(-0.12, 2);
  });

  it('keeps a spring reserve in plans drawn after April', () => {
    const p = planFrom(7, { saltflat: 30, hollowcreek: 120 }, conditionsOf(0), gasHistory()[0].plan);
    const marchEnd = 12 - 7;
    expect(p.inventory.saltflat[marchEnd] + 1e-6).toBeGreaterThanOrEqual(END_OF_WINTER.saltflat);
    expect(p.inventory.hollowcreek[marchEnd] + 1e-6).toBeGreaterThanOrEqual(END_OF_WINTER.hollowcreek);
  });

  it('prices futures that were right on average at every lead', () => {
    const N = historyMonths();
    for (const lead of [0, 1, 3, 6, 11]) {
      let s = 0;
      let n = 0;
      for (let d = lead; d < N; d++) {
        s += (lead === 0 ? monthAverage(d, 'calder') : settlement(d)) - futuresCurveAt(d - lead).calder[d];
        n++;
      }
      expect(Math.abs(s / n)).toBeLessThan(1e-9);
    }
    // A contract's path ends at its settlement.
    const path = contractPath(33);
    expect(path).toHaveLength(12);
    expect(path[path.length - 1].price).toBe(settlement(33));
    expect(monthLabel(33)).toBe('Jan Y3');
  });

  it('quotes Ridgeback basis from the region as it stands: blind to year 5 a year ahead, sure of it once it arrives', () => {
    // On March 1 of year 4, the curve's year-5 months still show the tariff.
    expect(futuresCurveAt(47).ridgebackBasis[50]).toBeCloseTo(-0.12, 2);
    // On April 1 of year 5 they show the glut, and a year later still (before the expansion).
    expect(futuresCurveAt(48).ridgebackBasis[50]).toBeLessThan(-0.8);
    expect(futuresCurveAt(59).ridgebackBasis[62]).toBeLessThan(-0.8);
    expect(monthAverage(62, 'ridgeback', 'calder')).toBeCloseTo(-0.12, 2);
  });

  it('forecasts with skill that fades with lead time', () => {
    expect(forecastSkill(0.9, 0)).toBeCloseTo(0.9, 9);
    expect(forecastSkill(0.9, SKILL_DECAY_DAYS)).toBeCloseTo(0.9 / Math.E, 9);
    const w = gasHistory()[2].weather;
    // No skill: the forecast is the normal temperature.
    expect(forecastTemps(w, 214, 14, 0)).toEqual(w.normal.slice(214, 228));
    // Perfect skill on the first day is nearly the truth; the error grows with lead.
    const errs = (skill: number, h: number) => {
      let s = 0;
      for (let k = 0; k < 60; k++) {
        const wy = weatherYear(9000 + k);
        const f = forecastTemps(wy, 200, 14, skill, k)[h - 1];
        s += (f - wy.temp[200 + h - 1]) ** 2;
      }
      return Math.sqrt(s / 60);
    };
    expect(errs(1, 1)).toBeLessThan(errs(1, 14));
    expect(errs(0.9, 7)).toBeLessThan(errs(0, 7));
  });

  it('forecasts the rest of winter with a spread that narrows as winter passes', () => {
    const nov = forecastFundamentals(0, 214, { skill: 0.9 });
    const feb = forecastFundamentals(0, 306, { skill: 0.9 });
    expect(nov.members).toHaveLength(8);
    expect(nov.endHigh - nov.endLow).toBeGreaterThan(feb.endHigh - feb.endLow);
    expect(remainingHddError(214, 0)).toBeGreaterThan(remainingHddError(306, 0));
    expect(remainingHddError(306, 0.9)).toBeLessThan(remainingHddError(306, 0));
  });
});

describe('gas chapter 6: strategies', () => {
  it('sets margins from the history and books a futures trade to its settlement', () => {
    const m = marginRates();
    expect(m.futures).toBeGreaterThan(5000);
    expect(m.futures % 500).toBe(0);
    const costs = { futuresFee: 0, basisFee: 0, futuresMargin: m.futures, basisMargin: m.basis };
    const r = runBook([{ entry: 24, legs: [{ kind: 'futures', delivery: 33, lots: 2 }] }], costs);
    expect(r.total).toBeCloseTo(2 * LOT_MMBTU * (settlement(33) - futuresCurveAt(24).calder[33]), 4);
    expect(r.margin[24]).toBe(2 * m.futures);
    expect(r.margin[33]).toBe(0);
    // Fees come off each side.
    const withFees = runBook([{ entry: 24, exit: 30, legs: [{ kind: 'futures', delivery: 33, lots: 1 }] }], { ...costs, futuresFee: 0.01 });
    expect(withFees.totalFees).toBeCloseTo(2 * LOT_MMBTU * 0.01, 6);
  });

  it('settles index gas against the month and basis swaps against realized basis', () => {
    const zero = { futuresFee: 0, basisFee: 0, futuresMargin: 0, basisMargin: 0 };
    const idx = runBook([{ entry: 34, legs: [{ kind: 'index', delivery: 34, lots: -1 }] }], zero);
    expect(idx.total).toBeCloseTo(-LOT_MMBTU * (monthAverage(34, 'calder') - settlement(34)), 4);
    const b = runBook([{ entry: 30, legs: [{ kind: 'basis', place: 'metro', delivery: 33, mmbtuPerDay: 10000 }] }], zero);
    expect(b.total).toBeCloseTo(10000 * daysIn(33) * (monthAverage(33, 'metro', 'calder') - futuresCurveAt(30).metroBasis[33]), 3);
    expect(tradeable({ entry: 30, legs: [{ kind: 'index', delivery: 31, lots: 1 }] })).toBe(false);
  });

  it('earns nothing on average from trading every year without information', () => {
    const zero = { futuresFee: 0, basisFee: 0, futuresMargin: 0, basisMargin: 0 };
    // Metro's winter basis sold every year: the premium pays exactly for the blowouts.
    expect(Math.abs(runBook(metroBasisTrades({ lead: 3, mmbtuPerDay: -10000 }), zero).total)).toBeLessThan(1);
  });

  it('pays for weather forecast skill', () => {
    const none = weatherSignals(0);
    expect(none.every((s) => Math.abs(s.forecastColder) < 1e-9)).toBe(true);
    const low = runBook(weatherTrades({ skill: 0.3, thresholdF: 0, lots: 10 })).total;
    const high = runBook(weatherTrades({ skill: 0.9, thresholdF: 0, lots: 10 })).total;
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(0);
  });

  it('turns a correct production hypothesis into Ridgeback basis profits', () => {
    const right = runBook(ridgebackTrades({ growth: 0.12, expansion: true }, { lead: 6, threshold: 0.25, mmbtuPerDay: 10000 }));
    const flat = runBook(ridgebackTrades({ growth: 0, expansion: false }, { lead: 6, threshold: 0.25, mmbtuPerDay: 10000 }));
    expect(right.total).toBeGreaterThan(1e6);
    expect(flat.total).toBeLessThan(right.total);
    expect(hypothesizedConditions({ growth: 0.12, expansion: true }, 4, 5).ridgebackExpress).toBeCloseTo(2.6, 9);
  });

  it('picks calendar spreads from storage and tracks them to the first settlement', () => {
    const s = spreadSignals({ entryCal: 7, longCal: 11, shortCal: 0, lots: 1, rule: 'always', thresholdBcf: 0 });
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({ entry: 7, longDelivery: 11, shortDelivery: 12, exit: 11 });
    const behind = spreadSignals({ entryCal: 7, longCal: 11, shortCal: 0, lots: 1, rule: 'behind', thresholdBcf: 12 });
    expect(behind.filter((x) => x.traded).every((x) => x.vsPlan <= -12)).toBe(true);
    expect(nextOf(7, 0)).toBe(12);
  });

  it('values storage, pipes and a power plant against the April curve and the year', () => {
    const st = storageAsset(0.1);
    expect(st).toHaveLength(8);
    // Rolling intrinsic, hedged, never earns less than the April intrinsic value by much.
    expect(st.every((a) => a.hedged > a.forward * 0.97)).toBe(true);
    const north = transportAsset('northline', 50000);
    const avgForward = north.reduce((s, a) => s + a.forward, 0) / 8;
    const avgRealized = north.reduce((s, a) => s + a.realized, 0) / 8;
    expect(avgRealized).toBeGreaterThan(avgForward * 0.8);
    const express = transportAsset('express', 50000);
    expect(express[4].realized).toBeGreaterThan(1e7);
    expect(express[3].realized).toBeLessThan(1);
    expect(lakesideMargin(3)).toBeCloseTo(powerDay(3).margin.cc1, 6);
    expect(powerAsset().every((a) => a.realized > 0)).toBe(true);
    const opt = monthlyStorageOptimum([2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4], leasedStorage(0.1), { startCal: 0, start: 0.75, end: 0.75 });
    expect(opt.value).toBeGreaterThan(0);
    expect(opt.moves.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
  });
});

describe('gas 6.1', () => {
  it('quotes the demand added by a heating degree day', () => {
    const total = (t: number) => demandBlocks(t).reduce((s, b) => s + b.cap, 0);
    expect((total(30) - total(40)) / 10).toBeCloseTo(0.0535, 6);
  });

  it('opens on an ordinary winter the forecast gets about right', () => {
    const sur = forecasterSurprises();
    expect(sur).toHaveLength(8);
    // Year 3 is the coldest winter, Year 6 close to normal.
    expect(Math.max(...sur.map((s) => s[0]))).toBe(sur[2][0]);
    expect(Math.abs(sur[5][0])).toBeLessThan(100);
    const base = forecasterRun(FORECASTER_DEFAULTS.year, FORECASTER_DEFAULTS.day, FORECASTER_DEFAULTS.skill);
    expect(base.members).toHaveLength(FORECAST_MEMBERS);
    expect(base.endActual).toBeGreaterThanOrEqual(base.endLow);
    expect(base.endActual).toBeLessThanOrEqual(base.endHigh);
    // Skill barely moves the end of March from November 1.
    expect(Math.abs(forecasterRun(5, WINTER_START, 0).endMean - forecasterRun(5, WINTER_START, 1).endMean)).toBeLessThan(2);
  });

  it('misses Year 3 from November and catches it by March', () => {
    const nov = forecasterRun(2, WINTER_START, FORECASTER_DEFAULTS.skill);
    expect(nov.endActual).toBeLessThan(nov.endLow);
    const mar = forecasterRun(2, GAS_MONTH_START[11], FORECASTER_DEFAULTS.skill);
    expect(mar.endActual).toBeGreaterThanOrEqual(mar.endLow);
    expect(mar.endActual).toBeLessThanOrEqual(mar.endHigh);
    expect(mar.endHigh - mar.endLow).toBeLessThan(nov.endHigh - nov.endLow);
  });

  it('finds storage absorbing about half of a degree day, and the price the rest', () => {
    const f = forecasterRun(0, WINTER_START, 0);
    const perHdd = forecasterStoragePerHdd(f);
    expect(perHdd).toBeGreaterThan(0.02);
    expect(perHdd).toBeLessThan(0.035);
    expect(forecasterPricePerHdd(f)).toBeGreaterThan(0);
  });

  it('makes the cold spell of January 1, Year 3 the challenge, solved at the least skill within 50 cents', () => {
    const spell = forecasterTwoWeeks(forecasterRun(COLD_SPELL.year, COLD_SPELL.day, 0));
    expect(spell.normalTemp - spell.actTemp).toBeGreaterThan(15);
    const answer = coldSpellAnswer();
    expect(answer).toBeCloseTo(0.9, 9);
    expect(coldSpellMiss(answer)).toBeLessThanOrEqual(PRICE_TOLERANCE);
    expect(forecasterSolved({ year: COLD_SPELL.year, day: COLD_SPELL.day, skill: answer })).toBe(true);
    expect(forecasterSolved({ year: COLD_SPELL.year, day: COLD_SPELL.day, skill: 0.95 })).toBe(false);
    expect(forecasterSolved({ year: COLD_SPELL.year, day: COLD_SPELL.day, skill: 0.85 })).toBe(false);
    expect(forecasterSolved({ ...FORECASTER_DEFAULTS, skill: answer })).toBe(false);
  });

  it('shows the miss shrinking as winter passes, and skill paying only over two weeks', () => {
    const rest0 = forecasterRestError(0);
    const at = (d: number) => rest0[WEEKS.indexOf(d)];
    expect(WEEKS).toContain(GAS_MONTH_START[10]);
    expect(at(WINTER_START)).toBeGreaterThan(at(GAS_MONTH_START[10]));
    expect(at(GAS_MONTH_START[10])).toBeGreaterThan(at(GAS_MONTH_START[11]));
    expect(at(WINTER_START)).toBeGreaterThan(180);
    const rest8 = forecasterRestError(0.8);
    expect(Math.abs(rest8[0] - rest0[0]) / rest0[0]).toBeLessThan(0.05);
    expect(forecasterTwoWeekError(GAS_MONTH_START[9], 0.8)).toBeLessThan(forecasterTwoWeekError(GAS_MONTH_START[9], 0));
    expect(ERROR_YEARS).toBe(120);
    // Year 3 began its winter more than two typical misses colder than normal.
    expect(forecasterSurprises()[2][0] / rest0[0]).toBeGreaterThan(2);
  });
});

describe('gas 6.2', () => {
  it('trades March/April in seven winters and January/October in eight', () => {
    expect(traderSignals('marApr')).toHaveLength(7);
    expect(traderSignals('janOct')).toHaveLength(8);
    expect(SPREAD_TRADER_DEFAULTS).toEqual({ spread: 'marApr', year: 2, side: 'buy', lots: 10 });
  });

  it('follows Year 3 and Year 4 as the prose says', () => {
    const y3 = traderSignal('marApr', 2);
    expect(y3.atEntry).toBeCloseTo(2.69, 2);
    expect(futuresCurveAt(y3.entry).calder[y3.longDelivery]).toBeCloseTo(4.14, 2);
    expect(futuresCurveAt(y3.entry).calder[y3.shortDelivery]).toBeCloseTo(1.45, 2);
    expect(futuresCurveAt(y3.exit).calder[y3.longDelivery]).toBeCloseTo(6.15, 2);
    expect(futuresCurveAt(y3.exit).calder[y3.shortDelivery]).toBeCloseTo(1.74, 2);
    expect(y3.atExit).toBeCloseTo(4.41, 2);
    expect(Math.abs(traderCold(2, GAS_MONTH_START[7], GAS_MONTH_START[9]))).toBeLessThan(20);
    const ma = traderWinters('marApr');
    expect(ma[2].cold).toBeCloseTo(431, 0);
    expect(Math.round(traderBook('marApr', 2, 'buy', 10).total)).toBe(171934);
    expect(ma[3].cold).toBeCloseTo(-431, 0);
    expect(ma[3].gapExit).toBeCloseTo(16.8, 1);
    expect(ma[3].signal.atExit).toBeCloseTo(0.06, 2);
    expect(Math.round(traderBook('marApr', 3, 'buy', 10).total)).toBe(-205768);
    // Selling is the mirror image, less the same fees twice.
    expect(traderBook('marApr', 3, 'sell', 10).total).toBeCloseTo(205768 - 2 * 300, 0);
  });

  it('widens in every colder-than-normal winter and narrows in every milder one, whatever November storage said', () => {
    const ma = traderWinters('marApr');
    expect(traderFollowsWeather('marApr')).toBe(true);
    expect(ma.filter((w) => w.cold > 0).map((w) => w.year)).toEqual([0, 2, 4]);
    expect(ma.every((w) => w.gapEntry < 0)).toBe(true);
    expect(Math.min(...ma.map((w) => -w.gapEntry))).toBeCloseTo(1.6, 1);
    expect(Math.max(...ma.map((w) => -w.gapEntry))).toBeCloseTo(15.7, 1);
    const byGap = [...ma].sort((a, b) => a.gapEntry - b.gapEntry);
    expect([byGap[0].year, byGap[1].year]).toEqual([0, 6]);
    expect(byGap[0].change).toBeCloseTo(0.43, 2);
    expect(byGap[1].change).toBeCloseTo(-1.39, 2);
    const jo = traderWinters('janOct');
    expect(Math.min(...jo.map((w) => w.change))).toBeCloseTo(-0.79, 2);
    expect(Math.max(...jo.map((w) => w.change))).toBeCloseTo(0.64, 2);
    expect(Math.min(...ma.map((w) => w.change))).toBeCloseTo(-2.05, 2);
    expect(Math.max(...ma.map((w) => w.change))).toBeCloseTo(1.72, 2);
  });

  it('loses buying every November, and the storage rule only wins at a lucky threshold', () => {
    const always = ruleBookFor('always', 0);
    expect(Math.round(always.total)).toBe(-106576);
    expect(Math.round(always.totalFees)).toBe(2100);
    const best = bestRuleThresholds();
    expect(best.thresholds).toEqual([11, 12]);
    expect(Math.round(best.total)).toBe(68024);
    expect(ruleYears('behind', 11)).toEqual([0, 1, 2, 6]);
    expect(Math.round(ruleBookFor('behind', 10).total)).toBe(-137744);
    expect(ruleYears('behind', 10)).toEqual([0, 1, 2, 3, 6]);
    expect(Math.round(ruleBookFor('behind', 13).total)).toBe(-103910);
    expect(ruleYears('behind', 13)).toEqual([0, 1, 6]);
  });

  it('solves the challenge only at the best threshold', () => {
    expect(spreadTraderSolved(SPREAD_RULE_DEFAULTS)).toBe(false);
    expect(spreadTraderSolved({ rule: 'behind', threshold: 11 })).toBe(true);
    expect(spreadTraderSolved({ rule: 'behind', threshold: 12 })).toBe(true);
    expect(spreadTraderSolved({ rule: 'behind', threshold: 10 })).toBe(false);
    expect(spreadTraderSolved({ rule: 'always', threshold: 11 })).toBe(false);
  });
});

describe('gas 6.3', () => {
  it('trades nothing on the market’s own hypothesis', () => {
    const r = basisDeskRun(BASIS_DESK_DEFAULTS);
    expect(r.book.trades).toHaveLength(0);
    expect(r.signals.every((s) => Math.abs(s.view - s.forward) < 1e-9)).toBe(true);
  });

  it('quotes the market blind to Year 5’s glut and to Year 6’s expansion', () => {
    const n = basisDeskNumbers();
    expect(n.takeaway).toBeCloseTo(3.05, 9);
    expect(n.takeawayAfter).toBeCloseTo(3.55, 9);
    expect(n.prod(3)).toBeCloseTo(2.96, 9);
    expect(n.prod(4)).toBeCloseTo(3.08, 9);
    expect(n.fwdJanY5).toBeCloseTo(-0.12, 2);
    expect(n.realJanY5).toBeLessThan(-4.5);
    expect(n.y5Avg).toBeCloseTo(-2.52, 1);
    expect(n.fwdJanY6).toBeLessThan(-3);
    expect(n.realJanY6).toBeCloseTo(-0.12, 2);
  });

  it('sees the glut from 0.10 Bcf/d a year of growth, and solves the challenge there', () => {
    expect(leastGlutGrowth()).toBeCloseTo(0.1, 9);
    expect(viewsYearFiveGlut(0.08)).toBe(false);
    expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: 0.1 })).toBe(true);
    expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: 0.08 })).toBe(false);
    expect(basisDeskSolved({ ...BASIS_DESK_DEFAULTS, growth: 0.12 })).toBe(false);
  });

  it('earns on the glut and the expansion, more the earlier it trades', () => {
    const n = basisDeskNumbers();
    expect(n.atLeastTrades).toBe(6);
    expect(n.atLeastFirst?.delivery).toBe(48);
    expect(n.atLeastLast?.delivery).toBe(53);
    expect(n.atLeastTotal).toBeGreaterThan(1.8e6);
    expect(n.atLeastTotal).toBeLessThan(1.9e6);
    expect(n.withExpTrades).toBe(12);
    expect(n.withExpTotal).toBeGreaterThan(4.5e6);
    expect(n.expOnlyPnl).toBeGreaterThan(2.7e6);
    expect(n.expBuyLow).toBeLessThan(-3.5);
    expect(n.expBuyHigh).toBeCloseTo(-1.13, 2);
    expect(n.lead11Total).toBeGreaterThan(15e6);
    expect(n.lead1Total).toBeLessThan(1e6);
    const run = basisDeskRun({ ...BASIS_DESK_DEFAULTS, growth: 0.1, expansion: true });
    expect(run.book.trades.every((o) => o.pnl > 0)).toBe(true);
  });

  it('loses only the fees selling basis at the cost of the trip in a year without a glut', () => {
    const n = basisDeskNumbers();
    expect(n.eagerEarlyCount).toBe(6);
    expect(n.eagerEarlyPnl).toBeCloseTo(-18300, 0);
    expect(n.feePerMonth).toBeCloseTo(3100, 6);
    // The view never rises above the cost of the trip to Calder.
    expect(basisDeskSignals({ growth: GROWTH_MAX, expansion: true }, 11, 0.05).every((s) => s.view <= -0.12 + 1e-9)).toBe(true);
  });

  it('sells Metro’s winter basis at a fair premium, and profits from forecast skill', () => {
    const n = basisDeskNumbers();
    expect(n.metroFwd[0]).toBeCloseTo(0.3, 2);
    expect(n.metroFwd[1]).toBeCloseTo(0.74, 2);
    expect(n.metroFwd[2]).toBeCloseTo(0.42, 2);
    expect(Math.abs(n.everyGross)).toBeLessThan(1);
    expect(n.everyTotal).toBeCloseTo(-72000, -2);
    expect(n.calmWinter).toBeCloseTo(293000, -3);
    expect(n.jan3Pnl).toBeLessThan(-700000);
    expect(n.jan3Real).toBeCloseTo(3.02, 1);
    expect(n.winter3).toBeLessThan(-750000);
    expect(n.filteredTrades).toBe(11);
    expect(n.filteredTotal).toBeCloseTo(312000, -3);
    expect(n.jan3Forecast).toBeGreaterThan(4);
    expect(n.feb8Forecast).toBeLessThan(0);
    expect(n.feb8Pnl).toBeLessThan(-200000);
    expect(metroDeskRun(METRO_DESK_DEFAULTS).book.trades).toHaveLength(24);
  });

  it('solves the forecast challenge at skill 0.4', () => {
    const at = (skill: number) => metroForecastSolved({ mode: 'forecast', skill, colder: 0 });
    expect(at(0.4)).toBe(true);
    expect(at(0.3)).toBe(false);
    expect(at(0.5)).toBe(false);
    expect(metroForecastSolved({ mode: 'forecast', skill: 0.4, colder: 1 })).toBe(false);
  });

  it('values firm Ridgeback Express capacity only in Year 5', () => {
    const n = basisDeskNumbers();
    expect(n.expressY5).toBeGreaterThan(8e6);
    expect(n.expressY5Forward).toBeGreaterThan(6e6);
    expect(n.expressOther).toBeLessThan(1000);
  });
});

describe('gas 6.4', () => {
  it('runs the hedged lease at or above April’s value every year, the unhedged one with the winter', () => {
    const n = arbitrageNumbers();
    const d = arbitrageData();
    expect(n.allAbove).toBe(true);
    expect(n.hedgedMinYear).toBe(4);
    expect(n.hedgedMaxYear).toBe(1);
    expect(n.hedgedExtra).toBeGreaterThan(0);
    // Colder-than-normal winters paid the unhedged lease at least April's value; the clearly mild ones 30–60% of it.
    expect(n.colderYears).toEqual([2, 4, 5, 7]);
    expect(n.colderMinRatio).toBeGreaterThanOrEqual(1);
    expect(n.mildYears).toEqual([1, 3, 6]);
    expect(n.mildLow).toBeGreaterThan(0.29);
    expect(n.mildHigh).toBeLessThan(0.61);
    // Paths start and end a quarter full.
    const path = leasePath(d.lease[0].moves);
    expect(path[0]).toBeCloseTo(LEASE_BCF * 0.25, 9);
    expect(path[12]).toBeGreaterThanOrEqual(LEASE_BCF * 0.25 - 1e-9);
  });

  it('finds Year 4 as the unhedged lease’s worst year against April (challenge a)', () => {
    const n = arbitrageNumbers();
    expect(worstUnhedgedYear()).toBe(4);
    expect(n.worstRatio).toBeCloseTo(0.304, 2);
    expect(n.worstWarmer).toBeGreaterThan(400);
    expect(n.worstSellMonth).toBe(10);
    expect(n.worstSellAvg).toBeLessThan(n.worstSellQuote - 0.9);
    expect(leaseYearSolved({ year: 4 })).toBe(true);
    expect(leaseYearSolved(ARB_LEASE_DEFAULTS)).toBe(false);
    expect([1, 2, 3, 5, 6, 7, 8].some((year) => leaseYearSolved({ year }))).toBe(false);
  });

  it('prices Northline as fair insurance and Express only once the glut is visible', () => {
    const n = arbitrageNumbers();
    const d = arbitrageData();
    expect(n.northFlat).toBe(true);
    expect(n.northAvg / n.northFwd).toBeCloseTo(1, 2);
    expect(n.northBestYear).toBe(2);
    const share = n.northBest / d.northline.reduce((s, a) => s + a.realized, 0);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.5);
    expect(n.northCalmCount).toBe(3);
    expect(n.northCalmMax).toBeLessThan(3000);
    expect(n.expYears).toEqual([4]);
    expect(n.expSurplus).toBeCloseTo(0.03, 6);
    expect(n.expFwd).toBeGreaterThan(6e6);
    expect(n.expEarned).toBeGreaterThan(n.expFwd);
  });

  it('values the Lakeside toll by the gas price level', () => {
    const n = arbitrageNumbers();
    expect(n.lakeDev).toBeCloseTo(0.11, 9);
    expect(n.lakeMaxYear).toBe(3);
    expect(n.lakeMinYear).toBe(6);
    expect(n.coalSwitch).toBeCloseTo(3.75, 6);
    expect(n.metroAvg[3]).toBeLessThan(n.coalSwitch);
    expect(n.metroAvg[6]).toBeGreaterThan(n.coalSwitch);
  });

  it('helps where the curve can see and does nothing for Northline', () => {
    const n = arbitrageNumbers();
    expect(n.rule.hedged).toBeGreaterThan(n.every.hedged);
    expect(n.rule.express).toBeGreaterThan(n.every.express);
    expect(n.rule.lakeside).toBeGreaterThan(n.every.lakeside);
    expect(n.rule.northline).toBeCloseTo(n.every.northline, 6);
    expect(n.hedgedWorstAtDefault).toBeLessThan(0);
    expect(n.unhedgedWorstAtDefault).toBeLessThan(n.hedgedWorstAtDefault);
    // Every fee starts within a step or two of the asset's average April value.
    for (const asset of ['hedged', 'northline', 'express', 'lakeside'] as const) {
      const v = assetValues(asset);
      const avg = v.reduce((s, x) => s + x.forward, 0) / v.length / 1e6;
      const key = feeKeyOf(asset);
      expect(Math.abs(ARBITRAGE_DEFAULTS[key] - avg)).toBeLessThan(2 * FEE_SCALE[key].step + 1e-9);
    }
  });

  it('solves the lease-fee challenge at the hedged lease’s floor (challenge b)', () => {
    const floor = leaseFloorFee();
    expect(floor).toBeCloseTo(2, 9);
    expect(arbitrageNumbers().floorMargin).toBeGreaterThan(0);
    const at = { ...ARBITRAGE_DEFAULTS, lease: floor };
    expect(arbitrageSolved(at)).toBe(true);
    expect(arbitrageYears(at).every((y) => y.profit > 0)).toBe(true);
    expect(arbitrageYears({ ...at, lease: floor + FEE_SCALE.lease.step }).some((y) => y.profit <= 0)).toBe(true);
    expect(arbitrageSolved({ ...at, lease: floor - FEE_SCALE.lease.step })).toBe(false);
    expect(arbitrageSolved({ ...at, asset: 'unhedged' })).toBe(false);
    expect(arbitrageSolved({ ...at, rule: 'april' })).toBe(false);
    expect(arbitrageSolved(ARBITRAGE_DEFAULTS)).toBe(false);
    expect(arbitrageTotal(at)).toBeGreaterThan(arbitrageTotal({ ...at, asset: 'unhedged' }));
  });
});

describe('gas 6.5', () => {
  const k = (x: number) => Math.round(x / 1000);

  it('runs the four strategies as Lessons 6.1–6.3 left them, at ordinary costs', () => {
    expect(labCosts(1)).toEqual(defaultCosts());
    expect(labSpreadHindsight()).toBe(11);
    const n = strategyLabNumbers();
    expect(n.futuresMargin).toBe(13500);
    expect(n.basisMargin).toBeCloseTo(0.28, 9);
    expect(k(n.weather.total)).toBe(588);
    expect(n.weather.trades.length).toBe(34);
    expect(n.weather.trades.filter((o) => o.pnl <= 0).length).toBe(8);
    expect(k(n.weather.peakCapital)).toBe(139);
    expect(k(n.spread.total)).toBe(68);
    expect(k(n.spread.peakCapital)).toBe(298);
    expect(k(n.spread.maxDrawdown)).toBe(140);
    expect(n.ridgeback.trades.length).toBe(12);
    expect(n.ridgeback.winRate).toBe(1);
    expect(n.ridgeback.total / 1e6).toBeCloseTo(4.6, 2);
    expect(Math.round((n.ridgeback.total / n.all.total) * 100)).toBe(83);
    expect(k(n.metro.total)).toBe(312);
    expect(k(n.metro.totalFees)).toBe(33);
    expect(k(n.metroCostly)).toBe(19);
    expect(n.all.total / 1e6).toBeCloseTo(5.57, 2);
    expect(k(n.all.peakCapital)).toBe(379);
    expect(n.all.peakCapital).toBeLessThan(n.ridgeback.peakCapital);
    expect(n.allPeakMonth).toBe(9);
  });

  it('survives at ×2 with $1 million and runs out of capital at ×3 before the Ridgeback trades', () => {
    expect(labLargestSize('all', 1, 1_000_000)).toBe(2);
    expect(strategyLabSolved({ ...LAB_CHALLENGE, size: 2 })).toBe(true);
    expect(strategyLabSolved({ ...LAB_CHALLENGE, size: 1 })).toBe(false);
    expect(strategyLabSolved({ ...LAB_CHALLENGE, size: 3 })).toBe(false);
    expect(strategyLabSolved(STRATEGY_LAB_DEFAULTS)).toBe(false);
    const over = labOutcome({ ...LAB_CHALLENGE, size: 3 });
    expect(over.bust).toBe(8);
    expect(k(over.final)).toBe(77);
    expect(over.book.capital[8] / 1e6).toBeCloseTo(1.1, 2);
    // Size scales profit and capital alike.
    expect(labBook('all', 2, 1).total).toBeCloseTo(2 * labBook('all', 1, 1).total, 3);
    expect(labBook('all', 2, 1).peakCapital).toBeCloseTo(2 * labBook('all', 1, 1).peakCapital, 3);
  });

  it('walks the rules forward: the spread and Metro rules fail, the Ridgeback desk does not', () => {
    const n = strategyLabNumbers();
    expect(n.walked).toEqual([null, 0, 14, 0, 11, 11, 11]);
    expect(k(n.spreadWalk.hindsight.total)).toBe(68);
    expect(k(n.spreadWalk.walk.total)).toBe(-352);
    expect(k(-n.winters[3].pnl)).toBe(206);
    expect(n.metroWalk.hindsight.trades.length).toBe(0);
    expect(n.metroWalk.walk.total / 1e6).toBeCloseTo(-1.2, 2);
    expect(n.fairY3).toBeCloseTo(0.16, 2);
    expect(n.fairY4).toBeCloseTo(1.11, 2);
    expect(n.janFwd).toBeCloseTo(0.74, 1);
    expect(n.janY3).toBeCloseTo(3.02, 2);
    expect(n.ridgeWalk.walk.total).toBeCloseTo(n.ridgeWalk.hindsight.total, 6);
    expect(n.growth).toBeCloseTo(0.12, 9);
    expect(n.takeaway).toBeCloseTo(3.05, 9);
    expect(labWalk('ridgeback').walk.total / 1e6).toBeCloseTo(4.6, 2);
    expect(labWinterHdd().map((x) => Math.round(x))).toEqual([-37, -452, 610, -440, 495, 67, -233, 103]);
  });
});
