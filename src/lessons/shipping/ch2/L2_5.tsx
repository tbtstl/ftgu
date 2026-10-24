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
  useScenario,
} from '../../../framework';
import { invest, DEPOSIT, SECONDHAND_AGE, type InvestKind } from '../../../engines/shipping/investment';
import { classScrapValue } from '../../../engines/shipping/cycle';
import { standardHistory, monthLabel, HISTORY_MONTHS } from '../../../model/shipping/history';
import { DEFAULT_CYCLE } from '../../../engines/shipping/cycle';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory().cls.kmax;
const LAG = DEFAULT_CYCLE.lag;
/** Last month a newbuilding can be ordered and still be delivered within the history. */
export const LAST_ORDER = HISTORY_MONTHS - LAG - 1;
/** Last month a secondhand ship can be bought and held for a year. */
export const LAST_PURCHASE = HISTORY_MONTHS - 13;
export const TARGET_RETURN = 0.2;

const $m = (x: number, d = 1) => `$${fmt(x / 1e6, d)}m`;
const perDay = (x: number) => `$${fmt(x)}/day`;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/** The challenge: a newbuilding that earns at least 20% a year on the money put in. */
export function returnSolved(kind: InvestKind, month: number): boolean {
  if (kind !== 'newbuild' || month > LAST_ORDER) return false;
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
const SLUMP_MONTH = 84;
const SLUMP = invest('kmax', HIST, 'newbuild', SLUMP_MONTH);
const SOLUTIONS = Array.from({ length: LAST_ORDER + 1 }, (_, m) => m).filter((m) => returnSolved('newbuild', m));

const MONTHS = HIST.map((_, i) => i / 12);

export default function Lesson() {
  const inv = useScenario('investment', { kind: 'newbuild' as InvestKind, month: 30 });
  const { kind } = inv.state;
  const maxMonth = kind === 'newbuild' ? LAST_ORDER : LAST_PURCHASE;
  const month = Math.min(inv.state.month, maxMonth);
  const r = invest('kmax', HIST, kind, month);
  const solved = returnSolved(kind, month);
  const tceSeries = useMemo(() => HIST.map((m) => m.tce), []);
  const nbSeries = useMemo(() => HIST.map((m) => m.newbuild), []);
  const shSeries = useMemo(() => HIST.map((m) => m.secondhand), []);
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
        at once. Either way the ship then trades on the spot market, earning the month’s rate on her earning days and paying her operating costs every day, until
        the end of Year 12, when she is valued at what the market would then pay for a ship of her age. In the next demonstration, choose how to buy and when:
      </P>

      <Figure name="Fleet Investment Simulator" scenario={inv}>
        <Segmented
          label="How to buy"
          value={kind}
          onChange={(k) => inv.set({ kind: k, month: Math.min(inv.state.month, k === 'newbuild' ? LAST_ORDER : LAST_PURCHASE) })}
          options={[
            { value: 'newbuild', label: 'Order a newbuilding' },
            { value: 'secondhand', label: `Buy a ${SECONDHAND_AGE}-year-old ship` },
          ]}
        />
        <XYChart
          ariaLabel={`Kamsarmax earnings over twelve simulated years, from ${perDay(TCE_MIN)} to ${perDay(TCE_MAX)}. ${kind === 'newbuild' ? `Ordered in ${monthLabel(month)}, delivered ${monthLabel(r.deliveryMonth)}.` : `Bought in ${monthLabel(month)}.`}`}
          series={[{ xs: MONTHS, ys: tceSeries, color: GRAPHIC.green, width: 2 }]}
          xMin={0}
          xMax={12}
          yMin={0}
          yMax={60_000}
          yTicks={[0, 20_000, 40_000, 60_000]}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 0 ? 'Year 1' : v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v / 1000)}k`}
          yLabel="Earnings, $ per day (TCE)"
          height={170}
          bands={kind === 'newbuild' ? [{ from: month / 12, to: r.deliveryMonth / 12, color: tint(GRAPHIC.gray, 0.18), label: 'building' }] : []}
          cursor={month / 12}
          overlay={(x) => (
            <line x1={x(r.deliveryMonth / 12)} x2={x(r.deliveryMonth / 12)} y1={26} y2={146} stroke={GRAPHIC.teal} strokeWidth={2} />
          )}
        />
        <XYChart
          ariaLabel={`Ship prices: newbuildings between ${$m(NB_MIN * 1e6)} and ${$m(NB_MAX * 1e6)}, five-year-old ships between ${$m(SH_MIN * 1e6)} and ${$m(SH_MAX * 1e6)}. In ${monthLabel(month)} a newbuilding cost ${$m(HIST[month].newbuild * 1e6)} and a five-year-old ship ${$m(HIST[month].secondhand * 1e6)}.`}
          series={[
            { xs: MONTHS, ys: nbSeries, color: '#8a8a8a', width: 2 },
            { xs: MONTHS, ys: shSeries, color: GRAPHIC.orange, width: 2 },
          ]}
          xMin={0}
          xMax={12}
          yMin={15}
          yMax={45}
          yTicks={[20, 30, 40]}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 0 ? 'Year 1' : v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${v}m`}
          yLabel="Ship prices, $ million"
          height={150}
          cursor={month / 12}
          markers={[{ x: month / 12, y: kind === 'newbuild' ? HIST[month].newbuild : HIST[month].secondhand, color: kind === 'newbuild' ? TEXT.gray : TEXT.orange }]}
        />
        <Legend
          items={[
            { label: 'Newbuilding price', color: '#8a8a8a', kind: 'line' },
            { label: `${SECONDHAND_AGE}-year-old ship’s price`, color: GRAPHIC.orange, kind: 'line' },
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
          {kind === 'newbuild'
            ? `Ordered in ${monthLabel(month)} at ${$m(r.price)}, she is delivered in ${monthLabel(r.deliveryMonth)}, when the market pays ${perDay(HIST[r.deliveryMonth].tce)}, and trades for ${fmt(held, 1)} years.`
            : `Bought in ${monthLabel(month)} for ${$m(r.price)}, when the market pays ${perDay(HIST[month].tce)}, she trades for ${fmt(held, 1)} years.`}
        </Caption>
      </Figure>

      <P>
        Start in July of Year 3, at the height of the boom. Earnings have nearly doubled in two years — they average {perDay(YEARS[2].tce)} in Year 3,
        against {perDay(YEARS[0].tce)} in Year 1 — and every owner can see it: a newbuilding costs{' '}
        {$m(HIST[30].newbuild * 1e6)} and a five-year-old ship {$m(HIST[30].secondhand * 1e6)}, more than a new one. That isn’t a mistake. The secondhand ship
        can start earning today’s rates today; the newbuilding won’t arrive for {LAG} months. Ordered then, the newbuilding is delivered in{' '}
        {monthLabel(30 + LAG)}, into a market paying {perDay(HIST[30 + LAG].tce)}, and over the history returns {pct(invest('kmax', HIST, 'newbuild', 30).irr, 1)} a
        year. Order when the shipyards’ prices peak, in {monthLabel(PEAK_NB_MONTH)} at {$m(BOOM.price)}, and the return is {pct(BOOM.irr, 1)}.
      </P>
      <P>
        Now drag the order into the slump. In {monthLabel(SLUMP_MONTH)}, when Kamsarmaxes earn {perDay(HIST[SLUMP_MONTH].tce)} and nobody wants ships, a
        newbuilding costs {$m(SLUMP.price)}. She arrives in {monthLabel(SLUMP.deliveryMonth)}, just as the market recovers, and returns {pct(SLUMP.irr, 1)} a year.
        The ship is identical; only the timing changed. Owners who trade ships this way call it <b>asset play</b>: buying ships cheap and selling them dear, with
        the voyages in between mattering less than the dates.
      </P>

      <Challenge
        id="a"
        question={`Find a month to order a newbuilding that earns Northwind at least ${pct(TARGET_RETURN)} a year on its money by the end of the history.`}
        solved={solved}
        status={
          kind !== 'newbuild'
            ? 'Switch to ordering a newbuilding.'
            : `Ordered in ${monthLabel(month)}, she returns ${Number.isFinite(r.irr) ? pct(r.irr, 1) : 'nothing measurable'} a year.`
        }
        success={`Solved. Every order from ${monthLabel(SOLUTIONS[0])} to ${monthLabel(SOLUTIONS[SOLUTIONS.length - 1])} clears ${pct(TARGET_RETURN)} — all of them placed in the slump, when shipyards were cheap and owners frightened, and delivered into the recovery. None placed in the first six years does.`}
      />

      <H2>Prices follow earnings</H2>
      <P>
        Look at the two price lines. A ship is worth what she can earn: the present value of her expected earnings, less her operating costs, over the rest of her
        life, plus what a breaker will pay for her steel at the end — {$m(classScrapValue('kmax'))} for a Kamsarmax at our illustrative scrap price. Owners can’t
        see the future, so they lean on the recent past, and a ship’s value swings with recent earnings. In our history a five-year-old ship sold for anything
        from {$m(SH_MIN * 1e6)} to {$m(SH_MAX * 1e6)}.
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
