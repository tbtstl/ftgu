import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
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
  TEXT,
  fmt,
  lessonHref,
  pct,
  scale,
  stepPath,
  usd,
  useScenario,
} from '../../../framework';
import {
  MARKET_BUYERS,
  MARKET_SUPPLY,
  clearMarket,
  pricesAt,
  productivity,
  variableCost,
  type Buyer,
  type Clearing,
  type Supply,
} from '../../../engines/compute/marketplace';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { PRICES } from '../../../model/compute/prices';
import { SITES, SITE_IDS, type SiteId } from '../../../model/compute/sites';
import { WORKLOADS, type WorkloadId } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The market the reader changes: the latency limit of the two interactive assistants, how much they
// want relative to the reference market, and B-class GPUs added at Tech Park.

export interface MarketState {
  /** Longest round trip the chat and frontier assistants accept, ms. */
  lat: number;
  /** Their demand as a percentage of the reference market's. */
  demand: number;
  /** B-class GPUs added at Tech Park. */
  addB: number;
}

export const MARKET_DEFAULTS: MarketState = { lat: 30, demand: 100, addB: 0 };
export const ADD_STEP = 25;
export const ADD_MAX = 4000;
/** Interactive buyers whose latency limit and demand the reader controls. */
export const INTERACTIVE: WorkloadId[] = ['chat70', 'frontier400'];

export function buyersOf(s: Pick<MarketState, 'lat' | 'demand'>): Buyer[] {
  return MARKET_BUYERS.map((b) => (INTERACTIVE.includes(b.id) ? { ...b, maxRttMs: s.lat, quantity: (b.quantity * s.demand) / 100 } : b));
}

export function supplyOf(addB: number): Supply {
  return { ...MARKET_SUPPLY, techpark: { ...MARKET_SUPPLY.techpark, B: MARKET_SUPPLY.techpark.B + addB } };
}

const cache = new Map<string, Clearing>();
/** The cleared market for a state (memoized: each clearing solves a dozen small linear programs). */
export function marketAt(s: MarketState): Clearing {
  const key = `${s.lat}|${s.demand}|${s.addB}`;
  let c = cache.get(key);
  if (!c) {
    c = clearMarket(buyersOf(s), supplyOf(s.addB));
    if (cache.size > 400) cache.clear();
    cache.set(key, c);
  }
  return c;
}

/** How much more an A-class hour costs at Marston, beside the users, than at Fernhill. */
export function premium(s: MarketState): number {
  const c = marketAt(s);
  return c.prices.marston.A - c.prices.fernhill.A;
}

/** Every site's A-class price within a cent of the others'. */
export function sameEverywhere(s: MarketState): boolean {
  const p = SITE_IDS.map((id) => marketAt(s).prices[id].A);
  return Math.max(...p) - Math.min(...p) <= 0.01;
}

/** Challenge b: the tightest latency limit at which the A-class costs the same everywhere (reference supply and demand). */
export function latencySolved(s: MarketState): boolean {
  return s.addB === 0 && s.demand === 100 && sameEverywhere(s) && !sameEverywhere({ ...s, lat: s.lat - 1 });
}

/** Challenge a: the fewest B-class GPUs at Tech Park (on the slider's grid) that bring Marston's A-class price within $0.10 of Fernhill's, Fernhill still too far. */
export function buildSolved(s: MarketState): boolean {
  const reachesTechPark = s.lat >= SITES.techpark.rttMs && s.lat < SITES.fernhill.rttMs;
  return s.demand === 100 && reachesTechPark && premium(s) <= 0.1 && (s.addB === 0 || premium({ ...s, addB: s.addB - ADD_STEP }) > 0.1);
}

/** What one GPU-hour of an accelerator is worth to a buyer: its value per A-class-equivalent hour times the work the GPU does. */
export function worth(id: WorkloadId, g: GpuId): number {
  const b = MARKET_BUYERS.find((x) => x.id === id)!;
  return b.value * productivity(id, g);
}

export type PriceSetter = { kind: 'buyer'; id: WorkloadId } | { kind: 'idle' } | { kind: 'chain' };

/**
 * Who sets the price of an accelerator at a site: GPUs left idle (the price falls to running cost),
 * a buyer whose worth for one more GPU-hour equals the price, or a chain of substitutions.
 */
export function priceSetter(c: Clearing, s: MarketState, site: SiteId, g: GpuId): PriceSetter {
  if (c.idle[site][g] > 0.5) return { kind: 'idle' };
  const price = c.prices[site][g];
  const allowed = buyersOf(s).filter((b) => SITES[site].rttMs <= b.maxRttMs && productivity(b.id, g) > 0);
  const match = allowed.filter((b) => Math.abs(worth(b.id, g) - price) <= 0.015);
  if (!match.length) return { kind: 'chain' };
  const here = match.find((b) => c.allocation.some((a) => a.buyer === b.id && a.site === site && a.gpu === g));
  return { kind: 'buyer', id: (here ?? match[0]).id };
}

/** The buyer-by-buyer view of one accelerator at one site. */
export function buyerRows(c: Clearing, s: MarketState, site: SiteId, g: GpuId) {
  return buyersOf(s).map((b) => {
    const prod = productivity(b.id, g);
    const tooFar = SITES[site].rttMs > b.maxRttMs;
    const gpusHere = c.allocation.filter((a) => a.buyer === b.id && a.site === site && a.gpu === g).reduce((t, a) => t + a.gpus, 0);
    return { id: b.id, prod, worth: b.value * prod, tooFar, cantRun: prod <= 0, gpusHere, servedShare: c.served[b.id] / b.quantity };
  });
}

