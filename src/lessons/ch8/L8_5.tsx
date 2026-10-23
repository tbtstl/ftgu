import { useDeferredValue, useMemo, useState } from 'react';
import { Caption, Challenge, DataTable, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Slider, TimeChart, Tn, fmt, hour, mw, pct, tint, usd } from '../../framework';
import { BATTERY_CAPEX, updateCapstone, useCapstone, type CapstoneDesign } from './capstone';
import { HOURS, argmax, listNames, runMarket, siteName, systemOf } from './system';
import { EmptyNote, GridMap, ResetGridButton } from './ui';
import { REGULATION_SHARE, VPP_OFFER, reserveRequirement, splitSweep, vppRevenue } from './vpp';

const ENERGY_COLOR = '#c99a1e';
const RESERVE_COLOR = '#2a9d90';
const REG_COLOR = '#7c6fd0';

/** The design with the services share zeroed, so the sweep only reruns when the fleet changes. */
function sweepKey(d: CapstoneDesign): string {
  return JSON.stringify({ ...d, vpp: { ...d.vpp, services: 0 }, investments: [] });
}

export default function Lesson() {
  const d = useCapstone();
  const deferred = useDeferredValue(d);
  const [picked, setPicked] = useState('city');
  const node = d.nodes.includes(picked) ? picked : (d.nodes[0] ?? '');
  const v = d.vpp;

  const r = useMemo(() => (d.nodes.length ? vppRevenue(d) : null), [d]);
  const key = sweepKey(deferred);
  const sweep = useMemo(() => (deferred.nodes.length ? splitSweep(deferred) : []), [key]);
  const grid = useMemo(() => {
    if (!deferred.nodes.length) return null;
    const before = runMarket(systemOf(deferred, 'transition'));
    const after = runMarket(systemOf(deferred, 'vpp'));
    return { before, after };
  }, [deferred]);

  const setMW = (n: string, mwv: number) => updateCapstone((x) => ({ ...x, vpp: { ...x.vpp, mw: { ...x.vpp.mw, [n]: mwv } } }));
  const setVpp = (patch: Partial<CapstoneDesign['vpp']>) => updateCapstone((x) => ({ ...x, vpp: { ...x.vpp, ...patch } }));

  if (!r || !grid) {
    return (
      <LessonPage id="8.5">
        <P>The VPP needs a grid to join, and yours has no substations. Build one in Lesson 8.1, or reset your grid to the starting design.</P>
        <Figure name="VPP Operator" actions={<ResetGridButton />}>
          <EmptyNote>Nothing to operate.</EmptyNote>
        </Figure>
        <Challenge id="a" question="Find the share of the VPP’s power to hold back for grid services that earns it the most." solved={false} status="Your grid has no substations yet." success="" />
      </LessonPage>
    );
  }

  const rev = r.revenue;
  const best = sweep.length ? sweep.reduce((a, b) => (b.total > a.total + 1e-9 ? b : a)) : { services: v.services, total: rev.total };
  const solved = r.totalMW > 0 && rev.total >= best.total * 0.99 - 0.5 && best.total > 0;
  const svc = r.services;
  const resReq = reserveRequirement(r.sys);
  const regMin = Math.min(...svc.map((h) => h.regulationReq));
  const regMax = Math.max(...svc.map((h) => h.regulationReq));
  const regSaturated = svc.filter((h) => r.heldMW >= h.regulationReq - 1e-9).length;
  const resAvg = svc.reduce((a, h) => a + h.reservePrice, 0) / Math.max(1, svc.length);
  const resMax = svc.reduce((a, h, i) => (h.reservePrice > a.p + 1e-9 ? { p: h.reservePrice, h: i } : a), { p: -Infinity, h: 0 });
  const sites = d.nodes.filter((n) => (v.mw[n] ?? 0) > 0);
  const maxMW = Math.max(1, ...d.nodes.map((n) => v.mw[n] ?? 0));
  const perKwYr = (x: number, mwv: number) => (mwv > 0 ? usd((x * 365) / (mwv * 1000)) : '—');
  const costPerKW = BATTERY_CAPEX.perKW + BATTERY_CAPEX.perKWh * v.hours;
  const kwYr = r.totalMW > 0 ? (rev.total * 365) / (r.totalMW * 1000) : 0;
  const payback = kwYr > 0 ? costPerKW / kwYr : Infinity;

  const hourly = HOURS.map((h) => {
    const e = r.energy.reduce((a, x) => a + x.schedule[h] * (r.base.hours[h].lmp[x.node] ?? 0), 0);
    return { e, res: svc[h].vppReserve * svc[h].reservePrice, reg: svc[h].vppRegulation * svc[h].regulationPrice };
  });
  const rows = [
    { k: 'Energy arbitrage', mwv: r.totalMW - r.heldMW, day: rev.energy, color: ENERGY_COLOR },
    { k: 'Reserve', mwv: svc.reduce((a, h) => a + h.vppReserve, 0) / 24, day: rev.reserve, color: RESERVE_COLOR },
    { k: 'Regulation', mwv: svc.reduce((a, h) => a + h.vppRegulation, 0) / 24, day: rev.regulation, color: REG_COLOR },
  ];

  // Figure 2: where the VPP relieves the grid most.
  const { before, after } = grid;
  const target = before.summary.peakPrice.node && d.nodes.includes(before.summary.peakPrice.node) ? before.summary.peakPrice.node : node;
  const nb = before.netLoads[target] ?? HOURS.map(() => 0);
  const na = after.netLoads[target] ?? HOURS.map(() => 0);
  const pb = before.hours.map((h) => h.lmp[target] ?? 0);
  const pa = after.hours.map((h) => h.lmp[target] ?? 0);
  // Relief where it matters: in the hour the node was dearest before the VPP.
  const hb = argmax(pb);
  const relief = nb[hb] - na[hb];
  const vppRuns = after.storage.filter((s) => s.kind === 'vpp');
  const realized = vppRuns.reduce((a, s) => a + s.revenue, 0);
  const vppEnergyMW = vppRuns.reduce((a, s) => a + Math.max(...s.schedule.map(Math.abs)), 0);

  return (
    <LessonPage id="8.5">
      <P>
        The battery of the last lesson stopped short of its full power: past a point, its own trades erased the price gaps it was trading on. Chapter 7 built an
        alternative. Thousands of small batteries in homes and businesses, each too small to matter alone, can be enrolled by an aggregator and dispatched together as one{' '}
        <b>virtual power plant</b>, or VPP. Spread across many substations, they face many local prices instead of one, and they can sell more than energy.
      </P>
      <P>
        Operating one is mostly software. The aggregator reads each battery’s state of charge over the internet, forecasts prices and its customers’ own needs, bids the
        fleet into the market as if it were one plant, and sends each battery its share of the dispatch, keeping a reserve for the owner’s backup power. In the United
        States, a 2020 order of the Federal Energy Regulatory Commission, Order 2222, requires the wholesale markets to let aggregations like this take part alongside
        power plants.
      </P>
      <P>
        Your VPP has {mw(r.totalMW)} of home batteries{sites.length ? ` at ${listNames(sites.map(siteName))}` : ''}, each able to run for {v.hours} hour
        {v.hours > 1 ? 's' : ''} at full power. Part of its power trades energy against the nodal prices of your grid from Lesson 8.4. The rest is held back and sold as{' '}
        <K tone="teal">reserve</K> and <K tone="violet">regulation</K> in the co-optimized services market of Lesson 4.6. Click a substation on the map to change its
        batteries:
      </P>

      <Figure name="VPP Operator" actions={<ResetGridButton />}>
        <GridMap
          d={d}
          ariaLabel={`Your VPP: ${fmt(r.totalMW)} MW of home batteries across ${sites.length} substations, earning ${usd(rev.total)} a day. Selected: ${siteName(node)}.`}
          nodeInfo={(n) => ({ value: fmt(v.mw[n] ?? 0), sub: 'MW', fill: (v.mw[n] ?? 0) > 0 ? tint('#6d9c37', 0.15 + 0.5 * ((v.mw[n] ?? 0) / maxMW)) : '#fff' })}
          lineLabel={() => ''}
          plants={[]}
          selectedNode={node}
          onNodeClick={setPicked}
        />
        <Slider label={`Home batteries at ${siteName(node)}`} tone="red" value={v.mw[node] ?? 0} min={0} max={300} step={10} onChange={(x) => setMW(node, x)} display={mw(v.mw[node] ?? 0)} />
        <Slider label="Hours of storage" tone="gold" value={v.hours} min={1} max={4} onChange={(x) => setVpp({ hours: x })} display={`${v.hours} h · ${fmt(r.totalMWh)} MWh in all`} />
        <Slider
          label="Held back for grid services"
          tone="teal"
          value={Math.round(v.services * 100)}
          min={0}
          max={100}
          step={5}
          onChange={(x) => setVpp({ services: x / 100 })}
          display={`${pct(v.services)} · ${mw(r.heldMW)}`}
        />
        <Legend
          items={[
            { label: 'Energy', color: ENERGY_COLOR },
            { label: 'Reserve', color: RESERVE_COLOR, kind: 'line' },
            { label: 'Regulation', color: REG_COLOR, kind: 'line' },
          ]}
        />
        <TimeChart
          ariaLabel={`The VPP’s revenue each hour by stream. ${usd(rev.total)} over the day.`}
          series={[
            { values: hourly.map((x) => x.e), color: ENERGY_COLOR, kind: 'bar' },
            { values: hourly.map((x) => x.res), color: RESERVE_COLOR, kind: 'step', width: 2.5 },
            { values: hourly.map((x) => x.reg), color: REG_COLOR, kind: 'step', width: 2.5 },
          ]}
          yLabel="VPP revenue, $ per hour"
          yFormat={(x) => '$' + fmt(x)}
        />
        <Readouts
          items={[
            { label: 'the fleet', value: `${fmt(r.totalMW)} MW · ${fmt(r.totalMWh)} MWh` },
            { label: 'energy arbitrage per day', value: usd(rev.energy), tone: 'gold' },
            { label: 'reserve and regulation per day', value: usd(rev.reserve + rev.regulation), tone: 'teal' },
            { label: 'total per day', value: usd(rev.total), tone: 'green' },
          ]}
        />
        <DataTable
          caption="Revenue by stream"
          rows={rows}
          rowKey={(x) => x.k}
          columns={[
            { label: 'Stream', cell: (x) => x.k },
            { label: 'Average MW', cell: (x) => mw(x.mwv) },
            { label: 'Per day', cell: (x) => usd(x.day) },
            { label: 'Per year', cell: (x) => usd(x.day * 365) },
            { label: 'Per kW-year of the fleet', cell: (x) => perKwYr(x.day, r.totalMW) },
          ]}
          footer={['All streams', mw(r.totalMW), usd(rev.total), usd(rev.total * 365), perKwYr(rev.total, r.totalMW)]}
        />
      </Figure>

      <P>
        Reserve is capacity standing ready to replace the largest plant if it trips — here {mw(resReq)}. Regulation follows the second-by-second wobble of demand, about{' '}
        {pct(REGULATION_SHARE)} of it, or {mw(regMin)} to {mw(regMax)} on your grid. Both are paid per megawatt per hour of readiness, whether or not they’re called on. The
        VPP offers its held-back power for ${VPP_OFFER.reserve} and ${VPP_OFFER.regulation} per MW-hour, close to nothing, since a charged battery costs little to keep ready.
        The plants it competes with have to hold back output they could have sold, so their prices include that opportunity cost.
      </P>
      <P>
        Regulation is usually the best-paid service per megawatt, but it’s a thin market.{' '}
        {regSaturated === 24
          ? 'In every hour your VPP offers more regulation than the grid needs, so it sets the price itself, at its own'
          : regSaturated > 0
            ? `In ${regSaturated} of the 24 hours your VPP offers more regulation than the grid needs, and in those hours it sets the price itself, at its own`
            : 'Offer more regulation than the grid needs and the VPP sets the price itself, at its own'}{' '}
        ${VPP_OFFER.regulation}. Reserve is a deeper market, though its price also slides as the VPP displaces the plants that would
        otherwise hold it. Energy arbitrage pays on the spread between your grid’s cheap and dear hours, which Lesson 8.4’s additions have already narrowed.
      </P>
      <P>
        On your grid the reserve price averages {usd(resAvg, 2)} per MW-hour over the day and reaches {usd(resMax.p, 2)} at {hour(resMax.h)}. It is highest when the
        plants are busiest making energy, because that is when holding a megawatt back costs them the most margin — the opportunity cost of Lesson 4.6, now set on your
        own grid. In those hours a battery that holds itself ready is competing for the same scarce headroom as the plants, and is paid as they are.
      </P>

      <Challenge
        id="a"
        question="Find the share of the VPP’s power to hold back for grid services that earns it the most, in steps of 5%."
        solved={solved}
        status={`Holding back ${pct(v.services)}, the VPP earns ${usd(rev.total)} a day.`}
        success={`Solved: holding back ${pct(v.services)} earns ${usd(rev.total)} a day, the most of any share. Hold back less and the VPP leaves services revenue on the table; hold back more and it floods the services market, pushing down the very prices it’s paid.`}
      />

      <P>
        {best.services === v.services
          ? `On your grid the best share is ${pct(best.services)}, earning ${usd(best.total)} a day. `
          : `Try the slider: the revenue curve isn’t smooth. `}
        Each service saturates at a different size. Regulation fills first, because the grid needs only {mw(regMax)} of it; reserve fills much later; and energy
        arbitrage shrinks steadily as more power is held back. Real aggregators solve this split continuously, hour by hour, with forecasts of each price — the fleet
        optimization of Lesson 7.5 — rather than fixing it for the day as we do here.
      </P>
      <P>
        Your fleet earns {perKwYr(rev.total, r.totalMW)} per kilowatt of battery per year. Bought for that alone, a {v.hours}-hour battery at the costs of Lesson 8.1 —{' '}
        {usd(costPerKW)} per kilowatt — would take {payback > 0 && Number.isFinite(payback) ? `${fmt(payback)} years` : 'forever'} to pay for itself. That’s why VPPs mostly
        enroll batteries their owners bought for other reasons, such as backup power or storing rooftop solar: the market revenue is a bonus, shared between the owner and
        the aggregator.
      </P>

      <H2>What the grid gets</H2>
      <P>
        The revenue in <FigRef to="VPP Operator">the first demonstration</FigRef> treats the VPP as too small to move energy prices. To check that, we put its energy share into the market engine as {sites.length} batteries,
        one per substation, scheduled in slices as in Lesson 8.4, and clear the day again. Here is {siteName(target)}, the node with the highest price on your grid’s day
        before the VPP:
      </P>

      <Figure name="VPP Operator · grid effect" actions={<ResetGridButton />}>
        <Legend
          items={[
            { label: 'Before the VPP', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'With the VPP', color: '#333', kind: 'line' },
          ]}
        />
        <TimeChart
          ariaLabel={`Demand the market serves at ${siteName(target)} before and with the VPP. At ${hour(hb)}, the dearest hour, ${fmt(nb[hb])} MW before and ${fmt(na[hb])} MW with it.`}
          series={[
            { values: nb, color: '#9a9a9a', dash: '6 4' },
            { values: na, color: '#333', width: 2.5 },
          ]}
          yLabel={`Net demand at ${siteName(target)}, MW`}
          yFormat={(x) => fmt(x)}
          cursor={hb}
        />
        <TimeChart
          ariaLabel={`Price at ${siteName(target)} before and with the VPP.`}
          cursor={hb}
          series={[
            { values: pb.map((p) => Math.min(300, p)), color: '#9a9a9a', kind: 'step', dash: '6 4' },
            { values: pa.map((p) => Math.min(300, p)), color: '#3f7a1e', kind: 'step', width: 2.5 },
          ]}
          yLabel={`Price at ${siteName(target)}, $ per MWh`}
          yFormat={(x) => '$' + fmt(x)}
          height={200}
        />
        <Readouts
          items={[
            { label: `relief at ${siteName(target)}, ${hour(hb)}`, value: mw(relief), tone: relief > 0.5 ? 'green' : undefined },
            { label: 'highest price there', value: `${usd(Math.max(...pb))} → ${usd(Math.max(...pa))}`, tone: 'green' },
            { label: 'congestion rent per day', value: `${usd(before.summary.congestionRent)} → ${usd(after.summary.congestionRent)}` },
            { label: 'energy earned in the market', value: usd(realized), tone: realized >= 0 ? 'green' : 'red' },
          ]}
        />
        <Caption>
          {vppRuns.length
            ? `In the full market the VPP’s energy share earns ${usd(realized)} a day, against ${usd(rev.energy)} if it could trade without moving prices, and uses at most ${mw(vppEnergyMW)} across its sites.`
            : 'With everything held back for services, the VPP doesn’t trade energy at all.'}
        </Caption>
      </Figure>

      <P>
        {relief > 0.5
          ? `At ${hour(hb)}, ${siteName(target)}’s dearest hour, the VPP takes ${mw(relief)} off the demand the market has to deliver there. `
          : `At ${hour(hb)}, ${siteName(target)}’s dearest hour, the VPP barely changes the demand the market has to deliver there. `}
        Relief inside a constrained node can be worth more than the energy itself: every megawatt the VPP supplies inside the load pocket is a megawatt that doesn’t have to cross the
        constrained lines, which is why some utilities pay VPPs to defer substation and line upgrades. And the gap between{' '}
        <Tn tone="green">{usd(realized)}</Tn> earned in the full market and {usd(rev.energy)} on paper is the same lesson as the big battery’s: the more storage chases one
        price spread, the less of it there is.
      </P>
      <P>
        You now have a grid that has been designed, given a day, priced, given renewables and storage, and joined by a fleet of home batteries. The last lesson asks the question an owner
        would ask of it: years from now, with more demand and fewer old plants, what should you build, and will it pay?
      </P>
    </LessonPage>
  );
}
