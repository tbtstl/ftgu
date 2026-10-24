// The compute course: its engines and shared world, and the numbers its lessons quote.

import { describe, expect, it } from 'vitest';
import {
  chipState,
  maxClockGHz,
  minVoltageFor,
  parallelPower,
  CHIP_CAPACITANCE_F,
  CRITICAL_PATH_GATES,
  DIE_THERMAL_RESISTANCE,
} from '../src/engines/compute/chipPower';
import { busBandwidth, flatRingAllReduce, hierarchicalAllReduce, ringAllReduce, scaleOutLink, scaleUpLink } from '../src/engines/compute/collectives';
import { issueUtilization, occupancy, warpTimeline, warpsToHide, waves } from '../src/engines/compute/gpuExec';
import { builtInPotential, depletionWidthUm } from '../src/engines/compute/junction';
import {
  GATE_TYPES,
  arrayMultiplier,
  gate,
  rippleAdder,
  rippleWorstCase,
  switchLevel,
  toBits,
  GATE_TRANSISTORS,
  FULL_ADDER_TRANSISTORS,
  type GateType,
} from '../src/engines/compute/logic';
import { batchedMatmul, compulsoryBytes, largestTile, matmulFlops, tileFit, tiledMatmul } from '../src/engines/compute/matmul';
import {
  FORMATS,
  bitsOf,
  encode,
  refreshOverhead,
  refreshTrace,
  retentionMs,
  survivesRefresh,
  cellCharge,
  epsilon,
  relativeError,
} from '../src/engines/compute/memory';
import { CPU, GPU, amdahl, crossoverItems, peakTflops, runTask } from '../src/engines/compute/parallel';
import { attainableTflops, cachedKernel, kernelTime, machineOf } from '../src/engines/compute/roofline';
import {
  carriers,
  currentDensity,
  diodeCurrent,
  driftVelocity,
  intrinsicConcentration,
  V_SAT,
  COPPER_OHM_CM,
  SI_ATOMS,
  thermalVoltage,
} from '../src/engines/compute/semiconductor';
import {
  NFET,
  drainCurrent,
  gateDelayPs,
  inverterOut,
  offCurrent,
  onCurrent,
  subthresholdSwingMV,
  VDD,
  fetRegion,
  inverterThroughCurrent,
} from '../src/engines/compute/transistor';
import { conductivityGain, dotCount, holesMillionSolved, leastDopingForMillion, sci } from '../src/lessons/compute/ch1/L1_1';
import { IOFF, ION, LOW_VTH, PINCH_V, SWING_MV, current, thresholdSolved } from '../src/lessons/compute/ch1/L1_2';
import {
  DELAY_PS,
  GATE_DEFAULTS,
  RIPPLE_DEFAULTS,
  STAGES,
  conducts,
  halfAdderSolved,
  rippleCaption,
  rowsRight,
  slowestSolved,
  stageValues,
} from '../src/lessons/compute/ch1/L1_3';
import {
  CELL_DEFAULTS,
  FORMAT_DEFAULTS,
  INTERVAL,
  chargeAt,
  errorText,
  longestIntervalSolved,
  modelBytes,
  num,
  sixteenBitSolved,
} from '../src/lessons/compute/ch1/L1_4';
import { DEFAULTS, bestUnits, bestUnitsSolved, leastPowerFor900, leastPowerSolved } from '../src/lessons/compute/ch1/L1_5';
import {
  AMDAHL_DEFAULTS,
  CPU_LANES,
  GPU_LANES,
  ITEMS,
  LAB_DEFAULTS,
  SHARE_LOG,
  amdahlSolved,
  crossoverSolved,
  gpuWins,
  itemsAt,
  taskOf,
  tileFills,
} from '../src/lessons/compute/ch2/L2_1';
import {
  LESSON_NUMBERS,
  SCHED_DEFAULTS,
  WAVE_DEFAULTS,
  busySolved,
  kernelOf,
  mostRegistersForTarget,
  noIdleSolved,
  schedulerBusy,
} from '../src/lessons/compute/ch2/L2_2';
import {
  BATCH_DEFAULTS,
  FLOPS,
  MATMUL_DEFAULTS,
  MAX_GROUP,
  MIN_BYTES,
  ONE_VECTOR_S,
  RIDGE,
  batchRun,
  cheapBatchSolved,
  firstComputeBound,
  fullSpeedSolved,
  gb,
  inten,
  largestCheapBatch,
  matmulRun,
  ms,
  ns,
  smallestGroup,
  tf,
  us,
} from '../src/lessons/compute/ch2/L2_3';
import {
  D,
  LAYER_BYTES,
  MEM_DEFAULTS,
  NORM_TARGET,
  batchIntensity,
  batchSolved,
  cacheSolved,
  compareTflops,
  crossoverBatch,
  kernelIntensity,
  runMem,
  smallestComputeBatch,
  type MemState,
} from '../src/lessons/compute/ch2/L2_4';
import { CLUSTER_DEFAULTS, GRAD_70B, GRAD_8B, LATENCY_DEFAULTS, allReduce, bytesText, clusterSolved, dur } from '../src/lessons/compute/ch2/L2_5';
import { ACCELERATORS, serverPowerW, ridgePoint, SM_LIMITS, GPU_SERIAL_GOPS, HOST_CPU } from '../src/model/compute/hardware';
import { MODELS, kvBytesPerToken, paramCount } from '../src/model/compute/models';

describe('compute world', () => {
  it('has realistic model sizes', () => {
    expect(paramCount(MODELS['8B']) / 1e9).toBeCloseTo(8.03, 2);
    expect(paramCount(MODELS['70B']) / 1e9).toBeCloseTo(70.55, 2);
    expect(paramCount(MODELS['400B']) / 1e9).toBeCloseTo(405.85, 2);
    expect(kvBytesPerToken(MODELS['70B'])).toBe(327_680);
  });

  it('has consistent accelerators and servers', () => {
    expect(ridgePoint(ACCELERATORS.A)).toBeCloseTo(295.2, 1);
    expect(Math.round(serverPowerW('A'))).toBe(9298);
    expect(serverPowerW('B', 'liquid')).toBeLessThan(serverPowerW('B', 'air'));
  });
});

describe('semiconductor', () => {
  it('obeys the law of mass action', () => {
    for (const d of [1e14, 1e16, 1e18]) {
      const c = carriers('n', d);
      expect((c.n * c.p) / intrinsicConcentration() ** 2).toBeCloseTo(1, 6);
      expect(c.n).toBeCloseTo(d, -Math.log10(d) + 3);
    }
  });

  it('matches textbook resistivities', () => {
    expect(carriers('n', 1e16).rho).toBeCloseTo(0.527, 2);
    expect(carriers('p', 1e16).rho).toBeCloseTo(1.45, 1);
    expect(carriers('none', 0).rho).toBeGreaterThan(3e5);
  });

  it('saturates drift velocity and conducts in proportion to carriers', () => {
    expect(driftVelocity(1400, 1e6)).toBeLessThan(V_SAT);
    const lo = currentDensity(carriers('n', 1e15), 100);
    const hi = currentDensity(carriers('n', 1e16), 100);
    expect(hi / lo).toBeGreaterThan(8);
  });

  it('makes a one-way valve', () => {
    expect(diodeCurrent(0.7)).toBeGreaterThan(1e-3);
    expect(Math.abs(diodeCurrent(-1))).toBeLessThan(1e-13);
  });
});

