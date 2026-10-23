// Generators and transformers.

const TAU = 2 * Math.PI;

export interface GeneratorInput {
  /** Turns in the coil. */
  turns: number;
  /** Magnetic flux density, tesla. */
  fieldTesla: number;
  /** Area enclosed by each turn, m². */
  areaM2: number;
  /** Shaft speed, revolutions per minute. */
  rpm: number;
  /** Pairs of magnetic poles on the rotor (1 = a single north–south magnet). */
  polePairs?: number;
}

/**
 * A coil rotating in a uniform field (Faraday's law): emf = N·B·A·ω·sin(ωt).
 * Electrical frequency = rpm/60 × pole pairs.
 */
export function generatorEmf({ turns, fieldTesla, areaM2, rpm, polePairs = 1 }: GeneratorInput) {
  const freqHz = (rpm / 60) * polePairs;
  const omega = TAU * freqHz;
  const peakVolts = turns * fieldTesla * areaM2 * omega;
  return { freqHz, omega, peakVolts, rmsVolts: peakVolts / Math.SQRT2 };
}

/** Instantaneous flux through the coil and induced emf at time t. */
export function generatorAt(input: GeneratorInput, tSec: number) {
  const { omega, peakVolts } = generatorEmf(input);
  const angle = omega * tSec;
  return { angle, flux: input.fieldTesla * input.areaM2 * Math.cos(angle), emf: peakVolts * Math.sin(angle) };
}

/** Shaft speed needed for a grid frequency with a given number of poles (not pole pairs). */
export function synchronousRpm(freqHz: number, poles: number): number {
  return (120 * freqHz) / poles;
}

export interface TransformerInput {
  primaryVolts: number;
  primaryTurns: number;
  secondaryTurns: number;
  /** Load connected to the secondary, ohms. */
  loadOhms: number;
  /** Winding resistance referred to the secondary, ohms (copper loss). */
  windingOhms?: number;
  /** Constant magnetizing (core) loss, watts. */
  coreLossWatts?: number;
}

/**
 * A transformer: voltage scales with the turns ratio, current scales inversely, power is
 * conserved apart from copper and core losses.
 */
export function transformer({ primaryVolts, primaryTurns, secondaryTurns, loadOhms, windingOhms = 0, coreLossWatts = 0 }: TransformerInput) {
  const ratio = secondaryTurns / primaryTurns;
  const openCircuitVolts = primaryVolts * ratio;
  const secondaryAmps = openCircuitVolts / (loadOhms + windingOhms);
  const secondaryVolts = secondaryAmps * loadOhms;
  const outputWatts = secondaryVolts * secondaryAmps;
  const copperLossWatts = secondaryAmps * secondaryAmps * windingOhms;
  const inputWatts = outputWatts + copperLossWatts + coreLossWatts;
  const primaryAmps = inputWatts / primaryVolts;
  return {
    ratio,
    secondaryVolts,
    secondaryAmps,
    primaryAmps,
    outputWatts,
    inputWatts,
    copperLossWatts,
    coreLossWatts,
    efficiency: inputWatts > 0 ? outputWatts / inputWatts : 0,
  };
}
