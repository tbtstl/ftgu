// Strategy engine: describing a sample — quantiles, summary statistics and histograms.
// Trading lessons use these to show how prices and P&L are distributed, not just their averages.

/** The q-quantile (0–1) of a sample, interpolating linearly between order statistics. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.max(0, Math.min(1, q)) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface Description {
  n: number;
  mean: number;
  median: number;
  q05: number;
  q25: number;
  q75: number;
  q95: number;
  min: number;
  max: number;
  stdev: number;
}

/** Summary statistics of a sample. An empty sample describes as all zeros. */
export function describe(xs: number[]): Description {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, median: 0, q05: 0, q25: 0, q75: 0, q95: 0, min: 0, max: 0, stdev: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const stdev = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    mean,
    median: quantile(xs, 0.5),
    q05: quantile(xs, 0.05),
    q25: quantile(xs, 0.25),
    q75: quantile(xs, 0.75),
    q95: quantile(xs, 0.95),
    min: Math.min(...xs),
    max: Math.max(...xs),
    stdev,
  };
}

export interface Histogram {
  /** Lower edge of the first bin and upper edge of the last. */
  lo: number;
  hi: number;
  /** Width of each bin. */
  width: number;
  /** Counts per bin; bin i covers [lo + i·width, lo + (i + 1)·width). */
  counts: number[];
  /** Values below lo and at or above hi, which the bins leave out. */
  below: number;
  above: number;
}

/** Counts of a sample in equal-width bins between lo and hi. Values outside are tallied separately. */
export function histogram(xs: number[], lo: number, hi: number, bins: number): Histogram {
  const nb = Math.max(1, Math.round(bins));
  const width = hi > lo ? (hi - lo) / nb : 1;
  const counts = Array<number>(nb).fill(0);
  let below = 0;
  let above = 0;
  for (const x of xs) {
    if (x < lo) below++;
    else if (x >= hi) above++;
    else counts[Math.min(nb - 1, Math.floor((x - lo) / width))]++;
  }
  return { lo, hi, width, counts, below, above };
}
