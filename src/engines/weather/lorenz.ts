// The Lorenz-63 system: three variables standing for convection in a heated layer of fluid,
//   dx/dt = σ(y − x),  dy/dt = x(ρ − z) − y,  dz/dt = xy − βz,
// with Lorenz's values σ = 10, ρ = 28, β = 8/3. Deterministic, yet two runs that start a hair
// apart diverge exponentially (the largest Lyapunov exponent is about 0.9 per time unit) until
// they are as different as two random states on the attractor.

export interface L3 {
  x: number;
  y: number;
  z: number;
}

export const LORENZ = { sigma: 10, rho: 28, beta: 8 / 3 };
/** Largest Lyapunov exponent of the Lorenz-63 system at the standard parameters, per time unit. */
export const LYAPUNOV = 0.906;

function deriv(s: L3, p = LORENZ): L3 {
  return { x: p.sigma * (s.y - s.x), y: s.x * (p.rho - s.z) - s.y, z: s.x * s.y - p.beta * s.z };
}

/** One fourth-order Runge–Kutta step. */
export function lorenzStep(s: L3, dt: number, p = LORENZ): L3 {
  const k1 = deriv(s, p);
  const k2 = deriv({ x: s.x + (dt / 2) * k1.x, y: s.y + (dt / 2) * k1.y, z: s.z + (dt / 2) * k1.z }, p);
  const k3 = deriv({ x: s.x + (dt / 2) * k2.x, y: s.y + (dt / 2) * k2.y, z: s.z + (dt / 2) * k2.z }, p);
  const k4 = deriv({ x: s.x + dt * k3.x, y: s.y + dt * k3.y, z: s.z + dt * k3.z }, p);
  return {
    x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: s.y + (dt / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: s.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
  };
}

/** A trajectory of `n` steps of `dt` from `s0`, including the start. */
export function lorenzRun(s0: L3, n: number, dt = 0.01, p = LORENZ): L3[] {
  const out = [s0];
  let s = s0;
  for (let i = 0; i < n; i++) out.push((s = lorenzStep(s, dt, p)));
  return out;
}

export function distance(a: L3, b: L3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** A point on the attractor: the state after running from a fixed start for `t` time units. */
export function attractorPoint(t: number, dt = 0.01): L3 {
  const spin = lorenzRun({ x: 1, y: 1, z: 1 }, 1500, dt);
  const n = Math.max(0, Math.round(t / dt));
  return n === 0 ? spin[spin.length - 1] : lorenzRun(spin[spin.length - 1], n, dt)[n];
}

/** Time until two runs starting `eps` apart in x first separate by more than `threshold`, time units (null if they never do within `maxT`). */
export function separationTime(s0: L3, eps: number, threshold = 5, maxT = 40, dt = 0.01): number | null {
  let a = s0;
  let b = { ...s0, x: s0.x + eps };
  const n = Math.round(maxT / dt);
  for (let i = 1; i <= n; i++) {
    a = lorenzStep(a, dt);
    b = lorenzStep(b, dt);
    if (distance(a, b) > threshold) return i * dt;
  }
  return null;
}

/** An ensemble: `n` members scattered around `s0` with standard deviation `spread` in each variable, from a fixed seed. */
export function ensembleStarts(s0: L3, n: number, spread: number, seed = 5): L3[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  return Array.from({ length: n }, () => ({ x: s0.x + spread * g(), y: s0.y + spread * g(), z: s0.z + spread * g() }));
}

/** Which lobe ("wing") of the butterfly a state is on: the sign of x. */
export function wing(s: L3): 'left' | 'right' {
  return s.x < 0 ? 'left' : 'right';
}
