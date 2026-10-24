// Freight benchmarks: daily route assessments and timecharter indices built from the simulated
// history, the way the Baltic Exchange builds its published indices from shipbrokers' panel
// assessments. Our indices are illustrative and simulated; they are not the Baltic's.
//
// The underlying market moves month by month (the cycle model). Within a month, the day-to-day
// rate wanders around that path with persistent noise — the effect of which ships happen to be
// open and which cargoes happen to be quoting that day. Each panelist then reports the day's rate
// with a small error of their own, and the published assessment averages the panel.

import { gaussian, rng } from '../../model/random';
import { tripTce, type Equilibrium } from './market';
import type { CycleMonth } from './cycle';
import { standardHistory } from '../../model/shipping/history';
import type { ClassId } from '../../model/shipping/trades';

/** Business days in each month of the history (weekdays). Index days are numbered from 0. */
export const DAYS_PER_MONTH = 21;

export interface TcRoute {
  id: string;
  name: string;
  /** Where the ship is delivered and redelivered, as positional values in the month's ballast plan. */
  from: { port: string; kind: 'open' | 'ready' };
  to: { port: string; kind: 'open' | 'ready' };
  /** Trip length, days. */
  days: number;
}

/** Timecharter routes for each class: round voyages earn the market rate; trips that move a ship
 *  between basins earn more or less by the change in her position. */
export const TC_ROUTES: Record<ClassId, TcRoute[]> = {
  cape: [
    { id: 'C-TA', name: 'Transatlantic round voyage', from: { port: 'ROT', kind: 'open' }, to: { port: 'ROT', kind: 'open' }, days: 40 },
    { id: 'C-FH', name: 'Fronthaul, Atlantic to China', from: { port: 'ROT', kind: 'open' }, to: { port: 'QIN', kind: 'open' }, days: 65 },
    { id: 'C-TP', name: 'Transpacific round voyage', from: { port: 'QIN', kind: 'open' }, to: { port: 'QIN', kind: 'open' }, days: 32 },
    { id: 'C-BR', name: 'China–Brazil round voyage', from: { port: 'QIN', kind: 'open' }, to: { port: 'QIN', kind: 'open' }, days: 82 },
    { id: 'C-BH', name: 'Backhaul, China to the Atlantic', from: { port: 'QIN', kind: 'open' }, to: { port: 'ROT', kind: 'open' }, days: 60 },
  ],
  kmax: [
    { id: 'P-TA', name: 'Transatlantic round voyage', from: { port: 'ROT', kind: 'open' }, to: { port: 'ROT', kind: 'open' }, days: 45 },
    { id: 'P-FH', name: 'Fronthaul, Atlantic to China', from: { port: 'ROT', kind: 'open' }, to: { port: 'QIN', kind: 'open' }, days: 60 },
    { id: 'P-TP', name: 'Transpacific round voyage', from: { port: 'QIN', kind: 'open' }, to: { port: 'QIN', kind: 'open' }, days: 30 },
    { id: 'P-BH', name: 'Backhaul, China to the Atlantic', from: { port: 'QIN', kind: 'open' }, to: { port: 'ROT', kind: 'open' }, days: 55 },
  ],
};

function posValue(m: CycleMonth | Equilibrium, p: { port: string; kind: 'open' | 'ready' }): number {
  const open = 'open' in m ? m.open : (m as Equilibrium).plan.open;
  const ready = 'ready' in m ? m.ready : (m as Equilibrium).plan.ready;
  return (p.kind === 'open' ? open[p.port] : ready[p.port]) ?? 0;
}

/** A timecharter route's earnings in a month of the history, $/day. */
export function routeTce(m: CycleMonth, r: TcRoute): number {
  return m.tce + (m.ballastMileCost * (posValue(m, r.from) - posValue(m, r.to))) / r.days;
}

/** The same for a single equilibrium. */
export function routeTceAt(eq: Equilibrium, r: TcRoute): number {
  return tripTce(eq, posValue(eq, r.from), posValue(eq, r.to), r.days);
}

export interface DailyPath {
  /** Index day → month. */
  month: number[];
  /** The market's underlying daily earnings, $/day. */
  tce: number[];
  /** Day-to-day deviation factor (multiplicative), shared by every route of the class. */
  noise: number[];
}

const PATH_CACHE = new Map<string, DailyPath>();

/**
 * Daily earnings: the monthly path interpolated between month midpoints, times persistent
 * day-to-day noise. Deterministic for a class and seed.
 */
export function dailyPath(id: ClassId, seed = 101, months: CycleMonth[] = standardHistory().cls[id]): DailyPath {
  const key = `${id}|${seed}|${months.length}|${months[0]?.tce}`;
  const hit = PATH_CACHE.get(key);
  if (hit) return hit;
  const r = rng(seed + (id === 'cape' ? 7 : 0));
  const n = months.length * DAYS_PER_MONTH;
  const month: number[] = [];
  const tce: number[] = [];
  const noise: number[] = [];
  let x = 0;
  const persistence = 0.9;
  const sd = id === 'cape' ? 0.09 : 0.06;
  const innov = sd * Math.sqrt(1 - persistence * persistence);
  for (let d = 0; d < n; d++) {
    const mf = (d + 0.5) / DAYS_PER_MONTH - 0.5;
    const m0 = Math.max(0, Math.min(months.length - 1, Math.floor(mf)));
    const m1 = Math.min(months.length - 1, m0 + 1);
    const k = Math.max(0, Math.min(1, mf - m0));
    const base = months[m0].tce * (1 - k) + months[m1].tce * k;
    x = persistence * x + innov * gaussian(r);
    month.push(Math.floor(d / DAYS_PER_MONTH));
    noise.push(Math.exp(x));
    tce.push(base * Math.exp(x));
  }
  const p = { month, tce, noise };
  PATH_CACHE.set(key, p);
  return p;
}

export interface PanelOptions {
  panelists: number;
  /** Each panelist's typical error, as a share of the rate. */
  error: number;
  /** Drop the highest and lowest reports before averaging. */
  trim: boolean;
  seed: number;
}

/** Panelists' reports of a true value, and the published assessment. */
export function panelAssessment(truth: number, o: PanelOptions, day: number): { reports: number[]; published: number } {
  const r = rng(o.seed * 7919 + day * 104729);
  const reports = Array.from({ length: Math.max(1, o.panelists) }, () => truth * (1 + o.error * gaussian(r)));
  const sorted = [...reports].sort((a, b) => a - b);
  const used = o.trim && sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return { reports, published: used.reduce((a, b) => a + b, 0) / used.length };
}

/** A weighted average of route assessments. Weights needn't sum to one. */
export function weightedIndex(values: number[], weights: number[]): number {
  const w = weights.reduce((a, b) => a + b, 0);
  return w > 0 ? values.reduce((s, v, i) => s + v * weights[i], 0) / w : NaN;
}

/** The average of an index over the index days of a month (how most FFAs settle). */
export function monthAverage(series: number[], month: number): number {
  const s = series.slice(month * DAYS_PER_MONTH, (month + 1) * DAYS_PER_MONTH);
  return s.reduce((a, b) => a + b, 0) / s.length;
}
