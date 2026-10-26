// Chapter 4 of the natural gas course: numbers the lessons' prose states, checked against the model.

import { describe, expect, it } from 'vitest';
import { breakevenHub } from '../src/engines/gas/lng';
import { SEASONAL_COSTS, simulateYear } from '../src/engines/gas/market';
import { withdrawCapacity } from '../src/engines/gas/storage';
import { COAL_SWITCH_BLOCKS, LNG_VALUE, OIL_SWITCH_VALUE } from '../src/model/gas/demand';
import { GAS_MONTH_START, WINTER_START, hdd, weatherYear } from '../src/model/gas/weather';
import { BAYPORT_LNG, PIPELINE, STORAGE_SPECS } from '../src/model/gas/world';
import {
  BAL_JAN15,
  BALANCE_DEFAULTS,
  BALANCE_YEARS,
  CUT_ONSET,
  CUT_SHIFT,
  INTERRUPTIBLE_TEMP,
  LNG_CUT_TEMP,
  LNG_CUT_TEMP_MORE,
  LNG_EUROPE_PRICE,
  LNG_VALUE_AT_CALDER,
  RIDGEBACK_MORE,
  balanceDay,
  balanceYear,
  lngCutSolved,
} from '../src/lessons/gas/ch4/L4_1';
import { HUB_DEFAULTS, NL_FULL_TEMP, NL_ONE_OUT, NL_PER_DEGREE, NL_ROOM, NL_TWO_OUT, OIL_DAY, hubDay, hubWinter, northlineFullSolved } from '../src/lessons/gas/ch4/L4_2';
import {
  ANCHOR_ANSWER,
  ANCHOR_EXACT,
  ANCHOR_GAP,
  ANCHOR_MARGIN,
  CAPACITY_AUCTION_DEFAULTS,
  EXPANSION_ANNUAL_COST,
  EXPANSION_MMBTU_D,
  MARKETERS_ALL,
  MARKETER_BID,
  METRO_GAS_VALUE,
  QTY_MAX,
  QTY_STEP,
  SPIKE_COUNT,
  SPIKE_NOT_COLDEST,
  SPIKE_ON_COLDEST,
  WINTERS,
  anchorSolved,
  expansionOutcome,
} from '../src/lessons/gas/ch4/L4_3';
import { ROUND_TRIP, SEASON_DEFAULTS, WINTER_SEEDS, enoughStorageScale, enoughStorageSolved, seasonPlan, seasonSummary, winterStats, winterYear } from '../src/lessons/gas/ch4/L4_4';
import {
  CURVE_DAY,
  FWD_DEFAULTS,
  HEDGE_CONTRACTS,
  HEDGE_DEFAULTS,
  LEVEL_MAX,
  LEVEL_MIN,
  LEVEL_STEP,
  MARK_DAYS,
  SHORT_LEVEL,
  WINTERS as FEB_WINTERS,
  type CurveDate,
  computeCurve,
  computeWinterPath,
  costRange,
  curveAt,
  curveChallengeSolved,
  hedgeSolved,
  narrowestHedge,
  storageAtLevel,
  swapBasis,
  utilityCost,
  winterRun,
} from '../src/lessons/gas/ch4/L4_5';
import { FORWARD_CURVES, WINTER_PATHS } from '../src/lessons/gas/ch4/forwardTable';

const NL = PIPELINE['calder-metro'];

describe('gas 4.1: the LNG value', () => {
  it('is $6.50 at Bayport and $6.40 at Calder, a break-even hub price for about $11.20 in Europe', () => {
    expect(LNG_VALUE).toBe(6.5);
    expect(LNG_VALUE_AT_CALDER).toBeCloseTo(6.4, 9);
    expect(LNG_EUROPE_PRICE).toBeGreaterThan(11.15);
    expect(LNG_EUROPE_PRICE).toBeLessThan(11.25);
    expect(Math.round(LNG_EUROPE_PRICE * 10) / 10).toBeCloseTo(11.2, 9);
    const d = BAYPORT_LNG.destinations.europe;
    const v = { hubPrice: 6.4, feedMultiplier: BAYPORT_LNG.feedMultiplier, liquefactionFee: BAYPORT_LNG.liquefactionFee, ladenDays: d.ladenDays, charterPerDay: BAYPORT_LNG.charterPerDay, voyageFees: d.voyageFees, regasFee: BAYPORT_LNG.regasFee };
    expect(breakevenHub(v, LNG_EUROPE_PRICE)).toBeCloseTo(LNG_VALUE_AT_CALDER, 9);
  });

  it('Reset returns the first demonstration to January 15', () => {
    expect(BALANCE_DEFAULTS.day).toBe(BAL_JAN15);
  });

  it('in the single market LNG gives way at $6.50, before interruptible industry at $8', () => {
    const b = balanceDay({ ...BALANCE_DEFAULTS, temp: LNG_CUT_TEMP });
    expect(b.price).toBeCloseTo(LNG_VALUE, 9);
    const interruptible = b.demand.find((x) => x.id === 'metro-interruptible')!;
    expect(interruptible.used).toBeCloseTo(interruptible.q, 9);
  });
});

