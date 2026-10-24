// Loading a bulk carrier: the order of pours, the race between shiploaders and ballast pumps, the
// bending of the hull girder as weight goes in, and the commercial clock — laytime and demurrage.
//
// Longitudinal strength treats the hull as a beam. Weight is spread along the length (steel
// everywhere, machinery aft, cargo in the holds, ballast under them); buoyancy is spread too, and
// for our prismatic hull it varies linearly with length as the ship trims, so that its center lines
// up under the center of gravity. Integrating weight minus buoyancy once gives the shear force, twice
// the bending moment. A hogging moment (ends heavy, middle buoyant) stretches the deck; a sagging
// moment (middle heavy) compresses it.

import { KESTREL, RHO_SEA, type VesselClass } from '../../model/shipping/vessels';
import { summerDisplacement } from './hydrostatics';

export interface HoldPlan {
  /** Number of cargo holds. */
  holds: number;
  /** Start and end of the cargo block, m from the aft perpendicular. */
  start: number;
  end: number;
}

/** Kestrel's seven holds between her engine room and her forepeak. */
export function holdPlan(v: VesselClass = KESTREL): HoldPlan {
  return { holds: v.loa > 260 ? 9 : 7, start: 0.16 * v.lbp, end: v.lbp - 24 };
}

export function holdSpan(p: HoldPlan, i: number): [number, number] {
  const l = (p.end - p.start) / p.holds;
  return [p.start + i * l, p.start + (i + 1) * l];
}

const STATIONS = 90;

interface Block {
  from: number;
  to: number;
  tonnes: number;
}

/** The ship's fixed weights: hull steel along the whole length, machinery aft, forecastle forward. */
function fixedWeights(v: VesselClass, p: HoldPlan): Block[] {
  const L = v.lbp;
  return [
    { from: 0, to: L, tonnes: 0.65 * v.lightship },
    { from: 0.02 * L, to: p.start, tonnes: 0.28 * v.lightship },
    { from: p.end, to: L, tonnes: 0.07 * v.lightship },
    { from: 0.04 * L, to: p.start + 6, tonnes: v.consumables },
  ];
}

export interface StrengthResult {
  displacement: number;
  /** Center of gravity, m from the aft perpendicular. */
  lcg: number;
  draftAft: number;
  draftFwd: number;
  /** Positive: down by the stern, m. */
  trim: number;
  xs: number[];
  shear: number[];
  /** Bending moment along the hull, t·m: positive is hogging. */
  moment: number[];
  /** The largest bending moment in either direction, t·m, and where. */
  maxMoment: number;
  maxAt: number;
  /** Signed bending moment at the largest point. */
  signedMax: number;
}

/**
 * The hull's sectional-area curve as a fraction of the midship section: full through the long
 * parallel middle body, tapering into the stern and, more sharply, into the bow. Its mean is close
 * to Kestrel's block coefficient.
 */
export function sectionShape(u: number): number {
  if (u < 0.2) return 0.35 + 0.65 * (u / 0.2);
  if (u > 0.85) return 1 - 0.75 * ((u - 0.85) / 0.15);
  return 1;
}

/**
 * Still-water shear force and bending moment for cargo per hold and ballast spread evenly under
 * the holds. Buoyancy per meter is the sectional-area curve times a draft that varies linearly
 * along the ship, solved so that buoyancy equals weight and acts under the center of gravity.
 */
