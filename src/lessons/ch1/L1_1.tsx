import {
  Challenge,
  Eq,
  Figure,
  Frac,
  GRAPHIC,
  GridY,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  mix,
  scale,
  usd,
  useScenario,
} from '../../framework';
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
      <rect x={54} y={116} width={52} height={68} fill="#fcfcfb" />
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

// The energy figure: power (height) against running time (width), one grid square per kWh.
const RETAIL_USD_PER_KWH = 0.15; // an illustrative retail price
const E_MAX_W = 3000;
const E_MAX_H = 12;
const EX = scale(0, E_MAX_H, 74, 584);
const EY = scale(0, E_MAX_W, 178, 28);

/** "30 min", "2 h", "1 h 15 min". */
function duration(hours: number) {
  const m = Math.round(hours * 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} min`;
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** Hours with no trailing zeros: 0.5, 0.25, 12. */
function hrs(hours: number) {
  return String(Number(hours.toFixed(2)));
}

/** The challenge's limit on the circuit's current, amperes. */
export const RESISTOR_LIMIT_A = 3;
/** The battery slider's top voltage. */
export const BATTERY_MAX_V = 24;
/** The two lamps' battery: 12 V, as in the first demonstration. */
export const LAMP_VOLTS = 12;
export const LAMP_OHMS = [6, 6];

/**
 * The challenge: the most heat the resistor can make without the current passing its limit.
 * With the current capped, P = V × I grows only with the voltage, so the answer is the battery's top 24 V at 3 A.
 */
export function mostHeatSolved(volts: number, ohms: number) {
  const amps = volts / ohms;
  return amps <= RESISTOR_LIMIT_A + 1e-9 && volts * amps >= BATTERY_MAX_V * RESISTOR_LIMIT_A - 1e-9;
}

export default function Lesson() {
  const c1 = useScenario('circuit', { volts: 12, ohms: 24 });
  const c2 = useScenario('two-loads', { mode: 'series' as 'series' | 'parallel' });
  const { volts: V, ohms: R } = c1.state;
  const I = V / R;
  const Pw = V * I;
  const t = Math.min(1, Math.log10(1 + Pw) / Math.log10(1 + 288));

  const series = c2.state.mode === 'series';
  const circuit = series ? seriesCircuit(LAMP_VOLTS, LAMP_OHMS) : parallelCircuit(LAMP_VOLTS, LAMP_OHMS);
  const lamp = circuit.branches[0];
  const glow = Math.sqrt(Math.min(1, lamp.watts / 96));
  const lampFill = mix('#e2e2e2', '#f6c453', glow);
  const solved = mostHeatSolved(V, R);
  const overLimit = I > RESISTOR_LIMIT_A + 1e-9;

  const en = useScenario('energy', { watts: 1200, hours: 0.5 });
  const eW = en.state.watts;
  const eH = en.state.hours;
  const wh = eW * eH;
  const kWh = wh / 1000;
  const cost = kWh * RETAIL_USD_PER_KWH;
  const boxW = EX(eH) - EX(0);
  const boxH = EY(0) - EY(eW);
  // The kWh label goes inside the block when it fits, else to its right, else above it.
  const labelAt =
    boxW >= 86 && boxH >= 26
      ? { x: EX(eH / 2), y: (EY(eW) + EY(0)) / 2 + 5, anchor: 'middle' as const }
      : EX(eH) + 84 <= 600
        ? { x: EX(eH) + 6, y: Math.min(EY(eW) + 16, EY(0) - 6), anchor: 'start' as const }
        : { x: EX(eH / 2), y: EY(eW) - 8, anchor: 'middle' as const };

  return (
    <LessonPage id="1.1">
      <P>
        Everything in this course — every power plant, transmission line and market auction — exists to push electric charge through wires to somewhere it can do useful
        work. So we’ll start with the smallest system that does that: a battery, some wire, and something for the current to flow through.
      </P>
      <P>
        A battery is a pump for electric charge. Every bit of charge it moves from one terminal to the other picks up the same amount of energy, and that energy per
        unit of charge — the strength of the battery’s push — is the <K c="voltage">voltage</K>, measured in volts. (Because the charge has more energy at one terminal
        than at the other, voltage is also called a difference in electric potential.) Connect the terminals with a conductor and charge begins to flow around the loop,
        carrying that energy to wherever it’s spent. The rate at which charge passes any point is the <K c="current">current</K>, measured in amperes, and it’s shown
        by the moving dots in the next demonstration. How much current flows depends on how strongly the circuit opposes it — its{' '}
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
        <Slider label="Voltage" tone="blue" value={V} min={0} max={BATTERY_MAX_V} step={0.5} onChange={(v) => c1.set({ volts: v })} display={`${V.toFixed(1)} V`} />
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
        <K c="resistance">R</K>. Keep that version in mind. In this demonstration the battery fixes the voltage, so raising the resistance lowers the current, and the
        heat with it. A wire in the grid is in a different position: it carries whatever current the loads at its far end draw. So I²R is the version that describes
        a wire. For a given current, more resistance means more heat wasted, and the heat grows with the square of the current. That square is the single biggest
        reason the grid looks the way it does, and we’ll come back to it in <a href={lessonHref('1.5')}>Lesson 1.5</a>. The same heat limits the current a wire can
        safely carry: push too much through it and it overheats.
      </P>

      <Challenge
        id="a"
        question="Suppose the wires in this circuit can safely carry at most 3 amperes. Make the resistor turn as much power into heat as it can without going over that."
        solved={solved}
        status={
          overLimit
            ? `At ${I.toFixed(2)} A, the current is over the 3 A limit.`
            : `Right now the resistor carries ${I.toFixed(2)} A and turns ${watts(Pw)} into heat.`
        }
        success="Solved. With the current held at 3 A, P = V × I can only grow with the voltage, so the most heat comes from the battery’s highest setting, 24 V. Ohm’s law then sets the resistance: 24 V ÷ 3 A = 8 Ω, and 24 V × 3 A = 72 W."
      />

      <H2>Power and energy</H2>
      <P>
        Power is a rate: how quickly energy is being converted, here from the chemicals in the battery into heat in the resistor. How much <K c="energy">energy</K> is
        converted altogether depends on how long that goes on:
      </P>
      <Eq label="Energy equals power times time">
        <K c="energy">E</K>
        <Op>=</Op>
        <K c="power">P</K>
        <Op>×</Op>
        <span>t</span>
      </Eq>
      <P>
        Energy is measured in joules, and a joule is one watt kept up for one second: a watt-second. That’s a small amount, so electricity is usually counted in
        watt-hours instead — one watt for an hour, or 3,600 joules. A thousand watt-hours make a kilowatt-hour (kWh), the unit on a household electricity bill, and a
        thousand kilowatt-hours make a megawatt-hour (MWh). In the next demonstration, the height of the shaded block is an appliance’s power and its width is how long
        the appliance runs, so the block’s area is the energy it uses. Set the power and the running time:
      </P>

      <Figure name="Circuit Builder · energy" scenario={en}>
        <svg
          className="chart"
          viewBox="0 0 600 220"
          role="img"
          aria-label={`An appliance drawing ${fmt(eW)} W for ${duration(eH)}. The shaded area, ${fmt(kWh, 2)} kWh, is the energy it uses.`}
        >
          <text className="ax" x={EX(0)} y={16}>
            Power drawn
          </text>
          {Array.from({ length: E_MAX_H + 1 }, (_, h) => (
            <line key={h} className="gl" x1={EX(h)} x2={EX(h)} y1={EY(E_MAX_W)} y2={EY(0)} />
          ))}
          <GridY y={EY} ticks={[0, 1000, 2000, 3000]} x0={EX(0)} x1={EX(E_MAX_H)} format={(v) => `${fmt(v)} W`} baseline={0} />
          <rect x={EX(0)} y={EY(eW)} width={boxW} height={boxH} fill={GRAPHIC.gold} opacity={0.35} />
          <line x1={EX(0)} x2={EX(eH)} y1={EY(eW)} y2={EY(eW)} stroke={GRAPHIC.red} strokeWidth={2.5} />
          <line x1={EX(eH)} x2={EX(eH)} y1={EY(eW)} y2={EY(0)} stroke={GRAPHIC.gold} strokeWidth={1.5} />
          <text x={labelAt.x} y={labelAt.y} textAnchor={labelAt.anchor} style={{ fontSize: 14, fontWeight: 600, fill: TEXT.gold }}>
            {fmt(kWh, 2)} kWh
          </text>
          {[0, 2, 4, 6, 8, 10, 12].map((h) => (
            <text key={h} className="ax ax-m" x={EX(h)} y={196}>
              {h} h
            </text>
          ))}
          <text className="ax ax-e" x={EX(E_MAX_H)} y={214}>
            time running · each square is 1 kWh
          </text>
        </svg>
        <Readouts items={[{ label: `cost at an illustrative ${fmt(RETAIL_USD_PER_KWH * 100)}¢ per kWh`, value: usd(cost, 2), tone: 'green' }]} />
        <Slider label="Appliance power" tone="red" value={eW} min={0} max={E_MAX_W} step={50} onChange={(v) => en.set({ watts: v })} display={`${fmt(eW)} W`} />
        <Slider label="Running time" value={eH} min={0} max={E_MAX_H} step={0.25} onChange={(v) => en.set({ hours: v })} display={duration(eH)} />
        <Eq label="Energy used equals power times running time">
          <K c="energy">E</K>
          <Op>=</Op>
          <K c="power">{fmt(eW)} W</K>
          <Op>×</Op>
          <span>{hrs(eH)} h</span>
          <Op>=</Op>
          <K c="energy">{fmt(wh, wh % 1 ? 1 : 0)} Wh</K>
          <Op>=</Op>
          <K c="energy">{fmt(kWh, 2)} kWh</K>
        </Eq>
      </Figure>

      <P>
        At the starting settings, a 1,200-watt toaster runs for 30 minutes: 1,200 W × 0.5 h = 600 watt-hours, or 0.6 kWh. Each square of the grid is a kilowatt for an
        hour, one kilowatt-hour, so you can count the energy by eye — and a kettle drawing twice the power for half as long, 2,400 W for 15 minutes, uses exactly the
        same. At the illustrative retail price of 15 cents per kilowatt-hour, the toast costs 9 cents; real prices vary a good deal from place to place. A typical home
        in our model draws between about 0.55 and 2.4 kilowatts over the course of a day, and that adds up to about 29 kWh.
      </P>
      <P>
        The grid works with the same arithmetic in bigger units. The region we’ll study from Chapter 2 on draws 1,440 MW at its evening peak, and over the whole
        reference day it uses about 26,000 MWh. Keep the two kinds of number apart. A power plant’s size is given in megawatts, a rate: how much power it can produce at
        any moment. What it sells is megawatt-hours, an amount: that power kept up for some length of time, so a 100 MW plant running flat out for an hour makes 100
        MWh. That’s why, when later lessons put a price on electricity, they quote it per megawatt-hour.
      </P>

      <H2>Series and parallel</H2>
      <P>
        Real circuits rarely contain a single resistor. When two lamps are connected one after the other — in series — the same current must pass through both, and the
        battery’s voltage is split between them. When they’re connected side by side — in parallel — each lamp gets the battery’s full voltage, and the current divides
        between the two paths. The two lamps in the next demonstration are identical and run from a 12-volt battery, and we’ll treat each as a simple 6-ohm resistor,
        though a real filament’s resistance rises as it heats up. Switch between the two ways of connecting them:
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
            <Battery label={`${LAMP_VOLTS.toFixed(1)} V`} />
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
            <Battery label={`${LAMP_VOLTS.toFixed(1)} V`} />
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
                <td>{LAMP_VOLTS.toFixed(1)} V</td>
                <td>{circuit.totalAmps.toFixed(2)} A</td>
                <td>{watts(LAMP_VOLTS * circuit.totalAmps)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Figure>

      <P>
        In series, each lamp receives half the voltage and carries half the current it would on its own, so it gets only a quarter of the power:
        6 watts, against 24 in parallel. In parallel, each lamp sees the full 12 volts, and the battery supplies the sum of both currents — the dots next to the
        battery move twice as fast as those in either branch.
      </P>
      <P>
        Every outlet in a building is wired in parallel. That’s why each appliance receives the full supply voltage no matter what else is switched on, and why the
        current a building draws is simply the sum of what all its appliances draw. Add up every home, office and factory on a grid and you get <b>demand</b>: a single
        number, measured in megawatts, that the power plants must match at every moment.
      </P>
      <P>
        A battery pushes current in one direction only. The grid doesn’t: the voltage at a North American wall socket swings back and forth 60 times a second. In the next
        lesson we’ll see why the grid alternates, and why it nearly always comes in threes.
      </P>
    </LessonPage>
  );
}
