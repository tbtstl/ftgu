// State estimation (Lesson 3.6): the EMS combines redundant, noisy SCADA measurements into one
// consistent picture of the grid. In the DC model the state is the voltage angle at every node but
// the reference; line flows and nodal injections are linear in it, so weighted least squares gives
// the best estimate, and the normalized residuals point at a meter that is badly wrong.

import type { Network } from '../../model/types';
import { invert } from '../physics/powerflow';
import { gaussian, rng } from '../../model/random';

export interface Meter {
  id: string;
  kind: 'flow' | 'injection';
  /** Line id (flow, positive from → to) or node id (injection, positive into the grid). */
  at: string;
  label: string;
}

export interface Estimate {
  /** Every meter's reading, the estimate of the same quantity, and its normalized residual. */
  rows: Array<{ meter: Meter; reading: number; estimate: number; truth: number; residual: number; normalized: number; used: boolean }>;
  /** Estimated line flows, MW. */
  flows: Record<string, number>;
  /** Meters rejected as bad data, in the order they were removed. */
  rejected: string[];
  /** Largest error of an estimated line flow against the truth, MW. */
  worstFlowError: number;
}

/** All line-flow and injection meters of a network. */
export function metersOf(net: Network): Meter[] {
  const name = (id: string) => net.nodes.find((n) => n.id === id)!.name;
  return [
    ...net.lines.map((l) => ({ id: 'f:' + l.id, kind: 'flow' as const, at: l.id, label: `${name(l.from)}–${name(l.to)} flow` })),
    ...net.nodes.map((n) => ({ id: 'p:' + n.id, kind: 'injection' as const, at: n.id, label: `${n.name} injection` })),
  ];
}

/** Measurement matrix row for a meter, over the non-reference angles. */
function row(net: Network, m: Meter, idx: Map<string, number>, k: number): number[] {
  const r = Array<number>(k).fill(0);
  const add = (node: string, v: number) => {
    const i = idx.get(node);
    if (i !== undefined) r[i] += v;
  };
  if (m.kind === 'flow') {
    const l = net.lines.find((x) => x.id === m.at)!;
    add(l.from, 1 / l.reactance);
    add(l.to, -1 / l.reactance);
  } else {
    for (const l of net.lines) {
      if (l.from === m.at) {
        add(l.from, 1 / l.reactance);
        add(l.to, -1 / l.reactance);
      } else if (l.to === m.at) {
        add(l.to, 1 / l.reactance);
        add(l.from, -1 / l.reactance);
      }
    }
  }
  return r;
}

/** True angles for given injections (reference = first node). */
function anglesFor(net: Network, inj: Record<string, number>): number[] {
  const others = net.nodes.slice(1).map((n) => n.id);
  const idx = new Map(others.map((id, i) => [id, i]));
  const k = others.length;
  const B = Array.from({ length: k }, () => Array<number>(k).fill(0));
  for (const l of net.lines) {
    const b = 1 / l.reactance;
    const i = idx.get(l.from);
    const j = idx.get(l.to);
    if (i !== undefined) B[i][i] += b;
    if (j !== undefined) B[j][j] += b;
    if (i !== undefined && j !== undefined) {
      B[i][j] -= b;
      B[j][i] -= b;
    }
  }
  const X = invert(B);
  return others.map((_, i) => others.reduce((s, id, j) => s + X[i][j] * (inj[id] ?? 0), 0));
}

const mul = (A: number[][], x: number[]) => A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));

/**
 * Estimate the state from meters reading the truth (from `injections`) plus seeded noise of `sigma`
 * MW, with `gross` MW added to one meter. With `detect`, repeatedly drop the meter with the largest
 * normalized residual while it exceeds `threshold`.
 */
export function estimateState(
  net: Network,
  injections: Record<string, number>,
  opts: { sigma?: number; seed?: number; gross?: { meter: string; mw: number }; detect?: boolean; threshold?: number } = {},
): Estimate {
  const sigma = opts.sigma ?? 3;
  const threshold = opts.threshold ?? 3;
  const meters = metersOf(net);
  const others = net.nodes.slice(1).map((n) => n.id);
  const idx = new Map(others.map((id, i) => [id, i]));
  const k = others.length;
  const H = meters.map((m) => row(net, m, idx, k));
  const theta = anglesFor(net, injections);
  const truth = mul(H, theta);
  const r = rng(opts.seed ?? 5);
  const z = truth.map((v, i) => v + sigma * gaussian(r) + (opts.gross && meters[i].id === opts.gross.meter ? opts.gross.mw : 0));
  const used = meters.map(() => true);
  const rejected: string[] = [];

  let est = solve();
  if (opts.detect) {
    for (let guard = 0; guard < 4; guard++) {
      let worst = -1;
      let worstVal = threshold;
      est.normalized.forEach((v, i) => {
        if (used[i] && Math.abs(v) > worstVal) {
          worstVal = Math.abs(v);
          worst = i;
        }
      });
      if (worst < 0) break;
      used[worst] = false;
      rejected.push(meters[worst].id);
      est = solve();
    }
  }

  function solve() {
    // Weighted least squares with equal weights 1/σ²: θ = (HᵀH)⁻¹ Hᵀ z over the meters in use.
    const Hu = H.filter((_, i) => used[i]);
    const zu = z.filter((_, i) => used[i]);
    const G = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => Hu.reduce((s, h) => s + h[a] * h[b], 0)));
    const Gi = invert(G);
    const rhs = Array.from({ length: k }, (_, a) => Hu.reduce((s, h, i) => s + h[a] * zu[i], 0));
    const th = mul(Gi, rhs);
    const zhat = mul(H, th);
    // Residual covariance (in units of σ²): Ω_ii = 1 − h_i G⁻¹ h_iᵀ for meters in use.
    const normalized = H.map((h, i) => {
      if (!used[i]) return 0;
      const q = h.reduce((s, v, a) => s + v * Gi[a].reduce((t, w, b) => t + w * h[b], 0), 0);
      const omega = Math.max(1e-9, 1 - q);
      return (z[i] - zhat[i]) / (sigma * Math.sqrt(omega));
    });
    return { zhat, normalized };
  }

  const flows: Record<string, number> = {};
  let worstFlowError = 0;
  meters.forEach((m, i) => {
    if (m.kind === 'flow') {
      flows[m.at] = est.zhat[i];
      worstFlowError = Math.max(worstFlowError, Math.abs(est.zhat[i] - truth[i]));
    }
  });
  return {
    rows: meters.map((m, i) => ({ meter: m, reading: z[i], estimate: est.zhat[i], truth: truth[i], residual: z[i] - est.zhat[i], normalized: est.normalized[i], used: used[i] })),
    flows,
    rejected,
    worstFlowError,
  };
}
