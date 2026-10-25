// Natural gas, chapter 2: numbers quoted in the prose after the first fix pass, the horizontal-well
// demonstration of Lesson 2.1, and (second pass) the predict-then-check challenges, the locked-in
// forecast of 2.3, the plan selector of 2.4 and the ethane-price chart of 2.5.

import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fmt, pct, usd } from '../src/framework';
import { arpsEur, fitArps, ridgebackMonthly, sumBcf } from '../src/engines/gas/decline';
import { zFactor } from '../src/engines/gas/eos';
import { COMPONENT, PIPELINE_SPEC, gasProperties } from '../src/engines/gas/properties';
import { mmbtuPerGallon, processGas } from '../src/engines/gas/processing';
import {
  LINEAR_FLOW_CONSTANT,
  drainageRadius,
  fractureFaceArea,
  fractureFlowDistance,
  fracturedWellRate,
  gasViscosity,
  pOverZ,
  wellRate,
} from '../src/engines/gas/reservoir';
import { gaussian, rng } from '../src/model/random';
import { NGL_PRICES, RAW_WATER, RIDGEBACK_FRACS, RIDGEBACK_PI, RIDGEBACK_RAW, RIDGEBACK_ROCK, SANDHILL_PI, SANDHILL_ROCK } from '../src/model/gas/production';
import { BASINS, PIPELINE } from '../src/model/gas/world';
import {
  DEF_RATE,
  HORIZONTAL_DEFAULTS,
  PWF,
  ROCK_DEFAULTS,
  STAGES_MAX,
  explorerRate,
  fieldNumbers,
  horizontalRate,
  horizontalWell,
  leastPermSolved,
  permOf,
  permText,
  rateText,
} from '../src/lessons/gas/ch2/L2_1';
import {
  PZ_CROSSOVER,
  P_DROP_FIRST,
  STEADY_ESTIMATE,
  STEADY_MONTHS,
  WELL_DEFAULTS,
  Z_DISCOVERY,
  Z_LOW,
  capPressure,
  runWell,
  steadySolved,
} from '../src/lessons/gas/ch2/L2_2';
import {
  ACTUAL_BCF,
  FIRST_YEAR_B2,
  FIRST_YEAR_EXP,
  FIT_LIMIT_SHOWN,
  FORECAST_DEFAULTS,
  HISTORY,
  MIN_SOLVING_DMIN,
  SEEN,
  SOLVING_B_CAPS,
  bestFit,
  fitError,
  forecastSolved,
  lockedSolved,
} from '../src/lessons/gas/ch2/L2_3';
import { ECON_DEFAULTS, FIELD_DEFAULTS, LEAN_YEARS, fieldSolved, planYears } from '../src/lessons/gas/ch2/L2_4';
import {
  CHALLENGE_GAS,
  DEEP,
  ETHANE_ALONE_SHRINK,
  ETHANE_CENTS,
  FULL_NO_CO2,
  LEAST_SHRINK,
  MIN_ETHANE_ALONE,
  MIN_PROPANE,
  PLANT_DEFAULTS,
  SHRINK_TARGET,
  STANDARD,
  VALUE_DEFAULTS,
  breakevenParts,
  breakevenSolved,
  dayValue,
  leastShrinkSolved,
  lowestPayingCent,
  recoveryGain,
  runPlant,
} from '../src/lessons/gas/ch2/L2_5';

