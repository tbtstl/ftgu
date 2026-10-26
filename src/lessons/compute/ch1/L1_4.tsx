import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FigRef,
  Figure,
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
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  pct,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import {
  FORMATS,
  FORMAT_IDS,
  RETENTION_HALVING_C,
  SENSE_THRESHOLD,
  bitsOf,
  cellCharge,
  encode,
  epsilon,
  refreshOverhead,
  refreshTrace,
  relativeError,
  retentionMs,
  storageBytes,
  survivesRefresh,
  type FormatId,
} from '../../../engines/compute/memory';
import { arrayMultiplier } from '../../../engines/compute/logic';
import { ACCELERATORS } from '../../../model/compute/hardware';
import { MODELS, paramCount } from '../../../model/compute/models';
import { useRevealed } from './reveal';

// ---------------------------------------------------------------------------
// The DRAM cell: the weakest cell's charge over half a second, with refresh.

/** Milliseconds of cell time the chart spans. */
export const SPAN_MS = 512;
/** Milliseconds of cell time that pass per second of animation. */
const SIM_SPEED = 128;
export const INTERVAL = { min: 8, max: 256, step: 2 } as const;
export const TEMP = { min: 25, max: 105, step: 1 } as const;
export const CELL_DEFAULTS = { cell: 'dram' as 'dram' | 'sram', interval: 64, temp: 85 };
/** The standard refresh interval the first challenge holds fixed, ms. */
export const STANDARD_INTERVAL = 64;

/**
 * The first challenge: with the standard 64 ms refresh, the hottest whole degree at which the weakest
 * cell keeps its bit. The halving rule predicts it: 85 + 10 × log₂(100/64) ≈ 91.4, so 91 °C.
 */
export function hottestAt64Solved(cell: 'dram' | 'sram', temp: number, interval: number): boolean {
  return cell === 'dram' && interval === STANDARD_INTERVAL && survivesRefresh(interval, temp) && !survivesRefresh(interval, temp + TEMP.step);
}

/** Fraction of full voltage on the weakest cell `t` ms after a 1 was written, refreshed every `interval` ms. */
export function chargeAt(t: number, interval: number, temp: number): number {
  const k = Math.floor(t / interval);
  if (k === 0 || survivesRefresh(interval, temp)) return cellCharge(t - k * interval, temp);
  return 0;
}

/** "100 ms" or "1.6 s". */
function duration(ms: number): string {
  return ms < 1000 ? `${fmt(ms)} ms` : `${fmt(ms / 1000, 1)} s`;
}

const VOLT = GRAPHIC.blue;
const CX = scale(0, SPAN_MS, 284, 624);
const CY = scale(0, 1, 196, 36);

/** The DRAM cell: a word line, a bit line, an access transistor and a capacitor, with its charge as a gauge. */
function DramCell({ charge }: { charge: number }) {
  const reads = charge >= SENSE_THRESHOLD;
  const gTop = 96;
  const gBot = 196;
  const gy = gBot - (gBot - gTop) * charge;
  return (
    <g>
      <line x1={14} x2={236} y1={56} y2={56} stroke="#9a9a9a" strokeWidth={2.5} />
      <text className="ax" x={14} y={46}>
        word line
      </text>
      <line x1={36} x2={36} y1={56} y2={214} stroke="#9a9a9a" strokeWidth={2.5} />
      <text className="ax ax-m" x={36} y={230}>
        bit line
      </text>
      {/* Access transistor */}
      <line x1={36} x2={70} y1={130} y2={130} stroke="#555" strokeWidth={2} />
      <rect x={70} y={124} width={40} height={12} fill="#e6e6e3" stroke="#555" strokeWidth={1.5} />
      <line x1={70} x2={110} y1={115} y2={115} stroke="#333" strokeWidth={3} />
      <line x1={90} x2={90} y1={56} y2={115} stroke="#555" strokeWidth={2} />
      <line x1={110} x2={140} y1={130} y2={130} stroke="#555" strokeWidth={2} />
      {/* Capacitor */}
      <line x1={140} x2={140} y1={130} y2={150} stroke="#555" strokeWidth={2} />
      <line x1={118} x2={162} y1={150} y2={150} stroke="#333" strokeWidth={3} />
      <line x1={118} x2={162} y1={162} y2={162} stroke="#333" strokeWidth={3} />
      <line x1={140} x2={140} y1={162} y2={186} stroke="#555" strokeWidth={2} />
      <line x1={128} x2={152} y1={186} y2={186} stroke="#555" strokeWidth={2} />
      <line x1={133} x2={147} y1={191} y2={191} stroke="#555" strokeWidth={2} />
      <line x1={137} x2={143} y1={196} y2={196} stroke="#555" strokeWidth={2} />
      <text className="ax ax-m" x={78} y={154}>
        transistor
      </text>
      <text className="ax" x={118} y={212}>
        capacitor
      </text>
      {/* Charge gauge */}
      <rect x={196} y={gTop} width={30} height={gBot - gTop} fill="#fcfcfb" stroke="#bdbdb9" />
      <rect x={196} y={gy} width={30} height={gBot - gy} fill={VOLT} opacity={0.75} />
      <line x1={190} x2={232} y1={(gTop + gBot) / 2} y2={(gTop + gBot) / 2} stroke="#555" strokeDasharray="3 3" />
      <text className="ax ax-m" x={211} y={88}>
        charge
      </text>
      <text x={211} y={214} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: reads ? TEXT.blue : TEXT.red }}>
        reads {reads ? '1' : '0'}
      </text>
    </g>
  );
}

