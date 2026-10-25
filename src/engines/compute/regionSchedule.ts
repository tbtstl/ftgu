// A day of jobs at Tech Park, and a scheduler that decides which to send to Fernhill. Each job is
// judged with regionMove.ts: it must tolerate Fernhill's round trip, finish by its deadline after
// its data has been copied, and save more on GPU-hours than its egress fees cost. The jobs share one
// wide-area link, which copies one dataset at a time, so the scheduler sends the jobs that save the
// most per hour of link time first, and a job whose copy would start too late to meet its deadline
// stays home. Jobs, sizes and fees are simulated.

import { moveJob, type MoveJob, type MoveResult, type MoveRoute } from './regionMove';

export interface DayJob extends MoveJob {
  id: string;
  name: string;
}

/** The course's day of jobs at Tech Park (simulated). GPU-hours on A-class GPUs; data in TB. */
export const DAY_JOBS: DayJob[] = [
  { id: 'pretrain', name: 'Pretraining slice', gpuHours: 100_000, gpus: 512, dataInTB: 50, dataOutTB: 5, maxRttMs: Infinity, deadlineHours: 400 },
  { id: 'embed', name: 'Embedding an archive', gpuHours: 6_000, gpus: 300, dataInTB: 120, dataOutTB: 40, maxRttMs: Infinity, deadlineHours: 72 },
  { id: 'batch', name: 'Overnight summaries', gpuHours: 4_000, gpus: 500, dataInTB: 30, dataOutTB: 3, maxRttMs: Infinity, deadlineHours: 12 },
  { id: 'tune', name: 'Fine-tuning job', gpuHours: 1_100, gpus: 10, dataInTB: 0.3, dataOutTB: 0.12, maxRttMs: Infinity, deadlineHours: 120 },
  { id: 'eval', name: 'Evaluation sweep', gpuHours: 800, gpus: 64, dataInTB: 0.5, dataOutTB: 0.05, maxRttMs: Infinity, deadlineHours: 24 },
  { id: 'video', name: 'Transcribing a video library', gpuHours: 2_000, gpus: 200, dataInTB: 400, dataOutTB: 4, maxRttMs: Infinity, deadlineHours: 48 },
  { id: 'chat', name: 'Chat assistant', gpuHours: 14_400, gpus: 600, dataInTB: 0, dataOutTB: 0, maxRttMs: 30, deadlineHours: 24 },
  { id: 'code', name: 'Code completion', gpuHours: 3_600, gpus: 150, dataInTB: 0, dataOutTB: 0, maxRttMs: 20, deadlineHours: 24 },
];

export type Decision = 'move' | 'stay';

export interface ScheduledJob {
  job: DayJob;
  result: MoveResult;
  decision: Decision;
  /** Why it stays (or "saves …" when it moves). */
  why: 'too far from users' | 'misses its deadline' | 'costs more to move' | 'link busy' | 'moves';
  /** Hours from the start of the day at which its copy begins on the link (moved jobs only). */
  copyStart: number;
  /** Hours of link time its copies take. */
  linkHours: number;
}

export interface DaySchedule {
  rows: ScheduledJob[];
  /** Money saved by the jobs that move, $. */
  saving: number;
  moved: number;
  /** Hours of the day the link spends copying. */
  linkHours: number;
  /** What every job costs if nothing moves, $. */
  stayTotal: number;
}

/**
 * Decide the day. Candidates are the jobs that can move and would save money on their own. The
 * scheduler picks those with the most saving per hour of link time, within `linkDayHours` of link
 * time, then queues their copies least slack first and sends a job only if its data can arrive in
 * time to meet its deadline.
 */
export function scheduleDay(jobs: DayJob[], route: MoveRoute, linkDayHours = 24): DaySchedule {
  const evaluated = jobs.map((job) => ({ job, result: moveJob(job, route) }));
  const rows = new Map<string, ScheduledJob>();
  const candidates: typeof evaluated = [];
  for (const e of evaluated) {
    const lh = e.result.transferH;
    if (!e.result.feasible) {
      rows.set(e.job.id, { ...e, decision: 'stay', why: e.result.reason?.includes('deadline') ? 'misses its deadline' : 'too far from users', copyStart: 0, linkHours: lh });
    } else if (e.result.saving <= 0) {
      rows.set(e.job.id, { ...e, decision: 'stay', why: 'costs more to move', copyStart: 0, linkHours: lh });
    } else candidates.push(e);
  }
  // 1. Choose: the most saving per hour of link time first, within the day's link time.
  candidates.sort((a, b) => b.result.saving / Math.max(1e-9, b.result.transferH) - a.result.saving / Math.max(1e-9, a.result.transferH));
  let budget = 0;
  let chosen: typeof candidates = [];
  for (const e of candidates) {
    if (budget + e.result.transferH <= linkDayHours + 1e-9) {
      chosen.push(e);
      budget += e.result.transferH;
    } else rows.set(e.job.id, { ...e, decision: 'stay', why: 'link busy', copyStart: 0, linkHours: e.result.transferH });
  }
  // 2. Queue the chosen copies least slack first (the time each can wait: its deadline less its run);
  //    a job whose data can't arrive in time stays, and the queue is rebuilt without it.
  const startTimes = new Map<string, number>();
  for (;;) {
    chosen.sort((a, b) => a.job.deadlineHours - a.result.runH - (b.job.deadlineHours - b.result.runH));
    let t = 0;
    let late: (typeof candidates)[number] | null = null;
    startTimes.clear();
    for (const e of chosen) {
      startTimes.set(e.job.id, t);
      if (t + e.result.transferH + e.result.runH > e.job.deadlineHours + 1e-9) {
        late = e;
        break;
      }
      t += e.result.transferH;
    }
    if (!late) break;
    rows.set(late.job.id, { ...late, decision: 'stay', why: 'misses its deadline', copyStart: 0, linkHours: late.result.transferH });
    chosen = chosen.filter((e) => e !== late);
  }
  let used = 0;
  let saving = 0;
  let moved = 0;
  for (const e of chosen) {
    rows.set(e.job.id, { ...e, decision: 'move', why: 'moves', copyStart: startTimes.get(e.job.id) ?? 0, linkHours: e.result.transferH });
    used += e.result.transferH;
    saving += e.result.saving;
    moved++;
  }
  const stayTotal = evaluated.reduce((s, e) => s + e.result.stayCost, 0);
  return { rows: jobs.map((j) => rows.get(j.id)!), saving, moved, linkHours: used, stayTotal };
}