// ---------------------------------------------------------------------------
// The third demonstration: the market cleared afresh each quarter, as every buyer's demand grows and new
// B-class GPUs arrive at Tech Park, at the reference latency limit.

export interface PathState {
  /** Growth of every buyer's demand, percent a quarter. */
  growth: number;
  /** New B-class GPUs arriving at Tech Park each quarter. */
  build: number;
}

export const PATH_DEFAULTS: PathState = { growth: 2, build: 400 };
export const PATH_QUARTERS = 12;
export const GROWTH_MAX = 8;
export const BUILD_STEP = 50;
export const BUILD_MAX = 600;
/** The other paths the prose describes: slower building, and faster growth with no building. */
export const SLOW_BUILD = 200;
export const SCARCE_GROWTH = 6;

export interface PathQuarter {
  /** Quarter, 0-based. */
  q: number;
  /** The A-class's price near the users (Marston) and in Fernhill, $ per GPU-hour. */
  near: number;
  far: number;
}

const PATH_PRICES: Array<{ site: SiteId; gpu: GpuId }> = [
  { site: 'marston', gpu: 'A' },
  { site: 'fernhill', gpu: 'A' },
];
const pathCache = new Map<string, PathQuarter[]>();

/** The A-class's price near the users and in Fernhill, quarter by quarter (memoized: two dozen small linear programs). */
export function pricePath(s: PathState): PathQuarter[] {
  const key = `${s.growth}|${s.build}`;
  let path = pathCache.get(key);
  if (!path) {
    path = Array.from({ length: PATH_QUARTERS }, (_, q) => {
      const grow = (1 + s.growth / 100) ** q;
      const buyers = buyersOf(MARKET_DEFAULTS).map((b) => ({ ...b, quantity: b.quantity * grow }));
      const [near, far] = pricesAt(buyers, supplyOf(s.build * q), PATH_PRICES);
      return { q, near, far };
    });
    if (pathCache.size > 300) pathCache.clear();
    pathCache.set(key, path);
  }
  return path;
}

/** The first quarter (0-based) in which the A-class near the users is within $0.10 of Fernhill's, or −1. */
export function premiumClosesAt(path: PathQuarter[]): number {
  return path.findIndex((x) => x.near - x.far <= 0.1);
}

// Numbers the prose quotes, all from the engines.
const REF = marketAt(MARKET_DEFAULTS);
const OPEN = marketAt({ ...MARKET_DEFAULTS, lat: SITES.fernhill.rttMs });
const TIGHT = marketAt({ ...MARKET_DEFAULTS, lat: 5 });
const chatRef = MARKET_BUYERS.find((b) => b.id === 'chat70')!;
const batchRef = MARKET_BUYERS.find((b) => b.id === 'batch8')!;
const scan = Array.from({ length: 17 }, (_, i) => i * ADD_STEP).map((addB) => ({ addB, price: marketAt({ ...MARKET_DEFAULTS, addB }).prices.marston.A }));
const firstDrop = scan.find((x) => x.price < REF.prices.marston.A - 0.005)!;
const lastFlat = scan[scan.indexOf(firstDrop) - 1];
const match = scan.find((x) => x.price - REF.prices.fernhill.A <= 0.1)!;
/** The same threshold with chat and frontier demand at 125%, on the slider's grid. */
export function thresholdAt(demand: number): number {
  // The premium only falls as GPUs are added, so a binary search over the slider's steps finds the first that closes it.
  const ok = (i: number) => premium({ lat: MARKET_DEFAULTS.lat, demand, addB: i * ADD_STEP }) <= 0.1;
  let lo = 0;
  let hi = ADD_MAX / ADD_STEP;
  if (ok(lo)) return 0;
  if (!ok(hi)) return Infinity;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi * ADD_STEP;
}

export const LESSON_NUMBERS = {
  supply: MARKET_SUPPLY,
  nearA: REF.prices.marston.A,
  nearB: REF.prices.marston.B,
  nearL: REF.prices.marston.L,
  farA: REF.prices.fernhill.A,
  farB: REF.prices.fernhill.B,
  techparkA: REF.prices.techpark.A,
  chatWanted: chatRef.quantity,
  chatServed: REF.served.chat70,
  chatShort: chatRef.quantity - REF.served.chat70,
  chatShortInB: (chatRef.quantity - REF.served.chat70) / productivity('chat70', 'B'),
  batchWanted: batchRef.quantity,
  batchServed: REF.served.batch8,
  welfareRef: REF.welfare,
  openA: OPEN.prices.marston.A,
  openB: OPEN.prices.marston.B,
  openL: OPEN.prices.marston.L,
  openSame: SITE_IDS.every((id) => Math.abs(OPEN.prices[id].A - OPEN.prices.marston.A) <= 0.01),
  openBatchServed: OPEN.served.batch8,
  openWelfare: OPEN.welfare,
  tightChatServed: TIGHT.served.chat70,
  tightBayA: TIGHT.prices.marston.A,
  tightBayB: TIGHT.prices.marston.B,
  tightTechA: TIGHT.prices.techpark.A,
  runCostTechA: variableCost('techpark', 'A'),
  lastFlatAdd: lastFlat.addB,
  firstDropAdd: firstDrop.addB,
  firstDropPrice: firstDrop.price,
  matchAdd: match.addB,
  matchPrice: match.price,
  matchAdd125: thresholdAt(125),
  prodChatB: productivity('chat70', 'B'),
  prodBatchB: productivity('batch8', 'B'),
  prodTrainB: productivity('train70', 'B'),
  prodFrontierB: productivity('frontier400', 'B'),
  listRatio: PRICES.B.onDemand / PRICES.A.onDemand,
  ...pathNumbers(),
};
const N = LESSON_NUMBERS;

