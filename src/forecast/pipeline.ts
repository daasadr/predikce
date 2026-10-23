// Main flow: validate input -> weekly grid -> model selection -> final fit -> output and diagnostics.
// Stateless: the model is refitted from the input on every call.

import { parseParams } from '../schemas.js';
import { WEEK_MS } from './calendar.js';
import type { BacktestResult, Metrics, OriginEvaluation } from './evaluate.js';
import { fittedHistory, type FitDiagnostics } from './history.js';
import { coverageReport, intervalBounds, type CoverageReport } from './intervals.js';
import {
  fitCandidate,
  NAIVE_CANDIDATES,
  selectModel,
  type Candidate,
  type CandidateResult,
  type Selection,
} from './selection.js';
import { buildWeeklySeries, toIso, type WeeklySeries } from './series.js';
import {
  PREFERRED_CALENDAR,
  PREFERRED_TRANSFORM,
  type ForecastParams,
  type InputPoint,
  type OutputPoint,
  type ParamEntry,
} from './types.js';

/** Interval width for the coverage diagnostics when the request does not ask for intervals. */
const DIAGNOSTIC_INTERVAL_WIDTH = 0.75;

export interface ForecastResult {
  data: OutputPoint[];
  /** Effective parameters: defaults filled in and searched dimensions resolved to the chosen values. */
  params: ParamEntry[];
  diagnostics: Diagnostics;
  /** Forecast of the best naive baseline for the same weeks, kept for monitoring (not part of the API output). */
  baselineForecast: OutputPoint[];
}

export interface Diagnostics {
  model: {
    id: string;
    family: 'naive' | 'trend' | 'seasonal';
    selection_reason: string;
    config: Record<string, unknown>;
    details: Record<string, unknown>;
  };
  backtest: {
    origins: { first_test_week: string; train_weeks: number; kind: string }[];
    selected: CandidateSummary | null;
    baseline: CandidateSummary | null;
    candidates: CandidateSummary[];
  };
  intervals: {
    width: number;
    requested: boolean;
    /** Leave-one-origin-out coverage of the calibrated interval in the backtest (0-1). */
    coverage: number | null;
    /** Coverage of the uncalibrated σ·√h interval. */
    coverage_uncalibrated: number | null;
    calibration_factor: number;
    compared_weeks: number;
    method: string;
  } | null;
  series: {
    input_weeks: number;
    grid_weeks: number;
    missing_weeks: number;
    first_week: string;
    last_week: string;
    forecast_from: string;
    forecast_to: string;
    forecast_weeks: number;
  };
  /** How the fitted history was produced and its in-sample WAPE. */
  fit: FitDiagnostics;
  warnings: string[];
  requested_params: ParamEntry[];
  monitoring?: unknown;
}

