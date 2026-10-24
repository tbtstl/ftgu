import { useDeferredValue, useMemo } from 'react';
import {
  Button,
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
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  CUSTOMERS_DEFAULT,
  WORLD_DEFAULT,
  evaluateFleet,
  operate,
  type BusinessResult,
  type Customer,
  type FleetDesign,
  type OpsPlan,
  type PriceBook,
  type WorldScenario,
} from '../../../engines/compute/cloud';
import { LEVERS_DEFAULT, businessUnder, type Levers } from '../../../engines/compute/strategyChallenge';
import { ACCELERATORS, GPU_IDS } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { clearAttempts, defaultCloud, saveAttempt, updateCloud, useAttempts, useCloud, type Attempt, type CloudDesign } from '../shared/cloudStore';

// ---------------------------------------------------------------------------
// The test: the reader's whole design, run through three uncertain years, many times.

/** The world and the two extra drivers the reader can change (none of them part of the design). */
export interface WorldState {
  /** 0-based quarter around which the next generation reaches volume elsewhere (± 2 quarters). */
  nextGen: number;
  /** How far that cuts what customers will pay for this fleet's work, %. */
  drop: number;
  /** Uncertainty of each customer's growth per quarter, %. */
  sigma: number;
  /** Share of GPU-hours lost to failures and repairs, %. */
  failure: number;
  /** Multiplier on the site's electricity price. */
  energy: number;
  /** Years the servers must pay for themselves in. */
  life: number;
}

export const WORLD_STATE_DEFAULTS: WorldState = {
  nextGen: WORLD_DEFAULT.nextGenQuarter,
  drop: Math.round(WORLD_DEFAULT.nextGenDrop * 100),
  sigma: Math.round(WORLD_DEFAULT.growthSigma * 100),
  failure: Math.round(WORLD_DEFAULT.failureShare * 100),
  energy: LEVERS_DEFAULT.energyScale,
  life: LEVERS_DEFAULT.serverLifeYears,
};

export const NEXT_GEN_MIN = 2;
export const NEXT_GEN_MAX = 14;
/** The challenge's target: a risk-adjusted value of at least this, $. */
export const TARGET = 10e6;

export function worldOf(s: WorldState): WorldScenario {
  return { ...WORLD_DEFAULT, nextGenQuarter: s.nextGen, nextGenDrop: s.drop / 100, growthSigma: s.sigma / 100, failureShare: s.failure / 100 };
}

export function leversOf(s: WorldState): Levers {
  return { energyScale: s.energy, serverLifeYears: s.life };
}

export function isStartingWorld(s: WorldState): boolean {
  return (Object.keys(WORLD_STATE_DEFAULTS) as Array<keyof WorldState>).every((k) => s[k] === WORLD_STATE_DEFAULTS[k]);
}

// JSON can't hold Infinity (a customer with no latency limit), so write it as null.
const json = (x: unknown) => JSON.stringify(x, (_, v) => (v === Infinity ? null : v));

export function customersAreStarting(cs: Customer[]): boolean {
  return json(cs) === json(CUSTOMERS_DEFAULT);
}

export interface Strategy {
  customers: Customer[];
  prices: PriceBook;
  fleet: FleetDesign;
  ops: OpsPlan;
}

const runs = new Map<string, BusinessResult>();
/** Three years of a strategy in a world (cached: a run takes a few tens of milliseconds). */
export function runStrategy(d: Strategy, w: WorldState = WORLD_STATE_DEFAULTS): BusinessResult {
  const key = json([d.customers, d.prices, d.fleet, d.ops, w]);
  let r = runs.get(key);
  if (!r) {
    r = businessUnder(d.customers, d.prices, d.fleet, d.ops, worldOf(w), leversOf(w));
    if (runs.size > 120) runs.clear();
    runs.set(key, r);
  }
  return r;
}

/** Challenge a: against the starting customers and world, a buildable design worth at least $10M risk-adjusted. */
export function targetSolved(d: Strategy, w: WorldState): boolean {
  return isStartingWorld(w) && customersAreStarting(d.customers) && evaluateFleet(d.fleet).ok && runStrategy(d, w).riskAdjusted >= TARGET;
}

