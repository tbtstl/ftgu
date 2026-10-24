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
import { checkAssignment, feasibleAssignments, workloadFit } from '../src/engines/compute/compatibility';
import { airflowM3s, annualPue, chipCooling, waterFlowLs, chillerCop, junctionC } from '../src/engines/compute/cooling';
import { fabric, jobNetworkShare, maxTwoTierGpus } from '../src/engines/compute/dcNetwork';
import { breakEvenUtilization, capitalRecovery, gpuHourCost } from '../src/engines/compute/facilityCost';
import { POWER_DEFAULTS, powerChain, upsEfficiency, upsPlan } from '../src/engines/compute/facilityPower';
import { issueUtilization, occupancy, warpTimeline, warpsToHide, waves } from '../src/engines/compute/gpuExec';
import { decodeStep, maxBatch, memoryPlan, prefillS, servingPoint } from '../src/engines/compute/inference';
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
import { clusterLayout, rackConfig, rackLimits, serverUnits } from '../src/engines/compute/rack';
import { attainableTflops, cachedKernel, kernelTime, machineOf } from '../src/engines/compute/roofline';
import { simulateServing } from '../src/engines/compute/scheduling';
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
import { trainingRun, trainFlopsPerToken, TRAIN_COMPUTE_EFFICIENCY } from '../src/engines/compute/training';
import { forwardPass, layerOps } from '../src/engines/compute/transformer';
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
import {
  EARLIER_MAX_K,
  EXPLORER_DEFAULTS,
  TOKEN_STEPS,
  activeOp,
  attentionSolved,
  attentionVsFeedForward,
  earlierAt,
  explore,
  feedForwardComputeBound,
  feedForwardSolved,
  feedForwardThreshold,
  memoryUse,
  tokensAt,
} from '../src/lessons/compute/ch3/L3_1';
import {
  BATCH_EXP_MAX,
  BATCH_EXP_STEP,
  SERVE_DEFAULTS,
  TPOT_LIMIT,
  bf16FrontierSolved,
  cheapestA40,
  cheapestSolved,
  configOf,
  largestWithin,
  requestedBatch,
  runServe,
} from '../src/lessons/compute/ch3/L3_2';
import {
  BUDGET_GPU_HOURS,
  NUMBERS,
  SCALE_DEFAULTS,
  SCALE_SPLITS,
  TRAIN_DEFAULTS,
  WEEK_DAYS,
  fastestSolved,
  fastestSplit,
  runOf,
  scaleRun,
  weekSolved,
} from '../src/lessons/compute/ch3/L3_3';
import {
  BEST_CAPS,
  BEST_RATE,
  CAP_AVERAGE,
  CAP_MAX,
  CURVE_CAPS,
  CURVE_RATES,
  INPUT,
  LAB_DEFAULTS as L3_4_LAB_DEFAULTS,
  OUTPUT,
  PREFILL_S,
  RATE_MAX,
  RATE_STEP,
  SERVE,
  meetsLimits,
  rateSolved,
  runLab,
} from '../src/lessons/compute/ch3/L3_4';
import {
  ALL_ON_A,
  FLEET,
  LESSON_NUMBERS as L3_5_LESSON_NUMBERS,
  binding,
  fleetSolved,
  gpusFor,
  largestBatch,
  linkShare,
  ratio,
  splitRows,
} from '../src/lessons/compute/ch3/L3_5';
import {
  HALL_DEFAULTS,
  NUMBERS as L4_1_NUMBERS,
  RACK_DEFAULTS,
  bindingLimits,
  hallSolved,
  nextBlockers,
  rackSolved,
  rackState,
  serverBreakdown,
  spaceLimit,
} from '../src/lessons/compute/ch4/L4_1';
import {
  CHAIN_DEFAULTS,
  LESSON_NUMBERS as L4_2_LESSON_NUMBERS,
  PEAK_COOLING,
  SITE_DEFAULTS,
  chainOf,
  gpusForIt,
  gridSolved,
  largestItFor,
  lossSolved,
  roundTo,
  siteRun,
} from '../src/lessons/compute/ch4/L4_2';
import {
  BUILDING_DEFAULTS,
  CHIP_DEFAULTS,
  HALL_MW,
  RACK_KW,
  bayportSolved,
  dailyPue,
  fullSpeed,
  sitePue,
  warmestFullSpeed,
  warmestSolved,
} from '../src/lessons/compute/ch4/L4_3';
import {
  BASE,
  CHEAPEST,
  CLUSTER_GPUS,
  DP,
  GRAD_BYTES,
  HIDE_SHARE,
  HIDE_WINDOW,
  LESSON_NUMBERS as L4_4_LESSON_NUMBERS,
  RUN_DEFAULTS,
  SERVER_PER_GPU,
  cheapestSolved as L4_4_cheapestSolved,
  clusterFabric,
  exchangeS,
  runAt,
  runShare,
} from '../src/lessons/compute/ch4/L4_4';
import {
  LESSON_NUMBERS as N,
  PLANNER_DEFAULTS,
  PRICE_DEFAULTS,
  PUE,
  about,
  breakEven,
  breakEvenSolved,
  costOf,
  underTargetSolved,
  usedHourCost,
} from '../src/lessons/compute/ch4/L4_5';
import { ACCELERATORS, serverPowerW, ridgePoint, SM_LIMITS, GPU_SERIAL_GOPS, HOST_CPU, GPU_IDS } from '../src/model/compute/hardware';
import { MODELS, kvBytesPerToken, paramCount, kvDim, matmulParams } from '../src/model/compute/models';
import { SITES, outdoorTempC } from '../src/model/compute/sites';
import { WORKLOAD_IDS, WORKLOADS, type ServingWorkload } from '../src/model/compute/workloads';

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

{
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
}

// Lesson 1.2

{
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
}

// Lesson 1.3

{
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
}

// Lesson 1.4

{
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
}

// Lesson 1.5

{
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
}

// Chapter 2 engines

{
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
}

// Lesson 2.1

{
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
}

// Lesson 2.2

{
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
}

// Lesson 2.3

{
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
}

// Lesson 2.4

{
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
}

// Lesson 2.5

{
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
}

// Chapter 3 engines

{
  describe('transformer', () => {
    it('puts nearly all arithmetic in matrix multiplies and decode on memory', () => {
      const decode = forwardPass(MODELS['8B'], 1, 1000, ACCELERATORS.A);
      expect(decode.matmulShare).toBeGreaterThan(0.95);
      expect(decode.memoryBoundShare).toBe(1);
      const prefill = forwardPass(MODELS['8B'], 1000, 1000, ACCELERATORS.A);
      expect(prefill.memoryBoundShare).toBeLessThan(0.1);
      expect(layerOps(MODELS['70B'], 1, 0).find((o) => o.id === 'up')!.weightBytes).toBe(2 * 8192 * 2 * 28672);
    });
  });

  describe('inference', () => {
    const a8 = { model: '70B', gpu: 'A', tp: 8, precision: 'bf16' } as const;
    const a4 = { model: '70B', gpu: 'A', tp: 4, precision: 'bf16' } as const;
    it('shares memory between weights and cache', () => {
      expect(memoryPlan(a4).kvBytes / 1e9).toBeCloseTo(146.9, 1);
      expect(maxBatch(a4, 1300)).toBe(344);
      expect(memoryPlan({ model: '400B', gpu: 'L', tp: 8, precision: 'fp8' }).fits).toBe(false);
    });

    it('steps at memory speed until the batch is large', () => {
      const one = decodeStep(a8, 1, 1150);
      expect(one.bound).toBe('memory');
      expect(one.seconds * 1e3).toBeCloseTo(11.09, 2);
      expect(prefillS(a8, 1000)).toBeCloseTo(0.04, 3);
      const p = servingPoint(a4, 344, 1000, 300);
      expect(p.tpot * 1e3).toBeCloseTo(30.2, 1);
      expect(servingPoint(a4, 1, 1000, 300).tokensPerS).toBeLessThan(p.tokensPerS / 40);
    });
  });

  describe('training', () => {
    const base = { model: '70B', gpu: 'A', gpus: 1024, tp: 8, pp: 4, batchTokens: 4 * 1024 * 1024, seqLen: 4096, tokens: 2e12 } as const;
    it('trains the 70B model on 2 trillion tokens in about 20 days on 1,024 A-class GPUs', () => {
      const r = trainingRun(base);
      expect(r.fits).toBe(true);
      expect(r.mfu).toBeCloseTo(0.508, 2);
      expect(r.days).toBeCloseTo(19.5, 1);
    });

    it('pays for splitting a layer across servers, and for not splitting at all', () => {
      expect(trainingRun({ ...base, tp: 16, pp: 2 }).mfu).toBeLessThan(0.2);
      expect(trainingRun({ ...base, tp: 1, pp: 1 }).fits).toBe(false);
      expect(trainingRun({ ...base, gpus: 1000 }).valid).toBe(false);
    });
  });

  describe('scheduling', () => {
    const serve = { model: '70B', gpu: 'A', tp: 4, precision: 'bf16' } as const;
    it('queues without bound once arrivals outrun the batch', () => {
      const light = simulateServing({ serve, arrivalsPerS: 4, maxBatch: 256, input: 1000, outputMean: 300, seconds: 120 });
      expect(light.overloaded).toBe(false);
      expect(light.ttftP95).toBeLessThan(0.5);
      const capped = simulateServing({ serve, arrivalsPerS: 8, maxBatch: 16, input: 1000, outputMean: 300, seconds: 120 });
      expect(capped.overloaded).toBe(true);
      const heavy = simulateServing({ serve, arrivalsPerS: 20, maxBatch: 256, input: 1000, outputMean: 300, seconds: 120 });
      expect(heavy.overloaded).toBe(true);
      expect(heavy.throughput).toBeGreaterThan(light.throughput);
    });

    it('is deterministic', () => {
      const c = { serve, arrivalsPerS: 6, maxBatch: 64, input: 1000, outputMean: 300, seconds: 60 };
      expect(simulateServing(c).ttftP95).toBe(simulateServing(c).ttftP95);
    });
  });

  describe('compatibility', () => {
    it('sizes each workload on each accelerator', () => {
      expect(workloadFit('frontier400', 'L').feasible).toBe(false);
      expect(workloadFit('chat70', 'A').gpus).toBe(36);
      expect(workloadFit('chat70', 'L').gpus).toBe(864);
      expect(workloadFit('train70', 'A').gpus).toBe(304);
      expect(workloadFit('train70', 'B').gpus).toBe(128);
      expect(workloadFit('batch8', 'L').gpus).toBe(64);
    });

    it('has exactly one way to fit the reference fleet', () => {
      const fleet = { L: 64, A: 336, B: 24 };
      const all = feasibleAssignments(WORKLOAD_IDS, fleet);
      expect(all.length).toBe(1);
      expect(all[0]).toEqual({ chat70: 'B', code8: 'A', batch8: 'L', frontier400: 'B', train70: 'A', tune8: 'A' });
      expect(checkAssignment(all[0], fleet).used).toEqual({ L: 64, A: 333, B: 22 });
    });
  });
}