describe('gas 2.1 · horizontal well', () => {
  const vertical = fieldNumbers('ridge', PWF).rate;

  it('fractures a stage every 440 ft, 500 ft either side: twelve stages a mile, 24 for two miles', () => {
    expect(RIDGEBACK_FRACS).toEqual({ stageSpacingFt: 440, halfLengthFt: 500 });
    expect(HORIZONTAL_DEFAULTS).toEqual({ stages: 12 });
    expect(HORIZONTAL_DEFAULTS.stages * RIDGEBACK_FRACS.stageSpacingFt).toBe(5280);
    expect(STAGES_MAX * RIDGEBACK_FRACS.stageSpacingFt).toBe(2 * 5280);
  });

  it('opens 6.0 million ft² of rock face with 12 stages, no gas more than 220 ft from it, an effective 73 ft', () => {
    const w = horizontalWell(12);
    expect(fractureFaceArea(RIDGEBACK_ROCK, w)).toBe(6_000_000);
    expect(RIDGEBACK_FRACS.stageSpacingFt / 2).toBe(220);
    expect(fmt(fractureFlowDistance(w))).toBe('73');
    expect(fmt(LINEAR_FLOW_CONSTANT)).toBe('8,935');
    expect(LINEAR_FLOW_CONSTANT).toBeCloseTo(2 * Math.PI * 1422, 9);
  });

  it('flows 7.2 MMcf/d with 12 stages, about 430 times a vertical well’s 17 Mcf/d, 0.60 MMcf/d a stage', () => {
    expect(rateText(vertical)).toBe('17 Mcf/d');
    expect(rateText(horizontalRate(12))).toBe('7.2 MMcf/d');
    expect(Math.round(horizontalRate(12) / vertical / 10) * 10).toBe(430);
    expect(fmt(horizontalRate(1), 2)).toBe('0.60');
    // Each stage adds the same rate.
    for (const n of [2, 6, 18, 24]) expect(horizontalRate(n)).toBeCloseTo(n * horizontalRate(1), 9);
    expect(rateText(horizontalRate(STAGES_MAX))).toBe('14.4 MMcf/d');
  });

  it('follows the linear form of Darcy’s law, in proportion to permeability', () => {
    const w = horizontalWell(12);
    const pAvg = (RIDGEBACK_PI + PWF) / 2;
    const byHand =
      (RIDGEBACK_ROCK.permMd * 6_000_000 * (RIDGEBACK_PI ** 2 - PWF ** 2)) /
      (8934.69 * (RIDGEBACK_ROCK.tempF + 459.67) * gasViscosity(pAvg, RIDGEBACK_ROCK.tempF) * zFactor(pAvg, RIDGEBACK_ROCK.tempF) * (440 / 6)) /
      1000;
    expect(fracturedWellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, PWF, w)).toBeCloseTo(byHand, 4);
    const doubled = fracturedWellRate({ ...RIDGEBACK_ROCK, permMd: 2 * RIDGEBACK_ROCK.permMd }, RIDGEBACK_PI, PWF, w);
    expect(doubled).toBeCloseTo(2 * fracturedWellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, PWF, w), 9);
    expect(fracturedWellRate(RIDGEBACK_ROCK, 500, PWF, w)).toBe(0);
    expect(fracturedWellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, PWF, horizontalWell(0))).toBe(0);
    // Ridgeback's vertical well is unchanged.
    expect(wellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, PWF)).toBeCloseTo(vertical, 12);
  });

  it('settles across 220 ft of shale in a few years (about three), and across a square mile only after centuries', () => {
    // Time for a pressure drop to reach a distance x: t [hours] = 948 φ μ ct x² / k, at discovery conditions.
    const p = RIDGEBACK_PI;
    const t = RIDGEBACK_ROCK.tempF;
    const cg = 1 / p - (zFactor(p + 1, t) - zFactor(p - 1, t)) / 2 / zFactor(p, t);
    const ct = cg * (1 - RIDGEBACK_ROCK.waterSat);
    const years = (x: number) => (948 * RIDGEBACK_ROCK.porosity * gasViscosity(p, t) * ct * x * x) / RIDGEBACK_ROCK.permMd / 8760;
    expect(years(220)).toBeGreaterThan(2);
    expect(years(220)).toBeLessThan(4);
    expect(years(drainageRadius(640))).toBeGreaterThan(200);
    expect(years(drainageRadius(640))).toBeLessThan(1000);
  });

  it('says “about” Ridgeback’s 300 nanodarcies, since the permeability slider’s nearest stop reads 320', () => {
    expect(permText(RIDGEBACK_ROCK.permMd)).toBe('300 nanodarcies');
    expect(permText(permOf(-3.5))).toBe('320 nanodarcies');
  });
});