describe('gas 4.2: Northline’s stations and the network’s order of giving way', () => {
  it('one station out leaves 1.45 Bcf/d, which changes nothing at 28 °F; two out leave 1.00 and Metro breaks away', () => {
    expect(NL.stations).toBe(3);
    expect(NL_ONE_OUT).toBeCloseTo(1.45, 9);
    expect(NL_TWO_OUT).toBeCloseTo(1.0, 9);
    const start = hubDay(HUB_DEFAULTS);
    expect(start.flow[NL.id]).toBeLessThan(NL_ONE_OUT);
    const one = hubDay({ ...HUB_DEFAULTS, northline: NL_ONE_OUT });
    expect(one.price.metro - one.price.calder).toBeCloseTo(start.price.metro - start.price.calder, 9);
    const two = hubDay({ ...HUB_DEFAULTS, northline: NL_TWO_OUT });
    expect(two.price.metro - two.price.calder).toBeGreaterThan(1);
    const low = hubDay({ ...HUB_DEFAULTS, northline: 0.8 });
    expect(low.price.metro - low.price.calder).toBeGreaterThan(two.price.metro - two.price.calder);
  });

  it('Metro burns oil while Bayport still exports its full LNG at about $4', () => {
    expect(OIL_DAY.price.metro).toBeCloseTo(OIL_SWITCH_VALUE, 9);
    expect(OIL_DAY.sectors.lng).toBeCloseTo(1.2, 9);
    expect(OIL_DAY.price.bayport).toBeLessThan(LNG_VALUE);
  });
});

describe('gas 4.3: firm capacity’s best days', () => {
  it('are cold but not always the coldest; the others come in February or March with Hollow Creek drawn down', () => {
    expect(SPIKE_COUNT).toBe(SPIKE_ON_COLDEST.length + SPIKE_NOT_COLDEST.length);
    expect(SPIKE_ON_COLDEST.length).toBeGreaterThan(SPIKE_NOT_COLDEST.length);
    expect(SPIKE_NOT_COLDEST.length).toBeGreaterThan(0);
    for (const w of SPIKE_NOT_COLDEST) {
      expect(w.maxDay).toBeGreaterThanOrEqual(GAS_MONTH_START[10]);
      expect(w.maxHollow).toBeLessThan(STORAGE_SPECS.hollowcreek.workingBcf / 2);
      const y = simulateYear({ weather: weatherYear(w.seed) });
      expect(w.maxTemp).toBeGreaterThan(y[w.coldestDay].tempF);
    }
    expect(WINTERS.filter((w) => w.maxSpread > 1).length).toBe(SPIKE_COUNT);
  });
});

describe('gas 4.4: storage size, heating degree days and LNG', () => {
  it('past the least storage that no longer fills, bigger fields hold more but never fill and prices stop changing', () => {
    const enough = enoughStorageScale();
    const at = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: enough }));
    let prevPeak = at.peak;
    for (let i = Math.round(enough * 100) + 1; i <= 150; i++) {
      const s = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: i / 100 }));
      expect(s.full).toBe(false);
      expect(s.summer).toBeCloseTo(at.summer, 6);
      expect(s.winter).toBeCloseTo(at.winter, 6);
      expect(s.peak).toBeGreaterThanOrEqual(prevPeak - 1e-9);
      prevPeak = s.peak;
    }
    expect(prevPeak).toBeGreaterThan(at.peak + 5);
  });

  it('heating degree days: one per degree below 65 °F, about 4,640 in a normal winter', () => {
    expect(hdd(25)).toBe(40);
    expect(hdd(70)).toBe(0);
    expect(Math.round(winterStats('normal').winterHdd / 10) * 10).toBe(4640);
  });

  it('the cold winter peaks at the Calder price where LNG stops: $6.50 at Bayport less the $0.10 Gulfward trip', () => {
    expect(PIPELINE['calder-bayport'].variableCost).toBeCloseTo(0.1, 9);
    expect(winterStats('cold').maxPrice).toBeCloseTo(LNG_VALUE - PIPELINE['calder-bayport'].variableCost, 9);
  });

  it('the demand that gives way comes in 0.05 Bcf/d blocks', () => {
    for (const b of COAL_SWITCH_BLOCKS) expect(b.bcfd).toBeCloseTo(0.05, 9);
  });
});

