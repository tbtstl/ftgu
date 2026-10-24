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
  P,
  Readouts,
  Segmented,
  Slider,
  Swatch,
  fmt,
  lessonHref,
  linePath,
  loadingColor,
  mw,
  niceTicks,
  scale,
  signed,
  usd,
  useScenario,
} from '../../framework';
import { dcopf, type OpfResult } from '../../engines/market/opf';
import { checkDispatch, fleetOffers, nodalLoads } from '../../engines/market/networkDispatch';
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

// The prose's example: Central–Metro limited to 250 MW, one more megawatt in Metro.
const PROBE_LIMIT = 250;
const PROBE = solve(PROBE_LIMIT);
const PROBE_METRO = solve(PROBE_LIMIT, { node: 'city', mw: 1 }, false);
const PROBE_EAST = PROBE_METRO.dispatch.ct - PROBE.dispatch.ct;
const PROBE_LAKESIDE = PROBE_METRO.dispatch.cc1 - PROBE.dispatch.cc1;

// Redispatch by hand: move output from Lakeside, at the head of the line, to Mill Creek, at its foot.
const LAKESIDE_BASE = BASE.dispatch.cc1;
const MILL_BASE = BASE.dispatch.cc2;
const SWAP_MAX = Math.min(LAKESIDE_BASE, fleetById('cc2').capacity - MILL_BASE);
const SWAP_COST = fleetById('cc2').marginalCost - fleetById('cc1').marginalCost;

/** The flow on Central–Metro, and the extra cost, when `swap` MW of Lakeside's output moves to Mill Creek. */
export function handSwap(swap: number) {
  const d = { ...BASE.dispatch, cc1: LAKESIDE_BASE - swap, cc2: MILL_BASE + swap };
  const c = checkDispatch(REGION, GENS, d, LOADS);
  return { flow: Math.abs(c.flows[LINE]), cost: c.cost - BASE.cost, overloads: c.overloads };
}

// A line counts as at its limit within a megawatt (the figure shows whole megawatts).
const OVER = 0.5;
const UNDER = 1;

/** The challenge: the line limited to 50 MW below its unconstrained flow, relieved by just enough redispatch. */
export const CHALLENGE_LIMIT = 375;
export const CHALLENGE_RELIEF = Math.round(BASE_FLOW - CHALLENGE_LIMIT);
export function swapSolved(limit: number, swap: number): boolean {
  if (limit !== CHALLENGE_LIMIT) return false;
  const { flow } = handSwap(swap);
  return flow <= limit + OVER && flow >= limit - UNDER;
}

/** The fewest whole megawatts of swap that bring the line within `limit` (half a megawatt's tolerance). */
export function leastSwap(limit: number): number {
  for (let sw = 0; sw <= SWAP_MAX; sw++) if (handSwap(sw).flow <= limit + OVER) return sw;
  return NaN;
}
const SWAP_400 = leastSwap(400);

export const CONGESTION_DEFAULTS = { limit: RATED, swap: 0, node: 'city' as NodeId };

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

