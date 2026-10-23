// Electrical physics engine: DC circuits, AC waveforms, machines and lines.
// Every function is pure and works in SI units unless the name says otherwise.

/** Ohm's law: current in amperes for volts across ohms. */
export function current(volts: number, ohms: number): number {
  return ohms > 0 ? volts / ohms : Infinity;
}

/** Electrical power in watts. */
export function power(volts: number, amps: number): number {
  return volts * amps;
}

/** Heat dissipated in a resistance carrying a current: P = I²R. */
export function jouleHeat(amps: number, ohms: number): number {
  return amps * amps * ohms;
}

export function seriesResistance(rs: number[]): number {
  return rs.reduce((s, r) => s + r, 0);
}

export function parallelResistance(rs: number[]): number {
  const g = rs.reduce((s, r) => s + (r > 0 ? 1 / r : Infinity), 0);
  return g === Infinity ? 0 : 1 / g;
}

export interface BranchResult {
  ohms: number;
  volts: number;
  amps: number;
  watts: number;
}

/** Loads connected in series across a source: same current, voltage divides. */
export function seriesCircuit(sourceVolts: number, loads: number[]): { totalAmps: number; branches: BranchResult[] } {
  const R = seriesResistance(loads);
  const I = R > 0 ? sourceVolts / R : 0;
  return { totalAmps: I, branches: loads.map((r) => ({ ohms: r, volts: I * r, amps: I, watts: I * I * r })) };
}

/** Loads connected in parallel across a source: same voltage, current divides. */
export function parallelCircuit(sourceVolts: number, loads: number[]): { totalAmps: number; branches: BranchResult[] } {
  const branches = loads.map((r) => {
    const I = r > 0 ? sourceVolts / r : 0;
    return { ohms: r, volts: sourceVolts, amps: I, watts: sourceVolts * I };
  });
  return { totalAmps: branches.reduce((s, b) => s + b.amps, 0), branches };
}

/** A source with internal resistance feeding a load: terminal voltage sags as current rises. */
export function sourceWithInternalResistance(emf: number, internalOhms: number, loadOhms: number) {
  const I = emf / (internalOhms + loadOhms);
  return { amps: I, terminalVolts: I * loadOhms, loadWatts: I * I * loadOhms, internalWatts: I * I * internalOhms };
}
