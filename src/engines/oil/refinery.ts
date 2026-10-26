// The Corran refinery as a linear program (Lesson 3.5, and the capstone's refinery).
//
// Refiners plan with linear programs: choose crude runs and the routing of every intermediate
// stream through the units to maximize the day's margin — product revenue minus crude and
// operating costs — subject to unit capacities, a hydrogen balance, a sulfur plant, and product
// specifications. This one tracks each crude's kerosene, diesel, gas oil and residue separately
// (so their sulfur can be held to specs) and pools the lighter streams.
//
// Units: flows in thousand barrels a day (kb/d), money in thousand dollars a day (k$/d) inside the
// program; results are reported in $/day and $/bbl.

import { solveLP, type Sense } from '../market/lp';
import { crude as crudeOf, type Crude } from './assay';
import { COKER, DEFAULT_CUTS, REFORMER, distill, fccYields, hdsHydrogen, type CutPoints } from './refining';
import { CRUDE_IDS, type CrudeId } from '../../model/oil/crudes';
import { CORRAN, CRUDE_PRICE, HYDROGEN_COST, PRODUCT_PRICE, UNIT_OPEX, type ProductId, type RefineryConfig, type UnitId } from '../../model/oil/refinery';

/** Anti-knock index of each gasoline component, (R+M)/2. */
export const COMPONENT_AKI = { lightNaphtha: 68.5, reformate: 93, fccGasoline: 86, cokerNaphtha: 65, butane: 92 };
/** Regular gasoline's minimum anti-knock index. */
export const GASOLINE_AKI = 87;
/** Most butane the summer pool can take (its vapor pressure limit), share of the pool. */
export const BUTANE_SHARE = 0.05;
/** Share of the LPG pool that is butane. */
export const BUTANE_IN_LPG = 0.6;
/** Kerosene this sweet can be sold as jet fuel after mild treating; sourer kerosene must be hydrotreated. */
export const JET_SULFUR = 0.3;
/** High-sulfur fuel oil's sulfur limit, %. */
export const FUEL_OIL_SULFUR = 3.5;
/** Hydrogen for cracked stocks in the diesel hydrotreater, scf/bbl (aromatic and olefinic). */
export const H2_LCO = 800;
export const H2_CGO = 500;
/** Base hydrogen for straight-run kerosene and diesel, scf/bbl. */
export const H2_BASE = 150;
/** Sulfur in cracked streams, % (assumed). */
export const S_LCO = 1.2;
export const S_CGO = 2.0;
export const S_SLURRY = 2.5;
/** Share of FCC and coker feed sulfur released as hydrogen sulfide to the sulfur plant. */
export const FCC_H2S = 0.4;
export const COKER_H2S = 0.3;
/** Most tonnes of sulfur per kb/d of a stream at SG and S%. */
const TONNES_PER_KB = (sg: number, s: number) => 1000 * 0.158987 * sg * (s / 100);

export interface RefineryInputs {
  config?: RefineryConfig;
  /** $/bbl delivered for each crude. */
  crudePrice?: Partial<Record<CrudeId, number>>;
  /** kb/d available of each crude (default: unlimited). */
  crudeAvailable?: Partial<Record<CrudeId, number>>;
  productPrice?: Partial<Record<ProductId, number>>;
  /** FCC conversion, 0.5–0.9. */
  fccConversion?: number;
  cuts?: CutPoints;
  /** Crudes with modified assays (default: the course's four). */
  assays?: Partial<Record<CrudeId, Crude>>;
}

