import { useDeferredValue, useId, useMemo } from 'react';
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
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { LAB_SPLIT, LAB_START, applyStopLoss, drawdownSeries, labDailyPnL, type LabStrategy } from '../../engines/strategy/lab';
import { maxDrawdown, summarize } from '../../engines/strategy/risk';
import { standardHistory } from '../../model/history';

const DAYS = standardHistory();
const WINDOWS = Array.from({ length: 12 }, (_, i) => 5 + 5 * i);
const IN_DAYS = LAB_SPLIT - LAB_START;
const OUT_DAYS = DAYS.length - LAB_SPLIT;
/** Days 73 and 120 (indices 72 and 119): the two evenings when the real-time price passed $2,000. */
const SPIKE_DAYS = [72, 119];
/** The challenge's daily loss limit, $. */
const DAY_LIMIT = 20000;
const MW_MAX = 50;

// Every strategy's P&L is proportional to its position limit, so backtests run at 1 MW and are
// scaled. Results are cached for the session: revisiting a setting is instant.
const cache = new Map<string, number[]>();
function unitPnl(strategy: LabStrategy, window: number, threshold: number, cost: number): number[] {
  const key = `${strategy}|${window}|${strategy === 'battery' ? 0 : threshold}|${cost}`;
  let v = cache.get(key);
  if (!v) {
    v = labDailyPnL(DAYS, { strategy, window, threshold, costPerMWh: cost, mw: 1 });
    if (cache.size > 400) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** A strategy's daily P&L at a position limit of `mw`, with the stop-loss applied. */
function runLab(strategy: LabStrategy, window: number, threshold: number, cost: number, mw: number, stop: number) {
  return applyStopLoss(
    unitPnl(strategy, window, threshold, cost).map((v) => v * mw),
    stop,
  );
}

function kusd(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1000 ? `$${a / 1000}k` : `$${a}`);
}

/** Equity curve over drawdown, by day, with paused days shaded and the halves of the history marked. */
function LabChart({ pnl, paused, ariaLabel }: { pnl: number[]; paused: boolean[]; ariaLabel: string }) {
  const clip = useId().replace(/:/g, '');
  const n = pnl.length;
  const eq: number[] = [];
  let run = 0;
  for (const v of pnl) eq.push((run += v));
  const dd = drawdownSeries(pnl);
  const x0 = 64;
  const x1 = 612;
  const x = scale(0, n, x0, x1);
  const [e0, e1] = niceDomain(Math.min(0, ...eq), Math.max(1, ...eq), 4);
  const ye = scale(e0, e1, 176, 22);
  const [g0] = niceDomain(Math.min(-1, ...dd), 0, 3);
  const yd = scale(g0, 0, 290, 212);
  const xs = [x(0), ...eq.map((_, i) => x(i + 1))];
  const line = linePath(xs, [ye(0), ...eq.map(ye)]);
  const area = `${line} L${xs[xs.length - 1]} ${ye(0)} L${xs[0]} ${ye(0)} Z`;
  const ddLine = linePath(xs, [yd(0), ...dd.map(yd)]);
  const ddArea = `${ddLine} L${xs[xs.length - 1]} ${yd(0)} L${xs[0]} ${yd(0)} Z`;
  return (
    <svg className="chart" viewBox="0 0 640 322" role="img" aria-label={ariaLabel}>
      <defs>
        <clipPath id={`${clip}-up`}>
          <rect x={0} y={0} width={640} height={ye(0)} />
        </clipPath>
        <clipPath id={`${clip}-dn`}>
          <rect x={0} y={ye(0)} width={640} height={176 - ye(0)} />
        </clipPath>
      </defs>
      <text className="ax" x={x0} y={12}>
        Cumulative P&amp;L
      </text>
      <rect x={x0} y={22} width={x(LAB_START) - x0} height={268} fill="rgba(0,0,0,.05)" />
      {paused.map((p, i) => (p ? <rect key={i} x={x(i)} y={22} width={x(1) - x(0)} height={268} fill="rgba(231, 91, 85, .12)" /> : null))}
      <GridY y={ye} ticks={niceTicks(e0, e1, 4)} x0={x0} x1={x1} format={kusd} baseline={0} />
      <path d={area} fill={GRAPHIC.green} opacity={0.18} clipPath={`url(#${clip}-up)`} />
      <path d={area} fill={GRAPHIC.red} opacity={0.18} clipPath={`url(#${clip}-dn)`} />
      <path d={line} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      <text className="ax" x={x0} y={204}>
        Drawdown from the previous peak
      </text>
      <GridY y={yd} ticks={niceTicks(g0, 0, 2)} x0={x0} x1={x1} format={kusd} baseline={0} />
      <path d={ddArea} fill={GRAPHIC.red} opacity={0.35} />
      <path d={ddLine} fill="none" stroke={GRAPHIC.red} strokeWidth={1.5} />
      <line x1={x(LAB_SPLIT)} x2={x(LAB_SPLIT)} y1={22} y2={290} stroke="#777" strokeWidth={1} strokeDasharray="4 4" />
      <text className="ax ax-e" x={x(LAB_SPLIT) - 6} y={34}>
        first half
      </text>
      <text className="ax" x={x(LAB_SPLIT) + 6} y={34}>
        second half
      </text>
      {[1, 30, 60, 90, 120].map((d) => (
        <text key={d} className="ax ax-m" x={x(d - 0.5)} y={310}>
          {d === 1 ? 'day 1' : d}
        </text>
      ))}
    </svg>
  );
}

interface SweepPoint {
  window: number;
  inPerDay: number;
  outPerDay: number;
}

function SweepChart({ points, best, current, ariaLabel }: { points: SweepPoint[]; best: SweepPoint; current: number; ariaLabel: string }) {
  const vals = points.flatMap((p) => [p.inPerDay, p.outPerDay]);
  const [d0, d1] = niceDomain(Math.min(0, ...vals), Math.max(1, ...vals), 4);
  const x = scale(5, 60, 72, 600);
  const y = scale(d0, d1, 200, 40);
  const xs = points.map((p) => x(p.window));
  return (
    <svg className="chart" viewBox="0 0 640 240" role="img" aria-label={ariaLabel}>
      <text className="ax" x={72} y={12}>
        Average P&amp;L per day
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={72} x1={600} format={kusd} baseline={0} />
      <line className="cur" x1={x(current)} x2={x(current)} y1={30} y2={200} />
      <path d={linePath(xs, points.map((p) => y(p.inPerDay)))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} strokeDasharray="7 4" />
      <path d={linePath(xs, points.map((p) => y(p.outPerDay)))} fill="none" stroke="#333" strokeWidth={3} />
      {points.map((p) => (
        <g key={p.window}>
          <circle cx={x(p.window)} cy={y(p.inPerDay)} r={3.5} fill={GRAPHIC.blue} />
          <circle cx={x(p.window)} cy={y(p.outPerDay)} r={3.5} fill="#333" />
        </g>
      ))}
      <circle cx={x(best.window)} cy={y(best.inPerDay)} r={7} fill="none" stroke={GRAPHIC.blue} strokeWidth={2} />
      <circle cx={x(best.window)} cy={y(best.outPerDay)} r={7} fill="none" stroke="#333" strokeWidth={2} />
      <text
        className="ax"
        x={x(best.window) < 140 ? x(best.window) + 12 : x(best.window) > 540 ? x(best.window) - 12 : x(best.window)}
        y={Math.min(y(best.inPerDay), y(best.outPerDay)) - 12}
        style={{ fill: '#333', textAnchor: x(best.window) < 140 ? 'start' : x(best.window) > 540 ? 'end' : 'middle' }}
      >
        best in sample
      </text>
      {WINDOWS.map((w) => (
        <text key={w} className="ax ax-m" x={x(w)} y={218}>
          {w}
        </text>
      ))}
      <text className="ax ax-e" x={600} y={236}>
        lookback window, days
      </text>
    </svg>
  );
}

const STRATEGY_LABEL: Record<LabStrategy, string> = { spread: 'Spread virtuals', basis: 'Metro basis', battery: 'Battery' };

export default function Lesson() {
  const s = useScenario('lab', { strategy: 'spread' as LabStrategy, window: 5, threshold: 2, cost: 0.5, mw: 10, stop: 0 });
  const { strategy, window, threshold, cost, mw, stop } = s.state;
  const battery = strategy === 'battery';

  const limited = useMemo(() => runLab(strategy, window, threshold, cost, mw, stop), [strategy, window, threshold, cost, mw, stop]);
  const pnl = limited.pnl;
  const st = summarize(pnl.slice(LAB_START));
  const mdd = maxDrawdown(pnl).drawdown;
  const total = st.total;
  const withoutSpikes = total - SPIKE_DAYS.reduce((a, i) => a + pnl[i], 0);
  // The challenge: the largest position limit whose worst day stays within the daily loss limit.
  const within = st.worst >= -DAY_LIMIT;
  const nextWorst = useMemo(() => (mw < MW_MAX ? Math.min(...runLab(strategy, window, threshold, cost, mw + 1, stop).pnl) : 0), [strategy, window, threshold, cost, mw, stop]);
  const solved = within && mw < MW_MAX && nextWorst < -DAY_LIMIT;
  const tone = (v: number) => (v < 0 ? ('red' as const) : v > 0 ? ('green' as const) : ('ink' as const));

  // In-sample / out-of-sample sweep over lookback windows (without the stop-loss).
  const dStrategy = useDeferredValue(strategy);
  const dThreshold = useDeferredValue(threshold);
  const dCost = useDeferredValue(cost);
  const dMw = useDeferredValue(mw);
  const points = useMemo<SweepPoint[]>(
    () =>
      WINDOWS.map((w) => {
        const unit = unitPnl(dStrategy, w, dThreshold, dCost);
        let a = 0;
        let b = 0;
        unit.forEach((v, i) => {
          if (i < LAB_SPLIT) a += v;
          else b += v;
        });
        return { window: w, inPerDay: (dMw * a) / IN_DAYS, outPerDay: (dMw * b) / OUT_DAYS };
      }),
    [dStrategy, dThreshold, dCost, dMw],
  );
  const best = points.reduce((a, p) => (p.inPerDay > a.inPerDay ? p : a), points[0]);
  const rank = [...points].sort((a, b) => b.outPerDay - a.outPerDay).findIndex((p) => p.window === best.window) + 1;
  const mine = points.find((p) => p.window === window) ?? points[0];

  return (
    <LessonPage id="6.6">
      <P>
        Every lesson in this chapter ended in a backtest: a strategy run over the simulated history, with a number at the end. This lesson is about reading those
        numbers — what they can tell you, and the ways they lie. It’s a laboratory with three strategies from the chapter. <K tone="violet">Spread virtuals</K> is the
        trailing-mean rule of <a href={lessonHref('6.2')}>Lesson 6.2</a>. <K tone="violet">Metro basis</K> takes the spread position of{' '}
        <a href={lessonHref('6.3')}>Lesson 6.3</a> in every hour, long or short, depending on whether
        Metro’s real-time congestion has recently come in above or below its day-ahead congestion. <K tone="violet">Battery</K> is a four-hour battery that plans on the
        day-ahead prices plus the real-time premium it has recently seen in each hour, and is paid real-time prices, as in <a href={lessonHref('6.4')}>Lesson 6.4</a>.
      </P>
      <P>
        Each strategy trades days 11 to 120, deciding every day from only the days before it. The <b>position limit</b> caps its size: megawatts per hour for the
        virtual strategies, megawatts of power for the battery. How far the running total stands below the highest it has reached so far is its <b>drawdown</b>.
        The <b>stop-loss</b> is a rule a risk manager might impose: when the drawdown grows past a set amount, the desk stops trading for 10 days. Run some
        experiments:
      </P>

      <Figure name="Strategy Laboratory" scenario={s}>
        <Segmented
          label="Strategy"
          value={strategy}
          onChange={(v) => s.set({ strategy: v })}
          options={[
            { value: 'spread', label: 'Spread virtuals' },
            { value: 'basis', label: 'Metro basis' },
            { value: 'battery', label: 'Battery' },
          ]}
        />
        <LabChart
          pnl={pnl}
          paused={limited.paused}
          ariaLabel={`${STRATEGY_LABEL[strategy]} strategy over 120 simulated days: total ${usd(total)}, maximum drawdown ${usd(mdd)}, worst day ${usd(st.worst)}.`}
        />
        <Legend
          items={[
            { label: 'Cumulative P&L', color: '#333', kind: 'line' },
            { label: 'Drawdown', color: GRAPHIC.red },
            { label: 'Stopped out', color: 'rgba(231, 91, 85, .25)' },
          ]}
        />
        <Readouts
          items={[
            { label: 'total P&L', value: usd(total), tone: tone(total) },
            { label: 'without days 73 and 120', value: usd(withoutSpikes), tone: tone(withoutSpikes) },
            { label: 'maximum drawdown', value: usd(mdd), tone: mdd > 0 ? 'red' : 'ink' },
            { label: 'worst day', value: usd(st.worst), tone: tone(st.worst) },
          ]}
        />
        <Slider label="Lookback window" value={window} min={5} max={60} step={5} onChange={(v) => s.set({ window: v })} display={`${window} days`} />
        <Slider
          label="Threshold"
          tone="green"
          value={threshold}
          min={0}
          max={20}
          step={0.5}
          disabled={battery}
          onChange={(v) => s.set({ threshold: v })}
          display={battery ? 'not used' : `$${threshold.toFixed(1)} per MWh`}
        />
        <Slider label="Transaction cost" tone="red" value={cost} min={0} max={3} step={0.25} onChange={(v) => s.set({ cost: v })} display={`$${cost.toFixed(2)} per MWh`} />
        <Slider label="Position limit" tone="violet" value={mw} min={1} max={MW_MAX} onChange={(v) => s.set({ mw: v })} display={`${mw} MW`} />
        <Slider
          label="Stop-loss"
          tone="red"
          value={stop}
          min={0}
          max={50000}
          step={1000}
          onChange={(v) => s.set({ stop: v })}
          display={stop === 0 ? 'off' : `${usd(stop)} · stopped ${limited.stops}×`}
        />
      </Figure>

      <P>
        The upper chart is the <b>equity curve</b>, the running total of profit, and the lower one is its drawdown. The maximum drawdown is the worst such fall,
        and it’s the number investors and risk managers watch most closely, because it’s what they actually live through.
      </P>
      <P>
        The starting strategy decs and incs on the last five days’ average spread. Over the first half of the history it made $3,908, and looked respectable. Then,
        on day 120, recent spreads had been negative in the evening, so it held incs into the biggest spike in the history and lost $63,384 in a day; with its
        $22,752 loss on day 73 it finished at −$71,851, with a maximum drawdown of $76,437. Without those two days it would have made $14,286. A five-day average is
        mostly a record of the last few days’ noise, and it was confidently wrong at the worst possible moment.
      </P>
      <P>
        Try the stop-loss on it. At $1,000 the desk is stopped out four times and finishes worse, at −$81,023, and its worst day is still −$63,384. A stop-loss acts
        after a loss has happened. It can end a slow bleed, but it can’t prevent a loss that arrives all at once, which is how electricity losses usually arrive. For
        linear positions like these, the only limit that bounds a one-day loss in advance is the size of the position.
      </P>

      <Challenge
        id="a"
        question="A risk manager rules that the desk must never lose more than $20,000 in a day. With the starting spread strategy, what’s the largest position limit that would have kept every day within that rule?"
        solved={solved}
        status={
          !within
            ? `At ${mw} MW the worst day loses ${usd(-st.worst)}, more than $20,000.`
            : mw >= MW_MAX
              ? 'Even at 50 MW every day stays within $20,000 with these settings, so there’s no limit to find. Return to the starting strategy.'
              : `At ${mw} MW every day stays within $20,000. Could the desk trade more?`
        }
        success={`Solved. At ${mw} MW the worst day lost ${usd(-st.worst)}; at ${mw + 1} MW it would have lost ${usd(-nextWorst)}. A day’s loss grows in proportion to the position, so the limit is the loss the desk can bear divided by the worst loss per megawatt — which we only know in hindsight. A real limit has to be sized for a worst day that hasn’t happened yet.`}
      />

      <H2>Overfitting</H2>
      <P>
        The settings that made the spread rule look good in <a href={lessonHref('6.2')}>Lesson 6.2</a> — the trailing mean, a 30-day window, a $2 threshold — were
        chosen after seeing the whole history, by trying several and keeping one that worked, just as that lesson’s challenge asked you to. That’s exactly how
        backtests deceive. Try enough variations of a strategy on the same history and
        the best of them will look good partly because it happened to fit that history’s accidents. That’s <b>overfitting</b>, and the defense is to choose on one
        period and judge on another. (A stricter version, the <b>walk-forward</b> test, repeats that as the history unfolds: every few weeks it re-chooses the
        settings from the days so far and trades them on the days that follow. The lab makes a single split.) In the next demonstration, this strategy is run with
        every lookback window from 5 to 60 days. The dashed line is each window’s average daily profit in the first half of the history, the <b>in-sample</b> period
        where we choose; the solid line is the same window in the second half, the <b>out-of-sample</b> period, which we pretend not to have seen until we’ve
        chosen:
      </P>

      <Figure name="Strategy Laboratory · in sample and out of sample" scenario={s}>
        <Segmented
          label="Strategy"
          value={strategy}
          onChange={(v) => s.set({ strategy: v })}
          options={[
            { value: 'spread', label: 'Spread virtuals' },
            { value: 'basis', label: 'Metro basis' },
            { value: 'battery', label: 'Battery' },
          ]}
        />
        <Legend
          items={[
            { label: 'In sample, days 11–60', color: GRAPHIC.blue, kind: 'line', dashed: true },
            { label: 'Out of sample, days 61–120', color: '#333', kind: 'line' },
          ]}
        />
        <SweepChart
          points={points}
          best={best}
          current={window}
          ariaLabel={`Average daily profit of the ${STRATEGY_LABEL[strategy]} strategy for lookback windows from 5 to 60 days. The best in-sample window, ${best.window} days, earns ${usd(best.inPerDay)} a day in sample and ${usd(best.outPerDay)} out of sample.`}
        />
        <Readouts
          items={[
            { label: 'best window in sample', value: `${best.window} days` },
            { label: 'its in-sample P&L per day', value: usd(best.inPerDay), tone: tone(best.inPerDay) },
            { label: 'its out-of-sample P&L per day', value: usd(best.outPerDay), tone: tone(best.outPerDay) },
            { label: 'its out-of-sample rank', value: `${rank} of ${points.length}` },
          ]}
        />
        <Slider label="Lookback window" value={window} min={5} max={60} step={5} onChange={(v) => s.set({ window: v })} display={`${window} days · ${usd(mine.outPerDay)} a day out of sample`} />
      </Figure>

      <P>
        Switch the strategy to Metro basis. With the starting 10 MW limit, $2 threshold and $0.50 cost, set in{' '}
        <FigRef to="Strategy Laboratory">the first demonstration</FigRef>, the window that looks best in sample is the shortest, 5 days, at $104 a day. Out of
        sample it loses $75 a day — the worst of all twelve windows, while the median window earns $187. Nothing about a 5-day window is special. It
        happened to fit the first half’s particular sequence of outages and noise, and the second half’s came differently.
      </P>
      <P>
        The spread strategy fails differently. Its best in-sample window does fine out of sample, but it earns about seven times as much per day there as it did in
        sample. The strategy didn’t get better. The second half of the history is high summer, with hotter days, tighter evenings and both of the $2,000 spikes. A
        backtest measures a strategy and the period it ran in at the same time, and markets change: new plants, new rules, other traders noticing the same pattern.
        The battery is the most robust of the three: at 10 MW, every window earns between $2,724 and $3,108 a day out of sample, so the choice hardly matters. Its
        plan is anchored to each morning’s day-ahead prices, and the lookback only nudges it. Even so, about two-thirds of its out-of-sample profit came on the two
        spike days, because it is paid real-time prices.
      </P>
      <P>
        That is the chapter’s lesson in one place. Price differences are where traders make money: between day-ahead and real time, between nodes and hubs, between
        night and evening. Some of those differences are structural, and earn a steady return for whoever has the asset or takes the risk. Others are the price of
        rare events, and look like income until the event arrives. Telling them apart takes out-of-sample tests, honest costs, risk limits sized for the worst day
        rather than the average one, and a suspicious attitude to any backtest — especially your own. In Chapter 7 the assets get smaller and far more numerous:
        rooftop solar, home batteries and the aggregators that turn thousands of them into something that can trade like a power plant.
      </P>
    </LessonPage>
  );
}
