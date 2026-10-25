// The compute course, Chapter 1: numbers the lessons' prose quotes after the fix passes, and the
// second pass's predict-then-check challenges.

import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { fmt } from '../src/framework/format';
import { CHIP_CAPACITANCE_F, LEAK_DOUBLING_C, chipState, parallelPower } from '../src/engines/compute/chipPower';
import { arrayMultiplier, rippleAdder, rippleWorstCase, toBits } from '../src/engines/compute/logic';
import { FORMATS, encode, relativeError, retentionMs, survivesRefresh } from '../src/engines/compute/memory';
import { COPPER_OHM_CM, SI_ATOMS, carriers, currentDensity } from '../src/engines/compute/semiconductor';
import { RETENTION_HALVING_C } from '../src/engines/compute/memory';
import { NFET, VDD, offCurrent, onCurrent } from '../src/engines/compute/transistor';
import { ACCELERATORS } from '../src/model/compute/hardware';
import { MODELS, paramCount } from '../src/model/compute/models';
import Lesson11, { CRYSTAL_DEFAULTS, conductivityGain, dotCount, leastBoronSolved, leastDopingForMillion, sci } from '../src/lessons/compute/ch1/L1_1';
import Lesson12, { HIGHEST_VTH, IOFF, LEAK_LIMIT_UA, LOWEST_VTH, SWING_MV, current, lowestThresholdSolved } from '../src/lessons/compute/ch1/L1_2';
import Lesson13, { RIPPLE_DEFAULTS, rippleCaption, rippleOutSolved, rippleOutStatus } from '../src/lessons/compute/ch1/L1_3';
import Lesson14, {
  CELL_DEFAULTS,
  FORMAT_DEFAULTS,
  READ_ALL_MS,
  STANDARD_INTERVAL,
  TENTH,
  hottestAt64Solved,
  modelBytes,
  num,
  sixteenBitSolved,
} from '../src/lessons/compute/ch1/L1_4';
import Lesson15, { UNITS, V_FLOOR, WIDE_TARGET_GHZ, bestUnits, bestUnitsSolved } from '../src/lessons/compute/ch1/L1_5';

describe('compute/1.1 after the fix pass', () => {
  it('writes copper’s resistivity in the lesson’s notation', () => {
    expect(sci(COPPER_OHM_CM)).toBe('1.7 × 10⁻⁶');
  });

  it('says the drawn impurity atoms follow the carriers’ log scale', () => {
    // 13 × 6 lattice sites are drawn.
    expect(dotCount(1e19)).toBe(20);
    expect(SI_ATOMS / 1e19).toBe(5000);
  });
});

describe('compute/1.4 after the fix pass', () => {
  it('starts the formats figure in FP16, so one preset click does not solve the 16-bit challenge', () => {
    expect(FORMAT_DEFAULTS.format).toBe('fp16');
    expect(sixteenBitSolved(FORMAT_DEFAULTS.value, FORMAT_DEFAULTS.format)).toBe(false);
    // Clicking the 70,000 preset in the default format overflows instead of solving.
    expect(sixteenBitSolved(70000, FORMAT_DEFAULTS.format)).toBe(false);
    expect(encode(70000, FORMATS[FORMAT_DEFAULTS.format]).overflow).toBe(true);
    // Switching to BF16 solves it.
    expect(sixteenBitSolved(70000, 'bf16')).toBe(true);
  });

  it('rounds 0.1 differently in every format, FP16 finer than BF16', () => {
    expect(TENTH).toBe(0.1);
    expect(num(encode(TENTH, FORMATS.fp32).value)).toBe('0.100000001');
    expect(fmt(1 / relativeError(TENTH, FORMATS.fp32) / 1e6)).toBe('67');
    expect(num(encode(TENTH, FORMATS.fp16).value)).toBe('0.0999755859');
    expect(fmt(1 / relativeError(TENTH, FORMATS.fp16))).toBe('4,096');
    expect(num(encode(TENTH, FORMATS.bf16).value)).toBe('0.100097656');
    expect(fmt(1 / relativeError(TENTH, FORMATS.bf16))).toBe('1,024');
    expect(num(encode(TENTH, FORMATS.fp8).value)).toBe('0.1015625');
    expect(fmt(1 / relativeError(TENTH, FORMATS.fp8))).toBe('64');
  });

  it('introduces the A-class’s memory bandwidth', () => {
    expect(fmt(ACCELERATORS.A.bandwidthTBs, 2)).toBe('3.35');
    expect(fmt(READ_ALL_MS)).toBe('24');
  });

  it('squares the multiplier but only doubles the rate', () => {
    expect(arrayMultiplier(4).transistors).toBe(432);
    expect(arrayMultiplier(8).transistors).toBe(1952);
    expect(fmt(arrayMultiplier(8).transistors / arrayMultiplier(4).transistors, 1)).toBe('4.5');
    expect(ACCELERATORS.A.fp8Tflops / ACCELERATORS.A.bf16Tflops).toBeCloseTo(2, 2);
  });
});

