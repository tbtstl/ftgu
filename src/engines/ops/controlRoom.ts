// A miniature control room (Lesson 3.6): the course region, simulated minute by minute through a
// scripted evening, with the telemetry, alarms and controls an operator would use.
//
// The region is one balancing area inside the ~18 GW interconnection of DEFAULT_FREQUENCY. Its
// ties to the neighbors are at North, so any imbalance flows in or out there. Each step:
//   • demand follows the day-ahead forecast plus a forecast error (and a scripted forecast miss),
//   • units move toward the operator's setpoints at their ramp limits; AGC adds a correction on
//     the units that take part in it, driving the area control error (ACE) toward zero,
//   • line flows come from a DC power flow over the lines in service,
//   • alarms are raised for loadings, reserves, ACE and frequency, and N-1 contingency analysis
//     checks what losing each line would do (reported separately, not as an alarm).
// Failure: a line above its limit for longer than its emergency allowance, or load shed because the
// area leaned on its neighbors for too long.

import { STANDARD_FLEET } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE } from '../../model/networks';
import { SOLAR_CF, WIND_CF } from '../../model/profiles';
import { ar1, rng } from '../../model/random';
import { computePtdf, dcPowerFlow, type Ptdf } from '../physics/powerflow';
import { forecastAt } from './balancing';
import { DEFAULT_FREQUENCY, simulateTrip } from './frequency';

const plant = (id: string) => STANDARD_FLEET.find((g) => g.id === id)!;

export interface CRUnit {
  id: string;
  name: string;
  node: string;
  capacity: number;
  /** MW per minute. */
  ramp: number;
  /** Share of the AGC signal this unit carries (0 = not on AGC). */
  agc: number;
}

/** Units the operator dispatches. Harbor Point nuclear runs flat out; wind and solar follow the weather. */
export const CR_UNITS: CRUnit[] = [
  { id: 'coal', agc: 0 },
  { id: 'cc1', agc: 0.6 },
  { id: 'cc2', agc: 0 },
  { id: 'ct', agc: 0 },
  { id: 'oil', agc: 0 },
  { id: 'hydro', agc: 0.4 },
].map(({ id, agc }) => {
  const g = plant(id);
  return { id, name: g.name, node: g.node!, capacity: g.capacity, ramp: g.rampRate / 60, agc };
});

export const CR_FIXED = { id: 'nuc', name: plant('nuc').name, node: plant('nuc').node!, mw: 400 };
const WIND = plant('wind');
const SOLAR = plant('solar');

export type ScenarioEvent =
  | { at: number; kind: 'unitTrip'; unit: string }
  | { at: number; kind: 'lineTrip'; line: string }
  | { at: number; kind: 'forecastMiss'; share: number; rampMinutes: number };

export interface CRScenario {
  start: number;
  end: number;
  seed: number;
  /** Simulated minutes per real second. */
  minutesPerSecond: number;
  events: ScenarioEvent[];
  /** Minutes a line may run above its limit (its emergency allowance). */
  overloadAllowance: number;
  /** ACE below −aceLimit MW for longer than aceMinutes leads the reliability coordinator to order load shed. */
  aceLimit: number;
  aceMinutes: number;
}

/** 15:00 to 21:00: a hotter evening than forecast, line Harbor–Central trips at 17:40, Mill Creek trips at 19:00. */
export const CR_SCENARIO: CRScenario = {
  start: 15 * 60,
  end: 21 * 60,
  seed: 7,
  minutesPerSecond: 2,
  events: [
    { at: 15 * 60 + 40, kind: 'forecastMiss', share: 0.05, rampMinutes: 100 },
    { at: 17 * 60 + 40, kind: 'lineTrip', line: 'harbor-center' },
    { at: 19 * 60, kind: 'unitTrip', unit: 'cc2' },
  ],
  overloadAllowance: 20,
  aceLimit: 150,
  aceMinutes: 30,
};

