// Gas Chapter 7 (the capstone): the numbers and claims the prose was corrected to, checked
// against the engine.

import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AS_BUILT, PASSIVE, PORTFOLIO_DEFAULTS, PRACTICE_SEEDS, TOURNAMENT_SEEDS, portfolioYear, systemYear, winterColder, type GasSystem } from '../src/engines/gas/capstone';
import { forecastSkill } from '../src/engines/gas/forecast';
import { HEATING_MONTHS } from '../src/engines/gas/strategies';
import { GAS_MONTH_START, GAS_YEAR_DAYS, hdd } from '../src/model/gas/weather';
import L7_3 from '../src/lessons/gas/ch7/L7_3';
import L7_4 from '../src/lessons/gas/ch7/L7_4';
import L7_5 from '../src/lessons/gas/ch7/L7_5';
import { cheapestFix, constructorNumbers, constructorSolved } from '../src/lessons/gas/ch7/L7_1';
import { REGIONAL_MARKET_DEFAULTS, regionalMarketSolved, rmEight, rmFullIntoMetro, rmPeak, rmPriceWords } from '../src/lessons/gas/ch7/L7_2';
import { FORECAST_CHALLENGE_DEFAULTS, roundBreakaways, roundTally, TALLY_DEFAULTS } from '../src/lessons/gas/ch7/L7_3';
import { partMean, pmEight, pmGuardMonth, pmNumbers, pmShare, pmShortfall, pmTarget, portfolioManagerSolved } from '../src/lessons/gas/ch7/L7_4';
import { tournamentColdMild, tournamentDesks, tournamentPortfolioWords } from '../src/lessons/gas/ch7/L7_5';
import { CHEAPEST_NETWORK, ConfirmReset, isStartingPortfolio, networkChangesShort, portfolioShort } from '../src/lessons/gas/shared/CapstoneUi';
import { getGasCapstone, resetGasPortfolio, resetGasSystem, updateGasPortfolio, updateGasSystem } from '../src/lessons/gas/shared/capstone';

const FIX: GasSystem = { sizes: { ...AS_BUILT.sizes }, stations: { ...AS_BUILT.stations, 'ridgeback-bayport': 4, 'sandhill-metro': 5 } };

describe('gas chapter 7: heating degree days', () => {
  it('measures a winter in heating degree days against normal, as Lesson 6.5 does', () => {
    for (const seed of [...PRACTICE_SEEDS, ...TOURNAMENT_SEEDS]) {
      const w = systemYear(AS_BUILT, seed).weather;
      let s = 0;
      for (let d = GAS_MONTH_START[7]; d < GAS_YEAR_DAYS; d++) s += hdd(w.temp[d]) - hdd(w.normal[d]);
      expect(winterColder(w)).toBeCloseTo(s, 9);
    }
    // One unseen winter has days warmer than 65 °F, which add no heating degree days.
    expect(winterColder(systemYear(AS_BUILT, TOURNAMENT_SEEDS[7]).weather)).toBeCloseTo(452.6, 1);
  });
});

describe('gas 7.1: the Valley Line’s fifth station', () => {
  it('costs more because every station must push more gas, not because stations add less', () => {
    const n = constructorNumbers();
    expect(n.valley4.cap).toBeCloseTo(0.5, 9);
    expect(cheapestFix('design').after).toBeCloseTo(0.6, 9);
    // The fifth station adds more capacity than the fourth (0.10 against 0.05 Bcf/d)…
    expect(cheapestFix('design').after - n.valley4.cap).toBeGreaterThan(n.valley4.cap - 0.45);
    // …and far more horsepower: 13,100 for the fourth, 49,200 for the fifth.
    expect(Math.round(n.valleyHp.fourth / 100) * 100).toBe(13_100);
    expect(Math.round(n.valleyHp.fifth / 100) * 100).toBe(49_200);
    expect(n.valley4.cost / 1e6).toBeCloseTo(39.3, 1);
    expect(n.design.cost / 1e6).toBeCloseTo(186.9, 1);
    // Metro's users give way in Lesson 4.1's order: interruptible ($8) before industry ($20).
    expect(n.interruptibleOff).toBeGreaterThan(0);
    expect(n.industryOff).toBeGreaterThan(0);
  });
});

