import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  fmt,
  lessonHref,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { DAYS_PER_MONTH, TC_ROUTES, dailyPath, monthAverage, routeTce } from '../../../engines/shipping/indices';
import { REVERSION, dailyIndex, ffaSettlement, longRun, type Side } from '../../../engines/shipping/ffa';
import { replacementEarnings } from '../../../engines/shipping/cycle';
import { HISTORY_MONTHS, MONTH_SHORT, monthLabel, standardHistory } from '../../../model/shipping/history';
import { XYChart } from '../shared/XYChart';

const INDEX = dailyIndex('kmax');
const HIST = standardHistory().cls.kmax;
const NOISE = dailyPath('kmax').noise;
const MAX_AHEAD = 6;
/** Last trade date that leaves room for a contract six months ahead. */
export const LAST_TRADE_DAY = (HISTORY_MONTHS - 1 - MAX_AHEAD) * DAYS_PER_MONTH + DAYS_PER_MONTH - 1;
/** Kestrel's earning days in a month, and the FFA days that cover them. */
export const MONTH_DAYS = 30;

const perDay = (x: number) => `${usd(x)}/day`;
const signedUsd = (x: number) => (x >= 0 ? `+${usd(x)}` : usd(x));
const monthOf = (day: number) => Math.floor(day / DAYS_PER_MONTH);
const dayLabel = (day: number) => `${monthLabel(monthOf(day))}, index day ${(day % DAYS_PER_MONTH) + 1}`;

/** The long-run level for each calendar month (cached: computing it takes a valuation search). */
const LONG_RUN = Array.from({ length: 12 }, (_, m) => longRun('kmax', m));

/**
 * The Kamsarmax forward price, exactly as engines/shipping/ffa.ts's forwardPrice computes it, but
 * reading the long-run levels from the cache above so a daily path stays fast.
 */
export function fastForward(day: number, month: number): number {
  const nowMonth = monthOf(day);
  if (month < nowMonth) return monthAverage(INDEX, month);
  const ahead = Math.max(0, month + 0.5 - (day + 0.5) / DAYS_PER_MONTH);
  const expected = LONG_RUN[month % 12] + (INDEX[day] - LONG_RUN[nowMonth % 12]) * REVERSION ** ahead;
  if (month > nowMonth) return expected;
  let known = 0;
  for (let d = month * DAYS_PER_MONTH; d <= day; d++) known += INDEX[d];
  return (known + (DAYS_PER_MONTH - (day - month * DAYS_PER_MONTH + 1)) * expected) / DAYS_PER_MONTH;
}

export interface Trade {
  /** Contract month (index into the history). */
  month: number;
  price: number;
  settlement: number;
  pnl: number;
  path: Array<{ day: number; forward: number; value: number }>;
  /** Most money paid out in variation margin on one day, $ (≤ 0). */
  worstCall: number;
  /** Lowest the position's value fell before settlement, $ (≤ 0). */
  worstValue: number;
}

/** An FFA agreed on index day `day` for the month `ahead` months later, settled at that month's average. */
export function ffaTrade(day: number, ahead: number, side: Side, days: number): Trade {
  const month = monthOf(day) + ahead;
  const price = fastForward(day, month);
  const settlement = monthAverage(INDEX, month);
  const path: Trade['path'] = [];
  for (let d = day; d <= (month + 1) * DAYS_PER_MONTH - 1; d++) {
    const forward = fastForward(d, month);
    path.push({ day: d, forward, value: ffaSettlement(side, price, days, forward) });
  }
  let worstCall = 0;
  let worstValue = 0;
  for (let i = 1; i < path.length; i++) worstCall = Math.min(worstCall, path[i].value - path[i - 1].value);
  for (const p of path) worstValue = Math.min(worstValue, p.value);
  return { month, price, settlement, pnl: ffaSettlement(side, price, days, settlement), path, worstCall, worstValue };
}

/** The challenge: trading in January of Year 6, 30 days, a contract that made at least $400,000. */
export const COLLAPSE_MONTH = 60;
export const COLLAPSE_TARGET = 400_000;
export function collapseSolved(day: number, ahead: number, side: Side, days: number): boolean {
  if (monthOf(day) !== COLLAPSE_MONTH || days !== 30) return false;
  return ffaTrade(day, ahead, side, days).pnl >= COLLAPSE_TARGET - 1e-6;
}

