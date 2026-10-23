import { describe, expect, it } from 'vitest';
import { parallelCircuit, seriesCircuit } from '../src/engines/physics/circuits';
import { phasorSumMagnitude } from '../src/engines/physics/ac';
import { generatorEmf, transformer } from '../src/engines/physics/machines';
import { lineLoss } from '../src/engines/physics/losses';
import { computePtdf, dcPowerFlow, findIslands } from '../src/engines/physics/powerflow';
import { solveLP } from '../src/engines/market/lp';
import { dcopf } from '../src/engines/market/opf';
import { clearMeritOrder, clearTwoSided } from '../src/engines/market/clearing';
import { capacityAuction, coOptimize } from '../src/engines/market/ancillary';
import { dispatchDay, unitsFromFleet } from '../src/engines/ops/dispatch';
import { DEFAULT_FREQUENCY, simulateTrip } from '../src/engines/ops/frequency';
import { runBattery } from '../src/engines/ops/storage';
import { optimizeArbitrage } from '../src/engines/strategy/arbitrage';
import { maxDrawdown, walkForward } from '../src/engines/strategy/risk';
import { REGION, REGION_LOAD_SHARE, THREE_NODE } from '../src/model/networks';
import { STANDARD_FLEET } from '../src/model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { marketHistory } from '../src/model/history';

describe('physics', () => {
  it('series lamps share voltage; parallel lamps share current', () => {
    const s = seriesCircuit(12, [6, 6]);
    expect(s.totalAmps).toBeCloseTo(1);
    expect(s.branches[0].watts).toBeCloseTo(6);
    const p = parallelCircuit(12, [6, 6]);
    expect(p.totalAmps).toBeCloseTo(4);
    expect(p.branches[0].watts).toBeCloseTo(24);
  });

  it('balanced three phases cancel', () => {
    const r = (d: number) => (d * Math.PI) / 180;
    expect(phasorSumMagnitude([0, r(-120), r(-240)])).toBeCloseTo(0, 9);
    expect(phasorSumMagnitude([0, r(-90), r(-180)])).toBeCloseTo(1, 9);
  });

  it('generator emf and frequency', () => {
    const g = generatorEmf({ turns: 100, fieldTesla: 0.5, areaM2: 0.02, rpm: 3600 });
    expect(g.freqHz).toBe(60);
    expect(g.peakVolts).toBeCloseTo(100 * 0.5 * 0.02 * 2 * Math.PI * 60);
  });

  it('ideal transformer conserves power', () => {
    const t = transformer({ primaryVolts: 240, primaryTurns: 100, secondaryTurns: 50, loadOhms: 12 });
    expect(t.secondaryVolts).toBeCloseTo(120);
    expect(t.secondaryAmps).toBeCloseTo(10);
    expect(t.primaryAmps).toBeCloseTo(5);
    expect(t.efficiency).toBeCloseTo(1);
  });

  it('doubling voltage quarters line loss', () => {
    const a = lineLoss({ sendMW: 100, kV: 115, lengthKm: 100, ohmPerKm: 0.05 });
    const b = lineLoss({ sendMW: 100, kV: 230, lengthKm: 100, ohmPerKm: 0.05 });
    expect(a.lossMW / b.lossMW).toBeCloseTo(4);
  });

  it('three-node PTDFs split 2/3 direct, 1/3 around', () => {
    const { ptdf } = computePtdf(THREE_NODE);
    // Slack is A. Injecting at C withdraws at A: 2/3 flows C→A directly.
    expect(ptdf.AC.C).toBeCloseTo(-2 / 3);
    const f = dcPowerFlow(THREE_NODE, { A: 300, B: 0, C: -300 });
    expect(f.flows.AC).toBeCloseTo(200);
    expect(f.flows.AB).toBeCloseTo(100);
    expect(f.flows.BC).toBeCloseTo(100);
  });

  it('detects islands', () => {
    expect(findIslands(THREE_NODE, ['AC', 'BC'])).toEqual([['A', 'B'], ['C']]);
  });
});

