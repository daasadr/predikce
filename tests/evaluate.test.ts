import { describe, expect, it } from 'vitest';
import { backtestOrigins, computeMetrics, runBacktest } from '../src/forecast/evaluate.js';
import { fitCandidate, NAIVE_CANDIDATES, regressionGrid } from '../src/forecast/selection.js';
import { buildWeeklySeries, toIso } from '../src/forecast/series.js';
import { DEFAULT_PARAMS } from '../src/forecast/types.js';
import { loadSampleData } from './fixtures.js';

const settings = { horizonWeeks: 10, backtestOrigins: 4, backtestStep: 13, minTrainWeeks: 26 };

describe('metrics', () => {
  it('actual [100, 200] and forecast [90, 230] give MAE 20 and WAPE 13.33 %', () => {
    const m = computeMetrics([100, 200], [90, 230])!;
    expect(m.mae).toBe(20);
    expect(m.wape).toBeCloseTo(13.333, 3);
    expect(m.bias).toBeCloseTo(6.667, 3);
  });

  it('skips missing actuals and handles an all-zero window', () => {
    expect(computeMetrics([null, 100], [5, 110])!.mae).toBe(10);
    expect(computeMetrics([null], [1])).toBeNull();
    expect(computeMetrics([0, 0], [0, 0])!.wape).toBe(0);
    expect(Number.isFinite(computeMetrics([0, 0], [3, 1])!.wape)).toBe(true);
  });
});

describe('backtest origins', () => {
  it('includes the latest, rolling and seasonal origins for the sample data', () => {
    const { series } = buildWeeklySeries(loadSampleData());
    const origins = backtestOrigins(series.values.length, settings);
    const weeks = origins.map((o) => toIso(series.times[o.trainWeeks]).slice(0, 10));
    expect(weeks[0]).toBe('2021-04-19');
    expect(weeks).toContain('2020-06-29');
    expect(weeks).toContain('2019-07-01');
    expect(origins.every((o) => o.trainWeeks >= 26)).toBe(true);
    expect(origins).toHaveLength(7);
  });

  it('has no origin without min_train_weeks of history', () => {
    expect(backtestOrigins(26, settings)).toEqual([]);
    // 30 weeks: the latest window is shortened to keep 26 training weeks.
    expect(backtestOrigins(30, settings)).toEqual([{ trainWeeks: 26, kind: 'latest' }]);
  });
});

describe('no look-ahead', () => {
  it('changing data after an origin does not change the forecast from that origin', () => {
    const data = loadSampleData();
    const { series } = buildWeeklySeries(data);
    const tampered = buildWeeklySeries(
      data.map((p, i) => (i >= 100 ? { ...p, value: p.value * 3 + 1000 } : p)),
    ).series;
    const origins = [{ trainWeeks: 100, kind: 'rolling' as const }];
    const candidates = [...NAIVE_CANDIDATES, ...regressionGrid(DEFAULT_PARAMS, series.values.length, [])];
    for (const candidate of candidates.slice(0, 8)) {
      const fit = (train: typeof series, h: number) => fitCandidate(candidate, train, h);
      const a = runBacktest(series, origins, 10, fit);
      const b = runBacktest(tampered, origins, 10, fit);
      expect(b.origins[0].forecast).toEqual(a.origins[0].forecast);
      expect(b.origins[0].actual).not.toEqual(a.origins[0].actual);
    }
  });
});
