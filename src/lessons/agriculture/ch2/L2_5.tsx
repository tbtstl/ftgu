import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CORN_ON_CORN_EXTRA_N, CORN_ON_CORN_PENALTY, YEARS, historyYields } from '../../../engines/agriculture/farm';
import { BUDGET, LAND_RENT, N_PRICE, PLAN_PRICE, PROPERTY_TAX, perBushelCost } from '../../../model/agriculture/economics';
import { CEDAR_BEND, type Crop } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { buAc, perAcre, perBu } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const RENT = LAND_RENT.prairie;
const CORN_YIELDS = historyYields({ district: 'prairie', crop: 'corn' });
const WHEAT_YIELDS = historyYields({ district: 'prairie', crop: 'wheat' });
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const EXPECTED: Record<Crop, number> = { corn: mean(CORN_YIELDS), wheat: mean(WHEAT_YIELDS) };

export interface AcreBudget {
  lines: Array<{ label: string; cost: number; kind: 'variable' | 'fixed' | 'bushel' | 'land' }>;
  cost: number;
  revenue: number;
  profit: number;
  breakevenPrice: number;
  breakevenYield: number;
}

/** One rented acre: its budget at this price and yield, with fertilizer scaled by `fertMult`. */
export function acreBudget(crop: Crop, price: number, yieldBu: number, fertMult: number, rent: number): AcreBudget {
  const lines: AcreBudget['lines'] = BUDGET[crop].map((l) => ({ label: l.label, cost: l.id === 'fert' ? l.perAcre * fertMult : l.perAcre, kind: l.kind }));
  lines.push({ label: 'Hauling and drying', cost: perBushelCost(crop) * yieldBu, kind: 'bushel' });
  lines.push({ label: 'Land rent', cost: rent, kind: 'land' });
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const perAcreCost = cost - perBushelCost(crop) * yieldBu;
  return {
    lines,
    cost,
    revenue: price * yieldBu,
    profit: price * yieldBu - cost,
    breakevenPrice: perAcreCost / yieldBu + perBushelCost(crop),
    breakevenYield: perAcreCost / (price - perBushelCost(crop)),
  };
}

/** The challenge: the lowest corn price (5¢ steps) at which a rented acre of corn breaks even at its expected yield. */
export function breakevenSolved(crop: Crop, price: number, yieldBu: number, fertMult: number, rent: number): boolean {
  if (crop !== 'corn' || Math.abs(yieldBu - Math.round(EXPECTED.corn)) > 1e-6 || Math.abs(fertMult - 1) > 1e-6 || rent !== RENT) return false;
  return acreBudget('corn', price, yieldBu, 1, rent).profit >= 0 && acreBudget('corn', Math.round((price - 0.05) * 100) / 100, yieldBu, 1, rent).profit < 0;
}

export interface FarmKnobs {
  corn: number;
  wheat: number;
  yieldMult: number;
  fertMult: number;
  rent: number;
}

/**
 * Cedar Bend's whole-farm profit in each simulated season: 1,000 acres of corn (600 after wheat,
 * 400 after corn) and 600 of wheat; 1,000 acres owned (property tax only) and 600 rented.
 * `economic` also charges the owned land what it could earn rented out.
 */
export function farmProfits(k: FarmKnobs, economic = false): number[] {
  const corn = CEDAR_BEND.cornAcres;
  const wheat = CEDAR_BEND.wheatAcres;
  const afterWheat = Math.min(corn, wheat);
  const fert = (crop: Crop) => BUDGET[crop].find((l) => l.id === 'fert')!.perAcre;
  const variable = (crop: Crop) => BUDGET[crop].filter((l) => l.kind === 'variable').reduce((s, l) => s + l.perAcre, 0);
  const fixed = (crop: Crop) => BUDGET[crop].filter((l) => l.kind === 'fixed').reduce((s, l) => s + l.perAcre, 0);
  const variableCost =
    corn * (variable('corn') + (k.fertMult - 1) * fert('corn')) +
    (corn - afterWheat) * CORN_ON_CORN_EXTRA_N * N_PRICE * k.fertMult +
    wheat * (variable('wheat') + (k.fertMult - 1) * fert('wheat'));
  const land = CEDAR_BEND.rentedAcres * k.rent + CEDAR_BEND.ownedAcres * (economic ? k.rent : PROPERTY_TAX);
  const fixedCost = corn * fixed('corn') + wheat * fixed('wheat') + land;
  return YEARS.map((_, i) => {
    const cy = CORN_YIELDS[i] * k.yieldMult;
    const wy = WHEAT_YIELDS[i] * k.yieldMult;
    const cornBu = afterWheat * cy + (corn - afterWheat) * cy * (1 - CORN_ON_CORN_PENALTY);
    const wheatBu = wheat * wy;
    return cornBu * (k.corn - perBushelCost('corn')) + wheatBu * (k.wheat - perBushelCost('wheat')) - variableCost - fixedCost;
  });
}