/** Inverter symbol: a triangle pointing right (dir 1) or left (dir −1) with its output bubble. */
function Inverter({ x, y, dir }: { x: number; y: number; dir: 1 | -1 }) {
  const w = 34;
  const h = 30;
  const tip = x + dir * w;
  return (
    <g>
      <path d={`M${x} ${y - h / 2} L${x} ${y + h / 2} L${tip} ${y} Z`} fill="#fcfcfb" stroke="#333" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={tip + dir * 4} cy={y} r={4} fill="#fcfcfb" stroke="#333" strokeWidth={2} />
    </g>
  );
}

/** The SRAM cell: two cross-coupled inverters and two access transistors. */
function SramCell() {
  const node = (x: number, y: number, v: string) => (
    <g>
      <circle cx={x} cy={y} r={11} fill={v === '1' ? tint(VOLT, 0.35) : '#fcfcfb'} stroke={VOLT} strokeWidth={1.5} />
      <text x={x} y={y + 4.5} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.blue }}>
        {v}
      </text>
    </g>
  );
  return (
    <g>
      <line x1={14} x2={236} y1={50} y2={50} stroke="#9a9a9a" strokeWidth={2.5} />
      <text className="ax" x={14} y={40}>
        word line
      </text>
      <line x1={22} x2={22} y1={50} y2={214} stroke="#9a9a9a" strokeWidth={2.5} />
      <line x1={226} x2={226} y1={50} y2={214} stroke="#9a9a9a" strokeWidth={2.5} />
      <text className="ax ax-m" x={124} y={230}>
        bit lines on either side
      </text>
      {/* Cross-coupled pair */}
      <Inverter x={98} y={110} dir={1} />
      <Inverter x={150} y={170} dir={-1} />
      <path d="M136 110 L176 110 L176 170 L150 170" fill="none" stroke="#555" strokeWidth={2} />
      <path d="M112 170 L72 170 L72 110 L98 110" fill="none" stroke="#555" strokeWidth={2} />
      {/* Access transistors to the bit lines */}
      <line x1={22} x2={40} y1={140} y2={140} stroke="#555" strokeWidth={2} />
      <rect x={40} y={134} width={18} height={12} fill="#e6e6e3" stroke="#555" strokeWidth={1.5} />
      <line x1={58} x2={72} y1={140} y2={140} stroke="#555" strokeWidth={2} />
      <line x1={49} x2={49} y1={50} y2={128} stroke="#555" strokeWidth={1.5} />
      <line x1={40} x2={58} y1={128} y2={128} stroke="#333" strokeWidth={2.5} />
      <line x1={176} x2={190} y1={140} y2={140} stroke="#555" strokeWidth={2} />
      <rect x={190} y={134} width={18} height={12} fill="#e6e6e3" stroke="#555" strokeWidth={1.5} />
      <line x1={208} x2={226} y1={140} y2={140} stroke="#555" strokeWidth={2} />
      <line x1={199} x2={199} y1={50} y2={128} stroke="#555" strokeWidth={1.5} />
      <line x1={190} x2={208} y1={128} y2={128} stroke="#333" strokeWidth={2.5} />
      {node(72, 140, '1')}
      {node(176, 140, '0')}
      <text className="ax ax-m" x={124} y={206}>
        each inverter holds up the other
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Number formats.

/** Starts in FP16, so the second challenge needs a deliberate switch to the format with the range. */
export const FORMAT_DEFAULTS = { value: Math.PI, neg: false, format: 'fp16' as FormatId };
const LOG_MIN = -8;
const LOG_MAX = 6;
const PRESETS: Array<{ label: string; value: number }> = [
  { label: 'π', value: Math.PI },
  { label: '0.1', value: 0.1 },
  { label: '70,000', value: 70000 },
  { label: '0.00001', value: 1e-5 },
];

/** The second challenge: a number larger than FP16's 65,504, stored in a 16-bit format without overflowing. */
export function sixteenBitSolved(value: number, format: FormatId): boolean {
  const f = FORMATS[format];
  return f.bits === 16 && Math.abs(value) > FORMATS.fp16.max && !encode(value, f).overflow;
}

/** Milliseconds the A-class takes to read its whole memory once at full bandwidth (GB ÷ TB/s = ms; about 24). */
export const READ_ALL_MS = ACCELERATORS.A.memoryGB / ACCELERATORS.A.bandwidthTBs;

/** The number the prose rounds into each format: a repeating fraction in binary. */
export const TENTH = 0.1;

/** The 70B model's weights in each format, bytes. */
export function modelBytes(format: FormatId): number {
  return storageBytes(paramCount(MODELS['70B']), FORMATS[format]);
}

const SUPERS: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** A readable number: plain digits in a sensible range, else "3.4 × 10³⁸". */
export function num(x: number, sig = 9): string {
  if (x === 0) return '0';
  const a = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (a >= 1e-4 && a < 1e7) {
    const s = Number(a.toPrecision(sig));
    const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(s)));
    const str = s.toLocaleString('en-US', { maximumFractionDigits: Math.min(20, digits) });
    return sign + str;
  }
  const e = Math.floor(Math.log10(a));
  const m = Number((a / 10 ** e).toPrecision(Math.min(sig, 3)));
  return `${sign}${m} × 10${String(e)
    .split('')
    .map((c) => SUPERS[c] ?? c)
    .join('')}`;
}

