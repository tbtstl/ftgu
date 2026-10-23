import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Eq,
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
  Segmented,
  Slider,
  TEXT,
  TimeChart,
  Tn,
  fmt,
  hour,
  lessonHref,
  linePath,
  mw,
  mwh,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { standardHistory } from '../../model/history';
import { dailyAverages, dayAheadPurchase, hedgeBacktest, settleRetailer, type PurchaseShape } from '../../engines/market/hedging';
import { RETAILER_SHARE } from '../../engines/market/roles';

type DayKey = 'mild' | 'heat' | 'outage';
const DAYS: Record<DayKey, { index: number; label: string }> = {
  mild: { index: 22, label: 'Mild Tuesday' },
  heat: { index: 116, label: 'Heat wave' },
  outage: { index: 72, label: 'Plant outage' },
};

const HISTORY = standardHistory();
const AVERAGES = dailyAverages(HISTORY);
const RT_LIGHT = '#9bbf6f';
const CAP = 90;

export default function Lesson() {
  const s1 = useScenario('tomorrow', { day: 'mild' as DayKey, ratio: 100, revealed: false });
  const s2 = useScenario('strategy', { shape: 'follow' as PurchaseShape, ratio: 80 });
  const [cursor, setCursor] = useState(18);
  const { day, ratio, revealed } = s1.state;

  const d = HISTORY[DAYS[day].index];
  const bought = dayAheadPurchase(d, ratio / 100);
  const st = settleRetailer(d, bought);
  const forecast = d.demandForecast.map((v) => v * RETAILER_SHARE);
  const boughtMWh = bought.reduce((s, v) => s + v, 0);
  const daCost = bought.reduce((s, q, h) => s + q * d.da[h], 0);
  const hr = st.hours[cursor];
  const saved = st.allRealTime - st.total;

  const s2State = s2.state;
  const bt = useMemo(() => hedgeBacktest(HISTORY, s2State.ratio / 100, s2State.shape), [s2State.ratio, s2State.shape]);
  const solved = bt.worstPerMWh < CAP;

  // Figure 2 geometry.
  const x = scale(0, HISTORY.length - 1, 64, 608);
  const yLo = -40;
  const yHi = 160;
  const y = scale(yLo, yHi, 222, 30);
  const clip = (v: number) => Math.max(yLo, Math.min(yHi, v));
  const line = (vals: number[]) => linePath(vals.map((_, i) => x(i)), vals.map((v) => y(clip(v))));
  const spikes = AVERAGES.map((a, i) => ({ i, v: a.rt })).filter((p) => p.v > yHi);

  return (
    <LessonPage id="4.5">
      <P>
        The auction in the last lesson cleared a single hour, with demand known exactly. A real grid can’t wait until the hour arrives to decide who runs. As Lesson 4.3
        noted, starting a thermal plant costs money and many can’t run below a minimum output once on; a coal plant can take the better part of a day to start from
        cold, and even a gas plant needs time to warm up. So the operator has to
        choose most of tomorrow’s schedule today, on a forecast — and then correct it as tomorrow actually happens.
      </P>
      <P>
        Markets handle this with two auctions. The <b>day-ahead market</b> closes the morning before: buyers bid for each hour of the next day, generators offer, and the
        operator clears all 24 hours at once on forecast demand and weather, deciding which plants to start. The <b>real-time market</b> then runs continuously — every
        five minutes in American markets — re-dispatching plants to match what customers actually use, with whatever is actually available. Each
        has its own <K c="price">price</K>.
      </P>
      <P>
        The two are tied together by the rule of <b>two settlements</b>. Whatever you buy or sell day-ahead is paid at the day-ahead price. Any difference between that
        and what you actually produce or consume is settled at the real-time price. You are the retailer from Lesson 4.2, serving a fifth of the region’s customers.
        Choose a day, decide how much of tomorrow’s forecast use to buy day-ahead, then reveal what really happened:
      </P>

      <Figure
        name="Two-Settlement Simulator"
        scenario={s1}
        actions={
          <Button primary onClick={() => s1.set({ revealed: !revealed })}>
            {revealed ? 'Hide real time' : 'Reveal real time'}
          </Button>
        }
      >
        <Segmented
          label="Tomorrow"
          value={day}
          onChange={(v) => s1.set({ day: v, revealed: false })}
          options={(Object.keys(DAYS) as DayKey[]).map((k) => ({ value: k, label: DAYS[k].label }))}
        />
        <Legend
          items={[
            { label: 'Bought day-ahead', color: 'rgba(231, 91, 85, 0.35)' },
            { label: 'Forecast use', color: '#8a8a8a', kind: 'line', dashed: true },
            ...(revealed ? [{ label: 'Actual use', color: TEXT.red, kind: 'line' as const }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`Your day-ahead purchase of ${mwh(boughtMWh)} against forecast use${revealed ? ` and actual use of ${mwh(st.energy)}` : ''}.`}
          height={190}
          yLabel="Your customers’ energy, MW"
          yMin={0}
          yFormat={(v) => fmt(v)}
          cursor={cursor}
          onScrub={setCursor}
          series={[
            { values: bought, kind: 'bar', color: GRAPHIC.red, opacity: 0.35 },
            { values: forecast, color: '#8a8a8a', dash: '6 4', width: 2 },
            ...(revealed ? [{ values: st.load, color: TEXT.red, width: 2.5 }] : []),
          ]}
        />
        <Legend
          items={[
            { label: 'Day-ahead price', color: TEXT.green, kind: 'line' },
            ...(revealed ? [{ label: 'Real-time price', color: RT_LIGHT, kind: 'line' as const }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`Day-ahead${revealed ? ' and real-time' : ''} prices through the day.`}
          height={170}
          yLabel="Price, $/MWh"
          yMin={0}
          yFormat={(v) => '$' + fmt(v)}
          cursor={cursor}
          onScrub={setCursor}
          series={[...(revealed ? [{ values: d.rt, kind: 'step' as const, color: RT_LIGHT, width: 2 }] : []), { values: d.da, kind: 'step', color: TEXT.green, width: 2.5 }]}
        />
        <Slider label="Buy day-ahead" tone="red" value={ratio} min={0} max={150} step={5} onChange={(v) => s1.set({ ratio: v })} display={`${ratio}% of the forecast`} />
        {revealed ? (
          <>
            <Eq label={`Settlement at ${hour(cursor)}`}>
              <span>{hour(cursor)}</span>
              <Op>:</Op>
              <span>{mw(hr.bought)}</span>
              <Op>×</Op>
              <K c="price">{usd(d.da[cursor], 2)}</K>
              <Op>+</Op>
              <Op>(</Op>
              <span>{mw(hr.used)}</span>
              <Op>−</Op>
              <span>{mw(hr.bought)}</span>
              <Op>)</Op>
              <Op>×</Op>
              <Tn tone="green">{usd(d.rt[cursor], 2)}</Tn>
              <Op>=</Op>
              <K c="price">{usd(hr.total)}</K>
            </Eq>
            <Readouts
              items={[
                { label: 'paid day-ahead', value: usd(st.dayAhead), tone: 'green' },
                { label: 'real-time settlement', value: usd(st.realTime), tone: 'green' },
                { label: 'total for the day', value: usd(st.total), tone: 'green' },
                { label: 'all in real time instead', value: usd(st.allRealTime), tone: 'green' },
              ]}
            />
            <Caption>
              Your customers used {mwh(st.energy)} against the {mwh(boughtMWh)} you bought.{' '}
              {Math.abs(saved) < 1
                ? 'Buying day-ahead made no difference today.'
                : saved > 0
                  ? `Buying day-ahead saved ${usd(saved)} compared with buying everything in real time.`
                  : `Today, buying everything in real time would have been ${usd(-saved)} cheaper.`}
            </Caption>
          </>
        ) : (
          <>
            <Readouts
              items={[
                { label: 'bought day-ahead', value: mwh(boughtMWh), tone: 'gold' },
                { label: 'paid day-ahead', value: usd(daCost), tone: 'green' },
                { label: 'real-time settlement', value: '?' },
              ]}
            />
            <Caption>The day-ahead market has cleared. Press “Reveal real time” to see what your customers actually used, and what it cost.</Caption>
          </>
        )}
      </Figure>

      <P>
        Buying the forecast leaves only the forecast’s errors to settle in real time. On the mild Tuesday those errors are small and roughly cancel: you pay $186,502
        day-ahead and a further $488 in real time. Had you bought nothing day-ahead, you’d have paid $183,258 — the real-time price happened to be a little lower that
        day. In the heat wave, real time was cheaper again, by $53,883: demand came in below the forecast the day-ahead market cleared on, and so did the evening’s
        prices.
      </P>
      <P>
        Then the plant breaks down. With Mill Creek out on a hot evening, real-time prices pass $2,000 for three hours. Bought day-ahead, your customers’ energy for the
        day costs $374,160, and since they used a little less than forecast, you even sell the surplus back at those prices. Bought in real time, the same energy costs
        $2,610,939. Drag the slider down and watch how quickly the exposure grows.
      </P>

      <H2>A promise, not a plan</H2>
      <P>
        Notice what a day-ahead purchase is. It isn’t energy you have to take: if your customers use less, you simply sell the difference back at the real-time price. It’s
        a financial commitment to pay the day-ahead price for a quantity, with every deviation priced at real time. Generators are bound the same way. If Mill Creek had
        sold its 250 MW for 19:00 in the day-ahead market on the day it broke down, it would have been paid $46,705 for them, then charged $541,375 in real time for the
        energy it didn’t produce — the price of the replacement power the operator had to find.
      </P>
      <P>
        That’s also what makes the virtual trades from Lesson 4.2 possible. A trader who expects real time to come in above day-ahead buys day-ahead and sells the same
        amount back in real time; it never touches a megawatt-hour, but its bets nudge the two prices toward each other.
      </P>
      <P>
        So how do the two prices compare over time? Here are the daily averages for all 120 days of history, along with what your retailer pays per MWh under a strategy
        you choose, applied mechanically to every day. Choose how much of the forecast to buy day-ahead, and whether to follow the forecast hour by hour or buy one flat
        block:
      </P>

      <Figure name="Two-Settlement Simulator · 120 days" scenario={s2}>
        <Segmented
          label="Shape of the day-ahead purchase"
          value={s2State.shape}
          onChange={(v) => s2.set({ shape: v })}
          options={[
            { value: 'follow', label: 'Follow the forecast' },
            { value: 'flat', label: 'One flat block' },
          ]}
        />
        <Legend
          items={[
            { label: 'Day-ahead price, daily average', color: TEXT.green, kind: 'line' },
            { label: 'Real-time price, daily average', color: RT_LIGHT, kind: 'line' },
            { label: 'What you pay per MWh', color: '#333', kind: 'line' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 620 262"
          role="img"
          aria-label={`Daily average day-ahead and real-time prices over 120 days, and the retailer’s cost per MWh. The most expensive day costs ${usd(bt.worstPerMWh, 2)} per MWh.`}
        >
          <text className="ax" x={64} y={16}>
            $ per MWh
          </text>
          <GridY y={y} ticks={[-40, 0, 40, 80, 120, 160]} x0={64} x1={608} format={(v) => (v < 0 ? '−$' + -v : '$' + v)} baseline={0} />
          <line x1={64} x2={608} y1={y(CAP)} y2={y(CAP)} stroke="#333" strokeDasharray="3 4" strokeWidth={1} />
          <text className="ax" x={70} y={y(CAP) - 5}>
            ${CAP}
          </text>
          <path d={line(AVERAGES.map((a) => a.rt))} fill="none" stroke={RT_LIGHT} strokeWidth={2} strokeLinejoin="round" />
          <path d={line(AVERAGES.map((a) => a.da))} fill="none" stroke={TEXT.green} strokeWidth={2} strokeLinejoin="round" />
          <path d={line(bt.perMWh)} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
          {spikes.map((p) => (
            <g key={p.i}>
              <polygon points={`${x(p.i)},${y(yHi) - 8} ${x(p.i) - 5},${y(yHi)} ${x(p.i) + 5},${y(yHi)}`} fill={RT_LIGHT} />
              <text x={x(p.i)} y={y(yHi) - 12} textAnchor={p.i > 100 ? 'end' : 'middle'} style={{ fontSize: 12, fill: TEXT.green, fontWeight: 600 }}>
                {usd(p.v)}
              </text>
            </g>
          ))}
          {bt.perMWh.map((v, i) =>
            v > yHi || v < yLo ? (
              <circle key={i} cx={x(i)} cy={y(clip(v))} r={4} fill="#333" stroke="#f8f8f8" strokeWidth={1.5} />
            ) : null,
          )}
          {[1, 30, 60, 90, 120].map((t) => (
            <text key={t} className={t === 120 ? 'ax ax-e' : 'ax ax-m'} x={x(t - 1)} y={242}>
              day {t}
            </text>
          ))}
        </svg>
        <Slider label="Buy day-ahead" tone="red" value={s2State.ratio} min={0} max={150} step={5} onChange={(v) => s2.set({ ratio: v })} display={`${s2State.ratio}% of the forecast`} />
        <Readouts
          items={[
            { label: 'your cost over 120 days', value: usd(bt.total), tone: 'green' },
            { label: 'buying everything in real time', value: usd(bt.totalAllRealTime), tone: 'green' },
            { label: `most expensive day (day ${bt.worstDay + 1})`, value: `${usd(bt.worstPerMWh, 2)}/MWh`, tone: 'green' },
            { label: 'days cheaper than real time', value: `${bt.cheaperDays} of ${HISTORY.length}` },
          ]}
        />
      </Figure>

      <P>
        Most days, the two prices are almost the same: on 57 of the 120, their daily averages are within a dollar of each other, and real time comes out cheaper about as
        often as dearer. But real time has a long tail. On a handful of days a forecast miss or a breakdown sends it soaring, and the two days Mill Creek failed on a hot
        evening account for more than three quarters of the difference between the two averages. Over the whole period the real-time price averages $42.91 against $36.91 day-ahead. In real markets, the
        trading we just described tends to shrink that average gap; our simulated history has no traders to close it.
      </P>

      <Challenge
        id="a"
        question={`Find a day-ahead strategy that keeps your average cost below $${CAP} per MWh on every one of the 120 days.`}
        solved={solved}
        status={`Right now your most expensive day is day ${bt.worstDay + 1}, at ${usd(bt.worstPerMWh, 2)} per MWh.`}
        success={`Solved. Your most expensive day is now day ${bt.worstDay + 1}, at ${usd(bt.worstPerMWh, 2)} per MWh, and over the 120 days you pay ${usd(bt.totalAllRealTime - bt.total)} less than you would buying everything in real time.`}
      />

      <P>
        Buying close to the forecast caps the damage from real-time spikes, and a flat block only does the same if you buy well above the forecast — it buys too much at
        night and too little in the evening, exactly when the spikes come. But look at which day ends up most expensive. It’s the heat wave, when the day-ahead price itself
        was high. A day-ahead purchase protects you against the gap between forecast and reality; it can’t protect you against a price that’s high in both markets. That
        takes contracts signed weeks or months in advance, which is where Chapter 6 picks up.
      </P>
      <P>
        Those spikes all have the same cause: the grid running out of spare capacity. An operator doesn’t wait for that to happen. It holds capacity back, ready to step
        in when a plant trips — and holding capacity back is a service with a price of its own. That’s the <a href={lessonHref('4.6')}>last lesson of this chapter</a>.
      </P>
    </LessonPage>
  );
}
