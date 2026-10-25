import { useMemo, useState } from 'react';
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
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { SEASONAL_COSTS, normalMonthlyTemps, normalPlan, seasonalPlan, simulateYear, type SeasonalPlan, type YearDay } from '../../../engines/gas/market';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { COAL_SWITCH_BLOCKS, LNG_VALUE, demandBlocks } from '../../../model/gas/demand';
import { GAS_MONTHS, GAS_MONTH_START, GAS_YEAR_DAYS, WINTER_START, gasDayLabel, hdd, normalTemp, weatherYear, type WeatherYear } from '../../../model/gas/weather';
import { BASINS, BAYPORT_LNG_FEEDGAS_BCFD, PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The seasonal plan under the reader's settings.

/** Working gas capacity of both fields together, Bcf. */
export const STORAGE_BCF = STORAGE_SPECS.saltflat.workingBcf + STORAGE_SPECS.hollowcreek.workingBcf;
/** The first demonstration starts at the world's storage, a normal winter and the full LNG terminal. */
export const SEASON_DEFAULTS = { scale: 1, shift: 0, lng: BAYPORT_LNG_FEEDGAS_BCFD };
export type SeasonState = typeof SEASON_DEFAULTS;
const SCALE_STEP = 0.01;
const NORMAL_TEMPS = normalMonthlyTemps();
/** Carrying gas from October into November: putting it in and taking it out, $/MMBtu. */
export const ROUND_TRIP = SEASONAL_COSTS.injectCost + SEASONAL_COSTS.withdrawCost;

const round2 = (x: number) => Math.round(x * 100) / 100;

const planCache = new Map<string, SeasonalPlan>();
/** The seasonal plan for a storage size (× the world's), a winter warmer or colder than normal (°F) and an LNG export rate, remembered. */
export function seasonPlan(st: SeasonState): SeasonalPlan {
  const key = `${round2(st.scale)}|${st.shift}|${round2(st.lng)}`;
  let p = planCache.get(key);
  if (!p) {
    const monthlyTemp = NORMAL_TEMPS.map((t, m) => (m >= 7 ? t + st.shift : t));
    p = seasonalPlan({ storageScale: round2(st.scale), monthlyTemp, demand: { lngBcfd: st.lng } });
    if (planCache.size > 300) planCache.clear();
    planCache.set(key, p);
  }
  return p;
}

export interface SeasonSummary {
  /** Average Calder price, April–October and November–March, $/MMBtu. */
  summer: number;
  winter: number;
  /** November's price minus October's. */
  step: number;
  /** The part of that step beyond the cost of carrying gas from one to the other: storage's scarcity rent. */
  rent: number;
  /** Most working gas held, and the capacity, Bcf. */
  peak: number;
  capacity: number;
  /** True if storage fills. */
  full: boolean;
}

export function seasonSummary(p: SeasonalPlan): SeasonSummary {
  const c = p.price.calder;
  const capacity = p.capacity.saltflat + p.capacity.hollowcreek;
  const peak = Math.max(...p.totalInventory);
  const step = c[7] - c[6];
  return {
    summer: c.slice(0, 7).reduce((a, b) => a + b, 0) / 7,
    winter: c.slice(7).reduce((a, b) => a + b, 0) / 5,
    step,
    rent: Math.max(0, step - ROUND_TRIP),
    peak,
    capacity,
    full: peak >= capacity - 1e-6,
  };
}

/** The smallest storage (as a multiple of the world's, on the slider's 0.01 grid) that no longer fills in a normal year. */
export function enoughStorageScale(): number {
  for (let i = 100; i <= 200; i++) {
    const s = i / 100;
    if (!seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, scale: s })).full) return s;
  }
  return NaN;
}

/**
 * The challenge: with a normal winter and the full LNG terminal, the least storage at which it no
 * longer fills, so that November costs only the carrying cost more than October.
 */
