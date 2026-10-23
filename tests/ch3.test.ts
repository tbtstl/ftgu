// Chapter 3 engines, and checks that every Chapter 3 challenge can be reached with a sensible strategy.

import { describe, expect, it } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  GAME,
  ISLAND,
  forecastAt,
  gameDemand,
  inBandShare,
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
import { scheduleCommitted, scheduleDay, weatherDay, weatherDays, hoursOn, type Commitment } from '../src/engines/ops/scheduler';
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
import { CR_FIXED, CR_SCENARIO, CR_UNITS, initialControlRoom, scheduleSetpoints, stepControlRoom, type CRState } from '../src/engines/ops/controlRoom';
import { estimateState } from '../src/engines/ops/stateEstimation';
import { REGION, REGION_LOAD_SHARE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';

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
  /** A player who looks at the forecast every `every` simulated minutes and sets plants `lead` minutes ahead, rounding to `quant` MW. */
  function play(seed: number, opts: { every: number; lead: number; agc: boolean; quant?: number; idle?: boolean }) {
    const d = gameDemand(seed);
    let s = initialGame(d);
    let sp = initialSetpoints(d);
    const dt = GAME.minutesPerSecond / 60; // one frame at 60 fps
    let last = -1e9;
    while (!s.done) {
      if (!opts.idle && s.t - last >= opts.every) {
        last = s.t;
        let tot = forecastAt(s.t + opts.lead) - FIXED - (opts.agc ? GAME.agcBase : s.agcOut);
        if (opts.quant) tot = Math.round(tot / opts.quant) * opts.quant;
        sp = allocate(tot);
      }
      s = stepGame(s, sp, opts.agc, dt, d);
    }
    return s;
  }

  it('the reference day climbs fastest from 06:00 to 07:00 and falls fastest from 21:00 to 22:00', () => {
    const diffs = SYSTEM_DEMAND.slice(1).map((v, i) => v - SYSTEM_DEMAND[i]);
    expect(Math.max(...diffs)).toBe(120);
    expect(diffs.indexOf(120)).toBe(6); // hour 6 → hour 7
    expect(Math.min(...diffs)).toBe(-165);
    expect(diffs.indexOf(-165)).toBe(21); // hour 21 → hour 22
  });

  it('the island responds with about 40 MW per 0.1 Hz', () => {
    expect(islandBeta(GAME, ISLAND.loadMW)).toBeCloseTo(395.4, 0);
    expect(kineticEnergy(ISLAND)).toBe(7375);
  });

  it('days are deterministic given a seed', () => {
    expect(gameDemand(3)).toEqual(gameDemand(3));
    expect(gameDemand(3)[600]).not.toEqual(gameDemand(4)[600]);
  });

  it('doing nothing fails; leading the forecast by hand reaches the 80% challenge', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(inBandShare(play(seed, { every: 1e9, lead: 0, agc: false, idle: true }))).toBeLessThan(0.3);
      // Adjusting every three real seconds (30 simulated minutes), 15 minutes ahead.
      const r = play(seed, { every: 30, lead: 15, agc: false });
      expect(r.agcTime).toBe(0);
      expect(inBandShare(r)).toBeGreaterThanOrEqual(0.8);
      // A coarser player: every five seconds, to the nearest 10 MW.
      expect(inBandShare(play(seed, { every: 50, lead: 25, agc: false, quant: 10 }))).toBeGreaterThanOrEqual(0.8);
    }
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
    expect(s.nadir).toBeCloseTo(59.72, 2);
    expect(s.at30).toBeCloseTo(59.88, 2);
    expect(s.restored! / 60).toBeLessThan(7);
    expect(r[r.length - 1].dispatch).toBeCloseTo(50, 0);
    expect(summarizeStep(stepResponse(ISLAND, 50, { governors: false })).nadir).toBeLessThan(59.3);
    expect(summarizeStep(stepResponse(ISLAND, 50, { agc: false, dispatch: false })).restored).toBeNull();
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
    expect(simulateEvent({ ...D, inertiaH: 2.5 }, 1000, 30, 0.05).nadir).toBeCloseTo(59.48, 2);
  });

  it('the low-inertia challenge is reachable with fast response, and not without it', () => {
    expect(simulateEvent(inverter(0.7, 0), 1200, 30, 0.05).shedMW).toBeGreaterThan(0);
    expect(simulateEvent(inverter(0.7, 650), 1200, 30, 0.05).shedMW).toBe(0);
    expect(simulateEvent(inverter(0.3, 0), 1200, 30, 0.05).shedMW).toBe(0);
    expect(simulateEvent(inverter(0.5, 0), 1200, 30, 0.05).shedMW).toBeGreaterThan(0);
    // At 80%, even the largest response is too slow.
    expect(simulateEvent(inverter(0.8, 1500), 1200, 30, 0.05).shedMW).toBeGreaterThan(0);
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
  });

  it('the commitment challenge is reachable, and the default and a late restart are not solutions', () => {
    const calm = weatherDay('calm');
    const target = 5100;
    const def = scheduleCommitted(calm, 1600, 350, { cc1: hoursOn(6, 23), cc2: hoursOn(7, 22) });
    expect(def.shortfallMWh).toBeLessThan(0.5);
    expect(def.curtailedMWh).toBeGreaterThan(target);
    const off = (from: number, to: number): Commitment => ({
      cc1: hoursOn(6, 23).map((v, h) => v && !(h >= from && h < to)),
      cc2: hoursOn(7, 22).map((v, h) => v && !(h >= from && h < to)),
    });
    const good = scheduleCommitted(calm, 1600, 350, off(9, 17));
    expect(good.shortfallMWh).toBeLessThan(0.5);
    expect(good.overGenMWh).toBeLessThan(0.5);
    expect(good.curtailedMWh).toBeLessThanOrEqual(target);
    expect(scheduleCommitted(calm, 1600, 350, off(9, 18)).shortfallMWh).toBeGreaterThan(0.5);
    // An online plant never runs below its minimum; an offline one produces nothing.
    good.output.cc1.forEach((v, h) => (off(9, 17).cc1[h] ? expect(v).toBeGreaterThanOrEqual(160 - 1e-9) : expect(v).toBe(0)));
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

  it('the challenge is reachable by moving two loads', () => {
    const basePeak = Math.max(...base);
    expect(basePeak).toBe(1310);
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, usualStarts()))).toBe(1440);
    const moved = { ...usualStarts(), ev: 25, water: 12 };
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, moved))).toBeLessThanOrEqual(basePeak);
    const best = flatten(base, FLEX_BLOCKS, prices);
    expect(Math.max(...systemLoad(base, FLEX_BLOCKS, best))).toBe(basePeak);
    const bill = (st: Record<string, number>) => FLEX_BLOCKS.reduce((s, b) => s + blockCost(b, st[b.id], prices), 0);
    expect(bill(best)).toBeLessThan(bill(usualStarts()));
  });

  it('a shared timer creates a new peak once the fleet is large enough', () => {
    expect(evLoad(EV_FLEET, 'arrival').reduce((a, b) => a + b, 0)).toBeCloseTo((EV_FLEET.cars * EV_FLEET.kWhEach) / 1000, 6);
    for (const p of ['timer', 'smart'] as const) expect(evLoad(EV_FLEET, p).reduce((a, b) => a + b, 0)).toBeCloseTo(480, 6);
    const peakWith = (cars: number, p: 'arrival' | 'timer' | 'smart') => Math.max(...SYSTEM_DEMAND.map((d, h) => d + evLoad({ ...EV_FLEET, cars }, p)[h]));
    expect(peakWith(40000, 'timer')).toBe(1440);
    expect(peakWith(70000, 'timer')).toBeGreaterThan(1440);
    expect(peakWith(150000, 'smart')).toBe(1440);
    expect(peakWith(40000, 'arrival')).toBeGreaterThan(1500);
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

  it('a passive operator sheds load; following the day-ahead plan overloads West–Metro', () => {
    const sp0 = scheduleSetpoints(CR_SCENARIO.start);
    expect(run(() => sp0).shedMWh).toBeGreaterThan(0);
    const plan = run((s) => scheduleSetpoints(s.t, s.trippedUnits));
    expect(plan.sustainedOverloads).toContain('west-city');
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
