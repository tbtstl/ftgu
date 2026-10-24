// Three ways to sell the same GPU-hour. Reserved capacity is committed for a long term and paid
// for whether used or not; on-demand capacity is paid only when used but costs more; interruptible
// (spot) capacity is cheap because the provider can take it back. Seen from the buyer, the choice
// depends on how steady the need is; seen from the provider, on-demand's premium pays for the idle
// buffer it must keep, and spot sells whatever that buffer isn't using. Prices are simulated.

import { rng, gaussian } from '../../model/random';

export interface Prices {
  reserved: number;
  onDemand: number;
  spot: number;
}

// ---------------------------------------------------------------------------
// The buyer.

export interface BuyerCost {
  reservedCost: number;
  onDemandCost: number;
  total: number;
  /** GPU-hours actually needed. */
  usefulHours: number;
  /** Reserved GPU-hours paid for but not needed. */
  idleReserved: number;
  /** Average cost per GPU-hour actually needed. */
  perUsefulHour: number;
}

/** Cost of meeting an hourly need with `reserved` committed GPUs and on-demand for the rest. */
export function buyerCost(need: number[], reserved: number, p: Prices): BuyerCost {
  let reservedCost = 0;
  let onDemandCost = 0;
  let useful = 0;
  let idle = 0;
  for (const n of need) {
    reservedCost += reserved * p.reserved;
    onDemandCost += Math.max(0, n - reserved) * p.onDemand;
    useful += n;
    idle += Math.max(0, reserved - n);
  }
  const total = reservedCost + onDemandCost;
  return { reservedCost, onDemandCost, total, usefulHours: useful, idleReserved: idle, perUsefulHour: useful > 0 ? total / useful : 0 };
}

/**
 * The cheapest number of reserved GPUs. Each extra reserved GPU costs the reserved price every hour
 * and saves the on-demand price in the hours it's needed, so it pays while the share of hours the
 * need exceeds it is above reserved ÷ on-demand.
 */
export function bestReservation(need: number[], p: Prices): number {
  const sorted = [...need].sort((a, b) => b - a);
  const ratio = p.reserved / p.onDemand;
  // Highest level that the need exceeds in at least `ratio` of hours.
  const k = Math.ceil(ratio * sorted.length) - 1;
  return Math.max(0, Math.floor(sorted[Math.max(0, Math.min(sorted.length - 1, k))]));
}

/** Utilization of a reservation at which reserving costs the same as paying on demand. */
export function breakEvenUtilization(p: Prices): number {
  return p.reserved / p.onDemand;
}

/**
 * Effective price of an interruptible GPU-hour: work since the last checkpoint is lost at every
 * interruption, plus the time to restart. `interruptionsPerDay` on average.
 */
export function spotEffective(p: Prices, interruptionsPerDay: number, checkpointMinutes: number, restartMinutes: number) {
  const perHour = interruptionsPerDay / 24;
  const lostHoursPerInterruption = (checkpointMinutes / 2 + restartMinutes) / 60;
  const lostShare = Math.min(0.99, perHour * lostHoursPerInterruption);
  return { lostShare, perUsefulHour: p.spot / (1 - lostShare) };
}

// ---------------------------------------------------------------------------
// The provider.

export interface ProviderParams {
  fleet: number;
  /** GPUs sold on reserved contracts. */
  reserved: number;
  /** Average on-demand GPUs wanted. */
  onDemandMean: number;
  /** Daily swing of on-demand use, as a share of the mean. */
  onDemandSwing: number;
  /** Hour-to-hour randomness of on-demand use, as a share of the mean. */
  onDemandNoise: number;
  /** GPUs spot buyers would take at the spot price. */
  spotDemand: number;
  prices: Prices;
  /** Cost of one GPU for one hour, used or not ($, from Lesson 4.5). */
  costPerGpuHour: number;
  hours: number;
  seed?: number;
}

export interface ProviderResult {
  revenuePerHour: { reserved: number; onDemand: number; spot: number; total: number };
  costPerHour: number;
  marginPerHour: number;
  /** Share of fleet GPU-hours sold in any form. */
  soldShare: number;
  /** Share of fleet GPU-hours sold on demand or reserved (spot excluded). */
  firmShare: number;
  /** Share of on-demand GPU-hours wanted that the fleet had to turn away. */
  turnedAway: number;
  /** GPU-hours a spot customer lost per hour to reclaims, on average. */
  reclaimsPerHour: number;
  /** Hourly samples for charts. */
  series: Array<{ onDemand: number; served: number; spot: number }>;
}

export function providerEconomics(p: ProviderParams): ProviderResult {
  const r = rng(p.seed ?? 5);
  const buffer = Math.max(0, p.fleet - p.reserved);
  let rev = { reserved: 0, onDemand: 0, spot: 0 };
  let sold = 0;
  let firm = 0;
  let wanted = 0;
  let away = 0;
  let reclaims = 0;
  let prevSpot = 0;
  const series: ProviderResult['series'] = [];
  for (let h = 0; h < p.hours; h++) {
    const wave = 1 + p.onDemandSwing * Math.cos((2 * Math.PI * ((h % 24) - 15)) / 24);
    const want = Math.max(0, p.onDemandMean * wave * (1 + p.onDemandNoise * gaussian(r)));
    const served = Math.min(want, buffer);
    const spot = Math.min(p.spotDemand, buffer - served);
    reclaims += Math.max(0, prevSpot - spot);
    prevSpot = spot;
    rev = { reserved: rev.reserved + p.reserved * p.prices.reserved, onDemand: rev.onDemand + served * p.prices.onDemand, spot: rev.spot + spot * p.prices.spot };
    sold += p.reserved + served + spot;
    firm += p.reserved + served;
    wanted += want;
    away += want - served;
    series.push({ onDemand: want, served, spot });
  }
  const H = Math.max(1, p.hours);
  const total = (rev.reserved + rev.onDemand + rev.spot) / H;
  const costPerHour = p.fleet * p.costPerGpuHour;
  return {
    revenuePerHour: { reserved: rev.reserved / H, onDemand: rev.onDemand / H, spot: rev.spot / H, total },
    costPerHour,
    marginPerHour: total - costPerHour,
    soldShare: sold / (H * p.fleet),
    firmShare: firm / (H * p.fleet),
    turnedAway: wanted > 0 ? away / wanted : 0,
    reclaimsPerHour: reclaims / H,
    series,
  };
}
