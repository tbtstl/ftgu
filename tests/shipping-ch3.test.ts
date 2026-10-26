// Chapter 3 of the shipping course: the numbers its prose quotes and the behavior of its figures.
import { describe, expect, it } from 'vitest';
import { fmt, pct } from '../src/framework';
import { HISTORY_EVENTS } from '../src/model/shipping/history';
import { FARTHEST_FROM_QINGDAO, SPEED as SPEED31, farthestSolved, passageDays, pickPort, routeBetween, tradeRows } from '../src/lessons/shipping/ch3/L3_1';
import { CHALLENGE as CH32, CV, DEF as DEF32, LOST, LOST_START_WAIT, MAX_BERTHS, fewestBerthsSolved, serviceDays, shipsNeeded } from '../src/lessons/shipping/ch3/L3_2';
import { ARRIVALS_LIMIT, CHALLENGE_DAYS, CUT_SLOTS, DETOUR_DAYS, canalState, extraShips, slotCutSolved, tradeStatus } from '../src/lessons/shipping/ch3/L3_3';
import {
  ALB_NEW_12,
  DAY_VALUE,
  FULMAR_NEW_12,
  GANNET_NEW_12,
  SHIPS,
  START_PLAN,
  ballasters,
  cheapestPlan,
  cheapestSolved,
  idleNote,
  planCost,
  reachableCargoes,
  type Plan,
} from '../src/lessons/shipping/ch3/L3_4';
import { BASE_MT, QIN_TONNES, capeNeeds, eventEffect, flowVolumes, sourcingSolved } from '../src/lessons/shipping/ch3/L3_5';
import { MARKET_CLASSES, OFF_HIRE_DAYS } from '../src/model/shipping/trades';
import type { Chokepoint } from '../src/model/shipping/geo';

describe('shipping 3.1', () => {
  it('sets the origin on the first click, then the destination', () => {
    let s = pickPort({ from: 'TUB', to: 'QIN', setting: 'from' }, 'PHE');
    expect(s).toEqual({ from: 'PHE', to: 'QIN', setting: 'to' });
    s = pickPort(s, 'NOL');
    expect(s).toEqual({ from: 'PHE', to: 'NOL', setting: 'to' });
    s = pickPort(s, 'SAN');
    expect(s).toEqual({ from: 'PHE', to: 'SAN', setting: 'to' });
    // Clicking the other end swaps the voyage.
    expect(pickPort({ from: 'PHE', to: 'SAN', setting: 'to' }, 'PHE')).toEqual({ from: 'SAN', to: 'PHE', setting: 'to' });
    expect(pickPort({ from: 'PHE', to: 'SAN', setting: 'from' }, 'SAN')).toEqual({ from: 'SAN', to: 'PHE', setting: 'to' });
  });

  it('quotes Brazil’s ore to China as 2.9 times as far, 26% of the tonnes and 50% of the laden days', () => {
    const cape = tradeRows('cape');
    const c3 = cape.find((r) => r.id === 'C-TUB-QIN')!;
    const c5 = cape.find((r) => r.id === 'C-PHE-QIN')!;
    expect(fmt(c3.nm / c5.nm, 1)).toBe('2.9');
    expect(pct(c3.tonneShare)).toBe('26%');
    expect(pct(c3.dayShare)).toBe('50%');
    expect(pct(c5.dayShare)).toBe('41%');
  });
});

