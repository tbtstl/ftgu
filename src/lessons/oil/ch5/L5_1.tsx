import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sup,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  signed,
  usd,
  useScenario,
} from '../../../framework';
import { WORLD, balanceSheet, crudeAndProductStocks, inventoryPrice, type BalanceRow } from '../../../engines/oil/market';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// Figure 1: the quarterly balance.

export const GROUP_RANGE = { min: 29, max: 34, step: 0.05 };
export const DEMAND_GROWTH_DEFAULT = 1.0;
export const NON_GROUP_GROWTH_DEFAULT = 0.15;

export interface BalanceState {
  group: number;
  demandGrowth: number;
  nonGroupGrowth: number;
}

export const BALANCE_DEFAULTS: BalanceState = { group: WORLD.group, demandGrowth: DEMAND_GROWTH_DEFAULT, nonGroupGrowth: NON_GROUP_GROWTH_DEFAULT };

export function rowsOf(s: BalanceState): BalanceRow[] {
  return balanceSheet({ group: s.group, demandGrowth: s.demandGrowth, nonGroupGrowth: s.nonGroupGrowth, quarters: 8 });
}

/** Change in stocks over the first year, million barrels. */
export function yearOneChange(s: BalanceState): number {
  return rowsOf(s)[3].stocks - WORLD.normalStocks;
}

const GROUP_GRID = Array.from({ length: Math.round((GROUP_RANGE.max - GROUP_RANGE.min) / GROUP_RANGE.step) + 1 }, (_, i) => Math.round((GROUP_RANGE.min + i * GROUP_RANGE.step) * 100) / 100);

/** The group production(s) on the slider grid that leave year-one stocks closest to where they started. */
export function flatGroup(demandGrowth: number, nonGroupGrowth: number): number[] {
  const dev = GROUP_GRID.map((g) => Math.abs(yearOneChange({ group: g, demandGrowth, nonGroupGrowth })));
  const best = Math.min(...dev);
  return GROUP_GRID.filter((_, i) => dev[i] <= best + 1e-6);
}

/** Challenge a: stocks end the first year where they began, as nearly as the slider allows. */
export function flatStocksSolved(s: BalanceState): boolean {
  const g = Math.round(s.group * 100) / 100;
  return flatGroup(s.demandGrowth, s.nonGroupGrowth).some((x) => Math.abs(x - g) < 1e-9);
}

// ---------------------------------------------------------------------------
// Figure 2: crude and product stocks through a year of refinery runs.

/** Crude delivered to refiners, mb/d, their normal runs, and the liquids that never pass through a refinery. */
export const CRUDE_SUPPLY = 83;
export const OTHER_LIQUIDS = 15;
export const YIELD_FACTOR = 1.03;
/** Product demand at normal runs (the balance on average), before its seasonal swing, mb/d. */
export const PRODUCT_DEMAND = CRUDE_SUPPLY * YIELD_FACTOR + OTHER_LIQUIDS;
/** Share of the maintenance depth taken out of runs in each month (spring and autumn turnarounds). */
export const MAINTENANCE_SHAPE = [0, 0, 0.5, 1, 0.5, 0, 0, 0, 0, 0.6, 0.6, 0];
/** Months in which refiners can run harder (June–August). */
export const SUMMER_MONTHS = [5, 6, 7];
export const BOOST_STEP = 0.1;
export const BOOST_MAX = 3;

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function runsOf(depth: number, boost: number): number[] {
  return MAINTENANCE_SHAPE.map((w, m) => CRUDE_SUPPLY - w * depth + (SUMMER_MONTHS.includes(m) ? boost : 0));
}

export function productDemandOf(): number[] {
  return Array.from({ length: 12 }, (_, m) => PRODUCT_DEMAND + WORLD.seasonal[Math.floor(m / 3)]);
}

export function yearOfStocks(depth: number, boost: number) {
  return crudeAndProductStocks({ crudeSupply: CRUDE_SUPPLY, runs: runsOf(depth, boost), productDemand: productDemandOf(), otherLiquids: OTHER_LIQUIDS, yieldFactor: YIELD_FACTOR });
}

const BOOST_GRID = Array.from({ length: Math.round(BOOST_MAX / BOOST_STEP) + 1 }, (_, i) => Math.round(i * BOOST_STEP * 10) / 10);

