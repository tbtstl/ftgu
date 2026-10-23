// Seeded randomness, so a "random" day is the same every time a reader opens the lesson.

export type Rng = () => number;

/** mulberry32: fast, decent-quality 32-bit PRNG returning [0, 1). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
export function gaussian(r: Rng): number {
  let u = 0;
  while (u === 0) u = r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** AR(1) noise series with the given persistence (0–1) and standard deviation. */
export function ar1(r: Rng, n: number, persistence: number, sd: number): number[] {
  const out: number[] = [];
  let x = 0;
  const innov = sd * Math.sqrt(1 - persistence * persistence);
  for (let i = 0; i < n; i++) {
    x = persistence * x + innov * gaussian(r);
    out.push(x);
  }
  return out;
}
