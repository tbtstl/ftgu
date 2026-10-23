import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  Controls,
  Eq,
  Figure,
  Frac,
  FUEL,
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
  Tn,
  areaPath,
  fmt,
  hour,
  linePath,
  mix,
  mw,
  niceTicks,
  pct,
  scale,
  signed,
  useScenario,
  usePlay,
  useSimulation,
} from '../../framework';
import {
  GAME,
  ISLAND,
  forecastAt,
  gameDemand,
  inBandShare,
  initialGame,
  initialSetpoints,
  islandBeta,
  kineticEnergy,
  stepGame,
  stepResponse,
  summarizeStep,
  type GameState,
} from '../../engines/ops/balancing';

// ---------------------------------------------------------------------------
// Figure 1: the balancing game.

const X0 = 52;
const X1 = 628;
const xMin = (t: number) => X0 + (t / 1440) * (X1 - X0);
const yMW = scale(0, 1600, 196, 26);
const F_LO = 59.5;
const F_HI = 60.5;
const yF = scale(F_LO, F_HI, 330, 236);

const CC2_COLOR = mix(FUEL.gasCC, '#ffffff', 0.4);
/** Stack order bottom to top, as indices into GameSample.out (fixed…, controlled…, AGC unit). */
const LAYERS = [
  { i: 0, color: FUEL.nuclear, label: 'Harbor Point nuclear' },
  { i: 1, color: FUEL.coal, label: 'Ironwood coal' },
  { i: 5, color: FUEL.hydro, label: 'Falls hydro' },
  { i: 2, color: FUEL.gasCC, label: 'Lakeside' },
  { i: 3, color: CC2_COLOR, label: 'Mill Creek' },
  { i: 4, color: FUEL.gasCT, label: 'Eastgate peaker' },
];
const UNIT_TONE = { cc1: 'orange', cc2: 'orange', ct: 'red' } as const;
const FORECAST_PATH = (() => {
  const ts = Array.from({ length: 145 }, (_, k) => k * 10);
  return linePath(ts.map(xMin), ts.map((t) => yMW(forecastAt(t))));
})();
const FIXED_MW = GAME.fixed.reduce((s, u) => s + u.mw, 0);

export interface RunResult {
  share: number;
  agcTime: number;
}

function GameChart({ s }: { s: GameState }) {
  const h = s.hist;
  const xs = h.map((p) => xMin(p.t));
  let lower = h.map(() => 0);
  const areas = LAYERS.map((L) => {
    const upper = lower.map((v, k) => v + h[k].out[L.i]);
    const d = h.length > 1 ? areaPath(xs, upper.map(yMW), lower.map(yMW)) : '';
    lower = upper;
    return { d, color: L.color };
  });
  const demand = h.length > 1 ? linePath(xs, h.map((p) => yMW(p.demand))) : '';
  const clampF = (f: number) => Math.max(F_LO, Math.min(F_HI, f));
  const freq = h.length > 1 ? linePath(xs, h.map((p) => yF(clampF(p.f)))) : '';
  const f = GAME.f0 + s.df;
  const out = Math.abs(s.df) > GAME.band;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 360"
      role="img"
      aria-label={`The day so far, at ${hour(s.t / 60)}: demand ${mw(s.demand)}, frequency ${f.toFixed(2)} Hz, inside the band ${pct(inBandShare(s))} of the time.`}
    >
      <text className="ax" x={X0} y={14}>
        Demand and generation, MW
      </text>
      <GridY y={yMW} ticks={[0, 400, 800, 1200, 1600]} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      {areas.map((a, k) => (
        <path key={k} d={a.d} fill={a.color} />
      ))}
      <path d={FORECAST_PATH} fill="none" stroke="#777" strokeWidth={1.5} strokeDasharray="5 5" />
      <path d={demand} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      <text className="ax" x={X0} y={226}>
        Frequency, Hz
      </text>
      <rect x={X0} y={yF(60 + GAME.band)} width={X1 - X0} height={yF(60 - GAME.band) - yF(60 + GAME.band)} fill={GRAPHIC.teal} opacity={0.12} />
      <GridY y={yF} ticks={[59.5, 60, 60.5]} x0={X0} x1={X1} format={(v) => v.toFixed(1)} />
      <path d={freq} fill="none" stroke={GRAPHIC.teal} strokeWidth={2} strokeLinejoin="round" />
      <line className="cur" x1={xMin(s.t)} x2={xMin(s.t)} y1={22} y2={330} />
      <circle cx={xMin(s.t)} cy={yF(clampF(f))} r={5} fill={out ? GRAPHIC.red : GRAPHIC.teal} stroke="#f8f8f8" strokeWidth={2} />
      <line className="base" x1={X0} x2={X1} y1={330} y2={330} />
      {[0, 6, 12, 18, 24].map((hh) => (
        <text key={hh} className="ax ax-m" x={xMin(hh * 60)} y={350}>
          {hour(hh)}
        </text>
      ))}
    </svg>
  );
}

