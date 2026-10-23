import {
  Challenge,
  DataTable,
  Eq,
  Figure,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Caption,
  Segmented,
  Slider,
  SupplyStackChart,
  Swatch,
  Tn,
  mw,
  usd,
  useScenario,
  type StackBlock,
} from '../../framework';
import { clearMeritOrder, type Clearing } from '../../engines/market/clearing';

interface Plant {
  id: string;
  name: string;
  mw: number;
  cost: number;
  color: string;
}

// An illustrative eight-plant market.
const PLANTS: Plant[] = [
  { id: 'ren', name: 'Wind & solar', mw: 300, cost: 0, color: '#4bafa7' },
  { id: 'nuc', name: 'Nuclear', mw: 300, cost: 8, color: '#ab70b6' },
  { id: 'coal', name: 'Coal', mw: 200, cost: 27, color: '#8d7b6a' },
  { id: 'cc1', name: 'Gas combined-cycle 1', mw: 300, cost: 34, color: '#e48850' },
  { id: 'cc2', name: 'Gas combined-cycle 2', mw: 100, cost: 38, color: '#f0a573' },
  { id: 'cc3', name: 'Gas combined-cycle 3', mw: 250, cost: 46, color: '#cf6f30' },
  { id: 'pk', name: 'Gas peaker', mw: 150, cost: 85, color: '#e75b55' },
  { id: 'oil', name: 'Oil peaker', mw: 80, cost: 160, color: '#a8403b' },
];
const TOTAL = PLANTS.reduce((s, p) => s + p.mw, 0);
const YOU = 'cc2';

function blocks(c: Clearing, offers: Record<string, number>, rule: 'uniform' | 'payAsBid', you?: string): StackBlock[] {
  return c.stack.map((s) => {
    const p = PLANTS.find((x) => x.id === s.id)!;
    const isYou = s.id === you;
    const paid = rule === 'uniform' ? c.price : offers[s.id];
    const showMargin = isYou || rule === 'uniform';
    return {
      id: s.id,
      start: s.start,
      mw: p.mw,
      price: offers[s.id],
      dispatched: c.dispatch[s.id],
      color: p.color,
      label: isYou ? 'You' : undefined,
      highlight: isYou,
      costMark: isYou ? p.cost : undefined,
      margin: showMargin ? { from: isYou ? p.cost : offers[s.id], to: paid } : undefined,
    };
  });
}

