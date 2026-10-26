import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { PRODUCT_DEFAULTS, productMarket, type ProductMonth } from '../../../engines/oil/market';
import { planRefinery } from '../../../engines/oil/refinery';
import { PRODUCT_COLOR, PRODUCT_PRICE } from '../../../model/oil/refinery';
import { REF_PRICES } from '../../../model/oil/world';
import { XYChart, type XYSeries } from '../shared/charts';

// ---------------------------------------------------------------------------
// Figure 1: a year of the world's gasoline and distillate.

/** Share of every barrel run that becomes gasoline plus distillate; moving one moves the other. */
export const YIELD_SUM = 0.86;
/** The reference runs and distillate yield, and the sliders' steps. */
export const REF_RUNS = 83;
export const REF_DISTILLATE = 0.42;
export const RUNS_STEP = 0.5;
export const DISTILLATE_STEP = 0.0025;
/** The first challenge's floor for distillate stocks, million barrels. */
export const DISTILLATE_FLOOR = 725;
/** A refinery outage: 1.5 mb/d of runs lost in August and September. */
export const OUTAGE = { size: 1.5, start: 7, months: 2 };

export type OutageMode = 'none' | 'august';

export interface MarketState {
  runs: number;
  /** Distillate yield; gasoline's is YIELD_SUM minus this. */
  distillate: number;
  outage: OutageMode;
}

