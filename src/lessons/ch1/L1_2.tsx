import { useState } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
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
  lessonHref,
  linePath,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../framework';
import { phasorSumMagnitude, rmsFromPeak } from '../../engines/physics/ac';

const SLOW = 120; // the animation runs 120× slower than real time
const WINDOW_MS = 40;
const K_V = 100 / 340; // px per volt in the waveform figures
const SOCKET_PEAK = 170; // the US wall socket's peak, where the waveform demonstration starts
const VOLTAGE = '#2f6fb3';

/** Samples fn(age in ms) across the 40 ms window; x0 is "now", x1 is 40 ms ago. */
function trace(fn: (ageMs: number) => number, x0: number, x1: number, n = 120) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    xs.push(x0 + (i / n) * (x1 - x0));
    ys.push(fn((i / n) * WINDOW_MS));
  }
  return linePath(xs, ys);
}

/** The challenge: the European supply, 230 V RMS (to the nearest volt) at 50 Hz. */
export function europeSolved(freqHz: number, peakVolts: number) {
  return freqHz === 50 && Math.round(rmsFromPeak(peakVolts)) === 230;
}

/** Peak of the sum of three equal phases spaced `spacingDeg` apart, as a multiple of one phase. */
export function threePhaseSumPeak(spacingDeg: number) {
  const s = (spacingDeg * Math.PI) / 180;
  return phasorSumMagnitude([0, -s, -2 * s]);
}

/** Rotating arrows on the left and the voltages they trace on the right, with an optional dashed sum. */
function Phasors({
  t,
  freqHz,
  peak,
  offsets,
  colors,
  reference,
  sum,
  label,
}: {
  t: number;
  freqHz: number;
  peak: number;
  offsets: number[];
  colors: string[];
  reference?: boolean;
  sum?: boolean;
  label: string;
}) {
  const omega = (2 * Math.PI * freqHz) / 1000; // rad per ms
  const r = peak * K_V;
  const arrows = offsets.map((o, k) => {
    const th = omega * t + o;
    return {
      d: trace((age) => 130 - r * Math.sin(omega * (t - age) + o), 260, 620),
      tx: 130 + r * Math.cos(th),
      ty: 130 - r * Math.sin(th),
      col: colors[k],
    };
  });
  const ghost = reference ? trace((age) => 130 - r * Math.sin(omega * (t - age)), 260, 620) : null;
  const total = sum ? trace((age) => 130 - r * offsets.reduce((acc, o) => acc + Math.sin(omega * (t - age) + o), 0), 260, 620) : null;
  return (
    <svg className="diagram" viewBox="0 0 640 262" role="img" aria-label={label}>
      <circle cx={130} cy={130} r={100} fill="none" stroke="#dedede" strokeDasharray="3 4" />
      <circle cx={130} cy={130} r={r} fill="none" stroke="#cfcfcf" strokeWidth={1.5} />
      <line className="base" x1={20} y1={130} x2={240} y2={130} />
      <line className="base" x1={260} y1={30} x2={260} y2={230} />
      <line className="base" x1={260} y1={130} x2={620} y2={130} />
      <text className="ax ax-e" x={254} y={34}>
        +340 V
      </text>
      <text className="ax ax-e" x={254} y={134}>
        0
      </text>
      <text className="ax ax-e" x={254} y={234}>
        −340 V
      </text>
      <text className="ax ax-m" x={260} y={252}>
        now
      </text>
      <text className="ax ax-m" x={440} y={252}>
        20 ms ago
      </text>
      <text className="ax ax-e" x={620} y={252}>
        40 ms ago
      </text>
      {ghost && <path d={ghost} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 5" />}
      {[...arrows].reverse().map((p, i) => (
        <path key={i} d={p.d} fill="none" stroke={p.col} strokeWidth={2.5} strokeLinejoin="round" />
      ))}
      {total && <path d={total} fill="none" stroke="#333" strokeWidth={2} strokeDasharray="7 5" />}
      {arrows.map((p, i) => (
        <g key={i}>
          <line x1={p.tx} y1={p.ty} x2={260} y2={p.ty} stroke={p.col} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.75} />
          <line x1={130} y1={130} x2={p.tx} y2={p.ty} stroke={p.col} strokeWidth={3} strokeLinecap="round" />
          <circle cx={p.tx} cy={p.ty} r={5} fill={p.col} />
          <circle cx={260} cy={p.ty} r={4} fill={p.col} />
        </g>
      ))}
      <circle cx={130} cy={130} r={3.5} fill="#444" />
    </svg>
  );
}

