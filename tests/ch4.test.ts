// Chapter 4: engine checks, the numbers quoted in the lessons' prose, and challenge reachability.

import { describe, expect, it } from 'vitest';
import { STANDARD_FLEET, fleetById } from '../src/model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../src/model/profiles';
import { standardHistory } from '../src/model/history';
import { mw, usd } from '../src/framework/format';
import { clearMeritOrder } from '../src/engines/market/clearing';
import { coOptimize } from '../src/engines/market/ancillary';
import { COST_RECIPE, customGasOffer, fleetOffers, offerBreakdown, switchingGasPrice } from '../src/engines/market/offerCost';
import {
  REFERENCE_HOUR,
  clearWithOffer,
  highestFullOffer,
  hourOffers,
  isPivotal,
  payments,
  profitCurve,
  referenceLevel,
  supplyWithout,
} from '../src/engines/market/marketPower';
import { comparePlannerDay, comparePlannerMarket, estimateNoise, plannerErrorSweep, plannerEstimates, type PlannerPlant } from '../src/engines/market/planner';
import { ANNUAL_ENERGY, RETAILER_SHARE, dayAheadSchedule, dayCost, generatorDay, isoDay, retailerDay, retailerPeriod, traderDay, wiresUtility } from '../src/engines/market/roles';
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

  it('the typical error is one standard deviation: about two-thirds of estimates land within it', () => {
    let inside = 0;
    let n = 0;
    for (let seed = 1; seed <= 400; seed++)
      for (const z of Object.values(estimateNoise(IDS, seed))) {
        n++;
        if (Math.abs(z) <= 1) inside++;
      }
    expect(inside / n).toBeGreaterThan(0.63);
    expect(inside / n).toBeLessThan(0.72);
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
    // One who bought 50 MW instead would have made the same amount.
    expect(usd(traderDay(outage, -50).total)).toBe('$346,890');
    // The ISO books still balance in the engine, though 4.2 no longer shows congestion rent.
    const iso = isoDay(mild);
    expect(iso.paid + iso.rent).toBeCloseTo(iso.collected, 6);
    // ISO: on the mild Tuesday, actual demand is never more than 30 MW from the forecast.
    const gap = (d: (typeof H)[number]) => Math.max(...d.demand.map((q, h) => Math.abs(q - d.demandForecast[h])));
    expect(Math.round(gap(mild))).toBe(30);
    expect(gap(mild)).toBeLessThanOrEqual(30.5);
    const w = wiresUtility(0.08);
    expect(w.deliveryCharge.toFixed(2)).toBe('48.77');
    // Utility: more than the energy itself costs on a typical day ($34.76 on average on the mild Tuesday).
    const avgDa = mild.da.reduce((a, b) => a + b, 0) / 24;
    expect(avgDa.toFixed(2)).toBe('34.76');
    expect(w.deliveryCharge).toBeGreaterThan(avgDa);
    expect(H.filter((d) => d.da.reduce((a, b) => a + b, 0) / 24 > w.deliveryCharge).length).toBeLessThan(10);
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

  it('the first figure opens at 14:00: raising gas changes nothing, lowering it hands the margin to Lakeside', () => {
    const at = (h: number, gas: number) => clearMeritOrder(fleetOffers(h, { gas }).filter((o) => o.mw > 0.5), SYSTEM_DEMAND[h]);
    for (let g = 3.75; g <= 12 + 1e-9; g += 0.05) {
      const c = at(14, g);
      expect(c.marginal).toBe('coal');
      expect(c.price).toBe(28);
      expect(c.dispatch.cc1 ?? 0).toBe(0);
    }
    expect(at(14, 3.7).marginal).toBe('cc1');
    expect(at(14, 3.7).dispatch.cc1).toBeGreaterThan(0);
  });

  it('at 19:00 the swap changes no dispatch, and from about $3.20 Mill Creek’s gas sets the price at $7.60 per dollar', () => {
    const at = (gas: number) => clearMeritOrder(fleetOffers(19, { gas }).filter((o) => o.mw > 0.5), SYSTEM_DEMAND[19]);
    for (const g of [3.7, 3.75]) {
      expect(at(g).dispatch.cc1).toBeCloseTo(400, 9);
      expect(at(g).dispatch.coal).toBeCloseTo(300, 9);
    }
    for (let i = 0; i <= 176; i++) {
      const g = Math.round((3.2 + i * 0.05) * 100) / 100;
      expect(at(g).marginal).toBe('cc2');
      expect(at(g).price).toBeCloseTo(7.6 * g + 4, 9);
    }
    expect(at(3.15).marginal).toBe('coal');
  });

  describe('your plant: 200 MW, $3.50 O&M, $5 gas, at 19:00', () => {
    const withYou = (h: number, offer: number) => [...fleetOffers(h).filter((o) => o.mw > 0.5).map((o) => ({ id: o.id, mw: o.mw, price: o.price })), { id: 'you', mw: 200, price: offer }];
    const at = (hr: number, h = 19) => {
      const offer = customGasOffer(hr, 3.5, 5);
      const c = clearMeritOrder(withYou(h, offer), SYSTEM_DEMAND[h]);
      const q = c.dispatch.you ?? 0;
      return { offer, c, q, margin: q * (c.price - offer) };
    };
    const hoursRun = (hr: number) => Array.from({ length: 24 }, (_, h) => h).filter((h) => at(hr, h).q > 1e-6);
    const gasHours = Array.from({ length: 24 }, (_, h) => h).filter((h) => ['cc1', 'cc2'].includes(clearMeritOrder(fleetOffers(h).filter((o) => o.mw > 0.5), SYSTEM_DEMAND[h]).marginal ?? ''));

    it('at the default 7.0 it takes Mill Creek’s 50 MW, sets the price at $38.50 and earns nothing', () => {
      const r = at(7);
      expect(r.offer).toBeCloseTo(38.5, 9);
      expect(r.q).toBeCloseTo(50, 9);
      expect(r.c.marginal).toBe('you');
      expect(r.c.price).toBeCloseTo(38.5, 9);
      expect(r.margin).toBeCloseTo(0, 9);
      expect(hoursRun(7)).toEqual([18, 19]);
      expect(gasHours.filter((h) => clearMeritOrder(fleetOffers(h).filter((o) => o.mw > 0.5), SYSTEM_DEMAND[h]).marginal === 'cc2')).toEqual([18, 19]);
    });

    it('the challenge: 6.4 is the highest heat rate that earns at 19:00, and the price falls from $42 to $36', () => {
      const r = at(6.4);
      expect(r.offer).toBeCloseTo(35.5, 9);
      expect(r.q).toBeCloseTo(200, 9);
      expect(r.c.marginal).toBe('cc1');
      expect(r.c.price).toBe(36);
      expect(r.margin).toBeGreaterThan(0.005);
      expect(at(6.5).margin).toBeLessThanOrEqual(0.005);
      expect(at(6.5).c.marginal).toBe('you');
      for (let i = 0; i <= 80; i++) {
        const hr = Math.round((6 + i * 0.1) * 10) / 10;
        const solved = at(hr).margin > 0.005 && at(Math.round((hr + 0.1) * 10) / 10).margin <= 0.005;
        expect(solved, String(hr)).toBe(hr === 6.4);
      }
      expect(clearMeritOrder(fleetOffers(19).filter((o) => o.mw > 0.5), SYSTEM_DEMAND[19]).price).toBe(42);
    });

    it('a plant that undercuts Lakeside runs 8 hours, every hour a gas plant is needed; one like Eastgate never runs', () => {
      expect(gasHours.length).toBe(8);
      for (const hr of [6, 6.2, 6.4]) expect(hoursRun(hr)).toEqual(gasHours);
      expect(hoursRun(14)).toEqual([]);
      for (const hr of [6, 14]) expect(finite(at(hr).margin)).toBe(true);
    });
  });

  it('every slider extreme clears without NaN', () => {
    for (const gas of [2, 12]) for (const carbon of [0, 100]) for (const h of [3, 14, 19]) expect(finite(clearMeritOrder(fleetOffers(h, { gas, carbon }), SYSTEM_DEMAND[h]).price)).toBe(true);
    for (const hr of [6, 14]) for (const vom of [0, 20]) expect(finite(customGasOffer(hr, vom, 5))).toBe(true);
  });
});

