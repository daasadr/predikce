// Candidate grid and model selection by rolling-origin backtest.

import { MIN_SEASONAL_WEEKS } from './design.js';
import {
  backtestOrigins,
  computeMetrics,
  runBacktest,
  type BacktestOrigin,
  type BacktestResult,
  type Metrics,
} from './evaluate.js';
import type { ModelForecast } from './models/model.js';
import { fitNaive, type NaiveKind } from './models/naive.js';
import { fitRegression, type RegressionConfig } from './models/regression.js';
import { MIN_SERIES_WEEKS, sliceSeries, toIso, type WeeklySeries } from './series.js';
import {
  PREFERRED_CALENDAR,
  PREFERRED_TRANSFORM,
  type CalendarSetting,
  type ForecastParams,
  type SeasonalityMode,
  type Transform,
} from './types.js';

export interface NaiveCandidate {
  id: string;
  kind: NaiveKind;
}

export interface RegressionCandidate {
  id: string;
  kind: 'regression';
  config: RegressionConfig;
}

export type Candidate = NaiveCandidate | RegressionCandidate;

/** Half-lives searched when recency_half_life_weeks is auto; null = no recency weighting. */
export const HALF_LIFE_GRID: (number | null)[] = [26, 52, 13, null];
export const FOURIER_GRID = [0, 1, 2];
/** Default for forced regression families when no backtest is possible. */
const FALLBACK_HALF_LIFE = 26;
/** Smearing is off: in the backtest it increased the (already positive) bias, see DECISIONS.md. */
export const USE_SMEARING = false;

export function regressionId(config: RegressionConfig): string {
  const { transform, halfLifeWeeks, fourierOrder, calendar, seasonality } = config;
  const mode = seasonality === 'two_stage' ? ', seasonality=two_stage' : '';
  return `regression(transform=${transform}, half_life=${halfLifeWeeks ?? 'none'}, fourier=${fourierOrder}, calendar=${calendar}${mode})`;
}

/** Simpler models win ties within the selection tolerance. */
export function complexity(c: Candidate): number {
  if (c.kind !== 'regression') return c.kind === 'naive_last' ? 0 : 0.5;
  const twoStage = c.config.fourierOrder > 0 && c.config.seasonality === 'two_stage' ? 1 : 0;
  return 1 + 2 * c.config.fourierOrder + (c.config.calendar === 'none' ? 0 : 1) + twoStage;
}

export function fitCandidate(candidate: Candidate, train: WeeklySeries, horizon: number): ModelForecast {
  return candidate.kind === 'regression'
    ? fitRegression(train, candidate.config, horizon)
    : fitNaive(candidate.kind, train, horizon);
}

function regressionCandidate(
  params: ForecastParams,
  dims: {
    transform: Transform;
    halfLifeWeeks: number | null;
    fourierOrder: number;
    calendar: CalendarSetting;
    seasonality: SeasonalityMode;
  },
): Candidate {
  const config: RegressionConfig = {
    ...dims,
    robust: params.robust,
    changepointPriorScale: params.changepointPriorScale,
    changepointRange: params.changepointRange,
    nChangepoints: params.nChangepoints,
    smearing: USE_SMEARING,
  };
  return { id: regressionId(config), kind: 'regression', config };
}

export const NAIVE_CANDIDATES: Candidate[] = [
  { id: 'naive_last', kind: 'naive_last' },
  { id: 'naive_drift', kind: 'naive_drift' },
];

/** Regression candidates allowed by the params; explicit params pin their grid dimension. */
export function regressionGrid(params: ForecastParams, nWeeks: number, warnings: string[]): Candidate[] {
  const halfLives =
    params.recencyHalfLifeWeeks === null
      ? HALF_LIFE_GRID
      : [params.recencyHalfLifeWeeks === 'none' ? null : params.recencyHalfLifeWeeks];
  const transforms: Transform[] = params.transform === null ? ['log', 'none'] : [params.transform];
  const calendars: CalendarSetting[] = params.calendar === null ? ['CZ', 'none'] : [params.calendar];

  let fourierOrders: number[];
  if (params.model === 'trend') {
    if (params.fourierOrder !== null && params.fourierOrder > 0) {
      warnings.push(`model=trend ignores fourier_order=${params.fourierOrder}.`);
    }
    fourierOrders = [0];
  } else if (params.model === 'seasonal') {
    fourierOrders = params.fourierOrder !== null && params.fourierOrder > 0 ? [params.fourierOrder] : [1, 2];
  } else {
    fourierOrders = params.fourierOrder === null ? FOURIER_GRID : [params.fourierOrder];
  }
  if (fourierOrders.some((k) => k > 0) && nWeeks < MIN_SEASONAL_WEEKS) {
    warnings.push(
      `Seasonality needs at least ${MIN_SEASONAL_WEEKS} weeks of history (got ${nWeeks}); seasonal models were skipped.`,
    );
    fourierOrders = fourierOrders.filter((k) => k === 0);
    if (fourierOrders.length === 0) fourierOrders = [0];
  }

  const seasonalities: SeasonalityMode[] =
    params.seasonality === null ? ['local', 'two_stage'] : [params.seasonality];
  const grid: Candidate[] = [];
  for (const fourierOrder of fourierOrders)
    for (const calendar of calendars)
      for (const transform of transforms)
        for (const halfLifeWeeks of halfLives)
          for (const seasonality of seasonalities) {
            // Two-stage differs from local only with a seasonal term and recency weights.
            const distinct = seasonality === 'local' || (fourierOrder > 0 && halfLifeWeeks !== null);
            if (distinct || seasonalities.length === 1) {
              grid.push(
                regressionCandidate(params, {
                  transform,
                  halfLifeWeeks,
                  fourierOrder,
                  calendar,
                  seasonality,
                }),
              );
            }
          }
  return grid;
}

