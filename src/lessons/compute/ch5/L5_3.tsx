import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { DEMAND_DEFAULTS, growthFan, weeklyDemand, type DemandParams, type DemandSeries, type FanPoint } from '../../../engines/compute/demand';
import { annualPue } from '../../../engines/compute/cooling';
import { gpuHourCost } from '../../../engines/compute/facilityCost';
import { SITES } from '../../../model/compute/sites';
import { SEGMENT_COLOR } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The first demonstration: four weeks of hourly demand against a fleet.

export interface DemandState {
  /** Training runs starting per week, on average. */
  runsPerWeek: number;
  batch: 'flexible' | 'fixed';
  /** GPUs in the fleet (A-class equivalents). */
  fleet: number;
}

/** The starting fleet: a little more than the busiest hour, and well away from the first challenge's answer. */
export const START_FLEET = 6000;

export const DEMO_DEFAULTS: DemandState = {
  runsPerWeek: DEMAND_DEFAULTS.trainingPerWeek,
  batch: 'flexible',
  fleet: START_FLEET,
};

/** The fleet slider's step and range. */
export const FLEET_STEP = 100;
export const FLEET_MIN = 2000;
export const FLEET_MAX = 9000;
/** The first challenge's standard: serve at least this share of the GPU-hours demanded. */
export const SERVE_TARGET = 0.999;

export function paramsOf(s: DemandState): DemandParams {
  return {
    ...DEMAND_DEFAULTS,
    trainingPerWeek: s.runsPerWeek,
    batchFlexible: s.batch === 'flexible',
    capacity: s.fleet,
  };
}

export function runDemand(s: DemandState): DemandSeries {
  return weeklyDemand(paramsOf(s));
}

/** Smallest fleet on the slider's grid that serves at least `target` of the GPU-hours demanded (Infinity if none). */
export function smallestFleet(s: DemandState, target = SERVE_TARGET): number {
  for (let f = FLEET_MIN; f <= FLEET_MAX; f += FLEET_STEP) if (1 - runDemand({ ...s, fleet: f }).unmetShare >= target - 1e-12) return f;
  return Infinity;
}

/** The first challenge: with flexible batch and the starting training runs, the smallest fleet that serves 99.9% of demand. */
export function fleetSolved(s: DemandState): boolean {
  if (s.batch !== 'flexible' || s.runsPerWeek !== DEMO_DEFAULTS.runsPerWeek) return false;
  const ok = (f: number) => 1 - runDemand({ ...s, fleet: f }).unmetShare >= SERVE_TARGET - 1e-12;
  return ok(s.fleet) && (s.fleet - FLEET_STEP < FLEET_MIN || !ok(s.fleet - FLEET_STEP));
}

/** GPU-hours each kind of customer used over the run, and their shares. */
export function segmentHours(d: DemandSeries) {
  const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);
  const hours = { inference: sum(d.inference), training: sum(d.training), batch: sum(d.batch), dev: sum(d.dev) };
  const total = hours.inference + hours.training + hours.batch + hours.dev;
  return { hours, total, share: { inference: hours.inference / total, training: hours.training / total, batch: hours.batch / total, dev: hours.dev / total } };
}

/** The hours the fleet was short, and the worst of them. */
export function shortfall(d: DemandSeries) {
  let worst = -1;
  let hours = 0;
  let gpuHours = 0;
  d.unmet.forEach((u, h) => {
    if (u > 1e-6) {
      hours++;
      gpuHours += u;
      if (worst < 0 || u > d.unmet[worst]) worst = h;
    }
  });
  return { hours, gpuHours, worst, worstGpus: worst >= 0 ? d.unmet[worst] : 0 };
}

const sumOf = (a: number[]) => a.reduce((t, x) => t + x, 0);

// ---------------------------------------------------------------------------
// The second demonstration: a year's forecast of the busiest hour.

export interface ForecastState {
  /** Average growth per month, percent. */
  growth: number;
  /** Uncertainty of each month's growth, percent. */
  sigma: number;
  /** Fleet ordered now, GPUs. */
  fleet: number;
}

