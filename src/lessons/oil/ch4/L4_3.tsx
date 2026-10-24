import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, GRAPHIC, H2, K, Legend, LessonPage, P, Readouts, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { DEFAULT_STORAGE, expectedBuffer, monthlyCarry, planStorage, priceStrip, simulateBuffer, type StorageParams } from '../../../engines/oil/storage';
import { marginPerBarrel, planRefinery } from '../../../engines/oil/refinery';
import { CALDER } from '../../../model/oil/refinery';
import { VESSELS } from '../../../model/oil/logistics';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// Figure 1: cash and carry at the Kessler terminal.

/** Today's price at the start of the forward strip, $/bbl (simulated). */
export const STRIP_START = 75;
export const RATE_STEP = 0.5;
/** The first challenge's price rise, $/bbl per month. */
export const CHALLENGE_SLOPE = 1.0;

export interface TerminalState {
  /** Monthly price rise along the forward strip, $/bbl. */
  slope: number;
  /** Seasonal swing, $/bbl. */
  seasonal: number;
  /** Storage fee, $/bbl per month. */
  fee: number;
  /** Financing rate, % per year. */
  rate: number;
  /** Month shown in the tank farm, 1–12. */
  month: number;
}

export const TERMINAL_DEFAULTS: TerminalState = { slope: 0.6, seasonal: 0, fee: DEFAULT_STORAGE.fee, rate: DEFAULT_STORAGE.rate * 100, month: 4 };

function paramsOf(st: Pick<TerminalState, 'fee' | 'rate'>): StorageParams {
  return { ...DEFAULT_STORAGE, fee: st.fee, rate: st.rate / 100 };
}

export function terminalPlan(st: Pick<TerminalState, 'slope' | 'seasonal' | 'fee' | 'rate'>) {
  return planStorage(priceStrip(STRIP_START, st.slope, st.seasonal), paramsOf(st));
}

/**
 * Challenge a: with prices rising $1.00 a month (no seasonal swing, the standard fee), the highest
 * financing rate on the slider's 0.5% steps at which filling the tanks still earns something.
 */
export function highestRateSolved(st: Pick<TerminalState, 'slope' | 'seasonal' | 'fee' | 'rate'>): boolean {
  if (Math.abs(st.slope - CHALLENGE_SLOPE) > 1e-9 || st.seasonal !== 0 || Math.abs(st.fee - DEFAULT_STORAGE.fee) > 1e-9) return false;
  const earns = (rate: number) => terminalPlan({ ...st, rate }).profit > 1000;
  return earns(st.rate) && !earns(st.rate + RATE_STEP);
}

// ---------------------------------------------------------------------------
// Figure 2: the refinery's buffer stock.

/** Calder's crude runs, b/d, delivered by cargoes of one week's runs. */
export const RUNS = CALDER.capacity.cdu * 1000;
export const BUFFER_PARAMS = { runs: RUNS, cargo: RUNS * 7, interval: 7, maxDelay: 4, storms: 3 };
export const BUFFER_STEP = 150000;
export const BUFFER_MAX = 2400000;
/** Seed of the one year drawn in the figure (the first of the 40 averaged). */
export const SHOWN_SEED = 7919;
/** A barrel of runs lost costs the refinery its margin, $/bbl (Lesson 3.5). */
export const LOST_MARGIN = Math.round(marginPerBarrel(planRefinery()));
/** Carrying a barrel of stock for a year: twelve months' storage fee plus interest at $75, $/bbl. */
export const HOLD_PER_YEAR = DEFAULT_STORAGE.fee * 12 + DEFAULT_STORAGE.rate * STRIP_START;

export interface BufferPoint {
  buffer: number;
  /** Expected runs lost per year, bbl. */
  shortfall: number;
  lostCost: number;
  holdCost: number;
  total: number;
  /** Value of one more barrel of buffer, $/bbl per year: the lost margin it would avoid. */
  marginalValue: number;
}

