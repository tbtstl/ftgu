// Chapter 6 of the shipping course (the capstone): the numbers its prose quotes and the model
// fixes behind them — charters that pivot the exposure line (6.1), the freight explanations (6.2),
// canal costs and a fuel-consistent benchmark on the desk (6.3), and the tournament run as a
// what-if with charters rolled each year (6.5) — plus the challenges (predict, then check) and the
// company kept between lessons: part-scoped, confirmed resets and the starting/yours switch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cargoOffers, marketFuelPerDay, marketTceAt, operate, planFixture, shipCost, type CompanyShip } from '../src/engines/shipping/company';
import { seaRoute } from '../src/engines/shipping/network';
import { NEUTRAL_DRIVERS, drivenEarnings, periodHire, runStrategy, DEFAULT_TOURNAMENT } from '../src/engines/shipping/tournament';
import { ladenDraft } from '../src/engines/shipping/voyage';
import { standardHistory } from '../src/model/shipping/history';
import { MARKET_CLASSES, OFF_HIRE_DAYS, ROUTES } from '../src/model/shipping/trades';
import { EQUITY_BUDGET, START_MONTH, STARTING, confirmReset, defaultDesign, getCompany, money, partChanged, resetCompany, updateCompany, worldFieldsChanged } from '../src/lessons/shipping/shared/company';
import { fleetText, policyText, worldText } from '../src/lessons/shipping/shared/CompanyUi';
import {
  BE_PLUS_K,
  OLD20_OPEX_SHARE,
  PIVOT_K,
  YOUNG5_DEBT_SHARE,
  breakEvenMultiple,
  fleetSolved,
  fleetStats,
  historyYears,
  marketAt,
  newShip,
  withCharter,
  withoutLastCharter,
} from '../src/lessons/shipping/ch6/L6_1';
import Lesson61 from '../src/lessons/shipping/ch6/L6_1';
import Lesson63 from '../src/lessons/shipping/ch6/L6_3';
import Lesson64 from '../src/lessons/shipping/ch6/L6_4';
import Lesson62 from '../src/lessons/shipping/ch6/L6_2';
import Lesson65 from '../src/lessons/shipping/ch6/L6_5';
import { ATLANTIC0, LONGEST_SOY, ROUND_RATIO, SOY_MIN_WEEKS, SOY_TARGET, W0, expectedSoyShare, longestSoyWindow, soySolved } from '../src/lessons/shipping/ch6/L6_2';
import {
  ESTIMATE_DEFAULT,
  KESTREL_COAL,
  KESTREL_SANTOS,
  START_BUNKER,
  brazilCrossover,
  companyFor,
  estimateSolved,
  fuelPerVoyageDay,
  goesToBrazilAt,
} from '../src/lessons/shipping/ch6/L6_3';
import { NEEDED, SCENARIOS, WORKED, bandOf, classScored, forecastSolved, scenarioResult, scenarioScored, type Pair, type ScenarioId } from '../src/lessons/shipping/ch6/L6_4';
import { FAST_YARDS, NO_SEASON, STEADY, VIEW_DEFAULTS, WORLD_NAMES, fleetFor, onlyCharterOutPays, optionsOf, quotedResults, tournament, worlds } from '../src/lessons/shipping/ch6/L6_5';
import { WORLDS as WORLDS55 } from '../src/lessons/shipping/ch5/L5_5';

const H = standardHistory();
const EARN = (365 - OFF_HIRE_DAYS) / 365;
const START = defaultDesign();
type Design = ReturnType<typeof defaultDesign>;
const add = (d: Design, ...o: Array<['kmax' | 'cape', 'owned' | 'chartered', number]>): Design =>
  o.reduce((x, [cls, mode, age]) => ({ ...x, ships: [...x.ships, newShip(x, cls, mode, age, 'QIN')] }), d);

