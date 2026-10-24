// The oil course's crudes, and the boiling-range cuts every assay in the course is written in.
//
// A crude is described the way a refinery assay describes it: how much of it (by volume) boils in
// each temperature range, what kinds of molecules make up each range, and how much sulfur and
// metal it carries. The four crudes are fictional, but their properties sit in realistic ranges:
//
//   Ridgeback Light   — a light, sweet shale crude from the inland Ridgeback Basin.
//   Seaboard Blend    — a light, sweet offshore crude that arrives by tanker.
//   Northfield Sour   — a medium, sour crude from an old conventional field in the same basin.
//   Coldwater Heavy   — a heavy, sour crude from the north, thick enough to need diluting to move.

export type CutId = 'lpg' | 'lightNaphtha' | 'heavyNaphtha' | 'kerosene' | 'diesel' | 'vgo' | 'residue';

/** Molecule classes: paraffins, naphthenes (rings), aromatics, and resins & asphaltenes. */
export type MoleculeClass = 'paraffins' | 'naphthenes' | 'aromatics' | 'asphaltenes';
export const CLASSES: MoleculeClass[] = ['paraffins', 'naphthenes', 'aromatics', 'asphaltenes'];
export const CLASS_LABEL: Record<MoleculeClass, string> = {
  paraffins: 'Paraffins (chains)',
  naphthenes: 'Naphthenes (rings)',
  aromatics: 'Aromatics',
  asphaltenes: 'Resins & asphaltenes',
};
export const CLASS_COLOR: Record<MoleculeClass, string> = {
  paraffins: '#9cc6e4',
  naphthenes: '#8fc7a0',
  aromatics: '#e6b25c',
  asphaltenes: '#6b5a4e',
};

export interface Cut {
  id: CutId;
  name: string;
  /** Boiling range, °C (true boiling point). The residue's upper end is nominal. */
  lo: number;
  hi: number;
  /** What the cut becomes in a refinery. */
  use: string;
  color: string;
  /** Liquid specific gravity of each molecule class within this cut (water = 1). */
  classSG: Record<MoleculeClass, number>;
  /** Class shares by volume for a fully paraffinic (a = 0) and a fully aromatic (a = 1) crude. */
  classesAt0: Record<MoleculeClass, number>;
  classesAt1: Record<MoleculeClass, number>;
  /** Relative sulfur concentration (whole crude = 1 after normalizing by mass). */
  sulfurWeight: number;
  /** Relative nickel + vanadium concentration. */
  metalsWeight: number;
}

const c = (p: number, n: number, a: number, r: number): Record<MoleculeClass, number> => ({ paraffins: p, naphthenes: n, aromatics: a, asphaltenes: r });

