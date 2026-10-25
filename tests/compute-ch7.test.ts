// Chapter 7 of the compute course (the capstone): the numbers its prose quotes after the first fix pass.

import { describe, expect, it } from 'vitest';
import { CUSTOMERS_DEFAULT, FLEET_DEFAULT, PRICEBOOK_DEFAULT, WORLD_DEFAULT, effectivePrice, fleetProductivity, type Customer } from '../src/engines/compute/cloud';
import { workloadFit } from '../src/engines/compute/compatibility';
import { GPU_IDS } from '../src/model/compute/hardware';
import { PRICES } from '../src/model/compute/prices';
import { SITES } from '../src/model/compute/sites';
import { WORKLOAD_IDS } from '../src/model/compute/workloads';
import { MARSTON_RACKS, FEEDS, FULL_HALL, LESSON_NUMBERS as L71, evalOf } from '../src/lessons/compute/ch7/L7_1';
import { LESSON_NUMBERS as L72 } from '../src/lessons/compute/ch7/L7_2';
import { LESSON_NUMBERS as L73, PRICE_STEP, listWeekOf } from '../src/lessons/compute/ch7/L7_3';
import { NIGHT_HOUR, NORMAL, PEAK_HOUR, lessonNumbers as l74, runWeek } from '../src/lessons/compute/ch7/L7_4';
import { NEXT_GEN_MAX, NEXT_GEN_MIN, RIGHT_SIZED, WORLD_STATE_DEFAULTS, lessonNumbers as l75, runStrategy } from '../src/lessons/compute/ch7/L7_5';
import { defaultCloud } from '../src/lessons/compute/shared/cloudStore';

const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const pc = (x: number) => Math.round(x * 100);

describe('compute 7.1: the fleet', () => {
  it('measures capacity in A-class equivalents: an A-class GPU does one of every workload', () => {
    const prod = fleetProductivity(FLEET_DEFAULT);
    for (const w of WORKLOAD_IDS) expect(prod[w].A).toBeCloseTo(1, 9);
  });

  it('fills Marston’s hall long before its grid connection', () => {
    expect(MARSTON_RACKS).toBe(60);
    expect(Math.max(...FEEDS)).toBe(140);
    expect(L71.fullHallRacks).toBe(MARSTON_RACKS);
    expect(FULL_HALL.gpus.B / MARSTON_RACKS / 8).toBe(10); // ten 8-GPU servers to a rack
    expect(L71.fullHallGridPeak.toFixed(1)).toBe('8.5');
    expect(L71.fullHallGridPeak).toBeLessThan(SITES.marston.gridMW / 2);
    expect(SITES.marston.gridMW).toBe(20);
    // Whatever fills 60 racks on the biggest feeds — air or liquid, coldest coolant, 2N — stays far inside 20 MW.
    for (const cooling of ['air', 'liquid'] as const)
      for (const g of ['A', 'B'] as const) {
        let last = 0;
        for (let n = 64; n <= 8192; n += 64) {
          const f = { ...FULL_HALL, cooling, supplyC: 15, redundancy: '2N' as const, gpus: { L: 0, A: 0, B: 0, [g]: n } };
          const ev = evalOf(f);
          if (ev.racks > MARSTON_RACKS) break;
          last = ev.gridPeakMW;
        }
        expect(last).toBeGreaterThan(0);
        expect(last).toBeLessThan(10);
      }
  });

  it('says the redundancy control moves only the part-load losses', () => {
    expect(L71.pueN.toFixed(2)).toBe('1.27');
    expect(L71.pue2N.toFixed(2)).toBe('1.28');
    expect(L71.fixedN).toBe(L71.fixedYear);
    expect(L71.fixed2N).toBe(L71.fixedYear);
    expect((L71.fixedN / 1e6).toFixed(1)).toBe('19.9');
  });
});