/** The summer boost(s) on the slider grid that leave product stocks closest to where they began the year. */
export function flatBoost(depth: number): number[] {
  const dev = BOOST_GRID.map((b) => Math.abs(yearOfStocks(depth, b)[11].productStock));
  const best = Math.min(...dev);
  return BOOST_GRID.filter((_, i) => dev[i] <= best + 1e-6);
}

/** Challenge b: the summer run rate that leaves product stocks flat over the year. */
export function flatProductsSolved(depth: number, boost: number): boolean {
  const b = Math.round(boost * 10) / 10;
  return flatBoost(depth).some((x) => Math.abs(x - b) < 1e-9);
}

// ---------------------------------------------------------------------------

const SUPPLY = '#4590ce';
const DEMAND = '#333333';
const STOCKS = '#d0702a';
const PRICE = '#6d9c37';
const CRUDE_LINE = '#8a5a24';
const PRODUCT_LINE = '#e6b25c';

const QUARTER = (i: number) => `Y${Math.floor(i / 4) + 1} Q${(i % 4) + 1}`;

function mbd(x: number): string {
  return fmt(x, 2);
}

/** Price from stocks, but only where the model's relation is meant to apply. */
function priceText(stocks: number): string {
  const r = stocks / WORLD.normalStocks;
  if (r < 0.75) return 'far above $200';
  if (r > 1.3) return 'far below $50';
  return usd(inventoryPrice(stocks), 2);
}

