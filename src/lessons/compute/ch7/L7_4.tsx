import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
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
import {
  commitments,
  hourlyDemand,
  operateWith,
  prepare,
  type HourOps,
  type OpsContext,
  type OpsPlan,
  type OpsResult,
  type Tier,
} from '../../../engines/compute/cloud';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { PRICES } from '../../../model/compute/prices';
import { confirmResetPart, defaultCloud, designFor, updateCloud, useCloud, type Basis, type CloudDesign } from '../shared/cloudStore';
import { BasisSwitch, SoFar } from '../shared/SoFar';

// ---------------------------------------------------------------------------
// The week's conditions: two drivers outside the operator's control, set beside the plan.

export interface Conditions {
  /** Share of the owned GPUs out of service this week (failures and repairs), %. */
  outPct: number;
  /** Demand this week as a share of the customers' forecast, %. */
  demandPct: number;
}

export const NORMAL: Conditions = { outPct: 0, demandPct: 100 };
/** A launch week: demand 80% above forecast, every GPU in service. */
export const LAUNCH: Conditions = { outPct: 0, demandPct: 180 };

/** The controls' grids (the challenges search exactly these). */
export const RENT_A = { max: 512, step: 64 };
export const RENT_B = { max: 256, step: 32 };
const POLICIES: OpsPlan['policy'][] = ['first-come', 'tiered'];

export function optsOf(c: Conditions) {
  return { capacityShare: 1 - c.outPct / 100, demandScale: c.demandPct / 100 };
}

const sameCond = (a: Conditions, b: Conditions) => a.outPct === b.outPct && a.demandPct === b.demandPct;

/** The premium price book's markup: every on-demand price this far above the market's. */
export const PREMIUM = 0.2;

/** A design with the premium price book in place of its on-demand prices (or unchanged). */
export function withPremium(d: CloudDesign, on: boolean): CloudDesign {
  if (!on) return d;
  return { ...d, prices: { ...d.prices, onDemand: { L: PRICES.L.onDemand * (1 + PREMIUM), A: PRICES.A.onDemand * (1 + PREMIUM), B: PRICES.B.onDemand * (1 + PREMIUM) } } };
}

/** Hours of a week in which some rented GPUs are at work. */
export function rentedHours(r: OpsResult): number {
  return r.hours.filter((h) => h.rented > 1e-6).length;
}

// JSON can't hold Infinity, which customers' latency limits may be; null keeps the keys distinct.
const keyOf = (x: unknown) => JSON.stringify(x, (_, v) => (v === Infinity ? null : v));

const ctxCache = new Map<string, OpsContext>();
/** Everything about a design's fleet, customers and prices that doesn't change hour to hour (memoized). */
export function contextOf(d: CloudDesign): OpsContext {
  const key = keyOf([d.fleet, d.customers, d.prices]);
  let c = ctxCache.get(key);
  if (!c) {
    if (ctxCache.size > 40) ctxCache.clear();
    c = prepare(d.customers, d.prices, d.fleet);
    ctxCache.set(key, c);
  }
  return c;
}

const weekCache = new Map<string, OpsResult>();
/** A week (or its first `hours` hours) of operations under a plan and conditions (memoized). */
export function runWeek(d: CloudDesign, ops: OpsPlan, cond: Conditions, hours = 168): OpsResult {
  const key = keyOf([d.fleet, d.customers, d.prices, ops, cond, hours]);
  let r = weekCache.get(key);
  if (!r) {
    if (weekCache.size > 800) weekCache.clear();
    r = operateWith(contextOf(d), ops, { ...optsOf(cond), hours });
    weekCache.set(key, r);
  }
  return r;
}

const bestCache = new Map<string, { ops: OpsPlan; profit: number }>();
/**
 * The most profitable plan on the controls' grid — both policies, every rental of A- and B-class GPUs
 * the sliders allow, bursting on and off — for a design under some conditions (memoized; ~324 weeks).
 */
export function bestPlan(d: CloudDesign, cond: Conditions): { ops: OpsPlan; profit: number } {
  const key = keyOf([d.fleet, d.customers, d.prices, cond]);
  const hit = bestCache.get(key);
  if (hit) return hit;
  const ctx = contextOf(d);
  // Bursting only ever acts when an on-demand price is above the market's; otherwise it changes nothing, so skip it.
  const bursts = GPU_IDS.some((g) => d.prices.onDemand[g] > PRICES[g].onDemand) ? [false, true] : [false];
  let best = { ops: { policy: 'tiered', rented: { L: 0, A: 0, B: 0 }, burst: false } as OpsPlan, profit: -Infinity };
  for (const policy of POLICIES)
    for (let a = 0; a <= RENT_A.max; a += RENT_A.step)
      for (let b = 0; b <= RENT_B.max; b += RENT_B.step)
        for (const burst of bursts) {
          const ops: OpsPlan = { policy, rented: { L: 0, A: a, B: b }, burst };
          const p = operateWith(ctx, ops, optsOf(cond)).profit;
          if (p > best.profit + 1e-6) best = { ops, profit: p };
        }
  if (bestCache.size > 40) bestCache.clear();
  bestCache.set(key, best);
  return best;
}

