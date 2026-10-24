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
import {
  BLEND_STREAMS,
  SUMMER,
  ULSD_LIMIT,
  WINTER,
  atmosphericEquivalent,
  blendProps,
  carbonRejected,
  distill,
  fccMargin,
  fccYields,
  hdsSulfurOut,
  hydrogenToUpgrade,
  meetsSpec,
  optimizeBlend,
  pressureForCut,
  rangeProps,
} from '../src/engines/oil/refining';
import { crudeBreakeven, marginPerBarrel, planRefinery, shadowPrices } from '../src/engines/oil/refinery';
import { CALDER } from '../src/model/oil/refinery';
import { TOWER_DEFAULTS, jetRate, maxJetSolved, pressureOf, vacuumSolved } from '../src/lessons/oil/ch3/L3_1';
import { DEFAULT_PRICES as FCC_DEFAULTS, bestTempSolved, bestTemperature, hydrogenLimitSolved, marginAt } from '../src/lessons/oil/ch3/L3_2';
import { CHEAPEST_15, DHT_M3_PER_HOUR, feedOf, getSlates, hydrogenPlantSolved, productPpm, throughputSolved, treatingCost } from '../src/lessons/oil/ch3/L3_3';
import { butaneAt, butaneFiveSolved, handBlendSolved, optimumCost } from '../src/lessons/oil/ch3/L3_4';
import { bestExpansionSolved, coldwaterLimitSolved, expansionGain } from '../src/lessons/oil/ch3/L3_5';
import { costPerBarrel, frictionFactor, hydraulics, maxFlow } from '../src/engines/oil/pipeline';
import { cheapestSpeed, voyage } from '../src/engines/oil/tanker';
import { expectedBuffer, planStorage, priceStrip, simulateBuffer } from '../src/engines/oil/storage';
import { NETWORK_DEFAULTS, nodePrices, solveNetwork } from '../src/engines/oil/network';
import { arbitrage, closingFreight, crudeNetback, qualityDifferentials } from '../src/engines/oil/arbitrage';
import { COLDWATER_LINE, KESSLER_CALDER, TYPICAL_CRUDE } from '../src/model/oil/logistics';
import { FLUIDS, northfieldMaxSolved, operatingProfile, tariffSolved } from '../src/lessons/oil/ch4/L4_1';
import { VOYAGE_DEFAULTS, cheapestSpeedSolved, lighteringSolved, scaleCost } from '../src/lessons/oil/ch4/L4_2';
import { TERMINAL_DEFAULTS, bestBuffer, bufferCurve, bufferSolved, highestRateSolved, terminalPlan } from '../src/lessons/oil/ch4/L4_3';
import { pipelineSolved, spreadAt, trappedSolved } from '../src/lessons/oil/ch4/L4_4';
import { arbFor, arbSolved, differentialsAt, highestOpen, qualitySolved } from '../src/lessons/oil/ch4/L4_5';
import { WORLD, balanceSheet, convenienceYield, crudeAndProductStocks, fullCarry, futuresCurve, inventoryPrice, productMarket, simulateShock, stocksForPrice } from '../src/engines/oil/market';
import { hubPricesFast } from '../src/engines/oil/network';
import { oilHistory } from '../src/model/oil/history';
import { BALANCE_DEFAULTS, flatBoost, flatGroup, flatProductsSolved, flatStocksSolved, rowsOf, yearOfStocks, yearOneChange } from '../src/lessons/oil/ch5/L5_1';
import { EXPLORER_DEFAULTS, breakdown, cheapestNorthfieldSolved, historyFor, historyForMode, smallestExpansion, smallestExpansionSolved, spreadStats, widestAfterOpening } from '../src/lessons/oil/ch5/L5_2';
import { MARKET_DEFAULTS, distillateFloorSolved, frontier, marketFor, moreDieselSolved, outputAt } from '../src/lessons/oil/ch5/L5_3';
import { CURVE_STATE_DEFAULTS, TANK_DEFAULTS, frontSpread, impliedDayRate, tankTops, tankTopsSolved, turnSolved } from '../src/lessons/oil/ch5/L5_4';
import {
  CRACK_RATIOS,
  RULE_DEFAULTS,
  backtest,
  basisRule,
  calendarRule,
  calderMargin,
  cashAndCarry,
  combine,
  correlation as pnlCorrelation,
  crackRule,
  expansionWeek,
  hedgeRefinery,
  qualityRule,
  walkForwardRule,
} from '../src/engines/oil/trading';
import { OUTAGE_DEFAULTS, SHOCK_STATE_DEFAULTS, crackRise, crudeBackedUp, gasolineSolved as crackRiseSolved, lowestPrice, peakPrice, releaseSolved, runShock } from '../src/lessons/oil/ch5/L5_5';
import { CARRY_STATE_DEFAULTS, TRADER_DEFAULTS, largestCarryHub, largestHubSolved, runCarry, runTrader, smallestHubSolved, smallestProfitableHub } from '../src/lessons/oil/ch6/L6_1';
import { BASIS_DEFAULTS, QUALITY_DEFAULTS, idleGrowth, idleGrowthSolved, losingShiftSolved, runBasis, runQuality, smallestLosingShift } from '../src/lessons/oil/ch6/L6_2';
import { CRACK_STATE_DEFAULTS, calendarWinsSolved, runCrack, splitFor, stillTradesSolved } from '../src/lessons/oil/ch6/L6_3';
import { HEDGE_DEFAULTS, QUARTER_DEFAULTS, bestHedge, fastestWtiGrowth, hedgeFor, quartersFor, standardCrackSolved, summarizeQuarters, wtiGrowthSolved } from '../src/lessons/oil/ch6/L6_4';
import { LAB_DEFAULTS, TUNED_BOOK, calendarBeforeCosts, crackShift, crackSolved, runLab, sizingSolved } from '../src/lessons/oil/ch6/L6_5';
import { DECK_DEFAULTS, WORLD_DEFAULTS, cheapestPlanSolved, cheapestTargetPlan, fanValuations, luckAnswer, luckSolved, worldParams } from '../src/lessons/oil/ch7/L7_1';
import { COKER_TEST, HISTORY_STATE_DEFAULTS, bestWithinBudget, budgetSolved, designOf, designValue, shiftSolved, smallestShift } from '../src/lessons/oil/ch7/L7_2';
import { CHAIN_DEFAULTS, SWEEP_DEFAULTS, slowestPayingGrowth, slowestPayingSolved, steadiestFirmSpace, steadiestSolved } from '../src/lessons/oil/ch7/L7_3';
import { CASH_DEFAULTS, DRIVER_DEFAULTS as DESK_DRIVERS, fastestSteadyGrowth, narrowBandSolved, steadyBasisSolved } from '../src/lessons/oil/ch7/L7_4';
import { DRIVER_DEFAULTS as TRADER_DRIVERS, bestAnyHedges, harderWorldSolved, hedgesSolved, withHedges } from '../src/lessons/oil/ch7/L7_5';
import {
  BUSINESS_DEFAULTS,
  COMMITTED_TARIFF,
  bestHedges,
  businessFan,
  exposures,
  productionOnPath,
  refineryCapital,
  refineryDay,
  refineryMargin,
  runBusiness,
  sanitizeBusiness,
  type OilBusiness,
} from '../src/engines/oil/business';

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

// ---------------------------------------------------------------------------
// Chapter 3 engines.