// Lesson 3.1

{
  const M8 = MODELS['8B'];
  const GPU = ACCELERATORS.A;
  const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 3.1: neural network computation', () => {
    it('maps the sliders', () => {
      expect(tokensAt(0)).toBe(1);
      expect(tokensAt(12 * TOKEN_STEPS)).toBe(4096);
      expect(tokensAt(10 * TOKEN_STEPS)).toBe(1024);
      expect(earlierAt(0)).toBe(0);
      expect(earlierAt(80)).toBe(1024);
      expect(earlierAt(EARLIER_MAX_K)).toBe(32768);
    });

    it('quotes the decode numbers', () => {
      const d = explore(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek);
      expect(d.earlier).toBe(1024);
      expect(d.pass.memoryBoundShare).toBe(1);
      const ops = Object.fromEntries(d.pass.ops.map((o) => [o.id, o]));
      const layerWeights = d.pass.ops.reduce((s, o) => s + o.weightBytes, 0);
      expect(r(layerWeights / 1e6)).toBe(436);
      expect(r(d.pass.layerFlops / 1e9, 2)).toBe(0.45);
      expect(r((ops.up.weightBytes + ops.down.weightBytes) / 1e6)).toBe(352);
      expect(r(((ops.up.totalS + ops.down.totalS) / d.pass.layerS) * 100)).toBe(80);
      expect(r(d.pass.layerS * 1e6)).toBe(132);
      expect(r((matmulParams(M8) * 2) / 1e9, 1)).toBe(15.0);
      expect(r(d.pass.totalS * 1e3, 2)).toBe(4.52);
      expect(r(1 / d.pass.totalS)).toBe(221);
      expect(r(d.pass.totalFlops / d.pass.totalS / 1e12, 1)).toBe(3.4);
      expect(r(Math.round(d.pass.matmulShare * 100))).toBe(97);
    });

    it('quotes the prompt numbers', () => {
      const p = explore(10 * TOKEN_STEPS, 0);
      const d = explore(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek);
      expect(p.tokens).toBe(1024);
      expect(feedForwardComputeBound(p.pass)).toBe(true);
      expect(r(p.pass.totalS * 1e3, 1)).toBe(17.3);
      expect(r(p.pass.totalS / d.pass.totalS, 1)).toBe(3.8);
      expect(r(p.pass.memoryBoundShare * 100, 1)).toBe(7.6);
    });

    it('has challenge a: the fewest tokens for compute-bound feed-forward multiplies', () => {
      const t = feedForwardThreshold();
      expect(t.exact).toBe(326);
      expect(t.tokens).toBe(332);
      expect(feedForwardSolved(t.k, 0)).toBe(true);
      expect(feedForwardSolved(t.k, 100)).toBe(true);
      expect(feedForwardSolved(t.k + 1, 0)).toBe(false);
      expect(feedForwardSolved(t.k - 1, 0)).toBe(false);
      expect(feedForwardSolved(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek)).toBe(false);
      expect(forwardPass(M8, 326, 326, GPU).ops.find((o) => o.id === 'up')!.bound).toBe('compute');
    });

    it('has challenge b: attention longer than the feed-forward block', () => {
      expect(attentionSolved(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek)).toBe(false);
      expect(attentionSolved(0, EARLIER_MAX_K)).toBe(false);
      expect(attentionSolved(12 * TOKEN_STEPS, EARLIER_MAX_K)).toBe(true);
      const long = explore(0, EARLIER_MAX_K);
      const av = attentionVsFeedForward(long.pass);
      expect(r(av.attention * 1e6, 1)).toBe(40.1);
      expect(r(av.feedForward * 1e6)).toBe(105);
      expect(r(long.pass.ops.find((o) => o.id === 'attn')!.kvBytes / 1e6)).toBe(134);
      expect(kvBytesPerToken(M8)).toBe(131072);
      expect(kvDim(M8)).toBe(1024);
    });

    it('quotes the memory numbers', () => {
      const u8 = memoryUse('8B', 64, 4096);
      expect(r(u8.weights / 1e9, 1)).toBe(16.1);
      expect(r(u8.cache / 1e9, 1)).toBe(34.4);
      expect(u8.cache).toBeGreaterThan(2 * u8.weights);
      expect(u8.kvTokens).toBe(426788);
      expect(Math.floor(u8.kvTokens / 4096)).toBe(104);
      const u70 = memoryUse('70B', 0, 4096);
      expect(r(u70.weights / 1e9)).toBe(141);
      expect(u70.fits).toBe(false);
      expect(kvBytesPerToken(MODELS['70B'])).toBe(327680);
      expect(memoryUse('8B', 16, 4096).fits).toBe(true);
      expect(r(paramCount(M8) / 1e9, 2)).toBe(8.03);
    });

    it('quotes the training numbers', () => {
      const train = trainFlopsPerToken('8B', 4096);
      const fwd = 2 * matmulParams(M8) + 4 * M8.layers * 4096 * M8.d;
      expect(r(train / 1e9, 1)).toBe(48.2);
      expect(r(fwd / 1e9, 1)).toBe(17.2);
      expect(r((train * 1e12) / (GPU.bf16Tflops * 1e12) / 86400)).toBe(565);
      expect(16 * matmulParams(M8)).toBeGreaterThan(100e9);
    });

    it('walks the highlight in proportion to time', () => {
      const d = explore(0, 80);
      expect(d.pass.ops[activeOp(d.pass, 0.5)].id).toBe('up');
      expect(activeOp(d.pass, 0.9999)).toBe(d.pass.ops.length - 1);
    });
  });
}

// Lesson 3.2

