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
import {
  CUSTOMERS_DEFAULT,
  FLEET_DEFAULT,
  OPS_DEFAULT,
  PRICEBOOK_DEFAULT,
  WORLD_DEFAULT,
  buyShare,
  commitments,
  evaluateFleet,
  fleetProductivity,
  offers,
  operate,
  prepare,
  simulateBusiness,
  type OpsPlan,
} from '../src/engines/compute/cloud';
import { busBandwidth, flatRingAllReduce, hierarchicalAllReduce, ringAllReduce, scaleOutLink, scaleUpLink } from '../src/engines/compute/collectives';
import { checkAssignment, feasibleAssignments, workloadFit } from '../src/engines/compute/compatibility';
import { breakEvenMarketPrice, contractPaths, rankedPaths } from '../src/engines/compute/contractPaths';
import { CONTRACT_DEFAULTS, dropFromRatio, runContract } from '../src/engines/compute/contracts';
import { airflowM3s, annualPue, chipCooling, waterFlowLs, chillerCop, junctionC } from '../src/engines/compute/cooling';
import { fabric, jobNetworkShare, maxTwoTierGpus } from '../src/engines/compute/dcNetwork';
import { DEMAND_DEFAULTS, growthFan, normalCdf, normalQuantile, weeklyDemand } from '../src/engines/compute/demand';
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
import { MARKET_BUYERS, MARKET_SUPPLY, clearMarket, productivity } from '../src/engines/compute/marketplace';
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
import { backtest, breakEvenPrices, gpuGridKW, powerCapPlan, techParkPrices } from '../src/engines/compute/powerAware';
import {
  bestReservation,
  breakEvenUtilization as L5_0_breakEvenUtilization,
  buyerCost,
  providerEconomics,
  spotEffective,
} from '../src/engines/compute/pricing';
import { PROCUREMENT_DEFAULTS, WEEK_SHAPE, bestReserved, monthNeed, monthOverflow, procure } from '../src/engines/compute/procurement';
import { fastOverflow, growthPaths, meanFirmHours, procurementSweep } from '../src/engines/compute/procurementSweep';
import { clusterLayout, rackConfig, rackLimits, serverUnits } from '../src/engines/compute/rack';
import { breakEvenDataTB, moveJob, transferHours } from '../src/engines/compute/regionMove';
import { DAY_JOBS, scheduleDay } from '../src/engines/compute/regionSchedule';
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
import { RESTART_MINUTES, bestInterval, checkpointMinutes, spotJobOf, spotRun } from '../src/engines/compute/spotCheckpoint';
import { LEVERS_DEFAULT, businessUnder, contextUnder, fixedPerYearFor } from '../src/engines/compute/strategyChallenge';
import { SUPPLY_DEFAULTS, dieYield, diesPerWafer, supplyChain, BUILD } from '../src/engines/compute/supplyChain';
import { trainingRun, TRAIN_COMPUTE_EFFICIENCY } from '../src/engines/compute/training';
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
import { cheapestBy, unitCost } from '../src/engines/compute/units';
import { PHYSICS_DEFAULTS, YIELD_FLEET, YIELD_WORKLOADS, productivityUnder, yieldRun } from '../src/engines/compute/yieldManager';
import { pct } from '../src/framework/format';
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
  rippleOutSolved,
  rowsRight,
  stageValues,
} from '../src/lessons/compute/ch1/L1_3';
import {
  CELL_DEFAULTS,
  FORMAT_DEFAULTS,
  INTERVAL,
  chargeAt,
  errorText,
  hottestAt64Solved,
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
  marstonSolved,
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
import {
  EXPLORER_DEFAULTS as L5_1_EXPLORER_DEFAULTS,
  LESSON_NUMBERS as L5_1_LESSON_NUMBERS,
  WORTH_ANSWER,
  cheapLSolved,
  cheapestIn,
  inUnit,
  lParityForBatch,
  lWorthSolved,
  money,
  parityPrice,
  pricesOf,
} from '../src/lessons/compute/ch5/L5_1';
import {
  AHEAD_EXAMPLE,
  CHAIN_DEFAULTS as L5_2_CHAIN_DEFAULTS,
  LESSON_NUMBERS as L5_2_N,
  QUARTERS,
  WAFER_DEFAULTS,
  aheadSolved,
  cleanSolved,
  goodDies,
  runChain,
  shortQuarters,
  waferDefects,
  waferLayout,
} from '../src/lessons/compute/ch5/L5_2';
import {
  DEMO_DEFAULTS,
  FORECAST_DEFAULTS,
  LESSON_NUMBERS as L5_3_N,
  SHORT_IN_OVERLAP,
  START,
  fanOf,
  finalRisk,
  fleetSolved as L5_3_fleetSolved,
  hourLabel,
  riskSolved,
  runDemand,
  safeFleet,
  segmentHours,
  smallestFleet,
} from '../src/lessons/compute/ch5/L5_3';
import {
  BEST_RESERVED,
  CHEAPEST as L5_4_CHEAPEST,
  LESSON_NUMBERS as L5_4_N,
  PROVIDER_DEFAULTS,
  SPOT_DEFAULTS,
  bill,
  intervalSolved,
  providerOf,
  providerSolved,
  reserveSolved,
} from '../src/lessons/compute/ch5/L5_4';
import {
  ADD_STEP,
  LESSON_NUMBERS as L5_5_N,
  MARKET_DEFAULTS,
  buildSolved,
  latencySolved,
  marketAt,
  premium,
  priceSetter,
  sameEverywhere,
  thresholdAt,
  worth,
} from '../src/lessons/compute/ch5/L5_5';
import {
  LESSON_NUMBERS as L6_1_N,
  YIELD_DEFAULTS,
  chatMarginSolved as L6_1_chatMarginSolved,
  chatThresholdMs,
  fleetFixedPerWeek,
  lServesChat,
  loserSolved,
  referenceBidsB,
  revenueByWorkload,
  runYield,
} from '../src/lessons/compute/ch6/L6_1';
import {
  JOBS,
  LESSON_NUMBERS as L6_2_N,
  PLAN_DEFAULTS,
  SPOT_DEFAULTS as L6_2_SPOT_DEFAULTS,
  WIDE_ANSWER,
  badYearSolved,
  bestOf,
  bestSpot,
  paramsOf,
  planOf,
  spotBeatsReserved,
  sweepOf,
  wideSolved,
} from '../src/lessons/compute/ch6/L6_2';
import {
  DATA_TB,
  DAY_DEFAULTS,
  JOB_DEFAULTS,
  LESSON_NUMBERS as L6_3_N,
  LINKS,
  dayOf,
  defaultData,
  jobOf,
  largestSolved,
  marketAtLatency,
  routeOf,
  runJob,
  slowestSolved as L6_3_slowestSolved,
  worthMoving,
} from '../src/lessons/compute/ch6/L6_3';
import {
  CHALLENGE_OWNED,
  DAY_DEFAULTS as L6_4_DAY_DEFAULTS,
  HALL_DEFAULTS as L6_4_HALL_DEFAULTS,
  LESSON_NUMBERS as L6_4_N,
  PAUSE_VALUE_ANSWER,
  VALUE_MAX,
  VALUE_MIN,
  VALUE_STEP,
  bestCap,
  capSolved,
  dayRun,
  hallRun,
  historyRun,
  pauseValueSolved,
  policyOf,
} from '../src/lessons/compute/ch6/L6_4';
import {
  DESK_DEFAULTS,
  LESSON_NUMBERS as L6_5_N,
  deskRun,
  firstProfitableRank,
  hedgeSolved,
  paramsOf as L6_5_paramsOf,
  pathSolved,
  priceSolved,
} from '../src/lessons/compute/ch6/L6_5';
import {
  MARSTON_RACKS,
  CHAT_TARGET,
  EXAMPLE_ANSWER,
  LESSON_NUMBERS as L7_1_N,
  allChecksPass,
  marstonSolved as L7_1_marstonSolved,
  capacityOf,
  customerDemand,
  evalOf,
  fixedPerGpuHour,
  racksByClass,
} from '../src/lessons/compute/ch7/L7_1';
import {
  FILL_ANSWER,
  LESSON_NUMBERS as L7_2_LESSON_NUMBERS,
  busyByClass,
  fillSolved,
  growthView,
  newCustomer,
  smallestFill,
  weekView,
} from '../src/lessons/compute/ch7/L7_2';
import {
  LESSON_NUMBERS as L7_3_N,
  PRICE_MAX,
  bestPrice,
  customersLost,
  listWeekOf,
  marginTarget,
  onDemandASolved,
  pricingSolved,
  sweepPrice,
  weekOf,
  withPrice,
} from '../src/lessons/compute/ch7/L7_3';
import {
  LAUNCH,
  NORMAL,
  RENT_A,
  RENT_B,
  bestPlan,
  hourDetail,
  hourName,
  lessonNumbers,
  planSolved,
  runWeek,
  turnedAway,
} from '../src/lessons/compute/ch7/L7_4';
import {
  RIGHT_SIZED,
  TARGET,
  WORLD_STATE_DEFAULTS,
  beatsStart,
  customersAreStarting,
  isStartingWorld,
  lessonNumbers as L7_5_lessonNumbers,
  runStrategy,
  targetSolved,
  worldOf,
} from '../src/lessons/compute/ch7/L7_5';
import { defaultCloud, sanitize } from '../src/lessons/compute/shared/cloudStore';
import { ACCELERATORS, serverPowerW, ridgePoint, SM_LIMITS, GPU_SERIAL_GOPS, HOST_CPU, GPU_IDS } from '../src/model/compute/hardware';
import { MODELS, kvBytesPerToken, paramCount, kvDim, matmulParams } from '../src/model/compute/models';
import { PRICES } from '../src/model/compute/prices';
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

    it('solves the ripple-out challenge exactly when a carry from bit 0 reaches the final carry out', () => {
      expect(rippleOutSolved(RIPPLE_DEFAULTS.a, RIPPLE_DEFAULTS.b)).toBe(false);
      expect(rippleOutSolved(15, 1)).toBe(true);
      // Every column propagates, but no carry is born: slow, yet not the ripple asked for.
      expect(rippleOutSolved(5, 10)).toBe(false);
      for (let a = 0; a < 16; a++)
        for (let b = 0; b < 16; b++) {
          const r = rippleAdder(toBits(a, 4), toBits(b, 4));
          expect(rippleOutSolved(a, b)).toBe(r.carryOut && r.bits[3].carryReady === rippleWorstCase(4));
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
    it('solves the refresh challenge only at 91 °C with the standard 64 ms', () => {
      expect(hottestAt64Solved('dram', 91, 64)).toBe(true);
      expect(hottestAt64Solved('dram', 90, 64)).toBe(false);
      expect(hottestAt64Solved('dram', 92, 64)).toBe(false);
      expect(hottestAt64Solved('sram', 91, 64)).toBe(false);
      expect(hottestAt64Solved(CELL_DEFAULTS.cell, CELL_DEFAULTS.temp, CELL_DEFAULTS.interval)).toBe(false);
      expect((64 - INTERVAL.min) % INTERVAL.step).toBe(0);
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
      const w = waves(1000, 1);
      expect([w.waves, w.slots, w.lastWave]).toEqual([8, 132, 76]);
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

    it('finds lesson 2.3’s smallest compute-bound batch (challenge a: tests/compute-ch2.test.ts)', () => {
      expect(smallestComputeBatch()).toBe(319);
      expect(batchIntensity(318)).toBeLessThan(ridgePoint(A));
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

    it('solves challenge b at the largest working set two passes keep at 6 TFLOPS (details: tests/compute-ch2.test.ts)', () => {
      expect(NORM_TARGET).toBe(6);
      expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm' })).toBe(false);
      expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', passes: 4 })).toBe(false);
      expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', wsLog: Math.log10(40), passes: 2 })).toBe(false); // fits, but not the largest
      expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', wsLog: 1.75, passes: 2 })).toBe(true);
      expect(cacheSolved({ ...MEM_DEFAULTS, kernel: 'norm', wsLog: 1.75, passes: 2, bw: 3.4 })).toBe(false);
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

    it('solves the challenge only with two levels on 64 A-class GPUs (details: tests/compute-ch2.test.ts)', () => {
      expect(clusterSolved(CLUSTER_DEFAULTS)).toBe(false);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8 })).toBe(false);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level' })).toBe(false); // 16.1 GB: under 0.2 s, but not the most
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', logBytes: 10.35 })).toBe(true);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'flat', logBytes: 10.35 })).toBe(false);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', logBytes: 10.35, gpu: 'B' })).toBe(false);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', logBytes: 9 })).toBe(false);
      expect(clusterSolved({ ...CLUSTER_DEFAULTS, servers: 8, algo: 'two-level', logBytes: 10.35, gpu: 'L' })).toBe(false);
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
    it('has its best rate at 7.5 a second in this sample, with any max batch from 91 up', () => {
      const ok: number[] = [];
      for (let c = 1; c <= CAP_MAX; c++) if (meetsLimits(runLab(BEST_RATE, c))) ok.push(c);
      expect(BEST_RATE).toBe(7.5);
      expect(BEST_CAPS).toEqual([91, CAP_MAX]);
      expect(ok[0]).toBe(BEST_CAPS[0]);
      expect(ok[ok.length - 1]).toBe(BEST_CAPS[1]);
      expect(ok.length).toBe(BEST_CAPS[1] - BEST_CAPS[0] + 1);
      for (let c = 1; c <= CAP_MAX; c++) expect(meetsLimits(runLab(BEST_RATE + RATE_STEP, c))).toBe(false);
      for (let c = 8; c <= CAP_MAX; c += 8) expect(meetsLimits(runLab(BEST_RATE + 2 * RATE_STEP, c))).toBe(false);
      expect(runLab(BEST_RATE, 84).overloaded).toBe(true);
      expect(runLab(BEST_RATE + RATE_STEP, 256).tpot).toBeGreaterThan(0.04);
    }, 30000);

    it('is solved only at the best rate, and not at the start', () => {
      expect(rateSolved(L3_4_LAB_DEFAULTS.rate, L3_4_LAB_DEFAULTS.cap)).toBe(false);
      expect(rateSolved(7.5, 128)).toBe(true);
      expect(rateSolved(7, 200)).toBe(false);
      expect(rateSolved(6.5, 200)).toBe(false);
      expect(rateSolved(8, 200)).toBe(false);
      expect(rateSolved(7.5, 84)).toBe(false);
      const best = runLab(7.5, 256);
      expect(Math.round(best.throughput)).toBe(2235);
      expect(Math.round(best.utilization * 100)).toBe(36);
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
      const gh = (t: number) => Math.round(((SERVE.tp * 1e6) / (t * 3600)) * 1000) / 1000;
      expect(gh(runLab(7.5, 256).throughput)).toBe(0.497);
      expect(gh(runLab(RATE_MAX, CAP_MAX).throughput)).toBe(0.356);
      expect(gh(servingPoint(SERVE, CAP_AVERAGE, INPUT, OUTPUT).tokensPerS)).toBe(0.325);
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
      expect(annualPue(SITES.marston, { cooling: 'air', supplyC: 24 }).pue).toBeCloseTo(1.305, 3);
      expect(annualPue(SITES.techpark, { cooling: 'air', supplyC: 24 }).pue).toBeCloseTo(1.271, 3);
      expect(annualPue(SITES.fernhill, { cooling: 'liquid', supplyC: 35 }).pue).toBeCloseTo(1.113, 3);
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

    it('solves challenge b only with liquid cooling on the smallest feed that fits, 60 kW', () => {
      expect(hallSolved(HALL_DEFAULTS)).toBe(false);
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 60 })).toBe(true);
      // 100 kW fits too, but it is not the smallest feed.
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 100 })).toBe(false);
      expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 40 })).toBe(false);
      for (const feed of [40, 60, 100, 140]) expect(hallSolved({ gpu: 'A', cooling: 'air', feed })).toBe(false);
      expect(hallSolved({ gpu: 'B', cooling: 'liquid', feed: 140 })).toBe(false);
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

    it('finds the largest IT load Marston can connect', () => {
      expect(gridSolved(SITE_DEFAULTS)).toBe(false);
      expect(gridSolved({ site: 'marston', itMW: 14.5, redundancy: 'N+1' })).toBe(true);
      expect(gridSolved({ site: 'marston', itMW: 14, redundancy: 'N+1' })).toBe(false);
      expect(gridSolved({ site: 'marston', itMW: 15, redundancy: 'N+1' })).toBe(false);
      expect(gridSolved({ site: 'marston', itMW: 14.5, redundancy: '2N' })).toBe(false);
      expect(siteRun({ site: 'marston', itMW: 15, redundancy: 'N+1' }).over).toBe(true);
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
      expect(siteRun({ ...SITE_DEFAULTS, site: 'marston' }).peakMW).toBeCloseTo(27.5, 1);
      expect(n.bayMax).toBe(14.5);
      expect(n.tpMax).toBe(43.5);
      expect(n.nfMax).toBe(153);
      expect(largestItFor('marston', 'N+1')).toBe(14.5);
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
      expect(sitePue('marston', air24).pue).toBeCloseTo(1.305, 3);
      expect(sitePue('marston', air24).freeShare).toBe(0);
      expect(sitePue('fernhill', air24).pue).toBeCloseTo(1.205, 3);
      expect(Math.round(sitePue('fernhill', air24).freeShare * 100)).toBe(49);
      expect(sitePue('marston', liq(35)).pue).toBeCloseTo(1.173, 3);
      expect(sitePue('fernhill', liq(35)).pue).toBeCloseTo(1.113, 3);
      expect(sitePue('marston', liq(40)).pue).toBeCloseTo(1.147, 3);
      expect(sitePue('marston', liq(39)).pue).toBeCloseTo(1.151, 3);
      expect(sitePue('marston', liq(45)).pue).toBeCloseTo(1.134, 3);
      expect(SITES.marston.gridMW / sitePue('marston', air24).peakPue).toBeCloseTo(14.5, 1);
      expect(SITES.marston.gridMW / sitePue('marston', liq(40)).peakPue).toBeCloseTo(16.2, 1);
    });

    it('solves the Marston challenge only with 40 °C water', () => {
      expect(marstonSolved(BUILDING_DEFAULTS)).toBe(false);
      expect(marstonSolved({ ...BUILDING_DEFAULTS, site: 'marston', cooling: 'liquid', waterC: 40 })).toBe(true);
      for (const w of [25, 30, 35, 39, 41, 45]) expect(marstonSolved({ ...BUILDING_DEFAULTS, site: 'marston', cooling: 'liquid', waterC: w })).toBe(false);
      for (const a of [18, 24, 27]) expect(marstonSolved({ ...BUILDING_DEFAULTS, site: 'marston', cooling: 'air', airC: a })).toBe(false);
      expect(marstonSolved({ ...BUILDING_DEFAULTS, site: 'techpark', cooling: 'liquid', waterC: 40 })).toBe(false);
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
      expect(cents(N.marston)).toBe(2.36);
      expect(cents(N.north)).toBe(2.16);
      expect(Math.round(N.marstonShare * 1000) / 10).toBe(6.9);
      expect(Math.round(N.northShare * 1000) / 10).toBe(2.6);
      expect(cents(N.power2x)).toBe(2.31);
      expect(cents(N.powerFree)).toBe(2.13);
      expect(about(N.perMwTechpark)).toBe('610');
      expect(about(N.marstonGpus)).toBe('12,000');
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
      for (const site of ['marston', 'techpark', 'fernhill'] as const)
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

// Chapter 5 engines

{
  describe('units of compute', () => {
    it('ranks accelerators differently by GPU-hour and by token', () => {
      expect(cheapestBy('chat70', 'gpuHour').best).toBe('L');
      expect(cheapestBy('chat70', 'mTokens').best).toBe('B');
      expect(unitCost('chat70', 'A').mTokens).toBeCloseTo(0.779, 3);
      expect(unitCost('chat70', 'L').mTokens).toBeCloseTo(7.18, 2);
      expect(unitCost('train70', 'A').run / 1e6).toBeCloseTo(0.51, 2);
    });
  });

  describe('supply chain', () => {
    it('turns wafers into GPUs and finds the scarcest stage', () => {
      expect(diesPerWafer(814)).toBe(63);
      expect(dieYield(0.1, 814)).toBeCloseTo(0.443, 3);
      const qs = supplyChain(SUPPLY_DEFAULTS);
      expect(qs[0].binding).toBe('packaging');
      expect(qs[0].built.A).toBeCloseTo(600, 6);
      expect(qs[5].binding).toBe('power');
      expect(qs[9].binding).toBe('wafers');
      expect(qs[11].installedAEq).toBeCloseTo(13012, -1);
    });
  });

  describe('demand', () => {
    it('stacks four kinds of demand against a fleet', () => {
      const d = weeklyDemand(DEMAND_DEFAULTS);
      expect(d.hours).toBe(672);
      expect(d.utilization).toBeCloseTo(0.677, 3);
      expect(d.batchUnplaced).toBe(0);
      expect(weeklyDemand({ ...DEMAND_DEFAULTS, batchFlexible: false }).peak).toBeGreaterThan(d.peak);
    });

    it('fans out a growth forecast', () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 6);
      expect(normalQuantile(0.95)).toBeCloseTo(1.645, 2);
      const fan = growthFan(5000, 12, 0.05, 0.04, 8000);
      expect(fan[12].shortfall).toBeCloseTo(0.78, 2);
      expect(fan[6].p50).toBeLessThan(fan[6].p95);
    });
  });

  describe('pricing', () => {
    it('reserves up to the level needed reserved ÷ on-demand of the time', () => {
      expect(L5_0_breakEvenUtilization(PRICES.A)).toBeCloseTo(2 / 3, 6);
      const need = [100, 100, 200, 300];
      const best = bestReservation(need, PRICES.A);
      expect(buyerCost(need, best, PRICES.A).total).toBeLessThanOrEqual(buyerCost(need, best + 10, PRICES.A).total);
      expect(buyerCost(need, best, PRICES.A).total).toBeLessThanOrEqual(buyerCost(need, Math.max(0, best - 10), PRICES.A).total);
      expect(spotEffective(PRICES.A, 2, 30, 10).perUsefulHour).toBeCloseTo(0.984, 3);
    });

    it('fills the provider’s buffer with spot', () => {
      const r = providerEconomics({ fleet: 1000, reserved: 500, onDemandMean: 300, onDemandSwing: 0.3, onDemandNoise: 0.1, spotDemand: 400, prices: PRICES.A, costPerGpuHour: 1.55, hours: 672 });
      expect(r.soldShare).toBeCloseTo(1, 6);
      expect(r.firmShare).toBeCloseTo(0.799, 3);
      expect(r.marginPerHour).toBeCloseTo(159, 0);
    });
  });

  describe('marketplace', () => {
    it('prices GPUs near users above remote ones when latency binds', () => {
      expect(productivity('chat70', 'B')).toBeCloseTo(36 / 14, 6);
      const c = clearMarket(MARKET_BUYERS, MARKET_SUPPLY);
      expect(c.prices.marston.A).toBeCloseTo(3.5, 2);
      expect(c.prices.fernhill.A).toBeCloseTo(1.52, 2);
      expect(c.prices.marston.B).toBeCloseTo(9.0, 2);
      const loose = clearMarket(
        MARKET_BUYERS.map((b) => (b.id === 'chat70' || b.id === 'frontier400' ? { ...b, maxRttMs: 100 } : b)),
        MARKET_SUPPLY,
      );
      expect(loose.prices.marston.A).toBeCloseTo(loose.prices.fernhill.A, 2);
    });
  });
}

// Lesson 5.1

{
  const N = L5_1_LESSON_NUMBERS;

  describe('lesson 5.1: units of computation', () => {
    it('ranks the accelerators differently by hour and by work', () => {
      const list = pricesOf(L5_1_EXPLORER_DEFAULTS);
      expect(cheapestIn('chat70', 'gpuHour', list)).toBe('L');
      expect(cheapestIn('chat70', 'work', list)).toBe('B');
      expect(cheapestIn('chat70', 'peakPflop', list)).toBe('B');
      // The L-class can't run the frontier model, so it is never the cheapest for it.
      expect(cheapestIn('frontier400', 'gpuHour', list)).toBe('A');
    });

    it('solves challenge a only at the highest L-class price that is cheapest for batch, $0.50', () => {
      const batch = { ...L5_1_EXPLORER_DEFAULTS, work: 'batch8' as const, unit: 'work' as const };
      expect(lParityForBatch()).toBeCloseTo(0.515, 3);
      expect(cheapLSolved(L5_1_EXPLORER_DEFAULTS)).toBe(false);
      expect(cheapLSolved({ ...batch, pL: 0.5 })).toBe(true);
      expect(cheapLSolved({ ...batch, pL: 0.55 })).toBe(false);
      expect(cheapLSolved({ ...batch, pL: 0.45 })).toBe(false);
      expect(cheapLSolved({ ...L5_1_EXPLORER_DEFAULTS, pL: 0.5 })).toBe(false);
    });

    it('solves challenge b at an A-class price of $2.55', () => {
      expect(WORTH_ANSWER).toBeCloseTo(2.55, 6);
      expect(lWorthSolved(2.55)).toBe(true);
      expect(lWorthSolved(2.5)).toBe(false);
      expect(lWorthSolved(2.6)).toBe(false);
      expect(lWorthSolved(2.4)).toBe(false);
    });

    it('quotes true numbers', () => {
      expect(N.cost45PerHour).toBeCloseTo(1.55, 2);
      expect(N.cost45PerUsed).toBeCloseTo(2.22, 2);
      expect(inUnit(N.peak.L, 'peakPflop')).toBe('$2.49');
      expect(inUnit(N.peak.A, 'peakPflop')).toBe('$2.43');
      expect(inUnit(N.peak.B, 'peakPflop')).toBe('$2.13');
      expect(Math.round(N.chatUtil.A * 100)).toBe(41);
      expect(Math.round(N.chatUtil.B * 100)).toBe(56);
      expect(N.chatUtil.L * 100).toBeCloseTo(1.7, 1);
      expect(money(N.chatUseful.L)).toBe('$144');
      expect(N.chatBatchL).toBe(14);
      expect(money(N.chatTokens.L)).toBe('$7.18');
      expect(money(N.chatTokens.A)).toBe('$0.779');
      expect(money(N.chatTokens.B)).toBe('$0.579');
      expect(N.chatTokens.L / N.chatTokens.B).toBeCloseTo(12.4, 1);
      expect(money(N.batchTokens.L)).toBe('$0.400');
      expect(money(N.batchTokens.A)).toBe('$0.286');
      expect(money(N.batchTokens.B)).toBe('$0.229');
      expect(money(N.trainRun.L)).toBe('$703,000');
      expect(money(N.trainRun.A)).toBe('$513,000');
      expect(money(N.trainRun.B)).toBe('$435,000');
      expect(N.trainGpus).toEqual({ L: 1088, A: 304, B: 128 });
      expect(N.chatGpus).toEqual({ L: 864, A: 36, B: 14 });
      expect(N.batchTokPerHour.L / 1e6).toBeCloseTo(2.25, 2);
      expect(N.batchTokPerHour.B / 1e6).toBeCloseTo(21.0, 1);
      expect(Math.round((N.batchTokPerHour.L / N.batchTokPerHour.B) * 100)).toBe(11);
      expect(N.value.chatB).toBeCloseTo(6.17, 2);
      expect(N.value.frontierB).toBeCloseTo(7.2, 6);
      expect(N.value.tuneB).toBeCloseTo(4.8, 6);
      expect(N.value.chatL).toBeCloseTo(0.1, 2);
      expect(N.value.batchL).toBeCloseTo(0.67, 2);
      expect(N.value.tuneL).toBeCloseTo(0.86, 2);
      expect(N.bLow).toBeCloseTo(2, 6);
      expect(N.bHigh).toBeCloseTo(3, 6);
      expect(parityPrice('frontier400', 'L', 2.4)).toBe(0);
    });
  });
}

// Lesson 5.2

{
  const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 5.2: the supply chain', () => {
    it('quotes the default chain', () => {
      expect(L5_2_N.aDies).toBe(63);
      expect(r(L5_2_N.aYield, 3)).toBe(0.443);
      expect(r(L5_2_N.aPerWafer, 1)).toBe(27.9);
      expect(r(L5_2_N.bPerWafer, 1)).toBe(14.4);
      expect(r(L5_2_N.bAEq, 2)).toBe(2.28);
      expect(r(L5_2_N.q1Wafers)).toBe(837);
      expect(r(L5_2_N.q1Memory)).toBe(700);
      expect(r(L5_2_N.q1Built)).toBe(600);
      expect(r(L5_2_N.q1Installed)).toBe(1600);
      expect(r(L5_2_N.q1Demand)).toBe(1800);
      expect(L5_2_N.firstPowerLimit).toBe(3);
      expect(r(L5_2_N.q4Built)).toBe(799);
      expect(r(L5_2_N.q4Deployed)).toBe(698);
      expect(r(L5_2_N.q4Waiting)).toBe(28);
      expect(r(L5_2_N.q6Waiting)).toBe(132);
      expect(r(L5_2_N.q7BuiltA)).toBe(159);
      expect(L5_2_N.firstWaferLimit).toBe(7);
      expect(r(L5_2_N.q12Installed / 1000, 1)).toBe(13.0);
      expect(r(L5_2_N.q12Demand / 1000, 1)).toBe(13.4);
      expect(r(L5_2_N.q1Needed)).toBe(800);
    });

    it('moves the limit when one stage is relieved', () => {
      const pack = runChain({ ...L5_2_CHAIN_DEFAULTS, packaging: 1500 });
      expect(pack[0].binding).toBe('power');
      expect(shortQuarters(pack)).toContain(0);
      const packPower = runChain({ ...L5_2_CHAIN_DEFAULTS, packaging: 1500, power: 2000 });
      expect(packPower[0].binding).toBe('memory');
      expect(shortQuarters(packPower)).toContain(0);
    });

    it('is solved only when every quarter keeps up', () => {
      expect(aheadSolved(L5_2_CHAIN_DEFAULTS)).toBe(false);
      expect(aheadSolved(AHEAD_EXAMPLE)).toBe(true);
      expect(r(L5_2_N.aheadQ12Margin / 1000, 2)).toBe(0.66);
      // Each of the three changes is needed on the slider grid.
      expect(aheadSolved({ ...AHEAD_EXAMPLE, hbm: 3.9 })).toBe(false);
      expect(aheadSolved({ ...AHEAD_EXAMPLE, packaging: 750 })).toBe(false);
      expect(aheadSolved({ ...AHEAD_EXAMPLE, power: 1150 })).toBe(false);
      expect(runChain(AHEAD_EXAMPLE).length).toBe(QUARTERS);
    });

    it('grows faster in A-class equivalents when the B-class starts earlier', () => {
      const early = runChain({ ...L5_2_CHAIN_DEFAULTS, bStart: 1 });
      const late = runChain({ ...L5_2_CHAIN_DEFAULTS, bStart: 8 });
      const base = runChain(L5_2_CHAIN_DEFAULTS);
      expect(early[QUARTERS - 1].installedAEq).toBeGreaterThan(base[QUARTERS - 1].installedAEq);
      expect(base[QUARTERS - 1].installedAEq).toBeGreaterThan(late[QUARTERS - 1].installedAEq);
    });
  });

  describe('lesson 5.2: yield', () => {
    it('quotes the yield figures', () => {
      expect(L5_2_N.halfDies).toBe(143);
      expect(r(L5_2_N.halfYield, 3)).toBe(0.67);
      expect(r(L5_2_N.aSilicon)).toBe(22722);
      expect(r(L5_2_N.halfSilicon)).toBe(38342);
      expect(r(L5_2_N.halfSilicon / L5_2_N.aSilicon - 1, 2)).toBe(0.69);
      expect(r((L5_2_N.bPerWafer * L5_2_N.bAEq) / L5_2_N.aPerWafer - 1, 2)).toBe(0.17);
    });

    it('draws exactly the dies the formula counts, for every die on the slider', () => {
      for (let a = 100; a <= 850; a += 2) {
        const lay = waferLayout(a);
        expect(lay.gridCount).toBeGreaterThanOrEqual(diesPerWafer(a));
        expect(lay.dies.length).toBe(diesPerWafer(a));
      }
    });

    it('spoils dies that defects land on, about as often as the formula says', () => {
      let good = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const lay = waferLayout(BUILD.A.dieMm2);
        const g = goodDies(lay.dies, lay.side, waferDefects(0.1, seed));
        good += g.filter(Boolean).length;
        total += g.length;
      }
      expect(Math.abs(good / total - dieYield(0.1, BUILD.A.dieMm2))).toBeLessThan(0.04);
      expect(waferDefects(0.1, 1).length).toBe(71);
    });

    it('solves the clean-process challenge only at 0.06', () => {
      expect(cleanSolved(WAFER_DEFAULTS.area, WAFER_DEFAULTS.defects)).toBe(false);
      expect(cleanSolved(814, 0.06)).toBe(true);
      expect(cleanSolved(814, 0.05)).toBe(false);
      expect(cleanSolved(814, 0.07)).toBe(false);
      expect(cleanSolved(800, 0.06)).toBe(false);
      expect(r(dieYield(0.06, 814), 3)).toBe(0.614);
    });
  });
}

