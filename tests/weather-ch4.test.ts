// Claims in the weather course's chapter 4 prose and challenge text, checked against the model.

import { describe, expect, it } from 'vitest';
import { MONTH_DEFAULTS, NORMAL_SHIFT, SWING_HINT, SWING_TARGET, monthNormal, monthRecord, normalShiftSolved, spreadIndex, swingSolved } from '../src/lessons/weather/ch4/L4_1';
import { COLDEST_WINTER, DAY_DEFAULTS, dayOf, oilSolved, pipelineSolved, winterRun } from '../src/lessons/weather/ch4/L4_2';
import { PRICE_FLEXIBILITY, marlowSeasons, profitSd, steadiestSolved } from '../src/lessons/weather/ch4/L4_3';
import { CHALLENGE_LEAD, forecastSd, mostUncertainSpeed, uncertaintySolved } from '../src/lessons/weather/ch4/L4_4';
import {
  INDEX_DEFAULTS,
  RISK_DEFAULTS,
  SHORTFALL_TARGET,
  VARIABILITY_HINT,
  VARIABILITY_STEP,
  bestIndexSolved,
  indexFit,
  relativeRisk,
  riskOf,
  steadinessDrivers,
  variabilitySolved,
  type Business,
} from '../src/lessons/weather/ch4/L4_5';
import { utilityDollarsPerHdd } from '../src/engines/weather/exposure';
import { FARM } from '../src/engines/weather/crops';
import { TURBINE, outputUnderUncertainty, solarDayMWh } from '../src/engines/weather/renewables';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('weather 4.2: the winter of prices', () => {
  it('the 15 °F line marks a day that fills the pipelines past 90%, and colder days cost more', () => {
    const d15 = dayOf({ ...DAY_DEFAULTS, meanF: 15 });
    expect(d15.utilization).toBeGreaterThan(0.9);
    expect(dayOf({ ...DAY_DEFAULTS, meanF: 10 }).gas).toBeGreaterThan(d15.gas + 2);
  });

  it('a calmer winter raises the coldest day’s gas a little, not a lot', () => {
    const own = winterRun({ winter: COLDEST_WINTER, pipeline: 1.4, windScale: 1 });
    const calm = winterRun({ winter: COLDEST_WINTER, pipeline: 1.4, windScale: 0.6 });
    expect(calm.maxGas).toBeGreaterThan(own.maxGas);
    expect(calm.maxGas / own.maxGas - 1).toBeLessThan(0.2);
  });
});

describe('weather 4.3: the archive’s heat and rain, and the cost of the natural hedge', () => {
  it('the hotter half of the archive’s summers is no drier than the cooler half', () => {
    const byHeat = [...marlowSeasons(0, 1, 0.02)].sort((a, b) => a.heatDD - b.heatDD);
    const cool = byHeat.slice(0, 20);
    const hot = byHeat.slice(-20);
    expect(mean(hot.map((s) => s.rainIn))).toBeGreaterThanOrEqual(mean(cool.map((s) => s.rainIn)));
  });

  it('at the steadiest shares the farm earns less on average, selling its big harvests cheap', () => {
    const at2 = marlowSeasons(0, 1, 0.02);
    const priceReceived = (ss: typeof at2) => ss.reduce((a, s) => a + s.bushels * s.price, 0) / ss.reduce((a, s) => a + s.bushels, 0);
    expect(steadiestSolved({ share: 0.02, warm: 0, rainScale: 1 })).toBe(false);
    for (const share of [0.38, 0.39, 0.4]) {
      expect(steadiestSolved({ share, warm: 0, rainScale: 1 })).toBe(true);
      const ss = marlowSeasons(0, 1, share);
      expect(mean(ss.map((s) => s.profit))).toBeLessThan(0.6 * mean(at2.map((s) => s.profit)));
      expect(priceReceived(ss)).toBeLessThan(priceReceived(at2));
      expect(priceReceived(ss)).toBeLessThan(FARM.basePrice);
    }
  });
});