describe('gas 4.5: the winter contango, the marks and over-hedging', () => {
  it('the winter climbs far more than the carry, and Hollow Creek is at its withdrawal limit on most February days', () => {
    const c = curveAt('nov1', 100);
    const at = (m: number) => c.calder[c.months.indexOf(m)];
    expect(at(9) - at(8)).toBeGreaterThan(5 * SEASONAL_COSTS.holdCostPerMonth);
    expect(at(10) - at(9)).toBeGreaterThan(5 * SEASONAL_COSTS.holdCostPerMonth);
    expect(STORAGE_SPECS.hollowcreek.workingBcf).toBeGreaterThan(STORAGE_SPECS.saltflat.workingBcf);
    const start = storageAtLevel(214, 100);
    let days = 0;
    let atLimit = 0;
    for (let i = 0; i < 24; i++) {
      const run = simulateYear({ weather: weatherYear(1000 + i), startDay: 214, days: GAS_MONTH_START[11] - 214, startStorage: start });
      run.forEach((d, j) => {
        if (d.day < GAS_MONTH_START[10]) return;
        const before = j > 0 ? run[j - 1].storage.hollowcreek : start.hollowcreek;
        days++;
        if (-d.storageFlow.hollowcreek >= withdrawCapacity(STORAGE_SPECS.hollowcreek, before) - 1e-6) atLimit++;
      });
    }
    expect(atLimit / days).toBeGreaterThan(0.5);
  });

  it('the contract is marked every second week', () => {
    for (let i = 1; i < MARK_DAYS.length - 1; i++) expect(MARK_DAYS[i] - MARK_DAYS[i - 1]).toBe(14);
    expect(MARK_DAYS[0]).toBe(WINTER_START);
  });

  it('over-hedging narrows the range in these three winters because the bill moved further than the futures', () => {
    const over = narrowestHedge(false);
    const overSwap = narrowestHedge(true);
    expect(over).toBeGreaterThan(HEDGE_CONTRACTS);
    expect(overSwap).toBeGreaterThan(HEDGE_CONTRACTS);
    const w = (r: { lo: number; hi: number }) => r.hi - r.lo;
    expect(w(costRange(over, false))).toBeLessThan(w(costRange(HEDGE_CONTRACTS, false)));
    expect(w(costRange(overSwap, true))).toBeLessThan(w(costRange(HEDGE_CONTRACTS, true)));
    const cold = winterRun('cold');
    const mild = winterRun('warm');
    const last = (p: number[]) => p[p.length - 1];
    const billSwing = utilityCost('cold', 0, false).unhedged - utilityCost('warm', 0, false).unhedged;
    const futuresSwing = last(cold.path) - last(mild.path);
    expect(futuresSwing).toBeGreaterThan(0);
    expect(billSwing).toBeGreaterThan(futuresSwing);
    expect(cold.metroAvg - cold.calderAvg).toBeGreaterThan(mild.metroAvg - mild.calderAvg);
    expect(cold.calderAvg).toBeGreaterThan(last(cold.path));
    expect(mild.calderAvg).toBeLessThan(last(mild.path));
  });
});

// ---------------------------------------------------------------------------
// Pass 2: the predict-then-check challenges, the shared winters and the precomputed forward table.

