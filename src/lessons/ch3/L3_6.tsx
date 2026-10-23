import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  Controls,
  DataTable,
  Eq,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  LessonPage,
  NetworkView,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Tn,
  fmt,
  hour,
  linePath,
  mw,
  scale,
  signed,
  usePlay,
  useScenario,
  useSimulation,
} from '../../framework';
import {
  CR_FIXED,
  CR_SCENARIO,
  CR_UNITS,
  INTERCONNECTION_BETA,
  crForecast,
  initialControlRoom,
  lineName,
  scheduleSetpoints,
  stepControlRoom,
  type CRState,
} from '../../engines/ops/controlRoom';
import { estimateState } from '../../engines/ops/stateEstimation';
import { REGION, REGION_LOAD_SHARE } from '../../model/networks';
import { SOLAR_CF, WIND_CF } from '../../model/profiles';
import { STANDARD_FLEET } from '../../model/fleet';

const SC = CR_SCENARIO;
const nodeName = (id: string) => REGION.nodes.find((n) => n.id === id)!.name;
const clock = (t: number) => hour(t / 60);
const UNIT_TONE: Record<string, 'orange' | 'red' | 'blue' | 'gray'> = { coal: 'gray', cc1: 'orange', cc2: 'orange', ct: 'red', oil: 'red', hydro: 'blue' };

/** Where each node's generator annotation goes in the 600 × 400 drawing. */
const GEN_LABEL: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  north: { dx: 0, dy: -62, anchor: 'middle' },
  east: { dx: 0, dy: -62, anchor: 'middle' },
  center: { dx: 34, dy: -4, anchor: 'start' },
  harbor: { dx: -34, dy: 48, anchor: 'start' },
  west: { dx: -34, dy: 5, anchor: 'end' },
  city: { dx: 0, dy: 52, anchor: 'middle' },
};
const SHORT: Record<string, string> = { coal: 'Ironwood', cc1: 'Lakeside', cc2: 'Mill Creek', ct: 'Eastgate', oil: 'Old Quay', hydro: 'Falls hydro' };

function genText(s: CRState, node: string): string {
  const parts: string[] = [];
  if (CR_FIXED.node === node) parts.push(`Harbor Point ${CR_FIXED.mw}`);
  for (const u of CR_UNITS) if (u.node === node) parts.push(`${SHORT[u.id]} ${s.trippedUnits.includes(u.id) ? 'tripped' : fmt(s.out[u.id])}`);
  if (node === 'north') parts.push(`Ridge ${fmt(s.wind)}`);
  if (node === 'east') parts.push(`Valley ${fmt(s.solar)}`);
  return parts.join(' · ');
}

function Grid({ s }: { s: CRState }) {
  const imports = -s.ace;
  return (
    <NetworkView
      width={600}
      height={420}
      ariaLabel={`The region at ${clock(s.t)}. ${s.alarms.filter((a) => a.level === 'alarm').length} alarms. Highest line loading ${Math.round(
        Math.max(...REGION.lines.map((l) => (Math.abs(s.flows[l.id]) / l.limit) * 100)),
      )} percent.`}
      nodes={REGION.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y + 10,
        r: 26,
        label: n.name,
        labelPos: n.id === 'city' ? 'right' : n.id === 'west' ? 'below' : 'above',
        value: fmt(REGION_LOAD_SHARE[n.id] * s.demand),
        sub: 'MW load',
        fill: '#fff',
      }))}
      lines={REGION.lines.map((l) => {
        const out = s.linesOut.includes(l.id);
        const u = Math.abs(s.flows[l.id]) / l.limit;
        return { id: l.id, from: l.from, to: l.to, flow: s.flows[l.id], limit: l.limit, out, label: out ? 'out' : `${Math.round(u * 100)}%` };
      })}
    >
      {REGION.nodes.map((n) => {
        const g = GEN_LABEL[n.id];
        const text = genText(s, n.id);
        return text ? (
          <text key={n.id} className="ax" x={n.x + g.dx} y={n.y + 10 + g.dy} textAnchor={g.anchor} style={{ paintOrder: 'stroke', stroke: '#f8f8f8', strokeWidth: 4 }}>
            {text}
          </text>
        ) : null;
      })}
      <text className="lab" x={16} y={130}>
        Ties to the neighbors
      </text>
      <text className="ax" x={16} y={147}>
        {Math.abs(imports) < 1 ? 'balanced' : imports > 0 ? `importing ${fmt(imports)} MW` : `exporting ${fmt(-imports)} MW`}
      </text>
    </NetworkView>
  );
}