{
  const c = configOf(SERVE_DEFAULTS);
  const r1 = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 3.2: one request on four A-class GPUs', () => {
    it('reads weights, barely computes, and exchanges results', () => {
      const one = runServe(SERVE_DEFAULTS);
      expect(r1(one.weightsGB)).toBe(35.3);
      expect(r1(memoryPlan(c).weightBytes / 1e9, 0)).toBe(141);
      expect(r1(one.point.tpot * 1e3)).toBe(15.1);
      expect(r1(one.weightReadS * 1e3)).toBe(13.2);
      expect(r1(one.point.step.computeS * 1e3, 2)).toBe(0.05);
      expect(r1(one.point.step.commS * 1e3)).toBe(1.9);
      expect(Math.round(1 / one.point.tpot)).toBe(66);
      expect(r1(one.point.ttft * 1e3)).toBe(76.5);
      expect(r1(one.prefill * 1e3)).toBe(61.3);
    });

    it('batches 64 requests for 18% slower tokens', () => {
      const one = servingPoint(c, 1, 1000, 300);
      const b64 = servingPoint(c, 64, 1000, 300);
      expect(r1(b64.tpot * 1e3)).toBe(17.9);
      expect(Math.round(b64.tokensPerS)).toBe(2066);
      expect(Math.round(b64.tokensPerS / one.tokensPerS)).toBe(32);
      expect(Math.round((b64.tpot / one.tpot - 1) * 100)).toBe(18);
    });
  });

  describe('lesson 3.2: memory', () => {
    it('fills at 344 conversations', () => {
      const mb = maxBatch(c, 1300);
      expect(mb).toBe(344);
      expect(kvBytesPerToken(MODELS['70B'])).toBe(327_680);
      expect(Math.round((1300 * 327_680) / 1e6)).toBe(426);
      expect(Math.round(memoryPlan(c).kvBytes / 1e9)).toBe(147);
      const full = runServe({ ...SERVE_DEFAULTS, batchExp: Math.log2(mb) });
      expect(full.batch).toBe(344);
      expect(r1(full.cacheReadS * 1e3)).toBe(12.1);
      expect(r1(full.weightReadS * 1e3)).toBe(13.2);
      expect(r1(full.point.step.computeS * 1e3)).toBe(17.6);
      expect(r1(full.point.tpot * 1e3)).toBe(30.2);
      expect(Math.round(full.point.tokensPerS)).toBe(3423);
      expect(Math.round(full.point.tokensPerS / servingPoint(c, 1, 1000, 300).tokensPerS)).toBe(52);
      expect(Math.round(full.point.utilization * 100)).toBe(41);
      expect(full.point.step.bound).toBe('memory');
    });

    it('caps two A-class GPUs at 6 conversations and FP8 at 510', () => {
      const two = configOf({ ...SERVE_DEFAULTS, tp: 2 });
      expect(r1(memoryPlan(two).kvBytes / 1e9)).toBe(2.9);
      expect(maxBatch(two, 1300)).toBe(6);
      expect(maxBatch(configOf({ ...SERVE_DEFAULTS, precision: 'fp8' }), 1300)).toBe(510);
    });

    it('runs the 400B model in BF16 only on eight B-class GPUs', () => {
      expect(Math.round(memoryPlan({ model: '400B', gpu: 'B', tp: 8, precision: 'bf16' }).weightBytes / 1e9)).toBe(812);
      expect(bf16FrontierSolved({ ...SERVE_DEFAULTS, model: '400B', gpu: 'B', tp: 8 })).toBe(true);
      expect(bf16FrontierSolved({ ...SERVE_DEFAULTS, model: '400B', gpu: 'B', tp: 4 })).toBe(false);
      expect(bf16FrontierSolved({ ...SERVE_DEFAULTS, model: '400B', gpu: 'A', tp: 8 })).toBe(false);
      expect(bf16FrontierSolved({ ...SERVE_DEFAULTS, model: '400B', gpu: 'A', tp: 8, precision: 'fp8' })).toBe(false);
      expect(bf16FrontierSolved(SERVE_DEFAULTS)).toBe(false);
      expect(Math.round(memoryPlan({ model: '400B', gpu: 'B', tp: 8, precision: 'bf16' }).usableBytes / 1e9)).toBe(1382);
      expect(maxBatch({ model: '400B', gpu: 'A', tp: 8, precision: 'fp8' }, 1300)).toBe(253);
    });
  });

  describe('lesson 3.2: cost per token', () => {
    it('falls 52-fold from one request to a full batch', () => {
      expect(r1(servingPoint(c, 1, 1000, 300).gpuHoursPerMTokens)).toBe(17);
      expect(servingPoint(c, 344, 1000, 300).gpuHoursPerMTokens).toBeCloseTo(0.325, 3);
    });

    it('is cheapest on four GPUs with memory full', () => {
      const best = cheapestA40();
      expect(best.tp).toBe(4);
      expect(best.batch).toBe(344);
      expect(best.gpuHoursPerM).toBeCloseTo(0.325, 3);
      expect(cheapestSolved({ ...SERVE_DEFAULTS, batchExp: 8.5 })).toBe(true);
      expect(cheapestSolved({ ...SERVE_DEFAULTS, batchExp: BATCH_EXP_MAX })).toBe(true);
      expect(cheapestSolved(SERVE_DEFAULTS)).toBe(false);
      expect(cheapestSolved({ ...SERVE_DEFAULTS, batchExp: 8.25 })).toBe(false);
      expect(cheapestSolved({ ...SERVE_DEFAULTS, tp: 8, batchExp: BATCH_EXP_MAX })).toBe(false);
      expect(cheapestSolved({ ...SERVE_DEFAULTS, precision: 'fp8', batchExp: BATCH_EXP_MAX })).toBe(false);
      // The slider can reach the answer.
      expect(requestedBatch(8.5)).toBeGreaterThanOrEqual(344);
      expect(BATCH_EXP_STEP).toBe(0.25);
    });

    it('quotes the other splits and the B-class', () => {
      const two = configOf({ ...SERVE_DEFAULTS, tp: 2 });
      expect(r1(servingPoint(two, 6, 1000, 300).gpuHoursPerMTokens, 2)).toBe(2.74);
      const eight = configOf({ ...SERVE_DEFAULTS, tp: 8 });
      expect(r1(servingPoint(eight, 1, 1000, 300).step.commS * 1e3)).toBe(4.5);
      const b8 = largestWithin(eight, TPOT_LIMIT, 1000, 300);
      expect(b8).toBe(991);
      expect(servingPoint(eight, b8, 1000, 300).gpuHoursPerMTokens).toBeCloseTo(0.386, 3);
      const bTwo = configOf({ ...SERVE_DEFAULTS, gpu: 'B', tp: 2 });
      expect(maxBatch(bTwo, 1300)).toBe(480);
      expect(servingPoint(bTwo, 480, 1000, 300).tpot).toBeLessThan(TPOT_LIMIT);
      expect(servingPoint(bTwo, 480, 1000, 300).gpuHoursPerMTokens).toBeCloseTo(0.121, 3);
    });
  });

  describe('lesson 3.2: latency limits', () => {
    it('shrinks the batch as the limit tightens', () => {
      const at20 = largestWithin(c, 0.02, 1000, 300);
      expect(at20).toBe(112);
      const p20 = servingPoint(c, at20, 1000, 300);
      expect(p20.gpuHoursPerMTokens).toBeCloseTo(0.426, 3);
      expect(Math.round((p20.gpuHoursPerMTokens / servingPoint(c, 344, 1000, 300).gpuHoursPerMTokens - 1) * 100)).toBe(31);
      expect(Math.round(p20.tokensPerGpuS)).toBe(653);
      expect(largestWithin(c, 0.016, 1000, 300)).toBe(20);
      expect(largestWithin(c, 0.015, 1000, 300)).toBe(0);
      expect(largestWithin(c, 0.04, 1000, 300)).toBe(344);
    });
  });
}

// Lesson 3.3

