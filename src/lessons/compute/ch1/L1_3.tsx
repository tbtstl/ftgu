import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  scale,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import {
  FULL_ADDER_TRANSISTORS,
  GATE_TRANSISTORS,
  arrayMultiplier,
  gate,
  rippleAdder,
  rippleWorstCase,
  toBits,
  type AdderResult,
  type GateType,
} from '../../../engines/compute/logic';
import { gateDelayPs } from '../../../engines/compute/transistor';
import { ACCELERATORS } from '../../../model/compute/hardware';

// ---------------------------------------------------------------------------
// Switch-level circuits: each gate as a pull-up network of p-channel switches (on when their
// input is 0) above its output and a pull-down network of n-channel switches (on when their input
// is 1) below it. AND and OR are a NAND or NOR followed by an inverter; XOR is the common
// 12-transistor design, whose two inverters (making Ā and B̄) aren't drawn.

type Sig = 'A' | 'B' | 'Ā' | 'B̄' | 'X';
type Net = { k: 'sw'; sig: Sig; ch: 'p' | 'n' } | { k: 'ser' | 'par'; items: Net[] };
type Vals = Record<Sig, boolean>;
export interface Stage {
  up: Net;
  down: Net;
}

const pch = (sig: Sig): Net => ({ k: 'sw', sig, ch: 'p' });
const nch = (sig: Sig): Net => ({ k: 'sw', sig, ch: 'n' });
const ser = (...items: Net[]): Net => ({ k: 'ser', items });
const par = (...items: Net[]): Net => ({ k: 'par', items });

const NAND_STAGE: Stage = { up: par(pch('A'), pch('B')), down: ser(nch('A'), nch('B')) };
const NOR_STAGE: Stage = { up: ser(pch('A'), pch('B')), down: par(nch('A'), nch('B')) };
const INVERT_X: Stage = { up: pch('X'), down: nch('X') };

export const STAGES: Record<GateType, Stage[]> = {
  NOT: [{ up: pch('A'), down: nch('A') }],
  NAND: [NAND_STAGE],
  NOR: [NOR_STAGE],
  AND: [NAND_STAGE, INVERT_X],
  OR: [NOR_STAGE, INVERT_X],
  XOR: [{ up: ser(par(pch('A'), pch('B')), par(pch('Ā'), pch('B̄'))), down: par(ser(nch('A'), nch('B')), ser(nch('Ā'), nch('B̄'))) }],
};

export function conducts(net: Net, v: Vals): boolean {
  if (net.k === 'sw') return net.ch === 'n' ? v[net.sig] : !v[net.sig];
  return net.k === 'ser' ? net.items.every((i) => conducts(i, v)) : net.items.some((i) => conducts(i, v));
}

function size(net: Net): [number, number] {
  if (net.k === 'sw') return [1, 1];
  const s = net.items.map(size);
  return net.k === 'ser' ? [Math.max(...s.map((x) => x[0])), s.reduce((a, x) => a + x[1], 0)] : [s.reduce((a, x) => a + x[0], 0), Math.max(...s.map((x) => x[1]))];
}

/** Values on every signal of a gate's switch-level circuit, stage by stage. */
export function stageValues(type: GateType, a: boolean, b: boolean): { vals: Vals; stageOut: boolean[] } {
  const vals: Vals = { A: a, B: b, Ā: !a, B̄: !b, X: false };
  const stageOut: boolean[] = [];
  STAGES[type].forEach((st, i) => {
    const out = conducts(st.up, vals);
    stageOut.push(out);
    // A later stage (the inverter of an AND or OR) takes this stage's output as its input X.
    if (i < STAGES[type].length - 1) vals.X = out;
  });
  return { vals, stageOut };
}

// ---------------------------------------------------------------------------
// The challenges.

/** The four rows of the truth table: A, B, and the two binary digits of A + B. */
const ROWS = [
  { a: false, b: false },
  { a: false, b: true },
  { a: true, b: false },
  { a: true, b: true },
];

/** Whether the two gates add one combination of inputs correctly. */
export function rowRight(sum: GateType, carry: GateType, a: boolean, b: boolean): boolean {
  const total = Number(a) + Number(b);
  return gate(sum, a, b) === (total % 2 === 1) && gate(carry, a, b) === total >= 2;
}

/** How many of the four input combinations the two gates add correctly. */
export function rowsRight(sum: GateType, carry: GateType): number {
  return ROWS.filter(({ a, b }) => rowRight(sum, carry, a, b)).length;
}

/** Challenge a: the two gates form a half adder (XOR for the sum, AND for the carry). */
export function halfAdderSolved(sum: GateType, carry: GateType): boolean {
  return rowsRight(sum, carry) === 4;
}

/** Challenge b: the four-bit sum takes the longest time any four-bit sum can take to settle. */
export function slowestSolved(a: number, b: number): boolean {
  return rippleAdder(toBits(a, 4), toBits(b, 4)).settle === rippleWorstCase(4);
}

