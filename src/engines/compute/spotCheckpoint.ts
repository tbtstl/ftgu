// What an interruptible GPU-hour really costs a training job. The provider can reclaim any server
// at short notice; a synchronous training job (Lesson 3.3) stops whenever any one of its servers is
// taken, loses the work since its last checkpoint, and needs time to restart and reload. Saving
// checkpoints more often loses less work but spends more time writing them. This generalizes
// pricing.ts's spotEffective (one server, free checkpoints) to whole jobs. All rates are simulated.

import { MODELS, matmulParams } from '../../model/compute/models';
import type { WorkloadId } from '../../model/compute/workloads';
import { workloadFit } from './compatibility';
import { GPUS_PER_SERVER, STATE_BYTES } from './training';

/** Rate each GPU can write its share of a checkpoint to shared storage, GB/s (simulated). */
export const STORAGE_GBS_PER_GPU = 0.5;
/** Most the shared storage takes from one job, GB/s (simulated). */
export const STORAGE_GBS_PER_JOB = 20;
/** Minutes to get replacement servers running again after a reclaim, before reloading the checkpoint. */
export const RESTART_MINUTES = 10;

export interface SpotJob {
  id: WorkloadId;
  gpus: number;
  servers: number;
  /** Training state a checkpoint must save: 16 bytes per parameter (Lesson 3.3). */
  stateBytes: number;
}

/** A training workload sized on the A-class as in Lesson 3.5. */
export function spotJobOf(id: 'tune8' | 'train70'): SpotJob {
  const f = workloadFit(id, 'A');
  const model = id === 'tune8' ? MODELS['8B'] : MODELS['70B'];
  const gpus = f.gpus;
  return { id, gpus, servers: Math.ceil(gpus / GPUS_PER_SERVER), stateBytes: matmulParams(model) * (STATE_BYTES.replicated + STATE_BYTES.shardable) };
}

/** Minutes to write (or read back) one checkpoint. */
export function checkpointMinutes(job: SpotJob): number {
  const gbs = Math.min(job.gpus * STORAGE_GBS_PER_GPU, STORAGE_GBS_PER_JOB);
  return job.stateBytes / (gbs * 1e9) / 60;
}

export interface SpotRun {
  /** Times a day the whole job is stopped: every server's reclaims add up. */
  interruptionsPerDay: number;
  /** Minutes to write one checkpoint. */
  writeMinutes: number;
  /** Share of time spent redoing lost work, restarting and reloading. */
  lostShare: number;
  /** Share of time spent writing checkpoints. */
  writeShare: number;
  /** Share of paid GPU-hours that advance the job. */
  usefulShare: number;
  /** Price per useful GPU-hour, $ (Infinity if the job never gets anywhere). */
  perUsefulHour: number;
}

/**
 * Interruptible capacity for a job: each interruption loses, on average, half a checkpoint interval
 * of work, plus the restart and the time to read the checkpoint back; every interval also pays for
 * writing one checkpoint. With one server and free checkpoints this is pricing.ts's spotEffective.
 */
export function spotRun(job: SpotJob, spotPrice: number, reclaimsPerServerDay: number, intervalMinutes: number, restartMinutes = RESTART_MINUTES): SpotRun {
  const interruptionsPerDay = reclaimsPerServerDay * job.servers;
  const perMinute = interruptionsPerDay / 1440;
  const write = checkpointMinutes(job);
  const lostShare = perMinute * (intervalMinutes / 2 + restartMinutes + write);
  const writeShare = write / (intervalMinutes + write);
  const usefulShare = Math.max(0, 1 - lostShare - writeShare);
  return { interruptionsPerDay, writeMinutes: write, lostShare, writeShare, usefulShare, perUsefulHour: usefulShare > 0 ? spotPrice / usefulShare : Infinity };
}

/** The checkpoint interval (whole minutes from 1 to `max`) that makes useful hours cheapest. */
export function bestInterval(job: SpotJob, spotPrice: number, reclaimsPerServerDay: number, max = 240): number {
  let best = 1;
  let bestCost = Infinity;
  for (let m = 1; m <= max; m++) {
    const c = spotRun(job, spotPrice, reclaimsPerServerDay, m).perUsefulHour;
    if (c < bestCost - 1e-12) {
      best = m;
      bestCost = c;
    }
  }
  return best;
}