describe('lesson 6.1: charters pivot the exposure line', () => {
  it('prices this month’s charters below spot, so a charter lowers the starting break-even', () => {
    const hk = periodHire('kmax', H, START_MONTH);
    const hc = periodHire('cape', H, START_MONTH);
    expect(hk).toBeCloseTo(9_454, -1);
    expect(hc).toBeCloseTo(13_914, -1);
    // Per earning day, both hires are below what the class earns in July of Year 9.
    expect(hk / EARN).toBeLessThan(marketAt('kmax', START_MONTH));
    expect(hc / EARN).toBeLessThan(marketAt('cape', START_MONTH));
    expect(PIVOT_K).toBeCloseTo(0.875, 2);
    expect(breakEvenMultiple(START)).toBeCloseTo(1.157, 2);
    expect(BE_PLUS_K).toBeCloseTo(1.074, 2);
    expect(BE_PLUS_K).toBeLessThan(breakEvenMultiple(START));
  });

  it('raises the break-even only when the charter’s pivot lies above it', () => {
    const dear: CompanyShip = { ...newShip(START, 'kmax', 'chartered', 10, 'QIN'), hire: 1.3 * marketAt('kmax', START_MONTH) * EARN };
    expect(breakEvenMultiple({ ...START, ships: [...START.ships, dear] })).toBeGreaterThan(breakEvenMultiple(START));
    const justAbove: CompanyShip = { ...dear, hire: 1.05 * marketAt('kmax', START_MONTH) * EARN };
    expect(breakEvenMultiple({ ...START, ships: [...START.ships, justAbove] })).toBeLessThan(breakEvenMultiple(START));
  });

  it('splits the old and young ships’ cash costs as the prose says', () => {
    expect(OLD20_OPEX_SHARE).toBeCloseTo(0.886, 2);
    expect(YOUNG5_DEBT_SHARE).toBeCloseTo(0.403, 2);
    const noDebt = { ...START, finance: { ...START.finance, ltv: 0 } };
    expect(fleetStats(noDebt).equity).toBeCloseTo(65.1e6, -5);
    expect(fleetStats(noDebt).equity).toBeGreaterThan(EQUITY_BUDGET);
  });

  it('draws the full-cost line above the cash break-even, with depreciation and a return', () => {
    for (const s of START.ships) {
      const c = shipCost(s, START.finance);
      expect(c.fullBreakeven).toBeGreaterThan(c.cashBreakeven);
    }
    // Year 12 of the history runs past 2.5×, so the exposure axis has to reach it.
    expect(Math.max(...historyYears(START).map((y) => y.mult))).toBeCloseTo(2.52, 2);
  });

  it('still accepts the challenge’s charter solutions', () => {
    expect(fleetSolved(add(START, ['cape', 'chartered', 10], ['cape', 'chartered', 10], ['kmax', 'chartered', 10], ['kmax', 'chartered', 10]))).toBe(true);
  });
});

describe('lesson 6.2: what the freights pay for', () => {
  it('loads about a quarter of the starting book in the Atlantic', () => {
    expect(ATLANTIC0).toBeCloseTo(0.274, 2);
  });

  it('pays for a round trip about three times as long from Tubarão as from Port Hedland', () => {
    expect(ROUND_RATIO).toBeGreaterThan(2.5);
    expect(ROUND_RATIO).toBeLessThan(3.5);
  });

  it('sends New Orleans grain on a shorter haul and a shorter ballast leg than Santos soybeans, at about the same freight', () => {
    const v = MARKET_CLASSES.kmax.vessel;
    const cargo = MARKET_CLASSES.kmax.cargo;
    const nol = seaRoute('NOL', 'QIN', { draft: ladenDraft(v, cargo) })!;
    const san = seaRoute('SAN', 'QIN', { draft: ladenDraft(v, cargo) })!;
    expect(nol.nm).toBeLessThan(san.nm);
    expect(nol.chokepoints).toContain('panama');
    expect(nol.canalDays).toBe(1);
    expect(seaRoute('QIN', 'NOL')!.nm).toBeLessThan(seaRoute('QIN', 'SAN')!.nm);
    const f = H.cls.kmax[99].freights;
    expect(Math.abs(f['P-NOL-QIN'] / f['P-SAN-QIN'] - 1)).toBeLessThan(0.05);
    expect(MARKET_CLASSES.kmax.canalTolls.panama).toBe(200_000);
  });
});

