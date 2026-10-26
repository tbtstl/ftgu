// The natural gas course, chapter 3: numbers the lessons quote after the first fix pass.

import { describe, expect, it } from 'vitest';
import { compress } from '../src/engines/gas/compression';
import { packLineOf, runLinepack } from '../src/engines/gas/linepack';
import { breakevenHub, lngCargo, netback } from '../src/engines/gas/lng';
import { withdrawCapacity } from '../src/engines/gas/storage';
import { bindingArcs, COMPRESSION_COST_PER_HP, corridorDesign, PIPE_COST_PER_INCH_MILE, solveFlow } from '../src/engines/gas/network';
import { psia } from '../src/engines/gas/properties';
import { CORRIDORS, PIPELINE, REFERENCE_DAYS, STORAGE_SPECS } from '../src/model/gas/world';
import { BUILD_DEFAULTS, buildProblem, design, PLANT_BCFD, REGION_SIZES, REGION_STATIONS } from '../src/lessons/gas/ch3/L3_1';
import { dayPreset, LOOP_DEFAULTS, LOOP_LINEAR_SHARE, LOOP_TARGET, loopCapacityHidden, loopedCapacity, loopSolved, METRO_PEAK, networkProblem, peakSolved, solveDay, SOLVER_DEFAULTS } from '../src/lessons/gas/ch3/L3_2';
import { atImbalance, clean, demandDay, IMBALANCE, IMBALANCE_THREE_DAYS, IMBALANCE_WINDOW, imbalanceSolved, PACK_DEFAULTS, simulate, START_MAX, START_MIN, START_STEP, startRange } from '../src/lessons/gas/ch3/L3_3';
import { DEF_FULL_DAY, dayLabel, EVEN_DAYS, EVEN_FILL, evenFillSolved, FASTER_FILL, firmRate, firmSolved, gasYear, INJ_DAYS, SNAP_DEFAULTS, tenDays, WD_DAYS, YEAR_DEFAULTS } from '../src/lessons/gas/ch3/L3_4';
import { CHAIN_DEFAULTS, CHALLENGE as LNG_CHALLENGE, challengeAnswer, EUROPE_NETBACK, LNG_ADDER, matchSolved, NORTHLINE_ALL_IN, NORTHLINE_CAPITAL, PRICE_STEP, voyageOf } from '../src/lessons/gas/ch3/L3_5';

const NL = PIPELINE['calder-metro'];
const total = (d: 'summer' | 'winter' | 'design') => Object.values(REFERENCE_DAYS[d].demand).reduce((a, b) => a + b, 0);

describe('gas 3.1 (fix pass)', () => {
  const answer = { ...BUILD_DEFAULTS, day: 'design' as const, plant: true, sizes: REGION_SIZES, stations: { ...REGION_STATIONS, 'sandhill-metro': 4 } };
  const supply = (p: ReturnType<typeof buildProblem>, s: ReturnType<typeof solveFlow>, id: string) => s.supplied[p.supplies.findIndex((x) => x.id === id)];

  it('serves the new plant with 0.05 more on the Valley Line and the last 0.15 of Hollow Creek', () => {
    const p = buildProblem(answer);
    const s = solveFlow(p);
    expect(Object.values(s.unserved).reduce((a, b) => a + b, 0)).toBeLessThan(1e-9);
    expect(s.flow['sandhill-metro']).toBeCloseTo(0.5, 9);
    expect(s.flow['sandhill-metro'] - PIPELINE['sandhill-metro'].capacityBcfd).toBeCloseTo(0.05, 9);
    expect(PLANT_BCFD).toBeCloseTo(0.2, 9);
    expect(supply(p, s, 'hollowcreek')).toBeCloseTo(STORAGE_SPECS.hollowcreek.maxWithdrawBcfd, 9);
    const before = buildProblem({ ...BUILD_DEFAULTS, day: 'design' });
    expect(supply(before, solveFlow(before), 'hollowcreek')).toBeCloseTo(0.85, 9);
  });

  it('names only the full lines into Metro in the challenge status', () => {
    const p = buildProblem({ ...BUILD_DEFAULTS, day: 'design', plant: true });
    const s = solveFlow(p);
    const binding = bindingArcs(p, s);
    expect(binding).toContain('ridgeback-bayport');
    const into = binding.filter((id) => CORRIDORS.find((c) => c.id === id)?.to === 'metro');
    expect(into.sort()).toEqual(['calder-metro', 'sandhill-metro']);
  });

  it('quotes the economies of scale', () => {
    const per = (size: number, n: number) => design('calder-metro', size, n).cost / design('calder-metro', size, n).capacityBcfd;
    expect(Math.round((1 - per(42, 3) / per(20, 3)) * 100)).toBe(63);
    expect(Math.round(per(36, 1) / 1e7)).toBe(139);
    expect(Math.round(per(36, 3) / 1e7)).toBe(101);
    expect(Math.round(per(36, 4) / 1e7)).toBe(100);
    expect(Math.round(per(36, 5) / 1e7)).toBe(103);
  });
});