/** "about 1 part in 3,247", "exact". */
export function errorText(x: number, format: FormatId): string {
  const enc = encode(x, FORMATS[format]);
  if (enc.overflow) return `overflow: clamped to ${num(FORMATS[format].max, 6)}`;
  if (enc.underflow) return 'underflow: stored as 0';
  const r = relativeError(x, FORMATS[format]);
  if (r === 0) return 'exact';
  return `1 part in ${fmt(1 / r)}`;
}

const SIGN_C = '#777777';
const EXP_C = GRAPHIC.violet;
const MAN_C = GRAPHIC.blue;
const BW = 19;
const GAP = 10;

function BitBoxes({ format, value }: { format: FormatId; value: number }) {
  const f = FORMATS[format];
  const enc = encode(value, f);
  const b = bitsOf(enc, f);
  const groups = [
    { name: 'sign', bits: [b.sign], color: SIGN_C, text: TEXT.gray },
    { name: 'exponent', bits: b.exp, color: EXP_C, text: TEXT.violet },
    { name: 'mantissa', bits: b.man, color: MAN_C, text: TEXT.blue },
  ];
  let x = 16;
  const placed = groups.map((g) => {
    const x0 = x;
    x += g.bits.length * BW + GAP;
    return { ...g, x0 };
  });
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 92"
      role="img"
      aria-label={`${f.name}: ${f.bits} bits. Sign ${b.sign}, exponent ${b.exp.join('')}, mantissa ${b.man.join('')}. They represent ${num(enc.value)}.`}
    >
      {placed.map((g) => (
        <g key={g.name}>
          <text x={g.name === 'sign' ? g.x0 + BW / 2 : g.x0} y={24} textAnchor={g.name === 'sign' ? 'middle' : 'start'} style={{ fontSize: 12, fontWeight: 500, fill: g.text }}>
            {g.name}
          </text>
          {g.bits.map((bit, i) => (
            <g key={i}>
              <rect x={g.x0 + i * BW} y={32} width={BW - 2} height={30} rx={2} fill={bit ? g.color : tint(g.color, 0.15)} stroke={g.color} strokeWidth={1} />
              <text x={g.x0 + i * BW + (BW - 2) / 2} y={52} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: bit ? '#fff' : g.text }}>
                {bit}
              </text>
            </g>
          ))}
          <text className="ax" x={g.name === 'sign' ? g.x0 + BW / 2 : g.x0} y={80} textAnchor={g.name === 'sign' ? 'middle' : 'start'}>
            {g.bits.length} bit{g.bits.length > 1 ? 's' : ''}
          </text>
        </g>
      ))}
    </svg>
  );
}

const MX = scale(0, 300, 76, 604);
const ROW_H = 24;

