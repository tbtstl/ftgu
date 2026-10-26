// Chapter 6 of the compute course: the numbers the prose quotes after the fix pass, and the
// engines added for it (the best allocation's linear program and shadow prices, the GPU-only
// power cap, the contract's standard deviation).

import { describe, expect, it } from 'vitest';
import { PHYSICS_DEFAULTS, YIELD_FLEET, YIELD_WORKLOADS, busyCost, productivityUnder, yieldRun } from '../src/engines/compute/yieldManager';
import { bestHour, hourShadowPrices, weekDemand, yieldRunBest } from '../src/engines/compute/yieldOptimal';
import { drawAtCap, gpuDieShare, gpuGridKW, hourOutcome, powerCapPlan } from '../src/engines/compute/powerAware';
import { speedAtPowerShare } from '../src/engines/compute/cooling';
import { transferHours } from '../src/engines/compute/regionMove';
import { CONTRACT_DEFAULTS, runContract } from '../src/engines/compute/contracts';
import {
  LESSON_NUMBERS as N1,
  NIGHT_HOUR,
  PEAK_HOUR,
  YIELD_DEFAULTS,
  chatMarginEffect,
  chatMarginSolved,
  chatThresholdMs,
  loserSolved,
  losersOf,
  runYield,
  shadowAt,
} from '../src/lessons/compute/ch6/L6_1';
import {
  BEARABLE,
  JOBS,
  LESSON_NUMBERS as N2,
  PLAN_DEFAULTS,
  RECLAIM_STEP,
  RESTART_MAX,
  RESTART_MIN,
  SPOT_DEFAULTS,
  badYearSide,
  badYearSolved,
  bearableStops,
  paramsOf as paramsOf2,
  WIDE_ANSWER,
  planOf,
  wideSolved,
} from '../src/lessons/compute/ch6/L6_2';
import {
  CHALLENGE_EGRESS,
  DATA_TB,
  DAY_DEFAULTS,
  JOB_DEFAULTS,
  LESSON_NUMBERS as N3,
  LINKS,
  dayOf,
  jobOf,
  largestSolved,
  runJob,
  slowestSolved,
  worthMoving,
} from '../src/lessons/compute/ch6/L6_3';
import {
  CHALLENGE_OWNED,
  DAY_DEFAULTS as DAY_DEFAULTS4,
  LESSON_NUMBERS as N4,
  PAUSE_VALUE_ANSWER,
  VALUE_STEP as VALUE_STEP4,
  dayRun,
  hallRun,
  historyRun,
  pauseValueSolved,
  policyOf,
} from '../src/lessons/compute/ch6/L6_4';
import {
  CENT_VALUE,
  CHAT_RATIO,
  DESK_DEFAULTS,
  FRONTIER_RATIO,
  LESSON_NUMBERS as N5,
  TERM_HOURS,
  deskRun,
  firstProfitableRank,
  hedgeSolved,
  pathSolved,
  priceSolved,
  startingTerms,
  startingWorld,
} from '../src/lessons/compute/ch6/L6_5';
import { SITES } from '../src/model/compute/sites';

const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

describe('compute 6.1: the best allocation (yieldOptimal.ts)', () => {
  const base = { fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, protectB: 0, physics: PHYSICS_DEFAULTS, powerPrice: 55, hours: 168 };

  it('sees the same week of demand as highest bid first', () => {
    const lp = yieldRunBest(base);
    const bid = yieldRun({ ...base, policy: 'best-value' });
    const prod = productivityUnder(PHYSICS_DEFAULTS);
    // Every workload both serve in full brings in the same work, so the demand draws match.
    for (const id of ['code8', 'frontier400', 'chat70', 'train70', 'tune8'] as const) {
      const work = (x: typeof lp) => (['L', 'A', 'B'] as const).reduce((t, g) => t + x.gpuHours[id][g] * prod[id][g], 0);
      expect(work(lp)).toBeCloseTo(work(bid), 6);
    }
  });

  it('never earns less than either rule, whatever the physics', () => {
    for (const physics of [PHYSICS_DEFAULTS, { ...PHYSICS_DEFAULTS, frontierPrecision: 'bf16' as const }, { ...PHYSICS_DEFAULTS, chatTpotMax: 0.02 }])
      for (const powerPrice of [20, 55, 400]) {
        const p = { ...base, physics, powerPrice, hours: 48 };
        const lp = yieldRunBest(p).margin;
        expect(lp).toBeGreaterThanOrEqual(yieldRun({ ...p, policy: 'best-value' }).margin - 1e-6);
        expect(lp).toBeGreaterThanOrEqual(yieldRun({ ...p, policy: 'first-come' }).margin - 1e-6);
      }
  });

  it('prices a GPU-hour by what one more would add, the same from either side', () => {
    const dem = weekDemand(YIELD_WORKLOADS, 168);
    const p = { fleet: YIELD_FLEET, workloads: YIELD_WORKLOADS, need: dem[15], physics: PHYSICS_DEFAULTS, powerPrice: 55 };
    const up = hourShadowPrices(p);
    const m0 = bestHour(p).margin;
    for (const g of ['L', 'A', 'B'] as const) {
      const down = m0 - bestHour({ ...p, fleet: { ...YIELD_FLEET, [g]: YIELD_FLEET[g] - 1 } }).margin;
      expect(down).toBeCloseTo(up[g], 6);
    }
  });
});

