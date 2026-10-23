import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FUEL,
  FigRef,
  Figure,
  Frac,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  Tn,
  hour,
  kw,
  kwh,
  lessonHref,
  pct,
  usd,
  useScenario,
} from '../../framework';
import { homeBill, simulateHome, type HomeDay, type HomeStrategy, type Tariff } from '../../engines/ops/der';
import { HOME_LOAD_KW, SOLAR_CF } from '../../model/profiles';

// Illustrative retail tariffs (not any particular utility's), $ per kWh.
const FLAT = 0.16;
const OFF_PEAK = 0.11;
const PEAK = 0.36;
const PEAK_HOURS: [number, number] = [16, 21];
const EXPORT_RATE = 0.05;
const EFFICIENCY = 0.9;

type ImportPlan = 'flat' | 'tou';
type ExportPlan = 'nem' | 'rate';

function tariff(imp: ImportPlan, exp: ExportPlan): Tariff {
  const importPrice = Array.from({ length: 24 }, (_, h) => (imp === 'flat' ? FLAT : h >= PEAK_HOURS[0] && h < PEAK_HOURS[1] ? PEAK : OFF_PEAK));
  const exportCredit = exp === 'nem' ? importPrice.slice() : Array<number>(24).fill(EXPORT_RATE);
  return { importPrice, exportCredit };
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const GRID = '#8a8a8a';
const EXPORT = '#c99a1e';

// Reference cases quoted in the prose: 6 kW of panels, with and without a 13.5 kWh / 5 kW battery.
const home = (pvKW: number, batteryKWh: number, strategy: HomeStrategy = 'self') =>
  simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW, batteryKW: batteryKWh > 0 ? 5 : 0, batteryKWh, efficiency: EFFICIENCY, reserve: 0.2, strategy });
const REF_GRID = home(0, 0);
const REF_PV = home(6, 0);
const REF_BAT = home(6, 13.5);
const REF = {
  pvMade: sum(REF_PV.pv),
  pvExportShare: sum(REF_PV.gridExport) / sum(REF_PV.pv),
  importsPv: sum(REF_PV.gridImport),
  importsBat: sum(REF_BAT.gridImport),
  touGrid: homeBill(REF_GRID, tariff('tou', 'nem')).net,
  touNemPv: homeBill(REF_PV, tariff('tou', 'nem')).net,
  touRateSaving: homeBill(REF_PV, tariff('tou', 'rate')).net - homeBill(REF_BAT, tariff('tou', 'rate')).net,
};

function cents(x: number) {
  return `${Math.round(x * 100)}¢`;
}

