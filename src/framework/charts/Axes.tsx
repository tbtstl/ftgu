import type { Scale } from './scale';

/** Horizontal gridlines with labels on the left, for a y scale. */
export function GridY({
  y,
  ticks,
  x0,
  x1,
  format = (v) => String(v),
  baseline,
}: {
  y: Scale;
  ticks: number[];
  x0: number;
  x1: number;
  format?: (v: number) => string;
  /** Value drawn as a darker axis line (usually 0). */
  baseline?: number;
}) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === baseline ? 'base' : 'gl'} x1={x0} x2={x1} y1={y(t)} y2={y(t)} />
          <text className="ax ax-e" x={x0 - 6} y={y(t) + 4}>
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Labels along the bottom for an x scale. */
export function AxisX({ x, ticks, yPos, format = (v) => String(v) }: { x: Scale; ticks: number[]; yPos: number; format?: (v: number) => string }) {
  return (
    <g>
      {ticks.map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={yPos}>
          {format(t)}
        </text>
      ))}
    </g>
  );
}

/** A small axis title in the top-left corner of a chart. */
export function AxisTitle({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text className="ax" x={x} y={y}>
      {children}
    </text>
  );
}
