// Chapter 4 of the oil course: the numbers the lessons quote, and the challenges as redesigned in
// the second fix pass (predict first, then check).

import { describe, expect, it } from 'vitest';
import { costPerBarrel, hydraulics, maxFlow } from '../src/engines/oil/pipeline';
import { cheapestSpeed, ladenDays, voyage } from '../src/engines/oil/tanker';
import { crudeBreakeven, crudeNetback, standaloneValue } from '../src/engines/oil/arbitrage';
import { monthlyCarry, DEFAULT_STORAGE } from '../src/engines/oil/storage';
import { NETWORK_DEFAULTS, nodePrices } from '../src/engines/oil/network';
import { planRefinery } from '../src/engines/oil/refinery';
import { CAPITAL_CHARGE, KESSLER_CORRAN, TYPICAL_CRUDE, VESSELS } from '../src/model/oil/logistics';
import { CORRAN, CRUDE_PRICE } from '../src/model/oil/refinery';
import { CRUDE_IDS } from '../src/model/oil/crudes';
import { FLUIDS, UPKEEP, lowestCovering, maxCapitalCovered, northfieldMaxSolved, tariffSolved } from '../src/lessons/oil/ch4/L4_1';
import { CHALLENGE_BUNKER, CHALLENGE_HIRE, VOYAGE_DEFAULTS, atReferencePrices, cheapestSpeedSolved, lighteringSolved, scaleCost } from '../src/lessons/oil/ch4/L4_2';
import { TERMINAL_DEFAULTS, carryParityRate, highestRateSolved, terminalPlan } from '../src/lessons/oil/ch4/L4_3';
import { DOUBLED_RAIL, collapseAt, pipelineSolved, spreadAt, trappedSolved } from '../src/lessons/oil/ch4/L4_4';
import {
  CHALLENGE_ROUTE,
  COKER_DEFAULT,
  LEG_COST,
  REFERENCE_ROUTE,
  arbFor,
  arbSolved,
  differentialsAt,
  freightFor,
  highestOpen,
  qualitySolved,
  speedFor,
} from '../src/lessons/oil/ch4/L4_5';

const D = NETWORK_DEFAULTS;
const RAIL = { leg: 'rail' as const, dredged: false };
const DREDGED = { leg: 'pipe' as const, dredged: true };