describe('compute/1.5 after the fix pass', () => {
  it('matches the A-class’s BF16 rate at full activity and its own clock', () => {
    expect(ACCELERATORS.A.sms).toBe(132);
    expect(fmt(ACCELERATORS.A.clockGHz, 2)).toBe('1.98');
    expect(fmt(chipState(0.8, ACCELERATORS.A.clockGHz, 1).tflops)).toBe('989');
    expect(fmt(CHIP_CAPACITANCE_F * 1e9)).toBe('460');
  });

  it('gives logic and DRAM leakage different doubling temperatures', () => {
    expect(LEAK_DOUBLING_C).toBe(25);
    expect(RETENTION_HALVING_C).toBe(10);
  });

  it('explains why one copy in “Going wide” draws less than the first figure', () => {
    const ref = chipState(0.8, 2.0, 1);
    const one = parallelPower(1, 2);
    expect(fmt(ref.totalW)).toBe('670');
    expect(fmt(one.totalW)).toBe('639');
    expect(fmt(ref.junctionC)).toBe('74');
    expect(fmt(one.leakageW)).toBe('55');
    expect(fmt(ref.leakageW)).toBe('81');
    expect(fmt(one.vdd, 3)).toBe('0.796');
  });
});

// ---------------------------------------------------------------------------
// Second pass: challenges that ask for a prediction, with the deciding readout hidden until solved.

const figures = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('figure'));
const challenge = (root: HTMLElement, i = 0) => root.querySelectorAll<HTMLElement>('.chal')[i];
const readoutCount = (fig: HTMLElement) => fig.querySelectorAll('.big > div').length;
const slider = (root: HTMLElement, label: string) => {
  const el = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find((l) => l.textContent === label);
  return document.getElementById(el!.htmlFor) as HTMLInputElement;
};
const segment = (root: HTMLElement, group: string, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)).find((b) => b.textContent === text)!;
const slide = async (input: HTMLInputElement, value: number) => {
  await act(async () => {
    fireEvent.change(input, { target: { value: String(value) } });
  });
};

afterEach(() => cleanup());