describe('compute 7.2: demand', () => {
  it('quotes demand before price on a weekday and over the week, as 7.1 does', () => {
    expect(L72.sizes).toBe(1800);
    expect(L72.sizes).toBe(L71.demandAvgTotal);
    expect(r(L72.wants)).toBe(1759);
    expect(L72.wants).toBeLessThan(L72.sizes);
    expect(r(L72.average)).toBe(1682);
  });

  it('names fine-tuning, not batch, as the L-class’s best work', () => {
    expect(L72.batchL.toFixed(2)).toBe('0.27');
    expect(L72.tuneL.toFixed(2)).toBe('0.35');
    const prod = fleetProductivity(FLEET_DEFAULT);
    for (const w of WORKLOAD_IDS) {
      expect(prod[w].L / prod[w].A).toBeLessThanOrEqual(prod.tune8.L / prod.tune8.A + 1e-12);
      expect(prod[w].L / prod[w].B).toBeLessThanOrEqual(prod.tune8.L / prod.tune8.B + 1e-12);
    }
  });
});

describe('compute 7.3: prices', () => {
  it('defines contribution margin as revenue minus electricity when nothing is rented', () => {
    const w = listWeekOf(defaultCloud());
    expect(w.rentCost).toBe(0);
    expect(w.burstCost).toBe(0);
    expect(w.margin).toBeCloseTo(w.revenue - w.powerCost, 6);
  });

  it('the frontier lab stays at $5.00 and leaves at $5.05', () => {
    expect(L73.ceiling).toBeCloseTo(5, 9);
    expect((L73.ceiling + PRICE_STEP).toFixed(2)).toBe('5.05');
    expect(L73.pastProfit).toBeLessThan(L73.ceilProfit);
  });

  it('the fit on four GPUs instead of eight explains a factor of two; the rest is the B-class’s own speed and batch', () => {
    const a = workloadFit('frontier400', 'A');
    const b = workloadFit('frontier400', 'B');
    expect(a.tp).toBe(8);
    expect(b.tp).toBe(4);
    expect(a.kind === 'serve' && b.kind === 'serve' && b.batch > a.batch).toBe(true);
    expect(L73.prodFrontierB.toFixed(2)).toBe('3.13');
    expect(L73.prodFrontierB / (a.tp / b.tp)).toBeGreaterThan(1.5);
  });
});

describe('compute 7.4: operations', () => {
  const N = l74();

  it('explains why a reserved customer is served only 91%', () => {
    expect(pc(N.trainer.shareA)).toBe(88);
    expect(pc(N.trainer.shareFirst)).toBe(98);
    expect(r(N.trainer.committed)).toBe(443);
    expect(r(N.trainer.wanted)).toBe(489);
    expect(pc(N.tieredServed.c4)).toBe(91);
    expect(N.tieredServed.c4).toBeCloseTo(N.trainer.committed / N.trainer.wanted, 2);
  });

  it('states the two-thirds rule from the prices', () => {
    expect(N.rentRule.A).toBeCloseTo(2 / 3, 12);
    expect(N.rentRule.B).toBeCloseTo(2 / 3, 12);
    expect([PRICES.A.reserved, PRICES.A.onDemand, PRICES.B.reserved, PRICES.B.onDemand]).toEqual([1.6, 2.4, 3.2, 4.8]);
  });

  it('uses one night hour, 03:00, and every weekday’s 15:00 ties for busiest', () => {
    expect(NIGHT_HOUR).toBe(3);
    expect(PEAK_HOUR).toBe(15);
    expect(r(N.chatNight)).toBe(200);
    expect(N.night.unmet).toBeGreaterThan(100);
    expect(N.night.idleA).toBeGreaterThan(400);
    const week = runWeek(defaultCloud(), { policy: 'tiered', rented: { L: 0, A: 0, B: 0 }, burst: false }, NORMAL);
    const top = Math.max(...week.hours.map((h) => h.demand));
    const busiest = week.hours.map((h, i) => [i, h.demand] as const).filter(([, d]) => Math.abs(d - top) < 1e-6).map(([i]) => i);
    expect(busiest).toEqual([15, 39, 63, 87, 111]);
  });

  it('the best normal-week plan still loses money', () => {
    expect(r(N.normalBest.profit)).toBe(-1326);
  });
});