describe('compute 6.1: the numbers the prose quotes', () => {
  it('quotes the shadow prices at the peak and at night', () => {
    expect([PEAK_HOUR, NIGHT_HOUR]).toEqual([15, 3]);
    expect(r(N1.shadowPeak.B, 2)).toBe(3.67);
    expect(r(N1.shadowPeak.A, 2)).toBe(1.32);
    expect(r(N1.shadowPeak.A, 2)).toBe(r(N1.bidsA.batch, 2));
    expect(r(N1.shadowPeak.L, 2)).toBe(0.34);
    expect(r(N1.shadowNight.B, 2)).toBe(0.1);
    expect(N1.shadowNight.A).toBeCloseTo(0, 9);
    // The chain: one more B-class GPU takes chat work from 2.69 A-class GPUs, which summarize documents.
    expect(r(N1.prodChatB, 2)).toBe(2.69);
    expect(N1.batchValue).toBe(1.4);
    expect(r(N1.busyB, 2)).toBe(0.1);
    expect(N1.shadowPeak.B).toBeCloseTo(N1.prodChatB * N1.batchValue - N1.busyB, 6);
    expect(r(N1.shadowPeak.B - N1.bidsB.batch, 2)).toBe(0.28);
    expect(r(N1.bidsB.frontier - N1.bidsB.batch, 2)).toBe(10.58);
    // At night the shadow price is the electricity a B-class GPU saves over A-class GPUs doing its batch work.
    expect(N1.shadowNight.B).toBeCloseTo(N1.prodBatchB * busyCost('A', 55) - busyCost('B', 55), 6);
    // The readout the figure starts on agrees with the prose.
    expect(shadowAt(YIELD_DEFAULTS, PEAK_HOUR).B).toBeCloseTo(N1.shadowPeak.B, 9);
  });

  it('quotes where each policy puts the work', () => {
    expect(r(N1.batchNight, -1)).toBe(600);
    expect(r(N1.batchPeak, -1)).toBe(210);
    expect(N1.bestTrainOnB).toBe(0);
    expect(N1.bestBatchOnL).toBe(0);
    expect(N1.bestBatchOnB).toBeGreaterThan(0);
    expect(N1.bidCodeOnB).toBeGreaterThan(0);
    expect(N1.bidTrainOnB).toBeGreaterThan(0);
    expect(r(N1.bidsB.train, 2)).toBe(6.03);
    expect([r(N1.prodFrontierB, 2), r(N1.prodBatchB, 2), r(N1.prodCodeB, 2), r(N1.prodTrainB, 2), r(N1.prodTuneL, 2), r(N1.prodTrainL, 2)]).toEqual([3.13, 2.5, 2.41, 2.36, 0.35, 0.27]);
    // The B-class's edge is larger on frontier, chat and batch than on code completion and training.
    expect(Math.min(N1.prodFrontierB, N1.prodChatB, N1.prodBatchB)).toBeGreaterThan(Math.max(N1.prodCodeB, N1.prodTrainB));
    expect(r(N1.bf16Gain)).toBe(114231);
    expect(r(N1.powerShareOfFixed * 100)).toBe(4);
  });

  it('solves challenge a only with the best allocation and the right prediction', () => {
    expect(loserSolved(YIELD_DEFAULTS)).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'batch8' })).toBe(true);
    expect(runYield({ ...YIELD_DEFAULTS, policy: 'best' }).margin).toBeCloseTo(N1.bestMargin, 6);
  });
});

