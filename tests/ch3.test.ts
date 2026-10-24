// Chapter 3 engines, and checks that every Chapter 3 challenge can be reached with a sensible strategy.

import { describe, expect, it } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  EVENING_FALL,
  GAME,
  ISLAND,
  forecastAt,
  gameDemand,
  inBandShare,
  inBandShareBetween,
  initialGame,
  initialSetpoints,
  islandBeta,
  kineticEnergy,
  stepGame,
  stepResponse,
  summarizeStep,
} from '../src/engines/ops/balancing';
import { DEFAULT_FREQUENCY, simulateTrip } from '../src/engines/ops/frequency';
import { simulateEvent } from '../src/engines/ops/frequencyEvent';
import { eveningRamp, scheduleCommitted, scheduleDay, weatherDay, weatherDays, hoursOn, type Commitment } from '../src/engines/ops/scheduler';
import { energyAbove, lowestPeak, shaveSchedule, withBattery } from '../src/engines/ops/peakShave';
import {
  EV_FLEET,
  FLEX_BLOCKS,
  allowedStarts,
  baseLoad,
  blockCost,
  clampStart,
  evLoad,
  flatten,
  referencePrices,
  systemLoad,
  usualStarts,
} from '../src/engines/ops/loadShift';
import {
  CR_FIXED,
  CR_SCENARIO,
  CR_SPS,
  CR_UNITS,
  INTERCONNECTION_BETA,
  allocateAgc,
  crForecast,
  initialControlRoom,
  scheduleSetpoints,
  stepControlRoom,
  type CRState,
} from '../src/engines/ops/controlRoom';
import { computePtdf } from '../src/engines/physics/powerflow';
import { solveLP } from '../src/engines/market/lp';
import { estimateState } from '../src/engines/ops/stateEstimation';
import { REGION, REGION_LOAD_SHARE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { runSolves, TARGET as GAME_TARGET, type RunResult } from '../src/lessons/ch3/L3_1';
import { CHALLENGE_SHARE, FFR_NEEDED, inverterSolves } from '../src/lessons/ch3/L3_2';
import { MUST_RUN_FLOOR, commitSolves } from '../src/lessons/ch3/L3_3';
import { BEST_COST, cost as shiftCost, shiftSolves } from '../src/lessons/ch3/L3_5';

const cost = (id: string) => STANDARD_FLEET.find((g) => g.id === id)!.marginalCost;

// ---------------------------------------------------------------------------
describe('3.1 balancing game', () => {
  const FIXED = GAME.fixed.reduce((s, u) => s + u.mw, 0);
  const allocate = (total: number) => {
    const sp: Record<string, number> = {};
    let left = Math.max(0, total);
    for (const u of GAME.controlled) {
      sp[u.id] = Math.min(u.capacity, left);
      left -= sp[u.id];
    }
    return sp;
  };
  /**
   * A player who looks at the forecast every `every` simulated minutes and sets plants `lead` minutes ahead, rounding to `quant` MW;
   * or, with `react`, one who sets them to cover the demand of the moment.
   */
  function play(seed: number, opts: { every: number; lead: number; agc: boolean; quant?: number; idle?: boolean; react?: boolean }) {
    const d = gameDemand(seed);
    let s = initialGame(d);
    let sp = initialSetpoints(d);
    const dt = GAME.minutesPerSecond / 60; // one frame at 60 fps
    let last = -1e9;
    while (!s.done) {
      if (!opts.idle && s.t - last >= opts.every) {
        last = s.t;
        let tot = (opts.react ? s.demand : forecastAt(s.t + opts.lead)) - FIXED - (opts.agc ? GAME.agcBase : s.agcOut);
        if (opts.quant) tot = Math.round(tot / opts.quant) * opts.quant;
        sp = allocate(tot);
      }
      s = stepGame(s, sp, opts.agc, dt, d);
    }
    return s;
  }

  it('the forecast climbs 120 MW from 06:30 to 07:30 and falls 165 MW from 21:30 to 22:30, its steepest hours', () => {
    expect(forecastAt(7.5 * 60) - forecastAt(6.5 * 60)).toBeCloseTo(120, 6);
    expect(forecastAt(21.5 * 60) - forecastAt(22.5 * 60)).toBeCloseTo(165, 6);
    let rise = 0;
    let fall = 0;
    for (let t = 0; t <= 1380; t++) {
      rise = Math.max(rise, forecastAt(t + 60) - forecastAt(t));
      fall = Math.max(fall, forecastAt(t) - forecastAt(t + 60));
    }
    expect(rise).toBeLessThan(122);
    expect(fall).toBeLessThan(167);
    expect(fall).toBeGreaterThan(rise); // the evening fall is faster than the morning climb
  });

  it('the island responds with about 40 MW per 0.1 Hz', () => {
    expect(islandBeta(GAME, ISLAND.loadMW)).toBeCloseTo(395.4, 0);
    expect(kineticEnergy(ISLAND)).toBe(7375);
  });

  it('days are deterministic given a seed', () => {
    expect(gameDemand(3)).toEqual(gameDemand(3));
    expect(gameDemand(3)[600]).not.toEqual(gameDemand(4)[600]);
  });

  const result = (s: ReturnType<typeof play>): RunResult => ({
    share: inBandShare(s),
    evening: inBandShareBetween(s, EVENING_FALL.from, EVENING_FALL.to) ?? 0,
    agcTime: s.agcTime,
  });

  it('the evening window brackets the steepest hour, and is empty before the day reaches it', () => {
    expect(EVENING_FALL.from).toBeLessThanOrEqual(21.5 * 60);
    expect(EVENING_FALL.to).toBeGreaterThanOrEqual(22.5 * 60);
    const d = gameDemand(1);
    expect(inBandShareBetween(initialGame(d), EVENING_FALL.from, EVENING_FALL.to)).toBeNull();
    // In the steepest hour demand falls faster than Mill Creek can ramp, and Mill Creek needs 20 minutes to move 50 MW.
    const mill = GAME.controlled.find((u) => u.id === 'cc2')!.rampPerHour;
    expect(forecastAt(21.5 * 60) - forecastAt(22.5 * 60)).toBeGreaterThan(mill);
    expect((50 / mill) * 60).toBe(20);
  });

  it('the challenge: doing nothing fails; leading the forecast by 20–30 minutes solves it', () => {
    expect(GAME_TARGET).toBe(0.8);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(runSolves(result(play(seed, { every: 1e9, lead: 0, agc: false, idle: true })))).toBe(false);
      // Adjusting every two real seconds (20 simulated minutes), 20 minutes ahead.
      const r = play(seed, { every: 20, lead: 20, agc: false });
      expect(r.agcTime).toBe(0);
      expect(runSolves(result(r))).toBe(true);
      // A coarser player: every three seconds, half an hour ahead, to the nearest 10 MW.
      expect(runSolves(result(play(seed, { every: 30, lead: 30, agc: false, quant: 10 })))).toBe(true);
    }
  });

  it('lagging the forecast can still pass 80% of the day, but not the evening fall', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      // Setting the plants for the demand of the moment, every two real seconds.
      const lag = result(play(seed, { every: 20, lead: 0, agc: false, react: true }));
      expect(lag.share).toBeGreaterThanOrEqual(0.8);
      expect(lag.evening).toBeLessThan(0.5);
      expect(runSolves(lag)).toBe(false);
      // Following the forecast with no lead.
      expect(runSolves(result(play(seed, { every: 20, lead: 0, agc: false })))).toBe(false);
    }
    // A run with AGC on never counts.
    const withAgc = result(play(1, { every: 20, lead: 20, agc: true }));
    expect(withAgc.share).toBeGreaterThan(0.8);
    expect(runSolves(withAgc)).toBe(false);
  });

  it('AGC takes care of the minute-to-minute error', () => {
    expect(inBandShare(play(1, { every: 30, lead: 15, agc: true }))).toBeGreaterThan(0.95);
  });

  it('stays finite at slider extremes', () => {
    const d = gameDemand(1);
    for (const v of [0, 1000]) {
      let s = initialGame(d);
      const sp = Object.fromEntries(GAME.controlled.map((u) => [u.id, v]));
      for (let k = 0; k < 400; k++) s = stepGame(s, sp, true, 4, d);
      expect(s.done).toBe(true);
      expect(Number.isFinite(s.df)).toBe(true);
      expect(Math.abs(s.df)).toBeLessThanOrEqual(2);
    }
  });

  it('a load step is met by inertia, then governors, then AGC and dispatch', () => {
    const r = stepResponse(ISLAND, 50);
    for (const p of r) expect(p.inertia + p.loadRelief + p.governors + p.agc + p.dispatch).toBeCloseTo(50, 0);
    expect(r[0].inertia).toBeGreaterThan(49);
    const s = summarizeStep(r);
    // The governors stop the fall within seconds (the game's quasi-steady frequency relies on this).
    for (const step of [10, 50, 100]) expect(summarizeStep(stepResponse(ISLAND, step)).nadirT).toBeLessThan(10);
    expect(s.nadir).toBeCloseTo(59.72, 2);
    expect(s.at30).toBeCloseTo(59.88, 2);
    expect(s.restored! / 60).toBeLessThan(7);
    expect(r[r.length - 1].dispatch).toBeCloseTo(50, 0);
    // Without governors the frequency keeps sliding for about half a minute, far below 59.3 Hz.
    const noGov = summarizeStep(stepResponse(ISLAND, 50, { governors: false }));
    expect(noGov.nadir).toBeLessThan(59.3);
    expect(noGov.nadirT).toBeGreaterThan(25);
    expect(noGov.nadirT).toBeLessThan(40);
    expect(summarizeStep(stepResponse(ISLAND, 50, { agc: false, dispatch: false })).restored).toBeNull();
    // Without AGC it sits low until the next dispatch run, then recovers.
    const noAgc = stepResponse(ISLAND, 50, { agc: false });
    const at = (sec: number) => noAgc.reduce((b, p) => (Math.abs(p.t - sec) < Math.abs(b.t - sec) ? p : b), noAgc[0]);
    expect(Math.abs(at(240).f - at(30).f)).toBeLessThan(0.005);
    expect(summarizeStep(noAgc).restored!).toBeGreaterThan(ISLAND.dispatchAt);
    for (const step of [10, 100]) for (const g of [true, false]) expect(stepResponse(ISLAND, step, { governors: g }).every((p) => Number.isFinite(p.f))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('3.2 frequency', () => {
  const D = DEFAULT_FREQUENCY;
  const inverter = (share: number, ffr: number) => ({
    ...D,
    onlineMW: D.onlineMW * (1 - share),
    governorMW: D.governorMW * (1 - share),
    headroomMW: D.headroomMW * (1 - share),
    fastMW: ffr,
  });

  it('the event wrapper reproduces simulateTrip while frequency stays low and nothing is shed', () => {
    for (const over of [{}, { inertiaH: 2 }, { fastMW: 600 }, { droop: 0.08 }]) {
      const a = simulateTrip({ ...D, ...over }, 1000, 30, 0.05);
      const b = simulateEvent({ ...D, ...over }, 1000, 30, 0.05);
      expect(b.samples.length).toBe(a.samples.length);
      expect(b.nadir).toBeCloseTo(a.nadir, 3);
      expect(b.settled).toBeCloseTo(a.settled, 3);
    }
  });

  it('matches the numbers in the prose', () => {
    const r = simulateEvent(D, 1000, 30, 0.05);
    expect(r.rocof).toBeCloseTo(-0.3, 6);
    expect(r.nadir).toBeCloseTo(59.6, 2);
    expect(r.nadirT).toBeCloseTo(2.45, 1);
    expect(r.samples[r.samples.length - 1].f).toBeCloseTo(59.82, 2);
    expect(simulateEvent(D, 1600, 30, 0.05).shedMW).toBe(0);
    expect(simulateEvent(D, 1650, 30, 0.05).shedMW).toBeGreaterThan(0);
    const half = simulateEvent({ ...D, inertiaH: 2.5 }, 1000, 30, 0.05);
    expect(half.nadir).toBeCloseTo(59.48, 2);
    // Halving the inertia makes the lowest point come sooner, not later.
    expect(half.nadirT).toBeCloseTo(1.6, 1);
    expect(half.nadirT).toBeLessThan(r.nadirT);
    // A smaller droop percentage settles closer to 60 Hz.
    expect(simulateEvent({ ...D, droop: 0.03 }, 1000, 30, 0.05).settled).toBeGreaterThan(r.settled);
    expect(simulateEvent({ ...D, droop: 0.1 }, 1000, 30, 0.05).settled).toBeLessThan(r.settled);
  });

  it('load relief covers a headroom shortfall until headroom drops to 750 MW', () => {
    expect((D.damping * D.loadMW) / D.f0).toBe(450);
    const h900 = simulateEvent({ ...D, headroomMW: 900 }, 1000, 30, 0.05);
    expect(h900.shedMW).toBe(0);
    expect(h900.nadir).toBeCloseTo(59.41, 2);
    expect(simulateEvent({ ...D, headroomMW: 751 }, 1000, 30, 0.05).shedMW).toBe(0);
    expect(simulateEvent({ ...D, headroomMW: 750 }, 1000, 30, 0.05).shedMW).toBeGreaterThan(0);
  });

  it('the low-inertia challenge: 650 MW of fast response is the least that keeps the 70% trip from shedding load', () => {
    expect(CHALLENGE_SHARE).toBe(0.7);
    expect(FFR_NEEDED).toBe(650);
    expect(simulateEvent(inverter(0.7, 0), 1200, 30, 0.05).shedMW).toBeGreaterThan(0);
    expect(simulateEvent(inverter(0.7, 600), 1200, 30, 0.05).shedMW).toBeGreaterThan(0);
    expect(simulateEvent(inverter(0.7, 650), 1200, 30, 0.05).shedMW).toBe(0);
    // The default is unsolved; the smallest step solves it; more than enough, or another share, doesn't.
    expect(inverterSolves({ share: 0.3, ffr: 0, shed: 0 })).toBe(false);
    expect(inverterSolves({ share: 0.7, ffr: 650, shed: 0 })).toBe(true);
    expect(inverterSolves({ share: 0.7, ffr: 700, shed: 0 })).toBe(false);
    expect(inverterSolves({ share: 0.7, ffr: 600, shed: 900 })).toBe(false);
    expect(inverterSolves({ share: 0.5, ffr: 300, shed: 0 })).toBe(false);
    // The success text: more than half the loss, a fall of 1.2 Hz/s, and for the first seconds more than the governors give.
    expect(FFR_NEEDED).toBeGreaterThan(1200 / 2);
    const r = simulateEvent(inverter(0.7, 650), 1200, 30, 0.05);
    expect(r.rocof).toBeCloseTo(-1.2, 6);
    for (const q of r.samples) if (q.t >= 1 && q.t <= 5) expect(q.governor).toBeLessThan(q.fast);
  });

  it('matches the prose about wind and solar shares', () => {
    expect(simulateEvent(inverter(0.3, 0), 1200, 30, 0.05).shedMW).toBe(0);
    // "only just"
    expect(simulateEvent(inverter(0.3, 0), 1200, 30, 0.05).nadir - 59.3).toBeLessThan(0.05);
    const half = simulateEvent(inverter(0.5, 0), 1200, 30, 0.05);
    expect(half.shedMW).toBeGreaterThan(0);
    // Shedding starts about 1.4 s in, when the governors have made up less than a third of the loss — though their headroom exceeds it.
    const first = half.samples.find((q) => q.shed > 0)!;
    expect(first.t).toBeCloseTo(1.35, 1);
    expect(first.governor).toBeLessThan(1200 / 3);
    expect(D.headroomMW * 0.5).toBeGreaterThan(1200);
    // At 80%, even the largest response is too slow: shedding starts before the batteries reach full output.
    const eighty = simulateEvent(inverter(0.8, 1500), 1200, 30, 0.05);
    expect(eighty.shedMW).toBeGreaterThan(0);
    const armed = eighty.samples.find((q) => q.f < D.fastTrigger)!.t;
    expect(eighty.samples.find((q) => q.shed > 0)!.t).toBeLessThan(armed + D.fastDelay + 0.2);
  });

  it('the lower chart shows the trend: how far the frequency would fall with no shedding keeps dropping with share', () => {
    const noShed = (share: number, ffr: number) => simulateEvent({ ...inverter(share, ffr), ufls: [] }, 1200, 6, 0.05).nadir;
    const shares = Array.from({ length: 17 }, (_, i) => i * 0.05);
    const curve = shares.map((sh) => noShed(sh, 0));
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThan(curve[i - 1]);
    expect(curve[curve.length - 1]).toBeLessThan(58.5);
    expect(curve[curve.length - 1]).toBeGreaterThan(58); // inside the chart
    // With shedding, the lowest point flattens at the first stage — what the old chart showed.
    expect(simulateEvent(inverter(0.6, 0), 1200, 30, 0.05).nadir).toBeCloseTo(59.3, 1);
    // Fast response lifts the curve most at high shares, and stops the fall sooner.
    expect(noShed(0.7, 650) - noShed(0.7, 0)).toBeGreaterThan(3 * (noShed(0, 650) - noShed(0, 0)));
    for (const sh of [0.3, 0.5, 0.7]) {
      const a = simulateEvent({ ...inverter(sh, 0), ufls: [] }, 1200, 30, 0.05);
      const b = simulateEvent({ ...inverter(sh, 650), ufls: [] }, 1200, 30, 0.05);
      expect(b.nadirT).toBeLessThan(a.nadirT);
    }
  });

  it('at the nadir the governors and load relief replace the whole loss, so the kinetic-energy band has closed', () => {
    const r = simulateEvent(D, 1000, 30, 0.05);
    const q = r.samples.find((x) => Math.abs(x.t - r.nadirT) < 0.026)!;
    const relief = (D.damping * (D.loadMW - q.shed) * (D.f0 - q.f)) / D.f0;
    expect(q.governor + relief + q.shed).toBeCloseTo(1000, -1);
    // Then the governors overshoot the loss for a few seconds, and the frequency recovers toward where it settles.
    const after = r.samples.filter((x) => x.t > r.nadirT);
    expect(Math.max(...after.map((x) => x.governor))).toBeGreaterThan(1000);
    expect(r.settled).toBeGreaterThan(r.nadir + 0.1);
    // The interconnection shrugs off the game's everyday wobbles: 40 MW moves it less than 0.01 Hz.
    expect(40 / INTERCONNECTION_BETA).toBeLessThan(0.01);
  });

  it('stays physical at slider extremes', () => {
    for (const lost of [100, 3000])
      for (const H of [1, 8])
        for (const headroom of [0, 4000])
          for (const ffr of [0, 1500]) {
            const r = simulateEvent({ ...D, inertiaH: H, headroomMW: headroom, droop: 0.1, fastMW: ffr }, lost, 30, 0.05);
            const fs = r.samples.map((s) => s.f);
            expect(fs.every(Number.isFinite)).toBe(true);
            expect(Math.max(...fs)).toBeLessThan(60.5);
            expect(Math.min(...fs)).toBeGreaterThan(58);
          }
  });
});

// ---------------------------------------------------------------------------
describe('3.3 scheduling', () => {
  it('picks four distinct weather days', () => {
    const days = weatherDays();
    expect(days.map((d) => d.id)).toEqual(['clear', 'cloudy', 'calm', 'windy']);
    expect(new Set(days.map((d) => d.historyDay)).size).toBe(4);
  });

  it('balances every hour and never runs short with the full fleet', () => {
    for (const d of weatherDays())
      for (const solar of [0, 1200, 2400])
        for (const wind of [0, 1400]) {
          const s = scheduleDay(d, solar, wind);
          expect(s.shortfallMWh).toBeLessThan(0.5);
          s.hours.forEach((h, i) => {
            const gen = Object.values(h.output).reduce((a, b) => a + b, 0);
            expect(gen + h.shortfall - h.overGeneration).toBeCloseTo(d.demand[i], 6);
          });
        }
  });

  it('matches the numbers in the prose', () => {
    const ref = scheduleDay(weatherDay('clear'), 400, 350);
    expect(Math.min(...ref.net)).toBeCloseTo(578.5, 1);
    expect(Math.max(...ref.net)).toBeCloseTo(1300, 6);
    expect(ref.curtailedMWh).toBe(0);
    expect(scheduleDay(weatherDay('clear'), 800, 350).curtailedMWh).toBe(0);
    expect(scheduleDay(weatherDay('clear'), 850, 350).curtailedMWh).toBeGreaterThan(0);
    expect(Math.min(...scheduleDay(weatherDay('clear'), 1600, 350).net)).toBeLessThan(0);
    // Curtailment starts once the midday net load falls below Harbor Point's floor.
    const nucMin = STANDARD_FLEET.find((g) => g.id === 'nuc')!.minOutput;
    expect(Math.min(...scheduleDay(weatherDay('clear'), 800, 350).net)).toBeGreaterThan(nucMin);
    expect(Math.min(...scheduleDay(weatherDay('clear'), 850, 350).net)).toBeLessThan(nucMin);
  });

  it('Harbor Point and Ironwood alone force out 4,856 MWh; neither gas plant is needed before 17:00', () => {
    const calm = weatherDay('calm');
    const plan = (a: number, b: number): Commitment => ({ cc1: hoursOn(a, 23), cc2: hoursOn(b, 22) });
    const def = scheduleCommitted(calm, 1600, 350, plan(6, 7));
    const floor = scheduleCommitted(calm, 1600, 350, { cc1: hoursOn(0, 0), cc2: hoursOn(0, 0) }).curtailedMWh;
    expect(def.curtailedMWh).toBeCloseTo(7097, 0);
    expect(floor).toBeCloseTo(4856, 0);
    expect(def.curtailedMWh - floor).toBeCloseTo(2241, 0);
    // Both offline until 17:00: served, at the floor.
    const late = scheduleCommitted(calm, 1600, 350, plan(17, 17));
    expect(late.shortfallMWh).toBeLessThan(0.5);
    expect(late.curtailedMWh).toBeCloseTo(floor, 6);
    // Lakeside back at 17:00 is enough on its own; if neither is back by 17:00, the evening goes unserved.
    expect(scheduleCommitted(calm, 1600, 350, plan(17, 24)).shortfallMWh).toBeLessThan(0.5);
    for (let a = 18; a <= 24; a++) for (let b = 18; b <= 24; b++) expect(scheduleCommitted(calm, 1600, 350, plan(a, b)).shortfallMWh).toBeGreaterThan(0.5);
  });

  it('the commitment challenge: down to the must-run floor, with one plant back at 17:00 exactly', () => {
    const calm = weatherDay('calm');
    const run = (p: Commitment) => scheduleCommitted(calm, 1600, 350, p);
    expect(MUST_RUN_FLOOR).toBeCloseTo(4856, 0);
    // The default plan is served but over the floor, so unsolved.
    const def = run({ cc1: hoursOn(6, 23), cc2: hoursOn(7, 22) });
    expect(def.shortfallMWh).toBeLessThan(0.5);
    expect(commitSolves(def)).toBe(false);
    const off = (from: number, to: number): Commitment => ({
      cc1: hoursOn(6, 23).map((v, h) => v && !(h >= from && h < to)),
      cc2: hoursOn(7, 22).map((v, h) => v && !(h >= from && h < to)),
    });
    // Both offline from 08:00 until 17:00 solves it; so does Lakeside alone from 17:00.
    const good = run(off(8, 17));
    expect(commitSolves(good)).toBe(true);
    expect(good.overGenMWh).toBeLessThan(0.5);
    expect(commitSolves(run({ cc1: hoursOn(17, 23), cc2: hoursOn(0, 0) }))).toBe(true);
    expect(commitSolves(run({ cc1: hoursOn(18, 23), cc2: hoursOn(17, 22) }))).toBe(true);
    // An hour too early pushes solar off; an hour too late leaves the evening short; the old 5,100 MWh answer isn't enough.
    expect(run({ cc1: hoursOn(16, 23), cc2: hoursOn(0, 0) }).curtailedMWh).toBeGreaterThan(MUST_RUN_FLOOR + 100);
    expect(run({ cc1: hoursOn(0, 0), cc2: hoursOn(16, 22) }).curtailedMWh).toBeGreaterThan(MUST_RUN_FLOOR + 50);
    expect(run(off(8, 18)).shortfallMWh).toBeGreaterThan(0.5);
    expect(commitSolves(run(off(9, 17)))).toBe(false);
    expect(run(off(9, 17)).curtailedMWh).toBeLessThan(5100);
    // An online plant never runs below its minimum; an offline one produces nothing.
    good.output.cc1.forEach((v, h) => (off(8, 17).cc1[h] ? expect(v).toBeGreaterThanOrEqual(160 - 1e-9) : expect(v).toBe(0)));
  });

  it('on the reference day the fleet follows the net load easily: its steepest climb is under a third of the fleet’s ramp', () => {
    const fleetRamp = STANDARD_FLEET.filter((g) => !g.variable).reduce((a, g) => a + g.rampRate, 0);
    expect(eveningRamp(scheduleDay(weatherDay('clear'), 400, 350).net).mw).toBeLessThan(fleetRamp / 3);
  });

  it('solar does nothing for the evening, and the region’s wind blows harder after dark', () => {
    for (let h = 19; h < 24; h++) expect(SOLAR_CF[h]).toBe(0);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean([...WIND_CF.slice(19), ...WIND_CF.slice(0, 6)])).toBeGreaterThan(mean(WIND_CF.slice(7, 18)));
  });
});

// ---------------------------------------------------------------------------
describe('3.4 batteries', () => {
  const NET = SYSTEM_DEMAND.map((d, h) => d - 350 * WIND_CF[h] - 400 * SOLAR_CF[h]);
  const bat = (power: number, energy: number) => ({ id: 'b', powerMW: power, energyMWh: energy, efficiency: 0.85, soc0: 0 });

  it('power limits depth, energy limits width', () => {
    expect(lowestPeak(NET, bat(100, 400))).toBeCloseTo(1200, 6);
    expect(lowestPeak(NET, bat(100, 200))).toBeCloseTo(1201.9, 1);
    expect(lowestPeak(NET, bat(200, 400))).toBeCloseTo(1140.4, 1);
    expect(lowestPeak(NET, bat(200, 800))).toBeCloseTo(1100, 6);
    expect(energyAbove(NET, 1200).mwh).toBeCloseTo(190, 6);
    expect(lowestPeak(NET, bat(0, 400))).toBe(Math.max(...NET));
  });

  it('the optimal schedule achieves the lowest peak with the battery model', () => {
    for (const [p, e] of [
      [100, 200],
      [200, 400],
      [400, 1600],
    ]) {
      const b = bat(p, e);
      const cap = lowestPeak(NET, b);
      const r = withBattery(NET, b, shaveSchedule(NET, b, cap));
      expect(r.peakAfter).toBeCloseTo(cap, 3);
      expect(r.dischargedMWh).toBeCloseTo(r.chargedMWh * 0.85, 3);
    }
  });

  it('the default schedule misses the peak; a hand-drawn one reaches the challenge', () => {
    const def = Array.from({ length: 24 }, (_, h) => (h >= 1 && h <= 3 ? -100 : h === 16 || h === 17 ? 100 : 0));
    const d = withBattery(NET, bat(100, 200), def);
    expect(d.peakAfter).toBeCloseTo(1300, 6);
    expect(d.soc[17]).toBeGreaterThan(0);
    expect(d.soc[18]).toBeCloseTo(0, 6); // empty by 18:00, before the 19:00 peak
    const hand = Array<number>(24).fill(0);
    hand[1] = -100;
    hand[2] = -90;
    hand[18] = 50;
    hand[19] = 90;
    hand[20] = 30;
    expect(withBattery(NET, bat(100, 200), hand).peakAfter).toBeLessThanOrEqual(1215);
  });

  it('the challenge forces the depth–width trade-off: full power for the two highest hours misses it', () => {
    // Fully charged, then 100 MW at 18:00 and 19:00: the battery is empty by 20:00, still above the target.
    const naive = Array<number>(24).fill(0);
    naive[1] = -100;
    naive[2] = -100;
    naive[3] = -35;
    naive[18] = 100;
    naive[19] = 100;
    const r = withBattery(NET, bat(100, 200), naive);
    expect(r.soc[18]).toBeCloseTo(200, 6);
    expect(r.peakAfter).toBeGreaterThan(1215);
    // Three hours sit above the target, and covering them takes most of the battery.
    expect(NET.filter((v) => v > 1215).length).toBe(3);
    expect(energyAbove(NET, 1215).mwh / Math.sqrt(0.85)).toBeGreaterThan(0.75 * 200);
    // Power isn't what binds: 1,215 MW is less than 100 MW below the peak, and 1,200 is out of reach for lack of energy.
    expect(Math.max(...NET) - 1215).toBeLessThan(100);
    expect(lowestPeak(NET, bat(100, 200))).toBeGreaterThan(1200);
  });
});

// ---------------------------------------------------------------------------
describe('3.5 load shifting', () => {
  const base = baseLoad();
  const prices = referencePrices().prices;

  it('the blocks at their usual times rebuild the reference day', () => {
    systemLoad(base, FLEX_BLOCKS, usualStarts()).forEach((v, h) => expect(v).toBeCloseTo(SYSTEM_DEMAND[h], 9));
  });

  it('every placement keeps each block’s energy and window', () => {
    const total = FLEX_BLOCKS.reduce((s, b) => s + b.mw * b.hours, 0);
    for (const b of FLEX_BLOCKS) {
      for (const s of allowedStarts(b)) {
        expect(s).toBeGreaterThanOrEqual(b.earliest);
        expect(s + b.hours).toBeLessThanOrEqual(b.latest);
      }
      expect(clampStart(b, -50)).toBe(b.earliest);
      expect(clampStart(b, 99)).toBe(b.latest - b.hours);
    }
    const starts = Object.fromEntries(FLEX_BLOCKS.map((b) => [b.id, b.latest - b.hours]));
    const load = systemLoad(base, FLEX_BLOCKS, starts);
    expect(load.reduce((a, b) => a + b, 0) - base.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 9);
  });

  it('the challenge: the cheapest placement that keeps the peak at the inflexible load’s own', () => {
    const basePeak = Math.max(...base);
    expect(basePeak).toBe(1310);
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, usualStarts()))).toBe(1440);
    const bill = (st: Record<string, number>) => FLEX_BLOCKS.reduce((s, b) => s + blockCost(b, st[b.id], prices), 0);
    expect(shiftCost(usualStarts())).toBeCloseTo(bill(usualStarts()), 6);
    // The default is unsolved; the old answer (peak held, cars at 01:00, water at 12:00) isn't cheap enough.
    expect(shiftSolves(usualStarts())).toBe(false);
    const moved = { ...usualStarts(), ev: 25, water: 12 };
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, moved))).toBeLessThanOrEqual(basePeak);
    expect(shiftSolves(moved)).toBe(false);
    // flatten's placement solves it.
    const best = flatten(base, FLEX_BLOCKS, prices);
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, best))).toBe(basePeak);
    expect(bill(best)).toBeCloseTo(BEST_COST, 6);
    expect(shiftSolves(best)).toBe(true);
    expect(1 - BEST_COST / bill(usualStarts())).toBeCloseTo(0.24, 2);
    // Each load in its own cheapest hours makes a new midday peak, 1,363 MW at 11:00.
    const cheapest = Object.fromEntries(FLEX_BLOCKS.map((b) => [b.id, allowedStarts(b).reduce((x, st) => (blockCost(b, st, prices) < blockCost(b, x, prices) - 1e-9 ? st : x))]));
    const cl = systemLoad(base, FLEX_BLOCKS, cheapest);
    expect(Math.max(...cl)).toBe(1363);
    expect(cl.indexOf(1363)).toBe(11);
    expect(shiftSolves(cheapest)).toBe(false);
    // Every solution: cars entirely in the cheapest night hours, water heating and the batch at midday, pre-cooling from 13:00 paying more for its last hour.
    const low = Math.min(...prices);
    const sols: Array<Record<string, number>> = [];
    const rec = (i: number, st: Record<string, number>) => {
      if (i === FLEX_BLOCKS.length) {
        if (shiftSolves(st)) sols.push({ ...st });
        return;
      }
      for (const x of allowedStarts(FLEX_BLOCKS[i])) rec(i + 1, { ...st, [FLEX_BLOCKS[i].id]: x });
    };
    rec(0, {});
    expect(sols.length).toBeGreaterThan(0);
    for (const st of sols) {
      for (let k = 0; k < 3; k++) {
        const h = (st.ev + k) % 24;
        expect(h < 7 || h >= 23).toBe(true);
        expect(prices[h]).toBe(low);
      }
      expect(st.water).toBeGreaterThanOrEqual(10);
      expect(st.water + 3).toBeLessThanOrEqual(15);
      expect(st.batch).toBeGreaterThanOrEqual(10);
      expect(st.batch + 4).toBeLessThanOrEqual(15);
      expect(st.cool).toBe(best.cool);
      expect(prices[st.cool + 2]).toBeGreaterThan(low);
    }
    expect(best.cool).toBe(13);
  });

  it('the price lane varies enough to matter', () => {
    expect(Math.max(...prices) - Math.min(...prices)).toBeGreaterThan(14);
    expect(new Set(prices).size).toBeGreaterThan(3);
  });

  it('a shared timer creates a new peak once the fleet is large enough', () => {
    expect(evLoad(EV_FLEET, 'arrival').reduce((a, b) => a + b, 0)).toBeCloseTo((EV_FLEET.cars * EV_FLEET.kWhEach) / 1000, 6);
    for (const p of ['timer', 'smart'] as const) expect(evLoad(EV_FLEET, p).reduce((a, b) => a + b, 0)).toBeCloseTo(480, 6);
    const peakWith = (cars: number, p: 'arrival' | 'timer' | 'smart') => Math.max(...SYSTEM_DEMAND.map((d, h) => d + evLoad({ ...EV_FLEET, cars }, p)[h]));
    expect(peakWith(40000, 'timer')).toBe(1440);
    expect(peakWith(70000, 'timer')).toBeGreaterThan(1440);
    expect(peakWith(150000, 'smart')).toBe(1440);
    expect(peakWith(40000, 'arrival')).toBeGreaterThan(1500);
    // The timer's spike, at its start hour, passes the evening peak without the cars beyond about 69,000 cars.
    expect(peakWith(65000, 'timer')).toBe(1440);
    const at = (cars: number) => SYSTEM_DEMAND.map((d, h) => d + evLoad({ ...EV_FLEET, cars }, 'timer')[h]);
    expect(at(70000).indexOf(Math.max(...at(70000)))).toBe(EV_FLEET.timerStart);
  });

  it('the cars’ window is one of the widest and the only one that crosses midnight', () => {
    const width = (b: (typeof FLEX_BLOCKS)[number]) => b.latest - b.earliest;
    const ev = FLEX_BLOCKS.find((b) => b.id === 'ev')!;
    expect(FLEX_BLOCKS.filter((b) => width(b) > width(ev)).length).toBe(1);
    expect(FLEX_BLOCKS.filter((b) => b.latest > 24).map((b) => b.id)).toEqual(['ev']);
    // The batch process, not the cars, uses the most energy.
    expect(Math.max(...FLEX_BLOCKS.map((b) => b.mw * b.hours))).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('3.6 control room', () => {
  type Policy = (s: CRState) => Record<string, number>;
  function run(policy: Policy, agc = true) {
    let s = initialControlRoom();
    const dt = CR_SCENARIO.minutesPerSecond / 60;
    while (!s.done) {
      s = stepControlRoom(s, policy(s), agc, dt);
      expect(Number.isFinite(s.ace)).toBe(true);
    }
    return s;
  }
  const ok = (s: CRState) => s.shedMWh < 0.5 && s.sustainedOverloads.length === 0;

  /** An operator who keeps to merit order on the actual demand, watches the contingency table, and shifts Ironwood's output into Metro when West–Metro is threatened. */
  function n1Operator(): Policy {
    let coalCap = 300;
    let lastAdj = -1e9;
    let lastSp = -1e9;
    let sp: Record<string, number> = {};
    return (s) => {
      const wc = Math.abs(s.flows['west-city']) / 300;
      const threat = s.contingency.some((c) => c.worst === 'west-city' && c.loading > 1) || wc > 0.95;
      if (s.t - lastAdj >= 5) {
        lastAdj = s.t;
        if (threat) coalCap = Math.max(120, coalCap - 10);
        else if (wc < 0.85) coalCap = Math.min(300, coalCap + 10);
      }
      if (s.t - lastSp >= 10) {
        lastSp = s.t;
        let left = s.demand + 15 - CR_FIXED.mw - s.wind - s.solar;
        sp = {};
        for (const u of [...CR_UNITS].sort((a, b) => cost(a.id) - cost(b.id))) {
          if (s.trippedUnits.includes(u.id)) {
            sp[u.id] = 0;
            continue;
          }
          const cap = u.id === 'hydro' ? 100 : u.id === 'coal' ? coalCap : u.capacity;
          sp[u.id] = Math.max(0, Math.min(cap, left));
          left -= sp[u.id];
        }
        if (s.ace < -60) for (const id of ['ct', 'oil', 'cc1']) if (!s.trippedUnits.includes(id)) sp[id] = CR_UNITS.find((u) => u.id === id)!.capacity;
      }
      return sp;
    };
  }

  it('the scenario is deterministic', () => {
    const a = run(() => scheduleSetpoints(CR_SCENARIO.start));
    const b = run(() => scheduleSetpoints(CR_SCENARIO.start));
    expect(a.shedMWh).toBe(b.shedMWh);
    expect(a.ace).toBe(b.ace);
  });

  it('a passive operator overloads West–Metro, and sheds load without AGC; following the day-ahead plan overloads West–Metro', () => {
    const sp0 = scheduleSetpoints(CR_SCENARIO.start);
    const passive = run(() => sp0);
    expect(passive.sustainedOverloads).toContain('west-city');
    expect(run(() => sp0, false).shedMWh).toBeGreaterThan(0);
    const plan = run((s) => scheduleSetpoints(s.t, s.trippedUnits));
    expect(plan.sustainedOverloads).toContain('west-city');
  });

  it('AGC keeps going until both of its units are out of room', () => {
    const units = CR_UNITS.filter((u) => u.agc > 0);
    // Falls hydro full: Lakeside takes the rest.
    const a = allocateAgc(200, units, { cc1: 0, hydro: 100 });
    expect(a.hydro).toBeCloseTo(50, 6);
    expect(a.cc1).toBeCloseTo(150, 6);
    // Lakeside at full setpoint: Falls hydro still answers.
    const b = allocateAgc(80, units, { cc1: 400, hydro: 100 });
    expect(b.cc1).toBeCloseTo(0, 6);
    expect(b.hydro).toBeCloseTo(50, 6);
    // Shares follow the participation factors while both have room, and the signal can go down.
    const c = allocateAgc(-50, units, { cc1: 200, hydro: 100 });
    expect(c.cc1).toBeCloseTo(-30, 6);
    expect(c.hydro).toBeCloseTo(-20, 6);
    // In the passive run, AGC ends up using all 450 MW of room: 50 on Falls hydro and 400 on Lakeside.
    const sp0 = scheduleSetpoints(CR_SCENARIO.start);
    let s = initialControlRoom();
    let most = 0;
    while (!s.done) {
      s = stepControlRoom(s, sp0, true, CR_SCENARIO.minutesPerSecond / 60);
      most = Math.max(most, s.agc);
    }
    expect(most).toBeCloseTo(450, 3);
  });

  it('a unit that trips while producing nothing loses nothing', () => {
    const s = run((st) => ({ ...scheduleSetpoints(st.t, st.trippedUnits), cc2: 0 }));
    const entry = s.log.find((e) => e.t === CR_SCENARIO.events.find((x) => x.kind === 'unitTrip')!.at)!;
    expect(entry.text).toMatch(/producing nothing/);
    expect(entry.text).not.toMatch(/0 MW|60\.000/);
  });

  it('the bias is about 400 MW per hertz', () => {
    expect(Math.round(islandBeta(GAME, 1400) / 50) * 50).toBe(400);
  });

  it('after Mill Creek trips, the region can’t hold Harbor Point’s 400 MW in reserve while balancing', () => {
    const s0 = run(n1Operator());
    expect(ok(s0)).toBe(true);
    let s = initialControlRoom();
    const policy = n1Operator();
    const online = CR_UNITS.filter((u) => u.id !== 'cc2').reduce((a, u) => a + u.capacity, 0);
    while (!s.done) {
      s = stepControlRoom(s, policy(s), true, CR_SCENARIO.minutesPerSecond / 60);
      if (s.t > CR_SCENARIO.events.find((e) => e.kind === 'unitTrip')!.at + 5) {
        expect(s.reserve).toBeLessThan(s.reserveNeed);
        expect(online - (s.demand - CR_FIXED.mw - s.wind - s.solar)).toBeLessThan(CR_FIXED.mw);
      }
    }
  });

  it('covering the loss of Central–Metro takes the Metro and East plants running hard, and is impossible once Mill Creek trips', () => {
    expect(CR_SPS).toEqual(['center-city']);
    const W = STANDARD_FLEET.find((g) => g.id === 'wind')!;
    const SO = STANDARD_FLEET.find((g) => g.id === 'solar')!;
    const interp = (cf: number[], t: number) => {
      const x = t / 60 - 0.5;
      const i = Math.floor(x);
      return cf[i] + (cf[i + 1] - cf[i]) * (x - i);
    };
    const miss = CR_SCENARIO.events.find((e) => e.kind === 'forecastMiss') as { at: number; share: number; rampMinutes: number };
    const lineAt = CR_SCENARIO.events.find((e) => e.kind === 'lineTrip')!.at;
    const tripAt = CR_SCENARIO.events.find((e) => e.kind === 'unitTrip')!.at;
    /** Least Mill Creek + Eastgate + Old Quay output that keeps every line within its limit, before and after losing Central–Metro (null if none does). */
    function leastPeakers(t: number): number | null {
      const demand = crForecast(t) * (1 + miss.share * Math.min(1, Math.max(0, t - miss.at) / miss.rampMinutes));
      const inj: Record<string, number> = Object.fromEntries(REGION.nodes.map((n) => [n.id, -REGION_LOAD_SHARE[n.id] * demand]));
      inj[CR_FIXED.node] += CR_FIXED.mw;
      inj[W.node!] += W.capacity * interp(WIND_CF, t);
      inj[SO.node!] += SO.capacity * interp(SOLAR_CF, t);
      const need = -Object.values(inj).reduce((a, b) => a + b, 0);
      const out = t >= lineAt ? ['harbor-center'] : [];
      const A: number[][] = [CR_UNITS.map(() => 1)];
      const b: number[] = [need];
      const sense: Array<'<=' | '>=' | '='> = ['='];
      for (const outs of [out, [...out, 'center-city']]) {
        const { ptdf } = computePtdf(REGION, outs);
        for (const l of REGION.lines) {
          if (outs.includes(l.id)) continue;
          const c0 = REGION.nodes.reduce((s, n) => s + ptdf[l.id][n.id] * inj[n.id], 0);
          const row = CR_UNITS.map((u) => ptdf[l.id][u.node]);
          A.push(row, row.map((v) => -v));
          b.push(l.limit - c0, l.limit + c0);
          sense.push('<=', '<=');
        }
      }
      const sol = solveLP({
        c: CR_UNITS.map((u) => (['cc2', 'ct', 'oil'].includes(u.id) ? 1 : 0)),
        A,
        b,
        sense,
        ub: CR_UNITS.map((u) => (t >= tripAt && u.id === 'cc2' ? 0 : u.capacity)),
      });
      return sol.status === 'optimal' ? sol.objective : null;
    }
    for (const t of [18 * 60, 18 * 60 + 30, 18 * 60 + 59]) expect(leastPeakers(t)!).toBeGreaterThan(300);
    for (const t of [19 * 60 + 1, 19 * 60 + 30, 20 * 60, 20 * 60 + 59]) expect(leastPeakers(t)).toBeNull();
  });

  it('an operator who keeps N-1 in view gets through the shift', () => {
    const s = run(n1Operator());
    expect(ok(s)).toBe(true);
    expect(s.trippedUnits).toEqual(['cc2']);
    expect(s.linesOut).toEqual(['harbor-center']);
  });

  it('so does one who re-dispatches within a couple of minutes of the line trip', () => {
    const lineAt = CR_SCENARIO.events.find((e) => e.kind === 'lineTrip')!.at;
    const s = run((st) => {
      const sp = scheduleSetpoints(st.t + 10, st.trippedUnits);
      if (st.t >= lineAt + 2) {
        const cut = Math.max(0, sp.coal - 150);
        sp.coal = Math.min(sp.coal, 150);
        sp.cc2 = Math.min(250, sp.cc2 + cut);
        sp.oil = 80;
        sp.ct = Math.max(sp.ct, 100);
      }
      if (st.trippedUnits.includes('cc2')) {
        sp.ct = 200;
        sp.oil = 80;
      }
      return sp;
    });
    expect(ok(s)).toBe(true);
  });

  it('state estimation smooths noise and finds a bad meter', () => {
    const sp = scheduleSetpoints(19 * 60);
    const demand = 1434;
    const inj: Record<string, number> = Object.fromEntries(REGION.nodes.map((n) => [n.id, -REGION_LOAD_SHARE[n.id] * demand]));
    inj.harbor += 400;
    for (const u of CR_UNITS) inj[u.node] += sp[u.id];
    inj.north -= Object.values(inj).reduce((a, b) => a + b, 0);
    const clean = estimateState(REGION, inj);
    expect(clean.worstFlowError).toBeLessThan(10);
    const bad = estimateState(REGION, inj, { gross: { meter: 'f:center-city', mw: 120 } });
    const row = bad.rows.find((r) => r.meter.id === 'f:center-city')!;
    expect(Math.abs(row.normalized)).toBeGreaterThan(3);
    expect(bad.worstFlowError).toBeGreaterThan(10);
    const fixed = estimateState(REGION, inj, { gross: { meter: 'f:center-city', mw: 120 }, detect: true });
    expect(fixed.rejected).toEqual(['f:center-city']);
    expect(fixed.worstFlowError).toBeLessThan(10);
    for (const m of ['f:west-city', 'p:city'])
      for (const e of [-200, 200]) {
        const r = estimateState(REGION, inj, { gross: { meter: m, mw: e }, detect: true });
        expect(r.rejected[0]).toBe(m);
        expect(r.rows.every((x) => Number.isFinite(x.estimate))).toBe(true);
      }
  });
});

// ---------------------------------------------------------------------------
describe('Chapter 3 lessons show no NaN at any slider extreme', () => {
  const lessons = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch3/L3_*.tsx');
  const clean = (root: HTMLElement) => {
    expect(root.textContent ?? '').not.toMatch(/NaN|undefined|Infinity/);
    for (const el of Array.from(root.querySelectorAll('*')))
      for (const a of Array.from(el.attributes)) if (/NaN|Infinity/.test(a.value)) throw new Error(`${el.tagName} ${a.name}="${a.value.slice(0, 80)}"`);
  };
  for (const [path, load] of Object.entries(lessons)) {
    it(path.split('/').pop()!, async () => {
      const { default: Lesson } = await load();
      const view = render(createElement(Lesson));
      clean(view.container);
      const sliders = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
      for (const end of ['max', 'min'] as const) {
        for (const input of sliders) {
          if (input.disabled) continue;
          await act(async () => {
            fireEvent.change(input, { target: { value: input[end] } });
          });
        }
        clean(view.container);
      }
      for (const box of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
        await act(async () => {
          fireEvent.click(box);
        });
        clean(view.container);
      }
      cleanup();
    });
  }
});