export const GATE_DEFAULTS = { a: '1' as '0' | '1', b: '1' as '0' | '1', sum: 'NAND' as GateType, carry: 'NOR' as GateType, show: 'sum' as 'sum' | 'carry' };
export const RIPPLE_DEFAULTS = { a: 6, b: 3 };

/** One gate delay for the example transistors of Lesson 1.2 at 0.8 V, ps (about 8). */
export const DELAY_PS = gateDelayPs();

const bin = (x: number, n: number) => x.toString(2).padStart(n, '0');
const ps = (delays: number) => `${fmt(delays * DELAY_PS)} ps`;

/** A live sentence about which column's carry the slowest digit waits for. */
export function rippleCaption(r: AdderResult): string {
  let best = { t: -1, bit: 0, carryOut: false };
  r.bits.forEach((b, i) => {
    if (b.sumReady > best.t) best = { t: b.sumReady, bit: i, carryOut: false };
  });
  const top = r.bits[r.bits.length - 1];
  if (top.carryReady > best.t) best = { t: top.carryReady, bit: r.bits.length - 1, carryOut: true };
  let j = best.carryOut ? best.bit : best.bit - 1;
  const chain: number[] = [];
  while (j >= 0 && r.bits[j].kind === 'propagate') chain.unshift(j--);
  const when = `after ${best.t} gate delays, about ${ps(best.t)}`;
  if (!chain.length) return `No digit has to wait for a carry rippling in from another column, so every digit of the answer is final ${when}.`;
  const origin = j >= 0 ? `Bit ${j} ${r.bits[j].kind === 'generate' ? 'generates a carry' : 'settles its carry out at 0 on its own'}` : 'The carry into bit 0 is 0';
  const waiting =
    chain.length === 1
      ? `bit ${chain[0]} must wait for that carry`
      : `bits ${chain.slice(0, -1).join(', ')} and ${chain[chain.length - 1]} must each wait for the carry from below`;
  const last = best.carryOut ? 'the final carry out' : `bit ${best.bit}’s sum digit`;
  return `${origin}, and ${waiting}, so ${last} is the last to settle, ${when}.`;
}

// ---------------------------------------------------------------------------
// Drawing.

const ONE = GRAPHIC.blue;
const ZERO = '#bdbdbd';
const IDLE = '#d4d4d4';
const DIM_ON = '#9a9a9a';
const TO_SUPPLY = GRAPHIC.blue;
const TO_GROUND = '#333';
const U = 50;
const UP_TOP = 58;
const UP_BOT = 136;
const NODE_Y = 146;
const DN_TOP = 156;
const DN_BOT = 234;

function wire(on: boolean) {
  return { stroke: on ? ONE : ZERO, strokeWidth: on ? 3 : 2, fill: 'none', strokeLinejoin: 'round' as const };
}

function drawNet(net: Net, x: number, y: number, w: number, h: number, active: boolean, color: string, v: Vals, out: ReactNode[]) {
  if (net.k === 'sw') {
    const on = conducts(net, v);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const stroke = active ? color : IDLE;
    const lever = active ? color : on ? DIM_ON : IDLE;
    const sw = active ? 2.5 : 1.5;
    out.push(
      <g key={out.length}>
        <line x1={cx} y1={y} x2={cx} y2={cy - 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx} y1={cy + 9} x2={cx} y2={y + h} stroke={stroke} strokeWidth={sw} />
        <circle cx={cx} cy={cy - 9} r={2.5} fill={lever} />
        <circle cx={cx} cy={cy + 9} r={2.5} fill={lever} />
        {on ? (
          <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} stroke={lever} strokeWidth={active ? 2.5 : 2} />
        ) : (
          <line x1={cx} y1={cy + 9} x2={cx + 10} y2={cy - 6} stroke={lever} strokeWidth={2} strokeLinecap="round" />
        )}
        <text x={cx + 9} y={cy + 4} className="ax" style={on ? { fill: '#333' } : undefined}>
          {net.sig}={v[net.sig] ? 1 : 0}
        </text>
      </g>,
    );
    return;
  }
  const [nw, nh] = size(net);
  if (net.k === 'ser') {
    let yy = y;
    for (const it of net.items) {
      const hh = (size(it)[1] * h) / nh;
      drawNet(it, x, yy, w, hh, active, color, v, out);
      yy += hh;
    }
    return;
  }
  let xx = x;
  const pcx = x + w / 2;
  for (const it of net.items) {
    const ww = (size(it)[0] * w) / nw;
    const bcx = xx + ww / 2;
    const bActive = active && conducts(it, v);
    const c = bActive ? color : IDLE;
    const sw = bActive ? 2.5 : 1.5;
    out.push(<line key={out.length} x1={pcx} x2={bcx} y1={y} y2={y} stroke={c} strokeWidth={sw} />);
    out.push(<line key={out.length} x1={pcx} x2={bcx} y1={y + h} y2={y + h} stroke={c} strokeWidth={sw} />);
    drawNet(it, xx, y, ww, h, bActive, color, v, out);
    xx += ww;
  }
}

