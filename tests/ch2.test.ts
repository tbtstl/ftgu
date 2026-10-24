// Chapter 2: the new engines, the numbers quoted in the lessons' prose, and the reachability of
// every challenge with the controls' ranges and steps.

import { describe, expect, it } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MIX_FUELS, STANDARD_MIX, crossoverHours, evaluateMix, MIX_TECH, type Mix } from '../src/engines/ops/genmix';
import { energizeFeeders } from '../src/engines/ops/feeder';
import { lineLoss } from '../src/engines/physics/losses';
import { checkTransformers, substationLoad } from '../src/engines/ops/substation';
import { islandFlows, overloadedLines, runCascade, scanContingencies, type GridUnit } from '../src/engines/ops/cascade';
import { regionCase } from '../src/engines/ops/regionGrid';
import { THREE_NODE, REGION } from '../src/model/networks';
import type { Network } from '../src/model/types';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import {
  BUILDER_RANGE,
  CC_AT_BASELOAD,
  NUCLEAR_CARBON,
  NUC_AT_BASELOAD,
  SCREENING_DEFAULTS,
  builderSolved,
  carbonSolved,
  cheapestAt,
} from '../src/lessons/ch2/L2_1';
import { CHAIN_DEFAULTS, CIRCUITS_AT_138, SECTIONS, chain, circuitsSolved, cutOff, feederState, restorationSolved } from '../src/lessons/ch2/L2_2';
import { DATA_CENTER_MW, EXISTING_CHECK, EXISTING_LOAD, FEEDER_MVA, SUBSTATION_DEFAULTS, feederCount, minimumInstalled, substationSolved } from '../src/lessons/ch2/L2_3';
import { SCALE_BAR } from '../src/lessons/shared/RegionMap';
import { DEFAULT_ANGLES, DEG_PER_MW, STIFF_ANGLES, WM_RANGE, transferFlows, triangleAngles, triangleFlows, zeroFlowSolved } from '../src/lessons/ch2/L2_4';
import {
  INTO_METRO,
  LOWEST_SAFE_RATING,
  PLAYGROUND_DEFAULTS,
  RATING_RANGE,
  REFERENCE_IMPORTS,
  TANK_RATING,
  TANK_SHARE,
  heatWaveSolved,
  limitsAt,
  metroImports,
  playground,
} from '../src/lessons/ch2/L2_5';
import { MERIT_COST, SECURE_COST, STORM, STORM_LOST_LOAD, cascadeCase, securityCase, stormSolved } from '../src/lessons/ch2/L2_6';

const WEATHER = { demand: SYSTEM_DEMAND, wind: WIND_CF, solar: SOLAR_CF };

