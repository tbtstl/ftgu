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
  hour,
  lessonHref,
  mw,
  mwh,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { standardHistory } from '../../model/history';
import { dayAheadSchedule, generatorDay, retailerDay, retailerPeriod, traderDay, wiresUtility, RETAILER_SHARE } from '../../engines/market/roles';

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

const BOX = { w: 156, h: 54 };
const POS: Record<string, { x: number; y: number }> = {
  generator: { x: 98, y: 44 },
  iso: { x: 320, y: 44 },
  retailer: { x: 542, y: 44 },
  trader: { x: 320, y: 135 },
  utility: { x: 320, y: 226 },
  customers: { x: 542, y: 226 },
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

/** Contiguous runs of hours as chart bands. */
function runs(on: boolean[], color: string) {
  const bands: Array<{ from: number; to: number; color: string }> = [];
  on.forEach((x, h) => {
    if (!x) return;
    const last = bands[bands.length - 1];
    if (last && last.to === h) last.to = h + 1;
    else bands.push({ from: h, to: h + 1, color });
  });
  return bands;
}

const HISTORY = standardHistory();
const AVG_DA = HISTORY.flatMap((x) => x.da).reduce((a, b) => a + b, 0) / (HISTORY.length * 24);
/** Fixed in the first demonstration: the retailer’s rate, the trader’s position, the utility’s allowed return. */
const RATE = 45;
const POSITION = 50;
const WIRES = wiresUtility(0.08);
const RUN_BAND = 'rgba(231, 91, 85, 0.14)';
const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

export default function Lesson() {
  const s1 = useScenario('roles', { role: 'generator' as Role, day: 'mild' as DayKey });
  const s2 = useScenario('retailer-days', { rate: 45 });
  const { role, day } = s1.state;

  const d = HISTORY[DAYS[day].index];
  const schedule = useMemo(() => dayAheadSchedule(d), [d]);
  const gen = generatorDay(d, 'cc1', schedule);
  const ret = retailerDay(d, RATE);
  const trd = traderDay(d, POSITION);
  const energy = d.demandForecast.reduce((s, v) => s + v, 0);
  // Treating the region as one price: buyers pay the day-ahead price for the forecast, and the operator passes it on to sellers.
  const wholesale = d.demandForecast.reduce((s, q, h) => s + q * d.da[h], 0);
  const retail = RATE * energy;
  const delivery = WIRES.deliveryCharge * energy;
  const miss = d.demand.reduce((m, q, h) => (Math.abs(q - d.demandForecast[h]) > Math.abs(m.mw) ? { mw: q - d.demandForecast[h], h } : m), { mw: 0, h: 0 });
  const used = d.demand.reduce((s, v) => s + v, 0);

  const on = (r: string) => r === role;
  const dimFlow = (...rs: string[]) => !rs.includes(role);
  const priceFmt = (v: number) => '$' + fmt(v);
  const CHART_H = 170;

  let legend: Array<{ label: string; color: string; kind?: 'box' | 'line'; dashed?: boolean }> = [];
  let chart: ReactNode = null;
  let readouts: Array<{ label: ReactNode; value: ReactNode; tone?: 'green' | 'red' | 'gold' | 'ink' }> = [];
  let caption = '';

  if (role === 'generator') {
    legend = [
      { label: 'Day-ahead price', color: GRAPHIC.green, kind: 'line' },
      { label: 'Lakeside’s running cost', color: '#555', kind: 'line', dashed: true },
      { label: 'Hours Lakeside runs', color: RUN_BAND },
    ];
    chart = (
      <TimeChart
        ariaLabel={`Day-ahead price and Lakeside’s running cost of ${usd(gen.cost, 2)} per MWh through the day; Lakeside runs ${gen.hoursRun} hours.`}
        height={CHART_H}
        yLabel="Day-ahead price, $/MWh"
        yFormat={priceFmt}
        bands={runs(gen.output.map((q) => q > 1e-6), RUN_BAND)}
        series={[
          { values: d.da, kind: 'step', color: GRAPHIC.green, width: 2.5 },
          { values: d.da.map(() => gen.cost), color: '#555', dash: '5 4', width: 1.5 },
        ]}
      />
    );
    readouts = [
      { label: 'hours Lakeside runs', value: `${gen.hoursRun} of 24` },
      { label: 'left after its running costs', value: usd(gen.margin), tone: 'green' },
    ];
    caption = 'Whenever a more expensive plant sets the price, Lakeside earns the difference on every megawatt-hour it produces.';
  } else if (role === 'retailer') {
    legend = [
      { label: 'Day-ahead price', color: GRAPHIC.green, kind: 'line' },
      { label: `The retailer’s fixed rate, $${RATE}`, color: '#333', kind: 'line' },
    ];
    chart = (
      <TimeChart
        ariaLabel={`Day-ahead price against the retailer’s fixed rate of $${RATE} per MWh; the retailer’s margin for the day is ${usd(ret.margin)}.`}
        height={CHART_H}
        yLabel="Price, $/MWh"
        yFormat={priceFmt}
        series={[{ values: d.da, kind: 'step', color: GRAPHIC.green, width: 2.5 }]}
        refLines={[{ y: RATE, color: '#333' }]}
      />
    );
    readouts = [
      { label: 'margin for the day', value: usd(ret.margin), tone: ret.margin < 0 ? 'red' : 'green' },
      { label: 'rate that would break even', value: usd(ret.breakEven, 2), tone: 'green' },
    ];
    caption = `Serving ${fmt(RETAILER_SHARE * 100)}% of the region’s customers, it earns in every hour the price is below its rate and loses in every hour it’s above.`;
  } else if (role === 'trader') {
    legend = [
      { label: 'Day-ahead price', color: TEXT.green, kind: 'line' },
      { label: 'Real-time price', color: '#9bbf6f', kind: 'line' },
    ];
    chart = (
      <TimeChart
        ariaLabel={`Day-ahead and real-time prices through the day; selling ${POSITION} MW day-ahead every hour ${trd.total >= 0 ? 'earns' : 'loses'} ${usd(Math.abs(trd.total))}.`}
        height={CHART_H}
        yLabel="Price, $/MWh"
        yFormat={priceFmt}
        series={[
          { values: d.rt, kind: 'step', color: '#9bbf6f', width: 2 },
          { values: d.da, kind: 'step', color: TEXT.green, width: 2.5 },
        ]}
      />
    );
    readouts = [
      { label: 'average day-ahead price', value: usd(avg(d.da), 2), tone: 'green' },
      { label: 'average real-time price', value: usd(avg(d.rt), 2), tone: 'green' },
    ];
    caption = `It sold ${POSITION} MW day-ahead in every hour and buys it back in real time, gaining when real time comes in lower and losing when it comes in higher.`;
  } else if (role === 'iso') {
    legend = [
      { label: 'Forecast demand', color: '#777', kind: 'line', dashed: true },
      { label: 'Actual demand', color: '#333', kind: 'line' },
    ];
    chart = (
      <TimeChart
        ariaLabel={`Forecast and actual demand through the day; the largest gap is ${mw(Math.abs(miss.mw))} at ${hour(miss.h)}.`}
        height={CHART_H}
        yLabel="Demand, MW"
        yFormat={(v) => fmt(v)}
        series={[
          { values: d.demandForecast, color: '#777', dash: '6 4', width: 2 },
          { values: d.demand, color: '#333', width: 2.5 },
        ]}
      />
    );
    readouts = [
      { label: 'customers actually used', value: mwh(used), tone: 'gold' },
      { label: `largest gap from the forecast, at ${hour(miss.h)}`, value: mw(Math.abs(miss.mw)) },
    ];
    caption = 'The day-ahead market cleared on the forecast. Covering the gap to what customers actually use, hour by hour, is the operator’s job in real time.';
  } else {
    legend = [
      { label: 'Day-ahead price of energy', color: GRAPHIC.green, kind: 'line' },
      { label: 'Delivery charge', color: GRAPHIC.red, kind: 'line' },
    ];
    chart = (
      <TimeChart
        ariaLabel={`The day-ahead price of energy through the day against the flat delivery charge of ${usd(WIRES.deliveryCharge, 2)} per MWh.`}
        height={CHART_H}
        yLabel="$ per MWh delivered"
        yMin={0}
        yFormat={priceFmt}
        series={[
          { values: d.da, kind: 'step', color: GRAPHIC.green, width: 2.5 },
          { values: d.da.map(() => WIRES.deliveryCharge), color: GRAPHIC.red, width: 2.5 },
        ]}
      />
    );
    readouts = [
      { label: 'delivery charge per MWh', value: usd(WIRES.deliveryCharge, 2), tone: 'green' },
      { label: 'energy’s average price today', value: usd(avg(d.da), 2), tone: 'green' },
    ];
    caption = 'The regulator sets the delivery charge to cover the network’s costs and an allowed return on it, whatever the wholesale price does.';
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
        Here is one day in the region’s market, taken from the simulated history we’ll use for the rest of the course, with the region treated as a single place and one
        price each hour. The diagram shows how energy (gold) and money (green) move between the participants. Pick a role to see the day from its side, and pick a day:
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
          viewBox="0 0 640 268"
          role="img"
          aria-label={`Money flows on this day: retailers pay the operator ${money(wholesale)} for ${mwh(energy)} of energy, which it passes on to the generators; customers pay retailers ${money(retail)} and the wires utility ${money(delivery)}; traders ${trd.total >= 0 ? 'collect' : 'pay'} ${money(Math.abs(trd.total))}.`}
        >
          {/* Power: generators → wires → customers. */}
          <g opacity={dimFlow('generator', 'utility', 'iso') ? 0.3 : 1}>
            <path d={`M98 71 L98 216 L${320 - BOX.w / 2 - 6} 216`} fill="none" stroke={GRAPHIC.gold} strokeWidth={3} />
            <polygon points={`${320 - BOX.w / 2},216 ${320 - BOX.w / 2 - 9},211 ${320 - BOX.w / 2 - 9},221`} fill={GRAPHIC.gold} />
            <text x={108} y={138} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.gold }}>
              {mwh(energy)}
            </text>
            <text x={108} y={154} className="ax">
              of energy
            </text>
          </g>
          <Arrow x1={320 + BOX.w / 2} y1={216} x2={542 - BOX.w / 2} y2={216} color={GRAPHIC.gold} dim={dimFlow('utility')} lx={431} ly={208} />
          {/* Money. */}
          <Arrow x1={320 - BOX.w / 2} y1={44} x2={98 + BOX.w / 2} y2={44} color={GRAPHIC.green} dim={dimFlow('generator', 'iso')} label={money(wholesale)} lx={209} ly={34} />
          <Arrow x1={542 - BOX.w / 2} y1={44} x2={320 + BOX.w / 2} y2={44} color={GRAPHIC.green} dim={dimFlow('retailer', 'iso')} label={money(wholesale)} lx={431} ly={34} />
          <Arrow x1={542} y1={226 - BOX.h / 2} x2={542} y2={44 + BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('retailer')} label={money(retail)} lx={552} ly={140} anchor="start" />
          <Arrow x1={542 - BOX.w / 2} y1={238} x2={320 + BOX.w / 2} y2={238} color={GRAPHIC.green} dim={dimFlow('utility')} label={money(delivery)} lx={431} ly={258} />
          {trd.total >= 0 ? (
            <Arrow x1={320} y1={44 + BOX.h / 2} x2={320} y2={135 - BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('trader', 'iso')} label={money(trd.total)} lx={330} ly={94} anchor="start" />
          ) : (
            <Arrow x1={320} y1={135 - BOX.h / 2} x2={320} y2={44 + BOX.h / 2} color={GRAPHIC.green} dim={dimFlow('trader', 'iso')} label={money(-trd.total)} lx={330} ly={94} anchor="start" />
          )}
          <Box id="generator" title="Generators" sub="nine plants" on={on('generator')} />
          <Box id="iso" title="System operator" sub="runs the auctions" on={on('iso')} />
          <Box id="retailer" title="Retailers" sub={`charge $${RATE} per MWh`} on={on('retailer')} />
          <Box id="trader" title="Traders" sub={`sold ${POSITION} MW day-ahead`} on={on('trader')} />
          <Box id="utility" title="Wires utility" sub="poles and wires" on={on('utility')} />
          <Box id="customers" title="Customers" sub="homes and businesses" on={false} />
        </svg>
        <Legend
          items={[
            { label: 'Money', color: GRAPHIC.green, kind: 'line' },
            { label: 'Energy', color: GRAPHIC.gold, kind: 'line' },
          ]}
        />
        <Legend items={legend} />
        {chart}
        <Readouts items={readouts} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        This demonstration starts on Generator and the mild Tuesday. The <b>generator</b> here is Lakeside combined-cycle. It offers each hour at its running cost —
        mostly gas — and is paid the <K c="price">clearing price</K> for whatever the market schedules it to produce. On the mild Tuesday, Lakeside runs 16 hours and
        has $15,429 left over after paying its running costs, nearly all of it from the evening hours when Mill Creek’s more expensive gas set the price. Pick Heat wave,
        and the same plant nets $328,619: on the hottest evenings, as spare capacity runs out, the price climbs far above any plant’s running cost, and Lakeside earns the
        difference on all 400 MW. That money isn’t profit yet: it has to cover the plant’s staff, maintenance and construction loans.
      </P>
      <P>
        Now switch to Retailer, still on the heat wave. The <b>retailer</b> sits at the other end. It buys power for its customers at the hourly wholesale price — here the
        day-ahead price, assuming for now that they use exactly what was forecast — and sells it to them at a fixed rate they signed up for months ago, $45 per MWh in
        this demonstration. On the heat-wave day, its customers turn on their air conditioners exactly when wholesale prices are highest, and the retailer loses $271,037;
        it would have needed to charge $88.61 just to break even. On the mild Tuesday, the same rate makes $48,812. A retailer makes a little on most days and carries the
        risk of a few very bad ones.
      </P>
      <P>
        Switch to Trader and pick Plant outage. The <b>trader</b> owns no plants and has no customers. It takes <b>virtual</b> positions: selling energy in the day-ahead
        market and buying the same amount back in real time, or the reverse, profiting from the difference between the two prices. They differ whenever the day turns out
        differently from the forecasts the day-ahead market cleared on. On a calm day the gap is a few dollars either way. On the day Mill Creek breaks down, real-time
        prices top $2,000 in the evening, and our trader, who sold 50 MW day-ahead in every hour, loses $346,890 buying it back; one who had bought instead would have made
        the same amount. Traders who get the direction right push the two prices closer together, the main reason most American markets allow them.
      </P>
      <P>
        Switch to ISO and go back to the mild Tuesday. The <b>system operator</b> — the ISO — runs the auctions, then keeps supply equal to demand in real time,
        correcting for every forecast that turns out wrong. The chart compares the forecast the day-ahead market cleared on with what customers actually used. On the
        mild Tuesday the two are never more than 30 MW apart, but every one of those megawatts has to be found, or backed off, as it happens. The operator owns no plants
        and doesn’t try to profit; it’s typically a nonprofit, funded by a small fee on every megawatt-hour. The money for energy only passes through it, from the
        retailers who buy to the generators who sell.
      </P>
      <P>
        Finally, switch to Utility. The <b>wires utility</b> owns the poles, lines and substations that carry the energy to customers. It doesn’t compete: its network
        is a natural monopoly, so a regulator sets its delivery charge to cover its costs plus an allowed return on what it has invested. With the illustrative figures in
        our model — a $2.4 billion network, an 8% return — the charge comes to $48.77 per MWh, more than the energy itself costs on a typical day: on the mild Tuesday,
        energy averages $34.76. Its income hardly notices a heat wave. Customers usually pay both the retailer and the utility on the same bill, and in regions without
        retail competition, the wires utility is also the retailer.
      </P>

      <H2>The retailer’s gamble</H2>
      <P>
        A retailer has to pick its rate before it knows what wholesale prices will do. The next demonstration shows our retailer’s margin on each of the 120 days of
        history at a single fixed rate. Find a rate that pays for itself over the whole period:
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
        question={`Over the 120 days, the day-ahead price averaged $${AVG_DA.toFixed(2)} per MWh. Is a $${Math.ceil(AVG_DA)} rate enough? Find the lowest whole-dollar rate at which the retailer doesn’t lose money over the period.`}
        solved={solved}
        status={`At $${rate2} per MWh the retailer ${period.margin >= 0 ? 'makes' : 'loses'} ${usd(Math.abs(period.margin))} over the 120 days.${period.margin >= 0 ? ' Can it charge less?' : ''}`}
        success={`Solved. $${rate2} just covers the $${period.breakEven.toFixed(2)} the retailer pays per MWh on average — more than the plain average day-ahead price of $${AVG_DA.toFixed(2)}, because its customers use the most energy when prices are highest. Even so, it loses money on ${period.losingDays} of the 120 days.`}
      />

      <P>
        The break-even rate isn’t the average wholesale price but the average weighted by what customers use, and that’s higher, because demand and prices peak
        together. A retailer that wants to sleep at night charges more than that, or buys protection against the bad days in advance;{' '}
        <a href={lessonHref('4.5')}>Lesson 4.5</a> shows the first way to do it.
      </P>
      <P>
        Every role here starts from the same raw material: the offers generators submit for each hour. In the <a href={lessonHref('4.3')}>next lesson</a> we’ll build one,
        and see why a change in the price of gas can reshuffle the whole stack.
      </P>
    </LessonPage>
  );
}