// Lesson 5.3

{
  describe('lesson 5.3: demand', () => {
    it('peaks inference in the afternoon and bottoms out before dawn', () => {
      const d = runDemand(DEMO_DEFAULTS);
      // Tuesday of week 1, hours 24–47.
      const day = d.inference.slice(24, 48);
      const peakHod = day.indexOf(Math.max(...day));
      const troughHod = day.indexOf(Math.min(...day));
      expect(peakHod).toBeGreaterThanOrEqual(12);
      expect(peakHod).toBeLessThanOrEqual(18);
      expect(troughHod).toBeLessThanOrEqual(6);
    });

    it('quotes the starting month correctly', () => {
      expect(Math.round(L5_3_N.peak)).toBe(5675);
      expect(Math.round(L5_3_N.average)).toBe(3389);
      // The starting fleet of 6,000 serves everything; the shortfall is quoted at the 4,900-GPU answer.
      expect(L5_3_N.startUtil).toBeCloseTo(0.565, 3);
      expect(L5_3_N.startUnmet).toBe(0);
      expect(L5_3_N.flexUnmet).toBeCloseTo(0.00065, 5);
      expect(L5_3_N.flexShortHours).toBe(5);
      expect(Math.round(L5_3_N.flexShortWorst)).toBe(775);
      expect(SHORT_IN_OVERLAP).toBe(true);
      expect(Math.round(L5_3_N.trough)).toBe(1046);
      expect(L5_3_N.trainingMax).toBe(3072);
      expect(L5_3_N.threeRunHours).toBe(17);
      expect(Math.round(L5_3_N.shares.inference * 100)).toBe(50);
      expect(Math.round(L5_3_N.shares.training * 100)).toBe(33);
      expect(Math.round(L5_3_N.shares.batch * 100)).toBe(15);
      expect(Math.round(L5_3_N.shares.dev * 100)).toBe(2);
      expect(Math.round(L5_3_N.noTrainingPeak)).toBe(2964);
      expect(L5_3_N.noTrainingUtil).toBeCloseTo(0.467, 3);
      const s = segmentHours(runDemand(DEMO_DEFAULTS));
      expect(s.total).toBeCloseTo(s.hours.inference + s.hours.training + s.hours.batch + s.hours.dev, 6);
      expect(hourLabel(17)).toBe('Mon 17:00, week 1');
    });

    it('shows flexible batch saving GPUs', () => {
      expect(Math.round(L5_3_N.fixedPeak)).toBe(6552);
      expect(L5_3_N.fixedUnmet).toBeCloseTo(0.0271, 4);
      expect(L5_3_N.fixedShortHours).toBe(125);
      expect(L5_3_N.flexFleet).toBe(4900);
      expect(L5_3_N.fixedFleet).toBe(6100);
      expect(L5_3_N.fullFleet).toBe(5700);
      expect(L5_3_N.flexUtil).toBeCloseTo(0.691, 3);
      expect(L5_3_N.fixedUtil).toBeCloseTo(0.555, 3);
    });

    it('solves the fleet challenge only at the smallest fleet, with flexible batch', () => {
      expect(L5_3_fleetSolved(DEMO_DEFAULTS)).toBe(false);
      expect(L5_3_fleetSolved({ ...DEMO_DEFAULTS, fleet: 4900 })).toBe(true);
      expect(L5_3_fleetSolved({ ...DEMO_DEFAULTS, fleet: 5000 })).toBe(false);
      expect(L5_3_fleetSolved({ ...DEMO_DEFAULTS, fleet: 4800 })).toBe(false);
      expect(L5_3_fleetSolved({ ...DEMO_DEFAULTS, batch: 'fixed', fleet: 6100 })).toBe(false);
      expect(smallestFleet({ ...DEMO_DEFAULTS, batch: 'fixed' })).toBe(6100);
    });

    it('forecasts a year ahead', () => {
      expect(START).toBe(5700);
      const fan = fanOf(FORECAST_DEFAULTS);
      expect(Math.round(fan[12].p50)).toBe(10139);
      expect(Math.round(fan[12].p5)).toBe(8072);
      expect(Math.round(fan[12].p95)).toBe(12734);
      expect(Math.round(fan[6].shortfall * 100)).toBe(30);
      expect(Math.round(fan[9].shortfall * 100)).toBe(78);
      expect(Math.round(fan[12].shortfall * 100)).toBe(96);
      expect(L5_3_N.safe).toBe(12200);
      expect(L5_3_N.safeCertain).toBe(10300);
      expect(L5_3_N.safeWide).toBe(14100);
      expect(Math.round(L5_3_N.hedgeGpus / 100) * 100).toBe(2100);
      expect(Math.round(L5_3_N.aYear / 100) * 100).toBe(13600);
      expect(Math.round(L5_3_N.hedgeCost / 1e6)).toBe(28);
      // No uncertainty: risk is 0 or 1, never NaN.
      expect(finalRisk({ growth: 5, sigma: 0, fleet: 10300 })).toBe(0);
      expect(finalRisk({ growth: 5, sigma: 0, fleet: 10200 })).toBe(1);
      expect(safeFleet(5, 4)).toBe(12200);
    });

    it('solves the risk challenge only at the smallest safe fleet', () => {
      expect(riskSolved(FORECAST_DEFAULTS)).toBe(false);
      expect(riskSolved({ ...FORECAST_DEFAULTS, fleet: 12200 })).toBe(true);
      expect(riskSolved({ ...FORECAST_DEFAULTS, fleet: 12300 })).toBe(false);
      expect(riskSolved({ ...FORECAST_DEFAULTS, fleet: 12100 })).toBe(false);
      expect(riskSolved({ growth: 3, sigma: 2, fleet: safeFleet(3, 2) })).toBe(true);
    });
  });
}

