import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Scenario } from '../../framework';
import {
  Button,
  Caption,
  Challenge,
  Figure,
  FUEL,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  fmt,
  hour,
  mix,
  mw,
  mwh,
  pct,
  tint,
  usd,
  useScenario,
} from '../../framework';
import {
  MIN_STABLE_SHARE,
  eveningRamp,
  scheduleCommitted,
  scheduleDay,
  weatherDay,
  hoursOn,
  type Commitment,
  type DayId,
  type Schedule,
} from '../../engines/ops/scheduler';
import { STANDARD_FLEET } from '../../model/fleet';

const plant = (id: string) => STANDARD_FLEET.find((g) => g.id === id)!;
const CC2_COLOR = mix(FUEL.gasCC, '#ffffff', 0.4);
const UNSERVED = '#c2185b';
const CURTAILED = tint(FUEL.solar, 0.4);

const LAYERS: Array<{ id: string; label: string; color: string }> = [
  { id: 'nuc', label: 'Harbor Point nuclear', color: FUEL.nuclear },
  { id: 'coal', label: 'Ironwood coal', color: FUEL.coal },
  { id: 'hydro', label: 'Falls hydro', color: FUEL.hydro },
  { id: 'cc1', label: 'Lakeside', color: FUEL.gasCC },
  { id: 'cc2', label: 'Mill Creek', color: CC2_COLOR },
  { id: 'ct', label: 'Eastgate', color: FUEL.gasCT },
  { id: 'oil', label: 'Old Quay', color: FUEL.oil },
];

/** Dispatchable plants from the bottom, then unserved demand, then the wind and solar used, then what was turned away. */
function stackOf(s: Schedule) {
  return [
    ...LAYERS.map((L) => ({ values: s.output[L.id], color: L.color })),
    { values: s.hours.map((h) => h.shortfall), color: UNSERVED },
    { values: s.output.wind, color: FUEL.wind },
    { values: s.output.solar, color: FUEL.solar },
    { values: s.hours.map((h) => h.curtailed), color: CURTAILED },
  ];
}

const LEGEND = [
  ...LAYERS.map((L) => ({ label: L.label, color: L.color })),
  { label: 'Ridge wind', color: FUEL.wind },
  { label: 'Valley solar', color: FUEL.solar },
  { label: 'Turned away', color: CURTAILED },
  { label: 'Unserved', color: UNSERVED },
  { label: 'Demand', color: '#333', kind: 'line' as const },
  { label: 'Net load', color: '#333', kind: 'line' as const, dashed: true },
];

const DAY_OPTIONS: Array<{ value: DayId; label: string }> = [
  { value: 'clear', label: 'Clear' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'calm', label: 'Calm, sunny' },
  { value: 'windy', label: 'Windy' },
];

const FLEET_RAMP = STANDARD_FLEET.filter((g) => !g.variable).reduce((s, g) => s + g.rampRate, 0);
const available = (s: Schedule) => s.windAvail.reduce((a, b) => a + b, 0) + s.solarAvail.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Figure 1: the whole fleet, every plant free to glide down to zero.

