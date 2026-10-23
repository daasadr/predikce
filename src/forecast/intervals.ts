// Prediction intervals: centre ± c·q·σ_h on the model scale, back-transformed.
// σ_h = σ·√h comes from the in-sample residuals; the factor c is calibrated on backtest errors.

import type { OriginEvaluation } from './evaluate.js';
import type { ModelForecast } from './models/model.js';
import { inverseTransform } from './models/regression.js';

type IntervalInputs = Pick<ModelForecast, 'mean' | 'intervalCentre' | 'intervalSigma' | 'intervalScale'>;

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be in (0, 1)');
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) return -inverseNormalCdf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

const quantileOfWidth = (width: number) => (width > 0 ? inverseNormalCdf(0.5 + width / 2) : 0);

/** Central interval of the given width for each forecast step, on the original scale. */
export function intervalBounds(
  forecast: IntervalInputs,
  width: number,
  calibration = 1,
): { lower: number[]; upper: number[] } {
  const q = quantileOfWidth(width) * calibration;
  const lower: number[] = [];
  const upper: number[] = [];
  forecast.mean.forEach((mean, h) => {
    const centre = forecast.intervalCentre[h];
    const halfWidth = q * forecast.intervalSigma[h];
    lower.push(Math.min(inverseTransform(forecast.intervalScale, centre - halfWidth), mean));
    upper.push(Math.max(inverseTransform(forecast.intervalScale, centre + halfWidth), mean));
  });
  return { lower, upper };
}

/** |actual − centre| / σ_h on the model scale for every backtest week with a known actual. */
function standardisedErrors(evaluation: OriginEvaluation): number[] {
  const { interval } = evaluation;
  const errors: number[] = [];
  evaluation.actual.forEach((y, h) => {
    const sigma = interval.intervalSigma[h];
    if (y === null || !(sigma > 0)) return;
    const z = interval.intervalScale === 'log' ? Math.log1p(y) : y;
    errors.push(Math.abs(z - interval.intervalCentre[h]) / sigma);
  });
  return errors;
}

function empiricalQuantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = p * (sorted.length - 1);
  const lowIndex = Math.floor(position);
  const highIndex = Math.ceil(position);
  return sorted[lowIndex] + (sorted[highIndex] - sorted[lowIndex]) * (position - lowIndex);
}

/**
 * Factor c such that centre ± c·q·σ_h covers the share `width` of the standardised backtest errors.
 * Returns 1 when there is nothing to calibrate on.
 */
export function calibrationFactor(evaluations: OriginEvaluation[], width: number): number {
  const errors = evaluations.flatMap(standardisedErrors);
  const q = quantileOfWidth(width);
  if (errors.length === 0 || q === 0) return 1;
  const factor = empiricalQuantile(errors, width) / q;
  return Number.isFinite(factor) ? factor : 1;
}

function countHits(evaluation: OriginEvaluation, width: number, calibration: number) {
  const { lower, upper } = intervalBounds(evaluation.interval, width, calibration);
  let hits = 0;
  let count = 0;
  evaluation.actual.forEach((y, h) => {
    if (y === null) return;
    count++;
    if (y >= Math.round(lower[h]) && y <= Math.round(upper[h])) hits++;
  });
  return { hits, count };
}

export interface CoverageReport {
  /** Coverage of the uncalibrated σ·√h interval. */
  raw: number | null;
  /** Coverage with the factor calibrated on the other origins (leave-one-origin-out), an honest estimate. */
  calibrated: number | null;
  /** Factor used for the final intervals, calibrated on all origins. */
  calibration: number;
  count: number;
}

export function coverageReport(evaluations: OriginEvaluation[], width: number): CoverageReport {
  let rawHits = 0;
  let looHits = 0;
  let count = 0;
  evaluations.forEach((evaluation, i) => {
    const others = evaluations.filter((_, j) => j !== i);
    const raw = countHits(evaluation, width, 1);
    const loo = countHits(evaluation, width, others.length > 0 ? calibrationFactor(others, width) : 1);
    rawHits += raw.hits;
    looHits += loo.hits;
    count += raw.count;
  });
  return {
    raw: count === 0 ? null : rawHits / count,
    calibrated: count === 0 ? null : looHits / count,
    calibration: calibrationFactor(evaluations, width),
    count,
  };
}
