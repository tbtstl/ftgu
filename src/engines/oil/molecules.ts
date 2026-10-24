// Hydrocarbon molecules: a small library of real compounds, their skeletons for drawing, and the
// properties Lesson 1.1 compares. Boiling points, melting points and densities are published
// values for the pure compounds (densities as liquids at 20 °C). Knock resistance and ignition
// quality are given as qualitative classes, not numbers, except for the reference fuels that
// define the scales: n-heptane is 0 and iso-octane 100 on the octane scale, n-hexadecane 100 on
// the cetane scale.

export type Family = 'straight' | 'branched' | 'ring' | 'aromatic';

export const FAMILY_LABEL: Record<Family, string> = {
  straight: 'Straight chain',
  branched: 'Branched',
  ring: 'Ring',
  aromatic: 'Aromatic',
};

/** Carbon counts the builder offers for each family. */
export const FAMILY_RANGE: Record<Family, [number, number]> = {
  straight: [1, 20],
  branched: [4, 10],
  ring: [5, 10],
  aromatic: [6, 10],
};

export type Rating = 'very low' | 'low' | 'moderate' | 'high';

interface Compound {
  name: string;
  /** Normal boiling point, °C. */
  bp: number;
  /** Melting point, °C. */
  mp: number;
  /** Liquid density at 20 °C, g/cm³ (undefined for gases at 20 °C). */
  density?: number;
  knock: Rating;
  ignition: Rating;
}

// n-alkanes C1–C20.
const STRAIGHT: Compound[] = [
  { name: 'Methane', bp: -161.5, mp: -182.5, knock: 'high', ignition: 'very low' },
  { name: 'Ethane', bp: -88.6, mp: -182.8, knock: 'high', ignition: 'very low' },
  { name: 'Propane', bp: -42.1, mp: -187.7, knock: 'high', ignition: 'very low' },
  { name: 'Butane', bp: -0.5, mp: -138.3, knock: 'high', ignition: 'very low' },
  { name: 'Pentane', bp: 36.1, mp: -129.7, density: 0.626, knock: 'moderate', ignition: 'low' },
  { name: 'Hexane', bp: 68.7, mp: -95.3, density: 0.659, knock: 'low', ignition: 'moderate' },
  { name: 'Heptane', bp: 98.4, mp: -90.6, density: 0.684, knock: 'very low', ignition: 'moderate' },
  { name: 'Octane', bp: 125.7, mp: -56.8, density: 0.703, knock: 'very low', ignition: 'moderate' },
  { name: 'Nonane', bp: 150.8, mp: -53.5, density: 0.718, knock: 'very low', ignition: 'moderate' },
  { name: 'Decane', bp: 174.1, mp: -29.7, density: 0.73, knock: 'very low', ignition: 'high' },
  { name: 'Undecane', bp: 196.0, mp: -25.6, density: 0.74, knock: 'very low', ignition: 'high' },
  { name: 'Dodecane', bp: 216.3, mp: -9.6, density: 0.749, knock: 'very low', ignition: 'high' },
  { name: 'Tridecane', bp: 235.4, mp: -5.4, density: 0.756, knock: 'very low', ignition: 'high' },
  { name: 'Tetradecane', bp: 253.5, mp: 5.9, density: 0.763, knock: 'very low', ignition: 'high' },
  { name: 'Pentadecane', bp: 270.6, mp: 9.9, density: 0.769, knock: 'very low', ignition: 'high' },
  { name: 'Hexadecane', bp: 286.8, mp: 18.2, density: 0.773, knock: 'very low', ignition: 'high' },
  { name: 'Heptadecane', bp: 302.0, mp: 22.0, density: 0.778, knock: 'very low', ignition: 'high' },
  { name: 'Octadecane', bp: 316.3, mp: 28.2, knock: 'very low', ignition: 'high' },
  { name: 'Nonadecane', bp: 329.9, mp: 32.1, knock: 'very low', ignition: 'high' },
  { name: 'Icosane', bp: 343.1, mp: 36.8, knock: 'very low', ignition: 'high' },
];

