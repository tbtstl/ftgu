// Natural gas course, Chapter 5: numbers the lessons' prose states and the challenges after the fix passes.

import { describe, expect, it } from 'vitest';
import { psia } from '../src/engines/gas/properties';
import { lineCapacity } from '../src/engines/gas/compression';
import { COAL_SWITCH_BLOCKS, LNG_VALUE } from '../src/model/gas/demand';
import { BASINS, PIPELINE, STORAGE_SPECS, stationLineOf } from '../src/model/gas/world';
import { withdrawCapacity } from '../src/engines/gas/storage';
import { MMBTU_PER_MCF } from '../src/engines/gas/properties';
import {
  BASIS_DEFAULTS,
  basisStatsFor,
  basisYear,
  EXPRESS_ENOUGH,
  GROWTH,
  GROWTH_DEFAULTS,
  growthProduction,
  growthRun,
  latestYearSolved,
  NORMAL_GAP,
  northlineSolved,
  NORTHLINE_STATION_OUT as NL_OUT_51,
  NORTHLINE_STATION_OUT_MMCFD as NL_OUT_MMCFD_51,
  TAKEAWAY,
  type ExpansionYear,
} from '../src/lessons/gas/ch5/L5_1';
import {
  curveDaily,
  LEASE_DEFAULTS,
  LEASE_FEE,
  leaseCurve,
  leaseIntrinsic,
  leaseTrades,
  LEVEL_SPREAD_NEEDED,
  LEVEL_TARGET,
  levelChallengeSolved,
  levelSpread,
  levelValueHidden,
} from '../src/lessons/gas/ch5/L5_2';
import {
  COLD_POWER_ANSWER,
  COLD_POWER_CEILING,
  coldDayG2P,
  coldPowerSolved,
  G2P_BURN_SWEEP,
  G2P_COLD_DEFAULTS,
  G2P_DEFAULTS,
  G2P_SWITCHES,
  g2pHour,
  lakesideSpark,
  METRO_SUMMER,
  MILL_OVER_COAL,
  sparkTargetSolved,
  SUMMER_STEP,
  SWITCH_LABEL_AT,
} from '../src/lessons/gas/ch5/L5_3';
import {
  asiaPremium,
  CAP_PER_DOLLAR,
  cancelLevelSolved,
  CHARTER_HIGH,
  CHARTER_LOW,
  CLOSEST_TO_EDGE,
  daysText,
  edgeGap,
  FIRST_CANCELLED,
  HOME_COLDEST,
  HOME_DEFAULTS,
  homeBase,
  homeStats,
  homeYear,
  SUMMER_RANGE,
  summerCutSolved,
  TRADER_DEFAULTS,
  traderMonths,
  traderSummary,
} from '../src/lessons/gas/ch5/L5_4';
import {
  challengeShortfalls,
  CRISIS_DEFAULTS,
  crisisRun,
  crisisStats,
  giveWay,
  MAP_HEIGHT,
  MAP_WIDTH,
  NORTHLINE_CHALLENGE,
  northlineNeeded,
  NORTHLINE_STATION_OUT,
  NORTHLINE_STATION_OUT_MMCFD,
  STORM_DAYS,
  STORM_LEAD,
  stormNorthlineSolved,
  stormSettings,
  WORST_STORM,
} from '../src/lessons/gas/ch5/L5_5';

const r2 = (x: number) => Math.round(x * 100) / 100;

describe('gas chapter 5: a compressor station out on Northline', () => {
  it('leaves Northline about 1.47 Bcf/d, 1.45 on the sliders, in both 5.1 and 5.5', () => {
    const NL = PIPELINE['calder-metro'];
    expect(NL.stations).toBe(3);
    const two = lineCapacity({ ...stationLineOf(NL), stations: 2 }, psia(NL.minDeliveryPsig));
    expect(NL_OUT_MMCFD_51).toBeCloseTo(two, 9);
    expect(NORTHLINE_STATION_OUT_MMCFD).toBeCloseTo(two, 9);
    expect(Math.round(two)).toBe(1469);
    expect(NL_OUT_51).toBe(1.45);
    expect(NORTHLINE_STATION_OUT).toBe(1.45);
    expect(WORST_STORM.northline).toBe(1.45);
  });
});

