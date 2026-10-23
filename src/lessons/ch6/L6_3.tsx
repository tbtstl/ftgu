import { useMemo } from 'react';
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
  TimeChart,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  signed,
  usd,
  useScenario,
} from '../../framework';
import {
  basis,
  congestion,
  ftrDaily,
  knownDayAhead,
  matches,
  meanByHour,
  spreadPositionDaily,
  type BasisNode,
  type Condition,
  type ConditionKind,
  type Market,
} from '../../engines/strategy/basis';
import { standardHistory } from '../../model/history';

const DAYS = standardHistory();
const NODE_COLOR: Record<BasisNode, string> = { north: GRAPHIC.teal, metro: GRAPHIC.orange };
const NODE_NAME: Record<BasisNode, string> = { north: 'North', metro: 'Metro' };
const NIGHT = [0, 1, 2, 3, 4, 5];
const AFTERNOON = [12, 13, 14, 15, 16];
const EVENING = [17, 18, 19, 20, 21];
const BLOCKS = {
  night: { hours: NIGHT, label: 'Night', span: '00:00–06:00' },
  morning: { hours: [7, 8, 9, 10, 11], label: 'Morning', span: '07:00–12:00' },
  afternoon: { hours: AFTERNOON, label: 'Afternoon', span: '12:00–17:00' },
  evening: { hours: EVENING, label: 'Evening', span: '17:00–22:00' },
};
type Block = keyof typeof BLOCKS;
const MW = 10;
const COST = 0.5;

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function kusd(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1000 ? `$${a / 1000}k` : `$${a}`);
}

