import { describe, expect, it } from 'vitest';
import { fitNaive } from '../src/forecast/models/naive.js';
import type { WeeklySeries } from '../src/forecast/series.js';

const series = (values: (number | null)[]): WeeklySeries => ({
  times: values.map((_, i) => i * 7 * 86_400_000),
  values,
  inputIndex: values.flatMap((v, i) => (v === null ? [] : [i])),
  missingCount: values.filter((v) => v === null).length,
});

describe('naive models', () => {
  it('naive_last repeats the last value', () => {
    const f = fitNaive('naive_last', series([100, 110, 120]), 3);
    expect(f.mean).toEqual([120, 120, 120]);
    expect(f.fitted).toEqual([100, 100, 110]);
  });

  it('naive_drift adds the average weekly change', () => {
    const f = fitNaive('naive_drift', series([100, 110, 120]), 2);
    expect(f.mean[0]).toBeCloseTo(130, 9);
    expect(f.mean[1]).toBeCloseTo(140, 9);
  });

  it('skips missing weeks and never goes below zero', () => {
    const f = fitNaive('naive_drift', series([300, 200, null, 100]), 5);
    expect(f.mean.every((v) => v >= 0)).toBe(true);
    // Drift (100 − 300) / 3 per week: 33.3 after one week, then clipped at zero.
    expect(f.mean[0]).toBeCloseTo(100 / 3, 9);
    expect(f.mean[1]).toBe(0);
    expect(f.fitted.every(Number.isFinite)).toBe(true);
  });

  it('interval sigma grows with the horizon', () => {
    const f = fitNaive('naive_last', series([100, 120, 90, 130, 100, 115]), 4);
    expect(f.intervalSigma[3]).toBeGreaterThan(f.intervalSigma[0]);
  });
});
