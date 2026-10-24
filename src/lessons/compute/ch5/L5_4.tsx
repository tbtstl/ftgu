import { useId, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { DEMAND_DEFAULTS, weeklyDemand } from '../../../engines/compute/demand';
import { breakEvenUtilization, buyerCost, providerEconomics, type ProviderResult } from '../../../engines/compute/pricing';
import { RESTART_MINUTES, bestInterval, checkpointMinutes, spotJobOf, spotRun, type SpotJob } from '../../../engines/compute/spotCheckpoint';
import { gpuHourCost, type FacilityPlan } from '../../../engines/compute/facilityCost';
import { annualPue } from '../../../engines/compute/cooling';
import { SITES } from '../../../model/compute/sites';
import { PRICES } from '../../../model/compute/prices';

// ---------------------------------------------------------------------------
// The A-class's simulated prices, and the colors of the three products.

const PRICE = PRICES.A;

const COLOR = {
  reserved: '#5f7488',
  onDemand: GRAPHIC.gold,
  spot: GRAPHIC.teal,
  idle: GRAPHIC.red,
};

const dollars = (x: number) => usd(x, 2);
const share = (x: number) => `${fmt(x * 100)}%`;

// ---------------------------------------------------------------------------
// Figure 1: a buyer's hourly need — Lesson 5.3's inference curve at a tenth of its size.

export const NEED: number[] = weeklyDemand(DEMAND_DEFAULTS).inference.map((x) => x / 10);
export const HOURS = NEED.length;
const SORTED = [...NEED].sort((a, b) => b - a);
const USEFUL = NEED.reduce((a, b) => a + b, 0);
const NEED_MIN = Math.min(...NEED);
const NEED_MAX = Math.max(...NEED);
export const RESERVE_MAX = 300;

export function bill(reserved: number) {
  return buyerCost(NEED, reserved, PRICE);
}

/** The cheapest reservation on the slider's whole-GPU grid, and its bill. */
export const CHEAPEST = (() => {
  let best = 0;
  let total = Infinity;
  for (let r = 0; r <= RESERVE_MAX; r++) {
    const t = bill(r).total;
    if (t < total) {
      total = t;
      best = r;
    }
  }
  return { reserved: best, total };
})();

/** Within this many dollars of the cheapest four weeks counts as the cheapest (the bottom is nearly flat). */
export const RESERVE_TOLERANCE = 5;

/** Challenge a: the reservation that makes the service's four weeks cheapest. */
export function reserveSolved(reserved: number): boolean {
  return bill(reserved).total <= CHEAPEST.total + RESERVE_TOLERANCE;
}

/** The level the need exceeds in exactly reserved ÷ on-demand of the hours. */
const BREAK_EVEN = breakEvenUtilization(PRICE);
const LEVEL_AT_BREAK_EVEN = SORTED[Math.ceil(BREAK_EVEN * HOURS) - 1];

const X0 = 64;
const X1 = 616;
const Y_MAX = 300;

function NeedChart({ reserved }: { reserved: number }) {
  const top = 22;
  const bot = 178;
  const sx = scale(0, HOURS, X0, X1);
  const sy = scale(0, Y_MAX, bot, top);
  const xs = NEED.map((_, i) => sx(i + 0.5));
  const used = NEED.map((n) => Math.min(n, reserved));
  const zero = NEED.map(() => sy(0));
  const r = NEED.map(() => sy(reserved));
  const b = bill(reserved);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 214"
      role="img"
      aria-label={`Four weeks of the service’s need, between ${fmt(NEED_MIN)} and ${fmt(NEED_MAX)} A-class GPUs, with ${fmt(reserved)} reserved. A used GPU-hour costs ${dollars(b.perUsefulHour)}.`}
    >
      <text className="ax" x={X0} y={12}>
        A-class GPUs needed, hour by hour
      </text>
      <GridY y={sy} ticks={[0, 100, 200, 300]} x0={X0} x1={X1} baseline={0} />
      <path d={areaPath(xs, used.map(sy), zero)} fill={tint(COLOR.reserved, 0.55)} />
      <path d={areaPath(xs, r, used.map(sy))} fill={tint(COLOR.idle, 0.4)} />
      <path d={areaPath(xs, NEED.map((n) => sy(Math.max(n, reserved))), r)} fill={tint(COLOR.onDemand, 0.55)} />
      <path d={linePath(xs, NEED.map(sy))} fill="none" stroke="#333" strokeWidth={1.1} strokeLinejoin="round" />
      {reserved > 0 && <line x1={X0} x2={X1} y1={sy(reserved)} y2={sy(reserved)} stroke={COLOR.reserved} strokeWidth={2} />}
      {[0, 1, 2, 3].map((w) => (
        <text key={w} className="ax ax-m" x={sx(w * 168 + 84)} y={196}>
          week {w + 1}
        </text>
      ))}
      {[1, 2, 3].map((w) => (
        <line key={w} className="gl" x1={sx(w * 168)} x2={sx(w * 168)} y1={top} y2={bot} />
      ))}
    </svg>
  );
}

