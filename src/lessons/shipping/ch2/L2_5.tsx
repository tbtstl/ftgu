import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
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
  fmt,
  lessonHref,
  niceTicks,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { invest, DEPOSIT, SECONDHAND_AGE, type InvestKind } from '../../../engines/shipping/investment';
import { classScrapValue, shipValue, type CycleMonth } from '../../../engines/shipping/cycle';
import { historyWith, standardHistory, monthLabel, HISTORY_MONTHS } from '../../../model/shipping/history';
import { DEFAULT_CYCLE } from '../../../engines/shipping/cycle';
import { DEFAULTS as COSTS_DEFAULTS, maxPriceFor } from './L2_4';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory().cls.kmax;
const LAG = DEFAULT_CYCLE.lag;
/** Last month a newbuilding can be ordered and still be delivered within the history. */
export const LAST_ORDER = HISTORY_MONTHS - LAG - 1;
/** Last month a secondhand ship can be bought and held for a year. */
export const LAST_PURCHASE = HISTORY_MONTHS - 13;
export const TARGET_RETURN = 0.2;

/** The shipyard lags the reader can try, months; 30 is the history's own. */
export const LAGS = ['12', '30', '48'] as const;
export type Lag = (typeof LAGS)[number];
/** The history rerun with every shipyard delivering `lag` months after the order (the standard one at 30). */
export function lagHistory(lag: number): CycleMonth[] {
  return lag === LAG ? HIST : historyWith({ lag }).cls.kmax;
}
/** Last month a newbuilding can be ordered and still be delivered within the history, for a lag. */
export const lastOrder = (lag: number) => HISTORY_MONTHS - lag - 1;

/** Prices in $ million, as the whole chapter writes them: $32.0 million. */
const $m = (x: number) => `${usd(x / 1e6, 1)} million`;
const perDay = (x: number) => `$${fmt(x)}/day`;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/** The challenge: a newbuilding that earns at least 20% a year on the money put in, in the history as it happened (30-month lag). */
export function returnSolved(kind: InvestKind, month: number, lag: number = LAG): boolean {
  if (kind !== 'newbuild' || lag !== LAG || month > LAST_ORDER) return false;
  return invest('kmax', HIST, 'newbuild', month).irr >= TARGET_RETURN - 1e-9;
}

export interface YearRow {
  year: number;
  tce: number;
  orders: number;
  deliveries: number;
  scrapped: number;
  fleet: number;
  book: number;
  avgAge: number;
  ages: number[];
  bookByYear: number[];
}

export const YEARS: YearRow[] = Array.from({ length: HISTORY_MONTHS / 12 }, (_, y) => {
  const m = HIST.slice(y * 12, y * 12 + 12);
  const last = m[11];
  return {
    year: y + 1,
    tce: sum(m.map((x) => x.tce)) / 12,
    orders: sum(m.map((x) => x.orders)),
    deliveries: sum(m.map((x) => x.deliveries)),
    scrapped: sum(m.map((x) => x.scrapped)),
    fleet: last.fleet,
    book: last.orderbook,
    avgAge: sum(last.ages.map((c, a) => c * (a + 0.5))) / sum(last.ages),
    ages: last.ages,
    bookByYear: last.bookByYear,
  };
});

/** The first boom and its aftermath: Years 1–8. */
const FIRST = YEARS.slice(0, 8);
const PEAK_ORDERS = FIRST.reduce((a, b) => (b.orders > a.orders ? b : a));
const PEAK_DELIV = FIRST.reduce((a, b) => (b.deliveries > a.deliveries ? b : a));
const PEAK_SCRAP = YEARS.reduce((a, b) => (b.scrapped > a.scrapped ? b : a));
const PEAK_BOOK = FIRST.reduce((a, b) => (b.book / b.fleet > a.book / a.fleet ? b : a));
const NB_MIN = Math.min(...HIST.map((m) => m.newbuild));
const NB_MAX = Math.max(...HIST.map((m) => m.newbuild));
const SH_MIN = Math.min(...HIST.map((m) => m.secondhand));
const SH_MAX = Math.max(...HIST.map((m) => m.secondhand));
const TCE_MIN = Math.min(...HIST.map((m) => m.tce));
const TCE_MAX = Math.max(...HIST.map((m) => m.tce));
/** The boom's most expensive order month, and an order in the slump, for the prose. */
const NB_BOOM_MAX = Math.max(...HIST.slice(0, LAST_ORDER + 1).map((m) => m.newbuild));
const PEAK_NB_MONTH = HIST.findIndex((m) => m.newbuild === NB_BOOM_MAX);
const BOOM = invest('kmax', HIST, 'newbuild', PEAK_NB_MONTH);
export const BOOM_MONTH = 30;
export const SLUMP_MONTH = 84;
const SLUMP = invest('kmax', HIST, 'newbuild', SLUMP_MONTH);
export const SOLUTIONS = Array.from({ length: LAST_ORDER + 1 }, (_, m) => m).filter((m) => returnSolved('newbuild', m));
/** The dearest newbuilding among the challenge's answers, $ million. */
const SOL_NB_MAX = Math.max(...SOLUTIONS.map((m) => HIST[m].newbuild));