describe('weather 4.4: solar heat, and forecast uncertainty', () => {
  it('heat from 0 °C to 35 °C costs less than overcast but more than half cloud', () => {
    const clear = solarDayMWh(171, 0, 25);
    const heatCost = 1 - solarDayMWh(171, 0, 35) / solarDayMWh(171, 0, 0);
    expect(heatCost).toBeLessThan(1 - solarDayMWh(171, 1, 25) / clear);
    expect(heatCost).toBeGreaterThan(1 - solarDayMWh(171, 0.5, 25) / clear);
    expect(Math.round(heatCost * 100)).toBe(12);
  });

  it('a 4 m/s forecast three days out is likely, not certain, to stay small', () => {
    const o = outputUnderUncertainty(4, forecastSd(3));
    expect(o.p90).toBeGreaterThan(0.05);
    expect(o.p90).toBeLessThan(0.2);
  });

  it('the most uncertain speed sits about one forecast error below rated', () => {
    const v = mostUncertainSpeed(CHALLENGE_LEAD);
    const sd = forecastSd(CHALLENGE_LEAD);
    expect(v).toBe(10);
    expect(Math.abs(TURBINE.rated - v - sd)).toBeLessThan(0.15);
    expect(uncertaintySolved({ speed: 8, lead: CHALLENGE_LEAD })).toBe(false);
    expect(uncertaintySolved({ speed: v, lead: CHALLENGE_LEAD })).toBe(true);
  });
});

describe('weather 4.5: steadiness against budget, and variability', () => {
  it('the gas utility, not the wind farm, is steadiest relative to budget', () => {
    const all: Business[] = ['utility', 'farm', 'wind'];
    const sd = all.map((b) => relativeRisk(b).sd);
    const short = all.map((b) => relativeRisk(b).shortfall);
    expect(sd.indexOf(Math.min(...sd))).toBe(0);
    expect(short.indexOf(Math.min(...short))).toBe(0);
    expect(relativeRisk('wind').sd).toBeGreaterThan(relativeRisk('utility').sd + 0.01);
    // In dollars the wind farm's swings are the smaller sums.
    const wind = riskOf({ ...RISK_DEFAULTS, business: 'wind' });
    const util = riskOf({ ...RISK_DEFAULTS, business: 'utility' });
    expect(wind.summary.sd).toBeLessThan(util.summary.sd);
    expect(wind.shortfall).toBeLessThan(util.shortfall);
  });

  it('the wind is steadier than the cold, but the power curve and the fixed base reverse the order', () => {
    const d = steadinessDrivers();
    expect(d.windCv).toBeLessThan(d.hddCv);
    expect(d.windElasticity).toBeGreaterThan(1.5);
    expect(d.windElasticity).toBeLessThan(2);
    expect(d.baseShare).toBeGreaterThan(0.15);
    expect(d.baseShare).toBeLessThan(0.3);
  });

  it('the 1-in-20 shortfall grows with variability, but not in proportion, because ENSO’s part doesn’t scale', () => {
    expect(variabilitySolved(RISK_DEFAULTS)).toBe(false);
    expect(variabilitySolved({ ...RISK_DEFAULTS, variability: 1.45 })).toBe(false);
    expect(variabilitySolved({ ...RISK_DEFAULTS, variability: 1.5 })).toBe(true);
    const short = (variability: number, ensoF = RISK_DEFAULTS.ensoF) => riskOf({ ...RISK_DEFAULTS, variability, ensoF }).shortfall;
    const grow15 = short(1.5) / short(1) - 1;
    expect(grow15).toBeGreaterThan(0.25);
    expect(grow15).toBeLessThan(0.5);
    // Without ENSO the shortfall grows faster with the variability than with it.
    expect(short(2, 0) / short(1, 0)).toBeGreaterThan(short(2) / short(1) + 0.1);
  });
});

// Pass 2: the challenges ask for a prediction from each lesson's own linear rule.