describe('genmix engine and lesson 2.1', () => {
  const base = evaluateMix(STANDARD_MIX, WEATHER);

  it('totals the standard fleet by technology', () => {
    expect(STANDARD_MIX).toEqual({ nuclear: 400, wind: 350, solar: 400, hydro: 150, coal: 300, gasCC: 650, gasCT: 200, oil: 80 });
    expect(base.nameplate).toBe(2530);
    expect(base.firm).toBeCloseTo(1602.5);
    expect(base.peak).toBe(1440);
  });

  it('dispatches the reference day with the numbers quoted in the prose', () => {
    expect(base.unserved).toBe(0);
    expect(base.curtailed).toBeCloseTo(0);
    expect(Math.round(base.totalCost)).toBe(1775105);
    expect(Math.round(base.fixedCost)).toBe(1402740);
    expect(base.fixedCost / base.totalCost).toBeCloseTo(0.79, 2);
    expect(Math.round(base.fixedBy.nuclear)).toBe(602740);
    expect(Math.round(base.emissions)).toBe(5836);
    expect(base.capacityFactor.nuclear).toBeCloseTo(1);
    expect(base.capacityFactor.hydro).toBeCloseTo(1);
    expect(Math.round(base.capacityFactor.wind * 100)).toBe(37);
    expect(Math.round(base.capacityFactor.solar * 100)).toBe(26);
    expect(Math.round(base.capacityFactor.coal * 100)).toBe(71);
    expect(Math.round(base.capacityFactor.gasCC * 100)).toBe(13);
    expect(base.energy.gasCT).toBe(0);
    expect(base.energy.oil).toBe(0);
    // Coal is the last plant on overnight; gas in the evening.
    for (const h of [0, 1, 2, 3, 4, 5]) expect(base.hours[h].marginal).toBe('coal');
    for (const h of [17, 18, 19, 20, 21]) expect(base.hours[h].marginal).toBe('gasCC');
  });

  it('idle peakers save money but leave firm capacity short', () => {
    const r = evaluateMix({ ...STANDARD_MIX, gasCT: 0, oil: 0 }, WEATHER);
    expect(Math.round((base.totalCost - r.totalCost) / 1000)).toBe(55);
    expect(r.unserved).toBe(0);
    expect(r.firm).toBeLessThan(1440);
  });

  it('wind and solar roughly pay for themselves', () => {
    const r = evaluateMix({ ...STANDARD_MIX, wind: 0, solar: 0 }, WEATHER);
    expect(Math.round((base.totalCost - r.totalCost) / 1000)).toBe(12);
    expect(Math.round(r.emissions - base.emissions)).toBe(3178);
  });

  it('the builder challenge is reachable on the sliders’ grid, and the default does not solve it', () => {
    expect(builderSolved(base)).toBe(false);
    const answer: Mix = { nuclear: 400, coal: 0, gasCC: 650, gasCT: 350, oil: 80, hydro: 150, wind: 800, solar: 600 };
    for (const f of MIX_FUELS) {
      expect(answer[f] % 10).toBe(0);
      expect(answer[f]).toBeLessThanOrEqual(BUILDER_RANGE[f]);
    }
    expect(builderSolved(evaluateMix(answer, WEATHER))).toBe(true);
  });

  it('fleets that pass the builder challenge can cost nearly a quarter less than the region’s', () => {
    // Found by a local search over the sliders' 10 MW grid; the cheapest it found.
    const cheap: Mix = { nuclear: 0, coal: 0, gasCC: 610, gasCT: 510, oil: 500, hydro: 0, wind: 1980, solar: 810 };
    for (const f of MIX_FUELS) expect(cheap[f]).toBeLessThanOrEqual(BUILDER_RANGE[f]);
    const r = evaluateMix(cheap, WEATHER);
    expect(builderSolved(r)).toBe(true);
    const saving = 1 - r.totalCost / base.totalCost;
    expect(saving).toBeGreaterThan(0.23);
    expect(saving).toBeLessThan(0.25);
  });

  it('the map’s scale bar puts Central and Metro about 100 km apart, like the line between them', () => {
    const c = REGION.nodes.find((n) => n.id === 'center')!;
    const m = REGION.nodes.find((n) => n.id === 'city')!;
    const km = Math.hypot(m.x - c.x, m.y - c.y) * (SCALE_BAR.km / SCALE_BAR.units);
    expect(REGION.lines.find((l) => l.id === 'center-city')!.lengthKm).toBe(100);
    expect(Math.abs(km - 100)).toBeLessThan(1);
  });

  it('stays finite at the sliders’ extremes', () => {
    const none = evaluateMix({}, WEATHER);
    const max = evaluateMix(BUILDER_RANGE, WEATHER);
    for (const r of [none, max]) {
      for (const v of [r.totalCost, r.emissions, r.unserved, r.curtailed, r.firm, ...MIX_FUELS.map((f) => r.capacityFactor[f])]) expect(Number.isFinite(v)).toBe(true);
    }
    expect(none.unserved).toBeCloseTo(SYSTEM_DEMAND.reduce((s, v) => s + v, 0));
    expect(max.overGeneration).toBe(0);
  });

  it('screening curves cross where the prose says', () => {
    expect(Math.round(crossoverHours(MIX_TECH.gasCT, MIX_TECH.oil))).toBe(390);
    expect(Math.round(crossoverHours(MIX_TECH.gasCC, MIX_TECH.gasCT))).toBe(769);
    expect(crossoverHours(MIX_TECH.nuclear, MIX_TECH.gasCC)).toBeGreaterThan(8760);
    expect(crossoverHours(MIX_TECH.coal, MIX_TECH.gasCC)).toBeGreaterThan(8760);
    expect(MIX_TECH.wind.fixedCost / ((WIND_CF.reduce((s, v) => s + v, 0) / 24) * 8760)).toBeCloseTo(36.7, 1);
    expect(MIX_TECH.solar.fixedCost / ((SOLAR_CF.reduce((s, v) => s + v, 0) / 24) * 8760)).toBeCloseTo(34.6, 1);
  });

  it('the carbon-price challenge has a unique whole-dollar answer in range, and the question gives what’s needed to work it out', () => {
    expect(NUCLEAR_CARBON).toBe(94);
    expect(cheapestAt(7000, 93)).toBe('gasCC');
    expect(cheapestAt(7000, 94)).toBe('nuclear');
    expect(cheapestAt(8000, 0)).toBeDefined();
    expect(carbonSolved(SCREENING_DEFAULTS.carbon)).toBe(false);
    expect(SCREENING_DEFAULTS.hours).toBe(7000);
    expect(carbonSolved(94)).toBe(true);
    expect(carbonSolved(95)).toBe(false);
    // The question's numbers: the gap divided by gas's emissions, rounded up, is the answer.
    expect(CC_AT_BASELOAD.toFixed(2)).toBe('53.14');
    expect(NUC_AT_BASELOAD.toFixed(2)).toBe('87.57');
    expect(MIX_TECH.gasCC.emissions).toBe(0.37);
    expect(MIX_TECH.nuclear.emissions).toBe(0);
    expect(Math.ceil((NUC_AT_BASELOAD - CC_AT_BASELOAD) / MIX_TECH.gasCC.emissions)).toBe(NUCLEAR_CARBON);
  });

  it('the builder shows the cost of the day as 79% fixed', () => {
    expect(Math.round((base.fixedCost / base.totalCost) * 100)).toBe(79);
  });
});