describe('gas 7.3: the cold January the forecast underplayed', () => {
  it('had four of its thirteen breakaway days inside the two-week forecast, which leaned cold but not nearly enough', () => {
    const t = roundTally(AS_BUILT, TALLY_DEFAULTS.skill);
    const big = t.rounds.reduce((b, r) => (Math.abs(r.market.basis - r.actual.basis) > Math.abs(b.market.basis - b.actual.basis) ? r : b));
    expect(big).toMatchObject({ winter: 0, month: 9 });
    expect(roundBreakaways(AS_BUILT, big)).toEqual({ inside: 4, after: 9 });
    expect(big.actual.fullDays).toBe(13);
    expect(big.fcTemp).toBeCloseTo(25.3, 1);
    expect(big.normalTemp).toBeCloseTo(28.6, 1);
    expect(big.actTemp).toBeCloseTo(19.4, 1);
    // The forecast's cold lean was less than half the cold that came.
    expect(big.normalTemp - big.fcTemp).toBeLessThan(0.5 * (big.normalTemp - big.actTemp));
    expect(forecastSkill(TALLY_DEFAULTS.skill, 7)).toBeCloseTo(0.45, 2);
  });
});

describe('gas 7.4: what decided each winter, and the guard’s miss', () => {
  it('shows Metro’s highest price, which tracks firm Northline capacity where Northline’s full days don’t', () => {
    const n = pmNumbers(AS_BUILT);
    expect(n.drivers.metroMax.map((x) => Math.round(x * 100) / 100)).toEqual([8, 15, 15, 5.92, 8, 5.3, 15, 100]);
    // Winter 4 had the most full days on Northline and firm capacity earned almost nothing there.
    expect(n.drivers.northlineFull.indexOf(Math.max(...n.drivers.northlineFull))).toBe(3);
    expect(n.firm.years[3].firm.total + n.firmFee).toBeLessThan(10_000);
    // Its best winter is the $100 one.
    const best = n.firm.totals.indexOf(Math.max(...n.firm.totals));
    expect(best).toBe(7);
    expect((n.firm.years[best].firm.total + n.firmFee) / 1e6).toBeCloseTo(1.67, 2);
  });

  it('quotes the first winter’s lease gross and net of its fee', () => {
    const n = pmNumbers(AS_BUILT);
    expect((n.first.storage.fee + n.first.storage.total) / 1e6).toBeCloseTo(3.73, 2);
    expect(n.first.storage.fee / 1e6).toBeCloseTo(2.84, 2);
    expect(Math.round(n.first.storage.total / 1000)).toBe(882);
  });

  it('missed winter 8’s February cold though it fell inside the forecast’s two weeks', () => {
    const n = pmNumbers(AS_BUILT);
    expect(n.metroOpen.totals.indexOf(Math.min(...n.metroOpen.totals))).toBe(7);
    const g = pmGuardMonth(AS_BUILT, 7);
    expect(g.month).toBe(10);
    expect(g.signal).toBeCloseTo(-0.43, 2);
    expect(g.coldDay).toBe(7);
    expect(g.coldTemp).toBeCloseTo(-2.2, 1);
    expect(g.inWindow).toBe(true);
    // The guard sold anyway, and lost as much as the open sale.
    expect(n.metroGuarded.totals[7]).toBeCloseTo(n.metroOpen.totals[7], 0);
  });

  it('blames winter 4 on the lease, not on the firm capacity that lost the same in most winters', () => {
    const n = pmNumbers(AS_BUILT);
    const worst = n.ref.totals.indexOf(Math.min(...n.ref.totals));
    expect(worst).toBe(3);
    expect(pmShortfall(n.ref, PORTFOLIO_DEFAULTS, worst)).toBe('storage');
    expect(Math.round(n.ref.years[worst].storage.total / 1000)).toBe(173);
    expect(Math.round(partMean(n.ref, 'storage') / 1000)).toBe(967);
  });

  it('prices Ridgeback Express capacity with the stranded basin already in April’s curve', () => {
    const n = pmNumbers(AS_BUILT);
    expect(n.expressFee / 1e6).toBeCloseTo(7.48, 2);
    expect(Math.round(n.express.mean / 1000)).toBe(177);
    expect(Math.abs(n.express.mean)).toBeLessThan(0.1 * n.expressFee);
    // On the cheapest network the basin's gas gets out and Express capacity has nothing to trade.
    const f = pmNumbers(FIX);
    expect(f.expressFee).toBeLessThan(50_000);
    expect(Math.abs(f.express.mean)).toBeLessThan(1000);
  });
});

