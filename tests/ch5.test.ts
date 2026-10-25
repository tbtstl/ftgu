// Chapter 5: engines for network dispatch, congestion rights and scarcity, and the numbers the
// lessons quote in their prose and challenges.

import { describe, expect, it } from 'vitest';
import { dcopf } from '../src/engines/market/opf';
import {
  boundarySegment,
  checkDispatch,
  contingencyScan,
  dispatchPlane,
  feasiblePolygon,
  fleetOffers,
  meritOrderDispatch,
  nearestVertex,
  nodalLoads,
  satisfies,
  vertexWalk,
  type Pt,
} from '../src/engines/market/networkDispatch';
import { ftrFeasible, ftrFlows, ftrPlane, hedgedCostPerMWh, rentByLine, settleFtrs } from '../src/engines/market/congestionRights';
import { reserveUnitsFromFleet, scarcityClear, scarcityCurve } from '../src/engines/market/scarcity';
import { lmpComponents, shadowPrices, transferPtdf } from '../src/engines/market/lmpComponents';
import { computePtdf, dcPowerFlow } from '../src/engines/physics/powerflow';
import { STANDARD_FLEET, fleetById } from '../src/model/fleet';
import { REGION, REGION_LOAD_SHARE, THREE_NODE } from '../src/model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { rng } from '../src/model/random';
import { HAND_DEFAULTS, handDispatch, handDispatchSolved } from '../src/lessons/ch5/L5_1';
import { CHALLENGE_LIMIT, CHALLENGE_RELIEF, CONGESTION_DEFAULTS, handSwap, leastSwap, swapSolved } from '../src/lessons/ch5/L5_2';
import { TARGET_C, TRIANGLE_DEFAULTS, priceSolved } from '../src/lessons/ch5/L5_3';
import { FTR_STEP, HEDGE_DEFAULTS, RETAIL_PRICE, hedgeCosts, hedgeSolved } from '../src/lessons/ch5/L5_4';
import { NIGHT_DEFAULTS, POCKET_DEFAULTS, mixedSolved, pocketSolved } from '../src/lessons/ch5/L5_5';
import { PUZZLE_DEFAULTS, puzzleSolved } from '../src/lessons/ch5/L5_6';

const PEAK = SYSTEM_DEMAND[19];
const LOADS = nodalLoads(PEAK, REGION_LOAD_SHARE);
const LINES = REGION.lines.map((l) => l.id);

// Lessons 5.3 and 5.4: A has enough capacity (700 MW) to meet any demand on the sliders by itself.
function threeNode(demand: number, limit: number, bOffer = 50) {
  return dcopf(
    THREE_NODE,
    [
      { id: 'gA', node: 'A', capacity: 700, offer: 20 },
      { id: 'gB', node: 'B', capacity: 600, offer: bOffer },
    ],
    { C: demand },
    { limits: { AC: limit } },
  );
}

describe('network dispatch engine', () => {
  it('builds offers and loads from the shared model', () => {
    const g = fleetOffers(STANDARD_FLEET, { windCF: 0.4, solarCF: 0 });
    expect(g.find((x) => x.id === 'wind')!.capacity).toBeCloseTo(140);
    expect(g.find((x) => x.id === 'solar')!.capacity).toBe(0);
    expect(g.find((x) => x.id === 'nuc')!.minOutput).toBe(360);
    expect(fleetOffers(STANDARD_FLEET, { mustRun: false }).every((x) => x.minOutput === 0)).toBe(true);
    expect(Object.values(LOADS).reduce((s, v) => s + v, 0)).toBeCloseTo(PEAK);
  });

  it('checks a dispatch with the same flows as DC power flow', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: 0.4, solarCF: 0 });
    const r = dcopf(REGION, gens, LOADS);
    const c = checkDispatch(REGION, gens, r.dispatch, LOADS);
    for (const l of LINES) expect(c.flows[l]).toBeCloseTo(r.flows[l], 6);
    expect(c.cost).toBeCloseTo(r.cost, 6);
    expect(c.imbalance).toBeCloseTo(0, 6);
    expect(c.overloads).toEqual([]);
  });

  it('finds the same binding contingencies as the security-constrained optimizer', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: 0.4, solarCF: 0 });
    const r = dcopf(REGION, gens, LOADS, { contingencies: LINES, lmp: false });
    const scan = contingencyScan(REGION, gens, r.dispatch, LOADS, LINES);
    for (const c of scan) expect(c.overloads).toEqual([]);
    const atLimit = scan.flatMap((c) => c.lines.filter((l) => l.loading > 1 - 1e-6).map((l) => `${c.outage}>${l.id}`));
    expect(atLimit).toEqual(r.bindingContingencies.map((b) => `${b.outage}>${b.line}`));
  });

  it('clips polygons and walks to the cheapest corner', () => {
    // Unit square cut by x + y ≤ 1.5.
    const poly = feasiblePolygon([0, 1, 0, 1], [{ a: 1, b: 1, c: 1.5, id: 'cut' }]);
    expect(poly.length).toBe(5);
    const cost = (p: Pt) => -p[0] - 2 * p[1];
    for (let s = 0; s < poly.length; s++) {
      const path = vertexWalk(poly, cost, s);
      const end = path[path.length - 1];
      expect(end[0]).toBeCloseTo(0.5);
      expect(end[1]).toBeCloseTo(1);
    }
    expect(feasiblePolygon([0, 1, 0, 1], [{ a: 1, b: 0, c: -1, id: 'none' }])).toEqual([]);
    expect(boundarySegment({ a: 1, b: 1, c: 1.5, id: 'cut' }, [0, 1, 0, 1])).not.toBeNull();
    expect(nearestVertex(poly, [0, 0])).toBe(0);
  });

  it('describes a dispatch slice whose flows match a full power flow', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: 1, solarCF: 0 });
    const opt = dcopf(REGION, gens, LOADS, { outages: ['north-east'], lmp: false });
    const plane = dispatchPlane(REGION, gens, LOADS, opt.dispatch, 'coal', 'cc2', 'cc1', { outages: ['north-east'] });
    const x = 200;
    const y = 120;
    const d = { ...opt.dispatch, coal: x, cc2: y, cc1: plane.balance.b0 - x - y };
    const full = checkDispatch(REGION, gens, d, LOADS, { outages: ['north-east'] });
    for (const [id, f] of Object.entries(plane.flow)) expect(f.f0 + f.fx * x + f.fy * y).toBeCloseTo(full.flows[id], 6);
    expect(plane.cost.c0 + plane.cost.cx * x + plane.cost.cy * y).toBeCloseTo(full.cost, 6);
  });
});