let curve: BufferPoint[] | null = null;
/** Expected yearly costs at every buffer on the slider (40 simulated years each), computed once. */
export function bufferCurve(): BufferPoint[] {
  if (!curve) {
    const levels = Array.from({ length: BUFFER_MAX / BUFFER_STEP + 1 }, (_, i) => i * BUFFER_STEP);
    const short = levels.map((b) => expectedBuffer({ ...BUFFER_PARAMS, buffer: b }).shortfall);
    curve = levels.map((b, i) => ({
      buffer: b,
      shortfall: short[i],
      lostCost: short[i] * LOST_MARGIN,
      holdCost: b * HOLD_PER_YEAR,
      total: short[i] * LOST_MARGIN + b * HOLD_PER_YEAR,
      marginalValue: i < levels.length - 1 ? ((short[i] - short[i + 1]) * LOST_MARGIN) / BUFFER_STEP : 0,
    }));
  }
  return curve;
}

/** The buffer with the lowest expected total yearly cost. */
export function bestBuffer(): BufferPoint {
  return bufferCurve().reduce((a, p) => (p.total < a.total ? p : a));
}

/** Challenge b: the safety stock that minimizes the refinery's expected yearly cost. */
export function bufferSolved(buffer: number): boolean {
  return Math.abs(buffer - bestBuffer().buffer) < 1;
}

function pointAt(buffer: number): BufferPoint {
  const c = bufferCurve();
  return c[Math.max(0, Math.min(c.length - 1, Math.round(buffer / BUFFER_STEP)))];
}

// ---------------------------------------------------------------------------

function mbbl(b: number, digits = 1): string {
  return `${fmt(b / 1e6, digits)} million bbl`;
}

