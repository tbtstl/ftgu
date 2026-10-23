import { useState } from 'react';
import {
  Challenge,
  Eq,
  Figure,
  Frac,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  PHASE,
  Readouts,
  Segmented,
  Slider,
  Sub,
  fmt,
  linePath,
  mix,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../framework';
import { generatorEmf, synchronousRpm, type GeneratorInput } from '../../engines/physics/machines';
import { PHASE_OFFSETS_RAD, advanceRotor, coilAgo, statorTeeth } from '../../engines/physics/stator';

const SLOW = 120; // the animation runs 120× slower than real time, as in Lesson 1.2
const WINDOW_S = 0.05; // the traces show the last 50 ms of real time
const AREA = 0.02; // m² enclosed by each turn of the coil
const GRID_HZ = 60;

// Machine geometry (viewBox units).
const CX = 134;
const CY = 134;
const R_TOOTH = 60; // inner face of the stator teeth
const R_RING_IN = 98;
const R_RING_OUT = 114;
const IRON = '#dadada';

// Trace geometry: x0 is "now", x1 is 50 ms ago.
const X0 = 300;
const X1 = 620;
const HALF = 100;
/** Vertical scales for the voltage trace; the smallest that fits the peak is used. */
const RANGES = [100, 250, 500, 1000, 2500];

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Samples fn(age in seconds) across the 50 ms window. */
function trace(fn: (ageSec: number) => number, n = 150) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    xs.push(X0 + (i / n) * (X1 - X0));
    ys.push(fn((i / n) * WINDOW_S));
  }
  return linePath(xs, ys);
}

interface Coil {
  angleRad: number;
  color: string;
  turns: number;
  label?: string;
}

/** A cross-section of the generator: stator ring, wound teeth and a rotor with 2·polePairs poles. */
function Machine({ rotorRad, polePairs, field, coils }: { rotorRad: number; polePairs: number; field: number; coils: Coil[] }) {
  const toothW = polePairs > 1 ? 18 : 26;
  const armW = polePairs > 1 ? 20 : 26;
  const arms = Array.from({ length: 2 * polePairs }, (_, k) => ({ a: rotorRad + (k * Math.PI) / polePairs, north: k % 2 === 0 }));
  const nFill = mix('#d2d2d2', '#4a4a4a', 0.25 + 0.75 * field);
  const sFill = mix('#eeeeee', '#a6a6a6', 0.25 + 0.75 * field);
  const span = R_RING_IN - R_TOOTH - 10;
  return (
    <g>
      <circle cx={CX} cy={CY} r={(R_RING_IN + R_RING_OUT) / 2} fill="none" stroke={IRON} strokeWidth={R_RING_OUT - R_RING_IN} />
      {coils.map((c, i) => (
        <g key={i} transform={`rotate(${-deg(c.angleRad)} ${CX} ${CY})`}>
          <rect x={CX + R_TOOTH} y={CY - toothW / 2} width={R_RING_IN - R_TOOTH + 2} height={toothW} fill={IRON} />
          {Array.from({ length: c.turns }, (_, j) => {
            const x = CX + R_TOOTH + 5 + ((j + 0.5) * span) / c.turns;
            return <line key={j} x1={x} y1={CY - toothW / 2 - 4} x2={x} y2={CY + toothW / 2 + 4} stroke={c.color} strokeWidth={2.4} strokeLinecap="round" />;
          })}
        </g>
      ))}
      {coils.map(
        (c, i) =>
          c.label && (
            <text key={i} className="ax ax-m" x={CX + 126 * Math.cos(c.angleRad)} y={CY - 126 * Math.sin(c.angleRad) + 4}>
              {c.label}
            </text>
          ),
      )}
      {arms.map((arm, k) => (
        <rect
          key={k}
          transform={`rotate(${-deg(arm.a)} ${CX} ${CY})`}
          x={CX}
          y={CY - armW / 2}
          width={R_TOOTH - 7}
          height={armW}
          rx={4}
          fill={arm.north ? nFill : sFill}
        />
      ))}
      <circle cx={CX} cy={CY} r={9} fill="#8c8c8c" />
      {arms.map((arm, k) => (
        <text
          key={k}
          x={CX + 38 * Math.cos(arm.a)}
          y={CY - 38 * Math.sin(arm.a) + 4.5}
          textAnchor="middle"
          style={{ fontSize: 13, fontWeight: 600, fill: arm.north ? '#fff' : '#444' }}
        >
          {arm.north ? 'N' : 'S'}
        </text>
      ))}
    </g>
  );
}

