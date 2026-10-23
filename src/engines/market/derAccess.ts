// Market access for an aggregated fleet of home batteries: which parts of the fleet a set of
// participation rules lets into the wholesale market, for which services, and roughly what that is
// worth. Rule sets are simplified to the few parameters that decide eligibility for this fleet;
// each carries its status and source so the lesson can label it.

import { availabilityDraws, type DerHome, type FleetDay } from '../ops/der';
import { optimizeArbitrage } from '../strategy/arbitrage';

export type DerService = 'energy' | 'reserves' | 'capacity';

export interface DerRuleSet {
  id: string;
  market: 'ERCOT' | 'PJM' | 'IESO';
  name: string;
  /** 'current' rules are in force; 'proposed' rules are approved-but-not-yet-effective or still in design. */
  status: 'current' | 'proposed';
  /** Short status label for the figure, e.g. "Current as of Oct. 22, 2026". */
  statusLabel: string;
  /** Smallest aggregation accepted, MW (null when we haven't modeled one). */
  minMW: number | null;
  /** Where the minimum comes from, when it needs qualifying. */
  minNote?: string;
  /** Largest single aggregation, MW (null: no limit modeled). Larger groups count only up to it. */
  maxMW: number | null;
  /** Can batteries behind a customer's meter take part? */
  behindMeter: boolean;
  /** Only reductions in the home's own consumption count (demand response): exports don't. */
  loadReductionOnly?: boolean;
  /** Where each service's aggregation must sit: across the whole zone, or at one node/substation. */
  services: Partial<Record<DerService, 'zone' | 'node'>>;
  /** Program-wide room left for new participants, MW, where a cap applies. */
  headroomMW?: Partial<Record<DerService, number>>;
  /** Which price energy is settled at. */
  settlement: 'zonal' | 'nodal' | null;
  /** Plain-language notes on telemetry, metering and other conditions. */
  notes: string;
  source: string;
}

const AS_OF = 'Oct. 22, 2026';

/**
 * Rules as verified on October 22, 2026 from the operators' own documents. Only parameters we could
 * verify are set; everything else is described in `notes` or left out.
 */
