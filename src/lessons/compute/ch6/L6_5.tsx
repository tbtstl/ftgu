import { useMemo } from 'react';
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
import { CONTRACT_DEFAULTS, HOURS_PER_QUARTER, dropFromRatio, runContract, type ContractParams, type ContractResult } from '../../../engines/compute/contracts';
import { breakEvenMarketPrice, rankedPaths, type PathDetail } from '../../../engines/compute/contractPaths';
import { PHYSICS_DEFAULTS, productivityUnder } from '../../../engines/compute/yieldManager';
import { ACCELERATORS, GPU_COLOR } from '../../../model/compute/hardware';
import { PRICES } from '../../../model/compute/prices';
import { PLANNER_DEFAULTS, costOf } from '../ch4/L4_5';

// ---------------------------------------------------------------------------
// The contract desk: one contract, a world of physical drivers, and 1,000 simulated paths.

/** The B-class's simulated list price and the A-class's starting market price, $ per GPU-hour. */
const B_PRICE = PRICES.B.onDemand;
const A_PRICE = PRICES.A.onDemand;

export interface DeskState {
  /** Paid to the owner for every contracted GPU-hour, $. */
  price: number;
  /** Share of the capacity sold forward for the whole term, %. */
  hedge: number;
  /** Fixed price of the forward sale, $ per GPU-hour. */
  hedgePrice: number;
  /** 0-based quarter in which the B-class is expected to reach volume (± 2 quarters). */
  arrival: number;
  /** A-class GPUs’ worth of work one B-class GPU does (Lesson 6.1's measure). */
  ratio: number;
  /** Share of GPU-hours lost to failures and repairs, %. */
  failure: number;
  /** Share of unhedged hours resold, on average, %. */
  resale: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const PROD = productivityUnder(PHYSICS_DEFAULTS);
/** A-class hours of the chat assistant's work one B-class GPU does (Lesson 6.1). */
export const CHAT_RATIO = round2(PROD.chat70.B);
/** The same for the frontier assistant (Lesson 6.1). */
export const FRONTIER_RATIO = round2(PROD.frontier400.B);

export const DESK_DEFAULTS: DeskState = {
  price: CONTRACT_DEFAULTS.contractPrice,
  hedge: 0,
  hedgePrice: CONTRACT_DEFAULTS.hedgePrice,
  arrival: CONTRACT_DEFAULTS.bArrival,
  ratio: CHAT_RATIO,
  failure: CONTRACT_DEFAULTS.failureShare * 100,
  resale: CONTRACT_DEFAULTS.resaleShare * 100,
};

/** Slider ranges. The earliest arrival keeps every path's arrival inside the term (5 − 2 ≥ 0). */
export const ARRIVAL_MIN = 2;
export const ARRIVAL_MAX = 14;
export const PRICE_STEP = 0.01;
export const HEDGE_STEP = 5;

/** GPU-hours the reseller pays for over the term. */
export const TERM_HOURS = CONTRACT_DEFAULTS.gpus * HOURS_PER_QUARTER * CONTRACT_DEFAULTS.termQuarters;
/**
 * What one cent off the contract price adds to every path's net present value: a cent on each
 * contracted GPU-hour, each quarter's discounted as the engine discounts its cash, $.
 */
export const CENT_VALUE = (() => {
  const q = (1 + CONTRACT_DEFAULTS.rate) ** 0.25;
  let d = 0;
  for (let i = 0; i < CONTRACT_DEFAULTS.termQuarters; i++) d += 1 / q ** (i + 1);
  return CONTRACT_DEFAULTS.gpus * HOURS_PER_QUARTER * d * 0.01;
})();

/**
 * The fall in an A-class hour's price once B-class hours are plentiful: at list prices, how far below
 * the A-class's price a B-class hour costs per A-class hour of work (Lesson 5.1's parity). The engine
 * applies it as that proportional fall to whatever the A-class hour fetches by then.
 */
export function dropOf(ratio: number): number {
  return dropFromRatio(B_PRICE, ratio, A_PRICE);
}

export function paramsOf(s: DeskState): ContractParams {
  return {
    ...CONTRACT_DEFAULTS,
    contractPrice: s.price,
    hedgeShare: s.hedge / 100,
    hedgePrice: s.hedgePrice,
    bArrival: s.arrival,
    bDrop: dropOf(s.ratio),
    failureShare: s.failure / 100,
    resaleShare: s.resale / 100,
  };
}

const runCache = new Map<string, ContractResult>();
/** The contract's distribution for a desk state (cached: a run is about 2–3 ms). */
export function deskRun(s: DeskState): ContractResult {
  const key = JSON.stringify(s);
  let r = runCache.get(key);
  if (!r) {
    r = runContract(paramsOf(s));
    if (runCache.size > 300) runCache.clear();
    runCache.set(key, r);
  }
  return r;
}

/** The world as it starts: the B-class's arrival and ratio, failures and resales. */
export function startingWorld(s: DeskState): boolean {
  const D = DESK_DEFAULTS;
  return s.arrival === D.arrival && s.ratio === D.ratio && s.failure === D.failure && s.resale === D.resale;
}

/** Challenge a: unhedged, in the starting world, the highest contract price (to the cent) at which the 5th-percentile path doesn't lose money. */
export function priceSolved(s: DeskState): boolean {
  if (s.hedge !== 0 || !startingWorld(s)) return false;
  if (deskRun(s).p5 < 0) return false;
  return deskRun({ ...s, price: round2(s.price + PRICE_STEP) }).p5 < 0;
}

/** The contract price, the forward price and the world as they start: the conditions challenge b sets. */
export function startingTerms(s: DeskState): boolean {
  const D = DESK_DEFAULTS;
  return s.price === D.price && s.hedgePrice === D.hedgePrice && s.arrival === D.arrival && s.ratio === D.ratio && s.failure === D.failure && s.resale === D.resale;
}

/** Challenge b: with the starting prices and world, the smallest share sold forward (in 5% steps) that keeps the 5th-percentile outcome from losing money. */
export function hedgeSolved(s: DeskState): boolean {
  if (!startingTerms(s)) return false;
  if (deskRun(s).p5 < 0) return false;
  return s.hedge === 0 || deskRun({ ...s, hedge: s.hedge - HEDGE_STEP }).p5 < 0;
}

/** The highest price on the cent grid at which the unhedged 5th-percentile path doesn't lose money, in a given world. */
export function priceAnswer(s: DeskState): number {
  let best = NaN;
  for (let p = 0.8; p <= 2.0 + 1e-9; p += PRICE_STEP) {
    const price = round2(p);
    if (deskRun({ ...s, price, hedge: 0 }).p5 >= 0) best = price;
  }
  return best;
}

/** The smallest hedge share that solves challenge b for the state's prices and world (NaN if none). */
export function hedgeAnswer(s: DeskState): number {
  for (let h = 0; h <= 100; h += HEDGE_STEP) if (deskRun({ ...s, hedge: h }).p5 >= 0) return h;
  return NaN;
}

const pathCache = new Map<string, PathDetail[]>();
export function pathsOf(s: DeskState): PathDetail[] {
  const key = JSON.stringify(s);
  let p = pathCache.get(key);
  if (!p) {
    p = rankedPaths(paramsOf(s));
    if (pathCache.size > 50) pathCache.clear();
    pathCache.set(key, p);
  }
  return p;
}

/** Rank (1 = worst) of the worst path that still makes money, or NaN if none does. */
export function firstProfitableRank(s: DeskState): number {
  const ps = pathsOf(s);
  const i = ps.findIndex((p) => p.npv >= 0);
  return i < 0 ? NaN : i + 1;
}

/** Challenge c: the path at `rank` is the worst one that still makes money. */
export function pathSolved(s: DeskState, rank: number): boolean {
  return rank === firstProfitableRank(s);
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all computed from the engines.

const D = DESK_DEFAULTS;
const BASE = deskRun(D);
const BREAK_EVEN = breakEvenMarketPrice(paramsOf(D));
/** First 0-based quarter whose median price is below the price at which resales cover the contract. */
const MEDIAN_BELOW = BASE.pricePath.findIndex((x) => x.p50 < BREAK_EVEN);
const OWNER_COST = costOf(PLANNER_DEFAULTS).perHour;
const PRICE_ANSWER = priceAnswer(D);
const HEDGE_ANSWER = hedgeAnswer(D);
const RATIO_ARITH = ACCELERATORS.B.bf16Tflops / ACCELERATORS.A.bf16Tflops;

export const LESSON_NUMBERS = {
  gpus: CONTRACT_DEFAULTS.gpus,
  quarters: CONTRACT_DEFAULTS.termQuarters,
  paths: CONTRACT_DEFAULTS.paths,
  contractPrice: D.price,
  startPrice: A_PRICE,
  bPrice: B_PRICE,
  ratio: D.ratio,
  drop: dropOf(D.ratio),
  aAfter: B_PRICE / D.ratio,
  drift: CONTRACT_DEFAULTS.drift,
  vol: CONTRACT_DEFAULTS.vol,
  spread: CONTRACT_DEFAULTS.bArrivalSpread,
  rate: CONTRACT_DEFAULTS.rate,
  resale: D.resale / 100,
  failure: D.failure / 100,
  hedgePrice: D.hedgePrice,
  ownerCost: OWNER_COST,
  mean: BASE.mean,
  sd: BASE.sd,
  /** Share of paths within one standard deviation of the mean. */
  withinSd: BASE.npvs.filter((x) => Math.abs(x - BASE.mean) <= BASE.sd).length / BASE.npvs.length,
  p5: BASE.p5,
  p95: BASE.p95,
  probLoss: BASE.probLoss,
  worst: BASE.npvs[0],
  best: BASE.npvs[BASE.npvs.length - 1],
  breakEven: BREAK_EVEN,
  medianBelowQuarter: MEDIAN_BELOW + 1,
  medianLast: BASE.pricePath[BASE.pricePath.length - 1].p50,
  early: deskRun({ ...D, arrival: ARRIVAL_MIN }).probLoss,
  never: deskRun({ ...D, arrival: ARRIVAL_MAX }).probLoss,
  ratioArith: RATIO_ARITH,
  arithLoss: deskRun({ ...D, ratio: round2(RATIO_ARITH) }).probLoss,
  ratioFrontier: FRONTIER_RATIO,
  ratioFrontierLoss: deskRun({ ...D, ratio: FRONTIER_RATIO }).probLoss,
  ratioFrontierDrop: dropOf(FRONTIER_RATIO),
  fail10Loss: deskRun({ ...D, failure: 10 }).probLoss,
  resale70Loss: deskRun({ ...D, resale: 70 }).probLoss,
  resale90Loss: deskRun({ ...D, resale: 90 }).probLoss,
  termHours: TERM_HOURS,
  centValue: CENT_VALUE,
  /** Challenge a: the price at which the 5th-percentile path just breaks even, and the cent grid's answer. */
  priceExact: D.price + BASE.p5 / (CENT_VALUE * 100),
  priceAnswer: PRICE_ANSWER,
  priceAnswerP5: deskRun({ ...D, price: PRICE_ANSWER }).p5,
  priceNextP5: deskRun({ ...D, price: round2(PRICE_ANSWER + PRICE_STEP) }).p5,
  priceAnswerLoss: deskRun({ ...D, price: PRICE_ANSWER }).probLoss,
  priceAnswerMean: deskRun({ ...D, price: PRICE_ANSWER }).mean,
  priceAnswerSd: deskRun({ ...D, price: PRICE_ANSWER }).sd,
  hedge50Mean: deskRun({ ...D, hedge: 50 }).mean,
  hedge50Loss: deskRun({ ...D, hedge: 50 }).probLoss,
  hedge100: deskRun({ ...D, hedge: 100 }).mean,
  hedgeAnswer: HEDGE_ANSWER,
  hedgeAnswerP5: deskRun({ ...D, hedge: HEDGE_ANSWER }).p5,
  hedgeAnswerMean: deskRun({ ...D, hedge: HEDGE_ANSWER }).mean,
  hedgeAnswerLoss: deskRun({ ...D, hedge: HEDGE_ANSWER }).probLoss,
  hedgeAnswerSd: deskRun({ ...D, hedge: HEDGE_ANSWER }).sd,
  hedgeBelowP5: deskRun({ ...D, hedge: HEDGE_ANSWER - HEDGE_STEP }).p5,
  firstProfitable: firstProfitableRank(D),
};

const N = LESSON_NUMBERS;

// ---------------------------------------------------------------------------
// Formatting.

/** "$1.85M", "−$1.61M". */
function m$(x: number, digits = 2): string {
  return usd(x / 1e6, digits) + 'M';
}
/** "$1.85 million". */
function million(x: number, digits = 2): string {
  return usd(x / 1e6, digits) + ' million';
}
function pctOf(x: number, digits = 0): string {
  return `${fmt(x * 100, digits)}%`;
}
function quarterLabel(q0: number): string {
  return q0 >= CONTRACT_DEFAULTS.termQuarters ? 'after the term' : `Q${q0 + 1}`;
}

const GREEN = GRAPHIC.green;
const RED = GRAPHIC.red;
const B_COLOR = GPU_COLOR.B;

// ---------------------------------------------------------------------------
// Figure 1's charts.

function Histogram({ r }: { r: ContractResult }) {
  const x0 = 64;
  const x1 = 616;
  const top = 26;
  const bot = 138;
  const lo = r.npvs[0] / 1e6;
  const hi = r.npvs[r.npvs.length - 1] / 1e6;
  const [d0, d1] = niceDomain(Math.min(lo, -0.5), Math.max(hi, 0.5), 6);
  const bins = 36;
  const w = (d1 - d0) / bins;
  const counts = Array<number>(bins).fill(0);
  for (const v of r.npvs) counts[Math.min(bins - 1, Math.max(0, Math.floor((v / 1e6 - d0) / w)))]++;
  const cmax = Math.max(...counts, 1);
  const sx = scale(d0, d1, x0, x1);
  const sy = scale(0, cmax, bot, top);
  const ticks = niceTicks(d0, d1, 6);
  const marks = [
    { v: r.mean / 1e6, label: 'mean', color: '#333', dash: undefined as string | undefined },
    { v: r.p5 / 1e6, label: '5th percentile', color: TEXT.red, dash: '4 3' },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 172"
      role="img"
      aria-label={`Net present value of the contract over ${fmt(r.npvs.length)} simulated paths: mean ${m$(r.mean)}, 5th percentile ${m$(r.p5)}, 95th percentile ${m$(r.p95)}; ${pctOf(r.probLoss, 1)} of paths lose money.`}
    >
      <text className="ax" x={x0} y={12}>
        Paths, by the contract’s net present value
      </text>
      {counts.map((c, i) => {
        const a = d0 + i * w;
        const mid = a + w / 2;
        return c > 0 ? <rect key={i} x={sx(a) + 0.5} width={Math.max(0.5, sx(a + w) - sx(a) - 1)} y={sy(c)} height={bot - sy(c)} fill={mid < 0 ? tint(RED, 0.7) : tint(GREEN, 0.7)} /> : null;
      })}
      <line className="base" x1={x0} x2={x1} y1={bot} y2={bot} />
      <line x1={sx(0)} x2={sx(0)} y1={top - 6} y2={bot} stroke="#999" strokeWidth={1} />
      {marks.map((mk, i) => {
        // The mean's label reads rightward and the 5th percentile's leftward, unless that would run off the chart.
        const right = i === 0 ? sx(mk.v) < x1 - 150 : sx(mk.v) < x0 + 150;
        return (
          <g key={mk.label}>
            <line x1={sx(mk.v)} x2={sx(mk.v)} y1={top - 4} y2={bot} stroke={mk.color} strokeWidth={1.5} strokeDasharray={mk.dash} />
            <text className="ax" x={sx(mk.v) + (right ? 4 : -4)} y={top + 6 + i * 13} style={{ textAnchor: right ? 'start' : 'end', fill: mk.color }}>
              {mk.label}
            </text>
          </g>
        );
      })}
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={154}>
          {t === 0 ? '$0' : `${t < 0 ? '−' : ''}$${fmt(Math.abs(t), Number.isInteger(t) ? 0 : 1)}M`}
        </text>
      ))}
      <text className="ax ax-e" x={x1} y={168}>
        losing paths in red
      </text>
    </svg>
  );
}

