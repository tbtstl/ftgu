// Chapter 4 of the compute course: assertions for the numbers its prose quotes after the first fix pass,
// and (second pass) its predict-then-check challenges, trimmed readouts and the figures they changed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { fmt, pct, usd } from '../src/framework';
import { COOLING_LIMIT_KW, clusterLayout, rackLimits } from '../src/engines/compute/rack';
import { airflowM3s, annualPue, waterFlowLs } from '../src/engines/compute/cooling';
import { generatorPlan, upsEfficiency } from '../src/engines/compute/facilityPower';
import { fabric } from '../src/engines/compute/dcNetwork';
import { capitalRecovery } from '../src/engines/compute/facilityCost';
import { serverPowerW } from '../src/model/compute/hardware';
import { SITES } from '../src/model/compute/sites';
import Lesson41, { CLUSTER_GPUS, HALL_DEFAULTS, HALL_MIN_FEED, HALL_TARGET, NUMBERS as L41, hallFits, hallSolved, spaceLimit } from '../src/lessons/compute/ch4/L4_1';
import Lesson42, { CHAIN_DEFAULTS, HOTTEST_C, LESSON_NUMBERS as L42, chainOf, humidityWord, lossSolved, roundTo, siteRun } from '../src/lessons/compute/ch4/L4_2';
import Lesson43, { AIR_RISE_C, DENSE_RACK_KW, FLOW_KW, RACK_KW, WATER_RISE_C } from '../src/lessons/compute/ch4/L4_3';
import Lesson44, { BASE, CHEAPEST, HIDE_SHARE, LESSON_NUMBERS as L44, RUN_DEFAULTS, cheapestSolved, runAt, runShare } from '../src/lessons/compute/ch4/L4_4';
import Lesson45, {
  CHALLENGE_LIFE,
  CHALLENGE_PRICE,
  LESSON_NUMBERS as L45,
  PLANNER_DEFAULTS,
  PRICE_DEFAULTS,
  breakEven,
  breakEvenSolved,
  costOf,
  usedHourCost,
} from '../src/lessons/compute/ch4/L4_5';

const cents = (x: number) => Math.round(x * 100) / 100;

describe('compute 4.1 after the fix pass', () => {
  it('runs out of power and cooling one server before space', () => {
    const lim = rackLimits('A', 'air', 40);
    expect(lim.space).toBe(5);
    expect(spaceLimit('A', 'air')).toBe(5);
    expect(lim['power feed']).toBe(4);
    expect(lim.cooling).toBe(4);
  });

  it('quotes the GPUs’ 60% share of a server, the drawing’s figure (the rack-share readout is gone)', () => {
    expect(Math.round(L41.aGpuShare * 100)).toBe(60);
  });
});