// Lesson 5.4

{
  const r0 = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('interruptible training jobs (spotCheckpoint.ts)', () => {
    it('reduces to spotEffective for one server with free checkpoints', () => {
      const one = spotRun({ id: 'tune8', gpus: 8, servers: 1, stateBytes: 0 }, PRICES.A.spot, 2, 30);
      expect(one.perUsefulHour).toBeCloseTo(spotEffective(PRICES.A, 2, 30, RESTART_MINUTES).perUsefulHour, 9);
    });

    it('sizes the jobs from Lesson 3.5 and their checkpoints from Lesson 3.3', () => {
      const tune = spotJobOf('tune8');
      const train = spotJobOf('train70');
      expect([tune.gpus, tune.servers, train.gpus, train.servers]).toEqual([10, 2, 304, 38]);
      expect(r0(tune.stateBytes / 1e9)).toBe(120);
      expect(r0(train.stateBytes / 1e12, 2)).toBe(1.11);
      expect(r0(checkpointMinutes(tune) * 60)).toBe(24);
      expect(r0(checkpointMinutes(train) * 60)).toBe(56);
    });

    it('has a best checkpoint interval, and makes big synchronous runs expensive', () => {
      const tune = spotJobOf('tune8');
      const train = spotJobOf('train70');
      expect(bestInterval(tune, PRICES.A.spot, 2, 120)).toBe(17);
      expect(bestInterval(train, PRICES.A.spot, 2, 120)).toBe(5);
      expect(spotRun(train, PRICES.A.spot, 2, 30).perUsefulHour).toBe(Infinity);
    });
  });

  describe('lesson 5.4 challenges', () => {
    it('a: the cheapest reservation', () => {
      expect(L5_4_CHEAPEST.reserved).toBe(139);
      expect(reserveSolved(139)).toBe(true);
      expect(reserveSolved(138)).toBe(true);
      expect(reserveSolved(137)).toBe(false);
      expect(reserveSolved(0)).toBe(false);
      expect(reserveSolved(130)).toBe(false);
      expect(reserveSolved(145)).toBe(false);
    });

    it('b: the cheapest checkpoint interval for the fine-tuning job', () => {
      expect(intervalSolved(SPOT_DEFAULTS)).toBe(false);
      expect(intervalSolved({ ...SPOT_DEFAULTS, interval: 17 })).toBe(true);
      expect(intervalSolved({ ...SPOT_DEFAULTS, interval: 30 })).toBe(false);
      expect(intervalSolved({ ...SPOT_DEFAULTS, interval: 5 })).toBe(false);
      expect(intervalSolved({ job: 'train70', reclaims: 2, interval: 5 })).toBe(false);
      expect(intervalSolved({ ...SPOT_DEFAULTS, reclaims: 1, interval: 24 })).toBe(false);
    });

    it('c: the most margin within 1% turned away', () => {
      expect(BEST_RESERVED.reserved).toBe(600);
      expect(providerSolved({ ...PROVIDER_DEFAULTS, reserved: 600 })).toBe(true);
      expect(providerSolved(PROVIDER_DEFAULTS)).toBe(false);
      expect(providerSolved({ ...PROVIDER_DEFAULTS, reserved: 610 })).toBe(false);
      expect(providerOf({ ...PROVIDER_DEFAULTS, reserved: 610 }).turnedAway).toBeGreaterThan(0.01);
      expect(providerSolved({ ...PROVIDER_DEFAULTS, reserved: 600, spot: 350 })).toBe(false);
    });
  });

  describe('lesson 5.4 numbers', () => {
    it('the buyer', () => {
      expect([r0(L5_4_N.needMin), r0(L5_4_N.needMax)]).toEqual([85, 269]);
      expect(r0(L5_4_N.allOnDemandTotal)).toBe(275021);
      expect(L5_4_N.peakReserved).toBe(269);
      expect(r0(L5_4_N.reservePeakTotal)).toBe(289229);
      expect(r0(L5_4_N.reservePeakPerHour, 2)).toBe(2.52);
      expect(r0(L5_4_N.reservePeakIdle * 100)).toBe(37);
      expect(L5_4_N.breakEven).toBeCloseTo(2 / 3, 9);
      expect(r0(L5_4_N.levelAtBreakEven)).toBe(139);
      expect(L5_4_N.bestReserved).toBe(139);
      expect(r0(L5_4_N.bestPerHour, 2)).toBe(1.86);
      expect(r0(L5_4_N.bestSaving * 100)).toBe(23);
      expect(r0(L5_4_N.bestIdle * 100)).toBe(6);
      expect(r0(bill(139).total)).toBe(213075);
    });

    it('interruptible hours', () => {
      expect(L5_4_N.tuneInterruptions).toBe(4);
      expect(r0(L5_4_N.tune60, 2)).toBe(1.08);
      expect(L5_4_N.tuneBestInterval).toBe(17);
      expect(r0(L5_4_N.tuneBestCost, 2)).toBe(1.03);
      expect(r0(L5_4_N.tuneBestUseful * 100)).toBe(92);
      expect(L5_4_N.trainInterruptions).toBe(76);
      expect(r0(L5_4_N.trainMinutesBetween)).toBe(19);
      expect(L5_4_N.trainBestInterval).toBe(5);
      expect(r0(L5_4_N.trainBestUseful * 100)).toBe(14);
      expect(r0(L5_4_N.trainBestCost, 2)).toBe(7.04);
      expect(L5_4_N.trainBestCost / PRICES.A.onDemand).toBeGreaterThan(2.8);
      expect(L5_4_N.trainBestCost / PRICES.A.onDemand).toBeLessThan(3);
      expect(r0(L5_4_N.trainCalmCost, 2)).toBe(1.35);
      expect(L5_4_N.trainCalmCost).toBeLessThan(PRICES.A.reserved);
      expect(RESTART_MINUTES).toBe(10);
    });

    it('the provider', () => {
      expect(r0(L5_4_N.gpuCostBusy, 2)).toBe(1.57);
      expect(r0(L5_4_N.peakOnDemand)).toBe(484);
      expect(r0(L5_4_N.baseRevenue)).toBe(1709);
      expect(r0(L5_4_N.baseMargin)).toBe(139);
      expect(r0(L5_4_N.baseFirm * 100)).toBe(80);
      expect(r0(L5_4_N.noSpotMargin)).toBe(-40);
      expect(r0(L5_4_N.reclaimsPerHour, 1)).toBe(18.9);
      expect(r0(L5_4_N.reclaimsPerSpotGpuDay, 1)).toBe(2.3);
      expect(L5_4_N.bestProviderReserved).toBe(600);
      expect(r0(L5_4_N.bestProviderMargin)).toBe(201);
      expect(r0(L5_4_N.bestProviderAway * 100, 2)).toBe(0.73);
      expect(L5_4_N.greedyReserved).toBe(690);
      expect(r0(L5_4_N.greedyMargin)).toBe(226);
      expect(r0(L5_4_N.greedyAway * 100, 1)).toBe(8.4);
    });
  });
}

// Lesson 5.5

