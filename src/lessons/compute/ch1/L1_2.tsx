import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  linePath,
  scale,
  useScenario,
} from '../../../framework';
import { thermalVoltage } from '../../../engines/compute/semiconductor';
import {
  NFET,
  VDD,
  drainCurrent,
  fetRegion,
  gateDelayPs,
  inverterOut,
  inverterThroughCurrent,
  offCurrent,
  onCurrent,
  subthresholdSwingMV,
  type FetParams,
} from '../../../engines/compute/transistor';
import { useRevealed } from './reveal';

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the transistor engine.

/** On current at the 0.8 V supply, µA per µm (≈ 1,002). */
export const ION = onCurrent();
/** Leakage with the gate at 0 V, µA per µm (≈ 0.00238, i.e. 2.38 nA). */
export const IOFF = offCurrent();
/** Subthreshold swing, mV per tenfold change in current (≈ 77). */
export const SWING_MV = subthresholdSwingMV();
/** Drain voltage beyond which the channel pinches off with 0.8 V on the gate (≈ 0.38 V). */
export const PINCH_V = (VDD - NFET.vth) / NFET.n;
/** The low-threshold comparison in the prose. */
export const LOW_VTH: FetParams = { ...NFET, vth: 0.2 };

/** The challenge's limits: leakage under 1 nA per µm, on current over 800 µA per µm. */
export const LEAK_LIMIT_UA = 0.001;
export const ON_TARGET_UA = 800;

/** A threshold that leaks less than 1 nA/µm and still conducts more than 800 µA/µm at 0.8 V. */
export function thresholdSolved(vth: number): boolean {
  const p = { ...NFET, vth };
  return offCurrent(VDD, p) < LEAK_LIMIT_UA && onCurrent(VDD, p) > ON_TARGET_UA;
}

/** The threshold slider's grid: 0.20–0.45 V in steps of 0.01 V. */
export const VTH = { min: 0.2, max: 0.45, step: 0.01 } as const;

/**
 * The challenge: the lowest threshold on the slider's grid — the fastest transistor — that keeps
 * the leak under 1 nA while the on current stays over 800 µA. From 0.30 V, cutting the 2.38 nA
 * leak 2.38-fold takes log₁₀ 2.38 × 77 mV ≈ 29 mV, so 0.33 V.
 */
export function lowestThresholdSolved(vth: number): boolean {
  const v = Math.round(vth * 100) / 100;
  return thresholdSolved(v) && !thresholdSolved(Math.round((v - VTH.step) * 100) / 100);
}

const VTH_GRID = Array.from({ length: Math.round((VTH.max - VTH.min) / VTH.step) + 1 }, (_, i) => Math.round((VTH.min + i * VTH.step) * 100) / 100);
/** The lowest and highest thresholds on the grid that meet both limits (0.33 and 0.35 V). */
export const LOWEST_VTH = VTH_GRID.find(thresholdSolved) ?? VTH.max;
export const HIGHEST_VTH = [...VTH_GRID].reverse().find(thresholdSolved) ?? VTH.max;

// ---------------------------------------------------------------------------
// Display helpers.

/** A current given in µA, in the most readable unit: "2.38 nA", "165.7 µA", "1,002 µA". */
export function current(uA: number): string {
  if (uA === 0) return '0 µA';
  const a = Math.abs(uA);
  const sig = (x: number) => (x >= 100 ? fmt(x) : x >= 10 ? fmt(x, 1) : fmt(x, 2));
  if (a >= 1) return `${sig(uA)} µA`;
  if (a >= 1e-3) return `${sig(uA * 1e3)} nA`;
  return `${sig(uA * 1e6)} pA`;
}

function volts(v: number, digits = 2) {
  return `${v.toFixed(digits)} V`;
}

/**
 * Electrons in the channel at a point where the channel's voltage is `v`, relative to the
 * most the gate can gather (1.0 V on the gate): the inversion charge of the same simplified
 * model the engine uses, ln(1 + e^(x/2)).
 */
function channelCharge(vg: number, v: number, p: FetParams = NFET): number {
  const vt = thermalVoltage();
  const q = (vgate: number, vch: number) => {
    const h = ((vgate - p.vth) / p.n - vch) / vt / 2;
    return h > 30 ? h : Math.log1p(Math.exp(h));
  };
  return q(vg, v) / q(1.0, 0);
}

