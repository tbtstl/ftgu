import { useMemo } from 'react';
import { Caption, Challenge, Eq, FigRef, Figure, H2, K, LessonPage, Op, P, Readouts, Segmented, Slider, Sub, fmt, lessonHref, usd, useScenario } from '../../../framework';
import {
  FUELS,
  FUEL_BY_ID,
  airFuelRatio,
  co2PerKg,
  co2PerMJ,
  co2PerMJFromHC,
  gjPerBarrel,
  lhvFromHC,
  mjPerLiter,
  oxygenPerCarbon,
  usdPerGJ,
  type FuelId,
} from '../../../engines/oil/fuels';
import { REF_PRICES, perGallon } from '../../../model/oil/world';
import { XYChart } from '../shared/charts';

/** The model's reference prices for each fuel, $ per barrel (simulated). */
const PRICE: Record<FuelId, number> = {
  lpg: REF_PRICES.lpg,
  gasoline: REF_PRICES.gasoline,
  jet: REF_PRICES.jet,
  diesel: REF_PRICES.diesel,
  fuelOil: REF_PRICES.hsfo,
  ethanol: REF_PRICES.ethanol,
};
const HC_FUELS = FUELS.filter((f) => f.id !== 'ethanol');
const LEFT_LABEL = new Set<FuelId>(['diesel', 'fuelOil', 'lpg']);

/** Challenge a: a fuel-oil price at which it costs the same per gigajoule as diesel (within 10¢). */
export function parityPrice(): number {
  return usdPerGJ(FUEL_BY_ID.diesel, PRICE.diesel) * gjPerBarrel(FUEL_BY_ID.fuelOil);
}
export function paritySolved(hfoPrice: number): boolean {
  return Math.abs(usdPerGJ(FUEL_BY_ID.fuelOil, hfoPrice) - usdPerGJ(FUEL_BY_ID.diesel, PRICE.diesel)) <= 0.1;
}

/** Challenge b: the hydrogen-to-carbon ratio that needs 14.7 kg of air per kg of fuel. */
export function airSolved(r: number): boolean {
  return Math.round(airFuelRatio(r) * 10) / 10 === 14.7;
}

function hc(r: number): string {
  return fmt(r, 2);
}