export default function Lesson() {
  const s1 = useScenario<BalanceState>('balance', BALANCE_DEFAULTS);
  const st = s1.state;
  const rows = rowsOf(st);
  const y1 = rows[3];
  const y2 = rows[7];
  const y1Avg = rows.slice(0, 4).reduce((a, r) => a + r.balance, 0) / 4;
  const y2Avg = rows.slice(4, 8).reduce((a, r) => a + r.balance, 0) / 4;
  const solvedA = flatStocksSolved(st);

  const stockPts: Array<[number, number]> = [[0, WORLD.normalStocks], ...rows.map((r, i) => [i + 1, r.stocks] as [number, number])];
  const [s0, s1Max] = niceDomain(Math.min(WORLD.normalStocks - 200, ...rows.map((r) => r.stocks)), Math.max(WORLD.normalStocks + 200, ...rows.map((r) => r.stocks)), 4);
  const pricePts: Array<[number, number]> = stockPts.map(([q, s]) => [q, Math.min(400, inventoryPrice(s))]);
  const pMax = Math.min(200, Math.max(100, ...pricePts.map((p) => p[1])));
  const [p0, p1] = niceDomain(Math.max(0, Math.min(60, ...pricePts.map((p) => p[1]))), pMax, 4);

  // Reference numbers at the default settings, for the prose.
  const ref = rowsOf(BALANCE_DEFAULTS);
  const refY1Avg = ref.slice(0, 4).reduce((a, r) => a + r.balance, 0) / 4;
  const refY2Avg = ref.slice(4, 8).reduce((a, r) => a + r.balance, 0) / 4;
  const refFlat = flatGroup(DEMAND_GROWTH_DEFAULT, NON_GROUP_GROWTH_DEFAULT)[0];
  const short5 = WORLD.normalStocks * 0.95;
  const long5 = WORLD.normalStocks * 1.05;

  const s2 = useScenario('crude-products', { depth: 2, boost: 0 });
  const { depth, boost } = s2.state;
  const year = yearOfStocks(depth, boost);
  const end = year[11];
  const runs = runsOf(depth, boost);
  const crudePts: Array<[number, number]> = [[0, 0], ...year.map((m) => [m.month + 1, m.crudeStock] as [number, number])];
  const productPts: Array<[number, number]> = [[0, 0], ...year.map((m) => [m.month + 1, m.productStock] as [number, number])];
  const totalPts: Array<[number, number]> = [[0, 0], ...year.map((m) => [m.month + 1, m.crudeStock + m.productStock] as [number, number])];
  const allStock = [...crudePts, ...productPts, ...totalPts].map((p) => p[1]);
  const [c0, c1] = niceDomain(Math.min(-50, ...allStock), Math.max(50, ...allStock), 4);
  const solvedB = flatProductsSolved(depth, boost);
  const refYear = yearOfStocks(2, 0);
  const aprilProduct = refYear[4].productStock - refYear[1].productStock;
  const aprilCrude = refYear[4].crudeStock - refYear[1].crudeStock;
  const refFlatBoost = flatBoost(2)[0];
  const refFlatYear = yearOfStocks(2, refFlatBoost)[11];

  const tableRows = [
    { key: 'nonGroup', label: 'Non-group supply', vals: rows.map((r) => r.nonGroup), cls: '' as const },
    { key: 'group', label: 'Producer group', vals: rows.map((r) => r.group), cls: '' as const },
    { key: 'gains', label: 'Processing gains', vals: rows.map((r) => r.gains), cls: '' as const },
    { key: 'supply', label: 'Supply', vals: rows.map((r) => r.supply), cls: 'hl' as const },
    { key: 'demand', label: 'Demand', vals: rows.map((r) => r.demand), cls: 'hl' as const },
    { key: 'balance', label: 'Stock change', vals: rows.map((r) => r.balance), cls: 'hl' as const },
  ];

  return (
    <LessonPage id="oil/5.1">
      <P>
        Chapter 4 explained why a barrel costs more in one place than another. Moving oil costs money, links fill up, and refineries pay more for crudes that suit them.
        Those are differences — a couple of dollars between Kessler and the coast, fifteen between a light crude and a heavy one. They say nothing about the level. Why
        should a barrel at Northport fetch $79 in our model’s reference month, and not $50 or $120? That level is set by the whole world’s supply and demand, and the tool
        analysts use to watch it is the <b>oil balance</b>.
      </P>
      <P>
        The world uses roughly 100 million barrels of oil a day. In our model, demand is {fmt(WORLD.demand, 1)} million barrels a day (mb/d) at the reference price.
        Supply comes from two kinds of producer. Most of it comes from producers outside any group, each pumping as much as pays: shale basins like Ridgeback, offshore
        fields like Seaboard, heavy-oil fields like Coldwater. The rest comes from a <b>producer group</b> that coordinates its output and keeps some capacity idle, ready
        to use. Its real-world counterpart is OPEC+, the members of OPEC working together, since 2016, with allies such as Russia. Refineries add a little more: their
        products take up more room than the crude they were made from (<a href={lessonHref('oil/3.2')}>Lesson 3.2</a>), and those <b>processing gains</b> count as supply.
      </P>
      <P>
        The difference between supply and demand has to go somewhere. Oil that’s produced and not used goes into tanks; oil that’s used and not produced comes out of them.
        So the <b>balance</b> — supply minus demand — is the implied change in stocks. The International Energy Agency, the U.S. Energy Information Administration and OPEC
        all publish balances like this every month, quarter by quarter and region by region, and the market reads them closely. In the next demonstration, set the group’s
        production and how fast demand and the other producers grow; the table is the balance sheet, and the charts follow commercial stocks and the price they imply:
      </P>

      <Figure name="Petroleum Balance Sheet" scenario={s1}>
        <DataTable
          caption="Quarterly oil balance, million barrels a day"
          rows={tableRows}
          rowKey={(r) => r.key}
          rowClass={(r) => r.cls}
          columns={[
            { label: 'mb/d', cell: (r) => r.label },
            ...rows.map((_, i) => ({
              label: QUARTER(i),
              align: 'right' as const,
              cell: (r: (typeof tableRows)[number]) => (r.key === 'balance' ? signed(r.vals[i], 2) : mbd(r.vals[i])),
            })),
          ]}
        />
        <Legend
          items={[
            { label: 'Commercial stocks', color: STOCKS, kind: 'line' },
            { label: 'Normal stocks', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Implied price', color: PRICE, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Commercial stocks over two years: ${fmt(WORLD.normalStocks)} million barrels at the start, ${fmt(y1.stocks)} after the first year and ${fmt(y2.stocks)} after the second, against ${fmt(WORLD.normalStocks)} normal.`}
          height={190}
          x={[0, 8]}
          y={[s0, s1Max]}
          xTicks={[0, 2, 4, 6, 8]}
          xFormat={(v) => (v === 0 ? 'start' : v % 4 === 0 ? `year ${v / 4}` : `Y${Math.ceil(v / 4)} Q${((v - 1) % 4) + 1}`)}
          yTicks={niceTicks(s0, s1Max, 4)}
          yFormat={(v) => fmt(v)}
          yLabel="Commercial stocks, million barrels"
          series={[{ points: stockPts, color: STOCKS, width: 3 }]}
          refs={[{ axis: 'y', at: WORLD.normalStocks, color: '#9a9a9a', dash: '5 4', label: 'normal' }]}
          markers={stockPts.slice(1).map(([q, s]) => ({ x: q, y: s, color: STOCKS, r: 3.5 }))}
        />
        <XYChart
          ariaLabel={`Price implied by stocks: $79 at the start, ${priceText(y1.stocks)} after the first year and ${priceText(y2.stocks)} after the second.`}
          height={140}
          x={[0, 8]}
          y={[p0, p1]}
          xTicks={[0, 4, 8]}
          xFormat={(v) => (v === 0 ? 'start' : `year ${v / 4}`)}
          yTicks={niceTicks(p0, p1, 3)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Implied price, $ per barrel (simulated)"
          series={[{ points: pricePts, color: PRICE, width: 2.5 }]}
          refs={[{ axis: 'y', at: WORLD.referencePrice, color: '#9a9a9a', dash: '5 4' }]}
        />
        <Readouts
          items={[
            { label: <K tone="orange">year 1 stock change</K>, value: `${signed(y1Avg, 2)} mb/d`, tone: 'orange' },
            { label: 'stocks after year 1', value: `${fmt(y1.stocks)} M bbl` },
            { label: <K c="price">price after year 1</K>, value: priceText(y1.stocks), tone: 'green' },
            { label: <K c="price">price after year 2</K>, value: priceText(y2.stocks), tone: 'green' },
          ]}
        />
        <Slider
          label="Group production"
          tone="orange"
          value={st.group}
          min={GROUP_RANGE.min}
          max={GROUP_RANGE.max}
          step={GROUP_RANGE.step}
          onChange={(v) => s1.set({ group: Math.round(v * 100) / 100 })}
          display={`${fmt(st.group, 2)} mb/d`}
        />
        <Slider label="Demand growth" value={st.demandGrowth} min={0} max={2} step={0.1} onChange={(v) => s1.set({ demandGrowth: Math.round(v * 10) / 10 })} display={`${fmt(st.demandGrowth, 1)} mb/d a year`} />
        <Slider
          label="Non-group growth"
          value={st.nonGroupGrowth}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => s1.set({ nonGroupGrowth: Math.round(v * 100) / 100 })}
          display={`${fmt(st.nonGroupGrowth, 2)} mb/d a quarter`}
        />
        <Caption>
          {y1Avg >= 0 ? 'Over the first year supply runs ahead of demand and stocks build' : 'Over the first year demand runs ahead of supply and stocks draw'}; in the second
          they {y2Avg >= 0 ? 'build' : 'draw'} at {fmt(Math.abs(y2Avg), 2)} mb/d. All figures are the model’s, not market data.
        </Caption>
      </Figure>

      <P>
        At the starting settings the group produces {fmt(WORLD.group, 1)} mb/d. In the first quarter, with demand at its seasonal low, supply exceeds demand by{' '}
        {mbd(ref[0].balance)} mb/d and stocks build to {fmt(ref[0].stocks)} million barrels. In the third quarter — the northern summer, when people drive and fly most —
        demand climbs and the balance turns to {signed(ref[2].balance, 2)} mb/d. Over the whole year stocks draw at an average {mbd(-refY1Avg)} mb/d and end at{' '}
        {fmt(ref[3].stocks)} million barrels. In the second year demand keeps growing by {fmt(DEMAND_GROWTH_DEFAULT, 1)} mb/d a year, faster than other producers add
        supply, and the draw deepens to {mbd(-refY2Avg)} mb/d.
      </P>
      <P>
        Those look like small numbers against a hundred million barrels a day, but stocks add them up. A gap of 1 mb/d kept up for a year moves 365 million barrels — about
        an eighth of all the commercial stocks in our model. The balance sheet is a forecast of how stocks will move, and stocks are what the price watches. Real balances
        are estimates, revised for months afterward, and the reported supply, demand and stock changes rarely agree exactly; analysts call the gap “missing barrels.”
      </P>

      <H2>Stocks set the price</H2>
      <P>
        Why should stocks matter so much? <a href={lessonHref('oil/4.3')}>Lesson 4.3</a> gave the reason: a barrel in the tank keeps refineries running through late
        cargoes and outages, and the scarcer stocks are, the more one more barrel on hand is worth. When stocks are ample, nobody pays much for that insurance; when they’re
        thin, everyone does. In our model the link is a simple formula, with S the commercial stocks and 2,800 million barrels the normal level:
      </P>
      <Eq label="Price equals 79 dollars times stocks over 2,800, to the power minus 4">
        <K c="price">P</K>
        <Op>=</Op>
        <span>$79</span>
        <Op>×</Op>
        <span>
          (
          <Frac top="S" bottom="2,800" />)<Sup>−4</Sup>
        </span>
      </Eq>
      <P>
        It’s steep. Stocks 5% below normal, at {fmt(short5)} million barrels, lift the price to {usd(inventoryPrice(short5), 2)}, about{' '}
        {pct(inventoryPrice(short5) / WORLD.referencePrice - 1)} higher; stocks 5% above normal sink it to {usd(inventoryPrice(long5), 2)}. Real markets show the same
        pattern, if not this neat a curve, which is why traders watch the weekly inventory reports of the U.S. Energy Information Administration as closely as they do.
        With the starting settings in <FigRef to="Petroleum Balance Sheet">the demonstration</FigRef>, the price stands at {usd(inventoryPrice(ref[3].stocks), 2)} after
        the first year and {usd(inventoryPrice(ref[7].stocks), 2)} after the second.
      </P>

      <Challenge
        id="a"
        question="The group wants stocks to end the first year exactly where they started. Set its production, to the nearest 0.05 mb/d, so they do — for whatever growth you’ve set."
        solved={solvedA}
        status={`At ${fmt(st.group, 2)} mb/d, stocks end the first year ${yearOneChange(st) >= 0 ? 'up' : 'down'} ${fmt(Math.abs(yearOneChange(st)))} million barrels.`}
        success={`Solved: ${fmt(st.group, 2)} mb/d leaves first-year stocks within ${fmt(Math.abs(yearOneChange(st)))} million barrels of where they began. At the starting growth rates the answer is ${fmt(refFlat, 2)} mb/d — and notice that even then the second year draws, because demand keeps outgrowing the other producers. Holding stocks steady means adjusting output every year; that is what the group’s spare capacity is for.`}
      />

      <H2>Crude stocks and product stocks</H2>
      <P>
        One balance hides two. Crude oil goes into refineries; products — gasoline, diesel, jet fuel — come out and are consumed. Some liquids skip the refinery altogether:
        natural gas liquids and biofuels go straight into the product pool, about {fmt(OTHER_LIQUIDS)} mb/d of it in our model. So refinery runs move barrels from one set
        of tanks to the other. Each spring and autumn, refiners shut units for <b>maintenance</b>, and runs dip. In the next demonstration, crude supply to refiners holds
        at {fmt(CRUDE_SUPPLY)} mb/d and product demand follows the season. Set how deep the maintenance goes, and how much harder refiners run in summer:
      </P>

      <Figure name="Petroleum Balance Sheet · crude and products" scenario={s2}>
        <Legend
          items={[
            { label: 'Refinery runs', color: SUPPLY, kind: 'line' },
            { label: 'Crude supplied to refiners', color: DEMAND, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Refinery runs by month against ${fmt(CRUDE_SUPPLY)} mb/d of crude supply: lowest ${fmt(Math.min(...runs), 1)} mb/d, highest ${fmt(Math.max(...runs), 1)} mb/d.`}
          height={150}
          x={[0, 12]}
          y={[78, 87]}
          xTicks={[0.5, 3.5, 6.5, 9.5]}
          xFormat={(v) => MONTH[Math.floor(v)]}
          yTicks={[78, 81, 84, 87]}
          yFormat={(v) => fmt(v)}
          yLabel="Runs, mb/d"
          series={[
            { points: runs.flatMap((r, m) => [[m, r], [m + 1, r]] as Array<[number, number]>), color: SUPPLY, width: 2.5 },
            { points: [[0, CRUDE_SUPPLY], [12, CRUDE_SUPPLY]], color: DEMAND, width: 1.5, dash: '5 4' },
          ]}
        />
        <Legend
          items={[
            { label: 'Crude stocks', color: CRUDE_LINE, kind: 'line' },
            { label: 'Product stocks', color: PRODUCT_LINE, kind: 'line' },
            { label: 'All oil stocks', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Change in stocks since January, million barrels: by December crude ${signed(end.crudeStock)}, products ${signed(end.productStock)}, all oil ${signed(end.crudeStock + end.productStock)}.`}
          height={200}
          x={[0, 12]}
          y={[c0, c1]}
          xTicks={[0, 3, 6, 9, 12]}
          xFormat={(v) => (v === 12 ? 'Dec' : MONTH[v])}
          yTicks={niceTicks(c0, c1, 4)}
          yFormat={(v) => fmt(v)}
          yLabel="Change in stocks since January, million barrels"
          series={[
            { points: crudePts, color: CRUDE_LINE, width: 2.5 },
            { points: productPts, color: PRODUCT_LINE, width: 2.5 },
            { points: totalPts, color: '#333', width: 1.5, dash: '5 4' },
          ]}
        />
        <Readouts
          items={[
            { label: 'crude stocks by December', value: `${signed(end.crudeStock)} M bbl`, tone: 'orange' },
            { label: 'product stocks by December', value: `${signed(end.productStock)} M bbl`, tone: 'orange' },
            { label: 'all oil stocks', value: `${signed(end.crudeStock + end.productStock, 1)} M bbl` },
          ]}
        />
        <Slider label="Maintenance depth" tone="orange" value={depth} min={0} max={4} step={0.1} onChange={(v) => s2.set({ depth: Math.round(v * 10) / 10 })} display={`${fmt(depth, 1)} mb/d`} />
        <Slider
          label="Extra summer runs"
          tone="orange"
          value={boost}
          min={0}
          max={BOOST_MAX}
          step={BOOST_STEP}
          onChange={(v) => s2.set({ boost: Math.round(v * 10) / 10 })}
          display={`${fmt(boost, 1)} mb/d`}
        />
      </Figure>

      <P>
        With maintenance taking up to 2 mb/d out of runs, watch the two lines move in opposite directions. Between the end of February and the end of May, crude
        stocks build by {fmt(aprilCrude)} million barrels — the oil arrives but the units aren’t taking it — while product stocks fall by {fmt(-aprilProduct)} million as
        demand keeps drawing on them. The summer’s higher demand drains products further. Yet the dashed line, all oil stocks, barely moves: by December the two halves have shifted{' '}
        {fmt(refYear[11].crudeStock)} million barrels between them, and the total has changed by only {signed(refYear[11].crudeStock + refYear[11].productStock, 1)} million,
        the processing gain the idle units didn’t make. Runs don’t create or destroy oil. They decide whether it waits as crude or as products — and so whether crude or
        products are scarce. That distinction will matter in <a href={lessonHref('oil/5.3')}>Lesson 5.3</a>, where product stocks set the price of gasoline and diesel
        relative to crude.
      </P>

      <Challenge
        id="b"
        question="Refiners make up for maintenance by running harder in June, July and August. With the maintenance depth you’ve set, find the extra summer runs, to the nearest 0.1 mb/d, that leave product stocks where they started the year."
        solved={solvedB}
        status={`With ${fmt(boost, 1)} mb/d of extra summer runs, product stocks end the year ${end.productStock >= 0 ? 'up' : 'down'} ${fmt(Math.abs(end.productStock))} million barrels.`}
        success={`Solved: ${fmt(boost, 1)} mb/d. Over three summer months that replaces what maintenance took out of runs in five — and the crude it uses comes out of crude stocks, which end the year ${signed(end.crudeStock)} million barrels from where they began. At the starting depth of 2 mb/d the answer is ${fmt(refFlatBoost, 1)} mb/d, which leaves products ${signed(refFlatYear.productStock, 1)} million barrels from flat.`}
      />

      <P>
        So the balance sets the level of oil prices everywhere, and the split between crude and products sets their relative prices. But the world doesn’t have one oil price.
        It has many, and the two that most others are quoted against — WTI and Brent — don’t move in lockstep. The <a href={lessonHref('oil/5.2')}>next lesson</a> asks why,
        with the network of Chapter 4 put back into the picture.
      </P>
    </LessonPage>
  );
}