function drawStage(st: Stage, cx: number, v: Vals, label: string, out: ReactNode[]) {
  const upOn = conducts(st.up, v);
  const downOn = conducts(st.down, v);
  const uw = size(st.up)[0] * U;
  const dw = size(st.down)[0] * U;
  const half = Math.max(uw, dw) / 2;
  drawNet(st.up, cx - uw / 2, UP_TOP, uw, UP_BOT - UP_TOP, upOn, TO_SUPPLY, v, out);
  drawNet(st.down, cx - dw / 2, DN_TOP, dw, DN_BOT - DN_TOP, downOn, TO_GROUND, v, out);
  const node = upOn ? TO_SUPPLY : TO_GROUND;
  out.push(
    <g key={out.length}>
      <line x1={cx} y1={UP_BOT} x2={cx} y2={NODE_Y} stroke={upOn ? TO_SUPPLY : IDLE} strokeWidth={upOn ? 2.5 : 1.5} />
      <line x1={cx} y1={NODE_Y} x2={cx} y2={DN_TOP} stroke={downOn ? TO_GROUND : IDLE} strokeWidth={downOn ? 2.5 : 1.5} />
      <line x1={cx} y1={NODE_Y} x2={cx + half + 8} y2={NODE_Y} stroke={node} strokeWidth={2.5} />
      <circle cx={cx} cy={NODE_Y} r={4} fill={node} />
      <text x={cx + half + 12} y={NODE_Y + 4} className="lab" style={{ fill: upOn ? TEXT.blue : '#333' }}>
        {label} = {upOn ? 1 : 0}
      </text>
    </g>,
  );
  return upOn;
}

const GATE_NAME: Record<GateType, string> = { NOT: 'NOT', NAND: 'NAND', NOR: 'NOR', AND: 'AND', OR: 'OR', XOR: 'XOR' };
const GATE_OPTIONS = (['NOT', 'NAND', 'NOR', 'AND', 'OR', 'XOR'] as GateType[]).map((g) => ({ value: g, label: GATE_NAME[g] }));