/** The time paths the prose describes: the default, slower building, and fast growth with no building. */
function pathNumbers() {
  const base = pricePath(PATH_DEFAULTS);
  const slow = pricePath({ ...PATH_DEFAULTS, build: SLOW_BUILD });
  const scarce = pricePath({ growth: SCARCE_GROWTH, build: 0 });
  const nears = slow.map((x) => x.near);
  return {
    pathQ2Near: base[1].near,
    pathClose: premiumClosesAt(base),
    pathCloseNear: base[premiumClosesAt(base)].near,
    pathEndNear: base[PATH_QUARTERS - 1].near,
    pathEndFar: base[PATH_QUARTERS - 1].far,
    slowMin: Math.min(...nears),
    slowMax: Math.max(...nears),
    slowClose: premiumClosesAt(slow),
    scarceNearMax: Math.max(...scarce.map((x) => x.near)),
    scarceFarRise: scarce.findIndex((x) => x.far > scarce[0].far + 0.005),
    scarceEndFar: scarce[PATH_QUARTERS - 1].far,
  };
}

// ---------------------------------------------------------------------------
// Display helpers.

const m2 = (x: number) => usd(x, 2);
const GPU_SHORT: Record<GpuId, string> = { L: 'L-class', A: 'A-class', B: 'B-class' };

function latText(ms: number): string {
  return Number.isFinite(ms) ? `${fmt(ms)} ms` : 'any';
}

/** Round trip to users, on a log scale: positions only, not geography. */
const RX = (ms: number) => 70 + ((Math.log10(Math.max(1, ms)) - 0) / Math.log10(60)) * 520;
const CARD_X: Record<SiteId, number> = { marston: 16, techpark: 222, fernhill: 428 };
const CARD_W = 196;

