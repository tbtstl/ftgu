import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { useProgress } from '../../../course/progress';
import {
  STANDARD_WELL,
  TERMS,
  WATERFLOOD,
  netbackPerBbl,
  pinyonWellCost,
  runProgram,
  wellBreakeven,
  wellEconomics,
  worldProjects,
  type Project,
  type ProgramResult,
  type WellEconomics,
} from '../../../engines/oil/economics';
import { CRUDE_COLOR } from '../../../model/oil/crudes';

// ---------------------------------------------------------------------------
// Constants and challenge checks.

/** The price slider's step, $/bbl. */
export const PRICE_STEP = 0.5;

/** The rock-quality slider, % of the core well's output in every month. */
export const QUALITY = { min: 50, max: 130, step: 5, core: 100 };
/** Rock quality of the play's fringe acreage, % (as in the supply curve's fringe block). */
export const FRINGE_QUALITY = 65;

const breakevenCache = new Map<number, number>();
/** Breakeven benchmark price of a standard Pinyon well in rock of a given quality (% of the core). */
export function breakevenAt(qualityPct: number): number {
  let b = breakevenCache.get(qualityPct);
  if (b === undefined) {
    b = wellBreakeven(STANDARD_WELL, qualityPct / 100);
    breakevenCache.set(qualityPct, b);
  }
  return b;
}

/** Challenge a: in the core, the lowest price on the slider at which a standard Pinyon well's NPV is not negative. */
export function breakevenSolved(price: number, qualityPct: number = QUALITY.core): boolean {
  if (qualityPct !== QUALITY.core) return false;
  return wellEconomics(price).npv >= 0 && wellEconomics(price - PRICE_STEP).npv < 0;
}

export type CycleMode = 'full' | 'half';

const PROJECTS = worldProjects();

/** A project's breakeven under the chosen view. */
export function projectBreakeven(p: Project, mode: CycleMode): number {
  return mode === 'full' ? p.fullCycle : p.halfCycle;
}

/** Million barrels from projects whose breakeven the price covers. */
export function volumeCleared(price: number, mode: CycleMode, projects: Project[] = PROJECTS): number {
  return projects.filter((p) => projectBreakeven(p, mode) <= price).reduce((s, p) => s + p.volume, 0);
}

/** Challenge b: the new oil the world wants developed, million barrels. */
export const DEMAND_MBBL = 500;

/** Challenge b: the lowest price on the slider at which at least 500 million barrels get developed as new projects. */
export function demandSolved(mode: CycleMode, price: number, projects: Project[] = PROJECTS): boolean {
  if (mode !== 'full') return false;
  return volumeCleared(price, 'full', projects) >= DEMAND_MBBL && volumeCleared(price - PRICE_STEP, 'full', projects) < DEMAND_MBBL;
}

/** The project whose block, counting from the cheapest full-cycle breakeven, holds the 500 millionth barrel (Coldwater steam). */
export function marginalProject(volume = DEMAND_MBBL, projects: Project[] = PROJECTS): Project {
  let acc = 0;
  const sorted = [...projects].sort((a, b) => a.fullCycle - b.fullCycle);
  for (const p of sorted) {
    acc += p.volume;
    if (acc >= volume) return p;
  }
  return sorted[sorted.length - 1];
}

/** Whether a challenge of this lesson is solved now or was on an earlier visit: readouts that would give it away appear once it is. */
function useRevealed(challenge: string, solved: boolean): boolean {
  const done = useProgress()['oil/2.5']?.includes(challenge) ?? false;
  return solved || done;
}

/** A supply-curve block's label: its breakeven to the cent, so the label never hides the gap to the next slider step. */
export function blockLabel(breakeven: number): string {
  return price$(Math.round(breakeven * 100) / 100);
}

/** Money in prose and readouts: millions from $100,000 up, so "$0.9 million" sits beside "−$1.3 million". */
export function money(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `${x < 0 ? '−' : ''}$${fmt(a / 1e9, 2)} billion`;
  if (a >= 1e5) return `${x < 0 ? '−' : ''}$${fmt(a / 1e6, a >= 1e8 ? 0 : 1)} million`;
  return usd(x);
}

function price$(p: number): string {
  return usd(p, p % 1 ? 2 : 0);
}

