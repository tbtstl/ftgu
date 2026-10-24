// Queues at ports and canals: ships arrive at random, wait at anchor for a free berth (or a
// transit slot), are served, and leave. A seeded discrete-event simulation shows one realization;
// the Erlang C formula gives the long-run average wait for random arrivals and service times.

import { rng } from '../../model/random';

export interface QueueParams {
  /** Berths (servers). */
  berths: number;
  /** Average arrivals per day (Poisson). */
  arrivalsPerDay: number;
  /** Average days a ship occupies a berth. */
  serviceDays: number;
  /** Variability of service times: 0 = all the same, 1 = as random as arrivals. */
  serviceCv: number;
  /** Simulated days. */
  days: number;
  seed: number;
}

export interface QueuedShip {
  arrive: number;
  start: number;
  end: number;
  berth: number;
  wait: number;
}

export interface QueueResult {
  ships: QueuedShip[];
  /** Average wait at anchor, days (ships arriving after the first tenth of the run). */
  avgWait: number;
  maxWait: number;
  /** Ships at anchor, sampled each day. */
  queue: number[];
  avgQueue: number;
  maxQueue: number;
  /** Share of berth time in use. */
  utilization: number;
}

/** Exponential with mean m. */
function expo(r: () => number, m: number): number {
  return -m * Math.log(1 - r());
}

/** Gamma-like service time with mean m and coefficient of variation cv (Erlang with k = 1/cv²). */
function service(r: () => number, m: number, cv: number): number {
  if (cv <= 0.01) return m;
  const k = Math.max(1, Math.round(1 / (cv * cv)));
  let s = 0;
  for (let i = 0; i < k; i++) s += expo(r, m / k);
  return s;
}

/** First-come, first-served queue with `berths` servers. */
export function simulateQueue(p: QueueParams): QueueResult {
  const r = rng(p.seed);
  const free = Array<number>(Math.max(1, Math.round(p.berths))).fill(0);
  const ships: QueuedShip[] = [];
  let t = expo(r, 1 / p.arrivalsPerDay);
  while (t < p.days) {
    let b = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[b]) b = i;
    const start = Math.max(t, free[b]);
    const end = start + service(r, p.serviceDays, p.serviceCv);
    free[b] = end;
    ships.push({ arrive: t, start, end, berth: b, wait: start - t });
    t += expo(r, 1 / p.arrivalsPerDay);
  }
  const queue = Array.from({ length: Math.floor(p.days) }, (_, d) => ships.filter((s) => s.arrive <= d && s.start > d).length);
  const warm = p.days * 0.1;
  const counted = ships.filter((s) => s.arrive >= warm);
  const avgWait = counted.length ? counted.reduce((a, s) => a + s.wait, 0) / counted.length : 0;
  const busy = ships.reduce((a, s) => a + Math.max(0, Math.min(s.end, p.days) - s.start), 0);
  return {
    ships,
    avgWait,
    maxWait: ships.reduce((a, s) => Math.max(a, s.wait), 0),
    queue,
    avgQueue: queue.length ? queue.slice(Math.floor(warm)).reduce((a, b) => a + b, 0) / Math.max(1, queue.length - Math.floor(warm)) : 0,
    maxQueue: queue.reduce((a, b) => Math.max(a, b), 0),
    utilization: busy / (free.length * p.days),
  };
}

/** Erlang C: probability an arrival has to wait, for c servers at offered load a = λ/μ. */
export function erlangC(c: number, a: number): number {
  if (a >= c) return 1;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < c; k++) {
    term *= a / k;
    sum += term;
  }
  const last = (term * a) / c;
  const top = last / (1 - a / c);
  return top / (sum + top);
}

/**
 * Average wait in the queue, days, for random arrivals: Erlang C for exponential service, scaled by
 * (1 + cv²)/2 for less variable service (the Allen–Cunneen approximation).
 */
export function expectedWait(berths: number, arrivalsPerDay: number, serviceDays: number, serviceCv = 1): number {
  const c = Math.max(1, Math.round(berths));
  const a = arrivalsPerDay * serviceDays;
  if (a >= c) return Infinity;
  const wq = (erlangC(c, a) * serviceDays) / (c - a);
  return wq * ((1 + serviceCv * serviceCv) / 2);
}

/** Berth utilization: offered load per berth. */
export function utilization(berths: number, arrivalsPerDay: number, serviceDays: number): number {
  return (arrivalsPerDay * serviceDays) / Math.max(1, Math.round(berths));
}