export interface RefineryPlan {
  status: 'optimal' | 'infeasible' | 'unbounded';
  /** Crude runs, kb/d. */
  crude: Record<CrudeId, number>;
  /** Products, kb/d (coke in tonnes/day). */
  products: Record<ProductId, number>;
  /** Feed to each unit, kb/d. */
  unitFeed: Record<UnitId, number>;
  /** Margin: product revenue − crude − operating costs − hydrogen, $/day. */
  margin: number;
  revenue: number;
  crudeCost: number;
  opex: number;
  /** Hydrogen: made by the reformer and the plant, used by the hydrotreater, MMscf/d. */
  hydrogen: { reformer: number; plant: number; used: number };
  /** Sulfur sent to the sulfur plant, t/d, and sulfur in the fuel oil, %. */
  sulfurPlant: number;
  fuelOilSulfur: number;
  /** Gasoline pool by component, kb/d. */
  gasolinePool: { lightNaphtha: number; reformate: number; fccGasoline: number; cokerNaphtha: number; butane: number };
  /** Detailed routing of every variable (kb/d), for flow diagrams. */
  flows: Record<string, number>;
}

const PER_CRUDE = ['kj', 'kd', 'kf', 'dd', 'df', 'vf', 'vo', 'rc', 'ro'] as const;
const POOLED = ['lnG', 'lnN', 'hnR', 'hnN', 'lcoD', 'lcoF', 'cgoF', 'cgoD', 'cnG', 'cnN', 'bG', 'h2'] as const;