export const CUTS: Cut[] = [
  {
    id: 'lpg',
    name: 'Gases & LPG',
    lo: -45,
    hi: 30,
    use: 'propane and butane: LPG and gasoline blending',
    color: '#c9dff0',
    classSG: c(0.56, 0.56, 0.56, 0.56),
    classesAt0: c(1, 0, 0, 0),
    classesAt1: c(1, 0, 0, 0),
    sulfurWeight: 0.01,
    metalsWeight: 0,
  },
  {
    id: 'lightNaphtha',
    name: 'Light naphtha',
    lo: 30,
    hi: 80,
    use: 'gasoline blending',
    color: '#f3e08a',
    classSG: c(0.645, 0.75, 0.88, 0.88),
    classesAt0: c(0.85, 0.13, 0.02, 0),
    classesAt1: c(0.55, 0.35, 0.1, 0),
    sulfurWeight: 0.03,
    metalsWeight: 0,
  },
  {
    id: 'heavyNaphtha',
    name: 'Heavy naphtha',
    lo: 80,
    hi: 160,
    use: 'reformed into high-octane gasoline',
    color: '#ecc65a',
    classSG: c(0.71, 0.78, 0.87, 0.87),
    classesAt0: c(0.65, 0.27, 0.08, 0),
    classesAt1: c(0.3, 0.45, 0.25, 0),
    sulfurWeight: 0.08,
    metalsWeight: 0,
  },
  {
    id: 'kerosene',
    name: 'Kerosene',
    lo: 160,
    hi: 250,
    use: 'jet fuel',
    color: '#e9a557',
    classSG: c(0.75, 0.82, 0.93, 0.93),
    classesAt0: c(0.6, 0.25, 0.15, 0),
    classesAt1: c(0.2, 0.4, 0.4, 0),
    sulfurWeight: 0.25,
    metalsWeight: 0,
  },
  {
    id: 'diesel',
    name: 'Diesel',
    lo: 250,
    hi: 350,
    use: 'diesel and heating oil',
    color: '#d97f3e',
    classSG: c(0.78, 0.86, 0.97, 0.97),
    classesAt0: c(0.55, 0.25, 0.2, 0),
    classesAt1: c(0.15, 0.35, 0.5, 0),
    sulfurWeight: 0.65,
    metalsWeight: 0,
  },
  {
    id: 'vgo',
    name: 'Vacuum gas oil',
    lo: 350,
    hi: 550,
    use: 'cracked into gasoline and diesel',
    color: '#a5603a',
    classSG: c(0.82, 0.9, 1.02, 1.05),
    classesAt0: c(0.45, 0.3, 0.22, 0.03),
    classesAt1: c(0.1, 0.3, 0.5, 0.1),
    sulfurWeight: 1.35,
    metalsWeight: 0.04,
  },
  {
    id: 'residue',
    name: 'Vacuum residue',
    lo: 550,
    hi: 800,
    use: 'fuel oil, asphalt, or coked',
    color: '#5d4637',
    classSG: c(0.86, 0.94, 1.05, 1.12),
    classesAt0: c(0.3, 0.3, 0.25, 0.15),
    classesAt1: c(0.05, 0.15, 0.4, 0.4),
    sulfurWeight: 2.2,
    metalsWeight: 1,
  },
];

export const CUT_INDEX: Record<CutId, number> = Object.fromEntries(CUTS.map((ct, i) => [ct.id, i])) as Record<CutId, number>;

export type CrudeId = 'ridgeback' | 'seaboard' | 'northfield' | 'coldwater';

export interface CrudeSpec {
  id: CrudeId;
  name: string;
  /** Volume fraction boiling in each cut, in CUTS order; sums to 1. */
  yields: number[];
  /** 0 = all chains (paraffinic), 1 = rich in rings and aromatics. */
  aromaticity: number;
  /** Whole-crude sulfur, % by weight. */
  sulfur: number;
  /** Nickel + vanadium, parts per million by weight. */
  metals: number;
  /** Where it comes from, for prose and labels. */
  origin: string;
}

export const CRUDE_SPECS: CrudeSpec[] = [
  {
    id: 'ridgeback',
    name: 'Ridgeback Light',
    yields: [0.035, 0.11, 0.17, 0.16, 0.21, 0.24, 0.075],
    aromaticity: 0.1,
    sulfur: 0.15,
    metals: 3,
    origin: 'shale wells in the inland Ridgeback Basin',
  },
  {
    id: 'seaboard',
    name: 'Seaboard Blend',
    yields: [0.025, 0.08, 0.15, 0.14, 0.22, 0.27, 0.115],
    aromaticity: 0.2,
    sulfur: 0.4,
    metals: 12,
    origin: 'an offshore field; it arrives by tanker',
  },
  {
    id: 'northfield',
    name: 'Northfield Sour',
    yields: [0.02, 0.055, 0.115, 0.12, 0.2, 0.3, 0.19],
    aromaticity: 0.5,
    sulfur: 1.9,
    metals: 60,
    origin: 'an old conventional field in the Ridgeback Basin',
  },
  {
    id: 'coldwater',
    name: 'Coldwater Heavy',
    yields: [0.01, 0.03, 0.07, 0.09, 0.17, 0.28, 0.35],
    aromaticity: 0.7,
    sulfur: 3.5,
    metals: 220,
    origin: 'heavy-oil fields far to the north',
  },
];

export const CRUDE_IDS: CrudeId[] = CRUDE_SPECS.map((s) => s.id);
export const CRUDE_SHORT: Record<CrudeId, string> = { ridgeback: 'Ridgeback', seaboard: 'Seaboard', northfield: 'Northfield', coldwater: 'Coldwater' };
/** Graphic colors for the four crudes, light to heavy. */
export const CRUDE_COLOR: Record<CrudeId, string> = { ridgeback: '#4590ce', seaboard: '#2a9d90', northfield: '#d0702a', coldwater: '#6b5a4e' };
