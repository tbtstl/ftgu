import { useMemo } from 'react';
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
  Slider,
  TimeChart,
  hour as fmtHour,
  lessonHref,
  niceDomain,
  niceTicks,
  scale,
  stepPath,
  usd,
  useScenario,
} from '../../framework';
import {
  EVENING_HOURS,
  OFF_PEAK_HOURS,
  ON_PEAK_HOURS,
  averageLoad,
  averagePrice,
  hedgedMW,
  hourlyMargin,
  portfolioHistory,
  type RetailBook,
} from '../../engines/strategy/hedging';
import { histogram } from '../../engines/strategy/distribution';
import { summarize } from '../../engines/strategy/risk';
import { standardHistory } from '../../model/history';

const DAYS = standardHistory();
const SHARE = 0.2;
const RETAIL = 45;
const PREMIUM = 2;
const F_ON = averagePrice(DAYS, ON_PEAK_HOURS) + PREMIUM;
const F_OFF = averagePrice(DAYS, OFF_PEAK_HOURS) + PREMIUM;
const STRIKE = averagePrice(DAYS, EVENING_HOURS) + PREMIUM;
const LOAD_ON = averageLoad(DAYS, ON_PEAK_HOURS, SHARE);
const LOAD_OFF = averageLoad(DAYS, OFF_PEAK_HOURS, SHARE);
const LOAD_EVE = averageLoad(DAYS, EVENING_HOURS, SHARE);
const WORST_MIN = -20000;
const MEAN_MIN = 24000;
const HEDGE = GRAPHIC.violet;
const LOAD = '#8a8a8a';

function book(on: number, off: number, cfd: number): RetailBook {
  return { share: SHARE, retailPrice: RETAIL, onPeakMW: on, offPeakMW: off, onPeakPrice: F_ON, offPeakPrice: F_OFF, cfdMW: cfd, cfdStrike: STRIKE };
}

const UNHEDGED = portfolioHistory(DAYS, book(0, 0, 0)).map((d) => d.margin);
const UNHEDGED_STATS = summarize(UNHEDGED);

function kusd(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1000 ? `$${a / 1000}k` : `$${a}`);
}