describe('lesson 6.3: canals and a fuel-consistent benchmark', () => {
  const nolOffer = () => {
    const route = ROUTES.find((r) => r.id === 'P-NOL-QIN')!;
    return { id: 'x', route, cls: 'kmax' as const, from: 0, to: 7, tonnes: MARKET_CLASSES.kmax.cargo, freight: 30 };
  };
  const ship = (): CompanyShip => ({ ...START.ships[0], at: 'NOL' });
  const toll = (start: number) => {
    const fx = planFixture(ship(), 'NOL', 0, nolOffer(), START.policy, H, start)!;
    const c = nolOffer();
    return c.freight * c.tonnes * 0.95 - fx.fuel * H.bunker[start] - MARKET_CLASSES.kmax.portCosts - fx.net;
  };

  it('charges the Panama toll and a canal day when the canal is open, and Suez’s when it is shut', () => {
    expect(toll(96)).toBeCloseTo(MARKET_CLASSES.kmax.canalTolls.panama, 0);
    // Months 100–105 of the history are the Panama drought: the cargo goes by Suez.
    expect(toll(102)).toBeCloseTo(MARKET_CLASSES.kmax.canalTolls.suez, 0);
    const fx = planFixture(ship(), 'NOL', 0, nolOffer(), START.policy, H, 102)!;
    const laden = seaRoute('NOL', 'QIN', { draft: ladenDraft(MARKET_CLASSES.kmax.vessel, MARKET_CLASSES.kmax.cargo), closed: ['panama'] })!;
    expect(laden.chokepoints).toContain('suez');
    expect(laden.chokepoints).not.toContain('panama');
    expect(fx.end - fx.load - nolOffer().route.portDays - laden.nm / (24 * START.policy.speed)).toBeCloseTo(laden.canalDays, 6);
  });

  it('re-prices the market’s fuel when the bunker price is fixed', () => {
    const m = H.cls.kmax[START_MONTH];
    expect(marketTceAt('kmax', H, START_MONTH)).toBe(m.tce);
    expect(marketTceAt('kmax', H, START_MONTH, m.bunker)).toBe(m.tce);
    const perDay = marketFuelPerDay('kmax', m, START_MONTH);
    expect(perDay).toBeGreaterThan(10);
    expect(perDay).toBeLessThan(40);
    expect(marketTceAt('kmax', H, START_MONTH, 900)).toBeCloseTo(m.tce - (900 - m.bunker) * perDay, 6);
  });

  it('keeps the starting benchmark, and puts the $900 desk against a $900 market', () => {
    const offers = cargoOffers(START.world);
    const run = (p: Partial<typeof START.policy>) => operate(START.ships, offers, { ...START.policy, ...p }, START.finance, START.world);
    const base = run({});
    expect(base.profit - base.benchmark).toBeCloseTo(1_050_165, -1);
    const shock = run({ bunker: 900 });
    expect(shock.benchmark).toBeLessThan(base.benchmark - 3e6);
    expect(shock.profit - shock.benchmark).toBeCloseTo(33_063, -2);
    const slow = run({ bunker: 900, speed: 9 });
    expect(slow.profit - slow.benchmark).toBeCloseTo(1_260_782, -2);
  });
});

describe('lesson 6.4: about three times the shock', () => {
  it('moves earnings by about three times a 6% change in ships or sea time', () => {
    for (const id of ['deliveries', 'storms'] as const)
      for (const cls of ['cape', 'kmax'] as const) {
        const x = Math.abs(scenarioResult(id)[cls].effect) / 0.06;
        expect(x).toBeGreaterThan(2.5);
        expect(x).toBeLessThan(3.6);
      }
  });
});