describe('refining processes', () => {
  it('distills with movable cut points and closes the balance', () => {
    for (const id of ['ridgeback', 'seaboard', 'northfield', 'coldwater'] as const) {
      const c = crude(id);
      const d = distill(c);
      expect(Object.values(d).reduce((s, r) => s + r.volume, 0)).toBeCloseTo(1, 9);
      const mass = Object.values(d).reduce((s, r) => s + r.volume * r.sg, 0);
      expect(mass).toBeCloseTo(c.sg, 9);
      expect(Object.values(d).reduce((s, r) => s + r.volume * r.sg * r.sulfur, 0) / mass).toBeCloseTo(c.sulfur, 9);
    }
    // A wider kerosene cut takes from its neighbors.
    expect(rangeProps(crude('ridgeback'), 150, 280).volume).toBeCloseTo(0.2443, 4);
  });
  it('converts vacuum conditions to atmospheric-equivalent cut points', () => {
    expect(atmosphericEquivalent(400, 760)).toBeCloseTo(400, 9);
    expect(atmosphericEquivalent(400, 25)).toBeCloseTo(582.4, 1);
    expect(atmosphericEquivalent(400, pressureForCut(400, 550))).toBeCloseTo(550, 6);
    expect(pressureForCut(400, 550)).toBeCloseTo(45.9, 1);
  });
  it('cracks with a volume gain and a gasoline peak', () => {
    const y = fccYields(0.75);
    expect(y.gasoline + y.lpg + y.lco + y.slurry).toBeCloseTo(1.09, 2);
    expect(fccYields(0.75).gasoline).toBeGreaterThan(fccYields(0.85).gasoline);
    const p = { gasoline: 96, lpg: 36, lco: 88, slurry: 55, feed: 78 };
    let best = 0;
    let bestM = -Infinity;
    for (let i = 0; i <= 30; i++) {
      const X = 0.55 + i / 100;
      if (fccMargin(X, p) > bestM) {
        bestM = fccMargin(X, p);
        best = X;
      }
    }
    expect(best).toBeCloseTo(0.66, 2);
    expect(carbonRejected(1.6)).toBeCloseTo(0.214, 3);
    expect(Math.round(hydrogenToUpgrade(1.6, 0.93))).toBe(1361);
  });
  it('hydrotreats diesel to 15 ppm', () => {
    const feed = { sulfur: distill(crude('northfield')).diesel.sulfur, hardShare: 0.15, baseHydrogen: 150 };
    expect(hdsSulfurOut(feed, 370, 1.5)).toBeLessThanOrEqual(ULSD_LIMIT);
    expect(hdsSulfurOut(feed, 370, 1.55)).toBeGreaterThan(ULSD_LIMIT);
    expect(hdsSulfurOut(feed, 350, 1)).toBeGreaterThan(hdsSulfurOut(feed, 370, 1));
  });
  it('blends summer and winter gasoline to spec', () => {
    const s = optimizeBlend(SUMMER, 60)!;
    const w = optimizeBlend(WINTER, 60)!;
    expect(meetsSpec(blendProps(s), SUMMER)).toBe(true);
    expect(meetsSpec(blendProps(w), WINTER)).toBe(true);
    expect(blendProps(s).costPerBbl).toBeCloseTo(43.04, 2);
    expect(blendProps(w).costPerBbl).toBeCloseTo(38.99, 2);
    expect(w.butane).toBeGreaterThan(s.butane);
    expect(BLEND_STREAMS.find((b) => b.id === 'fccGasoline')!.available).toBe(28);
  });
});

describe('refinery LP', () => {
  it('plans the reference day', () => {
    const p = planRefinery();
    expect(p.status).toBe('optimal');
    expect(p.crude.ridgeback).toBeCloseTo(58.0, 1);
    expect(p.crude.coldwater).toBeCloseTo(92.0, 1);
    expect(p.crude.northfield).toBeCloseTo(0, 6);
    expect(p.crude.seaboard).toBeCloseTo(0, 6);
    expect(p.unitFeed.cdu).toBeCloseTo(CALDER.capacity.cdu, 6);
    expect(p.unitFeed.coker).toBeCloseTo(CALDER.capacity.coker, 6);
    expect(p.unitFeed.dht).toBeCloseTo(CALDER.capacity.dht, 6);
    expect(marginPerBarrel(p)).toBeCloseTo(17.09, 2);
    expect(p.fuelOilSulfur).toBeLessThanOrEqual(3.5 + 1e-6);
    expect(p.hydrogen.used).toBeLessThanOrEqual(p.hydrogen.reformer + p.hydrogen.plant + 1e-6);
    const sp = shadowPrices();
    expect(sp.fcc).toBeCloseTo(0, 3);
    expect(sp.dht).toBeGreaterThan(sp.coker);
  });
  it('values crudes', () => {
    expect(crudeBreakeven('coldwater')).toBeCloseTo(68.7, 1);
    expect(crudeBreakeven('northfield')).toBeCloseTo(69.77, 1);
    for (const id of ['ridgeback', 'seaboard', 'northfield', 'coldwater'] as const) {
      const only = planRefinery({ crudeAvailable: { ridgeback: 0, seaboard: 0, northfield: 0, coldwater: 0, [id]: 150 } });
      expect(only.status).toBe('optimal');
      expect(only.crude[id]).toBeCloseTo(150, 6);
    }
  });
});