export function enoughStorageSolved(st: SeasonState): boolean {
  if (st.shift !== SEASON_DEFAULTS.shift || Math.abs(st.lng - SEASON_DEFAULTS.lng) > 1e-9) return false;
  const here = seasonSummary(seasonPlan(st));
  const less = seasonSummary(seasonPlan({ ...st, scale: round2(st.scale - SCALE_STEP) }));
  return !here.full && Math.abs(here.step - ROUND_TRIP) < 1e-6 && less.full;
}

// Numbers the prose quotes.
const BASE = normalPlan();
const BASE_SUM = seasonSummary(BASE);
const BASE_RENT_TOTAL = BASE_SUM.rent * STORAGE_BCF * 1e6 * MMBTU_PER_MCF;
const ENOUGH = enoughStorageScale();
const SMALL = seasonPlan({ ...SEASON_DEFAULTS, scale: 0.75 });
const SMALL_SUM = seasonSummary(SMALL);
const BIG = seasonPlan({ ...SEASON_DEFAULTS, scale: 1.5 });
const BIG_SUM = seasonSummary(BIG);
const COLDER = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, shift: -1 }));
const WARMER = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, shift: 1 }));
const LNG_LOW = seasonSummary(seasonPlan({ ...SEASON_DEFAULTS, lng: 1.1 }));
const NORTHLINE_COST = PIPELINE['calder-metro'].variableCost;
const GULFWARD_COST = PIPELINE['calder-bayport'].variableCost;
const MAY_METRO = BASE.price.metro[1];
const NOV_METRO = BASE.price.metro[7];
const SWITCH_VALUES = COAL_SWITCH_BLOCKS.map((b) => b.value);
const PRODUCTION = BASINS.reduce((a, b) => a + b.productionBcfd, 0);
const homesAt = (tempF: number) => demandBlocks(tempF).find((b) => b.id === 'metro-homes')!.cap;
/** Metro's homes on a normal July day and a normal January day, Bcf/d. */
const HOMES_JUL = homesAt(NORMAL_TEMPS[3]);
const HOMES_JAN = homesAt(NORMAL_TEMPS[9]);
let NORMAL_WINTER_HDD = 0;
for (let d = WINTER_START; d < GAS_YEAR_DAYS; d++) NORMAL_WINTER_HDD += hdd(normalTemp(d));

// ---------------------------------------------------------------------------
// A real winter: one simulated year of weather against a year with every day at normal.

export type WinterId = 'normal' | 'mild' | 'typical' | 'cold';
/**
 * Weather seeds for the three simulated winters: the mild and typical winters of Lessons 4.1 and 4.2
 * (9% fewer heating degree days than normal, and about normal), and a cold one with 14% more, which
 * Lesson 4.5 reuses.
 */
export const WINTER_SEEDS: Record<Exclude<WinterId, 'normal'>, number> = { mild: 2, typical: 3, cold: 29 };
const WINTER_LABEL: Record<WinterId, string> = { normal: 'Every day normal', mild: 'A mild winter', typical: 'A typical winter', cold: 'A cold winter' };

const NORMAL_WEATHER: WeatherYear = (() => {
  const temp = Array.from({ length: GAS_YEAR_DAYS }, (_, d) => normalTemp(d));
  return { temp, normal: temp.slice(), hdd: temp.map(hdd), cdd: temp.map((t) => Math.max(0, t - 65)) };
})();

const yearCache = new Map<WinterId, { weather: WeatherYear; days: YearDay[] }>();
/** The simulated market through a gas year of the chosen weather (cached). */
export function winterYear(id: WinterId) {
  let y = yearCache.get(id);
  if (!y) {
    const weather = id === 'normal' ? NORMAL_WEATHER : weatherYear(WINTER_SEEDS[id]);
    y = { weather, days: simulateYear({ weather }) };
    yearCache.set(id, y);
  }
  return y;
}

export interface WinterStats {
  /** Heating degree days, November–March. */
  winterHdd: number;
  /** Working gas on March 31, Bcf. */
  mar31: number;
  /** Average Calder price, November–March. */
  winterPrice: number;
  /** Highest daily Calder price, and its day. */
  maxPrice: number;
  maxDay: number;
}