/** Axes for a voltage trace with a ±range scale. */
function TraceAxes({ range }: { range: number }) {
  return (
    <g>
      <line className="base" x1={X0} y1={CY - HALF} x2={X0} y2={CY + HALF} />
      <line className="base" x1={X0} y1={CY} x2={X1} y2={CY} />
      <text className="ax ax-e" x={X0 - 6} y={CY - HALF + 4}>
        +{fmt(range)} V
      </text>
      <text className="ax ax-e" x={X0 - 6} y={CY + 4}>
        0
      </text>
      <text className="ax ax-e" x={X0 - 6} y={CY + HALF + 4}>
        −{fmt(range)} V
      </text>
      <text className="ax ax-m" x={X0} y={CY + HALF + 24}>
        now
      </text>
      <text className="ax ax-m" x={(X0 + X1) / 2} y={CY + HALF + 24}>
        25 ms ago
      </text>
      <text className="ax ax-e" x={X1} y={CY + HALF + 24}>
        50 ms ago
      </text>
    </g>
  );
}

export default function Lesson() {
  const play = usePlay(true);
  const g = useScenario('generator', { field: 0.5, rpm: 1800, turns: 100 });
  const tp = useScenario('three-phase', { poles: '2' as '2' | '4' });

  const input1: GeneratorInput = { turns: g.state.turns, fieldTesla: g.state.field, areaM2: AREA, rpm: g.state.rpm };
  const e1 = generatorEmf(input1);
  const poles = Number(tp.state.poles);
  const rpm2 = synchronousRpm(GRID_HZ, poles);
  const input2: GeneratorInput = { turns: 100, fieldTesla: 0.5, areaM2: AREA, rpm: rpm2, polePairs: poles / 2 };
  const e2 = generatorEmf(input2);

  // Rotor angles are integrated frame by frame, so changing a speed never makes a rotor jump.
  const [rot, setRot] = useState({ a: 0, b: 0 });
  useAnimationFrame((dt) => {
    const s = dt / SLOW;
    setRot((r) => ({ a: advanceRotor(r.a, input1.rpm, s), b: advanceRotor(r.b, input2.rpm, s) }));
  }, play.playing);

  // First figure: one coil (phase A, on the teeth at 0° and 180°).
  const range1 = RANGES.find((r) => r >= e1.peakVolts - 1e-9) ?? RANGES[RANGES.length - 1];
  const vy1 = (v: number) => CY - (v / range1) * HALF;
  const fluxY = (phi: number) => CY - (phi / AREA) * 90; // 90 px per tesla of flux density through the coil
  const emfLine = trace((age) => vy1(coilAgo(input1, rot.a, age).emf));
  const fluxLine = trace((age) => fluxY(coilAgo(input1, rot.a, age).flux));
  const now1 = coilAgo(input1, rot.a, 0);
  const shown = Math.max(1, Math.round(g.state.turns / 20));
  const coils1: Coil[] = [
    { angleRad: 0, color: '#4590ce', turns: shown },
    { angleRad: Math.PI, color: '#4590ce', turns: shown },
  ];

  const f1 = e1.freqHz;
  const peak1 = Math.round(e1.peakVolts);
  const rms1 = Math.round(e1.rmsVolts);
  const solved = Math.abs(f1 - GRID_HZ) < 1e-9 && Math.abs(e1.rmsVolts - 240) < 0.5;

  // Second figure: three phases, rotor speed locked to 60 Hz.
  const range2 = 500;
  const vy2 = (v: number) => CY - (v / range2) * HALF;
  const coils2: Coil[] = statorTeeth(poles / 2).map((t) => ({ angleRad: t.angleRad, color: PHASE[t.phase], turns: 5, label: 'ABC'[t.phase] }));
  const phaseLines = PHASE_OFFSETS_RAD.map((o) => trace((age) => vy2(coilAgo(input2, rot.b, age, o).emf)));
  const phaseNow = PHASE_OFFSETS_RAD.map((o) => coilAgo(input2, rot.b, 0, o).emf);

  return (
    <LessonPage id="1.3">
      <P>
        The previous lesson pictured an alternating voltage as the shadow of an arrow turning in a circle. That picture is closer to the truth than it might seem. Almost
        all of the grid’s electricity comes from machines that turn: a shaft spins a magnet inside a ring of coiled wire, and the coils produce a voltage that rises and
        falls with every turn. To see why, we need one discovery about magnets and wires.
      </P>
      <P>
        Push a magnet into a coil of wire and a voltage appears between the coil’s ends. Hold the magnet still and the voltage disappears, however strong the magnet is.
        Pull it out again and the voltage returns, pointing the other way. What creates the voltage isn’t the magnetic field itself but the field changing. Michael
        Faraday discovered this in 1831, and it’s called electromagnetic induction.
      </P>
      <P>
        To make this precise, we measure how much field passes through the coil. The magnetic <b>flux</b> through one turn of wire, written Φ, is the strength of the
        field, measured in teslas, multiplied by the area the turn encloses — counting only the part of the field that passes straight through it. Faraday’s law says
        that the voltage induced in a coil, traditionally called its electromotive force or emf, is the number of turns times the rate at which the flux through each turn
        changes:
      </P>
      <Eq label="Induced voltage equals the number of turns times the rate of change of flux">
        <K c="voltage">emf</K>
        <Op>=</Op>
        <span>N</span>
        <Op>×</Op>
        <Frac top="ΔΦ" bottom="Δt" />
      </Eq>
      <P>
        Each turn adds its own share, so a coil with 100 turns produces 100 times the voltage of a single loop. And the faster the flux changes, the larger the voltage: a
        magnet pushed in quickly produces a bigger voltage, for a shorter time, than one pushed in slowly.
      </P>
      <P>
        A generator puts this law to work without pause. In the demonstration below, a magnet on a shaft — the <b>rotor</b> — turns inside a stationary iron frame called
        the <b>stator</b>. A coil is wound around the two iron teeth on either side of the rotor, so the magnet’s flux passes straight through it whenever the magnet points
        sideways. On the right, the solid line traces the <K c="voltage">voltage</K> across the coil, and the dashed line the flux through it. As in the previous lesson,
        everything is slowed down 120 times. Change the strength of the magnet, how fast it turns, and the number of turns in the coil:
      </P>

      <Figure name="Generator Simulator" scenario={g} play={play}>
        <svg
          className="diagram"
          viewBox="0 0 640 268"
          role="img"
          aria-label={`A two-pole magnet turning at ${fmt(g.state.rpm)} rpm inside a stator with a ${g.state.turns}-turn coil. The coil’s voltage alternates at ${fmt(f1)} Hz with a peak of ${fmt(peak1)} V.`}
        >
          <Machine rotorRad={rot.a} polePairs={1} field={g.state.field} coils={coils1} />
          <TraceAxes range={range1} />
          <path d={fluxLine} fill="none" stroke="#9a9a9a" strokeWidth={1.8} strokeDasharray="5 5" />
          <path d={emfLine} fill="none" stroke="#2f6fb3" strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={X0} cy={fluxY(now1.flux)} r={3.5} fill="#9a9a9a" />
          <circle cx={X0} cy={vy1(now1.emf)} r={4.5} fill="#2f6fb3" />
        </svg>
        <Legend
          items={[
            { label: 'Voltage across the coil', color: '#2f6fb3', kind: 'line' },
            { label: 'Flux through the coil', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'frequency', value: `${fmt(f1)} Hz`, tone: 'teal' },
            { label: 'peak voltage', value: `${fmt(peak1)} V`, tone: 'blue' },
            { label: 'RMS voltage', value: `${fmt(rms1)} V` },
          ]}
        />
        <Slider
          label="Magnetic field"
          value={g.state.field}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => g.set({ field: v })}
          display={`${g.state.field.toFixed(2)} T`}
        />
        <Slider
          label="Rotation speed"
          tone="teal"
          value={g.state.rpm}
          min={0}
          max={4800}
          step={60}
          onChange={(v) => g.set({ rpm: v })}
          display={`${fmt(g.state.rpm)} rpm`}
        />
        <Slider label="Turns in the coil" value={g.state.turns} min={10} max={200} step={10} onChange={(v) => g.set({ turns: v })} display={`${g.state.turns} turns`} />
        <Eq label="Peak voltage of the generator">
          <K c="voltage">
            V<Sub>peak</Sub>
          </K>
          <Op>=</Op>
          <span>{g.state.turns}</span>
          <Op>×</Op>
          <span>{g.state.field.toFixed(2)} T</span>
          <Op>×</Op>
          <span>0.02 m²</span>
          <Op>×</Op>
          <K c="frequency">2π × {fmt(f1)} Hz</K>
          <Op>=</Op>
          <K c="voltage">{fmt(peak1)} V</K>
        </Eq>
      </Figure>

      <P>
        Watch the timing first. The flux through the coil is greatest when the magnet points straight at it, yet at that moment the voltage is zero: for an instant, the
        flux isn’t changing. The voltage peaks a quarter of a turn later, when the magnet lies across the coil and the flux, passing through zero, changes fastest. The flux
        of a steadily turning magnet rises and falls just like the shadow in Lesson 1.2, and the voltage follows it a quarter of a cycle behind. A spinning magnet makes
        alternating current all by itself.
      </P>
      <P>
        Now the sliders. A stronger magnet gives the coil more flux to reverse, every extra turn adds its share, and a faster rotor reverses the flux in less time — so all
        three raise the voltage in proportion. The equation under the demonstration multiplies them together, along with the area of each turn, 0.02 square meters here,
        and 2π times the <K c="frequency">frequency</K>, which is how fast the rotor sweeps through angle. At the starting settings, that comes to a peak of 188 volts.
        (The trace’s vertical scale steps up whenever the voltage outgrows it, so keep an eye on its labels.)
      </P>
      <P>
        Only one of the three changes the frequency, though. Each turn of the rotor carries its north pole past the coil once and makes one full cycle, so a rotor turning
        1,800 times a minute — 30 times a second — produces 30 Hz. Double the speed to 3,600 rpm and you double both the frequency and the voltage, to 60 Hz and 377
        volts.
      </P>

      <Challenge
        id="a"
        question="Make the generator produce exactly 60 Hz at 240 volts RMS — the voltage that the large appliances in an American home run on."
        solved={solved}
        status={`Right now it produces ${fmt(f1)} Hz at ${fmt(rms1)} V RMS.`}
        success={`Solved. ${fmt(g.state.rpm)} rpm is 60 turns a second, which makes 60 Hz, and ${g.state.turns} turns in a ${g.state.field.toFixed(2)}-tesla field give a peak of ${fmt(peak1)} V: ${fmt(rms1)} V RMS.`}
      />

      <H2>Three coils, three phases</H2>
      <P>
        So far the stator has carried a single coil, and most of its iron has done nothing. Wind two more coils around it, each a third of a turn — 120° — further round the
        stator than the last, and the passing magnet reaches each one in turn. Below, the three coils are labeled A, B and C and colored like the phases in Lesson 1.2, and
        the rotor turns at whatever speed makes 60 Hz. Leave it on two poles for now:
      </P>

      <Figure name="Generator Simulator · three phases" scenario={tp} play={play}>
        <Segmented
          label="Poles on the rotor"
          value={tp.state.poles}
          onChange={(p) => tp.set({ poles: p })}
          options={[
            { value: '2', label: 'Two poles' },
            { value: '4', label: 'Four poles' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 268"
          role="img"
          aria-label={`A ${poles}-pole rotor turning at ${fmt(rpm2)} rpm inside a stator with three sets of coils. Each coil produces a 60 Hz voltage, a third of a cycle behind the one before.`}
        >
          <Machine rotorRad={rot.b} polePairs={poles / 2} field={0.5} coils={coils2} />
          <TraceAxes range={range2} />
          {[2, 1, 0].map((k) => (
            <path key={k} d={phaseLines[k]} fill="none" stroke={PHASE[k]} strokeWidth={2.5} strokeLinejoin="round" />
          ))}
          {phaseNow.map((v, k) => (
            <circle key={k} cx={X0} cy={vy2(v)} r={4} fill={PHASE[k]} />
          ))}
        </svg>
        <Legend
          items={[
            { label: 'Coil A', color: PHASE[0], kind: 'line' },
            { label: 'Coil B', color: PHASE[1], kind: 'line' },
            { label: 'Coil C', color: PHASE[2], kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'rotor speed', value: `${fmt(rpm2)} rpm` },
            { label: 'turns per second', value: fmt(rpm2 / 60) },
            { label: 'frequency', value: `${fmt(e2.freqHz)} Hz`, tone: 'teal' },
          ]}
        />
        <Eq label="Rotor speed needed for a given frequency">
          <span>rotor speed</span>
          <Op>=</Op>
          <Frac
            top={
              <>
                120 × <K c="frequency">f</K>
              </>
            }
            bottom="poles"
          />
          <Op>=</Op>
          <Frac
            top={
              <>
                120 × <K c="frequency">{GRID_HZ} Hz</K>
              </>
            }
            bottom={poles}
          />
          <Op>=</Op>
          <span>{fmt(rpm2)} rpm</span>
        </Eq>
      </Figure>

      <P>
        Three voltages appear, each a third of a cycle behind the one before: exactly the balanced three-phase supply of Lesson 1.2, made with no extra machinery. This is
        the natural fit that lesson ended on. Three coils make better use of the stator’s iron and copper than one, and because the three phases together deliver a
        steady total power, the shaft feels a smooth, constant load instead of a pulsing one. Almost every large generator on the grid is built this way.
      </P>

      <H2>Why generators turn at fixed speeds</H2>
      <P>
        In the first demonstration, frequency and speed were locked together, and that has a striking consequence for power plants. The frequency of the grid is fixed —
        60 Hz in North America — so every generator connected to it must turn at exactly the speed that produces 60 Hz, and the plant must hold it there. Chapter 3 shows
        what happens when it can’t.
      </P>
      <P>
        The speed needed depends on the rotor’s poles. Switch the demonstration above to four poles. The rotor now has two north poles and two south poles, so a north pole
        passes each coil twice every turn, and the rotor only has to turn half as fast — 1,800 rpm — to keep producing 60 Hz. The stator gets twice as many coils to match,
        but the three waveforms don’t change at all. The equation under the demonstration gives the speed for any number of poles.
      </P>
      <P>
        Large steam and gas turbines in North America typically drive two-pole generators at 3,600 rpm, while many nuclear plants, with their larger and slower turbines,
        use four poles at 1,800 rpm. Water turbines turn more slowly still, so hydroelectric generators have dozens of poles: with 40, the rotor turns at just 180 rpm. On
        50 Hz grids, the same two- and four-pole machines turn at 3,000 and 1,500 rpm.
      </P>
      <P>
        With its speed fixed, a generator can change its voltage only through its magnetic field. In a real generator the rotor isn’t a permanent magnet but an
        electromagnet, fed with a direct current that a voltage regulator raises or lowers to hold the voltage where it should be. This current is called the excitation,
        and adjusting it is exactly what you did with the field slider in the challenge.
      </P>

      <H2>Where the energy comes from</H2>
      <P>
        A generator doesn’t make energy; it converts it. With nothing connected to its coils, the rotor spins with little resistance. Connect a load and current flows in
        the stator coils, and that current makes a magnetic field of its own that pulls back on the rotor’s, opposing its motion. The more <K c="power">power</K> the load
        draws, the harder something has to push to keep the shaft turning at speed.
      </P>
      <P>
        That push comes from whatever turns the shaft: steam raised by burning coal or gas or by a nuclear reactor, hot combustion gases in a gas turbine, falling water,
        or the wind. A large generator converts this mechanical power into electrical power while losing only around 1–2% of it as heat. If the load ever takes more
        power than the shaft is given, the difference comes out of the rotor’s own motion and it begins to slow down — which is why, as we’ll see in Chapter 3, the grid’s
        frequency is a running measure of the balance between supply and demand.
      </P>
      <P>
        Solar panels are the main exception to all of this. They produce direct current with no moving parts, and connect to the grid through power electronics called
        inverters; batteries connect the same way. Most modern wind turbines connect partly or wholly through power electronics too: their blades turn at a speed that
        varies with the wind, and the electronics let the generator follow it instead of being locked to the grid’s frequency.
      </P>
      <P>
        A generator’s coils can only be insulated for so much voltage, so the large generators in power plants produce somewhere between about 13.8 and 25 kilovolts.
        That’s far too low for sending power hundreds of kilometers, and far too high for a toaster. Converting between voltages is the job of the transformer, which uses
        the same law of induction with no moving parts at all. That’s the next lesson.
      </P>
    </LessonPage>
  );
}