const ROUTE_LABEL: Record<string, string> = {
  'P-TA': 'Transatlantic round',
  'P-FH': 'Fronthaul',
  'P-TP': 'Transpacific round',
  'P-BH': 'Backhaul',
};

export interface HedgeMonth {
  month: number;
  forward: number;
  settlement: number;
  /** Kestrel's own earnings on her route that month, $/day. */
  tce: number;
  hedged: number;
}

/**
 * Northwind sells a strip of monthly FFAs on the first index day of `start`, covering the next twelve
 * months at `ratio` × 30 days each, while Kestrel trades spot on one route.
 */
export function hedgeStrip(start: number, routeId: string, ratio: number): HedgeMonth[] {
  const r = TC_ROUTES.kmax.find((x) => x.id === routeId)!;
  const day = start * DAYS_PER_MONTH;
  return Array.from({ length: 12 }, (_, i) => {
    const month = start + 1 + i;
    const forward = fastForward(day, month);
    const settlement = monthAverage(INDEX, month);
    const noise = NOISE.slice(month * DAYS_PER_MONTH, (month + 1) * DAYS_PER_MONTH).reduce((a, b) => a + b, 0) / DAYS_PER_MONTH;
    const tce = routeTce(HIST[month], r) * noise;
    return { month, forward, settlement, tce, hedged: tce + ratio * (forward - settlement) };
  });
}