/** Flow dots at a speed proportional to the current; still (and hidden) when it's only a leak. */
function flowStyle(uA: number) {
  const speed = (70 * uA) / 1000;
  return speed > 0.5 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const, opacity: 0 };
}

// The log-current charts: gate (or input) voltage across, µA per µm on a log scale up.
const LX = scale(0, 1, 74, 584);
const LOG_MIN = -4;
const LOG_MAX = 4;
const Y_TICKS: Array<[number, string]> = [
  [-4, '0.1 nA'],
  [-2, '10 nA'],
  [0, '1 µA'],
  [2, '100 µA'],
  [4, '10 mA'],
];

interface Curve {
  vth: number;
  vd: number;
  color: string;
  dash?: string;
  width?: number;
}

interface Mark {
  vg: number;
  uA: number;
  color: string;
  label?: string;
  anchor?: 'start' | 'end';
}

function IvChart({
  curves,
  marks,
  limits = [],
  vthLine,
  ariaLabel,
  height = 210,
}: {
  curves: Curve[];
  marks: Mark[];
  limits?: Array<{ uA: number; label: string; color: string; side: 'left' | 'right' }>;
  vthLine: number;
  ariaLabel: string;
  height?: number;
}) {
  const bottom = height - 30;
  const y = scale(LOG_MIN, LOG_MAX, bottom, 26);
  const yOf = (uA: number) => y(clamp(Math.log10(Math.max(uA, 1e-12)), LOG_MIN, LOG_MAX));
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  return (
    <svg className="chart" viewBox={`0 0 600 ${height}`} role="img" aria-label={ariaLabel}>
      <text className="ax" x={74} y={12}>
        Drain current per µm of width (log scale)
      </text>
      {Y_TICKS.map(([v, label]) => (
        <g key={v}>
          <line className={v === LOG_MIN ? 'base' : 'gl'} x1={74} x2={584} y1={y(v)} y2={y(v)} />
          <text className="ax ax-e" x={68} y={y(v) + 4}>
            {label}
          </text>
        </g>
      ))}
      <line x1={LX(vthLine)} x2={LX(vthLine)} y1={26} y2={bottom} stroke="#9a9a9a" strokeDasharray="3 4" />
      <text className="ax" x={LX(vthLine) + 5} y={bottom - 6}>
        threshold
      </text>
      {limits.map((l) => (
        <g key={l.label}>
          <line x1={74} x2={584} y1={yOf(l.uA)} y2={yOf(l.uA)} stroke={l.color} strokeWidth={1.2} strokeDasharray="6 4" />
          <text className={l.side === 'right' ? 'ax ax-e' : 'ax'} x={l.side === 'right' ? 584 : 80} y={yOf(l.uA) - 5} style={{ fill: l.color }}>
            {l.label}
          </text>
        </g>
      ))}
      {curves.map((c, i) =>
        c.vd > 0 ? (
          <path
            key={i}
            d={linePath(
              xs.map(LX),
              xs.map((vg) => yOf(drainCurrent(vg, c.vd, { ...NFET, vth: c.vth }))),
            )}
            fill="none"
            stroke={c.color}
            strokeWidth={c.width ?? 2.5}
            strokeDasharray={c.dash}
            strokeLinejoin="round"
          />
        ) : null,
      )}
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={LX(m.vg)} cy={yOf(m.uA)} r={6} fill={m.color} stroke="#fcfcfb" strokeWidth={2} />
          {m.label && (
            <text
              x={LX(m.vg) + (m.anchor === 'end' ? -10 : 10)}
              y={yOf(m.uA) + (m.anchor === 'end' ? -8 : 4)}
              textAnchor={m.anchor ?? 'start'}
              style={{ fontSize: 12, fontWeight: 500, fill: m.color }}
            >
              {m.label}
            </text>
          )}
        </g>
      ))}
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <text key={v} className="ax ax-m" x={LX(v)} y={height - 12}>
          {v === 0 ? '0' : v.toFixed(1)}
        </text>
      ))}
      <text className="ax ax-e" x={584} y={height}>
        gate voltage, V
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The cross-section of one n-channel transistor.

const ORANGE = GRAPHIC.orange;
const BLUE = TEXT.blue;