describe('transistor', () => {
  it('switches with a large on/off ratio', () => {
    expect(onCurrent()).toBeCloseTo(1000, -1);
    expect(offCurrent() * 1000).toBeCloseTo(2.38, 1);
    expect(subthresholdSwingMV()).toBeCloseTo(77.4, 1);
    expect(drainCurrent(0.8, 0)).toBeCloseTo(0, 9);
  });

  it('trades leakage for speed through the threshold', () => {
    const low = { ...NFET, vth: 0.2 };
    expect(offCurrent(0.8, low)).toBeGreaterThan(10 * offCurrent());
    expect(gateDelayPs(0.8, low)).toBeLessThan(gateDelayPs());
    expect(gateDelayPs()).toBeCloseTo(8, 0);
  });

  it('inverts', () => {
    expect(inverterOut(0)).toBeCloseTo(0.8, 2);
    expect(inverterOut(0.8)).toBeCloseTo(0, 2);
    expect(inverterOut(0.4)).toBeCloseTo(0.4, 2);
  });
});

describe('logic', () => {
  it('computes the gates and their switch-level circuits', () => {
    for (const t of ['NOT', 'NAND', 'NOR'] as const)
      for (const a of [false, true])
        for (const b of [false, true]) {
          const s = switchLevel(t, a, b);
          expect(s.out).toBe(gate(t, a, b));
          expect(s.upConducts).not.toBe(s.downConducts);
        }
    expect(GATE_TYPES.length).toBe(6);
  });

  it('adds and times a ripple carry', () => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) {
        const r = rippleAdder(toBits(x, 4), toBits(y, 4));
        expect(r.value).toBe(x + y);
        expect(r.settle).toBeLessThanOrEqual(rippleWorstCase(4));
      }
    expect(rippleAdder(toBits(15, 4), toBits(1, 4)).settle).toBe(8);
    expect(rippleAdder(toBits(5, 4), toBits(10, 4)).settle).toBe(8);
    expect(rippleAdder(toBits(5, 4), toBits(5, 4)).settle).toBe(4);
  });

  it('sizes multipliers with the square of the width', () => {
    expect(arrayMultiplier(24).transistors / arrayMultiplier(8).transistors).toBeCloseTo(9.69, 1);
  });
});

describe('memory', () => {
  it('needs refresh within the standard window', () => {
    expect(retentionMs(85)).toBeCloseTo(100, 6);
    expect(retentionMs(95)).toBeCloseTo(50, 6);
    expect(survivesRefresh(64, 85)).toBe(true);
    expect(survivesRefresh(64, 95)).toBe(false);
    expect(refreshOverhead(64)).toBeCloseTo(0.0448, 3);
    const lost = refreshTrace(128, 85, 512);
    expect(lost[lost.length - 1][1]).toBe(0);
    const kept = refreshTrace(64, 85, 512);
    expect(kept[kept.length - 1][1]).toBeGreaterThan(0.5);
  });

  it('rounds into each format', () => {
    expect(encode(Math.PI, FORMATS.bf16).value).toBe(3.140625);
    expect(encode(Math.PI, FORMATS.fp8).value).toBe(3.25);
    expect(encode(70000, FORMATS.fp16).overflow).toBe(true);
    expect(encode(1e-5, FORMATS.fp8).underflow).toBe(true);
    expect(encode(1, FORMATS.fp32).expField).toBe(127);
    const b = bitsOf(encode(-2.5, FORMATS.bf16), FORMATS.bf16);
    expect(b.sign).toBe(1);
    expect(b.exp.join('')).toBe('10000000');
    expect(b.man.join('')).toBe('0100000');
  });
});

describe('chip power', () => {
  it('runs about 2 GHz at 0.8 V and 670 W', () => {
    expect(maxClockGHz(0.8)).toBeCloseTo(2.02, 2);
    expect(minVoltageFor(2)).toBeCloseTo(0.796, 3);
    const s = chipState(0.8, 2, 1);
    expect(s.totalW).toBeCloseTo(670, -1);
    expect(s.junctionC).toBeLessThan(90);
    expect(s.timingFails).toBe(false);
  });

  it('fails timing, overheats or runs away when pushed', () => {
    expect(chipState(0.7, 2, 1).timingFails).toBe(true);
    expect(chipState(0.9, 2.3, 1).overheated).toBe(true);
    expect(chipState(1.0, 2.5, 1).runaway).toBe(true);
  });

  it('saves power by going wide and slow', () => {
    expect(parallelPower(2, 2).totalW).toBeLessThan(0.65 * parallelPower(1, 2).totalW);
  });
});

// Lesson 1.1

describe('lesson compute/1.1', () => {
  it('formats powers of ten', () => {
    expect(sci(1e16)).toBe('10¹⁶');
    expect(sci(10 ** 16.8)).toBe('6.3 × 10¹⁶');
    expect(sci(1e-14)).toBe('10⁻¹⁴');
    expect(sci(1e4 * 0.99999999)).toBe('10⁴');
  });

  it('draws two dots per decade from 10¹⁰', () => {
    expect(dotCount(1e10)).toBe(2);
    expect(dotCount(1e16)).toBe(14);
    expect(dotCount(1e4)).toBe(0);
  });

  it('solves the challenge only with enough boron', () => {
    expect(holesMillionSolved('none', 16)).toBe(false);
    expect(holesMillionSolved('n', 19)).toBe(false);
    expect(holesMillionSolved('p', 16.7)).toBe(false);
    expect(holesMillionSolved('p', 16.8)).toBe(true);
    expect(leastDopingForMillion('p')).toBe(16.8);
    expect(leastDopingForMillion('n')).toBeLessThan(16.8);
    expect(Math.round(SI_ATOMS / 10 ** 16.8 / 1e4)).toBe(79);
  });

  it('quotes pure and doped silicon correctly', () => {
    const pure = carriers('none', 0);
    expect(pure.n).toBeCloseTo(1e10, -5);
    expect(SI_ATOMS / pure.n / 1e12).toBeCloseTo(5, 6);
    expect(Math.round(pure.rho / 1000)).toBe(331);
    expect(COPPER_OHM_CM.toFixed(7)).toBe('0.0000017');
    const n16 = carriers('n', 1e16);
    expect(Number(n16.rho.toPrecision(2))).toBe(0.53);
    expect(Number(conductivityGain('n', 16).toPrecision(2))).toBe(630000);
    expect(n16.p).toBeCloseTo(1e4, 0);
    expect(Math.round(pure.mobilityN / 100) * 100).toBe(1400);
    expect(Math.round(pure.mobilityP / 10) * 10).toBe(470);
    expect((driftVelocity(pure.mobilityN, 100) / 1e5).toFixed(1)).toBe('1.4');
    const n19 = carriers('n', 1e19);
    expect(Math.round(n19.mobilityN)).toBe(115);
    expect(Number(n19.rho.toPrecision(2))).toBe(0.0054);
    expect(Number((n19.rho / COPPER_OHM_CM).toPrecision(2))).toBe(3200);
  });

  it('quotes the junction correctly', () => {
    expect(builtInPotential(1e16, 1e16).toFixed(2)).toBe('0.71');
    expect(depletionWidthUm(1e16, 1e16, 0).toFixed(2)).toBe('0.43');
    expect(Math.round(depletionWidthUm(1e16, 1e16, 0) * 100) * 10).toBe(430);
    expect(depletionWidthUm(1e16, 1e16, 0.6).toFixed(2)).toBe('0.17');
    expect(depletionWidthUm(1e16, 1e16, -1).toFixed(2)).toBe('0.67');
    expect((diodeCurrent(0.6) * 1000).toFixed(2)).toBe('0.12');
    expect((diodeCurrent(0.7) * 1000).toFixed(1)).toBe('5.8');
    expect(diodeCurrent(0.5)).toBeLessThan(3e-6);
    expect(Math.round(thermalVoltage() * Math.LN10 * 1000)).toBe(60);
    expect(diodeCurrent(-1)).toBeCloseTo(-1e-14, 20);
  });

  it('narrows the depletion region under forward bias and widens it under reverse', () => {
    expect(depletionWidthUm(1e16, 1e16, 0.3)).toBeLessThan(depletionWidthUm(1e16, 1e16, 0));
    expect(depletionWidthUm(1e16, 1e16, -0.5)).toBeGreaterThan(depletionWidthUm(1e16, 1e16, 0));
    expect(depletionWidthUm(1e16, 1e16, 0.7)).toBeGreaterThan(0);
  });
});