describe('lesson 5.1: a windy peak with North–East out', () => {
  const gens = fleetOffers(STANDARD_FLEET, { windCF: 1, solarCF: 0 });
  const OUT = ['north-east'];
  const opt = dcopf(REGION, gens, LOADS, { outages: OUT, lmp: false });
  const merit = meritOrderDispatch(gens, PEAK);
  const mc = checkDispatch(REGION, gens, merit, LOADS, { outages: OUT });

  it('the merit order overloads two lines into Metro', () => {
    expect(mc.cost).toBeCloseTo(23640);
    expect(merit.cc1).toBeCloseTo(240);
    expect(mc.overloads.map((o) => o.id).sort()).toEqual(['center-city', 'west-city']);
    expect(Math.round(Math.abs(mc.flows['center-city']))).toBe(616);
    expect(Math.round(Math.abs(mc.flows['west-city']))).toBe(320);
  });

  it('the optimizer swaps Lakeside for about 80 MW of Mill Creek', () => {
    expect(Math.round(opt.cost)).toBe(24118);
    expect(Math.round(opt.cost - mc.cost)).toBe(478);
    expect(Math.round((opt.cost / mc.cost - 1) * 100)).toBe(2);
    expect(opt.dispatch.coal).toBeCloseTo(300);
    expect(Math.round(opt.dispatch.cc2)).toBe(80);
    expect(opt.dispatch.ct).toBeCloseTo(0);
    expect(opt.binding).toEqual(['west-city']);
  });

  it('lowering Ironwood loads Central–Metro more; Mill Creek relieves both full lines', () => {
    const { ptdf } = computePtdf(REGION, OUT);
    // Ironwood down, Lakeside up by the same amount.
    expect(ptdf['center-city'].center - ptdf['center-city'].west).toBeGreaterThan(0);
    // Mill Creek up, Lakeside down.
    for (const l of ['center-city', 'west-city']) {
      const f = mc.flows[l];
      const d = (ptdf[l].city - ptdf[l].center) * Math.sign(f);
      expect(d).toBeLessThan(0);
    }
  });

  it('the slice holds the other plants at their merit-order outputs, which the optimizer leaves alone', () => {
    for (const id of ['nuc', 'wind', 'solar', 'hydro', 'ct', 'oil']) expect(opt.dispatch[id]).toBeCloseTo(merit[id], 6);
    expect(merit).toMatchObject({ nuc: 400, wind: 350, hydro: 150, ct: 0, oil: 0 });
  });

  it('the slice’s polygon is bounded by Central–Metro, West–Metro and Lakeside at zero', () => {
    const plane = dispatchPlane(REGION, gens, LOADS, merit, 'coal', 'cc2', 'cc1', { outages: OUT });
    const poly = feasiblePolygon(plane.box, plane.constraints);
    const edges = new Set<string>();
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      for (const h of plane.constraints) {
        const on = (r: Pt) => Math.abs(h.a * r[0] + h.b * r[1] - h.c) < 1e-6 * (1 + Math.abs(h.c));
        if (on(p) && on(q)) edges.add(h.id);
      }
    });
    expect([...edges].sort()).toEqual(['balance:min', 'center-city:max', 'west-city:max']);
    const cost = (p: Pt) => plane.cost.c0 + plane.cost.cx * p[0] + plane.cost.cy * p[1];
    const best = poly.reduce((b, p) => (cost(p) < cost(b) ? p : b));
    expect(best[0]).toBeCloseTo(300);
    expect(best[1]).toBeCloseTo(opt.dispatch.cc2, 4);
    expect(cost(best)).toBeCloseTo(opt.cost, 4);
    expect(plane.cost.cx).toBe(-8);
    expect(plane.cost.cy).toBe(6);
    // The merit order sits outside, below both full-line edges, about 80 MW of Mill Creek short of the boundary.
    expect(satisfies([300, 0], plane.constraints)).toBe(false);
    const broken = plane.constraints.filter((h) => h.a * 300 > h.c + 1e-6).map((h) => h.id);
    expect(broken.sort()).toEqual(['center-city:max', 'west-city:max']);
    const gap = Math.min(...poly.filter((p) => Math.abs(p[0] - 300) < 1e-6).map((p) => p[1]));
    expect(Math.round(gap)).toBe(80);
  });

  it('only the labeled constraints can be violated anywhere in the slice', () => {
    const plane = dispatchPlane(REGION, gens, LOADS, merit, 'coal', 'cc2', 'cc1', { outages: OUT });
    const seen = new Set<string>();
    for (let x = 120; x <= 300; x += 5)
      for (let y = 0; y <= 250; y += 5)
        for (const h of plane.constraints) if (h.a * x + h.b * y > h.c + 1e-6) seen.add(h.id);
    expect([...seen].sort()).toEqual(['balance:max', 'balance:min', 'center-city:max', 'west-city:max']);
  });

  it('the challenge is reachable on 5 MW slider steps', () => {
    const d = { nuc: 400, wind: 350, solar: 0, coal: 300, hydro: 150, cc2: 80, ct: 0, oil: 0, cc1: 0 };
    d.cc1 = PEAK - (d.nuc + d.wind + d.coal + d.hydro + d.cc2 + d.ct + d.oil);
    const c = checkDispatch(REGION, gens, d, LOADS, { outages: OUT });
    expect(d.cc1).toBeGreaterThanOrEqual(0);
    expect(c.overloads).toEqual([]);
    expect(c.cost / opt.cost - 1).toBeLessThanOrEqual(0.01);
  });

  it('the hand dispatch holds hydro at its merit-order 150 MW; the challenge starts unsolved and Mill Creek solves it', () => {
    expect(HAND_DEFAULTS).toEqual({ coal: 300, cc2: 0, ct: 0, oil: 0 });
    const d = handDispatch(HAND_DEFAULTS);
    for (const id of Object.keys(merit)) expect(d[id]).toBeCloseTo(merit[id], 6);
    expect(handDispatchSolved(HAND_DEFAULTS)).toBe(false);
    expect(handDispatchSolved({ coal: 300, cc2: 80, ct: 0, oil: 0 })).toBe(true);
    // Every dispatch within 1% runs Mill Creek: Eastgate and Old Quay relieve the lines too, but cost too much to do it alone.
    let n = 0;
    for (let coal = 120; coal <= 300; coal += 5)
      for (let cc2 = 0; cc2 <= 250; cc2 += 5)
        for (const ct of [0, 5, 50])
          for (const oil of [0, 5])
            if (handDispatchSolved({ coal, cc2, ct, oil })) {
              n++;
              expect(cc2).toBeGreaterThanOrEqual(40);
              expect(ct + oil).toBeLessThanOrEqual(5);
            }
    expect(n).toBeGreaterThan(10);
    for (let coal = 120; coal <= 300; coal += 10)
      for (let ct = 0; ct <= 200; ct += 10) for (let oil = 0; oil <= 80; oil += 10) expect(handDispatchSolved({ coal, cc2: 0, ct, oil })).toBe(false);
  });

  it('the first try, turning Ironwood down, clears West–Metro but loads Central–Metro further', () => {
    const c = checkDispatch(REGION, gens, handDispatch({ ...HAND_DEFAULTS, coal: 200 }), LOADS, { outages: OUT });
    expect(c.overloads.map((o) => o.id)).toEqual(['center-city']);
    expect(Math.abs(c.flows['center-city'])).toBeGreaterThan(Math.abs(mc.flows['center-city']));
  });
});

