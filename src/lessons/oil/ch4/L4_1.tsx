import { useMemo } from 'react';
import { Caption, Challenge, Eq, FigRef, Figure, Frac, H2, K, Legend, LessonPage, Op, P, Readouts, Segmented, Slider, Sub, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { blend, blendViscosity, crude, viscosity } from '../../../engines/oil/assay';
import { costPerBarrel, hydraulics, maxFlow, type Fluid } from '../../../engines/oil/pipeline';
import { KESSLER_CALDER, PUMP_POWER_PRICE, TYPICAL_CRUDE } from '../../../model/oil/logistics';
import { XYChart } from '../shared/charts';

export type FluidId = 'ridgeback' | 'mix' | 'northfield' | 'coldwater';

const COLDWATER_PARTS = [
  { crude: crude('coldwater'), share: 80 },
  { crude: crude('ridgeback'), share: 20 },
];

/** The crudes the line can carry, at its temperature (the Coldwater blend at its pipeline's 10 °C rating). */
export const FLUIDS: Record<FluidId, Fluid> = {
  ridgeback: { name: 'Ridgeback Light', sg: crude('ridgeback').sg, viscosity: viscosity(crude('ridgeback'), 15) },
  mix: TYPICAL_CRUDE,
  northfield: { name: 'Northfield Sour', sg: crude('northfield').sg, viscosity: viscosity(crude('northfield'), 15) },
  coldwater: { name: 'Coldwater blend', sg: blend(COLDWATER_PARTS).sg, viscosity: blendViscosity(COLDWATER_PARTS, 10) },
};
const FLUID_IDS: FluidId[] = ['ridgeback', 'mix', 'northfield', 'coldwater'];
const FLUID_LABEL: Record<FluidId, string> = { ridgeback: 'Ridgeback Light', mix: 'Basin mix', northfield: 'Northfield Sour', coldwater: 'Coldwater blend' };

const LINE = KESSLER_CALDER;
export const FLOW_STEP = 5;
export const FLOW_RANGE = { min: 50, max: 700 };
export const STATION_RANGE = { min: 1, max: 6 };
/** The tariff the course's network charges on this line, $/bbl. */
export const TARIFF = 2.0;
export const CAPITAL_DEFAULT = LINE.capital / 1e9;
export const CAPITAL_STEP = 0.1;

/** Challenge a: the most Northfield Sour (kb/d, on the 5 kb/d grid) the line carries with its three stations. */
export function northfieldMaxSolved(fluid: FluidId, kbd: number, stations: number): boolean {
  if (fluid !== 'northfield' || stations !== LINE.stations) return false;
  const m = maxFlow(LINE, FLUIDS.northfield, stations) / 1000;
  return kbd <= m + 1e-9 && kbd + FLOW_STEP > m;
}

/** Challenge b: the lowest throughput (5 kb/d grid) at which the line's full cost falls below the $2.00 tariff, at its $1.8 billion cost. */
export function tariffSolved(kbd: number, capitalB: number): boolean {
  if (Math.abs(capitalB - CAPITAL_DEFAULT) > 1e-9) return false;
  const cost = (q: number) => costPerBarrel(LINE, TYPICAL_CRUDE, q * 1000).total;
  return cost(kbd) < TARIFF && cost(kbd - FLOW_STEP) >= TARIFF;
}

export interface OperatingProfile {
  points: Array<[number, number]>;
  /** Pressure each station discharges at, psi. */
  discharge: number;
  /** Whether the installed stations can deliver this flow. */
  feasible: boolean;
  /** True when the line falls fast enough that no pumping is needed. */
  gravity: boolean;
}

/**
 * Pressure along the line with the installed stations evenly spaced, each adding an equal share of
 * the pressure the flow needs (or boosting to the maximum allowable pressure if that isn't enough).
 */
export function operatingProfile(fluid: Fluid, bpd: number, stations: number, n = 201): OperatingProfile {
  const h = hydraulics(LINE, fluid, bpd);
  const spacing = LINE.lengthMiles / stations;
  const gravity = h.frictionPsi + h.elevationPsi <= 0;
  // Each segment loses its share of everything the pumps must supply (friction, elevation and the
  // pressure kept at delivery), so a segment ends exactly at the intake pressure when the stations
  // just suffice, and below it when they don't.
  const perMile = gravity ? (h.frictionPsi + h.elevationPsi) / LINE.lengthMiles : h.totalPsi / LINE.lengthMiles;
  // Feasible when the stations together can supply all the pressure the flow needs (as in maxFlow).
  const feasible = h.totalPsi <= stations * (LINE.maop - LINE.suction) + 1e-9;
  const discharge = gravity ? LINE.suction : feasible ? LINE.suction + h.totalPsi / stations : LINE.maop;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const mile = (i / (n - 1)) * LINE.lengthMiles;
    const k = Math.min(stations - 1, Math.floor(mile / spacing + 1e-9));
    points.push([mile, discharge - perMile * (mile - k * spacing)]);
  }
  return { points, discharge, feasible, gravity };
}