/** Challenge b: a saved strategy (same customers) beating the starting design on both its mean and its 5th percentile. */
export function beatsStart(attempts: Array<Pick<Attempt, 'mean' | 'p5' | 'design'>>): boolean {
  const s = START();
  return attempts.some((a) => customersAreStarting(a.design.customers) && a.mean > s.mean && a.p5 > s.p5);
}

// ---------------------------------------------------------------------------
// The designs the prose discusses, all run through the same engine (computed once, on first use).

const STARTING = defaultCloud();
/** A smaller fleet matched to the starting customers: no L-class, fewer A-class, more B-class; tiered operations. */
export const RIGHT_SIZED: Strategy = {
  customers: STARTING.customers,
  prices: STARTING.prices,
  fleet: { ...STARTING.fleet, gpus: { L: 0, A: 512, B: 320 } },
  ops: { ...STARTING.ops, policy: 'tiered' },
};

let startCache: BusinessResult | null = null;
function START(): BusinessResult {
  return (startCache ??= runStrategy(STARTING));
}

let numbers: ReturnType<typeof computeNumbers> | null = null;
function computeNumbers() {
  const start = START();
  const right = runStrategy(RIGHT_SIZED);
  const W = WORLD_STATE_DEFAULTS;
  const startWeek = operate(STARTING.customers, STARTING.prices, STARTING.fleet, STARTING.ops);
  const rightWeek = operate(RIGHT_SIZED.customers, RIGHT_SIZED.prices, RIGHT_SIZED.fleet, RIGHT_SIZED.ops);
  const startEv = evaluateFleet(STARTING.fleet);
  const rightEv = evaluateFleet(RIGHT_SIZED.fleet);
  return {
    start,
    right,
    startWeek,
    rightWeek,
    startFixedWeek: startWeek.fixedCost,
    rightFixedWeek: rightWeek.fixedCost,
    startGpus: startEv.total,
    rightGpus: rightEv.total,
    rightFirstCome: runStrategy({ ...RIGHT_SIZED, ops: { ...RIGHT_SIZED.ops, policy: 'first-come' } }),
    life3: runStrategy(RIGHT_SIZED, { ...W, life: 3 }),
    life7: runStrategy(RIGHT_SIZED, { ...W, life: 7 }),
    early: runStrategy(RIGHT_SIZED, { ...W, nextGen: 2, drop: 50 }),
    energy3: runStrategy(RIGHT_SIZED, { ...W, energy: 3 }),
    fail10: runStrategy(RIGHT_SIZED, { ...W, failure: 10 }),
  };
}

/** Every number the prose quotes. */
export function lessonNumbers() {
  return (numbers ??= computeNumbers());
}

// ---------------------------------------------------------------------------
// Formatting.

function m$(x: number, digits = 2): string {
  return usd(x / 1e6, digits) + 'M';
}
function million(x: number, digits = 2): string {
  return usd(x / 1e6, digits) + ' million';
}
function pctOf(x: number, digits = 0): string {
  return `${fmt(x * 100, digits)}%`;
}
function nextGenLabel(q0: number): string {
  return q0 - WORLD_DEFAULT.nextGenSpread >= WORLD_DEFAULT.quarters ? 'after the term' : `around Q${q0 + 1}`;
}

const GREEN = GRAPHIC.green;
const RED = GRAPHIC.red;

// ---------------------------------------------------------------------------
// Figure 1: the distribution of outcomes and the median quarter.