describe('lesson 5.2: derating Central–Metro on the reference evening', () => {
  const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: SOLAR_CF[19] });
  const base = dcopf(REGION, gens, LOADS);
  const at = (limit: number, extra?: { node: string; mw: number }) =>
    dcopf(REGION, gens, extra ? { ...LOADS, [extra.node]: LOADS[extra.node] + extra.mw } : LOADS, { limits: { 'center-city': limit } });

  it('the unconstrained dispatch puts 425 MW on Central–Metro', () => {
    expect(base.cost).toBeCloseTo(31500);
    expect(Math.round(base.flows['center-city'])).toBe(425);
    expect(at(430).cost - base.cost).toBeCloseTo(0, 6);
    expect(at(420).cost - base.cost).toBeGreaterThan(1);
  });

  it('every MW of relief takes 1.56 MW of Lakeside→Mill Creek, then 2.27 MW of Lakeside→Eastgate', () => {
    const p = computePtdf(REGION).ptdf['center-city'];
    // The PTDF of a Central-to-Metro transfer on Central–Metro, and its reciprocal.
    expect(p.center - p.city).toBeCloseTo(0.64, 2);
    expect(1 / (p.center - p.city)).toBeCloseTo(1.56, 2);
    expect(1 / (p.center - p.east)).toBeCloseTo(2.27, 2);
    expect((at(300).cost - at(400).cost) / 100).toBeCloseTo(9.38, 2);
    expect(Math.round((at(220).cost - at(280).cost) / 60)).toBe(118);
    // Mill Creek fills between 300 and 295 MW.
    expect(at(300).dispatch.cc2).toBeLessThan(250);
    expect(at(295).dispatch.cc2).toBeCloseTo(250);
  });

  it('by hand: moving Lakeside’s output to Mill Creek relieves the line 0.64 MW per MW, at $6 each, overloading nothing else', () => {
    const p = computePtdf(REGION).ptdf['center-city'];
    for (let sw = 0; sw <= 200; sw += 10) {
      const h = handSwap(sw);
      expect(h.flow).toBeCloseTo(base.flows['center-city'] - sw * (p.center - p.city), 6);
      expect(h.cost).toBeCloseTo(6 * sw, 6);
      expect(h.overloads).toEqual([]);
    }
    // Mill Creek has 200 MW of room at the cheapest dispatch, and Lakeside is flat out.
    expect(base.dispatch.cc2).toBeCloseTo(50, 6);
    expect(base.dispatch.cc1).toBeCloseTo(400, 6);
    // The prose's first try: 400 MW takes about 39 MW.
    expect(leastSwap(400)).toBe(39);
  });

  it('the challenge: 50 MW of relief takes 50 × 1.56 ≈ 78 MW of redispatch', () => {
    expect(CHALLENGE_RELIEF).toBe(50);
    expect(CHALLENGE_LIMIT).toBe(375);
    expect(leastSwap(CHALLENGE_LIMIT)).toBe(78);
    const p = computePtdf(REGION).ptdf['center-city'];
    expect(Math.round(CHALLENGE_RELIEF / (p.center - p.city))).toBe(78);
    // The default is unsolved; the predicted swap solves it, and so does one more megawatt, but not more or less.
    expect(swapSolved(CONGESTION_DEFAULTS.limit, CONGESTION_DEFAULTS.swap)).toBe(false);
    expect(swapSolved(375, 0)).toBe(false);
    expect(swapSolved(375, 77)).toBe(false);
    expect(swapSolved(375, 78)).toBe(true);
    expect(swapSolved(375, 79)).toBe(true);
    expect(swapSolved(375, 80)).toBe(false);
    expect(swapSolved(400, 39)).toBe(false);
    expect(Math.round(handSwap(78).cost)).toBe(468);
    // The optimizer makes the same swap: about 78 MW from Lakeside to Mill Creek, nothing else.
    const r = at(375);
    expect(r.dispatch.cc2 - base.dispatch.cc2).toBeCloseTo(78.41, 2);
    expect(r.dispatch.cc1 - base.dispatch.cc1).toBeCloseTo(-78.41, 2);
    expect(r.dispatch.ct).toBeCloseTo(0, 6);
  });

  it('marginal costs: $42 everywhere uncongested; $36 to $112 at 250 MW', () => {
    for (const n of REGION.nodes) expect(at(600).lmp[n.id]).toBeCloseTo(42);
    const r = at(250);
    expect(r.lmp.center).toBeCloseTo(36);
    expect(r.lmp.east).toBeCloseTo(88);
    expect(Math.round(r.lmp.city)).toBe(112);
    // The readout and the prose quote it to the cent; it's more than Eastgate's $88, the dearest plant running.
    expect(r.lmp.city).toBeCloseTo(111.64, 2);
    expect(r.dispatch.ct).toBeGreaterThan(1);
    expect(r.dispatch.oil).toBeCloseTo(0, 6);
    const running = gens.filter((g) => (r.dispatch[g.id] ?? 0) > 1e-6).map((g) => g.offer);
    expect(Math.max(...running)).toBe(88);
    const b = dcopf(REGION, gens, { ...LOADS, city: LOADS.city + 1 }, { limits: { 'center-city': 250 }, lmp: false });
    expect(b.dispatch.ct - r.dispatch.ct).toBeCloseTo(1.45, 2);
    expect(b.dispatch.cc1 - r.dispatch.cc1).toBeCloseTo(-0.45, 2);
    expect(b.dispatch.cc2 - r.dispatch.cc2).toBeCloseTo(0, 6);
    // Every other node lands in between.
    for (const n of ['north', 'harbor', 'west']) {
      expect(r.lmp[n]).toBeGreaterThan(36);
      expect(r.lmp[n]).toBeLessThan(112);
    }
  });

  it('stays feasible with positive marginal costs over the whole slider range', () => {
    for (let l = 220; l <= 600; l += 5) {
      const r = at(l);
      expect(r.feasible).toBe(true);
      for (const n of REGION.nodes) expect(r.lmp[n.id]).toBeGreaterThan(0);
      for (const n of REGION.nodes) {
        const b = at(l, { node: n.id, mw: 1 });
        expect(b.feasible).toBe(true);
      }
    }
  });
});

