import { useMemo } from 'react';
import {
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
  fmt,
  lessonHref,
  linePath,
  mix,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CONTRACT_BUSHELS, FINAL_REPORT, MARKET_YEARS, analystView, cropYear, decFutures, marketView, type View } from '../../../engines/agriculture/market';
import { dateLabel, dayOf } from '../../../model/agriculture/region';
import { PriceChart, daysBetween } from '../shared/PriceChart';
import { centsPlain } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';

export type Decision = 'aug' | 'sep';
export const DECISION: Record<Decision, { day: number; report: number }> = {
  aug: { day: dayOf(8, 1), report: dayOf(8, 12) },
  sep: { day: dayOf(9, 1), report: dayOf(9, 12) },
};
/** Commission and slippage for a round trip, $ a bushel (simulated, about $50 a contract). */
export const COST = 0.01;

export interface Trade {
  market: View;
  analyst: View;
  /** December futures when the trader decides, and the trader's own expected December price. */
  futures: number;
  fair: number;
  /** +1 bought, −1 sold, 0 no trade. */
  side: number;
  exit: number;
  /** Profit per bushel after costs. */
  pnl: number;
}

/**
 * A crop analyst's trade in one simulated year: on the decision day, buy December futures if
 * the analyst's expected December price is over the market's by more than `threshold`, sell if it is
 * under, and close on the report day or at harvest. `share` of the market already sees what the
 * analyst sees.
 */
export function trade(year: number, decision: Decision, exitAt: 'report' | 'harvest' = 'report', share = 0, threshold = 0): Trade {
  const { day, report } = DECISION[decision];
  const futures = decFutures(year, day, share);
  const fair = decFutures(year, day, 1);
  const edge = fair - futures;
  const side = Math.abs(edge) > threshold + 1e-12 ? Math.sign(edge) : 0;
  const exit = exitAt === 'report' ? decFutures(year, report, share) : decFutures(year, FINAL_REPORT, share);
  return { market: marketView(year, day, share), analyst: analystView(year, day), futures, fair, side, exit, pnl: side === 0 ? 0 : side * (exit - futures) - COST };
}

/** Challenge 1: a year when, on September 1, the analyst's forecast moved the right way on the valley's crop yet the trade lost money by the report. */
export function rightButLost(year: number): boolean {
  const t = trade(year, 'sep');
  const actual = cropYear(year).valley;
  return Math.sign(t.analyst.mean - t.market.mean) === Math.sign(actual - t.market.mean) && t.pnl < 0;
}

export interface Record60 {
  trades: number;
  wins: number;
  total: number;
  pnls: number[];
}

export function backtest(decision: Decision, exitAt: 'report' | 'harvest', share: number, threshold: number): Record60 {
  const trades = Array.from({ length: MARKET_YEARS }, (_, i) => trade(i + 1, decision, exitAt, share, threshold));
  const taken = trades.filter((t) => t.side !== 0).map((t) => t.pnl);
  return { trades: taken.length, wins: taken.filter((p) => p > 0).length, total: taken.reduce((a, b) => a + b, 0), pnls: trades.map((t) => t.pnl) };
}

/** Challenge 2: the smallest share of the market already seeing the analyst's data (in steps of 25%) at which trading every September loses money. */
export function shareSolved(st: { decision: Decision; exit: 'report' | 'harvest'; share: number; threshold: number }): boolean {
  if (st.decision !== 'sep' || st.exit !== 'report' || st.threshold !== 0) return false;
  const loses = (s: number) => backtest('sep', 'report', s / 100, 0).total < 0;
  return loses(st.share) && (st.share === 0 || !loses(st.share - 25));
}

function ForecastCurves({ t, actual }: { t: Trade; actual: number }) {
  const x = scale(250, 750, 60, 620);
  const pdf = (v: View, h: number) => Math.exp(-0.5 * ((h - v.mean) / v.sd) ** 2) / (v.sd * Math.sqrt(2 * Math.PI));
  const hs = Array.from({ length: 201 }, (_, i) => 250 + i * 2.5);
  const top = Math.max(pdf(t.analyst, t.analyst.mean), pdf(t.market, t.market.mean));
  const y = scale(0, top * 1.1, 150, 24);
  const curve = (v: View) => linePath(hs.map(x), hs.map((h) => y(pdf(v, h))));
  return (
    <svg className="chart" viewBox="0 0 640 182" role="img" aria-label={`The market expects ${fmt(t.market.mean)} million bushels and the analyst ${fmt(t.analyst.mean)}; the valley grew ${fmt(actual)}.`}>
      <text className="ax" x={60} y={14}>
        Forecasts of the valley’s corn harvest
      </text>
      <path d={curve(t.market)} fill="none" stroke={MARKET_LINE.futures} strokeWidth={2} />
      <path d={curve(t.analyst)} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} />
      <line x1={x(actual)} x2={x(actual)} y1={24} y2={150} stroke={MARKET_LINE.cash} strokeWidth={2} strokeDasharray="4 3" />
      <text className="ax" x={x(actual) + 5} y={34} style={{ fill: '#333' }}>
        actual {fmt(actual)}
      </text>
      <line x1={60} x2={620} y1={150} y2={150} stroke="#999" />
      {[300, 400, 500, 600, 700].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={166}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={180}>
        million bushels
      </text>
    </svg>
  );
}

