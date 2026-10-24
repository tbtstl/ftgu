// The parts of a locational marginal price. In the DC model every LMP splits into an energy part,
// the same at every node, and a congestion part, one term for each flow constraint at its limit:
//
//   LMP_n = λ + Σ_k μ_k · PTDF_k,n        (and a loss part, which the DC model leaves at zero)
//
// λ is the price at a chosen reference node. μ_k is constraint k's shadow price: how much the
// cheapest dispatch would save each hour with one more megawatt of limit. PTDF_k,n is the share of
// one megawatt sent from the reference node to node n that flows on constraint k's line, counted
// positive in the direction the line is full; for a contingency constraint it's measured on the grid
// with that contingency's line out. With that sign convention every μ is positive or zero.

import type { Network } from '../../model/types';
import { computePtdf } from '../physics/powerflow';
import { dcopf, type OpfGenerator, type OpfOptions, type OpfResult } from './opf';

/** One flow constraint at its limit: a line in the base case, or a line after another one trips. */
export interface BindingConstraint {
  line: string;
  /** The line whose loss this constraint guards against; undefined for the base case. */
  outage?: string;
  /** +1 if the line is full in its from → to direction, −1 if full the other way. */
  direction: 1 | -1;
  /** Shadow price, $/h per MW of this constraint's limit (normal limit, or emergency limit after an outage); ≥ 0. */
  mu: number;
  /** True if the same line is at its limit in more than one case; `mu` is then their combined value, given to the first. */
  shared: boolean;
}

/** MW on `line`, positive from → to, per MW injected at `from` and withdrawn at `to`. */
export function transferPtdf(net: Network, line: string, from: string, to: string, outages: string[] = []): number {
  const { ptdf } = computePtdf(net, outages);
  return ptdf[line][from] - ptdf[line][to];
}

/**
 * Shadow prices of the constraints at their limits in an OPF result, found the way the LMPs are: by
 * solving again with the grid a little tighter. The LMPs add 0.1 MW of demand; here each line's
 * limit loses 0.1 MW. Probing both in the tightening direction keeps them consistent at the edges,
 * where a line has only just filled.
 */
export function shadowPrices(net: Network, gens: OpfGenerator[], loads: Record<string, number>, opts: OpfOptions, r: OpfResult): BindingConstraint[] {
  if (!r.feasible) return [];
  const outages = opts.outages ?? [];
  const rating = opts.emergencyRating ?? 1;
  const eps = 0.1;
  const limitOf = (id: string) => opts.limits?.[id] ?? net.lines.find((l) => l.id === id)!.limit;

  const cases: Array<{ line: string; outage?: string; direction: 1 | -1 }> = [];
  for (const id of r.binding) cases.push({ line: id, direction: r.flows[id] >= 0 ? 1 : -1 });
  if (r.bindingContingencies.length) {
    // Post-contingency flows, from the same injections the optimizer used.
    const inj: Record<string, number> = {};
    for (const n of net.nodes) inj[n.id] = -((loads[n.id] ?? 0) - (r.shed[n.id] ?? 0));
    for (const g of gens) inj[g.node] += r.dispatch[g.id] ?? 0;
    for (const b of r.bindingContingencies) {
      const { ptdf } = computePtdf(net, [...outages, b.outage]);
      const flow = net.nodes.reduce((s, n) => s + ptdf[b.line][n.id] * inj[n.id], 0);
      cases.push({ line: b.line, outage: b.outage, direction: flow >= 0 ? 1 : -1 });
    }
  }

  const seen = new Set<string>();
  return cases.map((c) => {
    const first = !seen.has(c.line);
    const shared = cases.filter((x) => x.line === c.line).length > 1;
    seen.add(c.line);
    if (!first) return { ...c, mu: 0, shared };
    const tighter = dcopf(net, gens, loads, { ...opts, limits: { ...opts.limits, [c.line]: limitOf(c.line) - eps }, lmp: false });
    // A contingency limit is the normal limit times the emergency rating, so it shrank by eps × rating.
    const shrank = c.outage ? eps * rating : eps;
    return { ...c, mu: tighter.feasible ? Math.max(0, (tighter.cost - r.cost) / shrank) : NaN, shared };
  });
}

export interface LmpParts {
  /** λ: the price at the reference node. */
  energy: number;
  /** Σ μ · PTDF over the constraints at their limits. */
  congestion: number;
  /** Zero in the DC model, which has no losses. */
  loss: number;
  total: number;
  /** Each constraint's term, μ × PTDF, in the order given. */
  terms: Array<{ mu: number; ptdf: number; value: number }>;
}

/** Energy, congestion and loss parts of every node's price, relative to a reference node. */
export function lmpComponents(net: Network, ref: string, lmpRef: number, constraints: BindingConstraint[], outages: string[] = []): Record<string, LmpParts> {
  const ptdfs = constraints.map((c) => computePtdf(net, c.outage ? [...outages, c.outage] : outages).ptdf[c.line]);
  const out: Record<string, LmpParts> = {};
  for (const n of net.nodes) {
    const terms = constraints.map((c, k) => {
      const ptdf = c.direction * (ptdfs[k][ref] - ptdfs[k][n.id]);
      return { mu: c.mu, ptdf, value: c.mu * ptdf };
    });
    const congestion = terms.reduce((s, t) => s + t.value, 0);
    out[n.id] = { energy: lmpRef, congestion, loss: 0, total: lmpRef + congestion, terms };
  }
  return out;
}
