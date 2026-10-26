// Silicon as a conductor: how many mobile charges a doped crystal holds, how fast an electric field
// pushes them, and the one-way valve made by joining p-type silicon to n-type.
// Units follow device physics: concentrations per cm³, mobility in cm²/V·s, fields in V/cm.

/** Elementary charge, C. */
export const Q = 1.602e-19;
/** Boltzmann's constant, eV/K. */
export const K_EV = 8.617e-5;
/** Silicon's band gap at room temperature, eV. */
export const SI_GAP_EV = 1.12;
/** Intrinsic carrier concentration of pure silicon at 300 K, per cm³. */
export const NI_300 = 1.0e10;
/** Silicon atoms per cm³. */
export const SI_ATOMS = 5.0e22;
/** Carrier velocity saturates near this, cm/s. */
export const V_SAT = 1.0e7;
/** Copper's resistivity, Ω·cm, for comparison. */
export const COPPER_OHM_CM = 1.7e-6;

/** Intrinsic carrier concentration at temperature T (kelvin), per cm³. */
export function intrinsicConcentration(tempK = 300): number {
  return NI_300 * (tempK / 300) ** 1.5 * Math.exp((-SI_GAP_EV / (2 * K_EV)) * (1 / tempK - 1 / 300));
}

/**
 * Electron and hole mobility, cm²/V·s, given the total dopant concentration (per cm³).
 * Dopant ions scatter carriers, so mobility falls as doping rises (Caughey–Thomas fit for silicon at 300 K).
 */
export function mobility(totalDoping: number): { electron: number; hole: number } {
  const ct = (min: number, max: number, nref: number, a: number) => min + (max - min) / (1 + (totalDoping / nref) ** a);
  return { electron: ct(68.5, 1414, 9.2e16, 0.711), hole: ct(44.9, 470.5, 2.23e17, 0.719) };
}

export type DopantKind = 'none' | 'n' | 'p';

export interface Carriers {
  /** Free electrons per cm³. */
  n: number;
  /** Holes per cm³. */
  p: number;
  mobilityN: number;
  mobilityP: number;
  /** Conductivity, S/cm. */
  sigma: number;
  /** Resistivity, Ω·cm. */
  rho: number;
  /** Which carrier is in the majority. */
  majority: 'electrons' | 'holes' | 'neither';
}

/**
 * Carrier concentrations in silicon doped with `doping` donors (n-type: phosphorus) or acceptors
 * (p-type: boron) per cm³. Each donor gives up one electron, each acceptor takes one (leaving a
 * hole), and the product n·p stays fixed at nᵢ² — the law of mass action.
 */
export function carriers(kind: DopantKind, doping: number, tempK = 300): Carriers {
  const ni = intrinsicConcentration(tempK);
  const net = kind === 'n' ? doping : kind === 'p' ? -doping : 0;
  const half = net / 2;
  const root = Math.sqrt(half * half + ni * ni);
  // Solve n − p = net, n·p = nᵢ², choosing the numerically stable branch.
  let n: number;
  let p: number;
  if (net >= 0) {
    n = half + root;
    p = (ni * ni) / n;
  } else {
    p = -half + root;
    n = (ni * ni) / p;
  }
  const mu = mobility(kind === 'none' ? 0 : doping);
  const sigma = Q * (n * mu.electron + p * mu.hole);
  return {
    n,
    p,
    mobilityN: mu.electron,
    mobilityP: mu.hole,
    sigma,
    rho: 1 / sigma,
    majority: n > 10 * p ? 'electrons' : p > 10 * n ? 'holes' : 'neither',
  };
}

/** Drift velocity of a carrier with mobility mu in field E (V/cm), saturating near V_SAT. cm/s. */
export function driftVelocity(mu: number, fieldVPerCm: number): number {
  const v = mu * fieldVPerCm;
  return v / (1 + v / V_SAT);
}

/** Current density, A/cm², from both carriers drifting in field E (V/cm). */
export function currentDensity(c: Carriers, fieldVPerCm: number): number {
  return Q * (c.n * driftVelocity(c.mobilityN, fieldVPerCm) + c.p * driftVelocity(c.mobilityP, fieldVPerCm));
}

/** Thermal voltage kT/q at temperature T, V (25.9 mV at 300 K). */
export function thermalVoltage(tempK = 300): number {
  return K_EV * tempK;
}

/** Saturation current of the course's example p–n junction, A. */
export const DIODE_IS = 1e-14;

/**
 * Current through a p–n junction at bias V (positive = p side higher), A: the Shockley diode
 * equation. Forward bias lowers the barrier and current grows tenfold every ~60 mV; reverse bias
 * leaves only the tiny saturation current.
 */
export function diodeCurrent(volts: number, tempK = 300, is = DIODE_IS, ideality = 1): number {
  return is * (Math.exp(volts / (ideality * thermalVoltage(tempK))) - 1);
}

/** Forward voltage at which the example junction passes `amps`, V. */
export function diodeVoltageFor(amps: number, tempK = 300, is = DIODE_IS): number {
  return thermalVoltage(tempK) * Math.log(amps / is + 1);
}