function Histogram({ r }: { r: BusinessResult }) {
  const x0 = 64;
  const x1 = 616;
  const top = 58;
  const bot = 150;
  const lo = r.npvs[0] / 1e6;
  const hi = r.npvs[r.npvs.length - 1] / 1e6;
  const [d0, d1] = niceDomain(Math.min(lo, -1), Math.max(hi, 1), 6);
  const bins = 30;
  const w = (d1 - d0) / bins;
  const counts = Array<number>(bins).fill(0);
  for (const v of r.npvs) counts[Math.min(bins - 1, Math.max(0, Math.floor((v / 1e6 - d0) / w)))]++;
  const cmax = Math.max(...counts, 1);
  const sx = scale(d0, d1, x0, x1);
  const sy = scale(0, cmax, bot, top);
  const ticks = niceTicks(d0, d1, 6);
  const marks = [
    { v: r.mean / 1e6, label: 'mean', color: '#333', dash: undefined as string | undefined },
    { v: r.riskAdjusted / 1e6, label: 'risk-adjusted', color: TEXT.green, dash: '2 3' },
    { v: r.p5 / 1e6, label: '5th percentile', color: TEXT.red, dash: '4 3' },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 188"
      role="img"
      aria-label={`Net present value of the business over ${fmt(r.npvs.length)} simulated three-year paths: mean ${m$(r.mean)}, 5th percentile ${m$(r.p5)}, risk-adjusted value ${m$(r.riskAdjusted)}; ${pctOf(r.probLoss)} of paths lose money.`}
    >
      <text className="ax" x={x0} y={12}>
        Paths, by the business’s net present value over three years
      </text>
      {counts.map((c, i) => {
        const a = d0 + i * w;
        return c > 0 ? <rect key={i} x={sx(a) + 0.5} width={Math.max(0.5, sx(a + w) - sx(a) - 1)} y={sy(c)} height={bot - sy(c)} fill={a + w / 2 < 0 ? tint(RED, 0.7) : tint(GREEN, 0.7)} /> : null;
      })}
      <line className="base" x1={x0} x2={x1} y1={bot} y2={bot} />
      <line x1={sx(0)} x2={sx(0)} y1={top - 8} y2={bot} stroke="#999" strokeWidth={1} />
      {marks.map((mk, i) => {
        const right = sx(mk.v) < x1 - 170;
        return (
          <g key={mk.label}>
            <line x1={sx(mk.v)} x2={sx(mk.v)} y1={top - 6 + i * 2} y2={bot} stroke={mk.color} strokeWidth={1.5} strokeDasharray={mk.dash} />
            <text className="ax" x={sx(mk.v) + (right ? 4 : -4)} y={24 + i * 12} style={{ textAnchor: right ? 'start' : 'end', fill: mk.color }}>
              {mk.label} {m$(mk.v * 1e6)}
            </text>
          </g>
        );
      })}
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={166}>
          {t === 0 ? '$0' : `${t < 0 ? '−' : ''}$${fmt(Math.abs(t), Number.isInteger(t) ? 0 : 1)}M`}
        </text>
      ))}
      <text className="ax ax-e" x={x1} y={182}>
        losing paths in red: {pctOf(r.probLoss)}
      </text>
    </svg>
  );
}

