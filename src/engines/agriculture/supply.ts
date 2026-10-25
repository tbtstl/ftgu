// The Crane Valley's corn supply (Lesson 2.1): every part of the valley plants the crop mix that
// earns it the most over variable costs at the prices it expects, and the corn acres are added up.
//
// On each side of a 50–50 rotation a farm's average return is a straight line in its corn share
// (see `cropMix`), so the best mix is always all wheat, half and half, or all corn. Each mix's
// average return is also a straight line in the two prices, so one `cropMix` run per mix at the
// plan prices gives the return at any prices.

import { cropMix } from './farm';
import { PLAN_PRICE, perBushelCost } from '../../model/agriculture/economics';
import { DISTRICT, type Crop, type DistrictId } from '../../model/agriculture/region';

export interface SupplyArea {
  id: string;
  label: string;
  district: DistrictId;
  /** Corn on this land is irrigated. */
  irrigated: boolean;
  /** Cropland, thousands of acres. */
  kAcres: number;
}

const total = (d: DistrictId) => DISTRICT[d].cornKAc + DISTRICT[d].wheatKAc;
/** The High Plains land under wells: enough for today's irrigated corn in a 50–50 rotation with wheat. */
const WELL_KAC = 2 * DISTRICT.plains.irrigatedKAc;

/** The valley's cropland in six parts, the High Plains split into its land under wells and its dryland. */
export const SUPPLY_AREAS: SupplyArea[] = [
  { id: 'prairie', label: 'Black Prairie', district: 'prairie', irrigated: false, kAcres: total('prairie') },
  { id: 'bottoms', label: 'River Bottoms', district: 'bottoms', irrigated: false, kAcres: total('bottoms') },
  { id: 'plainsIrrigated', label: 'High Plains, under wells', district: 'plains', irrigated: true, kAcres: WELL_KAC },
  { id: 'ridge', label: 'Upland Ridge', district: 'ridge', irrigated: false, kAcres: total('ridge') },
  { id: 'north', label: 'North Tier', district: 'north', irrigated: false, kAcres: total('north') },
  { id: 'plains', label: 'High Plains, dryland', district: 'plains', irrigated: false, kAcres: total('plains') - WELL_KAC },
];

/** The mixes a farm chooses between: the share of its land in corn. */
export const SUPPLY_SHARES = [0, 0.5, 1] as const;

interface MixLine {
  share: number;
  /** Average bushels per acre of land (not per acre of the crop). */
  cornBu: number;
  wheatBu: number;
  /** Price-independent costs per acre of land, $. */
  costs: number;
}

const lineCache = new Map<string, MixLine[]>();

function lines(area: SupplyArea): MixLine[] {
  let ls = lineCache.get(area.id);
  if (!ls) {
    ls = SUPPLY_SHARES.map((share) => {
      const r = cropMix(area.district, 1000, share, PLAN_PRICE, area.irrigated);
      const cornBu = (r.cornYield * r.cornAcres) / 1000;
      const wheatBu = (r.wheatYield * r.wheatAcres) / 1000;
      const revenue = cornBu * (PLAN_PRICE.corn - perBushelCost('corn')) + wheatBu * (PLAN_PRICE.wheat - perBushelCost('wheat'));
      return { share, cornBu, wheatBu, costs: revenue - r.mean / 1000 };
    });
    lineCache.set(area.id, ls);
  }
  return ls;
}

/** An area's average return over variable costs, $ per acre of land, with `share` of it in corn (0, 0.5 or 1). */
export function areaMargin(area: SupplyArea, share: number, prices: Record<Crop, number>): number {
  const l = lines(area).find((x) => x.share === share);
  if (!l) throw new Error(`share ${share} is not one of ${SUPPLY_SHARES.join(', ')}`);
  return l.cornBu * (prices.corn - perBushelCost('corn')) + l.wheatBu * (prices.wheat - perBushelCost('wheat')) - l.costs;
}

export interface AreaPlan {
  area: SupplyArea;
  /** The best share of the land in corn. */
  share: number;
  cornKAcres: number;
  /** Expected corn harvest, millions of bushels. */
  cornMBu: number;
}

/** The mix that earns an area the most at these prices (the smaller corn share on a tie). */
export function areaPlan(area: SupplyArea, prices: Record<Crop, number>): AreaPlan {
  const ls = lines(area);
  let best = ls[0];
  for (const l of ls) if (areaMargin(area, l.share, prices) > areaMargin(area, best.share, prices) + 1e-9) best = l;
  return { area, share: best.share, cornKAcres: area.kAcres * best.share, cornMBu: (area.kAcres * best.cornBu) / 1000 };
}

export interface ValleySupply {
  areas: AreaPlan[];
  /** Corn planted in the valley, thousands of acres. */
  cornKAcres: number;
  /** Expected corn harvest, millions of bushels. */
  cornMBu: number;
}

/** Every area's best plan at these prices, and the valley's corn acres and expected harvest. */
export function valleyCornSupply(prices: Record<Crop, number>): ValleySupply {
  const areas = SUPPLY_AREAS.map((a) => areaPlan(a, prices));
  return { areas, cornKAcres: areas.reduce((s, a) => s + a.cornKAcres, 0), cornMBu: areas.reduce((s, a) => s + a.cornMBu, 0) };
}

/** The corn price at which an area's return is the same with corn shares `from` and `to`, wheat at `wheat`. */
export function switchPrice(area: SupplyArea, from: number, to: number, wheat: number): number {
  const ls = lines(area);
  const a = ls.find((x) => x.share === from)!;
  const b = ls.find((x) => x.share === to)!;
  // a.cornBu (p − c) + a.wheatBu (w − c') − a.costs = b.cornBu (p − c) + b.wheatBu (w − c') − b.costs
  const wheatMargin = wheat - perBushelCost('wheat');
  return perBushelCost('corn') + (a.costs - b.costs - (a.wheatBu - b.wheatBu) * wheatMargin) / (a.cornBu - b.cornBu);
}

export interface SupplyStep {
  /** The corn price at which the area changes its plan. */
  price: number;
  area: SupplyArea;
  /** Corn share below and above that price. */
  from: number;
  to: number;
}

/** Every change of plan as the corn price rises from `lo` to `hi`, wheat at `wheat`, in order of price. */
export function supplySteps(wheat: number, lo: number, hi: number): SupplyStep[] {
  const steps: SupplyStep[] = [];
  const n = Math.ceil((hi - lo) / 0.005);
  for (const area of SUPPLY_AREAS) {
    let prev = areaPlan(area, { corn: lo, wheat }).share;
    for (let i = 1; i <= n; i++) {
      const s = areaPlan(area, { corn: Math.min(hi, lo + i * 0.005), wheat }).share;
      if (s !== prev) {
        steps.push({ price: switchPrice(area, prev, s, wheat), area, from: prev, to: s });
        prev = s;
      }
    }
  }
  return steps.sort((a, b) => a.price - b.price);
}

export function supplyArea(id: string): SupplyArea {
  return SUPPLY_AREAS.find((a) => a.id === id)!;
}