describe('optimization', () => {
  it('solves a small LP', () => {
    // max 3x + 2y s.t. x + y ≤ 4, x + 3y ≤ 6, x ≤ 3 → x=3, y=1, obj 11
    const s = solveLP({ c: [-3, -2], A: [[1, 1], [1, 3]], b: [4, 6], sense: ['<=', '<='], ub: [3, Infinity] });
    expect(s.status).toBe('optimal');
    expect(s.x[0]).toBeCloseTo(3);
    expect(s.x[1]).toBeCloseTo(1);
    expect(-s.objective).toBeCloseTo(11);
  });

  it('handles equality and ≥ constraints and detects infeasibility', () => {
    const s = solveLP({ c: [1, 2], A: [[1, 1], [1, 0]], b: [10, 3], sense: ['=', '>='] });
    expect(s.x[0]).toBeCloseTo(10);
    const bad = solveLP({ c: [1], A: [[1], [1]], b: [5, 3], sense: ['>=', '<='] });
    expect(bad.status).toBe('infeasible');
  });

  it('reproduces the three-node LMP example', () => {
    const gens = [
      { id: 'gA', node: 'A', capacity: 500, offer: 20 },
      { id: 'gB', node: 'B', capacity: 600, offer: 50 },
    ];
    const low = dcopf(THREE_NODE, gens, { C: 300 });
    expect(low.dispatch.gA).toBeCloseTo(300);
    expect(low.lmp.C).toBeCloseTo(20);
    const high = dcopf(THREE_NODE, gens, { C: 450 });
    expect(high.dispatch.gA).toBeCloseTo(300);
    expect(high.dispatch.gB).toBeCloseTo(150);
    expect(high.lmp.A).toBeCloseTo(20);
    expect(high.lmp.B).toBeCloseTo(50);
    expect(high.lmp.C).toBeCloseTo(80);
    expect(high.congestionRent).toBeCloseTo(22500, 0);
    expect(high.binding).toEqual(['AC']);
  });

  it('dispatches the region and respects N-1 security', () => {
    const gens = STANDARD_FLEET.filter((g) => g.fuel !== 'wind' && g.fuel !== 'solar').map((g) => ({ id: g.id, node: g.node!, capacity: g.capacity, offer: g.marginalCost }));
    const loads = Object.fromEntries(Object.entries(REGION_LOAD_SHARE).map(([n, s]) => [n, s * 1300]));
    const base = dcopf(REGION, gens, loads);
    expect(base.feasible).toBe(true);
    const total = Object.values(base.dispatch).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1300, 3);
    for (const l of REGION.lines) expect(Math.abs(base.flows[l.id])).toBeLessThanOrEqual(l.limit + 1e-6);
    const secure = dcopf(REGION, gens, loads, { contingencies: REGION.lines.map((l) => l.id), lmp: false });
    expect(secure.cost).toBeGreaterThanOrEqual(base.cost - 1e-6);
  });
});

describe('markets', () => {
  it('clears the merit order at the marginal offer', () => {
    const c = clearMeritOrder(
      [
        { id: 'a', mw: 100, price: 10 },
        { id: 'b', mw: 100, price: 30 },
        { id: 'c', mw: 100, price: 60 },
      ],
      150,
    );
    expect(c.price).toBe(30);
    expect(c.marginal).toBe('b');
    expect(c.dispatch.b).toBe(50);
  });

  it('clears two-sided auctions', () => {
    const r = clearTwoSided(
      [
        { id: 's1', mw: 100, price: 10 },
        { id: 's2', mw: 100, price: 40 },
      ],
      [
        { id: 'd1', mw: 120, price: 80 },
        { id: 'd2', mw: 100, price: 20 },
      ],
    );
    expect(r.quantity).toBeCloseTo(120);
    expect(r.price).toBe(40);
  });

  it('prices reserve at the opportunity cost', () => {
    const r = coOptimize(
      [
        { id: 'cheap', capacity: 100, energyCost: 20, reserveMax: 50, reserveCost: 0 },
        { id: 'dear', capacity: 100, energyCost: 50, reserveMax: 0, reserveCost: 0 },
      ],
      120,
      30,
    );
    // Cheap unit holds 30 MW of reserve, so dear unit must produce 50 MW: energy price 50,
    // reserve price = 50 − 20 = 30 (the margin the cheap unit gave up).
    expect(r.energyPrice).toBeCloseTo(50);
    expect(r.reservePrice).toBeCloseTo(30);
  });

  it('clears a capacity auction', () => {
    const r = capacityAuction(
      [
        { id: 'a', mw: 800, price: 20 },
        { id: 'b', mw: 300, price: 150 },
      ],
      { target: 1000, priceCap: 500, priceAtTarget: 200 },
    );
    expect(r.cleared).toBeGreaterThan(800);
    expect(r.price).toBeGreaterThanOrEqual(150);
  });
});