describe('compute/1.1 pass 2: how much boron?', () => {
  it('asks for a prediction phosphorus’s millionfold and the two mobilities can make', () => {
    expect(leastDopingForMillion('n')).toBe(16.3);
    expect(sci(10 ** leastDopingForMillion('n'))).toBe('2 × 10¹⁶');
    // Lightly doped, electrons are three times as mobile as holes, so boron needs about three times as much.
    const pure = carriers('none', 0);
    expect(Math.round(pure.mobilityN / pure.mobilityP)).toBe(3);
    expect(leastDopingForMillion('p')).toBe(16.8);
    expect(sci(10 ** 16.8)).toBe('6.3 × 10¹⁶');
    expect(Math.round(10 ** (16.8 - 16.3))).toBe(3);
    expect(Number(conductivityGain('p', 16.8).toPrecision(2))).toBe(1.2e6);
    expect(fmt(carriers('p', 10 ** 16.8).mobilityP)).toBe('348');
    expect(fmt(carriers('n', 10 ** 16.3).mobilityN)).toBe('1,075');
  });

  it('is unsolved at the start and solved only at the least boron', () => {
    expect(leastBoronSolved(CRYSTAL_DEFAULTS.kind, CRYSTAL_DEFAULTS.logDoping)).toBe(false);
    expect(leastBoronSolved('p', CRYSTAL_DEFAULTS.logDoping)).toBe(false);
    expect(leastBoronSolved('p', 16.8)).toBe(true);
    expect(leastBoronSolved('p', 16.7)).toBe(false);
    expect(leastBoronSolved('p', 16.9)).toBe(false);
    expect(leastBoronSolved('p', 19)).toBe(false);
    expect(leastBoronSolved('n', 16.8)).toBe(false);
  });

  it('shows mobility, not the carrier counts the equation already shows, and the field’s effect on current', () => {
    expect(fmt(carriers('none', 0).mobilityN)).toBe('1,414');
    expect(fmt(carriers('n', 1e19).mobilityN)).toBe('115');
    const ratio = currentDensity(carriers('none', 0), 200) / currentDensity(carriers('none', 0), 100);
    expect(ratio).toBeGreaterThan(1.95);
    expect(ratio).toBeLessThan(2);
  });

  it('keeps boron’s gain out of the caption until the challenge is solved, then leaves it there', async () => {
    const view = render(createElement(Lesson11));
    const [crystal, junction] = figures(view.container);
    expect(readoutCount(crystal)).toBe(3);
    expect(crystal.textContent).toContain('1,414 · 471');
    // The junction keeps only the barrier: the drawing labels the depletion width and the caption the current.
    expect(readoutCount(junction)).toBe(1);
    await act(async () => {
      fireEvent.click(segment(crystal, 'Impurity added', 'Boron'));
    });
    expect(crystal.querySelector('.cap')!.textContent).not.toContain('times better');
    expect(challenge(view.container).textContent).toContain('doesn’t reach a millionfold yet');
    await slide(slider(crystal, 'Impurity atoms'), 17);
    expect(challenge(view.container).textContent).toContain('Would less still do?');
    expect(crystal.querySelector('.cap')!.textContent).not.toContain('times better');
    await slide(slider(crystal, 'Impurity atoms'), 16.8);
    expect(challenge(view.container).textContent).toContain('Solved. Boron needs 6.3 × 10¹⁶');
    expect(crystal.querySelector('.cap')!.textContent).toContain('1.2 million times better');
    await slide(slider(crystal, 'Impurity atoms'), 17.5);
    expect(crystal.querySelector('.cap')!.textContent).toContain('times better');
  });
});

describe('compute/1.2 pass 2: the threshold from the swing', () => {
  it('predicts a 29 mV rise, so 0.33 V', () => {
    expect(fmt(IOFF / LEAK_LIMIT_UA, 2)).toBe('2.38');
    expect(fmt(Math.log10(IOFF / LEAK_LIMIT_UA), 2)).toBe('0.38');
    expect(fmt(Math.log10(IOFF / LEAK_LIMIT_UA) * SWING_MV)).toBe('29');
    expect(Math.ceil((NFET.vth + (Math.log10(IOFF / LEAK_LIMIT_UA) * SWING_MV) / 1000) * 100) / 100).toBe(LOWEST_VTH);
    expect(LOWEST_VTH).toBe(0.33);
    expect(HIGHEST_VTH).toBe(0.35);
    expect(current(offCurrent(VDD, { ...NFET, vth: 0.33 }))).toBe('977 pA');
    expect(current(onCurrent(VDD, { ...NFET, vth: 0.33 }))).toBe('885 µA');
    // Each 10 mV higher cuts the leak by about a quarter.
    const cut = offCurrent(VDD, { ...NFET, vth: 0.34 }) / offCurrent(VDD, { ...NFET, vth: 0.33 });
    expect(cut).toBeGreaterThan(0.7);
    expect(cut).toBeLessThan(0.8);
  });

  it('is unsolved at the start and solved only at the lowest threshold that meets both limits', () => {
    expect(lowestThresholdSolved(NFET.vth)).toBe(false);
    expect(lowestThresholdSolved(0.33)).toBe(true);
    for (const v of [0.31, 0.32, 0.34, 0.35, 0.36]) expect(lowestThresholdSolved(v)).toBe(false);
  });

  it('hides the leak’s size until the challenge is solved, and drops readouts the drawings repeat', async () => {
    const view = render(createElement(Lesson12));
    const [one, threshold] = figures(view.container);
    expect(readoutCount(one)).toBe(0);
    expect(readoutCount(threshold)).toBe(1);
    expect(threshold.textContent).toContain('leak: ?');
    expect(threshold.textContent).not.toContain('2.38 nA');
    await slide(slider(threshold, 'Threshold voltage'), 0.32);
    expect(challenge(view.container).textContent).toContain('Is this the lowest threshold');
    expect(threshold.textContent).toContain('leak: ?');
    await slide(slider(threshold, 'Threshold voltage'), 0.33);
    expect(challenge(view.container).textContent).toContain('Solved.');
    expect(threshold.textContent).toContain('leaks 977 pA');
    await slide(slider(threshold, 'Threshold voltage'), 0.2);
    expect(threshold.textContent).toContain('leaks 44.8 nA');
  });
});