function DurationChart({ reserved }: { reserved: number }) {
  const top = 22;
  const bot = 154;
  const sx = scale(0, 1, X0, X1);
  const sy = scale(0, Y_MAX, bot, top);
  const xs = SORTED.map((_, i) => sx((i + 0.5) / HOURS));
  const used = SORTED.map((n) => Math.min(n, reserved));
  const zero = SORTED.map(() => sy(0));
  const r = SORTED.map(() => sy(reserved));
  const above = NEED.filter((n) => n > reserved).length / HOURS;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 190"
      role="img"
      aria-label={`The same four weeks sorted from the busiest hour to the quietest. The need is above ${fmt(reserved)} GPUs in ${share(above)} of hours; reserving pays up to the level it exceeds in two-thirds of hours, about ${fmt(LEVEL_AT_BREAK_EVEN)} GPUs.`}
    >
      <text className="ax" x={X0} y={12}>
        The same hours, busiest first
      </text>
      <GridY y={sy} ticks={[0, 100, 200, 300]} x0={X0} x1={X1} baseline={0} />
      <path d={areaPath(xs, used.map(sy), zero)} fill={tint(COLOR.reserved, 0.55)} />
      <path d={areaPath(xs, r, used.map(sy))} fill={tint(COLOR.idle, 0.4)} />
      <path d={areaPath(xs, SORTED.map((n) => sy(Math.max(n, reserved))), r)} fill={tint(COLOR.onDemand, 0.55)} />
      <path d={linePath(xs, SORTED.map(sy))} fill="none" stroke="#333" strokeWidth={1.5} />
      {reserved > 0 && <line x1={X0} x2={X1} y1={sy(reserved)} y2={sy(reserved)} stroke={COLOR.reserved} strokeWidth={2} />}
      <line x1={sx(BREAK_EVEN)} x2={sx(BREAK_EVEN)} y1={top} y2={bot} stroke="#555" strokeDasharray="4 4" />
      <circle cx={sx(BREAK_EVEN)} cy={sy(LEVEL_AT_BREAK_EVEN)} r={4.5} fill="#333" />
      <text className="ax" x={sx(BREAK_EVEN) + 6} y={top + 12}>
        two-thirds of hours
      </text>
      <text className="ax" x={sx(BREAK_EVEN) + 8} y={sy(LEVEL_AT_BREAK_EVEN) - 8} style={{ fill: '#333' }}>
        {fmt(LEVEL_AT_BREAK_EVEN)} GPUs
      </text>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={172}>
          {fmt(t * 100)}%
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={188}>
        share of hours with at least this need
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: interruptible capacity for a training job.

export type JobId = 'tune8' | 'train70';
export const JOBS: Record<JobId, SpotJob> = { tune8: spotJobOf('tune8'), train70: spotJobOf('train70') };
const JOB_NAME: Record<JobId, string> = { tune8: 'Fine-tuning job', train70: 'Pretraining run' };

export interface SpotState {
  job: JobId;
  /** Reclaims per server per day. */
  reclaims: number;
  /** Minutes between checkpoints. */
  interval: number;
}

export const SPOT_DEFAULTS: SpotState = { job: 'tune8', reclaims: 2, interval: 60 };
export const INTERVAL_MAX = 120;

export function spotOf(s: SpotState) {
  return spotRun(JOBS[s.job], PRICE.spot, s.reclaims, s.interval);
}

/** Cheapest interval on the slider's grid, for a job and reclaim rate. */
export function cheapestInterval(job: JobId, reclaims: number) {
  const m = bestInterval(JOBS[job], PRICE.spot, reclaims, INTERVAL_MAX);
  return { interval: m, cost: spotRun(JOBS[job], PRICE.spot, reclaims, m).perUsefulHour };
}

/** Within this share of the cheapest counts: the bottom of the curve is flat. */
export const INTERVAL_TOLERANCE = 0.0005;

/** Challenge b: the fine-tuning job, at two reclaims per server a day, checkpointed at its cheapest interval. */
export function intervalSolved(s: SpotState): boolean {
  if (s.job !== 'tune8' || s.reclaims !== SPOT_DEFAULTS.reclaims) return false;
  const best = cheapestInterval('tune8', s.reclaims);
  return spotOf(s).perUsefulHour <= best.cost * (1 + INTERVAL_TOLERANCE);
}

function minutesText(m: number): string {
  return m < 1 ? `${fmt(m * 60)} s` : `${fmt(m, m < 10 ? 1 : 0)} min`;
}

function SpotChart({ s }: { s: SpotState }) {
  const clip = 'sp' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const top = 22;
  const bot = 186;
  const pts = useMemo(() => Array.from({ length: INTERVAL_MAX }, (_, i) => ({ m: i + 1, c: spotRun(JOBS[s.job], PRICE.spot, s.reclaims, i + 1).perUsefulHour })), [s.job, s.reclaims]);
  // A taller scale when even the best interval costs more than $3.50 a useful hour.
  const lowest = Math.min(...pts.map((p) => p.c));
  const yMax = Number.isFinite(lowest) && lowest > 3.5 ? 8 : 4;
  const sx = scale(1, INTERVAL_MAX, X0, X1);
  const sy = scale(0, yMax, bot, top);
  // Draw the finite stretches of the curve; where the job never finishes, shade instead.
  const segs: Array<Array<{ m: number; c: number }>> = [];
  let cur: Array<{ m: number; c: number }> = [];
  for (const p of pts) {
    if (Number.isFinite(p.c)) cur.push(p);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  // Stretches of intervals at which the job never gets anywhere.
  const never: Array<[number, number]> = [];
  for (const p of pts) {
    if (Number.isFinite(p.c)) continue;
    const last = never[never.length - 1];
    if (last && last[1] === p.m - 1) last[1] = p.m;
    else never.push([p.m, p.m]);
  }
  const widest = never.reduce<[number, number] | null>((a, r) => (!a || r[1] - r[0] > a[1] - a[0] ? r : a), null);
  const run = spotOf(s);
  const refs = [
    { v: PRICE.onDemand, label: `on demand ${dollars(PRICE.onDemand)}`, color: COLOR.onDemand },
    { v: PRICE.reserved, label: `reserved ${dollars(PRICE.reserved)}`, color: COLOR.reserved },
    { v: PRICE.spot, label: `spot price ${dollars(PRICE.spot)}`, color: COLOR.spot },
  ];
  const finite = Number.isFinite(run.perUsefulHour);
  const shownY = finite ? sy(Math.min(run.perUsefulHour, yMax)) : top;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 222"
      role="img"
      aria-label={`${JOB_NAME[s.job]} on interruptible A-class GPUs, ${fmt(s.reclaims, 2)} reclaims per server a day, a checkpoint every ${fmt(s.interval)} minutes: ${finite ? `${dollars(run.perUsefulHour)} per useful GPU-hour` : 'the job never gets anywhere'}, against ${dollars(PRICE.reserved)} reserved and ${dollars(PRICE.onDemand)} on demand.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={X0} y={top - 2} width={X1 - X0} height={bot - top + 2} />
        </clipPath>
      </defs>
      <text className="ax" x={X0} y={12}>
        Price of one useful GPU-hour
      </text>
      <GridY y={sy} ticks={yMax === 8 ? [0, 2, 4, 6, 8] : [0, 1, 2, 3, 4]} x0={X0} x1={X1} format={(v) => usd(v)} baseline={0} />
      {never.map(([a, z]) => (
        <rect key={a} x={Math.max(X0, sx(a - 0.5))} y={top} width={Math.min(X1, sx(z + 0.5)) - Math.max(X0, sx(a - 0.5))} height={bot - top} fill={tint(GRAPHIC.red, 0.18)} />
      ))}
      {widest && widest[1] - widest[0] >= 20 && (
        <text className="ax ax-m" x={(sx(widest[0]) + sx(widest[1])) / 2} y={top + 36} style={{ fill: TEXT.red }}>
          interrupted faster than it can make progress
        </text>
      )}
      {refs.map((r) => (
        <g key={r.label}>
          <line x1={X0} x2={X1} y1={sy(r.v)} y2={sy(r.v)} stroke={r.color} strokeWidth={1.5} strokeDasharray="6 4" />
          <text className="ax ax-e" x={X1} y={sy(r.v) - 5} style={{ fill: '#555' }}>
            {r.label}
          </text>
        </g>
      ))}
      <g clipPath={`url(#${clip})`}>
        {segs.map((seg, i) => (
          <path key={i} d={linePath(seg.map((p) => sx(p.m)), seg.map((p) => sy(Math.min(p.c, yMax * 1.2))))} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
        ))}
      </g>
      <line className="cur" x1={sx(s.interval)} x2={sx(s.interval)} y1={top} y2={bot} />
      <circle cx={sx(s.interval)} cy={shownY} r={5.5} fill={finite ? '#333' : TEXT.red} stroke="#fcfcfb" strokeWidth={2} />
      {(!finite || run.perUsefulHour > yMax) && (
        <text className="ax" x={sx(s.interval) + (sx(s.interval) > X1 - 120 ? -8 : 8)} y={top + 14} textAnchor={sx(s.interval) > X1 - 120 ? 'end' : 'start'} style={{ fill: TEXT.red }}>
          {finite ? `off the chart: ${dollars(run.perUsefulHour)}` : 'no useful hours'}
        </text>
      )}
      {[1, 30, 60, 90, 120].map((m) => (
        <text key={m} className="ax ax-m" x={sx(m)} y={204}>
          {m}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={220}>
        minutes between checkpoints
      </text>
    </svg>
  );
}

function TimeBar({ useful, lost, write }: { useful: number; lost: number; write: number }) {
  const w = 552;
  const parts = [
    { label: 'useful work', v: Math.max(0, useful), color: tint(GRAPHIC.green, 0.7) },
    { label: 'redoing lost work and restarting', v: Math.min(1, lost), color: tint(GRAPHIC.red, 0.55) },
    { label: 'writing checkpoints', v: Math.min(1, write), color: tint(GRAPHIC.violet, 0.55) },
  ];
  const total = parts.reduce((a, p) => a + p.v, 0);
  let x = X0;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 46"
      role="img"
      aria-label={`Of every paid GPU-hour: ${share(Math.max(0, useful))} useful work, ${share(Math.min(1, lost))} redoing lost work and restarting, ${share(Math.min(1, write))} writing checkpoints.`}
    >
      {parts.map((p) => {
        const width = total > 0 ? (p.v / Math.max(1, total)) * w : 0;
        const at = x;
        x += width;
        return (
          <g key={p.label}>
            <rect x={at} y={4} width={width} height={22} fill={p.color} />
            {width > 46 && (
              <text x={at + width / 2} y={19} textAnchor="middle" style={{ fontSize: 11, fontWeight: 500, fill: '#222' }}>
                {share(p.v)}
              </text>
            )}
          </g>
        );
      })}
      <text className="ax" x={X0} y={42}>
        how each paid GPU-hour is spent
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 3: the provider's fleet of 1,000 A-class GPUs at Tech Park.

export const FLEET = 1000;
const PROVIDER_HOURS = HOURS;
const CHART_HOURS = 168;

/** Lesson 4.5's plan for an air-cooled A-class at Tech Park. */
const PLAN: Omit<FacilityPlan, 'utilization'> = {
  gpu: 'A',
  cooling: 'air',
  site: SITES.techpark,
  pue: annualPue(SITES.techpark, { cooling: 'air', supplyC: 24 }).pue,
  serverLifeYears: 5,
  facilityLifeYears: 15,
  rate: 0.1,
};

/** Cost of one GPU for one hour when a share `busy` of the fleet's hours are sold (busy GPUs draw full power). */
export function gpuCostPerHour(busy: number): number {
  return gpuHourCost({ ...PLAN, utilization: busy }).perHour;
}

export interface ProviderState {
  reserved: number;
  /** Average on-demand GPUs wanted. */
  onDemand: number;
  /** GPUs spot buyers would take. */
  spot: number;
}

export const PROVIDER_DEFAULTS: ProviderState = { reserved: 500, onDemand: 300, spot: 400 };

export interface ProviderRun extends ProviderResult {
  /** Cost per hour with the fleet's actual load, $. */
  cost: number;
  margin: number;
}

export function providerOf(s: ProviderState): ProviderRun {
  const r = providerEconomics({
    fleet: FLEET,
    reserved: s.reserved,
    onDemandMean: s.onDemand,
    onDemandSwing: 0.3,
    onDemandNoise: 0.1,
    spotDemand: s.spot,
    prices: PRICE,
    costPerGpuHour: 0,
    hours: PROVIDER_HOURS,
  });
  const cost = FLEET * gpuCostPerHour(r.soldShare);
  return { ...r, cost, margin: r.revenuePerHour.total - cost };
}

/** The most on-demand a provider may turn away in challenge c. */
export const TURN_AWAY_LIMIT = 0.01;

/** The best reserved sales (slider grid of 10) at the starting demand that keep turning away within the limit. */
export const BEST_RESERVED = (() => {
  let best = 0;
  let margin = -Infinity;
  for (let r = 0; r <= FLEET; r += 10) {
    const p = providerOf({ ...PROVIDER_DEFAULTS, reserved: r });
    if (p.turnedAway <= TURN_AWAY_LIMIT && p.margin > margin + 1e-9) {
      margin = p.margin;
      best = r;
    }
  }
  return { reserved: best, margin };
})();

/** Challenge c: at the starting demand, the most margin while turning away no more than 1% of on-demand. */
export function providerSolved(s: ProviderState): boolean {
  return s.onDemand === PROVIDER_DEFAULTS.onDemand && s.spot === PROVIDER_DEFAULTS.spot && s.reserved === BEST_RESERVED.reserved;
}

function FleetChart({ s, run }: { s: ProviderState; run: ProviderRun }) {
  const top = 22;
  const bot = 182;
  const yMax = 1100;
  const sx = scale(0, CHART_HOURS, X0, X1);
  const sy = scale(0, yMax, bot, top);
  const hours = run.series.slice(0, CHART_HOURS);
  const xs = hours.map((_, i) => sx(i + 0.5));
  const res = hours.map(() => s.reserved);
  const od = hours.map((h) => s.reserved + h.served);
  const sp = hours.map((h, i) => od[i] + h.spot);
  const want = hours.map((h) => s.reserved + h.onDemand);
  const peakAway = Math.max(0, ...hours.map((h) => h.onDemand - h.served));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 218"
      role="img"
      aria-label={`One week of a 1,000-GPU A-class fleet: ${fmt(s.reserved)} GPUs reserved, on-demand use averaging ${fmt(s.onDemand)} GPUs, spot buyers taking what is left up to ${fmt(s.spot)}. ${run.turnedAway > 0 ? `${share(run.turnedAway)} of on-demand requests are turned away.` : 'No on-demand request is turned away.'}`}
    >
      <text className="ax" x={X0} y={12}>
        A-class GPUs in the fleet, hour by hour
      </text>
      <GridY y={sy} ticks={[0, 250, 500, 750, 1000]} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={areaPath(xs, res.map(sy), xs.map(() => sy(0)))} fill={tint(COLOR.reserved, 0.55)} />
      <path d={areaPath(xs, od.map(sy), res.map(sy))} fill={tint(COLOR.onDemand, 0.6)} />
      <path d={areaPath(xs, sp.map(sy), od.map(sy))} fill={tint(COLOR.spot, 0.45)} />
      <path d={linePath(xs, want.map((v) => sy(Math.min(v, yMax))))} fill="none" stroke="#333" strokeWidth={1.4} strokeDasharray="4 3" />
      <line x1={X0} x2={X1} y1={sy(FLEET)} y2={sy(FLEET)} stroke="#333" strokeWidth={1.5} />
      <text className="ax ax-e" x={X1} y={sy(FLEET) - 5} style={{ fill: '#333' }}>
        fleet: {fmt(FLEET)} GPUs
      </text>
      {peakAway > 0.5 && (
        <text className="ax ax-e" x={X1} y={12} style={{ fill: TEXT.red }}>
          dashed line above the fleet: on demand turned away
        </text>
      )}
      {Array.from({ length: 7 }, (_, d) => (
        <text key={d} className="ax ax-m" x={sx(d * 24 + 12)} y={200}>
          day {d + 1}
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={216}>
        first week of four
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Numbers for the prose.

const ALL_ON_DEMAND = bill(0);
const PEAK_RESERVED = Math.round(NEED_MAX);
const RESERVE_PEAK = bill(PEAK_RESERVED);
const BEST = bill(CHEAPEST.reserved);
const TUNE = JOBS.tune8;
const TRAIN = JOBS.train70;
const TUNE_60 = spotOf({ job: 'tune8', reclaims: 2, interval: 60 });
const TUNE_BEST = cheapestInterval('tune8', 2);
const TUNE_BEST_RUN = spotOf({ job: 'tune8', reclaims: 2, interval: TUNE_BEST.interval });
const TRAIN_BEST = cheapestInterval('train70', 2);
const TRAIN_BEST_RUN = spotOf({ job: 'train70', reclaims: 2, interval: TRAIN_BEST.interval });
const TRAIN_CALM = cheapestInterval('train70', 0.5);
const BASE_PROVIDER = providerOf(PROVIDER_DEFAULTS);
const NO_SPOT = providerOf({ ...PROVIDER_DEFAULTS, spot: 0 });
const BEST_PROVIDER = providerOf({ ...PROVIDER_DEFAULTS, reserved: BEST_RESERVED.reserved });
const PEAK_ON_DEMAND = Math.max(...BASE_PROVIDER.series.map((h) => h.onDemand));
/** Mean spot GPUs, and how many times a day each is reclaimed. */
const MEAN_SPOT = BASE_PROVIDER.series.reduce((a, h) => a + h.spot, 0) / PROVIDER_HOURS;
const RECLAIMS_PER_SPOT_GPU_DAY = (BASE_PROVIDER.reclaimsPerHour * 24) / MEAN_SPOT;
/** The margin-maximizing reservation with no limit on turning customers away. */
const GREEDY = (() => {
  let best = PROVIDER_DEFAULTS;
  let run = BASE_PROVIDER;
  for (let r = 0; r <= FLEET; r += 10) {
    const p = providerOf({ ...PROVIDER_DEFAULTS, reserved: r });
    if (p.margin > run.margin) {
      run = p;
      best = { ...PROVIDER_DEFAULTS, reserved: r };
    }
  }
  return { reserved: best.reserved, run };
})();

export const LESSON_NUMBERS = {
  needMin: NEED_MIN,
  needMax: NEED_MAX,
  allOnDemandTotal: ALL_ON_DEMAND.total,
  peakReserved: PEAK_RESERVED,
  reservePeakTotal: RESERVE_PEAK.total,
  reservePeakPerHour: RESERVE_PEAK.perUsefulHour,
  reservePeakIdle: RESERVE_PEAK.idleReserved / (PEAK_RESERVED * HOURS),
  breakEven: BREAK_EVEN,
  levelAtBreakEven: LEVEL_AT_BREAK_EVEN,
  bestReserved: CHEAPEST.reserved,
  bestPerHour: BEST.perUsefulHour,
  bestSaving: 1 - BEST.perUsefulHour / PRICE.onDemand,
  bestIdle: BEST.idleReserved / (CHEAPEST.reserved * HOURS),
  tuneGpus: TUNE.gpus,
  tuneServers: TUNE.servers,
  tuneStateGB: TUNE.stateBytes / 1e9,
  tuneWriteMin: checkpointMinutes(TUNE),
  trainGpus: TRAIN.gpus,
  trainServers: TRAIN.servers,
  trainStateTB: TRAIN.stateBytes / 1e12,
  trainWriteMin: checkpointMinutes(TRAIN),
  tune60: TUNE_60.perUsefulHour,
  tuneInterruptions: TUNE_60.interruptionsPerDay,
  tuneBestInterval: TUNE_BEST.interval,
  tuneBestCost: TUNE_BEST.cost,
  tuneBestUseful: TUNE_BEST_RUN.usefulShare,
  trainInterruptions: TRAIN_BEST_RUN.interruptionsPerDay,
  trainMinutesBetween: 1440 / TRAIN_BEST_RUN.interruptionsPerDay,
  trainBestInterval: TRAIN_BEST.interval,
  trainBestUseful: TRAIN_BEST_RUN.usefulShare,
  trainBestCost: TRAIN_BEST.cost,
  trainCalmCost: TRAIN_CALM.cost,
  gpuCostBusy: gpuCostPerHour(1),
  baseMargin: BASE_PROVIDER.margin,
  baseFirm: BASE_PROVIDER.firmShare,
  baseRevenue: BASE_PROVIDER.revenuePerHour.total,
  noSpotMargin: NO_SPOT.margin,
  peakOnDemand: PEAK_ON_DEMAND,
  reclaimsPerHour: BASE_PROVIDER.reclaimsPerHour,
  reclaimsPerSpotGpuDay: RECLAIMS_PER_SPOT_GPU_DAY,
  bestProviderReserved: BEST_RESERVED.reserved,
  bestProviderMargin: BEST_PROVIDER.margin,
  bestProviderAway: BEST_PROVIDER.turnedAway,
  greedyReserved: GREEDY.reserved,
  greedyMargin: GREEDY.run.margin,
  greedyAway: GREEDY.run.turnedAway,
};

// ---------------------------------------------------------------------------

export default function Lesson() {
  // Figure 1: the buyer.
  const s1 = useScenario('buyer', { reserved: 0 });
  const R = s1.state.reserved;
  const b = bill(R);
  const odHours = b.onDemandCost / PRICE.onDemand;
  const idleShare = R > 0 ? b.idleReserved / (R * HOURS) : 0;
  const solvedA = reserveSolved(R);
  const statusA =
    R === 0
      ? `With nothing reserved, every GPU-hour costs ${dollars(PRICE.onDemand)}: ${usd(b.total)} for the four weeks.`
      : `At ${fmt(R)} reserved GPUs, the four weeks cost ${usd(b.total)}: ${dollars(b.perUsefulHour)} per used GPU-hour, with ${share(idleShare)} of reserved hours idle. Can a different reservation cost less?`;

  // Figure 2: interruptible hours.
  const s2 = useScenario('spot', SPOT_DEFAULTS);
  const sp = s2.state;
  const run = spotOf(sp);
  const job = JOBS[sp.job];
  const finite = Number.isFinite(run.perUsefulHour);
  const solvedB = intervalSolved(sp);
  const bestNow = cheapestInterval(sp.job, sp.reclaims);
  const statusB =
    sp.job !== 'tune8'
      ? 'Choose the fine-tuning job.'
      : sp.reclaims !== SPOT_DEFAULTS.reclaims
        ? `Set the reclaims back to ${fmt(SPOT_DEFAULTS.reclaims)} per server a day.`
        : `Checkpointing every ${fmt(sp.interval)} minutes, a useful GPU-hour costs ${dollars(run.perUsefulHour)}.`;

  // Figure 3: the provider.
  const s3 = useScenario('provider', PROVIDER_DEFAULTS);
  const pv = s3.state;
  const prov = useMemo(() => providerOf(pv), [pv]);
  const solvedC = providerSolved(pv);
  const statusC =
    pv.onDemand !== PROVIDER_DEFAULTS.onDemand || pv.spot !== PROVIDER_DEFAULTS.spot
      ? `Set on-demand use back to ${fmt(PROVIDER_DEFAULTS.onDemand)} GPUs and spot demand to ${fmt(PROVIDER_DEFAULTS.spot)}.`
      : prov.turnedAway > TURN_AWAY_LIMIT
        ? `At ${fmt(pv.reserved)} reserved, ${fmt(prov.turnedAway * 100, 2)}% of on-demand requests are turned away: more than 1%.`
        : `At ${fmt(pv.reserved)} reserved the fleet earns ${usd(prov.margin)} an hour and turns away ${fmt(prov.turnedAway * 100, 2)}% of on-demand requests. Can it earn more within the limit?`;

  const N = LESSON_NUMBERS;

  return (
    <LessonPage id="compute/5.4">
      <P>
        <a href={lessonHref('compute/5.3')}>Lesson 5.3</a> left a GPU cloud with demand that swings through every day and grows by an uncertain amount every month, on a
        fleet that takes quarters to enlarge (<a href={lessonHref('compute/5.2')}>Lesson 5.2</a>) and costs almost as much idle as busy (
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). Someone has to pay for the hours nobody uses. How the capacity is sold decides who.
      </P>
      <P>
        There is no central auction where GPU-hours clear at one price every hour, as megawatt-hours do in the electricity course. Capacity is sold by the companies that own
        it, mostly in a few standard forms, through private contracts, and through a handful of newer marketplaces. Three forms matter here. <K tone="green">Reserved</K>{' '}
        capacity is committed for a long term, typically a year or more, and paid for every hour whether it is used or not. <K tone="green">On-demand</K> capacity is
        paid for only in the hours it is used, at a higher price, with the understanding that it will be there when asked for. <K tone="green">Interruptible</K>{' '}
        capacity, usually called spot, is the cheapest, because the provider can take it back at short notice. For the A-class 80 GB, our simulated prices are{' '}
        {dollars(PRICE.reserved)}, {dollars(PRICE.onDemand)} and an average of {dollars(PRICE.spot)} per GPU-hour.
      </P>
      <P>
        Start with a buyer: a company running an inference service whose need follows Lesson 5.3’s inference curve at a tenth of its size, between {fmt(N.needMin)} and{' '}
        {fmt(N.needMax)} A-class GPUs over four weeks — rising every afternoon, falling at night and at weekends, and growing a little week by week. It can’t move the work
        to the night: its users ask when they are awake, and <a href={lessonHref('compute/3.4')}>Lesson 3.4</a> showed what happens to their wait when a server runs out
        of room. In the next demonstration, the gray band is the GPUs it reserves, paid for in every hour; above it, in gold, is the need it buys on demand; and where
        the need falls short of the reservation, in red, reserved GPUs sit idle. The lower chart sorts the same four weeks from the busiest hour to the quietest. Choose
        how many GPUs to reserve:
      </P>

      <Figure name="Compute Pricing Laboratory" scenario={s1}>
        <NeedChart reserved={R} />
        <DurationChart reserved={R} />
        <Legend
          items={[
            { label: 'reserved and used', color: tint(COLOR.reserved, 0.55) },
            { label: 'reserved, idle', color: tint(COLOR.idle, 0.4) },
            { label: 'bought on demand', color: tint(COLOR.onDemand, 0.55) },
          ]}
        />
        <Slider label="Reserved GPUs" tone="green" value={R} min={0} max={RESERVE_MAX} onChange={(v) => s1.set({ reserved: v })} display={`${fmt(R)} GPUs`} />
        <Readouts
          items={[
            { label: 'per used GPU-hour', value: dollars(b.perUsefulHour), tone: 'green' },
            { label: 'bill for four weeks', value: usd(b.total), tone: 'green' },
            { label: 'reserved hours idle', value: share(idleShare) },
            { label: 'GPU-hours on demand', value: fmt(odHours) },
          ]}
        />
        <Eq label="Cost per used GPU-hour">
          <span>per used GPU-hour</span>
          <Op>=</Op>
          <Frac
            top={
              <span>
                {usd(b.reservedCost)} reserved + {usd(b.onDemandCost)} on demand
              </span>
            }
            bottom={<span>{fmt(USEFUL)} GPU-hours used</span>}
          />
          <Op>=</Op>
          <K tone="green">{dollars(b.perUsefulHour)}</K>
        </Eq>
      </Figure>

      <P>
        With nothing reserved, every hour is bought on demand and the four weeks cost {usd(N.allOnDemandTotal)}. Reserve enough for the busiest hour, {fmt(N.peakReserved)}{' '}
        GPUs, and the bill rises to {usd(N.reservePeakTotal)}, {dollars(N.reservePeakPerHour)} per used GPU-hour: the reservation is cheaper by the hour, but{' '}
        {share(N.reservePeakIdle)} of its hours sit idle through nights and weekends. The cheapest mix lies in between, and{' '}
        <FigRef to="Compute Pricing Laboratory">the sorted chart</FigRef> shows where. Each extra reserved GPU costs {dollars(PRICE.reserved)} in every hour, and saves{' '}
        {dollars(PRICE.onDemand)} in each hour the need rises above it. So it pays exactly when the need exceeds it in more than {dollars(PRICE.reserved)} ÷{' '}
        {dollars(PRICE.onDemand)} — two-thirds — of the hours.
      </P>

      <Challenge
        id="a"
        question="Choose the reservation that makes the service’s four weeks cheapest."
        solved={solvedA}
        status={statusA}
        success={`Solved. The need is above about ${fmt(N.levelAtBreakEven)} GPUs in exactly two-thirds of the hours, so ${fmt(CHEAPEST.reserved)} reserved GPUs is the cheapest mix: ${usd(BEST.total)} for the four weeks, ${dollars(N.bestPerHour)} per used GPU-hour. One more reserved GPU would be needed in fewer than two-thirds of the hours, and would cost more than it saves.`}
      />

      <P>
        At {fmt(N.bestReserved)} reserved GPUs, a used GPU-hour costs {dollars(N.bestPerHour)}, {share(N.bestSaving)} less than buying everything on demand, even though{' '}
        {share(N.bestIdle)} of the reserved hours go unused. It is the same reasoning a newsstand uses to decide how many papers to stock, and it gives a simple rule: a GPU
        that would be busy more than two-thirds of the time is cheaper reserved, and one busy less than that is cheaper by the hour. The rule comes from the prices; the
        answer comes from the shape of the curve, and that comes from people’s days. A buyer with a flat need would reserve all of it.
      </P>

      <H2>Interruptible hours</H2>
      <P>
        Spot capacity is cheap because it isn’t promised. For a server answering independent requests, or summarizing a batch of documents, a reclaim costs little: the
        work in flight is redone elsewhere. A training job is different. As <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> showed, every GPU in a run takes part in
        every step, so when any one of its servers is taken back, the whole job stops, loses the work done since its last saved checkpoint, and has to restart and reload.
        A checkpoint holds the full training state, about 16 bytes per parameter: {fmt(N.tuneStateGB)} GB for the fine-tuning job of{' '}
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>, which runs on {fmt(N.tuneGpus)} A-class GPUs in {fmt(N.tuneServers)} servers, and {fmt(N.trainStateTB, 2)} TB for
        the pretraining run, on {fmt(N.trainGpus)} GPUs in {fmt(N.trainServers)} servers. At the storage speeds we assume, writing one takes{' '}
        {minutesText(N.tuneWriteMin)} and {minutesText(N.trainWriteMin)}, and restarting takes another {fmt(RESTART_MINUTES)} minutes. In the next demonstration, choose a
        job, how often the provider reclaims each server, and how often the job saves a checkpoint:
      </P>

      <Figure name="Compute Pricing Laboratory · interruptible" scenario={s2}>
        <Segmented
          label="Training job"
          value={sp.job}
          onChange={(v) => s2.set({ job: v })}
          options={[
            { value: 'tune8', label: `Fine-tuning job (${fmt(TUNE.gpus)} GPUs)` },
            { value: 'train70', label: `Pretraining run (${fmt(TRAIN.gpus)} GPUs)` },
          ]}
        />
        <SpotChart s={sp} />
        <TimeBar useful={run.usefulShare} lost={run.lostShare} write={run.writeShare} />
        <Slider
          label="Reclaims per server"
          tone="red"
          value={sp.reclaims}
          min={0}
          max={6}
          step={0.25}
          onChange={(v) => s2.set({ reclaims: v })}
          display={`${fmt(sp.reclaims, 2)} a day`}
        />
        <Slider label="Checkpoint every" tone="teal" value={sp.interval} min={1} max={INTERVAL_MAX} onChange={(v) => s2.set({ interval: v })} display={`${fmt(sp.interval)} min`} />
        <Readouts
          items={[
            { label: 'job interrupted, per day', value: fmt(run.interruptionsPerDay, run.interruptionsPerDay % 1 ? 1 : 0), tone: 'red' },
            { label: 'to write a checkpoint', value: minutesText(run.writeMinutes) },
            { label: 'paid hours that are useful', value: share(run.usefulShare) },
            { label: 'per useful GPU-hour', value: finite ? dollars(run.perUsefulHour) : 'never finishes', tone: 'green' },
          ]}
        />
        <Caption>
          {finite
            ? `Its ${fmt(job.servers)} servers are reclaimed ${fmt(run.interruptionsPerDay, run.interruptionsPerDay % 1 ? 1 : 0)} times a day in all. The cheapest interval here is ${fmt(bestNow.interval)} minutes, at ${dollars(bestNow.cost)} per useful GPU-hour.`
            : `With ${fmt(run.interruptionsPerDay, run.interruptionsPerDay % 1 ? 1 : 0)} interruptions a day, the job loses work faster than it can do it.${Number.isFinite(bestNow.cost) ? ` Its best interval, ${fmt(bestNow.interval)} minutes, gives ${dollars(bestNow.cost)} per useful GPU-hour.` : ''}`}
        </Caption>
      </Figure>

      <P>
        Take the fine-tuning job first. Two reclaims a day for each of its {fmt(N.tuneServers)} servers stop it {fmt(N.tuneInterruptions)} times a day. Saving a checkpoint every hour, a useful
        GPU-hour costs {dollars(N.tune60)}: each interruption throws away half an hour’s work on average. Save more often and less is lost, but more time goes to writing;
        save too often and the writing dominates. The curve is flat at the bottom, so the best interval doesn’t have to be found exactly.
      </P>

      <Challenge
        id="b"
        figure="Compute Pricing Laboratory · interruptible"
        question="At two reclaims per server a day, find the checkpoint interval that makes the fine-tuning job’s interruptible hours cheapest."
        solved={solvedB}
        status={statusB}
        success={`Solved. Around ${fmt(N.tuneBestInterval)} minutes the time spent writing checkpoints balances the work lost to interruptions, and ${share(N.tuneBestUseful)} of paid hours do useful work: ${dollars(N.tuneBestCost)} per useful GPU-hour, well below the ${dollars(PRICE.reserved)} reserved price.`}
      />

      <P>
        Now switch to the pretraining run. Its {fmt(N.trainServers)} servers, reclaimed twice a day each, stop it {fmt(N.trainInterruptions)} times a day, once every{' '}
        {fmt(N.trainMinutesBetween)} minutes on average, and every stop costs {fmt(RESTART_MINUTES)} minutes of restart before any lost work is redone. Even at its best interval of{' '}
        {fmt(N.trainBestInterval)} minutes, only {share(N.trainBestUseful)} of the paid hours do useful work, so a useful hour costs {dollars(N.trainBestCost)}, nearly three
        times the on-demand price. The price per GPU-hour was the same for both jobs; what differed was the physics of the work. Big synchronous runs buy reserved
        capacity for that reason. Even for them, what spot is worth depends on how often the provider needs its GPUs back: at half a reclaim per server a day, the same
        run would pay{' '}
        {dollars(N.trainCalmCost)} per useful hour, less than the reserved price.
      </P>

      <H2>The provider’s side</H2>
      <P>
        Why would a provider reclaim anything? Consider one with {fmt(FLEET)} A-class GPUs at Tech Park, each costing about {dollars(N.gpuCostBusy)} an hour to provide
        when it is busy around the clock (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). It sells reserved contracts. On-demand customers arrive in a daily wave averaging {fmt(PROVIDER_DEFAULTS.onDemand)} GPUs, peaking at {fmt(N.peakOnDemand)} in these
        four weeks, and they expect GPUs whenever they ask, so the provider must keep enough of its fleet free for the afternoon peak. At night those GPUs would sit idle.
        Spot buyers, who would take up to {fmt(PROVIDER_DEFAULTS.spot)}, get them — until on-demand customers want them back. Spot has to be interruptible because it is the same GPUs. In the next
        demonstration, the dashed line is what on-demand customers want, stacked on the reserved GPUs; set the reserved GPUs sold and the two kinds of demand:
      </P>

      <Figure name="Compute Pricing Laboratory · the provider" scenario={s3}>
        <FleetChart s={pv} run={prov} />
        <Legend
          items={[
            { label: 'reserved', color: tint(COLOR.reserved, 0.55) },
            { label: 'on demand, served', color: tint(COLOR.onDemand, 0.6) },
            { label: 'spot', color: tint(COLOR.spot, 0.45) },
            { label: 'on demand, wanted', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Slider label="Reserved GPUs sold" tone="green" value={pv.reserved} min={0} max={FLEET} step={10} onChange={(v) => s3.set({ reserved: v })} display={fmt(pv.reserved)} />
        <Slider label="On-demand use, average" value={pv.onDemand} min={100} max={600} step={10} onChange={(v) => s3.set({ onDemand: v })} display={`${fmt(pv.onDemand)} GPUs`} />
        <Slider label="Spot demand" value={pv.spot} min={0} max={1000} step={50} onChange={(v) => s3.set({ spot: v })} display={`${fmt(pv.spot)} GPUs`} />
        <Readouts
          items={[
            { label: 'revenue per hour', value: usd(prov.revenuePerHour.total), tone: 'green' },
            { label: 'margin per hour', value: usd(prov.margin), tone: prov.margin < 0 ? 'red' : 'green' },
            { label: 'on demand turned away', value: `${fmt(prov.turnedAway * 100, prov.turnedAway > 0 && prov.turnedAway < 0.1 ? 2 : 1)}%`, tone: prov.turnedAway > TURN_AWAY_LIMIT ? 'red' : undefined },
            { label: 'spot GPUs reclaimed per hour', value: fmt(prov.reclaimsPerHour, 1) },
          ]}
        />
        <Caption>
          {`Revenue per hour: reserved ${usd(prov.revenuePerHour.reserved)}, on demand ${usd(prov.revenuePerHour.onDemand)}, spot ${usd(prov.revenuePerHour.spot)}, against costs of ${usd(prov.cost)}. ${share(prov.soldShare)} of the fleet’s hours are sold, ${share(prov.firmShare)} of them as reserved or on-demand hours.`}
        </Caption>
      </Figure>

      <P>
        At the start, with {fmt(PROVIDER_DEFAULTS.reserved)} GPUs reserved, the fleet earns {usd(N.baseRevenue)} an hour and keeps a margin of {usd(N.baseMargin)}. Only {share(N.baseFirm)} of its hours
        are sold firm; spot buyers take the rest. Set spot demand to zero and the same fleet loses {usd(-N.noSpotMargin)} an hour: the buffer that on-demand customers need
        is a cost, and spot turns its quiet hours into revenue. The price spot buyers pay for that is the wave itself — as on-demand use climbs each afternoon, the
        provider takes back {fmt(N.reclaimsPerHour, 1)} GPUs an hour on average, so a spot GPU is taken back about {fmt(N.reclaimsPerSpotGpuDay, 1)} times a day — close to
        the two reclaims per server a day assumed in <FigRef to="Compute Pricing Laboratory · interruptible">the second demonstration</FigRef>, if whole servers are
        taken back together.
      </P>
      <P>
        Each reserved GPU sold earns {dollars(PRICE.reserved)} an hour where a spot GPU earns {dollars(PRICE.spot)}, so selling more reservations raises the margin — until
        the buffer is too thin for the afternoon peak and on-demand customers are turned away.
      </P>

      <Challenge
        id="c"
        figure="Compute Pricing Laboratory · the provider"
        question="With the starting demand, sell the number of reserved GPUs that earns the most margin while turning away no more than 1% of on-demand requests."
        solved={solvedC}
        status={statusC}
        success={`Solved. ${fmt(N.bestProviderReserved)} reserved GPUs earn ${usd(N.bestProviderMargin)} an hour and turn away ${fmt(N.bestProviderAway * 100, 2)}% of on-demand requests; ten more would cross 1%. Without the limit, the margin would peak at ${fmt(N.greedyReserved)} reserved GPUs, ${usd(N.greedyMargin)} an hour, with ${fmt(N.greedyAway * 100, 1)}% of on-demand requests refused.`}
      />

      <P>
        Pushed to {fmt(N.greedyReserved)} reservations, the fleet would earn the most, {usd(N.greedyMargin)} an hour, while refusing {fmt(N.greedyAway * 100, 1)}% of the
        on-demand requests it had implicitly promised to serve. Our model counts only the revenue those requests would have brought; a real customer refused at the
        moment it needs capacity may not come back, which is why providers keep a buffer even when it looks unprofitable on paper.
      </P>

      <H2>Three ways to share the risk of idle hardware</H2>
      <P>
        The three prices aren’t arbitrary markups. Each sells the same physical hour with a different answer to the question this chapter keeps returning to: who pays
        when it goes unused? A reserved buyer takes that risk on, paying for nights and weekends in exchange for the lowest firm price. An on-demand buyer pays the provider
        to carry it, and the premium is what keeps a buffer of idle GPUs ready for the afternoon. A spot buyer gets the leftover hours cheaply and carries a different
        risk, interruption, whose cost depends on how its work survives one: little for independent requests, a great deal for a synchronous training run whose
        checkpoints are large. The physical lessons set every one of those terms — the daily rhythm of users, the size of training state, the way a training run stops
        when one server leaves.
      </P>
      <P>
        All three of our prices were for one kind of GPU in one place. In <a href={lessonHref('compute/5.5')}>the next lesson</a> we let both vary, and see why an A-class
        hour near the users can sell for more than the same hour in a cold valley far away.
      </P>
    </LessonPage>
  );
}
