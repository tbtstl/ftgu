import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  NetworkView,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  linePath,
  mw,
  priceFill,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { dcopf } from '../../engines/market/opf';
import { THREE_NODE } from '../../model/networks';

const A_OFFER = 20;

function solve(demand: number, limit: number, bOffer: number) {
  return dcopf(
    THREE_NODE,
    [
      { id: 'gA', node: 'A', capacity: 500, offer: A_OFFER },
      { id: 'gB', node: 'B', capacity: 600, offer: bOffer },
    ],
    { C: demand },
    { limits: { AC: limit } },
  );
}

export default function Lesson() {
  const s = useScenario('three-node', { demand: 300, limit: 250, bOffer: 50 });
  const { demand, limit, bOffer } = s.state;
  const r = solve(demand, limit, bOffer);
  const congested = r.binding.includes('AC');
  const lmp = (n: string) => Math.round(r.lmp[n] ?? 0);

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
  const solved = congested && lmp('C') === 100;

  const nodeLabel = { A: '#2f6fb3', B: '#8e4fa0', C: '#ad5310' } as const;

  return (
    <LessonPage id="5.3">
      <P>
        In the single-zone markets of Chapter 4, one clearing price applied to everyone. The previous lesson showed why that can’t survive a congested line: once the
        cheapest power can’t physically reach the customers who want it, serving one more megawatt costs a different amount at every place on the grid. Many markets
        turn those costs directly into prices, so the price of electricity depends on where you are.
      </P>
      <P>
        Here’s the smallest grid where that happens. Node <K tone="blue">A</K> has a cheap generator, node <K tone="violet">B</K> an expensive one, and all of the demand
        sits at node <K tone="orange">C</K>. Three identical lines connect the nodes in a triangle, and the line from A to C has a limit you can adjust. Each node is shaded
        by its price:
      </P>

      <Figure name="Nodal Price Explorer" scenario={s}>
        <NetworkView
          ariaLabel={`Three-node grid. Prices: A $${lmp('A')}, B $${lmp('B')}, C $${lmp('C')} per MWh. Line A–C carries ${Math.round(Math.abs(r.flows.AC))} of ${limit} MW.`}
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
            {Math.round(r.dispatch.gA)} of 500 MW
          </text>
          <text x={576} y={172} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
            Generator B
          </text>
          <text x={576} y={190} textAnchor="end" className="ax">
            offers ${bOffer}
          </text>
          <text x={576} y={208} textAnchor="end" className="ax">
            {Math.round(r.dispatch.gB)} of 600 MW
          </text>
          <text x={420} y={330} className="ax">
            Load · {demand} MW
          </text>
        </NetworkView>
        <Readouts
          items={[
            { label: 'from A', value: mw(r.dispatch.gA) },
            { label: 'from B', value: mw(r.dispatch.gB) },
            { label: 'generation cost per hour', value: usd(r.cost) },
            { label: 'congestion rent per hour', value: usd(r.congestionRent) },
          ]}
        />
        <Slider label="Demand at C" tone="orange" value={demand} min={100} max={600} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
        <Slider label="Limit on line A–C" value={limit} min={200} max={500} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
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

      <H2>Why C pays more than anyone charges</H2>
      <P>
        The <b>locational marginal price</b>, or LMP, at a node is the cost of serving one more megawatt of demand there without overloading any line. At C, we can’t
        simply raise A’s output: two thirds of every extra megawatt from A would flow over a line that’s already full. Raising B’s output pushes a third of a megawatt onto
        line A–C as well. The cheapest way to deliver one more megawatt to C while keeping A–C exactly at its limit is to raise B by 2 MW and lower A by 1 MW:
      </P>
      <Eq label="Price at C when line A to C is full">
        <K tone="orange">
          LMP<Sub>C</Sub>
        </K>
        <Op>=</Op>
        <span>2</span>
        <Op>×</Op>
        <K tone="violet">${bOffer}</K>
        <Op>−</Op>
        <span>1</span>
        <Op>×</Op>
        <K tone="blue">${A_OFFER}</K>
        <Op>=</Op>
        <K tone="orange">${2 * bOffer - A_OFFER}</K>
      </Eq>
      <P>So the price at C exceeds the offer of every generator on the grid. It looks paradoxical, but it’s exactly what that last megawatt costs the system.</P>

      <Challenge
        id="a"
        figure="Nodal Price Explorer"
        question={
          <>
            Using the sliders in <FigRef to="Nodal Price Explorer">the first demonstration</FigRef>, make the price at node C exactly $100.
          </>
        }
        solved={solved}
        status={`Right now, the price at C is $${lmp('C')}.${congested ? '' : ' Line A–C isn’t full yet.'}`}
        success="Solved. With line A–C full, C’s price is 2 × $60 − $20 = $100."
      />

      <P>
        The next chart plots all three prices as the demand at C rises, using the line limit and B’s offer you set in{' '}
        <FigRef to="Nodal Price Explorer">the first demonstration</FigRef>. The shaded region is where line A–C is full:
      </P>

      <Figure name="Nodal Price Explorer · prices vs. demand">
        <Legend
          items={[
            { label: 'Price at A', color: '#4590ce', kind: 'line' },
            { label: 'Price at B', color: '#ab70b6', kind: 'line', dashed: true },
            { label: 'Price at C', color: '#e48850', kind: 'line' },
          ]}
        />
        <svg className="chart" viewBox="0 0 600 262" role="img" aria-label="Prices at nodes A, B and C as demand at C rises">
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
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('C')))} r={6} fill="#e48850" stroke="#fcfcfb" strokeWidth={2} />
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('B')))} r={5} fill="#ab70b6" stroke="#fcfcfb" strokeWidth={2} />
          <circle cx={x(demand)} cy={y(Math.min(180, lmp('A')))} r={4} fill="#4590ce" stroke="#fcfcfb" strokeWidth={2} />
        </svg>
        <Slider label="Demand at C" tone="orange" value={demand} min={100} max={600} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
      </Figure>

      <P>
        Below the kink, location doesn’t matter. Above it, the three prices fan out. The money doesn’t vanish, either: consumers at C pay more than the generators at A and
        B receive, and the difference is collected by the grid operator as <b>congestion rent</b>. Who that money belongs to, and how traders hedge against it, is the
        subject of the next lesson.
      </P>
    </LessonPage>
  );
}