const WELL_COST = pinyonWellCost();
const BREAKEVEN = wellBreakeven();
const W70 = wellEconomics(70);
const W50 = wellEconomics(50);
const W60 = wellEconomics(60);
/** Challenge a's estimate: where a straight line between the NPVs at $50 and $60, as the prose rounds them, crosses zero. */
export const STRAIGHT_LINE_BREAKEVEN = (() => {
  const r = (x: number) => Math.round(x / 1e5) / 10; // $ million, one decimal
  return 60 - (10 * r(W60.npv)) / (r(W60.npv) - r(W50.npv));
})();
const FIRST_YEAR_CASH = W70.cash.slice(1, 13).reduce((a, b) => a + b, 0);
/** Half-cycle breakeven of a Pinyon well: the price whose netback just covers the operating cost per barrel. */
const HALF_CYCLE = TERMS.differential + TERMS.opexPerBbl / ((1 - TERMS.royalty) * (1 - TERMS.productionTax));
/** At $70, the rate below which a month's oil no longer pays a well's fixed cost: it shuts in, b/d. */
export const SHUT_IN_RATE_70 = TERMS.fixedPerWellMonth / ((365.25 / 12) * (netbackPerBbl(70) - TERMS.opexPerBbl));
const P0 = runProgram({ wellsPerYear: 0, waterflood: false, price: 70 });
const P10 = runProgram({ wellsPerYear: 10, waterflood: false, price: 70 });
const PFLOOD = runProgram({ wellsPerYear: 0, waterflood: true, price: 70 });
const FLOOD_BBL = PFLOOD.flood.reduce((s, q) => s + (q * 365.25) / 12, 0);
const TOTAL_VOLUME = PROJECTS.reduce((s, p) => s + p.volume, 0);
const MAX_HALF_CYCLE = Math.max(...PROJECTS.map((p) => p.halfCycle));

/** Northfield's existing wells (no new investment, $70): the share of output lost in each of the next three years. */
export const NORTHFIELD_DECLINES: number[] = (() => {
  const yearly = [0, 1, 2, 3].map((y) => P0.northfield.slice(y * 12, y * 12 + 12).reduce((s, q) => s + q, 0) / 12);
  return [1, 2, 3].map((y) => 1 - yearly[y] / yearly[y - 1]);
})();

const NAME: Record<string, string> = {
  flood: 'Waterflood',
  seaboard: 'Seaboard',
  core: 'Pinyon core',
  coldwater: 'Coldwater steam',
  fringe: 'Pinyon fringe',
};
const COLOR: Record<string, string> = {
  flood: CRUDE_COLOR.northfield,
  seaboard: CRUDE_COLOR.seaboard,
  core: CRUDE_COLOR.pinyon,
  coldwater: CRUDE_COLOR.coldwater,
  fringe: '#8fb8d8',
};

const NF_COLOR = CRUDE_COLOR.northfield;
const FLOOD_COLOR = tint(CRUDE_COLOR.northfield, 0.45);
const RB_COLOR = CRUDE_COLOR.pinyon;

// ---------------------------------------------------------------------------
// Charts.

