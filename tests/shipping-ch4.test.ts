// Chapter 4 of the shipping course: the numbers its prose quotes and its challenges' checks.
import { describe, expect, it } from 'vitest';
import { MARKET_CLASSES } from '../src/model/shipping/trades';
import { classOpex } from '../src/engines/shipping/cycle';
import { PLANNED, timeCharter, voyageCharter } from '../src/engines/shipping/charter';
import {
  ALB_MARGINAL_N,
  ALB_TCE_BASE,
  ALB_TCE_MARGINAL,
  CHOKE_EQ,
  DEFAULTS as D41,
  DOUBLE_N,
  FLOOR_STEPS,
  NEWEST,
  OLDEST,
  SLOPE_HIGH,
  SLOPE_LOW,
  SURPLUS6,
  TOP,
  doubleSolved,
  heronSurplus,
  marketAt,
  offersAt,
} from '../src/lessons/shipping/ch4/L4_1';
import {
  BREAK_EVEN,
  FREIGHT_TOLERANCE,
  PER_CENT,
  START_FREIGHT,
  START_HIRE,
  START_SHORTFALL,
  CHALLENGE_OUTCOME,
  VOYAGE,
  matchSolved,
  outcomeSet,
} from '../src/lessons/shipping/ch4/L4_2';
import { MISS, START_DAY, balancedSolved, panelMiss, truthOnDay } from '../src/lessons/shipping/ch4/L4_3';
import {
  BASE,
  BOOM_DROP,
  CARGO_FLAT,
  FAST_GROWTH,
  LAG6,
  NEXT_JUMP,
  NO_GROWTH,
  ORDERS_AT_10,
  ORDERS_LOW_YEAR,
  SCRAP_AT_QUARTER,
  SOLVED_LAGS,
  START,
  SURGE,
  SURGE_BASE,
  SURGE_FOUR_YEARS,
  SURGE_ORDERS,
  SURGE_START,
  SURGE_TCE,
  SURGE_YEAR_LAG,
  runCycle,
  slumpTimedSolved,
} from '../src/lessons/shipping/ch4/L4_4';
import { ALTERNATE, EQUAL_GAP, LONG_RUN_HIGH, LONG_RUN_LOW, ffaTrade, hedgeStrip, missSpread } from '../src/lessons/shipping/ch4/L4_5';
import { dailyIndex, longRun } from '../src/engines/shipping/ffa';

const total = (rows: ReturnType<typeof hedgeStrip>) => rows.reduce((s, r) => s + r.tce, 0) * 30;

describe('lesson 4.1: lay-up, the floor and the choke', () => {
  it('lays up the oldest Capesizes below $6,000 and the newest below $1,500, under even a new ship’s running costs', () => {
    expect(OLDEST.layup).toBe(6_000);
    expect(OLDEST.name).toBe('20 years and over');
    expect(NEWEST.layup).toBe(1_500);
    expect(NEWEST.name).toBe('under 5 years');
    // The running-cost break-even of Lesson 2.4 is at least a ship's operating costs.
    expect(OLDEST.layup).toBeLessThan(classOpex('cape'));
  });

  it('makes the floor a two-step staircase', () => {
    expect(FLOOR_STEPS).toHaveLength(2);
    const [lower, upper] = FLOOR_STEPS;
    expect(upper.tce).toBeCloseTo(6_000, 0);
    expect(upper.cohort).toBe('20 years and over');
    expect(upper.from).toBeCloseTo(0.74, 9);
    expect(upper.to).toBeCloseTo(0.82, 9);
    expect(lower.tce).toBeCloseTo(4_500, 0);
    expect(lower.cohort).toBe('15–19 years');
    expect(lower.to).toBeCloseTo(0.72, 9);
  });

  it('sheds cargo past 128% while ships are still short of full speed, and keeps climbing steeply', () => {
    expect(CHOKE_EQ.tce).toBeGreaterThan(MARKET_CLASSES.cape.choke);
    expect(CHOKE_EQ.served).toBeLessThan(0.999);
    expect(CHOKE_EQ.ladenSpeed).toBeCloseTo(13.15, 1);
    expect(1 - TOP.served).toBeCloseTo(0.05, 2);
    expect(TOP.ladenSpeed).toBeLessThan(MARKET_CLASSES.cape.vMax - 0.4);
    expect(Math.round(SLOPE_HIGH / 100) * 100).toBe(1_400);
    expect(Math.round(SLOPE_LOW / 100) * 100).toBe(500);
  });
});

