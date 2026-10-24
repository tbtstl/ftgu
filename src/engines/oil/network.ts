// The crude network (Lesson 4.4, and the benchmark spread of Lesson 5.2).
//
// Crude moves from the fields to where it's refined or sold, by the cheapest routes the pipes,
// rails and ships allow. A linear program finds the flows that maximize the value delivered,
// net of transport costs, given each link's capacity and tariff. Northport is a deep, liquid
// market that buys or sells any amount at its price (the course's Brent-like benchmark); Eastbay
// buys at a premium. Inland and coastal refiners need fixed volumes.
//
// The price at each place is the value of one more barrel appearing there — found by solving
// again with an extra thousand barrels a day at that node. Where crude can flow freely, prices
// differ by transport costs; where a link is full, the price upstream falls until the next-best
// outlet (rail, then shutting in production) takes the barrel.

import { solveLP, type Sense } from '../market/lp';

export type NodeId = 'basin' | 'coldwater' | 'kessler' | 'inland' | 'calder' | 'seaboard' | 'northport' | 'eastbay';

export interface NetworkInputs {
  /** Production, kb/d. */
  basinSupply: number;
  coldwaterSupply: number;
  seaboardSupply: number;
  /** Refinery demand that must be met, kb/d. */
  inlandDemand: number;
  calderDemand: number;
  /** Link capacities, kb/d. */
  pipeline: number;
  coldwaterLine: number;
  rail: number;
  /** Costs, $/bbl. */
  pipelineTariff: number;
  coldwaterTariff: number;
  gathering: number;
  railCost: number;
  /** Tanker freight per barrel on each route. */
  freightSeaboardCalder: number;
  freightSeaboardNorthport: number;
  freightCalderNorthport: number;
  freightCalderEastbay: number;
  /** Market prices, $/bbl. */
  northportPrice: number;
  eastbayPremium: number;
  /** What a barrel is worth if it can't be moved (held back, stored or sold at distress), $/bbl. */
  floor: number;
}

export const NETWORK_DEFAULTS: NetworkInputs = {
  basinSupply: 400,
  coldwaterSupply: 250,
  seaboardSupply: 250,
  inlandDemand: 250,
  calderDemand: 600,
  pipeline: 480,
  coldwaterLine: 350,
  rail: 150,
  pipelineTariff: 2.0,
  coldwaterTariff: 4.0,
  gathering: 1.0,
  railCost: 10,
  freightSeaboardCalder: 1.2,
  freightSeaboardNorthport: 2.0,
  freightCalderNorthport: 2.5,
  freightCalderEastbay: 3.2,
  northportPrice: 79,
  eastbayPremium: 1.5,
  floor: 50,
};

export const LINK_IDS = [
  'basinKessler',
  'coldwaterKessler',
  'kesslerInland',
  'kesslerCalderPipe',
  'kesslerCalderRail',
  'seaboardCalder',
  'seaboardNorthport',
  'calderNorthport',
  'northportCalder',
  'calderEastbay',
] as const;
export type LinkId = (typeof LINK_IDS)[number];

export const LINK_ENDS: Record<LinkId, [NodeId, NodeId]> = {
  basinKessler: ['basin', 'kessler'],
  coldwaterKessler: ['coldwater', 'kessler'],
  kesslerInland: ['kessler', 'inland'],
  kesslerCalderPipe: ['kessler', 'calder'],
  kesslerCalderRail: ['kessler', 'calder'],
  seaboardCalder: ['seaboard', 'calder'],
  seaboardNorthport: ['seaboard', 'northport'],
  calderNorthport: ['calder', 'northport'],
  northportCalder: ['northport', 'calder'],
  calderEastbay: ['calder', 'eastbay'],
};

export interface NetworkSolution {
  status: string;
  flows: Record<LinkId, number>;
  /** Production held back at each field, kb/d. */
  shutIn: Record<'basin' | 'coldwater' | 'seaboard', number>;
  /** Crude sold into and bought from the Northport market, kb/d. */
  northportSales: number;
  northportPurchases: number;
  /** Value of the flows, $/day (thousands of barrels × $/bbl × 1000). */
  value: number;
}

const VARS = [...LINK_IDS, 'shutBasin', 'shutColdwater', 'shutSeaboard', 'sellNorthport', 'buyNorthport'] as const;

