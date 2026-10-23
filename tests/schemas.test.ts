import { describe, expect, it } from 'vitest';
import { parseParams, parsePredictBody } from '../src/schemas.js';
import { DEFAULT_PARAMS, InvalidInputError } from '../src/forecast/types.js';

describe('parsePredictBody', () => {
  it('accepts data without params', () => {
    const body = parsePredictBody({ data: [{ timestamp: '2021-01-04T00:00:00.000Z', value: 1 }] });
    expect(body.data).toHaveLength(1);
    expect(body.params).toEqual([]);
  });

  it.each([
    ['missing data', {}],
    ['empty data', { data: [] }],
    ['string value', { data: [{ timestamp: '2021-01-04', value: '5' }] }],
    ['null body', null],
    ['params not an array', { params: {}, data: [{ timestamp: '2021-01-04', value: 1 }] }],
  ])('rejects %s', (_name, body) => {
    expect(() => parsePredictBody(body)).toThrow(InvalidInputError);
  });
});

describe('parseParams', () => {
  it('returns defaults for no params', () => {
    const { params, warnings } = parseParams([]);
    expect(params).toEqual(DEFAULT_PARAMS);
    expect(warnings).toEqual([]);
  });

  it('parses known params and coerces numeric strings', () => {
    const { params } = parseParams([
      { name: 'horizon_weeks', value: '12' },
      { name: 'interval_width', value: 0.75 },
      { name: 'recency_half_life_weeks', value: 26 },
      { name: 'fourier_order', value: 'auto' },
      { name: 'calendar', value: 'none' },
      { name: 'transform', value: 'LOG' },
      { name: 'robust', value: 0 },
      { name: 'model', value: 'trend' },
    ]);
    expect(params.horizonWeeks).toBe(12);
    expect(params.intervalWidth).toBe(0.75);
    expect(params.recencyHalfLifeWeeks).toBe(26);
    expect(params.fourierOrder).toBeNull();
    expect(params.calendar).toBe('none');
    expect(params.transform).toBe('log');
    expect(params.robust).toBe(false);
    expect(params.model).toBe('trend');
  });

  it('warns about unknown params', () => {
    const { warnings } = parseParams([{ name: 'foo', value: 1 }]);
    expect(warnings.join(' ')).toContain('foo');
  });

  it.each([
    ['interval_width', 1.5],
    ['interval_width', 1],
    ['horizon_weeks', 0],
    ['horizon_weeks', 2.5],
    ['fourier_order', 4],
    ['model', 'prophet'],
    ['calendar', 'DE'],
    ['robust', 2],
    ['changepoint_prior_scale', -1],
    ['recency_half_life_weeks', 'soon'],
  ])('rejects %s = %s', (name, value) => {
    try {
      parseParams([{ name, value }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError);
      expect(JSON.stringify((error as InvalidInputError).details)).toContain(name);
    }
  });

  it('rejects duplicate param names', () => {
    expect(() =>
      parseParams([
        { name: 'horizon_weeks', value: 5 },
        { name: 'horizon_weeks', value: 6 },
      ]),
    ).toThrow(InvalidInputError);
  });
});