const BASE_KNOBS: FarmKnobs = { corn: PLAN_PRICE.corn, wheat: PLAN_PRICE.wheat, yieldMult: 1, fertMult: 1, rent: RENT };
const SPIDER = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];

/** Mean farm profit per acre when one driver moves by each step in SPIDER, the others at their base. */
export function spider(base: FarmKnobs): Record<'price' | 'yield' | 'fert' | 'rent', number[]> {
  const run = (k: FarmKnobs) => mean(farmProfits(k)) / CEDAR_BEND.acres;
  return {
    price: SPIDER.map((d) => run({ ...base, corn: base.corn * (1 + d), wheat: base.wheat * (1 + d) })),
    yield: SPIDER.map((d) => run({ ...base, yieldMult: base.yieldMult * (1 + d) })),
    fert: SPIDER.map((d) => run({ ...base, fertMult: base.fertMult * (1 + d) })),
    rent: SPIDER.map((d) => run({ ...base, rent: base.rent * (1 + d) })),
  };
}

const COST_COLOR = { variable: GRAPHIC.red, bushel: '#e9a69f', fixed: GRAPHIC.gray, land: '#b9b2a2' } as const;

function CostStack({ b, crop }: { b: AcreBudget; crop: Crop }) {
  const top = Math.max(b.cost, b.revenue) * 1.08;
  const [, hi] = niceDomain(0, top, 4);
  const y = scale(0, hi, 230, 24);
  let acc = 0;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 260"
      role="img"
      aria-label={`An acre of ${crop}: costs of ${usd(b.cost)} against revenue of ${usd(b.revenue)}, a ${b.profit >= 0 ? 'profit' : 'loss'} of ${usd(Math.abs(b.profit))}.`}
    >
      <text className="ax" x={70} y={14}>
        Dollars per acre
      </text>
      <GridY y={y} ticks={niceTicks(0, hi, 4)} x0={70} x1={420} format={(v) => usd(v)} baseline={0} />
      {b.lines.map((l, i) => {
        const y0 = y(acc);
        acc += l.cost;
        const y1 = y(acc);
        return (
          <g key={i}>
            <rect x={120} y={y1} width={110} height={Math.max(0, y0 - y1)} fill={COST_COLOR[l.kind]} opacity={0.75} stroke="#fcfcfb" strokeWidth={1} />
            {y0 - y1 > 13 && (
              <text className="ax" x={236} y={(y0 + y1) / 2 + 4}>
                {l.label} {usd(l.cost)}
              </text>
            )}
          </g>
        );
      })}
      <rect x={300 + 70} y={y(b.revenue)} width={50} height={230 - y(b.revenue)} fill={CROP_LINE[crop]} opacity={0.85} />
      <text className="lab" x={395} y={y(b.revenue) - 6} textAnchor="middle">
        revenue
      </text>
      <line x1={110} x2={430} y1={y(b.cost)} y2={y(b.cost)} stroke="#333" strokeDasharray="4 3" />
      <text className="lab" x={440} y={y(b.cost) + 4}>
        total cost {usd(b.cost)}
      </text>
      <text className="lab" x={440} y={y(b.revenue) + (Math.abs(y(b.revenue) - y(b.cost)) < 16 ? 18 : 4)} style={{ fill: b.profit >= 0 ? TEXT.green : TEXT.red }}>
        {b.profit >= 0 ? 'profit' : 'loss'} {usd(Math.abs(b.profit))}
      </text>
      <text className="ax ax-m" x={175} y={248}>
        costs
      </text>
      <text className="ax ax-m" x={395} y={248}>
        revenue
      </text>
    </svg>
  );
}