describe('gas 5.1 after the fix pass', () => {
  it('crosses $1 on 21 days instead of 7 with a station out, averaging +$0.65', () => {
    const out = basisStatsFor({ ...BASIS_DEFAULTS, northline: NL_OUT_51 });
    expect(out.metroOver1).toBe(21);
    expect(basisStatsFor(BASIS_DEFAULTS).metroOver1).toBe(7);
    expect(r2(out.metroAvg)).toBe(0.65);
    // Most days are untouched: still at the cost of the trip.
    expect(out.metroAtTrip).toBe(335);
  });

  it('explains Calder’s 50¢ jump: one coal-switching block stranded', () => {
    const below = Math.round((EXPRESS_ENOUGH - 0.05) * 100) / 100;
    const stranded = BASINS[0].productionBcfd - (below + PIPELINE['ridgeback-bayport'].capacityBcfd + 0.1);
    expect(stranded).toBeCloseTo(0.05, 9);
    expect(COAL_SWITCH_BLOCKS.every((b) => b.bcfd === 0.05)).toBe(true);
    for (let i = 1; i < COAL_SWITCH_BLOCKS.length; i++) expect(COAL_SWITCH_BLOCKS[i - 1].value - COAL_SWITCH_BLOCKS[i].value).toBeCloseTo(0.5, 9);
    const asBuilt = basisYear(BASIS_DEFAULTS);
    const short = basisYear({ ...BASIS_DEFAULTS, express: below });
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const lift = avg(short.map((d) => d.price.calder)) - avg(asBuilt.map((d) => d.price.calder));
    expect(lift).toBeCloseTo(0.5, 1);
    // Most of the gas given up is the power plants' coal-switching burn.
    const powerCut = avg(asBuilt.map((d) => d.sectors.power)) - avg(short.map((d) => d.sectors.power));
    expect(powerCut / stranded).toBeGreaterThan(0.8);
    expect(powerCut / stranded).toBeLessThan(1);
  });

  it('gets nothing from a 1 Bcf/d expansion that a 0.5 Bcf/d one doesn’t give', () => {
    expect(TAKEAWAY + 0.5).toBeCloseTo(3.55, 9);
    expect(growthProduction(GROWTH.years - 1, 365)).toBeLessThan(TAKEAWAY + 0.5);
    for (const y of ['2', '3', '4', '5', '6'] as ExpansionYear[]) {
      const half = growthRun(y, 0.5);
      const full = growthRun(y, 1);
      full.monthly.forEach((b, i) => expect(b).toBeCloseTo(half.monthly[i], 9));
      full.rent.forEach((x, i) => expect(x).toBeCloseTo(half.rent[i], 0));
    }
  });
});

describe('gas 5.2 after the fix pass', () => {
  it('buys in May and September, cheaper than June by a fraction of a cent', () => {
    const base = leaseCurve(100).calder;
    const flow = leaseIntrinsic('salt').flow;
    const days = [30, 31, 30, 31, 31, 30, 31];
    let start = 0;
    const buys: number[] = [];
    days.forEach((n, m) => {
      if (flow.slice(start, start + n).reduce((a, b) => a + b, 0) > 1e-6) buys.push(m);
      start += n;
    });
    expect(buys).toEqual([1, 5]);
    const others = base.slice(0, 7).filter((_, m) => !buys.includes(m));
    const next = Math.min(...others);
    expect(base.indexOf(next)).toBe(2);
    for (const m of buys) {
      expect(base[m]).toBeLessThan(next);
      expect(next - base[m]).toBeLessThan(0.01);
    }
    expect([base[1], base[2], base[5]].map((x) => x.toFixed(2))).toEqual(['2.80', '2.80', '2.80']);
    expect(leaseTrades(flow, curveDaily(100)).buyAvg).toBeCloseTo(2.8, 2);
  });
});

