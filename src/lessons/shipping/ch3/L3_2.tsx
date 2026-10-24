import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { expectedWait, simulateQueue, utilization } from '../../../engines/shipping/queue';
import { fleetRequirement } from '../../../engines/shipping/market';
import { MARKET_CLASSES, type ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

/** A Capesize cargo, tonnes. */
export const CARGO = 170_000;
/** Days to berth, start, finish and unberth, on top of discharging. */
export const BERTHING_DAYS = 0.5;
/** Days the replay runs. */
export const DAYS = 120;
const SEED = 11;
/** Coefficient of variation of service times for each setting. */
export const CV = { steady: 0.25, variable: 1 } as const;
type Variability = keyof typeof CV;

/** Days a ship occupies a berth: discharge time plus berthing. */
export function serviceDays(ratePerDay: number): number {
  return CARGO / ratePerDay + BERTHING_DAYS;
}

export const CHALLENGE = { arrivals: 2.6, rate: 100_000, maxWait: 0.5 };

/**
 * The challenge: with 2.6 arrivals a day and berths discharging 100,000 t a day, the fewest berths
 * whose long-run average wait is under half a day (8 with variable service, 7 with steady).
 */
export function fewestBerthsSolved(berths: number, rate: number, arrivals: number, cv: number): boolean {
  if (Math.abs(arrivals - CHALLENGE.arrivals) > 1e-6 || Math.abs(rate - CHALLENGE.rate) > 1e-6 || berths < 2) return false;
  const s = serviceDays(rate);
  return expectedWait(berths, arrivals, s, cv) < CHALLENGE.maxWait && expectedWait(berths - 1, arrivals, s, cv) >= CHALLENGE.maxWait;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes.

const DEF = { berths: 4, rate: 100_000, arrivals: 1.5, variability: 'variable' as Variability };
const S100 = serviceDays(100_000);
const DEF_UTIL = utilization(DEF.berths, DEF.arrivals, S100);
const DEF_WAIT = expectedWait(DEF.berths, DEF.arrivals, S100, CV.variable);
const DEF_SIM = simulateQueue({ berths: DEF.berths, arrivalsPerDay: DEF.arrivals, serviceDays: S100, serviceCv: CV.variable, days: DAYS, seed: SEED });
const HOT = 1.7;
const HOT_UTIL = utilization(4, HOT, S100);
const HOT_WAIT = expectedWait(4, HOT, S100, CV.variable);
/** Long-run wait with four berths at a given utilization. */
const waitAtUtil = (u: number, cv: number) => expectedWait(4, (u * 4) / S100, S100, cv);
const POOL_SHARED = waitAtUtil(0.8, CV.variable);
const POOL_SEPARATE = expectedWait(1, (0.8 * 4) / S100 / 4, S100, CV.variable);

// Demonstration 2: ships tied up by waiting at Qingdao.
const WAITS = Array.from({ length: 21 }, (_, i) => i / 2);
const LOST = (Object.keys(MARKET_CLASSES) as ClassId[]).reduce(
  (acc, id) => {
    const base = fleetRequirement(id);
    const curve = WAITS.map((w) => fleetRequirement(id, { congestion: { QIN: w } }).ships);
    const calls = base.routes.filter((r) => r.route.to === 'QIN' || r.route.from === 'QIN').reduce((s, r) => s + r.voyages, 0);
    const perDay = curve[2] - curve[0];
    acc[id] = { base: base.ships, curve, calls, perDay, crossover: (MARKET_CLASSES[id].fleet - base.ships) / perDay };
    return acc;
  },
  {} as Record<ClassId, { base: number; curve: number[]; calls: number; perDay: number; crossover: number }>,
);
const CAPE4 = LOST.cape.curve[8] - LOST.cape.base;

const days = (x: number, d = 1) => (Number.isFinite(x) ? `${fmt(x, d)} days` : 'no limit');
const ships = (x: number) => `${fmt(x)} ships`;

const ANCHOR_COLOR = GRAPHIC.orange;

/** The anchorage and the terminal at one moment of the replay. */
function Terminal({ t, run, berths, service }: { t: number; run: ReturnType<typeof simulateQueue>; berths: number; service: number }) {
  const waiting = run.ships.filter((s) => s.arrive <= t && s.start > t);
  const atBerth = run.ships.filter((s) => s.start <= t && s.end > t);
  const COLS = 10;
  const SHOW = 50;
  const BX = 352;
  const rowH = Math.min(22, 152 / Math.max(1, berths));
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 196"
      role="img"
      aria-label={`Day ${Math.floor(t)} of the replay: ${waiting.length} ships waiting at anchor and ${atBerth.length} of ${berths} berths busy.`}
    >
      <rect x={14} y={24} width={300} height={162} rx={6} fill={tint(GRAPHIC.blue, 0.12)} />
      <text className="ax" x={20} y={16}>
        Anchorage · {waiting.length} waiting
      </text>
      {waiting.slice(0, SHOW).map((s, i) => {
        const cx = 34 + (i % COLS) * 28;
        const cy = 46 + Math.floor(i / COLS) * 28;
        return <path key={s.arrive} d={`M${cx - 8} ${cy + 4} L${cx + 9} ${cy} L${cx - 8} ${cy - 4} Z`} fill={ANCHOR_COLOR} stroke={TEXT.orange} strokeWidth={1} />;
      })}
      {waiting.length > SHOW && (
        <text x={300} y={180} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.orange }}>
          +{waiting.length - SHOW} more
        </text>
      )}
      <text className="ax" x={BX} y={16}>
        Terminal · {atBerth.length} of {berths} berths busy
      </text>
      <rect x={BX + 230} y={24} width={40} height={162} fill="#e2ded6" />
      <text className="ax ax-m" x={BX + 250} y={182}>
        quay
      </text>
      {Array.from({ length: berths }, (_, b) => {
        const y = 30 + b * rowH;
        const ship = atBerth.find((s) => s.berth === b);
        const left = ship ? Math.max(0, Math.min(1, (ship.end - t) / Math.max(0.01, ship.end - ship.start))) : 0;
        const h = Math.max(6, rowH - 8);
        return (
          <g key={b}>
            <text className="ax" x={BX} y={y + h / 2 + 4}>
              {b + 1}
            </text>
            <line x1={BX + 14} x2={BX + 228} y1={y + h + 2} y2={y + h + 2} stroke="#d5d0c6" />
            {ship && (
              <g>
                <path d={`M${BX + 120} ${y} L${BX + 220} ${y} L${BX + 228} ${y + h / 2} L${BX + 220} ${y + h} L${BX + 120} ${y + h} Z`} fill="#ffffff" stroke={TEXT.orange} strokeWidth={1.2} />
                <rect x={BX + 122} y={y + 2} width={96 * left} height={h - 4} fill={ANCHOR_COLOR} opacity={0.8} />
              </g>
            )}
          </g>
        );
      })}
      <text className="ax" x={BX + 14} y={190}>
        Day {Math.floor(t)} · each ship {fmt(service, 1)} days at the berth
      </text>
    </svg>
  );
}