{
  describe('lesson 3.3 training', () => {
    it('quotes the cost of the 70B run', () => {
      expect(Math.round(NUMBERS.flopsPerToken / 1e9)).toBe(433);
      expect(NUMBERS.totalFlops / 1e23).toBeCloseTo(8.66, 2);
      expect(NUMBERS.oneGpuYears).toBeCloseTo(27.8, 1);
      expect(NUMBERS.stateTB).toBeCloseTo(1.1, 1);
      expect(TRAIN_COMPUTE_EFFICIENCY).toBe(0.62);
    });

    it('quotes the starting split', () => {
      const b = NUMBERS.base;
      expect(b.memoryGB).toBeCloseTo(20.9, 1);
      expect(b.stepS).toBeCloseTo(3.53, 2);
      expect(b.computeS).toBeCloseTo(2.89, 2);
      expect(b.bubbleS).toBeCloseTo(0.27, 2);
      expect(b.tpCommS).toBeCloseTo(0.37, 2);
      expect(b.dpCommS).toBe(0);
      expect(b.mfu).toBeCloseTo(0.508, 3);
      expect(b.days).toBeCloseTo(19.5, 1);
      expect(Math.round(b.gpuHours / 1000)).toBe(479);
      expect(b.microbatches).toBe(32);
      expect(b.dp).toBe(32);
    });

    it('quotes the other splits and accelerators', () => {
      expect(NUMBERS.tp16.mfu).toBeCloseTo(0.178, 3);
      expect(NUMBERS.tp16.days).toBeCloseTo(55.7, 1);
      expect(Math.round(NUMBERS.flat.memoryGB)).toBe(370);
      expect(NUMBERS.flat.fits).toBe(false);
      expect(NUMBERS.bClass.days).toBeCloseTo(8.8, 1);
      expect(NUMBERS.lClass.days).toBeCloseTo(74.1, 1);
      expect(NUMBERS.lClass.tpCommS).toBeCloseTo(4.79, 2);
    });

    it('has one fastest split that fits, and the default is not it', () => {
      expect(fastestSplit()).toMatchObject({ tp: 8, pp: 1 });
      expect(NUMBERS.fastest.days).toBeCloseTo(18.0, 1);
      expect(NUMBERS.tp4pp1.days).toBeCloseTo(16.8, 1);
      expect(NUMBERS.tp4pp1.memoryGB).toBeCloseTo(93.1, 1);
      expect(NUMBERS.tp4pp1.fits).toBe(false);
      expect(fastestSolved(TRAIN_DEFAULTS)).toBe(false);
      expect(fastestSolved({ ...TRAIN_DEFAULTS, tp: '8', pp: '1' })).toBe(true);
      expect(fastestSolved({ ...TRAIN_DEFAULTS, tp: '4', pp: '1' })).toBe(false);
      expect(fastestSolved({ ...TRAIN_DEFAULTS, tp: '8', pp: '1', lg: 11 })).toBe(false);
      expect(fastestSolved({ ...TRAIN_DEFAULTS, tp: '8', pp: '1', gpu: 'B' })).toBe(false);
    });

    it('quotes the scaling sweep', () => {
      expect(NUMBERS.s32.days).toBeCloseTo(577.8, 1);
      expect(NUMBERS.s32.mfu).toBeCloseTo(0.548, 3);
      expect(NUMBERS.s2048.days).toBeCloseTo(10.5, 1);
      expect(NUMBERS.s2048.mfu).toBeCloseTo(0.471, 3);
      expect(NUMBERS.base.days / 2).toBeCloseTo(9.75, 2);
      expect(NUMBERS.s8192.microbatches).toBe(4);
      expect(NUMBERS.s8192.mfu).toBeCloseTo(0.33, 3);
      expect(NUMBERS.s32768.mfu).toBeCloseTo(0.109, 3);
      expect(NUMBERS.s32768.days).toBeCloseTo(2.84, 2);
      expect((NUMBERS.s32768.gpuHours / 1e6).toFixed(2)).toBe("2.23");
      expect(NUMBERS.p4096.days).toBeCloseTo(6.25, 2);
      expect(NUMBERS.p4096.mfu).toBeCloseTo(0.396, 3);
      expect(NUMBERS.s4096.days).toBeCloseTo(6.0, 1);
      expect(NUMBERS.s4096.mfu).toBeCloseTo(0.413, 3);
      expect(NUMBERS.p4096.dpCommS).toBeGreaterThan(0.3);
    });

    it('has one way to train in under a week within the budget', () => {
      const answers: string[] = [];
      for (const s of SCALE_SPLITS)
        for (let lg = 5; lg <= 15; lg++) {
          if (weekSolved({ split: s.id, lg })) answers.push(`${s.id}@${2 ** lg}`);
          const r = scaleRun(s.id, lg);
          if (r.valid && r.fits && r.days < WEEK_DAYS && r.gpuHours <= BUDGET_GPU_HOURS) expect(answers).toContain(`${s.id}@${2 ** lg}`);
        }
      expect(answers).toEqual(['8x4@4096']);
      expect(weekSolved(SCALE_DEFAULTS)).toBe(false);
      expect(Math.round(NUMBERS.s8192.gpuHours / 1000)).toBe(737);
      expect(NUMBERS.s4096.gpuHours).toBeLessThan(BUDGET_GPU_HOURS);
    });

    it('handles impossible splits without throwing', () => {
      expect(runOf('70B', 'A', 64, 16, 16).valid).toBe(false);
      expect(runOf('8B', 'L', 4096, 1, 1).valid).toBe(false);
    });
  });
}

// Lesson 3.4

{
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r2 = (x: number) => Math.round(x * 100) / 100;

  describe('lesson 3.4: the server', () => {
    it('matches Lesson 3.2’s steady figures', () => {
      expect(CAP_AVERAGE).toBe(344);
      expect(CAP_MAX).toBe(309);
      const alone = servingPoint(SERVE, 1, INPUT, OUTPUT);
      expect(Math.round(alone.tokensPerS)).toBe(65);
      expect(r1(alone.tpot * 1e3)).toBe(15.1);
      const full = servingPoint(SERVE, CAP_AVERAGE, INPUT, OUTPUT);
      expect(Math.round(full.tokensPerS)).toBe(3423);
      expect(r1(full.tpot * 1e3)).toBe(30.2);
      expect(PREFILL_S).toBe(prefillS(SERVE, INPUT));
      expect(Math.round(PREFILL_S * 1e3)).toBe(61);
      expect(Math.round(8 * PREFILL_S * 1e3)).toBe(491);
    });
  });

  describe('lesson 3.4: the runs the prose quotes', () => {
    it('starts comfortably', () => {
      const s = runLab(L3_4_LAB_DEFAULTS.rate, L3_4_LAB_DEFAULTS.cap);
      expect(s.overloaded).toBe(false);
      expect(Math.round(s.meanBatch)).toBe(27);
      expect(r2(s.ttftP95)).toBe(0.17);
      expect(r1(s.tpot * 1e3)).toBe(21.8);
      expect(Math.round(s.throughput)).toBe(1226);
      expect(meetsLimits(s)).toBe(true);
    });

    it('jams at 8 a second with 64, drains with 256 but slows the tokens', () => {
      const jam = runLab(8, 64);
      expect(jam.overloaded).toBe(true);
      expect(r1(jam.throughput / OUTPUT)).toBe(6.7);
      expect(Math.round(jam.ttftP95)).toBe(20);
      const open = runLab(8, 256);
      expect(open.overloaded).toBe(false);
      expect(Math.round(open.meanBatch)).toBe(95);
      expect(r2(open.ttftP95)).toBe(0.31);
      expect(Math.round(open.tpot * 1e3)).toBe(41);
      const steady = servingPoint(SERVE, Math.round(open.meanBatch), INPUT, OUTPUT);
      expect(r1(steady.tpot * 1e3)).toBe(19.3);
      expect(open.tpot / steady.tpot).toBeGreaterThan(1.9);
      expect(open.tpot / steady.tpot).toBeLessThan(2.3);
      // Little's law: 8 a second × 300 tokens × 41 ms ≈ the average batch.
      const little = 8 * OUTPUT * open.tpot;
      expect(Math.round(OUTPUT * open.tpot * 10) / 10).toBe(12.2);
      expect(Math.round(little)).toBe(97);
    });
  });

  describe('lesson 3.4: the challenge', () => {
    it('has its best rate at 9 a second, with max batch 150–156 only', () => {
      const ok: number[] = [];
      for (let c = 1; c <= CAP_MAX; c++) if (meetsLimits(runLab(BEST_RATE, c))) ok.push(c);
      expect(ok[0]).toBe(BEST_CAPS[0]);
      expect(ok[ok.length - 1]).toBe(BEST_CAPS[1]);
      expect(ok.length).toBe(BEST_CAPS[1] - BEST_CAPS[0] + 1);
      for (let c = 1; c <= CAP_MAX; c++) expect(meetsLimits(runLab(BEST_RATE + RATE_STEP, c))).toBe(false);
      for (let c = 8; c <= CAP_MAX; c += 8) expect(meetsLimits(runLab(BEST_RATE + 2 * RATE_STEP, c))).toBe(false);
      expect(runLab(BEST_RATE, 128).overloaded).toBe(true);
      expect(Math.round(runLab(BEST_RATE, 256).tpot * 1e3)).toBe(51);
    }, 30000);

    it('is solved at the best rate or one step below, and not at the start', () => {
      expect(rateSolved(L3_4_LAB_DEFAULTS.rate, L3_4_LAB_DEFAULTS.cap)).toBe(false);
      expect(rateSolved(9, 152)).toBe(true);
      expect(rateSolved(8.5, 200)).toBe(true);
      expect(rateSolved(8, 200)).toBe(false);
      expect(rateSolved(9, 256)).toBe(false);
      const best = runLab(9, 152);
      expect(Math.round(best.throughput)).toBe(2647);
      expect(Math.round(best.utilization * 100)).toBe(43);
    });
  });

  describe('lesson 3.4: the knee', () => {
    it('tops out at different throughputs for each max batch', () => {
      const caps = CURVE_CAPS.map((c) => Math.max(...CURVE_RATES.map((q) => runLab(q, c).throughput)));
      expect(caps.map((x) => Math.round(x))).toEqual([841, 2042, 3058]);
      const flat = runLab(RATE_MAX, CAP_MAX);
      expect(flat.overloaded).toBe(true);
      expect(Math.round(flat.throughput)).toBe(3121);
      expect(Math.round(flat.utilization * 100)).toBe(53);
    });

    it('costs more GPU-hours per million tokens to keep the promises', () => {
      const gh = (t: number) => r2((SERVE.tp * 1e6) / (t * 3600));
      expect(gh(runLab(9, 152).throughput)).toBe(0.42);
      expect(gh(runLab(RATE_MAX, CAP_MAX).throughput)).toBe(0.36);
      expect(gh(servingPoint(SERVE, CAP_AVERAGE, INPUT, OUTPUT).tokensPerS)).toBe(0.32);
    });
  });
}

// Lesson 3.5

