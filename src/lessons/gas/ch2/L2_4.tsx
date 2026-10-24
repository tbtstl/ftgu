import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { fieldCash, fieldProduction, productionByVintage, ridgebackMonthly, sumBcf } from '../../../engines/gas/decline';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { OPEX_PER_MCF, PLANT_INLET_MMCFD, RIDGEBACK_WELLHEAD_PRICE, ROYALTY, WELL_COST } from '../../../model/gas/production';
import { XYChart } from '../shared/XYChart';
import { mmcfd, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The plan: wells brought online in each of five years, each producing the Ridgeback type well.

/** The type well: the Ridgeback well of Lesson 2.3, MMcf/d by month for 30 years. */
const TYPE = ridgebackMonthly(360);
/** What the field has promised the plant from the start of year 2 to the end of year 5, MMcf/d. */
export const TARGET = PLANT_INLET_MMCFD;
/** The promise covers months 13–60: indices 12 to 59. */
export const WINDOW_START = 12;
export const WINDOW_END = 60;
/** The challenge's capital budget, $. */
export const BUDGET = 950_000_000;
export const BUDGET_WELLS = Math.floor(BUDGET / WELL_COST);
/** Months the production chart shows, and the economics follow. */
const SHOW_MONTHS = 96;
const CASH_MONTHS = 420;
const DISCOUNT = 0.1;
const YEARS = [1, 2, 3, 4, 5] as const;
const MAX_WELLS = 80;

export const FIELD_DEFAULTS = { y1: 30, y2: 30, y3: 30, y4: 30, y5: 30, price: RIDGEBACK_WELLHEAD_PRICE, cost: WELL_COST };
type FieldState = typeof FIELD_DEFAULTS;
type YearKey = 'y1' | 'y2' | 'y3' | 'y4' | 'y5';

const yearsOf = (s: Pick<FieldState, YearKey>) => [s.y1, s.y2, s.y3, s.y4, s.y5];

/** Wells online by month: each year's wells spread as evenly as whole wells allow over its twelve months. */
export function schedule(years: number[]): number[] {
  const out = Array<number>(years.length * 12).fill(0);
  years.forEach((n, y) => {
    for (let m = 0; m < 12; m++) out[y * 12 + m] = Math.floor(((m + 1) * n) / 12) - Math.floor((m * n) / 12);
  });
  return out;
}

/** How the plan does against the promise: its lowest rate in years 2–5 (and when), and the months below target. */
export function promise(years: number[]) {
  const p = fieldProduction(schedule(years), TYPE, WINDOW_END);
  let low = Infinity;
  let lowMonth = WINDOW_START;
  let short = 0;
  for (let m = WINDOW_START; m < WINDOW_END; m++) {
    if (p[m] < low) {
      low = p[m];
      lowMonth = m;
    }
    if (p[m] < TARGET - 1e-9) short++;
  }
  return { low, lowMonth, short, holds: short === 0 };
}

/** The challenge: at least 400 MMcf/d in every month of years 2–5, with no more wells than $950 million buys at $9 million each. */
export function fieldSolved(s: Pick<FieldState, YearKey>): boolean {
  const ys = yearsOf(s);
  return ys.reduce((a, b) => a + b, 0) <= BUDGET_WELLS && promise(ys).holds;
}

/** The price per MMBtu at which a plan's net present value is zero. NPV is a straight line in the price. */
export function breakevenPrice(years: number[], cost: number): number {
  const sched = schedule(years);
  const prod = fieldProduction(sched, TYPE, CASH_MONTHS);
  const at = (p: number) => fieldCash(sched, prod, econ(p, cost)).npv;
  const a = at(0);
  const b = at(1);
  return b > a ? -a / (b - a) : Infinity;
}

function econ(price: number, cost: number) {
  return { wellheadPrice: price, royalty: ROYALTY, opexPerMcf: OPEX_PER_MCF, wellCost: cost, discount: DISCOUNT, mmbtuPerMcf: MMBTU_PER_MCF };
}

/** Months until cumulative cash turns positive for good (1 = the first month), or null if it never does. */
function paybackMonths(payoutIndex: number | null): number | null {
  return payoutIndex === null ? null : payoutIndex + 1;
}

// Numbers the prose quotes.
const ONE = fieldCash([1], TYPE, econ(RIDGEBACK_WELLHEAD_PRICE, WELL_COST));
const ONE_FIRST_YEAR = ONE.cumulative[11] + WELL_COST;
const NET_PER_MCF = RIDGEBACK_WELLHEAD_PRICE * MMBTU_PER_MCF * (1 - ROYALTY) - OPEX_PER_MCF;
const TYPE_EUR = sumBcf(TYPE);
const FIRST_YEAR_SHARE = sumBcf(TYPE.slice(0, 12)) / TYPE_EUR;
/** The rate a field adding N wells a year eventually settles at is N × one well's 30-year output ÷ 365.25 days. */
const PER_WELL_A_YEAR = (TYPE_EUR * 1000) / 365.25;
const LONG_RUN_WELLS = TARGET / PER_WELL_A_YEAR;

const DEF_YEARS = yearsOf(FIELD_DEFAULTS);
const DEF_SCHED = schedule(DEF_YEARS);
const DEF_PROD = fieldProduction(DEF_SCHED, TYPE, SHOW_MONTHS);
const DEF_VINTAGE = productionByVintage(DEF_SCHED, TYPE, SHOW_MONTHS);
const DEF_PROMISE = promise(DEF_YEARS);
const DEF_CASH = fieldCash(DEF_SCHED, fieldProduction(DEF_SCHED, TYPE, CASH_MONTHS), econ(RIDGEBACK_WELLHEAD_PRICE, WELL_COST));
const BURST_YEARS = [100, 0, 0, 0, 0];
const BURST = fieldProduction(schedule(BURST_YEARS), TYPE, SHOW_MONTHS);
const LEAN_YEARS = [41, 24, 14, 13, 12];
const LEAN_CASH = fieldCash(schedule(LEAN_YEARS), fieldProduction(schedule(LEAN_YEARS), TYPE, CASH_MONTHS), econ(RIDGEBACK_WELLHEAD_PRICE, WELL_COST));
const DEF_BREAKEVEN = breakevenPrice(DEF_YEARS, WELL_COST);

const VINTAGE_COLOR = YEARS.map((_, i) => mix(GRAPHIC.orange, '#fcfcfb', 0.08 + i * 0.16));
const yearsFmt = (m: number) => `${fmt(m / 12)}`;
/** "$9 million", "$9.5 million". */
const millions = (x: number) => `$${fmt(x / 1e6, Math.round(x / 1e5) % 10 === 0 ? 0 : 1)} million`;

export default function Lesson() {
  const s = useScenario('field', FIELD_DEFAULTS);
  const st = s.state;
  const ys = yearsOf(st);
  const wells = ys.reduce((a, b) => a + b, 0);
  const planKey = ys.join(',');
  const sched = useMemo(() => schedule(planKey.split(',').map(Number)), [planKey]);
  const prod = useMemo(() => fieldProduction(sched, TYPE, SHOW_MONTHS), [sched]);
  const vintages = useMemo(() => productionByVintage(sched, TYPE, SHOW_MONTHS), [sched]);
  const pr = promise(ys);
  const peak = Math.max(...prod);
  const capital = wells * st.cost;
  const solved = fieldSolved(st);

  // Stacked bands, oldest wells at the bottom.
  const xs = prod.map((_, m) => m + 0.5);
  const stacks: Array<{ lows: number[]; highs: number[] }> = [];
  let base = Array<number>(SHOW_MONTHS).fill(0);
  vintages.forEach((v) => {
    const highs = base.map((b, m) => b + v[m]);
    stacks.push({ lows: base, highs });
    base = highs;
  });
  const [, yTop] = niceDomain(0, Math.max(TARGET * 1.25, peak), 4);

  const atEnd = prod[WINDOW_END - 1];
  const status = !pr.holds
    ? `The field falls short of ${fmt(TARGET)} MMcf/d in ${pr.short} of the 48 months of years 2–5; its lowest is ${fmt(pr.low)}.`
    : wells > BUDGET_WELLS
      ? `The field holds ${fmt(TARGET)} MMcf/d, but ${wells} wells cost ${money(wells * WELL_COST)} at $9 million each — more than $950 million.`
      : 'Solved.';
  const caption = !pr.holds
    ? `${wells} wells for ${money(capital)}. The field falls below ${fmt(TARGET)} MMcf/d in ${pr.short} of the 48 promised months, reaching a low of ${mmcfd(pr.low)} in month ${pr.lowMonth + 1}.`
    : `${wells} wells for ${money(capital)}. The field holds at least ${fmt(TARGET)} MMcf/d through years 2–5${peak > TARGET * 1.05 ? `, peaking at ${mmcfd(peak)}, ${fmt(peak - TARGET)} more than the plant can take` : ''}.`;

  // Figure 2: the plan's cash.
  const longProd = useMemo(() => fieldProduction(sched, TYPE, CASH_MONTHS), [sched]);
  const cash = useMemo(() => fieldCash(sched, longProd, econ(st.price, st.cost)), [sched, longProd, st.price, st.cost]);
  const breakeven = useMemo(() => breakevenPrice(planKey.split(',').map(Number), st.cost), [planKey, st.cost]);
  const payback = paybackMonths(cash.payoutMonth);
  const cumM = cash.cumulative.map((c) => c / 1e6);
  const cxs = cumM.map((_, m) => m + 1);
  const [c0, c1] = niceDomain(Math.min(-50, ...cumM), Math.max(50, ...cumM), 4);
  const lowIdx = cumM.indexOf(Math.min(...cumM));
  const netPerMcf = st.price * MMBTU_PER_MCF * (1 - ROYALTY) - OPEX_PER_MCF;

  return (
    <LessonPage id="gas/2.4">
      <P>
        <a href={lessonHref('gas/2.3')}>Lesson 2.3</a> followed a single Ridgeback well: {fmt(TYPE[0])} MMcf/d in its first two months, {fmt(TYPE[11], 1)} a year later,
        and a long tail that adds up to {fmt(TYPE_EUR, 1)} Bcf over thirty years, {pct(FIRST_YEAR_SHARE)} of it in the first year. But a company doesn’t sell one well’s
        gas. It sells a field’s, and it usually promises it in advance: so much a day to a processing plant, so much space on a pipeline, booked years ahead. The plant at
        Ridgeback that we’ll visit in <a href={lessonHref('gas/2.5')}>Lesson 2.5</a> takes {fmt(TARGET)} MMcf/d. How does a company keep that much{' '}
        <K tone="orange">flowing</K> when every well that feeds it is in steep decline?
      </P>
      <P>
        By drilling more of them. A field’s production is the sum of its wells’, each well’s curve starting in the month it comes online. Engineers plan with a{' '}
        <b>type well</b> — the curve they expect from an average new well, here the Ridgeback well of Lesson 2.3 — and a cost: {millions(WELL_COST)} to drill a horizontal
        well and fracture it, an illustrative figure.
      </P>
      <P>
        In the next demonstration, you plan five years of drilling on one company’s acreage in the Ridgeback shale. Choose how many wells to bring online in each year. Each
        year’s wells come on evenly through it, and the chart stacks their production by the year they started, oldest at the bottom. The dashed line is the plant’s{' '}
        {fmt(TARGET)} MMcf/d, and the shaded stretch, years 2 through 5, is when the company has promised to fill it:
      </P>

      <Figure name="Gas Field Builder" scenario={s}>
        <XYChart
          xDomain={[0, SHOW_MONTHS]}
          yDomain={[0, yTop]}
          xTicks={[0, 12, 24, 36, 48, 60, 72, 84, 96]}
          yTicks={niceTicks(0, yTop, 4)}
          xFormat={yearsFmt}
          yFormat={(v) => fmt(v)}
          yLabel="Field production, MMcf/d"
          xLabel="years since the first well"
          height={260}
          bands={[{ from: WINDOW_START, to: WINDOW_END, color: 'rgba(63, 122, 30, 0.07)', label: 'promised: years 2–5' }]}
          series={[
            ...stacks.map((b, i) => ({ xs, ys: b.highs, lows: b.lows, kind: 'band' as const, color: VINTAGE_COLOR[i], opacity: 1 })),
            { xs, ys: prod, color: TEXT.orange, width: 2 },
          ]}
          hLines={[{ at: TARGET, color: '#333', dash: '6 4', label: `plant inlet, ${fmt(TARGET)} MMcf/d` }]}
          vLines={[{ at: WINDOW_END, color: '#9a9a9a', dash: '3 4', width: 1, label: 'last wells', labelAt: 'end' }]}
          markers={
            pr.holds
              ? []
              : [{ x: pr.lowMonth + 0.5, y: pr.low, color: GRAPHIC.red, ring: true, r: 6, label: `low: ${fmt(pr.low)}`, labelPos: 'above' }]
          }
          ariaLabel={`Field production over eight years from ${wells} wells drilled ${ys.join(', ')} in years 1 to 5, stacked by year. In years 2 to 5 the lowest rate is ${fmt(pr.low)} MMcf/d against the ${fmt(TARGET)} promised; the peak is ${fmt(peak)}. At the end of year 5 the field makes ${fmt(atEnd)} MMcf/d.`}
        />
        <Legend items={YEARS.map((y, i) => ({ label: `Year ${y} wells`, color: VINTAGE_COLOR[i] }))} />
        <Readouts
          items={[
            { label: 'wells drilled', value: fmt(wells) },
            { label: 'capital', value: money(capital), tone: 'green' },
            { label: 'lowest in years 2–5', value: mmcfd(pr.low), tone: pr.holds ? 'orange' : 'red' },
            { label: 'peak', value: mmcfd(peak), tone: 'orange' },
          ]}
        />
        {YEARS.map((y) => {
          const key = `y${y}` as YearKey;
          return (
            <Slider
              key={key}
              label={`Wells in year ${y}`}
              value={st[key]}
              min={0}
              max={MAX_WELLS}
              onChange={(v) => s.set({ [key]: v } as Partial<FieldState>)}
              display={`${st[key]} well${st[key] === 1 ? '' : 's'}`}
            />
          );
        })}
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The starting plan, {DEF_YEARS[0]} wells a year, gets the timing wrong twice. It’s too slow: at the end of year 1 the field makes only {fmt(DEF_PROD[11])} MMcf/d,
        and it stays short for the first {DEF_PROMISE.short} months of the promise, bottoming at {fmt(DEF_PROMISE.low)}. Then it overshoots: by the end of year 5 it makes{' '}
        {fmt(DEF_PROD[59])} MMcf/d, far more than the plant can take, after {money(DEF_YEARS.reduce((a, b) => a + b, 0) * WELL_COST)} of drilling.
      </P>
      <P>
        Watch what each year’s band does. It swells while its wells come online, then thins as they decline: by the end of year 5, the {DEF_YEARS[0]} wells of year 1
        make {fmt(DEF_VINTAGE[0][59])} MMcf/d between them, about {fmt(DEF_VINTAGE[0][59] / DEF_YEARS[0], 1)} each, while the {DEF_YEARS[4]} newest make{' '}
        {fmt(DEF_VINTAGE[4][59])}. In a shale field, the newest wells always carry a large share of the load.
      </P>

      <H2>The treadmill</H2>
      <P>
        Try putting all the drilling into the first year: {BURST_YEARS[0]} wells, then none. The field peaks at {fmt(Math.max(...BURST))} MMcf/d at the end of year 1, is
        down to {fmt(BURST[23])} a year later and {fmt(BURST[59])} by the end of year 5. A shale field left alone shrinks fast, so to stand still a producer must keep
        drilling. The industry calls it the treadmill.
      </P>
      <P>
        Early on the treadmill runs fast, because the field has to be built up from nothing. Later it slows: old wells never quite stop, and their tails pile up
        underneath the new ones. A field that adds N wells every year eventually settles at N times one well’s whole thirty-year output spread over a year — each new
        well is worth {fmt(PER_WELL_A_YEAR, 1)} MMcf/d of steady production in the long run — so holding {fmt(TARGET)} MMcf/d forever takes about{' '}
        {fmt(LONG_RUN_WELLS)} wells a year, once the field is decades old. In its first years, it takes several times that.
      </P>
      <P>
        Stop drilling and the treadmill shows its other side. With the starting plan, production falls {pct(1 - DEF_PROD[71] / DEF_PROD[59])} in the year after the last
        wells come on. That is why shale-gas production responds to drilling within months. And drilling responds to price, which is where this lesson ends.
      </P>

      <Challenge
        id="a"
        figure="Gas Field Builder"
        question={`Keep the field at or above ${fmt(TARGET)} MMcf/d in every month of years 2 through 5 while spending no more than $950 million — ${BUDGET_WELLS} wells at $9 million each.`}
        solved={solved}
        status={status}
        success={`Solved, with ${wells} wells: ${ys.join(', ')} in years 1 to 5. The fewest that can do it is 104, and every plan within the budget has the same shape: between 41 and 48 wells in the first year, to build the field up to ${fmt(TARGET)} MMcf/d by month 13, then far fewer each year after, as the tails of earlier wells carry more of the load.`}
      />

      <H2>Paying for it</H2>
      <P>
        Every well costs money long before it earns any. The producer receives a <K c="price">wellhead price</K> — a simulated {usd(RIDGEBACK_WELLHEAD_PRICE, 2)} per MMBtu,
        Calder Hub’s typical $3.00 less the cost of getting the gas there — pays {pct(ROYALTY)} of its revenue to the owners of the minerals as a royalty, and spends{' '}
        {usd(OPEX_PER_MCF, 2)} per Mcf lifting, gathering and processing the gas. We’ll value every Mcf as pipeline gas, at {MMBTU_PER_MCF} MMBtu, and leave the liquids that
        processing recovers to Lesson 2.5. That leaves, per Mcf,
      </P>
      <Eq
        label={`Net cash per Mcf equals ${usd(RIDGEBACK_WELLHEAD_PRICE, 2)} times ${MMBTU_PER_MCF} times (1 minus ${pct(ROYALTY)}) minus ${usd(OPEX_PER_MCF, 2)}, which is ${usd(NET_PER_MCF, 2)}`}
      >
        <K c="price">{usd(RIDGEBACK_WELLHEAD_PRICE, 2)}</K>
        <Op>×</Op>
        <span>{MMBTU_PER_MCF}</span>
        <Op>×</Op>
        <span>(1 − {pct(ROYALTY)})</span>
        <Op>−</Op>
        <span>{usd(OPEX_PER_MCF, 2)}</span>
        <Op>=</Op>
        <K c="price">{usd(NET_PER_MCF, 2)}</K>
      </Eq>
      <P>
        A single well returns {money(ONE_FIRST_YEAR)} in its first year, two-thirds of its {millions(WELL_COST)} cost, and has paid for itself after{' '}
        {paybackMonths(ONE.payoutMonth)} months. Money that arrives later is worth less than money now, so companies discount it: a dollar t years away counts as 1 ÷
        (1 + r)<Sup>t</Sup> today. At the industry’s customary rate of r = {pct(DISCOUNT)}, the sum of the well’s discounted cash flows, its{' '}
        <b>net present value</b>, is {money(ONE.npv)}:
      </P>
      <Eq label="Net present value equals the sum over months of each month's cash divided by 1.1 to the power of its time in years">
        <span>NPV</span>
        <Op>=</Op>
        <span>Σ</span>
        <span>
          cash<Sub>t</Sub> ÷ (1 + {pct(DISCOUNT)})<Sup>t</Sup>
        </span>
      </Eq>
      <P>
        In the next demonstration, the line is the cumulative cash of the plan you set in <FigRef to="Gas Field Builder">the first demonstration</FigRef>, over 35 years:
        negative while the rigs run, positive once the gas has paid for them. Change the wellhead price and the cost of a well:
      </P>

      <Figure name="Gas Field Builder · economics" scenario={s}>
        <XYChart
          xDomain={[0, CASH_MONTHS]}
          yDomain={[c0, c1]}
          xTicks={[0, 60, 120, 180, 240, 300, 360, 420]}
          yTicks={niceTicks(c0, c1, 4)}
          xFormat={yearsFmt}
          yFormat={(v) => (v < 0 ? '−' : '') + '$' + fmt(Math.abs(v))}
          yLabel="Cumulative cash, $ million"
          xLabel="years since the first well"
          height={240}
          series={[
            { xs: cxs, ys: cumM.map((v) => Math.max(0, v)), lows: cxs.map(() => 0), kind: 'band', color: GRAPHIC.green, opacity: 0.2 },
            { xs: cxs, ys: cumM.map((v) => Math.min(0, v)), lows: cxs.map(() => 0), kind: 'band', color: GRAPHIC.red, opacity: 0.2 },
            { xs: cxs, ys: cumM, color: '#333', width: 2.5 },
          ]}
          markers={[
            { x: lowIdx + 1, y: cumM[lowIdx], color: GRAPHIC.red },
            ...(payback !== null && payback < CASH_MONTHS ? [{ x: payback, y: 0, color: TEXT.green, ring: true }] : []),
          ]}
          ariaLabel={`Cumulative cash of ${wells} wells at a wellhead price of ${usd(st.price, 2)} per MMBtu and ${millions(st.cost)} a well: at most ${money(-cash.maxExposure)} tied up, ${
            payback === null ? 'never paid back' : `paid back after ${payback} months`
          }, ${money(cash.cumulative[CASH_MONTHS - 1])} after 35 years. Net present value ${money(cash.npv)}.`}
        />
        <Legend
          items={[
            { label: 'Cumulative cash', color: '#333', kind: 'line' },
            { label: 'Most money tied up', color: GRAPHIC.red },
            { label: 'Paid back', color: TEXT.green },
          ]}
        />
        <Readouts
          items={[
            { label: 'capital', value: money(cash.capex), tone: 'green' },
            { label: `net present value at ${pct(DISCOUNT)}`, value: money(cash.npv), tone: cash.npv < 0 ? 'red' : 'green' },
            { label: 'most money tied up', value: money(-cash.maxExposure), tone: 'red' },
            { label: 'paid back after', value: payback === null ? 'never' : `${fmt(payback / 12, 1)} years` },
            { label: 'breakeven price', value: Number.isFinite(breakeven) ? `${usd(breakeven, 2)}/MMBtu` : '—', tone: 'green' },
          ]}
        />
        <Slider
          label="Wellhead price"
          tone="green"
          value={st.price}
          min={1}
          max={5}
          step={0.05}
          onChange={(v) => s.set({ price: v })}
          display={`${usd(st.price, 2)}/MMBtu · ${usd(netPerMcf, 2)} net per Mcf`}
        />
        <Slider label="Cost of a well" value={st.cost} min={5_000_000} max={14_000_000} step={500_000} onChange={(v) => s.set({ cost: v })} display={millions(st.cost)} />
      </Figure>

      <P>
        The starting plan ties up as much as {money(-DEF_CASH.maxExposure)} before its gas catches up with its drilling, is paid back after{' '}
        {fmt((paybackMonths(DEF_CASH.payoutMonth) ?? 0) / 12, 1)} years, and has a net present value of {money(DEF_CASH.npv)} at {usd(RIDGEBACK_WELLHEAD_PRICE, 2)}. A lean
        plan that just meets the promise — {LEAN_YEARS.join(', ')} wells — spends {money(LEAN_CASH.capex)}, ties up {money(-LEAN_CASH.maxExposure)}, because its drilling
        is crowded into the first year, and is worth {money(LEAN_CASH.npv)}: less, because it sells less gas, but on far less capital.
      </P>
      <P>
        Now lower the price. The net present value falls in a straight line, and at {usd(DEF_BREAKEVEN, 2)} per MMBtu it reaches zero. Below that{' '}
        <b>breakeven price</b>, drilling destroys value; above it, every well adds some. The breakeven is the same for every plan, since each well is the same bet made at
        a different time, and it moves with the cost of a well: cheaper wells, or better ones, lower it. Breakeven prices are why low prices cut supply. When the wellhead
        price falls below them, producers lay down rigs; months later fewer wells come online, and the treadmill turns that into falling production within a year.
      </P>
      <P>
        One thing every plan here takes for granted is that the gas is ready to sell. It isn’t. Gas from Ridgeback comes out of the ground wet and rich in ethane, propane
        and butane, and Lesson 1.1 showed that no pipeline will take it that way. The <a href={lessonHref('gas/2.5')}>next lesson</a> follows it through the processing
        plant that turns it into pipeline gas and liquids.
      </P>
    </LessonPage>
  );
}
