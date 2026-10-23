// Strategy engine: P&L statistics and walk-forward backtesting.

/** Running total of a P&L series. */
export function equityCurve(pnl: number[], start = 0): number[] {
  let s = start;
  return pnl.map((p) => (s += p));
}

/** Largest peak-to-trough fall of the running total. */
export function maxDrawdown(pnl: number[]): { drawdown: number; peak: number; trough: number } {
  let eq = 0;
  let peakEq = 0;
  let peakIdx = -1;
  let best = { drawdown: 0, peak: -1, trough: -1 };
  pnl.forEach((p, i) => {
    eq += p;
    if (eq > peakEq) {
      peakEq = eq;
      peakIdx = i;
    }
    const dd = peakEq - eq;
    if (dd > best.drawdown) best = { drawdown: dd, peak: peakIdx, trough: i };
  });
  return best;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Annualized Sharpe ratio of a per-period P&L series (no risk-free rate). */
export function sharpe(pnl: number[], periodsPerYear = 365): number {
  const sd = stdev(pnl);
  return sd > 0 ? (mean(pnl) / sd) * Math.sqrt(periodsPerYear) : 0;
}

/** Historical value at risk: the loss exceeded on only (1 − q) of periods. Positive number. */
export function valueAtRisk(pnl: number[], q = 0.95): number {
  if (!pnl.length) return 0;
  const sorted = [...pnl].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - q) * sorted.length)));
  return Math.max(0, -sorted[idx]);
}

export interface PnlSummary {
  total: number;
  mean: number;
  stdev: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  best: number;
  worst: number;
  var95: number;
}

export function summarize(pnl: number[], periodsPerYear = 365): PnlSummary {
  return {
    total: pnl.reduce((s, x) => s + x, 0),
    mean: mean(pnl),
    stdev: stdev(pnl),
    sharpe: sharpe(pnl, periodsPerYear),
    maxDrawdown: maxDrawdown(pnl).drawdown,
    winRate: pnl.length ? pnl.filter((x) => x > 0).length / pnl.length : 0,
    best: pnl.length ? Math.max(...pnl) : 0,
    worst: pnl.length ? Math.min(...pnl) : 0,
    var95: valueAtRisk(pnl, 0.95),
  };
}

export interface WalkForwardOptions<D> {
  data: D[];
  /** Periods of history each decision may look at. */
  window: number;
  /** Decide today's positions from the trailing window only (no peeking at today's outcome). */
  decide: (history: D[], today: D) => number[];
  /** P&L of those positions once today's outcome is known. */
  settle: (positions: number[], today: D) => number;
}

/**
 * Walk-forward backtest: for each period after the first `window`, decide using only the past,
 * then settle against what actually happened.
 */
export function walkForward<D>({ data, window, decide, settle }: WalkForwardOptions<D>) {
  const pnl: number[] = [];
  const positions: number[][] = [];
  for (let i = window; i < data.length; i++) {
    const pos = decide(data.slice(i - window, i), data[i]);
    positions.push(pos);
    pnl.push(settle(pos, data[i]));
  }
  return { pnl, positions, firstIndex: window };
}
