import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
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
  Segmented,
  Slider,
  fmt,
  lessonHref,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { periodCharter, whatIf, type Drivers } from '../../../engines/shipping/strategies';
import { dailyIndex } from '../../../engines/shipping/ffa';
import { monthAverage } from '../../../engines/shipping/indices';
import { HISTORY_MONTHS, MONTH_SHORT, eventAt, monthLabel, standardHistory } from '../../../model/shipping/history';
import { OFF_HIRE_DAYS } from '../../../model/shipping/trades';

const INDEX = dailyIndex('kmax');
const HIST = standardHistory().cls.kmax;
/** Earning days in a month: hire and spot both stop while a ship is off hire. */
const EARN_DAYS_PER_MONTH = (365 - OFF_HIRE_DAYS) / 12;

const perDay = (x: number) => `${usd(x)}/day`;
const signedUsd = (x: number) => (x >= 0 ? `+${usd(x)}` : usd(x));
const $m = (x: number) => `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, 2)}m`;

export interface LabState {
  /** Month of the history at whose end the charter is agreed. */
  start: number;
  months: number;
  /** Hire against the forward strip, %: −5 means 5% below it. */
  margin: number;
  /** Extra ships delivered beyond what the market expected, %. */
  fleet: number;
  /** Cargo above or below what the market expected, %. */
  demand: number;
  /** Extra days waiting per call at Qingdao. */
  wait: number;
  panama: boolean;
}

export const START: LabState = { start: 24, months: 12, margin: 0, fleet: 0, demand: 0, wait: 0, panama: false };

/** Last start month that leaves room for a charter of this length inside the history. */
export function lastStart(months: number): number {
  return HISTORY_MONTHS - 1 - months;
}

function driversOf(s: Pick<LabState, 'fleet' | 'demand' | 'wait' | 'panama'>): Drivers | null {
  if (!s.fleet && !s.demand && !s.wait && !s.panama) return null;
  return {
    fleet: 1 + s.fleet / 100,
    demand: 1 + s.demand / 100,
    congestion: s.wait ? { QIN: s.wait } : undefined,
    closed: s.panama ? ['panama'] : undefined,
  };
}

/** What a month's index would have averaged with the physical drivers changed (via the month's re-solved market). */
export function spotWith(month: number, d: Drivers | null): number {
  const actual = monthAverage(INDEX, month);
  if (!d) return actual;
  const m = HIST[month];
  return actual * (whatIf('kmax', m, d, eventAt(month)) / m.tce);
}

/** Northwind charters a Kamsarmax in and trades her spot: the period's result under the lab's settings. */
export function charterIn(s: LabState) {
  const start = Math.min(s.start, lastStart(s.months));
  const d = driversOf(s);
  const spot = Array.from({ length: s.months }, (_, k) => spotWith(start + 1 + k, d));
  const r = periodCharter('kmax', INDEX, start, s.months, -s.margin / 100, spot);
  const actual = d ? Array.from({ length: s.months }, (_, k) => monthAverage(INDEX, start + 1 + k)) : r.spot;
  return { ...r, start, actual, avgSpot: r.spot.reduce((a, b) => a + b, 0) / r.spot.length };
}

export const PROFIT_TARGET = 1_500_000;
export const FLEET_SURPRISE = 5;

/**
 * The challenge: with 5% more ships than the market expected and every other driver at zero, a
 * 12-month charter-in at the forward strip's hire that still makes at least $1.5 million.
 */
export function fleetSurpriseSolved(s: LabState): boolean {
  if (s.months !== 12 || s.margin !== 0 || s.fleet !== FLEET_SURPRISE || s.demand !== 0 || s.wait !== 0 || s.panama) return false;
  if (s.start > lastStart(12)) return false;
  return charterIn(s).total >= PROFIT_TARGET - 1e-6;
}

/** Every start month that solves the challenge. */
export const SOLUTIONS = Array.from({ length: lastStart(12) + 1 }, (_, t) => t).filter((t) => fleetSurpriseSolved({ ...START, start: t, fleet: FLEET_SURPRISE }));