/** The prose's two orders, Year 3 July and Year 8 January, in the history rerun with another shipyard lag. */
export function lagCase(lag: number) {
  const h = lagHistory(lag);
  return {
    peak: Math.max(...h.map((m) => m.tce)),
    boom: invest('kmax', h, 'newbuild', BOOM_MONTH, lag).irr,
    slump: invest('kmax', h, 'newbuild', SLUMP_MONTH, lag).irr,
  };
}
const LAG12 = lagCase(12);
const LAG30 = lagCase(LAG);
const LAG48 = lagCase(48);
/** Percentage points between the slump order's return and the boom order's. */
const gap = (c: ReturnType<typeof lagCase>) => 100 * (c.slump - c.boom);

/** A new Kamsarmax valued at a steady $15,000 a day for life, $ — against Lesson 2.4's full-cost answer at that rate. */
export const PV_RATE_TCE = 15_000;
export const PV_15K = shipValue('kmax', 0, PV_RATE_TCE, PV_RATE_TCE);
const FULL_COST_PRICE = maxPriceFor({ ...COSTS_DEFAULTS, tce: PV_RATE_TCE });

const MONTHS = HIST.map((_, i) => i / 12);
/** Earnings in the history as it happened, drawn faintly when the reader reruns it with another lag. */
const TCE_30 = HIST.map((m) => m.tce);