// Lesson 1.2

describe('lesson compute/1.2', () => {
  it('quotes the transistor’s on and off currents', () => {
    expect(Math.round(ION / 10) * 10).toBe(1000);
    expect(current(IOFF)).toBe('2.38 nA');
    expect(Math.round(SWING_MV)).toBe(77);
    expect(Math.round((ION / IOFF) / 10000) * 10000).toBe(420000);
    expect(PINCH_V.toFixed(2)).toBe('0.38');
    // Saturation: past the pinch-off voltage the current stops growing.
    expect(fetRegion(0.8, 0.2)).toBe('linear');
    expect(fetRegion(0.8, 0.5)).toBe('saturated');
    expect(drainCurrent(0.8, 1.0) / drainCurrent(0.8, 0.5)).toBeCloseTo(1, 2);
  });

  it('solves the threshold challenge only between 0.33 and 0.35 V', () => {
    const grid = Array.from({ length: 26 }, (_, i) => Math.round((0.2 + i * 0.01) * 100) / 100);
    expect(grid.filter(thresholdSolved)).toEqual([0.33, 0.34, 0.35]);
    expect(thresholdSolved(0.3)).toBe(false);
  });

  it('quotes the low-threshold trade-off', () => {
    const on = onCurrent(VDD, LOW_VTH);
    const off = offCurrent(VDD, LOW_VTH);
    expect(Math.round((on / ION - 1) * 100)).toBe(44);
    expect(current(on)).toBe('1,442 µA');
    expect(current(ION)).toBe('1,002 µA');
    expect(Math.round((1 - gateDelayPs(VDD, LOW_VTH) / gateDelayPs()) * 100)).toBe(31);
    expect(Math.round(off / IOFF)).toBe(19);
    expect(current(off)).toBe('44.8 nA');
    // Each 10 mV lower: a few percent more on current, about a third more leakage.
    const a = { ...NFET, vth: 0.33 };
    const b = { ...NFET, vth: 0.32 };
    expect(offCurrent(VDD, b) / offCurrent(VDD, a)).toBeCloseTo(1.35, 1);
    expect(onCurrent(VDD, b) / onCurrent(VDD, a)).toBeLessThan(1.06);
  });

  it('quotes the inverter', () => {
    expect(Math.floor(inverterOut(0.38) * 100) / 100).toBe(0.75);
    expect(inverterOut(0.38)).toBeGreaterThan(0.75);
    expect(Math.ceil(inverterOut(0.42) * 100) / 100).toBe(0.05);
    expect(inverterOut(0.42)).toBeLessThan(0.05);
    const mid = inverterThroughCurrent(0.4);
    expect(current(mid)).toBe('51.8 µA');
    expect(current(inverterThroughCurrent(0))).toBe('2.38 nA');
    expect(Math.floor(mid / IOFF / 1000) * 1000).toBe(21000);
    expect(gateDelayPs().toFixed(0)).toBe('8');
    expect(gateDelayPs(0.6).toFixed(1)).toBe('16.6');
    expect(gateDelayPs(1.0).toFixed(1)).toBe('5.1');
  });
});

// Lesson 1.3

const GATES: GateType[] = ['NOT', 'NAND', 'NOR', 'AND', 'OR', 'XOR'];

describe('lesson compute/1.3', () => {
  it('draws switch-level circuits that compute each gate, with exactly one network conducting', () => {
    for (const t of GATES)
      for (const a of [false, true])
        for (const b of [false, true]) {
          const { vals, stageOut } = stageValues(t, a, b);
          expect(stageOut[stageOut.length - 1]).toBe(gate(t, a, b));
          // Each stage: pull-up and pull-down never both conduct, and one always does.
          STAGES[t].forEach((st, i) => {
            const v = { ...vals, X: i > 0 ? stageOut[i - 1] : vals.X };
            expect(conducts(st.up, v)).not.toBe(conducts(st.down, v));
          });
        }
  });

  it('counts transistors in the switch-level circuits (XOR adds two unseen inverters)', () => {
    const count = (t: GateType) =>
      STAGES[t].reduce((n, st) => {
        const k = (net: Parameters<typeof conducts>[0]): number => (net.k === 'sw' ? 1 : net.items.reduce((m, x) => m + k(x), 0));
        return n + k(st.up) + k(st.down);
      }, 0);
    for (const t of GATES) expect(count(t) + (t === 'XOR' ? 4 : 0)).toBe(GATE_TRANSISTORS[t]);
  });

  it('solves the half adder only with XOR and AND', () => {
    expect(halfAdderSolved('XOR', 'AND')).toBe(true);
    expect(halfAdderSolved(GATE_DEFAULTS.sum, GATE_DEFAULTS.carry)).toBe(false);
    let solutions = 0;
    for (const s of GATES) for (const c of GATES) if (halfAdderSolved(s, c)) solutions++;
    expect(solutions).toBe(1);
    expect(rowsRight('OR', 'AND')).toBe(3);
    expect(GATE_TRANSISTORS.XOR + GATE_TRANSISTORS.AND).toBe(18);
  });

  it('quotes the adder numbers', () => {
    expect(FULL_ADDER_TRANSISTORS).toBe(28);
    expect(4 * FULL_ADDER_TRANSISTORS).toBe(112);
    expect(Math.round(DELAY_PS)).toBe(8);
    const def = rippleAdder(toBits(RIPPLE_DEFAULTS.a, 4), toBits(RIPPLE_DEFAULTS.b, 4));
    expect(def.value).toBe(9);
    expect(def.settle).toBe(6);
    expect(def.bits.map((b) => b.kind)).toEqual(['propagate', 'generate', 'propagate', 'kill']);
    expect(def.bits[1].carryReady).toBe(2);
    expect(def.bits[2].carryReady).toBe(4);
    expect(Math.round(6 * DELAY_PS)).toBe(48);
    expect(rippleWorstCase(4)).toBe(8);
    expect(Math.round(8 * DELAY_PS)).toBe(64);
    expect(rippleCaption(def)).toBe('Bit 1 generates a carry, and bit 2 must wait for that carry, so bit 3’s sum digit is the last to settle, after 6 gate delays, about 48 ps.');
  });

  it('solves the slowest-sum challenge exactly when bits 1 and 2 propagate', () => {
    expect(slowestSolved(RIPPLE_DEFAULTS.a, RIPPLE_DEFAULTS.b)).toBe(false);
    expect(slowestSolved(15, 1)).toBe(true);
    expect(slowestSolved(5, 10)).toBe(true);
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const r = rippleAdder(toBits(a, 4), toBits(b, 4));
        expect(slowestSolved(a, b)).toBe(r.bits[1].kind === 'propagate' && r.bits[2].kind === 'propagate');
      }
  });

  it('quotes the 64-bit ripple, multiplier and accelerator numbers', () => {
    expect(rippleWorstCase(64)).toBe(128);
    expect(Math.round((128 * DELAY_PS) / 1000)).toBe(1);
    expect(arrayMultiplier(24).transistors).toBe(18912);
    expect(arrayMultiplier(8).transistors).toBe(1952);
    expect(arrayMultiplier(4).transistors).toBe(432);
    expect(Math.round(arrayMultiplier(24).transistors / arrayMultiplier(8).transistors)).toBe(10);
    expect(ACCELERATORS.A.bf16Tflops).toBe(989);
    expect(ACCELERATORS.A.fp32Tflops).toBe(67);
  });
});

