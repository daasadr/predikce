// Monitoring in production: realised accuracy of earlier forecasts once their weeks become actuals.

import { computeMetrics } from './evaluate.js';
import { parseTimestamp } from './series.js';
import type { InputPoint, OutputPoint, ParamEntry } from './types.js';

/** One line of predictions.jsonl. */
export interface PredictionRecord {
  calculated_at: string;
  params: ParamEntry[];
  model: string;
  /** Mean backtest WAPE of the chosen model (%), null without backtest. */
  expected_wape: number | null;
  /** Fingerprint of the input series: its last week and value. */
  input_end: { timestamp: string; value: number };
  input_weeks: number;
  forecast: OutputPoint[];
  baseline_forecast: OutputPoint[];
}

export interface MonitoringReport {
  status: 'no_previous_prediction' | 'no_new_actuals' | 'evaluated';
  record_calculated_at?: string;
  record_model?: string;
  compared_weeks?: number;
  realized_wape?: number;
  realized_mae?: number;
  realized_bias?: number;
  baseline_realized_wape?: number;
  expected_wape?: number | null;
  drift_threshold?: number;
  drift: boolean;
  drift_reasons: string[];
}

const round = (value: number) => Number(value.toFixed(2));

/**
 * Finds the newest earlier forecast of the same series (its last input week is in the current input
 * with the same value and is older than the current end) and scores it on the weeks now known.
 */
export function evaluateMonitoring(
  records: PredictionRecord[],
  points: InputPoint[],
  driftThreshold: number,
): MonitoringReport {
  const actualByTime = new Map<number, number>();
  for (const p of points) {
    const time = parseTimestamp(p.timestamp);
    if (time !== null) actualByTime.set(time, p.value);
  }
  const currentEnd = Math.max(...actualByTime.keys());

  const sameSeries = records
    .map((record) => ({ record, end: parseTimestamp(record.input_end.timestamp) }))
    .filter(
      (r): r is { record: PredictionRecord; end: number } =>
        r.end !== null && r.end < currentEnd && actualByTime.get(r.end) === r.record.input_end.value,
    )
    .sort((a, b) => b.end - a.end || b.record.calculated_at.localeCompare(a.record.calculated_at));
  if (sameSeries.length === 0) return { status: 'no_previous_prediction', drift: false, drift_reasons: [] };

  const { record } = sameSeries[0];
  const actual: number[] = [];
  const forecast: number[] = [];
  const baseline: number[] = [];
  record.forecast.forEach((point, h) => {
    const time = parseTimestamp(point.timestamp);
    const y = time === null ? undefined : actualByTime.get(time);
    if (y === undefined) return;
    actual.push(y);
    forecast.push(point.value);
    baseline.push(record.baseline_forecast[h]?.value ?? point.value);
  });
  const model = computeMetrics(actual, forecast);
  const naive = computeMetrics(actual, baseline);
  if (model === null || naive === null) {
    return {
      status: 'no_new_actuals',
      record_calculated_at: record.calculated_at,
      record_model: record.model,
      drift: false,
      drift_reasons: [],
    };
  }

  const reasons: string[] = [];
  if (record.expected_wape !== null && model.wape > driftThreshold * record.expected_wape) {
    reasons.push(
      `realised WAPE ${round(model.wape)} % is worse than ${driftThreshold} × expected WAPE ${round(record.expected_wape)} %`,
    );
  }
  if (model.wape > naive.wape) {
    reasons.push(
      `realised WAPE ${round(model.wape)} % is worse than the naive baseline (${round(naive.wape)} %)`,
    );
  }
  return {
    status: 'evaluated',
    record_calculated_at: record.calculated_at,
    record_model: record.model,
    compared_weeks: model.count,
    realized_wape: round(model.wape),
    realized_mae: round(model.mae),
    realized_bias: round(model.bias),
    baseline_realized_wape: round(naive.wape),
    expected_wape: record.expected_wape,
    drift_threshold: driftThreshold,
    drift: reasons.length > 0,
    drift_reasons: reasons,
  };
}
