import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Caption,
  Challenge,
  FUEL,
  Figure,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  mix,
  mw,
  niceTicks,
  pct,
  scale,
  usePlay,
  useScenario,
  useSimulation,
} from '../../framework';
import { VPP_DEFAULTS, VPP_SCENARIO_S, initVpp, stepVpp, type VppParams, type VppState } from '../../engines/ops/vpp';

/** The simulation runs this many times faster than real time. */
const SPEED = 20;
const WINDOW = 300; // seconds shown on the chart
const CHALLENGE = { latency: 5, dropout: 0.2, score: 0.8 };
const OFFLINE = '#d9d9d9';

function TrackingChart({ sim, ratedMW, label }: { sim: VppState; ratedMW: number; label: string }) {
  const hist = sim.history.slice(-WINDOW);
  const tEnd = hist.length ? hist[hist.length - 1].t : 0;
  const x = scale(tEnd - WINDOW, tEnd, 60, 620);
  const yMax = Math.max(0.01, ratedMW);
  const y = scale(0, yMax, 200, 24);
  const ticks = niceTicks(0, yMax, 4);
  const xs = hist.map((p) => x(p.t));
  const tol = VPP_DEFAULTS.tolerance;
  const last = hist[hist.length - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 230"
      role="img"
      aria-label={last ? `${label}: target ${mw(last.target, 2)}, delivered ${mw(last.delivered, 2)}, telemetry shows ${mw(last.telemetry, 2)}.` : `${label}: starting.`}
    >
      <text className="ax" x={60} y={14}>
        Power to the grid, MW
      </text>
      <GridY y={y} ticks={ticks} x0={60} x1={620} format={(v) => fmt(v, yMax < 1 ? 2 : 1)} baseline={0} />
      {hist.length > 1 && (
        <>
          <path d={areaPath(xs, hist.map((p) => y(p.target * (1 + tol))), hist.map((p) => y(p.target * (1 - tol))))} fill="#333" opacity={0.08} />
          <path d={linePath(xs, hist.map((p) => y(p.telemetry)))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} />
          <path d={linePath(xs, hist.map((p) => y(p.target)))} fill="none" stroke="#333" strokeWidth={2} strokeDasharray="7 5" />
          <path d={linePath(xs, hist.map((p) => y(p.delivered)))} fill="none" stroke="#e75b55" strokeWidth={3} strokeLinejoin="round" />
        </>
      )}
      {[0, 60, 120, 180, 240, 300].map((ago) => (
        <text key={ago} className="ax ax-m" x={x(tEnd - ago)} y={222}>
          {ago === 0 ? 'now' : `${ago} s ago`}
        </text>
      ))}
    </svg>
  );
}

function DeviceGrid({ sim, deviceKW }: { sim: VppState; deviceKW: number }) {
  const n = sim.devices.length;
  const cols = 50;
  const cell = 11;
  const rows = Math.ceil(n / cols);
  const offline = sim.devices.filter((d) => !d.online).length;
  return (
    <svg className="diagram" viewBox={`0 0 600 ${rows * cell + 8}`} role="img" aria-label={`${n} devices, ${offline} unreachable right now.`}>
      {sim.devices.map((d, i) => (
        <rect
          key={i}
          x={25 + (i % cols) * cell}
          y={4 + Math.floor(i / cols) * cell}
          width={cell - 2}
          height={cell - 2}
          rx={1.5}
          fill={d.online ? mix('#e3ecd8', FUEL.battery, d.output / deviceKW) : OFFLINE}
        />
      ))}
    </svg>
  );
}

function useVpp(params: VppParams, playing: boolean) {
  const [sim, setSim] = useSimulation(
    () => initVpp(params),
    (s, dt) => stepVpp(s, params, dt * SPEED),
    playing,
  );
  return { sim, restart: () => setSim(initVpp(params)) };
}

function Score({ sim }: { sim: VppState }): ReactNode {
  return sim.scored > 0 ? `${pct(sim.inTol / sim.scored)} of the last ${fmt(sim.scored)} s` : '—';
}

