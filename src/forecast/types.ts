import type { CalendarName } from './calendar.js';

export interface InputPoint {
  timestamp: string;
  value: number;
}

export interface OutputPoint {
  timestamp: string;
  value: number;
  lower?: number;
  upper?: number;
}

export type ModelFamily = 'auto' | 'naive' | 'trend' | 'seasonal';
export type Transform = 'log' | 'none';
export type CalendarSetting = CalendarName | 'none';
export type SeasonalityMode = 'local' | 'two_stage';
export type HistoryFit = 'blend' | 'model';

/** Parameters after validation. `null` in a searchable dimension means "let model selection decide". */
export interface ForecastParams {
  horizonWeeks: number;
  intervalWidth: number | null;
  model: ModelFamily;
  transform: Transform | null;
  changepointPriorScale: number;
  changepointRange: number;
  nChangepoints: number;
  /** Number of weeks, 'none' for no recency weighting, null for auto. */
  recencyHalfLifeWeeks: number | 'none' | null;
  /** 0-3, null for auto. */
  fourierOrder: number | null;
  calendar: CalendarSetting | null;
  /** local | two_stage, null for auto. */
  seasonality: SeasonalityMode | null;
  /** How the fitted history is displayed; never affects the forecast. */
  historyFit: HistoryFit;
  robust: boolean;
  backtestOrigins: number;
  backtestStep: number;
  minTrainWeeks: number;
  selectionTolerance: number;
  driftThreshold: number;
}

export const DEFAULT_PARAMS: ForecastParams = {
  horizonWeeks: 10,
  intervalWidth: null,
  model: 'auto',
  transform: null,
  changepointPriorScale: 0.5,
  changepointRange: 0.8,
  nChangepoints: 10,
  recencyHalfLifeWeeks: null,
  fourierOrder: null,
  calendar: null,
  seasonality: null,
  historyFit: 'blend',
  robust: true,
  backtestOrigins: 4,
  backtestStep: 13,
  minTrainWeeks: 26,
  selectionTolerance: 0.03,
  driftThreshold: 2,
};

/** Values used when a searchable dimension is not searched (e.g. when no backtest is possible). */
export const PREFERRED_TRANSFORM: Transform = 'log';
export const PREFERRED_CALENDAR: CalendarSetting = 'CZ';

export interface ParamEntry {
  name: string;
  value: number | string;
}

/** Thrown for input that is syntactically valid but cannot be forecast (HTTP 422). */
export class UnprocessableSeriesError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown[] = [],
  ) {
    super(message);
  }
}

/** Thrown for invalid input (HTTP 400). */
export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly details: unknown[] = [],
  ) {
    super(message);
  }
}