describe('gas 4.1 challenge: more gas from Ridgeback', () => {
  const at = (temp: number, ridgeback = BALANCE_DEFAULTS.ridgeback, lng = LNG_VALUE) => balanceDay({ ...BALANCE_DEFAULTS, temp, ridgeback, lng });
  const perDegree = at(BALANCE_DEFAULTS.temp).storage - at(BALANCE_DEFAULTS.temp - 1).storage;

  it('predicts ~5.6 degrees from 0.3 Bcf/d at 53 MMcf/d a degree; the first whole degree with a cut moves 6 colder, to −2 °F', () => {
    expect(Math.round(perDegree * 1000)).toBe(53);
    expect(RIDGEBACK_MORE - BALANCE_DEFAULTS.ridgeback).toBeCloseTo(0.3, 9);
    expect(CUT_SHIFT).toBeCloseTo(0.3 / perDegree, 9);
    expect(CUT_SHIFT.toFixed(1)).toBe('5.6');
    expect((perDegree * 1000).toFixed(1)).toBe('53.5');
    expect((300 / 53.5).toFixed(1)).toBe('5.6');
    expect(CUT_ONSET.toFixed(1)).toBe('4.5');
    expect(LNG_CUT_TEMP_MORE).toBe(-2);
    expect(LNG_CUT_TEMP - LNG_CUT_TEMP_MORE).toBe(6);
    // The continuous onset moves by CUT_SHIFT, landing between −2 and −1.
    const onsetMore = LNG_CUT_TEMP_MORE + at(LNG_CUT_TEMP_MORE, RIDGEBACK_MORE).lngCut / perDegree;
    expect(onsetMore).toBeCloseTo(CUT_ONSET - CUT_SHIFT, 6);
    expect(onsetMore).toBeGreaterThan(-2);
    expect(onsetMore).toBeLessThan(-1);
  });

  it('every step of the climb moves by the same six degrees, at the same prices', () => {
    for (const t of [10, 9, 8, 7, 4]) {
      const a = at(t);
      const b = at(t - 6, RIDGEBACK_MORE);
      expect(b.price).toBeCloseTo(a.price, 9);
      expect(b.marginal.id.startsWith('wd-')).toBe(a.marginal.id.startsWith('wd-'));
    }
    expect(at(10 - 5, RIDGEBACK_MORE).marginal.id.startsWith('wd-')).toBe(true);
  });

  it('is unsolved at the start and solved only at −2 °F with Ridgeback at 2.9 Bcf/d', () => {
    expect(lngCutSolved(BALANCE_DEFAULTS)).toBe(false);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, ridgeback: RIDGEBACK_MORE })).toBe(false);
    expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: -2, ridgeback: 2 + 18 * 0.05 })).toBe(true);
    for (const temp of [-1, -3, 4]) expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp, ridgeback: RIDGEBACK_MORE })).toBe(false);
    for (const ridgeback of [2.85, 2.95]) expect(lngCutSolved({ ...BALANCE_DEFAULTS, temp: -2, ridgeback })).toBe(false);
  });

  it('only from −18 °F would interruptible industry be cut; below $5 LNG gives way before flexible industry', () => {
    expect(INTERRUPTIBLE_TEMP).toBe(-18);
    expect(at(-17).price).toBeCloseTo(LNG_VALUE, 9);
    expect(at(-18).price).toBeCloseTo(8, 9);
    expect(at(-20).price).toBeCloseTo(OIL_SWITCH_VALUE, 9);
    let cut = NaN;
    for (let t = 40; t >= -20; t--) if (at(t, BALANCE_DEFAULTS.ridgeback, 4.75).lngCut > 1e-6) { cut = t; break; }
    expect(cut).toBeGreaterThan(LNG_CUT_TEMP);
    const d = at(cut, BALANCE_DEFAULTS.ridgeback, 4.75);
    expect(d.price).toBeCloseTo(4.75, 9);
    const flexible = d.demand.find((x) => x.id === 'bayport-flexible')!;
    expect(flexible.used).toBeCloseTo(flexible.q, 9);
    expect(at(LNG_CUT_TEMP, BALANCE_DEFAULTS.ridgeback, 6).price).toBeLessThan(at(LNG_CUT_TEMP).price);
  });

  it('its mild and typical winters are seeds 2 and 3, the same years as Lessons 4.2 and 4.4', () => {
    expect(BALANCE_YEARS.map((y) => y.seed)).toEqual([2, 3, 5]);
    expect(BALANCE_YEARS.map((y) => y.id)).toEqual(['mild', 'typical', 'cold']);
    expect(WINTER_SEEDS.mild).toBe(2);
    expect(WINTER_SEEDS.typical).toBe(3);
    for (const [id, seed] of [['mild', 2], ['typical', 3]] as const) {
      const y = balanceYear(seed);
      const w = hubWinter(id);
      expect(w.length).toBe(151);
      w.forEach((d, k) => expect(d.price.calder).toBeCloseTo(y[214 + k].price.calder, 9));
      winterYear(id).days.forEach((d, k) => expect(d.price.calder).toBeCloseTo(y[k].price.calder, 9));
    }
  });
});

