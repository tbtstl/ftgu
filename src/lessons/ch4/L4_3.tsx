import {
  Caption,
  Challenge,
  DataTable,
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
  Swatch,
  Tn,
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

function fuelLabel(id: string): string {
  const r = COST_RECIPE[id];
  if (!r) return '—';
  return r.fuel === 'water' ? 'water value' : r.fuel;
}

export default function Lesson() {
  const s1 = useScenario('stack', { gas: 5, carbon: 0, hour: '19' as HourKey });
  const s2 = useScenario('your-plant', { heatRate: 6.2, vom: 3.5, size: 200, hour: '19' as HourKey });
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
  const solved = carbon === 0 && ahead && gas + GAS_STEP >= thr - 1e-9;

  const rows = c1.stack.map((s) => {
    const o = offers1.find((x) => x.id === s.id)!;
    return { id: s.id, b: o.breakdown, q: c1.dispatch[s.id] ?? 0 };
  });

  // Figure 2: the reader's own gas plant, at the reference gas price.
  const { heatRate, vom, size } = s2.state;
  const h2 = Number(s2.state.hour);
  const gas0 = REFERENCE_FUEL_PRICE.gas;
  const yourOffer = customGasOffer(heatRate, vom, gas0);
  const withYou = (h: number) => [...fleetOffers(h).filter((o) => o.mw > 0.5).map((o) => ({ id: o.id, mw: o.mw, price: o.price })), { id: 'you', mw: size, price: yourOffer }];
  const offers2 = withYou(h2);
  const c2 = clearMeritOrder(offers2, SYSTEM_DEMAND[h2]);
  const q2 = c2.dispatch.you ?? 0;
  const margin2 = q2 * (c2.price - yourOffer);
  let hoursRun = 0;
  let dayMargin = 0;
  for (let h = 0; h < 24; h++) {
    const c = clearMeritOrder(withYou(h), SYSTEM_DEMAND[h]);
    const q = c.dispatch.you ?? 0;
    if (q > 1e-6) hoursRun++;
    dayMargin += q * (c.price - yourOffer);
  }
  let msg2: string;
  if (q2 <= 1e-6) msg2 = `At ${hour(h2)} the market needs ${mw(SYSTEM_DEMAND[h2])}, and cheaper offers cover all of it. Your plant sits idle.`;
  else if (c2.marginal === 'you') msg2 = `Your plant is the last one needed at ${hour(h2)}: it runs ${mw(q2)} and sets the price itself, so it earns nothing above its running cost.`;
  else msg2 = `Your plant runs flat out at ${hour(h2)}, and the price is set by ${NAME[c2.marginal ?? ''] ?? 'another plant'} at ${usd(c2.price, 2)}, so every megawatt-hour you produce earns ${usd(c2.price - yourOffer, 2)} above your cost.`;

  return (
    <LessonPage id="4.3">
      <P>
        Every participant in the last lesson depended, one way or another, on the offers generators submit — the owners’ own numbers that, as Lesson 4.1 argued, beat
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
        Below is the region’s fleet, each plant offering exactly that. At the starting prices — $5.00 per MMBtu for gas, $2.20 for coal, no carbon price — the offers are
        the running costs we’ve used since Chapter 2. Drag the price of gas, and then add a price on carbon:
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
        <Readouts
          items={[
            { label: 'clearing price per MWh', value: usd(c1.price, 2), tone: 'green' },
            { label: 'marginal plant', value: marginal },
            { label: 'Lakeside vs. Ironwood offers', value: `${usd(lake.offer, 2)} · ${usd(iron.offer, 2)}`, tone: 'green' },
          ]}
        />
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
        <DataTable
          caption="Offers in merit order, with what goes into each"
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.id === c1.marginal ? 'hl' : r.q > 0 ? '' : 'dim')}
          columns={[
            {
              label: 'Plant',
              cell: (r) => (
                <>
                  <Swatch color={COLOR[r.id]} />
                  {NAME[r.id]}
                </>
              ),
            },
            { label: 'Heat rate', cell: (r) => (COST_RECIPE[r.id]?.heatRate ? COST_RECIPE[r.id].heatRate.toFixed(1) : '—') },
            { label: 'Fuel', cell: (r) => (r.b.fuel > 0 ? `${usd(r.b.fuel, 2)} ${fuelLabel(r.id)}` : '—') },
            { label: 'O&M', cell: (r) => (r.b.vom > 0 ? usd(r.b.vom, 2) : '—') },
            { label: 'Carbon', cell: (r) => (r.b.carbon > 0 ? usd(r.b.carbon, 2) : '—') },
            { label: <Tn tone="green">Offer</Tn>, cell: (r) => usd(r.b.offer, 2) },
            { label: 'Runs', cell: (r) => (r.q > 0 ? mw(r.q) : '—') },
          ]}
        />
        <Caption>
          {ahead
            ? `Lakeside’s offer of ${usd(lake.offer, 2)} is below Ironwood’s ${usd(iron.offer, 2)}, so the gas plant now runs ahead of the coal plant.`
            : `Ironwood coal offers ${usd(iron.offer, 2)} and Lakeside ${usd(lake.offer, 2)}, so coal runs first.`}
        </Caption>
      </Figure>

      <P>
        Heat rate is a measure of efficiency, and the gas plants in our fleet differ a lot. Lakeside, the more efficient of our two combined-cycle plants, burns 6.4
        MMBtu for every megawatt-hour; Mill Creek, smaller and less efficient, 7.6; the Eastgate peaker, a simple gas turbine built to start quickly rather than run efficiently, 14.0. At $5 gas that
        puts their fuel costs at $32, $38 and $70. Ironwood coal burns 10.0 MMBtu per megawatt-hour, but coal is so much cheaper per unit of heat that its offer, $28,
        comes in below all three.
      </P>
      <P>
        Move the gas price and every gas plant’s offer moves with it, in proportion to its heat rate, while coal, nuclear and hydro stay put. Somewhere below $5 Lakeside
        drops beneath Ironwood, and at night and in the afternoon, when one of the two is the plant setting the price, the stack hands the work from coal to gas. This
        isn’t hypothetical. When American gas prices fell sharply in 2012, combined-cycle plants began undercutting coal across much of the country, and by 2016 gas had
        overtaken coal as the largest source of US electricity.
      </P>

      <Challenge
        id="a"
        question="With no carbon price, find the highest gas price at which Lakeside combined-cycle runs ahead of Ironwood coal."
        solved={solved}
        status={
          carbon !== 0
            ? 'Set the carbon price back to zero first.'
            : `At $${gas.toFixed(2)} per MMBtu, Lakeside offers ${usd(lake.offer, 2)} and Ironwood ${usd(iron.offer, 2)}.${ahead ? ' Lakeside is ahead — can the gas price be higher?' : ''}`
        }
        success={`Solved. Lakeside’s offer is ${COST_RECIPE.cc1.heatRate} × the gas price + $${COST_RECIPE.cc1.vom}, which equals Ironwood’s $28 at exactly $${thr.toFixed(2)} per MMBtu. At $${gas.toFixed(2)} Lakeside offers ${usd(lake.offer, 2)} and runs first; at $${thr.toFixed(2)} the two tie, and above it coal is cheaper again.`}
      />

      <P>
        A carbon price works on the stack from the other side. Ironwood emits about a tonne of CO₂ per megawatt-hour and Lakeside 0.37 tonnes, so each dollar per tonne
        raises coal’s offer by a dollar and Lakeside’s by 37 cents. At $5 gas, a carbon price above about $12.70 a tonne is enough to put Lakeside first; above about
        $22, Mill Creek overtakes Ironwood too. Europe’s emissions trading system and several American state programs put prices like these on the carbon power plants
        emit, and this reordering of the stack is one of the main ways they cut emissions.
      </P>
      <P>
        The plants without a fuel bill sit at the bottom. Ridge wind and Valley solar offer what the weather lets them produce at $0, since producing more costs them
        almost nothing. In places where wind farms earn a subsidy for every megawatt-hour they produce — the US production tax credit works this way — they can offer
        below zero and still come out ahead, which is one reason prices occasionally go negative. Falls hydro has no fuel either, but its water is limited: water used now
        can’t be used tonight, so it offers at the value of saving it, $20 in our model.
      </P>

      <H2>Your own plant</H2>
      <P>
        Now build a gas plant of your own and add it to the stack. Gas stays at $5 per MMBtu. Choose its efficiency, its upkeep and its size, and see where it lands and
        what it earns:
      </P>

      <Figure name="Bid Stack Builder · your plant" scenario={s2}>
        <Segmented label="Hour of the reference day" value={s2.state.hour} onChange={(v) => s2.set({ hour: v })} options={HOURS} />
        <SupplyStackChart
          ariaLabel={`Supply stack at ${hour(h2)} including your ${size} MW plant offering ${usd(yourOffer, 2)}. Clearing price ${usd(c2.price, 2)}; your plant produces ${mw(q2)}.`}
          blocks={stackBlocks(c2, offers2, 'you')}
          demand={SYSTEM_DEMAND[h2]}
          price={c2.price}
          priceLabel={usd(c2.price, 2)}
          xMax={2600}
          yMax={200}
        />
        <Slider label="Heat rate" value={heatRate} min={6} max={14} step={0.1} onChange={(v) => s2.set({ heatRate: v })} display={`${heatRate.toFixed(1)} MMBtu per MWh`} />
        <Slider label="Variable O&M" tone="green" value={vom} min={0} max={20} step={0.5} onChange={(v) => s2.set({ vom: v })} display={`$${vom.toFixed(2)} per MWh`} />
        <Slider label="Size" tone="red" value={size} min={50} max={400} step={10} onChange={(v) => s2.set({ size: v })} display={mw(size)} />
        <Eq label="Your offer">
          <span>Your offer</span>
          <Op>=</Op>
          <span>{heatRate.toFixed(1)} MMBtu</span>
          <Op>×</Op>
          <K c="price">$5.00</K>
          <Op>+</Op>
          <span>${vom.toFixed(2)}</span>
          <Op>=</Op>
          <K c="price">{usd(yourOffer, 2)}</K>
        </Eq>
        <Readouts
          items={[
            { label: 'clearing price per MWh', value: usd(c2.price, 2), tone: 'green' },
            { label: 'you produce', value: mw(q2), tone: 'red' },
            { label: 'earned above your costs this hour', value: usd(margin2), tone: 'green' },
            { label: 'hours you run on the reference day', value: `${hoursRun} of 24` },
          ]}
        />
        <Caption>
          {msg2} Over the whole reference day, your plant earns {usd(dayMargin)} above its running costs.
        </Caption>
      </Figure>

      <P>
        At $5 gas, every extra MMBtu of heat rate adds $5 to the offer, so efficiency decides where a gas plant lands. A plant as efficient as Lakeside runs most of the day
        and earns a margin whenever something dearer sets the price. A plant as thirsty as Eastgate runs only in the tightest hours, if at all — and adding your plant
        to the stack can lower the price that everyone, including you, is paid.
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
        With the offers in, the operator has its stack. What’s left is to decide which offers to accept — and what to pay them. That’s{' '}
        <a href={lessonHref('4.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