/** A challenge: under the target conditions, a plan earning (to within a dollar) the most any plan on the grid earns. */
export function planSolved(d: CloudDesign, ops: OpsPlan, cond: Conditions, target: Conditions): boolean {
  if (!sameCond(cond, target)) return false;
  return runWeek(d, ops, cond).profit >= bestPlan(d, target).profit - 1;
}

/** Work wanted at each customer's first-choice price, summed over the first `hours` hours (A-class equivalents). */
function wantedUpTo(ctx: OpsContext, i: number, hours: number, demandScale: number): number {
  const o = ctx.off[i];
  const share = o.choices[0]?.share ?? 0;
  let w = 0;
  for (let h = 0; h < hours; h++) w += share * hourlyDemand(o.customer, h) * demandScale;
  return w;
}

export interface HourDetail {
  row: HourOps;
  customers: Array<{ id: string; name: string; tier: Tier; wanted: number; served: number; revenue: number }>;
  /** Owned GPUs busy this hour, by type. */
  busy: Record<GpuId, number>;
}

/** Who got what in one hour of the week: the difference between the week run to the end of the hour and to its start. */
export function hourDetail(d: CloudDesign, ops: OpsPlan, cond: Conditions, hour: number): HourDetail {
  const ctx = contextOf(d);
  const after = runWeek(d, ops, cond, hour + 1);
  const before = hour > 0 ? runWeek(d, ops, cond, hour) : null;
  const scale = cond.demandPct / 100;
  const customers = ctx.off.map((o, i) => {
    const id = o.customer.id;
    const wAfter = wantedUpTo(ctx, i, hour + 1, scale);
    const wBefore = hour > 0 ? wantedUpTo(ctx, i, hour, scale) : 0;
    const served = after.served[id] * wAfter - (before ? before.served[id] * wBefore : 0);
    const revenue = after.revenueBy[id] - (before ? before.revenueBy[id] : 0);
    return { id, name: o.customer.name, tier: o.customer.tier, wanted: wAfter - wBefore, served: Math.max(0, served), revenue };
  });
  const busy = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) busy[g] = Math.max(0, after.utilization[g] * d.fleet.gpus[g] * (hour + 1) - (before ? before.utilization[g] * d.fleet.gpus[g] * hour : 0));
  return { row: after.hours[hour], customers, busy };
}