describe('lesson 4.2: weather costs the voyage-charter owner fuel', () => {
  it('shrinks her net, by the extra fuel, when three days are lost to weather', () => {
    const plan = PLANNED(VOYAGE);
    const a = voyageCharter(VOYAGE, START_FREIGHT, plan);
    const b = voyageCharter(VOYAGE, START_FREIGHT, { ...plan, weatherDays: 3 });
    expect(b.owner.net).toBeCloseTo(635_776, -1);
    expect(a.owner.net - b.owner.net).toBeCloseTo((b.fuel - a.fuel) * plan.bunker, 6);
  });
});

describe('lesson 4.3: trimming removes most of a biased broker’s lean', () => {
  it('leaves the trimmed, biased panel a little worse than the trimmed honest one', () => {
    expect(MISS.fiveBiasedTrim).toBeLessThan(MISS.fiveBiased);
    expect(MISS.fiveBiasedTrim).toBeGreaterThan(MISS.fiveTrim);
  });
});

describe('lesson 4.1, pass 2: predict the cargoes that double Heron’s rent', () => {
  const at = (n: number) => heronSurplus(n, D41.alternative, D41.bunker);

  it('starts unsolved, is solved by nine cargoes only, and only at the starting settings', () => {
    expect(SURPLUS6).toBeCloseTo(538_504, -1);
    expect(Math.round(SURPLUS6 / 1000) * 1000).toBe(539_000);
    expect(DOUBLE_N).toBe(9);
    expect(doubleSolved(D41.cargoes, D41.alternative, D41.bunker)).toBe(false);
    expect(doubleSolved(9, D41.alternative, D41.bunker)).toBe(true);
    for (const n of [7, 8, 10]) expect(doubleSolved(n, D41.alternative, D41.bunker)).toBe(false);
    expect(doubleSolved(9, 15_500, D41.bunker)).toBe(false);
    // Not a knife-edge: eight cargoes fall well short of double, nine clear it.
    expect(at(8) / SURPLUS6).toBeLessThan(1.9);
    expect(at(9) / SURPLUS6).toBeGreaterThan(2.15);
    expect(at(9)).toBeCloseTo(1_187_610, -1);
  });

  it('gives the same answer from the bars’ one-decimal labels', () => {
    const offers = [...offersAt(D41.alternative, D41.bunker)].sort((a, b) => a.reservation - b.reservation);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const heron = r1(offers.find((o) => o.ship.id === 'heron')!.reservation);
    const gap6 = r1(offers[5].reservation) - heron;
    const first = offers.findIndex((o) => r1(o.reservation) - heron >= 2 * gap6) + 1;
    expect(first).toBe(9);
    expect(marketAt(9, D41.alternative, D41.bunker).fixtures.at(-1)!.ship.ship.at).toBe('QIN');
  });

  it('makes Albatross the marginal ship at four cargoes, earning exactly her alternative', () => {
    expect(ALB_MARGINAL_N).toBe(4);
    expect(ALB_TCE_MARGINAL).toBeCloseTo(D41.alternative, 6);
    expect(ALB_TCE_BASE).toBeCloseTo(16_744, 0);
  });
});