{
  describe('lesson 3.5', () => {
    it('has exactly one solution to the fleet challenge', () => {
      expect(fleetSolved(ALL_ON_A)).toBe(false);
      expect(fleetSolved({ chat70: 'B', code8: 'A', batch8: 'L', frontier400: 'B', train70: 'A', tune8: 'A' })).toBe(true);
      expect(fleetSolved({ chat70: 'B', code8: 'A', batch8: 'A', frontier400: 'B', train70: 'A', tune8: 'L' })).toBe(false);
      expect(FLEET).toEqual({ L: 64, A: 336, B: 24 });
    });

    it('matches the engine’s choices in the split table', () => {
      const chat = WORKLOADS.chat70 as ServingWorkload;
      for (const g of ['L', 'A', 'B'] as const) {
        const f = workloadFit('chat70', g);
        if (f.kind !== 'serve' || !f.feasible) throw new Error('chat70 should run everywhere');
        const row = splitRows(chat, g).find((r) => r.tp === f.tp)!;
        expect(row.batch).toBe(f.batch);
        expect(row.gpus).toBe(f.gpus);
        expect(largestBatch(chat, g, f.tp)).toBe(f.batch);
      }
      const rows = splitRows(chat, 'L');
      expect(rows.map((r) => r.fits)).toEqual([false, false, true, true]);
      expect(rows[2].batch).toBe(0);
    });

    it('quotes the right numbers', () => {
      const n = L3_5_LESSON_NUMBERS;
      expect(n.allOnA).toBe(411);
      expect(n.allOnAOver).toBe(75);
      expect(Math.round(100 / n.bGainMax)).toBe(33);
      expect(Math.round(100 / n.bGainMin)).toBe(50);
      expect(n.lLossMin).toBeCloseTo(2.8, 1);
      expect(Math.round(n.lLossMax)).toBe(24);
      expect(n.chatL4OneTpot * 1000).toBeCloseTo(56.3, 1);
      expect(n.chatL8OneTpot * 1000).toBeCloseTo(37.0, 1);
      expect(n.chatL8Comm * 1000).toBeCloseTo(11.3, 1);
      expect(n.chatL8Batch).toBe(14);
      expect(n.frontierWeights / 1e9).toBeCloseTo(405.8, 1);
      expect(n.frontierUsableL / 1e9).toBeCloseTo(345.6, 1);
      expect(n.aAfterTrain).toBe(32);
      expect(n.othersOnA).toBe(107);
      expect(gpusFor('chat70', 'L')).toBe(864);
      expect(gpusFor('chat70', 'A')).toBe(36);
      expect(gpusFor('train70', 'L')).toBe(1088);
      expect(ratio('train70', 'L', 'A')).toBeCloseTo(3.6, 1);
      expect(ratio('frontier400', 'A', 'B')).toBe(3);
      expect(ratio('chat70', 'A', 'B')).toBeCloseTo(2.57, 2);
      expect(ratio('batch8', 'A', 'B')).toBeCloseTo(2.57, 2);
      expect(ratio('batch8', 'L', 'A')).toBeCloseTo(3.6, 1);
      expect(ratio('tune8', 'L', 'A')).toBeCloseTo(2.8, 1);
      expect(Math.round(linkShare('frontier400', 'A') * 100)).toBe(36);
      const code = workloadFit('code8', 'A');
      if (code.kind !== 'serve') throw new Error();
      expect([code.batch, code.point!.maxBatch]).toEqual([90, 207]);
      const b = (g: 'L' | 'A' | 'B') => (workloadFit('batch8', g) as { batch: number }).batch;
      expect([b('L'), b('A'), b('B')]).toEqual([62, 129, 362]);
    });

    it('names the binding requirement', () => {
      expect(binding('frontier400', 'L')).toBe('too big');
      expect(binding('chat70', 'L')).toBe('latency');
      expect(binding('code8', 'A')).toBe('latency');
      expect(binding('batch8', 'A')).toBe('memory');
      expect(binding('chat70', 'A')).toBe('memory');
      expect(binding('train70', 'B')).toBe('deadline');
    });
  });
}

// Chapter 4 engines
{
  describe('racks', () => {
    it('fills a rack until space, power or cooling runs out', () => {
      const a = rackConfig({ gpu: 'A', cooling: 'air', servers: 5, feedKW: 40 });
      expect(a.maxServers).toBe(4);
      expect(a.violations).toContain('cooling');
      const b = rackConfig({ gpu: 'B', cooling: 'liquid', servers: 10, feedKW: 140 });
      expect(b.violations).toEqual([]);
      expect(b.binding).toBe('space');
      expect(b.rackKW).toBeCloseTo(113.9, 1);
      expect(clusterLayout('A', 'air', 40, 1024).racks).toBe(32);
      expect(clusterLayout('B', 'liquid', 140, 1024).racks).toBe(13);
    });
  });

  describe('facility power', () => {
    it('loses about 5% between grid and racks, and more inside the servers', () => {
      const c = powerChain(POWER_DEFAULTS);
      expect(c.electricalPue).toBeCloseTo(1.0492, 3);
      expect(c.chipMW).toBeCloseTo(16.92, 2);
      expect(powerChain({ ...POWER_DEFAULTS, upsMode: 'eco' }).electricalPue).toBeLessThan(1.02);
      expect(upsPlan(20, 2.5, '2N')).toEqual({ modules: 16, installedMW: 40, loadFraction: 0.5 });
      expect(upsEfficiency(0.1, 'double conversion')).toBeLessThan(upsEfficiency(0.5, 'double conversion'));
    });
  });

  describe('cooling', () => {
    it('carries heat far more compactly in water than in air', () => {
      expect(airflowM3s(40, 15)).toBeCloseTo(2.21, 2);
      expect(waterFlowLs(40, 10)).toBeCloseTo(0.956, 3);
    });

    it('throttles hot chips and makes PUE depend on climate', () => {
      expect(chipCooling('B', 30, 'air').throttled).toBe(false);
      expect(chipCooling('B', 35, 'air').speed).toBeCloseTo(0.954, 3);
      expect(chipCooling('B', 35, 'liquid').throttled).toBe(false);
      expect(annualPue(SITES.bayport, { cooling: 'air', supplyC: 24 }).pue).toBeCloseTo(1.305, 3);
      expect(annualPue(SITES.techpark, { cooling: 'air', supplyC: 24 }).pue).toBeCloseTo(1.271, 3);
      expect(annualPue(SITES.northfield, { cooling: 'liquid', supplyC: 35 }).pue).toBeCloseTo(1.113, 3);
      expect(outdoorTempC(SITES.techpark, 205 * 24 + 15)).toBeCloseTo(29, 2);
    });
  });

  describe('data-center network', () => {
    it('trades cost for bandwidth with oversubscription', () => {
      const full = fabric({ gpus: 1024, downPorts: 32 });
      const over = fabric({ gpus: 1024, downPorts: 48 });
      expect(full.crossShare).toBe(1);
      expect(over.oversubscription).toBe(3);
      expect(Math.round(full.costPerGpu)).toBe(4175);
      expect(Math.round(over.costPerGpu)).toBe(2475);
      expect(jobNetworkShare(over, 32, 'packed', 0.5)).toBe(1);
      expect(jobNetworkShare(over, 1024, 'scattered', 0.5)).toBeCloseTo(1 / 6, 6);
    });

    it('slows training only once the gradient exchange can no longer hide', () => {
      const base = { model: '70B', gpu: 'A', gpus: 1024, tp: 8, pp: 1, batchTokens: 4 * 1024 * 1024, seqLen: 4096, tokens: 2e12 } as const;
      expect(trainingRun({ ...base, networkShare: 0.5 }).days).toBeCloseTo(trainingRun(base).days, 6);
      expect(trainingRun({ ...base, networkShare: 1 / 3 }).days).toBeCloseTo(20.9, 1);
    });
  });

  describe('facility economics', () => {
    it('prices a GPU-hour mostly by its capital', () => {
      expect(capitalRecovery(0.1, 5)).toBeCloseTo(0.2638, 4);
      const tp = SITES.techpark;
      const c = gpuHourCost({ gpu: 'A', cooling: 'air', site: tp, pue: 1.271, utilization: 0.7, serverLifeYears: 5, facilityLifeYears: 15, rate: 0.1 });
      expect(c.perHour).toBeCloseTo(1.55, 2);
      expect(c.perUsedHour).toBeCloseTo(2.22, 2);
      expect(c.powerShare).toBeLessThan(0.05);
      expect(breakEvenUtilization({ gpu: 'A', cooling: 'air', site: tp, pue: 1.271, serverLifeYears: 5, facilityLifeYears: 15, rate: 0.1 }, 2.4)).toBeCloseTo(0.645, 2);
    });
  });
}