export default function Lesson() {
  const play = usePlay(true);
  const s = useScenario('control', { devices: 300, latency: 2, dropout: 0.1, margin: 0 });
  const { devices, latency, dropout, margin } = s.state;
  const params: VppParams = { devices, latencyS: latency, dropout, margin };
  const { sim, restart } = useVpp(params, play.playing);
  const ratedMW = (devices * VPP_DEFAULTS.deviceKW) / 1000;
  const last = sim.history[sim.history.length - 1];
  const err = last && last.target > 0 ? (last.delivered - last.target) / last.target : 0;
  const offline = sim.devices.filter((d) => !d.online).length;

  const hard = latency >= CHALLENGE.latency && dropout >= CHALLENGE.dropout - 1e-9;
  const full = sim.scored >= VPP_SCENARIO_S;
  const score = sim.scored > 0 ? sim.inTol / sim.scored : 0;
  const [achieved, setAchieved] = useState<null | { score: number; margin: number; devices: number }>(null);
  useEffect(() => {
    if (!achieved && hard && full && score >= CHALLENGE.score) setAchieved({ score, margin, devices });
  }, [achieved, hard, full, score, margin, devices]);

  // Second figure: closing the loop with telemetry.
  const play2 = usePlay(true);
  const s2 = useScenario('feedback', { gain: 0, latency2: 2 });
  const params2: VppParams = { devices: 300, latencyS: s2.state.latency2, dropout: 0.2, margin: 0, feedback: s2.state.gain };
  const { sim: sim2, restart: restart2 } = useVpp(params2, play2.playing);
  const last2 = sim2.history[sim2.history.length - 1];

  let status: string;
  if (!hard) status = `Set the latency to at least ${CHALLENGE.latency} s and the unreachable share to at least ${pct(CHALLENGE.dropout)}.`;
  else if (!full) status = `Scoring: ${fmt(sim.scored)} of ${VPP_SCENARIO_S} s so far, ${pct(score)} within tolerance.`;
  else status = `Over the last ${fmt(sim.scored)} s, delivery was within tolerance ${pct(score)} of the time.`;

  return (
    <LessonPage id="7.3">
      <P>
        In the <a href={lessonHref('7.2')}>previous lesson</a> we counted what a fleet of home batteries could deliver. Counting is the easy part. To sell that capacity,
        an aggregator has to make the fleet respond when the grid operator calls — within seconds or minutes, and close to the amount requested. A gas turbine does this
        through a dedicated, reliable link from its control room. A virtual power plant does it through the same home internet connections that carry video calls.
      </P>
      <P>
        A virtual power plant has several layers, and each adds delay or uncertainty. At the bottom are the <b>devices</b>: each battery’s inverter and local controller,
        which enforce the owner’s settings — the backup reserve, the inverter’s rating — and fall back to running the home on their own if they lose contact. Above them
        sit <b>gateways and APIs</b>. Most home batteries talk to the outside world through their manufacturer’s cloud service; an aggregator reaches them through that
        service’s interface or through a gateway in the home, and some utilities use standard protocols such as IEEE 2030.5 for inverters and OpenADR for demand
        response. In the middle is the <b>aggregator platform</b>, the software that forecasts what the fleet can do, decides its schedule and splits each instruction
        among the devices.
      </P>
      <P>
        At the top is the <b>market interface</b>. The aggregator, or a registered market participant acting for it — in ERCOT, a Qualified Scheduling Entity — submits
        offers, receives dispatch instructions and is responsible for delivering the aggregate. Two kinds of measurement flow back up. <b>Telemetry</b> is the operating
        data: what each device is doing now, reported every few seconds. <b>Settlement metering</b> is the accounting data: revenue-quality interval readings, often from
        the utility’s meter, that arrive after the fact and decide what the aggregator is paid.
      </P>
      <P>
        Below, a fleet of 5 kW batteries follows a ten-minute dispatch scenario from the market operator: holds and ramps between 25% and 65% of the fleet’s rating. Every
        4 seconds the platform sends each device an equal share of the target. Each command takes the <K>latency</K> to arrive (give or take 25%), each device ramps toward
        its new setpoint at 1 kW per second, and devices drop out of contact at random for about a minute and a half at a time. The gray band is a tolerance of ±10%
        around the target. Time runs {SPEED} times faster than real time:
      </P>

      <Figure
        name="VPP Control Center"
        scenario={s}
        play={play}
        actions={
          <Button onClick={restart} label="Restart the simulation">
            Restart
          </Button>
        }
      >
        <Legend
          items={[
            { label: 'Target', color: '#333', kind: 'line', dashed: true },
            { label: 'Delivered (settlement meters)', color: '#e75b55', kind: 'line' },
            { label: 'What telemetry shows the platform', color: '#9a9a9a', kind: 'line' },
          ]}
        />
        <TrackingChart sim={sim} ratedMW={ratedMW} label="Fleet tracking its dispatch target" />
        <DeviceGrid sim={sim} deviceKW={VPP_DEFAULTS.deviceKW} />
        <Caption>
          Each square is a device: darker green is closer to its full 5 kW output, gray is unreachable ({fmt(offline)} of {fmt(devices)} right now).
        </Caption>
        <Readouts
          items={[
            { label: 'target', value: last ? mw(last.target, 2) : '—' },
            { label: 'delivered', value: last ? mw(last.delivered, 2) : '—', tone: 'red' },
            { label: 'error', value: last ? `${err >= 0 ? '+' : '−'}${pct(Math.abs(err))}` : '—', tone: Math.abs(err) <= VPP_DEFAULTS.tolerance ? 'ink' : 'orange' },
            { label: 'within tolerance', value: <Score sim={sim} /> },
          ]}
        />
        <Slider label="Devices in the fleet" value={devices} min={50} max={500} step={10} onChange={(v) => s.set({ devices: v })} display={`${fmt(devices)} (${mw(ratedMW, 2)})`} />
        <Slider label="Latency, each way" value={latency} min={0.5} max={30} step={0.5} onChange={(v) => s.set({ latency: v })} display={`${latency.toFixed(1)} s`} />
        <Slider label="Unreachable devices" value={dropout} min={0} max={0.4} step={0.01} onChange={(v) => s.set({ dropout: v })} display={pct(dropout)} />
        <Slider label="Over-dispatch margin" tone="red" value={margin} min={0} max={0.6} step={0.01} onChange={(v) => s.set({ margin: v })} display={`+${pct(margin)}`} />
        <Caption>The score restarts whenever you change a setting.</Caption>
      </Figure>

      <P>
        With the starting settings — 2-second latency and 10% of devices unreachable — the fleet tracks the shape of the target well but sits consistently below it. The
        platform asks every device for its share, but a tenth of them never hear the request, so the fleet delivers about 90% of what it was asked for. That shortfall
        is right at the edge of the tolerance band.
      </P>
      <P>
        The simplest fix is to ask for more than you need. If a share <i>d</i> of devices won’t respond, requesting the target times 1 / (1 − <i>d</i>) makes up for them
        on average: about 11% extra for 10% dropouts, 25% for 20%. Aggregators call this <K>over-dispatch</K>. It only works on average, though, and it’s a guess. Ask for
        too much and the fleet overshoots, which a grid operator generally counts as a failure to follow instructions too.
      </P>
      <P>
        Now raise the latency. Holds are still fine, but every ramp now lags: by the time the commands arrive and the devices have ramped, the target has moved on. That
        error can’t be fixed by over-dispatching, because it comes from time, not from missing devices.
      </P>

      <Challenge
        id="a"
        question={`A storm has slowed the fleet’s connections. With latency of at least ${CHALLENGE.latency} s and at least ${pct(CHALLENGE.dropout)} of devices unreachable, keep delivery within ±10% of the target for at least ${pct(CHALLENGE.score)} of a full ten-minute cycle.`}
        solved={achieved !== null}
        status={status}
        success={
          achieved
            ? `Solved: ${pct(achieved.score)} within tolerance with ${fmt(achieved.devices)} devices and a ${pct(achieved.margin)} margin. The margin makes up for the missing devices on average, and a larger fleet keeps the share that happens to be missing close to that average.`
            : ''
        }
      />

      <P>
        The fleet size matters here for the same reason it did in the last lesson. With 50 devices, the number that happen to be unreachable swings from minute to minute,
        and no fixed margin suits every minute; with 500, it barely moves. Real grid operators measure how closely a resource follows its instructions and charge or
        disqualify it for persistent deviations, so this kind of tracking performance is what an aggregator’s revenue depends on.
      </P>

      <H2>Closing the loop</H2>
      <P>
        Over-dispatching is open-loop control: the platform never checks the result. The alternative is to watch the telemetry and correct. If the fleet seems to be
        delivering too little, ask for a little more; too much, ask for less. The figure below does that with <K>integral control</K>: every second, the platform adds a
        fraction of the error it sees to its request — the correction gain — and keeps the running total. There is no over-dispatch margin, and 20% of devices are
        unreachable. The catch is that the platform sees the fleet through telemetry that is one latency old, and its corrections take another latency to arrive:
      </P>

      <Figure
        name="VPP Control Center · closing the loop"
        scenario={s2}
        play={play2}
        actions={
          <Button onClick={restart2} label="Restart the feedback simulation">
            Restart
          </Button>
        }
      >
        <TrackingChart sim={sim2} ratedMW={(300 * VPP_DEFAULTS.deviceKW) / 1000} label="Fleet under closed-loop control" />
        <Readouts
          items={[
            { label: 'target', value: last2 ? mw(last2.target, 2) : '—' },
            { label: 'delivered', value: last2 ? mw(last2.delivered, 2) : '—', tone: 'red' },
            { label: 'correction to the request', value: `${sim2.correction >= 0 ? '+' : '−'}${pct(Math.abs(sim2.correction))} of rating` },
            { label: 'within tolerance', value: <Score sim={sim2} /> },
          ]}
        />
        <Slider
          label="Correction gain"
          tone="red"
          value={s2.state.gain}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => s2.set({ gain: v })}
          display={`${s2.state.gain.toFixed(2)} per second`}
        />
        <Slider
          label="Latency, each way"
          value={s2.state.latency2}
          min={0.5}
          max={20}
          step={0.5}
          onChange={(v) => s2.set({ latency2: v })}
          display={`${s2.state.latency2.toFixed(1)} s`}
        />
      </Figure>

      <P>
        With the gain at zero, the fleet sits about 20% short, and the platform does nothing about it. Raise the gain to around 0.05–0.1 and the correction finds the
        missing devices’ share by itself, without anyone guessing the dropout rate — and keeps finding it as devices come and go. Feedback adapts where a fixed margin
        can’t.
      </P>
      <P>
        Now increase the latency to 10 seconds. The same gain that worked before now overshoots: the platform keeps adding correction while its old, stale telemetry still
        shows a shortfall, and by the time the extra power appears it has asked for far too much. Then it swings the other way. Push the gain higher and the fleet
        oscillates between empty and full. This is a general rule of control systems, not a quirk of batteries: the longer the delay around a loop, the gentler its
        corrections must be, and the slower it can respond.
      </P>
      <P>
        That is why the communication layers matter so much to a virtual power plant, and why grid operators set telemetry and performance requirements before they let
        one provide fast services. A distributed fleet can follow a slow signal — an hourly schedule or a five-minute dispatch — with ease. Following a signal that changes
        every few seconds takes fast, reliable links all the way down. In the <a href={lessonHref('7.4')}>next lesson</a> we’ll leave the control room for the network, and
        ask where on the grid storage does the most good.
      </P>
    </LessonPage>
  );
}
