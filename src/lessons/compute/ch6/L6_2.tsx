import { useId, useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { PROCUREMENT_DEFAULTS, WEEK_SHAPE, procure, type ProcurementParams, type ProcurementResult } from '../../../engines/compute/procurement';
import { procurementSweep, type SweepPoint } from '../../../engines/compute/procurementSweep';
import { growthFan } from '../../../engines/compute/demand';
import { RESTART_MINUTES, spotJobOf, spotRun, type SpotJob, type SpotRun } from '../../../engines/compute/spotCheckpoint';
import { PRICES } from '../../../model/compute/prices';

// ---------------------------------------------------------------------------
// Prices (simulated) and the colors Lesson 5.4 gave the three products.

const PRICE = PRICES.A;
const COLOR = { reserved: '#5f7488', onDemand: GRAPHIC.gold, spot: GRAPHIC.teal, idle: GRAPHIC.red };
const dollars = (x: number) => usd(x, 2);
const share = (x: number) => `${fmt(x * 100)}%`;
/** "$6.31 million". */
export function millions(x: number, digits = 2): string {
  return `$${fmt(x / 1e6, digits)} million`;
}

const X0 = 64;
const X1 = 616;

// ---------------------------------------------------------------------------
// Figure 1: a year of firm need, bought reserved and on demand, plus interruptible work on spot.

export interface PlanState {
  /** GPUs reserved for the year. */
  reserved: number;
  /** Average growth of the busiest hour's need, percent a month. */
  growth: number;
  /** Uncertainty of each month's growth, percent. */
  sigma: number;
}

export const PLAN_DEFAULTS: PlanState = { reserved: 0, growth: PROCUREMENT_DEFAULTS.growth * 100, sigma: PROCUREMENT_DEFAULTS.sigma * 100 };
export const RESERVE_MAX = 800;
export const RESERVE_STEP = 10;
export const LEVELS: number[] = Array.from({ length: RESERVE_MAX / RESERVE_STEP + 1 }, (_, i) => i * RESERVE_STEP);

export function paramsOf(s: PlanState): ProcurementParams {
  return { ...PROCUREMENT_DEFAULTS, reserved: s.reserved, growth: s.growth / 100, sigma: s.sigma / 100 };
}

const planCache = new Map<string, ProcurementResult>();
/** One plan's simulated years (memoized: the reservation slider revisits the same levels). */
export function planOf(s: PlanState): ProcurementResult {
  const key = `${s.reserved}|${s.growth}|${s.sigma}`;
  let r = planCache.get(key);
  if (!r) {
    r = procure(paramsOf(s));
    if (planCache.size > 400) planCache.clear();
    planCache.set(key, r);
  }
  return r;
}

const sweepCache = new Map<string, SweepPoint[]>();
/** Mean and bad-year cost of every reservation level, for a forecast. */
export function sweepOf(growth: number, sigma: number): SweepPoint[] {
  const key = `${growth}|${sigma}`;
  let r = sweepCache.get(key);
  if (!r) {
    r = procurementSweep(paramsOf({ reserved: 0, growth, sigma }), LEVELS);
    if (sweepCache.size > 200) sweepCache.clear();
    sweepCache.set(key, r);
  }
  return r;
}

/** The levels with the lowest mean and the lowest 95th-percentile cost. */
export function bestOf(growth: number, sigma: number) {
  const pts = sweepOf(growth, sigma);
  const mean = pts.reduce((a, b) => (b.mean < a.mean ? b : a));
  const p95 = pts.reduce((a, b) => (b.p95 < a.p95 ? b : a));
  return { mean, p95 };
}

/** The bottom of the bad-year curve is flat: within this share of the lowest counts. */
export const BAD_YEAR_TOLERANCE = 0.001;

/** Challenge a: with the starting forecast, the reservation that makes a bad year (the 95th percentile) cheapest. */
export function badYearSolved(s: PlanState): boolean {
  if (s.growth !== PLAN_DEFAULTS.growth || s.sigma !== PLAN_DEFAULTS.sigma) return false;
  return planOf(s).p95 <= bestOf(s.growth, s.sigma).p95.p95 * (1 + BAD_YEAR_TOLERANCE);
}

const MONTHS = PROCUREMENT_DEFAULTS.months;
const SHAPE_MEAN = WEEK_SHAPE.reduce((a, b) => a + b, 0) / WEEK_SHAPE.length;

function NeedFan({ s }: { s: PlanState }) {
  const fan = growthFan(PROCUREMENT_DEFAULTS.peakNow, MONTHS - 1, s.growth / 100, s.sigma / 100, Math.max(1, s.reserved));
  const top = 40;
  const bot = 186;
  const hi = Math.max(...fan.map((f) => f.p95), s.reserved, 100);
  const [, yMax] = niceDomain(0, hi, 4);
  const sx = scale(0, MONTHS - 1, X0 + 8, X1 - 8);
  const sy = scale(0, yMax, bot, top);
  const xs = fan.map((f) => sx(f.month));
  const avg = fan.map((f) => f.p50 * SHAPE_MEAN);
  const last = fan[fan.length - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 220"
      role="img"
      aria-label={`The busiest hour’s need over the year: ${fmt(PROCUREMENT_DEFAULTS.peakNow)} A-class GPUs now, a median of ${fmt(last.p50)} in month ${MONTHS}, and a 90% range of ${fmt(last.p5)} to ${fmt(last.p95)}. ${fmt(s.reserved)} GPUs reserved.`}
    >
      <text className="ax" x={X0} y={12}>
        A-class GPUs needed at the busiest hour of each month
      </text>
      <GridY y={sy} ticks={niceTicks(0, yMax, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={areaPath(xs, fan.map((f) => sy(f.p95)), fan.map((f) => sy(f.p5)))} fill={tint(GRAPHIC.gray, 0.18)} />
      <path d={areaPath(xs, fan.map((f) => sy(f.p75)), fan.map((f) => sy(f.p25)))} fill={tint(GRAPHIC.gray, 0.32)} />
      <path d={linePath(xs, fan.map((f) => sy(f.p50)))} fill="none" stroke="#333" strokeWidth={2} />
      <path d={linePath(xs, avg.map(sy))} fill="none" stroke="#333" strokeWidth={1.3} strokeDasharray="5 4" />
      <text className="ax" x={sx(0) + 4} y={sy(avg[0]) + 15}>
        an average hour (median)
      </text>
      <text className="ax" x={sx(MONTHS - 1) - 4} y={sy(last.p95) - 6} textAnchor="end">
        busiest hour: 90% of years fall in the band
      </text>
      {s.reserved > 0 && (
        <g>
          <line x1={X0} x2={X1} y1={sy(s.reserved)} y2={sy(s.reserved)} stroke={COLOR.reserved} strokeWidth={2.5} />
          <text className="ax" x={X0 + 6} y={sy(s.reserved) - 6} style={{ fill: COLOR.reserved, fontWeight: 500 }}>
            reserved: {fmt(s.reserved)}
          </text>
        </g>
      )}
      {fan.map((f) => (
        <text key={f.month} className="ax ax-m" x={sx(f.month)} y={204}>
          {f.month + 1}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={218}>
        month of the year
      </text>
    </svg>
  );
}

function CostCurve({ s, plan }: { s: PlanState; plan: ProcurementResult }) {
  const clip = 'cc' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const pts = sweepOf(s.growth, s.sigma);
  const best = bestOf(s.growth, s.sigma);
  const top = 24;
  const bot = 168;
  // Show the region around the bottom of the curves: up to 1.6× the lowest bad year.
  const lo = Math.min(...pts.map((p) => p.mean));
  const hi = Math.min(Math.max(...pts.map((p) => p.p95)), best.p95.p95 * 1.6);
  const [y0, y1] = niceDomain(lo / 1e6 - 0.2, hi / 1e6, 4);
  const sx = scale(0, RESERVE_MAX, X0, X1);
  const sy = scale(y0, y1, bot, top);
  const xs = pts.map((p) => sx(p.reserved));
  const yv = (v: number) => sy(Math.min(y1 + 1, v / 1e6));
  const cur = { x: sx(s.reserved), mean: yv(plan.mean), p95: yv(plan.p95) };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 206"
      role="img"
      aria-label={`The year’s cost against GPUs reserved. Average: lowest at ${fmt(best.mean.reserved)} reserved, ${millions(best.mean.mean)}. Bad year (1 in 20): lowest at ${fmt(best.p95.reserved)}, ${millions(best.p95.p95)}. With ${fmt(s.reserved)} reserved: average ${millions(plan.mean)}, bad year ${millions(plan.p95)}.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={X0} y={top - 4} width={X1 - X0} height={bot - top + 4} />
        </clipPath>
      </defs>
      <text className="ax" x={X0} y={12}>
        Cost of the year, $ million
      </text>
      <GridY y={sy} ticks={niceTicks(y0, y1, 4)} x0={X0} x1={X1} format={(v) => fmt(v, Number.isInteger(v) ? 0 : 1)} />
      <g clipPath={`url(#${clip})`}>
        <path d={linePath(xs, pts.map((p) => yv(p.p95)))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="6 4" />
        <path d={linePath(xs, pts.map((p) => yv(p.mean)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
        <circle cx={sx(best.mean.reserved)} cy={yv(best.mean.mean)} r={4} fill="#fcfcfb" stroke={GRAPHIC.green} strokeWidth={2} />
        <circle cx={sx(best.p95.reserved)} cy={yv(best.p95.p95)} r={4} fill="#fcfcfb" stroke={GRAPHIC.red} strokeWidth={2} />
      </g>
      <text className="ax" x={sx(best.mean.reserved)} y={yv(best.mean.mean) + 16} textAnchor="middle" style={{ fill: TEXT.green }}>
        lowest average · {fmt(best.mean.reserved)}
      </text>
      <text className="ax" x={sx(best.p95.reserved) + 8} y={yv(best.p95.p95) - 8} style={{ fill: TEXT.red }}>
        lowest bad year · {fmt(best.p95.reserved)}
      </text>
      <line className="cur" x1={cur.x} x2={cur.x} y1={top} y2={bot} />
      {cur.p95 >= top && <circle cx={cur.x} cy={cur.p95} r={5} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={2} />}
      {cur.mean >= top && <circle cx={cur.x} cy={cur.mean} r={5.5} fill={GRAPHIC.green} stroke="#fcfcfb" strokeWidth={2} />}
      {[0, 200, 400, 600, 800].map((v) => (
        <text key={v} className="ax ax-m" x={sx(v)} y={186}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={204}>
        A-class GPUs reserved for the year
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: what spot capacity is worth to two kinds of interruptible work.

export type JobId = 'tune8' | 'train70';
export const JOBS: Record<JobId, SpotJob> = { tune8: spotJobOf('tune8'), train70: spotJobOf('train70') };
const JOB_LABEL: Record<JobId, string> = { tune8: 'Fine-tuning jobs', train70: 'A pretraining run' };

export interface SpotState {
  job: JobId;
  /** Reclaims per server per day. */
  reclaims: number;
  /** Minutes to get replacement servers running after a reclaim. */
  restart: number;
}

export const SPOT_DEFAULTS: SpotState = { job: 'tune8', reclaims: 2, restart: RESTART_MINUTES };
export const RECLAIM_MAX = 4;
export const RECLAIM_STEP = 0.05;
const INTERVAL_MAX = 240;

/** Spot at the cheapest checkpoint interval (whole minutes up to four hours), for a reclaim rate and restart time. */
export function bestSpot(job: SpotJob, reclaims: number, restart: number): SpotRun & { interval: number } {
  let best: SpotRun = spotRun(job, PRICE.spot, reclaims, 1, restart);
  let interval = 1;
  for (let m = 2; m <= INTERVAL_MAX; m++) {
    const r = spotRun(job, PRICE.spot, reclaims, m, restart);
    if (r.perUsefulHour < best.perUsefulHour - 1e-12) {
      best = r;
      interval = m;
    }
  }
  return { ...best, interval };
}

/** Whether spot, at its best interval, costs less per useful GPU-hour than reserving. */
export function spotBeatsReserved(job: SpotJob, reclaims: number, restart: number): boolean {
  return bestSpot(job, reclaims, restart).perUsefulHour < PRICE.reserved;
}

/** The reclaim rate at which spot and reserved cost the same per useful hour (bisection). */
export function crossoverReclaims(job: SpotJob, restart: number): number {
  let lo = 0;
  let hi = 40;
  if (!spotBeatsReserved(job, lo, restart)) return 0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (spotBeatsReserved(job, mid, restart)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Snap a slider value to its grid, so 0.75 is 0.75. */
const snap = (x: number) => Math.round(x / RECLAIM_STEP) * RECLAIM_STEP;

/** Challenge b: for the pretraining run at the starting restart time, the highest reclaim rate on the slider's grid at which spot still beats reserved. */
export function wideSolved(s: SpotState): boolean {
  if (s.job !== 'train70' || s.restart !== SPOT_DEFAULTS.restart) return false;
  const job = JOBS.train70;
  return spotBeatsReserved(job, snap(s.reclaims), s.restart) && !spotBeatsReserved(job, snap(s.reclaims + RECLAIM_STEP), s.restart);
}

export const WIDE_ANSWER = (() => {
  let best = 0;
  for (let r = 0; r <= RECLAIM_MAX + 1e-9; r += RECLAIM_STEP) if (spotBeatsReserved(JOBS.train70, snap(r), SPOT_DEFAULTS.restart)) best = snap(r);
  return best;
})();

function SpotCurve({ s }: { s: SpotState }) {
  const clip = 'sc' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const job = JOBS[s.job];
  const pts = useMemo(() => {
    const out: Array<{ r: number; c: number }> = [];
    for (let i = 0; i <= RECLAIM_MAX / RECLAIM_STEP; i++) {
      const r = snap(i * RECLAIM_STEP);
      out.push({ r, c: bestSpot(job, r, s.restart).perUsefulHour });
    }
    return out;
  }, [job, s.restart]);
  const cross = useMemo(() => crossoverReclaims(job, s.restart), [job, s.restart]);
  const top = 24;
  const bot = 172;
  const yMax = 4;
  const sx = scale(0, RECLAIM_MAX, X0, X1);
  const sy = scale(0, yMax, bot, top);
  const finite = pts.filter((p) => Number.isFinite(p.c));
  const run = bestSpot(job, s.reclaims, s.restart);
  const ok = Number.isFinite(run.perUsefulHour);
  const refs = [
    { v: PRICE.onDemand, label: `on demand ${dollars(PRICE.onDemand)}`, color: COLOR.onDemand },
    { v: PRICE.reserved, label: `reserved ${dollars(PRICE.reserved)}`, color: COLOR.reserved },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 210"
      role="img"
      aria-label={`${JOB_LABEL[s.job]} on spot A-class GPUs, ${fmt(s.reclaims, 2)} reclaims per server a day, ${fmt(s.restart)}-minute restarts: ${ok ? `${dollars(run.perUsefulHour)} per useful GPU-hour` : 'the work never gets anywhere'}. Spot beats the ${dollars(PRICE.reserved)} reserved price below ${cross > RECLAIM_MAX ? 'every rate shown' : `${fmt(cross, 2)} reclaims per server a day`}.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={X0} y={top - 2} width={X1 - X0} height={bot - top + 2} />
        </clipPath>
      </defs>
      <text className="ax" x={X0} y={12}>
        Price of one useful GPU-hour on spot, at the best checkpoint interval
      </text>
      <GridY y={sy} ticks={[0, 1, 2, 3, 4]} x0={X0} x1={X1} format={(v) => usd(v)} baseline={0} />
      {cross < RECLAIM_MAX && <rect x={sx(cross)} y={top} width={X1 - sx(cross)} height={bot - top} fill={tint(GRAPHIC.red, 0.12)} />}
      {refs.map((r) => (
        <g key={r.label}>
          <line x1={X0} x2={X1} y1={sy(r.v)} y2={sy(r.v)} stroke={r.color} strokeWidth={1.5} strokeDasharray="6 4" />
          <text className="ax ax-e" x={X1 - 4} y={sy(r.v) - 5} style={{ fill: '#555' }}>
            {r.label}
          </text>
        </g>
      ))}
      <g clipPath={`url(#${clip})`}>
        <path d={linePath(finite.map((p) => sx(p.r)), finite.map((p) => sy(Math.min(p.c, yMax * 1.3))))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
      {cross < RECLAIM_MAX && (
        <g>
          <line x1={sx(cross)} x2={sx(cross)} y1={top} y2={bot} stroke="#555" strokeDasharray="3 3" />
          <text className="ax" x={sx(cross) + 6} y={top + 12} style={{ fill: TEXT.red }}>
            reserved is cheaper past {fmt(cross, 2)} a day
          </text>
        </g>
      )}
      <line className="cur" x1={sx(s.reclaims)} x2={sx(s.reclaims)} y1={top} y2={bot} />
      <circle cx={sx(s.reclaims)} cy={ok ? sy(Math.min(run.perUsefulHour, yMax)) : top} r={5.5} fill={ok ? GRAPHIC.teal : TEXT.red} stroke="#fcfcfb" strokeWidth={2} />
      {(!ok || run.perUsefulHour > yMax) && (
        <text className="ax" x={sx(s.reclaims) + (sx(s.reclaims) > X1 - 140 ? -8 : 8)} y={top + 28} textAnchor={sx(s.reclaims) > X1 - 140 ? 'end' : 'start'} style={{ fill: TEXT.red }}>
          {ok ? `off the chart: ${dollars(run.perUsefulHour)}` : 'no useful hours at all'}
        </text>
      )}
      {[0, 1, 2, 3, 4].map((v) => (
        <text key={v} className="ax ax-m" x={sx(v)} y={190}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={208}>
        reclaims per server per day
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers for the prose.

const START = PLAN_DEFAULTS;
const BEST = bestOf(START.growth, START.sigma);
const ALL_OD = planOf({ ...START, reserved: 0 });
const AT_BEST_MEAN = planOf({ ...START, reserved: BEST.mean.reserved });
const AT_BEST_P95 = planOf({ ...START, reserved: BEST.p95.reserved });
const AT_500 = planOf({ ...START, reserved: 500 });
const AT_MAX = planOf({ ...START, reserved: RESERVE_MAX });
const CALM = bestOf(START.growth, 0);
const WILD = bestOf(START.growth, 12);
const HOURS_YEAR = 730 * MONTHS;
const INTERRUPTIBLE = PROCUREMENT_DEFAULTS.interruptible;
const N_SPOT_YEAR = INTERRUPTIBLE * HOURS_YEAR * PROCUREMENT_DEFAULTS.spotEffective;
const TUNE_START = bestSpot(JOBS.tune8, SPOT_DEFAULTS.reclaims, SPOT_DEFAULTS.restart);
const TRAIN_HALF = bestSpot(JOBS.train70, 0.5, SPOT_DEFAULTS.restart);
const TRAIN_ONE = bestSpot(JOBS.train70, 1, SPOT_DEFAULTS.restart);
const TRAIN_TWO = bestSpot(JOBS.train70, 2, SPOT_DEFAULTS.restart);

export const LESSON_NUMBERS = {
  peakNow: PROCUREMENT_DEFAULTS.peakNow,
  averageHourNow: PROCUREMENT_DEFAULTS.peakNow * SHAPE_MEAN,
  finalPeak: ALL_OD.finalPeak,
  spotYear: N_SPOT_YEAR,
  allOnDemandMean: ALL_OD.mean,
  allOnDemandP95: ALL_OD.p95,
  bestMeanReserved: BEST.mean.reserved,
  bestMeanMean: AT_BEST_MEAN.mean,
  bestMeanP95: AT_BEST_MEAN.p95,
  bestMeanIdle: AT_BEST_MEAN.idleShare,
  bestMeanPerHour: AT_BEST_MEAN.perUsefulHour,
  bestP95Reserved: BEST.p95.reserved,
  bestP95Mean: AT_BEST_P95.mean,
  bestP95P95: AT_BEST_P95.p95,
  bestP95Idle: AT_BEST_P95.idleShare,
  r500Mean: AT_500.mean,
  r500P95: AT_500.p95,
  maxCheapest: AT_MAX.costs[0],
  maxDearest: AT_MAX.costs[AT_MAX.costs.length - 1],
  calmBest: CALM.mean.reserved,
  calmBestP95: CALM.p95.reserved,
  wildBestMean: WILD.mean.reserved,
  wildBestP95: WILD.p95.reserved,
  tuneCost: TUNE_START.perUsefulHour,
  tuneInterval: TUNE_START.interval,
  tuneCross: crossoverReclaims(JOBS.tune8, SPOT_DEFAULTS.restart),
  trainServers: JOBS.train70.servers,
  trainGpus: JOBS.train70.gpus,
  tuneServers: JOBS.tune8.servers,
  tuneGpus: JOBS.tune8.gpus,
  trainHalf: TRAIN_HALF.perUsefulHour,
  trainOne: TRAIN_ONE.perUsefulHour,
  trainTwo: TRAIN_TWO.perUsefulHour,
  trainTwoUseful: TRAIN_TWO.usefulShare,
  trainFour: bestSpot(JOBS.train70, 4, SPOT_DEFAULTS.restart).perUsefulHour,
  trainCross: crossoverReclaims(JOBS.train70, SPOT_DEFAULTS.restart),
  trainHalfRestart2: bestSpot(JOBS.train70, 0.5, 2).perUsefulHour,
  trainHalfRestart20: bestSpot(JOBS.train70, 0.5, 20).perUsefulHour,
  trainHalfRestart30: bestSpot(JOBS.train70, 0.5, 30).perUsefulHour,
  reservedYear: INTERRUPTIBLE * HOURS_YEAR * PRICE.reserved,
  onDemandYear: INTERRUPTIBLE * HOURS_YEAR * PRICE.onDemand,
  tuneSpotYear: INTERRUPTIBLE * HOURS_YEAR * TUNE_START.perUsefulHour,
};

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('plan', PLAN_DEFAULTS);
  const ps = s1.state;
  const plan = planOf(ps);
  const solvedA = badYearSolved(ps);
  const startForecast = ps.growth === PLAN_DEFAULTS.growth && ps.sigma === PLAN_DEFAULTS.sigma;
  const statusA = !startForecast
    ? `Set the forecast back to ${fmt(PLAN_DEFAULTS.growth)}% growth a month, give or take ${fmt(PLAN_DEFAULTS.sigma)}%.`
    : `With ${fmt(ps.reserved)} reserved, a bad year costs ${millions(plan.p95)}. Can a different reservation make it cheaper?`;
  const reservedCost = ps.reserved * PRICE.reserved * HOURS_YEAR;
  const onDemandAvg = plan.mean - reservedCost - N_SPOT_YEAR;

  const s2 = useScenario('spot', SPOT_DEFAULTS);
  const sp = s2.state;
  const job = JOBS[sp.job];
  const run = useMemo(() => bestSpot(job, sp.reclaims, sp.restart), [job, sp.reclaims, sp.restart]);
  const ok = Number.isFinite(run.perUsefulHour);
  const solvedB = wideSolved(sp);
  const spotYear = ok ? INTERRUPTIBLE * HOURS_YEAR * run.perUsefulHour : Infinity;
  const statusB =
    sp.job !== 'train70'
      ? 'Choose the pretraining run.'
      : sp.restart !== SPOT_DEFAULTS.restart
        ? `Set the restart time back to ${fmt(SPOT_DEFAULTS.restart)} minutes.`
        : ok
          ? `At ${fmt(sp.reclaims, 2)} reclaims per server a day, a useful spot hour costs ${dollars(run.perUsefulHour)}, against ${dollars(PRICE.reserved)} reserved.`
          : `At ${fmt(sp.reclaims, 2)} reclaims per server a day, the run never gets anywhere on spot.`;

  const N = LESSON_NUMBERS;

  return (
    <LessonPage id="compute/6.2">
      <P>
        The previous lesson took the provider’s side: given a fleet, which work should each GPU do? This lesson takes the buyer’s. A company that runs models on rented
        capacity has to decide, months ahead, how much of it to commit to. It can’t wait and see. As <a href={lessonHref('compute/5.2')}>Lesson 5.2</a> showed, capacity
        arrives in quarters, and the reserved contracts of <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> are signed for a year at a time. Lesson 5.4 found the rule
        for a need known in advance: reserve up to the level the need exceeds in two-thirds of the hours. But next year’s need isn’t known. It grows, by an amount nobody
        can promise (<a href={lessonHref('compute/5.3')}>Lesson 5.3</a>).
      </P>
      <P>
        Here is the buyer. Its inference service needs {fmt(N.peakNow)} A-class 80 GB GPUs at its busiest hour today, with the daily and weekly shape of Lesson 5.3’s
        inference curve, so an average hour needs about {fmt(N.averageHourNow)}. That busiest hour is forecast to grow by {fmt(PLAN_DEFAULTS.growth)}% a month, give or take{' '}
        {fmt(PLAN_DEFAULTS.sigma)}% each month. The service can use <K tone="green">reserved</K> GPUs, committed for the whole year at a simulated{' '}
        {dollars(PRICE.reserved)} an hour whether busy or not, and <K tone="green">on-demand</K> GPUs at {dollars(PRICE.onDemand)} for whatever the reservation doesn’t
        cover. The company also has {fmt(INTERRUPTIBLE)} GPUs’ worth of fine-tuning work that can be interrupted; it runs on spot at an effective{' '}
        {dollars(PROCUREMENT_DEFAULTS.spotEffective)} per useful hour (Lesson 5.4), or {millions(N.spotYear)} for the year. To see what the uncertainty does, we simulate{' '}
        {fmt(PROCUREMENT_DEFAULTS.scenarios)} possible years.
      </P>
      <P>
        In the next demonstration, the upper chart is the forecast: the busiest hour of each month across the simulated years, with the band holding 90% of them, and the
        median of an average hour dashed. The lower chart is the cost of the year against the number of GPUs reserved: in green, the <K tone="green">average</K> over all
        the years, and in dashed red, a <K tone="red">bad year</K> — the cost that one simulated year in twenty reaches or exceeds. Set the reservation, and then the
        forecast:
      </P>

      <Figure name="Capacity Procurement Optimizer" scenario={s1}>
        <NeedFan s={ps} />
        <CostCurve s={ps} plan={plan} />
        <Legend
          items={[
            { label: 'average year', color: GRAPHIC.green, kind: 'line' },
            { label: 'bad year (1 in 20)', color: GRAPHIC.red, kind: 'line', dashed: true },
            { label: 'reserved GPUs', color: COLOR.reserved, kind: 'line' },
          ]}
        />
        <Slider label="Reserved GPUs" tone="green" value={ps.reserved} min={0} max={RESERVE_MAX} step={RESERVE_STEP} onChange={(v) => s1.set({ reserved: v })} display={`${fmt(ps.reserved)} GPUs`} />
        <Slider label="Growth a month" tone="ink" value={ps.growth} min={0} max={10} step={0.5} onChange={(v) => s1.set({ growth: v })} display={`${fmt(ps.growth, 1)}%`} />
        <Slider label="Uncertainty" tone="ink" value={ps.sigma} min={0} max={12} step={1} onChange={(v) => s1.set({ sigma: v })} display={`± ${fmt(ps.sigma)}% a month`} />
        <Readouts
          items={[
            { label: 'average year', value: millions(plan.mean), tone: 'green' },
            { label: 'bad year (1 in 20)', value: millions(plan.p95), tone: 'red' },
            { label: 'per useful GPU-hour', value: dollars(plan.perUsefulHour), tone: 'green' },
            { label: 'reserved hours idle', value: share(plan.idleShare) },
          ]}
        />
        <Eq label="Cost of an average year">
          <span>average year</span>
          <Op>=</Op>
          <span>{usd(reservedCost)} reserved</span>
          <Op>+</Op>
          <span>{usd(onDemandAvg)} on demand</span>
          <Op>+</Op>
          <span>{usd(N_SPOT_YEAR)} spot</span>
          <Op>=</Op>
          <K tone="green">{millions(plan.mean)}</K>
        </Eq>
      </Figure>

      <P>
        With nothing reserved, every firm hour is bought on demand: {millions(N.allOnDemandMean)} in an average year. Now reserve. The cost falls at first, because each
        reserved GPU near the bottom of the need is busy almost every hour and costs {dollars(PRICE.reserved)} instead of {dollars(PRICE.onDemand)}. It is lowest at{' '}
        {fmt(N.bestMeanReserved)} GPUs, {millions(N.bestMeanMean)}, and rises again past it. That is a surprisingly small reservation: about today’s average hour, well
        under today’s busiest hour of {fmt(N.peakNow)}, and far under the {fmt(N.finalPeak)} GPUs the busiest hour reaches by the twelfth month on average. It is still
        Lesson 5.4’s rule, applied to a whole uncertain year: one more reserved GPU pays only if, across the year’s hours, it would be busy more than two-thirds of the time.
        Today’s nights and weekends, and the early months before growth arrives, decide how few of them are.
      </P>
      <P>
        Reserving too much is worse than reserving too little. At 500 GPUs the average year costs {millions(N.r500Mean)}, more than buying everything on demand, and at{' '}
        {fmt(RESERVE_MAX)} every simulated year costs between {millions(N.maxCheapest)} and {millions(N.maxDearest)}: the reservation is paid for in every hour of every
        year, whatever the year brings.
      </P>

      <H2>Insuring against a fast year</H2>
      <P>
        An average is a fine thing to minimize for a company that will make the same bet many times. A company making it once also cares about the bad year. Look at{' '}
        <FigRef to="Capacity Procurement Optimizer">the dashed curve</FigRef>. With nothing reserved, a bad year — one in which the need grows fast, and every extra GPU
        is bought at {dollars(PRICE.onDemand)} — costs {millions(N.allOnDemandP95)}. At the reservation that minimizes the average, {fmt(N.bestMeanReserved)}, a bad year
        costs {millions(N.bestMeanP95)}. But the dashed curve bottoms out further right.
      </P>

      <Challenge
        id="a"
        question="With the forecast as it starts — 4% growth a month, give or take 5% — find the reservation that makes a bad year cheapest."
        solved={solvedA}
        status={statusA}
        success={`Solved. At ${fmt(N.bestP95Reserved)} reserved GPUs a bad year costs ${millions(N.bestP95P95)}, the least of any reservation, while the average year costs ${millions(N.bestP95Mean)}: ${usd(N.bestP95Mean - N.bestMeanMean)} more than at the cheapest-on-average ${fmt(N.bestMeanReserved)}. Those extra reserved GPUs are idle in the slow years, and pay for themselves in the fast ones.`}
      />

      <P>
        Reserving {fmt(N.bestP95Reserved)} GPUs rather than {fmt(N.bestMeanReserved)} is insurance. It costs {usd(N.bestP95Mean - N.bestMeanMean)} in an average year,
        and {share(N.bestP95Idle)} of the reserved hours sit idle instead of {share(N.bestMeanIdle)}, but it cuts the bad year by{' '}
        {usd(N.bestMeanP95 - N.bestP95P95)}. How much insurance is worth buying depends on how uncertain the forecast is. Set the uncertainty to zero and the two curves
        become one, lowest at {fmt(N.calmBest)} GPUs. Raise it to 12% a month and they pull apart: the average is lowest at {fmt(N.wildBestMean)}, a bad year at{' '}
        {fmt(N.wildBestP95)}. The more uncertain the year, the more a cautious buyer reserves — and the less a buyer who only cares about the average does. Faster growth
        moves both curves right, because the need rises above each reserved GPU for more of the year.
      </P>

      <H2>What spot is worth depends on the work</H2>
      <P>
        The plan so far took the spot price of the fine-tuning work as given. It isn’t a property of the market alone. As Lesson 5.4 found, an interruptible hour is worth
        what survives the interruptions, and that depends on the physics of the job: how many servers must all keep running (a synchronous training step, from{' '}
        <a href={lessonHref('compute/3.3')}>Lesson 3.3</a>), how large a checkpoint is and how fast it can be written, and how long a restart takes. The alternative is
        to put the same work on reserved GPUs, which at {fmt(INTERRUPTIBLE)} GPUs running around the clock costs {millions(N.reservedYear)} a year. In the next
        demonstration, choose the shape of the interruptible work — fine-tuning jobs of {fmt(N.tuneGpus)} GPUs on {fmt(N.tuneServers)} servers, or a pretraining run of{' '}
        {fmt(N.trainGpus)} GPUs on {fmt(N.trainServers)} servers — and set how often the provider reclaims each server and how long a restart takes. Each point checkpoints
        at its own best interval:
      </P>

      <Figure name="Capacity Procurement Optimizer · spot" scenario={s2}>
        <Segmented
          label="Interruptible work"
          value={sp.job}
          onChange={(v) => s2.set({ job: v })}
          options={[
            { value: 'tune8', label: `Fine-tuning jobs (${fmt(N.tuneGpus)} GPUs)` },
            { value: 'train70', label: `Pretraining run (${fmt(N.trainGpus)} GPUs)` },
          ]}
        />
        <SpotCurve s={sp} />
        <Slider label="Reclaims per server" tone="teal" value={sp.reclaims} min={0} max={RECLAIM_MAX} step={RECLAIM_STEP} onChange={(v) => s2.set({ reclaims: snap(v) })} display={`${fmt(sp.reclaims, 2)} a day`} />
        <Slider label="Restart time" tone="teal" value={sp.restart} min={2} max={30} onChange={(v) => s2.set({ restart: v })} display={`${fmt(sp.restart)} min`} />
        <Readouts
          items={[
            { label: 'whole job stopped', value: `${fmt(run.interruptionsPerDay, 1)} times a day` },
            { label: 'best checkpoint interval', value: ok ? `${fmt(run.interval)} min` : '—' },
            { label: 'paid hours that are useful', value: share(run.usefulShare) },
            { label: 'per useful GPU-hour', value: ok ? dollars(run.perUsefulHour) : 'never finishes', tone: ok && run.perUsefulHour < PRICE.reserved ? 'green' : 'red' },
            { label: `${fmt(INTERRUPTIBLE)} GPUs for a year on spot`, value: ok ? millions(spotYear) : '—', tone: 'green' },
            { label: '… or reserved', value: millions(N.reservedYear), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        For fine-tuning jobs, spot is almost always the right choice. A job on {fmt(N.tuneServers)} servers, reclaimed twice a day each, stops {fmt(N.tuneServers * 2)} times
        a day; checkpointing every {fmt(N.tuneInterval)} minutes, a useful hour costs {dollars(N.tuneCost)}, and the year’s work costs {millions(N.tuneSpotYear)} instead of{' '}
        {millions(N.reservedYear)} reserved. Reserved only wins past {fmt(N.tuneCross, 1)} reclaims per server a day — far more often than the provider of Lesson 5.4,
        which took each of its spot GPUs back about twice a day.
      </P>
      <P>
        Switch to the pretraining run and the picture changes. Its {fmt(N.trainServers)} servers all take part in every step, so each one’s reclaims stop all of them. At
        half a reclaim per server a day a useful hour costs {dollars(N.trainHalf)}, still under the reserved price; at one a day, {dollars(N.trainOne)}; at two,{' '}
        {dollars(N.trainTwo)}, with only {share(N.trainTwoUseful)} of the paid hours doing useful work; at four, the run is interrupted faster than it can recover and never
        gets anywhere.
      </P>

      <Challenge
        id="b"
        figure="Capacity Procurement Optimizer · spot"
        question="For the pretraining run, with 10-minute restarts, find the highest reclaim rate (in steps of 0.05 a day) at which its spot hours still cost less than reserving."
        solved={solvedB}
        status={statusB}
        success={`Solved. Up to ${fmt(WIDE_ANSWER, 2)} reclaims per server a day, spot is cheaper; the curves cross at ${fmt(N.trainCross, 2)}. Across ${fmt(N.trainServers)} servers that is about ${fmt(N.trainCross * N.trainServers)} interruptions of the whole run a day. The small fine-tuning jobs, on the same spot capacity, beat reserving until ${fmt(N.tuneCross, 1)} a day: the width of a synchronous job multiplies every reclaim.`}
      />

      <P>
        The restart time is just as physical. With half a reclaim per server a day, a two-minute restart makes the run’s useful spot hours cost{' '}
        {dollars(N.trainHalfRestart2)}; twenty minutes, {dollars(N.trainHalfRestart20)}, past the reserved price; thirty, {dollars(N.trainHalfRestart30)}. Faster
        replacement servers, smaller checkpoints, faster storage and smaller synchronous groups all move the crossing to the right, and each is a reason to engineer a
        training system for interruption before buying interruptible capacity for it.
      </P>

      <H2>A portfolio, built from physics</H2>
      <P>
        Put together, the buyer’s plan is a portfolio of three products, and every weight in it traces back to something physical. Reserved GPUs cover the floor of the
        firm need, and the floor is set by people’s days — the quiet nights and weekends of an inference service (<a href={lessonHref('compute/3.4')}>Lesson 3.4</a>).
        On-demand GPUs cover the afternoons, and the fast years the forecast can’t rule out. Spot covers work that survives interruption, and how much survives is set by the
        size of a synchronous job and its checkpoints. Change the physics and the plan changes: a flatter daily curve, say from a service used around the world, would
        justify reserving more, and a training system that can’t restart quickly makes spot worse than useless. The prices were simulated, but the shape of the decision is
        not.
      </P>
      <P>
        So far the buyer has taken one region’s prices as given. Lesson 5.5 found that the same A-class hour can cost far less in a distant region than near the users. In
        the next lesson, we move work between regions to chase those prices, and count what the move itself costs.
      </P>
    </LessonPage>
  );
}
