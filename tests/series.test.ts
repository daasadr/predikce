import { describe, expect, it } from 'vitest';
import { buildWeeklySeries, parseTimestamp, sliceSeries } from '../src/forecast/series.js';
import { InvalidInputError, UnprocessableSeriesError, type InputPoint } from '../src/forecast/types.js';

const weeks = (start: string, values: number[]): InputPoint[] =>
  values.map((value, i) => ({
    timestamp: new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString(),
    value,
  }));

function expectInvalid(points: InputPoint[]): InvalidInputError {
  try {
    buildWeeklySeries(points);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    return error as InvalidInputError;
  }
  throw new Error('expected InvalidInputError');
}

describe('parseTimestamp', () => {
  it('parses ISO dates and date-times as UTC', () => {
    expect(parseTimestamp('2021-06-21')).toBe(Date.UTC(2021, 5, 21));
    expect(parseTimestamp('2021-06-21T00:00:00')).toBe(Date.UTC(2021, 5, 21));
    expect(parseTimestamp('2021-06-21T00:00:00.000Z')).toBe(Date.UTC(2021, 5, 21));
    expect(parseTimestamp('2021-06-21T02:00:00+02:00')).toBe(Date.UTC(2021, 5, 21));
  });

  it.each(['21.6.2021', '2021-02-30', 'tomorrow', '', '2021-13-01'])('rejects %s', (s) => {
    expect(parseTimestamp(s)).toBeNull();
  });
});

describe('buildWeeklySeries', () => {
  it('sorts unsorted input', () => {
    const points = weeks('2021-01-04', [1, 2, 3, 4]);
    const { series } = buildWeeklySeries([points[2]!, points[0]!, points[3]!, points[1]!]);
    expect(series.values).toEqual([1, 2, 3, 4]);
  });

  it('fills a gap as a missing observation, not as zero', () => {
    const points = weeks('2021-01-04', [10, 20, 30, 40]);
    const { series, warnings } = buildWeeklySeries([points[0]!, points[1]!, points[3]!]);
    expect(series.values).toEqual([10, 20, null, 40]);
    expect(series.inputIndex).toEqual([0, 1, 3]);
    expect(series.missingCount).toBe(1);
    expect(warnings.join(' ')).toMatch(/missing/i);
  });

  it('rejects duplicate timestamps', () => {
    const points = weeks('2021-01-04', [1, 2, 3]);
    expectInvalid([...points, { timestamp: '2021-01-11', value: 5 }]);
  });

  it('rejects a timestamp on a different weekday', () => {
    const points = weeks('2021-01-04', [1, 2, 3]);
    const error = expectInvalid([...points, { timestamp: '2021-01-26T00:00:00.000Z', value: 5 }]);
    expect(JSON.stringify(error.details)).toContain('2021-01-26');
  });

  it('rejects spacing that is not a multiple of 7 days', () => {
    const points = weeks('2021-01-04', [1, 2, 3]);
    expectInvalid([...points, { timestamp: '2021-01-25T12:00:00.000Z', value: 5 }]);
  });

  it.each([-5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER * 2])(
    'rejects value %s',
    (v) => {
      expectInvalid(weeks('2021-01-04', [1, 2, v]));
    },
  );

  it('accepts zeros', () => {
    const { series } = buildWeeklySeries(weeks('2021-01-04', [0, 0, 5]));
    expect(series.values).toEqual([0, 0, 5]);
  });

  it('rejects an empty series', () => {
    expectInvalid([]);
  });

  it('returns 422 for fewer than 3 weeks', () => {
    expect(() => buildWeeklySeries(weeks('2021-01-04', [1, 2]))).toThrow(UnprocessableSeriesError);
  });

  it('slices the first weeks of a series', () => {
    const { series } = buildWeeklySeries(weeks('2021-01-04', [1, 2, 3, 4, 5]));
    const head = sliceSeries(series, 3);
    expect(head.values).toEqual([1, 2, 3]);
    expect(head.times).toHaveLength(3);
    expect(head.inputIndex).toEqual([0, 1, 2]);
  });
});
