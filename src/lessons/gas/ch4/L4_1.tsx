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
  clamp,
  fmt,
  lessonHref,
  useScenario,
} from '../../../framework';
import { clearRegion, normalPlan, planAt, planInventory, simulateYear, STORAGE_HALF_SPREAD, type MarketDayInput, type YearDay } from '../../../engines/gas/market';
import { BASINS, PRODUCTION_COST } from '../../../model/gas/world';
import { COAL_SWITCH_BLOCKS, LNG_VALUE, OIL_SWITCH_VALUE, PROTECTED_VALUE, sectorOf } from '../../../model/gas/demand';
import { GAS_MONTHS, GAS_MONTH_START, gasDayLabel, normalTemp, weatherYear } from '../../../model/gas/weather';
import { XYChart } from '../shared/XYChart';
import { bcfd, gp } from '../shared/format';

// ---------------------------------------------------------------------------
// The region as one market on one day.

const PLAN = normalPlan();
/** January 15 and July 15, as days of the gas year (April 1 = 0). */
export const BAL_JAN15 = GAS_MONTH_START[9] + 14;
export const BAL_JUL15 = GAS_MONTH_START[3] + 14;
const RIDGEBACK_BASE = BASINS[0].productionBcfd;
const SANDHILL = BASINS[1].productionBcfd;

export interface BalanceState {
  /** Day of the gas year. */
  day: number;
  /** Metro's mean temperature that day, °F. */
  temp: number;
  /** What Bayport's LNG feed gas is worth, $/MMBtu. */
  lng: number;
  /** Ridgeback's production, Bcf/d. */
  ridgeback: number;
}

export const BALANCE_DEFAULTS: BalanceState = { day: BAL_JAN15, temp: Math.round(normalTemp(BAL_JAN15)), lng: LNG_VALUE, ridgeback: RIDGEBACK_BASE };

/**
 * Storage's value on a day: what the season's plan expects gas at the hub to fetch then. In one market
 * with no pipelines, location doesn't matter, so both fields carry the same value.
 */
export function storageValue(day: number): number {
  return planAt(PLAN.price.calder, day + 0.5);
}

/** The day's market inputs: both storage fields as full as the season's plan has them, valued at the plan's price. */
export function balanceInput(s: BalanceState): MarketDayInput {
  const w = storageValue(s.day);
  return {
    tempF: s.temp,
    storage: { saltflat: planInventory(PLAN, 'saltflat', s.day), hollowcreek: planInventory(PLAN, 'hollowcreek', s.day) },
    waterValue: { saltflat: w, hollowcreek: w },
    production: { ridgeback: s.ridgeback },
    demand: { lngValue: s.lng },
  };
}

export interface BalanceDay {
  price: number;
  production: number;
  /** Gas burned in the region (homes, power, industry, the fields' own use), Bcf/d. */
  consumption: number;
  /** LNG feed gas sent overseas, Bcf/d. */
  exports: number;
  /** Net storage flow: positive injecting, negative withdrawing, Bcf/d. */
  storage: number;
  /** Most storage could withdraw today, Bcf/d. */
  withdrawLimit: number;
  /** LNG feed gas cut, Bcf/d. */
  lngCut: number;
  /** Protected demand rationed, Bcf/d. */
  rationed: number;
  /** The block that sets the price. */
  marginal: { kind: 'supply' | 'demand'; id: string; value: number };
  supply: Array<{ id: string; q: number; p: number; used: number }>;
  demand: Array<{ id: string; q: number; v: number; used: number }>;
}

/** Clears the region as one market and reads off what happened. */
export function balanceDay(s: BalanceState): BalanceDay {
  const r = clearRegion(balanceInput(s));
  const { problem, solution } = r;
  const supply = problem.supplies.map((x, i) => ({ id: x.id ?? '', q: x.cap, p: x.cost, used: solution.supplied[i] }));
  const demand = problem.demands.map((x, i) => ({ id: x.id ?? '', q: x.cap, v: x.value, used: solution.served[i] }));
  const production = supply.filter((x) => x.id.startsWith('prod')).reduce((a, x) => a + x.used, 0);
  const lng = demand.find((d) => d.id === 'bayport-lng')!;
  const price = r.price;
  // The price-setting block: one that's partly used, or failing that one whose value is the price.
  const partial = (used: number, q: number) => used > 1e-7 && used < q - 1e-7;
  let marginal: BalanceDay['marginal'] | undefined;
  for (const d of demand) if (partial(d.used, d.q)) marginal = { kind: 'demand', id: d.id, value: d.v };
  for (const x of supply) if (!marginal && partial(x.used, x.q)) marginal = { kind: 'supply', id: x.id, value: x.p };
  if (!marginal) {
    const d = demand.find((x) => Math.abs(x.v - price) < 1e-6 && x.q > 1e-9);
    const x = supply.find((y) => Math.abs(y.p - price) < 1e-6 && y.q > 1e-9);
    marginal = d ? { kind: 'demand', id: d.id, value: d.v } : x ? { kind: 'supply', id: x.id, value: x.p } : { kind: 'demand', id: '', value: price };
  }
  const rationed = demand.filter((d) => d.v >= PROTECTED_VALUE).reduce((a, d) => a + d.q - d.used, 0);
  return {
    price,
    production,
    consumption: r.sectors.homes + r.sectors.power + r.sectors.industry + r.sectors.field,
    exports: r.sectors.lng,
    storage: r.storageFlow.saltflat + r.storageFlow.hollowcreek,
    withdrawLimit: supply.filter((x) => x.id.startsWith('wd-')).reduce((a, x) => a + x.q, 0),
    lngCut: lng.q - lng.used,
    rationed,
    marginal,
    supply,
    demand,
  };
}

