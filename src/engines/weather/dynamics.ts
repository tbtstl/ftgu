// Horizontal motion on a rotating planet: the pressure-gradient force, the Coriolis effect,
// geostrophic balance and friction; and the planetary circulation they produce (the Hadley cell's
// reach and the winds of an angular-momentum-conserving ring of air).

/** Earth's rotation rate, rad/s (one turn per sidereal day). */
export const OMEGA = 7.2921e-5;
export const EARTH_RADIUS_M = 6.371e6;
export const AIR_DENSITY = 1.2;

/** The Coriolis parameter f = 2Ω·sin(latitude), s⁻¹. Negative in the Southern Hemisphere. */
export function coriolis(latDeg: number, rotation = 1): number {
  return 2 * OMEGA * rotation * Math.sin((latDeg * Math.PI) / 180);
}

/** A pressure gradient in hPa per 100 km, as a force per kilogram of air, m/s². */
export function pressureForce(hpaPer100km: number, rho = AIR_DENSITY): number {
  return (hpaPer100km * 100) / 1e5 / rho;
}

/** Geostrophic wind speed: the pressure force balanced by the Coriolis force, |F| / |f|, m/s. */
export function geostrophicSpeed(hpaPer100km: number, latDeg: number, rho = AIR_DENSITY): number {
  return pressureForce(hpaPer100km, rho) / Math.abs(coriolis(latDeg));
}

/** One inertial period, 2π/|f|: how long a wind takes to swing once around its balance, hours. */
export function inertialPeriodHours(latDeg: number): number {
  return (2 * Math.PI) / Math.abs(coriolis(latDeg)) / 3600;
}

export interface SteadyWind {
  /** Component along the isobars (east, with low pressure to the north), m/s. */
  along: number;
  /** Component across the isobars toward low pressure, m/s. */
  across: number;
  speed: number;
  /** Angle between the wind and the isobars, degrees. */
  angleDeg: number;
}

/**
 * The steady wind where the pressure force, the Coriolis force and a linear friction −k·V balance.
 * Low pressure lies to the north. Without friction it blows along the isobars (east in the
 * Northern Hemisphere); friction slows it and turns it toward low pressure by atan(k/|f|).
 */
export function steadyWind(hpaPer100km: number, latDeg: number, friction: number, rho = AIR_DENSITY): SteadyWind {
  const F = pressureForce(hpaPer100km, rho);
  const f = coriolis(latDeg);
  const den = f * f + friction * friction;
  if (den === 0) return { along: 0, across: Infinity, speed: Infinity, angleDeg: 90 };
  const along = (F * f) / den;
  const across = (F * friction) / den;
  const speed = Math.hypot(along, across);
  return { along, across, speed, angleDeg: (Math.atan2(across, Math.abs(along)) * 180) / Math.PI };
}

export interface TrackPoint {
  /** Hours since release. */
  t: number;
  /** Position, km east and north of the release point. */
  x: number;
  y: number;
  /** Velocity, m/s. */
  u: number;
  v: number;
}

/**
 * A parcel released at rest where the pressure falls toward the north, followed for `hours`:
 *   du/dt = f·v − k·u,   dv/dt = −f·u + F − k·v.
 * Integrated exactly as a damped rotation, so any step size is stable.
 */
export function windTrack(hpaPer100km: number, latDeg: number, friction: number, hours: number, stepMinutes = 10, rho = AIR_DENSITY): TrackPoint[] {
  const F = pressureForce(hpaPer100km, rho);
  const f = coriolis(latDeg);
  const k = friction;
  const steady = steadyWind(hpaPer100km, latDeg, friction, rho);
  // Steady state (u*, v*) = (along, across); the departure from it decays and rotates.
  const us = Number.isFinite(steady.along) ? steady.along : 0;
  const vs = Number.isFinite(steady.across) ? steady.across : 0;
  const out: TrackPoint[] = [];
  const dt = stepMinutes * 60;
  const n = Math.round((hours * 60) / stepMinutes);
  let x = 0;
  let y = 0;
  const pos = (t: number) => {
    // Velocity departure: (u − u*, v − v*) = e^{−kt}·R(−f t)·(−u*, −v*)
    const e = Math.exp(-k * t);
    const c = Math.cos(f * t);
    const s = Math.sin(f * t);
    const du = e * (-us * c + -vs * s);
    const dv = e * (vs * -c - -us * s);
    return { u: us + du, v: vs + dv };
  };
  // Special case: no rotation and no friction — straight acceleration toward the low.
  const free = f === 0 && k === 0;
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    let u: number;
    let v: number;
    if (free) {
      u = 0;
      v = F * t;
    } else if (f === 0) {
      u = 0;
      v = (F / k) * (1 - Math.exp(-k * t));
    } else {
      ({ u, v } = pos(t));
    }
    out.push({ t: t / 3600, x: x / 1000, y: y / 1000, u, v });
    // Advance position with the trapezoid rule over the step.
    let u2: number;
    let v2: number;
    if (free) {
      u2 = 0;
      v2 = F * (t + dt);
    } else if (f === 0) {
      u2 = 0;
      v2 = (F / k) * (1 - Math.exp(-k * (t + dt)));
    } else {
      ({ u: u2, v: v2 } = pos(t + dt));
    }
    x += ((u + u2) / 2) * dt;
    y += ((v + v2) / 2) * dt;
  }
  return out;
}

