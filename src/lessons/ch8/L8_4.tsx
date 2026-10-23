import { useDeferredValue, useMemo, useState } from 'react';
import { Button, Caption, Challenge, DataTable, FUEL, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, TimeChart, Tn, fmt, hour, mw, mwh, pct, signed, usd } from '../../framework';
import { defaultDesign, updateCapstone, useCapstone, type CapstoneDesign, type Transition, type WeatherId } from './capstone';
import { HOURS, STORAGE_SLICES, WEATHER, WEATHER_IDS, argmax, availability, checkSystem, emissions, outputByFuel, runMarket, siteName, systemOf, type MarketRun } from './system';
import { EmptyNote, FUEL_NAME, FUEL_ORDER, NodePicker, ResetGridButton } from './ui';

type Resource = 'wind' | 'solar' | 'storage';

const BATTERY_EFFICIENCY = 0.85;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

function curtailed(run: MarketRun): number {
  let s = 0;
  for (const g of run.sys.gens) {
    const avail = availability(g, run.sys.weather);
    if (!avail) continue;
    run.hours.forEach((h, i) => (s += Math.max(0, avail[i] - (h.dispatch[g.id] ?? 0))));
  }
  return s;
}

function metrics(run: MarketRun) {
  const sys = run.sys;
  const peak = argmax(run.demand);
  const inj: Record<string, number> = {};
  for (const n of sys.net.nodes) inj[n.id] = (sys.loads[n.id]?.[peak] ?? 0) - (run.netLoads[n.id]?.[peak] ?? 0);
  const c = checkSystem(sys, inj);
  return {
    unserved: run.summary.unservedMWh,
    margin: c.capacity.margin,
    congested: run.summary.congestedHours,
    rent: run.summary.congestionRent,
    avg: run.summary.averagePrice,
    peak: run.summary.peakPrice.price,
    negative: run.summary.negativeHours,
    curtailed: curtailed(run),
    co2: emissions(run),
    coal: run.sys.gens.filter((g) => g.fuel === 'coal').reduce((a, g) => a + (run.summary.units[g.id]?.mwh ?? 0), 0),
  };
}

const withDay = (d: CapstoneDesign, w: WeatherId): CapstoneDesign => (d.weather === w ? d : { ...d, weather: w });