function CrossSection({ vg, vd, uA }: { vg: number; vd: number; uA: number }) {
  const ts = 16 * channelCharge(vg, 0);
  const td = 16 * channelCharge(vg, vd);
  const plus = Math.round(vg * 10);
  const region = fetRegion(vg, vd);
  return (
    <svg
      className="diagram"
      viewBox="0 0 600 270"
      role="img"
      aria-label={`Cross-section of an n-channel transistor with ${volts(vg)} on the gate and ${volts(vd)} on the drain. ${
        region === 'off' ? 'The gate is below threshold and no channel has formed' : `An electron channel joins source and drain${region === 'saturated' ? ', pinched thin at the drain end' : ''}`
      }; the drain current is ${current(uA)} per µm of width.`}
    >
      {/* Body, source, drain. */}
      <rect x={60} y={120} width={480} height={118} rx={4} fill="#f1ede6" />
      <path d="M86 120 H214 V158 Q214 178 194 178 H106 Q86 178 86 158 Z" fill="#dce7f2" />
      <path d="M386 120 H514 V158 Q514 178 494 178 H406 Q386 178 386 158 Z" fill="#dce7f2" />
      <text className="ax ax-m" x={150} y={198}>
        n-type source
      </text>
      <text className="ax ax-m" x={450} y={198}>
        n-type drain
      </text>
      <text className="ax ax-m" x={300} y={228}>
        p-type silicon (the body)
      </text>
      {/* Channel: electrons gathered under the gate, thinning toward the drain when it pinches off. */}
      {ts > 0.3 && <path d={`M214 121 L386 121 L386 ${121 + td} L214 ${121 + ts} Z`} fill={ORANGE} opacity={0.75} />}
      {/* Insulator and gate. */}
      <rect x={204} y={112} width={192} height={8} fill="#cfcabd" />
      <rect x={204} y={80} width={192} height={32} rx={2} fill="#a9a9a9" />
      {Array.from({ length: plus }, (_, i) => (
        <text key={i} x={214 + ((i + 0.5) * 172) / Math.max(plus, 1)} y={101} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: '#fcfcfb' }}>
          +
        </text>
      ))}
      <text className="ax" x={402} y={118}>
        insulator
      </text>
      {/* Wires to the three terminals. */}
      <path d="M120 120 L120 44 M300 80 L300 44 M480 120 L480 44" fill="none" stroke="#9a9a9a" strokeWidth={3} />
      <path d="M480 44 L480 126 L120 126 L120 44" className="flow-dots" fill="none" stroke="#e48850" strokeWidth={6} style={flowStyle(uA)} />
      {[120, 300, 480].map((x) => (
        <circle key={x} cx={x} cy={44} r={5} fill="#fcfcfb" stroke="#777" strokeWidth={2} />
      ))}
      <text x={120} y={28} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: '#444' }}>
        source · 0 V
      </text>
      <text x={300} y={28} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: BLUE }}>
        gate · {volts(vg)}
      </text>
      <text x={480} y={28} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: BLUE }}>
        drain · {volts(vd)}
      </text>
      <text x={300} y={160} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.orange }}>
        ← {current(uA)} per µm
      </text>
      <text className="ax ax-m" x={300} y={258}>
        {region === 'off' ? 'below threshold: off' : region === 'linear' ? 'on: the channel acts like a resistor' : 'on: the channel is pinched off at the drain'}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The CMOS inverter: schematic on the left, transfer curve on the right.

const VX = scale(0, 1, 330, 584);
const VY = scale(0, 1, 214, 34);