describe('lesson 5.3: nodal prices on three nodes', () => {
  const triGens = (b: number) => [
    { id: 'gA', node: 'A', capacity: 700, offer: 20 },
    { id: 'gB', node: 'B', capacity: 600, offer: b },
  ];
  const triParts = (d: number, l: number, b: number) => {
    const opts = { limits: { AC: l } };
    const r = threeNode(d, l, b);
    const cons = shadowPrices(THREE_NODE, triGens(b), { C: d }, opts, r);
    return { r, cons, parts: lmpComponents(THREE_NODE, 'A', r.lmp.A, cons) };
  };

  it('prices separate only when line A–C is full, across the whole slider range', () => {
    // The limit slider starts at 210 MW: at 200 MW, 600 MW of demand is all the grid can deliver to C.
    for (let l = 210; l <= 500; l += 10)
      for (let d = 100; d <= 600; d += 10)
        for (const b of [30, 60, 90]) {
          const r = threeNode(d, l, b);
          expect(r.feasible).toBe(true);
          if (r.binding.includes('AC')) {
            expect(r.lmp.A).toBeCloseTo(20, 6);
            expect(r.lmp.B).toBeCloseTo(b, 6);
            expect(r.lmp.C).toBeCloseTo(2 * b - 20, 6);
          } else for (const n of ['A', 'B', 'C']) expect(r.lmp[n]).toBeCloseTo(20, 6);
        }
  });

  it('the starting point is uncongested and the challenge is reachable', () => {
    const r = threeNode(300, 250);
    expect(r.binding).toEqual([]);
    expect(r.lmp.C).toBeCloseTo(20, 6);
    expect(threeNode(450, 250, 60).lmp.C).toBeCloseTo(100, 6);
  });

  it('the challenge: $100 at C takes B offering ($100 + $20) ÷ 2 = $60, with the line full', () => {
    expect(TARGET_C).toBe(100);
    expect(priceSolved(TRIANGLE_DEFAULTS)).toBe(false);
    expect(priceSolved({ demand: 450, limit: 250, bOffer: 60 })).toBe(true);
    expect(priceSolved({ demand: 600, limit: 300, bOffer: 60 })).toBe(true);
    // B's offer alone isn't enough while the line has room, and the settlement example's $50 gives $80.
    expect(priceSolved({ ...TRIANGLE_DEFAULTS, bOffer: 60 })).toBe(false);
    expect(priceSolved({ demand: 450, limit: 250, bOffer: 50 })).toBe(false);
    for (let b = 30; b <= 90; b++) expect(priceSolved({ demand: 450, limit: 250, bOffer: b })).toBe(b === 60);
  });

  it('opens on Metro’s price from Lesson 5.2: $111.64, above every running plant’s offer', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: SOLAR_CF[19] });
    const r = dcopf(REGION, gens, LOADS, { limits: { 'center-city': 250 } });
    expect(r.lmp.city).toBeCloseTo(111.64, 2);
    expect(fleetById('ct').marginalCost).toBe(88);
    expect(r.dispatch.ct).toBeGreaterThan(1);
    for (const g of gens) if ((r.dispatch[g.id] ?? 0) > 1e-6) expect(g.offer).toBeLessThanOrEqual(88);
  });

  it('settlement: each side at its own node’s price, and the rent is the difference', () => {
    const r = threeNode(450, 250, 50);
    expect(r.dispatch.gA).toBeCloseTo(300, 6);
    expect(r.dispatch.gB).toBeCloseTo(150, 6);
    const paidA = r.dispatch.gA * r.lmp.A;
    const paidB = r.dispatch.gB * r.lmp.B;
    const loadsPay = 450 * r.lmp.C;
    expect(paidA).toBeCloseTo(6000, 3);
    expect(paidB).toBeCloseTo(7500, 3);
    expect(loadsPay).toBeCloseTo(36000, 3);
    expect(loadsPay - paidA - paidB).toBeCloseTo(22500, 3);
    expect(r.congestionRent).toBeCloseTo(loadsPay - paidA - paidB, 3);
    // Uncongested, the table balances to zero.
    const u = threeNode(300, 250, 50);
    expect(300 * u.lmp.C - u.dispatch.gA * u.lmp.A - u.dispatch.gB * u.lmp.B).toBeCloseTo(0, 6);
  });

  it('the shadow price is 3 × (B’s offer − $20), and the PTDFs from A are 2/3 to C and 1/3 to B', () => {
    expect(transferPtdf(THREE_NODE, 'AC', 'A', 'C')).toBeCloseTo(2 / 3, 9);
    expect(transferPtdf(THREE_NODE, 'AC', 'A', 'B')).toBeCloseTo(1 / 3, 9);
    expect(transferPtdf(THREE_NODE, 'AC', 'A', 'A')).toBeCloseTo(0, 9);
    const t = triParts(450, 250, 50);
    expect(t.cons).toHaveLength(1);
    expect(t.cons[0]).toMatchObject({ line: 'AC', direction: 1, shared: false });
    expect(t.cons[0].mu).toBeCloseTo(90, 6);
    expect(t.parts.C.terms[0].ptdf).toBeCloseTo(2 / 3, 9);
    expect(t.parts.B.terms[0].ptdf).toBeCloseTo(1 / 3, 9);
    expect(t.parts.C.total).toBeCloseTo(80, 6);
    for (const b of [30, 50, 60, 90]) expect(triParts(450, 250, b).cons[0].mu).toBeCloseTo(3 * (b - 20), 6);
    expect(triParts(300, 250, 50).cons).toEqual([]);
  });

  it('λ + Σ μ × PTDF reproduces the engine’s LMP at every node, everywhere on the sliders', () => {
    for (let l = 210; l <= 500; l += 10)
      for (let d = 100; d <= 600; d += 10)
        for (const b of [30, 45, 60, 90]) {
          const t = triParts(d, l, b);
          for (const n of ['A', 'B', 'C']) {
            expect(Math.abs(t.parts[n].total - t.r.lmp[n])).toBeLessThan(0.006);
            expect(t.parts[n].loss).toBe(0);
            expect(t.parts[n].energy).toBeCloseTo(20, 6);
          }
        }
  });

  describe('back to Metro', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: SOLAR_CF[19] });
    const at = (limit: number, ref = 'center') => {
      const opts = { limits: { 'center-city': limit } };
      const r = dcopf(REGION, gens, LOADS, opts);
      const cons = shadowPrices(REGION, gens, LOADS, opts, r);
      return { r, cons, parts: lmpComponents(REGION, ref, r.lmp[ref], cons) };
    };

    it('at 250 MW: λ = $36 at Central, μ = $118.27, PTDF 0.6395, Metro $111.64', () => {
      const m = at(250);
      expect(m.r.lmp.center).toBeCloseTo(36, 6);
      expect(m.cons).toHaveLength(1);
      expect(m.cons[0].line).toBe('center-city');
      expect(m.cons[0].mu).toBeCloseTo(118.27, 2);
      expect(m.parts.city.terms[0].ptdf).toBeCloseTo(0.6395, 4);
      expect(m.parts.city.terms[0].ptdf).toBeCloseTo(0.64, 2);
      expect(m.parts.city.total).toBeCloseTo(111.64, 2);
      // μ is the slope of Lesson 5.2's cost-of-congestion curve on each piece.
      const cost = (l: number) => dcopf(REGION, gens, LOADS, { limits: { 'center-city': l }, lmp: false }).cost;
      expect((cost(220) - cost(280)) / 60).toBeCloseTo(m.cons[0].mu, 6);
      const loose = at(300);
      expect(loose.cons[0].mu).toBeCloseTo(9.38, 2);
      expect((cost(300) - cost(400)) / 100).toBeCloseTo(loose.cons[0].mu, 6);
      expect(loose.r.lmp.city).toBeCloseTo(42, 6);
      // The rent the operator holds on the region at 250 MW.
      expect(Math.round(m.r.congestionRent)).toBe(29570);
    });

    it('the formula reproduces every node’s price across the limit slider, and the display agrees to the cent', () => {
      for (let l = 220; l <= 600; l += 10) {
        const m = at(l);
        for (const n of REGION.nodes) expect(Math.abs(m.parts[n.id].total - m.r.lmp[n.id])).toBeLessThan(0.006);
        if (l >= 430) expect(m.cons).toEqual([]);
        else expect(m.cons.map((c) => c.line)).toEqual(['center-city']);
        expect(m.r.lmp.center).toBeCloseTo(l >= 430 ? 42 : 36, 6);
      }
      // Without the limit the line carries 425 MW, so nothing binds above that.
      expect(Math.round(Math.abs(at(600).r.flows['center-city']))).toBe(425);
    });

    it('the split depends on the reference node; the totals don’t', () => {
      const a = at(250, 'center');
      for (const ref of ['north', 'city', 'west']) {
        const b = at(250, ref);
        for (const n of REGION.nodes) expect(Math.abs(b.parts[n.id].total - a.parts[n.id].total)).toBeLessThan(0.01);
        expect(b.parts.city.energy).not.toBeCloseTo(a.parts.city.energy, 1);
      }
    });
  });
});

