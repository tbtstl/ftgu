import { useMemo } from 'react';
import {
  Challenge,
  Checkbox,
  FUEL,
  Figure,
  H2,
  K,
  Legend,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  fmt,
  hour,
  lessonHref,
  mw,
  priceFill,
  usd,
  useScenario,
} from '../../framework';
import { runSitingDay, type SitedBattery, type SitingDay } from '../../engines/market/siting';
import type { OpfGenerator } from '../../engines/market/opf';
import { STANDARD_FLEET } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, nodeName } from '../../model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

const EFFICIENCY = 0.85;
const BUDGET = 150;
const TARGET_SAVINGS = 25000;
const OUTAGE = 'center-city';
const NODES = ['north', 'east', 'center', 'harbor', 'west', 'city'] as const;
type NodeId = (typeof NODES)[number];
const REFERENCE: NodeId = 'center';

function gens(h: number): OpfGenerator[] {
  return STANDARD_FLEET.map((g) => ({
    id: g.id,
    node: g.node!,
    offer: g.marginalCost,
    minOutput: g.minOutput,
    capacity: g.fuel === 'wind' ? g.capacity * WIND_CF[h] : g.fuel === 'solar' ? g.capacity * SOLAR_CF[h] : g.capacity,
  }));
}

const cache = new Map<string, SitingDay>();
/** A day on the region with these batteries; `lmp` 'all' for every node, or a list of nodes. */
function day(batteries: SitedBattery[], lineIn: boolean, lmp: 'all' | 'none' | string[]): SitingDay {
  const key = JSON.stringify([batteries.map((b) => [b.node, b.powerMW, b.durationH]), lineIn, lmp]);
  let d = cache.get(key);
  if (!d) {
    d = runSitingDay({
      net: REGION,
      gens,
      demand: SYSTEM_DEMAND,
      share: REGION_LOAD_SHARE,
      batteries: batteries.filter((b) => b.powerMW > 0),
      opf: { outages: lineIn ? [] : [OUTAGE], lmp: lmp !== 'none' },
      lmpNodes: Array.isArray(lmp) ? lmp : undefined,
    });
    if (cache.size > 200) cache.clear();
    cache.set(key, d);
  }
  return d;
}
const bat = (node: string, powerMW: number, durationH = 4): SitedBattery => ({ node, powerMW, durationH, efficiency: EFFICIENCY });

// Numbers quoted in the prose: 50 MW / 4 h, with the Central–Metro line out.
const BASE = day([], false, 'all');
const BASE_IN = day([], true, 'none');
const AT_CITY = day([bat('city', 50)], false, 'all');
const AT_CENTER = day([bat('center', 50)], false, ['center']);
const ALL_CITY = day([bat('city', BUDGET)], false, 'none');
const metroPeak = (d: SitingDay) => Math.max(...d.hours.map((x) => x.lmp.city ?? 0));
const REF = {
  baseCongested: BASE.congestedHours,
  baseInCongested: BASE_IN.congestedHours,
  extraCost: BASE.cost - BASE_IN.cost,
  metroPeak: metroPeak(BASE),
  centerAtPeak: BASE.hours[19].lmp.center,
  savingsCity: BASE.cost - AT_CITY.cost,
  savingsCenter: BASE.cost - AT_CENTER.cost,
  revenueCity: AT_CITY.revenue[0],
  revenueCenter: AT_CENTER.revenue[0],
  metroPeakWith: metroPeak(AT_CITY),
  congestedWith: AT_CITY.congestedHours,
  allCity: BASE.cost - ALL_CITY.cost,
  inService: BASE_IN.cost - day([bat('city', 50)], true, 'none').cost,
};

const LABEL_POS: Record<string, 'above' | 'below' | 'left' | 'right'> = { north: 'above', east: 'above', center: 'above', harbor: 'left', west: 'below', city: 'right' };

