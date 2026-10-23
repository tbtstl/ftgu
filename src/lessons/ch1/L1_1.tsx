import { Challenge, Eq, Figure, Frac, H2, K, LessonPage, Op, P, Segmented, Slider, Tn, mix, useScenario } from '../../framework';
import { parallelCircuit, seriesCircuit } from '../../engines/physics/circuits';

/** Dots move at a speed proportional to current; returns CSS animation settings. */
function flowStyle(amps: number, pxPerAmp = 35) {
  const speed = pxPerAmp * amps;
  return speed > 0.01 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
}

function watts(p: number) {
  return (p < 10 ? p.toFixed(1) : String(Math.round(p))) + ' W';
}

/** Battery symbol on the left wire at (80, 150), with its voltage label. */
function Battery({ label }: { label: string }) {
  return (
    <g>
      <rect x={54} y={116} width={52} height={68} fill="#f8f8f8" />
      <line x1={80} y1={116} x2={80} y2={140} stroke="#9a9a9a" strokeWidth={4} />
      <line x1={80} y1={160} x2={80} y2={184} stroke="#9a9a9a" strokeWidth={4} />
      <line x1={60} y1={140} x2={100} y2={140} stroke="#444" strokeWidth={3} />
      <line x1={70} y1={160} x2={90} y2={160} stroke="#444" strokeWidth={8} />
      <text x={110} y={138} style={{ fontSize: 16, fontWeight: 500, fill: '#444' }}>
        +
      </text>
      <text x={110} y={170} style={{ fontSize: 16, fontWeight: 500, fill: '#444' }}>
        −
      </text>
      <text x={46} y={155} textAnchor="end" style={{ fontSize: 15, fontWeight: 500, fill: '#2f6fb3' }}>
        {label}
      </text>
    </g>
  );
}

function Lamp({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={22} fill={fill} stroke="#555" strokeWidth={2} />
      <line x1={x - 15.6} y1={y - 15.6} x2={x + 15.6} y2={y + 15.6} stroke="#555" strokeWidth={2} />
      <line x1={x - 15.6} y1={y + 15.6} x2={x + 15.6} y2={y - 15.6} stroke="#555" strokeWidth={2} />
    </g>
  );
}

const LOOP = 'M80 150 L80 60 L480 60 L480 240 L80 240 Z';
const WIRE = { fill: 'none', stroke: '#9a9a9a', strokeWidth: 4, strokeLinejoin: 'round' as const };
const DOTS = { stroke: '#e48850', strokeWidth: 7 };

function heat(t: number) {
  return t < 0.6 ? mix('#d8d8d8', '#e75b55', t / 0.6) : mix('#e75b55', '#f6c453', (t - 0.6) / 0.4);
}

