import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FUEL,
  Figure,
  GridY,
  H2,
  K,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  linePath,
  mw,
  niceTicks,
  priceFill,
  scale,
  signed,
  usd,
  useScenario,
} from '../../framework';
import { dcopf, type OpfResult } from '../../engines/market/opf';
import { fleetOffers, nodalLoads } from '../../engines/market/networkDispatch';
import { computePtdf } from '../../engines/physics/powerflow';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE } from '../../model/networks';
import { SYSTEM_DEMAND, SOLAR_CF, WIND_CF } from '../../model/profiles';

// The reference evening: the 19:00 peak, with every line in service.
const HOUR = 19;
const DEMAND = SYSTEM_DEMAND[HOUR];
const GENS = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[HOUR], solarCF: SOLAR_CF[HOUR] });
const LOADS = nodalLoads(DEMAND, REGION_LOAD_SHARE);
const LINE = 'center-city';
const RATED = REGION.lines.find((l) => l.id === LINE)!.limit;
const MIN_LIMIT = 220;
const BASE = dcopf(REGION, GENS, LOADS);
const BASE_FLOW = Math.abs(BASE.flows[LINE]);

// How much Central–Metro flow one megawatt of each swap removes.
const PTDF = computePtdf(REGION).ptdf[LINE];
const SWAP_MILL = 1 / (PTDF.center - PTDF.city);
const SWAP_EAST = 1 / (PTDF.center - PTDF.east);

const PLANTS = ['nuc', 'hydro', 'coal', 'cc1', 'cc2', 'ct', 'oil'];
const NODE_ORDER = ['north', 'east', 'center', 'harbor', 'west', 'city'] as const;
type NodeId = (typeof NODE_ORDER)[number];

function solve(limit: number, extra?: { node: string; mw: number }, lmp = true): OpfResult {
  const loads = extra ? { ...LOADS, [extra.node]: (LOADS[extra.node] ?? 0) + extra.mw } : LOADS;
  return dcopf(REGION, GENS, loads, { limits: { [LINE]: limit }, lmp });
}

const SHORT: Record<string, string> = {
  nuc: 'Harbor Point',
  coal: 'Ironwood',
  cc1: 'Lakeside',
  cc2: 'Mill Creek',
  ct: 'Eastgate',
  oil: 'Old Quay',
  hydro: 'Falls hydro',
  wind: 'Ridge wind',
  solar: 'Valley solar',
};
const PLANT_TEXT: Record<string, { x: number; y: number; anchor: 'start' | 'middle' | 'end'; ids: string[] }> = {
  north: { x: 22, y: 116, anchor: 'start', ids: ['hydro', 'wind'] },
  east: { x: 492, y: 116, anchor: 'start', ids: ['ct'] },
  center: { x: 340, y: 160, anchor: 'start', ids: ['cc1'] },
  harbor: { x: 22, y: 304, anchor: 'start', ids: ['nuc'] },
  west: { x: 190, y: 346, anchor: 'end', ids: ['coal'] },
  city: { x: 510, y: 336, anchor: 'middle', ids: ['cc2', 'oil'] },
};
const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [34, -14],
  'north-east': [0, -10],
  'harbor-center': [-6, -10],
  'harbor-west': [40, -14],
  'west-center': [34, 4],
  'center-city': [10, -18],
  'east-city': [44, 0],
  'west-city': [10, 22],
};

