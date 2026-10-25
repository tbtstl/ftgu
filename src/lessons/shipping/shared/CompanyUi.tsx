// Chapter 6's company furniture: the “so far” line that sums up what earlier lessons built, and the
// switch a figure uses to run either the starting company (which the prose describes) or the
// reader's own.

import type { ReactNode } from 'react';
import { Segmented, TEXT, fmt, lessonHref, pct } from '../../../framework';
import { PLACE } from '../../../model/shipping/geo';
import { ROUTES } from '../../../model/shipping/trades';
import { partChanged, when, type CompanyDesign } from './company';

export type CompanyView = 'start' | 'yours';

const RULE_TEXT = { bestTce: 'best TCE', nearest: 'nearest cargo', bestFreight: 'best freight' } as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The fleet in a few words: “Kestrel and Albatross, owned, on 60% loans”. */
export function fleetText(d: CompanyDesign): string {
  const owned = d.ships.filter((s) => s.mode === 'owned').length;
  const chartered = d.ships.length - owned;
  const kmax = d.ships.filter((s) => s.cls === 'kmax').length;
  const cape = d.ships.length - kmax;
  const names = d.ships.length <= 2 ? d.ships.map((s) => s.name).join(' and ') : plural(d.ships.length, 'ship', 'ships');
  const mix = `${plural(kmax, 'Kamsarmax', 'Kamsarmaxes')} and ${plural(cape, 'Capesize', 'Capesizes')}`;
  const terms = chartered ? `${owned} owned, ${chartered} chartered in` : 'all owned';
  return `${names} (${mix}; ${terms}), ${pct(d.finance.ltv)} loans`;
}

/** The cargo world in a few words. */
export function worldText(d: CompanyDesign): string {
  const w = d.world;
  const scaled = Object.entries(w.routeScale).filter(([, v]) => Math.abs(v - 1) > 1e-9);
  const exports = scaled.length
    ? `, ${scaled
        .map(([id, v]) => {
          const r = ROUTES.find((x) => x.id === id);
          return r ? `${PLACE[r.from].name} ${r.commodity} at ${pct(v)}` : null;
        })
        .filter(Boolean)
        .join(', ')}`
    : '';
  return `${w.weeks} weeks from ${when(w.start)}, brokers reaching ${fmt(w.reach * 100, 2).replace(/\.?0+$/, '')}% of cargoes${exports}`;
}

/** The desk's policy in a few words. */
export function policyText(d: CompanyDesign): string {
  const p = d.policy;
  const extras = [
    p.minTce > 0 ? `a $${fmt(p.minTce)}/day minimum` : null,
    p.bunker !== undefined ? `bunkers fixed at $${fmt(p.bunker)}/t` : null,
    p.congestion ? `${fmt(p.congestion, 1)} extra days at Qingdao` : null,
  ].filter(Boolean);
  return `${RULE_TEXT[p.rule]} at ${fmt(p.speed, Number.isInteger(p.speed) ? 0 : 1)} knots${extras.length ? `, ${extras.join(', ')}` : ''}`;
}

const STRIP_STYLE = { margin: '0 0 1.2em', padding: '8px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', fontSize: 14, lineHeight: 1.6, color: TEXT.gray } as const;

function Part({ lesson, label, changed, children }: { lesson: string; label: string; changed: boolean; children: ReactNode }) {
  return (
    <span>
      <a href={lessonHref(`shipping/${lesson}`)} title={`Built in Lesson ${lesson}`}>
        {label}
      </a>
      : {children}
      {changed ? '' : ' (as at the start)'}
    </span>
  );
}

/**
 * “Northwind so far”: one line near the top of Lessons 6.2–6.5 summing up the parts of the company
 * earlier lessons built, linked to each.
 */
export function CompanySoFar({ d, lesson }: { d: CompanyDesign; lesson: 2 | 3 | 4 | 5 }) {
  const parts: ReactNode[] = [
    <Part key="6.1" lesson="6.1" label="fleet" changed={partChanged(d, 'ships')}>
      {fleetText(d)}
    </Part>,
  ];
  if (lesson >= 3)
    parts.push(
      <Part key="6.2" lesson="6.2" label="cargoes" changed={partChanged(d, 'world')}>
        {worldText(d)}
      </Part>,
    );
  if (lesson >= 4)
    parts.push(
      <Part key="6.3" lesson="6.3" label="desk" changed={partChanged(d, 'policy')}>
        {policyText(d)}
      </Part>,
    );
  return (
    <div style={STRIP_STYLE} role="note" aria-label="Northwind so far">
      <b style={{ fontWeight: 500, color: '#444' }}>Northwind so far:</b>{' '}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
    </div>
  );
}

/**
 * The switch at the top of a figure that reuses earlier lessons' parts of the company: run the
 * starting company, which the text describes, or the reader's. Shown only when the two differ.
 */
export function ViewSwitch({
  value,
  onChange,
  labels,
  note,
}: {
  value: CompanyView;
  onChange: (v: CompanyView) => void;
  labels: [string, string];
  /** What differs, said once under the switch. */
  note: ReactNode;
}) {
  return (
    <div style={{ margin: '0 0 4px' }}>
      <Segmented
        label="Which company the demonstration runs"
        value={value}
        onChange={onChange}
        options={[
          { value: 'start', label: labels[0] },
          { value: 'yours', label: labels[1] },
        ]}
      />
      <p className="cap" style={{ padding: 0, margin: '-4px 0 6px' }}>
        {note}
      </p>
    </div>
  );
}