describe('gas 7.5: insurance written both ways', () => {
  it('shows the insurer desk losing in cold winters and the guarded sale standing aside in the coldest', () => {
    const desks = tournamentDesks(AS_BUILT, PORTFOLIO_DEFAULTS, 'unseen');
    const byId = Object.fromEntries(desks.map((d) => [d.id, d]));
    const cm = tournamentColdMild(desks[0].run, byId.insurer.run);
    expect(Math.round(cm.firm[0] / 1000)).toBe(500);
    expect(Math.round(cm.firm[1] / 1000)).toBe(-9);
    expect(Math.round(cm.insurer[0] / 1000)).toBe(-403);
    expect(Math.round(cm.insurer[1] / 1000)).toBe(-7);
    expect(Math.round(cm.metro[0] / 1000)).toBe(-10);
    expect(Math.round(cm.metro[1] / 1000)).toBe(11);
    expect(cm.idleColdest).toBe(2);
    // The hedged storage desk: one losing winter, and its fee had already paid April's value.
    const st = byId.storage.run.result;
    expect(Math.round(st.winRate * 12)).toBe(11);
    expect(Math.round(st.worst / 1000)).toBe(-94);
    // The weather desk bet on the forecast, not the winter: the best worst winter, in profit in all 12 (October–April trades only).
    expect(Math.round(byId.forecaster.run.result.winRate * 12)).toBe(12);
    expect(byId.forecaster.run.result.worst).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Fix pass 2: the challenges, the figures and the capstone's saved state.

afterEach(() => {
  cleanup();
  resetGasSystem();
  resetGasPortfolio();
});

describe('gas chapter 7: weather trades in the heating months, as Lesson 6.1 trades them', () => {
  it('trades only October to April', () => {
    expect(HEATING_MONTHS).toEqual([0, 6, 7, 8, 9, 10, 11]);
    for (const seed of PRACTICE_SEEDS) {
      const y = portfolioYear(AS_BUILT, seed, { ...PASSIVE, weatherLots: 10 });
      [1, 2, 3, 4, 5].forEach((m) => expect(y.weather.monthly[m]).toBe(0));
    }
    expect(tournamentPortfolioWords(PORTFOLIO_DEFAULTS)).toContain('October to April');
  });
});

describe('gas chapter 7: the shared pieces', () => {
  it('fixes Lesson 7.1’s cheapest network as the two cheapest fixes', () => {
    const g = cheapestFix('glut');
    const d = cheapestFix('design');
    expect(CHEAPEST_NETWORK).toEqual({ sizes: { ...AS_BUILT.sizes, [g.id]: g.size, [d.id]: d.size }, stations: { ...AS_BUILT.stations, [g.id]: g.stations, [d.id]: d.stations } });
    expect(constructorSolved(CHEAPEST_NETWORK)).toBe(true);
    expect(networkChangesShort(CHEAPEST_NETWORK)).toEqual(['Coastal Line, 4 stations', 'Valley Line, 5 stations']);
    expect(networkChangesShort(AS_BUILT)).toEqual([]);
  });

  it('says what the portfolio holds and whether it is the starting one', () => {
    expect(isStartingPortfolio(PORTFOLIO_DEFAULTS)).toBe(true);
    expect(isStartingPortfolio({ ...PORTFOLIO_DEFAULTS, toll: true })).toBe(false);
    expect(portfolioShort(PORTFOLIO_DEFAULTS)).toBe('1.0 Bcf lease, hedged, 10,000 MMBtu/d firm on Northline, 10 lots of weather trades, 10,000 MMBtu/d of Metro basis sold');
    expect(portfolioShort({ ...PASSIVE, storageShare: pmShare(0.75), toll: true })).toBe('0.75 Bcf lease, hedged, Lakeside toll');
    expect(portfolioShort(PASSIVE)).toBe('no positions');
  });

  it('asks before it resets, and Cancel leaves things alone', () => {
    const onConfirm = vi.fn();
    const v = render(createElement(ConfirmReset, { label: 'Reset portfolio', prompt: 'Put back the starting portfolio?', onConfirm }));
    fireEvent.click(v.getByRole('button', { name: 'Reset portfolio' }));
    expect(v.getByText('Put back the starting portfolio?')).toBeTruthy();
    fireEvent.click(v.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(v.getByRole('button', { name: 'Reset portfolio' }));
    fireEvent.click(v.getByRole('button', { name: 'Reset portfolio' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('gas 7.2: Metro’s worst day, and who gains against the cheapest network', () => {
  it('has Metro’s highest price on the design morning, as built and on the cheapest network', () => {
    expect(rmPeak(AS_BUILT)).toEqual({ price: 100, days: [{ winter: 7, day: 313 }] });
    expect(rmPeak(CHEAPEST_NETWORK)).toEqual({ price: 20, days: [{ winter: 7, day: 313 }] });
    const built = systemYear(AS_BUILT, PRACTICE_SEEDS[7]).days[313];
    const cheap = systemYear(CHEAPEST_NETWORK, PRACTICE_SEEDS[7]).days[313];
    expect(rmFullIntoMetro(AS_BUILT, built)).toEqual(['sandhill-metro', 'calder-metro']);
    expect(rmFullIntoMetro(CHEAPEST_NETWORK, cheap)).toEqual(['calder-metro']);
    expect(rmPriceWords(100, built.price.calder)).toBe('what rationing its homes costs');
    expect(rmPriceWords(20, cheap.price.calder)).toBe('the value of the industry that gives way');
    expect(rmPriceWords(15, 5)).toBe('where its power plants switch to oil');
  });

  it('is unsolved by default, solved on the day, and not a day off or on the other network', () => {
    expect(regionalMarketSolved(REGIONAL_MARKET_DEFAULTS, AS_BUILT)).toBe(false);
    expect(regionalMarketSolved({ winter: 7, network: 'yours', day: 313 }, AS_BUILT)).toBe(true);
    expect(regionalMarketSolved({ winter: 7, network: 'built', day: 313 }, AS_BUILT)).toBe(true);
    expect(regionalMarketSolved({ winter: 7, network: 'yours', day: 312 }, AS_BUILT)).toBe(false);
    expect(regionalMarketSolved({ winter: 7, network: 'yours', day: 314 }, AS_BUILT)).toBe(false);
    expect(regionalMarketSolved({ winter: 6, network: 'yours', day: 313 }, AS_BUILT)).toBe(false);
    expect(regionalMarketSolved({ winter: 7, network: 'yours', day: 313 }, CHEAPEST_NETWORK)).toBe(true);
    expect(regionalMarketSolved({ winter: 7, network: 'built', day: 313 }, CHEAPEST_NETWORK)).toBe(false);
  });

  it('quotes the cheapest network’s ledger when the reader’s is still the one as built', () => {
    const b = rmEight(AS_BUILT);
    const m = rmEight(CHEAPEST_NETWORK);
    expect((m.producers - b.producers) / 1e9).toBeCloseTo(2.91, 2);
    expect((m.rents - b.rents) / 1e9).toBeCloseTo(-2.81, 2);
    expect((m.metroBill - b.metroBill) / 1e6).toBeCloseTo(-44.0, 1);
    expect(m.capital / 1e6).toBeCloseTo(27.5, 1);
    expect(b.calder).toBeCloseTo(3.42, 2);
    expect(m.calder).toBeCloseTo(3.45, 2);
    expect([b.rationedDays, m.rationedDays]).toEqual([1, 0]);
  });
});

describe('gas 7.3: a revealed round stays locked', () => {
  it('has no members switch, and keeps a revealed round locked through a reset', async () => {
    expect('members' in FORECAST_CHALLENGE_DEFAULTS).toBe(false);
    const v = render(createElement(L7_3));
    expect(v.queryByRole('button', { name: 'Forget rounds' })).toBeNull();
    expect(v.container.querySelectorAll('input[type="range"]').length).toBe(5);
    await act(async () => {
      fireEvent.click(v.getByRole('button', { name: 'Reveal' }));
    });
    const revealed = v.getByRole('button', { name: 'Revealed' }) as HTMLButtonElement;
    expect(revealed.disabled).toBe(true);
    // The three forecasts give way to the score table; only the two skill sliders remain.
    expect(v.container.querySelectorAll('input[type="range"]').length).toBe(2);
    await act(async () => {
      fireEvent.click(v.getAllByRole('button', { name: 'Reset' })[0]);
    });
    expect((v.getByRole('button', { name: 'Revealed' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('gas 7.4: more for the same cash', () => {
  it('sets its targets from the starting portfolio on the reader’s network', () => {
    expect(pmTarget(AS_BUILT)).toEqual({ mean: 1_210_000, capital: 7_530_000 });
    expect(pmTarget(CHEAPEST_NETWORK)).toEqual({ mean: 960_000, capital: 7_690_000 });
  });

  it('is not solved by the start or by any one change to it on the network as built', () => {
    const d = PORTFOLIO_DEFAULTS;
    expect(portfolioManagerSolved(AS_BUILT, d)).toBe(false);
    const oneClick = [
      { ...d, toll: true },
      { ...d, firmMMBtuD: 0 },
      { ...d, metroSellMMBtuD: 0 },
      { ...d, metroSkipColderF: null },
      { ...d, firmLine: 'ridgeback-calder' as const },
      { ...d, storageHedged: false },
      { ...d, weatherLots: 50 },
      { ...d, storageShare: pmShare(0.75) },
      { ...d, storageShare: pmShare(1.25) },
    ];
    oneClick.forEach((p) => expect(portfolioManagerSolved(AS_BUILT, p)).toBe(false));
    // The toll alone added: $1.87 million a winter, but $11.0 million of cash.
    const toll = pmEight(AS_BUILT, { ...d, toll: true });
    expect(toll.mean / 1e6).toBeCloseTo(1.87, 2);
    expect(toll.peakCapital / 1e6).toBeCloseTo(10.99, 2);
  });

  it('is solved by moving cash from the lease to the toll, and missed either side of it', () => {
    const swapped = { ...PASSIVE, storageShare: pmShare(0.5), toll: true, weatherLots: 10 };
    const e = pmEight(AS_BUILT, swapped);
    expect(portfolioManagerSolved(AS_BUILT, swapped)).toBe(true);
    expect(e.mean / 1e6).toBeCloseTo(1.41, 2);
    expect(e.peakCapital / 1e6).toBeCloseTo(7.14, 2);
    expect(e.wins).toBe(8);
    // Too much lease needs too much cash; too little earns too little.
    expect(portfolioManagerSolved(AS_BUILT, { ...swapped, storageShare: pmShare(0.75) })).toBe(false);
    expect(pmEight(AS_BUILT, { ...swapped, storageShare: pmShare(0.75) }).peakCapital).toBeGreaterThan(pmTarget(AS_BUILT).capital);
    expect(portfolioManagerSolved(AS_BUILT, { ...swapped, storageShare: pmShare(0.25) })).toBe(false);
    expect(pmEight(AS_BUILT, { ...swapped, storageShare: pmShare(0.25) }).mean).toBeLessThan(pmTarget(AS_BUILT).mean);
  });

  it('ranks the positions by what they earn for their cash, as the prose quotes them', () => {
    const n = pmNumbers(AS_BUILT);
    expect(n.weather.returnOnCash).toBeCloseTo(0.389, 3);
    expect(n.toll.returnOnCash).toBeCloseTo(0.249, 3);
    expect(n.lease.returnOnCash).toBeCloseTo(0.136, 3);
    expect(Math.round(n.firm.returnOnCash * 100)).toBe(-1);
    expect(Math.round(n.metroGuarded.returnOnCash * 100)).toBe(-1);
    expect(n.ref.returnOnCash).toBeCloseTo(0.134, 3);
  });

  it('can be solved on the cheapest network, where Metro’s basis is the one to sell', () => {
    expect(portfolioManagerSolved(CHEAPEST_NETWORK, PORTFOLIO_DEFAULTS)).toBe(false);
    expect(portfolioManagerSolved(CHEAPEST_NETWORK, { ...PASSIVE, storageShare: pmShare(1), weatherLots: 10, metroSellMMBtuD: 20_000, metroSkipColderF: null })).toBe(true);
  });

  it('resets only the portfolio, after asking', async () => {
    updateGasSystem(() => ({ sizes: { ...CHEAPEST_NETWORK.sizes }, stations: { ...CHEAPEST_NETWORK.stations } }));
    updateGasPortfolio((p) => ({ ...p, toll: true }));
    const v = render(createElement(L7_4));
    expect(v.getAllByText(/differs from the starting one/).length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(v.getAllByRole('button', { name: 'Reset portfolio' })[0]);
    });
    expect(getGasCapstone().portfolio.toll).toBe(true);
    await act(async () => {
      fireEvent.click(v.getAllByRole('button', { name: 'Reset portfolio' })[0]);
    });
    expect(getGasCapstone().portfolio).toEqual(PORTFOLIO_DEFAULTS);
    expect(getGasCapstone().system).toEqual(CHEAPEST_NETWORK);
  });
});

describe('gas 7.5: the unseen winters wait for the decision', () => {
  it('hides the unseen column until the challenge is solved', async () => {
    const v = render(createElement(L7_5));
    const header = () => Array.from(v.container.querySelectorAll('th')).map((t) => t.textContent);
    expect(header()).toContain('eight practice winters');
    expect(header().filter((h) => h === 'twelve unseen winters')).toHaveLength(0);
    for (const name of [/keep the firm capacity/, /keep the sale of Metro/]) {
      await act(async () => {
        fireEvent.click(v.getByLabelText(name));
      });
    }
    expect(v.container.querySelector('.chal-st.ok')).not.toBeNull();
    expect(header()).toContain('twelve unseen winters');
  });
});
