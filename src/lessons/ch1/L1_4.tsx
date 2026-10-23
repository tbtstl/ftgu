import { useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
  Figure,
  Frac,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  Tn,
  fmt,
  mix,
  pct,
  si,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../framework';
import { transformer } from '../../engines/physics/machines';
import { deliveryChain, type DeliveryStage } from '../../engines/physics/delivery';

const SUPPLY_V = 240;
const WINDING_OHMS = 0.4; // winding resistance, as seen from the load
const CORE_LOSS_W = 20;
const HZ = 60;
const SLOW = 120; // the animation runs 120× slower than real time

const IRON = '#dadada';
const WIRE = { fill: 'none', stroke: '#9a9a9a', strokeWidth: 4, strokeLinejoin: 'round' as const };
const DOTS = { fill: 'none', stroke: '#e48850', strokeWidth: 7, strokeLinecap: 'round' as const, strokeDasharray: '0 18' };

function volts(v: number) {
  return (v < 100 ? fmt(v, 1) : fmt(v)) + ' V';
}

function amps(a: number) {
  return (a < 100 ? fmt(a, 1) : fmt(a)) + ' A';
}

function watts(w: number) {
  return w < 100_000 ? fmt(w) + ' W' : si(w, 'W');
}

/** Lines drawn across an iron leg to show a coil, one per 20 turns; its leads leave on `side`. */
function Winding({ x, turns, side }: { x: number; turns: number; side: -1 | 1 }) {
  const n = Math.max(1, Math.min(20, Math.round(turns / 20)));
  const ys = Array.from({ length: n }, (_, j) => 104 + ((j + 0.5) * 92) / n);
  const lx = x + side * 26;
  const end = (y: number) => (side < 0 ? y : y - 3); // turns slope up from left to right
  return (
    <g>
      <line x1={lx} y1={96} x2={lx} y2={end(ys[0])} stroke="#9a9a9a" strokeWidth={3} />
      <line x1={lx} y1={end(ys[n - 1])} x2={lx} y2={204} stroke="#9a9a9a" strokeWidth={3} />
      {ys.map((y, j) => (
        <line key={j} x1={x - 26} y1={y} x2={x + 26} y2={y - 3} stroke="#666" strokeWidth={2.4} strokeLinecap="round" />
      ))}
    </g>
  );
}

/** An arrow along the core's yoke: length and direction follow the flux (−1…1). */
function FluxArrow({ y, flux, dir }: { y: number; flux: number; dir: 1 | -1 }) {
  const len = 8 + 46 * Math.abs(flux);
  const s = Math.sign(flux) * dir || 1;
  const x0 = 320 - (s * len) / 2;
  const x1 = 320 + (s * len) / 2;
  const op = 0.3 + 0.7 * Math.abs(flux);
  return (
    <g opacity={op}>
      <line x1={x0} y1={y} x2={x1 - s * 6} y2={y} stroke="#777" strokeWidth={3} />
      <path d={`M${x1} ${y} L${x1 - s * 10} ${y - 6} L${x1 - s * 10} ${y + 6} Z`} fill="#777" />
    </g>
  );
}

function ratioLabel(r: number) {
  const trim = (x: number) => String(Math.round(x * 100) / 100);
  return r >= 1 ? '×' + trim(r) : '÷' + trim(1 / r);
}

function stageAmps(a: number) {
  if (a >= 100) return fmt(a) + ' A';
  if (a >= 10) return fmt(a, 1) + ' A';
  if (a >= 1) return fmt(a, 2) + ' A';
  return fmt(a, 3) + ' A';
}

const STAGE_X: Record<DeliveryStage['id'], number> = { generator: 40, transmission: 168, subtransmission: 305, feeder: 433, service: 580 };
const STAGE_NAME: Record<DeliveryStage['id'], string> = {
  generator: 'Generator',
  transmission: 'Transmission',
  subtransmission: 'Subtransmission',
  feeder: 'Feeder',
  service: 'Home',
};
const XFMR_X = [92, 240, 370, 496];

function Xfmr({ x }: { x: number }) {
  return (
    <g>
      <circle cx={x - 6} cy={120} r={9} fill="#f8f8f8" stroke="#555" strokeWidth={2} />
      <circle cx={x + 6} cy={120} r={9} fill="#f8f8f8" stroke="#555" strokeWidth={2} />
      <circle cx={x - 6} cy={120} r={9} fill="none" stroke="#555" strokeWidth={2} />
    </g>
  );
}

function Pylon({ x }: { x: number }) {
  return <path d={`M${x - 11} 158 L${x} 120 L${x + 11} 158 M${x - 7} 144 L${x + 7} 144 M${x - 14} 124 L${x + 14} 124`} fill="none" stroke="#9a9a9a" strokeWidth={2} />;
}

function Pole({ x }: { x: number }) {
  return <path d={`M${x} 120 L${x} 158 M${x - 9} 124 L${x + 9} 124`} fill="none" stroke="#8d7b6a" strokeWidth={3} />;
}

export default function Lesson() {
  const play = usePlay(true);
  const [time, setTime] = useState(0); // simulated seconds
  useAnimationFrame((dt) => setTime((x) => x + dt / SLOW), play.playing);

  const s = useScenario('transformer', { supply: 'ac' as 'ac' | 'dc', n1: 200, n2: 100, load: 12, losses: false });
  const { supply, n1, n2, load, losses } = s.state;
  const ac = supply === 'ac';
  const t = transformer({
    primaryVolts: SUPPLY_V,
    primaryTurns: n1,
    secondaryTurns: n2,
    loadOhms: load,
    windingOhms: losses ? WINDING_OHMS : 0,
    coreLossWatts: losses ? CORE_LOSS_W : 0,
  });
  const v2 = ac ? t.secondaryVolts : 0;
  const i2 = ac ? t.secondaryAmps : 0;
  const pOut = ac ? t.outputWatts : 0;
  const openCircuit = SUPPLY_V * t.ratio;

  // Animation: in AC the charges and the flux swing back and forth; in DC the primary current
  // flows steadily, the flux is constant and the secondary is still.
  const phase = 2 * Math.PI * HZ * time;
  const swing = (a: number) => Math.min(18, 1.2 * a);
  const off1 = ac ? -swing(t.primaryAmps) * Math.cos(phase) : -(30 * time * SLOW) % 18;
  const off2 = ac ? -swing(i2) * Math.cos(phase) : 0;
  const flux = ac ? -Math.cos(phase) : 1;
  const glow = Math.sqrt(Math.min(1, pOut / 2000));
  const lampFill = mix('#e2e2e2', '#f6c453', glow);

  const solved = ac && losses && load === 12 && fmt(v2) === '120' && fmt(i2, 1) === '10.0';

  let caption: string;
  if (!ac) {
    caption = 'A steady current makes a steady flux, and a steady flux induces nothing: the secondary is dead. Only the small resistance of the copper now limits the primary current.';
  } else if (!losses) {
    const how = n2 < n1 ? `steps ${SUPPLY_V} V down to ${volts(v2)}` : n2 > n1 ? `steps ${SUPPLY_V} V up to ${volts(v2)}` : `passes ${SUPPLY_V} V through unchanged`;
    caption = `The transformer ${how}. The load draws ${amps(i2)} and the supply provides ${amps(t.primaryAmps)}: ${watts(t.inputWatts)} goes in, and the same ${watts(pOut)} comes out.`;
  } else {
    caption = `Of the ${watts(t.inputWatts)} taken from the supply, ${watts(pOut)} reaches the load. The windings turn ${watts(t.copperLossWatts)} into heat and the core ${watts(t.coreLossWatts)}.`;
  }

  const c = useScenario('chain', { power: '1' as '0.01' | '1' | '100', kv: '345' as '230' | '345' | '500' | '765' });
  const powerMW = Number(c.state.power);
  const chain = deliveryChain(powerMW, { transmissionKV: Number(c.state.kv) });
  const byId = Object.fromEntries(chain.map((st) => [st.id, st])) as Record<DeliveryStage['id'], DeliveryStage>;
  const powerLabel = powerMW < 1 ? `${fmt(powerMW * 1000)} kW` : `${fmt(powerMW)} MW`;
  const voltLabel = (st: DeliveryStage) => (st.id === 'service' ? '240 / 120 V' : `${fmt(st.volts / 1000, st.volts < 20_000 ? 1 : 0)} kV`);

  return (
    <LessonPage id="1.4">
      <P>
        A generator makes its voltage at whatever level its coils were built for — a few tens of kilovolts at most. The previous lessons hinted that sending power a long
        way at that voltage would waste much of it as heat, and transmission lines run at hundreds of kilovolts instead. At the other end, a toaster wants 120 volts.
        Something has to convert between them, and it turns out to need nothing more than two coils of wire and a lump of iron.
      </P>
      <P>
        A <b>transformer</b> is two coils wound on a shared iron core. An alternating current in the first coil, the primary, makes a magnetic flux in the core that
        reverses direction 120 times a second. The iron guides nearly all of that flux through the second coil, the secondary, and by Faraday’s law from the previous
        lesson, the changing flux induces a voltage there. The two coils never touch: power crosses from one to the other entirely through the magnetic field.
      </P>
      <P>
        The demonstration below connects a 240-volt AC supply to the primary and a 12-ohm load, drawn as a lamp, to the secondary. The gray arrows in the core show the
        flux, and the dots show the <K c="current">current</K> in each circuit, swinging back and forth the way alternating current does. As before, everything is slowed
        down 120 times. Change the number of turns on each coil:
      </P>

      <Figure name="Transformer Lab" scenario={s} play={play}>
        <Segmented
          label="Supply"
          value={supply}
          onChange={(v) => s.set({ supply: v })}
          options={[
            { value: 'ac', label: 'AC supply' },
            { value: 'dc', label: 'DC supply' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 300"
          role="img"
          aria-label={`A transformer with ${n1} turns on the primary and ${n2} on the secondary, fed from a ${SUPPLY_V} V ${ac ? 'AC' : 'DC'} supply. The ${load} ohm load receives ${volts(v2)} and ${watts(pOut)}.`}
        >
          <circle cx={540} cy={150} r={24 + 26 * glow} fill="#f6c453" opacity={0.55 * glow} />
          <path d="M200 46 H440 V254 H200 Z M236 82 V218 H404 V82 Z" fill={IRON} fillRule="evenodd" />
          <text className="ax ax-m" x={320} y={36}>
            magnetic flux
          </text>
          <FluxArrow y={64} flux={flux} dir={1} />
          <FluxArrow y={236} flux={flux} dir={-1} />

          <path d="M76 124 L76 96 L192 96 M192 204 L76 204 L76 176" {...WIRE} />
          <path d="M448 96 L540 96 L540 128 M540 172 L540 204 L448 204" {...WIRE} />
          <path d="M76 124 L76 96 L190 96" {...DOTS} style={{ strokeDashoffset: off1 }} />
          <path d="M190 204 L76 204 L76 176" {...DOTS} style={{ strokeDashoffset: off1 }} />
          <path d="M450 96 L540 96 L540 128" {...DOTS} style={{ strokeDashoffset: off2 }} />
          <path d="M540 172 L540 204 L450 204" {...DOTS} style={{ strokeDashoffset: off2 }} />
          <Winding x={218} turns={n1} side={-1} />
          <Winding x={422} turns={n2} side={1} />

          {ac ? (
            <g>
              <circle cx={76} cy={150} r={24} fill="#f8f8f8" stroke="#555" strokeWidth={2} />
              <path d="M63 150 C67 138, 72 138, 76 150 S85 162, 89 150" fill="none" stroke="#555" strokeWidth={2} />
            </g>
          ) : (
            <g>
              <rect x={50} y={124} width={52} height={52} fill="#f8f8f8" />
              <line x1={76} y1={124} x2={76} y2={142} stroke="#9a9a9a" strokeWidth={4} />
              <line x1={76} y1={158} x2={76} y2={176} stroke="#9a9a9a" strokeWidth={4} />
              <line x1={56} y1={142} x2={96} y2={142} stroke="#444" strokeWidth={3} />
              <line x1={66} y1={158} x2={86} y2={158} stroke="#444" strokeWidth={8} />
            </g>
          )}
          <text x={44} y={155} textAnchor="end" style={{ fontSize: 15, fontWeight: 500, fill: '#2f6fb3' }}>
            {SUPPLY_V} V
          </text>
          <text x={134} y={86} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#ad5310' }}>
            {ac ? amps(t.primaryAmps) : 'large'}
          </text>
          <text x={494} y={86} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#ad5310' }}>
            {amps(i2)}
          </text>

          <circle cx={540} cy={150} r={22} fill={lampFill} stroke="#555" strokeWidth={2} />
          <line x1={524.4} y1={134.4} x2={555.6} y2={165.6} stroke="#555" strokeWidth={2} />
          <line x1={524.4} y1={165.6} x2={555.6} y2={134.4} stroke="#555" strokeWidth={2} />
          <text x={572} y={134} style={{ fontSize: 15, fontWeight: 500, fill: '#2f6fb3' }}>
            {volts(v2)}
          </text>
          <text x={572} y={155} style={{ fontSize: 15, fontWeight: 500, fill: '#8e4fa0' }}>
            {load} Ω
          </text>
          <text x={572} y={176} style={{ fontSize: 15, fontWeight: 500, fill: '#c4382f' }}>
            {watts(pOut)}
          </text>

          <text className="lab" x={218} y={276} textAnchor="middle">
            Primary
          </text>
          <text className="ax ax-m" x={218} y={293}>
            {n1} turns
          </text>
          <text className="lab" x={422} y={276} textAnchor="middle">
            Secondary
          </text>
          <text className="ax ax-m" x={422} y={293}>
            {n2} turns
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'voltage at the load', value: volts(v2), tone: 'blue' },
            { label: 'current in the load', value: amps(i2), tone: 'orange' },
            { label: 'power delivered', value: watts(pOut), tone: 'red' },
            { label: 'efficiency', value: ac ? pct(t.efficiency, 1) : '—' },
          ]}
        />
        <Slider label="Turns on the primary" value={n1} min={20} max={400} onChange={(v) => s.set({ n1: v })} display={`${n1} turns`} />
        <Slider label="Turns on the secondary" value={n2} min={20} max={400} onChange={(v) => s.set({ n2: v })} display={`${n2} turns`} />
        <Slider label="Load resistance" tone="violet" value={load} min={2} max={48} onChange={(v) => s.set({ load: v })} display={`${load} Ω`} />
        <div style={{ maxWidth: 400, margin: '0 auto' }}>
          <Checkbox label="Include losses" checked={losses} onChange={(v) => s.set({ losses: v })} />
        </div>
        <div className="tbwrap" style={{ maxWidth: 480, margin: '4px auto 0' }}>
          <table className="tb">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Coil</span>
                </th>
                <th scope="col">Turns</th>
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
              <tr>
                <td>Primary</td>
                <td>{n1}</td>
                <td>{volts(SUPPLY_V)}</td>
                <td>{ac ? amps(t.primaryAmps) : '—'}</td>
                <td>{ac ? watts(t.inputWatts) : '—'}</td>
              </tr>
              <tr>
                <td>Secondary</td>
                <td>{n2}</td>
                <td>{volts(v2)}</td>
                <td>{amps(i2)}</td>
                <td>{watts(pOut)}</td>
              </tr>
              {ac && losses && (
                <tr className="tot">
                  <td>Lost as heat</td>
                  <td />
                  <td />
                  <td />
                  <td>{watts(t.copperLossWatts + t.coreLossWatts)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Eq label="Voltage ratio compared with turns ratio">
          <Frac
            top={
              <K c="voltage">
                V<Sub>2</Sub>
              </K>
            }
            bottom={
              <K c="voltage">
                V<Sub>1</Sub>
              </K>
            }
          />
          <Op>=</Op>
          <Frac top={<K c="voltage">{volts(v2)}</K>} bottom={<K c="voltage">{volts(SUPPLY_V)}</K>} />
          <Op>=</Op>
          <span>{fmt(v2 / SUPPLY_V, 3)}</span>
          <Op>{ac && !losses ? '=' : '≠'}</Op>
          <Frac
            top={
              <>
                N<Sub>2</Sub>
              </>
            }
            bottom={
              <>
                N<Sub>1</Sub>
              </>
            }
          />
          <Op>=</Op>
          <Frac top={n2} bottom={n1} />
          <Op>=</Op>
          <span>{fmt(t.ratio, 3)}</span>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Because the same flux passes through both coils, it induces the same voltage in every turn of either one, so each coil’s <K c="voltage">voltage</K> is
        proportional to its number of turns. With 200 turns on the primary and 100 on the secondary, the 240 V supply becomes 120 V. That is the transformer’s defining
        rule, and the equation under the demonstration checks it: the voltages divide in the same ratio as the turns.
      </P>
      <P>
        Now look at the currents. The 12 Ω load draws 120 V ÷ 12 Ω = 10 A from the secondary, yet the supply provides only 5 A. A transformer can’t create energy, so
        when it halves the voltage it must double the current: 240 V × 5 A and 120 V × 10 A are both 1,200 W. The <K c="power">power</K> passes through unchanged, and
        only its form is traded — more voltage and less current, or the reverse. Give the secondary more turns than the primary and the transformer steps the voltage up
        instead, and then it’s the secondary current that is smaller, by the same ratio.
      </P>
      <P>
        Notice, too, that the primary current is decided by the load, not by the transformer. Raise the load’s resistance and it draws less current, and the primary
        current falls with it. A transformer simply passes along whatever power its load asks for.
      </P>

      <H2>Why direct current won’t do</H2>
      <P>
        Switch the supply to DC. A steady voltage drives a steady current through the primary, which makes a steady flux in the core — and a flux that doesn’t change
        induces nothing. The secondary goes dead and the lamp goes dark. There is a brief voltage on the secondary at the moment the switch closes, while the flux builds
        up from zero, but it vanishes as soon as the current settles; the demonstration shows the state after that.
      </P>
      <P>
        Worse, the primary loses the thing that held its current back. On AC, the changing flux also induces a voltage in the primary itself, opposing the supply, so the
        primary draws only the current its load needs. On DC there’s no such opposition, and the current is limited only by the small resistance of the copper — enough
        to overheat a real transformer quickly. This is what Lesson 1.2 meant when it said that a transformer does nothing to a steady voltage, and it’s the main reason
        the grid alternates.
      </P>

      <H2>Real transformers lose a little</H2>
      <P>
        Switch back to AC and tick “Include losses.” Two things happen in a real transformer that our ideal one ignored. Its windings have resistance, so the current
        through them turns some power into heat — the <K c="current">I</K>²<K c="resistance">R</K> loss from Lesson 1.1, here called the copper loss. And the iron core
        warms up as its magnetism is reversed 120 times a second, partly because reversing the iron’s magnetism takes energy and partly because the changing flux induces
        small currents in the iron itself. That’s the core loss, and it’s why cores are built from stacks of thin, insulated steel sheets rather than solid iron.
      </P>
      <P>
        Here the windings have a resistance of 0.4 Ω, as seen from the load, and the core loses a steady 20 W. At the starting settings the transformer then takes
        1,181 W from the supply and delivers 1,124 W, an efficiency of 95.1%. The copper loss grows with the square of the load current, while the core loss is the same
        whether the load draws anything or not. The large transformers in substations do much better than this small one, often above 99%.
      </P>
      <P>
        The winding resistance costs voltage as well as power. Almost 4 V of the 120 V is dropped inside the transformer itself, and the load gets only 116 V. Designers
        allow for this by giving the secondary a few extra turns:
      </P>

      <Challenge
        id="a"
        question="With losses switched on, choose windings that deliver 120 volts to the load while it draws 10.0 amperes."
        solved={solved}
        status={
          !ac
            ? 'Switch the supply back to AC.'
            : !losses
              ? `Losses are switched off. The load gets ${volts(v2)} and draws ${amps(i2)}.`
              : `The load gets ${volts(v2)} and draws ${amps(i2)}.`
        }
        success={`Solved. ${n2} turns against ${n1} would give ${volts(openCircuit)} with no load. The windings drop ${fmt(openCircuit - v2, 1)} V of it, leaving 120 V across the 12 Ω load.`}
      />

      <H2>From power plant to wall socket</H2>
      <P>
        The grid uses a transformer at every change of scale. A step-up transformer at the power plant raises the generator’s voltage for transmission, substations step
        it back down in stages, and a last, small transformer near each group of homes brings it down to the voltage of the wall socket. The demonstration below follows a
        typical North American chain and shows the current each stage needs to carry the same power. Choose how much power to send, and the voltage of the transmission
        line:
      </P>

      <Figure name="Transformer Lab · from plant to home" scenario={c}>
        <Segmented
          label="Power carried"
          value={c.state.power}
          onChange={(v) => c.set({ power: v })}
          options={[
            { value: '0.01', label: '10 kW' },
            { value: '1', label: '1 MW' },
            { value: '100', label: '100 MW' },
          ]}
        />
        <Segmented
          label="Transmission voltage"
          value={c.state.kv}
          onChange={(v) => c.set({ kv: v })}
          options={[
            { value: '230', label: '230 kV' },
            { value: '345', label: '345 kV' },
            { value: '500', label: '500 kV' },
            { value: '765', label: '765 kV' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 214"
          role="img"
          aria-label={`Carrying ${powerLabel} from a generator to homes. Current in each conductor: ${chain.map((st) => `${voltLabel(st)}, ${stageAmps(st.amps)}`).join('; ')}.`}
        >
          <path d="M58 120 L228 120 M252 120 L358 120 M382 120 L484 120 M508 120 Q532 120 556 134" {...WIRE} strokeWidth={3} />
          <Pylon x={136} />
          <Pylon x={200} />
          <Pylon x={305} />
          <Pole x={415} />
          <Pole x={455} />
          {XFMR_X.map((x) => (
            <Xfmr key={x} x={x} />
          ))}
          <circle cx={40} cy={120} r={18} fill="#f8f8f8" stroke="#555" strokeWidth={2} />
          <path d="M30 120 C33 112, 37 112, 40 120 S47 128, 50 120" fill="none" stroke="#555" strokeWidth={2} />
          <path d="M556 158 L556 132 L580 112 L604 132 L604 158 Z" fill="#f8f8f8" stroke="#555" strokeWidth={2} strokeLinejoin="round" />
          <rect x={574} y={142} width={12} height={16} fill="#9a9a9a" />
          {chain.map((st) => (
            <g key={st.id}>
              <text className="lab" x={STAGE_X[st.id]} y={52} textAnchor="middle">
                {STAGE_NAME[st.id]}
              </text>
              <text x={STAGE_X[st.id]} y={72} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#2f6fb3' }}>
                {voltLabel(st)}
              </text>
              <text x={STAGE_X[st.id]} y={184} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#ad5310' }}>
                {stageAmps(st.amps)}
              </text>
              <text className="ax ax-m" x={STAGE_X[st.id]} y={202}>
                {st.threePhase ? 'three-phase' : 'single-phase'}
              </text>
            </g>
          ))}
          {chain.slice(1).map((st, i) => (
            <text key={st.id} className="ax ax-m" x={XFMR_X[i]} y={102}>
              {ratioLabel(st.ratio ?? 1)}
            </text>
          ))}
        </svg>
        <Caption>
          Carrying {powerLabel}, each {fmt(Number(c.state.kv))} kV conductor needs {stageAmps(byId.transmission.amps)}; delivering the same power at 240 V would take{' '}
          {stageAmps(byId.service.amps)}.
        </Caption>
      </Figure>

      <P>
        At 1 MW, the generator’s 20 kV terminals carry 28.9 A on each of their three phases. The step-up transformer raises the voltage 17.25 times, to 345 kV, and the
        current falls 17.25 times, to 1.67 A. A substation brings the voltage down to 69 kV for subtransmission, and a distribution substation brings it down again to
        13.8 kV for the feeders that run along the streets, where the same megawatt needs 41.8 A. (On a three-phase line, the current in each conductor is the power
        divided by √3 times the voltage; the next lesson explains why.)
      </P>
      <P>
        The last transformer, on a pole or in a green metal box on the ground, connects to just one of the feeder’s three phases — 7,967 V measured to the neutral wire —
        and steps it down 33-fold to 240 V. Delivering a whole megawatt at 240 V would take 4,167 A, which is why this final stage is kept short: each of these
        transformers serves only a few nearby homes, and each home draws only its own modest share. Inside the home, the 240 V is split into two halves, giving 120 V at
        the outlets while large appliances use the full 240 V.
      </P>
      <P>
        Every transformer along the way loses a little of the power it handles, and so does every stretch of wire. How much the wires lose, and why the high-voltage stage
        is worth all this machinery, is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
