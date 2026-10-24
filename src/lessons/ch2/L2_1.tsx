import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Controls,
  Eq,
  FUEL,
  Figure,
  Frac,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  TimeChart,
  fmt,
  hour,
  lessonHref,
  linePath,
  mw,
  mwh,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../framework';
import { MIX_FUELS, MIX_TECH, STANDARD_MIX, evaluateMix, screeningCost, type Mix, type MixFuel, type MixResult } from '../../engines/ops/genmix';
import { FUEL_LABEL, STANDARD_FLEET } from '../../model/fleet';
import { RegionMap, plantRole } from '../shared/RegionMap';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

const WEATHER = { demand: SYSTEM_DEMAND, wind: WIND_CF, solar: SOLAR_CF };
const PEAK = Math.max(...SYSTEM_DEMAND);
const Y_MAX = 2000;

/** Slider ranges for the builder (10 MW steps). Nuclear stops at 800 MW so its must-run floor stays below the night-time minimum. */
export const BUILDER_RANGE: Record<MixFuel, number> = { nuclear: 800, coal: 1000, gasCC: 2000, gasCT: 1000, oil: 500, hydro: 300, wind: 2000, solar: 2000 };
const SLIDER_ORDER: MixFuel[] = ['nuclear', 'coal', 'gasCC', 'gasCT', 'oil', 'hydro', 'wind', 'solar'];

export const EMISSIONS_CAP = 1500;
export const COST_CAP = 1_750_000;

/** The builder challenge: firm capacity covers the peak, nothing unserved, under the emissions and cost caps. */
export function builderSolved(r: MixResult): boolean {
  return r.unserved < 1e-6 && r.firm >= PEAK - 1e-9 && r.emissions < EMISSIONS_CAP && r.totalCost < COST_CAP;
}

/** Technologies on the screening curve, and the hours a year each can run at most. */
const SCREEN: MixFuel[] = ['nuclear', 'coal', 'gasCC', 'gasCT', 'oil'];
const maxHours = (f: MixFuel) => MIX_TECH[f].availability * 8760;
export const BASELOAD_HOURS = 7000;

export function cheapestAt(hours: number, carbon: number): MixFuel {
  const able = SCREEN.filter((f) => hours <= maxHours(f));
  return (able.length ? able : SCREEN).reduce((a, b) => (screeningCost(MIX_TECH[b], hours, carbon) < screeningCost(MIX_TECH[a], hours, carbon) ? b : a));
}

/** Lowest whole-dollar carbon price at which nuclear is the cheapest way to run a plant 7,000 hours a year. */
export const NUCLEAR_CARBON = (() => {
  for (let c = 0; c <= 150; c++) if (cheapestAt(BASELOAD_HOURS, c) === 'nuclear') return c;
  return -1;
})();

/** The screening figure's opening settings, and its challenge: the carbon price at which nuclear first wins at 7,000 hours. */
export const SCREENING_DEFAULTS = { carbon: 0, hours: 7000 };
export function carbonSolved(carbon: number): boolean {
  return carbon === NUCLEAR_CARBON;
}

/** The two contenders at 7,000 hours with no carbon price, $ per MWh. */
export const CC_AT_BASELOAD = screeningCost(MIX_TECH.gasCC, BASELOAD_HOURS, 0);
export const NUC_AT_BASELOAD = screeningCost(MIX_TECH.nuclear, BASELOAD_HOURS, 0);

// Wind and solar can't choose their hours: place them at the reference day's capacity factors.
const DAY_CF = { wind: WIND_CF.reduce((s, v) => s + v, 0) / 24, solar: SOLAR_CF.reduce((s, v) => s + v, 0) / 24 };

// Screening-curve axes.
const SX = scale(0, 8760, 60, 584);
const SY = scale(0, 300, 250, 24);

function millions(x: number): string {
  return '$' + (x / 1e6).toFixed(2) + 'M';
}

