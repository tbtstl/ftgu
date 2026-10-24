import { useId, type ReactNode } from 'react';
import { TEXT, type Tone } from './tokens';

export interface SliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Text shown at the right of the label row; defaults to the raw value. */
  display?: ReactNode;
  tone?: Tone;
  disabled?: boolean;
}

/**
 * The course's slider: one compact row — muted label, hairline track, value — so a figure's
 * sliders stack tightly with their tracks lined up. The thumb is a short vertical rule, like the
 * demand and price markers in the charts, and only the value carries the concept's color. In
 * narrow spots the track wraps under the label.
 */
export function Slider({ label, value, min, max, step = 1, onChange, display, tone = 'gray', disabled }: SliderProps) {
  const id = useId();
  const f = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const color = tone === 'gray' || tone === 'ink' ? undefined : TEXT[tone];
  const knob = tone === 'ink' ? 'gray' : tone;
  return (
    <div className={'ctl slide' + (disabled ? ' dim' : '')}>
      <div className="ctl-in">
        <label htmlFor={id} className="ctl-l">
          {label}
        </label>
        <div className={`sl ${knob}`}>
          <div className="sl-fill" style={{ width: `calc((100% - 12px) * ${f})` }} />
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
        <span className="ctl-val" style={{ color }}>
          {display ?? value}
        </span>
      </div>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A choice between a few options, set as text: the chosen one is ink and underlined. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  primary,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Accessible name when children are an icon. */
  label?: string;
}) {
  return (
    <button type="button" className={'tbtn' + (primary ? ' primary' : '')} onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  );
}

/** Lays out several controls; two columns when there's room. */
export function Controls({ children, columns = 1 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <div
      className="ctls"
      style={columns === 2 ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', columnGap: 24 } : undefined}
    >
      {children}
    </div>
  );
}

export interface ReadoutItem {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
}

/** Big numbers under a figure. */
export function Readouts({ items }: { items: ReadoutItem[] }) {
  return (
    <div className="big">
      {items.map((it, i) => (
        <div key={i}>
          <span className="n" style={it.tone ? { color: TEXT[it.tone] } : undefined}>
            {it.value}
          </span>
          <span className="l">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A centered caption under a figure; good for a live sentence describing the state. */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="cap">{children}</p>;
}

export interface LegendItem {
  label: ReactNode;
  color: string;
  /** "box" (default) for areas and bars, "line" for series lines. */
  kind?: 'box' | 'line';
  dashed?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="lg">
      {items.map((it, i) => (
        <span key={i}>
          <span
            className={'sw' + (it.kind === 'line' ? ' line' : '')}
            style={{ background: it.dashed ? `repeating-linear-gradient(90deg, ${it.color} 0 5px, transparent 5px 8px)` : it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export interface Column<R> {
  label: ReactNode;
  cell: (row: R) => ReactNode;
  align?: 'left' | 'right';
}

/** A compact numeric table. Rows can be highlighted or dimmed. */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  rowClass,
  footer,
  caption,
}: {
  columns: Array<Column<R>>;
  rows: R[];
  rowKey: (row: R, i: number) => string | number;
  rowClass?: (row: R) => 'hl' | 'dim' | '' | undefined;
  footer?: ReactNode[];
  caption?: string;
}) {
  return (
    <div className="tbwrap">
      <table className="tb">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" style={c.align ? { textAlign: c.align } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={rowClass?.(r) || undefined}>
              {columns.map((c, j) => (
                <td key={j} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
          {footer && (
            <tr className="tot">
              {footer.map((f, i) => (
                <td key={i}>{f}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Color swatch inline with text (for tables and legends). */
export function Swatch({ color }: { color: string }) {
  return <span className="sw" style={{ background: color, marginRight: 8, verticalAlign: '-1px' }} />;
}
