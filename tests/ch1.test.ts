// Chapter 1: the engines behind lessons 1.1–1.5, and the numbers their prose quotes.

import { describe, expect, it } from 'vitest';
import { generatorAt, generatorEmf, synchronousRpm, transformer } from '../src/engines/physics/machines';
import { lineLoss, TYPICAL_OHM_PER_KM } from '../src/engines/physics/losses';
import { PHASE_OFFSETS_RAD, advanceRotor, coilAgo, coilAt, statorTeeth } from '../src/engines/physics/stator';
import { conductorAmps, deliveryChain } from '../src/engines/physics/delivery';
import { HOME_LOAD_KW, SYSTEM_DEMAND, energy } from '../src/model/profiles';
import { parallelCircuit, seriesCircuit } from '../src/engines/physics/circuits';
import { rmsFromPeak } from '../src/engines/physics/ac';
import { LAMP_OHMS, LAMP_VOLTS, mostHeatSolved } from '../src/lessons/ch1/L1_1';
import { europeSolved, threePhaseSumPeak } from '../src/lessons/ch1/L1_2';
import { TRACE_RANGE_V, gridVoltageSolved } from '../src/lessons/ch1/L1_3';
import { CHALLENGE_PRIMARY, TRANSFORMER_DEFAULTS, currentRatioSolved } from '../src/lessons/ch1/L1_4';
import { LINE_DEFAULTS, reachSolved, startingLossMW, thermalRatingAmps } from '../src/lessons/ch1/L1_5';

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

describe('lesson 1.1 numbers', () => {
  it('power and energy: toaster, kettle, a home and the region', () => {
    // A 1,200 W toaster for 30 minutes, and a kettle at twice the power for half as long.
    expect(1200 * 0.5).toBe(600);
    expect(2400 * 0.25).toBe(600);
    // At the illustrative 15 cents per kWh, the toast costs 9 cents.
    expect((0.6 * 0.15).toFixed(2)).toBe('0.09');
    // A typical home: between about 0.55 and 2.4 kW through the day, about 29 kWh in all.
    expect(Math.min(...HOME_LOAD_KW)).toBe(0.55);
    expect(Math.max(...HOME_LOAD_KW)).toBe(2.4);
    expect(energy(HOME_LOAD_KW)).toBeCloseTo(28.75, 9);
    expect(Math.round(energy(HOME_LOAD_KW))).toBe(29);
    // The region: 1,440 MW at its evening peak, about 26,000 MWh over the reference day.
    expect(Math.max(...SYSTEM_DEMAND)).toBe(1440);
    expect(SYSTEM_DEMAND.indexOf(1440)).toBe(19);
    expect(energy(SYSTEM_DEMAND)).toBe(25952);
    expect(Math.round(energy(SYSTEM_DEMAND) / 1000) * 1000).toBe(26000);
  });

  it('the most-heat challenge: unsolved at the start, one answer on the sliders, 24 V and 8 Ω', () => {
    expect(mostHeatSolved(12, 24)).toBe(false);
    expect(mostHeatSolved(24, 8)).toBe(true);
    // Every slider setting: voltage 0–24 V in half volts, resistance 2–100 Ω.
    const answers: Array<[number, number]> = [];
    for (let v2 = 0; v2 <= 48; v2++) for (let r = 2; r <= 100; r++) if (mostHeatSolved(v2 / 2, r)) answers.push([v2 / 2, r]);
    expect(answers).toEqual([[24, 8]]);
    // The success message: 24 V ÷ 3 A = 8 Ω, and 24 V × 3 A = 72 W.
    expect(24 / 8).toBe(3);
    expect(24 * 3).toBe(72);
    // Going past the limit makes more heat but breaks it: 24 V across 7 Ω is 3.43 A.
    expect(mostHeatSolved(24, 7)).toBe(false);
  });

  it('two lamps on 12 V: 6 W each in series, 24 W each in parallel', () => {
    const s = seriesCircuit(LAMP_VOLTS, LAMP_OHMS);
    const p = parallelCircuit(LAMP_VOLTS, LAMP_OHMS);
    expect(LAMP_VOLTS).toBe(12);
    expect(s.branches[0]).toMatchObject({ volts: 6, amps: 1, watts: 6 });
    expect(p.branches[0]).toMatchObject({ volts: 12, amps: 2, watts: 24 });
    expect(p.branches[0].watts / s.branches[0].watts).toBe(4);
    expect(s.totalAmps).toBe(1);
    expect(p.totalAmps).toBe(4);
  });
});