{
  const r2 = (x: number) => Math.round(x * 100) / 100;

  describe('lesson 5.5 challenges', () => {
    it('a: the tightest latency limit with one price everywhere is Fernhill’s 40 ms', () => {
      expect(latencySolved(MARKET_DEFAULTS)).toBe(false);
      expect(latencySolved({ ...MARKET_DEFAULTS, lat: 40 })).toBe(true);
      expect(latencySolved({ ...MARKET_DEFAULTS, lat: 39 })).toBe(false);
      expect(latencySolved({ ...MARKET_DEFAULTS, lat: 41 })).toBe(false);
      expect(latencySolved({ ...MARKET_DEFAULTS, lat: 40, addB: 400 })).toBe(false);
      expect(sameEverywhere({ ...MARKET_DEFAULTS, lat: 60 })).toBe(true);
    });

    it('b: the fewest B-class GPUs at Tech Park that close the premium is 350', () => {
      expect(buildSolved(MARKET_DEFAULTS)).toBe(false);
      expect(buildSolved({ ...MARKET_DEFAULTS, addB: 350 })).toBe(true);
      expect(buildSolved({ ...MARKET_DEFAULTS, addB: 325 })).toBe(false);
      expect(buildSolved({ ...MARKET_DEFAULTS, addB: 375 })).toBe(false);
      expect(buildSolved({ ...MARKET_DEFAULTS, lat: 10, addB: 350 })).toBe(true);
      expect(buildSolved({ ...MARKET_DEFAULTS, lat: 40, addB: 0 })).toBe(false);
      expect(buildSolved({ ...MARKET_DEFAULTS, demand: 120, addB: 350 })).toBe(false);
      expect(premium({ ...MARKET_DEFAULTS, addB: 350 - ADD_STEP })).toBeGreaterThan(0.1);
      expect(thresholdAt(100)).toBe(350);
    });
  });

  describe('lesson 5.5 numbers', () => {
    it('the reference market', () => {
      expect([r2(L5_5_N.nearA), r2(L5_5_N.nearB), r2(L5_5_N.nearL), r2(L5_5_N.techparkA)]).toEqual([3.5, 9, 0.58, 3.5]);
      expect([r2(L5_5_N.farA), r2(L5_5_N.farB)]).toEqual([1.52, 3.6]);
      expect(r2(L5_5_N.nearA - L5_5_N.farA)).toBe(1.98);
      expect(L5_5_N.chatWanted).toBe(14000);
      expect(Math.round(L5_5_N.chatServed)).toBe(13726);
      expect(Math.round(L5_5_N.chatShort)).toBe(274);
      expect(Math.round(L5_5_N.chatShortInB)).toBe(106);
      expect(L5_5_N.batchWanted).toBe(20000);
      expect(Math.round(L5_5_N.batchServed)).toBe(8932);
      expect(L5_5_N.supply.marston.A + L5_5_N.supply.techpark.A).toBe(11000);
    });

    it('loosening and tightening the latency limit', () => {
      expect(L5_5_N.openSame).toBe(true);
      expect([r2(L5_5_N.openA), r2(L5_5_N.openB), r2(L5_5_N.openL)]).toEqual([1.4, 3.6, 0.5]);
      expect(Math.round(L5_5_N.openWelfare - L5_5_N.welfareRef)).toBe(2203);
      expect(Math.round(L5_5_N.tightChatServed)).toBe(63);
      expect([r2(L5_5_N.tightBayA), r2(L5_5_N.tightBayB), r2(L5_5_N.tightTechA)]).toEqual([3.5, 10.5, 0.08]);
      expect(r2(L5_5_N.runCostTechA)).toBe(0.08);
      expect(r2(L5_5_N.tightBayB / L5_5_N.tightBayA)).toBe(3);
      const open = marketAt({ ...MARKET_DEFAULTS, lat: 40 });
      expect(open.allocation.some((a) => a.buyer === 'chat70' && a.site === 'fernhill')).toBe(true);
      expect(marketAt({ ...MARKET_DEFAULTS, lat: 5 }).idle.techpark.A).toBeGreaterThan(0);
    });

    it('building near the users', () => {
      expect([L5_5_N.lastFlatAdd, L5_5_N.firstDropAdd, L5_5_N.matchAdd]).toEqual([100, 125, 350]);
      expect(r2(L5_5_N.firstDropPrice)).toBe(3.25);
      expect(r2(L5_5_N.matchPrice)).toBe(1.52);
      expect(L5_5_N.matchAdd125).toBe(2200);
      expect(marketAt({ ...MARKET_DEFAULTS, addB: 125 }).served.chat70).toBeCloseTo(14000, 3);
      expect(sameEverywhere({ ...MARKET_DEFAULTS, demand: 75 })).toBe(true);
    });

    it('who sets each price', () => {
      const c = marketAt(MARKET_DEFAULTS);
      expect(priceSetter(c, MARKET_DEFAULTS, 'marston', 'B')).toEqual({ kind: 'buyer', id: 'chat70' });
      expect(priceSetter(c, MARKET_DEFAULTS, 'fernhill', 'B')).toEqual({ kind: 'buyer', id: 'batch8' });
      expect(priceSetter(c, MARKET_DEFAULTS, 'fernhill', 'A')).toEqual({ kind: 'chain' });
      expect(r2(worth('chat70', 'B'))).toBe(9);
      expect(r2(worth('frontier400', 'B'))).toBe(13.5);
      expect(r2(worth('code8', 'B'))).toBe(11.88);
      expect(r2((1.4 * productivity('batch8', 'B')) / productivity('train70', 'B'))).toBe(1.52);
      expect(r2(L5_5_N.prodChatB)).toBe(2.57);
      expect(Math.round(L5_5_N.prodTrainB * 1000) / 1000).toBe(2.375);
      expect(r2(L5_5_N.farB / L5_5_N.farA)).toBe(2.37);
      expect(L5_5_N.listRatio).toBe(2);
    });
  });
}

// Chapter 6 engines

{
  describe('yield management', () => {
    const base = { fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, policy: 'first-come' as const, protectB: 0, physics: PHYSICS_DEFAULTS, powerPrice: 55, hours: 168 };
    it('earns more by giving each GPU to the work it does most valuably', () => {
      const fc = yieldRun(base);
      const bv = yieldRun({ ...base, policy: 'best-value' });
      expect(bv.margin).toBeGreaterThan(fc.margin * 1.05);
      expect(bv.served.frontier400).toBeCloseTo(1, 6);
    });

    it('changes with the physics', () => {
      expect(productivityUnder({ ...PHYSICS_DEFAULTS, frontierPrecision: 'bf16' }).frontier400.A).toBe(0);
      const bf16 = yieldRun({ ...base, policy: 'best-value', physics: { ...PHYSICS_DEFAULTS, frontierPrecision: 'bf16' } });
      expect(bf16.margin).toBeLessThan(yieldRun({ ...base, policy: 'best-value' }).margin);
    });
  });

  describe('procurement', () => {
    it('reserves somewhere between nothing and the peak', () => {
      expect(WEEK_SHAPE.length).toBe(168);
      expect(monthOverflow(400, 400)).toBe(0);
      expect(monthNeed(400)).toBeGreaterThan(monthOverflow(400, 0) - 1e-6);
      const best = bestReserved(PROCUREMENT_DEFAULTS);
      expect(best.reserved).toBe(260);
      expect(procure({ ...PROCUREMENT_DEFAULTS, reserved: 0 }).mean).toBeGreaterThan(best.mean);
      expect(procure({ ...PROCUREMENT_DEFAULTS, reserved: 500 }).mean).toBeGreaterThan(best.mean);
    });
  });

  describe('moving work between regions', () => {
    const job = { gpuHours: 100000, gpus: 512, dataInTB: 50, dataOutTB: 5, maxRttMs: Infinity, deadlineHours: 400 };
    const route = { from: 'techpark' as const, to: 'fernhill' as const, priceFrom: 3.5, priceTo: 1.52, linkGbps: 100, egressPerGB: 0.05 };
    it('saves when the price gap beats the cost of moving data', () => {
      expect(transferHours(50, 100)).toBeCloseTo(1.389, 3);
      const m = moveJob(job, route);
      expect(m.feasible).toBe(true);
      expect(m.saving).toBeCloseTo(195250, 0);
      expect(breakEvenDataTB(job, route)).toBeCloseTo(3600, 0);
      expect(moveJob({ ...job, maxRttMs: 30 }, route).feasible).toBe(false);
    });
  });

  describe('power-aware scheduling', () => {
    it('rarely pays to pause, sometimes pays to cap', () => {
      const prices = techParkPrices().flat();
      expect(prices.reduce((a, b) => a + b, 0) / prices.length).toBeCloseTo(54.9, 1);
      expect(gpuGridKW()).toBeCloseTo(1.476, 3);
      const be = breakEvenPrices({ value: 2.4, capShare: 0.7, capAbove: 0, pauseAbove: 0 });
      expect(be.pause).toBeCloseTo(2323, 0);
      expect(be.cap).toBeCloseTo(1316, 0);
      const bt = backtest({ value: 0.95, capShare: 0.7, capAbove: 384, pauseAbove: 920 });
      expect(bt.gain).toBeGreaterThan(0);
      expect(bt.hoursPaused).toBe(6);
    });

    it('fits more GPUs under a fixed connection by capping them', () => {
      const full = powerCapPlan(20, 1);
      const capped = powerCapPlan(20, 0.7);
      expect(full.gpus).toBe(13549);
      expect(capped.work / full.work).toBeCloseTo(1.054, 3);
    });
  });

  describe('capacity contracts', () => {
    it('is profitable on average but risky, and hedging trades return for safety', () => {
      const c = runContract(CONTRACT_DEFAULTS);
      expect(c.mean).toBeCloseTo(1853541, -3);
      expect(c.probLoss).toBeCloseTo(0.217, 3);
      const h = runContract({ ...CONTRACT_DEFAULTS, hedgeShare: 0.5 });
      expect(h.probLoss).toBeLessThan(c.probLoss / 2);
      expect(h.mean).toBeLessThan(c.mean);
      expect(dropFromRatio(4.8, 2.28, 2.4)).toBeCloseTo(0.1228, 4);
    });
  });
}

// Lesson 6.1

{
  const r0 = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 6.1: yield management', () => {
    it('earns most with the best allocation; batch is the workload that waits (challenge a)', () => {
      expect(r0(runYield({ ...YIELD_DEFAULTS, policy: 'best' }).margin)).toBe(938580);
      expect(loserSolved(YIELD_DEFAULTS)).toBe(false);
      expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'batch8' })).toBe(true);
      expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'tune8' })).toBe(false);
      expect(loserSolved({ ...YIELD_DEFAULTS, guessA: 'batch8' })).toBe(false);
    });

    it('finds the L-class’s chat threshold (challenge b)', () => {
      expect(chatThresholdMs()).toBe(38);
      expect(lServesChat(37)).toBe(false);
      expect(lServesChat(38)).toBe(true);
      expect(L6_1_chatMarginSolved({ ...YIELD_DEFAULTS, chatMs: 38, guessB: 'lower' })).toBe(true);
      expect(L6_1_chatMarginSolved({ ...YIELD_DEFAULTS, guessB: 'lower' })).toBe(false);
      expect(L6_1_chatMarginSolved({ ...YIELD_DEFAULTS, chatMs: 38, guessB: 'raise' })).toBe(false);
      // One request alone on eight L-class cards: a little over 37 ms a token.
      const tpot = servingPoint({ model: '70B', gpu: 'L', tp: 8, precision: 'bf16' }, 1, 1000, 300).tpot;
      expect(tpot).toBeGreaterThan(0.037);
      expect(tpot).toBeLessThan(0.038);
    });

    it('quotes the week’s numbers', () => {
      expect(L6_1_N.fleet).toEqual({ L: 300, A: 1200, B: 300 });
      expect(r0(fleetFixedPerWeek(), -3)).toBe(443000);
      expect(r0(L6_1_N.fcMargin)).toBe(876210);
      expect(r0(L6_1_N.fcBatchOnB)).toBe(16908);
      expect(pct(1 - L6_1_N.fcServed.frontier400)).toBe('17%');
      expect(r0(L6_1_N.bestMargin)).toBe(938580);
      expect(r0(L6_1_N.bestGain)).toBe(62370);
      expect(r0(L6_1_N.bestGainShare * 100, 1)).toBe(7.1);
      expect(L6_1_N.bestCodeOnA).toBe(1);
      expect(L6_1_N.bestFrontierOnB).toBe(1);
      expect(r0(L6_1_N.bestServed.code8, 6)).toBe(1);
      expect(r0(L6_1_N.bestServed.frontier400, 6)).toBe(1);
      expect(r0(L6_1_N.bestServed.chat70, 6)).toBe(1);
      expect(r0(L6_1_N.bestServed.batch8 * 100)).toBe(85);
      expect(r0(L6_1_N.fcUtil.A * 100)).toBe(87);
      expect(r0(L6_1_N.bestUtil.A * 100)).toBe(85);
      expect(r0(L6_1_N.bidMargin)).toBe(934144);
      expect(r0(L6_1_N.bidShort)).toBe(4436);
      expect(r0(L6_1_N.fc300Margin)).toBe(885919);
      expect(r0(L6_1_N.fc300Recovered)).toBe(9709);
      expect(r0(L6_1_N.fc300RecoveredShare * 100)).toBe(16);
      expect(r0(L6_1_N.fc300BatchOnA)).toBe(95660);
      expect(pct(1 - L6_1_N.fc300Served.frontier400)).toBe('15%');
    });

    it('quotes the bids and productivities', () => {
      expect(r0(L6_1_N.prodFrontierB, 2)).toBe(3.13);
      expect(r0(L6_1_N.prodTuneB, 2)).toBe(2.28);
      expect(r0(L6_1_N.prodTrainL, 2)).toBe(0.27);
      expect(r0(L6_1_N.bidsB.frontier, 2)).toBe(13.98);
      expect(r0(L6_1_N.bidsB.code, 2)).toBe(11.97);
      expect(r0(L6_1_N.bidsB.chat, 2)).toBe(9.33);
      expect(r0(L6_1_N.bidsB.batch, 2)).toBe(3.4);
      expect(r0(L6_1_N.bidsB.frontier - L6_1_N.bidsB.batch, 2)).toBe(10.58);
      expect(r0(L6_1_N.bidsA.code, 2)).toBe(4.92);
      expect(r0(L6_1_N.bidsA.batch, 2)).toBe(1.32);
      expect(r0(L6_1_N.bidsL.tune, 2)).toBe(0.79);
      expect(r0(L6_1_N.bidsL.chat, 2)).toBe(0.1);
      // Fine-tuning is where the L-class bids most.
      expect(Math.max(L6_1_N.bidsL.code, L6_1_N.bidsL.train, L6_1_N.bidsL.batch, L6_1_N.bidsL.chat)).toBeLessThan(L6_1_N.bidsL.tune);
      const b = referenceBidsB();
      expect(Object.values(b).every((x) => x !== null)).toBe(true);
    });

    it('quotes the physics that changes it', () => {
      expect(r0(L6_1_N.bf16WeightsGB)).toBe(812);
      expect(r0(L6_1_N.bf16UsableAGB)).toBe(576);
      expect(r0(L6_1_N.prodFrontierBBf16, 2)).toBe(1.46);
      expect(r0(L6_1_N.bf16BestMargin)).toBe(894563);
      expect(r0(L6_1_N.bf16Loss)).toBe(44018);
      expect(r0(L6_1_N.bf16FrontierServed * 100)).toBe(95);
      expect(r0(L6_1_N.bf16BidMargin)).toBe(808252);
      expect(r0(L6_1_N.chat20BestMargin)).toBe(923078);
      expect(r0(L6_1_N.prodChatLAt, 3)).toBe(0.018);
      expect(r0(L6_1_N.fcBeforeThreshold)).toBe(876612);
      expect(r0(L6_1_N.fcAtThreshold)).toBe(875481);
      expect(r0(L6_1_N.bestPower)).toBe(19487);
      expect(r0(L6_1_N.power400Cost)).toBe(141726);
      expect(r0(L6_1_N.power400Margin)).toBe(816342);
    });

    it('does most batch work at night under best value', () => {
      const p = productivityUnder(PHYSICS_DEFAULTS).batch8;
      const base = { fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, policy: 'best-value' as const, protectB: 0, physics: PHYSICS_DEFAULTS, powerPrice: 55 };
      let prev = 0;
      let night = 0;
      let all = 0;
      for (let h = 1; h <= 168; h++) {
        const g = yieldRun({ ...base, hours: h }).gpuHours.batch8;
        const cum = g.A * p.A + g.L * p.L + g.B * p.B;
        const hod = (h - 1) % 24;
        if (hod >= 19 || hod < 7) night += cum - prev;
        all += cum - prev;
        prev = cum;
      }
      expect(night / all).toBeGreaterThan(0.55);
    });

    it('splits revenue by workload consistently', () => {
      const rev = revenueByWorkload({ ...YIELD_DEFAULTS, policy: 'best-value' });
      const total = Object.values(rev).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(runYield({ ...YIELD_DEFAULTS, policy: 'best-value' }).revenue, 3);
    });
  });
}