/** Solves the day's plan. */
export function planRefinery(inp: RefineryInputs = {}): RefineryPlan {
  const cfg = inp.config ?? CORRAN;
  const cp = { ...CRUDE_PRICE, ...inp.crudePrice };
  const pp = { ...PRODUCT_PRICE, ...inp.productPrice };
  const cuts = inp.cuts ?? DEFAULT_CUTS;
  const X = inp.fccConversion ?? 0.75;
  const fy = fccYields(X);
  const crudes = CRUDE_IDS;
  const assays = crudes.map((id) => inp.assays?.[id] ?? crudeOf(id));
  const st = assays.map((a) => distill(a, cuts));

  // Variable indexing.
  const names: string[] = [];
  const idx: Record<string, number> = {};
  const add = (n: string) => {
    idx[n] = names.length;
    names.push(n);
  };
  crudes.forEach((k) => add(`c_${k}`));
  crudes.forEach((k) => PER_CRUDE.forEach((v) => add(`${v}_${k}`)));
  POOLED.forEach((v) => add(v));
  const n = names.length;
  const row = () => Array<number>(n).fill(0);
  const A: number[][] = [];
  const b: number[] = [];
  const sense: Sense[] = [];
  const push = (r: number[], s: Sense, rhs: number) => {
    A.push(r);
    sense.push(s);
    b.push(rhs);
  };

  // Linear expressions as coefficient maps.
  type Expr = Record<string, number>;
  const plus = (...es: Expr[]): Expr => {
    const out: Expr = {};
    for (const e of es) for (const [k, v] of Object.entries(e)) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const times = (e: Expr, f: number): Expr => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v * f]));
  const toRow = (e: Expr) => {
    const r = row();
    for (const [k, v] of Object.entries(e)) r[idx[k]] += v;
    return r;
  };
  const sumCrude = (f: (i: number, k: CrudeId) => number, prefix: string): Expr => Object.fromEntries(crudes.map((k, i) => [`${prefix}_${k}`, f(i, k)]));

  const fccFeed: Expr = plus(sumCrude(() => 1, 'vf'), { cgoF: 1 });
  const cokerFeed: Expr = sumCrude(() => 1, 'rc');
  const reformerFeed: Expr = { hnR: 1 };
  const dhtFeed: Expr = plus(sumCrude(() => 1, 'kd'), sumCrude(() => 1, 'dd'), { lcoD: 1, cgoD: 1 });
  const cduFeed: Expr = sumCrude(() => 1, 'c');
  const lpgPool: Expr = plus(
    sumCrude((i) => st[i].lpg.volume, 'c'),
    times(fccFeed, fy.lpg),
    times(cokerFeed, COKER.lpg),
    times(reformerFeed, REFORMER.lpg),
  );
  const gasoline: Expr = plus({ lnG: 1, cnG: 1, bG: 1 }, times(reformerFeed, REFORMER.reformate), times(fccFeed, fy.gasoline));
  const naphtha: Expr = { lnN: 1, hnN: 1, cnN: 1 };
  const jet: Expr = plus(sumCrude(() => 1, 'kj'), sumCrude(() => 1, 'kd'));
  const diesel: Expr = plus(sumCrude(() => 1, 'dd'), { lcoD: 1, cgoD: 1 });
  const fuelOil: Expr = plus(sumCrude(() => 1, 'kf'), sumCrude(() => 1, 'df'), sumCrude(() => 1, 'vo'), sumCrude(() => 1, 'ro'), { lcoF: 1 }, times(fccFeed, fy.slurry));
  const cokeT: Expr = times(cokerFeed, COKER.cokeTonnes * 1000);

  // Per-crude stream balances.
  crudes.forEach((k, i) => {
    push(toRow({ [`kj_${k}`]: 1, [`kd_${k}`]: 1, [`kf_${k}`]: 1, [`c_${k}`]: -st[i].kerosene.volume }), '=', 0);
    push(toRow({ [`dd_${k}`]: 1, [`df_${k}`]: 1, [`c_${k}`]: -st[i].diesel.volume }), '=', 0);
    push(toRow({ [`vf_${k}`]: 1, [`vo_${k}`]: 1, [`c_${k}`]: -st[i].vgo.volume }), '=', 0);
    push(toRow({ [`rc_${k}`]: 1, [`ro_${k}`]: 1, [`c_${k}`]: -st[i].residue.volume }), '=', 0);
  });
  // Pooled balances.
  push(toRow(plus({ lnG: 1, lnN: 1 }, sumCrude((i) => -st[i].lightNaphtha.volume, 'c'))), '=', 0);
  push(toRow(plus({ hnR: 1, hnN: 1 }, sumCrude((i) => -st[i].heavyNaphtha.volume, 'c'))), '=', 0);
  push(toRow(plus({ lcoD: 1, lcoF: 1 }, times(fccFeed, -fy.lco))), '=', 0);
  push(toRow(plus({ cgoF: 1, cgoD: 1 }, times(cokerFeed, -COKER.gasOil))), '=', 0);
  push(toRow(plus({ cnG: 1, cnN: 1 }, times(cokerFeed, -COKER.naphtha))), '=', 0);
  // Butane: only the butane in the LPG pool, and no more than the summer vapor-pressure limit allows.
  push(toRow(plus({ bG: 1 }, times(lpgPool, -BUTANE_IN_LPG))), '<=', 0);
  push(toRow(plus({ bG: 1 }, times(gasoline, -BUTANE_SHARE))), '<=', 0);
  // Capacities.
  push(toRow(cduFeed), '<=', cfg.capacity.cdu);
  push(toRow(reformerFeed), '<=', cfg.capacity.reformer);
  push(toRow(fccFeed), '<=', cfg.capacity.fcc);
  push(toRow(cokerFeed), '<=', cfg.capacity.coker);
  push(toRow(dhtFeed), '<=', cfg.capacity.dht);
  // Gasoline octane.
  const aki = COMPONENT_AKI;
  push(
    toRow(
      plus(
        { lnG: aki.lightNaphtha - GASOLINE_AKI, cnG: aki.cokerNaphtha - GASOLINE_AKI, bG: aki.butane - GASOLINE_AKI },
        times(reformerFeed, REFORMER.reformate * (aki.reformate - GASOLINE_AKI)),
        times(fccFeed, fy.gasoline * (aki.fccGasoline - GASOLINE_AKI)),
      ),
    ),
    '>=',
    0,
  );
  // Hydrogen: hydrotreater use (MMscf/d) ≤ reformer + plant.
  const h2Use: Expr = plus(
    sumCrude((i) => hdsHydrogen({ sulfur: st[i].kerosene.sulfur, hardShare: 0.1, baseHydrogen: H2_BASE }, 0.0015, st[i].kerosene.sg) / 1000, 'kd'),
    sumCrude((i) => hdsHydrogen({ sulfur: st[i].diesel.sulfur, hardShare: 0.15, baseHydrogen: H2_BASE }, 0.0015, st[i].diesel.sg) / 1000, 'dd'),
    { lcoD: H2_LCO / 1000, cgoD: H2_CGO / 1000 },
  );
  push(toRow(plus(h2Use, times(reformerFeed, -REFORMER.hydrogen), { h2: -1 })), '<=', 0);
  // Sulfur plant.
  const sulfur: Expr = plus(
    sumCrude((i) => TONNES_PER_KB(st[i].kerosene.sg, st[i].kerosene.sulfur), 'kd'),
    sumCrude((i) => TONNES_PER_KB(st[i].diesel.sg, st[i].diesel.sulfur), 'dd'),
    sumCrude((i) => FCC_H2S * TONNES_PER_KB(st[i].vgo.sg, st[i].vgo.sulfur), 'vf'),
    sumCrude((i) => COKER_H2S * TONNES_PER_KB(st[i].residue.sg, st[i].residue.sulfur), 'rc'),
    { lcoD: TONNES_PER_KB(0.93, S_LCO), cgoD: TONNES_PER_KB(0.9, S_CGO), cgoF: FCC_H2S * TONNES_PER_KB(0.9, S_CGO) },
  );
  push(toRow(sulfur), '<=', cfg.sulfurPlant);
  // Fuel oil sulfur: Σ mass × (S − limit) ≤ 0.
  const foS = (sg: number, s: number) => sg * (s - FUEL_OIL_SULFUR);
  push(
    toRow(
      plus(
        sumCrude((i) => foS(st[i].kerosene.sg, st[i].kerosene.sulfur), 'kf'),
        sumCrude((i) => foS(st[i].diesel.sg, st[i].diesel.sulfur), 'df'),
        sumCrude((i) => foS(st[i].vgo.sg, st[i].vgo.sulfur), 'vo'),
        sumCrude((i) => foS(st[i].residue.sg, st[i].residue.sulfur), 'ro'),
        { lcoF: foS(0.93, S_LCO) },
        times(fccFeed, fy.slurry * foS(1.05, S_SLURRY)),
      ),
    ),
    '<=',
    0,
  );

  // Bounds: crude availability, sweet-kerosene-only jet, hydrogen plant.
  const ub = Array<number>(n).fill(Infinity);
  crudes.forEach((k, i) => {
    ub[idx[`c_${k}`]] = inp.crudeAvailable?.[k] ?? Infinity;
    if (st[i].kerosene.sulfur > JET_SULFUR) ub[idx[`kj_${k}`]] = 0;
  });
  ub[idx.h2] = cfg.hydrogenPlant;

  // Objective: maximize margin → minimize its negative (k$/d).
  const opex: Expr = plus(
    times(cduFeed, UNIT_OPEX.cdu),
    times(reformerFeed, UNIT_OPEX.reformer),
    times(fccFeed, UNIT_OPEX.fcc),
    times(cokerFeed, UNIT_OPEX.coker),
    times(dhtFeed, UNIT_OPEX.dht),
    { h2: HYDROGEN_COST },
  );
  const revenue: Expr = plus(
    times(lpgPool, pp.lpg),
    { bG: -pp.lpg },
    times(naphtha, pp.naphtha),
    times(gasoline, pp.gasoline),
    times(jet, pp.jet),
    times(diesel, pp.diesel),
    times(fuelOil, pp.hsfo),
    times(cokeT, pp.coke / 1000),
  );
  const crudeCost: Expr = sumCrude((_, k) => cp[k], 'c');
  const objective = plus(times(revenue, -1), crudeCost, opex);
  const c = toRow(objective);
  const sol = solveLP({ c, A, b, sense, ub });

  const x = sol.x;
  const val = (e: Expr) => Object.entries(e).reduce((s, [k, v]) => s + v * (x[idx[k]] ?? 0), 0);
  const flows: Record<string, number> = Object.fromEntries(names.map((nm, i) => [nm, x[i]]));
  const products: Record<ProductId, number> = {
    lpg: val(lpgPool) - x[idx.bG],
    naphtha: val(naphtha),
    gasoline: val(gasoline),
    jet: val(jet),
    diesel: val(diesel),
    hsfo: val(fuelOil),
    coke: val(cokeT),
  };
  const foMass =
    crudes.reduce(
      (s, k, i) =>
        s +
        x[idx[`kf_${k}`]] * st[i].kerosene.sg +
        x[idx[`df_${k}`]] * st[i].diesel.sg +
        x[idx[`vo_${k}`]] * st[i].vgo.sg +
        x[idx[`ro_${k}`]] * st[i].residue.sg,
      0,
    ) +
    x[idx.lcoF] * 0.93 +
    val(fccFeed) * fy.slurry * 1.05;
  const foSulfurMass =
    crudes.reduce(
      (s, k, i) =>
        s +
        x[idx[`kf_${k}`]] * st[i].kerosene.sg * st[i].kerosene.sulfur +
        x[idx[`df_${k}`]] * st[i].diesel.sg * st[i].diesel.sulfur +
        x[idx[`vo_${k}`]] * st[i].vgo.sg * st[i].vgo.sulfur +
        x[idx[`ro_${k}`]] * st[i].residue.sg * st[i].residue.sulfur,
      0,
    ) +
    x[idx.lcoF] * 0.93 * S_LCO +
    val(fccFeed) * fy.slurry * 1.05 * S_SLURRY;
  const rev = val(revenue) * 1000;
  const cc = val(crudeCost) * 1000;
  const ox = val(opex) * 1000;
  return {
    status: sol.status,
    crude: Object.fromEntries(crudes.map((k) => [k, x[idx[`c_${k}`]]])) as Record<CrudeId, number>,
    products,
    unitFeed: { cdu: val(cduFeed), reformer: val(reformerFeed), fcc: val(fccFeed), coker: val(cokerFeed), dht: val(dhtFeed) },
    margin: rev - cc - ox,
    revenue: rev,
    crudeCost: cc,
    opex: ox,
    hydrogen: { reformer: val(reformerFeed) * REFORMER.hydrogen, plant: x[idx.h2], used: val(h2Use) },
    sulfurPlant: val(sulfur),
    fuelOilSulfur: foMass > 1e-9 ? foSulfurMass / foMass : 0,
    gasolinePool: {
      lightNaphtha: x[idx.lnG],
      reformate: val(reformerFeed) * REFORMER.reformate,
      fccGasoline: val(fccFeed) * fy.gasoline,
      cokerNaphtha: x[idx.cnG],
      butane: x[idx.bG],
    },
    flows,
  };
}

