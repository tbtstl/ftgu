// Vapor–liquid equilibrium for simple hydrocarbon mixtures (Lesson 1.4).
//
// Each component's vapor pressure comes from the Antoine equation, log10 P[mmHg] = A − B/(C + T[°C]),
// with published constants for the normal alkanes. Mixtures are treated as ideal (Raoult's law):
// component i's equilibrium ratio is K_i = Psat_i(T) / P, and a mixture flashed at T and P splits
// into vapor and liquid by the Rachford–Rice equation. Hydrocarbons of similar kinds mix nearly
// ideally, so this is a good approximation for the alkanes used here.

export type ComponentId = 'pentane' | 'hexane' | 'heptane' | 'octane' | 'decane';

export interface Component {
  id: ComponentId;
  name: string;
  carbons: number;
  antoine: { A: number; B: number; C: number };
  color: string;
}

export const COMPONENTS: Record<ComponentId, Component> = {
  pentane: { id: 'pentane', name: 'Pentane', carbons: 5, antoine: { A: 6.87632, B: 1075.78, C: 233.205 }, color: '#4590ce' },
  hexane: { id: 'hexane', name: 'Hexane', carbons: 6, antoine: { A: 6.87601, B: 1171.17, C: 224.408 }, color: '#4590ce' },
  heptane: { id: 'heptane', name: 'Heptane', carbons: 7, antoine: { A: 6.89677, B: 1264.9, C: 216.544 }, color: '#2a9d90' },
  octane: { id: 'octane', name: 'Octane', carbons: 8, antoine: { A: 6.91868, B: 1351.99, C: 209.155 }, color: '#d0702a' },
  decane: { id: 'decane', name: 'Decane', carbons: 10, antoine: { A: 6.94363, B: 1495.17, C: 193.858 }, color: '#a5603a' },
};

export const MMHG_PER_ATM = 760;

/** Vapor pressure, atm, at `tC` °C. */
export function vaporPressure(c: Component, tC: number): number {
  const { A, B, C } = c.antoine;
  return 10 ** (A - B / (C + tC)) / MMHG_PER_ATM;
}

/** Boiling point, °C, at pressure `pAtm` (the inverse of the Antoine equation). */
export function boilingPoint(c: Component, pAtm: number): number {
  const { A, B, C } = c.antoine;
  return B / (A - Math.log10(pAtm * MMHG_PER_ATM)) - C;
}

export interface Flash {
  /** Fraction of the moles that is vapor, 0–1. */
  vapor: number;
  /** Mole fractions in the liquid and the vapor, by component order. */
  x: number[];
  y: number[];
  /** Equilibrium ratios K = Psat / P. */
  K: number[];
  phase: 'liquid' | 'two-phase' | 'vapor';
}

/** Flashes a mixture (mole fractions z) at temperature tC and pressure pAtm. */
export function flash(comps: Component[], z: number[], tC: number, pAtm: number): Flash {
  const K = comps.map((c) => vaporPressure(c, tC) / pAtm);
  const sumZK = z.reduce((s, zi, i) => s + zi * K[i], 0);
  const sumZoverK = z.reduce((s, zi, i) => s + zi / K[i], 0);
  if (sumZK <= 1) return { vapor: 0, x: [...z], y: normalizeArr(z.map((zi, i) => zi * K[i])), K, phase: 'liquid' };
  if (sumZoverK <= 1) return { vapor: 1, x: normalizeArr(z.map((zi, i) => zi / K[i])), y: [...z], K, phase: 'vapor' };
  // Rachford–Rice: f(V) = Σ z_i (K_i − 1) / (1 + V (K_i − 1)) = 0, decreasing in V.
  const f = (V: number) => z.reduce((s, zi, i) => s + (zi * (K[i] - 1)) / (1 + V * (K[i] - 1)), 0);
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  const V = (lo + hi) / 2;
  const x = z.map((zi, i) => zi / (1 + V * (K[i] - 1)));
  const y = x.map((xi, i) => xi * K[i]);
  return { vapor: V, x: normalizeArr(x), y: normalizeArr(y), K, phase: 'two-phase' };
}

function normalizeArr(v: number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map((x) => (s > 0 ? x / s : 0));
}

function solveT(g: (t: number) => number, lo = -100, hi = 400): number {
  // g is increasing in T; find g(T) = 0.
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Bubble point: the temperature at which the liquid z first starts to boil, °C. */
export function bubblePoint(comps: Component[], z: number[], pAtm: number): number {
  return solveT((t) => z.reduce((s, zi, i) => s + (zi * vaporPressure(comps[i], t)) / pAtm, 0) - 1);
}

/** Dew point: the temperature at which the vapor z first starts to condense, °C. */
export function dewPoint(comps: Component[], z: number[], pAtm: number): number {
  return solveT((t) => 1 - z.reduce((s, zi, i) => s + (zi * pAtm) / vaporPressure(comps[i], t), 0));
}

/** Bubble and dew temperatures across the binary's composition (light-component mole fraction 0→1). */
export function txy(light: Component, heavy: Component, pAtm: number, n = 41): Array<{ x: number; bubble: number; dew: number }> {
  const out: Array<{ x: number; bubble: number; dew: number }> = [];
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1);
    out.push({ x, bubble: bubblePoint([light, heavy], [x, 1 - x], pAtm), dew: dewPoint([light, heavy], [x, 1 - x], pAtm) });
  }
  return out;
}

export interface Stage {
  /** Light-component mole fraction in the liquid boiled at this stage. */
  liquid: number;
  /** In the first vapor it gives off, which is condensed and passed up. */
  vapor: number;
  /** The liquid's bubble point, °C. */
  t: number;
}

/**
 * Repeated equilibrium stages at total reflux: boil a liquid, condense its first vapor, boil that,
 * and so on. Each stage enriches the light component; a distillation column does this on every tray.
 */
export function stages(light: Component, heavy: Component, x0: number, pAtm: number, n: number): Stage[] {
  const out: Stage[] = [];
  let x = x0;
  for (let k = 0; k < n; k++) {
    const t = bubblePoint([light, heavy], [x, 1 - x], pAtm);
    const kL = vaporPressure(light, t) / pAtm;
    const y = Math.min(1, x * kL);
    out.push({ liquid: x, vapor: y, t });
    x = y;
  }
  return out;
}

/** Relative volatility of the light component over the heavy one at tC. */
export function relativeVolatility(light: Component, heavy: Component, tC: number): number {
  return vaporPressure(light, tC) / vaporPressure(heavy, tC);
}