function RegionMap({
  r,
  limit,
  nodeValue,
  plantText,
  ariaLabel,
  highlight,
}: {
  r: OpfResult;
  limit: number;
  nodeValue: (id: string) => { value: string; sub: string; fill: string };
  plantText: boolean;
  ariaLabel: string;
  highlight?: string;
}) {
  return (
    <NetworkView
      ariaLabel={ariaLabel}
      width={600}
      height={408}
      nodes={REGION.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        r: 30,
        label: n.name,
        labelPos: n.id === 'west' ? 'below' : n.id === 'city' ? 'right' : 'above',
        ...nodeValue(n.id),
      }))}
      lines={REGION.lines.map((l) => {
        const lim = l.id === LINE ? limit : l.limit;
        const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
        return {
          id: l.id,
          from: l.from,
          to: l.to,
          flow: r.flows[l.id] ?? 0,
          limit: lim,
          label: `${fmt(Math.abs(r.flows[l.id] ?? 0))} / ${fmt(lim)}`,
          labelDx: dx,
          labelDy: dy,
        };
      })}
    >
      {highlight &&
        (() => {
          const n = REGION.nodes.find((x) => x.id === highlight)!;
          return <circle cx={n.x} cy={n.y} r={35} fill="none" stroke="#3f7a1e" strokeWidth={2} strokeDasharray="5 4" />;
        })()}
      {plantText &&
        Object.values(PLANT_TEXT).map((t) =>
          t.ids.map((id, i) => (
            <text key={id} x={t.x} y={t.y + i * 16} textAnchor={t.anchor} style={{ fontSize: 12, fill: '#444' }}>
              <tspan style={{ fontWeight: 500 }}>{SHORT[id]}</tspan> {fmt(r.dispatch[id] ?? 0)} MW
            </text>
          )),
        )}
    </NetworkView>
  );
}