/** A labeled row of choices, laid out like the course's sliders. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ctl" style={{ maxWidth: 'none', display: 'grid', gridTemplateColumns: 'minmax(6.5rem, 10.5rem) minmax(0, 1fr)', alignItems: 'center', columnGap: 16 }}>
      <span className="ctl-l">{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 36 }}>{children}</div>
    </div>
  );
}

function GateBox({ x, y, type, out, selected, label, onSelect }: { x: number; y: number; type: GateType; out: boolean; selected: boolean; label: string; onSelect: () => void }) {
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <g role="button" tabIndex={0} aria-label={`Show the transistors of the ${label} gate`} aria-pressed={selected} onClick={onSelect} onKeyDown={key} style={{ cursor: 'pointer', outline: 'none' }}>
      <rect x={x} y={y} width={72} height={44} rx={6} fill="#fcfcfb" stroke={selected ? '#111' : '#bbb'} strokeWidth={selected ? 2 : 1} />
      <text x={x + 36} y={y + 27} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: '#333' }}>
        {GATE_NAME[type]}
      </text>
      <text x={x + 36} y={y + 60} textAnchor="middle" className="ax">
        {GATE_TRANSISTORS[type]} transistors
      </text>
      <line x1={x + 72} x2={x + 96} y1={y + 22} y2={y + 22} {...wire(out)} />
      <text x={x + 101} y={y + 26} className="lab" style={{ fill: out ? TEXT.blue : '#333' }}>
        {label} = {out ? 1 : 0}
      </text>
    </g>
  );
}

function GateFigure({ st, set }: { st: typeof GATE_DEFAULTS; set: (p: Partial<typeof GATE_DEFAULTS>) => void }) {
  const a = st.a === '1';
  const b = st.b === '1';
  const sOut = gate(st.sum, a, b);
  const cOut = gate(st.carry, a, b);
  const shown = st.show === 'sum' ? st.sum : st.carry;
  const { vals } = stageValues(shown, a, b);
  const stages = STAGES[shown];
  const parts: ReactNode[] = [];
  const outs: boolean[] = [];
  if (stages.length === 1) outs.push(drawStage(stages[0], 470, vals, 'out', parts));
  else {
    outs.push(drawStage(stages[0], 392, vals, 'X', parts));
    outs.push(drawStage(stages[1], 548, vals, 'out', parts));
  }
  const usesB = (t: GateType) => t !== 'NOT';
  const slot = st.show === 'sum' ? 'sum' : 'carry';
  const title = `Inside the ${slot} gate: ${GATE_NAME[shown]}`;

  return (
    <svg
      className="diagram"
      viewBox="0 0 640 256"
      role="img"
      aria-label={`Two gates share inputs A = ${Number(a)} and B = ${Number(b)}. The sum gate, ${st.sum}, outputs ${Number(sOut)}; the carry gate, ${st.carry}, outputs ${Number(cOut)}. Shown: the ${slot} gate’s ${GATE_TRANSISTORS[shown]} transistors, which connect its output to ${outs[outs.length - 1] ? 'the supply' : 'ground'}.`}
    >
      {/* Inputs and the two gates. */}
      <text x={6} y={68} className="lab" style={{ fill: a ? TEXT.blue : '#333' }}>
        A = {Number(a)}
      </text>
      <text x={6} y={188} className="lab" style={{ fill: b ? TEXT.blue : '#333' }}>
        B = {Number(b)}
      </text>
      <path d="M50 64 H136" {...wire(a)} />
      <path d="M80 64 V164 H136" {...wire(a)} />
      <circle cx={80} cy={64} r={4} fill={a ? ONE : ZERO} />
      <path d="M50 184 H136" {...wire(b)} style={usesB(st.carry) ? undefined : { opacity: 0.35 }} />
      <path d="M104 184 V84 H136" {...wire(b)} style={usesB(st.sum) ? undefined : { opacity: 0.35 }} />
      <circle cx={104} cy={184} r={4} fill={b ? ONE : ZERO} />
      <GateBox x={136} y={52} type={st.sum} out={sOut} selected={st.show === 'sum'} label="sum" onSelect={() => set({ show: 'sum' })} />
      <GateBox x={136} y={152} type={st.carry} out={cOut} selected={st.show === 'carry'} label="carry" onSelect={() => set({ show: 'carry' })} />

      {/* The selected gate's switches. */}
      <line x1={318} x2={318} y1={8} y2={248} stroke="#ececea" />
      <text x={332} y={20} className="lab">
        {title}
      </text>
      <text x={332} y={UP_TOP - 6} className="ax" style={{ fill: TEXT.blue }}>
        supply, 0.8 V
      </text>
      <line x1={332} x2={632} y1={UP_TOP} y2={UP_TOP} stroke={GRAPHIC.blue} strokeWidth={2} opacity={0.7} />
      <line x1={332} x2={632} y1={DN_BOT} y2={DN_BOT} stroke="#777" strokeWidth={2} opacity={0.7} />
      <text x={332} y={DN_BOT + 16} className="ax">
        ground, 0 V
      </text>
      {shown === 'XOR' && (
        <text x={632} y={DN_BOT + 16} className="ax ax-e">
          + 2 inverters for Ā, B̄ (not drawn)
        </text>
      )}
      {parts}
    </svg>
  );
}

function gateCaption(type: GateType, a: boolean, b: boolean): string {
  const { stageOut } = stageValues(type, a, b);
  const out = stageOut[stageOut.length - 1];
  const path = (o: boolean) =>
    o ? 'a path through the upper, p-channel switches connects the output to the 0.8 V supply' : 'a path through the lower, n-channel switches connects the output to ground';
  if (type === 'AND' || type === 'OR')
    return `The first stage is a ${type === 'AND' ? 'NAND' : 'NOR'}: ${path(stageOut[0])}, so X = ${Number(stageOut[0])}. The inverter flips it, so the ${type} gate outputs ${Number(out)}.`;
  if (type === 'XOR')
    return `The inputs ${a === b ? 'agree, so the lower network conducts' : 'differ, so the upper network conducts'}: ${path(out)}, and it outputs ${Number(out)}.`;
  return `In this ${type}, ${path(out)}, so it outputs ${Number(out)}. The other network is open: no current flows straight from supply to ground.`;
}

// ---------------------------------------------------------------------------
// The four-bit adder.

const KIND_COLOR = { generate: GRAPHIC.violet, kill: GRAPHIC.gray, propagate: GRAPHIC.orange } as const;
const KIND_TEXT = { generate: TEXT.violet, kill: TEXT.gray, propagate: TEXT.orange } as const;
const RATE = 2.5; // gate delays per second of animation
const LOOP = 11; // replay after 8 gate delays and a pause
const TX = scale(0, 9, 64, 604);
const colX = (i: number) => 112 + (3 - i) * 132;

function digit(settled: boolean, value: boolean, x: number, y: number, big = true) {
  return (
    <text x={x} y={y} textAnchor="middle" style={{ fontSize: big ? 20 : 14, fontWeight: 600, fill: !settled ? '#c4c4c4' : value ? TEXT.blue : '#333' }}>
      {settled ? Number(value) : '?'}
    </text>
  );
}