export default function Lesson() {
  const s1 = useScenario('energy', { fuel: 'diesel' as FuelId, hfo: REF_PRICES.hsfo });
  const fuel = FUEL_BY_ID[s1.state.fuel];
  const prices = { ...PRICE, fuelOil: s1.state.hfo };
  const perGJ = (id: FuelId) => usdPerGJ(FUEL_BY_ID[id], prices[id]);
  const gas = FUEL_BY_ID.gasoline;
  const dsl = FUEL_BY_ID.diesel;
  const hfo = FUEL_BY_ID.fuelOil;
  const solvedA = paritySolved(s1.state.hfo);

  const s2 = useScenario('combustion', { r: 1.5 });
  const r = s2.state.r;
  const curve = useMemo(() => Array.from({ length: 61 }, (_, i) => 1 + i * 0.05).map((x) => [x, lhvFromHC(x)] as [number, number]), []);
  const solvedB = airSolved(r);
  const o2 = oxygenPerCarbon(r);

  const maxGJ = Math.max(...FUELS.map((f) => perGJ(f.id)));

  return (
    <LessonPage id="oil/1.5">
      <P>
        Every fuel made from crude oil is sold for the energy it releases when it burns. The four lessons so far have looked at crude oil’s molecules, its cuts and how
        it separates. This last lesson of the chapter asks how much energy each product carries, where it comes from, and why fuels with nearly the same energy can
        sell for very different prices.
      </P>
      <P>
        Burning a hydrocarbon joins its carbon and hydrogen to oxygen from the air, making carbon dioxide and water. Breaking the fuel’s bonds takes energy, but forming
        the strong bonds of CO₂ and water releases much more, and the difference is the fuel’s <K c="energy">heating value</K>. When the water leaves as vapor, as it does
        from an engine, the heat recovered is the <b>lower heating value</b>, the one used throughout this course. In the next demonstration, each fuel is placed by
        its energy per kilogram and its energy per liter. Choose a fuel:
      </P>

      <Figure name="Fuel Energy Lab" scenario={s1}>
        <Segmented label="Fuel" value={s1.state.fuel} onChange={(v) => s1.set({ fuel: v })} options={FUELS.map((f) => ({ value: f.id, label: f.name }))} />
        <XYChart
          ariaLabel={`Energy per kilogram against energy per liter: ${FUELS.map((f) => `${f.name} ${fmt(f.lhv, 1)} MJ/kg and ${fmt(mjPerLiter(f), 1)} MJ/L`).join('; ')}.`}
          height={250}
          x={[24, 48]}
          y={[18, 42]}
          xTicks={[25, 30, 35, 40, 45]}
          yTicks={[20, 25, 30, 35, 40]}
          xLabel="energy per kilogram, MJ/kg"
          yLabel="Energy per liter, MJ/L"
          markers={FUELS.map((f) => ({
            x: f.lhv,
            y: mjPerLiter(f),
            color: f.color,
            r: f.id === s1.state.fuel ? 9 : 6,
            label: f.name,
            labelDx: LEFT_LABEL.has(f.id) ? -12 : 12,
            labelAnchor: LEFT_LABEL.has(f.id) ? ('end' as const) : ('start' as const),
            labelDy: f.id === 'gasoline' ? 8 : 4,
          }))}
        />
        <Readouts
          items={[
            { label: <K c="energy">per kilogram</K>, value: `${fmt(fuel.lhv, 1)} MJ`, tone: 'gold' },
            { label: <K c="energy">per liter</K>, value: `${fmt(mjPerLiter(fuel), 1)} MJ`, tone: 'gold' },
            { label: <K c="energy">per barrel</K>, value: `${fmt(gjPerBarrel(fuel), 2)} GJ`, tone: 'gold' },
            { label: 'CO₂ per MJ', value: `${fmt(co2PerMJ(fuel), 1)} g` },
          ]}
        />
        <PricePerGJ perGJ={perGJ} prices={prices} selected={s1.state.fuel} max={maxGJ} />
        <Slider
          label="Heavy fuel oil price"
          tone="green"
          value={s1.state.hfo}
          min={30}
          max={130}
          step={0.5}
          onChange={(v) => s1.set({ hfo: v })}
          display={`${usd(s1.state.hfo, s1.state.hfo % 1 ? 2 : 0)} per barrel`}
        />
        <Caption>
          {fuel.name}: {fuel.burns}.
        </Caption>
      </Figure>

      <P>
        Two things set a fuel’s place on this chart. Energy per kilogram depends on how much hydrogen the fuel carries, because hydrogen releases far more heat per
        kilogram than carbon does: LPG, the most hydrogen-rich, leads at {fmt(FUEL_BY_ID.lpg.lhv, 1)} MJ/kg, and of the hydrocarbon fuels heavy fuel oil, the least, trails at {fmt(hfo.lhv, 1)}.
        Energy per liter also depends on density, and there the order reverses: heavy fuel oil packs {fmt(mjPerLiter(hfo), 1)} MJ into a liter and LPG only{' '}
        {fmt(mjPerLiter(FUEL_BY_ID.lpg), 1)}. Ethanol sits apart: it’s already partly oxidized, since a third of its weight is oxygen, so it has less left to give.
      </P>
      <P>
        Fuels are sold by volume — by the gallon at the pump and by the barrel in bulk — and volume is what this chart’s vertical axis measures. A barrel of diesel
        carries {fmt(gjPerBarrel(dsl), 2)} gigajoules, {fmt((gjPerBarrel(dsl) / gjPerBarrel(gas) - 1) * 100)}% more than a barrel of gasoline at{' '}
        {fmt(gjPerBarrel(gas), 2)}. Jet fuel sits between them and is the kerosene cut of <a href={lessonHref('oil/1.1')}>Lesson 1.1</a>: dense enough to carry a long way
        in an aircraft’s tanks, light enough per kilogram to lift, and, crucially, slow to freeze at altitude.
      </P>

      <H2>Price per unit of energy</H2>
      <P>
        The bars in the demonstration divide each fuel’s price by the energy in a barrel. The prices are the course’s reference prices: simulated, for a calm month in
        our model, not market data. Gasoline sells for {usd(PRICE.gasoline)} a barrel ({usd(perGallon(PRICE.gasoline), 2)} a gallon) and diesel for {usd(PRICE.diesel)}{' '}
        ({usd(perGallon(PRICE.diesel), 2)} a gallon), yet per gigajoule they’re within a few cents of each other — diesel’s higher price per barrel buys more energy. Heavy
        fuel oil and LPG are another matter: each costs about half as much per gigajoule.
      </P>
      <P>
        Energy alone doesn’t set the price, then. What a fuel can do matters too. Heavy fuel oil is the residue of <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>: it’s
        too thick to pour cold, it carries most of the crude’s sulfur, and only large engines and boilers built for it can burn it. LPG must be stored under pressure. A
        gigajoule in diesel, which any truck can use, is worth more than a gigajoule in fuel oil.
      </P>

      <Challenge
        id="a"
        question="Find the price of heavy fuel oil at which it would cost exactly as much per gigajoule as diesel."
        solved={solvedA}
        status={`At ${usd(s1.state.hfo, 2)} a barrel, heavy fuel oil costs ${usd(perGJ('fuelOil'), 2)} per gigajoule, against diesel’s ${usd(perGJ('diesel'), 2)}.`}
        success={`Solved: about ${usd(parityPrice(), 0)} a barrel — far above the ${usd(PRICE.fuelOil)} it sells for in our model. That gap is a refinery’s opportunity. Every barrel of residue it can turn into diesel instead of fuel oil is worth tens of dollars more, which is why refiners build the expensive conversion units of Chapter 3.`}
      />

      <H2>Hydrogen, carbon and air</H2>
      <P>
        Why does hydrogen matter so much? Take a generic hydrocarbon with r hydrogen atoms for every carbon atom, written CH<Sub>r</Sub>. Burning it completely needs one
        oxygen molecule for each carbon and one for every four hydrogens. In the next demonstration, change the hydrogen-to-carbon ratio and watch the balance, the energy
        and the air the fuel needs. The curve is a two-term estimate, fitted to pure hydrocarbons and commercial fuels, of energy from the mass shares of carbon and
        hydrogen; the dots are the real fuels:
      </P>

      <Figure name="Fuel Energy Lab · combustion" scenario={s2}>
        <Eq label={`CH ${hc(r)} plus ${fmt(o2, 3)} oxygen molecules gives one CO2 and ${fmt(r / 2, 3)} water molecules`}>
          <span>
            CH<Sub>{hc(r)}</Sub>
          </span>
          <Op>+</Op>
          <span>{fmt(o2, 3)} O₂</span>
          <Op>→</Op>
          <span>CO₂</span>
          <Op>+</Op>
          <span>{fmt(r / 2, 3)} H₂O</span>
        </Eq>
        <XYChart
          ariaLabel={`Energy per kilogram against the ratio of hydrogen to carbon atoms. At ${hc(r)}, the estimate is ${fmt(lhvFromHC(r), 1)} MJ/kg. Fuels: ${HC_FUELS.map((f) => `${f.name} ${hc(f.hc)}, ${fmt(f.lhv, 1)} MJ/kg`).join('; ')}.`}
          height={240}
          x={[1, 4]}
          y={[38, 52]}
          xTicks={[1, 1.5, 2, 2.5, 3, 3.5, 4]}
          yTicks={[38, 42, 46, 50]}
          xLabel="hydrogen atoms per carbon atom"
          yLabel="Energy per kilogram, MJ/kg"
          series={[{ points: curve, color: '#c99a1e', width: 2.5 }]}
          refs={[{ axis: 'x', at: r, cursor: true }]}
          markers={[
            ...HC_FUELS.map((f) => ({
              x: f.hc,
              y: f.lhv,
              color: f.color,
              r: 5,
              label: f.id === 'gasoline' || f.id === 'diesel' ? undefined : f.id === 'jet' ? 'Gasoline, jet fuel, diesel' : f.name,
              labelDy: f.id === 'jet' ? -12 : 16,
            })),
            { x: 4, y: 50.0, color: '#8fb8d8', r: 5, label: 'Methane', labelDx: -8, labelAnchor: 'end' as const, labelDy: 16 },
            { x: r, y: lhvFromHC(r), color: '#8a6500', r: 7 },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="energy">energy per kilogram</K>, value: `${fmt(lhvFromHC(r), 1)} MJ`, tone: 'gold' },
            { label: 'CO₂ per MJ', value: `${fmt(co2PerMJFromHC(r), 1)} g` },
            { label: 'air per kg of fuel', value: `${fmt(airFuelRatio(r), 2)} kg` },
          ]}
        />
        <Slider label="Hydrogen atoms per carbon" tone="teal" value={r} min={1} max={4} step={0.01} onChange={(v) => s2.set({ r: Math.round(v * 100) / 100 })} display={hc(r)} />
      </Figure>

      <P>
        At a ratio of 1, the composition of benzene and other aromatics, the estimate gives {fmt(lhvFromHC(1), 1)} MJ/kg and {fmt(co2PerMJFromHC(1))} grams of CO₂ for
        every megajoule. At 4, methane, it gives {fmt(lhvFromHC(4), 1)} MJ/kg and just {fmt(co2PerMJFromHC(4))} grams. The long chains of gasoline, jet fuel and diesel sit
        near 2. Heavy fuel oil, rich in the hydrogen-poor aromatics and asphaltenes of <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>, sits near{' '}
        {hc(hfo.hc)} and falls a little below the curve because it also contains sulfur and other atoms that add weight. Hydrogen-poor fuels release less energy and more
        carbon dioxide for each unit of it: every kilogram of diesel burned makes {fmt(co2PerKg(dsl), 2)} kg of CO₂.
      </P>
      <P>
        The same ratio sets how much air an engine must supply. Every carbon needs one oxygen molecule, but air is less than a quarter oxygen by weight, so each kilogram
        of fuel takes about fifteen kilograms of air. Gasoline engines are tuned to run near that exact balance, the <b>stoichiometric</b> ratio, so that their catalytic
        converters can clean up the exhaust.
      </P>

      <Challenge
        id="b"
        question="Gasoline engines are tuned to burn 14.7 kilograms of air for each kilogram of fuel. Find the hydrogen-to-carbon ratio that needs exactly that much air (to one decimal place)."
        solved={solvedB}
        status={`At ${hc(r)} hydrogens per carbon, the fuel needs ${fmt(airFuelRatio(r), 2)} kg of air per kilogram.`}
        success={`Solved: about ${hc(r)} hydrogen atoms per carbon atom — gasoline’s ratio. Each kilogram of such a fuel releases about ${fmt(lhvFromHC(r), 1)} MJ.`}
      />

      <P>
        That closes the chemistry. A crude oil is a mixture of molecules; the mixture can be separated by boiling; and the pieces — distinguished by size, shape and
        hydrogen content — become fuels with different uses and different values. The chapter’s question was why crude oils and fuels differ in value, and the answer so
        far is physical: light, sweet crudes yield more of the fuels engines want with less work, and those fuels are worth more because of what they can do, not just
        the energy they hold.
      </P>
      <P>
        None of it matters until the oil is out of the ground. Chapter 2 goes underground, to the rock that holds Northfield Sour and Ridgeback Light, and asks how oil
        flows to a well and what it costs to bring up. Its first lesson begins with <a href={lessonHref('oil/2.1')}>the reservoir</a>. You can return to{' '}
        <FigRef to="Fuel Energy Lab">the first demonstration</FigRef> to compare any fuel’s energy and price.
      </P>
    </LessonPage>
  );
}