describe('lesson 4.2, pass 2: predict the break-even freight from the shortfall', () => {
  const s = { contract: 'voyage' as const, freight: START_FREIGHT, hire: START_HIRE, bunker: 600, weather: 0, delay: 0, offHire: 0 };
  const set = { ...s, bunker: CHALLENGE_OUTCOME.bunker, weather: CHALLENGE_OUTCOME.weatherDays };

  it('quotes the shortfall, the cent’s worth and the split between fuel and hire', () => {
    expect(PER_CENT).toBeCloseTo(712.5, 6);
    expect(START_SHORTFALL).toBeCloseTo(272_075, -1);
    expect(START_FREIGHT + START_SHORTFALL / (100 * PER_CENT)).toBeCloseTo(BREAK_EVEN, 9);
    expect(BREAK_EVEN).toBeCloseTo(22.8486, 3);
    const plan = PLANNED(VOYAGE);
    const fuel = voyageCharter(VOYAGE, START_FREIGHT, CHALLENGE_OUTCOME).fuel * 800 - voyageCharter(VOYAGE, START_FREIGHT, plan).fuel * 600;
    const hire = timeCharter(VOYAGE, START_HIRE, CHALLENGE_OUTCOME).owner.net - timeCharter(VOYAGE, START_HIRE, plan).owner.net;
    expect(Math.round(fuel / (100 * PER_CENT) * 100) / 100).toBe(3.22);
    expect(Math.round(hire / (100 * PER_CENT) * 100) / 100).toBe(0.6);
    expect(Math.round((BREAK_EVEN - START_FREIGHT) * 100) / 100).toBe(3.82);
  });

  it('starts unsolved and accepts the break-even within two cents', () => {
    expect(FREIGHT_TOLERANCE).toBe(0.02);
    expect(matchSolved(s)).toBe(false);
    expect(outcomeSet(set)).toBe(true);
    expect(matchSolved(set)).toBe(false);
    for (const f of [22.83, 22.84, 22.85, 22.86]) expect(matchSolved({ ...set, freight: f })).toBe(true);
    for (const f of [22.82, 22.87, 22.5]) expect(matchSolved({ ...set, freight: f })).toBe(false);
    expect(matchSolved({ ...set, freight: 22.85, delay: 0.5 })).toBe(false);
  });
});

describe('lesson 4.3, pass 2: the panel and the weights in separate figures', () => {
  const kw = (fh: number, bh: number, ta = 0) => ({ 'P-TA': ta, 'P-FH': fh, 'P-TP': 0, 'P-BH': bh });

  it('reproduces the quoted panel statistics in the average-miss readout', () => {
    expect(panelMiss({ panelists: 5, error: 0.05, trim: false, biased: false })).toBe(MISS.five);
    expect(Math.round(MISS.five * 1000) / 10).toBe(1.9);
    expect(Math.round(MISS.one * 1000) / 10).toBe(4.1);
  });

  it('starts unsolved, solves at 60:55 and misses at 59:55 and 61:55', () => {
    expect(balancedSolved({ cls: 'kmax', day: START_DAY, weights: { 'P-TA': 20, 'P-FH': 20, 'P-TP': 20, 'P-BH': 20 } })).toBe(false);
    expect(balancedSolved({ cls: 'kmax', day: START_DAY, weights: kw(60, 55) })).toBe(true);
    expect(balancedSolved({ cls: 'kmax', day: START_DAY, weights: kw(59, 55) })).toBe(false);
    expect(balancedSolved({ cls: 'kmax', day: START_DAY, weights: kw(61, 55) })).toBe(false);
    expect(balancedSolved({ cls: 'kmax', day: START_DAY, weights: kw(60, 55, 1) })).toBe(false);
    expect(truthOnDay('kmax', START_DAY).routes[1]).toBeGreaterThan(truthOnDay('kmax', START_DAY).market);
  });
});