export default function Lesson() {
  const lab = useScenario('port', DEF);
  const { berths, rate, arrivals, variability } = lab.state;
  const cv = CV[variability];
  const service = serviceDays(rate);
  const util = utilization(berths, arrivals, service);
  const longRun = expectedWait(berths, arrivals, service, cv);
  const run = useMemo(() => simulateQueue({ berths, arrivalsPerDay: arrivals, serviceDays: service, serviceCv: cv, days: DAYS, seed: SEED }), [berths, arrivals, service, cv]);
  const solved = fewestBerthsSolved(berths, rate, arrivals, cv);

  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => (x + dt * 6) % DAYS), play.playing);

  const qDays = useMemo(() => run.queue.map((_, d) => d), [run]);
  const curve = useMemo(() => {
    const us = Array.from({ length: 95 }, (_, i) => 0.03 + i * 0.01);
    return { us, ws: us.map((u) => Math.min(12, expectedWait(berths, (u * berths) / service, service, cv))) };
  }, [berths, service, cv]);

  const lost = useScenario('lost-capacity', { cls: 'cape' as ClassId, wait: 4 });
  const L = LOST[lost.state.cls];
  const wi = Math.round(lost.state.wait * 2);
  const need = L.curve[wi];
  const fleet = MARKET_CLASSES[lost.state.cls].fleet;
  const extra = need - L.base;
  const clsName = MARKET_CLASSES[lost.state.cls].name;

  return (
    <LessonPage id="shipping/3.2">
      <P>
        <a href={lessonHref('shipping/3.1')}>The previous lesson</a> laid out the sea lanes and measured them in days of steaming. But no voyage is all steaming. At each
        end a ship must find a berth, and in <a href={lessonHref('shipping/2.2')}>Lesson 2.2</a> we saw how long loading takes once she has one, and how a charter
        party’s laytime clock decides who pays for the waiting. This lesson is about the waiting itself.
      </P>
      <P>
        A port is a set of berths, each able to work one ship at a time. Ships don’t arrive on a timetable: a bulk carrier’s arrival depends on where she was open,
        the weather on her passage and a dozen delays at her last port, so they turn up at random — three on one day, none for two days after. What happens when
        they arrive faster than the berths can clear them? How do berths, handling speed and arrivals turn into <K tone="teal">waiting time</K>?
      </P>
      <P>
        Take an iron-ore discharge terminal serving Capesizes, each carrying {fmt(CARGO)} tonnes; the terminal and its numbers are illustrative. A berth
        discharges at a steady rate, and berthing, starting up and sailing take another half a day, so a ship ties up a berth for the cargo divided by the rate,
        plus half a day. How busy the berths are on average is their <b>utilization</b>: arrivals per day times the days each ship needs, divided by the number of
        berths. In the next demonstration, ships arrive at random and wait at anchor, first come, first served, until a berth is free. The replay runs through {DAYS}{' '}
        days of one random draw. Set the berths, the discharge rate, the arrivals and how much handling times vary:
      </P>

      <Figure name="Port Congestion Lab" scenario={lab} play={play}>
        <Terminal t={t} run={run} berths={berths} service={service} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', columnGap: 16 }}>
          <XYChart
            ariaLabel={`Ships at anchor each day of the ${DAYS}-day replay: at most ${run.maxQueue}, ${fmt(run.avgQueue, 1)} on average.`}
            series={[{ xs: qDays, ys: run.queue, color: GRAPHIC.orange, width: 2, step: true, fillTo: 0, fillOpacity: 0.15 }]}
            xMin={0}
            xMax={DAYS}
            yMin={0}
            yMax={Math.max(5, Math.ceil(run.maxQueue / 5) * 5)}
            xTicks={[0, 30, 60, 90, 120]}
            xFormat={(v) => `${v}`}
            yFormat={(v) => fmt(v)}
            xLabel="Day"
            yLabel="Ships at anchor"
            cursor={t}
            width={320}
            height={170}
            left={40}
          />
          <XYChart
            ariaLabel={`Long-run average wait against berth utilization for ${berths} berths. At ${pct(util)} utilization the wait is ${days(longRun)}.`}
            series={[{ xs: curve.us.map((u) => u * 100), ys: curve.ws, color: GRAPHIC.teal, width: 2 }]}
            xMin={0}
            xMax={100}
            yMin={0}
            yMax={12}
            yTicks={[0, 4, 8, 12]}
            xTicks={[0, 25, 50, 75, 100]}
            xFormat={(v) => `${v}%`}
            yFormat={(v) => fmt(v)}
            xLabel="Berth utilization"
            yLabel="Average wait, days"
            markers={util < 0.98 ? [{ x: util * 100, y: Math.min(12, longRun), color: TEXT.teal }] : []}
            refLines={util >= 0.98 ? [{ y: 12, color: TEXT.red, label: 'the queue never clears' }] : []}
            width={320}
            height={170}
            left={40}
          />
        </div>
        <Segmented
          label="Handling times"
          value={variability}
          onChange={(v) => lab.set({ variability: v })}
          options={[
            { value: 'steady', label: 'Steady handling' },
            { value: 'variable', label: 'Variable handling' },
          ]}
        />
        <Readouts
          items={[
            { label: 'berth utilization', value: util >= 1 ? `${pct(util)} — over capacity` : pct(util), tone: util >= 1 ? 'red' : undefined },
            { label: 'average wait, long run', value: days(longRun), tone: 'teal' },
            { label: `average wait, this ${DAYS}-day run`, value: days(run.avgWait), tone: 'teal' },
            { label: 'most ships at anchor', value: fmt(run.maxQueue), tone: 'orange' },
          ]}
        />
        <Slider label="Berths" value={berths} min={1} max={8} onChange={(v) => lab.set({ berths: v })} display={fmt(berths)} />
        <Slider label="Discharge rate per berth" tone="orange" value={rate} min={60_000} max={200_000} step={10_000} onChange={(v) => lab.set({ rate: v })} display={`${fmt(rate)} t/day`} />
        <Slider label="Arrivals" tone="teal" value={arrivals} min={0.5} max={5} step={0.1} onChange={(v) => lab.set({ arrivals: v })} display={`${fmt(arrivals, 1)} ships a day`} />
        <Caption>
          {util >= 1
            ? `Ships arrive faster than the berths can clear them: ${fmt(arrivals * service, 1)} berths’ worth of work a day for ${berths} berths. The queue grows for as long as that lasts.`
            : `Each ship needs ${fmt(service, 1)} days at a berth, so ${fmt(arrivals, 1)} arrivals a day keep ${fmt(arrivals * service, 1)} berths busy on average — and still ships wait.`}
        </Caption>
      </Figure>

      <P>
        At the starting settings, four berths discharging {fmt(100_000)} tonnes a day hold each ship for {fmt(S100, 1)} days, and {fmt(DEF.arrivals, 1)} arrivals
        a day keep them {pct(DEF_UTIL, 1)} busy. On average there is spare capacity: {fmt(DEF.berths * (1 - DEF_UTIL), 1)} of the four berths stand empty. Yet
        ships wait — {days(DEF_SIM.avgWait)} on average in this run, with as many as {DEF_SIM.maxQueue} at anchor at once, and {days(DEF_WAIT)} in the long run. The trouble is that spare capacity can’t be saved up. A berth idle on a
        quiet Tuesday is no help when four ships turn up on Wednesday, and each bunch of arrivals leaves a queue that takes days to work off.
      </P>
      <P>
        Now raise the arrivals to {fmt(HOT, 1)} a day, only a little more traffic. Utilization rises to {pct(HOT_UTIL, 1)} and the long-run average wait to{' '}
        {days(HOT_WAIT)}. Push past one hundred percent and the queue never clears at all: it grows by the excess every day for as long as the excess lasts.
      </P>

      <H2>Why queues explode</H2>
      <P>
        The right-hand chart is the long-run average wait at each level of utilization, from a formula worked out a century ago by Agner Krarup Erlang, a Danish
        engineer who studied queues of calls at telephone exchanges. With four berths and variable handling, ships wait {days(waitAtUtil(0.5, CV.variable), 2)} at 50%
        utilization, {days(waitAtUtil(0.8, CV.variable))} at 80%, {days(waitAtUtil(0.9, CV.variable))} at 90% and {days(waitAtUtil(0.95, CV.variable))} at 95%.
        The last few percent of a port’s capacity are the most expensive to use, which is why ports run with what looks like slack. The replay wanders around the
        formula — {DAYS} days is one draw of luck — but its long runs agree with it.
      </P>
      <P>
        Two things lower the curve. The first is steadier handling. When every ship takes about the same time, the only randomness left is in the arrivals, and
        the wait falls to a little more than half: at 80% utilization, {days(waitAtUtil(0.8, CV.steady))} instead of {days(waitAtUtil(0.8, CV.variable))}. Switch
        between the two settings and watch the curve drop. The second is pooling. Four berths sharing one queue at 80% utilization keep ships waiting{' '}
        {days(POOL_SHARED)}; four separate one-berth terminals, each taking a quarter of the ships at the same utilization, keep them waiting {days(POOL_SEPARATE)},
        because a ship stuck behind a slow neighbor can’t use the berth next door. Big ports with many berths are better at absorbing bad luck than small ones.
      </P>

      <Challenge
        id="a"
        figure="Port Congestion Lab"
        question={`Traffic grows to ${fmt(CHALLENGE.arrivals, 1)} ships a day, and each berth discharges ${fmt(CHALLENGE.rate)} tonnes a day. What is the fewest berths that keeps the long-run average wait under half a day?`}
        solved={solved}
        status={
          Math.abs(arrivals - CHALLENGE.arrivals) > 1e-6 || Math.abs(rate - CHALLENGE.rate) > 1e-6
            ? `Set the arrivals to ${fmt(CHALLENGE.arrivals, 1)} a day and the discharge rate to ${fmt(CHALLENGE.rate)} t/day first.`
            : `With ${berths} berth${berths === 1 ? '' : 's'}, the long-run average wait is ${days(longRun, 2)}.`
        }
        success={`Solved. ${fmt(CHALLENGE.arrivals, 1)} ships a day at ${fmt(serviceDays(CHALLENGE.rate), 1)} days each is ${fmt(CHALLENGE.arrivals * serviceDays(CHALLENGE.rate), 2)} berths’ worth of work, so six berths would be ${pct(utilization(6, CHALLENGE.arrivals, serviceDays(CHALLENGE.rate)))} busy and ships would wait ${days(expectedWait(6, CHALLENGE.arrivals, serviceDays(CHALLENGE.rate), cv), 1)}. ${variability === 'variable' ? `With variable handling it takes eight; with steady handling, seven would do (${days(expectedWait(7, CHALLENGE.arrivals, serviceDays(CHALLENGE.rate), CV.steady), 2)}). Smoother handling is worth a whole berth.` : `With steady handling seven berths do it; with variable handling it would take eight, because seven leave ships waiting ${days(expectedWait(7, CHALLENGE.arrivals, serviceDays(CHALLENGE.rate), CV.variable), 2)}. Smoother handling is worth a whole berth.`}`}
      />

      <H2>Waiting ships carry nothing</H2>
      <P>
        A queue at a port isn’t only the port’s problem. A ship at anchor is a ship out of the market: she can’t carry anything until she has discharged, and her
        next cargo waits for some other ship. When congestion is bad, the effect is visible from far away. In 2021, as imports surged, dozens of container ships at a
        time lay at anchor off Los Angeles and Long Beach waiting for berths.
      </P>
      <P>
        In the next demonstration, ships discharging at Qingdao, the main importing port in our world, wait extra days at anchor on every call. The chart counts
        the ships needed to carry all of the course’s trades for the class, at fixed speeds of 12 knots laden and 13 in ballast, against the days of waiting; the
        dashed line is the class’s whole fleet. Set the waiting time:
      </P>

      <Figure name="Port Congestion Lab · lost capacity" scenario={lost}>
        <Segmented
          label="Ship class"
          value={lost.state.cls}
          onChange={(v) => lost.set({ cls: v })}
          options={[
            { value: 'cape', label: 'Capesizes' },
            { value: 'kmax', label: 'Kamsarmaxes' },
          ]}
        />
        <Legend
          items={[
            { label: 'Ships needed to carry the trades', color: GRAPHIC.orange, kind: 'line' },
            { label: `The ${clsName} fleet, ${fmt(fleet)} ships`, color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`${clsName}s needed to carry the trades against waiting days at Qingdao: ${ships(L.base)} with no waiting, ${ships(need)} with ${fmt(lost.state.wait, 1)} days. The fleet has ${fmt(fleet)}.`}
          series={[{ xs: WAITS, ys: L.curve, color: GRAPHIC.orange, width: 2.5 }]}
          xMin={0}
          xMax={10}
          yMin={Math.floor((L.base * 0.9) / 50) * 50}
          yMax={Math.ceil((Math.max(...L.curve, fleet) * 1.03) / 50) * 50}
          xTicks={[0, 2, 4, 6, 8, 10]}
          xFormat={(v) => `${v}`}
          yFormat={(v) => fmt(v)}
          xLabel="Extra days waiting per call at Qingdao"
          yLabel="Ships"
          refLines={[{ y: fleet, color: '#777' }]}
          markers={[{ x: lost.state.wait, y: need, color: TEXT.orange, label: ships(need), anchor: lost.state.wait > 7 ? 'end' : 'start', labelDy: -10 }]}
          height={210}
        />
        <Readouts
          items={[
            { label: 'calls at Qingdao a year', value: fmt(L.calls) },
            { label: 'ships tied up waiting', value: ships(extra), tone: 'orange' },
            { label: 'share of the whole fleet', value: pct(extra / fleet, 1), tone: 'orange' },
          ]}
        />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={lost.state.wait} min={0} max={10} step={0.5} onChange={(v) => lost.set({ wait: v })} display={days(lost.state.wait)} />
        <Caption>
          {need > fleet
            ? `At these speeds the trades now need more ${clsName}s than exist: the fleet would have to sail faster to carry everything.`
            : `${fmt(lost.state.wait, 1)} days of waiting on each of ${fmt(L.calls)} calls is ${fmt(lost.state.wait * L.calls)} ship-days a year: ${ships(extra)} doing nothing but wait.`}
        </Caption>
      </Figure>

      <P>
        The arithmetic is simple and unforgiving. Capesizes call at Qingdao {fmt(LOST.cape.calls)} times a year in our world, so every extra day of waiting there
        ties up {fmt(LOST.cape.perDay, 1)} Capesizes for the whole year. Four days of congestion takes {ships(CAPE4)} out of service, {pct(CAPE4 / MARKET_CLASSES.cape.fleet, 1)}{' '}
        of the fleet — as if a small shipping company had vanished. Past about {fmt(LOST.cape.crossover, 1)} days, the trades need more Capesizes than the{' '}
        {fmt(MARKET_CLASSES.cape.fleet)} that exist, at these speeds. The Kamsarmaxes are hit less hard, because fewer of their cargoes go to Qingdao:{' '}
        {fmt(LOST.kmax.perDay, 1)} ships for every day of waiting.
      </P>
      <P>
        Nothing about the ships changed, and no cargo was added. A queue at one port, half a world away from most of the fleet, has made ships scarce everywhere,
        because every ship is a candidate for every cargo. What that scarcity does to the price of transport — and why congestion is one of the first things a
        freight trader checks — is the subject of <a href={lessonHref('shipping/4.1')}>Chapter 4</a>. Try the Kamsarmax setting in{' '}
        <FigRef to="Port Congestion Lab · lost capacity">this demonstration</FigRef> to see how the same delay weighs on a class with a different pattern of trades.
      </P>
      <P>
        A port can at least add berths over the years. Some bottlenecks can’t be widened at all: the canals and straits that whole trades are funneled through.{' '}
        <a href={lessonHref('shipping/3.3')}>The next lesson</a> closes them, one at a time, and measures the way round.
      </P>
    </LessonPage>
  );
}