export const DER_RULES: DerRuleSet[] = [
  {
    id: 'ercot-ader',
    market: 'ERCOT',
    name: 'ADER pilot (Phase 3)',
    status: 'current',
    statusLabel: `Current as of ${AS_OF}`,
    minMW: 0.1,
    minNote: 'the minimum at the pilot’s 2023 launch',
    maxMW: null,
    behindMeter: true,
    services: { energy: 'zone', reserves: 'zone' },
    // 500 MW energy limit with 293 MW qualified; ECRS fully subscribed, Non-Spin about 68% used of 100 MW.
    headroomMW: { energy: 207, reserves: 32 },
    settlement: 'zonal',
    notes:
      'Dispatched with load-zone shift factors and settled at the load-zone price. Energy, plus Non-Spin and ECRS reserves. Pilot-wide limits: 500 MW for energy (293 MW qualified by Sept. 2026) and 100 MW for Non-Spin and ECRS (ECRS fully subscribed, about 68% of Non-Spin used), and 90% for any one QSE. Each aggregation had to reach 100 kW at the 2023 launch.',
    source: 'ERCOT ADER pilot updates (April and October 2026); PUCT announcement of the pilot launch (2023)',
  },
  {
    id: 'ercot-adesr',
    market: 'ERCOT',
    name: 'ADER Phase 4 (ADESR)',
    status: 'proposed',
    statusLabel: 'Proposed — ERCOT Board vote scheduled Dec. 7, 2026',
    minMW: 1,
    minNote: 'of injection capability, behind one substation transformer',
    maxMW: null,
    behindMeter: true,
    services: { energy: 'node' },
    settlement: 'zonal',
    notes:
      'Distribution-connected storage behind one substation transformer, at least 1 MW, dispatched nodally with state-of-charge visibility and device-level telemetry. Real-time energy only (no reserves, not biddable day-ahead), still settled at the load-zone price on existing interval meters. No pilot-wide MW limit.',
    source: 'ERCOT, “ADER Pilot Phase 4 – ADESR” (WMWG Sept. 25 and WMS Oct. 7, 2026)',
  },
  {
    id: 'pjm-capacity',
    market: 'PJM',
    name: 'DER capacity aggregation',
    status: 'current',
    statusLabel: `Current as of ${AS_OF}`,
    minMW: 0.1,
    maxMW: null,
    behindMeter: true,
    services: { capacity: 'zone' },
    settlement: null,
    notes:
      'Under PJM’s Order 2222 rules, DER aggregations could first offer capacity in the 2028/2029 auction (held July 2026; PJM received no DER offers). Capacity aggregations may span pricing nodes within a zone or sub-zonal area. Energy and reserves under the new model are not yet available.',
    source: 'PJM DISRS materials (2025–2026); PJM 2028/2029 Base Residual Auction results (July 2026)',
  },
  {
    id: 'pjm-2222',
    market: 'PJM',
    name: 'DER Aggregator model',
    status: 'proposed',
    statusLabel: 'FERC-approved, takes effect Feb. 1, 2028',
    minMW: 0.1,
    maxMW: null,
    behindMeter: true,
    services: { energy: 'node', reserves: 'node', capacity: 'zone' },
    settlement: 'nodal',
    notes:
      'Each aggregation sits at one pricing node, with exceptions: reserve-only aggregations up to 5 MW, capacity aggregations within a zone, and a limited multi-node option capped at 167 MW across PJM. The utility has 60 days to review each aggregation. Enrollment opens Nov. 2027.',
    source: 'PJM, “2222: Aggregate PNODE Creation” (DISRS, Sept. 1, 2026); PJM Order 2222 clean-up filing (Oct. 2025)',
  },
  {
    id: 'ieso-capacity',
    market: 'IESO',
    name: 'Capacity Auction (demand response)',
    status: 'current',
    statusLabel: `Current as of ${AS_OF}`,
    minMW: null,
    maxMW: null,
    behindMeter: true,
    loadReductionOnly: true,
    services: { capacity: 'zone' },
    settlement: null,
    notes:
      'Aggregated demand response can sell capacity in the IESO’s annual Capacity Auction by reducing load; Ontario’s nodal energy market (since May 1, 2025) has no aggregated-DER participation model yet. Minimum size and zonal rules are not modeled here.',
    source: 'IESO Capacity Auction and Market Renewal pages; IESO ERP DER Integration Project (2026)',
  },
  {
    id: 'ieso-dera',
    market: 'IESO',
    name: 'Front-of-meter DERA',
    status: 'proposed',
    statusLabel: 'Under development — IESO design proposal, Oct. 15, 2026',
    minMW: 1,
    maxMW: 20,
    behindMeter: false,
    services: { energy: 'node', reserves: 'node' },
    settlement: 'nodal',
    notes:
      'Aggregations of 1–20 MW behind one transmission–distribution interface and one local utility, of generators or storage connected in front of the customer’s meter, each with a wholesale revenue meter. Energy and operating reserve, day-ahead and real-time, at nodal prices. A behind-the-meter model is to come in a later engagement.',
    source: 'IESO, ERP DER Integration Project, market integration webinar (Oct. 15, 2026)',
  },
];

export interface AccessGroup {
  /** Substation index, or −1 for the whole fleet. */
  substation: number;
  homes: number;
  dependableMW: number;
}

export interface DependableByGroup {
  /** The whole fleet as one aggregation. */
  zone: AccessGroup;
  /** One aggregation per substation. */
  nodes: AccessGroup[];
  /** The whole fleet when only cuts in each home's own demand count. */
  zoneLoadReduction: AccessGroup;
}

/**
 * Dependable capacity (at `confidence`) of the first `count` homes as one aggregation, and split by
 * substation, with home i on substation i mod `substations` (so the same fleet can be spread over
 * any number of substations). `homeDemandKW[i]` is home i's demand at that hour, for rules where
 * exports don't count.
 */
export function dependableByGroup(
  homes: DerHome[],
  day: FleetDay,
  hour: number,
  substations: number,
  homeDemandKW: ArrayLike<number>,
  opts: { count?: number; confidence?: number; days?: number } = {},
): DependableByGroup {
  const n = Math.min(homes.length, opts.count ?? homes.length);
  const S = Math.max(1, Math.round(substations));
  const confidence = opts.confidence ?? 0.95;
  const days = opts.days ?? 200;
  const all = Array.from({ length: n }, (_, i) => i);
  const zone = availabilityDraws(homes, day, hour, { confidence, days, indices: all });
  const lr = availabilityDraws(homes, day, hour, { confidence, days, indices: all, capKW: homeDemandKW });
  const nodes: AccessGroup[] = [];
  for (let s = 0; s < S; s++) {
    const indices = all.filter((i) => i % S === s);
    const d = availabilityDraws(homes, day, hour, { confidence, days, indices, seed: 101 + s });
    nodes.push({ substation: s, homes: indices.length, dependableMW: d.dependable / 1000 });
  }
  return {
    zone: { substation: -1, homes: n, dependableMW: zone.dependable / 1000 },
    nodes,
    zoneLoadReduction: { substation: -1, homes: n, dependableMW: lr.dependable / 1000 },
  };
}

