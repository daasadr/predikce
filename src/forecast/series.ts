import { WEEK_MS } from './calendar.js';
import { InvalidInputError, UnprocessableSeriesError, type InputPoint } from './types.js';

export const MIN_SERIES_WEEKS = 3;
const MAX_GRID_WEEKS = 10_000;
const MAX_DETAILS = 20;

/** A regular weekly grid from the first to the last input week; `null` marks a missing week. */
export interface WeeklySeries {
  /** Week start timestamps in ms (UTC), step exactly 7 days. */
  times: number[];
  values: (number | null)[];
  /** Grid indices of weeks that were present in the input, ascending. */
  inputIndex: number[];
  missingCount: number;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parses an ISO 8601 date or date-time; values without an offset are read as UTC. */
export function parseTimestamp(text: string): number | null {
  const match = ISO_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 59) return null;
  const hasTime = hour !== undefined;
  const iso = hasTime ? `${text.trim()}${offset === undefined ? 'Z' : ''}` : `${text.trim()}T00:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function buildWeeklySeries(points: InputPoint[]): { series: WeeklySeries; warnings: string[] } {
  if (points.length === 0) throw new InvalidInputError('data must contain at least one point');

  const details: { index: number; timestamp: string; message: string }[] = [];
  const parsed: { time: number; value: number }[] = [];
  points.forEach((point, index) => {
    const time = parseTimestamp(point.timestamp);
    if (time === null) {
      details.push({ index, timestamp: point.timestamp, message: 'timestamp is not a valid ISO 8601 date' });
      return;
    }
    if (!Number.isFinite(point.value) || point.value < 0 || point.value > Number.MAX_SAFE_INTEGER) {
      details.push({
        index,
        timestamp: point.timestamp,
        message: 'value must be a finite number between 0 and Number.MAX_SAFE_INTEGER',
      });
      return;
    }
    parsed.push({ time, value: point.value });
  });
  if (details.length > 0) throw new InvalidInputError('Invalid data points', details.slice(0, MAX_DETAILS));

  parsed.sort((a, b) => a.time - b.time);
  const first = parsed[0].time;
  const last = parsed[parsed.length - 1].time;
  const firstWeekday = new Date(first).getUTCDay();
  for (let i = 0; i < parsed.length; i++) {
    const { time } = parsed[i];
    const timestamp = new Date(time).toISOString();
    if (i > 0 && time === parsed[i - 1].time) {
      details.push({ index: i, timestamp, message: 'duplicate timestamp' });
    } else if (new Date(time).getUTCDay() !== firstWeekday) {
      details.push({
        index: i,
        timestamp,
        message: 'timestamp is on a different weekday than the first one',
      });
    } else if ((time - first) % WEEK_MS !== 0) {
      details.push({
        index: i,
        timestamp,
        message: 'distance from the first timestamp is not a multiple of 7 days',
      });
    }
  }
  if (details.length > 0) {
    throw new InvalidInputError(
      'Timestamps must be unique, on the same weekday and a whole number of weeks apart',
      details.slice(0, MAX_DETAILS),
    );
  }

  const gridLength = (last - first) / WEEK_MS + 1;
  if (gridLength > MAX_GRID_WEEKS) {
    throw new InvalidInputError(`The series spans more than ${MAX_GRID_WEEKS} weeks`);
  }
  if (parsed.length < MIN_SERIES_WEEKS) {
    throw new UnprocessableSeriesError(
      'series_too_short',
      `At least ${MIN_SERIES_WEEKS} weeks are needed, got ${parsed.length}`,
    );
  }

  const times = Array.from({ length: gridLength }, (_, i) => first + i * WEEK_MS);
  const values: (number | null)[] = new Array<number | null>(gridLength).fill(null);
  const inputIndex: number[] = [];
  for (const { time, value } of parsed) {
    const index = (time - first) / WEEK_MS;
    values[index] = value;
    inputIndex.push(index);
  }
  const missingCount = gridLength - parsed.length;
  const warnings: string[] = [];
  if (missingCount > 0) {
    const missing = times
      .filter((_, i) => values[i] === null)
      .map((t) => new Date(t).toISOString().slice(0, 10));
    warnings.push(
      `${missingCount} missing week(s) were filled as missing observations (weight 0, not zero sales): ` +
        `${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`,
    );
  }
  return { series: { times, values, inputIndex, missingCount }, warnings };
}

/** The first `length` grid weeks of a series (the training part of a backtest origin). */
export function sliceSeries(series: WeeklySeries, length: number): WeeklySeries {
  const values = series.values.slice(0, length);
  const inputIndex = series.inputIndex.filter((i) => i < length);
  return {
    times: series.times.slice(0, length),
    values,
    inputIndex,
    missingCount: length - inputIndex.length,
  };
}

/** Index of the last observed (non-missing) week, or -1. */
export function lastObservedIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return -1;
}

export function toIso(time: number): string {
  return new Date(time).toISOString();
}