describe('gas 2.2 · pressure against P/Z', () => {
  it('loses 153 psi for the first Bcf against P/Z’s 141, while Z falls from 0.907', () => {
    expect(fmt(P_DROP_FIRST)).toBe('153');
    expect(Math.round(pOverZ(SANDHILL_PI, SANDHILL_ROCK.tempF) / runWell(WELL_DEFAULTS).gipBcf)).toBe(141);
    expect(fmt(Z_DISCOVERY, 3)).toBe('0.907');
    expect(zFactor(SANDHILL_PI - 200, SANDHILL_ROCK.tempF)).toBeLessThan(Z_DISCOVERY);
  });

  it('has Z bottom out at 0.876 near 2,400 psia, then climb toward 1', () => {
    expect(fmt(Z_LOW.z, 3)).toBe('0.876');
    expect(Math.round(Z_LOW.p / 100) * 100).toBe(2400);
    expect(zFactor(1000, SANDHILL_ROCK.tempF)).toBeGreaterThan(Z_LOW.z);
    expect(zFactor(200, SANDHILL_ROCK.tempF)).toBeGreaterThan(zFactor(1000, SANDHILL_ROCK.tempF));
  });

  it('has the pressure fall more slowly than P/Z below about 3,300 psia', () => {
    expect(Math.round(PZ_CROSSOVER / 100) * 100).toBe(3300);
    const base = runWell(WELL_DEFAULTS);
    const pzPerBcf = pOverZ(SANDHILL_PI, SANDHILL_ROCK.tempF) / base.gipBcf;
    const months = base.months;
    for (let i = 1; i < months.length - 1; i++) {
      const dp = (months[i].pressure - months[i + 1].pressure) / (months[i + 1].cumBcf - months[i].cumBcf);
      if (months[i].pressure > PZ_CROSSOVER + 60) expect(dp).toBeGreaterThan(pzPerBcf);
      if (months[i + 1].pressure < PZ_CROSSOVER - 60) expect(dp).toBeLessThan(pzPerBcf);
    }
  });
});

describe('gas 2.3 · first year, totals and the forecasting guards', () => {
  it('produces 3.2 Bcf in the first year with b = 0 and 3.9 with b = 2, while the totals spread by a factor of 7.6', () => {
    expect(fmt(FIRST_YEAR_EXP, 1)).toBe('3.2');
    expect(fmt(FIRST_YEAR_B2, 1)).toBe('3.9');
    const e0 = arpsEur({ qi: 15, di: 1.2, b: 0 }).eurBcf;
    const e2 = arpsEur({ qi: 15, di: 1.2, b: 2 }).eurBcf;
    expect(fmt(e0, 1)).toBe('4.5');
    expect(fmt(e2, 1)).toBe('34.4');
    expect(fmt(e2 / e0, 1)).toBe('7.6');
  });

  it('states the fit limit as 24% against the best fit’s 22%, and every curve shown at 24% passes it', () => {
    const seen = HISTORY.slice(0, SEEN);
    const limit = Math.exp(fitError(fitArps(seen), seen) + 0.02) - 1;
    expect(FIT_LIMIT_SHOWN).toBe(0.24);
    expect(limit).toBeGreaterThanOrEqual(0.245);
    expect(pct(Math.exp(fitError(bestFit(), seen)) - 1)).toBe('22%');
  });

  it('needs more than the usual terminal decline: 0.10 per year still leaves 14.8 Bcf, 19% high; 0.14 is the least that solves', () => {
    const d10 = arpsEur({ ...bestFit(), dMin: 0.1 }).eurBcf;
    expect(fmt(d10, 1)).toBe('14.8');
    expect(pct(d10 / ACTUAL_BCF - 1)).toBe('19%');
    expect(MIN_SOLVING_DMIN).toBe(0.14);
    expect(forecastSolved({ ...bestFit(), dMin: 0.13 })).toBe(false);
    expect(forecastSolved({ ...bestFit(), dMin: 0.14 })).toBe(true);
  });
});