describe('gas 5.3 after the fix pass', () => {
  it('lets Mill Creek set the 19:00 price only above $3.16; coal sets it below', () => {
    expect(MILL_OVER_COAL).toBe(G2P_SWITCHES[2].gas);
    expect(r2(MILL_OVER_COAL)).toBe(3.16);
    for (let i = 0; i <= 210; i++) {
      const g = Math.round((1.5 + i * 0.05) * 100) / 100;
      const h = g2pHour(g, 19);
      if (g < MILL_OVER_COAL - 1e-9) {
        expect(h.marginal).toBe('coal');
        expect(h.price).toBeCloseTo(28, 9);
      } else if (g > MILL_OVER_COAL + 1e-9) expect(h.marginal).toBe('cc2');
    }
  });

  it('puts Metro’s planned summer prices at or just above the $3.00 switching step', () => {
    expect(SUMMER_STEP).toBe(3);
    expect(r2(Math.min(...METRO_SUMMER))).toBe(3);
    expect(r2(Math.max(...METRO_SUMMER))).toBe(3.1);
    expect(METRO_SUMMER.every((p) => p >= SUMMER_STEP - 1e-9)).toBe(true);
  });
});

describe('gas 5.4 after the fix pass', () => {
  it('cuts the terminal on two late-winter days, not on the coldest one', () => {
    const h9 = homeStats(9);
    expect(h9.cutDayList).toEqual([342, 343]);
    expect(daysText(h9.cutDayList)).toBe('March 9 and 10');
    expect(HOME_COLDEST.day).toBe(274);
    expect(daysText([HOME_COLDEST.day])).toBe('December 31');
    expect(Math.round(HOME_COLDEST.temp)).toBe(10);
    expect(h9.cutDayList).not.toContain(HOME_COLDEST.day);
    // By then storage has been drawn down.
    const y = homeYear(9);
    for (const d of h9.cutDayList) {
      expect(y[d].storage.saltflat).toBeLessThan(y[HOME_COLDEST.day].storage.saltflat);
      expect(y[d].storage.hollowcreek).toBeLessThan(y[HOME_COLDEST.day].storage.hollowcreek);
    }
    expect(daysText([274, 342])).toBe('December 31 and March 9');
  });

  it('takes full feed gas on all but the tightest days when overseas prices are high, as in Chapter 4', () => {
    expect(homeStats(12).cutDays).toBe(2);
    expect(homeBase().cutDays).toBe(2);
    expect(homeBase().cap).toBeCloseTo(LNG_VALUE - PIPELINE['calder-bayport'].variableCost, 9);
  });
});

