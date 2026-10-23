// Chapter 1: the engines behind lessons 1.3–1.5, and the numbers their prose quotes.

import { describe, expect, it } from 'vitest';
import { generatorAt, generatorEmf, synchronousRpm, transformer } from '../src/engines/physics/machines';
import { lineLoss, TYPICAL_OHM_PER_KM } from '../src/engines/physics/losses';
import { PHASE_OFFSETS_RAD, advanceRotor, coilAgo, coilAt, statorTeeth } from '../src/engines/physics/stator';
import { conductorAmps, deliveryChain } from '../src/engines/physics/delivery';

const TAU = 2 * Math.PI;

describe('stator', () => {
  it('agrees with generatorAt for two and four poles', () => {
    for (const polePairs of [1, 2]) {
      const input = { turns: 100, fieldTesla: 0.5, areaM2: 0.02, rpm: 3600 / polePairs, polePairs };
      for (const t of [0, 0.001, 0.0042, 0.013]) {
        const rotor = (TAU * input.rpm * t) / 60;
        const a = coilAt(input, rotor);
        const b = generatorAt(input, t);
        expect(a.emf).toBeCloseTo(b.emf, 9);
        expect(a.flux).toBeCloseTo(b.flux, 12);
      }
    }
  });

  it('looks back in time at the present speed', () => {
    const input = { turns: 50, fieldTesla: 0.8, areaM2: 0.02, rpm: 1800 };
    const now = 1.234;
    const ago = coilAgo(input, now, 0.004);
    expect(ago.emf).toBeCloseTo(coilAt(input, now - (TAU * 1800 * 0.004) / 60).emf, 9);
  });

  it('three coils 120° apart make a balanced set', () => {
    const input = { turns: 100, fieldTesla: 0.5, areaM2: 0.02, rpm: 3600 };
    for (const rotor of [0, 0.3, 1.7, 4]) {
      const sum = PHASE_OFFSETS_RAD.reduce((s, o) => s + coilAt(input, rotor, o).emf, 0);
      expect(sum).toBeCloseTo(0, 9);
    }
    // Phase B lags phase A by a third of a cycle.
    const peakA = coilAt(input, Math.PI / 2, 0).emf;
    expect(coilAt(input, Math.PI / 2 + TAU / 3, PHASE_OFFSETS_RAD[1]).emf).toBeCloseTo(peakA, 9);
  });

  it('lays out six teeth per pole pair, cycling A, C, B', () => {
    const two = statorTeeth(1);
    expect(two.map((t) => 'ABC'[t.phase]).join('')).toBe('ACBACB');
    expect(two.map((t) => t.reversed)).toEqual([false, true, false, true, false, true]);
    const four = statorTeeth(2);
    expect(four).toHaveLength(12);
    // Every tooth's electrical angle (pole pairs × mechanical) matches its phase, reversed or not.
    for (const t of four) {
      const elec = (((2 * t.angleRad - PHASE_OFFSETS_RAD[t.phase] + (t.reversed ? Math.PI : 0)) % TAU) + TAU) % TAU;
      expect(Math.min(elec, TAU - elec)).toBeCloseTo(0, 9);
    }
  });

  it('advances and wraps the rotor angle', () => {
    expect(advanceRotor(0, 60, 0.25)).toBeCloseTo(Math.PI / 2, 12);
    expect(advanceRotor(6, 3600, 1)).toBeCloseTo(6 % TAU, 9);
    expect(advanceRotor(1, 0, 10)).toBe(1);
  });
});

describe('lesson 1.3 numbers', () => {
  const g = (turns: number, fieldTesla: number, rpm: number) => generatorEmf({ turns, fieldTesla, areaM2: 0.02, rpm });

  it('starting settings: 30 Hz, 188 V peak; 3,600 rpm doubles both', () => {
    expect(g(100, 0.5, 1800).freqHz).toBe(30);
    expect(Math.round(g(100, 0.5, 1800).peakVolts)).toBe(188);
    expect(g(100, 0.5, 3600).freqHz).toBe(60);
    expect(Math.round(g(100, 0.5, 3600).peakVolts)).toBe(377);
  });

  it('the 60 Hz, 240 V challenge is reachable on the sliders', () => {
    const solutions: Array<[number, number]> = [];
    for (let turns = 10; turns <= 200; turns += 10) {
      for (let k = 0; k <= 20; k++) {
        const B = k * 0.05;
        if (Math.abs(g(turns, B, 3600).rmsVolts - 240) < 0.5) solutions.push([turns, B]);
      }
    }
    expect(solutions.length).toBeGreaterThan(3);
    expect(solutions.some(([n, b]) => n === 90 && Math.abs(b - 0.5) < 1e-9)).toBe(true);
    // At the starting settings it isn't already solved.
    expect(Math.abs(g(100, 0.5, 1800).rmsVolts - 240)).toBeGreaterThan(0.5);
  });

  it('synchronous speeds', () => {
    expect(synchronousRpm(60, 2)).toBe(3600);
    expect(synchronousRpm(60, 4)).toBe(1800);
    expect(synchronousRpm(60, 40)).toBe(180);
    expect(synchronousRpm(50, 2)).toBe(3000);
    expect(synchronousRpm(50, 4)).toBe(1500);
  });
});