describe('gas 2.4 · the type well and its metered history', () => {
  it('totals 12.9 Bcf without downtime against the 12.5 metered, and downtime accounts for the difference', () => {
    const type = ridgebackMonthly(360);
    expect(fmt(sumBcf(type), 1)).toBe('12.9');
    expect(fmt(ACTUAL_BCF, 1)).toBe('12.5');
    // Replay the recorded history's random draws, with and without the months cut short.
    const r = rng(7);
    let noiseOnly = 0;
    let recorded = 0;
    type.forEach((q) => {
      const down = r() < 0.06 ? 0.55 + 0.35 * r() : 1;
      const noisy = q * Math.exp(0.05 * gaussian(r));
      noiseOnly += noisy;
      recorded += noisy * down;
    });
    const toBcf = (x: number) => (x * 365.25) / 12 / 1000;
    expect(toBcf(recorded)).toBeCloseTo(ACTUAL_BCF, 9);
    expect(Math.abs(toBcf(noiseOnly) - sumBcf(type))).toBeLessThan(0.1);
    expect(toBcf(noiseOnly) - toBcf(recorded)).toBeGreaterThan(0.4);
  });
});

describe('gas 2.5 · why the CO2 comes out, ethane’s margin and the basin’s scale', () => {
  it('meets the CO2 rule raw, but deep recovery with none removed drops the Wobbe index to 1,301', () => {
    expect(RIDGEBACK_RAW.co2).toBeLessThanOrEqual(PIPELINE_SPEC.co2Max);
    expect(FULL_NO_CO2.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(['wobbe']);
    expect(fmt(FULL_NO_CO2.wobbe)).toBe('1,301');
    expect(PIPELINE_SPEC.wobbeMin).toBe(1310);
    expect(processGas(RIDGEBACK_RAW, 400, RAW_WATER, { ...STANDARD, ethane: DEEP }).ok).toBe(true);
  });

  it('sells ethane for $0.25, just $0.07 over its $0.18 of heat, less than the $0.08 fee alone', () => {
    const heat = mmbtuPerGallon('ethane') * NGL_PRICES.gas;
    expect(usd(heat, 2)).toBe('$0.18');
    expect(usd(NGL_PRICES.ethane - heat, 2)).toBe('$0.07');
    expect(NGL_PRICES.ethane - heat).toBeLessThan(NGL_PRICES.nglFee);
  });

  it('introduces Ridgeback Express at 220 miles and scales the 400 MMcf/d plant to the basin’s 2.6 Bcf/d', () => {
    expect(PIPELINE['ridgeback-calder'].name).toBe('Ridgeback Express');
    expect(PIPELINE['ridgeback-calder'].lengthMi).toBe(220);
    expect(PIPELINE['ridgeback-calder'].to).toBe('calder');
    const rb = BASINS.find((b) => b.id === 'ridgeback')!.productionBcfd;
    expect(rb).toBe(2.6);
    expect(BASINS.find((b) => b.id === 'sandhill')!.productionBcfd).toBe(0.8);
    expect(fmt((rb * 1000) / 400, 1)).toBe('6.5');
  });
});

// ---------------------------------------------------------------------------
// Second pass: the challenges, predicted then checked.

describe('gas 2.1 · predicting the least permeable rock', () => {
  it('predicts 0.25 md from the 4.0 MMcf/d at 1 md, and the slider has a stop there', () => {
    expect(rateText(DEF_RATE)).toBe('4.0 MMcf/d');
    expect(fmt(1 / DEF_RATE, 2)).toBe('0.25');
    expect(permText(permOf(-0.6))).toBe('0.25 md');
    // The rate is exactly proportional to permeability.
    for (const logK of [-0.6, -0.7, -2, 1.5]) expect(explorerRate({ ...ROCK_DEFAULTS, logK })).toBeCloseTo(DEF_RATE * permOf(logK), 9);
    expect(rateText(explorerRate({ ...ROCK_DEFAULTS, logK: -0.6 }))).toBe('1.0 MMcf/d');
    expect(fmt(explorerRate({ ...ROCK_DEFAULTS, logK: -0.7 }), 2)).toBe('0.80');
  });

  it('starts unsolved, is solved by the prediction, and not one step either side', () => {
    expect(leastPermSolved(ROCK_DEFAULTS)).toBe(false);
    expect(leastPermSolved({ ...ROCK_DEFAULTS, logK: -0.6 })).toBe(true);
    expect(leastPermSolved({ ...ROCK_DEFAULTS, logK: -0.5 })).toBe(false);
    expect(leastPermSolved({ ...ROCK_DEFAULTS, logK: -0.7 })).toBe(false);
  });
});

describe('gas 2.2 · predicting a four-year plateau from the cap pressure', () => {
  const plateau = (cap: number) => runWell({ ...WELL_DEFAULTS, cap }).plateauMonths;

  it('ends the starting well’s 34-month plateau at the 2,650 psia where the rock can just deliver 8 MMcf/d', () => {
    expect(capPressure(WELL_DEFAULTS)).toBe(2650);
    expect(wellRate(SANDHILL_ROCK, 2650, 600)).toBeGreaterThanOrEqual(8);
    expect(wellRate(SANDHILL_ROCK, 2640, 600)).toBeLessThan(8);
    const end = runWell(WELL_DEFAULTS).months[plateau(8) - 1].pressure;
    expect(Math.abs(end - 2650)).toBeLessThan(15);
    // A lower cap holds down to a lower pressure; a cap above the rock's potential can't be held at all.
    expect(capPressure({ ...WELL_DEFAULTS, cap: 6.5 })).toBe(2390);
    expect(capPressure({ ...WELL_DEFAULTS, cap: 7 })).toBe(2470);
    expect(capPressure({ ...WELL_DEFAULTS, cap: 20 })).toBeNull();
  });

  it('wants four years, answered by 6.5 MMcf/d with room on both sides: 53 months against 45 at 7', () => {
    expect(STEADY_MONTHS).toBe(48);
    expect(plateau(6.5)).toBe(53);
    expect(plateau(7)).toBe(45);
    expect(plateau(6)).toBe(61);
    expect(steadySolved(WELL_DEFAULTS)).toBe(false);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6.5 })).toBe(true);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 7 })).toBe(false);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6 })).toBe(false);
    expect(steadySolved({ ...WELL_DEFAULTS, cap: 6.5, k: 5 })).toBe(false);
  });

  it('works the answer by hand: 2,390 psia, P/Z 2,730, 10.4 Bcf, about 52 months', () => {
    expect(STEADY_ESTIMATE.cap).toBe(6.5);
    expect(STEADY_ESTIMATE.p).toBe(2390);
    expect(fmt(STEADY_ESTIMATE.pz)).toBe('2,730');
    expect(fmt(STEADY_ESTIMATE.gp, 1)).toBe('10.4');
    expect(fmt(STEADY_ESTIMATE.months)).toBe('52');
    // The same estimate lands on the right side of four years for the neighboring caps too.
    const pzi = pOverZ(SANDHILL_PI, SANDHILL_ROCK.tempF);
    const perBcf = pzi / runWell(WELL_DEFAULTS).gipBcf;
    for (const cap of [6, 6.5, 7]) {
      const p = capPressure({ ...WELL_DEFAULTS, cap })!;
      const months = ((pzi - pOverZ(p, SANDHILL_ROCK.tempF)) / perBcf) * 1000 / cap / (365.25 / 12);
      expect(Math.abs(months - plateau(cap))).toBeLessThan(2);
      expect(months >= STEADY_MONTHS).toBe(plateau(cap) >= STEADY_MONTHS);
    }
  });
});