describe('lesson 2.2: the voltage ladder and radial feeders', () => {
  it('quotes the right losses', () => {
    const c = chain(345, 1, 13.8);
    expect(c.tx.share).toBeCloseTo(0.0076, 4);
    expect(c.fd.lossShare).toBeCloseTo(0.0236, 4);
    expect(c.sv.lossShare).toBeCloseTo(0.0167, 4);
    expect(c.delivered).toBeCloseTo(0.953, 3);
    expect(chain(69, 1, 13.8).tx.share).toBeCloseTo(0.189, 3);
    expect(chain(345, 1, 4.16).fd.lossShare).toBeCloseTo(0.26, 2);
    expect(c.fd.lossShare / c.tx.share).toBeCloseTo(3.1, 1);
    // Loss share = P·R/V²: a sixtieth of the power, 0.9 Ω against 3 Ω, and 625 times the 1/V².
    expect(c.fd.ohms).toBeCloseTo(0.9);
    expect(lineLoss({ sendMW: 300, kV: 345, lengthKm: 100, ohmPerKm: 0.03 }).ohms).toBeCloseTo(3);
    expect((345 / 13.8) ** 2).toBeCloseTo(625);
    expect(c.fd.lossShare / c.tx.share).toBeCloseTo((5 / 300) * (0.9 / 3) * 625, 6);
    expect(chain(69, 1, 13.8).tx.share / c.tx.share).toBeCloseTo(25, 6);
  });

  it('needs five 138 kV circuits to beat 1%, as the challenge’s reasoning says', () => {
    expect(CIRCUITS_AT_138).toBe(5);
    expect(chain(138, 4, 13.8).tx.share).toBeGreaterThan(0.01);
    // One circuit at 138 kV loses 2.5² = 6.25 times the share at 345 kV, 4.73%; five circuits divide it by five.
    expect(chain(138, 1, 13.8).tx.share / chain(345, 1, 13.8).tx.share).toBeCloseTo(6.25, 6);
    expect(chain(138, 1, 13.8).tx.share).toBeCloseTo(0.0473, 4);
    expect(chain(138, 5, 13.8).tx.share).toBeCloseTo(0.00945, 5);
    expect(circuitsSolved(CHAIN_DEFAULTS)).toBe(false);
    expect(circuitsSolved({ txKV: '138', circuits: 4 })).toBe(false);
    expect(circuitsSolved({ txKV: '138', circuits: 5 })).toBe(true);
  });

  it('the map’s transmission grid is meshed: no single outage cuts anyone off, and no two cut off Metro', () => {
    expect(cutOff([])).toEqual([]);
    for (const l of REGION.lines) expect(cutOff([l.id])).toEqual([]);
    for (const n of REGION.nodes) expect(REGION.lines.filter((l) => l.from === n.id || l.to === n.id).length).toBeGreaterThanOrEqual(2);
    expect(cutOff(['north-center', 'north-east'])).toEqual(['north']);
    expect(cutOff(['north-east', 'east-city'])).toEqual(['east']);
    expect(cutOff(['harbor-center', 'harbor-west'])).toEqual(['harbor']);
    for (const a of REGION.lines) for (const b of REGION.lines) if (a.id < b.id) expect(cutOff([a.id, b.id])).not.toContain('city');
    // Metro is fed by three lines: 345 kV from Central, 230 kV from East and West.
    const metro = REGION.lines.filter((l) => l.to === 'city' || l.from === 'city');
    expect(metro.map((l) => [l.id, l.kV])).toEqual([
      ['center-city', 345],
      ['east-city', 230],
      ['west-city', 230],
    ]);
  });

  it('a fault trips the whole feeder; isolation and the tie restore everyone else', () => {
    const start = feederState({ out: [], faults: ['F1-2'], flipped: [] });
    expect(start.tripped).toEqual(['B1']);
    expect(start.customersOff).toBe(2000);
    expect(restorationSolved({ out: [], faults: ['F1-2'], flipped: [] })).toBe(false);
    const restored = { out: [], faults: ['F1-2'], flipped: ['S1a', 'S1b', 'TIE'] };
    expect(feederState(restored).customersOff).toBe(480);
    expect(restorationSolved(restored)).toBe(true);
    // Closing the tie before isolating the fault trips both breakers.
    expect(feederState({ out: [], faults: ['F1-2'], flipped: ['TIE'] }).tripped).toEqual(['B1', 'B2']);
    // Losing two of the three transmission lines changes nothing; losing all three blacks out both feeders.
    expect(feederState({ out: ['center-city', 'east-city'], faults: [], flipped: [] }).customersOff).toBe(0);
    expect(feederState({ out: ['center-city', 'east-city', 'west-city'], faults: [], flipped: [] }).customersOff).toBe(4000);
    expect(SECTIONS.reduce((s, x) => s + x.customers, 0)).toBe(4000);
  });

  it('energizeFeeders handles a plain radial line', () => {
    const r = energizeFeeders(
      [
        { id: 'a', customers: 1 },
        { id: 'b', customers: 2 },
      ],
      [{ id: 's', a: 'a', b: 'b', closed: false }],
      [{ id: 'src', section: 'a', live: true }],
      [],
    );
    expect(r.energized).toEqual(['a']);
    expect(r.customersOff).toBe(2);
  });
});