export const FORECAST_DEFAULTS: ForecastState = { growth: 5, sigma: 4, fleet: 8000 };
export const FORECAST_MONTHS = 12;
export const FORECAST_STEP = 100;
export const FORECAST_MIN = 5000;
export const FORECAST_MAX = 25000;
/** The second challenge: the most risk of running short in month 12 the cloud accepts. */
export const RISK_LIMIT = 0.1;

const BASE = runDemand(DEMO_DEFAULTS);
/** The forecast starts from this month's busiest hour, rounded to a hundred GPUs. */
export const START = Math.round(BASE.peak / 100) * 100;

export function fanOf(s: ForecastState): FanPoint[] {
  const fan = growthFan(START, FORECAST_MONTHS, s.growth / 100, s.sigma / 100, s.fleet);
  // With no uncertainty the chance of a shortfall is simply 0 or 1.
  return fan.map((p) => (Number.isFinite(p.shortfall) ? p : { ...p, shortfall: p.p50 > s.fleet ? 1 : 0 }));
}

/** Chance the busiest hour outgrows the fleet in the last month. */
export function finalRisk(s: ForecastState): number {
  return fanOf(s)[FORECAST_MONTHS].shortfall;
}

/** Smallest fleet on the slider's grid that keeps month-12 risk within the limit (Infinity if none). */
export function safeFleet(growth: number, sigma: number): number {
  for (let f = FORECAST_MIN; f <= FORECAST_MAX; f += FORECAST_STEP) if (finalRisk({ growth, sigma, fleet: f }) <= RISK_LIMIT + 1e-12) return f;
  return Infinity;
}

export function riskSolved(s: ForecastState): boolean {
  const ok = (f: number) => finalRisk({ ...s, fleet: f }) <= RISK_LIMIT + 1e-12;
  return ok(s.fleet) && (s.fleet - FORECAST_STEP < FORECAST_MIN || !ok(s.fleet - FORECAST_STEP));
}

// ---------------------------------------------------------------------------
// Numbers for the prose, all from the engines.

const BASE_SHARES = segmentHours(BASE);
const BASE_AVG = sumOf(BASE.total) / BASE.hours;
const WEEK1_TROUGH = Math.min(...BASE.inference.slice(0, 120));
const TRAINING_MAX = Math.max(...BASE.training);
/** Hours in which three training runs overlap. */
const THREE_RUN_HOURS = BASE.training.filter((t) => t >= 3 * DEMAND_DEFAULTS.trainingSize).length;
/** The first challenge's answer: the smallest fleet that serves 99.9%, where the prose after it stands. */
const FLEX_FLEET = smallestFleet(DEMO_DEFAULTS);
const FLEX = runDemand({ ...DEMO_DEFAULTS, fleet: FLEX_FLEET });
const FLEX_SHORT = shortfall(FLEX);
/** Every hour that fleet is short falls inside the three-run overlap. */
export const SHORT_IN_OVERLAP = FLEX.unmet.every((u, h) => u <= 1e-6 || FLEX.training[h] >= 3 * DEMAND_DEFAULTS.trainingSize);
const NO_TRAINING = runDemand({ ...DEMO_DEFAULTS, fleet: FLEX_FLEET, runsPerWeek: 0 });
const FIXED = runDemand({ ...DEMO_DEFAULTS, fleet: FLEX_FLEET, batch: 'fixed' });
const FIXED_SHORT = shortfall(FIXED);
const FIXED_FLEET = smallestFleet({ ...DEMO_DEFAULTS, batch: 'fixed' });
const FULL_FLEET = smallestFleet(DEMO_DEFAULTS, 1);
const FIXED_UTIL = runDemand({ ...DEMO_DEFAULTS, batch: 'fixed', fleet: FIXED_FLEET }).utilization;

const FAN0 = fanOf(FORECAST_DEFAULTS);
const SAFE = safeFleet(FORECAST_DEFAULTS.growth, FORECAST_DEFAULTS.sigma);
const SAFE_CERTAIN = safeFleet(FORECAST_DEFAULTS.growth, 0);
const SAFE_WIDE = safeFleet(FORECAST_DEFAULTS.growth, 8);
/** Lesson 4.5's yearly cost of one air-cooled A-class at Tech Park, 70% used, 5-year life, 10%. */
const A_YEAR = gpuHourCost({
  gpu: 'A',
  cooling: 'air',
  site: SITES.techpark,
  pue: annualPue(SITES.techpark, { cooling: 'air', supplyC: 24 }).pue,
  utilization: 0.7,
  serverLifeYears: 5,
  facilityLifeYears: 15,
  rate: 0.1,
}).totalYear;
const HEDGE_GPUS = SAFE - FAN0[FORECAST_MONTHS].p50;