describe('4.4 uniform pricing and market power', () => {
  // The region's offers at 19:00 on the reference day; the reader owns Mill Creek (cc2).
  const offers = hourOffers(REFERENCE_HOUR);
  const D = SYSTEM_DEMAND[REFERENCE_HOUR];
  const COST = fleetById('cc2').marginalCost;
  const GRID = Array.from({ length: 201 }, (_, i) => i);
  const at = (offer: number, demand: number, monitor = false) => clearWithOffer(offers, 'cc2', COST, offer, demand, monitor);
  // The lesson's challenge condition.
  const solved = (offer: number, demand: number, monitor: boolean) =>
    !monitor && at(COST, demand).dispatch >= 250 - 1e-6 && at(offer, demand).dispatch >= 250 - 1e-6 && at(offer + 1, demand).dispatch < 250 - 1e-6;

  it('the reference hour: 19:00, 1,440 MW, 140 MW of wind, no sun, Mill Creek marginal at $42', () => {
    expect(REFERENCE_HOUR).toBe(19);
    expect(D).toBe(1440);
    expect(offers.find((o) => o.id === 'wind')!.mw).toBeCloseTo(140, 9);
    expect(offers.find((o) => o.id === 'solar')).toBeUndefined();
    expect(COST).toBe(42);
    expect(offerBreakdown(fleetById('cc2')).offer).toBeCloseTo(42, 9);
    const c = clearMeritOrder(offers, D);
    expect(c.marginal).toBe('cc2');
    expect(c.price).toBe(42);
    expect(c.dispatch.cc2).toBeCloseTo(50, 9);
    expect(250 - c.dispatch.cc2).toBeCloseTo(200, 9);
    for (const id of ['wind', 'nuc', 'hydro', 'coal', 'cc1']) expect(c.dispatch[id]).toBeCloseTo(offers.find((o) => o.id === id)!.mw, 9);
    expect(c.dispatch.ct).toBe(0);
    // Offers quoted in the prose.
    expect(offers.find((o) => o.id === 'nuc')!.price).toBe(9);
    expect(offers.find((o) => o.id === 'cc1')!.price).toBe(36);
    expect(offers.find((o) => o.id === 'ct')!.price).toBe(88);
  });

  it('payment rules: $60,480 pay-as-clear, $31,500 pay-as-bid at cost, $60,480 again once offers move to $42', () => {
    const u = payments(offers, D, 'uniform');
    expect(u.bill).toBeCloseTo(60480, 6);
    expect(u.runningCost).toBeCloseTo(31500, 6);
    expect(u.paid.nuc - 400 * 9).toBeCloseTo(13200, 6);
    expect(u.bill - u.runningCost).toBeCloseTo(28980, 6);
    const b = payments(offers, D, 'payAsBid');
    expect(b.bill).toBeCloseTo(31500, 6);
    expect(usd(b.bill / D, 2)).toBe('$21.88');
    const g = payments(offers, D, 'payAsBidGuess');
    expect(g.bill).toBeCloseTo(60480, 6);
    expect(g.clearing.dispatch).toEqual(u.clearing.dispatch);
    for (const o of g.offers) if ((u.clearing.dispatch[o.id] ?? 0) > 0) expect(o.price).toBe(42);
  });

  it('at 1,440 MW Mill Creek is marginal: raising its offer raises the price, up to Eastgate’s $88', () => {
    expect(at(COST, D).profit).toBeCloseTo(0, 9);
    const r = at(88, D);
    expect(r.price).toBe(88);
    expect(r.dispatch).toBeCloseTo(50, 9);
    expect(r.profit).toBeCloseTo(2300, 6);
    expect(r.price * D - 42 * D).toBeCloseTo(66240, 6);
    expect(r.price * D - 42 * D - r.profit).toBeCloseTo(63940, 6);
    // The best offer on the slider is $88.
    const curve = profitCurve(offers, 'cc2', COST, D, GRID);
    const best = curve.reduce((a, b) => (b.profit > a.profit + 1e-6 ? b : a));
    expect(best.offer).toBe(88);
    // A dollar more and Eastgate takes the 50 MW.
    const over = at(89, D);
    expect(over.dispatch).toBe(0);
    expect(over.profit).toBe(0);
    expect(over.clearing.dispatch.ct).toBeCloseTo(50, 9);
    // Below Lakeside’s $36, Mill Creek runs flat out at Lakeside’s price.
    for (const o of [0, 20, 35]) {
      expect(at(o, D).price).toBe(36);
      expect(at(o, D).dispatch).toBeCloseTo(250, 9);
      expect(at(o, D).profit).toBeCloseTo(-1500, 6);
    }
    expect(at(COST, D).pivotal).toBe(false);
  });

  it('at 1,650 MW Eastgate sets $88 and every offer up to $88 earns $11,500; above it Mill Creek keeps 60 MW', () => {
    for (const o of [0, 20, 42, 60, 88]) {
      const r = at(o, 1650);
      expect(r.clearing.marginal).toBe('ct');
      expect(r.price).toBe(88);
      expect(r.profit).toBeCloseTo(11500, 6);
    }
    expect(at(89, 1650).dispatch).toBeCloseTo(60, 9);
    expect(at(150, 1650).dispatch).toBeCloseTo(60, 9);
    expect(at(COST, 1650).pivotal).toBe(false);
  });

  it('past 1,670 MW Mill Creek is pivotal and its profit climbs at the right edge of the chart', () => {
    expect(supplyWithout(offers, 'cc2')).toBeCloseTo(1670, 9);
    expect(isPivotal(offers, 'cc2', 1670)).toBe(false);
    expect(isPivotal(offers, 'cc2', 1680)).toBe(true);
    for (const d of [1680, 1700, 1750, 1800]) {
      for (let o = 167; o <= 200; o++) expect(at(o, d).profit).toBeGreaterThan(at(o - 1, d).profit);
      expect(at(500, d).profit).toBeGreaterThan(at(200, d).profit);
      expect(at(1000, d).dispatch).toBeGreaterThan(0);
    }
  });

  it('mitigation: reference level $46.20; $210 at 1,440 MW, a flat $11,500 at 1,650 MW and past 1,670 MW', () => {
    expect(referenceLevel(COST)).toBe(46.2);
    expect(usd(referenceLevel(COST), 2)).toBe('$46.20');
    const m1440 = profitCurve(offers, 'cc2', COST, D, GRID, true);
    const max1440 = Math.max(...m1440.map((r) => r.profit));
    expect(max1440).toBeCloseTo(210, 6);
    for (const r of m1440.filter((x) => x.offer >= 47)) {
      expect(r.mitigated).toBe(true);
      expect(r.profit).toBeCloseTo(210, 6);
    }
    // Offers at or below the reference level stand.
    for (const r of m1440.filter((x) => x.offer <= 46)) expect(r.mitigated).toBe(false);
    for (const d of [1650, 1680, 1700, 1750, 1800]) for (const r of profitCurve(offers, 'cc2', COST, d, GRID, true)) expect(r.profit).toBeCloseTo(11500, 6);
    // At 1,650 MW no offer up to $88 is touched; higher ones are replaced.
    for (const o of [47, 60, 88]) expect(at(o, 1650, true).mitigated).toBe(false);
    for (const o of [89, 120, 200]) expect(at(o, 1650, true).mitigated).toBe(true);
    // Past 1,670 MW the reason is the pivotal test.
    expect(at(60, 1750, true).mitigated).toBe(true);
    expect(at(60, 1750, true).pivotal).toBe(true);
  });

  it('challenge: the default is unsolved and $88 at a demand where Mill Creek runs flat out solves it', () => {
    expect(solved(COST, D, false)).toBe(false);
    // An offer below Lakeside runs Mill Creek flat out at 1,440 MW, but that isn’t the question.
    expect(at(35, D).dispatch).toBeCloseTo(250, 9);
    expect(solved(35, D, false)).toBe(false);
    for (const d of [1640, 1650, 1700, 1800]) {
      expect(highestFullOffer(offers, 'cc2', COST, d, GRID)).toBe(88);
      expect(solved(88, d, false)).toBe(true);
      expect(solved(87, d, false)).toBe(false);
      expect(solved(88, d, true)).toBe(false);
    }
    for (let d = 1300; d < 1640; d += 10) for (const o of GRID) expect(solved(o, d, false)).toBe(false);
  });

  it('every slider extreme clears without NaN', () => {
    for (const o of [0, 200]) for (const d of [1300, 1800]) for (const m of [false, true]) expect(finite(at(o, d, m).profit)).toBe(true);
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
    expect(a.filter((x) => Math.abs(x.spread) < 1).length).toBe(57); // “nearly half”
    // Buying the forecast is insurance, not a dependable saving: it costs more than real time on
    // 56 days, and about four fifths of its saving comes from the two Mill Creek outage days.
    for (const k of [0.8, 1]) {
      const bt = hedgeBacktest(H, k, 'follow');
      expect(bt.cost.filter((c, i) => c > bt.allRealTime[i]).length).toBe(56);
      const saving = bt.totalAllRealTime - bt.total;
      const outageDays = bt.allRealTime[72] - bt.cost[72] + bt.allRealTime[119] - bt.cost[119];
      expect(outageDays / saving).toBeGreaterThan(0.77);
      expect(outageDays / saving).toBeLessThan(0.83);
    }
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

  it('the challenge: 120% is the smallest flat block that keeps every day under $100', () => {
    const worst = (k: number, shape: 'follow' | 'flat') => hedgeBacktest(H, k / 100, shape).worstPerMWh;
    const flatOK = Array.from({ length: 31 }, (_, i) => i * 5).filter((k) => worst(k, 'flat') < 100);
    expect(flatOK[0]).toBe(120);
    expect(worst(115, 'flat')).toBeGreaterThan(104);
    expect(worst(120, 'flat')).toBeLessThan(90);
    // The worst day at the answer is the outage day, whose spikes the block has to cover.
    expect(hedgeBacktest(H, 1.2, 'flat').worstDay).toBe(72);
    expect(hedgeBacktest(H, 1.15, 'flat').worstDay).toBe(72);
    const od = H[72];
    const spikes = od.rt.map((p, h) => (p > 2000 ? h : -1)).filter((h) => h >= 0);
    expect(spikes).toEqual([18, 19, 20]);
    const use = spikes.map((h) => od.demand[h] * RETAILER_SHARE);
    expect(mw(Math.min(...use))).toBe('318 MW');
    expect(mw(Math.max(...use))).toBe('325 MW');
    expect(mw(dayAheadPurchase(od, 1.2, 'flat')[0])).toBe('300 MW');
    // The default (follow the forecast, 80%) is unsolved; following it, 95% is enough and the heat wave is then the worst day.
    expect(worst(80, 'follow')).toBeGreaterThan(100);
    expect(worst(90, 'follow')).toBeGreaterThan(100);
    expect(worst(95, 'follow')).toBeLessThan(100);
    expect(hedgeBacktest(H, 0.95, 'follow').worstDay).toBe(116);
    expect(hedgeBacktest(H, 1, 'follow').worstDay).toBe(116);
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
    // Every plant but Falls hydro is already holding all it can ramp in 30 minutes, so hydro is the
    // marginal reserve provider — even though Lakeside and Mill Creek would give up less energy value.
    for (const u of units.filter((x) => x.reserveMax > 0 && x.id !== 'hydro')) expect(r400.reserve[u.id]).toBeCloseTo(u.reserveMax, 6);
    expect(r400.reserve.hydro).toBeLessThan(units.find((u) => u.id === 'hydro')!.reserveMax - 1);
    expect(88 - 36 + 1).toBeLessThan(r400.reservePrice);
    expect(88 - 42 + 1).toBeLessThan(r400.reservePrice);
  });

  it('matches the regulation and shortage-price prose', () => {
    const r = coOptimize(units, 1440, 200, 20);
    expect(r.regulationPrice).toBeCloseTo(11, 6);
    expect(r.reservePrice).toBeCloseTo(1, 6);
    const providers = units.filter((u) => (u.regulationMax ?? 0) > 0).map((u) => u.id).sort();
    expect(providers).toEqual(['cc1', 'cc2', 'coal', 'hydro']);
    const regCap = units.reduce((s, u) => s + (u.regulationMax ?? 0), 0);
    expect(Math.round(regCap)).toBe(49);
    for (const d of [900, 1200, 1440]) expect(coOptimize(units, d, 200, 50).regulationShort).toBeGreaterThan(0.5);
    // While the region is short, the reserve price is the shortage price and energy sits just above it.
    for (const sp of [250, 1000, 5000]) {
      const x = coOptimize(units, 1510, 400, 20, sp);
      expect(x.reserveShort).toBeGreaterThan(0.01);
      expect(x.reservePrice).toBeCloseTo(sp, 6);
      expect(x.energyPrice).toBeGreaterThan(sp);
      expect(x.energyPrice).toBeLessThan(sp + 50);
    }
  });

  it('the challenge: the highest demand that keeps 400 MW of reserve is 1,500 MW', () => {
    expect(fleetCapacityAt(PEAK_HOUR) - 400 - 20).toBeCloseTo(1500, 6);
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
import L44 from '../src/lessons/ch4/L4_4';
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

  it('no chapter 4 figure carries a table that restates its chart', () => {
    for (const C of [L41, L42, L43, L44, L45, L46]) {
      const { view } = mount(C);
      expect(view.container.querySelectorAll('figure table').length).toBe(0);
      cleanup();
    }
  });

  it('4.2: every role shows one chart, two readouts and no sliders; no congestion rent', () => {
    const { view } = mount(L42);
    const fig = view.container.querySelectorAll('figure')[0];
    for (const role of ['Generator', 'Retailer', 'Trader', 'ISO', 'Utility']) {
      act(() => {
        fireEvent.click(view.getByRole('button', { name: role }));
      });
      expect(fig.querySelectorAll('svg.chart').length, role).toBe(1);
      expect(fig.querySelectorAll('.big > div').length, role).toBe(2);
      expect(fig.querySelectorAll('input[type="range"]').length, role).toBe(0);
    }
    expect(view.container.textContent).not.toMatch(/congestion/i);
    // At most two forward references, both links.
    const ahead = Array.from(view.container.querySelectorAll('p a')).map((a) => a.getAttribute('href') ?? '').filter((h) => /^#\/(4\.[3-6]|[5-8]\.)/.test(h));
    expect(ahead).toEqual(['#/4.5', '#/4.3']);
    expect(view.container.textContent).not.toMatch(/Chapter [5-8]/);
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

  it('4.3: your plant earns at 19:00 up to a heat rate of 6.4, and not at the default 7.0', () => {
    const { set, solved } = mount(L43);
    expect(solved(1)).toBe(false);
    set('Heat rate', 6.5);
    expect(solved(1)).toBe(false);
    set('Heat rate', 6.4);
    expect(solved(1)).toBe(true);
    set('Heat rate', 6.3);
    expect(solved(1)).toBe(false);
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

  it('4.4: $88 at 1,650 MW solves the challenge; $89, the default and the monitor do not', () => {
    const { view, set, solved } = mount(L44);
    expect(solved()).toBe(false);
    set('Mill Creek’s offer', 88);
    expect(solved()).toBe(false);
    set('Demand at 19:00', 1650);
    expect(solved()).toBe(true);
    set('Mill Creek’s offer', 89);
    expect(solved()).toBe(false);
    set('Mill Creek’s offer', 88);
    expect(solved()).toBe(true);
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'Market monitor on' }));
    });
    expect(solved()).toBe(false);
    cleanup();
  });

  it('4.5: a flat block of 120% solves the challenge; following the forecast, 115% and 125% do not', () => {
    const { view, set, solved } = mount(L45);
    expect(solved()).toBe(false);
    set('Buy day-ahead', 100, 1);
    expect(solved()).toBe(false);
    set('Buy day-ahead', 120, 1);
    expect(solved()).toBe(false);
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'One flat block' }));
    });
    expect(solved()).toBe(true);
    set('Buy day-ahead', 115, 1);
    expect(solved()).toBe(false);
    set('Buy day-ahead', 125, 1);
    expect(solved()).toBe(false);
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
    ['4.4', L44],
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