export default function Lesson() {
  const play = usePlay(true);
  const [t, setT] = useState(0); // simulated time, ms
  useAnimationFrame((dt) => setT((x) => x + (dt * 1000) / SLOW), play.playing);

  const w = useScenario('waveform', { f: 60, amp: SOCKET_PEAK, phase: 0 });
  const { f, amp, phase } = w.state;
  const solved = europeSolved(f, amp);

  const [mode2, setMode2] = useState<'single' | 'three'>('single');

  const tp = useScenario('three-phases', { spacing: 120 });
  const { spacing } = tp.state;
  const rad = Math.PI / 180;
  const sumPeak = Math.round(SOCKET_PEAK * threePhaseSumPeak(spacing));

  // Power into a resistive load at 60 Hz, as a fraction of one phase's peak power.
  const w60 = (2 * Math.PI * 60) / 1000;
  const Y = (p: number) => 190 - 95 * p;
  const phasePow = (k: number) => (age: number) => Math.sin(w60 * (t - age) - (k * 2 * Math.PI) / 3) ** 2;
  const total = mode2 === 'single' ? phasePow(0) : (age: number) => phasePow(0)(age) + phasePow(1)(age) + phasePow(2)(age);
  const powerLine = trace((age) => Y(total(age)), 60, 620);

  return (
    <LessonPage id="1.2">
      <P>
        The battery from the previous lesson produces direct current, or DC: its voltage is steady, and current always flows the same way around the loop. The voltage at
        a wall socket behaves very differently. It swings smoothly from positive to negative and back again, tracing a sine wave. This is alternating current, or AC.
      </P>
      <P>
        The easiest way to picture a sine wave is as the shadow of something turning. In the next demonstration, the arrow on the left rotates at a steady rate, and
        its height at each moment is the voltage, drawn as a trace that scrolls off to the right. Everything here is slowed down 120 times — the real grid completes 60
        turns every second in North America, and 50 in most of the rest of the world. The time one turn takes, one full cycle, is called the <b>period</b>: at 60 Hz
        it’s a sixtieth of a second, about 16.7 milliseconds. Drag the phase shift, which starts the arrow at a different point in its turn, and watch the wave slide
        against the dashed reference:
      </P>

      <Figure name="Waveform Explorer" scenario={w} play={play}>
        <Phasors
          t={t}
          freqHz={f}
          peak={amp}
          offsets={[phase * rad]}
          colors={[VOLTAGE]}
          reference
          label={`A rotating arrow whose height traces the voltage over time: ${f} Hz, peaking at ${amp} V, shifted ${phase}°.`}
        />
        <Legend
          items={[
            { label: 'Voltage', color: VOLTAGE, kind: 'line' },
            { label: 'Reference, no phase shift', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts items={[{ label: 'period, one cycle', value: `${(1000 / f).toFixed(1)} ms`, tone: 'teal' }]} />
        <Slider label="Frequency" tone="teal" value={f} min={10} max={120} onChange={(v) => w.set({ f: v })} display={`${f} Hz`} />
        <Slider label="Peak voltage" tone="blue" value={amp} min={0} max={340} onChange={(v) => w.set({ amp: v })} display={`${amp} V`} />
        <Slider label="Phase shift" tone="violet" value={phase} min={-180} max={180} onChange={(v) => w.set({ phase: v })} display={`${phase > 0 ? '+' : ''}${phase}°`} />
      </Figure>

      <P>
        The <K c="frequency">frequency</K> sets how many turns the arrow makes each second, and the <K c="voltage">amplitude</K> sets its length — the peak voltage. The{' '}
        <K c="phase">phase</K> is where in its turn the arrow happens to be at a given moment, and it only means something when two waves are compared. On the grid that
        comparison matters a great deal: the power that flows between two substations depends on the difference between the phase angles of their voltages
        (<a href={lessonHref('2.4')}>Lesson 2.4</a>), and every generator must turn in step with all the others (<a href={lessonHref('3.2')}>Lesson 3.2</a>).
      </P>
      <P>
        Why alternate at all? Mostly because of transformers. As we’ll see in <a href={lessonHref('1.4')}>Lesson 1.4</a>, a transformer can raise or lower an alternating voltage with very little loss,
        but it does nothing to a steady one. High voltages make long-distance transmission efficient, so AC won the early battles over how to build the grid. Today,
        power electronics can convert DC voltages too, and some very long or undersea links use high-voltage DC — but the grid you’re plugged into is AC.
      </P>
      <P>
        Comparing an alternating voltage with a steady one takes some care, since the AC voltage spends part of every cycle near zero. The fair comparison is how much
        heat each produces in the same resistor, which gives the root-mean-square, or RMS, value. The name is the recipe, read backward: square the voltage at every
        instant, take the mean of those squares over a cycle, and then take the square root. For a sine wave, it’s the peak divided by √2:
      </P>
      <Eq label="RMS voltage equals peak voltage divided by the square root of two">
        <K c="voltage">
          V<Sub>rms</Sub>
        </K>
        <Op>=</Op>
        <Frac
          top={
            <K c="voltage">
              V<Sub>peak</Sub>
            </K>
          }
          bottom="√2"
        />
        <Op>=</Op>
        <Frac top={<K c="voltage">{SOCKET_PEAK} V</K>} bottom="√2" />
        <Op>=</Op>
        <K c="voltage">{Math.round(rmsFromPeak(SOCKET_PEAK))} V</K>
      </Eq>
      <P>
        The “120 volts” of an American wall socket is an RMS value. The actual peak is about 170 volts — which is where{' '}
        <FigRef to="Waveform Explorer">the waveform demonstration</FigRef> starts. Most of Europe uses 230 volts at 50 Hz, and that 230 is an RMS value too.
      </P>

      <Challenge
        id="a"
        question="Set the waveform demonstration to the supply in most of Europe: 230 volts RMS, to the nearest volt, at 50 Hz."
        solved={solved}
        status={`Right now the voltage repeats ${f} times a second and peaks at ${amp} V.`}
        success="Solved. RMS is the peak divided by √2, so 230 V RMS needs a peak of 230 V × √2 ≈ 325 V. At 50 Hz, each cycle lasts 20 milliseconds."
      />

      <H2>Three phases</H2>
      <P>
        A single alternating voltage has an awkward property: the <K c="power">power</K> it delivers pulses. Twice every cycle the voltage passes through zero, and for an
        instant no power flows at all. Power plants avoid this by generating three alternating voltages at once, each a third of a turn — 120° — behind the one before.
        The next demonstration compares the power delivered to a simple resistive load by one phase and by three:
      </P>

      <Figure name="Waveform Explorer · power" play={play}>
        <Segmented
          label="Number of phases"
          value={mode2}
          onChange={setMode2}
          options={[
            { value: 'single', label: 'Single-phase' },
            { value: 'three', label: 'Three-phase' },
          ]}
        />
        <svg className="chart" viewBox="0 0 640 214" role="img" aria-label="Instantaneous power delivered to a resistive load over time">
          <line className="base" x1={60} y1={190} x2={620} y2={190} />
          <line className="base" x1={60} y1={30} x2={60} y2={190} />
          <text className="ax ax-e" x={52} y={194}>
            0
          </text>
          <text className="ax" x={60} y={18}>
            Power delivered
          </text>
          <path d={powerLine + ' L620 190 L60 190 Z'} fill="#e75b55" opacity={0.14} />
          {mode2 === 'single' ? (
            <>
              <line x1={60} y1={142.5} x2={620} y2={142.5} stroke="#6b6b6b" strokeWidth={1.2} strokeDasharray="5 5" />
              <text className="ax ax-e" x={616} y={136}>
                average
              </text>
            </>
          ) : (
            <>
              {[2, 1, 0].map((k) => (
                <path key={k} d={trace((age) => Y(phasePow(k)(age)), 60, 620)} fill="none" stroke={PHASE[k]} strokeWidth={1.5} />
              ))}
              <text className="ax ax-e" x={616} y={40}>
                total
              </text>
            </>
          )}
          <path d={powerLine} fill="none" stroke="#c4382f" strokeWidth={3} strokeLinejoin="round" />
          <text className="ax ax-m" x={60} y={208}>
            now
          </text>
          <text className="ax ax-e" x={620} y={208}>
            40 ms ago
          </text>
        </svg>
      </Figure>

      <P>
        Each phase still pulses on its own, but the pulses interleave so neatly that their total is perfectly steady. A large motor connected to three phases feels a
        smooth, constant push instead of a vibrating one, and the generator at the other end feels a constant load on its shaft.
      </P>
      <P>
        Three phases have a second trick. The next demonstration draws the three voltages themselves, each peaking at 170 volts, with their sum as a dashed line. Spaced
        120° apart, they add up to zero at every instant. Drag the <K c="phase">spacing between the phases</K> away from 120° and watch the cancellation fall apart:
      </P>

      <Figure name="Waveform Explorer · three phases" scenario={tp} play={play}>
        <Phasors
          t={t}
          freqHz={60}
          peak={SOCKET_PEAK}
          offsets={[0, -spacing * rad, -2 * spacing * rad]}
          colors={[...PHASE]}
          sum
          label={`Three 60 Hz voltages, each peaking at ${SOCKET_PEAK} V and spaced ${spacing}° apart. Their sum peaks at ${sumPeak} V.`}
        />
        <Legend
          items={[
            { label: 'Phase A', color: PHASE[0], kind: 'line' },
            { label: 'Phase B', color: PHASE[1], kind: 'line' },
            { label: 'Phase C', color: PHASE[2], kind: 'line' },
            { label: 'Sum of all three', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts items={[{ label: 'peak of the sum', value: `${sumPeak} V` }]} />
        <Slider label="Spacing between phases" tone="violet" value={spacing} min={60} max={180} onChange={(v) => tp.set({ spacing: v })} display={`${spacing}°`} />
      </Figure>

      <P>
        Only the even spacing cancels completely; at 180°, for instance, two of the phases cancel each other and the third is left over. In a balanced three-phase
        system the currents cancel in the same way, so the return wires a single-phase circuit needs can be left out — three conductors do the work of six.
      </P>
      <P>
        Steady power, fewer wires and, as we’ll see in the next lesson, a natural fit with how rotating generators are built. That’s why nearly every high-voltage AC line
        carries its conductors in groups of three.
      </P>
    </LessonPage>
  );
}