describe('lesson 2.3: substation design', () => {
  const peaks = { residential: 16, commercial: 12, industrial: 6, dataCenter: 0 };

  it('reproduces the diversity numbers', () => {
    const L = substationLoad(peaks);
    expect(L.peak).toBeCloseTo(29.38, 2);
    expect(L.peakHour).toBe(17);
    expect(L.sumOfPeaks).toBe(34);
    expect(L.diversityFactor).toBeCloseTo(1.16, 2);
    expect(L.loadFactor).toBeCloseTo(0.84, 2);
    expect(substationLoad({ residential: 16 }).diversityFactor).toBe(1);
    expect(substationLoad({ residential: 16 }).loadFactor).toBeCloseTo(0.68, 2);
    expect(substationLoad({ industrial: 6 }).loadFactor).toBeCloseTo(0.91, 2);
  });

  it('checks N-1 for the existing and the expanded substation', () => {
    const now = checkTransformers(substationLoad(peaks).total, 2, 40);
    expect(now.n1Secure).toBe(true);
    expect(now.peakUtilization).toBeCloseTo(0.367, 3);
    expect(now.n1Utilization).toBeCloseTo(0.734, 3);
    const dc = substationLoad({ ...peaks, dataCenter: 20 });
    expect(dc.peak).toBeCloseTo(48.98, 2);
    expect(dc.peakHour).toBe(17);
    expect(checkTransformers(dc.total, 2, 40).n1Utilization).toBeCloseTo(1.22, 2);
    expect(checkTransformers(dc.total, 1, 60).n1Secure).toBe(false);
  });

  it('the transformer figure starts with the data center connected, and the equation shows the substation before it', () => {
    expect(SUBSTATION_DEFAULTS.dataCenter).toBe(DATA_CENTER_MW);
    const { residential, commercial, industrial, dataCenter } = SUBSTATION_DEFAULTS;
    const d = substationLoad({ residential, commercial, industrial, dataCenter });
    expect(d.peak).toBeCloseTo(48.98, 2);
    expect(checkTransformers(d.total, SUBSTATION_DEFAULTS.count, SUBSTATION_DEFAULTS.rating).n1Utilization).toBeCloseTo(1.22, 2);
    expect(EXISTING_LOAD.peak).toBeCloseTo(29.38, 2);
    expect(EXISTING_LOAD.peak / 2).toBeCloseTo(14.7, 1);
    expect(EXISTING_CHECK.peakUtilization).toBeCloseTo(0.367, 3);
    expect(EXISTING_CHECK.n1Utilization).toBeCloseTo(0.734, 3);
    expect(EXISTING_CHECK.n1Secure).toBe(true);
  });

  it('gives the data center two 14 MVA feeders', () => {
    expect(Math.round(FEEDER_MVA)).toBe(14);
    expect(feederCount(DATA_CENTER_MW)).toBe(2);
    expect(feederCount(0)).toBe(0);
  });

  it('the data-center challenge has a unique cheapest design', () => {
    const s = { ...SUBSTATION_DEFAULTS, dataCenter: 20 };
    expect(minimumInstalled(s)).toEqual({ installed: 75, count: 3, rating: 25 });
    expect(substationSolved({ ...s, count: 3, rating: 25 })).toBe(true);
    expect(substationSolved({ ...s, count: 4, rating: 20 })).toBe(false);
    expect(substationSolved({ ...s, count: 2, rating: 50 })).toBe(false);
    expect(substationSolved(SUBSTATION_DEFAULTS)).toBe(false);
    // The transformer figure serves the existing customers whatever the first figure is set to.
    expect(substationSolved({ ...s, residential: 0, commercial: 20, industrial: 15, count: 3, rating: 25 })).toBe(true);
    expect(minimumInstalled({ ...s, residential: 25 })).toEqual({ installed: 75, count: 3, rating: 25 });
  });
});

