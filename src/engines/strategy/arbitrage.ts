// Strategy engine: optimal battery scheduling against known prices, by dynamic programming
// over a grid of state-of-charge levels.

export interface ArbitrageBattery {
  powerMW: number;
  energyMWh: number;
  /** Round-trip efficiency, 0–1 (split evenly between charge and discharge). */
  efficiency: number;
  /** Starting state of charge, 0–1. */
  soc0: number;
}

export interface ArbitrageOptions {
  /** Cost of wear per MWh discharged, $/MWh. */
  degradationPerMWh?: number;
  /** Hours per price interval (1 for hourly, 0.25 for 15-minute). */
  hoursPerStep?: number;
  /** State-of-charge levels in the search grid. */
  levels?: number;
  /** Must the battery end at least as full as it started? (Stops it selling its starting charge.) */
  endAtStart?: boolean;
}

export interface ArbitrageResult {
  /** MW per interval: + discharging, − charging. */
  schedule: number[];
  /** State of charge at each interval boundary, MWh (length n + 1). */
  soc: number[];
  /** Market revenue minus charging cost, $. */
  revenue: number;
  degradationCost: number;
  profit: number;
  /** Energy discharged, MWh. */
  dischargedMWh: number;
  /** Equivalent full cycles. */
  cycles: number;
}

export function optimizeArbitrage(prices: number[], b: ArbitrageBattery, opts: ArbitrageOptions = {}): ArbitrageResult {
  const L = opts.levels ?? 41;
  const h = opts.hoursPerStep ?? 1;
  const deg = opts.degradationPerMWh ?? 0;
  const eta = Math.sqrt(Math.max(1e-6, b.efficiency));
  const n = prices.length;
  const E = b.energyMWh;
  const lvl = (k: number) => (E * k) / (L - 1);
  const start = Math.round(b.soc0 * (L - 1));

  // Cash flow of moving from level i to level k during interval t.
  const flow = (t: number, i: number, k: number): number | null => {
    const dE = lvl(k) - lvl(i);
    if (dE > 0) {
      const grid = dE / eta;
      if (grid / h > b.powerMW + 1e-9) return null;
      return -prices[t] * grid;
    }
    if (dE < 0) {
      const grid = -dE * eta;
      if (grid / h > b.powerMW + 1e-9) return null;
      return prices[t] * grid - deg * grid;
    }
    return 0;
  };

  // value[t][i]: best cash from interval t onward, starting at level i.
  const value = Array.from({ length: n + 1 }, () => Array<number>(L).fill(-Infinity));
  const choice = Array.from({ length: n }, () => Array<number>(L).fill(0));
  for (let i = 0; i < L; i++) value[n][i] = opts.endAtStart === false || i >= start ? 0 : -Infinity;
  for (let t = n - 1; t >= 0; t--) {
    for (let i = 0; i < L; i++) {
      let best = -Infinity;
      let arg = i;
      for (let k = 0; k < L; k++) {
        if (value[t + 1][k] === -Infinity) continue;
        const f = flow(t, i, k);
        if (f === null) continue;
        const v = f + value[t + 1][k];
        if (v > best + 1e-9) {
          best = v;
          arg = k;
        }
      }
      value[t][i] = best;
      choice[t][i] = arg;
    }
  }

  const schedule: number[] = [];
  const soc = [lvl(start)];
  let i = start;
  let revenue = 0;
  let degradationCost = 0;
  let discharged = 0;
  for (let t = 0; t < n; t++) {
    const k = choice[t][i];
    const dE = lvl(k) - lvl(i);
    if (dE > 0) {
      const grid = dE / eta;
      schedule.push(-grid / h);
      revenue -= prices[t] * grid;
    } else if (dE < 0) {
      const grid = -dE * eta;
      schedule.push(grid / h);
      revenue += prices[t] * grid;
      degradationCost += deg * grid;
      discharged += grid;
    } else schedule.push(0);
    soc.push(lvl(k));
    i = k;
  }
  return { schedule, soc, revenue, degradationCost, profit: revenue - degradationCost, dischargedMWh: discharged, cycles: E > 0 ? discharged / (E * eta) : 0 };
}

/** Profit of an arbitrary schedule (MW per interval, + discharge) at the given prices. */
export function scheduleValue(prices: number[], schedule: number[], hoursPerStep = 1, degradationPerMWh = 0): number {
  return schedule.reduce((s, mw, t) => s + prices[t] * mw * hoursPerStep - (mw > 0 ? degradationPerMWh * mw * hoursPerStep : 0), 0);
}
