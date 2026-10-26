// Side elevation of a gearless bulk carrier, drawn to its own dimensions, floating at a draft.
// The vertical scale is exaggerated so a meter of draft is visible; callers say so in prose.

import type { ReactNode } from 'react';
import type { VesselClass } from '../../../model/shipping/vessels';

export const HULL_FILL = '#f3f1ec';
export const HULL_STROKE = '#5a5a5a';
export const SEA_FILL = '#d6e6f3';
export const SEA_LINE = '#4590ce';
export const ANTIFOUL = '#c9877b';

export interface ShipSideProps {
  v: VesselClass;
  draft: number;
  /** Left edge and width of the drawing in the parent SVG's units. */
  x: number;
  width: number;
  /** y of the keel in the parent SVG's units. */
  keelY: number;
  /** Vertical exaggeration relative to the horizontal scale. */
  exaggerate?: number;
  /** Trim in meters (positive: down by the stern). */
  trim?: number;
  /** Cargo fill per hold, 0–1, drawn as a cutaway (optional). */
  holds?: number[];
  cargoColor?: string;
  children?: ReactNode;
}

/** Number of cargo holds by class (a Kamsarmax has seven, a Capesize nine). */
export function holdCount(v: VesselClass): number {
  return v.loa > 260 ? 9 : v.loa > 210 ? 7 : 5;
}

export function shipSideScale(v: VesselClass, width: number, exaggerate = 2.6) {
  const sx = width / v.loa;
  return { sx, sz: sx * exaggerate };
}

/** A bulk carrier in side view, with the sea at its draft. */
export function ShipSide({ v, draft, x, width, keelY, exaggerate = 2.6, trim = 0, holds, cargoColor = '#b9a58b', children }: ShipSideProps) {
  const { sx, sz } = shipSideScale(v, width, exaggerate);
  const L = v.loa;
  const D = v.depth;
  const X = (m: number) => x + m * sx;
  const Z = (m: number) => keelY - m * sz;
  const fc = 2.6; // forecastle height above deck, m
  const hull = [
    `M${X(14)} ${Z(0)}`,
    `L${X(L - 14)} ${Z(0)}`,
    // bulbous bow
    `C${X(L - 2)} ${Z(0)} ${X(L + 1.5)} ${Z(2.2)} ${X(L - 1)} ${Z(5)}`,
    `C${X(L - 3.5)} ${Z(6.5)} ${X(L - 4)} ${Z(7.5)} ${X(L - 3)} ${Z(9)}`,
    // raked stem to the forecastle
    `L${X(L)} ${Z(D + fc)}`,
    `L${X(L - 22)} ${Z(D + fc)}`,
    `L${X(L - 22)} ${Z(D)}`,
    // main deck aft to the stern
    `L${X(1.5)} ${Z(D)}`,
    `L${X(0)} ${Z(D + 0.4)}`,
    // transom and stern overhang
    `L${X(1)} ${Z(9.5)}`,
    `C${X(4)} ${Z(6.5)} ${X(9)} ${Z(5.5)} ${X(9)} ${Z(3.5)}`,
    `L${X(9)} ${Z(1.2)}`,
    `L${X(14)} ${Z(0)}`,
    'Z',
  ].join(' ');
  const n = holdCount(v);
  const holdStart = 0.17 * L;
  const holdEnd = L - 24;
  const hl = (holdEnd - holdStart) / n;
  const t = trim / 2;
  // The waterline: at the draft amidships, tilted by the trim.
  const wlAft = Z(draft + t);
  const wlFwd = Z(draft - t);
  const seaTop = (xx: number) => wlAft + ((xx - x) / width) * (wlFwd - wlAft);
  const left = x - 30;
  const right = x + width + 30;
  const clipId = `hull-${v.id}-${Math.round(x)}-${Math.round(keelY)}`;
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <path d={hull} />
        </clipPath>
      </defs>
      {/* hull */}
      <path d={hull} fill={HULL_FILL} stroke="none" />
      {/* antifouling below the summer mark */}
      <rect x={x - 5} y={Z(v.designDraft)} width={width + 10} height={Z(-1) - Z(v.designDraft)} fill={ANTIFOUL} opacity={0.55} clipPath={`url(#${clipId})`} />
      {holds?.map((f, i) => {
        const x0 = X(holdStart + i * hl + 1.2);
        const w = (hl - 2.4) * sx;
        const top = Z(1.8 + Math.max(0, Math.min(1, f)) * (D + 1.5 - 1.8));
        return <rect key={i} x={x0} y={top} width={w} height={Z(1.8) - top} fill={cargoColor} opacity={0.9} />;
      })}
      {holds &&
        Array.from({ length: n + 1 }, (_, i) => (
          <line key={i} x1={X(holdStart + i * hl)} x2={X(holdStart + i * hl)} y1={Z(1.8)} y2={Z(D)} stroke="#b5b0a6" strokeWidth={1} />
        ))}
      {holds && <line x1={X(holdStart)} x2={X(holdEnd)} y1={Z(1.8)} y2={Z(1.8)} stroke="#b5b0a6" strokeWidth={1} />}
      <path d={hull} fill="none" stroke={HULL_STROKE} strokeWidth={1.5} strokeLinejoin="round" />
      {/* hatch covers */}
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={X(holdStart + i * hl + 2.5)} y={Z(D + 1.8)} width={(hl - 5) * sx} height={1.8 * sz} fill="#e2ded6" stroke={HULL_STROKE} strokeWidth={1} />
      ))}
      {/* accommodation and funnel */}
      <rect x={X(5)} y={Z(D + 15)} width={18 * sx} height={15 * sz} fill="#fbfaf7" stroke={HULL_STROKE} strokeWidth={1.2} />
      <rect x={X(3.5)} y={Z(D + 15.6)} width={21 * sx} height={0.6 * sz} fill={HULL_STROKE} />
      <rect x={X(7)} y={Z(D + 19)} width={6 * sx} height={3.4 * sz} fill="#e8645e" stroke={HULL_STROKE} strokeWidth={1} />
      {Array.from({ length: 3 }, (_, i) => (
        <line key={i} x1={X(6)} x2={X(22)} y1={Z(D + 4 + i * 4)} y2={Z(D + 4 + i * 4)} stroke="#c9c5bd" strokeWidth={1} />
      ))}
      {/* the sea */}
      <path
        d={`M${left} ${seaTop(left)} L${right} ${seaTop(right)} L${right} ${Z(-6)} L${left} ${Z(-6)} Z`}
        fill={SEA_FILL}
        opacity={0.82}
      />
      <line x1={left} x2={right} y1={seaTop(left)} y2={seaTop(right)} stroke={SEA_LINE} strokeWidth={1.5} />
      {children}
    </g>
  );
}