/** Histogram of daily margins: the hedged book in bars, the unhedged retailer as an outline. */
function MarginHistogram({ margins, ariaLabel }: { margins: number[]; ariaLabel: string }) {
  const BIN = 5000;
  const lo = Math.max(-400000, Math.floor(Math.min(-50000, ...margins, ...UNHEDGED) / BIN) * BIN);
  const hi = Math.min(200000, Math.ceil(Math.max(50000, ...margins, ...UNHEDGED) / BIN + 1e-9) * BIN);
  const bins = Math.round((hi - lo) / BIN);
  const h1 = histogram(margins, lo, hi, bins);
  const h0 = histogram(UNHEDGED, lo, hi, bins);
  const [, d1] = niceDomain(0, Math.max(5, ...h1.counts, ...h0.counts), 4);
  const x = scale(lo, hi, 64, 612);
  const y = scale(0, d1, 190, 24);
  const w = x(lo + BIN) - x(lo);
  const centers = h0.counts.map((_, i) => x(lo + (i + 0.5) * BIN));
  const outline = stepPath(centers, h0.counts.map(y), w / 2);
  const worst = Math.min(...margins);
  const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
  const ticks = niceTicks(lo, hi, 6);
  return (
    <svg className="chart" viewBox="0 0 640 236" role="img" aria-label={ariaLabel}>
      <text className="ax" x={64} y={12}>
        Days
      </text>
      <GridY y={y} ticks={niceTicks(0, d1, 4)} x0={64} x1={612} baseline={0} />
      {h1.counts.map((c, i) =>
        c > 0 ? <rect key={i} x={x(lo + i * BIN) + 0.5} width={w - 1} y={y(c)} height={y(0) - y(c)} fill={lo + i * BIN < 0 ? GRAPHIC.red : GRAPHIC.green} opacity={0.8} /> : null,
      )}
      <path d={outline} fill="none" stroke="#555" strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1={x(worst)} x2={x(worst)} y1={24} y2={190} stroke={GRAPHIC.red} strokeWidth={1.5} />
      <text className="ax" x={x(worst) + 4} y={34} style={{ fill: '#c4382f' }}>
        worst
      </text>
      <line x1={x(mean)} x2={x(mean)} y1={24} y2={190} stroke="#333" strokeWidth={1.5} strokeDasharray="2 3" />
      <text className="ax" x={x(mean) + 4} y={48} style={{ fill: '#333' }}>
        mean
      </text>
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={208}>
          {kusd(t)}
        </text>
      ))}
      <text className="ax ax-e" x={612} y={228}>
        margin per day
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('portfolio', { day: 116, on: 0, off: 0, cfd: 0 });
  const { day, on, off, cfd } = s.state;
  const b = book(on, off, cfd);
  const hours = useMemo(() => hourlyMargin(DAYS[day], book(on, off, cfd)), [day, on, off, cfd]);
  const unhedgedHours = useMemo(() => hourlyMargin(DAYS[day], book(0, 0, 0)), [day]);
  const dayMargin = hours.reduce((a, h) => a + h.margin, 0);
  const dayUnhedged = unhedgedHours.reduce((a, h) => a + h.margin, 0);
  const load = DAYS[day].demand.map((v) => v * SHARE);
  const cover = hedgedMW(b);
  const peakHour = DAYS[day].da.indexOf(Math.max(...DAYS[day].da));
  const shortAtPeak = load[peakHour] - cover[peakHour];

  const margins = useMemo(() => portfolioHistory(DAYS, book(on, off, cfd)).map((d) => d.margin), [on, off, cfd]);
  const st = summarize(margins);
  const losing = margins.filter((m) => m < 0).length;
  const solved = st.worst >= WORST_MIN && st.mean >= MEAN_MIN;
  const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));
  const ratio = (mw: number, avg: number) => `${mw} MW · ${Math.round((100 * mw) / avg)}%`;

  return (
    <LessonPage id="6.5">
      <P>
        So far the traders in this chapter have chosen their risks. A retailer doesn’t get to. It has signed up customers at a fixed price, and those customers will
        use whatever electricity they use, whenever they use it, whatever the wholesale price happens to be. The retailer in our region serves a fifth of its demand
        and charges <K c="price">$45</K> per megawatt-hour for the energy. (A real bill adds delivery charges and taxes; we’re looking only at the energy.) It buys its
        customers’ forecast load in the day-ahead market and settles the forecast error in real time, exactly as the two-settlement system of <a href={lessonHref('4.5')}>Lesson 4.5</a> intends.
      </P>
      <P>
        On average that’s a good business: the wholesale energy costs it about $39 per megawatt-hour, so it earns $32,201 on an average day. But on 18 of the 120 days
        it loses money, and on its worst day it loses $268,847 — more than eight average days’ profit. A retailer that can lose that much in a day doesn’t stay a
        retailer for long. It needs a <b>hedge</b>: positions that pay off when its customers become expensive to serve.
      </P>
      <P>
        The standard hedge is a <b>forward</b>: an agreement to buy a fixed quantity at a fixed price for a future period. Electricity forwards trade in blocks. In North
        American markets, the standard on-peak block covers 16 daytime hours — 07:00 to 23:00 on weekdays in eastern markets such as PJM, an hour earlier in the
        West — and off-peak blocks cover the rest. Ours use the eastern hours but, to keep things simple, run every day: on-peak from 07:00 to 23:00 and off-peak
        from 23:00 to 07:00. They settle financially against the day-ahead price at the hub, so a bought block pays the retailer the day-ahead price
        minus the forward price in every hour it covers.
      </P>
      <P>
        What should the forwards cost? A real forward is priced in advance, from what the market expects, and expectations can be far off. To keep the comparison
        clean, we’ll assume the market forecast the 120 days perfectly on average, and priced each block at its average day-ahead price over the history plus a $2
        premium for the seller — <K tone="violet">$42.80</K> on-peak, <K tone="violet">$31.12</K> off-peak. Buy some blocks and see what they do to a single day:
      </P>

      <Figure name="Power Portfolio Simulator" scenario={s}>
        <Legend
          items={[
            { label: 'Customers’ load', color: LOAD },
            { label: 'Hedged volume', color: HEDGE, kind: 'line' },
          ]}
        />
        <TimeChart
          ariaLabel={`The retailer’s load on day ${day + 1}, peaking at ${Math.round(Math.max(...load))} MW, against ${Math.round(cover[peakHour])} MW of hedges at the most expensive hour.`}
          series={[
            { values: load, color: LOAD, kind: 'area', opacity: 0.35 },
            { values: load, color: LOAD, kind: 'line', width: 1.5 },
            { values: cover, color: HEDGE, kind: 'step', width: 3 },
          ]}
          yMin={0}
          yMax={Math.max(400, ...cover.map((v) => Math.ceil(v / 100) * 100))}
          yLabel="MW"
          yFormat={(v) => String(v)}
          height={200}
        />
        <TimeChart
          ariaLabel={`Hourly margin on day ${day + 1}: ${usd(dayMargin)} for the day with these hedges, against ${usd(dayUnhedged)} unhedged.`}
          series={[{ values: hours.map((h) => h.margin), color: GRAPHIC.green, kind: 'bar', colors: hours.map((h) => (h.margin < 0 ? GRAPHIC.red : GRAPHIC.green)) }]}
          yLabel="Margin each hour"
          yFormat={kusd}
          height={180}
        />
        <Readouts
          items={[
            { label: `margin on day ${day + 1}`, value: usd(dayMargin), tone: tone(dayMargin) },
            { label: 'unhedged', value: usd(dayUnhedged), tone: tone(dayUnhedged) },
            { label: `day-ahead price at ${fmtHour(peakHour)}`, value: usd(DAYS[day].da[peakHour]), tone: 'green' },
            { label: 'unhedged load then', value: `${Math.round(Math.max(0, shortAtPeak))} MW` },
          ]}
        />
        <Slider label="Day" value={day} min={0} max={DAYS.length - 1} onChange={(v) => s.set({ day: v })} display={`day ${day + 1} · ${DAYS[day].temp.toFixed(1)} °C`} />
        <Slider label="On-peak block bought" tone="violet" value={on} min={0} max={400} step={10} onChange={(v) => s.set({ on: v })} display={ratio(on, LOAD_ON)} />
        <Slider label="Off-peak block bought" tone="violet" value={off} min={0} max={300} step={10} onChange={(v) => s.set({ off: v })} display={ratio(off, LOAD_OFF)} />
      </Figure>

      <P>
        This is day 117, the worst day in the history for an unhedged retailer. It was 33 °C, and the day-ahead market, seeing the demand forecast, cleared at $250 at
        18:00 and $461 at 19:00. No plant failed; the market simply expected supply to be tight. The retailer’s customers wanted 342 MW at 19:00, and it paid around that price
        for every one of them while collecting $45.
      </P>
      <P>
        The percentage beside each block is its <b>hedge ratio</b>: the block’s size as a share of the average load in its hours, 247 MW on-peak and 168 MW off-peak.
        Buy 250 MW on-peak and 170 MW off-peak — roughly 100% of the average — and day 117 improves to a loss of $41,262. The hedge is the right size on average and
        the wrong shape for this day. A flat block over-covers midday, when the load is lower, and under-covers the evening peak. That mismatch is <b>shape
        risk</b>.
      </P>
      <P>
        It’s made worse by <b>volume risk</b>. The days with the highest prices are the hot ones, and hot days are exactly when customers use the most. On days whose
        demand forecast peaks at 1,500 MW or more, the retailer’s average evening load is 298 MW, against 266 MW on other days, and the evening’s day-ahead price averages
        $66.05 rather than $42.64. A hedge sized on the average leaves the retailer short at the worst possible moment.
      </P>

      <H2>A distribution of days</H2>
      <P>
        One day is an anecdote. To judge a hedge, we need every day at once. The next demonstration runs the portfolio across all 120 days and shows how its daily margin is
        distributed, with the unhedged retailer as a dashed outline. It adds a third instrument: a contract for differences on the evening hours, 17:00 to 22:00, with a
        strike of <K tone="violet">$52.64</K> — again the average day-ahead price in those hours plus $2. Bought by the retailer, it pays the day-ahead price minus the
        strike in each of those hours, so it’s a forward shaped to the peak. In fact a financially settled forward and a CfD are the same instrument, a swap of a
        fixed price for a market price, under two names. The CfD of <a href={lessonHref('6.1')}>Lesson 6.1</a> settled against the real-time price; here, like the
        forwards, it settles against the day-ahead price.
      </P>
      <P>
        Two readouts summarize the bad days. The <b>worst day</b> is the single largest loss in the 120 days. The <b>95% value at risk</b>, or VaR, is the loss that
        the portfolio exceeded on only 5% of days — here, 6 of the 120 — so it reads $0 when even the seventh-worst day made money. Try different mixes of the
        three:
      </P>

      <Figure name="Power Portfolio Simulator · 120 days" scenario={s}>
        <Legend
          items={[
            { label: 'Hedged, profitable days', color: GRAPHIC.green },
            { label: 'Hedged, losing days', color: GRAPHIC.red },
            { label: 'Unhedged', color: '#555', kind: 'line', dashed: true },
          ]}
        />
        <MarginHistogram
          margins={margins}
          ariaLabel={`Distribution of the retailer’s daily margin over 120 simulated days: mean ${usd(st.mean)}, worst day ${usd(st.worst)}, ${losing} losing days. Unhedged: mean ${usd(UNHEDGED_STATS.mean)}, worst ${usd(UNHEDGED_STATS.worst)}.`}
        />
        <Readouts
          items={[
            { label: 'mean margin per day', value: usd(st.mean), tone: tone(st.mean) },
            { label: 'worst day', value: usd(st.worst), tone: tone(st.worst) },
            { label: '95% value at risk', value: usd(st.var95), tone: st.var95 > 0 ? 'red' : 'ink' },
            { label: 'losing days', value: `${losing} of ${DAYS.length}` },
          ]}
        />
        <Slider label="On-peak block bought" tone="violet" value={on} min={0} max={400} step={10} onChange={(v) => s.set({ on: v })} display={ratio(on, LOAD_ON)} />
        <Slider label="Off-peak block bought" tone="violet" value={off} min={0} max={300} step={10} onChange={(v) => s.set({ off: v })} display={ratio(off, LOAD_OFF)} />
        <Slider label="Evening CfD bought" tone="violet" value={cfd} min={0} max={200} step={10} onChange={(v) => s.set({ cfd: v })} display={ratio(cfd, LOAD_EVE)} />
      </Figure>

      <P>
        Unhedged, the value at risk is $52,011. VaR is one of the most widely reported risk numbers in trading, and one of the most criticized, because it says
        nothing about how bad the days beyond it are. Here the worst day matters more, so we’ll watch both.
      </P>
      <P>
        Notice what every hedge does to the mean. Because we priced each block at its own realized average plus $2, each megawatt-hour of forwards costs exactly
        its $2 premium on average, so 250 MW on-peak and 170 MW off-peak lower the average margin from $32,201 to $21,481 a day. A real hedge is priced before
        anyone knows how the period will turn out, so in any one season it can gain or lose far more than its premium. But it isn’t a way to make money. It’s
        insurance, and the premium is what the protection costs.
      </P>

      <Challenge
        id="a"
        question="Keep the retailer’s worst day better than a $20,000 loss while its mean margin stays at least $24,000 a day."
        solved={solved}
        status={`Right now the worst day is ${usd(st.worst)} and the mean margin ${usd(st.mean)} a day.`}
        success={`Solved. The worst day is ${usd(st.worst)} and the mean ${usd(st.mean)}. Spending the hedging budget where the risk is — the evening — buys far more protection than spreading it evenly across the day.`}
      />

      <P>
        Every solution uses the evening CfD, because no flat block can cover the evening peak without also over-buying the rest of the day, and every megawatt-hour of
        over-buying costs the premium. Every solution holds an on-peak block too, since the CfD covers only five of the day’s hours. That’s the essence of hedging a
        real load: match the hedge to the shape of the exposure, accept that some risk — the extra volume on the hottest days, the hours between the blocks — will
        remain, and decide how much of the average margin that protection is worth.
      </P>
      <P>
        Retailers can also use virtual positions here. One that expects real-time prices to spike can bid more load day-ahead than it forecasts — in effect, a dec on
        the difference — and one that expects them to collapse can bid less. Those are views, not hedges, and they bring back exactly the fat-tailed risk of{' '}
        <a href={lessonHref('6.2')}>Lesson 6.2</a>. Every strategy in this chapter, hedges included, has been judged on the same 120 days. The last lesson asks how far a judgment like that can be trusted.
      </P>
    </LessonPage>
  );
}
