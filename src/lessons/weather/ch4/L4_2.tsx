import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  FUEL,
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
  SupplyStackChart,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  mw,
  scale,
  usd,
  useScenario,
  type StackBlock,
} from '../../../framework';
import { supplyStack } from '../../../engines/market/clearing';
import { GAS_SYSTEM, citygatePrice, energyDay, plantCost, type EnergyDay } from '../../../engines/weather/energyMarket';
import { STANDARD_FLEET } from '../../../model/fleet';
import { archive, dayIndex, dayInfo, tempF } from '../../../model/weather/archive';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// One day of weather, through the gas and power markets.

export type Season = 'january' | 'july';
export const SEASON_DOY: Record<Season, number> = { january: 20, july: 200 };

export interface DayState {
  season: Season;
  /** Daily mean temperature at Calder Bay, °F. */
  meanF: number;
  /** Daily mean wind at hub height on Hollin Ridge, m/s. */
  wind: number;
  /** Cloud cover, 0–1. */
  cloud: number;
}

export const DAY_DEFAULTS: DayState = { season: 'january', meanF: 33, wind: 7.5, cloud: 0.4 };

/** Old Quay oil's cost to run, $/MWh: it doesn't burn gas, so it doesn't move with the gas price. */
export const OIL_COST = STANDARD_FLEET.find((p) => p.id === 'oil')!.marginalCost;

const dayCache = new Map<string, EnergyDay>();
/** The model's day for a state (cached: every slider position is computed once). */
export function dayOf(s: DayState, pipeline = GAS_SYSTEM.pipeline): EnergyDay {
  const key = `${s.season}|${s.meanF}|${s.wind}|${s.cloud}|${pipeline}`;
  let d = dayCache.get(key);
  if (!d) {
    d = energyDay({ doy: SEASON_DOY[s.season], meanF: s.meanF, windMs: s.wind, cloud: s.cloud }, { ...GAS_SYSTEM, pipeline });
    if (dayCache.size > 3000) dayCache.clear();
    dayCache.set(key, d);
  }
  return d;
}

/** Whether the Eastgate gas peaker costs more to run than Old Quay oil on this day. */
export function oilCheaper(s: DayState): boolean {
  return plantCost('ct', dayOf(s).gas) > OIL_COST;
}

/**
 * The first challenge: on a January day, the warmest temperature (to the degree) at which oil is
 * cheaper to run than the gas peaker. With the starting wind and cloud it's 12 °F.
 */
export function oilSolved(s: DayState): boolean {
  return s.season === 'january' && oilCheaper(s) && !oilCheaper({ ...s, meanF: s.meanF + 1 });
}

// ---------------------------------------------------------------------------
// A winter of the archive, day by day.

export const WINTER_LENGTH = 90;
/** Days of winter y: December 1 of year y through February 28 of year y + 1. */
export function winterDays(y: number): number[] {
  const s = dayIndex(y, 11, 1);
  return Array.from({ length: WINTER_LENGTH }, (_, i) => s + i);
}

/** Cloud on an archive day: overcast if it rained, partly cloudy otherwise. */
export function cloudOn(d: number): number {
  return archive().rain.calder[d] > 0.05 ? 0.9 : 0.4;
}

export interface WinterState {
  winter: number;
  /** Pipeline capacity into the region, millions of MMBtu per day. */
  pipeline: number;
  /** Multiplies every day's wind on Hollin Ridge. */
  windScale: number;
}

export interface WinterRun {
  temps: number[];
  gas: number[];
  power: number[];
  avgGas: number;
  maxGas: number;
  daysOver10: number;
  avgPower: number;
  maxPower: number;
}

