import { lastObservedIndex, type WeeklySeries } from '../series.js';
import { robustScale } from '../robust.js';
import type { ModelForecast } from './model.js';

/** Window (in weeks) of the average weekly change used by naive_drift. */
export const DRIFT_WINDOW_WEEKS = 13;
/** Window (in weeks) of one-step changes used to estimate the naive forecast error. */
const SIGMA_WINDOW_WEEKS = 52;

export type NaiveKind = 'naive_last' | 'naive_drift';

/** Average weekly change over the observed weeks in (end − window, end], measured from week `end`. */
function driftAt(values: (number | null)[], end: number, window: number): number {
  for (let i = Math.max(0, end - window); i < end; i++) {
    const start = values[i];
    if (start !== null) return ((values[end] as number) - start) / (end - i);
  }
  return 0;
}

/** Robust standard deviation of one-step log1p changes, the error of a one-week naive forecast. */
function oneStepLogSigma(values: (number | null)[]): number {
  const diffs: number[] = [];
  for (let i = values.length - 1; i > 0 && diffs.length < SIGMA_WINDOW_WEEKS; i--) {
    const current = values[i];
    const previous = values[i - 1];
    if (current !== null && previous !== null) diffs.push(Math.log1p(current) - Math.log1p(previous));
  }
  return robustScale(
    diffs,
    diffs.map(() => 1),
  );
}

export function fitNaive(kind: NaiveKind, train: WeeklySeries, horizon: number): ModelForecast {
  const { values } = train;
  const n = values.length;
  const last = lastObservedIndex(values);
  if (last < 0) throw new Error('naive model needs at least one observation');
  const drift = kind === 'naive_drift' ? driftAt(values, last, DRIFT_WINDOW_WEEKS) : 0;
  const lastValue = values[last] as number;

  // One-step-ahead fitted values: the forecast each model would have made a week earlier.
  const fitted: number[] = [];
  let previous = -1;
  for (let t = 0; t < n; t++) {
    if (previous < 0) {
      fitted.push(values[t] ?? 0);
    } else {
      const d = kind === 'naive_drift' ? driftAt(values, previous, DRIFT_WINDOW_WEEKS) : 0;
      fitted.push(Math.max(0, (values[previous] as number) + d * (t - previous)));
    }
    if (values[t] !== null) previous = t;
  }

  const sigma = oneStepLogSigma(values);
  const mean: number[] = [];
  const intervalSigma: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const steps = n - 1 - last + h;
    mean.push(Math.max(0, lastValue + drift * steps));
    intervalSigma.push(sigma * Math.sqrt(steps));
  }
  return {
    fitted,
    mean,
    intervalCentre: mean.map((m) => Math.log1p(m)),
    intervalSigma,
    intervalScale: 'log',
    warnings: [],
    details: kind === 'naive_drift' ? { drift_per_week: drift, drift_window_weeks: DRIFT_WINDOW_WEEKS } : {},
  };
}