describe('compute 4.2 after the fix pass', () => {
  const n = chainOf({ ...CHAIN_DEFAULTS, redundancy: 'N' });
  const n1 = chainOf(CHAIN_DEFAULTS);
  const twoN = chainOf({ ...CHAIN_DEFAULTS, redundancy: '2N' });

  it('costs almost nothing in efficiency for one spare, and more for 2N', () => {
    expect(fmt(n.facilityLossMW, 2)).toBe('1.00');
    expect(fmt(n1.facilityLossMW, 2)).toBe('0.98');
    expect(n1.facilityLossMW).toBeLessThan(n.facilityLossMW);
    expect(fmt(twoN.facilityLossMW, 2)).toBe('1.07');
    // At 89% of rating the UPS is almost exactly as efficient as at full load…
    expect(Math.round(n1.ups.loadFraction * 100)).toBe(89);
    expect(Math.abs(n1.stages[1].efficiency - upsEfficiency(1, 'double conversion'))).toBeLessThan(0.0005);
    // …and the two transformers, more lightly loaded, lose less.
    expect(n1.stages[0].lossMW).toBeLessThan(n.stages[0].lossMW);
    expect(n1.stages[2].lossMW).toBeLessThan(n.stages[2].lossMW);
  });

  it('describes what reaches the servers’ components', () => {
    expect(fmt(L42.chip, 1)).toBe('16.9');
    expect(Math.round((L42.chip / L42.grid) * 100)).toBe(81);
  });

  it('introduces the three sites from the model', () => {
    expect([SITES.marston.gridMW, SITES.techpark.gridMW, SITES.fernhill.gridMW]).toEqual([20, 60, 200]);
    expect([SITES.marston.powerPrice, SITES.techpark.powerPrice, SITES.fernhill.powerPrice]).toEqual([95, 55, 35]);
    expect([SITES.marston.meanTempC, SITES.techpark.meanTempC, SITES.fernhill.meanTempC]).toEqual([20, 14, 4]);
    expect([SITES.marston.buildCostIndex, SITES.techpark.buildCostIndex, SITES.fernhill.buildCostIndex]).toEqual([1.3, 1, 0.9]);
    expect([SITES.marston.rttMs, SITES.techpark.rttMs, SITES.fernhill.rttMs]).toEqual([2, 6, 40]);
    expect([humidityWord(SITES.marston.humidity), humidityWord(SITES.techpark.humidity), humidityWord(SITES.fernhill.humidity)]).toEqual(['high', 'moderate', 'low']);
    expect([fmt(HOTTEST_C.marston), fmt(HOTTEST_C.techpark), fmt(HOTTEST_C.fernhill)]).toEqual(['30', '29', '21']);
  });

  it('shows the hottest-hour draw at Marston with two decimals', () => {
    expect(fmt(siteRun({ site: 'marston', itMW: 14.5, redundancy: 'N+1' }).peakMW, 2)).toBe('19.97');
    expect(fmt(siteRun({ site: 'marston', itMW: 15, redundancy: 'N+1' }).peakMW, 2)).toBe('20.66');
  });

  it('plans the generators N+1 whatever the UPS redundancy', () => {
    for (const redundancy of ['N', 'N+1', '2N'] as const) {
      const r = siteRun({ site: 'techpark', itMW: 20, redundancy });
      expect(r.generators.units).toBe(Math.ceil(r.peakMW / 3) + 1);
      expect(r.generators.units).toBe(11);
    }
    expect(generatorPlan(27.33).units).toBe(11);
  });
});

describe('compute 4.3 after the fix pass', () => {
  it('gives humid air less free cooling: Marston would cool more of its heat free if it were dry', () => {
    const plant = { cooling: 'liquid' as const, supplyC: 35 };
    const humid = annualPue(SITES.marston, plant);
    const dry = annualPue({ ...SITES.marston, humidity: 0 }, plant);
    expect(dry.freeShare).toBeGreaterThan(humid.freeShare);
  });
});

describe('compute 4.4 after the fix pass', () => {
  it('defines bisection bandwidth as half the GPUs sending to the other half at full speed', () => {
    expect(fabric({ gpus: 1024, downPorts: 32 }).bisectionTbps).toBeCloseTo((512 * 400) / 1000, 9);
  });
});

describe('compute 4.5 after the fix pass', () => {
  it('splits the Marston–Fernhill gap between building and electricity', () => {
    expect(cents(L45.marstonBuilding)).toBe(0.32);
    expect(cents(L45.northBuilding)).toBe(0.22);
    expect(cents(L45.marstonPower)).toBe(0.16);
    expect(cents(L45.northPower)).toBe(0.06);
    // The two gaps are about as wide as each other, and together make up the whole difference.
    const building = L45.marstonBuilding - L45.northBuilding;
    const power = L45.marstonPower - L45.northPower;
    expect(Math.abs(building - power)).toBeLessThan(0.01);
    const bay = costOf({ ...PLANNER_DEFAULTS, site: 'marston' }).perUsedHour;
    const north = costOf({ ...PLANNER_DEFAULTS, site: 'fernhill' }).perUsedHour;
    expect(building + power).toBeCloseTo(bay - north, 9);
  });

  it('rounds Marston’s GPU count the same way as Lesson 4.2', () => {
    expect(roundTo(L45.marstonGpus, 100)).toBe(12100);
    expect(roundTo(L42.bayGpus, 100)).toBe(12100);
  });
});

// ---------------------------------------------------------------------------
// Second pass.