const winterCache = new Map<string, WinterRun>();
export function winterRun(s: WinterState): WinterRun {
  const key = `${s.winter}|${s.pipeline}|${s.windScale}`;
  let r = winterCache.get(key);
  if (r) return r;
  const a = archive();
  const sys = { ...GAS_SYSTEM, pipeline: s.pipeline * 1e6 };
  const temps: number[] = [];
  const gas: number[] = [];
  const power: number[] = [];
  for (const d of winterDays(s.winter)) {
    const t = tempF('calder', d);
    const e = energyDay({ doy: dayInfo(d).doy, meanF: t, windMs: a.wind[d] * s.windScale, cloud: cloudOn(d) }, sys);
    temps.push(t);
    gas.push(e.gas);
    power.push(e.avgPrice);
  }
  r = {
    temps,
    gas,
    power,
    avgGas: gas.reduce((x, v) => x + v, 0) / gas.length,
    maxGas: Math.max(...gas),
    daysOver10: gas.filter((g) => g > 10).length,
    avgPower: power.reduce((x, v) => x + v, 0) / power.length,
    maxPower: Math.max(...power),
  };
  if (winterCache.size > 400) winterCache.clear();
  winterCache.set(key, r);
  return r;
}

/** The archive's coldest winter: the one with the lowest daily mean temperature. */
export const COLDEST_WINTER = (() => {
  let best = { y: 1, t: Infinity };
  for (let y = 1; y <= 40; y++) for (const d of winterDays(y)) if (tempF('calder', d) < best.t) best = { y, t: tempF('calder', d) };
  return best.y;
})();

/** A mild winter to compare with: its coldest day is about 23 °F. */
export const MILD_WINTER = 19;
export const PIPELINE_STEP = 0.05;
export const PRICE_LIMIT = 10;
export const WINTER_DEFAULTS: WinterState = { winter: COLDEST_WINTER, pipeline: 1.4, windScale: 1 };

/**
 * The second challenge: in the coldest winter, with its own winds, the least pipeline capacity
 * (in steps of 0.05 million MMBtu a day) that keeps the city-gate price under $10 every day.
 */
export function pipelineSolved(s: WinterState): boolean {
  if (s.winter !== COLDEST_WINTER || Math.abs(s.windScale - 1) > 1e-9) return false;
  const here = winterRun(s).maxGas < PRICE_LIMIT;
  const less = winterRun({ ...s, pipeline: Math.round((s.pipeline - PIPELINE_STEP) * 100) / 100 }).maxGas < PRICE_LIMIT;
  return here && !less;
}

// ---------------------------------------------------------------------------
// Drawing.

const FUEL_OF: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((p) => [p.id, p.fuel]));
const SHORT: Record<string, string> = {
  nuc: 'Harbor Point',
  coal: 'Ironwood',
  cc1: 'Lakeside',
  cc2: 'Mill Creek',
  ct: 'Eastgate',
  oil: 'Old Quay',
  hydro: 'Falls',
  wind: 'Ridge wind',
  solar: 'Valley solar',
};
const HOUR = 19;
const X_MAX = 2200;

function stackBlocks(day: EnergyDay): StackBlock[] {
  const h = day.hours[HOUR];
  return supplyStack(h.offers)
    .filter((s) => s.end - s.start > 0.5)
    .map((s) => {
      const o = h.offers.find((x) => x.id === s.id)!;
      return { id: s.id, start: s.start, mw: o.mw, price: o.price, dispatched: h.dispatch[s.id] ?? 0, color: FUEL[FUEL_OF[s.id]] };
    });
}

const HEAT = GRAPHIC.orange;
const BURN = GRAPHIC.gold;
const OTHER = '#a8a8a8';
const BX = scale(0, 1.8e6, 24, 372);
const UX = scale(0, 1.25, 430, 620);
const UY = scale(0, 30, 132, 26);
const U_CURVE = Array.from({ length: 126 }, (_, i) => i / 100);