describe('compute 6.2: when spot beats reserving', () => {
  it('quotes the stops each job can bear', () => {
    expect(r(N2.usefulNeeded * 100)).toBe(59);
    expect(r(N2.tuneBear)).toBe(37);
    expect(r(N2.trainBear)).toBe(29);
    expect(r(N2.trainBear2)).toBe(66);
    expect(r(N2.trainBear30)).toBe(13);
    expect(r(N2.trainCross2, 2)).toBe(1.74);
    expect(r(N2.trainCross30, 2)).toBe(0.34);
    expect(N2.tuneServers * 2).toBe(4);
    expect(N2.trainServers * 2).toBe(76);
    expect(BEARABLE.train70.length).toBe(RESTART_MAX - RESTART_MIN + 1);
    expect(BEARABLE.train70[SPOT_DEFAULTS.restart - RESTART_MIN]).toBeCloseTo(bearableStops(JOBS.train70, SPOT_DEFAULTS.restart), 9);
    // Fewer stops can be borne the longer a restart takes.
    for (let i = 1; i < BEARABLE.train70.length; i++) expect(BEARABLE.train70[i]).toBeLessThan(BEARABLE.train70[i - 1]);
  });

  it('challenge b: unsolved at the start, solved at 0.75', () => {
    expect(wideSolved(SPOT_DEFAULTS)).toBe(false);
    expect(wideSolved({ reclaims: 0.75, restart: 10 })).toBe(true);
  });
});

describe('compute 6.3: the chat job follows the assistants’ limit', () => {
  it('stays for distance below 40 ms and for want of a gap at 40', () => {
    expect(jobOf({ job: 'chat', data: 0, lat: 30 }).maxRttMs).toBe(30);
    expect(jobOf({ job: 'chat', data: 0, lat: 45 }).maxRttMs).toBe(45);
    expect(jobOf({ job: 'pretrain', data: JOB_DEFAULTS.data, lat: 45 }).maxRttMs).toBe(Infinity);
    expect(runJob({ ...JOB_DEFAULTS, job: 'chat', data: 0, lat: 30 }).feasible).toBe(false);
    const at40 = runJob({ ...JOB_DEFAULTS, job: 'chat', data: 0, lat: SITES.fernhill.rttMs });
    expect(at40.feasible).toBe(true);
    expect(at40.saving).toBe(0);
    const day = dayOf({ ...DAY_DEFAULTS, lat: SITES.fernhill.rttMs });
    const chat = day.rows.find((x) => x.job.id === 'chat')!;
    expect(chat.decision).toBe('stay');
    expect(chat.result.egressCost).toBe(0);
    expect(day.rows.find((x) => x.job.id === 'code')!.why).toBe('too far from users');
    expect(worthMoving({ ...DAY_DEFAULTS, lat: SITES.fernhill.rttMs })).toEqual([]);
    expect(dayOf(DAY_DEFAULTS).rows.find((x) => x.job.id === 'chat')!.why).toBe('too far from users');
  });

  it('copies at 80% of the link’s rated speed', () => {
    expect(r(transferHours(55, 100), 2)).toBe(1.53);
  });
});

describe('compute 6.4: a cap limits the GPU alone', () => {
  it('saves less of the server’s draw than of the GPU’s', () => {
    expect(r(gpuDieShare() * 100)).toBe(74);
    expect(r((1 - gpuDieShare()) * 100)).toBe(26);
    expect(r(drawAtCap(0.7) * 100)).toBe(78);
    expect(r((1 - drawAtCap(0.7)) * 100)).toBe(22);
    expect(drawAtCap(1)).toBe(1);
    const out = hourOutcome(100, 'capped', policyOf(2.4, 70));
    expect(out.powerShare).toBeCloseTo(drawAtCap(0.7), 12);
    expect(out.speed).toBeCloseTo(speedAtPowerShare(0.7), 12);
    expect(powerCapPlan(20, 0.7).kwPerGpu).toBeCloseTo(gpuGridKW() * drawAtCap(0.7), 12);
    expect(r(N4.savedKW70, 3)).toBe(0.326);
  });

  it('quotes the cost of the extra GPUs without the building or the power', () => {
    expect(r(N4.hardwareYear)).toBe(11517);
    expect(r(N4.extraCost / 1e6, 1)).toBe(44.3);
    expect(r(N4.extraCostRatio, 1)).toBe(5.2);
  });

  it('loses work at every cap if speed fell in step with power', () => {
    const full = hallRun(CHALLENGE_OWNED, 100, true).work;
    for (let c = 99; c >= 50; c--) expect(hallRun(CHALLENGE_OWNED, c, true).work).toBeLessThan(full);
  });

  it('shows the pause answer to a tenth of a dollar, under the peak', () => {
    const at = policyOf(PAUSE_VALUE_ANSWER, 70).pauseAbove;
    expect(r(at, 1)).toBe(2177.6);
    expect(r(N4.maxPrice, 1)).toBeGreaterThan(r(at, 1));
  });
});