describe('gas 5.5 after the fix pass', () => {
  const FREEZE = { ...CRISIS_DEFAULTS, freeze: WORST_STORM.freeze };
  const OUTAGE = { ...FREEZE, northline: WORST_STORM.northline };
  const WORST = { ...OUTAGE, temp: WORST_STORM.temp };

  it('walks the storm with a station out: $20 at Metro, then rationing at −5 °F', () => {
    const o = crisisStats(OUTAGE);
    expect(o.peakMetro).toBeCloseTo(20, 6);
    expect(o.rationedBcf).toBeLessThan(1e-6);
    expect(r2(giveWay(crisisRun(OUTAGE)[STORM_LEAD], OUTAGE).oil)).toBe(0.61);
    const w = crisisStats(WORST);
    expect(r2(w.rationedBcf)).toBe(0.97);
    expect(w.rationDays).toBe(5);
    expect(giveWay(crisisRun(WORST)[STORM_LEAD], WORST).homes.toFixed(2)).toBe('0.18');
  });

  it('weighs the defenses with a station out', () => {
    expect(r2(crisisStats({ ...WORST, freeze: 0 }).rationedBcf)).toBe(r2(crisisStats(WORST).rationedBcf));
    expect(crisisStats({ ...WORST, northline: PIPELINE['calder-metro'].capacityBcfd }).rationedBcf).toBeLessThan(1e-6);
    const hold = crisisStats({ ...WORST, lngHold: true });
    expect(r2(hold.rationedBcf)).toBe(1.84);
    expect(r2(hold.peakCalder)).toBe(99.85);
    expect(crisisStats({ ...WORST, when: 'dec' }).rationedBcf).toBeLessThan(1e-6);
    expect(r2(crisisStats({ ...WORST, when: 'mar' }).rationedBcf)).toBe(2.06);
    expect(r2(crisisStats({ ...WORST, when: 'mar', northline: 1.8 }).rationedBcf)).toBe(0.42);
    const dec = crisisStats({ ...WORST, when: 'dec' });
    expect(Math.round(dec.hollowAtStorm)).toBe(110);
    const s = crisisStats(WORST);
    expect(Math.round(s.hollowAtStorm)).toBe(67);
    expect(r2(withdrawCapacity(STORAGE_SPECS.hollowcreek, s.hollowAtStorm))).toBe(0.82);
    // The first challenge doesn't depend on the outage figure.
    expect(northlineNeeded()).toBeCloseTo(1.7, 9);
  });

  it('reads Chapter 4’s $6.50 LNG value as a $6.40 cap at Calder', () => {
    expect(LNG_VALUE).toBe(6.5);
    expect(r2(LNG_VALUE - PIPELINE['calder-bayport'].variableCost)).toBe(6.4);
    // The freeze lifts Bayport to that value during the storm.
    const run = crisisRun(FREEZE);
    expect(Math.max(...run.map((d) => d.price.bayport))).toBeCloseTo(LNG_VALUE, 6);
  });
});

// ---------------------------------------------------------------------------
// Second fix pass: challenges the reader predicts before checking, and the figures around them.

describe('gas 5.1 challenges, second pass', () => {
  const at = (northline: number) => ({ ...BASIS_DEFAULTS, northline });

  it('needs 1.95 Bcf/d of Northline, judged from the sorted chart, and the rent then all but vanishes', () => {
    expect(northlineSolved(BASIS_DEFAULTS)).toBe(false);
    expect(northlineSolved(at(1.95))).toBe(true);
    expect(northlineSolved(at(1.9))).toBe(false);
    expect(northlineSolved(at(2))).toBe(false);
    expect(northlineSolved({ ...at(1.95), winter: 'typical' })).toBe(false);
    // At 1.90 the four days over $1 peak at $3.44, plain on the chart's $1 line.
    expect(basisStatsFor(at(1.9)).metroOver1).toBe(4);
    expect(r2(basisStatsFor(at(1.9)).metroMax)).toBe(3.44);
    // Not at the slider's end, and three steps from where it starts.
    expect(Math.round((1.95 - BASIS_DEFAULTS.northline) / 0.05)).toBe(3);
    expect(1.95).toBeLessThan(2.2);
    // The guess the question asks for: $84.6 million falls to about $138,000.
    expect(basisStatsFor(BASIS_DEFAULTS).northlineRent / 1e6).toBeCloseTo(84.6, 1);
    expect(Math.round(basisStatsFor(at(1.95)).northlineRent / 1000)).toBe(138);
  });

  it('predicts the latest expansion year from the month the basis first breaks', () => {
    const first = growthRun('never', 0.5).monthly.findIndex((b) => b < NORMAL_GAP);
    expect(first).toBe(3 * 12 + 8); // December of year 4
    const predicted = String(Math.floor(first / 12) + 1) as ExpansionYear;
    expect(predicted).toBe('4');
    expect(latestYearSolved({ ...GROWTH_DEFAULTS })).toBe(false);
    expect(latestYearSolved({ online: predicted, size: '0.5' })).toBe(true);
    expect(latestYearSolved({ online: '3', size: '0.5' })).toBe(false);
    expect(latestYearSolved({ online: '5', size: '0.5' })).toBe(false);
  });
});