describe('gas 2.3 · the locked-in forecast', () => {
  const h = HISTORY.slice(0, SEEN);

  it('starts with nothing locked in, and judges only what is locked', () => {
    expect(FORECAST_DEFAULTS.locked).toBeNull();
    expect(lockedSolved(FORECAST_DEFAULTS.locked)).toBe(false);
    expect(lockedSolved({ qi: FORECAST_DEFAULTS.qi, di: FORECAST_DEFAULTS.di, b: 0 })).toBe(false);
    expect(lockedSolved(bestFit())).toBe(false);
    expect(lockedSolved({ ...bestFit(), dMin: MIN_SOLVING_DMIN })).toBe(true);
    expect(lockedSolved({ ...bestFit(), dMin: 0.13 })).toBe(false);
    expect(lockedSolved(fitArps(h, { bMax: 0.8 }))).toBe(true);
  });

  it('is solved by b held to 0.65–0.85, or a terminal decline of 0.14–0.22, beyond the usual 0.05–0.10', () => {
    expect(SOLVING_B_CAPS).toEqual({ lo: 0.65, hi: 0.85 });
    for (let b = 0.65; b <= 0.85 + 1e-9; b += 0.05) expect(forecastSolved(fitArps(h, { bMax: b }))).toBe(true);
    expect(forecastSolved(fitArps(h, { bMax: 0.6 }))).toBe(false);
    expect(forecastSolved(fitArps(h, { bMax: 0.9 }))).toBe(false);
    for (let d = 5; d <= 10; d++) expect(forecastSolved({ ...bestFit(), dMin: d / 100 })).toBe(false);
    expect(forecastSolved({ ...bestFit(), dMin: 0.22 })).toBe(true);
    expect(forecastSolved({ ...bestFit(), dMin: 0.23 })).toBe(false);
  });

  it('shows a fit error of 24% for the starting curve and 22% for the best, driven by three downtime months', () => {
    expect(pct(Math.exp(fitError({ qi: FORECAST_DEFAULTS.qi, di: FORECAST_DEFAULTS.di, b: 0 }, h)) - 1)).toBe('24%');
    expect(pct(Math.exp(fitError(bestFit(), h)) - 1)).toBe('22%');
    // Replay the history's random draws to find the months cut short by downtime.
    const r = rng(7);
    const down: number[] = [];
    ridgebackMonthly(360).forEach((_, i) => {
      if (r() < 0.06) {
        r();
        if (i < SEEN) down.push(i);
      }
      gaussian(r);
    });
    expect(down).toHaveLength(3);
    // Without them, the best fit misses a typical month by only a few percent.
    const kept = h.map((q, i) => (down.includes(i) ? 0 : q));
    expect(Math.exp(fitError(bestFit(), kept)) - 1).toBeLessThan(0.1);
  });
});