/**
 * Steady wind at a point in a circular low (or high) with a Gaussian pressure dip:
 * p(r) = p∞ − Δp·exp(−r²/2L²). Returns the wind vector (m/s, east and north) at (x, y) km
 * from the center, from the local balance of pressure force, Coriolis and friction.
 */
export function cycloneWind(xKm: number, yKm: number, opts: { depthHpa: number; radiusKm: number; latDeg: number; friction: number; maxSpeed?: number }): { u: number; v: number; pressure: number } {
  const { depthHpa, radiusKm: L, latDeg, friction: k } = opts;
  const r2 = xKm * xKm + yKm * yKm;
  const g = Math.exp(-r2 / (2 * L * L));
  const pressure = 1013 - depthHpa * g;
  // ∇p (hPa per km) = Δp·g·(x, y)/L²; the force per unit mass points down the gradient.
  const dpdx = (depthHpa * g * xKm) / (L * L);
  const dpdy = (depthHpa * g * yKm) / (L * L);
  const fx = (-dpdx * 100) / 1000 / AIR_DENSITY;
  const fy = (-dpdy * 100) / 1000 / AIR_DENSITY;
  const f = coriolis(latDeg);
  // Solve 0 = f·v − k·u + Fx, 0 = −f·u − k·v + Fy.
  const den = f * f + k * k;
  let u = 0;
  let v = 0;
  if (den > 0) {
    u = (k * fx + f * fy) / den;
    v = (k * fy - f * fx) / den;
  }
  const cap = opts.maxSpeed ?? 60;
  const sp = Math.hypot(u, v);
  if (sp > cap) {
    u *= cap / sp;
    v *= cap / sp;
  }
  return { u, v, pressure };
}

// ---------------------------------------------------------------------------
// The planetary circulation.

/**
 * Poleward edge of the Hadley cell in the Held–Hou (1980) model, degrees:
 * φ_H = √(5·g·H·Δ / (3·Ω²·a²)), with H the tropopause height and Δ the fractional
 * equator-to-pole contrast in radiative-equilibrium temperature.
 */
export function hadleyEdgeDeg(opts: { rotation: number; contrast: number; tropopauseKm?: number }): number {
  const H = (opts.tropopauseKm ?? 15) * 1000;
  const om = OMEGA * Math.max(1e-6, opts.rotation);
  const phi = Math.sqrt((5 * 9.81 * H * opts.contrast) / (3 * om * om * EARTH_RADIUS_M * EARTH_RADIUS_M));
  return Math.min(90, (phi * 180) / Math.PI);
}

/**
 * The west-to-east wind of a ring of air that leaves the equator at rest and keeps its angular
 * momentum as it moves poleward: u = Ω·a·sin²φ / cos φ, m/s.
 */
export function angularMomentumWind(latDeg: number, rotation = 1): number {
  const p = (latDeg * Math.PI) / 180;
  return (OMEGA * rotation * EARTH_RADIUS_M * Math.sin(p) ** 2) / Math.cos(p);
}

/** Speed of the ground at a latitude as the planet turns, m/s. */
export function surfaceSpeed(latDeg: number, rotation = 1): number {
  return OMEGA * rotation * EARTH_RADIUS_M * Math.cos((latDeg * Math.PI) / 180);
}

export interface CirculationCell {
  name: 'Hadley' | 'Ferrel' | 'Polar';
  from: number;
  to: number;
  /** Thermally direct cells rise on their warm side and sink on their cold side. */
  direct: boolean;
}

export interface WindBelt {
  name: string;
  from: number;
  to: number;
  /** The direction the surface wind blows from. */
  fromThe: 'east' | 'west';
}

export interface Circulation {
  /** Poleward edge of the Hadley cell (Held–Hou), degrees. */
  hadleyEdge: number;
  cells: CirculationCell[];
  belts: WindBelt[];
  /** Latitude of the subtropical jet: above the Hadley cell's poleward edge, degrees. */
  jetLat: number;
  /** What the jet would be if the poleward-moving air kept all its angular momentum, m/s. */
  jetSpeedIdeal: number;
}

/**
 * The three-cell picture of one hemisphere. Only the Hadley cell's reach is computed (from the
 * rotation rate and the equator-to-pole contrast); the boundary between the Ferrel and polar
 * cells is drawn at 60°, where it is observed on Earth. If the Hadley cell reaches past 60° it
 * takes the whole hemisphere.
 */
export function circulation(rotation: number, contrast: number): Circulation {
  const edge = hadleyEdgeDeg({ rotation, contrast });
  const cells: CirculationCell[] = [];
  const belts: WindBelt[] = [];
  if (edge >= 60) {
    cells.push({ name: 'Hadley', from: 0, to: 90, direct: true });
    belts.push({ name: 'Easterlies', from: 0, to: 90, fromThe: 'east' });
  } else {
    cells.push({ name: 'Hadley', from: 0, to: edge, direct: true });
    cells.push({ name: 'Ferrel', from: edge, to: 60, direct: false });
    cells.push({ name: 'Polar', from: 60, to: 90, direct: true });
    belts.push({ name: 'Trade winds', from: 0, to: edge, fromThe: 'east' });
    belts.push({ name: 'Westerlies', from: edge, to: 60, fromThe: 'west' });
    belts.push({ name: 'Polar easterlies', from: 60, to: 90, fromThe: 'east' });
  }
  const jetLat = Math.min(edge, 89);
  return { hadleyEdge: edge, cells, belts, jetLat, jetSpeedIdeal: angularMomentumWind(jetLat, rotation) };
}
