// Wells: what they cost and what they produce (Lessons 2.3–2.5).
//
// Three designs: a vertical well, a horizontal well, and a horizontal well with hydraulic
// fractures ("fractured"). Production follows the flow regime the rock allows:
//   • Radial flow around the wellbore (vertical wells, and around an unfractured lateral):
//       q = k·h·Δp / (162.6·Bo·μ·(log10(k·t/(φ·μ·ct·rw²)) − 3.23))      [t in hours]
//     the standard semilog solution, inverted for a well held at constant drawdown.
//   • Linear flow into flat surfaces (fracture faces, or the faces of a lateral once the
//     disturbance spans the layer), q = A·Δp·√(k·φ·ct/(π·μ·t)), worked in SI units.
//   • Once the disturbance reaches the edge of the well's drainage (or neighboring fractures
//     interfere), the transient ends. In permeable rock the well then depletes its drainage area
//     exponentially toward a primary recovery factor; in tight rock the decline continues as a
//     hyperbola (b = 0.8) whose starting decline matches the end of linear flow, D = 1/(2t).
// Costs combine a rig spread per day, tubulars per foot drilled and a price per fracture stage.
// The parameters are illustrative but give realistic magnitudes (an onshore shale well of about
// $8 million producing about 1,000 barrels a day in its first month).

import { FIELDS, type FieldId } from '../../model/oil/fields';
import { hoursToReach } from './reservoir';

export type WellType = 'vertical' | 'horizontal' | 'fractured';

export interface WellDesign {
  type: WellType;
  /** Horizontal length, ft (ignored for vertical wells). */
  lateral: number;
  /** Fracture stages along the lateral (fractured wells only). */
  stages: number;
}

export interface Rock {
  field: FieldId;
  k: number;
  h: number;
  phi: number;
  mu: number;
  ct: number;
  bo: number;
  sw: number;
  depth: number;
  /** Pressure difference the well is produced at, psi. */
  drawdown: number;
}

/** The drawdown each field is produced at: Northfield is held above its bubble point; Pinyon is drawn hard. */
export const DRAWDOWN: Record<FieldId, number> = { northfield: 1000, pinyon: 4200, coldwater: 400 };

export function rockOf(field: FieldId): Rock {
  const f = FIELDS[field];
  return {
    field,
    k: f.permeability,
    h: f.grossThickness * f.netToGross,
    phi: f.porosity,
    mu: f.oilViscosity,
    ct: f.compressibility,
    bo: f.bo,
    sw: f.waterSaturation,
    depth: f.crestDepth,
    drawdown: DRAWDOWN[field],
  };
}

export const WELL = {
  /** Wellbore radius, ft (a 7-inch hole). */
  rw: 0.29,
  /** Effective fractures per stage, fracture half-length and height, ft. */
  fracturesPerStage: 2,
  halfLength: 150,
  fracHeight: 100,
  /** Drainage of a vertical well: 160 acres. */
  verticalAcres: 160,
  /** Width of the strip a horizontal well drains on each side, ft. */
  sideReach: 660,
  /** Primary recovery factor in permeable rock (share of drainage oil in place). */
  primaryRecovery: 0.2,
  /** Hyperbolic exponent of a tight-rock well after its fractures interfere. */
  tightB: 0.8,
  /** Most a well's surface equipment handles, STB/day. */
  maxRate: 3000,
};

export const COST = {
  /** Rig and services, $ per day on location. */
  rigPerDay: 55000,
  /** Moving in, casing and cementing, $ per well. */
  mobilize: 500000,
  /** Tubulars and consumables, $ per foot drilled. */
  perFoot: 100,
  /** Vertical drilling speed and lateral drilling speed, ft/day. */
  verticalFtPerDay: 1200,
  lateralFtPerDay: 1800,
  /** Building the curve from vertical to horizontal: days and extra footage. */
  curveDays: 3,
  curveFeet: 1000,
  /** Completion: a base cost plus a price per fracture stage, $. */
  completionBase: 400000,
  perStage: 75000,
  /** Wellhead, flowlines and tanks, $. */
  facilities: 600000,
};

export interface WellCost {
  drilling: number;
  completion: number;
  facilities: number;
  total: number;
  days: number;
  measuredDepth: number;
}

export function wellCost(d: WellDesign, rock: Rock): WellCost {
  const horizontal = d.type !== 'vertical';
  const md = rock.depth + (horizontal ? COST.curveFeet + d.lateral : 0);
  const days = 2 + rock.depth / COST.verticalFtPerDay + (horizontal ? COST.curveDays + d.lateral / COST.lateralFtPerDay : 0);
  const drilling = COST.mobilize + COST.perFoot * md + COST.rigPerDay * days;
  const completion = COST.completionBase + (d.type === 'fractured' ? COST.perStage * d.stages : 0);
  return { drilling, completion, facilities: COST.facilities, total: drilling + completion + COST.facilities, days, measuredDepth: md };
}

// ---------------------------------------------------------------------------
// Flow regimes.

const MD_TO_M2 = 9.869233e-16;
const CP_TO_PAS = 1e-3;
const PSI_TO_PA = 6894.757;
const FT_TO_M = 0.3048;
const M3S_TO_BBLD = 86400 / 0.158987;