// One common isomer for each carbon count.
const BRANCHED: Record<number, Compound> = {
  4: { name: 'Isobutane', bp: -11.7, mp: -159.6, knock: 'high', ignition: 'very low' },
  5: { name: 'Isopentane', bp: 27.8, mp: -159.9, density: 0.62, knock: 'high', ignition: 'low' },
  6: { name: '2-Methylpentane', bp: 60.3, mp: -153.7, density: 0.653, knock: 'moderate', ignition: 'low' },
  7: { name: '2-Methylhexane', bp: 90.0, mp: -118.3, density: 0.679, knock: 'low', ignition: 'low' },
  8: { name: 'Iso-octane', bp: 99.3, mp: -107.4, density: 0.692, knock: 'high', ignition: 'very low' },
  9: { name: '2-Methyloctane', bp: 143.2, mp: -80.4, density: 0.713, knock: 'very low', ignition: 'moderate' },
  10: { name: '2-Methylnonane', bp: 167.1, mp: -74.6, density: 0.726, knock: 'very low', ignition: 'moderate' },
};

const RING: Record<number, Compound> = {
  5: { name: 'Cyclopentane', bp: 49.3, mp: -93.9, density: 0.745, knock: 'high', ignition: 'low' },
  6: { name: 'Cyclohexane', bp: 80.7, mp: 6.5, density: 0.779, knock: 'moderate', ignition: 'low' },
  7: { name: 'Methylcyclohexane', bp: 100.9, mp: -126.6, density: 0.77, knock: 'moderate', ignition: 'low' },
  8: { name: 'Ethylcyclohexane', bp: 131.8, mp: -111.3, density: 0.788, knock: 'low', ignition: 'low' },
  9: { name: 'Propylcyclohexane', bp: 156.7, mp: -94.9, density: 0.793, knock: 'low', ignition: 'moderate' },
  10: { name: 'Butylcyclohexane', bp: 180.9, mp: -74.7, density: 0.799, knock: 'low', ignition: 'moderate' },
};

const AROMATIC: Record<number, Compound> = {
  6: { name: 'Benzene', bp: 80.1, mp: 5.5, density: 0.877, knock: 'high', ignition: 'very low' },
  7: { name: 'Toluene', bp: 110.6, mp: -95.0, density: 0.867, knock: 'high', ignition: 'very low' },
  8: { name: 'Ethylbenzene', bp: 136.2, mp: -95.0, density: 0.867, knock: 'high', ignition: 'very low' },
  9: { name: 'Propylbenzene', bp: 159.2, mp: -99.5, density: 0.862, knock: 'high', ignition: 'very low' },
  10: { name: 'Butylbenzene', bp: 183.3, mp: -87.9, density: 0.86, knock: 'high', ignition: 'very low' },
};

export interface Atom {
  el: 'C' | 'H';
  x: number;
  y: number;
}

export interface Bond {
  a: number;
  b: number;
  /** 1 for single bonds, 1.5 for the bonds of an aromatic ring. */
  order: 1 | 1.5;
}

export interface Molecule extends Compound {
  family: Family;
  carbons: number;
  hydrogens: number;
  /** "C8H18". */
  formula: string;
  /** g/mol. */
  molarMass: number;
  /** Hydrogen atoms per carbon atom. */
  hc: number;
  /** State at 25 °C. */
  state: 'gas' | 'liquid' | 'solid';
  /** The boiling-range cut of crude oil it would end up in (see model/oil/crudes). */
  cut: string;
  atoms: Atom[];
  bonds: Bond[];
  /** Centers of aromatic rings, for drawing the inner circle. */
  rings: Array<{ x: number; y: number }>;
}

