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
  SupplyStackChart,
  TEXT,
  lessonHref,
  linePath,
  mw,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
  type StackBlock,
} from '../../framework';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { SYSTEM_DEMAND } from '../../model/profiles';
import type { Clearing } from '../../engines/market/clearing';
import {
  REFERENCE_HOUR,
  clearWithOffer,
  hourOffers,
  payments,
  profitCurve,
  referenceLevel,
  supplyWithout,
  type OfferResult,
  type PaymentRule,
} from '../../engines/market/marketPower';

const YOU = 'cc2';
const MILL = fleetById(YOU);
const COST = MILL.marginalCost;
const REF = referenceLevel(COST);
const OFFERS = hourOffers(REFERENCE_HOUR);
const DEMAND = SYSTEM_DEMAND[REFERENCE_HOUR];
const OTHERS = supplyWithout(OFFERS, YOU);
const GRID = Array.from({ length: 201 }, (_, i) => i);
const X_MAX = 2000;
const NAME: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name]));
const COLOR: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, FUEL[g.fuel]]));
const price$ = (p: number) => usd(p, Number.isInteger(Math.round(p * 100) / 100) ? 0 : 2);

const RULES: Array<{ value: PaymentRule; label: string }> = [
  { value: 'uniform', label: 'Pay-as-clear' },
  { value: 'payAsBid', label: 'Pay-as-bid, cost offers' },
  { value: 'payAsBidGuess', label: 'Pay-as-bid, offers at $42' },
];