export const MARKET_DEFAULTS: MarketState = { runs: REF_RUNS, distillate: REF_DISTILLATE, outage: 'none' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INITIAL = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** The year's product market for a setting of the sliders. */
export function marketFor(st: MarketState): ProductMonth[] {
  return productMarket({
    runs: st.runs,
    gasolineYield: YIELD_SUM - st.distillate,
    distillateYield: st.distillate,
    outage: st.outage === 'august' ? OUTAGE : undefined,
  });
}

const minOf = (xs: number[]) => Math.min(...xs);
const maxOf = (xs: number[]) => Math.max(...xs);
const lowestDistillate = (st: MarketState) => minOf(marketFor(st).map((m) => m.distillateStock));

/**
 * Challenge a: at the reference runs and with no outage, the smallest distillate yield (on the
 * slider's steps) that keeps distillate stocks at or over 725 million barrels all year. The reader
 * predicts it from the prose's first quarter point (681 → 700 million): about 2.3 steps, so three.
 */
export function distillateFloorSolved(st: MarketState): boolean {
  if (Math.abs(st.runs - REF_RUNS) > 1e-9 || st.outage !== 'none') return false;
  const less = { ...st, distillate: Math.round((st.distillate - DISTILLATE_STEP) * 10000) / 10000 };
  return lowestDistillate(st) >= DISTILLATE_FLOOR && lowestDistillate(less) < DISTILLATE_FLOOR;
}

// ---------------------------------------------------------------------------
// Figure 2: how far the Corran refinery can swing its output.

export const DIESEL_MIN = 70;
export const DIESEL_MAX = 140;

export interface FrontierPoint {
  diesel: number;
  gasoline: number;
  dieselOut: number;
  jet: number;
  fuelOil: number;
}

let frontierCache: FrontierPoint[] | null = null;

/**
 * Corran's output as the diesel price runs from $70 to $140 a barrel with gasoline at its reference
 * price, holding the crude slate at the reference plan's mix so only the routing changes.
 */
export function frontier(): FrontierPoint[] {
  if (!frontierCache) {
    const base = planRefinery();
    const slate = base.crude;
    frontierCache = [];
    for (let p = DIESEL_MIN; p <= DIESEL_MAX; p++) {
      const plan = planRefinery({ productPrice: { gasoline: PRODUCT_PRICE.gasoline, diesel: p }, crudeAvailable: slate });
      frontierCache.push({ diesel: p, gasoline: plan.products.gasoline, dieselOut: plan.products.diesel, jet: plan.products.jet, fuelOil: plan.products.hsfo });
    }
  }
  return frontierCache;
}

export function outputAt(price: number): FrontierPoint {
  const f = frontier();
  return f[Math.max(0, Math.min(f.length - 1, Math.round(price) - DIESEL_MIN))];
}

/** Challenge b: the lowest diesel price (whole dollars) at which Corran makes more diesel than gasoline. */
export function moreDieselSolved(price: number): boolean {
  const more = (p: number) => {
    const o = outputAt(p);
    return o.dieselOut > o.gasoline;
  };
  return price >= DIESEL_MIN && more(price) && (price === DIESEL_MIN || !more(price - 1));
}

// ---------------------------------------------------------------------------

function mb(x: number): string {
  return `${fmt(x)} million bbl`;
}

function kbd(x: number): string {
  return `${fmt(x, 1)} kb/d`;
}

/** A yield as a percentage, with as many decimals as it needs (44%, 42.5%, 42.25%). */
export function pctYield(y: number): string {
  return `${fmt(y * 100, 2).replace(/\.?0+$/, '')}%`;
}

/** Points for a stepped line, one step per whole-dollar price. */
function steps(points: FrontierPoint[], key: keyof Omit<FrontierPoint, 'diesel'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  points.forEach((p) => {
    out.push([Math.max(DIESEL_MIN, p.diesel - 0.5), p[key]]);
    out.push([Math.min(DIESEL_MAX, p.diesel + 0.5), p[key]]);
  });
  return out;
}

const REF = marketFor(MARKET_DEFAULTS);
const refStat = (pick: (m: ProductMonth) => number) => {
  const xs = REF.map(pick);
  return { min: minOf(xs), max: maxOf(xs), minAt: xs.indexOf(minOf(xs)), maxAt: xs.indexOf(maxOf(xs)) };
};

export default function Lesson() {
  const s1 = useScenario<MarketState>('products', MARKET_DEFAULTS);
  const st = s1.state;
  const months = useMemo(() => marketFor(st), [st]);
  const xs = months.map((_, i) => i + 0.5);
  const gStocks = months.map((m) => m.gasolineStock);
  const dStocks = months.map((m) => m.distillateStock);
  const gCracks = months.map((m) => m.gasolineCrack);
  const dCracks = months.map((m) => m.distillateCrack);
  const minD = minOf(dStocks);
  const minDAt = dStocks.indexOf(minD);
  const minG = minOf(gStocks);
  const solvedA = distillateFloorSolved(st);
  const GAS = PRODUCT_COLOR.gasoline;
  const DIST = PRODUCT_COLOR.diesel;

  const s2 = useScenario('yields', { diesel: PRODUCT_PRICE.diesel });
  const fr = useMemo(() => frontier(), []);
  const here = outputAt(s2.state.diesel);
  const solvedB = moreDieselSolved(s2.state.diesel);

  // Numbers quoted in the prose (all from the model).
  const gStock = refStat((m) => m.gasolineStock);
  const dStock = refStat((m) => m.distillateStock);
  const gCrack = refStat((m) => m.gasolineCrack);
  const dCrack = refStat((m) => m.distillateCrack);
  const gDemandPeak = maxOf(REF.map((m) => m.gasolineDemand));
  const dDemandPeak = maxOf(REF.map((m) => m.distillateDemand));
  const harder = marketFor({ ...MARKET_DEFAULTS, runs: REF_RUNS + RUNS_STEP });
  const harderStill = marketFor({ ...MARKET_DEFAULTS, runs: REF_RUNS + 1 });
  const shifted = marketFor({ ...MARKET_DEFAULTS, distillate: REF_DISTILLATE + DISTILLATE_STEP });
  const shiftedLow = minOf(shifted.map((m) => m.distillateStock));
  const gasCrackRef = REF_PRICES.gasoline - REF_PRICES.brent;
  const dslCrackRef = REF_PRICES.diesel - REF_PRICES.brent;
  const ref = outputAt(PRODUCT_PRICE.diesel);
  const cheap = outputAt(DIESEL_MIN);
  const switchPoint = fr.find((p) => p.dieselOut > p.gasoline)!;
  const mid = outputAt(switchPoint.diesel - 1);
  const dear = outputAt(DIESEL_MAX);
  const gasRange = { min: minOf(fr.map((p) => p.gasoline)), max: maxOf(fr.map((p) => p.gasoline)) };

  const outageText = st.outage === 'august' ? `, with ${fmt(OUTAGE.size, 1)} mb/d of runs lost in August and September` : '';

  return (
    <LessonPage id="oil/5.3">
      <P>
        <a href={lessonHref('oil/5.2')}>Lesson 5.2</a> followed crude’s benchmarks: the price of a barrel at an inland hub and at the coast, and the differentials
        that price every other grade against them. But nobody buys crude to keep it. Refiners buy it to make gasoline, diesel and jet fuel, and each of those has a
        market of its own, with its own buyers, its own seasons and its own stocks in tanks. This lesson asks how those markets set the price of a product — and why
        they can pull in different directions even though the same barrels of crude feed them all.
      </P>
      <P>
        The price that matters to a refiner is the gap between a product and the crude it’s made from. That gap is called the product’s{' '}
        <K c="price">crack spread</K>, after the cracking of crude into products. In the course’s simulated reference month, gasoline sells for{' '}
        {usd(REF_PRICES.gasoline)} a barrel and the Brent-like benchmark crude for {usd(REF_PRICES.brent)}, so gasoline’s crack is {usd(gasCrackRef)}; diesel, at{' '}
        {usd(REF_PRICES.diesel)}, has a crack of {usd(dslCrackRef)}. A refinery’s margin, as <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> found, is made of cracks
        like these, less the products it sells below the price of crude.
      </P>
      <P>
        Demand for products follows the calendar. Gasoline is used most in summer, when people drive more. Distillate — diesel, heating oil and, in our model, jet
        fuel — is strongest in the northern winter, when heating oil is burned, although jet fuel on its own peaks in the summer travel season. Refineries, though,
        run at a fairly steady pace, and from every barrel they make both gasoline and distillate. In our model the world’s refineries run {fmt(REF_RUNS)} million
        barrels a day, about the real figure in recent years, and turn {pctYield(YIELD_SUM - REF_DISTILLATE)} of each barrel into gasoline and{' '}
        {pctYield(REF_DISTILLATE)} into distillate. That split is the model’s own, closer to an American refinery’s than to the world’s: worldwide, distillates
        outsell gasoline. Inventories absorb the difference, and in
        the model a product’s crack rises by {usd(PRODUCT_DEFAULTS.crackSensitivity, 2)} for every 1% its stocks sit under normal — a simulated relation in the spirit
        of <a href={lessonHref('oil/5.1')}>Lesson 5.1</a>, where crude prices followed crude stocks. In the next demonstration, set the world’s refinery runs and the
        split of each barrel between distillate and gasoline, and follow a year:
      </P>

      <Figure name="Product Market Model" scenario={s1}>
        <Segmented
          label="Refinery outage"
          value={st.outage}
          onChange={(v) => s1.set({ outage: v })}
          options={[
            { value: 'none', label: 'No outage' },
            { value: 'august', label: 'Outage in August–September' },
          ]}
        />
        <Legend
          items={[
            { label: 'Gasoline', color: GAS, kind: 'line' },
            { label: 'Distillate', color: DIST, kind: 'line' },
            { label: 'Normal stocks', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Product stocks by month over a year at ${fmt(st.runs, 1)} mb/d of runs, ${pctYield(st.distillate)} distillate${outageText}: gasoline ranges from ${mb(minG)} to ${mb(maxOf(gStocks))} against a normal ${mb(PRODUCT_DEFAULTS.normalGasoline)}; distillate from ${mb(minD)} to ${mb(maxOf(dStocks))} against a normal ${mb(PRODUCT_DEFAULTS.normalDistillate)}.`}
          height={200}
          x={[0, 12]}
          y={[0, 1400]}
          xTicks={xs}
          xFormat={(v) => INITIAL[Math.floor(v)]}
          yTicks={[0, 400, 800, 1200]}
          yFormat={(v) => fmt(v)}
          yLabel="Stocks, million barrels"
          refs={[
            { axis: 'y', at: PRODUCT_DEFAULTS.normalGasoline, color: GAS, dash: '5 4' },
            { axis: 'y', at: PRODUCT_DEFAULTS.normalDistillate, color: DIST, dash: '5 4' },
            { axis: 'y', at: DISTILLATE_FLOOR, color: '#c4382f', dash: '2 3', label: `${fmt(DISTILLATE_FLOOR)} million` },
          ]}
          series={[
            { points: xs.map((x, i) => [x, gStocks[i]] as [number, number]), color: GAS, width: 3 },
            { points: xs.map((x, i) => [x, dStocks[i]] as [number, number]), color: DIST, width: 3 },
          ]}
        />
        <XYChart
          ariaLabel={`Crack spreads over crude by month: gasoline from ${usd(minOf(gCracks), 2)} to ${usd(maxOf(gCracks), 2)} a barrel, distillate from ${usd(minOf(dCracks), 2)} to ${usd(maxOf(dCracks), 2)}.`}
          height={180}
          x={[0, 12]}
          y={[-10, 80]}
          xTicks={xs}
          xFormat={(v) => INITIAL[Math.floor(v)]}
          yTicks={[0, 20, 40, 60, 80]}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Crack spread over crude, $ per barrel (simulated)"
          series={[
            { points: xs.map((x, i) => [x, gCracks[i]] as [number, number]), color: GAS, width: 2.5 },
            { points: xs.map((x, i) => [x, dCracks[i]] as [number, number]), color: DIST, width: 2.5 },
          ]}
        />
        <Readouts
          items={[
            { label: 'lowest gasoline stocks', value: mb(minG) },
            { label: 'lowest distillate stocks', value: mb(minD), tone: minD < DISTILLATE_FLOOR ? 'red' : undefined },
            { label: <K c="price">top gasoline crack</K>, value: usd(maxOf(gCracks), 2), tone: 'green' },
            { label: <K c="price">top distillate crack</K>, value: usd(maxOf(dCracks), 2), tone: 'green' },
          ]}
        />
        <Slider
          label="Refinery runs"
          tone="orange"
          value={st.runs}
          min={81.5}
          max={84.5}
          step={RUNS_STEP}
          onChange={(v) => s1.set({ runs: v })}
          display={`${fmt(st.runs, 1)} mb/d`}
        />
        <Slider
          label="Distillate yield"
          tone="orange"
          value={st.distillate}
          min={0.41}
          max={0.43}
          step={DISTILLATE_STEP}
          onChange={(v) => s1.set({ distillate: Math.round(v * 10000) / 10000 })}
          display={`${pctYield(st.distillate)} · gasoline ${pctYield(YIELD_SUM - st.distillate)}`}
        />
        <Caption>
          Gasoline output is {fmt(months[0].gasolineSupply, 2)} mb/d against demand of {fmt(minOf(months.map((m) => m.gasolineDemand)), 2)}–
          {fmt(maxOf(months.map((m) => m.gasolineDemand)), 2)}; distillate output is {fmt(months[0].distillateSupply, 2)} mb/d against{' '}
          {fmt(minOf(months.map((m) => m.distillateDemand)), 2)}–{fmt(maxOf(months.map((m) => m.distillateDemand)), 2)}.
        </Caption>
      </Figure>

      <P>
        At the reference settings, refineries make {fmt(REF[0].gasolineSupply, 2)} million barrels of gasoline a day all year, while demand climbs to{' '}
        {fmt(gDemandPeak, 2)} in high summer. In winter and spring the surplus goes into tanks: gasoline stocks peak in {MONTHS[gStock.maxAt]} at about{' '}
        {mb(gStock.max)}, well over the normal {fmt(PRODUCT_DEFAULTS.normalGasoline)}, and the crack sinks to {usd(gCrack.min, 2)}. Then the summer draws them down
        to {mb(gStock.min)} by {MONTHS[gStock.minAt]}, and the crack climbs to {usd(gCrack.max, 2)}. Distillate runs the other way round. Its demand peaks at{' '}
        {fmt(dDemandPeak, 2)} mb/d in winter against output of {fmt(REF[0].distillateSupply, 2)}, its stocks bottom out in {MONTHS[dStock.minAt]} at{' '}
        {mb(dStock.min)}, and its crack tops out then at {usd(dCrack.max, 2)}. Inventories let a steady industry meet an unsteady calendar, and prices pay whoever
        holds them: the crack is highest exactly when stocks are scarce.
      </P>

      <H2>One barrel, two products</H2>
      <P>
        Suppose the distillate stocks of {MONTHS[dStock.minAt]} look dangerously thin, and the market wants them kept at {fmt(DISTILLATE_FLOOR)} million barrels or
        more all year. Refiners have two levers, and both pull gasoline along. They can run harder. At {fmt(REF_RUNS + RUNS_STEP, 1)} mb/d, distillate stocks never
        fall under {mb(minOf(harder.map((m) => m.distillateStock)))} — but every extra barrel run makes gasoline too, so gasoline stocks swell and its crack never rises
        past {usd(maxOf(harder.map((m) => m.gasolineCrack)), 2)}; at {fmt(REF_RUNS + 1, 1)} mb/d it falls as low as{' '}
        {usd(minOf(harderStill.map((m) => m.gasolineCrack)), 2)}. Or they can shift the split of each barrel, the swing cuts and cracker settings of{' '}
        <a href={lessonHref('oil/3.1')}>Lessons 3.1</a> and <a href={lessonHref('oil/3.2')}>3.2</a>. That makes more distillate only by making less gasoline:
        moving a quarter of a percentage point of the barrel to distillate lifts its low point from {fmt(dStock.min)} to {mb(shiftedLow)} and drops
        gasoline’s to {mb(minOf(shifted.map((m) => m.gasolineStock)))}, sending its September crack to {usd(shifted[8].gasolineCrack, 2)}.
      </P>
      <P>
        This is <b>joint production</b>, and it’s why product prices can move apart even though they share every barrel of crude. When distillate is short and refiners
        run harder for it, gasoline floods and its crack falls; when they shift yields toward distillate, gasoline tightens instead. Notice also how small the numbers
        are. A quarter of a percentage point of 83 million barrels a day is about 200,000 barrels a day, and over a year that adds up to some 75 million barrels in
        the tanks. Stocks are where small, persistent imbalances in a vast flow become visible, and cracks are how the market notices.
      </P>

      <Challenge
        id="a"
        figure="Product Market Model"
        question={`Keep runs at ${fmt(REF_RUNS)} mb/d with no outage. Predict first: one quarter of a percentage point lifted distillate’s low point by about ${fmt(shiftedLow - dStock.min)} million barrels. How many quarter points does ${fmt(DISTILLATE_FLOOR)} million take? Then find the smallest distillate yield that keeps distillate stocks at or over ${fmt(DISTILLATE_FLOOR)} million barrels all year — the least gasoline given up.`}
        solved={solvedA}
        status={
          Math.abs(st.runs - REF_RUNS) > 1e-9 || st.outage !== 'none'
            ? `Set runs to ${fmt(REF_RUNS)} mb/d and choose no outage.`
            : `At ${pctYield(st.distillate)} distillate, its stocks bottom out at ${mb(minD)}.`
        }
        success={`Solved: ${pctYield(st.distillate)} distillate and ${pctYield(YIELD_SUM - st.distillate)} gasoline. Distillate stocks now stay at ${mb(minD)} or more, but gasoline’s low point falls to ${mb(minG)} and its top crack rises to ${usd(maxOf(gCracks), 2)}. Each quarter point lifted distillate’s low a little less than the one before, because the low moved earlier, to ${MONTHS[minDAt]}, with fewer months of the extra yield behind it. One market’s relief is the other’s squeeze.`}
      />

      <P>
        <FigRef to="Product Market Model">The demonstration</FigRef>’s other switch takes {fmt(OUTAGE.size, 1)} million barrels a day of runs out in August and
        September, as a hurricane on a refining coast might. That is a shock rather than a season, and <a href={lessonHref('oil/5.5')}>Lesson 5.5</a> takes it up.
      </P>

      <H2>How far can a refinery swing?</H2>
      <P>
        The yield slider made shifting a barrel between products look easy. A real refinery is bound by its units, as <a href={lessonHref('oil/3.5')}>Lesson 3.5</a>{' '}
        showed. In the next demonstration, the Corran refinery’s linear program is solved again at every diesel price from {usd(DIESEL_MIN)} to {usd(DIESEL_MAX)} a
        barrel, with gasoline held at {usd(PRODUCT_PRICE.gasoline)}. We hold the crude slate at the reference plan’s mix of Pinyon Light and Coldwater Heavy, so only
        the routing of streams through the units can change. Move the diesel price:
      </P>

      <Figure name="Product Market Model · yields" scenario={s2}>
        <Legend
          items={[
            { label: 'Gasoline', color: PRODUCT_COLOR.gasoline, kind: 'line' },
            { label: 'Diesel', color: PRODUCT_COLOR.diesel, kind: 'line' },
            { label: 'Jet fuel', color: PRODUCT_COLOR.jet, kind: 'line' },
            { label: 'Fuel oil', color: PRODUCT_COLOR.hsfo, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Corran’s output against the diesel price, with gasoline at ${usd(PRODUCT_PRICE.gasoline)}. At ${usd(s2.state.diesel)}: gasoline ${kbd(here.gasoline)}, diesel ${kbd(here.dieselOut)}, jet fuel ${kbd(here.jet)}, fuel oil ${kbd(here.fuelOil)}.`}
          height={250}
          x={[DIESEL_MIN, DIESEL_MAX]}
          y={[0, 60]}
          xTicks={[70, 80, 90, 100, 110, 120, 130, 140]}
          xFormat={(v) => `$${v}`}
          yTicks={[0, 20, 40, 60]}
          xLabel="diesel price, $ per barrel (gasoline fixed)"
          yLabel="Corran’s output, thousand barrels a day"
          series={(
            [
              ['gasoline', PRODUCT_COLOR.gasoline],
              ['dieselOut', PRODUCT_COLOR.diesel],
              ['jet', PRODUCT_COLOR.jet],
              ['fuelOil', PRODUCT_COLOR.hsfo],
            ] as const
          ).map(([k, c]): XYSeries => ({ points: steps(fr, k), color: c, width: k === 'gasoline' || k === 'dieselOut' ? 3 : 2 }))}
          refs={[{ axis: 'x', at: s2.state.diesel, cursor: true }]}
          markers={[
            { x: s2.state.diesel, y: here.gasoline, color: PRODUCT_COLOR.gasoline, r: 5 },
            { x: s2.state.diesel, y: here.dieselOut, color: PRODUCT_COLOR.diesel, r: 5 },
          ]}
          onScrub={(v) => s2.set({ diesel: Math.round(v) })}
          scrubValue={s2.state.diesel}
          scrubStep={1}
          scrubLabel="Diesel price"
        />
        <Readouts
          items={[
            { label: 'gasoline', value: kbd(here.gasoline) },
            { label: 'diesel', value: kbd(here.dieselOut) },
            { label: 'jet fuel', value: kbd(here.jet) },
            { label: 'fuel oil', value: kbd(here.fuelOil) },
          ]}
        />
        <Slider
          label="Diesel price"
          tone="green"
          value={s2.state.diesel}
          min={DIESEL_MIN}
          max={DIESEL_MAX}
          onChange={(v) => s2.set({ diesel: v })}
          display={`${usd(s2.state.diesel)}/bbl · gasoline ${usd(PRODUCT_PRICE.gasoline)}`}
        />
      </Figure>

      <P>
        Output moves in a few steps, not smoothly. At the reference {usd(PRODUCT_PRICE.diesel)}, Corran makes {kbd(ref.gasoline)} of gasoline and {kbd(ref.dieselOut)}{' '}
        of diesel. Cheapen diesel to {usd(DIESEL_MIN)} and diesel output falls to {kbd(cheap.dieselOut)} — but mostly because diesel-range oil stops being worth
        hydrotreating and goes into fuel oil, which rises from {kbd(ref.fuelOil)} to {kbd(cheap.fuelOil)}. Gasoline gains only{' '}
        {kbd(cheap.gasoline - ref.gasoline)}. Push diesel to {usd(DIESEL_MAX)} and
        Corran squeezes out {kbd(dear.dieselOut)} of diesel, partly by giving up jet fuel. Across the whole range, gasoline output stays between{' '}
        {kbd(gasRange.min)} and {kbd(gasRange.max)}: a swing of {kbd(gasRange.max - gasRange.min)}, about {fmt(((gasRange.max - gasRange.min) / 150) * 100)}% of the
        crude it runs.
      </P>

      <Challenge
        id="b"
        question={`Gasoline sells for ${usd(PRODUCT_PRICE.gasoline)}. Predict first: does Corran make more diesel than gasoline only once diesel sells for more than gasoline, or already below that? Then find the lowest diesel price, to the nearest dollar, at which it does.`}
        solved={solvedB}
        status={`At ${usd(s2.state.diesel)}, Corran makes ${kbd(here.dieselOut)} of diesel and ${kbd(here.gasoline)} of gasoline.`}
        success={`Solved: ${usd(switchPoint.diesel)}, well below gasoline’s ${usd(PRODUCT_PRICE.gasoline)}. This is where the real swing between the two products happens: between ${usd(mid.diesel)} and ${usd(switchPoint.diesel)}, the coker’s gas oil moves from the cracker, which turns it into gasoline, to the hydrotreater, which turns it into diesel, and diesel output jumps from ${kbd(mid.dieselOut)} to ${kbd(switchPoint.dieselOut)}. A refinery’s mix is set mostly by its crudes and its equipment; prices nudge it at the edges.`}
      />

      <P>
        So refined product prices are formed the same way crude prices are — by stocks against a calendar of demand — with one twist: the supplies are joined at the
        hip. Refiners can lean their output a little toward whichever product pays more, but not far, so each product’s crack carries the imbalance the other can’t
        absorb. Those cracks are what a refinery earns, and Chapter 6 trades a blend of them: the <b>3:2:1 crack spread</b>, the margin on turning three barrels of
        crude into two of gasoline and one of distillate, quoted per barrel of crude.
      </P>
      <P>
        Every price so far has been a price for oil today. Yet much of the oil business is priced for months ahead: refiners sell next winter’s heating oil, producers
        sell next year’s crude. Those forward and futures prices carry the market’s expectations about stocks to come. The <a href={lessonHref('oil/5.4')}>next
        lesson</a> reads them from the futures curve.
      </P>
    </LessonPage>
  );
}