describe('lesson 4.4: the lag times the slump', () => {
  it('describes the model’s sliders in their own units', () => {
    expect(ORDERS_AT_10).toBeCloseTo(0.005, 9);
    expect(SCRAP_AT_QUARTER).toBeCloseTo(START.scrapResponse, 9);
    for (const m of BASE.months) if (m.q > 1) expect(m.orders / m.fleet).toBeCloseTo(START.orderResponse * (m.q - 1), 9);
  });

  it('traces the first wave: few orders after it, flat cargo, then a jump the fleet can’t meet', () => {
    expect(ORDERS_LOW_YEAR).toBe(5);
    const orders5 = BASE.months.slice(48, 60).reduce((s, m) => s + m.orders, 0);
    expect(orders5).toBeCloseTo(14.4, 0);
    expect(CARGO_FLAT).toBeLessThan(0.01);
    expect(BOOM_DROP).toBeCloseTo(0.41, 2);
    expect(NEXT_JUMP.year).toBe(7);
    expect(NEXT_JUMP.cargo).toBeGreaterThan(0.07);
    expect(NEXT_JUMP.fleet).toBeLessThan(0.005);
  });

  it('moves the slump after a single surge with the lag', () => {
    expect(SURGE_BASE.bestYear).toBe(2);
    expect(SURGE_BASE.worstYear).toBe(5);
    expect(SURGE).toMatchObject({ from: 6, to: 18 });
    expect(SURGE_ORDERS).toBeCloseTo(108, 0);
    expect(SURGE_TCE).toBeCloseTo(31_674, -1);
    expect(SURGE_BASE.orderPeak).toBe(SURGE.to - 1);
    expect(SURGE_BASE.deliveryPeak).toBe(47);
    expect(SURGE_YEAR_LAG.worstYear).toBe(4);
    expect(SURGE_FOUR_YEARS.worstYear).toBe(7);
    for (const lag of [6, 12, 24, 30, 36, 48]) {
      const r = runCycle({ ...SURGE_START, lag });
      expect(r.deliveryPeak).toBe(r.orderPeak + lag);
    }
    // The shock slider does nothing with the surge.
    expect(runCycle({ ...SURGE_START, shock: 0.12 })).toBe(SURGE_BASE);
  });

  it('has a challenge solved only by the surge with a 35–45-month lag, five clicks from the start', () => {
    expect(SOLVED_LAGS).toEqual(Array.from({ length: 11 }, (_, i) => 35 + i));
    expect(slumpTimedSolved({ ...SURGE_START, lag: START.lag + 1 })).toBe(false);
    expect(slumpTimedSolved({ ...SURGE_START, lag: 34 })).toBe(false);
    expect(slumpTimedSolved({ ...SURGE_START, lag: 46 })).toBe(false);
    expect(slumpTimedSolved({ ...SURGE_START, lag: 48 })).toBe(false);
    expect(slumpTimedSolved(START)).toBe(false);
    expect(slumpTimedSolved(SURGE_START)).toBe(false);
    expect(slumpTimedSolved({ ...SURGE_START, lag: 36 })).toBe(true);
    expect(slumpTimedSolved({ ...SURGE_START, lag: 36, shock: 0 })).toBe(true);
    expect(slumpTimedSolved({ ...START, lag: 36 })).toBe(false);
  });

  it('quotes the lag’s and trade growth’s effects on the random-shock run', () => {
    expect(LAG6.best / LAG6.worst).toBeCloseTo(1.8, 1);
    expect(BASE.best / BASE.worst).toBeCloseTo(2.1, 1);
    expect(LAG6.mean).toBeCloseTo(8_563, -1);
    expect(BASE.mean).toBeCloseTo(15_512, -1);
    expect(NO_GROWTH.mean).toBeCloseTo(11_223, -1);
    expect(FAST_GROWTH.mean).toBeCloseTo(24_410, -1);
  });
});

describe('lesson 4.5: forwards and a schedule Kestrel could sail', () => {
  it('quotes the index’s gap, the long-run range and April’s forward', () => {
    expect(EQUAL_GAP).toBeCloseTo(-0.013, 3);
    expect(LONG_RUN_LOW).toBe(10);
    expect(LONG_RUN_HIGH).toBe(3);
    expect(longRun('kmax', 10)).toBeCloseTo(11_881, -1);
    expect(longRun('kmax', 3)).toBeCloseTo(28_886, -1);
    const boom = ffaTrade(24 * 21, 3, 'sell', 30);
    expect(boom.price / dailyIndex('kmax')[24 * 21]).toBeCloseTo(2.1, 1);
  });

  it('pays about the round voyage’s earnings fronthauling and backhauling in turn, with a large basis', () => {
    const tp = hedgeStrip(54, 'P-TP', 1);
    const fh = hedgeStrip(54, 'P-FH', 1);
    const alt = hedgeStrip(54, ALTERNATE, 1);
    expect(total(fh)).toBeGreaterThan(1.5 * total(tp));
    expect(Math.abs(total(alt) / total(tp) - 1)).toBeLessThan(0.1);
    expect(missSpread(alt, true)).toBeLessThan(missSpread(alt, false));
    expect(missSpread(alt, true)).toBeGreaterThan(10 * missSpread(tp, true));
    // The round voyages and single trips are unchanged by the alternating option.
    expect(total(tp)).toBeCloseTo(3_482_571, -1);
    expect(total(fh)).toBeCloseTo(5_815_218, -1);
  });
});
