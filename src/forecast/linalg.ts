// Minimal dense linear algebra: just enough for weighted ridge regression via normal equations.

export type Matrix = number[][];
export type Vector = number[];

const PIVOT_EPS = 1e-12;

/** Solves S x = b for symmetric positive definite S; returns null when S is not positive definite. */
export function choleskySolve(S: Matrix, b: Vector): Vector | null {
  const n = b.length;
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const scale = Math.max(...S.map((row, i) => Math.abs(row[i])), 1);
  for (let j = 0; j < n; j++) {
    let diag = S[j][j];
    for (let k = 0; k < j; k++) diag -= L[j][k] ** 2;
    if (!(diag > PIVOT_EPS * scale)) return null;
    const ljj = Math.sqrt(diag);
    L[j][j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let sum = S[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      L[i][j] = sum / ljj;
    }
  }
  // Forward substitution L y = b, then back substitution Lᵀ x = y.
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/**
 * Gaussian elimination with partial pivoting. A (near) zero pivot means the variable is not
 * identified; it is set to 0 instead of dividing by zero, so singular systems return finite values.
 */
export function gaussSolve(A: Matrix, b: Vector): Vector {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const scale = Math.max(...A.flat().map(Math.abs), 1);
  const pivotOfColumn = new Array<number>(n).fill(-1);
  let row = 0;
  for (let col = 0; col < n && row < n; col++) {
    let best = row;
    for (let i = row + 1; i < n; i++) if (Math.abs(M[i][col]) > Math.abs(M[best][col])) best = i;
    if (Math.abs(M[best][col]) <= PIVOT_EPS * scale) continue;
    [M[row], M[best]] = [M[best], M[row]];
    for (let i = row + 1; i < n; i++) {
      const factor = M[i][col] / M[row][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) M[i][k] -= factor * M[row][k];
    }
    pivotOfColumn[col] = row;
    row++;
  }
  const x = new Array<number>(n).fill(0);
  for (let col = n - 1; col >= 0; col--) {
    const r = pivotOfColumn[col];
    if (r < 0) continue;
    let sum = M[r][n];
    for (let k = col + 1; k < n; k++) sum -= M[r][k] * x[k];
    x[col] = sum / M[r][col];
  }
  return x;
}

/** Solves a symmetric system: Cholesky first, Gauss with pivoting as a fallback. */
export function solveSymmetric(S: Matrix, b: Vector): Vector {
  return choleskySolve(S, b) ?? gaussSolve(S, b);
}

/**
 * Weighted ridge regression: solves (XᵀWX + Λ) β = XᵀWy + Λμ, where Λ = diag(penalties) and μ is
 * the prior mean of each coefficient (default 0). A tiny jitter keeps the system well posed.
 */
export function weightedRidge(
  X: Matrix,
  y: Vector,
  weights: Vector,
  penalties: Vector,
  priorMeans?: Vector,
): Vector {
  const p = penalties.length;
  const XtWX: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const XtWy = new Array<number>(p).fill(0);
  for (let r = 0; r < X.length; r++) {
    const w = weights[r];
    if (w === 0) continue;
    const row = X[r];
    const wy = w * y[r];
    for (let i = 0; i < p; i++) {
      const wxi = w * row[i];
      if (wxi === 0) continue;
      XtWy[i] += row[i] * wy;
      const target = XtWX[i];
      for (let j = i; j < p; j++) target[j] += wxi * row[j];
    }
  }
  const trace = XtWX.reduce((s, row, i) => s + row[i], 0);
  const jitter = 1e-9 * Math.max(trace / Math.max(p, 1), 1e-12);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < i; j++) XtWX[i][j] = XtWX[j][i];
    XtWX[i][i] += penalties[i] + jitter;
    XtWy[i] += penalties[i] * (priorMeans?.[i] ?? 0);
  }
  return solveSymmetric(XtWX, XtWy);
}

export function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