function BalancingGame({ onFinish }: { onFinish: (r: RunResult) => void }) {
  const [seed, setSeed] = useState(1);
  const demand = useMemo(() => gameDemand(seed), [seed]);
  const [sp, setSp] = useState<Record<string, number>>(() => initialSetpoints(demand));
  const [agc, setAgc] = useState(false);
  const [speed, setSpeed] = useState<'half' | 'full'>('full');
  const play = usePlay(false);
  const mps = speed === 'full' ? GAME.minutesPerSecond : GAME.minutesPerSecond / 2;
  const [s, setS] = useSimulation<GameState>(() => initialGame(demand), (x, dt) => stepGame(x, sp, agc, dt * mps, demand), play.playing);
  const reported = useRef(false);

  useEffect(() => {
    if (s.done && play.playing) play.setPlaying(false);
    if (s.done && !reported.current) {
      reported.current = true;
      onFinish({ share: inBandShare(s), agcTime: s.agcTime });
    }
  }, [s, play, onFinish]);

  const restart = (d: number[], start: boolean) => {
    setS(initialGame(d));
    setSp(initialSetpoints(d));
    reported.current = false;
    play.setPlaying(start);
  };
  const toggle = () => {
    if (s.done) restart(demand, true);
    else play.toggle();
  };
  const newDay = () => {
    const next = seed + 1;
    setSeed(next);
    restart(gameDemand(next), false);
  };

  const gen = FIXED_MW + GAME.controlled.reduce((a, u) => a + s.out[u.id], 0) + s.agcOut;
  const f = GAME.f0 + s.df;
  const inBand = Math.abs(s.df) <= GAME.band;
  const gap = gen - s.demand;
  let msg: string;
  if (s.done) msg = `Day complete. The frequency stayed inside the band ${pct(inBandShare(s))} of the time${s.agcTime > 0 ? ', with help from AGC' : ''}.`;
  else if (s.t === 0) msg = 'Press play to start the day at midnight. The dashed line is the forecast of demand.';
  else
    msg = `${hour(s.t / 60)}: demand ${mw(s.demand)}, generation ${mw(gen)}. ${
      Math.abs(gap) < 1 ? 'Balanced.' : gap < 0 ? `${mw(-gap)} short, so the frequency sits ${(-s.df).toFixed(2)} Hz low.` : `${mw(gap)} too much, so the frequency sits ${s.df.toFixed(2)} Hz high.`
    }`;

  return (
    <Figure
      name="Grid Balancing Game"
      play={{ playing: play.playing, toggle }}
      actions={
        <>
          <Button onClick={() => restart(demand, false)}>Restart</Button>
          <Button onClick={newDay}>New day</Button>
        </>
      }
    >
      <GameChart s={s} />
      <Legend
        items={[
          ...LAYERS.map((L) => ({ label: L.label, color: L.color })),
          { label: 'Demand', color: '#333', kind: 'line' as const },
          { label: 'Forecast', color: '#777', kind: 'line' as const, dashed: true },
        ]}
      />
      <Readouts
        items={[
          { label: 'frequency', value: `${f.toFixed(2)} Hz`, tone: inBand ? 'teal' : 'red' },
          { label: 'generation − demand', value: `${signed(gap)} MW` },
          { label: 'time inside the band', value: s.elapsed > 0 ? pct(inBandShare(s)) : '—' },
          { label: 'time of day', value: hour(s.t / 60) },
        ]}
      />
      <Controls columns={2}>
        {GAME.controlled.map((u) => (
          <Slider
            key={u.id}
            label={u.name}
            tone={UNIT_TONE[u.id as keyof typeof UNIT_TONE]}
            value={sp[u.id]}
            min={0}
            max={u.capacity}
            step={5}
            onChange={(v) => setSp((x) => ({ ...x, [u.id]: v }))}
            display={`${fmt(sp[u.id])} MW · now ${fmt(s.out[u.id])}`}
          />
        ))}
        <div className="ctl">
          <Checkbox label={`Falls hydro on AGC (now ${fmt(s.agcOut)} MW)`} checked={agc} onChange={setAgc} />
          <Segmented
            label="Game speed"
            value={speed}
            onChange={setSpeed}
            options={[
              { value: 'half', label: 'Half speed' },
              { value: 'full', label: 'Full speed' },
            ]}
          />
        </div>
      </Controls>
      <Caption>{msg}</Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: one disturbance across time scales, on a logarithmic time axis.

const T0 = 0.05;
const T1 = 3600;
const lx = (t: number) => X0 + ((Math.log10(t) - Math.log10(T0)) / (Math.log10(T1) - Math.log10(T0))) * (X1 - X0);
const TIME_TICKS: Array<[number, string]> = [
  [0.1, '0.1 s'],
  [1, '1 s'],
  [10, '10 s'],
  [60, '1 min'],
  [600, '10 min'],
  [3600, '1 h'],
];
const PARTS = [
  { key: 'inertia', label: 'Kinetic energy of spinning machines', color: GRAPHIC.gold },
  { key: 'loadRelief', label: 'Load relief', color: '#a9a9a9' },
  { key: 'governors', label: 'Governors', color: GRAPHIC.teal },
  { key: 'agc', label: 'AGC', color: GRAPHIC.blue },
  { key: 'dispatch', label: 'Dispatch', color: GRAPHIC.green },
] as const;

function TimeScales() {
  const sc = useScenario('time-scales', { step: 50, governors: true, agc: true, dispatch: true });
  const { step, governors, agc, dispatch } = sc.state;
  const samples = useMemo(() => stepResponse(ISLAND, step, { governors, agc, dispatch }), [step, governors, agc, dispatch]);
  const sum = summarizeStep(samples);
  const xs = samples.map((p) => lx(p.t));

  const fLo = Math.min(59.5, Math.floor((sum.nadir - 0.05) * 10) / 10);
  const fHi = Math.max(60.1, Math.ceil(Math.max(...samples.map((p) => p.f)) * 10 + 0.5) / 10);
  const yf = scale(fLo, fHi, 176, 26);
  const fTicks = niceTicks(fLo, fHi, 4).filter((v) => v <= 60);

  // Diverging stack: positive parts upward from zero, negative parts downward.
  let pos = samples.map(() => 0);
  let neg = samples.map(() => 0);
  const bands = PARTS.map((part) => {
    const v = samples.map((p) => p[part.key]);
    const upTop = pos.map((b, k) => b + Math.max(0, v[k]));
    const dnBot = neg.map((b, k) => b + Math.min(0, v[k]));
    const res = { upper: upTop, lower: pos, nUpper: neg, nLower: dnBot, color: part.color };
    pos = upTop;
    neg = dnBot;
    return res;
  });
  const top = Math.max(step * 1.05, ...pos);
  const bot = Math.min(0, ...neg);
  const yc = scale(bot, top, 176, 26);
  const cTicks = [0, Math.round(step / 2), step];

  const restoredMin = sum.restored === null ? null : sum.restored / 60;
  const fAxis = (
    <>
      <line className="base" x1={X0} x2={X1} y1={176} y2={176} />
      {TIME_TICKS.map(([t, l]) => (
        <g key={t}>
          <line className="gl" x1={lx(t)} x2={lx(t)} y1={26} y2={176} />
          <text className="ax ax-m" x={lx(t)} y={194}>
            {l}
          </text>
        </g>
      ))}
    </>
  );
  let msg: string;
  if (!governors) msg = `With no governors, only the load itself pushes back, and the frequency sinks to ${sum.nadir.toFixed(2)} Hz. A real grid would already be disconnecting customers below 59.3 Hz.`;
  else if (restoredMin === null) msg = `The governors hold the frequency at ${sum.at30.toFixed(2)} Hz, but with nothing to restore it, it stays there.`;
  else msg = `The frequency bottoms out at ${sum.nadir.toFixed(2)} Hz after ${sum.nadirT.toFixed(1)} seconds, and is back within 0.01 Hz of 60 after ${fmt(restoredMin, 1)} minutes.`;

  return (
    <Figure name="Grid Balancing Game · time scales" scenario={sc}>
      <svg className="chart" viewBox="0 0 640 200" role="img" aria-label={`Island frequency after a sudden ${step} MW rise in demand, on a logarithmic time axis. Lowest point ${sum.nadir.toFixed(2)} Hz.`}>
        <text className="ax" x={X0} y={14}>
          Frequency, Hz
        </text>
        <GridY y={yf} ticks={fTicks} x0={X0} x1={X1} format={(v) => (Number.isInteger(v) ? String(v) : v.toFixed(2))} />
        {fLo < 59.3 && (
          <g>
            <line x1={X0} x2={X1} y1={yf(59.3)} y2={yf(59.3)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="5 4" />
            <text className="ax ax-e" x={X1} y={yf(59.3) - 5}>
              59.3 Hz: load shedding would begin
            </text>
          </g>
        )}
        {fAxis}
        <path d={linePath(xs, samples.map((p) => yf(Math.max(fLo, Math.min(fHi, p.f)))))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} strokeLinejoin="round" />
        <circle cx={lx(Math.max(T0, sum.nadirT))} cy={yf(Math.max(fLo, sum.nadir))} r={5} fill={GRAPHIC.teal} stroke="#f8f8f8" strokeWidth={2} />
      </svg>
      <svg className="chart" viewBox="0 0 640 200" role="img" aria-label={`Where the extra ${step} MW comes from over time: kinetic energy first, then governors, then AGC and dispatch.`}>
        <text className="ax" x={X0} y={14}>
          Where the extra {step} MW comes from
        </text>
        <GridY y={yc} ticks={cTicks} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
        {bands.map((b, k) => (
          <g key={k}>
            <path d={areaPath(xs, b.upper.map(yc), b.lower.map(yc))} fill={b.color} opacity={0.85} />
            <path d={areaPath(xs, b.nUpper.map(yc), b.nLower.map(yc))} fill={b.color} opacity={0.85} />
          </g>
        ))}
        <line x1={X0} x2={X1} y1={yc(step)} y2={yc(step)} stroke="#333" strokeWidth={1.2} strokeDasharray="5 4" />
        {fAxis}
      </svg>
      <Legend items={PARTS.map((p) => ({ label: p.label, color: p.color }))} />
      <Readouts
        items={[
          { label: 'lowest frequency', value: `${sum.nadir.toFixed(2)} Hz`, tone: 'teal' },
          { label: 'after 30 seconds', value: `${sum.at30.toFixed(2)} Hz` },
          { label: 'back to 60 Hz after', value: restoredMin === null ? 'never' : `${fmt(restoredMin, 1)} min` },
        ]}
      />
      <Slider label="Sudden extra demand" value={step} min={10} max={100} step={5} onChange={(v) => sc.set({ step: v })} display={mw(step)} />
      <div className="ctl" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 20px' }}>
        <Checkbox label="Governors" checked={governors} onChange={(v) => sc.set({ governors: v })} />
        <Checkbox label="AGC" checked={agc} onChange={(v) => sc.set({ agc: v })} />
        <Checkbox label="Dispatch" checked={dispatch} onChange={(v) => sc.set({ dispatch: v })} />
      </div>
      <Caption>{msg}</Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

const KE = kineticEnergy(ISLAND);
const BETA = islandBeta(GAME, ISLAND.loadMW);
const GOV_PER_HZ = GAME.governorMW / (GAME.droop * GAME.f0);
const TARGET = 0.8;

export default function Lesson() {
  const [best, setBest] = useState<number | null>(null);
  const [lastAgc, setLastAgc] = useState(false);
  const onFinish = (r: RunResult) => {
    setLastAgc(r.agcTime > 0);
    if (r.agcTime === 0) setBest((b) => (b === null ? r.share : Math.max(b, r.share)));
  };
  const solved = best !== null && best >= TARGET;

  return (
    <LessonPage id="3.1">
      <P>
        Chapter 2 built a grid: nine power plants, six substations and eight high-voltage lines joining them. Building it was the easy part. Running it means obeying one rule that
        sounds almost too simple to matter: at every instant, the power flowing into the grid must equal the power flowing out of it.
      </P>
      <P>
        The rule is strict because the grid stores almost nothing. A water network has reservoirs and a gas network can pack extra gas into its pipes, but wires hold no stock of
        electricity. (Batteries and pumped hydro can save energy for later, as Lesson 3.4 will show, but they’re plants connected to the grid, not part of it.) The only store in the
        grid itself is the motion of the generators. Most large generators on an AC grid are heavy spinning machines, and every one of
        them turns in step with the grid’s <K c="frequency">frequency</K>, which in North America is 60 cycles per second.
      </P>
      <P>
        That motion is the grid’s only buffer. When customers draw more power than the plants supply, the difference comes out of the machines’ kinetic{' '}
        <K c="energy">energy</K>: they slow down, and the frequency falls. When the plants supply more than customers draw, the machines speed up and the frequency rises. So
        frequency is a live readout of the balance, visible everywhere on the grid at once — and keeping it steady is the first job of everyone who operates one.
      </P>
      <P>
        Let’s try that job. For this lesson we’ll pretend the course region is an electrical island, with no neighbors to lean on. Below is a day in the region compressed into
        about two and a half minutes. Harbor Point nuclear runs at a steady 400 MW, Ironwood coal at 250 MW and Falls hydro at 75 MW. You control the three gas plants. Each slider
        sets a plant’s <b>setpoint</b> — the output you ask for — and the plant moves toward it no faster than its ramp rate: 200 MW per hour for Lakeside and Eastgate, 150 for
        Mill Creek. Demand wanders around the dashed forecast. Press play, and keep the frequency inside the shaded band, within 0.1 Hz of 60:
      </P>

      <BalancingGame onFinish={onFinish} />

      <P>
        The first thing you probably noticed is that you can’t wait for trouble. A plant takes time to reach a new setpoint, so by the time the frequency drifts out of the band it’s
        too late to start moving. The morning climb is the hardest stretch: demand rises by as much as 120 MW in an hour between 06:00 and 07:00, and in the evening it falls even
        faster, by 165 MW between 21:00 and 22:00. The trick is to steer by the forecast — set each plant where demand is going, not where it is.
      </P>
      <P>
        The second is how sensitive the frequency is. A mismatch of about {fmt(BETA / 10)} MW — around {pct(BETA / 10 / ISLAND.loadMW)} of midday demand — is enough to push it
        out of the band. That sensitivity is set by the plants themselves, as we’ll see in a moment.
      </P>

      <Challenge
        id="a"
        question={`With AGC switched off, finish a whole day with the frequency inside the band at least ${pct(TARGET)} of the time.`}
        solved={solved}
        status={
          best === null
            ? lastAgc
              ? 'That run used AGC. Switch it off and play a full day by hand.'
              : 'Play a full day, from midnight to midnight, with AGC off.'
            : `Your best day by hand so far: ${pct(best)} inside the band.`
        }
        success={`Solved: ${pct(best ?? 0)} of the day inside the band. Leading the forecast by a quarter of an hour or so, and moving the cheapest plant first, does most of the work.`}
      />

      <H2>Seconds, minutes, hours</H2>
      <P>
        The game compresses a day so much that ten minutes pass every second. At that speed you can’t see what happens in the first moments after demand changes, so let’s slow
        down. Here’s the same island at midday, with Harbor Point, Ironwood, Lakeside, Mill Creek and Falls hydro running — {fmt(ISLAND.onlineMW)} MW of spinning machines — when
        demand suddenly rises, as if a large factory had switched on all at once. The time axis is logarithmic: each step along it is ten times longer than the last:
      </P>

      <TimeScales />

      <P>
        In the first instant, nothing has had time to react, and every one of the extra megawatts comes from the kinetic energy of the spinning machines — the gold band. The more
        rotating mass the grid has, its <b>inertia</b>, the more slowly the frequency falls. But there isn’t much to draw on. The machines online here store about{' '}
        {fmt(KE)} megajoules at full speed, or {fmt(KE / 3600, 1)} MWh: if all of it could be spent, which it can’t, it would carry the island’s {fmt(ISLAND.loadMW)} MW of demand for{' '}
        {fmt(KE / ISLAND.loadMW, 1)} seconds.
      </P>
      <P>
        Within a second or two, the plants’ <b>governors</b> take over. A governor watches its machine’s speed and opens the steam, gas or water valve wider as the frequency falls.
        Each is set with a <b>droop</b>: with a 5 percent droop, a governor would swing its plant’s output across its full range over a 5 percent change in frequency, 3 Hz. The{' '}
        {fmt(GAME.governorMW)} MW of plant with governors here therefore adds {fmt(GOV_PER_HZ)} MW for every hertz the frequency falls, and the load itself adds a little more,
        because motors draw less power when they turn more slowly:
      </P>
      <Eq label="The island's frequency response">
        <Tn tone="teal">Δf</Tn>
        <Op>=</Op>
        <Frac top={<span>mismatch, MW</span>} bottom={<span>{fmt(BETA)} MW per Hz</span>} />
      </Eq>
      <P>
        Notice what the governors don’t do: they stop the fall, but they don’t bring the frequency back to 60 Hz. They can’t, by design. Each governor responds in proportion to the
        frequency error, so hundreds of plants share the job without fighting over it, but the error has to persist for them to keep responding.
      </P>
      <P>
        Restoring the frequency is the job of <K tone="blue">automatic generation control</K>, or AGC: a program in the operator’s control center that measures the error every
        few seconds and sends raise and lower signals to a handful of plants set aside for regulation. Over a few minutes it brings the frequency back to 60 Hz and lets the
        governors relax. Then, a few minutes later, comes the slowest layer. <K tone="green">Dispatch</K> — the schedule worked out ahead of time and updated every five minutes in
        many markets — moves the extra load to whichever plant can serve it most cheaply, which frees the regulating plants to face the next surprise.
      </P>
      <P>
        Switch each layer off in turn to see what it does. Without governors the frequency keeps sliding for half a minute and ends far below anything a real grid would tolerate;
        without AGC it sits low until the next dispatch run. Then scroll back to the game and tick <b>Falls hydro on AGC</b>: the minute-to-minute wobbles mostly disappear, and
        what’s left for you is the work of the hours — following the shape of the day.
      </P>
      <P>
        All of this assumed an island. In reality, our region is part of a much larger synchronous interconnection, and its frequency is shared with every plant and customer in it.
        In the next lesson we’ll see what that sharing buys, and what happens in the first seconds after a power plant suddenly disappears.
      </P>
    </LessonPage>
  );
}