const fmtM = (v: number) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v))}M`);

/** Years shown for one well: its whole 30-year production profile. */
const WELL_YEARS = 30;

/** One well's capital, its net cash each year, and the discounted running total, which ends at the NPV. */
function WellCashChart({ e }: { e: WellEconomics }) {
  const annual = Array.from({ length: WELL_YEARS }, (_, y) => e.cash.slice(1 + y * 12, 13 + y * 12).reduce((s, v) => s + v, 0) / 1e6);
  const bars = [e.cash[0] / 1e6, ...annual];
  const monthly = Math.pow(1 + TERMS.discount, 1 / 12);
  const cum: number[] = [];
  let run = e.cash[0];
  let f = 1;
  cum.push(run / 1e6);
  for (let y = 0; y < WELL_YEARS; y++) {
    for (let m = 1 + y * 12; m <= 12 + y * 12; m++) {
      f *= monthly;
      run += (e.cash[m] ?? 0) / f;
    }
    cum.push(run / 1e6);
  }
  const [d0, d1] = niceDomain(Math.min(0, ...bars, ...cum), Math.max(1, ...bars, ...cum), 4);
  const X0 = 64;
  const X1 = 624;
  const slot = (X1 - X0) / (WELL_YEARS + 1);
  const y = scale(d0, d1, 176, 26);
  const xs = cum.map((_, i) => X0 + (i + 1) * slot);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 204"
      role="img"
      aria-label={`One well’s cash: ${money(e.cash[0])} of capital now, then ${money(annual[0] * 1e6)} of net cash in its first year and ${money(annual[1] * 1e6)} in its second. Discounted at 10%, the running total ends at ${money(e.npv)}, the well’s NPV.`}
    >
      <text className="ax" x={X0} y={14}>
        One well: capital, net cash each year ($ million), and its discounted running total
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={X0} x1={X1} format={fmtM} baseline={0} />
      {bars.map((v, i) => (
        <rect
          key={i}
          x={X0 + i * slot + slot * 0.15}
          width={slot * 0.7}
          y={Math.min(y(0), y(v))}
          height={Math.abs(y(v) - y(0))}
          fill={v >= 0 ? GRAPHIC.green : GRAPHIC.red}
          opacity={0.75}
        />
      ))}
      <path d={linePath([X0, ...xs], [y(0), ...cum.map(y)])} fill="none" stroke="#333" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={y(cum[cum.length - 1])} r={4.5} fill="#333" />
      <text className="ax ax-e" x={xs[xs.length - 1] - 6} y={y(cum[cum.length - 1]) - 8} style={{ fill: '#333' }}>
        NPV
      </text>
      <text className="ax ax-m" x={X0 + slot / 2} y={194}>
        now
      </text>
      {[5, 10, 15, 20, 25, 30].map((yr) => (
        <text key={yr} className="ax ax-m" x={X0 + (yr + 0.5) * slot} y={194}>
          {`year ${yr}`}
        </text>
      ))}
    </svg>
  );
}

const YEARS = 20;

/** Stacked oil production over 20 years, b/d. */
function ProductionChart({ r }: { r: ProgramResult }) {
  const n = YEARS * 12;
  const totals = Array.from({ length: n }, (_, m) => r.northfield[m] + r.flood[m] + r.pinyon[m]);
  const [, top] = niceDomain(0, Math.max(10000, ...totals), 4);
  const X0 = 64;
  const X1 = 624;
  const x = scale(0, n, X0, X1);
  const y = scale(0, top, 196, 26);
  const xs = Array.from({ length: n }, (_, m) => x(m + 0.5));
  const lay0 = r.northfield.slice(0, n);
  const lay1 = lay0.map((v, m) => v + r.flood[m]);
  const lay2 = lay1.map((v, m) => v + r.pinyon[m]);
  const zero = lay0.map(() => 0);
  const peakAt = totals.indexOf(Math.max(...totals));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 224"
      role="img"
      aria-label={`Oil production over the next 20 years, stacked: Northfield’s existing wells start at ${fmt(r.northfield[0])} barrels a day; total production peaks at ${fmt(totals[peakAt])} barrels a day in year ${Math.floor(peakAt / 12) + 1}, of which Pinyon wells make ${fmt(r.pinyon[peakAt])} and the waterflood ${fmt(r.flood[peakAt])}.`}
    >
      <text className="ax" x={X0} y={14}>
        Oil production, barrels per day
      </text>
      <GridY y={y} ticks={niceTicks(0, top, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={areaPath(xs, lay0.map(y), zero.map(y))} fill={NF_COLOR} opacity={0.85} />
      <path d={areaPath(xs, lay1.map(y), lay0.map(y))} fill={FLOOD_COLOR} />
      <path d={areaPath(xs, lay2.map(y), lay1.map(y))} fill={RB_COLOR} opacity={0.85} />
      <path d={linePath(xs, lay2.map(y))} fill="none" stroke="#333" strokeWidth={1.2} />
      {[0, 5, 10, 15, 20].map((yr) => (
        <text key={yr} className="ax ax-m" x={x(yr * 12)} y={212}>
          {yr === 0 ? 'now' : `year ${yr}`}
        </text>
      ))}
    </svg>
  );
}

/** Annual net cash (bars) and the running total of discounted cash, which ends at the NPV. */
function CashChart({ r }: { r: ProgramResult }) {
  const annual = Array.from({ length: YEARS }, (_, yr) => r.cash.slice(yr * 12, yr * 12 + 12).reduce((s, v) => s + v, 0) / 1e6);
  const monthly = Math.pow(1 + TERMS.discount, 1 / 12);
  const cum: number[] = [];
  let run = 0;
  let f = 1;
  for (let m = 0; m < YEARS * 12; m++) {
    run += r.cash[m] / f;
    f *= monthly;
    if (m % 12 === 11) cum.push(run / 1e6);
  }
  const lo = Math.min(0, ...annual, ...cum);
  const hi = Math.max(1, ...annual, ...cum);
  const [d0, d1] = niceDomain(lo, hi, 4);
  const X0 = 64;
  const X1 = 624;
  const slot = (X1 - X0) / YEARS;
  const y = scale(d0, d1, 176, 26);
  const xs = cum.map((_, i) => X0 + (i + 1) * slot);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 204"
      role="img"
      aria-label={`Net cash by year: ${annual
        .slice(0, 6)
        .map((v, i) => `year ${i + 1} ${fmtM(Math.round(v))}`)
        .join(', ')}, and so on. Discounted at 10%, the running total reaches ${money(r.npv)}, the program’s NPV.`}
    >
      <text className="ax" x={X0} y={14}>
        Net cash each year ($ million), and its discounted running total
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={X0} x1={X1} format={fmtM} baseline={0} />
      {annual.map((v, i) => (
        <rect
          key={i}
          x={X0 + i * slot + slot * 0.18}
          width={slot * 0.64}
          y={Math.min(y(0), y(v))}
          height={Math.abs(y(v) - y(0))}
          fill={v >= 0 ? GRAPHIC.green : GRAPHIC.red}
          opacity={0.75}
        />
      ))}
      <path d={linePath([X0, ...xs], [y(0), ...cum.map(y)])} fill="none" stroke="#333" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={y(cum[cum.length - 1])} r={4.5} fill="#333" />
      <text className="ax ax-e" x={xs[xs.length - 1] - 6} y={y(cum[cum.length - 1]) - 8} style={{ fill: '#333' }}>
        NPV
      </text>
      {[1, 5, 10, 15, 20].map((yr) => (
        <text key={yr} className="ax ax-m" x={X0 + (yr - 0.5) * slot} y={194}>
          {`year ${yr}`}
        </text>
      ))}
    </svg>
  );
}

/** Projects as blocks: width is volume, height is breakeven; the price line decides which go ahead. */
function SupplyCurve({ mode, price }: { mode: CycleMode; price: number }) {
  const sorted = [...PROJECTS].sort((a, b) => projectBreakeven(a, mode) - projectBreakeven(b, mode));
  const X0 = 64;
  const X1 = 624;
  const x = scale(0, 700, X0, X1);
  const y = scale(0, 90, 220, 26);
  let acc = 0;
  const blocks = sorted.map((p) => {
    const b = { p, from: acc, to: acc + p.volume, be: projectBreakeven(p, mode) };
    acc += p.volume;
    return b;
  });
  const goCount = blocks.filter((b) => b.be <= price).length;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 278"
      role="img"
      aria-label={`Supply curve of the world’s projects, ${mode === 'full' ? 'full-cycle' : 'half-cycle'} breakevens: ${blocks
        .map((b) => `${NAME[b.p.id]} ${fmt(b.p.volume)} million barrels at ${blockLabel(b.be)}`)
        .join(', ')}. At ${price$(price)}, ${goCount} of ${blocks.length} projects clear the price.`}
    >
      <text className="ax" x={X0} y={14}>
        Breakeven price, $ per barrel
      </text>
      <GridY y={y} ticks={[0, 20, 40, 60, 80]} x0={X0} x1={X1} format={(v) => `$${v}`} baseline={0} />
      {blocks.map(({ p, from, to, be }) => {
        const go = be <= price;
        const w = x(to) - x(from);
        return (
          <g key={p.id}>
            <rect
              x={x(from)}
              y={y(be)}
              width={Math.max(0, w - 2)}
              height={y(0) - y(be)}
              fill={go ? COLOR[p.id] : tint(COLOR[p.id], 0.25)}
              stroke={go ? 'none' : COLOR[p.id]}
              strokeDasharray={go ? undefined : '3 3'}
            />
            <text x={x(from) + w / 2} y={y(be) - 6} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
              {blockLabel(be)}
            </text>
            <text x={x(from) + w / 2} y={252} textAnchor="middle" style={{ fontSize: 11, fill: '#333' }}>
              {NAME[p.id]}
            </text>
          </g>
        );
      })}
      {[0, 100, 200, 300, 400, 500, 600, 700].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(0) + 4} stroke="#999" />
          <text className="ax ax-m" x={x(v)} y={y(0) + 15}>
            {v}
          </text>
        </g>
      ))}
      <line x1={X0} x2={X1} y1={y(price)} y2={y(price)} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text className="ax ax-e" x={X1} y={y(price) - 6} style={{ fill: TEXT.green, fontWeight: 500 }}>
        oil at {price$(price)}
      </text>
      <text className="ax ax-e" x={X1} y={272}>
        oil each project would produce, million barrels (blocks in order of breakeven)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  // ---- Figure 1: one well.
  const s1 = useScenario('well', { price: 70, quality: QUALITY.core });
  const { price, quality } = s1.state;
  const well = useMemo(() => wellEconomics(price, STANDARD_WELL, quality / 100), [price, quality]);
  const wellBe = useMemo(() => breakevenAt(quality), [quality]);
  const solvedA = useMemo(() => breakevenSolved(price, quality), [price, quality]);
  // The breakeven readout would give challenge a away, so it appears once the challenge has been solved.
  const revealed = useRevealed('a', solvedA);

  // ---- Figure 2: a development program.
  const s2 = useScenario('program', { wells: 10, flood: false, price: 70 });
  const { wells, flood } = s2.state;
  const program = useMemo(() => runProgram({ wellsPerYear: wells, waterflood: flood, price: s2.state.price }), [wells, flood, s2.state.price]);
  const totals = program.northfield.map((q, m) => q + program.flood[m] + program.pinyon[m]).slice(0, YEARS * 12);
  const peak = Math.max(...totals);

  // ---- Figure 3: the supply curve.
  const s3 = useScenario('breakevens', { mode: 'full' as CycleMode, price: 50 });
  const cleared = volumeCleared(s3.state.price, s3.state.mode);
  const clearedCount = PROJECTS.filter((p) => projectBreakeven(p, s3.state.mode) <= s3.state.price).length;
  const solvedB = demandSolved(s3.state.mode, s3.state.price);
  const revealB = useRevealed('b', solvedB);
  const marginal = marginalProject();

  const nb70 = netbackPerBbl(70);
  const declines = NORTHFIELD_DECLINES.map((d) => Math.round(d * 100));

  return (
    <LessonPage id="oil/2.5">
      <P>
        <a href={lessonHref('oil/2.4')}>The previous lesson</a> followed wells from their first oil to their economic limit: a Pinyon well loses most of its rate in
        its first year, and Northfield runs for years until the water it lifts costs more than the oil it brings with it. Whether a well is drilled in the first place
        is a question about money: what it costs, how much oil it will produce, how soon, and what that oil will sell for. This lesson puts prices on Chapter 2.
      </P>
      <P>
        Start with a single barrel. Our producer sells at the wellhead, for the benchmark price — the model’s crude price at the Kessler hub, which behaves like WTI —
        less a <b>differential</b> of {usd(TERMS.differential)} that pays for gathering, the pipeline to Kessler and the crude’s quality. The owner of the mineral rights
        takes a <b>royalty</b>, {pct(TERMS.royalty)} of the revenue, and a production tax takes {fmt(TERMS.productionTax * 100, 1)}% of what’s left; terms like these
        are typical of onshore oil production in the United States. At a benchmark of $70, the producer keeps
      </P>
      <Eq label={`Netback: ($70 minus $${TERMS.differential}) times 0.8 times 0.954 equals ${usd(nb70, 2)} per barrel`}>
        <span>($70</span>
        <Op>−</Op>
        <span>{usd(TERMS.differential)})</span>
        <Op>×</Op>
        <span>(1 − {fmt(TERMS.royalty, 2)})</span>
        <Op>×</Op>
        <span>(1 − {fmt(TERMS.productionTax, 3)})</span>
        <Op>=</Op>
        <K c="price">{usd(nb70, 2)}</K>
      </Eq>
      <P>
        per barrel, its <K c="price">netback</K>, and then pays {usd(TERMS.opexPerBbl)} a barrel to lift, treat and truck it, plus {usd(TERMS.fixedPerWellMonth)} a month
        to keep each well running. A well’s capital, though, is spent before it produces anything. To compare money spent now with money earned over twenty years, the
        industry <b>discounts</b> future cash: at 10% a year, $110 a year from now is worth $100 today. Adding up a project’s cash flows, each discounted to today,
        gives its <K c="price">net present value</K>, or NPV; at 10% it’s customarily called PV-10. The discount rate at which the NPV would be exactly zero is the
        project’s <b>internal rate of return</b>, and the time it takes for the cash to repay the capital is its <b>payback</b>.
      </P>
      <P>
        Our producer holds acreage in the Pinyon <b>play</b> — the stretch of the basin where the Pinyon shale holds oil — and is deciding whether to drill one
        more standard well there: a {fmt(STANDARD_WELL.lateral)}-foot lateral with {STANDARD_WELL.stages} fracture stages, from{' '}
        <a href={lessonHref('oil/2.3')}>Lesson 2.3</a>. A play isn’t uniform. In its <b>core</b>, where Lesson 2.3’s well was designed, the rock is at its best; toward
        the fringes, where the shale may be thinner, less pressured or hold less oil, the same well, at the same cost, produces less in every month. In the next
        demonstration, the rock quality sets that share: 100% is the core, and {FRINGE_QUALITY}% means {FRINGE_QUALITY}% of the core well’s oil, month by month. Set the
        oil price and the rock; prices here are the model’s, not market data:
      </P>

      <Figure name="Oil Field Planner" scenario={s1}>
        <WellCashChart e={well} />
        <Readouts
          items={[
            { label: <K c="price">NPV at 10%</K>, value: money(well.npv), tone: well.npv < 0 ? 'red' : 'green' },
            { label: 'rate of return', value: Number.isFinite(well.irr) ? pct(well.irr) : well.npv > 0 ? 'over 1,000%' : '—' },
            { label: 'payback', value: Number.isNaN(well.payback) ? 'never' : `${well.payback} months` },
            { label: revealed ? 'breakeven in this rock' : 'breakeven: see challenge a', value: revealed ? usd(wellBe, 2) : '?', tone: 'green' },
          ]}
        />
        <Slider
          label="Oil price (benchmark)"
          tone="green"
          value={price}
          min={30}
          max={120}
          step={PRICE_STEP}
          onChange={(v) => s1.set({ price: v })}
          display={`${price$(price)} per barrel`}
        />
        <Slider
          label="Rock quality"
          tone="orange"
          value={quality}
          min={QUALITY.min}
          max={QUALITY.max}
          step={QUALITY.step}
          onChange={(v) => s1.set({ quality: v })}
          display={`${quality}% of the core`}
        />
        <Caption>
          {`Whatever the rock, the well costs ${money(WELL_COST)}. In this rock, at ${price$(price)}, it produces about ${fmt(Math.round(well.eur / 1000))},000 barrels ${
            well.life >= WELL_YEARS * 12
              ? `over the ${WELL_YEARS} years modeled, and is still paying its way at the end.`
              : `over ${fmt(well.life / 12)} years before it reaches its economic limit.`
          }`}
        </Caption>
      </Figure>

      <P>
        Look first at the core, at $70. The well costs {money(WELL_COST)}, and its NPV is {money(W70.npv)}: a rate of return of about{' '}
        {fmt(Math.round(W70.irr * 10) * 10)}%, and its cash repays the capital in {W70.payback} months. Over its economic life of about {fmt(W70.life / 12)} years it
        produces some {fmt(Math.round(W70.eur / 1000))},000 barrels, but the steep decline of <a href={lessonHref('oil/2.4')}>Lesson 2.4</a> front-loads the cash: its first
        twelve months of production bring back {money(FIRST_YEAR_CASH)} of the {money(WELL_COST)}. Shale wells are <b>short-cycle</b> investments, months from decision to
        oil and a year or two to repay.
      </P>

      <H2>The breakeven price</H2>
      <P>
        Now slide the price down. At $60 the well’s NPV falls to {money(W60.npv)}, and at $50 it’s {money(W50.npv)}: the well no longer earns back its capital at 10% a year.
        Somewhere between, the NPV is exactly zero. That price is the well’s <K c="price">breakeven</K>, and it’s one of the most quoted numbers in the economics of
        oil production.
      </P>

      <Challenge
        id="a"
        question={`In the core (rock quality 100%), at what oil price does drilling another standard Pinyon well stop adding value? Estimate first: its NPV falls from ${money(W60.npv)} at $60 to ${money(W50.npv)} at $50, so where does a straight line between them cross zero? Then find the lowest price on the slider, in 50-cent steps, at which the NPV is not negative.`}
        solved={solvedA}
        status={
          quality !== QUALITY.core
            ? 'Set the rock quality back to 100%, the core of the play.'
            : `At ${price$(price)}, one more well has an NPV of ${money(well.npv)}.`
        }
        success={`Solved: ${price$(price)}. The breakeven is ${usd(BREAKEVEN, 2)}, close to the straight-line estimate of about ${usd(Math.round(STRAIGHT_LINE_BREAKEVEN * 10) / 10, 2)}: below it every new well destroys value, so a disciplined producer stops drilling — though the wells it already has keep producing.`}
      />

      <P>
        A breakeven is set by the rock as much as by the well. Once the challenge is solved, the demonstration reports the breakeven for whatever rock you set. Lower
        the rock quality to {FRINGE_QUALITY}%, typical of a play’s fringe, and the same {money(WELL_COST)} well brings up {FRINGE_QUALITY}% as much oil: its breakeven
        rises to about {usd(Math.round(breakevenAt(FRINGE_QUALITY)))}. In rock 20% better than the core, it falls to about {usd(Math.round(breakevenAt(120)))}. The
        well and its cost are the same each time; only the barrels it brings up for each dollar differ. That’s why producers drill their best acreage first.
      </P>

      <H2>A development program</H2>
      <P>
        A producer drills wells by the dozen, and ours owns Northfield too. In the next demonstration, you plan its next five years: choose how many standard wells to
        drill each year in the core of the Pinyon play, whether to fund Northfield’s waterflood, and the oil price:
      </P>

      <Figure name="Oil Field Planner · program" scenario={s2}>
        <Legend
          items={[
            { label: 'Northfield’s existing wells', color: NF_COLOR },
            { label: 'Waterflood’s extra oil', color: FLOOD_COLOR },
            { label: 'Pinyon wells', color: RB_COLOR },
          ]}
        />
        <ProductionChart r={program} />
        <CashChart r={program} />
        <Readouts
          items={[
            { label: <K c="price">program NPV at 10%</K>, value: money(program.npv), tone: program.npv < 0 ? 'red' : 'green' },
            { label: 'capital spent', value: money(program.capital) },
            { label: <K tone="orange">peak production</K>, value: `${fmt(peak)} b/d`, tone: 'orange' },
          ]}
        />
        <Slider label="Pinyon wells per year" tone="orange" value={wells} min={0} max={30} onChange={(v) => s2.set({ wells: v })} display={`${wells}`} />
        <Slider
          label="Oil price (benchmark)"
          tone="green"
          value={s2.state.price}
          min={30}
          max={120}
          step={PRICE_STEP}
          onChange={(v) => s2.set({ price: v })}
          display={`${price$(s2.state.price)} per barrel`}
        />
        <Checkbox label={`Fund Northfield’s waterflood (${money(WATERFLOOD.capital)}, starting next year)`} checked={flood} onChange={(v) => s2.set({ flood: v })} />
        <Caption>
          {wells === 0 && !flood
            ? `With no new investment, Northfield’s pumped wells decline toward their economic limit.`
            : `${wells > 0 ? `${wells * 5} Pinyon wells over five years` : 'No new Pinyon wells'}${flood ? ' and the waterflood' : ''}: ${money(program.capital)} of capital for an NPV of ${money(program.npv)}.`}
        </Caption>
      </Figure>

      <P>
        At $70, each ten wells a year adds about {money(P10.npv - P0.npv)} to the program’s value, for {money(P10.capital)} of capital. The waterflood is in another class: for{' '}
        {money(WATERFLOOD.capital)}, it brings up about {fmt(FLOOD_BBL / 1e6)} million barrels that Northfield’s pumps would have left behind, and raises the NPV by{' '}
        {money(PFLOOD.npv - P0.npv)}. Oil in a field already found, piped and staffed is often the cheapest a company can add. Notice too that the waterflood takes a year
        or two to build up, while each Pinyon well peaks within weeks.
      </P>

      <H2>Full cycle and half cycle</H2>
      <P>
        A breakeven that includes the capital is a <b>full-cycle</b> breakeven, and it governs whether a well is drilled. Once the well exists, its {money(WELL_COST)} is
        spent whatever happens next, and the decision to keep it running compares the price only with the costs of running it. For a Pinyon well that{' '}
        <b>half-cycle</b> breakeven is about {usd(HALF_CYCLE, 2)}: the price at which the netback just covers the {usd(TERMS.opexPerBbl)}-a-barrel operating cost. Its{' '}
        {usd(TERMS.fixedPerWellMonth)} a month of fixed costs matter only as it runs down: at $70, a well shuts in once it makes less than about{' '}
        {fmt(SHUT_IN_RATE_70)} barrels a day.
      </P>
      <P>
        So when prices fall, drilling stops quickly but production doesn’t. It declines only as fast as the existing wells do. A shale well’s decline shows within months, while the big conventional fields that supply most of the world’s oil usually decline far more slowly. Not every
        conventional field does: Northfield, small, past its peak and on pumps with no water injected to hold up its pressure, loses{' '}
        {`${Math.min(...declines)}–${Math.max(...declines)}%`} of its output a year over the next three years in{' '}
        <FigRef to="Oil Field Planner · program">the program demonstration</FigRef>.
      </P>
      <P>
        Every development in our world has both kinds of breakeven. In the next demonstration, each block is one of them: its width is the oil it would produce, its height
        its breakeven, and the blocks are sorted from cheapest to dearest, which makes a <b>supply curve</b>. The Pinyon breakevens come from the well model; the others
        are set at illustrative levels typical of their kind of project. Move the price, and switch between deciding to build and deciding to keep running:
      </P>

      <Figure name="Oil Field Planner · breakevens" scenario={s3}>
        <Segmented
          label="Breakeven"
          value={s3.state.mode}
          onChange={(v) => s3.set({ mode: v })}
          options={[
            { value: 'full', label: 'New projects: full cycle' },
            { value: 'half', label: 'Already built: half cycle' },
          ]}
        />
        <SupplyCurve mode={s3.state.mode} price={s3.state.price} />
        <Readouts
          items={[
            { label: 'projects', value: `${clearedCount} of ${PROJECTS.length}` },
            ...(revealB
              ? [{ label: s3.state.mode === 'full' ? 'oil that gets developed' : 'oil that keeps flowing', value: `${fmt(cleared)} million bbl`, tone: 'orange' as const }]
              : []),
          ]}
        />
        <Slider
          label="Oil price (benchmark)"
          tone="green"
          value={s3.state.price}
          min={10}
          max={100}
          step={PRICE_STEP}
          onChange={(v) => s3.set({ price: v })}
          display={`${price$(s3.state.price)} per barrel`}
        />
      </Figure>

      <P>
        At $50, only the waterflood and the Seaboard offshore expansion go ahead as new projects: {fmt(volumeCleared(50, 'full'))} million of the{' '}
        {fmt(TOTAL_VOLUME)} million barrels on offer. Switch to half cycle and everything already built keeps running at $50, and would keep running down to about{' '}
        {usd(Math.round(MAX_HALF_CYCLE))}, the running cost of the steam project.
        The offshore and steam projects also take years to build, so they answer a price change slowly in both directions; Pinyon’s wells answer within months.
      </P>

      <Challenge
        id="b"
        question={`Suppose the world needs ${DEMAND_MBBL} million barrels of new oil developed. Read the curve first: counting along its width from the cheapest block, which project supplies the ${DEMAND_MBBL} millionth barrel, and what price does that project need? Then, with full-cycle breakevens, set the lowest price on the slider, in 50-cent steps, that gets at least ${DEMAND_MBBL} million barrels developed.`}
        solved={solvedB}
        status={
          s3.state.mode !== 'full'
            ? 'Switch to full-cycle breakevens: the question is about starting new projects.'
            : `At ${price$(s3.state.price)}, ${clearedCount} of ${PROJECTS.length} projects go ahead.`
        }
        success={`Solved: ${price$(s3.state.price)}. The cheaper blocks add up to only ${fmt(volumeCleared(marginal.fullCycle - 0.01, 'full'))} million barrels, so the ${DEMAND_MBBL} millionth comes from ${NAME[marginal.id]}, which breaks even at ${blockLabel(marginal.fullCycle)}. To call it forth, the price has to cover the dearest barrel the market needs, not the average one: at ${price$(s3.state.price)} the waterflood, which would go ahead at ${blockLabel(PROJECTS.find((p) => p.id === 'flood')!.fullCycle)}, earns far more than it needs.`}
      />

      <P>
        That answers the chapter’s question. Oil reaches the surface because pressure pushes it through rock toward a well, at a rate set by the rock’s permeability, the
        oil’s viscosity and how much rock the well touches; falling pressure and rising water end each well’s life. Production economics come down to how many barrels a
        dollar of capital brings up, how soon, and what they sell for after royalties, taxes and running costs. You can return to{' '}
        <FigRef to="Oil Field Planner">the first demonstration</FigRef> to trace a well’s breakeven to its rock, or to{' '}
        <FigRef to="Oil Field Planner · program">the program</FigRef> to test any plan against any price.
      </P>
      <P>
        Our four crudes now leave their fields: Pinyon Light and Northfield Sour from the basin, Coldwater Heavy from the north, Seaboard Blend by sea. None of them is
        any use as it is. Chapter 3 follows them into the Corran refinery, starting with <a href={lessonHref('oil/3.1')}>the distillation tower</a> that splits each barrel
        into its cuts.
      </P>
    </LessonPage>
  );
}