/** Frequency response of the whole interconnection, MW per Hz (governors plus load damping). */
export const INTERCONNECTION_BETA =
  DEFAULT_FREQUENCY.governorMW / (DEFAULT_FREQUENCY.droop * DEFAULT_FREQUENCY.f0) + (DEFAULT_FREQUENCY.damping * DEFAULT_FREQUENCY.loadMW) / DEFAULT_FREQUENCY.f0;

export type AlarmLevel = 'alarm' | 'warning';
export interface Alarm {
  id: string;
  level: AlarmLevel;
  text: string;
}

export interface LogEntry {
  t: number;
  text: string;
}

export interface CRSample {
  t: number;
  demand: number;
  forecast: number;
  ace: number;
  f: number;
  /** Highest line loading, share of its limit. */
  maxLoading: number;
}

export interface CRState {
  t: number;
  /** Actual output of each operator-dispatched unit, MW. */
  out: Record<string, number>;
  /** Integrated AGC signal, MW. */
  agc: number;
  trippedUnits: string[];
  linesOut: string[];
  forecastMissShare: number;
  demand: number;
  forecast: number;
  wind: number;
  solar: number;
  ace: number;
  f: number;
  flows: Record<string, number>;
  reserve: number;
  /** N-1 requirement: the largest single unit online, MW. */
  reserveNeed: number;
  /** For each line in service: the worst loading elsewhere if it tripped. */
  contingency: Array<{ out: string; worst: string; loading: number }>;
  alarms: Alarm[];
  log: LogEntry[];
  /** Consecutive minutes each line has been above its limit. */
  overloadRun: Record<string, number>;
  /** Lines that stayed overloaded past their emergency allowance. */
  sustainedOverloads: string[];
  aceLowRun: number;
  shedMW: number;
  shedMWh: number;
  hist: CRSample[];
  done: boolean;
  /** Demand noise path for the scenario, one value per minute from the start. */
  noise: number[];
}

const ptdfCache = new Map<string, Ptdf>();
function ptdfFor(out: string[]): Ptdf {
  const key = [...out].sort().join('|');
  let p = ptdfCache.get(key);
  if (!p) {
    p = computePtdf(REGION, out);
    ptdfCache.set(key, p);
  }
  return p;
}

function flowsFor(inj: Record<string, number>, out: string[]): Record<string, number> {
  const { ptdf } = ptdfFor(out);
  const outSet = new Set(out);
  const flows: Record<string, number> = {};
  for (const l of REGION.lines) {
    if (outSet.has(l.id)) {
      flows[l.id] = 0;
      continue;
    }
    let f = 0;
    for (const n of REGION.nodes) f += ptdf[l.id][n.id] * (inj[n.id] ?? 0);
    flows[l.id] = f;
  }
  return flows;
}

function interp(cf: number[], tMin: number): number {
  const x = tMin / 60 - 0.5;
  const i = Math.floor(x);
  const u = x - i;
  const n = cf.length;
  const a = cf[((i % n) + n) % n];
  const b = cf[(((i + 1) % n) + n) % n];
  return a + (b - a) * u;
}

export function lineName(id: string): string {
  const l = REGION.lines.find((x) => x.id === id)!;
  const nm = (n: string) => REGION.nodes.find((x) => x.id === n)!.name;
  return `${nm(l.from)}–${nm(l.to)}`;
}

/** Forecast demand, MW (the day-ahead forecast is the reference day). */
export function crForecast(t: number): number {
  return forecastAt(t);
}

/**
 * Day-ahead setpoints for the operator's units at time t, by merit order on forecast net demand
 * (Harbor Point and the weather-driven plants first). AGC units are left with room to move both ways.
 */
export function scheduleSetpoints(t: number, tripped: string[] = []): Record<string, number> {
  const net = crForecast(t) - CR_FIXED.mw - WIND.capacity * interp(WIND_CF, t) - SOLAR.capacity * interp(SOLAR_CF, t);
  const order = [...CR_UNITS].filter((u) => !tripped.includes(u.id)).sort((a, b) => plant(a.id).marginalCost - plant(b.id).marginalCost);
  const sp: Record<string, number> = Object.fromEntries(CR_UNITS.map((u) => [u.id, 0]));
  let left = net;
  for (const u of order) {
    // Keep regulating room on AGC units: schedule hydro at no more than 100 MW.
    const cap = u.id === 'hydro' ? 100 : u.capacity;
    const x = Math.max(0, Math.min(cap, left));
    sp[u.id] = x;
    left -= x;
  }
  return sp;
}