describe('chapter 3 lessons', () => {
  it('3.1: distillation tower and vacuum', () => {
    expect(maxJetSolved(TOWER_DEFAULTS)).toBe(false);
    expect(maxJetSolved({ crude: 'ridgeback', nk: 150, kd: 280, dg: 350 })).toBe(true);
    expect(maxJetSolved({ crude: 'ridgeback', nk: 150, kd: 280, dg: 365 })).toBe(false);
    expect(maxJetSolved({ crude: 'seaboard', nk: 150, kd: 280, dg: 350 })).toBe(false);
    expect(jetRate(TOWER_DEFAULTS)).toBeCloseTo(24.0, 1);
    expect(jetRate({ crude: 'ridgeback', nk: 150, kd: 280, dg: 350 })).toBeCloseTo(36.64, 2);
    expect(vacuumSolved(380, 2.9)).toBe(false);
    expect(vacuumSolved(400, 1.66)).toBe(true);
    expect(vacuumSolved(400, 1.65)).toBe(false);
    expect(vacuumSolved(400, 1.67)).toBe(false);
    expect(pressureOf(2.9)).toBe(760);
    expect(1 - cumulativeYield(crude('coldwater'), 350)).toBeCloseTo(0.63, 3);
    expect(1 - cumulativeYield(crude('coldwater'), atmosphericEquivalent(400, 25))).toBeCloseTo(0.305, 3);
  });
  it('3.2: cracking and hydrogen', () => {
    expect(bestTemperature('ridgeback')).toBe(506);
    expect(bestTemperature('northfield')).toBe(516);
    expect(bestTemperature('coldwater')).toBe(521);
    expect(marginAt('northfield', 516)).toBeCloseTo(7.9, 2);
    expect(bestTempSolved('northfield', 530, 96, 88)).toBe(false);
    expect(bestTempSolved('northfield', 516, 96, 88)).toBe(true);
    expect(bestTempSolved('northfield', 516, 100, 88)).toBe(false);
    expect(bestTemperature('ridgeback', { ...FCC_DEFAULTS, lco: 100 })).toBe(503);
    expect(bestTemperature('ridgeback', { ...FCC_DEFAULTS, lco: 70 })).toBe(512);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.58)).toBe(true);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.57)).toBe(false);
    expect(hydrogenLimitSolved('add', 'gasOil', 1.59)).toBe(false);
    expect(hydrogenLimitSolved('reject', 'gasOil', 1.58)).toBe(false);
    expect(Math.round(hydrogenToUpgrade(1.5, 1.0))).toBe(1965);
    expect(carbonRejected(1.5)).toBeCloseTo(0.286, 3);
  });
  it('3.3: hydrotreating and the hydrogen balance', () => {
    expect(throughputSolved('northfield', 350, 1)).toBe(false);
    expect(throughputSolved('northfield', 370, 1.5)).toBe(true);
    expect(throughputSolved('northfield', 370, 1.45)).toBe(false);
    expect(throughputSolved('coldwater', 370, 1.4)).toBe(false);
    expect(productPpm('northfield', 350, 1)).toBeCloseTo(52.08, 1);
    expect(productPpm('northfield', 370, 1.5)).toBeCloseTo(14.27, 1);
    expect(Math.round(DHT_M3_PER_HOUR / 0.7)).toBe(520);
    expect(Math.round(treatingCost('northfield', 350, 0.7).scf)).toBe(274);
    expect(CHEAPEST_15.min).toBeCloseTo(1.35, 2);
    expect(CHEAPEST_15.max).toBeCloseTo(1.43, 2);
    expect(feedOf('coldwater').sulfur).toBeCloseTo(1.666, 3);
    const s = getSlates();
    expect(s.length).toBe(21);
    expect(hydrogenPlantSolved(20)).toBe(false);
    expect(hydrogenPlantSolved(85)).toBe(false);
    expect(hydrogenPlantSolved(90)).toBe(true);
    expect(hydrogenPlantSolved(95)).toBe(false);
    expect(s[7].plan.unitFeed.dht).toBeLessThan(55 - 0.5);
    expect(s[8].plan.unitFeed.dht).toBeCloseTo(55, 6);
    expect(s[10].plan.fuelOilSulfur).toBeLessThan(3.5 - 0.01);
    expect(s[11].plan.fuelOilSulfur).toBeCloseTo(3.5, 4);
    expect(s.reduce((a, x) => (x.marginPerBbl > a.marginPerBbl ? x : a)).share).toBe(80);
    expect(s[20].plan.sulfurPlant).toBeCloseTo(153.9, 1);
  });
  it('3.4: blending', () => {
    const def = { butane: 6, lightNaphtha: 10, reformate: 16, fccGasoline: 28, alkylate: 0 };
    expect(handBlendSolved(def, false)).toBe(false);
    const opt = optimizeBlend(SUMMER, 60)!;
    expect(handBlendSolved(opt, true)).toBe(false);
    expect(handBlendSolved({ butane: 2.8, lightNaphtha: 6.5, reformate: 22.7, fccGasoline: 28, alkylate: 0 }, false)).toBe(true);
    expect(handBlendSolved({ butane: 2.8, lightNaphtha: 6.5, reformate: 22.7, fccGasoline: 27.9, alkylate: 0.1 }, false)).toBe(false);
    expect(blendProps(def).aki).toBeCloseTo(85.55, 2);
    expect(blendProps(def).rvp).toBeCloseTo(12.57, 2);
    expect(butaneFiveSolved(9, 60)).toBe(false);
    expect(butaneFiveSolved(11.2, 60)).toBe(true);
    expect(butaneFiveSolved(11.3, 60)).toBe(false);
    expect(butaneAt(11.1)).toBeLessThan(5);
    expect(optimumCost(60) - optimumCost(60, WINTER)).toBeCloseTo(4.05, 2);
    expect(optimumCost(60, { ...SUMMER, rvp: 8.5 }) - optimumCost(60, { ...SUMMER, rvp: 9.5 })).toBeCloseTo(0.85, 2);
    expect(optimizeBlend(SUMMER, 50)).toBeNull();
    expect(optimizeBlend(SUMMER, 53)).not.toBeNull();
  });
  it('3.5: the refinery LP', () => {
    const base = { gasoline: 96, diesel: 106, coldwater: 62, northfield: 72 };
    expect(coldwaterLimitSolved(base)).toBe(false);
    expect(coldwaterLimitSolved({ ...base, coldwater: 68.5 })).toBe(true);
    expect(coldwaterLimitSolved({ ...base, coldwater: 68 })).toBe(false);
    expect(planRefinery({ crudePrice: { coldwater: 67.5 } }).crude.coldwater).toBeCloseTo(84.4, 1);
    expect(planRefinery({ crudePrice: { coldwater: 68.5 } }).crude.northfield).toBeGreaterThan(100);
    expect(bestExpansionSolved('none', 10)).toBe(false);
    expect(bestExpansionSolved('coker', 10)).toBe(true);
    expect(bestExpansionSolved('cdu', 10)).toBe(false);
    expect(expansionGain('coker', 10) / 1000).toBeCloseTo(112.5, 0);
    expect(expansionGain('cdu', 10) / 1000).toBeCloseTo(84.7, 0);
    expect(expansionGain('fcc', 10)).toBeCloseTo(0, 0);
    const cfg = (c: number) => ({ ...CALDER, capacity: { ...CALDER.capacity, coker: c } });
    expect(shadowPrices({ config: cfg(37) }).coker).toBeGreaterThan(1000);
    expect(shadowPrices({ config: cfg(38) }).coker).toBeCloseTo(0, 0);
    expect(crudeBreakeven('coldwater', { config: cfg(0) })).toBeCloseTo(62.54, 1);
  });
});

// ---------------------------------------------------------------------------
// Chapter 4 engines.

