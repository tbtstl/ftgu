import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { CONCEPT, type Tone } from './tokens';
import { useFigureActive } from './twoUp';

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

/** Smallest the type may shrink to keep an equation on one line; past this it wraps instead. */
const EQ_MIN_SCALE = 0.6;
/** Size of an equation that has to wrap anyway. */
const EQ_WRAP_SCALE = 0.85;

/**
 * A live equation on one line. Children are terms; use <Op> for operators. When the row is wider
 * than its column (a phone, the two-up panel, long numbers), the type shrinks to fit rather than
 * breaking the equation in two, down to EQ_MIN_SCALE. Only a row too long even then wraps.
 */
export function Eq({ children, label }: { children: ReactNode; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLSpanElement>(null);
  // Re-render (and so refit) when this equation's figure is brought into the side panel.
  useFigureActive();

  const fit = () => {
    const b = box.current;
    const r = row.current;
    if (!b || !r) return;
    // Measure at full size, then scale down to the width available.
    r.style.fontSize = '';
    r.classList.remove('wrap');
    const natural = r.scrollWidth;
    const room = b.clientWidth;
    if (!natural || !room || natural <= room) return;
    // Not everything shrinks exactly with the type (rounding, fraction bars), so correct a few times.
    let scale = 1;
    let width = natural;
    for (let i = 0; i < 4 && width > room && scale > EQ_MIN_SCALE; i++) {
      scale = Math.max(EQ_MIN_SCALE, scale * (room / width) * 0.99);
      r.style.fontSize = `${scale.toFixed(3)}em`;
      width = r.scrollWidth;
    }
    // Too long even at the smallest size: break it like typeset maths instead, at a readable size,
    // with the continuation indented under the first line.
    if (width > room) {
      r.classList.add('wrap');
      scale = EQ_WRAP_SCALE;
      r.style.fontSize = `${scale}em`;
      // A single wide term (a long fraction) can't wrap, so shrink until it fits too.
      width = r.scrollWidth;
      for (let i = 0; i < 4 && width > room && scale > EQ_MIN_SCALE; i++) {
        scale = Math.max(EQ_MIN_SCALE, scale * (room / width) * 0.99);
        r.style.fontSize = `${scale.toFixed(3)}em`;
        width = r.scrollWidth;
      }
    }
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Refit whenever the terms change (live numbers), and when the column or the fonts do. The
  // second pass runs after every layout effect, once a figure has been moved into the side panel.
  useLayoutEffect(fit);
  useEffect(fit);
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(b);
    document.fonts?.ready.then(() => fitRef.current());
    return () => ro.disconnect();
  }, []);

  return (
    <div className="eq" role="math" aria-label={label} ref={box}>
      <span className="eq-row" ref={row}>
        {children}
      </span>
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