export default function Lesson() {
  const s1 = useScenario('clearing', { demand: 1250 });
  const s2 = useScenario('your-plant', { demand: 1250, offer: 38, rule: 'uniform' as 'uniform' | 'payAsBid' });

  const costs: Record<string, number> = Object.fromEntries(PLANTS.map((p) => [p.id, p.cost]));
  const c1 = clearMeritOrder(
    PLANTS.map((p) => ({ id: p.id, mw: p.mw, price: p.cost })),
    s1.state.demand,
  );
  const marg1 = PLANTS.find((p) => p.id === c1.marginal);
  const rows = c1.stack.map((s) => {
    const p = PLANTS.find((x) => x.id === s.id)!;
    const q = c1.dispatch[p.id];
    return { p, q, profit: (c1.price - p.cost) * q };
  });

  const offers2: Record<string, number> = { ...costs, [YOU]: s2.state.offer };
  const c2 = clearMeritOrder(
    PLANTS.map((p) => ({ id: p.id, mw: p.mw, price: offers2[p.id] })),
    s2.state.demand,
  );
  const q = c2.dispatch[YOU];
  const paid = s2.state.rule === 'uniform' ? c2.price : s2.state.offer;
  const profit = q > 0 ? (paid - 38) * q : 0;
  const profitTone = profit < 0 ? 'red' : profit > 0 ? 'green' : 'ink';
  let msg: string;
  if (q <= 0) msg = `Your offer of $${s2.state.offer} is above the clearing price of $${c2.price}, so the operator doesn’t need you this hour. You produce nothing and earn nothing.`;
  else if (s2.state.rule === 'uniform') {
    msg = `You’re dispatched for ${Math.round(q)} MW and paid the clearing price of $${c2.price} per MWh, like everyone else.`;
    if (c2.marginal === YOU) msg += ' Your offer is the marginal one, so you’re setting that price.';
    if (profit < 0) msg += ' That’s less than your cost, so this hour loses money.';
  } else {
    msg = `You’re dispatched for ${Math.round(q)} MW and paid your own offer of $${s2.state.offer} per MWh.`;
    if (profit <= 0) msg += ' At that price you only cover your costs, or worse.';
  }

  const solved = c1.marginal === 'pk' && s1.state.demand <= 1460;

  return (
    <LessonPage id="4.4">
      <P>
        In the previous lesson, every generator submitted an offer for the coming hour: a quantity of power, and the lowest price at which it’s willing to produce it. The
        grid operator now has to make two decisions — which offers to accept, and how much to pay for them.
      </P>
      <P>
        The first decision is straightforward. Accepting the cheapest offers first minimizes the total cost of meeting demand, so the operator sorts every offer by price
        and stacks them from left to right. Each block’s width is a plant’s capacity, and its height is the plant’s offer. This staircase is the supply curve — what the
        industry calls the merit order. Drag the slider to change the demand the operator has to meet:
      </P>

      <Figure name="Market Clearing Simulator" scenario={s1}>
        <SupplyStackChart
          ariaLabel={`Supply stack of eight generators. Demand of ${s1.state.demand} MW clears at $${c1.price} per MWh, set by ${marg1?.name ?? 'no one'}.`}
          blocks={blocks(c1, costs, 'uniform')}
          demand={s1.state.demand}
          price={c1.price}
          xMax={TOTAL}
          yMax={180}
        />
        <Slider label="Demand" value={s1.state.demand} min={100} max={1650} step={10} onChange={(v) => s1.set({ demand: v })} display={mw(s1.state.demand)} />
        <Readouts
          items={[
            { label: 'clearing price per MWh', value: usd(c1.price), tone: 'green' },
            { label: 'marginal generator', value: marg1?.name ?? '—' },
            { label: 'paid by consumers per hour', value: usd(c1.price * s1.state.demand) },
          ]}
        />
        <DataTable
          caption="Offers in merit order"
          rows={rows}
          rowKey={(r) => r.p.id}
          rowClass={(r) => (r.p.id === c1.marginal ? 'hl' : r.q > 0 ? '' : 'dim')}
          columns={[
            {
              label: 'Generator',
              cell: (r) => (
                <>
                  <Swatch color={r.p.color} />
                  {r.p.name}
                  {r.p.id === c1.marginal && (
                    <span style={{ marginLeft: 8, fontSize: 12 }}>
                      <Tn tone="green">sets the price</Tn>
                    </span>
                  )}
                </>
              ),
            },
            { label: 'Offer', cell: (r) => usd(r.p.cost) },
            { label: 'Capacity', cell: (r) => mw(r.p.mw) },
            { label: 'Dispatched', cell: (r) => (r.q > 0 ? mw(r.q) : '—') },
            { label: 'Profit per hour', cell: (r) => (r.q > 0 ? usd(r.profit) : '—') },
          ]}
        />
      </Figure>

      <P>
        The second decision is where electricity markets get interesting. Most wholesale markets don’t pay each generator what it offered. Instead, every accepted
        generator is paid the same price: the offer of the last, most expensive unit needed to meet demand. That unit is the <b>marginal generator</b>, and the price it
        sets is the <K c="price">clearing price</K>.
      </P>
      <P>
        Notice that the price doesn’t rise smoothly with demand. It stays flat while one plant gradually ramps up, then jumps whenever demand spills over into the next,
        more expensive block. The hatched areas above each block are the gap between what a plant is paid and what it asked for. Offers usually cover only fuel and
        other running costs, so that margin is what pays for the plants’ construction, staff and debt.
      </P>

      <Challenge
        id="a"
        question="Find the lowest demand at which the gas peaker sets the price."
        solved={solved}
        status={`Right now the price is set by ${marg1 ? marg1.name.toLowerCase() : 'no one'} at $${c1.price} per MWh.`}
        success="Solved. Every offer below the peaker’s $85 adds up to 1,450 MW, so the peaker becomes marginal as soon as demand exceeds 1,450 MW."
      />

      <H2>Why not pay what they offer?</H2>
      <P>
        Paying every generator the same price can look wasteful. Why pay the nuclear plant $46 for energy it offered at $8? The answer lies in how offers would change if
        the rules did. Below, you own the second combined-cycle gas plant: 100 MW that costs you <b>$38</b> to produce each megawatt-hour. Try offering more than your
        cost, and see what happens to your profit:
      </P>

      <Figure name="Market Clearing Simulator · your plant" scenario={s2}>
        <Segmented
          label="Payment rule"
          value={s2.state.rule}
          onChange={(rule) => s2.set({ rule })}
          options={[
            { value: 'uniform', label: 'Pay-as-clear' },
            { value: 'payAsBid', label: 'Pay-as-bid' },
          ]}
        />
        <SupplyStackChart
          ariaLabel={`Supply stack with your plant offering $${s2.state.offer}. Clearing price $${c2.price} per MWh; you produce ${Math.round(q)} MW.`}
          blocks={blocks(c2, offers2, s2.state.rule, YOU)}
          demand={s2.state.demand}
          price={c2.price}
          xMax={TOTAL}
          yMax={180}
        />
        <Slider label="Your offer" tone="orange" value={s2.state.offer} min={0} max={150} onChange={(v) => s2.set({ offer: v })} display={`$${s2.state.offer} per MWh`} />
        <Slider label="Demand" value={s2.state.demand} min={700} max={1650} step={10} onChange={(v) => s2.set({ demand: v })} display={mw(s2.state.demand)} />
        <Readouts
          items={[
            { label: 'clearing price per MWh', value: usd(c2.price), tone: 'green' },
            { label: 'you produce', value: mw(q) },
            { label: 'your profit per hour', value: usd(profit), tone: profitTone },
          ]}
        />
        {q > 0 && (
          <Eq label="Your profit">
            <span>Profit</span>
            <Op>=</Op>
            <Op>(</Op>
            <K c="price">{usd(paid)}</K>
            <Op>−</Op>
            <span>$38</span>
            <Op>)</Op>
            <Op>×</Op>
            <span>{mw(q)}</span>
            <Op>=</Op>
            <Tn tone={profitTone}>{usd(profit)}</Tn>
          </Eq>
        )}
        <Caption>{msg}</Caption>
      </Figure>

      <P>
        Under pay-as-clear, any offer below the clearing price earns exactly the same profit, because someone else sets the price. Offer more than that and you simply
        aren’t needed: another plant takes your place and you earn nothing. Offer less than your cost and you risk running at a loss whenever demand is low — try it.
        Offering your true cost is the one strategy that never loses money and never misses a profitable hour, whatever demand turns out to be.
      </P>
      <P>
        Now switch to pay-as-bid. Offering your cost earns you nothing at all, so you’re pushed to guess the clearing price and offer just beneath it. Every other
        generator faces the same incentive. Prices end up much the same as before, but offers no longer reveal real costs, and the operator can’t be sure it’s running
        the cheapest plants. That loss of information is why most wholesale electricity markets clear at a single marginal price.
      </P>
      <P>
        So far we’ve assumed that a megawatt-hour is worth the same everywhere on the grid, which only holds as long as the wires can carry whatever the cheapest plants
        produce. Chapter 5 drops that assumption.
      </P>
    </LessonPage>
  );
}
