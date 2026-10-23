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
import { computePtdf, dcPowerFlow } from '../src/engines/physics/powerflow';
import { STANDARD_FLEET } from '../src/model/fleet';
import { REGION, REGION_LOAD_SHARE, THREE_NODE } from '../src/model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { rng } from '../src/model/random';

const PEAK = SYSTEM_DEMAND[19];
const LOADS = nodalLoads(PEAK, REGION_LOAD_SHARE);
const LINES = REGION.lines.map((l) => l.id);

function threeNode(demand: number, limit: number) {
  return dcopf(
    THREE_NODE,
    [
      { id: 'gA', node: 'A', capacity: 500, offer: 20 },
      { id: 'gB', node: 'B', capacity: 600, offer: 50 },
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

  it('the slice’s polygon is bounded by Central–Metro, West–Metro and Lakeside at zero', () => {
    const plane = dispatchPlane(REGION, gens, LOADS, opt.dispatch, 'coal', 'cc2', 'cc1', { outages: OUT });
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
    // The merit order sits just outside.
    expect(satisfies([300, 0], plane.constraints)).toBe(false);
  });

  it('only the labeled constraints can be violated anywhere in the slice', () => {
    const plane = dispatchPlane(REGION, gens, LOADS, opt.dispatch, 'coal', 'cc2', 'cc1', { outages: OUT });
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
    expect(1 / (p.center - p.city)).toBeCloseTo(1.56, 2);
    expect(1 / (p.center - p.east)).toBeCloseTo(2.27, 2);
    expect((at(300).cost - at(400).cost) / 100).toBeCloseTo(9.38, 2);
    expect(Math.round((at(220).cost - at(280).cost) / 60)).toBe(118);
    // Mill Creek fills between 300 and 295 MW.
    expect(at(300).dispatch.cc2).toBeLessThan(250);
    expect(at(295).dispatch.cc2).toBeCloseTo(250);
  });

  it('the challenge answer is 320 MW', () => {
    const costs: Array<[number, number]> = [];
    for (let l = 220; l <= 600; l += 10) costs.push([l, at(l).cost - base.cost]);
    const answer = Math.min(...costs.filter(([, c]) => c <= 1000).map(([l]) => l));
    expect(answer).toBe(320);
    expect(Math.round(at(320).cost - base.cost)).toBe(986);
    expect(Math.round(at(310).cost - base.cost)).toBe(1080);
  });

  it('marginal costs: $42 everywhere uncongested; $36 to $112 at 250 MW', () => {
    for (const n of REGION.nodes) expect(at(600).lmp[n.id]).toBeCloseTo(42);
    const r = at(250);
    expect(r.lmp.center).toBeCloseTo(36);
    expect(r.lmp.east).toBeCloseTo(88);
    expect(Math.round(r.lmp.city)).toBe(112);
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
    for (let l = 220; l <= 600; l += 10) {
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

describe('lesson 5.5: scarcity and negative prices', () => {
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
    // With every line in service, prices are uniform.
    for (const d of [600, 750, 900, 1100]) for (const w of [0, 175, 350]) {
      const r = night({ demand: d, wind: w });
      const p = Object.values(r.lmp);
      expect(Math.max(...p) - Math.min(...p)).toBeLessThan(0.01);
    }
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

  it('emergency ratings cut the cost of security', () => {
    const c = [1, 1.1, 1.2, 1.3].map((k) => secure(LINES, k).cost - base.cost);
    expect(c.map(Math.round)).toEqual([11395, 7686, 3978, 1366]);
    for (let k = 100; k <= 130; k += 5) {
      const r = secure(LINES, k / 100, true);
      expect(r.feasible).toBe(true);
      for (const v of Object.values(r.lmp)) expect(Number.isFinite(v)).toBe(true);
    }
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
  });

  it('a tripped line’s flows equal a power flow with it removed', () => {
    const inj: Record<string, number> = {};
    for (const n of REGION.nodes) inj[n.id] = -LOADS[n.id];
    for (const g of gens) inj[g.node] += base.dispatch[g.id];
    const pf = dcPowerFlow(REGION, inj, ['center-city']).flows;
    const c = checkDispatch(REGION, gens, base.dispatch, LOADS, { outages: ['center-city'] });
    for (const l of LINES) expect(c.flows[l]).toBeCloseTo(pf[l], 6);
  });
});