// Lesson 4.1
{
  describe('lesson 4.1: rack builder', () => {
    it('breaks every server’s power into parts that add up', () => {
      for (const g of GPU_IDS)
        for (const c of ['air', 'liquid'] as const) {
          const sum = serverBreakdown(g, c).reduce((s, p) => s + p.kw, 0);
          expect(sum).toBeCloseTo(serverPowerW(g, c) / 1000, 9);
        }
    });

    it('clamps the servers to the space and names tied limits', () => {
      expect(spaceLimit('A', 'air')).toBe(5);
      expect(spaceLimit('B', 'liquid')).toBe(10);
      expect(rackState({ gpu: 'B', cooling: 'air', feed: 40, servers: 12 }).servers).toBe(4);
      expect(bindingLimits({ gpu: 'A', cooling: 'air', feed: 40 })).toEqual(['power feed', 'cooling']);
      expect(nextBlockers({ gpu: 'A', cooling: 'air', feed: 40, servers: 4 })).toEqual(['power feed', 'cooling']);
    });

    it('solves challenge a only with liquid cooling and a big feed', () => {
      expect(rackSolved(RACK_DEFAULTS)).toBe(false);
      expect(rackSolved({ gpu: 'B', cooling: 'liquid', feed: 100, servers: 8 })).toBe(true);
      expect(rackSolved({ gpu: 'B', cooling: 'liquid', feed: 140, servers: 10 })).toBe(true);
      expect(rackSolved({ gpu: 'B', cooling: 'liquid', feed: 60, servers: 8 })).toBe(false);
      expect(rackSolved({ gpu: 'B', cooling: 'air', feed: 140, servers: 4 })).toBe(false);
      expect(rackSolved({ gpu: 'B', cooling: 'liquid', feed: 140, servers: 7 })).toBe(false);
      expect(rackConfig({ gpu: 'B', cooling: 'liquid', servers: 8, feedKW: 100 }).rackKW).toBeCloseTo(91.3, 1);
    });

    it('solves challenge b only with liquid cooling on a 60 kW feed or more', () => {
      expect(hallSolved(HALL_DEFAULTS)).toBe(false);
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 60, gpus: 1024 })).toBe(true);
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 100, gpus: 1024 })).toBe(true);
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 40, gpus: 1024 })).toBe(false);
      for (const feed of [40, 60, 100, 140]) expect(hallSolved({ gpu: 'A', cooling: 'air', feed, gpus: 1024 })).toBe(false);
      expect(hallSolved({ gpu: 'B', cooling: 'liquid', feed: 140, gpus: 1024 })).toBe(false);
    });

    it('quotes the engine’s numbers', () => {
      const N = L4_1_NUMBERS;
      expect(N.aAirKW).toBeCloseTo(9.3, 2);
      expect(N.aGpusKW).toBe(5.6);
      expect(Math.round(N.aGpuShare * 100)).toBe(60);
      expect([N.fullAir.gpus, N.fullAir.unitsUsed]).toEqual([32, 34]);
      expect(N.fullAir.rackKW).toBeCloseTo(38.2, 1);
      expect(N.fifthAir.rackKW).toBeCloseTo(47.5, 1);
      expect(N.oldHall.maxServers).toBe(1);
      expect(N.oldHall.gpus).toBe(8);
      expect(Math.round(N.homes)).toBe(32);
      expect(N.aNet).toBeCloseTo(0.9, 2);
      expect(N.aPsuLoss).toBeCloseTo(0.56, 2);
      expect(N.aFansAir).toBeCloseTo(1.14, 2);
      expect(N.aFansLiquid).toBeCloseTo(0.23, 2);
      expect(N.aLiquidKW).toBeCloseTo(8.33, 2);
      expect([serverUnits('A', 'air'), serverUnits('A', 'liquid'), serverUnits('B', 'air')]).toEqual([8, 4, 10]);
      expect([N.aLiquid100.servers, N.aLiquid100.gpus, N.aLiquid100.binding]).toEqual([10, 80, 'space']);
      expect(N.aLiquid100.rackKW).toBeCloseTo(84.3, 1);
      expect(serverPowerW('B', 'air') / 1000).toBeCloseTo(12.6, 1);
      expect([N.bAir40.servers, N.bAir40.gpus]).toEqual([3, 24]);
      expect(rackLimits('L', 'air', 40)['power feed']).toBe(8);
      expect(rackLimits('L', 'air', 40).cooling).toBe(8);
      expect([N.bLiquid140.servers, N.bLiquid140.gpus]).toEqual([10, 80]);
      expect(N.bLiquid140.rackKW).toBeCloseTo(113.9, 1);
      expect([N.hallAirA.racks, N.hallAirA.floorM2]).toEqual([32, 96]);
      expect(N.hallAirA.itMW).toBeCloseTo(1.22, 2);
      expect(N.hallAirA.densityKWm2).toBeCloseTo(12.7, 1);
      expect([N.hallLiquidA.racks, N.hallLiquidA.floorM2]).toEqual([13, 39]);
      expect(N.hallLiquidA.itMW).toBeCloseTo(1.08, 2);
      expect(N.hallLiquidA.densityKWm2).toBeCloseTo(27.7, 1);
      expect(N.hallLiquidB.densityKWm2).toBeCloseTo(37.4, 1);
      expect(N.hallLiquidA60.racks).toBe(19);
      expect(clusterLayout('A', 'liquid', 60, 1024).gpusPerRack).toBe(56);
    });
  });
}

// Lesson 4.2
{
  describe('lesson 4.2 challenges', () => {
    it('cuts losses before the racks only with eco mode and a spare', () => {
      expect(lossSolved(CHAIN_DEFAULTS)).toBe(false);
      expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco' })).toBe(true);
      expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco', redundancy: '2N' })).toBe(true);
      expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco', redundancy: 'N' })).toBe(false);
      expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco', itMW: 19.5 })).toBe(false);
      for (const redundancy of ['N', 'N+1', '2N'] as const) for (let psu = 90; psu <= 97; psu += 0.5) expect(lossSolved({ ...CHAIN_DEFAULTS, redundancy, psu })).toBe(false);
    });

    it('finds the largest IT load Bayport can connect', () => {
      expect(gridSolved(SITE_DEFAULTS)).toBe(false);
      expect(gridSolved({ site: 'bayport', itMW: 14.5, redundancy: 'N+1' })).toBe(true);
      expect(gridSolved({ site: 'bayport', itMW: 14, redundancy: 'N+1' })).toBe(false);
      expect(gridSolved({ site: 'bayport', itMW: 15, redundancy: 'N+1' })).toBe(false);
      expect(gridSolved({ site: 'bayport', itMW: 14.5, redundancy: '2N' })).toBe(false);
      expect(siteRun({ site: 'bayport', itMW: 15, redundancy: 'N+1' }).over).toBe(true);
    });
  });

  describe('lesson 4.2 numbers', () => {
    const n = L4_2_LESSON_NUMBERS;
    it('quotes the 20 MW hall', () => {
      expect(n.hallGpus).toBe(16752);
      expect(n.hallRacks).toBe(524);
      expect(clusterLayout('A', 'air', 40, n.hallGpus).itMW).toBeLessThanOrEqual(20);
      expect(n.rackKW).toBeCloseTo(38.2, 1);
      expect(n.grid).toBeCloseTo(20.98, 2);
      expect(n.facilityLoss).toBeCloseTo(0.98, 2);
      expect(n.upsLoss).toBeCloseTo(0.81, 2);
      expect(n.chip).toBeCloseTo(16.92, 2);
      expect(n.chip / n.grid).toBeCloseTo(0.81, 2);
      expect(n.psu97Chip).toBeCloseTo(17.46, 2);
      expect(n.psu97Chip - n.chip).toBeCloseTo(0.54, 2);
      expect(chainOf({ ...CHAIN_DEFAULTS, psu: 97 }).electricalPue).toBeCloseTo(chainOf(CHAIN_DEFAULTS).electricalPue, 12);
      expect(chainOf(CHAIN_DEFAULTS).electricalPue).toBeCloseTo(1.049, 3);
      expect(roundTo(n.facilityLoss * 8760 * 55, 1000)).toBe(474000);
      expect(roundTo((n.facilityLoss - n.ecoLoss) * 8760 * 55, 1000)).toBe(293000);
      expect(n.ecoLoss).toBeCloseTo(0.38, 2);
      expect(n.twoNLoss).toBeCloseTo(1.07, 2);
      expect(700 / 0.8).toBe(875);
    });

    it('quotes redundancy and part-load efficiency', () => {
      expect(chainOf({ ...CHAIN_DEFAULTS, redundancy: 'N' }).ups.modules).toBe(8);
      expect(chainOf(CHAIN_DEFAULTS).ups.modules).toBe(9);
      expect(Math.round(chainOf(CHAIN_DEFAULTS).ups.loadFraction * 100)).toBe(89);
      expect(chainOf({ ...CHAIN_DEFAULTS, redundancy: '2N' }).ups).toEqual({ modules: 16, installedMW: 40, loadFraction: 0.5 });
      expect(upsEfficiency(1, 'double conversion') * 100).toBeCloseTo(96.2, 1);
      expect(upsEfficiency(0.5, 'double conversion') * 100).toBeCloseTo(95.7, 1);
      expect(upsEfficiency(0.25, 'double conversion') * 100).toBeCloseTo(94.1, 1);
      expect(upsEfficiency(0.1, 'double conversion') * 100).toBeCloseTo(89.2, 1);
      expect(chainOf(CHAIN_DEFAULTS).stages[1].efficiency * 100).toBeCloseTo(96.1, 1);
    });

    it('quotes the sites and their grid connections', () => {
      expect(PEAK_COOLING.techpark).toBeGreaterThan(0.3);
      expect(PEAK_COOLING.techpark).toBeLessThan(0.36);
      expect(n.tpPeak).toBeCloseTo(27.3, 1);
      expect(siteRun(SITE_DEFAULTS).coolingMW).toBeCloseTo(6.35, 2);
      expect(n.tpGenerators).toEqual({ units: 11, installedMW: 33 });
      expect(siteRun({ ...SITE_DEFAULTS, site: 'bayport' }).peakMW).toBeCloseTo(27.5, 1);
      expect(n.bayMax).toBe(14.5);
      expect(n.tpMax).toBe(43.5);
      expect(n.nfMax).toBe(153);
      expect(largestItFor('bayport', 'N+1')).toBe(14.5);
      expect(roundTo(n.bayGpus, 100)).toBe(12100);
      expect(roundTo(n.tpGpus, 100)).toBe(36400);
      expect(roundTo(n.nfGpus, 100)).toBe(128200);
    });

    it('counts GPUs that fit an IT load', () => {
      const g = gpusForIt(14.5);
      expect(clusterLayout('A', 'air', 40, g).itMW).toBeLessThanOrEqual(14.5);
      expect(clusterLayout('A', 'air', 40, g + 8).itMW).toBeGreaterThan(14.5);
    });
  });
}

