import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadSampleData, weeklyPoints } from './fixtures.js';

const sample = loadSampleData();
let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'forecaster-'));
  app = await buildServer({ dataDir });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const predict = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/predict', payload: payload as object });

describe('POST /predict', () => {
  it('returns 154 points for the sample data', async () => {
    const res = await predict({ data: sample });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { timestamp: string; value: number }[] }>();
    expect(Object.keys(body)).toEqual(['data']);
    expect(body.data).toHaveLength(154);
    expect(body.data[144].timestamp).toBe('2021-06-28T00:00:00.000Z');
    expect(body.data[153].timestamp).toBe('2021-08-30T00:00:00.000Z');
  });

  it('adds intervals when interval_width is given', async () => {
    const res = await predict({ params: [{ name: 'interval_width', value: 0.75 }], data: sample });
    const forecast = res.json<{ data: { lower?: number; upper?: number }[] }>().data.slice(144);
    expect(forecast.every((p) => p.lower !== undefined && p.upper !== undefined)).toBe(true);
  });

  it.each([
    ['empty data', { data: [] }],
    ['missing data', { params: [] }],
    ['negative value', { data: weeklyPoints('2021-01-04', [1, 2, -3]) }],
    [
      'duplicate',
      { data: [...weeklyPoints('2021-01-04', [1, 2, 3]), { timestamp: '2021-01-04', value: 1 }] },
    ],
    [
      'wrong weekday',
      { data: [...weeklyPoints('2021-01-04', [1, 2, 3]), { timestamp: '2021-01-27', value: 1 }] },
    ],
    [
      'bad param',
      { params: [{ name: 'interval_width', value: 2 }], data: weeklyPoints('2021-01-04', [1, 2, 3]) },
    ],
  ])('returns 400 for %s', async (_name, payload) => {
    const res = await predict(payload);
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; message: string; details: unknown[] }>();
    expect(body.error).toBe('invalid_input');
    expect(typeof body.message).toBe('string');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/predict',
      headers: { 'content-type': 'application/json' },
      payload: '{"data": [',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_input');
  });

  it('returns 422 for fewer than 3 weeks', async () => {
    const res = await predict({ data: weeklyPoints('2021-01-04', [1, 2]) });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toBe('series_too_short');
  });
});

describe('GET /prediction', () => {
  it('returns 404 before the first prediction', async () => {
    const res = await app.inject({ method: 'GET', url: '/prediction' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('not_found');
  });

  it('returns the same data, effective params and calculated_at after POST', async () => {
    const posted = (await predict({ params: [{ name: 'foo', value: 1 }], data: sample })).json<{
      data: unknown[];
    }>();
    const res = await app.inject({ method: 'GET', url: '/prediction' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: unknown[];
      params: { name: string; value: unknown }[];
      calculated_at: string;
      diagnostics: { warnings: string[]; model: { id: string }; monitoring: { status: string } };
    }>();
    expect(body.data).toEqual(posted.data);
    expect(new Date(body.calculated_at).toISOString()).toBe(body.calculated_at);
    const names = body.params.map((p) => p.name);
    for (const name of [
      'horizon_weeks',
      'model',
      'transform',
      'recency_half_life_weeks',
      'fourier_order',
      'calendar',
    ]) {
      expect(names).toContain(name);
    }
    expect(names).not.toContain('foo');
    expect(body.diagnostics.warnings.join(' ')).toMatch(/foo/);
    expect(body.diagnostics.monitoring.status).toBe('no_previous_prediction');
  });

  it('survives a restart', async () => {
    await predict({ data: sample });
    const before = (await app.inject({ method: 'GET', url: '/prediction' })).json();
    await app.close();
    app = await buildServer({ dataDir });
    const after = await app.inject({ method: 'GET', url: '/prediction' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(before);
  });

  it('keeps only the newest records in predictions.jsonl', async () => {
    await app.close();
    app = await buildServer({ dataDir, maxLogRecords: 3 });
    const series = weeklyPoints('2021-01-04', [10, 11, 12, 13, 14, 15]);
    for (let end = 3; end <= 6; end++) await predict({ data: series.slice(0, end) });
    const records = readFileSync(join(dataDir, 'predictions.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { input_weeks: number });
    expect(records.map((r) => r.input_weeks)).toEqual([4, 5, 6]);
  });

  it('logs every prediction to predictions.jsonl', async () => {
    await predict({ data: sample.slice(0, 134) });
    await predict({ data: sample });
    const lines = readFileSync(join(dataDir, 'predictions.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
    const body = (await app.inject({ method: 'GET', url: '/prediction' })).json<{
      diagnostics: { monitoring: { status: string; compared_weeks: number; realized_wape: number } };
    }>();
    expect(body.diagnostics.monitoring.status).toBe('evaluated');
    expect(body.diagnostics.monitoring.compared_weeks).toBe(10);
    expect(body.diagnostics.monitoring.realized_wape).toBeGreaterThan(0);
  });
});

describe('other routes', () => {
  it.each([
    ['GET', '/health'],
    ['GET', '/predict'],
    ['POST', '/prediction'],
  ] as const)('%s %s returns 404 JSON', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('not_found');
  });
});
