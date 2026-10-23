import { useMemo, type ReactNode } from 'react';
import {
  Caption,
  Challenge,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  TimeChart,
  fmt,
  lessonHref,
  mwh,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { standardHistory } from '../../model/history';
import { dayAheadSchedule, generatorDay, isoDay, retailerDay, retailerPeriod, traderDay, wiresUtility, RETAILER_SHARE } from '../../engines/market/roles';

type Role = 'generator' | 'retailer' | 'trader' | 'iso' | 'utility';
type DayKey = 'mild' | 'heat' | 'outage';

const DAYS: Record<DayKey, { index: number; label: string }> = {
  mild: { index: 22, label: 'Mild Tuesday' },
  heat: { index: 116, label: 'Heat wave' },
  outage: { index: 72, label: 'Plant outage' },
};

/** Compact money for diagram labels: $984k, $3.08M. */
function money(x: number): string {
  const a = Math.abs(x);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}k` : `$${Math.round(a)}`;
  return x < 0 ? '−' + s : s;
}

/** Axis labels for dollar amounts: $8,000, −$150k. */
function axisMoney(v: number): string {
  return Math.abs(v) >= 10_000 ? money(v) : usd(v);
}

const BOX = { w: 156, h: 54 };
const POS: Record<string, { x: number; y: number }> = {
  generator: { x: 98, y: 50 },
  iso: { x: 320, y: 50 },
  retailer: { x: 542, y: 50 },
  trader: { x: 320, y: 150 },
  utility: { x: 320, y: 250 },
  customers: { x: 542, y: 250 },
};

/** A straight horizontal or vertical arrow with a head at (x2, y2). */
function Arrow({ x1, y1, x2, y2, color, dim, label, lx, ly, anchor = 'middle' }: { x1: number; y1: number; x2: number; y2: number; color: string; dim?: boolean; label?: string; lx: number; ly: number; anchor?: 'start' | 'middle' | 'end' }) {
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  const head = `${x2},${y2} ${x2 - 9 * dx - 5 * dy},${y2 - 9 * dy - 5 * dx} ${x2 - 9 * dx + 5 * dy},${y2 - 9 * dy + 5 * dx}`;
  return (
    <g opacity={dim ? 0.3 : 1}>
      <line x1={x1} y1={y1} x2={x2 - 6 * dx} y2={y2 - 6 * dy} stroke={color} strokeWidth={3} />
      <polygon points={head} fill={color} />
      {label && (
        <text x={lx} y={ly} textAnchor={anchor} style={{ fontSize: 13, fontWeight: 600, fill: color === GRAPHIC.green ? TEXT.green : TEXT.gold }}>
          {label}
        </text>
      )}
    </g>
  );
}

function Box({ id, title, sub, on }: { id: string; title: string; sub: string; on: boolean }) {
  const p = POS[id];
  return (
    <g>
      <rect x={p.x - BOX.w / 2} y={p.y - BOX.h / 2} width={BOX.w} height={BOX.h} rx={8} fill={on ? '#ffffff' : '#efefef'} stroke={on ? '#222' : '#cfcfcf'} strokeWidth={on ? 2.5 : 1.5} />
      <text x={p.x} y={p.y - 4} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: '#333' }}>
        {title}
      </text>
      <text x={p.x} y={p.y + 14} textAnchor="middle" className="ax">
        {sub}
      </text>
    </g>
  );
}

function RoleFacts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '6px 20px', margin: '6px 0 4px', fontSize: 15, lineHeight: 1.45 }}>
      {items.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.gray }}>{k}</div>
          <div style={{ color: '#444' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const HISTORY = standardHistory();
const AVG_DA = HISTORY.flatMap((x) => x.da).reduce((a, b) => a + b, 0) / (HISTORY.length * 24);

export default function Lesson() {
  const s1 = useScenario('roles', { role: 'generator' as Role, day: 'mild' as DayKey, rate: 45, position: 50, allowed: 8 });
  const s2 = useScenario('retailer-days', { rate: 45 });
  const { role, day, rate, position, allowed } = s1.state;

  const d = HISTORY[DAYS[day].index];
  const schedule = useMemo(() => dayAheadSchedule(d), [d]);
  const gen = generatorDay(d, 'cc1', schedule);
  const ret = retailerDay(d, rate);
  const trd = traderDay(d, position);
  const iso = isoDay(d);
  const wires = wiresUtility(allowed / 100);
  const energy = iso.energy;
  const retail = rate * energy;
  const delivery = wires.deliveryCharge * energy;

  const on = (r: string) => r === role;
  const dimFlow = (...rs: string[]) => !rs.includes(role);
  const priceFmt = (v: number) => '$' + fmt(v);

  let facts: Array<[string, ReactNode]> = [];
  let chartTop: ReactNode = null;
  let chartBottom: ReactNode = null;
  let control: ReactNode = null;
  let readouts: Array<{ label: ReactNode; value: ReactNode; tone?: 'green' | 'red' | 'gold' | 'ink' }> = [];
  let caption = '';

  if (role === 'generator') {
    facts = [
      ['Decides', 'What to offer each hour. Lakeside offers its running cost: fuel plus upkeep.'],
      ['Is paid', 'The clearing price for every megawatt-hour it’s scheduled to produce.'],
      ['Risk', 'Prices too low to cover its fixed costs; fuel prices; breaking down after it has sold.'],
    ];
    chartTop = (
      <>
      <Legend
        items={[
          { label: 'Day-ahead price', color: GRAPHIC.green, kind: 'line' },
          { label: 'Lakeside’s running cost', color: '#555', kind: 'line', dashed: true },
        ]}
      />
      <TimeChart
        ariaLabel={`Day-ahead price and Lakeside’s running cost of ${usd(gen.cost, 2)} per MWh through the day.`}
        height={170}
        yLabel="Day-ahead price, $/MWh"
        yFormat={priceFmt}
        series={[
          { values: d.da, kind: 'step', color: GRAPHIC.green, width: 2.5 },
          { values: d.da.map(() => gen.cost), color: '#555', dash: '5 4', width: 1.5 },
        ]}
      />
      </>
    );
    chartBottom = (
      <TimeChart
        ariaLabel={`Lakeside’s scheduled output through the day; it runs ${gen.hoursRun} hours.`}
        height={150}
        yLabel="Lakeside’s output, MW"
        yMin={0}
        yMax={400}
        series={[{ values: gen.output, kind: 'bar', color: GRAPHIC.red }]}
      />
    );
    readouts = [
      { label: 'paid for its energy', value: usd(gen.revenue), tone: 'green' },
      { label: 'spent running', value: usd(gen.runningCost), tone: 'green' },
      { label: 'left toward fixed costs', value: usd(gen.margin), tone: 'green' },
    ];
    caption = `Lakeside runs ${gen.hoursRun} of 24 hours. Whenever a more expensive plant sets the price, it earns the difference on every megawatt-hour.`;
  } else if (role === 'retailer') {
    facts = [
      ['Decides', 'The fixed rate it charges its customers, months ahead.'],
      ['Pays', 'The hourly wholesale price for everything its customers use.'],
      ['Risk', 'Wholesale prices rising above its fixed rate, often on the days customers use most.'],
    ];
    control = <Slider label="Fixed retail rate" tone="green" value={rate} min={30} max={100} onChange={(v) => s1.set({ rate: v })} display={`$${rate} per MWh`} />;
    chartTop = (
      <TimeChart
        ariaLabel={`Day-ahead price against the retailer’s fixed rate of $${rate} per MWh.`}
        height={170}
        yLabel="Price, $/MWh"
        yFormat={priceFmt}
        series={[{ values: d.da, kind: 'step', color: GRAPHIC.green, width: 2.5 }]}
        refLines={[{ y: rate, color: '#333', label: `your rate, $${rate}` }]}
      />
    );
    chartBottom = (
      <TimeChart
        ariaLabel={`The retailer’s margin each hour; ${usd(ret.margin)} for the day.`}
        height={150}
        yLabel="Retailer’s margin each hour, $"
        yFormat={axisMoney}
        series={[{ values: ret.hourly, kind: 'bar', color: GRAPHIC.green, colors: ret.hourly.map((v) => (v < 0 ? GRAPHIC.red : GRAPHIC.green)) }]}
      />
    );
    readouts = [
      { label: 'paid for energy', value: usd(ret.wholesale), tone: 'green' },
      { label: 'billed to customers', value: usd(ret.revenue), tone: 'green' },
      { label: 'margin for the day', value: usd(ret.margin), tone: ret.margin < 0 ? 'red' : 'green' },
    ];
    caption = `The retailer serves ${fmt(RETAILER_SHARE * 100)}% of the region’s customers, who use ${mwh(ret.energy)} today. To break even on this day it would need to charge $${ret.breakEven.toFixed(2)} per MWh.`;
  } else if (role === 'trader') {
    facts = [
      ['Decides', 'Virtual positions: buy or sell day-ahead, then reverse the trade in real time.'],
      ['Is paid', 'The difference between the day-ahead and real-time prices, times its position.'],
      ['Risk', 'The real-time price moving against it — without limit, during a spike.'],
    ];
    control = (
      <Slider
        label="Virtual position, every hour"
        tone="red"
        value={position}
        min={-100}
        max={100}
        step={10}
        onChange={(v) => s1.set({ position: v })}
        display={position > 0 ? `sell ${position} MW day-ahead` : position < 0 ? `buy ${-position} MW day-ahead` : 'no position'}
      />
    );
    chartTop = (
      <>
      <Legend
        items={[
          { label: 'Day-ahead price', color: TEXT.green, kind: 'line' },
          { label: 'Real-time price', color: '#9bbf6f', kind: 'line' },
        ]}
      />
      <TimeChart
        ariaLabel="Day-ahead and real-time prices through the day."
        height={170}
        yLabel="Price, $/MWh"
        yFormat={priceFmt}
        series={[
          { values: d.rt, kind: 'step', color: '#9bbf6f', width: 2 },
          { values: d.da, kind: 'step', color: TEXT.green, width: 2.5 },
        ]}
      />
      </>
    );
    chartBottom = (
      <TimeChart
        ariaLabel={`The trader’s profit each hour; ${usd(trd.total)} for the day.`}
        height={150}
        yLabel="Trader’s profit each hour, $"
        yFormat={axisMoney}
        series={[{ values: trd.hourly, kind: 'bar', color: GRAPHIC.green, colors: trd.hourly.map((v) => (v < 0 ? GRAPHIC.red : GRAPHIC.green)) }]}
      />
    );
    readouts = [
      { label: 'average day-ahead price', value: usd(d.da.reduce((s, v) => s + v, 0) / 24, 2), tone: 'green' },
      { label: 'average real-time price', value: usd(d.rt.reduce((s, v) => s + v, 0) / 24, 2), tone: 'green' },
      { label: 'profit for the day', value: usd(trd.total), tone: trd.total < 0 ? 'red' : 'green' },
    ];
    caption =
      position === 0
        ? 'With no position, the trader neither gains nor loses.'
        : `${position > 0 ? 'Selling' : 'Buying'} ${Math.abs(position)} MW day-ahead in every hour and reversing it in real time ${trd.total >= 0 ? 'earns' : 'loses'} ${usd(Math.abs(trd.total))} today. The trader never produces or uses a megawatt-hour.`;
  } else if (role === 'iso') {
    facts = [
      ['Decides', 'Which offers to accept, and every plant’s output in real time to keep supply equal to demand.'],
      ['Is paid', 'A small fee per MWh for its own costs. It collects from buyers and pays sellers.'],
      ['Risk', 'Reliability, not money: it owns no plants and makes no profit.'],
    ];
    chartTop = (
      <>
      <Legend
        items={[
          { label: 'Forecast demand', color: '#777', kind: 'line', dashed: true },
          { label: 'Actual demand', color: '#333', kind: 'line' },
        ]}
      />
      <TimeChart
        ariaLabel="Forecast and actual demand through the day."
        height={170}
        yLabel="Demand, MW"
        yFormat={(v) => fmt(v)}
        series={[
          { values: d.demandForecast, color: '#777', dash: '6 4', width: 2 },
          { values: d.demand, color: '#333', width: 2.5 },
        ]}
      />
      </>
    );
    chartBottom = (
      <TimeChart
        ariaLabel={`Congestion rent each hour; ${usd(iso.rent)} for the day.`}
        height={150}
        yLabel="Congestion rent each hour, $"
        yMin={0}
        yFormat={axisMoney}
        series={[{ values: iso.rentHourly, kind: 'bar', color: GRAPHIC.green }]}
      />
    );
    readouts = [
      { label: 'energy scheduled day-ahead', value: mwh(iso.energy), tone: 'gold' },
      { label: 'collected from buyers', value: usd(iso.collected), tone: 'green' },
      { label: 'paid to sellers', value: usd(iso.paid), tone: 'green' },
      { label: 'congestion rent', value: usd(iso.rent), tone: 'green' },
    ];
    caption = `The dashed line is the forecast the day-ahead market cleared on; the solid line is what customers actually used. Covering the gap, hour by hour, is the operator’s job in real time.`;
  } else {
    facts = [
      ['Decides', 'Where to build and maintain poles, wires and substations — with the regulator’s approval.'],
      ['Is paid', 'A regulated delivery charge that covers its costs plus an allowed return on its network.'],
      ['Risk', 'Regulators disallowing costs, and selling less energy than its rates assumed.'],
    ];
    control = (
      <Slider label="Allowed return on the network" tone="green" value={allowed} min={5} max={12} step={0.5} onChange={(v) => s1.set({ allowed: v })} display={`${allowed.toFixed(1)}% a year`} />
    );
    chartTop = (
      <TimeChart
        ariaLabel="Energy delivered through the day."
        height={170}
        yLabel="Delivered, MW"
        yMin={0}
        yFormat={(v) => fmt(v)}
        series={[{ values: d.demandForecast, kind: 'area', color: GRAPHIC.red, opacity: 0.25 }, { values: d.demandForecast, color: GRAPHIC.red, width: 2 }]}
      />
    );
    chartBottom = (
      <TimeChart
        ariaLabel={`Delivery revenue each hour at $${wires.deliveryCharge.toFixed(2)} per MWh.`}
        height={150}
        yLabel="Delivery revenue each hour, $"
        yMin={0}
        yFormat={axisMoney}
        series={[{ values: d.demandForecast.map((q) => q * wires.deliveryCharge), kind: 'bar', color: GRAPHIC.green }]}
      />
    );
    readouts = [
      { label: 'delivery charge per MWh', value: usd(wires.deliveryCharge, 2), tone: 'green' },
      { label: 'collected today', value: usd(delivery), tone: 'green' },
      { label: 'return on its network per year', value: money(wires.returnOnRateBase), tone: 'green' },
    ];
    caption = `The regulator lets the utility collect its operating costs, depreciation and ${allowed.toFixed(1)}% a year on the $2.4 billion it has invested in the network. Spread over the region’s energy, that’s $${wires.deliveryCharge.toFixed(2)} per MWh, whatever the wholesale price does.`;
  }

  // Second figure: one fixed rate, 120 days.
  const rate2 = s2.state.rate;
  const period = useMemo(() => retailerPeriod(HISTORY, rate2), [rate2]);
  const prev = useMemo(() => retailerPeriod(HISTORY, rate2 - 1), [rate2]);
  const solved = period.margin >= 0 && prev.margin < 0;
  const bx = scale(0, HISTORY.length, 60, 610);
  const lim = 320_000;
  const by = scale(-lim, 160_000, 220, 30);
  const bw = (610 - 60) / HISTORY.length;

  return (
    <LessonPage id="4.2">
      <P>
        In the last lesson, the market beat the planner because each plant’s owner knows its own costs. But “the market” isn’t one thing. It’s a handful of different
        kinds of organizations, each deciding something different, paid in a different way, and exposed to a different kind of risk. Most of the confusion around
        electricity markets — who sets prices, who profits from a heat wave, who pays for the wires — clears up once you know who’s who.
      </P>
      <P>
        Below is one day in the region’s market, taken from the simulated history we’ll use for the rest of the course. The diagram shows how energy (gold) and money (green)
        move between the participants. Pick a role to see the day from its side, and pick a day:
      </P>

      <Figure name="Market Role Simulator" scenario={s1}>
        <Segmented
          label="Role"
          value={role}
          onChange={(r) => s1.set({ role: r })}
          options={[
            { value: 'generator', label: 'Generator' },
            { value: 'retailer', label: 'Retailer' },
            { value: 'trader', label: 'Trader' },
            { value: 'iso', label: 'ISO' },
            { value: 'utility', label: 'Utility' },
          ]}
        />
        <Segmented
          label="Day"
          value={day}
          onChange={(v) => s1.set({ day: v })}
          options={(Object.keys(DAYS) as DayKey[]).map((k) => ({ value: k, label: DAYS[k].label }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 300"
          role="img"
          aria-label={`Money flows on this day: retailers pay the operator ${money(iso.collected)}, the operator pays generators ${money(iso.paid)} and keeps ${money(iso.rent)} of congestion rent, customers pay retailers ${money(retail)} and the wires utility ${money(delivery)}.`}
        >
          {/* Power: generators → wires → customers. */}
          <g opacity={dimFlow('generator', 'utility', 'iso') ? 0.3 : 1}>
            <path d={`M98 77 L98 240 L${320 - BOX.w / 2 - 6} 240`} fill="none" stroke={GRAPHIC.gold} strokeWidth={3} />
            <polygon points={`${320 - BOX.w / 2},240 ${320 - BOX.w / 2 - 9},235 ${320 - BOX.w / 2 - 9},245`} fill={GRAPHIC.gold} />
            <text x={108} y={160} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.gold }}>
              {mwh(energy)}
            </text>
            <text x={108} y={176} className="ax">
              of energy
            </text>
          </g>
          <Arrow x1={320 + BOX.w / 2} y1={240} x2={542 - BOX.w / 2} y2={240} color={GRAPHIC.gold} dim={dimFlow('utility')} lx={431} ly={232} />
          {/* Money. */}
          <Arrow x1={320 - BOX.w / 2} y1={50} x2={98 + BOX.w / 2} y2={50} color={GRAPHIC.green} dim={dimFlow('generator', 'iso')} label={money(iso.paid)} lx={209} ly={40} />
          <Arrow x1={542 - BOX.w / 2} y1={50} x2={320 + BOX.w / 2} y2={50} color={GRAPHIC.green} dim={dimFlow('retailer', 'iso')} label={money(iso.collected)} lx={431} ly={40} />
          <Arrow x1={542} y1={250 - BOX.h / 2} x2={542} y2={50 + BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('retailer')} label={money(retail)} lx={552} ly={155} anchor="start" />
          <Arrow x1={542 - BOX.w / 2} y1={262} x2={320 + BOX.w / 2} y2={262} color={GRAPHIC.green} dim={dimFlow('utility')} label={money(delivery)} lx={431} ly={282} />
          {trd.total >= 0 ? (
            <Arrow x1={320} y1={50 + BOX.h / 2} x2={320} y2={150 - BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('trader', 'iso')} label={money(trd.total)} lx={330} ly={104} anchor="start" />
          ) : (
            <Arrow x1={320} y1={150 - BOX.h / 2} x2={320} y2={50 + BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('trader', 'iso')} label={money(-trd.total)} lx={330} ly={104} anchor="start" />
          )}
          <Box id="generator" title="Generators" sub="nine plants" on={on('generator')} />
          <Box id="iso" title="System operator" sub={`keeps ${money(iso.rent)} rent`} on={on('iso')} />
          <Box id="retailer" title="Retailers" sub={`charge $${rate} per MWh`} on={on('retailer')} />
          <Box id="trader" title="Traders" sub={position === 0 ? 'no position' : `${Math.abs(position)} MW virtual`} on={on('trader')} />
          <Box id="utility" title="Wires utility" sub={`$${wires.deliveryCharge.toFixed(2)} per MWh`} on={on('utility')} />
          <Box id="customers" title="Customers" sub="homes and businesses" on={false} />
        </svg>
        <Legend
          items={[
            { label: 'Money', color: GRAPHIC.green, kind: 'line' },
            { label: 'Energy', color: GRAPHIC.gold, kind: 'line' },
          ]}
        />
        <RoleFacts items={facts} />
        {chartTop}
        {chartBottom}
        {control}
        <Readouts items={readouts} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with the <b>generator</b>, here Lakeside combined-cycle. It offers each hour at its running cost — mostly gas — and is paid the{' '}
        <K c="price">clearing price</K> for whatever the market schedules it to produce. On the mild Tuesday, Lakeside runs 16 hours and has $15,429 left over after
        paying its running costs, nearly all of it from the evening hours when Mill Creek’s more expensive gas set the price. In the heat wave, the same plant clears $328,619. On the hottest
        evenings the price climbs far above any plant’s running cost — the market adds a scarcity premium as spare capacity runs out, which we’ll meet properly in
        Lesson 4.6 — and Lakeside earns that premium on all 400 MW. That money isn’t profit yet: it has to cover the plant’s staff, maintenance and construction loans.
      </P>
      <P>
        The <b>retailer</b> sits at the other end. It buys power for its customers at the hourly wholesale price — here the day-ahead price, assuming for now that they use
        exactly what was forecast — and sells it to them at a fixed rate they signed up for months ago. At $45 per MWh it makes $48,812 on the mild day. On the heat-wave day, the same customers turn on their air conditioners exactly when wholesale
        prices are highest, and the retailer loses $271,037; it would have needed to charge $88.61 just to break even. A retailer makes a little on most days and carries
        the risk of a few very bad ones.
      </P>
      <P>
        The <b>trader</b> owns no plants and has no customers. It takes <b>virtual</b> positions: selling energy in the day-ahead market and buying the same amount back in
        real time, or the reverse, profiting from the difference between the two prices. We’ll see in Lesson 4.5 why those prices differ. On a calm day the gap is a few
        dollars either way. On the day Mill Creek breaks down, real-time prices top $2,000 in the evening, and a trader who sold 50 MW day-ahead in every hour loses
        $346,890 buying it back. Traders who get the direction right push the two prices closer together, the main reason most American markets allow them.
      </P>
      <P>
        The <b>system operator</b> — the ISO — runs the auctions, then keeps supply equal to demand in real time, correcting for every forecast that turns out wrong. It
        owns no plants and doesn’t try to profit; it’s typically a nonprofit, funded by a small fee on every megawatt-hour. It does end up holding money, though. When
        transmission lines into Metro or out of the North are full, prices differ between locations, and buyers in expensive places pay more than sellers in cheap places
        receive. The gap is <b>congestion rent</b>: $45,511 on the mild day and $227,595 in the heat wave. The operator passes it on to holders of transmission rights,
        which is the subject of Chapter 5.
      </P>
      <P>
        Finally, the <b>wires utility</b> owns the poles, lines and substations that carry the energy to customers. It doesn’t compete: its network is a natural
        monopoly, so a regulator sets its delivery charge to cover its costs plus an allowed return on what it has invested. With the illustrative figures in our model —
        a $2.4 billion network, an 8% return — the charge comes to $48.77 per MWh, more than the energy itself costs on a typical day. Its income hardly notices a heat wave. Customers
        usually pay both the retailer and the utility on the same bill.
      </P>

      <H2>The retailer’s gamble</H2>
      <P>
        A retailer has to pick its rate before it knows what wholesale prices will do. Below is our retailer’s margin on each of the 120 days of history at a single
        fixed rate. Find a rate that pays for itself over the whole period:
      </P>

      <Figure name="Market Role Simulator · the retailer’s 120 days" scenario={s2}>
        <svg
          className="chart"
          viewBox="0 0 620 262"
          role="img"
          aria-label={`The retailer’s daily margin over 120 days at $${rate2} per MWh: ${usd(period.margin)} in total, losing money on ${period.losingDays} days.`}
        >
          <text className="ax" x={60} y={16}>
            Retailer’s margin each day
          </text>
          <GridY y={by} ticks={[-300_000, -200_000, -100_000, 0, 100_000]} x0={60} x1={610} format={(v) => (v === 0 ? '$0' : money(v))} baseline={0} />
          {period.daily.map((m, i) => {
            const v = Math.max(-lim, Math.min(160_000, m));
            return <rect key={i} x={bx(i) + 0.6} width={Math.max(1, bw - 1.2)} y={Math.min(by(0), by(v))} height={Math.abs(by(v) - by(0))} fill={m < 0 ? GRAPHIC.red : GRAPHIC.green} />;
          })}
          {[0, 30, 60, 90, 120].map((t) => (
            <text key={t} className={t === 120 ? 'ax ax-e' : 'ax ax-m'} x={bx(t)} y={240}>
              {t === 0 ? 'day 1' : `day ${t}`}
            </text>
          ))}
        </svg>
        <Slider label="Fixed retail rate" tone="green" value={rate2} min={30} max={60} onChange={(v) => s2.set({ rate: v })} display={`$${rate2} per MWh`} />
        <Readouts
          items={[
            { label: 'margin over 120 days', value: usd(period.margin), tone: period.margin < 0 ? 'red' : 'green' },
            { label: 'days losing money', value: String(period.losingDays) },
            { label: 'worst day', value: usd(period.worst), tone: 'red' },
          ]}
        />
      </Figure>

      <Challenge
        id="a"
        question="Find the lowest fixed rate, in whole dollars, at which the retailer doesn’t lose money over the 120 days."
        solved={solved}
        status={`At $${rate2} per MWh the retailer ${period.margin >= 0 ? 'makes' : 'loses'} ${usd(Math.abs(period.margin))} over the 120 days.${period.margin >= 0 ? ' Can it charge less?' : ''}`}
        success={`Solved. $${rate2} just covers the $${period.breakEven.toFixed(2)} the retailer pays per MWh on average — more than the plain average day-ahead price of $${AVG_DA.toFixed(2)}, because its customers use the most energy when prices are highest. Even so, it loses money on ${period.losingDays} of the 120 days.`}
      />

      <P>
        The break-even rate isn’t the average wholesale price but the average weighted by what customers use, and that’s higher, because demand and prices peak
        together. A retailer that wants to sleep at night charges more than that, or buys protection against the bad days in advance. Lesson 4.5 shows the first tool for
        that, and Chapter 6 the rest.
      </P>
      <P>
        Every role here starts from the same raw material: the offers generators submit for each hour. In the <a href={lessonHref('4.3')}>next lesson</a> we’ll build one,
        and see why a change in the price of gas can reshuffle the whole stack.
      </P>
    </LessonPage>
  );
}