describe('gas 5.2 challenge, second pass', () => {
  it('asks for a $2.22 spread, which the lease first earns at 120% of plan', () => {
    expect(LEVEL_SPREAD_NEEDED.toFixed(2)).toBe('2.22');
    expect((LEVEL_TARGET / (MMBTU_PER_MCF * 1e6)).toFixed(2)).toBe('2.12');
    expect(levelSpread(110)).toBeLessThan(LEVEL_SPREAD_NEEDED - 0.05);
    expect(levelSpread(120)).toBeGreaterThan(LEVEL_SPREAD_NEEDED + 0.02);
    expect(levelSpread(110).toFixed(2)).toBe('2.13');
    expect(levelSpread(120).toFixed(2)).toBe('2.25');
    // The arithmetic the question sets up is exact: the lease buys and sells all of its 1 Bcf.
    for (const level of [100, 110, 120, 130, 140]) {
      const t = leaseTrades(leaseIntrinsic('salt', level).flow, curveDaily(level));
      expect(t.bought).toBeCloseTo(1, 6);
      expect(t.sold).toBeCloseTo(1, 6);
      expect(leaseIntrinsic('salt', level).value).toBeCloseTo(MMBTU_PER_MCF * 1e6 * (levelSpread(level) - 2 * LEASE_FEE), -3);
    }
    // The readouts show the same spread to the cent.
    const shown = (level: number) => {
      const t = leaseTrades(leaseIntrinsic('salt', level).flow, curveDaily(level));
      return Number(t.sellAvg.toFixed(2)) - Number(t.buyAvg.toFixed(2));
    };
    expect(shown(110)).toBeCloseTo(2.13, 9);
    expect(shown(120)).toBeCloseTo(2.25, 9);
  });

  it('solves only at 120% from a default that is unsolved', () => {
    expect(levelChallengeSolved(LEASE_DEFAULTS)).toBe(false);
    expect(levelChallengeSolved({ ...LEASE_DEFAULTS, level: 120 })).toBe(true);
    expect(levelChallengeSolved({ ...LEASE_DEFAULTS, level: 110 })).toBe(false);
    expect(levelChallengeSolved({ ...LEASE_DEFAULTS, level: 130 })).toBe(false);
  });

  it('hides the Salt Flat lease’s value above plan until the challenge is solved', () => {
    expect(levelValueHidden(LEASE_DEFAULTS, false)).toBe(false);
    expect(levelValueHidden({ ...LEASE_DEFAULTS, level: 60 }, false)).toBe(false);
    for (const level of [110, 120, 130, 140]) {
      expect(levelValueHidden({ ...LEASE_DEFAULTS, level }, false)).toBe(true);
      expect(levelValueHidden({ ...LEASE_DEFAULTS, level }, true)).toBe(false);
      expect(levelValueHidden({ ...LEASE_DEFAULTS, level, lease: 'reservoir' }, false)).toBe(false);
      expect(levelValueHidden({ ...LEASE_DEFAULTS, level, fee: 0.1 }, false)).toBe(false);
    }
  });

  it('quotes the strips at 140%: summer falls to $2.39, winter only to $4.26 from $4.46', () => {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const hi = leaseCurve(140).calder;
    const base = leaseCurve(100).calder;
    expect(mean(hi.slice(0, 7)).toFixed(2)).toBe('2.39');
    expect(mean(hi.slice(7, 12)).toFixed(2)).toBe('4.26');
    expect(mean(base.slice(7, 12)).toFixed(2)).toBe('4.46');
    expect(leaseIntrinsic('salt', 140).value / 1e6).toBeCloseTo(2.41, 2);
  });
});