const TX = scale(SC.start, SC.end, 52, 628);
const YD = scale(1100, 1600, 118, 22);
const YA = scale(-300, 150, 212, 142);
const FORECAST = (() => {
  const ts = Array.from({ length: 73 }, (_, k) => SC.start + k * 5);
  return linePath(ts.map(TX), ts.map((t) => YD(crForecast(t))));
})();

function Trends({ s }: { s: CRState }) {
  const h = s.hist;
  const xs = h.map((p) => TX(p.t));
  return (
    <svg className="chart" viewBox="0 0 640 236" role="img" aria-label={`Demand against the day-ahead forecast, and the area control error. Now ${fmt(s.demand)} MW against a forecast of ${fmt(s.forecast)} MW; ACE ${fmt(s.ace)} MW.`}>
      <text className="ax" x={52} y={12}>
        Demand and forecast, MW
      </text>
      <GridY y={YD} ticks={[1100, 1300, 1500]} x0={52} x1={628} format={(v) => fmt(v)} />
      {SC.events.map((e, i) => (
        <g key={i}>
          <line x1={TX(e.at)} x2={TX(e.at)} y1={22} y2={212} stroke="#bbb" strokeDasharray="2 3" />
          <text className="ax" x={TX(e.at) + 3} y={30} style={{ fontSize: 10.5 }}>
            {e.kind === 'unitTrip' ? 'unit trip' : e.kind === 'lineTrip' ? 'line trip' : 'forecast miss'}
          </text>
        </g>
      ))}
      <path d={FORECAST} fill="none" stroke="#777" strokeWidth={1.5} strokeDasharray="5 5" />
      {h.length > 1 && <path d={linePath(xs, h.map((p) => YD(Math.min(1600, p.demand))))} fill="none" stroke="#333" strokeWidth={2.5} />}
      <text className="ax" x={52} y={136}>
        Area control error, MW
      </text>
      <GridY y={YA} ticks={[-SC.aceLimit, 0]} x0={52} x1={628} format={(v) => signed(v)} baseline={0} />
      {h.length > 1 && <path d={linePath(xs, h.map((p) => YA(Math.max(-300, Math.min(150, p.ace)))))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2} />}
      <line className="cur" x1={TX(s.t)} x2={TX(s.t)} y1={22} y2={212} />
      {[15, 16, 17, 18, 19, 20, 21].map((hh) => (
        <text key={hh} className="ax ax-m" x={TX(hh * 60)} y={230}>
          {hour(hh)}
        </text>
      ))}
    </svg>
  );
}

