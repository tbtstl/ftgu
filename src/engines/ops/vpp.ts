// A virtual power plant's control loop, second by second. The platform splits a target among its
// home batteries; commands reach each device after a communication delay; devices drop offline
// and come back at random; each device ramps toward its setpoint; telemetry reaches the platform
// after the same delay. Pure and deterministic: the random state lives inside the simulation state.

export interface VppParams {
  /** Number of enrolled devices. */
  devices: number;
  /** One-way communication delay, seconds (commands down, telemetry up). */
  latencyS: number;
  /** Long-run share of devices that are unreachable at any moment, 0–1. */
  dropout: number;
  /** Over-dispatch: request target × (1 + margin) to make up for devices that don't respond. */
  margin: number;
  /** Inverter rating of each device, kW. */
  deviceKW?: number;
  /** How fast a device changes output, kW per second. */
  rampKWps?: number;
  /** Seconds between dispatch commands. */
  controlIntervalS?: number;
  /** Average length of an outage, seconds. */
  outageS?: number;
  /** Delivery counts as on target within ± this share of the target. */
  tolerance?: number;
  /**
   * Closed-loop correction: each second, the request is nudged by this fraction of the error the
   * platform sees in its (delayed) telemetry, per second (integral control). 0 = open loop.
   */
  feedback?: number;
}

export interface VppDevice {
  online: boolean;
  /** Setpoint the device is working toward, kW. */
  setpoint: number;
  /** Output now, kW. */
  output: number;
  /** Commands in flight: [arrival time, kW]. */
  inbox: Array<[number, number]>;
}

export interface VppSample {
  t: number;
  /** MW. */
  target: number;
  requested: number;
  delivered: number;
  /** What the platform's telemetry shows (delivered, one latency ago). */
  telemetry: number;
}

export interface VppState {
  t: number;
  seed: number;
  devices: VppDevice[];
  nextDispatch: number;
  /** One sample per simulated second, most recent last (up to `keep`). */
  history: VppSample[];
  /** Accumulated closed-loop correction, as a share of the fleet's rating. */
  correction: number;
  /** Seconds in tolerance / seconds scored, since the settings last changed. */
  inTol: number;
  scored: number;
  /** The settings the score refers to. */
  key: string;
}

export const VPP_DEFAULTS = { deviceKW: 5, rampKWps: 1, controlIntervalS: 4, outageS: 90, tolerance: 0.1, feedback: 0 };
/** Length of the dispatch scenario, seconds; it repeats. */
export const VPP_SCENARIO_S = 600;
const KEEP = 600;

/**
 * The dispatch scenario: the share of the fleet's rating the market operator asks for, over a
 * repeating 10-minute cycle of holds and ramps.
 */
export function vppTarget(t: number): number {
  const s = ((t % VPP_SCENARIO_S) + VPP_SCENARIO_S) % VPP_SCENARIO_S;
  const pts: Array<[number, number]> = [
    [0, 0.25],
    [60, 0.25],
    [120, 0.55],
    [240, 0.55],
    [300, 0.35],
    [420, 0.35],
    [450, 0.65],
    [540, 0.65],
    [600, 0.25],
  ];
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i];
    const [t0, v0] = pts[i - 1];
    if (s <= t1) return v0 + ((v1 - v0) * (s - t0)) / (t1 - t0);
  }
  return pts[0][1];
}

