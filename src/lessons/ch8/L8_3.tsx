import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FUEL,
  Figure,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  SupplyStackChart,
  Swatch,
  TimeChart,
  Tn,
  fmt,
  hour,
  mw,
  mwh,
  pct,
  priceFill,
  usd,
  useScenario,
  type StackBlock,
} from '../../framework';
import { clearMeritOrder } from '../../engines/market/clearing';
import { useCapstone } from './capstone';
import { argmax, lineName, listNames, outputByFuel, runMarket, siteName, systemOf } from './system';
import { EmptyNote, FUEL_NAME, FUEL_ORDER, GridMap, NODE_COLOR, ResetGridButton } from './ui';

export default function Lesson() {
  const d = useCapstone();
  const run = useMemo(() => (d.nodes.length ? runMarket(systemOf(d, 'base')) : null), [d]);
  // Start at the quietest hour, so the reader goes looking for the congestion.
  const quiet = run ? run.hours.reduce((a, x) => (x.congestionRent < run.hours[a].congestionRent - 0.5 ? x.hour : a), 0) : 0;
  const s = useScenario('market', { hour: quiet });
  const h = Math.max(0, Math.min(23, s.state.hour));
  // The real cost of the network in each hour: nodal production cost minus the single-zone market's.
  const extra = useMemo(
    () =>
      run
        ? run.hours.map((x, i) => {
            const offers = run.units.map((u) => ({ id: u.id, mw: Math.max(0, Math.min(u.capacity, u.available?.[i] ?? u.capacity)), price: u.offer }));
            const served = Object.keys(x.netLoad).reduce((a, n) => a + (x.netLoad[n] ?? 0) - (x.shed[n] ?? 0), 0);
            const z = clearMeritOrder(offers, served);
            return offers.reduce((a, o) => a + ((x.dispatch[o.id] ?? 0) - z.dispatch[o.id]) * o.price, 0);
          })
        : [],
    [run],
  );

  if (!run) {
    return (
      <LessonPage id="8.3">
        <P>The market engine needs a grid to run on, and yours has no substations. Build one in Lesson 8.1, or reset your grid to the starting design.</P>
        <Figure name="Electricity Market Engine" actions={<ResetGridButton />}>
          <EmptyNote>Nothing to clear.</EmptyNote>
        </Figure>
        <Challenge id="a" question="Find the hour of the day when congestion rent is highest." solved={false} status="Your grid has no substations yet." success="" />
      </LessonPage>
    );
  }

  const sum = run.summary;
  const hr = run.hours[h];
  const nodes = d.nodes;
  const lmp = (n: string, x = hr) => x.lmp[n] ?? 0;
  const prices = nodes.map((n) => lmp(n));
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const cheapNode = nodes[prices.indexOf(pMin)];
  const dearNode = nodes[prices.indexOf(pMax)];
  const shed = Object.values(hr.shed).reduce((a, b) => a + b, 0);
  const rents = run.hours.map((x) => x.congestionRent);
  const maxRent = Math.max(...rents);
  const rentHour = argmax(rents);
  const byFuel = outputByFuel(run);
  const fuels = FUEL_ORDER.filter((f) => byFuel[f]);
  const monitored = hr.bindingContingencies[0];

  // Hours where prices separate though no line is at its limit: a contingency is doing it.
  const hidden = run.hours.filter((x) => {
    const ps = nodes.map((n) => x.lmp[n] ?? 0);
    return Math.max(...ps) - Math.min(...ps) > 1 && x.binding.length === 0 && x.bindingContingencies.length > 0;
  });

  let explain: string;
  if (shed > 0.5) explain = `At ${hour(h)} the grid can’t serve everyone: ${mw(shed)} is shed, and the price where it’s shed rises to the value of lost load.`;
  else if (pMax - pMin < 0.5) explain = `At ${hour(h)} nothing on the grid is congested, so every node pays the same ${usd(pMax)} per MWh.`;
  else {
    const parts: string[] = [];
    if (hr.binding.length) parts.push(`${listNames(hr.binding.map(lineName))} ${hr.binding.length > 1 ? 'are' : 'is'} at its rating`);
    if (monitored) parts.push(`${lineName(monitored.line)} would be at its rating if ${lineName(monitored.outage)} tripped`);
    explain = `At ${hour(h)} prices run from ${usd(pMin)} at ${siteName(cheapNode)} to ${usd(pMax)} at ${siteName(dearNode)}, because ${parts.join(', and ')}.`;
  }

  // The single-zone market of Chapter 4 for the same hour, for comparison.
  const offers = run.units.map((u) => ({ id: u.id, mw: Math.max(0, Math.min(u.capacity, u.available?.[h] ?? u.capacity)), price: u.offer }));
  const servedMW = nodes.reduce((a, n) => a + (hr.netLoad[n] ?? 0) - (hr.shed[n] ?? 0), 0);
  const zone = clearMeritOrder(offers, servedMW);
  const zoneCost = offers.reduce((a, o) => a + zone.dispatch[o.id] * o.price, 0);
  const nodalCost = offers.reduce((a, o) => a + (hr.dispatch[o.id] ?? 0) * o.price, 0);
  const genById = Object.fromEntries(run.sys.gens.map((g) => [g.id, g]));
  const blocks: StackBlock[] = zone.stack.map((st) => {
    const g = genById[st.id];
    const q = hr.dispatch[st.id] ?? 0;
    const outOfMerit = Math.abs(q - zone.dispatch[st.id]) > 1;
    return {
      id: st.id,
      start: st.start,
      mw: st.end - st.start,
      price: st.price,
      dispatched: q,
      color: FUEL[g?.fuel ?? 'imports'] ?? '#999',
      label: outOfMerit ? `${usd(st.price)} ${q > zone.dispatch[st.id] ? '↑' : '↓'}` : undefined,
      highlight: outOfMerit,
    };
  });
  const xMax = Math.max(100, ...zone.stack.map((x) => x.end));
  const yMax = Math.max(100, Math.ceil((Math.max(...offers.map((o) => o.price)) * 1.1) / 20) * 20);

  const plants = run.sys.gens
    .map((g) => ({ g, s: sum.units[g.id] }))
    .filter((r) => r.s)
    .sort((a, b) => b.s.margin - a.s.margin);
  const top = plants[0];
  const maxExtra = Math.max(0, ...extra);
  const extraHour = argmax(extra);
  const nodeAvg = nodes.map((n) => ({ n, p: sum.nodePrice[n] ?? 0 })).sort((a, b) => b.p - a.p);
  const paid = plants.filter((r) => r.s.mwh > 1).map((r) => ({ r, p: r.s.revenue / r.s.mwh })).sort((a, b) => b.p - a.p);
  const nuc = plants.find((r) => r.g.fuel === 'nuclear');
  const nucShare = nuc ? (nuc.s.margin * 365) / (nuc.g.fixedCost * nuc.g.capacity) : 0;
  const solvedRent = h === rentHour || rents[h] >= maxRent - 0.5;

  return (
    <LessonPage id="8.3">
      <P>
        Your grid has its plants, its lines and a day of demand. What it doesn’t have yet is anyone deciding which plants run. In this lesson we connect the market
        engines of Chapters 4 and 5 to it, hour by hour, and watch prices form.
      </P>
      <P>
        Each hour, every plant offers its output at its marginal cost — the same offers as in Lesson 4.4 — except wind and solar, which offer slightly below zero: with no
        fuel to buy, and in the United States a production tax credit paid on every megawatt-hour, they would rather sell at a small loss than be turned down. The operator then
        solves the security-constrained dispatch of Lesson 5.6 on your network: the cheapest set of outputs that meets demand at every node, keeps every line within its
        rating, and would still do so after the loss of any one line. The price at each node is what one more megawatt there would cost, found as in Lesson 5.3 by solving
        the hour again with a little more demand at that node. That’s {fmt(24 * (nodes.length + 1))} optimizations or more for a day, and in your browser the whole day took{' '}
        {fmt(Math.max(1, run.ms))} milliseconds. Drag across the chart, or use the slider, to pick an hour:
      </P>

      <Figure name="Electricity Market Engine" scenario={s} actions={<ResetGridButton />}>
        <Legend items={[...fuels.map((f) => ({ label: FUEL_NAME[f], color: FUEL[f] })), { label: 'Demand', color: '#333', kind: 'line' as const }]} />
        <TimeChart
          ariaLabel={`Generation by fuel over the day on your grid, with demand. Selected hour ${hour(h)}: demand ${fmt(run.demand[h])} MW.`}
          stack={fuels.map((f) => ({ values: byFuel[f], color: FUEL[f] }))}
          series={[{ values: run.demand, color: '#333', width: 2 }]}
          yLabel="Generation, MW"
          yMin={0}
          yFormat={(v) => fmt(v)}
          cursor={h}
          onScrub={(i) => s.set({ hour: i })}
        />
        <Slider label="Hour" value={h} min={0} max={23} onChange={(v) => s.set({ hour: v })} display={hour(h)} />
        <GridMap
          d={d}
          ariaLabel={`Prices and flows at ${hour(h)}. ${explain}`}
          nodeInfo={(n) => ({ value: usd(lmp(n)), sub: 'per MWh', fill: priceFill(lmp(n)) })}
          flows={hr.flows}
          selectedLine={monitored?.line ?? hr.binding[0] ?? null}
        />
        <Readouts
          items={[
            { label: `demand at ${hour(h)}`, value: mw(run.demand[h]) },
            { label: 'nodal prices', value: pMax - pMin < 0.5 ? usd(pMax) : `${usd(pMin)}–${usd(pMax)}`, tone: 'green' },
            { label: 'congestion rent this hour', value: usd(hr.congestionRent), tone: 'green' },
            { label: 'demand shed', value: mw(shed), tone: shed > 0.5 ? 'red' : undefined },
          ]}
        />
        <Caption>
          {explain}
          {monitored || hr.binding.length ? ' The shaded line is the one limiting the dispatch.' : ''}
        </Caption>
      </Figure>

      <P>
        Across your day the load-weighted price averages <Tn tone="green">{usd(sum.averagePrice, 2)}</Tn> per MWh, and the highest price is {usd(sum.peakPrice.price)} at{' '}
        {siteName(sum.peakPrice.node)} at {hour(sum.peakPrice.hour)}. Prices separate in {sum.congestedHours} of the 24 hours.
        {hidden.length
          ? ` Look at ${hour(hidden[0].hour)}: no line on the map is at its rating, yet prices differ. The constraint doing it is one that hasn’t happened — if ${lineName(hidden[0].bindingContingencies[0].outage)} tripped, ${lineName(hidden[0].bindingContingencies[0].line)} would overload — so the dispatch holds flows back ahead of time. On real grids, much of the congestion is of this kind.`
          : ' On your grid every hour of separation comes from a line actually at its rating.'}
        {sum.insecureHours > 0
          ? ` In ${sum.insecureHours} hour${sum.insecureHours > 1 ? 's' : ''}, though, the grid couldn’t be kept N-1 secure without shedding load, so the dispatch ran on normal ratings alone: an operator would rather take that risk than black out customers in advance.`
          : ''}
      </P>

      <P>
        The engine makes the same simplifications as Chapter 5, and one more. Each hour is cleared on its own: no plant has to be started hours ahead, none is limited
        in how fast it can ramp from one hour to the next, as the plants of Chapter 3 were, and a start costs nothing. Real day-ahead markets clear all 24 hours together, deciding which
        units to commit as well as how much each produces, which is a far harder optimization than 24 separate ones. And our lines are lossless, so the only reason
        prices differ is congestion. Most US markets publish each nodal price in three parts: an energy part that is the same everywhere, a congestion part, and a part for
        losses. In our model the third part is always zero.
      </P>

      <H2>Out of merit order</H2>
      <P>
        The single-zone market of Chapter 4 would clear the same hour by stacking every offer from cheapest to dearest and stopping at demand. The network breaks that
        order. Here is the hour’s supply stack: solid blocks are what the nodal dispatch actually runs, and blocks marked with an arrow run more (↑) or less (↓) than the
        merit order alone would have them run:
      </P>

      <Figure name="Electricity Market Engine · bids" scenario={s}>
        <SupplyStackChart
          ariaLabel={`Supply stack at ${hour(h)}: ${blocks.length} offers. A single-zone market would clear at ${usd(zone.price)} per MWh; nodal prices run from ${usd(pMin)} to ${usd(pMax)}.`}
          blocks={blocks}
          demand={servedMW}
          price={zone.price}
          priceLabel={`single zone ${usd(zone.price)}`}
          xMax={xMax}
          yMax={yMax}
        />
        <Slider label="Hour" value={h} min={0} max={23} onChange={(v) => s.set({ hour: v })} display={hour(h)} />
        <Readouts
          items={[
            { label: 'single-zone price', value: usd(zone.price), tone: 'green' },
            { label: 'nodal prices', value: pMax - pMin < 0.5 ? usd(pMax) : `${usd(pMin)}–${usd(pMax)}`, tone: 'green' },
            { label: 'extra cost of the network this hour', value: usd(Math.max(0, nodalCost - zoneCost)) },
          ]}
        />
      </Figure>

      <P>
        When the network binds, cheap plants on the wrong side of a constraint are turned down and dearer plants on the right side are turned up. The difference in cost
        is the real cost of the congestion: it’s what the region pays for not having the wires.
        {maxExtra > 0.5 ? ` On your grid it is largest at ${hour(extraHour)}, when it comes to ${usd(maxExtra)} for the hour.` : ' On your grid it is zero all day.'} Nodal
        prices tell every plant and customer about it. A cheap plant behind a constraint sees a low price and runs less; a customer in a load pocket sees a high one.
        {nodeAvg.length > 1 && nodeAvg[0].p - nodeAvg[nodeAvg.length - 1].p > 0.5
          ? ` Over the day, customers at ${siteName(nodeAvg[0].n)} pay an average of ${usd(nodeAvg[0].p, 2)} per MWh and those at ${siteName(nodeAvg[nodeAvg.length - 1].n)} ${usd(nodeAvg[nodeAvg.length - 1].p, 2)}: the same electricity, ${pct(nodeAvg[0].p / Math.max(0.01, nodeAvg[nodeAvg.length - 1].p) - 1)} dearer for being on the wrong side of the wires.`
          : ''}
      </P>

      <H2>Who earns what</H2>
      <P>Here are the prices at every node across the day, and what each plant earns by selling at its own node’s price:</P>

      <Figure name="Electricity Market Engine · prices and profits" scenario={s}>
        <Legend items={nodes.map((n) => ({ label: siteName(n), color: NODE_COLOR[n] ?? '#999', kind: 'line' as const }))} />
        <TimeChart
          ariaLabel={`Hourly price at each of ${nodes.length} nodes. At ${hour(h)} they run from ${usd(pMin)} to ${usd(pMax)} per MWh.`}
          series={nodes.map((n) => ({ values: run.hours.map((x) => Math.min(300, x.lmp[n] ?? 0)), color: NODE_COLOR[n] ?? '#999', kind: 'step' as const, width: n === dearNode ? 3 : 2 }))}
          yLabel="Nodal price, $ per MWh"
          yFormat={(v) => '$' + fmt(v)}
          cursor={h}
          onScrub={(i) => s.set({ hour: i })}
        />
        {run.hours.some((x) => nodes.some((n) => (x.lmp[n] ?? 0) > 300)) && <Caption>Prices above $300 are drawn at $300.</Caption>}
        <Readouts
          items={[
            { label: 'paid by customers', value: usd(sum.loadPayments), tone: 'green' },
            { label: 'cost of production', value: usd(sum.productionCost) },
            { label: 'congestion rent', value: usd(sum.congestionRent), tone: 'green' },
            { label: 'unserved energy', value: mwh(sum.unservedMWh), tone: sum.unservedMWh > 0.5 ? 'red' : undefined },
          ]}
        />
        <DataTable
          caption="What each plant earned over the day"
          rows={plants}
          rowKey={(r) => r.g.id}
          rowClass={(r) => (r.s.mwh < 0.5 ? 'dim' : '')}
          columns={[
            {
              label: 'Plant',
              cell: (r) => (
                <>
                  <Swatch color={FUEL[r.g.fuel]} />
                  {r.g.name}
                </>
              ),
            },
            { label: 'Node', cell: (r) => siteName(r.g.node ?? '') },
            { label: 'Energy', cell: (r) => mwh(r.s.mwh) },
            { label: 'Avg. price', cell: (r) => (r.s.mwh > 0.5 ? usd(r.s.revenue / r.s.mwh) : '—') },
            { label: 'Margin', cell: (r) => usd(r.s.margin) },
          ]}
          footer={['All plants', '', mwh(plants.reduce((a, r) => a + r.s.mwh, 0)), '', usd(plants.reduce((a, r) => a + r.s.margin, 0))]}
        />
      </Figure>

      <Challenge
        id="a"
        question="Using the hour slider or by dragging across a chart, find the hour of the day when your grid collects the most congestion rent."
        solved={solvedRent}
        status={`At ${hour(h)} the congestion rent is ${usd(rents[h])} for the hour.`}
        success={
          maxRent > 0.5
            ? `Solved. At ${hour(rentHour)} customers pay ${usd(maxRent)} more than generators receive — the most of any hour — because the price gap across the binding constraint is widest then.`
            : 'Solved. Your grid has no congestion at all today, so every hour ties at $0.'
        }
      />

      <P>
        Customers pay {usd(sum.loadPayments)} over the day and plants receive {usd(sum.loadPayments - sum.congestionRent)}; the difference, {usd(sum.congestionRent)}, is
        the <K c="price">congestion rent</K> of Lesson 5.4, which the operator hands back to the holders of transmission rights. Rent is a transfer, not a cost: the
        real cost of congestion is the dearer generation it forces, which over your day comes to {usd(extra.reduce((a, x) => a + Math.max(0, x), 0))}
        {maxRent > 0.5 ? `, and at ${hour(rentHour)} the hour’s ${usd(maxRent)} of rent sits on top of only ${usd(Math.max(0, extra[rentHour] ?? 0))} of extra cost` : ''}.
        A line upgrade’s value to the region is the cost it saves, not the rent it erases.
      </P>
      <P>
        {top ? `${top.g.name} earns the largest margin, ${usd(top.s.margin)}.` : ''} A margin isn’t a profit, though: it has to pay for the plant itself.
        {nuc && nuc.g.capacity > 0
          ? ` At this day’s prices, ${nuc.g.name}’s margin would cover ${pct(nucShare)} of its annual fixed costs over a year. Energy prices alone often don’t pay for the plants a reliable grid needs — the “missing money” that the capacity markets of Lesson 4.6 exist to supply.`
          : ''}
      </P>
      <P>
        {paid.length > 1 && paid[0].p - paid[paid.length - 1].p > 1
          ? `Location shows up in the plants’ earnings too. ${paid[0].r.g.name} is paid an average of ${usd(paid[0].p, 2)} per MWh, against ${usd(paid[paid.length - 1].p, 2)} for ${paid[paid.length - 1].r.g.name}: a plant on the right side of a constraint is worth more than the same plant on the wrong side, which is exactly the signal that tells investors where to build. `
          : 'On your grid every plant is paid much the same price, because the network rarely binds. '}
        In Lesson 8.6 you’ll make those investment decisions yourself.
      </P>
      <P>
        Everything so far has been the grid as you built it, fueled mostly by gas, coal and uranium. In the next lesson we’ll add wind, solar and storage, and run this same
        engine to see what changes.
      </P>
    </LessonPage>
  );
}