describe('gas 5.3 challenges and the demand figure, second pass', () => {
  it('makes Lakeside’s spread 1.2 × the gas price wherever Mill Creek sets 19:00, so $12 needs $10 gas', () => {
    expect(r2(MILL_OVER_COAL)).toBe(3.16);
    for (let i = 0; i <= 176; i++) {
      const g = Math.round((3.2 + i * 0.05) * 100) / 100;
      expect(lakesideSpark(g, 19)).toBeCloseTo(1.2 * g, 9);
    }
    expect(sparkTargetSolved(G2P_DEFAULTS)).toBe(false);
    expect(sparkTargetSolved({ gas: 10, hour: 19 })).toBe(true);
    expect(sparkTargetSolved({ gas: 9.95, hour: 19 })).toBe(false);
    expect(sparkTargetSolved({ gas: 10.05, hour: 19 })).toBe(false);
    expect(lakesideSpark(G2P_DEFAULTS.gas, 19)).toBeCloseTo(6, 9);
  });

  it('caps the 19:00 price at 7.6 × $15 + $4 = $118, first reached at 8 °F', () => {
    expect(COLD_POWER_CEILING).toBeCloseTo(118, 9);
    expect(COLD_POWER_ANSWER).toBe(8);
    expect(coldPowerSolved(G2P_COLD_DEFAULTS.temp)).toBe(false);
    expect(coldPowerSolved(8)).toBe(true);
    expect(coldPowerSolved(9)).toBe(false);
    expect(coldPowerSolved(7)).toBe(false);
    for (let t = -5; t <= 30; t++) {
      const c = coldDayG2P(t);
      expect(c.p19).toBeLessThanOrEqual(COLD_POWER_CEILING + 1e-6);
      if (t <= 8) expect(c.p19).toBeCloseTo(COLD_POWER_CEILING, 6);
    }
    expect(coldDayG2P(9).p19).toBeCloseTo(64.8, 9);
    expect(coldDayG2P(8).p19 / coldDayG2P(G2P_COLD_DEFAULTS.temp).p19).toBeGreaterThan(3);
    expect(Math.round(coldDayG2P(8).lakeMargin)).toBe(14400);
    expect(Math.round(coldDayG2P(G2P_COLD_DEFAULTS.temp).lakeMargin)).toBe(3929);
  });

  it('labels each switching line just above the step that follows it, top to bottom', () => {
    const after = (g: number) => G2P_BURN_SWEEP.find((b) => b.gas > g + 1e-9)!.mmbtu;
    G2P_SWITCHES.forEach((sw, i) => {
      expect(SWITCH_LABEL_AT[i]).toBeGreaterThan(after(sw.gas) + 5000);
      expect(SWITCH_LABEL_AT[i]).toBeLessThan(76000);
      if (i > 0) expect(SWITCH_LABEL_AT[i - 1] - SWITCH_LABEL_AT[i]).toBeGreaterThanOrEqual(10000);
    });
  });
});

