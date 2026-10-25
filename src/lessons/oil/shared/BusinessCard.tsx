// A one-glance summary of the reader's oil business (Chapter 7), with a link to the lesson that
// owns each part. Each lesson shows it once, before its first figure, as a "so far" summary of the
// earlier choices its figures use.

import { GRAPHIC, TEXT, fmt, lessonHref, pct } from '../../../framework';
import { refineryCapital, type OilBusiness } from '../../../engines/oil/business';
import { CORRAN, UNIT_NAME, type UnitId } from '../../../model/oil/refinery';
import { CRACK_RATIOS } from '../../../engines/oil/trading';
import { PART_LESSON, partChanged, useBusiness, type BusinessPart } from './business';

const PART_TITLE: Record<BusinessPart, string> = {
  production: 'Production',
  refinery: 'Refinery',
  logistics: 'Logistics',
  hedges: 'Hedges',
};

const MIX_NAME: Record<keyof typeof CRACK_RATIOS, string> = { '3:2:1': '3:2:1', '2:1:1': '2:1:1', corran: 'Corran’s mix' };

/** Plain-language summaries of each part of a plan. */
export function describePart(b: OilBusiness, part: BusinessPart): string {
  switch (part) {
    case 'production': {
      const p = b.production;
      const wells = p.wellsPerYear === 0 ? 'no new Pinyon wells' : `${p.wellsPerYear} Pinyon wells a year`;
      const gate = p.drillAbove > 0 && p.wellsPerYear > 0 ? `, drilled only when WTI is at least $${fmt(p.drillAbove)}` : '';
      return `${wells}${gate}; Northfield ${p.waterflood ? 'waterflooded' : 'on pumps alone'}`;
    }
    case 'refinery': {
      const units = (Object.keys(CORRAN.capacity) as UnitId[]).filter((u) => b.refinery.capacity[u] !== CORRAN.capacity[u]);
      const extra: string[] = units.map((u) => `${UNIT_NAME[u].toLowerCase()} ${fmt(b.refinery.capacity[u])} kb/d`);
      if (b.refinery.hydrogenPlant !== CORRAN.hydrogenPlant) extra.push(`hydrogen plant ${fmt(b.refinery.hydrogenPlant)} MMscf/d`);
      if (b.refinery.sulfurPlant !== CORRAN.sulfurPlant) extra.push(`sulfur plant ${fmt(b.refinery.sulfurPlant)} t/d`);
      if (!extra.length) return 'Corran as it stands today';
      const cap = refineryCapital(b.refinery);
      return `Corran with ${extra.join(', ')} ($${fmt(cap / 1e6)} million)`;
    }
    case 'logistics':
      return b.logistics.firmSpace === 0 ? 'no firm space: crude is sold at Kessler' : `${fmt(b.logistics.firmSpace)} kb/d of firm space to Port Corran`;
    case 'hedges': {
      const h = b.hedges;
      if (h.production === 0 && h.crack === 0) return 'none';
      const parts: string[] = [];
      if (h.production > 0) parts.push(`${pct(h.production)} of net production sold forward`);
      if (h.crack > 0) parts.push(`${MIX_NAME[h.mix]} crack against ${h.bench === 'wti' ? 'WTI' : 'Brent'} on ${fmt(h.crack, 2)} of runs`);
      return parts.join('; ');
    }
  }
}

export function BusinessCard({
  current,
  parts = ['production', 'refinery', 'logistics', 'hedges'],
  title = 'Your business so far',
}: {
  current?: BusinessPart;
  parts?: BusinessPart[];
  title?: string;
}) {
  const b = useBusiness();
  return (
    <div
      role="group"
      aria-label={title}
      style={{ border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, padding: '8px 12px', margin: '6px 0 10px', fontSize: 14, lineHeight: 1.45, color: TEXT.ink }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {parts.map((part) => {
        const here = part === current;
        const changed = partChanged(b, part);
        return (
          <div key={part} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: here ? GRAPHIC.violet : changed ? GRAPHIC.green : '#c8c8c8', display: 'inline-block' }} aria-hidden />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: here ? 600 : 500 }}>{PART_TITLE[part]}</span>
              {': '}
              {describePart(b, part)}
              {here ? ' (set in this lesson)' : changed ? '' : ' (starting plan)'}
            </span>
            {!here && (
              <a href={lessonHref(PART_LESSON[part])} style={{ whiteSpace: 'nowrap' }}>
                Lesson {PART_LESSON[part].replace('oil/', '')}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

