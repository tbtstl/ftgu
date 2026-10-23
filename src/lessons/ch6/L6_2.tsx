import { useId, useMemo } from 'react';
import {
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
  hour as fmtHour,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  signed,
  usd,
  useScenario,
} from '../../framework';
import { backtestVirtuals, peakForecast, spreadsByHour, type ForecastRule } from '../../engines/strategy/spreads';
import { describe, histogram } from '../../engines/strategy/distribution';
import { summarize } from '../../engines/strategy/risk';
import { standardHistory, type MarketDay } from '../../model/history';

const DAYS = standardHistory();
const BY_HOUR = spreadsByHour(DAYS);
const STATS = BY_HOUR.map(describe);
const MW = 10;

type FilterKind = 'all' | 'demand' | 'gas';
const FILTERS: Record<FilterKind, ((d: MarketDay) => boolean) | undefined> = {
  all: undefined,
  demand: (d) => peakForecast(d) >= 1500,
  gas: (d) => d.gas >= 1.2,
};

function kusd(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  const s = a >= 1000 ? `$${a / 1000}k` : `$${a}`;
  return (v < 0 ? '−' : '') + s;
}

function short(v: number): string {
  const a = Math.abs(v);
  const s = a >= 10000 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`;
  return (v < 0 ? '−' : '+') + s;
}

// ---------------------------------------------------------------------------
// Spread distribution by hour: whiskers 5–95%, box 25–75%, median tick, mean diamond.

const BX0 = 52;
const BX1 = 628;
const LIM = 25;

function SpreadBoxes({ selected, onSelect }: { selected: number; onSelect: (h: number) => void }) {
  const y = scale(-LIM, LIM, 214, 30);
  const slot = (BX1 - BX0) / 24;
  const cx = (h: number) => BX0 + (h + 0.5) * slot;
  const cl = (v: number) => Math.max(-LIM, Math.min(LIM, v));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="group"
      aria-label={`Real-time minus day-ahead spreads by hour over 120 simulated days. Medians are within a dollar of zero in every hour; means at 18:00–20:00 are $42–$48 because of a few extreme hours. Selected: ${fmtHour(selected)}.`}
    >
      <text className="ax" x={BX0} y={14}>
        Real-time − day-ahead, $/MWh
      </text>
      <GridY y={y} ticks={[-20, -10, 0, 10, 20]} x0={BX0} x1={BX1} format={(v) => signed(v)} baseline={0} />
      {STATS.map((s, h) => {
        const on = h === selected;
        const col = on ? '#333' : '#8a8a8a';
        const meanOff = s.mean > LIM;
        return (
          <g
            key={h}
            role="button"
            tabIndex={0}
            aria-label={`${fmtHour(h)}: median ${signed(s.median, 2)}, mean ${signed(s.mean, 2)}`}
            onClick={() => onSelect(h)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(h);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect x={cx(h) - slot / 2} y={30} width={slot} height={184} fill={on ? 'rgba(0,0,0,.05)' : 'transparent'} />
            <line x1={cx(h)} x2={cx(h)} y1={y(cl(s.q05))} y2={y(cl(s.q95))} stroke={col} strokeWidth={1.5} />
            {s.q95 > LIM && <path d={`M${cx(h) - 4} ${y(LIM) + 3} L${cx(h)} ${y(LIM) - 4} L${cx(h) + 4} ${y(LIM) + 3} Z`} fill={col} />}
            <rect x={cx(h) - slot * 0.3} width={slot * 0.6} y={y(cl(s.q75))} height={Math.max(1, y(cl(s.q25)) - y(cl(s.q75)))} fill={on ? '#cfcfcf' : '#e2e2e2'} stroke={col} strokeWidth={1} />
            <line x1={cx(h) - slot * 0.3} x2={cx(h) + slot * 0.3} y1={y(cl(s.median))} y2={y(cl(s.median))} stroke="#333" strokeWidth={2} />
            {!meanOff && (
              <path d={`M${cx(h)} ${y(s.mean) - 5} L${cx(h) + 5} ${y(s.mean)} L${cx(h)} ${y(s.mean) + 5} L${cx(h) - 5} ${y(s.mean)} Z`} fill={GRAPHIC.green} stroke="#f8f8f8" strokeWidth={1} />
            )}
            {meanOff && (
              <text className="ax ax-m" x={cx(h)} y={24} style={{ fill: '#3f7a1e', fontWeight: 500 }}>
                ${Math.round(s.mean)}
              </text>
            )}
          </g>
        );
      })}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className="ax ax-m" x={BX0 + h * slot} y={236}>
          {fmtHour(h)}
        </text>
      ))}
    </svg>
  );
}

const HLO = -30;
const HHI = 30;

function SpreadHistogram({ hour }: { hour: number }) {
  const xs = BY_HOUR[hour];
  const s = STATS[hour];
  const hg = histogram(xs, HLO, HHI, 30);
  const yMax = Math.max(4, hg.below, hg.above, ...hg.counts);
  const [, d1] = niceDomain(0, yMax, 4);
  // Two extra bins at the ends hold everything beyond ±$30.
  const x = scale(HLO - 4, HHI + 4, 64, 612);
  const y = scale(0, d1, 196, 26);
  const big = Math.max(...xs);
  const small = Math.min(...xs);
  const meanIn = s.mean > HLO && s.mean < HHI;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`Histogram of the spread at ${fmtHour(hour)} across 120 days: median ${signed(s.median, 2)}, mean ${signed(s.mean, 2)} dollars; ${hg.above} days above $30 and ${hg.below} below −$30.`}
    >
      <text className="ax" x={64} y={14}>
        Days, at {fmtHour(hour)}
      </text>
      <GridY y={y} ticks={niceTicks(0, d1, 4)} x0={64} x1={612} baseline={0} />
      {hg.counts.map((c, i) => (
        <rect key={i} x={x(HLO + i * hg.width) + 0.5} width={x(HLO + hg.width) - x(HLO) - 1} y={y(c)} height={y(0) - y(c)} fill={HLO + i * hg.width >= 0 ? GRAPHIC.green : GRAPHIC.red} opacity={0.75} />
      ))}
      {hg.above > 0 && (
        <g>
          <rect x={x(HHI) + 2} width={x(HHI + 4) - x(HHI) - 2} y={y(hg.above)} height={y(0) - y(hg.above)} fill="#555" />
          <text className="ax ax-e" x={612} y={y(hg.above) - 22}>
            {hg.above} above $30,
          </text>
          <text className="ax ax-e" x={612} y={y(hg.above) - 8}>
            up to {usd(big)}
          </text>
        </g>
      )}
      {hg.below > 0 && (
        <g>
          <rect x={x(HLO - 4)} width={x(HLO) - x(HLO - 4) - 2} y={y(hg.below)} height={y(0) - y(hg.below)} fill="#555" />
          <text className="ax" x={64} y={y(hg.below) - 22}>
            {hg.below} below −$30,
          </text>
          <text className="ax" x={64} y={y(hg.below) - 8}>
            down to {usd(small)}
          </text>
        </g>
      )}
      <line x1={x(s.median)} x2={x(s.median)} y1={26} y2={196} stroke="#333" strokeWidth={2} />
      <text className="ax" x={x(s.median) + 5} y={36} style={{ fill: '#333' }}>
        median {signed(s.median, 2)}
      </text>
      {meanIn && (
        <>
          <line x1={x(s.mean)} x2={x(s.mean)} y1={46} y2={196} stroke={GRAPHIC.green} strokeWidth={2} strokeDasharray="5 4" />
          <text className="ax" x={x(s.mean) + 5} y={56} style={{ fill: '#3f7a1e' }}>
            mean {signed(s.mean, 2)}
          </text>
        </>
      )}
      {[-30, -20, -10, 0, 10, 20, 30].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={214}>
          {signed(v)}
        </text>
      ))}
      <text className="ax ax-e" x={612} y={230}>
        real-time − day-ahead, $/MWh{!meanIn ? ` · mean ${signed(s.mean, 2)}, off the scale` : ''}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Equity curve of the backtest, by day.

function EquityChart({ pnl, firstIndex, best }: { pnl: number[]; firstIndex: number; best: Array<{ day: number; v: number }> }) {
  const clip = useId().replace(/:/g, '');
  const n = DAYS.length;
  const eq: number[] = [];
  let run = 0;
  for (const v of pnl) eq.push((run += v));
  const [d0, d1] = niceDomain(Math.min(0, ...eq), Math.max(0, ...eq, 1), 4);
  const x0 = 64;
  const x1 = 612;
  const x = scale(0, n, x0, x1);
  const y = scale(d0, d1, 196, 22);
  const xs = [x(firstIndex), ...eq.map((_, i) => x(firstIndex + i + 1))];
  const ys = [y(0), ...eq.map(y)];
  const line = linePath(xs, ys);
  const area = `${line} L${xs[xs.length - 1]} ${y(0)} L${xs[0]} ${y(0)} Z`;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 230"
      role="img"
      aria-label={`Cumulative profit of the virtual-bidding rule, trading days ${firstIndex + 1} to ${n}, ending at ${usd(run)}.`}
    >
      <defs>
        <clipPath id={`${clip}-up`}>
          <rect x={0} y={0} width={640} height={y(0)} />
        </clipPath>
        <clipPath id={`${clip}-dn`}>
          <rect x={0} y={y(0)} width={640} height={230 - y(0)} />
        </clipPath>
      </defs>
      <text className="ax" x={x0} y={12}>
        Cumulative P&amp;L after costs
      </text>
      <rect x={x0} y={22} width={x(firstIndex) - x0} height={174} fill="rgba(0,0,0,.05)" />
      {firstIndex >= 12 && (
        <text className="ax" x={x0 + 4} y={34}>
          lookback
        </text>
      )}
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={kusd} baseline={0} />
      <path d={area} fill={GRAPHIC.green} opacity={0.18} clipPath={`url(#${clip}-up)`} />
      <path d={area} fill={GRAPHIC.red} opacity={0.18} clipPath={`url(#${clip}-dn)`} />
      <path d={line} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      {best.map((b) => {
        const i = b.day - firstIndex;
        const bx = x(b.day + 1);
        const by = y(eq[i]);
        const right = bx > 470;
        return (
          <g key={b.day}>
            <circle cx={bx} cy={by} r={4.5} fill={b.v >= 0 ? GRAPHIC.green : GRAPHIC.red} stroke="#f8f8f8" strokeWidth={1.5} />
            <text className="ax" x={right ? bx - 8 : bx + 8} y={by + 14} style={{ textAnchor: right ? 'end' : 'start', fill: '#333' }}>
              day {b.day + 1}: {short(b.v)}
            </text>
          </g>
        );
      })}
      {[1, 30, 60, 90, 120].map((d) => (
        <text key={d} className="ax ax-m" x={x(d - 0.5)} y={216}>
          {d === 1 ? 'day 1' : d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('spreads', { hour: 19 });
  const s2 = useScenario('backtest', { rule: 'median' as ForecastRule, filter: 'all' as FilterKind, window: 10, threshold: 1, cost: 0.5 });
  const { hour } = s1.state;
  const { rule, filter, window, threshold, cost } = s2.state;
  const st = STATS[hour];
  const within5 = BY_HOUR[hour].filter((v) => Math.abs(v) <= 5).length / BY_HOUR[hour].length;

  const bt = useMemo(() => backtestVirtuals(DAYS, { rule, window, threshold, mw: MW, costPerMWh: cost, filter: FILTERS[filter] }), [rule, filter, window, threshold, cost]);
  const sum = summarize(bt.pnl);
  const ranked = bt.pnl.map((v, i) => ({ v, day: i + bt.firstIndex })).sort((a, b) => b.v - a.v);
  const best2 = ranked.slice(0, 2).filter((r) => r.v > 0);
  const withoutBest = sum.total - best2.reduce((a, r) => a + r.v, 0);
  const tradedPnl = bt.positions.map((p, i) => ({ p, v: bt.pnl[i] })).filter((r) => r.p.some((x) => x !== 0));
  const wins = tradedPnl.filter((r) => r.v > 0).length;
  const solved = cost >= 1 && bt.tradedDays >= 20 && sum.total > 0 && withoutBest > 0;
  const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));

  return (
    <LessonPage id="6.2">
      <P>
        At the end of the last lesson, a trader held an inc on its own. That position is a bet on a single number: the difference between the real-time and day-ahead
        prices in an hour. We’ll call it the <K c="price">spread</K> and measure it as real-time minus day-ahead, so a positive spread is what a dec earns per
        megawatt-hour and a negative one is what an inc earns. To bet on it sensibly, a trader needs some idea of what it will be tomorrow — and the obvious place to
        look is what it has been.
      </P>
      <P>
        The simulated history has 120 days of 24 hours each, so 2,880 spreads. The next demonstration arranges them by hour of the day. Each box spans the middle half
        of that hour’s 120 values, the line through it is the median, and the whisker runs from the 5th to the 95th percentile. The green diamond is the mean. Click an
        hour, or use the slider, to see all of its days at once:
      </P>

      <Figure name="Virtual Trading Backtester" scenario={s1}>
        <Legend
          items={[
            { label: 'Middle half of days', color: '#e2e2e2' },
            { label: 'Median', color: '#333', kind: 'line' },
            { label: '5th to 95th percentile', color: '#8a8a8a', kind: 'line' },
            { label: 'Mean', color: GRAPHIC.green },
          ]}
        />
        <SpreadBoxes selected={hour} onSelect={(h) => s1.set({ hour: h })} />
        <SpreadHistogram hour={hour} />
        <Slider label="Hour" value={hour} min={0} max={23} onChange={(v) => s1.set({ hour: v })} display={fmtHour(hour)} />
        <Readouts
          items={[
            { label: 'median spread', value: usd(st.median, 2), tone: 'green' },
            { label: 'mean spread', value: usd(st.mean, 2), tone: 'green' },
            { label: 'days within ±$5', value: pct(within5) },
            { label: 'largest', value: usd(st.max) },
          ]}
        />
      </Figure>

      <P>
        In most hours, there’s almost nothing there. The median of all 2,880 spreads is exactly zero — 1,439 are positive and 1,437 negative — and 85% of them are
        within $5 of zero. An ordinary hour’s spread is noise: demand comes in a percent or two away from its forecast, the wind blows a little more or less than
        expected, and the real-time price lands a few dollars above or below the day-ahead one. In an ordinary hour, the day-ahead price is a good, unbiased forecast.
      </P>
      <P>
        The evening is different. Select 19:00. Its median is $0.46, but its mean is $47.97. Eighteen of its 120 days are off the scale to the right,
        up to $2,022, and five to the left, down to −$161: the tails are wide on both sides, and far longer on the right. Across the whole history, the 29 spreads furthest from zero, just 1% of the hours, add up to $16,759 out of a total of
        $17,298. Without them, the average spread is
        $0.19. Every one of those 29 hours falls between 17:00 and 22:00, and they come from only 11 days.
      </P>
      <P>
        Lesson 5.5 explained where such prices come from: as spare capacity runs out at the evening peak, the scarcity part of the price climbs steeply. The day-ahead
        market clears on a forecast in which every plant is available. Real time is less kind. On 15 of the 120 days, a plant tripped, and on a hot evening with little capacity to
        spare, demand coming in even slightly above its forecast is enough to send the price up. At 19:00 on a tight day, a few percent more demand or one plant fewer can multiply the price several times over. A distribution
        like this one — almost always small, occasionally enormous — is said to have <b>fat tails</b>, and it’s the most important fact about electricity spreads.
      </P>

      <H2>A backtest</H2>
      <P>
        Here is a simple trading rule. Each day, forecast every hour’s spread from the last few weeks of history: either the average spread in that hour or its median.
        Where the forecast is above a threshold, place a 10 MW dec; where it’s below minus the threshold, a 10 MW inc. Pay a transaction cost on every virtual
        megawatt-hour — the fees and uplift charges that operators allocate to virtual bids. Then settle at the day’s actual prices, and move on to the
        next day.
      </P>
      <P>
        Each day’s positions come only from days before it, so every day of the backtest is <b>out of sample</b>: the rule never sees the outcome it’s being judged
        on. That’s called a <b>walk-forward</b> test. (It’s still slightly generous. In a real market, bids for tomorrow are due before today’s real-time prices are
        known, so the most recent day wouldn’t be available yet.) Choose a rule and see what it would have made:
      </P>

      <Figure name="Virtual Trading Backtester · walk-forward" scenario={s2}>
        <Segmented
          label="Forecast"
          value={rule}
          onChange={(v) => s2.set({ rule: v })}
          options={[
            { value: 'median', label: 'Trailing median' },
            { value: 'mean', label: 'Trailing mean' },
          ]}
        />
        <Segmented
          label="Days traded"
          value={filter}
          onChange={(v) => s2.set({ filter: v })}
          options={[
            { value: 'all', label: 'Every day' },
            { value: 'demand', label: 'Peak ≥ 1,500 MW' },
            { value: 'gas', label: 'Gas ≥ 1.2×' },
          ]}
        />
        <EquityChart pnl={bt.pnl} firstIndex={bt.firstIndex} best={best2} />
        <Legend
          items={[
            { label: 'Cumulative P&L', color: '#333', kind: 'line' },
            { label: 'Two best days', color: GRAPHIC.green },
          ]}
        />
        <Readouts
          items={[
            { label: 'P&L after costs', value: usd(sum.total), tone: tone(sum.total) },
            { label: 'without its two best days', value: usd(withoutBest), tone: tone(withoutBest) },
            { label: 'winning days', value: `${wins} of ${bt.tradedDays}` },
            { label: 'costs paid', value: usd(bt.costs) },
          ]}
        />
        <Slider label="Lookback window" value={window} min={5} max={60} onChange={(v) => s2.set({ window: v })} display={`${window} days`} />
        <Slider label="Threshold" tone="green" value={threshold} min={0} max={20} step={0.5} onChange={(v) => s2.set({ threshold: v })} display={`$${threshold.toFixed(1)} per MWh`} />
        <Slider label="Transaction cost" tone="red" value={cost} min={0} max={3} step={0.25} onChange={(v) => s2.set({ cost: v })} display={`$${cost.toFixed(2)} per MWh`} />
      </Figure>

      <P>
        The starting rule — the median of the last 10 days, a $1 threshold — loses $28,350 over 110 days, and on its worst day alone it loses $42,260. The median is
        the right summary of an ordinary hour, so in the evening it sometimes points slightly negative, and the rule sells. On day 120 it held incs from 17:00 to 19:00,
        the evening the real-time price passed $2,000. A rule tuned to the typical hour gets run over by the atypical one.
      </P>
      <P>
        The <b>threshold</b> is how the rule pays for its costs. With a threshold of zero, it trades almost every hour, and most of those hours are the noise we saw
        earlier: on average they earn nothing and pay the transaction cost every time. Raising the threshold confines the rule to hours where the forecast is large enough
        to be worth the cost.
      </P>

      <Challenge
        id="a"
        question="Find a rule that would have made money after transaction costs of at least $1 per MWh — and would still have made money without its two best days."
        solved={solved}
        status={
          cost < 1
            ? `The transaction cost is set to $${cost.toFixed(2)}; raise it to at least $1.`
            : bt.tradedDays < 20
              ? `This rule trades on only ${bt.tradedDays} days; it needs a bigger sample.`
              : `Right now the rule makes ${usd(sum.total)} after costs, and ${usd(withoutBest)} without its two best days.`
        }
        success={`Solved. This rule made ${usd(sum.total)} — but it lost money on ${bt.tradedDays - wins} of the ${bt.tradedDays} days it traded, and its two best days contributed ${usd(sum.total - withoutBest)}.`}
      />

      <H2>What the backtest found</H2>
      <P>
        Try the trailing mean over 30 days, a $2 threshold and a $1 cost. It makes $127,343 — and $107,633 of it comes from day 120 and day 73, the two evenings when
        the real-time price passed $2,000. Without them it makes $19,710, and all but $22 of that comes from the nine other days in the tail. It traded on 90 days and won on 37. Its
        profit is real, in the sense that it was out of sample, but it isn’t a steady income. It’s the payoff of insurance: the rule decs the evening peak, loses a
        little on most days, and collects when a plant trips.
      </P>
      <P>
        Why does the mean find this when the median doesn’t? Because the average spread in the evening isn’t zero, and the mean is the summary that counts the tail.
        The simulated day-ahead market never expects a plant to fail, so its evening prices are systematically too low. In a real market, that bias would be an
        invitation to every virtual trader, and their decs would raise the day-ahead price until the expected spread barely covered their costs. Our history has no
        other traders in it, so the bias persists. A strategy that finds an edge in a simulator, or in any backtest, should be asked why nobody else has already taken
        it.
      </P>
      <P>
        Spreads between hours and markets are one dimension of electricity prices. The other is location. In the next lesson we’ll trade the gap between a node and the
        hub — where, as we saw in Chapter 5, the reasons for a price difference are written into the network itself.
      </P>
    </LessonPage>
  );
}
