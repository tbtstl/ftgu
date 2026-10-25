// The course's oil fields: the rock and fluids behind the four crudes (see crudes.ts).
// Field units throughout, as the industry uses them: feet, acres, psi, millidarcies (md),
// centipoise (cP), stock-tank barrels (STB, a barrel at surface conditions).
//
//   Northfield  — a conventional sandstone anticline, discovered decades ago. Good rock, medium oil.
//   Pinyon   — a shale ("tight oil") formation, developed with long horizontal wells.
//   Coldwater   — a shallow, unconsolidated heavy-oil sand: excellent rock, very thick oil.
// The numbers are illustrative but sit in realistic ranges for fields of each kind.

export type FieldId = 'northfield' | 'pinyon' | 'coldwater';

export interface Field {
  id: FieldId;
  name: string;
  rock: string;
  /** Depth to the top of the reservoir at the crest of the structure, ft. */
  crestDepth: number;
  /** Gross thickness of the reservoir layer, ft. */
  grossThickness: number;
  /** Share of the gross thickness that is reservoir-quality rock. */
  netToGross: number;
  /** Porosity, fraction of rock volume. */
  porosity: number;
  /** Water saturation, fraction of pore volume. */
  waterSaturation: number;
  /** Permeability, millidarcies. */
  permeability: number;
  /** Oil viscosity at reservoir conditions, cP. */
  oilViscosity: number;
  /** Formation volume factor: reservoir barrels per stock-tank barrel. */
  bo: number;
  /** Total compressibility, 1/psi. */
  compressibility: number;
  /** Initial reservoir pressure at the crest, psi. */
  initialPressure: number;
  /** Specific gravity of the oil at reservoir conditions (with gas dissolved in it). */
  reservoirOilSG: number;
}

export const FIELDS: Record<FieldId, Field> = {
  northfield: {
    id: 'northfield',
    name: 'Northfield',
    rock: 'sandstone',
    crestDepth: 7800,
    grossThickness: 120,
    netToGross: 0.5,
    porosity: 0.22,
    waterSaturation: 0.25,
    permeability: 80,
    oilViscosity: 2.0,
    bo: 1.2,
    compressibility: 1.5e-5,
    initialPressure: 3650,
    reservoirOilSG: 0.76,
  },
  pinyon: {
    id: 'pinyon',
    name: 'Pinyon',
    rock: 'shale',
    crestDepth: 9500,
    grossThickness: 150,
    netToGross: 1,
    porosity: 0.07,
    waterSaturation: 0.3,
    permeability: 0.0005,
    oilViscosity: 0.4,
    bo: 1.4,
    compressibility: 1.5e-5,
    initialPressure: 5700,
    reservoirOilSG: 0.68,
  },
  coldwater: {
    id: 'coldwater',
    name: 'Coldwater',
    rock: 'unconsolidated sand',
    crestDepth: 1800,
    grossThickness: 80,
    netToGross: 0.8,
    porosity: 0.3,
    waterSaturation: 0.2,
    permeability: 2000,
    oilViscosity: 600,
    bo: 1.05,
    compressibility: 1.0e-5,
    initialPressure: 800,
    reservoirOilSG: 0.93,
  },
};

/** Northfield's structure: a dome whose top deepens as k·r² away from the crest. */
export const NORTHFIELD_TRAP = {
  /** Depth of the spill point, where the dome's closure ends, ft. */
  spillDepth: 8150,
  /** Radius of the dome at the spill point, ft (2.5 miles). */
  spillRadius: 13200,
  /** Oil–water contact found by the discovery well, ft. */
  oilWaterContact: 8000,
};

/** Hydrostatic gradient of formation brine, psi/ft (fresh water is 0.433). */
export const BRINE_GRADIENT = 0.465;
/** Pressure gradient of a column of liquid with specific gravity sg, psi/ft. */
export function gradient(sg: number): number {
  return 0.433 * sg;
}