describe('oil chapter 4', () => {
  it('4.1: the model switches from laminar to turbulent at a Reynolds number of 2,300', () => {
    const at = (kbd: number) => hydraulics(KESSLER_CORRAN, FLUIDS.coldwater, kbd * 1000);
    expect(at(235).regime).toBe('laminar');
    expect(at(235).reynolds).toBeLessThan(2300);
    expect(at(240).regime).toBe('turbulent');
    expect(at(240).reynolds).toBeGreaterThan(2300);
    expect(at(200).psiPerMile).toBeCloseTo(3.42, 2);
    expect(at(250).psiPerMile).toBeCloseTo(7.69, 2);
  });

  it('4.2: the dock limit applies to discharging at Port Corran too', () => {
    // A VLCC bringing Seaboard Blend in lighters its second million barrels: $0.30 a barrel more.
    expect(voyage({ vessel: 'vlcc', route: 'seaboard', speed: 13 }).lightering).toBe(600000);
    expect(voyage({ vessel: 'suezmax', route: 'seaboard', speed: 13 }).lightering).toBe(0);
    expect(scaleCost('vlcc', 'seaboard', 0.6, true)).toBeCloseTo(0.588, 3);
    expect(scaleCost('vlcc', 'seaboard', 0.6, false)).toBeCloseTo(0.888, 3);
    expect(scaleCost('suezmax', 'seaboard', 0.6, false)).toBeCloseTo(0.913, 3);
    // "only just ahead of the Suezmax"
    expect(scaleCost('vlcc', 'seaboard', 0.6, false)).toBeLessThan(scaleCost('suezmax', 'seaboard', 0.6, false));
    // Exports are unchanged.
    expect(voyage({ vessel: 'vlcc', route: 'eastbay', speed: 13 }).perBbl).toBeCloseTo(3.458, 3);
    expect(scaleCost('vlcc', 'northport', 0.6, false)).toBeCloseTo(1.732, 3);
    expect(lighteringSolved(1.7, false)).toBe(true);
    expect(lighteringSolved(1.65, false)).toBe(false);
  });

  it('4.3: storage is nearly all or nothing', () => {
    const at = (slope: number) => terminalPlan({ slope, seasonal: 0, fee: 0.4, rate: 6 });
    expect(Math.max(...at(0.8).inventory)).toBeCloseTo(0, 3);
    expect(Math.max(...at(0.82).inventory) / 1e6).toBeCloseTo(16, 3);
    expect(Math.max(...at(0.85).inventory) / 1e6).toBeCloseTo(20, 3);
  });

  it('4.4: the inland link, the floor and challenge a’s success text', () => {
    const p = nodePrices();
    expect(p.inland - p.kessler).toBeCloseTo(0.3, 6);
    // With room to spare, the spread is the tariff plus the Eastbay freight less Eastbay's premium.
    expect(spreadAt(700, 710)).toBeCloseTo(D.pipelineTariff + D.freightCorranEastbay - D.eastbayPremium, 6);
    expect(spreadAt(700, 710)).toBeCloseTo(3.7, 6);
    expect(pipelineSolved({ basin: 700, pipeline: 710, rail: 0 })).toBe(true);
    expect(nodePrices({ ...D, basinSupply: 630 }).kessler).toBeCloseTo(D.floor + D.coldwaterTariff, 6);
  });

  it('4.5: ships sail at their cheapest speed; the band follows the route to the coast', () => {
    expect(speedFor('vlcc')).toBeCloseTo(cheapestSpeed('vlcc'), 9);
    expect(ladenDays('northport', speedFor('aframax'))).toBeCloseTo(17.11, 2);
    expect(ladenDays('northport', speedFor('vlcc'))).toBeCloseTo(17.88, 2);
    // The freights are 4.2's second figure's bars.
    expect(freightFor('vlcc')).toBeCloseTo(scaleCost('vlcc', 'northport', 0.6, false), 9);
    expect(freightFor('vlcc', true)).toBeCloseTo(scaleCost('vlcc', 'northport', 0.6, true), 9);
    expect(freightFor('aframax')).toBeCloseTo(2.563, 3);
    // The reference case.
    expect(arbFor('aframax', 74.5, 79).delivered).toBeCloseTo(79.72, 2);
    expect(arbFor('aframax', 74.5, 79).margin).toBeCloseTo(-0.876, 3);
    expect(arbFor('suezmax', 74.5, 79).margin).toBeCloseTo(-0.59, 2);
    expect(arbFor('vlcc', 74.5, 79).margin).toBeCloseTo(-0.055, 3);
    expect(highestOpen('aframax')).toBe(73.6);
    expect(highestOpen('suezmax')).toBe(73.9);
    expect(highestOpen('vlcc')).toBe(74.4);
    // Dredging opens the VLCC's arb at the starting prices and narrows the band by about 30 cents.
    expect(arbFor('vlcc', 74.5, 79, DREDGED).margin).toBeCloseTo(0.245, 3);
    expect(highestOpen('vlcc', 79, DREDGED)).toBe(74.7);
    // A full pipeline sends the next barrel by rail: about $8 more, and a band of $12.60.
    expect(LEG_COST.rail - LEG_COST.pipe).toBe(8);
    expect(arbFor('vlcc', 74.5, 79, RAIL).delivered - arbFor('vlcc', 74.5, 79).delivered).toBeCloseTo(8.02, 2);
    expect(highestOpen('vlcc', 79, RAIL)).toBe(66.4);
    expect(79 - highestOpen('vlcc', 79, RAIL)).toBeCloseTo(12.6, 6);
    expect(79 - highestOpen('vlcc')).toBeCloseTo(4.6, 6);
  });

  it('4.5: challenge a needs the rail route', () => {
    expect(arbSolved('aframax', 74.5, 79, REFERENCE_ROUTE)).toBe(false);
    expect(arbSolved('vlcc', 74.4, 79, REFERENCE_ROUTE)).toBe(false);
    expect(arbSolved('vlcc', 66.4, 79, RAIL)).toBe(true);
    expect(arbSolved('vlcc', 74.7, 79, DREDGED)).toBe(false);
  });

  it('4.5: stand-alone values against Lesson 3.5’s marginal values', () => {
    expect(standaloneValue('pinyon')).toBeCloseTo(88.32, 2);
    expect(standaloneValue('seaboard')).toBeCloseTo(88.53, 2);
    expect(standaloneValue('northfield')).toBeCloseTo(84.82, 2);
    expect(standaloneValue('coldwater')).toBeCloseTo(75.3, 2);
    expect(crudeNetback).toBe(standaloneValue);
    expect(crudeBreakeven('pinyon')).toBeCloseTo(80.02, 2);
    expect(crudeBreakeven('coldwater')).toBeCloseTo(68.7, 2);
    // Stand-alone values run higher than marginal ones.
    for (const k of ['pinyon', 'northfield', 'coldwater'] as const) expect(standaloneValue(k)).toBeGreaterThan(crudeBreakeven(k));
    // Northfield: cheap for its quality on its own, yet worth less than its price at the margin.
    const d = differentialsAt(62, 106);
    expect(d.northfield - (CRUDE_PRICE.northfield - CRUDE_PRICE.pinyon)).toBeCloseTo(0.99, 2);
    expect(CRUDE_PRICE.northfield - crudeBreakeven('northfield')).toBeCloseTo(2.23, 2);
    expect(d.seaboard).toBeCloseTo(0.21, 2);
    expect(d.coldwater).toBeCloseTo(-13.03, 2);
    // Challenge b is unchanged.
    expect(qualitySolved(62, 106)).toBe(false);
    expect(qualitySolved(58, 106)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Pass 2: the redesigned challenges and the numbers their prompts and success texts quote.

  it('4.1a: predict how much six times the viscosity costs, then find Northfield’s limit', () => {
    const cap = (k: keyof typeof FLUIDS) => maxFlow(KESSLER_CORRAN, FLUIDS[k]) / 1000;
    expect(Math.round(FLUIDS.mix.viscosity / FLUIDS.pinyon.viscosity)).toBe(2);
    expect(Math.round((1 - cap('mix') / cap('pinyon')) * 100)).toBe(7);
    expect(Math.round(FLUIDS.northfield.viscosity / FLUIDS.mix.viscosity)).toBe(6);
    // Far less than half: about a fifth.
    expect(Math.round((1 - cap('northfield') / cap('mix')) * 100)).toBe(21);
    const f = (k: keyof typeof FLUIDS) => hydraulics(KESSLER_CORRAN, FLUIDS[k], 400000).friction;
    expect(Math.round((f('northfield') / f('mix') - 1) * 100)).toBe(45);
    // The default state is unsolved; the answer solves; near misses don't.
    expect(northfieldMaxSolved('mix', 400, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 380, 3)).toBe(true);
    expect(northfieldMaxSolved('northfield', 375, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 385, 3)).toBe(false);
    expect(northfieldMaxSolved('northfield', 380, 4)).toBe(false);
  });

  it('4.1b: estimate the throughput from the yearly cost, then check', () => {
    expect(UPKEEP).toBe(30e6);
    const yearly = KESSLER_CORRAN.capital * CAPITAL_CHARGE + UPKEEP;
    expect(yearly).toBe(246e6);
    expect(Math.round(yearly / 365 / 1.95 / 1000)).toBe(346);
    expect(costPerBarrel(KESSLER_CORRAN, TYPICAL_CRUDE, 350000).energy * 100).toBeCloseTo(6.2, 1);
    expect(tariffSolved(300, 1.8)).toBe(false);
    expect(tariffSolved(350, 1.8)).toBe(true);
    expect(tariffSolved(345, 1.8)).toBe(false);
    expect(tariffSolved(355, 1.8)).toBe(false);
    expect(tariffSolved(350, 1.9)).toBe(false);
  });

  it('4.1: what the line cost to build', () => {
    expect(lowestCovering(1.8)).toBe(350);
    expect(lowestCovering(2.0)).toBe(385);
    expect(lowestCovering(2.2)).toBe(425);
    expect(lowestCovering(2.4)).toBeLessThanOrEqual(480);
    expect(lowestCovering(2.5)).toBeNaN();
    expect(maxCapitalCovered()).toBeCloseTo(2.5, 1);
    expect(costPerBarrel({ ...KESSLER_CORRAN, capital: 2.6e9 }, TYPICAL_CRUDE, 480000).total).toBeCloseTo(2.07, 2);
  });

  it('4.2a: predict the cheapest speed in a dear market, then check', () => {
    const v = { ...VOYAGE_DEFAULTS, vessel: 'vlcc' as const, route: 'eastbay' as const, hire: CHALLENGE_HIRE, bunker: CHALLENGE_BUNKER };
    expect(cheapestSpeed('vlcc', CHALLENGE_HIRE, CHALLENGE_BUNKER)).toBeCloseTo(13.82, 2);
    expect(Math.cbrt(CHALLENGE_HIRE / VESSELS.vlcc.hire / (CHALLENGE_BUNKER / 600))).toBeCloseTo(1.19, 2);
    expect(cheapestSpeedSolved(VOYAGE_DEFAULTS)).toBe(false);
    expect(cheapestSpeedSolved({ ...v, speed: 13.8 })).toBe(true);
    expect(cheapestSpeedSolved({ ...v, speed: 13.7 })).toBe(false);
    expect(cheapestSpeedSolved({ ...v, speed: 13.9 })).toBe(false);
    // The old answer, at the old prices, no longer solves.
    expect(cheapestSpeedSolved({ ...v, hire: VESSELS.vlcc.hire, bunker: 600, speed: 11.7 })).toBe(false);
    // The marker shows at the reference prices only, until the challenge is solved.
    expect(atReferencePrices(VOYAGE_DEFAULTS)).toBe(true);
    expect(atReferencePrices(v)).toBe(false);
    // Sailing at the old best speed in the dear market costs about 15 cents a barrel more.
    const best = voyage({ vessel: 'vlcc', route: 'eastbay', speed: cheapestSpeed('vlcc', CHALLENGE_HIRE, CHALLENGE_BUNKER), hire: CHALLENGE_HIRE, bunker: CHALLENGE_BUNKER });
    const old = voyage({ vessel: 'vlcc', route: 'eastbay', speed: cheapestSpeed('vlcc'), hire: CHALLENGE_HIRE, bunker: CHALLENGE_BUNKER });
    expect(old.perBbl - best.perBbl).toBeCloseTo(0.15, 2);
    expect(Math.round(((old.perBbl - best.perBbl) * VESSELS.vlcc.cargo) / 1000) * 1000).toBe(299000);
  });

  it('4.2b: estimate the lightering break-even from the free-channel freights', () => {
    const lead = scaleCost('suezmax', 'northport', 0, true) - scaleCost('vlcc', 'northport', 0, true);
    expect(lead).toBeCloseTo(0.85, 2);
    expect(lead / 0.5).toBeCloseTo(1.69, 2);
    // From the bars' two-decimal labels: ($2.28 − $1.43) ÷ ½ = $1.70.
    expect((2.28 - 1.43) / 0.5).toBeCloseTo(1.7, 9);
    expect(lighteringSolved(0.6)).toBe(false);
    expect(lighteringSolved(1.7)).toBe(true);
    expect(lighteringSolved(1.65)).toBe(false);
    expect(lighteringSolved(1.75)).toBe(false);
  });

  it('4.3a: estimate the rate from the carry, then find the real limit below it', () => {
    expect(carryParityRate()).toBeCloseTo(9.6, 9);
    expect(monthlyCarry(75, { ...DEFAULT_STORAGE, rate: 0.085 })).toBeCloseTo(0.931, 3);
    expect(highestRateSolved(TERMINAL_DEFAULTS)).toBe(false);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 8.5 })).toBe(true);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 8 })).toBe(false);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 9 })).toBe(false);
    expect(highestRateSolved({ slope: 1, seasonal: 0, fee: 0.4, rate: 9.5 })).toBe(false);
    expect(terminalPlan({ slope: 1, seasonal: 0, fee: 0.4, rate: 9 }).profit).toBeCloseTo(0, 0);
  });

  it('4.4b: predict where Kessler collapses when the rail doubles', () => {
    expect(DOUBLED_RAIL).toBe(300);
    expect(collapseAt(D.rail)).toBe(630);
    expect(collapseAt(DOUBLED_RAIL)).toBe(780);
    // The ways out: inland refineries, pipe and rail, against the basin plus Coldwater.
    expect(D.inlandDemand + D.pipeline + DOUBLED_RAIL).toBe(780 + D.coldwaterSupply);
    expect(spreadAt(770, D.pipeline, DOUBLED_RAIL)).toBeCloseTo(11.7, 6);
    const st = { basin: D.basinSupply, pipeline: D.pipeline, rail: D.rail };
    expect(trappedSolved(st)).toBe(false);
    expect(trappedSolved({ ...st, basin: 780, rail: 300 })).toBe(true);
    expect(trappedSolved({ ...st, basin: 770, rail: 300 })).toBe(false);
    expect(trappedSolved({ ...st, basin: 790, rail: 300 })).toBe(false);
    expect(trappedSolved({ ...st, basin: 780 })).toBe(false);
    expect(trappedSolved({ ...st, basin: 630 })).toBe(false);
    expect(trappedSolved({ basin: 780, pipeline: 490, rail: 300 })).toBe(false);
  });

  it('4.5a: predict the rail case from the VLCC’s margin, then check', () => {
    expect(CHALLENGE_ROUTE).toEqual(RAIL);
    // The prediction: $74.50 less the VLCC's 5 cents less $8 lands between 66.4 and 66.5.
    expect(74.5 + arbFor('vlcc', 74.5, 79).margin - 8).toBeCloseTo(66.445, 3);
    expect(arbFor('vlcc', 66.4, 79, RAIL).margin).toBeCloseTo(0.046, 3);
    expect(arbFor('vlcc', 66.5, 79, RAIL).margin).toBeCloseTo(-0.055, 3);
    expect(highestOpen('suezmax', 79, RAIL)).toBe(65.9);
    expect(highestOpen('aframax', 79, RAIL)).toBe(65.6);
    expect(arbSolved('aframax', 74.5, 79, REFERENCE_ROUTE)).toBe(false);
    expect(arbSolved('vlcc', 66.4, 79, RAIL)).toBe(true);
    expect(arbSolved('vlcc', 66.5, 79, RAIL)).toBe(false);
    expect(arbSolved('vlcc', 66.3, 79, RAIL)).toBe(false);
    expect(arbSolved('suezmax', 66.4, 79, RAIL)).toBe(false);
    expect(arbSolved('vlcc', 66.4, 79.1, RAIL)).toBe(false);
    // The band works from either end: a dime more at Northport opens the VLCC's arb.
    expect(arbFor('vlcc', 74.5, 79).margin).toBeLessThan(0);
    expect(arbFor('vlcc', 74.5, 79.1).margin).toBeGreaterThan(0);
  });

  it('4.5b: estimate the fuel-oil price from the slope, then check', () => {
    const slope = (differentialsAt(62, 106).coldwater - differentialsAt(30, 106).coldwater) / 32;
    expect(Math.round(slope * 100)).toBe(36);
    expect(Math.round((differentialsAt(62, 106).coldwater + 14.5) / slope)).toBe(4);
    expect(qualitySolved(62, 106)).toBe(false);
    expect(qualitySolved(58, 106)).toBe(true);
    expect(qualitySolved(57, 106)).toBe(false);
    expect(qualitySolved(59, 106)).toBe(false);
    expect(qualitySolved(58, 106, 15)).toBe(false);
    expect(qualitySolved(58, 106, COKER_DEFAULT)).toBe(true);
  });

  it('4.5: the coker control', () => {
    expect(COKER_DEFAULT).toBe(25);
    const gap = (coker: number, h = 62) => differentialsAt(h, 106, coker).coldwater;
    expect(gap(COKER_DEFAULT)).toBeCloseTo(-13.03, 2);
    expect(gap(15)).toBeCloseTo(-17.36, 2);
    expect(gap(35)).toBeCloseTo(-9.83, 2);
    expect(gap(40)).toBeCloseTo(gap(35), 6);
    expect(gap(15, 80) - gap(15, 30)).toBeCloseTo(25.32, 2);
    expect(gap(25, 80) - gap(25, 30)).toBeCloseTo(17.47, 2);
    expect(gap(35, 80) - gap(35, 30)).toBeCloseTo(10.8, 2);
    // Past about 34 kb/d the sulfur plant, not the coker, is what's full.
    const avail = Object.fromEntries(CRUDE_IDS.map((c) => [c, c === 'coldwater' ? CORRAN.capacity.cdu : 0]));
    const big = planRefinery({ config: { ...CORRAN, capacity: { ...CORRAN.capacity, coker: 40 } }, crudeAvailable: avail, crudePrice: { coldwater: 0 } });
    expect(big.unitFeed.coker).toBeCloseTo(34.3, 1);
    expect(big.sulfurPlant).toBeCloseTo(CORRAN.sulfurPlant, 3);
  });
});