function InverterDiagram({ vin, vdd, vout, curve }: { vin: number; vdd: number; vout: number; curve: Array<[number, number]> }) {
  const qn = clamp(channelCharge(vin, 0) / channelCharge(VDD, 0), 0, 1);
  const qp = clamp(channelCharge(vdd - vin, 0) / channelCharge(VDD, 0), 0, 1);
  const chan = (q: number) => ({ stroke: q > 0.02 ? ORANGE : '#c9c9c9', opacity: 0.35 + 0.65 * Math.sqrt(q) });
  const nOn = vin > NFET.vth;
  const pOn = vdd - vin > NFET.vth;
  return (
    <svg
      className="diagram"
      viewBox="0 0 600 246"
      role="img"
      aria-label={`A CMOS inverter on a ${volts(vdd)} supply. Input ${volts(vin)}, output ${volts(vout)}. The p-channel transistor is ${pOn ? 'on' : 'off'} and the n-channel transistor is ${nOn ? 'on' : 'off'}.`}
    >
      {/* Supply rail and ground. */}
      <line x1={160} x2={220} y1={30} y2={30} stroke="#555" strokeWidth={3} />
      <text x={154} y={35} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: BLUE }}>
        supply {volts(vdd)}
      </text>
      <path d="M172 222 H208 M178 228 H202 M184 234 H196" stroke="#555" strokeWidth={2} />
      <text className="ax" x={214} y={232}>
        ground
      </text>
      {/* Wires. */}
      <path d="M190 30 V58 M190 102 V148 M190 192 V222 M190 125 H262 M40 125 H150 M150 80 V170 M150 80 H165 M150 170 H176" fill="none" stroke="#9a9a9a" strokeWidth={3} />
      {/* p-channel transistor (gate bubble: on when its gate is low). */}
      <line x1={190} x2={190} y1={58} y2={102} strokeWidth={7} strokeLinecap="round" {...chan(qp)} />
      <line x1={177} x2={177} y1={62} y2={98} stroke="#555" strokeWidth={3} />
      <circle cx={170} cy={80} r={5} fill="#fcfcfb" stroke="#555" strokeWidth={2} />
      <text x={204} y={76} style={{ fontSize: 12, fontWeight: 500, fill: '#444' }}>
        p-channel
      </text>
      <text className="ax" x={204} y={92}>
        {pOn ? 'on' : 'off'}
      </text>
      {/* n-channel transistor. */}
      <line x1={190} x2={190} y1={148} y2={192} strokeWidth={7} strokeLinecap="round" {...chan(qn)} />
      <line x1={177} x2={177} y1={152} y2={188} stroke="#555" strokeWidth={3} />
      <text x={204} y={166} style={{ fontSize: 12, fontWeight: 500, fill: '#444' }}>
        n-channel
      </text>
      <text className="ax" x={204} y={182}>
        {nOn ? 'on' : 'off'}
      </text>
      <circle cx={40} cy={125} r={5} fill="#fcfcfb" stroke="#777" strokeWidth={2} />
      <circle cx={262} cy={125} r={5} fill="#fcfcfb" stroke="#777" strokeWidth={2} />
      <circle cx={190} cy={125} r={3.5} fill="#777" />
      <circle cx={150} cy={125} r={3.5} fill="#777" />
      <text x={40} y={110} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: BLUE }}>
        in {volts(vin)}
      </text>
      <text x={262} y={110} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: BLUE }}>
        out {volts(vout)}
      </text>
      {/* Transfer curve. */}
      <text className="ax" x={330} y={16}>
        Output voltage against input voltage
      </text>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={330} x2={584} y1={VY(v)} y2={VY(v)} />
          <text className="ax ax-e" x={324} y={VY(v) + 4}>
            {v === 0 ? '0' : `${v.toFixed(1)} V`}
          </text>
          <text className="ax ax-m" x={VX(v)} y={232}>
            {v === 0 ? '0' : `${v.toFixed(1)} V`}
          </text>
        </g>
      ))}
      <line className="base" x1={330} x2={330} y1={34} y2={214} />
      <path d={linePath(curve.map((p) => VX(p[0])), curve.map((p) => VY(p[1])))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={VX(vin)} x2={VX(vin)} y1={34} y2={214} />
      <circle cx={VX(vin)} cy={VY(vout)} r={6} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={2} />
      <text className="ax ax-e" x={584} y={246}>
        input voltage
      </text>
    </svg>
  );
}

const THROUGH_TICKS: Array<[number, string]> = [
  [-4, '0.1 nA'],
  [-1, '100 nA'],
  [2, '100 µA'],
];