// Lesson 1.4

describe('compute 1.4 memory cell lab', () => {
  it('solves the refresh challenge only at 95 °C and 50 ms', () => {
    expect(longestIntervalSolved('dram', 95, 50)).toBe(true);
    expect(longestIntervalSolved('dram', 95, 48)).toBe(false);
    expect(longestIntervalSolved('dram', 95, 52)).toBe(false);
    expect(longestIntervalSolved('sram', 95, 50)).toBe(false);
    expect(longestIntervalSolved(CELL_DEFAULTS.cell, CELL_DEFAULTS.temp, CELL_DEFAULTS.interval)).toBe(false);
    expect((50 - INTERVAL.min) % INTERVAL.step).toBe(0);
  });

  it('follows the cell between refreshes', () => {
    expect(chargeAt(10, 64, 85)).toBeCloseTo(cellCharge(10, 85), 12);
    expect(chargeAt(74, 64, 85)).toBeCloseTo(cellCharge(10, 85), 12);
    expect(chargeAt(130, 128, 85)).toBe(0);
  });

  it('quotes the DRAM numbers', () => {
    expect(retentionMs(85)).toBeCloseTo(100, 9);
    expect(retentionMs(95)).toBeCloseTo(50, 9);
    expect(retentionMs(45)).toBeCloseTo(1600, 6);
    expect(Math.round(cellCharge(64, 85) * 100)).toBe(64);
    expect(survivesRefresh(64, 85)).toBe(true);
    expect((refreshOverhead(64) * 100).toFixed(1)).toBe('4.5');
    expect((refreshOverhead(50) * 100).toFixed(1)).toBe('5.7');
    expect(ACCELERATORS.A.memoryGB * 1000 / ACCELERATORS.A.l2MB).toBe(1600);
  });

  it('quotes the number-format numbers', () => {
    expect(num(encode(Math.PI, FORMATS.fp32).value)).toBe('3.14159274');
    expect(Math.round(1 / relativeError(Math.PI, FORMATS.fp32) / 1e6)).toBe(36);
    expect(encode(Math.PI, FORMATS.bf16).value).toBe(3.140625);
    expect(encode(Math.PI, FORMATS.fp16).value).toBe(3.140625);
    expect(Math.round(1 / relativeError(Math.PI, FORMATS.bf16) / 100) * 100).toBe(3200);
    expect(encode(Math.PI, FORMATS.fp8).value).toBe(3.25);
    expect(Math.round(1 / relativeError(Math.PI, FORMATS.fp8))).toBe(29);
    expect(num(epsilon(FORMATS.fp32), 2)).toBe('1.2 × 10⁻⁷');
    expect(epsilon(FORMATS.fp8)).toBe(0.125);
    expect(num(FORMATS.fp16.max)).toBe('65,504');
    expect(num(FORMATS.bf16.max, 2)).toBe('3.4 × 10³⁸');
    expect(errorText(70000, 'fp16')).toBe('overflow: clamped to 65,504');
    expect(errorText(1e-5, 'fp8')).toBe('underflow: stored as 0');
    expect((relativeError(70000, FORMATS.fp16) * 100).toFixed(1)).toBe('6.4');
    expect(encode(70000, FORMATS.bf16).value).toBe(70144);
  });

  it('solves the 16-bit challenge with BF16 only', () => {
    expect(sixteenBitSolved(70000, 'bf16')).toBe(true);
    expect(sixteenBitSolved(-70000, 'bf16')).toBe(true);
    expect(sixteenBitSolved(70000, 'fp16')).toBe(false);
    expect(sixteenBitSolved(70000, 'fp32')).toBe(false);
    expect(sixteenBitSolved(60000, 'bf16')).toBe(false);
    expect(sixteenBitSolved(FORMAT_DEFAULTS.value, FORMAT_DEFAULTS.format)).toBe(false);
  });

  it('sizes the 70B model in each format', () => {
    expect((paramCount(MODELS['70B']) / 1e9).toFixed(2)).toBe('70.55');
    expect(Math.round(modelBytes('fp32') / 1e9)).toBe(282);
    expect(Math.round(modelBytes('bf16') / 1e9)).toBe(141);
    expect((modelBytes('fp8') / 1e9).toFixed(2)).toBe('70.55');
    expect((ACCELERATORS.A.memoryGB - modelBytes('fp8') / 1e9).toFixed(2)).toBe('9.45');
    expect(ACCELERATORS.A.fp8Tflops).toBe(1979);
    expect(ACCELERATORS.A.bf16Tflops).toBe(989);
  });
});

// Lesson 1.5

const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

describe('compute/1.5 challenges', () => {
  it('finds the least power for 900 TFLOPS: full activity, 1.85 GHz, 0.77 V', () => {
    const least = leastPowerFor900();
    expect(least.activity).toBe(1);
    expect(least.clockGHz).toBe(1.85);
    expect(least.vdd).toBe(0.77);
    expect(r(least.totalW)).toBe(567);
    expect(leastPowerSolved(0.77, 1.85, 100)).toBe(true);
    // The defaults, the near miss at 95% and a voltage too low all fail.
    expect(leastPowerSolved(DEFAULTS.volts, DEFAULTS.clock, DEFAULTS.activity)).toBe(false);
    expect(leastPowerSolved(0.78, 1.9, 95)).toBe(false);
    expect(leastPowerSolved(0.76, 1.85, 100)).toBe(false);
    // 1.8 GHz falls just short.
    expect(r(chipState(0.77, 1.8, 1).tflops)).toBe(899);
  });

  it('finds six copies best', () => {
    expect(bestUnits()).toBe(6);
    expect(bestUnitsSolved(6)).toBe(true);
    expect(bestUnitsSolved(1)).toBe(false);
  });
});