/** Share of the week's wanted work turned away. */
export function turnedAway(r: OpsResult): number {
  const want = r.hours.reduce((s, h) => s + h.demand, 0);
  return want > 0 ? r.hours.reduce((s, h) => s + h.unmet, 0) / want : 0;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes: the starting design (7.1–7.3 untouched), from the engines.

const START = defaultCloud();
const FIRST_COME: OpsPlan = { policy: 'first-come', rented: { L: 0, A: 0, B: 0 }, burst: false };
const TIERED: OpsPlan = { ...FIRST_COME, policy: 'tiered' };

/** The hours the prose looks at: a weekday's busiest (Monday 15:00, tied with every weekday's) and its quietest (Monday 03:00). */
export const PEAK_HOUR = 15;
export const NIGHT_HOUR = 3;

let numbers: ReturnType<typeof computeNumbers> | null = null;
function computeNumbers() {
  // Reserved commitments at the starting prices.
  const commit = commitments(contextOf(START)).list;
  const committedB = commit.filter((c) => c.gpu === 'B').reduce((t, c) => t + c.gpus, 0);
  const fc = runWeek(START, FIRST_COME, NORMAL);
  const tiered = runWeek(START, TIERED, NORMAL);
  const rentB = runWeek(START, { ...TIERED, rented: { L: 0, A: 0, B: 32 } }, NORMAL);
  const rentA = runWeek(START, { ...TIERED, rented: { L: 0, A: 64, B: 0 } }, NORMAL);
  const premium = withPremium(START, true);
  const premNo = runWeek(premium, TIERED, NORMAL);
  const premBurst = runWeek(premium, { ...TIERED, burst: true }, NORMAL);
  const launchNone = runWeek(START, TIERED, LAUNCH);
  const launchBest = bestPlan(START, LAUNCH);
  const launchBestRun = runWeek(START, launchBest.ops, LAUNCH);
  const out10 = runWeek(START, TIERED, { outPct: 10, demandPct: 100 });
  const low = runWeek(START, TIERED, { outPct: 0, demandPct: 70 });
  const normalBest = bestPlan(START, NORMAL);
  const chat = START.customers[0];
  const peak = hourDetail(START, TIERED, NORMAL, PEAK_HOUR);
  const night = hourDetail(START, TIERED, NORMAL, NIGHT_HOUR);
  // The model trainer's commitment: sized for its buyers who will pay the price of the GPUs committed.
  const ctx = contextOf(START);
  const trainer = ctx.off.find((o) => o.customer.id === 'c4')!;
  let trainerPeak = 0;
  for (let h = 0; h < 168; h++) trainerPeak = Math.max(trainerPeak, hourlyDemand(trainer.customer, h));
  const trainerCommitted = commit.filter((c) => c.customer === 'c4').reduce((t, c) => t + c.gpus * ctx.prod[trainer.customer.workload][c.gpu], 0);
  return {
    fleetTotal: GPU_IDS.reduce((t, g) => t + START.fleet.gpus[g], 0),
    fleetB: START.fleet.gpus.B,
    committedB,
    fc: { revenue: fc.revenue, power: fc.powerCost, fixed: fc.fixedCost, profit: fc.profit, util: fc.utilization, served: fc.served, away: turnedAway(fc) },
    tiered: { profit: tiered.profit, served: tiered.served, gain: tiered.profit - fc.profit },
    rentB32: { profit: rentB.profit, loss: tiered.profit - rentB.profit, revenueChange: rentB.revenue - tiered.revenue, rent: rentB.rentCost, ownedA: rentB.utilization.A, hours: rentedHours(rentB) },
    rentA64: { profit: rentA.profit, loss: tiered.profit - rentA.profit, hours: rentedHours(rentA) },
    tieredUtilA: tiered.utilization.A,
    hoursTurnedAway: tiered.hours.filter((h) => h.unmet > 1).length,
    premium: { noBurst: premNo.profit, burst: premBurst.profit, gain: premBurst.profit - premNo.profit, burstCost: premBurst.burstCost },
    launch: {
      none: launchNone.profit,
      noneChat: launchNone.served.c1,
      noneUtil: launchNone.utilization,
      bestA: launchBest.ops.rented.A,
      bestB: launchBest.ops.rented.B,
      bestPolicy: launchBest.ops.policy,
      best: launchBest.profit,
      gain: launchBest.profit - launchNone.profit,
      bestChat: launchBestRun.served.c1,
      rentCost: launchBestRun.rentCost,
    },
    out10: { profit: out10.profit, served: out10.served },
    low70: low.profit,
    normalBest,
    chatPeak: hourlyDemand(chat, 15),
    chatNight: hourlyDemand(chat, NIGHT_HOUR),
    peak: { demand: peak.row.demand, owned: peak.row.owned, unmet: peak.row.unmet, customers: peak.customers },
    night: { demand: night.row.demand, owned: night.row.owned, unmet: night.row.unmet, idleA: START.fleet.gpus.A - night.busy.A },
    tieredServed: tiered.served,
    trainer: {
      /** Wanted each hour at its first choice's price, and the work its committed GPUs can do, A-class equivalents. */
      wanted: (trainer.choices[0]?.share ?? 0) * trainerPeak,
      committed: trainerCommitted,
      /** Share of its buyers who buy on the B-class, and who will pay the A-class's price. */
      shareFirst: trainer.choices[0]?.share ?? 0,
      shareA: trainer.choices.find((c) => c.gpu === 'A')?.share ?? 0,
    },
    /** Lesson 5.4's rule: a GPU rented for every hour pays if it sells in more than this share of them. */
    rentRule: { A: PRICES.A.reserved / PRICES.A.onDemand, B: PRICES.B.reserved / PRICES.B.onDemand },
  };
}

/** The starting design's numbers (computed once, on first use). */
export function lessonNumbers() {
  return (numbers ??= computeNumbers());
}

// ---------------------------------------------------------------------------
// Display.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function hourName(h: number): string {
  return `${DAYS[Math.floor(h / 24) % 7]} ${String(h % 24).padStart(2, '0')}:00`;
}

const SRC = {
  owned: { label: 'Our GPUs', color: GRAPHIC.blue },
  rented: { label: 'Rented GPUs', color: GRAPHIC.teal },
  burst: { label: 'Bought elsewhere', color: GRAPHIC.gold },
  unmet: { label: 'Turned away', color: '#f2b1ad' },
} as const;
const TIER_NAME: Record<Tier, string> = { reserved: 'reserved', onDemand: 'on demand', spot: 'spot' };
/** “earns $X” or “loses $X”, for a week's profit. */
const earnsOrLoses = (x: number) => (x < 0 ? `loses ${usd(-x)}` : `earns ${usd(x)}`);

