// Weighted ridge regression on a transformed scale:
// z_t = a + b·t + Σ δ_k·max(0, t − s_k) + Σ Fourier terms + Σ calendar terms + ε_t
// Two-stage seasonality: the Fourier profile is estimated on the whole history (equal weights),
// then level and trend are fitted with recency weights on the deseasonalised series.

import { WEEK_MS } from '../calendar.js';
import { designMatrix, makeDesignSpec, MIN_SEASONAL_WEEKS, type ColumnKind } from '../design.js';
import { dot, weightedRidge } from '../linalg.js';
import { huberWeight, robustScale } from '../robust.js';
import { toIso, type WeeklySeries } from '../series.js';
import type { CalendarSetting, SeasonalityMode, Transform } from '../types.js';
import type { ModelForecast } from './model.js';

export interface RegressionConfig {
  transform: Transform;
  /** Half-life of recency weights in weeks; null means equal weights. */
  halfLifeWeeks: number | null;
  fourierOrder: number;
  calendar: CalendarSetting;
  robust: boolean;
  changepointPriorScale: number;
  changepointRange: number;
  nChangepoints: number;
  /** local: Fourier terms fitted together with the recency-weighted trend; two_stage: see above. */
  seasonality: SeasonalityMode;
  /** Duan's smearing correction of the log back-transform. */
  smearing: boolean;
}

/** IRLS refits after the initial weighted fit (5 fits in total). */
const ROBUST_ITERATIONS = 4;
/** Prior scale 10 (as in Prophet) for seasonal and calendar terms: λ = 1/10². */
const WEAK_PENALTY = 0.01;
/** Penalty pinning a coefficient to its default when its regressor never occurs in the history. */
const STRONG_PENALTY = 1e4;
/** Floor of the residual scale (on the unit-range scale) so a perfect fit does not divide by zero. */
const MIN_SCALE = 1e-6;
const DOWNWEIGHT_REPORT_THRESHOLD = 0.5;

const forward = (transform: Transform, y: number) => (transform === 'log' ? Math.log1p(y) : y);

/** Inverse transform, clipped to [0, MAX_SAFE_INTEGER] so the output is always finite. */
export function inverseTransform(transform: Transform, z: number): number {
  const y = transform === 'log' ? Math.expm1(Math.min(z, 40)) : z;
  if (!Number.isFinite(y)) return y > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Math.min(Math.max(y, 0), Number.MAX_SAFE_INTEGER);
}

const CALENDAR_LABELS: Partial<Record<ColumnKind, string>> = {
  working_days: 'weeks with fewer working days (public holidays)',
  christmas_week: 'week containing 24 December',
  new_year_week: 'week containing 1 January',
};

export function fitRegression(train: WeeklySeries, config: RegressionConfig, horizon: number): ModelForecast {
  const n = train.values.length;
  const warnings: string[] = [];
  let fourierOrder = config.fourierOrder;
  if (fourierOrder > 0 && n < MIN_SEASONAL_WEEKS) {
    warnings.push(
      `Seasonality (fourier_order=${fourierOrder}) needs at least ${MIN_SEASONAL_WEEKS} weeks of history, ` +
        `got ${n}; it was turned off.`,
    );
    fourierOrder = 0;
  }

  if (fourierOrder > 0 && config.seasonality === 'two_stage' && config.halfLifeWeeks !== null) {
    const profile = fitCore(train, { ...config, fourierOrder, halfLifeWeeks: null }, horizon, null);
    const result = fitCore(train, { ...config, fourierOrder: 0 }, horizon, profile.seasonal);
    result.forecast.details.effective_fourier_order = fourierOrder;
    result.forecast.details.seasonal_profile_amplitude =
      Math.max(...profile.seasonal) - Math.min(...profile.seasonal);
    return {
      ...result.forecast,
      warnings: [...warnings, ...profile.forecast.warnings, ...result.forecast.warnings],
    };
  }
  const { forecast } = fitCore(train, { ...config, fourierOrder }, horizon, null);
  return { ...forecast, warnings: [...warnings, ...forecast.warnings] };
}

/**
 * One weighted ridge fit. `offset` is a known component on the transformed scale (one value per
 * training and future week) that is removed from the target and added back to the predictions.
 * Also returns the fitted Fourier component on the transformed scale.
 */