/** Mill Creek's profit for every offer on the grid, with the current offer marked. */
function ProfitChart({ curve, without, result, demand }: { curve: OfferResult[]; without?: OfferResult[]; result: OfferResult; demand: number }) {
  const x = scale(0, 200, 64, 604);
  const values = [...curve, ...(without ?? [])].map((r) => r.profit);
  const [lo, hi] = niceDomain(Math.min(0, ...values), Math.max(1000, ...values), 3);
  const y = scale(lo, hi, 120, 24);
  const path = (c: OfferResult[]) =>
    linePath(
      c.map((r) => x(r.offer)),
      c.map((r) => y(r.profit)),
    );
  const top = Math.max(...curve.map((r) => r.profit));
  const bestOffers = curve.filter((r) => r.profit >= top - 1e-6).map((r) => r.offer);
  const where = bestOffers.length > 1 ? `at any offer from ${usd(bestOffers[0])} to ${usd(bestOffers[bestOffers.length - 1])}` : `at an offer of ${usd(bestOffers[0])}`;
  return (
    <svg
      className="chart"
      viewBox="0 0 620 144"
      role="img"
      aria-label={`Mill Creek’s profit at ${mw(demand)} of demand for every offer from $0 to $200${without ? ', with the market monitor on' : ''}. The most it can earn is ${usd(top)}, ${where}; its offer of ${usd(result.offer)} earns ${usd(result.profit)}.`}
    >
      <text className="ax" x={64} y={12}>
        Mill Creek’s profit this hour, by offer
      </text>
      {without && (
        <g>
          <line x1={430} x2={452} y1={8} y2={8} stroke="#9a9a9a" strokeWidth={2} strokeDasharray="5 4" />
          <text className="ax" x={458} y={12}>
            without the monitor
          </text>
        </g>
      )}
      <GridY y={y} ticks={niceTicks(lo, hi, 3)} x0={64} x1={604} format={(v) => usd(v)} baseline={0} />
      <line x1={x(COST)} x2={x(COST)} y1={24} y2={120} stroke="#9a9a9a" strokeDasharray="2 3" />
      {without && <path d={path(without)} fill="none" stroke="#9a9a9a" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
      <path d={path(curve)} fill="none" stroke={TEXT.green} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={x(result.offer)} x2={x(result.offer)} y1={24} y2={120} />
      <circle cx={x(result.offer)} cy={y(result.profit)} r={6} fill={TEXT.green} stroke="#fcfcfb" strokeWidth={2} />
      {[0, COST, 88, 165, 200].map((v) => (
        <text key={v} className={v === 200 ? 'ax ax-e' : 'ax ax-m'} x={v === 200 ? x(v) + 4 : x(v)} y={138}>
          {v === COST ? `$${v} cost` : v === 200 ? `$${v} offer` : `$${v}`}
        </text>
      ))}
    </svg>
  );
}

function blocksOf(c: Clearing, offers: Array<{ id: string; mw: number; price: number }>, extra: (id: string, q: number) => Partial<StackBlock>): StackBlock[] {
  return c.stack.map((s) => {
    const o = offers.find((x) => x.id === s.id)!;
    const q = c.dispatch[s.id] ?? 0;
    return { id: s.id, start: s.start, mw: o.mw, price: o.price, dispatched: q, color: COLOR[s.id], ...extra(s.id, q) };
  });
}

export default function Lesson() {
  const s1 = useScenario('payment-rule', { rule: 'uniform' as PaymentRule });
  const s2 = useScenario('your-plant', { offer: COST, demand: DEMAND, monitor: 'off' as 'off' | 'on' });

  // Figure 1: one hour, three ways of paying for it.
  const rule = s1.state.rule;
  const pay = payments(OFFERS, DEMAND, rule);
  const uniform = rule === 'uniform';
  const blocks1 = blocksOf(pay.clearing, pay.offers, (id, q) => {
    const cost = OFFERS.find((o) => o.id === id)!.price;
    if (uniform) return q > 0 ? { margin: { from: cost, to: pay.clearing.price } } : {};
    if (rule === 'payAsBidGuess' && q > 0 && cost < pay.clearing.price) return { costMark: cost };
    return {};
  });
  const cap1 =
    rule === 'uniform'
      ? `Every plant that runs is paid Mill Creek’s ${usd(pay.clearing.price)}. The hatched margins, ${usd(pay.bill - pay.runningCost)} in all, are what the plants earn above their offers.`
      : rule === 'payAsBid'
        ? 'Each plant is paid its own offer. With offers at cost, no plant earns anything above its running cost, so none of them would keep offering this way.'
        : `Each plant that runs has raised its offer to the ${usd(pay.clearing.price)} it expects the price to be, and is paid that. The dashed lines are what the plants really cost.`;

  // Figure 2: Mill Creek's offer.
  const { offer, demand } = s2.state;
  const monitor = s2.state.monitor === 'on';
  const r = clearWithOffer(OFFERS, YOU, COST, offer, demand, monitor);
  const unmitigated = clearWithOffer(OFFERS, YOU, COST, offer, demand, false);
  const curve = useMemo(() => profitCurve(OFFERS, YOU, COST, demand, GRID, monitor), [demand, monitor]);
  const without = useMemo(() => (monitor ? profitCurve(OFFERS, YOU, COST, demand, GRID, false) : undefined), [demand, monitor]);
  const q = r.dispatch;
  const full = q >= MILL.capacity - 1e-6;
  const setter = r.clearing.marginal;
  const blocks2 = blocksOf(r.clearing, withApplied(r.applied), (id, dq) =>
    id === YOU ? { label: 'You', highlight: true, costMark: COST, margin: dq > 0 ? { from: COST, to: r.price } : undefined } : {},
  );

  const setterName = NAME[setter ?? ''] ?? 'another plant';
  let msg: string;
  if (q <= 1e-6) msg = `At ${usd(offer)}, Mill Creek isn’t needed: ${setterName} sets the price at ${price$(r.price)}.`;
  else if (setter === YOU) msg = `Mill Creek is the marginal plant: it runs ${mw(q)} and sets the price at ${price$(r.price)}.`;
  else msg = `Mill Creek runs flat out; ${setterName} sets the price at ${price$(r.price)}.`;
  if (r.profit < -0.5) msg += ` It loses ${usd(-r.profit)} this hour.`;
  if (r.mitigated)
    msg = `The monitor replaced the ${usd(offer)} offer with ${usd(REF, 2)}, ${r.pivotal ? 'because Mill Creek is pivotal' : `since it would have raised the price to ${price$(unmitigated.price)}`}. ${msg}`;
  else if (r.pivotal) msg += ` Mill Creek is pivotal: the rest of the region can supply only ${mw(OTHERS)}.`;

  // Challenge: the highest offer that still runs Mill Creek flat out, once another plant sets the price.
  const atCost = clearWithOffer(OFFERS, YOU, COST, COST, demand, false);
  const fullAtCost = atCost.dispatch >= MILL.capacity - 1e-6;
  const next = clearWithOffer(OFFERS, YOU, COST, offer + 1, demand, false);
  const solved = !monitor && fullAtCost && full && next.dispatch < MILL.capacity - 1e-6;
  const status = monitor
    ? 'Switch the market monitor off first: with it on, the operator may not be using your offer at all.'
    : !fullAtCost
      ? `At ${mw(demand)}, an offer at cost runs ${mw(atCost.dispatch)} of Mill Creek’s 250 MW. Raise demand.`
      : !full
        ? `At ${usd(offer)}, Mill Creek runs only ${mw(q)}.`
        : `At ${usd(offer)}, Mill Creek still runs flat out. Could it ask for more?`;

  return (
    <LessonPage id="4.4">
      <P>
        <a href={lessonHref('4.3')}>Lesson 4.3</a> built the region’s supply stack: every plant’s offer, cheapest first, with the operator working its way up until demand
        is met. Two questions are left. What does the operator pay the plants it accepts? And once their owners know the answer, what will they offer?
      </P>
      <P>
        We’ll answer both in a single hour: 19:00 on the reference day, the evening peak. Customers need {mw(DEMAND)}, Ridge wind is producing{' '}
        {mw(OFFERS.find((o) => o.id === 'wind')!.mw)} and Valley solar nothing. Working up the stack, the operator takes everything Ridge wind, Harbor Point, Falls hydro,
        Ironwood and Lakeside can give, then 50 MW of Mill Creek’s 250. Mill Creek is the marginal plant, so the <K c="price">clearing price</K> is its offer, $42 per
        megawatt-hour — with 200 MW of Mill Creek to spare, exactly what one more megawatt-hour would cost.
      </P>
      <P>
        In most wholesale markets, every plant that runs is paid that one price, whatever it offered. This is <b>uniform pricing</b>, also called pay-as-clear. Here is the
        hour, with what each plant earns above its offer hatched in green. Switch the payment rule:
      </P>

      <Figure name="Market Clearing Simulator" scenario={s1}>
        <Segmented label="Payment rule" value={rule} onChange={(v) => s1.set({ rule: v })} options={RULES} />
        <SupplyStackChart
          ariaLabel={`Supply stack at 19:00 on the reference day: ${mw(DEMAND)} of demand, met by the region’s plants with Mill Creek marginal at $42. Under ${RULES.find((x) => x.value === rule)!.label.toLowerCase()}, consumers pay ${usd(pay.bill)} for the hour.`}
          blocks={blocks1}
          demand={DEMAND}
          price={uniform ? pay.clearing.price : undefined}
          xMax={X_MAX}
          yMax={200}
        />
        <Readouts
          items={[
            { label: 'consumers pay this hour', value: usd(pay.bill), tone: 'green' },
            { label: uniform ? 'price paid for every MWh' : 'average paid per MWh', value: price$(pay.bill / DEMAND), tone: 'green' },
            { label: 'plants’ running cost', value: usd(pay.runningCost), tone: 'green' },
          ]}
        />
        <Caption>{cap1}</Caption>
      </Figure>

      <P>
        Uniform pricing can look wasteful. Harbor Point offered $9 and is paid $42, so it earns $13,200 this hour above what it asked, and consumers pay $60,480 in all.
        Paying each plant its own offer instead — <b>pay-as-bid</b> — would cut the bill to $31,500, if the offers stayed the same. They wouldn’t. Under pay-as-bid, an
        offer at cost never earns anything above cost, so every owner would offer its best guess of the clearing price instead. Choose the third rule: with every plant
        that runs asking $42, the bill is back to $60,480. Nothing is saved, and something is lost. The offers no longer say what the plants cost, so the operator can
        no longer be sure it’s running the cheapest ones.
      </P>

      <H2>Your offer</H2>
      <P>
        Under uniform pricing, a plant’s offer usually doesn’t set what it’s paid — the marginal plant’s offer does. What it decides is whether, and how much, the plant runs. To
        see what that does to an owner’s choices, suppose you own Mill Creek, which costs $42 to run per megawatt-hour. In the next demonstration, set Mill Creek’s offer
        and the demand at 19:00, as if the evening were milder or hotter than on the reference day, with the same wind. The small chart plots Mill Creek’s profit for the hour — the clearing price minus its $42 cost, times what it produces — for every offer
        it could make at the current demand; the dot is your offer:
      </P>

      <Figure name="Market Clearing Simulator · your plant" scenario={s2}>
        <Segmented
          label="Offer mitigation"
          value={s2.state.monitor}
          onChange={(v) => s2.set({ monitor: v })}
          options={[
            { value: 'off', label: 'No market monitor' },
            { value: 'on', label: 'Market monitor on' },
          ]}
        />
        <SupplyStackChart
          ariaLabel={`Supply stack at 19:00 with Mill Creek offering ${usd(offer)}${r.mitigated ? `, mitigated to ${usd(REF, 2)}` : ''}. ${mw(demand)} of demand clears at ${price$(r.price)} per MWh; Mill Creek produces ${mw(q)}.`}
          blocks={blocks2}
          demand={demand}
          price={r.price}
          priceLabel={price$(r.price)}
          xMax={X_MAX}
          yMax={200}
        />
        <Slider label="Mill Creek’s offer" tone="green" value={offer} min={0} max={200} onChange={(v) => s2.set({ offer: v })} display={`$${offer} per MWh`} />
        <Slider label="Demand at 19:00" value={demand} min={1300} max={1800} step={10} onChange={(v) => s2.set({ demand: v })} display={mw(demand)} />
        <ProfitChart curve={curve} without={without} result={r} demand={demand} />
        <Readouts
          items={[
            { label: 'clearing price per MWh', value: price$(r.price), tone: 'green' },
            { label: 'Mill Creek runs', value: mw(q) },
            { label: 'Mill Creek’s profit', value: usd(r.profit), tone: r.profit < -0.5 ? 'red' : 'green' },
            { label: 'consumers pay', value: usd(r.price * demand), tone: 'green' },
          ]}
        />
        <Caption>{msg}</Caption>
      </Figure>

      <P>
        Start at the reference day’s 1,440 MW. Mill Creek is the marginal plant, and an offer at cost earns nothing: it’s paid exactly what it spends. Raise the offer,
        though, and the price rises with it — for everyone. Offer $88 and Mill Creek earns $2,300 on its 50 MW, while consumers pay $66,240 more for the hour; the other
        $63,940 goes to plants that were running anyway. A dollar more and Eastgate’s $88 is the cheaper offer, so Eastgate takes Mill Creek’s 50 MW and Mill Creek
        earns nothing. (Offering below Lakeside’s $36 is worse still: Mill Creek then runs flat out at Lakeside’s price and loses $1,500 an hour.) Being able to raise
        the price you’re paid by changing your offer is called <b>market power</b>.
      </P>
      <P>
        Now raise demand to 1,650 MW. Mill Creek runs flat out, Eastgate is the marginal plant, and the curve goes flat: every offer up to $88 earns the same $11,500,
        because Mill Creek’s offer no longer touches the price. Above $88, Eastgate runs first and Mill Creek keeps only the 60 MW Eastgate can’t cover. This is why
        uniform pricing gets honest offers. An owner never knows exactly where demand will land, and an offer at cost is the one that can never lose: the plant runs
        whenever the price covers its cost and never when it doesn’t. And in an hour like this one, when another plant sets the price, nothing earns more.
      </P>
      <P>
        Keep going past {mw(OTHERS)}, all the rest of the fleet can produce at 19:00. Beyond it, demand can’t be met without Mill Creek: the plant is <b>pivotal</b>.
        Some of it must run whatever it offers, and its profit keeps climbing at the right-hand edge of the chart and beyond. Only the market’s offer cap would stop it.
      </P>

      <H2>The market monitor</H2>
      <P>
        Market power is why every ISO has an independent <b>market monitor</b>, and why most have rules for <b>offer mitigation</b>. Each plant has a{' '}
        <b>reference level</b>: an estimate of its running cost plus an allowance, typically about 10%, for whatever the estimate misses — {usd(REF, 2)} for Mill Creek.
        When a test finds that a plant has market power, the operator clears the market on the reference level instead of the offer. PJM, the largest American market,
        applies a <b>three-pivotal-supplier test</b> wherever its grid is congested: if the area’s demand can’t be met without its three largest suppliers together, their
        offers are replaced. New York’s and New England’s operators use a <b>conduct-and-impact test</b>: an offer is replaced if it is well above its reference level
        (conduct) and it raises the price by a lot (impact).
      </P>
      <P>
        Our monitor uses a version of each in its simplest form: it replaces Mill Creek’s offer if Mill Creek alone is pivotal, or if the offer is above{' '}
        {usd(REF, 2)} and raises the price at all. Switch it on in this demonstration. At 1,440 MW, the curve now stops climbing at $210 an hour, what Mill Creek earns at its
        reference level. Past {mw(OTHERS)} it flattens at $11,500, what Mill Creek earns by offering its cost — and at 1,650 MW the same flat line now runs all the way
        across, since no offer up to $88 touches the price and any higher one is replaced. Real tests leave more room before they act, but the aim is the same: a plant
        that could set its own price is paid as if it couldn’t.
      </P>

      <Challenge
        id="a"
        figure="Market Clearing Simulator · your plant"
        question="With the market monitor off, raise demand until Mill Creek runs flat out when it offers its cost. Then find the highest offer at which it still runs at full output."
        solved={solved}
        status={status}
        success={`Solved. Up to $88, Eastgate’s own offer, Mill Creek is no dearer than Eastgate, so the operator takes all 250 MW before turning to Eastgate. A dollar more and Eastgate runs first, leaving Mill Creek ${mw(next.dispatch)}. The answer was in the stack: it’s the next plant’s offer. With the monitor on, an offer above $88 would raise the price, so it would be replaced by ${usd(REF, 2)} instead.`}
      />

      <P>
        One more check on market power is missing from our model. In this course demand is fixed — the operator must meet all of it, at any price — but real markets
        also let some buyers bid, the demand response of <a href={lessonHref('3.5')}>Lesson 3.5</a>, and every megawatt that steps back as the price climbs is one a
        pivotal plant can no longer count on.
      </P>
      <P>
        Our auction is idealized in another way, too. It ran once, for one hour, on demand we knew exactly. Real markets run it a day ahead, on forecasts of demand and
        weather, and then again in real time as the hour actually arrives. How those two auctions fit together is the subject of{' '}
        <a href={lessonHref('4.5')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}

/** The region's offers with Mill Creek's replaced by the one the operator cleared on. */
function withApplied(applied: number) {
  return OFFERS.map((o) => (o.id === YOU ? { ...o, price: applied } : o));
}