describe('lesson 2.4: power flow', () => {
  it('splits by reactance in the triangle', () => {
    const f = triangleFlows(300, 0, 1);
    expect(f.AC).toBeCloseTo(200);
    expect(f.AB).toBeCloseTo(100);
    expect(f.BC).toBeCloseTo(100);
    expect(triangleFlows(300, 0, 4).AC).toBeCloseTo(100);
    expect(triangleFlows(300, 0, 0.25).AC / 300).toBeCloseTo(0.889, 3);
    // Line A–B is empty when pA·xAC = pB·xBC.
    expect(triangleFlows(200, 400, 2).AB).toBeCloseTo(0);
    expect(triangleFlows(0, 0, 1).AC).toBe(0);
  });

  it('draws phase angles consistent with the flows, as the prose describes', () => {
    expect(100 * DEG_PER_MW).toBe(5);
    expect(DEFAULT_ANGLES.A).toBeCloseTo(10);
    expect(DEFAULT_ANGLES.B).toBeCloseTo(5);
    expect(DEFAULT_ANGLES.C).toBe(0);
    expect(STIFF_ANGLES.A).toBeCloseTo(20);
    // On every line, flow = angle difference ÷ (reactance × degrees per MW).
    for (const [pA, pB, x] of [
      [300, 0, 1],
      [120, 340, 2.5],
      [400, 400, 4],
      [0, 0, 0.25],
    ]) {
      const f = triangleFlows(pA, pB, x);
      const a = triangleAngles(pA, pB, x);
      expect(f.AC).toBeCloseTo((a.A - a.C) / (x * DEG_PER_MW), 6);
      expect(f.AB).toBeCloseTo((a.A - a.B) / DEG_PER_MW, 6);
      expect(f.BC).toBeCloseTo((a.B - a.C) / DEG_PER_MW, 6);
    }
  });

  it('spreads a Harbor transfer as the prose says', () => {
    const f = transferFlows('harbor', 100, 1.4);
    expect(f['harbor-center']).toBeCloseTo(58.0, 1);
    expect(f['harbor-west']).toBeCloseTo(42.0, 1);
    expect(f['center-city']).toBeCloseTo(54.6, 1);
    expect(f['west-city']).toBeCloseTo(33.4, 1);
    expect(-f['north-center']).toBeCloseTo(11.9, 1);
    expect(f['north-east']).toBeCloseTo(11.9, 1);
    expect(f['east-city']).toBeCloseTo(11.9, 1);
    expect(f['west-center']).toBeCloseTo(8.6, 1);
  });

  it('the zero-flow challenge is reachable on the slider grid', () => {
    expect(zeroFlowSolved({ source: 'harbor', mw: 100, xWM: 1.4 })).toBe(false);
    const grid: number[] = [];
    for (let k = 0; WM_RANGE[0] + k * WM_RANGE[2] <= WM_RANGE[1] + 1e-9; k++) grid.push(Number((WM_RANGE[0] + k * WM_RANGE[2]).toFixed(2)));
    const hits = grid.filter((x) => zeroFlowSolved({ source: 'harbor', mw: 100, xWM: x }));
    expect(hits).toEqual([0.65]);
    for (let mw = 100; mw <= 400; mw += 10) expect(zeroFlowSolved({ source: 'harbor', mw, xWM: 0.65 })).toBe(true);
  });
});