describe('logistics', () => {
  it('computes pipeline hydraulics', () => {
    expect(frictionFactor(1000, 0)).toBeCloseTo(0.064, 6);
    const rb = { name: 'Ridgeback', sg: crude('ridgeback').sg, viscosity: viscosity(crude('ridgeback'), 15) };
    const h = hydraulics(KESSLER_CALDER, rb, 300000);
    expect(h.regime).toBe('turbulent');
    expect(h.elevationPsi).toBeLessThan(0);
    // Friction grows faster than flow; the maximum with the line's stations is about 520 kb/d of light crude.
    expect(hydraulics(KESSLER_CALDER, rb, 400000).psiPerMile / h.psiPerMile).toBeGreaterThan(1.6);
    expect(Math.round(maxFlow(KESSLER_CALDER, rb) / 1000)).toBe(520);
    expect(Math.round(maxFlow(KESSLER_CALDER, TYPICAL_CRUDE) / 1000)).toBe(483);
    expect(Math.round(maxFlow(COLDWATER_LINE, { name: 'blend', sg: 0.9068, viscosity: 328.4 }) / 1000)).toBe(360);
    const c = costPerBarrel(KESSLER_CALDER, TYPICAL_CRUDE, 400000);
    expect(c.total).toBeCloseTo(1.77, 2);
    expect(costPerBarrel(KESSLER_CALDER, TYPICAL_CRUDE, 200000).total).toBeGreaterThan(c.total);
  });
  it('prices tanker voyages', () => {
    const v = voyage({ vessel: 'vlcc', route: 'eastbay', speed: 13 });
    expect(v.perBbl).toBeCloseTo(3.458, 3);
    expect(v.lightering).toBe(600000);
    expect(voyage({ vessel: 'aframax', route: 'northport', speed: 13 }).perBbl).toBeCloseTo(2.573, 3);
    const s = cheapestSpeed('vlcc');
    expect(s).toBeCloseTo(11.65, 2);
    for (const d of [-0.5, 0.5]) expect(voyage({ vessel: 'vlcc', route: 'eastbay', speed: s + d }).perBbl).toBeGreaterThan(voyage({ vessel: 'vlcc', route: 'eastbay', speed: s }).perBbl);
    expect(cheapestSpeed('vlcc', 45000, 800)).toBeLessThan(cheapestSpeed('vlcc', 45000, 400));
  });
  it('stores against a contango', () => {
    expect(planStorage(priceStrip(75, 0.6)).profit).toBeCloseTo(0, 3);
    const p = planStorage(priceStrip(75, 1.0));
    expect(p.profit / 1e6).toBeCloseTo(33.6, 1);
    expect(Math.max(...p.inventory)).toBeCloseTo(20e6, -3);
    expect(p.inventory[11]).toBeCloseTo(0, 3);
  });
  it('simulates buffer stocks', () => {
    const base = { runs: 150000, cargo: 1050000, interval: 7, maxDelay: 4, storms: 3 };
    expect(simulateBuffer({ ...base, buffer: 0 }).shortfall).toBeGreaterThan(0);
    const e0 = expectedBuffer({ ...base, buffer: 600000 });
    const e1 = expectedBuffer({ ...base, buffer: 750000 });
    expect(e0.shortfall).toBeCloseTo(172500, -2);
    expect(e1.shortfall).toBeLessThan(e0.shortfall);
    expect(expectedBuffer({ ...base, buffer: 1200000 }).shortfall).toBe(0);
  });
  it('prices the crude network', () => {
    const s = solveNetwork();
    expect(s.status).toBe('optimal');
    const p = nodePrices();
    expect(p.kessler).toBeCloseTo(76.2, 6);
    expect(p.calder).toBeCloseTo(78.2, 6);
    expect(p.basin).toBeCloseTo(75.2, 6);
    expect(nodePrices({ ...NETWORK_DEFAULTS, basinSupply: 300 }).kessler).toBeCloseTo(79.5, 6);
    expect(nodePrices({ ...NETWORK_DEFAULTS, basinSupply: 550 }).kessler).toBeCloseTo(68.2, 6);
    expect(nodePrices({ ...NETWORK_DEFAULTS, basinSupply: 700 }).kessler).toBeCloseTo(54, 6);
    expect(nodePrices({ ...NETWORK_DEFAULTS, basinSupply: 900 }).kessler).toBeCloseTo(51, 6);
  });
  it('finds arbitrage margins and quality values', () => {
    const a = { originPrice: 74.5, pipelineTariff: 2, terminalFees: 0.4, freight: 2.573, insurance: 0.0005, losses: 0.002, destinationPrice: 79, transitDays: 16, financingRate: 0.06 };
    expect(arbitrage(a).margin).toBeCloseTo(-0.872, 2);
    expect(arbitrage({ ...a, freight: closingFreight(a) }).margin).toBeCloseTo(0, 9);
    expect(crudeNetback('ridgeback')).toBeCloseTo(88.32, 2);
    expect(crudeNetback('coldwater')).toBeCloseTo(75.3, 1);
    const q = qualityDifferentials();
    expect(q.coldwater).toBeCloseTo(-13.03, 1);
    expect(qualityDifferentials({ productPrice: { hsfo: 40 } }).coldwater).toBeLessThan(q.coldwater);
  });
});

describe('chapter 4 lessons', () => {
  it('4.1: pipelines and pumps', () => {
    expect(northfieldMaxSolved('mix', 400, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 380, 3)).toBe(true);
    expect(northfieldMaxSolved('northfield', 375, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 385, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 380, 4)).toBe(false);
    expect(tariffSolved(300, 1.8)).toBe(false);
    expect(tariffSolved(350, 1.8)).toBe(true);
    expect(tariffSolved(355, 1.8)).toBe(false);
    expect(Math.round(maxFlow(KESSLER_CALDER, FLUIDS.northfield) / 1000)).toBe(383);
    expect(Math.round(maxFlow(KESSLER_CALDER, TYPICAL_CRUDE, 4) / 1000)).toBe(559);
    expect(hydraulics(KESSLER_CALDER, TYPICAL_CRUDE, 400000).psiPerMile).toBeCloseTo(6.37, 2);
    expect(hydraulics(KESSLER_CALDER, TYPICAL_CRUDE, 400000).electricMW).toBeCloseTo(19.4, 1);
    expect(hydraulics(KESSLER_CALDER, FLUIDS.coldwater, 200000).regime).toBe('laminar');
    expect(hydraulics(KESSLER_CALDER, FLUIDS.coldwater, 250000).regime).toBe('turbulent');
    expect(costPerBarrel(KESSLER_CALDER, TYPICAL_CRUDE, 200000).total).toBeCloseTo(3.39, 2);
    expect(operatingProfile(FLUIDS.mix, 400000, 3).feasible).toBe(true);
    expect(operatingProfile(FLUIDS.northfield, 385000, 3).feasible).toBe(false);
  });
  it('4.2: tankers', () => {
    const v = { ...VOYAGE_DEFAULTS, vessel: 'vlcc' as const, route: 'eastbay' as const, hire: 45000 };
    expect(cheapestSpeedSolved(VOYAGE_DEFAULTS)).toBe(false);
    expect(cheapestSpeedSolved({ ...v, speed: 11.6 })).toBe(true);
    expect(cheapestSpeedSolved({ ...v, speed: 11.7 })).toBe(true);
    expect(cheapestSpeedSolved({ ...v, speed: 11.5 })).toBe(false);
    expect(lighteringSolved(0.6, false)).toBe(false);
    expect(lighteringSolved(1.7, false)).toBe(true);
    expect(lighteringSolved(1.65, false)).toBe(false);
    expect(lighteringSolved(1.7, true)).toBe(false);
    expect(scaleCost('vlcc', 'northport', 0.6, false)).toBeCloseTo(1.732, 3);
    expect(scaleCost('vlcc', 'northport', 0.6, true)).toBeCloseTo(1.432, 3);
    expect(scaleCost('suezmax', 'northport', 0.6, false)).toBeCloseTo(2.278, 3);
    expect(cheapestSpeed('vlcc', 45000, 400)).toBeCloseTo(13.34, 2);
    expect(cheapestSpeed('vlcc', 100000, 600)).toBeCloseTo(15.21, 2);
  });
  it('4.3: storage and buffer stocks', () => {
    expect(highestRateSolved(TERMINAL_DEFAULTS)).toBe(false);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 8.5 })).toBe(true);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 8 })).toBe(false);
    expect(terminalPlan({ slope: 1, seasonal: 0, fee: 0.4, rate: 8.5 }).profit / 1e6).toBeCloseTo(2.27, 2);
    expect(terminalPlan({ slope: 0.85, seasonal: 0, fee: 0.4, rate: 6 }).profit / 1e6).toBeCloseTo(6.1, 1);
    expect(terminalPlan({ slope: 0, seasonal: 3, fee: 0.4, rate: 6 }).profit / 1e6).toBeCloseTo(27.15, 1);
    expect(bestBuffer().buffer).toBe(600000);
    expect(bestBuffer().total / 1e6).toBeCloseTo(8.51, 2);
    expect(bufferCurve().find((p) => p.shortfall === 0)!.buffer).toBe(1200000);
    expect(bufferSolved(600000)).toBe(true);
    expect(bufferSolved(450000)).toBe(false);
  });
  it('4.4: global oil flows', () => {
    expect(pipelineSolved({ basin: 400, pipeline: 480, rail: 150 })).toBe(false);
    expect(pipelineSolved({ basin: 700, pipeline: 700, rail: 150 })).toBe(false);
    expect(pipelineSolved({ basin: 700, pipeline: 710, rail: 150 })).toBe(true);
    expect(pipelineSolved({ basin: 700, pipeline: 720, rail: 150 })).toBe(false);
    expect(spreadAt(700, 710)).toBeCloseTo(3.7, 6);
    expect(spreadAt(700, 600)).toBeCloseTo(11.7, 6);
    expect(trappedSolved(400)).toBe(false);
    expect(trappedSolved(630)).toBe(true);
    expect(trappedSolved(640)).toBe(false);
    expect(spreadAt(300)).toBeCloseTo(-0.5, 6);
    expect(nodePrices({ ...NETWORK_DEFAULTS, basinSupply: 880 }).kessler).toBeCloseTo(51, 6);
  });
  it('4.5: arbitrage and quality differentials', () => {
    expect(arbSolved('aframax', 74.5, 79)).toBe(false);
    expect(arbSolved('vlcc', 74.4, 79)).toBe(true);
    expect(arbSolved('vlcc', 74.3, 79)).toBe(false);
    expect(arbFor('aframax', 74.5, 79).margin).toBeCloseTo(-0.872, 2);
    expect(highestOpen('aframax')).toBe(73.6);
    expect(highestOpen('vlcc')).toBe(74.4);
    expect(qualitySolved(62, 106)).toBe(false);
    expect(qualitySolved(58, 106)).toBe(true);
    expect(differentialsAt(58, 106).coldwater).toBeCloseTo(-14.48, 2);
    expect(differentialsAt(80, 106).northfield).toBeCloseTo(-0.61, 2);
  });
});