/** The day's gas balance against the pipelines, and the city-gate price curve. */
function GasBalance({ day }: { day: EnergyDay }) {
  const pipeline = GAS_SYSTEM.pipeline;
  const parts = [
    { label: 'heating (utility)', v: day.sendout, color: HEAT },
    { label: 'power plants', v: day.powerBurn, color: BURN },
    { label: 'industry and other', v: GAS_SYSTEM.other, color: OTHER },
  ];
  let x = 0;
  const over = day.gasDemand > pipeline;
  const u = Math.min(1.25, day.utilization);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 160"
      role="img"
      aria-label={`The region’s gas demand: ${fmt(day.sendout / 1000)} thousand MMBtu for heating, ${fmt(day.powerBurn / 1000)} thousand for power plants and ${fmt(GAS_SYSTEM.other / 1000)} thousand for industry, against pipeline capacity of ${fmt(pipeline / 1e6, 1)} million: the pipelines are ${fmt(day.utilization * 100)}% full and the city-gate price is ${usd(day.gas, 2)} per MMBtu.`}
    >
      <text className="ax" x={24} y={14}>
        Gas demand, MMBtu per day
      </text>
      {parts.map((p) => {
        const x0 = BX(x);
        x += p.v;
        const x1 = BX(Math.min(1.8e6, x));
        return <rect key={p.label} x={x0} y={34} width={Math.max(0, x1 - x0)} height={34} fill={p.color} opacity={0.85} />;
      })}
      <line x1={BX(pipeline)} x2={BX(pipeline)} y1={26} y2={80} stroke="#333" strokeWidth={2} />
      <text className="ax ax-m" x={BX(pipeline)} y={94}>
        pipeline capacity
      </text>
      {over && (
        <text x={BX(Math.min(1.75e6, day.gasDemand))} y={30} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.red }}>
          beyond the pipelines
        </text>
      )}
      {[0, 0.5e6, 1e6, 1.5e6].map((v) => (
        <text key={v} className="ax ax-m" x={BX(v)} y={112}>
          {v === 0 ? '0' : `${fmt(v / 1e6, 1)}M`}
        </text>
      ))}
      <text className="ax" x={24} y={140} style={{ fill: TEXT.ink }}>
        {fmt(day.utilization * 100)}% full
      </text>

      <text className="ax" x={430} y={14}>
        City-gate price, $ per MMBtu
      </text>
      <GridY y={UY} ticks={[0, 10, 20, 30]} x0={430} x1={620} format={(v) => `$${v}`} baseline={0} />
      <path d={linePath(U_CURVE.map(UX), U_CURVE.map((v) => UY(citygatePrice(v * pipeline))))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      <line className="cur" x1={UX(u)} x2={UX(u)} y1={26} y2={132} />
      <circle cx={UX(u)} cy={UY(day.gas)} r={6} fill={GRAPHIC.green} stroke="#fcfcfb" strokeWidth={2} />
      {[0, 0.5, 1].map((v) => (
        <text key={v} className="ax ax-m" x={UX(v)} y={148}>
          {fmt(v * 100)}%
        </text>
      ))}
      <text className="ax ax-e" x={620} y={160}>
        how full the pipelines are
      </text>
    </svg>
  );
}

// The winter chart: temperature, gas price and power price, day by day.
const WX0 = 64;
const WX1 = 624;
const DX = scale(0, WINTER_LENGTH - 1, WX0, WX1);
const TY = scale(-5, 65, 92, 22);
const GY = scale(0, 30, 182, 112);
const PY = scale(0, 250, 272, 202);

