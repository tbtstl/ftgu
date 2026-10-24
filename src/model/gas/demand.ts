// Who burns the region's gas, and what it's worth to them. Each place's demand on a day is a set of
// blocks, each with a quantity (Bcf/d, set by the weather) and a value ($/MMBtu): the price above
// which that use would stop. Homes and businesses that heat with gas are protected and valued
// very highly; power plants burn more gas when it's cheap enough to beat coal (several blocks,
// for plants of different efficiency); some industry can switch fuels or shut down; the LNG
// terminal buys feed gas as long as overseas prices cover it. Illustrative, calibrated so that
// the reference days of Chapter 3 come out about right.

import type { DemandStep } from '../../engines/gas/network';
import { cdd, hdd } from './weather';
import type { GasNodeId } from './world';

/** Value of protected demand (homes, hospitals): only rationing stops it. */
export const PROTECTED_VALUE = 100;
/** Gas price above which Metro's gas-fired power plants would rather burn oil. */
export const OIL_SWITCH_VALUE = 15;
/** Coal-to-gas switching at Metro's power plants: a block of extra gas burn at each price. */
export const COAL_SWITCH_BLOCKS: Array<{ bcfd: number; value: number }> = [
  { bcfd: 0.05, value: 5.0 },
  { bcfd: 0.05, value: 4.5 },
  { bcfd: 0.05, value: 4.0 },
  { bcfd: 0.05, value: 3.5 },
  { bcfd: 0.05, value: 3.0 },
  { bcfd: 0.05, value: 2.5 },
];
/** What the LNG terminal's feed gas is worth by default: the highest Calder price at which cargoes still pay (simulated). */
export const LNG_VALUE = 6.5;

export interface DemandOptions {
  /** Value of Bayport's LNG feed gas, $/MMBtu. */
  lngValue?: number;
  /** LNG feed-gas capacity in use, Bcf/d. */
  lngBcfd?: number;
  /** Multiplies every quantity (demand growth). */
  scale?: number;
}

/** The demand blocks at every place on a day with Metro's mean temperature at `tempF`. */
export function demandBlocks(tempF: number, opts: DemandOptions = {}): DemandStep[] {
  const h = hdd(tempF);
  const c = cdd(tempF);
  const k = opts.scale ?? 1;
  const b = (id: string, node: GasNodeId, bcfd: number, value: number): DemandStep => ({ id, node, cap: Math.max(0, bcfd * k), value });
  return [
    b('metro-homes', 'metro', 0.1 + 0.04 * h, PROTECTED_VALUE),
    b('metro-power', 'metro', 0.15 + 0.012 * c + 0.008 * h, OIL_SWITCH_VALUE),
    ...COAL_SWITCH_BLOCKS.map((x, i) => b(`metro-switch-${i}`, 'metro', x.bcfd, x.value)),
    b('metro-industry', 'metro', 0.2, 20),
    b('metro-interruptible', 'metro', 0.08, 8),
    b('calder-homes', 'calder', 0.12 + 0.0035 * h, PROTECTED_VALUE),
    b('bayport-homes', 'bayport', 0.002 * h, PROTECTED_VALUE),
    b('bayport-industry', 'bayport', 0.3, 20),
    b('bayport-flexible', 'bayport', 0.1, 5),
    { id: 'bayport-lng', node: 'bayport', cap: opts.lngBcfd ?? 1.2, value: opts.lngValue ?? LNG_VALUE },
    b('ridgeback-field', 'ridgeback', 0.1, PROTECTED_VALUE),
    b('sandhill-field', 'sandhill', 0.05, PROTECTED_VALUE),
  ];
}

/** Total demand at each place if every block were served, Bcf/d. */
export function demandByNode(tempF: number, opts: DemandOptions = {}): Record<GasNodeId, number> {
  const out: Record<GasNodeId, number> = { sandhill: 0, ridgeback: 0, calder: 0, metro: 0, bayport: 0 };
  for (const d of demandBlocks(tempF, opts)) out[d.node as GasNodeId] += d.cap;
  return out;
}

/** Sector of each block, for charts. */
export function sectorOf(id: string): 'homes' | 'power' | 'industry' | 'lng' | 'field' {
  if (id.includes('homes')) return 'homes';
  if (id.includes('power') || id.includes('switch')) return 'power';
  if (id.includes('lng')) return 'lng';
  if (id.includes('field')) return 'field';
  return 'industry';
}
