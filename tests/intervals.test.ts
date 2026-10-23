import { describe, expect, it } from 'vitest';
import type { OriginEvaluation } from '../src/forecast/evaluate.js';
import {
  calibrationFactor,
  coverageReport,
  intervalBounds,
  inverseNormalCdf,
} from '../src/forecast/intervals.js';

const evaluation = (actual: number[], centre: number): OriginEvaluation => ({
  trainWeeks: 50,
  kind: 'rolling',
  firstTestWeek: '2021-01-04',
  actual,
  forecast: actual.map(() => centre),
  interval: {
    mean: actual.map(() => centre),
    intervalCentre: actual.map(() => centre),
    intervalSigma: actual.map(() => 10),
    intervalScale: 'none',
  },
  metrics: { wape: 0, mae: 0, bias: 0, count: actual.length },
});

describe('intervals', () => {
  it('inverse normal CDF matches known quantiles', () => {
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 9);
    expect(inverseNormalCdf(0.01)).toBeCloseTo(-2.326348, 5);
  });

  it('bounds contain the point forecast and widen with the horizon on the log scale', () => {
    const { lower, upper } = intervalBounds(
      {
        mean: [1000, 1000],
        intervalCentre: [Math.log1p(1000), Math.log1p(1000)],
        intervalSigma: [0.1, 0.1 * Math.sqrt(10)],
        intervalScale: 'log',
      },
      0.75,
    );
    expect(lower[0]).toBeLessThan(1000);
    expect(upper[0]).toBeGreaterThan(1000);
    expect(upper[1] - lower[1]).toBeGreaterThan(upper[0] - lower[0]);
    // Multiplicative on the original scale.
    expect(upper[0] / 1000).toBeCloseTo(1000 / lower[0], 1);
  });

  it('never goes below zero', () => {
    const { lower } = intervalBounds(
      { mean: [5], intervalCentre: [5], intervalSigma: [100], intervalScale: 'none' },
      0.9,
    );
    expect(lower[0]).toBe(0);
  });

  it('calibration factor scales σ to the empirical error quantile', () => {
    // Errors of 5 with σ = 10: standardised errors 0.5, so c = 0.5 / z(0.875).
    const evaluations = [evaluation([105, 95, 105, 95], 100)];
    expect(calibrationFactor(evaluations, 0.75)).toBeCloseTo(0.5 / inverseNormalCdf(0.875), 9);
  });

  it('reports leave-one-origin-out coverage between 0 and 1', () => {
    const report = coverageReport(
      [evaluation([105, 95, 120], 100), evaluation([101, 99, 130], 100), evaluation([110, 90, 100], 100)],
      0.75,
    );
    expect(report.count).toBe(9);
    expect(report.calibrated).toBeGreaterThanOrEqual(0);
    expect(report.calibrated).toBeLessThanOrEqual(1);
    expect(report.raw).toBeGreaterThanOrEqual(0);
  });
});