export function hullStrength(v: VesselClass, plan: HoldPlan, cargoPerHold: number[], ballast: number): StrengthResult {
  const L = v.lbp;
  const blocks = [...fixedWeights(v, plan), { from: plan.start, to: plan.end, tonnes: ballast }];
  cargoPerHold.forEach((c, i) => {
    const [a, b] = holdSpan(plan, i);
    blocks.push({ from: a, to: b, tonnes: c });
  });
  const W = blocks.reduce((s, b) => s + b.tonnes, 0);
  const lcg = blocks.reduce((s, b) => s + (b.tonnes * (b.from + b.to)) / 2, 0) / W;
  const dx = L / STATIONS;
  const mids = Array.from({ length: STATIONS }, (_, k) => (k + 0.5) * dx);
  const shape = mids.map((x) => sectionShape(x / L));
  // b(x) = shape(x) · (a + c·(x − L/2)); match total W and moment W·lcg.
  const s0 = shape.reduce((t, f) => t + f * dx, 0);
  const s1 = shape.reduce((t, f, k) => t + f * (mids[k] - L / 2) * dx, 0);
  const s2 = shape.reduce((t, f, k) => t + f * (mids[k] - L / 2) ** 2 * dx, 0);
  const m1 = W * (lcg - L / 2);
  const det = s0 * s2 - s1 * s1;
  const a = (W * s2 - m1 * s1) / det;
  const c = (m1 * s0 - W * s1) / det;
  const xs: number[] = [0];
  const shear: number[] = [0];
  const moment: number[] = [0];
  let s = 0;
  let m = 0;
  for (let k = 0; k < STATIONS; k++) {
    const x0 = k * dx;
    const x1 = x0 + dx;
    let w = 0;
    for (const b of blocks) {
      const o = Math.max(0, Math.min(x1, b.to) - Math.max(x0, b.from));
      if (o > 0) w += (b.tonnes * o) / (b.to - b.from);
    }
    const q = shape[k] * (a + c * (mids[k] - L / 2)) * dx - w; // net upward load in the slice
    const sPrev = s;
    s += q;
    m += ((sPrev + s) / 2) * dx;
    xs.push(x1);
    shear.push(s);
    // Hogging (middle held up, ends hanging) is positive.
    moment.push(-m);
  }
  let maxMoment = 0;
  let maxAt = 0;
  let signedMax = 0;
  moment.forEach((mm, i) => {
    if (Math.abs(mm) > maxMoment) {
      maxMoment = Math.abs(mm);
      maxAt = xs[i];
      signedMax = mm;
    }
  });
  // Local draft is proportional to a + c·(x − L/2), scaled so the mean matches the hydrostatics.
  const meanDraft = W / (RHO_SEA * v.cb * L * v.beam);
  const draftAt = (x: number) => (meanDraft * (a + c * (x - L / 2))) / (W / s0);
  const draftAft = draftAt(0);
  const draftFwd = draftAt(L);
  return { displacement: W, lcg, draftAft, draftFwd, trim: draftAft - draftFwd, xs, shear, moment, maxMoment, maxAt, signedMax };
}

/**
 * Kestrel's allowable still-water bending moment in port, t·m (in our model): a full, evenly spread
 * cargo uses about four-fifths of it; filling holds one at a time to the top goes far over it.
 */
export const ALLOWABLE_MOMENT = 250_000;

/** Order in which holds are worked: from midships outward, alternating, to keep the girder balanced. */
export function pourOrder(holds: number): number[] {
  const mid = Math.floor(holds / 2);
  const out = [mid];
  for (let k = 1; out.length < holds; k++) {
    if (mid - k >= 0) out.push(mid - k);
    if (mid + k < holds) out.push(mid + k);
  }
  return out;
}

export interface LoadingInput {
  cargo: number;
  /** Passes over the holds: the cargo goes into each hold in this many pours. */
  passes: number;
  loaders: number;
  /** Rate of each shiploader, t/h. */
  loaderRate: number;
  /** Ballast pump capacity, t/h. */
  pumpRate: number;
  /** Ballast aboard on arrival, tonnes. */
  ballast: number;
  /** Hours to move a loader from one hold to another. */
  shiftHours: number;
}

export interface LoadingFrame {
  t: number;
  cargoPerHold: number[];
  ballast: number;
  /** Which hold each loader is pouring into, or −1 while shifting or waiting. */
  at: number[];
  waiting: boolean;
}

export interface LoadingResult {
  frames: LoadingFrame[];
  /** Hours from the first pour to the last. */
  hours: number;
  /** Hours the loaders stood waiting for the ballast pumps. */
  waitHours: number;
  /** Hours spent moving loaders between holds. */
  shiftHours: number;
  /** The largest bending moment during loading, t·m, and when (frame index). */
  peakMoment: number;
  peakFrame: number;
  final: StrengthResult;
}

const DT = 0.05;

/**
 * Simulate loading in steps of three minutes. Each loader works through its share of the pours;
 * moving between holds takes `shiftHours`. The pumps discharge ballast throughout, and a loader
 * stops whenever another tonne would put the ship past her summer displacement.
 */
