import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  Sub,
  Swatch,
  TimeChart,
  Tn,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { optimizeArbitrage } from '../../engines/strategy/arbitrage';
import { batteryHistory, levelsFor, ruleSchedule } from '../../engines/strategy/batteryTrading';
import { standardHistory } from '../../model/history';

const DAYS = standardHistory();
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHALLENGE_DAY = 60; // shown to readers as day 61
const MORNING = [6, 7, 8, 9, 10, 11];
const EVENING = [17, 18, 19, 20, 21];
const ENERGY = GRAPHIC.gold;
const CHARGE_BAND = 'rgba(69, 144, 206, 0.16)';
const SELL_BAND = 'rgba(208, 112, 42, 0.16)';

const STRATEGIES = [
  { id: 'rtOptimal', name: 'Perfect foresight of real-time prices', color: '#9a9a9a', dash: '6 4' },
  { id: 'daPlanAtRt', name: 'Day-ahead plan, paid real-time prices', color: GRAPHIC.orange, dash: undefined },
  { id: 'daOptimal', name: 'Perfect foresight of day-ahead prices', color: '#333333', dash: undefined },
  { id: 'rule', name: 'Cheapest and dearest hours rule', color: GRAPHIC.blue, dash: '2 3' },
] as const;
type StrategyId = (typeof STRATEGIES)[number]['id'];

