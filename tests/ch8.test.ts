// Chapter 8: the nodal-day and adequacy engines, the capstone store (resets, undo), and the six
// lessons' challenges: unsolved from the starting design, solved by the intended answer. Also: the
// 24-hour market run stays fast, and 8.6's target is relative to the reader's grid.

import { describe, expect, it, beforeEach } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { dcopf } from '../src/engines/market/opf';
import { clearNodalDay, lineRents, summarizeNodalDay, violatedContingencies } from '../src/engines/market/nodalday';
import { disconnectedNodes, n1Security, outageImpact, reserveMargin } from '../src/engines/ops/adequacy';
import { REGION, REGION_LOAD_SHARE, THREE_NODE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { SYSTEM_DEMAND } from '../src/model/profiles';
import {
  addGenerator,
  buildNode,
  clearHistory,
  defaultDesign,
  getCapstone,
  nodeLoad,
  removeNode,
  resetCapstone,
  resetLesson,
  sanitize,
  saveAttempt,
  setCapstone,
  setGenCapacity,
  setNodeKind,
  setNodeLoad,
  shiftHomesToOffices,
  toggleLine,
  undoCapstone,
  undoable,
  updateCapstone,
  withLessonReset,
  clearAttempts,
  type CapstoneDesign,
} from '../src/lessons/ch8/capstone';
import { capitalCost, checkDesign, clearMarketCache, newCapital, nodeDemand, runMarket, systemOf, transitionCapex } from '../src/lessons/ch8/system';
import { BUDGET, TARGET_SLACK, bestPortfolio, evaluate, profitTarget } from '../src/lessons/ch8/strategy';
import { HOME_BATTERY_COST_PER_KWH, VPP_OFFER, splitAnswer, splitSweep, vppRevenue } from '../src/lessons/ch8/vpp';
import { CAMPUS_BUDGET, campusCheck, guardedHour, hourInjections, outageFound, peakShiftSolved, shiftedPeakHour, siting, sitingSolved } from '../src/lessons/ch8/challenges';
import { GridControls, GridStrip } from '../src/lessons/ch8/ui';

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

  it('resets one lesson’s part of the grid and leaves the rest', () => {
    let d = buildNode(defaultDesign(), 'tech');
    d = setNodeLoad(d, 'tech', 250);
    d = setNodeKind(d, 'city', 'commercial', 500);
    d = { ...d, weather: 'hot', growth: 0.1, transition: { ...d.transition, windMW: 800 }, vpp: { ...d.vpp, services: 0.9 }, investments: ['ccgt'] };
    // 8.2's reset puts back the mix 8.1 left (Tech Park's campus included) and the typical day.
    const r2 = withLessonReset(d, '8.2');
    expect(r2.loads.city.commercial).toBe(defaultDesign().loads.city.commercial);
    expect(nodeLoad(r2, 'tech')).toBe(250);
    expect([r2.weather, r2.growth, r2.transition.windMW]).toEqual(['typical', 0, 800]);
    // 8.1's reset removes the campus but keeps 8.2's change to Metro's mix, and every later lesson.
    const r1 = withLessonReset(d, '8.1');
    expect(r1.nodes).not.toContain('tech');
    expect(r1.loads.city.commercial).toBe(500);
    expect([r1.weather, r1.transition.windMW, r1.vpp.services, r1.investments]).toEqual(['hot', 800, 0.9, ['ccgt']]);
    expect(withLessonReset(r1, '8.2').loads).toEqual(defaultDesign().loads);
    expect(withLessonReset(d, '8.4').transition).toEqual(defaultDesign().transition);
    expect(withLessonReset(d, '8.5').vpp).toEqual(defaultDesign().vpp);
    expect(withLessonReset(d, '8.6').investments).toEqual([]);
    // Home batteries survive their substation being removed and rebuilt.
    expect(buildNode(removeNode(defaultDesign(), 'city'), 'city').vpp.mw.city).toBe(defaultDesign().vpp.mw.city);
  });

  it('undoes a lesson’s own changes, a slider drag as one step, and a reset of the grid', () => {
    clearHistory();
    updateCapstone((x) => buildNode(x, 'tech'), { lesson: '8.1' });
    for (const v of [100, 150, 200]) updateCapstone((x) => setNodeLoad(x, 'tech', v), { lesson: '8.1', key: 'load:tech' });
    expect(undoable('8.1')).toBe('change');
    expect(undoable('8.4')).toBe('none');
    undoCapstone('8.4'); // not 8.4's change: nothing happens
    expect(nodeLoad(getCapstone(), 'tech')).toBe(200);
    undoCapstone('8.1');
    expect(getCapstone().nodes).toContain('tech');
    expect(nodeLoad(getCapstone(), 'tech')).toBe(0);
    resetCapstone();
    expect(undoable('8.5')).toBe('reset');
    undoCapstone('8.5');
    expect(getCapstone().nodes).toContain('tech');
    resetLesson('8.1');
    expect(getCapstone().nodes).not.toContain('tech');
    clearHistory();
  });

  it('asks before resetting the whole grid', () => {
    updateCapstone((x) => buildNode(x, 'tech'), { lesson: '8.1' });
    const view = render(createElement(GridControls, { lesson: '8.4' }));
    fireEvent.click(view.getByText('Reset grid'));
    expect(view.container.textContent).toContain('Reset your whole grid? This clears everything you’ve built in 8.1–8.6.');
    expect(getCapstone().nodes).toContain('tech');
    fireEvent.click(view.getByText('Cancel'));
    expect(getCapstone().nodes).toContain('tech');
    fireEvent.click(view.getByText('Reset grid'));
    fireEvent.click(view.getByText('Reset'));
    expect(getCapstone().nodes).not.toContain('tech');
    // The lesson's own reset asks too.
    act(() => updateCapstone((x) => ({ ...x, transition: { ...x.transition, windMW: 900 } }), { lesson: '8.4' }));
    fireEvent.click(view.getByText('Reset 8.4'));
    expect(getCapstone().transition.windMW).toBe(900);
    fireEvent.click(view.getByText('Reset'));
    expect(getCapstone().transition.windMW).toBe(defaultDesign().transition.windMW);
    cleanup();
    clearHistory();
  });

  it('sums up the grid so far, linked to where each part was built', () => {
    const d = { ...defaultDesign(), transition: { ...defaultDesign().transition, solarMW: 0 } };
    const view = render(createElement(GridStrip, { d, lesson: '8.6' }));
    const text = view.container.textContent ?? '';
    expect(text).toContain('6 substations, 8 lines and 2,530 MW of plants (8.1)');
    expect(text).toContain('300 MW of wind and a 150 MW battery (8.4)');
    expect(text).toContain('100 MW of home batteries (8.5)');
    const links = Array.from(view.container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#/8.1', '#/8.2', '#/8.4', '#/8.5']);
    cleanup();
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

describe('challenges: unsolved at the start, solved by the intended answer', () => {
  const campus = () => {
    let d: CapstoneDesign = buildNode(defaultDesign(), 'tech');
    d = setNodeLoad(d, 'tech', 250);
    d = toggleLine(d, 'tech-west');
    d = toggleLine(d, 'tech-city');
    return addGenerator(d, 'gasCT', 'tech');
  };

  it('8.1: a 250 MW campus at Tech Park, all checks passing, under $400 million of new capital', () => {
    expect(campusCheck(defaultDesign()).solved).toBe(false);
    let d: CapstoneDesign = buildNode(defaultDesign(), 'tech');
    d = setNodeLoad(d, 'tech', 250);
    d = toggleLine(d, 'tech-west');
    expect(checkDesign(d).n1.ok).toBe(false); // radial
    d = toggleLine(d, 'tech-city');
    // Two lines make it N-1 secure, but the region is now short of firm capacity.
    expect(checkDesign(d).n1.ok).toBe(true);
    expect(checkDesign(d).capacity.ok).toBe(false);
    d = addGenerator(d, 'gasCT', 'tech');
    const c = campusCheck(d);
    expect(c.solved).toBe(true);
    expect(c.added).toBeLessThanOrEqual(CAMPUS_BUDGET);
  });

  it('8.1: retiring plants doesn’t pay for the campus, and cutting other customers doesn’t count', () => {
    // Overspend with a second peaker, then try to pay for it by retiring Eastgate peaker and Old Quay oil.
    let d = addGenerator(campus(), 'gasCT', 'tech');
    expect(campusCheck(d).added).toBeGreaterThan(CAMPUS_BUDGET);
    d = setGenCapacity(setGenCapacity(d, 'ct', 0), 'oil', 0);
    expect(capitalCost(d).total - capitalCost(defaultDesign()).total).toBeLessThanOrEqual(CAMPUS_BUDGET); // the old, net measure
    expect(newCapital(d)).toBeGreaterThan(CAMPUS_BUDGET);
    expect(campusCheck(d).solved).toBe(false);
    // Making room by cutting Metro's customers.
    const cut = setNodeLoad(campus(), 'city', 700);
    expect(campusCheck(cut).cut).toEqual(['city']);
    expect(campusCheck(cut).solved).toBe(false);
  });

  it('8.2: the smallest share of household demand behaving like offices that brings the peak before 14:00', () => {
    const d = defaultDesign();
    expect(peakShiftSolved(d, 0)).toBe(false);
    const steps = Array.from({ length: 21 }, (_, i) => i * 0.05);
    const answer = steps.find((s) => shiftedPeakHour(d, s) < 14)!;
    expect(answer).toBeCloseTo(0.3);
    expect(peakShiftSolved(d, answer)).toBe(true);
    expect(peakShiftSolved(d, answer + 0.05)).toBe(false);
    // The peak jumps from the late afternoon to the morning rather than sliding (the success text).
    expect(shiftedPeakHour(d, answer - 0.05)).toBeGreaterThanOrEqual(16);
    expect(shiftedPeakHour(d, answer)).toBeLessThanOrEqual(11);
    // The what-if keeps the megawatts, only moving them between customer types.
    const x = shiftHomesToOffices(d, answer);
    expect(d.nodes.reduce((a, n) => a + nodeLoad(x, n), 0)).toBeCloseTo(d.nodes.reduce((a, n) => a + nodeLoad(d, n), 0), 6);
  });

  it('8.3: the outage behind a price separation with every line below its rating', () => {
    const run = runMarket(systemOf(defaultDesign(), 'base'));
    const h = guardedHour(run)!;
    expect(h).toBe(17);
    const hr = run.hours[h];
    expect(hr.binding).toEqual([]);
    expect(hr.bindingContingencies).toEqual([{ outage: 'center-city', line: 'west-city' }]);
    expect(outageFound(hr, null)).toBe(false);
    expect(outageFound(hr, 'west-city')).toBe(false);
    expect(outageFound(hr, 'east-city')).toBe(false);
    expect(outageFound(hr, 'center-city')).toBe(true);
    // Tripping it pushes the guarded line from well below its rating to it (what the figure shows).
    const net = run.sys.net;
    const lim = net.lines.find((l) => l.id === 'west-city')!.limit;
    const inj = hourInjections(run, h);
    expect(Math.abs(outageImpact(net, inj, null).flows['west-city']) / lim).toBeLessThan(0.6);
    expect(Math.abs(outageImpact(net, inj, 'center-city').flows['west-city']) / lim).toBeCloseTo(1, 2);
  });

  it('8.4: the smallest wind farm that halves emissions alone, and where it can go', () => {
    const d = defaultDesign();
    // The starting plan's wind, 300 MW at North, is where the challenge starts.
    expect(sitingSolved(d, 'typical', d.transition.windNode, d.transition.windMW)).toBe(false);
    expect(sitingSolved(d, 'typical', 'center', 600)).toBe(true);
    expect(sitingSolved(d, 'typical', 'center', 650)).toBe(false);
    expect(siting(d, 'typical', 'center', 550).ok).toBe(false);
    // Behind North's lines no size does it; next to the coal plant, the farm congests the lines out of West.
    expect(siting(d, 'typical', 'north', 1000).ok).toBe(false);
    const west = siting(d, 'typical', 'west', 600);
    expect(west.cut).toBeGreaterThanOrEqual(0.5);
    expect(west.after.summary.congestedHours).toBeGreaterThan(west.before.summary.congestedHours);
    // The plan's capital cost is shown, and grows with every slider.
    expect(transitionCapex(d)).toBeGreaterThan(1e9);
    expect(transitionCapex({ ...d, transition: { ...d.transition, windMW: 1000 } })).toBeGreaterThan(transitionCapex(d));
  });

  it('8.5: the services share where revenue peaks, and why it falls past it', () => {
    const d = defaultDesign();
    const sweep = splitSweep(d);
    const a = splitAnswer(sweep);
    expect(a.best.services).not.toBeCloseTo(d.vpp.services); // the default share isn't the answer
    expect(a.best.total).toBeGreaterThan(vppRevenue(d).revenue.total);
    expect(a.best.services).toBeCloseTo(0.95);
    expect(a.reason).toBe('reserve');
    // Past the peak more reserve is sold, for less: its price falls.
    expect(a.next!.reserve).toBeLessThan(a.best.reserve);
    expect(vppRevenue(d, a.next!.services).services.reduce((s, h) => s + h.vppReserve, 0)).toBeGreaterThan(vppRevenue(d, a.best.services).services.reduce((s, h) => s + h.vppReserve, 0));
    for (const s of sweep) expect(Number.isFinite(s.total)).toBe(true);
  });

  it('8.6: on the starting design, doing nothing fails and the best portfolio sets the target', () => {
    const d = defaultDesign();
    expect(evaluate(d, []).valid).toBe(false);
    const best = bestPortfolio(d)!;
    expect(best).not.toBeNull();
    const ev = evaluate(d, best.ids);
    expect(ev.valid).toBe(true);
    expect(ev.capital).toBeLessThanOrEqual(BUDGET);
    expect(ev.score).toBeGreaterThanOrEqual(profitTarget(best.score));
    expect(best.ids).toEqual(expect.arrayContaining(['ccgt', 'dr']));
    // The cheapest reliable portfolio isn't good enough: the lesson's point about the slope.
    const cheap = evaluate(d, ['ccgt', 'dr']);
    expect(cheap.valid).toBe(true);
    expect(cheap.score).toBeLessThan(profitTarget(best.score));
    expect(profitTarget(best.score)).toBeCloseTo(best.score * (1 - TARGET_SLACK), -5);
  }, 120_000);

  it('8.6: on a grid built without new lines, a fixed $30 million target would be out of reach but the relative one is met', () => {
    // 8.1 adds a combined-cycle plant at Metro and a peaker at East, and no lines: the planning year is long on capacity.
    let d = addGenerator(defaultDesign(), 'gasCC', 'city');
    d = addGenerator(d, 'gasCT', 'east');
    expect(evaluate(d, []).valid).toBe(true);
    const best = bestPortfolio(d)!;
    expect(best.score).toBeLessThan(30e6);
    const ev = evaluate(d, best.ids);
    expect(ev.valid).toBe(true);
    expect(ev.score).toBeGreaterThanOrEqual(profitTarget(best.score));
    // Doing nothing is valid here but earns nothing, which is short of the target.
    expect(evaluate(d, []).score).toBeLessThan(profitTarget(best.score));
  }, 120_000);
});

describe('claims in the prose, on the starting design', () => {
  it('8.2: Metro’s diversity factor is 1.16', () => {
    const d = defaultDesign();
    const peak = Math.max(...nodeDemand(d).city);
    expect(nodeLoad(d, 'city') / peak).toBeCloseTo(1.16, 2);
  });

  it('8.4: against the same plan without it, the battery’s charging lifts prices and its discharging trims them', () => {
    const d0 = defaultDesign();
    for (const weather of ['typical', 'hot', 'calm'] as const) {
      const d = { ...d0, weather };
      const withB = runMarket(systemOf(d, 'transition'));
      const without = runMarket(systemOf({ ...d, transition: { ...d.transition, storageMW: 0 } }, 'transition'));
      const b = withB.storage.find((s) => s.id === 'tr-battery')!;
      const n = b.node;
      for (let h = 0; h < 24; h++) {
        const pW = withB.hours[h].lmp[n];
        const pN = without.hours[h].lmp[n];
        const wrongWay = (b.schedule[h] > 0.5 && pW > pN + 0.5) || (b.schedule[h] < -0.5 && pW < pN - 0.5);
        // The only exceptions are hours whose N-1 security the battery changes, which the prose explains.
        if (wrongWay) expect(withB.hours[h].secure, `${weather} ${h}:00`).not.toBe(without.hours[h].secure);
      }
      if (weather === 'typical') {
        // On the starting day the battery stops short of its full power (8.4’s caption; 8.5’s opening).
        expect(Math.max(...b.schedule.map(Math.abs))).toBeLessThan(0.99 * d.transition.storageMW);
        // And its charging does lift a cheap hour, which the no-additions grid would hide.
        expect(b.schedule.some((x, h) => x < -0.5 && withB.hours[h].lmp[n] > without.hours[h].lmp[n] + 0.5)).toBe(true);
      }
    }
  });

  it('8.5: home batteries at $1,000/kWh take longer than their warranty to pay back', () => {
    const d = defaultDesign();
    expect(HOME_BATTERY_COST_PER_KWH).toBe(1000);
    const r = vppRevenue(d);
    const kwYr = (r.revenue.total * 365) / (r.totalMW * 1000);
    const payback = (HOME_BATTERY_COST_PER_KWH * d.vpp.hours) / kwYr;
    expect(payback).toBeGreaterThan(15);
    expect(payback).toBeLessThan(80);
  });

  it('8.5: from the share that covers the regulation requirement on, the VPP is paid only its own offer for it', () => {
    const d = defaultDesign();
    const r = vppRevenue(d);
    const regMax = Math.max(...r.services.map((h) => h.regulationReq));
    const full = Math.ceil((regMax / r.totalMW) * 20 - 1e-9) / 20;
    const at = vppRevenue(d, full);
    expect(at.revenue.regulation).toBeCloseTo(VPP_OFFER.regulation * at.services.reduce((s, h) => s + h.regulationReq, 0), 6);
    // Just below it, regulation pays more.
    expect(vppRevenue(d, full - 0.05).revenue.regulation).toBeGreaterThan(at.revenue.regulation);
  });

  it('8.5: the dearest node before the VPP is one of its sites, so the grid-effect lines differ', () => {
    const d = defaultDesign();
    const before = runMarket(systemOf(d, 'transition'));
    const after = runMarket(systemOf(d, 'vpp'));
    const node = before.summary.peakPrice.node;
    expect(after.storage.some((s) => s.kind === 'vpp' && s.node === node)).toBe(true);
    expect(after.netLoads[node].some((x, h) => Math.abs(x - before.netLoads[node][h]) > 0.5)).toBe(true);
  });
});

const lessons = import.meta.glob<{ default: ComponentType }>('../src/lessons/ch8/L8_*.tsx');

describe('lessons render cleanly on odd designs', () => {
  const designs: Array<[string, () => CapstoneDesign]> = [
    ['the starting design', () => defaultDesign()],
    ['a design with no substations', () => ({ ...defaultDesign(), nodes: [], lines: [], gens: [], loads: {} })],
    ['a design with an unconnected substation', () => setNodeLoad(buildNode(defaultDesign(), 'tech'), 'tech', 300)],
    ['a design with no plants', () => ({ ...defaultDesign(), gens: [] })],
    ['a design with a reshaped customer mix', () => shiftHomesToOffices(setNodeKind(defaultDesign(), 'east', 'dataCenter', 200), 0.5)],
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

describe('chapter 8 in the two-up layout', () => {
  const setWide = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };

  it('every lesson moves its figures into the panel and shows one at a time', async () => {
    const original = window.matchMedia;
    setWide(true);
    resetCapstone();
    try {
      for (const [path, load] of Object.entries(lessons)) {
        const mod = await load();
        let container: HTMLElement = document.body;
        await act(async () => {
          container = render(createElement(mod.default)).container;
          await new Promise((r) => setTimeout(r, 30));
        });
        expect(container.querySelectorAll('.tu-panel figure').length, path).toBeGreaterThan(0);
        expect(container.querySelectorAll('.tu-text figure').length, path).toBe(0);
        expect(Array.from(container.querySelectorAll<HTMLElement>('.tu-panel .tu-slot')).filter((x) => !x.hidden).length, path).toBe(1);
        cleanup();
      }
    } finally {
      window.matchMedia = original;
    }
  }, 60_000);
});
