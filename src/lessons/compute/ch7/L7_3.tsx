import { useDeferredValue, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
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
  PRICEBOOK_DEFAULT,
  commitments,
  effectivePrice,
  fleetProductivity,
  inReach,
  offers,
  operate,
  prepare,
  type Offer,
  type OpsResult,
  type PriceBook,
  type Tier,
} from '../../../engines/compute/cloud';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { WORKLOADS } from '../../../model/compute/workloads';
import { confirmResetPart, defaultCloud, designFor, othersAtStart, updateCloud, useCloud, type Basis, type CloudDesign } from '../shared/cloudStore';
import { BasisSwitch, SoFar } from '../shared/SoFar';

// ---------------------------------------------------------------------------
// The price book and what it earns: everything here reads the reader's design from the store.

export const TIERS: Tier[] = ['reserved', 'onDemand', 'spot'];
export const TIER_NAME: Record<Tier, string> = { reserved: 'Reserved', onDemand: 'On demand', spot: 'Spot' };
/** Highest price each slider offers, $ per GPU-hour (about three times the list price). */
export const PRICE_MAX: Record<GpuId, number> = { L: 3, A: 8, B: 16 };
export const PRICE_STEP = 0.05;
/** Points on the demand-curve sweep. */
const SWEEP_POINTS = 41;

/** A key for a design: JSON with Infinity kept (as null). */
function keyOf(d: unknown): string {
  return JSON.stringify(d, (_, v) => (v === Infinity ? null : v));
}

const weekCache = new Map<string, OpsResult>();
/** One week of the design under its own operating plan (memoized). */
export function weekOf(d: CloudDesign): OpsResult {
  const key = keyOf(d);
  let r = weekCache.get(key);
  if (!r) {
    r = operate(d.customers, d.prices, d.fleet, d.ops);
    if (weekCache.size > 800) weekCache.clear();
    weekCache.set(key, r);
  }
  return r;
}

/** The same week at the course's list prices. */
export function listWeekOf(d: CloudDesign): OpsResult {
  return weekOf({ ...d, prices: PRICEBOOK_DEFAULT });
}

export function withPrice(book: PriceBook, tier: Tier, g: GpuId, price: number): PriceBook {
  return { ...book, [tier]: { ...book[tier], [g]: price } };
}

/** Customers the site can reach and the fleet can run who buy nothing at these prices. */
export function customersLost(d: CloudDesign): string[] {
  const prod = fleetProductivity(d.fleet);
  return offers(d.customers, d.prices, d.fleet, prod)
    .filter((o) => inReach(o.customer, d.fleet.site) && GPU_IDS.some((g) => d.fleet.gpus[g] > 0 && prod[o.customer.workload][g] > 0) && o.choices.length === 0)
    .map((o) => o.customer.name);
}

/** The contribution margin the challenge asks for: 5% above the list prices' (or 5% of its size above it, if negative). */
export function marginTarget(d: CloudDesign): number {
  const m = listWeekOf(d).margin;
  return m + 0.05 * Math.abs(m);
}

/** Challenge a: at least 5% more contribution margin than the list prices, with no reachable customer priced out. */
export function pricingSolved(d: CloudDesign): boolean {
  return weekOf(d).margin >= marginTarget(d) - 1e-6 && customersLost(d).length === 0;
}

export interface Sweep {
  prices: number[];
  profits: number[];
  /** Share of that accelerator's hours busy. */
  utils: number[];
}

const sweepCache = new Map<string, Sweep>();
/** The week's profit (and how busy that accelerator is) at evenly spaced values of one price, the rest of the book unchanged. */
export function sweepPrice(d: CloudDesign, tier: Tier, g: GpuId): Sweep {
  const key = `${tier}|${g}|${keyOf({ ...d, prices: withPrice(d.prices, tier, g, -1) })}`;
  let s = sweepCache.get(key);
  if (!s) {
    const prices: number[] = [];
    const profits: number[] = [];
    const utils: number[] = [];
    for (let i = 0; i < SWEEP_POINTS; i++) {
      const p = (PRICE_MAX[g] * i) / (SWEEP_POINTS - 1);
      const r = weekOf({ ...d, prices: withPrice(d.prices, tier, g, p) });
      prices.push(p);
      profits.push(r.profit);
      utils.push(r.utilization[g]);
    }
    s = { prices, profits, utils };
    if (sweepCache.size > 200) sweepCache.clear();
    sweepCache.set(key, s);
  }
  return s;
}

