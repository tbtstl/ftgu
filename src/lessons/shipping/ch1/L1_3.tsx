import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { calmResistance } from '../../../engines/shipping/resistance';
import { maxCargo } from '../../../engines/shipping/hydrostatics';
import { AUX_SEA_TPD, ETA_D, ETA_SHAFT, FUELS, passage, powerAndFuel, sfocAt, sfocBest, type FuelId } from '../../../engines/shipping/propulsion';
import { XYChart } from '../shared/XYChart';
import { useRevealed } from './reveal';

const K_ = KESTREL;
const DRAFT = K_.designDraft;
/** Kestrel’s cargo on the laden passage: her full intake from Lesson 1.1, to the nearest 100 tonnes. */
const CARGO = Math.round(maxCargo(K_, K_.consumables) / 100) * 100;

/** The laden passage of the second demonstration, nautical miles. */
export const PASSAGE_NM = 3600;
/** The challenge's deadline, days. */
export const DEADLINE_DAYS = 12;
export const SPEED_MIN = 8;
export const SPEED_MAX = 15;
export const SPEED_STEP = 0.1;

const kwf = (x: number) => `${fmt(x)} kW`;
const tpd = (x: number) => `${fmt(x, 1)} t/day`;

/** Days and fuel for the laden passage at a speed, burning VLSFO with Kestrel's standard engine and propeller. */
export function voyageAt(speedKn: number) {
  return passage(K_, PASSAGE_NM, speedKn, { draft: DRAFT });
}

/**
 * The challenge: arrive within 12 days on the least fuel. Voyage fuel rises with speed throughout the
 * slider's range, so the answer is the slowest speed on the slider that still makes the deadline: 12.5 knots.
 */
export function twelveDaySolved(speedKn: number) {
  const ok = (v: number) => voyageAt(v).days <= DEADLINE_DAYS + 1e-9;
  return ok(speedKn) && !ok(Math.round((speedKn - SPEED_STEP) * 10) / 10);
}

/** Fuel energy flowing into the main engine, kW (fuel mass rate × calorific value). */
export function fuelPowerKw(mainTpd: number, lcv: number) {
  return ((mainTpd * 1000) / 24) * (lcv / 3.6);
}

const FUEL_OPTIONS: Array<{ value: FuelId; label: string }> = (['hsfo', 'vlsfo', 'mgo', 'lng'] as FuelId[]).map((id) => ({ value: id, label: FUELS[id].short }));

// ---------------------------------------------------------------------------
// The power-flow diagram: bands whose height is power, losses peeling off downward.

const SCALE = 140 / 30_000; // px per kW
const Y0 = 46;
const X_FUEL = 24;
const X_ENGINE = 196;
const X_SHAFT = 330;
const X_PROP = 450;
const X_HULL = 598;
const Y_LOSS = 208;

function lossBand(x: number, yTop: number, h: number, xe: number) {
  const hh = Math.max(h, 0.6);
  return `M${x} ${yTop} Q${xe + hh} ${yTop} ${xe + hh} ${Y_LOSS} L${xe} ${Y_LOSS} Q${xe} ${yTop + hh} ${x} ${yTop + hh} Z`;
}

