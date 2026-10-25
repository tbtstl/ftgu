// The capstone's GPU cloud, evaluated with the mechanics of the earlier chapters. A design has four
// parts, each set in one lesson of chapter 7: the fleet and its building (7.1, chapter 4), the
// customers and their demand (7.2, chapters 3 and 5), the price book (7.3, chapter 5) and the
// operating plan (7.4, chapter 6); 7.5 runs the whole business over three uncertain years (6.2, 6.5).
// Nothing here is new: every function combines engines the reader has already used.

import { rng, gaussian } from '../../model/random';
import { ACCELERATORS, GPU_IDS, type Cooling, type GpuId } from '../../model/compute/hardware';
import { PRICES } from '../../model/compute/prices';
import { SITES, type SiteId } from '../../model/compute/sites';
import type { WorkloadId } from '../../model/compute/workloads';
import { clusterLayout } from './rack';
import { POWER_DEFAULTS, powerChain, type Redundancy } from './facilityPower';
import { annualPue, chipCooling } from './cooling';
import { fabric, type Fabric } from './dcNetwork';
import { IDLE_POWER_SHARE, gpuHourCost } from './facilityCost';
import { trainingRun } from './training';
import { PHYSICS_DEFAULTS, productivityUnder } from './yieldManager';

// ---------------------------------------------------------------------------
// The fleet (7.1).

export interface FleetDesign {
  site: SiteId;
  gpus: Record<GpuId, number>;
  cooling: Cooling;
  /** Supply temperature: inlet air for air cooling, water for liquid, °C. */
  supplyC: number;
  /** Power feed to each rack position, kW. */
  feedKW: number;
  /** Leaf-switch ports facing GPUs (32 is non-blocking; more is oversubscribed). */
  downPorts: number;
  redundancy: Redundancy;
}

export const FLEET_DEFAULT: FleetDesign = {
  site: 'techpark',
  gpus: { L: 256, A: 1024, B: 256 },
  cooling: 'air',
  supplyC: 24,
  feedKW: 40,
  downPorts: 32,
  redundancy: 'N+1',
};

/** Assumptions the capstone holds fixed (Lesson 4.5's base case). */
export const FINANCE = { serverLifeYears: 5, facilityLifeYears: 15, rate: 0.1 };

export interface FleetCheck {
  id: 'racks' | 'grid' | 'cooling' | 'network';
  ok: boolean;
  text: string;
}

export interface FleetEval {
  total: number;
  racks: number;
  itMW: number;
  floorM2: number;
  pue: number;
  peakPue: number;
  /** Hottest-hour draw from the grid: IT, electrical losses and cooling, MW. */
  gridPeakMW: number;
  gridMW: number;
  /** Share of full speed each accelerator keeps (below 1 if it throttles). */
  speed: Record<GpuId, number>;
  fabric: Fabric;
  /** Training work done relative to a non-blocking network (the 70B run of Lesson 4.4). */
  trainingNetFactor: number;
  /** Capital spent, $. */
  capex: number;
  /** Capital recovery, network and upkeep per year, whatever the GPUs do, $. */
  fixedPerYear: number;
  /** Electricity for one busy GPU-hour, $ (idle GPUs draw 30% of it). */
  powerPerBusyHour: Record<GpuId, number>;
  checks: FleetCheck[];
  ok: boolean;
}

const netCache = new Map<number, number>();
/** Training work on a fabric giving each GPU `share` of its network card, relative to share 1. */
export function trainingNetFactor(share: number): number {
  const key = Math.round(share * 1000);
  const hit = netCache.get(key);
  if (hit !== undefined) return hit;
  const base = { model: '70B' as const, gpu: 'A' as const, gpus: 1024, tp: 8, pp: 1, batchTokens: 4 * 1024 * 1024, seqLen: 4096, tokens: 2e12 };
  const f = trainingRun(base).days / trainingRun({ ...base, networkShare: share }).days;
  netCache.set(key, f);
  return f;
}

const pueCache = new Map<string, ReturnType<typeof annualPue>>();
/** annualPue is a loop over the year's 8,760 hours; designs repeat, so remember the results. */
function cachedPue(f: FleetDesign, itMW: number) {
  const it = Math.max(0.1, Math.round(itMW * 10) / 10);
  const key = `${f.site}|${f.cooling}|${f.supplyC}|${f.redundancy}|${it}`;
  let v = pueCache.get(key);
  if (!v) {
    if (pueCache.size > 200) pueCache.clear();
    v = annualPue(SITES[f.site], { cooling: f.cooling, supplyC: f.supplyC }, { ...POWER_DEFAULTS, itMW: it, redundancy: f.redundancy });
    pueCache.set(key, v);
  }
  return v;
}