const SIN60 = Math.sqrt(3) / 2;
const H_LEN = 0.62;

/** Clamp a carbon count into the family's range. */
export function clampCarbons(family: Family, n: number): number {
  const [lo, hi] = FAMILY_RANGE[family];
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Zigzag chain starting at (x0, y0), first bond at `dir` degrees, alternating ±60° turns. */
function zigzag(n: number, x0: number, y0: number, dir = 30): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let x = x0;
  let y = y0;
  let d = dir;
  for (let i = 0; i < n; i++) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
    pts.push([x, y]);
    d = d === dir ? dir - 60 : dir;
  }
  return pts;
}

function skeleton(family: Family, n: number): { carbons: Array<[number, number]>; bonds: Bond[]; rings: Array<{ x: number; y: number }> } {
  const bonds: Bond[] = [];
  const chainBonds = (from: number, count: number) => {
    for (let i = 0; i < count - 1; i++) bonds.push({ a: from + i, b: from + i + 1, order: 1 });
  };
  if (family === 'straight') {
    const c: Array<[number, number]> = n === 1 ? [[0, 0]] : [[0, 0], ...zigzag(n - 1, 0, 0, 30)];
    chainBonds(0, n);
    return { carbons: c, bonds, rings: [] };
  }
  if (family === 'branched') {
    if (n === 8) {
      // 2,2,4-trimethylpentane: a five-carbon chain with two methyls on C2 and one on C4.
      const main: Array<[number, number]> = [[0, 0], ...zigzag(4, 0, 0, 30)];
      const c1 = main[1];
      const c3 = main[3];
      const c = [...main, [c1[0] + 0.5, c1[1] + SIN60], [c1[0] - 0.5, c1[1] + SIN60], [c3[0], c3[1] + 1]] as Array<[number, number]>;
      chainBonds(0, 5);
      bonds.push({ a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 }, { a: 3, b: 7, order: 1 });
      return { carbons: c, bonds, rings: [] };
    }
    // A chain of n − 1 carbons with one methyl on its second carbon.
    const main: Array<[number, number]> = [[0, 0], ...zigzag(n - 2, 0, 0, 30)];
    const c1 = main[1];
    chainBonds(0, n - 1);
    bonds.push({ a: 1, b: n - 1, order: 1 });
    return { carbons: [...main, [c1[0], c1[1] + 1]], bonds, rings: [] };
  }
  // Rings: a regular pentagon (n = 5) or hexagon, with a side chain on the rightmost vertex.
  const size = family === 'ring' && n === 5 ? 5 : 6;
  const R = 1 / (2 * Math.sin(Math.PI / size));
  const c: Array<[number, number]> = [];
  for (let k = 0; k < size; k++) {
    const th = (2 * Math.PI * k) / size;
    c.push([R * Math.cos(th), R * Math.sin(th)]);
  }
  const order = family === 'aromatic' ? 1.5 : 1;
  for (let k = 0; k < size; k++) bonds.push({ a: k, b: (k + 1) % size, order });
  const side = n - size;
  if (side > 0) {
    // The side chain leaves the ring straight out, then zigzags: 0°, +60°, 0°, +60°…
    let cx = c[0][0];
    let cy = c[0][1];
    for (let i = 0; i < side; i++) {
      const d = i === 0 || i % 2 === 0 ? 0 : 60;
      cx += Math.cos((d * Math.PI) / 180);
      cy += Math.sin((d * Math.PI) / 180);
      c.push([cx, cy]);
    }
    bonds.push({ a: 0, b: size, order: 1 });
    for (let i = 0; i < side - 1; i++) bonds.push({ a: size + i, b: size + i + 1, order: 1 });
  }
  return { carbons: c, bonds, rings: family === 'aromatic' ? [{ x: 0, y: 0 }] : [] };
}

