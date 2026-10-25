// A one-glance summary of the reader's agricultural business (Chapter 6): the choices of earlier
// lessons that this lesson's figures use, each with a link back to the lesson that sets it.

import { GRAPHIC, TEXT, fmt, lessonHref } from '../../../framework';
import { CEDAR_DESIGN, ELEVATOR_OF, type FarmDesign } from '../../../engines/agriculture/capstone';
import { DISTRICT, PLACE } from '../../../model/agriculture/region';
import { DEFAULT_MERCHANT, sameFarm, useCapstone, type MerchantRules } from './capstone';

export type BusinessPart = 'farm' | 'merchant';

const PART_TITLE: Record<BusinessPart, string> = { farm: 'Farm', merchant: 'Merchant' };
const PART_LESSON: Record<BusinessPart, string> = { farm: 'agriculture/6.1', merchant: 'agriculture/6.4' };
const MONTH: Record<'Mar' | 'May' | 'Jul', string> = { Mar: 'March', May: 'May', Jul: 'July' };

/** The farm in a phrase: "Black Prairie, 800 of 1,600 acres in corn, standard hybrid, no pivots, 125,000 bushels of bins". */
export function describeFarm(f: FarmDesign): string {
  const onCorn = Math.max(0, f.cornAcres - (f.acres - f.cornAcres));
  const corn = f.cornAcres === 0 ? 'all wheat' : `${fmt(f.cornAcres)} of ${fmt(f.acres)} acres in corn${onCorn > 0 ? ` (${fmt(onCorn)} after corn)` : ''}`;
  return `${DISTRICT[f.district].name}, ${corn}, ${f.hybrid} hybrid, ${f.irrigated ? 'pivots' : 'no pivots'}, ${fmt(f.bins)} bushels of bins`;
}

/** Where the farm sells, and the merchant the business runs: "the country elevator at Fairview", "the river terminal at Crane Landing". */
export function elevatorPhrase(f: FarmDesign): string {
  const place = PLACE[ELEVATOR_OF[f.district]];
  return place.kind === 'terminal' ? `the river terminal at ${place.name}` : `the country elevator at ${place.name}`;
}

/** The merchant's rules in a phrase: "38¢ harvest spread; stores until July when the curve pays at least 60% of full carry; 5 million bushels of barge charter". */
export function describeMerchant(m: MerchantRules): string {
  const store = m.storeUntil === 'none' ? 'sells what is left at harvest' : `stores until ${MONTH[m.storeUntil]}${m.storeMinCarry > 0 ? ` when the curve pays at least ${fmt(m.storeMinCarry * 100)}% of full carry` : ' whenever the curve pays carry'}`;
  return `${m.spreadCents}¢ harvest spread; ${store}; ${m.charterMillions > 0 ? `${fmt(m.charterMillions)} million bushels of barge charter` : 'no barge charter'}`;
}

function isStart(part: BusinessPart, f: FarmDesign, m: MerchantRules): boolean {
  return part === 'farm' ? sameFarm(f, CEDAR_DESIGN) : (Object.keys(DEFAULT_MERCHANT) as Array<keyof MerchantRules>).every((k) => m[k] === DEFAULT_MERCHANT[k]);
}

/** "Your business so far": shown once in a lesson, before the first figure that uses the earlier lessons' choices. */
export function SoFar({ parts, title = 'Your business so far' }: { parts: BusinessPart[]; title?: string }) {
  const { farm, merchant } = useCapstone();
  return (
    <div role="group" aria-label={title} style={{ border: '1px solid var(--rule-strong)', borderRadius: 8, padding: '8px 12px', margin: '6px 0 10px', fontSize: 14, lineHeight: 1.45, color: TEXT.ink }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {parts.map((part) => {
        const start = isStart(part, farm, merchant);
        return (
          <div key={part} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: start ? '#c8c8c8' : GRAPHIC.green, display: 'inline-block' }} aria-hidden />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{PART_TITLE[part]}</span>
              {': '}
              {part === 'farm' ? describeFarm(farm) : describeMerchant(merchant)}
              {start ? (part === 'farm' ? ' — Cedar Bend’s design' : ' — the starting rules') : ''}
            </span>
            <a href={lessonHref(PART_LESSON[part])} style={{ whiteSpace: 'nowrap' }}>
              Lesson {PART_LESSON[part].replace('agriculture/', '')}
            </a>
          </div>
        );
      })}
    </div>
  );
}
