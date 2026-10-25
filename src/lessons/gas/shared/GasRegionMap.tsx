// The gas region at a glance, for the lesson that first introduces it: the course's map (GasMap)
// with every place, pipeline and storage field named and given one fact from the world model.
// Static: no flows, no controls. Pipeline labels run along their lines, the name on one side and
// the capacity on the other, so the six lines can be named without crowding the hub.

import { fmt } from '../../../framework';
import { BASINS, GAS_NODE, GAS_NODES, PIPELINES, STORAGE_FIELDS, type GasNodeId, type Pipeline } from '../../../model/gas/world';
import { GasMap, LAND } from './GasMap';

const NAME = '#111';
const NOTE = '#5f5f5f';
const STORE = '#7a6420';

const halo = { paintOrder: 'stroke', stroke: LAND, strokeWidth: 4, strokeLinejoin: 'round' } as const;

/** A rate in Bcf/d with as many decimals as it needs, one or two. */
const bcfd = (x: number) => fmt(x, Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? 1 : 2);

const output = (id: GasNodeId) => bcfd(BASINS.find((b) => b.id === id)!.productionBcfd);

/** What each place is, and for the two fields what they produce. */
const PLACE_NOTE: Record<GasNodeId, string> = {
  sandhill: `gas field · ${output('sandhill')} Bcf/d`,
  ridgeback: `${GAS_NODE.ridgeback.kind} · ${output('ridgeback')} Bcf/d`,
  calder: GAS_NODE.calder.kind,
  metro: GAS_NODE.metro.kind,
  bayport: GAS_NODE.bayport.kind,
};

/** Where each place's name and note sit, relative to the place, and whether the note is drawn. Calder Hub's name goes above it, clear of the lines that leave it southward. */
const PLACE_LABEL: Record<GasNodeId, { dy: number; note: boolean }> = {
  sandhill: { dy: -38, note: true },
  ridgeback: { dy: 32, note: true },
  calder: { dy: -32, note: false },
  metro: { dy: -38, note: true },
  bayport: { dy: 32, note: true },
};

/**
 * Each pipeline's label: where along the line its name sits (0 at the `from` end), which side it
 * takes, and where the capacity sits on the other side (`tc`, default `t`).
 */
const PIPE_LABEL: Record<string, { t: number; tc?: number; name: 'above' | 'below' }> = {
  'ridgeback-calder': { t: 0.5, tc: 0.72, name: 'above' },
  'ridgeback-bayport': { t: 0.5, name: 'above' },
  'sandhill-calder': { t: 0.55, name: 'below' },
  'sandhill-metro': { t: 0.5, name: 'above' },
  'calder-metro': { t: 0.5, name: 'above' },
  'calder-bayport': { t: 0.5, name: 'above' },
};

const storageNote = (s: (typeof STORAGE_FIELDS)[number]) => `${s.kind === 'salt' ? 'salt caverns' : 'old gas reservoir'} · ${fmt(s.workingBcf)} Bcf`;

function PipeLabel({ p }: { p: Pipeline }) {
  const a = GAS_NODE[p.from];
  const b = GAS_NODE[p.to];
  const { t, tc = t, name } = PIPE_LABEL[p.id] ?? { t: 0.5, name: 'above' };
  let ux = b.x - a.x;
  let uy = b.y - a.y;
  const len = Math.hypot(ux, uy);
  ux /= len;
  uy /= len;
  // Keep the text upright: read left to right whichever way the line was drawn.
  if (ux < 0) {
    ux = -ux;
    uy = -uy;
  }
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  const at = (k: number) => `translate(${(a.x + (b.x - a.x) * k).toFixed(1)} ${(a.y + (b.y - a.y) * k).toFixed(1)}) rotate(${angle.toFixed(2)})`;
  // Baselines just clear of the drawn line, which is 2 + size/6 wide.
  const half = (2 + p.sizeIn / 6) / 2;
  const above = -(half + 5);
  const below = half + 13;
  return (
    <g>
      <text transform={at(t)} y={name === 'above' ? above : below} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: NAME, ...halo }}>
        {p.name}
      </text>
      <text transform={at(tc)} y={name === 'above' ? below : above} textAnchor="middle" style={{ fontSize: 12, fill: NOTE, ...halo }}>
        {bcfd(p.capacityBcfd)} Bcf/d
      </text>
    </g>
  );
}

export function GasRegionMap({ ariaLabel }: { ariaLabel?: string }) {
  const label =
    ariaLabel ??
    `Map of the gas region. ${GAS_NODES.map((n) => `${n.name}: ${PLACE_NOTE[n.id]}`).join('. ')}. Pipelines: ${PIPELINES.map(
      (p) => `${p.name}, ${GAS_NODE[p.from].name} to ${GAS_NODE[p.to].name}, ${bcfd(p.capacityBcfd)} Bcf/d`,
    ).join('; ')}. Storage: ${STORAGE_FIELDS.map((s) => `${s.name} at ${GAS_NODE[s.node].name}, ${storageNote(s)}`).join('; ')}.`;
  return (
    <GasMap ariaLabel={label} labels={false}>
      {PIPELINES.map((p) => (
        <PipeLabel key={p.id} p={p} />
      ))}
      {/* Storage labels sit west of each field: Gulfward runs just east of Salt Flat. */}
      {STORAGE_FIELDS.map((s) => (
        <g key={s.id}>
          <text x={s.x - 18} y={s.y + 2} textAnchor="end" style={{ fontSize: 12.5, fontWeight: 500, fill: STORE, ...halo }}>
            {s.name}
          </text>
          <text x={s.x - 18} y={s.y + 16} textAnchor="end" style={{ fontSize: 12, fill: NOTE, ...halo }}>
            {storageNote(s)}
          </text>
        </g>
      ))}
      {GAS_NODES.map((n) => {
        const { dy, note } = PLACE_LABEL[n.id];
        return (
          <g key={n.id}>
            <text x={n.x} y={n.y + dy} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: NAME, ...halo }}>
              {n.name}
            </text>
            {note && (
              <text x={n.x} y={n.y + dy + 14} textAnchor="middle" style={{ fontSize: 12, fill: NOTE, ...halo }}>
                {PLACE_NOTE[n.id]}
              </text>
            )}
          </g>
        );
      })}
    </GasMap>
  );
}