export default function Lesson() {
  const s1 = useScenario('builder', { ...STANDARD_MIX } as Mix);
  const mix = s1.state;
  const r = useMemo(() => evaluateMix(mix, WEATHER), [mix]);
  const [cursor, setCursor] = useState(19);
  const [plant, setPlant] = useState<string | null>(null);
  const picked = STANDARD_FLEET.find((g) => g.id === plant);

  const stack = [
    ...MIX_FUELS.map((f) => ({ values: r.hours.map((h) => h.output[f] ?? 0), color: FUEL[f] })),
    { values: r.hours.map((h) => h.shortfall), color: '#d9534f' },
    {
      values: r.hours.map((h) => {
        const below = MIX_FUELS.reduce((s, f) => s + (h.output[f] ?? 0), 0) + h.shortfall;
        return Math.max(0, Math.min(h.curtailed, Y_MAX - below));
      }),
      color: tint(FUEL.wind, 0.35),
    },
  ];
  const built = MIX_FUELS.filter((f) => mix[f] > 0);
  const cur = r.hours[cursor];
  const marg = cur.marginal as MixFuel | null;
  const solved = builderSolved(r);

  let caption = `At ${hour(cursor)}, demand is ${mw(SYSTEM_DEMAND[cursor])}.`;
  if (cur.shortfall > 0.5) caption += ` The fleet runs out of capacity and ${mw(cur.shortfall)} goes unserved.`;
  else if (marg) caption += ` The last plant switched on is ${FUEL_LABEL[marg].toLowerCase()}, which costs $${MIX_TECH[marg].marginalCost} per MWh to run.`;
  if (cur.curtailed > 0.5) caption += ` ${mw(cur.curtailed)} of wind and solar output has nowhere to go and is turned away.`;

  // Screening curve.
  const s2 = useScenario('screening', SCREENING_DEFAULTS);
  const { carbon, hours } = s2.state;
  const x = SX;
  const y = SY;
  const curves = useMemo(
    () =>
      SCREEN.map((f) => {
        const hs: number[] = [];
        for (let h = 150; h < maxHours(f); h += 30) hs.push(h);
        hs.push(maxHours(f));
        return { f, d: linePath(hs.map(SX), hs.map((h) => SY(Math.min(330, screeningCost(MIX_TECH[f], h, carbon))))) };
      }),
    [carbon],
  );
  const envelope = useMemo(() => {
    const hs: number[] = [];
    // Stop where combined-cycle gas runs out of available hours, so the envelope doesn't jump.
    for (let h = 150; h <= maxHours('gasCC'); h += 30) hs.push(h);
    return linePath(hs.map(SX), hs.map((h) => SY(Math.min(330, screeningCost(MIX_TECH[cheapestAt(h, carbon)], h, carbon)))));
  }, [carbon]);
  const best = cheapestAt(hours, carbon);
  const nucAt = screeningCost(MIX_TECH.nuclear, BASELOAD_HOURS, carbon);
  const ccAt = screeningCost(MIX_TECH.gasCC, BASELOAD_HOURS, carbon);
  const baseBest = cheapestAt(BASELOAD_HOURS, carbon);
  const solved2 = carbonSolved(carbon);
  const g = MIX_TECH[best];

  return (
    <LessonPage id="2.1">
      <P>
        Chapter 1 followed electricity through a single generator, a transformer and a line. A real grid is fed by many generators of very different kinds, and deciding
        which kinds to build is the first choice anyone designing a grid has to make. From here on the course follows one fictional region, and the same nine power plants
        appear in every chapter, so it’s worth meeting them properly.
      </P>
      <P>
        First, the two units every plant is described in. As <a href={lessonHref('1.1')}>Lesson 1.1</a> showed, a megawatt (MW) measures{' '}
        <K c="power">power</K>, a rate: how fast energy is being delivered at a given moment. The <K c="energy">energy</K> itself is power multiplied by time, and at grid
        scale it’s counted in megawatt-hours (MWh): 1,440 MW for an hour — the region’s demand in its busiest hour — is 1,440 MWh, and a 400 MW plant running flat out
        for a whole day produces 9,600 MWh. A plant’s size is a number of megawatts, but what it produces and sells is megawatt-hours, so its fuel bill and its emissions
        are counted per megawatt-hour.
      </P>
      <P>
        On the coast at Harbor sits <b>Harbor Point</b>, a 400 MW nuclear plant. Out to the West is <b>Ironwood</b>, a 300 MW coal plant. Two gas-fired combined-cycle
        plants do much of the flexible work: <b>Lakeside</b> (400 MW) at Central, and the smaller, less efficient <b>Mill Creek</b> (250 MW) in Metro, the region’s city.
        Behind them stand the 200 MW <b>Eastgate</b> gas peaker in the East and <b>Old Quay</b>, an 80 MW oil plant in Metro. The hills of the North have the{' '}
        <b>Falls</b> hydro plant (150 MW) and the <b>Ridge</b> wind farm (350 MW), and the East has the <b>Valley</b> solar farm (400 MW). Here is the region, with
        each plant at its site and size. Select one to see its running cost and emissions per megawatt-hour, and its <b>ramp rate</b>, the most its output can change in
        an hour:
      </P>

      <Figure name="Region map" onReset={() => setPlant(null)}>
        <Legend
          items={(['nuclear', 'coal', 'gasCC', 'gasCT', 'oil', 'hydro', 'wind', 'solar'] as const).map((f) => ({ label: FUEL_LABEL[f], color: FUEL[f] }))}
        />
        <RegionMap selected={plant} onSelect={setPlant} />
        {picked ? (
          <>
            <Readouts
              items={[
                { label: 'cost to run, per MWh', value: usd(picked.marginalCost), tone: 'green' },
                { label: 'output change per hour', value: picked.variable ? 'weather' : mw(picked.rampRate) },
                { label: 'CO₂ per MWh', value: `${fmt(picked.emissions, 2)} t` },
              ]}
            />
            <Caption>
              <b>{picked.name}.</b> {plantRole(picked.id)}
            </Caption>
          </>
        ) : (
          <Caption>Select a plant on the map to see its running cost, its emissions and its ramp rate: how quickly it can change its output.</Caption>
        )}
      </Figure>
      <P>
        Add them up and the region has 2,530 MW of generating capacity. On the reference day we’ll use throughout the course, demand peaks at 1,440 MW at 19:00. Why build
        three-quarters more capacity than the region ever uses at once? To find out, let’s pretend we can build the region’s fleet from scratch. The builder in the next demonstration starts
        with the region’s actual mix of technologies. Each slider sets how many megawatts of one technology to build, and the chart shows them dispatched hour by hour
        against the reference day’s demand — cheapest to run first, as we’ll see markets do in <a href={lessonHref('4.3')}>Lesson 4.3</a>. Try removing the coal
        plant, or doubling the solar farm:
      </P>

      <Figure name="Generation Portfolio Builder" scenario={s1}>
        <Legend
          items={[
            ...built.map((f) => ({ label: FUEL_LABEL[f], color: FUEL[f] })),
            { label: 'Demand', color: '#333', kind: 'line' as const },
            ...(r.unserved > 0.5 ? [{ label: 'Unserved', color: '#d9534f' }] : []),
            ...(r.curtailed > 0.5 ? [{ label: 'Curtailed wind and solar', color: tint(FUEL.wind, 0.35) }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`Generation by technology over the reference day against demand. Firm capacity ${mw(r.firm)} against a peak of ${mw(PEAK)}; ${mwh(r.unserved)} unserved; ${mwh(r.curtailed)} curtailed.`}
          stack={stack}
          series={[{ values: SYSTEM_DEMAND, color: '#333', width: 2.5 }]}
          refLines={r.firm <= Y_MAX - 60 ? [{ y: r.firm, color: '#6b6b6b', dash: '6 4', label: 'firm capacity' }] : []}
          yMin={0}
          yMax={Y_MAX}
          yLabel="MW"
          yFormat={(v) => fmt(v)}
          height={260}
          cursor={cursor}
          onScrub={setCursor}
        />
        <Caption>{caption}</Caption>
        <Controls columns={2}>
          {SLIDER_ORDER.map((f) => (
            <Slider
              key={f}
              label={FUEL_LABEL[f]}
              value={mix[f]}
              min={0}
              max={BUILDER_RANGE[f]}
              step={10}
              onChange={(v) => s1.set({ [f]: v } as Partial<Mix>)}
              display={mix[f] > 0 ? `${mw(mix[f])} · CF ${pct(r.capacityFactor[f])}` : mw(0)}
            />
          ))}
        </Controls>
        <Readouts
          items={[
            { label: `firm capacity, for a ${mw(PEAK)} peak`, value: mw(r.firm), tone: r.firm >= PEAK ? undefined : 'red' },
            { label: r.totalCost > 0 ? `cost of the day, ${pct(r.fixedCost / r.totalCost)} of it fixed` : 'cost of the day', value: millions(r.totalCost), tone: 'green' },
            { label: 'CO₂ emitted', value: `${fmt(r.emissions)} t` },
          ]}
        />
      </Figure>

      <P>
        A plant’s <b>nameplate capacity</b> is the most it can produce. What it actually produces depends on when it’s needed, and the fairest summary is its{' '}
        <K c="energy">capacity factor</K>, shown as CF beside each slider: the energy it delivered, divided by the energy it would have delivered running flat out — its
        megawatt-hours over the day, divided by its megawatts times 24 hours. With the region’s mix, Harbor Point
        and Falls run all day, a capacity factor of 100%. Ridge wind reaches 37% and Valley solar 26%, because that’s what the day’s wind and sunshine allow. Ironwood coal
        reaches 71%, the gas combined-cycle plants only 13%, and Eastgate and Old Quay don’t run at all. Scrub across the chart to see which plant is the last one switched
        on in each hour: overnight it’s coal, and in the evening it’s gas.
      </P>
      <P>
        The cost of the day comes in two parts. The <K c="price">running cost</K> — mostly fuel — is paid for every megawatt-hour produced, and ranges from $0 for wind
        and sunlight to $165 for oil. The <K c="price">fixed cost</K> is the price of having the plant at all: construction, financing, staff and upkeep, spread out as so
        many dollars per megawatt per year: a charge on the plant’s megawatts, paid whether it produces any megawatt-hours or not. The cost of the day adds the two
        together. With the region’s mix, the day costs $1.78 million, and $1.40 million of that, 79%, is fixed. Harbor
        Point is the extreme case: the cheapest plant that burns fuel, at $9 per megawatt-hour, and by far the most expensive to own, at $603,000 a day.
      </P>
      <P>
        Wind and solar have almost no running cost, so whatever they produce displaces fuel. In our numbers that roughly pays for them: take Ridge and Valley away and the
        day costs about $12,000 less, but emits 3,178 more tonnes of carbon dioxide.
      </P>

      <H2>Capacity you can count on</H2>
      <P>
        If cost were the only concern, we’d delete Eastgate and Old Quay, which sit idle all day. Try it: the day gets about $55,000 cheaper, and every megawatt-hour is
        still served. So why keep them? Because a megawatt of nameplate capacity isn’t a megawatt you can count on.
      </P>
      <P>
        Plants break down and need maintenance. Our model gives each technology an <b>availability</b>, the share of the time it’s in working order: 92% for nuclear and
        gas peakers, 90% for combined-cycle plants, 85% for coal and oil, and 95% for hydro. And wind and solar produce only what the weather allows. At 19:00 on the
        reference day the sun has set and Ridge wind is producing 40% of its capacity, but on a still winter evening it might produce nothing. Planners therefore count{' '}
        <b>firm capacity</b>: in our model, the capacity of every plant that doesn’t depend on the weather, scaled by its availability. The region’s firm capacity is
        1,603 MW, 11% above the peak, and that margin is what the spare plants are for.
      </P>
      <P>
        Firm and flexible aren’t the same thing, either. Harbor Point is firm, but it can’t follow demand: like most nuclear plants it runs at a steady output, and in our
        model it never drops below 90% of its capacity — the flat band at the bottom of the chart. Gas, coal, oil and hydro plants are <b>dispatchable</b>: the operator can
        raise and lower them on instruction. Wind and solar can only be turned down, which is called <b>curtailment</b>.
      </P>

      <Challenge
        id="a"
        question={`Rebuild the fleet so that its firm capacity still covers the ${mw(PEAK)} peak, while the day’s emissions fall below ${fmt(EMISSIONS_CAP)} tonnes and the day costs less than $1.75 million.`}
        solved={solved}
        status={`Right now: firm capacity ${mw(r.firm)}, ${fmt(r.emissions)} t of CO₂, and a cost of ${millions(r.totalCost)}${r.unserved > 0.5 ? `, with ${mwh(r.unserved)} unserved` : ''}.`}
        success={`Solved: ${mw(r.firm)} of firm capacity, ${fmt(r.emissions)} t of CO₂ and ${millions(r.totalCost)} for the day. The trick is to give the two jobs to different plants: low-carbon plants for the energy, and cheap-to-build plants that seldom run for the firm capacity.`}
      />
      <P>
        Fleets that pass can cost nearly a quarter less than the region’s own, so why didn’t the region build one? Real plants are built over decades, under fuel prices and
        expectations that have since changed, and a single breezy reference day flatters wind: a real fleet also has to get through still, cloudy weeks.
      </P>

      <H2>Why build more than one kind?</H2>
      <P>
        Each technology trades fixed cost against running cost. Which side of the trade is better depends on how many hours a year a plant will actually run. Spread a
        plant’s yearly fixed cost over the hours it runs, add its running cost, and you have the average cost of each megawatt-hour it produces:
      </P>
      <Eq label="Average cost per megawatt-hour">
        <K c="price">average cost</K>
        <Op>=</Op>
        <Frac top="fixed cost per year" bottom="hours run" />
        <Op>+</Op>
        <span>running cost</span>
      </Eq>
      <P>
        Plotting this against the hours run gives a <b>screening curve</b> for each technology, a classic tool of power-system planning. The next chart draws one for each
        technology that doesn’t depend on the weather; each line ends at the most hours a year that technology is available. The carbon price adds a charge for each tonne of CO₂
        emitted, as an emissions tax or a cap-and-trade market would, and the hours slider picks the number of hours at which to compare them:
      </P>

      <Figure name="Generation Portfolio Builder · screening curves" scenario={s2}>
        <Legend items={[...SCREEN.map((f) => ({ label: FUEL_LABEL[f], color: FUEL[f], kind: 'line' as const })), { label: 'Cheapest choice', color: '#cfcfcf' }]} />
        <svg
          className="chart"
          viewBox="0 0 600 292"
          role="img"
          aria-label={`Average cost per MWh against hours run per year, at a carbon price of $${carbon} per tonne. At ${fmt(hours)} hours, ${FUEL_LABEL[best].toLowerCase()} is cheapest at $${screeningCost(g, hours, carbon).toFixed(0)} per MWh.`}
        >
          <defs>
            <clipPath id="l21-plot">
              <rect x={60} y={20} width={530} height={232} />
            </clipPath>
          </defs>
          <text className="ax" x={60} y={12}>
            Average cost, $ per MWh
          </text>
          <GridY y={y} ticks={[0, 50, 100, 150, 200, 250, 300]} x0={60} x1={584} format={(v) => '$' + v} baseline={0} />
          {[0, 2000, 4000, 6000, 8000].map((h) => (
            <text key={h} className="ax ax-m" x={x(h)} y={268}>
              {fmt(h)}
            </text>
          ))}
          <text className="ax ax-e" x={584} y={286}>
            Hours run per year
          </text>
          <g clipPath="url(#l21-plot)">
            <path d={envelope} fill="none" stroke="#cfcfcf" strokeWidth={11} strokeLinejoin="round" strokeLinecap="round" />
            {curves.map((c) => (
              <path key={c.f} d={c.d} fill="none" stroke={FUEL[c.f]} strokeWidth={2.5} strokeLinejoin="round" />
            ))}
          </g>
          {(['wind', 'solar'] as const).map((f, i) => {
            const h = DAY_CF[f] * 8760;
            const c = MIX_TECH[f].fixedCost / h;
            return (
              <g key={f}>
                <circle cx={x(h)} cy={y(c)} r={6} fill={FUEL[f]} stroke="#555" strokeWidth={1} />
                <text className="lab" x={x(h) + (i ? -10 : 10)} y={y(c) + 18} textAnchor={i ? 'end' : 'start'}>
                  {f === 'wind' ? 'wind' : 'solar'}
                </text>
              </g>
            );
          })}
          <line className="cur" x1={x(hours)} x2={x(hours)} y1={20} y2={250} />
          {SCREEN.filter((f) => hours <= maxHours(f)).map((f) => {
            const c = screeningCost(MIX_TECH[f], hours, carbon);
            return c <= 300 ? <circle key={f} cx={x(hours)} cy={y(c)} r={f === best ? 6 : 4} fill={FUEL[f]} stroke="#f8f8f8" strokeWidth={2} /> : null;
          })}
        </svg>
        <Slider label="Carbon price" tone="green" value={carbon} min={0} max={150} onChange={(v) => s2.set({ carbon: v })} display={`$${carbon} per tonne`} />
        <Slider label="Hours run per year" value={hours} min={200} max={8000} step={20} onChange={(v) => s2.set({ hours: v })} display={`${fmt(hours)} h`} />
        <Eq label={`Average cost of ${FUEL_LABEL[best]} at ${hours} hours`}>
          <Frac top={usd(g.fixedCost)} bottom={`${fmt(hours)} h`} />
          <Op>+</Op>
          <span>${g.marginalCost}</span>
          <Op>+</Op>
          <K c="price">${carbon}</K>
          <Op>×</Op>
          <span>{g.emissions} t</span>
          <Op>=</Op>
          <K c="price">${screeningCost(g, hours, carbon).toFixed(2)}</K>
        </Eq>
      </Figure>

      <P>
        With no carbon price, oil is the cheapest choice for a plant that runs fewer than about 390 hours a year, a gas peaker wins from there to about 770 hours, and
        combined-cycle gas wins for everything above. The peaker’s low fixed cost makes it the right machine for the few hours of each year when demand is at its highest,
        even though each megawatt-hour it produces is expensive. That is why a cost-conscious fleet keeps a few cheap-to-build plants that hardly ever run, and it’s the
        same reasoning that put Eastgate and Old Quay in our region.
      </P>
      <P>
        Wind and solar sit apart as two points. Their megawatt-hours are cheap — about $37 and $35 at the reference day’s capacity factors — but they can’t choose when to
        produce them, so they don’t replace the need for firm capacity. Coal and nuclear never win in these numbers without a carbon price: their high fixed costs only pay
        off over many hours, and combined-cycle gas is cheaper even running all year. Raise the carbon price and watch the curves shift. Coal, the dirtiest, falls further
        behind, while nuclear, which emits nothing as it runs, starts to look attractive for plants that run almost continuously.
      </P>

      <Challenge
        id="b"
        question={`With no carbon price, a plant run ${fmt(BASELOAD_HOURS)} hours a year costs $${CC_AT_BASELOAD.toFixed(2)} per MWh as combined-cycle gas and $${NUC_AT_BASELOAD.toFixed(2)} as nuclear. Gas emits ${MIX_TECH.gasCC.emissions} t of CO₂ per MWh; nuclear emits none. Work out the lowest whole-dollar carbon price at which nuclear becomes the cheapest way to run a plant ${fmt(BASELOAD_HOURS)} hours a year, then set the carbon price to check.`}
        solved={solved2}
        status={
          baseBest === 'nuclear'
            ? `At $${carbon} per tonne nuclear is the cheapest at ${fmt(BASELOAD_HOURS)} hours — but is that the lowest such price?`
            : `At $${carbon} per tonne and ${fmt(BASELOAD_HOURS)} hours, ${FUEL_LABEL[baseBest].toLowerCase()} costs $${screeningCost(MIX_TECH[baseBest], BASELOAD_HOURS, carbon).toFixed(2)} per MWh and nuclear $${nucAt.toFixed(2)}.`
        }
        success={`Solved. Nuclear’s $${(NUC_AT_BASELOAD - CC_AT_BASELOAD).toFixed(2)} disadvantage divided by gas’s ${MIX_TECH.gasCC.emissions} t per MWh is $${((NUC_AT_BASELOAD - CC_AT_BASELOAD) / MIX_TECH.gasCC.emissions).toFixed(2)} a tonne, so it takes $${NUCLEAR_CARBON}: then nuclear costs $${nucAt.toFixed(2)} per MWh and combined-cycle gas $${ccAt.toFixed(2)}. A carbon price works by adding to the running cost of the plants that emit.`}
      />

      <P>
        Real fleets are portfolios for exactly these reasons: a base of plants that are cheap to run, a middle of flexible plants, a few peakers for the rare highest hours,
        and weather-driven plants wherever wind or sunshine is cheap. Real plans weigh much more than one day — droughts, fuel prices, how long a plant takes to build — but
        the trade between fixed and running costs is at the heart of all of them.
      </P>
      <P>
        Notice, though, where the plants have ended up: on the coast, out in the West, on the windy ridge and in the sunny valley, wherever their fuel, water or weather
        is. Most of the region’s customers are somewhere else, in Metro. Getting the power to them is the job of the transmission and distribution networks, which we’ll
        build next.
      </P>
    </LessonPage>
  );
}
