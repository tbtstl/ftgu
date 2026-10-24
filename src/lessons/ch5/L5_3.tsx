import { Fragment, useMemo } from 'react';
import {
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  NetworkView,
  Op,
  P,
  Slider,
  Sub,
  Tn,
  fmt,
  lessonHref,
  linePath,
  mw,
  priceFill,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { lmpComponents, shadowPrices } from '../../engines/market/lmpComponents';
import { fleetOffers, nodalLoads } from '../../engines/market/networkDispatch';
import { dcopf } from '../../engines/market/opf';
import { STANDARD_FLEET } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, THREE_NODE, nodeName } from '../../model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

// ---------------------------------------------------------------------------
// The triangle: cheap A, expensive B, all demand at C.

const A_OFFER = 20;
// Enough for A to cover the largest demand on its own, so prices separate only when line A–C fills.
const A_CAP = 700;
const B_CAP = 600;

function triangleGens(bOffer: number) {
  return [
    { id: 'gA', node: 'A', capacity: A_CAP, offer: A_OFFER },
    { id: 'gB', node: 'B', capacity: B_CAP, offer: bOffer },
  ];
}

function solve(demand: number, limit: number, bOffer: number) {
  return dcopf(THREE_NODE, triangleGens(bOffer), { C: demand }, { limits: { AC: limit } });
}

/** The triangle's prices taken apart, with A as the reference node. */
function triangleParts(demand: number, limit: number, bOffer: number) {
  const opts = { limits: { AC: limit } };
  const r = dcopf(THREE_NODE, triangleGens(bOffer), { C: demand }, opts);
  const cons = shadowPrices(THREE_NODE, triangleGens(bOffer), { C: demand }, opts, r);
  return { r, cons, parts: lmpComponents(THREE_NODE, 'A', r.lmp.A, cons) };
}

// The settlement example in the prose.
const SETTLE = { demand: 450, limit: 250, bOffer: 50 };
const SETTLED = solve(SETTLE.demand, SETTLE.limit, SETTLE.bOffer);

/** The first demonstration's starting values: A covers everything and all three prices match. */
export const TRIANGLE_DEFAULTS = { demand: 300, limit: 250, bOffer: 50 };
export const TARGET_C = 100;
/** The challenge: line A–C full and C's price at the target, which takes B offering (target + A's offer) ÷ 2. */
export function priceSolved(st: { demand: number; limit: number; bOffer: number }): boolean {
  const r = solve(st.demand, st.limit, st.bOffer);
  return r.binding.includes('AC') && Math.round(r.lmp.C ?? 0) === TARGET_C;
}

// ---------------------------------------------------------------------------
// The region: Lesson 5.2's reference evening, with Central–Metro derated.

const HOUR = 19;
const GENS = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[HOUR], solarCF: SOLAR_CF[HOUR] });
const LOADS = nodalLoads(SYSTEM_DEMAND[HOUR], REGION_LOAD_SHARE);
const LINE = 'center-city';
const RATED = REGION.lines.find((l) => l.id === LINE)!.limit;
const REF = 'center';

function regionParts(limit: number) {
  const opts = { limits: { [LINE]: limit } };
  const r = dcopf(REGION, GENS, LOADS, opts);
  const cons = shadowPrices(REGION, GENS, LOADS, opts, r);
  return { r, cons, parts: lmpComponents(REGION, REF, r.lmp[REF], cons) };
}

// Lesson 5.2 ended on Metro's price with the line limited to 250 MW; at 300 MW, Mill Creek has room again.
const METRO_LIMIT = 250;
const METRO = regionParts(METRO_LIMIT);
const METRO_MU = METRO.cons[0].mu;
const METRO_PTDF = METRO.parts.city.terms[0].ptdf;
const LOOSER = regionParts(300);
const RATED_FLOW = Math.abs(regionParts(RATED).r.flows[LINE]);

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