/** Linear flow into faces of total area `areaFt2` at time `days`, STB/day. */
export function linearRate(rock: Rock, areaFt2: number, days: number): number {
  const t = Math.max(days, 1e-3) * 86400;
  const A = areaFt2 * FT_TO_M * FT_TO_M;
  const k = rock.k * MD_TO_M2;
  const mu = rock.mu * CP_TO_PAS;
  const ct = rock.ct / PSI_TO_PA;
  const dp = rock.drawdown * PSI_TO_PA;
  const q = A * dp * Math.sqrt((k * rock.phi * ct) / (Math.PI * mu * t));
  return (q * M3S_TO_BBLD) / rock.bo;
}

/** Radial flow around a wellbore over a length `lengthFt` (the thickness for a vertical well), STB/day. */
export function radialTransientRate(rock: Rock, lengthFt: number, days: number): number {
  const hours = Math.max(days, 1e-3) * 24;
  const arg = Math.log10((rock.k * hours) / (rock.phi * rock.mu * rock.ct * WELL.rw * WELL.rw)) - 3.23;
  return (rock.k * lengthFt * rock.drawdown) / (162.6 * rock.bo * rock.mu * Math.max(1, arg));
}

/** Total fracture-face area of a fractured well, ft². */
export function fractureArea(d: WellDesign): number {
  return d.stages * WELL.fracturesPerStage * 4 * WELL.halfLength * WELL.fracHeight;
}

/** Distance between neighboring fractures, ft. */
export function fractureSpacing(d: WellDesign): number {
  return d.lateral / Math.max(1, d.stages * WELL.fracturesPerStage);
}

/** Oil in place in a design's drainage volume, STB. */
export function drainageOil(d: WellDesign, rock: Rock): number {
  const areaFt2 = d.type === 'vertical' ? WELL.verticalAcres * 43560 : (d.lateral + 2 * WELL.sideReach) * 2 * WELL.sideReach;
  return (areaFt2 * rock.h * rock.phi * (1 - rock.sw)) / (5.6146 * rock.bo);
}

/** When the transient ends (days): the edge of the drainage, or fracture interference. */
export function transientEnd(d: WellDesign, rock: Rock): number {
  const reach = (r: number) => hoursToReach(r, rock.k, rock.phi, rock.mu, rock.ct) / 24;
  if (d.type === 'fractured') return reach(fractureSpacing(d) / 2);
  if (d.type === 'horizontal') return reach(WELL.sideReach);
  return reach(Math.sqrt((WELL.verticalAcres * 43560) / Math.PI));
}

/** Transient rate (before boundaries matter), STB/day. */
export function transientRate(d: WellDesign, rock: Rock, days: number): number {
  if (d.type === 'vertical') return radialTransientRate(rock, rock.h, days);
  if (d.type === 'horizontal') return Math.min(radialTransientRate(rock, d.lateral, days), linearRate(rock, 2 * d.lateral * rock.h, days));
  return linearRate(rock, fractureArea(d), days);
}

export interface Profile {
  /** Days at which rates are given (midpoints of monthly steps). */
  days: number[];
  /** STB/day in each month. */
  rate: number[];
  /** Cumulative STB at the end of each month. */
  cum: number[];
  /** When the transient ends, days. */
  transientEnd: number;
  /** Tight rock (decline continues hyperbolically) or permeable rock (depletes its drainage). */
  tight: boolean;
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Monthly production for `months` months. Each month's rate is the average over the month,
 * capped by the surface equipment.
 */
export function wellProfile(d: WellDesign, rock: Rock, months = 360): Profile {
  const tEnd = transientEnd(d, rock);
  const tight = rock.k < 1;
  const steps = 8; // sub-steps per month for the averages
  const days: number[] = [];
  const rate: number[] = [];
  const cum: number[] = [];
  let np = 0;
  let qEnd = 0;
  let npEnd = 0;
  let ended = false;
  const recoverable = WELL.primaryRecovery * drainageOil(d, rock);
  for (let m = 0; m < months; m++) {
    let vol = 0;
    for (let s = 0; s < steps; s++) {
      const t = (m + (s + 0.5) / steps) * DAYS_PER_MONTH;
      let q: number;
      if (t <= tEnd) {
        q = Math.min(WELL.maxRate, transientRate(d, rock, t));
      } else {
        if (!ended) {
          ended = true;
          qEnd = Math.min(WELL.maxRate, transientRate(d, rock, tEnd));
          npEnd = np;
        }
        const dt = t - tEnd;
        if (tight) {
          const Di = 1 / (2 * tEnd);
          q = qEnd * Math.pow(1 + WELL.tightB * Di * dt, -1 / WELL.tightB);
        } else {
          const left = Math.max(1, recoverable - npEnd);
          q = qEnd * Math.exp((-qEnd / left) * dt);
        }
      }
      const v = (q * DAYS_PER_MONTH) / steps;
      vol += v;
      np += v;
    }
    days.push((m + 0.5) * DAYS_PER_MONTH);
    rate.push(vol / DAYS_PER_MONTH);
    cum.push(np);
  }
  return { days, rate, cum, transientEnd: tEnd, tight };
}

/** First-month average rate (the industry's "IP30"), first-year and 30-year cumulative production. */
export function wellSummary(d: WellDesign, rock: Rock) {
  const p = wellProfile(d, rock, 360);
  return { ip30: p.rate[0], firstYear: p.cum[11], eur30: p.cum[359], profile: p, cost: wellCost(d, rock) };
}