function demandNoise(sc: CRScenario): number[] {
  return ar1(rng(sc.seed), sc.end - sc.start + 2, Math.exp(-1 / 25), 10);
}

export function initialControlRoom(sc: CRScenario = CR_SCENARIO): CRState {
  const sp = scheduleSetpoints(sc.start);
  const noise = demandNoise(sc);
  const s: CRState = {
    t: sc.start,
    out: { ...sp },
    agc: 0,
    trippedUnits: [],
    linesOut: [],
    forecastMissShare: 0,
    demand: 0,
    forecast: 0,
    wind: 0,
    solar: 0,
    ace: 0,
    f: 60,
    flows: {},
    reserve: 0,
    reserveNeed: 0,
    contingency: [],
    alarms: [],
    log: [{ t: sc.start, text: 'Shift begins. Units are on their day-ahead schedule; AGC is on Lakeside and Falls hydro.' }],
    overloadRun: Object.fromEntries(REGION.lines.map((l) => [l.id, 0])),
    sustainedOverloads: [],
    aceLowRun: 0,
    shedMW: 0,
    shedMWh: 0,
    hist: [],
    done: false,
    noise,
  };
  const measured = measure(s, sc);
  return { ...measured, hist: [sampleOf(measured)] };
}

function sampleOf(s: CRState): CRSample {
  const maxLoading = Math.max(0, ...REGION.lines.map((l) => Math.abs(s.flows[l.id] ?? 0) / l.limit));
  return { t: s.t, demand: s.demand + s.shedMW, forecast: s.forecast, ace: s.ace, f: s.f, maxLoading };
}

