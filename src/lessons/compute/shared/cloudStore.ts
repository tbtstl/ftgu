// The reader's GPU cloud: one design that chapter 7 builds up lesson by lesson and keeps in the
// browser. 7.1 owns the fleet, 7.2 the customers, 7.3 the price book, 7.4 the operating plan, and
// 7.5 keeps a list of tried strategies. Each lesson can reset its own part. Storage can be
// unavailable (private windows, blocked site data), so every access is guarded and the design then
// lasts for the visit only.

import { useSyncExternalStore } from 'react';
import { GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITE_IDS, type SiteId } from '../../../model/compute/sites';
import { WORKLOAD_IDS, type WorkloadId } from '../../../model/compute/workloads';
import {
  CUSTOMERS_DEFAULT,
  FLEET_DEFAULT,
  OPS_DEFAULT,
  PRICEBOOK_DEFAULT,
  type Customer,
  type FleetDesign,
  type OpsPlan,
  type PriceBook,
  type Tier,
} from '../../../engines/compute/cloud';

export interface CloudDesign {
  v: 1;
  fleet: FleetDesign;
  customers: Customer[];
  prices: PriceBook;
  ops: OpsPlan;
}

export type CloudPart = 'fleet' | 'customers' | 'prices' | 'ops';

/** Which lesson owns which part of the design. */
export const PART_OF_LESSON: Record<'7.1' | '7.2' | '7.3' | '7.4', CloudPart> = { '7.1': 'fleet', '7.2': 'customers', '7.3': 'prices', '7.4': 'ops' };

export function defaultCloud(): CloudDesign {
  return {
    v: 1,
    fleet: { ...FLEET_DEFAULT, gpus: { ...FLEET_DEFAULT.gpus } },
    customers: CUSTOMERS_DEFAULT.map((c) => ({ ...c })),
    prices: { reserved: { ...PRICEBOOK_DEFAULT.reserved }, onDemand: { ...PRICEBOOK_DEFAULT.onDemand }, spot: { ...PRICEBOOK_DEFAULT.spot } },
    ops: { ...OPS_DEFAULT, rented: { ...OPS_DEFAULT.rented } },
  };
}

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const TIERS: Tier[] = ['reserved', 'onDemand', 'spot'];

/** Repair a stored design: anything missing or out of range falls back to the default. */
export function sanitize(raw: unknown): CloudDesign {
  const d = defaultCloud();
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return d;
  const r = raw as Partial<CloudDesign>;
  const f = (r.fleet ?? {}) as Partial<FleetDesign>;
  const gpus = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) gpus[g] = Math.round(num(f.gpus?.[g], 0, 20000, d.fleet.gpus[g]));
  const fleet: FleetDesign = {
    site: SITE_IDS.includes(f.site as SiteId) ? (f.site as SiteId) : d.fleet.site,
    gpus,
    cooling: f.cooling === 'liquid' ? 'liquid' : f.cooling === 'air' ? 'air' : d.fleet.cooling,
    supplyC: num(f.supplyC, 10, 50, d.fleet.supplyC),
    feedKW: num(f.feedKW, 5, 200, d.fleet.feedKW),
    downPorts: Math.round(num(f.downPorts, 16, 63, d.fleet.downPorts)),
    redundancy: f.redundancy === 'N' || f.redundancy === 'N+1' || f.redundancy === '2N' ? f.redundancy : d.fleet.redundancy,
  };
  const customers = Array.isArray(r.customers)
    ? r.customers
        .filter((c) => c && typeof c.id === 'string' && WORKLOAD_IDS.includes(c.workload as WorkloadId))
        .slice(0, 12)
        .map((c) => ({
          id: c.id,
          name: typeof c.name === 'string' ? c.name.slice(0, 40) : c.id,
          workload: c.workload,
          size: num(c.size, 0, 20000, 100),
          swing: num(c.swing, 0, 1, 0),
          value: num(c.value, 0.1, 20, 2),
          maxRttMs: c.maxRttMs === null || c.maxRttMs === undefined ? Infinity : num(c.maxRttMs, 1, Infinity, Infinity),
          tier: TIERS.includes(c.tier) ? c.tier : 'onDemand',
          growth: num(c.growth, -0.5, 1, 0),
        }))
    : d.customers;
  const prices = {} as PriceBook;
  for (const t of TIERS) {
    prices[t] = {} as Record<GpuId, number>;
    for (const g of GPU_IDS) prices[t][g] = num(r.prices?.[t]?.[g], 0, 50, d.prices[t][g]);
  }
  const o = (r.ops ?? {}) as Partial<OpsPlan>;
  const rented = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) rented[g] = Math.round(num(o.rented?.[g], 0, 20000, 0));
  const ops: OpsPlan = { policy: o.policy === 'tiered' ? 'tiered' : 'first-come', rented, burst: o.burst === true };
  return { v: 1, fleet, customers, prices, ops };
}

// JSON can't hold Infinity: store it as null.
function toJson(d: CloudDesign): string {
  return JSON.stringify(d, (_, v) => (v === Infinity ? null : v));
}

const KEY = 'groundup.compute.cloud.v1';
let cache: CloudDesign | null = null;
const listeners = new Set<() => void>();

function read(): CloudDesign {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : defaultCloud();
  } catch {
    cache = defaultCloud();
  }
  return cache;
}

