import type { WeeklySeries } from '../series.js';
import type { Transform } from '../types.js';

/** Output of fitting a model on a training series and forecasting `horizon` weeks after its end. */
export interface ModelForecast {
  /** In-sample fitted values on the original scale, one per grid week of the training series. */
  fitted: number[];
  /** Point forecasts on the original scale for steps 1..horizon. */
  mean: number[];
  /** Interval centre per step on the interval scale (`log` means log1p of the original scale). */
  intervalCentre: number[];
  /** Standard deviation of the forecast error per step on the interval scale. */
  intervalSigma: number[];
  intervalScale: Transform;
  warnings: string[];
  details: Record<string, unknown>;
}

export type ModelFitter = (train: WeeklySeries, horizon: number) => ModelForecast;