/** Standard deviation of earnings' gaps from the forward curve across a strip, $/day. */
export function missSpread(rows: HedgeMonth[], hedged: boolean): number {
  const xs = rows.map((r) => (hedged ? r.hedged : r.tce) - r.forward);
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

const total = (rows: HedgeMonth[], key: 'tce' | 'hedged' | 'forward') => rows.reduce((s, r) => s + r[key], 0) * MONTH_DAYS;

// Numbers the prose quotes.
const Y3 = 24 * DAYS_PER_MONTH;
const BOOM = ffaTrade(Y3, 3, 'sell', 30);
const Y6 = COLLAPSE_MONTH * DAYS_PER_MONTH;
const SLUMP = ffaTrade(Y6, 3, 'sell', 30);
const STRIP_START = 54;
const TP = hedgeStrip(STRIP_START, 'P-TP', 1);
const FH = hedgeStrip(STRIP_START, 'P-FH', 1);
const BOOM_STRIP = hedgeStrip(24, 'P-TP', 1);

export default function Lesson() {
  const s = useScenario('ffa', { day: Y3, ahead: 3, side: 'sell' as Side, days: 30 });
  const { day, ahead, side, days } = s.state;
  const tr = useMemo(() => ffaTrade(day, ahead, side, days), [day, ahead, side, days]);
  const solved = collapseSolved(day, ahead, side, days);
  const from = Math.max(0, day - 2 * DAYS_PER_MONTH);
  const to = (tr.month + 1) * DAYS_PER_MONTH - 1;
  const chart = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let d = from; d <= to; d++) {
      xs.push(d / DAYS_PER_MONTH);
      ys.push(INDEX[d]);
    }
    return { xs, ys };
  }, [from, to]);
  const fwdXs = tr.path.map((p) => p.day / DAYS_PER_MONTH);
  const fwdYs = tr.path.map((p) => p.forward);
  const yHi = Math.max(...chart.ys, ...fwdYs, tr.price) * 1.1;
  const yMax = Math.ceil(yHi / 10_000) * 10_000;
  const firstMonth = Math.ceil(from / DAYS_PER_MONTH);
  const ticks = Array.from({ length: tr.month + 2 - firstMonth }, (_, i) => firstMonth + i).filter((_, i, a) => a.length < 9 || i % 2 === 0);
  const calls = tr.path.slice(1).map((p, i) => ({ day: p.day, change: p.value - tr.path[i].value }));
  const maxCall = Math.max(1, ...calls.map((c) => Math.abs(c.change)));

  const hg = useScenario('hedge', { start: STRIP_START, route: 'P-TP', ratio: 100 });
  const rows = useMemo(() => hedgeStrip(hg.state.start, hg.state.route, hg.state.ratio / 100), [hg.state.start, hg.state.route, hg.state.ratio]);
  const months = rows.map((_, i) => i + 1);

  const lr0 = LONG_RUN[COLLAPSE_MONTH % 12];
  const lr3 = LONG_RUN[(COLLAPSE_MONTH + 3) % 12];

  return (
    <LessonPage id="shipping/4.5">
      <P>
        <a href={lessonHref('shipping/4.3')}>Lesson 4.3</a> turned the day’s fixtures into a published number, a timecharter index, and{' '}
        <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a> showed why that number never sits still: demand moves in months, the fleet in years, and earnings
        swing between them. Nobody in the market can stop the swings. An owner can’t make cargoes appear, and a charterer can’t conjure ships. What they can do is
        trade the swings — agree today on what next quarter’s freight will cost, without fixing a ship or a cargo at all.
      </P>
      <P>
        The instrument is the <K tone="green">forward freight agreement</K>, or FFA. Two parties agree a price for an index over a future month. When the month is
        over, they compare the agreed price with the index’s average over that month, the <b>settlement price</b>, and one pays the other the difference times
        the quantity. If the index averaged more than the agreed price, the buyer collects; if less, the seller does. No ship changes hands and no cargo moves: it
        is settled in cash. A contract on a timecharter index is sized in days, a contract on a voyage route in tonnes. Most dry bulk FFAs settle on the average
        of the index over the contract month, not on its last day, so a single odd day can’t decide the payout, and most are cleared through exchanges’ clearing
        houses.
      </P>
      <Eq label="Settlement to the buyer equals the settlement price minus the agreed price, times the quantity in days">
        <span>buyer receives</span>
        <Op>=</Op>
        <span>
          (<K tone="green">
            S<Sub>month</Sub>
          </K>{' '}
          − <K tone="green">F</K>) × days
        </span>
      </Eq>
      <P>
        Our contracts settle on the course’s simulated Kamsarmax index: an equal-weighted average of the model’s four Kamsarmax timecharter routes, assessed
        every index day, twenty-one to a month. In the next demonstration, choose a day to trade, how many months ahead the contract month lies, whether
        to buy or sell, and how many days. The agreed price is the day’s forward price for that month. The chart follows the index, the forward price as the
        contract runs, and the settlement; the bars under it are the cash that changes hands each day before settlement:
      </P>

      <Figure name="FFA Contract Simulator" scenario={s}>
        <Segmented
          label="Side"
          value={side}
          onChange={(v) => s.set({ side: v })}
          options={[
            { value: 'sell', label: 'Sell the FFA (an owner’s hedge)' },
            { value: 'buy', label: 'Buy the FFA (a charterer’s hedge)' },
          ]}
        />
        <Legend
          items={[
            { label: 'Kamsarmax index, daily', color: GRAPHIC.green, kind: 'line' },
            { label: 'Forward price for the contract month', color: GRAPHIC.blue, kind: 'line', dashed: true },
            { label: 'Agreed price', color: '#333', kind: 'line', dashed: true },
            { label: 'Settlement: the month’s average', color: GRAPHIC.orange, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`The Kamsarmax index from ${monthLabel(monthOf(from))} to the end of ${monthLabel(tr.month)}. Agreed price ${perDay(tr.price)} on ${dayLabel(day)}; settlement ${perDay(tr.settlement)}; the ${side === 'sell' ? 'seller' : 'buyer'} of ${days} days ${tr.pnl >= 0 ? 'gains' : 'loses'} ${usd(Math.abs(tr.pnl))}.`}
          series={[
            { xs: chart.xs, ys: chart.ys, color: GRAPHIC.green, width: 1.8 },
            { xs: fwdXs, ys: fwdYs, color: GRAPHIC.blue, width: 2, dash: '5 4' },
          ]}
          xMin={from / DAYS_PER_MONTH}
          xMax={(to + 1) / DAYS_PER_MONTH}
          yMin={0}
          yMax={yMax}
          yTicks={[0, yMax / 2, yMax]}
          xTicks={ticks}
          xFormat={(m) => MONTH_SHORT[m % 12]}
          yFormat={(v) => `$${fmt(v / 1000)}k`}
          yLabel="Index, $ per day"
          height={210}
          bands={[{ from: tr.month, to: tr.month + 1, color: tint(GRAPHIC.orange, 0.15), label: 'contract month' }]}
          refLines={[{ y: tr.price, color: '#333', label: `agreed ${perDay(tr.price)}` }]}
          cursor={day / DAYS_PER_MONTH}
          overlay={(x, y) => (
            <line x1={x(tr.month)} x2={x(tr.month + 1)} y1={y(tr.settlement)} y2={y(tr.settlement)} stroke={GRAPHIC.orange} strokeWidth={3} />
          )}
        />
        <svg
          className="chart"
          viewBox="0 0 640 74"
          role="img"
          aria-label={`Daily variation margin for the ${side === 'sell' ? 'seller' : 'buyer'}: the largest single day’s payment is ${usd(Math.abs(tr.worstCall))}.`}
        >
          <text className="ax" x={56} y={10}>
            Variation margin each day: received above, paid below
          </text>
          {(() => {
            const xs = scale(from / DAYS_PER_MONTH, (to + 1) / DAYS_PER_MONTH, 56, 624);
            const ys = scale(-maxCall, maxCall, 70, 18);
            const w = Math.max(1, xs(1 / DAYS_PER_MONTH) - xs(0) - 0.5);
            return (
              <g>
                <line className="base" x1={56} x2={624} y1={ys(0)} y2={ys(0)} />
                {calls.map((c) => (
                  <rect
                    key={c.day}
                    x={xs(c.day / DAYS_PER_MONTH)}
                    y={c.change >= 0 ? ys(c.change) : ys(0)}
                    width={w}
                    height={Math.abs(ys(c.change) - ys(0))}
                    fill={c.change >= 0 ? GRAPHIC.green : GRAPHIC.red}
                  />
                ))}
              </g>
            );
          })()}
        </svg>
        <Readouts
          items={[
            { label: `agreed for ${monthLabel(tr.month)}`, value: perDay(tr.price), tone: 'green' },
            { label: 'settlement, the month’s average', value: perDay(tr.settlement), tone: 'green' },
            { label: `${side === 'sell' ? 'seller' : 'buyer'}’s result for ${days} days`, value: signedUsd(tr.pnl), tone: tr.pnl >= 0 ? 'green' : 'red' },
            { label: 'largest margin paid in one day', value: tr.worstCall < -0.5 ? usd(-tr.worstCall) : 'none' },
          ]}
        />
        <Slider label="Trade date" tone="teal" value={day} min={0} max={LAST_TRADE_DAY} onChange={(v) => s.set({ day: v })} display={dayLabel(day)} />
        <Slider label="Contract month" tone="teal" value={ahead} min={1} max={MAX_AHEAD} onChange={(v) => s.set({ ahead: v })} display={`${ahead} month${ahead > 1 ? 's' : ''} ahead: ${MONTH_SHORT[tr.month % 12]}`} />
        <Slider label="Quantity" value={days} min={15} max={90} step={15} onChange={(v) => s.set({ days: v })} display={`${days} days`} />
        <Caption>
          {tr.worstValue < -0.5
            ? `Before settling, the position was at worst ${usd(-tr.worstValue)} under water — money paid out in margin before any of it came back.`
            : 'The position never went under water before settlement.'}
        </Caption>
      </Figure>

      <P>
        The demonstration starts on the first index day of Year 3. Kamsarmaxes are earning {perDay(INDEX[Y3])}, and Northwind sells 30 days of April at{' '}
        {perDay(BOOM.price)}. Then the spring comes in far stronger than anyone expected: April’s index averages {perDay(BOOM.settlement)}, and Northwind pays{' '}
        {usd(-BOOM.pnl)}. It doesn’t pay it all at the end. A clearing house marks every open contract to the day’s forward price and collects the change as{' '}
        <b>variation margin</b>, so the losses arrive day by day — up to {usd(-BOOM.worstCall)} in a single day, and {usd(-BOOM.worstValue)} at the worst point —
        alongside an initial deposit against default. A seller who can’t meet the calls is closed out. That is the price of a contract that can’t default: it has to
        be paid for in cash, now.
      </P>
      <P>
        Was selling a mistake? Not if Northwind owns a ship. An owner who sells an FFA has given up April’s windfall, but Kestrel, trading spot in April, earned it,
        and the two together come to roughly the agreed price. The FFA turned an uncertain month into a known one. Who buys? Charterers who will need ships in
        April and would rather know the cost now — and traders on both sides who simply think the forward price is wrong.
      </P>

      <H2>Where the forward price comes from</H2>
      <P>
        A forward price is the market’s best guess of a future month’s average, and in our model traders guess in a simple way. Each calendar month has a{' '}
        <b>long-run level</b>: the earnings at which a new Kamsarmax would just repay her building price, shaped by the seasons — high in the Brazilian soybean
        season, low in midwinter. Today’s index is some distance above or below today’s long-run level, and traders expect that gap to shrink by{' '}
        {pct(1 - REVERSION)} a month:
      </P>
      <Eq label="Forward price equals the month's long-run level plus today's gap from today's level, shrunk for each month ahead">
        <K tone="green">F</K>
        <Op>=</Op>
        <span>
          L<Sub>month</Sub>
        </span>
        <Op>+</Op>
        <span>
          (spot − L<Sub>today</Sub>) × {REVERSION}
          <sup>months ahead</sup>
        </span>
      </Eq>
      <P>
        That is a model of expectations, not a law. Over the whole history the long-run level averages {perDay(replacementEarnings('kmax'))}, and in any one
        month the market can be far from it for a long time. In January of Year 6, a wave of new ships has just been delivered and the index has collapsed to{' '}
        {perDay(INDEX[Y6])}. Today’s long-run level is {perDay(lr0)}; April’s, at the height of the soybean season, is {perDay(lr3)}. The forward curve assumes the
        usual spring will mostly arrive.
      </P>

      <Challenge
        id="a"
        question={`Move to January of Year 6, any index day. Trading 30 days, find a side and a contract month that would have made at least ${usd(COLLAPSE_TARGET)} at settlement.`}
        solved={solved}
        status={
          monthOf(day) !== COLLAPSE_MONTH
            ? `The trade date is ${monthLabel(monthOf(day))}; move it to January of Year 6.`
            : days !== 30
              ? 'Set the quantity to 30 days.'
              : `${side === 'sell' ? 'Selling' : 'Buying'} ${MONTH_SHORT[tr.month % 12]} at ${perDay(tr.price)} settles at ${perDay(tr.settlement)}: ${signedUsd(tr.pnl)}.`
        }
        success={`Solved. Sold on the first index day, April was priced at ${perDay(SLUMP.price)} — the curve expected the spring season to lift the market most of the way back to its long-run level. It didn’t: the fleet that had been ordered in the boom was still arriving, and April averaged ${perDay(SLUMP.settlement)}. The seller collected ${usd(SLUMP.pnl)}. No other month made ${usd(COLLAPSE_TARGET)}: nearer months were priced closer to the slump, and later ones lay past the season’s peak.`}
      />

      <H2>Hedging Kestrel</H2>
      <P>
        Now use FFAs the way most owners do. On the first index day of a month, Northwind sells a strip of twelve monthly contracts covering the next year, 30
        days each, while Kestrel keeps trading spot. Her earnings don’t follow the index exactly: she earns whatever her route pays, and the index’s four routes differ — a round voyage earns the market
        rate, a fronthaul from the Atlantic to China pays a premium, a backhaul a discount. The difference
        between her earnings and the index is the <K tone="violet">basis</K>. In the next demonstration, choose when the hedge is placed, which route Kestrel
        trades, and how much of her time is hedged; the chart compares her earnings with and without the FFAs, against the forward prices Northwind sold at:
      </P>

      <Figure name="FFA Contract Simulator · hedging Kestrel" scenario={hg}>
        <Segmented label="Kestrel’s route" value={hg.state.route} onChange={(v) => hg.set({ route: v })} options={TC_ROUTES.kmax.map((r) => ({ value: r.id, label: ROUTE_LABEL[r.id] }))} />
        <Legend
          items={[
            { label: 'Forward price sold', color: '#555', kind: 'line', dashed: true },
            { label: 'Kestrel unhedged', color: GRAPHIC.orange, kind: 'line' },
            { label: `Kestrel with ${hg.state.ratio}% hedged`, color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Twelve months from ${monthLabel(hg.state.start + 1)}: Kestrel on the ${ROUTE_LABEL[hg.state.route].replace(/^./, (c) => c.toLowerCase())} route earns ${usd(total(rows, 'tce'))} unhedged and ${usd(total(rows, 'hedged'))} with ${hg.state.ratio}% hedged, against forward prices worth ${usd(total(rows, 'forward'))}.`}
          series={[
            { xs: months, ys: rows.map((r) => r.forward), color: '#555', width: 1.8, dash: '5 4' },
            { xs: months, ys: rows.map((r) => r.tce), color: GRAPHIC.orange, width: 2.2 },
            { xs: months, ys: rows.map((r) => r.hedged), color: GRAPHIC.green, width: 2.5 },
          ]}
          xMin={1}
          xMax={12}
          yMin={0}
          xTicks={months}
          xFormat={(i) => MONTH_SHORT[(hg.state.start + i) % 12]}
          yFormat={(v) => `$${fmt(v / 1000)}k`}
          yLabel="Earnings, $ per day"
          height={200}
        />
        <Readouts
          items={[
            { label: 'twelve months unhedged', value: usd(total(rows, 'tce')), tone: 'orange' },
            { label: 'with the FFAs', value: usd(total(rows, 'hedged')), tone: 'green' },
            { label: 'month-to-month miss vs. the forward curve, unhedged', value: perDay(missSpread(rows, false)) },
            { label: 'and hedged', value: perDay(missSpread(rows, true)), tone: 'violet' },
          ]}
        />
        <Slider label="Hedge placed" tone="teal" value={hg.state.start} min={0} max={HISTORY_MONTHS - 13} onChange={(v) => hg.set({ start: v })} display={monthLabel(hg.state.start)} />
        <Slider label="Share of her days hedged" tone="green" value={hg.state.ratio} min={0} max={150} step={10} onChange={(v) => hg.set({ ratio: v })} display={`${hg.state.ratio}%`} />
        <Caption>The miss is the standard deviation of each month’s earnings minus that month’s forward price: how unpredictable the year turned out.</Caption>
      </Figure>

      <P>
        The hedge starts in July of Year 5, as the boom fades. Trading a transpacific round voyage unhedged, Kestrel earns {usd(total(TP, 'tce'))} over the next
        twelve months, well short of the {usd(total(TP, 'forward'))} the forward prices promised. Fully hedged she earns {usd(total(TP, 'hedged'))}, and her
        month-to-month miss against the curve falls from {perDay(missSpread(TP, false))} to {perDay(missSpread(TP, true))}. A round voyage earns almost exactly
        the market rate, so its basis is small and the hedge works almost perfectly. Placed in January of Year 3 instead, the same hedge costs her money — the
        twelve months unhedged bring {usd(total(BOOM_STRIP, 'tce'))}, hedged {usd(total(BOOM_STRIP, 'hedged'))} — because a hedge gives up the good surprises
        along with the bad. It is insurance, and insurance doesn’t pay in years nothing goes wrong.
      </P>
      <P>
        Switch her to the fronthaul. She earns more, because a fronthaul pays for leaving the ship in the Pacific where ships are plentiful, and the hedge still
        removes the market’s swings. But the miss doesn’t fall as far: {perDay(missSpread(FH, true))} instead of {perDay(missSpread(TP, true))}, because the
        fronthaul premium itself rises and falls with the cost of repositioning ships, and no FFA on the index covers it. That leftover is <b>basis risk</b>, and every
        real hedge has some — a different route, a different ship, a different month. Now push the hedge past 100% in{' '}
        <FigRef to="FFA Contract Simulator · hedging Kestrel">this demonstration</FigRef>. The miss rises again: the extra contracts don’t offset anything Kestrel
        earns, so they are simply a bet that the market will fall.
      </P>
      <P>
        This chapter has turned a fleet into a market: ships bidding for cargoes, contracts that divide the voyage’s risks, indices that publish the result, a cycle
        that drives it and forward contracts that let anyone trade it. Every one of those prices came from physical things — where ships are, how fast they sail,
        how many the shipyards deliver. <a href={lessonHref('shipping/5.1')}>Chapter 5</a> turns that around: if the physics sets the price, can we forecast it,
        and trade on the forecast?
      </P>
    </LessonPage>
  );
}
