// Storing bits: a DRAM cell is a tiny capacitor that leaks and must be refreshed; an SRAM cell is
// a pair of inverters that holds its bit as long as it has power. And what the bits mean: the
// floating-point formats that trade precision for memory.

// ---------------------------------------------------------------------------
// DRAM retention and refresh.

/**
 * Leak time constant of the weakest cell in the course's example DRAM chip at 85 °C, ms. Chosen
 * so that cell falls to the sensing threshold after 100 ms: comfortably longer than the standard
 * 64 ms refresh window.
 */
export const WEAKEST_TAU_85_MS = 100 / Math.LN2;
/** Leakage roughly doubles for every 10 °C, so retention halves. */
export const RETENTION_HALVING_C = 10;
/** A stored 1 reads correctly while the cell holds at least this fraction of the full voltage. */
export const SENSE_THRESHOLD = 0.5;
/** Rows refreshed per refresh window (each refresh command handles a group). */
export const REFRESH_COMMANDS = 8192;
/** Time the chip is busy for each refresh command, ns. */
export const REFRESH_BUSY_NS = 350;

/** Leak time constant at a temperature, ms, for a cell `strength` times as good as the weakest. */
export function leakTauMs(tempC: number, strength = 1): number {
  return WEAKEST_TAU_85_MS * strength * 2 ** ((85 - tempC) / RETENTION_HALVING_C);
}

/** Fraction of full voltage left on a cell `ms` after it was written (or last refreshed). */
export function cellCharge(ms: number, tempC: number, strength = 1): number {
  return Math.exp(-ms / leakTauMs(tempC, strength));
}

/** How long a cell keeps a readable 1 without refresh, ms. */
export function retentionMs(tempC: number, strength = 1): number {
  return leakTauMs(tempC, strength) * Math.log(1 / SENSE_THRESHOLD);
}

/** Whether a stored 1 survives with refreshes every `intervalMs`: the charge must not fall below the threshold before the next refresh. */
export function survivesRefresh(intervalMs: number, tempC: number, strength = 1): boolean {
  return cellCharge(intervalMs, tempC, strength) >= SENSE_THRESHOLD;
}

/** Share of the time the chip is busy refreshing, rather than serving reads and writes. */
export function refreshOverhead(intervalMs: number): number {
  return (REFRESH_COMMANDS * REFRESH_BUSY_NS * 1e-6) / intervalMs;
}

/**
 * Charge on a cell over time with periodic refresh: samples of [ms, fraction] from 0 to `spanMs`.
 * Refresh restores a cell only if it still reads as 1; a cell that fell below the threshold is
 * read as 0 and "restored" to 0.
 */