// Numbers the prose quotes.
const BASE = charterIn(START);
const BASE_FLEET5 = charterIn({ ...START, fleet: FLEET_SURPRISE });
const RATIO_FLEET5 = HIST.map((_, t) => spotWith(t, { fleet: 1.05 }) / monthAverage(INDEX, t));
const AVG_FLEET5 = RATIO_FLEET5.reduce((a, b) => a + b, 0) / RATIO_FLEET5.length;
const FIRST = SOLUTIONS[0];
const BOOK_AT_FIRST = HIST[FIRST].orderbook / HIST[FIRST].fleet;
const DEMAND_GROWTH_FIRST = HIST[FIRST + 12].demand / HIST[FIRST].demand - 1;
const FLEET_GROWTH_FIRST = HIST[FIRST + 12].fleet / HIST[FIRST].fleet - 1;

// ---------------------------------------------------------------------------
// Demonstration 2: chartering out at every start month.

export type OutDriver = 'actual' | 'fleet' | 'demand' | 'wait';

const OUT_DRIVERS: Record<OutDriver, { label: string; d: Drivers | null }> = {
  actual: { label: 'As it happened', d: null },
  fleet: { label: '5% more ships', d: { fleet: 1.05 } },
  demand: { label: '5% more cargo', d: { demand: 1.05 } },
  wait: { label: 'Three days’ wait at Qingdao', d: { congestion: { QIN: 3 } } },
};

/** The owner's gain from chartering a ship out for 12 months from each start month, against trading spot. */
export function charterOutSeries(driver: OutDriver): number[] {
  const d = OUT_DRIVERS[driver].d;
  const spot = HIST.map((_, t) => spotWith(t, d));
  return Array.from({ length: lastStart(12) + 1 }, (_, t) => -periodCharter('kmax', INDEX, t, 12, 0, spot.slice(t + 1, t + 13)).total);
}

const OUT_ACTUAL = charterOutSeries('actual');
const OUT_FLEET = charterOutSeries('fleet');
const share = (a: number[]) => a.filter((x) => x > 0).length / a.length;
const BEST_OUT = OUT_ACTUAL.indexOf(Math.max(...OUT_ACTUAL));
const WORST_OUT = OUT_ACTUAL.indexOf(Math.min(...OUT_ACTUAL));
const trailingSpot = (t: number) => {
  const xs = Array.from({ length: 12 }, (_, j) => monthAverage(INDEX, Math.max(0, t - 11 + j)));
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};
const BOOM_FIX = 36;
const SLUMP_FIX = 96;
const HIRE_BOOM = periodCharter('kmax', INDEX, BOOM_FIX, 12, 0).hire;
const HIRE_SLUMP = periodCharter('kmax', INDEX, SLUMP_FIX, 12, 0).hire;
const MONTHLY = Array.from({ length: HISTORY_MONTHS }, (_, t) => monthAverage(INDEX, t));