describe('compute/1.5 prose numbers', () => {
  it('sets the clock from the critical path', () => {
    expect(rippleWorstCase(4)).toBe(8);
    expect(r(gateDelayPs(0.8), 1)).toBe(8);
    expect(CRITICAL_PATH_GATES).toBe(62);
    expect(r(CRITICAL_PATH_GATES * gateDelayPs(0.8))).toBe(495);
    expect(r(maxClockGHz(0.8), 2)).toBe(2.02);
    expect(r(CHIP_CAPACITANCE_F * 1e9)).toBe(460);
    expect(100 * DIE_THERMAL_RESISTANCE).toBe(5);
  });

  it('runs the reference point at 670 W', () => {
    const ref = chipState(0.8, 2.0, 1);
    expect(r(ref.dynamicW)).toBe(589);
    expect(r(ref.leakageW)).toBe(81);
    expect(r(ref.totalW)).toBe(670);
    expect(r(ref.pjPerFlop, 2)).toBe(0.67);
  });

  it('climbs steeply toward the top', () => {
    // 0.86 V is the lowest grid voltage for 2.3 GHz, 0.87 V for 2.4 GHz.
    expect(chipState(0.85, 2.3, 1).timingFails).toBe(true);
    const fast = chipState(0.86, 2.3, 1);
    expect(fast.timingFails).toBe(false);
    expect(r(fast.totalW)).toBe(932);
    expect(r((fast.totalW / chipState(0.8, 2, 1).totalW - 1) * 100)).toBe(39);
    expect(chipState(0.86, 2.4, 1).timingFails).toBe(true);
    const faster = chipState(0.87, 2.4, 1);
    expect(r(faster.totalW)).toBe(1009);
    expect(r(faster.junctionC, 1)).toBe(90.4);
    expect(faster.overheated).toBe(true);
    expect(chipState(1.0, 2.5, 1).runaway).toBe(true);
    const top = chipState(0.86, 2.35, 1);
    expect(top.overheated).toBe(false);
    expect(Math.round(top.tflops / 10) * 10).toBe(1170);
    expect(r(top.totalW)).toBe(954);
    // Nothing on the grid sustains more.
    expect(chipState(0.87, 2.4, 1).overheated).toBe(true);
  });

  it('spends less energy per operation when slow', () => {
    expect(chipState(0.6, 1.0, 1).timingFails).toBe(true);
    const slow = chipState(0.61, 1.0, 1);
    expect(r(slow.pjPerFlop, 2)).toBe(0.38);
    expect(r((1 - slow.pjPerFlop / chipState(0.8, 2, 1).pjPerFlop) * 100)).toBe(43);
  });

  it('saves power by going wide', () => {
    expect(r(parallelPower(1, 2).totalW)).toBe(639);
    expect(r(parallelPower(2, 2).vdd, 2)).toBe(0.61);
    expect(r(parallelPower(2, 2).totalW)).toBe(386);
    expect(r((1 - parallelPower(2, 2).totalW / parallelPower(1, 2).totalW) * 100)).toBe(40);
    expect(r(parallelPower(4, 2).totalW)).toBe(278);
    expect(r(parallelPower(6, 2).totalW)).toBe(255);
    expect(r((1 - parallelPower(6, 2).totalW / parallelPower(1, 2).totalW) * 100)).toBe(60);
    expect(parallelPower(6, 2).vdd).toBe(0.45);
    expect(parallelPower(7, 2).vdd).toBe(0.45);
    expect(r(parallelPower(8, 2).totalW)).toBe(278);
    expect(NFET.vth).toBe(0.3);
  });

  it('quotes the A-class and its server', () => {
    expect(r(subthresholdSwingMV())).toBe(77);
    expect(ACCELERATORS.A.sms * SM_LIMITS.fp32Lanes).toBe(16896);
    expect(ACCELERATORS.A.clockGHz).toBe(1.98);
    expect(ACCELERATORS.A.bf16Tflops).toBe(989);
    expect(ACCELERATORS.A.tdpW).toBe(700);
    expect(r(serverPowerW('A') / 1000, 1)).toBe(9.3);
  });
});

// Chapter 2 engines

const GPU_A = ACCELERATORS.A;

describe('parallel', () => {
  it('compares a few fast cores with many slow lanes', () => {
    expect(peakTflops(CPU)).toBeCloseTo(12.29, 2);
    expect(peakTflops(GPU)).toBeCloseTo(66.91, 2);
    const t = { flopsPerItem: 2000, serialShare: 0, bytesPerItem: 0 };
    expect(runTask(CPU, { ...t, items: 100 }).totalS).toBeLessThan(runTask(GPU, { ...t, items: 100 }).totalS);
    expect(runTask(GPU, { ...t, items: 1e8 }).totalS).toBeLessThan(runTask(CPU, { ...t, items: 1e8 }).totalS / 4);
    expect(crossoverItems(t)).toBe(38913);
    expect(amdahl(0.01, 16896)).toBeCloseTo(99.4, 1);
    expect(runTask(GPU, { ...t, items: 1e8, serialShare: 0.01 }).totalS).toBeGreaterThan(runTask(CPU, { ...t, items: 1e8, serialShare: 0.01 }).totalS);
  });
});

describe('GPU execution', () => {
  it('limits occupancy by registers and hides latency with warps', () => {
    const o = occupancy({ threadsPerBlock: 256, regsPerThread: 64, sharedKBPerBlock: 0 });
    expect([o.blocksPerSM, o.warpsPerScheduler, o.limit]).toEqual([4, 8, 'registers']);
    expect(issueUtilization(8, 40)).toBeCloseTo(0.615, 3);
    expect(warpsToHide(40)).toBe(13);
    expect(warpTimeline(13, 40, 480, 5200).busy).toBeCloseTo(1, 6);
  });

  it('runs blocks in waves', () => {
    expect(waves(133, 1).utilization).toBeCloseTo(0.504, 3);
    expect(waves(264, 1).utilization).toBe(1);
  });
});

describe('matrix multiplication', () => {
  const s = { m: 8192, n: 8192, k: 8192 };
  it('raises intensity by tiling and sharing tiles', () => {
    expect(matmulFlops(s) / compulsoryBytes(s)).toBeCloseTo(2730.7, 1);
    expect(largestTile()).toBe(128);
    expect(tileFit(256).fits).toBe(false);
    expect(tiledMatmul(s, GPU_A, 1).intensity).toBeCloseTo(0.5, 3);
    expect(tiledMatmul(s, GPU_A, 128).bound).toBe('memory');
    expect(tiledMatmul(s, GPU_A, 128, 8).bound).toBe('compute');
  });

  it('makes batches nearly free until the ridge', () => {
    const one = batchedMatmul(8192, 8192, 1, GPU_A);
    const many = batchedMatmul(8192, 8192, 256, GPU_A);
    expect(many.totalS / one.totalS).toBeLessThan(1.07);
    expect(batchedMatmul(8192, 8192, 512, GPU_A).bound).toBe('compute');
  });
});

describe('roofline', () => {
  it('takes the lower roof', () => {
    expect(attainableTflops(1, 989, 3.35)).toBeCloseTo(3.35, 6);
    expect(attainableTflops(1000, 989, 3.35)).toBe(989);
    expect(kernelTime(1e12, 1e9, GPU_A).bound).toBe('compute');
    const m = machineOf(GPU_A);
    expect(cachedKernel({ flops: 2e9, workingSetBytes: 40e6, passes: 10 }, m).hitRate).toBe(1);
    expect(cachedKernel({ flops: 2e9, workingSetBytes: 100e6, passes: 10 }, m).hitRate).toBeCloseTo(0.5, 6);
  });
});

describe('collectives', () => {
  it('sums gradients faster within a server than across the network', () => {
    const intra = scaleUpLink('A');
    const inter = scaleOutLink('A');
    expect(ringAllReduce(141e9, 8, intra).seconds).toBeCloseTo(0.548, 3);
    expect(ringAllReduce(141e9, 8, inter).seconds).toBeCloseTo(4.935, 3);
    const h = hierarchicalAllReduce(16e9, 8, 8, intra, inter);
    expect(h.seconds).toBeCloseTo(0.132, 3);
    expect(flatRingAllReduce(16e9, 8, 8, intra, inter).seconds).toBeCloseTo(0.631, 3);
    expect(busBandwidth(16e9, 64, h.seconds)).toBeGreaterThan(200);
  });
});

