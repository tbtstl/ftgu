import { useId, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  Eq,
  FUEL,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Tn,
  hour as fmtHour,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  signed,
  usd,
  useScenario,
} from '../../framework';
import { bookExposure, bookHistory, bookPnL, type Book } from '../../engines/strategy/positions';
import { summarize } from '../../engines/strategy/risk';
import { quantile } from '../../engines/strategy/distribution';
import { standardHistory } from '../../model/history';
import { fleetById } from '../../model/fleet';

const LAKESIDE = fleetById('cc1'); // 400 MW, $36/MWh at the reference gas price
const DA_PRICE = 40; // the day-ahead price in the one-hour example
const STRIKE = 42; // the CfD strike, agreed earlier
const TARGET = 1200;
const RT_MIN = -20;
const RT_MAX = 150;

const COLORS = { physical: FUEL.gasCC, virtual: GRAPHIC.violet, cfd: GRAPHIC.teal, total: '#333333' };

function kusd(v: number): string {
  if (v === 0) return '$0';
  return Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}$${Math.abs(v) / 1000}k` : usd(v);
}

/** Compact money for chart labels: $6.4k, $110k. */
function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return `${v < 0 ? '−' : ''}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${v < 0 ? '−' : ''}$${(a / 1000).toFixed(1)}k`;
  return usd(v);
}

function virtualLabel(mw: number): string {
  return mw > 0 ? `inc ${mw} MW` : mw < 0 ? `dec ${-mw} MW` : 'none';
}

function cfdLabel(mw: number): string {
  return mw > 0 ? `${mw} MW sold` : mw < 0 ? `${-mw} MW bought` : 'none';
}

/** P&L of the book across the real-time price axis, as SVG paths. */
function PayoffChart({ book, rt }: { book: Book; rt: number }) {
  const clip = useId().replace(/:/g, '');
  const prices: number[] = [];
  for (let p = RT_MIN; p <= RT_MAX + 1e-9; p += 2.5) prices.push(p);
  if (book.flexible && !prices.includes(book.genCost)) prices.push(book.genCost);
  prices.sort((a, b) => a - b);
  const legs = prices.map((p) => bookPnL(book, DA_PRICE, p));
  const values = legs.flatMap((l) => [l.physical, l.virtual, l.cfd, l.total]);
  const [d0, d1] = niceDomain(Math.min(0, TARGET, ...values), Math.max(0, TARGET, ...values), 5);
  const x = scale(RT_MIN, RT_MAX, 64, 612);
  const y = scale(d0, d1, 236, 20);
  const xs = prices.map(x);
  const path = (k: 'physical' | 'virtual' | 'cfd' | 'total') => linePath(xs, legs.map((l) => y(l[k])));
  const totalArea = `${path('total')} L${x(RT_MAX)} ${y(0)} L${x(RT_MIN)} ${y(0)} Z`;
  const here = bookPnL(book, DA_PRICE, rt);
  const xTicks = [0, 25, 50, 75, 100, 125, 150];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Profit and loss of the book against the real-time price. At a real-time price of $${rt}, the book makes ${usd(here.total)} this hour; its net exposure is ${bookExposure(book)} MW.`}
    >
      <defs>
        <clipPath id={`${clip}-up`}>
          <rect x={0} y={0} width={640} height={y(0)} />
        </clipPath>
        <clipPath id={`${clip}-dn`}>
          <rect x={0} y={y(0)} width={640} height={300 - y(0)} />
        </clipPath>
      </defs>
      <text className="ax" x={64} y={10}>
        P&amp;L this hour
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 5)} x0={64} x1={612} format={kusd} baseline={0} />
      <path d={totalArea} fill={GRAPHIC.green} opacity={0.16} clipPath={`url(#${clip}-up)`} />
      <path d={totalArea} fill={GRAPHIC.red} opacity={0.16} clipPath={`url(#${clip}-dn)`} />
      <line x1={64} x2={612} y1={y(TARGET)} y2={y(TARGET)} stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="6 5" />
      <text className="ax ax-e" x={612} y={y(TARGET) - 6}>
        target {usd(TARGET)}
      </text>
      <line className="gl" x1={x(DA_PRICE)} x2={x(DA_PRICE)} y1={20} y2={236} strokeDasharray="3 4" />
      <text className="ax" x={x(DA_PRICE) + 5} y={32}>
        day-ahead ${DA_PRICE}
      </text>
      <path d={path('total')} fill="none" stroke={COLORS.total} strokeWidth={4} strokeLinejoin="round" />
      {book.genMW !== 0 && <path d={path('physical')} fill="none" stroke={COLORS.physical} strokeWidth={2} />}
      {book.incMW !== 0 && <path d={path('virtual')} fill="none" stroke={COLORS.virtual} strokeWidth={2} strokeDasharray="7 4" />}
      {book.cfdMW !== 0 && <path d={path('cfd')} fill="none" stroke={COLORS.cfd} strokeWidth={2} strokeDasharray="2 3" />}
      <line className="cur" x1={x(rt)} x2={x(rt)} y1={20} y2={236} />
      <circle cx={x(rt)} cy={y(here.total)} r={6} fill={here.total < 0 ? GRAPHIC.red : GRAPHIC.green} stroke="#f8f8f8" strokeWidth={2} />
      {xTicks.map((p) => (
        <g key={p}>
          <text className="ax ax-m" x={x(p)} y={254}>
            ${p}
          </text>
          <text className="ax ax-m" x={x(p)} y={288}>
            {signed(DA_PRICE - p)}
          </text>
        </g>
      ))}
      <text className="ax ax-e" x={612} y={270}>
        real-time price, $/MWh
      </text>
      <text className="ax" x={6} y={288}>
        inc earns DA − RT
      </text>
    </svg>
  );
}