// Lesson 6.2

{
  const r0 = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('procurement sweep (procurementSweep.ts)', () => {
    it('computes the same overflow as monthOverflow', () => {
      for (const peak of [100, 400, 777.7])
        for (const res of [0, 50, 260, 399.9, 400, 900]) expect(fastOverflow(peak, res)).toBeCloseTo(monthOverflow(peak, res), 6);
    });

    it('draws the same years as procure and agrees with it at every level', () => {
      const p = PROCUREMENT_DEFAULTS;
      expect(growthPaths(p).length).toBe(p.scenarios);
      for (const params of [p, { ...p, growth: 0.08, sigma: 0.12 }, { ...p, sigma: 0 }]) {
        const levels = [0, 130, 260, 300, 550, 800];
        const sweep = procurementSweep(params, levels);
        levels.forEach((res, i) => {
          const full = procure({ ...params, reserved: res });
          expect(sweep[i].mean / full.mean).toBeCloseTo(1, 9);
          expect(sweep[i].p95 / full.p95).toBeCloseTo(1, 9);
        });
      }
      const full = procure(p);
      expect(meanFirmHours(p) + p.interruptible * 730 * p.months).toBeCloseTo((full.mean * p.scenarios) / (full.perUsefulHour * p.scenarios), 0);
    });

    it('is fast enough to redraw the curve', () => {
      const t = performance.now();
      procurementSweep({ ...PROCUREMENT_DEFAULTS, growth: 0.071 }, Array.from({ length: 81 }, (_, i) => i * 10));
      expect(performance.now() - t).toBeLessThan(100);
    });
  });

  describe('lesson 6.2 challenges', () => {
    it('a: the reservation that makes a bad year cheapest', () => {
      const b = bestOf(PLAN_DEFAULTS.growth, PLAN_DEFAULTS.sigma);
      expect(b.mean.reserved).toBe(260);
      expect(b.p95.reserved).toBe(300);
      // Solved by predicting “right of 260” and then finding the bottom of the bad-year curve.
      const right = { ...PLAN_DEFAULTS, guess: 'right' as const };
      expect(badYearSolved(PLAN_DEFAULTS)).toBe(false);
      expect(badYearSolved({ ...right, reserved: 300 })).toBe(true);
      expect(badYearSolved({ ...right, reserved: 290 })).toBe(true);
      expect(badYearSolved({ ...right, reserved: 310 })).toBe(true);
      expect(badYearSolved({ ...right, reserved: 260 })).toBe(false);
      expect(badYearSolved({ ...right, reserved: 330 })).toBe(false);
      expect(badYearSolved({ ...right, reserved: 300, sigma: 6 })).toBe(false);
      expect(badYearSolved({ ...PLAN_DEFAULTS, reserved: 300 })).toBe(false);
      expect(badYearSolved({ ...PLAN_DEFAULTS, guess: 'left', reserved: 300 })).toBe(false);
      // The sweep the chart draws agrees with the plan the readouts show.
      const pt = sweepOf(PLAN_DEFAULTS.growth, PLAN_DEFAULTS.sigma).find((x) => x.reserved === 300)!;
      expect(pt.p95 / planOf({ ...PLAN_DEFAULTS, reserved: 300 }).p95).toBeCloseTo(1, 9);
      expect(paramsOf(PLAN_DEFAULTS).growth).toBeCloseTo(0.04, 12);
    });

    it('b: the highest reclaim rate at which the pretraining run’s spot hours beat reserving', () => {
      expect(WIDE_ANSWER).toBeCloseTo(0.75, 9);
      const t = JOBS.train70;
      expect(spotBeatsReserved(t, 0.75, 10)).toBe(true);
      expect(spotBeatsReserved(t, 0.8, 10)).toBe(false);
      expect(wideSolved({ reclaims: 0.75, restart: 10 })).toBe(true);
      expect(wideSolved({ reclaims: 0.7, restart: 10 })).toBe(false);
      expect(wideSolved({ reclaims: 0.8, restart: 10 })).toBe(false);
      expect(wideSolved({ reclaims: 0.75, restart: 9 })).toBe(false);
      expect(wideSolved(L6_2_SPOT_DEFAULTS)).toBe(false);
      // Floating-point slider values still land on the grid.
      expect(wideSolved({ reclaims: 0.7500000000000001, restart: 10 })).toBe(true);
    });
  });

  describe('lesson 6.2 numbers', () => {
    it('the plan', () => {
      expect(r0(L6_2_N.averageHourNow)).toBe(262);
      expect(r0(L6_2_N.finalPeak)).toBe(614);
      // The plan covers the firm need only (the interruptible work is the spot section's).
      expect(r0(L6_2_N.allOnDemandMean / 1e6, 2)).toBe(6.88);
      expect(r0(L6_2_N.allOnDemandP95 / 1e6, 2)).toBe(8.02);
      expect(L6_2_N.bestMeanReserved).toBe(260);
      expect(r0(L6_2_N.bestMeanMean / 1e6, 2)).toBe(5.41);
      expect(r0(L6_2_N.bestMeanP95 / 1e6, 2)).toBe(6.4);
      expect(L6_2_N.bestP95Reserved).toBe(300);
      expect(r0(L6_2_N.bestP95P95 / 1e6, 2)).toBe(6.34);
      expect(r0(L6_2_N.bestP95Mean / 1e6, 2)).toBe(5.46);
      expect(r0(L6_2_N.bestP95Mean - L6_2_N.bestMeanMean)).toBe(48603);
      expect(r0(L6_2_N.bestMeanP95 - L6_2_N.bestP95P95)).toBe(54838);
      expect(r0(L6_2_N.bestP95Idle * 100)).toBe(11);
      expect(r0(L6_2_N.bestMeanIdle * 100)).toBe(6);
      expect(r0(L6_2_N.r500Mean / 1e6, 2)).toBe(7.12);
      expect(L6_2_N.r500Mean).toBeGreaterThan(L6_2_N.allOnDemandMean);
      expect(r0(L6_2_N.maxCheapest / 1e6, 2)).toBe(11.21);
      expect(r0(L6_2_N.maxDearest / 1e6, 2)).toBe(11.32);
      expect(L6_2_N.calmBest).toBe(270);
      expect(L6_2_N.calmBestP95).toBe(270);
      expect(L6_2_N.wildBestMean).toBe(250);
      expect(L6_2_N.wildBestP95).toBe(340);
      // Faster growth moves both best reservations right.
      const fast = bestOf(8, 5);
      expect(fast.mean.reserved).toBeGreaterThan(260);
      expect(fast.p95.reserved).toBeGreaterThan(300);
    });

    it('spot', () => {
      expect(r0(L6_2_N.tuneCost, 2)).toBe(1.03);
      expect(L6_2_N.tuneInterval).toBe(17);
      expect(r0(L6_2_N.tuneCross, 1)).toBe(18.5);
      expect([L6_2_N.tuneGpus, L6_2_N.tuneServers, L6_2_N.trainGpus, L6_2_N.trainServers]).toEqual([10, 2, 304, 38]);
      expect(r0(L6_2_N.trainTwo, 2)).toBe(7.04);
      expect(r0(L6_2_N.trainCross, 2)).toBe(0.77);
      expect(r0(L6_2_N.trainCross * L6_2_N.trainServers)).toBe(29);
      expect(r0(L6_2_N.reservedYear / 1e6, 2)).toBe(1.4);
      expect(r0(L6_2_N.tuneSpotYear / 1e6, 2)).toBe(0.9);
      expect(bestSpot(JOBS.tune8, 2, 10).interruptionsPerDay).toBe(4);
    });
  });
}

// Lesson 6.3

{
  const r0 = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('regionSchedule.ts: a day of jobs on one link', () => {
    const route = { from: 'techpark' as const, to: 'fernhill' as const, priceFrom: 3.5, priceTo: 1.5158, linkGbps: 100, egressPerGB: 0.05 };
    it('moves the jobs that pay, keeps the rest home with a reason', () => {
      const d = scheduleDay(DAY_JOBS, route);
      const why = Object.fromEntries(d.rows.map((r) => [r.job.id, r.why]));
      expect(why).toEqual({
        pretrain: 'moves',
        embed: 'moves',
        batch: 'moves',
        tune: 'moves',
        eval: 'moves',
        video: 'costs more to move',
        chat: 'too far from users',
        code: 'too far from users',
      });
    });

    it('queues copies least slack first and respects the link’s day', () => {
      const d = scheduleDay(DAY_JOBS, { ...route, linkGbps: 40 });
      const start = Object.fromEntries(d.rows.map((r) => [r.job.id, r.copyStart]));
      expect(start.batch).toBe(0);
      expect(start.tune).toBeGreaterThan(0);
      expect(start.pretrain).toBeGreaterThan(start.embed);
      for (const r of d.rows) if (r.decision === 'move') expect(r.copyStart + r.linkHours + r.result.runH).toBeLessThanOrEqual(r.job.deadlineHours + 1e-9);
      expect(d.linkHours).toBeLessThanOrEqual(24);
      const slow = scheduleDay(DAY_JOBS, { ...route, linkGbps: 1 });
      expect(slow.rows.find((r) => r.job.id === 'pretrain')!.why).toBe('link busy');
    });

    it('agrees with moveJob for a job alone', () => {
      const d = scheduleDay([DAY_JOBS[0]], route);
      expect(d.saving).toBeCloseTo(moveJob(DAY_JOBS[0], route).saving, 6);
    });
  });

  describe('lesson 6.3: prices and the first demonstration', () => {
    it('takes Lesson 5.5’s prices from the latency limit', () => {
      expect(r0(L6_3_N.near, 2)).toBe(3.5);
      expect(r0(L6_3_N.far, 2)).toBe(1.52);
      expect(r0(L6_3_N.gap, 2)).toBe(1.98);
      expect(r0(marketAtLatency(39).prices.fernhill.A, 2)).toBe(1.52);
      expect(r0(L6_3_N.open, 2)).toBe(1.4);
      expect(r0(L6_3_N.openFar, 2)).toBe(1.4);
      expect(routeOf(JOB_DEFAULTS).linkGbps).toBe(100);
    });

    it('quotes the pretraining slice', () => {
      expect(DATA_TB[defaultData('pretrain')]).toBe(50);
      expect(jobOf(JOB_DEFAULTS).dataOutTB).toBeCloseTo(5, 9);
      expect([L6_3_N.preGpuHours, L6_3_N.preGpus, L6_3_N.preIn, r0(L6_3_N.preOut)]).toEqual([100000, 512, 50, 5]);
      expect(r0(L6_3_N.preRunH / 24)).toBe(8);
      expect(L6_3_N.preStay).toBeCloseTo(350000, 6);
      expect(r0(L6_3_N.preMoveGpu)).toBe(151579);
      expect(r0(L6_3_N.preEgress)).toBe(2750);
      expect(r0(L6_3_N.preSaving)).toBe(195671);
      expect(r0(L6_3_N.preCopyH, 1)).toBe(1.5);
      expect(r0(L6_3_N.preBreakEven / 1000, 1)).toBe(3.6);
      expect(L6_3_N.preBreakEven / L6_3_N.preIn).toBeGreaterThan(70);
      expect(r0(L6_3_N.preOpenSaving)).toBe(-2750);
    });

    it('challenge a: at 10¢ per GB, 1,000 TB is the largest dataset on the slider that still saves', () => {
      // At the starting 5¢ it would be 3,000 TB; doubling the fee halves the break-even.
      expect(L6_3_N.preBestTB).toBe(3000);
      expect(L6_3_N.feeBestTB).toBe(1000);
      expect(L6_3_N.feeNextTB).toBe(2000);
      expect(L6_3_N.feeBestSaving).toBeGreaterThan(0);
      expect(L6_3_N.feeNextSaving).toBeLessThan(0);
      const at10 = { ...JOB_DEFAULTS, egress: 10 };
      expect(largestSolved({ ...at10, data: DATA_TB.indexOf(1000) })).toBe(true);
      expect(largestSolved(JOB_DEFAULTS)).toBe(false);
      expect(largestSolved(at10)).toBe(false);
      expect(largestSolved({ ...at10, data: DATA_TB.indexOf(500) })).toBe(false);
      expect(largestSolved({ ...at10, data: DATA_TB.indexOf(2000) })).toBe(false);
      expect(largestSolved({ ...JOB_DEFAULTS, data: DATA_TB.indexOf(3000) })).toBe(false);
      expect(largestSolved({ ...at10, data: DATA_TB.indexOf(1000), lat: 40 })).toBe(false);
    });

    it('quotes the services and the overnight batch', () => {
      expect(runJob({ ...JOB_DEFAULTS, job: 'chat', data: 0 }).feasible).toBe(false);
      expect(L6_3_N.chatSaving).toBeCloseTo(14400 * L6_3_N.gap, 6);
      expect(r0(L6_3_N.chatSaving)).toBe(28573);
      expect(r0(L6_3_N.batchIn)).toBe(33);
      expect(r0(L6_3_N.batchRunH, 1)).toBe(8);
      expect(L6_3_N.batchDeadline).toBe(12);
      expect(r0(L6_3_N.batchCopy10, 1)).toBe(9.2);
      expect(L6_3_N.batchSlowestLink).toBe(25);
      expect(r0(L6_3_N.batchSaving)).toBe(6287);
    });
  });

  describe('lesson 6.3: the day of jobs', () => {
    it('quotes the day', () => {
      expect(L6_3_N.dayMoved).toBe(5);
      expect(r0(L6_3_N.daySaving)).toBe(209585);
      expect(r0(L6_3_N.dayStay)).toBe(461650);
      expect(r0((L6_3_N.daySaving / L6_3_N.dayStay) * 100)).toBe(45);
      expect(r0(L6_3_N.dayLinkH, 1)).toBe(6.9);
      expect(r0(L6_3_N.videoGapSaving)).toBe(3968);
      expect(r0(L6_3_N.videoEgress)).toBe(20200);
      expect(L6_3_N.videoTB).toBe(404);
      expect(r0(L6_3_N.embedSaving)).toBe(3905);
      expect(L6_3_N.highFeeMoved).toBe(4);
      expect(L6_3_N.daySlowMoved).toBe(3);
      expect(r0(L6_3_N.daySlowSaving)).toBe(199393);
      expect(L6_3_N.day1Moved).toBe(2);
      expect(r0(L6_3_N.day1Saving)).toBe(3721);
      const slow = dayOf({ ...DAY_DEFAULTS, link: LINKS.indexOf(10) });
      expect(slow.rows.find((r) => r.job.id === 'batch')!.why).toBe('misses its deadline');
      expect(slow.rows.find((r) => r.job.id === 'pretrain')!.decision).toBe('move');
    });

    it('challenge b: 40 Gb/s is the slowest link that moves every job worth moving', () => {
      expect(L6_3_N.slowestAllLink).toBe(40);
      expect(worthMoving(DAY_DEFAULTS).sort()).toEqual(['batch', 'embed', 'eval', 'pretrain', 'tune']);
      expect(L6_3_slowestSolved({ ...DAY_DEFAULTS, link: LINKS.indexOf(40) })).toBe(true);
      expect(L6_3_slowestSolved(DAY_DEFAULTS)).toBe(false);
      expect(L6_3_slowestSolved({ ...DAY_DEFAULTS, link: LINKS.indexOf(25) })).toBe(false);
      // With the assistants able to reach Fernhill nothing is worth moving, so nothing solves it.
      expect(worthMoving({ ...DAY_DEFAULTS, lat: 40 })).toEqual([]);
      expect(LINKS.some((_, i) => L6_3_slowestSolved({ ...DAY_DEFAULTS, lat: 40, link: i }))).toBe(false);
    });
  });
}

