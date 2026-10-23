import { describe, expect, it } from 'vitest';
import { choleskySolve, gaussSolve, solveSymmetric, weightedRidge } from '../src/forecast/linalg.js';

describe('linear solvers', () => {
  // 2x + y - z = 8, -3x - y + 2z = -11, -2x + y + 2z = -3  =>  (2, 3, -1)
  const A = [
    [2, 1, -1],
    [-3, -1, 2],
    [-2, 1, 2],
  ];
  const b = [8, -11, -3];

  it('Gauss with partial pivoting solves a known system', () => {
    const x = gaussSolve(A, b);
    [2, 3, -1].forEach((v, i) => expect(x[i]).toBeCloseTo(v, 9));
  });

  it('Cholesky solves a known symmetric positive definite system', () => {
    const S = [
      [4, 12, -16],
      [12, 37, -43],
      [-16, -43, 98],
    ];
    const x = choleskySolve(S, [1, 2, 3]);
    expect(x).not.toBeNull();
    // S x must reproduce the right-hand side.
    S.forEach((row, i) =>
      expect(row.reduce((s, v, j) => s + v * (x as number[])[j], 0)).toBeCloseTo([1, 2, 3][i], 9),
    );
  });

  it('Cholesky reports failure for an indefinite matrix', () => {
    expect(
      choleskySolve(
        [
          [1, 2],
          [2, 1],
        ],
        [1, 1],
      ),
    ).toBeNull();
  });

  it('singular matrix does not throw and returns finite values', () => {
    const singular = [
      [1, 2],
      [2, 4],
    ];
    const x = solveSymmetric(singular, [3, 6]);
    expect(x.every(Number.isFinite)).toBe(true);
    const zero = solveSymmetric(
      [
        [0, 0],
        [0, 0],
      ],
      [0, 0],
    );
    expect(zero).toEqual([0, 0]);
  });
});

describe('weightedRidge', () => {
  it('recovers (1, 2) from points on y = 2x + 1 without penalty on a, b', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const X = xs.map((x) => [1, x]);
    const y = xs.map((x) => 2 * x + 1);
    const beta = weightedRidge(
      X,
      y,
      xs.map(() => 1),
      [0, 0],
    );
    expect(beta[0]).toBeCloseTo(1, 6);
    expect(beta[1]).toBeCloseTo(2, 6);
  });

  it('ignores observations with zero weight', () => {
    const X = [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ];
    const y = [1, 3, 1000, 7];
    const beta = weightedRidge(X, y, [1, 1, 0, 1], [0, 0]);
    expect(beta[0]).toBeCloseTo(1, 6);
    expect(beta[1]).toBeCloseTo(2, 6);
  });

  it('shrinks a penalised coefficient towards its prior mean', () => {
    const X = [
      [1, 1],
      [1, 1],
    ];
    const beta = weightedRidge(X, [5, 5], [1, 1], [0, 1e8], [0, 3]);
    expect(beta[1]).toBeCloseTo(3, 4);
    expect(beta[0]).toBeCloseTo(2, 4);
  });
});
