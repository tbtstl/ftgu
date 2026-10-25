// Natural gas, chapter 1: numbers the lessons' prose computes live, checked against what the prose says,
// and the region map that Lesson 1.1 opens with.

import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fmt, pct } from '../src/framework/format';
import { checkSpec, COMPONENT, gasProperties, PIPELINE_SPEC, psia, psig, rankine, SCF_PER_LBMOL, STD_PSIA } from '../src/engines/gas/properties';
import { piston } from '../src/engines/gas/eos';
import { frictionFactor, pipeInventory, ROUGHNESS } from '../src/engines/gas/hydraulics';
import { compress, stationLine } from '../src/engines/gas/compression';
import { BASINS, GAS_NODE, GAS_NODES, PIPELINE, PIPELINES, STORAGE_FIELDS, stationLineOf } from '../src/model/gas/world';
import L1_1, { ETHANE_ANSWER, ETHANE_ESTIMATE, ETHANE_STEP, ethaneSolved, MIX_DEFAULTS, mixComposition, PRESETS } from '../src/lessons/gas/ch1/L1_1';
import { CHARGE_SCF, IDEAL_MAOP_VOLUME, MAOP_PSIG, MAOP_VOLUME, maopSolved, PISTON_DEFAULTS, SCF_CNG_ROUNDED } from '../src/lessons/gas/ch1/L1_2';
import { FLOW_DEFAULTS, flowAt, transitHours } from '../src/lessons/gas/ch1/L1_3';
import { capacityWith, expansionSolved, FEWEST_FOR_TARGET, LINE_DEFAULTS, SQRT_LADDER_ERROR, SQRT_STATIONS, TARGET_FLOW } from '../src/lessons/gas/ch1/L1_4';
import { BILL_DEFAULTS, billsEqualSolved, CCF_THERM_HHV, HOME_SCF_PER_CF, METER_DEFAULTS, meterHour, NORTHLINE_FUEL_SHARE, thermsPerCcf } from '../src/lessons/gas/ch1/L1_5';

const NL = PIPELINE['calder-metro'];

describe('gas 1.2: pound-moles and CNG', () => {
  it('explains the pound-mole with 16 lb of methane, 28 of nitrogen and 378.6 scf', () => {
    expect(fmt(COMPONENT.methane.mw)).toBe('16');
    expect(fmt(COMPONENT.nitrogen.mw)).toBe('28');
    expect(fmt(SCF_PER_LBMOL, 1)).toBe('378.6');
    expect((CHARGE_SCF / SCF_PER_LBMOL).toFixed(2)).toBe('2.64');
  });

  it('rounds CNG’s packing to roughly 300 scf per cubic foot', () => {
    expect(SCF_CNG_ROUNDED).toBe(300);
  });
});

describe('gas 1.3: the flow equation’s pieces', () => {
  const D = FLOW_DEFAULTS;

  it('gives Tb ÷ Pb as 35.28', () => {
    expect(fmt(rankine(60) / STD_PSIA, 2)).toBe('35.28');
  });

  it('lowers the friction factor of a wider pipe through both relative roughness and Reynolds number', () => {
    const small = flowAt(18, D.length, D.inlet, D.outlet);
    const big = flowAt(36, D.length, D.inlet, D.outlet);
    expect(big.re).toBeGreaterThan(small.re);
    expect(frictionFactor(1e15, ROUGHNESS.newSteel / 36)).toBeLessThan(frictionFactor(1e15, ROUGHNESS.newSteel / 18));
    // Neither pipe is at the fully rough limit, so the Reynolds number still matters.
    expect(big.f).toBeGreaterThan(frictionFactor(1e15, ROUGHNESS.newSteel / 36));
    expect(small.f).toBeGreaterThan(frictionFactor(1e15, ROUGHNESS.newSteel / 18));
  });

  it('makes the transit time and the linepack’s hours of flow the same 19 hours', () => {
    const base = flowAt(D.diameter, D.length, D.inlet, D.outlet);
    const pack = pipeInventory({ diameterIn: D.diameter, lengthMi: D.length, roughnessIn: ROUGHNESS.newSteel }, psia(D.inlet), psia(D.outlet)) / 1e6;
    const packHours = (pack / base.qMMcfd) * 24;
    const transit = transitHours(D.diameter, D.length, D.inlet, D.outlet);
    expect(fmt(packHours)).toBe('19');
    expect(fmt(transit)).toBe('19');
    expect(Math.abs(packHours / transit - 1)).toBeLessThan(0.01);
  });

  it('quotes the speeds for Northline’s 35-inch pipe, which a 44-inch pipe would change', () => {
    expect(D.diameter).toBe(35);
    const base = flowAt(35, D.length, D.inlet, D.outlet);
    expect(fmt(base.vIn, 1)).toBe('14.3');
    expect(fmt(base.vOut, 1)).toBe('29.4');
    expect(fmt(flowAt(44, D.length, D.inlet, D.outlet).vIn, 1)).not.toBe('14.3');
  });
});