function ModelBars({ format }: { format: FormatId }) {
  const cap = ACCELERATORS.A.memoryGB;
  const order: FormatId[] = ['fp32', 'bf16', 'fp16', 'fp8'];
  const gb = modelBytes(format) / 1e9;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 142"
      role="img"
      aria-label={`The 70B model’s weights take ${fmt(gb)} GB in ${FORMATS[format].name}, against the ${cap} GB of one A-class GPU: ${gb <= cap ? 'they fit' : 'they don’t fit'}.`}
    >
      <text className="ax" x={76} y={14}>
        The 70B model’s weights
      </text>
      {order.map((id, i) => {
        const v = modelBytes(id) / 1e9;
        const y = 30 + i * ROW_H;
        const on = id === format;
        const fits = v <= cap;
        // Keep the value clear of the dashed capacity line.
        const lx = MX(v) + 6 < MX(cap) + 4 && MX(v) + 62 > MX(cap) ? MX(cap) + 6 : MX(v) + 6;
        return (
          <g key={id}>
            <text x={68} y={y + 13} textAnchor="end" style={{ fontSize: 12, fontWeight: on ? 600 : 400, fill: on ? '#111' : '#6f6f6f' }}>
              {FORMATS[id].name}
            </text>
            <rect x={MX(0)} y={y} width={MX(v) - MX(0)} height={ROW_H - 8} fill={on ? (fits ? GRAPHIC.violet : GRAPHIC.red) : tint(GRAPHIC.violet, 0.25)} />
            <text x={lx} y={y + 13} style={{ fontSize: 12, fontWeight: on ? 600 : 400, fill: on ? (fits ? TEXT.violet : TEXT.red) : '#6f6f6f' }}>
              {fmt(v)} GB
            </text>
          </g>
        );
      })}
      <line x1={MX(cap)} x2={MX(cap)} y1={24} y2={126} stroke="#333" strokeWidth={1.5} strokeDasharray="5 4" />
      <text className="ax ax-m" x={MX(cap)} y={138}>
        one A-class: {cap} GB
      </text>
    </svg>
  );
}

