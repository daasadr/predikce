// Golden values for the sample data: changes to how history is displayed must not move the forecast.
import { describe, expect, it } from 'vitest';
import { runForecast } from '../src/forecast/pipeline.js';
import { loadSampleData } from './fixtures.js';

const FORECAST = [
  ['2021-06-28', 16099, 15495, 16704],
  ['2021-07-05', 11615, 10760, 12469],
  ['2021-07-12', 16636, 15589, 17683],
  ['2021-07-19', 16893, 15684, 18102],
  ['2021-07-26', 17140, 15788, 18491],
  ['2021-08-02', 17374, 15893, 18855],
  ['2021-08-09', 17594, 15995, 19194],
  ['2021-08-16', 17800, 16090, 19510],
  ['2021-08-23', 17989, 16175, 19802],
  ['2021-08-30', 18161, 16249, 20072],
] as const;

describe('golden forecast for the sample data', () => {
  const result = runForecast(loadSampleData(), [{ name: 'interval_width', value: 0.75 }]);

  it('keeps forecast values and intervals', () => {
    expect(result.data.slice(144)).toEqual(
      FORECAST.map(([week, value, lower, upper]) => ({
        timestamp: `${week}T00:00:00.000Z`,
        value,
        lower,
        upper,
      })),
    );
  });

  it('keeps the selected model and its backtest scores', () => {
    const d = result.diagnostics;
    expect(d.model.id).toBe('regression(transform=none, half_life=13, fourier=1, calendar=CZ)');
    expect(d.backtest.selected).toMatchObject({ mean_wape: 11.7, mean_mae: 1174.35, mean_bias: -6.39 });
    expect(d.backtest.baseline).toMatchObject({ id: 'naive_last', mean_wape: 16.16 });
    expect(d.intervals).toMatchObject({ coverage: 0.743, coverage_uncalibrated: 0.914, compared_weeks: 70 });
  });
});
