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

  it('challenge 7.1a can be solved with the sliders (and is not solved at the start)', () => {
    const solves = (pv: number, kwh: number, kw: number, reserve: number) => {
      const d = simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: kw, batteryKWh: kwh, efficiency: 0.9, reserve, strategy: 'self' });
      return kwh > 0 && d.selfSufficiency >= 0.9 && sum(d.gridExport) < 1;
    };
    expect(solves(6, 0, 5, 0.2)).toBe(false);
    expect(solves(4.5, 20, 5, 0.2)).toBe(true);
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

  it('challenge 7.2: the smallest fleet promising 90% at 95% confidence is in the slider’s range, above 10 homes', () => {
    const sizes = [10, 20, 50, 100, 200, 500, 1000, 2000];
    const ratios = sizes.map((n) => {
      const d = availabilityDraws(homes, day, 18, { count: n, days: 400 });
      return d.dependable / d.mean;
    });
    const first = ratios.findIndex((r) => r >= 0.9);
    expect(first).toBeGreaterThan(0);
    expect(ratios[first - 1]).toBeLessThan(0.9);
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

  it('challenge 7.3 is reachable: over-dispatch and a large fleet keep delivery in tolerance', () => {
    const hard = { latencyS: 5, dropout: 0.2 };
    expect(vppScore({ devices: 500, ...hard, margin: 0.25 })).toBeGreaterThanOrEqual(0.8);
    expect(vppScore({ devices: 500, ...hard, margin: 0 })).toBeLessThan(0.5);
  });

  it('closed-loop correction helps with short delays and oscillates with long ones', () => {
    const p = (latencyS: number, feedback: number) => ({ devices: 300, latencyS, dropout: 0.2, margin: 0, feedback });
    expect(vppScore(p(2, 0))).toBeLessThan(0.2);
    expect(vppScore(p(2, 0.05))).toBeGreaterThan(0.9);
    expect(vppScore(p(2, 0.1))).toBeGreaterThan(0.9);
    expect(vppScore(p(10, 0.1))).toBeLessThan(0.5);
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

  it('challenge 7.4: a two-site split of 150 MW saves $25,000 a day; all at Metro does not', () => {
    const base = siting([]);
    const save = (b: SitedBattery[]) => base.cost - siting(b.filter((x) => x.powerMW > 0)).cost;
    expect(save([bat('city', 150)])).toBeLessThan(25000);
    expect(save([bat('city', 75), bat('east', 75)])).toBeGreaterThanOrEqual(25000);
    // The target is within about 2% of the best split on the figure's grid (two nodes, 25 MW steps).
    const nodes = ['north', 'east', 'center', 'harbor', 'west', 'city'];
    let best = 0;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        for (let a = 0; a <= 150; a += 25) best = Math.max(best, save([bat(nodes[i], a), bat(nodes[j], 150 - a)]));
    expect(25000 / best).toBeGreaterThan(0.975);
  }, 60000);
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

  it('challenge 7.5 has a solution in 0.25 MW steps, and the starting limit is not it', () => {
    const ratio = (L: number) =>
      L <= 0 ? 0 : scheduleFleet(prices, cohorts, { reserve: 0.2, availability: 0.9, feederLimitMW: L }).revenue / scheduleFleet(prices, cohorts, { reserve: 0.2, availability: 0.9 }).revenue;
    const steps = Array.from({ length: 24 }, (_, i) => (i + 1) * 0.25);
    const answer = steps.find((L) => ratio(L) >= 0.95 && ratio(L - 0.25) < 0.95);
    expect(answer).toBeDefined();
    expect(answer).not.toBe(2);
    expect(answer!).toBeLessThan(6);
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
