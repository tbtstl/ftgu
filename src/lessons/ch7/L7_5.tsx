import { useMemo } from 'react';
import {
  Challenge,
  DataTable,
  FUEL,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Segmented,
  Slider,
  Tn,
  fmt,
  lessonHref,
  mix,
  mw,
  mwh,
  pct,
  priceFill,
  usd,
  useScenario,
} from '../../framework';
import { generateFleet } from '../../engines/ops/der';
import { buildCohorts, clipToFeederLimit, scheduleFleet, type Cohort, type FleetConstraints, type FleetSchedule } from '../../engines/strategy/fleet';
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
export function limitRatio(day: number, reserve: number, availability: number, limit: number) {
  const free = plan(day, { reserve, availability }).revenue;
  if (!(free > 0)) return 0;
  if (limit <= 0) return 0;
  return plan(day, { reserve, availability, feederLimitMW: limit }).revenue / free;
}

/**
 * Challenge 7.5: a feeder limit that costs the fleet less than a tenth of its no-limit revenue on
 * day 74, with its four-hour spike, but more than a third on day 4, with its two-hour spike.
 */
export const LIMIT_CHALLENGE = { longDay: 73, shortDay: 3, longCost: 0.1, shortCost: 1 / 3 };
export function limitSolved(limit: number, reserve: number, availability: number): boolean {
  if (!(limit < MAX_LIMIT)) return false;
  const c = LIMIT_CHALLENGE;
  return 1 - limitRatio(c.longDay, reserve, availability, limit) < c.longCost && 1 - limitRatio(c.shortDay, reserve, availability, limit) > c.shortCost;
}

const CHARGE = GRAPHIC.blue;
const IDLE = '#efefec';
/** Short labels for a cohort's size and starting charge. */
function cohortLabel(c: Cohort) {
  const [, size, charge] = c.id.split('·');
  return `${size} · starts ${charge}`;
}

/**
 * Every cohort's schedule as a row of 24 hours, grouped by feeder, under a strip of the day's
 * prices; the bars at the bottom add them up for the whole fleet.
 */
