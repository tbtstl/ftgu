// Moving work to where GPU-hours are cheap. Lesson 5.5 found an A-class hour near the users selling
// for far more than the same hour in remote Northfield. Work that doesn't need to be near users can
// chase the cheaper hours — but its data must travel there over a wide-area link, which takes time and,
// at most clouds, costs a fee per gigabyte leaving a region (egress). Interactive work can't go at all
// if the round trip is too long. Prices and fees here are simulated.

import { SITES, type SiteId } from '../../model/compute/sites';

export interface MoveJob {
  /** GPU-hours the job needs. */
  gpuHours: number;
  /** GPUs it runs on at once. */
  gpus: number;
  /** Data that must be copied to the remote site before it starts, TB. */
  dataInTB: number;
  /** Results copied back, TB. */
  dataOutTB: number;
  /** Longest round trip to users it tolerates, ms (Infinity for batch work). */
  maxRttMs: number;
  /** Hours from now by which it must finish (Infinity: no deadline). */
  deadlineHours: number;
}

export interface MoveRoute {
  from: SiteId;
  to: SiteId;
  /** $ per GPU-hour at each end. */
  priceFrom: number;
  priceTo: number;
  /** Wide-area link usable for the copy, Gb/s. */
  linkGbps: number;
  /** Fee per GB leaving the origin, $. */
  egressPerGB: number;
}

/** Hours to copy `tb` terabytes over a `gbps` link (at 80% of its rate). */
export function transferHours(tb: number, gbps: number): number {
  if (tb <= 0) return 0;
  if (gbps <= 0) return Infinity;
  return (tb * 8000) / (gbps * 0.8) / 3600;
}

export interface MoveResult {
  feasible: boolean;
  reason?: string;
  /** What the job costs if it stays. */
  stayCost: number;
  /** GPU-hours at the remote price plus egress both ways. */
  moveCost: number;
  egressCost: number;
  /** Hours spent copying before and after. */
  transferH: number;
  /** Hours the job takes to run on its GPUs. */
  runH: number;
  /** stayCost − moveCost (positive: moving saves money). */
  saving: number;
}

export function moveJob(job: MoveJob, route: MoveRoute): MoveResult {
  const runH = job.gpuHours / Math.max(1, job.gpus);
  const transferH = transferHours(job.dataInTB, route.linkGbps) + transferHours(job.dataOutTB, route.linkGbps);
  const egressCost = (job.dataInTB + job.dataOutTB) * 1000 * route.egressPerGB;
  const stayCost = job.gpuHours * route.priceFrom;
  const moveCost = job.gpuHours * route.priceTo + egressCost;
  const base = { stayCost, moveCost, egressCost, transferH, runH, saving: stayCost - moveCost };
  if (SITES[route.to].rttMs > job.maxRttMs) return { ...base, feasible: false, reason: `${SITES[route.to].name} is ${SITES[route.to].rttMs} ms from the users; the job tolerates ${job.maxRttMs} ms.` };
  if (runH + transferH > job.deadlineHours) return { ...base, feasible: false, reason: 'Copying the data there and back would miss the deadline.' };
  return { ...base, feasible: true };
}

/** Data size (TB in, with results a fixed share of it) at which moving stops saving money. */
export function breakEvenDataTB(job: Omit<MoveJob, 'dataInTB' | 'dataOutTB'>, route: MoveRoute, outShare = 0.1): number {
  const perTB = (1 + outShare) * 1000 * route.egressPerGB;
  if (perTB <= 0) return Infinity;
  return Math.max(0, (job.gpuHours * (route.priceFrom - route.priceTo)) / perTB);
}

/** Data size at which the copy alone uses up the deadline's slack. */
export function deadlineDataTB(job: Omit<MoveJob, 'dataInTB' | 'dataOutTB'>, route: MoveRoute, outShare = 0.1): number {
  const slack = job.deadlineHours - job.gpuHours / Math.max(1, job.gpus);
  if (slack <= 0) return 0;
  if (!Number.isFinite(slack)) return Infinity;
  return (slack * 3600 * route.linkGbps * 0.8) / 8000 / (1 + outShare);
}
