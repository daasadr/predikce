// Accuracy metrics and rolling-origin backtest.

import type { ModelFitter, ModelForecast } from './models/model.js';
import { sliceSeries, toIso, type WeeklySeries } from './series.js';

export interface Metrics {
  /** Weighted absolute percentage error, Σ|f − y| / Σ|y| in %. */
  wape: number;
  mae: number;
  /** Σ(f − y) / Σ|y| in %; positive means over-forecasting. */
  bias: number;
  count: number;
}

/** Metrics over weeks with a known actual value; null when there is none. */
export function computeMetrics(actual: (number | null)[], forecast: number[]): Metrics | null {
  let absError = 0;
  let error = 0;
  let total = 0;
  let count = 0;
  actual.forEach((y, i) => {
    if (y === null) return;
    const e = forecast[i] - y;
    absError += Math.abs(e);
    error += e;
    total += Math.abs(y);
    count++;
  });
  if (count === 0) return null;
  // An all-zero window has no scale; one unit (piece) is used so the metric stays finite.
  const denominator = total > 0 ? total : 1;
  return {
    wape: (100 * absError) / denominator,
    mae: absError / count,
    bias: (100 * error) / denominator,
    count,
  };
}

export type OriginKind = 'latest' | 'rolling' | 'seasonal';

export interface BacktestOrigin {
  /** Number of grid weeks before the origin (training length). */
  trainWeeks: number;
  kind: OriginKind;
}

export interface OriginSettings {
  horizonWeeks: number;
  backtestOrigins: number;
  backtestStep: number;
  minTrainWeeks: number;
}

/** Same part of the year one and two years before the forecast window. */
export const SEASONAL_LAGS_WEEKS = [52, 104];

/**
 * Backtest origins, newest first: the latest window, `backtestOrigins` more every `backtestStep`
 * weeks back, and the windows 52 and 104 weeks before the end. Each needs `minTrainWeeks` of history.
 */
export function backtestOrigins(n: number, settings: OriginSettings): BacktestOrigin[] {
  const { horizonWeeks, backtestOrigins: count, backtestStep, minTrainWeeks } = settings;
  if (n <= minTrainWeeks) return [];
  // With a short series the latest window is shortened so that it keeps minTrainWeeks of history.
  const latest = Math.max(n - horizonWeeks, minTrainWeeks);
  const origins: BacktestOrigin[] = [{ trainWeeks: latest, kind: 'latest' }];
  for (let k = 1; k <= count; k++) {
    const trainWeeks = latest - k * backtestStep;
    if (trainWeeks >= minTrainWeeks) origins.push({ trainWeeks, kind: 'rolling' });
  }
  for (const lag of SEASONAL_LAGS_WEEKS) {
    const trainWeeks = n - lag;
    if (trainWeeks >= minTrainWeeks && !origins.some((o) => o.trainWeeks === trainWeeks)) {
      origins.push({ trainWeeks, kind: 'seasonal' });
    }
  }
  return origins.sort((a, b) => b.trainWeeks - a.trainWeeks);
}

export interface OriginEvaluation {
  trainWeeks: number;
  kind: OriginKind;
  firstTestWeek: string;
  actual: (number | null)[];
  forecast: number[];
  /** Interval inputs of the forecast from this origin (see ModelForecast). */
  interval: Pick<ModelForecast, 'mean' | 'intervalCentre' | 'intervalSigma' | 'intervalScale'>;
  metrics: Metrics;
}

export interface BacktestResult {
  origins: OriginEvaluation[];
  meanWape: number;
  meanMae: number;
  meanBias: number;
}

/** Fits the model only on data before each origin and scores the following weeks. */
export function runBacktest(
  series: WeeklySeries,
  origins: BacktestOrigin[],
  horizon: number,
  fit: ModelFitter,
): BacktestResult {
  const n = series.values.length;
  const evaluations: OriginEvaluation[] = [];
  for (const origin of origins) {
    const steps = Math.min(horizon, n - origin.trainWeeks);
    const train = sliceSeries(series, origin.trainWeeks);
    if (steps <= 0 || train.inputIndex.length === 0) continue;
    const actual = series.values.slice(origin.trainWeeks, origin.trainWeeks + steps);
    const result = fit(train, steps);
    const metrics = computeMetrics(actual, result.mean);
    if (metrics === null) continue;
    evaluations.push({
      trainWeeks: origin.trainWeeks,
      kind: origin.kind,
      firstTestWeek: toIso(series.times[origin.trainWeeks]).slice(0, 10),
      actual,
      forecast: result.mean,
      interval: {
        mean: result.mean,
        intervalCentre: result.intervalCentre,
        intervalSigma: result.intervalSigma,
        intervalScale: result.intervalScale,
      },
      metrics,
    });
  }
  const mean = (pick: (m: Metrics) => number) =>
    evaluations.length === 0
      ? Number.NaN
      : evaluations.reduce((s, e) => s + pick(e.metrics), 0) / evaluations.length;
  return {
    origins: evaluations,
    meanWape: mean((m) => m.wape),
    meanMae: mean((m) => m.mae),
    meanBias: mean((m) => m.bias),
  };
}
