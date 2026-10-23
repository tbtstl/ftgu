// A small dense two-phase simplex solver. Problems in this course have at most a few hundred
// variables and constraints, so clarity beats speed.
//
//   minimize   c·x
//   subject to A x (≤ | ≥ | =) b,   0 ≤ x ≤ ub

export type Sense = '<=' | '>=' | '=';

export interface LinearProgram {
  c: number[];
  A: number[][];
  b: number[];
  sense: Sense[];
  /** Upper bounds per variable (Infinity for none). */
  ub?: number[];
}

export interface LPSolution {
  status: 'optimal' | 'infeasible' | 'unbounded';
  x: number[];
  objective: number;
}

const EPS = 1e-9;

export function solveLP(lp: LinearProgram): LPSolution {
  const n = lp.c.length;
  type Row = { a: number[]; b: number; s: Sense };
  const rows: Row[] = lp.A.map((a, i) => ({ a: Array.from({ length: n }, (_, j) => a[j] ?? 0), b: lp.b[i], s: lp.sense[i] }));
  lp.ub?.forEach((u, j) => {
    if (Number.isFinite(u)) {
      const a = Array<number>(n).fill(0);
      a[j] = 1;
      rows.push({ a, b: u, s: '<=' });
    }
  });
  for (const r of rows) {
    if (r.b < 0) {
      r.a = r.a.map((v) => -v);
      r.b = -r.b;
      r.s = r.s === '<=' ? '>=' : r.s === '>=' ? '<=' : '=';
    }
  }

  const nSlack = rows.filter((r) => r.s !== '=').length;
  const nArt = rows.filter((r) => r.s !== '<=').length;
  const N = n + nSlack + nArt;
  const T: number[][] = [];
  const basis: number[] = [];
  let si = n;
  let ai = n + nSlack;
  for (const r of rows) {
    const row = Array<number>(N + 1).fill(0);
    for (let j = 0; j < n; j++) row[j] = r.a[j];
    row[N] = r.b;
    if (r.s === '<=') {
      row[si] = 1;
      basis.push(si++);
    } else if (r.s === '>=') {
      row[si++] = -1;
      row[ai] = 1;
      basis.push(ai++);
    } else {
      row[ai] = 1;
      basis.push(ai++);
    }
    T.push(row);
  }
  const isArt = (j: number) => j >= n + nSlack;

  if (nArt > 0) {
    const c1 = Array<number>(N).fill(0);
    for (let j = n + nSlack; j < N; j++) c1[j] = 1;
    iterate(T, basis, c1, N, () => true);
    const infeas = basis.reduce((s, bj, i) => s + c1[bj] * T[i][N], 0);
    const scale = Math.max(1, ...rows.map((r) => Math.abs(r.b)));
    if (infeas > 1e-7 * scale) return { status: 'infeasible', x: Array(n).fill(0), objective: NaN };
    // Drive any artificial still in the basis (at zero) out, or drop its redundant row.
    for (let i = 0; i < T.length; i++) {
      if (!isArt(basis[i])) continue;
      let col = -1;
      for (let j = 0; j < n + nSlack; j++) {
        if (Math.abs(T[i][j]) > 1e-8) {
          col = j;
          break;
        }
      }
      if (col >= 0) pivot(T, basis, i, col, N);
      else {
        T.splice(i, 1);
        basis.splice(i, 1);
        i--;
      }
    }
  }

  const c2 = Array<number>(N).fill(0);
  for (let j = 0; j < n; j++) c2[j] = lp.c[j];
  const status = iterate(T, basis, c2, N, (j) => !isArt(j));
  if (status === 'unbounded') return { status, x: Array(n).fill(0), objective: -Infinity };

  const x = Array<number>(n).fill(0);
  basis.forEach((bj, i) => {
    if (bj < n) x[bj] = Math.abs(T[i][N]) < EPS ? 0 : T[i][N];
  });
  return { status: 'optimal', x, objective: lp.c.reduce((s, cj, j) => s + cj * x[j], 0) };
}

function pivot(T: number[][], basis: number[], r: number, c: number, N: number) {
  const pr = T[r];
  const p = pr[c];
  for (let j = 0; j <= N; j++) pr[j] /= p;
  for (let i = 0; i < T.length; i++) {
    if (i === r) continue;
    const row = T[i];
    const f = row[c];
    if (Math.abs(f) < 1e-15) continue;
    for (let j = 0; j <= N; j++) row[j] -= f * pr[j];
  }
  basis[r] = c;
}

/** Primal simplex: Dantzig's rule, switching to Bland's rule if it stalls on degenerate pivots. */
function iterate(T: number[][], basis: number[], cost: number[], N: number, allowed: (j: number) => boolean): 'optimal' | 'unbounded' {
  let degenerate = 0;
  for (let iter = 0; iter < 20000; iter++) {
    const inBasis = new Set(basis);
    const bland = degenerate > 30;
    let enter = -1;
    let best = -EPS;
    for (let j = 0; j < N; j++) {
      if (!allowed(j) || inBasis.has(j)) continue;
      let r = cost[j];
      for (let i = 0; i < T.length; i++) r -= cost[basis[i]] * T[i][j];
      if (r < best) {
        enter = j;
        best = r;
        if (bland) break;
      }
    }
    if (enter < 0) return 'optimal';
    let leave = -1;
    let ratio = Infinity;
    for (let i = 0; i < T.length; i++) {
      const a = T[i][enter];
      if (a > EPS) {
        const q = T[i][N] / a;
        if (q < ratio - 1e-12 || (Math.abs(q - ratio) <= 1e-12 && leave >= 0 && basis[i] < basis[leave])) {
          ratio = q;
          leave = i;
        }
      }
    }
    if (leave < 0) return 'unbounded';
    degenerate = ratio < 1e-12 ? degenerate + 1 : 0;
    pivot(T, basis, leave, enter, N);
  }
  return 'optimal';
}