describe('compute 7.5: the business', () => {
  const N = l75();

  it('scores on the mean minus half the standard deviation', () => {
    for (const b of [N.start, N.right]) expect(b.riskAdjusted).toBeCloseTo(b.mean - 0.5 * b.stdev, 6);
    expect(r(N.start.stdev / 1e6, 2)).toBe(3.63);
    expect(r(N.right.stdev / 1e6, 2)).toBe(1.59);
  });

  it('an L-class hour does at most a third of an A-class hour’s work for these customers, and costs the most per unit of it', () => {
    expect(N.lMax.toFixed(2)).toBe('0.35');
    expect(N.lNone).toBe(1);
    const prod = fleetProductivity(FLEET_DEFAULT);
    expect(prod.frontier400.L).toBe(0);
    for (const c of CUSTOMERS_DEFAULT as Customer[]) {
      if (prod[c.workload].L <= 0) continue;
      const price = (g: 'L' | 'A' | 'B') => effectivePrice(c, g, PRICEBOOK_DEFAULT, prod);
      expect(price('L')).toBeGreaterThan(price('A'));
      expect(price('L')).toBeGreaterThan(price('B'));
    }
    expect(GPU_IDS).toEqual(['L', 'A', 'B']);
  });

  it('the smaller fleet serves 56% of the fine-tuning shop’s work, with the B-class full and the A-class nearly so', () => {
    expect(pc(N.rightWeek.served.c5)).toBe(56);
    expect(pc(N.rightWeek.utilization.B)).toBe(100);
    expect(pc(N.rightWeek.utilization.A)).toBe(97);
  });

  it('a longer server life only lightens the three simulated years', () => {
    expect(WORLD_DEFAULT.quarters).toBe(12);
    expect(N.life7.riskAdjusted).toBeGreaterThan(N.right.riskAdjusted);
    expect(N.right.riskAdjusted).toBeGreaterThan(N.life3.riskAdjusted);
  });

  it('two drivers dominate the smaller fleet: server life and the next generation', () => {
    const W = WORLD_STATE_DEFAULTS;
    const ra = (w: Partial<typeof W>) => runStrategy(RIGHT_SIZED, { ...W, ...w }).riskAdjusted;
    const swing = (a: Partial<typeof W>, b: Partial<typeof W>) => Math.abs(ra(a) - ra(b));
    const life = swing({ life: 3 }, { life: 7 });
    const nextGen = swing({ nextGen: NEXT_GEN_MIN, drop: 60 }, { nextGen: NEXT_GEN_MAX, drop: 0 });
    const others = [swing({ sigma: 0 }, { sigma: 30 }), swing({ energy: 0.5 }, { energy: 3 }), swing({ failure: 0 }, { failure: 15 })];
    for (const o of others) {
      expect(life).toBeGreaterThan(o);
      expect(nextGen).toBeGreaterThan(o);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix pass 2: the redesigned challenges, the starting-design switch, confirmed resets and the
// B-class work driver.

import { afterEach, vi } from 'vitest';
import { commitments, offers, type FleetDesign } from '../src/engines/compute/cloud';
import { contextUnder } from '../src/engines/compute/strategyChallenge';
import { evaluateFleet } from '../src/engines/compute/cloud';
import { FILL_ANSWER, SPILL_ANSWER, SPILL_ID, SPILL_TARGET, onTheL, onlySizeChanged, smallestSpill, spillSolved, trainerB, weekView } from '../src/lessons/compute/ch7/L7_2';
import { ODA_TOL, RB_TOL, bestPrice, onDemandASolved, reservedBSolved, weekOf, withPrice } from '../src/lessons/compute/ch7/L7_3';
import { LAUNCH, PREMIUM, bestPlan, planSolved, withPremium } from '../src/lessons/compute/ch7/L7_4';
import { BWORK_MAX, BWORK_MIN, B_RANGE, PRICED, TARGET, TRADE_GAP, isStartingWorld, targetSolved, tradeFound } from '../src/lessons/compute/ch7/L7_5';
import { confirmReplaceCloud, confirmResetPart, designFor, getCloud, othersAtStart, partChanged, resetCloud, updateCloud } from '../src/lessons/compute/shared/cloudStore';
import { pct as fmtPct } from '../src/framework';

const withSizeOf = (id: string, size: number) => {
  const d = defaultCloud();
  return { ...d, customers: d.customers.map((c) => (c.id === id ? { ...c, size } : c)) };
};
const M2 = (x: number) => Math.round((x / 1e6) * 100) / 100;

describe('compute ch7 pass 2: the starting design and the reader’s', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCloud();
  });

  it('shows the starting design’s other parts with the lesson’s own part kept', () => {
    const mine = { ...defaultCloud(), fleet: { ...FLEET_DEFAULT, site: 'marston' as const }, customers: defaultCloud().customers.slice(0, 3) };
    const shown = designFor(mine, 'customers', 'start');
    expect(shown.fleet).toEqual(FLEET_DEFAULT);
    expect(shown.customers).toEqual(mine.customers);
    expect(designFor(mine, 'customers', 'yours')).toBe(mine);
    expect(othersAtStart(mine, 'customers')).toBe(false);
    expect(othersAtStart(shown, 'customers')).toBe(true);
    expect(partChanged(mine, 'fleet')).toBe(true);
    expect(partChanged(mine, 'prices')).toBe(false);
  });

  it('asks before a reset, and resets only the lesson’s own part', () => {
    resetCloud();
    // Nothing changed: no question asked.
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    expect(confirmResetPart('fleet')).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    updateCloud((d) => ({ ...d, fleet: { ...d.fleet, site: 'fernhill' }, prices: withPrice(d.prices, 'reserved', 'B', 5) }));
    // Declined: the fleet stays.
    expect(confirmResetPart('fleet')).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(getCloud().fleet.site).toBe('fernhill');
    // Accepted: the fleet goes back, the prices stay.
    vi.stubGlobal('confirm', () => true);
    expect(confirmResetPart('fleet')).toBe(true);
    expect(getCloud().fleet).toEqual(FLEET_DEFAULT);
    expect(getCloud().prices.reserved.B).toBe(5);
    // Loading a whole design asks too.
    vi.stubGlobal('confirm', () => false);
    expect(confirmReplaceCloud(defaultCloud(), 'the starting design')).toBe(false);
    expect(getCloud().prices.reserved.B).toBe(5);
  });
});

describe('compute 7.2 pass 2: does the frontier lab’s growth leave the L-class idle?', () => {
  const N = L72;
  it('the lab can’t run on the L-class, and the chat startup’s buyers won’t pay for it there', () => {
    const prod = fleetProductivity(FLEET_DEFAULT);
    expect(prod.frontier400.L).toBe(0);
    const off = offers(CUSTOMERS_DEFAULT, PRICEBOOK_DEFAULT, FLEET_DEFAULT, prod);
    expect(off.find((o) => o.customer.id === SPILL_ID)!.choices.some((c) => c.gpu === 'L')).toBe(false);
  });

  it('solves at 520 A-eq, not at 510, and not from the default', () => {
    expect(SPILL_TARGET).toBe(0.3);
    expect(smallestSpill()).toBe(SPILL_ANSWER);
    expect(SPILL_ANSWER).toBe(520);
    expect(spillSolved(defaultCloud())).toBe(false);
    expect(spillSolved(withSizeOf(SPILL_ID, 520))).toBe(true);
    expect(spillSolved(withSizeOf(SPILL_ID, 510))).toBe(false);
    // What the readout shows either side of the answer.
    expect(fmtPct(weekView(withSizeOf(SPILL_ID, 510)).ops.utilization.L)).toBe('29%');
    expect(fmtPct(weekView(withSizeOf(SPILL_ID, 520)).ops.utilization.L)).toBe('30%');
    expect(fmtPct(N.spillL)).toBe('30%');
    expect((SPILL_ANSWER / N.labSize).toFixed(1)).toBe('2.6');
    expect(N.labSize).toBe(200);
    expect(N.docSize).toBe(500);
  });

  it('counts only the lab’s growth, on the starting fleet, prices and plan', () => {
    const d = withSizeOf(SPILL_ID, 520);
    // Growing someone else instead, or as well, doesn’t count.
    const both = { ...d, customers: d.customers.map((c) => (c.id === 'c6' ? { ...c, size: 600 } : c)) };
    expect(onlySizeChanged(both.customers, SPILL_ID)).toBe(false);
    expect(spillSolved(both)).toBe(false);
    expect(spillSolved({ ...withSizeOf('c1', 3000) })).toBe(false);
    // Another fleet doesn’t count.
    expect(spillSolved({ ...d, fleet: { ...d.fleet, gpus: { L: 512, A: 1024, B: 256 } } })).toBe(false);
  });

  it('the work that lands on the L-class is other customers’, pushed down by the lab’s reserved GPUs', () => {
    expect(N.spillOnL).toEqual(['c6', 'c2', 'c5']);
    expect(N.spillOnL).not.toContain(SPILL_ID);
    expect(N.trainerBStart).toBe(160);
    expect(N.trainerBSpill).toBeLessThan(N.trainerBStart);
    const at = weekView(withSizeOf(SPILL_ID, 520));
    expect(at.ops.gpuHoursBy[SPILL_ID].L).toBe(0);
    expect(at.ops.gpuHoursBy.c1.L).toBe(0);
    expect(onTheL(withSizeOf(SPILL_ID, 520)).map((c) => c.id)).toEqual(N.spillOnL);
    expect(trainerB(withSizeOf(SPILL_ID, 520))).toBe(N.trainerBSpill);
    // gpuHoursBy agrees with the utilization.
    const total = Object.values(at.ops.gpuHoursBy).reduce((s, g) => s + g.L, 0);
    expect(total / (FLEET_DEFAULT.gpus.L * 168)).toBeCloseTo(at.ops.utilization.L, 9);
    // The document processor still fills the L-class half at 1,130 A-eq (the prose before the challenge).
    expect(FILL_ANSWER).toBe(1130);
  });
});

describe('compute 7.3 pass 2: predict above or below the list, then find the best price', () => {
  const S = defaultCloud();
  const rb = (p: number) => ({ ...S, prices: withPrice(S.prices, 'reserved', 'B', p) });
  const oda = (base: typeof S, p: number) => ({ ...base, prices: withPrice(base.prices, 'onDemand', 'A', p) });

  it('a: the best reserved B-class price is above the list, a step or two below the lab’s substitute', () => {
    expect(RB_TOL).toBe(2000);
    expect(reservedBSolved(S)).toBe(false);
    for (const p of [4.9, 4.95, 5]) expect(reservedBSolved(rb(p))).toBe(true);
    for (const p of [3.75, 4.5, 4.85, 5.05]) expect(reservedBSolved(rb(p))).toBe(false);
    expect(bestPrice(S, 'reserved', 'B').price).toBeGreaterThan(PRICEBOOK_DEFAULT.reserved.B);
    // The question’s numbers: the lab’s work costs $1.02 on the B-class and $1.60 on the A-class, so the ceiling is about $5.02.
    expect(L73.frontierOnB.toFixed(2)).toBe('1.02');
    expect(PRICEBOOK_DEFAULT.reserved.A).toBe(1.6);
    expect(((PRICEBOOK_DEFAULT.reserved.B * 1.6) / 1.02).toFixed(2)).toBe('5.02');
    expect((L73.up10Gain * 100).toFixed(1)).toBe('4.1');
  });

  it('b: the best on-demand A-class price is above the list though a fifth of the A-class is idle', () => {
    expect(ODA_TOL).toBe(200);
    expect(fmtPct(1 - weekOf(S).utilization.A)).toBe('21%');
    expect(onDemandASolved(S)).toBe(false);
    for (const p of [2.9, 2.95, 3]) expect(onDemandASolved(oda(S, p))).toBe(true);
    for (const p of [2.4, 2.85, 3.05]) expect(onDemandASolved(oda(S, p))).toBe(false);
    const at5 = rb(5);
    for (const p of [2.8, 2.85, 2.9, 2.95]) expect(onDemandASolved(oda(at5, p))).toBe(true);
    for (const p of [2.75, 3]) expect(onDemandASolved(oda(at5, p))).toBe(false);
    expect(L73.odaListBest.price).toBeGreaterThan(PRICEBOOK_DEFAULT.onDemand.A);
    expect(L73.odaCeilBest.price).toBeGreaterThan(PRICEBOOK_DEFAULT.onDemand.A);
  });
});

describe('compute 7.4 pass 2: does any rental pay in a normal week?', () => {
  const N = l74();
  const S = defaultCloud();
  const plan = (A = 0, B = 0, burst = false) => ({ policy: 'tiered' as const, rented: { L: 0, A, B }, burst });

  it('work is turned away in every hour, yet no rental pays, with or without the premium price book', () => {
    expect(N.hoursTurnedAway).toBe(168);
    expect(bestPlan(S, NORMAL).ops.rented).toEqual({ L: 0, A: 0, B: 0 });
    const prem = withPremium(S, true);
    const best = bestPlan(prem, NORMAL);
    expect(best.ops).toMatchObject({ policy: 'tiered', rented: { L: 0, A: 0, B: 0 }, burst: true });
    expect(planSolved(prem, plan(0, 0, true), NORMAL, NORMAL)).toBe(true);
    expect(planSolved(prem, plan(0, 0, false), NORMAL, NORMAL)).toBe(false);
    expect(planSolved(prem, plan(64, 0, true), NORMAL, NORMAL)).toBe(false);
    // The default plan (first come, first served) is unsolved.
    expect(planSolved(S, S.ops, NORMAL, NORMAL)).toBe(false);
    // In a launch week renting does pay.
    expect(bestPlan(S, LAUNCH).ops.rented.A).toBeGreaterThan(0);
  });

  it('rented A-class GPUs work in a quarter of the hours; rented B-class GPUs take the A-class’s work', () => {
    expect(N.rentA64.hours).toBe(45);
    expect(N.rentA64.hours / 168).toBeLessThan(2 / 3);
    expect(Math.round(N.rentA64.loss)).toBe(15433);
    expect(N.rentB32.hours).toBe(168);
    expect(Math.round(N.rentB32.loss)).toBe(20130);
    expect(Math.round(-N.rentB32.revenueChange)).toBe(3562);
    expect(Math.round(N.rentB32.rent)).toBe(17203);
    expect([fmtPct(N.tieredUtilA), fmtPct(N.rentB32.ownedA)]).toEqual(['79%', '73%']);
  });

  it('the premium price book is 20% above the market, and makes bursting pay', () => {
    expect(PREMIUM).toBe(0.2);
    const prem = withPremium(S, true);
    expect(prem.prices.onDemand.A).toBeCloseTo(2.88, 9);
    expect(prem.prices.reserved).toEqual(S.prices.reserved);
    expect(withPremium(S, false)).toBe(S);
    expect(Math.round(N.premium.gain)).toBe(6180);
  });
});

describe('compute 7.5 pass 2: the target needs pricing; a trade between mean and tail; the B-class driver', () => {
  const N = l75();
  const S = defaultCloud();
  const W = WORLD_STATE_DEFAULTS;
  const strat = (fleet: Partial<FleetDesign>, prices = S.prices) => ({ ...S, fleet: { ...S.fleet, ...fleet }, prices, ops: { ...S.ops, policy: 'tiered' as const } });

  it('a: $18M is beyond the best fleets at the list prices and within reach with Lesson 7.3’s prices', () => {
    expect(TARGET).toBe(18e6);
    expect(targetSolved(S, W)).toBe(false);
    expect(targetSolved(RIGHT_SIZED, W)).toBe(false);
    // The best list-price fleets found by a search over sites, cooling, coolant, feeds, ports and the GPU mix.
    const bestList = strat({ cooling: 'liquid', supplyC: 40, feedKW: 60, downPorts: 50, redundancy: 'N', gpus: { L: 0, A: 0, B: 640 } });
    expect(evaluateFleet(bestList.fleet).checks.every((c) => c.ok)).toBe(true);
    expect(M2(runStrategy(bestList).riskAdjusted)).toBe(16.84);
    expect(targetSolved(bestList, W)).toBe(false);
    expect(M2(runStrategy(strat({ gpus: { L: 0, A: 0, B: 576 } })).riskAdjusted)).toBe(15.67);
    // Lesson 7.3’s reserved B-class price alone isn’t enough on the smaller fleet…
    const rb5 = { ...RIGHT_SIZED, prices: withPrice(RIGHT_SIZED.prices, 'reserved', 'B', 5) };
    expect(M2(runStrategy(rb5).riskAdjusted)).toBe(15.76);
    expect(targetSolved(rb5, W)).toBe(false);
    // …but with the on-demand B-class raised too it is.
    expect(M2(N.priced.riskAdjusted)).toBe(18.61);
    expect(targetSolved(PRICED, W)).toBe(true);
    expect(targetSolved(PRICED, { ...W, bWork: 95 })).toBe(false);
    // A throttled fleet fails the cooling check, so it doesn’t count however it scores.
    const hot = { ...PRICED, fleet: { ...PRICED.fleet, supplyC: 35 } };
    expect(evaluateFleet(hot.fleet).checks.find((c) => c.id === 'cooling')!.ok).toBe(false);
    expect(targetSolved(hot, W)).toBe(false);
  });

  it('b: two saved strategies that trade mean for tail', () => {
    const run = (d: typeof PRICED) => {
      const r = runStrategy(d);
      return { design: { ...S, ...d }, mean: r.mean, p5: r.p5 };
    };
    const lo = run(PRICED);
    const hi = run({ ...PRICED, prices: withPrice(PRICED.prices, 'onDemand', 'B', 7) });
    expect(hi.mean).toBeGreaterThan(lo.mean + TRADE_GAP);
    expect(lo.p5).toBeGreaterThan(hi.p5 + TRADE_GAP);
    expect(tradeFound([lo, hi])).toEqual([hi, lo]);
    expect(tradeFound([])).toBeNull();
    expect(tradeFound([lo])).toBeNull();
    // One better on both counts is not a trade.
    expect(tradeFound([run(S), run(RIGHT_SIZED)])).toBeNull();
    // Too close to tell apart on the table isn’t either.
    expect(tradeFound([lo, { ...lo, mean: lo.mean + 0.01e6, p5: lo.p5 - 0.01e6 }])).toBeNull();
    // Other customers don’t count.
    expect(tradeFound([lo, { ...hi, design: { ...hi.design, customers: [] } }])).toBeNull();
  });

  it('the B-class work driver: its range, its default, and what it does to the priced strategy', () => {
    expect([BWORK_MIN, W.bWork, BWORK_MAX]).toEqual([60, 100, 120]);
    expect(isStartingWorld({ ...W, bWork: 95 })).toBe(false);
    expect([B_RANGE.min.toFixed(1), B_RANGE.max.toFixed(1)]).toEqual(['2.3', '3.1']);
    expect(runStrategy(RIGHT_SIZED, W).npvs).toEqual(runStrategy(RIGHT_SIZED, { ...W, bWork: 100 }).npvs);
    // 5% less: the lab’s ceiling falls below $5.00 and it moves to the A-class.
    expect(N.ceiling95.toFixed(2)).toBe('4.76');
    const lab95 = contextUnder(PRICED.customers, PRICED.prices, PRICED.fleet, { energyScale: 1, serverLifeYears: 5, bWork: 0.95 }).off.find((o) => o.customer.id === 'c3')!;
    expect(lab95.gpu).toBe('A');
    expect(M2(N.priced95.riskAdjusted)).toBe(16.25);
    // 10% more: the lab stays on the B-class but needs fewer of its GPUs.
    const labB = (bWork: number) =>
      commitments(contextUnder(PRICED.customers, PRICED.prices, PRICED.fleet, { energyScale: 1, serverLifeYears: 5, bWork }))
        .list.filter((c) => c.customer === 'c3' && c.gpu === 'B')
        .reduce((s, c) => s + c.gpus, 0);
    expect(labB(1.1)).toBeLessThan(labB(1));
    expect(M2(N.priced110.riskAdjusted)).toBe(17.79);
    expect(N.priced110.riskAdjusted).toBeLessThan(N.priced.riskAdjusted);
  });
});