export function winterStats(id: WinterId): WinterStats {
  const { weather, days } = winterYear(id);
  const win = days.slice(WINTER_START);
  const max = win.reduce((a, d) => (d.price.calder > a.price.calder ? d : a));
  return {
    winterHdd: weather.hdd.slice(WINTER_START).reduce((a, b) => a + b, 0),
    mar31: days[GAS_YEAR_DAYS - 1].storage.saltflat + days[GAS_YEAR_DAYS - 1].storage.hollowcreek,
    winterPrice: win.reduce((a, d) => a + d.price.calder, 0) / win.length,
    maxPrice: max.price.calder,
    maxDay: max.day,
  };
}

const W_NORMAL = winterStats('normal');
const W_MILD = winterStats('mild');
const W_TYPICAL = winterStats('typical');
const W_COLD = winterStats('cold');

// ---------------------------------------------------------------------------
// Charts.

const MONTH_TICKS = Array.from({ length: 12 }, (_, m) => m + 0.5);
const monthLabel = (v: number) => GAS_MONTHS[Math.floor(v)] ?? '';
const PRICE = GRAPHIC.green;
const STORED = GRAPHIC.gold;
const HC_FILL = tint(GRAPHIC.gold, 0.75);
const SF_FILL = tint(GRAPHIC.gold, 0.35);
const DAY_TICKS = GAS_MONTH_START.map((s) => s);
const dayTick = (v: number) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? '';