/** The week, hour by hour: where each A-class equivalent of wanted work was served, or that it was turned away. */
function WeekChart({ hours, cursor, ariaLabel }: { hours: HourOps[]; cursor?: number; ariaLabel: string }) {
  const x0 = 60;
  const x1 = 628;
  const n = hours.length;
  const slot = (x1 - x0) / Math.max(1, n);
  const top = Math.max(1, ...hours.map((h) => h.demand));
  const [, d1] = niceDomain(0, top * 1.05, 4);
  const y = scale(0, d1, 166, 26);
  const xs = hours.map((_, i) => x0 + (i + 0.5) * slot);
  const ex = [x0, ...xs, x1];
  const layers: Array<{ key: keyof typeof SRC; vals: number[] }> = [
    { key: 'owned', vals: hours.map((h) => h.owned) },
    { key: 'rented', vals: hours.map((h) => h.rented) },
    { key: 'burst', vals: hours.map((h) => h.burst) },
    { key: 'unmet', vals: hours.map((h) => h.unmet) },
  ];
  let lower = hours.map(() => 0);
  const paths = layers.map((l) => {
    const upper = lower.map((v, i) => v + Math.max(0, l.vals[i]));
    const pad = (a: number[]) => [a[0] ?? 0, ...a, a[a.length - 1] ?? 0];
    const d = areaPath(ex, pad(upper).map(y), pad(lower).map(y));
    lower = upper;
    return { key: l.key, d };
  });
  const demandLine = linePath(xs, hours.map((h) => y(h.demand)));
  return (
    <svg className="chart" viewBox="0 0 640 200" role="img" aria-label={ariaLabel}>
      <text className="ax" x={x0} y={14}>
        Work wanted each hour, A-class equivalents
      </text>
      <GridY y={y} ticks={niceTicks(0, d1, 4)} x0={x0} x1={x1} format={(v) => fmt(v)} baseline={0} />
      {[5, 6].map((d) => (
        <rect key={d} x={x0 + d * 24 * slot} y={26} width={24 * slot} height={140} fill="rgba(0,0,0,.035)" />
      ))}
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={SRC[p.key].color} opacity={p.key === 'unmet' ? 1 : 0.85} />
      ))}
      <path d={demandLine} fill="none" stroke="#333" strokeWidth={1.4} strokeLinejoin="round" />
      {cursor !== undefined && <line className="cur" x1={xs[cursor]} x2={xs[cursor]} y1={22} y2={166} />}
      {DAYS.map((d, i) => (
        <text key={d} className="ax ax-m" x={x0 + (i + 0.5) * 24 * slot} y={184}>
          {d}
        </text>
      ))}
    </svg>
  );
}

