import { useId, useMemo } from 'react';
import {
  Challenge,
  Eq,
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
import { Prediction } from './Prediction';

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
// Figure 1: a year of firm need, bought reserved and on demand. (The interruptible work, which costs
// the same whatever is reserved, is left to the last section.)

/** Challenge a's prediction: where the bad year is cheapest, against the 260 GPUs that minimize the average. */
export type SideGuess = 'left' | 'right';

export interface PlanState {
  /** GPUs reserved for the year. */
  reserved: number;
  /** Average growth of the busiest hour's need, percent a month. */
  growth: number;
  /** Uncertainty of each month's growth, percent. */
  sigma: number;
  /** Challenge a's prediction; the bad-year curve is drawn once it is made. */
  guess: SideGuess | '';
}

export const PLAN_DEFAULTS: PlanState = { reserved: 0, growth: PROCUREMENT_DEFAULTS.growth * 100, sigma: PROCUREMENT_DEFAULTS.sigma * 100, guess: '' };
export const RESERVE_MAX = 800;
export const RESERVE_STEP = 10;
export const LEVELS: number[] = Array.from({ length: RESERVE_MAX / RESERVE_STEP + 1 }, (_, i) => i * RESERVE_STEP);

/** The plan's parameters: firm need only, so every cost is what the reservation decides. */
export function paramsOf(s: Pick<PlanState, 'reserved' | 'growth' | 'sigma'>): ProcurementParams {
  return { ...PROCUREMENT_DEFAULTS, interruptible: 0, reserved: s.reserved, growth: s.growth / 100, sigma: s.sigma / 100 };
}

const planCache = new Map<string, ProcurementResult>();
/** One plan's simulated years (memoized: the reservation slider revisits the same levels). */
export function planOf(s: Pick<PlanState, 'reserved' | 'growth' | 'sigma'>): ProcurementResult {
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

/** Whether a reservation makes a bad year (the 95th percentile) cheapest, within the curve's flat bottom. */
export function atBadYearBottom(s: Pick<PlanState, 'reserved' | 'growth' | 'sigma'>): boolean {
  return planOf(s).p95 <= bestOf(s.growth, s.sigma).p95.p95 * (1 + BAD_YEAR_TOLERANCE);
}

/** The side of the average's best reservation on which a bad year is cheapest, with the starting forecast. */
export function badYearSide(): SideGuess {
  const b = bestOf(PLAN_DEFAULTS.growth, PLAN_DEFAULTS.sigma);
  return b.p95.reserved > b.mean.reserved ? 'right' : 'left';
}

/** Challenge a: the right prediction, then, with the starting forecast, the reservation that makes a bad year cheapest. */
export function badYearSolved(s: PlanState): boolean {
  if (s.growth !== PLAN_DEFAULTS.growth || s.sigma !== PLAN_DEFAULTS.sigma) return false;
  return s.guess === badYearSide() && atBadYearBottom(s);
}

const MONTHS = PROCUREMENT_DEFAULTS.months;
const SHAPE_MEAN = WEEK_SHAPE.reduce((a, b) => a + b, 0) / WEEK_SHAPE.length;

function NeedFan({ s }: { s: PlanState }) {
  const fan = growthFan(PROCUREMENT_DEFAULTS.peakNow, MONTHS - 1, s.growth / 100, s.sigma / 100, Math.max(1, s.reserved));
  const top = 32;
  const bot = 178;
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
      viewBox="0 0 640 212"
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
        <text key={f.month} className="ax ax-m" x={sx(f.month)} y={196}>
          {f.month + 1}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={210}>
        month of the year
      </text>
    </svg>
  );
}

/** The year's cost against the reservation. The bad-year curve appears once the reader has predicted where it bottoms out, and its lowest point once the challenge is solved. */
function CostCurve({ s, plan, showBad, showBadBest }: { s: PlanState; plan: ProcurementResult; showBad: boolean; showBadBest: boolean }) {
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
      aria-label={`The year’s cost against GPUs reserved. Average: lowest at ${fmt(best.mean.reserved)} reserved, ${millions(best.mean.mean)}.${showBadBest ? ` Bad year (1 in 20): lowest at ${fmt(best.p95.reserved)}, ${millions(best.p95.p95)}.` : ''} With ${fmt(s.reserved)} reserved: average ${millions(plan.mean)}${showBad ? `, bad year ${millions(plan.p95)}` : ''}.`}
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
        {showBad && <path d={linePath(xs, pts.map((p) => yv(p.p95)))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="6 4" />}
        <path d={linePath(xs, pts.map((p) => yv(p.mean)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
        <circle cx={sx(best.mean.reserved)} cy={yv(best.mean.mean)} r={4} fill="#fcfcfb" stroke={GRAPHIC.green} strokeWidth={2} />
        {showBadBest && <circle cx={sx(best.p95.reserved)} cy={yv(best.p95.p95)} r={4} fill="#fcfcfb" stroke={GRAPHIC.red} strokeWidth={2} />}
      </g>
      <text className="ax" x={sx(best.mean.reserved)} y={yv(best.mean.mean) + 16} textAnchor="middle" style={{ fill: TEXT.green }}>
        lowest average · {fmt(best.mean.reserved)}
      </text>
      {showBadBest && (
        <text className="ax" x={sx(best.p95.reserved) + 8} y={yv(best.p95.p95) - 8} style={{ fill: TEXT.red }}>
          lowest bad year · {fmt(best.p95.reserved)}
        </text>
      )}
      <line className="cur" x1={cur.x} x2={cur.x} y1={top} y2={bot} />
      {showBad && cur.p95 >= top && <circle cx={cur.x} cy={cur.p95} r={5} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={2} />}
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
// Figure 2: when spot beats reserving, against the width of a synchronous job and its restart time.

export type JobId = 'tune8' | 'train70';
export const JOB_IDS: JobId[] = ['tune8', 'train70'];
export const JOBS: Record<JobId, SpotJob> = { tune8: spotJobOf('tune8'), train70: spotJobOf('train70') };
const JOB_LABEL: Record<JobId, string> = { tune8: 'Fine-tuning jobs', train70: 'Pretraining run' };
const JOB_COLOR: Record<JobId, string> = { tune8: GRAPHIC.gold, train70: GRAPHIC.violet };
const JOB_TEXT: Record<JobId, string> = { tune8: TEXT.gold, train70: TEXT.violet };

export interface SpotState {
  /** Reclaims per server per day. */
  reclaims: number;
  /** Minutes to get replacement servers running after a reclaim. */
  restart: number;
}

export const SPOT_DEFAULTS: SpotState = { reclaims: 2, restart: RESTART_MINUTES };
export const RECLAIM_MAX = 4;
export const RECLAIM_STEP = 0.05;
export const RESTART_MIN = 2;
export const RESTART_MAX = 30;
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
  while (spotBeatsReserved(job, hi, restart)) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (spotBeatsReserved(job, mid, restart)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Whole-job stops a day a job can bear before a useful spot hour costs more than a reserved one:
 * the crossover reclaim rate times the servers that must all keep running.
 */
export function bearableStops(job: SpotJob, restart: number): number {
  return crossoverReclaims(job, restart) * job.servers;
}

/** The bearable stops of both jobs at every whole-minute restart time on the slider (computed once). */
export const BEARABLE: Record<JobId, number[]> = (() => {
  const out = { tune8: [] as number[], train70: [] as number[] };
  for (const id of JOB_IDS) for (let m = RESTART_MIN; m <= RESTART_MAX; m++) out[id].push(bearableStops(JOBS[id], m));
  return out;
})();

/** Snap a slider value to its grid, so 0.75 is 0.75. */
const snap = (x: number) => Math.round(x / RECLAIM_STEP) * RECLAIM_STEP;

/** Challenge b: for the pretraining run at the starting restart time, the highest reclaim rate on the slider's grid at which spot still beats reserved. */
export function wideSolved(s: SpotState): boolean {
  if (s.restart !== SPOT_DEFAULTS.restart) return false;
  const job = JOBS.train70;
  return spotBeatsReserved(job, snap(s.reclaims), s.restart) && !spotBeatsReserved(job, snap(s.reclaims + RECLAIM_STEP), s.restart);
}

export const WIDE_ANSWER = (() => {
  let best = 0;
  for (let r = 0; r <= RECLAIM_MAX + 1e-9; r += RECLAIM_STEP) if (spotBeatsReserved(JOBS.train70, snap(r), SPOT_DEFAULTS.restart)) best = snap(r);
  return best;
})();

const STOPS_LO = 1;
const STOPS_HI = 300;

function StopsChart({ s }: { s: SpotState }) {
  const top = 24;
  const bot = 206;
  const sx = scale(RESTART_MIN, RESTART_MAX, X0, X1);
  const ly = scale(Math.log10(STOPS_LO), Math.log10(STOPS_HI), bot, top);
  const sy = (v: number) => ly(Math.log10(Math.min(STOPS_HI, Math.max(STOPS_LO, v))));
  const minutes = BEARABLE.tune8.map((_, i) => RESTART_MIN + i);
  const at = s.restart - RESTART_MIN;
  const stops = (id: JobId) => s.reclaims * JOBS[id].servers;
  const label = JOB_IDS.map(
    (id) => `${JOB_LABEL[id]}, ${fmt(JOBS[id].servers)} servers: stopped ${fmt(stops(id), 1)} times a day, and can bear about ${fmt(BEARABLE[id][at])} with ${fmt(s.restart)}-minute restarts`,
  ).join('. ');
  return (
    <svg className="chart" viewBox="0 0 640 246" role="img" aria-label={`Whole-job stops a day, at ${fmt(s.reclaims, 2)} reclaims per server a day. ${label}.`}>
      <text className="ax" x={X0} y={12}>
        Stops of the whole job a day (log scale): curves, what it can bear; flat lines, what it gets
      </text>
      {[1, 3, 10, 30, 100, 300].map((t) => (
        <g key={t}>
          <line className="gl" x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} />
          <text className="ax ax-e" x={X0 - 6} y={sy(t) + 4}>
            {fmt(t)}
          </text>
        </g>
      ))}
      <line className="base" x1={X0} x2={X1} y1={bot} y2={bot} />
      {JOB_IDS.map((id) => {
        const y = sy(stops(id));
        const off = stops(id) < STOPS_LO;
        return (
          <g key={id}>
            <path d={linePath(minutes.map(sx), BEARABLE[id].map(sy))} fill="none" stroke={JOB_COLOR[id]} strokeWidth={2.5} strokeLinejoin="round" />
            <line x1={X0} x2={X1} y1={y} y2={y} stroke={JOB_COLOR[id]} strokeWidth={1.8} strokeDasharray="6 4" />
            <text className="ax" x={X1 - 4} y={y - 5} textAnchor="end" style={{ fill: JOB_TEXT[id] }}>
              {JOB_LABEL[id].toLowerCase()}, {fmt(JOBS[id].servers)} servers: {off ? 'never stopped' : `stopped ${fmt(stops(id), stops(id) < 10 ? 1 : 0)} times a day`}
            </text>
            <circle cx={sx(s.restart)} cy={sy(BEARABLE[id][at])} r={5} fill={JOB_COLOR[id]} stroke="#fcfcfb" strokeWidth={2} />
          </g>
        );
      })}
      <text className="ax" x={sx(RESTART_MIN) + 4} y={sy(BEARABLE.tune8[0]) - 8} style={{ fill: JOB_TEXT.tune8 }}>
        fine-tuning can bear
      </text>
      {/* Under the pretraining curve where it has already fallen, so the label never crosses it. */}
      <text className="ax" x={sx(4)} y={sy(BEARABLE.train70[10 - RESTART_MIN]) + 15} style={{ fill: JOB_TEXT.train70 }}>
        pretraining can bear
      </text>
      <line className="cur" x1={sx(s.restart)} x2={sx(s.restart)} y1={top} y2={bot} />
      {[2, 5, 10, 15, 20, 25, 30].map((v) => (
        <text key={v} className="ax ax-m" x={sx(v)} y={224}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={242}>
        minutes to restart after a reclaim
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers for the prose.

const START = PLAN_DEFAULTS;
const BEST = bestOf(START.growth, START.sigma);
/** The reservation with the lowest average cost: the line challenge a's prediction is drawn against. */
const N_BEST_MEAN = BEST.mean.reserved;
const ALL_OD = planOf({ ...START, reserved: 0 });
const AT_BEST_MEAN = planOf({ ...START, reserved: BEST.mean.reserved });
const AT_BEST_P95 = planOf({ ...START, reserved: BEST.p95.reserved });
const AT_500 = planOf({ ...START, reserved: 500 });
const AT_MAX = planOf({ ...START, reserved: RESERVE_MAX });
const CALM = bestOf(START.growth, 0);
const WILD = bestOf(START.growth, 12);
const HOURS_YEAR = 730 * MONTHS;
const INTERRUPTIBLE = PROCUREMENT_DEFAULTS.interruptible;
const TUNE_START = bestSpot(JOBS.tune8, SPOT_DEFAULTS.reclaims, SPOT_DEFAULTS.restart);
const TRAIN_START = bestSpot(JOBS.train70, SPOT_DEFAULTS.reclaims, SPOT_DEFAULTS.restart);
const bear = (id: JobId, restart: number) => BEARABLE[id][restart - RESTART_MIN];

export const LESSON_NUMBERS = {
  peakNow: PROCUREMENT_DEFAULTS.peakNow,
  averageHourNow: PROCUREMENT_DEFAULTS.peakNow * SHAPE_MEAN,
  finalPeak: ALL_OD.finalPeak,
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
  trainTwo: TRAIN_START.perUsefulHour,
  trainCross: crossoverReclaims(JOBS.train70, SPOT_DEFAULTS.restart),
  /** Share of paid spot hours that must do useful work for spot to match the reserved price. */
  usefulNeeded: PRICE.spot / PRICE.reserved,
  tuneBear: bear('tune8', SPOT_DEFAULTS.restart),
  trainBear: bear('train70', SPOT_DEFAULTS.restart),
  trainBear2: bear('train70', RESTART_MIN),
  trainBear30: bear('train70', RESTART_MAX),
  trainCross2: crossoverReclaims(JOBS.train70, RESTART_MIN),
  trainCross30: crossoverReclaims(JOBS.train70, RESTART_MAX),
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
  const showBad = ps.guess !== '';
  const startForecast = ps.growth === PLAN_DEFAULTS.growth && ps.sigma === PLAN_DEFAULTS.sigma;
  const statusA =
    ps.guess === ''
      ? `Make your prediction in the first demonstration: left or right of ${fmt(N_BEST_MEAN)}? The bad-year curve appears once you have.`
      : !startForecast
        ? `Set the forecast back to ${fmt(PLAN_DEFAULTS.growth)}% growth a month, give or take ${fmt(PLAN_DEFAULTS.sigma)}%.`
        : atBadYearBottom(ps)
          ? `${fmt(ps.reserved)} reserved is the bottom of the dashed curve. Is it on the side you predicted?`
          : `With ${fmt(ps.reserved)} reserved, a bad year costs ${millions(plan.p95)}. Find the reservation where the dashed curve bottoms out.`;
  const reservedCost = ps.reserved * PRICE.reserved * HOURS_YEAR;
  const onDemandAvg = plan.mean - reservedCost;

  const s2 = useScenario('spot', SPOT_DEFAULTS);
  const sp = s2.state;
  const tuneRun = useMemo(() => bestSpot(JOBS.tune8, sp.reclaims, sp.restart), [sp.reclaims, sp.restart]);
  const trainRun = useMemo(() => bestSpot(JOBS.train70, sp.reclaims, sp.restart), [sp.reclaims, sp.restart]);
  const solvedB = wideSolved(sp);
  const spotText = (r: SpotRun) => (Number.isFinite(r.perUsefulHour) ? dollars(r.perUsefulHour) : 'never finishes');
  const spotTone = (r: SpotRun) => (r.perUsefulHour < PRICE.reserved ? ('green' as const) : ('red' as const));
  const statusB =
    sp.restart !== SPOT_DEFAULTS.restart
      ? `Set the restart time back to ${fmt(SPOT_DEFAULTS.restart)} minutes.`
      : sp.reclaims === SPOT_DEFAULTS.reclaims
        ? 'Make your estimate, then set the reclaim rate to it.'
        : `At ${fmt(sp.reclaims, 2)} reclaims per server a day: is this your estimate, rounded down to the slider’s steps? Check it against the readouts.`;

  const N = LESSON_NUMBERS;

  return (
    <LessonPage id="compute/6.2">
      <P>
        The previous lesson took the provider’s side: given a fleet, which work should each GPU do? This lesson takes the buyer’s. A company that runs models on rented
        capacity has to decide, months ahead, how much of it to commit to. It can’t wait and see. As <a href={lessonHref('compute/5.2')}>Lesson 5.2</a> showed, capacity
        arrives in quarters, and the reserved contracts of <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> are signed for a year at a time. Lesson 5.4 found the rule
        for a need known in advance: reserve up to the level the need exceeds in two-thirds of the hours — the reserved price over the on-demand one, {dollars(PRICE.reserved)} ÷{' '}
        {dollars(PRICE.onDemand)}. But next year’s need isn’t known. It grows, by an amount nobody
        can promise (<a href={lessonHref('compute/5.3')}>Lesson 5.3</a>).
      </P>
      <P>
        Here is the buyer. Its inference service needs {fmt(N.peakNow)} A-class 80 GB GPUs at its busiest hour today, with the daily and weekly shape of Lesson 5.3’s
        inference curve, so an average hour needs about {fmt(N.averageHourNow)}. That busiest hour is forecast to grow by {fmt(PLAN_DEFAULTS.growth)}% a month, give or take{' '}
        {fmt(PLAN_DEFAULTS.sigma)}% each month. The service can use <K tone="green">reserved</K> GPUs, committed for the whole year at a simulated{' '}
        {dollars(PRICE.reserved)} an hour whether busy or not, and <K tone="green">on-demand</K> GPUs at {dollars(PRICE.onDemand)} for whatever the reservation doesn’t
        cover. (The company’s work that can be interrupted is a separate question, for the last section.) To see what the uncertainty does, we simulate{' '}
        {fmt(PROCUREMENT_DEFAULTS.scenarios)} possible years.
      </P>
      <P>
        In the next demonstration, the upper chart is the forecast: the busiest hour of each month across the simulated years, with the band holding 90% of them, and the
        median of an average hour dashed. The lower chart is the cost of the year against the number of GPUs reserved, in green the <K tone="green">average</K> over all
        the years; the equation splits it into what the reservation costs and what is bought on demand. Set the reservation, and then the forecast:
      </P>

      <Figure name="Capacity Procurement Optimizer" scenario={s1}>
        <NeedFan s={ps} />
        <CostCurve s={ps} plan={plan} showBad={showBad} showBadBest={solvedA} />
        <Legend
          items={[
            { label: 'average year', color: GRAPHIC.green, kind: 'line' },
            ...(showBad ? [{ label: 'bad year (1 in 20)', color: GRAPHIC.red, kind: 'line' as const, dashed: true }] : []),
            { label: 'reserved GPUs', color: COLOR.reserved, kind: 'line' },
          ]}
        />
        <Slider label="Reserved GPUs" tone="green" value={ps.reserved} min={0} max={RESERVE_MAX} step={RESERVE_STEP} onChange={(v) => s1.set({ reserved: v })} display={`${fmt(ps.reserved)} GPUs`} />
        <Slider label="Growth a month" tone="ink" value={ps.growth} min={0} max={10} step={0.5} onChange={(v) => s1.set({ growth: v })} display={`${fmt(ps.growth, 1)}%`} />
        <Slider label="Uncertainty" tone="ink" value={ps.sigma} min={0} max={12} step={1} onChange={(v) => s1.set({ sigma: v })} display={`± ${fmt(ps.sigma)}% a month`} />
        <Eq label="Cost of an average year">
          <span>average year</span>
          <Op>=</Op>
          <span>{usd(reservedCost)} reserved</span>
          <Op>+</Op>
          <span>{usd(onDemandAvg)} on demand</span>
          <Op>=</Op>
          <K tone="green">{millions(plan.mean)}</K>
        </Eq>
        <Readouts
          items={[
            { label: 'bad year (1 in 20)', value: showBad ? millions(plan.p95) : 'predict first', tone: 'red' },
            { label: 'reserved hours idle', value: share(plan.idleShare) },
          ]}
        />
        <Prediction
          label={`Challenge a — predict: is a bad year cheapest left or right of ${fmt(N_BEST_MEAN)} reserved?`}
          aria="Your prediction for challenge a"
          value={ps.guess}
          onChange={(guess) => s1.set({ guess })}
          options={[
            { value: 'left', label: `Left of ${fmt(N_BEST_MEAN)}: fewer GPUs` },
            { value: 'right', label: `Right of ${fmt(N_BEST_MEAN)}: more GPUs` },
          ]}
        />
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
        An average is a fine thing to minimize for a company that will make the same bet many times. A company making it once also cares about the{' '}
        <K tone="red">bad year</K>: the cost that one simulated year in twenty reaches or exceeds. Bad years are the fast ones, in which the need grows quickly and every
        GPU beyond the reservation is bought at {dollars(PRICE.onDemand)}. With nothing reserved, a bad year costs {millions(N.allOnDemandP95)}; at the reservation that
        minimizes the average, {fmt(N.bestMeanReserved)}, it costs {millions(N.bestMeanP95)}. Is {fmt(N.bestMeanReserved)} also the reservation that makes a bad year
        cheapest?
      </P>

      <Challenge
        id="a"
        question={`Predict first: with the forecast as it starts — 4% growth a month, give or take 5% — will the reservation that makes a bad year cheapest be left or right of ${fmt(N.bestMeanReserved)}? Choose your prediction in the first demonstration, which then draws a bad year’s cost as a dashed curve, and find the reservation where that curve bottoms out.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: to the right. At ${fmt(ps.reserved)} reserved GPUs a bad year costs ${millions(plan.p95)}, ${ps.reserved === N.bestP95Reserved ? 'the least of any reservation' : `within 0.1% of the least, ${millions(N.bestP95P95)} at ${fmt(N.bestP95Reserved)}`}, while the average year costs ${millions(plan.mean)}: ${usd(plan.mean - N.bestMeanMean)} more than at ${fmt(N.bestMeanReserved)}. In a fast year the need sits above more of the reserved GPUs for more of the year, so a GPU that would have been idle too often in an average year is busy enough to beat the on-demand price.`}
      />

      <P>
        Reserving {fmt(N.bestP95Reserved)} GPUs rather than {fmt(N.bestMeanReserved)} is insurance. It costs {usd(N.bestP95Mean - N.bestMeanMean)} in an average year,
        and {share(N.bestP95Idle)} of the reserved hours sit idle instead of {share(N.bestMeanIdle)}, but it cuts the bad year by{' '}
        {usd(N.bestMeanP95 - N.bestP95P95)}. How much insurance is worth buying depends on how uncertain the forecast is. Set the uncertainty to zero and the two curves
        become one, lowest at {fmt(N.calmBest)} GPUs. Raise it to 12% a month and they pull apart: the average is lowest at {fmt(N.wildBestMean)}, a bad year at{' '}
        {fmt(N.wildBestP95)}. The more uncertain the year, the more a cautious buyer reserves — and the less a buyer who only cares about the average does. Faster growth
        moves both curves right, because the need rises above each reserved GPU for more of the year.
      </P>

      <H2>When spot beats reserving</H2>
      <P>
        The plan so far covered the firm need. The company also has {fmt(INTERRUPTIBLE)} GPUs’ worth of training work, around the clock, that can be interrupted, and
        for it there is a third product: spot. <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> showed what an interruptible hour is worth. A synchronous job stops
        whenever any one of its servers is reclaimed (
        <a href={lessonHref('compute/3.3')}>Lesson 3.3</a>), loses the work since its last checkpoint and has to restart, so an interruptible hour is worth only what
        survives. Its two training jobs, reclaimed twice a day per server, came out far apart: the fine-tuning job at {dollars(N.tuneCost)} per useful hour, the
        pretraining run at {dollars(N.trainTwo)}. The buyer’s question is the next one: for which work does spot beat reserving the same GPUs, at{' '}
        {dollars(PRICE.reserved)} an hour, which at {fmt(INTERRUPTIBLE)} GPUs around the clock costs {millions(N.reservedYear)} a year?
      </P>
      <P>
        Two numbers decide it. Spot sells for {dollars(PRICE.spot)} an hour, so to match the reserved price at least {dollars(PRICE.spot)} ÷ {dollars(PRICE.reserved)} ={' '}
        {share(N.usefulNeeded)} of the paid hours must do useful work. Each stop of the whole job costs a restart, a checkpoint read back and, on average, half a
        checkpoint interval of lost work, so a job can bear only so many stops a day; that is the first number. The second is how many it gets: the provider’s reclaims per
        server times the servers that must all keep running. In the next demonstration, the curves are the stops a day each job can bear, at its best checkpoint interval,
        against the time a restart takes; the flat lines are the stops it gets. Set the provider’s reclaim rate and the restart time:
      </P>

      <Figure name="Capacity Procurement Optimizer · spot" scenario={s2}>
        <StopsChart s={sp} />
        <Legend
          items={[
            { label: `${JOB_LABEL.tune8} (${fmt(N.tuneGpus)} GPUs)`, color: JOB_COLOR.tune8, kind: 'line' },
            { label: `${JOB_LABEL.train70} (${fmt(N.trainGpus)} GPUs)`, color: JOB_COLOR.train70, kind: 'line' },
          ]}
        />
        <Slider label="Reclaims per server" tone="teal" value={sp.reclaims} min={0} max={RECLAIM_MAX} step={RECLAIM_STEP} onChange={(v) => s2.set({ reclaims: snap(v) })} display={`${fmt(sp.reclaims, 2)} a day`} />
        <Slider label="Restart time" tone="teal" value={sp.restart} min={RESTART_MIN} max={RESTART_MAX} onChange={(v) => s2.set({ restart: v })} display={`${fmt(sp.restart)} min`} />
        <Readouts
          items={[
            { label: `fine-tuning on spot, per useful GPU-hour (reserved: ${dollars(PRICE.reserved)})`, value: spotText(tuneRun), tone: spotTone(tuneRun) },
            { label: `pretraining on spot, per useful GPU-hour (reserved: ${dollars(PRICE.reserved)})`, value: spotText(trainRun), tone: spotTone(trainRun) },
          ]}
        />
      </Figure>

      <P>
        With {fmt(SPOT_DEFAULTS.restart)}-minute restarts the fine-tuning jobs can bear about {fmt(N.tuneBear)} stops a day and the pretraining run about{' '}
        {fmt(N.trainBear)}: much the same, because each stop costs them much the same time. What separates them is width. Reclaimed twice a day per server, the fine-tuning
        job’s {fmt(N.tuneServers)} servers stop it {fmt(N.tuneServers * 2)} times a day, far inside its limit, and spot wins until its {fmt(N.tuneBear)} bearable stops
        are shared between its {fmt(N.tuneServers)} servers: {fmt(N.tuneCross, 1)} reclaims per server a day. The pretraining run’s {fmt(N.trainServers)} servers stop it{' '}
        {fmt(N.trainServers * 2)} times a day, well past its limit.
      </P>

      <Challenge
        id="b"
        figure="Capacity Procurement Optimizer · spot"
        question={`Estimate first, the way ${fmt(N.tuneCross, 1)} came from the fine-tuning job’s stops and servers: with ${fmt(SPOT_DEFAULTS.restart)}-minute restarts, what is the highest reclaim rate per server, in the slider’s steps of 0.05 a day, at which the pretraining run’s spot hours still cost less than reserving? Set the reclaim rate to your estimate and check it against the readouts.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${fmt(WIDE_ANSWER, 2)} a day. The run can bear about ${fmt(N.trainBear, 1)} stops a day, and ${fmt(N.trainBear, 1)} ÷ ${fmt(N.trainServers)} servers is ${fmt(N.trainCross, 2)} reclaims per server; one step more, ${fmt(WIDE_ANSWER + RECLAIM_STEP, 2)}, and spot costs more than reserving. The small fine-tuning jobs, on the same spot capacity, beat reserving until ${fmt(N.tuneCross, 1)} a day: the width of a synchronous job multiplies every reclaim.`}
      />

      <P>
        The restart time is just as physical, and it moves the curves. With two-minute restarts the pretraining run could bear about {fmt(N.trainBear2)} stops a day,
        or {fmt(N.trainCross2, 2)} reclaims per server; with thirty-minute restarts, about {fmt(N.trainBear30)}, or {fmt(N.trainCross30, 2)}. Faster replacement
        servers, smaller checkpoints and faster storage raise the curve, smaller synchronous groups lower the line, and each is a reason to engineer a training system for
        interruption before buying interruptible capacity for it.
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
