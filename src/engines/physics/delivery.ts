// The chain of voltages between a generator and a home, and the current each stage needs to
// carry a given power. Typical North American levels; three-phase stages quote line-to-line
// voltage, and the last stage is a single-phase 240 V service.

export interface DeliveryLevels {
  /** Generator terminals, kV line-to-line. */
  generatorKV: number;
  /** Transmission, kV line-to-line. */
  transmissionKV: number;
  /** Subtransmission, kV line-to-line. */
  subtransmissionKV: number;
  /** Distribution feeder, kV line-to-line. */
  feederKV: number;
  /** Single-phase service to the home, volts (240 V split into two 120 V halves). */
  serviceVolts: number;
}

export const DEFAULT_LEVELS: DeliveryLevels = {
  generatorKV: 20,
  transmissionKV: 345,
  subtransmissionKV: 69,
  feederKV: 13.8,
  serviceVolts: 240,
};

export interface DeliveryStage {
  id: 'generator' | 'transmission' | 'subtransmission' | 'feeder' | 'service';
  /** Nominal voltage of the stage, volts (line-to-line for three-phase stages). */
  volts: number;
  threePhase: boolean;
  /** Current in each conductor for the given power, amperes. */
  amps: number;
  /**
   * Voltage ratio of the transformer feeding this stage (output ÷ input, so >1 steps up), or
   * null for the generator. The service transformer is fed from one phase of the feeder, line
   * to neutral (feeder ÷ √3).
   */
  ratio: number | null;
}

/** Current in each conductor: P / (√3·V) for a balanced three-phase stage at unity power factor, P / V for single-phase. */
export function conductorAmps(watts: number, volts: number, threePhase: boolean): number {
  return threePhase ? watts / (Math.sqrt(3) * volts) : watts / volts;
}

/** Every stage from generator to home carrying `powerMW`, with each transformer's voltage ratio. */
export function deliveryChain(powerMW: number, levels: Partial<DeliveryLevels> = {}): DeliveryStage[] {
  const l = { ...DEFAULT_LEVELS, ...levels };
  const W = powerMW * 1e6;
  const kv = (x: number) => x * 1e3;
  const stage = (id: DeliveryStage['id'], volts: number, threePhase: boolean, ratio: number | null): DeliveryStage => ({
    id,
    volts,
    threePhase,
    amps: conductorAmps(W, volts, threePhase),
    ratio,
  });
  const feederToNeutral = kv(l.feederKV) / Math.sqrt(3);
  return [
    stage('generator', kv(l.generatorKV), true, null),
    stage('transmission', kv(l.transmissionKV), true, l.transmissionKV / l.generatorKV),
    stage('subtransmission', kv(l.subtransmissionKV), true, l.subtransmissionKV / l.transmissionKV),
    stage('feeder', kv(l.feederKV), true, l.feederKV / l.subtransmissionKV),
    stage('service', l.serviceVolts, false, l.serviceVolts / feederToNeutral),
  ];
}