describe('compute 6.5: the ratio, the spread and challenge b', () => {
  it('takes its ratios from Lesson 6.1', () => {
    expect(CHAT_RATIO).toBe(r(productivityUnder(PHYSICS_DEFAULTS).chat70.B, 2));
    expect(FRONTIER_RATIO).toBe(3.13);
    expect(r(N5.aAfter, 2)).toBe(1.78);
  });

  it('reports the standard deviation of the paths', () => {
    const c = runContract(CONTRACT_DEFAULTS);
    const sd = Math.sqrt(c.npvs.reduce((a, b) => a + (b - c.mean) ** 2, 0) / c.npvs.length);
    expect(c.sd).toBeCloseTo(sd, 6);
    expect(deskRun(DESK_DEFAULTS).sd).toBeCloseTo(N5.sd, 6);
    expect(N5.withinSd).toBeGreaterThan(0.6);
    expect(N5.withinSd).toBeLessThan(0.75);
  });

  it('challenge b holds the prices and the world fixed', () => {
    expect(startingTerms(DESK_DEFAULTS)).toBe(true);
    expect(startingTerms({ ...DESK_DEFAULTS, hedge: 60 })).toBe(true);
    expect(startingTerms({ ...DESK_DEFAULTS, hedgePrice: 1.5 })).toBe(false);
    expect(startingTerms({ ...DESK_DEFAULTS, arrival: 6 })).toBe(false);
    expect(hedgeSolved(DESK_DEFAULTS)).toBe(false);
    expect(hedgeSolved({ ...DESK_DEFAULTS, hedge: N5.hedgeAnswer })).toBe(true);
    expect(hedgeSolved({ ...DESK_DEFAULTS, hedge: N5.hedgeAnswer, hedgePrice: 1.5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix pass 2: predict-then-check challenges, hidden markers, trimmed figures.

describe('compute 6.1 pass 2: the two predictions', () => {
  it('challenge a: batch summarization is the one workload the best allocation makes wait', () => {
    expect(losersOf(YIELD_DEFAULTS)).toEqual(['batch8']);
    // The same at every setting the first demonstration offers.
    for (const s of [{ protect: 150 }, { protect: 300 }, { precision: 'bf16' as const }, { chatMs: 20 }, { power: 400 }]) expect(losersOf({ ...YIELD_DEFAULTS, ...s })).toEqual(['batch8']);
    expect(r(N1.fcServed.batch8 * 100)).toBe(96);
    expect(r(N1.bestServed.batch8 * 100)).toBe(85);
  });

  it('challenge a: unsolved at the start, solved only by the right prediction checked under the best allocation', () => {
    expect(loserSolved(YIELD_DEFAULTS)).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'batch8' })).toBe(true);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best' })).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'tune8' })).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best', guessA: 'train70' })).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, guessA: 'batch8' })).toBe(false);
    expect(loserSolved({ ...YIELD_DEFAULTS, policy: 'best-value', guessA: 'batch8' })).toBe(false);
  });

  it('challenge b: letting the L-class into chat lowers first come, first served’s margin', () => {
    expect(chatThresholdMs()).toBe(38);
    expect(N1.threshold).toBe(38);
    expect(chatMarginEffect()).toBe('lower');
    expect(r(N1.fcBeforeThreshold)).toBe(876612);
    expect(r(N1.fcAtThreshold)).toBe(875481);
    expect(r(N1.fcBeforeThreshold - N1.fcAtThreshold)).toBe(1131);
    expect(r(N1.prodChatLAt, 3)).toBe(0.018);
    expect(r(N1.bidChatLAt, 2)).toBe(0.02);
    expect(r(N1.bidsL.tune, 2)).toBe(0.79);
    expect(N1.fcChatOnLAt).toBe(8400);
    expect([r(N1.fcTuneAt * 100), r(N1.fcTuneBefore * 100)]).toEqual([91, 93]);
    // The best allocation never spends an L-class hour on chat, so its margin doesn't move.
    expect(N1.bestChatOnLAt).toBe(0);
    expect(N1.bestAtThreshold).toBeCloseTo(N1.bestBeforeThreshold, 6);
    expect(r(N1.bestAtThreshold)).toBe(938580);
    expect(r(1 / N1.prodChatLAt)).toBe(57);
    expect(r(N1.bidsA.batch, 2)).toBe(1.32);
  });

  it('challenge b: unsolved at the start, solved only by the right prediction checked at 38 ms', () => {
    const ok = { ...YIELD_DEFAULTS, chatMs: 38, guessB: 'lower' as const };
    expect(chatMarginSolved(YIELD_DEFAULTS)).toBe(false);
    expect(chatMarginSolved(ok)).toBe(true);
    expect(chatMarginSolved({ ...ok, guessB: 'same' })).toBe(false);
    expect(chatMarginSolved({ ...ok, guessB: '' })).toBe(false);
    expect(chatMarginSolved({ ...ok, chatMs: 37 })).toBe(false);
    expect(chatMarginSolved({ ...ok, chatMs: 39 })).toBe(false);
    expect(chatMarginSolved({ ...ok, policy: 'best' })).toBe(false);
    expect(chatMarginSolved({ ...ok, power: 60 })).toBe(false);
    expect(chatMarginSolved({ ...ok, protect: 100 })).toBe(false);
  });
});