// Lesson 6.4

{
  const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 6.4: power-aware scheduling', () => {
    it('quotes the size of the electricity bill', () => {
      expect(r(L6_4_N.meanPrice)).toBe(55);
      expect(L6_4_N.maxPrice).toBeGreaterThan(2000);
      expect(r(L6_4_N.maxPrice)).toBe(2178);
      expect(r(L6_4_N.kw, 2)).toBe(1.48);
      expect(r(L6_4_N.meanEnergy, 3)).toBe(0.081);
      expect(r(L6_4_N.meanShare * 100, 1)).toBe(3.4);
      expect(r(L6_4_N.valueToEnergy)).toBe(30);
      expect(r(L6_4_N.costPowerShare * 100, 1)).toBe(4.1);
      expect(r(L6_4_N.speed70 * 100)).toBe(82);
    });

    it('prices the spike hour three ways', () => {
      expect(r(L6_4_N.spikeEnergy, 2)).toBe(3.22);
      expect(r(-L6_4_N.spikeNetFull, 2)).toBe(0.82);
      expect(r(-L6_4_N.spikeNetPause, 2)).toBe(0.96);
      expect(r(-L6_4_N.spikeNetCap, 2)).toBe(0.53);
      expect(r(L6_4_N.cap240)).toBe(1316);
      expect(r(L6_4_N.pause240)).toBe(2323);
      expect(r(L6_4_N.cap095)).toBe(521);
      expect(r(L6_4_N.pause095)).toBe(919);
    });

    it('backtests the policy over the history', () => {
      expect([L6_4_N.run240.hoursCapped, L6_4_N.run240.hoursPaused, r(L6_4_N.run240.gain, 2), r(L6_4_N.run240.energyFlat, 2)]).toEqual([6, 0, 1.69, 233.43]);
      expect([L6_4_N.run095.hoursCapped, L6_4_N.run095.hoursPaused, r(L6_4_N.run095.gain, 2)]).toEqual([1, 6, 7.84]);
      expect(r(L6_4_N.run095.energyFlat - L6_4_N.run095.energyPolicy, 2)).toBe(13.71);
      expect(r(L6_4_N.run025.gain, 2)).toBe(13.95);
      expect(r(L6_4_N.run095.gain * 1000)).toBe(7844);
      expect(r(L6_4_N.fleet120Cost / 1e6, 1)).toBe(4.5);
    });

    it('runs the default day', () => {
      const d = L6_4_N.dayDefault;
      expect(d.hours.filter((h) => h.mode === 'capped').length).toBe(3);
      expect(d.hours.filter((h) => h.mode === 'paused').length).toBe(0);
      expect(r(d.energyFlat - d.energyPolicy, 2)).toBe(2.13);
      expect(r(d.workLost, 2)).toBe(1.29);
      expect(r(d.gain, 2)).toBe(0.84);
      expect(dayRun(L6_4_DAY_DEFAULTS).gain).toBeCloseTo(d.gain, 9);
    });

    it('quotes deferrable work', () => {
      expect(r(L6_4_N.defer.shifted, 2)).toBe(1.07);
      expect(r(L6_4_N.defer.asap, 2)).toBe(1.32);
      expect(r((L6_4_N.defer.saving / L6_4_N.defer.asap) * 100)).toBe(19);
      expect(r(L6_4_N.defer.saving, 2)).toBe(0.25);
    });

    it('solves challenge a only at $2.25', () => {
      expect(PAUSE_VALUE_ANSWER).toBe(2.25);
      expect(pauseValueSolved(2.25)).toBe(true);
      expect(pauseValueSolved(2.2)).toBe(false);
      expect(pauseValueSolved(2.3)).toBe(false);
      expect(pauseValueSolved(L6_4_DAY_DEFAULTS.value)).toBe(false);
      expect(policyOf(2.25, 70).pauseAbove).toBeLessThan(L6_4_N.maxPrice);
      expect(policyOf(2.3, 70).pauseAbove).toBeGreaterThan(L6_4_N.maxPrice);
      // Only one grid value solves it.
      let count = 0;
      for (let v = VALUE_MIN; v <= VALUE_MAX + 1e-9; v = Math.round((v + VALUE_STEP) * 100) / 100) if (pauseValueSolved(v)) count++;
      expect(count).toBe(1);
    });

    it('quotes the hall under a fixed connection', () => {
      expect(L6_4_N.full.running).toBe(13549);
      expect(L6_4_N.full.dark).toBe(6451);
      expect(L6_4_N.at70.running).toBe(17395);
      expect(r(L6_4_N.at70.work)).toBe(14283);
      expect(r((L6_4_N.at70.work / L6_4_N.full.work - 1) * 100, 1)).toBe(5.4);
      expect(L6_4_N.bestCap).toBe(57);
      expect(L6_4_N.atBest.running).toBe(19834);
      expect(r(L6_4_N.atBest.work)).toBe(14471);
      expect(r((L6_4_N.atBest.work / L6_4_N.full.work - 1) * 100, 1)).toBe(6.8);
      expect(L6_4_N.allFitCap).toBe(L6_4_N.bestCap - 1);
      expect(r(L6_4_N.atAllFit.work)).toBe(14442);
      expect(L6_4_N.extraGpus).toBe(3846);
      expect(r(L6_4_N.extraWork)).toBe(734);
      expect(r(L6_4_N.gpuYear)).toBe(13607);
    });

    it('gains nothing from capping if speed fell in step with power', () => {
      const full = hallRun(CHALLENGE_OWNED, 100, true).work;
      for (const c of [95, 85, 75, 68]) expect(hallRun(CHALLENGE_OWNED, c, true).work).toBeLessThanOrEqual(full + 1);
    });

    it('solves challenge b only at the best cap', () => {
      expect(bestCap(CHALLENGE_OWNED)).toBe(57);
      expect(capSolved(L6_4_HALL_DEFAULTS)).toBe(false);
      expect(capSolved({ ...L6_4_HALL_DEFAULTS, cap: 57 })).toBe(true);
      expect(capSolved({ ...L6_4_HALL_DEFAULTS, cap: 56 })).toBe(false);
      expect(capSolved({ ...L6_4_HALL_DEFAULTS, cap: 58 })).toBe(false);
      expect(capSolved({ ...L6_4_HALL_DEFAULTS, cap: 57, linear: true })).toBe(false);
      expect(capSolved({ ...L6_4_HALL_DEFAULTS, cap: 57, owned: 21000 })).toBe(false);
    });

    it('backtests fast enough at the slowest settings', () => {
      let worst = 0;
      for (const cap of [50, 75, 95]) {
        const t = performance.now();
        historyRun(VALUE_MIN, cap);
        worst = Math.max(worst, performance.now() - t);
      }
      expect(worst).toBeLessThan(60);
    });
  });
}

// Lesson 6.5

{
  describe('contract paths (contractPaths.ts)', () => {
    it('replays exactly the draws of runContract', () => {
      for (const c of [CONTRACT_DEFAULTS, { ...CONTRACT_DEFAULTS, hedgeShare: 0.4, bArrival: 3, failureShare: 0.06 }]) {
        const npvs = contractPaths(c)
          .map((p) => p.npv)
          .sort((a, b) => a - b);
        const ref = runContract(c).npvs;
        expect(npvs.length).toBe(ref.length);
        for (let i = 0; i < ref.length; i += 37) expect(npvs[i]).toBeCloseTo(ref[i], 4);
      }
      const ranked = rankedPaths(CONTRACT_DEFAULTS);
      expect(ranked[0].npv).toBeLessThanOrEqual(ranked[1].npv);
      expect(ranked[0].quarters.length).toBe(12);
    });

    it('breaks even where resold hours cover the contract', () => {
      expect(breakEvenMarketPrice(CONTRACT_DEFAULTS)).toBeCloseTo(1.3 / (0.8 * 0.97), 9);
    });
  });

  describe('lesson 6.5: the contract desk', () => {
    it('starts from the engine’s defaults, with the drop from chat’s 2.69 A-class GPUs’ work', () => {
      const p = L6_5_paramsOf(DESK_DEFAULTS);
      expect(p.contractPrice).toBe(1.3);
      expect(p.bArrival).toBe(5);
      expect(DESK_DEFAULTS.ratio).toBe(2.69);
      expect(p.bDrop).toBeCloseTo(0.2565, 4);
    });

    it('challenge a: the highest unhedged price at which the 5th-percentile path doesn’t lose', () => {
      expect(priceSolved(DESK_DEFAULTS)).toBe(false);
      expect(L6_5_N.priceAnswer).toBe(1.15);
      expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15 })).toBe(true);
      expect(priceSolved({ ...DESK_DEFAULTS, price: 1.14 })).toBe(false);
      expect(priceSolved({ ...DESK_DEFAULTS, price: 1.16 })).toBe(false);
      expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15, hedge: 5 })).toBe(false);
      expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15, resale: 81 })).toBe(false);
    });

    it('challenge b: the smallest forward sale that keeps the 5th percentile from losing', () => {
      expect(hedgeSolved(DESK_DEFAULTS)).toBe(false);
      expect(L6_5_N.hedgeAnswer).toBe(60);
      expect(hedgeSolved({ ...DESK_DEFAULTS, hedge: 60 })).toBe(true);
      expect(hedgeSolved({ ...DESK_DEFAULTS, hedge: 55 })).toBe(false);
      expect(hedgeSolved({ ...DESK_DEFAULTS, hedge: 65 })).toBe(false);
      // The question fixes the prices and the world: other routes to a safe 5th percentile don't count.
      expect(hedgeSolved({ ...DESK_DEFAULTS, price: 1.15 })).toBe(false);
      expect(hedgeSolved({ ...DESK_DEFAULTS, resale: 95 })).toBe(false);
      expect(hedgeSolved({ ...DESK_DEFAULTS, price: 1.21, hedge: 25 })).toBe(false);
    });

    it('challenge c: the worst path that still makes money', () => {
      const first = firstProfitableRank(DESK_DEFAULTS);
      expect(first).toBe(L6_5_N.firstProfitable);
      expect(pathSolved(DESK_DEFAULTS, first)).toBe(true);
      expect(pathSolved(DESK_DEFAULTS, first - 1)).toBe(false);
      expect(pathSolved(DESK_DEFAULTS, 51)).toBe(false);
      expect((first - 1) / 1000).toBeCloseTo(deskRun(DESK_DEFAULTS).probLoss, 9);
    });

    it('quotes these numbers', () => {
      const m = (x: number) => Math.round(x / 1e4) / 100;
      const p = (x: number, d = 1) => Math.round(x * 100 * 10 ** d) / 10 ** d;
      expect(L6_5_N.gpus).toBe(512);
      expect(L6_5_N.quarters).toBe(12);
      expect(L6_5_N.startPrice).toBe(2.4);
      expect(L6_5_N.bPrice).toBe(4.8);
      expect(Math.round(L6_5_N.aAfter * 100) / 100).toBe(1.78);
      expect(p(L6_5_N.drop, 0)).toBe(26);
      expect(m(L6_5_N.mean)).toBe(1.79);
      expect(m(L6_5_N.sd)).toBe(2.3);
      expect(p(L6_5_N.withinSd, 0)).toBe(68);
      expect(m(L6_5_N.worst)).toBe(-3.6);
      expect(m(L6_5_N.best)).toBe(11.57);
      expect(m(L6_5_N.p5)).toBe(-1.68);
      expect(p(L6_5_N.probLoss)).toBe(22.6);
      expect(Math.round(L6_5_N.breakEven * 100) / 100).toBe(1.68);
      expect(L6_5_N.medianBelowQuarter).toBe(7);
      expect(Math.round(L6_5_N.medianLast * 100) / 100).toBe(1.39);
      expect(p(L6_5_N.early)).toBe(45.8);
      expect(p(L6_5_N.never)).toBe(3.2);
      expect(L6_5_N.ratioFrontier).toBe(3.13);
      expect(p(L6_5_N.ratioFrontierDrop, 0)).toBe(36);
      expect(p(L6_5_N.ratioFrontierLoss)).toBe(38.9);
      expect(Math.round(L6_5_N.ratioArith * 100) / 100).toBe(2.28);
      expect(p(L6_5_N.arithLoss)).toBe(9.3);
      expect(p(L6_5_N.fail10Loss)).toBe(41.8);
      expect(p(L6_5_N.resale70Loss)).toBe(60.3);
      expect(p(L6_5_N.resale90Loss)).toBe(5);
      expect(p(L6_5_N.priceAnswerLoss)).toBe(4.1);
      expect(m(L6_5_N.priceAnswerMean)).toBe(3.52);
      expect(Math.round(L6_5_N.ownerCost * 100) / 100).toBe(1.55);
      expect(m(L6_5_N.hedge50Mean)).toBe(1.51);
      expect(p(L6_5_N.hedge50Loss)).toBe(8.2);
      expect(m(L6_5_N.hedge100)).toBe(1.23);
      expect(m(L6_5_N.hedgeAnswerP5)).toBe(0.07);
      expect(m(L6_5_N.hedgeBelowP5)).toBe(-0.08);
      expect(m(L6_5_N.hedgeAnswerMean)).toBe(1.45);
      expect(p(L6_5_N.hedgeAnswerLoss)).toBe(3.9);
      expect(L6_5_N.firstProfitable).toBe(227);
    });
  });
}