export default function Lesson() {
  const s = useScenario('three-node', TRIANGLE_DEFAULTS);
  const { demand, limit, bOffer } = s.state;
  const tri = triangleParts(demand, limit, bOffer);
  const r = tri.r;
  const congested = r.binding.includes('AC');
  const lmp = (n: string) => Math.round(r.lmp[n] ?? 0);
  const mu = tri.cons.find((c) => c.line === 'AC')?.mu ?? 0;

  // Prices at each node as demand at C sweeps from 100 to 600 MW.
  const sweep = useMemo(() => {
    const ds: number[] = [];
    for (let d = 100; d <= 600; d += 5) ds.push(d);
    const res = ds.map((d) => solve(d, limit, bOffer).lmp);
    const firstCongested = ds.find((_, i) => Math.abs(res[i].C - res[i].A) > 0.5);
    return { ds, res, firstCongested };
  }, [limit, bOffer]);
  const x = scale(100, 600, 60, 580);
  const y = scale(0, 180, 220, 40);
  const curve = (n: 'A' | 'B' | 'C') => linePath(sweep.ds.map(x), sweep.res.map((l) => y(Math.min(180, l[n]))));
  const solved = priceSolved(s.state);

  const nodeLabel = { A: '#2f6fb3', B: '#8e4fa0', C: '#ad5310' } as const;

  const settlement = [
    { key: 'A', who: 'Generator A is paid', mw: r.dispatch.gA, price: r.lmp.A, total: r.dispatch.gA * r.lmp.A },
    { key: 'B', who: 'Generator B is paid', mw: r.dispatch.gB, price: r.lmp.B, total: r.dispatch.gB * r.lmp.B },
    { key: 'C', who: 'Loads at C pay', mw: demand, price: r.lmp.C, total: demand * r.lmp.C },
  ];

  // ---- The region.
  const g = useScenario('region-lmp', { limit: METRO_LIMIT, node: 'city' });
  const reg = useMemo(() => regionParts(g.state.limit), [g.state.limit]);
  const picked = reg.parts[g.state.node];
  const pickedName = nodeName(REGION, g.state.node);
  const regLmp = (id: string) => reg.r.lmp[id] ?? 0;

  return (
    <LessonPage id="5.3">
      <P>
        The previous lesson ended on a strange number. On the reference evening, with line Central–Metro limited to {mw(METRO_LIMIT)}, one more megawatt-hour in Metro
        costs <K c="price">{usd(METRO.r.lmp.city, 2)}</K>, more than Eastgate’s $88, the dearest offer of any plant that’s running. In the single-zone markets of
        Chapter 4, one clearing price applied to everyone. Many markets turn costs like Metro’s directly into prices, so the price of electricity depends on where you
        are. This lesson explains where that number comes from.
      </P>
      <P>
        Six substations and eight lines are too many to follow by hand: every megawatt spreads over all of them at once. So we’ll shrink the grid to the smallest one
        where the same thing happens, work it out there, and then come back to Metro. Node <K tone="blue">A</K> has a cheap generator, node <K tone="violet">B</K> an
        expensive one, and all of the demand sits at node <K tone="orange">C</K>. Three identical lines connect the nodes in a triangle, and the line from A to C has a
        limit you can adjust. Each node is shaded by its price. The table settles the hour: each generator is paid its own node’s price for what it produces, and the
        loads pay C’s price for what they use. Its last line, the <b>congestion rent</b>, is the money left over whenever consumers pay more for their power than the
        generators are paid for it:
      </P>

      <Figure name="Nodal Price Explorer" scenario={s}>
        <NetworkView
          ariaLabel={`Three-node grid. Prices: A $${lmp('A')}, B $${lmp('B')}, C $${lmp('C')} per MWh. Line A–C carries ${Math.round(Math.abs(r.flows.AC))} of ${limit} MW. Congestion rent ${usd(r.congestionRent)} an hour.`}
          width={600}
          height={392}
          nodes={THREE_NODE.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            r: 40,
            label: n.name,
            labelPos: n.id === 'C' ? 'below' : 'above',
            labelColor: nodeLabel[n.id as 'A' | 'B' | 'C'],
            value: usd(lmp(n.id)),
            sub: 'per MWh',
            fill: priceFill(lmp(n.id)),
          }))}
          lines={THREE_NODE.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: r.flows[l.id],
            limit: l.id === 'AC' ? limit : undefined,
            label: l.id === 'AC' ? `A–C · ${Math.round(Math.abs(r.flows.AC))} of ${limit} MW` : `${l.from}–${l.to} · ${Math.round(Math.abs(r.flows[l.id]))} MW`,
            labelDx: l.id === 'AC' ? -95 : l.id === 'BC' ? 70 : 0,
            labelDy: l.id === 'AB' ? -14 : l.id === 'AC' ? 40 : 6,
          }))}
        >
          <text x={24} y={172} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
            Generator A
          </text>
          <text x={24} y={190} className="ax">
            offers ${A_OFFER}
          </text>
          <text x={24} y={208} className="ax">
            {Math.round(r.dispatch.gA)} of {A_CAP} MW
          </text>
          <text x={576} y={172} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
            Generator B
          </text>
          <text x={576} y={190} textAnchor="end" className="ax">
            offers ${bOffer}
          </text>
          <text x={576} y={208} textAnchor="end" className="ax">
            {Math.round(r.dispatch.gB)} of {B_CAP} MW
          </text>
          <text x={420} y={330} className="ax">
            Load · {demand} MW
          </text>
        </NetworkView>
        <DataTable
          caption="The hour’s settlement: what each generator is paid and the loads pay, at their own node’s price"
          rows={settlement}
          rowKey={(row) => row.key}
          columns={[
            { label: 'Settlement', cell: (row) => row.who },
            { label: 'MW', cell: (row) => fmt(row.mw), align: 'right' },
            { label: 'Price', cell: (row) => usd(row.price), align: 'right' },
            { label: 'Per hour', cell: (row) => usd(row.total), align: 'right' },
          ]}
          footer={['Congestion rent: loads pay, minus generators are paid', '', '', usd(r.congestionRent)]}
        />
        <Slider label="Demand at C" tone="orange" value={demand} min={100} max={600} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
        <Slider label="Limit on line A–C" value={limit} min={210} max={500} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
        <Slider label="Offer from generator B" tone="violet" value={bOffer} min={30} max={90} onChange={(v) => s.set({ bOffer: v })} display={`$${bOffer} per MWh`} />
      </Figure>

      <P>
        At the starting demand, the cheap generator at A covers everything, and all three nodes share its price of $20. Look at how its power reaches C, though: two
        thirds flows straight down line A–C, but a third takes the long way round, through B. Nobody chooses that route. Power divides across every available path in
        inverse proportion to the path’s impedance, and the direct path, being half as long as the detour, carries twice as much.
      </P>
      <P>
        Now increase the <K tone="orange">demand at C</K>. Once line A–C reaches its limit, every extra megawatt at C has to come at least partly from B, and the prices
        separate. A keeps its $20. B’s own offer sets its price. And C’s price jumps above both.
      </P>
      <P>
        Watch the table as they do. At {mw(SETTLE.demand)} of demand, with the line at {mw(SETTLE.limit)} and B offering ${SETTLE.bOffer}, A produces{' '}
        {mw(SETTLED.dispatch.gA)} and is paid {usd(SETTLED.dispatch.gA * SETTLED.lmp.A)} an hour at A’s price of {usd(SETTLED.lmp.A)}, B produces{' '}
        {mw(SETTLED.dispatch.gB)} and is paid {usd(SETTLED.dispatch.gB * SETTLED.lmp.B)} at B’s {usd(SETTLED.lmp.B)}, and the loads at C pay{' '}
        {usd(SETTLE.demand * SETTLED.lmp.C)} at C’s {usd(SETTLED.lmp.C)}. Every generator is paid its own node’s price and every load pays its own node’s price, so the two sides no longer match:{' '}
        {usd(SETTLED.congestionRent)} an hour is left over. That is the congestion rent, and the grid operator, which settles every trade, collects it.
      </P>

      <H2>Why C pays more than anyone charges</H2>
      <P>
        The <b>locational marginal price</b>, or LMP, at a node is the cost of serving one more megawatt of demand there without overloading any line. At C, we can’t
        simply raise A’s output: two thirds of every extra megawatt from A would flow over a line that’s already full. Raising B’s output pushes a third of a megawatt onto
        line A–C as well. The cheapest way to deliver one more megawatt to C while keeping A–C exactly at its limit is to raise B by 2 MW and lower A by 1 MW. With B
        offering ${SETTLE.bOffer}, as in the settlement example:
      </P>
      <Eq label={`Price at C when line A to C is full: 2 times $${SETTLE.bOffer} minus 1 times $${A_OFFER} equals $${2 * SETTLE.bOffer - A_OFFER}`}>
        <K tone="orange">
          LMP<Sub>C</Sub>
        </K>
        <Op>=</Op>
        <span>2</span>
        <Op>×</Op>
        <K tone="violet">${SETTLE.bOffer}</K>
        <Op>−</Op>
        <span>1</span>
        <Op>×</Op>
        <K tone="blue">${A_OFFER}</K>
        <Op>=</Op>
        <K tone="orange">${2 * SETTLE.bOffer - A_OFFER}</K>
      </Eq>
      <P>
        That’s the {usd(SETTLED.lmp.C)} the loads at C paid in the settlement: more than any generator on the grid offers. It looks paradoxical, but it’s exactly what
        that last megawatt costs the system.
      </P>

      <Challenge
        id="a"
        figure="Nodal Price Explorer"
        question={
          <>
            With line A–C full, what offer from generator B makes the price at C exactly ${TARGET_C}? Work it out from the recipe before you touch B’s slider, then set
            it in <FigRef to="Nodal Price Explorer">the first demonstration</FigRef> to check, with enough demand that the line stays full.
          </>
        }
        solved={solved}
        status={`Right now, the price at C is $${lmp('C')}.${congested ? '' : ' Line A–C isn’t full yet.'}`}
        success={`Solved. With line A–C full, C’s price is 2 × B’s offer − $${A_OFFER}, so it takes an offer of ($${TARGET_C} + $${A_OFFER}) ÷ 2 = $${(TARGET_C + A_OFFER) / 2} from B: C pays more than either generator charges.`}
      />

      <H2>One formula for every node</H2>
      <P>
        Every price on the triangle can be written the same way, from three ingredients. The first is the full line’s <b>shadow price</b>, written μ (the Greek letter
        mu): how much the cheapest dispatch would save each hour if the line could carry one more megawatt. One more megawatt on A–C would let the optimizer swap three
        megawatts of B’s output for A’s, so with B offering ${SETTLE.bOffer}, μ is 3 × (${SETTLE.bOffer} − ${A_OFFER}) = {usd(3 * (SETTLE.bOffer - A_OFFER))}. The
        second is the price at a <b>reference node</b>, written λ (lambda); we’ll use A. The third is the power transfer distribution factor of{' '}
        <a href={lessonHref('2.4')}>Lesson 2.4</a>, which <a href={lessonHref('5.2')}>Lesson 5.2</a> used to count redispatch. Here PTDF<Sub>line, n</Sub> is the
        share of one megawatt sent from the reference node to node n that flows on the line, counted positive in the direction the line is full. Of a megawatt sent from
        A to C, two thirds crosses A–C. Of one sent from A to B, a third does, on its way round through C. Then, at every node n,
      </P>
      <Eq label="The LMP at node n equals lambda plus the sum over lines of mu times the PTDF">
        <K c="price">
          LMP<Sub>n</Sub>
        </K>
        <Op>=</Op>
        <span>λ</span>
        <Op>+</Op>
        <span>Σ</span>
        <span>
          μ<Sub>line</Sub>
        </span>
        <Op>×</Op>
        <span>
          PTDF<Sub>line, n</Sub>
        </span>
      </Eq>
      <P>
        A line that isn’t full has μ = 0, so only full lines add anything. λ is the same at every node, and it’s called the <b>energy component</b> of the price; the
        sum is the <b>congestion component</b>. Real markets add a third part for losses, which our DC model of the grid leaves out, so here it’s zero. The next chart
        plots all three prices as the demand at C rises, for the line limit you set in <FigRef to="Nodal Price Explorer">the first demonstration</FigRef>, and works out
        C’s price from the formula. B’s offer is repeated under the chart: change it and watch μ follow. The shaded region is where line A–C is full:
      </P>

      <Figure name="Nodal Price Explorer · prices vs. demand" scenario={s}>
        <Legend
          items={[
            { label: 'Price at A', color: '#4590ce', kind: 'line' },
            { label: 'Price at B', color: '#ab70b6', kind: 'line', dashed: true },
            { label: 'Price at C', color: '#e48850', kind: 'line' },
          ]}
        />
        <svg className="chart" viewBox="0 0 600 262" role="img" aria-label={`Prices at nodes A, B and C as demand at C rises. At ${demand} MW: A $${lmp('A')}, B $${lmp('B')}, C $${lmp('C')}.`}>
          <text className="ax" x={60} y={24}>
            Price, $ per MWh
          </text>
          {sweep.firstCongested !== undefined && (
            <g>
              <rect x={x(sweep.firstCongested - 2.5)} y={40} width={580 - x(sweep.firstCongested - 2.5)} height={180} fill="#e75b55" opacity={0.08} />
              <text x={x(sweep.firstCongested - 2.5) + 8} y={56} style={{ fontSize: 12, fill: '#c4382f', fontWeight: 500 }}>
                line A–C full
              </text>
            </g>
          )}
          <GridY y={y} ticks={[0, 50, 100, 150]} x0={60} x1={580} format={(v) => '$' + v} baseline={0} />
          {[100, 200, 300, 400, 500, 600].map((d) => (
            <text key={d} className="ax ax-m" x={x(d)} y={240}>
              {d}
            </text>
          ))}
          <text className="ax ax-e" x={580} y={258}>
            Demand at C, MW
          </text>
          <path d={curve('C')} fill="none" stroke="#e48850" strokeWidth={5} strokeLinejoin="round" />
          <path d={curve('B')} fill="none" stroke="#ab70b6" strokeWidth={3} strokeDasharray="8 5" strokeLinejoin="round" />
          <path d={curve('A')} fill="none" stroke="#4590ce" strokeWidth={2} strokeLinejoin="round" />
          <line className="cur" x1={x(demand)} x2={x(demand)} y1={40} y2={220} />
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('C')))} r={6} fill="#e48850" stroke="#f8f8f8" strokeWidth={2} />
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('B')))} r={5} fill="#ab70b6" stroke="#f8f8f8" strokeWidth={2} />
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('A')))} r={4} fill="#4590ce" stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Eq label={`Price at C from the formula: ${usd(tri.parts.C.energy)} plus ${usd(mu)} times two thirds equals ${usd(tri.parts.C.total)}`}>
          <K tone="orange">
            LMP<Sub>C</Sub>
          </K>
          <Op>=</Op>
          <K tone="blue">{usd(tri.parts.C.energy)}</K>
          <Op>+</Op>
          <Tn tone="red">{usd(mu)}</Tn>
          <Op>×</Op>
          <Frac top="2" bottom="3" />
          <Op>=</Op>
          <K tone="orange">{usd(tri.parts.C.total)}</K>
        </Eq>
        <Slider label="Demand at C" tone="orange" value={demand} min={100} max={600} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
        <Slider label="Offer from generator B" tone="violet" value={bOffer} min={30} max={90} onChange={(v) => s.set({ bOffer: v })} display={`$${bOffer} per MWh`} />
      </Figure>

      <P>
        Until the line fills, μ is zero and location doesn’t matter. The moment it fills, μ jumps to three times the gap between B’s offer and A’s, and each node’s
        price rises above A’s by μ times its PTDF: a third of μ at B, which lands exactly on B’s own offer, and two thirds at C, which is the 2 × B − A of the recipe.
      </P>

      <H2>Back to Metro</H2>
      <P>
        The region works the same way, with more terms to add up. Take Central as the reference node. With Central–Metro limited to {mw(METRO_LIMIT)}, Central’s price is
        Lakeside’s {usd(METRO.r.lmp.center)}, and that’s λ. The full line’s shadow price is {usd(METRO_MU, 2)}: the slope of the steeper piece of the cost-of-congestion
        curve in Lesson 5.2, which is no coincidence, since the slope of that curve is exactly what one more megawatt of limit saves. And the PTDF from Central to Metro on
        Central–Metro is the {fmt(METRO_PTDF, 2)} that Lesson 5.2 used to count redispatch. In the next demonstration, click any substation to take its price apart, and
        drag the limit:
      </P>

      <Figure name="Nodal Price Explorer · the region" scenario={g}>
        <NetworkView
          ariaLabel={`The region with Central–Metro limited to ${g.state.limit} MW. Prices: ${REGION.nodes.map((n) => `${n.name} ${usd(regLmp(n.id), 2)}`).join(', ')}.`}
          width={600}
          height={408}
          onNodeClick={(id) => g.set({ node: id })}
          nodes={REGION.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            r: 32,
            label: n.name,
            labelPos: n.id === 'west' ? 'below' : n.id === 'city' ? 'right' : 'above',
            value: usd(regLmp(n.id)),
            sub: 'per MWh',
            fill: priceFill(regLmp(n.id)),
          }))}
          lines={REGION.lines.map((l) => {
            const lim = l.id === LINE ? g.state.limit : l.limit;
            const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: reg.r.flows[l.id] ?? 0,
              limit: lim,
              label: `${fmt(Math.abs(reg.r.flows[l.id] ?? 0))} / ${fmt(lim)}`,
              labelDx: dx,
              labelDy: dy,
            };
          })}
        >
          {(() => {
            const n = REGION.nodes.find((x) => x.id === g.state.node)!;
            return <circle cx={n.x} cy={n.y} r={38} fill="none" stroke="#3f7a1e" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />;
          })()}
        </NetworkView>
        <Eq
          label={`Price at ${pickedName}: ${usd(picked.energy, 2)}${reg.cons.map((c, k) => ` plus ${usd(c.mu, 2)} times ${fmt(picked.terms[k].ptdf, 4)}`).join('')} equals ${usd(regLmp(g.state.node), 2)}`}
        >
          <K c="price">
            LMP<Sub>{pickedName}</Sub>
          </K>
          <Op>=</Op>
          <K tone="blue">{usd(picked.energy, 2)}</K>
          <Op>+</Op>
          {reg.cons.length === 0 && <Tn tone="red">$0</Tn>}
          {reg.cons.map((c, k) => (
            <Fragment key={`${c.outage ?? ''}>${c.line}`}>
              {k > 0 && <Op>+</Op>}
              <Tn tone="red">{usd(c.mu, 2)}</Tn>
              <Op>×</Op>
              <span>{fmt(picked.terms[k].ptdf, 4)}</span>
            </Fragment>
          ))}
          <Op>=</Op>
          <K c="price">{usd(regLmp(g.state.node), 2)}</K>
        </Eq>
        <Slider
          label="Limit on line Central–Metro"
          tone="red"
          value={g.state.limit}
          min={220}
          max={RATED}
          step={10}
          onChange={(v) => g.set({ limit: v })}
          display={mw(g.state.limit)}
        />
      </Figure>

      <P>
        For Metro, {usd(METRO.parts.city.energy)} + {usd(METRO_MU, 2)} × {fmt(METRO_PTDF, 4)} = {usd(METRO.r.lmp.city, 2)}, the number Lesson 5.2 ended on.
        It comes from the same recipe as on the triangle, at a larger scale: Eastgate up, Lakeside down, so that the flow on Central–Metro stays exactly where it is.
        Each substation has its own PTDF on the full line, so each gets its own price, from Central’s {usd(METRO.r.lmp.center)} up to Metro’s. Raise the limit to{' '}
        {mw(300)} and Mill Creek has room again: μ falls to {usd(LOOSER.cons[0].mu, 2)}, the gentler slope of Lesson 5.2’s curve, and Metro’s price falls to Mill
        Creek’s {usd(LOOSER.r.lmp.city)}. Lift the limit past the {fmt(RATED_FLOW)} MW the line carries anyway and nothing is full, so
        every node pays λ. The split also depends on the reference: measure from another node and λ and every PTDF change together, but no node’s total does.
      </P>

      <H2>What markets publish</H2>
      <P>
        Every market in the United States run by an independent grid operator prices this way, at hundreds or thousands of nodes, and most of them publish each price taken
        apart: an energy component, a congestion component and a loss component. Real lines lose power, so the loss part isn’t zero, though it’s usually small, and
        operators differ in where they put the reference and in the signs they give the parts. The parts always add up to the price.
      </P>
      <P>
        Thousands of prices are too many to trade, so markets also publish prices at <b>trading hubs</b>. A hub price is a published average of many nodes’ prices,
        steadier and more widely relevant than any one of them, and it’s where most forward contracts and futures are written; PJM’s Western Hub and ERCOT’s North Hub
        are two of the most traded. A generator paid at its own node but hedged at a hub still carries the difference between the two, which is the subject of{' '}
        <a href={lessonHref('6.3')}>Lesson 6.3</a>. Chapter 6 trades at our region’s hub, which in its simulated history stands for the price the region would have
        without congestion (<a href={lessonHref('6.1')}>Lesson 6.1</a>).
      </P>
      <P>
        Both markets of <a href={lessonHref('4.5')}>Lesson 4.5</a> clear nodally. The day-ahead market solves the network-constrained dispatch for each hour of tomorrow
        on offers, bids and forecasts, and publishes a day-ahead LMP at every node; the real-time market solves it again every five minutes on what is actually
        happening, and publishes real-time LMPs. So each node has two prices, and the two-settlement rules apply node by node: a quantity bought day-ahead at a node is
        settled at that node’s day-ahead price, and any deviation from it at that node’s real-time price.
      </P>
      <P>
        Charging every load and paying every generator its own node’s price leaves the grid operator holding the congestion rent: {usd(SETTLED.congestionRent)} an
        hour on the triangle at the settlement example, and {usd(METRO.r.congestionRent)} on the region with Central–Metro at {mw(METRO_LIMIT)}. Who that money
        belongs to, and how it lets a buyer at C lock in the price at A, is the subject of the <a href={lessonHref('5.4')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}