// ---------------------------------------------------------------------------
// Chapter 5 engines and the simulated history.

describe('market model', () => {
  it('balances supply and demand into stocks', () => {
    const rows = balanceSheet({ group: 31.6 });
    expect(rows[0].balance).toBeCloseTo(0.8, 6);
    expect(rows[0].stocks).toBeCloseTo(2800 + 0.8 * 91.25, 6);
    const flat = balanceSheet({ group: 31.75, quarters: 4 });
    expect(flat[3].stocks).toBeCloseTo(2800, 6);
    const cp = crudeAndProductStocks({ crudeSupply: 83, runs: Array(12).fill(83), productDemand: Array(12).fill(83 * 1.03 + 15), otherLiquids: 15 });
    expect(cp[11].crudeStock).toBeCloseTo(0, 6);
    expect(cp[11].productStock).toBeCloseTo(0, 6);
  });
  it('prices stocks', () => {
    expect(inventoryPrice(WORLD.normalStocks)).toBe(WORLD.referencePrice);
    expect(inventoryPrice(2660)).toBeCloseTo(96.99, 2);
    expect(stocksForPrice(inventoryPrice(2500))).toBeCloseTo(2500, 6);
  });
  it('responds to shocks', () => {
    const base = simulateShock({});
    expect(base.every((m) => Math.abs(m.price - WORLD.referencePrice) < 1e-6)).toBe(true);
    const peak = (s: ReturnType<typeof simulateShock>) => Math.max(...s.map((m) => m.price));
    const out = simulateShock({ outage: { size: 2, start: 2, months: 6 } });
    expect(peak(out)).toBeCloseTo(101.9, 1);
    expect(peak(simulateShock({ outage: { size: 2, start: 2, months: 6 }, groupStabilizes: true }))).toBeLessThan(peak(out));
    expect(peak(simulateShock({ outage: { size: 2, start: 2, months: 6 }, reserveRelease: { rate: 1, start: 3, months: 6 } }))).toBeLessThan(peak(out));
  });
  it('shapes the futures curve from stocks', () => {
    expect(convenienceYield(0)).toBeCloseTo(6, 9);
    expect(fullCarry(75)).toBeCloseTo(0.775, 9);
    const low = futuresCurve({ fill: 0.2 });
    const high = futuresCurve({ fill: 0.9 });
    expect(low[1]).toBeLessThan(low[0]);
    expect(high[1] - high[0]).toBeGreaterThan(0.6);
    expect(high[1] - high[0]).toBeLessThanOrEqual(fullCarry(high[0]) + 1e-9);
    const full = futuresCurve({ fill: 1 });
    expect(full[1] - full[0]).toBeGreaterThan(fullCarry(full[0]));
  });
  it('makes seasonal product cracks', () => {
    const pm = productMarket({ runs: 83, gasolineYield: 0.44, distillateYield: 0.42 });
    const g = pm.map((m) => m.gasolineCrack);
    expect(g.indexOf(Math.max(...g))).toBeGreaterThanOrEqual(6);
    expect(g.indexOf(Math.max(...g))).toBeLessThanOrEqual(9);
  });
  it('prices the hub in closed form exactly as the network program does', () => {
    for (let b = 250; b <= 1000; b += 50) {
      for (const pipe of [300, 480, 700]) {
        const inp = { ...NETWORK_DEFAULTS, basinSupply: b, pipeline: pipe };
        const lp = nodePrices(inp);
        const f = hubPricesFast(inp);
        expect(f.kessler).toBeCloseTo(lp.kessler, 6);
        expect(f.calder).toBeCloseTo(lp.calder, 6);
      }
    }
  });
  it('generates a deterministic, physically driven history', () => {
    const h = oilHistory();
    expect(h.length).toBe(260);
    expect(oilHistory()).toBe(h);
    const sp = h.map((w) => w.brent - w.wti);
    // The Kessler–Calder line fills in the second year and the expansion relieves it in the fourth.
    expect(Math.max(...sp.slice(90, 150))).toBeGreaterThan(10);
    expect(Math.max(...sp.slice(165, 260))).toBeLessThan(6);
    expect(Math.max(...oilHistory({ expansion: null }).map((w) => w.brent - w.wti))).toBeGreaterThan(25);
    expect(h.some((w) => w.wtiCurve[1] < w.wtiCurve[0])).toBe(true);
    expect(h.every((w) => Number.isFinite(w.crack321) && Number.isFinite(w.coldwater))).toBe(true);
  });
});

