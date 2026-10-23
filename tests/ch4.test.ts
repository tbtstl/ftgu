// Chapter 4: engine checks, the numbers quoted in the lessons' prose, and challenge reachability.

import { describe, expect, it } from 'vitest';
import { STANDARD_FLEET, fleetById } from '../src/model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { standardHistory } from '../src/model/history';
import { usd } from '../src/framework/format';
import { clearMeritOrder } from '../src/engines/market/clearing';
import { coOptimize } from '../src/engines/market/ancillary';
import { COST_RECIPE, customGasOffer, fleetOffers, offerBreakdown, switchingGasPrice } from '../src/engines/market/offerCost';
import { comparePlannerDay, comparePlannerMarket, estimateNoise, plannerErrorSweep, plannerEstimates, type PlannerPlant } from '../src/engines/market/planner';
import { ANNUAL_ENERGY, dayAheadSchedule, dayCost, generatorDay, isoDay, retailerDay, retailerPeriod, traderDay, wiresUtility } from '../src/engines/market/roles';
import { dailyAverages, dayAheadPurchase, hedgeBacktest, settleRetailer } from '../src/engines/market/hedging';
import {
  CAPACITY_TARGET,
  LARGEST_UNIT,
  PEAK_HOUR,
  accreditedCapacity,
  fleetCapacityAt,
  missingMoneyPerDay,
  regionCapacityAuction,
  scarcityEarnings,
  serviceUnits,
} from '../src/engines/market/gridServices';

const H = standardHistory();
const IDS = STANDARD_FLEET.map((g) => g.id);
const plantsAt = (h: number): PlannerPlant[] =>
  STANDARD_FLEET.map((g) => ({ id: g.id, mw: g.fuel === 'wind' ? WIND_CF[h] * g.capacity : g.fuel === 'solar' ? SOLAR_CF[h] * g.capacity : g.capacity, cost: g.marginalCost }));
const DAY = Array.from({ length: 24 }, (_, h) => ({ plants: plantsAt(h), demand: SYSTEM_DEMAND[h] }));
const finite = (x: number) => Number.isFinite(x);

