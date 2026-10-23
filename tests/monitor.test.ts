import { describe, expect, it } from 'vitest';
import { evaluateMonitoring, type PredictionRecord } from '../src/forecast/monitor.js';
import { weeklyPoints } from './fixtures.js';

const history = weeklyPoints('2021-01-04', [100, 100, 100, 100, 100, 100]);

const record = (overrides: Partial<PredictionRecord> = {}): PredictionRecord => ({
  calculated_at: '2021-02-01T10:00:00.000Z',
  params: [],
  model: 'trend',
  expected_wape: 5,
  input_end: { timestamp: history[3].timestamp, value: 100 },
  input_weeks: 4,
  forecast: history.slice(4).map((p) => ({ timestamp: p.timestamp, value: 100 })),
  baseline_forecast: history.slice(4).map((p) => ({ timestamp: p.timestamp, value: 90 })),
  ...overrides,
});

describe('evaluateMonitoring', () => {
  it('reports no previous prediction for an empty log', () => {
    expect(evaluateMonitoring([], history, 2).status).toBe('no_previous_prediction');
  });

  it('scores the earlier forecast on the weeks that are now actuals', () => {
    const report = evaluateMonitoring([record()], history, 2);
    expect(report.status).toBe('evaluated');
    expect(report.compared_weeks).toBe(2);
    expect(report.realized_wape).toBe(0);
    expect(report.baseline_realized_wape).toBe(10);
    expect(report.drift).toBe(false);
  });

  it('ignores records of a different series', () => {
    const other = record({ input_end: { timestamp: history[3].timestamp, value: 555 } });
    expect(evaluateMonitoring([other], history, 2).status).toBe('no_previous_prediction');
  });

  it('warns about drift when actuals collapse', () => {
    const collapsed = [...history.slice(0, 4), ...history.slice(4).map((p) => ({ ...p, value: 50 }))];
    const report = evaluateMonitoring([record()], collapsed, 2);
    expect(report.drift).toBe(true);
    expect(report.drift_reasons.join(' ')).toMatch(/expected WAPE/);
    expect(report.drift_reasons.join(' ')).toMatch(/naive baseline/);
  });

  it('uses the newest matching record', () => {
    const older = record({ input_end: { timestamp: history[2].timestamp, value: 100 }, model: 'old' });
    expect(evaluateMonitoring([older, record()], history, 2).record_model).toBe('trend');
  });
});