describe('shipping 3.3', () => {
  it('counts laden detours at 12 knots', () => {
    expect(fmt(DETOUR_DAYS, 1)).toBe('15.7');
    const box = tradeStatus(['suez']).find((x) => x.trade.id === 'box')!;
    expect(box.extraDays).toBeCloseTo(box.extraNm / (24 * 12) + box.route!.canalDays - box.open.canalDays, 6);
  });

  it('settles the drought queue at the 12-knot detour', () => {
    const d = canalState(CUT_SLOTS, 32);
    expect(fmt(d.divertDay)).toBe('47');
    expect(fmt(d.settledQueue)).toBe('377');
    expect(d.divertShare).toBeCloseTo(0.25, 9);
  });

  it('has the slot-cut challenge unsolved at the start and solved at 30 ships a day', () => {
    expect(slotCutSolved(36, 32)).toBe(false);
    expect(slotCutSolved(CUT_SLOTS, 32)).toBe(false);
    expect(slotCutSolved(CUT_SLOTS, 30)).toBe(true);
    expect(slotCutSolved(CUT_SLOTS, 29.5)).toBe(false);
    expect(slotCutSolved(CUT_SLOTS, CUT_SLOTS)).toBe(false);
  });

  it('lets the line creep up when arrivals exactly equal the slots', () => {
    for (const s of [18, 24, 36, 40]) {
      const c = canalState(s, s);
      expect(c.waits[0]).toBe(0);
      expect(c.waits[120]).toBeGreaterThan(1);
      expect(c.waits[120]).toBeLessThan(DETOUR_DAYS);
      for (let t = 1; t <= 120; t++) expect(c.waits[t]).toBeGreaterThan(c.waits[t - 1]);
      expect(c.divertDay).toBeGreaterThan(120);
      expect(c.divertShare).toBe(0);
    }
    expect(fmt(canalState(24, 24).waits[120], 1)).toBe('1.9');
    expect(fmt(canalState(24, 24).divertDay / 365)).toBe('23');
  });

  it('costs the Capesizes nothing under every closure', () => {
    for (const c of ['gibraltar', 'suez', 'redsea', 'hormuz', 'malacca', 'panama'] as Chokepoint[]) expect(extraShips([c]).cape).toBe(0);
  });
});

describe('shipping 3.4', () => {
  it('measures positional value from the worst-placed port', () => {
    for (const cls of ['cape', 'kmax'] as const) {
      const plan = ballasters(cls, 1, 1).req.plan;
      expect(Math.min(...Object.values(plan.open), ...Object.values(plan.ready))).toBeCloseTo(0, 6);
    }
    expect(ballasters('cape', 1, 1).req.plan.open.QIN).toBeCloseTo(0, 6);
    const kmax = ballasters('kmax', 1, 1).req.plan;
    expect(kmax.open.PAR).toBeCloseTo(0, 6);
    expect(kmax.open.QIN).toBeGreaterThan(400);
  });

  it('says “nothing in reach” only when the idle ship can reach no cargo', () => {
    const planAt = (sp: number) => ({ ...cheapestPlan(sp).pairs }) as Plan;
    const albatross = SHIPS.find((s) => s.id === 'albatross')!;
    const fulmar = SHIPS.find((s) => s.id === 'fulmar')!;
    expect(reachableCargoes(albatross, 12).map((c) => c.id)).toEqual(['tub', 'phe', 'new']);
    expect(idleNote(planAt(12), 12)).toMatch(/^Albatross is left without a cargo: she could reach Tubarão, Port Hedland and Newcastle in time/);
    expect(idleNote(planAt(12), 12)).not.toMatch(/nothing in reach|no cargo she can reach/);
    expect(reachableCargoes(fulmar, 10)).toHaveLength(0);
    expect(idleNote(planAt(10), 10)).toMatch(/^Fulmar is left without a cargo, open in Qingdao with no cargo she can reach/);
  });
});