// Chapter 7 engines
{
  describe('capstone cloud', () => {
    it('evaluates the starting fleet with chapter 4’s engines', () => {
      const ev = evaluateFleet(FLEET_DEFAULT);
      expect(ev.total).toBe(1536);
      expect(ev.racks).toBe(47);
      expect(ev.itMW).toBeCloseTo(1.789, 3);
      expect(ev.checks.every((c) => c.ok)).toBe(true);
      expect(ev.fixedPerYear / 1e6).toBeCloseTo(19.92, 2);
      const hot = evaluateFleet({ ...FLEET_DEFAULT, supplyC: 35 });
      expect(hot.speed.B).toBeLessThan(1);
      expect(hot.checks.find((c) => c.id === 'cooling')!.ok).toBe(false);
      expect(evaluateFleet({ ...FLEET_DEFAULT, site: 'marston', gpus: { L: 0, A: 12000, B: 4000 } }).checks.find((c) => c.id === 'grid')!.ok).toBe(false);
    });

    it('prices customers’ work per unit and sells to those who value it', () => {
      expect(buyShare(CUSTOMERS_DEFAULT[0], 3.5)).toBeCloseTo(0.5, 6);
      const off = offers(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, fleetProductivity(FLEET_DEFAULT));
      expect(off.every((o) => o.gpu === 'B')).toBe(true);
      expect(off[0].price).toBeCloseTo(4.8 / 2.69, 1);
      const far = offers(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, { ...FLEET_DEFAULT, site: 'fernhill' });
      expect(far.find((o) => o.customer.workload === 'code8')!.share).toBe(0);
    });

    it('commits reserved GPUs and runs a week', () => {
      const ctx = prepare(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT);
      const c = commitments(ctx);
      expect(c.list.length).toBeGreaterThan(0);
      const fc = operate(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, OPS_DEFAULT);
      const tiered = operate(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, { ...OPS_DEFAULT, policy: 'tiered' });
      expect(tiered.profit).toBeGreaterThan(fc.profit);
      expect(tiered.utilization.B).toBeCloseTo(1, 3);
      const noL = operate(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, { ...FLEET_DEFAULT, gpus: { L: 0, A: 1024, B: 256 } }, { ...OPS_DEFAULT, policy: 'tiered' });
      expect(noL.profit).toBeGreaterThan(tiered.profit + 20000);
    });

    it('simulates three years', () => {
      const b = simulateBusiness(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, { ...OPS_DEFAULT, policy: 'tiered' }, WORLD_DEFAULT);
      expect(b.npvs.length).toBe(WORLD_DEFAULT.paths);
      expect(b.probLoss).toBeGreaterThan(0.1);
      const better = simulateBusiness(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, { ...FLEET_DEFAULT, gpus: { L: 0, A: 768, B: 384 } }, { ...OPS_DEFAULT, policy: 'tiered' }, WORLD_DEFAULT);
      expect(better.riskAdjusted).toBeGreaterThan(b.riskAdjusted);
    });

    it('repairs stored designs', () => {
      const d = defaultCloud();
      expect(sanitize(JSON.parse(JSON.stringify(d, (_, v) => (v === Infinity ? null : v))))).toEqual(d);
      expect(sanitize({ v: 1, fleet: { site: 'mars', gpus: { A: -5 } } }).fleet.site).toBe('techpark');
      expect(sanitize(null)).toEqual(d);
    });
  });
}

// Lesson 7.1
{
  describe('lesson 7.1: the GPU Cloud Builder', () => {
    it('quotes the starting fleet', () => {
      expect(L7_1_N.total).toBe(1536);
      expect(L7_1_N.racks).toBe(47);
      expect(L7_1_N.itMW).toBeCloseTo(1.79, 2);
      expect(L7_1_N.gridPeak).toBeCloseTo(2.5, 1);
      expect(L7_1_N.gridMW).toBe(60);
      expect(L7_1_N.pue).toBeCloseTo(1.28, 2);
      expect(L7_1_N.capex / 1e6).toBeCloseTo(77.4, 1);
      expect(L7_1_N.fixedYear / 1e6).toBeCloseTo(19.9, 1);
      expect(L7_1_N.fixedHour).toBeCloseTo(1.48, 2);
      expect(fixedPerGpuHour(FLEET_DEFAULT)).toBeCloseTo(L7_1_N.fixedHour, 9);
      expect(L7_1_N.powerHour.A).toBeCloseTo(0.082, 3);
      expect(allChecksPass(FLEET_DEFAULT)).toBe(true);
      expect(racksByClass(FLEET_DEFAULT)).toEqual({ L: 4, A: 32, B: 11 });
    });

    it('quotes the other sites and the hot coolant', () => {
      expect(L7_1_N.bayPue).toBeCloseTo(1.32, 2);
      expect(L7_1_N.bayFixed / 1e6).toBeCloseTo(20.6, 1);
      expect(L7_1_N.nfPue).toBeCloseTo(1.22, 2);
      expect(L7_1_N.nfFixed / 1e6).toBeCloseTo(19.7, 1);
      expect(Math.round(L7_1_N.hotSpeedB * 100)).toBe(95);
      expect(evalOf({ ...FLEET_DEFAULT, supplyC: 35 }).checks.find((c) => c.id === 'cooling')!.ok).toBe(false);
    });

    it('quotes the network limits', () => {
      expect(L7_1_N.bigTotal).toBe(2560);
      expect(L7_1_N.bigNetworkOk).toBe(false);
      expect(L7_1_N.bigPortsOk).toBe(true);
      expect(Math.round(L7_1_N.bigPortsShare * 100)).toBe(60);
      expect(L7_1_N.bigPortsTraining).toBe(1);
      expect(L7_1_N.big48Share).toBeCloseTo(1 / 3, 9);
      expect(Math.round(L7_1_N.big48Training * 100)).toBe(86);
    });

    it('solves the challenge only at Marston, within 60 racks, with the chat capacity and every check', () => {
      expect(L7_1_marstonSolved(FLEET_DEFAULT)).toBe(false);
      expect(L7_1_marstonSolved({ ...FLEET_DEFAULT, site: 'marston' })).toBe(false); // passes, but too little chat
      expect(L7_1_marstonSolved(EXAMPLE_ANSWER)).toBe(true);
      expect(L7_1_N.exOk).toBe(true);
      expect(L7_1_N.exRacks).toBe(28);
      expect(Math.round(L7_1_N.exChat)).toBe(6032);
      expect(L7_1_N.exGridPeak).toBeCloseTo(4.0, 1);
      expect(L7_1_N.exAirRacks).toBe(94);
      // The same answer at Tech Park, or with too few ports for 2,240 GPUs, fails.
      expect(L7_1_marstonSolved({ ...EXAMPLE_ANSWER, site: 'techpark' })).toBe(false);
      expect(L7_1_marstonSolved({ ...EXAMPLE_ANSWER, downPorts: 34 })).toBe(false);
      // Air can't do it: three B-class servers per rack.
      expect(rackConfig({ gpu: 'B', cooling: 'air', servers: 0, feedKW: 140 }).maxServers).toBe(3);
      expect(rackConfig({ gpu: 'B', cooling: 'liquid', servers: 0, feedKW: 140 }).maxServers).toBe(10);
      for (const feed of [17, 30, 40, 60, 100, 140]) {
        const airMax = { ...FLEET_DEFAULT, site: 'marston' as const, feedKW: feed, gpus: { L: 0, A: 0, B: 1440 }, downPorts: 63 };
        expect(capacityOf(airMax).chat70).toBeLessThan(CHAT_TARGET);
      }
      // Liquid A-class alone can't either: 60 racks × 80 GPUs.
      const allA = { ...FLEET_DEFAULT, site: 'marston' as const, cooling: 'liquid' as const, feedKW: 140, gpus: { L: 0, A: MARSTON_RACKS * 80, B: 0 }, downPorts: 63 };
      expect(evalOf(allA).racks).toBe(MARSTON_RACKS);
      expect(capacityOf(allA).chat70).toBeLessThan(CHAT_TARGET);
      // A smaller liquid feed still works with more racks.
      expect(L7_1_marstonSolved({ ...EXAMPLE_ANSWER, feedKW: 60 })).toBe(true);
      expect(L7_1_marstonSolved({ ...EXAMPLE_ANSWER, gpus: { L: 0, A: 0, B: 2176 } })).toBe(false);
    });

    it('quotes the capacities and the customers’ demand', () => {
      expect(Math.round(L7_1_N.capChat)).toBe(1724);
      expect(Math.round(L7_1_N.capTrain)).toBe(1698);
      expect(Math.round(L7_1_N.capFrontier)).toBe(1825);
      expect(Math.round(L7_1_N.chatByB)).toBe(689);
      expect(Math.round(L7_1_N.chatByL)).toBe(10);
      expect(L7_1_N.chatByB / L7_1_N.gpus.A).toBeCloseTo(2 / 3, 1);
      expect(L7_1_N.demandAvgTotal).toBe(1800);
      expect(customerDemand(CUSTOMERS_DEFAULT, 'peak').chat70).toBe(600);
      // At Fernhill, code completion is out of reach (40 ms against 20).
      const nf = { ...FLEET_DEFAULT, site: 'fernhill' as const };
      expect(evalOf(nf).checks.every((c) => c.ok)).toBe(true);
    });
  });
}

// Lesson 7.2
{
  const N = L7_2_LESSON_NUMBERS;
  const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  describe('lesson 7.2: generating demand', () => {
    it('quotes the starting week', () => {
      expect(r(N.wants)).toBe(1759);
      expect(r(N.average)).toBe(1682);
      expect(r(N.peak)).toBe(2093);
      expect(N.peakWhen).toBe('15:00');
      expect(r(N.servedShare * 100, 1)).toBe(87.3);
      expect([r(N.busy.B * 100), r(N.busy.A * 100), r(N.busy.L * 100)]).toEqual([100, 79, 4]);
      expect([r(N.chatB, 2), r(N.chatA, 2)]).toEqual([1.78, 2.4]);
      expect([r(N.chatShareA * 100), r(N.chatShareB * 100)]).toEqual([81, 99]);
      expect([r(N.chatServed * 100), r(N.codeServed * 100)]).toEqual([80, 93]);
      expect(N.committedB).toBe(defaultCloud().fleet.gpus.B);
      expect(N.committedB).toBe(256);
      expect(SITES.techpark.rttMs).toBe(6);
    });

    it('quotes the trainer on spot and the filled fleet', () => {
      expect(r(N.spotChat * 100)).toBe(83);
      expect(r(N.spotShare * 100, 1)).toBe(91.5);
      expect([r(N.fillChat * 100), r(N.fillCode * 100)]).toEqual([51, 66]);
    });

    it('solves the challenge only once every class is half busy', () => {
      const d = defaultCloud();
      expect(fillSolved(d)).toBe(false);
      expect(smallestFill()).toBe(FILL_ANSWER);
      const at = (size: number) => ({ ...d, customers: d.customers.map((c) => (c.id === 'c6' ? { ...c, size } : c)) });
      expect(fillSolved(at(FILL_ANSWER))).toBe(true);
      expect(fillSolved(at(FILL_ANSWER - 10))).toBe(false);
      // Without L-class cards the starting fleet's other classes are already at least half busy.
      const noL = { ...d, fleet: { ...d.fleet, gpus: { ...d.fleet.gpus, L: 0 } } };
      expect(busyByClass(noL).map((b) => b.gpu)).toEqual(['A', 'B']);
      expect(fillSolved(noL)).toBe(true);
      // A fleet with no GPUs can't be kept busy.
      expect(fillSolved({ ...d, fleet: { ...d.fleet, gpus: { L: 0, A: 0, B: 0 } } })).toBe(false);
    });

    it('grows demand against a fixed fleet', () => {
      const g = growthView(defaultCloud());
      expect(r(g.totals[0])).toBe(r(weekView(defaultCloud()).average));
      expect(r(N.q12Share * 100)).toBe(69);
      expect(r((N.demandGrowth - 1) * 100)).toBe(50);
      for (let q = 1; q < 12; q++) expect(g.servedShare[q]).toBeLessThan(g.servedShare[q - 1]);
      const noChatGrowth = defaultCloud();
      noChatGrowth.customers = noChatGrowth.customers.map((c) => (c.workload === 'chat70' ? { ...c, growth: 0 } : c));
      const g0 = growthView(noChatGrowth);
      expect(g0.servedShare[11]).toBeGreaterThan(g.servedShare[11]);
      expect(g0.servedShare[11]).toBeLessThan(g0.servedShare[0]);
    });

    it('signs up new customers with unique ids', () => {
      const d = defaultCloud();
      const a = newCustomer('batch8', d.customers, 1000);
      const b = newCustomer('batch8', [...d.customers, a], 1000);
      expect(a.id).not.toBe(b.id);
      expect(a.name).toBe('Batch summarization customer 2');
      expect(a.size).toBe(100);
      expect(a.tier).toBe('spot');
    });

    it('handles empty fleets and out-of-reach customers', () => {
      const d = defaultCloud();
      const empty = weekView({ ...d, fleet: { ...d.fleet, gpus: { L: 0, A: 0, B: 0 } } });
      expect(empty.servedShare).toBe(1);
      const far = weekView({ ...d, fleet: { ...d.fleet, site: 'fernhill' } });
      expect(far.ctx.off.find((o) => o.customer.workload === 'code8')!.reason).toMatch(/too far/);
    });
  });
}