/** Cumulative P&L of the two positions over the 120 days, with the spread position's trading days ticked. */
function PositionsChart({ ftr, spread, traded, ariaLabel }: { ftr: number[]; spread: number[]; traded: boolean[]; ariaLabel: string }) {
  const cum = (xs: number[]) => {
    let s = 0;
    return xs.map((v) => (s += v));
  };
  const a = cum(ftr);
  const b = cum(spread);
  const [d0, d1] = niceDomain(Math.min(0, ...a, ...b), Math.max(0, 1, ...a, ...b), 4);
  const n = DAYS.length;
  const x0 = 64;
  const x1 = 612;
  const x = scale(0, n, x0, x1);
  const y = scale(d0, d1, 192, 22);
  const xs = [x(0), ...a.map((_, i) => x(i + 1))];
  return (
    <svg className="chart" viewBox="0 0 640 240" role="img" aria-label={ariaLabel}>
      <text className="ax" x={x0} y={12}>
        Cumulative P&amp;L
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={kusd} baseline={0} />
      <path d={linePath(xs, [y(0), ...a.map(y)])} fill="none" stroke={GRAPHIC.violet} strokeWidth={2.5} strokeLinejoin="round" />
      <path d={linePath(xs, [y(0), ...b.map(y)])} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      {traded.map((t, i) => (t ? <rect key={i} x={x(i) + 0.6} y={200} width={Math.max(1, x(1) - x(0) - 1.2)} height={6} fill="#333" opacity={0.55} /> : null))}
      <text className="ax" x={x0} y={218}>
        days the spread position trades
      </text>
      {[1, 30, 60, 90, 120].map((d) => (
        <text key={d} className="ax ax-m" x={x(d - 0.5)} y={234}>
          {d === 1 ? 'day 1' : d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('hypothesis', { node: 'north' as BasisNode, market: 'da' as Market, kind: 'all' as ConditionKind, wind: 150, demand: 1500 });
  const s2 = useScenario('positions', { node: 'metro' as BasisNode, block: 'evening' as Block, kind: 'all' as ConditionKind, price: 15 });
  const { node, market, kind, wind, demand } = s1.state;
  const level = kind === 'windy' ? wind : demand;
  const picked = useMemo(() => DAYS.filter((d) => matches(d, { kind, level })), [kind, level]);
  const byHour = useMemo(() => meanByHour(picked, (d) => basis(d, node, market)), [picked, node, market]);
  const allHours = useMemo(() => meanByHour(DAYS, (d) => basis(d, node, market)), [node, market]);
  const night = avg(NIGHT.map((h) => byHour[h]));
  const aft = avg(AFTERNOON.map((h) => byHour[h]));
  const eve = avg(EVENING.map((h) => byHour[h]));
  const solvedA = node === 'north' && market === 'da' && kind === 'windy' && picked.length > 0 && night <= -10;

  const p = s2.state;
  const block = BLOCKS[p.block];
  const cond2: Condition = { kind: p.kind, level: p.kind === 'windy' ? 150 : 1500 };
  const traded = useMemo(() => DAYS.map((d) => matches(d, { kind: p.kind, level: p.kind === 'windy' ? 150 : 1500 })), [p.kind]);
  const ftr = useMemo(() => ftrDaily(DAYS, p.node, BLOCKS[p.block].hours, MW, p.price), [p.node, p.block, p.price]);
  const spread = useMemo(
    () => spreadPositionDaily(DAYS, p.node, BLOCKS[p.block].hours, MW, { kind: p.kind, level: p.kind === 'windy' ? 150 : 1500 }, COST),
    [p.node, p.block, p.kind],
  );
  const breakEven = useMemo(() => avg(DAYS.flatMap((d) => BLOCKS[p.block].hours.map((h) => congestion(d, p.node, 'da')[h]))), [p.node, p.block]);
  const ftrTotal = ftr.reduce((s, v) => s + v, 0);
  const spreadTotal = spread.reduce((s, v) => s + v, 0);
  const tradedDays = traded.filter(Boolean).length;
  const won = spread.filter((v, i) => traded[i] && v > 0).length;
  const fair = knownDayAhead(cond2);
  const solvedB = fair && tradedDays >= 5 && spreadTotal > 0;
  const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));
  const dir = p.node === 'metro' ? 'hub to Metro' : 'North to hub';

  return (
    <LessonPage id="6.3">
      <P>
        The spreads of the last lesson were differences between two markets at the same place. Chapter 5 showed that prices also differ between places: when a line
        is full, the price on one side of it rises and the price on the other side falls. Traders call the difference between a node’s price and the price at a liquid
        trading hub the <K c="price">basis</K>. Here it’s simply the node’s price minus the hub’s, so it’s negative where the node is cheap and positive where it’s dear.
      </P>
      <P>
        Two nodes in our region have bases that matter. <K tone="teal">North</K> is where Ridge wind and Falls hydro sit, far from most of the demand; in the simulated
        history, its wind and hydro, less its own small load, must leave through a 380 MW export limit. <K tone="orange">Metro</K> is the city, with 55% of the region’s
        demand and an import limit of 560 MW; whatever it can’t import must come from its own plants, Mill Creek and the Old Quay oil plant. A trader who believes
        something about congestion can test it against the history before risking money on it. Two beliefs you’ll hear, in one form or another, about almost any grid:
        the export-constrained node “goes negative on windy nights,” and the city’s premium “rises on hot afternoons.” Choose a condition and compare the average
        basis on the days that meet it with the average over all 120 days:
      </P>

      <Figure name="Nodal Basis Trader" scenario={s1}>
        <Segmented
          label="Node"
          value={node}
          onChange={(v) => s1.set({ node: v })}
          options={[
            { value: 'north', label: 'North' },
            { value: 'metro', label: 'Metro' },
          ]}
        />
        <Segmented
          label="Market"
          value={market}
          onChange={(v) => s1.set({ market: v })}
          options={[
            { value: 'da', label: 'Day-ahead' },
            { value: 'rt', label: 'Real-time' },
          ]}
        />
        <Segmented
          label="Days"
          value={kind}
          onChange={(v) => s1.set({ kind: v })}
          options={[
            { value: 'all', label: 'Every day' },
            { value: 'windy', label: 'Windy' },
            { value: 'demand', label: 'High demand' },
            { value: 'outage', label: 'Outage' },
          ]}
        />
        <Legend
          items={[
            { label: `${NODE_NAME[node]} − hub, matching days`, color: NODE_COLOR[node], kind: 'line' },
            { label: 'All 120 days', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <TimeChart
          ariaLabel={`Average ${market === 'da' ? 'day-ahead' : 'real-time'} basis of ${NODE_NAME[node]} by hour on ${picked.length} matching days: night ${signed(night, 2)}, afternoon ${signed(aft, 2)}, evening ${signed(eve, 2)} dollars per MWh.`}
          series={[
            { values: allHours, color: '#9a9a9a', kind: 'step', width: 2, dash: '6 4' },
            { values: byHour, color: NODE_COLOR[node], kind: 'step', width: 3.5 },
          ]}
          yLabel={`${NODE_NAME[node]} − hub, $/MWh`}
          yFormat={(v) => (Number.isInteger(Math.round(v * 1000) / 1000) ? signed(v) : signed(v, 1))}
          bands={[
            { from: 0, to: 6, color: 'rgba(0,0,0,.035)' },
            { from: 12, to: 17, color: 'rgba(0,0,0,.02)' },
            { from: 17, to: 22, color: 'rgba(0,0,0,.035)' },
          ]}
        />
        {kind === 'windy' && (
          <Slider label="Daily mean wind forecast at least" tone="teal" value={wind} min={50} max={300} step={10} onChange={(v) => s1.set({ wind: v })} display={`${wind} MW`} />
        )}
        {kind === 'demand' && (
          <Slider label="Peak demand forecast at least" value={demand} min={1300} max={1750} step={25} onChange={(v) => s1.set({ demand: v })} display={`${demand.toLocaleString('en-US')} MW`} />
        )}
        <Readouts
          items={[
            { label: 'matching days', value: `${picked.length} of ${DAYS.length}` },
            { label: 'night, 00:00–06:00', value: usd(night, 2), tone: 'green' },
            { label: 'afternoon, 12:00–17:00', value: usd(aft, 2), tone: 'green' },
            { label: 'evening, 17:00–22:00', value: usd(eve, 2), tone: 'green' },
          ]}
        />
        <Caption>
          {picked.length === 0
            ? 'No day in the history meets this condition, so there is nothing to test.'
            : kind === 'outage'
              ? 'Outages happen in real time, so the day-ahead market can’t see them coming; compare the two markets.'
              : picked.length < 10
                ? `Only ${picked.length} days match. An average over so few days is a story about those days, not a law.`
                : `${picked.length} days match.`}
        </Caption>
      </Figure>

      <P>
        Over all 120 days, North’s basis is almost nothing: its night-time average is −$0.61. The day-ahead market saw North congested on only 4 days, in 30 hours
        altogether. When it does congest, North’s price drops to −$5, the price at which Ridge wind offers its output, because the last megawatt-hour North can produce
        has nowhere to go and must be turned away.
      </P>

      <Challenge
        id="a"
        question="Test the first belief. Find a wind-forecast level at which North’s average day-ahead basis between midnight and 06:00 is at least $10 below the hub."
        solved={solvedA}
        status={
          node !== 'north' || market !== 'da' || kind !== 'windy'
            ? 'Choose North, the day-ahead market and windy days.'
            : picked.length === 0
              ? 'No day is that windy.'
              : `On the ${picked.length} days with at least ${wind} MW of forecast wind, North’s night-time basis averages ${usd(night, 2)}.`
        }
        success={`Solved. The belief is true — but only on ${picked.length} of the 120 days. On a merely windy night, North’s export limit still has room, and its price is the hub’s.`}
      />

      <P>
        Now switch to Metro. Across all days, its premium averages $11.79 in the afternoon and $24.11 in the evening. Select the high-demand days — those whose demand
        forecast peaks at 1,500 MW or more, which in this history are the hot ones — and the evening premium more than doubles, to $58.90. But look at the afternoon: it
        falls, to $8.98. The second belief is half wrong.
      </P>
      <P>
        The reason is that a basis has two prices in it. Metro is congested whenever the region’s demand is above about 1,018 MW, and then Mill Creek, at $42 times the
        gas price, sets Metro’s price. On a mild afternoon, the hub’s price is set by Ironwood coal at $28, so the premium is large. On a hot afternoon, the hub’s
        price rises too, to Lakeside’s gas-fired cost, and the gap between two gas plants is smaller than the gap between gas and coal. Only in the evening, when demand
        passes about 1,473 MW and Mill Creek can no longer cover Metro’s shortfall, does Old Quay’s $165 oil set the price and the premium jump.
      </P>

      <H2>Trading the basis</H2>
      <P>
        There are two common ways to take a position on congestion. A <b>financial transmission right</b>, as in Lesson 5.4, pays the day-ahead congestion between two
        points. It’s bought at an auction for a month, a season or a year at a time, long before anyone knows the weather, so its profit is the congestion that
        actually occurred minus the price paid. A <b>spread position</b> is placed day-ahead, one day at a time: buy at the dear end, sell at the cheap end, and reverse
        both in real time. It earns the real-time congestion minus the day-ahead congestion. PJM, for example, offers a version of it called an up-to-congestion
        transaction.
      </P>
      <P>
        In the next demonstration, both positions are 10 MW in the congestion direction, from hub to Metro or from North to hub. The FTR covers a block of hours on every day. The spread
        position trades the same block, only on days that meet a condition — every day, days whose demand forecast peaks at 1,500 MW or more, days whose wind
        forecast averages 150 MW or more, or days with an outage — and pays $0.50 per MWh on each of its two legs:
      </P>

      <Figure name="Nodal Basis Trader · positions" scenario={s2}>
        <Segmented
          label="Node"
          value={p.node}
          onChange={(v) => s2.set({ node: v })}
          options={[
            { value: 'metro', label: 'Metro' },
            { value: 'north', label: 'North' },
          ]}
        />
        <Segmented
          label="Hours"
          value={p.block}
          onChange={(v) => s2.set({ block: v })}
          options={(Object.keys(BLOCKS) as Block[]).map((k) => ({ value: k, label: BLOCKS[k].label }))}
        />
        <Segmented
          label="Days the spread position trades"
          value={p.kind}
          onChange={(v) => s2.set({ kind: v })}
          options={[
            { value: 'all', label: 'Every day' },
            { value: 'demand', label: 'Peak ≥ 1,500' },
            { value: 'windy', label: 'Wind ≥ 150' },
            { value: 'outage', label: 'Outage' },
          ]}
        />
        <Legend
          items={[
            { label: `FTR, ${dir}`, color: GRAPHIC.violet, kind: 'line' },
            { label: 'Spread position', color: '#333', kind: 'line' },
          ]}
        />
        <PositionsChart
          ftr={ftr}
          spread={spread}
          traded={traded}
          ariaLabel={`Cumulative profit over 120 days of a 10 MW ${dir} FTR bought at $${p.price} for ${block.span}, ending at ${usd(ftrTotal)}, and of a spread position ending at ${usd(spreadTotal)}.`}
        />
        <Slider label="FTR auction price" tone="violet" value={p.price} min={0} max={40} step={0.25} onChange={(v) => s2.set({ price: v })} display={`$${p.price.toFixed(2)} per MWh`} />
        <Readouts
          items={[
            { label: 'FTR P&L', value: usd(ftrTotal), tone: tone(ftrTotal) },
            { label: 'FTR break-even price', value: usd(breakEven, 2) },
            { label: 'spread position P&L', value: usd(spreadTotal), tone: tone(spreadTotal) },
            { label: 'spread days won', value: `${won} of ${tradedDays}` },
          ]}
        />
        <Caption>
          {fair
            ? `The FTR breaks even at the average day-ahead congestion over ${block.span}: ${usd(breakEven, 2)} per MWh.`
            : 'Careful: outages aren’t known when day-ahead bids are due. This backtest uses information no trader would have had.'}
        </Caption>
      </Figure>

      <P>
        Start with the FTR. Bought for $15 a megawatt-hour, an FTR on Metro’s evening would have made $54,658 over the 120 days, after losing money
        steadily until day 66, when the summer evenings began to pay. Its break-even price is exactly its average payout, $24.11, and an auction full of informed bidders would push its price toward that figure. Even at the break-even price, the FTR loses money on
        75 of the 120 days and wins it back on the other 45. An FTR’s value is the expected congestion; its profit is the difference between what happened and what the
        auction expected.
      </P>
      <P>
        The spread position is subtler. Trading Metro’s evening only on high-demand days sounds like acting on the belief we just confirmed — but it loses $24,310.
        The day-ahead market knows the forecast too, and its evening prices on those days already include Old Quay’s $165. In real time, the premium is often{' '}
        <i>smaller</i>: when a hot evening turns into a scarcity spike, the hub’s price shoots past $165 and Metro’s premium disappears.
      </P>

      <Challenge
        id="b"
        question="Find hours and a condition — using only what’s known day-ahead — where the spread position would have made money after costs."
        solved={solvedB}
        status={
          !fair
            ? 'Outages aren’t known day-ahead. Choose a condition a trader could actually see.'
            : tradedDays < 5
              ? 'This condition trades too few days to mean anything.'
              : `Right now the spread position makes ${usd(spreadTotal)} over ${tradedDays} days.`
        }
        success={`Solved. It made ${usd(spreadTotal)}, but it won on only ${won} of its ${tradedDays} days. Look at what it’s really holding: the risk that something goes wrong in real time that the day-ahead market didn’t expect.`}
      />

      <P>
        The morning and afternoon positions on Metro do make money, and the reason is instructive. On every day, they buy Metro’s real-time congestion at the
        day-ahead price. Most days that costs a little, but on the 6 days when Mill Creek tripped, Metro had to run Old Quay in real time and its premium jumped. The
        afternoon position made $15,112 in total, while those 6 days alone earned $22,553; on the other 114 it lost $7,441. Select the outage condition and the profit
        jumps — but no trader could have known which days to pick.
      </P>
      <P>
        The pattern is the same one we found in the last lesson. A position that is long real-time scarcity loses small amounts most of the time and collects when the
        grid has a bad day. A belief about congestion only pays if the market hasn’t already priced it in, and the market prices in whatever it can see. Real congestion
        trading is mostly about seeing something first: a line outage, a new plant, a forecast that’s wrong in a particular direction. In the next lesson we’ll meet a
        position that earns from price differences without betting on surprises at all: a battery, moving energy from cheap hours to dear ones.
      </P>
    </LessonPage>
  );
}