export default function Lesson() {
  const s = useScenario('siting', { node: 'city' as NodeId, power: 50, duration: 4, lineIn: false, at: 19 });
  const { node, power, duration, lineIn, at } = s.state;
  const h = Math.min(23, Math.max(0, at));

  const base = useMemo(() => day([], lineIn, 'all'), [lineIn]);
  const withBat = useMemo(() => day([bat(node, power, duration)], lineIn, 'all'), [node, power, duration, lineIn]);
  const atRef = useMemo(() => (node === REFERENCE ? withBat : day([bat(REFERENCE, power, duration)], lineIn, [REFERENCE])), [node, power, duration, lineIn, withBat]);
  const savings = base.cost - withBat.cost;
  const revenue = withBat.revenue[0] ?? 0;
  const refRevenue = atRef.revenue[0] ?? 0;
  const sched = withBat.battery[node] ?? Array<number>(24).fill(0);
  const hr = withBat.hours[h];
  const lmp = (n: string) => Math.round(hr.lmp[n] ?? 0);

  // Second figure: a fixed budget split between two sites.
  const s2 = useScenario('budget', { a: 'city' as NodeId, b: 'east' as NodeId, split: 150 });
  const aMW = s2.state.split;
  const bMW = BUDGET - aMW;
  const split = useMemo(() => {
    const d = day([bat(s2.state.a, aMW), bat(s2.state.b, bMW)], false, 'none');
    return { savings: BASE.cost - d.cost, congested: d.congestedHours };
  }, [s2.state.a, s2.state.b, aMW, bMW]);
  const solved = split.savings >= TARGET_SAVINGS;

  const nodeOptions = NODES.map((n) => ({ value: n, label: nodeName(REGION, n) }));

  return (
    <LessonPage id="7.4">
      <P>
        So far our home batteries have floated free of the network: we counted them, controlled them and priced them as if every megawatt-hour were worth the same
        everywhere. Chapter 5 showed that it isn’t. When a transmission line fills up, the price on its far side rises, and power that could be delivered there becomes
        more valuable. Batteries — in homes or in a substation yard — can be placed anywhere, so the question becomes: where on the grid does storage do the most good?
      </P>
      <P>
        We’ll use the course’s six-node region with its standard fleet and the reference day’s demand, spread across the nodes in their usual shares. On a normal day the
        region has room to spare: with every line in service, {REF.baseInCongested === 0 ? 'no line reaches its limit in any hour' : `lines reach their limits in only ${REF.baseInCongested} hours`}. So suppose the Central–Metro line — Metro’s biggest supply line,
        rated at 600 MW — is out of service for a season of rebuilding. Metro must now import over the smaller lines from West and East. In this scenario the network is
        congested in {REF.baseCongested} of the 24 hours, Metro’s price reaches ${fmt(REF.metroPeak)} per MWh in the evening while Central’s is ${fmt(REF.centerAtPeak)},
        and the system spends {usd(REF.extraCost)} more on generation over the day than with the line in service.
      </P>
      <P>
        Now add a battery. To keep the comparison about location rather than trading skill, each battery follows the same simple rule: it charges during the six
        lowest-demand hours of the night and discharges at full power during the highest-demand hours of the evening. In the power flow, its charging is extra load at
        its node and its discharge is negative load. Pick a node and a size, and drag across the chart to see any hour:
      </P>

      <Figure name="Battery Siting Optimizer" scenario={s}>
        <Segmented label="Battery location" value={node} onChange={(v) => s.set({ node: v })} options={nodeOptions} />
        <NetworkView
          ariaLabel={`The region at ${hour(h)} with a ${power} MW battery at ${nodeName(REGION, node)}. Prices: ${NODES.map((n) => `${nodeName(REGION, n)} $${lmp(n)}`).join(', ')}.`}
          width={600}
          height={400}
          nodes={REGION.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            r: 34,
            label: n.name,
            labelPos: LABEL_POS[n.id],
            labelColor: n.id === node ? '#3f7a1e' : undefined,
            value: '$' + lmp(n.id),
            sub: 'per MWh',
            fill: priceFill(lmp(n.id)),
          }))}
          lines={REGION.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: hr.flows[l.id] ?? 0,
            limit: l.limit,
            out: !lineIn && l.id === OUTAGE,
            labelDy: l.id === 'harbor-west' ? 14 : undefined,
          }))}
        >
          {power > 0 &&
            (() => {
              const n = REGION.nodes.find((x) => x.id === node)!;
              const mwNow = sched[h];
              const text = mwNow > 0.5 ? `discharging ${fmt(mwNow)} MW` : mwNow < -0.5 ? `charging ${fmt(-mwNow)} MW` : 'idle';
              const left = n.x > 300;
              return (
                <g>
                  <rect x={left ? n.x - 168 : n.x + 40} y={n.y + 18} width={128} height={38} rx={6} fill="#f1f6ea" stroke={FUEL.battery} strokeWidth={1.5} />
                  <text x={left ? n.x - 104 : n.x + 104} y={n.y + 34} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: '#3f7a1e' }}>
                    {power} MW battery
                  </text>
                  <text x={left ? n.x - 104 : n.x + 104} y={n.y + 49} textAnchor="middle" className="ax">
                    {text}
                  </text>
                </g>
              );
            })()}
        </NetworkView>
        <Legend
          items={[
            { label: 'Metro price, no battery', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Metro price, with the battery', color: '#e48850', kind: 'line' },
            ...(node !== 'city' ? [{ label: `${nodeName(REGION, node)} price, with the battery`, color: '#ab70b6', kind: 'line' as const }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`Hourly price at Metro with and without the battery. Peak ${fmt(metroPeak(base))} without, ${fmt(metroPeak(withBat))} with.`}
          yLabel="Price, $ per MWh"
          yMin={0}
          yMax={Math.max(120, Math.ceil(Math.max(metroPeak(base), metroPeak(withBat), ...withBat.hours.map((x) => x.lmp[node] ?? 0)) / 20) * 20)}
          yFormat={(v) => '$' + v}
          height={220}
          series={[
            { values: base.hours.map((x) => x.lmp.city ?? 0), color: '#9a9a9a', kind: 'step', width: 2, dash: '6 4' },
            ...(node !== 'city' ? [{ values: withBat.hours.map((x) => x.lmp[node] ?? 0), color: '#ab70b6', kind: 'step' as const, width: 2 }] : []),
            { values: withBat.hours.map((x) => x.lmp.city ?? 0), color: '#e48850', kind: 'step', width: 3 },
          ]}
          cursor={h}
          onScrub={(i) => s.set({ at: i })}
        />
        <TimeChart
          ariaLabel="The battery's schedule: charging overnight, discharging at the evening peak."
          yLabel="Battery, MW (up: discharging)"
          yFormat={(v) => String(v)}
          height={130}
          series={[{ values: sched, color: FUEL.battery, kind: 'bar' }]}
          cursor={h}
          onScrub={(i) => s.set({ at: i })}
        />
        <Readouts
          items={[
            { label: 'generation cost saved per day', value: usd(savings), tone: savings >= 0 ? 'green' : 'red' },
            { label: `battery’s revenue at ${nodeName(REGION, node)}`, value: usd(revenue), tone: 'green' },
            { label: `same battery at ${nodeName(REGION, REFERENCE)}`, value: usd(refRevenue) },
            { label: 'congested hours', value: `${base.congestedHours} → ${withBat.congestedHours}` },
          ]}
        />
        <Slider label="Battery power" tone="red" value={power} min={0} max={150} step={25} onChange={(v) => s.set({ power: v })} display={mw(power)} />
        <Segmented
          label="Battery duration"
          value={String(duration)}
          onChange={(v) => s.set({ duration: Number(v) })}
          options={[
            { value: '2', label: '2 hours' },
            { value: '4', label: '4 hours' },
          ]}
        />
        <Checkbox label="Central–Metro line in service" checked={lineIn} onChange={(v) => s.set({ lineIn: v })} />
      </Figure>

      <P>
        Start with the 50 MW, four-hour battery at Metro. In the evening it supplies Metro directly, so Metro needs 50 MW less over its congested lines, and each
        megawatt-hour it delivers displaces the most expensive power Metro would otherwise have to buy. Fifty megawatts isn’t enough to clear the evening congestion —
        Metro’s price stays at ${fmt(REF.metroPeakWith)} — but the system’s generation cost for the day falls by {usd(REF.savingsCity)}. The battery is paid the Metro
        price for what it delivers and pays it for what it charges, so it earns {usd(REF.revenueCity)}, most of the value it creates. It earns the{' '}
        <K c="price">nodal spread</K>: the difference between Metro’s cheap night-time price and its congested evening price.
      </P>
      <P>
        Now move the same battery to Central, on the other side of the constraint. There it can only do what any battery anywhere can do — shift energy from cheap hours
        to dear ones at the system price — and Central’s evening price never rises much, because Central is where the cheap power is. The system saves{' '}
        {usd(REF.savingsCenter)} and the battery earns {usd(REF.revenueCenter)}. The hardware is identical. Its value isn’t.
      </P>
      <P>
        Two side effects deserve a look. First, the count of congested hours goes up, from {REF.baseCongested} to {REF.congestedWith}: a battery at Metro charging at
        night adds load behind the same constraint, and in a few overnight hours that is enough to fill the lines — but at prices far lower than the evening congestion it
        relieves. Second, try other sizes. A bigger battery at Metro saves more, but each extra 25 MW is worth less than the last, and past about 75 MW the battery’s own
        revenue falls: it starts to flatten the very price spread it was earning. Finally, tick “Central–Metro line in service.” With the network unconstrained, every
        node has the same price, and the battery saves the system the same {usd(REF.inService)} a day wherever it sits.
      </P>

      <H2>Spending a fixed budget</H2>
      <P>
        Suppose a utility can install {BUDGET} MW of four-hour storage this year, at up to two sites, and wants the largest reduction in the system’s cost. Putting
        everything at Metro, the obvious choice, saves {usd(REF.allCity)} a day. Choose two sites and how to split the {BUDGET} MW between them:
      </P>

      <Figure name="Battery Siting Optimizer · a fixed budget" scenario={s2}>
        <Segmented label="First site" value={s2.state.a} onChange={(v) => s2.set({ a: v })} options={nodeOptions} />
        <Slider
          label={`At ${nodeName(REGION, s2.state.a)}`}
          tone="red"
          value={aMW}
          min={0}
          max={BUDGET}
          step={25}
          onChange={(v) => s2.set({ split: v })}
          display={`${mw(aMW)} · ${mw(bMW)} at ${nodeName(REGION, s2.state.b)}`}
        />
        <Segmented label="Second site" value={s2.state.b} onChange={(v) => s2.set({ b: v })} options={nodeOptions} />
        <svg className="diagram" viewBox="0 0 600 54" role="img" aria-label={`${aMW} MW at ${nodeName(REGION, s2.state.a)} and ${bMW} MW at ${nodeName(REGION, s2.state.b)}.`}>
          <rect x={20} y={10} width={(560 * aMW) / BUDGET} height={30} fill={FUEL.battery} opacity={0.85} />
          <rect x={20 + (560 * aMW) / BUDGET} y={10} width={(560 * bMW) / BUDGET} height={30} fill="#ab70b6" opacity={0.7} />
          {aMW > 0 && (
            <text x={20 + (280 * aMW) / BUDGET} y={30} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: '#fff' }}>
              {nodeName(REGION, s2.state.a)} {aMW}
            </text>
          )}
          {bMW > 0 && (
            <text x={20 + (560 * aMW) / BUDGET + (280 * bMW) / BUDGET} y={30} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: '#fff' }}>
              {nodeName(REGION, s2.state.b)} {bMW}
            </text>
          )}
        </svg>
        <Readouts
          items={[
            { label: 'generation cost saved per day', value: usd(split.savings), tone: split.savings >= TARGET_SAVINGS ? 'green' : 'ink' },
            { label: 'congested hours', value: `${REF.baseCongested} → ${split.congested}` },
          ]}
        />
      </Figure>

      <Challenge
        id="a"
        question={`Split ${BUDGET} MW of four-hour storage between two sites so that the system saves at least ${usd(TARGET_SAVINGS)} a day — within about 2% of the best any split can do.`}
        solved={solved}
        status={`This split saves ${usd(split.savings)} a day.`}
        success={`Solved: ${usd(split.savings)} a day. Most of the storage belongs behind the constraint, but once Metro’s evening congestion is mostly relieved, the last few tens of megawatts there are worth less than the same megawatts elsewhere.`}
      />

      <P>
        The best splits put most of the budget at Metro, or next door at East, which feeds Metro over its own line, and the rest somewhere else. That is the general
        pattern of storage siting: value is highest right behind a constraint, but it’s finite. The congestion is only so deep, and once the batteries have shaved it off,
        more batteries in the same place mostly compete with each other.
      </P>
      <P>
        This is exactly where distributed batteries have an edge over a single big plant. Home batteries in Metro already sit behind Metro’s constraint, spread through
        the city’s neighborhoods. Grid operators are starting to work out how to use them that way: ERCOT, for instance, has proposed a phase of its aggregated-DER pilot
        aimed specifically at dispatching aggregated storage by location to help relieve transmission congestion. Doing it with thousands of batteries, though, means
        scheduling thousands of batteries — which is the subject of the <a href={lessonHref('7.5')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}