/** Current from supply to ground across the input range, log scale, with the present input marked. */
function ThroughChart({ vin, vdd, curve }: { vin: number; vdd: number; curve: Array<[number, number]> }) {
  const y = scale(-4, 3, 118, 24);
  const yOf = (uA: number) => y(clamp(Math.log10(Math.max(uA, 1e-12)), -4, 3));
  const now = inverterThroughCurrent(vin, vdd);
  return (
    <svg
      className="chart"
      viewBox="0 0 600 148"
      role="img"
      aria-label={`Current flowing straight from supply to ground through the inverter, per µm: ${current(now)} at an input of ${volts(vin)}, peaking at ${current(inverterThroughCurrent(vdd / 2, vdd))} when the input is halfway.`}
    >
      <text className="ax" x={74} y={12}>
        Current straight from supply to ground, per µm (log scale)
      </text>
      {THROUGH_TICKS.map(([v, label]) => (
        <g key={v}>
          <line className="gl" x1={74} x2={584} y1={y(v)} y2={y(v)} />
          <text className="ax ax-e" x={68} y={y(v) + 4}>
            {label}
          </text>
        </g>
      ))}
      <line className="base" x1={74} x2={584} y1={118} y2={118} />
      <path d={linePath(curve.map((p) => LX(p[0])), curve.map((p) => yOf(p[1])))} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={LX(vin)} x2={LX(vin)} y1={24} y2={118} />
      <circle cx={LX(vin)} cy={yOf(now)} r={6} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <text key={v} className="ax ax-m" x={LX(v)} y={134}>
          {v === 0 ? '0' : v.toFixed(1)}
        </text>
      ))}
      <text className="ax ax-e" x={584} y={148}>
        input voltage, V
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  // Figure 1: one transistor.
  const s1 = useScenario('transistor', { vg: 0, vd: 0.8 });
  const { vg, vd } = s1.state;
  const id = drainCurrent(vg, vd);

  // Figure 2: the threshold voltage.
  const s2 = useScenario('threshold', { vth: NFET.vth });
  const vth = s2.state.vth;
  const p2 = { ...NFET, vth };
  const on2 = onCurrent(VDD, p2);
  const off2 = offCurrent(VDD, p2);
  const solved = lowestThresholdSolved(vth);
  // The size of the leak, which would answer the challenge, stays hidden until it is solved.
  const revealed = useRevealed('compute/1.2', 'a', solved);
  const weak = on2 <= ON_TARGET_UA;

  // Figure 3: the inverter.
  const s3 = useScenario('inverter', { vin: 0, vdd: VDD });
  const { vdd } = s3.state;
  const vin = Math.min(s3.state.vin, vdd);
  const vout = inverterOut(vin, vdd);
  const through = inverterThroughCurrent(vin, vdd);
  const curves = useMemo(() => {
    const xs = Array.from({ length: 81 }, (_, i) => (i / 80) * vdd);
    return {
      transfer: xs.map((x) => [x, inverterOut(x, vdd)] as [number, number]),
      through: xs.map((x) => [x, inverterThroughCurrent(x, vdd)] as [number, number]),
    };
  }, [vdd]);

  // Prose numbers.
  const ratio = ION / IOFF;
  const lowOn = onCurrent(VDD, LOW_VTH);
  const lowOff = offCurrent(VDD, LOW_VTH);
  const delay = gateDelayPs();
  const lowDelay = gateDelayPs(VDD, LOW_VTH);
  const midI = inverterThroughCurrent(VDD / 2);

  return (
    <LessonPage id="compute/1.2">
      <P>
        The previous lesson ended with a one-way valve: a junction of p-type and n-type silicon that lets current through when it’s pushed one way and blocks it when
        it’s pushed the other. A valve like that responds only to the voltage across it. A computer needs something more: a switch that is opened and closed by a{' '}
        <em>separate</em> signal, so that the output of one switch can set the next. The device that does this, in every processor and memory chip made today, is the
        metal–oxide–semiconductor field-effect transistor, or MOSFET. A large GPU contains tens of billions of them.
      </P>
      <P>
        Start with a block of p-type silicon, the <b>body</b>, and dope two small islands in it n-type: the <b>source</b> and the <b>drain</b>. An electron setting out
        from the source toward the drain would have to cross p-type silicon, through two p–n junctions back to back, and whichever way the drain voltage points, one of
        them is reverse-biased. So no current flows. Over the gap between the islands sits the <b>gate</b>: a conductor separated from the silicon by an insulating
        layer only nanometers thick. The gate touches nothing. It acts on the silicon only through its electric field.
      </P>
      <P>
        The next demonstration is a slice through one such transistor, with the source connected to 0 V. Currents here are given per micrometer of the transistor’s
        width, its extent into the page; a transistor in a modern chip is a small fraction of a micrometer wide. Moving dots show the{' '}
        <K c="current">drain current</K>, and the chart plots it on a logarithmic scale, where each gridline is a hundred times the one beneath. Raise the{' '}
        <K c="voltage">gate voltage</K>, then change the drain voltage:
      </P>

      <Figure name="Transistor Simulator" scenario={s1}>
        <CrossSection vg={vg} vd={vd} uA={id} />
        <IvChart
          curves={[{ vth: NFET.vth, vd, color: GRAPHIC.orange }]}
          marks={[{ vg, uA: id, color: GRAPHIC.orange }]}
          vthLine={NFET.vth}
          ariaLabel={`Drain current against gate voltage on a log scale, with the drain at ${volts(vd)}. At ${volts(vg)} on the gate the current is ${current(id)} per µm.`}
        />
        <Slider label="Gate voltage" tone="blue" value={vg} min={0} max={1} step={0.01} onChange={(v) => s1.set({ vg: v })} display={volts(vg)} />
        <Slider label="Drain voltage" tone="blue" value={vd} min={0} max={1} step={0.05} onChange={(v) => s1.set({ vd: v })} display={volts(vd)} />
      </Figure>

      <P>
        A positive gate pulls electrons — the scarce minority carriers in p-type silicon — up to the surface just beneath it, and pushes holes away. Once the gate passes
        the <K c="voltage">threshold voltage</K>, {volts(NFET.vth)} for this transistor, the electrons at the surface outnumber the holes: a thin layer under the gate
        has been turned into n-type silicon, and that <b>channel</b> joins the source to the drain. With {volts(VDD)} on both the gate and the drain, about{' '}
        {fmt(Math.round(ION / 10) * 10)} µA flows for every micrometer of width. Past threshold, the current in our simplified model grows with the square of how far the gate is
        above it.
      </P>
      <P>
        The drain voltage plays a smaller part. With only a little of it, the channel behaves like a resistor, and the current rises in proportion to the drain voltage.
        Raise it past about {volts(PINCH_V)} (with {volts(VDD)} on the gate) and the end of the channel nearest the drain thins to almost nothing — it is{' '}
        <b>pinched off</b> — and the current stops growing. In this saturated state the gate alone decides how much flows. And the gate itself draws almost no steady current:
        the insulator sees to that. Holding the gate at a voltage costs next to nothing; changing it is what costs energy, by moving charge on and off the gate. That is what lets
        one transistor’s output drive the gates of several others, and it is the root of how a chip spends its power, as we’ll see in{' '}
        <a href={lessonHref('compute/1.5')}>Lesson 1.5</a>.
      </P>

      <H2>Off is not zero</H2>
      <P>
        Look again at the chart in <FigRef to="Transistor Simulator">the first demonstration</FigRef>, at gate voltages under the threshold. The current doesn’t stop; it falls in a straight line
        on the log scale, tenfold for every {fmt(SWING_MV)} mV the gate drops. Electrons in the source have the random thermal energy of everything at room temperature,
        and a few always have enough to climb over the barrier the gate leaves in their way. Their number falls exponentially as the barrier rises, so the current does
        too. That decline can’t be made arbitrarily steep: at room temperature no conventional transistor can do better than about 60 mV per tenfold change, and ours
        manages {fmt(SWING_MV)}. With the gate at 0 V, the transistor still has a <K c="loss">leakage</K> current of {current(IOFF)} per micrometer. On, it passes about{' '}
        {fmt(Math.round(ratio / 10000) * 10000)} times as much.
      </P>
      <P>
        That makes a good switch, not a perfect one, and a chip has billions of them sitting off at any moment. Their leaks add up to a share of a chip’s power that it
        pays whether or not it is computing anything. How big that share is depends largely on where the threshold is put, which chipmakers set with the doping under
        the gate and the choice of gate material. In the next demonstration, move the threshold and watch both ends of the curve: the current with {volts(VDD)}{' '}
        on the gate, and the leak with it at 0 V, whose size stays hidden until you’ve solved the challenge that follows. Once you move the threshold, a dashed
        curve keeps the {volts(NFET.vth)} transistor we started with for comparison. The readout is how long a logic gate built from these transistors takes to
        switch — to swing the inputs of the four or so gates it drives, and the wire to them, halfway to the new level — which{' '}
        <a href={lessonHref('compute/1.3')}>Lesson 1.3</a> will call a gate delay:
      </P>

      <Figure name="Transistor Simulator · threshold" scenario={s2}>
        <IvChart
          curves={[
            ...(Math.abs(vth - NFET.vth) > 1e-9 ? [{ vth: NFET.vth, vd: VDD, color: '#9a9a9a', dash: '5 4', width: 1.5 }] : []),
            { vth, vd: VDD, color: GRAPHIC.orange },
          ]}
          marks={[
            // Until the challenge is solved, the leak's mark is neutral and unlabeled with its size.
            {
              vg: 0,
              uA: off2,
              color: revealed ? (off2 < LEAK_LIMIT_UA ? TEXT.green : TEXT.red) : GRAPHIC.orange,
              label: revealed ? `leaks ${current(off2)}` : 'leak: ?',
            },
            { vg: VDD, uA: on2, color: on2 > ON_TARGET_UA ? TEXT.green : TEXT.red, label: `${current(on2)} on`, anchor: 'end' },
          ]}
          limits={[
            { uA: LEAK_LIMIT_UA, label: 'leakage limit, 1 nA', color: TEXT.red, side: 'right' },
            { uA: ON_TARGET_UA, label: 'on-current target, 800 µA', color: TEXT.green, side: 'left' },
          ]}
          vthLine={vth}
          height={230}
          ariaLabel={`Drain current against gate voltage with the drain at ${volts(VDD)}, for a threshold of ${volts(vth)}: ${current(on2)} per µm with the gate at ${volts(VDD)}${
            revealed ? `, and a leak of ${current(off2)} per µm with the gate at 0 V` : ''
          }.`}
        />
        <Legend
          items={[
            { label: `threshold ${volts(vth)}`, color: GRAPHIC.orange, kind: 'line' as const },
            // The dashed reference curve is drawn only once the threshold has moved.
            ...(Math.abs(vth - NFET.vth) > 1e-9 ? [{ label: `threshold ${volts(NFET.vth)}`, color: '#9a9a9a', kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <Readouts items={[{ label: 'one gate’s switching time', value: `${fmt(gateDelayPs(VDD, p2), 1)} ps`, tone: 'teal' }]} />
        <Slider
          label="Threshold voltage"
          tone="blue"
          value={vth}
          min={VTH.min}
          max={VTH.max}
          step={VTH.step}
          onChange={(v) => s2.set({ vth: Math.round(v * 100) / 100 })}
          display={volts(vth)}
        />
        <Eq label="The on/off ratio: on current divided by leakage">
          <span>on/off ratio</span>
          <Op>=</Op>
          <Frac
            top={
              <K c="current">
                I<Sub>on</Sub>
              </K>
            }
            bottom={
              <K c="power">
                I<Sub>off</Sub>
              </K>
            }
          />
          <Op>=</Op>
          <Frac top={<K c="current">{current(on2)}</K>} bottom={<K c="power">{revealed ? current(off2) : '?'}</K>} />
          <Op>=</Op>
          <span>{revealed ? fmt(on2 / off2) : '?'}</span>
        </Eq>
      </Figure>

      <Challenge
        id="a"
        question={`Predict first: the leak falls tenfold for every ${fmt(SWING_MV)} mV the threshold rises. How far must the threshold rise from ${volts(NFET.vth)} to bring the ${current(IOFF)} leak under 1 nA? Then set the lowest threshold, to the hundredth of a volt, that does it — the fastest transistor within the limit — and check that the on current stays above 800 µA. The leak’s size stays hidden until you do.`}
        solved={solved}
        status={
          weak
            ? `At ${volts(vth)}, the on current is ${current(on2)} per µm: under the 800 µA target.`
            : `At ${volts(vth)}, the transistor passes ${current(on2)} per µm. Is this the lowest threshold that keeps the leak under 1 nA? Work out the rise from the ${fmt(SWING_MV)} mV per tenfold.`
        }
        success={`Solved. Cutting the leak ${fmt(IOFF / LEAK_LIMIT_UA, 2)}-fold takes log₁₀ ${fmt(IOFF / LEAK_LIMIT_UA, 2)} ≈ ${fmt(Math.log10(IOFF / LEAK_LIMIT_UA), 2)} of a tenfold step, and ${fmt(Math.log10(IOFF / LEAK_LIMIT_UA), 2)} × ${fmt(SWING_MV)} mV ≈ ${fmt(Math.log10(IOFF / LEAK_LIMIT_UA) * SWING_MV)} mV, so ${volts(LOWEST_VTH)} is the lowest threshold under the limit: it leaks ${current(offCurrent(VDD, { ...NFET, vth: LOWEST_VTH }))} and still passes ${current(onCurrent(VDD, { ...NFET, vth: LOWEST_VTH }))} per µm. Thresholds up to ${volts(HIGHEST_VTH)} meet both limits; each 10 mV higher cuts the leak by about a quarter but costs on current, and so speed.`}
      />

      <P>
        The trade is steep. Lowering the threshold by a tenth of a volt, from 0.30 V to 0.20 V, buys {fmt((lowOn / ION - 1) * 100)}% more on current — {current(lowOn)}{' '}
        per micrometer instead of {current(ION)} — and a gate built from such transistors takes {fmt((1 - lowDelay / delay) * 100)}% less time to switch. But the leakage grows{' '}
        {fmt(lowOff / IOFF)} times, to {current(lowOff)}. Real chips don’t settle for one answer: manufacturers offer several threshold voltages on the same chip, and
        designers put the fast, leaky transistors only on the paths that limit how fast the chip can run, and slower, tighter ones everywhere else.
      </P>

      <H2>Two transistors make an inverter</H2>
      <P>
        One n-channel transistor can pull a wire down toward 0 V, but it can’t pull it back up. For that, chips pair it with its mirror image, a p-channel transistor:
        p-type source and drain in n-type silicon, with holes forming the channel. It turns on when its gate is <em>low</em> compared with its source. Put the p-channel
        transistor between the supply and an output wire, the n-channel transistor between the output and ground, and drive both gates from one input. A high input
        turns the n-channel transistor on and the p-channel transistor off, so the output is pulled to ground; a low input does the opposite and the output is pulled
        to the supply. This pairing is called CMOS, for complementary MOS, and it is how nearly every digital chip is built. In the next demonstration, sweep the
        input voltage, and then change the supply:
      </P>

      <Figure name="Transistor Simulator · inverter" scenario={s3}>
        <InverterDiagram vin={vin} vdd={vdd} vout={vout} curve={curves.transfer} />
        <ThroughChart vin={vin} vdd={vdd} curve={curves.through} />
        <Readouts
          items={[
            { label: 'current from supply to ground, per µm', value: current(through), tone: 'orange' },
            { label: 'one gate’s switching time', value: `${fmt(gateDelayPs(vdd), 1)} ps`, tone: 'teal' },
          ]}
        />
        <Slider label="Input voltage" tone="blue" value={vin} min={0} max={vdd} step={0.01} onChange={(v) => s3.set({ vin: v })} display={volts(vin)} />
        <Slider
          label="Supply voltage"
          tone="blue"
          value={vdd}
          min={0.5}
          max={1}
          step={0.05}
          onChange={(v) => s3.set((s) => ({ vdd: Math.round(v * 100) / 100, vin: Math.min(s.vin, Math.round(v * 100) / 100) }))}
          display={volts(vdd)}
        />
      </Figure>

      <P>
        The output is the opposite of the input: this is the NOT of logic, and a sharp one. On the {volts(VDD)} supply, the output stays above{' '}
        {volts(Math.floor(inverterOut(0.38) * 100) / 100)} until the input reaches 0.38 V, and is below {volts(Math.ceil(inverterOut(0.42) * 100) / 100)} by 0.42 V. A little noise on the input changes nothing at
        the output, and each gate hands the next one clean, full-sized levels. That restoring action is why a digital signal can pass through thousands of gates in a
        row without blurring.
      </P>
      <P>
        Now watch the current. With the input at either end, one of the two transistors is off, so the only current from supply to ground is a{' '}
        {current(IOFF)} leak. Only partway through a switch do both conduct at once, peaking at {current(midI)} per micrometer with the input at 0.4 V — more than{' '}
        {fmt(Math.floor(midI / IOFF / 1000) * 1000)} times the leak. The bigger cost of a switch is the charge needed to swing the next gates’ inputs from one level to
        the other. Either way, a CMOS circuit spends most of its energy when it switches; while it holds its state it pays only the leak. So a chip’s power depends
        largely on how often its transistors switch.
      </P>
      <P>
        The supply voltage sets how fast they can. Less voltage means less on current to charge the next gate, so the gate is slower: in our model one switches in about{' '}
        {fmt(delay, 0)} ps on a {volts(VDD, 1)} supply, {fmt(gateDelayPs(0.6), 1)} ps on 0.6 V and {fmt(gateDelayPs(1.0), 1)} ps on 1.0 V. Speed, voltage and power
        are tied together, and untangling them is the subject of <a href={lessonHref('compute/1.5')}>Lesson 1.5</a>.
      </P>
      <P>
        An inverter computes just one thing. In the next lesson we’ll wire transistors into gates that compute AND, OR and XOR, and wire those into a circuit that adds.
      </P>
    </LessonPage>
  );
}