describe('shipping 3.5', () => {
  it('needs 2.6 times the ships for 2.9 times the distance', () => {
    const base = capeNeeds(BASE_MT);
    const more = (id: string) => capeNeeds({ ...BASE_MT, [id]: BASE_MT[id] + 10 }).ships - base.ships;
    const phe = more('C-PHE-QIN');
    const tub = more('C-TUB-QIN');
    expect(fmt(phe, 1)).toBe('5.1');
    expect(fmt(tub, 1)).toBe('13.3');
    expect(fmt(tub / phe, 1)).toBe('2.6');
    const r = Object.fromEntries(base.routes.map((x) => [x.route.id, x]));
    expect(fmt(r['C-TUB-QIN'].nm / r['C-PHE-QIN'].nm, 1)).toBe('2.9');
  });

  it('measures each disruption against the same months without it', () => {
    // No event changes demand, so the two histories differ only inside the event windows.
    expect(HISTORY_EVENTS.every((e) => e.demand === undefined)).toBe(true);
    const brazil = HISTORY_EVENTS.findIndex((e) => e.routeScale);
    const panama = HISTORY_EVENTS.findIndex((e) => e.closed);
    const china = HISTORY_EVENTS.findIndex((e) => e.congestion);
    expect(HISTORY_EVENTS[panama].closed).toEqual(['panama']);
    const b = eventEffect('cape', brazil);
    expect(pct(-b.tonnes, 1)).toBe('12.4%');
    expect(pct(-b.tonMiles, 1)).toBe('21.7%');
    expect(fmt(-b.ships)).toBe('169');
    const p = eventEffect('kmax', panama);
    expect(Math.abs(p.tonnes)).toBeLessThan(1e-9);
    expect(pct(p.tonMiles, 1)).toBe('5.8%');
    expect(fmt(p.ships)).toBe('26');
    expect(fmt(eventEffect('cape', china).ships)).toBe('68');
    expect(fmt(eventEffect('kmax', china).ships)).toBe('43');
    expect(Math.abs(eventEffect('cape', china).tonMiles)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: the redesigned challenges, the trimmed figures and the numbers their prose quotes.

describe('shipping 3.1 · predict the farthest port', () => {
  it('starts unsolved on Tubarão–Qingdao, the haul the prompt quotes, and solves only with Santos', () => {
    expect(farthestSolved('TUB', 'QIN')).toBe(false);
    expect(FARTHEST_FROM_QINGDAO).toBe('SAN');
    expect(farthestSolved('QIN', 'SAN')).toBe(true);
    for (const near of ['TUB', 'ROT', 'NOL', 'RBY']) expect(farthestSolved('QIN', near)).toBe(false);
  });

  it('quotes Santos 190 nm past Tubarão, with Rotterdam and New Orleans nearer', () => {
    const san = routeBetween('SAN', 'QIN');
    const tub = routeBetween('TUB', 'QIN');
    expect(fmt(Math.round(tub.nm / 100) * 100)).toBe('11,100');
    expect(fmt(Math.round(san.nm / 100) * 100)).toBe('11,300');
    expect(fmt(san.nm - tub.nm)).toBe('190');
    expect(fmt(passageDays(san, SPEED31), 1)).toBe('39.4');
    expect(fmt(Math.round(routeBetween('ROT', 'QIN').nm / 100) * 100)).toBe('10,800');
    expect(fmt(Math.round(routeBetween('NOL', 'QIN').nm / 100) * 100)).toBe('10,200');
    expect(routeBetween('ROT', 'QIN').nm).toBeLessThan(tub.nm);
    expect(routeBetween('NOL', 'QIN').nm).toBeLessThan(tub.nm);
    expect(fmt(24 * SPEED31)).toBe('288');
  });
});

describe('shipping 3.2 · predict the berths', () => {
  const S = serviceDays(CH32.rate);

  it('gives 5.72 berths’ worth of work, with the answer well inside the Berths slider', () => {
    expect(fmt(S, 1)).toBe('2.2');
    expect(fmt(CH32.arrivals * S, 2)).toBe('5.72');
    expect(MAX_BERTHS).toBeGreaterThanOrEqual(8 + 3);
  });

  it('is unsolved at the start, solved at eight berths with variable handling or seven with steady, and not one either side', () => {
    expect(fewestBerthsSolved(DEF32.berths, CH32.rate, DEF32.arrivals, CV.variable)).toBe(false);
    expect(fewestBerthsSolved(DEF32.berths, CH32.rate, CH32.arrivals, CV.variable)).toBe(false);
    expect(fewestBerthsSolved(8, CH32.rate, CH32.arrivals, CV.variable)).toBe(true);
    expect(fewestBerthsSolved(7, CH32.rate, CH32.arrivals, CV.variable)).toBe(false);
    expect(fewestBerthsSolved(9, CH32.rate, CH32.arrivals, CV.variable)).toBe(false);
    expect(fewestBerthsSolved(7, CH32.rate, CH32.arrivals, CV.steady)).toBe(true);
    expect(fewestBerthsSolved(6, CH32.rate, CH32.arrivals, CV.steady)).toBe(false);
    expect(fewestBerthsSolved(8, CH32.rate, CH32.arrivals, CV.steady)).toBe(false);
    expect(fewestBerthsSolved(8, CH32.rate, 2.5, CV.variable)).toBe(false);
  });

  it('starts the lost-capacity figure at the busier port’s 7.3-day wait', () => {
    expect(LOST_START_WAIT).toBe(7.3);
    const cape = shipsNeeded('cape', LOST_START_WAIT) - LOST.cape.base;
    expect(fmt(cape)).toBe('108');
    expect(pct(cape / MARKET_CLASSES.cape.fleet, 1)).toBe('13.1%');
    expect(fmt(MARKET_CLASSES.cape.fleet - LOST.cape.base - cape)).toBe('12');
    expect(fmt(LOST.cape.calls)).toBe('5,235');
    expect(fmt(LOST.cape.perDay, 1)).toBe('14.7');
    expect(fmt(LOST.cape.crossover, 1)).toBe('8.1');
    expect(fmt(LOST_START_WAIT * LOST.cape.calls)).toBe('38,218');
    expect(365 - OFF_HIRE_DAYS).toBe(355);
    // The ship-days the caption quotes, shared over a ship's working year, are the ships tied up.
    expect((LOST_START_WAIT * LOST.cape.calls) / (365 - OFF_HIRE_DAYS)).toBeCloseTo(cape, 6);
    expect(fmt(LOST.kmax.perDay, 1)).toBe('9.4');
    expect(fmt(shipsNeeded('kmax', LOST_START_WAIT))).toBe('645');
    expect(shipsNeeded('kmax', LOST_START_WAIT)).toBeGreaterThan(MARKET_CLASSES.kmax.fleet);
    expect(shipsNeeded('cape', LOST_START_WAIT)).toBeLessThan(MARKET_CLASSES.cape.fleet);
  });
});

describe('shipping 3.3 · compute the arrivals', () => {
  it('works out to 24 + 24 × 15.7 ÷ 60 = 30.3 ships a day, so 30 on the slider', () => {
    expect(fmt(DETOUR_DAYS / CHALLENGE_DAYS, 2)).toBe('0.26');
    expect(fmt(ARRIVALS_LIMIT - CUT_SLOTS, 1)).toBe('6.3');
    expect(fmt(ARRIVALS_LIMIT, 1)).toBe('30.3');
    expect(slotCutSolved(CUT_SLOTS, 30)).toBe(true);
    expect(fmt(canalState(CUT_SLOTS, 30).divertDay, 1)).toBe('62.9');
    expect(fmt(canalState(CUT_SLOTS, 30.5).divertDay, 1)).toBe('58.0');
    // Near misses on either side, and the starting state.
    expect(slotCutSolved(CUT_SLOTS, 29.5)).toBe(false);
    expect(slotCutSolved(CUT_SLOTS, 30.5)).toBe(false);
    expect(slotCutSolved(36, 32)).toBe(false);
    // Neither neighbor of the answer is within two days of the 60-day line.
    expect(Math.abs(canalState(CUT_SLOTS, 30).divertDay - CHALLENGE_DAYS)).toBeGreaterThan(2);
    expect(Math.abs(canalState(CUT_SLOTS, 30.5).divertDay - CHALLENGE_DAYS)).toBeGreaterThan(1.5);
  });
});

describe('shipping 3.4 · first open, first served', () => {
  const SPEEDS = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14];

  it('starts from a plan that covers every cargo but is never the cheapest', () => {
    expect(START_PLAN).toEqual({ tub: 'skua', phe: 'albatross', rby: 'tern', new: 'gannet' });
    for (const sp of SPEEDS) {
      expect(planCost(START_PLAN, sp).filled).toBe(4);
      expect(cheapestSolved(START_PLAN, sp)).toBe(false);
      expect(planCost(START_PLAN, sp).cost).toBeGreaterThan(cheapestPlan(sp).cost + 50_000);
    }
  });

  it('needs two of the starting voyages changed at 12 knots, and the near-cheapest plan does not pass', () => {
    const best = cheapestPlan(12).pairs as Record<string, string>;
    const changed = Object.keys(best).filter((c) => (START_PLAN as Record<string, string>)[c] !== best[c]);
    expect(changed.sort()).toEqual(['new', 'phe']);
    expect(cheapestSolved({ tub: 'skua', phe: 'gannet', rby: 'tern', new: 'fulmar' }, 12)).toBe(true);
    // Swapping only Albatross and Gannet leaves Albatross waiting at Newcastle: close, but not the cheapest.
    expect(cheapestSolved({ tub: 'skua', phe: 'gannet', rby: 'tern', new: 'albatross' }, 12)).toBe(false);
    expect(Math.round(planCost({ tub: 'skua', phe: 'gannet', rby: 'tern', new: 'albatross' }, 12).cost / 1000)).toBe(1379);
  });

  it('quotes the starting plan, the saving and why Fulmar takes Newcastle', () => {
    expect(Math.round(planCost(START_PLAN, 12).cost / 1000)).toBe(1513);
    expect(Math.round(cheapestPlan(12).cost / 1000)).toBe(1371);
    expect(Math.round((planCost(START_PLAN, 12).cost - cheapestPlan(12).cost) / 1000)).toBe(142);
    expect(Math.round(GANNET_NEW_12.cost / 1000)).toBe(376);
    expect(GANNET_NEW_12.cost).toBeLessThan(FULMAR_NEW_12.cost);
    expect(fmt(ALB_NEW_12.early, 1)).toBe('0.9');
    expect(FULMAR_NEW_12.early).toBe(0);
    expect(ALB_NEW_12.cost - FULMAR_NEW_12.cost).toBeCloseTo(ALB_NEW_12.early * DAY_VALUE, 0);
  });

  it('shows Australia’s exports changing the ships but not the ballast voyages into the Atlantic', () => {
    const base = ballasters('cape', 1, 1);
    const aus = ballasters('cape', 1, 1.5);
    expect(fmt(aus.req.ships)).toBe('852');
    expect(aus.intoAtlantic).toBeCloseTo(base.intoAtlantic, 6);
    expect(fmt(base.intoAtlantic)).toBe('1,471');
    expect(fmt(ballasters('cape', 1.5, 1).intoAtlantic)).toBe('2,206');
  });
});

describe('shipping 3.5 · the trimmed trade-flow figure', () => {
  it('holds the Rotterdam and Paradip trades at their starting volumes', () => {
    const v = flowVolumes({ ...BASE_MT, 'C-TUB-ROT': 45, 'C-RBY-PAR': 0, 'C-PHE-QIN': 530, 'C-TUB-QIN': 320 });
    expect(v['C-TUB-ROT']).toBe(BASE_MT['C-TUB-ROT']);
    expect(v['C-RBY-PAR']).toBe(BASE_MT['C-RBY-PAR']);
    expect(v['C-PHE-QIN']).toBe(530);
    expect(sourcingSolved(v)).toBe(true);
    expect(sourcingSolved(flowVolumes({ ...BASE_MT }))).toBe(false);
    expect(QIN_TONNES).toBe(890);
  });

  it('keeps one ballast mile per laden mile whatever the Qingdao volumes, so that readout went', () => {
    for (const [p, t, n] of [[600, 250, 40], [0, 890, 0], [890, 0, 0], [1200, 600, 100], [300, 500, 90]])
      expect(capeNeeds(flowVolumes({ 'C-PHE-QIN': p, 'C-TUB-QIN': t, 'C-NEW-QIN': n })).ballastRatio).toBeCloseTo(1, 9);
  });

  it('quotes the fleet’s spare ships and the switch per ten million tonnes', () => {
    const base = capeNeeds(BASE_MT).ships;
    expect(fmt(MARKET_CLASSES.cape.fleet - base)).toBe('120');
    const shift = capeNeeds({ ...BASE_MT, 'C-PHE-QIN': BASE_MT['C-PHE-QIN'] - 10, 'C-TUB-QIN': BASE_MT['C-TUB-QIN'] + 10 }).ships - base;
    expect(fmt(shift, 1)).toBe('8.3');
  });
});
