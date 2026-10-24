// Grain quality: how a load is graded, what its quality does to its price, and how elevators
// blend loads. Corn grades follow the United States standards' numerical limits for test weight,
// heat-damaged and total damaged kernels, and broken corn and foreign material (BCFM); moisture is
// not a grade factor but is priced through shrink and a drying charge. The discount schedules are
// an illustrative elevator's, not any real one's.

export interface CornSample {
  /** Test weight, pounds per bushel. */
  testWeight: number;
  /** Total damaged kernels, percent. */
  damaged: number;
  /** Broken corn and foreign material, percent. */
  bcfm: number;
  /** Moisture, percent. */
  moisture: number;
}

/** US numerical grade limits for corn: minimum test weight, maximum damaged kernels and BCFM. */
export const CORN_GRADES = [
  { grade: 1, testWeight: 56, damaged: 3, bcfm: 2 },
  { grade: 2, testWeight: 54, damaged: 5, bcfm: 3 },
  { grade: 3, testWeight: 52, damaged: 7, bcfm: 4 },
  { grade: 4, testWeight: 49, damaged: 10, bcfm: 5 },
  { grade: 5, testWeight: 46, damaged: 15, bcfm: 7 },
];

export type GradeFactor = 'testWeight' | 'damaged' | 'bcfm';
export const FACTOR_NAME: Record<GradeFactor, string> = { testWeight: 'test weight', damaged: 'damaged kernels', bcfm: 'broken corn and foreign material' };

/** The grade each factor alone allows (6 = sample grade). */
export function factorGrades(s: CornSample): Record<GradeFactor, number> {
  const g = (ok: (row: (typeof CORN_GRADES)[number]) => boolean) => CORN_GRADES.find(ok)?.grade ?? 6;
  return {
    testWeight: g((r) => s.testWeight >= r.testWeight - 1e-9),
    damaged: g((r) => s.damaged <= r.damaged + 1e-9),
    bcfm: g((r) => s.bcfm <= r.bcfm + 1e-9),
  };
}

/** The load's grade — set by its worst factor — and which factor set it. */
export function cornGrade(s: CornSample): { grade: number; limiting: GradeFactor } {
  const f = factorGrades(s);
  const limiting = (Object.keys(f) as GradeFactor[]).reduce((a, b) => (f[b] > f[a] ? b : a));
  return { grade: f[limiting], limiting };
}

export function gradeName(grade: number): string {
  return grade >= 6 ? 'Sample grade' : `No. ${grade}`;
}

/** The elevator's schedule, $ per bushel. Everything is priced against No. 2 at 15% moisture. */
export const CORN_SCHEDULE = {
  /** Per pound of test weight below 54. */
  testWeight: 0.02,
  /** Per point of damaged kernels above 5%. */
  damaged: 0.02,
  /** Per point of BCFM above 3%. */
  bcfm: 0.02,
  /** Drying charge per point of moisture above 15%. */
  drying: 0.045,
  /** Handling shrink on wet corn, share of the bushels. */
  handling: 0.005,
  /** Extra discount for sample grade. */
  sample: 0.3,
};

export interface CornPrice {
  /** Bushels paid for, per wet bushel delivered, after shrink. */
  paidBushels: number;
  /** Quality discount, $ per bushel. */
  quality: number;
  /** Drying charge, $ per paid bushel. */
  drying: number;
  /** What the farmer receives per wet bushel delivered, $. */
  netPerBushel: number;
}

/**
 * What a load is worth per bushel delivered at the elevator's No. 2 price. Wet corn is shrunk to
 * dry-equivalent bushels — the water weight driven off, plus a little handling loss — and charged
 * for drying; quality below No. 2 is discounted factor by factor.
 */
export function cornPrice(s: CornSample, basePrice: number, sch = CORN_SCHEDULE): CornPrice {
  const wet = Math.max(0, s.moisture - 15);
  const paidBushels = wet > 0 ? ((100 - s.moisture) / 85) * (1 - sch.handling) : 1;
  const quality =
    Math.max(0, 54 - s.testWeight) * sch.testWeight +
    Math.max(0, s.damaged - 5) * sch.damaged +
    Math.max(0, s.bcfm - 3) * sch.bcfm +
    (cornGrade(s).grade >= 6 ? sch.sample : 0);
  const drying = wet * sch.drying;
  return { paidBushels, quality, drying, netPerBushel: paidBushels * (basePrice - quality - drying) };
}

/** The factors of a blend of loads, weighted by bushels (test weight blends close to linearly). */
export function blend(loads: Array<{ bushels: number; sample: CornSample }>): CornSample {
  const total = loads.reduce((s, l) => s + l.bushels, 0) || 1;
  const avg = (k: keyof CornSample) => loads.reduce((s, l) => s + l.bushels * l.sample[k], 0) / total;
  return { testWeight: avg('testWeight'), damaged: avg('damaged'), bcfm: avg('bcfm'), moisture: avg('moisture') };
}

// ---------------------------------------------------------------------------
// Wheat: graded on test weight and damage here, and priced on protein and toxin as well.

export interface WheatSample {
  testWeight: number;
  damaged: number;
  /** Protein, percent at 12% moisture. */
  protein: number;
  /** Deoxynivalenol (vomitoxin) from head scab, parts per million. */
  don: number;
}

/** Simplified wheat grade limits: minimum test weight and maximum total damaged kernels. */
export const WHEAT_GRADES = [
  { grade: 1, testWeight: 60, damaged: 2 },
  { grade: 2, testWeight: 58, damaged: 4 },
  { grade: 3, testWeight: 56, damaged: 7 },
  { grade: 4, testWeight: 54, damaged: 10 },
  { grade: 5, testWeight: 51, damaged: 15 },
];

export function wheatGrade(s: WheatSample): number {
  return WHEAT_GRADES.find((r) => s.testWeight >= r.testWeight - 1e-9 && s.damaged <= r.damaged + 1e-9)?.grade ?? 6;
}

/** The mill's schedule, $ per bushel, against No. 2 wheat at 11% protein. */
export const WHEAT_SCHEDULE = {
  /** Premium per point of protein above 11%, and discount per point below. */
  proteinPremium: 0.2,
  proteinDiscount: 0.3,
  /** Per pound of test weight below 58. */
  testWeight: 0.05,
  /** Per ppm of toxin above 2 ppm. */
  don: 0.15,
  /** A load above this toxin level is rejected for milling and sold for feed at a deep discount. */
  donReject: 5,
  feedDiscount: 1.5,
};

export function wheatPrice(s: WheatSample, basePrice: number, sch = WHEAT_SCHEDULE): { protein: number; quality: number; net: number; rejected: boolean } {
  const protein = s.protein >= 11 ? (s.protein - 11) * sch.proteinPremium : -(11 - s.protein) * sch.proteinDiscount;
  const rejected = s.don > sch.donReject;
  const quality = Math.max(0, 58 - s.testWeight) * sch.testWeight + Math.max(0, Math.min(s.don, sch.donReject) - 2) * sch.don + (rejected ? sch.feedDiscount : 0) + (wheatGrade(s) >= 6 ? 0.3 : 0);
  return { protein, quality, net: basePrice + (rejected ? Math.min(0, protein) : protein) - quality, rejected };
}