describe('gas 1.4: ratios, spare pressure and Northline’s rating', () => {
  it('calls 300 to 1,440 psig a ratio of 4.6', () => {
    const hard = compress(1800, psia(300), psia(1440));
    expect(fmt(hard.ratio, 1)).toBe('4.6');
    expect(Math.round(hard.dischargeF)).toBe(318);
  });

  it('delivers 1,800 MMcf/d to Metro with 2 psi to spare', () => {
    const three = stationLine(stationLineOf(NL), 1800);
    const spare = psig(three.deliveryPsia) - NL.minDeliveryPsig;
    expect(spare).toBeGreaterThanOrEqual(0);
    expect(fmt(spare)).toBe('2');
  });

  it('rates Northline at its three-station capacity rounded down to 1.8 Bcf/d', () => {
    const cap = capacityWith(3);
    expect(cap).toBeGreaterThanOrEqual(NL.capacityBcfd * 1000);
    expect(Math.floor(cap / 100) / 10).toBe(NL.capacityBcfd);
  });
});

describe('gas 1.5: the meter at Metro', () => {
  it('opens on the 1.8% of the gas Northline’s stations burn', () => {
    expect(pct(NORTHLINE_FUEL_SHARE, 1)).toBe('1.8%');
  });

  it('counts an hour’s reading as 84% of an hour of Northline at full flow', () => {
    const def = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv);
    expect(pct(def.scf / 1e6 / ((NL.capacityBcfd * 1000) / 24))).toBe('84%');
  });

  it('says an ideal-gas flow computer leaves 14.2% of the energy uncounted', () => {
    const real = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv);
    const ideal = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv, true);
    expect(pct((ideal.trueMMBtu - ideal.mmbtu) / ideal.trueMMBtu, 1)).toBe('14.2%');
    expect(ideal.trueMMBtu).toBeCloseTo(real.mmbtu, 9);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: the predict-then-check challenges.

describe('gas 1.1: the ethane challenge, estimated from 7.6 Btu/scf a point', () => {
  const r = PRESETS.ridgeback;
  const hhvAt = (ethane: number) => gasProperties(mixComposition({ ...r, ethane })).hhv;

  it('gives the 7.6 Btu/scf a point of ethane adds before the challenge', () => {
    expect(fmt(ETHANE_STEP, 1)).toBe('7.6');
    expect(fmt((COMPONENT.ethane.hhv - COMPONENT.methane.hhv) / 100, 1)).toBe('7.6');
    expect(fmt(COMPONENT.ethane.hhv)).toBe('1,774');
    expect(fmt(COMPONENT.methane.hhv)).toBe('1,012');
  });

  it('estimates (1,173 − 1,100) ÷ 7.6 ≈ 9.6 points to cut, leaving about 2.4%', () => {
    expect(fmt(hhvAt(r.ethane))).toBe('1,173');
    expect(PIPELINE_SPEC.hhvMax).toBe(1100);
    expect(fmt(ETHANE_ESTIMATE.cut, 1)).toBe('9.6');
    expect(fmt(ETHANE_ESTIMATE.keep, 1)).toBe('2.4');
    // “nearly ten points” of ethane thrown away.
    expect(ETHANE_ESTIMATE.cut).toBeGreaterThan(9);
    expect(ETHANE_ESTIMATE.cut).toBeLessThan(10);
    expect(Math.abs(ETHANE_ESTIMATE.keep - ETHANE_ANSWER)).toBeLessThan(0.1);
  });

  it('is unsolved at the start and on raw Ridgeback, solved at 2.4%, not at the near misses', () => {
    expect(ethaneSolved(MIX_DEFAULTS)).toBe(false);
    expect(ethaneSolved(r)).toBe(false);
    expect(ETHANE_ANSWER).toBe(2.4);
    expect(ethaneSolved({ ...r, ethane: 2.4 })).toBe(true);
    for (const e of [2.2, 2.3, 2.5, 2.6]) expect(ethaneSolved({ ...r, ethane: e })).toBe(false);
  });

  it('shows the heating value to a tenth, since 2.4% and 2.5% both round to 1,100', () => {
    expect(fmt(hhvAt(2.4))).toBe('1,100');
    expect(fmt(hhvAt(2.5))).toBe('1,100');
    expect(fmt(hhvAt(2.4), 1)).toBe('1,099.5');
    expect(fmt(hhvAt(2.5), 1)).toBe('1,100.3');
  });

  it('has the heating value, not the Wobbe index, binding at the answer', () => {
    const at = mixComposition({ ...r, ethane: ETHANE_ANSWER });
    const wobbe = checkSpec(at).rules.find((x) => x.id === 'wobbe')!;
    expect(wobbe.ok).toBe(true);
    expect(fmt(wobbe.value)).toBe('1,369');
    const past = checkSpec(mixComposition({ ...r, ethane: 2.5 })).rules;
    expect(past.find((x) => x.id === 'hhv')!.ok).toBe(false);
    expect(past.find((x) => x.id === 'wobbe')!.ok).toBe(true);
  });
});

describe('gas 1.2: the MAOP challenge, predicted from the ideal gas’s 10.1 ft³', () => {
  it('puts an ideal gas at 1,440 psig in 1,000 × 14.73 ÷ 1,454.7 ≈ 10.1 ft³', () => {
    expect(fmt(psia(MAOP_PSIG), 1)).toBe('1,454.7');
    expect(STD_PSIA).toBe(14.73);
    expect(fmt(IDEAL_MAOP_VOLUME, 1)).toBe('10.1');
    // The dashed needle crosses the limit between 10.1 and 10.2 ft³.
    expect(piston(CHARGE_SCF, 10.1, 60).idealPressure).toBeGreaterThan(psia(MAOP_PSIG));
    expect(piston(CHARGE_SCF, 10.2, 60).idealPressure).toBeLessThan(psia(MAOP_PSIG));
  });

  it('needs less room for the real gas: 8.0 ft³, about Z × 10.1', () => {
    expect(MAOP_VOLUME).toBe(8);
    expect(MAOP_VOLUME).toBeLessThan(IDEAL_MAOP_VOLUME);
    const at = piston(CHARGE_SCF, MAOP_VOLUME, 60);
    expect(at.z.toFixed(3)).toBe('0.787');
    expect(fmt(IDEAL_MAOP_VOLUME * at.z, 1)).toBe('8.0');
    expect(fmt((1 / at.z - 1) * 100)).toBe('27');
    expect(fmt(CHARGE_SCF / MAOP_VOLUME)).toBe('125');
  });

  it('is unsolved at the start and at the near misses', () => {
    expect(maopSolved(PISTON_DEFAULTS.volume, PISTON_DEFAULTS.temp)).toBe(false);
    expect(maopSolved(8, 60)).toBe(true);
    for (const v of [7.9, 8.1, 10.1, 10.2]) expect(maopSolved(v, 60)).toBe(false);
    expect(maopSolved(8, 59)).toBe(false);
  });
});

describe('gas 1.4: the station challenge, predicted from √n', () => {
  it('estimates (2,000 ÷ 1,034)² ≈ 3.7 stations, so four', () => {
    expect(TARGET_FLOW).toBe(2000);
    expect(fmt(capacityWith(1))).toBe('1,034');
    expect(fmt(TARGET_FLOW / capacityWith(1), 2)).toBe('1.93');
    expect(fmt(SQRT_STATIONS, 1)).toBe('3.7');
    expect(Math.ceil(SQRT_STATIONS)).toBe(FEWEST_FOR_TARGET);
    expect(FEWEST_FOR_TARGET).toBe(4);
  });

  it('is unsolved at the start and at the near misses', () => {
    expect(expansionSolved(LINE_DEFAULTS)).toBe(false);
    expect(expansionSolved({ stations: 4, flow: 2000 })).toBe(true);
    expect(expansionSolved({ stations: 3, flow: 2000 })).toBe(false);
    expect(expansionSolved({ stations: 5, flow: 2000 })).toBe(false);
    expect(expansionSolved({ stations: 4, flow: 1950 })).toBe(false);
  });

  it('gives the capacity ladder after the challenge, within 1% of √n, with shrinking steps', () => {
    expect(SQRT_LADDER_ERROR).toBeLessThan(0.01);
    expect(Math.ceil(SQRT_LADDER_ERROR * 100)).toBe(1);
    expect(fmt(capacityWith(4) - capacityWith(3))).toBe('281');
    expect(fmt(capacityWith(6) - capacityWith(5))).toBe('224');
    for (let n = 2; n < 6; n++) expect(capacityWith(n + 1) - capacityWith(n)).toBeLessThan(capacityWith(n) - capacityWith(n - 1));
  });
});

describe('gas 1.5: the bill challenge, computed as 100,000 ÷ 101.7', () => {
  it('gives 101.7 scf per CCF before the challenge, and 100,000 ÷ 101.7 rounds to the answer', () => {
    expect(fmt(100 * HOME_SCF_PER_CF, 1)).toBe('101.7');
    expect(Math.round(100000 / 101.7)).toBe(CCF_THERM_HHV);
    expect(CCF_THERM_HHV).toBe(983);
  });

  it('is unsolved at the start and at the near misses, which the display tells apart', () => {
    expect(billsEqualSolved(BILL_DEFAULTS.hhv)).toBe(false);
    expect(billsEqualSolved(983)).toBe(true);
    for (const h of [981, 982, 984, 985, 1000]) expect(billsEqualSolved(h)).toBe(false);
    expect([982, 983, 984].map((h) => fmt(thermsPerCcf(h), 3))).toEqual(['0.999', '1.000', '1.001']);
  });

  it('raises every bill of the region’s gas by the same 5.5%, whatever the month’s use', () => {
    expect(pct(thermsPerCcf(BILL_DEFAULTS.hhv) - 1, 1)).toBe('5.5%');
  });
});

describe('gas 1.1: the region map, before the first demonstration', () => {
  const view = () => render(createElement(L1_1));

  it('opens with the map, ahead of the Molecule Lab and its raw Ridgeback and Sandhill gases', () => {
    const { container } = view();
    const names = Array.from(container.querySelectorAll('figure.fig')).map((f) => f.getAttribute('aria-label'));
    expect(names.slice(0, 2)).toEqual(['Molecule Lab · the region', 'Molecule Lab']);
    cleanup();
  });

  it('names every place, pipeline and storage field the model defines, with one fact each', () => {
    const { container } = view();
    const map = Array.from(container.querySelectorAll('figure.fig')).find((f) => f.getAttribute('aria-label') === 'Molecule Lab · the region')!;
    const labels = Array.from(map.querySelectorAll('svg text')).map((t) => t.textContent ?? '');
    const has = (s: string) => expect(labels, s).toContain(s);
    for (const n of GAS_NODES) has(n.name);
    for (const p of PIPELINES) {
      has(p.name);
      has(`${String(p.capacityBcfd)} Bcf/d`);
    }
    for (const s of STORAGE_FIELDS) {
      has(s.name);
      expect(labels.some((l) => l.endsWith(`· ${s.workingBcf} Bcf`))).toBe(true);
    }
    for (const b of BASINS) expect(labels.some((l) => l.endsWith(`· ${String(b.productionBcfd)} Bcf/d`))).toBe(true);
    // What each place is, in the model's words.
    has(GAS_NODE.metro.kind);
    has(GAS_NODE.bayport.kind);
    expect(labels.some((l) => l.startsWith(`${GAS_NODE.ridgeback.kind} ·`))).toBe(true);
    // The same places, in words, for screen readers.
    const aria = map.querySelector('svg')!.getAttribute('aria-label') ?? '';
    for (const name of [...GAS_NODES, ...PIPELINES, ...STORAGE_FIELDS].map((x) => x.name)) expect(aria).toContain(name);
    cleanup();
  });
});