function SpiderChart({ data }: { data: ReturnType<typeof spider> }) {
  const all = [...data.price, ...data.yield, ...data.fert, ...data.rent];
  const [lo, hi] = niceDomain(Math.min(...all), Math.max(...all), 4);
  const x = scale(-0.3, 0.3, 80, 520);
  const y = scale(lo, hi, 210, 24);
  const series: Array<{ key: keyof typeof data; label: string; color: string }> = [
    { key: 'price', label: 'grain prices', color: TEXT.green },
    { key: 'yield', label: 'yields', color: GRAPHIC.gold },
    { key: 'fert', label: 'fertilizer cost', color: GRAPHIC.violet },
    { key: 'rent', label: 'cash rent', color: '#8a8270' },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`Average profit per acre as each driver moves 30% either way: grain prices from ${usd(data.price[0])} to ${usd(data.price[6])}, yields from ${usd(data.yield[0])} to ${usd(data.yield[6])}, fertilizer cost from ${usd(data.fert[0])} to ${usd(data.fert[6])}, cash rent from ${usd(data.rent[0])} to ${usd(data.rent[6])}.`}
    >
      <text className="ax" x={80} y={14}>
        Average profit, $ per acre
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={80} x1={520} format={(v) => usd(v)} baseline={0} />
      {series.map((s) => (
        <g key={s.key}>
          <path d={linePath(SPIDER.map(x), data[s.key].map(y))} fill="none" stroke={s.color} strokeWidth={2.5} />
          <text className="lab" x={526} y={y(data[s.key][6]) + 4} style={{ fill: s.color }}>
            {s.label}
          </text>
        </g>
      ))}
      {SPIDER.map((d) => (
        <text key={d} className="ax ax-m" x={x(d)} y={228}>
          {d > 0 ? '+' : ''}
          {fmt(d * 100)}%
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('acre', { crop: 'corn' as Crop, price: PLAN_PRICE.corn, yieldBu: Math.round(EXPECTED.corn), fertMult: 1, rent: RENT });
  const st = s.state;
  const b = acreBudget(st.crop, st.price, st.yieldBu, st.fertMult, st.rent);
  const solved = breakevenSolved(st.crop, st.price, st.yieldBu, st.fertMult, st.rent);

  const f = useScenario('farm', { corn: PLAN_PRICE.corn, wheat: PLAN_PRICE.wheat });
  const knobs = useMemo(() => ({ ...BASE_KNOBS, corn: f.state.corn, wheat: f.state.wheat }), [f.state]);
  const profits = useMemo(() => farmProfits(knobs), [knobs]);
  const economic = useMemo(() => mean(farmProfits(knobs, true)), [knobs]);
  const spiderData = useMemo(() => spider(knobs), [knobs]);
  const sorted = [...profits].sort((a, c) => a - c);
  const avg = mean(profits);
  const p10 = sorted[Math.floor(0.1 * (sorted.length - 1))];
  const lossShare = profits.filter((p) => p < 0).length / profits.length;

  return (
    <LessonPage id="agriculture/2.5">
      <P>
        Four lessons have made Cedar Bend’s decisions one at a time: what to plant, how much fertilizer, whether to spray, when to harvest. This one adds them up.
        A farm’s accounts are simple to write down — revenue is bushels times price, and costs are what it took to grow them — and the answers they give are often
        uncomfortable. We’ll keep the simulated harvest prices of this chapter, {perBu(PLAN_PRICE.corn)} for corn and {perBu(PLAN_PRICE.wheat)} for wheat.
      </P>
      <P>
        Start with one acre of rented ground on the Black Prairie. Its <K tone="red">costs</K> come in three kinds. The variable costs of{' '}
        <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a> — seed, fertilizer, chemicals, fuel, insurance, interest — are spent only if the crop is planted. The
        hauling and drying scale with the bushels. And the fixed costs are owed regardless: the machinery and buildings, the family’s labor and management, and the
        rent, ${RENT} an acre for prime prairie land. Divide the total by the expected yield and you get the <K tone="green">breakeven price</K>, the price at which
        the acre just pays for itself; divide it by the price instead and you get the breakeven yield. In the next demonstration, choose a crop and move its price,
        yield and costs:
      </P>

      <Figure name="Farm Profit Simulator" scenario={s}>
        <Segmented
          label="Crop"
          value={st.crop}
          onChange={(v) => s.set({ crop: v, price: PLAN_PRICE[v], yieldBu: Math.round(EXPECTED[v]) })}
          options={[
            { value: 'corn', label: 'An acre of corn after wheat' },
            { value: 'wheat', label: 'An acre of wheat after corn' },
          ]}
        />
        <CostStack b={b} crop={st.crop} />
        <Legend
          items={[
            { label: 'Variable costs', color: COST_COLOR.variable },
            { label: 'Hauling and drying', color: COST_COLOR.bushel },
            { label: 'Machinery and labor', color: COST_COLOR.fixed },
            { label: 'Land rent', color: COST_COLOR.land },
          ]}
        />
        <Readouts
          items={[
            { label: 'profit per acre', value: usd(b.profit), tone: b.profit >= 0 ? 'green' : 'red' },
            { label: 'breakeven price', value: perBu(b.breakevenPrice), tone: 'green' },
            { label: 'breakeven yield', value: buAc(b.breakevenYield), tone: st.crop === 'corn' ? 'gold' : 'orange' },
          ]}
        />
        <Slider label="Price" tone="green" value={st.price} min={2.5} max={9} step={0.05} onChange={(v) => s.set({ price: Math.round(v * 20) / 20 })} display={perBu(st.price)} />
        <Slider label="Yield" tone={st.crop === 'corn' ? 'gold' : 'orange'} value={st.yieldBu} min={st.crop === 'corn' ? 80 : 30} max={st.crop === 'corn' ? 260 : 110} onChange={(v) => s.set({ yieldBu: v })} display={buAc(st.yieldBu)} />
        <Slider label="Fertilizer price" tone="violet" value={st.fertMult} min={0.5} max={2} step={0.05} onChange={(v) => s.set({ fertMult: Math.round(v * 20) / 20 })} display={`${fmt(st.fertMult * 100)}% of today’s`} />
        <Slider label="Land rent" value={st.rent} min={100} max={400} step={5} onChange={(v) => s.set({ rent: v })} display={perAcre(st.rent)} />
      </Figure>

      <P>
        At its expected yield of {fmt(Math.round(EXPECTED.corn))} bushels, an acre of corn on rented prairie ground costs about $835 to grow and brings in about $810:
        it loses about $25. Its breakeven price is $4.74, and at $4.60 it would need 182 bushels. Its variable costs, though, are covered with $358 to spare, and
        that difference matters. A farmer who has already signed the lease and bought the planter loses less by planting than by leaving the field empty, so in a
        single bad year the crop goes in anyway. Only over years, when leases come up for renewal and machinery wears out, do the fixed costs become choices too.
        Wheat looks far worse on this land — 67 bushels worth $402 against $554 of costs, a loss of $152 an acre — but recall from{' '}
        <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a> that wheat earns part of its keep in the next year’s corn, which yields 10% more after it.
      </P>

      <Challenge
        id="a"
        question="Keep the acre of corn at its expected yield, today’s fertilizer price and the $265 rent. What is the lowest corn price, in 5-cent steps, at which it breaks even?"
        solved={solved}
        status={
          st.crop !== 'corn'
            ? 'Choose the acre of corn.'
            : st.yieldBu !== Math.round(EXPECTED.corn) || Math.abs(st.fertMult - 1) > 1e-6 || st.rent !== RENT
              ? `Set the yield back to ${fmt(Math.round(EXPECTED.corn))} bushels, fertilizer to 100% and rent to $265.`
              : `At ${perBu(st.price)}, the acre ${b.profit >= 0 ? 'makes' : 'loses'} ${usd(Math.abs(b.profit))}.`
        }
        success={`Solved: at ${perBu(st.price)} the acre makes ${usd(b.profit)}; five cents less and it loses money. Every grain farm carries a number like this in its head, and it’s the first thing that comes to mind when the price moves: above it, the year is paying; below it, the farm is spending its savings or its equity.`}
      />

      <H2>A whole farm, across many seasons</H2>
      <P>
        Cedar Bend isn’t a single rented acre. The family owns 1,000 of its acres and pays only property tax on them, about ${PROPERTY_TAX} an acre, and rents the
        other 600; it grows 1,000 acres of corn, 400 of them after corn, and 600 of wheat. And it doesn’t farm the expected yield: it farms whatever the season
        brings. In the next demonstration the histogram counts Cedar Bend’s whole-farm profit in each of the 200 simulated seasons, at fixed prices; the lower chart
        shows how the average moves when one driver at a time changes by up to 30%:
      </P>

      <Figure name="Farm Profit Simulator · 200 seasons" scenario={f}>
        <HistogramChart
          values={profits}
          lo={-600000}
          hi={600000}
          bins={24}
          color={GRAPHIC.green}
          xTicks={[-600000, -300000, 0, 300000, 600000]}
          xFormat={(v) => (v === 0 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`)}
          xLabel="Cedar Bend’s profit in a season"
          marks={[
            { x: 0, label: 'break even', color: '#777', dash: '3 3' },
            { x: avg, label: `average ${usd(avg)}`, color: TEXT.green, row: 1 },
          ]}
          highlight={(b0) => b0 >= 0}
          ariaLabel={`Cedar Bend’s whole-farm profit across 200 simulated seasons at ${perBu(f.state.corn)} corn and ${perBu(f.state.wheat)} wheat: an average of ${usd(avg)}, ${usd(p10)} in a 1-in-10 bad season, and a loss in ${fmt(lossShare * 100)}% of seasons.`}
        />
        <Readouts
          items={[
            { label: 'average profit', value: usd(avg), tone: avg >= 0 ? 'green' : 'red' },
            { label: '1-in-10 bad season', value: usd(p10), tone: p10 >= 0 ? 'green' : 'red' },
            { label: 'seasons with a loss', value: `${fmt(lossShare * 100)}%`, tone: 'red' },
            { label: 'charging the owned land its rent', value: usd(economic), tone: economic >= 0 ? 'green' : 'red' },
          ]}
        />
        <SpiderChart data={spiderData} />
        <Slider label="Corn price" tone="green" value={f.state.corn} min={3} max={7} step={0.1} onChange={(v) => f.set({ corn: Math.round(v * 10) / 10 })} display={perBu(f.state.corn)} />
        <Slider label="Wheat price" tone="green" value={f.state.wheat} min={4} max={9} step={0.1} onChange={(v) => f.set({ wheat: Math.round(v * 10) / 10 })} display={perBu(f.state.wheat)} />
      </Figure>

      <P>
        At the plan prices Cedar Bend makes $73,649 in an average season, about $46 an acre. But the average hides a wide spread: a quarter of the seasons lose
        money, a 1-in-10 bad one loses $85,053, and the worst of the 200 loses $370,359, while the best makes $315,364. And that average profit depends on owning
        most of the land. Charge the family’s own 1,000 acres the $265 they could earn renting them to a neighbor — the land’s <b>opportunity cost</b> — and the
        average becomes a loss of $156,351. The accounts say the farm pays; the economics say the family would do better, on average, renting its land out. Land
        rents and land prices tend to rise in years when crops pay well, so good years tend to end up, eventually, in the landowner’s pocket.
      </P>
      <P>
        Farmers live with that spread in several ways. The crop insurance line in the budget buys a guarantee: in the United States most corn and wheat acres carry
        federally subsidized policies that pay when a farm’s yield, or its revenue, falls below a chosen share of its usual level. Savings carried from good years
        cover some of the rest, and lenders extend operating credit against the next crop. None of these makes a bad season good. They make it survivable, so that
        the farm is still there to plant the next one.
      </P>
      <P>
        The lower chart shows which numbers matter. A 30% swing in grain prices moves the average profit from $145 an acre of loss to $237 of profit; the same
        swing in yields, from a $137 loss to $229 of profit. A 30% change in fertilizer prices moves it by only about $36, and in cash rent by about $30. Prices and
        yields dominate, and in this demonstration they move separately. In the real valley they don’t: when its harvest is short, grain gets scarce and the price
        tends to rise, which softens a bad year for the farmer. That link between yields and prices is where Chapter 5 begins.
      </P>

      <P>
        So how much food a region produces economically comes down to the two halves of this chapter: the biology of Chapter 1, which sets what each acre can yield,
        and the prices and costs that decide which acres get planted, with what, and how intensively. Both are uncertain, and the biggest single source of that
        uncertainty is the weather. In <FigRef to="Farm Profit Simulator · 200 seasons">the farm’s seasons</FigRef> it was hidden inside a histogram. Chapter 3 brings
        it into the open, starting with the map: why some places suit corn, others wheat, and others neither.
      </P>
    </LessonPage>
  );
}
