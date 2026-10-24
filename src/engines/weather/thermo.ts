// Thermodynamics of moist air: the ideal gas law, adiabatic compression and expansion, water
// vapor and saturation, and the ascent of a parcel through a simplified atmosphere (the basis of
// stability, convection and thunderstorms). Temperatures in °C unless named K; pressures in hPa.

/** Gas constant for dry air, J kg⁻¹ K⁻¹. */
export const RD = 287.05;
/** Specific heat of dry air at constant pressure, J kg⁻¹ K⁻¹. */
export const CP = 1004;
export const G = 9.81;
/** Latent heat of vaporization of water, J/kg. */
export const LV = 2.501e6;
/** Ratio of the gas constants of dry air and water vapor. */
export const EPS = 0.622;
export const KAPPA = RD / CP;
export const K0 = 273.15;
/** Reference pressure for potential temperature, hPa. */
export const P_REF = 1000;
/** The dry adiabatic lapse rate, g/cp, K per km. */
export const DRY_LAPSE = (G / CP) * 1000;

/** Density of dry air from the ideal gas law ρ = p / (R·T), kg/m³. */
export function density(pHpa: number, tC: number): number {
  return (pHpa * 100) / (RD * (tC + K0));
}

/** Volume of one kilogram of air, m³. */
export function specificVolume(pHpa: number, tC: number): number {
  return 1 / density(pHpa, tC);
}

/** Temperature after an adiabatic change of pressure (no heat in or out): T₂ = T₁·(p₂/p₁)^(R/cp), °C. */
export function adiabaticTemperature(tC: number, p1: number, p2: number): number {
  return (tC + K0) * Math.pow(p2 / p1, KAPPA) - K0;
}

/** Potential temperature: the temperature the air would have if brought adiabatically to 1,000 hPa, K. */
export function potentialTemperature(tC: number, pHpa: number): number {
  return (tC + K0) * Math.pow(P_REF / pHpa, KAPPA);
}

/** The International Standard Atmosphere below 11 km: pressure at a height, hPa. */
export function standardPressure(zM: number): number {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * zM, 5.25588);
}

/** The International Standard Atmosphere below 11 km: 15 °C at sea level, falling 6.5 °C per km. */
export function standardTemperature(zM: number): number {
  return 15 - 0.0065 * zM;
}

/** Height in the standard atmosphere at which the pressure is `pHpa`, m. */
export function standardHeight(pHpa: number): number {
  return (1 - Math.pow(pHpa / 1013.25, 1 / 5.25588)) / 2.25577e-5;
}

// ---------------------------------------------------------------------------
// Water vapor.

/** Saturation vapor pressure over liquid water (Bolton, 1980), hPa. */
export function satVaporPressure(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/** Mixing ratio — kilograms of water vapor per kilogram of dry air — from vapor pressure. */
export function mixingRatio(eHpa: number, pHpa: number): number {
  return (EPS * eHpa) / (pHpa - eHpa);
}

/** The most water vapor the air can hold at this temperature and pressure, kg/kg. */
export function satMixingRatio(tC: number, pHpa: number): number {
  return mixingRatio(satVaporPressure(tC), pHpa);
}

/** Vapor pressure from a mixing ratio, hPa. */
export function vaporPressure(w: number, pHpa: number): number {
  return (w * pHpa) / (EPS + w);
}

/** Dew point: the temperature at which this vapor pressure would saturate the air, °C. */
export function dewPoint(eHpa: number): number {
  const l = Math.log(eHpa / 6.112);
  return (243.5 * l) / (17.67 - l);
}

export function relativeHumidity(tC: number, dewC: number): number {
  return satVaporPressure(dewC) / satVaporPressure(tC);
}

/** Warming from condensing `dw` kg/kg of vapor: L·Δw / cp, K. */
export function latentWarming(dw: number): number {
  return (LV * dw) / CP;
}

/**
 * Saturation adjustment: cool or moisten air past saturation and the excess vapor condenses,
 * releasing latent heat that warms it. Returns the final temperature and the water condensed.
 */
export function condense(tC: number, w: number, pHpa: number): { tC: number; w: number; liquid: number } {
  if (w <= satMixingRatio(tC, pHpa)) return { tC, w, liquid: 0 };
  // Solve T' = T + L/cp·(w − ws(T')) by bisection.
  let lo = tC;
  let hi = tC + latentWarming(w) + 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = mid - tC - latentWarming(w - satMixingRatio(mid, pHpa));
    if (f > 0) hi = mid;
    else lo = mid;
  }
  const t = (lo + hi) / 2;
  const ws = satMixingRatio(t, pHpa);
  return { tC: t, w: ws, liquid: w - ws };
}

