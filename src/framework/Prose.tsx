import type { ReactNode } from 'react';
import { CONCEPT, type Tone } from './tokens';

/** A body paragraph. */
export function P({ children }: { children: ReactNode }) {
  return <p className="pp">{children}</p>;
}

/** A section heading inside a lesson. */
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="hd" id={id}>
      {children}
    </h2>
  );
}

/** A bulleted list in body type. Use sparingly; prose usually reads better. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="ul">{children}</ul>;
}

type Concept = keyof typeof CONCEPT;

/**
 * A key term, colored to match the figure that shows it.
 * <K c="voltage">voltage</K> or <K tone="teal">reserve</K>.
 */
export function K({ c, tone, children }: { c?: Concept; tone?: Tone; children: ReactNode }) {
  const t: Tone = tone ?? (c ? CONCEPT[c] : 'ink');
  return <span className={`k tone-${t}`}>{children}</span>;
}

/** Colored text without the key-term weight (for numbers inside equations or readouts). */
export function Tn({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tone-${tone}`}>{children}</span>;
}

/** A centered, live equation row. Children are terms; use <Op> for operators. */
export function Eq({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="eq" role="math" aria-label={label}>
      {children}
    </div>
  );
}

export function Op({ children }: { children: ReactNode }) {
  return <span className="op">{children}</span>;
}

export function Frac({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <span className="frac">
      <span>{top}</span>
      <span className="frac-bar" />
      <span>{bottom}</span>
    </span>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return <span className="sub">{children}</span>;
}

export function Sup({ children }: { children: ReactNode }) {
  return <span className="sup">{children}</span>;
}