/** The warmest whole-degree temperature on January 15 at which the region has to cut its LNG exports. */
export function lngCutTemperature(): number {
  for (let t = 60; t >= -40; t--) if (balanceDay({ ...BALANCE_DEFAULTS, temp: t }).lngCut > 1e-6) return t;
  return NaN;
}
export const LNG_CUT_TEMP = lngCutTemperature();

/** The challenge: January 15 with the default production and LNG value, at the warmest temperature that cuts LNG. */
export function lngCutSolved(s: BalanceState): boolean {
  return s.day === BAL_JAN15 && s.lng === LNG_VALUE && Math.abs(s.ridgeback - RIDGEBACK_BASE) < 1e-9 && balanceDay(s).lngCut > 1e-6 && balanceDay({ ...s, temp: s.temp + 1 }).lngCut <= 1e-6;
}

// ---------------------------------------------------------------------------
// The supply and demand chart.

type UseKind = 'homes' | 'power' | 'industry' | 'lng' | 'field' | 'storage';
const USE_COLOR: Record<UseKind, string> = {
  homes: '#7b5ea7',
  power: '#e48850',
  industry: '#8a8a8a',
  lng: '#4590ce',
  field: '#b9b4a6',
  storage: GRAPHIC.gold,
};
const USE_LABEL: Record<UseKind, string> = {
  homes: 'Homes and businesses',
  power: 'Power plants',
  industry: 'Industry',
  lng: 'LNG exports',
  field: 'The fields’ own use',
  storage: 'Storage',
};
const PRODUCTION_COLOR = '#333';
const PLAN_COLOR = '#555';

function useOf(id: string): UseKind {
  return id.startsWith('inj-') || id.startsWith('wd-') ? 'storage' : sectorOf(id);
}

const Y_MAX = 9;
const X_MAX = 8;