describe('lesson 1.2 numbers', () => {
  it('a 60 Hz cycle lasts about 16.7 ms; a 170 V peak is 120 V RMS', () => {
    expect((1000 / 60).toFixed(1)).toBe('16.7');
    expect(Math.round(rmsFromPeak(170))).toBe(120);
  });

  it('the European-supply challenge: unsolved at the start, solved only by 325 V at 50 Hz', () => {
    expect(europeSolved(60, 170)).toBe(false);
    expect(europeSolved(50, 325)).toBe(true);
    const answers: Array<[number, number]> = [];
    for (let f = 10; f <= 120; f++) for (let amp = 0; amp <= 340; amp++) if (europeSolved(f, amp)) answers.push([f, amp]);
    expect(answers).toEqual([[50, 325]]);
    // The success message: 230 × √2 ≈ 325, and a 50 Hz cycle lasts 20 ms.
    expect(Math.round(230 * Math.SQRT2)).toBe(325);
    expect(1000 / 50).toBe(20);
    // 230 V is not reachable by setting the peak to 230.
    expect(europeSolved(50, 230)).toBe(false);
  });

  it('three phases: zero sum only at 120°, one phase at 180°, and the sum stays on the ±340 V scale', () => {
    expect(threePhaseSumPeak(120)).toBeCloseTo(0, 12);
    expect(threePhaseSumPeak(180)).toBeCloseTo(1, 12);
    let max = 0;
    for (let s = 60; s <= 180; s++) {
      const m = threePhaseSumPeak(s);
      max = Math.max(max, m);
      if (s !== 120) expect(Math.round(170 * m)).toBeGreaterThan(0);
    }
    expect(170 * max).toBeLessThanOrEqual(340 + 1e-9);
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

  it('the trace’s fixed scale fits the start doubled in any one setting', () => {
    expect(TRACE_RANGE_V).toBe(500);
    const start = g(100, 0.5, 1800).peakVolts;
    for (const doubled of [g(200, 0.5, 1800), g(100, 1, 1800), g(100, 0.5, 3600)]) {
      expect(doubled.peakVolts).toBeCloseTo(2 * start, 9);
      expect(doubled.peakVolts).toBeLessThan(TRACE_RANGE_V);
    }
    expect(g(100, 0.45, 3600).peakVolts).toBeLessThan(TRACE_RANGE_V);
  });

  it('the challenge predicate: unsolved at the start, solved at 0.45 T and 3,600 rpm, and only with 100 turns', () => {
    expect(gridVoltageSolved({ field: 0.5, rpm: 1800, turns: 100 })).toBe(false);
    expect(gridVoltageSolved({ field: 0.45, rpm: 3600, turns: 100 })).toBe(true);
    // 90 turns at 0.5 T would also give 240 V RMS, but the challenge holds the coil at 100 turns.
    expect(Math.abs(g(90, 0.5, 3600).rmsVolts - 240)).toBeLessThan(0.5);
    expect(gridVoltageSolved({ field: 0.5, rpm: 3600, turns: 90 })).toBe(false);
    // The success message: 240 V × √2 ≈ 339 V.
    expect(Math.round(240 * Math.SQRT2)).toBe(339);
  });

  it('the 60 Hz, 240 V challenge at 100 turns needs the field slider: 0.45 T at 3,600 rpm', () => {
    // Every slider setting with the coil at 100 turns (two poles, as in the figure).
    const solutions: Array<[number, number]> = [];
    for (let rpm = 0; rpm <= 4800; rpm += 60) {
      for (let k = 0; k <= 20; k++) {
        const B = Number((k * 0.05).toFixed(2));
        const e = g(100, B, rpm);
        if (Math.abs(e.freqHz - 60) < 1e-9 && Math.abs(e.rmsVolts - 240) < 0.5) solutions.push([rpm, B]);
      }
    }
    expect(solutions).toEqual([[3600, 0.45]]);
    expect(Math.round(g(100, 0.45, 3600).peakVolts)).toBe(339);
    expect(Math.round(g(100, 0.45, 3600).rmsVolts)).toBe(240);
    // The starting field (0.5 T) at 3,600 rpm is too high, so the field slider has to move.
    expect(Math.abs(g(100, 0.5, 3600).rmsVolts - 240)).toBeGreaterThan(0.5);
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

  it('with losses, 103 turns instead of 100 bring the load back to 120 V', () => {
    expect(Math.round(lossy(200, 103).secondaryVolts)).toBe(120);
    expect(Math.round(lossy(200, 100).secondaryVolts)).toBe(116);
  });

  it('the five-fold current challenge: unsolved at the start, solved only by 40 turns', () => {
    expect(currentRatioSolved(TRANSFORMER_DEFAULTS)).toBe(false);
    expect(currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n2: 40 })).toBe(true);
    const answers: number[] = [];
    for (let n2 = 20; n2 <= 400; n2++) if (currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n2 })) answers.push(n2);
    expect(answers).toEqual([40]);
    // Only the turns ratio matters, not the load.
    for (let load = 2; load <= 48; load++) expect(currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n2: 40, load })).toBe(true);
    // Not with losses, on DC, or with a different primary.
    expect(currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n2: 40, losses: true })).toBe(false);
    expect(currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n2: 40, supply: 'dc' })).toBe(false);
    expect(currentRatioSolved({ ...TRANSFORMER_DEFAULTS, n1: 400, n2: 80 })).toBe(false);
    expect(CHALLENGE_PRIMARY).toBe(200);
    // The success message at the 12 Ω load: 48 V, 4.0 A out, 0.8 A in, 192 W.
    const t = transformer({ primaryVolts: 240, primaryTurns: 200, secondaryTurns: 40, loadOhms: 12 });
    expect(t.secondaryVolts).toBeCloseTo(48, 9);
    expect(t.secondaryAmps).toBeCloseTo(4, 9);
    expect(t.primaryAmps).toBeCloseTo(0.8, 9);
    expect(t.outputWatts).toBeCloseTo(192, 9);
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
    expect(Math.sqrt(3).toFixed(2)).toBe('1.73');
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
    // Twice the power at the same voltage: four times the loss, twice the share.
    expect((at(69).lossShare * 100).toFixed(1)).toBe('31.5');
    expect((at(69, 0.15, 200).lossShare * 100).toFixed(0)).toBe('63');
    expect(at(69, 0.15, 200).lossMW / at(69).lossMW).toBeCloseTo(4);
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

  it('the voltage-class chart marks losses above 20% impractical', () => {
    const IMPRACTICAL = 0.2;
    const row = (kV: number, ohmPerKm: number) => lineLoss({ sendMW: 500, kV, lengthKm: 300, ohmPerKm });
    const typical = [69, 138, 230, 345, 500, 765].map((kV) => row(kV, TYPICAL_OHM_PER_KM[kV]).lossShare);
    // 69 kV can't be done, 138 kV (63%) is impractical, 230 kV (14%) and up are drawn.
    expect(typical[0]).toBe(1);
    expect(typical[1]).toBeGreaterThan(IMPRACTICAL);
    expect(typical.slice(2).every((x) => x <= IMPRACTICAL)).toBe(true);
    // With the same 0.03 Ω/km conductor everywhere, 69 and 138 kV are impractical and the loss falls with the square of the voltage.
    const same = [69, 138, 230, 345, 500, 765].map((kV) => row(kV, 0.03).lossShare);
    expect(same[0]).toBeGreaterThan(IMPRACTICAL);
    expect(same[0]).toBeLessThan(1);
    expect(same[1]).toBeGreaterThan(IMPRACTICAL);
    expect(same.slice(2).every((x) => x <= IMPRACTICAL)).toBe(true);
    expect(row(230, 0.03).lossMW / row(460, 0.03).lossMW).toBeCloseTo(4);
  });

  it('thermal rating: 600 A for the starting conductor; 837 A is over it, 418 A within it', () => {
    expect(thermalRatingAmps(0.15)).toBeCloseTo(600, 9);
    expect(at(69).amps).toBeGreaterThan(thermalRatingAmps(0.15));
    expect(at(138).amps).toBeLessThan(thermalRatingAmps(0.15));
    // Thicker conductors (less resistance) are rated for more current.
    expect(thermalRatingAmps(0.03)).toBeGreaterThan(thermalRatingAmps(0.15));
    expect(thermalRatingAmps(0.3)).toBeLessThan(thermalRatingAmps(0.15));
  });

  it('the reach challenge: unsolved at the start, solved only by 400 km at 138 kV', () => {
    expect(startingLossMW().toFixed(1)).toBe('31.5');
    expect(reachSolved(LINE_DEFAULTS)).toBe(false);
    expect(reachSolved({ ...LINE_DEFAULTS, kvIdx: 1, lengthKm: 400 })).toBe(true);
    // Every length on the slider (10–500 km) at 138 kV.
    const answers: number[] = [];
    for (let km = 10; km <= 500; km += 10) if (reachSolved({ ...LINE_DEFAULTS, kvIdx: 1, lengthKm: km })) answers.push(km);
    expect(answers).toEqual([400]);
    // Doubling the power instead also matches the loss, but the challenge holds it at 100 MW.
    expect(at(138, 0.15, 200).lossMW).toBeCloseTo(startingLossMW(), 9);
    expect(reachSolved({ ...LINE_DEFAULTS, kvIdx: 1, sendMW: 200 })).toBe(false);
    expect(reachSolved({ ...LINE_DEFAULTS, kvIdx: 1, lengthKm: 400, ohmPerKm: 0.2 })).toBe(false);
    // At 138 kV the starting line loses 7.9 MW, a quarter, so it takes four times the length.
    expect(at(138).lossMW * 4).toBeCloseTo(startingLossMW(), 9);
  });

  it('the voltage-class caption: at 500 MW over 300 km, 500 kV is the lowest under 2%', () => {
    const share = (kV: number) => lineLoss({ sendMW: 500, kV, lengthKm: 300, ohmPerKm: TYPICAL_OHM_PER_KM[kV] }).lossShare;
    expect([69, 138, 230, 345, 500, 765].find((kV) => share(kV) < 0.02)).toBe(500);
  });
});
