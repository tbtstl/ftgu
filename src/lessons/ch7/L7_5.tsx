import { useMemo } from 'react';
import {
  Challenge,
  DataTable,
  FUEL,
  Figure,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  Tn,
  fmt,
  lessonHref,
  mw,
  mwh,
  pct,
  usd,
  useScenario,
} from '../../framework';
import { generateFleet } from '../../engines/ops/der';
import { buildCohorts, clipToFeederLimit, scheduleFleet, type FleetConstraints } from '../../engines/strategy/fleet';
import { standardHistory } from '../../model/history';
import { rng } from '../../model/random';

const HOMES = 4000;
const FEEDERS = ['A', 'B', 'C', 'D'];
const STEP = 0.25;
const MAX_LIMIT = 6;

// The fleet: 4,000 homes on four Metro feeders, each with its own battery and starting charge.
const FLEET = generateFleet(HOMES, 7, FEEDERS.length);
const SOC = (() => {
  const r = rng(5);
  return FLEET.map(() => 0.2 + 0.7 * r());
})();
const COHORTS = buildCohorts(FLEET.map((h, i) => ({ feeder: `Feeder ${FEEDERS[h.substation]}`, kW: h.batteryKW, kWh: h.batteryKWh, soc0: SOC[i] })));
const NAMEPLATE = COHORTS.reduce((s, c) => s + c.powerMW, 0);
const ENERGY = COHORTS.reduce((s, c) => s + c.energyMWh, 0);
const FEEDER_MW = NAMEPLATE / FEEDERS.length;

const HISTORY = standardHistory();
const DAYS = [
  { value: '73', label: 'Day 74: four-hour spike' },
  { value: '3', label: 'Day 4: two-hour spike' },
  { value: '60', label: 'Day 61: no spike' },
];