export default function Lesson() {
  const lab = useScenario('charter-in', START);
  const s = lab.state;
  const r = useMemo(() => charterIn(s), [s]);
  const months = s.months;
  const changed = driversOf(s) !== null;
  const solved = fleetSurpriseSolved(s);
  const earnDays = months * EARN_DAYS_PER_MONTH;
  const above = r.spot.filter((x) => x > r.hire).length;

  // Demonstration 1's chart.
  const X0 = 64;
  const X1 = 624;
  const slot = (X1 - X0) / months;
  const xc = (k: number) => X0 + (k + 0.5) * slot;
  const rateMax = Math.max(r.hire, ...r.spot, ...r.actual) * 1.1;
  const rTicks = niceTicks(0, rateMax, 4);
  const ry = scale(0, rTicks[rTicks.length - 1], 168, 28);
  const pMax = Math.max(1, ...r.monthly.map((x) => Math.abs(x)));
  const pTicks = niceTicks(0, pMax, 2);
  const pTop = pTicks[pTicks.length - 1];
  const py = scale(-pTop, pTop, 282, 206);
  const line = (ys: number[]) => ys.map((v, k) => `${k ? 'L' : 'M'}${xc(k).toFixed(1)} ${ry(v).toFixed(1)}`).join(' ');

  // Demonstration 2.
  const out = useScenario('charter-out', { driver: 'actual' as OutDriver });
  const driver = out.state.driver;
  const gains = useMemo(() => (driver === 'actual' ? OUT_ACTUAL : driver === 'fleet' ? OUT_FLEET : charterOutSeries(driver)), [driver]);
  const best = gains.indexOf(Math.max(...gains));
  const worst = gains.indexOf(Math.min(...gains));
  const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const OX0 = 64;
  const OX1 = 624;
  const oslot = (OX1 - OX0) / HISTORY_MONTHS;
  const ox = (t: number) => OX0 + (t + 0.5) * oslot;
  const iTicks = niceTicks(0, Math.max(...MONTHLY) * 1.05, 3);
  const iy = scale(0, iTicks[iTicks.length - 1], 120, 24);
  const gMax = Math.max(...OUT_ACTUAL.map(Math.abs), ...OUT_FLEET.map(Math.abs));
  const gTicks = niceTicks(0, gMax, 2);
  const gTop = gTicks[gTicks.length - 1];
  const gy = scale(-gTop, gTop, 248, 150);

  return (
    <LessonPage id="shipping/5.3">
      <P>
        <a href={lessonHref('shipping/5.2')}>The previous lesson</a> traded freight on paper: one index against another, with no ship involved. Shipping companies
        also take positions with real ships. An operator can charter a ship in for a year at a fixed daily hire and trade her on the spot market, keeping whatever
        she earns above the hire. An owner can do the opposite, and charter her own ship out for a year — the period charter of{' '}
        <a href={lessonHref('shipping/4.2')}>Lesson 4.2</a> — swapping the spot market’s swings for a fixed income. Both are bets on the same thing: whether the spot
        market over the coming year will beat the hire agreed today.
      </P>
      <P>
        This lesson asks when chartering in pays, and what physical change would make it fail. The hire isn’t a guess pulled from the air. It comes from what the
        market expects, and in our model that is the forward curve of <a href={lessonHref('shipping/4.5')}>Lesson 4.5</a>: Northwind is offered the average of the
        coming months’ forward prices, give or take a margin it negotiates. So chartering in is much like buying a strip of FFAs, with a real ship attached: Northwind
        must actually trade her, and it pays the hire every day she isn’t off hire, whether or not she finds a cargo. All money here is simulated.
      </P>
      <P>
        In the next demonstration, Northwind charters in a Kamsarmax at the end of a month of the simulated history and trades her on the spot market, earning the
        Kamsarmax index each month. Choose when, for how long and at what hire. Then change the world the forward curve didn’t see coming: more ships delivered than
        the market expected, more or less cargo, a queue at Qingdao, or the Panama Canal closed. Each month’s market is re-solved with the change, as in{' '}
        <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>, while the hire stays fixed:
      </P>

      <Figure name="Time Charter Arbitrage Lab" scenario={lab}>
        <Legend
          items={[
            { label: 'Spot earnings, Kamsarmax index', color: GRAPHIC.green, kind: 'line' },
            ...(changed ? [{ label: 'Spot as it happened', color: '#9a9a9a', kind: 'line' as const, dashed: true }] : []),
            { label: 'Hire Northwind pays', color: '#333', kind: 'line', dashed: true },
            { label: 'Profit or loss each month', color: GRAPHIC.gray },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 640 300"
          role="img"
          aria-label={`A ${months}-month charter-in from ${monthLabel(r.start + 1)} at a hire of ${perDay(r.hire)}. Spot averages ${perDay(r.avgSpot)} and beats the hire in ${above} of ${months} months; the period makes ${signedUsd(r.total)}.`}
        >
          <text className="ax" x={X0} y={14}>
            Earnings, $ per day
          </text>
          <GridY y={ry} ticks={rTicks} x0={X0} x1={X1} format={(v) => `$${fmt(v / 1000)}k`} baseline={0} />
          {changed && <path d={line(r.actual)} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />}
          <path d={line(r.spot)} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} strokeLinejoin="round" />
          {r.spot.map((v, k) => (
            <circle key={k} cx={xc(k)} cy={ry(v)} r={3.5} fill={GRAPHIC.green} />
          ))}
          <line x1={X0} x2={X1} y1={ry(r.hire)} y2={ry(r.hire)} stroke="#333" strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={X1} y={ry(r.hire) - 6} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: '#333' }}>
            hire {perDay(r.hire)}
          </text>
          <text className="ax" x={X0} y={196}>
            Northwind’s profit each month
          </text>
          <line className="base" x1={X0} x2={X1} y1={py(0)} y2={py(0)} />
          {[-pTop, pTop].map((v) => (
            <text key={v} className="ax ax-e" x={X0 - 6} y={py(v) + 4}>
              {v > 0 ? '+' : '−'}${fmt(Math.abs(v) / 1000)}k
            </text>
          ))}
          {r.monthly.map((v, k) => (
            <rect
              key={k}
              x={xc(k) - slot * 0.32}
              y={Math.min(py(0), py(v))}
              width={slot * 0.64}
              height={Math.abs(py(v) - py(0))}
              fill={v >= 0 ? GRAPHIC.green : GRAPHIC.red}
              opacity={0.8}
            />
          ))}
          {r.spot.map((_, k) => {
            const t = r.start + 1 + k;
            const show = months <= 12 || k % 3 === 0;
            return show ? (
              <text key={k} className="ax ax-m" x={xc(k)} y={298}>
                {MONTH_SHORT[t % 12]}
                {t % 12 === 0 ? ` Y${Math.floor(t / 12) + 1}` : ''}
              </text>
            ) : null;
          })}
        </svg>
        <Readouts
          items={[
            { label: 'hire, fixed for the period', value: perDay(r.hire), tone: 'green' },
            { label: 'spot, on average', value: perDay(r.avgSpot), tone: 'green' },
            { label: 'months spot beat the hire', value: `${above} of ${months}` },
            { label: 'Northwind’s profit', value: signedUsd(r.total), tone: r.total >= 0 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Charter agreed at the end of" tone="teal" value={Math.min(s.start, lastStart(months))} min={0} max={lastStart(months)} onChange={(v) => lab.set({ start: v })} display={monthLabel(Math.min(s.start, lastStart(months)))} />
        <Slider label="Length of the charter" tone="teal" value={months} min={6} max={24} onChange={(v) => lab.set({ months: v })} display={`${months} months`} />
        <Slider label="Hire against the forward strip" tone="green" value={s.margin} min={-10} max={10} onChange={(v) => lab.set({ margin: v })} display={`${s.margin > 0 ? '+' : s.margin < 0 ? '−' : ''}${Math.abs(s.margin)}%`} />
        <Slider label="Extra ships delivered" value={s.fleet} min={0} max={10} onChange={(v) => lab.set({ fleet: v })} display={`+${s.fleet}% of the fleet`} />
        <Slider label="Cargo against expectations" tone="orange" value={s.demand} min={-10} max={10} onChange={(v) => lab.set({ demand: v })} display={`${s.demand > 0 ? '+' : s.demand < 0 ? '−' : ''}${Math.abs(s.demand)}%`} />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={s.wait} min={0} max={5} step={0.5} onChange={(v) => lab.set({ wait: v })} display={`${fmt(s.wait, 1)} days a call`} />
        <Checkbox label="Panama Canal closed" checked={s.panama} onChange={(v) => lab.set({ panama: v })} />
        <Eq label={`Profit equals average spot minus hire, times earning days: ${perDay(r.avgSpot)} minus ${perDay(r.hire)} times ${fmt(earnDays)} days equals ${usd(r.total)}`}>
          <span>profit</span>
          <Op>=</Op>
          <span>(</span>
          <K tone="green">{perDay(r.avgSpot)}</K>
          <Op>−</Op>
          <K tone="green">{perDay(r.hire)}</K>
          <span>)</span>
          <Op>×</Op>
          <span>{fmt(earnDays)} days</span>
          <Op>=</Op>
          <K tone="green">{signedUsd(r.total)}</K>
        </Eq>
      </Figure>

      <P>
        At the start, Northwind charters in at the end of {monthLabel(START.start)} for a year. The Kamsarmax index is at {perDay(monthAverage(INDEX, START.start))}, and
        the forward strip offers a year’s hire at {perDay(BASE.hire)}: the curve expects the season’s swings and some drift back toward the long-run level. What
        actually comes is the boom of Year 3. Spot averages {perDay(BASE.avgSpot)}, and the charter makes {$m(BASE.total)}. The profit equation is as simple as an
        FFA’s: the average spot minus the hire, times the days she earns — {fmt(12 * EARN_DAYS_PER_MONTH)} in a year, once the {OFF_HIRE_DAYS} days a year she
        spends off hire are taken out, when neither hire nor earnings run.
      </P>
      <P>
        Now take away the luck. Push <b>extra ships delivered</b> to 5% — ships the market didn’t expect, say because yards delivered faster than the orderbook of{' '}
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> suggested. The same year’s spot now averages {perDay(BASE_FLEET5.avgSpot)}, and the charter loses{' '}
        {usd(-BASE_FLEET5.total)}. Five percent more ships don’t cut earnings by five percent: across the history they cut them by {pct(1 - AVG_FLEET5)} on average,
        because the market sits on the steep part of the supply curve, where a few more ships let everyone slow down (Lessons{' '}
        <a href={lessonHref('shipping/2.3')}>2.3</a> and <a href={lessonHref('shipping/4.1')}>4.1</a>). The other drivers work the same way from the other side. More
        cargo than expected, or longer hauls (<a href={lessonHref('shipping/3.5')}>Lesson 3.5</a>), a queue at Qingdao that takes ships out of service{' '}
        (<a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>), or a canal closure that lengthens voyages (<a href={lessonHref('shipping/3.3')}>Lesson 3.3</a>) all
        tighten the market and make the charter-in pay.
      </P>

      <Challenge
        id="a"
        question={`Suppose ${FLEET_SURPRISE}% more ships arrive than the market expected, whenever Northwind charters in. With every other driver at zero and the hire at the forward strip, find a start month for a 12-month charter-in that still makes at least ${$m(PROFIT_TARGET)}.`}
        solved={solved}
        status={
          s.months !== 12 || s.margin !== 0 || s.fleet !== FLEET_SURPRISE || s.demand !== 0 || s.wait !== 0 || s.panama
            ? `Set a 12-month charter at the forward strip, ${FLEET_SURPRISE}% extra ships, and every other driver to zero.`
            : `Chartered in at the end of ${monthLabel(r.start)}, she makes ${signedUsd(r.total)} with ${FLEET_SURPRISE}% more ships.`
        }
        success={`Solved. Only ${SOLUTIONS.length} start months survive the surprise: ${SOLUTIONS.map((t) => monthLabel(t)).join('; ')}. Each comes just before demand ran ahead of the fleet. At the end of ${monthLabel(FIRST)} the orderbook was only ${pct(BOOK_AT_FIRST)} of the fleet, so over the next year the fleet grew ${pct(FLEET_GROWTH_FIRST)} while the cargo grew ${pct(DEMAND_GROWTH_FIRST)}: the ships that could have spoiled the bet hadn’t been ordered.`}
      />

      <H2>Where the edge comes from</H2>
      <P>
        A charter-in made at the forward strip earns nothing on average if the strip is right. It pays only when the spot market beats what the market expected, so a
        chartering strategy needs a physical reason the market is wrong: an orderbook too small to answer a rise in demand, a trade shifting to longer hauls, a port
        or canal about to tighten. The challenge’s winners all sit where the orderbook was thin. That is the reasoning an operator has to be able to give before
        taking a ship in, and <FigRef to="Time Charter Arbitrage Lab">the first demonstration</FigRef> lets you check it: if the reason is real, switching the
        driver off should make the profit vanish.
      </P>
      <P>
        Two cautions. Our model’s forward curve is naive: it knows today’s rate and the season, and expects everything else to drift back toward a long-run level. It
        ignores the orderbook entirely. Real period rates are set by people who read the orderbook and the trade outlook, so the easy profits in this history would
        be harder to find. And a charter-in is leveraged. Northwind commits a year of hire without owning a ship, so a bad year is paid in cash, month after month,
        while the ship sails.
      </P>

      <H2>The owner’s side</H2>
      <P>
        For Northwind’s own Kestrel the question runs the other way: charter her out for a year, or keep trading her spot? In the next demonstration, each bar is what
        chartering her out for twelve months from that month would have earned, compared with trading spot — the mirror image of a charter-in. The line above is the
        Kamsarmax index. Change the world in the same ways and watch the bars move:
      </P>

      <Figure name="Time Charter Arbitrage Lab · when to charter out" scenario={out}>
        <Segmented label="What the market didn’t expect" value={driver} onChange={(v) => out.set({ driver: v })} options={(Object.keys(OUT_DRIVERS) as OutDriver[]).map((k) => ({ value: k, label: OUT_DRIVERS[k].label }))} />
        <svg
          className="chart"
          viewBox="0 0 640 274"
          role="img"
          aria-label={`Chartering Kestrel out for a year, against trading spot, for every start month (${OUT_DRIVERS[driver].label.replace(/^./, (c) => c.toLowerCase())}). It beats spot in ${pct(share(gains))} of start months; best from ${monthLabel(best)}, ${signedUsd(gains[best])}; worst from ${monthLabel(worst)}, ${signedUsd(gains[worst])}.`}
        >
          <text className="ax" x={OX0} y={14}>
            Kamsarmax index, $ per day
          </text>
          <GridY y={iy} ticks={iTicks} x0={OX0} x1={OX1} format={(v) => `$${fmt(v / 1000)}k`} baseline={0} />
          <path d={MONTHLY.map((v, t) => `${t ? 'L' : 'M'}${ox(t).toFixed(1)} ${iy(v).toFixed(1)}`).join(' ')} fill="none" stroke={GRAPHIC.green} strokeWidth={1.8} />
          <text className="ax" x={OX0} y={142}>
            Chartering out for a year instead of trading spot, by start month
          </text>
          <line className="base" x1={OX0} x2={OX1} y1={gy(0)} y2={gy(0)} />
          {[-gTop, gTop].map((v) => (
            <text key={v} className="ax ax-e" x={OX0 - 6} y={gy(v) + 4}>
              {v > 0 ? '+' : '−'}${fmt(Math.abs(v) / 1e6, 1)}m
            </text>
          ))}
          {gains.map((v, t) => (
            <rect key={t} x={ox(t) - oslot * 0.4} y={Math.min(gy(0), gy(v))} width={oslot * 0.8} height={Math.abs(gy(v) - gy(0))} fill={v >= 0 ? GRAPHIC.green : GRAPHIC.red} opacity={0.8} />
          ))}
          {Array.from({ length: 12 }, (_, y) => (
            <text key={y} className="ax ax-m" x={ox(y * 12 + 6)} y={268}>
              Y{y + 1}
            </text>
          ))}
        </svg>
        <Readouts
          items={[
            { label: 'start months where chartering out beat spot', value: pct(share(gains)), tone: 'green' },
            { label: 'average gain from chartering out', value: signedUsd(avgGain), tone: avgGain >= 0 ? 'green' : 'red' },
            { label: `best start: ${monthLabel(best)}`, value: signedUsd(gains[best]), tone: 'green' },
            { label: `worst start: ${monthLabel(worst)}`, value: signedUsd(gains[worst]), tone: 'red' },
          ]}
        />
        <Caption>
          Each charter’s hire is the forward strip on the day it is agreed; the bars compare it with what the index then paid over the twelve months.
        </Caption>
      </Figure>

      <P>
        As it happened, chartering out beat spot from {pct(share(OUT_ACTUAL))} of the start months. The best time to have done it was {monthLabel(BEST_OUT)}, which
        locked in {signedUsd(OUT_ACTUAL[BEST_OUT])} more than spot: the slump after the Year 5 deliveries, when the forward curve expected a recovery that the
        fleet’s overhang wouldn’t allow. The worst was {monthLabel(WORST_OUT)}, {signedUsd(OUT_ACTUAL[WORST_OUT])}, just before the boom of Year 12. Read the bars
        against the cycle of <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a> and the rule is the charter-in rule reversed: charter out when the coming year will
        disappoint, which is when ships ordered in the last boom are still arriving.
      </P>
      <P>
        Notice, too, what the period market pays relative to spot. A year’s hire agreed at the end of {monthLabel(BOOM_FIX)}, near the top, was{' '}
        {perDay(HIRE_BOOM)}, against {perDay(trailingSpot(BOOM_FIX))} for the previous twelve months’ spot; at the end of {monthLabel(SLUMP_FIX)}, deep in the slump,
        it was {perDay(HIRE_SLUMP)} against {perDay(trailingSpot(SLUMP_FIX))}. Period charters pay less than recent spot in a boom and more in a slump, because the
        curve expects both to pass. Switch to <b>5% more ships</b>: chartering out now beats spot from {pct(share(OUT_FLEET))} of the start months, because every year
        is weaker than the curve expected. An owner who knows the fleet will grow faster than the market thinks should charter out; one who sees the orderbook thin
        and the cargo growing should keep the ship on spot, or charter more in.
      </P>
      <P>
        So far every choice has been about time: when to commit, and for how long. The next lesson is about place. An empty ship in Qingdao can take a short cargo
        nearby or sail a month in ballast toward a richer one on the other side of the world, and in <a href={lessonHref('shipping/5.4')}>Lesson 5.4</a> we’ll price
        that choice, and the value of not choosing yet.
      </P>
    </LessonPage>
  );
}