describe('gas 5.4 challenges and the charter rate, second pass', () => {
  it('cancels September of year 1, the cargo closest to the band’s lower edge, first, at 75%', () => {
    expect(FIRST_CANCELLED).toEqual([8, 14]);
    expect(CLOSEST_TO_EDGE).toBe(8);
    expect(FIRST_CANCELLED).toContain(CLOSEST_TO_EDGE);
    expect(edgeGap(CLOSEST_TO_EDGE).toFixed(2)).toBe('1.43');
    expect(cancelLevelSolved(TRADER_DEFAULTS)).toBe(false);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 75 })).toBe(true);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 80 })).toBe(false);
    expect(cancelLevelSolved({ ...TRADER_DEFAULTS, level: 70 })).toBe(false);
    // The prose keeps only 60%: 14 of 24 cancelled.
    expect(traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: 60 })).cancelled).toBe(14);
  });

  it('gives the charter rate its two sentences', () => {
    expect([CHARTER_LOW, CHARTER_HIGH]).toEqual([20_000, 300_000]);
    const hi = traderSummary(traderMonths({ ...TRADER_DEFAULTS, charter: CHARTER_HIGH }));
    const lo = traderSummary(traderMonths({ ...TRADER_DEFAULTS, charter: CHARTER_LOW }));
    expect([hi.asia, hi.cancelled]).toEqual([3, 6]);
    expect([lo.asia, lo.atLoss]).toEqual([16, 2]);
    expect(Math.round(asiaPremium(9) * 100)).toBe(76);
    expect(asiaPremium(9, CHARTER_HIGH).toFixed(2)).toBe('2.20');
  });

  it('cuts the terminal in summer once the cap falls into summer’s prices: predicted and found at $5.50', () => {
    expect(Math.round(CAP_PER_DOLLAR * 100)).toBe(84);
    expect(SUMMER_RANGE.lo.toFixed(2)).toBe('3.00');
    expect(SUMMER_RANGE.hi.toFixed(2)).toBe('3.33');
    const h6 = homeStats(6);
    const h55 = homeStats(5.5);
    expect(h6.cap).toBeGreaterThan(SUMMER_RANGE.hi);
    expect(h55.cap).toBeGreaterThan(SUMMER_RANGE.lo);
    expect(h55.cap).toBeLessThan(SUMMER_RANGE.hi);
    // The estimate the question asks for lands on the answer.
    expect(h6.cap - 0.5 * CAP_PER_DOLLAR).toBeCloseTo(h55.cap, 6);
    expect(h55.cap.toFixed(2)).toBe('3.16');
    expect(summerCutSolved(HOME_DEFAULTS.asia)).toBe(false);
    expect(summerCutSolved(5.5)).toBe(true);
    expect(summerCutSolved(6)).toBe(false);
    expect(summerCutSolved(5)).toBe(false);
  });
});

describe('gas 5.5 challenge and figures, second pass', () => {
  it('reads the worst storm day’s shortfall off the map and predicts 1.70 Bcf/d', () => {
    const s = challengeShortfalls();
    expect(s).toHaveLength(STORM_DAYS);
    expect(s[0].toFixed(2)).toBe('0.18');
    expect(Math.max(...s)).toBe(s[s.length - 1]);
    expect(Math.max(...s).toFixed(2)).toBe('0.21');
    const estimate = NORTHLINE_STATION_OUT + Math.max(...s);
    expect(estimate.toFixed(2)).toBe('1.66');
    expect(Math.ceil(estimate / 0.05 - 1e-9) * 0.05).toBeCloseTo(northlineNeeded(), 9);
    const storm = { ...CRISIS_DEFAULTS, ...NORTHLINE_CHALLENGE };
    expect(stormNorthlineSolved(CRISIS_DEFAULTS)).toBe(false);
    expect(stormNorthlineSolved({ ...storm, northline: 1.7 })).toBe(true);
    expect(stormNorthlineSolved({ ...storm, northline: 1.65 })).toBe(false);
    expect(stormNorthlineSolved({ ...storm, northline: 1.75 })).toBe(false);
    expect(crisisStats({ ...NORTHLINE_CHALLENGE, northline: 1.65 }).rationedBcf.toFixed(2)).toBe('0.01');
  });

  it('names the storm’s hidden settings in the defenses table', () => {
    expect(stormSettings({ freeze: WORST_STORM.freeze, northline: WORST_STORM.northline, lngHold: false })).toBe('30% frozen off, Northline 1.45, cargoes give way');
    expect(stormSettings({ freeze: 0, northline: 2.05, lngHold: true })).toBe('no freeze-offs, Northline 2.05, cargoes keep loading');
  });

  it('draws the storm map about 280 px tall', () => {
    expect((MAP_WIDTH * MAP_HEIGHT) / 600).toBeGreaterThan(270);
    expect((MAP_WIDTH * MAP_HEIGHT) / 600).toBeLessThan(290);
  });
});
