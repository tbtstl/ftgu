import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FUEL,
  Figure,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  SupplyStackChart,
  hour,
  lessonHref,
  mw,
  usd,
  useScenario,
  type StackBlock,
} from '../../framework';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { SYSTEM_DEMAND } from '../../model/profiles';
import { clearMeritOrder, type Clearing } from '../../engines/market/clearing';
import { COST_RECIPE, REFERENCE_FUEL_PRICE, customGasOffer, fleetOffers, offerBreakdown, switchingGasPrice } from '../../engines/market/offerCost';

type HourKey = '3' | '14' | '19';
const HOURS: Array<{ value: HourKey; label: string }> = [
  { value: '3', label: '03:00 · night' },
  { value: '14', label: '14:00 · day' },
  { value: '19', label: '19:00 · peak' },
];

const LAKESIDE = fleetById('cc1');
const IRONWOOD = fleetById('coal');
const GAS_STEP = 0.05;
const NAME: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name]));
const COLOR: Record<string, string> = { ...Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, FUEL[g.fuel]])), you: FUEL.gasCC };

// The reader's plant: 200 MW, $3.50 of O&M, gas at the reference price, added to the 19:00 stack.
const YOUR_HOUR = 19;
const YOUR_MW = 200;
const YOUR_VOM = 3.5;
const HR_STEP = 0.1;
const GAS0 = REFERENCE_FUEL_PRICE.gas;
const FLEET = (h: number) => fleetOffers(h).filter((o) => o.mw > 0.5).map((o) => ({ id: o.id, mw: o.mw, price: o.price }));
const withYou = (h: number, offer: number) => [...FLEET(h), { id: 'you', mw: YOUR_MW, price: offer }];
const WITHOUT_YOU = clearMeritOrder(FLEET(YOUR_HOUR), SYSTEM_DEMAND[YOUR_HOUR]);
const roundHR = (v: number) => Math.round(v * 10) / 10;

/** What the reader's plant runs and earns at one hour, at a given heat rate. */
function yourHour(heatRate: number, h = YOUR_HOUR) {
  const offer = customGasOffer(heatRate, YOUR_VOM, GAS0);
  const c = clearMeritOrder(withYou(h, offer), SYSTEM_DEMAND[h]);
  const q = c.dispatch.you ?? 0;
  return { offer, c, q, margin: q * (c.price - offer) };
}

function stackBlocks(c: Clearing, offers: Array<{ id: string; mw: number; price: number }>, you?: string): StackBlock[] {
  return c.stack.map((s) => {
    const o = offers.find((x) => x.id === s.id)!;
    return {
      id: s.id,
      start: s.start,
      mw: o.mw,
      price: o.price,
      dispatched: c.dispatch[s.id] ?? 0,
      color: COLOR[s.id] ?? '#999',
      label: s.id === you ? 'You' : undefined,
      highlight: s.id === you,
    };
  });
}