/** Places hydrogens around each carbon in the widest gaps between its bonds. */
function addHydrogens(carbons: Array<[number, number]>, bonds: Bond[]): Atom[] {
  const atoms: Atom[] = carbons.map(([x, y]) => ({ el: 'C', x, y }));
  carbons.forEach(([x, y], i) => {
    const mine = bonds.filter((b) => b.a === i || b.b === i);
    const valence = mine.reduce((s, b) => s + b.order, 0);
    const count = Math.round(4 - valence);
    if (count <= 0) return;
    let angles: number[];
    if (mine.length === 0) {
      angles = [45, 135, 225, 315];
    } else {
      const dirs = mine
        .map((b) => {
          const j = b.a === i ? b.b : b.a;
          return (Math.atan2(carbons[j][1] - y, carbons[j][0] - x) * 180) / Math.PI;
        })
        .map((d) => (d + 360) % 360)
        .sort((p, q) => p - q);
      const gaps = dirs.map((d, k) => ({ start: d, size: k === dirs.length - 1 ? dirs[0] + 360 - d : dirs[k + 1] - d, n: 0 }));
      for (let h = 0; h < count; h++) {
        const g = gaps.reduce((best, gp) => (gp.size / (gp.n + 1) > best.size / (best.n + 1) ? gp : best), gaps[0]);
        g.n++;
      }
      angles = gaps.flatMap((g) => Array.from({ length: g.n }, (_, j) => g.start + (g.size * (j + 1)) / (g.n + 1)));
    }
    for (const a of angles) {
      const r = (a * Math.PI) / 180;
      atoms.push({ el: 'H', x: x + H_LEN * Math.cos(r), y: y + H_LEN * Math.sin(r) });
    }
  });
  return atoms;
}

/** Hydrogen atoms in a family's molecule with n carbons. */
export function hydrogenCount(family: Family, n: number): number {
  if (family === 'straight' || family === 'branched') return 2 * n + 2;
  if (family === 'ring') return 2 * n;
  return 2 * n - 6;
}

const subDigits = (k: number) => (k === 1 ? '' : String(k));

/** The boiling-range cut a compound boiling at `bp` °C falls in (boundaries as in model/oil/crudes). */
export function cutForBoilingPoint(bp: number): string {
  if (bp < 30) return 'gases & LPG';
  if (bp < 160) return 'naphtha (gasoline)';
  if (bp < 250) return 'kerosene (jet fuel)';
  if (bp < 350) return 'diesel';
  if (bp < 550) return 'vacuum gas oil';
  return 'residue';
}

/** The molecule the builder makes from a family and a carbon count (clamped into range). */
export function buildMolecule(family: Family, nIn: number): Molecule {
  const n = clampCarbons(family, nIn);
  const data = family === 'straight' ? STRAIGHT[n - 1] : family === 'branched' ? BRANCHED[n] : family === 'ring' ? RING[n] : AROMATIC[n];
  const h = hydrogenCount(family, n);
  const sk = skeleton(family, n);
  const atoms = addHydrogens(sk.carbons, sk.bonds);
  const state = data.bp < 25 ? 'gas' : data.mp > 25 ? 'solid' : 'liquid';
  return {
    ...data,
    family,
    carbons: n,
    hydrogens: h,
    formula: `C${subDigits(n)}H${h}`,
    molarMass: 12.011 * n + 1.008 * h,
    hc: h / n,
    state,
    cut: cutForBoilingPoint(data.bp),
    atoms,
    bonds: sk.bonds,
    rings: sk.rings,
  };
}

/** Boiling points of a family across its carbon range, for charting. */
export function boilingSeries(family: Family): Array<{ n: number; bp: number; name: string }> {
  const [lo, hi] = FAMILY_RANGE[family];
  const out: Array<{ n: number; bp: number; name: string }> = [];
  for (let n = lo; n <= hi; n++) {
    const m = buildMolecule(family, n);
    out.push({ n, bp: m.bp, name: m.name });
  }
  return out;
}