// Lesson 2.1

const base = { flopsPerItem: 2000, serialShare: 0, bytesPerItem: 0 };
const both = (t: Parameters<typeof runTask>[1]) => ({ c: runTask(CPU, t), g: runTask(GPU, t) });

describe('lesson 2.1 — CPUs versus GPUs', () => {
  it('quotes the processors correctly', () => {
    expect(CPU_LANES).toBe(2048);
    expect(GPU_LANES).toBe(16896);
    expect(peakTflops(CPU)).toBeCloseTo(12.3, 1);
    expect(peakTflops(GPU)).toBeCloseTo(66.9, 1);
    expect(peakTflops(GPU) / peakTflops(CPU)).toBeCloseTo(5.4, 1);
    expect(HOST_CPU.serialGops / GPU_SERIAL_GOPS).toBe(20);
  });

  it('quotes the first demonstration’s numbers', () => {
    const million = both({ ...base, items: 1e6 });
    expect(million.g.totalS * 1e6).toBeCloseTo(40.3, 1);
    expect(million.c.totalS * 1e6).toBeCloseTo(168, 0);
    expect(million.c.totalS / million.g.totalS).toBeCloseTo(4.2, 1);
    const hundredM = both({ ...base, items: 1e8 });
    expect(hundredM.c.totalS / hundredM.g.totalS).toBeCloseTo(5.4, 1);
    const hundred = both({ ...base, items: 100 });
    expect(hundred.c.totalS * 1e6).toBeCloseTo(5.33, 2);
    expect(hundred.g.totalS * 1e6).toBeCloseTo(10.5, 1);
    expect(hundred.g.utilization * 100).toBeCloseTo(0.59, 2);
    const single = both({ ...base, items: 1e6, threads: 1 });
    expect(single.c.totalS * 1e3).toBeCloseTo(333, 0);
    expect(single.g.totalS * 1e3).toBeCloseTo(505, 0);
    const serial = both({ ...base, items: 1e6, serialShare: 0.01 });
    expect(serial.c.totalS * 1e3).toBeCloseTo(2.17, 2);
    expect(serial.g.totalS * 1e3).toBeCloseTo(40.0, 1);
    expect(Math.round(serial.g.totalS / serial.c.totalS)).toBe(18);
    const copied = both({ ...base, items: 1e6, bytesPerItem: 8 });
    expect(copied.g.copyS * 1e6).toBeCloseTo(160, 6);
    expect(copied.g.totalS * 1e6).toBeCloseTo(200, 0);
    expect(copied.g.totalS).toBeGreaterThan(copied.c.totalS);
    expect(Math.round((peakTflops(CPU) * 1e12) / 50e9)).toBe(246);
    const copied20k = both({ ...base, items: 1e6, flopsPerItem: 20000, bytesPerItem: 8 });
    expect(copied20k.c.totalS / copied20k.g.totalS).toBeCloseTo(3.5, 1);
  });

  it('solves the crossover challenge at 39,811 items only', () => {
    expect(crossoverItems(base)).toBe(38913);
    expect(Math.ceil(38913 / 2048)).toBe(20);
    expect(Math.ceil(38913 / 16896)).toBe(3);
    expect(crossoverSolved(LAB_DEFAULTS)).toBe(false);
    const solvedAt: number[] = [];
    for (let i = 0; i <= Math.round((ITEMS.max - ITEMS.min) / ITEMS.step); i++) {
      const logItems = Math.round((ITEMS.min + i * ITEMS.step) * 100) / 100;
      if (crossoverSolved({ ...LAB_DEFAULTS, logItems })) solvedAt.push(logItems);
    }
    expect(solvedAt).toEqual([4.6]);
    expect(itemsAt(4.6)).toBe(39811);
    const at = both({ ...base, items: 39811 });
    expect(at.g.totalS * 1e6).toBeCloseTo(11.5, 1);
    expect(at.c.totalS * 1e6).toBeCloseTo(11.7, 1);
    expect(crossoverSolved({ ...LAB_DEFAULTS, logItems: 4.6, copy: true })).toBe(false);
    expect(crossoverSolved({ ...LAB_DEFAULTS, logItems: 4.6, logConcurrency: 3 })).toBe(false);
    expect(gpuWins(LAB_DEFAULTS)).toBe(true);
  });

  it('applies Amdahl’s law and solves the second challenge at 0.089%', () => {
    expect(Math.round(amdahl(0.01, 2048))).toBe(95);
    expect(Math.round(amdahl(0.01, 16896))).toBe(99);
    expect(Math.round((amdahl(0.01, 16896) / amdahl(0.01, 2048) - 1) * 100)).toBe(4);
    expect(Math.round(amdahl(0.001, 16896))).toBe(944);
    expect(amdahlSolved(AMDAHL_DEFAULTS.logShare)).toBe(false);
    const solvedAt: number[] = [];
    for (let i = 0; i <= Math.round((SHARE_LOG.max - SHARE_LOG.min) / SHARE_LOG.step); i++) {
      const x = Math.round((SHARE_LOG.min + i * SHARE_LOG.step) * 100) / 100;
      if (amdahlSolved(x)) solvedAt.push(x);
    }
    expect(solvedAt).toEqual([-3.05]);
    expect(Math.round(amdahl(10 ** -3.05, 16896))).toBe(1052);
  });

  it('shades tiles consistently with utilization', () => {
    const t = taskOf(LAB_DEFAULTS);
    const r = runTask(GPU, t);
    const fills = tileFills(GPU, t, r, 132);
    const mean = fills.reduce((a, b) => a + b, 0) / fills.length;
    expect(mean).toBeCloseTo(r.utilization, 6);
    const small = { ...t, items: 100 };
    const rs = runTask(GPU, small);
    const fs = tileFills(GPU, small, rs, 132);
    expect(fs.reduce((a, b) => a + b, 0) / fs.length).toBeCloseTo(rs.utilization, 6);
  });
});

// Lesson 2.2