function AdderFigure({ a, b, r, t }: { a: number; b: number; r: AdderResult; t: number }) {
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`A four-bit ripple-carry adder adding ${a} (${bin(a, 4)}) and ${b} (${bin(b, 4)}) to get ${r.value} (${bin(r.value, 5)}). Columns from bit 3 to bit 0: ${[...r.bits]
        .reverse()
        .map((x) => x.kind)
        .join(', ')}. The answer settles after ${r.settle} gate delays, about ${ps(r.settle)}; ${Math.min(r.settle, Math.floor(t))} delays have passed in the replay.`}
    >
      <text x={8} y={34} className="lab">
        A = {a}
      </text>
      <text x={8} y={54} className="lab">
        B = {b}
      </text>
      {r.bits.map((bit, i) => {
        const cx = colX(i);
        const cin = i === 0 ? true : t >= r.bits[i - 1].carryReady;
        return (
          <g key={i}>
            <text x={cx} y={34} textAnchor="middle" className="lab" style={{ fill: bit.a ? TEXT.blue : '#333' }}>
              {Number(bit.a)}
            </text>
            <text x={cx} y={54} textAnchor="middle" className="lab" style={{ fill: bit.b ? TEXT.blue : '#333' }}>
              {Number(bit.b)}
            </text>
            <rect x={cx - 44} y={66} width={88} height={64} rx={6} fill="#fcfcfb" stroke={KIND_COLOR[bit.kind]} strokeWidth={t >= Math.max(bit.sumReady, bit.carryReady) ? 2 : 1.2} />
            <text x={cx} y={86} textAnchor="middle" className="ax">
              bit {i}
            </text>
            <text x={cx} y={108} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: KIND_TEXT[bit.kind] }}>
              {bit.kind}
            </text>
            <line x1={cx} x2={cx} y1={130} y2={150} stroke="#bbb" strokeWidth={1.5} />
            {digit(t >= bit.sumReady, bit.sum, cx, 174)}
            {/* Carry in from the column to the right. */}
            {i === 0 ? (
              <g>
                <line x1={620} x2={cx + 50} y1={98} y2={98} stroke={ZERO} strokeWidth={2} />
                <path d={`M${cx + 50} 93 L${cx + 44} 98 L${cx + 50} 103`} fill="none" stroke={ZERO} strokeWidth={2} />
                <text x={590} y={90} textAnchor="middle" className="ax">
                  carry in 0
                </text>
              </g>
            ) : (
              <g>
                <line x1={colX(i - 1) - 44} x2={cx + 50} y1={98} y2={98} stroke={cin && r.bits[i - 1].carryOut ? ONE : ZERO} strokeWidth={2} strokeDasharray={cin ? undefined : '3 4'} />
                <path d={`M${cx + 50} 93 L${cx + 44} 98 L${cx + 50} 103`} fill="none" stroke={cin && r.bits[i - 1].carryOut ? ONE : ZERO} strokeWidth={2} />
                {digit(cin, r.bits[i - 1].carryOut, (cx + 44 + colX(i - 1) - 44) / 2, 92, false)}
              </g>
            )}
          </g>
        );
      })}
      {/* Carry out of the top column: the answer's fifth digit. */}
      <line x1={colX(3) - 44} x2={30} y1={98} y2={98} stroke={t >= r.bits[3].carryReady && r.carryOut ? ONE : ZERO} strokeWidth={2} strokeDasharray={t >= r.bits[3].carryReady ? undefined : '3 4'} />
      <line x1={30} x2={30} y1={98} y2={150} stroke="#bbb" strokeWidth={1.5} />
      {digit(t >= r.bits[3].carryReady, r.carryOut, 30, 174)}
      <text x={30} y={86} textAnchor="middle" className="ax">
        carry out
      </text>

      {/* Time since the inputs changed. */}
      <line className="base" x1={TX(0)} x2={TX(9)} y1={212} y2={212} />
      <rect x={TX(0)} y={204} width={TX(Math.min(t, r.settle)) - TX(0)} height={8} fill={GRAPHIC.teal} opacity={0.5} />
      <line x1={TX(r.settle)} x2={TX(r.settle)} y1={198} y2={212} stroke={GRAPHIC.teal} strokeWidth={2} />
      <line x1={TX(rippleWorstCase(4))} x2={TX(rippleWorstCase(4))} y1={198} y2={212} stroke="#777" strokeWidth={1.5} strokeDasharray="3 3" />
      <line className="cur" x1={TX(Math.min(t, 9))} x2={TX(Math.min(t, 9))} y1={194} y2={216} />
      {[0, 2, 4, 6, 8].map((k) => (
        <text key={k} x={TX(k)} y={228} className="ax ax-m">
          {k}
        </text>
      ))}
      <text x={TX(9)} y={246} className="ax ax-e">
        gate delays since the inputs changed (about {fmt(DELAY_PS)} ps each)
      </text>
    </svg>
  );
}