function kusd(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${a / 1e6}M` : a >= 1000 ? `$${a / 1000}k` : `$${a}`;
  return (v < 0 ? '−' : '') + s;
}

/** Stored energy in the middle of each hour, from the values at the hour boundaries. */
function midHour(soc: number[]): number[] {
  return soc.slice(1).map((e, h) => (soc[h] + e) / 2);
}

/** Contiguous runs of hours where the schedule charges (sign −1) or discharges (+1), as TimeChart bands. */
function runs(schedule: number[]) {
  const out: Array<{ from: number; to: number; color: string; label?: string }> = [];
  let h = 0;
  while (h < schedule.length) {
    const sgn = Math.sign(Math.round(schedule[h]));
    if (sgn === 0) {
      h++;
      continue;
    }
    const start = h;
    while (h < schedule.length && Math.sign(Math.round(schedule[h])) === sgn) h++;
    out.push({ from: start, to: h, color: sgn < 0 ? CHARGE_BAND : SELL_BAND, label: h - start >= 2 ? (sgn < 0 ? 'charge' : 'sell') : undefined });
  }
  return out;
}

function CumulativeChart({ series, ariaLabel }: { series: Array<{ values: number[]; color: string; dash?: string }>; ariaLabel: string }) {
  const cums = series.map((s) => {
    let run = 0;
    return s.values.map((v) => (run += v));
  });
  const all = cums.flat();
  const top = Math.max(1, ...all);
  const bottom = Math.min(0, ...all);
  const [d0, d1] = niceDomain(bottom < -0.03 * top ? bottom : 0, top, 4);
  const n = DAYS.length;
  const x0 = 64;
  const x1 = 612;
  const x = scale(0, n, x0, x1);
  const y = scale(d0, d1, 196, 22);
  const xs = [x(0), ...Array.from({ length: n }, (_, i) => x(i + 1))];
  return (
    <svg className="chart" viewBox="0 0 640 228" role="img" aria-label={ariaLabel}>
      <text className="ax" x={x0} y={12}>
        Cumulative profit
      </text>
      <GridY y={y} ticks={niceTicks(d0, d1, 4)} x0={x0} x1={x1} format={kusd} baseline={0} />
      {cums.map((c, i) => (
        <path key={i} d={linePath(xs, [y(0), ...c.map((v) => y(Math.max(d0, v)))])} fill="none" stroke={series[i].color} strokeWidth={2.5} strokeDasharray={series[i].dash} strokeLinejoin="round" />
      ))}
      {[1, 30, 60, 90, 120].map((d) => (
        <text key={d} className="ax ax-m" x={x(d - 0.5)} y={214}>
          {d === 1 ? 'day 1' : d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('battery', { day: CHALLENGE_DAY, power: 100, hours: 4, eff: 85, wear: 5 });
  const { day, power, hours, eff, wear } = s.state;
  const battery = { powerMW: power, energyMWh: power * hours, efficiency: eff / 100, soc0: 0 };
  const prices = DAYS[day].da;

  const opt = useMemo(() => {
    const b = { powerMW: power, energyMWh: power * hours, efficiency: eff / 100, soc0: 0 };
    return optimizeArbitrage(DAYS[day].da, b, { degradationPerMWh: wear, levels: levelsFor(b, 30) });
  }, [day, power, hours, eff, wear]);
  const rule = ruleSchedule(prices, battery, hours, wear);
  const cheapest = Math.min(...prices);
  const dearest = Math.max(...prices);
  const eta = eff / 100;
  const bestMargin = dearest - cheapest / eta;
  const morningSells = MORNING.some((h) => opt.schedule[h] > 0.5);
  const eveningSells = EVENING.some((h) => opt.schedule[h] > 0.5);
  const solved = day === CHALLENGE_DAY && !morningSells && eveningSells;
  const sameAsRule = rule.profit >= opt.profit - Math.max(1, 0.02 * Math.abs(opt.profit));

  // 120 days, computed from deferred values so the sliders stay responsive.
  const dPower = useDeferredValue(power);
  const dHours = useDeferredValue(hours);
  const dEff = useDeferredValue(eff);
  const dWear = useDeferredValue(wear);
  const hist = useMemo(() => {
    const b = { powerMW: dPower, energyMWh: dPower * dHours, efficiency: dEff / 100, soc0: 0 };
    return batteryHistory(DAYS, b, dWear, levelsFor(b, 6));
  }, [dPower, dHours, dEff, dWear]);
  const totals = Object.fromEntries(STRATEGIES.map((st) => [st.id, hist.reduce((a, d) => a + d[st.id], 0)])) as Record<StrategyId, number>;
  const spikes = Object.fromEntries(STRATEGIES.map((st) => [st.id, hist[72][st.id] + hist[119][st.id]])) as Record<StrategyId, number>;
  const perKwYear = (v: number) => (dPower > 0 ? (v * 365) / DAYS.length / (dPower * 1000) : 0);
  const idle = hist.filter((d) => d.cycles < 0.01).length;
  const worseInRt = hist.filter((d) => d.daPlanAtRt < d.daOptimal).length;
  const money = (v: number) => <Tn tone={v < 0 ? 'red' : 'green'}>{usd(v)}</Tn>;

  return (
    <LessonPage id="6.4">
      <P>
        Every position so far has been a bet on a surprise: real time turning out differently from day-ahead, or congestion differently from what an auction
        expected. A battery can earn from something much more dependable. Electricity is cheap at night and in the solar-heavy middle of the day, and dear at the
        evening peak, almost every day. Buy energy when it’s cheap, store it, and sell it when it’s dear. That’s <b>arbitrage</b> in its oldest sense: buying and
        selling the same thing at different prices.
      </P>
      <P>
        The battery in the next demonstration starts at 100 MW and four hours, so it stores 400 MWh. Its round-trip <K c="energy">efficiency</K> is 85%: of every megawatt-hour bought, 0.85
        comes back out. And every megawatt-hour it discharges costs $5 of <b>degradation</b> — the wear that slowly uses up a battery’s life, which an owner has to
        treat as a cost of cycling. We’ll give the battery perfect foresight of one day’s day-ahead prices and ask the optimizer from the shared engines for its most
        profitable schedule. Choose a day and a battery:
      </P>

      <Figure name="Battery Trading Optimizer" scenario={s}>
        <TimeChart
          ariaLabel={`Day-ahead prices on day ${day + 1}, from ${usd(cheapest, 2)} to ${usd(dearest, 2)} per MWh, with the optimal charging and selling hours shaded.`}
          series={[{ values: prices, color: GRAPHIC.green, kind: 'step', width: 3 }]}
          bands={runs(opt.schedule)}
          yLabel="Day-ahead price, $/MWh"
          yFormat={(v) => '$' + v}
          height={200}
        />
        <TimeChart
          ariaLabel={`Stored energy through day ${day + 1}: the optimal schedule makes ${opt.cycles.toFixed(2)} full cycles.`}
          series={[
            { values: midHour(opt.soc), color: ENERGY, kind: 'area', opacity: 0.35 },
            { values: midHour(opt.soc), color: ENERGY, kind: 'line', width: 2.5 },
            { values: midHour(rule.soc), color: GRAPHIC.blue, kind: 'line', width: 2, dash: '2 3' },
          ]}
          yMin={0}
          yMax={Math.max(10, battery.energyMWh)}
          yLabel="Stored energy, MWh"
          height={170}
        />
        <Legend
          items={[
            { label: 'Charging', color: CHARGE_BAND },
            { label: 'Selling', color: SELL_BAND },
            { label: 'Stored energy, optimal', color: ENERGY, kind: 'line' },
            { label: 'Stored energy, simple rule', color: GRAPHIC.blue, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'optimal profit', value: usd(opt.profit), tone: opt.profit < 0 ? 'red' : 'green' },
            { label: 'simple rule', value: usd(rule.profit), tone: rule.profit < 0 ? 'red' : 'green' },
            { label: 'full cycles', value: opt.cycles.toFixed(2) },
            { label: 'wear cost', value: usd(opt.degradationCost), tone: opt.degradationCost > 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider
          label="Day"
          value={day}
          min={0}
          max={DAYS.length - 1}
          onChange={(v) => s.set({ day: v })}
          display={`day ${day + 1} · ${WEEKDAY[DAYS[day].weekday]}`}
        />
        <Slider label="Power" tone="red" value={power} min={10} max={200} step={10} onChange={(v) => s.set({ power: v })} display={`${power} MW`} />
        <Slider label="Duration" tone="gold" value={hours} min={1} max={8} onChange={(v) => s.set({ hours: v })} display={`${hours} h · ${power * hours} MWh`} />
        <Slider label="Round-trip efficiency" tone="gold" value={eff} min={60} max={95} onChange={(v) => s.set({ eff: v })} display={`${eff}%`} />
        <Slider label="Degradation cost" tone="red" value={wear} min={0} max={40} onChange={(v) => s.set({ wear: v })} display={`$${wear} per MWh`} />
        <Caption>
          {opt.dischargedMWh < 0.5
            ? `No cycle is worth its wear today: even buying at ${usd(cheapest, 2)} and selling at ${usd(dearest, 2)} clears only ${usd(bestMargin, 2)} per MWh after losses.`
            : sameAsRule
              ? 'On this day the simple rule does about as well as the optimizer: one cheap stretch, one dear one.'
              : `The optimizer earns ${usd(opt.profit - rule.profit)} more than the simple rule today.`}
        </Caption>
      </Figure>

      <P>
        On day 61 the optimizer makes $8,513 with almost two full cycles. It charges overnight at $28, sells into the morning peak at $46.57, charges again in the
        middle of the day when the price falls back to $28, and sells again in the evening, when the price reaches $55.34. (The 1.90 rather than 2 cycles is the optimizer’s own rounding: it moves energy in steps of a few megawatt-hours, so it charges and discharges at slightly less than full power.)
      </P>
      <P>
        A simple rule — charge in the four cheapest hours, sell in the four dearest — makes $4,960. It sees one cheap stretch and one dear one, so it cycles once and
        misses the second opportunity entirely. Rules like this are attractive because the shape of the day is predictable enough that they capture most of the value
        most of the time. Move through the days to find ones where the rule falls further behind, and ones where it keeps up.
      </P>
      <P>
        Whether a cycle is worth making comes down to one comparison. To sell one megawatt-hour, the battery must buy 1 / 0.85 of a megawatt-hour, so a cycle earns:
      </P>
      <Eq label="Margin per megawatt-hour sold">
        <span>margin</span>
        <Op>=</Op>
        <K c="price">
          P<Sub>sell</Sub>
        </K>
        <Op>−</Op>
        <Frac
          top={
            <K c="price">
              P<Sub>buy</Sub>
            </K>
          }
          bottom={<K c="energy">{eta.toFixed(2)}</K>}
        />
        <Op>−</Op>
        <Tn tone="red">wear</Tn>
      </Eq>
      <P>
        On day 61, the morning cycle earns $46.57 − $28 / 0.85 = $13.63 per megawatt-hour before wear, and the evening cycle $22.40 at its best hour. A cycle whose
        margin is below the wear cost loses money even though it buys low and sells high.
      </P>

      <Challenge
        id="a"
        question="On day 61, find a degradation cost at which the battery skips the morning peak but still trades the evening one."
        solved={solved}
        status={
          day !== CHALLENGE_DAY
            ? `You’re looking at day ${day + 1}; go back to day 61.`
            : morningSells
              ? `At $${wear} of wear, the battery still sells in the morning.`
              : `At $${wear} of wear, the battery doesn’t sell in the evening either.`
        }
        success={`Solved. With $${wear} of wear on every megawatt-hour, the morning cycle’s margin no longer pays for itself, while the evening’s higher price still does. Degradation doesn’t stop a battery trading; it stops the marginal cycles first.`}
      />

      <P>
        The other sliders act through the same comparison. Lower the efficiency and every megawatt-hour sold needs more bought: at 70%, energy bought at $28 costs $40
        by the time it’s delivered, and day 61’s morning cycle earns only $6.57 before wear. Raise the power and the battery can fill and empty faster, which matters
        on days whose peaks are short and sharp. Raise the duration and it can carry more energy into the evening, but only if the evening has enough dear hours to
        sell it in. Every one of these choices is a trade between what the battery costs to build and how much of each day’s price shape it can capture.
      </P>
      <P>
        Notice, too, that nothing here required a forecast of anything except the day’s own prices. The optimizer knows exactly where the cheap and dear hours fall,
        which is why its answers look so clean. That is the assumption the rest of this lesson takes apart.
      </P>

      <H2>The value of foresight</H2>
      <P>
        Perfect foresight of day-ahead prices isn’t quite available. A battery has to bid before the day-ahead market clears, so this schedule is an upper bound
        on what it could earn there. But once the day-ahead prices are published, the operator does know them a day in advance. It can plan on them, run the plan
        in real time, and be paid real-time prices. In the next demonstration, the battery from{' '}
        <FigRef to="Battery Trading Optimizer">the first demonstration</FigRef> runs four ways across all 120 days:
      </P>

      <Figure name="Battery Trading Optimizer · 120 days" scenario={s}>
        <Legend items={STRATEGIES.map((st) => ({ label: st.name, color: st.color, kind: 'line' as const, dashed: !!st.dash }))} />
        <CumulativeChart
          series={STRATEGIES.map((st) => ({ values: hist.map((d) => d[st.id]), color: st.color, dash: st.dash }))}
          ariaLabel={`Cumulative profit over 120 simulated days: perfect day-ahead foresight ${usd(totals.daOptimal)}, simple rule ${usd(totals.rule)}, day-ahead plan paid real-time ${usd(totals.daPlanAtRt)}, perfect real-time foresight ${usd(totals.rtOptimal)}.`}
        />
        <DataTable
          caption="Battery profit over the 120 days, by strategy"
          rows={[...STRATEGIES]}
          rowKey={(r) => r.id}
          columns={[
            {
              label: 'Strategy',
              cell: (r) => (
                <>
                  <Swatch color={r.color} />
                  {r.name}
                </>
              ),
            },
            { label: '120 days', cell: (r) => money(totals[r.id]) },
            { label: 'per kW-year', cell: (r) => <Tn tone={totals[r.id] < 0 ? 'red' : 'green'}>{usd(perKwYear(totals[r.id]), 2)}</Tn> },
            { label: 'days 73 and 120', cell: (r) => money(spikes[r.id]) },
          ]}
        />
        <Readouts
          items={[
            { label: 'days without a cycle', value: `${idle} of ${DAYS.length}` },
            { label: 'days real-time paid less than day-ahead', value: `${worseInRt} of ${DAYS.length}` },
          ]}
        />
        <Slider label="Duration" tone="gold" value={hours} min={1} max={8} onChange={(v) => s.set({ hours: v })} display={`${hours} h`} />
        <Slider label="Degradation cost" tone="red" value={wear} min={0} max={40} onChange={(v) => s.set({ wear: v })} display={`$${wear} per MWh`} />
      </Figure>

      <P>
        With the starting battery, perfect day-ahead foresight earns $739,527 in 120 days, or $22.49 per kilowatt of power per year — the unit storage revenues are
        usually quoted in. The simple rule earns $663,878, about 90% as much. The plan run against real-time prices earns $2,149,042, nearly three times as much, and
        perfect foresight of real-time prices would have earned $2,428,588.
      </P>
      <P>
        That looks like a decisive case for real time, until you read the last column. $1,202,566 of the real-time plan’s earnings came on days 73 and 120, the two
        evenings when the real-time price passed $2,000. On 73 of the 120 days, real-time prices paid the plan <i>less</i> than day-ahead prices would have. A battery
        that stays out of the day-ahead market is holding the same position as the dec trader of Lesson 6.2: long the evening spike. In this history, that was very
        profitable. It is not the same thing as arbitrage.
      </P>
      <P>
        The gap between the top two lines is the value of knowing real-time prices in advance, and it’s the reason storage operators spend so much effort on
        forecasting. Now raise the degradation cost. At $20 per megawatt-hour, the day-ahead optimizer sits idle on 74 of the 120 days, while the simple rule, which
        cycles whatever the margin, turns most of its profit into wear. Lengthening the battery has the opposite problem: going from four hours to eight adds little,
        because there are only so many dear hours in a day to sell into.
      </P>
      <P>
        A battery’s owner usually can’t wait for the right days. It has loans to repay and wants a steady income, so it may sell part of its capacity forward, or
        lease it to a retailer who needs evening energy. The next lesson takes the other side of that trade: a retailer with customers on fixed prices, and the
        forwards, contracts and spot purchases it uses to keep its margin from being swept away by a single bad evening.
      </P>
    </LessonPage>
  );
}
