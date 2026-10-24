// The course's simulated history: twelve model years of the dry bulk market, month by month, for
// both size classes — earnings, freight rates, fleets, orders and ship prices — produced by the
// cycle model from one fixed draw of demand shocks, bunker prices and a few disruptions. Lessons
// from Chapter 2 on use it wherever they need "history"; none of it is real market data.

import { DEFAULT_CYCLE, simulateCycle, type CycleEvent, type CycleMonth } from '../../engines/shipping/cycle';
import { gaussian, rng } from '../random';
import { BASE_BUNKER, type ClassId } from './trades';

export const HISTORY_MONTHS = 144;
export const HISTORY_SEED = 17;

/** The disruptions written into the history. */
export const HISTORY_EVENTS: CycleEvent[] = [
  { from: 40, to: 46, label: 'Port congestion in China', congestion: { QIN: 4 } },
  { from: 64, to: 72, label: 'Disruption at Brazil’s ore mines', routeScale: { 'C-TUB-QIN': 0.6, 'C-TUB-ROT': 0.6 } },
  { from: 100, to: 106, label: 'Drought restricts the Panama Canal', closed: ['panama'] },
];

/** A bunker price path: a mean-reverting random walk around the baseline, $/t. */
export function bunkerPath(months: number, seed: number): number[] {
  const r = rng(seed * 31 + 5);
  const out: number[] = [];
  let x = 0;
  for (let t = 0; t < months; t++) {
    x = 0.95 * x + 0.055 * gaussian(r);
    out.push(Math.round(Math.min(950, Math.max(380, BASE_BUNKER * Math.exp(x)))));
  }
  return out;
}

export interface History {
  months: number;
  bunker: number[];
  events: CycleEvent[];
  cls: Record<ClassId, CycleMonth[]>;
}

const CACHE = new Map<number, History>();

/** The course's history (memoized), or another draw with a different seed. */
export function standardHistory(seed = HISTORY_SEED): History {
  const hit = CACHE.get(seed);
  if (hit) return hit;
  const bunker = bunkerPath(HISTORY_MONTHS, seed);
  const base = { ...DEFAULT_CYCLE, months: HISTORY_MONTHS, seed, bunker, events: HISTORY_EVENTS };
  const h: History = {
    months: HISTORY_MONTHS,
    bunker,
    events: HISTORY_EVENTS,
    cls: {
      kmax: simulateCycle('kmax', { ...base, growth: 0.025 }),
      cape: simulateCycle('cape', { ...base, growth: 0.02 }),
    },
  };
  CACHE.set(seed, h);
  return h;
}

/** "Year 3, March" for a month index. */
export function monthLabel(t: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `Year ${Math.floor(t / 12) + 1}, ${names[t % 12]}`;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