export default function Lesson() {
  const s1 = useScenario('stack', { gas: 5, carbon: 0, hour: '14' as HourKey });
  const s2 = useScenario('your-plant', { heatRate: 7 });
  const { gas, carbon } = s1.state;
  const h1 = Number(s1.state.hour);

  const offers1 = fleetOffers(h1, { gas, carbon }).filter((o) => o.mw > 0.5);
  const demand1 = SYSTEM_DEMAND[h1];
  const c1 = clearMeritOrder(offers1, demand1);
  const lake = offerBreakdown(LAKESIDE, { gas, carbon });
  const iron = offerBreakdown(IRONWOOD, { gas, carbon });
  const marginal = c1.marginal ? NAME[c1.marginal] : '—';
  const thr = switchingGasPrice(LAKESIDE, IRONWOOD, { carbon }) ?? 0;
  const ahead = lake.offer < iron.offer;
  const tie = Math.abs(lake.offer - iron.offer) < 0.005;
  const solved = carbon === 0 && ahead && gas + GAS_STEP >= thr - 1e-9;
  const order = tie
    ? `Lakeside and Ironwood coal both offer ${usd(iron.offer, 2)}.`
    : ahead
      ? `Lakeside now undercuts Ironwood coal’s ${usd(iron.offer, 2)}, so gas runs first.`
      : `Ironwood coal offers ${usd(iron.offer, 2)}, less than Lakeside, so coal runs first.`;

  // Figure 2: the reader's own gas plant at 19:00.
  const heatRate = roundHR(s2.state.heatRate);
  const you = yourHour(heatRate);
  const next = yourHour(roundHR(heatRate + HR_STEP));
  const hoursRun = useMemo(() => Array.from({ length: 24 }, (_, h) => yourHour(heatRate, h).q > 1e-6).filter(Boolean).length, [heatRate]);
  const solvedB = you.margin > 0.005 && next.margin <= 0.005;
  const setter = NAME[you.c.marginal ?? ''] ?? 'another plant';
  const was = WITHOUT_YOU.price;
  let msg2: string;
  if (you.q <= 1e-6) msg2 = `Cheaper offers cover all ${mw(SYSTEM_DEMAND[YOUR_HOUR])} at 19:00, so your plant sits idle and ${setter} sets the price at ${usd(you.c.price, 2)}.`;
  else if (you.c.marginal === 'you')
    msg2 = `Your plant is the last one needed: it runs ${mw(you.q)} and sets the price itself, ${usd(you.c.price, 2)} instead of ${NAME[WITHOUT_YOU.marginal ?? '']}’s ${usd(was, 2)}, so it earns nothing above its running cost.`;
  else
    msg2 = `Your plant runs flat out and ${setter} sets the price, ${usd(you.c.price, 2)}${you.c.price < was - 0.005 ? ` instead of ${usd(was, 2)} without you` : ''}, so every megawatt-hour earns ${usd(you.c.price - you.offer, 2)} above your cost.`;

  return (
    <LessonPage id="4.3">
      <P>
        Every participant in the last lesson depended, one way or another, on the offers generators submit — the owners’ own numbers that, as <a href={lessonHref('4.1')}>Lesson 4.1</a> argued, beat
        any planner’s estimates. In the markets run by system operators, every generator submits its offers a day ahead, hour by hour: how many megawatts it can produce, and the lowest price, in dollars per megawatt-hour, at which it’s willing to
        produce them. The operator lines the offers up from cheapest to most expensive and works up the line until demand is met.
      </P>
      <P>
        That line is only as good as the offers in it, so it’s worth knowing what goes into one. For a plant that burns fuel, three things make up almost all of the cost
        of producing one more megawatt-hour. The first is the fuel: how much the plant burns per megawatt-hour, its <b>heat rate</b>, measured in millions of British
        thermal units (MMBtu), times what that fuel costs. The second is variable operating and maintenance — the wear on turbines, the chemicals, the water. The third,
        in places that price carbon, is the plant’s emissions times the price of each tonne:
      </P>
      <Eq label="Offer equals heat rate times fuel price plus variable O and M plus emissions times carbon price">
        <K c="price">Offer</K>
        <Op>=</Op>
        <span>heat rate</span>
        <Op>×</Op>
        <K c="price">fuel price</K>
        <Op>+</Op>
        <span>O&amp;M</span>
        <Op>+</Op>
        <span>emissions</span>
        <Op>×</Op>
        <K c="price">carbon price</K>
      </Eq>
      <P>
        Here is the region’s fleet, each plant offering exactly that. At the starting prices — $5.00 per MMBtu for gas, $2.20 for coal, no carbon price — the offers are
        the running costs we’ve used since Chapter 2. The demonstration opens at 14:00, when Ironwood coal is the last plant needed and sets the price, with Lakeside
        combined-cycle next in line. Drag the price of gas both ways, try the same at 19:00, and then add a price on carbon:
      </P>

      <Figure name="Bid Stack Builder" scenario={s1}>
        <Segmented label="Hour of the reference day" value={s1.state.hour} onChange={(v) => s1.set({ hour: v })} options={HOURS} />
        <SupplyStackChart
          ariaLabel={`Supply stack at ${hour(h1)} with gas at $${gas.toFixed(2)} per MMBtu and carbon at $${carbon} per tonne. ${mw(demand1)} of demand clears at ${usd(c1.price, 2)} per MWh, set by ${marginal}.`}
          blocks={stackBlocks(c1, offers1)}
          demand={demand1}
          price={c1.price}
          priceLabel={usd(c1.price, 2)}
          xMax={2200}
          yMax={200}
        />
        <Slider label="Gas price" tone="green" value={gas} min={2} max={12} step={GAS_STEP} onChange={(v) => s1.set({ gas: v })} display={`$${gas.toFixed(2)} per MMBtu`} />
        <Slider label="Carbon price" tone="green" value={carbon} min={0} max={100} step={5} onChange={(v) => s1.set({ carbon: v })} display={`$${carbon} per tonne of CO₂`} />
        <Eq label="Lakeside combined-cycle's offer">
          <span>Lakeside</span>
          <Op>=</Op>
          <span>{COST_RECIPE.cc1.heatRate} MMBtu</span>
          <Op>×</Op>
          <K c="price">${gas.toFixed(2)}</K>
          <Op>+</Op>
          <span>${COST_RECIPE.cc1.vom}</span>
          <Op>+</Op>
          <span>{LAKESIDE.emissions} t</span>
          <Op>×</Op>
          <K c="price">${carbon}</K>
          <Op>=</Op>
          <K c="price">{usd(lake.offer, 2)}</K>
        </Eq>
        <Caption>
          {order} At {hour(h1)}, {marginal} is the last plant needed and sets the price.
        </Caption>
      </Figure>

      <P>
        Heat rate is a measure of efficiency, and the gas plants in our fleet differ a lot. Lakeside, the more efficient of our two combined-cycle plants, burns 6.4
        MMBtu for every megawatt-hour; Mill Creek, smaller and less efficient, 7.6; the Eastgate peaker, a simple gas turbine built to start quickly rather than run efficiently, 14.0. At $5 gas that
        puts their fuel costs at $32, $38 and $70. Ironwood coal burns 10.0 MMBtu per megawatt-hour, but coal is so much cheaper per unit of heat that its offer, $28,
        comes in below all three.
      </P>
      <P>
        Move the gas price and every gas plant’s offer moves with it, in proportion to its heat rate, while coal, nuclear and hydro stay put. At 14:00, raising it changes
        nothing that matters: Lakeside isn’t running, and coal still sets the price at $28. Lower it, though, and somewhere below $5 Lakeside drops beneath Ironwood. At
        night and in the afternoon, when one of the two is the plant setting the price, the stack then hands the work from coal to gas. At 19:00 it’s the other way
        round. Both plants run flat out on either side of the swap, so it changes nothing about who runs, but Mill Creek’s gas sets the price: from about $3.20 up, the
        price follows the slider, $7.60 per megawatt-hour for every dollar on the price of gas. This isn’t hypothetical. When American gas prices fell sharply in 2012,
        combined-cycle plants began undercutting coal across much of the country, and by 2016 gas had overtaken coal as the largest source of US electricity.
      </P>

      <Challenge
        id="a"
        question="With no carbon price, find the highest gas price at which Lakeside combined-cycle runs ahead of Ironwood coal."
        solved={solved}
        status={
          carbon !== 0
            ? 'Set the carbon price back to zero first.'
            : ahead
              ? `At $${gas.toFixed(2)} per MMBtu, Lakeside runs ahead of Ironwood. Can the gas price be higher?`
              : `At $${gas.toFixed(2)} per MMBtu, Ironwood runs first.`
        }
        success={`Solved. Lakeside’s offer is ${COST_RECIPE.cc1.heatRate} × the gas price + $${COST_RECIPE.cc1.vom}, which equals Ironwood’s $28 at exactly $${thr.toFixed(2)} per MMBtu. At $${gas.toFixed(2)} Lakeside offers ${usd(lake.offer, 2)} and runs first; at $${thr.toFixed(2)} the two tie, and above it coal is cheaper again.`}
      />

      <P>
        A carbon price works on the stack from the other side. Ironwood emits about a tonne of CO₂ per megawatt-hour and Lakeside 0.37 tonnes, so each dollar per tonne
        raises coal’s offer by a dollar and Lakeside’s by 37 cents. At $5 gas, a carbon price above about $12.70 a tonne is enough to put Lakeside first; above about
        $22, Mill Creek overtakes Ironwood too. Europe’s emissions trading system and several American state programs put prices like these, and higher, on the carbon
        power plants emit, and this reordering of the stack is one of the main ways they cut emissions.
      </P>
      <P>
        The plants without a fuel bill sit at the bottom. Ridge wind and Valley solar offer what the weather lets them produce at $0, since producing more costs them
        almost nothing. In places where wind farms earn a subsidy for every megawatt-hour they produce — the US production tax credit works this way — they can offer
        below zero and still come out ahead, which is one reason prices occasionally go negative. Falls hydro has no fuel either, but its water is limited: water used now
        can’t be used tonight, so it offers at the value of saving it, $20 in our model.
      </P>

      <H2>Your own plant</H2>
      <P>
        Now add a gas plant of your own to the stack at 19:00, the evening peak, when Mill Creek is the last plant needed. It’s a 200 MW plant that burns gas at $5
        per MMBtu and spends $3.50 per megawatt-hour on upkeep. You choose how efficient it is: it starts at a heat rate of 7.0 MMBtu per megawatt-hour, better than
        Mill Creek but not as good as Lakeside. See where it lands and what it earns:
      </P>

      <Figure name="Bid Stack Builder · your plant" scenario={s2}>
        <SupplyStackChart
          ariaLabel={`Supply stack at 19:00 including your ${YOUR_MW} MW plant offering ${usd(you.offer, 2)}. Clearing price ${usd(you.c.price, 2)}; your plant produces ${mw(you.q)}.`}
          blocks={stackBlocks(you.c, withYou(YOUR_HOUR, you.offer), 'you')}
          demand={SYSTEM_DEMAND[YOUR_HOUR]}
          price={you.c.price}
          priceLabel={usd(you.c.price, 2)}
          xMax={2200}
          yMax={200}
        />
        <Slider label="Heat rate" value={heatRate} min={6} max={14} step={HR_STEP} onChange={(v) => s2.set({ heatRate: v })} display={`${heatRate.toFixed(1)} MMBtu per MWh`} />
        <Eq label="Your offer">
          <span>Your offer</span>
          <Op>=</Op>
          <span>{heatRate.toFixed(1)} MMBtu</span>
          <Op>×</Op>
          <K c="price">$5.00</K>
          <Op>+</Op>
          <span>$3.50</span>
          <Op>=</Op>
          <K c="price">{usd(you.offer, 2)}</K>
        </Eq>
        <Readouts
          items={[
            { label: 'earned above your running cost at 19:00', value: usd(you.margin), tone: 'green' },
            { label: 'hours you run on the reference day', value: `${hoursRun} of 24` },
          ]}
        />
        <Caption>{msg2}</Caption>
      </Figure>

      <P>
        At 7.0, your plant is cheaper than Mill Creek, so the operator takes the last 50 MW it needs at 19:00 from you instead. That makes yours the marginal plant: its
        offer of $38.50 is now the price, and it earns nothing above its running cost. To earn something, a plant has to run while another plant’s offer sets the price.
      </P>

      <Challenge
        id="b"
        question="Your plant burns gas at $5 and spends $3.50 per MWh on upkeep. What’s the highest heat rate at which it earns anything above its running cost at 19:00?"
        solved={solvedB}
        status={
          you.q <= 1e-6
            ? `At ${heatRate.toFixed(1)} MMBtu per MWh, your plant doesn’t run at 19:00.`
            : you.c.marginal === 'you'
              ? `At ${heatRate.toFixed(1)}, your plant sets the price itself, so it earns nothing. Which plant’s offer would it have to undercut?`
              : `At ${heatRate.toFixed(1)}, your plant earns ${usd(you.margin)} at 19:00. Could it be less efficient and still earn?`
        }
        success={`Solved. At ${heatRate.toFixed(1)} MMBtu per MWh your plant offers ${usd(you.offer, 2)}, just under Lakeside’s $36, so it runs flat out while Lakeside sets the price. A tenth more and it ties Lakeside, becomes the plant that sets the price, and earns nothing.`}
      />

      <P>
        At $5 gas, every extra MMBtu of heat rate adds $5 to the offer, so efficiency decides where a gas plant lands, and how often it runs. A plant that undercuts
        Lakeside runs 8 hours of the reference day, every hour in which a gas plant is needed. One between Lakeside and Mill Creek, like yours at the start, runs only in
        the two evening hours when Mill Creek would otherwise be needed, and sets the price when it does. One as thirsty as Eastgate never runs on the reference day at
        all. And a plant that runs changes the price everyone is paid: undercut Lakeside at 19:00 and the price falls from $42 to $36 for every plant that runs, yours
        included.
      </P>
      <P>
        Real offers are a little more complicated than one number. A thermal plant has to be started, and starting costs money: $40,000 for Ironwood in our model,
        $15,000 for Lakeside, $2,000 for Eastgate. Spread over eight hours at full output, Ironwood’s start adds $16.67 to each megawatt-hour; Eastgate’s start, spread
        over a single hour, adds $10. Some plants also can’t run below a minimum output once they’re on — 120 MW for Ironwood, 360 MW for Harbor Point nuclear, which is
        why a nuclear plant will offer very low prices rather than shut down overnight. Most system operators let generators submit these costs separately, decide which
        plants to start with a scheduling program called <b>unit commitment</b>, and top up any plant whose market revenue falls short of the start-up costs it was told
        to incur. Those top-ups, often called make-whole or uplift payments, sit outside the single clearing price.
      </P>
      <P>
        Every plant in this lesson offered its running cost, and every plant that ran was paid the same clearing price — which is why your plant earned only when another
        plant’s offer set it. Neither is a law of nature. The <a href={lessonHref('4.4')}>next lesson</a> asks why markets pay one price to everyone, and what an owner who
        knows that will choose to offer.
      </P>
    </LessonPage>
  );
}