export default function Lesson() {
  const g = useScenario('half-adder', GATE_DEFAULTS);
  const st = g.state;
  const a = st.a === '1';
  const b = st.b === '1';
  const right = rowsRight(st.sum, st.carry);
  const solvedA = halfAdderSolved(st.sum, st.carry);
  const shown = st.show === 'sum' ? st.sum : st.carry;

  const rs = useScenario('ripple', RIPPLE_DEFAULTS);
  const ra = rs.state.a;
  const rb = rs.state.b;
  const r = rippleAdder(toBits(ra, 4), toBits(rb, 4));
  const solvedB = slowestSolved(ra, rb);
  const play = usePlay(true);
  const [t, setT] = useState(0);
  useEffect(() => setT(0), [ra, rb]);
  useAnimationFrame((dt) => setT((x) => (x + dt * RATE > LOOP ? 0 : x + dt * RATE)), play.playing);
  // When paused, show the settled answer rather than a frozen half-way state.
  const tShown = play.playing ? t : LOOP;

  const def = rippleAdder(toBits(RIPPLE_DEFAULTS.a, 4), toBits(RIPPLE_DEFAULTS.b, 4));
  const worst = rippleWorstCase(4);
  const mul24 = arrayMultiplier(24);
  const mul8 = arrayMultiplier(8);
  const mul4 = arrayMultiplier(4);
  const A = ACCELERATORS.A;

  return (
    <LessonPage id="compute/1.3">
      <P>
        The inverter at the end of <a href={lessonHref('compute/1.2')}>the previous lesson</a> already computes something: whatever its input, its output is the
        opposite. Call a voltage near the <K c="voltage">0.8-volt supply</K> a 1 and a voltage near ground a 0, and the inverter is a <b>NOT gate</b>. That’s a
        start, but a computer has to combine values — add them, compare them, choose between them — and for that a gate needs more than one input.
      </P>
      <P>
        The inverter’s design generalizes. Its p-channel transistor connects the output to the supply when the input is 0, and its n-channel transistor connects the
        output to ground when the input is 1. With more transistors we can build a whole network of each kind: a <b>pull-up network</b> of p-channel switches above
        the output, and a <b>pull-down network</b> of n-channel switches below it, arranged so that for every combination of inputs exactly one of the two conducts.
        Put two n-channel transistors in series, so the output reaches ground only if both inputs are 1, and two p-channel transistors in parallel, so that either
        input at 0 connects the output to the supply. The output is 0 only when both inputs are 1. This is a <b>NAND gate</b> — “not and” — and it takes four
        transistors.
      </P>
      <P>
        In the next demonstration, two gates share the same two inputs, A and B. Choose the inputs, choose each gate’s type, and choose which gate to look inside
        (clicking a gate works too). Wires carrying a 1 are blue, and the switches drawn in color form the path that sets the gate’s output. The table lists the
        circuit’s two outputs for all four combinations of inputs, next to what adding A and B in binary would give. It starts with a NAND in the upper slot and a
        NOR in the lower one:
      </P>

      <Figure name="Logic Gate Builder" scenario={g}>
        <GateFigure st={st} set={g.set} />
        <Caption>{gateCaption(shown, a, b)}</Caption>
        <Row label="Inputs">
          <Segmented
            label="Input A"
            value={st.a}
            onChange={(v) => g.set({ a: v })}
            options={[
              { value: '0', label: 'A = 0' },
              { value: '1', label: 'A = 1' },
            ]}
          />
          <Segmented
            label="Input B"
            value={st.b}
            onChange={(v) => g.set({ b: v })}
            options={[
              { value: '0', label: 'B = 0' },
              { value: '1', label: 'B = 1' },
            ]}
          />
        </Row>
        <Row label="Sum gate">
          <Segmented label="Sum gate" value={st.sum} onChange={(v) => g.set({ sum: v })} options={GATE_OPTIONS} />
        </Row>
        <Row label="Carry gate">
          <Segmented label="Carry gate" value={st.carry} onChange={(v) => g.set({ carry: v })} options={GATE_OPTIONS} />
        </Row>
        <Row label="Look inside">
          <Segmented
            label="Gate to look inside"
            value={st.show}
            onChange={(v) => g.set({ show: v })}
            options={[
              { value: 'sum', label: 'Sum gate' },
              { value: 'carry', label: 'Carry gate' },
            ]}
          />
        </Row>
        <DataTable
          caption="Truth table: the circuit’s outputs for every combination of inputs, against binary addition"
          rows={ROWS}
          rowKey={(row) => `${Number(row.a)}${Number(row.b)}`}
          rowClass={(row) => (row.a === a && row.b === b ? 'hl' : '')}
          columns={[
            { label: 'A', cell: (row) => Number(row.a) },
            { label: 'B', cell: (row) => Number(row.b) },
            { label: 'A + B in binary', cell: (row) => bin(Number(row.a) + Number(row.b), 2), align: 'right' },
            { label: 'Carry, sum from the gates', cell: (row) => `${Number(gate(st.carry, row.a, row.b))}${Number(gate(st.sum, row.a, row.b))}`, align: 'right' },
            {
              label: 'Adds correctly',
              cell: (row) => (rowRight(st.sum, st.carry, row.a, row.b) ? 'yes' : 'no'),
              align: 'right',
            },
          ]}
        />
        <Readouts
          items={[
            { label: 'transistors in the circuit', value: fmt(GATE_TRANSISTORS[st.sum] + GATE_TRANSISTORS[st.carry]) },
            { label: 'rows added correctly', value: `${right} of 4` },
          ]}
        />
      </Figure>

      <P>
        Step the NAND through its four input combinations. Only with A and B both at 1 do both lower switches close, joining the output to ground; any input at 0
        closes one of the upper switches instead and joins the output to the supply. Then look inside the NOR: the same four transistors with the series and
        parallel arrangements swapped, so its output is 1 only when both inputs are 0. In every case one network is open. As with the inverter, no current flows straight from supply to
        ground once the output has settled: a CMOS gate draws current only while it switches, charging or draining the wires and transistor gates it drives.
      </P>
      <P>
        NAND and NOR are the gates CMOS builds most naturally, because a network of switches pulls its output toward the opposite of its inputs. AND and OR cost an
        inverter more: an AND is a NAND followed by a NOT, six transistors in all. <b>Exclusive or</b>, XOR — 1 when the inputs differ — needs a more elaborate
        network, and the common design takes twelve. NAND alone, or NOR alone, can be combined to make every other gate, and so any calculation at all. A chip with
        tens of billions of transistors is, at bottom, a vast number of these small networks wired together.
      </P>
      <P>
        Arithmetic is where this starts to look like computing. In binary each digit is 0 or 1, and adding two one-digit numbers gives a two-digit answer: 0 + 0 =
        00, 0 + 1 = 01, 1 + 0 = 01, and 1 + 1 = 10, which is two. The right-hand digit is the <b>sum</b> bit, and the left-hand one is the <b>carry</b>, which
        moves into the next column exactly as a carry does in decimal addition. Each depends only on A and B, so each can be computed by a single gate.
      </P>

      <Challenge
        id="a"
        question="Choose the two gates so the circuit adds: the sum gate should give the right-hand digit of A + B in binary, and the carry gate the left-hand digit, for all four rows of the table."
        solved={solvedA}
        status={`Right now the ${GATE_NAME[st.sum]} and ${GATE_NAME[st.carry]} add ${right} of the 4 rows correctly.`}
        success="Solved. The sum bit is 1 when exactly one input is 1 — exclusive or — and the carry only when both are: AND. This circuit, a half adder, takes 18 transistors: 12 for the XOR and 6 for the AND."
      />

      <P>
        The pair of gates that solves it is called a <b>half adder</b>. Its XOR is worth a look inside. Two inverters, not drawn, supply Ā and B̄, the opposites of
        the inputs. The lower network conducts when the inputs agree, both 1 or both 0, pulling the sum to 0; the upper one conducts when they differ.
      </P>

      <H2>Adding longer numbers</H2>
      <P>
        A half adder adds just two bits. To add numbers several digits long, every column but the rightmost must also add the carry coming in from the column to its
        right. A circuit that adds three bits — A, B and a carry in — is a <b>full adder</b>. Its sum bit is 1 when an odd number of its inputs are 1, and it carries
        out whenever at least two of them are; a common CMOS design takes {FULL_ADDER_TRANSISTORS} transistors. Chain four full adders, each one’s carry out feeding
        the next one’s carry in, and you have a four-bit <b>ripple-carry adder</b>: {4 * FULL_ADDER_TRANSISTORS} transistors that add any two numbers from 0 to 15.
      </P>
      <P>
        Gates aren’t instantaneous. Each needs a little time to charge or drain the wires and transistor gates it drives: a <K tone="teal">gate delay</K>, about{' '}
        {fmt(DELAY_PS)} picoseconds for the transistors of the previous lesson at 0.8 volts. (A picosecond is a trillionth of a second.) How long the adder takes
        depends on the numbers. In a column where A and B are both 1, the carry out is 1 whatever arrives from the right: the column <K tone="violet">generates</K> a
        carry. Where both are 0, the carry out is 0 regardless: the column <K tone="gray">kills</K> any carry. Only where A and B differ must the column wait for the
        carry from its right and pass it on — it <K tone="orange">propagates</K> the carry. In our model, a column that decides its own carry does so in two gate
        delays, a propagating column needs two more once its carry in arrives, and each sum digit is final two delays after its column’s carry in has settled (never sooner than four, since combining A and B takes two delays of its own).
      </P>
      <P>
        In the next demonstration, set the two numbers. The replay starts at the moment the inputs change: digits that are still in doubt show as question marks and
        fill in as their gates settle. The fifth digit of the answer, on the left, is the final carry out:
      </P>

      <Figure name="Logic Gate Builder · four-bit adder" scenario={rs} play={play}>
        <AdderFigure a={ra} b={rb} r={r} t={tShown} />
        <Caption>{rippleCaption(r)}</Caption>
        <Slider label="A" value={ra} min={0} max={15} onChange={(v) => rs.set({ a: v })} display={`${ra} = ${bin(ra, 4)}`} />
        <Slider label="B" value={rb} min={0} max={15} onChange={(v) => rs.set({ b: v })} display={`${rb} = ${bin(rb, 4)}`} />
        <Readouts
          items={[
            { label: 'A + B', value: `${r.value} = ${bin(r.value, 5)}` },
            { label: 'answer settles after', value: `${r.settle} delays · ${ps(r.settle)}`, tone: 'teal' },
            { label: 'slowest possible', value: `${worst} delays · ${ps(worst)}`, tone: 'teal' },
          ]}
        />
      </Figure>

      <P>
        At the starting values, {RIPPLE_DEFAULTS.a} + {RIPPLE_DEFAULTS.b}, bit 1 has two 1s and generates a carry after 2 gate delays. Bit 2 has a 1 and a 0, so it
        must wait for that carry; it passes it on after 4 delays, and bit 3’s sum digit is final after {def.settle}, about {ps(def.settle)}. The answer,{' '}
        {bin(def.value, 5)}, is {def.value}. Try other pairs and watch where the question marks linger.
      </P>

      <Challenge
        id="b"
        question="Find two numbers whose sum takes the longest possible time to settle."
        solved={solvedB}
        status={`Right now ${ra} + ${rb} settles after ${r.settle} gate delays.`}
        success={`Solved. When bits 1 and 2 both propagate, a carry has to ripple through both before bit 3’s sum can be trusted: ${worst} gate delays, about ${ps(worst)}, the most any four-bit sum can take. The classic example is 15 + 1, where the carry from bit 0 ripples all the way to the top.`}
      />

      <H2>Why the arithmetic shapes the chip</H2>
      <P>
        Eight gate delays is nothing for four bits, but the ripple grows with the width. A 64-bit ripple-carry adder can take {rippleWorstCase(64)} gate delays, about{' '}
        {fmt((rippleWorstCase(64) * DELAY_PS) / 1000)} nanosecond. As <a href={lessonHref('compute/1.5')}>Lesson 1.5</a> will show, a processor’s clock must wait
        for its slowest calculation to settle between ticks, and a chip clocked at 2 gigahertz ticks every half nanosecond. So real adders don’t let carries ripple.
        They spend extra transistors working out, in parallel, which groups of columns will generate or propagate a carry, so that the delay grows with the
        logarithm of the width rather than with the width itself. Speed is bought with silicon — a trade we’ll meet again at every scale of this course.
      </P>
      <P>
        Multiplication is costlier still. Multiplying binary numbers works as long multiplication does by hand: one shifted row for each digit of the multiplier,
        then a long addition. A hardware array multiplier forms all n × n one-bit products with AND gates and adds them with about n(n − 1) full adders, so its size
        grows with the square of its width. A 24-bit multiplier — the width at which standard 32-bit floating-point numbers are multiplied, as{' '}
        <a href={lessonHref('compute/1.4')}>the next lesson</a> explains — takes {fmt(mul24.transistors)} transistors in this design. An 8-bit one takes{' '}
        {fmt(mul8.transistors)}, nearly {fmt(mul24.transistors / mul8.transistors, 0)} times fewer, and a 4-bit one only {fmt(mul4.transistors)}.
      </P>
      <P>
        That square is one reason chips built for machine learning compute at low precision: in the same silicon and power, narrow multipliers fit many times over.
        The {A.name} we’ll meet in Chapter 2 manages {fmt(A.bf16Tflops)} trillion 16-bit floating-point operations per second in its matrix units, against{' '}
        {fmt(A.fp32Tflops)} trillion in ordinary 32-bit arithmetic. <a href={lessonHref('compute/2.3')}>Lesson 2.3</a> looks at how it keeps all those multipliers
        busy.
      </P>
      <P>
        Every circuit in this lesson forgets. Change an input and the outputs follow a few picoseconds later: the half adder in{' '}
        <FigRef to="Logic Gate Builder">the first demonstration</FigRef> only ever knows the sum of the inputs in front of it now. But a real calculation needs its
        operands held steady while it works, and somewhere to put the answer. <a href={lessonHref('compute/1.4')}>The next lesson</a> builds circuits that remember,
        and looks at how numbers are written down in bits.
      </P>
    </LessonPage>
  );
}