export function evaluateFleet(f: FleetDesign): FleetEval {
  const site = SITES[f.site];
  const total = GPU_IDS.reduce((s, g) => s + f.gpus[g], 0);
  let racks = 0;
  let itMW = 0;
  let rackFail = '';
  for (const g of GPU_IDS) {
    if (f.gpus[g] <= 0) continue;
    const lay = clusterLayout(g, f.cooling, f.feedKW, f.gpus[g]);
    if (!Number.isFinite(lay.racks)) rackFail = `A ${f.feedKW} kW feed can’t power even one ${ACCELERATORS[g].short} server.`;
    else {
      racks += lay.racks;
      itMW += lay.itMW;
    }
  }
  const yearly = cachedPue(f, itMW);
  const chain = powerChain({ ...POWER_DEFAULTS, itMW: Math.max(itMW, 1e-6), redundancy: f.redundancy });
  const gridPeakMW = itMW > 0 ? chain.gridMW + itMW * (yearly.peakPue - 1 - yearly.electricalPerKW) : 0;
  const speed = {} as Record<GpuId, number>;
  const throttled: string[] = [];
  for (const g of GPU_IDS) {
    const c = chipCooling(g, f.supplyC, f.cooling);
    speed[g] = c.speed;
    if (c.throttled && f.gpus[g] > 0) throttled.push(`${ACCELERATORS[g].short} at ${Math.round(c.speed * 100)}%`);
  }
  const fab = fabric({ gpus: Math.max(1, total), downPorts: f.downPorts });
  const netPerGpu = fab.costPerGpu * (fab.tooBig ? 1.5 : 1);
  let capex = 0;
  let fixedPerYear = 0;
  const powerPerBusyHour = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) {
    const c = gpuHourCost({ gpu: g, cooling: f.cooling, site, pue: yearly.pue, utilization: 1, ...FINANCE, networkPerGpu: netPerGpu });
    powerPerBusyHour[g] = (c.itKW * yearly.pue * site.powerPrice) / 1000;
    capex += f.gpus[g] * (c.serverCapex + c.networkCapex + c.facilityCapex);
    fixedPerYear += f.gpus[g] * (c.totalYear - c.powerYear);
  }
  const checks: FleetCheck[] = [
    { id: 'racks', ok: !rackFail && total > 0, text: rackFail || (total > 0 ? `${racks} racks on ${f.feedKW} kW feeds, ${itMW.toFixed(2)} MW of IT load.` : 'The fleet has no GPUs.') },
    {
      id: 'grid',
      ok: gridPeakMW <= site.gridMW + 1e-9,
      text: `At the hottest hour the site draws ${gridPeakMW.toFixed(1)} MW of ${site.name}’s ${site.gridMW} MW connection.`,
    },
    { id: 'cooling', ok: throttled.length === 0, text: throttled.length ? `Too warm for full speed: ${throttled.join(', ')}.` : 'Every chip runs at full speed.' },
    {
      id: 'network',
      ok: !fab.tooBig,
      text: fab.tooBig ? `${total} GPUs need a third tier of switches (network cost +50%).` : `Oversubscription ${fab.oversubscription.toFixed(2)} : 1, $${Math.round(netPerGpu).toLocaleString('en-US')} per GPU.`,
    },
  ];
  return {
    total,
    racks,
    itMW,
    floorM2: racks * 3,
    pue: yearly.pue,
    peakPue: yearly.peakPue,
    gridPeakMW,
    gridMW: site.gridMW,
    speed,
    fabric: fab,
    trainingNetFactor: trainingNetFactor(fab.crossShare),
    capex,
    fixedPerYear,
    powerPerBusyHour,
    checks,
    ok: checks[0].ok && checks[1].ok,
  };
}