/**
 * The moist (saturated) adiabatic lapse rate, K per km: how fast rising saturated air cools when
 * the latent heat of the vapor condensing in it is counted.
 */
export function moistLapseRate(tC: number, pHpa: number): number {
  const T = tC + K0;
  const ws = satMixingRatio(tC, pHpa);
  const num = G * (1 + (LV * ws) / (RD * T));
  const den = CP + (LV * LV * ws * EPS) / (RD * T * T);
  return (num / den) * 1000;
}

/**
 * The lifting condensation level: where air lifted dry-adiabatically from the surface first
 * saturates (the base of the clouds it forms).
 */
export function lcl(tC: number, dewC: number, pHpa = 1000): { heightM: number; tempC: number; pressureHpa: number } {
  const w = mixingRatio(satVaporPressure(dewC), pHpa);
  if (dewC >= tC) return { heightM: 0, tempC: tC, pressureHpa: pHpa };
  // March up in 5 m steps with the standard atmosphere's pressure profile scaled to the surface.
  const theta = potentialTemperature(tC, pHpa);
  let z = 0;
  let p = pHpa;
  let t = tC;
  while (z < 8000) {
    const z2 = z + 5;
    p = pHpa * (standardPressure(z2) / standardPressure(0));
    t = theta * Math.pow(p / P_REF, KAPPA) - K0;
    z = z2;
    if (satMixingRatio(t, p) <= w) break;
  }
  return { heightM: z, tempC: t, pressureHpa: p };
}

// ---------------------------------------------------------------------------
// Stability and the parcel method.

/** A simplified temperature profile of the atmosphere. */
export interface Sounding {
  /** Surface air temperature, °C. */
  surfaceC: number;
  /** How fast the surrounding air cools with height up to the tropopause, K per km. */
  lapse: number;
  /** Height of the tropopause, above which the temperature stays constant, km. */
  tropopauseKm?: number;
  /** An inversion: a layer where the temperature rises with height. */
  inversion?: { baseKm: number; depthKm: number; strengthK: number };
  /** Surface pressure, hPa. */
  surfaceHpa?: number;
}

/** Temperature of the surrounding air at a height, °C. */
export function envTemp(s: Sounding, zKm: number): number {
  const top = s.tropopauseKm ?? 12;
  const zz = Math.min(zKm, top);
  let t = s.surfaceC - s.lapse * zz;
  if (s.inversion && s.inversion.strengthK !== 0) {
    const { baseKm, depthKm, strengthK } = s.inversion;
    // Inside the inversion the air warms by `strengthK` across the layer instead of cooling.
    if (zz > baseKm) {
      const inLayer = Math.min(zz, baseKm + depthKm) - baseKm;
      t += inLayer * s.lapse + (strengthK * inLayer) / depthKm;
    }
  }
  return t;
}

export interface Ascent {
  /** Heights, km. */
  z: number[];
  env: number[];
  parcel: number[];
  /** Pressure at each height, hPa. */
  p: number[];
  /** Buoyant acceleration g·(Tp − Te)/Te, m/s². */
  buoyancy: number[];
  /** Cloud base, km. */
  lclKm: number;
  /** Level of free convection: where the parcel first becomes warmer than its surroundings above the surface, km. */
  lfcKm: number | null;
  /** Equilibrium level: where a buoyant parcel becomes cooler than its surroundings again, km. */
  elKm: number | null;
  /** Convective available potential energy, J/kg. */
  cape: number;
  /** Convective inhibition: the energy needed to lift the parcel to its LFC, J/kg (≥ 0). */
  cin: number;
}

/**
 * Lift a surface parcel through a sounding: dry-adiabatically until it saturates, then
 * moist-adiabatically (condensed water falls out). Virtual-temperature effects are ignored.
 */
