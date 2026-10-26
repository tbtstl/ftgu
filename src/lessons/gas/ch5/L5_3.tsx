import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FUEL,
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
  SupplyStackChart,
  TEXT,
  TimeChart,
  fmt,
  hour,
  lessonHref,
  pct,
  usd,
  useScenario,
  type StackBlock,
} from '../../../framework';
import { clearMeritOrder } from '../../../engines/market/clearing';
import { COST_RECIPE, REFERENCE_FUEL_PRICE, fleetOffers, offerBreakdown, switchingGasPrice } from '../../../engines/market/offerCost';
import { marketDay, normalPlan, planInventory, waterValueOf } from '../../../engines/gas/market';
import { GAS_PLANTS, impliedHeatRate, powerDay, sparkSpread } from '../../../engines/gas/power';
import { MMBTU_PER_MWH } from '../../../engines/gas/properties';
import { COAL_SWITCH_BLOCKS, OIL_SWITCH_VALUE } from '../../../model/gas/demand';
import { normalTemp } from '../../../model/gas/weather';
import { STORAGE_SPECS } from '../../../model/gas/world';
import { STANDARD_FLEET, fleetById } from '../../../model/fleet';
import { SYSTEM_DEMAND } from '../../../model/profiles';
import { XYChart } from '../shared/XYChart';
import { gp } from '../shared/format';

// ---------------------------------------------------------------------------
// The electricity course's region at a gas price.

const NAME: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name]));
const SHORT: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name.split(' ')[0] === 'Old' ? 'Old Quay' : g.name.split(' ')[0]]));
const COLOR: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, FUEL[g.fuel]]));
const LAKESIDE = GAS_PLANTS.find((g) => g.id === 'cc1')!;
const MILL = GAS_PLANTS.find((g) => g.id === 'cc2')!;
const EASTGATE = GAS_PLANTS.find((g) => g.id === 'ct')!;
const IRONWOOD = fleetById('coal');
const FALLS = fleetById('hydro');
const isGas = (id: string | null) => !!id && COST_RECIPE[id]?.fuel === 'gas';

export const G2P_GAS_MIN = 1.5;
export const G2P_GAS_MAX = 12;
export const G2P_GAS_STEP = 0.05;
/** The first demonstration starts at the electricity course's reference gas price, $5.00, at 19:00. */
export const G2P_DEFAULTS = { gas: REFERENCE_FUEL_PRICE.gas, hour: 19 };

/** The region's merit order at one hour and gas price. */
export function g2pHour(gas: number, h: number) {
  const offers = fleetOffers(h, { gas }).filter((o) => o.mw > 0.5);
  const c = clearMeritOrder(offers, SYSTEM_DEMAND[h]);
  return { offers, c, price: c.price, marginal: c.marginal };
}

/** Lakeside's spark spread at an hour: the power price less its fuel and upkeep, $/MWh. */
export function lakesideSpark(gas: number, h: number): number {
  return sparkSpread(g2pHour(gas, h).price, gas, LAKESIDE.heatRate, LAKESIDE.vom);
}

/** The first challenge's target spread at 19:00, $/MWh. */
export const SPARK_TARGET = 12;
/** The first challenge: at 19:00, the gas price at which Lakeside's spark spread is exactly $12. */
export function sparkTargetSolved(s: { gas: number; hour: number }): boolean {
  return s.hour === 19 && Math.abs(lakesideSpark(s.gas, 19) - SPARK_TARGET) < 0.005;
}

const roundGas = (g: number) => Math.round(g / G2P_GAS_STEP) * G2P_GAS_STEP;

/** Daily gas burn (MMBtu) at every gas price on the slider's grid: the power plants' demand curve for gas. */
export const G2P_BURN_SWEEP = Array.from({ length: Math.round((G2P_GAS_MAX - G2P_GAS_MIN) / G2P_GAS_STEP) + 1 }, (_, i) => {
  const gas = roundGas(G2P_GAS_MIN + i * G2P_GAS_STEP);
  const d = powerDay(gas);
  return { gas, mmbtu: d.gasMMBtu, bcf: d.gasBcf };
});

/** Heights (MMBtu a day) on the demand chart at which the four switching prices are labelled: each just above the step that follows its line. */
export const SWITCH_LABEL_AT = [74000, 57000, 46000, 24000];