/** Bars of $ per GJ for each fuel. */
function PricePerGJ({ perGJ, prices, selected, max }: { perGJ: (id: FuelId) => number; prices: Record<FuelId, number>; selected: FuelId; max: number }) {
  const X0 = 130;
  const X1 = 520;
  const rowH = 24;
  const top = 22;
  const scaleMax = Math.max(30, Math.ceil(max / 5) * 5);
  const H = top + rowH * FUELS.length + 6;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`Price per gigajoule: ${FUELS.map((f) => `${f.name} ${usd(perGJ(f.id), 2)} (${usd(prices[f.id], prices[f.id] % 1 ? 2 : 0)} a barrel)`).join(', ')}.`}
    >
      <text className="ax" x={X0} y={12}>
        Price per gigajoule of energy (simulated reference prices)
      </text>
      {FUELS.map((f, i) => {
        const y = top + i * rowH;
        const w = (perGJ(f.id) / scaleMax) * (X1 - X0);
        return (
          <g key={f.id}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333', fontWeight: f.id === selected ? 600 : 400 }}>
              {f.name}
            </text>
            <rect x={X0} y={y + 4} width={Math.max(0, w)} height={rowH - 8} fill={f.id === selected ? '#6d9c37' : '#b9cf9c'} />
            <text x={X0 + w + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: '#3f7a1e' }}>
              {usd(perGJ(f.id), 2)}
              <tspan style={{ fill: '#5f5f5f', fontWeight: 400 }}> · {usd(prices[f.id], prices[f.id] % 1 ? 2 : 0)}/bbl</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