function CohortGrid({
  prices,
  plan: final,
  free,
  availability,
  limit,
}: {
  prices: number[];
  plan: FleetSchedule;
  free: FleetSchedule;
  availability: number;
  limit: number | null;
}) {
  const LX = 196;
  const RX = 588;
  const cw = (RX - LX) / 24;
  const pitch = 11;
  const rowH = 9;
  const top = 26;
  const groupGap = 6;
  const byId = new Map(COHORTS.map((c) => [c.id, c]));
  const feeders = FEEDERS.map((f) => `Feeder ${f}`);
  const groupH = 4 * pitch;
  const rowsEnd = top + feeders.length * groupH + (feeders.length - 1) * groupGap;
  const fy0 = rowsEnd + 10;
  const fh = 70;
  const fmid = fy0 + fh / 2;
  const maxAbs = Math.max(1, ...free.total.map(Math.abs), ...final.total.map(Math.abs), limit !== null ? limit * FEEDERS.length : 0);
  const ys = (v: number) => fmid - (v / maxAbs) * (fh / 2);
  const height = fy0 + fh + 20;
  const freePath = free.total.map((v, h) => `${h ? 'L' : 'M'}${LX + h * cw} ${ys(v)} L${LX + (h + 1) * cw} ${ys(v)}`).join(' ');
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`The ${COHORTS.length} cohorts’ schedules, hour by hour, grouped by feeder, with the fleet’s total: at most ${mw(Math.max(...final.total), 1)} discharging, against ${mw(Math.max(...free.total), 1)} with no constraints.`}
    >
      <text className="ax ax-e" x={LX - 6} y={13}>
        Metro price, $ per MWh
      </text>
      {prices.map((p, h) => (
        <g key={h}>
          <rect x={LX + h * cw} y={2} width={cw - 0.5} height={16} fill={priceFill(p)} />
          {(h === 0 || Math.round(p) !== Math.round(prices[h - 1])) && (
            <text x={LX + h * cw + 2} y={14} style={{ fontSize: 10, fill: '#333' }}>
              {fmt(p)}
            </text>
          )}
        </g>
      ))}
      {feeders.map((f, g) => {
        const gy = top + g * (groupH + groupGap);
        const rows = final.cohorts.filter((c) => c.feeder === f);
        const peak = Math.max(0, ...(final.byFeeder[f] ?? []));
        return (
          <g key={f}>
            <text x={4} y={gy + 14} style={{ fontSize: 12.5, fontWeight: 600, fill: '#333' }}>
              {f}
            </text>
            <text className="ax" x={4} y={gy + 29} style={{ fontSize: 10.5 }}>
              peak {mw(peak, 2)}
            </text>
            {rows.map((c, i) => {
              const info = byId.get(c.id)!;
              const cap = Math.max(1e-6, info.powerMW * availability);
              const y = gy + i * pitch;
              return (
                <g key={c.id}>
                  <text className="ax ax-e" x={LX - 6} y={y + 8} style={{ fontSize: 10.5 }}>
                    {cohortLabel(info)}
                  </text>
                  {c.schedule.map((v, h) => (
                    <rect
                      key={h}
                      x={LX + h * cw}
                      y={y}
                      width={cw - 0.5}
                      height={rowH}
                      fill={v > 0.005 ? mix('#e3ecd8', FUEL.battery, 0.25 + 0.75 * Math.min(1, v / cap)) : v < -0.005 ? mix('#dbe8f4', CHARGE, 0.25 + 0.75 * Math.min(1, -v / cap)) : IDLE}
                    />
                  ))}
                  <text className="ax" x={RX + 5} y={y + 8} style={{ fontSize: 10 }}>
                    {fmt(info.homes)} homes
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <text x={4} y={fy0 + 14} style={{ fontSize: 12.5, fontWeight: 600, fill: '#333' }}>
        Whole fleet
      </text>
      {[maxAbs, 0, -maxAbs].map((v) => (
        <text key={v} className="ax ax-e" x={LX - 6} y={ys(v) + 4} style={{ fontSize: 10.5 }}>
          {v === 0 ? '0 MW' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`}
        </text>
      ))}
      <line x1={LX} x2={RX} y1={fmid} y2={fmid} stroke="#bbb" />
      {final.total.map((v, h) =>
        Math.abs(v) > 0.005 ? (
          <rect key={h} x={LX + h * cw + 1.5} y={Math.min(ys(v), fmid)} width={cw - 3} height={Math.abs(ys(v) - fmid)} fill={v > 0 ? FUEL.battery : CHARGE} />
        ) : null,
      )}
      <path d={freePath} fill="none" stroke="#555" strokeWidth={1.5} strokeDasharray="5 4" />
      {limit !== null && <line x1={LX} x2={RX} y1={ys(limit * FEEDERS.length)} y2={ys(limit * FEEDERS.length)} stroke="#c4382f" strokeWidth={1.5} strokeDasharray="6 4" />}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className={h === 24 ? 'ax ax-e' : 'ax ax-m'} x={LX + h * cw} y={height - 4}>
          {`${String(h).padStart(2, '0')}:00`}
        </text>
      ))}
    </svg>
  );
}

/**
 * What Lesson 7.1's 6 kW / 13.5 kWh home battery saves its owner each day under time-of-use rates
 * with a 5¢ export rate, $ (checked against the engine in tests/ch7.test.ts).
 */
const HOME_BATTERY_SAVING = 2.42;

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
  const limitCost = limitOn ? 1 - limitRatio(day, reserve, availability, limit) : 0;
  const solved = limitSolved(limit, reserve, availability);
  const dayLabel = (d: number) => `day ${d + 1}`;

  type Row = { step: string; rev: number; cost: number | null; share?: number; dim?: boolean };
  const rows: Row[] = [
    { step: 'Every battery, fully usable, no limits', rev: steps.free.revenue, cost: null },
    { step: `Hold ${pct(reserve)} of each battery for backup`, rev: steps.withReserve.revenue, cost: steps.free.revenue - steps.withReserve.revenue },
    { step: `Only ${pct(availability)} of homes reachable`, rev: steps.withAvail.revenue, cost: steps.withReserve.revenue - steps.withAvail.revenue },
    {
      step: limitOn ? `Feeder discharge limit of ${mw(limit, 2)}, re-optimized` : 'No feeder discharge limit',
      rev: final.revenue,
      cost: steps.withAvail.revenue - final.revenue,
      share: limitOn ? limitCost : undefined,
    },
    ...(limitOn
      ? [{ step: 'The same limit, clipped instead', rev: steps.clipped.revenue, cost: steps.withAvail.revenue - steps.clipped.revenue, dim: true }]
      : []),
  ];

  return (
    <LessonPage id="7.5">
      <P>
        The <a href={lessonHref('7.4')}>last lesson</a> placed batteries on the map; this one schedules them. An aggregator in Metro has enrolled {fmt(HOMES)} homes with
        batteries, {mw(NAMEPLATE, 1)} and {mwh(ENERGY, 0)} in all, spread over four distribution feeders. Each morning it must decide, for the next day, when every
        battery charges and when it discharges, against Metro’s day-ahead prices from the course’s market history. In <a href={lessonHref('6.4')}>Lesson 6.4</a> we
        found the best schedule for one grid-scale battery against known prices. Now there are {fmt(HOMES)} of them.
      </P>
      <P>
        To keep the scheduling clear, this lesson simplifies the homes. Unlike in <a href={lessonHref('7.1')}>Lesson 7.1</a> and{' '}
        <a href={lessonHref('7.2')}>Lesson 7.2</a>, these batteries have no household use or rooftop solar to look after: they charge from the grid and discharge to
        it, and nothing else.
      </P>
      <P>
        Optimizing each battery separately would be easy for a computer — {fmt(HOMES * 24)} hourly decisions a day is a small problem — but it isn’t how aggregators
        work. A single home is unpredictable: as <a href={lessonHref('7.2')}>Lesson 7.2</a> showed, whether one battery is reachable tomorrow, and how much it will
        hold, is close to a guess, while the total of a few hundred similar homes is steady enough to promise. Homes on the same feeder also share that feeder’s
        limits, so they have to be scheduled together anyway. Aggregators therefore group batteries into <K>cohorts</K>: batteries on the same feeder, of similar size
        and with a similar starting charge, which all see the same prices and so want to do nearly the same thing. Here, four feeders × two battery sizes (“standard,”
        up to 13.5 kWh, and “large”) × two starting charges (below or above half full) make {COHORTS.length} cohorts, and each is scheduled as one large battery. The
        platform then splits each cohort’s schedule among its members.
      </P>
      <P>
        Then come the constraints. Customers keep a <K c="energy">backup reserve</K> that the aggregator may not touch. Not every home is reachable on a given day. And
        a feeder can carry only so much power back toward its substation before its voltages rise too high or its transformer overloads. Utilities describe that room
        as the feeder’s <b>hosting capacity</b> — how much distributed generation it can accept without upgrades — and many now publish it on maps. Our model uses a
        simpler stand-in, a <K c="power">feeder discharge limit</K>: a cap on how much the batteries on each feeder may discharge at once.
      </P>
      <P>
        In the next demonstration, each row of the grid is one cohort, its 24 hours shaded by how hard it charges (blue) or discharges (green), under a strip of the
        day’s prices. The bars at the bottom add the cohorts up for the whole fleet, and the dashed line is what the fleet would do with no constraints at all. The
        table adds the constraints one at a time, in this order, and shows what each one costs:
      </P>

      <Figure name="Fleet Scheduling Simulator" scenario={s}>
        <Segmented label="Day" value={s.state.day} onChange={(v) => s.set({ day: v })} options={DAYS} />
        <CohortGrid prices={prices} plan={final} free={steps.free} availability={availability} limit={limitOn ? limit : null} />
        <Legend
          items={[
            { label: 'Discharging (darker: nearer full power)', color: FUEL.battery },
            { label: 'Charging', color: CHARGE },
            { label: 'Fleet with no constraints', color: '#555', kind: 'line', dashed: true },
            ...(limitOn ? [{ label: 'Sum of the feeder limits', color: '#c4382f', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <DataTable
          caption="Revenue as constraints are added"
          rows={rows}
          rowKey={(r) => r.step}
          rowClass={(r) => (r.dim ? 'dim' : r === rows[3] ? 'hl' : '')}
          columns={[
            { label: 'Constraint added', cell: (r) => r.step },
            { label: 'Revenue for the day', cell: (r) => usd(r.rev) },
            {
              label: 'What it costs',
              cell: (r) =>
                r.cost === null ? (
                  '—'
                ) : (
                  <Tn tone={r.cost > 0.5 && !r.dim ? 'red' : 'ink'}>
                    {usd(r.cost)}
                    {r.share !== undefined ? ` (${pct(r.share)})` : ''}
                  </Tn>
                ),
            },
          ]}
        />
        <Slider label="Backup reserve" tone="gold" value={reserve} min={0} max={0.8} step={0.05} onChange={(v) => s.set({ reserve: v })} display={pct(reserve)} />
        <Slider label="Homes reachable" value={availability} min={0.5} max={1} step={0.05} onChange={(v) => s.set({ availability: v })} display={pct(availability)} />
        <Slider
          label="Feeder discharge limit"
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
        The feeder limit is different. Each feeder hosts about {mw(FEEDER_MW, 1)} of batteries, and with a 2 MW discharge limit the fleet can no longer put all its energy into
        the most expensive hours at once. Rather than throw the energy away, the optimizer spreads the discharge across all four spike hours at lower power, and revenue
        falls only to {usd(REF.r3)}. Slide the limit to “no limit” and back to watch it happen: each cohort’s discharge squeezes into two or three dark hours, then
        spreads into four or five lighter ones. The naive alternative — schedule each cohort as if there were no limit, then clip whatever exceeds it — would earn
        just {usd(REF.clip)}, the table’s last row, because the batteries would still pay to charge overnight and then be stopped from selling.
      </P>
      <P>
        How each cohort shares the feeder’s limit is itself a decision. Here the limit is divided among a feeder’s cohorts in proportion to their power, and each cohort is
        re-optimized with its share — a simple rule that can never break the limit, though not always the best possible split. A full optimization would schedule all the
        cohorts on a feeder together, as one linear program.
      </P>
      <P>
        The grid also shows why cohorts work. The four feeders’ rows look almost alike, because their homes see the same prices; within each feeder, the cohorts that
        start the day low on charge spend longer charging overnight than those that start high. Cohorts have a cost of their own, though. The batteries inside one
        don’t really pool their energy: a cohort scheduled to discharge for four hours may contain homes that
        run out after three, and the platform has to make up the difference from the others. Grouping by size and starting charge keeps those mismatches small, and the
        platform corrects what remains in real time from telemetry, as in <a href={lessonHref('7.3')}>Lesson 7.3</a>. More cohorts would shrink those mismatches, but
        each cohort would then hold fewer homes, and its total would be harder to predict; fewer cohorts are steadier but coarser. Where to draw that line is a
        judgment about the fleet, not a limit of the optimizer.
      </P>

      <H2>Where the money is</H2>
      <P>
        Now switch days. Day 4’s spike is just as high as day 74’s, ${fmt(REF.peak)}, but it lasts only two hours, and day 61 has no spike at all. A feeder limit caps
        power, not energy, so what it costs depends on how long the high prices last.
      </P>

      <Challenge
        id="a"
        question={`Find a feeder discharge limit that costs the fleet less than ${pct(LIMIT_CHALLENGE.longCost)} of its no-limit revenue on day ${LIMIT_CHALLENGE.longDay + 1}, with its four-hour spike, but more than a third on day ${LIMIT_CHALLENGE.shortDay + 1}, with its two-hour one.`}
        solved={solved}
        status={
          limitOn
            ? `On ${dayLabel(day)}, a limit of ${mw(limit, 2)} per feeder costs the fleet ${pct(limitCost)} of what it would earn with no feeder limit.`
            : 'Set a feeder discharge limit below the maximum.'
        }
        success={`Solved: ${mw(limit, 2)} per feeder costs the fleet ${pct(1 - limitRatio(LIMIT_CHALLENGE.longDay, reserve, availability, limit))} of its revenue on day ${LIMIT_CHALLENGE.longDay + 1} but ${pct(1 - limitRatio(LIMIT_CHALLENGE.shortDay, reserve, availability, limit))} on day ${LIMIT_CHALLENGE.shortDay + 1}. Over a four-hour spike the batteries can deliver their energy at lower power; a two-hour spike leaves them no room to spread it.`}
      />

      <P>
        On day 61, there is no spike to spread into at all — just the gap between night and day — and the fleet earns {usd(REF.calm)} with every constraint at its starting value, against{' '}
        {usd(REF.r3)} on day 74. That is the uncomfortable economics of energy arbitrage with home batteries: a large share of the revenue comes from a small number of
        high-priced hours, which are exactly when feeder limits, backup reserves and unreachable homes bind hardest. An aggregator that schedules well recovers much of
        that value. One that ignores the constraints, or clips them after the fact, loses a surprising amount of it.
      </P>
      <P>
        Divide by the number of homes and the scale of the business becomes clear. Per home, the fleet earns about {usd(REF.r3 / HOMES, 2)} on day 74 and{' '}
        {usd(REF.calm / HOMES, 2)} on day 61. The single battery in <a href={lessonHref('7.1')}>Lesson 7.1</a>, under time-of-use rates and an export rate, saved its
        owner {usd(HOME_BATTERY_SAVING, 2)} a day simply by running the house. The comparison is rough — this lesson’s batteries have no house to run — but the gap is
        wide: even on a spike day, wholesale arbitrage pays less per battery than the battery is already worth to its owner at home. So a virtual power plant can’t
        simply buy its owners’ batteries away from their homes with energy revenue. It has to dispatch around the households’ own needs, earn most of its energy money
        on the few days that pay, and add other income — capacity and reserve payments, or utility programs — to pay owners enough to stay enrolled.
      </P>
      <P>
        Every number in this lesson assumed the fleet could sell its energy at Metro’s nodal price. Whether it actually can — and whether it can also sell reserves or
        capacity — isn’t a question of physics or optimization. It depends on the market’s rules, which differ from one grid operator to the next and are changing as we
        write. That is the subject of the <a href={lessonHref('7.6')}>final lesson</a> of this chapter.
      </P>
    </LessonPage>
  );
}