/** One hour: each customer's wanted work against what it got, and how busy each kind of owned GPU was. */
function HourChart({ detail, d }: { detail: HourDetail; d: CloudDesign }) {
  const rows = detail.customers.filter((c) => c.wanted > 0.01 || c.served > 0.01);
  const max = Math.max(1, ...rows.map((c) => Math.max(c.wanted, c.served)));
  const x = scale(0, max, 228, 560);
  const gpus = GPU_IDS.filter((g) => d.fleet.gpus[g] > 0);
  // Past six customers each row closes up to one line, so the chart grows less.
  const compact = rows.length > 6;
  const rowH = compact ? 20 : 30;
  const h1 = 24 + rows.length * rowH;
  const label =
    rows.map((c) => `${c.name}: wanted ${fmt(c.wanted)}, got ${fmt(c.served)}`).join('; ') +
    '. ' +
    gpus.map((g) => `${ACCELERATORS[g].short} ${fmt(detail.busy[g])} of ${fmt(d.fleet.gpus[g])} busy`).join(', ') +
    '.';
  return (
    <svg className="chart" viewBox={`0 0 640 ${h1 + 26 + gpus.length * 28 + 10}`} role="img" aria-label={`This hour, in A-class equivalents. ${label}`}>
      <text className="ax" x={228} y={14}>
        Work each customer wanted (outline) and got (filled), A-class equivalents
      </text>
      {rows.map((c, i) => {
        const yy = 24 + i * rowH;
        const barH = compact ? 14 : 18;
        return (
          <g key={c.id}>
            {compact ? (
              <text x={0} y={yy + 13} style={{ fontSize: 12, fill: '#222' }}>
                {c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name} <tspan className="ax">· {TIER_NAME[c.tier]}</tspan>
              </text>
            ) : (
              <>
                <text x={0} y={yy + 12} style={{ fontSize: 13, fill: '#222' }}>
                  {c.name}
                </text>
                <text x={0} y={yy + 25} className="ax">
                  {TIER_NAME[c.tier]}
                </text>
              </>
            )}
            <rect x={x(0)} y={yy + 2} width={Math.max(0, x(c.served) - x(0))} height={barH} fill={GRAPHIC.blue} opacity={0.85} />
            <rect x={x(0)} y={yy + 2} width={Math.max(0, x(c.wanted) - x(0))} height={barH} fill="none" stroke="#333" strokeWidth={1} />
            <text x={Math.min(x(Math.max(c.wanted, c.served)) + 6, 600)} y={yy + (compact ? 13 : 15)} className="ax">
              {fmt(c.served)} of {fmt(c.wanted)}
            </text>
          </g>
        );
      })}
      <text className="ax" x={228} y={h1 + 14}>
        Owned GPUs busy this hour
      </text>
      {gpus.map((g, i) => {
        const yy = h1 + 22 + i * 28;
        const share = d.fleet.gpus[g] > 0 ? detail.busy[g] / d.fleet.gpus[g] : 0;
        return (
          <g key={g}>
            <rect x={0} y={yy + 2} width={6} height={18} rx={1.5} fill={GPU_COLOR[g]} />
            <text x={12} y={yy + 15} style={{ fontSize: 13, fill: '#222' }}>
              {ACCELERATORS[g].short}
            </text>
            <rect x={228} y={yy + 2} width={332} height={18} fill="#ececea" />
            <rect x={228} y={yy + 2} width={332 * Math.min(1, share)} height={18} fill={GPU_COLOR[g]} opacity={0.85} />
            <text x={566} y={yy + 15} className="ax">
              {pct(share)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const saved = useCloud();
  const view = useScenario('view', { basis: 'start' as Basis, premium: false });
  const design = withPremium(designFor(saved, 'ops', view.state.basis), view.state.premium);
  const ops = design.ops;
  const cs = useScenario('conditions', NORMAL);
  const cond = cs.state;
  const week = runWeek(design, ops, cond);
  const ctx = contextOf(design);
  const N = lessonNumbers();
  const setOps = (patch: Partial<OpsPlan>) => updateCloud((d) => ({ ...d, ops: { ...d.ops, ...patch, rented: { ...d.ops.rented, ...(patch.rented ?? {}) } } }));
  const basisSwitch = <BasisSwitch value={view.state.basis} onChange={(basis) => view.set({ basis })} own="ops" />;
  const policySwitch = (
    <Segmented
      label="Who is served first after reserved customers"
      value={ops.policy}
      onChange={(policy) => setOps({ policy })}
      options={[
        { value: 'first-come', label: 'First come, first served' },
        { value: 'tiered', label: 'On demand first, spot last' },
      ]}
    />
  );

  const hs = useScenario('hour', { hour: 15 });
  const hour = Math.max(0, Math.min(167, hs.state.hour));
  const detail = hourDetail(design, ops, cond, hour);

  const normal = sameCond(cond, NORMAL);
  const launch = sameCond(cond, LAUNCH);
  const aSolved = planSolved(design, ops, cond, NORMAL);
  const bSolved = planSolved(design, ops, cond, LAUNCH);
  const aStatus = !normal
    ? 'Set the week back to normal first: every GPU in service, demand at 100% of forecast.'
    : `This plan ${earnsOrLoses(week.profit)} this week, ${usd(bestPlan(design, NORMAL).profit - week.profit)} short of the best plan.`;
  const bStatus = !launch
    ? 'Set the week to a launch: demand at 180% of forecast, with every GPU in service.'
    : `This plan ${earnsOrLoses(week.profit)} in the launch week, ${usd(bestPlan(design, LAUNCH).profit - week.profit)} short of the best plan.`;
  const rentsNothing = ops.rented.A + ops.rented.B === 0;
  const aHours = rentsNothing ? rentedHours(runWeek(design, { ...ops, rented: { L: 0, A: RENT_A.step, B: 0 } }, NORMAL)) : 0;
  const aSuccess = `Solved: this plan ${earnsOrLoses(week.profit)} this week, the most any plan can in a normal week. ${
    rentsNothing
      ? `No rental pays: ${fmt(RENT_A.step)} A-class GPUs rented here would be at work in only ${fmt(aHours)} of the week’s 168 hours, far short of the two-thirds their rent needs, and the next section shows why the B-class fails too.`
      : 'For this design some rented capacity earns more than it costs.'
  }${ops.policy === 'tiered' ? ' Serving on-demand customers before spot ones does the rest.' : ''}${ops.burst && view.state.premium ? ' With the premium price book, buying overflow elsewhere pays as well.' : ''}`;

  const away = turnedAway(week);
  const caption = `${pct(away)} of the work wanted at the customers’ first-choice prices is turned away this week. Busy: ${GPU_IDS.filter((g) => design.fleet.gpus[g] > 0)
    .map((g) => `${ACCELERATORS[g].short} ${pct(week.utilization[g])}`)
    .join(', ')}${GPU_IDS.some((g) => design.fleet.gpus[g] > 0) ? '' : 'no owned GPUs'}.`;
  const weekLabel = `A week of operations: ${fmt(week.hours.reduce((s, h) => s + h.demand, 0))} A-class-equivalent GPU-hours wanted, ${fmt(
    week.hours.reduce((s, h) => s + h.owned, 0),
  )} served on our GPUs, ${fmt(week.hours.reduce((s, h) => s + h.rented, 0))} on rented GPUs, ${fmt(week.hours.reduce((s, h) => s + h.burst, 0))} bought elsewhere, ${pct(away)} turned away. Profit ${usd(week.profit)}.`;
  const planText = `${view.state.basis === 'start' ? 'The starting design' : 'Your design'}${view.state.premium ? ' with the premium price book' : ''}, ${
    ops.policy === 'tiered' ? 'on demand first' : 'first come, first served'
  }, ${ops.rented.A + ops.rented.B > 0 ? `renting ${[ops.rented.A ? `${fmt(ops.rented.A)} A-class` : '', ops.rented.B ? `${fmt(ops.rented.B)} B-class` : ''].filter(Boolean).join(' and ')}` : 'nothing rented'}; demand at ${cond.demandPct}% of forecast, ${cond.outPct}% of GPUs out of service.`;

  return (
    <LessonPage id="compute/7.4">
      <P>
        Your cloud now has a fleet and a building (<a href={lessonHref('compute/7.1')}>Lesson 7.1</a>), customers (
        <a href={lessonHref('compute/7.2')}>Lesson 7.2</a>) and a price book (<a href={lessonHref('compute/7.3')}>Lesson 7.3</a>), all kept in this browser. The text
        describes the starting design — {fmt(N.fleetTotal)} GPUs at Tech Park, six customers and the course’s simulated list prices — and so do the demonstrations,
        until you switch them to yours. This lesson runs the cloud for a week, hour by hour, and asks what is still left to decide once all of that is fixed. Two things
        are: who gets the GPUs each hour, and whether to buy capacity from other clouds when your own runs short. Neither is new. They are the yield management of{' '}
        <a href={lessonHref('compute/6.1')}>Lesson 6.1</a> and the procurement choices of <a href={lessonHref('compute/6.2')}>Lesson 6.2</a>, now applied to your own
        business. Your cloud so far:
      </P>
      <SoFar parts={['fleet', 'customers', 'prices']} />
      <P>
        Each hour runs the same way. Reserved customers come first, because their capacity was promised: as in <a href={lessonHref('compute/5.4')}>Lesson 5.4</a>, each
        has GPUs committed to cover its busiest hour and pays for every one of them every hour, used or not. At the starting prices those commitments take{' '}
        {N.committedB === N.fleetB ? `all ${fmt(N.fleetB)}` : `${fmt(N.committedB)} of the ${fmt(N.fleetB)}`} B-class GPUs, for the frontier lab and the model trainer.
        A commitment covers only the buyers who will pay the price of the GPUs committed, though. The B-class runs out partway through the model trainer’s, and the rest
        is on A-class GPUs, sized for the {pct(N.trainer.shareA)} of its buyers who will pay the A-class’s price per unit of work rather than the{' '}
        {pct(N.trainer.shareFirst)} who buy on the B-class: {fmt(N.trainer.committed)} of the {fmt(N.trainer.wanted)} A-class equivalents it wants each hour. So even in
        a normal week the trainer is served {pct(N.tieredServed.c4)} of its work. On-demand and spot customers share what is left. Each prefers the accelerator that
        does its work most cheaply (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>); when that one is full, only the buyers willing to pay a dearer accelerator’s price per unit of work move to
        it (Lesson 7.3), and the rest are turned away. Spot customers may also use committed GPUs that a reserved customer leaves idle.
      </P>
      <P>
        In the next demonstration, the chart is the week’s work, in A-class equivalents, split by where it was served — on your own GPUs, on GPUs rented from another
        cloud, on on-demand hours bought elsewhere — or turned away; the line is all the work wanted. Choose the order in which customers are served each hour, how much
        capacity to rent and whether to buy on demand elsewhere. The last two sliders set the week’s conditions, which you don’t control: how many of your GPUs are out of
        service, and how demand compares with the forecast:
      </P>

      <Figure
        name="Compute Operations Center"
        onReset={() => {
          if (!confirmResetPart('ops')) return;
          cs.reset();
          view.reset();
        }}
      >
        {basisSwitch}
        <WeekChart hours={week.hours} ariaLabel={weekLabel} />
        <Legend items={[...(['owned', 'rented', 'burst', 'unmet'] as const).map((k) => ({ label: SRC[k].label, color: SRC[k].color })), { label: 'Work wanted', color: '#333', kind: 'line' as const }]} />
        {policySwitch}
        <Slider
          label="A-class rented"
          tone="green"
          value={ops.rented.A}
          min={0}
          max={RENT_A.max}
          step={RENT_A.step}
          onChange={(A) => setOps({ rented: { ...ops.rented, A } })}
          display={`${fmt(ops.rented.A)} at ${usd(PRICES.A.reserved, 2)}/h`}
        />
        <Slider
          label="B-class rented"
          tone="green"
          value={ops.rented.B}
          min={0}
          max={RENT_B.max}
          step={RENT_B.step}
          onChange={(B) => setOps({ rented: { ...ops.rented, B } })}
          display={`${fmt(ops.rented.B)} at ${usd(PRICES.B.reserved, 2)}/h`}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 24px' }}>
          <Checkbox label="Buy overflow elsewhere when it pays" checked={ops.burst} onChange={(burst) => setOps({ burst })} />
          <Checkbox label={`Premium price book (on demand +${pct(PREMIUM)})`} checked={view.state.premium} onChange={(premium) => view.set({ premium })} />
        </div>
        <Slider label="GPUs out of service" tone="red" value={cond.outPct} min={0} max={30} onChange={(outPct) => cs.set({ outPct })} display={`${cond.outPct}%`} />
        <Slider label="Demand against forecast" value={cond.demandPct} min={50} max={200} step={10} onChange={(demandPct) => cs.set({ demandPct })} display={`${cond.demandPct}%`} />
        <Readouts
          items={[
            { label: 'revenue this week', value: usd(week.revenue), tone: 'green' },
            { label: 'electricity', value: usd(week.powerCost), tone: 'red' },
            { label: 'rent and bought hours', value: usd(week.rentCost + week.burstCost), tone: 'green' },
            { label: 'fixed costs (Lesson 4.5)', value: usd(week.fixedCost), tone: 'green' },
            { label: 'profit this week', value: usd(week.profit), tone: week.profit < 0 ? 'red' : 'green' },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with the starting design, served first come, first served. The week brings in {usd(N.fc.revenue)}, spends {usd(N.fc.power)} on electricity, and owes{' '}
        {usd(N.fc.fixed)} of fixed costs — the capital and upkeep of <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>, spread over the week — so it loses{' '}
        {usd(-N.fc.profit)}. The B-class GPUs are {pct(N.fc.util.B)} busy, the A-class {pct(N.fc.util.A)}, the L-class {pct(N.fc.util.L)}, and {pct(N.fc.away)} of the work
        wanted is turned away. Much of it belongs to buyers who would pay the B-class’s price for their work but not the A-class’s, and every B-class GPU is already
        committed to the reserved customers.
      </P>
      <P>
        The next demonstration lists the customers under the plan and conditions set in <FigRef to="Compute Operations Center">the first demonstration</FigRef>: each
        one’s product, the accelerator that does its work most cheaply and the price per A-class equivalent there, the share of its wanted work served this week, and
        its revenue. It repeats the choice of who is served first:
      </P>

      <Figure name="Compute Operations Center · customers">
        {basisSwitch}
        {policySwitch}
        <DataTable
          caption="Each customer: its product, the accelerator that does its work most cheaply and the price per A-class equivalent there, the share of its wanted work served, and its revenue this week"
          rows={ctx.off}
          rowKey={(o) => o.customer.id}
          columns={[
            { label: 'Customer', cell: (o) => o.customer.name },
            { label: 'Buys', cell: (o) => TIER_NAME[o.customer.tier] },
            { label: 'Prefers', cell: (o) => (o.gpu ? `${ACCELERATORS[o.gpu].short}, ${usd(o.price, 2)}` : '—'), align: 'right' },
            { label: 'Served', cell: (o) => (o.gpu ? pct(week.served[o.customer.id] ?? 0) : 'out of reach'), align: 'right' },
            { label: 'Revenue', cell: (o) => usd(week.revenueBy[o.customer.id] ?? 0), align: 'right' },
          ]}
        />
        <Readouts items={[{ label: 'profit this week', value: usd(week.profit), tone: week.profit < 0 ? 'red' : 'green' }]} />
      </Figure>
      <P>
        Now serve on-demand customers before spot ones. Code completion goes from {pct(N.fc.served.c2)} of its work to {pct(N.tiered.served.c2)}, the chat startup from{' '}
        {pct(N.fc.served.c1)} to {pct(N.tiered.served.c1)}, while the document processor drops from {pct(N.fc.served.c6)} to {pct(N.tiered.served.c6)}. The week improves
        by {usd(N.tiered.gain)}, to {usd(N.tiered.profit)}. It is the heart of Lesson 6.1’s best allocation: spot work can wait for the night, and the afternoon GPU-hour it
        gives up sells for the on-demand price instead. Even so, work is turned away in every one of the week’s {N.hoursTurnedAway} hours. Should the cloud rent more GPUs?
      </P>

      <Challenge
        id="a"
        figure="Compute Operations Center"
        question={`Predict first: will renting GPUs from another cloud — A-class at ${usd(PRICES.A.reserved, 2)} an hour, sold on demand at ${usd(PRICES.A.onDemand, 2)}, or B-class at ${usd(PRICES.B.reserved, 2)}, sold at ${usd(PRICES.B.onDemand, 2)} — pay in a normal week? Lesson 5.4’s rule is the test: a GPU rented for every hour at two-thirds of its sale price pays only if it sells in more than two-thirds of them. Then, in a normal week — every GPU in service, demand as forecast — find the operating plan that earns your cloud the most.`}
        solved={aSolved}
        status={aStatus}
        success={aSuccess}
      />

      <H2>Buying capacity elsewhere</H2>
      <P>
        Neither rental pays, and for different reasons. Rent 64 A-class GPUs and the week loses {usd(N.rentA64.loss)} more. The cloud uses rented GPUs only once its own
        are full, which happens in the afternoons, so they are at work in {fmt(N.rentA64.hours)} of the week’s 168 hours, far short of the two-thirds their rent needs
        ({usd(PRICES.A.reserved, 2)} ÷ {usd(PRICES.A.onDemand, 2)}). The work turned away at night belongs to buyers who would pay the B-class’s price but not the
        A-class’s, so more A-class hours don’t win it. Rent 32 B-class GPUs instead, at the same two-thirds of their sale price, and the week loses{' '}
        {usd(N.rentB32.loss)}. They are busy in all {fmt(N.rentB32.hours)} hours, but mostly with work the cloud’s own A-class GPUs were already doing: the customers
        prefer them, per unit of work, so the A-class falls from {pct(N.tieredUtilA)} busy to {pct(N.rentB32.ownedA)}, revenue falls by {usd(-N.rentB32.revenueChange)},
        and the {usd(N.rentB32.rent)} of rent buys nothing new.
      </P>
      <P>
        Buying on-demand hours from another cloud costs nothing when unused, but with the starting prices it earns nothing either: your on-demand prices are the
        market’s, so a B-class hour bought for {usd(PRICES.B.onDemand, 2)} resells for {usd(PRICES.B.onDemand, 2)}. Bursting pays only if your own on-demand price sits
        above the market’s, a choice made in Lesson 7.3. Tick the premium price book in <FigRef to="Compute Operations Center">the first demonstration</FigRef> — every
        on-demand price {pct(PREMIUM)} above the market’s — and buying elsewhere adds {usd(N.premium.gain)} to the week ({usd(N.premium.noBurst)} without it,{' '}
        {usd(N.premium.burst)} with it): customers who would otherwise be turned away pay your premium, and another cloud’s idle GPUs do the work.
      </P>

      <H2>When the week isn’t normal</H2>
      <P>
        The conditions sliders change things you don’t control. Take 10% of the GPUs out of service — failed boards and the repairs <a href={lessonHref('compute/6.5')}>Lesson 6.5</a> counted as lost hours — and the
        starting design, served on demand first, falls to {usd(N.out10.profit)}. The reserved customers lose service too, because some of their committed GPUs are among
        those out: the model trainer gets {pct(N.out10.served.c4)} of its work instead of {pct(N.tieredServed.c4)}, and the document processor, which lives on spare
        hours, drops from {pct(N.tieredServed.c6)} to {pct(N.out10.served.c6)}. (A real training run would do worse: as{' '}
        <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> found, every GPU in a run takes part in every step, so losing one stops the run until it restarts.) Let demand
        fall to 70% of the forecast instead and no plan rescues the week: served on demand first, it loses {usd(-N.low70)}, because the fixed costs don’t
        shrink with the work.
      </P>
      <P>
        Now set demand to 180% of the forecast — a launch week. With nothing rented, on demand first, the cloud earns {usd(N.launch.none)}: every owned GPU is busy around the
        clock and the chat startup gets only {pct(N.launch.noneChat)} of its work. Renting now looks different. The extra demand is there at night as well as in the afternoon,
        so a rented GPU stays busy in enough hours to cover its rent — the same two-thirds rule, this time satisfied.
      </P>

      <Challenge
        id="b"
        figure="Compute Operations Center"
        question="In a launch week — demand at 180% of the forecast, every GPU in service — find the operating plan that earns your cloud the most."
        solved={bSolved}
        status={bStatus}
        success={`Solved: this plan ${earnsOrLoses(week.profit)} in the launch week. With the starting design the best plan serves on demand first and rents ${fmt(N.launch.bestA)} A-class${
          N.launch.bestB ? ` and ${fmt(N.launch.bestB)} B-class` : ''
        } GPUs: ${usd(N.launch.rentCost)} of rent that lifts the week by ${usd(N.launch.gain)}, and the chat startup gets ${pct(N.launch.bestChat)} of its work instead of ${pct(
          N.launch.noneChat,
        )}.${
          N.launch.bestB === 0 && N.launch.bestA > 0
            ? ' It’s A-class GPUs that pay, not B-class: the chat startup’s buyers will pay the A-class’s price per unit of work, and an A-class GPU’s rent is low enough that this work, at night as well as by day, covers it.'
            : ''
        }`}
      />

      <H2>One hour at a time</H2>
      <P>
        The week is made of hours, and the plan acts on each one separately. In the next demonstration, choose an hour of the week to see what each customer wanted and got,
        and how busy each kind of your GPUs was. It uses the plan and conditions set in <FigRef to="Compute Operations Center">the first demonstration</FigRef>:
      </P>

      <Figure name="Compute Operations Center · one hour" scenario={hs}>
        {basisSwitch}
        <WeekChart hours={week.hours} cursor={hour} ariaLabel={`${weekLabel} Marked: ${hourName(hour)}.`} />
        <Slider label="Hour of the week" value={hour} min={0} max={167} onChange={(h) => hs.set({ hour: h })} display={hourName(hour)} />
        <HourChart detail={detail} d={design} />
        <Readouts
          items={[
            { label: 'wanted this hour', value: fmt(detail.row.demand) },
            { label: 'served on our GPUs', value: fmt(detail.row.owned) },
            { label: 'rented or bought', value: fmt(detail.row.rented + detail.row.burst) },
            { label: 'turned away', value: fmt(detail.row.unmet), tone: detail.row.unmet > 0.5 ? 'red' : undefined },
          ]}
        />
        <Caption>{planText}</Caption>
      </Figure>

      <P>
        With the starting design served on demand first, the busiest hours of the week are at {String(PEAK_HOUR).padStart(2, '0')}:00 on each weekday. On
        Monday, {fmt(N.peak.demand)} A-class equivalents are wanted, {fmt(N.peak.owned)} served on your own GPUs and {fmt(N.peak.unmet)} turned away. At{' '}
        {String(NIGHT_HOUR).padStart(2, '0')}:00 the same day, {fmt(N.night.demand)} are wanted and still {fmt(N.night.unmet)} turned away, though{' '}
        {fmt(N.night.idleA)} A-class GPUs sit idle: the work turned away at night belongs to buyers who would pay the B-class’s price but not the A-class’s. The fleet isn’t simply too small. Its B-class
        GPUs are sold out to reserved contracts, and its A- and L-class GPUs are priced, per unit of work, above what some buyers will pay — a fact about the fleet and the
        price book, which operations can work around but not undo.
      </P>
      <P>
        That is the operator’s view: one week, one draw of demand, one state of the hardware. A real business lives through many weeks it can’t foresee — demand that grows
        faster or slower than forecast, a newer generation of GPUs arriving elsewhere and cutting what customers will pay, hardware that fails. In the last lesson, we run
        your whole design — fleet, customers, prices and this operating plan — through three uncertain years, and score it.
      </P>
    </LessonPage>
  );
}