export function simulateLoading(inp: LoadingInput, v: VesselClass = KESTREL): LoadingResult {
  const plan = holdPlan(v);
  const n = plan.holds;
  const order = pourOrder(n);
  const passes = Math.max(1, Math.round(inp.passes));
  const loaders = Math.max(1, Math.round(inp.loaders));
  const pour = inp.cargo / (n * passes);
  // The queue of pours, split between loaders: loader j takes every loaders-th pour.
  const pours: number[] = [];
  for (let p = 0; p < passes; p++) for (const h of p % 2 === 0 ? order : [...order].reverse()) pours.push(h);
  const queues = Array.from({ length: loaders }, (_, j) => pours.filter((_, k) => k % loaders === j));
  const state = queues.map(() => ({ idx: 0, left: pour, shift: 0 }));
  const cargo = Array<number>(n).fill(0);
  let ballast = inp.ballast;
  const maxDisp = summerDisplacement(v);
  const fixed = v.lightship + v.consumables;
  const frames: LoadingFrame[] = [];
  let t = 0;
  let waitHours = 0;
  let shiftTotal = 0;
  let peakMoment = 0;
  let peakFrame = 0;
  const done = () => state.every((s, j) => s.idx >= queues[j].length);
  const record = (at: number[], waiting: boolean) => {
    const f = { t, cargoPerHold: [...cargo], ballast, at, waiting };
    const st = hullStrength(v, plan, f.cargoPerHold, ballast);
    if (st.maxMoment > peakMoment) {
      peakMoment = st.maxMoment;
      peakFrame = frames.length;
    }
    frames.push(f);
  };
  record(state.map((s, j) => queues[j][s.idx] ?? -1), false);
  let guard = 0;
  while (!done() && guard++ < 20_000) {
    // Pumps run whenever there's ballast left.
    ballast = Math.max(0, ballast - inp.pumpRate * DT);
    const at: number[] = [];
    let waiting = false;
    state.forEach((s, j) => {
      if (s.idx >= queues[j].length) {
        at.push(-1);
        return;
      }
      if (s.shift > 0) {
        s.shift = Math.max(0, s.shift - DT);
        shiftTotal += DT / loaders;
        at.push(-1);
        return;
      }
      const room = maxDisp - (fixed + ballast + cargo.reduce((a, b) => a + b, 0));
      const amount = Math.min(s.left, inp.loaderRate * DT, Math.max(0, room));
      if (amount <= 1e-9) {
        waiting = true;
        at.push(-1);
        return;
      }
      const h = queues[j][s.idx];
      cargo[h] += amount;
      s.left -= amount;
      at.push(h);
      if (s.left <= 1e-6) {
        s.idx += 1;
        s.left = pour;
        if (s.idx < queues[j].length) s.shift = inp.shiftHours;
      }
    });
    if (waiting) waitHours += DT;
    t += DT;
    record(at, waiting);
  }
  // Pump out whatever ballast is left once the cargo is in.
  while (ballast > 1e-6 && guard++ < 40_000) {
    ballast = Math.max(0, ballast - inp.pumpRate * DT);
    t += DT;
    record(state.map(() => -1), false);
  }
  const last = frames[frames.length - 1];
  return {
    frames,
    hours: t,
    waitHours,
    shiftHours: shiftTotal,
    peakMoment,
    peakFrame,
    final: hullStrength(v, plan, last.cargoPerHold, last.ballast),
  };
}

// ---------------------------------------------------------------------------
// The port call and the commercial clock.

export interface PortCall {
  /** Hours waiting at anchor for a berth. */
  waitingHours: number;
  /** Berthing, hatch opening, draft surveys, documents and sailing, hours. */
  formalitiesHours: number;
  loadingHours: number;
  /** Hours lost to rain (grain can't be loaded in the rain). */
  rainHours: number;
}

export function portHours(c: PortCall): number {
  return c.waitingHours + c.formalitiesHours + c.loadingHours + c.rainHours;
}

export interface LaytimeTerms {
  /** Agreed loading rate, tonnes per day: laytime allowed = cargo ÷ rate. */
  ratePerDay: number;
  /** Hours after notice of readiness before laytime starts to count. */
  noticeHours: number;
  /** Whether time lost to bad weather is excluded ("weather working days"). */
  excludeWeather: boolean;
  /** Owner's compensation for each day beyond laytime, $/day. */
  demurrage: number;
  /** Paid to the charterer for each day saved, $/day (commonly half demurrage). */
  despatch: number;
}

export interface LaytimeResult {
  allowedDays: number;
  usedDays: number;
  /** Positive: demurrage owed by the charterer. Negative: despatch owed by the owner. */
  balance: number;
  demurrageDays: number;
}

/**
 * Laytime for a call where notice of readiness is tendered on arrival at the anchorage. Time
 * counts from notice plus the agreed notice hours, waiting included ("whether in berth or not"),
 * until loading ends; weather stoppages are excluded if the terms say so.
 */
export function laytime(cargo: number, c: PortCall, terms: LaytimeTerms): LaytimeResult {
  const allowedDays = cargo / terms.ratePerDay;
  const counted = c.waitingHours + c.loadingHours + c.formalitiesHours + (terms.excludeWeather ? 0 : c.rainHours) - terms.noticeHours;
  const usedDays = Math.max(0, counted) / 24;
  const over = usedDays - allowedDays;
  const balance = over > 0 ? over * terms.demurrage : over * terms.despatch;
  return { allowedDays, usedDays, balance, demurrageDays: Math.max(0, over) };
}