export default function Lesson() {
  const s = useScenario('home', {
    pv: 6,
    kwh: 0,
    kw: 5,
    reserve: 0.2,
    imp: 'tou' as ImportPlan,
    exp: 'nem' as ExportPlan,
    strategy: 'self' as HomeStrategy,
    eff: EFFICIENCY,
    at: 13,
  });
  const { pv, kwh: cap, kw: power, reserve, imp, exp, strategy, eff, at } = s.state;

  const day = useMemo(
    () => simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: power, batteryKWh: cap, efficiency: eff, reserve, strategy: 'self' }),
    [pv, power, cap, reserve, eff],
  );
  const made = sum(day.pv);
  const used = sum(day.load);
  const exported = sum(day.gridExport);
  const imported = sum(day.gridImport);
  const battery = day.discharge.map((d, h) => d - day.charge[h]);
  const grid = day.gridImport.map((v, h) => v - day.gridExport[h]);
  const solved = cap > 0 && day.selfSufficiency >= 0.9 && exported < 1;

  // Second figure: the same home under the chosen tariff and battery strategy.
  const t = useMemo(() => tariff(imp, exp), [imp, exp]);
  const bills = useMemo(() => {
    const none = simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: 0, batteryKW: 0, batteryKWh: 0, efficiency: eff, reserve, strategy });
    const solar = simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: 0, batteryKWh: 0, efficiency: eff, reserve, strategy });
    const both = simulateHome(HOME_LOAD_KW, SOLAR_CF, { pvKW: pv, batteryKW: power, batteryKWh: cap, efficiency: eff, reserve, strategy });
    const row = (name: string, d: HomeDay) => ({ name, d, bill: homeBill(d, t) });
    return [row('Grid only', none), row('Solar', solar), row('Solar + battery', both)];
  }, [pv, power, cap, reserve, strategy, eff, t]);
  const solarSaves = bills[0].bill.net - bills[1].bill.net;
  const batterySaves = bills[1].bill.net - bills[2].bill.net;
  const solved2 = cap > 0 && pv > 0 && batterySaves < -0.005;
  const shiftValue = t.importPrice[19] - t.exportCredit[12] / eff;

  const h = Math.min(23, Math.max(0, at));
  let hourText: string;
  if (day.gridExport[h] > 0.05)
    hourText = `At ${hour(h)} the panels make ${kw(day.pv[h])} and the house uses ${kw(day.load[h])}. ${day.charge[h] > 0.05 ? `The battery takes ${kw(day.charge[h])}, and the` : cap > 0 ? 'The battery is full, so the' : 'The'} remaining ${kw(day.gridExport[h])} flows out to the grid.`;
  else if (day.discharge[h] > 0.05)
    hourText = `At ${hour(h)} the house uses ${kw(day.load[h])}${day.pv[h] > 0.05 ? ` and the panels make ${kw(day.pv[h])}` : ''}. The battery supplies ${kw(day.discharge[h])}${day.gridImport[h] > 0.05 ? ` and the grid the remaining ${kw(day.gridImport[h])}` : ''}.`;
  else
    hourText = `At ${hour(h)} the house uses ${kw(day.load[h])}${day.pv[h] > 0.05 ? `, the panels make ${kw(day.pv[h])}` : ''}${cap > 0 && day.soc[h] <= reserve * cap + 0.05 ? ', the battery is down to its backup reserve' : ''}, and ${kw(day.gridImport[h])} comes from the grid.`;

  const chartA = (
    <TimeChart
      ariaLabel={`One day of a home with ${pv} kW of solar and a ${cap} kWh battery. It uses ${kwh(used)}, its panels make ${kwh(made)}, it exports ${kwh(exported)} and imports ${kwh(imported)}.`}
      yLabel="Power, kW"
      yFormat={(v) => String(v)}
      height={230}
      series={[
        { values: day.pv, color: FUEL.solar, kind: 'area', opacity: 0.55 },
        { values: battery, color: FUEL.battery, kind: 'bar', opacity: 0.85 },
        { values: day.load, color: '#333', width: 2.5 },
      ]}
      cursor={h}
      onScrub={(i) => s.set({ at: i })}
    />
  );

  return (
    <LessonPage id="7.1">
      <P>
        Until now, every power plant in the course has been a large machine connected to the high-voltage grid, and every battery we traded in Chapter 6 was measured in
        megawatts. This chapter moves to the other end of the wires. Millions of homes now have solar panels on the roof, and a growing number have a battery in the garage.
        Each is tiny — a few kilowatts — but together they add up to something the grid and its markets can no longer ignore.
      </P>
      <P>
        We’ll start with a single house. It uses the course’s typical home profile: about {kwh(used, 0)} over a spring day, lowest overnight and highest in the early
        evening, when people come home and cook. On its roof are solar panels whose output follows the same clear-day <K c="energy">solar</K> shape that drives the region’s
        Valley solar farm. Drag across the chart to read any hour, and use the sliders to size the system:
      </P>

      <Figure name="Home Energy Simulator" scenario={s}>
        <Legend
          items={[
            { label: 'Solar output', color: FUEL.solar },
            { label: 'Home use', color: '#333', kind: 'line' },
            { label: 'Battery (up: supplying the home, down: charging)', color: FUEL.battery },
          ]}
        />
        {chartA}
        <TimeChart
          ariaLabel={`Power crossing the meter: ${kwh(imported)} imported, ${kwh(exported)} exported over the day.`}
          yLabel="Grid, kW (up: import, down: export)"
          yFormat={(v) => String(v)}
          height={170}
          series={[{ values: grid, color: GRID, kind: 'bar', colors: grid.map((v) => (v >= 0 ? GRID : EXPORT)) }]}
          cursor={h}
          onScrub={(i) => s.set({ at: i })}
        />
        <Caption>{hourText}</Caption>
        <Readouts
          items={[
            { label: 'solar made', value: kwh(made), tone: 'gold' },
            { label: 'exported', value: kwh(exported) },
            { label: 'imported', value: kwh(imported) },
            { label: 'of the home’s use met on site', value: pct(day.selfSufficiency) },
          ]}
        />
        <Slider label="Solar panels" tone="gold" value={pv} min={0} max={12} step={0.5} onChange={(v) => s.set({ pv: v })} display={kw(pv)} />
        <Slider label="Battery capacity" tone="gold" value={cap} min={0} max={30} step={0.5} onChange={(v) => s.set({ kwh: v })} display={kwh(cap)} />
        <Slider label="Battery power rating" tone="red" value={power} min={0} max={10} step={0.5} onChange={(v) => s.set({ kw: v })} display={kw(power)} />
        <Slider
          label="Backup reserve"
          value={reserve}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => s.set({ reserve: v })}
          display={`${pct(reserve)} held for outages`}
        />
      </Figure>

      <P>
        Without a battery, the house and its panels keep very different hours. On this day 6 kW of panels make {kwh(REF.pvMade)} — more than the house uses — but most of
        it arrives between 9:00 and 16:00, when the house needs little. With the starting settings, {pct(REF.pvExportShare)} of the solar energy flows out to the grid,
        and the evening, when the house uses the most, is supplied almost entirely by the grid. Only {pct(REF_PV.selfConsumption)} of the solar output is used at home.
        That share is the house’s <K>self-consumption</K>.
      </P>
      <P>
        Now give the house a battery — a common home unit stores about 13.5 kWh and delivers 5 kW. The midday surplus fills the battery before anything is exported, and
        the battery carries the house through the evening. Imports fall from {kwh(REF.importsPv)} to {kwh(REF.importsBat)}, self-consumption rises to{' '}
        {pct(REF_BAT.selfConsumption)}, and the house meets {pct(REF_BAT.selfSufficiency)} of its own use. The battery never empties completely, though: the backup reserve
        is energy the owner keeps for an outage, and the battery won’t dip into it for everyday use.
      </P>

      <Challenge
        id="a"
        question="Size the system so the house meets at least 90% of its own electricity use on site while exporting less than 1 kWh over the day."
        solved={solved}
        status={`Right now the house meets ${pct(day.selfSufficiency)} of its use on site and exports ${kwh(exported)}.`}
        success={`Solved. ${kw(pv)} of panels and ${kwh(cap)} of storage: the panels make only a little more than the house uses, and the battery is large enough to hold the midday surplus for the evening.`}
      />

      <P>
        The challenge shows the tension in sizing a home system: bigger panels make more energy, but past a point the extra mostly leaves the house at midday. Remember, too,
        that this is one clear spring day repeated. On cloudy days and in winter, the same house imports much more.
      </P>

      <H2>The midday glut</H2>
      <P>
        One house exporting four kilowatts at noon is invisible to the grid. A city where tens of thousands of houses do it at the same moment is not. Rooftop output peaks
        everywhere at once, so it arrives as a wave: it lowers the demand that power plants must meet in the middle of the day, then disappears just as evening demand
        climbs. In regions with a lot of solar, such as California, the shape of the remaining demand has a name — the “duck curve” — and midday wholesale prices are
        often near zero or negative in spring. On the distribution network, exports flowing backward along feeders built for one-way flow raise local voltages, and some
        utilities cap how much a new system may export.
      </P>
      <P>
        So a kilowatt-hour exported at noon is worth little to the grid, while one supplied at 19:00 is worth a lot. Whether the household feels that difference depends
        entirely on how its tariff pays for exports. In the next demonstration, the same house is billed under different (illustrative) tariffs. <b>Net metering</b> credits each exported
        kilowatt-hour at the same retail price as an imported one. An <b>export rate</b> pays a fixed {cents(EXPORT_RATE)} per exported kWh instead. The import price is
        either flat, at {cents(FLAT)} per kWh, or <K c="price">time-of-use</K>: {cents(OFF_PEAK)} most of the day and {cents(PEAK)} from 16:00 to 21:00. The house
        keeps the panels and battery you gave it in <FigRef to="Home Energy Simulator">the first demonstration</FigRef> (to follow the numbers in the next few paragraphs,
        use 6 kW of panels and a 13.5 kWh battery):
      </P>

      <Figure name="Home Energy Simulator · the bill" scenario={s}>
        <Segmented
          label="Import price"
          value={imp}
          onChange={(v) => s.set({ imp: v })}
          options={[
            { value: 'flat', label: 'Flat rate' },
            { value: 'tou', label: 'Time-of-use' },
          ]}
        />
        <Segmented
          label="Export credit"
          value={exp}
          onChange={(v) => s.set({ exp: v })}
          options={[
            { value: 'nem', label: 'Net metering' },
            { value: 'rate', label: `Export rate (${cents(EXPORT_RATE)})` },
          ]}
        />
        <Segmented
          label="Battery strategy"
          value={strategy}
          onChange={(v) => s.set({ strategy: v })}
          options={[
            { value: 'self', label: 'Self-consumption' },
            { value: 'tou', label: 'Save for the peak' },
          ]}
        />
        <TimeChart
          ariaLabel={`Price of imports and credit for exports through the day under the ${imp === 'flat' ? 'flat' : 'time-of-use'} rate with ${exp === 'nem' ? 'net metering' : 'an export rate'}.`}
          yLabel="Price, $ per kWh"
          yMin={0}
          yMax={0.4}
          yFormat={(v) => '$' + v.toFixed(2)}
          height={150}
          series={[
            { values: t.importPrice, color: '#6d9c37', kind: 'step', width: 3 },
            { values: t.exportCredit, color: EXPORT, kind: 'step', width: 2, dash: '6 4' },
          ]}
        />
        <Legend
          items={[
            { label: 'Import price', color: '#6d9c37', kind: 'line' },
            { label: 'Export credit', color: EXPORT, kind: 'line', dashed: true },
          ]}
        />
        <DataTable
          caption="Daily energy bill"
          rows={bills}
          rowKey={(r) => r.name}
          rowClass={(r) => (r.name === 'Solar + battery' ? 'hl' : '')}
          columns={[
            { label: 'Home', cell: (r) => r.name },
            { label: 'Imported', cell: (r) => kwh(sum(r.d.gridImport)) },
            { label: 'Exported', cell: (r) => kwh(sum(r.d.gridExport)) },
            { label: 'Import cost', cell: (r) => usd(r.bill.importCost, 2) },
            { label: 'Export credit', cell: (r) => usd(r.bill.exportCredit, 2) },
            { label: 'Daily bill', cell: (r) => <Tn tone={r.bill.net < 0 ? 'green' : 'ink'}>{usd(r.bill.net, 2)}</Tn> },
          ]}
        />
        <Readouts
          items={[
            { label: 'solar saves per day', value: usd(solarSaves, 2), tone: solarSaves >= 0 ? 'green' : 'red' },
            { label: 'the battery saves on top', value: usd(batterySaves, 2), tone: batterySaves >= 0 ? 'green' : 'red' },
          ]}
        />
        <Eq label={`Value of moving one kilowatt-hour from noon to 19:00: ${cents(t.importPrice[19])} minus ${cents(t.exportCredit[12])} divided by ${eff.toFixed(2)}, which is ${cents(shiftValue)}`}>
          <span>value of 1 kWh moved from noon to 19:00</span>
          <Op>=</Op>
          <K c="price">{cents(t.importPrice[19])}</K>
          <Op>−</Op>
          <Frac top={<K c="price">{cents(t.exportCredit[12])}</K>} bottom={eff.toFixed(2)} />
          <Op>=</Op>
          <Tn tone={shiftValue >= 0 ? 'green' : 'red'}>{shiftValue < 0 ? '−' : ''}{(Math.abs(shiftValue) * 100).toFixed(1)}¢</Tn>
        </Eq>
        <Slider label="Solar panels" tone="gold" value={pv} min={0} max={12} step={0.5} onChange={(v) => s.set({ pv: v })} display={kw(pv)} />
        <Slider label="Battery capacity" tone="gold" value={cap} min={0} max={30} step={0.5} onChange={(v) => s.set({ kwh: v })} display={kwh(cap)} />
        <Slider label="Round-trip efficiency" value={eff} min={0.7} max={1} step={0.01} onChange={(v) => s.set({ eff: v })} display={pct(eff)} />
      </Figure>

      <P>
        The bill counts energy charges only, and a negative bill is a credit. Under net metering, the grid acts as a free, lossless battery: an exported kilowatt-hour
        earns back exactly what an imported one costs, so each kilowatt-hour of solar is worth the full retail price whenever it’s made. With time-of-use rates, 6 kW of
        panels turn a {usd(REF.touGrid, 2)} daily bill into {usd(REF.touNemPv, 2)}.
      </P>
      <P>
        Switch to the export rate and the picture changes. Every exported kilowatt-hour now earns a fraction of what the house pays to import one, so the household is
        better off using its own solar than selling it. That is the case for a battery: it turns low-value exports into avoided high-value imports. Under time-of-use rates
        with the export rate, the 13.5 kWh battery saves {usd(REF.touRateSaving, 2)} a day. The equation in the figure shows why, for one kilowatt-hour moved from noon to
        19:00: the battery avoids buying it in the evening, but gives up the credit for exporting it at noon — and, because about 10% is lost on the round trip, it must
        store a little more than it returns.
      </P>

      <Challenge
        id="b"
        question="With solar and a battery installed, find tariff settings under which the battery makes the daily bill higher than solar alone."
        solved={solved2}
        status={cap > 0 && pv > 0 ? `Under these settings the battery changes the daily bill by ${usd(-batterySaves, 2)}.` : 'Give the house both solar panels and a battery.'}
        success="Solved. With a flat rate and net metering, storing solar for later earns nothing — an exported kilowatt-hour is already worth as much as an imported one — and every round trip through the battery loses about 10% of the energy."
      />

      <P>
        So export compensation decides whether home batteries get built and how they run. Flat-rate net metering rewards panels but gives a battery no everyday job;
        low export rates and time-of-use prices reward exactly what the grid needs, which is soaking up the midday glut and supplying the evening peak. Policy has been
        moving that way. In April 2023, California’s three large investor-owned utilities moved new rooftop customers from net metering to a net billing tariff that
        credits exports at values varying by hour, and the share of new systems installed with a battery rose sharply afterward.
      </P>
      <P>
        Notice what the battery was doing all along, though. With self-consumption, it waits for the house to need power; with “save for the peak,” it holds its charge
        until 16:00. Either way it works for one household, using one meter’s prices. A grid operator facing a shortage at 19:00 would happily pay for more from it — but a
        5 kW battery can’t bid into a wholesale market on its own. In the{' '}
        <a href={lessonHref('7.2')}>next lesson</a>, we’ll gather hundreds of them together and see what kind of power plant they make.
      </P>
    </LessonPage>
  );
}