describe('lesson 1.4 numbers', () => {
  const lossy = (n1: number, n2: number, load = 12) =>
    transformer({ primaryVolts: 240, primaryTurns: n1, secondaryTurns: n2, loadOhms: load, windingOhms: 0.4, coreLossWatts: 20 });

  it('ideal: 240 V to 120 V, 10 A out, 5 A in, 1,200 W', () => {
    const t = transformer({ primaryVolts: 240, primaryTurns: 200, secondaryTurns: 100, loadOhms: 12 });
    expect(t.secondaryVolts).toBeCloseTo(120);
    expect(t.secondaryAmps).toBeCloseTo(10);
    expect(t.primaryAmps).toBeCloseTo(5);
    expect(t.outputWatts).toBeCloseTo(1200);
  });

  it('with losses: 1,181 W in, 1,124 W out, 95.1%, 116 V at the load', () => {
    const t = lossy(200, 100);
    expect(Math.round(t.inputWatts)).toBe(1181);
    expect(Math.round(t.outputWatts)).toBe(1124);
    expect((t.efficiency * 100).toFixed(1)).toBe('95.1');
    expect(Math.round(t.secondaryVolts)).toBe(116);
    expect(120 - t.secondaryVolts).toBeGreaterThan(3.5);
    expect(120 - t.secondaryVolts).toBeLessThan(4);
  });

  it('the 120 V, 10.0 A challenge is reachable with whole turns', () => {
    const ok = (n1: number, n2: number) => {
      const t = lossy(n1, n2);
      return Math.round(t.secondaryVolts) === 120 && (Math.round(t.secondaryAmps * 10) / 10).toFixed(1) === '10.0';
    };
    expect(ok(200, 103)).toBe(true);
    expect(ok(200, 100)).toBe(false);
  });

  it('the chain from generator to home', () => {
    const c = deliveryChain(1);
    const amps = Object.fromEntries(c.map((s) => [s.id, s.amps]));
    expect(amps.generator.toFixed(1)).toBe('28.9');
    expect(amps.transmission.toFixed(2)).toBe('1.67');
    expect(amps.feeder.toFixed(1)).toBe('41.8');
    expect(Math.round(amps.service)).toBe(4167);
    expect(c[1].ratio).toBeCloseTo(17.25);
    expect(c[2].ratio).toBeCloseTo(0.2);
    expect(c[3].ratio).toBeCloseTo(0.2);
    expect(1 / c[4].ratio!).toBeCloseTo(33.2, 1);
    expect(Math.round(13800 / Math.sqrt(3))).toBe(7967);
    expect(conductorAmps(1e6, 240, false)).toBeCloseTo(4166.67, 1);
  });
});

describe('lesson 1.5 numbers', () => {
  const at = (kV: number, ohmPerKm = 0.15, sendMW = 100, lengthKm = 100) => lineLoss({ sendMW, kV, lengthKm, ohmPerKm });

  it('starting settings: 837 A, 31.5 MW lost, 315 kW per km', () => {
    const r = at(69);
    expect(Math.round(r.amps)).toBe(837);
    expect(r.ohms).toBe(15);
    expect(r.lossMW.toFixed(1)).toBe('31.5');
    expect(Math.round((3 * r.amps ** 2 * 0.15) / 1000)).toBe(315);
  });

  it('doubling the voltage quarters the loss; five times cuts it 25-fold', () => {
    expect(Math.round(at(138).amps)).toBe(418);
    expect(at(138).lossMW.toFixed(1)).toBe('7.9');
    expect(at(345).lossMW.toFixed(1)).toBe('1.3');
    expect(at(69).lossMW / at(345).lossMW).toBeCloseTo(25);
    expect(at(69, 0.15, 100, 200).lossMW / at(69).lossMW).toBeCloseTo(2);
  });

  it('500 MW over 300 km with typical conductors', () => {
    const share = (kV: number) => lineLoss({ sendMW: 500, kV, lengthKm: 300, ohmPerKm: TYPICAL_OHM_PER_KM[kV] });
    expect(share(69).lossShare).toBe(1);
    expect(Math.round(share(69).amps)).toBe(4184);
    expect((share(138).lossShare * 100).toFixed(0)).toBe('63');
    expect((share(230).lossShare * 100).toFixed(0)).toBe('14');
    expect((share(345).lossShare * 100).toFixed(1)).toBe('3.8');
    expect((share(500).lossShare * 100).toFixed(1)).toBe('1.2');
    expect((share(765).lossShare * 100).toFixed(1)).toBe('0.3');
  });

  it('the under-2% challenge is reachable on the sliders, but not at 230 kV', () => {
    const resistances = Array.from({ length: 59 }, (_, i) => 0.01 + i * 0.005);
    const best = (kV: number) => Math.min(...resistances.map((r) => lineLoss({ sendMW: 500, kV, lengthKm: 300, ohmPerKm: r }).lossShare));
    expect(best(230)).toBeGreaterThan(0.02);
    expect(best(345)).toBeLessThan(0.02);
    expect(lineLoss({ sendMW: 500, kV: 500, lengthKm: 300, ohmPerKm: 0.03 }).lossShare).toBeLessThan(0.02);
  });
});