/** Horizontal bars from a center line: each plant's change in output. */
function ChangeBars({ deltas, maxAbs, digits, ariaLabel }: { deltas: Record<string, number>; maxAbs: number; digits: number; ariaLabel: string }) {
  const rows = PLANTS;
  const x = scale(-maxAbs, maxAbs, 170, 520);
  const h = 26;
  const top = 26;
  return (
    <svg className="chart" viewBox={`0 0 600 ${top + rows.length * h + 10}`} role="img" aria-label={ariaLabel}>
      <text className="ax ax-m" x={x(-maxAbs / 2)} y={14}>
        ← produces less
      </text>
      <text className="ax ax-m" x={x(maxAbs / 2)} y={14}>
        produces more →
      </text>
      <line className="base" x1={x(0)} x2={x(0)} y1={top - 4} y2={top + rows.length * h} />
      {rows.map((id, i) => {
        const d = deltas[id] ?? 0;
        const y = top + i * h;
        const g = fleetById(id);
        const show = Math.abs(d) >= 0.5 * 10 ** -digits;
        const w = Math.max(0, Math.min(Math.abs(d), maxAbs));
        return (
          <g key={id}>
            <text x={160} y={y + 17} textAnchor="end" style={{ fontSize: 13, fill: '#444' }}>
              {SHORT[id]} · ${g.marginalCost}
            </text>
            <rect x={d >= 0 ? x(0) : x(-w)} y={y + 5} width={Math.abs(x(w) - x(0))} height={16} fill={FUEL[g.fuel]} rx={2} />
            {show &&
              (() => {
                // Put the number outside the bar's end, or just inside it when it would run into the names.
                const inside = d < 0 && x(-w) - 70 < 170;
                const tx = d >= 0 ? x(w) + 6 : inside ? x(-w) + 6 : x(-w) - 6;
                return (
                  <text x={tx} y={y + 17} textAnchor={d >= 0 || inside ? 'start' : 'end'} style={{ fontSize: 12, fill: '#333', fontWeight: 500 }}>
                    {signed(d, digits)} MW
                  </text>
                );
              })()}
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('congestion', { limit: RATED, node: 'city' as NodeId });
  const { limit, node } = s.state;
  const r = solve(limit);
  const congestion = r.cost - BASE.cost;
  const deltas = Object.fromEntries(PLANTS.map((id) => [id, (r.dispatch[id] ?? 0) - (BASE.dispatch[id] ?? 0)]));
  const moved = PLANTS.reduce((t, id) => t + Math.max(0, deltas[id]), 0);
  const binding = r.binding.includes(LINE);

  // Cost of congestion as the limit falls from its rating.
  const sweep = useMemo(() => {
    const ls: number[] = [];
    for (let l = MIN_LIMIT; l <= RATED; l += 5) ls.push(l);
    const res = ls.map((l) => solve(l, undefined, false));
    return { ls, cost: res.map((x) => x.cost - BASE.cost), mill: res.map((x) => x.dispatch.cc2) };
  }, []);
  const threshold = 1000;
  const answer = Math.min(...sweep.ls.filter((_, i) => sweep.cost[i] <= threshold));
  const below = sweep.ls.filter((l) => l < answer).pop();
  const costAt = (l: number) => sweep.cost[sweep.ls.indexOf(l)];
  const millFullAt = sweep.ls.filter((_, i) => sweep.mill[i] >= 250 - 1e-6).pop() ?? MIN_LIMIT;
  const slope1 = (costAt(300) - costAt(400)) / 100;
  const slope2 = (costAt(220) - costAt(280)) / 60;
  const solved = limit === answer;

  const X = scale(MIN_LIMIT, RATED, 70, 580);
  const yMax = Math.max(...sweep.cost) * 1.08;
  const Y = scale(0, yMax, 230, 36);
  const yTicks = niceTicks(0, yMax, 4).filter((v) => v <= yMax);

  // One more megawatt at the chosen node.
  const bumped = solve(limit, { node, mw: 1 }, false);
  const perMW = Object.fromEntries(PLANTS.map((id) => [id, (bumped.dispatch[id] ?? 0) - (r.dispatch[id] ?? 0)]));
  const marginal = bumped.cost - r.cost;
  const nodeName = (id: string) => REGION.nodes.find((n) => n.id === id)!.name;
  const mc = (id: string) => r.lmp[id] ?? 0;
  const spread = Math.max(...NODE_ORDER.map(mc)) - Math.min(...NODE_ORDER.map(mc));

  return (
    <LessonPage id="5.2">
      <P>
        In the previous lesson, a line out for maintenance cost our region a few hundred dollars an hour: the cheapest dispatch the wires could carry was a little more
        expensive than the merit order. That extra cost has a name — the cost of congestion — and it depends on how tight the bottleneck is.
      </P>
      <P>
        A line’s limit isn’t a fixed property of the wire. A conductor sags as it heats up, and how fast it heats depends on the air temperature and the wind, so the same
        line can carry less on a still, hot afternoon than on a cold, breezy night. Equipment at either end, maintenance work and the operator’s security margins can all
        lower it further. Here is the reference evening — {mw(DEMAND)} at 19:00, Ridge wind producing a more typical {mw(GENS.find((g) => g.id === 'wind')!.capacity)},
        every line in service. Line Central–Metro is the main route into Metro, rated for {mw(RATED)}. Drag its limit down and watch the optimizer respond:
      </P>

      <Figure name="Congestion Simulator" scenario={s}>
        <RegionMap
          r={r}
          limit={limit}
          plantText
          nodeValue={(id) => ({ value: fmt(LOADS[id] ?? 0), sub: 'MW load', fill: '#fff' })}
          ariaLabel={`The region with Central–Metro limited to ${limit} MW. It carries ${fmt(Math.abs(r.flows[LINE]))} MW. The cost of congestion is ${usd(congestion)} an hour.`}
        />
        <Slider label="Limit on line Central–Metro" tone="red" value={limit} min={MIN_LIMIT} max={RATED} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
        <Readouts
          items={[
            { label: 'generation cost per hour', value: usd(r.cost) },
            { label: 'cost of congestion per hour', value: usd(congestion), tone: congestion > 0.5 ? 'red' : undefined },
            { label: 'redispatched', value: mw(moved) },
          ]}
        />
        <ChangeBars
          deltas={deltas}
          maxAbs={400}
          digits={0}
          ariaLabel={`Change in each plant’s output compared with the dispatch without the limit: ${PLANTS.filter((id) => Math.abs(deltas[id]) > 0.5)
            .map((id) => `${SHORT[id]} ${signed(deltas[id])} MW`)
            .join(', ') || 'no changes'}.`}
        />
        <Caption>
          {binding
            ? `Central–Metro is full. Compared with the unconstrained dispatch, ${PLANTS.filter((id) => deltas[id] > 0.5)
                .map((id) => SHORT[id])
                .join(' and ')} produce more and ${PLANTS.filter((id) => deltas[id] < -0.5)
                .map((id) => SHORT[id])
                .join(' and ')} less.`
            : `Central–Metro carries ${fmt(BASE_FLOW)} MW at the cheapest dispatch, so a limit of ${mw(limit)} doesn’t bind and nothing changes.`}
        </Caption>
      </Figure>

      <P>
        At the cheapest dispatch, Central–Metro carries {fmt(BASE_FLOW)} MW, so nothing happens until the limit drops below that. From then on, the optimizer has to keep
        the flow at the limit, and it does that by <b>redispatch</b>: running a plant on the Metro side of the bottleneck harder, and a plant on the far side less, so that
        total generation stays the same. The bars show each plant’s change from the unconstrained dispatch.
      </P>
      <P>
        The first plant to move is Lakeside, which sits at Central, right at the head of the line. Mill Creek, in Metro, takes over its output. Both burn gas, and Mill
        Creek costs only $6 more per megawatt-hour, so this first relief is cheap. It takes more redispatch than you might expect, though. Even before the swap, part of
        Lakeside’s output reached Metro by other routes, through West or round by North and East, so moving one megawatt from Lakeside to Mill Creek takes only{' '}
        {fmt(1 / SWAP_MILL, 2)} MW off Central–Metro. Every megawatt of relief needs {fmt(SWAP_MILL, 2)} MW of redispatch.
      </P>

      <H2>The cost of congestion</H2>
      <P>
        The <K c="price">cost of congestion</K> is the cost of the cheapest dispatch with the limit, minus the cost of the cheapest dispatch without it. The next chart
        repeats the optimization for every limit from {mw(RATED)} down to {mw(MIN_LIMIT)}:
      </P>

      <Figure name="Congestion Simulator · cost of congestion" scenario={s}>
        <svg
          className="chart"
          viewBox="0 0 600 270"
          role="img"
          aria-label={`Cost of congestion against the limit on Central–Metro. At ${limit} MW it is ${usd(congestion)} an hour.`}
        >
          <text className="ax" x={70} y={20}>
            Cost of congestion, $ per hour
          </text>
          <GridY y={Y} ticks={yTicks} x0={70} x1={580} format={(v) => '$' + fmt(v)} baseline={0} />
          {[250, 300, 350, 400, 450, 500, 550, 600].map((l) => (
            <text key={l} className="ax ax-m" x={X(l)} y={248}>
              {l}
            </text>
          ))}
          <text className="ax ax-e" x={580} y={266}>
            Limit on Central–Metro, MW
          </text>
          <rect x={X(MIN_LIMIT)} y={36} width={X(millFullAt + 5) - X(MIN_LIMIT)} height={194} fill="#e75b55" opacity={0.07} />
          <text x={X(262)} y={Y(yMax * 0.86)} style={{ fontSize: 12, fill: '#c4382f', fontWeight: 500 }}>
            Mill Creek full;
          </text>
          <text x={X(262)} y={Y(yMax * 0.86) + 16} style={{ fontSize: 12, fill: '#c4382f', fontWeight: 500 }}>
            Eastgate takes over
          </text>
          <text x={X(360)} y={Y(costAt(360)) - 14} textAnchor="middle" style={{ fontSize: 12, fill: '#ad5310', fontWeight: 500 }}>
            Mill Creek replaces Lakeside
          </text>
          <text x={X(520)} y={Y(0) - 10} textAnchor="middle" className="ax">
            line not full: no cost
          </text>
          <path d={linePath(sweep.ls.map(X), sweep.cost.map(Y))} fill="none" stroke="#c4382f" strokeWidth={3} strokeLinejoin="round" />
          <line className="cur" x1={X(limit)} x2={X(limit)} y1={36} y2={230} />
          <circle cx={X(limit)} cy={Y(congestion)} r={6} fill="#c4382f" stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Slider label="Limit on line Central–Metro" tone="red" value={limit} min={MIN_LIMIT} max={RATED} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
        <Readouts items={[{ label: 'cost of congestion per hour', value: usd(congestion), tone: 'red' }]} />
      </Figure>

      <P>
        The curve has two straight pieces. While Mill Creek is replacing Lakeside, each megawatt of lost capacity costs {fmt(SWAP_MILL, 2)} MW × $6 ={' '}
        {usd(slope1, 2)} an hour. Below about {mw(millFullAt + 5)}, Mill Creek is running flat out, and the next-cheapest relief is the Eastgate peaker at $88. That’s
        not only more expensive, it’s also less effective: some of Eastgate’s output takes the long way to Metro, through North and Central, and onto the very line
        we’re trying to relieve. Each megawatt of relief now takes {fmt(SWAP_EAST, 2)} MW of redispatch at $52 more apiece, about {usd(slope2)} an hour. The kink is
        where the cheap fix runs out.
      </P>

      <Challenge
        id="a"
        question={`A maintenance crew needs to work on Central–Metro, and the operator will allow at most ${usd(threshold)} an hour of congestion cost. What is the lowest limit the line can be set to?`}
        solved={solved}
        status={`At ${mw(limit)}, congestion costs ${usd(congestion)} an hour.`}
        success={`Solved. At ${mw(answer)} congestion costs ${usd(costAt(answer))} an hour${below !== undefined ? `; at ${mw(below)} it would be ${usd(costAt(below))}` : ''}.`}
      />

      <P>
        Real systems pay this cost every day. Where the market price ignores the wires — as in Europe’s zonal markets, where a whole country or region shares one price —
        grid operators buy redispatch like this directly, after the market has cleared. In Germany alone, it costs billions of euros a year.
      </P>

      <H2>One more megawatt</H2>
      <P>
        The cost of congestion is a total. For a market, the more useful number is a marginal one: if demand at one substation rose by a single megawatt, how much more
        would the cheapest dispatch cost? Without congestion, it’s the same everywhere. Pick a place, and set the limit low enough that Central–Metro is full:
      </P>

      <Figure name="Congestion Simulator · one more megawatt" scenario={s}>
        <Segmented
          label="Where to add one megawatt of demand"
          value={node}
          onChange={(v) => s.set({ node: v })}
          options={NODE_ORDER.map((id) => ({ value: id, label: nodeName(id) }))}
        />
        <RegionMap
          r={r}
          limit={limit}
          plantText={false}
          highlight={node}
          nodeValue={(id) => ({ value: usd(mc(id)), sub: 'per MWh', fill: priceFill(mc(id)) })}
          ariaLabel={`Cost of serving one more megawatt at each node: ${NODE_ORDER.map((id) => `${nodeName(id)} ${usd(mc(id))}`).join(', ')}.`}
        />
        <Slider label="Limit on line Central–Metro" tone="red" value={limit} min={MIN_LIMIT} max={RATED} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
        <Readouts
          items={[
            { label: `one more MWh in ${nodeName(node)} costs`, value: usd(marginal, 2), tone: 'green' },
            { label: 'gap between the cheapest and dearest place', value: usd(spread, 2) },
          ]}
        />
        <ChangeBars
          deltas={perMW}
          maxAbs={2}
          digits={2}
          ariaLabel={`To serve one more megawatt in ${nodeName(node)}: ${PLANTS.filter((id) => Math.abs(perMW[id]) > 0.005)
            .map((id) => `${SHORT[id]} ${signed(perMW[id], 2)} MW`)
            .join(', ')}.`}
        />
      </Figure>

      <P>
        With the line at its full rating, one more megawatt anywhere is met by Mill Creek, the cheapest plant with room to spare, for $42. Now lower the limit to 250 MW
        and choose Central. Lakeside produces the extra megawatt itself, for $36 — it’s consumed right where it’s made, so it never has to cross the full line. Choose
        Metro, and the answer is strange. The obvious fix, Mill Creek, is already flat out. Lakeside can’t simply produce more, because a share of anything it makes
        would try to squeeze through Central–Metro. The cheapest way to deliver one more megawatt to Metro is to raise Eastgate by about 1.45 MW and <i>lower</i>{' '}
        Lakeside by about 0.45 MW, which keeps the flow on Central–Metro exactly where it was. That costs about $112 — more than the offer of any plant that’s
        actually running.
      </P>
      <P>
        Every other substation lands somewhere in between, depending on how much of its extra megawatt would load the full line. So once a line is congested, the cost of
        serving one more megawatt is different at every place on the grid. So far these are only the operator’s costs. The <a href={lessonHref('5.3')}>next lesson</a>{' '}
        turns them into prices, on the smallest grid where the same thing happens.
      </P>
    </LessonPage>
  );
}