function SchedulerFigure() {
  const sc = useScenario('scheduler', { day: 'clear' as DayId, solar: 400, wind: 350 });
  const { day, solar, wind } = sc.state;
  const d = weatherDay(day);
  const s = scheduleDay(d, solar, wind);
  const minNet = Math.min(...s.net);
  const minAt = s.net.indexOf(minNet);
  const ramp = eveningRamp(s.net);
  const curt = s.curtailedMWh;
  const nucFloor = plant('nuc').minOutput;
  let msg: string;
  if (s.shortfallMWh > 0.5) msg = `The plants can’t keep up: ${mwh(s.shortfallMWh)} of demand goes unserved.`;
  else if (curt > 0.5) {
    const worst = s.hours.reduce((b, h, i) => (h.curtailed > s.hours[b].curtailed ? i : b), 0);
    msg = `Harbor Point can’t go below ${nucFloor} MW, so at ${hour(worst)} ${mw(s.hours[worst].curtailed)} of wind and solar has to be turned away.`;
  } else msg = `Net load ranges from ${mw(minNet)} at ${hour(minAt)} to ${mw(Math.max(...s.net))} at ${hour(s.net.indexOf(Math.max(...s.net)))}, and the dispatchable plants follow it.`;

  return (
    <Figure name="Generation Scheduler" scenario={sc}>
      <Segmented label="Weather day" value={day} onChange={(v) => sc.set({ day: v })} options={DAY_OPTIONS} />
      <TimeChart
        ariaLabel={`Dispatch on the ${d.label.toLowerCase()} with ${solar} MW of solar and ${wind} MW of wind. Lowest net load ${Math.round(minNet)} MW at ${hour(minAt)}; ${Math.round(curt)} MWh curtailed.`}
        stack={stackOf(s)}
        series={[
          { values: d.demand, color: '#333', width: 2.5 },
          { values: s.net, color: '#333', width: 2, dash: '6 5' },
        ]}
        yLabel="MW"
        yFormat={(v) => fmt(v)}
        height={280}
      />
      <Legend items={LEGEND} />
      <Readouts
        items={[
          { label: `lowest net load, at ${hour(minAt)}`, value: mw(minNet) },
          { label: `steepest evening climb, into ${hour(ramp.hour)}`, value: `${fmt(ramp.mw)} MW/h` },
          { label: 'wind and solar turned away', value: `${mwh(curt)} (${pct(curt / Math.max(1, available(s)))})` },
          { label: 'unserved demand', value: mwh(s.shortfallMWh), tone: s.shortfallMWh > 0.5 ? 'red' : undefined },
        ]}
      />
      <Slider label="Valley solar capacity" tone="gold" value={solar} min={0} max={2400} step={100} onChange={(v) => sc.set({ solar: v })} display={mw(solar)} />
      <Slider label="Ridge wind capacity" tone="teal" value={wind} min={0} max={1400} step={50} onChange={(v) => sc.set({ wind: v })} display={mw(wind)} />
      <Caption>{msg}</Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: committing the two combined-cycle plants by hand.

const COMMIT_DAY = weatherDay('calm');
const COMMIT_SOLAR = 1600;
const COMMIT_WIND = 350;
const DEFAULT_PLAN: Commitment = { cc1: hoursOn(6, 23), cc2: hoursOn(7, 22) };
const ALL_DAY: Commitment = { cc1: hoursOn(0, 24), cc2: hoursOn(0, 24) };
const CURTAIL_TARGET = 5100;
const ROWS = [
  { id: 'cc1' as const, name: plant('cc1').name, color: FUEL.gasCC, y: 26 },
  { id: 'cc2' as const, name: plant('cc2').name, color: CC2_COLOR, y: 78 },
];
const CX0 = 52;
const SLOT = (628 - 52) / 24;

function CommitGrid({ plan, onChange }: { plan: Commitment; onChange: (p: Commitment) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const paint = useRef<{ row: 'cc1' | 'cc2'; on: boolean } | null>(null);
  const cellAt = (e: PointerEvent<SVGSVGElement>) => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const h = Math.floor((p.x - CX0) / SLOT);
    const row = ROWS.find((r) => p.y >= r.y - 4 && p.y <= r.y + 30);
    return h >= 0 && h < 24 && row ? { row: row.id, h } : null;
  };
  const set = (row: 'cc1' | 'cc2', h: number, on: boolean) => {
    if (plan[row][h] === on) return;
    const next = [...plan[row]];
    next[h] = on;
    onChange({ ...plan, [row]: next });
  };
  const key = (row: 'cc1' | 'cc2', h: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      set(row, h, !plan[row][h]);
    }
  };
  return (
    <svg
      ref={svg}
      className="diagram"
      viewBox="0 0 640 116"
      role="group"
      aria-label="Commitment plan: the hours each combined-cycle plant is online. Press a cell to switch it."
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerDown={(e) => {
        const c = cellAt(e);
        if (!c) return;
        paint.current = { row: c.row, on: !plan[c.row][c.h] };
        set(c.row, c.h, paint.current.on);
      }}
      onPointerMove={(e) => {
        if (!paint.current || e.buttons === 0) return;
        const c = cellAt(e);
        if (c && c.row === paint.current.row) set(c.row, c.h, paint.current.on);
      }}
      onPointerUp={() => (paint.current = null)}
      onPointerLeave={() => (paint.current = null)}
    >
      {ROWS.map((r) => (
        <g key={r.id}>
          <text className="lab" x={CX0} y={r.y - 8}>
            {r.name} · online hours
          </text>
          {plan[r.id].map((on, h) => (
            <rect
              key={h}
              x={CX0 + h * SLOT + 1}
              y={r.y}
              width={SLOT - 2}
              height={24}
              rx={3}
              fill={on ? r.color : '#ececec'}
              stroke={on ? 'none' : '#cfcfcf'}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${r.name}, ${hour(h)}: ${on ? 'online' : 'offline'}`}
              onKeyDown={key(r.id, h)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </g>
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className="ax ax-m" x={CX0 + h * SLOT} y={114}>
          {hour(h)}
        </text>
      ))}
    </svg>
  );
}

function CommitFigure({ sc, s }: { sc: Scenario<Commitment>; s: Schedule }) {
  const plan: Commitment = { cc1: sc.state.cc1, cc2: sc.state.cc2 };
  const shortHours = s.hours.map((h, i) => (h.shortfall > 0.5 ? i : -1)).filter((i) => i >= 0);
  let msg: string;
  if (shortHours.length) {
    const h = shortHours[0];
    msg = `At ${hour(h)}, ${mw(s.hours[h].shortfall)} of demand goes unserved: the plants online can’t climb fast enough to meet the evening.`;
  } else msg = `Every hour is served. ${mwh(s.curtailedMWh)} of wind and solar — ${pct(s.curtailedMWh / available(s))} of what was available — is turned away.`;
  return (
    <Figure
      name="Generation Scheduler · committing plants"
      scenario={sc}
      actions={
        <>
          <Button onClick={() => sc.set({ cc1: ALL_DAY.cc1, cc2: ALL_DAY.cc2 })}>Online all day</Button>
        </>
      }
    >
      <TimeChart
        ariaLabel={`Dispatch on the calm, sunny day with ${COMMIT_SOLAR} MW of solar and the commitment plan below: ${Math.round(s.shortfallMWh)} MWh unserved, ${Math.round(s.curtailedMWh)} MWh curtailed.`}
        stack={stackOf(s)}
        series={[
          { values: COMMIT_DAY.demand, color: '#333', width: 2.5 },
          { values: s.net, color: '#333', width: 2, dash: '6 5' },
        ]}
        yLabel="MW"
        yFormat={(v) => fmt(v)}
        height={260}
      />
      <CommitGrid plan={plan} onChange={(p) => sc.set({ cc1: p.cc1, cc2: p.cc2 })} />
      <Legend items={LEGEND} />
      <Readouts
        items={[
          { label: 'unserved demand', value: mwh(s.shortfallMWh), tone: s.shortfallMWh > 0.5 ? 'red' : undefined },
          { label: 'wind and solar turned away', value: mwh(s.curtailedMWh) },
          { label: 'fuel cost of the day', value: usd(s.cost), tone: 'green' },
        ]}
      />
      <Caption>{msg}</Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

const REF = scheduleDay(weatherDay('clear'), 400, 350);
const REF_RAMP = eveningRamp(REF.net);
const FOUR_X = scheduleDay(weatherDay('clear'), 1600, 350);
const FOUR_X_RAMP = eveningRamp(FOUR_X.net);
const CALM_4X = scheduleDay(COMMIT_DAY, 1600, 350);
const CALM_4X_RAMP = eveningRamp(CALM_4X.net);
const CURTAIL_START = (() => {
  for (let s = 0; s <= 2400; s += 50) if (scheduleDay(weatherDay('clear'), s, 350).curtailedMWh > 0.5) return s;
  return 2400;
})();
const DEFAULT_COMMIT = scheduleCommitted(COMMIT_DAY, COMMIT_SOLAR, COMMIT_WIND, DEFAULT_PLAN);
const NET_PEAK = (id: DayId) => Math.max(...scheduleDay(weatherDay(id), 400, 350).net);

export default function Lesson() {
  const commitSc = useScenario<Commitment>('commit', { cc1: DEFAULT_PLAN.cc1, cc2: DEFAULT_PLAN.cc2 });
  const s = scheduleCommitted(COMMIT_DAY, COMMIT_SOLAR, COMMIT_WIND, commitSc.state);
  const solved = s.shortfallMWh < 0.5 && s.curtailedMWh <= CURTAIL_TARGET;

  return (
    <LessonPage id="3.3">
      <P>
        The balancing game handed you three gas plants that went wherever you pointed them. Plants like that are called <b>dispatchable</b>: their output can be scheduled in
        advance and changed on instruction, within the limits of their machinery. Ridge wind and Valley solar are a different kind of plant altogether. Their fuel is free and
        their output is whatever the weather allows; the most an operator can do is forecast it, or throw some of it away.
      </P>
      <P>
        Because wind and solar produce whenever they can, the sensible way to think about them is as demand running in reverse. What the dispatchable plants must cover is the{' '}
        <b>net load</b>: demand, minus whatever wind and solar happen to be producing. In the next demonstration, every plant in the region is scheduled hour by hour for the cheapest dispatch that
        respects each one’s ramp rate. Wind and solar sit on top of the stack, so the top of the dispatchable plants traces the net load, the dashed line. Try other days, and
        resize the region’s wind and solar plants:
      </P>

      <SchedulerFigure />

      <P>
        On the reference day the net load swings from {mw(Math.min(...REF.net))} in the small hours to {mw(Math.max(...REF.net))} at 19:00, and the dispatchable plants follow it
        easily: the steepest climb, into {hour(REF_RAMP.hour)}, is {fmt(REF_RAMP.mw)} MW an hour, while together the fleet can ramp by {fmt(FLEET_RAMP)} MW an hour.
      </P>
      <P>
        The weather matters as much as the size of the plants. With today’s wind and solar, the evening’s highest net load is {mw(NET_PEAK('clear'))} on the clear day,{' '}
        {mw(NET_PEAK('cloudy'))} on the cloudy day, when the wind is weak as well, and only {mw(NET_PEAK('windy'))} on the windy one. The dispatchable fleet has to be ready
        for the worst of them every day, because a week ahead nobody knows which day is coming.
      </P>
      <P>
        Not every plant can follow, though. Harbor Point nuclear runs best at a steady output: in our model it can’t go below {plant('nuc').minOutput} MW or change by more than{' '}
        {plant('nuc').rampRate} MW an hour. Some nuclear plants, notably in France, do follow demand, but most run flat out: their fuel is cheap and nearly all of their costs
        are fixed, so there’s little to save by turning down. Raise the solar capacity and, past about {fmt(CURTAIL_START)} MW, the midday net load drops below what the
        inflexible plants must produce anyway. The only way to keep the grid balanced is to turn some of the wind and solar away — <b>curtailment</b>. It costs nothing in fuel,
        but it throws away energy the region paid to be able to produce. In a market, these are the hours when prices can fall below zero, a story for Lesson 5.5.
      </P>

      <H2>The duck</H2>
      <P>
        Keep raising the solar capacity and watch the dashed line. The midday dip deepens into a belly, while the evening hours, after the sun has set, barely move. In 2013
        California’s grid operator drew this shape for the years ahead and called it the <b>duck curve</b>, and the name stuck. With four times today’s solar, the reference
        day’s net load goes negative at midday — {mw(Math.min(...FOUR_X.net))} at {hour(FOUR_X.net.indexOf(Math.min(...FOUR_X.net)))}, more wind and solar than the region can
        use — and the steepest evening climb grows to {fmt(FOUR_X_RAMP.mw)} MW an hour. On the calm, sunny day it reaches {fmt(CALM_4X_RAMP.mw)} MW an hour, as the sun drops
        and nothing replaces it.
      </P>
      <P>
        Solar does nothing for the hour that matters most. Demand peaks at 19:00, when the panels produce nothing, so however much solar the region builds, the evening still
        needs dispatchable plants — or wind, which on this region’s typical day blows harder after dark. That’s the essential difference between the two kinds of plant: a{' '}
        <K tone="orange">dispatchable</K> plant’s capacity is there when you call on it, while an intermittent plant’s capacity is there when the weather says so.
      </P>

      <H2>Committing plants</H2>
      <P>
        This scheduler lets every thermal plant glide down to zero and back up like a dimmer switch. Real ones can’t. A combined-cycle plant that’s running has a{' '}
        <b>minimum stable output</b> — we’ll assume {pct(MIN_STABLE_SHARE)} of capacity, a typical figure — and to go lower it has to shut down. Shutting down and restarting
        takes hours and costs money, so a large part of scheduling is deciding, well ahead of time, which plants will be online in each hour. Operators call this{' '}
        <b>unit commitment</b>, and every day they solve it as a large optimization problem covering every plant for the day ahead. Here you’ll solve a small piece of it by
        hand.
      </P>
      <P>
        Here is the calm, sunny day with {fmt(COMMIT_SOLAR)} MW of solar, four times today’s. Ironwood coal stays online all day, never below its {plant('coal').minOutput} MW
        minimum; the Eastgate and Old Quay peakers can start within the hour. You decide when Lakeside and Mill Creek are online — press or drag across the cells. A plant
        brought online starts at its minimum and can climb no faster than its ramp rate:
      </P>

      <CommitFigure sc={commitSc} s={s} />

      <P>
        With both plants online through the middle of the day, nothing goes unserved, but they hold {fmt(MIN_STABLE_SHARE * (plant('cc1').capacity + plant('cc2').capacity))}{' '}
        MW of output the grid doesn’t need, and {mwh(DEFAULT_COMMIT.curtailedMWh)} of wind and solar is turned away to make room for them. Taking them offline at midday frees
        that room. The catch is the evening: a plant has to be online, and already climbing, before the sun goes down.
      </P>

      <Challenge
        id="a"
        question={`Plan Lakeside and Mill Creek so the calm, sunny day is served with no unserved demand at all, while turning away no more than ${mwh(CURTAIL_TARGET)} of wind and solar.`}
        solved={solved}
        status={
          s.shortfallMWh > 0.5 ? `Right now ${mwh(s.shortfallMWh)} of demand goes unserved.` : `Every hour is served, but ${mwh(s.curtailedMWh)} of wind and solar is turned away.`
        }
        success="Solved. Taking the plants offline once the morning climb is over makes room for the solar, but they have to be back online, at their minimum and ready to climb, by late afternoon: the evening outruns a plant that starts any later."
      />

      <P>
        Real operators make this decision a day ahead, against a forecast of the weather rather than the weather itself, and they keep plants online to cover the chance that the
        forecast is wrong. The duck’s steep neck is why grids with a lot of solar are so interested in anything that can move energy from the middle of the day to the evening.
        The most obvious candidate is a battery, and it’s the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