function TradeChart({ year, decision, t }: { year: number; decision: Decision; t: Trade }) {
  const { day, report } = DECISION[decision];
  const days = useMemo(() => daysBetween(dayOf(7, 15), FINAL_REPORT, 3), []);
  const path = useMemo(() => days.map((d) => decFutures(year, d)), [year, days]);
  return (
    <PriceChart
      from={dayOf(7, 15)}
      to={FINAL_REPORT + 4}
      height={210}
      domain={niceDomain(Math.min(...path, t.fair) - 0.1, Math.max(...path, t.fair) + 0.1, 4)}
      series={[{ days, values: path, color: MARKET_LINE.futures }]}
      vlines={[{ day: report, label: 'report' }]}
      marks={[
        { day, value: t.futures, color: MARKET_LINE.futures, label: t.side > 0 ? 'buy' : t.side < 0 ? 'sell' : '' },
        { day, value: t.fair, color: GRAPHIC.teal, label: 'analyst’s price', left: true },
        { day: report, value: t.exit, color: MARKET_LINE.futures },
      ]}
      ariaLabel={`December futures from July 15 to November 9 of year ${year}: ${usd(t.futures, 2)} on ${dateLabel(day)}, ${usd(t.exit, 2)} after the report; the analyst’s expected price was ${usd(t.fair, 2)}.`}
    />
  );
}

