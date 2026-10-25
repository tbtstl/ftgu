import { useDeferredValue, useMemo, useState } from 'react';
import {
  Button,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
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
  pct,
  scale,
  usd,
} from '../../../framework';
import {
  commitments,
  hourlyDemand,
  operateWith,
  prepare,
  type Customer,
  type OpsResult,
  type Tier,
} from '../../../engines/compute/cloud';
import { ACCELERATORS, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { WORKLOADS, WORKLOAD_IDS, type WorkloadId } from '../../../model/compute/workloads';
import { confirmResetPart, defaultCloud, designFor, othersAtStart, updateCloud, useCloud, type Basis, type CloudDesign } from '../shared/cloudStore';
import { BasisSwitch, SoFar } from '../shared/SoFar';

// ---------------------------------------------------------------------------
// What the lesson computes from the reader's cloud: a week of each customer's demand at the price
// book's prices, what the fleet serves of it under the operating plan, and the same over twelve
// quarters of growth. All of it comes from the capstone engine (cloud.ts), memoized per design.

/** Colors for customers, by position (always labeled in the legend and table). */
export const CUSTOMER_COLORS = ['#eb9b66', '#b88dc2', '#e75b55', '#8d7b6a', '#c99a1e', '#6cc0b8', '#4590ce', '#6d9c37', '#d0702a', '#ab70b6', '#2a9d90', '#9a9a9a'];

export const TIER_LABEL: Record<Tier, string> = { reserved: 'Reserved', onDemand: 'On demand', spot: 'Spot' };

/** Short labels for a new customer's work. */
export const WORK_LABEL: Record<WorkloadId, string> = {
  chat70: 'Chat',
  code8: 'Code',
  batch8: 'Batch',
  frontier400: 'Frontier',
  train70: 'Training',
  tune8: 'Fine-tuning',
};

/** The round-trip slider's top position stands for "no limit". */
export const RTT_NONE = 101;
export const SIZE_MAX = 3000;
export const SIZE_STEP = 10;
export const QUARTERS = 12;
/** The share of every class of GPU that must be busy for the challenge. */
export const BUSY_TARGET = 0.5;

const HOURS = 168;
const keyOf = (d: CloudDesign) => JSON.stringify([d.fleet, d.customers, d.prices, d.ops], (_, v) => (v === Infinity ? null : v));

export interface WeekView {
  /** Each customer's demand in each hour at its first choice's price, A-class equivalents. */
  series: number[][];
  totals: number[];
  served: number[];
  ops: OpsResult;
  /** Average hourly demand and the busiest hour. */
  average: number;
  peak: number;
  peakHour: number;
  /** Share of the week's demand served. */
  servedShare: number;
  /** What each customer wants in an average hour of the week (weekends included), before price. */
  wants: number[];
  ctx: ReturnType<typeof prepare>;
}

const weekCache = new Map<string, WeekView>();
/** The design's week (memoized). */
export function weekView(d: CloudDesign): WeekView {
  const key = keyOf(d);
  const hit = weekCache.get(key);
  if (hit) return hit;
  const ctx = prepare(d.customers, d.prices, d.fleet);
  const ops = operateWith(ctx, d.ops);
  const series = ctx.off.map((o) => {
    const share = o.choices[0]?.share ?? 0;
    return Array.from({ length: HOURS }, (_, h) => share * hourlyDemand(o.customer, h));
  });
  const totals = Array.from({ length: HOURS }, (_, h) => series.reduce((s, x) => s + x[h], 0));
  const served = ops.hours.map((h) => h.owned + h.rented + h.burst);
  const sumD = ops.hours.reduce((s, h) => s + h.demand, 0);
  const sumU = ops.hours.reduce((s, h) => s + h.unmet, 0);
  let peakHour = 0;
  for (let h = 1; h < HOURS; h++) if (totals[h] > totals[peakHour]) peakHour = h;
  const wants = d.customers.map((c) => Array.from({ length: HOURS }, (_, h) => hourlyDemand(c, h)).reduce((s, x) => s + x, 0) / HOURS);
  const v: WeekView = {
    series,
    totals,
    served,
    ops,
    average: totals.reduce((s, x) => s + x, 0) / HOURS,
    peak: totals[peakHour],
    peakHour,
    servedShare: sumD > 0 ? 1 - sumU / sumD : 1,
    wants,
    ctx,
  };
  if (weekCache.size > 300) weekCache.clear();
  weekCache.set(key, v);
  return v;
}

/** The GPU classes the fleet owns, with how busy each was over the week. */
export function busyByClass(d: CloudDesign): Array<{ gpu: GpuId; busy: number }> {
  const w = weekView(d);
  return GPU_IDS.filter((g) => d.fleet.gpus[g] > 0).map((g) => ({ gpu: g, busy: w.ops.utilization[g] }));
}

/** The challenge: every class of GPU the fleet owns at least half busy over the week. */
export function fillSolved(d: CloudDesign): boolean {
  const b = busyByClass(d);
  return b.length > 0 && b.every((x) => x.busy >= BUSY_TARGET - 1e-9);
}

export interface GrowthView {
  /** Each customer's average demand in each quarter, A-class equivalents. */
  series: number[][];
  totals: number[];
  served: number[];
  servedShare: number[];
}

const growthCache = new Map<string, GrowthView>();
/** Twelve quarters of each customer growing at its median rate against the same fleet (memoized). */
export function growthView(d: CloudDesign): GrowthView {
  const key = keyOf(d);
  const hit = growthCache.get(key);
  if (hit) return hit;
  const ctx = prepare(d.customers, d.prices, d.fleet);
  const weekAvg = ctx.off.map((o) => ((o.choices[0]?.share ?? 0) * Array.from({ length: HOURS }, (_, h) => hourlyDemand(o.customer, h)).reduce((s, x) => s + x, 0)) / HOURS);
  const series = d.customers.map((c, i) => Array.from({ length: QUARTERS }, (_, q) => weekAvg[i] * (1 + c.growth) ** q));
  const totals = Array.from({ length: QUARTERS }, (_, q) => series.reduce((s, x) => s + x[q], 0));
  const served: number[] = [];
  const servedShare: number[] = [];
  for (let q = 0; q < QUARTERS; q++) {
    const r = operateWith(ctx, d.ops, { demandScale: d.customers.map((c) => (1 + c.growth) ** q) });
    const dem = r.hours.reduce((s, h) => s + h.demand, 0);
    const un = r.hours.reduce((s, h) => s + h.unmet, 0);
    served.push((dem - un) / HOURS);
    servedShare.push(dem > 0 ? 1 - un / dem : 1);
  }
  const v = { series, totals, served, servedShare };
  if (growthCache.size > 200) growthCache.clear();
  growthCache.set(key, v);
  return v;
}

/** A new customer of the given work, with its default customer's shape and a modest size. */
export function newCustomer(workload: WorkloadId, existing: Customer[], stamp = Date.now()): Customer {
  const tmpl = defaultCloud().customers.find((c) => c.workload === workload)!;
  const count = existing.filter((c) => c.workload === workload).length + 1;
  let id = `n${stamp.toString(36)}`;
  let k = 0;
  while (existing.some((c) => c.id === id)) id = `n${stamp.toString(36)}${++k}`;
  return { ...tmpl, id, name: `${WORKLOADS[workload].name} customer ${count}`, size: 100 };
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Hour of the day of the week's busiest hour ("15:00"). */
function whenOf(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

/** “2,093” for A-class equivalents. */
const aeq = (x: number) => fmt(x);

// Numbers the prose quotes, from the starting design.
const START = defaultCloud();
const START_WEEK = weekView(START);
const START_GROWTH = growthView(START);
const startOffer = (workload: WorkloadId) => START_WEEK.ctx.off.find((o) => o.customer.workload === workload)!;
const CHAT = startOffer('chat70');
const CODE = startOffer('code8');

/** The document processor's size that solves the challenge from the starting design (smallestFill(), checked in the tests). */
export const FILL_ANSWER = 1130;

/** Smallest Document processor size (on the slider's grid) that solves the challenge from the starting design. */
export function smallestFill(base: CloudDesign = START, id = 'c6'): number {
  for (let s = 0; s <= SIZE_MAX; s += SIZE_STEP) {
    const d = { ...base, customers: base.customers.map((c) => (c.id === id ? { ...c, size: s } : c)) };
    if (fillSolved(d)) return s;
  }
  return Infinity;
}

const withSize = (d: CloudDesign, id: string, size: number): CloudDesign => ({ ...d, customers: d.customers.map((c) => (c.id === id ? { ...c, size } : c)) });

// The challenge: the frontier lab's 400B model can't run on an L-class card at all. Does its growth
// leave the L-class idle? (No: its reserved GPUs push other customers' work down onto it.)

/** The challenge's customer, the frontier lab. */
export const SPILL_ID = 'c3';
/** The share of the week the L-class must be busy. */
export const SPILL_TARGET = 0.3;

const json = (x: unknown) => JSON.stringify(x, (_, v) => (v === Infinity ? null : v));

/** Whether the customers are the starting six, with at most one customer's size changed. */
export function onlySizeChanged(customers: Customer[], id: string): boolean {
  const start = defaultCloud().customers;
  return customers.length === start.length && start.every((c, i) => customers[i]?.id === c.id && json({ ...customers[i], size: c.id === id ? c.size : customers[i].size }) === json(c));
}

/** Challenge: the starting fleet, prices and plan, the starting customers but a bigger frontier lab, and the L-class busy at least 30% of the week. */
export function spillSolved(d: CloudDesign): boolean {
  return othersAtStart(d, 'customers') && onlySizeChanged(d.customers, SPILL_ID) && weekView(d).ops.utilization.L >= SPILL_TARGET - 1e-9;
}

/** The smallest frontier lab (on the slider's grid) that solves the challenge from the starting design. */
export function smallestSpill(): number {
  for (let s = 0; s <= SIZE_MAX; s += SIZE_STEP) if (spillSolved(withSize(START, SPILL_ID, s))) return s;
  return Infinity;
}

/** The customers whose work runs on L-class GPUs in a design's week, most first. */
export function onTheL(d: CloudDesign): Customer[] {
  const by = weekView(d).ops.gpuHoursBy;
  return d.customers.filter((c) => (by[c.id]?.L ?? 0) > 1).sort((a, b) => by[b.id].L - by[a.id].L);
}

/** B-class GPUs held for the model trainer. */
export function trainerB(d: CloudDesign): number {
  return commitments(weekView(d).ctx)
    .list.filter((c) => c.customer === 'c4' && c.gpu === 'B')
    .reduce((t, c) => t + c.gpus, 0);
}

/** The frontier lab's size that answers the challenge (smallestSpill(), checked in the tests). */
export const SPILL_ANSWER = 520;
const SPILLED = withSize(START, SPILL_ID, SPILL_ANSWER);
const FILLED = weekView(withSize(START, 'c6', FILL_ANSWER));
const TRAINER_SPOT = weekView({ ...START, customers: START.customers.map((c) => (c.workload === 'train70' ? { ...c, tier: 'spot' as const } : c)) });

export const LESSON_NUMBERS = {
  /** Before price: the customers' sizes (an average weekday hour), and their average over the whole week. */
  sizes: START.customers.reduce((s, c) => s + c.size, 0),
  wants: START_WEEK.wants.reduce((s, x) => s + x, 0),
  /** A-class hours of work an L-class hour does: batch summaries, and fine-tuning (its best). */
  batchL: START_WEEK.ctx.prod.batch8.L,
  tuneL: START_WEEK.ctx.prod.tune8.L,
  average: START_WEEK.average,
  peak: START_WEEK.peak,
  peakWhen: whenOf(START_WEEK.peakHour),
  servedShare: START_WEEK.servedShare,
  busy: START_WEEK.ops.utilization,
  chatB: CHAT.choices.find((c) => c.gpu === 'B')!.price,
  chatA: CHAT.choices.find((c) => c.gpu === 'A')!.price,
  chatShareB: CHAT.choices.find((c) => c.gpu === 'B')!.share,
  chatShareA: CHAT.choices.find((c) => c.gpu === 'A')!.share,
  chatServed: START_WEEK.ops.served[CHAT.customer.id],
  codeServed: START_WEEK.ops.served[CODE.customer.id],
  fillChat: FILLED.ops.served[CHAT.customer.id],
  fillCode: FILLED.ops.served[CODE.customer.id],
  spotShare: TRAINER_SPOT.servedShare,
  spotChat: TRAINER_SPOT.ops.served[CHAT.customer.id],
  committedB: commitments(START_WEEK.ctx).list.filter((c) => c.gpu === 'B').reduce((t, c) => t + c.gpus, 0),
  q12Share: START_GROWTH.servedShare[QUARTERS - 1],
  demandGrowth: START_GROWTH.totals[QUARTERS - 1] / START_GROWTH.totals[0],
  /** The challenge's answer: the L-class's use, who runs on it, and the trainer's B-class GPUs before and after. */
  spillL: weekView(SPILLED).ops.utilization.L,
  spillOnL: onTheL(SPILLED).map((c) => c.id),
  trainerBStart: trainerB(START),
  trainerBSpill: trainerB(SPILLED),
  docSize: START.customers.find((c) => c.id === 'c6')!.size,
  labSize: START.customers.find((c) => c.id === SPILL_ID)!.size,
};

// ---------------------------------------------------------------------------
// The customer table doubles as the first demonstration's customer picker.

/** Header and six rows, and a sliver of a seventh to show that more scroll into view. */
const TABLE_MAX_PX = 266;
const pickStyle = (on: boolean) =>
  ({
    appearance: 'none',
    border: 0,
    padding: 0,
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    textDecoration: on ? 'underline solid' : 'underline dotted',
    textDecorationThickness: 1,
    textUnderlineOffset: '0.25em',
  }) as const;

// ---------------------------------------------------------------------------
// Charts.

const X0 = 56;
const X1 = 628;

function WeekChart({ view, customers, ariaLabel }: { view: WeekView; customers: Customer[]; ariaLabel: string }) {
  const [y0, y1] = niceDomain(0, Math.max(10, ...view.totals, ...view.served), 4);
  const x = scale(0, HOURS, X0, X1);
  const y = scale(y0, y1, 164, 24);
  const xs = Array.from({ length: HOURS + 1 }, (_, h) => x(h));
  // Each hour's value is drawn flat across the hour (repeat the last for the right edge).
  const ext = (a: number[]) => [...a, a[a.length - 1] ?? 0];
  let lower = Array<number>(HOURS).fill(0);
  const areas = view.series.map((s, i) => {
    const upper = lower.map((v, h) => v + s[h]);
    const d = areaPath(xs, ext(upper).map(y), ext(lower).map(y));
    lower = upper;
    return { d, color: CUSTOMER_COLORS[i % CUSTOMER_COLORS.length], name: customers[i]?.name ?? '' };
  });
  const gap = areaPath(xs, ext(view.totals).map(y), ext(view.served.map((s, h) => Math.min(s, view.totals[h]))).map(y));
  return (
    <svg className="chart" viewBox="0 0 640 188" role="img" aria-label={ariaLabel}>
      <defs>
        <pattern id="l72-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={TEXT.red} strokeWidth="2" />
        </pattern>
      </defs>
      <text className="ax" x={X0} y={12}>
        Demand bought at the price book’s prices, A-class equivalents
      </text>
      <text className="ax ax-e" x={X1} y={12}>
        average hour {fmt(view.average)}
      </text>
      {[5, 6].map((d) => (
        <rect key={d} x={x(d * 24)} y={24} width={x(24) - x(0)} height={140} fill="rgba(0,0,0,.035)" />
      ))}
      <GridY y={y} ticks={niceTicks(y0, y1, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      {areas.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} opacity={0.85} />
      ))}
      <path d={gap} fill="url(#l72-hatch)" opacity={0.55} />
      <path d={linePath(xs, ext(view.served).map(y))} fill="none" stroke="#222" strokeWidth={1.8} strokeDasharray="5 3" />
      {DAY.map((d, i) => (
        <text key={d} className="ax ax-m" x={x(i * 24 + 12)} y={182}>
          {d}
        </text>
      ))}
      <line className="cur" x1={x(view.peakHour + 0.5)} x2={x(view.peakHour + 0.5)} y1={24} y2={164} />
      <text className="ax" x={Math.min(x(view.peakHour + 0.5) + 4, 500)} y={36}>
        busiest hour, {fmt(view.peak)}
      </text>
    </svg>
  );
}

function GrowthChart({ view, customers, ariaLabel }: { view: GrowthView; customers: Customer[]; ariaLabel: string }) {
  const [y0, y1] = niceDomain(0, Math.max(10, ...view.totals, ...view.served), 4);
  const x = scale(0, QUARTERS - 1, X0 + 14, X1 - 14);
  const y = scale(y0, y1, 200, 24);
  const xs = Array.from({ length: QUARTERS }, (_, q) => x(q));
  let lower = Array<number>(QUARTERS).fill(0);
  const areas = view.series.map((s, i) => {
    const upper = lower.map((v, q) => v + s[q]);
    const d = areaPath(xs, upper.map(y), lower.map(y));
    lower = upper;
    return { d, color: CUSTOMER_COLORS[i % CUSTOMER_COLORS.length], key: customers[i]?.id ?? String(i) };
  });
  return (
    <svg className="chart" viewBox="0 0 640 240" role="img" aria-label={ariaLabel}>
      <text className="ax" x={X0} y={12}>
        Average demand each quarter, A-class equivalents
      </text>
      <GridY y={y} ticks={niceTicks(y0, y1, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      {areas.map((a) => (
        <path key={a.key} d={a.d} fill={a.color} opacity={0.85} />
      ))}
      <path d={linePath(xs, view.served.map(y))} fill="none" stroke="#222" strokeWidth={2} strokeDasharray="5 3" />
      {view.served.map((s, q) => (
        <circle key={q} cx={x(q)} cy={y(s)} r={3} fill="#222" />
      ))}
      {xs.map((px, q) => (
        <text key={q} className="ax ax-m" x={px} y={218}>
          Q{q + 1}
        </text>
      ))}
      {view.servedShare.map((s, q) =>
        q % 2 === 0 || q === QUARTERS - 1 ? (
          <text key={q} className="ax ax-m" x={xs[q]} y={234} style={{ fill: s < 0.8 ? TEXT.red : undefined }}>
            {pct(s)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const saved = useCloud();
  const [basis, setBasis] = useState<Basis>('start');
  const design = designFor(saved, 'customers', basis);
  const customers = design.customers;
  const [selectedId, setSelected] = useState(customers[0]?.id ?? '');
  const sel = customers.find((c) => c.id === selectedId) ?? customers[0];

  const week = weekView(design);
  // The twelve-quarter view takes ~10 ms; let it trail the sliders.
  const deferred = useDeferredValue(design);
  const growth = useMemo(() => growthView(deferred), [deferred]);
  const site = SITES[design.fleet.site];
  const busy = busyByClass(design);
  const N = LESSON_NUMBERS;

  const edit = (patch: Partial<Customer>) => {
    if (!sel) return;
    updateCloud((d) => ({ ...d, customers: d.customers.map((c) => (c.id === sel.id ? { ...c, ...patch } : c)) }));
  };
  const add = (work: WorkloadId) => {
    if (customers.length >= 12) return;
    const c = newCustomer(work, customers);
    updateCloud((d) => ({ ...d, customers: [...d.customers, c] }));
    setSelected(c.id);
  };
  const remove = () => {
    if (!sel || customers.length <= 1) return;
    const rest = customers.filter((c) => c.id !== sel.id);
    updateCloud((d) => ({ ...d, customers: d.customers.filter((c) => c.id !== sel.id) }));
    setSelected(rest[0].id);
  };

  // The challenge.
  const solved = spillSolved(design);
  const lab = customers.find((c) => c.id === SPILL_ID);
  const status = !othersAtStart(design, 'customers')
    ? 'The question is about the starting fleet, prices and plan: switch the demonstration to the starting design.'
    : !lab || !onlySizeChanged(customers, SPILL_ID)
      ? 'Start from the starting customers — Reset puts them back — and change only the frontier lab’s size.'
      : `The frontier lab wants ${aeq(lab.size)} A-eq in an average weekday hour, and the L-class is ${pct(week.ops.utilization.L)} busy.`;
  const fallen = onTheL(design).map((c) => `the ${c.name.charAt(0).toLowerCase()}${c.name.slice(1)}`);
  const fallenText = fallen.length > 1 ? `${fallen.slice(0, -1).join(', ')} and ${fallen[fallen.length - 1]}` : fallen[0] ?? 'other customers';
  const success = `Solved: the L-class is ${pct(week.ops.utilization.L)} busy, yet none of the frontier lab’s work runs there. Its reserved GPUs, held for its busiest hour, take B-class GPUs from the model trainer, which keeps ${fmt(trainerB(design))} of the ${fmt(N.trainerBStart)} it had; the trainer’s work moves to A-class GPUs, and customers who were using those fall back to the L-class: ${fallenText}. Growth anywhere spills down to whatever capacity is idle.`;

  const picker = (
    <Segmented
      label="Customer"
      value={sel?.id ?? ''}
      onChange={setSelected}
      options={customers.map((c, i) => ({
        value: c.id,
        label: (
          <span>
            <span className="sw" style={{ background: CUSTOMER_COLORS[i % CUSTOMER_COLORS.length], marginRight: 6, verticalAlign: '1px' }} />
            {c.name}
          </span>
        ),
      }))}
    />
  );
  const basisSwitch = <BasisSwitch value={basis} onChange={setBasis} own="customers" />;

  const rttValue = sel && Number.isFinite(sel.maxRttMs) ? Math.min(100, Math.max(2, Math.round(sel.maxRttMs))) : RTT_NONE;
  const lastQ = growth.servedShare[QUARTERS - 1];
  const firstShort = growth.servedShare.findIndex((s) => s < 0.8);

  const choiceText = (i: number) => {
    const o = week.ctx.off[i];
    if (!o || !o.choices.length || o.choices[0].share <= 0) return '—';
    return `${ACCELERATORS[o.choices[0].gpu].short}, ${usd(o.choices[0].price, 2)}`;
  };
  const statusText = (i: number) => {
    const o = week.ctx.off[i];
    if (!o) return '';
    return o.reason ?? `${pct(week.ops.served[o.customer.id] ?? 0)} served`;
  };

  const signUp = (
    <>
      <select
        className="tsel"
        aria-label="Sign up a new customer for a kind of work"
        value=""
        disabled={customers.length >= 12}
        onChange={(e) => {
          const w = e.target.value as WorkloadId | '';
          if (w) add(w);
        }}
      >
        <option value="">Sign up a customer…</option>
        {WORKLOAD_IDS.map((w) => (
          <option key={w} value={w}>
            {WORK_LABEL[w]}
          </option>
        ))}
      </select>
      <Button onClick={remove} disabled={customers.length <= 1} label={`Remove ${sel?.name ?? 'the customer'}`}>
        Remove customer
      </Button>
    </>
  );

  return (
    <LessonPage id="compute/7.2">
      <P>
        <a href={lessonHref('compute/7.1')}>Lesson 7.1</a> built the cloud’s fleet and its building. A fleet earns nothing until someone wants its hours, and this
        lesson gives the cloud its customers. The text describes the starting design — 256 L-class, 1,024 A-class and 256 B-class GPUs at Tech Park, sold at the
        course’s list prices — and so do the demonstrations, until you switch them to your own design, which also brings in any prices or plan you have set in the
        next two lessons. Here is your cloud so far:
      </P>
      <SoFar parts={['fleet', 'prices', 'ops']} />
      <P>
        The cloud starts with six customers, one for each workload of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>: a chat startup, a code tools company, a
        frontier lab, a model trainer, a fine-tuning shop and a document processor. Each is described the way the earlier chapters described demand. Its{' '}
        <K tone="ink">size</K> is the work all its buyers together want in an average weekday hour, before any price is asked, counted in A-class equivalents (A-eq): the
        work one A-class 80 GB GPU does for that workload, the unit of Lesson 7.1’s capacity. Its daily <K tone="ink">swing</K> is the shape of{' '}
        <a href={lessonHref('compute/5.3')}>Lesson 5.3</a>: interactive work follows people’s days, peaking in the afternoon and running 20% lower at weekends, while
        training and batch work run flat. Its <K tone="teal">round-trip limit</K> is how far its users can be from the GPUs (
        <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>), and it decides which sites can serve it at all. Its <K c="price">value</K> is what its buyers will pay for an
        A-eq hour, spread evenly from half to one and a half times the stated figure, as for the buyers of <a href={lessonHref('compute/5.5')}>Lesson 5.5</a>. And its
        product is one of the three of <a href={lessonHref('compute/5.4')}>Lesson 5.4</a>: reserved capacity, held for it and paid for every hour; on-demand hours; or
        interruptible spot hours, for work that can wait. Every figure is simulated.
      </P>
      <P>
        What a customer actually buys depends on the price. It compares the accelerators by what a unit of its own work costs on each (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>), and its buyers who value the work above that cost buy. The prices are the price book’s — the course’s
        simulated list prices until <a href={lessonHref('compute/7.3')}>Lesson 7.3</a> lets you set them. In the next demonstration, the colored bands are the work each
        customer buys in each hour of a week, stacked, at its cheapest accelerator’s price, in the colors beside the customers’ names in the table; the dashed line is what the fleet
        serves of it, run under the cloud’s operating plan (first come, first served, until <a href={lessonHref('compute/7.4')}>Lesson 7.4</a> changes it), and the
        hatched red gap is demand turned away. Choose a customer by its name in the table and change it, or sign up new ones from the demonstration’s footer:
      </P>

      <Figure name="Compute Demand Simulator" onReset={() => confirmResetPart('customers')} actions={signUp}>
        {basisSwitch}
        {sel && (
          <>
            <Segmented
              label="Product the customer buys"
              value={sel.tier}
              onChange={(tier) => edit({ tier })}
              options={(['reserved', 'onDemand', 'spot'] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }))}
            />
            <Slider label="Size" value={sel.size} min={0} max={SIZE_MAX} step={SIZE_STEP} onChange={(v) => edit({ size: v })} display={`${aeq(sel.size)} A-eq`} />
            <Slider label="Daily swing" value={Math.round(sel.swing * 100)} min={0} max={100} step={5} onChange={(v) => edit({ swing: v / 100 })} display={`±${Math.round(sel.swing * 100)}%`} />
            <Slider
              label="Round-trip limit"
              tone="teal"
              value={rttValue}
              min={2}
              max={RTT_NONE}
              onChange={(v) => edit({ maxRttMs: v >= RTT_NONE ? Infinity : v })}
              display={rttValue >= RTT_NONE ? 'no limit' : `${rttValue} ms`}
            />
            <Slider label="Value of its work" tone="green" value={Math.round(sel.value * 10)} min={5} max={80} onChange={(v) => edit({ value: v / 10 })} display={`${usd(sel.value, 2)} per A-eq hour`} />
          </>
        )}
        <WeekChart
          view={week}
          customers={customers}
          ariaLabel={`A week of demand from ${customers.length} customers at ${site.name}: ${aeq(week.average)} A-class equivalents in an average hour, ${aeq(week.peak)} at the busiest hour (${whenOf(week.peakHour)}). The fleet serves ${pct(week.servedShare, 1)} of it.`}
        />
        <Legend
          items={[
            { label: 'Served', color: '#222', kind: 'line' as const, dashed: true },
            { label: 'Turned away', color: TEXT.red },
          ]}
        />
        <Readouts
          items={[
            { label: 'of demand served', value: pct(week.servedShare, 1) },
            ...busy.map((b) => ({ label: `${ACCELERATORS[b.gpu].short} GPUs busy`, value: pct(b.busy) })),
          ]}
        />
        {/* The table is also the customer picker; past six customers it scrolls. */}
        <div style={{ maxHeight: customers.length > 6 ? TABLE_MAX_PX : undefined, overflowY: 'auto' }}>
          <DataTable
            caption="The customers, each a button that chooses it: their work, product, first-choice accelerator and price per A-class-equivalent hour, the share of their buyers who buy at it, and how much of that the fleet served"
            rows={customers.map((c, i) => ({ c, i }))}
            rowKey={(r) => r.c.id}
            rowClass={(r) => (r.c.id === sel?.id ? 'hl' : week.ctx.off[r.i]?.reason ? 'dim' : '')}
            columns={[
              {
                label: 'Customer',
                cell: (r) => (
                  <button type="button" aria-pressed={r.c.id === sel?.id} onClick={() => setSelected(r.c.id)} style={pickStyle(r.c.id === sel?.id)}>
                    <span className="sw" style={{ background: CUSTOMER_COLORS[r.i % CUSTOMER_COLORS.length], marginRight: 6, verticalAlign: '1px' }} />
                    {r.c.name}
                  </button>
                ),
              },
              { label: 'Work', cell: (r) => WORKLOADS[r.c.workload].name },
              { label: 'Product', cell: (r) => TIER_LABEL[r.c.tier] },
              { label: 'First choice', cell: (r) => choiceText(r.i), align: 'right' },
              { label: 'Buys', cell: (r) => pct(week.ctx.off[r.i]?.choices[0]?.share ?? 0), align: 'right' },
              { label: 'Status', cell: (r) => statusText(r.i) },
            ]}
          />
        </div>
      </Figure>

      <P>
        At the start, before price, the six customers want {aeq(N.sizes)} A-eq in an average weekday hour, the demand of Lesson 7.1’s capacity chart, or{' '}
        {aeq(N.wants)} averaged over the whole week, quieter weekends included. At the list prices they buy {aeq(N.average)} in an average hour of the week, rising to{' '}
        {aeq(N.peak)} at the busiest hour, {N.peakWhen} on a weekday, when the chat startup, the code tools company and the frontier lab all peak together. The fleet serves{' '}
        {pct(N.servedShare, 1)} of the week’s demand. Look at the readouts, though: the B-class GPUs are {pct(N.busy.B)} busy, the A-class {pct(N.busy.A)} and the L-class{' '}
        {pct(N.busy.L)}. The cloud is short of one kind of GPU while it has another to spare.
      </P>
      <P>
        The table says why. Every customer’s first choice is the B-class, because it does every one of these jobs most cheaply per unit of work, as{' '}
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a> found: the chat startup pays {usd(N.chatB, 2)} per A-eq hour on a B-class GPU and {usd(N.chatA, 2)} on an A-class
        one. The reserved customers, the frontier lab and the model trainer, have B-class GPUs held for them — enough to cover their busiest hour, every hour of the
        week — and at the start that takes all {fmt(N.committedB)} of them. With the B-class full, only the buyers who will pay the A-class’s price move there —{' '}
        {pct(N.chatShareA)} of the chat startup’s buyers rather than {pct(N.chatShareB)} — so it is served {pct(N.chatServed)} of what it wants, with A-class GPUs still
        idle. And nobody’s work is cheapest on the L-class, the comparative disadvantage of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>: its cards sit almost
        unused. The turned-away demand is a mismatch between the fleet’s mix and its customers, not just a shortage of GPUs.
      </P>

      <H2>Who the cloud can reach</H2>
      <P>
        Some customers can’t be served at all. Choose the code tools company. Its users need replies within 20 ms of round trip, and this fleet’s site, {site.name}, is{' '}
        {site.rttMs} ms from the region’s users.{' '}
        {site.rttMs <= 20 ? (
          <>
            So it qualifies — but tighten the limit below {site.rttMs} ms and the table marks it out of reach: no price wins it back.
          </>
        ) : (
          <>So the table already marks it out of reach: no price wins it back.</>
        )}{' '}
        {design.fleet.site !== 'fernhill' && (
          <>Had Lesson 7.1 put the fleet in Fernhill, 40 ms away, the code tools company would have been out of reach from the start, as Lesson 5.5’s latency limits predicted. </>
        )}
        Work can also be out of reach of the hardware: the frontier lab’s 400B model can’t run on L-class cards at any count (
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>), so a fleet without A- or B-class GPUs can’t sell it anything.
      </P>
      <P>
        A customer’s product matters in a different way. Move the model trainer from reserved to spot and its B-class GPUs are no longer held for it: they join the pool
        the on-demand and spot customers share, and the trainer’s work becomes interruptible, taking what it can get. The chat startup is then served{' '}
        {pct(N.spotChat)} of what it wants, and the cloud {pct(N.spotShare, 1)} of all its demand — though, as Lesson 7.3 will count, spot hours sell for far less than
        reserved ones. Which customers sign up for which product is a decision about who carries the risk of idle hardware, the question{' '}
        <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> kept returning to.
      </P>

      <H2>Filling the idle cards</H2>
      <P>
        Idle GPUs cost nearly as much as busy ones (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>), so a cloud with spare cards looks for customers to fill them. The
        natural ones are flat, flexible and cheap, like the batch work that fills the valleys of <a href={lessonHref('compute/5.3')}>Lesson 5.3</a>. An L-class card does
        only {fmt(N.batchL, 2)} of an A-class hour’s batch work — its best ratio is fine-tuning’s, {fmt(N.tuneL, 2)} (Lesson 3.5) — but batch buyers pay little, don’t
        mind waiting and want the same work around the clock, so it is work an idle card can take. Grow the document processor to {aeq(FILL_ANSWER)} A-eq and the
        L-class is half busy. Read the table as it does, though. Under the starting plan, first come, first served, the batch work asks in a random order like everyone
        else, so in some hours it takes the A-class GPUs the chat startup was falling back on: the chat startup is served {pct(N.fillChat)} of what it wants instead of{' '}
        {pct(N.chatServed)}, and the code tools company {pct(N.fillCode)} instead of {pct(N.codeServed)}. More demand is not automatically more business.
      </P>
      <P>
        What lands on the idle cards depends on more than whose work they can do. Put the document processor back to {aeq(N.docSize)} A-eq and look at the frontier
        lab, whose model no L-class card can run:
      </P>

      <Challenge
        id="a"
        question={`Predict first: if the frontier lab grows, will the L-class cards stay as idle as they are? Then check, on the starting design: grow the frontier lab, and only it, until the L-class is busy at least ${pct(SPILL_TARGET)} of the week — if that can be done.`}
        solved={solved}
        status={status}
        success={success}
      />

      <P>
        They don’t stay idle: at {aeq(SPILL_ANSWER)} A-eq, {(SPILL_ANSWER / N.labSize).toFixed(1)} times its starting size, the frontier lab has pushed the L-class to{' '}
        {pct(N.spillL)} busy. A reserved customer’s growth takes GPUs out of everyone else’s pool in every hour, and each displaced customer moves one step down, until
        the work that will pay the L-class’s price lands there. Whether new demand fills idle cards or crowds out better customers depends on the scheduler and on the
        prices, the subjects of the next two lessons.
      </P>

      <H2>Three years of growth</H2>
      <P>
        The fleet takes quarters to change (<a href={lessonHref('compute/5.2')}>Lesson 5.2</a>), and the customers won’t stand still while it does. Each grows at its own
        expected rate per quarter: the chat startup 6%, the code tools company 5%, the frontier lab 4%, the model trainer and the fine-tuning shop 3%, the document
        processor 2%, all simulated, at the start. In the next demonstration, the bands are each customer’s average demand over twelve quarters if it grows at exactly its expected
        rate; the dashed line is what the same fleet serves each quarter, with the share served beneath. Choose a customer and change its growth:
      </P>

      <Figure name="Compute Demand Simulator · growth">
        {basisSwitch}
        {picker}
        {sel && (
          <Slider
            label="Growth per quarter"
            value={Math.round(sel.growth * 100)}
            min={-5}
            max={20}
            onChange={(v) => edit({ growth: v / 100 })}
            display={`${sel.growth > 0 ? '+' : ''}${Math.round(sel.growth * 100)}%`}
          />
        )}
        <GrowthChart
          view={growth}
          customers={customers}
          ariaLabel={`Twelve quarters of demand growing from ${aeq(growth.totals[0])} to ${aeq(growth.totals[QUARTERS - 1])} A-class equivalents in an average hour; the fleet serves ${pct(growth.servedShare[0])} in the first quarter and ${pct(lastQ)} in the twelfth.`}
        />
        <Readouts
          items={[
            { label: 'demand in Q12 against today', value: `×${fmt(growth.totals[QUARTERS - 1] / Math.max(1e-9, growth.totals[0]), 2)}` },
            { label: 'served in Q12', value: pct(lastQ), tone: lastQ < 0.8 ? 'red' : undefined },
            { label: 'first quarter below 80% served', value: firstShort < 0 ? 'none' : `Q${firstShort + 1}` },
          ]}
        />
      </Figure>

      <P>
        At the starting rates, the customers’ demand grows by {fmt((N.demandGrowth - 1) * 100)}% over the three years, and the fleet, unchanged, serves less of it every
        quarter: {pct(N.servedShare)} today, {pct(N.q12Share)} by the twelfth quarter. Growth is good news only for a cloud that can keep up. And this is only the
        expected path: <a href={lessonHref('compute/5.3')}>Lesson 5.3</a>’s forecast fan put a wide band around every such path, and{' '}
        <a href={lessonHref('compute/7.5')}>Lesson 7.5</a> brings that uncertainty back. Set the chat startup’s growth to zero in{' '}
        <FigRef to="Compute Demand Simulator · growth">this demonstration</FigRef> and the decline slows but doesn’t stop: the others still grow.
      </P>
      <P>
        Every customer here is the sum of the physics the course has covered: a model’s size and its latency promise decide which GPUs can serve it and where; the shape
        of its users’ days decides when it needs them; and its value, set against what each accelerator does for it, decides which GPU it wants. The one thing the cloud
        controls directly is the price it asks. In the next lesson we set it.
      </P>
    </LessonPage>
  );
}