describe('lesson 5.4: congestion rent and FTRs', () => {
  it('the rent is each line’s flow times its price difference, and the shadow price times the limit', () => {
    const r = threeNode(450, 250);
    expect(r.lmp).toEqual({ A: 20, B: 50, C: 80 });
    const lines = rentByLine(THREE_NODE, r.flows, r.lmp);
    expect(lines.map((l) => Math.round(l.rent))).toEqual([1500, 15000, 6000]);
    expect(lines.reduce((s, l) => s + l.rent, 0)).toBeCloseTo(r.congestionRent, 3);
    expect(r.congestionRent).toBeCloseTo(22500, 3);
    const mu = r.cost - threeNode(450, 251).cost;
    expect(mu).toBeCloseTo(90, 6);
    expect(mu * 250).toBeCloseTo(r.congestionRent, 3);
    // Uncongested below 375 MW.
    expect(threeNode(370, 250).congestionRent).toBeCloseTo(0, 6);
    expect(threeNode(380, 250).congestionRent).toBeGreaterThan(0);
  });

  it('above 500 MW, line A–B carries power from B to A and its share of the rent turns negative', () => {
    const ab = (d: number) => rentByLine(THREE_NODE, threeNode(d, 250).flows, threeNode(d, 250).lmp).find((l) => l.id === 'AB')!.rent;
    expect(ab(500)).toBeCloseTo(0, 6);
    expect(ab(510)).toBeLessThan(0);
    expect(ab(490)).toBeGreaterThan(0);
    expect(ab(600)).toBeCloseTo(-3000, 6);
    // Whatever A–B loses, B–C gains: the total stays at the shadow price times the limit.
    for (const d of [380, 450, 500, 550, 600]) {
      const r = threeNode(d, 250);
      const lines = rentByLine(THREE_NODE, r.flows, r.lmp);
      expect(lines.find((l) => l.id === 'AC')!.rent).toBeCloseTo(15000, 6);
      expect(lines.reduce((s, l) => s + l.rent, 0)).toBeCloseTo(22500, 3);
    }
  });

  it('rent by line adds up on the region too', () => {
    const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: 0 });
    const r = dcopf(REGION, gens, LOADS, { limits: { 'center-city': 250 } });
    const total = rentByLine(REGION, r.flows, r.lmp).reduce((s, l) => s + l.rent, 0);
    expect(total).toBeCloseTo(r.congestionRent, 0);
  });

  it('an FTR equal to the contract fully hedges the retailer', () => {
    for (const d of [100, 300, 380, 450, 600]) {
      const l = threeNode(d, 250).lmp;
      expect(hedgedCostPerMWh(25, 200, 200, l.A, l.C)).toBeCloseTo(25, 6);
    }
    const l = threeNode(450, 250).lmp;
    expect(hedgedCostPerMWh(25, 200, 0, l.A, l.C)).toBeCloseTo(85);
    expect(hedgedCostPerMWh(25, 200, 400, l.A, l.C)).toBeCloseTo(-35);
  });

  it('the challenge: a $40 retail price needs at least 150 MW of rights', () => {
    expect(RETAIL_PRICE).toBe(40);
    expect(Math.max(...hedgeCosts(0))).toBeCloseTo(85, 6);
    expect(Math.max(...hedgeCosts(150))).toBeCloseTo(40, 6);
    expect(Math.max(...hedgeCosts(140))).toBeGreaterThan(40);
    // (40 − 25) × 200 ÷ 60 = 50 MW can stay unhedged.
    expect(((40 - 25) * 200) / 60).toBe(50);
    expect(hedgeSolved(HEDGE_DEFAULTS.ftr)).toBe(false);
    for (let f = 0; f <= 400; f += FTR_STEP) expect(hedgeSolved(f)).toBe(f === 150);
    // The full hedge, 200 MW, is flat at $25.
    const full = hedgeCosts(200);
    expect(Math.max(...full) - Math.min(...full)).toBeLessThan(1e-9);
    expect(full[0]).toBeCloseTo(25, 9);
  });

  it('FTRs mirroring the dispatch are paid exactly; a derate leaves them underfunded', () => {
    const ftrs = [
      { source: 'A', sink: 'C', mw: 300 },
      { source: 'B', sink: 'C', mw: 150 },
    ];
    const r = threeNode(450, 250);
    expect(ftrFlows(THREE_NODE, ftrs).AC).toBeCloseTo(250);
    const s = settleFtrs(ftrs, r.lmp, r.congestionRent);
    expect(s.totalPayout).toBeCloseTo(22500);
    expect(s.surplus).toBeCloseTo(0, 3);
    const day = threeNode(450, 200);
    const s2 = settleFtrs(ftrs, day.lmp, day.congestionRent);
    expect(s2.totalPayout).toBeCloseTo(22500);
    expect(day.congestionRent).toBeCloseTo(18000, 3);
    expect(s2.adequate).toBe(false);
    expect(ftrFeasible(THREE_NODE, ftrs, { AC: 200 })).toBe(false);
  });

  it('simultaneously feasible FTRs are always covered by the rent (revenue adequacy)', () => {
    const rand = rng(51);
    for (let k = 0; k < 40; k++) {
      const demand = 380 + rand() * 220;
      const limit = 200 + rand() * 150;
      const r = threeNode(demand, limit);
      const plane = ftrPlane(THREE_NODE, { source: 'A', sink: 'C' }, { source: 'B', sink: 'C' }, { AC: limit });
      const x = rand() * 500;
      const y = rand() * 500;
      const ftrs = [
        { source: 'A', sink: 'C', mw: x },
        { source: 'B', sink: 'C', mw: y },
      ];
      const ok = satisfies([x, y], plane);
      expect(ok).toBe(ftrFeasible(THREE_NODE, ftrs, { AC: limit }));
      if (ok) expect(settleFtrs(ftrs, r.lmp, r.congestionRent).adequate).toBe(true);
    }
  });

  it('the rent figure never needs load shedding across its sliders', () => {
    for (let d = 100; d <= 600; d += 10)
      for (let l = 210; l <= 500; l += 10) {
        const r = threeNode(d, l);
        expect(r.feasible).toBe(true);
        for (const n of ['A', 'B', 'C']) expect(r.lmp[n]).toBeLessThan(100);
      }
  });

  it('the adequacy figure has finite prices across its day-limit slider', () => {
    for (let l = 160; l <= 350; l += 10) {
      const r = threeNode(450, l);
      expect(r.feasible).toBe(true);
      for (const n of ['A', 'B', 'C']) expect(Number.isFinite(r.lmp[n])).toBe(true);
      expect(r.lmp.C).toBeLessThan(100);
    }
  });
});

