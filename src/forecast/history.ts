// Display of the fitted history. It never changes the forecast: the model fitted with recency
// weights extrapolates well but describes old weeks badly (it barely sees them), so with
// history_fit=blend old weeks come from the same model fitted without recency weights.

import { computeMetrics } from './evaluate.js';
import type { ModelForecast } from './models/model.js';
import { fitRegression } from './models/regression.js';
import type { Candidate } from './selection.js';
import type { WeeklySeries } from './series.js';
import type { HistoryFit } from './types.js';

export interface FitDiagnostics {
  history_fit: HistoryFit;
  /** Model used for old weeks, null when the output is the main model alone. */
  history_model: string | null;
  /** In-sample WAPE (%) of the main model's fit and of the returned fitted history. */
  in_sample_wape_model: number | null;
  in_sample_wape_output: number | null;
  method: string;
}

const wape = (series: WeeklySeries, fitted: number[]) => {
  const metrics = computeMetrics(
    series.values,
    fitted.map((v) => Math.max(0, Math.round(v))),
  );
  return metrics === null ? null : Number(metrics.wape.toFixed(2));
};

/**
 * Fitted values for the training weeks. With blend, week t mixes the main model with weight
 * equal to its recency weight 0.5^(age / half-life) and the model without recency weights with the
 * rest, so the last week equals the main model and there is no jump at the start of the forecast.
 */
export function fittedHistory(
  series: WeeklySeries,
  chosen: Candidate,
  main: ModelForecast,
  mode: HistoryFit,
): { fitted: number[]; diagnostics: FitDiagnostics } {
  const modelWape = wape(series, main.fitted);
  const halfLife = chosen.kind === 'regression' ? chosen.config.halfLifeWeeks : null;
  if (mode === 'model' || chosen.kind !== 'regression' || halfLife === null) {
    return {
      fitted: main.fitted,
      diagnostics: {
        history_fit: mode,
        history_model: null,
        in_sample_wape_model: modelWape,
        in_sample_wape_output: modelWape,
        method: 'fitted values of the selected model',
      },
    };
  }
  const historyConfig = { ...chosen.config, halfLifeWeeks: null };
  const history = fitRegression(series, historyConfig, 0);
  const n = series.values.length;
  const fitted = main.fitted.map((value, t) => {
    const weight = 0.5 ** ((n - 1 - t) / halfLife);
    return weight * value + (1 - weight) * history.fitted[t];
  });
  return {
    fitted,
    diagnostics: {
      history_fit: mode,
      history_model: 'same configuration without recency weights (half_life=none)',
      in_sample_wape_model: modelWape,
      in_sample_wape_output: wape(series, fitted),
      method:
        'weight 0.5^(age/half-life) on the selected model, the rest on the model without recency weights; ' +
        'the forecast uses the selected model only',
    },
  };
}