describe('chapter 5 lessons', () => {
  it('5.1: oil balances', () => {
    const r = rowsOf(BALANCE_DEFAULTS);
    expect(r[2].balance).toBeCloseTo(-1.2, 6);
    expect(Math.round(r[3].stocks)).toBe(2745);
    expect(inventoryPrice(r[3].stocks)).toBeCloseTo(85.49, 2);
    expect(inventoryPrice(r[7].stocks)).toBeCloseTo(115.84, 2);
    expect(flatGroup(1, 0.15)).toEqual([31.75]);
    expect(yearOneChange({ ...BALANCE_DEFAULTS, group: 31.75 })).toBeCloseTo(0, 6);
    expect(flatStocksSolved(BALANCE_DEFAULTS)).toBe(false);
    expect(flatStocksSolved({ ...BALANCE_DEFAULTS, group: 31.75 })).toBe(true);
    expect(flatStocksSolved({ ...BALANCE_DEFAULTS, group: 31.7 })).toBe(false);
    const y = yearOfStocks(2, 0);
    expect(y[4].crudeStock - y[1].crudeStock).toBeCloseTo(121.6, 1);
    expect(y[4].productStock - y[1].productStock).toBeCloseTo(-82.7, 1);
    expect(flatBoost(2)).toEqual([2.1]);
    expect(flatProductsSolved(2, 0)).toBe(false);
    expect(flatProductsSolved(2, 2.1)).toBe(true);
  });
  it('5.2: benchmarks and differentials', () => {
    const s = EXPLORER_DEFAULTS;
    expect(smallestExpansionSolved(s)).toBe(false);
    expect(smallestExpansion()).toBe(275);
    expect(smallestExpansionSolved({ ...s, add: 275 })).toBe(true);
    expect(smallestExpansionSolved({ ...s, add: 250 })).toBe(false);
    expect(widestAfterOpening(250)).toBeCloseTo(11.94, 2);
    expect(widestAfterOpening(275)).toBeCloseTo(4.43, 2);
    const st = spreadStats(historyFor(s));
    expect(st.average).toBeCloseTo(5.58, 2);
    expect(st.fullWeeks).toBe(80);
    expect(cheapestNorthfieldSolved('built', 26)).toBe(false);
    expect(cheapestNorthfieldSolved('built', 140)).toBe(true);
    const b = breakdown(historyForMode('built')[140]);
    expect(b.nfLocation).toBeCloseTo(-11.14, 2);
    expect(b.nfQuality).toBeCloseTo(-5.38, 2);
  });
  it('5.3: product markets', () => {
    const ref = marketFor(MARKET_DEFAULTS);
    const g = ref.map((m) => m.gasolineStock);
    expect(g.indexOf(Math.max(...g))).toBe(3);
    expect(g.indexOf(Math.min(...g))).toBe(8);
    expect(ref[8].gasolineCrack).toBeCloseTo(23.29, 2);
    expect(distillateFloorSolved(MARKET_DEFAULTS)).toBe(false);
    expect(distillateFloorSolved({ runs: 83, distillate: 0.4225, outage: 'none' })).toBe(true);
    expect(distillateFloorSolved({ runs: 83, distillate: 0.425, outage: 'none' })).toBe(false);
    expect(moreDieselSolved(106)).toBe(false);
    expect(moreDieselSolved(88)).toBe(true);
    expect(moreDieselSolved(87)).toBe(false);
    expect(outputAt(87).gasoline).toBeCloseTo(49.66, 1);
    const gs = frontier().map((p) => p.gasoline);
    expect(Math.max(...gs) - Math.min(...gs)).toBeCloseTo(6.25, 1);
  });
  it('5.4: futures curve and tank tops', () => {
    expect(turnSolved(CURVE_STATE_DEFAULTS)).toBe(false);
    expect(turnSolved({ ...CURVE_STATE_DEFAULTS, fill: 33 })).toBe(true);
    expect(turnSolved({ ...CURVE_STATE_DEFAULTS, fill: 34 })).toBe(false);
    expect(frontSpread({ ...CURVE_STATE_DEFAULTS, fill: 32 })).toBeLessThan(0);
    expect(frontSpread({ ...CURVE_STATE_DEFAULTS, fill: 55 })).toBeCloseTo(0.57, 2);
    expect(tankTopsSolved(TANK_DEFAULTS)).toBe(false);
    expect(tankTopsSolved({ fill: 97.5, floating: 1.2 })).toBe(true);
    expect(tankTopsSolved({ fill: 98, floating: 1.2 })).toBe(false);
    expect(tankTops({ fill: 100, floating: 1.2 }).spread).toBeCloseTo(1.19, 2);
    expect(Math.round(impliedDayRate(1.2))).toBe(78947);
  });
  it('5.5: shocks', () => {
    expect(releaseSolved(SHOCK_STATE_DEFAULTS)).toBe(false);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 1 })).toBe(true);
    expect(releaseSolved({ ...SHOCK_STATE_DEFAULTS, release: 0.9 })).toBe(false);
    expect(peakPrice(runShock(SHOCK_STATE_DEFAULTS))).toBeCloseTo(101.85, 2);
    expect(lowestPrice(runShock(SHOCK_STATE_DEFAULTS))).toBeCloseTo(66.42, 2);
    expect(peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, group: true }))).toBeCloseTo(86.25, 2);
    expect(peakPrice(runShock({ ...SHOCK_STATE_DEFAULTS, release: 1 }))).toBeCloseTo(89.66, 2);
    expect(lowestPrice(runShock({ ...SHOCK_STATE_DEFAULTS, kind: 'demand', size: 3 }))).toBeCloseTo(54.39, 2);
    expect(crackRiseSolved(OUTAGE_DEFAULTS)).toBe(false);
    expect(crackRiseSolved({ ...OUTAGE_DEFAULTS, size: 2.9 })).toBe(true);
    expect(crackRiseSolved({ ...OUTAGE_DEFAULTS, size: 2.8 })).toBe(false);
    expect(crackRise(OUTAGE_DEFAULTS).gasoline).toBeCloseTo(3.567, 2);
    expect(crudeBackedUp(OUTAGE_DEFAULTS)).toBeCloseTo(121.6, 6);
  });
});

// ---------------------------------------------------------------------------
// Chapter 6 engines.

describe('trading strategies', () => {
  const h = oilHistory();
  it('backtests without looking ahead', () => {
    // A rule that peeks at next week's move would earn on every week; ours only sees the past.
    const peek = backtest(h, 'crack', (t) => (h[t + 1].crack321 > h[t].crack321 ? 1 : -1), { units: 1, costPerBbl: 0 });
    const fair = backtest(h, 'crack', crackRule(h, RULE_DEFAULTS.crack), { units: 1, costPerBbl: 0 });
    expect(peek.stats.winRate).toBe(1);
    expect(fair.stats.winRate).toBeLessThan(0.7);
    const flat = backtest(h, 'basis', () => 0);
    expect(flat.stats.total).toBe(0);
    expect(flat.costs).toBe(0);
  });
  it('earns on the physical drivers and loses them when the drivers go', () => {
    const cal = (p = {}) => {
      const hh = oilHistory(p);
      return backtest(hh, 'calendar', calendarRule(hh, RULE_DEFAULTS.calendar), { units: 10 }).stats;
    };
    expect(cal().total).toBeGreaterThan(0);
    expect(cal().sharpe).toBeGreaterThan(1);
    expect(cal({ kesslerCapacity: 4 }).total).toBeLessThan(0);
    const bas = (p = {}) => {
      const hh = oilHistory(p);
      return backtest(hh, 'basis', basisRule(hh, RULE_DEFAULTS.basis, expansionWeek(hh)), { units: 10 }).stats;
    };
    expect(bas().total).toBeGreaterThan(300000);
    expect(bas({ basinGrowth: 0 }).total).toBe(0);
    const cr = (p = {}) => {
      const hh = oilHistory(p);
      return backtest(hh, 'crack', crackRule(hh, RULE_DEFAULTS.crack), { units: 10 }).stats;
    };
    expect(cr().total).toBeGreaterThan(cr({ seasonality: 0 }).total * 4);
  });
  it('trades the heavy discount back toward normal, and loses when the fuel-oil discount shifts for good', () => {
    const q = (p = {}) => {
      const hh = oilHistory(p);
      return backtest(hh, 'quality', qualityRule(hh, RULE_DEFAULTS.quality), { units: 10 }).stats;
    };
    expect(q().total).toBeGreaterThan(80000);
    expect(q().sharpe).toBeGreaterThan(0.9);
    expect(q({ fuelOilShock: { year: 2, size: 15 } }).total).toBeLessThan(q().total / 10);
    const shocked = oilHistory({ fuelOilShock: { year: 2, size: 15 } });
    const disc = (hh: typeof h, from: number, to: number) => hh.slice(from, to).reduce((s, w) => s + w.brent - w.hsfo, 0) / (to - from);
    expect(disc(shocked, 182, 260) - disc(h, 182, 260)).toBeGreaterThan(12);
  });
  it('stores only when contango beats full carry', () => {
    expect(cashAndCarry(h).trades).toBe(0);
    const small = cashAndCarry(oilHistory({ kesslerCapacity: 4 }));
    expect(small.trades).toBeGreaterThan(0);
    expect(small.profit).toBeGreaterThan(0);
  });
  it('hedges Calder best with a crack that matches its yields, against Brent', () => {
    expect(calderMargin(h[0]) / 1e6).toBeCloseTo(2.6, 1);
    const matched = hedgeRefinery(h, 0.8, 'brent', CRACK_RATIOS.calder);
    const gasHeavy = hedgeRefinery(h, 0.8, 'brent', CRACK_RATIOS['3:2:1']);
    const wti = hedgeRefinery(h, 0.8, 'wti', CRACK_RATIOS.calder);
    expect(matched.effectiveness).toBeGreaterThan(0.65);
    expect(gasHeavy.effectiveness).toBeLessThan(0);
    expect(wti.effectiveness).toBeLessThan(matched.effectiveness);
    expect(hedgeRefinery(oilHistory({ seasonality: 0 }), 0.8, 'brent', CRACK_RATIOS['3:2:1']).effectiveness).toBeGreaterThan(0.5);
    expect(hedgeRefinery(h, 0, 'brent', CRACK_RATIOS.calder).bestRatio).toBeCloseTo(0.883, 2);
  });
  it('combines and walks forward', () => {
    expect(pnlCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9);
    expect(combine([[1, 2], [3, 4]], [1, 2])).toEqual([7, 10]);
    const wf = walkForwardRule(h, 'calendar', [1, 2, 4, 8].map((lookback) => ({ lookback, threshold: 0.01 })), (p) => calendarRule(h, p), { window: 52, step: 13, units: 10 });
    expect(wf.pnl.length).toBe(h.length - 1 - 52);
    expect(wf.chosen.length).toBe(wf.pnl.length);
  });
});