describe('compute/1.3 pass 2: a carry that ripples out', () => {
  it('is unsolved at the start and one step from it, and solved by exactly the eight odd pairs adding to 16', () => {
    expect(rippleOutSolved(RIPPLE_DEFAULTS.a, RIPPLE_DEFAULTS.b)).toBe(false);
    for (const [a, b] of [
      [5, 3],
      [7, 3],
      [6, 2],
      [6, 4],
    ])
      expect(rippleOutSolved(a, b)).toBe(false);
    const pairs: string[] = [];
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) if (rippleOutSolved(a, b)) pairs.push(`${a}+${b}`);
    expect(pairs).toEqual(['1+15', '3+13', '5+11', '7+9', '9+7', '11+5', '13+3', '15+1']);
    // Near misses: sums of 16 that don't ripple, a ripple that dies at the top, and a slow sum with no carry.
    for (const [a, b] of [
      [8, 8],
      [14, 2],
      [7, 1],
      [5, 10],
    ])
      expect(rippleOutSolved(a, b)).toBe(false);
    expect(rippleAdder(toBits(5, 4), toBits(10, 4)).settle).toBe(rippleWorstCase(4));
  });

  it('says where the carry stops, and names the carry out as last when it ripples through', () => {
    expect(rippleOutStatus(6, 3)).toBe('In 6 + 3, bit 0 doesn’t generate a carry, so none starts at the bottom.');
    expect(rippleOutStatus(7, 1)).toBe('In 7 + 1, bit 0 generates a carry, but bit 3 kills it.');
    expect(rippleOutStatus(3, 3)).toBe('In 3 + 3, bit 0 generates a carry, but bit 1 generates a carry of its own and doesn’t wait for it.');
    const cap = (a: number, b: number) => rippleCaption(rippleAdder(toBits(a, 4), toBits(b, 4)));
    expect(cap(15, 1)).toBe('Bit 0 generates a carry, and bits 1, 2 and 3 must each wait for the carry from below, so the final carry out is the last to settle, after 8 gate delays, about 64 ps.');
    expect(cap(8, 0)).toBe('No digit has to wait for a carry rippling in from another column, so every digit of the answer is final after 4 gate delays, about 32 ps.');
  });

  it('drops the readouts the table, the caption and the status repeat, and solves in the lesson', async () => {
    const view = render(createElement(Lesson13));
    const [gates, adder] = figures(view.container);
    expect(readoutCount(gates)).toBe(1);
    expect(readoutCount(adder)).toBe(2);
    expect(challenge(view.container, 1).textContent).toContain('Unsolved');
    await slide(slider(adder, 'A'), 9);
    await slide(slider(adder, 'B'), 7);
    expect(challenge(view.container, 1).textContent).toContain('Every such pair adds to 16');
  });
});