/** Margin per barrel of crude run, $/bbl. */
export function marginPerBarrel(p: RefineryPlan): number {
  const runs = Object.values(p.crude).reduce((a, b) => a + b, 0);
  return runs > 0 ? p.margin / (runs * 1000) : 0;
}

/**
 * The value of one more kb/d of each unit's capacity, $ per day — the "shadow price" — found by
 * solving again with that capacity raised.
 */
export function shadowPrices(inp: RefineryInputs = {}, step = 1): Record<UnitId, number> {
  const cfg = inp.config ?? CORRAN;
  const base = planRefinery(inp).margin;
  const units: UnitId[] = ['cdu', 'reformer', 'fcc', 'coker', 'dht'];
  return Object.fromEntries(
    units.map((u) => {
      const more = planRefinery({ ...inp, config: { ...cfg, capacity: { ...cfg.capacity, [u]: cfg.capacity[u] + step } } }).margin;
      return [u, (more - base) / step];
    }),
  ) as Record<UnitId, number>;
}

/**
 * A crude's breakeven value at the refinery: the delivered price at which the plan would run
 * exactly `threshold` kb/d of it (by bisection on its price). Above that price the refinery buys
 * less; below it, more.
 */
export function crudeBreakeven(k: CrudeId, inp: RefineryInputs = {}, threshold = 0.5, lo = 20, hi = 140): number {
  const runs = (p: number) => planRefinery({ ...inp, crudePrice: { ...inp.crudePrice, [k]: p } }).crude[k];
  if (runs(hi) > threshold) return hi;
  if (runs(lo) < threshold) return lo;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (runs(mid) > threshold) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
