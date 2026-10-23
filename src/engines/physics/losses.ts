// Resistive losses on transmission and distribution lines.

export interface LineLossInput {
  /** Power sent from the source end, MW. */
  sendMW: number;
  /** Line-to-line voltage, kV. */
  kV: number;
  lengthKm: number;
  /** Resistance per phase per km, ohms (≈0.03 for a large 345 kV bundle, ≈0.3 for a distribution feeder). */
  ohmPerKm: number;
  /** Three-phase (default) or a single two-wire circuit. */
  threePhase?: boolean;
  powerFactor?: number;
}

/**
 * Losses for a line delivering power at a fixed voltage. Current = P / (√3·V·pf) for three-phase;
 * loss = 3·I²·R (per-phase resistance times three phases).
 */
export function lineLoss({ sendMW, kV, lengthKm, ohmPerKm, threePhase = true, powerFactor = 1 }: LineLossInput) {
  const P = sendMW * 1e6;
  const V = kV * 1e3;
  const R = ohmPerKm * lengthKm;
  const amps = threePhase ? P / (Math.sqrt(3) * V * powerFactor) : P / (V * powerFactor);
  const lossW = (threePhase ? 3 : 2) * amps * amps * R;
  const lossMW = Math.min(lossW / 1e6, sendMW);
  return {
    amps,
    ohms: R,
    lossMW,
    deliveredMW: sendMW - lossMW,
    lossShare: sendMW > 0 ? lossMW / sendMW : 0,
    /** Voltage drop along the line (resistive part), kV. */
    dropKV: (amps * R) / 1e3,
  };
}

/** Typical conductor resistances by voltage class, ohms per km per phase. */
export const TYPICAL_OHM_PER_KM: Record<number, number> = {
  0.24: 0.5,
  13.8: 0.3,
  69: 0.15,
  138: 0.08,
  230: 0.05,
  345: 0.03,
  500: 0.02,
  765: 0.012,
};
