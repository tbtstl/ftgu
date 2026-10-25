import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  mix,
  useScenario,
} from '../../../framework';
import { marketDay, normalPlan, planInventory, simulateYear, waterValueOf, type MarketDay, type StorageState, type YearDay } from '../../../engines/gas/market';
import { bindingArcs, corridorDesign } from '../../../engines/gas/network';
import { withdrawCapacity } from '../../../engines/gas/storage';
import { COAL_SWITCH_BLOCKS, LNG_VALUE, OIL_SWITCH_VALUE, PROTECTED_VALUE } from '../../../model/gas/demand';
import { GAS_MONTH_START, gasDayLabel, normalTemp, weatherYear } from '../../../model/gas/weather';
import { BASINS, GAS_NODES, PIPELINE, PIPELINES, STORAGE_SPECS, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { XYChart } from '../shared/XYChart';
import { basis, bcfd, gp } from '../shared/format';

// ---------------------------------------------------------------------------
// One winter day on the network: January 20, the coldest day of a normal year.

/** Day of the gas year shown in the first demonstration: January 20. */
export const HUB_DAY = 294;
const PLAN = normalPlan();
const NL = PIPELINE['calder-metro'];
const RE = PIPELINE['ridgeback-calder'];
const CL = PIPELINE['ridgeback-bayport'];
const HC = STORAGE_SPECS.hollowcreek;
const SF = STORAGE_SPECS.saltflat;
/** Salt Flat holds what the plan has it holding on January 20. */
const SF_INV = planInventory(PLAN, 'saltflat', HUB_DAY);
/** Hollow Creek's planned working gas on January 20, rounded to the slider's step. */
const HC_PLAN = Math.round(planInventory(PLAN, 'hollowcreek', HUB_DAY));

export const HUB_DEFAULTS = { temp: Math.round(normalTemp(HUB_DAY)), hollow: HC_PLAN, northline: NL.capacityBcfd, ridgeback: BASINS[0].productionBcfd };
export type HubState = typeof HUB_DEFAULTS;

/** The day's market for a state of the first demonstration. Each field offers at its water value for that day and inventory. */
export function hubDay(s: HubState): MarketDay {
  const storage: StorageState = { saltflat: SF_INV, hollowcreek: s.hollow };
  const waterValue: StorageState = {
    saltflat: waterValueOf(PLAN, 'saltflat', HUB_DAY, SF_INV, SF.workingBcf),
    hollowcreek: waterValueOf(PLAN, 'hollowcreek', HUB_DAY, s.hollow, HC.workingBcf),
  };
  return marketDay({ tempF: s.temp, storage, waterValue, capacity: { [NL.id]: s.northline }, production: { ridgeback: s.ridgeback } });
}

/** Whether Northline runs at its capacity on a day. */
const northlineFull = (s: HubState) => hubDay(s).flow[NL.id] >= s.northline - 1e-6;
const atStartExceptTemp = (s: HubState) =>
  s.hollow === HUB_DEFAULTS.hollow && Math.abs(s.northline - HUB_DEFAULTS.northline) < 1e-9 && Math.abs(s.ridgeback - HUB_DEFAULTS.ridgeback) < 1e-9;

/**
 * The challenge: with the rest of the network as it starts, the warmest whole degree at which
 * Northline runs full.
 */
export function northlineFullSolved(s: HubState): boolean {
  return atStartExceptTemp(s) && northlineFull(s) && !northlineFull({ ...s, temp: s.temp + 1 });
}

/** The warmest whole degree (°F) at which Northline is full, everything else at its start. */
export function northlineFullTemp(): number {
  for (let t = 45; t >= -15; t--) if (northlineFull({ ...HUB_DEFAULTS, temp: t })) return t;
  return NaN;
}

/** What set Metro's price on a day, in words. */
export function metroSetter(d: MarketDay, s: HubState): string {
  const p = d.price.metro;
  const near = (x: number) => Math.abs(p - x) < 1e-6;
  const hcOffer = waterValueOf(PLAN, 'hollowcreek', HUB_DAY, s.hollow, HC.workingBcf) + 0.05;
  if (near(d.price.calder + NL.variableCost)) return 'gas from Calder Hub, plus the cost of moving it';
  if (near(hcOffer)) return 'Hollow Creek’s withdrawals';
  if (near(PROTECTED_VALUE)) return 'rationing homes';
  if (near(20)) return 'industry shutting down';
  if (near(OIL_SWITCH_VALUE)) return 'power plants switching to oil';
  if (near(8)) return 'interruptible industry cutting back';
  if (COAL_SWITCH_BLOCKS.some((b) => near(b.value))) return 'power plants turning back to coal';
  return 'the last gas to arrive';
}

/** Fill for a node by its price: pale at ordinary prices, warming through orange to red as gas gets scarce. */
function gasFill(p: number): string {
  if (p <= 2) return mix('#dbe9f6', '#eef3e6', Math.max(0, (p - 1) / 1));
  if (p <= 5) return mix('#eef3e6', '#f6e2b8', (p - 2) / 3);
  if (p <= 15) return mix('#f6e2b8', '#f2a078', (p - 5) / 10);
  return mix('#f2a078', '#e0645a', Math.min(1, (p - 15) / 30));
}

// Numbers quoted in the prose.
const START = hubDay(HUB_DEFAULTS);
const COLD = (t: number) => hubDay({ ...HUB_DEFAULTS, temp: t });
/** The warmest whole degree (°F), everything else at its start, at which the day's market satisfies `pred`. */
export function warmestWhere(pred: (d: MarketDay) => boolean): number {
  for (let t = 45; t >= -20; t--) if (pred(COLD(t))) return t;
  return NaN;
}
/** Where Metro first breaks away from the transport cost, and where it reaches each customer's price. */
export const BASIS_STEPS = {
  breaks: warmestWhere((d) => d.price.metro - d.price.calder > NL.variableCost + 0.005),
  interruptible: warmestWhere((d) => d.price.metro >= 8 - 1e-9),
  oil: warmestWhere((d) => d.price.metro >= OIL_SWITCH_VALUE - 1e-9),
  industry: warmestWhere((d) => d.price.metro >= 20 - 1e-9),
  homes: warmestWhere((d) => d.price.metro >= PROTECTED_VALUE - 1e-9),
};
/** What each degree colder adds to Northline's flow at the start, Bcf/d, and the room it has left. */
export const NL_PER_DEGREE = COLD(HUB_DEFAULTS.temp - 1).flow[NL.id] - START.flow[NL.id];
export const NL_ROOM = NL.capacityBcfd - START.flow[NL.id];
/** The challenge's answer: the warmest whole degree at which Northline is full. */
export const NL_FULL_TEMP = northlineFullTemp();
const NL_OUT = (c: number) => hubDay({ ...HUB_DEFAULTS, northline: c });
/** Northline's capacity with one, and with two, of its compressor stations out, Bcf/d (the corridor design of Lesson 3.1). */
export const NL_ONE_OUT = corridorDesign(NL.id, NL.sizeIn, NL.stations - 1).capacityBcfd;
export const NL_TWO_OUT = corridorDesign(NL.id, NL.sizeIn, NL.stations - 2).capacityBcfd;
/** The day Metro's power plants turn to oil: Bayport's price and the LNG terminal's take then. */
export const OIL_DAY = COLD(BASIS_STEPS.oil);
/** What a full shortcut earns per MMBtu at the start: the price difference across it less its variable cost. */
export const SHORTCUT_RENT = {
  coastal: START.price.bayport - START.price.ridgeback - CL.variableCost,
  valley: START.price.metro - START.price.sandhill - PIPELINE['sandhill-metro'].variableCost,
};
/** Ridgeback's outlets: its two pipelines and the field's own use of gas, Bcf/d. */
const TAKEAWAY = RE.capacityBcfd + CL.capacityBcfd + 0.1;
const GLUT = hubDay({ ...HUB_DEFAULTS, ridgeback: 3.1 });

// ---------------------------------------------------------------------------
// A whole winter of basis.

type WinterId = 'mild' | 'typical' | 'harsh';
/** Weather years chosen to show the range: no breakaway, one, and several. */
const WINTER_SEED: Record<WinterId, number> = { mild: 2, typical: 3, harsh: 1 };
const WINTER_LABEL: Record<WinterId, string> = { mild: 'A mild winter', typical: 'A typical winter', harsh: 'A harsh winter' };
const NOV1 = GAS_MONTH_START[7];

const winterCache = new Map<WinterId, YearDay[]>();
/** The simulated winter (November to March) for one of the three weather years. */
export function hubWinter(id: WinterId): YearDay[] {
  let w = winterCache.get(id);
  if (!w) {
    w = simulateYear({ weather: weatherYear(WINTER_SEED[id]) }).slice(NOV1);
    winterCache.set(id, w);
  }
  return w;
}

export function hubWinterStats(id: WinterId) {
  const w = hubWinter(id);
  const b = w.map((d) => d.price.metro - d.price.calder);
  const top = b.reduce((best, x, i) => (x > b[best] ? i : best), 0);
  return {
    breakaways: b.filter((x) => x > 1).length,
    maxBasis: b[top],
    maxDay: w[top].day,
    maxTemp: w[top].tempF,
    maxInv: w[top].storage.hollowcreek,
    avgBasis: b.reduce((a, x) => a + x, 0) / b.length,
    coldest: Math.min(...w.map((d) => d.tempF)),
    coldestDay: w.reduce((a, d) => (d.tempF < a.tempF ? d : a)).day,
    /** Metro's basis, and Hollow Creek's working gas at the start of the day, on the coldest day. */
    coldestBasis: (() => {
      const d = w.reduce((a, x) => (x.tempF < a.tempF ? x : a));
      return d.price.metro - d.price.calder;
    })(),
    coldestInv: (() => {
      const i = w.reduce((best, x, j) => (x.tempF < w[best].tempF ? j : best), 0);
      return i > 0 ? w[i - 1].storage.hollowcreek : w[0].storage.hollowcreek - w[0].storageFlow.hollowcreek;
    })(),
    /** Hollow Creek's working gas at the start of the day the basis peaked. */
    peakInv: top > 0 ? w[top - 1].storage.hollowcreek : w[0].storage.hollowcreek - w[0].storageFlow.hollowcreek,
  };
}

const MONTH_TICKS = [214, 244, 275, 306, 334, 365];
const MONTH_TICK_LABEL: Record<number, string> = { 214: 'Nov', 244: 'Dec', 275: 'Jan', 306: 'Feb', 334: 'Mar', 365: 'Apr' };

export default function Lesson() {
  const s = useScenario('hub', HUB_DEFAULTS);
  const st = s.state;
  const day = useMemo(() => hubDay(st), [st]);
  const binding = bindingArcs(day.problem, day.solution);
  const mb = day.price.metro - day.price.calder;
  const rb = day.price.ridgeback - day.price.calder;
  const caps: Record<string, number> = Object.fromEntries(PIPELINES.map((p) => [p.id, p.id === NL.id ? st.northline : p.capacityBcfd]));
  const setter = metroSetter(day, st);
  const solved = northlineFullSolved(st);
  const atStart = atStartExceptTemp(st);
  const nlFull = day.flow[NL.id] >= st.northline - 1e-6;

  const placeNames = (ids: string[]) => ids.map((id) => PIPELINE[id]?.name ?? id);
  const caption = binding.length
    ? `Full and holding prices apart: ${placeNames(binding).join(', ')}. Metro’s price is set by ${setter}.`
    : `No pipeline is holding prices apart. Metro’s price is set by ${setter}.`;

  const ariaPrices = GAS_NODES.map((n) => `${n.name} ${gp(day.price[n.id])}`).join(', ');

  // Figure 2.
  const [winter, setWinter] = useState<WinterId>('typical');
  const w = hubWinter(winter);
  const ws = hubWinterStats(winter);
  const xs = w.map((d) => d.day + 0.5);
  const basisYs = w.map((d) => d.price.metro - d.price.calder);
  const bTop = Math.max(2, Math.ceil(Math.max(...basisYs) / 2) * 2 + 1);

  return (
    <LessonPage id="gas/4.2">
      <P>
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> treated the region as a single market: one supply curve, one demand curve, one price. But nobody buys gas
        “in the region”. They buy it at a particular point on the network — at the tail of a gathering line in Ridgeback, at an interconnect where one pipeline
        hands gas to another, at the <b>city gate</b> where Metro’s utility takes it off Northline — and Chapter 3 showed that moving gas between those points costs
        money and, when a pipeline is full, can’t be done at all. So there is a price at every point, and the prices differ.
      </P>
      <P>
        If every point traded on its own, each would have only a few buyers and sellers, and its price would be easy to push around and hard to trust. Instead,
        trading gathers where many pipelines meet. That place is a <b>hub</b>, and the region’s is Calder Hub, where Ridgeback Express and the Sandhill Lateral bring gas
        in, Northline and Gulfward take it out, and the Salt Flat caverns sit next door. In North America the same role is played by Henry Hub, a junction of
        pipelines near Erath, Louisiana, which has been the delivery point of the NYMEX natural gas futures contract since it began trading in 1990. Prices
        everywhere else are then quoted as a difference from the hub’s, the <K c="price">basis</K>: the local price minus the hub price.
      </P>
      <P>
        In the next demonstration it’s January 20, the coldest day of a normal year, and every place’s price comes from the market of Lesson 4.1 cleared across the
        network instead of at one point. Each circle shows its place’s price and its basis to Calder; each pipeline, its flow and its capacity. Make the day colder,
        drain Hollow Creek, cut Northline’s capacity as a compressor station outage would, or let Ridgeback produce more:
      </P>

      <Figure name="Hub Price Map" scenario={s}>
        <GasMap
          ariaLabel={`Prices on January 20 at ${fmt(st.temp)} °F: ${ariaPrices} per MMBtu. Metro’s basis is ${basis(mb)} and Ridgeback’s ${basis(rb)}. ${caption}`}
          flows={day.flow}
          capacities={caps}
          nodeInfo={(id: GasNodeId) => ({
            value: gp(day.price[id]),
            sub: id === 'calder' ? 'the hub' : basis(day.price[id] - day.price.calder),
            fill: gasFill(day.price[id]),
          })}
          storage={(id) => {
            const f = day.storageFlow[id as 'saltflat' | 'hollowcreek'];
            const inv = id === 'saltflat' ? SF_INV : st.hollow;
            const verb = f < -1e-6 ? `drawing ${fmt(-f, 2)}` : f > 1e-6 ? `injecting ${fmt(f, 2)}` : 'idle';
            return `${fmt(inv)} Bcf · ${verb}`;
          }}
        />
        <Readouts items={[{ label: 'Hollow Creek can deliver', value: bcfd(withdrawCapacity(HC, st.hollow)), tone: 'gold' }]} />
        <Slider label="Metro’s temperature" tone="teal" value={st.temp} min={-15} max={45} onChange={(v) => s.set({ temp: v })} display={`${fmt(st.temp)} °F`} />
        <Slider label="Working gas in Hollow Creek" tone="gold" value={st.hollow} min={0} max={HC.workingBcf} onChange={(v) => s.set({ hollow: v })} display={`${st.hollow} Bcf`} />
        <Slider
          label="Northline’s capacity"
          tone="orange"
          value={st.northline}
          min={0.6}
          max={NL.capacityBcfd}
          step={0.05}
          onChange={(v) => s.set({ northline: v })}
          display={bcfd(st.northline)}
        />
        <Slider label="Ridgeback’s production" tone="orange" value={st.ridgeback} min={2} max={3.6} step={0.05} onChange={(v) => s.set({ ridgeback: v })} display={bcfd(st.ridgeback)} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At the start Calder trades at {gp(START.price.calder)} per MMBtu. Metro is {basis(START.price.metro - START.price.calder)}, Bayport{' '}
        {basis(START.price.bayport - START.price.calder)}, Ridgeback {basis(START.price.ridgeback - START.price.calder)} and Sandhill{' '}
        {basis(START.price.sandhill - START.price.calder)}. Each basis is exactly the cost of moving gas between that place and the hub, in one direction or the other:
        Metro and Bayport sit downstream and pay to have gas brought to them, while the basins sit upstream and receive the hub price less the cost of getting there.
        This is the locational cost of <a href={lessonHref('gas/3.2')}>Lesson 3.2</a>, now with a market behind it. While pipelines have room, basis is a price for
        transport and nothing more.
      </P>
      <P>
        The caption names two pipelines that are full even so: the Coastal Line and the Valley Line. Each is a shortcut from a basin straight to a market, so it
        fills first, and the gas that doesn’t fit goes the long way round through Calder, which then sets the price at both ends. Across each shortcut the prices
        differ by more than the cost of using it — by an extra {gp(SHORTCUT_RENT.coastal)} per MMBtu on the Coastal Line and {gp(SHORTCUT_RENT.valley)} on the
        Valley Line — and whoever holds space on it keeps that extra. It is what makes space on a full pipeline worth owning, which is where{' '}
        <a href={lessonHref('gas/4.3')}>Lesson 4.3</a> picks up.
      </P>
      <P>
        Metro also has gas of its own nearby. Hollow Creek’s operator offers the field’s gas at its <b>water value</b> — what the gas is expected to be worth later
        in the winter, as hydroelectric operators say of the water behind a dam — and when the field holds what its plan expects, that value is the hub price plus
        the cost of bringing gas up from Calder: Hollow Creek’s gas and
        Northline’s cost the city the same. Today the field holds a fraction more than planned, so its gas is a hair cheaper and the city draws it first — the{' '}
        {bcfd(-START.storageFlow.hollowcreek, 2)} that {fmt(HUB_DEFAULTS.hollow)} Bcf of working gas can deliver (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>).
        Northline brings the rest, {bcfd(START.flow[NL.id], 2)} of its {bcfd(NL.capacityBcfd, 1)}, and that last unit from Calder sets Metro’s price.
      </P>

      <H2>When the city runs short</H2>
      <P>
        Now make Metro colder. Hollow Creek is already delivering all it can and the Valley Line is full, so every extra cubic foot the city burns has to come up
        Northline — about {fmt(NL_PER_DEGREE * 1000)} MMcf/d more for each degree — and while it can, Metro’s price stays the hub’s plus transport. Today Northline
        carries {bcfd(START.flow[NL.id])} of its {bcfd(NL.capacityBcfd, 1)}.
      </P>

      <Challenge
        id="a"
        figure="Hub Price Map"
        question={`Predict first: from Northline’s spare room and the ${fmt(NL_PER_DEGREE * 1000)} MMcf/d each degree adds, at about what temperature does it fill? Then make Metro colder to check, and find the warmest whole degree at which Northline is full.`}
        solved={solved}
        status={
          !atStart
            ? 'Put Hollow Creek, Northline and Ridgeback back where they started (Reset does it), then change only the temperature.'
            : `At ${fmt(st.temp)} °F Northline ${nlFull ? 'is full' : 'still has room'}.`
        }
        success={`Solved: ${fmt(NL_FULL_TEMP)} °F. ${fmt(NL_ROOM * 1000)} MMcf/d of room at ${fmt(NL_PER_DEGREE * 1000)} a degree lasts about ${fmt(NL_ROOM / NL_PER_DEGREE, 1)} degrees, from ${fmt(HUB_DEFAULTS.temp)} °F to about ${fmt(HUB_DEFAULTS.temp - NL_ROOM / NL_PER_DEGREE, 1)} °F. A degree warmer, Metro’s basis is still the ${basis(NL.variableCost)} of transport; here nothing more can reach the city at any price, and it jumps to ${basis(COLD(NL_FULL_TEMP).price.metro - COLD(NL_FULL_TEMP).price.calder)}. Basis doesn’t rise gently with the cold: it sits at the transport cost until the city’s last source is used up, then jumps to the price of the first customer willing to do without.`}
      />

      <P>
        Once Northline is full, Metro’s price is set by whoever is willing to stop using gas: power plants that would turn back to coal, at{' '}
        {gp(COLD(BASIS_STEPS.breaks).price.metro)}, then {gp(COLD(BASIS_STEPS.breaks - 1).price.metro)}; interruptible industry, which gives up its gas at{' '}
        {gp(COLD(BASIS_STEPS.interruptible).price.metro)} from {fmt(BASIS_STEPS.interruptible)} °F; power plants switching to oil at {gp(COLD(BASIS_STEPS.oil).price.metro)} from{' '}
        {fmt(BASIS_STEPS.oil)} °F. Calder doesn’t notice — it stays at {gp(COLD(BASIS_STEPS.oil).price.calder)} — so Metro’s basis leaps from{' '}
        {basis(START.price.metro - START.price.calder)} to {basis(COLD(BASIS_STEPS.oil).price.metro - COLD(BASIS_STEPS.oil).price.calder)} over{' '}
        {BASIS_STEPS.breaks + 1 - BASIS_STEPS.oil} degrees. Colder still, industry shuts down at {gp(COLD(BASIS_STEPS.industry).price.metro)} from {fmt(BASIS_STEPS.industry)} °F, and at{' '}
        {fmt(BASIS_STEPS.homes)} °F there isn’t enough gas left for the city’s homes: the price reaches the {gp(PROTECTED_VALUE, 0)} that stands in our model for rationing.
      </P>

      <P>
        Compare the single market of <a href={lessonHref('gas/4.1')}>Lesson 4.1</a>, where Bayport’s LNG terminal gave way at {gp(LNG_VALUE)}, before Metro’s
        interruptible industry had to stop at $8. On the network the order changes. At {fmt(BASIS_STEPS.oil)} °F Metro’s power plants are burning oil at{' '}
        {gp(OIL_DAY.price.metro)}, while Bayport, on the far side of Calder with gas to spare, still exports its full {bcfd(OIL_DAY.sectors.lng, 1)} at{' '}
        {gp(OIL_DAY.price.bayport)}. Once Northline is full, only Metro’s own users can give way.
      </P>
      <P>
        The same break comes in warmer weather when the city’s supply is weaker. Put the temperature back and lower Northline’s capacity, as if compressor
        stations had failed. With one of its three stations out, Northline can still carry {bcfd(NL_ONE_OUT)}, more than the {bcfd(START.flow[NL.id])} Metro
        needs from it today, and nothing changes. With two out it carries only {bcfd(NL_TWO_OUT)}, and Metro’s basis jumps to{' '}
        {basis(NL_OUT(NL_TWO_OUT).price.metro - NL_OUT(NL_TWO_OUT).price.calder)}; at {bcfd(0.8, 1)} it is {basis(NL_OUT(0.8).price.metro - NL_OUT(0.8).price.calder)}.
        Or drain Hollow Creek, which lowers what it can deliver and, because each Bcf it has left is
        worth more to the rest of the winter, raises the price it asks. Late in a cold winter, a city’s storage is lowest exactly when its demand is highest, which
        is when its basis is most likely to break away.
      </P>

      <H2>Too much gas in the wrong place</H2>
      <P>
        Basis can break the other way too. Ridgeback’s gas leaves on two pipelines, Ridgeback Express and the Coastal Line, and the field uses a little itself:{' '}
        {bcfd(TAKEAWAY, 2)} in all. Raise Ridgeback’s production past that, to {bcfd(3.1, 2)}. Both pipelines fill, the gas that can’t leave has nowhere to go, and
        Ridgeback’s price falls to what it costs producers to keep their gas flowing, {gp(GLUT.price.ridgeback)}: a basis of{' '}
        {basis(GLUT.price.ridgeback - GLUT.price.calder)}. Gas that fetches {gp(GLUT.price.calder)} at the hub is worth only its own cost a few hundred miles
        upstream. Real basins have gone further. At the Waha hub in West Texas,
        where much of the gas comes up with oil and keeps flowing whatever it fetches, full pipelines have at times pushed prices below zero.
      </P>
      <P>
        This lesson’s map holds Calder’s price almost steady while Ridgeback floods, because the storage field at the hub prices its gas off the season’s plan. Over months,
        extra gas would pull the hub down too, as <a href={lessonHref('gas/4.4')}>Lesson 4.4</a> will show. Basis measures the part of a price that belongs to place.
      </P>

      <H2>A winter of basis</H2>
      <P>
        Real winters don’t come one day at a time. In the next demonstration the region runs through three simulated winters — the mild and typical winters of{' '}
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> and a harsh one — day by day, with Hollow Creek drawing down as it goes. The upper chart is Metro’s basis, the middle one Metro’s temperature, and the lower one the working gas left in Hollow Creek. Choose a
        winter:
      </P>

      <Figure name="Hub Price Map · a winter of basis">
        <Segmented
          label="Winter"
          value={winter}
          onChange={setWinter}
          options={(['mild', 'typical', 'harsh'] as WinterId[]).map((id) => ({ value: id, label: WINTER_LABEL[id] }))}
        />
        <XYChart
          xDomain={[214, 365]}
          yDomain={[0, bTop]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => MONTH_TICK_LABEL[v] ?? ''}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Metro’s basis to Calder, $/MMBtu"
          height={170}
          series={[{ xs, ys: basisYs, color: GRAPHIC.green, kind: 'step', width: 2 }]}
          hLines={[{ at: NL.variableCost, color: '#8a8a8a', dash: '4 4', label: 'transport cost', labelAt: 'start' }]}
          ariaLabel={`Metro’s daily basis to Calder through ${WINTER_LABEL[winter].toLowerCase()}: above $1 on ${ws.breakaways} day${ws.breakaways === 1 ? '' : 's'}, highest ${basis(ws.maxBasis)} on ${gasDayLabel(ws.maxDay)}.`}
        />
        <XYChart
          xDomain={[214, 365]}
          yDomain={[-10, 60]}
          yTicks={[0, 20, 40, 60]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => MONTH_TICK_LABEL[v] ?? ''}
          yFormat={(v) => `${v}°`}
          yLabel="Metro’s temperature, °F"
          height={120}
          series={[
            { xs, ys: w.map((d) => normalTemp(d.day)), color: '#9a9a9a', width: 1.5, dash: '4 4' },
            { xs, ys: w.map((d) => d.tempF), color: GRAPHIC.teal, width: 1.8 },
          ]}
          ariaLabel={`Metro’s daily temperature through the winter, coldest ${fmt(ws.coldest)} °F on ${gasDayLabel(ws.coldestDay)}; the dashed line is normal.`}
        />
        <XYChart
          xDomain={[214, 365]}
          yDomain={[0, HC.workingBcf]}
          yTicks={[0, 40, 80, 120]}
          xTicks={MONTH_TICKS}
          xFormat={(v) => MONTH_TICK_LABEL[v] ?? ''}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in Hollow Creek, Bcf"
          height={120}
          series={[
            { xs, ys: w.map((d) => d.storage.hollowcreek), color: GRAPHIC.gold, kind: 'area', opacity: 0.25 },
            { xs, ys: w.map((d) => d.storage.hollowcreek), color: GRAPHIC.gold, width: 2 },
          ]}
          ariaLabel={`Working gas in Hollow Creek through the winter, from ${fmt(w[0].storage.hollowcreek)} Bcf on November 1 to ${fmt(w[w.length - 1].storage.hollowcreek)} Bcf on March 31.`}
        />
        <Legend
          items={[
            { label: 'Metro’s basis', color: GRAPHIC.green, kind: 'line' },
            { label: 'Temperature', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Normal temperature', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Hollow Creek', color: GRAPHIC.gold },
          ]}
        />
        <Readouts
          items={[
            { label: 'days above $1', value: fmt(ws.breakaways), tone: ws.breakaways ? 'red' : 'green' },
            { label: 'highest basis', value: basis(ws.maxBasis), tone: 'green' },
            { label: 'average basis', value: basis(ws.avgBasis, 3), tone: 'green' },
            { label: 'coldest day', value: `${fmt(ws.coldest)} °F` },
          ]}
        />
      </Figure>

      <WinterProse />

      <P>
        That is the pattern behind every congested market area’s basis: a flat line at the cost of transport for most of the year, and a few days that carry
        nearly all of its value. Someone holding the right to move gas on Northline earns almost nothing on most days and a great deal on a handful. Who holds that
        right, how they get it, and what it’s worth is the subject of <a href={lessonHref('gas/4.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}

/** The paragraph after the winter figure, with the three winters' numbers. */
function WinterProse() {
  const mild = hubWinterStats('mild');
  const typical = hubWinterStats('typical');
  const harsh = hubWinterStats('harsh');
  return (
    <>
      <P>
        In the mild winter the basis never leaves the transport cost: its coldest day is {fmt(mild.coldest)} °F, and Hollow Creek always has gas to spare. The
        typical winter’s coldest day, {fmt(typical.coldest)} °F on {gasDayLabel(typical.coldestDay)}, lifts Metro’s basis only to{' '}
        {basis(typical.coldestBasis)}, because Hollow Creek still holds {fmt(typical.coldestInv)} Bcf and can deliver most of what’s asked for. The one day that
        typical winter breaks away comes on{' '}
        {gasDayLabel(typical.maxDay)}, at a milder {fmt(typical.maxTemp)} °F, with Hollow Creek down to {fmt(typical.peakInv)} Bcf: Metro’s basis jumps to{' '}
        {basis(typical.maxBasis)}. The harsh winter breaks away on {harsh.breakaways} days and peaks at {basis(harsh.maxBasis)} on its coldest day,{' '}
        {gasDayLabel(harsh.maxDay)}, at {fmt(harsh.maxTemp)} °F.
      </P>
      <P>
        It’s the arithmetic of <FigRef to="Hub Price Map">the first demonstration</FigRef>: Metro’s basis breaks only when Northline and Hollow Creek are both at
        their limits, and Hollow Creek’s limit shrinks as it empties, so the same cold does more damage in March than in December. And even in the harsh winter,
        the basis averaged over all {fmt(hubWinter('harsh').length)} days is only {basis(harsh.avgBasis, 2)}.
      </P>
    </>
  );
}