describe('compute 6.2 pass 2: a bad year predicted, spot estimated', () => {
  it('drops the constant spot term from the plan', () => {
    expect(paramsOf2(PLAN_DEFAULTS).interruptible).toBe(0);
    expect(r(N2.allOnDemandMean / 1e6, 2)).toBe(6.88);
    expect(r(N2.bestMeanMean / 1e6, 2)).toBe(5.41);
  });

  it('challenge a: the bad year is cheapest to the right of 260', () => {
    expect(badYearSide()).toBe('right');
    const right = { ...PLAN_DEFAULTS, guess: 'right' as const };
    expect(badYearSolved(PLAN_DEFAULTS)).toBe(false);
    expect(badYearSolved({ ...right, reserved: 300 })).toBe(true);
    expect(badYearSolved({ ...PLAN_DEFAULTS, guess: 'left', reserved: 300 })).toBe(false);
    expect(badYearSolved({ ...PLAN_DEFAULTS, reserved: 300 })).toBe(false);
    expect(badYearSolved({ ...right, reserved: 260 })).toBe(false);
    expect(badYearSolved({ ...right, reserved: 280 })).toBe(false);
    expect(badYearSolved({ ...right, reserved: 320 })).toBe(false);
    // The readout tells 300 from its neighbors to the cent of a million; the check accepts the flat bottom.
    const shown = (res: number) => (Math.round(planOf({ ...PLAN_DEFAULTS, reserved: res }).p95 / 1e4) / 100).toFixed(2);
    expect([shown(290), shown(300), shown(310)]).toEqual(['6.35', '6.34', '6.35']);
  });

  it('challenge b: estimated from the stops the run can bear and its servers', () => {
    expect(r(N2.trainBear, 1)).toBe(29.2);
    expect(r(N2.trainBear / N2.trainServers, 2)).toBe(0.77);
    // From “about 29” the estimate, rounded down to the slider's steps, is the answer.
    expect(r(Math.floor(29 / N2.trainServers / RECLAIM_STEP) * RECLAIM_STEP, 2)).toBe(WIDE_ANSWER);
    expect(r(N2.tuneBear / N2.tuneServers, 1)).toBe(r(N2.tuneCross, 1));
    expect(wideSolved(SPOT_DEFAULTS)).toBe(false);
    expect(wideSolved({ reclaims: 0.75, restart: 10 })).toBe(true);
    expect(wideSolved({ reclaims: 0.7, restart: 10 })).toBe(false);
    expect(wideSolved({ reclaims: 0.8, restart: 10 })).toBe(false);
  });
});

