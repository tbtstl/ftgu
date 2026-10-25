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
  { from: 100, to: 106, label: 'Drought closes the Panama Canal', closed: ['panama'] },
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

export interface HistoryOverrides {
  seed?: number;
  /** Apply the trades' seasons (default true). */
  seasonal?: boolean;
  /** Include the three disruptions (default true). */
  events?: boolean;
  lag?: number;
  orderResponse?: number;
  shock?: number;
}

const CUSTOM = new Map<string, History>();

/**
 * Another history the model could have produced: a different draw of shocks, or the same draw with
 * some of the world changed. Memoized; about 20–30 ms to build.
 */
export function historyWith(o: HistoryOverrides): History {
  const key = JSON.stringify(o);
  const hit = CUSTOM.get(key);
  if (hit) return hit;
  const seed = o.seed ?? HISTORY_SEED;
  const bunker = bunkerPath(HISTORY_MONTHS, seed);
  const events = o.events === false ? [] : HISTORY_EVENTS;
  const base = {
    ...DEFAULT_CYCLE,
    months: HISTORY_MONTHS,
    seed,
    bunker,
    events,
    seasonal: o.seasonal ?? true,
    lag: o.lag ?? DEFAULT_CYCLE.lag,
    orderResponse: o.orderResponse ?? DEFAULT_CYCLE.orderResponse,
    shock: o.shock ?? DEFAULT_CYCLE.shock,
  };
  const h: History = {
    months: HISTORY_MONTHS,
    bunker,
    events,
    cls: { kmax: simulateCycle('kmax', { ...base, growth: 0.025 }), cape: simulateCycle('cape', { ...base, growth: 0.02 }) },
  };
  if (CUSTOM.size > 40) CUSTOM.clear();
  CUSTOM.set(key, h);
  return h;
}

/** The disruption under way in a month of the history, if any. */
export function eventAt(t: number, events: CycleEvent[] = HISTORY_EVENTS): CycleEvent | undefined {
  return events.find((e) => t >= e.from && t < e.to);
}

/** "Year 3, March" for a month index. */
export function monthLabel(t: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `Year ${Math.floor(t / 12) + 1}, ${names[t % 12]}`;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