describe('gas 4.2 challenge: when Northline fills', () => {
  it('has 0.74 Bcf/d of room filling at 48 MMcf/d a degree, so about 15 degrees: full first at 12 °F', () => {
    expect(Math.round(NL_PER_DEGREE * 1000)).toBe(48);
    expect(NL_ROOM).toBeCloseTo(0.739, 3);
    const predicted = HUB_DEFAULTS.temp - NL_ROOM / NL_PER_DEGREE;
    expect(predicted).toBeGreaterThan(12);
    expect(predicted).toBeLessThan(13);
    expect((NL_ROOM / NL_PER_DEGREE).toFixed(1)).toBe('15.4');
    expect(NL_FULL_TEMP).toBe(12);
    // Every degree from 28 °F to 13 °F adds the same flow, with Hollow Creek at its limit and the Valley Line full.
    const start = hubDay(HUB_DEFAULTS);
    for (let t = HUB_DEFAULTS.temp - 1; t >= 13; t--) {
      const d = hubDay({ ...HUB_DEFAULTS, temp: t });
      expect(d.flow[NL.id] - start.flow[NL.id]).toBeCloseTo((HUB_DEFAULTS.temp - t) * NL_PER_DEGREE, 6);
      expect(d.storageFlow.hollowcreek).toBeCloseTo(start.storageFlow.hollowcreek, 9);
      expect(d.flow['sandhill-metro']).toBeCloseTo(PIPELINE['sandhill-metro'].capacityBcfd, 9);
      expect(d.price.metro - d.price.calder).toBeCloseTo(NL.variableCost, 9);
    }
    const full = hubDay({ ...HUB_DEFAULTS, temp: 12 });
    expect(full.price.metro - full.price.calder).toBeCloseTo(0.56, 2);
  });

  it('is unsolved at the start', () => {
    expect(northlineFullSolved(HUB_DEFAULTS)).toBe(false);
    expect(northlineFullSolved({ ...HUB_DEFAULTS, temp: 12, northline: 1.75 })).toBe(false);
  });
});

describe('gas 4.3 challenge: the anchor contract', () => {
  it('works out to $21.6 million ÷ $97.64 ≈ 221,000 MMBtu/d, 225,000 on the slider', () => {
    expect(MARKETERS_ALL / 1e6).toBeCloseTo(3.2, 2);
    expect(ANCHOR_GAP / 1e6).toBeCloseTo(21.56, 2);
    expect(ANCHOR_MARGIN).toBeCloseTo(97.64, 2);
    expect(Math.round(ANCHOR_EXACT / 1000) * 1000).toBe(221000);
    expect(Math.round(21.6e6 / 97.64 / 1000) * 1000).toBe(221000);
    expect((EXPANSION_ANNUAL_COST / 1e6).toFixed(1)).toBe('24.8');
    expect(METRO_GAS_VALUE * ANCHOR_EXACT + MARKETER_BID * (EXPANSION_MMBTU_D - ANCHOR_EXACT)).toBeCloseTo(EXPANSION_ANNUAL_COST, 3);
    expect(ANCHOR_ANSWER).toBe(Math.ceil(ANCHOR_EXACT / QTY_STEP) * QTY_STEP);
    expect(anchorSolved(CAPACITY_AUCTION_DEFAULTS)).toBe(false);
  });

  it('one clearing price funds the station only if Metro Gas takes every unit', () => {
    for (let q = 0; q <= QTY_MAX; q += QTY_STEP) {
      const o = expansionOutcome({ rule: 'uniform', qty: q, bid: METRO_GAS_VALUE });
      expect(o.built).toBe(q >= EXPANSION_MMBTU_D);
    }
  });

  it('winters 1, 2 and 3 are the harsh, mild and typical winters of Lesson 4.2, and winter 3 peaks on a milder day', () => {
    for (const [i, id] of [[0, 'harsh'], [1, 'mild'], [2, 'typical']] as const) {
      const w = hubWinter(id);
      w.forEach((d, k) => expect(WINTERS[i].spreads[214 + k]).toBeCloseTo(d.price.metro - d.price.calder, 9));
    }
    expect(SPIKE_NOT_COLDEST.map((w) => w.seed)).toContain(3);
  });
});