describe('lesson 6.5: the tournament as a what-if', () => {
  const full = optionsOf(VIEW_DEFAULTS);

  it('keeps the Year 6 mine disruption under every dial', () => {
    const avg = (xs: number[]) => xs.slice(64, 72).reduce((a, b) => a + b, 0) / 8;
    const neutral = drivenEarnings(H, NEUTRAL_DRIVERS).cape;
    const queue = drivenEarnings(H, { ...NEUTRAL_DRIVERS, congestion: 0.5 }).cape;
    expect(avg(queue) / avg(neutral)).toBeLessThan(1.1);
    // Brazil's ore at 70% during a disruption that already cut it to 60% leaves 42%, not 70%.
    const weakOre = drivenEarnings(H, { ...NEUTRAL_DRIVERS, ore: 0.7 }).cape;
    for (let t = 64; t < 72; t++) expect(weakOre[t]).toBeLessThanOrEqual(neutral[t] + 1e-6);
  });

  it('recharters chartered ships every twelve months at that year’s hire', () => {
    const cape = newShip(START, 'cape', 'chartered', 10, 'QIN');
    const a = runStrategy('spot', [cape], START.finance, H, NEUTRAL_DRIVERS, DEFAULT_TOURNAMENT);
    const b = runStrategy('spot', [{ ...cape, hire: 1 }], START.finance, H, NEUTRAL_DRIVERS, DEFAULT_TOURNAMENT);
    expect(a.total).toBeCloseTo(b.total, 6);
    const month0 = (H.cls.cape[0].tce * EARN - periodHire('cape', H, 0)) * (365 / 12);
    expect(a.monthly[0]).toBeCloseTo(month0, 3);
    const month30 = (H.cls.cape[30].tce * EARN - periodHire('cape', H, 24)) * (365 / 12);
    expect(a.monthly[30]).toBeCloseTo(month30, 3);
    // Two chartered Capesizes no longer turn twelve years of slump hire into a windfall.
    const two = add({ ...START, finance: { ...START.finance, ltv: 0.4 } }, ['cape', 'chartered', 10], ['cape', 'chartered', 10]);
    expect(tournament(two.ships, two.finance, NEUTRAL_DRIVERS, full)[0].total).toBeCloseTo(27.46e6, -4);
  });

  it('quotes the starting company’s tournament', () => {
    const q = quotedResults();
    const n = q.neutral;
    expect(n.spot.total).toBeCloseTo(22.61e6, -4);
    expect(n.charterOut.total).toBeCloseTo(19.99e6, -4);
    expect(n.charterIn.total).toBeCloseTo(31.95e6, -4);
    expect(n.reposition.total).toBeCloseTo(27.34e6, -4);
    expect(n.hedge.total).toBeCloseTo(23.85e6, -4);
    // Charter in makes the most, with the deepest drawdown; FFAs are a little shallower than spot.
    expect(Math.max(...Object.values(n).map((r) => r.total))).toBe(n.charterIn.total);
    expect(Math.max(...Object.values(n).map((r) => r.maxDrawdown))).toBe(n.charterIn.maxDrawdown);
    expect(n.hedge.maxDrawdown).toBeLessThan(n.spot.maxDrawdown);
    // Chartering out has the highest Sharpe ratio.
    expect(Math.max(...Object.values(n).map((r) => r.summary.sharpe))).toBe(n.charterOut.summary.sharpe);
    expect(n.charterOut.summary.sharpe).toBeCloseTo(1.42, 2);
    expect(n.spot.summary.sharpe).toBeCloseTo(0.99, 2);
    // From Year 9.
    expect(q.fromYear9.spot.total).toBeCloseTo(10.94e6, -4);
    expect(q.fromYear9.charterOut.total).toBeCloseTo(5.47e6, -4);
  });

  it('breaks each strategy with its dial', () => {
    const q = quotedResults();
    expect(q.weakSoy.reposition.total).toBeCloseTo(q.weakSoy.spot.total, 6);
    expect(q.weakSoy.spot.total).toBeCloseTo(-4.24e6, -4);
    expect(q.moreShips.charterIn.total).toBeCloseTo(-12.08e6, -4);
    expect(q.moreShips.spot.total).toBeCloseTo(-3.68e6, -4);
    expect(q.moreShips.reposition.total).toBeGreaterThan(q.moreShips.spot.total);
    expect(q.moreShips.reposition.total).toBeCloseTo(0.24e6, -4);
    expect(q.panama.spot.total).toBeCloseTo(35.06e6, -4);
    expect(q.weakOre.spot.total).toBeCloseTo(-17.03e6, -4);
    expect(q.strongSoy.spot.total).toBeCloseTo(74.15e6, -4);
    for (const k of ['weakSoy', 'strongSoy', 'moreShips', 'panama', 'weakOre'] as const) expect(q[k].charterOut.total).toBeCloseTo(q.neutral.charterOut.total, 6);
  });

  it('separates luck from skill across the worlds', () => {
    const q = quotedResults();
    expect(q.beat).toEqual({ charterOut: 9, charterIn: 12, reposition: 13, hedge: 14 });
    // Repositioning trails only where there is no harvest season, and only a little.
    q.repositionLead.forEach((x, i) => (i === NO_SEASON ? expect(x).toBeLessThan(0) : expect(x).toBeGreaterThan(0)));
    expect(q.repositionLead[NO_SEASON]).toBeCloseTo(-0.2e6, -4);
    expect(q.charterInRange.best).toBeCloseTo(14.15e6, -4);
    expect(q.charterInRange.worst).toBeCloseTo(-2.62e6, -4);
    // Where shipyards deliver in a year, every strategy loses and chartering in loses least.
    const fast = Object.fromEntries(Object.entries(q.worlds).map(([k, xs]) => [k, xs[FAST_YARDS]]));
    expect(Object.values(fast).every((x) => x < 0)).toBe(true);
    expect(Math.max(...Object.values(fast))).toBe(fast.charterIn);
    expect(q.charterInLead[FAST_YARDS]).toBeCloseTo(11.63e6, -4);
  });

  it('scores the challenge on the ships Northwind owns', () => {
    expect(onlyCharterOutPays(START.ships, START.finance, NEUTRAL_DRIVERS, full)).toBe(false);
    expect(onlyCharterOutPays(START.ships, START.finance, { ...NEUTRAL_DRIVERS, ore: 0.6 }, full)).toBe(true);
    // A 6.1 solution with two chartered Capesizes: unsolved as it stands, solvable on its owned ships.
    const two = add({ ...START, finance: { ...START.finance, ltv: 0.4 } }, ['cape', 'chartered', 10], ['cape', 'chartered', 10]);
    expect(fleetSolved(two)).toBe(true);
    expect(onlyCharterOutPays(two.ships, two.finance, NEUTRAL_DRIVERS, full)).toBe(false);
    expect(onlyCharterOutPays(two.ships, two.finance, { ...NEUTRAL_DRIVERS, ore: 0.5, soy: 0.5 }, full)).toBe(true);
    // Four charters on a 60% loan share: the owned ships are the starting company's.
    const four = add(START, ['cape', 'chartered', 10], ['cape', 'chartered', 10], ['kmax', 'chartered', 10], ['kmax', 'chartered', 10]);
    expect(onlyCharterOutPays(four.ships, four.finance, { ...NEUTRAL_DRIVERS, ore: 0.6 }, full)).toBe(true);
    // No owned ships, nothing to charter out.
    expect(onlyCharterOutPays(four.ships.filter((s) => s.mode === 'chartered'), four.finance, { ...NEUTRAL_DRIVERS, ore: 0.5 }, full)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: the company carried between lessons, the redesigned challenges and the figures.

describe('the company kept between lessons', () => {
  it('knows which parts the reader has changed', () => {
    expect((['ships', 'world', 'policy', 'drivers'] as const).some((p) => partChanged(START, p))).toBe(false);
    const moved = { ...START, world: { ...START.world, start: 98, weeks: 25 } };
    expect(partChanged(moved, 'world')).toBe(true);
    expect(partChanged(moved, 'ships')).toBe(false);
    expect(worldFieldsChanged(moved, ['start', 'weeks', 'reach'])).toBe(true);
    expect(worldFieldsChanged(moved, ['routeScale'])).toBe(false);
    expect(partChanged({ ...START, finance: { ...START.finance, ltv: 0.4 } }, 'ships')).toBe(true);
  });

  it('asks before resetting a changed part, and never resets one without an answer', () => {
    const ask = vi.spyOn(window, 'confirm');
    // Nothing to ask when the part is already at the start.
    expect(confirmReset('your fleet', false)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    ask.mockReturnValueOnce(false);
    expect(confirmReset('your fleet', true)).toBe(false);
    ask.mockReturnValueOnce(true);
    expect(confirmReset('your fleet', true)).toBe(true);
    ask.mockRestore();
  });

  it('formats sums one way through the chapter', () => {
    expect(money(819_340)).toBe('$0.82m');
    expect(money(-819_340)).toBe('−$0.82m');
    expect(money(22.61e6)).toBe('$22.6m');
    expect(money(EQUITY_BUDGET, 0)).toBe('$60m');
    expect(money(-1)).toBe('$0.00m');
  });

  it('sums up the company so far', () => {
    expect(fleetText(START)).toBe('Kestrel and Albatross (1 Kamsarmax and 1 Capesize; all owned), 60% loans');
    expect(worldText(START)).toBe('26 weeks from July of Year 9, brokers reaching 2% of cargoes');
    expect(policyText(START)).toBe('best TCE at 12 knots');
    expect(policyText({ ...START, policy: { ...START.policy, bunker: 900, minTce: 8000 } })).toBe('best TCE at 12 knots, a $8,000/day minimum, bunkers fixed at $900/t');
  });
});

describe('lesson 6.1: the fleet is priced in July of Year 9, whatever window 6.2 chose', () => {
  it('keeps the fleet’s economics when the trading window moves', () => {
    const moved = { ...START, world: { ...START.world, start: 98 } };
    expect(fleetStats(moved).margin).toBeCloseTo(fleetStats(START).margin, 9);
    expect(breakEvenMultiple(moved)).toBeCloseTo(breakEvenMultiple(START), 9);
    expect(newShip(moved, 'kmax', 'chartered', 10, 'QIN').hire).toBeCloseTo(periodHire('kmax', H, START_MONTH), 6);
  });

  it('charters in and returns ships from the exposure figure', () => {
    const one = withCharter(START, 'kmax');
    expect(one.ships).toHaveLength(3);
    expect(breakEvenMultiple(one)).toBeCloseTo(BE_PLUS_K, 9);
    expect(withoutLastCharter(one).ships.map((s) => s.id)).toEqual(START.ships.map((s) => s.id));
    // Nothing chartered: nothing to return.
    expect(withoutLastCharter(START)).toBe(START);
    // Below her pivot, a charter raises the break-even instead: a fleet with no loans.
    const noLoans = { ...START, finance: { ...START.finance, ltv: 0 } };
    expect(breakEvenMultiple(noLoans)).toBeLessThan(PIVOT_K);
    expect(breakEvenMultiple(withCharter(noLoans, 'kmax'))).toBeGreaterThan(breakEvenMultiple(noLoans));
  });
});

describe('lesson 6.2: the longest harvest window', () => {
  it('is 25 weeks, from a March, and the challenge accepts a week less', () => {
    const longest = longestSoyWindow();
    expect(longest.weeks).toBe(LONGEST_SOY.weeks);
    expect(new Set(longest.starts.map((t) => t % 12))).toEqual(new Set([LONGEST_SOY.month]));
    expect(SOY_MIN_WEEKS).toBe(24);
  });

  it('starts unsolved and needs the season, a long window and normal exports', () => {
    expect(soySolved(W0)).toBe(false);
    // March of Year 9: 25 weeks qualify (25.1%), 26 don't (24.9%).
    expect(expectedSoyShare({ ...W0, start: 98, weeks: 25 })).toBeGreaterThan(SOY_TARGET);
    expect(expectedSoyShare({ ...W0, start: 98, weeks: 26 })).toBeLessThan(SOY_TARGET);
    expect(soySolved({ ...W0, start: 98, weeks: 25 })).toBe(true);
    expect(soySolved({ ...W0, start: 98, weeks: 24 })).toBe(true);
    expect(soySolved({ ...W0, start: 98, weeks: 26 })).toBe(false);
    // Short windows qualify but aren't the longest; February and April can't stretch to 24 weeks.
    expect(expectedSoyShare({ ...W0, start: 99, weeks: 13 })).toBeGreaterThan(SOY_TARGET);
    expect(soySolved({ ...W0, start: 99, weeks: 13 })).toBe(false);
    expect(soySolved({ ...W0, start: 97, weeks: 24 })).toBe(false);
    expect(soySolved({ ...W0, start: 99, weeks: 24 })).toBe(false);
    // The harvest has to do the work.
    expect(soySolved({ ...W0, start: 98, weeks: 25, routeScale: { 'P-SAN-QIN': 1.05 } })).toBe(false);
  });
});

describe('lesson 6.3: when the TCE rule stops sending Kestrel to Brazil', () => {
  it('quotes the two voyages the reader estimates from', () => {
    expect(START_BUNKER).toBeCloseTo(380, 0);
    expect(KESTREL_SANTOS.cargo.route.id).toBe('P-SAN-QIN');
    expect(KESTREL_SANTOS.tce).toBeCloseTo(11_559, 0);
    expect(KESTREL_SANTOS.end - KESTREL_SANTOS.depart).toBeCloseTo(86.7, 1);
    expect(KESTREL_SANTOS.fuel).toBeCloseTo(1_578, 0);
    expect(fuelPerVoyageDay(KESTREL_SANTOS)).toBeCloseTo(18.2, 1);
    expect(KESTREL_COAL.cargo.route.id).toBe('P-SAM-QIN');
    expect(KESTREL_COAL.tce).toBeCloseTo(7_867, 0);
    expect(KESTREL_COAL.end - KESTREL_COAL.depart).toBeCloseTo(31.3, 1);
    expect(KESTREL_COAL.fuel).toBeCloseTo(371, 0);
    expect(fuelPerVoyageDay(KESTREL_COAL)).toBeCloseTo(11.9, 1);
  });

  it('switches at $964, where the straight-line estimate from those numbers lands', () => {
    expect(brazilCrossover()).toBe(964);
    const linear = START_BUNKER + (KESTREL_SANTOS.tce - KESTREL_COAL.tce) / (fuelPerVoyageDay(KESTREL_SANTOS) - fuelPerVoyageDay(KESTREL_COAL));
    expect(Math.abs(linear - brazilCrossover())).toBeLessThan(5);
    expect(goesToBrazilAt(960)).toBe(true);
    expect(goesToBrazilAt(970)).toBe(false);
  });

  it('scores an estimate within $50 and nothing else', () => {
    expect(estimateSolved(null)).toBe(false);
    expect(estimateSolved(ESTIMATE_DEFAULT)).toBe(false);
    for (const x of [920, 960, 970, 1010]) expect(estimateSolved(x)).toBe(true);
    for (const x of [380, 900, 910, 1020, 1100]) expect(estimateSolved(x)).toBe(false);
  });

  it('runs the starting company with the reader’s policy, or the reader’s company', () => {
    const mine = { ...withCharter(START, 'cape'), world: { ...START.world, start: 98 }, policy: { ...START.policy, speed: 10 } };
    const start = companyFor(mine, 'start');
    expect(start.ships).toEqual(STARTING.ships);
    expect(start.world).toEqual(STARTING.world);
    expect(start.policy.speed).toBe(10);
    expect(companyFor(mine, 'yours')).toBe(mine);
  });
});

describe('lesson 6.4: forecasting the change the news makes', () => {
  const at = (cape: number, kmax: number): Pair => ({ cape, kmax });
  // The rule of thumb the prose gives before the challenge: about three times the change in work or ships.
  const RULE: Partial<Record<ScenarioId, Pair>> & Record<'panama' | 'deliveries' | 'steel' | 'storms', Pair> = { panama: at(0, 0.2), deliveries: at(-0.18, -0.18), steel: at(-0.4, 0), storms: at(0.18, 0.18) };

  it('starts unsolved: no change scores nowhere the news reaches', () => {
    for (const s of SCENARIOS) if (s.id !== WORKED) expect(scenarioScored(s.id, at(0, 0))).toBe(false);
    expect(forecastSolved({})).toBe(false);
  });

  it('scores the two questions: which class, and about how far', () => {
    for (const [id, f] of Object.entries(RULE) as Array<[ScenarioId, Pair]>) expect(scenarioScored(id, f)).toBe(true);
    // Right size, wrong class.
    expect(scenarioScored('steel', at(-0.4, -0.1))).toBe(false);
    expect(scenarioScored('panama', at(0.2, 0.2))).toBe(false);
    // Right class, the size of the shock itself rather than of its effect.
    expect(scenarioScored('steel', at(-0.15, 0))).toBe(false);
    expect(scenarioScored('storms', at(0.06, 0.06))).toBe(false);
    expect(scenarioScored('deliveries', at(-0.1, -0.1))).toBe(false);
    // The band: 5 points, or a third of the change.
    expect(bandOf(0)).toBe(0.05);
    expect(bandOf(scenarioResult('steel').cape.effect)).toBeCloseTo(0.13, 2);
    expect(classScored('steel', 'kmax', 0.04)).toBe(true);
    expect(classScored('steel', 'kmax', 0.06)).toBe(false);
  });

  it('needs three of the four scenarios after the cyclone', () => {
    expect(NEEDED).toBe(3);
    const cyclone = at(-0.09, 0);
    expect(scenarioScored('cyclone', cyclone)).toBe(true);
    expect(forecastSolved({ cyclone, panama: RULE.panama, steel: RULE.steel })).toBe(false);
    expect(forecastSolved({ panama: RULE.panama, steel: RULE.steel, storms: at(0, 0) })).toBe(false);
    expect(forecastSolved({ deliveries: RULE.deliveries, steel: RULE.steel, storms: RULE.storms })).toBe(true);
  });
});

describe('lesson 6.5: the same fourteen worlds as Lesson 5.5', () => {
  it('runs 5.5’s worlds', () => {
    expect(WORLD_NAMES).toHaveLength(WORLDS55.length);
    expect(worlds()).toHaveLength(14);
    expect(WORLDS55.slice(1).map((w) => w.overrides)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => ({ seed: i + 1 })),
      { seasonal: false },
      { lag: 12 },
      { shock: 0.03 },
    ]);
    expect([NO_SEASON, FAST_YARDS, STEADY]).toEqual([11, 12, 13]);
    expect(WORLD_NAMES[STEADY]).toBe('Steadier cargo demand');
  });

  it('runs the starting fleet or the reader’s', () => {
    const mine = withCharter(START, 'cape');
    expect(fleetFor(mine, 'start').ships).toEqual(STARTING.ships);
    expect(fleetFor(mine, 'yours').ships).toBe(mine.ships);
    expect(VIEW_DEFAULTS.company).toBe('start');
  });
});

describe('the lessons with a company carried over', () => {
  afterEach(() => {
    cleanup();
    resetCompany();
  });
  const buttonNamed = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

  it('6.1’s Reset asks first and touches only the fleet', async () => {
    updateCompany((d) => ({ ...withCharter(d, 'cape'), world: { ...d.world, start: 98 } }));
    const view = render(createElement(Lesson61));
    const reset = buttonNamed(view.container, 'Reset')!;
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await act(async () => fireEvent.click(reset));
    expect(getCompany().ships).toHaveLength(3);
    ask.mockReturnValueOnce(true);
    await act(async () => fireEvent.click(reset));
    expect(getCompany().ships).toHaveLength(2);
    // The cargo window belongs to Lesson 6.2: untouched.
    expect(getCompany().world.start).toBe(98);
    ask.mockRestore();
  });

  it('6.3 runs the starting company until asked to run yours', async () => {
    updateCompany((d) => withCharter(withCharter(d, 'cape'), 'kmax'));
    const view = render(createElement(Lesson63));
    const desk = view.container.querySelector('figure[aria-label="Fleet Operations Desk"]')!;
    const rows = () => (desk.querySelector('svg.chart')!.getAttribute('aria-label') ?? '').split('. ').filter((x) => /^(Kestrel|Albatross|Tern|Gannet)/.test(x)).length;
    expect(buttonNamed(desk as HTMLElement, 'Starting company')).toBeTruthy();
    expect(rows()).toBe(2);
    await act(async () => fireEvent.click(buttonNamed(desk as HTMLElement, 'Your company')!));
    expect(rows()).toBe(4);
    // The fleet itself is never changed by the switch.
    expect(getCompany().ships).toHaveLength(4);
  });

  it('renders every lesson with a changed company, switches and all, without errors', async () => {
    for (const L of [Lesson61, Lesson62, Lesson63, Lesson64, Lesson65]) {
      updateCompany((d) => ({
        ...withCharter(withCharter(d, 'cape'), 'kmax'),
        world: { ...d.world, start: 98, weeks: 25, routeScale: { 'C-TUB-QIN': 1.5, 'C-TUB-ROT': 1.5 } },
        policy: { ...d.policy, speed: 11, bunker: 700 },
        drivers: { ...d.drivers, ore: 0.8 },
      }));
      const view = render(createElement(L));
      // Every switch is there, and every segmented button and slider can be moved.
      for (const button of Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button'))) await act(async () => fireEvent.click(button));
      for (const input of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
        if (input.disabled) continue;
        await act(async () => {
          fireEvent.change(input, { target: { value: input.max } });
          fireEvent.change(input, { target: { value: input.min } });
        });
      }
      cleanup();
      resetCompany();
    }
  });

  it('6.4 keeps a locked forecast locked through the figure’s Reset', async () => {
    const view = render(createElement(Lesson64));
    const fig = view.container.querySelector('figure[aria-label="Freight Market Forecast Challenge"]') as HTMLElement;
    await act(async () => fireEvent.click(buttonNamed(fig, 'Steel cut')!));
    const box = fig.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => fireEvent.click(box));
    const status = () => view.container.querySelector('.chal-s')!.textContent ?? '';
    expect(status()).toMatch(/0 of 1 locked-in scenario scored/);
    await act(async () => fireEvent.click(buttonNamed(fig, 'Reset')!));
    expect(status()).toMatch(/0 of 1 locked-in scenario scored/);
  });
});