export interface AccessResult {
  /** Eligible MW for each service the rules offer. */
  eligibleMW: Partial<Record<DerService, number>>;
  /** Aggregations that qualify for at least one service. */
  qualifying: AccessGroup[];
  /** Why the fleet (or part of it) is shut out, if it is. */
  reasons: string[];
}

/** Apply a rule set to the fleet's aggregations. */
export function evaluateAccess(rules: DerRuleSet, groups: DependableByGroup): AccessResult {
  const eligibleMW: Partial<Record<DerService, number>> = {};
  const reasons: string[] = [];
  const qualifying = new Map<number, AccessGroup>();
  if (!rules.behindMeter) {
    for (const s of Object.keys(rules.services) as DerService[]) eligibleMW[s] = 0;
    reasons.push('Home batteries sit behind the customer’s meter, and these rules admit only front-of-meter resources.');
    return { eligibleMW, qualifying: [], reasons };
  }
  if (rules.loadReductionOnly) reasons.push('As demand response, each home counts only the consumption it cuts; its exports don’t count.');
  for (const [service, boundary] of Object.entries(rules.services) as Array<[DerService, 'zone' | 'node']>) {
    const candidates = boundary === 'zone' ? [rules.loadReductionOnly ? groups.zoneLoadReduction : groups.zone] : groups.nodes;
    let mw = 0;
    let tooSmall = 0;
    for (const g of candidates) {
      if (rules.minMW !== null && g.dependableMW < rules.minMW) {
        tooSmall++;
        continue;
      }
      mw += rules.maxMW !== null ? Math.min(rules.maxMW, g.dependableMW) : g.dependableMW;
      qualifying.set(g.substation, g);
    }
    const head = rules.headroomMW?.[service];
    if (head !== undefined && mw > head) {
      reasons.push(`Only ${Math.round(head)} MW of ${service} room is left under the program’s limit.`);
      mw = head;
    }
    if (tooSmall > 0 && boundary === 'node') reasons.push(`${tooSmall} of ${candidates.length} substations hold less than the ${rules.minMW} MW minimum.`);
    if (tooSmall > 0 && boundary === 'zone') reasons.push(`The fleet is below the ${rules.minMW} MW minimum.`);
    eligibleMW[service] = mw;
  }
  return { eligibleMW, qualifying: [...qualifying.values()], reasons: [...new Set(reasons)] };
}

/** Illustrative prices, the same in every market so that only the rules differ. */
export const ILLUSTRATIVE_PRICES = {
  /** Reserve payment, $ per MW per hour, offered for this many hours a day. */
  reservePerMWh: 4,
  reserveHours: 12,
  /** Capacity payment, $ per MW-day. */
  capacityPerMWday: 120,
};

/**
 * Indicative annual revenue, $, for each eligible service. Energy is valued at `energyPerMWday`
 * (the battery-arbitrage value at the settlement price); the streams are shown side by side, not
 * added, because the same battery can't always earn all of them at once.
 */
export function indicativeRevenue(result: AccessResult, energyPerMWday: number): Partial<Record<DerService, number>> {
  const out: Partial<Record<DerService, number>> = {};
  const p = ILLUSTRATIVE_PRICES;
  if (result.eligibleMW.energy !== undefined) out.energy = result.eligibleMW.energy * energyPerMWday * 365;
  if (result.eligibleMW.reserves !== undefined) out.reserves = result.eligibleMW.reserves * p.reservePerMWh * p.reserveHours * 365;
  if (result.eligibleMW.capacity !== undefined) out.capacity = result.eligibleMW.capacity * p.capacityPerMWday * 365;
  return out;
}

/**
 * Average daily arbitrage profit of 1 MW of storage with `durationH` hours, against each day's
 * hourly prices (perfect foresight, ending each day at least as full as it started), $/MW-day.
 */
export function arbitrageValuePerMWday(dailyPrices: number[][], durationH = 2.7, efficiency = 0.9): number {
  if (!dailyPrices.length) return 0;
  let total = 0;
  for (const prices of dailyPrices) total += optimizeArbitrage(prices, { powerMW: 1, energyMWh: durationH, efficiency, soc0: 0.5 }, { levels: 28 }).profit;
  return total / dailyPrices.length;
}