function PriceFan({ r, s }: { r: ContractResult; s: DeskState }) {
  const x0 = 64;
  const x1 = 616;
  const top = 26;
  const bot = 150;
  const n = r.pricePath.length;
  const sx = scale(0.5, n + 0.5, x0, x1);
  const sy = scale(0, 3.2, bot, top);
  const xs = r.pricePath.map((_, q) => sx(q + 1));
  const be = breakEvenMarketPrice(paramsOf(s));
  const a0 = s.arrival - CONTRACT_DEFAULTS.bArrivalSpread;
  const a1 = s.arrival + CONTRACT_DEFAULTS.bArrivalSpread;
  const inTerm = a0 < n;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 186"
      role="img"
      aria-label={`The market price of an A-class hour over the term: median ${usd(r.pricePath[0].p50, 2)} in Q1 falling to ${usd(r.pricePath[n - 1].p50, 2)} in Q${n}, with 90% of paths between ${usd(r.pricePath[n - 1].p5, 2)} and ${usd(r.pricePath[n - 1].p95, 2)}. Resold hours cover the contract at a market price of ${usd(be, 2)}.`}
    >
      <text className="ax" x={x0} y={12}>
        Market price of an A-class hour, $ (median and 90% of paths)
      </text>
      {inTerm && (
        <g>
          <rect x={sx(Math.max(0, a0) + 0.5)} y={top} width={sx(Math.min(n - 1, a1) + 1.5) - sx(Math.max(0, a0) + 0.5)} height={bot - top} fill={tint(B_COLOR, 0.14)} />
          <text className="ax" x={sx(Math.max(0, a0) + 0.5) + 4} y={bot - 6} style={{ fill: TEXT.teal }}>
            B-class arrives
          </text>
        </g>
      )}
      <GridY y={sy} ticks={[0, 1, 2, 3]} x0={x0} x1={x1} format={(v) => `$${v}`} baseline={0} />
      <path d={areaPath(xs, r.pricePath.map((x) => sy(x.p95)), r.pricePath.map((x) => sy(x.p5)))} fill={tint(GREEN, 0.3)} />
      <path d={linePath(xs, r.pricePath.map((x) => sy(x.p50)))} fill="none" stroke={GREEN} strokeWidth={2.5} strokeLinejoin="round" />
      <line x1={x0} x2={x1} y1={sy(be)} y2={sy(be)} stroke={RED} strokeWidth={1.5} strokeDasharray="6 4" />
      <text className="ax ax-e" x={x1} y={sy(be) - 5} style={{ fill: TEXT.red }}>
        resales cover the contract above {usd(be, 2)}
      </text>
      {s.hedge > 0 && (
        <g>
          <line x1={x0} x2={x1} y1={sy(s.hedgePrice)} y2={sy(s.hedgePrice)} stroke="#555" strokeWidth={1.2} strokeDasharray="2 3" />
          <text className="ax" x={x0 + 4} y={sy(s.hedgePrice) - 5}>
            forward price {usd(s.hedgePrice, 2)}
          </text>
        </g>
      )}
      {r.pricePath.map((_, q) => (
        <text key={q} className="ax ax-m" x={sx(q + 1)} y={170}>
          Q{q + 1}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2's chart: one path, quarter by quarter.

function PathChart({ path, s, rank }: { path: PathDetail; s: DeskState; rank: number }) {
  const x0 = 64;
  const x1 = 616;
  const n = path.quarters.length;
  const sx = scale(0.5, n + 0.5, x0, x1);
  const t1 = 26;
  const b1 = 118;
  const sy = scale(0, 3.2, b1, t1);
  const xs = path.quarters.map((_, q) => sx(q + 1));
  const cash = path.quarters.map((x) => x.cash / 1e6);
  const cum: number[] = [];
  let run = 0;
  for (const x of path.quarters) cum.push((run += x.discounted) / 1e6);
  const [c0, c1] = niceDomain(Math.min(0, ...cash, ...cum), Math.max(0.1, ...cash, ...cum), 4);
  const t2 = 152;
  const b2 = 236;
  const cy = scale(c0, c1, b2, t2);
  const bw = (sx(2) - sx(1)) * 0.55;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 270"
      role="img"
      aria-label={`Path ${rank} of ${fmt(CONTRACT_DEFAULTS.paths)}, from the worst: the B-class arrives ${quarterLabel(path.arrival)}; the market price ends at ${usd(path.quarters[n - 1].price, 2)}; the contract's net present value is ${m$(path.npv)}.`}
    >
      <text className="ax" x={x0} y={12}>
        $ per contracted GPU-hour
      </text>
      {path.arrival < n && (
        <g>
          <line x1={sx(path.arrival + 0.5)} x2={sx(path.arrival + 0.5)} y1={t1 - 4} y2={b2} stroke={B_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />
          <text className="ax" x={sx(path.arrival + 0.5) + 4} y={t1 + 6} style={{ fill: TEXT.teal }}>
            B-class arrives
          </text>
        </g>
      )}
      <GridY y={sy} ticks={[0, 1, 2, 3]} x0={x0} x1={x1} format={(v) => `$${v}`} baseline={0} />
      <line x1={x0} x2={x1} y1={sy(s.price)} y2={sy(s.price)} stroke={RED} strokeWidth={1.5} strokeDasharray="6 4" />
      <path d={linePath(xs, path.quarters.map((x) => sy(x.price)))} fill="none" stroke={GREEN} strokeWidth={2.5} strokeLinejoin="round" />
      <path d={linePath(xs, path.quarters.map((x) => sy(x.earnedPerHour)))} fill="none" stroke="#333" strokeWidth={2} strokeLinejoin="round" />
      {path.quarters.map((x, q) => (
        <circle key={q} cx={xs[q]} cy={sy(x.earnedPerHour)} r={3} fill={x.earnedPerHour >= s.price ? GREEN : RED} />
      ))}
      <text className="ax" x={x0} y={146}>
        Cash each quarter, and the contract’s value so far (discounted), $M
      </text>
      <GridY y={cy} ticks={niceTicks(c0, c1, 4)} x0={x0} x1={x1} format={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Number.isInteger(v) ? 0 : 1)}M`} baseline={0} />
      {cash.map((c, q) => (
        <rect key={q} x={xs[q] - bw / 2} width={bw} y={Math.min(cy(0), cy(c))} height={Math.abs(cy(c) - cy(0))} fill={c >= 0 ? tint(GREEN, 0.75) : tint(RED, 0.75)} />
      ))}
      <path d={linePath(xs, cum.map(cy))} fill="none" stroke="#333" strokeWidth={1.5} strokeDasharray="5 3" />
      {path.quarters.map((_, q) => (
        <text key={q} className="ax ax-m" x={xs[q]} y={256}>
          Q{q + 1}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const desk = useScenario('desk', DESK_DEFAULTS);
  const s = desk.state;
  const r = useMemo(() => deskRun(s), [s]);
  const solvedA = useMemo(() => priceSolved(s), [s]);
  const solvedB = useMemo(() => hedgeSolved(s), [s]);
  const be = breakEvenMarketPrice(paramsOf(s));

  const one = useScenario('one-path', { rank: 51 });
  const paths = useMemo(() => pathsOf(s), [s]);
  const rank = Math.max(1, Math.min(paths.length, one.state.rank));
  const path = paths[rank - 1];
  const firstProfit = useMemo(() => firstProfitableRank(s), [s]);
  const solvedC = Number.isFinite(firstProfit) && rank === firstProfit;
  const worstQuarter = path.quarters.reduce((a, b) => (b.cash < a.cash ? b : a));

  const statusA =
    s.hedge !== 0
      ? 'Set the share sold forward to 0%: this challenge is about the contract on its own.'
      : !startingWorld(s)
        ? 'Return the world to its starting settings first (Reset restores everything).'
        : s.price === DESK_DEFAULTS.price
          ? 'Make your prediction, then set the contract price to it.'
          : `At ${usd(s.price, 2)} the 5th percentile is ${m$(r.p5)}. Is this the price you predicted? Check a cent either side.`;
  const below = s.hedge >= HEDGE_STEP ? deskRun({ ...s, hedge: s.hedge - HEDGE_STEP }) : null;
  const statusB = !startingTerms(s)
    ? `Return the contract price to ${usd(DESK_DEFAULTS.price, 2)}, the forward price to ${usd(DESK_DEFAULTS.hedgePrice, 2)} and the world to its starting settings first (Reset restores everything; then raise the share sold forward).`
    : r.p5 < 0
      ? `Selling ${fmt(s.hedge)}% forward, the 5th-percentile outcome is ${m$(r.p5)}: still a loss.`
      : below
        ? `The 5th percentile is ${m$(r.p5)}, and it stays at ${m$(below.p5)} with ${fmt(s.hedge - HEDGE_STEP)}% sold forward. Could you sell less?`
        : `The 5th percentile is ${m$(r.p5)}.`;
  const statusC = !Number.isFinite(firstProfit)
    ? 'In this world every path loses money. Lower the contract price or sell some capacity forward in the first demonstration.'
    : rank === 51
      ? 'Make your prediction from the chance of loss, then set the path to it.'
      : `Path ${rank} ${path.npv < 0 ? 'loses' : 'makes'} money. Is it the path you predicted, and does the one below it lose?`;

  /** What the second demonstration is showing: the contract as the first demonstration left it. */
  const terms = `${usd(s.price, 2)} an hour, ${fmt(s.hedge)}% sold forward${s.hedge > 0 ? ` at ${usd(s.hedgePrice, 2)}` : ''}${startingWorld(s) ? ', the starting world' : ', a changed world'}`;

  return (
    <LessonPage id="compute/6.5">
      <P>
        The previous lesson found electricity a small lever on the economics of a GPU-hour. The large costs are the hardware and the building, paid for up front and
        recovered over years (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>), and anyone who commits to capacity for years takes on a bet about what its hours
        will be worth. Lesson 4.5 called it the server-life bet. This lesson puts a price on it, from the side of someone who doesn’t own the GPUs at all.
      </P>
      <P>
        A reseller — a smaller GPU cloud, say — signs a contract with an owner of {fmt(N.gpus)} A-class 80 GB GPUs. For three years, {fmt(N.quarters)} quarters, it
        will pay <K c="price">{usd(N.contractPrice, 2)}</K> for every hour of every GPU, whether or not it can use them, and it will resell their hours at whatever the
        market pays. It is the reserved contract of <a href={lessonHref('compute/5.4')}>Lesson 5.4</a> seen from the buyer that has to fill it, and the twin of the
        procurement problem of <a href={lessonHref('compute/6.2')}>Lesson 6.2</a>: there the buyer had work and needed capacity; here the reseller has capacity and needs
        work. There is no deep, liquid exchange to lay such a contract off on. Deals like this are struck privately, and every price here is simulated.
      </P>
      <P>
        What the reseller earns depends on four things the earlier chapters measured. The market price of an A-class hour starts at {usd(N.startPrice, 2)} and drifts
        down {pctOf(N.drift)} a quarter, with a quarterly <K tone="ink">volatility</K> of {pctOf(N.vol)}. Volatility is the <K tone="ink">standard deviation</K> of
        the price’s quarterly moves: the square root of their average squared distance from the drift, a measure of how far a typical quarter strays. For moves shaped
        like a bell, about two in three land within one standard deviation, so in about two quarters out of three the price ends within {pctOf(N.vol)} of where the drift
        alone would take it. When the B-class reaches the market in volume — around Q{CONTRACT_DEFAULTS.bArrival + 1}, give or take {fmt(N.spread)} quarters, since
        supply arrives through whichever stage is narrowest (<a href={lessonHref('compute/5.2')}>Lesson 5.2</a>) — buyers compare what each costs per unit of work (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>). For the chat assistant, the largest buyer beside the users, a B-class GPU at {usd(N.bPrice, 2)} does the work of {fmt(N.ratio, 2)} A-class GPUs (
        <a href={lessonHref('compute/6.1')}>Lesson 6.1</a>), so it sells that work for{' '}
        {usd(N.aAfter, 2)} per A-class hour, {pctOf(N.drop)} under the A-class’s {usd(N.startPrice, 2)}. We model its arrival as a {pctOf(N.drop)} fall in whatever an
        A-class hour fetches by then, as if the B-class’s own price drifts down with the market’s. On average {pctOf(N.resale)} of the hours can be resold, varying from quarter to quarter as demand does (
        <a href={lessonHref('compute/5.3')}>Lesson 5.3</a>), and {pctOf(N.failure)} are lost to failures and repairs. Each quarter’s cash is discounted at{' '}
        {pctOf(N.rate)} a year, and {fmt(N.paths)} simulated paths through those uncertainties give the contract’s range of outcomes.
      </P>
      <P>
        In the next demonstration, the bars count the paths by the contract’s net present value — the sum of its discounted cash, losses in red — and the lower chart is
        the market price’s fan, with the price at which resold hours just cover the contract. Set the contract’s terms, then the world it lives in:
      </P>

      <Figure name="Compute Contract Desk" scenario={desk}>
        <Histogram r={r} />
        <PriceFan r={r} s={s} />
        <Readouts
          items={[
            { label: 'mean net present value', value: m$(r.mean), tone: r.mean < 0 ? 'red' : 'green' },
            { label: 'standard deviation', value: m$(r.sd) },
            { label: '5th percentile', value: m$(r.p5), tone: r.p5 < 0 ? 'red' : 'green' },
            { label: 'chance of losing money', value: pctOf(r.probLoss, 1), tone: r.probLoss > 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider label="Contract price" tone="green" value={s.price} min={0.8} max={2} step={PRICE_STEP} onChange={(v) => desk.set({ price: round2(v) })} display={`${usd(s.price, 2)} per GPU-hour`} />
        <Slider label="Sold forward" tone="green" value={s.hedge} min={0} max={100} step={HEDGE_STEP} onChange={(v) => desk.set({ hedge: v })} display={`${fmt(s.hedge)}% of the GPUs`} />
        <Slider label="Forward price" tone="green" value={s.hedgePrice} min={1} max={2} step={0.05} onChange={(v) => desk.set({ hedgePrice: round2(v) })} display={`${usd(s.hedgePrice, 2)} per GPU-hour`} />
        <Slider label="B-class arrives" tone="teal" value={s.arrival} min={ARRIVAL_MIN} max={ARRIVAL_MAX} onChange={(v) => desk.set({ arrival: v })} display={s.arrival >= ARRIVAL_MAX ? 'after the term' : `around Q${s.arrival + 1}`} />
        <Slider label="B-class work per GPU" tone="orange" value={s.ratio} min={2} max={3.2} step={0.01} onChange={(v) => desk.set({ ratio: round2(v) })} display={`${fmt(s.ratio, 2)} A-class GPUs`} />
        <Slider label="Hours lost to failures" tone="red" value={s.failure} min={0} max={10} step={0.5} onChange={(v) => desk.set({ failure: v })} display={`${fmt(s.failure, 1)}%`} />
        <Slider label="Hours resold" value={s.resale} min={50} max={95} onChange={(v) => desk.set({ resale: v })} display={`${fmt(s.resale)}% on average`} />
      </Figure>

      <P>
        At the starting terms the contract is worth {million(N.mean)} on average, which sounds like a good deal until the bars are read. The paths run from{' '}
        {million(N.worst)} to {million(N.best)}, with a standard deviation of {million(N.sd)}: {pctOf(N.withinSd)} of them land within that distance of the mean. One
        in twenty loses {million(-N.p5)} or more — the 5th percentile, the same one-in-twenty bad outcome that <a href={lessonHref('compute/6.2')}>Lesson 6.2</a>{' '}
        called a bad year — and {pctOf(N.probLoss, 1)} of them lose money. A cautious buyer can weigh the mean against the spread, scoring a contract by its mean less
        some part of its standard deviation; the final chapter scores whole businesses that way. The fan shows why so many paths lose. Resold
        hours cover the contract only while an A-class hour fetches more than {usd(N.breakEven, 2)}: the {usd(N.contractPrice, 2)} paid for every hour, divided by the{' '}
        {pctOf(N.resale)} resold and the {pctOf(1 - N.failure)} that don’t fail.
      </P>
      <Eq label="Market price at which resold hours cover the contract">
        <span>break-even price</span>
        <Op>=</Op>
        <Frac top={<K c="price">{usd(s.price, 2)}</K>} bottom={`${fmt(s.resale)}% × ${fmt(100 - s.failure, Number.isInteger(s.failure) ? 0 : 1)}%`} />
        <Op>=</Op>
        <K c="price">{usd(be, 2)}</K>
      </Eq>
      <P>
        The median price falls below that in Q{N.medianBelowQuarter} and ends the term at {usd(N.medianLast, 2)}. The contract makes its money while the A-class is
        young, and gives some of it back as the A-class ages.
      </P>

      <H2>What breaks it</H2>
      <P>
        Every one of those numbers comes from physics, and the lower sliders change the physics. Bring the B-class’s arrival forward to Q{ARRIVAL_MIN + 1} — a supply
        chain whose packaging and memory came through sooner — and {pctOf(N.early, 1)} of paths lose money; push it past the term and only {pctOf(N.never, 1)} do.
        Make the B-class better at the work: at {fmt(N.ratioFrontier, 2)} A-class GPUs’ worth, the frontier assistant’s ratio in Lesson 6.1, the price
        falls by {pctOf(N.ratioFrontierDrop)} when it arrives and the chance of loss is {pctOf(N.ratioFrontierLoss, 1)}. At {fmt(N.ratioArith, 2)}, its edge in raw arithmetic (
        <a href={lessonHref('compute/2.4')}>Lesson 2.4</a>), only {pctOf(N.arithLoss, 1)}. Hardware that fails more — {pctOf(0.1)} of hours lost instead of{' '}
        {pctOf(N.failure)} — takes it to {pctOf(N.fail10Loss, 1)}. Demand matters as well: resell {pctOf(0.7)} of the hours instead of {pctOf(N.resale)} and{' '}
        {pctOf(N.resale70Loss, 1)} of paths lose; resell {pctOf(0.9)} and {pctOf(N.resale90Loss, 1)} do. A contract on GPU-hours is a bet on the next generation’s
        timing and speed, on the hardware’s reliability, and on how busy the customers keep it.
      </P>
      <P>
        Return the world to its starting settings (Reset restores everything) and turn to the one lever the reseller controls: the price it agrees to pay. The price
        moves the distribution in the simplest way. The reseller pays it on every one of the term’s {fmt(N.termHours / 1e6, 1)} million GPU-hours, whatever the
        market does, so a cent off the price adds the same amount to every path: a cent an hour, discounted, about {usd(Math.round(N.centValue / 1000) * 1000)}. The
        histogram slides without changing its shape, and the standard deviation doesn’t move.
      </P>

      <Challenge
        id="a"
        question={`Predict first: at ${usd(DESK_DEFAULTS.price, 2)} the 5th-percentile path loses ${million(-N.p5)}. Without selling any capacity forward, and in the starting world, what is the highest contract price, to the cent, at which even the 5th-percentile path doesn’t lose money? Then set it and check.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${usd(N.priceAnswer, 2)}. Making up ${million(-N.p5)} at about ${usd(Math.round(N.centValue / 1000) * 1000)} a cent takes ${fmt(-N.p5 / N.centValue, 1)} cents off the price, so ${usd(N.priceExact, 3)} just breaks even; at ${usd(N.priceAnswer, 2)} the 5th percentile makes ${m$(N.priceAnswerP5)}, and at a cent more it loses ${m$(-N.priceNextP5)}. Only ${pctOf(N.priceAnswerLoss, 1)} of paths now lose money and the mean rises to ${million(N.priceAnswerMean)}, but the standard deviation is still ${million(N.priceAnswerSd)}: a lower price moves the outcomes without narrowing them. It is also well below the ${usd(N.ownerCost, 2)} an hour the owner needs to pay off an A-class GPU over five years (Lesson 4.5): the gap is the price of the risk, and whoever signs takes it.`}
      />

      <H2>Selling some of it forward</H2>
      <P>
        The reseller can also give the risk away. Suppose a customer — an inference service like the one in <a href={lessonHref('compute/6.2')}>Lesson 6.2</a>, which
        wants certainty — will take a share of the GPUs for the whole term at a fixed <K c="price">{usd(N.hedgePrice, 2)}</K> an hour. Those hours no
        longer care what the market does, when the B-class arrives or how many hours the market would have taken; only failures still touch them. Raise the share sold
        forward in <FigRef to="Compute Contract Desk">the first demonstration</FigRef>. At 50%, the mean falls to {million(N.hedge50Mean)} and the chance of loss to{' '}
        {pctOf(N.hedge50Loss, 1)}. At 100%, every path earns the same {million(N.hedge100)}: certainty, at the cost of everything the open market might have paid.
      </P>

      <Challenge
        id="b"
        figure="Compute Contract Desk"
        question="With the contract price, the forward price and the world as they started, sell forward the smallest share of the GPUs (in steps of 5%) that keeps even the 5th-percentile path from losing money."
        solved={solvedB}
        status={statusB}
        success={`Solved. In the starting world, ${fmt(N.hedgeAnswer)}% sold forward lifts the 5th percentile to ${m$(N.hedgeAnswerP5)}, where ${fmt(N.hedgeAnswer - HEDGE_STEP)}% leaves it at ${m$(N.hedgeBelowP5)}. The mean falls from ${m$(N.mean)} to ${m$(N.hedgeAnswerMean)} and the chance of loss to ${pctOf(N.hedgeAnswerLoss, 1)}: the reseller pays about ${m$(N.mean - N.hedgeAnswerMean)} of expected profit to remove most of its downside. Where challenge a’s lower price slid every path along and left the standard deviation at ${m$(N.sd)}, the forward sale narrows the paths: ${m$(N.hedgeAnswerSd)}.`}
      />

      <P>
        The forward price decides whether that trade is worth making. At {usd(N.hedgePrice, 2)} the customer gets its certainty at a discount to what the
        hours are expected to earn, which is why the mean falls as the share rises; raise the forward price and hedging costs less, or even pays. Real forward deals are
        negotiated, and the discount the buyer of certainty can demand is the market’s price of the risk the reseller is shedding.
      </P>

      <H2>One path at a time</H2>
      <P>
        A distribution hides its stories. In the next demonstration, choose one of the {fmt(N.paths)} paths of the contract as the first demonstration left it, ranked
        from the worst outcome to the best. The upper chart is that path’s market price (green) and what each contracted GPU-hour actually earned (black, its dots red
        in quarters below the contract price, the dashed line); the lower chart is each quarter’s cash and the contract’s discounted value so far. It starts on the 51st
        path from the bottom, the 5th percentile:
      </P>

      <Figure name="Compute Contract Desk · one path" scenario={one}>
        <PathChart path={path} s={s} rank={rank} />
        <Legend
          items={[
            { label: 'Market price of an A-class hour', color: GREEN, kind: 'line' },
            { label: 'Earned per contracted GPU-hour', color: '#333', kind: 'line' },
            { label: 'Contract price', color: RED, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'this path’s net present value', value: m$(path.npv), tone: path.npv < 0 ? 'red' : 'green' },
            { label: 'B-class arrives', value: quarterLabel(path.arrival), tone: 'teal' },
            { label: 'worst quarter', value: `Q${worstQuarter.q + 1}: ${m$(worstQuarter.cash)}`, tone: worstQuarter.cash < 0 ? 'red' : 'green' },
          ]}
        />
        <Slider label="Path, worst to best" value={rank} min={1} max={paths.length} onChange={(v) => one.set({ rank: v })} display={`${fmt(rank)} of ${fmt(paths.length)}`} />
        <Caption>
          The contract as the first demonstration left it: {terms}. {pctOf(r.probLoss, 1)} of its {fmt(paths.length)} paths lose money.
        </Caption>
      </Figure>

      <P>
        Most losing paths share a shape. The B-class arrives early, the price slides below {usd(N.breakEven, 2)} soon after, and from then on every quarter costs money, while
        the early profit was too small to pay for the later losses. Winning paths keep the A-class’s price up for longer: a late arrival, or a few lucky quarters of
        strong demand. Somewhere along the ranking, the losses stop.
      </P>

      <Challenge
        id="c"
        question="Predict first, from the chance of loss the caption gives: counting from the worst, which path is the worst one that still makes money? Then set the path to your prediction and check it."
        solved={solvedC}
        status={statusC}
        success={`Solved. Path ${fmt(rank)} is the first from the bottom to make money, so the ${fmt(rank - 1)} below it all lose: ${pctOf((rank - 1) / paths.length, 1)} of ${fmt(paths.length)}, exactly the chance of loss in the first demonstration. In the starting world it is path ${fmt(N.firstProfitable)}.`}
      />

      <H2>Capacity as a financial asset</H2>
      <P>
        A block of GPU capacity, committed for years, behaves like a financial asset whose value is driven by physics. Its income depends on how much useful work its
        hours can do against the next generation’s, on how often the hardware fails, and on how busy its customers keep it; its risk can be priced, shared out in
        forward sales, or simply accepted in return for a higher expected profit. Unlike electricity, there is no deep, liquid exchange where such risk is traded every day, so these
        contracts are written one at a time, between parties who each have to model the same physics this course has built up.
      </P>
      <P>
        That completes the strategies: allocating a mixed fleet, buying capacity under uncertainty, moving work across regions, scheduling around power, and contracting
        for capacity itself. The final chapter puts them all in one place. In <a href={lessonHref('compute/7.1')}>Lesson 7.1</a>, we start building a GPU cloud of our
        own — its GPUs, servers, power and cooling — and then run it, from customers to prices to profit.
      </P>
    </LessonPage>
  );
}
