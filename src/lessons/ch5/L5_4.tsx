import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
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
import { dcopf } from '../../engines/market/opf';
import { ftrFlows, ftrPlane, hedgedCostPerMWh, rentByLine, settleFtrs } from '../../engines/market/congestionRights';
import { boundarySegment, feasiblePolygon, satisfies, type Box, type Pt } from '../../engines/market/networkDispatch';
import { ftrPayoff } from '../../engines/market/settlement';
import { THREE_NODE } from '../../model/networks';

// The three-node grid from Lesson 5.3: cheap A, expensive B, all demand at C.
const A_OFFER = 20;
const B_OFFER = 50;
const AUCTION_LIMIT = 250;
const A_CAP = 700;
const B_CAP = 600;

function solve(demand: number, limit: number) {
  return dcopf(
    THREE_NODE,
    [
      { id: 'gA', node: 'A', capacity: A_CAP, offer: A_OFFER },
      { id: 'gB', node: 'B', capacity: B_CAP, offer: B_OFFER },
    ],
    { C: demand },
    { limits: { AC: limit } },
  );
}

// The starting point used in the prose: demand 450 MW at C, line A–C limited to 250 MW.
const D0 = solve(450, 250);
const D0_PAID_A = D0.dispatch.gA * D0.lmp.A;
const D0_PAID_B = D0.dispatch.gB * D0.lmp.B;
const D0_SPREAD = D0.lmp.C - D0.lmp.A;
const D0_SHADOW = D0.cost - solve(450, 251).cost;
const D200 = solve(450, 200);
// At the top of the demand slider, line A–B carries power from B to A, against the price difference.
const D600 = solve(600, 250);
const D600_AB = rentByLine(THREE_NODE, D600.flows, D600.lmp).find((l) => l.id === 'AB')!;

const NODE_COLOR = { A: '#2f6fb3', B: '#8e4fa0', C: '#ad5310' } as const;
const PAY = { A: '#4590ce', B: '#ab70b6', rent: '#6d9c37' };

function ThreeNode({ r, limit, ariaLabel }: { r: ReturnType<typeof solve>; limit: number; ariaLabel: string }) {
  const lmp = (n: string) => Math.round(r.lmp[n] ?? 0);
  return (
    <NetworkView
      ariaLabel={ariaLabel}
      width={600}
      height={372}
      nodes={THREE_NODE.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y - 10,
        r: 40,
        label: n.name,
        labelPos: n.id === 'C' ? 'below' : 'above',
        labelColor: NODE_COLOR[n.id as 'A' | 'B' | 'C'],
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
        label: l.id === 'AC' ? `A–C · ${fmt(Math.abs(r.flows.AC))} of ${limit} MW` : `${l.from}–${l.to} · ${fmt(Math.abs(r.flows[l.id]))} MW`,
        labelDx: l.id === 'AC' ? -82 : l.id === 'BC' ? 82 : 0,
        labelDy: l.id === 'AB' ? -14 : 32,
      }))}
    >
      <text x={24} y={162} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        Generator A · ${A_OFFER}
      </text>
      <text x={24} y={180} className="ax">
        produces {fmt(r.dispatch.gA)} MW
      </text>
      <text x={576} y={162} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        Generator B · ${B_OFFER}
      </text>
      <text x={576} y={180} textAnchor="end" className="ax">
        produces {fmt(r.dispatch.gB)} MW
      </text>
    </NetworkView>
  );
}