describe('lesson 2.2: GPU execution model', () => {
  it('quotes the default kernel correctly', () => {
    expect(LESSON_NUMBERS.defaultBlocks).toBe(4);
    expect(LESSON_NUMBERS.defaultWarps).toBe(32);
    expect(LESSON_NUMBERS.defaultPerScheduler).toBe(8);
    expect(LESSON_NUMBERS.defaultOccupancy).toBe(0.5);
    expect(LESSON_NUMBERS.defaultBusy).toBeCloseTo(0.615, 3);
    expect(SCHED_DEFAULTS.threads * SCHED_DEFAULTS.regs).toBe(16384);
    expect(occupancy(kernelOf(SCHED_DEFAULTS)).byLimit.threads).toBe(8);
    expect(LESSON_NUMBERS.hide).toBe(13);
    expect(LESSON_NUMBERS.threadsToHide).toBe(219648);
    expect(LESSON_NUMBERS.threadsToHide / LESSON_NUMBERS.lanes).toBe(13);
    expect(Math.round(LESSON_NUMBERS.latencyNs)).toBe(242);
  });

  it('solves the busy challenge at 42 registers and not at 43 or the start', () => {
    expect(busySolved(SCHED_DEFAULTS)).toBe(false);
    expect(mostRegistersForTarget()).toBe(42);
    expect(busySolved({ ...SCHED_DEFAULTS, regs: 42 })).toBe(true);
    expect(busySolved({ ...SCHED_DEFAULTS, regs: 43 })).toBe(false);
    expect(LESSON_NUMBERS.atMostRegsBusy).toBeCloseTo(0.923, 3);
    expect(LESSON_NUMBERS.oneMoreBusy).toBeCloseTo(0.769, 3);
    expect(LESSON_NUMBERS.at32Busy).toBe(1);
    expect(48 * 32 * 42).toBe(64512);
    // Raising the arithmetic also hides latency, but doesn't count for the challenge.
    expect(LESSON_NUMBERS.doubleCompute).toBe(1);
    expect(busySolved({ ...SCHED_DEFAULTS, compute: 80 })).toBe(false);
    // A block that can't fit at all.
    expect(schedulerBusy({ ...SCHED_DEFAULTS, threads: 1024, regs: 100 })).toBe(0);
  });

  it('quotes the waves correctly', () => {
    expect(LESSON_NUMBERS.w133).toBeCloseTo(0.504, 3);
    const w = waves(1000, 4);
    expect([w.waves, w.slots, w.lastWave]).toEqual([2, 528, 472]);
    expect(LESSON_NUMBERS.w1000).toBeCloseTo(0.947, 3);
    expect(issueUtilization(8, 40)).toBeCloseTo(0.615, 3);
  });

  it('solves the no-idle challenge at multiples of 264', () => {
    expect(noIdleSolved(WAVE_DEFAULTS)).toBe(false);
    expect(noIdleSolved({ blocks: 528, perSM: 2 })).toBe(true);
    expect(noIdleSolved({ blocks: 792, perSM: 2 })).toBe(true);
    expect(noIdleSolved({ blocks: 264, perSM: 2 })).toBe(false);
    expect(noIdleSolved({ blocks: 528, perSM: 4 })).toBe(false);
    expect(noIdleSolved({ blocks: 600, perSM: 2 })).toBe(false);
  });
});

// Lesson 2.3

describe('lesson 2.3: matrix operations', () => {
  it('times the naive, tiled and shared multiplies the prose quotes', () => {
    expect(FLOPS).toBe(2 * 8192 ** 3);
    expect(ms(FLOPS / 989e12)).toBe('1.11 ms');
    const naive = matmulRun(0, 1);
    expect(inten(naive.intensity)).toBe('0.5');
    expect(gb(naive.bytes)).toBe('2,199 GB');
    expect(ms(naive.totalS)).toBe('656 ms');
    expect(tf(naive.tflops)).toBe('1.7');
    const t128 = matmulRun(7, 1);
    expect(t128.fit.fits).toBe(true);
    expect([t128.fit.accumulatorKB, t128.fit.sharedKB]).toEqual([64, 64]);
    expect(gb(t128.bytes)).toBe('17.3 GB');
    expect(inten(t128.intensity)).toBe('63.5');
    expect(ms(t128.totalS)).toBe('5.17 ms');
    expect(tf(t128.tflops)).toBe('213');
    expect(Math.round((t128.tflops / 989) * 100)).toBe(22);
    expect(Math.round(naive.totalS / t128.totalS)).toBe(127);
    expect(matmulRun(8, 1).fit.fits).toBe(false);
    expect(matmulRun(8, 1).fit.accumulatorKB).toBe(256);
    const g8 = matmulRun(7, 8);
    expect([g8.reads, t128.reads]).toEqual([8, 64]);
    expect(gb(g8.bytes)).toBe('2.3 GB');
    expect(inten(g8.intensity)).toBe('482');
    expect(ms(g8.totalS)).toBe('1.11 ms');
    expect(Math.round(naive.totalS / g8.totalS / 10) * 10).toBe(590);
    expect(gb(MIN_BYTES)).toBe('0.40 GB');
    expect(Math.round(FLOPS / MIN_BYTES)).toBe(2731);
    expect(Math.round(RIDGE)).toBe(295);
    expect(ACCELERATORS.A.l2MB).toBe(50);
  });

  it('solves challenge a only with a fitting, compute-bound tiling', () => {
    expect(fullSpeedSolved(MATMUL_DEFAULTS.tileExp, MATMUL_DEFAULTS.group)).toBe(false);
    expect(smallestGroup(7)).toBe(5);
    expect(smallestGroup(6)).toBe(10);
    expect(smallestGroup(5)).toBe(null);
    expect(fullSpeedSolved(7, 5)).toBe(true);
    expect(fullSpeedSolved(7, 4)).toBe(false);
    expect(fullSpeedSolved(8, MAX_GROUP)).toBe(false);
    expect(inten(matmulRun(7, 5).intensity)).toBe('303');
    expect(matmulRun(7, 5).reads).toBe(13);
  });

  it('makes a batch nearly free until the ridge', () => {
    expect(us(ONE_VECTOR_S)).toBe('40.1 µs');
    expect(tf(batchRun(1).tflops)).toBe('3.3');
    expect(us(batchRun(1).computeS)).toBe('0.14 µs');
    expect(us(batchRun(256).totalS)).toBe('42.6 µs');
    expect(Math.round((batchRun(256).totalS / ONE_VECTOR_S - 1) * 100)).toBe(6);
    expect(firstComputeBound()).toBe(319);
    const perVector = batchRun(1024).totalS / 1024;
    expect(ns(perVector)).toBe('136 ns');
    expect(Math.round(ONE_VECTOR_S / perVector)).toBe(295);
  });

  it('solves challenge b at the largest batch within 10%', () => {
    expect(largestCheapBatch()).toBe(324);
    expect(cheapBatchSolved(324)).toBe(true);
    expect(cheapBatchSolved(323)).toBe(false);
    expect(cheapBatchSolved(325)).toBe(false);
    expect(cheapBatchSolved(BATCH_DEFAULTS.batch)).toBe(false);
    expect(us(batchRun(324).totalS)).toBe('44.0 µs');
  });
});

// Lesson 2.4

const A = ACCELERATORS.A;
const run = (p: Partial<MemState>) => runMem({ ...MEM_DEFAULTS, ...p });
const r2 = (v: number) => Math.round(v * 100) / 100;