describe('gas 2.4 · the economics figure’s plans', () => {
  it('values the starting plan by default, and the lean or the reader’s plan on request', () => {
    expect(ECON_DEFAULTS).toEqual({ plan: 'starting', price: 2.75, cost: 9_000_000 });
    expect(Object.keys(FIELD_DEFAULTS)).toEqual(['y1', 'y2', 'y3', 'y4', 'y5']);
    expect(planYears('starting', [1, 2, 3, 4, 5])).toEqual([30, 30, 30, 30, 30]);
    expect(planYears('lean', [1, 2, 3, 4, 5])).toEqual(LEAN_YEARS);
    expect(planYears('yours', [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(LEAN_YEARS.reduce((a, b) => a + b, 0)).toBe(104);
    expect(fieldSolved({ y1: 41, y2: 24, y3: 14, y4: 13, y5: 12 })).toBe(true);
  });
});

describe('gas 2.5 · least shrink, and the ethane breakeven at another gas price', () => {
  it('meets the rules with 5.4% shrink at least: all the butane and 71% of the propane, the ethane and CO2 left in', () => {
    expect(MIN_PROPANE).toBe(71);
    expect(pct(LEAST_SHRINK, 1)).toBe('5.4%');
    expect(MIN_ETHANE_ALONE).toBe(90);
    expect(pct(ETHANE_ALONE_SHRINK, 1)).toBe('14.3%');
    expect(SHRINK_TARGET).toBe(0.055);
    // The prediction: (1,173 − 1,100) Btu to shed; all 1.5% of butane sheds 1.5 × (butane − 1,100), propane the rest.
    const excess = gasProperties(RIDGEBACK_RAW).hhv - PIPELINE_SPEC.hhvMax;
    const fromButane = RIDGEBACK_RAW.butane * (COMPONENT.butane.hhv - PIPELINE_SPEC.hhvMax);
    const propaneShare = (excess - fromButane) / (COMPONENT.propane.hhv - PIPELINE_SPEC.hhvMax) / RIDGEBACK_RAW.propane;
    expect(Math.abs(propaneShare * 100 - MIN_PROPANE)).toBeLessThan(2);
  });

  it('starts unsolved; the least-shrink plant and its near-equals solve; ethane-first and CO2 removal don’t', () => {
    expect(leastShrinkSolved(PLANT_DEFAULTS)).toBe(false);
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 71, butane: 100 })).toBe(true);
    // Not only at the butane slider's end: less butane and a little more propane is nearly as good.
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 77, butane: 90 })).toBe(true);
    // Too little propane fails the heating-value rule; no dehydrator fails on water.
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 70, butane: 100 })).toBe(false);
    expect(leastShrinkSolved({ co2: 0, dehydrate: false, ethane: 0, propane: 71, butane: 100 })).toBe(false);
    // Meeting the rules with some ethane out, the CO2 out, or the old answer's extra propane costs too much shrink.
    expect(runPlant({ co2: 0, dehydrate: true, ethane: 10, propane: 57, butane: 100 }).ok).toBe(true);
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 10, propane: 57, butane: 100 })).toBe(false);
    expect(runPlant({ co2: 20, dehydrate: true, ethane: 0, propane: 77, butane: 100 }).ok).toBe(true);
    expect(leastShrinkSolved({ co2: 20, dehydrate: true, ethane: 0, propane: 77, butane: 100 })).toBe(false);
    expect(runPlant({ co2: 80, dehydrate: true, ethane: 0, propane: 94, butane: 100 }).ok).toBe(true);
    expect(leastShrinkSolved({ co2: 80, dehydrate: true, ethane: 0, propane: 94, butane: 100 })).toBe(false);
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 0, propane: 99, butane: 100 })).toBe(false);
    expect(leastShrinkSolved({ co2: 0, dehydrate: true, ethane: 90, propane: 0, butane: 0 })).toBe(false);
  });

  it('takes the $0.288 breakeven apart: $0.182 of heat, the $0.08 fee and $0.025 of fuel', () => {
    const p = breakevenParts(NGL_PRICES.gas);
    expect(usd(p.heat, 3)).toBe('$0.182');
    expect(usd(p.fee, 2)).toBe('$0.08');
    expect(usd(p.fuel, 3)).toBe('$0.025');
    expect(usd(p.total, 3)).toBe('$0.288');
  });

  it('asks for the breakeven at $3.50: $0.232 + $0.08 + $0.032 = $0.344, so 35¢, with margin either side', () => {
    expect(CHALLENGE_GAS).toBe(3.5);
    const p = breakevenParts(CHALLENGE_GAS);
    expect(usd(p.heat, 3)).toBe('$0.232');
    expect(usd(p.fuel, 3)).toBe('$0.032');
    expect(usd(p.total, 3)).toBe('$0.344');
    expect(lowestPayingCent(CHALLENGE_GAS)).toBe(35);
    expect(fmt(-recoveryGain(3.5, 0.34))).toBe('4,784');
    expect(fmt(recoveryGain(3.5, 0.35))).toBe('6,768');
    // A reader scaling the rounded $2.75 parts lands on the same cent.
    const est = (0.18 + 0.025) * (3.5 / 2.75) + 0.08;
    expect(Math.ceil(est * 100)).toBe(35);
    expect(breakevenSolved(VALUE_DEFAULTS)).toBe(false);
    expect(breakevenSolved({ gas: 3.5, ethanePrice: 0.35 })).toBe(true);
    expect(breakevenSolved({ gas: 3.5, ethanePrice: 0.34 })).toBe(false);
    expect(breakevenSolved({ gas: 3.5, ethanePrice: 0.36 })).toBe(false);
    expect(breakevenSolved({ gas: 2.75, ethanePrice: 0.35 })).toBe(false);
  });

  it('plots a straight line in the ethane price, which recovering less only scales down', () => {
    expect(Object.keys(VALUE_DEFAULTS)).toEqual(['gas', 'ethanePrice']);
    const g = (c: number) => recoveryGain(NGL_PRICES.gas, c / 100);
    const slope = g(11) - g(10);
    for (const c of [20, 35, 60]) expect(g(c) - g(c - 1)).toBeCloseTo(slope, 6);
    for (const rec of [0.3, 0.6]) {
      const part = dayValue(rec, NGL_PRICES.gas, 0.4) - dayValue(0, NGL_PRICES.gas, 0.4);
      expect(part).toBeCloseTo((rec / DEEP) * recoveryGain(NGL_PRICES.gas, 0.4), 6);
    }
    // Every breakeven the gas-price slider can reach sits on the chart.
    for (const gas of [1.5, 6]) {
      const be = breakevenParts(gas).total * 100;
      expect(be).toBeGreaterThan(ETHANE_CENTS[0]);
      expect(be).toBeLessThan(ETHANE_CENTS[1]);
    }
    expect(STANDARD.propane).toBe(0.98);
  });
});