const DAYS = standardHistory();
/** Days 73 and 120 (indices 72 and 119): the two evenings when the real-time price passed $2,000. */
const SPIKE_DAYS = [72, 119];

/** Daily P&L as bars, one per historical day, with the few days that leave the scale drawn as capped bars. */
function DailyBars({ values, title, ariaLabel }: { values: number[]; title: string; ariaLabel: string }) {
  const lo = Math.min(0, quantile(values, 0.03));
  const hi = Math.max(0, quantile(values, 0.97));
  const [d0, d1] = niceDomain(lo === hi ? -1 : lo, lo === hi ? 1 : hi, 4);
  const x0 = 64;
  const x1 = 612;
  const slot = (x1 - x0) / values.length;
  const y = scale(d0, d1, 200, 24);
  const clipped = values.map((v, i) => ({ v, i })).filter((p) => p.v > d1 || p.v < d0);
  const labelled = [...clipped].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 2);
  return (
    <svg className="chart" viewBox="0 0 640 230" role="img" aria-label={ariaLabel}>
      <text className="ax" x={x0} y={12}>
        {title}
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={kusd} baseline={0} />
      {values.map((v, i) => {
        const c = Math.max(d0, Math.min(d1, v));
        const top = Math.min(y(0), y(c));
        return <rect key={i} x={x0 + i * slot + slot * 0.15} width={slot * 0.7} y={top} height={Math.abs(y(c) - y(0))} fill={v < 0 ? GRAPHIC.red : GRAPHIC.green} />;
      })}
      {clipped.map((p) => {
        const cx = x0 + (p.i + 0.5) * slot;
        const up = p.v > d1;
        const yy = up ? y(d1) : y(d0);
        return <path key={p.i} d={up ? `M${cx - 4} ${yy + 2} L${cx} ${yy - 5} L${cx + 4} ${yy + 2} Z` : `M${cx - 4} ${yy - 2} L${cx} ${yy + 5} L${cx + 4} ${yy - 2} Z`} fill="#333" />;
      })}
      {labelled.map((p) => {
        const cx = x0 + (p.i + 0.5) * slot;
        const up = p.v > d1;
        const right = cx > 480;
        return (
          <text key={p.i} className="ax" x={right ? cx - 8 : cx + 8} y={up ? y(d1) + 4 : y(d0) - 2} style={{ textAnchor: right ? 'end' : 'start', fill: '#333' }}>
            day {p.i + 1}: {short(p.v)}
          </text>
        );
      })}
      {[1, 30, 60, 90, 120].map((d) => (
        <text key={d} className="ax ax-m" x={x0 + (d - 0.5) * slot} y={220}>
          {d === 1 ? 'day 1' : d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('book', { gen: 400, inc: 0, cfd: 0, flexible: false, rt: 40, hour: 17 });
  const { gen, inc, cfd, flexible, rt, hour } = s.state;
  const book: Book = { genMW: gen, genCost: LAKESIDE.marginalCost, flexible, incMW: inc, cfdMW: cfd, strike: STRIKE };
  const here = bookPnL(book, DA_PRICE, rt);
  const exposure = bookExposure(book);

  // The book evaluated across the whole chart: is it flat at the target?
  const grid = Array.from({ length: 69 }, (_, i) => RT_MIN + i * 2.5);
  const curve = grid.map((p) => bookPnL(book, DA_PRICE, p).total);
  const lo = Math.min(...curve);
  const hiV = Math.max(...curve);
  const flat = hiV - lo < 0.5;
  const solved = flat && Math.abs(lo - TARGET) < 0.5;

  let caption: string;
  if (flat) caption = `The book is flat: it makes ${usd(lo)} this hour whatever the real-time price turns out to be.`;
  else if (flexible && gen > 0 && exposure === 0) caption = `Above $${LAKESIDE.marginalCost} the book is flat; below it, the plant switches off and the hedges keep paying, so low prices now help.`;
  else if (exposure > 0) caption = `The book is long ${exposure} MW: every $1 rise in the real-time price adds ${usd(exposure)}, and every $1 fall takes it away.`;
  else caption = `The book is short ${-exposure} MW: every $1 rise in the real-time price costs ${usd(-exposure)}.`;

  // The same book held in one hour of every historical day.
  const hist = useMemo(() => {
    const b: Book = { genMW: gen, genCost: LAKESIDE.marginalCost, flexible, incMW: inc, cfdMW: cfd, strike: STRIKE };
    const legs = bookHistory(DAYS, b, hour, LAKESIDE.marginalCost);
    const pick = (k: 'physical' | 'virtual' | 'cfd' | 'total') => legs.map((l) => l[k]);
    return { physical: pick('physical'), virtual: pick('virtual'), cfd: pick('cfd'), total: pick('total') };
  }, [gen, inc, cfd, flexible, hour]);
  const rows = [
    { id: 'physical', name: `Lakeside, ${gen} MW`, show: gen !== 0, xs: hist.physical, color: COLORS.physical },
    { id: 'virtual', name: `Virtual, ${virtualLabel(inc)}`, show: inc !== 0, xs: hist.virtual, color: COLORS.virtual },
    { id: 'cfd', name: `CfD, ${cfdLabel(cfd)}`, show: cfd !== 0, xs: hist.cfd, color: COLORS.cfd },
  ]
    .filter((r) => r.show)
    .map((r) => ({ ...r, stats: summarize(r.xs) }));
  const total = summarize(hist.total);
  const losing = hist.total.filter((v) => v < 0).length;
  // The same days without the two evenings when a trip sent the real-time price past $2,000.
  const calm = summarize(hist.total.filter((_, i) => !SPIKE_DAYS.includes(i)));
  const money = (v: number) => <Tn tone={v < 0 ? 'red' : v > 0 ? 'green' : 'ink'}>{usd(v)}</Tn>;

  return (
    <LessonPage id="6.1">
      <P>
        Chapters 4 and 5 built the machinery of a wholesale market: a day-ahead auction cleared on forecasts, a real-time market that settles whatever actually happens,
        and prices that differ from node to node. This chapter is about the people who take positions in that machinery. Some of them own power plants and deliver
        energy. Others never produce or consume a single megawatt-hour, and settle everything in cash. Both kinds of trader can be described in exactly the same way: by
        how their profit depends on prices they don’t yet know.
      </P>
      <P>
        Throughout the chapter we’ll test ideas against 120 days of “historical” prices. They aren’t real market data. They’re simulated by the course’s own model of
        the region — the same nine plants, the same six nodes, with demand and wind that miss their forecasts and plants that occasionally trip — so every price in them
        can be traced back to something physical. That makes them a fair place to learn, and a dangerous place to get confident.
      </P>
      <P>
        The 120 days run from spring into summer: the first month averages about 16 °C, the last about 27 °C. The gas price moves from day to day, between 0.85 and
        1.48 times a reference price, and that day’s <b>gas multiplier</b> scales the cost of every gas plant. Each day has day-ahead prices, cleared on the
        forecasts, and real-time prices, cleared on what actually happened. Plants trip only in real time, so the day-ahead market never sees an outage coming, and on
        two hot evenings, days 73 and 120, a trip sent the real-time price above $2,000. Positions that gain when the evening price spikes happened to pay well in
        this history. Real markets often charge a premium for that kind of insurance: in their tightest hours, day-ahead prices tend to sit above the average
        real-time price.
      </P>
      <P>
        Start with a single hour. The day-ahead market has already cleared it at <K c="price">$40</K> per MWh at the region’s trading hub. A <b>hub</b>, as <a href={lessonHref('5.3')}>Lesson 5.3</a> described, is a
        published price where contracts are written and traded, usually an average of many nodes’ prices; in our region it’s the price the region would have
        without congestion, and every price in this chapter is a hub price unless we say otherwise. The real-time price won’t be known until the hour arrives. A
        trading desk can hold three kinds of position going into that hour:
      </P>
      <P>
        <K tone="orange">Physical generation.</K> The desk runs the Lakeside combined-cycle plant, which costs $36 to produce a megawatt-hour at today’s gas price, and
        sells its output in the real-time market. It earns the real-time price minus $36 on every megawatt-hour.
      </P>
      <P>
        <K tone="violet">A virtual bid.</K> An increment offer, or <b>inc</b>, sells energy in the day-ahead market that the desk doesn’t have, and buys it back in real
        time. It earns the day-ahead price minus the real-time price. A decrement bid, or <b>dec</b>, does the reverse. No energy is ever delivered: the operator simply
        settles the two opposite positions against each other.
      </P>
      <P>
        <K tone="teal">A contract for differences.</K> Last month the desk sold a CfD with a strike of $42. Each hour it covers, the buyer pays the desk $42 minus the
        real-time price per MWh — or, when the real-time price is higher, the desk pays the buyer the difference. Again, no energy changes hands.
      </P>
      <P>Build a book from the three, and move the real-time price to see what it earns:</P>

      <Figure name="Trading Desk Simulator" scenario={s}>
        <Legend
          items={[
            { label: 'Lakeside output', color: COLORS.physical, kind: 'line' },
            { label: 'Virtual', color: COLORS.virtual, kind: 'line', dashed: true },
            { label: 'CfD', color: COLORS.cfd, kind: 'line', dashed: true },
            { label: 'Whole book', color: COLORS.total, kind: 'line' },
          ]}
        />
        <PayoffChart book={book} rt={rt} />
        <Readouts
          items={[
            { label: `P&L if real-time is $${rt}`, value: usd(here.total), tone: here.total < 0 ? 'red' : here.total > 0 ? 'green' : 'ink' },
            { label: 'net exposure', value: `${signed(exposure)} MW` },
            { label: `worst case, ${usd(RT_MIN)} to ${usd(RT_MAX)}`, value: usd(lo), tone: lo < 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider label="Lakeside output" tone="orange" value={gen} min={0} max={400} step={10} onChange={(v) => s.set({ gen: v })} display={`${gen} MW`} />
        <Slider label="Virtual position" tone="violet" value={inc} min={-300} max={300} step={10} onChange={(v) => s.set({ inc: v })} display={virtualLabel(inc)} />
        <Slider label="CfD at $42" tone="teal" value={cfd} min={-400} max={400} step={10} onChange={(v) => s.set({ cfd: v })} display={cfdLabel(cfd)} />
        <Slider label="Real-time price" tone="green" value={rt} min={RT_MIN} max={RT_MAX} onChange={(v) => s.set({ rt: v })} display={`$${rt} per MWh`} />
        <div style={{ textAlign: 'center' }}>
          <Checkbox label="Lakeside switches off when the price is below its cost" checked={flexible} onChange={(v) => s.set({ flexible: v })} />
        </div>
        <Eq label="Profit of the book this hour">
          <span>P&amp;L</span>
          <Op>=</Op>
          <K tone="orange">{gen}</K>
          <Op>×</Op>
          <span>(RT − $36)</span>
          <Op>+</Op>
          <K tone="violet">{inc}</K>
          <Op>×</Op>
          <span>($40 − RT)</span>
          <Op>+</Op>
          <K tone="teal">{cfd}</K>
          <Op>×</Op>
          <span>($42 − RT)</span>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Each position on its own is a straight line, and the book is just their sum. What matters most about a line is its slope: how many dollars the book gains or
        loses for each $1 move in the real-time price. That slope is the book’s <b>exposure</b>, and it’s measured in megawatts. Owning Lakeside’s output makes the desk
        long: it wants prices to rise. Selling a CfD or placing an inc makes it short. A dec, or buying a CfD, makes it long again.
      </P>
      <P>
        Add an inc of the same size as Lakeside’s output and the slopes cancel. The desk now earns $4 on every megawatt-hour, whatever happens in real time — exactly
        what it would have earned by selling the plant’s output in the day-ahead market, as in <a href={lessonHref('4.5')}>Lesson 4.5</a>. Selling the CfD instead
        locks in $6, the gap between the strike and the plant’s cost. A generator that has hedged its whole output no longer cares where the price goes, and that’s the point.
      </P>
      <P>
        Now tick the box. A gas plant doesn’t have to run: when the price is below its cost it can simply switch off. Its payoff bends at $36 and can no longer fall
        below zero. This is one of the real differences between physical and financial positions. A plant carries options a contract doesn’t — to stop, to start, to
        move its output between hours — and risks a contract doesn’t, because a plant can break down at the worst possible moment. Financial positions are cleaner, but
        they aren’t free: the operator requires traders to post collateral against them, because a book of virtuals can lose money with nothing physical behind it.
      </P>

      <Challenge
        id="a"
        question="Build a book that makes exactly $1,200 this hour, whatever the real-time price turns out to be. Lakeside doesn’t have to run at full output."
        solved={solved}
        status={
          flat
            ? `The book is flat, but at ${usd(lo)} rather than $1,200.`
            : `Right now the book makes between ${usd(lo)} and ${usd(hiV)} across the chart, depending on the real-time price.`
        }
        success="Solved. Every book that works has two things in common. The inc and the CfD together cancel Lakeside’s output megawatt for megawatt, so nothing depends on the real-time price. And what’s left is fixed in advance: $4 on every megawatt-hour sold day-ahead, $6 on every one under the CfD."
      />

      <H2>Why virtual bidding exists</H2>
      <P>
        A real generator would rarely bother with an inc: it can sell day-ahead directly. So why do grid operators let anyone sell energy they don’t have? Because the
        day-ahead price is only a forecast of the real-time one, and if it’s a biased forecast, someone will exploit the bias. Without virtual bids, the people able
        to do that are those with physical flexibility: a utility that expects real-time prices to come in lower might deliberately under-schedule its load day-ahead
        and buy the rest in real time. That leaves the operator planning tomorrow’s commitments around a picture of demand it knows is wrong.
      </P>
      <P>
        Virtual bids move the same arbitrage into a purely financial position. If real-time prices tend to be higher than day-ahead prices in some hour, traders place
        decs in that hour. Their extra day-ahead purchases raise the day-ahead price, and the gap narrows. If day-ahead prices tend to be higher, traders inc them down.
        Either way, competition between traders pushes the two prices toward each other — which is why California’s operator calls the same instrument a{' '}
        <i>convergence bid</i>. The traders are paid, when they’re right, for making the day-ahead price a better forecast.
      </P>
      <P>
        In the next demonstration, the book from <FigRef to="Trading Desk Simulator">the first demonstration</FigRef> is held in one hour of every day of the simulated
        history, with Lakeside’s cost moving with each day’s gas price. Its three positions come with it, so you can change the book, or the hour, here. When the
        book holds more than one position, a table splits the profit between them:
      </P>

      <Figure name="Trading Desk Simulator · 120 days" scenario={s}>
        <DailyBars
          values={hist.total}
          title={`P&L at ${fmtHour(hour)}, each day`}
          ariaLabel={`The book’s profit at ${fmtHour(hour)} on each of 120 simulated days. Average ${usd(total.mean)} per day, or ${usd(calm.mean)} without days 73 and 120; worst day ${usd(total.worst)}, best day ${usd(total.best)}.`}
        />
        <Slider label="Lakeside output" tone="orange" value={gen} min={0} max={400} step={10} onChange={(v) => s.set({ gen: v })} display={`${gen} MW`} />
        <Slider label="Virtual position" tone="violet" value={inc} min={-300} max={300} step={10} onChange={(v) => s.set({ inc: v })} display={virtualLabel(inc)} />
        <Slider label="CfD at $42" tone="teal" value={cfd} min={-400} max={400} step={10} onChange={(v) => s.set({ cfd: v })} display={cfdLabel(cfd)} />
        <Slider label="Hour of the day" value={hour} min={0} max={23} onChange={(v) => s.set({ hour: v })} display={fmtHour(hour)} />
        <Readouts
          items={[
            { label: 'average per day', value: usd(total.mean), tone: total.mean < 0 ? 'red' : 'green' },
            { label: 'without days 73 and 120', value: usd(calm.mean), tone: calm.mean < 0 ? 'red' : 'green' },
            { label: 'worst day', value: usd(total.worst), tone: total.worst < 0 ? 'red' : 'ink' },
            { label: 'losing days', value: `${losing} of ${hist.total.length}` },
          ]}
        />
        {rows.length > 1 && (
          <DataTable
            caption={`Profit by position at ${fmtHour(hour)}, per day`}
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              {
                label: 'Position',
                cell: (r) => (
                  <>
                    <span className="sw" style={{ background: r.color, marginRight: 8, verticalAlign: '-1px' }} />
                    {r.name}
                  </>
                ),
              },
              { label: 'Average', cell: (r) => money(r.stats.mean) },
              { label: 'Worst day', cell: (r) => money(r.stats.worst) },
              { label: 'Best day', cell: (r) => money(r.stats.best) },
            ]}
          />
        )}
      </Figure>

      <P>
        At the starting settings, Lakeside sells 400 MW at 17:00 every day without any hedge. In that one hour it makes $2,595 on an average day, and it loses money
        on 35 days of the 120, when gas is expensive and the price is low. Its best day, day 73, earns $109,800: a plant tripped on a hot evening and the
        real-time price reached $325. Its three best days earn 61% of its profit over the 120 days: an unhedged generator lives on a handful of days like that one.
        Without days 73 and 120, its average falls to $1,100.
      </P>
      <P>
        Sell a 400 MW CfD as well and the spike disappears from both sides. The worst day is now day 71, a loss of $4,512, when gas was 1.48 times its reference price
        and Lakeside’s cost rose to $53.28, well above the $42 strike. The CfD fixed the price of electricity but not the price of fuel, and the gap between them — the{' '}
        <i>spark spread</i> — is what a gas plant really lives on. Hedge with a 400 MW inc instead and the worst day is only −$68, because at 17:00 gas plants usually set
        the day-ahead price, so it rises and falls with Lakeside’s own cost.
      </P>
      <P>
        Finally, zero the plant and hold a 300 MW inc on its own. It wins on 53 days, loses on 67, and its worst day, again day 73, costs $79,002. A trader holding it
        isn’t hedging anything; they’re betting that real-time prices will come in below day-ahead. Flip it to a 300 MW dec and the bet reverses: it wins on 67 days
        and averages $1,245 a day, but without days 73 and 120 it averages only $162. Being long the evening spike paid in this history, but mostly because of two
        evenings. In the next lesson we’ll ask whether that bet, or its opposite, can be made to pay — and what the spreads between the two prices really look like
        in the history.
      </P>
    </LessonPage>
  );
}
