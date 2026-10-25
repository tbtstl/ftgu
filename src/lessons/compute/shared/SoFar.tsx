// The capstone's design, at a glance. `SoFar` sits in the prose before a lesson's first figure and
// lists the parts of the reader's cloud that the lesson reuses, each with a link back to the lesson
// that sets it. `BasisSwitch` sits in each figure that shows the saved design and chooses whether the
// other lessons' parts are the starting design's (which the text describes) or the reader's own.

import { GRAPHIC, Segmented, TEXT, fmt, lessonHref, usd } from '../../../framework';
import { PRICEBOOK_DEFAULT, type Tier } from '../../../engines/compute/cloud';
import { ACCELERATORS, GPU_IDS } from '../../../model/compute/hardware';
import { SITES } from '../../../model/compute/sites';
import { PART_OF_LESSON, othersAtStart, partChanged, useCloud, type Basis, type CloudDesign, type CloudPart } from './cloudStore';

const PART_TITLE: Record<CloudPart, string> = { fleet: 'Fleet', customers: 'Customers', prices: 'Prices', ops: 'Operating plan' };
const LESSON_OF = Object.fromEntries(Object.entries(PART_OF_LESSON).map(([l, p]) => [p, l])) as Record<CloudPart, string>;
const TIER_WORD: Record<Tier, string> = { reserved: 'reserved', onDemand: 'on-demand', spot: 'spot' };

/** One part of a design in a phrase: "1,536 GPUs at Tech Park (256 L-class, 1,024 A-class, 256 B-class), air-cooled". */
export function describePart(d: CloudDesign, part: CloudPart): string {
  if (part === 'fleet') {
    const f = d.fleet;
    const total = GPU_IDS.reduce((s, g) => s + f.gpus[g], 0);
    const mix = GPU_IDS.filter((g) => f.gpus[g] > 0)
      .map((g) => `${fmt(f.gpus[g])} ${ACCELERATORS[g].short}`)
      .join(', ');
    return `${fmt(total)} GPUs at ${SITES[f.site].name}${mix ? ` (${mix})` : ''}, ${f.cooling === 'liquid' ? 'liquid' : 'air'}-cooled`;
  }
  if (part === 'customers') {
    if (!partChanged(d, 'customers')) return 'the six starting customers';
    return `${d.customers.length} customer${d.customers.length === 1 ? '' : 's'}, changed from the starting six`;
  }
  if (part === 'prices') {
    const changed: string[] = [];
    for (const t of ['reserved', 'onDemand', 'spot'] as Tier[])
      for (const g of GPU_IDS) if (Math.abs(d.prices[t][g] - PRICEBOOK_DEFAULT[t][g]) > 1e-9) changed.push(`${TIER_WORD[t]} ${ACCELERATORS[g].short} ${usd(d.prices[t][g], 2)}`);
    if (!changed.length) return 'the list prices';
    return `the list prices except ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''}`;
  }
  const o = d.ops;
  const rented = GPU_IDS.filter((g) => o.rented[g] > 0).map((g) => `${fmt(o.rented[g])} ${ACCELERATORS[g].short}`);
  return `${o.policy === 'tiered' ? 'on demand first, spot last' : 'first come, first served'}; ${rented.length ? `renting ${rented.join(' and ')}` : 'nothing rented'}; ${o.burst ? 'buying overflow elsewhere' : 'no buying elsewhere'}`;
}

/** "Your cloud so far": the parts of the reader's design a lesson reuses, starting or changed. */
export function SoFar({ parts, title = 'Your cloud so far' }: { parts: CloudPart[]; title?: string }) {
  const d = useCloud();
  return (
    <div role="group" aria-label={title} style={{ border: '1px solid var(--rule-strong)', borderRadius: 8, padding: '8px 12px', margin: '6px 0 10px', fontSize: 14, lineHeight: 1.45, color: TEXT.ink }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {parts.map((part) => {
        const changed = partChanged(d, part);
        const lesson = LESSON_OF[part];
        return (
          <div key={part} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: changed ? GRAPHIC.green : '#c8c8c8', display: 'inline-block' }} aria-hidden />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{PART_TITLE[part]}</span>
              {': '}
              {describePart(d, part)}
              {changed ? ' — yours' : ' — the starting design'}
            </span>
            <a href={lessonHref(`compute/${lesson}`)} style={{ whiteSpace: 'nowrap' }}>
              Lesson {lesson}
            </a>
          </div>
        );
      })}
    </div>
  );
}

/** The switch at the top of a figure: the starting design (as the text describes it) or the reader's. */
export function BasisSwitch({ value, onChange, own }: { value: Basis; onChange: (b: Basis) => void; own: CloudPart | null }) {
  const d = useCloud();
  const same = othersAtStart(d, own);
  return (
    <Segmented<Basis>
      label="Which design the demonstration shows"
      value={value}
      onChange={onChange}
      options={[
        { value: 'start', label: 'Starting design, as in the text' },
        { value: 'yours', label: same ? 'Your design (the same so far)' : 'Your design' },
      ]}
    />
  );
}