export default function Lesson() {
  const s = useScenario('season', SEASON_DEFAULTS);
  const st = s.state;
  const plan = useMemo(() => seasonPlan(st), [st]);
  const sum = seasonSummary(plan);
  const c = plan.price.calder;
  const solved = enoughStorageSolved(st);
  const capBcf = STORAGE_BCF * st.scale;
  const xs13 = Array.from({ length: 13 }, (_, i) => i);
  const priceYs = [...c, c[11]];
  const hc = plan.inventory.hollowcreek;
  const total = plan.totalInventory;

  const w = useScenario('winter', { winter: 'typical' as WinterId });
  const wid = w.state.winter;
  const yr = useMemo(() => winterYear(wid), [wid]);
  const ref = winterYear('normal');
  const ws = useMemo(() => winterStats(wid), [wid]);
  const [cursor, setCursor] = useState(290);
  const day = Math.max(0, Math.min(GAS_YEAR_DAYS - 1, Math.round(cursor)));
  const dxs = yr.days.map((d) => d.day + 0.5);
  const invOf = (d: YearDay) => d.storage.saltflat + d.storage.hollowcreek;
  const now = yr.days[day];
  const refNow = ref.days[day];

  const status =
    st.shift !== 0 || Math.abs(st.lng - SEASON_DEFAULTS.lng) > 1e-9
      ? 'Set the winter back to normal and the LNG terminal back to its full 1.2 Bcf/d first.'
      : sum.full
        ? `At ${fmt(capBcf, 1)} Bcf, storage still fills by November.`
        : `At ${fmt(capBcf, 1)} Bcf, storage never fills. Is that the least that doesn’t?`;

  return (
    <LessonPage id="gas/4.4">
      <P>
        <a href={lessonHref('gas/4.3')}>The previous lesson</a> priced the right to move gas through space: firm capacity on Northline earns the gap between
        Metro’s and Calder’s prices, beyond the cost of the trip, on the days the pipe is full. Storage moves gas through time instead. Whoever owns room in Hollow
        Creek or Salt Flat can buy gas in one month and sell it in a later one, so the value of that room shows up in how much more gas costs in one season than in
        another.
      </P>
      <P>
        The region needs that room. Its two basins produce a steady {fmt(PRODUCTION, 1)} Bcf/d all year, but its demand swings with the{' '}
        <K tone="teal">temperature</K>: in a normal year Metro’s homes burn {fmt(HOMES_JUL, 2)} Bcf/d in July and {fmt(HOMES_JAN, 2)} in January, about{' '}
        {fmt(HOMES_JAN / HOMES_JUL)} times as much. <a href={lessonHref('gas/3.4')}>Lesson 3.4</a> showed what storage can do physically; here we ask how
        much gas the market puts away each summer, and what that does to <K c="price">prices</K> month by month.
      </P>
      <P>
        To find out, we’ll solve a whole year at once. <a href={lessonHref('gas/3.2')}>Lesson 3.2</a> routed gas between places with a network solver; the same
        solver can route it between months. Make each place in each month a node, and treat each storage field as a set of pipes that carry gas from one month to
        the next, with the field’s size as their capacity and its injection and withdrawal limits on the way in and out. Moving gas through time costs money too: in our model {gp(SEASONAL_COSTS.injectCost)} per MMBtu to put it in, {gp(SEASONAL_COSTS.withdrawCost)} to take it out (fuel and
        fees), and {gp(SEASONAL_COSTS.holdCostPerMonth)} for each month it sits there, mostly the interest on the money tied up in it. The solver finds the year’s
        cheapest pattern of production, storage and use, and every place in every month gets a price — the <b>seasonal plan</b>. All prices are simulated.
      </P>
      <P>
        In the next demonstration, the upper chart is the plan’s price at Calder Hub month by month, April to March, with the withdrawal season shaded; the lower
        chart is the gas in the two storage fields at the start of each month. Under the charts, November’s price minus October’s splits into the cost of carrying
        gas between them and whatever is left over, storage’s scarcity rent. Change the size of the region’s storage, how cold
        the coming winter is expected to be, and how much gas Bayport’s LNG terminal takes:
      </P>

      <Figure name="Seasonal Gas Market" scenario={s}>
        <XYChart
          xDomain={[0, 12]}
          yDomain={[0, 7]}
          xTicks={MONTH_TICKS}
          xFormat={monthLabel}
          yTicks={[0, 1, 2, 3, 4, 5, 6, 7]}
          yFormat={(v) => `$${v}`}
          yLabel="Price at Calder Hub, $/MMBtu"
          height={210}
          bands={[{ from: 7, to: 12, color: 'rgba(42, 157, 144, 0.08)', label: 'withdrawal season' }]}
          series={[{ xs: xs13, ys: priceYs, color: PRICE, kind: 'step', width: 2.5 }]}
          ariaLabel={`The seasonal plan’s monthly price at Calder Hub with ${fmt(capBcf, 1)} Bcf of storage: ${GAS_MONTHS.map((m, i) => `${m} ${gp(c[i])}`).join(', ')}. November is ${gp(sum.step)} above October.`}
        >
          {(x, y) => {
            const top = Math.min(y(c[7]), y(c[6]));
            const bot = Math.max(y(c[7]), y(c[6]));
            return bot - top > 14 ? (
              <g>
                <line x1={x(7) - 8} x2={x(7) - 8} y1={top} y2={bot} stroke={TEXT.green} strokeWidth={1.5} />
                <line x1={x(7) - 12} x2={x(7) - 4} y1={top} y2={top} stroke={TEXT.green} strokeWidth={1.5} />
                <line x1={x(7) - 12} x2={x(7) - 4} y1={bot} y2={bot} stroke={TEXT.green} strokeWidth={1.5} />
                <text x={x(7) - 14} y={(top + bot) / 2 + 4} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
                  {sum.step >= 0 ? '+' : '−'}
                  {gp(Math.abs(sum.step))}
                </text>
              </g>
            ) : null;
          }}
        </XYChart>
        <XYChart
          xDomain={[0, 12]}
          yDomain={[0, 240]}
          xTicks={xs13.slice(0, 12)}
          xFormat={(v) => `${GAS_MONTHS[v]} 1`}
          yTicks={[0, 60, 120, 180, 240]}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in storage, Bcf"
          height={190}
          series={[
            { xs: xs13, ys: total, color: SF_FILL, kind: 'area', opacity: 1 },
            { xs: xs13, ys: hc, color: HC_FILL, kind: 'area', opacity: 1 },
            { xs: xs13, ys: total, color: STORED, width: 2 },
          ]}
          hLines={[{ at: sum.capacity, color: '#555', dash: '5 4', label: `capacity ${fmt(sum.capacity, 1)} Bcf`, labelAt: 'start' }]}
          markers={[{ x: 7, y: total[7], color: TEXT.gold, r: 5, label: `${fmt(total[7], 1)} Bcf on Nov 1`, labelPos: 'below' }]}
          ariaLabel={`Working gas in storage at the start of each month: ${fmt(total[0], 1)} Bcf on April 1, ${fmt(total[7], 1)} on November 1, against a capacity of ${fmt(sum.capacity, 1)} Bcf.`}
        />
        <Legend
          items={[
            { label: 'Hollow Creek', color: HC_FILL },
            { label: 'Salt Flat', color: SF_FILL },
            { label: 'Calder price', color: PRICE, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'average price, Apr–Oct', value: gp(sum.summer), tone: 'green' },
            { label: 'average price, Nov–Mar', value: gp(sum.winter), tone: 'green' },
          ]}
        />
        <Slider
          label="Storage capacity"
          tone="gold"
          value={st.scale}
          min={0.5}
          max={1.5}
          step={SCALE_STEP}
          onChange={(v) => s.set({ scale: round2(v) })}
          display={`${fmt(capBcf, 1)} Bcf · ${pct(st.scale)} of today’s`}
        />
        <Slider
          label="Expected winter"
          tone="teal"
          value={st.shift}
          min={-3}
          max={3}
          step={0.5}
          onChange={(v) => s.set({ shift: v })}
          display={st.shift === 0 ? 'normal' : `${fmt(Math.abs(st.shift), 1)} °F ${st.shift < 0 ? 'colder' : 'warmer'} than normal`}
        />
        <Slider label="LNG exports" tone="orange" value={st.lng} min={1} max={1.4} step={0.05} onChange={(v) => s.set({ lng: round2(v) })} display={`${fmt(st.lng, 2)} Bcf/d`} />
        <Eq label={`November minus October: ${gp(sum.step)}, which is the ${gp(ROUND_TRIP)} cost of carrying gas plus a scarcity rent of ${gp(sum.rent)}`}>
          <K c="price">
            {gp(c[7])} − {gp(c[6])}
          </K>
          <Op>=</Op>
          <span>{gp(ROUND_TRIP)} carrying</span>
          <Op>+</Op>
          <K c="price">{gp(sum.rent)} rent</K>
        </Eq>
      </Figure>

      <P>
        At the starting settings the plan stores gas all summer and draws it down all winter. Working gas rises from {fmt(BASE.totalInventory[0], 1)} Bcf on April 1
        to {fmt(BASE.totalInventory[7], 1)} on November 1 — both fields full — and falls back to {fmt(BASE.totalInventory[12], 1)} by the end of March. The price
        follows a pattern with two parts. Within each season it climbs by {gp(SEASONAL_COSTS.holdCostPerMonth)} a month, from {gp(BASE.price.calder[1])} in May to{' '}
        {gp(BASE.price.calder[6])} in October and from {gp(BASE.price.calder[7])} in November to {gp(BASE.price.calder[11])} in March. (April, when the region still
        heats a little and storage is still giving up gas, comes out a few cents higher, at {gp(BASE.price.calder[0])}.) Between the seasons the price jumps by{' '}
        {gp(BASE_SUM.step)}.
      </P>

      <H2>The cost of carrying gas</H2>
      <P>
        The climb within a season is arbitrage at work. Suppose July’s gas cost more than {gp(SEASONAL_COSTS.holdCostPerMonth)} above June’s. Anyone with room in
        storage could buy June gas, hold it a month and sell it in July for a profit, and as they did, June’s price would rise and July’s fall. While storage has
        room, that trade continues until consecutive months differ by exactly the <b>cost of carry</b>, and no more. The months are tied together the way
        Calder and Metro were tied by Northline in <a href={lessonHref('gas/3.2')}>Lesson 3.2</a>: while the link has room, prices differ by the cost of using it.
      </P>
      <P>
        The jump between the seasons is what happens when the link fills. Carrying gas from October into November costs {gp(ROUND_TRIP)}, putting it in and
        taking it out. November costs {gp(BASE_SUM.step)} more than October, so {gp(BASE_SUM.rent)} of the gap is not a cost at all. It is a{' '}
        <K c="price">scarcity rent</K>: storage is full, nobody can add another MMBtu to it, and the winter’s gas is dearer than the summer’s by more than the cost
        of moving it between them. That rent is what a unit of storage space is worth this year. Across the region’s {fmt(STORAGE_BCF)} Bcf of working gas it comes
        to about {money(BASE_RENT_TOTAL)} a year — what the owners of Hollow Creek and Salt Flat earn for having room when room is short.
      </P>
      <P>
        The price levels come from the demand curve of <a href={lessonHref('gas/4.1')}>Lesson 4.1</a>. Metro’s price is {gp(MAY_METRO)} in May and{' '}
        {gp(NOV_METRO)} in November (Calder sits {gp(NORTHLINE_COST)} below, one trip up Northline), each the value of one of Metro’s coal-to-gas switching blocks:
        once storage has done what it can, what’s left in each season is balanced by power plants choosing between coal and gas. Their blocks, valued from{' '}
        {gp(Math.min(...SWITCH_VALUES))} to {gp(Math.max(...SWITCH_VALUES))}, are why the plan’s prices move in steps.
      </P>

      <Challenge
        id="a"
        question="Predict first: if storage were big enough never to fill, how much more would November cost than October? Then, with the winter normal and the LNG terminal at 1.2 Bcf/d, find the least storage capacity, on the slider’s steps, at which storage no longer fills."
        solved={solved}
        status={status}
        success={`Solved: ${fmt(STORAGE_BCF * ENOUGH, 1)} Bcf, ${pct(ENOUGH)} of today’s storage. With room to spare, November costs just the ${gp(ROUND_TRIP)} of carrying gas more than October, and the rent is zero: anyone could carry October gas into November until the gap fell to the cost of doing it. One step smaller and storage fills again, and the scarcity rent comes back. Past this point extra storage earns its owners nothing beyond its costs, and the plan’s prices stop changing. Bigger fields still hold a little more gas at their peak, because in our model their injection and withdrawal rates grow with their size, but they never fill.`}
      />

      <H2>More storage, less storage</H2>
      <P>
        Shrink storage to three-quarters of its size, {fmt(STORAGE_BCF * 0.75, 1)} Bcf. The summer price falls to {gp(SMALL.price.calder[1])} in May: with less room
        for summer gas, the surplus has nowhere to go, and the price drops until Sandhill, the dearer field, shuts some of its wells in (Sandhill’s price sinks to its{' '}
        {gp(SMALL.price.sandhill[1])} cost). The winter price rises to {gp(SMALL.price.calder[7])}, because less summer gas is waiting for it. The scarcity rent
        grows to {gp(SMALL_SUM.rent)}. Now grow storage to half again its size: the rent vanishes, summer averages {gp(BIG_SUM.summer)} and winter{' '}
        {gp(BIG_SUM.winter)}. More storage <i>raises</i> the summer price, since storage owners are extra buyers of summer gas, and lowers the winter price, since
        they are extra sellers in winter. It narrows the seasons toward each other until only the cost of carry is left between them.
      </P>
      <P>
        The expected winter matters as much. With storage full, a winter forecast just 1 °F colder than normal lifts the plan’s winter price to an average of{' '}
        {gp(COLDER.winter)}, and one 1 °F warmer drops it to {gp(WARMER.winter)}: once storage can’t hold any more summer gas, every extra MMBtu a colder winter needs
        has to come from cutting back the next block of winter demand. Demand from outside the region works the same way: run the LNG terminal at 1.1 Bcf/d
        instead of 1.2 and the summer price falls to an average of {gp(LNG_LOW.summer)}. Our model exaggerates these swings: its wells can’t produce more in a
        cold winter, and the demand that gives way comes in thin {fmt(COAL_SWITCH_BLOCKS[0].bcfd, 2)} Bcf/d blocks. Real markets, with many more producers and
        users who can each adjust a little, move less — but the same way, which is why gas traders watch long-range weather forecasts so closely.
      </P>

      <H2>A real winter</H2>
      <P>
        A plan is drawn up before the winter happens. Each storage operator values its gas at the plan’s price for the time of year — its water value, as in{' '}
        <a href={lessonHref('gas/4.2')}>Lesson 4.2</a> — and raises that value when a cold spell has drawn the field down faster than planned, since what’s left
        must last the rest of the winter. A field behind plan withdraws only at higher prices, and the whole market’s price rises with it.
      </P>
      <P>
        To say how cold a winter was, the gas industry counts <K tone="teal">heating degree days</K>. Each day adds one for every degree its mean temperature
        falls below 65 °F, roughly where buildings start to need heat, so a day averaging 25 °F adds 40. Summed from November through March, a normal winter in our
        region comes to {fmt(NORMAL_WINTER_HDD)}. In the next demonstration the market runs day by day through a year of
        simulated weather. The dashed lines are a year with every day exactly normal; the solid lines are the year you choose. Drag across a chart to read any
        day:
      </P>

      <Figure name="Seasonal Gas Market · a real winter" scenario={w}>
        <Segmented
          label="Weather"
          value={wid}
          onChange={(v) => w.set({ winter: v })}
          options={(['normal', 'mild', 'typical', 'cold'] as WinterId[]).map((id) => ({ value: id, label: WINTER_LABEL[id] }))}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, 160]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 40, 80, 120, 160]}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in storage, Bcf"
          height={180}
          bands={[{ from: WINTER_START, to: GAS_YEAR_DAYS, color: 'rgba(42, 157, 144, 0.08)' }]}
          series={[
            { xs: dxs, ys: ref.days.map(invOf), color: '#8a8a8a', width: 1.5, dash: '5 4' },
            { xs: dxs, ys: yr.days.map(invOf), color: STORED, width: 2.5 },
          ]}
          markers={[{ x: day + 0.5, y: invOf(now), color: TEXT.gold, r: 5 }]}
          cursor={day + 0.5}
          onScrub={setCursor}
          scrubLabel="Day of the gas year"
          ariaLabel={`Working gas through the gas year, ${WINTER_LABEL[wid].toLowerCase()}, against a year of normal weather: ${fmt(invOf(yr.days[WINTER_START - 1]), 1)} Bcf on November 1 and ${fmt(ws.mar31, 1)} on March 31, against ${fmt(W_NORMAL.mar31, 1)} in the normal year.`}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, 8]}
          xTicks={DAY_TICKS}
          xFormat={dayTick}
          yTicks={[0, 2, 4, 6, 8]}
          yFormat={(v) => `$${v}`}
          yLabel="Daily price at Calder Hub, $/MMBtu"
          height={170}
          bands={[{ from: WINTER_START, to: GAS_YEAR_DAYS, color: 'rgba(42, 157, 144, 0.08)' }]}
          series={[
            { xs: dxs, ys: ref.days.map((d) => d.price.calder), color: '#8a8a8a', width: 1.5, dash: '5 4' },
            { xs: dxs, ys: yr.days.map((d) => d.price.calder), color: PRICE, width: 2 },
          ]}
          markers={[{ x: day + 0.5, y: now.price.calder, color: TEXT.green, r: 5 }]}
          cursor={day + 0.5}
          onScrub={setCursor}
          scrubLabel="Day of the gas year"
          ariaLabel={`Daily price at Calder Hub, ${WINTER_LABEL[wid].toLowerCase()}: winter average ${gp(ws.winterPrice)}, highest ${gp(ws.maxPrice)} on ${gasDayLabel(ws.maxDay)}; a normal year averages ${gp(W_NORMAL.winterPrice)} over the winter.`}
        />
        <Legend
          items={[
            { label: 'This year', color: '#333', kind: 'line' },
            { label: 'Every day normal', color: '#8a8a8a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'heating degree days, Nov–Mar', value: `${fmt(ws.winterHdd)} · ${ws.winterHdd >= NORMAL_WINTER_HDD ? '+' : '−'}${pct(Math.abs(ws.winterHdd / NORMAL_WINTER_HDD - 1))}`, tone: 'teal' },
            { label: 'working gas on March 31', value: `${fmt(ws.mar31, 1)} Bcf`, tone: 'gold' },
            { label: 'average price, Nov–Mar', value: gp(ws.winterPrice), tone: 'green' },
            { label: 'highest daily price', value: `${gp(ws.maxPrice)} · ${gasDayLabel(ws.maxDay)}`, tone: 'green' },
          ]}
        />
        <Caption>
          {gasDayLabel(day)}: {fmt(now.tempF)} °F against a normal {fmt(normalTemp(day))} °F. Storage holds {fmt(invOf(now), 1)} Bcf, {fmt(Math.abs(invOf(now) - invOf(refNow)), 1)} Bcf{' '}
          {invOf(now) >= invOf(refNow) ? 'more' : 'less'} than in the normal year, and gas at Calder costs {gp(now.price.calder)}.
        </Caption>
      </Figure>

      <P>
        Even with every day normal, storage doesn’t quite follow the plan: the fields can’t take gas as fast near the top as the plan’s monthly averages assume
        (the ratchets of Lesson 3.4), so they enter the winter a little short, and the winter averages {gp(W_NORMAL.winterPrice)}. Now choose the cold winter, with {pct(W_COLD.winterHdd / NORMAL_WINTER_HDD - 1)} more heating degree days than normal. Storage falls behind
        early, the operators raise their water values, and the winter averages {gp(W_COLD.winterPrice)}, with days as high as {gp(W_COLD.maxPrice)} — the Calder price
        at which Bayport’s LNG cargoes stop paying ({gp(LNG_VALUE)} at Bayport, less the {gp(GULFWARD_COST)} trip down Gulfward), so the terminal takes less gas. Even so, it ends March with only {fmt(W_COLD.mar31, 1)} Bcf, against{' '}
        {fmt(W_NORMAL.mar31, 1)} in the normal year. The mild winter of Lessons 4.1 and 4.2, with {pct(1 - W_MILD.winterHdd / NORMAL_WINTER_HDD)} fewer heating
        degree days than normal, ends with {fmt(W_MILD.mar31, 1)} Bcf left and averages {gp(W_MILD.winterPrice)}.
      </P>
      <P>
        The typical winter of those lessons is the instructive one. Its {fmt(W_TYPICAL.winterHdd)} heating degree days are slightly fewer than the normal {fmt(NORMAL_WINTER_HDD)}, yet
        it averages {gp(W_TYPICAL.winterPrice)}, not {gp(W_NORMAL.winterPrice)}. Its cold spells and mild spells roughly cancel in the degree days, but not in the price:
        a cold spell drains storage, raises water values and pushes the price up steeply, while a mild spell can only lower it gently toward the next block of
        demand. Cold costs more than warmth saves. So the price to expect for a winter is higher than the price of an exactly average one — something{' '}
        <FigRef to="Seasonal Gas Market">the first demonstration</FigRef>, which plans for average weather, leaves out.
      </P>
      <P>
        A winter like the cold one also reaches past March: storage that ends the winter low has to be refilled, so next summer’s gas is worth more too. Traders don’t
        wait to find out. They agree prices for every coming month now, and those prices move each day with the weather, the storage report and the forecasts. That
        set of prices — the forward curve, and the futures that trade along it — is the subject of <a href={lessonHref('gas/4.5')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