// Lesson 4.3
{
  describe('lesson 4.3: the chip', () => {
    it('finds the warmest coolant for a full-speed B-class', () => {
      expect(warmestFullSpeed('B')).toEqual({ cooling: 'liquid', coolantC: 40 });
      expect(warmestSolved(CHIP_DEFAULTS)).toBe(false);
      expect(warmestSolved({ gpu: 'B', cooling: 'liquid', coolant: 40 })).toBe(true);
      expect(warmestSolved({ gpu: 'B', cooling: 'liquid', coolant: 39 })).toBe(false);
      expect(warmestSolved({ gpu: 'B', cooling: 'liquid', coolant: 41 })).toBe(false);
      expect(warmestSolved({ gpu: 'B', cooling: 'air', coolant: 30 })).toBe(false);
      expect(fullSpeed('B', 30, 'air')).toBe(true);
      expect(fullSpeed('B', 31, 'air')).toBe(false);
    });

    it('quotes true junction temperatures and throttling', () => {
      expect(junctionC(700, 24, 'air')).toBeCloseTo(66, 9);
      expect(junctionC(1000, 24, 'air')).toBeCloseTo(84, 9);
      const hot = chipCooling('B', 35, 'air');
      expect(Math.round(hot.chipW)).toBe(917);
      expect(Math.round(hot.speed * 100)).toBe(95);
      expect(chipCooling('B', 35, 'liquid').junctionC).toBeCloseTo(85, 9);
      expect(chipCooling('B', 35, 'liquid').throttled).toBe(false);
    });

    it('compares air and water flows', () => {
      expect(RACK_KW / 1.5).toBeCloseTo(26.7, 1);
      expect(airflowM3s(40, 15)).toBeCloseTo(2.21, 2);
      expect(waterFlowLs(40, 10)).toBeCloseTo(0.96, 2);
      expect(Math.round((airflowM3s(40, 15) * 1000) / waterFlowLs(40, 10) / 100) * 100).toBe(2300);
      expect(Math.cbrt(airflowM3s(40, 15))).toBeCloseTo(1.3, 2);
      expect(serverPowerW('A', 'air') / 1000).toBeCloseTo(9.3, 2);
      expect(serverPowerW('A', 'liquid') / 1000).toBeCloseTo(8.33, 2);
    });
  });

  describe('lesson 4.3: the building', () => {
    const air24 = { cooling: 'air', supplyC: 24 } as const;
    const liq = (t: number) => ({ cooling: 'liquid' as const, supplyC: t });

    it('quotes true PUEs', () => {
      const tp = sitePue('techpark', air24);
      expect(tp.pue).toBeCloseTo(1.271, 3);
      expect(Math.round((tp.pue - 1) * 1000)).toBe(271);
      expect(Math.round(tp.freeShare * 100)).toBe(10);
      expect(tp.peakPue).toBeCloseTo(1.37, 2);
      expect((tp.coolingPerKW * HALL_MW * 8760) / 1000).toBeCloseTo(37.2, 1);
      expect((tp.coolingPerKW * HALL_MW * 8760 * SITES.techpark.powerPrice) / 1e6).toBeCloseTo(2.0, 1);
      expect(tp.electricalPerKW * 100).toBeCloseTo(4.9, 1);
      expect(tp.miscPerKW).toBe(0.01);
      const tpl = sitePue('techpark', liq(35));
      expect(tpl.pue).toBeCloseTo(1.143, 3);
      expect(Math.round(tpl.freeShare * 100)).toBe(67);
      expect((tpl.coolingPerKW * HALL_MW * 8760) / 1000).toBeCloseTo(14.7, 1);
      expect(sitePue('bayport', air24).pue).toBeCloseTo(1.305, 3);
      expect(sitePue('bayport', air24).freeShare).toBe(0);
      expect(sitePue('northfield', air24).pue).toBeCloseTo(1.205, 3);
      expect(Math.round(sitePue('northfield', air24).freeShare * 100)).toBe(49);
      expect(sitePue('bayport', liq(35)).pue).toBeCloseTo(1.173, 3);
      expect(sitePue('northfield', liq(35)).pue).toBeCloseTo(1.113, 3);
      expect(sitePue('bayport', liq(40)).pue).toBeCloseTo(1.147, 3);
      expect(sitePue('bayport', liq(39)).pue).toBeCloseTo(1.151, 3);
      expect(sitePue('bayport', liq(45)).pue).toBeCloseTo(1.134, 3);
      expect(SITES.bayport.gridMW / sitePue('bayport', air24).peakPue).toBeCloseTo(14.5, 1);
      expect(SITES.bayport.gridMW / sitePue('bayport', liq(40)).peakPue).toBeCloseTo(16.2, 1);
    });

    it('solves the Bayport challenge only with 40 °C water', () => {
      expect(bayportSolved(BUILDING_DEFAULTS)).toBe(false);
      expect(bayportSolved({ ...BUILDING_DEFAULTS, site: 'bayport', cooling: 'liquid', waterC: 40 })).toBe(true);
      for (const w of [25, 30, 35, 39, 41, 45]) expect(bayportSolved({ ...BUILDING_DEFAULTS, site: 'bayport', cooling: 'liquid', waterC: w })).toBe(false);
      for (const a of [18, 24, 27]) expect(bayportSolved({ ...BUILDING_DEFAULTS, site: 'bayport', cooling: 'air', airC: a })).toBe(false);
      expect(bayportSolved({ ...BUILDING_DEFAULTS, site: 'techpark', cooling: 'liquid', waterC: 40 })).toBe(false);
    });

    it('keeps chillers between three and nine units of heat per unit of electricity at these sites', () => {
      let lo = Infinity;
      let hi = 0;
      for (const s of Object.values(SITES))
        for (let h = 0; h < 8760; h += 7) {
          const t = outdoorTempC(s, h);
          for (const water of [10, 19, 25, 45]) {
            const cop = chillerCop(water, t);
            lo = Math.min(lo, cop);
            hi = Math.max(hi, cop);
          }
        }
      expect(lo).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(hi).toBeLessThanOrEqual(9);
    });

    it('averages its daily series to the annual PUE', () => {
      const y = sitePue('techpark', air24);
      const d = dailyPue(SITES.techpark, air24, y.electricalPerKW, y.miscPerKW);
      expect(d.length).toBe(365);
      const mean = d.reduce((s, x) => s + x.pue, 0) / 365;
      expect(mean).toBeCloseTo(y.pue, 2);
    });
  });
}