export function refreshTrace(intervalMs: number, tempC: number, spanMs: number, samplesPerInterval = 24, strength = 1): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let level = 1;
  for (let start = 0; start < spanMs - 1e-9; start += intervalMs) {
    const end = Math.min(spanMs, start + intervalMs);
    for (let i = 0; i <= samplesPerInterval; i++) {
      const t = start + ((end - start) * i) / samplesPerInterval;
      out.push([t, level * cellCharge(t - start, tempC, strength)]);
    }
    if (end < start + intervalMs - 1e-9) break;
    // The refresh reads the cell and writes back what it read.
    level = level * cellCharge(intervalMs, tempC, strength) >= SENSE_THRESHOLD ? level : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Number formats.

export type FormatId = 'fp32' | 'fp16' | 'bf16' | 'fp8';

export interface FloatFormat {
  id: FormatId;
  name: string;
  bits: number;
  /** Exponent bits. */
  exp: number;
  /** Stored mantissa (fraction) bits; normal numbers have an implicit leading 1. */
  man: number;
  bias: number;
  /** Largest finite value. */
  max: number;
}

export const FORMATS: Record<FormatId, FloatFormat> = {
  fp32: { id: 'fp32', name: 'FP32', bits: 32, exp: 8, man: 23, bias: 127, max: (2 - 2 ** -23) * 2 ** 127 },
  fp16: { id: 'fp16', name: 'FP16', bits: 16, exp: 5, man: 10, bias: 15, max: 65504 },
  bf16: { id: 'bf16', name: 'BF16', bits: 16, exp: 8, man: 7, bias: 127, max: (2 - 2 ** -7) * 2 ** 127 },
  // FP8 "E4M3": no infinity; the top exponent still holds normal numbers, up to 448.
  fp8: { id: 'fp8', name: 'FP8', bits: 8, exp: 4, man: 3, bias: 7, max: 448 },
};

export const FORMAT_IDS: FormatId[] = ['fp32', 'bf16', 'fp16', 'fp8'];

function roundHalfEven(v: number): number {
  const r = Math.floor(v);
  const d = v - r;
  if (d > 0.5) return r + 1;
  if (d < 0.5) return r;
  return r % 2 === 0 ? r : r + 1;
}

export interface Encoded {
  sign: 0 | 1;
  /** Exponent field as stored. */
  expField: number;
  /** Mantissa field as stored. */
  manField: number;
  /** The number the bits actually represent. */
  value: number;
  /** The input was too large and was clamped to the largest value. */
  overflow: boolean;
  /** The input was too small and became zero. */
  underflow: boolean;
  subnormal: boolean;
}

/** Encode x in a format, rounding to the nearest representable value (ties to even). */
export function encode(x: number, f: FloatFormat): Encoded {
  const sign: 0 | 1 = x < 0 || Object.is(x, -0) ? 1 : 0;
  const a = Math.abs(x);
  const s = sign ? -1 : 1;
  if (a === 0) return { sign, expField: 0, manField: 0, value: 0, overflow: false, underflow: false, subnormal: false };
  const emin = 1 - f.bias;
  let e = Math.floor(Math.log2(a));
  // Guard against log2 rounding at exact powers of two.
  if (2 ** e > a) e -= 1;
  if (2 ** (e + 1) <= a) e += 1;
  const scale = 2 ** f.man;
  if (e < emin) {
    const m = roundHalfEven((a / 2 ** emin) * scale);
    if (m === 0) return { sign, expField: 0, manField: 0, value: 0, overflow: false, underflow: true, subnormal: false };
    if (m >= scale) return { sign, expField: 1, manField: 0, value: s * 2 ** emin, overflow: false, underflow: false, subnormal: false };
    return { sign, expField: 0, manField: m, value: (s * m * 2 ** emin) / scale, overflow: false, underflow: false, subnormal: true };
  }
  let m = roundHalfEven((a / 2 ** e - 1) * scale);
  if (m >= scale) {
    m = 0;
    e += 1;
  }
  const value = (1 + m / scale) * 2 ** e;
  if (value > f.max) {
    // Clamp to the largest finite value.
    const emax = Math.floor(Math.log2(f.max));
    const mmax = Math.round((f.max / 2 ** emax - 1) * scale);
    return { sign, expField: emax + f.bias, manField: mmax, value: s * f.max, overflow: true, underflow: false, subnormal: false };
  }
  return { sign, expField: e + f.bias, manField: m, value: s * value, overflow: false, underflow: false, subnormal: false };
}

/** Bits of an encoded value, most significant first: [sign, exponent…, mantissa…]. */
export function bitsOf(enc: Encoded, f: FloatFormat): { sign: number; exp: number[]; man: number[] } {
  const exp = Array.from({ length: f.exp }, (_, i) => (enc.expField >> (f.exp - 1 - i)) & 1);
  const man = Array.from({ length: f.man }, (_, i) => Math.floor(enc.manField / 2 ** (f.man - 1 - i)) % 2);
  return { sign: enc.sign, exp, man };
}

/** Relative rounding error of storing x: |stored − x| / |x|. */
export function relativeError(x: number, f: FloatFormat): number {
  if (x === 0) return 0;
  return Math.abs(encode(x, f).value - x) / Math.abs(x);
}

/** Gap between 1 and the next representable number: the format's precision near 1. */
export function epsilon(f: FloatFormat): number {
  return 2 ** -f.man;
}

/** Bytes to store `count` numbers in a format. */
export function storageBytes(count: number, f: FloatFormat): number {
  return (count * f.bits) / 8;
}
