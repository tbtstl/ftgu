// Chapter 7: engines for distributed energy and virtual power plants, the claims the lessons make
// about them, and checks that every challenge can be solved with the figures' controls.

import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { availabilityDraws, fleetDay, fleetToday, generateFleet, homeBill, simulateHome, type HomeSystem } from '../src/engines/ops/der';
import { initVpp, stepVpp, vppScore, vppTarget } from '../src/engines/ops/vpp';
import { buildCohorts, clipToFeederLimit, optimizeWithLimits, scheduleFleet } from '../src/engines/strategy/fleet';
import { optimizeArbitrage } from '../src/engines/strategy/arbitrage';
import { peakShiftSchedule, runSitingDay, type SitedBattery } from '../src/engines/market/siting';
import { DER_RULES, arbitrageValuePerMWday, dependableByGroup, evaluateAccess } from '../src/engines/market/derAccess';
import { HOME_LOAD_KW, SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { REGION, REGION_LOAD_SHARE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { standardHistory } from '../src/model/history';
import { rng } from '../src/model/random';
import { SIZING_GOAL, SIZING_PV, sizingSolved } from '../src/lessons/ch7/L7_1';
import { LOOP, LOOP_GOAL, advanceLoop, loopParams, loopSolved, startLoop } from '../src/lessons/ch7/L7_3';
import { BUDGET_REF, sitingSavings, sitingSolved } from '../src/lessons/ch7/L7_4';
import { LIMIT_CHALLENGE, limitRatio, limitSolved } from '../src/lessons/ch7/L7_5';
import { locationLever, meteringLever, scopeLever } from '../src/lessons/ch7/L7_6';

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

// ---------------------------------------------------------------------------
// 7.1 Home Energy Simulator

const SYS: HomeSystem = { pvKW: 6, batteryKW: 5, batteryKWh: 13.5, efficiency: 0.9, reserve: 0.2, strategy: 'self' };
const flatTariff = (exp: number | null) => ({ importPrice: Array(24).fill(0.16), exportCredit: Array(24).fill(exp ?? 0.16) });
const touTariff = (exp: number | null) => {
  const imp = Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 21 ? 0.36 : 0.11));
  return { importPrice: imp, exportCredit: exp === null ? imp.slice() : Array(24).fill(exp) };
};