describe('lesson 2.4: memory bandwidth and hierarchy', () => {
  it('recaps lesson 2.3’s layer and the hierarchy', () => {
    expect(D).toBe(8192);
    expect(Math.round(LAYER_BYTES / 1e6)).toBe(134);
    expect(r2(batchedMatmul(D, D, 1, A).totalS * 1e6)).toBeCloseTo(40.07, 2);
    expect(Math.round(batchedMatmul(D, D, 256, A).totalS * 1e7) / 10).toBe(42.6);
    expect((SM_LIMITS.registers * 4) / 1024).toBe(256);
    expect(SM_LIMITS.sharedKB).toBe(228);
    expect([A.l2MB, A.l2TBs, A.memoryGB, A.bandwidthTBs, GPU.copyGBs]).toEqual([50, 7, 80, 3.35, 50]);
    expect(Math.round(ridgePoint(A))).toBe(295);
  });

  it('places the kernels on the roofline', () => {
    expect(r2(run({ kernel: 'add' }).tflops)).toBe(0.56);
    expect(Math.round((run({ kernel: 'add' }).tflops / A.bf16Tflops) * 10000) / 100).toBe(0.06);
    expect(run({ kernel: 'norm' }).tflops).toBeCloseTo(3.35, 6);
    expect(r2(run({ kernel: 'gemv' }).tflops)).toBe(3.35);
    expect(Math.round((run({ kernel: 'gemv' }).tflops / A.bf16Tflops) * 1000) / 10).toBe(0.3);
    expect(Math.round(run({ kernel: 'gemv', batch: 64 }).intensity)).toBe(63);
    expect(Math.round(run({ kernel: 'gemv', batch: 64 }).tflops)).toBe(211);
    expect(Math.round(kernelIntensity('gemm', 1))).toBe(2731);
    expect(run({ kernel: 'gemm' }).tflops).toBe(989);
    expect(r2(run({ kernel: 'gemv', bw: 2 * A.bandwidthTBs }).tflops)).toBe(6.7);
    expect(run({ kernel: 'gemm', bw: 0.5 }).tflops).toBe(989);
  });

  it('solves challenge a only at the smallest compute-bound batch', () => {
    expect(smallestComputeBatch()).toBe(319);
    expect(batchIntensity(318)).toBeLessThan(ridgePoint(A));
    expect(batchSolved({ ...MEM_DEFAULTS, batch: 319 })).toBe(true);
    expect(batchSolved({ ...MEM_DEFAULTS, batch: 320 })).toBe(false);
    expect(batchSolved({ ...MEM_DEFAULTS, batch: 318 })).toBe(false);
    expect(batchSolved(MEM_DEFAULTS)).toBe(false);
    expect(batchSolved({ ...MEM_DEFAULTS, batch: 319, passes: 2 })).toBe(false);
  });

  it('shows the cache helping, then limiting', () => {
    const ws40 = Math.log10(40);
    expect(r2(run({ kernel: 'norm', wsLog: ws40, passes: 2 }).tflops)).toBe(6.7);
    expect(r2(run({ kernel: 'norm', wsLog: ws40, passes: 3 }).tflops)).toBe(10.05);
    expect(run({ kernel: 'norm', wsLog: ws40, passes: 3 }).bound).toBe('memory');
    expect(run({ kernel: 'norm', wsLog: ws40, passes: 4 }).bound).toBe('cache');
    expect(r2(run({ kernel: 'norm', wsLog: ws40, passes: 8 }).tflops)).toBe(8);
    const big = run({ kernel: 'norm', wsLog: Math.log10(500), passes: 2 });
    expect(Math.round(big.hitRate * 100)).toBe(10);
    expect(r2(big.tflops)).toBe(3.53);
  });

  it('solves challenge b with repeat reads that fit in the cache', () => {
    expect(NORM_TARGET).toBe(6);
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm' })).toBe(false);
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', passes: 4 })).toBe(false); // 134 MB doesn't fit
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', passes: 32 })).toBe(false); // 5.24 TFLOPS at most
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', wsLog: Math.log10(40), passes: 2 })).toBe(true);
    expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', wsLog: Math.log10(40), passes: 2, bw: 3.4 })).toBe(false);
  });

  it('compares the three accelerators', () => {
    expect([ridgePoint(ACCELERATORS.L), ridgePoint(A), ridgePoint(ACCELERATORS.B)].map(Math.round)).toEqual([421, 295, 281]);
    expect(Math.round((compareTflops('B', 1) / compareTflops('A', 1)) * 10) / 10).toBe(2.4);
    expect(Math.round((compareTflops('L', 1) / compareTflops('A', 1)) * 100)).toBe(26);
    expect(r2(compareTflops('B', 3000) / compareTflops('A', 3000))).toBe(2.28);
    expect(Math.round((compareTflops('L', 3000) / compareTflops('A', 3000)) * 100)).toBe(37);
    expect([crossoverBatch('L'), crossoverBatch('A'), crossoverBatch('B')]).toEqual([470, 319, 302]);
  });
});

// Lesson 2.5

describe('lesson 2.5: multi-GPU interconnects', () => {
  it('sizes the gradients', () => {
    expect(bytesText(GRAD_8B)).toBe('16.1 GB');
    expect(bytesText(GRAD_70B)).toBe('141 GB');
    expect(ACCELERATORS.A.scaleUpGBs).toBe(450);
    expect(ACCELERATORS.L.scaleUpGBs).toBe(32);
    expect(ACCELERATORS.B.scaleUpGBs).toBe(900);
    expect(ACCELERATORS.A.nicGbps / 8).toBe(50);
    expect(scaleUpLink('A').latencyUs).toBe(2);
    expect(scaleOutLink('A').latencyUs).toBe(8);
  });

  it('quotes the flat-ring times', () => {
    expect(dur(allReduce('A', 1, GRAD_8B, 'flat').seconds)).toBe('62.5 ms');
    expect(dur(allReduce('A', 2, GRAD_8B, 'flat').seconds)).toBe('602 ms');
    expect(dur(allReduce('A', 8, GRAD_8B, 'flat').seconds)).toBe('633 ms');
    expect(dur(allReduce('L', 1, GRAD_8B, 'flat').seconds)).toBe('878 ms');
    expect(dur(allReduce('B', 1, GRAD_8B, 'flat').seconds)).toBe('31.3 ms');
    expect(Math.round(allReduce('L', 1, GRAD_8B, 'flat').seconds / allReduce('B', 1, GRAD_8B, 'flat').seconds)).toBe(28);
    expect(Math.round(allReduce('L', 1, GRAD_8B, 'flat').seconds / allReduce('A', 1, GRAD_8B, 'flat').seconds)).toBe(14);
    expect(dur(allReduce('A', 1, GRAD_70B, 'flat').seconds)).toBe('549 ms');
    // Nearly ten times as long with a second server.
    const ratio = allReduce('A', 2, GRAD_8B, 'flat').seconds / allReduce('A', 1, GRAD_8B, 'flat').seconds;
    expect(ratio).toBeGreaterThan(9.5);
    expect(ratio).toBeLessThan(10);
  });

  it('quotes the two-level times', () => {
    expect(dur(allReduce('A', 2, GRAD_8B, 'two-level').seconds)).toBe('103 ms');
    const eight = allReduce('A', 8, GRAD_8B, 'two-level');
    expect(dur(eight.seconds)).toBe('133 ms');
    expect(dur(eight.insideS / 2)).toBe('31.2 ms');
    expect(dur(eight.betweenS)).toBe('70.4 ms');
    expect(dur(allReduce('A', 16, GRAD_8B, 'two-level').seconds)).toBe('138 ms');
    expect(dur(allReduce('A', 8, GRAD_70B, 'two-level').seconds)).toBe('1.17 s');
  });

  it('quotes the latency figures', () => {
    expect(LATENCY_DEFAULTS).toEqual({ logBytes: 6, logGpus: 10 });
    const f = allReduce('A', 128, 1e6, 'flat');
    expect(dur(f.seconds)).toBe('16.4 ms');
    expect(((100 * f.delayS) / f.seconds).toFixed(1)).toBe('99.8');
    expect(f.delayS / (scaleOutLink('A').latencyUs * 1e-6)).toBeCloseTo(2046, 6);
    expect(dur(f.dataS)).toBe('40 µs');
    expect(dur(allReduce('A', 128, 1e6, 'two-level').seconds)).toBe('2.07 ms');
  });

  it('solves the challenge only with two levels on 64 A-class GPUs', () => {
    expect(clusterSolved(CLUSTER_DEFAULTS)).toBe(false);
    expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8 })).toBe(false);
    expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level' })).toBe(true);
    expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', gpu: 'B' })).toBe(false);
    expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', logBytes: 9 })).toBe(false);
    expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', gpu: 'L' })).toBe(false);
  });
});