describe('4.1 central planner vs. market', () => {
  const noise = estimateNoise(IDS, 3);

  it('estimates are exact with no error and never negative', () => {
    const p = plantsAt(19);
    const e0 = plannerEstimates(p, 0, noise);
    for (const x of p) expect(e0[x.id]).toBe(x.cost);
    for (let s = 1; s < 30; s++) {
      const e = plannerEstimates(p, 0.4, estimateNoise(IDS, s));
      for (const x of p) expect(e[x.id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('the market dispatch is never beaten', () => {
    for (let s = 1; s < 40; s++)
      for (const h of [3, 14, 19]) {
        const c = comparePlannerMarket(plantsAt(h), plannerEstimates(plantsAt(h), 0.3, estimateNoise(IDS, s)), SYSTEM_DEMAND[h]);
        expect(c.plannerCost).toBeGreaterThanOrEqual(c.marketCost - 1e-6);
      }
  });

  it('matches the prose at the default settings (seed 3, ±15%, 14:00)', () => {
    const est = plannerEstimates(plantsAt(14), 0.15, noise);
    expect(est.cc1.toFixed(2)).toBe('24.80');
    expect(est.coal.toFixed(2)).toBe('26.19');
    const c = comparePlannerMarket(plantsAt(14), est, SYSTEM_DEMAND[14]);
    expect(c.changed.sort()).toEqual(['cc1', 'coal']);
    expect(c.extra).toBeCloseTo(201.5 * 8, 6);
  });

  it('the challenge is reachable at the defaults: a wrong order that costs nothing', () => {
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => {
      const c = comparePlannerMarket(plantsAt(h), plannerEstimates(plantsAt(h), 0.15, noise), SYSTEM_DEMAND[h]);
      return c.misranked.length > 0 && c.extra < 0.5;
    });
    expect(hours).toEqual([18, 19]);
    // And it isn't solved at the starting hour.
    const c14 = comparePlannerMarket(plantsAt(14), plannerEstimates(plantsAt(14), 0.15, noise), SYSTEM_DEMAND[14]);
    expect(c14.extra).toBeGreaterThan(0.5);
  });

  it('matches the prose for the whole-day sweep', () => {
    const market = comparePlannerDay(DAY, 0, noise).marketCost;
    expect(Math.round(market)).toBe(372718);
    expect(market * 365).toBeGreaterThan(100e6);
    const sweep = plannerErrorSweep(DAY, [0, 0.04, 0.1, 0.16, 0.2, 0.4], 200);
    expect(sweep[1].mean).toBe(0);
    expect(sweep[1].perfect).toBe(1);
    expect((sweep[2].mean * 100).toFixed(1)).toBe('0.8');
    expect((sweep[4].mean * 100).toFixed(1)).toBe('3.7');
    for (const p of sweep) expect(finite(p.mean) && finite(p.p10) && finite(p.p90)).toBe(true);
    // The lean sweep agrees with the full comparison.
    const n1 = estimateNoise(IDS, 1);
    const full = comparePlannerDay(DAY, 0.2, n1);
    const one = plannerErrorSweep(DAY, [0.2], 1, 1)[0];
    expect(one.mean).toBeCloseTo(full.extra / full.marketCost, 9);
    // Closest pair in the fleet: Lakeside and Mill Creek, about 15% apart.
    expect((42 - 36) / 42).toBeGreaterThan(0.13);
    expect((42 - 36) / 36).toBeLessThan(0.17);
  });
});

describe('4.2 market roles', () => {
  const mild = H[22];
  const heat = H[116];
  const outage = H[72];

  it('the reference days are what the lesson says', () => {
    expect(mild.weekday).toBe(1);
    expect(mild.outages).toEqual([]);
    expect(heat.outages).toEqual([]);
    expect(heat.temp).toBeGreaterThan(30);
    expect(outage.outages).toEqual(['cc2']);
    expect(Math.max(...outage.rt)).toBeGreaterThan(2000);
    expect(outage.rt.filter((p) => p > 2000).length).toBe(3);
  });

  it('the day-ahead schedule meets forecast demand every hour', () => {
    for (const d of [mild, heat, outage]) {
      const s = dayAheadSchedule(d);
      s.forEach((x, h) => expect(Object.values(x).reduce((a, b) => a + b, 0)).toBeCloseTo(d.demandForecast[h], 6));
    }
  });

  it('matches the generator prose', () => {
    const g = generatorDay(mild, 'cc1');
    expect(g.hoursRun).toBe(16);
    expect(Math.round(g.margin)).toBe(15429);
    const evening = g.output.slice(17, 22).reduce((s, q, i) => s + q * (mild.da[17 + i] - g.cost), 0);
    expect(evening / g.margin).toBeGreaterThan(0.95);
    expect(Math.round(generatorDay(heat, 'cc1').margin)).toBe(328619);
    expect(Math.max(...generatorDay(heat, 'cc1').output)).toBe(400);
  });

  it('matches the retailer, trader, ISO and utility prose', () => {
    expect(Math.round(retailerDay(mild, 45).margin)).toBe(48812);
    expect(Math.round(retailerDay(heat, 45).margin)).toBe(-271037);
    expect(retailerDay(heat, 45).breakEven.toFixed(2)).toBe('88.61');
    expect(usd(traderDay(outage, 50).total)).toBe('−$346,890');
    expect(traderDay(outage, -50).total).toBeCloseTo(-traderDay(outage, 50).total, 6);
    expect(Math.round(isoDay(mild).rent)).toBe(45511);
    expect(Math.round(isoDay(heat).rent)).toBe(227595);
    const iso = isoDay(mild);
    expect(iso.paid + iso.rent).toBeCloseTo(iso.collected, 6);
    const w = wiresUtility(0.08);
    expect(w.deliveryCharge.toFixed(2)).toBe('48.77');
    expect(ANNUAL_ENERGY).toBeGreaterThan(9e6);
    for (const r of [0.05, 0.12]) expect(finite(wiresUtility(r).deliveryCharge)).toBe(true);
  });

  it('the retailer challenge: $39 is the lowest whole-dollar rate that breaks even over 120 days', () => {
    const at = (r: number) => retailerPeriod(H, r);
    expect(at(39).margin).toBeGreaterThanOrEqual(0);
    expect(at(38).margin).toBeLessThan(0);
    expect(at(39).breakEven.toFixed(2)).toBe('38.89');
    expect(at(39).losingDays).toBe(41);
    const avgDa = H.flatMap((d) => d.da).reduce((a, b) => a + b, 0) / (H.length * 24);
    expect(avgDa.toFixed(2)).toBe('36.91');
    // The default isn't already solved, and both slider ends are finite.
    expect(at(44).margin).toBeGreaterThan(0);
    for (const r of [30, 60]) expect(finite(at(r).margin) && finite(at(r).worst)).toBe(true);
  });
});

describe('4.3 offers', () => {
  it('cost recipes reproduce the standard fleet at reference prices', () => {
    for (const g of STANDARD_FLEET) {
      expect(COST_RECIPE[g.id]).toBeDefined();
      expect(offerBreakdown(g).offer).toBeCloseTo(g.marginalCost, 9);
    }
  });

  it('matches the prose', () => {
    const lake = fleetById('cc1');
    const coal = fleetById('coal');
    expect(switchingGasPrice(lake, coal)).toBeCloseTo(3.75, 9);
    expect(offerBreakdown(lake, { gas: 3.7 }).offer).toBeLessThan(28);
    expect(offerBreakdown(lake, { gas: 3.75 }).offer).toBeGreaterThanOrEqual(28 - 1e-9);
    expect(offerBreakdown(lake).fuel).toBeCloseTo(32);
    expect(offerBreakdown(fleetById('cc2')).fuel).toBeCloseTo(38);
    expect(offerBreakdown(fleetById('ct')).fuel).toBeCloseTo(70);
    // Carbon thresholds at $5 gas.
    expect((36 - 28) / (1 - lake.emissions)).toBeCloseTo(12.7, 1);
    expect((42 - 28) / (1 - fleetById('cc2').emissions)).toBeCloseTo(22.2, 1);
    expect(offerBreakdown(lake, { carbon: 15 }).offer).toBeLessThan(offerBreakdown(coal, { carbon: 15 }).offer);
    expect(offerBreakdown(lake, { carbon: 10 }).offer).toBeGreaterThan(offerBreakdown(coal, { carbon: 10 }).offer);
    // Start-up arithmetic.
    expect(coal.startupCost / (coal.capacity * 8)).toBeCloseTo(16.67, 2);
    expect(fleetById('ct').startupCost / fleetById('ct').capacity).toBe(10);
    expect(coal.minOutput).toBe(120);
    expect(fleetById('nuc').minOutput).toBe(360);
  });

  it('the challenge: the highest 5-cent gas price with Lakeside ahead is $3.70', () => {
    const ahead = (gas: number) => offerBreakdown(fleetById('cc1'), { gas }).offer < offerBreakdown(fleetById('coal'), { gas }).offer;
    const grid = Array.from({ length: 201 }, (_, i) => Math.round((2 + i * 0.05) * 100) / 100);
    expect(Math.max(...grid.filter(ahead))).toBe(3.7);
    expect(ahead(5)).toBe(false);
  });

  it('coal-to-gas switching at night and in the afternoon', () => {
    for (const h of [3, 14]) {
      expect(clearMeritOrder(fleetOffers(h, { gas: 5 }), SYSTEM_DEMAND[h]).marginal).toBe('coal');
      expect(clearMeritOrder(fleetOffers(h, { gas: 3.7 }), SYSTEM_DEMAND[h]).marginal).toBe('cc1');
    }
    expect(clearMeritOrder(fleetOffers(19), SYSTEM_DEMAND[19]).price).toBe(42);
  });

  it('every slider extreme clears without NaN', () => {
    for (const gas of [2, 12]) for (const carbon of [0, 100]) for (const h of [3, 14, 19]) expect(finite(clearMeritOrder(fleetOffers(h, { gas, carbon }), SYSTEM_DEMAND[h]).price)).toBe(true);
    for (const hr of [6, 14]) for (const vom of [0, 20]) expect(finite(customGasOffer(hr, vom, 5))).toBe(true);
  });
});

describe('4.5 two settlements', () => {
  const [mild, heat, outage] = [H[22], H[116], H[72]];
  const at100 = (d: (typeof H)[number]) => settleRetailer(d, dayAheadPurchase(d, 1));

  it('settlement adds up', () => {
    for (const d of [mild, heat, outage])
      for (const k of [0, 0.5, 1, 1.5]) {
        const s = settleRetailer(d, dayAheadPurchase(d, k));
        expect(s.dayAhead + s.realTime).toBeCloseTo(s.total, 6);
        if (k === 0) expect(s.total).toBeCloseTo(s.allRealTime, 6);
      }
  });

  it('matches the prose for the three days', () => {
    expect(Math.round(at100(mild).dayAhead)).toBe(186502);
    expect(Math.round(at100(mild).realTime)).toBe(488);
    expect(Math.round(at100(mild).allRealTime)).toBe(183258);
    expect(usd(at100(heat).total - at100(heat).allRealTime)).toBe('$53,883');
    expect(Math.round(at100(outage).total)).toBe(374160);
    expect(at100(outage).realTime).toBeLessThan(0);
    expect(Math.round(at100(outage).allRealTime)).toBe(2610939);
    // Mill Creek's 19:00 schedule on the outage day.
    const s = dayAheadSchedule(outage)[19];
    expect(s.cc2).toBe(250);
    expect(Math.round(250 * outage.da[19])).toBe(46705);
    expect(Math.round(250 * outage.rt[19])).toBe(541375);
  });

  it('matches the prose for 120 days', () => {
    const a = dailyAverages(H);
    expect(a.filter((x) => Math.abs(x.spread) < 1).length).toBe(57);
    const rtAbove = a.filter((x) => x.spread > 0).length;
    expect(rtAbove).toBeGreaterThan(50);
    expect(rtAbove).toBeLessThan(70);
    const total = a.reduce((s, x) => s + x.spread, 0);
    expect((a[72].spread + a[119].spread) / total).toBeGreaterThan(0.75);
    expect(H[119].outages).toEqual(['cc2']);
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(avg(H.flatMap((d) => d.rt)).toFixed(2)).toBe('42.91');
    expect(avg(H.flatMap((d) => d.da)).toFixed(2)).toBe('36.91');
  });

  it('the challenge is reachable with either shape, and not solved at the default', () => {
    expect(hedgeBacktest(H, 0.8, 'follow').worstPerMWh).toBeGreaterThan(90);
    expect(hedgeBacktest(H, 1, 'follow').worstPerMWh).toBeLessThan(90);
    expect(hedgeBacktest(H, 1, 'follow').worstDay).toBe(116);
    expect(hedgeBacktest(H, 1, 'flat').worstPerMWh).toBeGreaterThan(90);
    expect(hedgeBacktest(H, 1.2, 'flat').worstPerMWh).toBeLessThan(90);
    for (const k of [0, 1.5]) for (const shape of ['follow', 'flat'] as const) expect(finite(hedgeBacktest(H, k, shape).worstPerMWh)).toBe(true);
  });
});

describe('4.6 grid services', () => {
  const units = serviceUnits(PEAK_HOUR).filter((u) => u.capacity > 0.5);

  it('the fleet at the evening peak', () => {
    expect(fleetCapacityAt(PEAK_HOUR)).toBeCloseTo(1920, 6);
    expect(LARGEST_UNIT.id).toBe('nuc');
    expect(units.find((u) => u.id === 'ct')!.reserveMax).toBe(100);
  });

  it('matches the prose: reserve priced at opportunity cost', () => {
    const r200 = coOptimize(units, 1440, 200, 20);
    expect(r200.energyPrice).toBeCloseTo(42, 6);
    expect(r200.reservePrice).toBeCloseTo(1, 6);
    expect((r200.reserve.ct + r200.reserve.oil) / 200).toBeGreaterThan(0.5);
    const r400 = coOptimize(units, 1440, 400, 20);
    expect(r400.energyPrice).toBeCloseTo(88, 6);
    expect(r400.reservePrice).toBeCloseTo(88 - 20 + 1, 6);
    expect(r400.energy.ct).toBeGreaterThan(0);
    for (const id of ['hydro', 'cc1', 'coal', 'cc2']) expect(r400.reserve[id]).toBeGreaterThan(0);
  });

  it('the challenge: the highest demand that keeps 400 MW of reserve is 1,500 MW', () => {
    const at = (d: number) => coOptimize(units, d, 400, 20);
    expect(at(1500).reserveShort).toBeLessThan(0.01);
    expect(at(1510).reserveShort).toBeGreaterThan(0.01);
    expect(at(1500).reservePrice).toBeGreaterThanOrEqual(1000 - 1e-6);
    expect(at(1510).energyPrice).toBeGreaterThan(1000);
  });

  it('every slider extreme stays feasible and finite', () => {
    for (const d of [900, 1900]) for (const r of [0, 500]) for (const g of [0, 50]) for (const s of [250, 5000]) {
      for (const dd of [d, d + 10]) {
        const x = coOptimize(units, dd, r, g, s);
        expect(x.feasible).toBe(true);
        expect(finite(x.energyPrice) && finite(x.reservePrice) && finite(x.regulationPrice)).toBe(true);
      }
    }
  });

  it('matches the missing-money prose', () => {
    const ct = fleetById('ct');
    const e = scarcityEarnings(ct, H);
    expect(e.realTimeHours).toBe(66);
    expect(Math.round(e.realTime)).toBe(17562);
    expect(Math.round(e.fixed)).toBe(26301);
    expect(Math.round(e.fixed - e.realTime)).toBe(8740);
    expect((e.realTimeByDay[72] + e.realTimeByDay[119]) / e.realTime).toBeGreaterThan(0.75);
    expect(missingMoneyPerDay(ct, H).toFixed(2)).toBe('72.83');
    expect(dayCost('ct', H[0])).toBeCloseTo(88 * H[0].gas, 9);
  });

  it('the capacity auction and its challenge', () => {
    const ct = fleetById('ct');
    const need = missingMoneyPerDay(ct, H);
    const newMW = 250 * ct.availability;
    expect(newMW).toBeCloseTo(230, 9);
    expect(STANDARD_FLEET.reduce((s, g) => s + accreditedCapacity(g), 0)).toBeCloseTo(1742.5, 6);
    expect(CAPACITY_TARGET / Math.max(...H.flatMap((d) => d.demandForecast))).toBeCloseTo(1.15, 2);
    const full = (o: number) => (regionCapacityAuction(newMW, o, need).awarded.new ?? 0) >= newMW - 1e-6;
    const offers = Array.from({ length: 151 }, (_, i) => i);
    expect(Math.max(...offers.filter(full))).toBe(89);
    expect(regionCapacityAuction(newMW, 89, need).price.toFixed(2)).toBe('89.52');
    expect(regionCapacityAuction(newMW, 89, need).price).toBeGreaterThan(need);
    // The default offer of $100 clears only part of the plant.
    const d = regionCapacityAuction(newMW, 100, need).awarded.new ?? 0;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(newMW);
    for (const o of [0, 150]) expect(finite(regionCapacityAuction(newMW, o, need).price)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The lessons themselves: each challenge can be solved with its figure's controls, and no
// control setting produces NaN on the page.

import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import L41 from '../src/lessons/ch4/L4_1';
import L42 from '../src/lessons/ch4/L4_2';
import L43 from '../src/lessons/ch4/L4_3';
import L45 from '../src/lessons/ch4/L4_5';
import L46 from '../src/lessons/ch4/L4_6';

function mount(C: ComponentType) {
  const view = render(createElement(C));
  const set = (label: string, value: number, index = 0) =>
    act(() => {
      const input = view.getAllByLabelText(label)[index] as HTMLInputElement;
      fireEvent.change(input, { target: { value: String(value) } });
    });
  const solved = (i = 0) => view.container.querySelectorAll('.chal')[i].querySelector('.chal-s.ok') !== null;
  return { view, set, solved };
}

describe('chapter 4 lessons', () => {
  it('4.1: the challenge is solved at 19:00 with the starting estimates', () => {
    const { set, solved } = mount(L41);
    expect(solved()).toBe(false);
    set('Hour of the reference day', 19);
    expect(solved()).toBe(true);
    cleanup();
  });

  it('4.2: $39 solves the retailer challenge, $40 does not', () => {
    const { set, solved } = mount(L42);
    expect(solved()).toBe(false);
    set('Fixed retail rate', 40);
    expect(solved()).toBe(false);
    set('Fixed retail rate', 39);
    expect(solved()).toBe(true);
    cleanup();
  });

  it('4.3: $3.70 gas solves the challenge, $3.75 does not', () => {
    const { set, solved } = mount(L43);
    expect(solved()).toBe(false);
    set('Gas price', 3.75);
    expect(solved()).toBe(false);
    set('Gas price', 3.7);
    expect(solved()).toBe(true);
    set('Carbon price', 20);
    expect(solved()).toBe(false);
    cleanup();
  });

  it('4.5: buying the forecast solves the challenge', () => {
    const { set, solved } = mount(L45);
    expect(solved()).toBe(false);
    set('Buy day-ahead', 100, 1);
    expect(solved()).toBe(true);
    cleanup();
  });

  it('4.6: both challenges', () => {
    const { set, solved } = mount(L46);
    expect(solved(0)).toBe(false);
    expect(solved(1)).toBe(false);
    set('Reserve requirement', 400);
    set('Demand for energy', 1500);
    expect(solved(0)).toBe(true);
    set('Demand for energy', 1490);
    expect(solved(0)).toBe(false);
    set('Your offer', 89);
    expect(solved(1)).toBe(true);
    set('Your offer', 90);
    expect(solved(1)).toBe(false);
    cleanup();
  });

  for (const [id, C] of [
    ['4.1', L41],
    ['4.2', L42],
    ['4.3', L43],
    ['4.5', L45],
    ['4.6', L46],
  ] as Array<[string, ComponentType]>) {
    it(`${id}: no NaN at any slider extreme, in any view`, () => {
      const { view } = mount(C);
      const noNaN = () => expect(view.container.textContent ?? '').not.toMatch(/NaN|Infinity|undefined/);
      const sweepSliders = () => {
        for (const input of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
          if (input.disabled) continue;
          for (const v of [input.max, input.min, input.max]) {
            act(() => {
              fireEvent.change(input, { target: { value: v } });
            });
            noNaN();
          }
        }
      };
      sweepSliders();
      const buttons = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button, .fig-ft button'));
      for (const b of buttons) {
        if (/Save/.test(b.textContent ?? '')) continue;
        act(() => {
          fireEvent.click(b);
        });
        sweepSliders();
      }
      cleanup();
    });
  }
});
