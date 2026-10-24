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
import {
  STANDARD_WELL,
  TERMS,
  WATERFLOOD,
  netbackPerBbl,
  ridgebackWellCost,
  runProgram,
  wellBreakeven,
  wellEconomics,
  worldProjects,
  type Project,
  type ProgramResult,
} from '../../../engines/oil/economics';
import { CRUDE_COLOR } from '../../../model/oil/crudes';

// ---------------------------------------------------------------------------
// Constants and challenge checks.

/** The price slider's step, $/bbl. */
export const PRICE_STEP = 0.5;

/** Challenge a: the lowest price on the slider at which a standard Ridgeback well's NPV is not negative. */
export function breakevenSolved(price: number): boolean {
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

/** Challenge b: the lowest price on the slider at which every project goes ahead as a new development. */
export function allProjectsSolved(mode: CycleMode, price: number, projects: Project[] = PROJECTS): boolean {
  if (mode !== 'full') return false;
  const all = (p: number) => projects.every((x) => x.fullCycle <= p);
  return all(price) && !all(price - PRICE_STEP);
}

const WELL_COST = ridgebackWellCost();
const BREAKEVEN = wellBreakeven();
const FRINGE_BREAKEVEN = wellBreakeven(STANDARD_WELL, 0.65);
const W70 = wellEconomics(70);
const W50 = wellEconomics(50);
const W60 = wellEconomics(60);
const FIRST_YEAR_CASH = W70.cash.slice(1, 13).reduce((a, b) => a + b, 0);
/** Half-cycle breakeven of a Ridgeback well: the price whose netback just covers the operating cost per barrel. */
const HALF_CYCLE = TERMS.differential + TERMS.opexPerBbl / ((1 - TERMS.royalty) * (1 - TERMS.productionTax));
const P0 = runProgram({ wellsPerYear: 0, waterflood: false, price: 70 });
const P10 = runProgram({ wellsPerYear: 10, waterflood: false, price: 70 });
const PFLOOD = runProgram({ wellsPerYear: 0, waterflood: true, price: 70 });
const FLOOD_BBL = PFLOOD.flood.reduce((s, q) => s + (q * 365.25) / 12, 0);
const TOTAL_VOLUME = PROJECTS.reduce((s, p) => s + p.volume, 0);
const FRINGE = PROJECTS.find((p) => p.id === 'fringe')!;
const MAX_HALF_CYCLE = Math.max(...PROJECTS.map((p) => p.halfCycle));

const NAME: Record<string, string> = {
  flood: 'Waterflood',
  seaboard: 'Seaboard',
  core: 'Ridgeback core',
  coldwater: 'Coldwater steam',
  fringe: 'Ridgeback fringe',
};
const COLOR: Record<string, string> = {
  flood: CRUDE_COLOR.northfield,
  seaboard: CRUDE_COLOR.seaboard,
  core: CRUDE_COLOR.ridgeback,
  coldwater: CRUDE_COLOR.coldwater,
  fringe: '#8fb8d8',
};

const NF_COLOR = CRUDE_COLOR.northfield;
const FLOOD_COLOR = tint(CRUDE_COLOR.northfield, 0.45);
const RB_COLOR = CRUDE_COLOR.ridgeback;

function money(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `${x < 0 ? '−' : ''}$${fmt(a / 1e9, 2)} billion`;
  if (a >= 1e6) return `${x < 0 ? '−' : ''}$${fmt(a / 1e6, a >= 1e8 ? 0 : 1)} million`;
  return usd(x);
}

function price$(p: number): string {
  return usd(p, p % 1 ? 2 : 0);
}

// ---------------------------------------------------------------------------
// Charts.

const YEARS = 20;

/** Stacked oil production over 20 years, b/d. */
function ProductionChart({ r }: { r: ProgramResult }) {
  const n = YEARS * 12;
  const totals = Array.from({ length: n }, (_, m) => r.northfield[m] + r.flood[m] + r.ridgeback[m]);
  const [, top] = niceDomain(0, Math.max(10000, ...totals), 4);
  const X0 = 64;
  const X1 = 624;
  const x = scale(0, n, X0, X1);
  const y = scale(0, top, 196, 26);
  const xs = Array.from({ length: n }, (_, m) => x(m + 0.5));
  const lay0 = r.northfield.slice(0, n);
  const lay1 = lay0.map((v, m) => v + r.flood[m]);
  const lay2 = lay1.map((v, m) => v + r.ridgeback[m]);
  const zero = lay0.map(() => 0);
  const peakAt = totals.indexOf(Math.max(...totals));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 224"
      role="img"
      aria-label={`Oil production over the next 20 years, stacked: Northfield’s existing wells start at ${fmt(r.northfield[0])} barrels a day; total production peaks at ${fmt(totals[peakAt])} barrels a day in year ${Math.floor(peakAt / 12) + 1}, of which Ridgeback wells make ${fmt(r.ridgeback[peakAt])} and the waterflood ${fmt(r.flood[peakAt])}.`}
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
  const fmtM = (v: number) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v))}M`);
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
  const cleared = volumeCleared(price, mode);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 262"
      role="img"
      aria-label={`Supply curve of the world’s projects, ${mode === 'full' ? 'full-cycle' : 'half-cycle'} breakevens: ${blocks
        .map((b) => `${NAME[b.p.id]} ${fmt(b.p.volume)} million barrels at ${price$(Math.round(b.be * 100) / 100)}`)
        .join(', ')}. At ${price$(price)}, ${fmt(cleared)} million barrels clear the price.`}
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
              {price$(Math.round(be * 2) / 2)}
            </text>
            <text x={x(from) + w / 2} y={236} textAnchor="middle" style={{ fontSize: 11, fill: '#333' }}>
              {NAME[p.id]}
            </text>
          </g>
        );
      })}
      <line x1={X0} x2={X1} y1={y(price)} y2={y(price)} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text className="ax ax-e" x={X1} y={y(price) - 6} style={{ fill: TEXT.green, fontWeight: 500 }}>
        oil at {price$(price)}
      </text>
      <text className="ax ax-e" x={X1} y={256}>
        oil each project would produce, million barrels (blocks in order of breakeven)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('program', { wells: 10, flood: false, price: 70 });
  const { wells, flood, price } = s1.state;
  const program = useMemo(() => runProgram({ wellsPerYear: wells, waterflood: flood, price }), [wells, flood, price]);
  const well = useMemo(() => wellEconomics(price), [price]);
  const solvedA = useMemo(() => breakevenSolved(price), [price]);
  const totals = program.northfield.map((q, m) => q + program.flood[m] + program.ridgeback[m]).slice(0, YEARS * 12);
  const peak = Math.max(...totals);

  const s2 = useScenario('breakevens', { mode: 'full' as CycleMode, price: 50 });
  const cleared = volumeCleared(s2.state.price, s2.state.mode);
  const clearedCount = PROJECTS.filter((p) => projectBreakeven(p, s2.state.mode) <= s2.state.price).length;
  const solvedB = allProjectsSolved(s2.state.mode, s2.state.price);

  const nb70 = netbackPerBbl(70);

  return (
    <LessonPage id="oil/2.5">
      <P>
        <a href={lessonHref('oil/2.4')}>The previous lesson</a> followed wells from their first oil to their economic limit: a Ridgeback well loses most of its rate in
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
        In the next demonstration, you plan the next five years for a producer that owns Northfield and acreage in the Ridgeback play. Choose how many standard Ridgeback
        wells — {fmt(STANDARD_WELL.lateral)}-foot laterals with {STANDARD_WELL.stages} fracture stages, from <a href={lessonHref('oil/2.3')}>Lesson 2.3</a> — to drill each
        year, whether to fund Northfield’s waterflood, and the oil price. Prices here are the model’s, not market data:
      </P>

      <Figure name="Oil Field Planner" scenario={s1}>
        <Legend
          items={[
            { label: 'Northfield’s existing wells', color: NF_COLOR },
            { label: 'Waterflood’s extra oil', color: FLOOD_COLOR },
            { label: 'Ridgeback wells', color: RB_COLOR },
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
        <Readouts
          items={[
            { label: 'one Ridgeback well: NPV', value: money(well.npv), tone: well.npv < 0 ? 'red' : 'green' },
            { label: 'rate of return', value: Number.isFinite(well.irr) ? pct(well.irr) : '—' },
            { label: 'payback', value: Number.isNaN(well.payback) ? 'never' : `${well.payback} months` },
            { label: 'breakeven', value: usd(BREAKEVEN, 2), tone: 'green' },
          ]}
        />
        <Slider label="Ridgeback wells per year" tone="orange" value={wells} min={0} max={30} onChange={(v) => s1.set({ wells: v })} display={`${wells}`} />
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
        <Checkbox label={`Fund Northfield’s waterflood (${money(WATERFLOOD.capital)}, starting next year)`} checked={flood} onChange={(v) => s1.set({ flood: v })} />
        <Caption>
          {wells === 0 && !flood
            ? `With no new investment, Northfield’s pumped wells decline toward their economic limit.`
            : `${wells > 0 ? `${wells * 5} Ridgeback wells over five years` : 'No new Ridgeback wells'}${flood ? ' and the waterflood' : ''}: ${money(program.capital)} of capital for an NPV of ${money(program.npv)}.`}
        </Caption>
      </Figure>

      <P>
        Look first at one well. At $70, a standard Ridgeback well costs {money(WELL_COST)}, and its NPV is {money(W70.npv)}: a rate of return of about{' '}
        {fmt(Math.round(W70.irr * 10) * 10)}%, and its cash repays the capital in {W70.payback} months. Over its economic life of about {fmt(W70.life / 12)} years it
        produces some {fmt(Math.round(W70.eur / 1000))},000 barrels, but the steep decline of <a href={lessonHref('oil/2.4')}>Lesson 2.4</a> front-loads the cash: its first
        twelve months of production bring back {money(FIRST_YEAR_CASH)} of the {money(WELL_COST)}. Shale wells are <b>short-cycle</b> investments, months from decision to
        oil and a year or two to repay.
      </P>
      <P>
        At $70, each ten wells a year adds about {money(P10.npv - P0.npv)} to the program’s value, for {money(P10.capital)} of capital. The waterflood is in another class: for{' '}
        {money(WATERFLOOD.capital)}, it brings up about {fmt(FLOOD_BBL / 1e6)} million barrels that Northfield’s pumps would have left behind, and raises the NPV by{' '}
        {money(PFLOOD.npv - P0.npv)}. Oil in a field already found, piped and staffed is often the cheapest a company can add. Notice too that the waterflood takes a year
        or two to build up, while each Ridgeback well peaks within weeks.
      </P>

      <H2>The breakeven price</H2>
      <P>
        Now slide the price down. At $60 the well’s NPV falls to {money(W60.npv)}, and at $50 it’s {money(W50.npv)}: the well no longer earns back its capital at 10% a year.
        Somewhere between, the NPV is exactly zero. That price is the well’s <K c="price">breakeven</K>, and it’s one of the most quoted numbers in the economics of
        oil production. Breakevens depend on the rock as much as on the price: in fringe acreage, where the same well produces 65% as much, the breakeven rises to about{' '}
        {usd(Math.round(FRINGE_BREAKEVEN))}.
      </P>

      <Challenge
        id="a"
        question="Find the oil price, to the nearest 50 cents, at which drilling another standard Ridgeback well stops adding value: the lowest price at which its NPV is not negative."
        solved={solvedA}
        status={`At ${price$(price)}, one more well has an NPV of ${money(well.npv)}.`}
        success={`Solved: ${price$(price)}. The breakeven is ${usd(BREAKEVEN, 2)}: below it every new well lowers the program’s value, so a disciplined producer stops drilling — though the wells it already has keep producing.`}
      />

      <H2>Full cycle and half cycle</H2>
      <P>
        That last point matters a great deal for the market. A breakeven that includes the capital is a <b>full-cycle</b> breakeven, and it governs whether a well is
        drilled. Once the well exists, its {money(WELL_COST)} is spent whatever happens next, and the decision to keep it running compares the price only with the costs of
        running it. For a Ridgeback well that <b>half-cycle</b> breakeven is about {usd(HALF_CYCLE, 2)}: the price at which the netback just covers the{' '}
        {usd(TERMS.opexPerBbl)}-a-barrel operating cost. So when prices fall, drilling stops quickly but production doesn’t. It declines only as fast as the existing wells
        do — for shale wells, fast enough to show within months to a year; for conventional and offshore fields, much more slowly.
      </P>
      <P>
        Every development in our world has both kinds of breakeven. In the next demonstration, each block is one of them: its width is the oil it would produce, its height
        its breakeven, and the blocks are sorted from cheapest to dearest, which makes a <b>supply curve</b>. The Ridgeback breakevens come from the well model; the others
        are set at illustrative levels typical of their kind of project. Move the price, and switch between deciding to build and deciding to keep running:
      </P>

      <Figure name="Oil Field Planner · breakevens" scenario={s2}>
        <Segmented
          label="Breakeven"
          value={s2.state.mode}
          onChange={(v) => s2.set({ mode: v })}
          options={[
            { value: 'full', label: 'New projects: full cycle' },
            { value: 'half', label: 'Already built: half cycle' },
          ]}
        />
        <SupplyCurve mode={s2.state.mode} price={s2.state.price} />
        <Readouts
          items={[
            { label: s2.state.mode === 'full' ? 'oil that gets developed' : 'oil that keeps flowing', value: `${fmt(cleared)} million bbl`, tone: 'orange' },
            { label: 'projects', value: `${clearedCount} of ${PROJECTS.length}` },
          ]}
        />
        <Slider
          label="Oil price (benchmark)"
          tone="green"
          value={s2.state.price}
          min={10}
          max={100}
          step={PRICE_STEP}
          onChange={(v) => s2.set({ price: v })}
          display={`${price$(s2.state.price)} per barrel`}
        />
      </Figure>

      <P>
        At $50, only the waterflood and the Seaboard offshore expansion go ahead as new projects: {fmt(volumeCleared(50, 'full'))} million of the{' '}
        {fmt(TOTAL_VOLUME)} million barrels on offer. Switch to half cycle and everything already built keeps running at $50, and would keep running down to about{' '}
        {usd(Math.round(MAX_HALF_CYCLE))}, the running cost of the steam project.
        The offshore and steam projects also take years to build, so they answer a price change slowly in both directions; Ridgeback’s wells answer within months.
      </P>

      <Challenge
        id="b"
        question="Find the lowest price, to the nearest 50 cents, at which every project in the world goes ahead as a new development."
        solved={solvedB}
        status={
          s2.state.mode !== 'full'
            ? 'Switch to full-cycle breakevens: the question is about starting new projects.'
            : `At ${price$(s2.state.price)}, ${clearedCount} of ${PROJECTS.length} projects go ahead.`
        }
        success={`Solved: ${price$(s2.state.price)}. The last block, Ridgeback’s fringe acreage, breaks even at ${usd(FRINGE.fullCycle, 2)}. To call forth its ${fmt(FRINGE.volume)} million barrels, the price has to cover the dearest barrel the market needs, not the average one.`}
      />

      <P>
        That answers the chapter’s question. Oil reaches the surface because pressure pushes it through rock toward a well, at a rate set by the rock’s permeability, the
        oil’s viscosity and how much rock the well touches; falling pressure and rising water end each well’s life. Production economics come down to how many barrels a
        dollar of capital brings up, how soon, and what they sell for after royalties, taxes and running costs. You can return to{' '}
        <FigRef to="Oil Field Planner">the first demonstration</FigRef> to test any program against any price.
      </P>
      <P>
        Our four crudes now leave their fields: Ridgeback Light and Northfield Sour from the basin, Coldwater Heavy from the north, Seaboard Blend by sea. None of them is
        any use as it is. Chapter 3 follows them into the Calder refinery, starting with <a href={lessonHref('oil/3.1')}>the distillation tower</a> that splits each barrel
        into its cuts.
      </P>
    </LessonPage>
  );
}