describe('gas chapter 2 lessons, interactively', () => {
  afterEach(() => cleanup());

  const load = async (n: number) => (await import(`../src/lessons/gas/ch2/L2_${n}.tsx`)).default as ComponentType;
  const readout = (root: HTMLElement, label: string) => {
    const el = Array.from(root.querySelectorAll('.big > div')).find((e) => (e.textContent ?? '').includes(label));
    return el?.textContent ?? '';
  };

  it('2.3 hides the later history until a forecast is locked in, and judges that forecast', async () => {
    const view = render(createElement(await load(3)));
    const text = () => view.container.textContent ?? '';
    expect(readout(view.container, 'actually produced')).toContain('hidden');
    const lock = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === 'Lock in this forecast')!;
    await act(async () => {
      fireEvent.click(lock);
    });
    expect(readout(view.container, 'actually produced')).toContain(`${fmt(ACTUAL_BCF, 1)} Bcf`);
    expect(readout(view.container, 'locked-in forecast')).toContain('7.3 Bcf · −41%');
    expect(text()).toContain('You locked in 7.3 Bcf');
    expect(view.container.querySelector('.chal-st')?.textContent).toBe('Unsolved');
    const hide = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === 'Hide the rest and forecast again')!;
    await act(async () => {
      fireEvent.click(hide);
    });
    expect(readout(view.container, 'actually produced')).toContain('hidden');
    expect(readout(view.container, 'fit error')).toContain('24%');
  });

  it('2.4 values the starting plan, then the lean plan, without touching the reader’s plan', async () => {
    const view = render(createElement(await load(4)));
    const text = () => view.container.textContent ?? '';
    expect(text()).toContain('The starting plan: 30 wells in each of years 1–5, 150 in all.');
    expect(text()).toContain('$746 million');
    const lean = Array.from(view.container.querySelectorAll('.seg button')).find((b) => b.textContent === 'Lean plan')!;
    await act(async () => {
      fireEvent.click(lean);
    });
    expect(text()).toContain('The lean plan: 41, 24, 14, 13, 12 wells in years 1–5, 104 in all');
    expect(text()).toContain('$550 million');
    const yours = Array.from(view.container.querySelectorAll('.seg button')).find((b) => b.textContent === 'Your plan')!;
    await act(async () => {
      fireEvent.click(yours);
    });
    expect(text()).toContain('still the starting plan');
  });

  it('every chapter 2 lesson renders without NaN or undefined at its controls’ ends', async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const view = render(createElement(await load(n)));
      const check = () => expect(view.container.textContent ?? '').not.toMatch(/NaN|Infinity|undefined/);
      check();
      for (const end of ['max', 'min'] as const) {
        for (const input of Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
          await act(async () => {
            fireEvent.change(input, { target: { value: input[end] } });
          });
        }
        check();
      }
      for (const button of Array.from(view.container.querySelectorAll<HTMLButtonElement>('.seg button, .tbtn'))) {
        await act(async () => {
          fireEvent.click(button);
        });
        check();
      }
      cleanup();
    }
  });
});