/** Line Central–Metro on its own: the flow at your dispatch against the limit. */
function LineGauge({ flow, limit }: { flow: number; limit: number }) {
  const X = scale(0, RATED, 24, 576);
  const over = flow > limit + OVER;
  const at = !over && flow >= limit - UNDER;
  const fill = over ? '#b8302a' : at ? '#e75b55' : loadingColor(flow, limit);
  const inside = X(flow) - X(0) > 90;
  return (
    <svg
      className="chart"
      viewBox="0 0 600 98"
      role="img"
      aria-label={`Line Central–Metro carries ${fmt(flow)} MW against a limit of ${fmt(limit)} MW${over ? ': it is overloaded' : ''}. At the cheapest dispatch it would carry ${fmt(BASE_FLOW)} MW.`}
    >
      <text x={24} y={14} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        Flow on Central–Metro, MW
      </text>
      <rect x={X(0)} y={26} width={X(RATED) - X(0)} height={26} fill="#ececec" rx={2} />
      <rect x={X(0)} y={26} width={Math.max(0, X(flow) - X(0))} height={26} fill={fill} rx={2} />
      <text
        x={inside ? X(flow) - 6 : X(flow) + 6}
        y={44}
        textAnchor={inside ? 'end' : 'start'}
        style={{ fontSize: 13, fontWeight: 500, fill: inside && (over || at) ? '#fff' : '#333' }}
      >
        {fmt(flow)} MW
      </text>
      <line x1={X(BASE_FLOW)} x2={X(BASE_FLOW)} y1={22} y2={56} stroke="#777" strokeWidth={1.5} strokeDasharray="3 3" />
      <text className="ax ax-m" x={X(BASE_FLOW)} y={70}>
        cheapest dispatch: {fmt(BASE_FLOW)}
      </text>
      <line x1={X(limit)} x2={X(limit)} y1={20} y2={58} stroke="#333" strokeWidth={2.5} />
      <text x={X(limit) > 545 ? X(limit) + 2 : X(limit)} y={14} textAnchor={X(limit) > 545 ? 'end' : 'middle'} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        limit {fmt(limit)}
      </text>
      {[0, 100, 200, 300, 400, 500, 600].map((t) => (
        <text key={t} className="ax ax-m" x={X(t)} y={92}>
          {t}
        </text>
      ))}
    </svg>
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
  const s = useScenario('congestion', CONGESTION_DEFAULTS);
  const { limit, swap, node } = s.state;
  const r = solve(limit);
  const congestion = r.cost - BASE.cost;

  // Figure 1: the cheapest dispatch with some of Lakeside's output moved to Mill Creek.
  const hand = handSwap(swap);
  const handOver = hand.flow > limit + OVER;
  const handAt = !handOver && hand.flow >= limit - UNDER;
  const relief = BASE_FLOW - hand.flow;
  let handCaption: string;
  if (swap === 0 && !handOver) handCaption = `At the cheapest dispatch Central–Metro carries ${fmt(BASE_FLOW)} MW, so a limit of ${mw(limit)} doesn’t bind.`;
  else if (handOver)
    handCaption =
      swap >= SWAP_MAX
        ? `Mill Creek is flat out, and Central–Metro is still ${fmt(hand.flow - limit)} MW over its limit: relief this deep has to come from another plant.`
        : `Central–Metro is ${fmt(hand.flow - limit)} MW over its limit. Move ${swap > 0 ? 'more' : 'some'} of Lakeside’s output to Mill Creek.`;
  else if (handAt) handCaption = `Central–Metro is at its limit. Moving ${mw(swap)} from Lakeside to Mill Creek took ${mw(relief)} off the line.`;
  else handCaption = `Central–Metro has ${mw(limit - hand.flow)} to spare: you’ve moved more than the limit requires.`;
  const swapOk = swapSolved(limit, swap);

  // Cost of congestion as the limit falls from its rating.
  const sweep = useMemo(() => {
    const ls: number[] = [];
    for (let l = MIN_LIMIT; l <= RATED; l += 5) ls.push(l);
    const res = ls.map((l) => solve(l, undefined, false));
    return { ls, cost: res.map((x) => x.cost - BASE.cost), mill: res.map((x) => x.dispatch.cc2) };
  }, []);
  const costAt = (l: number) => sweep.cost[sweep.ls.indexOf(l)];
  const millFullAt = sweep.ls.filter((_, i) => sweep.mill[i] >= 250 - 1e-6).pop() ?? MIN_LIMIT;
  const slope1 = (costAt(300) - costAt(400)) / 100;
  const slope2 = (costAt(220) - costAt(280)) / 60;

  const X = scale(MIN_LIMIT, RATED, 70, 580);
  const yMax = Math.max(...sweep.cost) * 1.08;
  const Y = scale(0, yMax, 230, 36);
  const yTicks = niceTicks(0, yMax, 4).filter((v) => v <= yMax);

  // One more megawatt at the chosen node.
  const bumped = solve(limit, { node, mw: 1 }, false);
  const perMW = Object.fromEntries(PLANTS.map((id) => [id, (bumped.dispatch[id] ?? 0) - (r.dispatch[id] ?? 0)]));
  const marginal = bumped.cost - r.cost;
  const nodeName = (id: string) => REGION.nodes.find((n) => n.id === id)!.name;
  const limitSlider = (
    <Slider label="Limit on line Central–Metro" tone="red" value={limit} min={MIN_LIMIT} max={RATED} step={5} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
  );

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
        every line in service — on the region mapped in <a href={lessonHref('5.1')}>Lesson 5.1</a>. Line Central–Metro is the main route into Metro, rated for{' '}
        {mw(RATED)}, and at the cheapest dispatch it carries {mw(BASE_FLOW)}. The next demonstration shows just that line. Lower its limit to {mw(400)}, and the cheapest
        dispatch would overload it. Then relieve it by hand: move output from Lakeside, at Central, to Mill Creek, in Metro, until the line is back within its limit, and
        notice how much you have to move:
      </P>

      <Figure name="Congestion Simulator" scenario={s}>
        <LineGauge flow={hand.flow} limit={limit} />
        {limitSlider}
        <Slider
          label={
            <>
              <Swatch color={FUEL[fleetById('cc2').fuel]} />
              Lakeside → Mill Creek
            </>
          }
          tone="orange"
          value={swap}
          min={0}
          max={SWAP_MAX}
          step={1}
          onChange={(v) => s.set({ swap: v })}
          display={mw(swap)}
        />
        <Readouts items={[{ label: `extra cost per hour, at $${SWAP_COST} per MWh moved`, value: usd(hand.cost), tone: hand.cost > 0.5 ? 'red' : undefined }]} />
        <Caption>{handCaption}</Caption>
      </Figure>

      <P>
        Shifting output like this — a plant on the Metro side of the bottleneck runs harder, a plant on the far side less, and total generation stays the same — is called{' '}
        <b>redispatch</b>. Lakeside and Mill Creek are the natural pair. Lakeside sits at Central, right at the head of the line, and Mill Creek in Metro, at its foot.
        Both burn gas, and Mill Creek costs only ${SWAP_COST} more per megawatt-hour, so this relief is cheap; it’s the swap the optimizer makes first, too.
      </P>
      <P>
        It takes more redispatch than you might expect, though. To bring the line from {fmt(BASE_FLOW)} MW to 400 MW, you had to move about {mw(SWAP_400)}. Even before
        the swap, part of Lakeside’s output reached Metro by other routes, through West or round by North and East, so moving one megawatt from Lakeside to Mill Creek
        takes only {fmt(1 / SWAP_MILL, 2)} MW off Central–Metro. That {fmt(1 / SWAP_MILL, 2)} is a power transfer distribution factor from{' '}
        <a href={lessonHref('2.4')}>Lesson 2.4</a>: the share of each megawatt sent from Central to Metro that travels on Central–Metro itself. So every megawatt of
        relief needs 1 ÷ {fmt(1 / SWAP_MILL, 2)} = {fmt(SWAP_MILL, 2)} MW of redispatch.
      </P>

      <Challenge
        id="a"
        figure="Congestion Simulator"
        question={`Lower the limit to ${mw(CHALLENGE_LIMIT)}, ${mw(CHALLENGE_RELIEF)} below what the line carries at the cheapest dispatch. Before you touch the swap, work out from the PTDF how many megawatts Lakeside must hand to Mill Creek to bring the line back within its limit. Then set the swap to your answer to check it.`}
        solved={swapOk}
        status={
          limit !== CHALLENGE_LIMIT
            ? `The limit is ${mw(limit)}; set it to ${mw(CHALLENGE_LIMIT)}.`
            : handOver
              ? `With ${mw(swap)} moved, Central–Metro still carries ${fmt(hand.flow)} MW.`
              : `With ${mw(swap)} moved, the line has ${mw(limit - hand.flow)} to spare: that’s more than it takes.`
        }
        success={`Solved. ${mw(CHALLENGE_RELIEF)} of relief at ${fmt(1 / SWAP_MILL, 2)} MW per megawatt moved takes ${fmt(CHALLENGE_RELIEF, 0)} × ${fmt(SWAP_MILL, 2)} ≈ ${mw(CHALLENGE_RELIEF * SWAP_MILL)} of redispatch, at $${SWAP_COST} more for each: ${usd(hand.cost)} an hour.`}
      />

      <H2>The cost of congestion</H2>
      <P>
        The <K c="price">cost of congestion</K> is the cost of the cheapest dispatch with the limit, minus the cost of the cheapest dispatch without it. In the next
        chart, the optimizer finds the cheapest dispatch for every limit from {mw(RATED)} down to {mw(MIN_LIMIT)}:
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
        {limitSlider}
        <Readouts items={[{ label: 'cost of congestion per hour', value: usd(congestion), tone: 'red' }]} />
      </Figure>

      <P>
        The curve has two straight pieces. While Mill Creek is replacing Lakeside — the swap you made by hand — each megawatt of lost capacity costs{' '}
        {fmt(SWAP_MILL, 2)} MW × ${SWAP_COST} = {usd(slope1, 2)} an hour. Below about {mw(millFullAt + 5)}, Mill Creek is running flat out, and the next-cheapest relief is the Eastgate peaker at $88. That’s
        not only more expensive, it’s also less effective: some of Eastgate’s output takes the long way to Metro, through North and Central, and onto the very line
        we’re trying to relieve. Each megawatt of relief now takes {fmt(SWAP_EAST, 2)} MW of redispatch at $52 more apiece, about {usd(slope2)} an hour. The kink is
        where the cheap fix runs out.
      </P>

      <P>
        Real systems pay this cost every day. Where the market price ignores the wires — as in Europe’s zonal markets, where a whole country or region shares one price —
        grid operators buy redispatch like this directly, after the market has cleared. In Germany alone, it costs billions of euros a year.
      </P>

      <H2>One more megawatt</H2>
      <P>
        The cost of congestion is a total. For a market, the more useful number is a marginal one: if demand at one substation rose by a single megawatt, how much more
        would the cheapest dispatch cost? Without congestion, and ignoring losses, it’s the same everywhere. Pick a place, and set the limit low enough that
        Central–Metro is full. The bars show how the optimizer would meet the extra megawatt:
      </P>

      <Figure name="Congestion Simulator · one more megawatt" scenario={s}>
        <Segmented
          label="Where to add one megawatt of demand"
          value={node}
          onChange={(v) => s.set({ node: v })}
          options={NODE_ORDER.map((id) => ({ value: id, label: nodeName(id) }))}
        />
        {limitSlider}
        <Readouts items={[{ label: `one more MWh in ${nodeName(node)} costs`, value: usd(marginal, 2), tone: 'green' }]} />
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
        With the line at its full rating, one more megawatt anywhere is met by Mill Creek, the cheapest plant with room to spare, for $42. Now lower the limit to{' '}
        {mw(PROBE_LIMIT)} and choose Central. Lakeside produces the extra megawatt itself, for {usd(PROBE.lmp.center)} — it’s consumed right where it’s made, so it
        never has to cross the full line. Choose Metro, and the answer is strange. Mill Creek is already flat out, and the bars show the optimizer raising Eastgate by
        about {fmt(PROBE_EAST, 2)} MW — more than the one megawatt asked for — while it <i>lowers</i> Lakeside, the cheaper plant, by about{' '}
        {fmt(-PROBE_LAKESIDE, 2)} MW. One more megawatt-hour in Metro costs {usd(PROBE.lmp.city, 2)}, more than the offer of any plant that’s actually running.
      </P>
      <P>
        Every other substation gives a number of its own. So once a line is congested, the cost of serving one more megawatt is different at every place on the grid,
        and in many markets that cost is the price. But why would the cheapest way to serve more demand turn a cheap plant down, and how can a megawatt-hour cost more
        than any plant charges? The <a href={lessonHref('5.3')}>next lesson</a> answers both on a grid small enough to work out by hand, then comes back to Metro’s{' '}
        {usd(PROBE.lmp.city, 2)}.
      </P>
    </LessonPage>
  );
}