describe('home energy (7.1)', () => {
  it('balances energy every hour and repeats its daily cycle', () => {
    const d = simulateHome(HOME_LOAD_KW, SOLAR_CF, SYS);
    for (let h = 0; h < 24; h++) {
      // Supply = demand at the house: solar + battery + grid = load + charge + export.
      expect(d.pv[h] + d.discharge[h] + d.gridImport[h]).toBeCloseTo(d.load[h] + d.charge[h] + d.gridExport[h], 9);
      expect(d.gridImport[h]).toBeGreaterThanOrEqual(-1e-12);
      expect(d.gridExport[h]).toBeGreaterThanOrEqual(-1e-12);
      expect(d.soc[h]).toBeGreaterThanOrEqual(0.2 * 13.5 - 1e-9);
    }
    expect(d.soc[24]).toBeCloseTo(d.soc[0], 6);
    // Losses: what goes in exceeds what comes out by the round-trip efficiency.
    expect(sum(d.discharge)).toBeCloseTo(sum(d.charge) * 0.9, 6);
  });

  it('matches the numbers quoted in the lesson', () => {
    expect(sum(HOME_LOAD_KW)).toBeCloseTo(28.75, 6);
    const pvOnly = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, batteryKWh: 0, batteryKW: 0 });
    expect(sum(pvOnly.pv)).toBeCloseTo(38.04, 2);
    expect(pvOnly.selfConsumption).toBeCloseTo(1 / 3, 1);
    const withBat = simulateHome(HOME_LOAD_KW, SOLAR_CF, SYS);
    expect(sum(withBat.gridImport)).toBeLessThan(sum(pvOnly.gridImport) / 2);
    // Grid only: $5.79 a day under time-of-use.
    const grid = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, pvKW: 0, batteryKWh: 0, batteryKW: 0 });
    expect(homeBill(grid, touTariff(null)).net).toBeCloseTo(5.79, 2);
  });

  it('a battery loses money under flat-rate net metering and saves under an export rate', () => {
    const pvOnly = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, batteryKWh: 0, batteryKW: 0 });
    const withBat = simulateHome(HOME_LOAD_KW, SOLAR_CF, SYS);
    const saving = (t: ReturnType<typeof flatTariff>) => homeBill(pvOnly, t).net - homeBill(withBat, t).net;
    expect(saving(flatTariff(null))).toBeLessThan(0); // challenge 7.1b
    expect(saving(flatTariff(0.05))).toBeGreaterThan(0);
    expect(saving(touTariff(null))).toBeGreaterThan(0);
    expect(saving(touTariff(0.05))).toBeGreaterThan(saving(flatTariff(0.05)));
  });

  it('challenge 7.1a: a band of panel sizes, each with a big enough battery, meets both goals; the start does not', () => {
    // The starting settings (6 kW, no battery) and the prose's 6 kW + 13.5 kWh battery fall short.
    expect(sizingSolved(6, 0, 0.2)).toBe(false);
    expect(sizingSolved(6, 13.5, 0.2)).toBe(false);
    // Intended answers: panels close to the house's use, with a battery that holds the midday surplus.
    expect(sizingSolved(5, 22.5, 0.2)).toBe(true);
    expect(sizingSolved(4.5, 20, 0.2)).toBe(true);
    expect(sizingSolved(6, 22.5, 0.2)).toBe(true);
    // The band quoted in the success text: 4.5–6 kW.
    expect(SIZING_PV).toEqual({ min: 4.5, max: 6 });
    // Why: below 4.5 kW no battery reaches 90% self-sufficiency, and above 6 kW none reaches 80%
    // self-consumption, at any backup reserve.
    let ssSmall = 0;
    let scBig = 0;
    for (const reserve of [0, 0.2, 0.5, 1])
      for (let k = 0; k <= 30; k += 0.5) {
        const h = (pv: number) => simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: k > 0 ? 5 : 0, batteryKWh: k, efficiency: 0.9, reserve, strategy: 'self' });
        for (let pv = 0.5; pv < 4.5; pv += 0.5) ssSmall = Math.max(ssSmall, h(pv).selfSufficiency);
        for (let pv = 6.5; pv <= 12; pv += 0.5) scBig = Math.max(scBig, h(pv).selfConsumption);
      }
    expect(ssSmall).toBeLessThan(SIZING_GOAL.sufficiency);
    expect(scBig).toBeLessThan(SIZING_GOAL.consumption);
    // "Drag the reserve up and the evening imports come back": with all of it held back, the
    // battery saves nothing.
    const full = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, reserve: 1 });
    const pvOnly = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, batteryKWh: 0, batteryKW: 0 });
    expect(sum(full.gridImport)).toBeCloseTo(sum(pvOnly.gridImport), 6);
  });

  it('the two battery strategies give nearly the same time-of-use bill (the prose’s explanation)', () => {
    const pvOnly = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, batteryKWh: 0, batteryKW: 0 });
    const self = simulateHome(HOME_LOAD_KW, SOLAR_CF, SYS);
    const tou = simulateHome(HOME_LOAD_KW, SOLAR_CF, { ...SYS, strategy: 'tou' });
    // The battery saves $2.42 a day under time-of-use rates with the 5¢ export rate (quoted in 7.1 and 7.5).
    expect(homeBill(pvOnly, touTariff(0.05)).net - homeBill(self, touTariff(0.05)).net).toBeCloseTo(2.42, 2);
    // Within 15¢ of each other under either export credit.
    const gap = Math.max(...[null, 0.05].map((e) => Math.abs(homeBill(self, touTariff(e)).net - homeBill(tou, touTariff(e)).net)));
    expect(Math.round(gap * 100)).toBe(15);
    // Solar covers the house through the 16:00 hour, so both strategies first discharge at 17:00 ...
    for (let h = 8; h <= 16; h++) expect(self.pv[h]).toBeGreaterThan(self.load[h]);
    expect(self.pv[17]).toBeLessThan(self.load[17]);
    for (const d of [self, tou]) expect(d.discharge.findIndex((v) => v > 0.01)).toBe(17);
    // ... and they differ only from 21:00 on.
    for (let h = 0; h < 21; h++) expect(tou.discharge[h]).toBeCloseTo(self.discharge[h], 6);
  });

  it('never produces NaN at the sliders’ extremes', () => {
    for (const pv of [0, 12]) for (const kwh of [0, 30]) for (const kw of [0, 10]) for (const reserve of [0, 1]) for (const strategy of ['self', 'tou'] as const) {
      const d = simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: kw, batteryKWh: kwh, efficiency: 0.9, reserve, strategy });
      for (const v of [...d.gridImport, ...d.gridExport, ...d.soc, d.selfConsumption, d.selfSufficiency]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7.2 DER Aggregator

describe('fleet aggregation (7.2)', () => {
  const homes = generateFleet(2000, 7, 4);
  const day = fleetDay(homes, HOME_LOAD_KW, SOLAR_CF);

  it('is deterministic, and a bigger fleet only adds homes', () => {
    const a = generateFleet(100, 7, 4);
    expect(homes.slice(0, 100)).toEqual(a);
  });

  it('dependable ≤ expected ≤ nameplate, and diversity narrows the gap', () => {
    const ratio = (n: number, sharedWeather = false) => {
      const d = availabilityDraws(homes, day, 18, { count: n, sharedWeather });
      expect(d.dependable).toBeLessThanOrEqual(d.mean + 1e-9);
      expect(d.mean).toBeLessThanOrEqual(d.nameplate);
      return d.dependable / d.mean;
    };
    expect(ratio(10)).toBeLessThan(0.8);
    expect(ratio(1000)).toBeGreaterThan(0.95);
    // A shared factor doesn't average out.
    expect(ratio(2000, true)).toBeLessThan(0.85);
  });

  it('challenge 7.2: four times the homes halves the shortfall — 200 homes, not 100, halve the 50-home fleet’s', () => {
    const short = (n: number) => {
      const d = availabilityDraws(homes, day, 18, { count: n, days: 400 });
      const s = [...d.totals].sort((x, y) => x - y);
      return 1 - s[Math.floor(0.05 * s.length)] / d.mean;
    };
    expect(short(50)).toBeCloseTo(0.108, 2);
    expect(short(100)).toBeGreaterThan(short(50) / 2);
    expect(short(200)).toBeLessThanOrEqual(short(50) / 2);
  });

  it('50 MW is the dependable capacity of about 15,000 homes (quoted in 7.4)', () => {
    const d = availabilityDraws(homes, day, 18, { count: 1000, days: 400 });
    const perHomeKW = d.dependable / 1000;
    expect(perHomeKW).toBeCloseTo(3.39, 2);
    expect(Math.round(50000 / perHomeKW / 1000) * 1000).toBe(15000);
  });

  it('the fleet drains overnight and fills by afternoon', () => {
    const t = fleetToday(homes, day, 1, 1000);
    expect(t.totalKW[7]).toBeLessThan(0.15 * t.totalKW[15]);
    expect(t.totalKW[18]).toBeLessThan(t.nameplateKW);
  });
});

// ---------------------------------------------------------------------------
// 7.3 VPP Control Center

describe('VPP control (7.3)', () => {
  it('follows a repeating 10-minute target between 25% and 65% of rating', () => {
    expect(vppTarget(0)).toBeCloseTo(0.25);
    expect(vppTarget(180)).toBeCloseTo(0.55);
    expect(vppTarget(600 + 180)).toBeCloseTo(0.55);
    expect(Math.max(...Array.from({ length: 600 }, (_, t) => vppTarget(t)))).toBeCloseTo(0.65);
  });

  it('is deterministic and keeps devices within their rating', () => {
    const p = { devices: 100, latencyS: 3, dropout: 0.1, margin: 0.5 };
    let a = initVpp(p);
    let b = initVpp(p);
    for (let i = 0; i < 100; i++) {
      a = stepVpp(a, p, 1);
      b = stepVpp(b, p, 1);
    }
    expect(a.history).toEqual(b.history);
    for (const d of a.devices) expect(d.output).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('delivers about (1 − dropout) of the target without a margin', () => {
    const p = { devices: 300, latencyS: 2, dropout: 0.1, margin: 0 };
    let s = initVpp(p);
    for (let i = 0; i < 700; i++) s = stepVpp(s, p, 1);
    const ratio = sum(s.history.map((x) => x.delivered)) / sum(s.history.map((x) => x.target));
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(0.95);
  });

  it('an 11% over-dispatch margin puts the starting fleet on target (the prose’s suggestion)', () => {
    const base = { devices: 300, latencyS: 2, dropout: 0.1 };
    expect(vppScore({ ...base, margin: 0 })).toBeLessThan(0.9);
    expect(vppScore({ ...base, margin: 0.11 })).toBeGreaterThan(0.95);
  });

  it('the closed-loop figure steps in whole seconds, so a full cycle scores exactly what vppScore says', () => {
    for (const [lat, g] of [
      [LOOP.fastS, 0.05],
      [LOOP.slowS, 0.02],
    ]) {
      const p = loopParams(lat, g);
      let r = startLoop(p);
      let frames = 0;
      while (r.result === null && frames < 5000) {
        r = advanceLoop(r, p, 0.37); // a 12 ms frame at the figure's 30× speed
        frames++;
      }
      expect(r.result).toBe(vppScore(p));
    }
  });

  it('challenge 7.3: only a gentle gain holds both links; the start does not, nor does the gain that suits the fast link', () => {
    const score = (lat: number, g: number) => vppScore(loopParams(lat, g));
    // The start: no correction, both fleets about 20% short.
    expect(loopSolved(score(LOOP.fastS, 0), score(LOOP.slowS, 0))).toBe(false);
    // The intended answer.
    expect(loopSolved(score(LOOP.fastS, 0.02), score(LOOP.slowS, 0.02))).toBe(true);
    // A strong gain is best on the fast link but fails on the slow one.
    expect(score(LOOP.fastS, 0.1)).toBeGreaterThan(0.95);
    expect(score(LOOP.slowS, 0.1)).toBeLessThan(LOOP_GOAL);
    // Every gain on the slider that solves it is gentle (at most 0.03), and on the fast link it does
    // worse than the best gain there ("corrects more slowly than it could").
    const solving: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const g = i / 100;
      if (score(LOOP.slowS, g) >= LOOP_GOAL && score(LOOP.fastS, g) >= LOOP_GOAL) solving.push(g);
    }
    expect(solving.length).toBeGreaterThan(1);
    expect(Math.max(...solving)).toBeLessThanOrEqual(0.03);
    for (const g of solving) expect(score(LOOP.fastS, g)).toBeLessThan(score(LOOP.fastS, 0.1));
  }, 60000);

  it('telemetry is the delivered output one latency ago', () => {
    const p = { devices: 100, latencyS: 3, dropout: 0.1, margin: 0 };
    let s = initVpp(p);
    for (let i = 0; i < 60; i++) s = stepVpp(s, p, 1);
    const h = s.history;
    const last = h[h.length - 1];
    const ago = h.find((x) => Math.abs(x.t - (last.t - 3)) < 1e-6)!;
    expect(last.telemetry).toBeCloseTo(ago.delivered, 9);
  });

  it('closed-loop correction helps with short delays and oscillates with long ones (the prose)', () => {
    const p = (latencyS: number, feedback: number) => loopParams(latencyS, feedback);
    expect(vppScore(p(LOOP.fastS, 0))).toBeLessThan(0.2);
    expect(vppScore(p(LOOP.slowS, 0))).toBeLessThan(0.2);
    expect(vppScore(p(LOOP.fastS, 0.05))).toBeGreaterThan(0.95);
    expect(vppScore(p(LOOP.fastS, 0.1))).toBeGreaterThan(0.95);
    expect(vppScore(p(LOOP.slowS, 0.05))).toBeLessThan(LOOP_GOAL);
    // At a gain of 0.2 the fast fleet still holds, while the slow one swings between zero and
    // nearly all its reachable devices can give (80% of the fleet's rating).
    expect(vppScore(p(LOOP.fastS, 0.2))).toBeGreaterThan(0.95);
    const q = p(LOOP.slowS, 0.2);
    let r = startLoop(q);
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 600; i++) {
      r = advanceLoop(r, q, 1);
      const x = r.sim.history[r.sim.history.length - 1];
      lo = Math.min(lo, x.delivered);
      hi = Math.max(hi, x.delivered);
    }
    const rated = (LOOP.devices * 5) / 1000;
    expect(lo).toBeLessThan(0.02 * rated);
    expect(hi).toBeGreaterThan(0.8 * rated);
  });
});

// ---------------------------------------------------------------------------
// 7.4 Battery Siting Optimizer

const gens = (h: number) =>
  STANDARD_FLEET.map((g) => ({
    id: g.id,
    node: g.node!,
    offer: g.marginalCost,
    minOutput: g.minOutput,
    capacity: g.fuel === 'wind' ? g.capacity * WIND_CF[h] : g.fuel === 'solar' ? g.capacity * SOLAR_CF[h] : g.capacity,
  }));
const siting = (batteries: SitedBattery[], lineIn = false, lmp = false) =>
  runSitingDay({ net: REGION, gens, demand: SYSTEM_DEMAND, share: REGION_LOAD_SHARE, batteries, opf: { outages: lineIn ? [] : ['center-city'], lmp } });
const bat = (node: string, powerMW: number): SitedBattery => ({ node, powerMW, durationH: 4, efficiency: 0.85 });

describe('battery siting (7.4)', () => {
  it('schedules charge in the quietest hours and discharge at the peak, energy-consistent', () => {
    const s = peakShiftSchedule(SYSTEM_DEMAND, { powerMW: 100, durationH: 4, efficiency: 0.85 });
    expect(s[19]).toBe(100);
    expect(s[3]).toBeLessThan(0);
    expect(-sum(s.filter((v) => v < 0)) * 0.85).toBeCloseTo(sum(s.filter((v) => v > 0)), 6);
  });

  it('matches the lesson: no congestion with the line in service, congestion with it out', () => {
    expect(siting([], true).congestedHours).toBe(0);
    const base = siting([], false, true);
    expect(base.congestedHours).toBeGreaterThan(10);
    expect(Math.max(...base.hours.map((h) => h.lmp.city))).toBeGreaterThan(100);
  });

  it('storage behind the constraint saves more and earns more than the same storage at Central', () => {
    const base = siting([]);
    const city = runSitingDay({ net: REGION, gens, demand: SYSTEM_DEMAND, share: REGION_LOAD_SHARE, batteries: [bat('city', 50)], opf: { outages: ['center-city'] }, lmpNodes: ['city'] });
    const center = runSitingDay({ net: REGION, gens, demand: SYSTEM_DEMAND, share: REGION_LOAD_SHARE, batteries: [bat('center', 50)], opf: { outages: ['center-city'] }, lmpNodes: ['center'] });
    expect(base.cost - city.cost).toBeGreaterThan(4 * (base.cost - center.cost));
    expect(city.revenue[0]).toBeGreaterThan(4 * center.revenue[0]);
    // With the line in service, location doesn't matter.
    const inBase = siting([], true);
    const a = siting([bat('city', 50)], true);
    const b = siting([bat('north', 50)], true);
    expect(inBase.cost - a.cost).toBeCloseTo(inBase.cost - b.cost, 0);
  });

  it('shows diminishing returns at Metro, and revenue that peaks around 75 MW', () => {
    const base = siting([]);
    const sizes = [0, 25, 50, 75, 100, 125, 150];
    const savings = sizes.map((p) => base.cost - siting(p ? [bat('city', p)] : []).cost);
    for (let i = 2; i < sizes.length; i++) expect(savings[i] - savings[i - 1]).toBeLessThanOrEqual(savings[i - 1] - savings[i - 2] + 1);
    const rev = (p: number) =>
      runSitingDay({ net: REGION, gens, demand: SYSTEM_DEMAND, share: REGION_LOAD_SHARE, batteries: [bat('city', p)], opf: { outages: ['center-city'] }, lmpNodes: ['city'] }).revenue[0];
    expect(rev(75)).toBeGreaterThan(rev(50));
    expect(rev(100)).toBeLessThan(rev(75));
  });

  it('challenge 7.4: only West, in front of the binding line, makes the battery raise the system’s cost', () => {
    const base = siting([], false, true);
    const nodes = ['north', 'east', 'center', 'harbor', 'west', 'city'];
    // The start (50 MW at Metro) is unsolved.
    expect(sitingSolved(sitingSavings('city', 50, false))).toBe(false);
    for (const p of [25, 50, 75, 100, 125, 150]) {
      for (const n of nodes) {
        const save = sitingSavings(n, p, false);
        expect(sitingSolved(save)).toBe(n === 'west');
        // With the line in service, every node is the same, and no site raises the cost.
        expect(sitingSolved(sitingSavings(n, p, true))).toBe(false);
      }
      // The success text: West's price at 19:00 is the lowest in the region, below its own
      // uncongested price ($28, the West coal plant), because the full West–Metro line strands it.
      const w = siting([bat('west', p)], false, true);
      const at19 = w.hours[19].lmp;
      expect(Math.min(...Object.values(at19))).toBe(at19.west);
      expect(at19.west).toBeLessThan(28);
      expect(w.hours[19].binding).toContain('west-city');
    }
    expect(base.hours[19].lmp.west).toBeCloseTo(21.12, 2);
  }, 60000);

  it('the fixed budget: diminishing returns at Metro, East nearly as good, and winners keep 100 MW behind the line', () => {
    expect(Math.round(BUDGET_REF.first25)).toBe(7580);
    expect(Math.round(BUDGET_REF.last25)).toBe(125);
    expect(BUDGET_REF.half).toBeGreaterThan(BUDGET_REF.allCity);
    expect(BUDGET_REF.allEast).toBeGreaterThan(0.95 * BUDGET_REF.allCity);
    expect(BUDGET_REF.allEast).toBeLessThan(BUDGET_REF.allCity);
    // Every two-site split (25 MW steps) that beats all-at-Metro keeps at least 100 MW at Metro and
    // East together, and some winner keeps exactly that.
    const base = siting([]);
    const save = (b: SitedBattery[]) => base.cost - siting(b.filter((x) => x.powerMW > 0)).cost;
    const nodes = ['north', 'east', 'center', 'harbor', 'west', 'city'];
    const behind: number[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        for (let a = 0; a <= 150; a += 25) {
          const split = [bat(nodes[i], a), bat(nodes[j], 150 - a)];
          if (save(split) > BUDGET_REF.allCity + 0.5) behind.push(split.filter((b) => b.node === 'city' || b.node === 'east').reduce((s, b) => s + b.powerMW, 0));
        }
    expect(behind.length).toBeGreaterThan(0);
    expect(Math.min(...behind)).toBe(BUDGET_REF.keepBehind);
  }, 60000);

  it('with the line out, West–Metro is the only line that binds, and East is priced by its shift factor', () => {
    const base = siting([], false, true);
    const binding = new Set(base.hours.flatMap((h) => h.binding));
    expect([...binding]).toEqual(['west-city']);
    expect(base.hours.filter((h) => h.binding.length).length).toBe(base.congestedHours);
    const peak = base.hours[19];
    // East sends power on to Metro, and its price sits between Central's and Metro's, closer to Metro's.
    expect(peak.flows['east-city']).toBeGreaterThan(0);
    expect(peak.lmp.east).toBeGreaterThan(peak.lmp.center);
    expect(peak.lmp.city - peak.lmp.east).toBeLessThan(peak.lmp.east - peak.lmp.center);
    expect(Math.max(...base.hours.map((h) => h.lmp.city))).toBeCloseTo(peak.lmp.city, 6);
  });
});

// ---------------------------------------------------------------------------
// 7.5 Fleet Scheduling Simulator

describe('fleet scheduling (7.5)', () => {
  const prices = standardHistory()[73].daMetro;
  const fleet = generateFleet(4000, 7, 4);
  const r = rng(5);
  const soc = fleet.map(() => 0.2 + 0.7 * r());
  const cohorts = buildCohorts(fleet.map((h, i) => ({ feeder: `Feeder ${'ABCD'[h.substation]}`, kW: h.batteryKW, kWh: h.batteryKWh, soc0: soc[i] })));

  it('groups 4,000 homes into 16 cohorts without losing any capacity', () => {
    expect(cohorts.length).toBe(16);
    expect(sum(cohorts.map((c) => c.homes))).toBe(4000);
    expect(sum(cohorts.map((c) => c.powerMW))).toBeCloseTo(sum(fleet.map((h) => h.batteryKW)) / 1000, 6);
  });

  it('optimizeWithLimits agrees with optimizeArbitrage when limits are symmetric', () => {
    const b = { powerMW: 2, energyMWh: 6, efficiency: 0.9, soc0: 0.5 };
    const a = optimizeArbitrage(prices, b, { levels: 61 });
    const l = optimizeWithLimits(prices, { maxChargeMW: 2, maxDischargeMW: 2, energyMWh: 6, efficiency: 0.9, soc0: 0.5 }, 61);
    expect(l.revenue).toBeCloseTo(a.profit, 0);
    // A discharge cap is respected exactly and never helps.
    const capped = optimizeWithLimits(prices, { maxChargeMW: 2, maxDischargeMW: 0.5, energyMWh: 6, efficiency: 0.9, soc0: 0.5 }, 61);
    expect(Math.max(...capped.schedule)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(capped.revenue).toBeLessThanOrEqual(l.revenue + 1e-6);
    expect(capped.soc[24]).toBeGreaterThanOrEqual(capped.soc[0] - 1e-9);
  });

  it('respects every feeder limit, and re-optimizing beats clipping', () => {
    const free = scheduleFleet(prices, cohorts, { reserve: 0.2, availability: 0.9 });
    let prev = -Infinity;
    for (const L of [0.5, 1, 2, 3, 6]) {
      const f = scheduleFleet(prices, cohorts, { reserve: 0.2, availability: 0.9, feederLimitMW: L });
      for (const series of Object.values(f.byFeeder)) for (const v of series) expect(v).toBeLessThanOrEqual(L + 1e-9);
      expect(f.revenue).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(f.revenue).toBeLessThanOrEqual(free.revenue + 1e-6);
      const clip = clipToFeederLimit(prices, free, L);
      for (const series of Object.values(clip.byFeeder)) for (const v of series) expect(v).toBeLessThanOrEqual(L + 1e-9);
      expect(f.revenue).toBeGreaterThanOrEqual(clip.revenue - 1e-6);
      prev = f.revenue;
    }
    // Constraints cost money in the order the lesson describes.
    const none = scheduleFleet(prices, cohorts, { reserve: 0, availability: 1 });
    const reserve = scheduleFleet(prices, cohorts, { reserve: 0.2, availability: 1 });
    expect(none.revenue).toBeGreaterThan(reserve.revenue);
    expect(reserve.revenue).toBeGreaterThan(free.revenue);
  });

  it('challenge 7.5: a band of limits is cheap on day 74’s four-hour spike but costly on day 4’s two-hour one', () => {
    const hist = standardHistory();
    // Day 4's spike is as high as day 74's but half as long (the prose).
    const peak = (d: number) => Math.max(...hist[d].daMetro);
    const spikeHours = (d: number) => hist[d].daMetro.filter((p) => p === peak(d)).length;
    expect(peak(3)).toBe(peak(73));
    expect(spikeHours(73)).toBe(4);
    expect(spikeHours(3)).toBe(2);
    expect(peak(60)).toBeLessThan(0.4 * peak(73));
    // The start (2 MW) and a limit too loose to bite on day 4 don't solve it; a band in between does.
    expect(limitSolved(2, 0.2, 0.9)).toBe(false);
    expect(limitSolved(3.25, 0.2, 0.9)).toBe(false);
    expect(limitSolved(6, 0.2, 0.9)).toBe(false); // the slider's end: no limit at all
    const band = Array.from({ length: 23 }, (_, i) => (i + 1) * 0.25).filter((L) => limitSolved(L, 0.2, 0.9));
    expect(band).toEqual([2.25, 2.5, 2.75, 3]);
    // At every solving limit, the same limit costs more on the short spike than on the long one.
    for (const L of band) expect(1 - limitRatio(LIMIT_CHALLENGE.shortDay, 0.2, 0.9, L)).toBeGreaterThan(3 * (1 - limitRatio(LIMIT_CHALLENGE.longDay, 0.2, 0.9, L)));
  });

  it('the cohort grid: the limit spreads each cohort’s discharge, and low-charge cohorts charge longer overnight', () => {
    const k = { reserve: 0.2, availability: 0.9 };
    const free = scheduleFleet(prices, cohorts, k);
    const lim = scheduleFleet(prices, cohorts, { ...k, feederLimitMW: 2 });
    const hoursOn = (x: number[], from = 0, to = 24, sign = 1) => x.slice(from, to).filter((v) => sign * v > 0.005).length;
    for (let i = 0; i < cohorts.length; i++) {
      expect([2, 3]).toContain(hoursOn(free.cohorts[i].schedule));
      expect([4, 5]).toContain(hoursOn(lim.cohorts[i].schedule, 7));
    }
    // Within each feeder and size, the cohort that starts low charges for more night hours.
    for (const f of ['A', 'B', 'C', 'D'])
      for (const size of ['standard', 'large']) {
        const night = (charge: string) => hoursOn(lim.cohorts.find((c) => c.id === `Feeder ${f}·${size}·${charge}`)!.schedule, 0, 7, -1);
        expect(night('low')).toBeGreaterThan(night('high'));
      }
  });

  it('per home, the fleet earns about $0.98 on day 74 and $0.14 on day 61 — less than 7.1’s $2.42', () => {
    const hist = standardHistory();
    const k = { reserve: 0.2, availability: 0.9, feederLimitMW: 2 };
    const spike = scheduleFleet(hist[73].daMetro, cohorts, k).revenue / 4000;
    const calm = scheduleFleet(hist[60].daMetro, cohorts, k).revenue / 4000;
    expect(Math.round(spike * 100)).toBe(98);
    expect(Math.round(calm * 100)).toBe(14);
    expect(spike).toBeLessThan(2.42);
  });

  it('never produces NaN at the sliders’ extremes', () => {
    for (const reserve of [0, 0.8]) for (const availability of [0.5, 1]) for (const feederLimitMW of [0.25, 6]) {
      const f = scheduleFleet(prices, cohorts, { reserve, availability, feederLimitMW });
      expect(Number.isFinite(f.revenue)).toBe(true);
      for (const v of f.total) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7.6 Market Access Simulator

describe('market access (7.6)', () => {
  const homes = generateFleet(10000, 7, 1);
  const day = fleetDay(homes, HOME_LOAD_KW, SOLAR_CF);
  const demand = homes.map((h) => HOME_LOAD_KW[18] * h.loadScale);
  const rules = (id: string) => DER_RULES.find((r) => r.id === id)!;

  it('labels every rule set as current or proposed, with a source', () => {
    expect(DER_RULES.length).toBe(6);
    for (const r of DER_RULES) {
      expect(['current', 'proposed']).toContain(r.status);
      expect(r.statusLabel.length).toBeGreaterThan(5);
      expect(r.source.length).toBeGreaterThan(5);
    }
    for (const m of ['ERCOT', 'PJM', 'IESO']) {
      expect(DER_RULES.filter((r) => r.market === m && r.status === 'current').length).toBe(1);
      expect(DER_RULES.filter((r) => r.market === m && r.status === 'proposed').length).toBe(1);
    }
    // Fast-dating facts live in the rules table, dated to the update they come from.
    expect(rules('ercot-ader').notes).toMatch(/October 2026 pilot update: 293 MW qualified across nine aggregations, ECRS fully subscribed/);
    expect(rules('ercot-adesr').notes).toMatch(/Dec\. 7, 2026/);
    expect(rules('pjm-2222').notes).toMatch(/enrollment in Nov\. 2027/);
  });

  it('applies minimum sizes, metering scope, load-reduction-only rules and caps', () => {
    const g = dependableByGroup(homes, day, 18, 4, demand, { count: 2000 });
    expect(evaluateAccess(rules('ieso-dera'), g).eligibleMW.energy).toBe(0);
    const ader = evaluateAccess(rules('ercot-ader'), g);
    expect(ader.eligibleMW.energy).toBeCloseTo(g.zone.dependableMW, 9);
    const ieso = evaluateAccess(rules('ieso-capacity'), g).eligibleMW.capacity!;
    expect(ieso).toBeLessThan(0.6 * g.zone.dependableMW);
    // The split into substations never adds capacity.
    expect(sum(g.nodes.map((n) => n.dependableMW))).toBeLessThanOrEqual(g.zone.dependableMW * 1.02);
    // A 10,000-home fleet runs into ERCOT's remaining Non-Spin room.
    const big = dependableByGroup(homes, day, 18, 4, demand, { count: 10000 });
    expect(evaluateAccess(rules('ercot-ader'), big).eligibleMW.reserves).toBeLessThanOrEqual(32);
    expect(evaluateAccess(rules('ercot-ader'), big).eligibleMW.reserves).toBeLessThan(big.zone.dependableMW);
  });

  it('challenge 7.6: a 1,000-home fleet has a largest substation count under the ADESR proposal', () => {
    const adesr = rules('ercot-adesr');
    const ok = (S: number) => dependableByGroup(homes, day, 18, S, demand, { count: 1000 }).nodes.every((n) => n.dependableMW >= adesr.minMW!);
    const counts = Array.from({ length: 8 }, (_, i) => i + 1);
    const best = counts.filter((S) => ok(S) && !ok(S + 1));
    expect(best.length).toBe(1);
    expect(best[0]).toBeGreaterThan(1);
    expect(ok(4)).toBe(false); // the lesson's four-substation, 1,000-home example falls short
  });

  it('the first demonstration compares the three markets lever by lever, from the rule data', () => {
    const lever = (id: string) => [locationLever(rules(id)), meteringLever(rules(id)), scopeLever(rules(id))];
    expect(lever('ercot-ader')).toEqual(['Whole zone · at least 0.1 MW · zonal price', 'Home batteries count, exports included', 'Energy and reserves · room left: 207 MW energy, 32 MW reserves']);
    expect(lever('ercot-adesr')).toEqual(['One substation · at least 1.0 MW · zonal price', 'Home batteries count, exports included', 'Energy only']);
    expect(lever('pjm-capacity')[2]).toBe('Capacity only');
    expect(lever('pjm-2222')[0]).toBe('One node (capacity: whole zone) · at least 0.1 MW · nodal price');
    expect(lever('pjm-2222')[2]).toBe('Energy, reserves and capacity');
    expect(lever('ieso-capacity').slice(0, 2)).toEqual(['Whole zone · no minimum modeled', 'Load cuts only: exports don’t count']);
    expect(lever('ieso-dera').slice(0, 2)).toEqual(['One node · 1–20 MW · nodal price', 'Front-of-meter only: home batteries excluded']);
  });

  it('values energy higher at Metro than at the hub', () => {
    const hist = standardHistory().slice(0, 20);
    expect(arbitrageValuePerMWday(hist.map((d) => d.daMetro))).toBeGreaterThan(arbitrageValuePerMWday(hist.map((d) => d.da)));
  });
});

// ---------------------------------------------------------------------------
// Every Chapter 7 lesson: no NaN or Infinity shown at any slider's extremes.

const modules = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch7/L7_*.tsx');

describe('chapter 7 lessons render finite numbers', () => {
  for (const [path, load] of Object.entries(modules)) {
    it(path, async () => {
      const Lesson = (await load()).default;
      const view = render(createElement(Lesson));
      const check = () => {
        const text = view.container.textContent ?? '';
        expect(text).not.toMatch(/NaN|Infinity/);
      };
      check();
      const inputs = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
      for (const input of inputs) {
        for (const v of [input.max, input.min]) {
          await act(async () => {
            fireEvent.change(input, { target: { value: v } });
          });
          check();
        }
      }
      for (const button of Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button'))) {
        await act(async () => {
          fireEvent.click(button);
        });
        check();
      }
      cleanup();
    }, 60000);
  }
});