/** Gas prices at which a gas plant's offer equals another plant's: where the stack reorders. */
export const G2P_SWITCHES = [
  { gas: switchingGasPrice(fleetById('cc2'), FALLS)!, text: 'Mill Creek passes Falls hydro' },
  { gas: switchingGasPrice(fleetById('cc1'), FALLS)!, text: 'Lakeside passes Falls hydro' },
  { gas: switchingGasPrice(fleetById('cc2'), IRONWOOD)!, text: 'Mill Creek passes Ironwood coal' },
  { gas: switchingGasPrice(fleetById('cc1'), IRONWOOD)!, text: 'Lakeside passes Ironwood coal' },
];

// ---------------------------------------------------------------------------
// A cold day: Metro's gas price from the gas market (January 20, storage as planned, as in Lesson 4.2).

const COLD_DAY = 294;
const PLAN = normalPlan();
const SF_INV = planInventory(PLAN, 'saltflat', COLD_DAY);
const HC_INV = Math.round(planInventory(PLAN, 'hollowcreek', COLD_DAY));
export const G2P_COLD_MIN = -5;
export const G2P_COLD_MAX = 30;
export const G2P_COLD_DEFAULTS = { temp: Math.round(normalTemp(COLD_DAY)) };

/** Metro's gas price on January 20 at a temperature, what the region's gas plants pay for fuel (oil above $15), and the power prices that follow. */
export function coldDayG2P(temp: number) {
  const m = marketDay({
    tempF: temp,
    storage: { saltflat: SF_INV, hollowcreek: HC_INV },
    waterValue: {
      saltflat: waterValueOf(PLAN, 'saltflat', COLD_DAY, SF_INV, STORAGE_SPECS.saltflat.workingBcf),
      hollowcreek: waterValueOf(PLAN, 'hollowcreek', COLD_DAY, HC_INV, STORAGE_SPECS.hollowcreek.workingBcf),
    },
  });
  const metro = m.price.metro;
  const fuel = Math.min(metro, OIL_SWITCH_VALUE);
  const day = powerDay(fuel);
  return { metro, calder: m.price.calder, fuel, p19: day.hours[19].price, avg: day.avgPrice, lakeMargin: day.margin.cc1, marginal19: day.hours[19].marginal };
}

const COLD_SWEEP = Array.from({ length: G2P_COLD_MAX - G2P_COLD_MIN + 1 }, (_, i) => ({ temp: G2P_COLD_MIN + i, ...coldDayG2P(G2P_COLD_MIN + i) }));
const coldAt = (t: number) => COLD_SWEEP[Math.round(t) - G2P_COLD_MIN];

/**
 * The most the 19:00 price can reach on January 20: Mill Creek burning gas at the oil-switching price
 * (above it the plants burn oil), $/MWh.
 */
export const COLD_POWER_CEILING = MILL.heatRate * OIL_SWITCH_VALUE + MILL.vom;
/** The second challenge: the warmest whole degree at which the region's 19:00 power price reaches that ceiling. */
export const COLD_POWER_ANSWER = (() => {
  for (let t = G2P_COLD_MAX; t >= G2P_COLD_MIN; t--) if (coldAt(t).p19 >= COLD_POWER_CEILING - 1e-6) return t;
  return NaN;
})();
export function coldPowerSolved(temp: number): boolean {
  return temp === COLD_POWER_ANSWER;
}

