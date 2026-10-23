import { describe, expect, it } from 'vitest';
import { runForecast } from '../src/forecast/pipeline.js';
import { UnprocessableSeriesError } from '../src/forecast/types.js';
import { loadSampleData, weeklyPoints } from './fixtures.js';

const sample = loadSampleData();

const isWholeNonNegative = (v: number) => Number.isInteger(v) && v >= 0;

function expectClean(result: ReturnType<typeof runForecast>) {
  for (const p of result.data) {
    expect(isWholeNonNegative(p.value)).toBe(true);
    if (p.lower !== undefined) expect(isWholeNonNegative(p.lower) && p.lower <= p.value).toBe(true);
    if (p.upper !== undefined) expect(isWholeNonNegative(p.upper) && p.upper >= p.value).toBe(true);
  }
  expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
}

describe('runForecast on the sample data', () => {
  const result = runForecast(sample, [{ name: 'interval_width', value: 0.75 }]);

  it('returns 144 fitted and 10 forecast weeks from 2021-06-28 to 2021-08-30', () => {
    expect(result.data).toHaveLength(154);
    expect(result.data[0].timestamp).toBe('2018-09-24T00:00:00.000Z');
    expect(result.data[143].timestamp).toBe('2021-06-21T00:00:00.000Z');
    expect(result.data[144].timestamp).toBe('2021-06-28T00:00:00.000Z');
    expect(result.data[153].timestamp).toBe('2021-08-30T00:00:00.000Z');
    const times = result.data.map((p) => Date.parse(p.timestamp));
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true);
    expectClean(result);
  });

  it('adds lower and upper only to forecast weeks', () => {
    expect(result.data.slice(0, 144).some((p) => p.lower !== undefined)).toBe(false);
    expect(result.data.slice(144).every((p) => p.lower !== undefined && p.upper !== undefined)).toBe(true);
    expect(result.diagnostics.intervals?.coverage).toBeGreaterThan(0);
  });

  it('never selects a model worse than the naive baseline', () => {
    const { selected, baseline } = result.diagnostics.backtest;
    expect(selected!.mean_wape).toBeLessThanOrEqual(baseline!.mean_wape);
  });

  it('fills diagnostics', () => {
    const d = result.diagnostics;
    expect(d.model.id).toBeTruthy();
    expect(d.backtest.candidates.length).toBeGreaterThan(2);
    expect(d.backtest.selected!.per_origin.length).toBe(d.backtest.origins.length);
    expect(result.params.find((p) => p.name === 'horizon_weeks')?.value).toBe(10);
  });

  it('is deterministic', () => {
    const again = runForecast(sample, [{ name: 'interval_width', value: 0.75 }]);
    expect(again).toEqual(result);
  });

  it('gives the same result for unsorted input', () => {
    const shuffled = sample.map((p, i) => ({ p, k: (i * 7919) % sample.length })).sort((a, b) => a.k - b.k);
    expect(runForecast(shuffled.map((s) => s.p)).data).toEqual(runForecast(sample).data);
  });

  it('is scale independent: values ×10 give forecasts ×10', () => {
    const base = runForecast(sample);
    const scaled = runForecast(sample.map((p) => ({ ...p, value: p.value * 10 })));
    expect(scaled.diagnostics.model.id).toBe(base.diagnostics.model.id);
    base.data.slice(144).forEach((p, i) => {
      expect(scaled.data[144 + i].value / (10 * p.value) - 1).toBeCloseTo(0, 1);
      expect(Math.abs(scaled.data[144 + i].value / (10 * p.value) - 1)).toBeLessThan(0.02);
    });
  });

  it('reproduces the chosen model when the effective params are sent back', () => {
    const again = runForecast(sample, result.params);
    expect(again.data).toEqual(result.data);
  });

  it('honours a forced model family', () => {
    expect(runForecast(sample, [{ name: 'model', value: 'trend' }]).diagnostics.model.family).toBe('trend');
    expect(runForecast(sample, [{ name: 'model', value: 'naive' }]).diagnostics.model.family).toBe('naive');
    const seasonal = runForecast(sample, [{ name: 'model', value: 'seasonal' }]);
    expect(seasonal.diagnostics.model.family).toBe('seasonal');
  });

  it('pins grid dimensions given explicitly', () => {
    const r = runForecast(sample, [{ name: 'calendar', value: 'none' }]);
    const ids = r.diagnostics.backtest.candidates
      .map((c) => c.id)
      .filter((id) => id.startsWith('regression'));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.includes('calendar=none'))).toBe(true);
  });
});

describe('runForecast edge cases', () => {
  it('handles a constant series', () => {
    const r = runForecast(weeklyPoints('2021-01-04', new Array(60).fill(500)));
    expectClean(r);
    r.data.slice(60).forEach((p) => expect(Math.abs(p.value - 500)).toBeLessThanOrEqual(1));
  });

  it('handles a series with zeros', () => {
    const values = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 0 : 100 + i));
    expectClean(runForecast(weeklyPoints('2021-01-04', values), [{ name: 'interval_width', value: 0.9 }]));
    expectClean(runForecast(weeklyPoints('2021-01-04', new Array(40).fill(0))));
  });

  it('handles extreme outliers and huge numbers', () => {
    const values = Array.from({ length: 80 }, (_, i) => 1e12 + i * 1e9);
    values[50] = 9e15;
    values[60] = 0;
    expectClean(runForecast(weeklyPoints('2021-01-04', values), [{ name: 'interval_width', value: 0.5 }]));
  });

  it('uses naive models for a short history', () => {
    const r = runForecast(weeklyPoints('2021-01-04', [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(r.diagnostics.model.family).toBe('naive');
    expect(r.diagnostics.warnings.join(' ')).toMatch(/Short history/);
    expect(r.data).toHaveLength(20);
  });

  it('rejects fewer than 3 weeks with 422', () => {
    expect(() => runForecast(weeklyPoints('2021-01-04', [5, 6]))).toThrow(UnprocessableSeriesError);
  });

  it('outputs fitted values only for input weeks and warns about gaps', () => {
    const points = sample.filter((_, i) => i !== 70 && i !== 71);
    const r = runForecast(points);
    expect(r.data).toHaveLength(152);
    expect(r.data.map((p) => p.timestamp)).not.toContain(sample[70].timestamp);
    expect(r.diagnostics.warnings.join(' ')).toMatch(/2 missing week/);
    expect(r.diagnostics.series.missing_weeks).toBe(2);
  });

  it('warns about unknown params', () => {
    const r = runForecast(weeklyPoints('2021-01-04', [1, 2, 3, 4]), [{ name: 'foo', value: 'bar' }]);
    expect(r.diagnostics.warnings.join(' ')).toMatch(/foo/);
  });

  it('respects horizon_weeks', () => {
    const r = runForecast(sample, [{ name: 'horizon_weeks', value: 3 }]);
    expect(r.data).toHaveLength(147);
    expect(r.data[146].timestamp).toBe('2021-07-12T00:00:00.000Z');
  });
});