// Lesson 4.4
{
  describe('lesson 4.4: the fabric', () => {
    const N = L4_4_LESSON_NUMBERS;
    it('prices a non-blocking fabric for 1,024 GPUs', () => {
      expect([N.f32.leaves, N.f32.spines, N.f32.switches, N.f32.optics]).toEqual([32, 16, 48, 2048]);
      expect(N.f32.costTotal).toBe(4_275_200);
      expect(Math.round(N.f32.costPerGpu)).toBe(4175);
      expect(SERVER_PER_GPU).toBe(35_000);
      expect(Math.round(N.serverShare * 100)).toBe(12);
      expect(N.f32.bisectionTbps).toBeCloseTo(204.8, 6);
      expect(maxTwoTierGpus(32)).toBe(2048);
    });

    it('makes a 3 : 1 fabric 41% cheaper and a third as wide', () => {
      expect([N.f48.leaves, N.f48.spines]).toEqual([22, 6]);
      expect(Math.round(N.f48.costPerGpu)).toBe(2475);
      expect(Math.round(N.cheaper48 * 100)).toBe(41);
      expect(N.f48.crossShare).toBeCloseTo(1 / 3, 9);
      expect(Math.round(400 / 3)).toBe(133);
      expect(N.f48.bisectionTbps).toBeCloseTo(70.4, 6);
      // About a third as many links between the tiers.
      expect(N.f48.optics / N.f32.optics).toBeCloseTo(0.344, 2);
    });

    it('lets a job under one leaf keep its whole card', () => {
      expect(N.tuneGpus).toBe(10);
      expect(N.tuneShare).toBe(1);
    });
  });

  describe('lesson 4.4: the training run', () => {
    const N = L4_4_LESSON_NUMBERS;
    it('hides the gradient exchange until the share falls below about 45%', () => {
      expect(BASE.days).toBeCloseTo(18.0, 1);
      expect(DP).toBe(128);
      expect(GRAD_BYTES / 1e9).toBeCloseTo(17.4, 1);
      expect(exchangeS(1)).toBeCloseTo(0.69, 2);
      expect(HIDE_WINDOW).toBeCloseTo(1.54, 2);
      expect(Math.round(HIDE_SHARE * 100)).toBe(45);
      expect(runAt(0.46).days).toBeCloseTo(BASE.days, 9);
      expect(runAt(0.44).days).toBeGreaterThan(BASE.days);
    });

    it('stretches the run at 3 : 1 on the 2,048-GPU cluster', () => {
      expect(CLUSTER_GPUS).toBe(2048);
      expect(N.exchange48).toBeCloseTo(2.07, 2);
      expect(N.run48.days).toBeCloseTo(20.9, 1);
      expect(Math.round((N.run48.days / N.base.days - 1) * 100)).toBe(16);
      expect(Math.round(N.saving48)).toBe(1750);
      expect(Math.round((N.saving48 / SERVER_PER_GPU) * 100)).toBe(5);
      expect(Math.round(N.extraGpuHours / 100) * 100).toBe(71_600);
    });

    it('suffers from scattered placement', () => {
      expect(N.scat32.days).toBeCloseTo(18.0, 1);
      expect(N.pack40.days).toBeCloseTo(18.0, 1);
      expect(N.scat40.days).toBeCloseTo(22.2, 1);
      expect(jobNetworkShare(clusterFabric(32), 1024, 'scattered', 0.5)).toBe(0.5);
    });
  });

  describe('lesson 4.4: the challenge', () => {
    it('has a unique cheapest fabric within 5%', () => {
      expect(CHEAPEST.down).toBe(45);
      expect(Math.round(CHEAPEST.cost)).toBe(2669);
      expect(CHEAPEST.days).toBeCloseTo(18.52, 2);
      // Costs fall steadily from 32 to 45 ports down, so nothing cheaper qualifies.
      for (let d = 33; d <= 45; d++) expect(clusterFabric(d).costPerGpu).toBeLessThan(clusterFabric(d - 1).costPerGpu);
      expect(runAt(runShare({ down: 46, placement: 'packed', others: 0 })).days).toBeGreaterThan(BASE.days * 1.05);
    });

    it('is solved only at 45 ports down with the run kept whole', () => {
      expect(L4_4_cheapestSolved(RUN_DEFAULTS)).toBe(false);
      expect(L4_4_cheapestSolved({ down: 45, placement: 'packed', others: 50 })).toBe(true);
      expect(L4_4_cheapestSolved({ down: 45, placement: 'scattered', others: 0 })).toBe(true);
      expect(L4_4_cheapestSolved({ down: 45, placement: 'scattered', others: 20 })).toBe(false);
      expect(L4_4_cheapestSolved({ down: 44, placement: 'packed', others: 0 })).toBe(false);
      expect(L4_4_cheapestSolved({ down: 46, placement: 'packed', others: 0 })).toBe(false);
      for (let d = 32; d <= 56; d++) expect(L4_4_cheapestSolved({ down: d, placement: 'packed', others: 0 })).toBe(d === 45);
    });

    it('agrees with the engine for the 1,024-GPU fabric', () => {
      expect(fabric({ gpus: 1024, downPorts: 48 }).oversubscription).toBe(3);
    });
  });
}

// Lesson 4.5
{
  const cents = (x: number) => Math.round(x * 100) / 100;

  describe('lesson 4.5: the facility planner', () => {
    it('starts from the Tech Park A-class', () => {
      expect(PUE.techpark.air).toBeCloseTo(1.271, 3);
      expect(Math.round(N.baseYear)).toBe(13607);
      expect(cents(N.basePerHour)).toBe(1.55);
      expect(cents(N.basePerUsed)).toBe(2.22);
      expect(Math.round(N.baseCapex)).toBe(50822);
      expect(Math.round(N.facilityCapex)).toBe(11622);
      expect(Math.round(N.serverYear)).toBe(9233);
      expect(capitalRecovery(0.1, 5)).toBeCloseTo(0.2638, 4);
      expect(cents(N.serverYear / (8760 * 0.7))).toBe(1.51);
      expect(Math.round(N.powerShare * 1000) / 10).toBe(4.1);
      expect(Math.round(N.fabricPerGpu)).toBe(4175);
    });

    it('quotes the sites, electricity and accelerators correctly', () => {
      expect(cents(N.bayport)).toBe(2.36);
      expect(cents(N.north)).toBe(2.16);
      expect(Math.round(N.bayportShare * 1000) / 10).toBe(6.9);
      expect(Math.round(N.northShare * 1000) / 10).toBe(2.6);
      expect(cents(N.power2x)).toBe(2.31);
      expect(cents(N.powerFree)).toBe(2.13);
      expect(about(N.perMwTechpark)).toBe('610');
      expect(about(N.bayportGpus)).toBe('12,000');
      expect(cents(N.bLiquid)).toBe(3.39);
      expect(Math.round((N.bLiquid / N.basePerUsed - 1) * 100)).toBe(53);
    });

    it('quotes utilization, life and the cost of capital correctly', () => {
      expect(cents(N.idleHour)).toBe(1.51);
      expect(cents(N.busyHour)).toBe(1.57);
      expect(cents(N.u80)).toBe(1.95);
      expect(cents(N.u60)).toBe(2.58);
      expect(Math.round(N.be5 * 1000) / 10).toBe(64.6);
      expect(Math.round(N.be3 * 1000) / 10).toBe(91);
      expect(Math.round(N.be7 * 1000) / 10).toBe(53.4);
      expect(cents(N.life3)).toBe(3.1);
      expect(cents(N.life7)).toBe(1.85);
      expect(cents(N.rate0)).toBe(1.69);
      expect(cents(N.rate15)).toBe(2.51);
      const profit = 2.4 * 8760 * 0.7 - costOf(PLANNER_DEFAULTS).totalYear;
      expect(Math.round(profit)).toBe(1109);
    });

    it('solves the first challenge only with capital terms, at 70%', () => {
      expect(underTargetSolved(PLANNER_DEFAULTS)).toBe(false);
      for (const site of ['bayport', 'techpark', 'northfield'] as const)
        for (const cooling of ['air', 'liquid'] as const) expect(underTargetSolved({ ...PLANNER_DEFAULTS, site, cooling })).toBe(false);
      expect(underTargetSolved({ ...PLANNER_DEFAULTS, util: 80 })).toBe(false);
      expect(underTargetSolved({ ...PLANNER_DEFAULTS, life: 7 })).toBe(true);
      expect(underTargetSolved({ ...PLANNER_DEFAULTS, life: 6, rate: 9 })).toBe(true);
      expect(underTargetSolved({ ...PLANNER_DEFAULTS, life: 6 })).toBe(false);
      expect(underTargetSolved({ ...PLANNER_DEFAULTS, gpu: 'L', life: 7 })).toBe(false);
    });

    it('solves the second challenge at 75% with a four-year life', () => {
      expect(breakEvenSolved(PRICE_DEFAULTS)).toBe(false);
      expect(Math.round(breakEven(4, 2.4) * 1000) / 10).toBe(74.5);
      expect(breakEvenSolved({ util: 75, life: 4, price: 2.4 })).toBe(true);
      expect(breakEvenSolved({ util: 74, life: 4, price: 2.4 })).toBe(false);
      expect(breakEvenSolved({ util: 76, life: 4, price: 2.4 })).toBe(false);
      expect(breakEvenSolved({ util: 75, life: 5, price: 2.4 })).toBe(false);
      expect(usedHourCost(75, 4)).toBeLessThanOrEqual(2.4);
      expect(breakEven(5, 1)).toBe(Infinity);
    });
  });
}
