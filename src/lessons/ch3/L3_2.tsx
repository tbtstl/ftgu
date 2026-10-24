import { useEffect, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  Figure,
  FUEL,
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
  Tn,
  fmt,
  linePath,
  mw,
  pct,
  scale,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../framework';
import { DEFAULT_FREQUENCY as D, type FrequencyParams } from '../../engines/ops/frequency';
import { simulateEvent as simulateTrip } from '../../engines/ops/frequencyEvent';

const X0 = 52;
const X1 = 628;
const SECONDS = 30;
const xT = scale(0, SECONDS, X0, X1);
const SPEED = 2; // the playback runs at twice real time
const UFLS = D.ufls;
const BETA = D.governorMW / (D.droop * D.f0) + (D.damping * D.loadMW) / D.f0;
const KE = D.inertiaH * D.onlineMW;
const FFR_COLOR = FUEL.battery;

function params(base: FrequencyParams, over: Partial<FrequencyParams>): FrequencyParams {
  return { ...base, ...over };
}

function fTicks(lo: number, hi: number): number[] {
  const step = hi - lo > 1.2 ? 0.5 : hi - lo > 0.6 ? 0.2 : 0.1;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// ---------------------------------------------------------------------------
// Figure 1: one trip, every knob.

function TripFigure() {
  const sc = useScenario('trip', { lost: 1000, H: 5, headroom: 2500, droop: 5, ffr: 0 });
  const { lost, H, headroom, droop, ffr } = sc.state;
  const r = useMemo(() => simulateTrip(params(D, { inertiaH: H, headroomMW: headroom, droop: droop / 100, fastMW: ffr }), lost, SECONDS, 0.05), [lost, H, headroom, droop, ffr]);
  const play = usePlay(false);
  const [tp, setTp] = useState(SECONDS);
  useAnimationFrame((dt) => setTp((t) => Math.min(SECONDS, t + dt * SPEED)), play.playing);
  useEffect(() => {
    if (tp >= SECONDS && play.playing) play.setPlaying(false);
  }, [tp, play]);
  const toggle = () => {
    if (tp >= SECONDS) {
      setTp(0);
      play.setPlaying(true);
    } else play.toggle();
  };
  const replay = () => {
    setTp(0);
    play.setPlaying(true);
  };

  const maxF = Math.max(...r.samples.map((s) => s.f));
  const lo = Math.min(59.2, Math.floor((r.nadir - 0.1) * 10) / 10);
  const hi = Math.max(60.1, Math.ceil((maxF + 0.05) * 10) / 10);
  const y = scale(lo, hi, 216, 24);
  const k = Math.min(r.samples.length - 1, Math.round(tp / 0.05));
  const shown = r.samples.slice(0, k + 1);
  const full = linePath(r.samples.map((s) => xT(s.t)), r.samples.map((s) => y(s.f)));
  const bold = linePath(shown.map((s) => xT(s.t)), shown.map((s) => y(s.f)));
  const now = r.samples[k];
  // The initial rate of change, drawn as a tangent until it leaves the plot.
  const tTan = Math.min(SECONDS, (lo - 60) / Math.min(-1e-6, r.rocof), 4);
  const settledHz = r.samples[r.samples.length - 1].f;

  const pMax = Math.max(lost, ...r.samples.map((s) => s.governor + s.fast + s.shed)) * 1.1;
  const yp = scale(0, pMax, 150, 20);
  const series = [
    { key: 'governor' as const, color: GRAPHIC.teal, label: 'Governors' },
    { key: 'fast' as const, color: FFR_COLOR, label: 'Fast response from batteries' },
    { key: 'shed' as const, color: GRAPHIC.red, label: 'Load shed' },
  ];

  return (
    <Figure name="Frequency Simulator" scenario={sc} play={{ playing: play.playing, toggle }} actions={<button type="button" className="tbtn" onClick={replay}>Trip again</button>}>
      <svg
        className="chart"
        viewBox="0 0 640 240"
        role="img"
        aria-label={`Frequency after losing ${lost} MW: falls at ${Math.abs(r.rocof).toFixed(2)} Hz per second, bottoms out at ${r.nadir.toFixed(2)} Hz after ${r.nadirT.toFixed(1)} s, settles at ${settledHz.toFixed(2)} Hz.`}
      >
        <text className="ax" x={X0} y={14}>
          Frequency, Hz
        </text>
        <GridY y={y} ticks={fTicks(lo, hi)} x0={X0} x1={X1} format={(v) => v.toFixed(1)} />
        {UFLS.filter((u) => u.hz > lo).map((u, i) => (
          <g key={u.hz}>
            <line x1={X0} x2={X1} y1={y(u.hz)} y2={y(u.hz)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.8} />
            <text className="ax ax-e" x={X1} y={y(u.hz) - 4}>
              {i === 0 ? `load shedding, stage 1: ${u.hz.toFixed(1)} Hz` : `stage ${i + 1}: ${u.hz.toFixed(1)} Hz`}
            </text>
          </g>
        ))}
        <line x1={xT(0)} y1={y(60)} x2={xT(tTan)} y2={y(60 + r.rocof * tTan)} stroke="#333" strokeWidth={1.2} strokeDasharray="3 4" />
        <path d={full} fill="none" stroke={GRAPHIC.teal} strokeWidth={2} opacity={0.3} strokeLinejoin="round" />
        <path d={bold} fill="none" stroke={GRAPHIC.teal} strokeWidth={3} strokeLinejoin="round" />
        <line x1={X0} x2={X1} y1={y(settledHz)} y2={y(settledHz)} stroke={GRAPHIC.teal} strokeWidth={1} strokeDasharray="2 4" />
        <circle cx={xT(r.nadirT)} cy={y(r.nadir)} r={5} fill="#fcfcfb" stroke={GRAPHIC.teal} strokeWidth={2} />
        <text className="lab" x={xT(r.nadirT) + 9} y={y(r.nadir) + 16}>
          nadir {r.nadir.toFixed(2)} Hz
        </text>
        <circle cx={xT(now.t)} cy={y(now.f)} r={5} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={2} />
        <line className="base" x1={X0} x2={X1} y1={216} y2={216} />
        {[0, 5, 10, 15, 20, 25, 30].map((t) => (
          <text key={t} className="ax ax-m" x={xT(t)} y={234}>
            {t} s
          </text>
        ))}
      </svg>
      <svg className="chart" viewBox="0 0 640 170" role="img" aria-label={`Power that replaces the lost ${lost} MW: governors, fast response and load shedding.`}>
        <text className="ax" x={X0} y={12}>
          What replaces the lost {fmt(lost)} MW
        </text>
        <GridY y={yp} ticks={[0, Math.round(lost / 2), lost]} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
        <line x1={X0} x2={X1} y1={yp(lost)} y2={yp(lost)} stroke="#333" strokeWidth={1.2} strokeDasharray="5 4" />
        {series.map((s) => (
          <g key={s.key}>
            <path d={linePath(r.samples.map((q) => xT(q.t)), r.samples.map((q) => yp(q[s.key])))} fill="none" stroke={s.color} strokeWidth={2} opacity={0.3} />
            <path d={linePath(shown.map((q) => xT(q.t)), shown.map((q) => yp(q[s.key])))} fill="none" stroke={s.color} strokeWidth={2.5} />
          </g>
        ))}
        <line className="base" x1={X0} x2={X1} y1={150} y2={150} />
        {[0, 5, 10, 15, 20, 25, 30].map((t) => (
          <text key={t} className="ax ax-m" x={xT(t)} y={166}>
            {t} s
          </text>
        ))}
      </svg>
      <Legend items={[...series.map((s) => ({ label: s.label, color: s.color, kind: 'line' as const })), { label: 'Generation lost', color: '#333', kind: 'line' as const, dashed: true }]} />
      <Readouts
        items={[
          { label: 'initial rate of change', value: `${r.rocof.toFixed(2)} Hz/s`, tone: 'teal' },
          { label: `lowest point, at ${r.nadirT.toFixed(1)} s`, value: `${r.nadir.toFixed(2)} Hz`, tone: r.shedMW > 0 ? 'red' : 'teal' },
          { label: 'after 30 seconds', value: `${settledHz.toFixed(2)} Hz` },
          { label: 'customers disconnected', value: r.shedMW > 0 ? mw(r.shedMW) : 'none', tone: r.shedMW > 0 ? 'red' : undefined },
        ]}
      />
      <Slider label="Generation lost" tone="red" value={lost} min={100} max={3000} step={50} onChange={(v) => sc.set({ lost: v })} display={mw(lost)} />
      <Slider label="Inertia constant H" tone="gold" value={H} min={1} max={8} step={0.5} onChange={(v) => sc.set({ H: v })} display={`${H.toFixed(1)} s`} />
      <Slider label="Governor headroom" tone="teal" value={headroom} min={0} max={4000} step={100} onChange={(v) => sc.set({ headroom: v })} display={mw(headroom)} />
      <Slider label="Governor droop" tone="teal" value={droop} min={3} max={10} step={0.5} onChange={(v) => sc.set({ droop: v })} display={`${droop.toFixed(1)}%`} />
      <Slider label="Fast frequency response" tone="green" value={ffr} min={0} max={1500} step={50} onChange={(v) => sc.set({ ffr: v })} display={mw(ffr)} />
      <Caption>
        {play.playing || tp < SECONDS
          ? `${now.t.toFixed(1)} seconds after the trip: ${now.f.toFixed(3)} Hz.`
          : r.shedMW > 0
            ? `The governors couldn’t catch the fall in time, so ${mw(r.shedMW)} of customers were disconnected automatically.`
            : `The governors catch the fall ${r.nadirT.toFixed(1)} seconds after the trip, ${(60 - r.nadir).toFixed(2)} Hz down, without disconnecting anyone.`}
      </Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: replacing synchronous plants with inverter-based ones.

const TRIP2 = 1200;
const SHARES = Array.from({ length: 17 }, (_, i) => i * 0.05);

function inverterParams(share: number, ffr: number): FrequencyParams {
  return params(D, { onlineMW: D.onlineMW * (1 - share), governorMW: D.governorMW * (1 - share), headroomMW: D.headroomMW * (1 - share), fastMW: ffr });
}

function sweep(ffr: number) {
  return SHARES.map((s) => simulateTrip(inverterParams(s, ffr), TRIP2, 6, 0.05).nadir);
}

const SWEEP_NONE = sweep(0);
const yN = scale(59.2, 60, 170, 24);
const xS = scale(0, 0.8, X0, X1);

function InverterFigure({ onState }: { onState: (s: { share: number; shed: number }) => void }) {
  const sc = useScenario('inverters', { share: 30, ffr: 0 });
  const { share, ffr } = sc.state;
  const sh = share / 100;
  const withFfr = useMemo(() => simulateTrip(inverterParams(sh, ffr), TRIP2, SECONDS, 0.05), [sh, ffr]);
  const without = useMemo(() => simulateTrip(inverterParams(sh, 0), TRIP2, SECONDS, 0.05), [sh]);
  const curve = useMemo(() => (ffr > 0 ? sweep(ffr) : SWEEP_NONE), [ffr]);
  useEffect(() => onState({ share: sh, shed: withFfr.shedMW }), [sh, withFfr.shedMW, onState]);

  const lo = 59.0;
  const y = scale(lo, 60.1, 186, 24);
  const trace = (r: typeof withFfr) => linePath(r.samples.map((s) => xT(s.t)), r.samples.map((s) => y(Math.max(lo, Math.min(60.1, s.f)))));
  const online = D.onlineMW * (1 - sh);

  return (
    <Figure name="Frequency Simulator · inverter-based generation" scenario={sc}>
      <svg
        className="chart"
        viewBox="0 0 640 210"
        role="img"
        aria-label={`With ${share}% of generation from wind and solar, losing ${TRIP2} MW makes the frequency fall to ${withFfr.nadir.toFixed(2)} Hz${withFfr.shedMW > 0 ? ', shedding load' : ''}.`}
      >
        <text className="ax" x={X0} y={14}>
          Frequency after losing {fmt(TRIP2)} MW, Hz
        </text>
        <GridY y={y} ticks={[59, 59.5, 60]} x0={X0} x1={X1} format={(v) => v.toFixed(1)} />
        <line x1={X0} x2={X1} y1={y(UFLS[0].hz)} y2={y(UFLS[0].hz)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="5 4" />
        <text className="ax ax-e" x={X1} y={y(UFLS[0].hz) - 4}>
          load shedding begins: {UFLS[0].hz.toFixed(1)} Hz
        </text>
        {ffr > 0 && <path d={trace(without)} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="6 5" strokeLinejoin="round" />}
        <path d={trace(withFfr)} fill="none" stroke={GRAPHIC.teal} strokeWidth={3} strokeLinejoin="round" />
        <line className="base" x1={X0} x2={X1} y1={186} y2={186} />
        {[0, 5, 10, 15, 20, 25, 30].map((t) => (
          <text key={t} className="ax ax-m" x={xT(t)} y={204}>
            {t} s
          </text>
        ))}
      </svg>
      <svg className="chart" viewBox="0 0 640 200" role="img" aria-label="Lowest frequency after the trip, as the share of wind and solar grows, with and without fast frequency response.">
        <text className="ax" x={X0} y={14}>
          Lowest frequency, Hz
        </text>
        <GridY y={yN} ticks={[59.2, 59.4, 59.6, 59.8, 60]} x0={X0} x1={X1} format={(v) => v.toFixed(1)} />
        <line x1={X0} x2={X1} y1={yN(UFLS[0].hz)} y2={yN(UFLS[0].hz)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="5 4" />
        <path d={linePath(SHARES.map(xS), SWEEP_NONE.map(yN))} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="6 5" />
        {ffr > 0 && <path d={linePath(SHARES.map(xS), curve.map(yN))} fill="none" stroke={GRAPHIC.teal} strokeWidth={3} />}
        <line className="cur" x1={xS(sh)} x2={xS(sh)} y1={24} y2={170} />
        <circle cx={xS(sh)} cy={yN(Math.max(59.2, withFfr.nadir))} r={6} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={2} />
        <line className="base" x1={X0} x2={X1} y1={170} y2={170} />
        {[0, 0.2, 0.4, 0.6, 0.8].map((s) => (
          <text key={s} className="ax ax-m" x={xS(s)} y={188}>
            {pct(s)}
          </text>
        ))}
        <text className="ax ax-e" x={X1} y={200}>
          Share of generation from wind and solar
        </text>
      </svg>
      <Legend
        items={[
          { label: ffr > 0 ? `With ${mw(ffr)} of fast response` : 'Fast response: none', color: GRAPHIC.teal, kind: 'line' },
          { label: 'Without fast response', color: '#8a8a8a', kind: 'line', dashed: true },
        ]}
      />
      <Readouts
        items={[
          { label: 'spinning machines online', value: mw(online) },
          { label: 'initial rate of change', value: `${withFfr.rocof.toFixed(2)} Hz/s`, tone: 'teal' },
          { label: 'lowest point', value: `${withFfr.nadir.toFixed(2)} Hz`, tone: withFfr.shedMW > 0 ? 'red' : 'teal' },
          { label: 'customers disconnected', value: withFfr.shedMW > 0 ? mw(withFfr.shedMW) : 'none', tone: withFfr.shedMW > 0 ? 'red' : undefined },
        ]}
      />
      <Slider label="Share of generation from wind and solar" value={share} min={0} max={80} step={5} onChange={(v) => sc.set({ share: v })} display={`${share}%`} />
      <Slider label="Fast frequency response" tone="green" value={ffr} min={0} max={1500} step={50} onChange={(v) => sc.set({ ffr: v })} display={mw(ffr)} />
    </Figure>
  );
}

// ---------------------------------------------------------------------------

const DEFAULT_TRIP = simulateTrip(D, 1000, SECONDS, 0.05);
const HALF_H = simulateTrip({ ...D, inertiaH: D.inertiaH / 2 }, 1000, SECONDS, 0.05);
const SHARE_30 = simulateTrip(inverterParams(0.3, 0), TRIP2, SECONDS, 0.05);
const SHARE_50 = simulateTrip(inverterParams(0.5, 0), TRIP2, SECONDS, 0.05);
const FIRST_SHED = (() => {
  for (let L = 1000; L <= 3000; L += 50) if (simulateTrip(D, L, 10, 0.05).shedMW > 0) return L;
  return 3000;
})();

export default function Lesson() {
  const [inv, setInv] = useState({ share: 0.3, shed: 0 });
  const onInv = useMemo(() => (s: { share: number; shed: number }) => setInv(s), []);
  const solved = inv.share >= 0.7 - 1e-9 && inv.shed === 0;
  const rocof = DEFAULT_TRIP.rocof;

  return (
    <LessonPage id="3.2">
      <P>
        In the last lesson we pretended the course region was an island, alone with its own spinning machines. It isn’t. Its high-voltage lines connect to the neighboring
        regions, theirs connect to their neighbors, and the whole web forms a <b>synchronous interconnection</b>: an area in which every generator turns in step and there is
        exactly one <K c="frequency">frequency</K>. The mainland grid of North America is divided into four of them — the Eastern and Western Interconnections, Texas, and
        Québec — linked to one another only through converters that pass power without passing frequency.
      </P>
      <P>
        In this course, our region belongs to an interconnection serving about {fmt(D.loadMW)} MW of demand, with {fmt(D.onlineMW)} MW of generators spinning. Sharing a
        frequency with all of them is an enormous help. A mismatch in our region now pulls on twenty thousand megawatts of rotating machines and governors instead of fifteen
        hundred, so the everyday wobbles of the balancing game barely register. What it can’t do is make the worst moments go away. Every so often, a large power plant trips
        offline in an instant — a fault, a protection relay, a turbine problem — and the whole interconnection has to absorb the loss before anyone can react.
      </P>
      <P>
        Here’s what happens to the frequency in the half-minute after the interconnection suddenly loses some of its generation. Press play to watch the event unfold at twice
        real speed, and move the sliders to change the system:
      </P>

      <TripFigure />

      <P>
        At the first instant the lost power is replaced entirely by kinetic energy, so the frequency starts falling at a rate set by the size of the loss and the amount of
        spinning mass. That mass is described by the <K tone="gold">inertia constant H</K>: the kinetic energy a machine stores at full speed, divided by its rating. For large
        generators it’s typically between 2 and 10 seconds; our interconnection averages {D.inertiaH}, so its machines hold {fmt(KE)} megajoules. The initial <b>rate of change of frequency</b>, or
        RoCoF, follows directly:
      </P>
      <Eq label="Initial rate of change of frequency">
        <span>RoCoF</span>
        <Op>=</Op>
        <Frac
          top={
            <>
              <Tn tone="red">ΔP</Tn> × f<Sub>0</Sub>
            </>
          }
          bottom={
            <>
              2 × <Tn tone="gold">H</Tn> × S
            </>
          }
        />
        <Op>=</Op>
        <Frac
          top={
            <>
              <Tn tone="red">1,000 MW</Tn> × 60 Hz
            </>
          }
          bottom={
            <>
              2 × <Tn tone="gold">{D.inertiaH} s</Tn> × {fmt(D.onlineMW)} MW
            </>
          }
        />
        <Op>=</Op>
        <Tn tone="teal">{Math.abs(rocof).toFixed(2)} Hz/s</Tn>
      </Eq>
      <P>
        Left alone, that rate would carry the frequency down to 59.3 Hz in about {fmt(0.7 / Math.abs(rocof), 1)} seconds. The governors don’t leave it alone: they begin opening
        their valves within a second, and at the default settings they catch the fall {DEFAULT_TRIP.nadirT.toFixed(1)} seconds after the trip, at a lowest point — the{' '}
        <b>nadir</b> — of {DEFAULT_TRIP.nadir.toFixed(2)} Hz. Halve the inertia and the frequency falls twice as fast, so the governors catch it later and lower, at{' '}
        {HALF_H.nadir.toFixed(2)} Hz. Inertia doesn’t stop anything by itself. It buys time.
      </P>
      <P>
        Where the frequency finally <b>settles</b> has nothing to do with inertia. As in the island, it’s set by how hard the governors push for each hertz of error, which the
        droop controls: the interconnection’s plants and loads respond with {fmt(BETA)} MW per hertz, so a 1,000 MW loss leaves the frequency{' '}
        {(1000 / BETA).toFixed(2)} Hz low until AGC restores it over the following minutes. A stiffer droop settles closer to 60.
      </P>
      <P>
        Now take away the governors’ <b>headroom</b>, the spare capacity they can actually deliver. With less spare capacity than the plant that tripped, they can’t replace it,
        and the frequency keeps falling until the grid’s last line of defense acts. <b>Under-frequency load shedding</b> relays, spread across the distribution network, disconnect
        blocks of customers automatically at preset thresholds: in our model, {pct(UFLS[0].share)} of demand at {UFLS[0].hz.toFixed(1)} Hz, another{' '}
        {pct(UFLS[1].share)} at {UFLS[1].hz.toFixed(1)} and a third at {UFLS[2].hz.toFixed(1)}. Real schemes differ in detail, but all work this way. It sounds drastic, and it is, but it’s much better than the alternative: if the frequency
        kept falling, generators would begin to trip to protect their turbines, each trip deepening the fall. With the default settings, a loss of about{' '}
        {fmt(FIRST_SHED)} MW or more is enough to shed load.
      </P>
      <P>
        The last slider adds <K tone="green">fast frequency response</K> from batteries. A battery has no inertia and no governor, but its inverter can change its output in a
        fraction of a second. In our model the batteries wait until the frequency crosses 59.8 Hz, then deliver their full response {D.fastDelay} seconds later — never more than
        the loss itself — and back off as the frequency returns to 60 Hz. They can’t change the initial rate of change, but they arrest the fall long before the governors
        could.
      </P>

      <H2>Fewer spinning machines</H2>
      <P>
        Wind turbines and solar panels connect to the grid through <b>inverters</b>, power electronics that build an AC waveform from whatever the turbine or panel produces. Their
        rotating parts, if they have any, aren’t locked to the grid’s frequency, so they contribute essentially no inertia. And because their fuel is free, they normally run
        flat out, with nothing held back for governor response. Every megawatt of wind or solar that displaces a synchronous plant takes that plant’s inertia and governor with it.
      </P>
      <P>
        In the next demonstration, the interconnection loses {fmt(TRIP2)} MW — about the size of a large nuclear unit — while a growing share of its generation comes from wind and solar. The
        synchronous plants that remain keep the same inertia constant and droop, but there are fewer of them:
      </P>

      <InverterFigure onState={onInv} />

      <P>
        At {pct(0.3)} the interconnection still rides through, but only just: the frequency bottoms out at {SHARE_30.nadir.toFixed(2)} Hz. By {pct(0.5)}, only{' '}
        {fmt(D.onlineMW * 0.5)} MW of machines are left spinning, the frequency falls at {Math.abs(SHARE_50.rocof).toFixed(2)} Hz per second, and the first stage of load
        shedding trips before the governors can respond. The grid hasn’t lost any energy or capacity it needs; it has lost speed of response.
      </P>
      <P>
        Fast frequency response is the most direct fix. Add some and the frequency curve flattens out far earlier, because a battery responding in a third of a second doesn’t
        need much time to be bought for it. Grids with a lot of wind and solar now buy this service, and some go further: Ireland’s grid operator, for one, caps the share of
        non-synchronous generation allowed online at any moment, keeping enough spinning machines connected to slow the fall.
      </P>

      <Challenge
        id="a"
        question={`With at least 70% of the interconnection’s generation coming from wind and solar, add enough fast frequency response to keep the frequency above ${UFLS[0].hz.toFixed(1)} Hz through the ${fmt(TRIP2)} MW trip, so that no one is disconnected.`}
        solved={solved}
        status={
          inv.share < 0.7 - 1e-9
            ? `Right now ${pct(inv.share)} of generation is wind and solar. Raise it to at least 70%.`
            : `At ${pct(inv.share)} wind and solar, the trip still sheds ${mw(inv.shed)} of load.`
        }
        success="Solved. With so little inertia the frequency falls more than a hertz per second, so the response has to come almost at once — and it has to be big, because it’s doing the governors’ job too."
      />

      <P>
        Push the share further and you’ll find a point where no amount of fast response is enough: the frequency falls past 59.3 Hz before the batteries’ few tenths of a second
        are up. Engineers are working on inverters that respond to the waveform itself, with no measurement delay — so-called grid-forming inverters — but for now, a grid’s
        spinning mass still matters. In the next lesson we zoom out from seconds to hours, and look at what wind and solar do to the job of scheduling the plants that remain.
      </P>
    </LessonPage>
  );
}