/** Recompute everything that follows from the units' outputs: demand, ACE, flows, reserves, alarms. */
function measure(s: CRState, sc: CRScenario): CRState {
  const t = s.t;
  const forecast = crForecast(t);
  const k = Math.max(0, Math.min(s.noise.length - 1, Math.round(t - sc.start)));
  const totalDemand = forecast * (1 + s.forecastMissShare) + s.noise[k];
  const demand = Math.max(0, totalDemand - s.shedMW);
  const wind = WIND.capacity * interp(WIND_CF, t);
  const solar = SOLAR.capacity * interp(SOLAR_CF, t);
  const gen = CR_FIXED.mw + wind + solar + CR_UNITS.reduce((a, u) => a + (s.out[u.id] ?? 0), 0);
  // ACE = actual − scheduled interchange (scheduled is zero) − 10B·Δf. With the bias set to the
  // area's own frequency response, the governor terms cancel and ACE is the area's own imbalance.
  const ace = gen - demand;
  const f = DEFAULT_FREQUENCY.f0 + ace / INTERCONNECTION_BETA;
  const inj: Record<string, number> = Object.fromEntries(REGION.nodes.map((n) => [n.id, -REGION_LOAD_SHARE[n.id] * demand]));
  inj[CR_FIXED.node] += CR_FIXED.mw;
  inj[WIND.node!] += wind;
  inj[SOLAR.node!] += solar;
  for (const u of CR_UNITS) inj[u.node] += s.out[u.id] ?? 0;
  // The imbalance flows to or from the neighbors through the ties at North.
  inj.north -= ace;
  const flows = dcPowerFlow(REGION, inj, s.linesOut).flows;
  const online = CR_UNITS.filter((u) => !s.trippedUnits.includes(u.id));
  const reserve = online.reduce((a, u) => a + (u.capacity - (s.out[u.id] ?? 0)), 0);
  const reserveNeed = Math.max(CR_FIXED.mw, ...online.map((u) => s.out[u.id] ?? 0));
  // N-1: for each line still in service, what its loss would do to the others (PTDFs cached per outage set).
  const contingency = REGION.lines
    .filter((l) => !s.linesOut.includes(l.id))
    .map((l) => {
      const fl = flowsFor(inj, [...s.linesOut, l.id]);
      let worst = '';
      let loading = 0;
      for (const m of REGION.lines) {
        if (m.id === l.id || s.linesOut.includes(m.id)) continue;
        const u = Math.abs(fl[m.id]) / m.limit;
        if (u > loading) {
          loading = u;
          worst = m.id;
        }
      }
      return { out: l.id, worst, loading };
    })
    .sort((a, b) => b.loading - a.loading);
  const alarms: Alarm[] = [];
  for (const l of REGION.lines) {
    if (s.linesOut.includes(l.id)) {
      alarms.push({ id: 'out-' + l.id, level: 'warning', text: `Line ${lineName(l.id)} out of service` });
      continue;
    }
    const u = Math.abs(flows[l.id]) / l.limit;
    if (u > 1.0005) alarms.push({ id: 'ol-' + l.id, level: 'alarm', text: `Line ${lineName(l.id)} overloaded: ${Math.round(u * 100)}% of its limit` });
    else if (u >= 0.9) alarms.push({ id: 'hi-' + l.id, level: 'warning', text: `Line ${lineName(l.id)} at ${Math.round(u * 100)}% of its limit` });
  }
  if (reserve < reserveNeed) alarms.push({ id: 'res', level: 'warning', text: `Reserve ${Math.round(reserve)} MW is below the largest unit (${Math.round(reserveNeed)} MW)` });
  if (ace < -50) alarms.push({ id: 'ace', level: ace < -sc.aceLimit ? 'alarm' : 'warning', text: `ACE ${Math.round(ace)} MW: leaning on the neighbors` });
  else if (ace > 50) alarms.push({ id: 'ace', level: 'warning', text: `ACE +${Math.round(ace)} MW: pushing power onto the neighbors` });
  if (Math.abs(f - 60) >= 0.03) alarms.push({ id: 'freq', level: 'warning', text: `Frequency ${f.toFixed(3)} Hz` });
  if (s.shedMW > 0.5) alarms.push({ id: 'shed', level: 'alarm', text: `Load shed: ${Math.round(s.shedMW)} MW of customers disconnected` });
  return { ...s, demand, forecast: forecast, wind, solar, ace, f, flows, reserve, reserveNeed, contingency, alarms };
}

const SUB = 0.5; // simulated minutes per step

/**
 * Advance the control room by `dtMin` simulated minutes with the operator's setpoints. Scripted
 * events fire at their times; AGC (if on) integrates −ACE onto its units around their setpoints.
 */