// Lesson 7.3
{
  const START = defaultCloud();
  const withRB = (p: number) => ({ ...START, prices: withPrice(START.prices, 'reserved', 'B', p) });

  describe('lesson 7.3: pricing the cloud', () => {
    it('quotes the starting design at list prices', () => {
      expect(Math.round(L7_3_N.listRevenue)).toBe(394502);
      expect(Math.round(L7_3_N.listPower)).toBe(17399);
      expect(Math.round(L7_3_N.listFixed)).toBe(382065);
      expect(Math.round(L7_3_N.listProfit)).toBe(-4962);
      expect(Math.round(L7_3_N.listUtil.B * 100)).toBe(100);
      expect(Math.round(L7_3_N.listUtil.A * 100)).toBe(79);
      expect(Math.round(L7_3_N.listUtil.L * 100)).toBe(4);
      expect(L7_3_N.allFirstB).toBe(true);
      expect(L7_3_N.prodBMin.toFixed(1)).toBe('2.3');
      expect(L7_3_N.prodBMax.toFixed(1)).toBe('3.1');
      expect(L7_3_N.chatOnB.toFixed(2)).toBe('1.78');
      expect(L7_3_N.chatOnA).toBe(2.4);
      expect(Math.round(L7_3_N.chatShareA * 100)).toBe(81);
      expect([L7_3_N.frontierCommitB, L7_3_N.trainerCommitB, L7_3_N.trainerCommitA]).toEqual([96, 160, 66]);
      expect(L7_3_N.frontierOnB.toFixed(2)).toBe('1.02');
      expect(Math.round(L7_3_N.frontierRevenueList)).toBe(51610);
    });

    it('finds the reserved B-class ceiling at the frontier lab’s substitute', () => {
      expect(L7_3_N.prodFrontierB.toFixed(2)).toBe('3.13');
      expect(L7_3_N.ceilingRaw.toFixed(2)).toBe('5.01');
      expect(L7_3_N.ceiling).toBeCloseTo(5, 9);
      expect(Math.round(L7_3_N.ceilProfit)).toBe(25834);
      expect(Math.round(L7_3_N.ceilFrontierRevenue)).toBe(80640);
      expect(L7_3_N.ceilTrainerCommitA).toBe(443);
      expect(L7_3_N.ceilFreedB).toBe(160);
      expect(Math.round(L7_3_N.pastProfit)).toBe(11856);
      expect(L7_3_N.prodTrainB.toFixed(2)).toBe('2.36');
      expect(L7_3_N.trainerCeilingRaw.toFixed(2)).toBe('3.77');
      expect(L7_3_N.trainerLast).toBeCloseTo(3.75, 9);
      expect(Math.round(L7_3_N.trainerStayProfit)).toBe(18693);
      expect(Math.round(L7_3_N.trainerGoneProfit)).toBe(6481);
      expect(bestPrice(START, 'reserved', 'B')).toEqual({ price: 5, profit: L7_3_N.ceilProfit });
    });

    it('solves challenge a only with a targeted price change', () => {
      expect(Math.round(L7_3_N.marginTarget)).toBe(395958);
      expect(pricingSolved(START)).toBe(false);
      // Every price up 10% is not enough: 4.1% more margin.
      expect((L7_3_N.up10Gain * 100).toFixed(1)).toBe('4.1');
      expect(pricingSolved(withRB(5))).toBe(true);
      expect(pricingSolved(withRB(3.75))).toBe(true);
      expect(pricingSolved(withRB(4))).toBe(false);
      // Pricing a reachable customer out of buying fails it, however much it earns.
      const noChat = { ...withRB(5), customers: START.customers.map((c) => (c.id === 'c1' ? { ...c, value: 0.5 } : c)) };
      expect(customersLost(noChat)).toEqual(['Chat startup']);
      expect(pricingSolved(noChat)).toBe(false);
      expect(marginTarget(START)).toBeCloseTo(listWeekOf(START).margin * 1.05, 6);
    });

    it('solves challenge b at the best on-demand A-class price', () => {
      expect(L7_3_N.odaListBest.price).toBeCloseTo(2.95, 9);
      expect(Math.round(L7_3_N.odaListBest.profit)).toBe(5401);
      expect(L7_3_N.odaCeilBest.price).toBeCloseTo(2.9, 9);
      expect(Math.round(L7_3_N.odaCeilBest.profit)).toBe(31066);
      expect(onDemandASolved(START)).toBe(false);
      const best = { ...START, prices: withPrice(START.prices, 'onDemand', 'A', 2.95) };
      expect(onDemandASolved(best)).toBe(true);
      expect(onDemandASolved({ ...START, prices: withPrice(START.prices, 'onDemand', 'A', 3.4) })).toBe(false);
    });

    it('sweeps prices without breaking on extreme designs', () => {
      const s = sweepPrice(START, 'onDemand', 'A');
      expect(s.prices.length).toBe(41);
      expect(s.prices[40]).toBe(PRICE_MAX.A);
      const empty = { ...START, fleet: { ...START.fleet, gpus: { L: 0, A: 0, B: 0 } } };
      expect(Number.isFinite(weekOf(empty).profit)).toBe(true);
      expect(customersLost(empty)).toEqual([]);
      const far = { ...START, fleet: { ...START.fleet, site: 'fernhill' as const } };
      expect(customersLost(far)).toEqual([]);
      expect(weekOf({ ...START, prices: PRICEBOOK_DEFAULT }).profit).toBeCloseTo(L7_3_N.listProfit, 6);
    });
  });
}

// Lesson 7.4
{
  const START = defaultCloud();
  const plan = (policy: OpsPlan['policy'], A = 0, B = 0, burst = false): OpsPlan => ({ policy, rented: { L: 0, A, B }, burst });
  const r0 = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
  const pc = (x: number) => Math.round(x * 100);

  describe('lesson 7.4: the week, hour by hour', () => {
    it('splits an hour consistently with the week', () => {
      for (const h of [0, 4, 15, 100, 167]) {
        const d = hourDetail(START, plan('tiered'), NORMAL, h);
        const wanted = d.customers.reduce((s, c) => s + c.wanted, 0);
        const served = d.customers.reduce((s, c) => s + c.served, 0);
        expect(wanted).toBeCloseTo(d.row.demand, 6);
        expect(served).toBeCloseTo(d.row.owned + d.row.rented + d.row.burst, 6);
        expect(d.row.demand).toBeCloseTo(d.row.owned + d.row.rented + d.row.burst + d.row.unmet, 6);
        for (const g of ['L', 'A', 'B'] as const) expect(d.busy[g]).toBeLessThanOrEqual(START.fleet.gpus[g] + 1e-6);
      }
      expect(hourName(15)).toBe('Mon 15:00');
      expect(hourName(167)).toBe('Sun 23:00');
    });

    it('copes with extreme designs', () => {
      const empty = { ...START, fleet: { ...START.fleet, gpus: { L: 0, A: 0, B: 0 } } };
      const r = runWeek(empty, plan('tiered', RENT_A.max, RENT_B.max, true), { outPct: 30, demandPct: 200 });
      expect(Number.isFinite(r.profit)).toBe(true);
      expect(turnedAway(r)).toBeGreaterThanOrEqual(0);
      const d = hourDetail(empty, plan('first-come'), NORMAL, 0);
      expect(d.customers.every((c) => Number.isFinite(c.served))).toBe(true);
    });
  });

  describe('lesson 7.4 challenges', () => {
    it('a: in a normal week the best plan serves on demand first and rents nothing', () => {
      const best = bestPlan(START, NORMAL);
      expect(best.ops.policy).toBe('tiered');
      expect(best.ops.rented).toEqual({ L: 0, A: 0, B: 0 });
      expect(planSolved(START, plan('first-come'), NORMAL, NORMAL)).toBe(false);
      expect(planSolved(START, plan('tiered'), NORMAL, NORMAL)).toBe(true);
      expect(planSolved(START, plan('tiered', 0, 0, true), NORMAL, NORMAL)).toBe(true); // bursting changes nothing at list prices
      expect(planSolved(START, plan('tiered', 64), NORMAL, NORMAL)).toBe(false);
      expect(planSolved(START, plan('tiered'), { outPct: 10, demandPct: 100 }, NORMAL)).toBe(false);
    });

    it('b: in a launch week renting 320 A-class GPUs pays', () => {
      const best = bestPlan(START, LAUNCH);
      expect(best.ops).toMatchObject({ policy: 'tiered', rented: { L: 0, A: 320, B: 0 } });
      expect(planSolved(START, plan('tiered', 320), LAUNCH, LAUNCH)).toBe(true);
      expect(planSolved(START, plan('tiered', 256), LAUNCH, LAUNCH)).toBe(false);
      expect(planSolved(START, plan('tiered', 384), LAUNCH, LAUNCH)).toBe(false);
      expect(planSolved(START, plan('tiered'), LAUNCH, LAUNCH)).toBe(false);
      expect(planSolved(START, plan('tiered', 320), NORMAL, LAUNCH)).toBe(false);
    });
  });

  describe('lesson 7.4 numbers', () => {
    const N = lessonNumbers();
    it('the starting design, first come and tiered', () => {
      expect([N.fleetTotal, N.fleetB, N.committedB]).toEqual([1536, 256, 256]);
      expect(r0(N.fc.revenue)).toBe(394502);
      expect(r0(N.fc.power)).toBe(17399);
      expect(r0(N.fc.fixed)).toBe(382065);
      expect(r0(N.fc.profit)).toBe(-4962);
      expect([pc(N.fc.util.B), pc(N.fc.util.A), pc(N.fc.util.L), pc(N.fc.away)]).toEqual([100, 79, 4, 13]);
      expect([pc(N.fc.served.c2), pc(N.tiered.served.c2), pc(N.fc.served.c1), pc(N.tiered.served.c1), pc(N.fc.served.c6), pc(N.tiered.served.c6)]).toEqual([93, 100, 80, 82, 84, 80]);
      expect(r0(N.tiered.gain)).toBe(3635);
      expect(r0(N.tiered.profit)).toBe(-1326);
      expect(r0(N.normalBest.profit)).toBe(-1326);
    });

    it('buying capacity elsewhere', () => {
      expect(r0(N.rentB32.loss)).toBe(20130);
      expect(r0(N.rentA64.loss)).toBe(15433);
      expect([r0(N.chatPeak), r0(N.chatNight)]).toEqual([600, 200]);
      expect([r0(N.premium.gain), r0(N.premium.noBurst), r0(N.premium.burst)]).toEqual([6180, 2318, 8498]);
    });

    it('when the week isn’t normal', () => {
      expect(r0(N.out10.profit)).toBe(-3938);
      expect([pc(N.out10.served.c4), pc(N.tieredServed.c4), pc(N.tieredServed.c6), pc(N.out10.served.c6)]).toEqual([82, 91, 80, 74]);
      expect(r0(N.low70)).toBe(-116717);
      expect(r0(N.launch.none)).toBe(116502);
      expect(pc(N.launch.noneChat)).toBe(31);
      expect([N.launch.bestA, N.launch.bestB]).toEqual([320, 0]);
      expect(r0(N.launch.rentCost)).toBe(86016);
      expect(r0(N.launch.gain)).toBe(12439);
      expect(pc(N.launch.bestChat)).toBe(62);
    });

    it('one hour at a time', () => {
      expect([r0(N.peak.demand), r0(N.peak.owned), r0(N.peak.unmet)]).toEqual([2093, 1730, 363]);
      // The night example is 03:00, the chat startup's quietest hour.
      expect([r0(N.night.demand), r0(N.night.unmet), r0(N.night.idleA)]).toEqual([1353, 161, 469]);
      // The peak is the busiest hour of the week.
      const week = runWeek(START, plan('tiered'), NORMAL);
      const busiest = week.hours.reduce((m, h, i) => (h.demand > week.hours[m].demand ? i : m), 0);
      expect(busiest).toBe(15);
    });
  });
}

// Lesson 7.5
{
  const M = (x: number) => Math.round((x / 1e6) * 100) / 100;
  const pc = (x: number) => Math.round(x * 100);

  describe('strategy challenge engine', () => {
    it('reproduces simulateBusiness with the levers at their starting values', () => {
      const ops = { ...OPS_DEFAULT, policy: 'tiered' as const };
      const a = simulateBusiness(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, ops, WORLD_DEFAULT);
      const b = businessUnder(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, ops, WORLD_DEFAULT, LEVERS_DEFAULT);
      expect(b.npvs).toEqual(a.npvs);
      const ctx = contextUnder(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT);
      expect(fixedPerYearFor(ctx, 5)).toBeCloseTo(evaluateFleet(FLEET_DEFAULT).fixedPerYear, 6);
      expect(fixedPerYearFor(ctx, 3)).toBeGreaterThan(fixedPerYearFor(ctx, 5));
      expect(worldOf(WORLD_STATE_DEFAULTS)).toEqual(WORLD_DEFAULT);
    });

    it('makes energy cost more and longer server lives cost less', () => {
      const d = RIGHT_SIZED;
      const base = runStrategy(d);
      expect(runStrategy(d, { ...WORLD_STATE_DEFAULTS, energy: 3 }).mean).toBeLessThan(base.mean);
      expect(runStrategy(d, { ...WORLD_STATE_DEFAULTS, life: 7 }).mean).toBeGreaterThan(base.mean);
    });
  });

  describe('lesson 7.5: the strategy challenge', () => {
    const N = L7_5_lessonNumbers();

    it('quotes the starting design', () => {
      expect([M(N.start.mean), M(N.start.p5), pc(N.start.probLoss), M(N.start.riskAdjusted)]).toEqual([0.34, -5.88, 44, -1.47]);
      expect(N.startGpus).toBe(1536);
      expect(Math.round(N.startFixedWeek)).toBe(382065);
      expect(pc(N.startWeek.utilization.B)).toBe(100);
      expect([pc(N.startWeek.utilization.A), pc(N.startWeek.utilization.L)]).toEqual([79, 4]);
      expect(Math.round(N.startWeek.revenue)).toBe(394502);
      expect(Math.round(N.startWeek.profit)).toBe(-4962);
    });

    it('quotes the smaller fleet', () => {
      expect(N.rightGpus).toBe(832);
      expect(Math.round(N.rightWeek.revenue)).toBe(362077);
      expect(Math.round(N.rightFixedWeek)).toBe(251929);
      expect(Math.round(N.rightWeek.profit)).toBe(97078);
      expect([pc(N.rightWeek.utilization.A), pc(N.rightWeek.served.c1), pc(N.rightWeek.served.c6)]).toEqual([97, 76, 43]);
      expect([M(N.right.mean), M(N.right.p5), N.right.probLoss, M(N.right.riskAdjusted)]).toEqual([11.89, 8.83, 0, 11.09]);
      expect(M(N.rightFirstCome.riskAdjusted)).toBe(8.46);
    });

    it('quotes the world’s drivers', () => {
      expect([M(N.life3.riskAdjusted), pc(N.life3.probLoss)]).toEqual([-3.06, 96]);
      expect(M(N.life7.riskAdjusted)).toBe(17.07);
      expect([M(N.early.riskAdjusted), pc(N.early.probLoss)]).toEqual([-3.4, 73]);
      expect(M(N.energy3.riskAdjusted)).toBe(7.74);
      expect(M(N.fail10.riskAdjusted)).toBe(9.97);
    });

    it('every starting customer buys the B-class first, as the prose says', () => {
      expect(offers(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT).every((o) => o.gpu === 'B')).toBe(true);
    });

    it('solves challenge a only with a buildable design worth $18M against the starting world and customers', () => {
      const W = WORLD_STATE_DEFAULTS;
      const priced = { ...RIGHT_SIZED, prices: { ...RIGHT_SIZED.prices, reserved: { ...RIGHT_SIZED.prices.reserved, B: 5 }, onDemand: { ...RIGHT_SIZED.prices.onDemand, B: 6 } } };
      expect(isStartingWorld(W)).toBe(true);
      expect(targetSolved(priced, W)).toBe(true);
      expect(targetSolved(RIGHT_SIZED, W)).toBe(false);
      expect(targetSolved(defaultCloud(), W)).toBe(false);
      expect(targetSolved(priced, { ...W, energy: 1.25 })).toBe(false);
      const greedy = { ...RIGHT_SIZED, customers: RIGHT_SIZED.customers.map((c) => ({ ...c, size: c.size * 2 })) };
      expect(customersAreStarting(greedy.customers)).toBe(false);
      expect(targetSolved(greedy, W)).toBe(false);
      const unbuildable = { ...RIGHT_SIZED, fleet: { ...RIGHT_SIZED.fleet, feedKW: 8 } };
      expect(evaluateFleet(unbuildable.fleet).ok).toBe(false);
      expect(targetSolved(unbuildable, W)).toBe(false);
      expect(TARGET).toBe(18e6);
    });

    it('solves challenge b with a saved strategy that beats the start on both counts', () => {
      const start = defaultCloud();
      const right = runStrategy(RIGHT_SIZED);
      const startRun = runStrategy(start);
      expect(beatsStart([])).toBe(false);
      expect(beatsStart([{ design: start, mean: startRun.mean, p5: startRun.p5 }])).toBe(false);
      expect(beatsStart([{ design: { ...start, ...RIGHT_SIZED }, mean: right.mean, p5: right.p5 }])).toBe(true);
      expect(beatsStart([{ design: { ...start, customers: [] }, mean: right.mean, p5: right.p5 }])).toBe(false);
    });
  });
}