describe('compute 6.3 pass 2: predictions at double the fee and from the copy hours', () => {
  it('challenge a: doubling the fee halves the break-even', () => {
    expect(CHALLENGE_EGRESS).toBe(2 * JOB_DEFAULTS.egress);
    expect(N3.preBreakEvenFee).toBeCloseTo(N3.preBreakEven / 2, 6);
    expect(r(N3.preBreakEven / 1000, 1)).toBe(3.6);
    expect(r(N3.preBreakEvenFee / 1000, 1)).toBe(1.8);
    expect([N3.feeBestTB, N3.feeNextTB]).toEqual([1000, 2000]);
    expect(r(N3.feeBestSaving)).toBe(88421);
    expect(r(-N3.feeNextSaving)).toBe(21579);
    const at10 = { ...JOB_DEFAULTS, egress: 10 };
    expect(largestSolved(JOB_DEFAULTS)).toBe(false);
    expect(largestSolved({ ...at10, data: DATA_TB.indexOf(1000) })).toBe(true);
    expect(largestSolved({ ...at10, data: DATA_TB.indexOf(500) })).toBe(false);
    expect(largestSolved({ ...at10, data: DATA_TB.indexOf(2000) })).toBe(false);
    expect(largestSolved({ ...JOB_DEFAULTS, data: DATA_TB.indexOf(3000) })).toBe(false);
  });

  it('challenge b: 6.9 hours at 100 Gb/s fit a day only from about 29 Gb/s, so 40 on the slider', () => {
    expect(r(N3.dayLinkH, 1)).toBe(6.9);
    expect(r((N3.dayLinkH * 100) / 24)).toBe(29);
    expect(N3.slowestAllLink).toBe(LINKS.find((l) => l >= (N3.dayLinkH * 100) / 24));
    expect(N3.slowestAllLink).toBe(40);
    expect(r(N3.slowestAllLinkH, 1)).toBe(17.3);
    expect(N3.belowSlowestLink).toBe(25);
    expect(r((N3.dayLinkH * 100) / N3.belowSlowestLink, 1)).toBe(27.7);
    expect(N3.belowSlowestStuck).toEqual(['embed']);
    expect(slowestSolved(DAY_DEFAULTS)).toBe(false);
    expect(slowestSolved({ ...DAY_DEFAULTS, link: LINKS.indexOf(40) })).toBe(true);
    expect(slowestSolved({ ...DAY_DEFAULTS, link: LINKS.indexOf(25) })).toBe(false);
    expect(slowestSolved({ ...DAY_DEFAULTS, link: LINKS.indexOf(100) })).toBe(false);
    // The prediction is about the starting day.
    expect(slowestSolved({ ...DAY_DEFAULTS, egress: 4, link: LINKS.indexOf(40) })).toBe(false);
  });
});

describe('compute 6.4 pass 2: pausing computed first', () => {
  it('pausing saves 1.033 kW, untouched by the GPU-only cap', () => {
    expect(r(N4.kw, 3)).toBe(1.476);
    expect(r(N4.pauseKW, 3)).toBe(1.033);
    expect(N4.pauseKW).toBeCloseTo(gpuGridKW() * 0.7, 12);
    expect(r(N4.kw * 0.3, 3)).toBe(0.443);
    expect(r(N4.pause240)).toBe(2323);
  });

  it('challenge a: $2,178 × 1.033 kW is $2.25 an hour', () => {
    expect(r(N4.maxPrice, 1)).toBe(2178.4);
    expect(r(N4.pauseValueExact, 2)).toBe(2.25);
    expect(r((2178 * 1.033) / 1000, 2)).toBe(2.25);
    // To the nearest 5 cents, by rounding or by flooring.
    expect(r(Math.round(N4.pauseValueExact / VALUE_STEP4) * VALUE_STEP4, 2)).toBe(PAUSE_VALUE_ANSWER);
    expect(r(Math.floor(N4.pauseValueExact / VALUE_STEP4) * VALUE_STEP4, 2)).toBe(PAUSE_VALUE_ANSWER);
    expect(pauseValueSolved(DAY_DEFAULTS4.value)).toBe(false);
    expect(pauseValueSolved(2.25)).toBe(true);
    expect(pauseValueSolved(2.2)).toBe(false);
    expect(pauseValueSolved(2.3)).toBe(false);
    // Day 73, where the check is made, pauses at $2.25 and not at $2.30.
    const paused = (v: number) => dayRun({ ...DAY_DEFAULTS4, value: v }).hours.filter((h) => h.mode === 'paused').length;
    expect(paused(2.25)).toBeGreaterThan(0);
    expect(paused(2.3)).toBe(0);
  });

  it('uses the day and cap sliders', () => {
    expect(N4.capDays).toEqual([73, 120]);
    expect(r(N4.cap50)).toBe(1433);
    // A deeper cap pays only at higher prices.
    let prev = 0;
    for (const c of [95, 90, 80, 70, 60, 50]) {
      const at = policyOf(2.4, c).capAbove;
      expect(at).toBeGreaterThan(prev);
      prev = at;
    }
    // Yet at this history's two spikes, far above either price, the deeper cap gains more.
    expect(historyRun(2.4, 50).gain).toBeGreaterThan(historyRun(2.4, 70).gain);
    expect(Math.min(...N4.capDays.map((d) => Math.max(...dayRun({ ...DAY_DEFAULTS4, day: d }).hours.map((h) => h.price))))).toBeGreaterThan(N4.cap50);
  });
});