describe('weather 4.1 challenges: one degree day per degree per day', () => {
  const start = monthRecord(MONTH_DEFAULTS);
  const normal = monthNormal(MONTH_DEFAULTS.month).hdd;

  it('every day of the starting January is below 65 °F, so a degree colder adds 31', () => {
    expect(Math.max(...start.temps)).toBeLessThan(65 - 10);
    expect(monthRecord({ ...MONTH_DEFAULTS, shift: -1 }).hdd - start.hdd).toBeCloseTo(31, 6);
  });

  it('the predicted shift, (normal − actual) ÷ 31 ≈ 2.9 °F, is the 3 °F step that solves', () => {
    const predicted = (normal - start.hdd) / 31;
    expect(predicted.toFixed(1)).toBe('2.9');
    expect(Math.round(predicted * 2) / 2).toBe(3);
    expect(NORMAL_SHIFT).toBe(-3);
    expect(normalShiftSolved(MONTH_DEFAULTS)).toBe(false);
    expect(normalShiftSolved({ ...MONTH_DEFAULTS, shift: -3 })).toBe(true);
    for (const shift of [-2.5, -3.5, 3]) expect(normalShiftSolved({ ...MONTH_DEFAULTS, shift })).toBe(false);
    expect(normalShiftSolved({ ...MONTH_DEFAULTS, year: 21, shift: -3 })).toBe(false);
    // The shifted month lands within 4 degree days of normal; the next step warmer misses by more than 11.
    expect(Math.abs(monthRecord({ ...MONTH_DEFAULTS, shift: -3 }).hdd - normal)).toBeLessThan(4);
    expect(normal - monthRecord({ ...MONTH_DEFAULTS, shift: -2.5 }).hdd).toBeGreaterThan(11);
  });

  it('those 3 degrees are worth about $5.0 million of margin', () => {
    const gain = monthRecord({ ...MONTH_DEFAULTS, shift: -3 }).margin - start.margin;
    expect((gain / 1e6).toFixed(1)).toBe('5.0');
  });

  it('on the hinge, degree days grow in proportion to the swing: 67 at ±5 °F predicts ±7.5 °F for 100', () => {
    const hint = spreadIndex({ mean: 65, swing: SWING_HINT });
    expect(Math.round(hint.hdd)).toBe(67);
    expect(((SWING_HINT * SWING_TARGET) / Math.round(hint.hdd)).toFixed(1)).toBe('7.5');
    expect(spreadIndex({ mean: 65, swing: 7.5 }).hdd / spreadIndex({ mean: 65, swing: 5 }).hdd).toBeCloseTo(1.5, 9);
    expect(spreadIndex({ mean: 65, swing: 7.5 }).cdd).toBeCloseTo(spreadIndex({ mean: 65, swing: 7.5 }).hdd, 9);
    expect(swingSolved({ mean: 61.5, swing: 5.5 })).toBe(false);
    expect(swingSolved({ mean: 65, swing: 7.5 })).toBe(true);
    for (const swing of [7, 8]) expect(swingSolved({ mean: 65, swing })).toBe(false);
    expect(swingSolved({ mean: 64.5, swing: 7.5 })).toBe(false);
  });
});

describe('weather 4.2 challenges, with the sky held partly cloudy', () => {
  it('the oil crossover is still 12 °F, and the default day is not it', () => {
    expect(oilSolved(DAY_DEFAULTS)).toBe(false);
    expect(oilSolved({ ...DAY_DEFAULTS, meanF: 12 })).toBe(true);
    for (const meanF of [11, 13]) expect(oilSolved({ ...DAY_DEFAULTS, meanF })).toBe(false);
  });

  it('1.55 million MMBtu a day is the least pipeline, and each step of capacity does less than the one before', () => {
    const at = (pipeline: number) => winterRun({ winter: COLDEST_WINTER, pipeline, windScale: 1 }).maxGas;
    expect(pipelineSolved({ winter: COLDEST_WINTER, pipeline: 1.4, windScale: 1 })).toBe(false);
    expect(pipelineSolved({ winter: COLDEST_WINTER, pipeline: 1.55, windScale: 1 })).toBe(true);
    for (const pipeline of [1.5, 1.6]) expect(pipelineSolved({ winter: COLDEST_WINTER, pipeline, windScale: 1 })).toBe(false);
    const steps = [1.4, 1.45, 1.5, 1.55, 1.6].map(at);
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i - 1] - steps[i]).toBeGreaterThan(steps[i] - steps[i + 1]);
    expect(at(1.6)).toBeLessThan(10);
  });
});