function PnlBars({ pnls }: { pnls: number[] }) {
  const [lo, hi] = niceDomain(Math.min(-0.2, ...pnls), Math.max(0.2, ...pnls), 4);
  const x = scale(0.5, pnls.length + 0.5, 60, 620);
  const y = scale(lo, hi, 180, 24);
  const w = (x(1) - x(0)) * 0.72;
  let run = 0;
  const cum = pnls.map((p) => (run += p));
  const cy = scale(Math.min(0, ...cum), Math.max(0.5, ...cum), 180, 24);
  return (
    <svg className="chart" viewBox="0 0 640 210" role="img" aria-label={`Profit per bushel in each of sixty simulated years, adding up to ${usd(cum[cum.length - 1], 2)} a bushel.`}>
      <text className="ax" x={60} y={14}>
        Profit per bushel, each year (bars) and added up (line, right scale)
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={(v) => usd(v, 2)} baseline={0} />
      {pnls.map((v, i) => (
        <rect key={i} x={x(i + 1) - w / 2} y={Math.min(y(v), y(0))} width={w} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={mix('#fcfcfb', v >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.6)} />
      ))}
      <path d={linePath(cum.map((_, i) => x(i + 1)), cum.map(cy))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2} />
      <text className="ax" x={622} y={cy(cum[cum.length - 1]) + 4} style={{ fill: '#333' }}>
        {usd(cum[cum.length - 1], 2)}
      </text>
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={200}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('surprise', { year: 26, decision: 'sep' as Decision });
  const t = useMemo(() => trade(s.state.year, s.state.decision), [s.state]);
  const actual = cropYear(s.state.year).valley;
  const solved1 = s.state.decision === 'sep' && rightButLost(s.state.year);

  const b = useScenario('backtest', { decision: 'sep' as Decision, exit: 'report' as 'report' | 'harvest', share: 0, threshold: 0 });
  const rec = useMemo(() => backtest(b.state.decision, b.state.exit, b.state.share / 100, b.state.threshold / 100), [b.state]);
  const solved2 = useMemo(() => shareSolved(b.state), [b.state]);

  return (
    <LessonPage id="agriculture/5.4">
      <P>
        Chapter 3 built forecasts of the valley’s harvest from the weather and from satellites. Can they make money in the futures market? A futures price is
        itself a forecast — the market’s best guess at December’s price — and it already contains whatever traders know. A crop forecast earns money only if it
        knows something the price doesn’t yet, and the price learns it soon after. This lesson tests exactly that.
      </P>
      <P>
        In our market, everyone sees the weather. Once a month the government publishes a crop report, as the U.S. Department of Agriculture does around the
        tenth of each month from August, and in our model the report carries what a full survey would: the forecast of{' '}
        <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> from temperature, rain, satellite NDVI and crop condition, as of the first of the month. A{' '}
        <K tone="teal">crop analyst</K> who buys satellite images and sends out its own scouts — as private firms and the August crop tours of the American Corn
        Belt do — has the same information on the first, eleven days before the report. That is the edge we will test: the report’s news, early. The analyst’s forecast is a probability distribution, not a number: a most likely harvest and a spread around it, the
        test-season error of the forecast. Averaging the December price over that whole distribution gives the analyst’s own <K tone="teal">fair price</K>. If it is
        over the futures price, the analyst buys; if under, sells; and closes the trade after the report. In the next demonstration the curves are the market’s and
        the analyst’s forecasts of the valley’s harvest, the dashed line the harvest that came, and the chart under them December futures through the trade.
        Choose the year and the day of the decision:
      </P>

      <Figure name="Harvest Surprise Trader" scenario={s}>
        <ForecastCurves t={t} actual={actual} />
        <Legend
          items={[
            { label: 'Market’s forecast', color: MARKET_LINE.futures, kind: 'line' },
            { label: 'Analyst’s forecast', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Actual harvest', color: MARKET_LINE.cash, kind: 'line', dashed: true },
          ]}
        />
        <TradeChart year={s.state.year} decision={s.state.decision} t={t} />
        <Readouts
          items={[
            { label: 'market expects', value: `${fmt(t.market.mean)} ± ${fmt(t.market.sd)} million bu`, tone: 'violet' },
            { label: 'analyst expects', value: `${fmt(t.analyst.mean)} ± ${fmt(t.analyst.sd)} million bu`, tone: 'teal' },
            { label: 'futures vs fair price', value: `${usd(t.futures, 2)} vs ${usd(t.fair, 2)}` },
            { label: 'profit after the report', value: `${t.pnl >= 0 ? '' : '−'}${centsPlain(Math.abs(t.pnl))} a bushel`, tone: t.pnl >= 0 ? 'green' : 'red' },
          ]}
        />
        <Segmented
          label="Decide on"
          value={s.state.decision}
          onChange={(v) => s.set({ decision: v })}
          options={[
            { value: 'aug', label: 'August 1' },
            { value: 'sep', label: 'September 1' },
          ]}
        />
        <Slider label="Simulated year" value={s.state.year} min={1} max={MARKET_YEARS} onChange={(v) => s.set({ year: v })} display={String(s.state.year)} />
      </Figure>

      <P>
        Year 26 shows the idea working. On September 1 the weather pointed to a harvest of 493 million bushels, but the satellites and the scouts saw a crop running
        short of water, and the analyst expected 460. Averaged over that forecast, December corn was worth $6.08 to the analyst, against $5.82 in the market. The analyst
        bought; on September 12 the report showed what the analyst had seen, futures jumped to $6.30, and the trade made 47 cents a bushel, about $2,360 a contract.
        The valley grew 452. What the analyst had seen in August is what <a href={lessonHref('agriculture/3.3')}>Lesson 3.3</a> measured: a canopy losing its
        green, and a crop its scouts rated as stressed, weeks before the loss shows up anywhere else. But step through other years and the picture is mixed. The valley is only part of the American crop, and the rest of the world’s
        harvests make news in the same eleven days: a correct forecast of the valley can lose money when Brazil or the Black Sea moves the other way, and a wrong
        one can win.
      </P>

      <Challenge
        id="a"
        question="Find a year in which, on September 1, the analyst’s forecast moved the right way on the valley’s crop — toward the harvest that came — yet the trade lost money by the report."
        solved={solved1}
        status={
          s.state.decision !== 'sep'
            ? 'Decide on September 1.'
            : Math.sign(t.analyst.mean - t.market.mean) === Math.sign(actual - t.market.mean)
              ? `In year ${s.state.year} the forecast moved the right way, and the trade made ${centsPlain(t.pnl)} a bushel.`
              : `In year ${s.state.year} the analyst’s forecast moved away from the harvest that came.`
        }
        success={`Solved: in year ${s.state.year} the analyst rightly expected ${t.analyst.mean > t.market.mean ? 'more' : 'less'} corn than the market did, yet lost ${centsPlain(-t.pnl)} a bushel. The forecast was right about the valley and the trade was still wrong, because December futures price the world’s corn, not the valley’s. A forecast’s value has to be judged over many years, not one.`}
      />

      <H2>Sixty years of trading the report</H2>
      <P>
        So judge it over many. In the next demonstration the analyst trades every one of the sixty simulated years by the same rule. The bars are each year’s
        profit per bushel after costs of a cent a bushel — about $50 a contract for commissions and slippage — and the line adds them up. Choose the day of the
        decision and when to close the trade, how far the fair price must be from the futures before trading, and how much of the market already has the
        analyst’s data:
      </P>

      <Figure name="Harvest Surprise Trader · sixty years" scenario={b}>
        <PnlBars pnls={rec.pnls} />
        <Readouts
          items={[
            { label: 'trades', value: String(rec.trades) },
            { label: 'won', value: `${rec.wins} of ${rec.trades}`, tone: 'green' },
            { label: 'average per trade', value: rec.trades ? `${rec.total >= 0 ? '' : '−'}${centsPlain(Math.abs(rec.total / rec.trades), 1)} a bushel` : '—', tone: rec.total >= 0 ? 'green' : 'red' },
            { label: 'sixty years, one contract a year', value: usd(rec.total * CONTRACT_BUSHELS), tone: rec.total >= 0 ? 'green' : 'red' },
          ]}
        />
        <Segmented
          label="Decide on"
          value={b.state.decision}
          onChange={(v) => b.set({ decision: v })}
          options={[
            { value: 'aug', label: 'August 1' },
            { value: 'sep', label: 'September 1' },
          ]}
        />
        <Segmented
          label="Close"
          value={b.state.exit}
          onChange={(v) => b.set({ exit: v })}
          options={[
            { value: 'report', label: 'After the report' },
            { value: 'harvest', label: 'At harvest' },
          ]}
        />
        <Slider label="Trade only if the gap is over" value={b.state.threshold} min={0} max={20} onChange={(v) => b.set({ threshold: v })} display={`${b.state.threshold}¢`} />
        <Slider label="Market already seeing the same data" tone="teal" value={b.state.share} min={0} max={100} step={25} onChange={(v) => b.set({ share: v })} display={`${b.state.share}%`} />
      </Figure>

      <P>
        Deciding on September 1 and closing after the report, the analyst wins 41 of 60 years and makes 7.1 cents a bushel a year after costs — about $21,300 over
        the sixty years on one contract a year. The analyst’s edge and the report’s move are correlated at 0.60. Deciding on August 1 is worth about half as much,
        because early in August the satellites and scouts add little to what the weather already says: the forecast of Lesson 3.4 is barely better with them
        then. Holding
        to harvest swaps a small, steady edge for a big bet: the year-to-year swing of the profit grows from 16 cents a bushel to 49 cents or more, because the
        edge was the report, and after it the trade is only a bet on everyone else’s weather. In these sixty years that bet paid from August and not from
        September, which is what a bet does.
      </P>
      <P>
        Then the uncomfortable control. None of this is secret: companies sell exactly this analysis, and every trader who buys it moves the price toward
        the analyst’s before the report. When a quarter of the market sees what the analyst sees, the profit falls to 4.6 cents a bushel; at half, to 2.2 cents. An
        edge from public data lasts only as long as few people use it, and it is competed away to the cost of trading. (Trading on the report itself before its
        release would be another matter: the U.S. Department of Agriculture prepares its crop reports in a locked room and releases them to everyone at once.)
      </P>

      <Challenge
        id="b"
        question="Decide on September 1, close after the report, and trade every year. How large a share of the market, in steps of 25%, must already have the analyst’s data before the strategy loses money over the sixty years?"
        solved={solved2}
        status={
          b.state.decision !== 'sep' || b.state.exit !== 'report' || b.state.threshold !== 0
            ? 'Decide on September 1, close after the report, and set the gap to 0¢.'
            : rec.total >= 0
              ? `With ${b.state.share}% of the market seeing it, the strategy still makes ${centsPlain(rec.total / Math.max(1, rec.trades), 1)} a bushel a year.`
              : `With ${b.state.share}% seeing it, the strategy loses money. Is this the smallest such share?`
        }
        success={`Solved: with ${b.state.share}% of the market seeing the same data, what is left of the edge no longer pays the cent a bushel of costs, and sixty years of trading lose ${usd(-rec.total * CONTRACT_BUSHELS)} a contract. The forecast is just as good as before; it is just no longer news.`}
      />

      <P>
        <FigRef to="Harvest Surprise Trader">The forecasts</FigRef> answer the lesson’s question with a qualified yes. A probabilistic yield forecast can anticipate
        futures moves, when it is earlier or better than what the price contains, and only by as much as it is. The last lesson of the chapter puts the pieces
        together — the hedge, the curve, the basis and the forecast — and tests them the way a trader must: on years the strategy has never seen, with every cost
        counted.
      </P>
    </LessonPage>
  );
}
