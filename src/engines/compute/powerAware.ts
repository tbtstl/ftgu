// Scheduling compute around the price of electricity. Tech Park buys power at the electricity
// course's hub price (its simulated real-time history) plus delivery charges. A GPU's power is only a
// few percent of what its hour costs (Lesson 4.5), so pausing work to dodge expensive power rarely
// pays — but capping power, which costs less speed than it saves power (Lesson 1.5), pays more
// often, and work that can wait for cheaper hours pays most. This engine plans and backtests that.
// A power cap limits the GPU itself; its share of the server's CPUs, memory and network cards (and
// the fans that cool them all) keeps drawing what it did, so a cap saves less than its own share.

import { standardHistory, type MarketDay } from '../../model/history';
import { ACCELERATORS, SERVERS, serverPowerW, type GpuId } from '../../model/compute/hardware';
import { speedAtPowerShare } from './cooling';
import { IDLE_POWER_SHARE } from './facilityCost';

/** Delivery charges added to the hub price at Tech Park, $/MWh (simulated). */
export const DELIVERY = 12;
/** PUE of the Tech Park hall (air-cooled, Lesson 4.3), rounded. */
export const TECH_PARK_PUE = 1.27;

/** Tech Park's hourly price for each day of the electricity course's 120-day history, $/MWh. */
export function techParkPrices(days: MarketDay[] = standardHistory()): number[][] {
  return days.map((d) => d.rt.map((p) => p + DELIVERY));
}

/** Grid power of one busy GPU at full speed, kW (its server share, through PUE). */
export function gpuGridKW(g: GpuId = 'A'): number {
  return (serverPowerW(g, 'air') / 8000) * TECH_PARK_PUE;
}

/** Share of a busy GPU's grid draw that is the GPU itself; the rest is its share of the server's other electronics. */
export function gpuDieShare(g: GpuId = 'A'): number {
  const s = SERVERS[g];
  const gpuW = s.gpus * ACCELERATORS[g].tdpW;
  return gpuW / (gpuW + s.cpuW + s.memW + s.netW);
}

/** Share of its full grid draw a busy GPU draws when the GPU itself is capped to `capShare` of its power. */
export function drawAtCap(capShare: number, g: GpuId = 'A'): number {
  const d = gpuDieShare(g);
  return d * capShare + (1 - d);
}

export type Mode = 'full' | 'capped' | 'paused';

export interface PowerPolicy {
  /** Value of an hour of the work at full speed, $ per GPU-hour. */
  value: number;
  /** The GPU's power cap, as a share of its rated power (0.5–1). */
  capShare: number;
  /** Cap power whenever the price is above this, $/MWh. */
  capAbove: number;
  /** Pause whenever the price is above this, $/MWh. */
  pauseAbove: number;
}

/** What one GPU-hour does at a price under a mode: work value and energy cost, $. */
export function hourOutcome(price: number, mode: Mode, p: PowerPolicy, g: GpuId = 'A') {
  const kw = gpuGridKW(g);
  // A paused GPU still idles at 30% of full power; a capped one holds the GPU at the cap while the
  // rest of its server share draws what it did.
  const powerShare = mode === 'paused' ? IDLE_POWER_SHARE : mode === 'capped' ? drawAtCap(p.capShare, g) : 1;
  const speed = mode === 'paused' ? 0 : mode === 'capped' ? speedAtPowerShare(p.capShare) : 1;
  const energyCost = (kw * powerShare * price) / 1000;
  const work = speed * p.value;
  return { energyCost, work, net: work - energyCost, speed, powerShare };
}

/** The mode the policy picks at a price. */
export function modeAt(price: number, p: PowerPolicy): Mode {
  if (price > p.pauseAbove) return 'paused';
  if (price > p.capAbove) return 'capped';
  return 'full';
}

/** Prices above which capping, then pausing, beat running flat out (for work that can't be made up later). */
export function breakEvenPrices(p: PowerPolicy, g: GpuId = 'A') {
  const kw = gpuGridKW(g);
  const lostWork = (1 - speedAtPowerShare(p.capShare)) * p.value;
  const savedKW = kw * (1 - drawAtCap(p.capShare, g));
  const cap = savedKW > 0 ? (lostWork / savedKW) * 1000 : Infinity;
  const pause = (p.value / (kw * (1 - IDLE_POWER_SHARE))) * 1000;
  return { cap, pause };
}

export interface Backtest {
  /** Net value (work − energy) per GPU over the history, running flat out always. */
  flatNet: number;
  /** Net value under the policy. */
  policyNet: number;
  gain: number;
  energyFlat: number;
  energyPolicy: number;
  hoursCapped: number;
  hoursPaused: number;
}

/** Run a policy over the whole history for one GPU whose work can't be made up later (lost if not done). */
export function backtest(p: PowerPolicy, prices: number[][] = techParkPrices(), g: GpuId = 'A'): Backtest {
  let flatNet = 0;
  let policyNet = 0;
  let energyFlat = 0;
  let energyPolicy = 0;
  let capped = 0;
  let paused = 0;
  for (const day of prices)
    for (const price of day) {
      const flat = hourOutcome(price, 'full', p, g);
      const mode = modeAt(price, p);
      const out = hourOutcome(price, mode, p, g);
      flatNet += flat.net;
      policyNet += out.net;
      energyFlat += flat.energyCost;
      energyPolicy += out.energyCost;
      if (mode === 'capped') capped++;
      if (mode === 'paused') paused++;
    }
  return { flatNet, policyNet, gain: policyNet - flatNet, energyFlat, energyPolicy, hoursCapped: capped, hoursPaused: paused };
}

/**
 * Deferrable work: a job of `gpuHours` per GPU that must finish within a window of hours, run at full
 * speed in the cheapest hours of the window. Returns the energy cost against running at once.
 */
export function shiftWork(prices: number[], hoursNeeded: number, g: GpuId = 'A') {
  const kw = gpuGridKW(g);
  const n = Math.max(0, Math.min(prices.length, Math.round(hoursNeeded)));
  const asap = prices.slice(0, n).reduce((s, x) => s + x, 0);
  const sorted = prices
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x - b.x)
    .slice(0, n);
  const cheap = sorted.reduce((s, o) => s + o.x, 0);
  // Idle hours still draw idle power at whatever price they fall in.
  const idleAsap = prices.slice(n).reduce((s, x) => s + x, 0);
  const chosen = new Set(sorted.map((o) => o.i));
  const idleCheap = prices.reduce((s, x, i) => s + (chosen.has(i) ? 0 : x), 0);
  const cost = (run: number, idle: number) => (kw * (run + IDLE_POWER_SHARE * idle)) / 1000;
  return { asapCost: cost(asap, idleAsap), shiftedCost: cost(cheap, idleCheap), hours: sorted.map((o) => o.i).sort((a, b) => a - b) };
}

/**
 * Fitting more GPUs under a fixed grid connection by capping each one's power. Capped at a share of
 * its rated power, a GPU keeps more than that share of its speed (Lesson 1.5), so a site whose
 * megawatts are the limit (Lesson 4.2) does more work by installing more GPUs and running each one
 * capped. The cap applies to the GPU alone; the rest of each server draws what it did.
 */
export function powerCapPlan(gridMW: number, capShare: number, g: GpuId = 'A') {
  const kw = gpuGridKW(g) * drawAtCap(capShare, g);
  const gpus = Math.floor((gridMW * 1000) / kw);
  const speed = speedAtPowerShare(capShare);
  return { gpus, speed, work: gpus * speed, kwPerGpu: kw };
}
