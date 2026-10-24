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

/** The first demonstration runs this many times faster than real time. */
const SPEED = 20;
/** The closed-loop demonstration runs faster, so a full ten-minute cycle takes 20 seconds. */
const LOOP_SPEED = 30;
const WINDOW = 300; // seconds shown on the chart
const OFFLINE = '#d9d9d9';
const TELEMETRY = '#9a9a9a';

/**
 * The closed-loop demonstration: the same 300-device fleet, 20% unreachable and with no
 * over-dispatch margin, on a fast link and on a slow one, under one correction gain.
 */
export const LOOP = { devices: 300, dropout: 0.2, margin: 0, fastS: 2, slowS: 8, warmupS: 60 };
/** Challenge 7.3: one gain that keeps both fleets within tolerance for at least this share of a full cycle. */
export const LOOP_GOAL = 0.7;
export const loopParams = (latencyS: number, gain: number): VppParams => ({
  devices: LOOP.devices,
  dropout: LOOP.dropout,
  margin: LOOP.margin,
  latencyS,
  feedback: gain,
});

/** One fleet in the closed-loop demonstration, stepped in whole seconds so its score matches `vppScore`. */
export interface LoopRun {
  sim: VppState;
  /** Simulated seconds not yet stepped. */
  acc: number;
  steps: number;
  /** Share of the first full cycle within tolerance, once it has run. */
  result: number | null;
}

/** A fleet warmed up for a minute with its score cleared, exactly as `vppScore` starts one. */
export function startLoop(p: VppParams): LoopRun {
  const s = stepVpp(initVpp(p), p, LOOP.warmupS);
  return { sim: { ...s, inTol: 0, scored: 0 }, acc: 0, steps: 0, result: null };
}

/** Advance by `seconds` of simulated time in one-second steps; the score is recorded after one full cycle. */
export function advanceLoop(r: LoopRun, p: VppParams, seconds: number): LoopRun {
  let { sim, acc, steps, result } = r;
  acc += Math.max(0, seconds);
  while (acc >= 1) {
    sim = stepVpp(sim, p, 1);
    acc -= 1;
    steps += 1;
    if (result === null && steps >= VPP_SCENARIO_S) result = sim.scored ? sim.inTol / sim.scored : 0;
  }
  return { sim, acc, steps, result };
}

export function loopSolved(fast: number | null, slow: number | null): boolean {
  return fast !== null && slow !== null && fast >= LOOP_GOAL && slow >= LOOP_GOAL;
}