function AlarmList({ s }: { s: CRState }) {
  const items = [...s.alarms].sort((a, b) => (a.level === b.level ? 0 : a.level === 'alarm' ? -1 : 1));
  return (
    <div className="card" role="log" aria-live="polite" aria-label="Alarms" style={{ minHeight: 120, padding: '10px 14px', fontSize: 14.5, lineHeight: 1.45 }}>
      <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 4 }}>Alarms</div>
      {items.length === 0 && <div style={{ color: '#6b6b6b' }}>None.</div>}
      {items.slice(0, 6).map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span aria-hidden="true" style={{ flex: 'none', width: 9, height: 9, borderRadius: 5, background: a.level === 'alarm' ? '#c4382f' : '#d0702a', transform: 'translateY(-1px)' }} />
          <span style={{ color: a.level === 'alarm' ? '#c4382f' : '#444' }}>
            <span className="sr-only">{a.level === 'alarm' ? 'Alarm: ' : 'Warning: '}</span>
            {a.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ContingencyTable({ s }: { s: CRState }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', margin: '4px 0 0' }}>
        Contingency analysis (N-1)
      </div>
      <DataTable
        caption="The worst single line outages"
        rows={s.contingency.slice(0, 3)}
        rowKey={(r) => r.out}
        columns={[
          { label: 'If this line trips', cell: (r) => lineName(r.out) },
          { label: 'worst line after', cell: (r) => lineName(r.worst) },
          {
            label: 'loading',
            cell: (r) => <span style={{ color: r.loading > 1.0005 ? '#c4382f' : r.loading >= 0.9 ? '#ad5310' : undefined, fontWeight: r.loading > 1 ? 600 : undefined }}>{Math.round(r.loading * 100)}%</span>,
          },
        ]}
      />
    </div>
  );
}

export interface RoomResult {
  shedMWh: number;
  sustained: string[];
}

function ControlRoom({ onFinish }: { onFinish: (r: RoomResult) => void }) {
  const play = usePlay(false);
  const [sp, setSp] = useState<Record<string, number>>(() => scheduleSetpoints(SC.start));
  const [agc, setAgc] = useState(true);
  const [s, setS] = useSimulation<CRState>(() => initialControlRoom(), (x, dt) => stepControlRoom(x, sp, agc, dt * SC.minutesPerSecond), play.playing);
  const reported = useRef(false);
  useEffect(() => {
    if (s.done && play.playing) play.setPlaying(false);
    if (s.done && !reported.current) {
      reported.current = true;
      onFinish({ shedMWh: s.shedMWh, sustained: s.sustainedOverloads });
    }
  }, [s, play, onFinish]);
  const restart = (start: boolean) => {
    setS(initialControlRoom());
    setSp(scheduleSetpoints(SC.start));
    setAgc(true);
    reported.current = false;
    play.setPlaying(start);
  };
  const toggle = () => {
    if (s.done) restart(true);
    else play.toggle();
  };
  const reserveOk = s.reserve >= s.reserveNeed;
  const log = [...s.log].reverse().slice(0, 3);
  let msg: string;
  if (s.done) {
    msg =
      s.shedMWh > 0.5 || s.sustainedOverloads.length
        ? `End of the shift. ${s.shedMWh > 0.5 ? `${fmt(s.shedMWh)} MWh of customers’ demand went unserved.` : ''} ${s.sustainedOverloads.length ? `Sustained overload on ${s.sustainedOverloads.map(lineName).join(' and ')}.` : ''}`
        : 'End of the shift: no load shed and no sustained overload. Well operated.';
  } else if (s.t === SC.start) msg = 'Press play to start the shift at 15:00. Time runs at two minutes per second.';
  else msg = `${clock(s.t)}. ${log[0]?.text ?? ''}`;

  return (
    <Figure
      name="Control Room Simulator"
      play={{ playing: play.playing, toggle }}
      actions={
        <>
          <Button onClick={() => setSp(scheduleSetpoints(s.t, s.trippedUnits))}>Apply day-ahead schedule</Button>
          <Button onClick={() => restart(false)}>Restart</Button>
        </>
      }
    >
      <Readouts
        items={[
          { label: 'time', value: clock(s.t) },
          { label: 'frequency', value: `${s.f.toFixed(3)} Hz`, tone: 'teal' },
          { label: 'area control error', value: `${signed(s.ace)} MW`, tone: s.ace < -SC.aceLimit ? 'red' : 'blue' },
          { label: `reserve, needs ${fmt(s.reserveNeed)}`, value: mw(s.reserve), tone: reserveOk ? undefined : 'orange' },
        ]}
      />
      <Grid s={s} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 16, alignItems: 'start', marginTop: 4 }}>
        <AlarmList s={s} />
        <ContingencyTable s={s} />
      </div>
      <Trends s={s} />
      <Controls columns={2}>
        {CR_UNITS.map((u) => {
          const tripped = s.trippedUnits.includes(u.id);
          return (
            <Slider
              key={u.id}
              label={`${u.name} (${nodeName(u.node)})${u.agc > 0 ? ' · AGC' : ''}`}
              tone={UNIT_TONE[u.id]}
              value={sp[u.id]}
              min={0}
              max={u.capacity}
              step={5}
              disabled={tripped}
              onChange={(v) => setSp((x) => ({ ...x, [u.id]: v }))}
              display={tripped ? 'tripped' : `${fmt(sp[u.id])} MW · now ${fmt(s.out[u.id])}`}
            />
          );
        })}
      </Controls>
      <div className="ctl">
        <Checkbox label="AGC on Lakeside and Falls hydro" checked={agc} onChange={setAgc} />
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#555', padding: '6px 0 0' }} aria-label="Event log">
        {log.map((e, i) => (
          <div key={e.t + '-' + i}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#6b6b6b', marginRight: 8 }}>{clock(e.t)}</span>
            {e.text}
          </div>
        ))}
      </div>
      <Caption>{msg}</Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: state estimation on a snapshot of the region at 19:00.

const SNAP_T = 19 * 60;
const SNAP = (() => {
  const plantNode = (id: string) => STANDARD_FLEET.find((g) => g.id === id)!.node!;
  const sp = scheduleSetpoints(SNAP_T);
  const demand = crForecast(SNAP_T);
  const x = SNAP_T / 60 - 0.5;
  const i = Math.floor(x);
  const cf = (a: number[]) => a[i] + (a[i + 1] - a[i]) * (x - i);
  const inj: Record<string, number> = Object.fromEntries(REGION.nodes.map((n) => [n.id, -REGION_LOAD_SHARE[n.id] * demand]));
  inj[CR_FIXED.node] += CR_FIXED.mw;
  inj[plantNode('wind')] += 350 * cf(WIND_CF);
  inj[plantNode('solar')] += 400 * cf(SOLAR_CF);
  for (const u of CR_UNITS) inj[u.node] += sp[u.id];
  inj.north -= Object.values(inj).reduce((a, b) => a + b, 0);
  return inj;
})();
const METERS: Array<{ value: string; label: string }> = [
  { value: 'f:center-city', label: 'Central–Metro flow' },
  { value: 'f:west-city', label: 'West–Metro flow' },
  { value: 'p:city', label: 'Metro injection' },
];

function EstimatorFigure() {
  const sc = useScenario('estimator', { meter: 'f:center-city', error: 120, detect: false });
  const { meter, error, detect } = sc.state;
  const est = useMemo(() => estimateState(REGION, SNAP, { gross: { meter, mw: error }, detect }), [meter, error, detect]);
  const bad = est.rows.find((r) => r.meter.id === meter)!;
  const worst = est.rows.reduce((b, r) => (r.used && Math.abs(r.normalized) > Math.abs(b.normalized) ? r : b), est.rows[0]);
  const flagged = est.rows.filter((r) => r.used && Math.abs(r.normalized) > 3);
  const badLine = meter.startsWith('f:') ? meter.slice(2) : null;
  return (
    <Figure name="Control Room Simulator · state estimation" scenario={sc}>
      <Segmented label="Which meter is faulty" value={meter} onChange={(v) => sc.set({ meter: v })} options={METERS} />
      <NetworkView
        width={600}
        height={400}
        ariaLabel={`Estimated flows from ${est.rows.length} meters, one of them ${error} MW off. Largest error in an estimated flow ${Math.round(est.worstFlowError)} MW.`}
        nodes={REGION.nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          r: 24,
          label: n.name,
          labelPos: n.id === 'city' ? 'right' : n.id === 'west' ? 'below' : 'above',
          fill: meter === 'p:' + n.id && Math.abs(error) > 0 ? '#fde3df' : '#fff',
        }))}
        lines={REGION.lines.map((l) => {
          const row = est.rows.find((r) => r.meter.id === 'f:' + l.id)!;
          return {
            id: l.id,
            from: l.from,
            to: l.to,
            flow: est.flows[l.id],
            limit: l.limit,
            label: l.id === badLine ? `meter ${fmt(Math.abs(row.reading))} · est. ${fmt(Math.abs(row.estimate))}` : `${fmt(Math.abs(est.flows[l.id]))} MW`,
          };
        })}
      />
      <DataTable
        caption="Meter readings, estimates and normalized residuals"
        rows={est.rows}
        rowKey={(r) => r.meter.id}
        rowClass={(r) => (!r.used ? 'dim' : Math.abs(r.normalized) > 3 ? 'hl' : '')}
        columns={[
          { label: 'Meter', cell: (r) => r.meter.label },
          { label: 'Reading, MW', cell: (r) => fmt(r.reading) },
          { label: 'Estimate, MW', cell: (r) => fmt(r.estimate) },
          {
            label: 'Residual, σ',
            cell: (r) =>
              r.used ? (
                <span style={{ color: Math.abs(r.normalized) > 3 ? '#c4382f' : undefined, fontWeight: Math.abs(r.normalized) > 3 ? 600 : undefined }}>{signed(r.normalized, 1)}</span>
              ) : (
                'rejected'
              ),
          },
        ]}
      />
      <Readouts
        items={[
          { label: 'largest error in an estimated flow', value: mw(est.worstFlowError) },
          { label: 'meters flagged', value: flagged.length ? String(flagged.length) : 'none' },
          { label: 'meters rejected', value: est.rejected.length ? String(est.rejected.length) : 'none' },
        ]}
      />
      <Slider label={`Error on the ${METERS.find((m) => m.value === meter)!.label.toLowerCase()} meter`} tone="red" value={error} min={-200} max={200} step={10} onChange={(v) => sc.set({ error: v })} display={`${signed(error)} MW`} />
      <div className="ctl">
        <Checkbox label="Bad-data detection" checked={detect} onChange={(v) => sc.set({ detect: v })} />
      </div>
      <Caption>
        {est.rejected.length
          ? `The estimator rejected the ${est.rows.find((r) => r.meter.id === est.rejected[0])!.meter.label.toLowerCase()} meter and rebuilt the picture from the others: it now reads ${fmt(bad.estimate)} MW, within ${fmt(Math.abs(bad.estimate - bad.truth), 1)} MW of the truth.`
          : Math.abs(worst.normalized) > 3
            ? `The ${worst.meter.label.toLowerCase()} meter disagrees with the rest by ${fmt(Math.abs(worst.normalized), 1)} standard deviations — far more than noise can explain.`
            : 'Every reading agrees with the others to within its noise.'}
      </Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const [best, setBest] = useState<RoomResult | null>(null);
  const [last, setLast] = useState<RoomResult | null>(null);
  const onFinish = useMemo(
    () => (r: RoomResult) => {
      setLast(r);
      if (r.shedMWh < 0.5 && r.sustained.length === 0) setBest(r);
    },
    [],
  );
  const solved = best !== null;
  const ev = SC.events;
  const tripAt = ev.find((e) => e.kind === 'unitTrip')!.at;
  const lineAt = ev.find((e) => e.kind === 'lineTrip')!.at;
  const missAt = ev.find((e) => e.kind === 'forecastMiss')!.at;
  const lostHz = 250 / INTERCONNECTION_BETA;

  return (
    <LessonPage id="3.6">
      <P>
        Every lesson in this chapter has handed you one lever at a time: a few setpoints, a commitment plan, a battery’s schedule. A grid operator has all of them at once,
        along with a picture of the whole system that updates every few seconds and a set of rules for what the system must be able to survive. In this lesson we take a shift
        in the control room.
      </P>
      <P>
        The picture comes from <b>SCADA</b> — supervisory control and data acquisition — the network of sensors, remote terminals and communication links that report flows,
        voltages and breaker positions from every substation, typically every few seconds, and carry the operator’s commands back out. Behind the screens sits the{' '}
        <b>energy management system</b>, or EMS: the software that turns those raw measurements into a consistent model of the grid, runs the AGC from Lesson 3.1, and
        repeatedly asks what would happen if something broke.
      </P>
      <P>
        Our region is now one <b>balancing area</b> inside the interconnection of Lesson 3.2. Its job is to keep its own generation matched to its own demand, so that it
        neither leans on its neighbors nor pushes power onto them. The measure of how well it’s doing is the <K tone="blue">area control error</K>:
      </P>
      <Eq label="Area control error">
        <Tn tone="blue">ACE</Tn>
        <Op>=</Op>
        <span>(actual − scheduled interchange)</span>
        <Op>−</Op>
        <span>10B × Δf</span>
      </Eq>
      <P>
        The first term is how much more power is flowing out over the ties than planned; here the region plans to neither import nor export. The second removes the part of that
        flow that is just the region’s governors helping the rest of the interconnection, through a bias B set close to the region’s own frequency response. What remains is the
        region’s own imbalance. A negative ACE means the region is short and its neighbors are covering for it. AGC drives ACE back toward zero, and so must you.
      </P>

      <H2>Your shift</H2>
      <P>
        The shift runs from 15:00 to 21:00, two simulated minutes to every second. Your units start on the day-ahead schedule, made from yesterday’s forecast; AGC rides on top
        of your setpoints on Lakeside and Falls hydro. Harbor Point runs flat out, and the wind and solar plants follow the weather. The network view shows each line’s loading,
        with the same colors as before; the alarm list shows what’s wrong now, and the contingency table what would be wrong if a single line tripped. The day-ahead button
        moves every setpoint back to the plan for the current time — useful for the evening climb, but the plan knows nothing about what happens during your shift:
      </P>

      <ControlRoom onFinish={onFinish} />

      <P>
        Three things go wrong. From {clock(missAt)}, demand starts running ahead of the forecast, because the evening turns out hotter than predicted, and by early evening it’s 5
        percent above plan. Without new setpoints, AGC soaks up the difference until its two units run out of room, and then ACE starts to sink. In our simulator, if the region
        leans on its neighbors by more than {SC.aceLimit} MW for more than {SC.aceMinutes} minutes, the reliability coordinator — the organization that oversees several
        balancing areas — orders it to shed load.
      </P>
      <P>
        At {clock(lineAt)}, lightning takes out line Harbor–Central. Nobody steers the power around the gap; it redistributes itself instantly across the lines that remain,
        following their impedances, and a good part of it lands on West–Metro. A line’s rating is mostly about how hot its conductors get, and heating takes time, so lines can
        carry more than their normal rating for a while. In our simulator a
        line may stay above 100 percent for up to {SC.overloadAllowance} minutes. After that it’s a sustained overload. The relief has to come from re-dispatch: moving
        generation from the plants that push power onto the overloaded line to plants that don’t. Ironwood coal, at West, feeds West–Metro most directly; Mill Creek and Old
        Quay, inside Metro, relieve it. Every plant changes output slowly, though, so the time to act is before the line trips.
      </P>
      <P>
        That’s the point of the contingency table, and of the posture operators call <b>N-1</b>: run the system so it can survive the loss of any single element — any line,
        any generator — without overloading anything else. The table runs a power flow for every possible line outage, as a real EMS does every few minutes, and shows the worst. If
        the Harbor–Central row is red before {clock(lineAt)}, the system isn’t ready for it. (Not every red row can be fixed by re-dispatch. Covering the loss of
        Central–Metro, the region’s main artery into the city, would mean shutting Ironwood down for most of the evening; operators facing a contingency like that prepare an
        automatic scheme instead, which disconnects some load in Metro the moment it happens.) Then, at {clock(tripAt)}, Mill Creek trips. The interconnection barely notices — even at
        its full 250 MW, the loss would leave the frequency only about {lostHz.toFixed(2)} Hz low once governors everywhere had responded — but your ACE drops by everything
        Mill Creek was producing, and you have to replace it from plants that still have room. That spare room is the reserve readout, which N-1 says should never fall below
        the largest unit online.
      </P>

      <Challenge
        id="a"
        question="Get through the whole shift, to 21:00, without any load shed and without a sustained overload."
        solved={solved}
        status={
          last
            ? `Last shift: ${last.shedMWh > 0.5 ? `${fmt(last.shedMWh)} MWh of load shed` : 'no load shed'}${last.sustained.length ? `, and a sustained overload on ${last.sustained.map(lineName).join(' and ')}` : ''}.`
            : 'Play the shift to the end.'
        }
        success="Solved. Keeping ahead of the forecast miss, moving generation into Metro before Harbor–Central tripped, and raising the peakers the moment Mill Creek went is exactly the routine of a real control room — just compressed."
      />

      <H2>Seeing the grid</H2>
      <P>
        Everything so far depends on the operator’s picture being right, and raw telemetry never quite is. Meters drift, a communication link drops out, a breaker reports the
        wrong position. So before anything else runs, the EMS performs <b>state estimation</b>: it finds the single state of the grid — in our DC model, the voltage angle at
        every substation — that best fits all of the measurements at once. Because there are more meters than unknowns, each measurement can be checked against what all the
        others imply.
      </P>
      <P>
        Here is a snapshot of the region at 19:00 with fourteen meters, one on every line and one at every substation, each reading the true value plus a few megawatts of
        noise. One meter has a gross error. Move it, switch which meter is faulty, and turn on bad-data detection:
      </P>

      <EstimatorFigure />

      <P>
        Without detection, the estimator does what least squares always does: it spreads the bad reading’s error across the whole picture, so several estimated flows end up tens
        of megawatts wrong. But the bad meter gives itself away. Its <b>normalized residual</b> — how far its reading sits from the estimate, measured in standard deviations of
        its noise — is far larger than any honest meter’s. With detection on, the estimator drops the worst meter, solves again from the rest, and the picture snaps back to within
        a few megawatts of the truth.
      </P>
      <P>
        Real state estimators work with full AC models, thousands of measurements and breaker statuses, and run every minute or so, but the idea is the same: redundancy turns
        noisy, sometimes wrong telemetry into a picture good enough to steer by. So far, every decision in this chapter has been made by an operator or a program on the region’s
        behalf. The next chapter turns those decisions into markets, starting with why markets for electricity exist at all.
      </P>
    </LessonPage>
  );
}