const slider = (root: HTMLElement, label: string) => {
  const el = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find((l) => l.textContent === label);
  return document.getElementById(el!.htmlFor) as HTMLInputElement;
};
const segment = (root: HTMLElement, group: string, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)).find((b) => b.textContent === text)!;
const figures = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('figure'));
const ranges = (root: HTMLElement) => root.querySelectorAll('input[type="range"]').length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('compute 4.1 pass 2: the smallest feed for the hall', () => {
  it('fixes the cluster at 1,024 GPUs: the lesson’s only slider is the rack’s', () => {
    expect(CLUSTER_GPUS).toBe(1024);
    expect(HALL_TARGET).toEqual({ gpus: 1024, racks: 20 });
    const view = render(createElement(Lesson41));
    expect(ranges(view.container)).toBe(1);
    expect(slider(view.container, 'Servers in the rack')).toBeTruthy();
  });

  it('predicts 60 kW: 51.2 GPUs a rack, so seven liquid-cooled servers at 59.3 kW', () => {
    expect(L41.hallPerRack).toBeCloseTo(51.2, 9);
    expect(L41.hallServersPerRack).toBe(7);
    expect(fmt(serverPowerW('A', 'liquid') / 1000, 2)).toBe('8.33');
    expect(fmt(L41.hallRackKW, 1)).toBe('59.3');
    expect(L41.hallRackKW).toBeGreaterThan(40);
    expect(L41.hallRackKW).toBeLessThanOrEqual(60);
    expect(HALL_MIN_FEED).toBe(60);
    expect(clusterLayout('A', 'liquid', 60, 1024).racks).toBe(19);
    expect(clusterLayout('A', 'liquid', 40, 1024).racks).toBe(32);
    // Air carries only 40 kW out of a rack: four servers, 32 racks, whatever the feed.
    expect(COOLING_LIMIT_KW.air).toBe(40);
    for (const feed of [40, 60, 100, 140]) expect(clusterLayout('A', 'air', feed, 1024).racks).toBe(32);
  });

  it('is unsolved at the start and solved only at the smallest feed that fits', () => {
    expect(hallSolved(HALL_DEFAULTS)).toBe(false);
    expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 60 })).toBe(true);
    // Near misses: a feed too small, a feed bigger than needed, air on the right feed, another accelerator.
    expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 40 })).toBe(false);
    expect(hallSolved({ gpu: 'A', cooling: 'liquid', feed: 100 })).toBe(false);
    expect(hallFits('A', 'liquid', 100)).toBe(true);
    expect(hallSolved({ gpu: 'A', cooling: 'air', feed: 60 })).toBe(false);
    expect(hallSolved({ gpu: 'B', cooling: 'liquid', feed: 60 })).toBe(false);
  });

  it('solves challenge b in the lesson', () => {
    const view = render(createElement(Lesson41));
    const chal = () => view.container.querySelectorAll('.chal')[1] as HTMLElement;
    expect(chal().textContent).toContain('Unsolved');
    const hall = figures(view.container)[1];
    fireEvent.click(segment(hall, 'Cooling', 'Liquid-cooled'));
    fireEvent.click(segment(hall, 'Power feed', '100 kW'));
    expect(chal().textContent).toContain('Would a smaller feed still do?');
    fireEvent.click(segment(hall, 'Power feed', '60 kW'));
    expect(chal().textContent).toContain('Solved: 60 kW');
  });
});

describe('compute 4.2 pass 2: eco mode, predicted', () => {
  it('drops the first demonstration’s IT-load slider', () => {
    const view = render(createElement(Lesson42));
    expect(ranges(figures(view.container)[0])).toBe(1);
    expect(slider(figures(view.container)[0], 'Server power supplies')).toBeTruthy();
  });

  it('removes most of the UPS’s loss and little else', () => {
    const dc = chainOf(CHAIN_DEFAULTS);
    const eco = chainOf({ ...CHAIN_DEFAULTS, upsMode: 'eco' });
    expect(fmt(dc.stages[1].lossMW, 2)).toBe('0.81');
    expect(fmt(eco.stages[1].lossMW, 2)).toBe('0.20');
    // The transformers lose about what they did.
    expect(Math.abs(eco.stages[0].lossMW - dc.stages[0].lossMW)).toBeLessThan(0.005);
    expect(Math.abs(eco.stages[2].lossMW - dc.stages[2].lossMW)).toBeLessThan(0.005);
    // The UPS is the stage whose loss falls most, by far.
    const drops = dc.stages.map((st, i) => st.lossMW - eco.stages[i].lossMW);
    expect(drops.indexOf(Math.max(...drops))).toBe(1);
    expect(fmt(eco.facilityLossMW, 2)).toBe('0.38');
  });

  it('is unsolved at the start, solved by eco mode with a spare, not without', () => {
    expect(lossSolved(CHAIN_DEFAULTS)).toBe(false);
    expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco' })).toBe(true);
    expect(lossSolved({ ...CHAIN_DEFAULTS, upsMode: 'eco', redundancy: 'N' })).toBe(false);
    expect(lossSolved({ ...CHAIN_DEFAULTS, redundancy: '2N' })).toBe(false);
    const view = render(createElement(Lesson42));
    const chal = () => view.container.querySelectorAll('.chal')[0] as HTMLElement;
    expect(chal().textContent).toContain('Make your prediction');
    fireEvent.click(segment(figures(view.container)[0], 'UPS mode', 'Eco mode'));
    expect(chal().textContent).toContain('Solved. Eco mode removes most of the UPS’s loss, 0.81 MW falling to 0.20 MW');
  });
});