describe('lesson 5.5: scarcity in a load pocket', () => {
  // Noon, Central–Metro out, Metro's demand on the slider (600–1,050 MW), everything else as usual.
  const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[12], solarCF: SOLAR_CF[12] });
  const loads = nodalLoads(SYSTEM_DEMAND[12], REGION_LOAD_SHARE);
  const pocket = (metro: number, out = true, temp = '') =>
    dcopf(REGION, temp ? [...gens, { id: 'temp', node: temp, capacity: 100, offer: 300 }] : gens, { ...loads, city: metro }, { outages: out ? ['center-city'] : [], voll: 5000 });
  const others = (r: ReturnType<typeof pocket>) => REGION.nodes.filter((n) => n.id !== 'city').map((n) => r.lmp[n.id]);
  const limit = (id: string) => REGION.lines.find((l) => l.id === id)!.limit;

  it('the setting: Valley solar at 340 MW, 650 MW of import lines left, 330 MW of plants in Metro', () => {
    expect(gens.find((g) => g.id === 'solar')!.capacity).toBeCloseTo(340, 6);
    expect(limit('east-city') + limit('west-city')).toBe(650);
    expect(fleetById('cc2').capacity).toBe(250);
    expect(fleetById('oil').capacity).toBe(80);
    expect(limit('east-city') + limit('west-city') + 250 + 80).toBe(980);
    expect(REGION_LOAD_SHARE.city).toBeGreaterThan(0.5);
  });

  it('Metro’s price climbs $28 → $42 → $165 → $5,000 while the rest of the region stays below $64', () => {
    const start = pocket(640);
    expect(start.binding).toEqual([]);
    for (const n of REGION.nodes) expect(start.lmp[n.id]).toBeCloseTo(28, 6);
    const west = pocket(650);
    expect(west.binding).toEqual(['west-city']);
    expect(west.lmp.city).toBeCloseTo(42, 6);
    expect(Math.min(...others(west))).toBeCloseTo(28, 6);
    expect(Math.max(...others(west))).toBeCloseTo(38.34, 2);
    expect(pocket(890).lmp.city).toBeCloseTo(42, 6);
    const cut = pocket(900);
    expect(cut.binding.sort()).toEqual(['east-city', 'west-city']);
    expect(cut.dispatch.cc2).toBeCloseTo(250, 6);
    expect(cut.lmp.city).toBeCloseTo(165, 6);
    expect(pocket(970).lmp.city).toBeCloseTo(165, 6);
    expect(pocket(970).shed.city ?? 0).toBeCloseTo(0, 6);
    const edge = pocket(980);
    expect(edge.lmp.city).toBeCloseTo(5000, 6);
    expect(edge.shed.city ?? 0).toBeCloseTo(0, 6);
    const shed = pocket(1000);
    expect(shed.lmp.city).toBeCloseTo(5000, 6);
    expect(shed.shed.city).toBeCloseTo(20, 6);
    expect(Math.max(...others(shed))).toBeCloseTo(63.95, 2);
    expect(Math.min(...others(shed))).toBeCloseTo(28, 6);
    for (const n of REGION.nodes) if (n.id !== 'city') expect(shed.shed[n.id] ?? 0).toBeCloseTo(0, 6);
    // Across the whole slider, nothing outside Metro goes above $64 or below zero.
    for (let m = 600; m <= 1050; m += 10) {
      const r = pocket(m);
      expect(Math.max(...others(r))).toBeLessThan(64);
      expect(Math.min(...others(r))).toBeGreaterThan(0);
    }
  });

  it('with Central–Metro back in service, the same demand costs $36 everywhere', () => {
    const r = pocket(1000, false);
    for (const n of REGION.nodes) expect(r.lmp[n.id]).toBeCloseTo(36, 6);
    for (let m = 600; m <= 1050; m += 10) expect(pocket(m, false).binding).toEqual([]);
  });

  it('the challenge: temporary generators help only inside Metro', () => {
    for (const n of ['north', 'east', 'center', 'harbor', 'west']) {
      const r = pocket(1000, true, n);
      expect(r.shed.city).toBeCloseTo(20, 6);
      expect(r.lmp.city).toBeCloseTo(5000, 6);
    }
    for (const m of [1000, 1050]) {
      const r = pocket(m, true, 'city');
      expect(r.shed.city ?? 0).toBeCloseTo(0, 6);
      expect(r.lmp.city).toBeCloseTo(300, 6);
    }
    expect(pocket(1000, true, 'city').dispatch.temp).toBeCloseTo(20, 6);
    // The lesson's predicate: unsolved at the start, solved only with the generators in Metro.
    expect(pocketSolved(POCKET_DEFAULTS)).toBe(false);
    expect(pocketSolved({ metro: 1000, out: true, temp: 'city' })).toBe(true);
    expect(pocketSolved({ metro: 1000, out: true, temp: 'north' })).toBe(false);
    expect(pocketSolved({ metro: 1000, out: false, temp: 'city' })).toBe(false);
    // Every setting is feasible with finite prices.
    for (const out of [true, false])
      for (const temp of ['', 'north', 'city'])
        for (const m of [600, 1050]) {
          const r = pocket(m, out, temp);
          expect(r.feasible).toBe(true);
          for (const v of Object.values(r.lmp)) expect(Number.isFinite(v)).toBe(true);
        }
  });
});

describe('scarcity engine: energy and reserves co-optimized (the value of lost load in Lesson 5.5)', () => {
  const units = (out: string[] = []) => reserveUnitsFromFleet(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: SOLAR_CF[19], out });

  it('reserve shortage and load shedding set the price', () => {
    expect(scarcityClear(units(), 1440, 400, 1000, 5000).energyPrice).toBeCloseTo(42);
    expect(scarcityClear(units(), 1500, 400, 1000, 5000).energyPrice).toBeCloseTo(42);
    const short = scarcityClear(units(), 1560, 400, 1000, 5000);
    expect(short.energyPrice).toBeCloseTo(1042);
    expect(short.reserveShort).toBeCloseTo(40);
    const shed = scarcityClear(units(), 2000, 400, 1000, 5000);
    expect(shed.energyPrice).toBeCloseTo(5000);
    expect(shed.shed).toBeCloseTo(80);
    expect(scarcityClear(units(['cc1']), 1440, 400, 1000, 5000).energyPrice).toBeCloseTo(1165);
    // All plants: 1,920 MW with Ridge wind at 140.
    expect(units().reduce((s, u) => s + u.capacity, 0)).toBeCloseTo(1920);
  });

  it('400 MW of reserve covers the two largest plants running at the peak, Harbor Point and Lakeside', () => {
    const big = Math.max(...units().map((u) => u.capacity));
    expect(big).toBe(400);
    expect(units().filter((u) => u.capacity === big).map((u) => u.id).sort()).toEqual(['cc1', 'nuc']);
  });

  it('the value of lost load has to exceed the shortage price plus a plant’s cost', () => {
    // With Lesson 2.6’s $1,000, the optimizer would rather cut customers off than run short of reserve.
    const cheap = scarcityClear(units(), 1560, 400, 1000, 1000);
    expect(cheap.shed).toBeGreaterThan(1);
    expect(cheap.reserveShort).toBeCloseTo(0, 6);
    // At $5,000 it never does, even at the slider’s top shortage price of $3,000 or with Lakeside out.
    for (const out of [[], ['cc1']])
      for (const S of [300, 1000, 3000]) {
        const total = units(out).reduce((s, u) => s + u.capacity, 0);
        expect(scarcityClear(units(out), total - 10, 400, S, 5000).shed).toBeCloseTo(0, 6);
      }
    expect(Math.max(...STANDARD_FLEET.map((g) => g.marginalCost)) + 3000).toBeLessThan(5000);
  });

  it('the step curve matches the solver everywhere', () => {
    for (const out of [[], ['cc1']]) {
      for (const S of [300, 1000, 3000]) {
        const segs = scarcityCurve(units(out), 400, S, 5000, 1000, 2100);
        for (let d = 1005; d < 2100; d += 10) {
          const seg = segs.find((g) => d > g.from && d < g.to)!;
          expect(seg.price).toBeCloseTo(scarcityClear(units(out), d, 400, S, 5000).energyPrice, 6);
        }
      }
    }
    const segs = scarcityCurve(units(), 400, 1000, 5000, 1000, 2100);
    expect(segs.find((g) => g.regime === 'shortage')!.from).toBeCloseTo(1520);
    expect(segs.find((g) => g.regime === 'shed')!.from).toBeCloseTo(1920);
  });

});