const bestCache = new Map<string, { price: number; profit: number }>();
/** The price on the slider's grid that earns the most this week, the rest of the book unchanged (coarse sweep, then refined). */
export function bestPrice(d: CloudDesign, tier: Tier, g: GpuId): { price: number; profit: number } {
  const key = `${tier}|${g}|${keyOf({ ...d, prices: withPrice(d.prices, tier, g, -1) })}`;
  let b = bestCache.get(key);
  if (!b) {
    const s = sweepPrice(d, tier, g);
    let at = 0;
    s.profits.forEach((p, i) => {
      if (p > s.profits[at] + 1e-6) at = i;
    });
    const span = PRICE_MAX[g] / (SWEEP_POINTS - 1);
    const lo = Math.max(0, s.prices[at] - span);
    const hi = Math.min(PRICE_MAX[g], s.prices[at] + span);
    b = { price: s.prices[at], profit: s.profits[at] };
    for (let k = Math.ceil(lo / PRICE_STEP - 1e-9); k * PRICE_STEP <= hi + 1e-9; k++) {
      const p = Math.round(k * PRICE_STEP * 100) / 100;
      const profit = weekOf({ ...d, prices: withPrice(d.prices, tier, g, p) }).profit;
      if (profit > b.profit + 1e-6) b = { price: p, profit };
    }
    if (bestCache.size > 200) bestCache.clear();
    bestCache.set(key, b);
  }
  return b;
}

/** How close to the most a challenge's week must earn: a step either side of the peak still counts. */
export const RB_TOL = 2000;
export const ODA_TOL = 200;

/** Challenge a: the B-class's reserved price set where the week earns the most (within $2,000: a few cents below the peak), the rest of the book as it is. */
export function reservedBSolved(d: CloudDesign): boolean {
  return weekOf(d).profit >= bestPrice(d, 'reserved', 'B').profit - RB_TOL;
}