/** One bar for what loads pay, split into what each generator receives and the rent left over. */
function MoneyBar({ paidA, paidB, rent }: { paidA: number; paidB: number; rent: number }) {
  const total = paidA + paidB + rent;
  const x = scale(0, Math.max(total, 1), 20, 580);
  const segs = [
    { key: 'A', v: paidA, color: PAY.A },
    { key: 'B', v: paidB, color: PAY.B },
    { key: 'rent', v: rent, color: PAY.rent },
  ];
  let at = 0;
  return (
    <svg className="chart" viewBox="0 0 600 84" role="img" aria-label={`Loads pay ${usd(total)} an hour: ${usd(paidA)} to A, ${usd(paidB)} to B, and ${usd(rent)} of congestion rent.`}>
      <text x={20} y={16} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        Loads at C pay {usd(total)} an hour
      </text>
      {segs.map((sg) => {
        const x0 = x(at);
        at += Math.max(0, sg.v);
        const w = x(at) - x0;
        return (
          <g key={sg.key}>
            <rect x={x0} y={28} width={Math.max(0, w)} height={30} fill={sg.color} />
            {w > 64 && (
              <text x={x0 + w / 2} y={48} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#fff' }}>
                {usd(sg.v)}
              </text>
            )}
          </g>
        );
      })}
      <line className="base" x1={20} x2={580} y1={66} y2={66} />
    </svg>
  );
}

// Hedging: a retailer at C with a fixed-price contract for power from A.
const CONTRACT_MW = 200;
const CONTRACT_PRICE = 25;
const HEDGE_LIMIT = 250;
const DEMANDS: number[] = [];
for (let d = 100; d <= 600; d += 5) DEMANDS.push(d);
const HEDGE_PRICES = DEMANDS.map((d) => solve(d, HEDGE_LIMIT).lmp);

/** The retailer's cost per MWh of its contract in each hour on the chart, holding `ftr` MW of rights from A to C. */
export function hedgeCosts(ftr: number): number[] {
  return HEDGE_PRICES.map((l) => hedgedCostPerMWh(CONTRACT_PRICE, CONTRACT_MW, ftr, l.A, l.C));
}

// The challenge: the retailer resells at a fixed price, and rights cost money, so it wants the fewest that keep it from losing.
export const RETAIL_PRICE = 40;
export const FTR_STEP = 10;
export const HEDGE_DEFAULTS = { ftr: 0, demand: 450 };
const neverLoses = (ftr: number) => Math.max(...hedgeCosts(ftr)) <= RETAIL_PRICE + 1e-6;
export function hedgeSolved(ftr: number): boolean {
  return neverLoses(ftr) && !neverLoses(ftr - FTR_STEP);
}

/** A line through the points that jumps vertically wherever the value changes (prices move in steps). */
function stepLine(xs: number[], ys: number[]): string {
  const px: number[] = [];
  const py: number[] = [];
  xs.forEach((x, i) => {
    if (i > 0 && Math.abs(ys[i] - ys[i - 1]) > 0.01) {
      px.push(x);
      py.push(ys[i - 1]);
    }
    px.push(x);
    py.push(ys[i]);
  });
  return linePath(px, py);
}

// Revenue adequacy: FTRs awarded against an auction model; prices from the day's actual grid.
const ADEQ_DEMAND = 450;
const FBOX: Box = [0, 500, 0, 500];

