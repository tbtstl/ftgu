// Small plotting helpers. Charts are hand-built SVG in a fixed viewBox that scales to width.

export type Scale = ((x: number) => number) & { domain: [number, number]; range: [number, number] };

export function scale(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((x: number) => r0 + (x - d0) * k) as Scale;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

function n(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

/** "M x0 y0 L x1 y1 …" through the given points. */
export function linePath(xs: number[], ys: number[]): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) d += (i ? ' L' : 'M') + n(xs[i]) + ' ' + n(ys[i]);
  return d;
}

export function pointsPath(pts: Array<[number, number]>): string {
  return linePath(
    pts.map((p) => p[0]),
    pts.map((p) => p[1]),
  );
}

/** Closed band between an upper and a lower edge sharing the same xs. */
export function areaPath(xs: number[], upper: number[], lower: number[]): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) d += (i ? ' L' : 'M') + n(xs[i]) + ' ' + n(upper[i]);
  for (let i = xs.length - 1; i >= 0; i--) d += ' L' + n(xs[i]) + ' ' + n(lower[i]);
  return d + ' Z';
}

/** Horizontal steps centered on each x (for hourly prices). */
export function stepPath(xs: number[], ys: number[], half: number): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) {
    d += (i ? ' L' : 'M') + n(xs[i] - half) + ' ' + n(ys[i]) + ' L' + n(xs[i] + half) + ' ' + n(ys[i]);
  }
  return d;
}

/** Round, human tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Expands [min, max] outward to nice round numbers. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!(max > min)) return [min - 1, max + 1];
  const t = niceTicks(min, max, count);
  const step = t.length > 1 ? t[1] - t[0] : 1;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
