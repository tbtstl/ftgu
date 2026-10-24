// Midship cross-section of a bulk carrier, seen from astern looking forward (port on the left):
// hull, double bottom, hopper and topside tanks, the cargo hold filled to a height, ballast,
// the sea at a draft, an optional heel and the stability points K, B, G and M.
//
// Drawn true to scale (no exaggeration) inside a parent SVG. The ship rotates about the point
// where her centerline meets the waterline, so the sea surface stays put as she heels.

import type { ReactNode } from 'react';
import { GRAPHIC, TEXT } from '../../../framework';
import type { VesselClass } from '../../../model/shipping/vessels';
import { DOUBLE_BOTTOM } from '../../../engines/shipping/stability';
import { HULL_FILL, HULL_STROKE, SEA_FILL, SEA_LINE } from './ShipSide';

export const BALLAST_FILL = '#8fb9dc';

/** The section's outline, tanks and hold, in ship meters (y to starboard, z up from the keel). */
export function sectionGeometry(v: VesselClass) {
  const hb = v.beam / 2;
  const D = v.depth;
  const bilge = 2;
  const hopperToe = hb - 6;
  const hopperTop = DOUBLE_BOTTOM + 6;
  const hatch = Math.min(8, hb * 0.5);
  const topsideLow = D - 6.5;
  const coaming = D + 1.5;
  return { hb, D, bilge, hopperToe, hopperTop, hatch, topsideLow, coaming };
}

export interface SectionPoints {
  kb: number;
  kg: number;
  km: number;
}

export interface ShipSectionProps {
  v: VesselClass;
  draft: number;
  /** Screen position of the point where the centerline meets the waterline. */
  cx: number;
  wlY: number;
  /** Pixels per meter. */
  scale: number;
  /** Heel, degrees; positive heels to port (the left side goes down). */
  heelDeg?: number;
  /** Height of the cargo surface above the keel, m. */
  cargoTop?: number;
  cargoColor?: string;
  /** Fraction full of the double-bottom and hopper tanks. */
  lowerFill?: number;
  /** Fraction full of the topside tanks: one number for both, or [port, starboard]. */
  topsideFill?: number | [number, number];
  /** Draw K, B, G and M, with the weight and buoyancy forces. */
  points?: SectionPoints;
  /** Left and right edges of the sea, in screen units. */
  seaX0?: number;
  seaX1?: number;
  /** Bottom of the sea, in screen units. */
  seaBottom?: number;
  /** Points above this screen y (e.g. a light ship's very high M) are pinned to it, with an arrow. */
  topLimit?: number;
  idPrefix: string;
  children?: ReactNode;
}

/** Ship-frame point (y, z) to screen, for a section drawn with these props. */
export function sectionToScreen(p: Pick<ShipSectionProps, 'cx' | 'wlY' | 'scale' | 'draft' | 'heelDeg'>, y: number, z: number) {
  const th = ((p.heelDeg ?? 0) * Math.PI) / 180;
  const dz = z - p.draft;
  return {
    x: p.cx + p.scale * (y * Math.cos(th) - dz * Math.sin(th)),
    y: p.wlY - p.scale * (y * Math.sin(th) + dz * Math.cos(th)),
  };
}

/** Where the center of buoyancy sits at a heel, in ship meters (it moves toward the low side). */
export function heeledBuoyancy(pts: SectionPoints, heelDeg: number) {
  const th = (heelDeg * Math.PI) / 180;
  const bm = pts.km - pts.kb;
  return { y: -bm * Math.sin(th), z: pts.km - bm * Math.cos(th) };
}

function poly(pts: Array<[number, number]>, X: (y: number) => number, Z: (z: number) => number) {
  return pts.map(([y, z], i) => `${i ? 'L' : 'M'}${X(y).toFixed(1)} ${Z(z).toFixed(1)}`).join(' ') + ' Z';
}