describe('lesson 5.5: negative prices', () => {
  const night = (st: { demand: number; wind: number; offer?: number; floors?: boolean; out?: string }) =>
    dcopf(
      REGION,
      fleetOffers(STANDARD_FLEET, { windCF: st.wind / 350, solarCF: SOLAR_CF[3], mustRun: st.floors ?? true, offers: { wind: st.offer ?? -25 } }),
      nodalLoads(st.demand, REGION_LOAD_SHARE),
      { outages: st.out ? [st.out] : [] },
    );

  it('prices fall from hydro to nuclear to curtailed wind as the wind rises', () => {
    expect(night({ demand: 750, wind: 175 }).lmp.city).toBeCloseTo(20);
    expect(night({ demand: 750, wind: 250 }).lmp.city).toBeCloseTo(9);
    const windy = night({ demand: 750, wind: 350 });
    expect(windy.lmp.city).toBeCloseTo(-25);
    expect(windy.dispatch.wind).toBeCloseTo(270);
    expect(windy.dispatch.nuc).toBeCloseTo(360);
    const loose = night({ demand: 750, wind: 350, floors: false });
    expect(loose.lmp.city).toBeCloseTo(20);
    expect(loose.dispatch.coal).toBeCloseTo(0);
    expect(loose.dispatch.wind).toBeCloseTo(350);
    // Harbor Point is full, so the next megawatt comes from Falls hydro.
    expect(loose.dispatch.nuc).toBeCloseTo(400);
    expect(loose.dispatch.hydro).toBeCloseTo(0);
    // With every line in service, prices are uniform.
    for (const d of [600, 750, 900, 1100]) for (const w of [0, 175, 350]) {
      const r = night({ demand: d, wind: w });
      const p = Object.values(r.lmp);
      expect(Math.max(...p) - Math.min(...p)).toBeLessThan(0.01);
    }
  });

  it('the challenge hint: North–Central out, wind near 350 MW, demand about 830–990 MW', () => {
    const mixed = (st: { demand: number; wind: number; out: string }) => {
      const p = Object.values(night(st).lmp);
      return Math.min(...p) < -0.005 && Math.max(...p) > 0.005;
    };
    for (const d of [830, 900, 990]) expect(mixed({ demand: d, wind: 350, out: 'north-center' })).toBe(true);
    expect(mixed({ demand: 830, wind: 345, out: 'north-center' })).toBe(true);
    for (const d of [820, 1000]) expect(mixed({ demand: d, wind: 350, out: 'north-center' })).toBe(false);
    for (let d = 600; d <= 1100; d += 10) {
      expect(mixed({ demand: d, wind: 340, out: 'north-center' })).toBe(false);
      expect(mixed({ demand: d, wind: 350, out: 'north-east' })).toBe(false);
    }
  });

  it('the negative/positive challenge: unsolved at the start, and the hint’s reasoning finds it', () => {
    expect(mixedSolved(NIGHT_DEFAULTS)).toBe(false);
    // North–Central out and the wind at full: still uniform at the starting demand, mixed once the rest of the region needs fuel.
    expect(mixedSolved({ ...NIGHT_DEFAULTS, out: 'north-center', wind: 350 })).toBe(false);
    expect(mixedSolved({ ...NIGHT_DEFAULTS, out: 'north-center', wind: 350, demand: 900 })).toBe(true);
    // With every line in, no demand or wind does it.
    for (let d = 600; d <= 1100; d += 50) for (const w of [0, 175, 350]) expect(mixedSolved({ ...NIGHT_DEFAULTS, demand: d, wind: w })).toBe(false);
  });

  it('the negative/positive challenge is reachable, and every setting is feasible', () => {
    const r = night({ demand: 900, wind: 350, out: 'north-center' });
    expect(r.lmp.north).toBeCloseTo(-25);
    expect(r.lmp.city).toBeGreaterThan(0);
    for (const out of ['', ...LINES])
      for (const d of [600, 1100])
        for (const w of [0, 350])
          for (const floors of [true, false])
            for (const offer of [-40, 0]) {
              const x = night({ demand: d, wind: w, offer, floors, out });
              expect(x.feasible).toBe(true);
              for (const v of Object.values(x.lmp)) expect(Number.isFinite(v)).toBe(true);
            }
  });
});