describe('gas 4.4 challenge: predict the gap once storage stops filling', () => {
  it('the gap is the $0.10 carry: at the answer, and for every bigger size', () => {
    expect(ROUND_TRIP).toBeCloseTo(0.1, 9);
    const enough = enoughStorageScale();
    for (let i = Math.round(enough * 100); i <= 150; i++) {
      const s = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: i / 100 }));
      expect(s.step).toBeCloseTo(ROUND_TRIP, 6);
      expect(s.rent).toBeCloseTo(0, 9);
    }
    expect(enoughStorageSolved(SEASON_DEFAULTS)).toBe(false);
    expect(enoughStorageSolved({ ...SEASON_DEFAULTS, scale: 1.08 })).toBe(false);
    expect(enoughStorageSolved({ ...SEASON_DEFAULTS, scale: 1.06 })).toBe(false);
  });

  it('the typical winter has slightly fewer heating degree days than normal yet a dearer winter', () => {
    const n = winterStats('normal');
    const t = winterStats('typical');
    expect(t.winterHdd).toBeLessThan(n.winterHdd);
    expect(t.winterHdd).toBeGreaterThan(0.98 * n.winterHdd);
    expect(t.winterPrice).toBeGreaterThan(n.winterPrice + 0.1);
  });
});

/** Node's process, reached without Node's type definitions (the project doesn't install them). */
const nodeProcess = (globalThis as unknown as { process: { env: Record<string, string | undefined>; cwd(): string } }).process;

describe('gas 4.5: the precomputed forward table', () => {
  const r7 = (x: number) => Number(x.toFixed(7));
  const arr = (xs: number[]) => '[' + xs.map(r7).join(', ') + ']';
  const dates = Object.keys(CURVE_DAY) as CurveDate[];
  const levels: number[] = [];
  for (let l = LEVEL_MIN; l <= LEVEL_MAX; l += LEVEL_STEP) levels.push(l);
  const seeds = Object.values(FEB_WINTERS)
    .map((w) => w.seed)
    .sort((a, b) => a - b);

  it.skipIf(!nodeProcess.env.REGENERATE_GAS_FORWARD)('regenerates the forward table', async () => {
    const out: string[] = [
      '// Lesson 4.5’s forward curves and February-contract paths, precomputed so the lesson paints at once instead of',
      '// first running some 1,200 simulated stretches of weather. Each entry is what computeCurve or computeWinterPath in',
      '// L4_5.tsx returns, rounded to 1e-7; tests/gas-ch4.test.ts recomputes every one and fails if the model has moved.',
      '// Regenerate with: REGENERATE_GAS_FORWARD=1 npx vitest run tests/gas-ch4.test.ts -t "forward table"',
      '',
      "import type { ForwardCurve } from '../../../engines/gas/market';",
      "import type { WinterPath } from './L4_5';",
      '',
      '/** Keyed by curve date and storage level, e.g. "nov1|75". */',
      'export const FORWARD_CURVES: Record<string, ForwardCurve> = {',
    ];
    for (const d of dates)
      for (const l of levels) {
        const c = computeCurve(d, l);
        out.push(`  '${d}|${l}': {`, `    months: [${c.months.join(', ')}],`, `    calder: ${arr(c.calder)},`, `    metro: ${arr(c.metro)},`, `    calderSd: ${arr(c.calderSd)},`, '  },');
      }
    out.push('};', '', '/** Keyed by weather seed. */', 'export const WINTER_PATHS: Record<number, WinterPath> = {');
    for (const seed of seeds) {
      const w = computeWinterPath(seed);
      out.push(`  ${seed}: {`, `    path: ${arr(w.path)},`, `    febCalder: ${arr(w.febCalder)},`, `    febMetro: ${arr(w.febMetro)},`, '  },');
    }
    out.push('};');
    const fsModule = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsModule)) as { writeFileSync(path: string, data: string): void };
    fs.writeFileSync(`${nodeProcess.cwd()}/src/lessons/gas/ch4/forwardTable.ts`, out.join('\n') + '\n');
  }, 120_000);

  it('holds every curve the figure can draw, matching a fresh computation', () => {
    expect(Object.keys(FORWARD_CURVES).sort()).toEqual(dates.flatMap((d) => levels.map((l) => `${d}|${l}`)).sort());
    const close = (a: number[], b: number[]) => {
      expect(a.length).toBe(b.length);
      a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(1e-6));
    };
    for (const d of dates)
      for (const l of levels) {
        const live = computeCurve(d, l);
        const t = FORWARD_CURVES[`${d}|${l}`];
        expect(t.months).toEqual(live.months);
        close(t.calder, live.calder);
        close(t.metro, live.metro);
        close(t.calderSd, live.calderSd);
        expect(curveAt(d, l)).toBe(t);
      }
  }, 120_000);

  it('holds the three winters’ February contracts, matching a fresh computation', () => {
    expect(Object.keys(WINTER_PATHS).map(Number).sort((a, b) => a - b)).toEqual(seeds);
    for (const seed of seeds) {
      const live = computeWinterPath(seed);
      const t = WINTER_PATHS[seed];
      for (const k of ['path', 'febCalder', 'febMetro'] as const) {
        expect(t[k].length).toBe(live[k].length);
        t[k].forEach((x, i) => expect(Math.abs(x - live[k][i])).toBeLessThan(1e-6));
      }
    }
  }, 120_000);
});