/** A bulk carrier's midship section. */
export function ShipSection({
  v,
  draft,
  cx,
  wlY,
  scale,
  heelDeg = 0,
  cargoTop,
  cargoColor = '#b9a58b',
  lowerFill = 0,
  topsideFill = 0,
  points,
  seaX0 = 0,
  seaX1 = 640,
  seaBottom,
  topLimit = 12,
  idPrefix,
  children,
}: ShipSectionProps) {
  const g = sectionGeometry(v);
  const s = scale;
  const X = (y: number) => s * y;
  const Z = (z: number) => -s * (z - draft);
  const { hb, D, bilge, hopperToe, hopperTop, hatch, topsideLow, coaming } = g;
  const outline: Array<[number, number]> = [];
  // Bottom and bilges as a polygon with rounded corners approximated in steps.
  const arc = (cy: number, cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      outline.push([cy + bilge * Math.cos(a), cz + bilge * Math.sin(a)]);
    }
  };
  outline.push([-hb, D]);
  outline.push([-hb, bilge]);
  arc(-hb + bilge, bilge, Math.PI, 1.5 * Math.PI);
  arc(hb - bilge, bilge, 1.5 * Math.PI, 2 * Math.PI);
  outline.push([hb, D]);
  const hull = poly(outline, X, Z);
  const hold: Array<[number, number]> = [
    [-hopperToe, DOUBLE_BOTTOM],
    [hopperToe, DOUBLE_BOTTOM],
    [hb, hopperTop],
    [hb, topsideLow],
    [hatch, D],
    [hatch, coaming],
    [-hatch, coaming],
    [-hatch, D],
    [-hb, topsideLow],
    [-hb, hopperTop],
  ];
  const lowerTanks: Array<[number, number]> = [
    [-hb + 0.4, 0.4],
    [hb - 0.4, 0.4],
    [hb - 0.2, hopperTop - 0.2],
    [hopperToe, DOUBLE_BOTTOM],
    [-hopperToe, DOUBLE_BOTTOM],
    [-hb + 0.2, hopperTop - 0.2],
  ];
  const topside = (side: -1 | 1): Array<[number, number]> => [
    [side * (hb - 0.25), topsideLow + 0.3],
    [side * (hb - 0.25), D - 0.25],
    [side * (hatch + 0.4), D - 0.25],
  ];
  const [portFill, stbdFill] = Array.isArray(topsideFill) ? topsideFill : [topsideFill, topsideFill];
  const lowerLevel = Math.max(0, Math.min(1, lowerFill)) * hopperTop;
  const tsLevel = (f: number) => topsideLow + Math.max(0, Math.min(1, f)) * (D - topsideLow);
  const ids = { hold: `${idPrefix}-hold`, lower: `${idPrefix}-lower`, tsP: `${idPrefix}-tsp`, tsS: `${idPrefix}-tss` };
  const wide = (hb + 4) * s;
  const top = cargoTop ?? DOUBLE_BOTTOM;
  const bottomY = seaBottom ?? wlY + s * (draft + 4);

  // Points and forces, in screen coordinates (the forces are vertical in the world, not the ship).
  const at = (y: number, z: number) => sectionToScreen({ cx, wlY, scale, draft, heelDeg }, y, z);
  let pointsEl: ReactNode = null;
  if (points) {
    const K = at(0, 0);
    const G = at(0, points.kg);
    const Mraw = at(0, points.km);
    const offTop = Mraw.y < topLimit;
    const M = offTop ? { x: Mraw.x, y: topLimit } : Mraw;
    const bh = heeledBuoyancy(points, heelDeg);
    const B = at(bh.y, bh.z);
    const arrow = 38;
    pointsEl = (
      <g>
        <line x1={K.x} y1={K.y} x2={M.x} y2={M.y} stroke="#9a9a9a" strokeWidth={1} strokeDasharray="3 3" />
        {/* weight down through G */}
        <line x1={G.x} y1={G.y} x2={G.x} y2={G.y + arrow} stroke={GRAPHIC.orange} strokeWidth={2.5} />
        <path d={`M${G.x - 5} ${G.y + arrow - 7} L${G.x} ${G.y + arrow + 1} L${G.x + 5} ${G.y + arrow - 7} Z`} fill={GRAPHIC.orange} />
        {/* buoyancy up through B */}
        <line x1={B.x} y1={B.y} x2={B.x} y2={B.y - arrow} stroke={GRAPHIC.blue} strokeWidth={2.5} />
        <path d={`M${B.x - 5} ${B.y - arrow + 7} L${B.x} ${B.y - arrow - 1} L${B.x + 5} ${B.y - arrow + 7} Z`} fill={GRAPHIC.blue} />
        <circle cx={K.x} cy={K.y} r={3.5} fill="#444" />
        <circle cx={B.x} cy={B.y} r={5} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={1.5} />
        <circle cx={G.x} cy={G.y} r={5} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={1.5} />
        <circle cx={M.x} cy={M.y} r={5} fill={GRAPHIC.violet} stroke="#fcfcfb" strokeWidth={1.5} />
        <text x={K.x - 9} y={K.y + 4} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: '#333' }}>
          K
        </text>
        <text x={B.x - 9} y={B.y + 4} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.blue }}>
          B
        </text>
        <text x={G.x + 9} y={G.y + 4} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.orange }}>
          G
        </text>
        <text x={M.x + 9} y={M.y + 4} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.violet }}>
          {offTop ? 'M ↑ (off the drawing)' : 'M'}
        </text>
      </g>
    );
  }

  return (
    <g>
      <defs>
        <clipPath id={ids.hold}>
          <path d={poly(hold, X, Z)} />
        </clipPath>
        <clipPath id={ids.lower}>
          <path d={poly(lowerTanks, X, Z)} />
        </clipPath>
        <clipPath id={ids.tsP}>
          <path d={poly(topside(-1), X, Z)} />
        </clipPath>
        <clipPath id={ids.tsS}>
          <path d={poly(topside(1), X, Z)} />
        </clipPath>
      </defs>
      <g transform={`translate(${cx} ${wlY}) rotate(${-heelDeg})`}>
        <path d={hull} fill={HULL_FILL} stroke="none" />
        {/* tanks: outlines, then water in them */}
        <path d={poly(lowerTanks, X, Z)} fill="#ebe8e1" stroke="#c3beb4" strokeWidth={1} />
        <path d={poly(topside(-1), X, Z)} fill="#ebe8e1" stroke="#c3beb4" strokeWidth={1} />
        <path d={poly(topside(1), X, Z)} fill="#ebe8e1" stroke="#c3beb4" strokeWidth={1} />
        {lowerLevel > 0 && <rect x={-wide} y={Z(lowerLevel)} width={2 * wide} height={Z(0) - Z(lowerLevel)} fill={BALLAST_FILL} clipPath={`url(#${ids.lower})`} />}
        {portFill > 0 && <rect x={-wide} y={Z(tsLevel(portFill))} width={wide} height={Z(topsideLow) - Z(tsLevel(portFill))} fill={BALLAST_FILL} clipPath={`url(#${ids.tsP})`} />}
        {stbdFill > 0 && <rect x={0} y={Z(tsLevel(stbdFill))} width={wide} height={Z(topsideLow) - Z(tsLevel(stbdFill))} fill={BALLAST_FILL} clipPath={`url(#${ids.tsS})`} />}
        {/* the hold and its cargo */}
        <path d={poly(hold, X, Z)} fill="#fbfaf7" stroke="#b5b0a6" strokeWidth={1} />
        {top > DOUBLE_BOTTOM && (
          <rect x={-wide} y={Z(top)} width={2 * wide} height={Z(DOUBLE_BOTTOM) - Z(top)} fill={cargoColor} opacity={0.9} clipPath={`url(#${ids.hold})`} />
        )}
        {/* hatch cover */}
        <rect x={X(-hatch - 0.6)} y={Z(coaming + 0.8)} width={X(2 * hatch + 1.2)} height={0.8 * s} fill="#e2ded6" stroke={HULL_STROKE} strokeWidth={1} />
        <path d={hull} fill="none" stroke={HULL_STROKE} strokeWidth={1.5} strokeLinejoin="round" />
        <text x={X(-hb + 0.6)} y={Z(D) - 6} className="ax">
          port
        </text>
        <text x={X(hb - 0.6)} y={Z(D) - 6} textAnchor="end" className="ax">
          starboard
        </text>
      </g>
      {/* the sea, drawn over the hull so the underwater part reads as submerged */}
      <rect x={seaX0} y={wlY} width={seaX1 - seaX0} height={Math.max(0, bottomY - wlY)} fill={SEA_FILL} opacity={0.72} />
      <line x1={seaX0} x2={seaX1} y1={wlY} y2={wlY} stroke={SEA_LINE} strokeWidth={1.5} />
      {pointsEl}
      {children}
    </g>
  );
}