function millions(x: number): string {
  return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, 2)} million`;
}

/** Barrels as "772,500". */
function barrels(b: number): string {
  return fmt(Math.round(b / 100) * 100);
}

const ORANGE = GRAPHIC.orange;
const TANKS = 8;

/** A row of tanks showing how full the terminal is in one month, each with its unusable heel and headroom. */
function TankFarm({ inventory, capacity, month }: { inventory: number; capacity: number; month: number }) {
  const per = capacity / TANKS;
  const W = 640;
  const H = 150;
  const tw = 58;
  const gap = (W - 40 - TANKS * tw) / (TANKS - 1);
  const top = 30;
  const shell = 92;
  const heel = 10;
  const headroom = 8;
  const working = shell - heel - headroom;
  let left = inventory;
  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`The terminal’s eight tanks at the end of month ${month}: ${mbbl(inventory)} stored of ${mbbl(capacity, 0)} of working capacity.`}
    >
      <text className="ax" x={20} y={16}>
        Kessler terminal, end of month {month} · {mbbl(inventory)} of {mbbl(capacity, 0)} working capacity
      </text>
      {Array.from({ length: TANKS }, (_, i) => {
        const x = 20 + i * (tw + gap);
        const fill = Math.max(0, Math.min(1, left / per));
        left -= per;
        const h = working * fill;
        return (
          <g key={i}>
            <rect x={x} y={top} width={tw} height={shell} rx={4} fill="#f4f2ec" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={x + 1.5} y={top + shell - heel} width={tw - 3} height={heel - 1.5} fill="#cdbfa7" />
            {h > 0 && <rect x={x + 1.5} y={top + shell - heel - h} width={tw - 3} height={h} fill={ORANGE} opacity={0.75} />}
            <line x1={x} x2={x + tw} y1={top + headroom} y2={top + headroom} stroke="#b9b9b9" strokeDasharray="3 3" />
            <rect x={x + 4} y={top + shell - heel - h - 3} width={tw - 8} height={3} fill="#666" opacity={0.7} />
          </g>
        );
      })}
      <text className="ax" x={20} y={top + shell + 18}>
        gray band: the heel no pump can reach · dashed line: the highest safe fill · dark bar: the floating roof
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario<TerminalState>('terminal', TERMINAL_DEFAULTS);
  const st = s1.state;
  const prices = useMemo(() => priceStrip(STRIP_START, st.slope, st.seasonal), [st.slope, st.seasonal]);
  const { slope, seasonal, fee, rate } = st;
  const plan = useMemo(() => terminalPlan({ slope, seasonal, fee, rate }), [slope, seasonal, fee, rate]);
  const carry = monthlyCarry(STRIP_START, paramsOf(st));
  const peak = Math.max(...plan.inventory);
  const month = Math.max(1, Math.min(12, Math.round(st.month)));
  const solvedA = highestRateSolved(st);
  const [p0, p1] = [Math.min(...prices), Math.max(...prices)];
  const pLo = Math.floor((p0 - 1) / 2) * 2;
  const pHi = Math.ceil((p1 + 1) / 2) * 2;

  // Reference runs quoted in the prose.
  const ref = useMemo(() => {
    const at = (slope: number, seasonal = 0, rate = 6) => terminalPlan({ slope, seasonal, fee: DEFAULT_STORAGE.fee, rate });
    return { s080: at(0.8), s085: at(0.85), s100: at(1.0), seas1: at(0, 1), seas2: at(0, 2), seas3: at(0, 3), r85: at(1.0, 0, 8.5) };
  }, []);

  const s2 = useScenario('buffer', { buffer: 0 });
  const buffer = s2.state.buffer;
  const year = useMemo(() => simulateBuffer({ ...BUFFER_PARAMS, buffer, seed: SHOWN_SEED }), [buffer]);
  const pts = bufferCurve();
  const here = pointAt(buffer);
  const best = bestBuffer();
  const zero = pts[0];
  const noShort = pts.find((p) => p.shortfall === 0)!;
  const solvedB = bufferSolved(buffer);
  const stockMax = Math.max(2, Math.ceil(Math.max(...year.stock) / 1e6));

  return (
    <LessonPage id="oil/4.3">
      <P>
        <a href={lessonHref('oil/4.2')}>The previous lesson</a> loaded oil onto tankers, and tankers deliver it in lumps: an Aframax carries{' '}
        {fmt(VESSELS.aframax.cargo / 1000)},000 barrels, a VLCC {fmt(VESSELS.vlcc.cargo / 1e6)} million, and each arrives when its voyage ends, give or take the weather.
        Pipelines move oil in batches too, one crude after another, on schedules set weeks ahead. A refinery, though, wants the same {fmt(RUNS / 1000)},000 barrels
        every day, and its customers want products every day. Something has to stand between lumpy supply and steady demand. That something is a tank.
      </P>
      <P>
        Tanks are everywhere oil stops: at the fields, at hubs like Kessler, where tank farms collect the basin’s crude before it moves on, at refineries for crude
        and for each product, and at export terminals. A tank never holds all it could. Its pumps can’t draw out the last few feet, the <b>heel</b>, and it can’t
        safely be filled to the brim, so the <b>working capacity</b> a trader can use is less than the tank’s <b>shell capacity</b>. Many crude tanks have a roof
        that floats on the oil and rises and falls with it, which keeps vapor from escaping. In our model, Kessler’s terminal offers{' '}
        {mbbl(DEFAULT_STORAGE.capacity, 0)} of working capacity.
      </P>
      <P>
        There are two reasons to fill those tanks. One is to keep things running, which we’ll come to. The other is to make money from time. Suppose buyers will
        agree today on prices for oil delivered in each of the next twelve months — <b>forward prices</b>. (Where those prices come from is the subject of{' '}
        <a href={lessonHref('oil/5.4')}>Lesson 5.4</a>.) If oil for delivery in a year sells for more than oil today, a terminal can buy now, store, and sell
        forward, locking in the difference. This is called <b>cash and carry</b>. What it costs is the <K c="price">carry</K>: the storage fee, plus the interest on
        the money tied up in the oil. At {usd(STRIP_START)} a barrel, a {usd(DEFAULT_STORAGE.fee, 2)} monthly fee and {fmt(DEFAULT_STORAGE.rate * 100)}% interest, that
        comes to {usd(monthlyCarry(STRIP_START), 3)} a barrel a month, plus {usd(DEFAULT_STORAGE.handling, 2)} to pump each barrel in and again to pump it out.
      </P>
      <P>
        In the next demonstration, a linear program plans a year at the terminal: how much to buy, hold and sell each month against the forward prices, within its
        working capacity and the {mbbl(DEFAULT_STORAGE.throughput, 0)} it can pump in or out in a month. The prices are simulated. Set how fast they rise from month to
        month, add a seasonal swing, and change the costs of carrying; click the inventory chart to see any month in the tanks:
      </P>

      <Figure name="Oil Storage Terminal" scenario={s1}>
        <TankFarm inventory={plan.inventory[month - 1]} capacity={DEFAULT_STORAGE.capacity} month={month} />
        <Legend
          items={[
            { label: 'Forward price', color: GRAPHIC.green, kind: 'line' },
            { label: 'Buy', color: GRAPHIC.green },
            { label: 'Sell (hollow)', color: '#9a9a9a' },
            { label: 'Oil in the tanks', color: ORANGE },
          ]}
        />
        <XYChart
          ariaLabel={`Forward prices for months 1 to 12, from ${usd(prices[0], 2)} to ${usd(prices[11], 2)}. The plan buys in ${plan.buy.filter((b) => b > 1000).length} months and sells in ${plan.sell.filter((b) => b > 1000).length}.`}
          height={170}
          x={[0.5, 12.5]}
          y={[pLo, pHi]}
          xTicks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Forward price, $ per barrel"
          series={[{ points: prices.map((p, i) => [i + 1, p] as [number, number]), color: GRAPHIC.green, width: 2.5 }]}
          markers={[
            ...plan.buy.flatMap((b, i) => (b > 1000 ? [{ x: i + 1, y: prices[i], color: GRAPHIC.green, r: 6 }] : [])),
            ...plan.sell.flatMap((s, i) => (s > 1000 ? [{ x: i + 1, y: prices[i], color: '#777', r: 6, hollow: true }] : [])),
          ]}
          refs={[{ axis: 'x', at: month, cursor: true }]}
        />
        <XYChart
          ariaLabel={`Oil in the terminal at the end of each month, in million barrels: ${plan.inventory.map((v) => fmt(v / 1e6, 1)).join(', ')}. Month ${month} is selected.`}
          height={150}
          x={[0.5, 12.5]}
          y={[0, 20]}
          xTicks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
          yTicks={[0, 10, 20]}
          xLabel="months from now"
          yLabel="Oil stored, million barrels"
          refs={[{ axis: 'x', at: month, cursor: true }]}
          onScrub={(v) => s1.set({ month: Math.max(1, Math.min(12, Math.round(v))) })}
          scrubValue={month}
          scrubStep={1}
          scrubLabel="Month shown in the tanks"
        >
          {(sx, sy) => (
            <g>
              {plan.inventory.map((v, i) => (
                <rect key={i} x={sx(i + 0.65)} y={sy(v / 1e6)} width={sx(1.35) - sx(0.65)} height={Math.max(0, sy(0) - sy(v / 1e6))} fill={ORANGE} opacity={i + 1 === month ? 0.9 : 0.55} />
              ))}
            </g>
          )}
        </XYChart>
        <Readouts
          items={[
            { label: <K c="price">carry per barrel per month at $75</K>, value: usd(carry, 3), tone: 'green' },
            { label: <K c="price">profit over the year</K>, value: millions(plan.profit), tone: 'green' },
            { label: <K tone="orange">most oil stored</K>, value: mbbl(peak), tone: 'orange' },
          ]}
        />
        <Slider label="Price rise per month" tone="green" value={st.slope} min={-0.5} max={2} step={0.05} onChange={(v) => s1.set({ slope: Math.round(v * 100) / 100 })} display={`${st.slope < 0 ? '−' : ''}${usd(Math.abs(st.slope), 2)}`} />
        <Slider label="Seasonal swing" tone="green" value={st.seasonal} min={0} max={5} step={0.5} onChange={(v) => s1.set({ seasonal: v })} display={`±${usd(st.seasonal, 2)}`} />
        <Slider label="Storage fee per month" tone="green" value={st.fee} min={0.1} max={1} step={0.05} onChange={(v) => s1.set({ fee: Math.round(v * 100) / 100 })} display={usd(st.fee, 2)} />
        <Slider label="Financing rate" tone="green" value={st.rate} min={0} max={15} step={RATE_STEP} onChange={(v) => s1.set({ rate: v })} display={`${fmt(st.rate, 1)}% a year`} />
        <Caption>
          {peak < 1000
            ? `The prices don’t rise fast enough to pay for carrying oil, so the terminal stores nothing.`
            : `The terminal buys in ${plan.buy.filter((b) => b > 1000).length} months, holds up to ${mbbl(peak)}, and sells in ${plan.sell.filter((b) => b > 1000).length}: storage fees of ${millions(plan.fees)}, interest of ${millions(plan.financing)} and handling of ${millions(plan.handlingCost)}.`}
        </Caption>
      </Figure>

      <P>
        At a rise of 60 cents a month the plan stores nothing, and it still stores nothing at 80 cents: each month’s rise is about the {usd(monthlyCarry(STRIP_START), 3)}{' '}
        it costs to hold the barrel, and the handling eats the rest. Somewhere between 80 and 85 cents the answer flips completely. At 85 cents the terminal fills
        all {mbbl(DEFAULT_STORAGE.capacity, 0)} and earns {millions(ref.s085.profit)}; at {usd(1, 2)} it earns {millions(ref.s100.profit)}. The tanks fill over the first
        three months, as fast as the pumps allow, sit full, and empty over the last three. Storage is all or nothing because every barrel faces the same arithmetic:
        if one barrel pays to carry, they all do, until the tanks are full.
      </P>
      <P>
        The same logic works with a seasonal swing instead of a steady rise. With flat prices but a swing of {usd(3)} — dearer in the middle of the year, cheaper at
        the ends — the plan buys in the first months, holds, sells as prices peak, and earns {millions(ref.seas3.profit)}. A {usd(2)} swing earns only{' '}
        {millions(ref.seas2.profit)}, and a {usd(1)} swing nothing. Product terminals live on patterns like this: gasoline stored through the winter for the summer
        driving season, heating oil stored through the summer for the winter.
      </P>

      <Challenge
        id="a"
        question={`Set prices to rise ${usd(CHALLENGE_SLOPE, 2)} a month, with no seasonal swing and the standard ${usd(DEFAULT_STORAGE.fee, 2)} fee. What is the highest financing rate, to the nearest half percent, at which filling the tanks still earns something?`}
        solved={solvedA}
        status={
          Math.abs(st.slope - CHALLENGE_SLOPE) > 1e-9 || st.seasonal !== 0 || Math.abs(st.fee - DEFAULT_STORAGE.fee) > 1e-9
            ? `Set the price rise to ${usd(CHALLENGE_SLOPE, 2)} a month, the swing to zero and the fee to ${usd(DEFAULT_STORAGE.fee, 2)}.`
            : `At ${fmt(st.rate, 1)}% a year, the year earns ${millions(plan.profit)}.`
        }
        success={`Solved: ${fmt(st.rate, 1)}%. At that rate, carrying a barrel costs ${usd(monthlyCarry(STRIP_START, paramsOf(st)), 3)} a month at $75, just under the dollar the price rises, and the year earns ${millions(plan.profit)}. Half a point more and the interest swallows the gain. Cash and carry is a bet on nothing but the spread between months, so it lives or dies on the cost of money.`}
      />

      <H2>Stock you can’t do without</H2>
      <P>
        The second reason to hold oil has nothing to do with forward prices. Suppose the Calder refinery received all its crude by sea, as it receives Seaboard Blend:
        cargoes of {barrels(BUFFER_PARAMS.cargo)} barrels, one week of runs, due every {BUFFER_PARAMS.interval} days. Ships are late. In our model each cargo can arrive
        up to {BUFFER_PARAMS.maxDelay} days behind schedule, and {BUFFER_PARAMS.storms} storms a year close the port for two to five days, holding every ship that’s due.
        If the crude tank runs dry, the refinery has to cut its runs, and every barrel it doesn’t run costs it the margin it would have earned — about {usd(LOST_MARGIN)}{' '}
        a barrel, from <a href={lessonHref('oil/3.5')}>Lesson 3.5</a>. So the refinery keeps a <b>safety stock</b> on top of the oil that comes and goes each week.
        Holding it costs the same carry as before: {usd(HOLD_PER_YEAR, 2)} per barrel per year.
      </P>
      <P>
        In the next demonstration, set the safety stock. The first chart is one simulated year of crude in the refinery’s tank; its caption counts the days the
        refinery had to cut runs. The second averages forty simulated years: what lost runs and the stock itself cost each year, for every size of safety stock:
      </P>

      <Figure name="Oil Storage Terminal · buffer" scenario={s2}>
        <XYChart
          ariaLabel={`One simulated year of the refinery’s crude tank with a safety stock of ${mbbl(buffer, 2)}: runs were cut on ${year.shortDays} days, losing ${barrels(year.shortfall)} barrels.`}
          height={170}
          x={[0, 365]}
          y={[0, stockMax]}
          xTicks={[0, 60, 120, 180, 240, 300, 360]}
          yTicks={Array.from({ length: stockMax + 1 }, (_, i) => i)}
          xLabel="day of the year"
          yLabel="Crude in the tank, million barrels"
          series={[{ points: year.stock.map((s, d) => [d, s / 1e6] as [number, number]), color: ORANGE, width: 1.5 }]}
          refs={buffer > 0 ? [{ axis: 'y', at: buffer / 1e6, color: '#777', label: 'safety stock' }] : []}
        />
        <Legend
          items={[
            { label: 'Lost runs', color: GRAPHIC.red, kind: 'line' },
            { label: 'Holding the stock', color: '#8a8a8a', kind: 'line' },
            { label: 'Total', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Expected yearly costs against the safety stock. At ${mbbl(buffer, 2)}: lost runs ${millions(here.lostCost)}, holding ${millions(here.holdCost)}, total ${millions(here.total)}. The total is lowest at ${mbbl(best.buffer, 2)}.`}
          height={190}
          x={[0, BUFFER_MAX / 1e6]}
          y={[0, 24]}
          xTicks={[0, 0.6, 1.2, 1.8, 2.4]}
          xFormat={(v) => fmt(v, 1)}
          yTicks={[0, 8, 16, 24]}
          yFormat={(v) => `$${v}M`}
          xLabel="safety stock, million barrels"
          yLabel="Expected cost per year"
          series={[
            { points: pts.map((p) => [p.buffer / 1e6, p.lostCost / 1e6] as [number, number]), color: GRAPHIC.red, width: 2 },
            { points: pts.map((p) => [p.buffer / 1e6, p.holdCost / 1e6] as [number, number]), color: '#8a8a8a', width: 2 },
            { points: pts.map((p) => [p.buffer / 1e6, p.total / 1e6] as [number, number]), color: GRAPHIC.green, width: 3 },
          ]}
          refs={[{ axis: 'x', at: buffer / 1e6, cursor: true }]}
          markers={[{ x: buffer / 1e6, y: here.total / 1e6, color: GRAPHIC.green, r: 6 }]}
        />
        <Readouts
          items={[
            { label: <K tone="orange">runs lost per year</K>, value: `${barrels(here.shortfall)} bbl`, tone: 'orange' },
            { label: <K c="price">expected total cost</K>, value: millions(here.total), tone: 'green' },
            { label: <K c="price">value of one more barrel of stock</K>, value: `${usd(here.marginalValue, 2)}/yr`, tone: 'green' },
          ]}
        />
        <Slider label="Safety stock" tone="orange" value={buffer} min={0} max={BUFFER_MAX} step={BUFFER_STEP} onChange={(v) => s2.set({ buffer: v })} display={mbbl(buffer, 2)} />
        <Caption>
          {year.shortDays === 0
            ? `In this simulated year the tank never ran dry.`
            : `In this simulated year the tank ran dry on ${year.shortDays} day${year.shortDays > 1 ? 's' : ''}, and the refinery cut ${barrels(year.shortfall)} barrels of runs.`}
        </Caption>
      </Figure>

      <P>
        With no safety stock, late ships and storms empty the tank often enough to cost the refinery, on average, {barrels(zero.shortfall)} barrels of runs a year:{' '}
        {millions(zero.lostCost)} of margin. Each {barrels(BUFFER_STEP)} barrels of safety stock costs {millions(BUFFER_STEP * HOLD_PER_YEAR)} a year to hold, and at
        first every one of those barrels saves a barrel of runs, worth {usd(LOST_MARGIN)} a year. That’s a good trade, so the total cost falls. But the first barrels
        of stock cover the common delays; the later ones only cover the rare pileups, when a storm strands two ships at once. Past{' '}
        {mbbl(best.buffer, 1)}, another barrel of stock saves only {usd(best.marginalValue, 2)} of margin a year, less than the {usd(HOLD_PER_YEAR, 2)} it costs to
        hold. By {mbbl(noShort.buffer, 1)} the refinery never runs short in any of the forty years, and every further barrel is pure cost.
      </P>

      <Challenge
        id="b"
        question="Find the safety stock that makes the refinery’s expected yearly cost — lost runs plus the cost of holding the stock — as small as it can be."
        solved={solvedB}
        status={`With ${mbbl(buffer, 2)} of safety stock, the expected cost is ${millions(here.total)} a year, and one more barrel of stock would save ${usd(here.marginalValue, 2)} a year.`}
        success={`Solved: ${mbbl(best.buffer, 2)}, about ${fmt(best.buffer / RUNS)} days of runs, for an expected ${millions(best.total)} a year. Up to that point each barrel of stock saves more margin than it costs to carry; beyond it, less. Zero risk isn’t the cheapest answer: the refinery still loses ${barrels(best.shortfall)} barrels of runs in an average year, because covering every storm would cost more than the storms do.`}
      />

      <H2>The value of having oil on hand</H2>
      <P>
        The readout <FigRef to="Oil Storage Terminal · buffer">in this demonstration</FigRef> names the idea behind that answer: the value of one more barrel of stock. When
        stocks are thin it is high — here the whole {usd(LOST_MARGIN)} margin the barrel protects — and as stocks grow it falls, to {usd(best.marginalValue, 2)} past the best
        safety stock, then to nothing. Economists call this benefit of holding the physical oil, rather than a promise of oil later, the <b>convenience yield</b>. It’s why refiners,
        traders and pipelines hold working stocks even when forward prices give them no reason to, and why governments keep strategic reserves for emergencies.
      </P>
      <P>
        The two reasons for storage meet in the forward prices themselves. When stocks are plentiful, an extra barrel on hand is worth little, so oil for later can
        sell for more than oil today, by up to the cost of carrying it; when stocks are scarce, a barrel today is worth a premium. Chapter 5 turns that into the
        shape of the futures curve. First, though, the tanks have to be connected to everything else. Storage moves oil through time; pipelines and ships move it
        through space. The <a href={lessonHref('oil/4.4')}>next lesson</a> puts the whole network together, and asks what that does to the price of a barrel in each
        place.
      </P>
    </LessonPage>
  );
}
