// Chapter 8: the nodal-day and adequacy engines, the capstone store, and the six lessons'
// challenges solved from the starting design. Also: the 24-hour market run stays fast.

import { describe, expect, it, beforeEach } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { dcopf } from '../src/engines/market/opf';
import { clearNodalDay, lineRents, summarizeNodalDay, violatedContingencies } from '../src/engines/market/nodalday';
import { disconnectedNodes, n1Security, outageImpact, reserveMargin } from '../src/engines/ops/adequacy';
import { REGION, REGION_LOAD_SHARE, THREE_NODE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { SYSTEM_DEMAND } from '../src/model/profiles';
import {
  addGenerator,
  buildNode,
  defaultDesign,
  getCapstone,
  nodeLoad,
  removeNode,
  resetCapstone,
  sanitize,
  saveAttempt,
  setCapstone,
  setNodeKind,
  setNodeLoad,
  toggleLine,
  updateCapstone,
  clearAttempts,
  type CapstoneDesign,
} from '../src/lessons/ch8/capstone';
import { argmax, capitalCost, checkDesign, clearMarketCache, emissions, nodeDemand, runMarket, systemDemand, systemOf } from '../src/lessons/ch8/system';
import { BUDGET, PROFIT_TARGET, candidates, evaluate } from '../src/lessons/ch8/strategy';
import { splitSweep, vppRevenue } from '../src/lessons/ch8/vpp';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('nodal day engine', () => {
  it('matches dcopf hour by hour on the three-node grid', () => {
    const units = [
      { id: 'gA', node: 'A', capacity: 500, offer: 20 },
      { id: 'gB', node: 'B', capacity: 600, offer: 50 },
    ];
    const loads = { C: [300, 450] };
    const day = clearNodalDay({ net: THREE_NODE, units, loads, security: false });
    const ref = dcopf(THREE_NODE, units, { C: 450 });
    expect(day).toHaveLength(2);
    expect(day[0].lmp.C).toBeCloseTo(20);
    expect(day[1].lmp.C).toBeCloseTo(ref.lmp.C);
    expect(day[1].dispatch.gB).toBeCloseTo(150);
    const s = summarizeNodalDay(day, units);
    // What load pays minus what generators receive is the congestion rent.
    const genRevenue = sum(Object.values(s.units).map((u) => u.revenue));
    expect(s.loadPayments - genRevenue).toBeCloseTo(s.congestionRent, 3);
    // Summed over lines, flow × price difference is the same rent.
    const rents = lineRents(THREE_NODE, day);
    expect(sum(Object.values(rents).map((r) => r[1]))).toBeCloseTo(day[1].congestionRent, 3);
    expect(s.congestedHours).toBe(1);
  });

  it('dispatches the region N-1 secure each hour', () => {
    const units = STANDARD_FLEET.filter((g) => !g.variable).map((g) => ({ id: g.id, node: g.node!, capacity: g.capacity, offer: g.marginalCost }));
    const loads = Object.fromEntries(Object.entries(REGION_LOAD_SHARE).map(([n, s]) => [n, SYSTEM_DEMAND.map((v) => v * s)]));
    const day = clearNodalDay({ net: REGION, units, loads });
    for (const h of day) {
      expect(h.feasible).toBe(true);
      const inj: Record<string, number> = {};
      for (const n of REGION.nodes) inj[n.id] = -(h.netLoad[n.id] ?? 0) + (h.shed[n.id] ?? 0);
      for (const u of units) inj[u.node] += h.dispatch[u.id];
      if (h.secure) expect(violatedContingencies(REGION, inj, REGION.lines.map((l) => l.id))).toEqual([]);
      for (const n of REGION.nodes) expect(Number.isFinite(h.lmp[n.id])).toBe(true);
    }
  });

  it('relaxes a must-run floor the grid cannot absorb', () => {
    const net = { nodes: THREE_NODE.nodes, lines: THREE_NODE.lines };
    const day = clearNodalDay({ net, units: [{ id: 'n', node: 'A', capacity: 500, offer: 9, minOutput: 450 }], loads: { C: [300] } });
    expect(day[0].floorsRelaxed).toBe(true);
    expect(day[0].dispatch.n).toBeCloseTo(300);
  });
});

describe('adequacy checks', () => {
  it('finds disconnected nodes, reserve margins and radial lines', () => {
    expect(disconnectedNodes(REGION)).toEqual([]);
    const cut = { nodes: [...REGION.nodes, { id: 'x', name: 'X', x: 0, y: 0 }], lines: REGION.lines };
    expect(disconnectedNodes(cut)).toEqual(['x']);
    expect(reserveMargin(115, 100)).toBeCloseTo(0.15);
    const radial = { nodes: THREE_NODE.nodes, lines: THREE_NODE.lines.filter((l) => l.id !== 'BC') };
    expect(outageImpact(radial, { A: 100, C: -100 }, 'AC').islanded).toEqual(['C']);
  });

  it('secure dispatch costs at least as much as the cheapest one', () => {
    const gens = STANDARD_FLEET.filter((g) => !g.variable).map((g) => ({ id: g.id, node: g.node!, capacity: g.capacity, offer: g.marginalCost }));
    const loads = Object.fromEntries(Object.entries(REGION_LOAD_SHARE).map(([n, s]) => [n, s * 1440]));
    const s = n1Security(REGION, gens, loads);
    expect(s.secure).toBe(true);
    expect(s.cost).toBeGreaterThanOrEqual(s.baseCost - 1e-6);
  });
});

describe('capstone store', () => {
  beforeEach(() => resetCapstone());

  it('starts from the course region and survives a round trip through storage', () => {
    const d = getCapstone();
    expect(d.nodes).toHaveLength(6);
    expect(d.lines).toHaveLength(8);
    expect(d.gens).toHaveLength(9);
    expect(sanitize(JSON.parse(JSON.stringify(d)))).toEqual(d);
    updateCapstone((x) => buildNode(x, 'tech'));
    expect(JSON.parse(window.localStorage.getItem('emc.capstone.v1')!).nodes).toContain('tech');
    resetCapstone();
    expect(getCapstone().nodes).not.toContain('tech');
  });

  it('repairs a damaged design instead of crashing', () => {
    expect(sanitize(null)).toEqual(defaultDesign());
    expect(sanitize({ v: 2 })).toEqual(defaultDesign());
    const bad = sanitize({ v: 1, nodes: ['city', 'nowhere', 'city'], lines: [{ id: 'center-city', limit: 9999 }, { id: 'bogus' }], gens: [{ id: 'g', fuel: 'gasCT', node: 'city', capacity: 'lots' }], loads: { city: { residential: -5 } } });
    expect(bad.nodes).toEqual(['city']);
    expect(bad.lines).toEqual([]); // Central isn't built, so its line can't be
    expect(bad.gens[0].capacity).toBe(0);
    expect(bad.loads.city.residential).toBe(0);
  });

  it('removing a substation removes what was attached to it', () => {
    const d = removeNode(defaultDesign(), 'city');
    expect(d.lines.some((l) => l.id.includes('city'))).toBe(false);
    expect(d.gens.some((g) => g.node === 'city')).toBe(false);
    expect(d.loads.city).toBeUndefined();
  });

  it('keeps a leaderboard of attempts', () => {
    clearAttempts();
    const a = saveAttempt({ score: 1, capital: 2, valid: true, investments: ['peaker'] });
    const b = saveAttempt({ score: 3, capital: 2, valid: false, investments: [] });
    expect(a.name).toBe('Attempt 1');
    expect(b.name).toBe('Attempt 2');
    expect(JSON.parse(window.localStorage.getItem('emc.capstone.attempts.v1')!)).toHaveLength(2);
    clearAttempts();
  });
});

describe('the starting design', () => {
  it('passes the 8.1 checks on a typical day and fails them on a hot one', () => {
    const d = defaultDesign();
    const c = checkDesign(d);
    expect(c.ok).toBe(true);
    expect(c.capacity.margin).toBeGreaterThan(0.15);
    const hot = checkDesign({ ...d, weather: 'hot' });
    expect(hot.capacity.ok).toBe(false);
    expect(hot.n1.ok).toBe(false);
    expect(capitalCost(d).total).toBeGreaterThan(5e9);
  });

  it('clears 24 hours of nodal prices well under a second', () => {
    clearMarketCache();
    const t0 = performance.now();
    const run = runMarket(systemOf(defaultDesign(), 'base'));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(run.hours).toHaveLength(24);
    expect(run.summary.unservedMWh).toBeLessThan(0.5);
    expect(run.summary.congestedHours).toBeGreaterThan(0);
    for (const h of run.hours) for (const n of defaultDesign().nodes) expect(Number.isFinite(h.lmp[n])).toBe(true);
    // Memoized: a second call is instant.
    const t1 = performance.now();
    expect(runMarket(systemOf(defaultDesign(), 'base'))).toBe(run);
    expect(performance.now() - t1).toBeLessThan(20);
  });

  it('storage never ends the day losing money once its price impact is counted', () => {
    const run = runMarket(systemOf(defaultDesign(), 'vpp'));
    for (const s of run.storage) expect(s.revenue).toBeGreaterThan(-1);
  });

  it('handles a disconnected design by shedding, not by crashing', () => {
    let d = buildNode(defaultDesign(), 'tech');
    d = setNodeLoad(d, 'tech', 200);
    const c = checkDesign(d);
    expect(c.connected.ok).toBe(false);
    expect(c.connected.cutOff).toEqual(['tech']);
    const run = runMarket(systemOf(d, 'base'));
    expect(run.summary.unservedMWh).toBeGreaterThan(1000);
    expect(run.hours.every((h) => Number.isFinite(h.lmp.tech))).toBe(true);
  });
});

describe('challenges are reachable from the starting design', () => {
  it('8.1: a 250 MW campus at Tech Park, all checks passing, under $400 million', () => {
    const start = capitalCost(defaultDesign()).total;
    let d: CapstoneDesign = buildNode(defaultDesign(), 'tech');
    d = setNodeLoad(d, 'tech', 250);
    d = toggleLine(d, 'tech-west');
    expect(checkDesign(d).n1.ok).toBe(false); // radial
    d = toggleLine(d, 'tech-city');
    d = addGenerator(d, 'gasCT', 'tech');
    const c = checkDesign(d);
    expect(nodeLoad(d, 'tech')).toBeGreaterThanOrEqual(250);
    expect(c.ok).toBe(true);
    expect(capitalCost(d).total - start).toBeLessThanOrEqual(400e6);
  });

  it('8.2: the region can be made to peak before 14:00 without losing energy', () => {
    const start = sum(systemDemand(nodeDemand(defaultDesign())));
    let d = setNodeKind(defaultDesign(), 'city', 'residential', 100);
    d = setNodeKind(d, 'city', 'commercial', 700);
    const region = systemDemand(nodeDemand(d));
    expect(argmax(region)).toBeLessThan(14);
    expect(sum(region)).toBeGreaterThanOrEqual(start);
  });

  it('8.4: siting renewables well halves emissions without adding congestion', () => {
    const d0 = defaultDesign();
    const before = runMarket(systemOf(d0, 'base'));
    // The starting plan barely moves emissions: its wind sits behind North's congested lines.
    const startPlan = runMarket(systemOf(d0, 'transition'));
    expect(emissions(startPlan) / emissions(before)).toBeGreaterThan(0.8);
    const d = { ...d0, transition: { ...d0.transition, windMW: 500, windNode: 'center', solarMW: 500, solarNode: 'city', storageMW: 200, storageNode: 'city' } };
    const after = runMarket(systemOf(d, 'transition'));
    expect(1 - emissions(after) / emissions(before)).toBeGreaterThanOrEqual(0.5);
    expect(after.summary.congestedHours).toBeLessThanOrEqual(before.summary.congestedHours);
    expect(after.summary.unservedMWh).toBeLessThan(0.5);
    // Or, keeping the starting solar and battery: 700 MW of wind at Central instead of North.
    const d2 = { ...d0, transition: { ...d0.transition, windMW: 700, windNode: 'center' } };
    const alt = runMarket(systemOf(d2, 'transition'));
    expect(1 - emissions(alt) / emissions(before)).toBeGreaterThanOrEqual(0.5);
    expect(alt.summary.congestedHours).toBeLessThanOrEqual(before.summary.congestedHours);
  });

  it('8.5: the best services share is a reachable 5% step and beats the default', () => {
    const d = defaultDesign();
    const sweep = splitSweep(d);
    const best = sweep.reduce((a, b) => (b.total > a.total ? b : a));
    expect(best.total).toBeGreaterThan(vppRevenue(d).revenue.total);
    const atBest = vppRevenue({ ...d, vpp: { ...d.vpp, services: best.services } }).revenue.total;
    expect(atBest).toBeGreaterThanOrEqual(best.total * 0.99);
    for (const s of sweep) expect(Number.isFinite(s.total)).toBe(true);
  });

  it('8.6: doing nothing fails, and a valid portfolio beats the target', () => {
    const d = defaultDesign();
    expect(evaluate(d, []).valid).toBe(false);
    const ids = candidates(d).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['ccgt', 'dr']));
    const pick = ['ccgt', 'upgrade2', 'dr'].filter((x) => ids.includes(x));
    const ev = evaluate(d, pick);
    expect(ev.capital).toBeLessThanOrEqual(BUDGET);
    expect(ev.valid).toBe(true);
    expect(ev.score).toBeGreaterThanOrEqual(PROFIT_TARGET);
  });
});

const lessons = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch8/L8_*.tsx');

describe('lessons render cleanly on odd designs', () => {
  const designs: Array<[string, () => CapstoneDesign]> = [
    ['the starting design', () => defaultDesign()],
    ['a design with no substations', () => ({ ...defaultDesign(), nodes: [], lines: [], gens: [], loads: {} })],
    ['a design with an unconnected substation', () => setNodeLoad(buildNode(defaultDesign(), 'tech'), 'tech', 300)],
    ['a design with no plants', () => ({ ...defaultDesign(), gens: [] })],
  ];
  for (const [label, make] of designs) {
    it(`every lesson renders ${label} without NaN`, async () => {
      setCapstone(make());
      for (const [path, load] of Object.entries(lessons)) {
        const mod = await load();
        let text = '';
        await act(async () => {
          const view = render(createElement(mod.default));
          text = view.container.textContent ?? '';
        });
        expect(text, path).not.toMatch(/NaN|undefined|Infinity/);
        cleanup();
      }
      resetCapstone();
    }, 30000);
  }
});