// ---------------------------------------------------------------------------
// Chapter 6 lessons.

describe('chapter 6 lessons', () => {
  it('6.1: the calendar rule needs a slow hub; cash and carry needs a full one', () => {
    expect(runTrader(TRADER_DEFAULTS).stats.total).toBeCloseTo(25821, -2);
    expect(runTrader({ ...TRADER_DEFAULTS, capacity: 4 }).stats.total).toBeLessThan(0);
    expect(smallestProfitableHub()).toBe(7);
    expect(smallestHubSolved(TRADER_DEFAULTS)).toBe(false);
    expect(smallestHubSolved({ ...TRADER_DEFAULTS, capacity: 7 })).toBe(true);
    expect(smallestHubSolved({ ...TRADER_DEFAULTS, capacity: 8 })).toBe(false);
    expect(runCarry(CARRY_STATE_DEFAULTS).trades).toBe(0);
    expect(runCarry({ ...CARRY_STATE_DEFAULTS, capacity: 4 }).trades).toBe(4);
    expect(largestCarryHub(2)).toBe(14);
    expect(largestHubSolved({ ...CARRY_STATE_DEFAULTS, capacity: 14 })).toBe(true);
    expect(largestHubSolved({ ...CARRY_STATE_DEFAULTS, capacity: 13 })).toBe(false);
    expect(largestHubSolved(CARRY_STATE_DEFAULTS)).toBe(false);
  });
  it('6.2: the basis trade follows the pipeline; the quality trade breaks on a lasting shift', () => {
    expect(runBasis(BASIS_DEFAULTS).result.stats.total).toBeCloseTo(393649, -2);
    expect(idleGrowth()).toBe(20);
    expect(idleGrowthSolved(BASIS_DEFAULTS)).toBe(false);
    expect(idleGrowthSolved({ ...BASIS_DEFAULTS, growth: 20 })).toBe(true);
    expect(idleGrowthSolved({ ...BASIS_DEFAULTS, growth: 15 })).toBe(false);
    expect(runQuality(QUALITY_DEFAULTS).result.stats.total).toBeCloseTo(85323, -2);
    expect(smallestLosingShift()).toBe(16);
    expect(losingShiftSolved(QUALITY_DEFAULTS)).toBe(false);
    expect(losingShiftSolved({ ...QUALITY_DEFAULTS, shift: 16 })).toBe(true);
    expect(losingShiftSolved({ ...QUALITY_DEFAULTS, shift: 17 })).toBe(false);
  });
  it('6.3: most of the crack rule’s profit is the calendar', () => {
    const st = { ...CRACK_STATE_DEFAULTS };
    expect(runCrack(st).stats.total).toBeCloseTo(933600, -3);
    expect(runCrack({ ...st, seasonality: 0, outages: 0 }).turnover).toBe(0);
    const split = splitFor(st);
    expect(split.calendar + split.basis + split.surprise - split.costs).toBeCloseTo(runCrack(st).stats.total, 0);
    expect(split.calendar).toBeGreaterThan(10 * split.surprise);
    expect(stillTradesSolved(st)).toBe(false);
    expect(stillTradesSolved({ ...st, outages: 0, seasonality: 0.6 })).toBe(true);
    expect(stillTradesSolved({ ...st, outages: 0, seasonality: 0.5 })).toBe(false);
    expect(calendarWinsSolved(st)).toBe(false);
    expect(calendarWinsSolved({ ...st, seasonality: 0.7 })).toBe(true);
  });
  it('6.4: a hedge that matches the refinery works; the textbook crack does not', () => {
    const best = bestHedge({ ...HEDGE_DEFAULTS, mix: 'calder' });
    expect(best.ratio).toBeCloseTo(0.883, 2);
    expect(best.effectiveness).toBeGreaterThan(0.7);
    expect(hedgeFor(HEDGE_DEFAULTS).effectiveness).toBeLessThan(-0.9);
    expect(standardCrackSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(standardCrackSolved({ ...HEDGE_DEFAULTS, seasonality: 0 })).toBe(true);
    expect(fastestWtiGrowth()).toBe(30);
    expect(wtiGrowthSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(wtiGrowthSolved({ ...HEDGE_DEFAULTS, mix: 'calder', bench: 'wti', growth: 30 })).toBe(true);
    const q = summarizeQuarters(quartersFor(QUARTER_DEFAULTS));
    expect(q.rmsHedged).toBeLessThan(q.rmsUnhedged / 1.5);
  });
  it('6.5: the book diversifies, each driver breaks its own strategy, and the calendar edge is thin', () => {
    const base = runLab(LAB_DEFAULTS);
    expect(base.stats.total).toBeCloseTo(1438357, -3);
    expect(runLab({ ...LAB_DEFAULTS, kessler: 4 }).totals.basis).toBeCloseTo(base.totals.basis, 6);
    expect(sizingSolved(LAB_DEFAULTS)).toBe(false);
    expect(sizingSolved(TUNED_BOOK)).toBe(true);
    expect(crackSolved(LAB_DEFAULTS)).toBe(false);
    expect(crackSolved({ ...LAB_DEFAULTS, expansion: 'none' })).toBe(true);
    expect(crackShift({ ...LAB_DEFAULTS, rail: 125 }).shift).toBeCloseTo(0, 9);
    const cal = calendarBeforeCosts();
    expect(cal.minGrossAll).toBeGreaterThan(0);
    expect(cal.othersNet).toBeLessThan(cal.othersGross / 5);
  });
});

// ---------------------------------------------------------------------------
// The capstone's business engine.

describe('integrated business', () => {
  const h = oilHistory();
  const withHedges = (production: number, crack: number, base: OilBusiness = BUSINESS_DEFAULTS): OilBusiness => ({ ...base, hedges: { ...base.hedges, production, crack } });
  it('values the production plan as Lesson 2.5 does on a flat price', () => {
    const flat = h.map((w) => ({ ...w, wti: 75 }));
    const onPath = productionOnPath(BUSINESS_DEFAULTS.production, flat);
    const program = runProgram({ wellsPerYear: 20, waterflood: true, price: 75 });
    expect(onPath.npv).toBeCloseTo(program.npv, -3);
    expect(onPath.capitalTotal).toBeCloseTo(program.capital, 0);
    // A drilling threshold above every year's starting price drills nothing.
    expect(productionOnPath({ ...BUSINESS_DEFAULTS.production, drillAbove: 100 }, h).wellsDrilled).toBe(0);
  });
  it('runs Calder at its reference day exactly as Lesson 6.4 did', () => {
    const d = refineryDay(CALDER);
    for (const i of [0, 100, 200]) expect(refineryMargin(h[i], d)).toBeCloseTo(calderMargin(h[i]), -3);
    expect(refineryCapital(CALDER)).toBe(0);
    const bigger = { ...CALDER, capacity: { ...CALDER.capacity, coker: 35 } };
    expect(refineryCapital(bigger)).toBe(300e6);
    expect(refineryDay(bigger).margin).toBeGreaterThan(d.margin);
  });
  it('earns on firm space only when the line congests', () => {
    const firm = (hp = {}) => runBusiness({ ...BUSINESS_DEFAULTS, logistics: { firmSpace: 100 } }, hp).sums.logistics;
    expect(COMMITTED_TARIFF).toBe(3.5);
    expect(firm()).toBeGreaterThan(0);
    expect(firm({ basinGrowth: 20 })).toBeLessThan(0);
  });
  it('is partly hedged by its own refinery, and hedges best as one company', () => {
    const none = runBusiness();
    expect(none.effectiveness).toBe(0);
    // Selling all the production forward leaves the refinery's short crude position exposed.
    expect(runBusiness(withHedges(1, 0)).rmsHedged).toBeGreaterThan(none.rmsSurprise);
    const best = bestHedges();
    expect(best.production).toBeGreaterThan(0.3);
    expect(best.production).toBeLessThan(0.7);
    expect(best.effectiveness).toBeGreaterThan(0.85);
    expect(runBusiness(withHedges(best.production, best.crack)).effectiveness).toBeCloseTo(best.effectiveness, 6);
    const e = exposures(BUSINESS_DEFAULTS, 0);
    expect(e.crude).toBeLessThan(0);
    expect(exposures(BUSINESS_DEFAULTS, 156).crude).toBeGreaterThan(0);
  });
  it('spreads across histories and keeps plans valid', () => {
    const f = businessFan();
    expect(f.totals.length).toBe(30);
    expect(f.total.p10).toBeLessThan(f.total.p90);
    expect(f.quarters.length).toBe(20);
    const s = sanitizeBusiness({ production: { wellsPerYear: 999, waterflood: 'yes' }, refinery: { capacity: { coker: 33 } }, hedges: { mix: 'nope', crack: -1 } });
    expect(s.production.wellsPerYear).toBe(60);
    expect(s.production.waterflood).toBe(true);
    expect(s.refinery.capacity.coker).toBe(35);
    expect(s.refinery.capacity.cdu).toBe(150);
    expect(s.hedges.mix).toBe('calder');
    expect(s.hedges.crack).toBe(0);
    expect(sanitizeBusiness(null)).toEqual(BUSINESS_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// Chapter 7 lessons.

describe('chapter 7 lessons', () => {
  const plan = BUSINESS_DEFAULTS.production;
  it('7.1: the fast valuation matches the engine, and the challenges have exact answers', () => {
    for (const p of [plan, { ...plan, drillAbove: 65 }]) {
      const fast = fanValuations(p, WORLD_DEFAULTS);
      [2024, 1, 2, 3, 4, 5].forEach((seed, i) => {
        expect(fast[i].at75).toBeCloseTo(productionOnPath(p, oilHistory({ ...worldParams(WORLD_DEFAULTS), seed })).npv, -2);
      });
    }
    expect(cheapestTargetPlan().plan).toEqual({ wellsPerYear: 10, waterflood: true, drillAbove: 0 });
    expect(cheapestPlanSolved(plan)).toBe(false);
    expect(cheapestPlanSolved({ wellsPerYear: 10, waterflood: true, drillAbove: 0 })).toBe(true);
    expect(cheapestPlanSolved({ wellsPerYear: 5, waterflood: true, drillAbove: 0 })).toBe(false);
    expect(luckAnswer(plan)).toBe(67);
    expect(luckSolved(plan, { ...DECK_DEFAULTS, longRun: 67 })).toBe(true);
    expect(luckSolved(plan, DECK_DEFAULTS)).toBe(false);
  });
  it('7.2: the crude unit and hydrotreater beat the coker unless fuel oil cheapens for good', () => {
    expect(designValue(COKER_TEST).npv).toBeLessThan(0);
    expect(designValue(designOf({ cdu: 180 })).npv).toBeGreaterThan(0);
    const best = bestWithinBudget();
    expect(best.config.capacity.cdu).toBe(170);
    expect(best.config.capacity.dht).toBe(65);
    expect(budgetSolved(best.config)).toBe(true);
    expect(budgetSolved(CALDER)).toBe(false);
    expect(smallestShift()).toBe(12);
    expect(shiftSolved({ ...HISTORY_STATE_DEFAULTS, shift: 12 })).toBe(true);
    expect(shiftSolved({ ...HISTORY_STATE_DEFAULTS, shift: 11 })).toBe(false);
  });
  it('7.3: firm space pays when the basin outgrows the line, and about 40 kb/d steadies the basis', () => {
    expect(slowestPayingGrowth()).toBe(50);
    expect(slowestPayingSolved({ ...CHAIN_DEFAULTS, growth: 50 }, 10)).toBe(true);
    expect(slowestPayingSolved({ ...CHAIN_DEFAULTS, growth: 40 }, 10)).toBe(false);
    expect(slowestPayingSolved({ ...CHAIN_DEFAULTS, growth: 50 }, 0)).toBe(false);
    expect(steadiestFirmSpace(plan, SWEEP_DEFAULTS)).toBe(40);
    expect(steadiestSolved(40, plan, SWEEP_DEFAULTS)).toBe(true);
    expect(steadiestSolved(30, plan, SWEEP_DEFAULTS)).toBe(false);
  });
  it('7.4: the spread is forecastable with enough pipeline; outages widen the cash band', () => {
    expect(fastestSteadyGrowth()).toBe(30);
    expect(steadyBasisSolved({ ...DESK_DRIVERS, growth: 30 })).toBe(true);
    expect(steadyBasisSolved({ ...DESK_DRIVERS, growth: 40 })).toBe(false);
    expect(narrowBandSolved({ ...CASH_DEFAULTS, plan: 'start' }, BUSINESS_DEFAULTS)).toBe(false);
    expect(narrowBandSolved({ ...CASH_DEFAULTS, plan: 'start', refinery: 0 }, BUSINESS_DEFAULTS)).toBe(true);
  });
  it('7.5: the company hedges best as one, with a crack that matches its refinery', () => {
    const best = bestAnyHedges(BUSINESS_DEFAULTS);
    expect(best.mix).toBe('calder');
    expect(best.bench).toBe('brent');
    expect(best.effectiveness).toBeGreaterThan(0.9);
    expect(hedgesSolved(BUSINESS_DEFAULTS, TRADER_DRIVERS)).toBe(false);
    expect(hedgesSolved(withHedges(BUSINESS_DEFAULTS, 0.5, 0.75, 'calder', 'brent'), TRADER_DRIVERS)).toBe(true);
    expect(hedgesSolved(withHedges(BUSINESS_DEFAULTS, 0.5, 0.75, '3:2:1', 'brent'), TRADER_DRIVERS)).toBe(false);
    expect(harderWorldSolved(BUSINESS_DEFAULTS, { ...TRADER_DRIVERS, seasonality: 0 })).toBe(true);
    expect(harderWorldSolved(BUSINESS_DEFAULTS, TRADER_DRIVERS)).toBe(false);
  });
});