export const LESSON_NUMBERS = {
  peak: BASE.peak,
  average: BASE_AVG,
  /** The starting fleet's utilization (it serves everything). */
  startUtil: BASE.utilization,
  startUnmet: BASE.unmetShare,
  /** At the first challenge's answer. */
  flexUnmet: FLEX.unmetShare,
  flexShortHours: FLEX_SHORT.hours,
  flexShortWorst: FLEX_SHORT.worstGpus,
  trough: WEEK1_TROUGH,
  trainingMax: TRAINING_MAX,
  threeRunHours: THREE_RUN_HOURS,
  shares: BASE_SHARES.share,
  noTrainingPeak: NO_TRAINING.peak,
  noTrainingUtil: NO_TRAINING.utilization,
  fixedPeak: FIXED.peak,
  fixedUnmet: FIXED.unmetShare,
  fixedShortHours: FIXED_SHORT.hours,
  flexFleet: FLEX_FLEET,
  fixedFleet: FIXED_FLEET,
  fullFleet: FULL_FLEET,
  flexUtil: FLEX.utilization,
  fixedUtil: FIXED_UTIL,
  start: START,
  median12: FAN0[FORECAST_MONTHS].p50,
  p5_12: FAN0[FORECAST_MONTHS].p5,
  p95_12: FAN0[FORECAST_MONTHS].p95,
  risk6: FAN0[6].shortfall,
  risk9: FAN0[9].shortfall,
  risk12: FAN0[12].shortfall,
  safe: SAFE,
  safeCertain: SAFE_CERTAIN,
  safeWide: SAFE_WIDE,
  hedgeGpus: HEDGE_GPUS,
  aYear: A_YEAR,
  hedgeCost: HEDGE_GPUS * A_YEAR,
};

// ---------------------------------------------------------------------------
// Charts.

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const C = { training: SEGMENT_COLOR.training, dev: SEGMENT_COLOR.interactive, inference: SEGMENT_COLOR.inference, batch: SEGMENT_COLOR.batch };

/** Format a GPU count. */
function gpus(n: number): string {
  return `${fmt(n)} GPUs`;
}

/** "Mon 14:00, week 2" for an hour of the four weeks. */
export function hourLabel(h: number): string {
  const day = Math.floor(h / 24);
  return `${DAY_NAMES[day % 7]} ${String(h % 24).padStart(2, '0')}:00, week ${Math.floor(day / 7) + 1}`;
}

function DemandChart({ d, fleet, label }: { d: DemandSeries; fleet: number; label: string }) {
  const H = d.hours;
  const X0 = 58;
  const X1 = 628;
  const TOP = 28;
  const BOT = 236;
  const [lo, hi] = niceDomain(0, Math.max(d.peak, fleet) * 1.04, 4);
  const x = scale(0, H, X0, X1);
  const y = scale(lo, hi, BOT, TOP);
  const xs = Array.from({ length: H }, (_, h) => x(h + 0.5));
  const layers: Array<{ key: keyof typeof C; values: number[] }> = [
    { key: 'training', values: d.training },
    { key: 'dev', values: d.dev },
    { key: 'inference', values: d.inference },
    { key: 'batch', values: d.batch },
  ];
  let lower = Array<number>(H).fill(0);
  const paths = layers.map((l) => {
    const upper = lower.map((v, i) => v + l.values[i]);
    const p = areaPath(xs, upper.map(y), lower.map(y));
    lower = upper;
    return { key: l.key, d: p };
  });
  const over = areaPath(
    xs,
    d.total.map((t) => y(Math.max(t, fleet))),
    d.total.map(() => y(fleet)),
  );
  const weekends = Array.from({ length: H / 168 }, (_, w) => w);
  return (
    <svg className="chart" viewBox="0 0 640 270" role="img" aria-label={label}>
      <text className="ax" x={X0} y={14}>
        GPUs wanted each hour (A-class equivalents)
      </text>
      {weekends.map((w) => (
        <rect key={w} x={x(w * 168 + 120)} y={TOP} width={x(48) - x(0)} height={BOT - TOP} fill="rgba(0,0,0,.035)" />
      ))}
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={C[p.key]} opacity={0.85} />
      ))}
      <path d={over} fill={GRAPHIC.red} opacity={0.75} />
      <line x1={X0} x2={X1} y1={y(fleet)} y2={y(fleet)} stroke="#333" strokeWidth={1.5} strokeDasharray="6 4" />
      <text className="ax ax-e" x={X1} y={y(fleet) - 6} style={{ fill: '#333' }}>
        fleet {fmt(fleet)}
      </text>
      {weekends.map((w) => (
        <text key={w} className="ax ax-m" x={x(w * 168 + 84)} y={254}>
          week {w + 1}
        </text>
      ))}
      {weekends.map((w) => (
        <text key={`we${w}`} className="ax ax-m" x={x(w * 168 + 144)} y={BOT + 12} style={{ fontSize: 10 }}>
          Sat–Sun
        </text>
      ))}
      <line className="base" x1={X0} x2={X1} y1={BOT} y2={BOT} />
    </svg>
  );
}