describe('lesson 2.5: congestion', () => {
  it('has no overloads at the reference evening peak', () => {
    const { st, overloads, rc } = playground(PLAYGROUND_DEFAULTS);
    expect(overloads).toEqual([]);
    expect(st.loading['west-city']).toBeCloseTo(0.849, 3);
    expect(Math.round(Math.abs(st.flows['west-city']))).toBe(255);
    expect(Math.round(Math.abs(st.flows['center-city']))).toBe(425);
    expect(Math.round(st.loading['center-city'] * 100)).toBe(71);
    expect(rc.loads.city).toBeCloseTo(792);
    expect(rc.output.cc2 + rc.output.oil).toBeCloseTo(50);
  });

  it('losing Central–Metro overloads West–Metro and North–East', () => {
    const results = REGION.lines.map((l) => ({ id: l.id, n: playground({ ...PLAYGROUND_DEFAULTS, out: [l.id] }).overloads.length }));
    expect(results.filter((r) => r.n >= 2).map((r) => r.id)).toEqual(['center-city']);
    const o = playground({ ...PLAYGROUND_DEFAULTS, out: ['center-city'] }).overloads;
    expect(o.map((x) => [x.line, Math.round(x.loading * 100)])).toEqual([
      ['west-city', 172],
      ['north-east', 124],
    ]);
  });

  it('the tanks: Metro imports 742 MW over lines rated 1,250 MW, one nearly full and one under a fifth full', () => {
    const { st } = playground(PLAYGROUND_DEFAULTS);
    expect(INTO_METRO.every((id) => REGION.lines.find((l) => l.id === id)!.to === 'city')).toBe(true);
    expect(REFERENCE_IMPORTS.imported).toBeCloseTo(742, 6);
    expect(REFERENCE_IMPORTS.rated).toBe(1250);
    expect(Math.round(st.loading['west-city'] * 100)).toBe(85);
    expect(st.loading['east-city']).toBeLessThan(0.2);
    expect(Math.round(TANK_SHARE * 100)).toBe(59);
    expect(TANK_RATING).toBe(60);
  });

  it('the heat-wave challenge: the ratings can fall only to 85%, while Metro imports 70% of what its lines are rated for', () => {
    expect(LOWEST_SAFE_RATING).toBe(85);
    expect((LOWEST_SAFE_RATING - RATING_RANGE[0]) % RATING_RANGE[2]).toBe(0);
    expect(heatWaveSolved(PLAYGROUND_DEFAULTS)).toBe(false);
    expect(heatWaveSolved({ ...PLAYGROUND_DEFAULTS, rating: 90 })).toBe(false);
    expect(heatWaveSolved({ ...PLAYGROUND_DEFAULTS, rating: 80 })).toBe(false);
    expect(heatWaveSolved({ ...PLAYGROUND_DEFAULTS, rating: 85 })).toBe(true);
    expect(heatWaveSolved({ ...PLAYGROUND_DEFAULTS, rating: 85, out: ['east-city'] })).toBe(false);
    expect(heatWaveSolved({ ...PLAYGROUND_DEFAULTS, rating: 85, metro: 100 })).toBe(false);
    expect(playground({ ...PLAYGROUND_DEFAULTS, rating: 80 }).overloads.map((o) => o.line)).toEqual(['west-city']);
    const at = playground({ ...PLAYGROUND_DEFAULTS, rating: 85 });
    expect(at.overloads).toEqual([]);
    expect(Math.round(Math.abs(at.st.flows['west-city']))).toBe(255);
    expect(limitsAt(85)['west-city']).toBe(255);
    expect(Math.round(at.st.loading['center-city'] * 100)).toBe(83);
    expect(Math.round(at.st.loading['east-city'] * 100)).toBe(21);
    const imp = metroImports({ out: [], rating: 85 }, at.st.flows);
    expect(Math.round((imp.imported / imp.rated) * 100)).toBe(70);
  });

  it('extra Metro demand and ratings behave as described', () => {
    const base = playground(PLAYGROUND_DEFAULTS).st.flows;
    const plus200 = playground({ ...PLAYGROUND_DEFAULTS, metro: 200 }).st.flows;
    for (const l of REGION.lines) expect(plus200[l.id]).toBeCloseTo(base[l.id], 6);
    // Beyond Mill Creek's 200 MW, Eastgate in the East picks up, mostly along East–Metro.
    const plus400 = playground({ ...PLAYGROUND_DEFAULTS, metro: 400 });
    expect(plus400.rc.output.ct).toBeCloseTo(200);
    const rise = (id: string) => Math.abs(plus400.st.flows[id]) - Math.abs(base[id]);
    expect(rise('east-city')).toBeGreaterThan(rise('center-city'));
    expect(rise('east-city')).toBeGreaterThan(rise('west-city'));
  });

  it('describes the day correctly', () => {
    const hoursOver = (out: string[], line: string) =>
      Array.from({ length: 24 }, (_, h) => h).filter((h) => (playground({ ...PLAYGROUND_DEFAULTS, out }, h).st.loading[line] ?? 0) > 1.0001);
    const peakAllIn = Array.from({ length: 24 }, (_, h) => playground(PLAYGROUND_DEFAULTS, h).st.loading['west-city']);
    expect(Math.round(Math.max(...peakAllIn) * 100)).toBe(86);
    expect([18, 20].every((h) => Math.round(peakAllIn[h] * 100) === 86)).toBe(true);
    for (let h = 0; h < 24; h++) expect(playground(PLAYGROUND_DEFAULTS, h).overloads).toEqual([]);
    expect(hoursOver(['center-city'], 'west-city')).toEqual([6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(hoursOver(['north-center'], 'east-city')).toEqual([11, 12, 13, 14]);
  });

  it('stays finite when lines are cut and the network splits', () => {
    const r = playground({ hour: 0, metro: 400, rating: 70, out: REGION.lines.map((l) => l.id) });
    expect(Number.isFinite(r.st.shedTotal)).toBe(true);
    for (const v of Object.values(r.st.flows)) expect(v).toBe(0);
  });
});

describe('cascade engine', () => {
  // Two parallel lines from A to B; take one out and the other must carry everything.
  const net: Network = {
    nodes: [
      { id: 'A', name: 'A', x: 0, y: 0 },
      { id: 'B', name: 'B', x: 1, y: 0 },
      { id: 'C', name: 'C', x: 2, y: 0 },
    ],
    lines: [
      { id: 'ab1', from: 'A', to: 'B', reactance: 1, limit: 100 },
      { id: 'ab2', from: 'A', to: 'B', reactance: 1, limit: 100 },
      { id: 'bc', from: 'B', to: 'C', reactance: 1, limit: 500 },
    ],
  };
  const units: GridUnit[] = [
    { id: 'g', node: 'A', capacity: 200, output: 150 },
    { id: 'h', node: 'C', capacity: 40, output: 0 },
  ];
  const loads = { B: 150 };

  it('balances islands with spare capacity and then sheds', () => {
    const s = islandFlows(net, units, loads, ['ab1', 'ab2']);
    expect(s.islands.length).toBe(2);
    // B and C are an island with 40 MW of generation for 150 MW of demand.
    expect(s.output.h).toBeCloseTo(40);
    expect(s.shedTotal).toBeCloseTo(110);
    expect(s.output.g).toBeCloseTo(0);
  });

  it('trips overloaded lines until nothing more trips', () => {
    const steps = runCascade(net, units, loads, ['ab1']);
    expect(steps[0].tripping).toEqual(['ab2']); // 150 MW on a 100 MW line: 150% > 120%
    expect(steps.length).toBe(2);
    expect(steps[1].shedTotal).toBeCloseTo(110);
    // A milder overload doesn't trip.
    const mild = runCascade(net, [{ ...units[0], output: 110 }, units[1]], { B: 110 }, ['ab1']);
    expect(mild.length).toBe(1);
    expect(overloadedLines(mild[0]).map((o) => o.line)).toEqual(['ab2']);
  });

  it('scans single contingencies and reports separated nodes', () => {
    const scan = scanContingencies(net, units, loads);
    const bc = scan.find((r) => r.outage === 'bc')!;
    expect(bc.separated).toEqual(['C']);
    expect(bc.ok).toBe(true);
    expect(scan.find((r) => r.outage === 'ab1')!.ok).toBe(false);
  });
});

describe('lesson 2.6: reliability', () => {
  it('fails N-1 four times in merit order, and a secure dispatch fixes it at a cost', () => {
    const merit = securityCase({ out: [], mode: 'merit' });
    expect(merit.scan.filter((r) => !r.ok).map((r) => r.outage).sort()).toEqual(['center-city', 'harbor-center', 'north-east', 'west-city']);
    expect(MERIT_COST).toBeCloseTo(31500);
    expect(Math.round(SECURE_COST)).toBe(42069);
    expect(SECURE_COST / MERIT_COST).toBeCloseTo(1.34, 2);
    const secure = securityCase({ out: [], mode: 'secure' });
    expect(secure.scan.every((r) => r.ok)).toBe(true);
    expect(secure.st.output.coal).toBeCloseTo(0, 3);
    expect(secure.st.output.cc2).toBeCloseTo(250, 3);
  });

  it('cutting all three lines into Metro leaves it 462 MW short in either dispatch', () => {
    for (const mode of ['merit', 'secure'] as const) {
      const metro = securityCase({ out: ['center-city', 'east-city', 'west-city'], mode });
      expect(Math.round(metro.shed)).toBe(462);
    }
  });

  it('the storm cascades into a Metro blackout, and Central–Metro alone cascades too', () => {
    const storm = cascadeCase({ out: [...STORM], cc2: 50, oil: 0, ct: 0, stage: 0 });
    expect(Math.round(storm.steps[0].loading['center-city'] * 100)).toBe(124);
    expect(storm.steps[0].tripping).toEqual(['center-city']);
    expect(Math.round(storm.final.shedTotal)).toBe(462);
    expect(storm.final.islands).toContainEqual(['city']);
    expect(Math.round(STORM_LOST_LOAD)).toBe(462000);
    const cc = cascadeCase({ out: ['center-city'], cc2: 50, oil: 0, ct: 0, stage: 0 });
    expect(cc.steps[0].tripping.sort()).toEqual(['north-east', 'west-city']);
    expect(Math.round(cc.final.shedTotal)).toBe(406);
    expect(cc.final.islands).toContainEqual(['east', 'city']);
  });

  it('the storm challenge is reachable, and the cheapest answer is Mill Creek at 200 MW', () => {
    expect(stormSolved({ out: [...STORM], cc2: 50, oil: 0, ct: 0, stage: 0 })).toBe(false);
    expect(stormSolved({ out: [...STORM], cc2: 190, oil: 0, ct: 0, stage: 0 })).toBe(false);
    const ok = { out: [...STORM], cc2: 200, oil: 0, ct: 0, stage: 0 };
    expect(stormSolved(ok)).toBe(true);
    const c = cascadeCase(ok);
    expect(Math.round(Math.abs(c.final.flows['center-city']))).toBe(592);
    expect(c.rc.cost - MERIT_COST).toBeCloseTo(900);
    // Search the sliders' grid: every solution costs at least as much, and Eastgate alone never helps.
    let best = Infinity;
    for (let cc2 = 0; cc2 <= 250; cc2 += 10)
      for (let oil = 0; oil <= 80; oil += 10)
        for (let ct = 0; ct <= 200; ct += 50) {
          const s = { out: [...STORM], cc2, oil, ct, stage: 0 };
          if (stormSolved(s)) best = Math.min(best, cascadeCase(s).rc.cost);
        }
    expect(best).toBeCloseTo(c.rc.cost);
    expect(stormSolved({ out: [...STORM], cc2: 50, oil: 0, ct: 200, stage: 0 })).toBe(false);
  });

  it('stays finite with every line out', () => {
    const all = REGION.lines.map((l) => l.id);
    const r = securityCase({ out: all, mode: 'secure' });
    expect(Number.isFinite(r.cost)).toBe(true);
    const c = cascadeCase({ out: all, cc2: 250, oil: 80, ct: 200, stage: 0 });
    expect(Number.isFinite(c.final.shedTotal)).toBe(true);
    expect(regionCase({ fixed: { cc2: 250, oil: 80, ct: 200 } }).shortfall).toBe(0);
  });

  it('uses the triangle and region consistently', () => {
    expect(THREE_NODE.lines.length).toBe(3);
    expect(REGION.lines.length).toBe(8);
  });
});

describe('chapter 2 lessons at the controls’ extremes', () => {
  const modules = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch2/L2_*.tsx');
  for (const [path, load] of Object.entries(modules)) {
    it(`${path} never shows NaN, Infinity or undefined`, async () => {
      const Lesson = (await load()).default;
      const view = render(createElement(Lesson));
      const check = () => {
        const text = view.container.textContent ?? '';
        expect(text).not.toMatch(/NaN|Infinity|undefined|—%/);
        for (const el of Array.from(view.container.querySelectorAll('[aria-label]'))) expect(el.getAttribute('aria-label')).not.toMatch(/NaN|Infinity|undefined/);
      };
      check();
      const inputs = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
      for (const end of ['max', 'min'] as const) {
        for (const input of inputs) {
          if (input.disabled) continue;
          await act(async () => {
            fireEvent.change(input, { target: { value: input[end] } });
          });
        }
        check();
        for (const button of Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button'))) {
          await act(async () => {
            fireEvent.click(button);
          });
          check();
        }
      }
      // Click every interactive SVG element (lines, switches, sections) once.
      for (const el of Array.from(view.container.querySelectorAll('svg [role="button"]'))) {
        await act(async () => {
          fireEvent.click(el);
        });
      }
      check();
      cleanup();
    });
  }
});