/** Solves the network with optional extra supply (kb/d) at one node, for prices. */
export function solveNetwork(inp: NetworkInputs = NETWORK_DEFAULTS, extra?: { node: NodeId; kbd: number }): NetworkSolution {
  const n = VARS.length;
  const ix = Object.fromEntries(VARS.map((v, i) => [v, i])) as Record<(typeof VARS)[number], number>;
  const A: number[][] = [];
  const b: number[] = [];
  const sense: Sense[] = [];
  const add = (coef: Partial<Record<(typeof VARS)[number], number>>, s: Sense, rhs: number) => {
    const r = Array<number>(n).fill(0);
    for (const [k, v] of Object.entries(coef)) r[ix[k as (typeof VARS)[number]]] = v as number;
    A.push(r);
    sense.push(s);
    b.push(rhs);
  };
  const x = (node: NodeId) => (extra && extra.node === node ? extra.kbd : 0);
  // Node balances: inflow + supply = outflow + demand.
  add({ basinKessler: 1, shutBasin: 1 }, '=', inp.basinSupply + x('basin'));
  add({ coldwaterKessler: 1, shutColdwater: 1 }, '=', inp.coldwaterSupply + x('coldwater'));
  add({ seaboardCalder: 1, seaboardNorthport: 1, shutSeaboard: 1 }, '=', inp.seaboardSupply + x('seaboard'));
  add({ basinKessler: 1, coldwaterKessler: 1, kesslerInland: -1, kesslerCalderPipe: -1, kesslerCalderRail: -1 }, '=', -x('kessler'));
  add({ kesslerInland: 1 }, '=', inp.inlandDemand - x('inland'));
  add({ kesslerCalderPipe: 1, kesslerCalderRail: 1, seaboardCalder: 1, northportCalder: 1, calderNorthport: -1, calderEastbay: -1 }, '=', inp.calderDemand - x('calder'));
  add({ seaboardNorthport: 1, calderNorthport: 1, buyNorthport: 1, northportCalder: -1, sellNorthport: -1 }, '=', -x('northport'));
  const ub = Array<number>(n).fill(Infinity);
  ub[ix.kesslerCalderPipe] = inp.pipeline;
  ub[ix.kesslerCalderRail] = inp.rail;
  ub[ix.coldwaterKessler] = inp.coldwaterLine;
  // Objective: maximize sales value − transport − purchases (+ the floor value of held-back oil).
  const c = Array<number>(n).fill(0);
  c[ix.basinKessler] = inp.gathering;
  c[ix.coldwaterKessler] = inp.coldwaterTariff;
  c[ix.kesslerInland] = 0.3;
  c[ix.kesslerCalderPipe] = inp.pipelineTariff;
  c[ix.kesslerCalderRail] = inp.railCost;
  c[ix.seaboardCalder] = inp.freightSeaboardCalder;
  c[ix.seaboardNorthport] = inp.freightSeaboardNorthport;
  c[ix.calderNorthport] = inp.freightCalderNorthport;
  c[ix.northportCalder] = inp.freightCalderNorthport;
  c[ix.calderEastbay] = inp.freightCalderEastbay - (inp.northportPrice + inp.eastbayPremium);
  c[ix.shutBasin] = -inp.floor;
  c[ix.shutColdwater] = -inp.floor;
  c[ix.shutSeaboard] = -inp.floor;
  c[ix.sellNorthport] = -inp.northportPrice;
  c[ix.buyNorthport] = inp.northportPrice;
  const sol = solveLP({ c, A, b, sense, ub });
  const v = sol.x;
  return {
    status: sol.status,
    flows: Object.fromEntries(LINK_IDS.map((l) => [l, v[ix[l]]])) as Record<LinkId, number>,
    shutIn: { basin: v[ix.shutBasin], coldwater: v[ix.shutColdwater], seaboard: v[ix.shutSeaboard] },
    northportSales: v[ix.sellNorthport],
    northportPurchases: v[ix.buyNorthport],
    value: -sol.objective * 1000,
  };
}

export const NODE_IDS: NodeId[] = ['basin', 'coldwater', 'kessler', 'inland', 'calder', 'seaboard', 'northport', 'eastbay'];

/**
 * Crude price at each node, $/bbl: the value of one more barrel there. Eastbay's is its market
 * price; Northport's is its market price.
 */
export function nodePrices(inp: NetworkInputs = NETWORK_DEFAULTS): Record<NodeId, number> {
  const base = solveNetwork(inp).value;
  const step = 1;
  const out = {} as Record<NodeId, number>;
  for (const node of NODE_IDS) {
    if (node === 'eastbay') {
      out[node] = inp.northportPrice + inp.eastbayPremium;
      continue;
    }
    if (node === 'northport') {
      out[node] = inp.northportPrice;
      continue;
    }
    const more = solveNetwork(inp, { node, kbd: step }).value;
    out[node] = (more - base) / (step * 1000);
  }
  return out;
}

/** Spread between the coastal benchmark (Northport) and the inland hub (Kessler), $/bbl. */
export function hubSpread(inp: NetworkInputs = NETWORK_DEFAULTS): number {
  const p = nodePrices(inp);
  return p.northport - p.kessler;
}