export default function Lesson() {
  // Figure 1: the memory cell.
  const s = useScenario('cell', CELL_DEFAULTS);
  const { cell, interval, temp } = s.state;
  const dram = cell === 'dram';
  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => (x + dt * SIM_SPEED) % SPAN_MS), play.playing);

  const trace = useMemo(() => refreshTrace(interval, temp, SPAN_MS, 24), [interval, temp]);
  const keeps = survivesRefresh(interval, temp);
  const retention = retentionMs(temp);
  const overhead = refreshOverhead(interval);
  const charge = dram ? chargeAt(t, interval, temp) : 1;
  const path = dram
    ? linePath(
        trace.map((p) => CX(p[0])),
        trace.map((p) => CY(p[1])),
      )
    : `M${CX(0)} ${CY(1)} L${CX(SPAN_MS)} ${CY(1)}`;
  const ticks: number[] = [];
  if (dram) for (let k = interval; k <= SPAN_MS + 1e-9; k += interval) ticks.push(k);
  const solvedA = hottestAt64Solved(cell, temp, interval);
  // How long the weakest cell lasts would answer the challenge, so it stays hidden until it's solved.
  const revealedA = useRevealed('compute/1.4', 'a', solvedA);

  // Figure 2: number formats.
  const nf = useScenario('formats', FORMAT_DEFAULTS);
  const { format } = nf.state;
  const f = FORMATS[format];
  const x = nf.state.neg ? -nf.state.value : nf.state.value;
  const enc = encode(x, f);
  const mag = Math.log10(nf.state.value);
  const manFactor = enc.expField === 0 ? enc.manField / 2 ** f.man : 1 + enc.manField / 2 ** f.man;
  const power = enc.expField === 0 ? 1 - f.bias : enc.expField - f.bias;
  const solvedB = sixteenBitSolved(x, format);
  const statusB = (() => {
    if (Math.abs(x) <= FORMATS.fp16.max) return `${num(Math.abs(x))} is no larger than 65,504, so FP16 could hold it too. Try 70,000.`;
    if (f.bits !== 16) return `${f.name} has ${f.bits} bits. Choose one of the 16-bit formats.`;
    return `In ${f.name}, ${num(Math.abs(x))} overflows: the largest number it can hold is ${num(f.max, 6)}.`;
  })();

  const gb70 = (id: FormatId) => modelBytes(id) / 1e9;
  const spare = ACCELERATORS.A.memoryGB - gb70('fp8');

  return (
    <LessonPage id="compute/1.4">
      <P>
        The adder of the previous lesson produces its sum a few dozen picoseconds after its inputs arrive — and forgets it the moment they change. Logic on its own
        remembers nothing. A computation needs somewhere to keep its numbers: the inputs waiting their turn, the partial results, and, for the AI models this course is
        about, billions of learned weights that are read again for every piece of text the model produces. This lesson builds the two memory cells that hold nearly
        every bit in a GPU, and then asks what the bits mean.
      </P>
      <P>
        The first cell needs nothing new. Take two of the inverters from <a href={lessonHref('compute/1.2')}>Lesson 1.2</a> and connect each one’s output to the
        other’s input. If the first outputs a 1, the second sees a 1 and outputs a 0, which is exactly what keeps the first outputting 1. The loop holds itself up,
        and it would hold the opposite state just as happily, so it stores one bit. Two more transistors connect it to the wires that read and write it: six in all.
        This is <b>static RAM</b>, or SRAM. It’s fast, and it keeps its bit for as long as it has power — though, since an off transistor still leaks, it draws a
        little current the whole time.
      </P>
      <P>
        The second cell is much smaller: one transistor and one capacitor, a pair of conducting plates that hold electric charge. A charged capacitor is a 1 and an
        empty one is a 0, and the transistor is a door. When the <i>word line</i> raises its gate, the capacitor is connected to the <i>bit line</i>, which writes
        it or reads it. This is <b>dynamic RAM</b>, or DRAM. Its capacitor holds only tens of thousands of electrons, and they seep away: through the p–n junction
        where the cell meets the silicon around it, and a little through the door, which is never quite shut. Reading it is delicate, too: a sense amplifier compares the small voltage the cell puts on the bit line with a
        reference. In our model, a cell holding less than half of its full <K c="voltage">voltage</K> reads as 0.
      </P>
      <P>
        In the next demonstration, the chart follows the weakest cell in a DRAM chip — the one that leaks fastest — after a 1 is written into it. The chip rereads
        and rewrites every cell at a fixed <K tone="teal">refresh interval</K>, and the gauge beside the cell shows its charge as time runs. Set the interval and the
        chip’s <K c="power">temperature</K>, and switch to the SRAM cell to compare:
      </P>

      <Figure name="Memory Cell Lab" scenario={s} play={play}>
        <Segmented
          label="Memory cell"
          value={cell}
          onChange={(v) => s.set({ cell: v })}
          options={[
            { value: 'dram', label: 'DRAM: 1 transistor, 1 capacitor' },
            { value: 'sram', label: 'SRAM: 6 transistors' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 240"
          role="img"
          aria-label={
            dram
              ? `A DRAM cell at ${temp} °C, refreshed every ${interval} ms. ${revealedA ? `The weakest cell keeps a readable 1 for ${duration(retention)}, so t` : 'T'}he stored 1 is ${keeps ? 'kept' : 'lost'}. Refreshing takes ${pct(overhead, 1)} of the chip’s time.`
              : 'An SRAM cell: two inverters in a loop hold a 1 for as long as the cell has power, with no refresh.'
          }
        >
          {dram ? <DramCell charge={charge} /> : <SramCell />}
          <text className="ax" x={CX(0)} y={16}>
            {dram ? 'Charge on the weakest cell, share of full voltage' : 'Voltage on the cell’s 1 node, share of full'}
          </text>
          <GridY y={CY} ticks={[0, 0.5, 1]} x0={CX(0)} x1={CX(SPAN_MS)} format={(v) => pct(v)} baseline={0} />
          <line x1={CX(0)} x2={CX(SPAN_MS)} y1={CY(SENSE_THRESHOLD)} y2={CY(SENSE_THRESHOLD)} stroke="#555" strokeWidth={1.2} strokeDasharray="5 4" />
          <text className="ax ax-e" x={CX(SPAN_MS)} y={CY(SENSE_THRESHOLD) - 5}>
            reads as 1 above this
          </text>
          {ticks.map((k) => (
            <line key={k} x1={CX(k)} x2={CX(k)} y1={CY(0)} y2={CY(0) + 6} stroke={GRAPHIC.teal} strokeWidth={1.5} />
          ))}
          <path d={path} fill="none" stroke={VOLT} strokeWidth={2.5} strokeLinejoin="round" />
          {dram && !keeps && (
            <g>
              <circle cx={CX(retention)} cy={CY(SENSE_THRESHOLD)} r={5} fill={GRAPHIC.red} />
              <text x={CX(retention) + 8} y={CY(SENSE_THRESHOLD) + 16} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.red }}>
                bit lost
              </text>
            </g>
          )}
          <line className="cur" x1={CX(t)} x2={CX(t)} y1={CY(1) - 6} y2={CY(0)} />
          {[0, 128, 256, 384, 512].map((v) => (
            <text key={v} className={v === SPAN_MS ? 'ax ax-e' : 'ax ax-m'} x={CX(v)} y={218}>
              {v === SPAN_MS ? '512 ms' : v}
            </text>
          ))}
          {dram && (
            <text className="ax" x={CX(0)} y={234} style={{ fill: TEXT.teal }}>
              ticks: refreshes
            </text>
          )}
        </svg>
        <Slider
          label="Refresh interval"
          tone="teal"
          value={interval}
          min={INTERVAL.min}
          max={INTERVAL.max}
          step={INTERVAL.step}
          onChange={(v) => s.set({ interval: v })}
          display={`${interval} ms`}
          disabled={!dram}
        />
        <Slider label="Temperature" tone="red" value={temp} min={TEMP.min} max={TEMP.max} step={TEMP.step} onChange={(v) => s.set({ temp: v })} display={`${temp} °C`} disabled={!dram} />
        <Readouts
          items={
            dram
              ? [
                  // Hidden until the challenge is solved: it would answer it.
                  { label: 'the weakest cell keeps a 1 for', value: revealedA ? duration(retention) : '?', tone: 'blue' },
                  { label: 'time spent refreshing', value: pct(overhead, 1), tone: 'teal' },
                ]
              : [
                  { label: 'the cell keeps a 1', value: 'while powered', tone: 'blue' },
                  { label: 'time spent refreshing', value: 'none', tone: 'teal' },
                ]
          }
        />
        <Caption>
          {dram
            ? keeps
              ? `Each refresh finds the weakest cell still ${revealedA ? `at ${pct(cellCharge(interval, temp))} of full voltage` : 'above the threshold'}, reads a 1 and writes it back at full strength.`
              : `The weakest cell falls below the threshold${revealedA ? ` after ${duration(retention)}` : ''}, before the refresh at ${interval} ms arrives. The refresh reads a 0 and writes back a 0: the bit is lost.`
            : 'Each inverter’s output holds up the other’s input, so the 1 never fades. The price is six transistors for every bit.'}
        </Caption>
      </Figure>

      <P>
        At 85 °C, the weakest cell holds a readable 1 for {duration(retentionMs(85))}. Refresh it every 64 ms and its charge never falls below{' '}
        {pct(cellCharge(64, 85))} of full, so the bit survives indefinitely. Stretch the interval past {duration(retentionMs(85))} and the charge slips under the
        threshold before the refresh comes. The refresh then reads a 0 and faithfully writes back a 0. The bit is gone, and nothing in the chip knows.
      </P>
      <P>
        Most cells hold their charge far longer than this one, but a memory chip is only as good as its weakest cell, so it’s refreshed for the worst. A common
        standard asks for every row of cells to be refreshed within 64 ms. Our example chip, which follows it, handles that as 8,192 refresh commands spread across
        the window, each keeping it busy for 350 ns, so it spends {pct(refreshOverhead(64), 1)} of its time refreshing rather than serving reads and writes. Halve
        the interval and that share doubles.
      </P>
      <P>
        Now raise the temperature. The leak from a DRAM cell roughly doubles for every 10 °C, so the time it can hold its charge halves: {duration(retentionMs(45))} at 45 °C,{' '}
        {duration(retentionMs(85))} at 85 °C, {duration(retentionMs(95))} at 95 °C. Real DRAM standards allow for this by halving the refresh interval, to 32 ms,
        when the chip runs above 85 °C. That matters for GPUs, which run hot with their memory packed right beside them.
      </P>

      <Challenge
        id="a"
        question={`Predict first, from the halving rule: how much hotter than 85 °C can our chip run before the standard ${STANDARD_INTERVAL} ms refresh is too slow for its weakest cell? Then, with the interval at ${STANDARD_INTERVAL} ms, find the hottest temperature, to the degree, at which the bit survives. How long the cell lasts stays hidden until you do.`}
        solved={solvedA}
        status={
          !dram
            ? 'Switch back to the DRAM cell: the SRAM cell needs no refresh.'
            : interval !== STANDARD_INTERVAL
              ? `The chip is refreshed every ${interval} ms. Set it back to ${STANDARD_INTERVAL} ms.`
              : keeps
                ? `At ${temp} °C the bit survives. Could the chip run hotter?`
                : `At ${temp} °C the bit is lost.`
        }
        success={`Solved. At ${temp} °C the weakest cell keeps its 1 for ${duration(retentionMs(temp))}, just long enough; one degree hotter, ${duration(retentionMs(temp + TEMP.step))}, and the refresh comes too late. The rule predicts it: ${STANDARD_INTERVAL} ms is ${duration(retentionMs(85))} halved ${fmt(Math.log2(retentionMs(85) / STANDARD_INTERVAL), 2)} times over, and each halving takes ${RETENTION_HALVING_C} °C, so the limit is ${fmt(RETENTION_HALVING_C * Math.log2(retentionMs(85) / STANDARD_INTERVAL), 1)} °C above 85. A straight line from ${duration(retentionMs(85))} at 85 °C to ${duration(retentionMs(95))} at 95 °C would have said ${fmt(85 + (RETENTION_HALVING_C * (retentionMs(85) - STANDARD_INTERVAL)) / (retentionMs(85) - retentionMs(95)))} °C, a degree too hot: retention halves with each ${RETENTION_HALVING_C} °C rather than falling by equal amounts.`}
      />

      <H2>Two memories in one GPU</H2>
      <P>
        Switch <FigRef to="Memory Cell Lab">the first demonstration</FigRef> back and forth between the two cells and the trade is plain. SRAM is quick and needs no
        refreshing, but six transistors take far more room than one transistor and a capacitor, so it’s used where speed matters most and only a little is needed. A
        GPU keeps its registers and caches in SRAM, right beside the arithmetic. Its main memory is DRAM.
      </P>
      <P>
        The GPU this course is built around is the <b>A-class 80 GB</b>, a fictional part with the specifications of a real data-center accelerator. It carries{' '}
        {ACCELERATORS.A.memoryGB} GB of DRAM in stacks beside the processor, called <b>high-bandwidth memory</b>, or HBM, and reads from them at{' '}
        {fmt(ACCELERATORS.A.bandwidthTBs, 2)} terabytes (trillion bytes) a second: its <K tone="violet">memory bandwidth</K>, {fmt(ACCELERATORS.A.bandwidthTBs, 2)}{' '}
        TB/s. At that rate, reading all {ACCELERATORS.A.memoryGB} GB once takes about {fmt(READ_ALL_MS)} milliseconds. Its largest block of SRAM, the L2 cache, holds {ACCELERATORS.A.l2MB} MB:{' '}
        {fmt((ACCELERATORS.A.memoryGB * 1000) / ACCELERATORS.A.l2MB)} times less.
      </P>
      <P>
        That gap, between a little fast memory and a lot of slow memory, runs through the rest of the course. Bringing a number in from off-chip DRAM takes on the
        order of a hundred times as much energy as multiplying it once it arrives, and the bandwidth caps how many numbers can arrive each second. Chapter 2 will show
        that for many of the jobs that matter most, a GPU spends more of its time waiting for memory than doing arithmetic (
        <a href={lessonHref('compute/2.4')}>Lesson 2.4</a>).
      </P>

      <H2>What the bits mean</H2>
      <P>
        A memory holds bits; what they mean is a matter of agreement. The adder in <a href={lessonHref('compute/1.3')}>Lesson 1.3</a> treated four bits as a whole
        number from 0 to 15. Neural networks need fractions, tiny numbers and large ones, so they use <b>floating point</b>, which is scientific notation in binary. A
        floating-point number has three fields. One <b>sign</b> bit says whether it’s negative. The <K tone="violet">exponent</K> says which powers of two the number
        lies between — how big it is. The <K tone="blue">mantissa</K> says where it lies between them — its precise digits. π, for example, lies between 2 and 4, so it’s
        stored as 2¹ × 1.5708…, and the mantissa holds the .5708… in binary, to as many bits as the format allows.
      </P>
      <P>
        In the next demonstration, choose a number and a format. The boxes are the bits as they’re stored, the equation decodes them back into the number they
        represent, and the bars show what the format means for a whole model:
      </P>

      <Figure name="Memory Cell Lab · number formats" scenario={nf}>
        <Segmented label="Number format" value={format} onChange={(v) => nf.set({ format: v })} options={FORMAT_IDS.map((id) => ({ value: id, label: `${FORMATS[id].name} · ${FORMATS[id].bits} bits` }))} />
        <BitBoxes format={format} value={x} />
        <Eq label={`The stored bits decode to ${num(enc.value)}`}>
          {enc.value === 0 && !enc.subnormal ? (
            <>
              <span>all exponent and mantissa bits 0</span>
              <Op>=</Op>
              <span>0</span>
            </>
          ) : (
            <>
              <span>
                (−1)<Sup>{enc.sign}</Sup>
              </span>
              <Op>×</Op>
              <span>
                2<Sup>{enc.expField === 0 ? `1 − ${f.bias}` : `${enc.expField} − ${f.bias}`}</Sup>
              </span>
              <Op>×</Op>
              <span style={{ color: TEXT.blue }}>{num(manFactor, 9)}</span>
              <Op>=</Op>
              <span>{num(enc.value)}</span>
            </>
          )}
        </Eq>
        <Readouts
          items={[
            { label: 'rounding error', value: errorText(x, format), tone: enc.overflow || enc.underflow ? 'red' : 'ink' },
            { label: `largest number in ${f.name}`, value: num(f.max, 4) },
          ]}
        />
        <Slider
          label="Size of the number"
          value={mag}
          min={LOG_MIN}
          max={LOG_MAX}
          step={0.01}
          onChange={(v) => nf.set({ value: Number((10 ** v).toPrecision(4)) })}
          display={num(nf.state.value, 6)}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 16px' }}>
          {PRESETS.map((p) => (
            <Button key={p.label} onClick={() => nf.set({ value: p.value })} label={`Choose ${p.label}`}>
              {p.label}
            </Button>
          ))}
          <Checkbox label="Negative" checked={nf.state.neg} onChange={(v) => nf.set({ neg: v })} />
        </div>
        <ModelBars format={format} />
        <Caption>
          {enc.underflow
            ? `${num(Math.abs(x))} is smaller than the smallest number ${f.name} can hold, so it’s stored as 0.`
            : `2 to the power ${power} sets the size; the mantissa, ${num(manFactor, 9)}, sets the digits.${
                enc.overflow ? ` ${num(Math.abs(x))} is too big for ${f.name}, so it’s clamped to the largest number the format has.` : ''
              }`}
        </Caption>
      </Figure>

      <P>
        Some ordinary numbers can’t be stored exactly in any format. 0.1 is a repeating fraction in binary, as ⅓ is in decimal, so every format rounds it to the
        nearest number it can represent. FP32, the standard 32-bit format, stores {num(encode(TENTH, FORMATS.fp32).value)}, off by about 1 part in{' '}
        {fmt(1 / relativeError(TENTH, FORMATS.fp32) / 1e6)} million. FP16 stores {num(encode(TENTH, FORMATS.fp16).value)}, 1 part in{' '}
        {fmt(1 / relativeError(TENTH, FORMATS.fp16))}; BF16, though also 16 bits, {num(encode(TENTH, FORMATS.bf16).value)}, 1 part in{' '}
        {fmt(1 / relativeError(TENTH, FORMATS.bf16))}; FP8, {num(encode(TENTH, FORMATS.fp8).value)}, 1 part in {fmt(1 / relativeError(TENTH, FORMATS.fp8))}. Fewer mantissa bits mean coarser steps: near 1, FP32’s steps are {num(epsilon(FORMATS.fp32), 2)} apart and
        FP8’s are {num(epsilon(FORMATS.fp8))}.
      </P>

      <H2>Range against precision</H2>
      <P>
        FP16 and BF16 spend their 16 bits differently. FP16 gives 10 bits to the mantissa and 5 to the exponent. BF16 gives only 7 to the mantissa but keeps all 8 of
        FP32’s exponent bits. So FP16 is the more precise of the two, and its largest number is {num(FORMATS.fp16.max)}. The exponent sets how far a
        format reaches; the mantissa, how finely it steps on the way.
      </P>

      <Challenge
        id="b"
        figure="Memory Cell Lab · number formats"
        question="Predict first, from how the two 16-bit formats split their bits: which one can hold 70,000, more than FP16’s 65,504, and does it reach far beyond that or only a little? Then store 70,000 — or any number larger than 65,504 — in a 16-bit format without it overflowing."
        solved={solvedB}
        status={statusB}
        success={`Solved. BF16 holds ${num(Math.abs(x))} as ${num(Math.abs(encode(x, FORMATS.bf16).value))}: rounded to its 7 mantissa bits, but in range. FP16 would have clamped it to 65,504, an error of ${pct(relativeError(70000, FORMATS.fp16), 1)} for 70,000. With all 8 of FP32’s exponent bits, BF16 reaches about ${num(FORMATS.bf16.max, 2)} — the same range as FP32.`}
      />

      <P>
        BF16 reaches about {num(FORMATS.bf16.max, 2)} — the same range as FP32 — and that range is why BF16, “brain floating point,” a format designed for neural
        networks, became the usual format for training them. During training, some
        numbers grow very large and others very small, and one that overflows or vanishes to zero can ruin the calculation, while one that’s slightly rounded does
        little harm. Once a model is trained, its weights can often be stored in 8 bits with little loss of quality, which brings us back to memory.
      </P>
      <P>
        Now look at the bars. The 70B model, one of the three language models this course will use, has about {fmt(paramCount(MODELS['70B']) / 1e9)} billion
        weights. In FP32 they take {fmt(gb70('fp32'))} GB; in BF16, {fmt(gb70('bf16'))} GB — nearly two A-class GPUs’ worth of memory before the model has done
        anything. In FP8 they take {fmt(gb70('fp8'))} GB and fit on a single {ACCELERATORS.A.memoryGB} GB card, leaving about {fmt(spare)} GB for everything else a
        running model needs, which Chapter 3 will show isn’t much.
      </P>
      <P>
        Fewer bits also mean less arithmetic hardware. As <a href={lessonHref('compute/1.3')}>Lesson 1.3</a> found, a multiplier grows with the square of its
        width: in that lesson’s design, one for FP8’s 4-bit mantissa (3 stored bits and an implicit leading 1) takes {fmt(arrayMultiplier(4).transistors)}{' '}
        transistors, and one for BF16’s 8 bits takes {fmt(arrayMultiplier(8).transistors)}, about{' '}
        {fmt(arrayMultiplier(8).transistors / arrayMultiplier(4).transistors, 1)} times as many. Chips count their arithmetic in <b>FLOPs</b>, floating-point
        operations — each multiplication or addition is one — and their speed in <b>TFLOPS</b>, trillions of FLOPs a second. The A-class’s matrix units, circuits
        built to multiply whole arrays of numbers at once, reach {fmt(ACCELERATORS.A.fp8Tflops)} TFLOPS in FP8 and {fmt(ACCELERATORS.A.bf16Tflops)} in BF16:
        twice the rate, not four or five times. Every operand has to reach the multipliers and every result leave them, over wires sized in bits: halve the bits
        and the same wires carry twice as many numbers. That delivery, more than the multipliers, sets the matrix units’ pace.
      </P>
      <P>
        Every one of these operations — each transistor that switches, each capacitor charged and refreshed, each number fetched from memory — costs a little
        energy, and all of that energy ends up as heat. In <a href={lessonHref('compute/1.5')}>the next lesson</a> we’ll see how much, and why it sets the limit on
        how fast a chip can run.
      </P>
    </LessonPage>
  );
}
