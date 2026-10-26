// The course's reference prices for an hour of each accelerator, all simulated. They sit above
// Lesson 4.5's production costs (an A-class hour costs about $1.55 to provide, $2.22 per hour
// actually used at 70% utilization) and in the range GPU clouds have charged for comparable parts,
// but they are teaching numbers, not quotes.

import type { GpuId } from './hardware';

export interface PriceSheet {
  /** Pay by the hour, no commitment, $ per GPU-hour. */
  onDemand: number;
  /** Committed for a year, paid every hour whether used or not, $ per GPU-hour. */
  reserved: number;
  /** Interruptible: spare capacity that can be taken back at short notice; average price, $ per GPU-hour. */
  spot: number;
}

export const PRICES: Record<GpuId, PriceSheet> = {
  L: { onDemand: 0.9, reserved: 0.6, spot: 0.35 },
  A: { onDemand: 2.4, reserved: 1.6, spot: 0.95 },
  B: { onDemand: 4.8, reserved: 3.2, spot: 1.9 },
};