describe('compute 4.3 pass 2: air and water get their own figure', () => {
  it('has three figures, the flow cubes moving with the rack’s heat', () => {
    const view = render(createElement(Lesson43));
    const figs = figures(view.container);
    expect(figs.length).toBe(3);
    const flow = figs[1];
    const label = () => flow.querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
    expect(label()).toContain('To carry 40 kW out of one rack');
    act(() => {
      fireEvent.change(slider(flow, 'Heat from the rack'), { target: { value: String(DENSE_RACK_KW) } });
    });
    expect(label()).toContain(`To carry ${DENSE_RACK_KW} kW out of one rack`);
    // The first demonstration no longer repeats the junction temperature in readouts.
    expect(figs[0].querySelector('.big')).toBeNull();
  });

  it('quotes the dense rack’s flows', () => {
    expect(RACK_KW).toBe(40);
    expect(DENSE_RACK_KW).toBe(114);
    expect(fmt(airflowM3s(DENSE_RACK_KW, AIR_RISE_C), 1)).toBe('6.3');
    expect(waterFlowLs(DENSE_RACK_KW, WATER_RISE_C)).toBeLessThan(3);
    expect(Math.ceil(waterFlowLs(DENSE_RACK_KW, WATER_RISE_C))).toBe(3);
    expect(DENSE_RACK_KW).toBeGreaterThanOrEqual(FLOW_KW.min);
    expect(DENSE_RACK_KW).toBeLessThanOrEqual(FLOW_KW.max);
    // At the slider's top the air cube (60 px a meter, its depth 0.4 of its side) still fits under the title.
    expect(Math.cbrt(airflowM3s(FLOW_KW.max, AIR_RISE_C)) * 60 * 1.4).toBeLessThan(190 - 20);
  });
});

describe('compute 4.4 pass 2: predicting the cheapest fabric', () => {
  it('predicts from the 45% threshold: 44 ports down still hides, 45 does not', () => {
    expect(pct(HIDE_SHARE)).toBe('45%');
    const share = (down: number) => runShare({ down, placement: 'packed', others: 0 });
    // Packed, the run gets a leaf's ports up divided by its ports down.
    for (const d of [40, 44, 45, 48]) expect(share(d)).toBeCloseTo((64 - d) / d, 12);
    expect(share(44)).toBeGreaterThan(HIDE_SHARE);
    expect(share(45)).toBeLessThan(HIDE_SHARE);
    expect(runAt(share(44)).days).toBeCloseTo(BASE.days, 9);
    expect(runAt(share(45)).days).toBeGreaterThan(BASE.days);
    expect(CHEAPEST.down).toBe(45);
    expect(pct(share(44))).toBe('45%');
  });

  it('is unsolved at the start and solved only at 45 ports down', () => {
    expect(cheapestSolved(RUN_DEFAULTS)).toBe(false);
    expect(cheapestSolved({ ...RUN_DEFAULTS, down: 45, placement: 'packed' })).toBe(true);
    expect(cheapestSolved({ ...RUN_DEFAULTS, down: 44, placement: 'packed' })).toBe(false);
    expect(cheapestSolved({ ...RUN_DEFAULTS, down: 46, placement: 'packed' })).toBe(false);
  });

  it('draws only the current fabric on the cost chart until the challenge is solved', () => {
    const view = render(createElement(Lesson44));
    const fig = figures(view.container)[1];
    const costLabel = () =>
      Array.from(fig.querySelectorAll('svg[role="img"]'))
        .map((x) => x.getAttribute('aria-label')!)
        .find((l) => l.startsWith('Network cost per GPU'))!;
    expect(costLabel()).toContain('for the current fabric only');
    act(() => {
      fireEvent.change(slider(fig, 'Leaf ports facing GPUs'), { target: { value: '45' } });
    });
    expect(costLabel()).toContain('for leaves with 32 to 56 ports facing GPUs');
    // Once solved it stays revealed, even after moving on.
    act(() => {
      fireEvent.change(slider(fig, 'Leaf ports facing GPUs'), { target: { value: '50' } });
    });
    expect(costLabel()).toContain('for leaves with 32 to 56 ports facing GPUs');
  });

  it('uses the GPU slider and notes the two 3 : 1 savings', () => {
    expect([L44.f2048.gpus, L44.f2048.leaves, L44.f2048.spines]).toEqual([2048, 64, 32]);
    // Every port of every spine is in use.
    expect(L44.f2048.leaves * L44.f2048.upPorts).toBe(L44.f2048.spines * 64);
    expect(usd(L44.saving48Small)).toBe('$1,700');
    expect(usd(L44.saving48)).toBe('$1,750');
    expect(fabric({ gpus: 1024, downPorts: 32 }).costPerGpu - fabric({ gpus: 1024, downPorts: 48 }).costPerGpu).toBeCloseTo(L44.saving48Small, 9);
  });
});