export default function Lesson() {
  const live = useCapstone();
  const d = useDeferredValue(live);
  const [res, setRes] = useState<Resource>('wind');
  const [dayPick, setDay] = useState<WeatherId | null>(null);
  const day = dayPick ?? live.weather;
  const t = live.transition;
  const setT = (patch: Partial<Transition>) => updateCapstone((x) => ({ ...x, transition: { ...x.transition, ...patch } }));

  const runs = useMemo(() => {
    if (!d.nodes.length) return null;
    const dd = withDay(d, day);
    const before = runMarket(systemOf(dd, 'base'));
    const after = runMarket(systemOf(dd, 'transition'));
    // The same plan without its battery, to separate what storage does from what renewables do.
    const noStore = dd.transition.storageMW > 0 ? runMarket(systemOf({ ...dd, transition: { ...dd.transition, storageMW: 0 } }, 'transition')) : after;
    return { before, after, noStore, mb: metrics(before), ma: metrics(after), mn: metrics(noStore) };
  }, [d, day]);

  const pick = (n: string | undefined, fallback: string) => (n && live.nodes.includes(n) ? n : fallback);
  const first = live.nodes[0] ?? '';
  const windNode = pick(t.windNode, first);
  const solarNode = pick(t.solarNode, first);
  const storageNode = pick(t.storageNode, first);
  const start = defaultDesign().transition;

  if (!runs) {
    return (
      <LessonPage id="8.4">
        <P>The transition simulator needs a grid to add renewables to, and yours has no substations. Build one in Lesson 8.1, or reset your grid to the starting design.</P>
        <Figure name="Energy Transition Simulator" actions={<ResetGridButton />}>
          <EmptyNote>Nothing to simulate.</EmptyNote>
        </Figure>
        <Challenge id="a" question="Cut your grid’s emissions by at least half." solved={false} status="Your grid has no substations yet." success="" />
      </LessonPage>
    );
  }

  const { before, after, mb, ma, mn } = runs;
  const byFuel = outputByFuel(after);
  const batt = after.storage.find((s) => s.id === 'tr-battery');
  if (batt) byFuel.battery = batt.schedule.map((x) => Math.max(0, x));
  const fuels = FUEL_ORDER.filter((f) => byFuel[f] && byFuel[f].some((v) => v > 0.5));
  const charging = HOURS.map((h) => after.demand[h] + Math.max(0, -(batt?.schedule[h] ?? 0)));
  const cut = mb.co2 > 0 ? 1 - ma.co2 / mb.co2 : 0;
  const solved = mb.co2 > 0 && cut >= 0.5 && ma.congested <= mb.congested && ma.unserved <= 0.5;

  const rows: Array<{ k: string; b: string; a: string; ch: string; better?: boolean }> = [
    { k: 'Unserved energy', b: mwh(mb.unserved), a: mwh(ma.unserved), ch: signed(ma.unserved - mb.unserved) + ' MWh', better: ma.unserved <= mb.unserved },
    { k: 'Reserve margin at the peak', b: pct(mb.margin), a: pct(ma.margin), ch: signed((ma.margin - mb.margin) * 100) + ' pts', better: ma.margin >= mb.margin },
    { k: 'Hours with congestion', b: String(mb.congested), a: String(ma.congested), ch: signed(ma.congested - mb.congested), better: ma.congested <= mb.congested },
    { k: 'Congestion rent', b: usd(mb.rent), a: usd(ma.rent), ch: (ma.rent >= mb.rent ? '+' : '') + usd(ma.rent - mb.rent), better: ma.rent <= mb.rent },
    { k: 'Average price', b: usd(mb.avg, 2), a: usd(ma.avg, 2), ch: (ma.avg >= mb.avg ? '+' : '') + usd(ma.avg - mb.avg, 2), better: ma.avg <= mb.avg },
    { k: 'Highest price', b: usd(mb.peak), a: usd(ma.peak), ch: (ma.peak >= mb.peak ? '+' : '') + usd(ma.peak - mb.peak), better: ma.peak <= mb.peak },
    { k: 'Hours with negative prices', b: String(mb.negative), a: String(ma.negative), ch: signed(ma.negative - mb.negative) },
    { k: 'Wind and solar turned away', b: mwh(mb.curtailed), a: mwh(ma.curtailed), ch: signed(ma.curtailed - mb.curtailed) + ' MWh', better: ma.curtailed <= mb.curtailed },
    { k: 'Emissions, tonnes of CO₂', b: fmt(mb.co2), a: fmt(ma.co2), ch: mb.co2 > 0 ? signed(-cut * 100) + '%' : '—', better: ma.co2 <= mb.co2 },
  ];

  const newRenewMWh = after.sys.gens.filter((g) => g.id === 'tr-wind' || g.id === 'tr-solar').reduce((a, g) => a + (after.summary.units[g.id]?.mwh ?? 0), 0);
  const newAvail = after.sys.gens.filter((g) => g.id === 'tr-wind' || g.id === 'tr-solar').reduce((a, g) => a + (availability(g, day) ?? []).reduce((x, y) => x + y, 0), 0);
  const negHour = after.hours.find((h) => Object.values(h.lmp).some((p) => p < -1e-6));
  const capture = after.sys.gens
    .filter((g) => g.id === 'tr-wind' || g.id === 'tr-solar')
    .map((g) => ({ label: g.fuel === 'wind' ? 'wind farm' : 'solar farm', s: after.summary.units[g.id] }))
    .filter((c) => c.s && c.s.mwh > 1)
    .map((c) => ({ label: c.label, price: c.s.revenue / c.s.mwh }));

  // Storage figure.
  const sNode = batt?.node ?? storageNode;
  const pBefore = before.hours.map((h) => h.lmp[sNode] ?? 0);
  const pAfter = after.hours.map((h) => h.lmp[sNode] ?? 0);
  const used = batt ? Math.max(...batt.schedule.map(Math.abs)) : 0;
  const dischargedMWh = batt ? batt.schedule.reduce((a, x) => a + Math.max(0, x), 0) : 0;
  const yTop = Math.max(60, ...pBefore, ...pAfter);

  return (
    <LessonPage id="8.4">
      <P>
        The grid you’ve built runs mostly on fuel. In this lesson we’ll add wind, solar and batteries to it and measure the change in the three ways that matter to the
        people who run a grid — reliability, congestion and prices — as well as the one that’s usually the reason for the change: emissions.
      </P>
      <P>
        Wind and solar enter the market engine of the last lesson as plants that offer slightly below zero, with output each hour limited by the weather of your chosen day
        (Lesson 8.2). A battery enters as a schedule: it charges in cheap hours and discharges in dear ones at its own node. The starting plan adds {fmt(start.windMW)} MW of
        wind at {siteName(start.windNode)}, {fmt(start.solarMW)} MW of solar at {siteName(start.solarNode)} and a {fmt(start.storageMW)} MW, {start.storageHours}-hour
        battery at {siteName(start.storageNode)}. Edit any of them below; the table compares your grid before and after on the same day:
      </P>

      <Figure
        name="Energy Transition Simulator"
        actions={
          <>
            <Button onClick={() => setT({ windMW: 0, solarMW: 0, storageMW: 0 })}>Remove all additions</Button>
            <ResetGridButton />
          </>
        }
      >
        <Segmented<WeatherId> label="Day" value={day} onChange={setDay} options={WEATHER_IDS.map((w) => ({ value: w, label: WEATHER[w].label }))} />
        <Legend
          items={[
            ...fuels.map((f) => ({ label: FUEL_NAME[f], color: FUEL[f] })),
            { label: 'Demand', color: '#333', kind: 'line' as const },
            ...(batt ? [{ label: 'Demand plus charging', color: '#333', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`Generation by fuel after the transition on the ${WEATHER[day].label.toLowerCase()}. Emissions ${fmt(ma.co2)} tonnes, ${pct(cut)} below before.`}
          stack={fuels.map((f) => ({ values: byFuel[f], color: FUEL[f] }))}
          series={[{ values: after.demand, color: '#333', width: 2 }, ...(batt ? [{ values: charging, color: '#333', width: 1.5, dash: '5 4' }] : [])]}
          yLabel="Generation after the transition, MW"
          yMin={0}
          yFormat={(v) => fmt(v)}
        />
        <Segmented<Resource>
          label="Resource to edit"
          value={res}
          onChange={setRes}
          options={[
            { value: 'wind', label: 'Wind' },
            { value: 'solar', label: 'Solar' },
            { value: 'storage', label: 'Storage' },
          ]}
        />
        {res === 'wind' && (
          <>
            <Slider label="New wind" tone="teal" value={t.windMW} min={0} max={1000} step={50} onChange={(v) => setT({ windMW: v, windNode })} display={mw(t.windMW)} />
            <NodePicker label="Wind farm site" nodes={live.nodes} value={windNode} onChange={(n) => setT({ windNode: n })} />
          </>
        )}
        {res === 'solar' && (
          <>
            <Slider label="New solar" tone="gold" value={t.solarMW} min={0} max={1000} step={50} onChange={(v) => setT({ solarMW: v, solarNode })} display={mw(t.solarMW)} />
            <NodePicker label="Solar farm site" nodes={live.nodes} value={solarNode} onChange={(n) => setT({ solarNode: n })} />
          </>
        )}
        {res === 'storage' && (
          <>
            <Slider label="Battery power" tone="red" value={t.storageMW} min={0} max={500} step={25} onChange={(v) => setT({ storageMW: v, storageNode })} display={mw(t.storageMW)} />
            <Slider label="Hours of storage" tone="gold" value={t.storageHours} min={1} max={8} onChange={(v) => setT({ storageHours: v })} display={`${t.storageHours} h · ${fmt(t.storageMW * t.storageHours)} MWh`} />
            <NodePicker label="Battery site" nodes={live.nodes} value={storageNode} onChange={(n) => setT({ storageNode: n })} />
          </>
        )}
        <DataTable
          caption="Your grid before and after the transition"
          rows={rows}
          rowKey={(r) => r.k}
          columns={[
            { label: 'On this day', cell: (r) => r.k },
            { label: 'Before', cell: (r) => r.b },
            { label: 'After', cell: (r) => r.a },
            { label: 'Change', cell: (r) => (r.better === undefined ? r.ch : <Tn tone={r.better ? 'green' : 'red'}>{r.ch}</Tn>) },
          ]}
        />
      </Figure>

      <P>
        On this day your new wind and solar could produce {mwh(newAvail)}; the market takes {mwh(newRenewMWh)} of it
        {newAvail > 0 ? `, ${pct(newAvail > 0 ? newRenewMWh / newAvail : 0)}` : ''}. The average price moves from {usd(mb.avg, 2)} to <Tn tone="green">{usd(ma.avg, 2)}</Tn>{' '}
        per MWh: every megawatt-hour of wind or solar displaces the most expensive plant running in that hour, so prices fall when they produce, and fall most in the
        hours they produce most.
        {negHour
          ? ` At ${hour(negHour.hour)} prices go below zero. When the grid has more zero-fuel power than it can use or export from a node, the cheapest way to serve one more megawatt there is to turn away a little less wind or sun, which offers at −$5 or −$2 — so that becomes the price.`
          : ' On this day prices never go below zero.'}
      </P>
      <P>
        Congestion often gets worse, not better. Renewables go where the wind blows and the sun shines, and their power has to travel to the customers; the lines out of a
        windy node can fill even at night. Your plan changes the hours of congestion from {mb.congested} to {ma.congested}, and the wind and solar turned away from{' '}
        {mwh(mb.curtailed)} to {mwh(ma.curtailed)}. Reliability is a separate question again: the reserve margin at the peak goes from {pct(mb.margin)} to {pct(ma.margin)},
        because a solar farm contributes little at the {hour(argmax(after.demand))} peak and wind only what the evening breeze allows, while
        a battery counts for the power it can hold for four hours — a rule several US markets have used to accredit storage.
      </P>

      <P>
        Try the calm, cloudy day as well. With {pct(WEATHER.calm.wind)} of the usual wind and {pct(WEATHER.calm.solar)} of the sunshine, the same plan does far less,
        and the grid leans on the plants it had before. That is why a region can’t plan its capacity around an average day: the plants that run least often may be the
        ones it can least do without.
      </P>
      <P>
        {capture.length
          ? `There is a catch for the owners. Your new ${capture.map((c, i) => `${c.label} is paid an average of ${usd(c.price, 2)}${i === 0 ? ' per MWh' : ''}`).join(' and your new ')}, against a load-weighted average of ${usd(ma.avg, 2)}. `
          : ''}
        Wind and solar sell most when other wind and solar are selling too, which is when prices are lowest — and the more of one technology a region builds, the lower
        the price it captures. Battery owners face a related problem, as we’ll see below: they earn from price gaps, which they themselves close.
      </P>

      <H2>Where it goes matters</H2>
      <P>
        Emissions fall only when the new power displaces something that burns fuel, and the dirtiest plant on the starting grid, Ironwood coal, is also among the cheapest
        to run. On this day coal produces {mwh(mb.coal)} before your plan and {mwh(ma.coal)} after. Whether new wind displaces coal or merely gas, or gets turned away,
        depends on where it connects and what the lines around it can carry.
        {t.storageMW > 0 && ma.coal > mn.coal + 1
          ? ` Storage can even push the other way. Without its battery your plan would leave coal at ${mwh(mn.coal)}; the battery charges at night, when coal is the plant setting the price, and discharges in the evening, when gas is, so it trades gas-fired megawatt-hours for coal-fired ones.`
          : ''}
      </P>

      <Challenge
        id="a"
        question="Using the demonstration above, cut your grid’s emissions on the chosen day by at least half, without adding hours of congestion or leaving any demand unserved."
        solved={solved}
        status={`Emissions are ${pct(Math.max(0, cut))} lower than before (${fmt(ma.co2)} against ${fmt(mb.co2)} tonnes), with ${ma.congested} congested hours against ${mb.congested} before.`}
        success={`Solved: emissions down ${pct(cut)}, with ${ma.congested} congested hours against ${mb.congested}. New power connected where it competes directly with the coal plant displaces coal; the same megawatts behind a congested line mostly get turned away.`}
      />

      <H2>What the battery does</H2>
      <P>
        Each battery schedules itself with the dynamic program of Lesson 6.4, against the prices at its own node. But a big battery changes the very prices it plans
        against: charging raises them, discharging lowers them. So the engine adds it in {WORDS[STORAGE_SLICES] ?? STORAGE_SLICES} equal slices. Each slice optimizes against the prices left by
        the slices before it, the day is cleared again, and the battery keeps the slice only if it then earns more than it did without it. That is a simple stand-in for the
        many small, competing decisions of a real market, not an equilibrium. Here is your battery at {siteName(sNode)}:
      </P>

      <Figure name="Energy Transition Simulator · storage" actions={<ResetGridButton />}>
        {t.storageMW > 0 && batt ? (
          <>
            <Legend
              items={[
                { label: `Price at ${siteName(sNode)} before`, color: '#9a9a9a', kind: 'line', dashed: true },
                { label: 'After', color: '#3f7a1e', kind: 'line' },
              ]}
            />
            <TimeChart
              ariaLabel={`Price at ${siteName(sNode)} before and after the transition.`}
              series={[
                { values: pBefore.map((p) => Math.min(300, p)), color: '#9a9a9a', kind: 'step', dash: '6 4' },
                { values: pAfter.map((p) => Math.min(300, p)), color: '#3f7a1e', kind: 'step', width: 2.5 },
              ]}
              yLabel={`Price at ${siteName(sNode)}, $ per MWh`}
              yMin={Math.min(0, ...pAfter, ...pBefore)}
              yMax={Math.min(300, yTop * 1.1)}
              yFormat={(v) => '$' + fmt(v)}
            />
            <TimeChart
              ariaLabel={`Battery schedule at ${siteName(sNode)}: discharging up to ${fmt(used)} MW of ${fmt(t.storageMW)} MW.`}
              series={[{ values: batt.schedule, color: FUEL.battery, kind: 'bar', colors: batt.schedule.map((x) => (x >= 0 ? FUEL.battery : '#b9b9b9')) }]}
              yLabel="Battery, MW (discharging up, charging down)"
              yFormat={(v) => fmt(v)}
              height={180}
            />
            <Readouts
              items={[
                { label: 'earned over the day', value: usd(batt.revenue), tone: batt.revenue >= 0 ? 'green' : 'red' },
                { label: 'energy delivered', value: mwh(dischargedMWh), tone: 'gold' },
                { label: 'most power used', value: `${fmt(used)} of ${fmt(t.storageMW)} MW` },
              ]}
            />
            <Caption>
              {used < t.storageMW * 0.99
                ? `The battery uses only ${pct(t.storageMW > 0 ? used / t.storageMW : 0)} of its power: the remaining slices would have eroded the price gap they were trading on.`
                : 'The battery uses its full power: the price gaps at this node are wide enough for every slice.'}
            </Caption>
          </>
        ) : (
          <EmptyNote>Your plan has no battery. Add one with the storage controls above.</EmptyNote>
        )}
      </Figure>

      <P>
        A battery also pays for every round trip. Ours return {pct(BATTERY_EFFICIENCY)} of the energy they take in, so a megawatt-hour bought for $30 has to sell for
        at least {usd(30 / BATTERY_EFFICIENCY, 2)} just to break even, and a price gap narrower than {pct(1 / BATTERY_EFFICIENCY - 1)} isn’t worth trading at all. Look at
        the prices the battery leaves behind. Its charging lifts the cheapest hours and its discharging trims the dearest, so the gap between them — the only thing
        a battery earns from — narrows the more storage a node has. The first megawatts of storage at a node earn the most; each one after earns less. That makes{' '}
        <K c="energy">storage</K> at many small sites, each facing its own local prices, a natural complement to a few big batteries. The next lesson builds exactly that:
        thousands of home batteries, run together as one virtual power plant.
      </P>
    </LessonPage>
  );
}