describe('gas 4.5 challenges', () => {
  const at = (c: ReturnType<typeof curveAt>, m: number) => c.calder[c.months.indexOf(m)];
  const climb = (c: ReturnType<typeof curveAt>) => at(c, 10) - at(c, 8);

  it('a: at 75% the winter climb flattens but still rises, the nearest months rising most; it tips over at 70%', () => {
    const base = curveAt('nov1', 100);
    const short = curveAt('nov1', SHORT_LEVEL);
    expect(climb(short)).toBeGreaterThan(0);
    expect(climb(short)).toBeLessThan(climb(base));
    expect(climb(base).toFixed(2)).toBe('0.48');
    expect(climb(short).toFixed(2)).toBe('0.15');
    const rise = (m: number) => at(short, m) - at(base, m);
    expect(rise(8)).toBeGreaterThan(rise(9));
    expect(rise(9)).toBeGreaterThan(rise(10));
    const shown = (a: number, b: number) => (Math.round(a * 100) / 100 - Math.round(b * 100) / 100).toFixed(2);
    expect(shown(at(short, 8), at(base, 8))).toBe('1.27');
    expect(shown(at(short, 10), at(base, 10))).toBe('0.94');
    expect(shown(at(base, 10), at(base, 8))).toBe('0.48');
    expect(shown(at(short, 10), at(short, 8))).toBe('0.15');
    for (const m of base.months) expect(rise(m)).toBeGreaterThan(0);
    expect(curveChallengeSolved(FWD_DEFAULTS)).toBe(false);
  });

  it('b: futures plus the swap lock in $4.56 + $0.32 = $4.88; each winter misses by its February spot less the last futures price', () => {
    const cold = winterRun('cold');
    const locked = cold.path[0] + swapBasis();
    expect(cold.path[0].toFixed(2)).toBe('4.56');
    expect(swapBasis().toFixed(2)).toBe('0.32');
    expect(locked.toFixed(2)).toBe('4.88');
    const misses: Record<string, string> = {};
    for (const id of ['cold', 'typical', 'warm'] as const) {
      const w = winterRun(id);
      expect(w.path[0]).toBeCloseTo(cold.path[0], 9);
      const miss = w.calderAvg - w.path[w.path.length - 1];
      expect(utilityCost(id, HEDGE_CONTRACTS, true).net).toBeCloseTo(locked + miss, 9);
      misses[id] = miss.toFixed(2);
    }
    expect(misses).toEqual({ cold: '0.06', typical: '-0.27', warm: '-0.22' });
    expect(hedgeSolved(HEDGE_DEFAULTS)).toBe(false);
    expect(hedgeSolved({ contracts: 150, swap: true })).toBe(false);
    const r = costRange(HEDGE_CONTRACTS, true);
    expect([r.lo.toFixed(2), r.hi.toFixed(2)]).toEqual(['4.61', '4.94']);
  });

  it('its cold and typical winters are Lesson 4.4’s, and the warm one is new', () => {
    expect(FEB_WINTERS.cold.seed).toBe(WINTER_SEEDS.cold);
    expect(FEB_WINTERS.typical.seed).toBe(WINTER_SEEDS.typical);
    expect(Object.values(WINTER_SEEDS)).not.toContain(FEB_WINTERS.warm.seed);
    expect(BALANCE_YEARS.map((y) => y.seed)).not.toContain(FEB_WINTERS.warm.seed);
  });
});