function WinterChart({ run, winter }: { run: WinterRun; winter: number }) {
  const xs = run.temps.map((_, i) => DX(i));
  const bar = (DX(1) - DX(0)) * 0.7;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Winter ${winter}–${winter + 1} at Calder Bay, December to February: daily mean temperatures from ${fmt(Math.min(...run.temps))} to ${fmt(Math.max(...run.temps))} °F; the city-gate gas price averaged ${usd(run.avgGas, 2)} and peaked at ${usd(run.maxGas, 2)}, above $10 on ${run.daysOver10} days; the daily average power price averaged ${usd(run.avgPower)} and peaked at ${usd(run.maxPower)} per MWh.`}
    >
      <text className="ax" x={WX0} y={14}>
        Daily mean temperature, °F
      </text>
      <GridY y={TY} ticks={[0, 30, 60]} x0={WX0} x1={WX1} format={(v) => `${v}°`} />
      <line x1={WX0} x2={WX1} y1={TY(15)} y2={TY(15)} stroke={GRAPHIC.red} strokeDasharray="3 4" opacity={0.6} />
      <path d={linePath(xs, run.temps.map(TY))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} />

      <text className="ax" x={WX0} y={106}>
        City-gate gas, $ per MMBtu
      </text>
      <GridY y={GY} ticks={[0, 10, 20, 30]} x0={WX0} x1={WX1} format={(v) => `$${v}`} baseline={0} />
      {run.gas.map((g, i) => (
        <rect key={i} x={xs[i] - bar / 2} y={GY(Math.min(30, g))} width={bar} height={GY(0) - GY(Math.min(30, g))} fill={g > PRICE_LIMIT ? GRAPHIC.red : GRAPHIC.green} opacity={0.85} />
      ))}
      <line x1={WX0} x2={WX1} y1={GY(PRICE_LIMIT)} y2={GY(PRICE_LIMIT)} stroke="#777" strokeDasharray="4 4" />

      <text className="ax" x={WX0} y={196}>
        Daily average power price, $ per MWh
      </text>
      <GridY y={PY} ticks={[0, 100, 200]} x0={WX0} x1={WX1} format={(v) => `$${v}`} baseline={0} />
      <path d={linePath(xs, run.power.map((p) => PY(Math.min(250, p))))} fill="none" stroke={GRAPHIC.green} strokeWidth={2} />
      {[
        { i: 0, t: 'Dec 1' },
        { i: 31, t: 'Jan 1' },
        { i: 62, t: 'Feb 1' },
        { i: 89, t: 'Feb 28' },
      ].map((m) => (
        <text key={m.i} className="ax ax-m" x={DX(m.i)} y={292}>
          {m.t}
        </text>
      ))}
    </svg>
  );
}

// Numbers the prose quotes, from the same model the figures run.
const jan = (meanF: number, wind = DAY_DEFAULTS.wind) => dayOf({ ...DAY_DEFAULTS, meanF, wind });
const jul = (meanF: number) => dayOf({ ...DAY_DEFAULTS, season: 'july', meanF });

export default function Lesson() {
  const s = useScenario('day', DAY_DEFAULTS);
  const st = s.state;
  const day = dayOf(st);
  const h = day.hours[HOUR];
  const blocks = stackBlocks(day);
  const maxOffer = Math.max(...h.offers.map((o) => o.price));
  const yMax = maxOffer > 190 || h.price > 190 ? 400 : 200;
  const solved = oilSolved(st);
  const setter = h.marginal ? SHORT[h.marginal] : null;
  const ctCost = plantCost('ct', day.gas);

  const w = useScenario('winter', WINTER_DEFAULTS);
  const ws = useDeferredValue(w.state);
  const run = useMemo(() => winterRun(ws), [ws]);
  const solved2 = pipelineSolved(w.state);

  // Prose numbers.
  const n = useMemo(() => {
    const ref = jan(60);
    const normal = jan(33);
    return {
      ref,
      normal,
      d45: jan(45),
      d40: jan(40),
      d20: jan(20),
      d15: jan(15),
      d10: jan(10),
      d5: jan(5),
      calm: jan(25, 3),
      windy: jan(25, 12),
      h75: jul(75),
      h85: jul(85),
      h90: jul(90),
      coldest: winterRun({ winter: COLDEST_WINTER, pipeline: 1.4, windScale: 1 }),
      calmCold: winterRun({ winter: COLDEST_WINTER, pipeline: 1.4, windScale: 0.6 }),
      bigPipe: winterRun({ winter: COLDEST_WINTER, pipeline: 1.6, windScale: 1 }),
      mild: winterRun({ winter: MILD_WINTER, pipeline: 1.4, windScale: 1 }),
    };
  }, []);
  const coldestT = Math.min(...n.coldest.temps);
  const coldestDay = n.coldest.temps.indexOf(coldestT);

  let caption: string;
  if (h.shortfall > 0.5) caption = `At 19:00 demand outruns every plant in the region by ${mw(h.shortfall)}: the price goes to the $1,000 cap and some customers would have to be cut off.`;
  else caption = `At 19:00 ${setter ?? 'no plant'} sets the price at ${usd(h.price)} per MWh. The gas peaker costs ${usd(ctCost)} to run at today’s gas price; Old Quay oil, ${usd(OIL_COST)}.`;

  return (
    <LessonPage id="weather/4.2">
      <P>
        <a href={lessonHref('weather/4.1')}>The previous lesson</a> turned Calder Bay’s temperatures into degree days, and degree days into the gas that Calder Gas
        & Light must deliver. But the utility isn’t the only buyer of gas in the region, and the weather doesn’t only change how much energy people want. It also
        changes how much the wind and the sun supply. This lesson follows a day’s weather into two markets at once — gas and electricity — and asks what it does
        to their prices.
      </P>
      <P>
        For the electricity we’ll borrow the power system of this site’s electricity course and set it in the Calder region: its nine plants, its demand, and its
        two weather-driven ones, Ridge wind, which becomes the 350 MW wind farm on Hollin Ridge, and the 400 MW Valley solar. Demand on the electricity course’s
        reference day, a mild 60 °F day, peaks at {mw(n.ref.peakDemand)} at 19:00. In the Calder region most homes heat with gas, so cold adds only a little —
        0.4% for every heating degree day beyond that day’s five — while heat adds a lot: 1.3% for every <K tone={WX.index}>cooling degree day</K>, as air
        conditioners switch on. The plants are offered cheapest first, and the last one needed sets the price for everyone, as in the electricity course’s{' '}
        <a href={lessonHref('4.3')}>Lesson 4.3</a> and <a href={lessonHref('4.4')}>Lesson 4.4</a>.
      </P>
      <P>
        Gas comes into the region by pipeline, priced off the national benchmark, Henry Hub, which we’ll hold at $4 per MMBtu. The pipelines can carry{' '}
        {fmt(GAS_SYSTEM.pipeline / 1e6, 1)} million MMBtu a day. While they have room, the <K tone={WX.money}>city-gate price</K> — what gas costs delivered to
        the region — sits about a dollar above Henry Hub. As they fill, buyers must outbid each other for what’s left, and past about 85% full the premium climbs
        steeply, up to $30, where trucked-in liquefied gas and stored gas take over. And the two markets are tied together, because three of the power plants burn
        gas. Lakeside needs 7 MMBtu for each megawatt-hour, so at $4 gas it costs $36 to run and at $10 it costs {usd(plantCost('cc1', 10))}. All the prices in
        this lesson come from the model; none are real quotes.
      </P>
      <P>
        In the next demonstration, the supply stack is the evening peak at 19:00, with each plant’s offer at today’s gas price; the gas chart weighs the day’s
        demand for gas against the pipelines and reads the city-gate price off its curve. Set the day’s weather:
      </P>

      <Figure name="Weather-Energy Model" scenario={s}>
        <Segmented
          label="Season"
          value={st.season}
          onChange={(v) => s.set({ season: v })}
          options={[
            { value: 'january', label: 'A January day' },
            { value: 'july', label: 'A July day' },
          ]}
        />
        <SupplyStackChart
          ariaLabel={`The evening peak at 19:00 on a ${st.season === 'january' ? 'January' : 'July'} day averaging ${fmt(st.meanF)} °F: ${mw(h.demand)} of demand ${h.shortfall > 0.5 ? `outruns the fleet by ${mw(h.shortfall)}, and the price is at the $1,000 cap` : `clears at ${usd(h.price)} per MWh, set by ${setter}`}. Gas costs ${usd(day.gas, 2)} per MMBtu.`}
          blocks={blocks}
          demand={h.demand}
          price={h.price}
          priceLabel={h.shortfall > 0.5 ? '$1,000 cap' : usd(h.price)}
          xMax={X_MAX}
          yMax={yMax}
        />
        <Legend
          items={[
            { label: 'Nuclear', color: FUEL.nuclear },
            { label: 'Wind', color: FUEL.wind },
            { label: 'Solar', color: FUEL.solar },
            { label: 'Hydro', color: FUEL.hydro },
            { label: 'Coal', color: FUEL.coal },
            { label: 'Gas combined-cycle', color: FUEL.gasCC },
            { label: 'Gas peaker', color: FUEL.gasCT },
            { label: 'Oil', color: FUEL.oil },
          ]}
        />
        <GasBalance day={day} />
        <Legend
          items={[
            { label: 'Heating', color: HEAT },
            { label: 'Power plants', color: BURN },
            { label: 'Industry and other', color: OTHER },
          ]}
        />
        <Readouts
          items={[
            { label: 'city-gate gas, per MMBtu', value: usd(day.gas, 2), tone: WX.money },
            { label: 'evening peak demand', value: mw(day.peakDemand) },
            { label: 'evening price, per MWh', value: h.shortfall > 0.5 ? '$1,000' : usd(h.price), tone: WX.money },
            { label: 'day’s average price, per MWh', value: usd(day.avgPrice, 1), tone: WX.money },
          ]}
        />
        <Slider label="Daily mean temperature" tone={WX.temperature} value={st.meanF} min={-5} max={95} onChange={(v) => s.set({ meanF: v })} display={`${fmt(st.meanF)} °F`} />
        <Slider label="Wind on Hollin Ridge" tone={WX.wind} value={st.wind} min={2} max={14} step={0.5} onChange={(v) => s.set({ wind: v })} display={`${fmt(st.wind, 1)} m/s`} />
        <Slider label="Cloud" tone={WX.moisture} value={st.cloud} min={0} max={1} step={0.1} onChange={(v) => s.set({ cloud: v })} display={`${fmt(st.cloud * 100)}%`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        It starts on a normal January day at Calder Bay, averaging 33 °F. The utility needs {fmt(n.normal.sendout / 1000)} thousand MMBtu, the power plants burn{' '}
        {fmt(n.normal.powerBurn / 1000)} thousand, and the pipelines are {fmt(n.normal.utilization * 100)}% full, so gas costs {usd(n.normal.gas, 2)}. The evening
        peak of {mw(n.normal.peakDemand)} reaches past the combined-cycle plants to Eastgate, the gas peaker, which sets {usd(n.normal.peakPrice)}; over the whole
        day, power averages {usd(n.normal.avgPrice, 1)} per megawatt-hour.
      </P>
      <P>
        Now make it colder, a few degrees at a time. At 20 °F the pipelines are {fmt(n.d20.utilization * 100)}% full and gas has barely moved, to{' '}
        {usd(n.d20.gas, 2)}. At 15 °F they are {fmt(n.d15.utilization * 100)}% full and gas is {usd(n.d15.gas, 2)}; at 10 °F, {usd(n.d10.gas, 2)}; at 5 °F, with
        the region asking for more gas than the pipelines carry, {usd(n.d5.gas, 2)}; and at 0 °F it hits the $30 cap. The power price follows, because every gas
        plant’s cost follows the gas price: the day’s average is {usd(n.d10.avgPrice)} per megawatt-hour at 10 °F and {usd(n.d5.avgPrice)} at 5 °F, though the
        evening peak is only {fmt((n.d5.peakDemand / n.normal.peakDemand - 1) * 100)}% higher than on the normal day.
      </P>
      <P>
        That shape is the most important thing in this lesson. Going from 45 °F to 40 °F raises the day’s average power price by{' '}
        {usd(n.d40.avgPrice - n.d45.avgPrice, 2)}; going from 10 °F to 5 °F raises it by {usd(n.d5.avgPrice - n.d10.avgPrice)}. Prices are <b>convex</b> in the
        weather: flat across ordinary days and very steep at the extremes, because supply curves are steep near capacity — the last pipelines’ worth of gas, the
        last plants in the stack. So the money isn’t in the average day. It’s in the tails of the temperature distribution, the coldest tenth of the days of{' '}
        <a href={lessonHref('weather/2.5')}>Lesson 2.5</a>, and in how well a forecast can see them coming, as in <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>.
      </P>
      <P>
        Watch the stack as gas climbs. Old Quay burns oil, so its {usd(OIL_COST)} doesn’t move; Eastgate burns gas, and needs 11 MMBtu for each megawatt-hour.
        Above $11 gas, the oil plant is the cheaper of the two. That isn’t a quirk of the model. In pipeline-constrained regions such as New England, cold snaps
        have pushed city-gate gas prices far above Henry Hub and made oil-fired plants cheaper to run than gas-fired ones.
      </P>

      <Challenge
        id="a"
        question="On a January day, what is the warmest daily mean temperature, to the degree, at which Old Quay oil is cheaper to run than the Eastgate gas peaker?"
        solved={solved}
        status={
          st.season !== 'january'
            ? 'Switch to a January day first.'
            : oilCheaper(st)
              ? `At ${fmt(st.meanF)} °F gas is ${usd(day.gas, 2)}, so Eastgate costs ${usd(ctCost)} — more than oil. Is a warmer day enough?`
              : `At ${fmt(st.meanF)} °F gas is ${usd(day.gas, 2)}, so Eastgate costs ${usd(ctCost)}, less than oil’s ${usd(OIL_COST)}.`
        }
        success={`Solved. At ${fmt(st.meanF)} °F the pipelines are ${fmt(day.utilization * 100)}% full and gas costs ${usd(day.gas, 2)}, so the peaker’s 11 MMBtu per megawatt-hour cost ${usd(ctCost)}, more than oil’s ${usd(OIL_COST)}; a degree warmer, gas is ${usd(dayOf({ ...st, meanF: st.meanF + 1 }).gas, 2)} and the peaker is cheaper again. Nothing about either plant changed. The pipelines filled.`}
      />

      <H2>Heat, wind and sun</H2>
      <P>
        Switch to a July day. Now gas hardly matters: with no heating load, the pipelines run less than a third full whatever the temperature, and gas stays near{' '}
        {usd(n.h85.gas, 2)}. The pressure is on the power plants. At 75 °F, air conditioning lifts the evening peak to {mw(n.h75.peakDemand)}, and Eastgate sets{' '}
        {usd(n.h75.peakPrice)}. At 85 °F the peak is {mw(n.h85.peakDemand)} and Old Quay oil, the last plant in the stack, sets {usd(n.h85.peakPrice)}. At 90 °F the
        region wants {mw(n.h90.peakDemand)} at 19:00, {mw(n.h90.hours[HOUR].shortfall)} more than every plant together can give, and the price goes to the
        $1,000 cap. Winter’s risk runs through both markets; summer’s through electricity alone.
      </P>
      <P>
        The wind works the other way. On a 25 °F January day with a calm 3 m/s on Hollin Ridge, the wind farm produces almost nothing, the gas plants burn{' '}
        {fmt(n.calm.powerBurn / 1000)} thousand MMBtu, and power averages {usd(n.calm.avgPrice, 1)}; with a brisk 12 m/s, they burn {fmt(n.windy.powerBurn / 1000)}{' '}
        thousand and power averages {usd(n.windy.avgPrice, 1)}. Every megawatt-hour of wind displaces the most expensive plant running. The sun helps on summer
        afternoons, but by 19:00 it is low, and in January it has set: cloud barely touches the evening price.
      </P>

      <H2>A winter of prices</H2>
      <P>
        A single day shows the mechanism; a season shows the risk. The next demonstration takes a winter from the course’s simulated archive — December through
        February at Calder Bay, with each day’s own wind on Hollin Ridge and cloud on its rainy days — and runs every day through the same model. Days when gas
        costs more than $10 are drawn in red. It starts on the archive’s coldest winter. Change the winter, the pipeline capacity into the region, and how windy
        the winter is:
      </P>

      <Figure name="Weather-Energy Model · a winter" scenario={w}>
        <WinterChart run={run} winter={ws.winter} />
        <Readouts
          items={[
            { label: 'average gas price', value: usd(run.avgGas, 2), tone: WX.money },
            { label: 'highest gas price', value: usd(run.maxGas, 2), tone: WX.money },
            { label: 'days above $10', value: fmt(run.daysOver10) },
            { label: 'average power price', value: usd(run.avgPower, 1), tone: WX.money },
          ]}
        />
        <Slider label="Winter" value={w.state.winter} min={1} max={40} onChange={(v) => w.set({ winter: v })} display={`year ${w.state.winter}–${w.state.winter + 1}`} />
        <Slider
          label="Pipeline capacity"
          tone={WX.money}
          value={w.state.pipeline}
          min={1.2}
          max={2}
          step={PIPELINE_STEP}
          onChange={(v) => w.set({ pipeline: Math.round(v * 100) / 100 })}
          display={`${fmt(w.state.pipeline, 2)} million MMBtu/day`}
        />
        <Slider label="Wind through the winter" tone={WX.wind} value={w.state.windScale} min={0.6} max={1.4} step={0.1} onChange={(v) => w.set({ windScale: Math.round(v * 10) / 10 })} display={`× ${fmt(w.state.windScale, 1)}`} />
      </Figure>

      <P>
        Winter {COLDEST_WINTER}–{COLDEST_WINTER + 1} bottoms out at {fmt(coldestT, 1)} °F on {coldestDay >= 62 ? `February ${coldestDay - 61}` : coldestDay >= 31 ? `January ${coldestDay - 30}` : `December ${coldestDay + 1}`}.
        Over its 90 days gas averages {usd(n.coldest.avgGas, 2)}, only {usd(n.coldest.avgGas - n.mild.avgGas, 2)} more than in a mild winter such as{' '}
        {MILD_WINTER}–{MILD_WINTER + 1}. But on its coldest day gas costs {usd(n.coldest.maxGas, 2)}. Almost all of the season’s price risk is packed into a handful of days, and an
        average hides them completely.
      </P>
      <P>
        Now change the physics. Make the winter calmer, at 0.6 times its own wind, and the average power price rises from {usd(n.coldest.avgPower, 1)} to{' '}
        {usd(n.calmCold.avgPower, 1)}, while the gas spike barely changes. Add pipeline capacity instead: at 1.6 million MMBtu a day the highest gas price falls to{' '}
        {usd(n.bigPipe.maxGas, 2)}. The cold is the same; the spike was never about the cold alone. It came from cold meeting a pipeline that was nearly full.
      </P>

      <Challenge
        id="b"
        question={`In the coldest winter, ${COLDEST_WINTER}–${COLDEST_WINTER + 1}, with its own winds, what is the least pipeline capacity, to the nearest 0.05 million MMBtu a day, that keeps the city-gate price under $10 on every day?`}
        solved={solved2}
        status={
          w.state.winter !== COLDEST_WINTER || Math.abs(w.state.windScale - 1) > 1e-9
            ? `Set the winter back to ${COLDEST_WINTER}–${COLDEST_WINTER + 1} and the wind to × 1.0 first.`
            : `At ${fmt(w.state.pipeline, 2)} million MMBtu a day the highest gas price is ${usd(run.maxGas, 2)}.`
        }
        success={`Solved. With ${fmt(w.state.pipeline, 2)} million MMBtu a day of pipeline the coldest day’s gas costs ${usd(winterRun(w.state).maxGas, 2)}; with 0.05 million less it would pass $10. That extra capacity would sit idle on almost every other day of the winter, which is why regions rarely build it — and why someone has to bear the price risk of the days it’s missing.`}
      />

      <P>
        Look back at <FigRef to="Weather-Energy Model">the first demonstration</FigRef> with that in mind. A gas utility buying gas on the coldest days, a generator
        whose fuel cost tracks the city-gate price, a retailer who promised customers a fixed electricity price: each is exposed to the weather through prices, and
        the exposure is concentrated in the tails, where physical limits bind. Weather sets more than energy prices, though. On the plains around Marlow it sets
        how much corn grows, and the next lesson follows the same chain from heat and rain to a farm’s harvest.
      </P>
    </LessonPage>
  );
}