/** Work each GPU of the fleet does for each workload, in A-class equivalents (Lessons 3.5, 6.1), after throttling and the network. */
export function fleetProductivity(f: FleetDesign, ev: FleetEval = evaluateFleet(f)): Record<WorkloadId, Record<GpuId, number>> {
  const base = productivityUnder(PHYSICS_DEFAULTS);
  const out = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const w of Object.keys(base) as WorkloadId[]) {
    out[w] = {} as Record<GpuId, number>;
    for (const g of GPU_IDS) out[w][g] = base[w][g] * ev.speed[g] * (w === 'train70' ? ev.trainingNetFactor : 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Customers (7.2).

export type Tier = 'reserved' | 'onDemand' | 'spot';

export interface Customer {
  id: string;
  name: string;
  workload: WorkloadId;
  /** A-class equivalents all its buyers together want in an average weekday hour, before price. */
  size: number;
  /** Daily swing, as a share of the average (interactive work peaks mid-afternoon). */
  swing: number;
  /** The middle of its buyers' values, $ per A-class-equivalent hour. */
  value: number;
  /** Longest round trip to its users, ms (Infinity: none). */
  maxRttMs: number;
  /** The product it buys. */
  tier: Tier;
  /** Expected demand growth per quarter (7.5). */
  growth: number;
}

export const CUSTOMERS_DEFAULT: Customer[] = [
  { id: 'c1', name: 'Chat startup', workload: 'chat70', size: 400, swing: 0.5, value: 3.5, maxRttMs: 100, tier: 'onDemand', growth: 0.06 },
  { id: 'c2', name: 'Code tools company', workload: 'code8', size: 120, swing: 0.6, value: 5.0, maxRttMs: 20, tier: 'onDemand', growth: 0.05 },
  { id: 'c3', name: 'Frontier lab', workload: 'frontier400', size: 200, swing: 0.5, value: 4.5, maxRttMs: 100, tier: 'reserved', growth: 0.04 },
  { id: 'c4', name: 'Model trainer', workload: 'train70', size: 500, swing: 0, value: 2.6, maxRttMs: Infinity, tier: 'reserved', growth: 0.03 },
  { id: 'c5', name: 'Fine-tuning shop', workload: 'tune8', size: 80, swing: 0, value: 2.4, maxRttMs: Infinity, tier: 'onDemand', growth: 0.03 },
  { id: 'c6', name: 'Document processor', workload: 'batch8', size: 500, swing: 0, value: 1.4, maxRttMs: Infinity, tier: 'spot', growth: 0.02 },
];

/** A customer's demand in an hour of the week (0–167), A-class equivalents, before price. */
export function hourlyDemand(c: Customer, hour: number): number {
  const day = Math.floor(hour / 24) % 7;
  const weekend = day >= 5 ? 0.8 : 1;
  if (c.swing <= 0) return c.size;
  return c.size * (1 + c.swing * Math.cos((2 * Math.PI * ((hour % 24) - 15)) / 24)) * weekend;
}

/** Whether the fleet's site is close enough to the customer's users. */
export function inReach(c: Customer, site: SiteId): boolean {
  return SITES[site].rttMs <= c.maxRttMs;
}

// ---------------------------------------------------------------------------
// Prices (7.3).

export type PriceBook = Record<Tier, Record<GpuId, number>>;

export const PRICEBOOK_DEFAULT: PriceBook = {
  reserved: { L: PRICES.L.reserved, A: PRICES.A.reserved, B: PRICES.B.reserved },
  onDemand: { L: PRICES.L.onDemand, A: PRICES.A.onDemand, B: PRICES.B.onDemand },
  spot: { L: PRICES.L.spot, A: PRICES.A.spot, B: PRICES.B.spot },
};

/** Work lost to interruptions on spot (Lesson 5.4: two reclaims a day, checkpoints every 30 minutes). */
export const SPOT_LOSS = 0.035;

/** What a customer pays per A-class-equivalent hour of its work on an accelerator, $ (Infinity if it can't run there). */
export function effectivePrice(c: Customer, g: GpuId, book: PriceBook, prod: Record<WorkloadId, Record<GpuId, number>>): number {
  const p = prod[c.workload][g];
  if (p <= 0) return Infinity;
  const raw = book[c.tier][g] / p;
  return c.tier === 'spot' ? raw / (1 - SPOT_LOSS) : raw;
}

/**
 * Share of a customer's demand that buys at an effective price: its buyers' values are spread evenly
 * from half to one and a half times its stated value, and each buys if the price is below its value.
 */
export function buyShare(c: Customer, price: number): number {
  if (!Number.isFinite(price)) return 0;
  return Math.max(0, Math.min(1, (1.5 * c.value - price) / c.value));
}

export interface Choice {
  gpu: GpuId;
  /** What the customer pays per A-class equivalent of its work on this accelerator, $. */
  price: number;
  /** Share of its demand willing to pay that much. */
  share: number;
}

export interface Offer {
  customer: Customer;
  /** Accelerators it would buy, cheapest for its work first (empty if none). */
  choices: Choice[];
  /** Its first choice, or null. */
  gpu: GpuId | null;
  price: number;
  share: number;
  /** Average A-class equivalents it buys at its first choice. */
  bought: number;
  reason?: string;
}

/**
 * What each customer would buy from the fleet at the price book's prices. It prefers the accelerator
 * that does its work most cheaply; if that one is full, the buyers still willing to pay a dearer one's
 * price buy there instead (Lesson 5.1's per-unit-of-work comparison, Lesson 5.5's demand at a price).
 */
export function offers(customers: Customer[], book: PriceBook, f: FleetDesign, prod = fleetProductivity(f)): Offer[] {
  return customers.map((c) => {
    const none = (reason: string): Offer => ({ customer: c, choices: [], gpu: null, price: Infinity, share: 0, bought: 0, reason });
    if (!inReach(c, f.site)) return none(`${SITES[f.site].name} is too far from its users.`);
    const choices: Choice[] = GPU_IDS.filter((g) => f.gpus[g] > 0)
      .map((g) => {
        const price = effectivePrice(c, g, book, prod);
        return { gpu: g, price, share: buyShare(c, price) };
      })
      .filter((x) => Number.isFinite(x.price))
      .sort((a, b) => a.price - b.price);
    if (!choices.length) return none('No accelerator in the fleet can run its work.');
    const first = choices[0];
    const buying = choices.filter((x) => x.share > 0);
    return {
      customer: c,
      choices: buying,
      gpu: first.gpu,
      price: first.price,
      share: first.share,
      bought: first.share * c.size,
      reason: buying.length ? undefined : 'The price is above what any of its buyers will pay.',
    };
  });
}

// ---------------------------------------------------------------------------
// Operations (7.4).

export interface OpsPlan {
  /**
   * After reserved customers (whose GPUs are committed to them): 'first-come' serves on-demand and
   * spot customers in a random order each hour; 'tiered' serves on-demand first and spot from what is
   * left — the yield management of Lesson 6.1.
   */
  policy: 'first-come' | 'tiered';
  /** GPUs rented on reserved contracts from another cloud, by type (paid every hour; Lesson 6.2). */
  rented: Record<GpuId, number>;
  /** Buy on-demand hours from another cloud when the fleet is full and the sale still earns more than it costs. */
  burst: boolean;
}

export const OPS_DEFAULT: OpsPlan = { policy: 'first-come', rented: { L: 0, A: 0, B: 0 }, burst: false };

export interface HourOps {
  /** A-class equivalents wanted at the customers' first-choice prices, and served on owned, rented and burst GPUs. */
  demand: number;
  owned: number;
  rented: number;
  burst: number;
  /** Wanted at the first-choice price but not served. */
  unmet: number;
}

export interface OpsResult {
  revenue: number;
  powerCost: number;
  rentCost: number;
  burstCost: number;
  /** Revenue minus power, rent and burst. */
  margin: number;
  /** The fleet's fixed cost over the same period. */
  fixedCost: number;
  profit: number;
  /** Share of each customer's first-choice demand served. */
  served: Record<string, number>;
  /** Revenue by customer. */
  revenueBy: Record<string, number>;
  utilization: Record<GpuId, number>;
  /** Hours of the fleet's own GPUs each customer used, by accelerator. */
  gpuHoursBy: Record<string, Record<GpuId, number>>;
  hours: HourOps[];
}

export interface OpsContext {
  f: FleetDesign;
  ev: FleetEval;
  prod: Record<WorkloadId, Record<GpuId, number>>;
  off: Offer[];
  book: PriceBook;
}

/** Everything about a design that doesn't change hour to hour: evaluate it once, then operate many times. */
export function prepare(customers: Customer[], book: PriceBook, f: FleetDesign): OpsContext {
  const ev = evaluateFleet(f);
  const prod = fleetProductivity(f, ev);
  return { f, ev, prod, off: offers(customers, book, f, prod), book };
}

export interface OperateOptions {
  hours?: number;
  /** Multiplier on each customer's demand (one number, or one per customer). */
  demandScale?: number | number[];
  /** Multiplier on what customers pay (a newer generation elsewhere lowers it; 7.5). */
  valueScale?: number;
  /** Share of the owned GPUs available (failures). */
  capacityShare?: number;
  /** Hour of the week (0 = Monday 00:00) the run starts at. */
  startHour?: number;
  seed?: number;
}

export function operate(customers: Customer[], book: PriceBook, f: FleetDesign, ops: OpsPlan, opts: OperateOptions = {}): OpsResult {
  return operateWith(prepare(customers, book, f), ops, opts);
}

const TIER_ORDER: Record<Tier, number> = { reserved: 0, onDemand: 1, spot: 2 };

export interface Commitment {
  customer: string;
  gpu: GpuId;
  gpus: number;
}

/**
 * Reserved customers' commitments (Lesson 5.4): enough GPUs of their cheapest accelerators to cover
 * their busiest hour, paid for every hour whether used or not, held for them first.
 */
export function commitments(ctx: OpsContext, demandScale: number | number[] = 1, valueScale = 1): { list: Commitment[]; left: Record<GpuId, number> } {
  const { f, off, prod } = ctx;
  const left: Record<GpuId, number> = { ...f.gpus };
  const list: Commitment[] = [];
  off.forEach((o, i) => {
    if (o.customer.tier !== 'reserved') return;
    const scale = Array.isArray(demandScale) ? demandScale[i] ?? 1 : demandScale;
    let peak = 0;
    for (let h = 0; h < 168; h++) peak = Math.max(peak, hourlyDemand(o.customer, h));
    let need = peak * scale;
    for (const ch of o.choices) {
      const share = valueScale === 1 ? ch.share : buyShare({ ...o.customer, value: o.customer.value * valueScale }, ch.price);
      const want = share * peak * scale - (peak * scale - need);
      if (want <= 1e-9 || left[ch.gpu] <= 0) continue;
      const gpus = Math.min(left[ch.gpu], Math.ceil(want / prod[o.customer.workload][ch.gpu]));
      left[ch.gpu] -= gpus;
      need -= gpus * prod[o.customer.workload][ch.gpu];
      list.push({ customer: o.customer.id, gpu: ch.gpu, gpus });
    }
  });
  return { list, left };
}

/**
 * Run the plan hour by hour (a week by default). Reserved customers use the GPUs committed to them
 * and pay for all of them every hour. Each hour on-demand and spot customers are then served —
 * 'tiered': on-demand first, spot from whatever is left, including committed GPUs a reserved customer
 * isn't using; 'first-come': in a random order — each on its cheapest accelerator first, then dearer
 * ones, as far as its willing buyers and the free GPUs (owned, then rented) allow, each GPU-hour billed
 * at its own price. With bursting on, on-demand work still waiting is bought elsewhere if that pays.
 */
export function operateWith(ctx: OpsContext, ops: OpsPlan, opts: OperateOptions = {}): OpsResult {
  const { f, ev, prod, off, book } = ctx;
  const H = opts.hours ?? 168;
  const start = opts.startHour ?? 0;
  const r = rng(opts.seed ?? 31);
  const vs = opts.valueScale ?? 1;
  const capShare = opts.capacityShare ?? 1;
  const choicesOf = off.map((o) => (vs === 1 ? o.choices : o.choices.map((ch) => ({ ...ch, share: buyShare({ ...o.customer, value: o.customer.value * vs }, ch.price) })).filter((ch) => ch.share > 0)));
  const scaleOf = (i: number) => (Array.isArray(opts.demandScale) ? opts.demandScale[i] ?? 1 : opts.demandScale ?? 1);
  const commit = commitments(ctx, opts.demandScale ?? 1, vs);
  let revenue = 0;
  let powerCost = 0;
  let burstCost = 0;
  const servedSum: number[] = off.map(() => 0);
  const wantedSum: number[] = off.map(() => 0);
  const revenueBy: number[] = off.map(() => 0);
  const ownedBy: Array<Record<GpuId, number>> = off.map(() => ({ L: 0, A: 0, B: 0 }));
  const busy: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
  const hours: HourOps[] = [];
  const idxOf = new Map(off.map((o, i) => [o.customer.id, i]));
  // Reserved revenue: every committed GPU, every hour.
  for (const c of commit.list) {
    const i = idxOf.get(c.customer)!;
    const rev = c.gpus * book.reserved[c.gpu] * H;
    revenue += rev;
    revenueBy[i] += rev;
  }
  const open = off.map((_, i) => i).filter((i) => off[i].customer.tier !== 'reserved');
  const tiered = [...open].sort((a, b) => TIER_ORDER[off[a].customer.tier] - TIER_ORDER[off[b].customer.tier] || off[b].customer.value - off[a].customer.value);
  for (let h = 0; h < H; h++) {
    const tally: HourOps = { demand: 0, owned: 0, rented: 0, burst: 0, unmet: 0 };
    // Uncommitted GPUs, reduced by failures; committed GPUs a reserved customer leaves idle this hour go to spot.
    const free: Record<GpuId, number> = { L: commit.left.L * capShare, A: commit.left.A * capShare, B: commit.left.B * capShare };
    const idleCommitted: Record<GpuId, number> = { L: 0, A: 0, B: 0 };
    off.forEach((o, i) => {
      if (o.customer.tier !== 'reserved') return;
      const want = (choicesOf[i][0]?.share ?? 0) * hourlyDemand(o.customer, (h + start) % 168) * scaleOf(i);
      tally.demand += want;
      wantedSum[i] += want;
      let need = want;
      for (const c of commit.list.filter((x) => x.customer === o.customer.id)) {
        const p = prod[o.customer.workload][c.gpu];
        const avail = c.gpus * capShare;
        const use = Math.min(avail, need / p);
        need -= use * p;
        busy[c.gpu] += use;
        ownedBy[i][c.gpu] += use;
        powerCost += use * ev.powerPerBusyHour[c.gpu] * (1 - IDLE_POWER_SHARE);
        tally.owned += use * p;
        idleCommitted[c.gpu] += avail - use;
      }
      servedSum[i] += want - Math.max(0, need);
      tally.unmet += Math.max(0, need);
    });
    const freeRented: Record<GpuId, number> = { ...ops.rented };
    let order = tiered;
    if (ops.policy === 'first-come') {
      order = [...open];
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
    }
    for (const i of order) {
      const chs = choicesOf[i];
      if (!chs.length) continue;
      const cust = off[i].customer;
      const size = hourlyDemand(cust, (h + start) % 168) * scaleOf(i);
      const firstWant = chs[0].share * size;
      tally.demand += firstWant;
      wantedSum[i] += firstWant;
      let served = 0;
      const pools: Array<[Record<GpuId, number>, 'owned' | 'rented']> = cust.tier === 'spot' ? [[free, 'owned'], [idleCommitted, 'owned'], [freeRented, 'rented']] : [[free, 'owned'], [freeRented, 'rented']];
      for (const ch of chs) {
        const p = prod[cust.workload][ch.gpu];
        for (const [pool, kind] of pools) {
          const want = ch.share * size - served;
          if (want <= 1e-9 || pool[ch.gpu] <= 0) continue;
          const gpus = Math.min(pool[ch.gpu], want / p);
          pool[ch.gpu] -= gpus;
          served += gpus * p;
          const rev = gpus * book[cust.tier][ch.gpu];
          revenue += rev;
          revenueBy[i] += rev;
          if (kind === 'owned') {
            busy[ch.gpu] += gpus;
            ownedBy[i][ch.gpu] += gpus;
            powerCost += gpus * ev.powerPerBusyHour[ch.gpu] * (1 - IDLE_POWER_SHARE);
            tally.owned += gpus * p;
          } else tally.rented += gpus * p;
        }
      }
      const left = firstWant - served;
      if (left > 1e-9 && ops.burst && cust.tier === 'onDemand') {
        const g = chs[0].gpu;
        const sale = book.onDemand[g];
        if (sale > PRICES[g].onDemand) {
          const gpus = left / prod[cust.workload][g];
          revenue += gpus * sale;
          revenueBy[i] += gpus * sale;
          burstCost += gpus * PRICES[g].onDemand;
          served += left;
          tally.burst += left;
        }
      }
      servedSum[i] += Math.min(served, firstWant);
      tally.unmet += Math.max(0, firstWant - served);
    }
    // Every owned GPU draws at least its idle power.
    for (const g of GPU_IDS) powerCost += f.gpus[g] * ev.powerPerBusyHour[g] * IDLE_POWER_SHARE;
    hours.push(tally);
  }
  const rentCost = GPU_IDS.reduce((s, g) => s + ops.rented[g] * PRICES[g].reserved * H, 0);
  const margin = revenue - powerCost - rentCost - burstCost;
  const fixedCost = (ev.fixedPerYear * H) / 8760;
  const served: Record<string, number> = {};
  const revBy: Record<string, number> = {};
  const gpuHoursBy: Record<string, Record<GpuId, number>> = {};
  off.forEach((o, i) => {
    served[o.customer.id] = wantedSum[i] > 0 ? servedSum[i] / wantedSum[i] : 0;
    revBy[o.customer.id] = revenueBy[i];
    gpuHoursBy[o.customer.id] = ownedBy[i];
  });
  return {
    revenue,
    powerCost,
    rentCost,
    burstCost,
    margin,
    fixedCost,
    profit: margin - fixedCost,
    served,
    revenueBy: revBy,
    utilization: { L: f.gpus.L > 0 ? busy.L / (f.gpus.L * H) : 0, A: f.gpus.A > 0 ? busy.A / (f.gpus.A * H) : 0, B: f.gpus.B > 0 ? busy.B / (f.gpus.B * H) : 0 },
    gpuHoursBy,
    hours,
  };
}

// ---------------------------------------------------------------------------
// The business over three years (7.5).

export interface WorldScenario {
  quarters: number;
  /** Uncertainty of each customer's growth per quarter (standard deviation). */
  growthSigma: number;
  /** Quarter in which the next generation reaches volume elsewhere (± spread), and how far it cuts what customers will pay for this fleet's work. */
  nextGenQuarter: number;
  nextGenSpread: number;
  nextGenDrop: number;
  /** Share of GPU-hours lost to failures and repairs. */
  failureShare: number;
  paths: number;
  rate: number;
  seed?: number;
}

export const WORLD_DEFAULT: WorldScenario = { quarters: 12, growthSigma: 0.12, nextGenQuarter: 6, nextGenSpread: 2, nextGenDrop: 0.3, failureShare: 0.03, paths: 120, rate: 0.1 };

export interface BusinessResult {
  /** Net present value of each path (operating cash minus the fleet's fixed costs), sorted. */
  npvs: number[];
  mean: number;
  p5: number;
  stdev: number;
  probLoss: number;
  /** Mean minus half a standard deviation: the course's risk-adjusted score. */
  riskAdjusted: number;
  /** Median profit per quarter. */
  quarterMedian: number[];
}

/**
 * Many three-year paths of the business. Each quarter is run as a representative weekday and weekend
 * day (scaled to the quarter's 65 and 26) with demand grown along the path, customers' willingness to pay cut once the next generation
 * arrives, and capacity reduced by failures.
 */
export function simulateBusiness(customers: Customer[], book: PriceBook, f: FleetDesign, ops: OpsPlan, w: WorldScenario = WORLD_DEFAULT): BusinessResult {
  const r = rng(w.seed ?? 41);
  const npvs: number[] = [];
  const byQuarter: number[][] = Array.from({ length: w.quarters }, () => []);
  const qRate = (1 + w.rate) ** 0.25;
  const ctx = prepare(customers, book, f);
  for (let path = 0; path < w.paths; path++) {
    const scale = customers.map(() => 1);
    const arrival = w.nextGenQuarter + Math.round((r() * 2 - 1) * w.nextGenSpread);
    let npv = 0;
    for (let q = 0; q < w.quarters; q++) {
      if (q > 0) customers.forEach((c, i) => (scale[i] *= Math.exp(Math.log(1 + c.growth) - (w.growthSigma * w.growthSigma) / 2 + w.growthSigma * gaussian(r))));
      const valueScale = q >= arrival ? 1 - w.nextGenDrop : 1;
      const opts = { hours: 24, demandScale: scale, valueScale, capacityShare: 1 - w.failureShare, seed: 31 + q };
      // A quarter is 13 weeks: 65 weekdays like Monday and 26 weekend days like Saturday.
      const profit = 65 * operateWith(ctx, ops, opts).profit + 26 * operateWith(ctx, ops, { ...opts, startHour: 120 }).profit;
      byQuarter[q].push(profit);
      npv += profit / qRate ** (q + 1);
    }
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const stdev = Math.sqrt(npvs.reduce((s, x) => s + (x - mean) ** 2, 0) / npvs.length);
  return {
    npvs,
    mean,
    p5: npvs[Math.floor(0.05 * npvs.length)],
    stdev,
    probLoss: npvs.filter((x) => x < 0).length / npvs.length,
    riskAdjusted: mean - 0.5 * stdev,
    quarterMedian: byQuarter.map((xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]),
  };
}