function TrackingChart({ sim, ratedMW, label, title }: { sim: VppState; ratedMW: number; label: string; title?: string }) {
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
      {title && (
        <text className="lab ax-e" x={620} y={14}>
          {title}
        </text>
      )}
      <GridY y={y} ticks={ticks} x0={60} x1={620} format={(v) => fmt(v, yMax < 1 ? 2 : 1)} baseline={0} />
      {hist.length > 1 && (
        <>
          <path d={areaPath(xs, hist.map((p) => y(p.target * (1 + tol))), hist.map((p) => y(p.target * (1 - tol))))} fill="#333" opacity={0.08} />
          <path d={linePath(xs, hist.map((p) => y(p.telemetry)))} fill="none" stroke={TELEMETRY} strokeWidth={1.5} />
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

/** The four layers of a virtual power plant, top to bottom, and the controls in the figure that belong to each. */
const LAYERS = [
  { name: 'Market interface', controls: 'the dispatch target (dashed line)' },
  { name: 'Aggregator platform', controls: 'over-dispatch margin' },
  { name: 'Gateways and cloud APIs', controls: 'latency, each way' },
  { name: 'Devices', controls: 'devices in the fleet, unreachable devices' },
];

function LayerStrip() {
  const rowH = 22;
  const pitch = 26;
  const top = 4;
  const bottom = top + pitch * (LAYERS.length - 1) + rowH;
  return (
    <svg
      className="diagram"
      viewBox={`0 0 640 ${bottom + 4}`}
      role="img"
      aria-label={`The layers of a virtual power plant, from the market down to the devices, and the controls in this demonstration that belong to each: ${LAYERS.map((l) => `${l.name}: ${l.controls}`).join('; ')}. Commands flow down and telemetry flows back up, each delayed by the latency.`}
    >
      <defs>
        <marker id="vpp-arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill="#333" />
        </marker>
        <marker id="vpp-arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill={TELEMETRY} />
        </marker>
      </defs>
      <line x1={26} x2={26} y1={top + 4} y2={bottom - 6} stroke="#333" strokeWidth={1.8} markerEnd="url(#vpp-arrow-down)" />
      <text className="ax ax-m" transform={`rotate(-90 12 ${(top + bottom) / 2})`} x={12} y={(top + bottom) / 2 + 4}>
        commands
      </text>
      <line x1={50} x2={50} y1={bottom - 4} y2={top + 6} stroke={TELEMETRY} strokeWidth={1.8} markerEnd="url(#vpp-arrow-up)" />
      <text className="ax ax-m" transform={`rotate(-90 40 ${(top + bottom) / 2})`} x={40} y={(top + bottom) / 2 + 4}>
        telemetry
      </text>
      {LAYERS.map((l, i) => {
        const y = top + i * pitch;
        return (
          <g key={l.name}>
            <rect x={66} y={y} width={570} height={rowH} rx={5} fill="#f1f1ee" />
            <text x={78} y={y + 15.5} style={{ fontSize: 13, fontWeight: 600, fill: '#333' }}>
              {l.name}
            </text>
            <text className="ax" x={270} y={y + 15.5}>
              {l.controls}
            </text>
          </g>
        );
      })}
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

function loopScore(r: LoopRun): string {
  if (r.result !== null) return `${pct(r.result)} of a full cycle`;
  return r.sim.scored > 0 ? `${pct(r.sim.inTol / r.sim.scored)} of ${fmt(r.sim.scored)} s so far` : '—';
}

type Loops = { gain: number; fast: LoopRun; slow: LoopRun };
const startLoops = (gain: number): Loops => ({ gain, fast: startLoop(loopParams(LOOP.fastS, gain)), slow: startLoop(loopParams(LOOP.slowS, gain)) });

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

  // Second figure: closing the loop with telemetry, on a fast link and a slow one at once. Both
  // fleets restart whenever the gain changes, so each scores a full cycle at that gain.
  const play2 = usePlay(true);
  const s2 = useScenario('feedback', { gain: 0 });
  const gain = s2.state.gain;
  const [loops, setLoops] = useSimulation<Loops>(
    () => startLoops(gain),
    (l, dt) => ({
      gain: l.gain,
      fast: advanceLoop(l.fast, loopParams(LOOP.fastS, l.gain), dt * LOOP_SPEED),
      slow: advanceLoop(l.slow, loopParams(LOOP.slowS, l.gain), dt * LOOP_SPEED),
    }),
    play2.playing,
  );
  useEffect(() => {
    if (loops.gain !== gain) setLoops(startLoops(gain));
  }, [gain, loops.gain, setLoops]);
  const loopRatedMW = (LOOP.devices * VPP_DEFAULTS.deviceKW) / 1000;
  const current = loops.gain === gain;
  const [achieved, setAchieved] = useState<null | { gain: number; fast: number; slow: number }>(null);
  useEffect(() => {
    if (!achieved && current && loopSolved(loops.fast.result, loops.slow.result)) setAchieved({ gain, fast: loops.fast.result!, slow: loops.slow.result! });
  }, [achieved, current, gain, loops.fast.result, loops.slow.result]);

  const runText = (r: LoopRun, lat: number) =>
    r.result !== null ? `${pct(r.result)} of the full cycle on the ${lat}-second link` : `${pct(r.sim.scored ? r.sim.inTol / r.sim.scored : 0)} so far on the ${lat}-second link`;
  const status = `A gain of ${gain.toFixed(2)}: ${runText(loops.fast, LOOP.fastS)}, ${runText(loops.slow, LOOP.slowS)}. Each run takes a full cycle, about ${fmt(VPP_SCENARIO_S / LOOP_SPEED)} seconds.`;

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
        service’s interface or through a gateway in the home, sometimes using standard protocols such as IEEE 2030.5 or OpenADR. In the middle is the{' '}
        <b>aggregator platform</b>, the software that forecasts what the fleet can do, decides its schedule and splits each instruction among the devices.
      </P>
      <P>
        At the top is the <b>market interface</b>. The aggregator, or a registered market participant acting for it — in ERCOT, a Qualified Scheduling Entity (QSE),
        the registered company that submits offers and schedules to ERCOT for the resources it represents — submits offers, receives dispatch instructions and is
        responsible for delivering the aggregate. Two kinds of measurement flow back up. <b>Telemetry</b> is the operating
        data: what each device is doing now, reported every few seconds. <b>Settlement metering</b> is the accounting data: revenue-quality interval readings, often from
        the utility’s meter, that arrive after the fact and decide what the aggregator is paid.
      </P>
      <P>
        In the next demonstration, a fleet of 5 kW batteries follows a ten-minute dispatch scenario from the market operator: holds and ramps between 25% and 65% of the fleet’s rating. Every
        4 seconds the platform sends each device an equal share of the target. Each command takes the <K>latency</K> to arrive (give or take 25%), each device ramps toward
        its new setpoint at 1 kW per second, and devices drop out of contact at random for about a minute and a half at a time. The strip at the top of the demonstration stacks
        the four layers and names the controls that belong to each. The shaded band is a tolerance of ±10%
        around the target. The thin gray line is what telemetry shows the platform: the fleet’s output as it was one latency ago, since the reports take as long to
        come back as the commands take to go out. Time runs {SPEED} times faster than real time:
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
        <LayerStrip />
        <Legend
          items={[
            { label: 'Target', color: '#333', kind: 'line', dashed: true },
            { label: 'Actually delivered', color: '#e75b55', kind: 'line' },
            { label: 'What telemetry shows the platform', color: TELEMETRY, kind: 'line' },
          ]}
        />
        <TrackingChart sim={sim} ratedMW={ratedMW} label="Fleet tracking its dispatch target" />
        <DeviceGrid sim={sim} deviceKW={VPP_DEFAULTS.deviceKW} />
        <Caption>
          Each square is a device: darker green is closer to its full 5 kW output, gray is unreachable ({fmt(offline)} of {fmt(devices)} right now).
        </Caption>
        <Readouts
          items={[
            { label: 'error right now', value: last ? `${err >= 0 ? '+' : '−'}${pct(Math.abs(err))}` : '—', tone: Math.abs(err) <= VPP_DEFAULTS.tolerance ? 'ink' : 'orange' },
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
        on average: about 11% extra for 10% dropouts, 25% for 20%. Aggregators call this <K>over-dispatch</K>, and it belongs to the platform layer. Set the margin to 11%
        and the fleet settles onto the target. It only works on average, though, and it’s a guess. Ask for too much and the fleet overshoots, which a grid operator
        generally counts as a failure to follow instructions too.
      </P>
      <P>
        Now raise the latency. Holds are still fine, but every ramp now lags: by the time the commands arrive and the devices have ramped, the target has moved on. That
        error can’t be fixed by over-dispatching, because it comes from time, not from missing devices.
      </P>
      <P>
        Fleet size plays a smaller part, for the same reason it did in the last lesson. With 50 devices, the number that happen to be unreachable swings from minute to
        minute, and no fixed margin suits every minute; with a few hundred, as here, it barely moves. Real grid operators measure how closely a resource follows its instructions and charge or
        disqualify it for persistent deviations, so this kind of tracking performance is what an aggregator’s revenue depends on.
      </P>

      <H2>Closing the loop</H2>
      <P>
        Over-dispatching is open-loop control: the platform never checks the result. The alternative is to watch the telemetry and correct. If the fleet seems to be
        delivering too little, ask for a little more; too much, ask for less. The next demonstration does that with <K>integral control</K>: every second, the platform adds a
        fraction of the error it sees to its request — the correction gain — and keeps the running total. The catch is that the platform sees the fleet through
        telemetry that is one latency old, and its corrections take another latency to arrive.
      </P>
      <P>
        To see what that delay does, the demonstration runs the loop on two copies of the same fleet at once — {fmt(LOOP.devices)} devices, {pct(LOOP.dropout)} of them
        unreachable, no over-dispatch margin. One has fast links, {LOOP.fastS} seconds each way. The other has a slow link, {LOOP.slowS} seconds each way, the kind of
        delay an overloaded cloud service or a storm-damaged network can cause. Both use the same gain, and both start over whenever you change it, so each scores a full
        cycle at the gain you chose. Time runs {LOOP_SPEED} times faster than real time:
      </P>

      <Figure
        name="VPP Control Center · closing the loop"
        scenario={s2}
        play={play2}
        actions={
          <Button onClick={() => setLoops(startLoops(gain))} label="Restart the feedback simulations">
            Restart
          </Button>
        }
      >
        <Legend
          items={[
            { label: 'Target', color: '#333', kind: 'line', dashed: true },
            { label: 'Actually delivered', color: '#e75b55', kind: 'line' },
            { label: 'What telemetry shows', color: TELEMETRY, kind: 'line' },
          ]}
        />
        <TrackingChart sim={loops.fast.sim} ratedMW={loopRatedMW} label={`Fleet under closed-loop control with ${LOOP.fastS} s latency`} title={`Fast links: ${LOOP.fastS} s each way`} />
        <TrackingChart sim={loops.slow.sim} ratedMW={loopRatedMW} label={`Fleet under closed-loop control with ${LOOP.slowS} s latency`} title={`Slow link: ${LOOP.slowS} s each way`} />
        <Readouts
          items={[
            { label: `within tolerance, ${LOOP.fastS} s link`, value: loopScore(loops.fast) },
            { label: `within tolerance, ${LOOP.slowS} s link`, value: loopScore(loops.slow) },
          ]}
        />
        <Slider
          label="Correction gain (platform)"
          tone="red"
          value={gain}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => s2.set({ gain: v })}
          display={`${gain.toFixed(2)} per second`}
        />
      </Figure>

      <P>
        With the gain at zero, both fleets sit about 20% short, and the platform does nothing about it. Raise the gain to around 0.05–0.1 and the fast fleet’s correction
        finds the missing devices’ share by itself, without anyone guessing the dropout rate — and keeps finding it as devices come and go. Feedback adapts where a fixed
        margin can’t.
      </P>
      <P>
        Now watch the slow fleet. The same gain that works on the fast link overshoots there: the platform keeps adding correction while its old, stale telemetry still
        shows a shortfall, and by the time the extra power appears it has asked for far too much. Then it swings the other way. Push the gain to 0.2 and the slow fleet
        swings between zero and everything its reachable devices can give, while the fast one still holds the target. This is a general rule of control systems, not a
        quirk of batteries: the longer the delay around a loop, the gentler its corrections must be, and the slower it can respond.
      </P>

      <Challenge
        id="a"
        question={`The platform can’t tell which link it will have tomorrow. Find one correction gain that keeps delivery within ±10% of the target for at least ${pct(LOOP_GOAL)} of a full ten-minute cycle on both links.`}
        solved={achieved !== null}
        status={status}
        success={
          achieved
            ? `Solved: a gain of ${achieved.gain.toFixed(2)} held delivery within tolerance for ${pct(achieved.fast)} of the cycle on the fast link and ${pct(achieved.slow)} on the slow one. The strong corrections that suit a fast link overshoot on a slow one, so the loop has to be tuned for the longest delay it will face — and on a fast day it then corrects more slowly than it could.`
            : ''
        }
      />

      <P>
        That is why the communication layers matter so much to a virtual power plant, and why grid operators set telemetry and performance requirements before they let
        one provide fast services. A distributed fleet can follow a slow signal — an hourly schedule or a five-minute dispatch — with ease. Following a signal that changes
        every few seconds takes fast, reliable links all the way down. In the <a href={lessonHref('7.4')}>next lesson</a> we’ll leave the control room for the network, and
        ask where on the grid storage does the most good.
      </P>
    </LessonPage>
  );
}