describe('gas 3.2 (fix pass)', () => {
  it('caps Metro on the design day at the cut around it, 3.25 Bcf/d', () => {
    expect(METRO_PEAK).toBeCloseTo(3.25, 9);
    const answers: number[] = [];
    for (let i = 0; i <= 52; i++) if (peakSolved({ ...dayPreset('design'), metro: Math.round((0.8 + i * 0.05) * 100) / 100 })) answers.push(Math.round((0.8 + i * 0.05) * 100));
    expect(answers).toEqual([325]);
    // Neither the cold-day default nor the design day as it starts is the answer.
    expect(peakSolved(SOLVER_DEFAULTS)).toBe(false);
    expect(peakSolved(dayPreset('design'))).toBe(false);
    // Other settings changed: not the challenge.
    expect(peakSolved({ ...dayPreset('design'), metro: 3.25, salt: 1 })).toBe(false);
    expect(peakSolved({ ...dayPreset('design'), metro: 3.25, out: ['ridgeback-calder'] })).toBe(false);
    // One step more: Metro short 0.05 while Salt Flat has 0.10 left.
    const over = solveDay({ ...dayPreset('design'), metro: 3.3 });
    expect(over.unserved.metro).toBeCloseTo(0.05, 9);
    expect(STORAGE_SPECS.saltflat.maxWithdrawBcfd - over.salt).toBeCloseTo(0.1, 9);
  });

  it('gives Northline 2.05 Bcf/d with a fourth station, as in Lesson 3.1', () => {
    expect(corridorDesign('calder-metro', 36, 4).capacityBcfd).toBeCloseTo(2.05, 9);
  });

  it('sets the loop target on the cold winter day, when the region has exactly enough gas without Hollow Creek', () => {
    const supplyNoHollow = 2.6 + 0.8 + STORAGE_SPECS.saltflat.maxWithdrawBcfd;
    expect(dayPreset('winter').ridgeback + dayPreset('winter').sandhill + dayPreset('winter').salt).toBeCloseTo(supplyNoHollow, 9);
    expect(supplyNoHollow).toBeCloseTo(4.6, 9);
    expect(total('winter')).toBeCloseTo(4.6, 9);
    expect(LOOP_TARGET).toBe(1950);
    // With Northline able to carry 1.95, the cold day is served without Hollow Creek; with 1.90 it isn't.
    const without = (cap: number) => {
      const p = networkProblem({ ...SOLVER_DEFAULTS, hollow: 0 });
      return solveFlow({ ...p, arcs: p.arcs.map((a) => (a.id === 'calder-metro' ? { ...a, cap } : a)) });
    };
    expect(Object.values(without(1.95).unserved).reduce((a, b) => a + b, 0)).toBeLessThan(1e-9);
    expect(without(1.9).unserved.metro).toBeCloseTo(0.05, 9);
    // On the design day the region is 0.75 short of gas without Hollow Creek, whatever the pipes.
    expect(total('design') - supplyNoHollow).toBeCloseTo(0.75, 9);
    expect(solveDay(SOLVER_DEFAULTS).hollow).toBeCloseTo(0.15, 9);
  });

  it('solves the looping challenge at 20% with 36-inch pipe, for about $304 million, more than a fourth station', () => {
    const answers: number[] = [];
    for (let i = 0; i <= 20; i++) if (loopSolved({ size: '36', share: i * 5 })) answers.push(i * 5);
    expect(answers).toEqual([20]);
    expect(loopSolved(LOOP_DEFAULTS)).toBe(false);
    const cap = loopedCapacity(36, 0.2).total;
    expect(cap).toBeGreaterThanOrEqual(1950);
    expect(loopedCapacity(36, 0.15).total).toBeLessThan(1950);
    expect(cap / 1000).toBeCloseTo(1.95, 2);
    const hp = (q: number) => NL.stations * compress(q, psia(NL.minDeliveryPsig), psia(NL.maopPsig)).hp;
    const extra = hp(cap) - hp(loopedCapacity(36, 0).total);
    expect(Math.round(extra / 1000) * 1000).toBe(15000);
    const pipe = 36 * 0.2 * NL.lengthMi * PIPE_COST_PER_INCH_MILE;
    expect(0.2 * NL.lengthMi).toBe(48);
    expect(Math.round(pipe / 1e6)).toBe(259);
    const loopCost = pipe + extra * COMPRESSION_COST_PER_HP;
    expect(Math.round(loopCost / 1e6)).toBe(304);
    const station = (corridorDesign('calder-metro', 36, 4).hp - corridorDesign('calder-metro', 36, 3).hp) * COMPRESSION_COST_PER_HP;
    expect(Math.round(station / 1e6)).toBe(233);
    expect(station).toBeLessThan(loopCost);
  });
});