function MarketMap({ c, s }: { c: Clearing; s: MarketState }) {
  const limitX = RX(s.lat);
  const supply = supplyOf(s.addB);
  const label = SITE_IDS.map((id) => `${SITES[id].name} (${SITES[id].rttMs} ms): ${GPU_IDS.map((g) => `${GPU_SHORT[g]} ${m2(c.prices[id][g])}`).join(', ')}`).join('. ');
  return (
    <svg className="diagram" viewBox="0 0 640 298" role="img" aria-label={`Market prices per GPU-hour with the chat and frontier assistants accepting a ${s.lat} ms round trip. ${label}.`}>
      <text className="ax" x={70} y={14}>
        Round trip to the users (log scale)
      </text>
      {/* Region beyond the interactive limit. */}
      <rect x={limitX} y={22} width={Math.max(0, 600 - limitX)} height={56} fill="rgba(42,157,144,.08)" />
      <line className="base" x1={70} x2={600} y1={60} y2={60} />
      {[1, 2, 5, 10, 20, 50].map((t) => (
        <g key={t}>
          <line x1={RX(t)} x2={RX(t)} y1={56} y2={64} stroke="#bbb" />
          <text className="ax ax-m" x={RX(t)} y={78}>
            {t} ms
          </text>
        </g>
      ))}
      <text x={40} y={64} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        Users
      </text>
      <line x1={limitX} x2={limitX} y1={24} y2={64} stroke={GRAPHIC.teal} strokeWidth={2} strokeDasharray="5 4" />
      <text x={limitX + (limitX > 470 ? -6 : 6)} y={36} textAnchor={limitX > 470 ? 'end' : 'start'} style={{ fontSize: 12, fill: TEXT.teal }}>
        chat and frontier accept up to {s.lat} ms
      </text>
      {SITE_IDS.map((id) => {
        const x = RX(SITES[id].rttMs);
        const cx = CARD_X[id] + CARD_W / 2;
        const far = SITES[id].rttMs > s.lat;
        return (
          <g key={id}>
            <path d={`M${x} 66 L${x} 92 L${cx} 104 L${cx} 112`} fill="none" stroke="#c9c9c4" />
            <circle cx={x} cy={60} r={6} fill={far ? '#fff' : '#333'} stroke="#333" strokeWidth={1.5} />
            <rect x={CARD_X[id]} y={112} width={CARD_W} height={178} rx={6} fill="#fff" stroke="#e3e3df" />
            <text x={CARD_X[id] + 12} y={134} style={{ fontSize: 14, fontWeight: 500, fill: '#111' }}>
              {SITES[id].name}
            </text>
            <text x={CARD_X[id] + CARD_W - 12} y={134} textAnchor="end" className="ax">
              {SITES[id].rttMs} ms
            </text>
            <text x={CARD_X[id] + 12} y={152} className="ax">
              {far ? 'too far for chat and frontier' : 'reaches every buyer'}
            </text>
            {GPU_IDS.map((g, i) => {
              const y = 178 + i * 40;
              return (
                <g key={g}>
                  <rect x={CARD_X[id] + 12} y={y - 11} width={6} height={14} rx={1.5} fill={GPU_COLOR[g]} />
                  <text x={CARD_X[id] + 24} y={y} style={{ fontSize: 13, fill: '#333' }}>
                    {GPU_SHORT[g]}
                  </text>
                  <text x={CARD_X[id] + CARD_W - 12} y={y} textAnchor="end" style={{ fontSize: 15, fontWeight: 600, fill: TEXT.green }}>
                    {m2(c.prices[id][g])}
                  </text>
                  <text x={CARD_X[id] + 24} y={y + 17} className="ax">
                    {fmt(supply[id][g])} GPUs{c.idle[id][g] > 0.5 ? `, ${fmt(c.idle[id][g])} idle` : ''}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** One accelerator at one site: each buyer's worth for one more GPU-hour, against the price. */
function WorthChart({ c, s, site, g }: { c: Clearing; s: MarketState; site: SiteId; g: GpuId }) {
  const rows = buyerRows(c, s, site, g);
  const price = c.prices[site][g];
  const setter = priceSetter(c, s, site, g);
  const max = Math.max(price, ...rows.map((r) => (r.tooFar ? 0 : r.worth)));
  const top = max <= 1.2 ? 1.2 : max <= 6 ? 6 : 14;
  const x = scale(0, top, 230, 600);
  const ticks = top === 1.2 ? [0, 0.4, 0.8, 1.2] : top === 6 ? [0, 2, 4, 6] : [0, 4, 8, 12];
  const label = rows
    .map((r) => `${WORKLOADS[r.id].name}: ${r.cantRun ? 'can’t run it' : r.tooFar ? 'too far' : `worth ${m2(r.worth)}`}`)
    .join('; ');
  return (
    <svg className="chart" viewBox="0 0 640 286" role="img" aria-label={`${GPU_SHORT[g]} GPUs at ${SITES[site].name}: price ${m2(price)} an hour. ${label}.`}>
      <text className="ax" x={230} y={14}>
        What one more {GPU_SHORT[g]} GPU-hour at {SITES[site].name} is worth to each buyer
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={26} y2={250} />
          <text className="ax ax-m" x={x(t)} y={266}>
            {usd(t, top === 1.2 && t > 0 ? 2 : 0)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 32 + i * 37;
        const isSetter = setter.kind === 'buyer' && setter.id === r.id;
        const note = r.cantRun
          ? `can’t run on the ${GPU_SHORT[g]}`
          : r.tooFar
            ? `too far: ${SITES[site].rttMs} ms round trip, over its ${s.lat} ms`
            : r.gpusHere > 0.5
              ? `uses ${fmt(r.gpusHere)} here · gets ${pct(r.servedShare)} of what it wants`
              : `none here · gets ${pct(r.servedShare)} of what it wants`;
        const w = r.tooFar || r.cantRun ? 0 : Math.min(top, r.worth);
        return (
          <g key={r.id}>
            <text x={0} y={y + 12} style={{ fontSize: 13, fontWeight: isSetter ? 600 : 400, fill: '#222' }}>
              {WORKLOADS[r.id].name}
            </text>
            <text x={0} y={y + 27} className="ax">
              {note}
            </text>
            {w > 0 && <rect x={x(0)} y={y + 2} width={x(w) - x(0)} height={18} fill={isSetter ? GRAPHIC.green : r.worth >= price - 0.015 ? '#cfd9c3' : '#ececea'} />}
            {w > 0 && (
              <text x={Math.min(x(w) + 6, 596)} y={y + 16} textAnchor={x(w) + 6 > 560 ? 'end' : 'start'} style={{ fontSize: 12, fill: '#333' }}>
                {m2(r.worth)}
                {r.worth > top ? ' →' : ''}
              </text>
            )}
          </g>
        );
      })}
      <line x1={x(Math.min(top, price))} x2={x(Math.min(top, price))} y1={24} y2={252} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text x={x(Math.min(top, price)) + 5} y={282} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green }}>
        price {m2(price)}
      </text>
    </svg>
  );
}

function setterText(setter: PriceSetter, c: Clearing, site: SiteId, g: GpuId): string {
  const price = c.prices[site][g];
  if (setter.kind === 'idle') return `${fmt(c.idle[site][g])} ${GPU_SHORT[g]} GPUs sit idle at ${SITES[site].name}, so competition pushes the price down to about what one costs to run: ${m2(price)}.`;
  if (setter.kind === 'chain') return `No single buyer’s worth equals ${m2(price)}: one more ${GPU_SHORT[g]} GPU here would be put to use through a chain of substitutions, each buyer moving to its next-best GPU.`;
  const b = MARKET_BUYERS.find((x) => x.id === setter.id)!;
  const prod = productivity(setter.id, g);
  return `The ${WORKLOADS[setter.id].name.toLowerCase()} is the marginal buyer: it pays up to ${m2(b.value)} for an A-class-equivalent hour, and a ${GPU_SHORT[g]} GPU does ${fmt(prod, prod === 1 ? 0 : 2)} of those, so the price is ${m2(price)}.`;
}

/** The A-class's price near the users and in Fernhill, quarter by quarter. */
function PathChart({ path, s }: { path: PathQuarter[]; s: PathState }) {
  const X0 = 64;
  const X1 = 616;
  const TOP = 24;
  const BOT = 172;
  const band = (X1 - X0) / path.length;
  const x = (q: number) => X0 + (q + 0.5) * band;
  const yMax = Math.max(4, Math.ceil(Math.max(...path.map((d) => Math.max(d.near, d.far)))));
  const y = scale(0, yMax, BOT, TOP);
  const xs = path.map((d) => x(d.q));
  const last = path[path.length - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 196"
      role="img"
      aria-label={`The A-class’s price over ${path.length} quarters, with every buyer’s demand growing ${s.growth}% a quarter and ${fmt(s.build)} new B-class GPUs arriving at Tech Park each quarter: near the users ${path.map((d) => m2(d.near)).join(', ')}; in Fernhill ${path.map((d) => m2(d.far)).join(', ')}. In Q${path.length}, ${m2(last.near)} near the users and ${m2(last.far)} in Fernhill.`}
    >
      <text className="ax" x={X0} y={12}>
        Price of an A-class GPU-hour, quarter by quarter
      </text>
      <GridY y={y} ticks={Array.from({ length: yMax + 1 }, (_, i) => i)} x0={X0} x1={X1} format={(v) => usd(v)} baseline={0} />
      <path d={stepPath(xs, path.map((d) => y(d.far)), band / 2)} fill="none" stroke={GRAPHIC.gray} strokeWidth={2} strokeDasharray="6 4" />
      <path d={stepPath(xs, path.map((d) => y(d.near)), band / 2)} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      <text x={X0 + 4} y={y(path[0].near) - 7} style={{ fontSize: 12, fill: TEXT.green }}>
        near the users (Marston)
      </text>
      <text x={X0 + 4} y={y(path[0].far) + 16} style={{ fontSize: 12, fill: TEXT.gray }}>
        Fernhill
      </text>
      {path.map((d) => (
        <text key={d.q} className="ax ax-m" x={x(d.q)} y={190}>
          Q{d.q + 1}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('market', MARKET_DEFAULTS);
  const st = s1.state;
  const c = marketAt(st);
  const prem = premium(st);

  // The second figure shows the reference market unless the reader asks for the first figure's.
  const s2 = useScenario('price-setter', { site: 'marston' as SiteId, gpu: 'B' as GpuId, market: 'reference' as 'reference' | 'yours' });
  const { site, gpu } = s2.state;
  const market = s2.state.market === 'yours' ? 'yours' : 'reference';
  const st2 = market === 'yours' ? st : MARKET_DEFAULTS;
  const c2 = marketAt(st2);
  const setter = priceSetter(c2, st2, site, gpu);
  const ratio = c2.prices[site].A > 0 ? c2.prices[site].B / c2.prices[site].A : 0;

  const s3 = useScenario('price-path', PATH_DEFAULTS);
  const ps = s3.state;
  const path = pricePath(ps);
  const pathEnd = path[PATH_QUARTERS - 1];
  const closes = premiumClosesAt(path);
  const farMoved = path.some((x) => Math.abs(x.far - path[0].far) > 0.005);
  const pathCaption = `Near the users the A-class goes from ${m2(path[0].near)} in Q1 to ${m2(pathEnd.near)} in Q${PATH_QUARTERS}; ${
    farMoved ? `in Fernhill, from ${m2(path[0].far)} to ${m2(pathEnd.far)}` : `in Fernhill it stays at ${m2(path[0].far)}`
  }. ${
    closes >= 0 ? `The premium near the users first closes in Q${closes + 1}.` : 'The premium near the users never closes.'
  }`;

  const buyers = useMemo(() => buyersOf(st), [st]);
  const tableRows = buyers.map((b) => ({ b, served: c.served[b.id] }));

  const buildStatus = (() => {
    if (st.demand !== 100) return 'Set the chat and frontier demand back to 100% first.';
    if (st.lat >= SITES.fernhill.rttMs) return `At ${st.lat} ms Fernhill is close enough for everyone, so prices are already equal. Bring the limit back under ${SITES.fernhill.rttMs} ms.`;
    if (st.lat < SITES.techpark.rttMs) return `At ${st.lat} ms only Marston is close enough for chat and frontier, so GPUs at Tech Park can’t help them. Raise the limit to at least ${SITES.techpark.rttMs} ms.`;
    if (prem > 0.1) return `With ${fmt(st.addB)} B-class GPUs added, an A-class hour costs ${m2(c.prices.marston.A)} at Marston against ${m2(c.prices.fernhill.A)} at Fernhill.`;
    return `The prices are within $0.10, but fewer added GPUs would do it too.`;
  })();

  const latStatus = (() => {
    if (st.addB !== 0 || st.demand !== 100) return 'Return the added GPUs to 0 and the demand to 100% first.';
    return sameEverywhere(st)
      ? `At ${st.lat} ms the A-class costs ${m2(c.prices.marston.A)} everywhere. Is that the tightest limit that does it?`
      : `At ${st.lat} ms an A-class hour costs ${m2(c.prices.marston.A)} at Marston and ${m2(c.prices.fernhill.A)} at Fernhill.`;
  })();

  const caption =
    st.lat < SITES.techpark.rttMs
      ? `Only Marston is close enough for chat and frontier: chat gets ${pct(c.served.chat70 / ((chatRef.quantity * st.demand) / 100))} of what it wants, while GPUs elsewhere go cheap.`
      : st.lat >= SITES.fernhill.rttMs
        ? `Every site is close enough for every buyer, so one A-class price clears everywhere: ${m2(c.prices.fernhill.A)}.`
        : prem > 0.005
          ? `Near the users an A-class hour costs ${m2(c.prices.marston.A)}, ${m2(prem)} more than at Fernhill, which only training, fine-tuning and batch work can reach.`
          : `Enough capacity near the users: the A-class costs the same ${m2(c.prices.marston.A)} beside them as in Fernhill.`;

  return (
    <LessonPage id="compute/5.5">
      <P>
        The previous lesson priced one kind of GPU in one place. But capacity isn’t in one place, and it isn’t one kind. This
        course’s GPUs sit at three sites — Marston, in the coastal city beside most of the users; Tech Park, a short hop away; and Fernhill, a cold valley{' '}
        {SITES.fernhill.rttMs} ms of round trip from them (<a href={lessonHref('compute/4.3')}>Lesson 4.3</a>) — and come in the three classes of{' '}
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>. Should an A-class hour cost the same at all three? This lesson builds a small market and lets it answer.
      </P>
      <P>
        On the supply side, the region’s GPUs: {fmt(N.supply.marston.A)} A-class and {fmt(N.supply.marston.B)} B-class GPUs at Marston, whose 20 MW grid connection keeps it
        small (<a href={lessonHref('compute/4.2')}>Lesson 4.2</a>), {fmt(N.supply.techpark.A)} and {fmt(N.supply.techpark.B)} at Tech Park, and{' '}
        {fmt(N.supply.fernhill.A)} of each at Fernhill, plus L-class cards at Marston and Tech Park. On the demand side, the six workloads of Lesson 3.5, each now a crowd of
        buyers. Each will pay up to some <K c="price">value</K> for an A-class-equivalent GPU-hour of its work (
        <a href={lessonHref('compute/5.1')}>Lesson 5.1</a>): what an hour of an A-class GPU would do for it. A B-class GPU does {fmt(N.prodChatB, 2)} such hours of chat work and an L-class card a sliver of one, from the counts of Lesson 3.5. And the two interactive
        assistants, chat and frontier, accept only a limited <K tone="teal">round trip</K> to their users. All of these numbers are simulated.
      </P>
      <P>
        Clearing the market means giving every GPU to the buyer who values its work most, which is a linear program like the one that dispatches power plants in the
        electricity course. The price of each kind of GPU at each site then falls out of it: it is what one more GPU of that kind, there, would be worth to the market — its{' '}
        <b>shadow price</b> — plus the few cents of electricity it takes to run. That is exactly how a nodal electricity price is the value of one more megawatt-hour at a
        node (<a href={lessonHref('5.3')}>Lesson 5.3</a> of that course). Real GPU-hours aren’t sold through one exchange (<a href={lessonHref('compute/5.1')}>Lesson 5.1</a>),
        but the forces the model isolates, who needs what and where, are the ones real prices answer to. In the next demonstration, the
        sites are placed by their round trip to the users. Change the round trip the chat and frontier assistants accept, their demand, and the B-class GPUs at Tech Park:
      </P>

      <Figure name="Compute Marketplace Simulator" scenario={s1}>
        <MarketMap c={c} s={st} />
        <Slider label="Chat and frontier accept" tone="teal" value={st.lat} min={2} max={60} onChange={(lat) => s1.set({ lat })} display={`${st.lat} ms round trip`} />
        <Slider label="Chat and frontier demand" value={st.demand} min={50} max={150} step={5} onChange={(demand) => s1.set({ demand })} display={`${st.demand}% of today’s`} />
        <Slider label="New B-class at Tech Park" value={st.addB} min={0} max={ADD_MAX} step={ADD_STEP} onChange={(addB) => s1.set({ addB })} display={`+${fmt(st.addB)} GPUs`} />
        <Readouts items={[{ label: 'value created per hour', value: usd(c.welfare), tone: 'green' }]} />
        <DataTable
          caption="Each buyer: what it pays for an A-class-equivalent GPU-hour, the round trip it accepts, and how much of its work the market serves"
          rows={tableRows}
          rowKey={(r) => r.b.id}
          columns={[
            { label: 'Buyer', cell: (r) => WORKLOADS[r.b.id].name },
            { label: 'Pays up to', cell: (r) => m2(r.b.value), align: 'right' },
            { label: 'Round trip', cell: (r) => latText(r.b.maxRttMs), align: 'right' },
            { label: 'Wants', cell: (r) => fmt(r.b.quantity), align: 'right' },
            { label: 'Gets', cell: (r) => `${fmt(r.served)} (${pct(r.served / r.b.quantity)})`, align: 'right' },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At the start, the assistants accept {MARKET_DEFAULTS.lat} ms, which rules out Fernhill, and the market splits in two. Near the users, an A-class hour clears at{' '}
        {m2(N.nearA)} and a B-class hour at {m2(N.nearB)}; in Fernhill, {m2(N.farA)} and {m2(N.farB)}. Marston and Tech Park, both close enough for everyone, share one
        price. The reason is in the table. Code completion and the frontier assistant are served in full, but the chat assistant wants {fmt(N.chatWanted)}{' '}
        A-class-equivalent hours every hour and the GPUs near the users can give it only {fmt(N.chatServed)}. It is the <b>marginal buyer</b>: the last GPU near the users goes
        to chat, so chat’s value, {m2(chatRef.value)}, is what one more would be worth. In Fernhill the marginal buyer is batch summarization, which wanted{' '}
        {fmt(N.batchWanted)} and gets {fmt(N.batchServed)}. It pays only {m2(batchRef.value)} an A-class-equivalent hour, which sets Fernhill’s B-class price —{' '}
        {fmt(N.prodBatchB, 2)} hours of batch work, {m2(N.farB)} — and, through a substitution traced later, its A-class price of {m2(N.farA)}. The same chip, made in the
        same factory, sells for {m2(N.nearA - N.farA)} an hour more beside the users, because distance decides which buyers can use it.
      </P>
      <Challenge
        id="a"
        question="Predict first, from where the three sites sit on the map: how long a round trip must chat and frontier accept before an A-class hour costs the same at every site? Then, with no GPUs added and demand at 100%, find the tightest limit that does it."
        solved={latencySolved(st)}
        status={latStatus}
        success={`Solved: ${SITES.fernhill.rttMs} ms, Fernhill’s own round trip. One millisecond less and Fernhill can’t serve the assistants, and the market splits again. The threshold is set by physics — the distance to the valley — not by anyone’s pricing.`}
      />

      <P>
        At {SITES.fernhill.rttMs} ms the chat assistant moves some of its work to Fernhill, and every site clears at one price: {m2(N.openA)} for the A-class,{' '}
        {m2(N.openB)} for the B-class, {m2(N.openL)} for the L-class — all set by batch summarization’s {m2(batchRef.value)}, directly or through substitution, since
        batch, still short, is now the marginal buyer everywhere. The market as a whole creates {usd(N.openWelfare - N.welfareRef)} more value every
        hour. Tighten the limit instead, below Tech Park’s {SITES.techpark.rttMs} ms, and only Marston is close enough: chat gets just {fmt(N.tightChatServed)} hours of
        the {fmt(N.chatWanted)} it wants, Marston’s A-class hour clears at {m2(N.tightBayA)}, and at Tech Park, where GPUs now sit idle, the price falls to{' '}
        {m2(N.tightTechA)}, just the electricity it takes to run one. Prices like that could never repay the hardware of{' '}
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>; they say only that, this hour, nobody who can reach those GPUs needs them.
      </P>

      <H2>Building where the price is high</H2>
      <P>
        A price premium is a signal to build. Return the limit to {MARKET_DEFAULTS.lat} ms and add B-class GPUs at Tech Park. The chat assistant is short by{' '}
        {fmt(N.chatShort)} A-class-equivalent hours, about {fmt(N.chatShortInB)} B-class GPUs’ worth.
      </P>

      <Challenge
        id="b"
        figure="Compute Marketplace Simulator"
        question={`Predict first: will about ${fmt(N.chatShortInB)} new B-class GPUs, enough to serve chat in full, close the premium near the users? Then, keeping chat and frontier at today’s demand and a limit that rules out Fernhill, add the fewest B-class GPUs at Tech Park (on the slider’s steps of 25) that bring Marston’s A-class price within $0.10 of Fernhill’s.`}
        solved={buildSolved(st)}
        status={buildStatus}
        success={`Solved: ${fmt(N.matchAdd)} B-class GPUs, more than three times what chat was short of. Relieve the shortage and the premium vanishes — the risk anyone building near users takes: the next builder’s GPUs lower the price of everyone’s.`}
      />

      <P>
        Up to {fmt(N.lastFlatAdd)} new GPUs, the price beside the users doesn’t move: each serves more of chat’s unmet demand. At {fmt(N.firstDropAdd)} chat is fully
        served, and the price steps down to {m2(N.firstDropPrice)}, set now by a chain of substitutions: the new GPUs take on chat work from A-class GPUs, which take over
        code completion from L-class cards, which move to fine-tuning, which frees A-class GPUs in Fernhill for training. Only at {fmt(N.matchAdd)} does the chain reach
        Fernhill’s own buyers and close the premium: {m2(N.matchPrice)} near the users, {m2(N.farA)} far away. Keep adding, and GPUs end up idle and prices sink toward
        running costs.
      </P>

      <H2>Who sets each price</H2>
      <P>
        Prices differ by hardware as well as by place, and the same logic sets both. In the next demonstration, choose a site and an accelerator to see what one more
        GPU-hour of it would be worth to each buyer — the buyer’s value times the work the GPU does for it — against the price. It starts from the reference market;
        switch the market to see it as you left it in <FigRef to="Compute Marketplace Simulator">the first demonstration</FigRef>:
      </P>

      <Figure name="Compute Marketplace Simulator · who sets the price" scenario={s2}>
        <Segmented
          label="Market"
          value={market}
          onChange={(v) => s2.set({ market: v })}
          options={[
            { value: 'reference', label: 'The reference market' },
            { value: 'yours', label: 'As set in the first demonstration' },
          ]}
        />
        <Segmented label="Site" value={site} onChange={(v) => s2.set({ site: v })} options={SITE_IDS.map((id) => ({ value: id, label: SITES[id].name }))} />
        <Segmented label="Accelerator" value={gpu} onChange={(v) => s2.set({ gpu: v })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <WorthChart c={c2} s={st2} site={site} g={gpu} />
        <Readouts items={[{ label: `B-class ÷ A-class price at ${SITES[site].name}`, value: `${fmt(ratio, 2)}×`, tone: 'green' }]} />
        <Caption>{setterText(setter, c2, site, gpu)}</Caption>
      </Figure>

      <P>
        Start at Marston with the B-class. Frontier and code completion would pay far more for it, but they are already served in full; chat is the marginal buyer, and a
        B-class GPU does {fmt(N.prodChatB, 2)} A-class hours of chat work, so its hour clears at {fmt(N.prodChatB, 2)} × {m2(chatRef.value)} = {m2(N.nearB)}. The ratio of
        B-class to A-class prices is exactly chat’s ratio. Fernhill’s A-class price, {m2(N.farA)}, is the subtle one. No buyer’s worth matches it, because the
        cheapest way to use one more A-class GPU there is indirect: it takes over training from a B-class GPU — which does {fmt(N.prodTrainB, 3)} times an A-class’s
        training — and the freed B-class GPU summarizes documents. So the price is {m2(batchRef.value)} × {fmt(N.prodBatchB, 3)} ÷ {fmt(N.prodTrainB, 3)} ={' '}
        {m2(N.farA)}, and Fernhill’s B ÷ A ratio is training’s, {fmt(N.prodTrainB, 3)}.
      </P>
      <P>
        So there is no fixed exchange rate between accelerators. The B-class’s list price in this course is {N.listRatio === 2 ? 'twice' : `${fmt(N.listRatio, 2)} times`} the A-class’s; in this market it
        clears at {fmt(N.nearB / N.nearA, 2)} times near the users and {fmt(N.farB / N.farA, 3)} times in Fernhill, and when only Marston can serve the assistants it
        reaches {fmt(N.tightBayB / N.tightBayA, 2)}, the frontier assistant’s ratio, since an extra B-class GPU there frees A-class GPUs for chat. Each ratio is the
        productivity, for the marginal buyer, that <a href={lessonHref('compute/3.5')}>Lesson 3.5</a> measured from memory, bandwidth and links. Change the physics, as{' '}
        <a href={lessonHref('compute/6.1')}>Lesson 6.1</a> does with the frontier model’s precision, and the ratios move with it.
      </P>

      <H2>Prices over time</H2>
      <P>
        Each clearing so far was a single hour. Over months, demand grows (<a href={lessonHref('compute/5.3')}>Lesson 5.3</a>) and new GPUs arrive (
        <a href={lessonHref('compute/5.2')}>Lesson 5.2</a>). In the next demonstration, the market clears afresh each quarter for three years as demand grows and new
        B-class GPUs arrive at Tech Park. Set the two rates:
      </P>

      <Figure name="Compute Marketplace Simulator · over time" scenario={s3}>
        <PathChart path={path} s={ps} />
        <Slider label="Every buyer’s demand grows" value={ps.growth} min={0} max={GROWTH_MAX} onChange={(growth) => s3.set({ growth })} display={`${ps.growth}% a quarter`} />
        <Slider label="New B-class at Tech Park" value={ps.build} min={0} max={BUILD_MAX} step={BUILD_STEP} onChange={(build) => s3.set({ build })} display={`+${fmt(ps.build)} a quarter`} />
        <Caption>{pathCaption}</Caption>
      </Figure>

      <P>
        At the start, demand grows {PATH_DEFAULTS.growth}% a quarter and {fmt(PATH_DEFAULTS.build)} B-class GPUs arrive each quarter. Supply pulls ahead, and by Q
        {N.pathClose + 1} the premium is gone: the price near the users steps to {m2(N.pathQ2Near)}, then to {m2(N.pathCloseNear)}. At {fmt(SLOW_BUILD)} a quarter, demand
        absorbs the new GPUs and the price stays between {m2(N.slowMin)} and {m2(N.slowMax)}. Stop building and let demand grow {SCARCE_GROWTH}% a quarter: the price near
        the users holds at chat’s {m2(N.scarceNearMax)}, however short chat gets, while Fernhill’s climbs from Q{N.scarceFarRise + 1}, to {m2(N.scarceEndFar)} by Q
        {PATH_QUARTERS} — fine-tuning’s value, once fine-tuning is short there.
      </P>
      <P>
        The price never glides. It rests on one buyer’s value until that buyer is served, then steps to the next. A real market has thousands of buyers, each valuing an
        hour a little differently, so its steps blur into a slope: a price that drifts down while new capacity outpaces demand, and drops when a new generation arrives
        in volume, each new GPU doing the work of two or three old ones. <a href={lessonHref('compute/6.5')}>Lesson 6.5</a> prices a contract on such a path.
      </P>

      <H2>Many prices for one commodity</H2>
      <P>
        The electricity course found the same pattern on its grid: one price everywhere while the lines have room, different prices at each node once a line fills. Here
        the constraint is the speed of light, the patience of users and the scarce megawatts near them. Real GPU prices also differ for reasons this model leaves out —
        data that must stay in a jurisdiction, the cost of moving large datasets, each provider’s contracts — but the core of it is here: a GPU-hour’s price is the value of the work its marginal buyer can do with it, and that depends on what the GPU
        is, where it is, and who else can reach it.
      </P>
      <P>
        Differences like these are opportunities. A buyer who can move work to where hours are cheap, a provider who can steer capacity to where they are dear, or anyone
        who can hold capacity through a shortage stands to gain from them — and risks losing if the physics shifts. The next chapter turns these differences into strategies,
        starting in <a href={lessonHref('compute/6.1')}>Lesson 6.1</a> with how a provider allocates a mixed fleet among competing workloads.
      </P>
    </LessonPage>
  );
}