const cache = new Map<string, ReturnType<typeof scheduleFleet>>();
function plan(day: number, k: FleetConstraints) {
  const key = JSON.stringify([day, k.reserve, k.availability, k.feederLimitMW ?? null]);
  let r = cache.get(key);
  if (!r) {
    r = scheduleFleet(HISTORY[day].daMetro, COHORTS, k);
    if (cache.size > 300) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/** Revenue with a feeder limit as a share of revenue without one, all else equal. */
function limitRatio(day: number, reserve: number, availability: number, limit: number) {
  const free = plan(day, { reserve, availability }).revenue;
  if (!(free > 0)) return 0;
  if (limit <= 0) return 0;
  return plan(day, { reserve, availability, feederLimitMW: limit }).revenue / free;
}

// Numbers quoted in the prose: day 74, 20% reserve, 90% availability, 2 MW feeder limit.
const REF = (() => {
  const d = 73;
  const r0 = plan(d, { reserve: 0, availability: 1 });
  const r1 = plan(d, { reserve: 0.2, availability: 1 });
  const r2 = plan(d, { reserve: 0.2, availability: 0.9 });
  const r3 = plan(d, { reserve: 0.2, availability: 0.9, feederLimitMW: 2 });
  const clip = clipToFeederLimit(HISTORY[d].daMetro, r2, 2);
  const calm = plan(60, { reserve: 0.2, availability: 0.9, feederLimitMW: 2 }).revenue;
  return { r0: r0.revenue, r1: r1.revenue, r2: r2.revenue, r3: r3.revenue, clip: clip.revenue, calm, peak: Math.max(...HISTORY[d].daMetro), low: Math.min(...HISTORY[d].daMetro) };
})();

export default function Lesson() {
  const s = useScenario('fleet', { day: '73', reserve: 0.2, availability: 0.9, limit: 2 });
  const day = Number(s.state.day);
  const { reserve, availability, limit } = s.state;
  const prices = HISTORY[day].daMetro;
  const limitOn = limit < MAX_LIMIT;

  const steps = useMemo(() => {
    const free = plan(day, { reserve: 0, availability: 1 });
    const withReserve = plan(day, { reserve, availability: 1 });
    const withAvail = plan(day, { reserve, availability });
    const withLimit = limitOn ? plan(day, { reserve, availability, feederLimitMW: limit }) : withAvail;
    const clipped = limitOn ? clipToFeederLimit(prices, withAvail, limit) : withAvail;
    return { free, withReserve, withAvail, withLimit, clipped };
  }, [day, reserve, availability, limit, limitOn, prices]);
  const final = steps.withLimit;
  const ratio = limitOn ? limitRatio(day, reserve, availability, limit) : 1;
  const ratioBelow = limitRatio(day, reserve, availability, Math.round((limit - STEP) * 100) / 100);
  const solved = limitOn && ratio >= 0.95 && ratioBelow < 0.95;

  const rows = [
    { step: 'Every battery, fully usable, no limits', rev: steps.free.revenue, cost: null as number | null },
    { step: `Hold ${pct(reserve)} of each battery for backup`, rev: steps.withReserve.revenue, cost: steps.free.revenue - steps.withReserve.revenue },
    { step: `Only ${pct(availability)} of homes reachable`, rev: steps.withAvail.revenue, cost: steps.withReserve.revenue - steps.withAvail.revenue },
    {
      step: limitOn ? `Feeder export limit of ${mw(limit, 2)}, re-optimized` : 'No feeder export limit',
      rev: final.revenue,
      cost: steps.withAvail.revenue - final.revenue,
    },
  ];

  const maxFeeder = Math.max(0, ...Object.values(final.byFeeder).flatMap((v) => v));

  return (
    <LessonPage id="7.5">
      <P>
        The <a href={lessonHref('7.4')}>last lesson</a> placed batteries on the map; this one schedules them. An aggregator in Metro has enrolled {fmt(HOMES)} homes with
        batteries, {mw(NAMEPLATE, 1)} and {mwh(ENERGY, 0)} in all, spread over four distribution feeders. Each morning it must decide, for the next day, when every
        battery charges and when it discharges, against Metro’s day-ahead prices from the course’s market history. In <a href={lessonHref('6.4')}>Lesson 6.4</a> we
        found the best schedule for one grid-scale battery against known prices. Now there are {fmt(HOMES)} of them.
      </P>
      <P>
        Optimizing each battery separately would work, but it would mean {fmt(HOMES * 24)} decisions every day for batteries that are, for the market’s purposes, nearly
        identical. Aggregators instead group them into <K>cohorts</K>: batteries on the same feeder, of similar size and with a similar starting charge, which all see the
        same prices and so want to do nearly the same thing. Here, four feeders × two battery sizes × two starting charges make {COHORTS.length} cohorts, and each is
        scheduled as one large battery — {fmt(COHORTS.length * 24)} decisions instead of {fmt(HOMES * 24)}. The platform then splits each cohort’s schedule among its members.
      </P>
      <P>
        Then come the constraints. Customers keep a <K c="energy">backup reserve</K> that the aggregator may not touch. Not every home is reachable on a given day. And each
        feeder can only export so much at once before its voltages or its transformer’s rating become a problem. How much a feeder can accept is its{' '}
        <K c="power">hosting capacity</K>, which many utilities now publish on maps. The table in the next demonstration adds the constraints one at a time, in this
        order, and shows what each one costs:
      </P>

      <Figure name="Fleet Scheduling Simulator" scenario={s}>
        <Segmented label="Day" value={s.state.day} onChange={(v) => s.set({ day: v })} options={DAYS} />
        <TimeChart
          ariaLabel={`Metro day-ahead prices on day ${day + 1}, from $${fmt(Math.min(...prices))} to $${fmt(Math.max(...prices))} per MWh.`}
          yLabel="Metro day-ahead price, $ per MWh"
          yMin={0}
          yFormat={(v) => '$' + v}
          height={150}
          series={[{ values: prices, color: '#6d9c37', kind: 'step', width: 3 }]}
        />
        <Legend
          items={[
            { label: 'Fleet schedule with every constraint (up: discharge)', color: FUEL.battery },
            { label: 'With no constraints', color: '#555', kind: 'line', dashed: true },
            ...(limitOn ? [{ label: 'Sum of the feeder limits', color: '#c4382f', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <TimeChart
          ariaLabel={`The fleet's schedule: ${mw(Math.max(...final.total), 1)} at most discharging, revenue ${usd(final.revenue)} for the day.`}
          yLabel="Fleet, MW"
          yFormat={(v) => String(v)}
          height={220}
          series={[
            { values: final.total, color: FUEL.battery, kind: 'bar' },
            { values: steps.free.total, color: '#555', kind: 'step', width: 1.5, dash: '5 4' },
          ]}
          refLines={limitOn ? [{ y: limit * FEEDERS.length, color: '#c4382f', label: 'feeder limits' }] : []}
        />
        <DataTable
          caption="Revenue as constraints are added"
          rows={rows}
          rowKey={(r) => r.step}
          rowClass={(r) => (r === rows[rows.length - 1] ? 'hl' : '')}
          columns={[
            { label: 'Constraint added', cell: (r) => r.step },
            { label: 'Revenue for the day', cell: (r) => usd(r.rev) },
            { label: 'What it costs', cell: (r) => (r.cost === null ? '—' : <Tn tone={r.cost > 0.5 ? 'red' : 'ink'}>{usd(r.cost)}</Tn>) },
          ]}
        />
        <Readouts
          items={[
            { label: 'fleet revenue for the day', value: usd(final.revenue), tone: 'green' },
            { label: 'kept of the unconstrained revenue', value: pct(steps.free.revenue > 0 ? final.revenue / steps.free.revenue : 0) },
            { label: 'busiest feeder’s export', value: mw(maxFeeder, 2) },
            ...(limitOn ? [{ label: 'if clipped without re-optimizing', value: usd(steps.clipped.revenue) }] : []),
          ]}
        />
        <Slider label="Backup reserve" tone="gold" value={reserve} min={0} max={0.8} step={0.05} onChange={(v) => s.set({ reserve: v })} display={pct(reserve)} />
        <Slider label="Homes reachable" value={availability} min={0.5} max={1} step={0.05} onChange={(v) => s.set({ availability: v })} display={pct(availability)} />
        <Slider
          label="Feeder export limit"
          tone="red"
          value={limit}
          min={STEP}
          max={MAX_LIMIT}
          step={STEP}
          onChange={(v) => s.set({ limit: v })}
          display={limitOn ? `${mw(limit, 2)} per feeder` : 'no limit'}
        />
      </Figure>

      <P>
        On day 74, Metro’s price sits at ${fmt(REF.low)} overnight and spikes to ${fmt(REF.peak)} for four evening hours. With no constraints, the fleet fills up overnight
        and empties into the spike, earning {usd(REF.r0)}. Holding back 20% of every battery for backup leaves {usd(REF.r1)}; losing a tenth of the homes, {usd(REF.r2)}.
        Both costs are close to proportional, because they simply shrink the battery.
      </P>
      <P>
        The feeder limit is different. Each feeder hosts about {mw(FEEDER_MW, 1)} of batteries, and with a 2 MW export limit the fleet can no longer put all its energy into
        the most expensive hours at once. Rather than throw the energy away, the optimizer spreads the discharge across all four spike hours at lower power, and revenue
        falls only to {usd(REF.r3)}. The naive alternative — schedule each cohort as if there were no limit, then clip whatever exceeds it — would earn just{' '}
        {usd(REF.clip)}, because the batteries would still pay to charge overnight and then be stopped from selling.
      </P>
      <P>
        How each cohort shares the feeder’s limit is itself a decision. Here the limit is divided among a feeder’s cohorts in proportion to their power, and each cohort is
        re-optimized with its share — a simple rule that can never break the limit, though not always the best possible split. A full optimization would schedule all the
        cohorts on a feeder together, as one linear program.
      </P>
      <P>
        Cohorts have a cost of their own. The batteries inside one don’t really pool their energy: a cohort scheduled to discharge for four hours may contain homes that
        run out after three, and the platform has to make up the difference from the others. Grouping by size and starting charge keeps those mismatches small, and the
        platform corrects what remains in real time from telemetry, as in <a href={lessonHref('7.3')}>Lesson 7.3</a>. More cohorts fit the fleet more closely and cost
        more computation; fewer are faster and coarser. That trade-off, not the optimization method, is what limits how finely a large fleet can be scheduled.
      </P>

      <Challenge
        id="a"
        question="Find the lowest feeder export limit, in steps of 0.25 MW, that keeps the fleet’s revenue within 5% of what it would earn with no feeder limit."
        solved={solved}
        status={
          limitOn
            ? `With ${mw(limit, 2)} per feeder, the fleet keeps ${pct(ratio, 1)} of its revenue without a limit; ${mw(Math.max(0, limit - STEP), 2)} would keep ${pct(ratioBelow, 1)}.`
            : 'Set a feeder export limit below the maximum.'
        }
        success={`Solved: ${mw(limit, 2)} per feeder keeps ${pct(ratio, 1)} of the revenue, well under each feeder’s ${mw(FEEDER_MW, 1)} of batteries. A limit only costs money in the few hours when every battery wants to export at once.`}
      />

      <H2>Where the money is</H2>
      <P>
        Now switch days. On day 4, the spike lasts two hours, and the same feeder limit bites much harder: there’s nowhere nearby to spread the discharge. On day 61,
        there is no spike at all — just the gap between night and day — and the fleet earns {usd(REF.calm)} with every constraint at its starting value, against{' '}
        {usd(REF.r3)} on day 74. That is the uncomfortable economics of energy arbitrage with home batteries: a large share of the revenue comes from a small number of
        high-priced hours, which are exactly when feeder limits, backup reserves and unreachable homes bind hardest. An aggregator that schedules well recovers much of
        that value. One that ignores the constraints, or clips them after the fact, loses a surprising amount of it.
      </P>
      <P>
        Every number in this lesson assumed the fleet could sell its energy at Metro’s nodal price. Whether it actually can — and whether it can also sell reserves or
        capacity — isn’t a question of physics or optimization. It depends on the market’s rules, which differ from one grid operator to the next and are changing as we
        write. That is the subject of the <a href={lessonHref('7.6')}>final lesson</a> of this chapter.
      </P>
    </LessonPage>
  );
}
