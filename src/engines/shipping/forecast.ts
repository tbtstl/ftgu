// Forecasting freight from fundamentals: project the fleet and the cargo, then clear the market
// month by month with the same equilibrium that produced the history.
//
// Supply is the easy half. Ships take years to build, so the orderbook already says how many will
// arrive; only scrapping is a guess. Demand is the hard half: the forecaster assumes a growth rate
// and how quickly today's surprise (cargo above or below its trend) fades away.

import type { Chokepoint } from '../../model/shipping/geo';
import { BASE_BUNKER, type ClassId } from '../../model/shipping/trades';
import type { CycleMonth } from './cycle';
import { equilibrium } from './market';

export interface ForecastAssumptions {
  /** Annual growth of cargo volumes the forecaster expects. */
  growth: number;
  /** How much of today's deviation from trend survives each month (0 = gone next month, 1 = permanent). */
  shockFade: number;
  /** Ships scrapped each month, as a share of the fleet. */
  scrapping: number;
  /** Whether the orderbook's ships are counted as they deliver. */
  deliveries: boolean;
  /** Extra waiting days per call at ports. */
  congestion?: Record<string, number>;
  closed?: Chokepoint[];
  /** Bunker price assumed for the whole forecast, $/t (default: the price at the forecast date). */
  bunker?: number;
}

export const DEFAULT_ASSUMPTIONS: ForecastAssumptions = { growth: 0.025, shockFade: 0.94, scrapping: 0.002, deliveries: true };

export interface ForecastMonth {
  t: number;
  tce: number;
  fleet: number;
  demand: number;
  /** What actually happened, if the history reaches that far. */
  actual?: number;
}

/** Age-band shares of the fleet at a month of the history. */
export function sharesAt(m: CycleMonth): number[] {
  const bands = [0, 0, 0, 0, 0];
  const total = m.ages.reduce((a, b) => a + b, 0);
  m.ages.forEach((c, a) => {
    bands[Math.min(4, Math.floor(a / 5))] += c / total;
  });
  return bands;
}

/**
 * A forecast made at month `t` of a history for the next `horizon` months. Deliveries come from
 * the orderbook as it stood at `t` (spread evenly within each year of delivery).
 */
export function forecastPath(id: ClassId, hist: CycleMonth[], t: number, horizon: number, a: ForecastAssumptions): ForecastMonth[] {
  const now = hist[t];
  const shares = sharesAt(now);
  // Separate today's demand into the assumed trend and a deviation.
  const trendNow = (1 + a.growth) ** (t / 12);
  const dev = Math.log(now.demand / trendNow);
  const out: ForecastMonth[] = [];
  let fleet = now.fleet;
  for (let k = 1; k <= horizon; k++) {
    const year = Math.min(3, Math.floor((k - 1) / 12));
    const delivered = a.deliveries ? (now.bookByYear[year] ?? 0) / 12 : 0;
    fleet = fleet * (1 - a.scrapping) + delivered;
    const demand = (1 + a.growth) ** ((t + k) / 12) * Math.exp(dev * a.shockFade ** k);
    const eq = equilibrium(id, {
      demand,
      month: (t + k) % 12,
      fleet,
      bunker: a.bunker ?? now.bunker ?? BASE_BUNKER,
      congestion: a.congestion,
      closed: a.closed,
      cohortShares: shares,
    });
    out.push({ t: t + k, tce: eq.tce, fleet, demand, actual: hist[t + k]?.tce });
  }
  return out;
}

/** Mean absolute percentage error of a forecast against the history (months the history covers). */
export function forecastError(path: ForecastMonth[]): number {
  const known = path.filter((p) => p.actual !== undefined);
  if (!known.length) return NaN;
  return known.reduce((s, p) => s + Math.abs(p.tce / (p.actual as number) - 1), 0) / known.length;
}