// Numbers quoted in the prose.
const BASE = powerDay(G2P_DEFAULTS.gas);
const BASE19 = g2pHour(G2P_DEFAULTS.gas, 19);
const GAS_HOURS_BASE = BASE.hours.filter((x) => isGas(x.marginal)).length;
const LAKE_SET_BASE = BASE.hours.filter((x) => x.marginal === 'cc1').length;
const MILL_SET_LIST = BASE.hours.filter((x) => x.marginal === 'cc2').map((x) => hour(x.hour));
const MILL_SET_BASE = MILL_SET_LIST.length;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? fmt(n);
const MILL_HOURS_BASE = MILL_SET_LIST.length > 1 ? `${MILL_SET_LIST.slice(0, -1).join(', ')} and ${MILL_SET_LIST[MILL_SET_LIST.length - 1]}` : MILL_SET_LIST.join('');
const CHEAP = powerDay(3);
const GAS_HOURS_CHEAP = CHEAP.hours.filter((x) => isGas(x.marginal)).length;
const PER_DOLLAR_19 = MILL.heatRate;
/** Above this gas price Mill Creek, not Ironwood coal, sets the 19:00 price. */
export const MILL_OVER_COAL = G2P_SWITCHES[2].gas;
/** Metro's planned summer prices (Lesson 4.4's seasonal plan, April to October), and the coal-switching step at or below them. */
export const METRO_SUMMER = PLAN.price.metro.slice(0, 7);
export const SUMMER_STEP = Math.max(...COAL_SWITCH_BLOCKS.map((b) => b.value).filter((v) => v <= Math.min(...METRO_SUMMER) + 1e-9));
const IHR19 = impliedHeatRate(BASE19.price, G2P_DEFAULTS.gas);
const IHR_DAY = impliedHeatRate(BASE.avgPrice, G2P_DEFAULTS.gas);
const LAKE_EFF = MMBTU_PER_MWH / LAKESIDE.heatRate;
const BURN_MAX = G2P_BURN_SWEEP[0];
const BURN_MIN = G2P_BURN_SWEEP[G2P_BURN_SWEEP.length - 1];
const NORMAL = coldAt(G2P_COLD_DEFAULTS.temp);
const COLDEST = coldAt(G2P_COLD_MIN);
const BREAK_T = (() => {
  for (let t = G2P_COLD_MAX; t >= G2P_COLD_MIN; t--) if (coldAt(t).metro > NORMAL.metro + 1e-6) return t;
  return NaN;
})();
const OIL_T = (() => {
  for (let t = G2P_COLD_MAX; t >= G2P_COLD_MIN; t--) if (coldAt(t).metro >= OIL_SWITCH_VALUE - 1e-6) return t;
  return NaN;
})();
const SWITCH_VALUES = COAL_SWITCH_BLOCKS.map((b) => b.value);
/** Ironwood coal's offer, $/MWh (coal at its reference price). */
const IRONWOOD_OFFER = offerBreakdown(IRONWOOD).offer;

/** The hours in which a gas plant sets the price, as bands for the day chart. */
function gasBands(hours: Array<{ marginal: string | null }>) {
  const out: Array<{ from: number; to: number; color: string; label?: string }> = [];
  hours.forEach((x, h) => {
    if (!isGas(x.marginal)) return;
    const last = out[out.length - 1];
    if (last && last.to === h) last.to = h + 1;
    else out.push({ from: h, to: h + 1, color: 'rgba(235, 155, 102, 0.16)' });
  });
  if (out.length) out[0].label = 'gas sets the price';
  return out;
}