describe('operations', () => {
  it('dispatches the reference day', () => {
    const units = unitsFromFleet(STANDARD_FLEET, { wind: WIND_CF, solar: SOLAR_CF });
    const day = dispatchDay(units, SYSTEM_DEMAND);
    for (let h = 0; h < 24; h++) {
      const total = Object.values(day[h].output).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(SYSTEM_DEMAND[h], 3);
      expect(day[h].shortfall).toBe(0);
    }
    // Evening peak needs gas.
    expect(day[19].price).toBeGreaterThanOrEqual(36);
  });

  it('frequency falls faster with less inertia and recovers with governors', () => {
    const hi = simulateTrip({ ...DEFAULT_FREQUENCY, inertiaH: 6 }, 300, 20);
    const lo = simulateTrip({ ...DEFAULT_FREQUENCY, inertiaH: 2 }, 300, 20);
    expect(Math.abs(lo.rocof)).toBeGreaterThan(Math.abs(hi.rocof));
    expect(lo.nadir).toBeLessThan(hi.nadir);
    expect(hi.nadir).toBeLessThan(60);
    expect(hi.settled).toBeGreaterThan(hi.nadir);
  });

  it('battery respects energy and efficiency', () => {
    const r = runBattery({ id: 'b', powerMW: 10, energyMWh: 20, efficiency: 0.81, soc0: 0 }, [-10, -10, -10, 10, 10, 10]);
    expect(r.soc[2]).toBeCloseTo(18); // 20 MWh drawn × 0.9
    expect(r.soc[3]).toBeCloseTo(20); // full
    const out = r.mw.slice(3).reduce((s, v) => s + v, 0);
    expect(out).toBeCloseTo(18); // 20 MWh stored × 0.9
  });
});

describe('strategy', () => {
  it('charges low and discharges high', () => {
    const prices = [20, 20, 20, 20, 100, 100, 100, 100];
    const r = optimizeArbitrage(prices, { powerMW: 1, energyMWh: 2, efficiency: 0.81, soc0: 0 });
    expect(r.schedule.slice(0, 4).every((x) => x <= 0)).toBe(true);
    expect(r.schedule.slice(4).every((x) => x >= 0)).toBe(true);
    expect(r.profit).toBeGreaterThan(0);
  });

  it('measures drawdown and walks forward without peeking', () => {
    expect(maxDrawdown([10, -5, -10, 20]).drawdown).toBe(15);
    const wf = walkForward({ data: [1, 2, 3, 4, 5], window: 2, decide: (h) => [h[h.length - 1]], settle: (p, d) => p[0] * d });
    expect(wf.pnl).toEqual([2 * 3, 3 * 4, 4 * 5]);
  });

  it('generates deterministic market history with spreads', () => {
    const a = marketHistory(30, 3);
    const b = marketHistory(30, 3);
    expect(a[5].rt).toEqual(b[5].rt);
    const spreads = a.flatMap((d) => d.da.map((p, h) => d.rt[h] - p));
    expect(Math.max(...spreads.map(Math.abs))).toBeGreaterThan(5);
    expect(a.every((d) => d.da.length === 24 && d.rtMetro.length === 24)).toBe(true);
  });
});