describe('lesson 5.6: security-constrained dispatch', () => {
  const gens = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[19], solarCF: SOLAR_CF[19] });
  const base = dcopf(REGION, gens, LOADS);
  const secure = (cs: string[], k: number, lmp = false) => dcopf(REGION, gens, LOADS, { contingencies: cs, emergencyRating: k, lmp });

  it('the cheapest dispatch fails four single outages', () => {
    const scan = contingencyScan(REGION, gens, base.dispatch, LOADS, LINES);
    const failing = scan.filter((c) => c.overloads.length).map((c) => c.outage);
    expect(failing.sort()).toEqual(['center-city', 'harbor-center', 'north-east', 'west-city']);
    const cc = scan.find((c) => c.outage === 'center-city')!;
    expect(Math.round(Math.abs(cc.flows['west-city']))).toBe(515);
    expect(Math.round(Math.abs(cc.flows['north-east']))).toBe(371);
    expect(Math.round(cc.worst!.loading * 100)).toBe(172);
    for (const c of scan.filter((x) => x.outage !== 'center-city' && x.overloads.length)) expect(c.worst!.loading).toBeLessThan(1.07);
  });

  it('security costs $11,395 an hour, almost all of it for Central–Metro', () => {
    const all = secure(LINES, 1, true);
    expect(Math.round(all.cost - base.cost)).toBe(11395);
    expect(Math.round(((all.cost - base.cost) / base.cost) * 100)).toBe(36);
    expect(all.dispatch.coal).toBeCloseTo(120);
    expect(all.dispatch.cc2).toBeCloseTo(250);
    expect(all.dispatch.ct).toBeGreaterThan(100);
    expect(all.bindingContingencies).toEqual([{ outage: 'center-city', line: 'west-city' }]);
    const alone = Object.fromEntries(LINES.map((id) => [id, secure([id], 1).cost - base.cost]));
    expect(LINES.filter((id) => alone[id] < 0.5).length).toBe(4);
    for (const id of ['north-east', 'harbor-center', 'west-city']) {
      expect(alone[id]).toBeGreaterThan(100);
      expect(alone[id]).toBeLessThan(400);
    }
    // Prices in the secure dispatch: lowest at West, highest in Metro.
    const lmp = all.lmp;
    expect(Math.min(...Object.values(lmp))).toBe(lmp.west);
    expect(Math.max(...Object.values(lmp))).toBe(lmp.city);
    expect(all.binding).toEqual([]);
  });

  it('prices separate with every actual flow below its limit: one contingency constraint does it', () => {
    const opts = { contingencies: LINES, emergencyRating: 1 };
    const r = dcopf(REGION, gens, LOADS, opts);
    expect(r.binding).toEqual([]);
    for (const l of REGION.lines) expect(Math.abs(r.flows[l.id])).toBeLessThan(l.limit * 0.999);
    // The busiest line before anything trips.
    const loading = REGION.lines.map((l) => ({ id: l.id, x: Math.abs(r.flows[l.id]) / l.limit })).sort((a, b) => b.x - a.x)[0];
    // West–Metro, the very line the binding constraint watches: 142 MW now, its full 300 MW if Central–Metro trips.
    expect(loading.id).toBe('west-city');
    expect(Math.round(loading.x * 100)).toBe(47);
    expect(Math.round(Math.abs(r.flows['west-city']))).toBe(142);
    const post = checkDispatch(REGION, gens, r.dispatch, LOADS, { outages: ['center-city'] });
    expect(Math.abs(post.flows['west-city'])).toBeCloseTo(300, 3);
    expect(r.lmp.west).toBeCloseTo(21.12, 2);
    expect(r.lmp.city).toBeCloseTo(111.64, 2);
    expect(r.lmp.center).toBeCloseTo(36, 6);
    expect(r.lmp.city - r.lmp.west).toBeGreaterThan(90);
    const cons = shadowPrices(REGION, gens, LOADS, opts, r);
    expect(cons).toHaveLength(1);
    expect(cons[0]).toMatchObject({ line: 'west-city', outage: 'center-city', direction: 1, shared: false });
    expect(cons[0].mu).toBeCloseTo(123.61, 2);
    const parts = lmpComponents(REGION, 'center', r.lmp.center, cons);
    expect(parts.city.terms[0].ptdf).toBeCloseTo(0.6119, 4);
    expect(parts.west.terms[0].ptdf).toBeCloseTo(-0.12, 2);
    expect(parts.west.terms[0].ptdf).toBeLessThan(0);
    // The post-outage PTDF, not the base-case one.
    expect(parts.city.terms[0].ptdf).toBeCloseTo(transferPtdf(REGION, 'west-city', 'center', 'city', ['center-city']), 9);
    expect(parts.city.terms[0].ptdf).not.toBeCloseTo(transferPtdf(REGION, 'west-city', 'center', 'city'), 2);
    for (const n of REGION.nodes) expect(Math.abs(parts[n.id].total - r.lmp[n.id])).toBeLessThan(0.006);
  });

  it('the formula holds for any set of contingencies and any emergency rating', () => {
    const sets = [[], LINES, ...LINES.map((id) => [id]), ...LINES.map((id) => LINES.filter((x) => x !== id))];
    for (const k of [1, 1.1, 1.25])
      for (const cs of sets) {
        const opts = { contingencies: cs, emergencyRating: k };
        const r = dcopf(REGION, gens, LOADS, opts);
        const cons = shadowPrices(REGION, gens, LOADS, opts, r);
        expect(cons.some((c) => c.shared)).toBe(false);
        const parts = lmpComponents(REGION, 'center', r.lmp.center, cons);
        for (const n of REGION.nodes) expect(Math.abs(parts[n.id].total - r.lmp[n.id])).toBeLessThan(0.006);
      }
  });

  it('prices hold still up to a 120% rating; at 125% Eastgate drops out and the shadow price falls', () => {
    for (const k of [1, 1.05, 1.1, 1.15, 1.2]) {
      const opts = { contingencies: LINES, emergencyRating: k };
      const r = dcopf(REGION, gens, LOADS, opts);
      expect(r.lmp.city).toBeCloseTo(111.64, 2);
      expect(shadowPrices(REGION, gens, LOADS, opts, r)[0].mu).toBeCloseTo(123.61, 2);
    }
    const opts = { contingencies: LINES, emergencyRating: 1.25 };
    const r = dcopf(REGION, gens, LOADS, opts);
    const cons = shadowPrices(REGION, gens, LOADS, opts, r);
    expect(cons.map((c) => `${c.outage}>${c.line}`)).toEqual(['center-city>west-city']);
    expect(cons[0].mu).toBeCloseTo(66.45, 2);
    expect(r.lmp.city).toBeCloseTo(76.66, 2);
    expect(r.dispatch.ct).toBeCloseTo(0, 6);
    expect(secure(LINES, 1.2).dispatch.ct).toBeGreaterThan(1);
  });

  it('emergency ratings cut the cost of security', () => {
    const c = [1, 1.1, 1.2, 1.3].map((k) => secure(LINES, k).cost - base.cost);
    expect(c.map(Math.round)).toEqual([11395, 7686, 3978, 1366]);
    for (let k = 100; k <= 130; k += 5) {
      const r = secure(LINES, k / 100, true);
      expect(r.feasible).toBe(true);
      for (const v of Object.values(r.lmp)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('the hand-dispatch puzzle starts unsolved; Mill Creek flat out, Eastgate on and Ironwood at its floor solve it', () => {
    expect(puzzleSolved(PUZZLE_DEFAULTS)).toBe(false);
    expect(puzzleSolved({ coal: 120, cc2: 250, ct: 100 })).toBe(true);
    // Without Eastgate, no hand dispatch is secure.
    for (let coal = 120; coal <= 300; coal += 20) for (let cc2 = 0; cc2 <= 250; cc2 += 25) expect(puzzleSolved({ coal, cc2, ct: 0 })).toBe(false);
  });

  it('the hand-dispatch puzzle is reachable on 5 MW steps', () => {
    const opt = secure(LINES, 1.1);
    let count = 0;
    for (let coal = 120; coal <= 300; coal += 5)
      for (let cc2 = 0; cc2 <= 250; cc2 += 5)
        for (let ct = 0; ct <= 200; ct += 5) {
          const d: Record<string, number> = { nuc: 400, wind: 140, solar: 0, hydro: 150, oil: 0, coal, cc2, ct };
          d.cc1 = PEAK - Object.values(d).reduce((s, v) => s + v, 0);
          if (d.cc1 < 0 || d.cc1 > 400) continue;
          const cost = gens.reduce((s, g) => s + g.offer * (d[g.id] ?? 0), 0);
          if (cost > opt.cost * 1.01) continue;
          const b = checkDispatch(REGION, gens, d, LOADS);
          if (b.overloads.length) continue;
          const scan = contingencyScan(REGION, gens, d, LOADS, LINES, { emergencyRating: 1.1 });
          if (scan.some((c) => c.overloads.length)) continue;
          count++;
        }
    expect(count).toBeGreaterThan(5);
  }, 30_000);

  it('a tripped line’s flows equal a power flow with it removed', () => {
    const inj: Record<string, number> = {};
    for (const n of REGION.nodes) inj[n.id] = -LOADS[n.id];
    for (const g of gens) inj[g.node] += base.dispatch[g.id];
    const pf = dcPowerFlow(REGION, inj, ['center-city']).flows;
    const c = checkDispatch(REGION, gens, base.dispatch, LOADS, { outages: ['center-city'] });
    for (const l of LINES) expect(c.flows[l]).toBeCloseTo(pf[l], 6);
  });
});
