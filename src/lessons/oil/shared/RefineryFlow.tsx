// The Corran refinery's barrels as a Sankey diagram: crudes → crude-unit cuts → conversion and
// treating units → products, from a solved refinery plan (engines/oil/refinery).

import { fmt } from '../../../framework';
import { crude } from '../../../engines/oil/assay';
import { COKER, DEFAULT_CUTS, REFORMER, distill, fccYields, type CutPoints } from '../../../engines/oil/refining';
import type { RefineryPlan } from '../../../engines/oil/refinery';
import { CRUDE_COLOR, CRUDE_IDS, CRUDE_SHORT, CUTS } from '../../../model/oil/crudes';
import { PRODUCT_COLOR, PRODUCT_NAME, type ProductId } from '../../../model/oil/refinery';
import { Sankey, type SankeyLink, type SankeyNode } from './Sankey';

/** Coke drawn as a volume: about 0.31 barrel-equivalents per barrel of coker feed. */
const COKE_BBL_PER_TONNE = 0.31 / COKER.cokeTonnes;

const UNIT_COLOR = '#8a8a8a';

export function refineryFlowGraph(plan: RefineryPlan, fccConversion = 0.75, cuts: CutPoints = DEFAULT_CUTS): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const f = plan.flows;
  const sum = (prefix: string) => CRUDE_IDS.reduce((s, k) => s + (f[`${prefix}_${k}`] ?? 0), 0);
  const fy = fccYields(fccConversion);
  const F = plan.unitFeed.fcc;
  const K = plan.unitFeed.coker;
  const R = plan.unitFeed.reformer;
  const cutIds = ['lpg', 'lightNaphtha', 'heavyNaphtha', 'kerosene', 'diesel', 'vgo', 'residue'] as const;
  const cutColor = Object.fromEntries(CUTS.map((c) => [c.id, c.color]));
  const nodes: SankeyNode[] = [
    ...CRUDE_IDS.map((k) => ({ id: k, label: CRUDE_SHORT[k], layer: 0, color: CRUDE_COLOR[k], labelLeft: true })),
    ...cutIds.map((c) => ({ id: `cut_${c}`, label: CUTS.find((x) => x.id === c)!.name.replace('Vacuum ', 'Vac. '), layer: 1, color: cutColor[c], value: '' })),
    { id: 'reformer', label: 'Reformer', layer: 2, color: UNIT_COLOR, labelAbove: true },
    { id: 'coker', label: 'Coker', layer: 2, color: UNIT_COLOR, labelAbove: true },
    { id: 'fcc', label: 'Cracker', layer: 3, color: UNIT_COLOR, labelAbove: true },
    { id: 'dht', label: 'Hydrotreater', layer: 4, color: UNIT_COLOR, labelAbove: true },
    ...(['lpg', 'naphtha', 'gasoline', 'jet', 'diesel', 'hsfo', 'coke'] as ProductId[]).map((p) => ({
      id: `p_${p}`,
      label: PRODUCT_NAME[p].replace(' (ULSD)', ''),
      layer: 5,
      color: PRODUCT_COLOR[p],
      labelLeft: false,
      value: p === 'coke' ? `${fmt(plan.products.coke)} t/d` : `${fmt(plan.products[p], plan.products[p] < 10 ? 1 : 0)} kb/d`,
    })),
  ];
  const links: SankeyLink[] = [];
  const L = (from: string, to: string, value: number, color?: string) => {
    if (value > 0) links.push({ from, to, value, color });
  };
  for (const k of CRUDE_IDS) {
    const runs = plan.crude[k];
    if (runs <= 0) continue;
    const d = distill(crude(k), cuts);
    for (const c of cutIds) L(k, `cut_${c}`, runs * d[c].volume, CRUDE_COLOR[k]);
  }
  const srLpg = CRUDE_IDS.reduce((s, k) => s + plan.crude[k] * distill(crude(k), cuts).lpg.volume, 0);
  const bG = f.bG ?? 0;
  L('cut_lpg', 'p_gasoline', Math.min(bG, srLpg));
  L('cut_lpg', 'p_lpg', srLpg - Math.min(bG, srLpg));
  L('cut_lightNaphtha', 'p_gasoline', f.lnG);
  L('cut_lightNaphtha', 'p_naphtha', f.lnN);
  L('cut_heavyNaphtha', 'reformer', f.hnR);
  L('cut_heavyNaphtha', 'p_naphtha', f.hnN);
  L('cut_kerosene', 'p_jet', sum('kj'));
  L('cut_kerosene', 'dht', sum('kd'));
  L('cut_kerosene', 'p_hsfo', sum('kf'));
  L('cut_diesel', 'dht', sum('dd'));
  L('cut_diesel', 'p_hsfo', sum('df'));
  L('cut_vgo', 'fcc', sum('vf'));
  L('cut_vgo', 'p_hsfo', sum('vo'));
  L('cut_residue', 'coker', sum('rc'));
  L('cut_residue', 'p_hsfo', sum('ro'));
  L('reformer', 'p_gasoline', R * REFORMER.reformate);
  L('reformer', 'p_lpg', R * REFORMER.lpg);
  L('coker', 'p_lpg', K * COKER.lpg);
  L('coker', 'p_gasoline', f.cnG);
  L('coker', 'p_naphtha', f.cnN);
  L('coker', 'fcc', f.cgoF);
  L('coker', 'dht', f.cgoD);
  L('coker', 'p_coke', K * COKER.cokeTonnes * COKE_BBL_PER_TONNE);
  L('fcc', 'p_gasoline', F * fy.gasoline);
  L('fcc', 'p_lpg', F * fy.lpg);
  L('fcc', 'dht', f.lcoD);
  L('fcc', 'p_hsfo', f.lcoF + F * fy.slurry);
  L('dht', 'p_jet', sum('kd'));
  L('dht', 'p_diesel', sum('dd') + f.lcoD + f.cgoD);
  return { nodes, links };
}

/** The refinery plan as a Sankey diagram. */
export function RefineryFlow({ plan, ariaLabel, fccConversion = 0.75, height = 400 }: { plan: RefineryPlan; ariaLabel: string; fccConversion?: number; height?: number }) {
  const { nodes, links } = refineryFlowGraph(plan, fccConversion);
  return <Sankey nodes={nodes} links={links} width={712} height={height} columns={[96, 196, 318, 398, 474, 552]} ariaLabel={ariaLabel} gap={16} />;
}