describe('compute/1.4 pass 2: how hot for 64 ms?', () => {
  it('predicts 91 °C from the halving rule, where a straight line says 92', () => {
    expect(fmt(Math.log2(retentionMs(85) / STANDARD_INTERVAL), 2)).toBe('0.64');
    expect(fmt(RETENTION_HALVING_C * Math.log2(retentionMs(85) / STANDARD_INTERVAL), 1)).toBe('6.4');
    expect(fmt(85 + (RETENTION_HALVING_C * (retentionMs(85) - STANDARD_INTERVAL)) / (retentionMs(85) - retentionMs(95)))).toBe('92');
    expect(fmt(retentionMs(91))).toBe('66');
    expect(fmt(retentionMs(92))).toBe('62');
    expect(survivesRefresh(64, 91)).toBe(true);
    expect(survivesRefresh(64, 92)).toBe(false);
  });

  it('is unsolved at the start and solved only at 91 °C with 64 ms', () => {
    expect(hottestAt64Solved(CELL_DEFAULTS.cell, CELL_DEFAULTS.temp, CELL_DEFAULTS.interval)).toBe(false);
    expect(hottestAt64Solved('dram', 91, 64)).toBe(true);
    expect(hottestAt64Solved('dram', 90, 64)).toBe(false);
    expect(hottestAt64Solved('dram', 92, 64)).toBe(false);
    expect(hottestAt64Solved('dram', 91, 62)).toBe(false);
    expect(hottestAt64Solved('sram', 91, 64)).toBe(false);
  });

  it('quotes the 70B model in whole gigabytes', () => {
    expect(fmt(paramCount(MODELS['70B']) / 1e9)).toBe('71');
    expect(fmt(modelBytes('fp32') / 1e9)).toBe('282');
    expect(fmt(modelBytes('bf16') / 1e9)).toBe('141');
    expect(fmt(modelBytes('fp8') / 1e9)).toBe('71');
    expect(fmt(ACCELERATORS.A.memoryGB - modelBytes('fp8') / 1e9)).toBe('9');
  });

  it('hides how long the weakest cell lasts until the challenge is solved', async () => {
    const view = render(createElement(Lesson14));
    const [cell, formats] = figures(view.container);
    expect(readoutCount(cell)).toBe(2);
    expect(Array.from(cell.querySelectorAll('.big .n')).map((n) => n.textContent)).toEqual(['?', '4.5%']);
    expect(cell.textContent).not.toContain('100 ms');
    // The formats figure drops the readouts its slider and equation repeat.
    expect(readoutCount(formats)).toBe(2);
    await slide(slider(cell, 'Temperature'), 92);
    expect(challenge(view.container).textContent).toContain('At 92 °C the bit is lost.');
    await slide(slider(cell, 'Temperature'), 91);
    expect(challenge(view.container).textContent).toContain('Solved. At 91 °C');
    expect(cell.textContent).toContain('66 ms');
  });
});

describe('compute/1.5 pass 2: no distance to the optimum, bars found one at a time', () => {
  it('finds six copies best: the first at the 0.45 V floor', () => {
    expect(V_FLOOR).toBe(0.45);
    expect(bestUnits()).toBe(6);
    expect(fmt(parallelPower(5, WIDE_TARGET_GHZ).vdd, 2)).toBe('0.46');
    expect(parallelPower(6, WIDE_TARGET_GHZ).vdd).toBe(V_FLOOR);
    expect(fmt(parallelPower(6, WIDE_TARGET_GHZ).totalW)).toBe('255');
    expect(fmt(parallelPower(7, WIDE_TARGET_GHZ).totalW)).toBe('267');
    expect(fmt(parallelPower(8, WIDE_TARGET_GHZ).totalW)).toBe('278');
    expect(fmt((1 - parallelPower(6, WIDE_TARGET_GHZ).totalW / parallelPower(1, WIDE_TARGET_GHZ).totalW) * 100)).toBe('60');
    // Past the floor, another copy adds only leakage.
    expect(parallelPower(7, WIDE_TARGET_GHZ).dynamicW).toBeCloseTo(parallelPower(6, WIDE_TARGET_GHZ).dynamicW, 9);
    expect(UNITS[UNITS.length - 1]).toBe(8);
    expect(bestUnitsSolved(1)).toBe(false);
    for (const u of [5, 7]) expect(bestUnitsSolved(u)).toBe(false);
  });

  it('prints the power alone in challenge a, and draws bars only up to the slider', async () => {
    const view = render(createElement(Lesson15));
    const [chip, wide] = figures(view.container);
    expect(challenge(view.container).textContent).toContain('Could the same arithmetic cost less?');
    expect(challenge(view.container).textContent).not.toContain('least possible');
    expect(readoutCount(chip)).toBe(3);
    expect(readoutCount(wide)).toBe(2);
    const bars = () => wide.querySelectorAll('svg.chart rect').length;
    expect(bars()).toBe(2);
    await slide(slider(wide, 'Copies of the logic'), 4);
    expect(bars()).toBe(8);
    expect(wide.textContent).not.toContain('255 W');
    await slide(slider(wide, 'Copies of the logic'), 6);
    expect(challenge(view.container, 1).textContent).toContain('Solved. 6 copies');
  });
});