export interface CandidateSummary {
  id: string;
  complexity: number;
  mean_wape: number;
  mean_mae: number;
  mean_bias: number;
  per_origin: {
    first_test_week: string;
    kind: string;
    weeks: number;
    wape: number;
    mae: number;
    bias: number;
  }[];
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
/** Output values are whole pieces, never negative and always finite. */
const toCount = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export function runForecast(points: InputPoint[], paramEntries: ParamEntry[] = []): ForecastResult {
  const { params, warnings: paramWarnings } = parseParams(paramEntries);
  const { series, warnings: seriesWarnings } = buildWeeklySeries(points);
  const selection = selectModel(series, params);
  const horizon = params.horizonWeeks;
  const final = fitCandidate(selection.chosen, series, horizon);
  const history = fittedHistory(series, selection.chosen, final, params.historyFit);
  const chosenResult = selection.results.find((r) => r.candidate === selection.chosen) ?? null;
  const coverageWidth = params.intervalWidth ?? DIAGNOSTIC_INTERVAL_WIDTH;
  const coverage =
    chosenResult && coverageWidth > 0 ? coverageReport(chosenResult.backtest.origins, coverageWidth) : null;

  const lastTime = series.times[series.times.length - 1];
  const futureTimes = Array.from({ length: horizon }, (_, h) => lastTime + (h + 1) * WEEK_MS);
  const bounds =
    params.intervalWidth === null
      ? null
      : intervalBounds(final, params.intervalWidth, coverage?.calibration ?? 1);

  const data: OutputPoint[] = [
    ...series.inputIndex.map((i) => ({
      timestamp: toIso(series.times[i]),
      value: toCount(history.fitted[i]),
    })),
    ...futureTimes.map((time, h) => {
      const point: OutputPoint = { timestamp: toIso(time), value: toCount(final.mean[h]) };
      if (bounds) {
        point.lower = Math.min(toCount(bounds.lower[h]), point.value);
        point.upper = Math.max(toCount(bounds.upper[h]), point.value);
      }
      return point;
    }),
  ];

  const baselineCandidate = selection.baseline?.candidate ?? NAIVE_CANDIDATES[0];
  const baselineFit =
    baselineCandidate === selection.chosen ? final : fitCandidate(baselineCandidate, series, horizon);
  const baselineForecast = futureTimes.map((time, h) => ({
    timestamp: toIso(time),
    value: toCount(baselineFit.mean[h]),
  }));

  const warnings = unique([...paramWarnings, ...seriesWarnings, ...selection.warnings, ...final.warnings]);
  return {
    data,
    params: effectiveParams(params, selection.chosen),
    diagnostics: buildDiagnostics({
      series,
      params,
      selection,
      chosenResult,
      coverage,
      details: final.details,
      futureTimes,
      warnings,
      requested: paramEntries,
      fit: history.diagnostics,
    }),
    baselineForecast,
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function family(candidate: Candidate): 'naive' | 'trend' | 'seasonal' {
  if (candidate.kind !== 'regression') return 'naive';
  return candidate.config.fourierOrder > 0 ? 'seasonal' : 'trend';
}

/** Parameters that reproduce the chosen model when sent back with the same data. */
function effectiveParams(params: ForecastParams, chosen: Candidate): ParamEntry[] {
  const regression = chosen.kind === 'regression' ? chosen.config : null;
  const entries: ParamEntry[] = [
    { name: 'horizon_weeks', value: params.horizonWeeks },
    { name: 'model', value: params.model === 'auto' ? family(chosen) : params.model },
    { name: 'transform', value: regression?.transform ?? params.transform ?? PREFERRED_TRANSFORM },
    { name: 'changepoint_prior_scale', value: params.changepointPriorScale },
    { name: 'changepoint_range', value: params.changepointRange },
    { name: 'n_changepoints', value: params.nChangepoints },
    {
      name: 'recency_half_life_weeks',
      value: regression
        ? (regression.halfLifeWeeks ?? 'none')
        : params.recencyHalfLifeWeeks === null
          ? 'auto'
          : params.recencyHalfLifeWeeks,
    },
    { name: 'fourier_order', value: regression?.fourierOrder ?? params.fourierOrder ?? 'auto' },
    { name: 'calendar', value: regression?.calendar ?? params.calendar ?? PREFERRED_CALENDAR },
    { name: 'seasonality', value: regression?.seasonality ?? params.seasonality ?? 'auto' },
    { name: 'history_fit', value: params.historyFit },
    { name: 'robust', value: params.robust ? 1 : 0 },
    { name: 'backtest_origins', value: params.backtestOrigins },
    { name: 'backtest_step', value: params.backtestStep },
    { name: 'min_train_weeks', value: params.minTrainWeeks },
    { name: 'selection_tolerance', value: params.selectionTolerance },
    { name: 'drift_threshold', value: params.driftThreshold },
  ];
  if (params.intervalWidth !== null)
    entries.splice(1, 0, { name: 'interval_width', value: params.intervalWidth });
  return entries;
}

function summarise(result: CandidateResult): CandidateSummary {
  const metrics = (m: Metrics) => ({ wape: round(m.wape, 2), mae: round(m.mae, 2), bias: round(m.bias, 2) });
  return {
    id: result.candidate.id,
    complexity: result.complexity,
    ...summaryMeans(result.backtest),
    per_origin: result.backtest.origins.map((o: OriginEvaluation) => ({
      first_test_week: o.firstTestWeek,
      kind: o.kind,
      weeks: o.metrics.count,
      ...metrics(o.metrics),
    })),
  };
}

function summaryMeans(b: BacktestResult) {
  return { mean_wape: round(b.meanWape, 2), mean_mae: round(b.meanMae, 2), mean_bias: round(b.meanBias, 2) };
}

function buildDiagnostics(input: {
  series: WeeklySeries;
  params: ForecastParams;
  selection: Selection;
  chosenResult: CandidateResult | null;
  coverage: CoverageReport | null;
  details: Record<string, unknown>;
  futureTimes: number[];
  warnings: string[];
  requested: ParamEntry[];
  fit: FitDiagnostics;
}): Diagnostics {
  const {
    series,
    params,
    selection,
    chosenResult,
    coverage,
    details,
    futureTimes,
    warnings,
    requested,
    fit,
  } = input;
  const intervals: Diagnostics['intervals'] = coverage && {
    width: params.intervalWidth ?? DIAGNOSTIC_INTERVAL_WIDTH,
    requested: params.intervalWidth !== null,
    coverage: coverage.calibrated === null ? null : round(coverage.calibrated, 3),
    coverage_uncalibrated: coverage.raw === null ? null : round(coverage.raw, 3),
    calibration_factor: round(coverage.calibration, 4),
    compared_weeks: coverage.count,
    method:
      'centre ± c·z·σ·√h on the model scale (σ = robust residual SD, c calibrated on backtest errors), ' +
      'back-transformed; coverage is leave-one-origin-out',
  };
  const chosen = selection.chosen;
  return {
    model: {
      id: chosen.id,
      family: family(chosen),
      selection_reason: selection.reason,
      config: chosen.kind === 'regression' ? { ...chosen.config } : { kind: chosen.kind },
      details: roundDeep(details) as Record<string, unknown>,
    },
    backtest: {
      origins: selection.origins.map((o) => ({
        first_test_week: toIso(series.times[o.trainWeeks]).slice(0, 10),
        train_weeks: o.trainWeeks,
        kind: o.kind,
      })),
      selected: chosenResult ? summarise(chosenResult) : null,
      baseline: selection.baseline ? summarise(selection.baseline) : null,
      candidates: selection.results
        .map(summarise)
        .sort((a, b) => a.mean_wape - b.mean_wape || a.complexity - b.complexity),
    },
    intervals,
    series: {
      input_weeks: series.inputIndex.length,
      grid_weeks: series.times.length,
      missing_weeks: series.missingCount,
      first_week: toIso(series.times[0]),
      last_week: toIso(series.times[series.times.length - 1]),
      forecast_from: toIso(futureTimes[0]),
      forecast_to: toIso(futureTimes[futureTimes.length - 1]),
      forecast_weeks: futureTimes.length,
    },
    fit,
    warnings,
    requested_params: requested,
  };
}

function roundDeep(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? round(value, 6) : null;
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]));
  }
  return value;
}
