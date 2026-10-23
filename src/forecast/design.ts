// Regressors of the forecasting model: piecewise linear trend, Fourier seasonality and calendar.

import { DAY_MS, WEEK_MS, weekCalendarFeatures } from './calendar.js';
import type { CalendarSetting } from './types.js';

export const YEAR_DAYS = 365.25;
/** Seasonality needs at least two full years so that each part of the year is seen twice. */
export const MIN_SEASONAL_WEEKS = 104;

export type ColumnKind =
  'intercept' | 'slope' | 'changepoint' | 'fourier' | 'working_days' | 'christmas_week' | 'new_year_week';

export interface DesignSpec {
  /** Number of grid weeks of the training series. */
  nTrain: number;
  /** Divisor that maps the training index range onto [0, 1]. */
  tScale: number;
  /** Changepoint locations in week-index units. */
  changepoints: number[];
  fourierOrder: number;
  calendar: CalendarSetting;
  columns: { name: string; kind: ColumnKind }[];
}

export function hinge(t: number, s: number): number {
  return Math.max(0, t - s);
}

/** Changepoints spread uniformly over the first `range` share of the history. */
export function changepointLocations(nTrain: number, count: number, range: number): number[] {
  const span = Math.floor(nTrain * range);
  const k = Math.max(0, Math.min(count, span - 1));
  return Array.from({ length: k }, (_, i) => ((i + 1) * (span - 1)) / k);
}

/** Time in years since the Unix epoch, so that the period of the terms is exactly one year. */
export function yearFraction(time: number): number {
  return time / DAY_MS / YEAR_DAYS;
}

/** [sin(2π·1·τ), cos(2π·1·τ), …, sin(2π·K·τ), cos(2π·K·τ)] */
export function fourierTerms(time: number, order: number): number[] {
  const tau = yearFraction(time);
  const terms: number[] = [];
  for (let j = 1; j <= order; j++) {
    terms.push(Math.sin(2 * Math.PI * j * tau), Math.cos(2 * Math.PI * j * tau));
  }
  return terms;
}

/** ln(max(wd, 0.5) / 5): 0 for a full week, about −0.92 for a week with two working days. */
export function workingDaysRegressor(workingDays: number): number {
  return Math.log(Math.max(workingDays, 0.5) / 5);
}

export function makeDesignSpec(
  nTrain: number,
  options: {
    nChangepoints: number;
    changepointRange: number;
    fourierOrder: number;
    calendar: CalendarSetting;
  },
): DesignSpec {
  const changepoints = changepointLocations(nTrain, options.nChangepoints, options.changepointRange);
  const columns: DesignSpec['columns'] = [
    { name: 'intercept', kind: 'intercept' },
    { name: 'slope', kind: 'slope' },
    ...changepoints.map((s) => ({ name: `changepoint@${s.toFixed(1)}`, kind: 'changepoint' as const })),
  ];
  for (let j = 1; j <= options.fourierOrder; j++) {
    columns.push({ name: `sin${j}`, kind: 'fourier' }, { name: `cos${j}`, kind: 'fourier' });
  }
  if (options.calendar !== 'none') {
    columns.push(
      { name: 'working_days', kind: 'working_days' },
      { name: 'christmas_week', kind: 'christmas_week' },
      { name: 'new_year_week', kind: 'new_year_week' },
    );
  }
  return {
    nTrain,
    tScale: Math.max(nTrain - 1, 1),
    changepoints,
    fourierOrder: options.fourierOrder,
    calendar: options.calendar,
    columns,
  };
}

/** One row of the design matrix for week index `t` starting at `time`. */
export function designRow(spec: DesignSpec, t: number, time: number): number[] {
  const row = [1, t / spec.tScale];
  for (const s of spec.changepoints) row.push(hinge(t, s) / spec.tScale);
  if (spec.fourierOrder > 0) row.push(...fourierTerms(time, spec.fourierOrder));
  if (spec.calendar !== 'none') {
    const f = weekCalendarFeatures(spec.calendar, time);
    row.push(workingDaysRegressor(f.workingDays), f.containsChristmasEve ? 1 : 0, f.containsNewYear ? 1 : 0);
  }
  return row;
}

/** Design rows for the training weeks followed by `horizon` future weeks. */
export function designMatrix(spec: DesignSpec, firstTime: number, horizon: number): number[][] {
  return Array.from({ length: spec.nTrain + horizon }, (_, t) => designRow(spec, t, firstTime + t * WEEK_MS));
}