export function stepControlRoom(s0: CRState, setpoints: Record<string, number>, agcOn: boolean, dtMin: number, sc: CRScenario = CR_SCENARIO): CRState {
  if (s0.done || !(dtMin > 0)) return s0;
  let s = s0;
  const end = Math.min(sc.end, s.t + dtMin);
  while (s.t < end - 1e-9) {
    const h = Math.min(SUB, end - s.t);
    const t1 = s.t + h;
    let { trippedUnits, linesOut, forecastMissShare, log } = s;
    const out = { ...s.out };
    // Scripted events.
    for (const e of sc.events) {
      if (e.at > s.t + 1e-9 && e.at <= t1 + 1e-9) {
        if (e.kind === 'unitTrip') {
          const lost = out[e.unit] ?? 0;
          trippedUnits = [...trippedUnits, e.unit];
          out[e.unit] = 0;
          const fr = simulateTrip(DEFAULT_FREQUENCY, Math.max(1, lost), 20, 0.1);
          log = [
            ...log,
            {
              t: e.at,
              text: `${plant(e.unit).name} tripped, losing ${Math.round(lost)} MW. Interconnection frequency dipped to ${fr.nadir.toFixed(3)} Hz within seconds as governors everywhere responded; the region now leans on its neighbors.`,
            },
          ];
        } else if (e.kind === 'lineTrip') {
          linesOut = [...linesOut, e.line];
          log = [...log, { t: e.at, text: `Lightning: line ${lineName(e.line)} tripped. Its flow shifted instantly onto the remaining lines.` }];
        } else {
          log = [...log, { t: e.at, text: `Demand is running above the day-ahead forecast: the evening is hotter than predicted.` }];
        }
      }
    }
    // Forecast miss grows linearly after it starts.
    const miss = sc.events.find((e) => e.kind === 'forecastMiss') as Extract<ScenarioEvent, { kind: 'forecastMiss' }> | undefined;
    if (miss && t1 > miss.at) forecastMissShare = miss.share * Math.min(1, (t1 - miss.at) / miss.rampMinutes);
    // AGC: integrate −ACE, limited to the room its units have around their setpoints.
    let agc = s.agc;
    const agcUnits = CR_UNITS.filter((u) => u.agc > 0 && !trippedUnits.includes(u.id));
    if (agcOn && agcUnits.length) {
      const share = agcUnits.reduce((a, u) => a + u.agc, 0);
      agc += (-s.ace * h) / 2;
      const up = Math.min(...agcUnits.map((u) => (u.capacity - Math.min(u.capacity, setpoints[u.id] ?? 0)) / (u.agc / share)));
      const down = Math.min(...agcUnits.map((u) => Math.max(0, setpoints[u.id] ?? 0) / (u.agc / share)));
      agc = Math.max(-down, Math.min(up, agc));
    } else agc = 0;
    // Units move toward their targets at their ramp limits.
    const share = agcUnits.reduce((a, u) => a + u.agc, 0) || 1;
    for (const u of CR_UNITS) {
      if (trippedUnits.includes(u.id)) {
        out[u.id] = 0;
        continue;
      }
      const sp = Math.max(0, Math.min(u.capacity, setpoints[u.id] ?? out[u.id]));
      const target = Math.max(0, Math.min(u.capacity, sp + (agcOn && u.agc > 0 ? (agc * u.agc) / share : 0)));
      const max = u.ramp * h;
      out[u.id] += Math.max(-max, Math.min(max, target - out[u.id]));
    }
    let next = measure({ ...s, t: t1, out, agc, trippedUnits, linesOut, forecastMissShare, log }, sc);
    // Overload timers and the emergency allowance.
    const overloadRun = { ...next.overloadRun };
    let sustained = next.sustainedOverloads;
    for (const l of REGION.lines) {
      const over = !linesOut.includes(l.id) && Math.abs(next.flows[l.id]) > l.limit * 1.0005;
      overloadRun[l.id] = over ? overloadRun[l.id] + h : 0;
      if (over && overloadRun[l.id] > sc.overloadAllowance && !sustained.includes(l.id)) {
        sustained = [...sustained, l.id];
        next = { ...next, log: [...next.log, { t: t1, text: `Line ${lineName(l.id)} has been overloaded for more than ${sc.overloadAllowance} minutes: a sustained overload.` }] };
      }
    }
    // Leaning on the neighbors for too long: the reliability coordinator orders load shed.
    let aceLowRun = next.ace < -sc.aceLimit ? s.aceLowRun + h : 0;
    let shedMW = next.shedMW;
    if (aceLowRun > sc.aceMinutes) {
      const add = -next.ace;
      shedMW += add;
      aceLowRun = 0;
      next = { ...next, shedMW, log: [...next.log, { t: t1, text: `The reliability coordinator ordered ${Math.round(add)} MW of load shed: the region leaned on its neighbors for over ${sc.aceMinutes} minutes.` }] };
      next = measure(next, sc);
    } else if (shedMW > 0 && next.ace > -20 && next.reserve > 50) {
      // Reconnect shed customers gradually while there's generation to spare.
      shedMW = Math.max(0, shedMW - 5 * h);
      next = measure({ ...next, shedMW }, sc);
    }
    const shedMWh = s.shedMWh + (next.shedMW * h) / 60;
    next = { ...next, overloadRun, sustainedOverloads: sustained, aceLowRun, shedMWh };
    const lastSample = next.hist[next.hist.length - 1];
    if (!lastSample || t1 - lastSample.t >= 2 - 1e-9) next = { ...next, hist: [...next.hist, sampleOf(next)] };
    s = { ...next, done: t1 >= sc.end - 1e-9 };
  }
  return s;
}