function write(d: CloudDesign) {
  cache = d;
  try {
    window.localStorage.setItem(KEY, toJson(d));
  } catch {
    // The design lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let serverDefault: CloudDesign | null = null;
function readServer(): CloudDesign {
  return (serverDefault ??= defaultCloud());
}

/** The reader's cloud, re-rendering whenever any lesson changes it. */
export function useCloud(): CloudDesign {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getCloud(): CloudDesign {
  return read();
}

/** Change the design (functional update). */
export function updateCloud(fn: (d: CloudDesign) => CloudDesign) {
  const next = fn(read());
  if (next !== read()) write(sanitize(JSON.parse(toJson(next))));
}

/** Put one part of the design back to its starting state. */
export function resetPart(part: CloudPart) {
  const d = defaultCloud();
  updateCloud((cur) => ({ ...cur, [part]: d[part] }));
}

/** Start the whole cloud over. */
export function resetCloud() {
  write(defaultCloud());
}

// ---------------------------------------------------------------------------
// The starting design and the reader's. Each lesson's text describes the starting design; its
// figures can show either that or the reader's own design. A lesson's own part is always the
// reader's (its controls edit it); the switch decides where the other parts come from.

export const CLOUD_PARTS: CloudPart[] = ['fleet', 'customers', 'prices', 'ops'];

/** Which design a figure shows: the starting one (with this lesson's own part) or the reader's. */
export type Basis = 'start' | 'yours';

/** Whether a part of the design differs from the starting design. */
export function partChanged(d: CloudDesign, part: CloudPart): boolean {
  const j = (x: unknown) => JSON.stringify(sanitize(JSON.parse(toJson({ ...defaultCloud(), [part]: x } as CloudDesign)))[part], (_, v) => (v === Infinity ? null : v));
  return j(d[part]) !== j(defaultCloud()[part]);
}

/** Whether every part but `own` is the starting design's (so both choices of the switch show the same). */
export function othersAtStart(d: CloudDesign, own: CloudPart | null): boolean {
  return CLOUD_PARTS.every((p) => p === own || !partChanged(d, p));
}

/** The design a lesson's figures show: its own part always the reader's, the rest from the basis. */
export function designFor(d: CloudDesign, own: CloudPart | null, basis: Basis): CloudDesign {
  if (basis === 'yours') return d;
  const start = defaultCloud();
  return own ? { ...start, [own]: d[own] } : start;
}

/** Ask the reader before something that can't be undone; true where no dialog is available. */
export function confirmed(message: string): boolean {
  try {
    return typeof window === 'undefined' || typeof window.confirm !== 'function' ? true : window.confirm(message) === true;
  } catch {
    return true;
  }
}

const PART_PHRASE: Record<CloudPart, string> = {
  fleet: 'fleet (Lesson 7.1)',
  customers: 'customers (Lesson 7.2)',
  prices: 'price book (Lesson 7.3)',
  ops: 'operating plan (Lesson 7.4)',
};

/**
 * A figure's Reset for the lesson that owns `part`: if the reader has changed that part, it asks first
 * (the later lessons use it), and it touches no other part. Returns whether the part is now the
 * starting one, so a figure resets its own view settings only when the reset went ahead.
 */
export function confirmResetPart(part: CloudPart): boolean {
  if (!partChanged(read(), part)) return true;
  if (!confirmed(`Put your ${PART_PHRASE[part]} back to the starting design? The other parts of your cloud stay as they are.`)) return false;
  resetPart(part);
  return true;
}

/** Replace the whole design (all four parts) with another, after asking if anything would change. */
export function confirmReplaceCloud(next: CloudDesign, what: string): boolean {
  if (toJson(read()) === toJson(next)) return true;
  if (!confirmed(`Replace your whole cloud — fleet, customers, prices and operating plan — with ${what}?`)) return false;
  updateCloud(() => next);
  return true;
}

// ---------------------------------------------------------------------------
// 7.5's tried strategies.

export interface Attempt {
  id: string;
  name: string;
  at: number;
  design: CloudDesign;
  /** The risk-adjusted value and the numbers behind it, $. */
  riskAdjusted: number;
  mean: number;
  p5: number;
  probLoss: number;
}

const AKEY = 'groundup.compute.attempts.v1';
let acache: Attempt[] | null = null;
const alisteners = new Set<() => void>();

function aread(): Attempt[] {
  if (acache) return acache;
  try {
    const raw = window.localStorage.getItem(AKEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    acache = Array.isArray(parsed)
      ? parsed
          .filter((a) => a && typeof a.id === 'string')
          .slice(-10)
          .map((a) => ({ ...a, design: sanitize(a.design), riskAdjusted: num(a.riskAdjusted, -1e12, 1e12, 0), mean: num(a.mean, -1e12, 1e12, 0), p5: num(a.p5, -1e12, 1e12, 0), probLoss: num(a.probLoss, 0, 1, 0) }))
      : [];
  } catch {
    acache = [];
  }
  return acache;
}

function awrite(list: Attempt[]) {
  acache = list;
  try {
    window.localStorage.setItem(AKEY, JSON.stringify(list, (_, v) => (v === Infinity ? null : v)));
  } catch {
    // Kept for this visit only.
  }
  alisteners.forEach((l) => l());
}

const EMPTY: Attempt[] = [];
export function useAttempts(): Attempt[] {
  return useSyncExternalStore(
    (l) => {
      alisteners.add(l);
      return () => alisteners.delete(l);
    },
    aread,
    () => EMPTY,
  );
}

export function saveAttempt(a: Omit<Attempt, 'id' | 'name' | 'at'>): Attempt {
  const list = aread();
  const n = list.length ? Math.max(...list.map((x) => Number(/\d+$/.exec(x.name)?.[0] ?? 0))) + 1 : 1;
  const att: Attempt = { ...a, id: `a${Date.now()}-${n}`, name: `Strategy ${n}`, at: Date.now() };
  awrite([...list, att].slice(-10));
  return att;
}

export function clearAttempts() {
  awrite([]);
}