describe('compute 6.5 pass 2: the price slides the paths, the forward sale narrows them', () => {
  it('a cent off the price adds the same to every path', () => {
    expect(TERM_HOURS).toBe(512 * 2190 * 12);
    expect(r(TERM_HOURS / 1e6, 1)).toBe(13.5);
    expect(r(CENT_VALUE, -3)).toBe(116000);
    const base = deskRun(DESK_DEFAULTS);
    for (const price of [1.15, 1.21]) {
      const run = deskRun({ ...DESK_DEFAULTS, price });
      const shift = (DESK_DEFAULTS.price - price) * 100 * CENT_VALUE;
      for (let i = 0; i < base.npvs.length; i += 97) expect(run.npvs[i] - base.npvs[i]).toBeCloseTo(shift, 3);
      expect(run.sd).toBeCloseTo(base.sd, 3);
    }
  });

  it('challenge a: $1.68M at about $116,000 a cent is 14.5 cents, so $1.15', () => {
    expect(r(-N5.p5 / 1e6, 2)).toBe(1.68);
    expect(r(-N5.p5 / N5.centValue, 1)).toBe(14.5);
    expect(r(N5.priceExact, 3)).toBe(1.155);
    expect(N5.priceAnswer).toBe(1.15);
    expect(r(N5.priceAnswerP5 / 1e6, 2)).toBe(0.06);
    expect(r(-N5.priceNextP5 / 1e6, 2)).toBe(0.06);
    expect(r(N5.priceAnswerSd / 1e6, 2)).toBe(2.3);
    expect(r(N5.priceAnswerMean / 1e6, 2)).toBe(3.52);
    expect(r(N5.priceAnswerLoss * 100, 1)).toBe(4.1);
    expect(priceSolved(DESK_DEFAULTS)).toBe(false);
    expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15 })).toBe(true);
    expect(priceSolved({ ...DESK_DEFAULTS, price: 1.14 })).toBe(false);
    expect(priceSolved({ ...DESK_DEFAULTS, price: 1.16 })).toBe(false);
    expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15, hedge: 5 })).toBe(false);
    expect(priceSolved({ ...DESK_DEFAULTS, price: 1.15, failure: 2.5 })).toBe(false);
    expect(startingWorld({ ...DESK_DEFAULTS, price: 1.15, hedgePrice: 1.6 })).toBe(true);
  });

  it('challenge b: the forward sale narrows the paths', () => {
    expect(r(N5.sd / 1e6, 2)).toBe(2.3);
    expect(r(N5.hedgeAnswerSd / 1e6, 2)).toBe(0.92);
  });

  it('challenge c: the rank is the chance of loss times the paths, plus one', () => {
    for (const s of [DESK_DEFAULTS, { ...DESK_DEFAULTS, hedge: 60 }, { ...DESK_DEFAULTS, price: 1.15 }]) {
      const first = firstProfitableRank(s);
      expect(first).toBe(Math.round(deskRun(s).probLoss * 1000) + 1);
      expect(pathSolved(s, first)).toBe(true);
      expect(pathSolved(s, first - 1)).toBe(false);
      expect(pathSolved(s, first + 1)).toBe(false);
    }
    expect(firstProfitableRank(DESK_DEFAULTS)).toBe(227);
    expect(pathSolved(DESK_DEFAULTS, 51)).toBe(false);
  });
});