function FanChart({ fan, fleet, label }: { fan: FanPoint[]; fleet: number; label: string }) {
  const X0 = 58;
  const X1 = 610;
  const TOP = 24;
  const BOT = 196;
  const BAR_TOP = 220;
  const BAR_BOT = 286;
  const top = Math.max(fleet, ...fan.map((p) => p.p95)) * 1.05;
  const [lo, hi] = niceDomain(0, top, 4);
  const x = scale(0, FORECAST_MONTHS, X0, X1);
  const y = scale(lo, hi, BOT, TOP);
  const yb = scale(0, 1, BAR_BOT, BAR_TOP);
  const xs = fan.map((p) => x(p.month));
  const band90 = areaPath(xs, fan.map((p) => y(p.p95)), fan.map((p) => y(p.p5)));
  const band50 = areaPath(xs, fan.map((p) => y(p.p75)), fan.map((p) => y(p.p25)));
  const median = linePath(xs, fan.map((p) => y(p.p50)));
  const bw = ((X1 - X0) / FORECAST_MONTHS) * 0.55;
  return (
    <svg className="chart" viewBox="0 0 640 316" role="img" aria-label={label}>
      <text className="ax" x={X0} y={12}>
        GPUs wanted at the busiest hour
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={band90} fill={GRAPHIC.gray} opacity={0.16} />
      <path d={band50} fill={GRAPHIC.gray} opacity={0.26} />
      <path d={median} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      <line x1={X0} x2={X1} y1={y(fleet)} y2={y(fleet)} stroke="#333" strokeWidth={1.5} strokeDasharray="6 4" />
      <text className="ax ax-e" x={X1} y={y(fleet) - 6} style={{ fill: '#333' }}>
        fleet ordered now, {fmt(fleet)}
      </text>
      <text className="ax" x={xs[FORECAST_MONTHS] - 4} y={y(fan[FORECAST_MONTHS].p50) + 16} textAnchor="end">
        median
      </text>
      <text className="ax ax-e" x={X0 + 4} y={BAR_TOP - 6} style={{ textAnchor: 'start' }}>
        Chance the busiest hour outgrows the fleet
      </text>
      <line className="base" x1={X0} x2={X1} y1={BAR_BOT} y2={BAR_BOT} />
      <line className="gl" x1={X0} x2={X1} y1={yb(RISK_LIMIT)} y2={yb(RISK_LIMIT)} />
      <text className="ax ax-e" x={X0 - 6} y={yb(RISK_LIMIT) + 4}>
        10%
      </text>
      <text className="ax ax-e" x={X0 - 6} y={yb(1) + 4}>
        100%
      </text>
      {fan.slice(1).map((p) => (
        <rect key={p.month} x={x(p.month) - bw / 2} width={bw} y={yb(p.shortfall)} height={BAR_BOT - yb(p.shortfall)} fill={p.shortfall > RISK_LIMIT ? GRAPHIC.red : GRAPHIC.gray} opacity={0.8} />
      ))}
      {fan.map((p) => (
        <text key={p.month} className="ax ax-m" x={x(p.month)} y={302}>
          {p.month === 0 ? 'now' : p.month}
        </text>
      ))}
      <text className="ax ax-e" x={X1 + 24} y={302}>
        months
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('demand', DEMO_DEFAULTS);
  const st = s1.state;
  const d = useMemo(() => runDemand(st), [st]);
  const shares = segmentHours(d);
  const short = shortfall(d);
  const average = sumOf(d.total) / d.hours;
  const solved1 = useMemo(() => fleetSolved(st), [st]);
  const served = 1 - d.unmetShare;

  let caption: string;
  if (short.hours === 0 && d.batchUnplaced < 1) caption = `The fleet serves every GPU-hour wanted and is busy ${pct(d.utilization, 1)} of the time.`;
  else {
    const h = short.worst;
    const parts = h >= 0 ? `At the worst hour, ${hourLabel(h)}, inference wants ${fmt(d.inference[h])}, training ${fmt(d.training[h])}, developers ${fmt(d.dev[h])} and batch ${fmt(d.batch[h])}.` : '';
    caption = `The fleet is short in ${fmt(short.hours)} hour${short.hours === 1 ? '' : 's'}, by up to ${gpus(short.worstGpus)}. ${parts}${d.batchUnplaced >= 1 ? ` ${fmt(d.batchUnplaced)} GPU-hours of batch work never found room.` : ''}`;
  }

  const status1 =
    st.batch !== 'flexible'
      ? 'Let batch work run whenever there is room first.'
      : st.runsPerWeek !== DEMO_DEFAULTS.runsPerWeek
        ? `Set the training runs back to ${fmt(DEMO_DEFAULTS.runsPerWeek, 2)} a week first.`
        : served < SERVE_TARGET - 1e-12
          ? `${fmt(st.fleet)} GPUs serve ${pct(served, 3)} of the GPU-hours wanted: short of 99.9%.`
          : `${fmt(st.fleet)} GPUs serve ${pct(served, 3)} of the GPU-hours wanted. Could the fleet be smaller?`;

  const s2 = useScenario('forecast', FORECAST_DEFAULTS);
  const fs = s2.state;
  const fan = useMemo(() => fanOf(fs), [fs]);
  const end = fan[FORECAST_MONTHS];
  const firstRisky = fan.find((p) => p.shortfall > RISK_LIMIT);
  const solved2 = riskSolved(fs);
  const status2 =
    end.shortfall > RISK_LIMIT + 1e-12
      ? `With ${fmt(fs.fleet)} GPUs the chance of running short in month 12 is ${pct(end.shortfall, 1)}.`
      : `${fmt(fs.fleet)} GPUs keep the risk at ${pct(end.shortfall, 1)}. Could the fleet be smaller?`;

  const N = LESSON_NUMBERS;

  return (
    <LessonPage id="compute/5.3">
      <P>
        The previous lesson followed accelerators from the wafer to the data center and found that supply arrives slowly: a quarter at a time, at the pace of whichever
        stage is scarcest. This lesson turns to the other side of the market. Who wants GPU-hours, and when? We’ll look at one GPU cloud’s customers, hour by hour, and
        then at the question every cloud has to answer long before those hours arrive: how much capacity to have.
      </P>
      <P>
        Its fleet and its demand are both counted in the A-class equivalents of <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>: each customer’s work is measured by
        the A-class GPUs it would take, so a B-class GPU in the fleet counts as two to three of them, depending on the work. The demand is simulated, but each of its four shapes comes from something the earlier chapters measured. Inference answers
        people, so it follows their days: busiest in the afternoon, quietest before dawn, lower at weekends, and it must be served at once, close to its users, with
        the headroom of <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>. Developers testing their models work office hours. A training run, as{' '}
        <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> found, wants a large block of GPUs all at once, every one of them for every step, for days on end. And batch
        work, like the overnight summarization of Lesson 3.4, has nobody waiting on it: it can run whenever there is room.
      </P>
      <P>
        In the next demonstration, the colored bands are the GPUs each kind of customer wants in each hour of four simulated weeks, stacked, starting on a Monday; weekends
        are shaded. The dashed line is the fleet, and demand above it is red. In this model that demand goes unserved: those customers wait, or take their work
        elsewhere. Change the training runs, when batch work may run, and the size of the fleet:
      </P>

      <Figure name="Compute Demand Forecaster" scenario={s1}>
        <DemandChart
          d={d}
          fleet={st.fleet}
          label={`Four weeks of hourly demand against a fleet of ${fmt(st.fleet)} GPUs. The busiest hour wants ${fmt(d.peak)} GPUs and the average ${fmt(average)}; the fleet is busy ${pct(d.utilization, 1)} of the time and ${pct(d.unmetShare, 2)} of the GPU-hours wanted go unserved.`}
        />
        <Legend
          items={[
            { label: `Inference, ${pct(shares.share.inference)} of GPU-hours`, color: C.inference },
            { label: `Training, ${pct(shares.share.training)}`, color: C.training },
            { label: `Batch, ${pct(shares.share.batch)}`, color: C.batch },
            { label: `Developers, ${pct(shares.share.dev)}`, color: C.dev },
            { label: 'Unserved', color: GRAPHIC.red },
          ]}
        />
        <Readouts
          items={[
            { label: 'busiest hour', value: gpus(d.peak) },
            { label: 'average hour', value: gpus(average) },
            { label: 'fleet busy', value: pct(d.utilization, 1) },
            { label: 'GPU-hours unserved', value: pct(d.unmetShare, 3), tone: d.unmetShare > 0.001 ? 'red' : undefined },
          ]}
        />
        <Segmented
          label="Batch work"
          value={st.batch}
          onChange={(v) => s1.set({ batch: v })}
          options={[
            { value: 'flexible', label: 'Batch runs whenever there is room' },
            { value: 'fixed', label: 'Batch runs as submitted, 09:00–17:00' },
          ]}
        />
        <Slider label="Training runs" value={st.runsPerWeek} min={0} max={2} step={0.25} onChange={(v) => s1.set({ runsPerWeek: v })} display={`${fmt(st.runsPerWeek, 2)} a week`} />
        <Slider label="Fleet" value={st.fleet} min={FLEET_MIN} max={FLEET_MAX} step={FLEET_STEP} onChange={(v) => s1.set({ fleet: v })} display={gpus(st.fleet)} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Inference wants {gpus(DEMAND_DEFAULTS.inferencePeak)} at a weekday’s busiest hour in the first week and grows {fmt(DEMAND_DEFAULTS.growthPerWeek * 100)}% a week; overnight
        it falls to as little as {gpus(N.trough)}, and weekends run 20% lower. Developers add {fmt(DEMAND_DEFAULTS.devGpus)} GPUs in office hours. Training runs of{' '}
        {fmt(DEMAND_DEFAULTS.trainingSize)} GPUs, each lasting {fmt(DEMAND_DEFAULTS.trainingDays)} days, start about three times a month, and this month opens with three of them
        running at once for {fmt(N.threeRunHours)} hours, holding {gpus(N.trainingMax)}. Batch work, {fmt(DEMAND_DEFAULTS.batchPerDay)} GPU-hours a day, fills in wherever the others leave
        room. Over the four weeks, inference takes {pct(N.shares.inference)} of the GPU-hours, training {pct(N.shares.training)}, batch {pct(N.shares.batch)} and developers{' '}
        {pct(N.shares.dev)}.
      </P>
      <P>
        The <K tone="ink">busiest hour</K> wants {gpus(N.peak)}; the average hour, {gpus(N.average)}. The starting fleet of {fmt(DEMO_DEFAULTS.fleet)} is a little bigger
        than the busiest hour, so it serves every GPU-hour wanted, but it is busy only {pct(N.startUtil, 1)} of the time — its utilization, as{' '}
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a> called it. A cloud needn’t serve every last hour, though.
      </P>

      <Challenge
        id="a"
        question={`The busiest hour wants ${gpus(N.peak)}. Predict first: is the smallest fleet that serves 99.9% of the GPU-hours wanted bigger or smaller than that? Then, with batch work running whenever there is room and the training runs at ${fmt(DEMO_DEFAULTS.runsPerWeek, 2)} a week, find that fleet, to the nearest hundred GPUs.`}
        solved={solved1}
        status={status1}
        success={`Solved: ${gpus(st.fleet)}, ${fmt(d.peak - st.fleet)} fewer than the busiest hour, serve ${pct(served, 3)} of the GPU-hours wanted.`}
      />

      <P>
        A fleet smaller than the busiest hour is enough. At {gpus(N.flexFleet)} it turns away {pct(N.flexUnmet, 3)} of the GPU-hours wanted, all of it in{' '}
        {fmt(N.flexShortHours)} hours at the start of the month, when the three training runs overlap, by up to {gpus(N.flexShortWorst)} at the worst of them, and it is
        busy {pct(N.flexUtil, 1)} of the time. Serving those few hours too would take {gpus(N.fullFleet)}, {fmt(N.fullFleet - N.flexFleet)} more, idle the rest of the
        month. Now set the training runs to zero. The busiest hour falls to {gpus(N.noTrainingPeak)}, and the same {fmt(N.flexFleet)} GPUs would be busy only{' '}
        {pct(N.noTrainingUtil, 1)} of the time. Training is the lumpiest demand a cloud sees: it arrives in blocks of a thousand GPUs or more that must all be free at
        once, and a few blocks landing together set the peak.
      </P>

      <H2>Flexible work fills the valleys</H2>
      <P>
        <K tone="teal">Flexibility</K> is worth GPUs. Set the training runs back, and switch batch work to run as submitted, from 09:00 to 17:00: it lands on top of
        inference’s afternoon peak instead of in its valleys. The busiest hour rises to {gpus(N.fixedPeak)}, and the {fmt(N.flexFleet)}-GPU fleet is now short in{' '}
        {fmt(N.fixedShortHours)} hours, turning away {pct(N.fixedUnmet, 2)} of the GPU-hours wanted. To serve 99.9% again it would need {gpus(N.fixedFleet)} instead of {gpus(N.flexFleet)}: {fmt(N.fixedFleet - N.flexFleet)} more GPUs for exactly
        the same work, busy {pct(N.fixedUtil, 1)} of the time instead of {pct(N.flexUtil, 1)}.
      </P>
      <P>
        Electricity grids know this trade well. Demand that can move to the hours when capacity is spare — the demand response of the electricity course’s{' '}
        <a href={lessonHref('3.5')}>Lesson 3.5</a> — saves building capacity for the peak. For a GPU cloud the reward is the same and arguably larger, since a GPU costs
        nearly as much idle as busy (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). That is why clouds sell spare capacity cheaply to work that can wait or be
        interrupted, and why some AI services offer discounts on requests that don’t need an answer right away.
      </P>

      <H2>A year ahead</H2>
      <P>
        Matching a fleet to hourly demand is the easy part, because the fleet can’t change by the hour anyway. GPUs ordered today arrive months from now, as{' '}
        <a href={lessonHref('compute/5.2')}>Lesson 5.2</a> showed, and a data center to put them in takes longer still. So a cloud has to decide now how much capacity it
        will need at its busiest hour a year from now, and demand for AI compute has been growing fast and unevenly. Nor can it look the answer up. An electricity grid’s
        operator forecasts a whole region’s demand; a GPU cloud sees only its own customers, and with no single exchange for GPU-hours (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>), nothing publishes how much compute everyone wants.
      </P>
      <P>
        In the next demonstration, demand at the busiest hour starts at {gpus(START)} — this month’s peak, rounded — and grows by an average rate each month, with each
        month’s growth uncertain and the uncertainty compounding — a <K tone="ink">forecast</K> with a spread. The darker band holds the middle half of the possible outcomes, the lighter one the middle 90%; the dashed
        line is a fleet ordered today; and the bars beneath give the chance that the busiest hour outgrows it, month by month. Change the growth, its uncertainty and the
        fleet:
      </P>

      <Figure name="Compute Demand Forecaster · forecast" scenario={s2}>
        <FanChart
          fan={fan}
          fleet={fs.fleet}
          label={`Forecast of the busiest hour over 12 months, growing ${fmt(fs.growth, 1)}% a month with ${fmt(fs.sigma, 1)}% uncertainty: a median of ${fmt(end.p50)} GPUs in month 12, and a 90% range from ${fmt(end.p5)} to ${fmt(end.p95)}. Against a fleet of ${fmt(fs.fleet)}, the chance of running short in month 12 is ${pct(end.shortfall)}.`}
        />
        <Legend
          items={[
            { label: 'Median', color: '#333', kind: 'line' },
            { label: 'Middle 50%', color: 'rgba(119,119,119,.42)' },
            { label: 'Middle 90%', color: 'rgba(119,119,119,.2)' },
            { label: 'Fleet ordered now', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'median in month 12', value: gpus(end.p50) },
            { label: '1 in 20 chance above', value: gpus(end.p95) },
            { label: 'chance of running short in month 12', value: pct(end.shortfall, 1), tone: end.shortfall > RISK_LIMIT ? 'red' : undefined },
            { label: 'risk first passes 10%', value: firstRisky ? `month ${firstRisky.month}` : 'never' },
          ]}
        />
        <Slider label="Growth" tone="orange" value={fs.growth} min={0} max={10} step={0.5} onChange={(v) => s2.set({ growth: v })} display={`${fmt(fs.growth, 1)}% a month`} />
        <Slider label="Uncertainty" value={fs.sigma} min={0} max={10} step={0.5} onChange={(v) => s2.set({ sigma: v })} display={`± ${fmt(fs.sigma, 1)}% a month`} />
        <Slider label="Fleet ordered now" value={fs.fleet} min={FORECAST_MIN} max={FORECAST_MAX} step={FORECAST_STEP} onChange={(v) => s2.set({ fleet: v })} display={gpus(fs.fleet)} />
      </Figure>

      <P>
        At 5% a month, give or take 4%, the busiest hour’s median after a year is {gpus(N.median12)}, but the 90% range runs from {gpus(N.p5_12)} to {gpus(N.p95_12)}. A
        fleet of {fmt(FORECAST_DEFAULTS.fleet)} GPUs, comfortably bigger than today’s peak, carries a {pct(N.risk6)} chance of running short in month 6, {pct(N.risk9)} in
        month 9 and {pct(N.risk12)} in month 12. Ordering for the median isn’t enough either: half the time, demand comes in above it.
      </P>

      <Challenge
        id="b"
        figure="Compute Demand Forecaster · forecast"
        question="Estimate first, from the readouts: a 10% chance of running short means a fleet that demand outgrows one time in ten, somewhere between the month-12 median and the level it passes only one time in twenty. Then find the smallest fleet, to the nearest hundred GPUs, that keeps the chance of running short in month 12 at 10% or less."
        solved={solved2}
        status={status2}
        success={`Solved. ${fmt(fs.fleet)} GPUs keep the month-12 risk at ${pct(end.shortfall, 1)}, ${fmt(fs.fleet - end.p50)} more than the median forecast of ${fmt(end.p50)}. Those extra GPUs are what the uncertainty costs.`}
      />

      <P>
        At the starting forecast, the answer is {gpus(N.safe)}: about {fmt(Math.round(N.hedgeGpus / 100) * 100)} more than the median. With no uncertainty at all, {gpus(N.safeCertain)}{' '}
        would do; with twice as much, 8% a month, it takes {gpus(N.safeWide)}. At roughly {usd(Math.round(N.aYear / 100) * 100)} a year to own an A-class GPU (
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>), the margin of safety at the starting forecast costs about{' '}
        {usd(Math.round(N.hedgeCost / 1e6))} million a year, and in most of the outcomes much of it will sit idle. Uncertainty is paid for in idle hardware, or in
        customers turned away.
      </P>
      <P>
        Both demonstrations end in the same place. A fleet sized for its busiest hour, and for a forecast that might be wrong, spends much of its life partly idle: in{' '}
        <FigRef to="Compute Demand Forecaster">the first demonstration</FigRef>, the smallest fleet that serves 99.9% of demand is busy only {pct(N.flexUtil)} of the time. The cloud has
        to recover the cost of those idle hours from the busy ones, and the way it does that is with prices — more for capacity guaranteed at the peak, less for work that
        can wait or be taken back. The next lesson looks at those prices: on-demand, reserved and interruptible.
      </P>
    </LessonPage>
  );
}