export default function Lesson() {
  const s = useScenario('gas-to-power', G2P_DEFAULTS);
  const gas = roundGas(s.state.gas);
  const h = s.state.hour;
  const day = useMemo(() => powerDay(gas), [gas]);
  const now = g2pHour(gas, h);
  const spark = sparkSpread(now.price, gas, LAKESIDE.heatRate, LAKESIDE.vom);
  const lakeOffer = LAKESIDE.heatRate * gas + LAKESIDE.vom;
  const ihr = impliedHeatRate(now.price, gas);
  const gasHours = day.hours.filter((x) => isGas(x.marginal)).length;
  const blocks: StackBlock[] = now.c.stack.map((st) => {
    const o = now.offers.find((x) => x.id === st.id)!;
    return {
      id: st.id,
      start: st.start,
      mw: o.mw,
      price: o.price,
      dispatched: now.c.dispatch[st.id] ?? 0,
      color: COLOR[st.id],
      label: st.id === 'cc1' ? 'Lakeside' : undefined,
      highlight: st.id === 'cc1',
      margin: st.id === 'cc1' && (now.c.dispatch.cc1 ?? 0) > 0 ? { from: o.price, to: now.price } : undefined,
    };
  });
  const solvedA = sparkTargetSolved({ gas, hour: h });

  const burnNow = G2P_BURN_SWEEP.find((x) => Math.abs(x.gas - gas) < 1e-9) ?? G2P_BURN_SWEEP[0];

  const c = useScenario('cold-day', G2P_COLD_DEFAULTS);
  const temp = c.state.temp;
  const cold = coldAt(temp);
  const solvedB = coldPowerSolved(temp);

  return (
    <LessonPage id="gas/5.3">
      <P>
        <a href={lessonHref('gas/5.2')}>The previous lesson</a> priced the gas that storage carries into winter. A good deal of that gas, and of all the gas the region
        burns, goes into power plants. Metro’s gas-fired plants are among the region’s biggest customers and its most price-sensitive ones: in{' '}
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> they were the blocks of demand that switch between gas and coal at prices from {gp(Math.min(...SWITCH_VALUES))}{' '}
        to {gp(Math.max(...SWITCH_VALUES))}, and the buyers who turn to oil when gas costs more than {gp(OIL_SWITCH_VALUE, 0)}. So the gas price becomes a power price,
        and the power market feeds back into the gas market. This lesson follows both directions.
      </P>
      <P>
        The electricity course’s region, with its nine plants from Harbor Point nuclear to Old Quay oil, is one part of Metro’s power demand, and its three gas plants
        buy their fuel at Metro’s city gate. A plant’s offer is its <K c="energy">heat rate</K> — the MMBtu it burns for each megawatt-hour — times the{' '}
        <K c="price">gas price</K>, plus its upkeep (<a href={lessonHref('4.3')}>Lesson 4.3</a> of that course). Lakeside burns {LAKESIDE.heatRate} MMBtu per MWh and
        spends {usd(LAKESIDE.vom)} on upkeep, Mill Creek {MILL.heatRate} and {usd(MILL.vom)}, and the Eastgate peaker {fmt(EASTGATE.heatRate, 1)} and{' '}
        {usd(EASTGATE.vom)}. <a href={lessonHref('gas/1.5')}>Lesson 1.5</a> turned Lakeside’s heat rate into an efficiency: it converts {pct(LAKE_EFF)} of the gas’s
        energy into electricity.
      </P>
      <P>
        Two measures follow from that. A gas plant’s margin on each megawatt-hour — the power price less its fuel and upkeep — is its{' '}
        <K c="price">spark spread</K>. And the power price divided by the gas price is the market’s <K c="energy">implied heat rate</K>: the heat rate a plant would
        need for the power price just to pay for its fuel. In the next demonstration the region runs through the electricity course’s reference day, each hour cleared
        in merit order with the gas plants offering at the gas price you choose. The upper chart is the stack at one hour, with Lakeside outlined and the margin it
        earns hatched; the lower one is the price in every hour, shaded where a gas plant sets it. Drag across the lower chart to pick an hour, and change the price of
        gas:
      </P>

      <Figure name="Gas-to-Power Model" scenario={s}>
        <SupplyStackChart
          ariaLabel={`Supply stack at ${hour(h)} with gas at ${gp(gas)} per MMBtu: ${fmt(SYSTEM_DEMAND[h])} MW of demand clears at ${usd(now.price, 2)} per MWh, set by ${NAME[now.marginal ?? ''] ?? 'no plant'}. Lakeside offers ${usd(lakeOffer, 2)}.`}
          blocks={blocks}
          demand={SYSTEM_DEMAND[h]}
          price={now.price}
          priceLabel={usd(now.price, 2)}
          xMax={2000}
          yMax={200}
        />
        <TimeChart
          series={[{ values: day.hours.map((x) => x.price), color: TEXT.green, kind: 'step', width: 2.5 }]}
          bands={gasBands(day.hours)}
          yMin={0}
          yMax={Math.max(60, Math.ceil(Math.max(...day.hours.map((x) => x.price)) / 20) * 20)}
          yLabel="Power price, $/MWh"
          yFormat={(v) => `$${fmt(v)}`}
          height={180}
          cursor={h}
          onScrub={(i) => s.set({ hour: i })}
          ariaLabel={`Hourly power prices over the reference day with gas at ${gp(gas)}: from ${usd(Math.min(...day.hours.map((x) => x.price)), 2)} to ${usd(Math.max(...day.hours.map((x) => x.price)), 2)} per MWh; a gas plant sets the price in ${gasHours} of 24 hours.`}
        />
        <Readouts
          items={[
            { label: `power price at ${hour(h)}`, value: `${usd(now.price, 2)}/MWh · ${SHORT[now.marginal ?? ''] ?? '—'}`, tone: 'green' },
            { label: 'implied heat rate', value: `${fmt(ihr, 2)} MMBtu/MWh` },
            { label: 'Lakeside’s spark spread', value: `${usd(spark, 2)}/MWh`, tone: spark >= 0 ? 'green' : 'red' },
            { label: 'gas burned in the day', value: `${fmt(day.gasMMBtu)} MMBtu`, tone: 'orange' },
          ]}
        />
        <Slider label="Gas price" tone="green" value={gas} min={G2P_GAS_MIN} max={G2P_GAS_MAX} step={G2P_GAS_STEP} onChange={(v) => s.set({ gas: v })} display={`${gp(gas)} per MMBtu`} />
        <Eq label={`Lakeside's spark spread at ${hour(h)}: ${usd(now.price, 2)} minus ${LAKESIDE.heatRate} times ${gp(gas)} minus ${usd(LAKESIDE.vom)} equals ${usd(spark, 2)} per MWh`}>
          <K c="price">spark spread</K>
          <Op>=</Op>
          <K c="price">{usd(now.price, 2)}</K>
          <Op>−</Op>
          <span>{LAKESIDE.heatRate}</span>
          <Op>×</Op>
          <K c="price">{gp(gas)}</K>
          <Op>−</Op>
          <span>{usd(LAKESIDE.vom)}</span>
          <Op>=</Op>
          <K c="price">{usd(spark, 2)}</K>
        </Eq>
        <Caption>
          {isGas(now.marginal)
            ? `At ${hour(h)} ${NAME[now.marginal!]} is the last plant needed, so the gas price runs straight into the power price.`
            : `At ${hour(h)} ${NAME[now.marginal ?? ''] ?? 'no plant'} sets the price; the gas price only decides whether Lakeside runs.`}
        </Caption>
      </Figure>

      <P>
        At {gp(G2P_DEFAULTS.gas)}, the price the electricity course used throughout, a gas plant sets the power price in {GAS_HOURS_BASE} of the day’s 24 hours, nearly
        all of them in the evening: Lakeside in {word(LAKE_SET_BASE)} of them and Mill Creek in the {word(MILL_SET_BASE)} peak hours, {MILL_HOURS_BASE}, when the price is{' '}
        {usd(BASE19.price, 2)}. The rest of the day Ironwood coal sets it at{' '}
        {usd(IRONWOOD_OFFER)}. Drag the gas price at 19:00 and, anywhere above {gp(MILL_OVER_COAL)}, the power price follows it at {usd(PER_DOLLAR_19, 2)} per MWh
        for every dollar on the gas, Mill Creek’s heat rate; below {gp(MILL_OVER_COAL)}, Mill Creek undercuts Ironwood and coal sets the evening price too. That is the
        conversion between the two markets: a heat rate turns dollars per MMBtu into dollars per megawatt-hour. Lower the gas
        price to {gp(3)} and gas sets the price in {GAS_HOURS_CHEAP} hours, because Lakeside now undercuts Ironwood and becomes the plant that sets the price all night.
      </P>
      <P>
        A gas plant lives on its spark spread. At 19:00 at {gp(G2P_DEFAULTS.gas)}, Lakeside earns {usd(lakesideSpark(G2P_DEFAULTS.gas, 19), 2)} on each
        megawatt-hour. The implied heat rate is {fmt(IHR19, 2)} at 19:00 and {fmt(IHR_DAY, 2)} for the day’s average price. A plant whose own heat rate is lower than the implied heat
        rate covers its fuel; one whose heat rate is higher doesn’t. The day’s average implied heat rate sits almost exactly at Lakeside’s{' '}
        {LAKESIDE.heatRate}: at the average price, even the region’s most efficient gas plant wouldn’t quite cover its fuel, let alone its upkeep. It earns its money in the evening hours,
        when Mill Creek sets a higher price, and runs little otherwise — {fmt(BASE.energy.cc1)} of the {fmt(LAKESIDE.capacity * 24)} megawatt-hours it could make in the day.
      </P>

      <Challenge
        id="a"
        figure="Gas-to-Power Model"
        question={`Predict first, from the two plants’ heat rates and upkeep: at 19:00, where Mill Creek sets the price, at what gas price does Lakeside earn a spark spread of exactly $${SPARK_TARGET} per MWh? Then set it and check.`}
        solved={solvedA}
        status={
          h !== 19
            ? `Pick 19:00 on the lower chart first; right now it’s ${hour(h)}.`
            : `At ${gp(gas)} Lakeside’s spark spread at 19:00 is ${usd(spark, 2)}.`
        }
        success={`Solved: ${gp(gas)}. At 19:00 Mill Creek sets the price at ${MILL.heatRate} × the gas price + ${usd(MILL.vom)}, and Lakeside spends ${LAKESIDE.heatRate} × the gas price + ${usd(LAKESIDE.vom)}, so Lakeside keeps ${fmt(MILL.heatRate - LAKESIDE.heatRate, 1)} × the gas price on every megawatt-hour: ${fmt(MILL.heatRate - LAKESIDE.heatRate, 1)} × ${gp(gas)} = ${usd(SPARK_TARGET)}. Dearer gas widens an efficient plant’s margin whenever a less efficient gas plant sets the price.`}
      />

      <P>
        That surprises most people. An efficient gas plant isn’t hurt by expensive gas so long as a thirstier gas plant sets the price: for every dollar on the gas,
        the power price rises by {usd(MILL.heatRate, 2)} per MWh, Mill Creek’s heat rate, and Lakeside’s costs by only {usd(LAKESIDE.heatRate, 2)}. It is hurt when
        gas becomes dear enough, or coal cheap enough, that a coal plant sets the price instead.
      </P>

      <H2>The power plants’ demand for gas</H2>
      <P>
        Turn the question around: how much gas do the power plants burn at each price? In the next demonstration, the step line is the region’s daily gas burn at every
        gas price on the slider, read off the merit order hour by hour. The dot is the price you chose in <FigRef to="Gas-to-Power Model">the first demonstration</FigRef>:
      </P>

      <Figure name="Gas-to-Power Model · the power plants’ demand for gas" scenario={s}>
        <XYChart
          xDomain={[G2P_GAS_MIN, 8]}
          yDomain={[0, 80000]}
          xTicks={[1.5, 2, 3, 4, 5, 6, 7, 8]}
          yTicks={[0, 20000, 40000, 60000, 80000]}
          xFormat={(v) => `$${fmt(v, v % 1 ? 1 : 0)}`}
          yFormat={(v) => `${fmt(v / 1000)}k`}
          yLabel="Gas burned by the region’s power plants, MMBtu a day"
          xLabel="gas price, $/MMBtu"
          height={230}
          series={[{ xs: G2P_BURN_SWEEP.filter((x) => x.gas <= 8).map((x) => x.gas), ys: G2P_BURN_SWEEP.filter((x) => x.gas <= 8).map((x) => x.mmbtu), color: GRAPHIC.orange, kind: 'step', width: 2.5 }]}
          vLines={G2P_SWITCHES.map((x) => ({ at: x.gas, color: '#9a9a9a', dash: '3 4', width: 1 }))}
          markers={gas <= 8 ? [{ x: gas, y: burnNow.mmbtu, color: TEXT.orange, r: 6, label: `${fmt(burnNow.mmbtu)} MMBtu`, labelPos: gas > 5 ? 'above' : 'right' }] : []}
          ariaLabel={`The region's power plants burn ${fmt(BURN_MAX.mmbtu)} MMBtu a day of gas below ${gp(G2P_SWITCHES[0].gas)} and ${fmt(BURN_MIN.mmbtu)} above ${gp(G2P_SWITCHES[3].gas)}, stepping down where gas plants trade places with Falls hydro and Ironwood coal: ${G2P_SWITCHES.map((x) => `${x.text} at ${gp(x.gas)}`).join(', ')}. At ${gp(gas)} they burn ${fmt(burnNow.mmbtu)} MMBtu.`}
        >
          {(x, y) => (
            <g aria-hidden="true">
              {G2P_SWITCHES.map((sw, i) => (
                <text key={sw.text} className="ax" x={x(sw.gas) + 5} y={y(SWITCH_LABEL_AT[i])} style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
                  {gp(sw.gas)} · {sw.text}
                </text>
              ))}
            </g>
          )}
        </XYChart>
        <Legend items={[{ label: 'Daily gas burn', color: GRAPHIC.orange, kind: 'line' }, { label: 'Where the stack reorders', color: '#9a9a9a', kind: 'line', dashed: true }]} />
        <Slider label="Gas price" tone="green" value={gas} min={G2P_GAS_MIN} max={G2P_GAS_MAX} step={G2P_GAS_STEP} onChange={(v) => s.set({ gas: v })} display={`${gp(gas)} per MMBtu`} />
      </Figure>

      <P>
        The curve falls in steps, one wherever a gas plant trades places in the stack with a plant that burns something else. Below {gp(G2P_SWITCHES[0].gas)} both
        combined-cycle plants run ahead of Falls hydro and Ironwood coal, and the region burns {fmt(BURN_MAX.mmbtu)} MMBtu a day. Above{' '}
        {gp(G2P_SWITCHES[3].gas)}, where Lakeside’s {LAKESIDE.heatRate} × gas + {usd(LAKESIDE.vom)} passes Ironwood’s {usd(IRONWOOD_OFFER)}, only the evening
        needs gas, and it burns {fmt(BURN_MIN.mmbtu)}; cheap gas makes the plants burn {fmt(BURN_MAX.mmbtu / BURN_MIN.mmbtu, 1)} times as much. This is where the coal-switching blocks of Lesson 4.1 come from. Metro’s whole power fleet has many plants of many efficiencies, so its steps are
        smaller and more numerous, spread between {gp(Math.min(...SWITCH_VALUES))} and {gp(Math.max(...SWITCH_VALUES))}, and in the seasonal plan of{' '}
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a> Metro’s summer prices sit on or just above one of those steps, the {gp(SUMMER_STEP)} one: they run from{' '}
        {gp(Math.min(...METRO_SUMMER))} to {gp(Math.max(...METRO_SUMMER))}. The power plants deciding between coal and gas are the gas market’s shock absorber.
      </P>

      <H2>A cold day</H2>
      <P>
        On a winter peak the arrow runs the other way. In the gas market of <a href={lessonHref('gas/4.2')}>Lesson 4.2</a>, Metro’s price jumps once Northline and
        Hollow Creek are both at their limits, to the value of the first customer willing to do without. The power plants pay that price too, up to{' '}
        {gp(OIL_SWITCH_VALUE, 0)}: above it, as in the gas model, they burn oil instead, so their fuel never costs more. In the next demonstration it’s January 20, the
        coldest day of a normal year, with storage as planned. Set Metro’s temperature; the upper chart is Metro’s gas price, the lower one the electricity region’s
        price at 19:00 (the reference day’s demand, held fixed):
      </P>

      <Figure name="Gas-to-Power Model · a cold day" scenario={c}>
        <XYChart
          xDomain={[G2P_COLD_MIN, G2P_COLD_MAX]}
          yDomain={[0, 20]}
          xTicks={[0, 10, 20, 30]}
          yTicks={[0, 5, 10, 15, 20]}
          xFormat={(v) => `${v}`}
          yFormat={(v) => `$${v}`}
          yLabel="Gas at Metro, $/MMBtu"
          height={170}
          series={[{ xs: COLD_SWEEP.map((x) => x.temp), ys: COLD_SWEEP.map((x) => Math.min(x.metro, 20)), color: GRAPHIC.green, kind: 'line', width: 2.5 }]}
          hLines={[{ at: OIL_SWITCH_VALUE, color: '#9a9a9a', dash: '4 4', label: `oil switch, ${gp(OIL_SWITCH_VALUE, 0)}`, labelAt: 'end' }]}
          markers={[{ x: temp, y: Math.min(cold.metro, 20), color: TEXT.green, r: 6 }]}
          cursor={temp}
          ariaLabel={`Metro's gas price on January 20 at temperatures from ${G2P_COLD_MIN} to ${G2P_COLD_MAX} °F: ${gp(NORMAL.metro)} on a normal day, rising as the city's supply runs out. At ${temp} °F it is ${gp(cold.metro)}.`}
        />
        <XYChart
          xDomain={[G2P_COLD_MIN, G2P_COLD_MAX]}
          yDomain={[0, 140]}
          xTicks={[0, 10, 20, 30]}
          yTicks={[0, 40, 80, 120]}
          xFormat={(v) => `${v}`}
          yFormat={(v) => `$${v}`}
          yLabel="Power at 19:00, $/MWh"
          xLabel="Metro’s temperature, °F"
          height={180}
          series={[{ xs: COLD_SWEEP.map((x) => x.temp), ys: COLD_SWEEP.map((x) => x.p19), color: GRAPHIC.violet, kind: 'line', width: 2.5 }]}
          markers={[{ x: temp, y: cold.p19, color: TEXT.violet, r: 6 }]}
          cursor={temp}
          ariaLabel={`The electricity region's 19:00 price at each temperature: ${usd(NORMAL.p19, 2)} per MWh on a normal day, up to ${usd(COLDEST.p19, 2)}. At ${temp} °F it is ${usd(cold.p19, 2)}.`}
        />
        <Readouts
          items={[
            { label: 'gas at Metro', value: `${gp(cold.metro)}/MMBtu`, tone: 'green' },
            { label: 'the plants pay for fuel', value: `${gp(cold.fuel)}/MMBtu${cold.metro > OIL_SWITCH_VALUE + 1e-6 ? ' (oil)' : ''}`, tone: 'green' },
            { label: 'power at 19:00', value: `${usd(cold.p19, 2)}/MWh`, tone: 'violet' },
            { label: 'Lakeside’s margin for the day', value: usd(cold.lakeMargin), tone: 'green' },
          ]}
        />
        <Slider label="Metro’s temperature, January 20" tone="teal" value={temp} min={G2P_COLD_MIN} max={G2P_COLD_MAX} onChange={(v) => c.set({ temp: v })} display={`${temp} °F`} />
      </Figure>

      <P>
        At the normal {G2P_COLD_DEFAULTS.temp} °F, gas costs {gp(NORMAL.metro)} at Metro and the region’s power costs {usd(NORMAL.p19, 2)} at 19:00. Nothing changes
        down to {BREAK_T + 1} °F. A degree colder, the city’s gas runs short, and power plants that only just beat coal start switching back; the gas price
        climbs, and the power price climbs {fmt(MILL.heatRate, 1)} times as fast. Colder still, Metro’s gas reaches the {gp(OIL_SWITCH_VALUE, 0)} at which the plants
        turn to oil, and their fuel can cost no more than that however cold it gets.
      </P>

      <Challenge
        id="b"
        question={`Compute first: with fuel at ${gp(OIL_SWITCH_VALUE, 0)}, what does Mill Creek offer at 19:00? That is the highest the 19:00 price can go on January 20. Then find the warmest whole-degree temperature at which the price reaches it.`}
        solved={solvedB}
        status={
          cold.p19 >= COLD_POWER_CEILING - 1e-6
            ? `At ${temp} °F the 19:00 price is at its ceiling. Is this the warmest degree where it gets there?`
            : `At ${temp} °F, gas costs ${gp(cold.metro)} at Metro and power ${usd(cold.p19, 2)} at 19:00.`
        }
        success={`Solved: ${COLD_POWER_ANSWER} °F. With fuel at ${gp(OIL_SWITCH_VALUE, 0)}, Mill Creek offers ${MILL.heatRate} × ${gp(OIL_SWITCH_VALUE, 0)} + ${usd(MILL.vom)} = ${usd(COLD_POWER_CEILING, 2)}, and at ${COLD_POWER_ANSWER} °F Metro’s gas reaches that price, so the 19:00 price is ${usd(coldAt(COLD_POWER_ANSWER).p19, 2)}, more than three times a normal evening’s. A degree warmer, gas is ${gp(coldAt(COLD_POWER_ANSWER + 1).metro)} and power ${usd(coldAt(COLD_POWER_ANSWER + 1).p19, 2)}. Nothing in the electricity market changed; the cold reached it through the gas pipe.`}
      />

      <P>
        Lakeside does well out of the cold: at {OIL_T} °F it earns {usd(coldAt(OIL_T).lakeMargin)} for the day instead of {usd(NORMAL.lakeMargin)}. The two markets peak
        together for two reasons. The same cold that fills Metro’s furnaces raises the demand for electricity — our reference day holds that demand
        still, so a real cold day would push power prices higher yet — and gas plants are the marginal users in both markets at once: the first gas customers to give
        way when gas runs short, and the plants that set the power price when they run. In regions that rely on gas for both heat and power, the coldest days stretch
        both markets at the same moment, which is why a gas-fired plant that can also burn oil, or that holds firm pipeline capacity, is worth so much more in a
        cold winter than its average spark spread suggests.
      </P>
      <P>
        Power plants are one way the region’s gas price reaches beyond the gas market. Ships are another. At Bayport, gas leaves for markets on other continents whose
        prices answer to their own weather and their own shortages, and the difference between those prices and Calder’s, net of everything it costs to bridge it,
        decides whether a cargo sails. That is the subject of <a href={lessonHref('gas/5.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
