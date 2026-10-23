import { describe, expect, it } from 'vitest';
import { runForecast } from '../src/forecast/pipeline.js';
import { loadSampleData, weeklyPoints } from './fixtures.js';

const sample = loadSampleData();
const params = [{ name: 'interval_width', value: 0.75 }];

describe('history_fit', () => {
  const blend = runForecast(sample, params);
  const model = runForecast(sample, [...params, { name: 'history_fit', value: 'model' }]);

  it('never changes the forecast or the intervals', () => {
    expect(blend.data.slice(144)).toEqual(model.data.slice(144));
    expect(blend.data).toHaveLength(154);
  });

  it('joins the forecast without a jump: the last input week equals the selected model', () => {
    expect(blend.data[143]).toEqual(model.data[143]);
  });

  it('improves the in-sample fit and reports it in diagnostics.fit', () => {
    const fit = blend.diagnostics.fit;
    expect(fit.history_fit).toBe('blend');
    expect(fit.in_sample_wape_output!).toBeLessThan(fit.in_sample_wape_model!);
    expect(model.diagnostics.fit.in_sample_wape_output).toBe(model.diagnostics.fit.in_sample_wape_model);
  });

  it('removes zero fitted values in the early history except weeks with a large calendar effect', () => {
    const zeros = blend.data
      .filter((p) => p.timestamp < '2019-05-07T' && p.value === 0)
      .map((p) => p.timestamp.slice(0, 10));
    // 2018-12-24 is a real zero; 2018-09-24 (28 September) and 2018-12-31 (New Year) stay at zero
    // because the calendar effect is additive in pieces (see DECISIONS.md).
    expect(zeros).toEqual(['2018-09-24', '2018-12-24', '2018-12-31']);
  });

  it('is echoed in the effective params', () => {
    expect(blend.params).toContainEqual({ name: 'history_fit', value: 'blend' });
    expect(model.params).toContainEqual({ name: 'history_fit', value: 'model' });
  });

  it('keeps a growing synthetic series non-negative and close to the input', () => {
    // Steady growth from 100 to about 2 500 pieces over three years with mild noise.
    const values = Array.from({ length: 160 }, (_, t) =>
      Math.round(100 * 1.02 ** t * (1 + 0.05 * Math.sin(t))),
    );
    const r = runForecast(weeklyPoints('2018-01-01', values), [{ name: 'calendar', value: 'none' }]);
    const fitted = r.data.slice(0, 160).map((p) => p.value);
    expect(fitted.every((v) => v >= 0)).toBe(true);
    const relativeError =
      fitted.reduce((s, v, t) => s + Math.abs(v - values[t]), 0) / values.reduce((s, v) => s + v, 0);
    expect(relativeError).toBeLessThan(0.15);
    expect(r.diagnostics.fit.in_sample_wape_output!).toBeLessThan(15);
  });
});