export default function Lesson() {
  const c1 = useScenario('circuit', { volts: 12, ohms: 24 });
  const c2 = useScenario('two-loads', { mode: 'series' as 'series' | 'parallel', volts: 12 });
  const { volts: V, ohms: R } = c1.state;
  const I = V / R;
  const Pw = V * I;
  const t = Math.min(1, Math.log10(1 + Pw) / Math.log10(1 + 288));

  const series = c2.state.mode === 'series';
  const circuit = series ? seriesCircuit(c2.state.volts, [6, 6]) : parallelCircuit(c2.state.volts, [6, 6]);
  const lamp = circuit.branches[0];
  const glow = Math.sqrt(Math.min(1, lamp.watts / 96));
  const lampFill = mix('#e2e2e2', '#f6c453', glow);
  const solved = Math.abs(I - 3) < 1e-9 && Math.abs(Pw - 72) < 1e-9;

  return (
    <LessonPage id="1.1">
      <P>
        Everything in this course — every power plant, transmission line and market auction — exists to push electric charge through wires to somewhere it can do useful
        work. So we’ll start with the smallest system that does that: a battery, some wire, and something for the current to flow through.
      </P>
      <P>
        A battery maintains a difference in electric potential between its two terminals. That difference is the <K c="voltage">voltage</K>, measured in volts. Connect
        the terminals with a conductor and charge begins to flow around the loop. The rate at which charge passes any point is the <K c="current">current</K>, measured
        in amperes, and it’s shown by the moving dots below. How much current flows depends on how strongly the circuit opposes it — its{' '}
        <K c="resistance">resistance</K>, measured in ohms. Use the sliders to change the battery’s voltage and the resistor’s resistance:
      </P>

      <Figure name="Circuit Builder" scenario={c1}>
        <svg className="diagram" viewBox="0 0 560 290" role="img" aria-label="A battery connected to a resistor. Moving dots show the current, and the resistor glows as it heats up.">
          <rect x={446} y={84} width={68} height={132} rx={26} fill={heat(t)} opacity={t * 0.5} />
          <path d={LOOP} {...WIRE} />
          <path d={LOOP} className="flow-dots" {...DOTS} style={flowStyle(I, 30)} />
          <Battery label={`${V.toFixed(1)} V`} />
          <rect x={466} y={104} width={28} height={92} rx={4} fill={heat(t)} stroke="#555" strokeWidth={2} />
          <text x={510} y={142} style={{ fontSize: 15, fontWeight: 500, fill: '#8e4fa0' }}>
            {R} Ω
          </text>
          <text x={510} y={164} style={{ fontSize: 15, fontWeight: 500, fill: '#c4382f' }}>
            {watts(Pw)}
          </text>
          <text x={280} y={44} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#ad5310' }}>
            {I.toFixed(2)} A →
          </text>
          <text x={80} y={270} textAnchor="middle" className="ax">
            battery
          </text>
          <text x={480} y={270} textAnchor="middle" className="ax">
            resistor
          </text>
        </svg>
        <Slider label="Voltage" tone="blue" value={V} min={0} max={24} step={0.5} onChange={(v) => c1.set({ volts: v })} display={`${V.toFixed(1)} V`} />
        <Slider label="Resistance" tone="violet" value={R} min={2} max={100} onChange={(v) => c1.set({ ohms: v })} display={`${R} Ω`} />
        <Eq label="Ohm's law">
          <K c="current">I</K>
          <Op>=</Op>
          <Frac top={<K c="voltage">V</K>} bottom={<K c="resistance">R</K>} />
          <Op>=</Op>
          <Frac top={<K c="voltage">{V.toFixed(1)} V</K>} bottom={<K c="resistance">{R} Ω</K>} />
          <Op>=</Op>
          <K c="current">{I.toFixed(2)} A</K>
        </Eq>
      </Figure>

      <P>
        Double the voltage and the current doubles. Double the resistance and the current halves. This proportionality is called Ohm’s law. It isn’t a fundamental law of
        nature — plenty of materials and devices don’t obey it — but it describes metal wires, heating elements and the long conductors of the grid remarkably well.
      </P>
      <P>
        The dots show conventional current, which by convention flows out of the battery’s positive terminal. The electrons that actually carry the charge through a
        metal drift the other way, and surprisingly slowly: typically well under a millimeter per second. What travels quickly around the loop is the push, not the
        electrons themselves.
      </P>
      <P>
        You may have noticed the resistor glowing as the current rises. Pushing charge through a resistance takes energy, and that energy doesn’t disappear — it turns
        into heat. The rate at which this happens is the <K c="power">power</K>, measured in watts, and it’s simply voltage multiplied by current:
      </P>
      <Eq label="Power equals voltage times current">
        <K c="power">P</K>
        <Op>=</Op>
        <K c="voltage">V</K>
        <Op>×</Op>
        <K c="current">I</K>
        <Op>=</Op>
        <K c="voltage">{V.toFixed(1)} V</K>
        <Op>×</Op>
        <K c="current">{I.toFixed(2)} A</K>
        <Op>=</Op>
        <K c="power">{watts(Pw)}</K>
      </Eq>
      <P>
        Since <K c="current">I</K> = <K c="voltage">V</K> / <K c="resistance">R</K>, the same power can also be written as <K c="power">P</K> = <K c="current">I</K>²
        <K c="resistance">R</K>. Keep that version in mind. It says the heat wasted in a wire grows with the square of the current flowing through it, and it’s the single
        biggest reason the grid looks the way it does. We’ll come back to it in Lesson 1.5.
      </P>

      <Challenge
        id="a"
        question="Set the circuit in the demonstration above so that the resistor carries exactly 3 amperes while turning 72 watts into heat."
        solved={solved}
        status={`Right now the resistor carries ${I.toFixed(2)} A and turns ${watts(Pw)} into heat.`}
        success="Solved. 24 V across 8 Ω drives 3 A, and 24 V × 3 A = 72 W."
      />

      <H2>Series and parallel</H2>
      <P>
        Real circuits rarely contain a single resistor. When two lamps are connected one after the other — in series — the same current must pass through both, and the
        battery’s voltage is split between them. When they’re connected side by side — in parallel — each lamp gets the battery’s full voltage, and the current divides
        between the two paths. The two lamps below are identical, with a resistance of 6 ohms each:
      </P>

      <Figure name="Circuit Builder · two loads" scenario={c2}>
        <Segmented
          label="How the lamps are connected"
          value={c2.state.mode}
          onChange={(mode) => c2.set({ mode })}
          options={[
            { value: 'series', label: 'Series' },
            { value: 'parallel', label: 'Parallel' },
          ]}
        />
        {series ? (
          <svg className="diagram" viewBox="0 0 560 280" role="img" aria-label="Two lamps connected in series with a battery">
            <circle cx={280} cy={60} r={24 + 26 * glow} fill="#f6c453" opacity={0.55 * glow} />
            <circle cx={480} cy={150} r={24 + 26 * glow} fill="#f6c453" opacity={0.55 * glow} />
            <path d={LOOP} {...WIRE} />
            <path d={LOOP} className="flow-dots" {...DOTS} style={flowStyle(circuit.totalAmps)} />
            <Battery label={`${c2.state.volts.toFixed(1)} V`} />
            <text x={180} y={44} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#ad5310' }}>
              {circuit.totalAmps.toFixed(2)} A →
            </text>
            <Lamp x={280} y={60} fill={lampFill} />
            <Lamp x={480} y={150} fill={lampFill} />
            <text x={280} y={22} textAnchor="middle" className="ax">
              Lamp 1
            </text>
            <text x={514} y={155} className="ax">
              Lamp 2
            </text>
          </svg>
        ) : (
          <svg className="diagram" viewBox="0 0 560 280" role="img" aria-label="Two lamps connected in parallel with a battery">
            <circle cx={300} cy={150} r={24 + 26 * glow} fill="#f6c453" opacity={0.55 * glow} />
            <circle cx={480} cy={150} r={24 + 26 * glow} fill="#f6c453" opacity={0.55 * glow} />
            <path d={LOOP} {...WIRE} />
            <path d="M300 60 L300 240" {...WIRE} />
            <path d="M80 150 L80 60 L300 60 M300 240 L80 240 L80 150" className="flow-dots" {...DOTS} style={flowStyle(circuit.totalAmps)} />
            <path d="M300 60 L300 240" className="flow-dots" {...DOTS} style={flowStyle(lamp.amps)} />
            <path d="M300 60 L480 60 L480 240 L300 240" className="flow-dots" {...DOTS} style={flowStyle(lamp.amps)} />
            <circle cx={300} cy={60} r={6} fill="#9a9a9a" />
            <circle cx={300} cy={240} r={6} fill="#9a9a9a" />
            <Battery label={`${c2.state.volts.toFixed(1)} V`} />
            <text x={190} y={44} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#ad5310' }}>
              {circuit.totalAmps.toFixed(2)} A →
            </text>
            <Lamp x={300} y={150} fill={lampFill} />
            <Lamp x={480} y={150} fill={lampFill} />
            <text x={334} y={155} className="ax">
              Lamp 1
            </text>
            <text x={514} y={155} className="ax">
              Lamp 2
            </text>
          </svg>
        )}
        <Slider
          label="Battery voltage"
          tone="blue"
          value={c2.state.volts}
          min={0}
          max={24}
          step={0.5}
          onChange={(v) => c2.set({ volts: v })}
          display={`${c2.state.volts.toFixed(1)} V`}
        />
        <div className="tbwrap" style={{ maxWidth: 440, margin: '4px auto 0' }}>
          <table className="tb">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Element</span>
                </th>
                <th scope="col">
                  <Tn tone="blue">Voltage</Tn>
                </th>
                <th scope="col">
                  <Tn tone="orange">Current</Tn>
                </th>
                <th scope="col">
                  <Tn tone="red">Power</Tn>
                </th>
              </tr>
            </thead>
            <tbody>
              {circuit.branches.map((b, i) => (
                <tr key={i}>
                  <td>Lamp {i + 1}</td>
                  <td>{b.volts.toFixed(1)} V</td>
                  <td>{b.amps.toFixed(2)} A</td>
                  <td>{watts(b.watts)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Battery</td>
                <td>{c2.state.volts.toFixed(1)} V</td>
                <td>{circuit.totalAmps.toFixed(2)} A</td>
                <td>{watts(c2.state.volts * circuit.totalAmps)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Figure>

      <P>
        In series, each lamp receives half the voltage and carries half the current it would on its own, so it gets only a quarter of the power. In parallel, each lamp
        sees the full voltage, and the battery supplies the sum of both currents — the dots next to the battery move twice as fast as those in either branch.
      </P>
      <P>
        Every outlet in a building is wired in parallel. That’s why each appliance receives the full supply voltage no matter what else is switched on, and why the
        current a building draws is simply the sum of what all its appliances draw. Add up every home, office and factory on a grid and you get <b>demand</b>: a single
        number, measured in megawatts, that the power plants must match at every moment.
      </P>
      <P>
        A battery pushes current in one direction only. The grid doesn’t: the voltage at a North American wall socket reverses direction 120 times a second. In the next
        lesson we’ll see why the grid alternates, and why it nearly always comes in threes.
      </P>
    </LessonPage>
  );
}