function PowerFlow({ fuelKw, brake, delivered, effective, speed }: { fuelKw: number; brake: number; delivered: number; effective: number; speed: number }) {
  const hF = fuelKw * SCALE;
  const hB = brake * SCALE;
  const hD = delivered * SCALE;
  const hE = effective * SCALE;
  const mech = `M${X_ENGINE} ${Y0} L${X_HULL} ${Y0} L${X_HULL} ${Y0 + hE} L${X_PROP} ${Y0 + hE} L${X_PROP} ${Y0 + hD} L${X_SHAFT} ${Y0 + hD} L${X_SHAFT} ${Y0 + hB} L${X_ENGINE} ${Y0 + hB} Z`;
  const losses = [
    { x: X_ENGINE, top: Y0 + hB, h: hF - hB, xe: X_ENGINE + 22, name: 'heat', kw: fuelKw - brake },
    { x: X_SHAFT, top: Y0 + hD, h: hB - hD, xe: X_SHAFT + 22, name: 'shaft', kw: brake - delivered },
    { x: X_PROP, top: Y0 + hE, h: hD - hE, xe: X_PROP + 22, name: 'propeller wash', kw: delivered - effective },
  ];
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 248"
      role="img"
      aria-label={`Power flow at ${fmt(speed, 1)} knots: fuel energy of ${kwf(fuelKw)} enters the main engine, ${kwf(brake)} leaves it as brake power, ${kwf(delivered)} reaches the propeller and ${kwf(effective)} pushes the hull. ${kwf(fuelKw - brake)} is lost as heat and ${kwf(delivered - effective)} in the propeller’s wash.`}
    >
      {[
        { x: X_FUEL, name: 'Fuel', v: fuelKw, c: TEXT.gold, anchor: 'start' as const },
        { x: X_ENGINE, name: 'Engine', v: brake, c: TEXT.red, anchor: 'middle' as const },
        { x: X_SHAFT, name: 'Shaft', v: delivered, c: TEXT.red, anchor: 'middle' as const },
        { x: X_PROP, name: 'Propeller', v: effective, c: TEXT.red, anchor: 'middle' as const },
        { x: X_HULL + 14, name: 'Hull', v: effective, c: TEXT.red, anchor: 'end' as const },
      ].map((s, i) => (
        <g key={s.name}>
          <text className="ax" x={s.x} y={16} textAnchor={s.anchor}>
            {s.name}
          </text>
          {i !== 3 && (
            <text x={s.x} y={33} textAnchor={s.anchor} style={{ fontSize: 13, fontWeight: 600, fill: s.c }}>
              {kwf(s.v)}
            </text>
          )}
        </g>
      ))}
      <rect x={X_FUEL} y={Y0} width={X_ENGINE - X_FUEL} height={hF} fill={GRAPHIC.gold} opacity={0.45} />
      <path d={mech} fill={GRAPHIC.red} opacity={0.45} />
      {losses.map((l) => (
        <g key={l.name}>
          <path d={lossBand(l.x, l.top, l.h, l.xe)} fill="#c9c5bd" opacity={0.8} />
          <text className="ax" x={l.xe} y={Y_LOSS + 16}>
            {l.name}
          </text>
          <text className="ax" x={l.xe} y={Y_LOSS + 31}>
            {kwf(l.kw)}
          </text>
        </g>
      ))}
      <path d={`M${X_HULL} ${Y0 - 4} L${X_HULL + 14} ${Y0 + hE / 2} L${X_HULL} ${Y0 + hE + 4} Z`} fill={GRAPHIC.red} opacity={0.75} />
      <rect x={X_ENGINE - 7} y={Y0 - 4} width={14} height={hF + 8} rx={2} fill="#e8e5de" stroke="#8a8a8a" />
      {[X_SHAFT, X_PROP].map((x) => (
        <line key={x} x1={x} x2={x} y1={Y0 - 4} y2={Y0 + Math.max(hB, 4) + 4} stroke="#8a8a8a" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

export default function Lesson() {
  const ps = useScenario('propulsion', { speed: 14, efficiency: 0.5, etaD: ETA_D, fuel: 'vlsfo' as FuelId });
  const { speed, efficiency, etaD } = ps.state;
  const fuel = FUELS[ps.state.fuel];
  const pf = powerAndFuel(K_, speed, { draft: DRAFT, efficiency, etaD, fuel });
  const fuelKw = fuelPowerKw(pf.mainTpd, fuel.lcv);
  const over = pf.load > 1 + 1e-9;
  const auxTpd = pf.totalTpd - pf.mainTpd;

  const vs = useScenario('voyage', { speed: 14 });
  const v = vs.state.speed;
  const voy = voyageAt(v);
  const sweep = useMemo(() => {
    const xs: number[] = [];
    for (let i = SPEED_MIN * 10; i <= SPEED_MAX * 10; i++) xs.push(i / 10);
    const ps14 = voyageAt(14);
    return {
      xs,
      daily: xs.map((x) => voyageAt(x).totalTpd),
      voyage: xs.map((x) => voyageAt(x).fuelTonnes),
      cube: xs.map((x) => ps14.totalTpd * (x / 14) ** 3),
      square: xs.map((x) => ps14.fuelTonnes * (x / 14) ** 2),
    };
  }, []);
  const solved = twelveDaySolved(v);
  const revealed = useRevealed('shipping/1.3', 'a', solved);

  // Numbers quoted in the prose (Kestrel laden, VLSFO, standard efficiencies).
  const r14 = calmResistance(K_, 14, DRAFT);
  const at14 = powerAndFuel(K_, 14, { draft: DRAFT });
  const fuel14 = fuelPowerKw(at14.mainTpd, FUELS.vlsfo.lcv);
  const v14 = voyageAt(14);
  const v12 = voyageAt(12);
  const v10 = voyageAt(10);
  const v125 = voyageAt(12.5);
  const byFuel = (id: FuelId) => powerAndFuel(K_, 14, { draft: DRAFT, fuel: FUELS[id] });

  return (
    <LessonPage id="shipping/1.3">
      <P>
        In the Hull Drag Lab of <a href={lessonHref('shipping/1.2')}>the previous lesson</a>, the water held Kestrel back with {fmt(r14.total)} kilonewtons of
        resistance when she was fully laden and making 14 knots. Keeping her at that speed takes {kwf(r14.effectivePower)} of <K tone="red">effective power</K> —
        the resistance times the speed, without a kilowatt wasted. Every one of those kilowatts has to come from fuel burned in her engine room, and fuel is the
        largest single cost of moving a ship. So this lesson follows the power back to its source: how does fuel become the push on the hull, and how much of it
        does a voyage take?
      </P>
      <P>
        Kestrel is driven, like nearly every large cargo ship, by a <b>slow-speed two-stroke diesel</b>: an engine several stories tall whose crankshaft turns
        slowly enough — around a hundred revolutions a minute — to drive a large propeller directly, with no gearbox in between. The power passes through three
        stages, and each keeps some of it. The engine turns the fuel’s chemical energy into the turning power of its crankshaft, called <b>brake power</b>; the
        shaft carries that power aft through its bearings; and the propeller turns it into thrust, stirring the water as it goes. The share of the power reaching
        the propeller that ends up pushing the hull is the <b>propulsive efficiency</b>, η<sub>D</sub>. In the next demonstration, the thickness of each band is
        power, flowing from the fuel on the left to the hull on the right, and the gray bands peeling away are losses. The fuel buttons choose what she burns —
        high-sulfur fuel oil (HSFO), very-low-sulfur fuel oil (VLSFO), marine gasoil (MGO) or liquefied natural gas (LNG), which we’ll compare later — and the fuel
        readout also counts her <b>gensets</b>, the smaller auxiliary engines that make her electricity. Change the speed, the engine’s efficiency, the
        propeller’s efficiency and the fuel:
      </P>

      <Figure name="Marine Propulsion Simulator" scenario={ps}>
        <PowerFlow fuelKw={fuelKw} brake={pf.brakePower} delivered={pf.deliveredPower} effective={pf.effectivePower} speed={speed} />
        <Segmented label="Fuel" value={ps.state.fuel} onChange={(f) => ps.set({ fuel: f })} options={FUEL_OPTIONS} />
        <Readouts
          items={[
            { label: over ? 'brake power: beyond the engine’s rating' : `brake power, ${pct(pf.load)} of the engine’s rating`, value: kwf(pf.brakePower), tone: 'red' },
            { label: `${fuel.short} burned, engines and gensets`, value: tpd(pf.totalTpd), tone: 'red' },
            { label: 'CO₂ emitted', value: `${fmt(pf.totalTpd * fuel.co2)} t/day` },
          ]}
        />
        <Slider label="Speed" tone="teal" value={speed} min={SPEED_MIN} max={SPEED_MAX} step={0.1} onChange={(x) => ps.set({ speed: x })} display={`${fmt(speed, 1)} kn`} />
        <Slider label="Engine thermal efficiency" tone="red" value={efficiency} min={0.4} max={0.55} step={0.01} onChange={(x) => ps.set({ efficiency: x })} display={pct(efficiency)} />
        <Slider label={<>Propulsive efficiency, η<sub>D</sub></>} tone="red" value={etaD} min={0.6} max={0.75} step={0.01} onChange={(x) => ps.set({ etaD: x })} display={pct(etaD)} />
        <Eq label={`Main engine fuel per day equals brake power times 24 hours times specific fuel consumption: ${fmt(pf.mainTpd, 1)} tonnes`}>
          <span>main engine fuel</span>
          <Op>=</Op>
          <K tone="red">
            P<sub>B</sub>
          </K>
          <Op>×</Op>
          <span>24 h</span>
          <Op>×</Op>
          <span>SFOC</span>
          <Op>=</Op>
          <Tn tone="red">{kwf(pf.brakePower)}</Tn>
          <Op>×</Op>
          <span>24 h</span>
          <Op>×</Op>
          <span>{fmt(pf.sfoc, 1)} g/kWh</span>
          <Op>=</Op>
          <K tone="red">{tpd(pf.mainTpd)}</K>
        </Eq>
        <Caption>
          {over
            ? `At ${fmt(speed, 1)} knots the propeller would need more than the ${kwf(K_.mcr)} the engine is rated for: Kestrel can’t sustain this speed.`
            : `Of the fuel’s ${kwf(fuelKw)}, ${pct(pf.effectivePower / fuelKw)} ends up pushing the hull. The auxiliary engines burn another ${fmt(auxTpd, 1)} t/day to make the ship’s electricity.`}
        </Caption>
      </Figure>

      <P>
        Start at 14 knots on very-low-sulfur fuel oil. Fuel flows into the main engine at a rate that carries {kwf(fuel14)} of chemical energy, and about half of it
        leaves as heat, in the exhaust and the cooling water. The other half reaches the crankshaft as {kwf(at14.brakePower)} of brake power — {pct(at14.load)} of
        the engine’s <b>maximum continuous rating</b>, the {kwf(K_.mcr)} it is built to deliver all day, every day. The shaft and its bearings take {pct(1 - ETA_SHAFT)}, {kwf(at14.brakePower - at14.deliveredPower)}.
        Of the {kwf(at14.deliveredPower)} that reaches the propeller, {kwf(at14.effectivePower)} pushes the hull, a propulsive efficiency of {pct(ETA_D)};
        the rest goes into the swirling wash behind the ship. All told, only {pct(at14.effectivePower / fuel14)} of the fuel’s energy ends up as push.
      </P>
      <P>
        That sounds wasteful, but a thermal efficiency of 50% makes these engines among the most efficient combustion engines ever built. Engineers describe them
        by their <K tone="red">specific fuel oil consumption</K>, or SFOC: grams of fuel burned per kilowatt-hour of brake power. A kilowatt-hour is 3.6 megajoules,
        and a kilogram of very-low-sulfur fuel oil holds {fmt(FUELS.vlsfo.lcv, 1)}, so an engine that turns half of it into work burns 3,600 ÷ (0.5 ×{' '}
        {fmt(FUELS.vlsfo.lcv, 1)}) = {fmt(sfocBest(0.5, FUELS.vlsfo), 1)} grams per kilowatt-hour:
      </P>
      <Eq label="SFOC equals 3,600 divided by thermal efficiency times calorific value">
        <span>SFOC</span>
        <Op>=</Op>
        <Frac top="3,600 kJ per kWh" bottom={<span>efficiency × calorific value</span>} />
      </Eq>
      <P>
        That is the best the engine does, and only near {pct(0.8)} of its rating. Run it much harder or much more gently and it burns a little more for each
        kilowatt-hour: at {pct(0.3)} load our model’s engine needs {fmt(sfocAt(0.3, 0.5, FUELS.vlsfo), 1)} g/kWh, about a tenth more. Multiply brake power by the
        hours in a day and by the SFOC and you have the main engine’s fuel, {tpd(at14.mainTpd)} at 14 knots. Kestrel’s gensets, which generate electricity
        for her pumps, lights and galley, burn another {fmt(AUX_SEA_TPD, 1)} tonnes a day at sea whatever her speed, bringing the total
        to {tpd(at14.totalTpd)}.
      </P>
      <P>
        The two efficiency sliders matter as much as each other. Drop the engine’s thermal efficiency from 50% to 45%, a tenth of it, and the ship burns{' '}
        {tpd(powerAndFuel(K_, 14, { draft: DRAFT, efficiency: 0.45 }).totalTpd)}; leave the engine alone and cut the propulsive efficiency by the same tenth
        instead, from {pct(ETA_D)} to {pct(ETA_D * 0.9)}, and she burns {tpd(powerAndFuel(K_, 14, { draft: DRAFT, etaD: ETA_D * 0.9 }).totalTpd)}. A better propeller, a hull shaped to feed it smooth water, or simply a propeller
        polished free of fouling saves fuel exactly as a better engine does.
      </P>

      <H2>Which fuel</H2>
      <P>
        What a ship burns is set as much by regulation as by engineering. Since 1 January 2020, an international limit has capped the sulfur in marine fuel at
        0.50% almost everywhere at sea, down from 3.50%. Most ships switched to <b>very-low-sulfur fuel oil</b>. A ship fitted with an exhaust-gas scrubber, which
        washes the sulfur out of its exhaust, may still burn cheaper <b>high-sulfur fuel oil</b>. In emission control areas, such as the North Sea and the coasts
        of North America, the limit is 0.10%, and ships switch to <b>marine gasoil</b>, a light distillate. A growing number of new ships have dual-fuel engines
        that can run on <b>liquefied natural gas</b>.
      </P>
      <P>
        Switch fuels in <FigRef to="Marine Propulsion Simulator">the first demonstration</FigRef>. The engine needs the same energy whatever it burns, so a fuel
        that packs more energy into each kilogram is burned in fewer tonnes: at 14 knots, {tpd(byFuel('hsfo').totalTpd)} of high-sulfur fuel oil,{' '}
        {tpd(byFuel('vlsfo').totalTpd)} of very-low-sulfur fuel oil, {tpd(byFuel('mgo').totalTpd)} of gasoil or {tpd(byFuel('lng').totalTpd)} of LNG. The carbon
        dioxide follows the carbon in the fuel, using the conversion factors the International Maritime Organization publishes: about 3.1 tonnes of CO₂ for every
        tonne of fuel oil, and 2.75 for LNG, so the gas-burning Kestrel emits {pct(1 - (byFuel('lng').totalTpd * FUELS.lng.co2) / (byFuel('vlsfo').totalTpd * FUELS.vlsfo.co2))}{' '}
        less CO₂ from her exhaust. That figure flatters LNG: some methane slips through the engine unburned, and methane is a far more potent greenhouse gas than
        CO₂.
      </P>

      <H2>A voyage, not a day</H2>
      <P>
        A day’s fuel is the engineer’s number. A ship’s owner pays by the voyage. Take a laden passage of {fmt(PASSAGE_NM)} nautical miles, roughly the haul from
        the iron ore ports of Western Australia to northern China. In the next demonstration, the upper chart is Kestrel’s fuel per day at each speed and the lower
        one is the fuel the whole passage takes, with her engine, propeller and fuel back at their standard settings. The dashed lines show how each would grow if
        it followed a pure power law from 14 knots. Drag the speed:
      </P>

      <Figure name="Marine Propulsion Simulator · voyage" scenario={vs}>
        <XYChart
          ariaLabel={`Fuel burned per day against speed. At ${fmt(v, 1)} knots Kestrel burns ${tpd(voy.totalTpd)}.`}
          series={[
            { xs: sweep.xs, ys: sweep.cube, color: '#9a9a9a', width: 1.5, dash: '5 4', label: 'cube of speed', labelColor: TEXT.gray },
            { xs: sweep.xs, ys: sweep.daily, color: GRAPHIC.red, width: 2.5 },
          ]}
          xMin={SPEED_MIN}
          xMax={SPEED_MAX}
          yMin={0}
          yMax={50}
          yTicks={[0, 25, 50]}
          xTicks={[8, 9, 10, 11, 12, 13, 14, 15]}
          xFormat={(x) => `${x} kn`}
          yFormat={(y) => `${y} t`}
          yLabel="Fuel per day"
          cursor={v}
          markers={[{ x: v, y: voy.totalTpd, color: TEXT.red, label: tpd(voy.totalTpd), anchor: 'end', labelDy: -10 }]}
          height={150}
        />
        <XYChart
          ariaLabel={`Fuel for the ${fmt(PASSAGE_NM)}-mile passage against speed. At ${fmt(v, 1)} knots it takes ${revealed ? `${fmt(voy.days, 2)} days and ` : ''}${fmt(voy.fuelTonnes)} tonnes of fuel.`}
          series={[
            { xs: sweep.xs, ys: sweep.square, color: '#9a9a9a', width: 1.5, dash: '5 4', label: 'square of speed', labelColor: TEXT.gray },
            { xs: sweep.xs, ys: sweep.voyage, color: GRAPHIC.gold, width: 2.5 },
          ]}
          xMin={SPEED_MIN}
          xMax={SPEED_MAX}
          yMin={0}
          yMax={500}
          yTicks={[0, 250, 500]}
          xTicks={[8, 9, 10, 11, 12, 13, 14, 15]}
          xFormat={(x) => `${x} kn`}
          yFormat={(y) => `${y} t`}
          yLabel="Fuel for the passage"
          xLabel="Speed"
          cursor={v}
          markers={[{ x: v, y: voy.fuelTonnes, color: TEXT.gold, label: `${fmt(voy.fuelTonnes)} t`, anchor: 'end', labelDy: -10 }]}
          height={160}
        />
        <Readouts
          items={[
            ...(revealed ? [{ label: 'days at sea', value: fmt(voy.days, 2), tone: 'teal' as const }] : []),
            { label: 'fuel for the passage', value: `${fmt(voy.fuelTonnes)} t`, tone: 'gold' },
            { label: 'CO₂', value: `${fmt(voy.co2Tonnes)} t` },
            { label: `fuel cost at an illustrative ${usd(FUELS.vlsfo.price)}/t`, value: usd(voy.cost), tone: 'green' },
          ]}
        />
        <Slider label="Speed" tone="teal" value={v} min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} onChange={(x) => vs.set({ speed: x })} display={`${fmt(v, 1)} kn`} />
      </Figure>

      <P>
        Slow down from 14 knots to 12 and the daily fuel falls from {tpd(v14.totalTpd)} to {tpd(v12.totalTpd)}, a cut of {pct(1 - v12.totalTpd / v14.totalTpd)}.
        The main engine alone falls almost exactly with the cube of speed — to {pct(v12.mainTpd / v14.mainTpd, 1)} of its 14-knot burn, against (12 ÷ 14)³ ={' '}
        {pct((12 / 14) ** 3, 1)} — because resistance grows roughly with the square of speed and power is resistance times speed. The saving on the voyage is
        smaller: {fmt(v14.fuelTonnes)} tonnes falls to {fmt(v12.fuelTonnes)}, {pct(1 - v12.fuelTonnes / v14.fuelTonnes)} less. A slower ship burns less each day
        but spends more days at sea, {fmt(v12.days - v14.days, 2)} more on this passage. Fuel per day goes roughly as the cube of speed, days as one over the
        speed, so fuel per voyage goes roughly as the square.
      </P>
      <P>
        In money, at an illustrative {usd(FUELS.vlsfo.price)} a tonne for very-low-sulfur fuel oil — real bunker prices move with the oil market and differ
        from port to port — the passage’s fuel costs {usd(v14.cost)} at 14 knots. Spread
        over the {fmt(CARGO)} tonnes of cargo she carries, that is {usd(v14.cost / CARGO, 2)} a tonne; at 12 knots it is {usd(v12.cost / CARGO, 2)}. Bulk freight is usually
        quoted per tonne of cargo too, so this is the first cost it must cover; <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> sets the two side by side.
      </P>
      <P>
        Below about 12 knots the solid curves pull steadily away from the dashed ones. The auxiliary engines burn their {fmt(AUX_SEA_TPD, 1)} tonnes a day however slowly
        the ship moves, and the main engine’s SFOC creeps up as its load falls, so each knot given up saves less than the last: at 10 knots the passage still takes{' '}
        {fmt(v10.fuelTonnes)} tonnes, where a pure square law from 14 knots would predict {fmt(v14.fuelTonnes * (10 / 14) ** 2)}.
      </P>

      <Challenge
        id="a"
        question={`The receivers in China want Kestrel’s cargo within ${DEADLINE_DAYS} days. Work it out before touching the slider, because the figure hides the days at sea until you’re right: which speed gets the cargo there in time on the least fuel? Then set it.`}
        solved={solved}
        status={`Set to ${fmt(v, 1)} knots, she burns ${fmt(voy.fuelTonnes)} t on the passage.`}
        success={`Solved. Fuel per voyage rises with every knot, so the cheapest way to meet a deadline is to arrive exactly on it: ${fmt(PASSAGE_NM)} ÷ (${DEADLINE_DAYS} days × 24 hours) = ${fmt(PASSAGE_NM)} ÷ ${DEADLINE_DAYS * 24} = 12.5 knots, burning ${fmt(v125.fuelTonnes, 1)} t — ${fmt(v14.fuelTonnes - v125.fuelTonnes)} t less than at 14 knots. A tenth of a knot slower and she would arrive ${fmt((voyageAt(12.4).days - DEADLINE_DAYS) * 24, 1)} hours late.`}
      />

      <P>
        That is the physics of <b>slow steaming</b>, and it seems to say a ship should always crawl. It doesn’t, because days cost money too. A ship sailing
        slowly carries fewer cargoes a year, and the crew, the insurance and the capital tied up in the hull must be paid for every one of those days. Weighing
        fuel against time is a commercial question, and we’ll answer it in <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a>, once we know what a day of a
        ship’s time is worth.
      </P>
      <P>
        So far we’ve treated Kestrel’s cargo as a single weight, sunk to the right draft and pushed along at the right speed. But a ship doesn’t only have to
        float and move; it has to stay upright, and that depends on where inside the hull the weight sits. In <a href={lessonHref('shipping/1.4')}>the next
        lesson</a> we’ll load her holds and ballast tanks and see what keeps her from rolling over.
      </P>
    </LessonPage>
  );
}