function kbd(x: number): string {
  return `${fmt(x)} kb/d`;
}

function cents(x: number): string {
  return x < 1 ? `${fmt(x * 100, 1)}¢` : usd(x, 2);
}

export default function Lesson() {
  const s1 = useScenario('line', { fluid: 'mix' as FluidId, flow: 400, stations: LINE.stations });
  const { fluid, flow, stations } = s1.state;
  const fl = FLUIDS[fluid];
  const h = hydraulics(LINE, fl, flow * 1000);
  const prof = useMemo(() => operatingProfile(fl, flow * 1000, stations), [fl, flow, stations]);
  const cap = useMemo(() => maxFlow(LINE, fl, stations) / 1000, [fl, stations]);
  const solvedA = northfieldMaxSolved(fluid, flow, stations);

  const s2 = useScenario('tariff', { throughput: 300, capital: CAPITAL_DEFAULT });
  const line2 = useMemo(() => ({ ...LINE, capital: s2.state.capital * 1e9 }), [s2.state.capital]);
  const cost = costPerBarrel(line2, TYPICAL_CRUDE, s2.state.throughput * 1000);
  const mixCap = useMemo(() => maxFlow(LINE, TYPICAL_CRUDE, LINE.stations) / 1000, []);
  const curve = useMemo(() => {
    const total: Array<[number, number]> = [];
    const capital: Array<[number, number]> = [];
    const energy: Array<[number, number]> = [];
    for (let q = 100; q <= 480; q += 5) {
      const c = costPerBarrel(line2, TYPICAL_CRUDE, q * 1000);
      total.push([q, c.total]);
      capital.push([q, c.capital + c.operations]);
      energy.push([q, c.energy]);
    }
    return { total, capital, energy };
  }, [line2]);
  const energyAt = (q: number) => hydraulics(LINE, TYPICAL_CRUDE, q * 1000).energyPerBbl * q;
  const marginal = (q: number) => (energyAt(q + 1) - energyAt(q)) / 1;
  const solvedB = tariffSolved(s2.state.throughput, s2.state.capital);

  // Reference numbers for the prose.
  const mix200 = hydraulics(LINE, TYPICAL_CRUDE, 200000);
  const mix400 = hydraulics(LINE, TYPICAL_CRUDE, 400000);
  const cw200 = hydraulics(LINE, FLUIDS.coldwater, 200000);
  const cw250 = hydraulics(LINE, FLUIDS.coldwater, 250000);
  const caps = useMemo(() => Object.fromEntries(FLUID_IDS.map((id) => [id, maxFlow(LINE, FLUIDS[id], LINE.stations) / 1000])) as Record<FluidId, number>, []);
  const mixCap4 = useMemo(() => maxFlow(LINE, TYPICAL_CRUDE, 4) / 1000, []);
  const c400 = costPerBarrel(LINE, TYPICAL_CRUDE, 400000);
  const c200 = costPerBarrel(LINE, TYPICAL_CRUDE, 200000);
  const cMax = costPerBarrel(LINE, TYPICAL_CRUDE, mixCap * 1000);

  const stationMiles = Array.from({ length: stations }, (_, k) => (k * LINE.lengthMiles) / stations);
  const needText = prof.gravity
    ? 'none — the line runs downhill fast enough'
    : `${h.stationsNeeded} of ${stations}`;

  return (
    <LessonPage id="oil/4.1">
      <P>
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> ended at Port Calder with the refinery choosing its crudes, and a question about geography. Coldwater Heavy starts far
        to the north; Ridgeback Light and Northfield Sour start in an inland basin; Seaboard Blend comes by sea. This chapter follows the barrels on those journeys and
        asks what moving them costs — and what happens to prices when a route fills up.
      </P>
      <P>
        Over land, where one has been built, a pipeline is the cheapest way to move crude. In our world, the basin’s gathering lines bring its crude to the tank farms of
        the Kessler hub, and the Coldwater line brings diluted heavy oil down from the north. From Kessler, the <b>Kessler–Calder line</b> carries crude {fmt(LINE.lengthMiles)}{' '}
        miles to the coast: a 30-inch steel pipe with three pump stations, falling {fmt(-LINE.elevationFt)} feet on the way. A pipeline isn’t dedicated to one crude. It
        carries batches, one grade after another, with a little mixing where they meet.
      </P>
      <P>
        Pushing oil through a pipe takes <K tone="blue">pressure</K>, because the oil rubs against the wall and against itself. The loss is given by the Darcy–Weisbach
        equation, named for two nineteenth-century engineers: over a length L of pipe with diameter D, the pressure lost to friction is
      </P>
      <Eq label="Pressure lost to friction equals the friction factor times length over diameter times density times velocity squared over two">
        <span>
          Δp<Sub>friction</Sub>
        </span>
        <Op>=</Op>
        <K tone="violet">f</K>
        <Op>×</Op>
        <Frac top="L" bottom="D" />
        <Op>×</Op>
        <Frac top={<>ρ <K tone="orange">v</K>²</>} bottom="2" />
      </Eq>
      <P>
        where ρ is the oil’s density, <K tone="orange">v</K> its speed, and <K tone="violet">f</K> the friction factor. The friction factor depends on the{' '}
        <b>Reynolds number</b>, the ratio of the oil’s momentum to its <K tone="violet">viscosity</K>. Below about 2,000–2,300, the flow is <b>laminar</b>, sliding in smooth
        layers; above, it is <b>turbulent</b>, churning in eddies. In the next demonstration, the line’s pressure is drawn from Kessler to the coast. Each pump station raises
        it, friction wears it down, and it must never exceed the pipe’s maximum allowable operating pressure of {fmt(LINE.maop)} psi or fall below the {LINE.suction} psi the next
        pump needs at its intake. Choose a crude, and set the flow and the number of pump stations:
      </P>

      <Figure name="Oil Pipeline Simulator" scenario={s1}>
        <Segmented label="Crude" value={fluid} onChange={(v) => s1.set({ fluid: v })} options={FLUID_IDS.map((id) => ({ value: id, label: FLUID_LABEL[id] }))} />
        <Legend
          items={[
            { label: 'Pressure along the line', color: prof.feasible ? '#4590ce' : '#e75b55', kind: 'line' },
            { label: 'Maximum allowable pressure', color: '#c4382f', kind: 'line', dashed: true },
            { label: 'Pump station', color: '#333' },
          ]}
        />
        <XYChart
          ariaLabel={`Pressure along the 500-mile Kessler–Calder line carrying ${fmt(flow)} thousand barrels a day of ${FLUID_LABEL[fluid]} with ${stations} pump station${stations > 1 ? 's' : ''}: ${prof.gravity ? 'no pumping needed' : prof.feasible ? `each station discharges at ${fmt(prof.discharge)} psi` : `the stations can’t keep the pressure above ${LINE.suction} psi; the line can carry at most ${fmt(cap)} thousand barrels a day`}.`}
          height={250}
          x={[0, LINE.lengthMiles]}
          y={[0, 1600]}
          xTicks={[0, 100, 200, 300, 400, 500]}
          yTicks={[0, 400, 800, 1200, 1600]}
          xFormat={(v) => (v === 0 ? 'Kessler' : v === 500 ? 'Port Calder' : `${v}`)}
          yFormat={(v) => fmt(v)}
          xLabel="miles from Kessler"
          yLabel="Pressure, psi"
          margin={[56, 24, 28, 40]}
          refs={[
            { axis: 'y', at: LINE.maop, color: '#c4382f', dash: '6 4', label: `${fmt(LINE.maop)} psi limit` },
            { axis: 'y', at: LINE.suction, color: '#777', dash: '3 3' },
          ]}
          series={[{ points: prof.points, color: prof.feasible ? '#4590ce' : '#e75b55', width: 3 }]}
        >
          {(sx, sy) => (
            <g>
              {stationMiles.map((m) => (
                <g key={m}>
                  <path d={`M${sx(m)} ${sy(prof.discharge) - 12} l-7 12 l14 0 Z`} fill={prof.gravity ? '#fcfcfb' : '#333'} stroke="#333" strokeWidth={1.5} />
                </g>
              ))}
              <text className="ax" x={sx(500) - 4} y={sy(LINE.suction) - 6} textAnchor="end">
                {LINE.suction} psi needed at each intake
              </text>
              {!prof.feasible && (
                <text x={sx(250)} y={sy(800)} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: '#c4382f' }}>
                  Not enough pumping: the pressure runs out between stations
                </text>
              )}
            </g>
          )}
        </XYChart>
        <Readouts
          items={[
            { label: <K tone="orange">speed of the oil</K>, value: `${fmt(h.velocity / 0.3048, 1)} ft/s`, tone: 'orange' },
            { label: 'Reynolds number', value: `${fmt(h.reynolds)} · ${h.regime}` },
            { label: <K tone="violet">friction loss</K>, value: `${fmt(h.psiPerMile, 2)} psi/mile`, tone: 'violet' },
            { label: 'stations needed', value: needText },
            { label: <K tone="red">pumping power</K>, value: `${fmt(h.electricMW, 1)} MW`, tone: 'red' },
            { label: <K c="price">electricity per barrel</K>, value: cents(h.energyPerBbl), tone: 'green' },
          ]}
        />
        <Slider label="Flow" tone="orange" value={flow} min={FLOW_RANGE.min} max={FLOW_RANGE.max} step={FLOW_STEP} onChange={(v) => s1.set({ flow: v })} display={kbd(flow)} />
        <Slider label="Pump stations" value={stations} min={STATION_RANGE.min} max={STATION_RANGE.max} onChange={(v) => s1.set({ stations: v })} display={`${stations}`} />
        <Caption>
          {prof.feasible
            ? `With ${stations} station${stations > 1 ? 's' : ''}, the line can carry up to ${kbd(cap)} of ${FLUID_LABEL[fluid]}.`
            : `With ${stations} station${stations > 1 ? 's' : ''}, ${FLUID_LABEL[fluid]} tops out at ${kbd(cap)}; ${fmt(flow)} kb/d needs ${h.stationsNeeded}.`}{' '}
          Electricity is priced at a simulated ${PUMP_POWER_PRICE} per MWh.
        </Caption>
      </Figure>

      <P>
        Start with the basin mix, the blend of crudes the line usually carries, at {kbd(400)}. The oil moves at about {fmt(mix400.velocity / 0.3048, 1)} feet a second and
        loses {fmt(mix400.psiPerMile, 2)} psi to friction every mile; the three stations share the work. Halve the flow to {kbd(200)} and the loss falls to{' '}
        {fmt(mix200.psiPerMile, 2)} psi a mile. Doubling the flow multiplies the friction loss by {fmt(mix400.frictionPsi / mix200.frictionPsi, 1)}: twice the speed,
        squared, eased a little by a friction factor that falls as the flow grows more turbulent. Downhill helps, too. The line’s {fmt(-LINE.elevationFt)}-foot fall is
        worth {fmt(-mix400.elevationPsi)} psi of free push for the basin mix, so at slow rates it can run without pumping at all.
      </P>
      <P>
        The crude matters as much as the flow. With three stations, the line carries at most {kbd(caps.ridgeback)} of thin Ridgeback Light, {kbd(caps.mix)} of the basin
        mix, and {kbd(caps.northfield)} of Northfield Sour, whose viscosity, as <a href={lessonHref('oil/1.3')}>Lesson 1.3</a> showed, is many times higher. The Coldwater
        blend is thicker still: at {kbd(200)} its Reynolds number is only {fmt(cw200.reynolds)}, so it flows in smooth, laminar layers; push it past about{' '}
        {kbd(240)} and it turns turbulent, and the friction loss jumps from {fmt(cw200.psiPerMile, 1)} to {fmt(cw250.psiPerMile, 1)} psi a mile by {kbd(250)}. Heavy
        crude is expensive to pipe.
      </P>

      <Challenge
        id="a"
        question="With the line’s three pump stations, what is the most Northfield Sour it can carry, to the nearest 5 kb/d?"
        solved={solvedA}
        status={
          fluid !== 'northfield' || stations !== LINE.stations
            ? 'Choose Northfield Sour and three pump stations.'
            : prof.gravity
              ? `${kbd(flow)} of Northfield Sour flows downhill with no pumping. Try more.`
              : prof.feasible
              ? `${kbd(flow)} of Northfield Sour flows, with ${h.stationsNeeded} of the 3 stations’ worth of pumping needed.`
              : `${kbd(flow)} is too much: the pressure runs out between stations.`
        }
        success={`Solved: ${kbd(flow)}. Above about ${kbd(caps.northfield)}, the three stations can’t make up what friction takes. A fourth station would lift the limit — but every extra station runs into the same steeply rising curve.`}
      />

      <H2>Power</H2>
      <P>
        Every psi the pumps add costs energy. The power a pump delivers is the flow times the pressure it adds; dividing by the efficiency of the pumps and motors, about{' '}
        {fmt(0.75 * 100)}% here, gives the electricity it draws. At {kbd(400)} of the basin mix the line’s pumps draw {fmt(mix400.electricMW, 1)} MW. Because the
        pressure needed grows faster than the flow, power grows faster still: at {kbd(200)} they draw only {fmt(mix200.electricMW, 1)} MW. Yet the bill is small. At a
        simulated ${PUMP_POWER_PRICE} per megawatt-hour, pumping at {kbd(400)} costs {cents(mix400.energyPerBbl)} a barrel.
      </P>

      <H2>What a barrel costs to move</H2>
      <P>
        Most of a pipeline’s cost was paid before the first barrel moved. The Kessler–Calder line cost {usd(LINE.capital / 1e9, 1)} billion to build in our model, and its
        owner needs a return on that whether the line is full or empty: we charge 12% of the capital a year, plus upkeep. In the next demonstration, that annual cost is
        spread over the year’s barrels at each throughput, together with the electricity. Set the throughput, and what the line cost to build:
      </P>

      <Figure name="Oil Pipeline Simulator · tariffs" scenario={s2}>
        <Legend
          items={[
            { label: 'Total cost per barrel', color: '#6d9c37', kind: 'line' },
            { label: 'Capital and upkeep', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Electricity', color: '#e75b55', kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Cost per barrel of moving the basin mix on the Kessler–Calder line against throughput, for a line that cost $${fmt(s2.state.capital, 1)} billion. At ${fmt(s2.state.throughput)} thousand barrels a day it costs ${usd(cost.total, 2)}: ${usd(cost.capital + cost.operations, 2)} of capital and upkeep and ${usd(cost.energy, 2)} of electricity. The line is full at ${fmt(mixCap)} thousand barrels a day.`}
          height={240}
          x={[100, 500]}
          y={[0, 8]}
          xTicks={[100, 200, 300, 400, 500]}
          yTicks={[0, 2, 4, 6, 8]}
          yFormat={(v) => `$${v}`}
          xLabel="throughput, kb/d"
          yLabel="Cost per barrel moved"
          series={[
            { points: curve.capital, color: '#9a9a9a', width: 2, dash: '6 4' },
            { points: curve.energy, color: '#e75b55', width: 2 },
            { points: curve.total, color: '#6d9c37', width: 3 },
          ]}
          refs={[
            { axis: 'x', at: s2.state.throughput, cursor: true },
            { axis: 'x', at: mixCap, color: '#333', dash: '2 3', label: 'full' },
            { axis: 'y', at: TARIFF, color: '#3f7a1e', dash: '4 4', label: `$${TARIFF.toFixed(2)} tariff` },
          ]}
          markers={[{ x: s2.state.throughput, y: cost.total, color: '#3f7a1e', r: 6 }]}
        />
        <Readouts
          items={[
            { label: 'capital and upkeep', value: usd(cost.capital + cost.operations, 2) },
            { label: <K tone="red">electricity</K>, value: usd(cost.energy, 2), tone: 'red' },
            { label: <K c="price">total per barrel</K>, value: usd(cost.total, 2), tone: 'green' },
            { label: 'electricity for one more barrel', value: usd(marginal(s2.state.throughput), 2) },
          ]}
        />
        <Slider label="Throughput" tone="orange" value={s2.state.throughput} min={100} max={480} step={FLOW_STEP} onChange={(v) => s2.set({ throughput: v })} display={kbd(s2.state.throughput)} />
        <Slider
          label="Cost to build"
          tone="green"
          value={s2.state.capital}
          min={1}
          max={3}
          step={CAPITAL_STEP}
          onChange={(v) => s2.set({ capital: Math.round(v * 10) / 10 })}
          display={`$${fmt(s2.state.capital, 1)} billion`}
        />
      </Figure>

      <P>
        At {kbd(200)} each barrel carries {usd(c200.total, 2)} of cost; at {kbd(400)}, {usd(c400.total, 2)}; full, at about {kbd(mixCap)}, {usd(cMax.total, 2)}. Nearly
        all of it is capital. The cost of moving one more barrel, though, is only the electricity it adds — about {usd(marginal(400), 2)} at {kbd(400)}, more than the
        average electricity per barrel because each extra barrel raises the pressure for all the rest. A pipeline’s economics are a large fixed cost and a tiny marginal
        one, so its owner wants it full. Shippers pay a <b>tariff</b> per barrel to recover the fixed cost; our world’s network charges {usd(TARIFF, 2)} on this line.
      </P>

      <Challenge
        id="b"
        question={`With the line at its ${usd(CAPITAL_DEFAULT, 1)} billion cost, what is the lowest throughput, to the nearest 5 kb/d, at which its full cost per barrel falls below the ${usd(TARIFF, 2)} tariff?`}
        solved={solvedB}
        status={
          Math.abs(s2.state.capital - CAPITAL_DEFAULT) > 1e-9
            ? `Set the cost to build back to $${fmt(CAPITAL_DEFAULT, 1)} billion.`
            : `At ${kbd(s2.state.throughput)}, a barrel costs ${usd(cost.total, 2)} to move.`
        }
        success={`Solved: ${kbd(s2.state.throughput)}, where a barrel costs ${usd(cost.total, 2)}. Below that, the tariff doesn’t cover the line’s cost; above it, every extra barrel adds margin. That’s why pipeline companies sign shippers to long contracts before they build: committed volume is what makes the capital back.`}
      />

      <P>
        One more thing follows from the shape of these curves. Once the line is full, no tariff — however high — moves another barrel through it. Adding a fourth station
        would lift the basin mix’s limit to about {kbd(mixCap4)} — try it in <FigRef to="Oil Pipeline Simulator">the first demonstration</FigRef> — but beyond the
        pumps lies only another pipe. When more crude arrives at Kessler than the line can carry, the crude has to go another way, by rail or truck at a far higher cost, or
        wait. Lessons <a href={lessonHref('oil/4.4')}>4.4</a> and <a href={lessonHref('oil/4.5')}>4.5</a> follow what that does to prices.
      </P>
      <P>
        First, though, the barrels that leave Port Calder by sea. Most of the oil traded between countries travels by tanker, across distances no pipe could span, with
        a very different cost structure. The <a href={lessonHref('oil/4.2')}>next lesson</a> plans a voyage.
      </P>
    </LessonPage>
  );
}