/** Challenge b: the A-class's on-demand price set where the week earns the most (within $200: a step either side), the rest of the book as it is. */
export function onDemandASolved(d: CloudDesign): boolean {
  return weekOf(d).profit >= bestPrice(d, 'onDemand', 'A').profit - ODA_TOL;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes: the starting design, from the engines.

const START = defaultCloud();
const LIST = weekOf(START);
const PROD = fleetProductivity(START.fleet);
const LIST_OFFERS = offers(START.customers, START.prices, START.fleet, PROD);
const COMMIT = commitments(prepare(START.customers, START.prices, START.fleet)).list;
const committed = (cust: string, g: GpuId, list = COMMIT) => list.filter((c) => c.customer === cust && c.gpu === g).reduce((s, c) => s + c.gpus, 0);
const CEILING_RAW = PRICEBOOK_DEFAULT.reserved.A * PROD.frontier400.B;
const CEILING = Math.floor(CEILING_RAW / PRICE_STEP + 1e-9) * PRICE_STEP;
const AT_CEILING: CloudDesign = { ...START, prices: withPrice(START.prices, 'reserved', 'B', CEILING) };
const PAST_CEILING: CloudDesign = { ...START, prices: withPrice(START.prices, 'reserved', 'B', CEILING + PRICE_STEP) };
const CEIL_WEEK = weekOf(AT_CEILING);
const PAST_WEEK = weekOf(PAST_CEILING);
const CEIL_COMMIT = commitments(prepare(AT_CEILING.customers, AT_CEILING.prices, AT_CEILING.fleet)).list;
const TRAINER_CEILING_RAW = PRICEBOOK_DEFAULT.reserved.A * PROD.train70.B;
const TRAINER_LAST = Math.floor(TRAINER_CEILING_RAW / PRICE_STEP + 1e-9) * PRICE_STEP;
const TRAINER_STAY = weekOf({ ...START, prices: withPrice(START.prices, 'reserved', 'B', TRAINER_LAST) });
const TRAINER_GONE = weekOf({ ...START, prices: withPrice(START.prices, 'reserved', 'B', TRAINER_LAST + PRICE_STEP) });
const UP10: CloudDesign = {
  ...START,
  prices: Object.fromEntries(TIERS.map((t) => [t, Object.fromEntries(GPU_IDS.map((g) => [g, Math.round(START.prices[t][g] * 1.1 * 100) / 100]))])) as PriceBook,
};
const UP10_WEEK = weekOf(UP10);
const ODA_LIST = bestPrice(START, 'onDemand', 'A');
const ODA_CEIL = bestPrice(AT_CEILING, 'onDemand', 'A');
const offerOf = (id: string) => LIST_OFFERS.find((o) => o.customer.id === id)!;
const choice = (id: string, g: GpuId) => offerOf(id).choices.find((c) => c.gpu === g);
const prodB = START.customers.map((c) => PROD[c.workload].B);

export const LESSON_NUMBERS = {
  listRevenue: LIST.revenue,
  listPower: LIST.powerCost,
  listMargin: LIST.margin,
  listFixed: LIST.fixedCost,
  listProfit: LIST.profit,
  listUtil: LIST.utilization,
  prodBMin: Math.min(...prodB),
  prodBMax: Math.max(...prodB),
  prodFrontierB: PROD.frontier400.B,
  prodTrainB: PROD.train70.B,
  allFirstB: LIST_OFFERS.every((o) => o.gpu === 'B'),
  chatOnB: choice('c1', 'B')!.price,
  chatOnA: choice('c1', 'A')!.price,
  chatShareA: choice('c1', 'A')!.share,
  chatServed: LIST.served.c1,
  frontierOnB: choice('c3', 'B')!.price,
  frontierValue: offerOf('c3').customer.value,
  frontierCommitB: committed('c3', 'B'),
  trainerCommitB: committed('c4', 'B'),
  trainerCommitA: committed('c4', 'A'),
  frontierRevenueList: LIST.revenueBy.c3,
  ceilingRaw: CEILING_RAW,
  ceiling: CEILING,
  ceilProfit: CEIL_WEEK.profit,
  ceilGain: CEIL_WEEK.profit - LIST.profit,
  ceilFrontierRevenue: CEIL_WEEK.revenueBy.c3,
  ceilTrainerCommitA: committed('c4', 'A', CEIL_COMMIT),
  ceilFreedB: START.fleet.gpus.B - CEIL_COMMIT.filter((c) => c.gpu === 'B').reduce((s, c) => s + c.gpus, 0),
  ceilUtilB: CEIL_WEEK.utilization.B,
  ceilChatServed: CEIL_WEEK.served.c1,
  pastProfit: PAST_WEEK.profit,
  pastUtilB: PAST_WEEK.utilization.B,
  trainerCeilingRaw: TRAINER_CEILING_RAW,
  trainerLast: TRAINER_LAST,
  trainerStayProfit: TRAINER_STAY.profit,
  trainerGoneProfit: TRAINER_GONE.profit,
  marginTarget: marginTarget(START),
  up10Margin: UP10_WEEK.margin,
  up10Gain: UP10_WEEK.margin / LIST.margin - 1,
  ceilMarginGain: CEIL_WEEK.margin / LIST.margin - 1,
  odaListBest: ODA_LIST,
  odaCeilBest: ODA_CEIL,
};
const N = LESSON_NUMBERS;

// ---------------------------------------------------------------------------
// Display.

const m2 = (x: number) => usd(x, 2);
const k1 = (x: number) => usd(Math.round(x));
const GPU_SHORT: Record<GpuId, string> = { L: 'L-class', A: 'A-class', B: 'B-class' };

/** Right-hand columns: the share of buyers who buy, the share of their work served this week, and the week's revenue. */
const COL = { buy: 520, served: 574, revenue: 640 };

/** Each customer: its buyers' values per A-class-equivalent hour as a band, what its work costs there on each accelerator, and what it bought this week. */
function OfferChart({ offs, d, week }: { offs: Offer[]; d: CloudDesign; week: OpsResult }) {
  const prod = fleetProductivity(d.fleet);
  const rows = offs.slice(0, 12);
  const xmax = Math.max(4, Math.min(12, Math.ceil(Math.max(...rows.map((o) => 1.5 * o.customer.value), 1))));
  const x = scale(0, xmax, 168, 470);
  const ticks = niceTicks(0, xmax, 5);
  // Rows close up a little past nine customers, so the chart grows less.
  const rowH = rows.length > 9 ? 34 : 40;
  const top = 30;
  const height = top + rows.length * rowH + 22;
  const served = (o: Offer) => (o.choices.length ? pct(week.served[o.customer.id] ?? 0) : '—');
  const label = rows
    .map((o) => {
      const tail = `${served(o)} of its work served this week, ${k1(week.revenueBy[o.customer.id] ?? 0)} of revenue`;
      if (!o.gpu) return `${o.customer.name}: ${o.reason ?? 'buys nothing'}; ${tail}`;
      return `${o.customer.name}: buys on the ${GPU_SHORT[o.gpu]} at ${m2(o.price)} per A-class-equivalent hour, ${pct(o.share)} of its buyers; ${tail}`;
    })
    .join('; ');
  return (
    <svg className="chart" viewBox={`0 0 640 ${height}`} role="img" aria-label={`What each customer’s work costs per A-class-equivalent hour, against its buyers’ values, and what it bought this week. ${label}.`}>
      <text className="ax" x={168} y={14}>
        $ per A-eq hour of its work · band: its buyers’ values
      </text>
      <text className="ax ax-e" x={COL.buy} y={14}>
        buy
      </text>
      <text className="ax ax-e" x={COL.served} y={14}>
        served
      </text>
      <text className="ax ax-e" x={COL.revenue} y={14}>
        revenue
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={top - 6} y2={top + rows.length * rowH} />
          <text className="ax ax-m" x={x(t)} y={height - 6}>
            {usd(t)}
          </text>
        </g>
      ))}
      {rows.map((o, i) => {
        const c = o.customer;
        const y = top + i * rowH;
        const lo = x(Math.min(xmax, 0.5 * c.value));
        const hi = x(Math.min(xmax, 1.5 * c.value));
        const reach = inReach(c, d.fleet.site);
        const marks = GPU_IDS.filter((g) => d.fleet.gpus[g] > 0 && prod[c.workload][g] > 0).map((g) => ({ g, price: effectivePrice(c, g, d.prices, prod) }));
        const first = o.gpu ? o.price : Infinity;
        const buyFrom = Number.isFinite(first) ? Math.max(lo, Math.min(hi, x(Math.min(xmax, first)))) : hi;
        return (
          <g key={c.id}>
            <text x={0} y={y + 14} style={{ fontSize: 13, fontWeight: 500, fill: '#222' }}>
              {c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name}
            </text>
            <text x={0} y={y + 29} className="ax">
              {WORKLOADS[c.workload].name.toLowerCase()} · {TIER_NAME[c.tier].toLowerCase()}
            </text>
            {reach ? (
              <>
                <rect x={lo} y={y + 12} width={Math.max(0, hi - lo)} height={12} fill="#e4ecd9" />
                <rect x={buyFrom} y={y + 12} width={Math.max(0, hi - buyFrom)} height={12} fill={GRAPHIC.green} opacity={0.55} />
                {marks.map((m) => {
                  const off = m.price > xmax;
                  const mx = off ? x(xmax) : x(m.price);
                  const isFirst = m.g === o.gpu;
                  return (
                    <g key={m.g}>
                      <line x1={mx} x2={mx} y1={y + 6} y2={y + 30} stroke={GPU_COLOR[m.g]} strokeWidth={isFirst ? 3 : 1.5} />
                      <text x={mx + (off ? -4 : 0)} y={y + 4} textAnchor={off ? 'end' : 'middle'} style={{ fontSize: 11, fontWeight: isFirst ? 600 : 400, fill: '#333' }}>
                        {m.g}
                        {off ? ' →' : ''}
                      </text>
                    </g>
                  );
                })}
                <text x={COL.buy} y={y + 22} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
                  {o.choices.length ? pct(o.share) : 'none'}
                </text>
              </>
            ) : (
              <text x={x(0) + 6} y={y + 22} className="ax">
                {SITES[d.fleet.site].name} is too far from its users
              </text>
            )}
            <text x={COL.served} y={y + 22} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {served(o)}
            </text>
            <text x={COL.revenue} y={y + 22} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {k1(week.revenueBy[c.id] ?? 0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The week's profit, and how busy one accelerator is, at every value of one price. */
function SweepChart({ s, current, best, g, tier, showBest }: { s: Sweep; current: number; best: { price: number; profit: number }; g: GpuId; tier: Tier; showBest: boolean }) {
  const x = scale(0, PRICE_MAX[g], 72, 600);
  const [p0, p1] = niceDomain(Math.min(0, ...s.profits), Math.max(1000, ...s.profits), 4);
  const yp = scale(p0, p1, 150, 26);
  const yu = scale(0, 1, 252, 186);
  const kfmt = (v: number) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`);
  const cur = Math.min(PRICE_MAX[g], current);
  const iCur = Math.round((cur / PRICE_MAX[g]) * (SWEEP_POINTS - 1));
  // The refined best price may fall between sweep points (just below a cliff): draw it on the curve.
  const line = s.prices.map((p, i) => [p, s.profits[i]] as [number, number]);
  if (best.price <= PRICE_MAX[g] && !line.some((q) => Math.abs(q[0] - best.price) < 1e-9)) line.push([best.price, best.profit]);
  line.sort((p, q) => p[0] - q[0]);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 286"
      role="img"
      aria-label={`The week’s profit at every ${TIER_NAME[tier].toLowerCase()} price for the ${GPU_SHORT[g]}, the rest of the price book unchanged.${showBest ? ` Most profit: ${k1(best.profit)} at ${m2(best.price)} per GPU-hour.` : ''} At the current ${m2(current)}, about ${pct(s.utils[iCur] ?? 0)} of the ${GPU_SHORT[g]}’s hours are busy.`}
    >
      <text className="ax" x={72} y={14}>
        The week’s profit
      </text>
      <GridY y={yp} ticks={niceTicks(p0, p1, 4)} x0={72} x1={600} format={kfmt} baseline={0} />
      <path d={linePath(line.map((q) => x(q[0])), line.map((q) => yp(q[1])))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={x(cur)} x2={x(cur)} y1={22} y2={252} />
      {showBest && (
        <>
          <circle cx={x(Math.min(PRICE_MAX[g], best.price))} cy={yp(best.profit)} r={5} fill="none" stroke="#333" strokeWidth={1.5} />
          <text x={Math.min(560, x(Math.min(PRICE_MAX[g], best.price)) + 8)} y={Math.max(30, yp(best.profit) - 6)} style={{ fontSize: 12, fill: '#333' }}>
            most profit
          </text>
        </>
      )}
      <text className="ax" x={72} y={176}>
        Share of the {GPU_SHORT[g]}’s hours busy
      </text>
      <line className="base" x1={72} x2={600} y1={yu(0)} y2={yu(0)} />
      <line className="gl" x1={72} x2={600} y1={yu(1)} y2={yu(1)} />
      <text className="ax ax-e" x={66} y={yu(1) + 4}>
        100%
      </text>
      <text className="ax ax-e" x={66} y={yu(0) + 4}>
        0%
      </text>
      <path d={linePath(s.prices.map(x), s.utils.map(yu))} fill="none" stroke={GPU_COLOR[g]} strokeWidth={2} strokeLinejoin="round" />
      {niceTicks(0, PRICE_MAX[g], 6).map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={270}>
          {usd(t)}
        </text>
      ))}
      <text className="ax ax-e" x={600} y={284}>
        {TIER_NAME[tier].toLowerCase()} price of the {GPU_SHORT[g]}, $ per GPU-hour
      </text>
    </svg>
  );
}

export default function Lesson() {
  const saved = useCloud();
  const [basis, setBasis] = useState<Basis>('start');
  const d = designFor(saved, 'prices', basis);
  const tierPick = useScenario('tier', { tier: 'onDemand' as Tier });
  const tier = tierPick.state.tier;
  const prod = fleetProductivity(d.fleet);
  const offs = offers(d.customers, d.prices, d.fleet, prod);
  const week = weekOf(d);
  const list = listWeekOf(d);
  const lost = customersLost(d);
  const setPrice = (t: Tier, g: GpuId, v: number) => updateCloud((cur) => ({ ...cur, prices: withPrice(cur.prices, t, g, Math.round(v * 100) / 100) }));
  const solvedA = reservedBSolved(d);

  // The demand curve: deferred, since each sweep runs the week dozens of times.
  const s2 = useScenario('curve', { tier: 'reserved' as Tier, gpu: 'B' as GpuId });
  const dd = useDeferredValue(d);
  const sweep = useMemo(() => sweepPrice(dd, s2.state.tier, s2.state.gpu), [dd, s2.state.tier, s2.state.gpu]);
  const best2 = useMemo(() => bestPrice(dd, s2.state.tier, s2.state.gpu), [dd, s2.state.tier, s2.state.gpu]);
  const solvedB = useMemo(() => onDemandASolved(dd), [dd]);
  const g2 = s2.state.gpu;
  const t2 = s2.state.tier;
  const basisSwitch = <BasisSwitch value={basis} onChange={setBasis} own="prices" />;

  const busyLine = GPU_IDS.filter((g) => d.fleet.gpus[g] > 0)
    .map((g) => `${GPU_SHORT[g]} ${pct(week.utilization[g])}`)
    .join(', ');
  const caption = lost.length
    ? `At these prices ${lost.join(' and ')} buy${lost.length === 1 ? 's' : ''} nothing at all.`
    : `Busy this week: ${busyLine || 'nothing'}.`;
  const earns = (x: number) => `${x < 0 ? 'loses' : 'earns'} ${k1(Math.abs(x))}`;
  const lab = offs.find((o) => o.customer.id === 'c3');
  const statusA = `At ${m2(d.prices.reserved.B)} a reserved B-class hour, the week ${earns(week.profit)}${lab?.gpu ? `, and the frontier lab buys on the ${GPU_SHORT[lab.gpu]}` : ''}.`;
  const successA = `Solved: ${m2(d.prices.reserved.B)} a reserved B-class hour ${earns(week.profit)} this week, against ${k1(weekOf({ ...d, prices: withPrice(d.prices, 'reserved', 'B', PRICEBOOK_DEFAULT.reserved.B) }).profit)} at the list’s ${m2(PRICEBOOK_DEFAULT.reserved.B)}${
    othersAtStart(d, 'prices') ? ': well above the list, and a step or two short of the price at which the frontier lab would rather buy A-class hours.' : '.'
  }`;
  const odaUp = d.prices.onDemand.A > PRICEBOOK_DEFAULT.onDemand.A;
  const statusB = `At ${m2(d.prices.onDemand.A)} an on-demand A-class hour, the week ${earns(week.profit)}.`;
  const successB = `Solved: ${m2(d.prices.onDemand.A)} an hour, ${odaUp ? 'above' : 'below'} the list’s ${m2(PRICEBOOK_DEFAULT.onDemand.A)}, ${earns(week.profit)} this week. ${
    odaUp ? 'Idle hours didn’t make a cut pay: the buyers a lower price would win bring in less than every other buyer would stop paying. ' : ''
  }A step higher loses more buyers’ revenue than it gains from the rest; a step lower gives away more than the extra buyers bring.`;

  return (
    <LessonPage id="compute/7.3">
      <P>
        Lessons <a href={lessonHref('compute/7.1')}>7.1</a> and <a href={lessonHref('compute/7.2')}>7.2</a> built a fleet and found it customers. Now it needs prices.
        At the course’s simulated list prices of <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> — an hour on demand at {m2(PRICEBOOK_DEFAULT.onDemand.L)},{' '}
        {m2(PRICEBOOK_DEFAULT.onDemand.A)} and {m2(PRICEBOOK_DEFAULT.onDemand.B)} for the L-, A- and B-class, reserved hours for less, spot hours for less still — the
        starting design takes in {k1(N.listRevenue)} a week and spends {k1(N.listPower)} on electricity, against {k1(N.listFixed)} of capital and upkeep that it owes
        whether its GPUs are busy or not (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). It loses {k1(-N.listProfit)} a week. This lesson sets the cloud’s own
        price book: a price per GPU-hour for each accelerator in each of the three tiers. The text describes the starting fleet, customers and plan, and the
        demonstrations show them until you switch to your own:
      </P>
      <SoFar parts={['fleet', 'customers', 'ops']} />
      <P>
        Nothing about how customers respond is new. Each compares what its work would cost per A-class-equivalent hour on each accelerator — the hour’s price divided by
        how much of its work that GPU does, the comparison of <a href={lessonHref('compute/5.1')}>Lesson 5.1</a> — and buys where it is cheapest, falling back to dearer
        ones when that is full. And each customer is a crowd of buyers like the buyers of <a href={lessonHref('compute/5.5')}>Lesson 5.5</a>, with values spread evenly
        from half to one and a half times its stated value: the higher the <K c="price">price</K> of its work, the fewer of them buy. In the next demonstration, each row
        is a customer. The pale band is the range of its buyers’ values; the marks are what its work costs on each accelerator in the fleet, its first choice in bold,
        and the darker part of the band is the share that buys there; the columns on the right give that share, how much of its work the fleet served this week,
        and the revenue it brought in. The readouts run a week under the operating plan (by default, the first come, first served plan
        of Lesson 7.4). Besides revenue and profit, they show the week’s contribution margin, as in <a href={lessonHref('compute/6.1')}>Lesson 6.1</a>: revenue minus the
        electricity the GPUs draw, the money left to pay the fleet’s fixed costs. Choose a tier and set its prices; every change is saved to your cloud:
      </P>

      <Figure name="Compute Market Simulator" onReset={() => confirmResetPart('prices')}>
        {basisSwitch}
        <Segmented label="Price tier" value={tier} onChange={(t) => tierPick.set({ tier: t })} options={TIERS.map((t) => ({ value: t, label: TIER_NAME[t] }))} />
        <OfferChart offs={offs} d={d} week={week} />
        {GPU_IDS.map((g) => (
          <Slider
            key={g}
            label={`${GPU_SHORT[g]}, ${TIER_NAME[tier].toLowerCase()}`}
            tone="green"
            value={d.prices[tier][g]}
            min={0}
            max={PRICE_MAX[g]}
            step={PRICE_STEP}
            onChange={(v) => setPrice(tier, g, v)}
            display={`${m2(d.prices[tier][g])} per GPU-hour`}
          />
        ))}
        <Readouts
          items={[
            { label: 'revenue this week', value: k1(week.revenue), tone: 'green' },
            { label: 'contribution margin', value: k1(week.margin), tone: 'green' },
            { label: 'profit this week', value: k1(week.profit), tone: week.profit < 0 ? 'red' : 'green' },
            { label: 'profit at list prices', value: k1(list.profit), tone: list.profit < 0 ? 'red' : 'green' },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At the list prices, every customer of the starting design finds its work cheapest on the B-class. An hour of it costs twice an A-class hour, but it does{' '}
        {fmt(N.prodBMin, 1)} to {fmt(N.prodBMax, 1)} times as much of their work — the productivities of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>, set by
        memory, bandwidth and links. The chat startup’s work costs {m2(N.chatOnB)} per A-class-equivalent hour on the B-class and {m2(N.chatOnA)} on the A-class. But
        there aren’t enough B-class GPUs. The two reserved customers come first, and between them they take all {fmt(N.frontierCommitB + N.trainerCommitB)}: the
        frontier lab {fmt(N.frontierCommitB)} and the model trainer {fmt(N.trainerCommitB)}, plus {fmt(N.trainerCommitA)} A-class GPUs. So the chat startup, whose first
        choice is also the B-class, runs on the A-class, where only {pct(N.chatShareA)} of its buyers will pay. The B-class is busy {pct(N.listUtil.B)} of the week, the
        A-class {pct(N.listUtil.A)} and the L-class {pct(N.listUtil.L)}.
      </P>

      <H2>Pricing the scarce hours</H2>
      <P>
        The full B-class is the clue. The frontier lab pays {m2(N.frontierOnB)} per A-class-equivalent hour of its work on a B-class GPU, and {m2(PRICEBOOK_DEFAULT.reserved.A)}{' '}
        on an A-class one, while its buyers value that hour at around {m2(N.frontierValue)}. Choose the reserved tier in the demonstration:
      </P>

      <Challenge
        id="a"
        question={`Predict first: will the reserved B-class price that earns the most land above or below the list’s ${m2(PRICEBOOK_DEFAULT.reserved.B)} — and how far can it go before the frontier lab would rather buy A-class hours? Then, with the rest of the price book as it is, set the reserved B-class price where the week earns the most.`}
        solved={solvedA}
        status={statusA}
        success={successA}
      />

      <P>
        The lab’s substitute sets the limit. A reserved A-class hour costs {m2(PRICEBOOK_DEFAULT.reserved.A)}, and a B-class GPU does {fmt(N.prodFrontierB, 2)} of them for
        the 400B model, so the ceiling is {m2(PRICEBOOK_DEFAULT.reserved.A)} × {fmt(N.prodFrontierB, 2)} = {m2(N.ceilingRaw)} a B-class hour. This is the opportunity cost
        of <a href={lessonHref('compute/6.1')}>Lesson 6.1</a>, read from the buyer’s side. At {m2(N.ceiling)} the rows rearrange. The model trainer, whose work the B-class
        does only {fmt(N.prodTrainB, 2)} times over, finds A-class hours cheaper and moves there, taking {fmt(N.ceilTrainerCommitA)} reserved A-class GPUs. The frontier lab
        stays, and pays {k1(N.ceilFrontierRevenue)} a week instead of {k1(N.frontierRevenueList)}. The {fmt(N.ceilFreedB)} B-class GPUs the trainer gave up go to the
        customers buying on demand, and the week turns from a loss of {k1(-N.listProfit)} to a profit of {k1(N.ceilProfit)}. Five cents more and the frontier lab moves to
        the A-class too: the profit falls to {k1(N.pastProfit)}. The best price for a scarce hour sits just below the price of its nearest substitute. Raising every list
        price by 10% instead adds only {pct(N.up10Gain, 1)} to the week’s contribution margin: on the GPUs that aren’t full, higher prices send buyers away.
      </P>

      <H2>Demand curves</H2>
      <P>
        Every price trades the buyers it loses against the extra it earns from those who stay. In the next demonstration, choose one price; the upper curve is the week’s
        profit at every value of it, with the rest of your price book unchanged, and the lower curve how busy that accelerator is. The slider sets the price itself, so the
        change is saved, as in <FigRef to="Compute Market Simulator">the first demonstration</FigRef>:
      </P>

      <Figure name="Compute Market Simulator · demand curve" scenario={s2}>
        {basisSwitch}
        <Segmented label="Tier to sweep" value={t2} onChange={(t) => s2.set({ tier: t })} options={TIERS.map((t) => ({ value: t, label: TIER_NAME[t] }))} />
        <Segmented label="Accelerator to sweep" value={g2} onChange={(g) => s2.set({ gpu: g })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <SweepChart s={sweep} current={d.prices[t2][g2]} best={best2} g={g2} tier={t2} showBest={solvedB} />
        <Slider
          label={`${GPU_SHORT[g2]}, ${TIER_NAME[t2].toLowerCase()}`}
          tone="green"
          value={d.prices[t2][g2]}
          min={0}
          max={PRICE_MAX[g2]}
          step={PRICE_STEP}
          onChange={(v) => setPrice(t2, g2, v)}
          display={`${m2(d.prices[t2][g2])} per GPU-hour`}
        />
        <Readouts
          items={[
            { label: 'profit at this price', value: k1(week.profit), tone: week.profit < 0 ? 'red' : 'green' },
            ...(solvedB ? [{ label: 'most profit', value: `${k1(best2.profit)} at ${m2(best2.price)}`, tone: 'green' as const }] : []),
            { label: `${GPU_SHORT[g2]} busy`, value: pct(week.utilization[g2]) },
          ]}
        />
      </Figure>

      <P>
        Two shapes appear. The reserved B-class curve, which the demonstration starts on, climbs in a straight line: every B-class hour is spoken for whatever it
        costs, so a higher price is pure gain. Then it falls off two cliffs, one for each reserved customer reaching its substitute. Past{' '}
        {m2(N.trainerLast)} ({m2(PRICEBOOK_DEFAULT.reserved.A)} × {fmt(N.prodTrainB, 2)} = {m2(N.trainerCeilingRaw)}) the model trainer moves to the A-class, and the
        week’s profit drops from {k1(N.trainerStayProfit)} to {k1(N.trainerGoneProfit)}; it climbs again to {k1(N.ceilProfit)} at {m2(N.ceiling)}, the last price the
        frontier lab will pay. At {m2(N.ceiling + PRICE_STEP)} the lab leaves too, and beyond that the reserved B-class price stops mattering, because nobody pays it. The
        busy line hardly moves: the customers buying on demand take up the freed B-class hours. What changes is who pays for them, and how much.
      </P>
      <P>
        The A-class is a different case. Choose its on-demand price in this demonstration:
      </P>

      <Challenge
        id="b"
        figure="Compute Market Simulator · demand curve"
        question={`Predict first: the A-class isn’t full — ${pct(1 - week.utilization.A)} of its hours sit idle this week — so will the on-demand A-class price that earns the most land above or below the list’s ${m2(PRICEBOOK_DEFAULT.onDemand.A)}? Then, with the rest of your price book as it is, set it there.`}
        solved={solvedB}
        status={statusB}
        success={successB}
      />

      <P>
        Each step up both earns more from the buyers who stay and sends some away, and the curve rounds over: at the list prices of the other tiers, the most profit comes
        at {m2(N.odaListBest.price)}, {k1(N.odaListBest.profit)} a week, above the list price even with a fifth of the A-class idle. Where the peak lands depends on
        everything else in the book. With the reserved B-class at {m2(N.ceiling)}, the best on-demand A-class price is {m2(N.odaCeilBest.price)}, and the week earns{' '}
        {k1(N.odaCeilBest.profit)}.
      </P>

      <H2>What sets the prices</H2>
      <P>
        Neither ceiling was a matter of taste. The reserved B-class price stopped at the frontier lab’s substitute, and the substitute was fixed by physics. The 400B
        model fits on four B-class GPUs but needs a full server of eight A-class GPUs, which alone would double what each B-class GPU does for it; the B-class’s faster
        arithmetic and memory, and the room its 192 GB leave for a bigger batch, do the rest (<a href={lessonHref('compute/3.2')}>Lesson 3.2</a>). Together they make one B-class hour
        worth {fmt(N.prodFrontierB, 2)} A-class hours of the lab’s work, the productivity of <a href={lessonHref('compute/6.1')}>Lesson 6.1</a>. Change the physics in <a href={lessonHref('compute/7.1')}>Lesson 7.1</a> — warm the supply air until the
        B-class throttles, or overload the network so training slows — and the productivities, the substitutes and the best prices all move with it. The on-demand A-class
        price stopped where the chat startup’s buyers, spread around its value, began to leave faster than the rest paid more.
      </P>
      <P>
        Our cloud has an easy time of it in one respect: its customers’ only alternative is not to buy. A real cloud’s customers can rent from a rival, and a rival’s list
        price caps what anyone can charge, the way the market prices of Lesson 5.5 did. The numbers here are simulated; the reasoning — find the scarce capacity, price it
        up to its substitute, and price the rest against how buyers respond — is the same.
      </P>
      <P>
        A price book only says who will buy. Whether the fleet can actually serve them, hour by hour, depends on how its GPUs are dispatched, and on whether it rents
        capacity from others or sends overflow to them. That is the operating plan, the subject of <a href={lessonHref('compute/7.4')}>Lesson 7.4</a>.
      </P>
    </LessonPage>
  );
}