export interface CandidateResult {
  candidate: Candidate;
  complexity: number;
  backtest: BacktestResult;
}

export interface Selection {
  chosen: Candidate;
  reason: string;
  origins: BacktestOrigin[];
  results: CandidateResult[];
  /** Best naive baseline by backtest (null without backtest). */
  baseline: CandidateResult | null;
  warnings: string[];
}

export function selectModel(series: WeeklySeries, params: ForecastParams): Selection {
  const n = series.values.length;
  const warnings: string[] = [];
  const shortHistory = n < params.minTrainWeeks;
  if (shortHistory) {
    warnings.push(
      `Short history: ${n} weeks < min_train_weeks=${params.minTrainWeeks}; only naive models are used.`,
    );
  }
  const naiveOnly = shortHistory || params.model === 'naive';
  const regression = naiveOnly ? [] : regressionGrid(params, n, warnings);
  const candidates = [...NAIVE_CANDIDATES, ...regression];
  const selectable = params.model === 'auto' || naiveOnly ? candidates : regression;

  const origins = backtestOrigins(n, params);
  if (origins.length === 0) {
    const preferred =
      selectable.find(
        (c) =>
          c.kind !== 'regression' ||
          ((params.transform !== null || c.config.transform === PREFERRED_TRANSFORM) &&
            (params.calendar !== null || c.config.calendar === PREFERRED_CALENDAR) &&
            (params.recencyHalfLifeWeeks !== null || c.config.halfLifeWeeks === FALLBACK_HALF_LIFE)),
      ) ?? selectable[0];
    warnings.push(
      `No backtest origin has min_train_weeks=${params.minTrainWeeks} weeks of history; ` +
        `the model could not be validated and ${preferred.id} was used.`,
    );
    return {
      chosen: preferred,
      reason: 'no backtest possible',
      origins,
      results: [],
      baseline: null,
      warnings,
    };
  }

  const results: CandidateResult[] = candidates.map((candidate) => ({
    candidate,
    complexity: complexity(candidate),
    backtest: runBacktest(series, origins, params.horizonWeeks, (train, horizon) =>
      fitCandidate(candidate, train, horizon),
    ),
  }));
  const scored = results.filter((r) => Number.isFinite(r.backtest.meanWape));
  const baseline = bestBy(scored.filter((r) => r.candidate.kind !== 'regression'));
  const pool = scored.filter((r) => selectable.includes(r.candidate));
  const best = bestBy(pool);
  if (best === null) {
    return {
      chosen: selectable[0],
      reason: 'no candidate could be scored',
      origins,
      results,
      baseline,
      warnings: [...warnings, 'No candidate could be scored in the backtest.'],
    };
  }

  // Simplest candidate within the tolerance of the best; ties broken by WAPE, then by grid order.
  const limit = best.backtest.meanWape * (1 + params.selectionTolerance) + 1e-9;
  const withinTolerance = pool.filter((r) => r.backtest.meanWape <= limit);
  let chosen = [...withinTolerance].sort(
    (a, b) => a.complexity - b.complexity || a.backtest.meanWape - b.backtest.meanWape,
  )[0];
  let reason =
    chosen === best
      ? 'lowest mean WAPE in backtest'
      : `simplest model within ${(params.selectionTolerance * 100).toFixed(1)} % of the best WAPE (${best.candidate.id})`;

  if (
    baseline !== null &&
    chosen.candidate.kind === 'regression' &&
    chosen.backtest.meanWape > baseline.backtest.meanWape
  ) {
    if (params.model === 'auto') {
      chosen = baseline;
      reason = 'no regression model beat the naive baseline';
    } else {
      warnings.push(
        `The forced model is worse than the naive baseline ${baseline.candidate.id} in the backtest.`,
      );
    }
  }
  if (params.model === 'auto' && chosen.candidate.kind !== 'regression' && !naiveOnly) {
    warnings.push(
      `No regression model beat the naive baseline in the backtest; ${chosen.candidate.id} is returned.`,
    );
  }
  return { chosen: chosen.candidate, reason, origins, results, baseline, warnings };
}

function bestBy(results: CandidateResult[]): CandidateResult | null {
  return results.reduce<CandidateResult | null>(
    (best, r) => (best === null || r.backtest.meanWape < best.backtest.meanWape ? r : best),
    null,
  );
}

export interface NestedOrigin {
  firstTestWeek: string;
  chosen: string;
  metrics: Metrics;
}

/**
 * Nested validation: for every backtest origin the whole selection is rerun on data before it and
 * only the model it picks is scored on the window. This estimates the error of the procedure
 * honestly, unlike the optimistic score of the model selected on the same origins.
 */
export function nestedValidation(series: WeeklySeries, params: ForecastParams): NestedOrigin[] {
  const n = series.values.length;
  const results: NestedOrigin[] = [];
  for (const origin of backtestOrigins(n, params)) {
    const train = sliceSeries(series, origin.trainWeeks);
    const steps = Math.min(params.horizonWeeks, n - origin.trainWeeks);
    if (train.inputIndex.length < MIN_SERIES_WEEKS || steps <= 0) continue;
    const inner = selectModel(train, { ...params, horizonWeeks: steps });
    const forecast = fitCandidate(inner.chosen, train, steps).mean;
    const metrics = computeMetrics(
      series.values.slice(origin.trainWeeks, origin.trainWeeks + steps),
      forecast,
    );
    if (metrics === null) continue;
    results.push({
      firstTestWeek: toIso(series.times[origin.trainWeeks]).slice(0, 10),
      chosen: inner.chosen.id,
      metrics,
    });
  }
  return results;
}