/** mulberry32 step on an explicit state: returns [uniform 0–1, next state]. */
function rand(seed: number): [number, number] {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

function paramsKey(p: VppParams): string {
  return [p.devices, p.latencyS, p.dropout, p.margin, p.feedback ?? 0].join('|');
}

function full(p: VppParams) {
  return { ...VPP_DEFAULTS, ...p, devices: Math.max(1, Math.round(p.devices)), dropout: Math.min(0.95, Math.max(0, p.dropout)), margin: Math.max(0, p.margin), latencyS: Math.max(0, p.latencyS) };
}

function makeDevices(n: number, dropout: number, seed: number): [VppDevice[], number] {
  const devices: VppDevice[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    const [u, s2] = rand(s);
    s = s2;
    devices.push({ online: u >= dropout, setpoint: 0, output: 0, inbox: [] });
  }
  return [devices, s];
}

export function initVpp(params: VppParams, seed = 12345): VppState {
  const p = full(params);
  const [devices, s] = makeDevices(p.devices, p.dropout, seed >>> 0);
  return { t: 0, seed: s, devices, nextDispatch: 0, history: [], correction: 0, inTol: 0, scored: 0, key: paramsKey(params) };
}

/** Advance the simulation by `dt` seconds (internally in steps of at most 0.25 s). */
export function stepVpp(prev: VppState, params: VppParams, dt: number): VppState {
  const p = full(params);
  let seed = prev.seed;
  let devices = prev.devices.map((d) => ({ ...d, inbox: d.inbox.slice() }));
  if (devices.length !== p.devices) {
    // Fleet resized: keep the devices we have, add new ones (idle), drop the extras.
    if (devices.length > p.devices) devices = devices.slice(0, p.devices);
    else {
      const [extra, s2] = makeDevices(p.devices - devices.length, p.dropout, seed);
      seed = s2;
      devices = devices.concat(extra);
    }
  }
  const key = paramsKey(params);
  let { t, nextDispatch, inTol, scored, correction } = prev;
  if (key !== prev.key) {
    inTol = 0;
    scored = 0;
  }
  const history = prev.history.slice();
  const ratedMW = (p.devices * p.deviceKW) / 1000;
  // Outage process: on → off at rate λ, off → on at rate μ, so a share `dropout` is off on average.
  const mu = 1 / p.outageS;
  const lambda = p.dropout >= 0.95 ? 1e3 : (mu * p.dropout) / (1 - p.dropout);
  const steps = Math.max(1, Math.ceil(Math.max(0, dt) / 0.25));
  const h = Math.max(0, dt) / steps;
  for (let k = 0; k < steps; k++) {
    // 1. The platform dispatches: an equal share of the (over-)requested target to every device.
    if (t >= nextDispatch) {
      const share = Math.min(p.deviceKW, Math.max(0, (vppTarget(t) * (1 + p.margin) + correction) * p.deviceKW));
      for (const d of devices) {
        let u: number;
        [u, seed] = rand(seed);
        // Delay varies ±25% around the average.
        d.inbox.push([t + p.latencyS * (0.75 + 0.5 * u), share]);
      }
      nextDispatch = t + p.controlIntervalS;
    }
    t += h;
    // 2. Devices: outages, command arrival, ramping.
    for (const d of devices) {
      let u: number;
      [u, seed] = rand(seed);
      if (d.online && u < lambda * h) d.online = false;
      else if (!d.online && u < mu * h) d.online = true;
      while (d.inbox.length && d.inbox[0][0] <= t) {
        const [, kw] = d.inbox.shift()!;
        if (d.online) d.setpoint = kw; // a command that arrives while unreachable is lost
      }
      const goal = d.online ? d.setpoint : 0; // unreachable devices fall back to serving their home
      if (!d.online) d.setpoint = 0;
      const step = p.rampKWps * h;
      d.output = d.output < goal ? Math.min(goal, d.output + step) : Math.max(goal, d.output - step);
    }
    // 3. Record one sample per simulated second.
    const lastT = history.length ? history[history.length - 1].t : -Infinity;
    if (t - lastT >= 1 - 1e-9) {
      const delivered = devices.reduce((s, d) => s + d.output, 0) / 1000;
      const target = vppTarget(t) * ratedMW;
      const requested = Math.min(1, Math.max(0, vppTarget(t) * (1 + p.margin) + correction)) * ratedMW;
      const lagT = t - p.latencyS;
      let seen: number | null = null;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].t <= lagT + 1e-9) {
          seen = history[i].delivered;
          break;
        }
      }
      const telemetry = seen ?? 0;
      if (p.feedback > 0 && seen !== null) {
        // Integral control on what telemetry shows: the platform can only correct what it can see.
        correction += p.feedback * ((target - telemetry) / ratedMW);
        correction = Math.min(1, Math.max(-1, correction));
      }
      history.push({ t: Math.round(t * 1000) / 1000, target, requested, delivered, telemetry });
      if (history.length > KEEP) history.shift();
      scored += 1;
      if (Math.abs(delivered - target) <= p.tolerance * target) inTol += 1;
    }
  }
  return { t, seed, devices, nextDispatch, history, correction, inTol, scored, key };
}

/** Run the scenario headless for `seconds` and return the share of seconds in tolerance. */
export function vppScore(params: VppParams, seconds = VPP_SCENARIO_S, seed = 12345, warmup = 60): number {
  let s = initVpp(params, seed);
  s = stepVpp(s, params, warmup);
  s = { ...s, inTol: 0, scored: 0 };
  for (let i = 0; i < seconds; i++) s = stepVpp(s, params, 1);
  return s.scored ? s.inTol / s.scored : 0;
}
