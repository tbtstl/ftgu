// "Your capstone so far": a short strip at the top of each capstone lesson showing the saved state
// the figures run on (region, business, desk), against the reference settings the text quotes,
// with a button that loads the reference (and an undo).

import { useSyncExternalStore } from 'react';
import { Button, fmt, signed } from '../../../framework';
import {
  CAPSTONE_DEFAULTS,
  isFenwick,
  samePart,
  setCapstoneParts,
  useWeatherCapstone,
  type BusinessSettings,
  type DeskSettings,
  type RegionSettings,
  type WeatherCapstone,
} from './capstone';

export type StripPart = 'region' | 'business' | 'desk';

const BUSINESS_NAME: Record<BusinessSettings['kind'], string> = {
  utility: 'Fenwick Gas & Light',
  wind: 'the Hollin Ridge wind farm',
  farm: 'the Marlow corn farm',
};

const MONTH_NAME: Record<number, string> = { 10: 'November', 11: 'December', 0: 'January', 1: 'February', 2: 'March' };

export function regionWords(r: RegionSettings): string {
  if (isFenwick(r)) return 'Fenwick Bay';
  return `your own: ${fmt(r.latitude, 1)}° N, continentality ${fmt(r.continentality, 2)}, ${fmt(r.elevation)} m up; the Pacific’s pull ${fmt(r.ensoF, 1)} °F per °C, variability × ${fmt(r.variability, 2)}, warming ${signed(r.trend, 2)} °F a year`;
}

/** "× 1", "× 0.85". */
export function sizeWords(scale: number): string {
  return `× ${Math.abs(scale - Math.round(scale)) < 1e-9 ? fmt(scale) : fmt(scale, 2)}`;
}

export function businessWords(b: BusinessSettings): string {
  return `${BUSINESS_NAME[b.kind]} at ${sizeWords(b.scale)}`;
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function deskWords(d: DeskSettings): string {
  const strips = `${fmt(d.hedgeStrips)} strips sold`;
  if (!d.months.length || d.size <= 0) return `${strips}, no trading`;
  return `${strips}, trading ${list(d.months.map((m) => MONTH_NAME[m] ?? `month ${m + 1}`))} ${fmt(d.lead)} days ahead, ${fmt(d.size)} contracts a trade at a ${fmt(d.threshold)}-point threshold`;
}

const LABEL: Record<StripPart, string> = { region: 'Region', business: 'Business', desk: 'Desk' };

function words(part: StripPart, s: WeatherCapstone): string {
  return part === 'region' ? regionWords(s.region) : part === 'business' ? businessWords(s.business) : deskWords(s.desk);
}

/** Whether every shown part of the state matches the reference. */
export function atReference(s: WeatherCapstone, parts: StripPart[], reference: Partial<WeatherCapstone>): boolean {
  return parts.every((p) => samePart(p, s[p], (reference[p] ?? CAPSTONE_DEFAULTS[p]) as never));
}

// The last "use the reference settings": what it replaced, and what it put in. Undo is offered
// only while the state is still exactly what it put in.
let lastApplied: { before: Partial<WeatherCapstone>; applied: Partial<WeatherCapstone> } | null = null;
const undoListeners = new Set<() => void>();
function setLastApplied(v: typeof lastApplied) {
  lastApplied = v;
  undoListeners.forEach((l) => l());
}
function subscribeUndo(l: () => void) {
  undoListeners.add(l);
  return () => undoListeners.delete(l);
}

/** The lesson's reference settings for some parts of the capstone: whether they're in use, a way to load them, and an undo. */
export function useReference(parts: StripPart[], reference: Partial<WeatherCapstone> = {}) {
  const s = useWeatherCapstone();
  const last = useSyncExternalStore(subscribeUndo, () => lastApplied, () => null);
  const ref = Object.fromEntries(parts.map((p) => [p, reference[p] ?? CAPSTONE_DEFAULTS[p]])) as Partial<WeatherCapstone>;
  const same = atReference(s, parts, ref);
  const refState = { ...s, ...ref } as WeatherCapstone;
  const appliedParts = last ? (Object.keys(last.applied) as StripPart[]) : [];
  const canUndo = !!last && atReference(s, appliedParts, last.applied);
  return {
    same,
    refState,
    differing: parts.filter((p) => !samePart(p, s[p], refState[p] as never)),
    apply: () => {
      setLastApplied({ before: Object.fromEntries(parts.map((p) => [p, s[p]])) as Partial<WeatherCapstone>, applied: ref });
      setCapstoneParts(ref);
    },
    undo: canUndo
      ? () => {
          setCapstoneParts(last!.before);
          setLastApplied(null);
        }
      : null,
  };
}

export function CapstoneStrip({
  parts,
  reference = {},
  button = 'Use the reference settings',
}: {
  /** The parts the lesson uses, in order. */
  parts: StripPart[];
  /** The reference the text quotes, where it differs from the starting settings. */
  reference?: Partial<WeatherCapstone>;
  button?: string;
}) {
  const s = useWeatherCapstone();
  const { same, refState, differing, apply, undo } = useReference(parts, reference);
  return (
    <aside
      aria-label="Your capstone so far"
      style={{ margin: '0 0 1.5em', padding: '10px 14px 12px', border: '1px solid var(--rule-strong)', borderRadius: 6, fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}
    >
      <div style={{ fontSize: 13 }}>Your capstone so far</div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 12px', margin: '4px 0 6px' }}>
        {parts.map((p) => (
          <div key={p} style={{ display: 'contents' }}>
            <dt>{LABEL[p]}</dt>
            <dd style={{ margin: 0, color: 'var(--text)' }}>{words(p, s)}</dd>
          </div>
        ))}
      </dl>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
        <span style={{ flex: '1 1 18rem' }}>
          {same
            ? 'These are the reference settings the text quotes; the figures run on them.'
            : `The figures and challenges run on yours. The text quotes the reference: ${differing.map((p) => `${LABEL[p].toLowerCase()}, ${words(p, refState)}`).join('; ')}.`}
        </span>
        {!same && (
          <Button onClick={apply} primary>
            {button}
          </Button>
        )}
        {same && undo && <Button onClick={undo}>Undo</Button>}
      </div>
    </aside>
  );
}
