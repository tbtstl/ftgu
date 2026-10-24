// Logic gates from transistors, and arithmetic from gates: what a chip's billions of switches
// actually compute, how many transistors each piece costs, and how long its answer takes to settle.

export type GateType = 'NOT' | 'NAND' | 'NOR' | 'AND' | 'OR' | 'XOR';

export const GATE_TYPES: GateType[] = ['NOT', 'NAND', 'NOR', 'AND', 'OR', 'XOR'];

/** Output of a gate. NOT ignores b. */
export function gate(type: GateType, a: boolean, b = false): boolean {
  switch (type) {
    case 'NOT':
      return !a;
    case 'NAND':
      return !(a && b);
    case 'NOR':
      return !(a || b);
    case 'AND':
      return a && b;
    case 'OR':
      return a || b;
    case 'XOR':
      return a !== b;
  }
}

/**
 * Transistors in the usual CMOS design of each gate. NAND and NOR are the natural CMOS gates
 * (each input drives one pull-up and one pull-down transistor); AND and OR are those plus an
 * inverter; XOR here is the common 12-transistor design.
 */
export const GATE_TRANSISTORS: Record<GateType, number> = { NOT: 2, NAND: 4, NOR: 4, AND: 6, OR: 6, XOR: 12 };

/** Delay of each gate in units of one simple gate delay (an inverter driving four others). */
export const GATE_DELAY_UNITS: Record<GateType, number> = { NOT: 1, NAND: 1, NOR: 1, AND: 2, OR: 2, XOR: 2 };

/**
 * Which transistors conduct in a two-input NAND or NOR (or a NOT), for drawing the switch-level
 * circuit. Pull-ups are p-channel (on when their input is 0); pull-downs are n-channel (on when 1).
 * NAND: pull-ups in parallel, pull-downs in series. NOR: the reverse.
 */
export function switchLevel(type: 'NOT' | 'NAND' | 'NOR', a: boolean, b: boolean) {
  const pA = !a;
  const pB = !b;
  const nA = a;
  const nB = b;
  if (type === 'NOT') return { pullUp: [pA], pullDown: [nA], upConducts: pA, downConducts: nA, out: pA };
  if (type === 'NAND') {
    const up = pA || pB;
    const down = nA && nB;
    return { pullUp: [pA, pB], pullDown: [nA, nB], upConducts: up, downConducts: down, out: up };
  }
  const up = pA && pB;
  const down = nA || nB;
  return { pullUp: [pA, pB], pullDown: [nA, nB], upConducts: up, downConducts: down, out: up };
}

/** Transistors in a common 28-transistor CMOS full adder. */
export const FULL_ADDER_TRANSISTORS = 28;

export interface AdderBit {
  a: boolean;
  b: boolean;
  carryIn: boolean;
  sum: boolean;
  carryOut: boolean;
  /** "generate" (a = b = 1: carry out regardless), "kill" (a = b = 0: no carry out regardless), "propagate" (a ≠ b: carry out = carry in). */
  kind: 'generate' | 'kill' | 'propagate';
  /** Gate delays until this bit's carry out is final. */
  carryReady: number;
  /** Gate delays until this bit's sum is final. */
  sumReady: number;
}

export interface AdderResult {
  bits: AdderBit[];
  /** Sum as a number, including the final carry. */
  value: number;
  carryOut: boolean;
  /** Gate delays until every output is final. */
  settle: number;
  /** The most it can take for any inputs: a carry rippling through every bit. */
  worstCase: number;
}

/**
 * A ripple-carry adder over little-endian bit arrays (bit 0 first). Each bit's carry out is
 * settled after two gate delays if its inputs decide it on their own (both 1 or both 0); if they
 * differ it must wait for the carry from the bit below, plus two more gate delays. The sum bit
 * needs the carry in and two delays for its XOR.
 */
export function rippleAdder(a: boolean[], b: boolean[], carryIn = false): AdderResult {
  const n = Math.max(a.length, b.length);
  const bits: AdderBit[] = [];
  let c = carryIn;
  let cReady = 0;
  let value = 0;
  let settle = 0;
  for (let i = 0; i < n; i++) {
    const ai = !!a[i];
    const bi = !!b[i];
    const kind = ai && bi ? 'generate' : !ai && !bi ? 'kill' : 'propagate';
    const p = ai !== bi;
    const sum = p !== c;
    const carryOut = (ai && bi) || (c && p);
    const carryReady = kind === 'propagate' ? cReady + 2 : 2;
    const sumReady = Math.max(2, cReady) + 2;
    bits.push({ a: ai, b: bi, carryIn: c, sum, carryOut, kind, carryReady, sumReady });
    if (sum) value += 2 ** i;
    settle = Math.max(settle, sumReady, carryReady);
    c = carryOut;
    cReady = carryReady;
  }
  if (c) value += 2 ** n;
  return { bits, value, carryOut: c, settle, worstCase: rippleWorstCase(n) };
}

/** Longest settling time of an n-bit ripple adder: a carry generated in bit 0 that propagates through every other bit. */
export function rippleWorstCase(n: number): number {
  return 2 * Math.max(1, n);
}

/** Bits of a number, little-endian. */
export function toBits(x: number, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => ((x >> i) & 1) === 1);
}

/**
 * Cost of an n-bit by n-bit array multiplier: n² AND gates form the partial products and about
 * n(n − 1) full adders sum them. Transistors grow with the square of the width — why a 24-bit
 * mantissa multiplier is about ten times the size of an 8-bit one.
 */
export function arrayMultiplier(nBits: number): { andGates: number; fullAdders: number; transistors: number } {
  const andGates = nBits * nBits;
  const fullAdders = nBits * (nBits - 1);
  return { andGates, fullAdders, transistors: andGates * GATE_TRANSISTORS.AND + fullAdders * FULL_ADDER_TRANSISTORS };
}