export function parcelAscent(s: Sounding, dewC: number, opts: { topKm?: number; dzM?: number; startC?: number } = {}): Ascent {
  const top = opts.topKm ?? 15;
  const dz = opts.dzM ?? 50;
  const p0 = s.surfaceHpa ?? 1000;
  const start = opts.startC ?? s.surfaceC;
  const w0 = mixingRatio(satVaporPressure(Math.min(dewC, start)), p0);
  const z: number[] = [];
  const env: number[] = [];
  const parcel: number[] = [];
  const pr: number[] = [];
  const buoy: number[] = [];
  let p = p0;
  let tp = start;
  let saturated = satMixingRatio(tp, p) <= w0;
  let lclKm = saturated ? 0 : NaN;
  const steps = Math.round((top * 1000) / dz);
  for (let i = 0; i <= steps; i++) {
    const zk = (i * dz) / 1000;
    const te = envTemp(s, zk);
    z.push(zk);
    env.push(te);
    parcel.push(tp);
    pr.push(p);
    buoy.push((G * (tp - te)) / (te + K0));
    // Step up: hydrostatic pressure in the environment, parcel along its adiabat.
    const teMid = envTemp(s, zk + dz / 2000);
    const pNext = p * Math.exp((-G * dz) / (RD * (teMid + K0)));
    if (!saturated) {
      const tNext = (tp + K0) * Math.pow(pNext / p, KAPPA) - K0;
      if (satMixingRatio(tNext, pNext) <= w0) {
        saturated = true;
        lclKm = zk + dz / 1000;
      }
      tp = tNext;
    } else {
      tp -= (moistLapseRate(tp, p) * dz) / 1000;
    }
    p = pNext;
  }
  if (Number.isNaN(lclKm)) lclKm = top;

  // The convective layer is the run of positive buoyancy with the largest area: its bottom is the
  // level of free convection, its top the equilibrium level, its area the CAPE.
  let best = { from: -1, to: -1, area: 0 };
  for (let i = 1; i < z.length; i++) {
    if (buoy[i] <= 0) continue;
    let j = i;
    let area = 0;
    while (j < z.length && buoy[j] > 0) area += buoy[j++] * dz;
    if (area > best.area) best = { from: i, to: j, area };
    i = j;
  }
  let cin = 0;
  if (best.from >= 0) for (let i = 0; i < best.from; i++) if (buoy[i] < 0) cin -= buoy[i] * dz;
  return {
    z,
    env,
    parcel,
    p: pr,
    buoyancy: buoy,
    lclKm,
    lfcKm: best.from >= 0 ? z[best.from] : null,
    elKm: best.from >= 0 ? (best.to < z.length ? z[best.to] : top) : null,
    cape: best.area,
    cin,
  };
}

/**
 * Brunt–Väisälä frequency for unsaturated air: N² = (g/T)·(Γd − Γ). Positive N² is stable and a
 * displaced parcel oscillates with period 2π/N; negative N² is unstable and it runs away.
 */
export function bruntVaisala(tC: number, envLapse: number): { n2: number; periodS: number | null; growthS: number | null } {
  const n2 = (G / (tC + K0)) * ((DRY_LAPSE - envLapse) / 1000);
  if (n2 > 0) return { n2, periodS: (2 * Math.PI) / Math.sqrt(n2), growthS: null };
  if (n2 < 0) return { n2, periodS: null, growthS: 1 / Math.sqrt(-n2) };
  return { n2, periodS: null, growthS: null };
}

/**
 * Height of a parcel displaced by `z0Meters` and released at rest, `tS` seconds later, m. Stable
 * air brings it back in an oscillation; unstable air accelerates it away.
 */
export function displacedParcel(n2: number, z0Meters: number, tS: number): number {
  if (n2 > 0) return z0Meters * Math.cos(Math.sqrt(n2) * tS);
  if (n2 < 0) return z0Meters * Math.cosh(Math.sqrt(-n2) * tS);
  return z0Meters;
}

/** Stability class of a layer from its lapse rate, compared with the dry and moist adiabats. */
export function stabilityClass(envLapse: number, moistLapse: number): 'absolutely stable' | 'conditionally unstable' | 'absolutely unstable' {
  if (envLapse > DRY_LAPSE) return 'absolutely unstable';
  if (envLapse > moistLapse) return 'conditionally unstable';
  return 'absolutely stable';
}