function fitCore(
  train: WeeklySeries,
  config: RegressionConfig,
  horizon: number,
  offset: number[] | null,
): { forecast: ModelForecast; seasonal: number[] } {
  const { values, times } = train;
  const n = values.length;
  const warnings: string[] = [];
  const fourierOrder = config.fourierOrder;

  // Transformed target scaled to unit range, so that penalties mean the same for any series size.
  const z = values.map((y, t) => (y === null ? 0 : forward(config.transform, y) - (offset?.[t] ?? 0)));
  const observedZ = z.filter((_, i) => values[i] !== null);
  const zMin = Math.min(...observedZ);
  const zRange = Math.max(...observedZ) - zMin || 1;
  const zs = z.map((v) => (v - zMin) / zRange);

  const spec = makeDesignSpec(n, {
    nChangepoints: config.nChangepoints,
    changepointRange: config.changepointRange,
    fourierOrder,
    calendar: config.calendar,
  });
  const X = designMatrix(spec, times[0], horizon);
  const Xtrain = X.slice(0, n);

  const baseWeights = values.map((y, t) =>
    y === null ? 0 : config.halfLifeWeeks === null ? 1 : 0.5 ** ((n - 1 - t) / config.halfLifeWeeks),
  );

  const changepointPenalty = 1 / config.changepointPriorScale ** 2;
  const penalties: number[] = [];
  const priorMeans: number[] = [];
  spec.columns.forEach(({ kind }, j) => {
    let penalty =
      kind === 'intercept' || kind === 'slope'
        ? 0
        : kind === 'changepoint'
          ? changepointPenalty
          : WEAK_PENALTY;
    // Default effect: sales proportional to working days on the log scale, no extra holiday effect.
    let prior = kind === 'working_days' && config.transform === 'log' ? 1 / zRange : 0;
    const label = CALENDAR_LABELS[kind];
    if (label !== undefined && !Xtrain.some((row, t) => baseWeights[t] > 0 && row[j] !== 0)) {
      penalty = STRONG_PENALTY;
      warnings.push(`No ${label} in the history; its effect is fixed to a regularised default.`);
    }
    if (kind === 'working_days' && config.transform === 'none') prior = 0;
    penalties.push(penalty);
    priorMeans.push(prior);
  });

  let weights = baseWeights;
  let beta = weightedRidge(Xtrain, zs, weights, penalties, priorMeans);
  if (config.robust) {
    for (let iter = 0; iter < ROBUST_ITERATIONS; iter++) {
      const residuals = Xtrain.map((row, t) => zs[t] - dot(row, beta));
      const scale = Math.max(robustScale(residuals, baseWeights), MIN_SCALE);
      weights = baseWeights.map((w, t) => (w === 0 ? 0 : w * huberWeight(residuals[t] / scale)));
      beta = weightedRidge(Xtrain, zs, weights, penalties, priorMeans);
    }
  }

  const seasonal = X.map((row) =>
    spec.columns.reduce((sum, c, j) => (c.kind === 'fourier' ? sum + row[j] * beta[j] * zRange : sum), 0),
  );
  const zHat = X.map((row, t) => dot(row, beta) * zRange + zMin + (offset?.[t] ?? 0));
  const residuals = values.map((y, t) => (y === null ? 0 : forward(config.transform, y) - zHat[t]));
  const sigma = robustScale(residuals, baseWeights);

  let smear = 1;
  if (config.smearing && config.transform === 'log') {
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight > 0) smear = weights.reduce((s, w, t) => s + w * Math.exp(residuals[t]), 0) / totalWeight;
  }
  const toOriginal = (zv: number) => inverseTransform(config.transform, zv) * smear;

  const fitted = zHat.slice(0, n).map((zv) => Math.min(toOriginal(zv), Number.MAX_SAFE_INTEGER));
  const futureZ = zHat.slice(n);
  const mean = futureZ.map((zv) => Math.min(toOriginal(zv), Number.MAX_SAFE_INTEGER));

  const robustWeights = weights.map((w, t) => (baseWeights[t] > 0 ? w / baseWeights[t] : 1));
  const downweighted = robustWeights
    .map((w, t) => ({ week: toIso(times[t]).slice(0, 10), weight: Number(w.toFixed(3)) }))
    .filter((item, t) => values[t] !== null && item.weight < DOWNWEIGHT_REPORT_THRESHOLD);

  const changepointCoefficients = spec.columns
    .map((c, j) => (c.kind === 'changepoint' ? beta[j] : 0))
    .reduce((s, v) => s + v, 0);
  const finalSlopePerWeek = ((beta[1] + changepointCoefficients) * zRange) / spec.tScale;

  const forecast: ModelForecast = {
    fitted,
    mean,
    intervalCentre: futureZ,
    intervalSigma: futureZ.map((_, h) => sigma * Math.sqrt(h + 1)),
    intervalScale: config.transform,
    warnings,
    details: {
      columns: spec.columns.map((c, j) => ({ name: c.name, coefficient: beta[j] * zRange })),
      changepoints: spec.changepoints.map((s) => toIso(times[0] + Math.round(s) * WEEK_MS).slice(0, 10)),
      // On the log scale this is the weekly growth rate used for extrapolation.
      final_slope_per_week: finalSlopePerWeek,
      residual_sigma: sigma,
      smearing_factor: smear,
      effective_fourier_order: fourierOrder,
      downweighted_weeks: downweighted,
    },
  };
  return { forecast, seasonal };
}