describe('gas 3.3 (fix pass)', () => {
  it('runs Northline at 1.3 Bcf/d by default, and a full Northline is past the point of having any flexibility', () => {
    expect(PACK_DEFAULTS.avg / 1000).toBeCloseTo(1.3, 9);
    const r = startRange(NL.capacityBcfd * 1000, 0, NL.capacityBcfd * 1000);
    expect(r.lo).toBeGreaterThan(r.hi);
    expect(solveDay(SOLVER_DEFAULTS).flow['calder-metro']).toBeCloseTo(1.8, 9);
  });
});

describe('gas 3.5 (fix pass)', () => {
  it('compares the LNG chain with Northline’s all-in cost: about ten times as much', () => {
    expect(LNG_ADDER).toBeCloseTo(4.17, 2);
    expect(NORTHLINE_CAPITAL).toBeCloseTo(0.28, 2);
    expect(NORTHLINE_ALL_IN).toBeCloseTo(0.43, 2);
    expect(Math.round(LNG_ADDER / NORTHLINE_ALL_IN)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Second fix pass: figures and challenges.

describe('gas 3.2 (fix pass 2)', () => {
  it('draws the line around Metro: with Northline out, what crosses it is exactly what Metro receives', () => {
    const out = solveDay({ ...SOLVER_DEFAULTS, out: ['calder-metro'] });
    expect(out.served.metro).toBeCloseTo(PIPELINE['sandhill-metro'].capacityBcfd + STORAGE_SPECS.hollowcreek.maxWithdrawBcfd, 9);
    expect(out.served.metro).toBeCloseTo(1.45, 9);
    // The design-day answer is the same count with Northline in: 1.80 + 0.45 + 1.00.
    expect(NL.capacityBcfd + PIPELINE['sandhill-metro'].capacityBcfd + STORAGE_SPECS.hollowcreek.maxWithdrawBcfd).toBeCloseTo(METRO_PEAK, 9);
  });
});

describe('gas 3.2 (looping challenge: estimate first)', () => {
  const cap = (share: number) => loopedCapacity(36, share / 100).total;
  it('gives the estimate from the quoted numbers: the first half adds 0.48, the second 1.32, and a straight line says 16%', () => {
    expect((cap(50) - cap(0)) / 1000).toBeCloseTo(0.48, 2);
    expect((cap(100) - cap(50)) / 1000).toBeCloseTo(1.32, 2);
    expect(Math.round(LOOP_LINEAR_SHARE)).toBe(16);
    // The curve sags under the straight line from unlooped to half-looped, so the answer can only be more…
    for (let s = 5; s < 50; s += 5) expect(cap(s)).toBeLessThan(cap(0) + ((cap(50) - cap(0)) * s) / 50);
    // …and 20%, the first step past 16%, is enough, while 15% is not.
    expect(cap(20)).toBeGreaterThanOrEqual(LOOP_TARGET);
    expect(Math.round(cap(15) / 10) / 100).toBe(1.91);
  });
  it('starts unsolved, is solved at 20% and not at its neighbors, and lands neither at a slider end nor one step from the start', () => {
    expect(LOOP_DEFAULTS).toEqual({ size: '36', share: 0 });
    expect(loopSolved(LOOP_DEFAULTS)).toBe(false);
    expect(loopSolved({ size: '36', share: 20 })).toBe(true);
    for (const share of [15, 25]) expect(loopSolved({ size: '36', share })).toBe(false);
    expect(loopSolved({ size: '30', share: 20 })).toBe(false);
    expect(20 - LOOP_DEFAULTS.share).toBeGreaterThan(5);
  });
  it('hides the 36-inch capacity under half looped until the challenge is solved', () => {
    for (let share = 5; share < 50; share += 5) expect(loopCapacityHidden({ size: '36', share }, false)).toBe(true);
    // Unlooped, half and fully looped stay on show: the prose quotes them as the estimate's inputs.
    for (const share of [0, 50, 100]) expect(loopCapacityHidden({ size: '36', share }, false)).toBe(false);
    // Other sizes stay on show, and so does everything once solved.
    expect(loopCapacityHidden({ size: '30', share: 20 }, false)).toBe(false);
    expect(loopCapacityHidden({ size: '24', share: 20 }, false)).toBe(false);
    expect(loopCapacityHidden({ size: '36', share: 20 }, true)).toBe(false);
  });
});

describe('gas 3.3 (fix pass 2)', () => {
  const at = (start: number, extra: Partial<typeof PACK_DEFAULTS> = {}) => ({ ...PACK_DEFAULTS, ratable: false, receipts: IMBALANCE.receipts, start, ...extra });

  it('carries 1,250 MMcf/d of receipts through two days only from 816–850 MMcf, and never through three', () => {
    expect(IMBALANCE).toEqual({ avg: 1300, ramp: 0, receipts: 1250 });
    expect(Math.ceil(IMBALANCE_WINDOW.lo)).toBe(816);
    expect(Math.floor(IMBALANCE_WINDOW.hi)).toBe(850);
    // The balanced window the question quotes, and the two days' drain.
    const balanced = startRange(1300, 0, 1300);
    expect(Math.ceil(balanced.lo)).toBe(730);
    expect(Math.floor(balanced.hi)).toBe(828);
    expect(((IMBALANCE.avg - IMBALANCE.receipts) * 48) / 24).toBe(100);
    // A reader's prediction — the balanced bottom raised by ~90 MMcf of drain by the second evening — lands inside.
    expect(730 + (50 * 43) / 24).toBeGreaterThan(IMBALANCE_WINDOW.lo);
    expect(730 + (50 * 43) / 24).toBeLessThan(IMBALANCE_WINDOW.hi);
    // Three days: no window, and no start on a wide grid runs clean.
    expect(IMBALANCE_THREE_DAYS.lo).toBeGreaterThan(IMBALANCE_THREE_DAYS.hi);
    const line = packLineOf(PIPELINE['calder-metro']);
    for (let start = 600; start <= 1000; start += 5) {
      const r = runLinepack(line, start, [IMBALANCE.receipts], demandDay(IMBALANCE.avg, 0), 72);
      expect(r.every((h) => h.shortfall < 1e-6 && h.refused < 1e-6)).toBe(false);
    }
  });

  it('is solved only at the challenge’s settings with a start that carries both days', () => {
    const solvedStarts: number[] = [];
    for (let s = START_MIN; s <= START_MAX; s += START_STEP) if (imbalanceSolved(at(s))) solvedStarts.push(s);
    expect(solvedStarts).toEqual([820, 825, 830, 835, 840, 845, 850]);
    // The default state and the default start are unsolved; so are the near misses either side.
    expect(imbalanceSolved(PACK_DEFAULTS)).toBe(false);
    expect(atImbalance(PACK_DEFAULTS)).toBe(false);
    expect(imbalanceSolved(at(780))).toBe(false);
    expect(imbalanceSolved(at(815))).toBe(false);
    expect(imbalanceSolved(at(855))).toBe(false);
    // A sliver of a cut at 815, receipts held back at 855: both visible in the status.
    const r815 = simulate(at(815));
    expect(r815.reduce((a, h) => a + h.shortfall, 0) / 24).toBeGreaterThan(0.05);
    const r855 = simulate(at(855));
    expect(r855.reduce((a, h) => a + h.refused, 0) / 24).toBeGreaterThan(0.5);
    // Other settings don't count.
    expect(imbalanceSolved(at(835, { ratable: true }))).toBe(false);
    expect(imbalanceSolved(at(835, { receipts: 1260 }))).toBe(false);
    expect(imbalanceSolved(at(835, { ramp: 25 }))).toBe(false);
    expect(clean(simulate(at(835, { receipts: 1260 })))).toBe(true);
  });
});

describe('gas 3.4 (fix pass 2)', () => {
  const HC = STORAGE_SPECS.hollowcreek;

  it('fills the field by November 1 at the starting settings', () => {
    const r = gasYear(YEAR_DEFAULTS.start, YEAR_DEFAULTS.inject, YEAR_DEFAULTS.withdraw);
    expect(YEAR_DEFAULTS).toEqual({ start: 36, inject: 0.45, withdraw: 0.6 });
    expect(r[INJ_DAYS - 1].inventory).toBeCloseTo(HC.workingBcf, 6);
    expect(dayLabel(DEF_FULL_DAY)).toBe('October 16');
    expect(dayLabel(r.findIndex((d) => d.limited))).toBe('August 15');
    expect(HC.workingBcf - YEAR_DEFAULTS.start).toBe(84);
    expect(dayLabel(Math.ceil(84 / 0.45) - 1)).toBe('October 4');
    expect(r[INJ_DAYS - 1].inventory - r[r.length - 1].inventory).toBeCloseTo(88.9, 1);
  });

  it('asks for the firm rate from the starting settings, and the end-of-winter estimate finds it', () => {
    expect(firmSolved(YEAR_DEFAULTS)).toBe(false);
    expect(firmSolved({ ...YEAR_DEFAULTS, withdraw: 0.54 })).toBe(true);
    expect(firmSolved({ ...YEAR_DEFAULTS, withdraw: 0.53 })).toBe(false);
    expect(firmSolved({ ...YEAR_DEFAULTS, withdraw: 0.55 })).toBe(false);
    // The estimate the question suggests: the rate must still be available on the last day of winter.
    let est = 0;
    for (let k = 0; k <= 100; k++) if (withdrawCapacity(HC, HC.workingBcf - (WD_DAYS - 1) * (k / 100)) >= k / 100) est = k / 100;
    expect(est).toBe(firmRate());
    // And the ratchet rates the prose quotes bracket it: half full 0.75, a quarter 0.46.
    expect(withdrawCapacity(HC, HC.workingBcf - WD_DAYS * 0.5)).toBeGreaterThan(0.5);
    expect(withdrawCapacity(HC, HC.workingBcf - WD_DAYS * 0.6)).toBeLessThan(0.6);
  });

  it('finds the fields even over ten days at about 29% full, well above where Salt Flat’s wells stop being faster', () => {
    expect(EVEN_DAYS).toBe(10);
    expect(Math.round(EVEN_FILL)).toBe(29);
    expect(Math.round(FASTER_FILL)).toBe(16);
    const even = tenDays(29);
    expect(even.hc).toBeCloseTo(4.85, 2);
    expect(Math.round((even.sf / (0.29 * 30)) * 100)).toBe(56);
    expect(Math.round((even.hc / (0.29 * 120)) * 100)).toBe(14);
    // Between the two fills Salt Flat's wells start faster, yet Hollow Creek delivers more over ten days.
    for (let f = 17; f <= 28; f++) {
      expect(withdrawCapacity(STORAGE_SPECS.saltflat, (f / 100) * 30)).toBeGreaterThan(withdrawCapacity(HC, (f / 100) * 120));
      expect(tenDays(f).hc).toBeGreaterThan(tenDays(f).sf);
    }
    // Bracketed by the prose: a quarter full favors Hollow Creek, full favors Salt Flat.
    expect(tenDays(25).hc).toBeGreaterThan(tenDays(25).sf);
    expect(tenDays(100).sf).toBeGreaterThan(tenDays(100).hc);
  });

  it('solves the even-fill challenge at 28–30% with a ten-day spell, and nowhere else', () => {
    const fills: number[] = [];
    for (let f = 0; f <= 100; f++) if (evenFillSolved({ fill: f, days: 10 })) fills.push(f);
    expect(fills).toEqual([28, 29, 30]);
    expect(evenFillSolved(SNAP_DEFAULTS)).toBe(false);
    expect(evenFillSolved({ fill: 29, days: 9 })).toBe(false);
    expect(evenFillSolved({ fill: 29, days: 30 })).toBe(false);
    expect(evenFillSolved({ fill: 27, days: 10 })).toBe(false);
    expect(evenFillSolved({ fill: 31, days: 10 })).toBe(false);
    expect(evenFillSolved({ fill: 0, days: 10 })).toBe(false);
  });
});

describe('gas 3.5 (fix pass 2)', () => {
  const asia = (destPrice: number, extra: Partial<typeof CHAIN_DEFAULTS> = {}) => ({ ...CHAIN_DEFAULTS, dest: 'asia' as const, destPrice, ...extra });

  it('makes Asia as good as Europe at $9.00 with a price of $9.75', () => {
    expect(EUROPE_NETBACK).toBeCloseTo(7.73, 2);
    expect(challengeAnswer()).toBe(9.75);
    expect(PRICE_STEP).toBe(0.25);
    const v = voyageOf(asia(9.75));
    expect(netback(v, 9.75)).toBeCloseTo(7.72, 2);
    expect(breakevenHub(v, 9.75)).toBeCloseTo(4.54, 2);
    expect(breakevenHub(voyageOf(CHAIN_DEFAULTS), 9)).toBeCloseTo(4.55, 2);
    // The prediction: the delivered costs differ by $0.74, and the answer is $0.75 more than Europe pays.
    const diff = lngCargo(voyageOf(asia(9))).delivered$ - lngCargo(voyageOf(CHAIN_DEFAULTS)).delivered$;
    expect(diff).toBeCloseTo(0.74, 2);
    expect(challengeAnswer() - LNG_CHALLENGE.europePrice).toBeCloseTo(0.75, 9);
    // At the same $9.00, Asia nets back $7.00 and breaks even at $3.91.
    expect(netback(voyageOf(asia(9)), 9)).toBeCloseTo(7.0, 2);
    expect(breakevenHub(voyageOf(asia(9)), 9)).toBeCloseTo(3.91, 2);
  });

  it('is solved only at $9.75 for Asia at the starting charter rate', () => {
    expect(matchSolved(asia(9.75))).toBe(true);
    expect(matchSolved(asia(9.75, { hub: 5 }))).toBe(true);
    expect(matchSolved(CHAIN_DEFAULTS)).toBe(false);
    expect(matchSolved(asia(9))).toBe(false);
    expect(matchSolved(asia(9.5))).toBe(false);
    expect(matchSolved(asia(10))).toBe(false);
    expect(matchSolved({ ...CHAIN_DEFAULTS, destPrice: 9.75 })).toBe(false);
    expect(matchSolved(asia(9.75, { charter: 100_000 }))).toBe(false);
  });
});