function CurvesChart({ b, ariaLabel }: { b: BalanceDay; ariaLabel: string }) {
  const supply = [...b.supply].sort((a, c) => a.p - c.p);
  const demand = [...b.demand].sort((a, c) => c.v - a.v);
  // Gas changing hands: everything burned, exported or injected (which equals everything produced or withdrawn).
  const quantity = b.consumption + b.exports + Math.max(0, b.storage);
  const cy = (v: number) => Math.min(v, Y_MAX);
  const cx = (v: number) => Math.min(v, X_MAX);
  return (
    <XYChart
      xDomain={[0, X_MAX]}
      yDomain={[0, Y_MAX]}
      xTicks={[0, 1, 2, 3, 4, 5, 6, 7, 8]}
      yTicks={[0, 2, 4, 6, 8]}
      yFormat={(v) => `$${v}`}
      yLabel="Price, $/MMBtu"
      xLabel="gas, Bcf/d"
      height={270}
      series={[]}
      hLines={[{ at: Math.min(b.price, Y_MAX), color: GRAPHIC.green, dash: '5 4', label: `price ${b.price > Y_MAX ? '$' + fmt(b.price) : gp(b.price)}`, labelAt: 'start' }]}
      vLines={[{ at: Math.min(quantity, X_MAX), color: '#9a9a9a', dash: '3 4', width: 1 }]}
      ariaLabel={ariaLabel}
    >
      {(x, y) => {
        let at = 0;
        const supplySegs = supply.map((s) => {
          const seg = { x0: at, x1: at + s.q, y: cy(s.p), color: s.id.startsWith('wd-') ? GRAPHIC.gold : PRODUCTION_COLOR };
          at += s.q;
          return seg;
        });
        const supplyEnd = at;
        at = 0;
        const demandSegs = demand.map((d) => {
          const seg = { x0: at, x1: at + d.q, y: cy(d.v), color: USE_COLOR[useOf(d.id)] };
          at += d.q;
          return seg;
        });
        const demandEnd = at;
        const path = (segs: Array<{ x0: number; x1: number; y: number }>) =>
          segs.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(cx(s.x0)).toFixed(1)} ${y(s.y).toFixed(1)} L${x(cx(s.x1)).toFixed(1)} ${y(s.y).toFixed(1)}`).join(' ');
        return (
          <g>
            {/* Risers joining the steps, in gray, under the colored treads. */}
            <path d={path(demandSegs) + ` L${x(cx(demandEnd))} ${y(0)}`} fill="none" stroke="#c9c9c9" strokeWidth={1.2} />
            <path d={path(supplySegs) + ` L${x(cx(supplyEnd))} ${y(Y_MAX)}`} fill="none" stroke="#c9c9c9" strokeWidth={1.2} />
            {demandSegs.map((s, i) =>
              s.x1 - s.x0 > 1e-6 && s.x0 < X_MAX ? <line key={'d' + i} x1={x(s.x0)} x2={x(cx(s.x1))} y1={y(s.y)} y2={y(s.y)} stroke={s.color} strokeWidth={4} strokeLinecap="butt" /> : null,
            )}
            {supplySegs.map((s, i) =>
              s.x1 - s.x0 > 1e-6 && s.x0 < X_MAX ? <line key={'s' + i} x1={x(s.x0)} x2={x(cx(s.x1))} y1={y(s.y)} y2={y(s.y)} stroke={s.color} strokeWidth={4} strokeLinecap="butt" strokeDasharray="7 3" /> : null,
            )}
            <text className="ax" x={x(0.06)} y={y(Y_MAX) + 15} style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
              ↑ uses worth $15–$100, off the top
            </text>
            <text className="ax ax-e" x={x(cx(supplyEnd)) - 6} y={y(Y_MAX) + 14} style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
              all the supply there is
            </text>
            <circle cx={x(cx(quantity))} cy={y(Math.min(b.price, Y_MAX))} r={6} fill={GRAPHIC.green} stroke="#fcfcfb" strokeWidth={2} />
          </g>
        );
      }}
    </XYChart>
  );
}

const MARGINAL_TEXT = (b: BalanceDay): string => {
  const id = b.marginal.id;
  if (b.rationed > 1e-6) return `There isn’t enough gas even for homes: ${bcfd(b.rationed)} of protected demand would have to be rationed.`;
  if (id.startsWith('wd-')) return `Storage is withdrawing ${bcfd(-b.storage)}, and its asking price, ${gp(b.marginal.value)}, sets the price.`;
  if (id.startsWith('inj-')) return `Storage is injecting ${bcfd(b.storage)}, and its bid, ${gp(b.marginal.value)}, sets the price.`;
  if (id.startsWith('metro-switch')) return `Storage is withdrawing as fast as it can, ${bcfd(-b.storage)}. Power plants choosing between coal and gas set the price at ${gp(b.price)}: some have switched back to coal.`;
  if (id === 'bayport-flexible') return `Storage is at its limit. Bayport’s flexible industry sets the price at ${gp(b.price)}, cutting back what it can.`;
  if (id === 'bayport-lng') return `Storage is at its limit, and Bayport’s LNG terminal is cutting its exports by ${bcfd(b.lngCut)}: at ${gp(b.price)} its cargoes stop paying.`;
  if (id === 'metro-interruptible') return `Metro’s interruptible industry is being cut off at ${gp(b.price)}.`;
  if (id === 'metro-power') return `Metro’s power plants are switching to oil: gas costs ${gp(b.price)}.`;
  if (id.startsWith('prod')) return `There’s more gas than anyone wants: the price falls to what it costs to produce, ${gp(b.price)}.`;
  return `The price is ${gp(b.price)}.`;
};

// ---------------------------------------------------------------------------
// A year, week by week.

export const BALANCE_YEARS = [
  { id: 'mild', label: 'A mild winter', seed: 2 },
  { id: 'ordinary', label: 'An ordinary winter', seed: 8 },
  { id: 'cold', label: 'A cold December', seed: 5 },
] as const;
type YearId = (typeof BALANCE_YEARS)[number]['id'];

const planTotal = (day: number) => planInventory(PLAN, 'saltflat', day % 365) + planInventory(PLAN, 'hollowcreek', day % 365);

export interface BalanceWeek {
  week: number;
  /** First day of the week (day of the gas year). */
  start: number;
  /** Average Bcf/d burned by each kind of user. */
  homes: number;
  power: number;
  industry: number;
  lng: number;
  field: number;
  /** Storage's net change over the week, and the plan's, Bcf. */
  change: number;
  planChange: number;
  /** Working gas at the week's end, and the plan's, Bcf. */
  inventory: number;
  planInventory: number;
  /** Average Calder price, and the plan's, $/MMBtu. */
  price: number;
  planPrice: number;
  /** Average departure from normal temperature, °F. */
  tempDev: number;
}

const dayCache = new Map<number, YearDay[]>();
/** A simulated gas year of the region's market, day by day (cached). */
export function balanceYear(seed: number): YearDay[] {
  let y = dayCache.get(seed);
  if (!y) {
    y = simulateYear({ weather: weatherYear(seed) });
    dayCache.set(seed, y);
  }
  return y;
}

/** Working gas taken out of storage over the winter (November 1 to March 31), Bcf: the simulated year's and the plan's. */
export function winterDraw(seed: number): { actual: number; plan: number } {
  const y = balanceYear(seed);
  const total = (d: YearDay) => d.storage.saltflat + d.storage.hollowcreek;
  return { actual: total(y[213]) - total(y[364]), plan: planTotal(214) - planTotal(365) };
}

const yearCache = new Map<number, BalanceWeek[]>();
/** A simulated gas year summarized by week (52 weeks; the last has eight days). */
export function balanceWeeks(seed: number): BalanceWeek[] {
  let weeks = yearCache.get(seed);
  if (weeks) return weeks;
  const y = balanceYear(seed);
  const total = (d: YearDay) => d.storage.saltflat + d.storage.hollowcreek;
  weeks = Array.from({ length: 52 }, (_, k) => {
    const days = y.slice(7 * k, k === 51 ? 365 : 7 * k + 7);
    const n = days.length;
    const avg = (f: (d: YearDay) => number) => days.reduce((a, d) => a + f(d), 0) / n;
    const before = k === 0 ? planTotal(0) : total(y[7 * k - 1]);
    const end = 7 * k + n;
    return {
      week: k,
      start: 7 * k,
      homes: avg((d) => d.sectors.homes),
      power: avg((d) => d.sectors.power),
      industry: avg((d) => d.sectors.industry),
      lng: avg((d) => d.sectors.lng),
      field: avg((d) => d.sectors.field),
      change: total(days[n - 1]) - before,
      planChange: planTotal(end) - planTotal(7 * k),
      inventory: total(days[n - 1]),
      planInventory: planTotal(end),
      price: avg((d) => d.price.calder),
      planPrice: avg((d) => planAt(PLAN.price.calder, d.day + 0.5)),
      tempDev: avg((d) => d.tempF - normalTemp(d.day)),
    };
  });
  yearCache.set(seed, weeks);
  return weeks;
}

const MONTH_TICKS = GAS_MONTH_START.map((d) => d / 7);
const monthAtTick = (v: number) => {
  const i = MONTH_TICKS.findIndex((t) => Math.abs(t - v) < 1e-9);
  return i >= 0 ? GAS_MONTHS[i] : '';
};
const STACK: Array<{ key: 'homes' | 'power' | 'industry' | 'lng' | 'field'; kind: UseKind }> = [
  { key: 'field', kind: 'field' },
  { key: 'industry', kind: 'industry' },
  { key: 'lng', kind: 'lng' },
  { key: 'power', kind: 'power' },
  { key: 'homes', kind: 'homes' },
];

const signedBcf = (x: number) => `${x > 0.05 ? '+' : x < -0.05 ? '−' : ''}${fmt(Math.abs(x), 1)} Bcf`;

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const JAN = balanceDay(BALANCE_DEFAULTS);
const JUL = balanceDay({ ...BALANCE_DEFAULTS, day: BAL_JUL15, temp: Math.round(normalTemp(BAL_JUL15)) });
/** Coldest whole degree on January 15 at which storage still sets the price. */
const STORAGE_LIMIT_TEMP = (() => {
  for (let t = 40; t >= -40; t--) if (!balanceDay({ ...BALANCE_DEFAULTS, temp: t }).marginal.id.startsWith('wd-')) return t + 1;
  return NaN;
})();
const AT_LIMIT = balanceDay({ ...BALANCE_DEFAULTS, temp: STORAGE_LIMIT_TEMP });
/** Extra demand from one degree colder on January 15, Bcf/d. */
const PER_DEGREE = Math.abs(balanceDay({ ...BALANCE_DEFAULTS, temp: BALANCE_DEFAULTS.temp - 1 }).storage - JAN.storage);
const STEPS = [STORAGE_LIMIT_TEMP - 1, STORAGE_LIMIT_TEMP - 2, STORAGE_LIMIT_TEMP - 3].map((t) => ({ t, b: balanceDay({ ...BALANCE_DEFAULTS, temp: t }) }));
const AT_CUT = balanceDay({ ...BALANCE_DEFAULTS, temp: LNG_CUT_TEMP });
const COLD = balanceWeeks(BALANCE_YEARS[2].seed);
const MILD = balanceWeeks(BALANCE_YEARS[0].seed);
const COLD_SURPRISE = COLD.reduce((a, w) => (w.change - w.planChange < a.change - a.planChange ? w : a));
const COLD_GAP = COLD.reduce((a, w) => (w.inventory - w.planInventory < a.inventory - a.planInventory ? w : a));
const COLD_PEAK = COLD.reduce((a, w) => (w.price > a.price ? w : a));
const MILD_PEAK = MILD.reduce((a, w) => (w.price > a.price ? w : a));
const MILD_END = MILD[51];
const MILD_DRAW = winterDraw(BALANCE_YEARS[0].seed);

export default function Lesson() {
  const s = useScenario('balance', BALANCE_DEFAULTS);
  const st = s.state;
  const b = useMemo(() => balanceDay(st), [st]);
  const w = storageValue(st.day);
  const normal = Math.round(normalTemp(st.day));
  const solved = lngCutSolved(st);
  const atChallenge = st.day === BAL_JAN15 && st.lng === LNG_VALUE && Math.abs(st.ridgeback - RIDGEBACK_BASE) < 1e-9;

  const y = useScenario('year', { year: 'cold' as YearId });
  const seed = BALANCE_YEARS.find((x) => x.id === y.state.year)!.seed;
  const weeks = useMemo(() => balanceWeeks(seed), [seed]);
  const [cursor, setCursor] = useState(38);
  const wk = weeks[clamp(Math.round(cursor), 0, 51)];
  const xs = weeks.map((x) => x.week + 0.5);
  let lower = weeks.map(() => 0);
  const bands = STACK.map((layer) => {
    const lows = lower;
    const highs = weeks.map((x, i) => lows[i] + x[layer.key]);
    lower = highs;
    return { xs, ys: highs, lows, kind: 'band' as const, color: USE_COLOR[layer.kind], opacity: 0.85 };
  });
  const yearLabel = BALANCE_YEARS.find((x) => x.id === y.state.year)!.label.toLowerCase();

  const status = !atChallenge
    ? `Set the date back to January 15, Bayport’s LNG value to ${gp(LNG_VALUE)} and Ridgeback’s production to ${bcfd(RIDGEBACK_BASE, 1)} — Reset does all three — then change only the temperature.`
    : b.lngCut > 1e-6
      ? `At ${st.temp} °F the region cuts ${bcfd(b.lngCut)} of LNG exports. Would it still have to at a warmer temperature?`
      : `At ${st.temp} °F every LNG cargo still gets its gas; the price is ${gp(b.price)}.`;

  return (
    <LessonPage id="gas/4.1">
      <P>
        Chapter 3 moved gas with engineering: pipelines across the region, linepack through the hours, storage through the seasons, ships across the sea. None of it
        says how much gas anyone will produce, burn or store on a given day. Those decisions are made by thousands of people — producers, utilities, power plant
        owners, factory managers, storage operators — who never coordinate with one another and never see a pipeline. They respond to a <K c="price">price</K>.
        This chapter is about how that price forms, and how the physical limits of Chapter 3 end up inside it.
      </P>
      <P>
        We’ll start with the simplest market there could be. Forget the pipelines for now and imagine the whole region as one place where every cubic foot of gas
        can reach every buyer. Whatever happens, one rule holds every day: gas can’t pile up or vanish. What the fields produce is burned in the region, shipped out
        as LNG, or put into storage, and storage can give gas back when production falls short:
      </P>
      <Eq label="Production minus consumption minus exports equals the change in storage">
        <K tone="orange">production</K>
        <Op>−</Op>
        <span>consumption</span>
        <Op>−</Op>
        <span>exports</span>
        <Op>=</Op>
        <K c="energy">change in storage</K>
      </Eq>
      <P>
        The price is what makes the two sides agree. Every user of gas has a price at which it would rather stop: a <b>value</b>, in dollars per MMBtu. In our
        region, homes, hospitals and businesses that heat with gas are protected — they’re cut off only by rationing, which we’ll count as a value of{' '}
        {gp(PROTECTED_VALUE, 0)}. Most industry pays up to $20 before shutting down a process, though some can do without at $8 or even $5. Metro’s gas-fired
        power plants burn gas until it costs more than{' '}
        {gp(OIL_SWITCH_VALUE, 0)}, when burning oil is cheaper, and some of them compete with coal plants: they burn extra gas only while it’s cheaper than coal,
        in blocks valued from {gp(COAL_SWITCH_BLOCKS[0].value)} down to {gp(COAL_SWITCH_BLOCKS[COAL_SWITCH_BLOCKS.length - 1].value)}. Bayport’s LNG terminal
        takes its feed gas while overseas prices cover the voyage — up to a simulated {gp(LNG_VALUE)}, the kind of netback <a href={lessonHref('gas/3.5')}>Lesson 3.5</a>{' '}
        worked out.
      </P>
      <P>
        On the other side, the region’s wells produce whatever they produce — {bcfd(RIDGEBACK_BASE, 1)} from Ridgeback and {bcfd(SANDHILL, 1)} from Sandhill —
        and once the wells are drilled, getting the gas out costs only {gp(PRODUCTION_COST.ridgeback ?? 0)} and {gp(PRODUCTION_COST.sandhill ?? 0)} per MMBtu.
        Storage is both a buyer and a seller. Its owners know what gas is likely to be worth later in the season (how they know is{' '}
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>), so they offer their gas for that much plus {gp(STORAGE_HALF_SPREAD)} and bid for more at that much
        minus {gp(STORAGE_HALF_SPREAD)}. In the next demonstration, the dashed steps are the supply curve, cheapest first; the solid steps are the demand curve,
        most valuable first, colored by who wants the gas. Storage’s fields are as full as the season’s plan has them on the chosen date. Pick a date, then make
        the day warmer or colder:
      </P>

      <Figure name="Gas Balance Model" scenario={s}>
        <CurvesChart
          b={b}
          ariaLabel={`Supply and demand for gas in the whole region on ${gasDayLabel(st.day)} at ${st.temp} °F. They cross at ${gp(b.price)} per MMBtu: production ${fmt(b.production, 2)} Bcf/d, consumption ${fmt(b.consumption, 2)}, LNG exports ${fmt(b.exports, 2)}, storage ${b.storage >= 0 ? 'injecting' : 'withdrawing'} ${fmt(Math.abs(b.storage), 2)}.`}
        />
        <Legend
          items={[
            { label: 'Production', color: PRODUCTION_COLOR, kind: 'line', dashed: true },
            { label: 'Storage', color: GRAPHIC.gold },
            ...(['homes', 'power', 'industry', 'lng'] as UseKind[]).map((k) => ({ label: USE_LABEL[k], color: USE_COLOR[k] })),
          ]}
        />
        <Readouts
          items={[
            { label: 'price', value: gp(b.price), tone: 'green' },
            { label: 'production', value: bcfd(b.production), tone: 'orange' },
            { label: 'burned in the region', value: bcfd(b.consumption) },
            { label: 'LNG exports', value: bcfd(b.exports) },
            { label: b.storage >= 0 ? 'into storage' : 'out of storage', value: bcfd(Math.abs(b.storage)), tone: 'gold' },
          ]}
        />
        <Eq
          label={`${fmt(b.production, 2)} produced minus ${fmt(b.consumption, 2)} burned minus ${fmt(b.exports, 2)} exported equals ${fmt(b.storage, 2)} Bcf per day into storage`}
        >
          <K tone="orange">{fmt(b.production, 2)}</K>
          <Op>−</Op>
          <span>{fmt(b.consumption, 2)}</span>
          <Op>−</Op>
          <span>{fmt(b.exports, 2)}</span>
          <Op>=</Op>
          <K c="energy">
            {b.storage < -0.005 ? '−' : ''}
            {fmt(Math.abs(b.storage), 2)} Bcf/d
          </K>
        </Eq>
        <Slider
          label="Date"
          value={st.day}
          min={0}
          max={364}
          onChange={(v) => s.set({ day: v, temp: Math.round(normalTemp(v)) })}
          display={`${gasDayLabel(st.day)} · storage values gas at ${gp(w)}`}
        />
        <Slider label="Metro’s temperature" tone="teal" value={st.temp} min={-10} max={95} onChange={(v) => s.set({ temp: v })} display={`${st.temp} °F · normal ${normal} °F`} />
        <Slider label="What LNG feed gas is worth" tone="green" value={st.lng} min={2} max={10} step={0.25} onChange={(v) => s.set({ lng: v })} display={`${gp(st.lng)}/MMBtu`} />
        <Slider
          label="Ridgeback’s production"
          tone="orange"
          value={st.ridgeback}
          min={2}
          max={3.2}
          step={0.05}
          onChange={(v) => s.set({ ridgeback: v })}
          display={bcfd(st.ridgeback)}
        />
        <Caption>{MARGINAL_TEXT(b)}</Caption>
      </Figure>

      <P>
        The demonstration opens on January 15 at {BALANCE_DEFAULTS.temp} °F, a normal day for the date. The region burns {bcfd(JAN.consumption)} and ships{' '}
        {bcfd(JAN.exports, 1)} overseas, against {bcfd(JAN.production, 1)} of production, so storage makes up the difference by withdrawing{' '}
        {bcfd(-JAN.storage)}. The last gas in is storage’s, so storage’s asking price sets the market price: {gp(JAN.price)}. Move the date to July 15 at{' '}
        {Math.round(normalTemp(BAL_JUL15))} °F and the balance turns over. Homes need almost no gas, consumption falls to {bcfd(JUL.consumption)}, and{' '}
        {bcfd(JUL.storage)} is left over after every use worth more than storage’s bid — so it goes into the ground, and the bid, {gp(JUL.price)}, is the price.
      </P>
      <P>
        On most days of the year, then, the price isn’t set by the wells or by any single buyer. Production can’t follow the weather from day to day, and the buyers
        who could cut back are rarely asked to. Storage is the balancing item: it takes up whatever production and demand leave over, at a price close to what its
        owners expect gas to be worth later. That is why the change in storage, rather than production or consumption, is the number the gas market watches most
        closely — and why <a href={lessonHref('gas/3.4')}>the ratchets of Lesson 3.4</a>, which limit how fast storage can respond, matter so much.
      </P>

      <H2>Who gives way</H2>
      <P>
        Storage can’t balance everything. Set the date to January 15 and lower the temperature. Each degree colder adds about{' '}
        {fmt(PER_DEGREE * 1000)} MMcf/d of demand, and storage covers it at an unchanged price down to {STORAGE_LIMIT_TEMP} °F, when Salt Flat and Hollow Creek
        are withdrawing {bcfd(-AT_LIMIT.storage)} of the {bcfd(AT_LIMIT.withdrawLimit)} they can manage. A degree colder they reach their limit, there’s no more
        gas to be had at any price, and the market has to find buyers willing to do without. The price climbs the demand curve: {gp(STEPS[0].b.price)} at{' '}
        {STEPS[0].t} °F, as the power plants that only just beat coal switch back to it; {gp(STEPS[1].b.price)} at {STEPS[1].t} °F, as more of them do;{' '}
        {gp(STEPS[2].b.price)} at {STEPS[2].t} °F, when Bayport’s flexible industry starts cutting back too.
      </P>

      <Challenge
        id="a"
        question={`On January 15, with Bayport’s LNG feed gas worth ${gp(LNG_VALUE)} and Ridgeback producing ${bcfd(RIDGEBACK_BASE, 1)}, how cold does the day have to get before the region starts cutting its LNG exports? Find the warmest whole degree at which it does.`}
        solved={solved}
        status={status}
        success={`Solved: ${LNG_CUT_TEMP} °F. The price rises to ${gp(AT_CUT.price)}, the value of LNG feed gas, and ${bcfd(AT_CUT.lngCut)} of exports is cut so that the region’s own users keep their gas. Every user with a cheaper way out has already taken it: power plants back on coal, flexible industry idle. Below this, each colder degree cuts LNG further; only far colder still would the price reach the $8 of interruptible industry, the $15 at which power plants burn oil, and finally rationing.`}
      />

      <P>
        The order isn’t arbitrary. A rising price asks every user, in effect, what it would cost them to do without, and those with the cheapest alternatives —
        coal for a power plant, a paused process for a factory, a cargo that can be cancelled — give way first. Homes give way last, because their alternative is a
        cold house. Notice, too, what the price is doing when it jumps. It isn’t that gas suddenly costs more to produce: the wells’ costs haven’t changed. The
        price is set by the value of the last use being cut off, so a little scarcity can move it a long way. Try raising Ridgeback’s production, or lowering
        what LNG is worth, and watch the same cold day clear at a different price.
      </P>

      <H2>The year, week by week</H2>
      <P>
        Real days don’t come one at a time at the temperature we choose; they come in runs of weather, and storage carries the consequences from one week to the
        next. Every Thursday morning the US Energy Information Administration publishes its estimate of how much gas went into or came out of storage in the week
        that ended the previous Friday. Traders compare it with their own expectations, and a withdrawal bigger than expected tends to push prices up, because it
        means less gas left for the rest of the winter.
      </P>
      <P>
        In the next demonstration, the region runs through a simulated gas year, day by day, with the weather of the year you choose. The upper chart shows what
        each kind of user burned on average each week; the middle one, the week’s change in storage — the bars — against what the season’s plan expected for a
        normal week; the lower one, the average price at Calder Hub against the plan’s. Drag across any chart to read a week:
      </P>

      <Figure name="Gas Balance Model · the year" scenario={y}>
        <Segmented label="Weather" value={y.state.year} onChange={(v) => y.set({ year: v })} options={BALANCE_YEARS.map((x) => ({ value: x.id, label: x.label }))} />
        <XYChart
          xDomain={[0, 52]}
          yDomain={[0, 6]}
          xTicks={MONTH_TICKS}
          xFormat={monthAtTick}
          yTicks={[0, 2, 4, 6]}
          yFormat={(v) => fmt(v)}
          yLabel="Gas burned and exported, Bcf/d"
          height={170}
          series={bands}
          hLines={[{ at: RIDGEBACK_BASE + SANDHILL, color: '#333', dash: '6 4', label: `production ${bcfd(RIDGEBACK_BASE + SANDHILL, 1)}`, labelAt: 'start' }]}
          cursor={wk.week + 0.5}
          onScrub={setCursor}
          scrubLabel="Week of the gas year"
          ariaLabel={`Weekly gas use in ${yearLabel}, by kind of user, against production of ${bcfd(RIDGEBACK_BASE + SANDHILL, 1)}. In the week of ${gasDayLabel(wk.start)} the region burned and exported ${fmt(wk.homes + wk.power + wk.industry + wk.lng + wk.field, 2)} Bcf/d.`}
        />
        <XYChart
          xDomain={[0, 52]}
          yDomain={[-14, 8]}
          xTicks={MONTH_TICKS}
          xFormat={monthAtTick}
          yTicks={[-12, -8, -4, 0, 4, 8]}
          yFormat={(v) => (v > 0 ? `+${v}` : `${v}`)}
          yLabel="Change in storage over the week, Bcf"
          height={150}
          series={[]}
          cursor={wk.week + 0.5}
          onScrub={setCursor}
          scrubLabel="Week of the gas year"
          ariaLabel={`Weekly change in storage in ${yearLabel}. In the week of ${gasDayLabel(wk.start)}: ${signedBcf(wk.change)}, against ${signedBcf(wk.planChange)} in the plan.`}
        >
          {(x, yy) => (
            <g>
              {weeks.map((v) => (
                <g key={v.week}>
                  <rect
                    x={x(v.week + 0.15)}
                    width={x(v.week + 0.85) - x(v.week + 0.15)}
                    y={Math.min(yy(0), yy(v.change))}
                    height={Math.abs(yy(v.change) - yy(0))}
                    fill={GRAPHIC.gold}
                    opacity={v.week === wk.week ? 1 : 0.7}
                  />
                  <line x1={x(v.week + 0.05)} x2={x(v.week + 0.95)} y1={yy(v.planChange)} y2={yy(v.planChange)} stroke={PLAN_COLOR} strokeWidth={1.5} />
                </g>
              ))}
            </g>
          )}
        </XYChart>
        <XYChart
          xDomain={[0, 52]}
          yDomain={[2, 7]}
          xTicks={MONTH_TICKS}
          xFormat={monthAtTick}
          yTicks={[2, 3, 4, 5, 6, 7]}
          yFormat={(v) => `$${v}`}
          yLabel="Price at Calder Hub, weekly average"
          height={150}
          series={[
            { xs, ys: weeks.map((v) => v.planPrice), color: PLAN_COLOR, width: 1.5, dash: '5 4' },
            { xs, ys: weeks.map((v) => v.price), color: GRAPHIC.green, width: 2.5 },
          ]}
          markers={[{ x: wk.week + 0.5, y: wk.price, color: GRAPHIC.green, r: 5 }]}
          cursor={wk.week + 0.5}
          onScrub={setCursor}
          scrubLabel="Week of the gas year"
          ariaLabel={`Weekly average price at Calder Hub in ${yearLabel} against the plan's. In the week of ${gasDayLabel(wk.start)}: ${gp(wk.price)} against ${gp(wk.planPrice)}.`}
        />
        <Legend
          items={[
            ...STACK.slice()
              .reverse()
              .map((l) => ({ label: USE_LABEL[l.kind], color: USE_COLOR[l.kind] })),
            { label: 'Storage change', color: GRAPHIC.gold },
            { label: 'The season’s plan', color: PLAN_COLOR, kind: 'line' as const },
            { label: 'Price', color: GRAPHIC.green, kind: 'line' as const },
          ]}
        />
        <Readouts
          items={[
            { label: `week of ${gasDayLabel(wk.start)}`, value: signedBcf(wk.change), tone: 'gold' },
            { label: 'the plan expected', value: signedBcf(wk.planChange) },
            { label: 'storage against plan', value: signedBcf(wk.inventory - wk.planInventory), tone: wk.inventory < wk.planInventory - 0.5 ? 'red' : 'ink' },
            { label: 'Calder Hub', value: gp(wk.price), tone: 'green' },
          ]}
        />
        <Caption>
          In the week of {gasDayLabel(wk.start)}, temperatures averaged {fmt(Math.abs(wk.tempDev), 1)} °F {wk.tempDev < 0 ? 'below' : 'above'} normal, and storage
          ended the week holding {fmt(wk.inventory, 1)} Bcf of working gas, {fmt(Math.abs(wk.inventory - wk.planInventory), 1)} Bcf{' '}
          {wk.inventory < wk.planInventory ? 'less' : 'more'} than the plan.
        </Caption>
      </Figure>

      <P>
        Start with the cold December. In the week of {gasDayLabel(COLD_SURPRISE.start)}, temperatures averaged {fmt(Math.abs(COLD_SURPRISE.tempDev), 1)} °F below
        normal and the region took {fmt(-COLD_SURPRISE.change, 1)} Bcf out of storage, against {fmt(-COLD_SURPRISE.planChange, 1)} in a normal week. Each surprise
        like that leaves less gas for the rest of the winter, and the shortfall accumulates: by the end of the week that began {gasDayLabel(COLD_GAP.start)}, storage held{' '}
        {fmt(COLD_GAP.planInventory - COLD_GAP.inventory, 1)} Bcf less than the plan. The storage owners in our model do what real ones do with gas that has
        become scarcer — they value it more — and the price follows: Calder Hub averaged {gp(COLD_PEAK.price)} in the week of {gasDayLabel(COLD_PEAK.start)},
        against {gp(COLD_PEAK.planPrice)} in the plan.
      </P>
      <P>
        Now choose the mild winter. From November through March the region takes {fmt(MILD_DRAW.actual, 1)} Bcf out of storage, {fmt(MILD_DRAW.plan - MILD_DRAW.actual, 1)}{' '}
        less than the plan, the price never averages more than {gp(MILD_PEAK.price)} in any week, and on March 31 the fields still hold{' '}
        {fmt(MILD_END.inventory, 1)} Bcf of working gas against the {fmt(MILD_END.planInventory, 1)} the plan expected — gas
        that will weigh on prices into the next summer, since less will need to be injected. In these simulated years the weather never touches production (in a hard freeze it can, as <a href={lessonHref('gas/5.5')}>Lesson 5.5</a> shows). It changes consumption, and
        consumption changes storage, and storage changes the price. That chain is why gas traders read weather forecasts as closely as any meteorologist.
      </P>
      <P>
        Everything in this lesson treated the region as a single place. It isn’t: Metro is 240 miles of Northline away from Calder Hub, and Ridgeback’s gas has
        only two pipelines out. In <FigRef to="Gas Balance Model">the first demonstration</FigRef> a cubic foot from Ridgeback could warm a house in Metro at no
        cost. In <a href={lessonHref('gas/4.2')}>the next lesson</a> we put the pipelines back, and find that the region has not one price but several — and a
        hub where most of the trading happens.
      </P>
    </LessonPage>
  );
}