/**
 * Close-up of the load-line marks on the ship's side, true to scale: the deck line, the Plimsoll
 * disc at the summer mark, the ladder of seasonal marks and the water surface at the draft.
 */
export function LoadLineMarks({
  marks,
  draft,
  depth,
  x,
  y,
  width,
  height,
  span = 1.6,
  center,
}: {
  marks: Array<{ id: string; draft: number }>;
  draft: number;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Meters of hull side shown. */
  span?: number;
  /** Draft at the middle of the window (defaults to the summer mark). */
  center: number;
}) {
  const pxPerM = height / span;
  const Y = (z: number) => y + height / 2 - (z - center) * pxPerM;
  const summer = marks.find((m) => m.id === 'S')?.draft ?? center;
  const discX = x + width * 0.3;
  const r = 0.15 * pxPerM; // the disc is 300 mm across
  const ladderX = x + width * 0.62;
  const water = Math.max(y, Math.min(y + height, Y(draft)));
  const clip = `ll-${Math.round(x)}-${Math.round(y)}`;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={width} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={width} height={height} fill="#3d4f5e" />
        <rect x={x} y={Y(summer)} width={width} height={Math.max(0, y + height - Y(summer))} fill="#7c3b35" />
        {/* deck line */}
        <rect x={discX - 0.15 * pxPerM} y={Y(depth) - 0.0125 * pxPerM} width={0.3 * pxPerM} height={0.025 * pxPerM} fill="#f4f1ea" />
        {/* Plimsoll disc and its bar */}
        <circle cx={discX} cy={Y(summer) + 0.0125 * pxPerM} r={r} fill="none" stroke="#f4f1ea" strokeWidth={0.025 * pxPerM} />
        <rect x={discX - 0.225 * pxPerM} y={Y(summer)} width={0.45 * pxPerM} height={0.025 * pxPerM} fill="#f4f1ea" />
        {/* the ladder */}
        <rect x={ladderX - 0.04 * pxPerM} y={Y(Math.max(...marks.map((m) => m.draft))) - 0.01 * pxPerM} width={0.025 * pxPerM} height={(Math.max(...marks.map((m) => m.draft)) - Math.min(...marks.map((m) => m.draft)) + 0.04) * pxPerM} fill="#f4f1ea" />
        {marks.map((m) => {
          const fresh = m.id === 'F' || m.id === 'TF';
          const x0 = fresh ? ladderX - 0.27 * pxPerM : ladderX - 0.04 * pxPerM;
          return (
            <g key={m.id}>
              <rect x={x0} y={Y(m.draft)} width={0.23 * pxPerM} height={0.025 * pxPerM} fill="#f4f1ea" />
              <text x={fresh ? x0 - 4 : x0 + 0.23 * pxPerM + 4} y={Y(m.draft) + 10} textAnchor={fresh ? 'end' : 'start'} style={{ fontSize: 12, fontWeight: 600, fill: '#f4f1ea' }}>
                {m.id}
              </text>
            </g>
          );
        })}
        <text x={discX - r - 6} y={Y(summer) + 5} textAnchor="end" style={{ fontSize: 11, fontWeight: 600, fill: '#f4f1ea' }}>
          L
        </text>
        <text x={discX + r + 6} y={Y(summer) + 5} style={{ fontSize: 11, fontWeight: 600, fill: '#f4f1ea' }}>
          R
        </text>
        {/* water */}
        <rect x={x} y={water} width={width} height={y + height - water} fill={SEA_FILL} opacity={0.78} />
        <line x1={x} x2={x + width} y1={water} y2={water} stroke={SEA_LINE} strokeWidth={2} />
      </g>
      <rect x={x} y={y} width={width} height={height} fill="none" stroke="#9a9a9a" />
      {Y(draft) < y && (
        <text x={x + width / 2} y={y + 14} textAnchor="middle" style={{ fontSize: 12, fill: '#f4f1ea' }}>
          ↑ water {(draft - (center + span / 2)).toFixed(2)} m above view
        </text>
      )}
      {Y(draft) > y + height && (
        <text x={x + width / 2} y={y + height - 8} textAnchor="middle" style={{ fontSize: 12, fill: '#f4f1ea' }}>
          ↓ water {(center - span / 2 - draft).toFixed(2)} m below view
        </text>
      )}
    </g>
  );
}