function QuarterChart({ r, nextGen }: { r: BusinessResult; nextGen: number }) {
  const x0 = 64;
  const x1 = 616;
  const top = 24;
  const bot = 118;
  const n = r.quarterMedian.length;
  const vals = r.quarterMedian.map((x) => x / 1e6);
  const [d0, d1] = niceDomain(Math.min(0, ...vals), Math.max(0.1, ...vals), 4);
  const sx = scale(0.5, n + 0.5, x0, x1);
  const sy = scale(d0, d1, bot, top);
  const bw = (sx(2) - sx(1)) * 0.6;
  const a0 = Math.max(0, nextGen - WORLD_DEFAULT.nextGenSpread);
  const a1 = Math.min(n - 1, nextGen + WORLD_DEFAULT.nextGenSpread);
  const inTerm = a0 < n;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 148"
      role="img"
      aria-label={`Median profit each quarter, after the fleet's fixed costs: ${vals.map((v, q) => `Q${q + 1} ${m$(v * 1e6)}`).join(', ')}. The next generation arrives ${nextGenLabel(nextGen)}.`}
    >
      <text className="ax" x={x0} y={12}>
        Median profit each quarter, after fixed costs, $M
      </text>
      {inTerm && (
        <g>
          <rect x={sx(a0 + 0.5)} y={top} width={sx(a1 + 1.5) - sx(a0 + 0.5)} height={bot - top} fill={tint(GRAPHIC.teal, 0.12)} />
          <text className="ax" x={sx(a0 + 0.5) + 4} y={bot - 6} style={{ fill: TEXT.teal }}>
            next generation arrives
          </text>
        </g>
      )}
      <GridY y={sy} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={(v) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Number.isInteger(v) ? 0 : 1)}M`} baseline={0} />
      {vals.map((v, q) => (
        <rect key={q} x={sx(q + 1) - bw / 2} width={bw} y={Math.min(sy(v), sy(0))} height={Math.abs(sy(v) - sy(0))} fill={v >= 0 ? GREEN : RED} opacity={0.85} />
      ))}
      {vals.map((_, q) => (
        <text key={q} className="ax ax-m" x={sx(q + 1)} y={136}>
          Q{q + 1}
        </text>
      ))}
    </svg>
  );
}

/** One line describing the reader's design, with where each part is set. */
function DesignLine({ d }: { d: CloudDesign }) {
  const f = d.fleet;
  const site = SITES[f.site].name;
  const gpus = GPU_IDS.filter((g) => f.gpus[g] > 0)
    .map((g) => `${fmt(f.gpus[g])} ${ACCELERATORS[g].short}`)
    .join(', ');
  const changed = (a: unknown, b: unknown) => json(a) !== json(b);
  const start = defaultCloud();
  return (
    <p className="cap" style={{ paddingTop: 0 }}>
      Your cloud: {gpus || 'no GPUs'} at {site}, {f.cooling === 'liquid' ? 'liquid' : 'air'}-cooled (<a href={lessonHref('compute/7.1')}>7.1</a>);{' '}
      {changed(d.customers, start.customers) ? 'your own customers' : 'the starting customers'} (<a href={lessonHref('compute/7.2')}>7.2</a>);{' '}
      {changed(d.prices, start.prices) ? 'your own prices' : 'the starting prices'} (<a href={lessonHref('compute/7.3')}>7.3</a>);{' '}
      {d.ops.policy === 'tiered' ? 'on-demand before spot' : 'first come, first served'}
      {GPU_IDS.some((g) => d.ops.rented[g] > 0) ? ', renting GPUs' : ''}
      {d.ops.burst ? ', bursting' : ''} (<a href={lessonHref('compute/7.4')}>7.4</a>).
    </p>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: saved strategies compared.

interface Point {
  key: string;
  label: string;
  mean: number;
  p5: number;
  kind: 'start' | 'saved' | 'current';
}

function CompareChart({ points }: { points: Point[] }) {
  const x0 = 72;
  const x1 = 612;
  const top = 26;
  const bot = 196;
  const xs = points.map((p) => p.mean / 1e6);
  const ys = points.map((p) => p.p5 / 1e6);
  const [a0, a1] = niceDomain(Math.min(-1, ...xs), Math.max(1, ...xs), 5);
  const [b0, b1] = niceDomain(Math.min(-1, ...ys), Math.max(1, ...ys), 4);
  const sx = scale(a0, a1, x0, x1);
  const sy = scale(b0, b1, bot, top);
  const money = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v), Number.isInteger(v) ? 0 : 1)}M`;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 232"
      role="img"
      aria-label={`Strategies by their mean outcome and their 5th percentile: ${points.map((p) => `${p.label}, mean ${m$(p.mean)} and 5th percentile ${m$(p.p5)}`).join('; ')}.`}
    >
      <text className="ax" x={x0} y={12}>
        5th-percentile outcome (a bad case), $M
      </text>
      <GridY y={sy} ticks={niceTicks(b0, b1, 4)} x0={x0} x1={x1} format={money} baseline={0} />
      {a0 < 0 && a1 > 0 && <line x1={sx(0)} x2={sx(0)} y1={top} y2={bot} stroke="#d9d9d5" />}
      {niceTicks(a0, a1, 5).map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={bot + 16}>
          {money(t)}
        </text>
      ))}
      <text className="ax ax-e" x={x1} y={bot + 32}>
        mean outcome, $M — better strategies sit up and to the right
      </text>
      {points.map((p) => {
        const cx = sx(p.mean / 1e6);
        const cy = sy(p.p5 / 1e6);
        const right = cx < x1 - 120;
        return (
          <g key={p.key}>
            {p.kind === 'current' ? (
              <circle cx={cx} cy={cy} r={8} fill="none" stroke="#333" strokeWidth={2} />
            ) : (
              <circle cx={cx} cy={cy} r={5} fill={p.kind === 'start' ? '#9a9a9a' : GREEN} stroke="#fcfcfb" strokeWidth={1.5} />
            )}
            <text className="ax" x={cx + (right ? 10 : -10)} y={cy + 4} style={{ textAnchor: right ? 'start' : 'end', fill: p.kind === 'saved' ? TEXT.green : '#333' }}>
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const design = useCloud();
  const attempts = useAttempts();
  const world = useScenario('world', WORLD_STATE_DEFAULTS);
  const w = world.state;
  const dw = useDeferredValue(w);
  const dd = useDeferredValue(design);
  const N = useMemo(() => lessonNumbers(), []);

  const result = useMemo(() => runStrategy(dd, dw), [dd, dw]);
  const ev = useMemo(() => evaluateFleet(design.fleet), [design.fleet]);
  const standard = useMemo(() => runStrategy(dd), [dd]);
  const site = SITES[design.fleet.site];

  // Challenge a.
  const solvedA = targetSolved(design, w);
  let statusA: string;
  if (!isStartingWorld(w)) statusA = 'The test is against the starting world: press Reset under the first demonstration.';
  else if (!customersAreStarting(design.customers)) statusA = 'The test uses the starting customers, and yours have been changed in Lesson 7.2. Reset them there.';
  else if (!ev.ok) statusA = `This fleet fails a check in Lesson 7.1: ${ev.checks.filter((c) => !c.ok && (c.id === 'racks' || c.id === 'grid')).map((c) => c.text).join(' ')}`;
  else statusA = `Your strategy is worth ${m$(result.riskAdjusted)} risk-adjusted: ${m$(Math.max(0, TARGET - result.riskAdjusted))} short.`;

  // Challenge b.
  const solvedB = beatsStart(attempts);
  const save = () => {
    const r = runStrategy(design);
    saveAttempt({ design, riskAdjusted: r.riskAdjusted, mean: r.mean, p5: r.p5, probLoss: r.probLoss });
  };

  const points: Point[] = [
    { key: 'start', label: 'starting design', mean: N.start.mean, p5: N.start.p5, kind: 'start' },
    ...attempts.map((a) => ({ key: a.id, label: a.name, mean: a.mean, p5: a.p5, kind: 'saved' as const })),
    { key: 'current', label: 'your design now', mean: standard.mean, p5: standard.p5, kind: 'current' },
  ];

  const caption = !ev.ok
    ? `This fleet fails a check in Lesson 7.1, so it couldn’t be built; the numbers assume it could.`
    : result.probLoss === 0
      ? `Every one of the ${fmt(result.npvs.length)} paths makes money; the worst 5% still earn ${m$(result.p5)} or more.`
      : `${pctOf(result.probLoss)} of paths lose money. On average the business is worth ${m$(result.mean)}, but the worst 5% end at ${m$(result.p5)} or below.`;

  return (
    <LessonPage id="compute/7.5">
      <P>
        Four lessons have built a GPU cloud: a fleet and its building at a site (<a href={lessonHref('compute/7.1')}>Lesson 7.1</a>), customers with their own work,
        latency limits and products (<a href={lessonHref('compute/7.2')}>7.2</a>), a price book (<a href={lessonHref('compute/7.3')}>7.3</a>), and a plan for running
        it week by week (<a href={lessonHref('compute/7.4')}>7.4</a>). A week told us whether the cloud runs. It can’t tell us whether the cloud was worth building. Its
        capital is committed for years (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>), its customers’ demand will grow by amounts nobody can promise (
        <a href={lessonHref('compute/5.3')}>5.3</a>), and somewhere a newer generation of accelerators will arrive and lower what customers will pay for this fleet’s work (
        <a href={lessonHref('compute/5.2')}>5.2</a>, <a href={lessonHref('compute/6.5')}>6.5</a>). This lesson runs the whole business through three such years,
        many times over, and scores it.
      </P>
      <P>
        Nothing in the test is new. Each simulated path is twelve quarters. In each, every customer’s demand grows by its expected rate, give or take an uncertain
        amount; the cloud runs a representative weekday and weekend day exactly as in Lesson 7.4 — reserved customers on their committed GPUs, then on-demand and spot
        customers by the plan’s policy — and the two days are scaled up to the quarter’s 65 weekdays and 26 weekend days; failures take away a share of the GPU-hours; once the next generation arrives, customers will pay
        less; and the fleet’s fixed cost, Lesson 4.5’s capital recovery and upkeep, is paid whether the GPUs are busy or not. Each path’s quarters are discounted at
        10% a year and summed into a net present value, as for the contract of Lesson 6.5. The score is the <K c="price">risk-adjusted value</K>: the mean over{' '}
        {fmt(WORLD_DEFAULT.paths)} paths minus half their standard deviation. It rewards a strategy for what it earns on average and charges it for how widely its
        outcomes spread.
      </P>
      <P>
        In the next demonstration, the bars count the paths by their net present value, losses in red, and the lower chart is each quarter’s median profit. The
        strategy is the design you built in Lessons 7.1–7.4, or the starting design if you skipped them; the sliders don’t change it. They change the world it meets:
        when the next generation arrives and how much it cuts what customers pay, how uncertain growth is, how many GPU-hours are lost to failures, the price of
        energy, and how many years the servers must pay for themselves in:
      </P>

      <Figure
        name="GPU Cloud Strategy Challenge"
        onReset={world.reset}
        actions={
          <Button onClick={save} label="Save this strategy to compare it later">
            Save strategy
          </Button>
        }
      >
        <DesignLine d={design} />
        <Histogram r={result} />
        <QuarterChart r={result} nextGen={w.nextGen} />
        <Readouts
          items={[
            { label: 'risk-adjusted value', value: m$(result.riskAdjusted), tone: result.riskAdjusted >= 0 ? 'green' : 'red' },
            { label: 'mean net present value', value: m$(result.mean), tone: 'green' },
            { label: '5th percentile', value: m$(result.p5), tone: result.p5 >= 0 ? 'green' : 'red' },
            { label: 'chance of a loss', value: pctOf(result.probLoss), tone: result.probLoss > 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider
          label="Next generation arrives"
          tone="teal"
          value={w.nextGen}
          min={NEXT_GEN_MIN}
          max={NEXT_GEN_MAX}
          onChange={(v) => world.set({ nextGen: v })}
          display={nextGenLabel(w.nextGen)}
        />
        <Slider label="It cuts what customers pay by" tone="green" value={w.drop} min={0} max={60} step={5} onChange={(v) => world.set({ drop: v })} display={`${w.drop}%`} />
        <Slider label="Growth uncertainty" value={w.sigma} min={0} max={30} onChange={(v) => world.set({ sigma: v })} display={`± ${w.sigma}% a quarter`} />
        <Slider label="GPU-hours lost to failures" value={w.failure} min={0} max={15} onChange={(v) => world.set({ failure: v })} display={`${w.failure}%`} />
        <Slider
          label="Electricity price"
          tone="red"
          value={w.energy}
          min={0.5}
          max={3}
          step={0.25}
          onChange={(v) => world.set({ energy: v })}
          display={`$${fmt(site.powerPrice * w.energy)} per MWh`}
        />
        <Slider label="Servers pay for themselves in" tone="green" value={w.life} min={3} max={7} onChange={(v) => world.set({ life: v })} display={`${w.life} years`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The starting design — the defaults of the four previous lessons — is worth {million(N.start.mean)} on average, but {pctOf(N.start.probLoss)} of its paths
        lose money, the worst 5% lose {million(-N.start.p5)} or more, and its risk-adjusted value is {million(N.start.riskAdjusted)}. Its first week in Lesson 7.4
        showed why. Its {fmt(N.startGpus)} GPUs cost {usd(N.startFixedWeek)} a week to own before any of them does a thing, and while every B-class GPU was busy,{' '}
        {pctOf(N.startWeek.utilization.A)} of the A-class hours and only {pctOf(N.startWeek.utilization.L)} of the L-class hours were. Revenue of{' '}
        {usd(N.startWeek.revenue)} a week left a loss of {usd(-N.startWeek.profit)}. Growth slowly fills the idle hours, and the business makes money on average;
        but a path with slow growth and an early new generation never fills them.
      </P>

      <H2>Building less, and better</H2>
      <P>
        The cure comes from three earlier lessons at once. A GPU-hour is mostly capital, so what matters is how many of a fleet’s hours are sold (Lesson 4.5). For
        every one of these customers, a B-class hour does the work for less than an A-class hour, at these prices (<a href={lessonHref('compute/5.1')}>Lesson 5.1</a>
        ), and an L-class hour does almost none of their work at all (<a href={lessonHref('compute/3.5')}>Lesson 3.5</a>). And when the fleet is full, the
        on-demand customers should be served before spot work (<a href={lessonHref('compute/6.1')}>Lesson 6.1</a>). Consider a fleet of no L-class, 512 A-class and
        320 B-class GPUs, run on-demand before spot: {fmt(N.rightGpus)} GPUs instead of {fmt(N.startGpus)}. Its week takes in less, {usd(N.rightWeek.revenue)}, because
        it turns more work away: it serves {pctOf(N.rightWeek.served.c1)} of what the chat startup wants and {pctOf(N.rightWeek.served.c6)} of the document processor’s
        batch work. But it costs {usd(N.rightFixedWeek)} a week to own, its A-class GPUs are {pctOf(N.rightWeek.utilization.A)} busy, and the week ends{' '}
        {usd(N.rightWeek.profit)} ahead. Over three years it is worth {million(N.right.mean)} on average, the worst 5% still make {million(N.right.p5)}, no path
        loses money, and its risk-adjusted value is {million(N.right.riskAdjusted)}. Served first come, first served, the same fleet is worth{' '}
        {million(N.rightFirstCome.riskAdjusted)}.
      </P>
      <P>
        Selling less and earning more is not a paradox. Each hour a GPU sits idle costs nearly as much as a busy one (Lesson 4.5). The work this smaller fleet turns
        away is the document processor’s spot work, which pays least for each GPU-hour, and the chat startup’s busiest afternoon hours, which would need GPUs that sit
        idle the rest of the day. A real cloud might win some of that demand back later, adding capacity as demand actually grows rather than buying it all up front
        against a forecast.
      </P>

      <Challenge
        id="a"
        question={`Against the starting world and the starting customers, find a strategy — a fleet that passes Lesson 7.1’s checks, prices and an operating plan — whose risk-adjusted value is at least ${m$(TARGET, 0)}. Change the design in Lessons 7.1, 7.3 and 7.4, then come back.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${m$(result.riskAdjusted)} risk-adjusted. A fleet sized to the demand it can sell, leaning on the accelerator that does these customers’ work most cheaply, keeps its capital busy — the utilization of Lesson 4.5 and the comparative advantage of Lessons 3.5 and 6.1, priced over three uncertain years.`}
      />

      <H2>What can still break it</H2>
      <P>
        A strategy is only as good as the world it meets, and the sliders in the{' '}
        <FigRef to="GPU Cloud Strategy Challenge">first demonstration</FigRef> are that world. Take the smaller fleet. The single most powerful driver is one no
        engineer controls: how long the servers’ hours keep their value. Paid off over 3 years instead of 5, it is worth {million(N.life3.riskAdjusted)} risk-adjusted
        and {pctOf(N.life3.probLoss)} of its paths lose money; over 7 years, {million(N.life7.riskAdjusted)}. That is the server-life bet of Lesson 4.5 and the
        contract risk of Lesson 6.5. Bring the next generation forward to around Q3 and let it cut what customers pay by half, and the same fleet is worth{' '}
        {million(N.early.riskAdjusted)}, losing money on {pctOf(N.early.probLoss)} of paths: the supply chain of Lesson 5.2 decides when the fleet’s hours lose
        their value.
      </P>
      <P>
        Other drivers matter less. Triple the price of electricity and the smaller fleet’s risk-adjusted value falls to {million(N.energy3.riskAdjusted)}: a real
        cost, but, as Lessons 4.5 and <a href={lessonHref('compute/6.4')}>6.4</a> found, electricity is a small share of what a GPU-hour costs. Lose 10% of the
        GPU-hours to failures instead of 3% and it is worth {million(N.fail10.riskAdjusted)}. A strategy built for one world can still be tested in another; the
        robust ones are those whose worst cases you can live with.
      </P>

      <H2>Comparing strategies</H2>
      <P>
        Each strategy you save with the first demonstration’s Save strategy button is scored against the starting world, so that saved strategies compare fairly. In
        the next demonstration, each point is a strategy, placed by its mean outcome and by its 5th percentile, the bad case; the gray point is the starting design
        and the ring is your design as it stands. A strategy up and to the right of another is better on both counts. Load any of them to restore its whole design:
      </P>

      <Figure
        name="GPU Cloud Strategy Challenge · compare"
        actions={
          attempts.length > 0 ? (
            <Button onClick={clearAttempts} label="Delete every saved strategy">
              Clear saved
            </Button>
          ) : undefined
        }
      >
        <CompareChart points={points} />
        <div className="tbwrap">
          <table className="tb">
            <caption className="sr-only">Saved strategies, scored against the starting world</caption>
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col">Risk-adjusted</th>
                <th scope="col">Mean</th>
                <th scope="col">5th percentile</th>
                <th scope="col">Chance of loss</th>
                <th scope="col">
                  <span className="sr-only">Load</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="dim">
                <td>Starting design</td>
                <td>{m$(N.start.riskAdjusted)}</td>
                <td>{m$(N.start.mean)}</td>
                <td>{m$(N.start.p5)}</td>
                <td>{pctOf(N.start.probLoss)}</td>
                <td>
                  <Button onClick={() => updateCloud(() => defaultCloud())} label="Load the starting design">
                    Load
                  </Button>
                </td>
              </tr>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{m$(a.riskAdjusted)}</td>
                  <td>{m$(a.mean)}</td>
                  <td>{m$(a.p5)}</td>
                  <td>{pctOf(a.probLoss)}</td>
                  <td>
                    <Button onClick={() => updateCloud(() => a.design)} label={`Load ${a.name}`}>
                      Load
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Caption>
          {attempts.length === 0
            ? 'No strategies saved yet. Use Save strategy under the first demonstration.'
            : `${attempts.length} saved. Your design now: ${m$(standard.riskAdjusted)} risk-adjusted against the starting world.`}
        </Caption>
      </Figure>

      <Challenge
        id="b"
        figure="GPU Cloud Strategy Challenge · compare"
        question="With the starting customers, save a strategy that beats the starting design on both its mean outcome and its 5th percentile."
        solved={solvedB}
        status={
          attempts.length === 0
            ? 'No strategy saved yet.'
            : `None of your ${attempts.length} saved ${attempts.length === 1 ? 'strategy beats' : 'strategies beat'} the starting design’s ${m$(N.start.mean)} mean and ${m$(N.start.p5)} 5th percentile together.`
        }
        success="Solved. Better on average and better in the bad case: a strategy that dominates the one you started with. Most improvements trade one against the other; the best find both."
      />

      <H2>What the course has built</H2>
      <P>
        Every number in this lesson can be traced back to something physical. The price a customer pays for its work depends on how much of that work each
        accelerator does, and that came from memory capacity and bandwidth, arithmetic and the links between GPUs (Chapters <a href={lessonHref('compute/2.4')}>2</a>{' '}
        and <a href={lessonHref('compute/3.5')}>3</a>), which came in turn from transistors that switch, leak and heat up (
        <a href={lessonHref('compute/1.5')}>Chapter 1</a>). The fleet’s cost came from racks, megawatts, cooling and networks (
        <a href={lessonHref('compute/4.5')}>Chapter 4</a>). Its customers’ willingness to pay, and the different prices of different hours in different places,
        came from the markets of <a href={lessonHref('compute/5.5')}>Chapter 5</a>. And its strategy — what to build, how to sell it, whom to serve first, how much
        risk to carry — came from <a href={lessonHref('compute/6.1')}>Chapter 6</a>.
      </P>
      <P>
        That is why compute capacity is so hard to treat as a commodity. An hour of one GPU is not an hour of another, and an hour in one place is not an hour in
        another; its supply arrives in lumps, years late, through whichever stage is narrowest; its demand swings by the hour and grows by amounts no one can
        promise; and the hardware loses value on a schedule set by its successor. You can now explain why one GPU-hour commands a different price from another,
        forecast the supply and demand that set those prices, and design strategies to allocate, procure or sell GPU capacity profitably — and, by changing the
        physics underneath them, see when those strategies would stop working.
      </P>
    </LessonPage>
  );
}