export default function Lesson() {
  const inv = useScenario('investment', { kind: 'newbuild' as InvestKind, month: BOOM_MONTH, lag: String(LAG) as Lag });
  const { kind } = inv.state;
  const lag = Number(inv.state.lag);
  const hist = useMemo(() => lagHistory(lag), [lag]);
  const maxMonth = kind === 'newbuild' ? lastOrder(lag) : LAST_PURCHASE;
  const month = Math.min(inv.state.month, maxMonth);
  const r = invest('kmax', hist, kind, month, lag);
  const solved = returnSolved(kind, month, lag);
  const series = useMemo(
    () => ({ tce: hist.map((m) => m.tce), nb: hist.map((m) => m.newbuild), sh: hist.map((m) => m.secondhand) }),
    [hist],
  );
  const range = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];
  const [tceLo, tceHi] = range(series.tce);
  const [nbLo, nbHi] = range(series.nb);
  const [shLo, shHi] = range(series.sh);
  const rerun = lag !== LAG;
  const held = (HISTORY_MONTHS - r.deliveryMonth) / 12;

  const wf = useScenario('world-fleet', { year: 5 });
  const yr = YEARS[wf.state.year - 1];

  // Demonstration 2's bar chart geometry.
  const BX0 = 60;
  const BX1 = 624;
  const slot = (BX1 - BX0) / YEARS.length;
  const maxBar = Math.max(...YEARS.flatMap((y) => [y.orders, y.deliveries, y.scrapped]));
  const yTop = niceTicks(0, maxBar, 4);
  const yMax = yTop[yTop.length - 1] < maxBar ? yTop[yTop.length - 1] + (yTop[1] - yTop[0]) : yTop[yTop.length - 1];
  const by = scale(0, yMax, 176, 24);
  const BARS = [
    { key: 'orders' as const, name: 'Ordered', color: '#9a9a9a' },
    { key: 'deliveries' as const, name: 'Delivered', color: GRAPHIC.teal },
    { key: 'scrapped' as const, name: 'Scrapped', color: GRAPHIC.red },
  ];
  // Age profile geometry.
  const ageMax = Math.max(...YEARS.flatMap((y) => [...y.ages, ...y.bookByYear]));
  const AX0 = 60;
  const AX1 = 624;
  const aw = (AX1 - AX0) / 32;
  const ay = scale(0, Math.ceil(ageMax / 20) * 20, 150, 20);

  return (
    <LessonPage id="shipping/2.5">
      <P>
        <a href={lessonHref('shipping/2.4')}>The previous lesson</a> ended with a ship’s age: old ships are cheap to own and dear to run, so when earnings fall
        they are the first to stop paying their way. That is one end of a ship’s life. The other is a shipyard, and between the two lie twenty-five years or so in
        which the ship earns whatever the market pays. Ships take years to build and decades to wear out, while cargoes can change in months. This lesson asks what
        that mismatch does to the people who buy ships, and to the supply of ships itself.
      </P>
      <P>
        To see it we need a market that moves. The course’s market model — which <a href={lessonHref('shipping/4.4')}>Chapter 4</a> will take apart — has
        produced twelve years of history for the world’s Kamsarmaxes, month by month: what ships like Kestrel earned, what shipyards charged for new ones and
        what a five-year-old ship changed hands for. It is a simulation, not market data, but it was produced the way real markets work, by owners ordering ships
        when ships were worth more than they cost to build. Earnings in it ran from {perDay(TCE_MIN)} to {perDay(TCE_MAX)}.
      </P>
      <P>
        Suppose Northwind Bulk wants a second Kamsarmax. It can <b>order a newbuilding</b>: pay a {pct(DEPOSIT)} deposit to a shipyard, the rest when she is
        delivered {LAG} months later, and own a new ship. Or it can <b>buy a secondhand ship</b>: a {SECONDHAND_AGE}-year-old Kamsarmax, paid for and delivered
        at once. Either way the ship then trades on the <b>spot market</b>, taking one cargo after another at whatever the market pays at the time — in our model,
        the month’s TCE on each of her earning days — and paying her operating costs every day, until the end of Year 12, when she is valued at what the market
        would then pay for a ship of her age. The demonstration sums this up as a <b>return a year on the money put in</b>, which bankers call the internal rate of
        return: the yearly interest rate at which Northwind’s payments would grow into exactly what the ship brings back — her earnings less running costs, plus
        that final value, which is a valuation, not a sale. In the next demonstration, choose how to buy and when, and leave the shipyard lag at {LAG} months for
        now:
      </P>

      <Figure name="Fleet Investment Simulator" scenario={inv}>
        <Segmented
          label="How to buy"
          value={kind}
          onChange={(k) => inv.set({ kind: k, month: Math.min(inv.state.month, k === 'newbuild' ? lastOrder(lag) : LAST_PURCHASE) })}
          options={[
            { value: 'newbuild', label: 'Order a newbuilding' },
            { value: 'secondhand', label: `Buy a ${SECONDHAND_AGE}-year-old ship` },
          ]}
        />
        <Segmented label="Shipyard lag" value={inv.state.lag} onChange={(v) => inv.set({ lag: v })} options={LAGS.map((l) => ({ value: l, label: `${l}-month lag` }))} />
        <XYChart
          ariaLabel={`Kamsarmax earnings over twelve simulated years${rerun ? `, rerun with every shipyard delivering ${lag} months after the order` : ''}, from ${perDay(tceLo)} to ${perDay(tceHi)}. ${kind === 'newbuild' ? `Ordered in ${monthLabel(month)}, delivered ${monthLabel(r.deliveryMonth)}.` : `Bought in ${monthLabel(month)}.`}`}
          series={[
            ...(rerun ? [{ xs: MONTHS, ys: TCE_30, color: '#a8a8a8', width: 1.5, dash: '4 3' }] : []),
            { xs: MONTHS, ys: series.tce, color: GRAPHIC.green, width: 2 },
          ]}
          xMin={0}
          xMax={12}
          yMin={0}
          yMax={80_000}
          yTicks={[0, 20_000, 40_000, 60_000, 80_000]}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 0 ? 'Year 1' : v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
          yLabel="Earnings, $ per day (TCE)"
          height={170}
          bands={kind === 'newbuild' ? [{ from: month / 12, to: r.deliveryMonth / 12, color: tint(GRAPHIC.gray, 0.18), label: 'building' }] : []}
          cursor={month / 12}
          overlay={(x) => (
            <line x1={x(r.deliveryMonth / 12)} x2={x(r.deliveryMonth / 12)} y1={26} y2={146} stroke={GRAPHIC.teal} strokeWidth={2} />
          )}
        />
        <XYChart
          ariaLabel={`Ship prices: newbuildings between ${$m(nbLo * 1e6)} and ${$m(nbHi * 1e6)}, five-year-old ships between ${$m(shLo * 1e6)} and ${$m(shHi * 1e6)}. In ${monthLabel(month)} a newbuilding cost ${$m(hist[month].newbuild * 1e6)} and a five-year-old ship ${$m(hist[month].secondhand * 1e6)}.`}
          series={[
            { xs: MONTHS, ys: series.nb, color: '#8a8a8a', width: 2 },
            { xs: MONTHS, ys: series.sh, color: GRAPHIC.orange, width: 2 },
          ]}
          xMin={0}
          xMax={12}
          yMin={15}
          yMax={45}
          yTicks={[20, 30, 40]}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 0 ? 'Year 1' : v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => fmt(v)}
          yLabel="Ship prices, $ million"
          height={150}
          cursor={month / 12}
          markers={[{ x: month / 12, y: kind === 'newbuild' ? hist[month].newbuild : hist[month].secondhand, color: kind === 'newbuild' ? TEXT.gray : TEXT.orange }]}
        />
        <Legend
          items={[
            { label: 'Newbuilding price', color: '#8a8a8a', kind: 'line' },
            { label: `${SECONDHAND_AGE}-year-old ship’s price`, color: GRAPHIC.orange, kind: 'line' },
            ...(rerun ? [{ label: `Earnings with the history’s ${LAG}-month lag`, color: '#a8a8a8', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <Readouts
          items={[
            { label: 'price paid', value: $m(r.price), tone: 'green' },
            { label: 'earnings less operating costs', value: $m(r.earnings - r.opex), tone: 'green' },
            { label: `value at the end, aged ${fmt(r.ageAtEnd, 1)} years`, value: $m(r.endValue), tone: 'green' },
            { label: 'return a year on the money put in', value: Number.isFinite(r.irr) ? pct(r.irr, 1) : '—', tone: r.irr >= TARGET_RETURN ? 'green' : undefined },
          ]}
        />
        <Slider
          label={kind === 'newbuild' ? 'Order placed' : 'Bought'}
          tone="teal"
          value={month}
          min={0}
          max={maxMonth}
          onChange={(v) => inv.set({ month: v })}
          display={monthLabel(month)}
        />
        <Caption>
          {rerun ? `In the history rerun with a ${lag}-month lag: ` : ''}
          {kind === 'newbuild'
            ? `${rerun ? 'o' : 'O'}rdered in ${monthLabel(month)}, she is delivered in ${monthLabel(r.deliveryMonth)}, when the market pays ${perDay(hist[r.deliveryMonth].tce)}, and trades for ${fmt(held, 1)} years.`
            : `${rerun ? 'b' : 'B'}ought in ${monthLabel(month)}, when the market pays ${perDay(hist[month].tce)}, she trades for ${fmt(held, 1)} years.`}
        </Caption>
      </Figure>

      <P>
        Start in July of Year 3, in the middle of the boom. Earnings have nearly doubled in two years — they average {perDay(YEARS[2].tce)} in Year 3,
        against {perDay(YEARS[0].tce)} in Year 1 — and every owner can see it: a newbuilding costs {$m(HIST[BOOM_MONTH].newbuild * 1e6)} and a five-year-old
        ship {$m(HIST[BOOM_MONTH].secondhand * 1e6)}, more than a new one. That isn’t a mistake. The secondhand ship can start earning today’s rates today; the
        newbuilding won’t arrive for {LAG} months. Ordered then, the newbuilding is delivered in {monthLabel(BOOM_MONTH + LAG)}, into a market paying{' '}
        {perDay(HIST[BOOM_MONTH + LAG].tce)}, and over the history returns {pct(LAG30.boom, 1)} a year. Order when the shipyards’ prices peak, in{' '}
        {monthLabel(PEAK_NB_MONTH)} at {$m(BOOM.price)}, and the return is {pct(BOOM.irr, 1)}.
      </P>

      <Challenge
        id="a"
        question={`Northwind wants a newbuilding that earns at least ${pct(TARGET_RETURN)} a year on its money by the end of the history. Predict first: should it order while earnings are high, or after they have fallen — and roughly when? Then find a month whose order does it.`}
        solved={solved}
        status={
          kind !== 'newbuild'
            ? 'Switch to ordering a newbuilding.'
            : rerun
              ? `Set the shipyard lag back to ${LAG} months, the history’s own.`
              : month === BOOM_MONTH
                ? 'Make your prediction, then move the order.'
                : `Ordered in ${monthLabel(month)}, she returns ${Number.isFinite(r.irr) ? pct(r.irr, 1) : 'nothing measurable'} a year.`
        }
        success={`Solved — after the boom, not during it. Every order from ${monthLabel(SOLUTIONS[0])} to ${monthLabel(SOLUTIONS[SOLUTIONS.length - 1])} clears ${pct(TARGET_RETURN)}, and none placed in the first six years does. All were placed after the first boom had run its course, with shipyards asking ${$m(SOL_NB_MAX * 1e6)} or less, and all were delivered between ${monthLabel(SOLUTIONS[0] + LAG)} and ${monthLabel(SOLUTIONS[SOLUTIONS.length - 1] + LAG)}: in time to trade through the boom of Years 11 and 12, or at least to be valued while it lasts. The last of them earn most of their return on paper, from that end value.`}
      />

      <P>
        Take one order that clears it, placed in {monthLabel(SLUMP_MONTH)}. Kamsarmaxes then earn {perDay(HIST[SLUMP_MONTH].tce)}, and a newbuilding costs{' '}
        {$m(SLUMP.price)}, against {$m(HIST[BOOM_MONTH].newbuild * 1e6)} in the boom. She arrives in {monthLabel(SLUMP.deliveryMonth)}, into a market still paying
        only {perDay(HIST[SLUMP.deliveryMonth].tce)}, but in time to trade through the boom of Years 11 and 12, and returns {pct(SLUMP.irr, 1)} a year.
        The ship is identical; only the timing changed. Owners who trade ships this way call it <b>asset play</b>: buying ships cheap and selling them dear, with
        the voyages in between mattering less than the dates.
      </P>

      <H2>The shipyards’ lag</H2>
      <P>
        Why does timing matter so much? Because of the wait. Set the shipyard lag in <FigRef to="Fleet Investment Simulator">this demonstration</FigRef> to 12
        months: the model reruns all twelve years with every owner’s newbuildings, not just Northwind’s, arriving a year after they are ordered. Owners still order
        heavily in the boom, but their ships arrive while the shortage is still there and cut it short: earnings never rise above {perDay(LAG12.peak)}, against{' '}
        {perDay(LAG30.peak)} with the {LAG}-month lag. Ordered in {monthLabel(BOOM_MONTH)}, a newbuilding now returns {pct(LAG12.boom, 1)} a year; ordered in{' '}
        {monthLabel(SLUMP_MONTH)}, {pct(LAG12.slump, 1)} — {fmt(gap(LAG12))} percentage points apart, against {fmt(gap(LAG30))}. Stretch the lag to 48 months and the cycle
        swings harder: earnings reach {perDay(LAG48.peak)}, and the same two orders return {pct(LAG48.boom, 1)} and {pct(LAG48.slump, 1)}. A short lag doesn’t make
        shipping more profitable — in our model every order earns less — but it makes timing matter far less. The asset play is a bet on the shipyards’ lag.
      </P>

      <H2>Prices follow earnings</H2>
      <P>
        Look at the two price lines, with the lag back at {LAG} months. A ship is worth what she can earn. Owners add up the earnings they expect from her, less
        her operating costs, over the rest of her life, plus what a breaker will pay for her steel at the end — {$m(classScrapValue('kmax'))} for a Kamsarmax at
        our illustrative scrap price. But a dollar that arrives years from now is worth less than a dollar today, which could be earning interest meanwhile, so
        each year’s money is first discounted, here by 8% for every year it lies ahead. The total is her <K tone="green">present value</K>. At a steady{' '}
        {perDay(PV_RATE_TCE)} for life, a new Kamsarmax is worth {$m(PV_15K)} this way — close to the{' '}
        {FULL_COST_PRICE === null ? 'price' : $m(FULL_COST_PRICE * 1e6)} that <a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>’s full-cost break-even allowed
        Northwind to pay at the same rate, though that lesson counted quite differently. Owners can’t see the future, so they lean on the recent past, and a
        ship’s value swings with recent earnings. In our history a five-year-old ship sold for anything from {$m(SH_MIN * 1e6)} to {$m(SH_MAX * 1e6)}.
      </P>
      <P>
        Newbuilding prices move less, between {$m(NB_MIN * 1e6)} and {$m(NB_MAX * 1e6)}. A shipyard’s price is set by its costs and by how full its order book is:
        when owners queue for berths, yards charge more, and when the queue empties they cut prices to keep their workforce busy. The gap between the two lines is
        the market’s verdict on the wait. Below the newbuilding price, it’s cheaper to buy a ship that exists; above it, owners order.
      </P>

      <H2>The world fleet</H2>
      <P>
        Every owner in the history faced the same choice with the same information, and most made it at the same time. In the next demonstration, the bars count
        the world Kamsarmax fleet’s orders, deliveries and ships sent for scrap in each year, and the lower chart is the fleet itself at the end of the year you
        choose: how many ships of each age, and, to the left, how many are on order and when they will arrive. Step through the years:
      </P>

      <Figure name="Fleet Investment Simulator · the world fleet" scenario={wf}>
        <Legend items={BARS.map((b) => ({ label: b.name, color: b.color }))} />
        <svg
          className="chart"
          viewBox="0 0 640 200"
          role="img"
          aria-label={`Kamsarmax ships ordered, delivered and scrapped each year. In Year ${yr.year}: ${fmt(yr.orders)} ordered, ${fmt(yr.deliveries)} delivered, ${fmt(yr.scrapped)} scrapped.`}
        >
          <text className="ax" x={BX0} y={12}>
            Ships a year
          </text>
          <GridY y={by} ticks={niceTicks(0, yMax, 4)} x0={BX0} x1={BX1} format={(v) => fmt(v)} baseline={0} />
          <rect x={BX0 + (yr.year - 1) * slot} y={20} width={slot} height={158} fill={tint(GRAPHIC.gray, 0.12)} />
          {YEARS.map((y, i) =>
            BARS.map((b, j) => {
              const v = y[b.key];
              const w = (slot - 10) / 3;
              const x = BX0 + i * slot + 5 + j * w;
              return <rect key={`${i}-${b.key}`} x={x} y={by(v)} width={w - 1} height={Math.max(0, by(0) - by(v))} fill={b.color} opacity={y.year === yr.year ? 1 : 0.55} />;
            }),
          )}
          {YEARS.map((y, i) => (
            <text key={i} className="ax ax-m" x={BX0 + (i + 0.5) * slot} y={194} style={{ fontWeight: y.year === yr.year ? 600 : 400 }}>
              {y.year}
            </text>
          ))}
        </svg>
        <svg
          className="chart"
          viewBox="0 0 640 178"
          role="img"
          aria-label={`The fleet at the end of Year ${yr.year}: ${fmt(yr.fleet)} ships, average age ${fmt(yr.avgAge, 1)} years, with ${fmt(yr.book)} on order.`}
        >
          <text className="ax" x={AX0} y={12}>
            Ships at the end of Year {yr.year}, by age · on order, by years to delivery
          </text>
          <GridY y={ay} ticks={niceTicks(0, ay.domain[1], 3)} x0={AX0} x1={AX1} format={(v) => fmt(v)} baseline={0} />
          {yr.bookByYear.map((c, i) => {
            const x = AX0 + (3 - i) * aw;
            return <rect key={'b' + i} x={x + 1} y={ay(c)} width={aw - 2} height={Math.max(0, ay(0) - ay(c))} fill="#ffffff" stroke={GRAPHIC.teal} strokeDasharray="3 2" strokeWidth={1.5} />;
          })}
          {yr.ages.map((c, a) => {
            const x = AX0 + (4 + a) * aw;
            return <rect key={a} x={x + 1} y={ay(c)} width={aw - 2} height={Math.max(0, ay(0) - ay(c))} fill={a >= 18 ? tint(GRAPHIC.red, 0.7) : GRAPHIC.teal} opacity={0.85} />;
          })}
          <line x1={AX0 + 4 * aw} x2={AX0 + 4 * aw} y1={18} y2={152} stroke="#9a9a9a" />
          {[0, 5, 10, 15, 20, 25].map((a) => (
            <text key={a} className="ax ax-m" x={AX0 + (4 + a + 0.5) * aw} y={166}>
              {a}
            </text>
          ))}
          {[1, 2, 3, 4].map((k) => (
            <text key={'k' + k} className="ax ax-m" x={AX0 + (4 - k + 0.5) * aw} y={166}>
              {k}
            </text>
          ))}
          <text className="ax" x={AX0} y={176}>
            ← on order: years until delivery
          </text>
          <text className="ax ax-e" x={AX1} y={176}>
            age in years → (18 and older in red)
          </text>
        </svg>
        <Readouts
          items={[
            { label: `fleet at the end of Year ${yr.year}`, value: `${fmt(yr.fleet)} ships` },
            { label: 'on order', value: `${fmt(yr.book)} · ${pct(yr.book / yr.fleet)} of the fleet`, tone: 'teal' },
            { label: 'average age', value: `${fmt(yr.avgAge, 1)} years` },
            { label: 'earnings that year', value: perDay(yr.tce), tone: 'green' },
          ]}
        />
        <Slider label="Year" tone="teal" value={wf.state.year} min={1} max={YEARS.length} onChange={(v) => wf.set({ year: v })} display={`Year ${wf.state.year}`} />
      </Figure>

      <P>
        In the first boom, orders peak in Year {PEAK_ORDERS.year}, at {fmt(PEAK_ORDERS.orders)} ships, as earnings average {perDay(PEAK_ORDERS.tce)}. By the end of
        Year {PEAK_BOOK.year} the ships on order add up to {pct(PEAK_BOOK.book / PEAK_BOOK.fleet)} of the fleet — the <K tone="teal">orderbook</K>, the number
        every shipping analyst watches, because it is the coming years’ supply, already decided. Step to Year {PEAK_DELIV.year}: {fmt(PEAK_DELIV.deliveries)} new
        ships arrive, ordered when the market was hot and delivered into one that has already cooled. The fleet grows from {fmt(YEARS[2].fleet)} ships at the
        end of Year 3 to {fmt(YEARS[6].fleet)} at the end of Year 7, {pct(YEARS[6].fleet / YEARS[2].fleet - 1)} more, while the cargo it carries grows{' '}
        {pct(HIST[83].demand / HIST[35].demand - 1)}. Earnings fall to {perDay(YEARS[5].tce)} in Year 6.
      </P>
      <P>
        The fleet corrects itself only at the other end. Ships keep trading as long as earnings cover their running costs; when they don’t, the oldest go to the
        breakers, who pay for their steel. Scrapping peaks in Year {PEAK_SCRAP.year}, at {fmt(PEAK_SCRAP.scrapped)} ships, and the fleet shrinks two years running.
        Both ends work with long delays — the shipyards’ two and a half years, the scrapyards’ reluctance until losses mount — so the fleet is always catching up
        with a market that has already moved. And because the orders of Years 11 and 12 pile up just as earnings peak, the pattern is set to repeat: step to Year
        12 in <FigRef to="Fleet Investment Simulator · the world fleet">this demonstration</FigRef> and look at the orderbook waiting to be delivered.
      </P>
      <P>
        This chapter has turned a ship into a business: a class of hull built for its trades and canals, a port call with its own clock, a speed chosen against the
        price of fuel, a daily cost to cover and a fleet that grows and shrinks in slow waves. But a fleet isn’t just a number of ships. Ships are in particular
        places, cargoes wait in others, and getting one to the other takes weeks. <a href={lessonHref('shipping/3.1')}>Chapter 3</a> puts the fleet on a map.
      </P>
    </LessonPage>
  );
}