describe('compute 4.5 pass 2: the four-year break-even, predicted', () => {
  it('gives the prediction’s numbers', () => {
    expect(fmt(capitalRecovery(0.1, 5), 4)).toBe('0.2638');
    expect(fmt(L45.crf4, 4)).toBe('0.3155');
    // "about a fifth more"
    expect(L45.crf4 / capitalRecovery(0.1, 5)).toBeGreaterThan(1.18);
    expect(L45.crf4 / capitalRecovery(0.1, 5)).toBeLessThan(1.22);
    // "about three-quarters of the yearly cost"
    expect(L45.serverNetShare).toBeGreaterThan(0.72);
    expect(L45.serverNetShare).toBeLessThan(0.78);
    expect(usd(L45.serverNet5)).toBe('$10,341');
    expect(usd(L45.serverNet4)).toBe('$12,366');
    expect(pct(L45.year4Rise)).toBe('15%');
    expect(fmt(L45.be5 * 100, 1)).toBe('64.6');
    expect(fmt(L45.be4 * 100, 1)).toBe('74.5');
    // The estimate the prompt invites lands within a point of the answer, and past 70%.
    const estimate = L45.be5 * (1 + L45.serverNetShare * (L45.crf4 / capitalRecovery(0.1, 5) - 1));
    expect(Math.abs(estimate - L45.be4)).toBeLessThan(0.01);
    expect(estimate).toBeGreaterThan(0.7);
    // "almost ten points of utilization"
    expect((L45.be4 - L45.be5) * 100).toBeGreaterThan(9.5);
    expect((L45.be4 - L45.be5) * 100).toBeLessThan(10);
  });

  it('is unsolved at the start, solved at 75%, and not at 74% or 76%', () => {
    expect(breakEvenSolved(PRICE_DEFAULTS)).toBe(false);
    expect(breakEvenSolved({ util: 75, life: CHALLENGE_LIFE, price: CHALLENGE_PRICE })).toBe(true);
    expect(breakEvenSolved({ util: 74, life: CHALLENGE_LIFE, price: CHALLENGE_PRICE })).toBe(false);
    expect(breakEvenSolved({ util: 76, life: CHALLENGE_LIFE, price: CHALLENGE_PRICE })).toBe(false);
    // What the readout shows either side of the answer.
    expect(usd(usedHourCost(74, 4), 2)).toBe('$2.41');
    expect(usd(usedHourCost(75, 4), 2)).toBe('$2.38');
    expect(breakEven(4, 2.4)).toBeCloseTo(L45.be4, 12);
  });

  it('hides the four-year break-even until the challenge is solved', () => {
    const view = render(createElement(Lesson45));
    const fig = figures(view.container)[1];
    act(() => {
      fireEvent.change(slider(fig, 'Server life'), { target: { value: '4' } });
    });
    expect(fig.textContent).toContain('break-even stays hidden');
    expect(fig.textContent).not.toContain('break-even 74.5%');
    act(() => {
      fireEvent.change(slider(fig, 'Utilization'), { target: { value: '75' } });
    });
    expect(fig.textContent).toContain('break-even 74.5%');
    const chal = view.container.querySelectorAll('.chal')[1] as HTMLElement;
    expect(chal.textContent).toContain('from 64.6% to 74.5%');
  });

  it('drops the planner’s readouts; electricity’s share is in the table', () => {
    const view = render(createElement(Lesson45));
    const fig = figures(view.container)[0];
    expect(fig.querySelector('.big')).toBeNull();
    expect(fig.textContent).toContain(pct(costOf(PLANNER_DEFAULTS).powerShare, 1));
  });
});