describe('weather 4.3 challenge: 2.5 × share = 1', () => {
  it('the predicted 40% solves; its neighbors and the default don’t', () => {
    expect(PRICE_FLEXIBILITY * 0.4).toBeCloseTo(1, 12);
    expect(steadiestSolved({ share: 0.02, warm: 0, rainScale: 1 })).toBe(false);
    expect(steadiestSolved({ share: 0.4, warm: 0, rainScale: 1 })).toBe(true);
    for (const share of [0.37, 0.41]) expect(steadiestSolved({ share, warm: 0, rainScale: 1 })).toBe(false);
    expect(steadiestSolved({ share: 0.4, warm: 0.5, rainScale: 1 })).toBe(false);
  });

  it('the rounded figures the prose quotes', () => {
    const k = (x: number) => Math.round(x / 1000) * 1000;
    const at = (share: number) => marlowSeasons(0, 1, share);
    expect(k(mean(at(0.02).map((s) => s.profit)))).toBe(70_000);
    expect(k(profitSd(0.02))).toBe(187_000);
    expect(k(profitSd(0.4))).toBe(28_000);
    expect(k(-Math.min(...at(0.4).map((s) => s.profit)))).toBe(45_000);
    expect(k(profitSd(0.5))).toBe(63_000);
    expect(k(mean(at(0.4).map((s) => s.profit)))).toBe(36_000);
  });
});

describe('weather 4.4 challenge: about one forecast error below rated', () => {
  it('the error the question quotes is ±2.0 m/s', () => {
    expect(forecastSd(CHALLENGE_LEAD).toFixed(1)).toBe('2.0');
    expect(uncertaintySolved({ speed: 8, lead: CHALLENGE_LEAD })).toBe(false);
    for (const speed of [9.5, 10.5, 12]) expect(uncertaintySolved({ speed, lead: CHALLENGE_LEAD })).toBe(false);
  });
});

describe('weather 4.5 challenges: a straight line, and the best index', () => {
  const short = (variability: number) => riskOf({ ...RISK_DEFAULTS, business: 'utility', variability }).shortfall;

  it('extending the line through × 0.5 and × 1 predicts × 1.5; proportion would have said × 1.35', () => {
    const lo = short(VARIABILITY_HINT);
    const one = short(1);
    expect((lo / 1e6).toFixed(1)).toBe('11.9');
    expect((one / 1e6).toFixed(1)).toBe('18.5');
    const predicted = 1 + ((SHORTFALL_TARGET - one) / (one - lo)) * (1 - VARIABILITY_HINT);
    expect(predicted).toBeGreaterThan(1.45);
    expect(predicted).toBeLessThan(1.5);
    expect(Math.ceil(predicted / VARIABILITY_STEP - 1e-9) * VARIABILITY_STEP).toBeCloseTo(1.5, 9);
    expect((SHORTFALL_TARGET / one).toFixed(2)).toBe('1.35');
    expect(short(1.35)).toBeLessThan(SHORTFALL_TARGET);
    expect(variabilitySolved(RISK_DEFAULTS)).toBe(false);
    expect(variabilitySolved({ ...RISK_DEFAULTS, variability: 1.5 })).toBe(true);
    for (const variability of [1.35, 1.45, 1.55]) expect(variabilitySolved({ ...RISK_DEFAULTS, variability })).toBe(false);
    expect(variabilitySolved({ ...RISK_DEFAULTS, business: 'farm', variability: 1.5 })).toBe(false);
  });

  it('Marlow’s own heat index explains the most; the others are near misses', () => {
    expect(bestIndexSolved(INDEX_DEFAULTS)).toBe(false);
    expect(bestIndexSolved({ business: 'farm', farmIndex: 'heat' })).toBe(true);
    expect(bestIndexSolved({ business: 'farm', farmIndex: 'rain' })).toBe(false);
    expect(bestIndexSolved({ business: 'farm', farmIndex: 'fenwickCdd' })).toBe(false);
    expect(bestIndexSolved({ business: 'utility', farmIndex: 'heat' })).toBe(false);
    const heat = indexFit({ business: 'farm', farmIndex: 'heat' });
    expect(Math.round(-heat.slope / 1000) * 1000).toBe(4000);
    expect(Math.round(heat.residualSd / 1000)).toBe(115);
  });

  it('the utility’s fitted slope rounds to a little more than $54,000 a degree day', () => {
    const fit = indexFit({ business: 'utility', farmIndex: 'heat' });
    expect(utilityDollarsPerHdd()).toBe(54_000);
    expect(Math.round(fit.slope / 1000) * 1000).toBe(56_000);
  });
});