export default function Lesson() {
  // ---- Figure 1: where the rent comes from.
  const s = useScenario('rent', { demand: 450, limit: 250 });
  const { demand, limit } = s.state;
  const r = solve(demand, limit);
  const lmp = (n: string) => r.lmp[n] ?? 0;
  const loadPays = demand * lmp('C');
  const paidA = r.dispatch.gA * lmp('A');
  const paidB = r.dispatch.gB * lmp('B');
  const lines = rentByLine(THREE_NODE, r.flows, r.lmp);
  const congested = r.binding.includes('AC');
  const shadow = congested ? r.cost - solve(demand, limit + 1).cost : 0;

  // ---- Figure 2: hedging with an FTR.
  const h = useScenario('hedge', HEDGE_DEFAULTS);
  const costs = useMemo(() => hedgeCosts(h.state.ftr), [h.state.ftr]);
  const bare = useMemo(() => hedgeCosts(0), []);
  const hr = solve(h.state.demand, HEDGE_LIMIT);
  const hCost = hedgedCostPerMWh(CONTRACT_PRICE, CONTRACT_MW, h.state.ftr, hr.lmp.A, hr.lmp.C);
  const ftrPay = ftrPayoff(h.state.ftr, hr.lmp.A, hr.lmp.C);
  const worstCost = Math.max(...costs);
  const hedgeOk = hedgeSolved(h.state.ftr);
  const HX = scale(100, 600, 60, 580);
  const HY = scale(-40, 100, 220, 36);

  // ---- Figure 3: revenue adequacy.
  const q = useScenario('adequacy', { fA: 300, fB: 150, dayLimit: AUCTION_LIMIT });
  const day = solve(ADEQ_DEMAND, q.state.dayLimit);
  const ftrs = [
    { source: 'A', sink: 'C', mw: q.state.fA },
    { source: 'B', sink: 'C', mw: q.state.fB },
  ];
  const settle = settleFtrs(ftrs, day.lmp, day.congestionRent);
  const implied = ftrFlows(THREE_NODE, ftrs).AC;
  const dayPlane = ftrPlane(THREE_NODE, { source: 'A', sink: 'C' }, { source: 'B', sink: 'C' }, { AC: q.state.dayLimit });
  const auctionPlane = ftrPlane(THREE_NODE, { source: 'A', sink: 'C' }, { source: 'B', sink: 'C' }, { AC: AUCTION_LIMIT });
  const dayPoly = feasiblePolygon(FBOX, dayPlane);
  const auctionEdge = boundarySegment(auctionPlane.find((c) => c.id === 'AC:max')!, FBOX);
  const dayEdge = boundarySegment(dayPlane.find((c) => c.id === 'AC:max')!, FBOX);
  const fits = satisfies([q.state.fA, q.state.fB] as Pt, dayPlane);
  const dayCongested = day.binding.includes('AC');
  const FX = scale(0, 500, 70, 330);
  const FY = scale(0, 500, 290, 30);

  return (
    <LessonPage id="5.4">
      <P>
        The previous lesson left the grid operator holding money. Once line A–C is full, consumers at C pay more for each megawatt-hour than either generator receives,
        and the operator, which settles every trade, collects the difference: the <K c="price">congestion rent</K>. In this lesson we’ll find out where exactly it
        comes from, who it belongs to, and how it lets a buyer at one end of a congested line lock in a price at the other.
      </P>
      <P>
        Here’s the three-node grid again, with B’s offer fixed at ${B_OFFER}. The bar below the map is everything the loads at C pay in an hour, split into what each
        generator receives at its own node’s price and whatever is left over:
      </P>

      <Figure name="Congestion Rights Simulator" scenario={s}>
        <ThreeNode
          r={r}
          limit={limit}
          ariaLabel={`Three-node grid. Prices: A ${usd(lmp('A'))}, B ${usd(lmp('B'))}, C ${usd(lmp('C'))} per MWh. Congestion rent ${usd(r.congestionRent)} an hour.`}
        />
        <MoneyBar paidA={paidA} paidB={paidB} rent={Math.max(0, loadPays - paidA - paidB)} />
        <Legend
          items={[
            { label: 'paid to A', color: PAY.A },
            { label: 'paid to B', color: PAY.B },
            { label: 'congestion rent', color: PAY.rent },
          ]}
        />
        <Slider label="Demand at C" tone="orange" value={demand} min={100} max={600} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
        <Slider label="Limit on line A–C" value={limit} min={210} max={500} step={10} onChange={(v) => s.set({ limit: v })} display={mw(limit)} />
        <DataTable
          caption="Each line’s share of the congestion rent"
          rows={lines}
          rowKey={(l) => l.id}
          rowClass={(l) => (l.id === 'AC' && congested ? 'hl' : '')}
          columns={[
            { label: 'Line', cell: (l) => `${l.id[0]}–${l.id[1]}` },
            { label: 'Flow', cell: (l) => mw(Math.abs(l.flow)) },
            { label: 'Price where it arrives, minus where it leaves', cell: (l) => usd(l.spread) },
            { label: 'Rent per hour', cell: (l) => usd(l.rent) },
          ]}
          footer={['Total', '', '', usd(lines.reduce((t, l) => t + l.rent, 0))]}
        />
      </Figure>

      <P>
        With the line limited to 250 MW, it isn’t full below about 375 MW of demand: every node has the same price, and loads pay exactly what generators receive. Push
        demand past that point and a gap opens. The starting values are the hour we settled in <a href={lessonHref('5.3')}>Lesson 5.3</a>: loads pay{' '}
        {usd(450 * D0.lmp.C)} an hour, A receives {usd(D0_PAID_A)} and B {usd(D0_PAID_B)}, and {usd(D0.congestionRent)} is left over.
      </P>
      <P>
        The table shows where it comes from. Think of each line as buying power at the node it leaves and selling it at the node it arrives at. Every megawatt that flows
        from a cheap node to an expensive one earns the price difference, and the three lines’ earnings add up exactly to the rent. A line’s share can even be negative.
        Keep the limit at 250 MW and push demand above 500 MW: B now produces more than A, so more of B’s output takes the long way to C, through A, than A’s takes
        through B, and line A–B carries power from B’s ${B_OFFER} node to A’s ${A_OFFER} one. It buys high and sells low, and at {mw(600)} its share is{' '}
        {usd(D600_AB.rent)} an hour. The total doesn’t change, though: whatever A–B loses, B–C, now carrying more of B’s output, gains. All of it traces back to the one full
        line. Its shadow price μ, from Lesson 5.3, is how much the cheapest dispatch would save each hour with one more megawatt of capacity on A–C:{' '}
        {usd(D0_SHADOW)} at the starting values. The rent is the shadow price times the line’s limit:
      </P>
      <Eq label="Congestion rent equals the shadow price of the full line times its limit">
        <K c="price">rent</K>
        <Op>=</Op>
        <span>
          μ<Sub>A–C</Sub>
        </span>
        <Op>×</Op>
        <span>limit</span>
        <Op>=</Op>
        <Tn tone="green">{congested ? usd(shadow) : '$0'}</Tn>
        <Op>×</Op>
        <span>{mw(limit)}</span>
        <Op>=</Op>
        <K c="price">{usd(congested ? shadow * limit : 0)}</K>
      </Eq>
      <P>
        So the rent isn’t a fee anyone chose. It’s the value of the scarce transmission capacity, collected automatically by charging each node its own marginal cost.
      </P>

      <H2>Who the rent belongs to</H2>
      <P>
        The grid operator can’t simply keep it. An operator that profited from congestion would have every reason to let lines fill up. In the US markets with nodal
        prices, the rent is handed back through <b>financial transmission rights</b>. An FTR is a contract between a source node and a sink node, for a fixed number of
        megawatts. Every hour, it pays its holder
      </P>
      <Eq label="FTR payout equals megawatts times the price at the sink minus the price at the source">
        <span>payout</span>
        <Op>=</Op>
        <span>MW</span>
        <Op>×</Op>
        <Op>(</Op>
        <K c="price">
          LMP<Sub>sink</Sub>
        </K>
        <Op>−</Op>
        <K c="price">
          LMP<Sub>source</Sub>
        </K>
        <Op>)</Op>
      </Eq>
      <P>
        and the congestion rent is what pays for it. Markets differ in the name — PJM and MISO call them FTRs, California and Texas call them congestion revenue rights
        (CRRs), and New York calls them transmission congestion contracts (TCCs) — and in the details, but the idea is the same. The rights, or the proceeds from
        auctioning them, generally go to the utilities and customers who pay for the transmission network, so the rent finds its way back to them.
      </P>
      <P>
        Rights are also bought and sold, and the reason a hedger wants one is that it
        cancels congestion risk. Suppose a retailer serves customers at C and has a contract with the
        owner of generator A: {CONTRACT_MW} MW at ${CONTRACT_PRICE} per megawatt-hour, settled against A’s market price. That fixes what the retailer pays for power at A.
        But its customers are at C, and in a nodal market it has to buy their power at C’s price. Whenever A–C is congested, the retailer pays the difference between C and
        A on top of its contract price. The retailer’s {CONTRACT_MW} MW stays the same in every hour; in the next chart, the total demand at C stands in for how
        congested the hour turns out. Choose how many megawatts of FTRs from A to C it should hold:
      </P>

      <Figure name="Congestion Rights Simulator · hedging" scenario={h}>
        <Legend
          items={[
            { label: 'Cost per MWh without FTRs', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Cost per MWh with your FTRs', color: '#6d9c37', kind: 'line' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 600 262"
          role="img"
          aria-label={`The retailer’s cost per megawatt-hour as demand at C varies. With ${h.state.ftr} MW of FTRs it ranges from ${usd(Math.min(...costs), 2)} to ${usd(Math.max(...costs), 2)}.`}
        >
          <text className="ax" x={60} y={22}>
            Retailer’s cost, $ per MWh of its contract
          </text>
          <GridY y={HY} ticks={[-40, -20, 0, 20, 40, 60, 80, 100]} x0={60} x1={580} format={(v) => (v < 0 ? '−$' + -v : '$' + v)} baseline={0} />
          {[100, 200, 300, 400, 500, 600].map((d) => (
            <text key={d} className="ax ax-m" x={HX(d)} y={240}>
              {d}
            </text>
          ))}
          <text className="ax ax-e" x={580} y={258}>
            Demand at C, MW
          </text>
          <path d={stepLine(DEMANDS.map(HX), bare.map(HY))} fill="none" stroke="#9a9a9a" strokeWidth={2} strokeDasharray="7 5" />
          <path d={stepLine(DEMANDS.map(HX), costs.map(HY))} fill="none" stroke="#6d9c37" strokeWidth={4} strokeLinejoin="round" />
          <line x1={60} x2={580} y1={HY(RETAIL_PRICE)} y2={HY(RETAIL_PRICE)} stroke="#3f7a1e" strokeWidth={1.5} strokeDasharray="2 4" />
          <text x={64} y={HY(RETAIL_PRICE) - 6} style={{ fontSize: 12, fill: '#3f7a1e', fontWeight: 500 }}>
            retail price ${RETAIL_PRICE}
          </text>
          <line className="cur" x1={HX(h.state.demand)} x2={HX(h.state.demand)} y1={36} y2={220} />
          <circle cx={HX(h.state.demand)} cy={HY(hCost)} r={6} fill="#6d9c37" stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Readouts
          items={[
            { label: 'price at A', value: usd(hr.lmp.A) },
            { label: 'price at C', value: usd(hr.lmp.C) },
            { label: 'FTR payout per hour', value: usd(ftrPay), tone: 'green' },
            { label: 'retailer’s cost per MWh', value: usd(hCost, 2), tone: 'green' },
          ]}
        />
        <Slider label="FTRs from A to C" tone="green" value={h.state.ftr} min={0} max={400} step={10} onChange={(v) => h.set({ ftr: v })} display={mw(h.state.ftr)} />
        <Slider label="Demand at C" tone="orange" value={h.state.demand} min={100} max={600} step={10} onChange={(v) => h.set({ demand: v })} display={mw(h.state.demand)} />
      </Figure>

      <Challenge
        id="a"
        question={`The retailer sells to its customers at a fixed $${RETAIL_PRICE} per megawatt-hour. Rights cost money at auction, so it wants as few as it can get away with. What is the smallest number of FTRs from A to C that guarantees it never pays more than $${RETAIL_PRICE}, whatever the demand? Work it out from the payout formula, then set it to check.`}
        solved={hedgeOk}
        status={
          worstCost > RETAIL_PRICE + 1e-6
            ? `With ${mw(h.state.ftr)} of FTRs, the retailer pays up to ${usd(worstCost, 2)} per megawatt-hour: more than its customers pay.`
            : `With ${mw(h.state.ftr)} of FTRs, the retailer never pays more than ${usd(RETAIL_PRICE)}, but fewer rights would do.`
        }
        success={`Solved. In a congested hour C’s price is ${usd(D0_SPREAD)} above A’s, and each megawatt of rights pays that ${usd(D0_SPREAD)}. The retailer can afford to leave (${usd(RETAIL_PRICE)} − ${usd(CONTRACT_PRICE)}) × ${CONTRACT_MW} ÷ ${usd(D0_SPREAD)} = ${mw(((RETAIL_PRICE - CONTRACT_PRICE) * CONTRACT_MW) / D0_SPREAD)} of its contract unhedged, so it needs ${mw(h.state.ftr)} of rights.`}
      />

      <P>
        Without rights, the retailer’s cost jumps from ${CONTRACT_PRICE} to ${CONTRACT_PRICE + D0_SPREAD} the moment the line fills. Hold exactly its {mw(CONTRACT_MW)},
        and its cost is ${CONTRACT_PRICE} whatever happens on the line: the rights pay {CONTRACT_MW} × (LMP at C − LMP at A) every hour, exactly the extra it pays for
        buying its {mw(CONTRACT_MW)} at C rather than at A. With fewer FTRs than its contract, it’s partly exposed. With more, it’s no longer hedging but betting: it
        profits from congestion and its cost falls below its contract price. FTRs are usually obligations, so a right whose sink ends up cheaper than its source pays
        out a negative amount, and the holder owes the difference.
      </P>
      <P>
        A retailer that hasn’t been allocated rights has to buy them. They’re sold in
        auctions held a month, a season or a year ahead, and a right’s price reflects how much congestion bidders expect along its path. The retailer swaps an uncertain
        congestion bill for a known price paid up front.
      </P>

      <H2>Can the rent always pay?</H2>
      <P>
        Nothing so far stops an operator from selling 1,000 MW of rights from A to C on a line rated for 250. If it did, the payouts would dwarf the rent. The rule that
        prevents this is <b>simultaneous feasibility</b>: imagine every FTR as a real injection of its megawatts at the source and withdrawal at the sink. If the grid
        could carry all of those transfers at once without exceeding any limit, the set of rights is feasible, and it can be shown that the rent will always cover the
        payouts on that grid, whatever demand and offers turn out to be. The reason is that a set of rights is owed, in total, each full line’s shadow
        price times the flow the rights would put on that line, while the rent is each full line’s shadow price times its limit. A feasible set can’t put more on any
        line than its limit, so it can’t be owed more than the rent.
      </P>
      <P>
        In the next demonstration, the operator has sold rights from A to C and from B to C against a model of the grid with A–C at {AUCTION_LIMIT} MW. Demand at C is {ADEQ_DEMAND} MW. The
        white region contains the sets of rights the grid can actually carry on the day. Change the rights, then change the line’s actual limit on the day:
      </P>

      <Figure name="Congestion Rights Simulator · revenue adequacy" scenario={q}>
        <svg
          className="chart"
          viewBox="0 0 600 330"
          role="img"
          aria-label={`Rights from A to C, ${q.state.fA} MW, and from B to C, ${q.state.fB} MW. They would put ${fmt(implied)} MW on line A–C, whose limit on the day is ${q.state.dayLimit} MW. Payouts ${usd(settle.totalPayout)}, rent ${usd(settle.rent)}.`}
        >
          <rect x={FX(0)} y={FY(500)} width={FX(500) - FX(0)} height={FY(0) - FY(500)} fill="#f3dfdc" />
          {dayPoly.length > 0 && <path d={'M' + dayPoly.map((p) => `${FX(p[0])} ${FY(p[1])}`).join(' L') + ' Z'} fill="#fbfbf7" stroke="#6d9c37" strokeWidth={2} />}
          {auctionEdge && q.state.dayLimit !== AUCTION_LIMIT && (
            <line x1={FX(auctionEdge[0][0])} y1={FY(auctionEdge[0][1])} x2={FX(auctionEdge[1][0])} y2={FY(auctionEdge[1][1])} stroke="#777" strokeWidth={1.5} strokeDasharray="6 4" />
          )}
          {dayEdge && (
            <line x1={FX(dayEdge[0][0])} y1={FY(dayEdge[0][1])} x2={FX(dayEdge[1][0])} y2={FY(dayEdge[1][1])} stroke="#b8302a" strokeWidth={2} />
          )}
          {[0, 100, 200, 300, 400, 500].map((t) => (
            <g key={t}>
              <text className="ax ax-m" x={FX(t)} y={308}>
                {t}
              </text>
              <text className="ax ax-e" x={FX(0) - 8} y={FY(t) + 4}>
                {t}
              </text>
            </g>
          ))}
          <text className="ax" x={FX(0)} y={18}>
            Rights from B to C, MW
          </text>
          <text className="ax ax-e" x={FX(500)} y={326}>
            Rights from A to C, MW
          </text>
          <circle cx={FX(q.state.fA)} cy={FY(q.state.fB)} r={7} fill={fits ? '#d0702a' : '#f8f8f8'} stroke="#d0702a" strokeWidth={3} />
          <g>
            <text x={360} y={60} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
              On the day
            </text>
            <text x={360} y={84} className="ax">
              rights would put {fmt(implied)} MW on A–C
            </text>
            <text x={360} y={102} className="ax">
              A–C can carry {q.state.dayLimit} MW
            </text>
            <rect x={360} y={122} width={200 * Math.min(1, settle.rent / Math.max(settle.rent, settle.totalPayout, 1))} height={18} fill={PAY.rent} />
            <text x={360} y={156} className="ax">
              congestion rent {usd(settle.rent)}
            </text>
            <rect
              x={360}
              y={170}
              width={200 * Math.min(1, settle.totalPayout / Math.max(settle.rent, settle.totalPayout, 1))}
              height={18}
              fill={settle.adequate ? '#4590ce' : '#e75b55'}
            />
            <text x={360} y={204} className="ax">
              owed to FTR holders {usd(settle.totalPayout)}
            </text>
            <text x={360} y={236} style={{ fontSize: 13, fontWeight: 500, fill: settle.adequate ? '#3f7a1e' : '#c4382f' }}>
              {settle.surplus >= -0.5 ? `${usd(settle.surplus)} left over` : `${usd(-settle.surplus)} short`}
            </text>
          </g>
        </svg>
        <Legend
          items={[
            { label: `A–C at its limit on the day`, color: '#b8302a', kind: 'line' },
            { label: `A–C at ${AUCTION_LIMIT} MW, as the auction assumed`, color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <Slider label="Rights from A to C" tone="blue" value={q.state.fA} min={0} max={500} step={10} onChange={(v) => q.set({ fA: v })} display={mw(q.state.fA)} />
        <Slider label="Rights from B to C" tone="violet" value={q.state.fB} min={0} max={500} step={10} onChange={(v) => q.set({ fB: v })} display={mw(q.state.fB)} />
        <Slider label="Limit on A–C on the day" value={q.state.dayLimit} min={160} max={350} step={10} onChange={(v) => q.set({ dayLimit: v })} display={mw(q.state.dayLimit)} />
        <Caption>
          {!dayCongested
            ? 'A–C isn’t full on the day, so all three prices are equal: there is no rent, and the rights pay nothing.'
            : fits
              ? `The rights fit within the day’s grid, so the rent covers them${settle.surplus > 0.5 ? ', with money to spare' : ' exactly'}.`
              : 'The rights would put more on A–C than it can carry on the day, so they’re owed more than the rent can pay.'}
        </Caption>
      </Figure>

      <P>
        The starting rights, 300 MW from A and 150 MW from B, are exactly the transfers that actually happen at this demand, and they put exactly 250 MW on A–C. They
        sit on the edge of the white region, and the rent pays them to the dollar. Anywhere inside the region, there’s money left over. Push outside it and the rights are
        owed more than the rent can pay.
      </P>
      <P>
        That’s also what happens when the real grid falls short of the model the auction used. Lower the limit on the day to 200 MW: prices are the same as before, so
        the rights are owed the same {usd(settleFtrs([{ source: 'A', sink: 'C', mw: 300 }, { source: 'B', sink: 'C', mw: 150 }], D200.lmp, D200.congestionRent).totalPayout)},
        but with less power crossing A–C the rent is only {usd(D200.congestionRent)}. Outages and line derates do exactly this, which is why rights are sometimes paid
        less than their full value; PJM’s, for example, were underfunded in several years in the early 2010s.
      </P>
      <P>
        Congestion is what makes prices differ across space: the same hour, different places. The <a href={lessonHref('5.5')}>next lesson</a> turns to prices that differ
        wildly across time, when there is too little electricity to go around, or far too much.
      </P>
    </LessonPage>
  );
}
